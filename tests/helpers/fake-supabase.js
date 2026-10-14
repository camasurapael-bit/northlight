/* A tiny in-memory stand-in for Supabase's REST API (PostgREST), just enough for api/bookings.js.
   It enforces the same rules as supabase/schema.sql: unique id/ref and no overlapping live
   bookings for one provider on one day (the exclusion constraint). */
'use strict';

function makeFake(opts) {
  opts = opts || {};
  const tables = { bookings: [], waitlist: [] };
  const log = [];           // every request that reached the "database"
  const certs = opts.certs || null;

  const num = (x) => (x !== '' && !isNaN(Number(x)));
  function cmp(a, b) { return num(a) && num(b) ? Number(a) - Number(b) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }

  function matcher(searchParams) {
    const tests = [];
    searchParams.forEach((val, key) => {
      if (['select', 'order', 'limit', 'offset'].indexOf(key) >= 0) return;
      const dot = val.indexOf('.');
      const op = val.slice(0, dot), arg = val.slice(dot + 1);
      if (op === 'eq') tests.push((r) => String(r[key]) === arg);
      else if (op === 'neq') tests.push((r) => String(r[key]) !== arg);
      else if (op === 'gte') tests.push((r) => cmp(r[key], arg) >= 0);
      else if (op === 'lte') tests.push((r) => cmp(r[key], arg) <= 0);
      else if (op === 'in') { const set = arg.replace(/^\(|\)$/g, '').split(','); tests.push((r) => set.indexOf(String(r[key])) >= 0); }
      else throw new Error('fake-supabase: unsupported filter ' + key + '=' + val);
    });
    return (r) => tests.every((t) => t(r));
  }

  function overlaps(a, b) {
    return a.provider_id === b.provider_id && a.booking_date === b.booking_date &&
      a.status !== 'cancelled' && b.status !== 'cancelled' && a.start_min < b.end_min && b.start_min < a.end_min;
  }
  const res = (status, body, headers) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  });

  async function fake(url, init) {
    init = init || {};
    if (certs && String(url).indexOf('securetoken@system.gserviceaccount.com') >= 0) {
      return res(200, certs, { 'cache-control': 'public, max-age=3600' });
    }
    const u = new URL(url);
    const m = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
    if (!m) throw new Error('fake-supabase: unexpected url ' + url);
    const table = tables[m[1]];
    if (!table) return res(404, { code: '42P01', message: 'no such table' });
    const h = init.headers || {};
    log.push({ method: init.method, table: m[1], headers: h, url: String(url) });
    if (!h.apikey) return res(401, { message: 'No API key' });

    if (init.method === 'GET') {
      let rows = table.filter(matcher(u.searchParams));
      const order = u.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map((x) => x.split('.'));
        rows = rows.slice().sort((a, b) => { for (const [k, d] of keys) { const c = cmp(a[k], b[k]); if (c) return d === 'desc' ? -c : c; } return 0; });
      }
      const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1000);
      rows = rows.slice(off, off + lim);
      const sel = u.searchParams.get('select') || '*';
      if (sel !== '*') { const cols = sel.split(','); rows = rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c]; }); return o; }); }
      return res(200, JSON.parse(JSON.stringify(rows)));
    }
    if (init.method === 'POST') {
      const row = JSON.parse(init.body);
      if (m[1] === 'bookings') {
        if (table.some((r) => r.id === row.id || r.ref === row.ref)) return res(409, { code: '23505', message: 'duplicate key' });
        if (table.some((r) => overlaps(r, row))) return res(409, { code: '23P01', message: 'conflicting key value violates exclusion constraint "bookings_no_overlap"' });
        row.price = row.price == null ? 0 : row.price;
        row.revisions = row.revisions == null ? 0 : row.revisions;
        row.cancelled_at = row.cancelled_at || null;
        row.customer_phone = row.customer_phone || ''; row.customer_notes = row.customer_notes || '';
      } else if (table.some((r) => r.id === row.id)) return res(409, { code: '23505', message: 'duplicate key' });
      row.created_at = row.created_at || new Date().toISOString();
      table.push(row);
      return res(201, [JSON.parse(JSON.stringify(row))]);
    }
    if (init.method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const hit = table.filter(matcher(u.searchParams));
      for (const r of hit) {
        const next = Object.assign({}, r, patch);
        if (m[1] === 'bookings' && table.some((o) => o !== r && overlaps(o, next))) return res(409, { code: '23P01', message: 'exclusion violation' });
      }
      hit.forEach((r) => Object.assign(r, patch));
      return res(200, JSON.parse(JSON.stringify(hit)));
    }
    return res(405, { message: 'method' });
  }
  return { fetch: fake, tables, log };
}

module.exports = { makeFake };
