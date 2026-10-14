/* Tests for api/bookings.js against an in-memory fake of Supabase (no network needed).
   Run:  node tests/bookings.test.js
   The Firebase-token checks need the `openssl` command; they are skipped if it is missing. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { makeFake } = require('./helpers/fake-supabase.js');

process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_testkey';
process.env.ADMIN_PASSCODE = 'staff-pass';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const group = (n) => console.log('\n' + n);

/* ---- optional: a throwaway cert so we can sign Firebase-style tokens ---- */
let certPem = null, keyPem = null;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-cert-'));
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -subj "/CN=test" -days 2', { cwd: dir, stdio: 'ignore' });
  certPem = fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'); keyPem = fs.readFileSync(path.join(dir, 'key.pem'), 'utf8');
} catch (e) { /* skipped below */ }
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function makeToken(claims, opts) {
  opts = opts || {};
  const now = Math.floor(Date.now() / 1000);
  const payload = Object.assign({ aud: 'northlight-cc676', iss: 'https://securetoken.google.com/northlight-cc676', sub: 'uid1', iat: now - 10, exp: now + 3600, email_verified: true }, claims);
  const head = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), body = b64u(payload);
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(opts.key || keyPem).toString('base64url');
  return head + '.' + body + '.' + sig;
}

const fake = makeFake({ certs: certPem ? { k1: certPem } : null });
global.fetch = fake.fetch;
const handler = require('../api/bookings.js');
const NS = require('../js/store.js');
const U = NS.U;

let ipCounter = 0;
function call(body, ip) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler({ method: 'POST', body, headers: { 'x-forwarded-for': ip || ('10.0.0.' + (++ipCounter)) } }, res);
  });
}

/* a working weekday a few days ahead, and a Sunday */
const today = U.todayStr(NS.CLINIC_TZ);
let day = null, sunday = null;
for (let i = 3; i < 20; i++) {
  const d = U.addDaysStr(today, i), wd = U.weekdayOf(d);
  if (!day && wd >= 1 && wd <= 5) day = d;
  if (!sunday && wd === 0) sunday = d;
}
const base = { serviceId: 'consult', providerId: 'nadia', date: day, startMin: 600, name: 'Test One', email: 'one@example.com', phone: '0917', notes: 'hi', reminder: '1h', tz: 'Asia/Manila' };
const A = (x) => Object.assign({ action: 'create' }, base, x || {});

(async () => {
  group('Basics');
  ok('GET is rejected', await new Promise((r) => handler({ method: 'GET', headers: {} }, { setHeader() {}, end(b) { r(JSON.parse(b).error === 'method-not-allowed'); } })));
  ok('unknown action is rejected', (await call({ action: 'nope' })).status === 400);
  const saved = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
  ok('503 not-configured when the Supabase env variables are missing', (await call({ action: 'busy' })).status === 503);
  process.env.SUPABASE_URL = saved;
  ok('busy starts empty', (await call({ action: 'busy' })).body.busy.length === 0);

  group('Create + double-booking');
  const c1 = await call(A());
  ok('first booking is created', c1.status === 200 && c1.body.ok, c1);
  const bk = c1.body.booking;
  ok('reference is BK-XXXXXX', /^BK-[A-Z0-9]{6}$/.test(bk.ref), bk.ref);
  ok('server fixes price/minutes from the catalogue', bk.minutes === 30 && bk.price === 0);
  ok('occupied end includes the 15-min buffer (stored as end_min)', fake.tables.bookings[0].end_min === 645);
  ok('same slot is refused (database exclusion)', (await call(A({ email: 'two@example.com' }))).body.error === 'slot-unavailable');
  ok('overlapping slot inside the buffer is refused', (await call(A({ startMin: 615, email: 'two@example.com' }))).status === 409);
  ok('first slot after the buffer is accepted', (await call(A({ startMin: 645, email: 'two@example.com' }))).body.ok === true);
  ok('another provider is unaffected', (await call(A({ providerId: 'ada', email: 'three@example.com' }))).body.ok === true);
  const race = await Promise.all([call(A({ startMin: 900, email: 'r1@example.com' })), call(A({ startMin: 900, email: 'r2@example.com' }))]);
  ok('two simultaneous requests: exactly one wins', race.filter((r) => r.body.ok).length === 1 && race.filter((r) => r.status === 409).length === 1);

  group('Validation');
  ok('off-grid start time refused', (await call(A({ startMin: 601 }))).status === 409);
  ok('before opening time refused', (await call(A({ startMin: 480 }))).status === 409);
  ok('closed day refused', (await call(A({ date: sunday }))).status === 409);
  ok('past date refused', (await call(A({ date: U.addDaysStr(today, -2) }))).status === 409);
  ok('beyond the booking window refused', (await call(A({ date: U.addDaysStr(today, NS.BOOKING_WINDOW_DAYS + 7) }))).status === 409);
  ok('minimum-notice rule enforced on the server', (await call(A({ date: today, startMin: Math.max(0, U.nowMinutes() - 5) }))).status === 409);
  ok('malformed date refused', (await call(A({ date: '2026-02-31' }))).status === 422);
  ok('provider that does not offer the service refused', (await call(A({ providerId: 'ren', serviceId: 'haircut' }))).status === 422);
  ok('bad email refused', (await call(A({ email: 'nope' }))).body.error === 'invalid-email');
  ok('missing name refused', (await call(A({ name: '  ' }))).body.error === 'invalid-name');
  ok('client cannot pick the price', (await call(A({ serviceId: 'haircut', providerId: 'ada', startMin: 780, price: 1, minutes: 1, email: 'p@example.com' }))).body.booking.price === 450);

  group('Privacy');
  const busyAll = JSON.stringify((await call({ action: 'busy' })).body);
  ok('busy list never contains names or emails', busyAll.indexOf('example.com') < 0 && busyAll.indexOf('Test One') < 0 && busyAll.indexOf('customer') < 0);
  ok('busy list still reports the blocked time', JSON.parse(busyAll).busy.some((x) => x.startMin === 600 && x.providerId === 'nadia'));
  const byRef = await call({ action: 'lookup', ref: bk.ref.toLowerCase() });
  ok('lookup by reference returns the booking (case-insensitive)', byRef.body.bookings.length === 1 && byRef.body.bookings[0].customer.email === 'one@example.com');
  ok('lookup by email alone returns nothing', (await call({ action: 'lookup', email: 'one@example.com' })).body.bookings.length === 0);
  ok('unknown reference is reported as missing', (await call({ action: 'lookup', refs: ['BK-ZZZZZZ'] })).body.missing[0] === 'BK-ZZZZZZ');
  ok('garbage references are ignored, not queried', (await call({ action: 'lookup', refs: ['x)&status=eq.confirmed', 'BK-1'] })).body.bookings.length === 0);

  if (certPem) {
    const mine = (await call({ action: 'lookup', idToken: makeToken({ email: 'One@Example.com' }) })).body;
    ok('a valid Firebase token returns that email\'s bookings', mine.verified && mine.bookings.length >= 1 && mine.bookings.every((b) => b.customer.email === 'one@example.com'));
    ok('wrong project is rejected', (await call({ action: 'lookup', idToken: makeToken({ email: 'one@example.com', aud: 'other' }) })).body.verified === false);
    ok('expired token is rejected', (await call({ action: 'lookup', idToken: makeToken({ email: 'one@example.com', exp: Math.floor(Date.now() / 1000) - 5 }) })).body.verified === false);
    ok('unverified email is rejected', (await call({ action: 'lookup', idToken: makeToken({ email: 'one@example.com', email_verified: false }) })).body.verified === false);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    ok('token signed with another key is rejected', (await call({ action: 'lookup', idToken: makeToken({ email: 'one@example.com' }, { key: other }) })).body.verified === false);
    ok('tampered token is rejected', (await call({ action: 'lookup', idToken: makeToken({ email: 'one@example.com' }).slice(0, -3) + 'AAA' })).body.verified === false);
  } else console.log('  (skipped Firebase token checks: openssl not available)');

  group('Cancel / reinstate / complete');
  const c2 = (await call(A({ startMin: 960, email: 'cancel@example.com' }))).body.booking;
  ok('customer can cancel with the reference', (await call({ action: 'status', ref: c2.ref, status: 'cancelled', detail: 'Cancelled by customer (free)' })).body.booking.status === 'cancelled');
  ok('history records the cancellation', fake.tables.bookings.find((r) => r.ref === c2.ref).history.length === 2);
  const c3 = await call(A({ startMin: 960, email: 'faster@example.com' }));
  ok('released slot can be booked by someone else', c3.body.ok === true, c3.body);
  const back = await call({ action: 'status', ref: c2.ref, status: 'confirmed' });
  ok('reinstating into a taken slot is refused', back.status === 409 && back.body.error === 'slot-taken', back.body);
  ok('completing without staff access is refused', (await call({ action: 'status', ref: c3.body.booking.ref, status: 'completed' })).status === 401);
  const t0 = Date.now();
  const wrong = await call({ action: 'status', ref: c3.body.booking.ref, status: 'completed', admin: 'guess' });
  ok('wrong staff password is refused (and slowed down)', wrong.status === 401 && Date.now() - t0 >= 450, wrong);
  ok('staff can complete a booking', (await call({ action: 'status', ref: c3.body.booking.ref, status: 'completed', admin: 'staff-pass' })).body.booking.status === 'completed');
  ok('unknown reference gives 404', (await call({ action: 'status', ref: 'BK-ABCDEF', status: 'cancelled' })).status === 404);

  group('Reschedule + details');
  const r1 = (await call(A({ startMin: 1020, email: 'move@example.com' }))).body.booking;
  const mv = await call({ action: 'reschedule', ref: r1.ref, date: day, startMin: 840 });
  ok('reschedule to a free slot works', mv.body.ok && mv.body.booking.startMin === 840 && mv.body.booking.revisions === 1, mv.body);
  ok('reschedule is recorded in history', /Moved from/.test(mv.body.booking.history.slice(-1)[0].detail));
  ok('reschedule into a taken slot is refused', (await call({ action: 'reschedule', ref: r1.ref, date: day, startMin: 600 })).status === 409);
  ok('rescheduling onto its own block is allowed (self-exclusion)', (await call({ action: 'reschedule', ref: r1.ref, date: day, startMin: 855 })).body.ok === true);
  ok('cancelled bookings cannot be rescheduled', (await call({ action: 'reschedule', ref: c2.ref, date: day, startMin: 1000 })).body.error === 'cancelled');
  ok('reminder can be changed', (await call({ action: 'update', ref: r1.ref, reminder: '1d' })).body.booking.reminder === '1d');
  ok('customer details can be edited', (await call({ action: 'update', ref: r1.ref, customer: { phone: '0999' } })).body.booking.customer.phone === '0999');
  ok('bad email in an edit is refused', (await call({ action: 'update', ref: r1.ref, customer: { email: 'x' } })).status === 422);

  group('Staff');
  ok('admin-list without a password is refused', (await call({ action: 'admin-list' })).status === 401);
  const list = await call({ action: 'admin-list', admin: 'staff-pass' });
  ok('admin-list with the password returns everything', list.body.ok && list.body.bookings.length === fake.tables.bookings.length);
  const seed = [
    { id: 'bk_seed1', ref: 'BK-SEED01', serviceId: 'haircut', providerId: 'marco', date: U.addDaysStr(today, -3), startMin: 600, status: 'completed', customer: { name: 'Seed One', email: 'seed1@example.com' } },
    { id: 'bk_seed2', ref: 'BK-SEED02', serviceId: 'haircut', providerId: 'marco', date: U.addDaysStr(today, -3), startMin: 615, status: 'confirmed', customer: { name: 'Seed Two', email: 'seed2@example.com' } },
    { id: 'bk_bad', serviceId: 'nope', providerId: 'marco', date: day, startMin: 600, customer: { name: 'x', email: 'x@example.com' } }
  ];
  ok('import requires the password', (await call({ action: 'admin-import', bookings: seed })).status === 401);
  const imp = await call({ action: 'admin-import', admin: 'staff-pass', bookings: seed, waitlist: [{ serviceId: 'hilot', providerId: 'ren', date: day, email: 'w@example.com', name: 'W' }] });
  ok('import skips clashes and junk, keeps the rest', imp.body.inserted === 1 && imp.body.skipped === 2 && imp.body.waitlist === 1, imp.body);
  ok('waitlist is returned to staff', (await call({ action: 'admin-list', admin: 'staff-pass' })).body.waitlist.length === 1);
  delete process.env.ADMIN_PASSCODE;
  ok('staff area reports not-configured until ADMIN_PASSCODE is set', (await call({ action: 'admin-list', admin: 'staff-pass' })).body.error === 'admin-not-configured');
  process.env.ADMIN_PASSCODE = 'staff-pass';

  group('Abuse limits');
  let day2 = null;
  for (let i = 4; i < 25 && !day2; i++) { const d = U.addDaysStr(today, i), wd = U.weekdayOf(d); if (d !== day && wd >= 1 && wd <= 5) day2 = d; }
  let made = 0;
  for (const t of [600, 645, 690, 735, 780, 825, 870, 915]) {
    if ((await call(A({ date: day2, startMin: t, email: 'many@example.com' }))).body.ok) made++;
  }
  ok('an email can hold up to 8 upcoming bookings', made === 8, made);
  const ninth = await call(A({ date: day2, startMin: 960, email: 'many@example.com' }));
  ok('the 9th upcoming booking for one email is refused', ninth.status === 429 && ninth.body.error === 'too-many-bookings', ninth.body);
  const bursts = [];
  for (let i = 0; i < 18; i++) bursts.push((await call({ action: 'lookup', refs: [] }, '198.51.100.7')).status);
  ok('lookups are not rate-limited at normal volume', bursts.every((s) => s === 200));
  const spam = [];
  for (let i = 0; i < 17; i++) spam.push((await call(A({ email: 'nope' }), '198.51.100.8')).status);
  ok('create is rate-limited per IP', spam.indexOf(429) >= 0);

  group('Database key handling');
  ok('requests reach the database with the secret key in apikey', fake.log.length > 0 && fake.log.every((l) => l.headers.apikey === 'sb_secret_testkey'));
  ok('new-style secret key is not sent as a Bearer JWT', fake.log.every((l) => !l.headers.Authorization));
  process.env.SUPABASE_SECRET_KEY = 'eyJhbGciOi.legacy.jwt';
  await call({ action: 'busy' });
  ok('legacy service_role JWT is sent as Bearer too', fake.log[fake.log.length - 1].headers.Authorization === 'Bearer eyJhbGciOi.legacy.jwt');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
