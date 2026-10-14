/* Northlight — Supabase REST helper for the serverless functions.
   Files starting with "_" are not exposed as routes by Vercel.
   Vercel Environment Variables:
     SUPABASE_URL          https://<project-ref>.supabase.co
     SUPABASE_SECRET_KEY   the SECRET key (sb_secret_…) or legacy service_role key — never put it in the browser
*/
'use strict';

const baseUrl = () => (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const secretKey = () => (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const configured = () => !!(baseUrl() && secretKey());
const enc = (v) => encodeURIComponent(String(v));

async function rest(method, path, body, prefer) {
  const key = secretKey();
  const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  // new-style secret keys (sb_secret_…) are not JWTs and go in `apikey` only; legacy keys are JWTs
  if (!key.startsWith('sb_')) headers.Authorization = 'Bearer ' + key;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(baseUrl() + '/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { ok: r.ok, status: r.status, data, code: data && data.code, message: data && data.message };
}

/** All rows of a query, paged 1000 at a time (Supabase caps each response). */
async function selectAll(table, qs, maxRows) {
  const out = [];
  const cap = maxRows || 5000;
  for (let offset = 0; offset < cap; offset += 1000) {
    const r = await rest('GET', table + '?' + qs + '&limit=1000&offset=' + offset);
    if (!r.ok) throw new Error('select ' + table + ' failed: ' + r.status + ' ' + (r.message || ''));
    out.push.apply(out, r.data || []);
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

async function insert(table, row) {
  const r = await rest('POST', table, row, 'return=representation');
  if (r.ok) return { ok: true, row: Array.isArray(r.data) ? r.data[0] : r.data };
  return { ok: false, status: r.status, code: r.code, message: r.message };
}

async function update(table, qs, patch) {
  const r = await rest('PATCH', table + '?' + qs, patch, 'return=representation');
  if (r.ok) return { ok: true, rows: r.data || [] };
  return { ok: false, status: r.status, code: r.code, message: r.message };
}

/* ---- row <-> app booking ---- */
function fromRow(r) {
  const b = {
    id: r.id, ref: r.ref, serviceId: r.service_id, providerId: r.provider_id,
    date: r.booking_date, startMin: r.start_min, minutes: r.minutes, price: r.price,
    customer: { name: r.customer_name, email: r.customer_email, phone: r.customer_phone || '', notes: r.customer_notes || '' },
    reminder: r.reminder, status: r.status, tzAtBooking: r.tz_at_booking,
    createdAt: r.created_at, updatedAt: r.updated_at, revisions: r.revisions || 0,
    history: Array.isArray(r.history) ? r.history : []
  };
  if (r.cancelled_at) b.cancelledAt = r.cancelled_at;
  return b;
}

module.exports = { configured, enc, rest, selectAll, insert, update, fromRow };
