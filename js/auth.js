/* ============================================================
   Northlight Studio — authentication gate
   Front-end only. Sessions live in localStorage; the OAuth flows
   are SIMULATED stand-ins for real providers (see README).
   ============================================================ */
(function () {
  'use strict';

  var NS = window.NS, U = NS.U, Prefs = NS.Prefs;
  // false = customers can book as guests (signing in is optional and only auto-fills the form).
  // true  = a signed-in session is required to start and confirm a booking.
  var REQUIRE_LOGIN = true;
  var SESSION_KEY = 'northlight.session.v1';
  var ACCOUNTS_KEY = 'northlight.accounts.v1';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  var $ = function (id) { return document.getElementById(id); };

  // emails of the old built-in fake accounts; removed from storage on load
  var FAKE_EMAILS = ['maria.santos@gmail.com', 'juan.delacruz@gmail.com', 'ana.reyes@icloud.com'];

  var session = null;
  var accounts = [];
  var deepLink = /[?&]ref=/.test(location.search);
  var entered = false;

  /* ---------------- storage ---------------- */

  function read(k, d) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : d; }
    catch (e) { return d; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------------- session ---------------- */

  function initialsOf(n) {
    var parts = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }

  function makeSession(p) {
    return {
      id: 'us_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: String(p.name || '').trim(),
      email: String(p.email || '').trim().toLowerCase(),
      provider: p.provider || 'password',
      initials: initialsOf(p.name),
      createdAt: new Date().toISOString()
    };
  }

  function isSignedIn() { return !!(session && session.email); }
  function current() { return session; }

  function startSession(s) {
    session = s;
    write(SESSION_KEY, s);
    Prefs.set({ name: s.name, email: s.email, provider: s.provider });
    renderBadge();
    if (NS.app && NS.app.prefillFromSession) NS.app.prefillFromSession(s);
  }

  function signOut() {
    if (typeof fbReady !== 'undefined' && fbReady) { try { firebase.auth().signOut(); } catch (e) {} }
    session = null;
    drop(SESSION_KEY);
    renderBadge();
    if (NS.app && NS.app.clearSessionFields) NS.app.clearSessionFields();
    if (NS.app && NS.app.closeModal) NS.app.closeModal();
    showScreen(REQUIRE_LOGIN ? 'auth' : 'app');   // optional login: stay on the site after sign out
    toast('ok', 'Signed out', 'Your details were cleared from the booking form.');
  }

  /* ---------------- accounts (simulated email sign-up) ---------------- */

  function loadAccounts() { accounts = read(ACCOUNTS_KEY, []); return accounts; }
  function saveAccounts() { write(ACCOUNTS_KEY, accounts); }

  function findAccount(email) {
    var e = String(email || '').trim().toLowerCase();
    for (var i = 0; i < accounts.length; i++) if (accounts[i].email === e) return accounts[i];
    return null;
  }

  /* ---------------- screens ---------------- */

  function showScreen(name, tabName) {
    var bento = document.querySelector('.bento');
    var auth = $('screenAuth');
    if (!bento || !auth) return;
    if (name === 'auth') {
      bento.hidden = true;
      auth.hidden = false;
      if (tabName) setTab(tabName);
      document.documentElement.setAttribute('data-view', 'auth');
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
      var first = auth.querySelector('.auth-tab[aria-selected="true"]');
      if (first && !tabName) first.focus();
    } else {
      auth.hidden = true;
      bento.hidden = false;
    }
  }

  function setTab(which) {
    var signin = $('signinForm'), create = $('createForm');
    if (!signin || !create) return;
    var isSignin = which === 'signin';
    signin.hidden = !isSignin;
    create.hidden = isSignin;
    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (b) {
      b.setAttribute('aria-selected', (b.getAttribute('data-atab') === which) ? 'true' : 'false');
    });
    clearErrors();
    var target = isSignin ? $('signEmail') : $('createName');
    if (target) target.focus();
  }

  /* ---------------- gate ---------------- */

  /* true = this view needs a signed-in user */
  function gate(view) {
    // Signed-out visitors may browse the whole landing page — the landing keeps
    // its "Start a booking" call to action. The staff dashboard is walled off
    // outright and every booking confirmation is guarded at submit time.
    if (isSignedIn()) return false;
    return REQUIRE_LOGIN && view === 'book';   // admin has its own staff sign-in (js/admin.js)
  }

  function applyGate() {
    var app = document.getElementById('main');
    var scr = $('screenAuth');
    if (isSignedIn()) {
      if (scr) scr.hidden = true;
      if (app) app.hidden = false;
      renderBadge();
      return;
    }
    // Signed out: if the auth screen is closed, make sure the landing is visible;
    // if it is open, leave the app hidden underneath so the two never overlap.
    if (scr && scr.hidden && app) app.hidden = false;
    renderBadge();
  }

  function enterApp(user) {
    entered = true;
    if (user) startSession(user);
    showScreen('app');
    if (NS.app && NS.app.setView) NS.app.setView('book');
    renderBadge();
  }

  /* ---------------- rendering ---------------- */

  function renderBadge() {
    document.documentElement.setAttribute('data-auth', isSignedIn() ? 'in' : 'out');
    var b = $('userBadge');
    if (!b) return;
    if (!isSignedIn()) {
      b.hidden = false;                      // signed out: offer a Sign in button
      b.innerHTML = '<span class="user-badge-av ghost" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></span><span class="user-badge-name">Sign in</span>';
      b.title = REQUIRE_LOGIN ? 'Sign in or create an account to book' : 'Sign in with Google (optional) to fill in your details automatically';
      return;
    }
    b.hidden = false;
    b.innerHTML = '<span class="user-badge-av" aria-hidden="true">' + U.escapeHtml(session.initials) + '</span>' +
                  '<span class="user-badge-name">' + U.escapeHtml(session.name.split(/\s+/)[0]) + '</span>';
    b.title = session.email + ' · signed in with ' + session.provider;
  }

  function openAccount() {
    if (!isSignedIn()) { showScreen('auth', 'signin'); return; }
    var body = '<div class="ticket">' +
      '<div class="ticket-row"><span>Name</span><strong>' + U.escapeHtml(session.name) + '</strong></div>' +
      '<div class="ticket-row"><span>Email</span><strong>' + U.escapeHtml(session.email) + '</strong></div>' +
      '<div class="ticket-row"><span>Signed in with</span><strong>' + U.escapeHtml(session.provider) + '</strong></div>' +
      '<div class="ticket-row"><span>Since</span><strong>' + U.escapeHtml(new Date(session.createdAt).toLocaleString()) + '</strong></div>' +
      '</div>' +
      '';
    NS.app.openModal('Your account', body, [
      { label: 'My bookings', cls: 'btn-primary', onClick: function () { NS.app.closeModal(); NS.app.setView('mine'); } },
      { label: 'Sign out', cls: 'btn-ghost', onClick: signOut },
      { label: 'Close', cls: 'btn-ghost', onClick: NS.app.closeModal }
    ]);
  }

  /* ---------------- validation ---------------- */

  function err(id, spanId, msg, show) {
    var el = $(id), s = $(spanId);
    if (!el || !s) return !msg;
    if (show && msg) { el.setAttribute('aria-invalid', 'true'); s.textContent = msg; }
    else { el.removeAttribute('aria-invalid'); s.textContent = ''; }
    return !msg;
  }
  function clearErrors() {
    document.querySelectorAll('.screen .err').forEach(function (e) { e.textContent = ''; });
    document.querySelectorAll('.screen [aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
  }

  /* ---------------- Firebase Google sign-in ---------------- */

  var fbReady = false;
  if (window.firebase) {
    try {
      firebase.initializeApp({
        apiKey: 'AIzaSyC9FIRICq1Bi_TPpRHJd-7UU5y3IMyo-oo',
        authDomain: 'northlight-cc676.firebaseapp.com',
        projectId: 'northlight-cc676',
        appId: '1:396281308025:web:81a29addfb8088991745a8'
      });
      fbReady = true;
    } catch (e) { fbReady = false; }
  }

  function finishGoogleUser(u) {
    var user = makeSession({ name: u.displayName || u.email, email: u.email, provider: 'google' });
    if (!findAccount(user.email)) {
      accounts.push({ name: user.name, email: user.email, provider: 'google', createdAt: user.createdAt });
      saveAccounts();
    }
    enterApp(user);
    toast('ok', 'Signed in with Google', user.email);
  }

  function inAppBrowser() {
    return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|Snapchat|TikTok/i.test(navigator.userAgent);
  }

  function googleSignIn() {
    if (!fbReady) {
      toast('bad', 'Google sign-in unavailable', 'Could not load Google sign-in. Check your connection and reload.');
      return;
    }
    if (inAppBrowser()) {
      toast('bad', 'Open in Chrome or Safari',
        'Google blocks sign-in inside Facebook/Messenger browsers. Tap ... and choose Open in browser.');
      return;
    }
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    provider.setCustomParameters({ prompt: 'select_account' });  // always show the account list

    function fail(e) {
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      if (e && e.code === 'auth/unauthorized-domain') {
        toast('bad', 'Domain not authorised',
          location.hostname + ' must be added in Firebase Console > Authentication > Settings > Authorized domains.');
        return;
      }
      if (e && e.code === 'auth/network-request-failed') {
        toast('bad', 'No connection', 'Check your internet and try again.');
        return;
      }
      toast('bad', 'Google sign-in failed', (e && e.message) || 'Unknown error');
    }

    // Popup first on every device. On phones it opens Google's account chooser in a
    // new tab and returns here. It is called straight from the tap, so it is not blocked.
    // Redirect is only the fallback: modern mobile browsers partition storage, which
    // makes redirect results unreliable when authDomain differs from this site.
    firebase.auth().signInWithPopup(provider)
      .then(function (res) { finishGoogleUser(res.user); })
      .catch(function (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
          firebase.auth().signInWithRedirect(provider).catch(fail);
          return;
        }
        fail(e);
      });
  }

  /* back from the Google redirect (mobile): finish the sign-in */
  function handleRedirectResult() {
    if (!fbReady) return;
    firebase.auth().getRedirectResult()
      .then(function (res) { if (res && res.user) finishGoogleUser(res.user); })
      .catch(function (e) { toast('bad', 'Google sign-in failed', e.message); });
  }

  /* ---------------- Gmail one-time code (serverless /api + Brevo) ---------------- */

  var GMAIL_RE = /^[a-z0-9.]{6,30}@(gmail|googlemail)\.com$/i;
  var otp = { token: '', email: '', name: '', timer: null };

  function prettyName(email) {
    return String(email).split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || 'Guest';
  }

  function otpPost(path, payload) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = null; try { d = JSON.parse(t); } catch (e) {}
          if (!d) { var ex = new Error('no-service'); ex.code = 'no-service'; throw ex; }
          d.status = r.status; return d;
        });
      });
  }

  function otpBody() { return $('modalBody'); }
  function stopTimer() { if (otp.timer) { clearInterval(otp.timer); otp.timer = null; } }

  function openOtp() {
    stopTimer();
    var body = '<form id="otpForm1" class="auth-form" novalidate>' +
      '<p class="muted sm">Enter your Gmail address. We will email you a 6-digit code.</p>' +
      '<div class="field"><label for="otpName">Your name <span class="muted">(optional)</span></label>' +
      '<input class="input" id="otpName" type="text" autocomplete="name" placeholder="Jane Smith" value="' + U.escapeHtml(otp.name) + '" /></div>' +
      '<div class="field"><label for="otpEmail">Gmail address</label>' +
      '<input class="input" id="otpEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="yourname@gmail.com" value="' + U.escapeHtml(otp.email) + '" /></div>' +
      '<p class="err" id="otpErr" role="alert"></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="otpSend">Send code</button></form>';
    NS.app.openModal('Sign in with Gmail', body, []);
    var f = $('otpForm1');
    f.addEventListener('submit', function (e) { e.preventDefault(); sendCode(false); });
    setTimeout(function () { var el = $('otpEmail'); if (el) el.focus(); }, 50);
  }

  function otpError(msg) { var el = $('otpErr'); if (el) el.textContent = msg || ''; }

  function sendCode(isResend) {
    var email = isResend ? otp.email : ($('otpEmail').value || '').trim().toLowerCase();
    var name = isResend ? otp.name : ($('otpName').value || '').trim();
    if (!GMAIL_RE.test(email)) { otpError('Enter a valid Gmail address (name@gmail.com).'); return; }
    var btn = $(isResend ? 'otpResend' : 'otpSend');
    if (btn) btn.disabled = true;
    otpError('');
    otpPost('/api/send-otp', { email: email, name: name }).then(function (d) {
      if (!d.ok) {
        var map = {
          'invalid-email': 'That does not look like a Gmail address.',
          'not-configured': 'Email codes are not set up on this site yet.',
          'send-failed': 'We could not send the email. Please try again in a moment.'
        };
        otpError(map[d.error] || 'Something went wrong. Please try again.');
        if (btn) btn.disabled = false;
        return;
      }
      otp.token = d.token; otp.email = email; otp.name = name;
      showCodeStep(d.masked || email, d.cooldown || 30, isResend);
    }).catch(function (e) {
      otpError(e && e.code === 'no-service'
        ? 'Email codes only work on the live site (Vercel), not when opened as a plain file.'
        : 'No connection. Check your internet and try again.');
      if (btn) btn.disabled = false;
    });
  }

  function showCodeStep(masked, cooldown, isResend) {
    stopTimer();
    var body = '<form id="otpForm2" class="auth-form" novalidate>' +
      '<p class="muted sm">We sent a 6-digit code to <strong>' + U.escapeHtml(masked) + '</strong>. It expires in 5 minutes. Check Spam if you do not see it.</p>' +
      '<div class="field"><label for="otpCode">6-digit code</label>' +
      '<input class="input otp-input" id="otpCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="••••••" /></div>' +
      '<p class="err" id="otpErr" role="alert"></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="otpVerify">Verify &amp; sign in</button>' +
      '<p class="auth-note"><button type="button" class="link-btn" id="otpResend" disabled>Resend code</button> ' +
      '<span id="otpWait"></span> · <button type="button" class="link-btn" id="otpOther">Use another Gmail</button></p></form>';
    NS.app.openModal('Enter your code', body, []);
    $('otpForm2').addEventListener('submit', function (e) { e.preventDefault(); verifyCode(); });
    $('otpOther').addEventListener('click', function () { otp.token = ''; openOtp(); });
    $('otpResend').addEventListener('click', function () { sendCode(true); });
    $('otpCode').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
    var left = cooldown;
    function tick() {
      var rs = $('otpResend'), w = $('otpWait');
      if (!rs) { stopTimer(); return; }
      if (left > 0) { rs.disabled = true; w.textContent = '(' + left + 's)'; left--; }
      else { rs.disabled = false; w.textContent = ''; stopTimer(); }
    }
    tick(); otp.timer = setInterval(tick, 1000);
    setTimeout(function () { var el = $('otpCode'); if (el) el.focus(); }, 50);
    if (isResend) toast('ok', 'New code sent', 'Check ' + masked + '.');
  }

  function verifyCode() {
    var code = ($('otpCode').value || '').trim();
    if (!/^\d{6}$/.test(code)) { otpError('Enter the 6-digit code.'); return; }
    var btn = $('otpVerify'); btn.disabled = true; otpError('');
    otpPost('/api/verify-otp', { email: otp.email, code: code, token: otp.token }).then(function (d) {
      if (d.ok) {
        stopTimer();
        var user = makeSession({ name: otp.name || prettyName(otp.email), email: otp.email, provider: 'gmail-code' });
        if (!findAccount(user.email)) {
          accounts.push({ name: user.name, email: user.email, provider: 'gmail-code', createdAt: user.createdAt });
          saveAccounts();
        }
        NS.app.closeModal();
        enterApp(user);
        toast('ok', 'Signed in', user.email);
        return;
      }
      var map = {
        'wrong-code': 'That code is not right. Check the email and try again.',
        'expired': 'This code has expired. Tap Resend code to get a new one.',
        'no-code': 'Please request a new code.',
        'invalid-code': 'Enter the 6-digit code.'
      };
      otpError(map[d.error] || 'Could not verify. Please try again.');
      btn.disabled = false;
      var el = $('otpCode'); if (el) { el.select(); }
    }).catch(function () { otpError('No connection. Check your internet and try again.'); btn.disabled = false; });
  }

  /* ---------------- wiring ---------------- */

  function submitSignin(e) {
    e.preventDefault();
    var email = $('signEmail').value.trim(), pass = $('signPass').value;
    var ok = true;
    ok = err('signEmail', 'errSignEmail', !email ? 'Enter your email address.'
      : (!EMAIL_RE.test(email) ? 'That email address does not look right.' : ''), true) && ok;
    ok = err('signPass', 'errSignPass', pass.length < 6 ? 'Enter your password (6+ characters).' : '', true) && ok;
    if (!ok) return;

    var acct = findAccount(email);
    if (!acct) {
      err('signEmail', 'errSignEmail', 'No account for that email on this device — create one instead.', true);
      return;
    }
    var user = makeSession({ name: acct.name, email: acct.email, provider: acct.provider || 'password' });
    enterApp(user);
    toast('ok', 'Welcome back', 'Signed in as ' + user.email + '.');
  }

  function submitCreate(e) {
    e.preventDefault();
    var name = $('createName').value.trim(), email = $('createEmail').value.trim();
    var pass = $('createPass').value, conf = $('createConfirm').value, terms = $('createTerms').checked;
    var ok = true;
    ok = err('createName', 'errCreateName', name.length < 2 ? 'Enter your full name (2+ characters).' : '', true) && ok;
    ok = err('createEmail', 'errCreateEmail', !EMAIL_RE.test(email) ? 'Enter a valid email address.' : '', true) && ok;
    ok = err('createPass', 'errCreatePass', pass.length < 6 ? 'Use at least 6 characters.' : '', true) && ok;
    ok = err('createConfirm', 'errCreateConfirm', pass !== conf ? 'Those passwords do not match.' : '', true) && ok;
    ok = err('createTerms', 'errCreateTerms', terms ? '' : 'Please accept the terms to continue.', true) && ok;
    if (!ok) return;

    if (findAccount(email)) {
      err('createEmail', 'errCreateEmail', 'That email already has an account — sign in instead.', true);
      return;
    }
    var user = makeSession({ name: name, email: email, provider: 'password' });
    accounts.push({ name: user.name, email: user.email, provider: 'password', createdAt: user.createdAt });
    saveAccounts();
    enterApp(user);
    toast('ok', 'Account created', 'Welcome, ' + user.name.split(/\s+/)[0] + '. You can book now.');
  }

  function forgot(e) {
    e.preventDefault();
    var email = $('signEmail').value.trim();
    toast('ok', 'Reset link sent (demo)', email ? 'A pretend reset email went to ' + email + '.' : 'Enter your email first.');
  }

  function guest() {
    entered = true;
    showScreen('app');
    if (NS.app && NS.app.setView) NS.app.setView('mine');
    toast('ok', 'Browsing as guest', 'Find a booking by email or reference. Sign in to book.');
  }

  function toast(kind, title, msg) {
    if (NS.app && NS.app.toast) NS.app.toast(kind, title, msg);
  }

  function init() {
    if (!$('screenAuth')) return;
    loadAccounts();
    // purge the old fake demo accounts (and a session left over from one)
    var before = accounts.length;
    accounts = accounts.filter(function (a) { return FAKE_EMAILS.indexOf(String(a.email).toLowerCase()) < 0; });
    if (accounts.length !== before) saveAccounts();
    session = read(SESSION_KEY, null);
    if (session && FAKE_EMAILS.indexOf(String(session.email).toLowerCase()) >= 0) { drop(SESSION_KEY); session = null; }
    renderBadge();
    // returning visitor with a saved session: put their account details back in the booking form
    if (session && NS.app && NS.app.prefillFromSession) NS.app.prefillFromSession(session);

    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-atab')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-provider]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-provider');
        if (p === 'google') googleSignIn();
      });
    });
    if ($('gmailOtpBtn')) $('gmailOtpBtn').addEventListener('click', openOtp);
    handleRedirectResult();
    if ($('signinForm')) $('signinForm').addEventListener('submit', submitSignin);
    if ($('createForm')) $('createForm').addEventListener('submit', submitCreate);
    if ($('forgotLink')) $('forgotLink').addEventListener('click', forgot);
    if ($('guestLink')) $('guestLink').addEventListener('click', guest);
    if ($('userBadge')) $('userBadge').addEventListener('click', openAccount);
    if ($('authToSignup')) $('authToSignup').addEventListener('click', function () { setTab('create'); });
    if ($('authToSignin')) $('authToSignin').addEventListener('click', function () { setTab('signin'); });

    function backToSite() {
      var scr = $('screenAuth'); if (scr) scr.hidden = true;
      var app = document.getElementById('main'); if (app) app.hidden = false;
      if (NS.app && NS.app.setView) NS.app.setView(isSignedIn() ? 'book' : 'mine', { force: true });   // signed out: back to Find my booking
    }
    if ($('authBack')) $('authBack').addEventListener('click', backToSite);
    if ($('authBack2')) $('authBack2').addEventListener('click', backToSite);

    // A booking cannot be confirmed without a session: intercept the submit
    // button in the capture phase, before the booking handler sees it.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest('#submitBtn')) return;
      if (isSignedIn() || !REQUIRE_LOGIN) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showScreen('auth', 'signin');
      toast('warn', 'Sign in to confirm', 'Your slot is held — sign in and we will finish the booking.');
    }, true);

    if (deepLink) entered = true;
    applyGate();
    NS.Events.on('change', function () { if (!isSignedIn() && !deepLink && !entered) applyGate(); });
  }

  window.NSAuth = { session: current, signOut: signOut, showScreen: showScreen, setTab: setTab, isSignedIn: isSignedIn };
  NS.auth = window.NSAuth;
  NS.auth.session = current;
  NS.auth.gate = gate;
  NS.auth.requireLogin = REQUIRE_LOGIN;
  NS.auth.showScreen = showScreen;
  NS.auth.isSignedIn = isSignedIn;
  NS.auth.signOut = signOut;
  NS.auth.applyGate = applyGate;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();