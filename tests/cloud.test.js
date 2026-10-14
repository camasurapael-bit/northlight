/* End-to-end test of the shared database: two "devices" (each with its own store.js, cloud.js and
   localStorage) talk to the real api/bookings.js, which talks to an in-memory fake of Supabase.
   Run:  node tests/cloud.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const { makeFake } = require('./helpers/fake-supabase.js');

process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_testkey';
process.env.ADMIN_PASSCODE = 'staff-pass';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const group = (n) => console.log('\n' + n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = makeFake();
global.fetch = fake.fetch;                       // what the API uses to reach "Supabase"
const handler = require('../api/bookings.js');

const storeSrc = fs.readFileSync(path.join(__dirname, '../js/store.js'), 'utf8');
const cloudSrc = fs.readFileSync(path.join(__dirname, '../js/cloud.js'), 'utf8');

function memoryStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

/* what the browser's fetch('/api/bookings') would do, routed straight into the serverless handler */
function apiFetch(mode) {
  return (url, opts) => {
    if (mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise((resolve) => {
      const res = { headers: {}, setHeader() {}, end(b) { resolve({ status: this.statusCode, text: async () => b }); } };
      if (mode === 'no-api') { res.statusCode = 404; res.end('<html>Not found</html>'); return; }
      handler({ method: opts.method, body: JSON.parse(opts.body), headers: { 'x-forwarded-for': '10.1.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) } }, res);
    });
  };
}

/* one browser: its own localStorage, store.js, cloud.js */
function device(mode) {
  const localStorage = memoryStorage(), sessionStorage = memoryStorage();
  const win = { localStorage, location: { protocol: 'https:' } };
  const mod = { exports: {} };
  new Function('module', 'window', storeSrc)(mod, win);
  win.NS = mod.exports;
  const toasts = [];
  win.NS.app = { toast: (k, t, m) => toasts.push({ kind: k, title: t, msg: m }) };
  const doc = { visibilityState: 'visible', addEventListener() {} };
  new Function('window', 'fetch', 'document', 'localStorage', 'sessionStorage', cloudSrc)(win, apiFetch(mode || 'ok'), doc, localStorage, sessionStorage);
  return { NS: win.NS, Store: win.NS.Store, U: win.NS.U, Cloud: win.NS.Cloud, toasts, localStorage, sessionStorage };
}

(async () => {
  const probe = device();
  const U = probe.U, today = U.todayStr(probe.NS.CLINIC_TZ);
  let day = null;
  for (let i = 3; i < 20 && !day; i++) { const d = U.addDaysStr(today, i), wd = U.weekdayOf(d); if (wd >= 1 && wd <= 5) day = d; }
  const book = (name, email, startMin) => ({ serviceId: 'consult', providerId: 'nadia', date: day, startMin, name, email, phone: '', notes: '', reminder: '1h', tz: 'Asia/Manila' });
  const slotFree = (dev, start) => dev.Store.slotsFor('nadia', 'consult', day).slots.filter((s) => s.start === start)[0].free;

  group('Start-up');
  const A = device(), B = device();
  await Promise.all([A.Cloud.ready, B.Cloud.ready]);
  ok('both devices find the shared database', A.Store.isCloud() && B.Store.isCloud());

  group('Booking across two devices');
  const a1 = await A.Store.bookAsync(book('Ana A', 'ana@gmail.com', 600));
  ok('device A books a slot', a1.ok === true && /^BK-/.test(a1.booking.ref), a1);
  ok('the booking is in A\'s list', A.Store.all().length === 1);
  ok('the booking is in the database', fake.tables.bookings.length === 1);
  ok('B has not seen it yet (stale calendar)', slotFree(B, 600) === true);
  const b1 = await B.Store.bookAsync(book('Ben B', 'ben@gmail.com', 600));
  ok('B tries the same slot from a stale screen: the server refuses', b1.ok === false && b1.error === 'slot-unavailable', b1);
  await wait(30);
  ok('after the refusal B\'s calendar shows the slot as taken', slotFree(B, 600) === false);
  ok('B never receives A\'s personal details', JSON.stringify(B.Store.all()).indexOf('ana@gmail.com') < 0 && B.Store.all().length === 0);
  const b2 = await B.Store.bookAsync(book('Ben B', 'ben@gmail.com', 645));
  ok('B books the next free slot', b2.ok === true);

  group('Look up by reference');
  const found = await B.Store.findRef(a1.booking.ref);
  ok('B can open A\'s booking with the reference', !!found && found.customer.name === 'Ana A');
  ok('unknown reference resolves to nothing', (await B.Store.findRef('BK-NOPE22')) === null);

  group('Changes sync back');
  const mine = A.Store.byRef(a1.booking.ref);
  A.Store.setStatus(mine.id, 'cancelled', 'Cancelled by customer (free)');
  ok('A sees the cancel instantly (optimistic)', A.Store.byId(mine.id).status === 'cancelled');
  await wait(60);
  ok('the database has the cancelled booking and its history', fake.tables.bookings.find((r) => r.id === mine.id).status === 'cancelled' && A.Store.byId(mine.id).history.length === 2);
  await B.Cloud.refresh();
  ok('B\'s calendar frees the slot after the next refresh', slotFree(B, 600) === true);
  const takeover = await B.Store.bookAsync(book('Ben B', 'ben@gmail.com', 600));
  ok('B can now take the released slot', takeover.ok === true, takeover);
  const re = A.Store.setStatus(mine.id, 'confirmed', 'Reinstated by customer');
  ok('A\'s stale screen allows a reinstate locally…', re.ok === true);
  await wait(60);
  ok('…but the server refuses and A is put back in sync', A.Store.byId(mine.id).status === 'cancelled' && A.toasts.some((t) => /taken/i.test(t.title)), A.toasts);

  group('Reschedule through the server');
  const bb = B.Store.byRef(takeover.booking.ref);
  const mv = B.Store.reschedule(bb.id, day, 900);
  ok('reschedule works locally', mv.ok === true);
  await wait(60);
  ok('and is stored', fake.tables.bookings.find((r) => r.id === bb.id).start_min === 900);

  group('Staff device');
  const C = device(); await C.Cloud.ready;
  await C.Cloud.setAdmin('wrong');
  ok('wrong staff password: nothing is loaded and the user is told', C.Store.all().length === 0 && C.toasts.some((t) => /not accepted/i.test(t.title)), C.toasts);
  await C.Cloud.setAdmin('staff-pass');
  ok('right staff password loads every booking', C.Store.all().length === fake.tables.bookings.length && C.Store.all().length >= 3, C.Store.all().length);
  const before = fake.tables.bookings.length;
  const n = C.Store.seedDemo(6);
  await wait(150);
  ok('demo data is saved to the shared database', fake.tables.bookings.length === before + n, [before, n, fake.tables.bookings.length]);
  const other = C.Store.all().find((b) => b.status === 'confirmed' && b.customer.email === 'ben@gmail.com');
  C.Store.setStatus(other.id, 'completed', 'Completed by staff');
  await wait(60);
  ok('staff can mark a booking completed', fake.tables.bookings.find((r) => r.id === other.id).status === 'completed');
  C.Cloud.clearAdmin();
  ok('signing out of staff clears everyone\'s details from the device', C.Store.all().length === 0 && C.sessionStorage.getItem('northlight.admin.pass.v1') === null);

  group('Sign-in less visitors cannot browse');
  const D = device(); await D.Cloud.ready;
  D.Store.mine('ben@gmail.com'); await wait(60);
  ok('searching an email without proof returns nothing', D.Store.mine('ben@gmail.com').length === 0);

  group('Falls back to this device when there is no API');
  for (const mode of ['no-api', 'offline']) {
    const L = device(mode); await L.Cloud.ready;
    ok(mode + ': shared database stays off', L.Store.isCloud() === false);
    const r = await L.Store.bookAsync(book('Local Lo', 'lo@example.com', 600));
    ok(mode + ': booking still works on this device', r.ok === true && L.Store.all().length === 1);
    ok(mode + ': a clash is still caught locally', (await L.Store.bookAsync(book('Other', 'o@example.com', 600))).error === 'slot-unavailable');
  }
  const N = device(); await N.Cloud.ready;
  global.fetch = () => Promise.reject(new TypeError('Failed to fetch'));   // API alive, database unreachable
  const bad = await N.Store.bookAsync(book('Net Work', 'net@example.com', 900));
  ok('database outage on submit gives a clear "network"/"db-error" result, no fake booking', bad.ok === false && N.Store.all().length === 0, bad);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
