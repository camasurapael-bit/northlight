/* ============================================================
   Northlight Studio — shared database (Firebase Firestore)
   ------------------------------------------------------------
   What it does
   • Signs every visitor in quietly (anonymous) so the database can tell devices apart.
   • Bookings are stored one document each:   bookings/{BK-REF}
   • Time already taken is stored WITHOUT any personal details:  days/{provider}__{date}
     Booking a slot runs inside a transaction on that day document, so two people can
     never take overlapping times, even at the same second.
   • Staff (Firebase email + password, listed in staff/{uid}) see every booking.
     Everyone else only sees their own, or one found by its reference.
   • Weekly hours / days off / closures:  schedule/main  (staff write, everyone reads)

   If Firebase cannot be reached the app keeps working on this device only.
   ============================================================ */
(function () {
  'use strict';

  var NS = window.NS, Store = NS && NS.Store;
  if (!Store || !Store.attachCloud) return;

  var fb = window.firebase, app = null;
  try { app = fb && fb.apps && fb.apps.length ? fb.app() : null; } catch (e) { app = null; }
  if (!app || !fb.firestore || !fb.auth) return;   // SDK missing or blocked: stay in this-device mode

  var db = fb.firestore(), auth = fb.auth();
  var SESSION_KEY = 'northlight.admin.v1';      // same key admin.js uses
  var SESSION_MS = 2 * 60 * 60 * 1000;
  var CONNECT_TIMEOUT_MS = 8000;

  var state = 'connecting';   // 'connecting' | 'on' | 'off'
  var staff = false, uid = '', email = '';
  var staffLogin = false;     // true while signInStaff() is running
  var unsubs = [], listeners = [];
  var daysStarted = false;

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function setState(s) { if (state !== s) { state = s; emit(); Store._remote.state(); } }

  /* ---------------- helpers ---------------- */
  function adminSessionOk() {
    try {
      var v = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return !!(v && v.exp > Date.now());
    } catch (e) { return false; }
  }
  function writeAdminSession(who) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: who, exp: Date.now() + SESSION_MS })); } catch (e) {}
  }
  function dayId(providerId, date) { return providerId + '__' + date; }
  function errCode(e) {
    var c = (e && (e.code || e.message)) || '';
    if (c === 'slot-unavailable') return 'slot-unavailable';
    if (/permission/i.test(c)) return 'permission';
    if (/unavailable|offline|network|deadline|failed-precondition|aborted/i.test(c)) return 'offline';
    return 'error';
  }
  function sameItems(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* ---------------- writes ---------------- */

  /* Save one booking and claim / release its time on the day document(s), all-or-nothing. */
  function pushBooking(b, prev) {
    var doc = JSON.parse(JSON.stringify(b));
    doc.uid = doc.uid || uid;
    var live = b.status !== 'cancelled';
    var want = live ? Store.intervalOf(b) : null;

    var ids = [dayId(b.providerId, b.date)];
    if (prev) {
      var pid = dayId(prev.providerId, prev.date);
      if (ids.indexOf(pid) < 0) ids.push(pid);
    }
    var refs = {};
    ids.forEach(function (id) { refs[id] = db.collection('days').doc(id); });
    var bookingRef = db.collection('bookings').doc(b.ref);

    return db.runTransaction(function (tx) {
      var before = {}, after = {};
      return Promise.all(ids.map(function (id) {
        return tx.get(refs[id]).then(function (snap) {
          var items = snap.exists ? (snap.data().items || []) : [];
          before[id] = items;
          after[id] = items.filter(function (it) { return it.id !== b.id; });   // take this booking out everywhere
        });
      })).then(function () {
        if (live) {
          var home = dayId(b.providerId, b.date);
          var clash = after[home].some(function (it) { return it.start < want.end && want.start < it.end; });
          if (clash) { var err = new Error('slot-unavailable'); err.code = 'slot-unavailable'; throw err; }
          after[home].push({ id: b.id, start: want.start, end: want.end });
        }
        ids.forEach(function (id) {
          if (sameItems(before[id], after[id])) return;                // nothing changed on that day
          var parts = id.split('__');
          tx.set(refs[id], { providerId: parts[0], date: parts[1], items: after[id] });
        });
        tx.set(bookingRef, doc);
      });
    }).then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, error: errCode(e) }; });
  }

  function saveSchedule(obj) {
    return db.collection('schedule').doc('main').set({ json: JSON.stringify(obj), updatedAt: new Date().toISOString() })
      .catch(function (e) { console.warn('[cloud] schedule not saved', e && e.code); });
  }

  /* find a booking by its reference (works for guests who only know the code) */
  function lookup(q) {
    q = String(q || '').trim().toUpperCase();
    if (!/^BK-[A-Z0-9]{6}$/.test(q)) return Promise.resolve([]);
    return db.collection('bookings').doc(q).get()
      .then(function (snap) { return snap.exists ? [snap.data()] : []; })
      .catch(function () { return []; });
  }

  /* ---------------- staff sign-in ---------------- */
  function signInStaff(mail, pass) {
    staffLogin = true;
    return auth.signInWithEmailAndPassword(String(mail || '').trim(), String(pass || ''))
      .then(function (cred) {
        return db.collection('staff').doc(cred.user.uid).get().then(function (snap) {
          if (snap.exists) { writeAdminSession(mail); return { ok: true }; }
          return auth.signOut().then(function () { return { ok: false, error: 'not-staff' }; });
        });
      })
      .catch(function (e) { return { ok: false, error: (e && e.code) || 'error' }; })
      .then(function (r) { staffLogin = false; return r; });
  }
  function signOutStaff() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    return auth.signOut().catch(function () {});
  }

  /* ---------------- listeners ---------------- */
  function detach() { unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = []; }

  function watchDays() {
    if (daysStarted) return;
    daysStarted = true;
    var from = Store.U.todayStr(Store.CLINIC_TZ);
    db.collection('days').where('date', '>=', from).onSnapshot(function (snap) {
      var map = {};
      snap.docs.forEach(function (d) { var v = d.data(); map[d.id] = v.items || []; });
      Store._remote.days(map);
    }, function (e) { console.warn('[cloud] availability not available', e && e.code); });

    db.collection('schedule').doc('main').onSnapshot(function (snap) {
      if (!snap.exists) return;
      var obj = null;
      try { obj = JSON.parse(snap.data().json); } catch (e) {}
      if (obj) Store._remote.schedule(obj);
    }, function () {});
  }

  function watchBookings() {
    detach();
    if (staff) {
      unsubs.push(db.collection('bookings').onSnapshot(function (snap) {
        Store._remote.bookings(snap.docs.map(function (d) { return d.data(); }));
      }, function (e) { console.warn('[cloud] bookings not available', e && e.code); }));
      return;
    }
    var sets = {};
    function merge() {
      var all = {};
      Object.keys(sets).forEach(function (k) { Object.keys(sets[k]).forEach(function (id) { all[id] = sets[k][id]; }); });
      Store._remote.bookings(Object.keys(all).map(function (id) { return all[id]; }));
    }
    function watch(key, query) {
      sets[key] = {};
      unsubs.push(query.onSnapshot(function (snap) {
        var m = {};
        snap.docs.forEach(function (d) { var v = d.data(); m[v.id || d.id] = v; });
        sets[key] = m; merge();
      }, function (e) { console.warn('[cloud] my bookings not available', e && e.code); }));
    }
    watch('uid', db.collection('bookings').where('uid', '==', uid));
    if (email) watch('mail', db.collection('bookings').where('customer.email', '==', email.toLowerCase()));
  }

  /* ---------------- sign-in state ---------------- */
  auth.onAuthStateChanged(function (user) {
    if (!user) {
      staff = false; uid = ''; email = '';
      auth.signInAnonymously().catch(function (e) {
        console.warn('[cloud] anonymous sign-in failed (is Anonymous enabled in Firebase Authentication?)', e && e.code);
        setState('off');
      });
      return;
    }
    uid = user.uid;
    email = user.email || '';
    db.collection('staff').doc(uid).get().then(function (snap) { return snap.exists; }, function () { return false; })
      .then(function (isStaff) {
        // staff stay signed in for this tab / 2 hours only
        if (isStaff && !staffLogin && !adminSessionOk()) { auth.signOut(); return; }
        staff = isStaff;
        watchDays();
        watchBookings();
        setState('on');
        emit();
      });
  });

  setTimeout(function () { if (state === 'connecting') setState('off'); }, CONNECT_TIMEOUT_MS);

  /* ---------------- public API ---------------- */
  NS.cloud = {
    state: function () { return state; },
    isStaff: function () { return staff; },
    uid: function () { return uid; },
    email: function () { return email; },
    pushBooking: pushBooking,
    saveSchedule: saveSchedule,
    lookup: lookup,
    signInStaff: signInStaff,
    signOutStaff: signOutStaff,
    onChange: function (fn) { listeners.push(fn); }
  };
  Store.attachCloud(NS.cloud);
})();
