/* ============================================================
   Northlight Studio — shared database client
   Talks to /api/bookings (Vercel → Supabase). The browser never holds a database key.

   If the API is not reachable or not configured (opened as file://, no env variables yet),
   this file does nothing and the app keeps working exactly as before from localStorage.
   Loaded after store.js and before app.js.
   ============================================================ */
(function () {
  'use strict';

  var NS = window.NS, Store = NS.Store;
  var ENDPOINT = '/api/bookings';
  var REFS_KEY = 'northlight.myrefs.v1';
  var ADMIN_KEY = 'northlight.admin.pass.v1';   // sessionStorage: cleared when the tab closes
  var POLL_MS = 20000;
  var REF_RE = /^BK-[A-Z0-9]{6}$/i;

  var Cloud = { enabled: false, ready: null };
  var adminPass = null;
  var myRefs = [];
  var lastLookup = {};
  var refreshing = null;

  function noop() {}
  function toast(kind, title, msg) {
    try { if (NS.app && NS.app.toast) NS.app.toast(kind, title, msg); } catch (e) {}
  }

  /* ---------------- small storage helpers ---------------- */

  function loadRefs() {
    try { var a = JSON.parse(localStorage.getItem(REFS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveRefs() {
    try { localStorage.setItem(REFS_KEY, JSON.stringify(myRefs.slice(-100))); } catch (e) {}
  }
  function remember(ref) {
    ref = String(ref || '').toUpperCase();
    if (!REF_RE.test(ref) || myRefs.indexOf(ref) >= 0) return;
    myRefs.push(ref);
    saveRefs();
  }
  function knownRefs(extra) {
    var all = myRefs.slice();
    Store.raw().forEach(function (b) { if (b.ref && all.indexOf(String(b.ref).toUpperCase()) < 0) all.push(String(b.ref).toUpperCase()); });
    if (extra && all.indexOf(extra) < 0) all.push(extra);
    return all.slice(-40);
  }

  /* ---------------- transport ---------------- */

  function call(payload) {
    return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = null; try { d = JSON.parse(t); } catch (e) {}
          if (!d) { var ex = new Error('no-service'); ex.code = 'no-service'; throw ex; }
          d.httpStatus = r.status;
          return d;
        });
      });
  }

  /* Google (Firebase) users can prove their email to the server with their ID token.
     This only READS the Firebase session; nothing about the Firebase setup is changed. */
  function fbToken() {
    try {
      if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.getIdToken().catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  function explain(d) {
    var e = d && d.error;
    if (e === 'unauthorized') {
      adminPass = null;
      try { sessionStorage.removeItem(ADMIN_KEY); } catch (x) {}
      toast('bad', 'Staff password not accepted', 'The server rejected it. Check ADMIN_PASSCODE in Vercel.');
      if (window.NSAdmin && window.NSAdmin.lock) window.NSAdmin.lock(true);
    } else if (e === 'admin-not-configured') {
      toast('bad', 'Staff area not set up on the server', 'Add ADMIN_PASSCODE in Vercel Environment Variables, then redeploy.');
    } else if (e === 'slot-taken' || e === 'slot-unavailable') {
      toast('bad', 'Slot already taken', 'Someone else booked that time. The calendar was refreshed.');
    } else if (e === 'not-found') {
      toast('bad', 'Booking not found', 'It is not on the server. The list was refreshed.');
    } else if (e === 'rate-limited') {
      toast('bad', 'Too many requests', 'Please wait a moment and try again.');
    } else {
      toast('bad', 'Could not save', 'The change was not saved. The list was refreshed.');
    }
  }

  /* ---------------- loading ---------------- */

  function loadBusy() {
    return call({ action: 'busy' }).then(function (d) { if (d.ok) Store.applyRemote({ busy: d.busy }); });
  }

  function loadMine(extraRef) {
    return fbToken().then(function (token) {
      var refs = knownRefs(extraRef ? String(extraRef).toUpperCase() : null);
      if (!refs.length && !token) return;
      return call({ action: 'lookup', refs: refs, idToken: token || undefined }).then(function (d) {
        if (!d.ok) return;
        (d.bookings || []).forEach(function (b) { remember(b.ref); });
        Store.applyRemote({ bookings: d.bookings || [], drop: d.missing || [] });
      });
    });
  }

  function loadAdmin() {
    return call({ action: 'admin-list', admin: adminPass }).then(function (d) {
      if (d.ok) Store.applyRemote({ bookings: d.bookings, replace: true, waitlist: d.waitlist });
      else explain(d);
    });
  }

  function refresh() {
    if (!Cloud.enabled) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = Promise.all([loadBusy(), adminPass ? loadAdmin() : loadMine()])
      .catch(noop)
      .then(function () { refreshing = null; });
    return refreshing;
  }

  /* ---------------- API used by store.js ---------------- */

  Cloud.refresh = refresh;

  Cloud.create = function (p) {
    return Cloud.ready.then(function () {
      return call({
        action: 'create', serviceId: p.serviceId, providerId: p.providerId, date: p.date, startMin: p.startMin,
        name: p.name, email: p.email, phone: p.phone, notes: p.notes, reminder: p.reminder, tz: p.tz
      });
    }).then(function (d) {
      if (d.ok && d.booking) { remember(d.booking.ref); return { ok: true, booking: d.booking }; }
      if (d.error === 'slot-unavailable') refresh();
      return { ok: false, error: d.error || 'server' };
    }, function () { return { ok: false, error: 'network' }; });
  };

  /* change made locally first (instant UI), then saved; if the server says no, we resync */
  Cloud.push = function (op, b, extra) {
    var body = { action: op, ref: b.ref };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    if (adminPass) body.admin = adminPass;
    call(body).then(function (d) {
      if (d.ok && d.booking) { Store.applyRemote({ bookings: [d.booking] }); return; }
      explain(d);
      refresh();
    }).catch(function () {
      toast('bad', 'No connection', 'That change may not have been saved. Check your internet.');
    });
  };

  Cloud.pushWaitlist = function (e) {
    call({ action: 'waitlist', serviceId: e.serviceId, providerId: e.providerId, date: e.date, email: e.email, name: e.name }).catch(noop);
  };

  Cloud.importMany = function (bookings, wait) {
    if (!adminPass) return;
    call({ action: 'admin-import', admin: adminPass, bookings: bookings, waitlist: wait })
      .then(function (d) { if (!d.ok) explain(d); return refresh(); })
      .catch(function () { toast('bad', 'No connection', 'Demo data was not saved to the shared database.'); });
  };

  /* look a reference (or the signed-in owner's email) up in the background */
  Cloud.lookup = function (q) {
    var key = String(q).toLowerCase(), now = Date.now();
    if (lastLookup[key] && now - lastLookup[key] < 15000) return;
    lastLookup[key] = now;
    Cloud.ready.then(function () {
      if (!Cloud.enabled || adminPass) return;
      return loadMine(REF_RE.test(q) ? q : null);
    }).catch(noop);
  };
  Cloud.lookupRef = function (ref) {
    return Cloud.ready.then(function () {
      if (!Cloud.enabled) return null;
      return loadMine(REF_RE.test(ref) ? ref : null);
    }).catch(noop);
  };

  /* ---------------- staff ---------------- */

  Cloud.setAdmin = function (pass) {
    adminPass = pass;
    try { sessionStorage.setItem(ADMIN_KEY, pass); } catch (e) {}
    return Cloud.ready.then(refresh);
  };
  Cloud.clearAdmin = function () {
    adminPass = null;
    try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
    // staff device: stop holding every customer's details once signed out
    Store.applyRemote({ only: myRefs });
  };

  /* ---------------- start ---------------- */

  function start() {
    try { adminPass = sessionStorage.getItem(ADMIN_KEY) || null; } catch (e) { adminPass = null; }
    var firstRun = true;
    try { firstRun = localStorage.getItem(REFS_KEY) === null; } catch (e) {}
    myRefs = loadRefs();
    if (firstRun) Store.raw().forEach(function (b) { remember(b.ref); });   // adopt bookings already on this device
    else if (!adminPass) Store.applyRemote({ only: myRefs });                // never keep staff-loaded customers around

    if (window.location && window.location.protocol === 'file:') { Cloud.ready = Promise.resolve(); return; }

    Cloud.ready = call({ action: 'busy' }).then(function (d) {
      if (!d.ok) { if (window.console) console.info('Shared database is off (' + (d.error || d.httpStatus) + '); using this device only.'); return; }
      Cloud.enabled = true;
      Store.applyRemote({ busy: d.busy });
      return refresh();
    }).catch(function () { /* offline or no API: stay in local mode */ }).then(function () {
      if (!Cloud.enabled) return;
      var t = setInterval(function () {
        if (!document.visibilityState || document.visibilityState !== 'hidden') refresh();
      }, POLL_MS);
      if (t && t.unref) t.unref();
      if (document.addEventListener) document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refresh();
      });
      // when Google sign-in finishes (or ends) pick up that person's bookings
      var tries = 0, w = setInterval(function () {
        if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
          clearInterval(w);
          try { window.firebase.auth().onAuthStateChanged(function () { refresh(); }); } catch (e) {}
        } else if (++tries > 20) clearInterval(w);
      }, 500);
      if (w && w.unref) w.unref();
    });
  }

  Store.sync = Cloud;
  NS.Cloud = Cloud;
  start();
})();
