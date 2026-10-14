/* Northlight — bookings API (Vercel serverless) backed by Supabase.
   The browser never talks to Supabase directly: every read/write goes through here, so the
   database stays locked and the rules below (slot validation, who may see what) are enforced
   on the server.

   POST /api/bookings   { action: ..., ... }

   Public         busy · create · lookup · status · reschedule · update · waitlist
   Staff          admin-list · admin-import · (status 'completed')   → needs body.admin === ADMIN_PASSCODE
   Who sees what  a booking is returned only to someone who knows its reference (BK-XXXXXX), or to
                  a Google user whose Firebase ID token proves the booking's email.
*/
'use strict';
const crypto = require('crypto');
const L = require('./_lib');
const DB = require('./_db');
const FB = require('./_fbauth');
const NS = require('../js/store.js');
const U = NS.U, S = NS.Store;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const REF_RE = /^BK-[A-Z0-9]{6}$/;
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_PER_EMAIL = 8;
const REMINDERS = ['none', '1h', '1d'];
const STATUSES = ['confirmed', 'completed', 'cancelled'];

/* ---------- small helpers ---------- */

const hits = new Map();
function limited(key, max, ms) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < ms);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}
function ipOf(req) {
  const h = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  return String(h).split(',')[0].trim() || 'unknown';
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (status, body) => ({ status, body });

function makeRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return 'BK-' + s;
}
function newId() { return 'bk_' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex'); }
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (e) { return false; }
}
function normRef(v) { return String(v || '').trim().toUpperCase(); }

/** Staff check. Returns true / false, or 'not-configured'. */
function adminCheck(body) {
  const want = process.env.ADMIN_PASSCODE || '';
  if (!want) return 'not-configured';
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(body.admin || ''), h(want));
}
/** null when staff are verified; otherwise a ready-made reply. */
async function requireAdmin(req, body) {
  const ok = adminCheck(body);
  if (ok === 'not-configured') return reply(503, { ok: false, error: 'admin-not-configured' });
  if (ok === true) return null;
  await sleep(500);
  if (limited('adm:' + ipOf(req), 10, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  return reply(401, { ok: false, error: 'unauthorized' });
}

/** Why a customer cannot take this slot (the same rules as the browser's availability engine). */
function slotProblem(service, provider, dateS, startMin) {
  if (typeof dateS !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateS) || U.addDaysStr(dateS, 0) !== dateS) return 'invalid-date';
  if (!Number.isInteger(startMin)) return 'invalid-time';
  const block = S.workingBlock(provider, dateS);
  if (!block) return 'closed';
  const dur = service.minutes, buf = service.buffer || 0, step = service.step || 15;
  if (startMin < block.open || startMin + dur + buf > block.close || (startMin - block.open) % step !== 0) return 'outside-hours';
  const today = U.todayStr(NS.CLINIC_TZ);
  if (U.dayNumber(dateS) > U.dayNumber(U.addDaysStr(today, NS.BOOKING_WINDOW_DAYS))) return 'beyond-window';
  if (U.instantOf(dateS, startMin).getTime() < Date.now() + NS.MIN_NOTICE_MINUTES * 60000) return 'too-soon';
  return null;
}
function slotReply(problem) {
  if (problem === 'invalid-date' || problem === 'invalid-time') return reply(422, { ok: false, error: 'invalid-selection', reason: problem });
  return reply(409, { ok: false, error: 'slot-unavailable', reason: problem });
}
const endMin = (service, startMin) => startMin + service.minutes + (service.buffer || 0);

async function getByRef(ref) {
  const rows = await DB.selectAll('bookings', 'select=*&ref=eq.' + DB.enc(ref), 1);
  return rows[0] || null;
}

/* ---------- actions ---------- */

async function busy() {
  const today = U.todayStr(NS.CLINIC_TZ);
  const from = U.addDaysStr(today, -1), to = U.addDaysStr(today, NS.BOOKING_WINDOW_DAYS + 2);
  const rows = await DB.selectAll('bookings',
    'select=id,provider_id,service_id,booking_date,start_min,minutes&status=neq.cancelled' +
    '&booking_date=gte.' + from + '&booking_date=lte.' + to + '&order=booking_date.asc,start_min.asc');
  return reply(200, {
    ok: true,
    busy: rows.map((r) => ({ id: r.id, providerId: r.provider_id, serviceId: r.service_id, date: r.booking_date, startMin: r.start_min, minutes: r.minutes }))
  });
}

async function create(req, b) {
  if (limited('c:' + ipOf(req), 15, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  const service = S.serviceById(b.serviceId), provider = S.providerById(b.providerId);
  if (!service || !provider) return reply(422, { ok: false, error: 'invalid-selection' });
  if (provider.services.indexOf(service.id) < 0) return reply(422, { ok: false, error: 'provider-skill' });
  const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase();
  if (!name) return reply(422, { ok: false, error: 'invalid-name' });
  if (!EMAIL_RE.test(email)) return reply(422, { ok: false, error: 'invalid-email' });
  const problem = slotProblem(service, provider, b.date, b.startMin);
  if (problem) return slotReply(problem);

  const today = U.todayStr(NS.CLINIC_TZ);
  const active = await DB.selectAll('bookings',
    'select=id&status=eq.confirmed&customer_email=eq.' + DB.enc(email) + '&booking_date=gte.' + today, MAX_ACTIVE_PER_EMAIL + 1);
  if (active.length >= MAX_ACTIVE_PER_EMAIL) return reply(429, { ok: false, error: 'too-many-bookings' });

  const now = new Date().toISOString();
  const tz = clean(b.tz, 60);
  for (let i = 0; i < 5; i++) {
    const r = await DB.insert('bookings', {
      id: newId(), ref: makeRef(),
      service_id: service.id, provider_id: provider.id, booking_date: b.date,
      start_min: b.startMin, end_min: endMin(service, b.startMin), minutes: service.minutes, price: service.price,
      customer_name: name, customer_email: email, customer_phone: clean(b.phone, 30), customer_notes: clean(b.notes, 500),
      reminder: REMINDERS.indexOf(b.reminder) >= 0 ? b.reminder : 'none',
      status: 'confirmed', tz_at_booking: tz && validTz(tz) ? tz : NS.CLINIC_TZ, revisions: 0,
      history: [{ at: now, action: 'created', detail: 'Booked ' + service.name + ' with ' + provider.name }],
      created_at: now, updated_at: now
    });
    if (r.ok) return reply(200, { ok: true, booking: DB.fromRow(r.row) });
    if (r.code === '23P01') return reply(409, { ok: false, error: 'slot-unavailable', reason: 'conflict' });
    if (r.code === '23505') continue;                      // reference collision: draw another one
    throw new Error('insert failed: ' + r.status + ' ' + (r.message || ''));
  }
  throw new Error('could not allocate a reference');
}

async function lookup(req, b) {
  if (limited('l:' + ipOf(req), 60, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  let refs = (Array.isArray(b.refs) ? b.refs : []).concat(b.ref ? [b.ref] : []).map(normRef).filter((r) => REF_RE.test(r));
  refs = refs.filter((r, i) => refs.indexOf(r) === i).slice(0, 40);

  let email = null;
  if (b.idToken) {
    const v = await FB.verifyIdToken(b.idToken);
    if (v) email = v.email;
  }
  const found = new Map();
  if (refs.length) {
    (await DB.selectAll('bookings', 'select=*&ref=in.(' + refs.join(',') + ')', 100)).forEach((r) => found.set(r.id, r));
  }
  if (email) {
    (await DB.selectAll('bookings', 'select=*&customer_email=eq.' + DB.enc(email) + '&order=booking_date.asc,start_min.asc', 200))
      .forEach((r) => found.set(r.id, r));
  }
  const rows = Array.from(found.values());
  const have = new Set(rows.map((r) => r.ref));
  return reply(200, { ok: true, verified: !!email, bookings: rows.map(DB.fromRow), missing: refs.filter((r) => !have.has(r)) });
}

async function setStatus(req, b) {
  if (limited('s:' + ipOf(req), 60, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  const target = String(b.status || '');
  if (STATUSES.indexOf(target) < 0) return reply(422, { ok: false, error: 'invalid-status' });
  let isStaff = false;
  if (b.admin) { const bad = await requireAdmin(req, b); if (bad) return bad; isStaff = true; }
  const row = await getByRef(normRef(b.ref));
  if (!row) return reply(404, { ok: false, error: 'not-found' });
  if (row.status === target) return reply(200, { ok: true, booking: DB.fromRow(row) });

  const okMove = (row.status === 'confirmed' && target === 'cancelled') ||
                 (row.status === 'cancelled' && target === 'confirmed') ||
                 (isStaff && row.status === 'confirmed' && target === 'completed');
  if (!okMove) return reply(target === 'completed' ? 401 : 409, { ok: false, error: target === 'completed' ? 'unauthorized' : 'bad-transition' });

  if (target === 'confirmed' && !isStaff) {
    const problem = slotProblem(S.serviceById(row.service_id), S.providerById(row.provider_id), row.booking_date, row.start_min);
    if (problem) return reply(409, { ok: false, error: 'slot-taken', reason: problem });
  }
  const now = new Date().toISOString();
  const r = await DB.update('bookings', 'id=eq.' + DB.enc(row.id), {
    status: target, updated_at: now, cancelled_at: target === 'cancelled' ? now : null,
    history: (row.history || []).concat([{ at: now, action: target, detail: clean(b.detail, 200) || ('Marked ' + target) }])
  });
  if (!r.ok) {
    if (r.code === '23P01') return reply(409, { ok: false, error: 'slot-taken', reason: 'conflict' });
    throw new Error('status update failed: ' + r.status + ' ' + (r.message || ''));
  }
  return reply(200, { ok: true, booking: DB.fromRow(r.rows[0]) });
}

async function reschedule(req, b) {
  if (limited('r:' + ipOf(req), 60, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  const row = await getByRef(normRef(b.ref));
  if (!row) return reply(404, { ok: false, error: 'not-found' });
  if (row.status !== 'confirmed') return reply(409, { ok: false, error: 'cancelled' });
  const service = S.serviceById(row.service_id), provider = S.providerById(row.provider_id);
  const problem = slotProblem(service, provider, b.date, b.startMin);
  if (problem) return slotReply(problem);

  const now = new Date().toISOString();
  const from = U.rangeLabel(row.booking_date, row.start_min, row.minutes, NS.CLINIC_TZ);
  const r = await DB.update('bookings', 'id=eq.' + DB.enc(row.id), {
    booking_date: b.date, start_min: b.startMin, end_min: endMin(service, b.startMin),
    revisions: (row.revisions || 0) + 1, updated_at: now,
    history: (row.history || []).concat([{ at: now, action: 'rescheduled', detail: 'Moved from ' + from + ' to ' + U.rangeLabel(b.date, b.startMin, row.minutes, NS.CLINIC_TZ) }])
  });
  if (!r.ok) {
    if (r.code === '23P01') return reply(409, { ok: false, error: 'slot-unavailable', reason: 'conflict' });
    throw new Error('reschedule failed: ' + r.status + ' ' + (r.message || ''));
  }
  return reply(200, { ok: true, booking: DB.fromRow(r.rows[0]) });
}

async function updateDetails(req, b) {
  if (limited('u:' + ipOf(req), 60, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  const row = await getByRef(normRef(b.ref));
  if (!row) return reply(404, { ok: false, error: 'not-found' });
  const now = new Date().toISOString();
  const patch = { updated_at: now };
  if (b.reminder !== undefined) {
    if (REMINDERS.indexOf(b.reminder) < 0) return reply(422, { ok: false, error: 'invalid-reminder' });
    patch.reminder = b.reminder;
  }
  if (b.customer && typeof b.customer === 'object') {
    const c = b.customer;
    if (c.name !== undefined) { patch.customer_name = clean(c.name, 80); if (!patch.customer_name) return reply(422, { ok: false, error: 'invalid-name' }); }
    if (c.email !== undefined) { patch.customer_email = clean(c.email, 120).toLowerCase(); if (!EMAIL_RE.test(patch.customer_email)) return reply(422, { ok: false, error: 'invalid-email' }); }
    if (c.phone !== undefined) patch.customer_phone = clean(c.phone, 30);
    if (c.notes !== undefined) patch.customer_notes = clean(c.notes, 500);
    patch.history = (row.history || []).concat([{ at: now, action: 'edited', detail: 'Customer details updated' }]);
  }
  const r = await DB.update('bookings', 'id=eq.' + DB.enc(row.id), patch);
  if (!r.ok) throw new Error('update failed: ' + r.status + ' ' + (r.message || ''));
  return reply(200, { ok: true, booking: DB.fromRow(r.rows[0]) });
}

async function waitlist(req, b) {
  if (limited('w:' + ipOf(req), 10, 600000)) return reply(429, { ok: false, error: 'rate-limited' });
  const service = S.serviceById(b.serviceId), provider = S.providerById(b.providerId);
  const email = clean(b.email, 120).toLowerCase();
  if (!service || !provider || !EMAIL_RE.test(email) || U.addDaysStr(String(b.date || ''), 0) !== b.date) return reply(422, { ok: false, error: 'invalid-selection' });
  const r = await DB.insert('waitlist', {
    id: 'wl_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
    service_id: service.id, provider_id: provider.id, booking_date: b.date, email, name: clean(b.name, 80), status: 'waiting'
  });
  if (!r.ok) throw new Error('waitlist insert failed: ' + r.status);
  return reply(200, { ok: true });
}

const waitFromRow = (r) => ({ id: r.id, serviceId: r.service_id, providerId: r.provider_id, date: r.booking_date, email: r.email, name: r.name, createdAt: r.created_at, status: r.status });

async function adminList(req, b) {
  const bad = await requireAdmin(req, b);
  if (bad) return bad;
  const rows = await DB.selectAll('bookings', 'select=*&order=booking_date.asc,start_min.asc');
  const wl = await DB.selectAll('waitlist', 'select=*&order=created_at.asc', 1000);
  return reply(200, { ok: true, bookings: rows.map(DB.fromRow), waitlist: wl.map(waitFromRow) });
}

/** Staff-only bulk insert (the "Load demo data" button). Conflicts are skipped, not errors. */
async function adminImport(req, b) {
  const bad = await requireAdmin(req, b);
  if (bad) return bad;
  const list = (Array.isArray(b.bookings) ? b.bookings : []).slice(0, 100);
  let inserted = 0, skipped = 0;
  for (const x of list) {
    const service = x && S.serviceById(x.serviceId), provider = x && S.providerById(x.providerId);
    const c = (x && x.customer) || {};
    if (!service || !provider || !EMAIL_RE.test(String(c.email || '')) || U.addDaysStr(String(x.date || ''), 0) !== x.date || !Number.isInteger(x.startMin)) { skipped++; continue; }
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      const r = await DB.insert('bookings', {
        id: /^bk_[a-z0-9]+$/i.test(x.id || '') ? x.id : newId(),
        ref: i === 0 && REF_RE.test(x.ref || '') ? x.ref : makeRef(),
        service_id: service.id, provider_id: provider.id, booking_date: x.date,
        start_min: x.startMin, end_min: endMin(service, x.startMin), minutes: service.minutes, price: service.price,
        customer_name: clean(c.name, 80) || 'Customer', customer_email: clean(c.email, 120).toLowerCase(),
        customer_phone: clean(c.phone, 30), customer_notes: clean(c.notes, 500),
        reminder: REMINDERS.indexOf(x.reminder) >= 0 ? x.reminder : 'none',
        status: STATUSES.indexOf(x.status) >= 0 ? x.status : 'confirmed', tz_at_booking: NS.CLINIC_TZ,
        revisions: Number.isInteger(x.revisions) ? Math.max(0, Math.min(x.revisions, 50)) : 0,
        history: [{ at: now, action: 'created', detail: 'Seeded demo booking' }],
        created_at: x.createdAt && !isNaN(Date.parse(x.createdAt)) ? new Date(x.createdAt).toISOString() : now, updated_at: now
      });
      if (r.ok) { inserted++; break; }
      if (r.code === '23505' && i < 2) continue;
      skipped++; break;
    }
  }
  let waited = 0;
  for (const w of (Array.isArray(b.waitlist) ? b.waitlist : []).slice(0, 20)) {
    if (!S.serviceById(w.serviceId) || !S.providerById(w.providerId) || U.addDaysStr(String(w.date || ''), 0) !== w.date) continue;
    const r = await DB.insert('waitlist', {
      id: 'wl_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      service_id: w.serviceId, provider_id: w.providerId, booking_date: w.date,
      email: clean(w.email, 120).toLowerCase() || 'waiting@example.com', name: clean(w.name, 80), status: 'waiting'
    });
    if (r.ok) waited++;
  }
  return reply(200, { ok: true, inserted, skipped, waitlist: waited });
}

/* ---------- entry point ---------- */

const ACTIONS = {
  busy: () => busy(), create, lookup, status: setStatus, reschedule, update: updateDetails, waitlist,
  'admin-list': adminList, 'admin-import': adminImport
};

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false, error: 'method-not-allowed' }); }
  const body = L.readBody(req);
  if (!body) return L.json(res, 400, { ok: false, error: 'bad-request' });
  if (!DB.configured()) return L.json(res, 503, { ok: false, error: 'not-configured' });
  const fn = ACTIONS[String(body.action || '')];
  if (!fn) return L.json(res, 400, { ok: false, error: 'unknown-action' });
  try {
    const out = await fn(req, body);
    return L.json(res, out.status, out.body);
  } catch (e) {
    console.error('bookings api error', body.action, e && e.message);
    return L.json(res, 502, { ok: false, error: 'db-error' });
  }
};
