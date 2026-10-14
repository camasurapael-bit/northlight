/* ============================================================
   Shared-database tests — plain Node, no network.
   A tiny in-memory Firestore stands in for the real one, and every
   "device" (customer phone, second phone, staff laptop) gets its own
   copy of store.js + cloud.js running in an isolated context.
   Run:  node tests/cloud.test.js
   ============================================================ */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var STORE_SRC = fs.readFileSync(path.join(__dirname, '../js/store.js'), 'utf8');
var CLOUD_SRC = fs.readFileSync(path.join(__dirname, '../js/cloud.js'), 'utf8');

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + label); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra ? '  → ' + extra : '')); }
}
function group(n) { console.log('\n\x1b[1m' + n + '\x1b[0m'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn, ms) {
  var end = Date.now() + (ms || 2500);
  while (Date.now() < end) { if (await fn()) return true; await sleep(15); }
  return false;
}

/* ---------------- fake Firestore (documents, queries, transactions, live listeners) ---------------- */
function makeBackend() {
  var docs = {}, ver = {}, watchers = [];
  var be = { docs: docs, denyWrites: false, accounts: {}, uidCounter: 0 };

  function split(p) { var i = p.indexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function snapOf(p) { var id = split(p)[1], v = docs[p]; return { id: id, exists: v !== undefined, data: function () { return clone(v); } }; }
  function field(obj, dotted) { return dotted.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, obj); }
  function matches(v, f) {
    if (!f) return true;
    var x = field(v, f.field);
    if (f.op === '==') return x === f.val;
    if (f.op === '>=') return x >= f.val;
    return false;
  }
  function fireAll() { watchers.slice().forEach(function (w) { w.fire(); }); }
  be.write = function (p, data) {
    if (be.denyWrites) { var e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
    docs[p] = clone(data); ver[p] = (ver[p] || 0) + 1;
    setTimeout(fireAll, 0);
  };

  function docRef(p) {
    return {
      path: p,
      get: function () { return sleep(2).then(function () { return snapOf(p); }); },
      set: function (data) { try { be.write(p, data); } catch (e) { return Promise.reject(e); } return Promise.resolve(); },
      onSnapshot: function (cb) { return watch(function () { return snapOf(p); }, cb); }
    };
  }
  function watch(read, cb) {
    var w = { fire: function () { cb(read()); } };
    watchers.push(w);
    setTimeout(w.fire, 3);
    return function () { var i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
  }
  function query(col, f) {
    function read() {
      return { docs: Object.keys(docs).filter(function (p) { return split(p)[0] === col && matches(docs[p], f); }).map(snapOf) };
    }
    return {
      where: function (field, op, val) { return query(col, { field: field, op: op, val: val }); },
      onSnapshot: function (cb) { return watch(read, cb); },
      get: function () { return Promise.resolve(read()); }
    };
  }
  be.db = {
    collection: function (col) {
      var q = query(col, null);
      q.doc = function (id) { return docRef(col + '/' + id); };
      return q;
    },
    runTransaction: async function (fn) {
      for (var attempt = 0; attempt < 6; attempt++) {
        var reads = {}, writes = [];
        var tx = {
          get: function (ref) { return sleep(Math.random() * 6).then(function () { reads[ref.path] = ver[ref.path] || 0; return snapOf(ref.path); }); },
          set: function (ref, data) { writes.push([ref.path, data]); }
        };
        await fn(tx);
        var stale = Object.keys(reads).some(function (p) { return (ver[p] || 0) !== reads[p]; });
        if (stale) continue;                       // someone else wrote first: run again, like the real thing
        if (be.denyWrites) { var e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
        writes.forEach(function (w) { be.write(w[0], w[1]); });
        return;
      }
      throw new Error('aborted');
    }
  };
  return be;
}

function makeFirebase(be, who) {
  var listeners = [], user = null;
  function setUser(u) { user = u; setTimeout(function () { listeners.slice().forEach(function (l) { l(user); }); }, 1); }
  var auth = {
    onAuthStateChanged: function (cb) { listeners.push(cb); setTimeout(function () { cb(user); }, 1); },
    signInAnonymously: function () { setUser({ uid: who.uid || ('anon' + (++be.uidCounter)), email: null }); return Promise.resolve(); },
    signInWithEmailAndPassword: function (e, p) {
      var acct = be.accounts[e];
      if (!acct || acct.password !== p) { var err = new Error('wrong'); err.code = 'auth/invalid-credential'; return Promise.reject(err); }
      setUser({ uid: acct.uid, email: e });
      return Promise.resolve({ user: { uid: acct.uid, email: e } });
    },
    signOut: function () { setUser(null); return Promise.resolve(); }
  };
  return { apps: [{}], app: function () { return {}; }, auth: function () { return auth; }, firestore: function () { return be.db; } };
}

function memStorage() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }

/* one simulated device */
function device(be, opts) {
  opts = opts || {};
  var sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval };
  sb.window = sb; sb.sessionStorage = opts.session || memStorage();
  sb.firebase = makeFirebase(be, opts);
  vm.createContext(sb);
  vm.runInContext(STORE_SRC, sb);
  vm.runInContext(CLOUD_SRC, sb);
  var Store = sb.NS.Store;
  sb.Store = Store; sb.errors = [];
  Store.on('cloud-error', function (e) { sb.errors.push(e); });
  return sb;
}
function nextWorkday(U, wd) {
  for (var k = 2; k < 20; k++) { var d = U.addDaysStr(U.todayStr(), k); if (U.weekdayOf(d) === wd) return d; }
}
function freeSlots(Store, prov, svc, date) { return Store.slotsFor(prov, svc, date).slots.filter(function (s) { return s.free; }); }

(async function main() {
  var be = makeBackend();
  be.accounts['boss@northlight.test'] = { password: 'secret1', uid: 'staff-1' };
  be.docs['staff/staff-1'] = { createdBy: 'console' };

  var A = device(be, { uid: 'uid-A' }), B = device(be, { uid: 'uid-B' });
  var U = A.Store.U, date = nextWorkday(U, 1);   // a Monday

  /* ---------- 1. connect ---------- */
  group('Connecting');
  ok('Starts in "connecting" until the sign-in finishes', A.Store.cloudState() === 'connecting' || A.Store.cloudState() === 'on');
  ok('Both devices come online', await until(function () { return A.Store.cloudOn() && B.Store.cloudOn(); }));
  var early = device(be, { uid: 'uid-E' });
  ok('Booking before the connection is ready is refused politely',
     early.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date, startMin: 600, name: 'E', email: 'e@x.com' }).error === 'connecting');
  ok('Customers are not staff', A.NS.cloud.isStaff() === false);

  /* ---------- 2. a booking reaches the database, and other devices see the time as taken ---------- */
  group('Booking on one phone, seen on another');
  var slot = freeSlots(A.Store, 'ada', 'haircut', date)[0];
  var r1 = A.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date, startMin: slot.start, name: 'Anna Cruz', email: 'anna@gmail.com', phone: '0917', tz: 'Asia/Manila' });
  ok('Local booking accepted', r1.ok === true, r1.error);
  var s1 = await A.Store.whenSynced(r1.booking.id);
  ok('The database accepted the booking', s1.ok === true, s1.error);
  ok('Booking stored under its reference', !!be.docs['bookings/' + r1.booking.ref]);
  ok('Booking is tagged with its owner', be.docs['bookings/' + r1.booking.ref].uid === 'uid-A');
  var dayDoc = be.docs['days/ada__' + date];
  ok('The day document holds the taken time', dayDoc && dayDoc.items.length === 1 && dayDoc.items[0].start === slot.start);
  ok('The public day document contains no personal details', JSON.stringify(dayDoc).indexOf('Anna') < 0 && JSON.stringify(dayDoc).indexOf('anna@') < 0 && JSON.stringify(dayDoc).indexOf('0917') < 0);
  ok('Phone B sees that time as taken', await until(function () {
    var s = B.Store.slotsFor('ada', 'haircut', date).slots.filter(function (x) { return x.start === slot.start; })[0];
    return s && s.free === false;
  }));
  ok('Phone B cannot see Anna\'s booking details', B.Store.all().length === 0);
  ok('Phone B is refused that slot immediately', B.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date, startMin: slot.start, name: 'Ben', email: 'ben@gmail.com' }).error === 'slot-unavailable');
  ok('Phone A still sees its own booking', A.Store.all().length === 1);

  /* ---------- 3. the race: two phones book the same time in the same instant ---------- */
  group('Two people, one slot (race)');
  var date2 = nextWorkday(U, 2);   // a Tuesday
  var slot2 = freeSlots(A.Store, 'ada', 'haircut', date2)[0];
  var pa = A.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date2, startMin: slot2.start, name: 'Race A', email: 'ra@gmail.com' });
  var pb = B.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date2, startMin: slot2.start, name: 'Race B', email: 'rb@gmail.com' });
  ok('Both pass the local check (neither knew about the other yet)', pa.ok && pb.ok);
  var ra = await A.Store.whenSynced(pa.booking.id), rb = await B.Store.whenSynced(pb.booking.id);
  ok('Exactly one of them wins', (ra.ok ? 1 : 0) + (rb.ok ? 1 : 0) === 1, JSON.stringify([ra, rb]));
  var loser = ra.ok ? B : A, loserBooking = ra.ok ? pb.booking : pa.booking, loserRes = ra.ok ? rb : ra;
  ok('The loser is told the slot is taken', loserRes.error === 'slot-unavailable', loserRes.error);
  ok('The loser\'s booking is rolled back locally', !loser.Store.byId(loserBooking.id));
  ok('The loser\'s booking never reached the database', !be.docs['bookings/' + loserBooking.ref]);
  ok('The day holds exactly one booking for that time', be.docs['days/ada__' + date2].items.length === 1);

  /* ---------- 4. overlapping (not identical) times are blocked too ---------- */
  group('Overlap protection');
  var C = device(be, { uid: 'uid-C' });
  await until(function () { return C.Store.cloudOn(); });
  var winnerStart = slot2.start;
  var ov = C.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date2, startMin: winnerStart + 15, name: 'Overlap', email: 'o@gmail.com' });
  await until(function () { return C.Store.slotsFor('ada', 'haircut', date2).slots.some(function (s) { return !s.free; }); });
  var ov2 = C.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date2, startMin: winnerStart + 15, name: 'Overlap 2', email: 'o2@gmail.com' });
  ok('An overlapping start inside someone else\'s time is refused', ov2.ok === false);

  /* ---------- 5. cancelling frees the time for everyone ---------- */
  group('Cancel frees the slot');
  var cancel = A.Store.setStatus(r1.booking.id, 'cancelled', 'Cancelled by customer');
  ok('Cancel accepted locally', cancel.ok);
  var sc = await A.Store.whenSynced(r1.booking.id);
  ok('Cancel reached the database', sc.ok && be.docs['bookings/' + r1.booking.ref].status === 'cancelled');
  ok('The time is released on the day document', be.docs['days/ada__' + date].items.length === 0);
  ok('Phone B can now book that time', await until(function () {
    return B.Store.slotsFor('ada', 'haircut', date).slots.filter(function (x) { return x.start === slot.start; })[0].free === true;
  }));

  /* ---------- 6. reschedule moves the claim from one day to another ---------- */
  group('Reschedule across days');
  var date3 = nextWorkday(U, 3);
  var slot3 = freeSlots(A.Store, 'ada', 'haircut', date3)[0];
  var rb1 = B.Store.book({ serviceId: 'haircut', providerId: 'ada', date: date, startMin: slot.start, name: 'Ben', email: 'ben@gmail.com' });
  await B.Store.whenSynced(rb1.booking.id);
  var mv = B.Store.reschedule(rb1.booking.id, date3, slot3.start);
  ok('Reschedule accepted', mv.ok, mv.error);
  var smv = await B.Store.whenSynced(rb1.booking.id);
  ok('Reschedule saved', smv.ok, smv.error);
  ok('Old day no longer holds it', be.docs['days/ada__' + date].items.length === 0);
  ok('New day holds it', be.docs['days/ada__' + date3].items.some(function (i) { return i.id === rb1.booking.id; }));

  /* ---------- 7. a refused change is undone ---------- */
  group('Refused changes are undone');
  be.denyWrites = true;
  B.errors.length = 0;
  var bad = B.Store.setStatus(rb1.booking.id, 'cancelled', 'try');
  await B.Store.whenSynced(rb1.booking.id);
  ok('The booking is put back to how it was', B.Store.byId(rb1.booking.id).status === 'confirmed', B.Store.byId(rb1.booking.id).status);
  ok('The app is told (permission)', B.errors.some(function (e) { return e.error === 'permission' && e.fresh === false; }), JSON.stringify(B.errors));
  be.denyWrites = false;

  /* ---------- 8. finding a booking by its reference ---------- */
  group('Lookup by reference');
  var G = device(be, { uid: 'uid-G' });
  await until(function () { return G.Store.cloudOn(); });
  ok('A guest device has no bookings of its own', G.Store.all().length === 0);
  var found = await G.Store.lookupRemote(rb1.booking.ref);
  ok('Looking up the reference finds it', found === 1 && !!G.Store.byRef(rb1.booking.ref));
  ok('A made-up reference finds nothing', (await G.Store.lookupRemote('BK-ZZZZZZ')) === 0);
  ok('An email is not searchable by strangers', (await G.Store.lookupRemote('ben@gmail.com')) === 0);

  /* ---------- 9. coming back later ---------- */
  group('Reopening the app');
  var A2 = device(be, { uid: 'uid-A' });
  ok('The same device sees its bookings again', await until(function () { return A2.Store.cloudOn() && A2.Store.all().length >= 1; }));
  ok('It sees the right booking', !!A2.Store.byRef(r1.booking.ref));

  /* ---------- 10. staff ---------- */
  group('Staff');
  var S = device(be, { uid: 'will-be-replaced' });
  await until(function () { return S.Store.cloudOn(); });
  ok('Before signing in the staff device sees nothing private', S.Store.all().length === 0);
  var bad2 = await S.NS.cloud.signInStaff('boss@northlight.test', 'wrong');
  ok('Wrong password is refused', bad2.ok === false);
  var notStaff = (be.accounts['guest@x.test'] = { password: 'pw', uid: 'u-guest' }, await S.NS.cloud.signInStaff('guest@x.test', 'pw'));
  ok('A normal account is not allowed in as staff', notStaff.ok === false && notStaff.error === 'not-staff');
  await until(function () { return S.Store.cloudOn(); });
  var good = await S.NS.cloud.signInStaff('boss@northlight.test', 'secret1');
  ok('Staff account signs in', good.ok === true, JSON.stringify(good));
  ok('Staff sees every booking', await until(function () { return S.NS.cloud.isStaff() && S.Store.all().length >= 3; }), 'saw ' + S.Store.all().length);
  var winnerBooking = (ra.ok ? pa : pb).booking;
  ok('Staff can see other people\'s details', !!S.Store.byRef(winnerBooking.ref));
  var cn = S.Store.setStatus(winnerBooking.id, 'cancelled', 'Cancelled by staff');
  var sx = await S.Store.whenSynced(winnerBooking.id);
  ok('Staff cancellation reaches the database', cn.ok && sx.ok && be.docs['bookings/' + winnerBooking.ref].status === 'cancelled');
  ok('Staff cancellation frees the time', be.docs['days/ada__' + date2].items.every(function (i) { return i.id !== winnerBooking.id; }));
  var wi = S.Store.book({ walkIn: true, serviceId: 'haircut', providerId: 'marco', date: date2, startMin: 600, name: 'Walk In', email: '' });
  var swi = await S.Store.whenSynced(wi.booking.id);
  ok('Staff can add a walk-in', wi.ok && swi.ok && !!be.docs['bookings/' + wi.booking.ref]);
  ok('Demo data is switched off while the database is on', S.Store.seedDemo(10) === 0);
  S.Store.clearAll();
  ok('The wipe button cannot empty the shared database', S.Store.all().length >= 3);
  S.Store.setHours('ada', { 1: [600, 900] });
  await sleep(40);
  ok('Staff schedule changes are saved for everyone', !!be.docs['schedule/main'] && JSON.parse(be.docs['schedule/main'].json).providers.ada.hours['1'][0] === 600);
  ok('Customers receive the new schedule', await until(function () { var b = B.Store.workingBlock(B.Store.providerById('ada'), date); return b && b.open === 600; }));
  await S.NS.cloud.signOutStaff();
  ok('After sign-out the staff device drops back to a normal visitor', await until(function () { return S.Store.cloudOn() && !S.NS.cloud.isStaff(); }));

  /* ---------- 11. staff session ends with the tab ---------- */
  group('Staff session');
  var shared = memStorage();
  var T1 = device(be, { uid: 'x', session: shared });
  await until(function () { return T1.Store.cloudOn(); });
  await T1.NS.cloud.signInStaff('boss@northlight.test', 'secret1');
  ok('Staff stays in while this tab\'s session is valid', await until(function () { return T1.NS.cloud.isStaff(); }));
  var T2 = device(be, { uid: 'staff-1' });   // same Firebase user, but a NEW tab (no admin session)
  await sleep(200);
  ok('A new tab does not silently inherit staff access', T2.NS.cloud.isStaff() === false);

  /* ---------- 12. no database ---------- */
  group('Without the database');
  var offline = device(be, { uid: 'o' });
  var plain = vm.createContext({ console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval });
  plain.window = plain;
  vm.runInContext(STORE_SRC, plain);
  var P = plain.NS.Store;
  ok('Store works on its own when js/cloud.js is not there', P.cloudState() === 'off' && P.cloudOn() === false);
  var pd = freeSlots(P, 'ada', 'haircut', date)[0];
  ok('Booking still works on this device only', P.book({ serviceId: 'haircut', providerId: 'ada', date: date, startMin: pd.start, name: 'Solo', email: 's@x.com' }).ok === true);
  ok('Demo data still works in this-device mode', P.seedDemo(5) === 5);

  console.log('\n' + '─'.repeat(52));
  console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('─'.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
