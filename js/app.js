/* ============================================================
   Northlight Studio — booking interface
   Wizard · calendar · slot engine UI · validation · confirmation
   lookup / reschedule / cancel · reminders · deep links
   ============================================================ */
(function () {
  'use strict';

  var NS = window.NS, Store = NS.Store, U = NS.U, Prefs = NS.Prefs;
  var SERVICES = NS.SERVICES, PROVIDERS = NS.PROVIDERS, CLINIC_TZ = NS.CLINIC_TZ;
  function tzLabel(z) { return z === 'Asia/Manila' ? 'Philippine Time (PHT)' : z; }

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: 'book',
    tz: CLINIC_TZ,
    serviceId: null,
    providerId: null,
    date: null,
    startMin: null,
    calY: 0,
    calM: 0,
    lookup: '',
    mineTab: 'upcoming',
    notify: false
  };
  NS.state = state;

  var fired = {};
  var clockTimer = null;

  /* ============================================================
     boot
     ============================================================ */
  function init() {
    var prefs = Prefs.all();
    state.tz = prefs.tzPick || CLINIC_TZ;   // Philippine time unless the customer picks another zone
    if (U.zoneList().indexOf(state.tz) < 0) state.tz = CLINIC_TZ;
    state.serviceId = prefs.serviceId || null;
    if (state.serviceId && !NS.Store.serviceById(state.serviceId)) state.serviceId = null;
    state.providerId = prefs.providerId || null;
    state.notify = !!prefs.notify;

    var today = U.todayStr(CLINIC_TZ), p = U.parseDateStr(today);
    state.calY = p.y; state.calM = p.m;

    buildTzSelect();
    buildServices();
    buildProviders();
    buildCalendarShell();
    buildPolicy();
    wireTopbar();
    wireBookingForm();
    wireMine();
    wireMineTabs();

    if (state.serviceId && !NS.Store.providersFor(state.serviceId).some(function (x) { return x.id === state.providerId; })) {
      state.providerId = null;
    }

    // Apply the active view BEFORE the first paint. Without this the "my bookings"
    // and admin tiles render alongside the booking tiles, and the bento grid packs
    // three different views into one ragged layout.
    // Every visit starts on the landing: signed-out visitors land on "Find my booking",
    // signed-in customers land on booking. The last-used tab is not restored.
    var hasSession = false;
    try { var ss = JSON.parse(localStorage.getItem('northlight.session.v1') || 'null'); hasSession = !!(ss && ss.email); } catch (e) {}
    setView(hasSession ? 'book' : 'mine', { silent: true, force: true });
    renderAll();
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
    setInterval(checkReminders, 30000);

    Store.on('change', function () { renderAll(); if (state.view === 'admin') window.NSAdmin && window.NSAdmin.render(); });
    Store.startSync();

    handleDeepLink();

    var prefs2 = Prefs.all();
    if (prefs2.name) $('bkName').value = prefs2.name;
    if (prefs2.email) $('bkEmail').value = prefs2.email;
    if (prefs2.phone) $('bkPhone').value = prefs2.phone;
    // paint the submit button / step chip / hints on load without
    // showing "required" errors on a form the user has not touched yet
    validateForm(true);
  }

  /* ============================================================
     top bar / views
     ============================================================ */
  function setView(view, opts) {
    opts = opts || {};
    // The auth gate (js/auth.js, loaded after this file) owns the sign-in wall:
    // booking and the admin dashboard need a session, booking lookup does not.
    if (!opts.force && NS.auth && NS.auth.gate && NS.auth.gate(view)) {
      NS.auth.showScreen('auth', 'signin');
      return;
    }
    state.view = view;
    document.documentElement.setAttribute('data-view', view);
    Prefs.set({ view: view });
    Array.prototype.forEach.call(document.querySelectorAll('.tile'), function (t) {
      var views = (t.getAttribute('data-views') || '').split(/\s+/);
      t.hidden = views.indexOf(view) < 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      if (b.getAttribute('data-goto') === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('tabs').classList.remove('open');
    if (view === 'admin') window.NSAdmin && window.NSAdmin.render();
    if (view === 'mine') renderMine();
    if (!opts.silent) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function wireTopbar() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-goto')); });
    });
    var startBtn = $('startBooking');
    if (startBtn) startBtn.addEventListener('click', requireAuth);
    $('themeToggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      Prefs.set({ theme: cur });
      if (window.NSTheme) window.NSTheme.apply();
    });
    $('navToggle').addEventListener('click', function () {
      var open = $('tabs').classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modalBack').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  /* "Start a booking" — the gate the whole booking flow passes through. */
  function requireAuth() {
    if (NS.auth && NS.auth.isSignedIn && NS.auth.isSignedIn()) {
      setView('book', { force: true });   // already signed in: just open booking, no toast
      return;
    }
    if (NS.auth && NS.auth.requireLogin && NS.auth.showScreen) { NS.auth.showScreen('auth', 'signin'); return; }
    setView('book', { force: true });   // guests can book without signing in
  }

  /* Prefill the booking form from a verified session. */
  function prefillFromSession(user) {
    if (!user) return;
    var nm = user.name || '';
    if (nm.indexOf('@') > -1) {            // no display name from Google: derive one from the address
      nm = nm.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    if (nm) $('bkName').value = nm;
    if (user.email) { $('bkEmail').value = user.email; lockEmail(true, user.provider); }
    validateForm(true);
  }

  /* While signed in, the booking email is the account email and cannot be edited. */
  function lockEmail(on, provider) {
    var el = $('bkEmail');
    if (!el) return;
    el.readOnly = !!on;
    el.style.opacity = on ? '.85' : '';
    el.style.cursor = on ? 'not-allowed' : '';
    var hint = $('bkEmailHint');
    if (on) {
      if (!hint) {
        hint = document.createElement('small');
        hint.id = 'bkEmailHint';
        hint.className = 'muted sm';
        el.parentNode.appendChild(hint);
      }
      hint.textContent = 'Linked to your ' + (provider === 'google' ? 'Google' : 'signed-in') +
        ' account. Sign out to book with a different email.';
    } else if (hint) {
      hint.remove();
    }
  }

  /* Sign-out: unlock the form and drop the previous person's details. */
  function clearSessionFields() {
    lockEmail(false);
    ['bkName', 'bkEmail', 'bkPhone'].forEach(function (id) { if ($(id)) $(id).value = ''; });
    Prefs.set({ name: '', email: '', phone: '' });
    validateForm(true);
  }

  function buildTzSelect() {
    var zones = U.zoneList();
    var common = ['Asia/Manila', 'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Lisbon', 'Europe/Stockholm',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
      'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
    common = common.filter(function (z) { return zones.indexOf(z) >= 0; });
    var all = common.concat(zones.filter(function (z) { return common.indexOf(z) < 0; }));
    var btn = $('tzBtn'), sheet = $('tzSheet'), list = $('tzList'), search = $('tzSearch');

    function shortLabel(z) { return z === 'Asia/Manila' ? 'PHT' : z.replace(/_/g, ' ').split('/').pop(); }
    function paintBtn() { $('tzBtnLabel').textContent = shortLabel(state.tz); btn.title = tzLabel(state.tz); }
    function paintList() {
      var q = search.value.trim().toLowerCase().replace(/\s+/g, '_');
      var rows = all.filter(function (z) { return !q || z.toLowerCase().indexOf(q) >= 0 || tzLabel(z).toLowerCase().indexOf(q.replace(/_/g, ' ')) >= 0; });
      list.innerHTML = rows.length ? rows.map(function (z) {
        return '<button type="button" class="sheet-row" role="radio" aria-checked="' + (z === state.tz) + '" data-z="' + U.escapeHtml(z) + '">' +
          '<span>' + U.escapeHtml(tzLabel(z).replace(/_/g, ' ')) + '</span><i aria-hidden="true"></i></button>';
      }).join('') : '<p class="empty sm">No matching timezone.</p>';
    }
    function open() { search.value = ''; paintList(); sheet.hidden = false; document.body.classList.add('no-scroll');
      var on = list.querySelector('[aria-checked="true"]'); if (on) on.scrollIntoView({ block: 'center' }); }
    function close() { sheet.hidden = true; document.body.classList.remove('no-scroll'); }

    btn.addEventListener('click', open);
    $('tzBack').addEventListener('click', close);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) close(); });
    search.addEventListener('input', paintList);
    list.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('[data-z]');
      if (!row) return;
      state.tz = row.getAttribute('data-z');
      Prefs.set({ tzPick: state.tz });
      paintBtn(); close(); renderAll();
    });
    paintBtn();
  }

  /* ============================================================
     step 1 — services
     ============================================================ */
  function buildServices() {
    var wrap = $('serviceList');
    wrap.innerHTML = SERVICES.map(function (s) {
      var mins = s.minutes >= 60 ? (s.minutes / 60) + ' hr' : s.minutes + ' min';
      return '<button type="button" class="service" role="checkbox" aria-checked="false" data-service="' + s.id + '">' +
        '<span class="service-top"><span class="service-emoji" aria-hidden="true">' + s.emoji + '</span>' + U.escapeHtml(s.name) + '</span>' +
        '<span class="service-blurb">' + U.escapeHtml(s.blurb) + '</span>' +
        '<span class="service-meta"><span class="pill">' + mins + '</span>' +
        '<span class="pill price">' + (s.price ? U.money(s.price) : 'Free') + '</span>' +
        '<span class="pill">+' + s.buffer + 'm turnaround</span></span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-service]'), function (b) {
      b.addEventListener('click', function () { pickService(b.getAttribute('data-service')); });
    });
  }

  function pickService(id) {
    var parts = Store.serviceParts(state.serviceId);
    var has = parts.indexOf(id) >= 0;
    var next = has ? parts.filter(function (x) { return x !== id; }) : parts.concat([id]);
    var newId = next.length ? Store.bundleId(next) : null;
    if (newId && !Store.providersFor(newId).length) {
      toast('bad', 'Cannot combine these', 'No specialist does all of them in one visit, so only ' + Store.serviceById(id).name + ' is selected.');
      newId = id;
    }
    state.serviceId = newId;
    if (state.serviceId) {
      var pool = Store.providersFor(state.serviceId);
      if (!pool.some(function (p) { return p.id === state.providerId; })) state.providerId = null;
    }
    state.startMin = null;
    Prefs.set({ serviceId: state.serviceId, providerId: state.providerId });
    renderAll();
  }

  /* ============================================================
     step 2 — providers
     ============================================================ */
  function buildProviders() {
    var wrap = $('providerList');
    wrap.innerHTML = PROVIDERS.map(function (p) {
      var role = p.role + ' · ' + p.services.length + ' services';
      return '<button type="button" class="provider" role="radio" aria-checked="false" data-provider="' + p.id + '">' +
        '<span class="avatar" style="background:' + p.color + '" aria-hidden="true">' + p.initials + '</span>' +
        '<span><span class="provider-name">' + U.escapeHtml(p.name) + '</span><br><span class="provider-role">' + U.escapeHtml(role) + '</span><br><span class="provider-rating" data-rating="' + p.id + '"></span></span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-provider]'), function (b) {
      b.addEventListener('click', function () { pickProvider(b.getAttribute('data-provider')); });
    });
  }

  function pickProvider(id) {
    var p = Store.providerById(id);
    if (!p) return;
    if (state.serviceId && !Store.canDeliver(p, state.serviceId)) {
      toast('bad', 'Not offered', p.name + ' does not deliver that service.');
      return;
    }
    state.providerId = (state.providerId === id) ? null : id;
    state.startMin = null;
    Prefs.set({ providerId: state.providerId });
    renderAll();
  }

  function paintServices() {
    var chosen = Store.serviceParts(state.serviceId);
    Array.prototype.forEach.call(document.querySelectorAll('[data-service]'), function (b) {
      b.setAttribute('aria-checked', chosen.indexOf(b.getAttribute('data-service')) >= 0 ? 'true' : 'false');
    });
    var s = Store.serviceById(state.serviceId);
    var chip = $('serviceChip');
    chip.textContent = s ? (chosen.length > 1 ? chosen.length + ' services · ' + s.minutes + ' min' : s.name) : 'nothing selected';
    chip.className = 'chip' + (s ? ' on' : '');
  }

  function paintProviders() {
    var wrap = $('providerList'), s = Store.serviceById(state.serviceId);
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-provider]'), function (b) {
      var p = Store.providerById(b.getAttribute('data-provider'));
      var offers = !state.serviceId || Store.canDeliver(p, state.serviceId);
      var rt = Store.ratingFor(p.id), rEl = b.querySelector('[data-rating]');
      if (rEl) rEl.textContent = rt.count ? '★ ' + rt.avg.toFixed(1) + ' (' + rt.count + ')' : '';
      b.classList.toggle('provider-off', !offers);
      b.setAttribute('aria-disabled', offers ? 'false' : 'true');
      b.setAttribute('aria-checked', b.getAttribute('data-provider') === state.providerId ? 'true' : 'false');
    });
    var chip = $('providerChip'), p2 = Store.providerById(state.providerId);
    chip.textContent = p2 ? p2.name : (s ? 'pick one' : 'pick a service first');
    chip.className = 'chip' + (p2 ? ' on' : '');
  }

  /* ============================================================
     step 3 — calendar
     ============================================================ */
  function buildCalendarShell() {
    $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
    $('calNext').addEventListener('click', function () { shiftMonth(1); });
  }

  function shiftMonth(delta) {
    var m = state.calM + delta, y = state.calY;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    var today = U.todayStr(CLINIC_TZ), t = U.parseDateStr(today);
    if (y < t.y || (y === t.y && m < t.m)) return;
    var maxD = U.addDaysStr(today, NS.BOOKING_WINDOW_DAYS), mp = U.parseDateStr(maxD);
    if (y > mp.y || (y === mp.y && m > mp.m)) return;
    state.calY = y; state.calM = m;
    renderCalendar();
  }

  function renderCalendar() {
    var grid = $('calGrid'), y = state.calY, m = state.calM;
    $('calTitle').textContent = U.MONTHS[m - 1] + ' ' + y;
    var serviceId = state.serviceId, providerId = state.providerId;
    var todayS = U.todayStr(CLINIC_TZ);
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 Sun
    var lead = (first + 6) % 7; // Monday-first
    var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var html = '', i;
    for (i = 0; i < lead; i++) html += '<button class="day pad" tabindex="-1" aria-hidden="true"></button>';
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = U.dateStrOf(y, m, d);
      var past = U.dayNumber(ds) < U.dayNumber(todayS);
      var sum = past ? { free: 0, total: 0, open: false } : Store.daySummary(serviceId, providerId, ds);
      var label = past ? '' : (sum.open ? sum.free + ' free' : '—');
      var cls = 'av ' + (!sum.open ? 'none' : (sum.free === 0 ? 'none' : (sum.free <= 2 ? 'few' : 'open')));
      html += '<button type="button" class="day' + (ds === todayS ? ' today' : '') + '" role="gridcell" data-date="' + ds + '"' +
        (past ? ' disabled' : '') + ' aria-selected="' + (ds === state.date ? 'true' : 'false') + '"' +
        ' aria-label="' + U.escapeHtml(U.longDate(ds) + (past ? ' — in the past' : ', ' + label)) + '">' +
        '<span class="n">' + d + '</span><span class="' + cls + '">' + U.escapeHtml(label) + '</span></button>';
    }
    grid.innerHTML = html;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-date]'), function (b) {
      b.addEventListener('click', function () { pickDate(b.getAttribute('data-date')); });
    });
    var chip = $('policyChip');
    if (chip) chip.textContent = serviceId ? 'clinic local time' : 'estimate — pick a service';
  }

  function pickDate(ds) {
    state.date = ds;
    state.startMin = null;
    renderCalendar();
    renderSlots();
    renderSummary();
  }

  /* ============================================================
     step 4 — slots
     ============================================================ */
  function renderSlots() {
    var grid = $('slotGrid'), chip = $('slotChip'), hint = $('slotHint');
    var s = Store.serviceById(state.serviceId), p = Store.providerById(state.providerId);

    if (!s || !p || !state.date) {
      grid.classList.add('is-empty');
      grid.innerHTML = '<p class="empty sm">' + U.escapeHtml(!s ? 'Choose a service to unlock times.' : (!p ? 'Choose a specialist to see their day.' : 'Pick a date and the free times appear here.')) + '</p>';
      chip.textContent = 'not ready';
      chip.className = 'chip';
      hint.textContent = 'Times are shown in clinic local time' + (state.tz !== CLINIC_TZ ? ', with your local time underneath each slot.' : '.');
      $('slotDay').hidden = true;
      $('nextFreeBtn').hidden = true;
      $('waitBtn').hidden = true;
      return;
    }

    var res = Store.slotsFor(p.id, s.id, state.date);
    $('waitBtn').hidden = !(res.state === 'open' && res.free === 0);
    grid.classList.remove('is-empty');
    chip.textContent = res.state === 'open' ? (res.free + ' of ' + res.total + ' free') : res.state;
    chip.className = 'chip' + (res.state === 'open' && res.free > 0 ? ' ok' : (res.state === 'open' ? ' bad' : ''));

    // the day summary fills the tile so it never reads as an empty column
    var dayBox = $('slotDay');
    if (res.state === 'open') {
      dayBox.hidden = false;
      dayBox.innerHTML = '<strong>' + U.escapeHtml(U.longDate(state.date)) + '</strong>' +
        '<span>' + U.escapeHtml(p.name) + ' · ' + s.minutes + ' min + ' + s.buffer + ' min turnaround · ' + res.free + ' of ' + res.total + ' times free</span>' +
        '<span>' + U.escapeHtml(tzLabel(CLINIC_TZ)) + (state.tz !== CLINIC_TZ ? ' → ' + U.escapeHtml(tzLabel(state.tz)) : '') + '</span>';
    } else {
      dayBox.hidden = true;
    }

    if (!res.slots.length) {
      var why = res.state === 'closed' ? 'Closed that day — ' + p.name + ' does not work ' + U.WEEKDAYS[U.weekdayOf(state.date)] + 's.'
        : res.state === 'past' ? 'That date is in the past.'
        : res.state === 'not-offered' ? 'This specialist does not deliver that service.'
        : 'No slots fit in that working day.';
      grid.classList.add('is-empty');
      grid.innerHTML = '<p class="empty sm">' + U.escapeHtml(why) + '</p>';
      hint.textContent = 'Try another date, or jump to the nearest day with availability.';
      $('waitBtn').hidden = true;
      showNextFree(true);
      return;
    }

    var tzDiffers = state.tz !== CLINIC_TZ;
    grid.innerHTML = res.slots.map(function (slot) {
      var local = U.display(state.date, slot.start, state.tz);
      var sub = tzDiffers ? '<span class="slot-sub">' + local.time + ' yours</span>' : '<span class="slot-sub">' + (slot.reason === 'conflict' ? 'booked' : slot.reason === 'notice' ? 'too soon' : '') + '</span>';
      return '<button type="button" class="slot" role="option" data-start="' + slot.start + '"' +
        (slot.free ? '' : ' disabled') + ' aria-selected="' + (slot.start === state.startMin ? 'true' : 'false') + '"' +
        ' title="' + U.escapeHtml(U.longDate(state.date) + ' ' + U.minutesToTime(slot.start) + ' clinic time') + '">' +
        U.minutesToTime(slot.start) + sub + '</button>';
    }).join('');

    Array.prototype.forEach.call(grid.querySelectorAll('[data-start]'), function (b) {
      b.addEventListener('click', function () { pickSlot(parseInt(b.getAttribute('data-start'), 10)); });
    });

    hint.textContent = 'Each ' + s.minutes + '-minute session reserves a ' + s.buffer + '-minute turnaround, so back-to-back clashes cannot happen.' +
      (tzDiffers ? ' Studio time is ' + tzLabel(CLINIC_TZ) + '.' : '');
    showNextFree(res.free === 0);
  }

  /* Nearest day after `from` that still has a free slot — keeps the times tile
     useful when the chosen day is full. */
  function nextFreeDay(from) {
    if (!state.serviceId || !state.providerId) return null;
    var base = from || state.date || U.todayStr(CLINIC_TZ);
    for (var i = 1; i <= NS.BOOKING_WINDOW_DAYS; i++) {
      var d = U.addDaysStr(base, i);
      var r = Store.slotsFor(state.providerId, state.serviceId, d);
      if (r.state === 'open' && r.free > 0) return d;
    }
    return null;
  }

  function showNextFree(wanted) {
    var btn = $('nextFreeBtn');
    if (!btn) return;
    var d = wanted ? nextFreeDay() : null;
    btn.hidden = !d;
    btn.dataset.date = d || '';
    if (d) {
      var r = Store.slotsFor(state.providerId, state.serviceId, d);
      btn.textContent = 'Jump to ' + U.shortDate(d) + ' · ' + r.free + ' free';
    }
  }

  function pickSlot(start) {
    state.startMin = (state.startMin === start) ? null : start;
    renderSlots();
    renderSummary();
    validateForm();
  }

  /* ============================================================
     step 5 — summary + form
     ============================================================ */
  function paintSummary() { renderSummary(); }

  function renderSummary() {
    var s = Store.serviceById(state.serviceId);
    var p = Store.providerById(state.providerId);
    $('summaryService').textContent = s ? s.name + ' · ' + s.minutes + ' min' : '—';
    $('summaryProvider').textContent = p ? p.name : '—';
    if (s && p && state.date && state.startMin !== null) {
      var local = U.display(state.date, state.startMin, state.tz);
      var txt = U.longDate(state.date) + ' · ' + U.minutesToTime(state.startMin) + '–' + U.minutesToTime(state.startMin + s.minutes) + ' (' + tzLabel(CLINIC_TZ) + ')';
      if (state.tz !== CLINIC_TZ) txt += ' → ' + local.time + ' ' + state.tz;
      $('summaryWhen').textContent = txt;
    } else {
      $('summaryWhen').textContent = '—';
    }
    $('summaryPrice').textContent = s ? (s.price ? U.money(s.price) : 'Free') : '—';
    paintPayment(s);
    validateForm(true);
  }

  function payMethod() {
    var r = document.querySelector('input[name="payMethod"]:checked');
    return r ? r.value : 'salon';
  }
  function paintPayment(s) {
    var box = $('payBox'); if (!box) return;
    var paid = !!(s && s.price > 0);
    box.hidden = !paid;
    var g = paid && payMethod() === 'gcash';
    $('gcashBox').hidden = !g;
    if (paid) {
      $('gcashAmt').textContent = U.money(s.price);
      $('gcashNum').textContent = NS.GCASH.number;
      $('gcashName').textContent = NS.GCASH.name;
    }
  }

  function requiredSteps() {
    return [!!state.serviceId, !!state.providerId, !!state.date, state.startMin !== null];
  }
  function stepsDone() { return requiredSteps().filter(Boolean).length; }
  function readyToSubmit() { return stepsDone() === 4; }

  function wireBookingForm() {
    ['bkName', 'bkEmail', 'bkPhone'].forEach(function (id) {
      // typing clears the message; leaving a field shows one for THAT field only,
      // so a pristine form never greets the user with red text
      $(id).addEventListener('input', function () { validateForm(true); });
      $(id).addEventListener('blur', function () { validateForm(false, id); });
    });
    $('bkConsent').addEventListener('change', function () { validateForm(true); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="payMethod"]'), function (r) {
      r.addEventListener('change', function () { paintPayment(Store.serviceById(state.serviceId)); validateForm(true); });
    });
    $('bkPayRef').addEventListener('input', function () { validateForm(true); });
    $('bkPayRef').addEventListener('blur', function () { validateForm(false, 'bkPayRef'); });
    $('gcashCopy').addEventListener('click', function () {
      var txt = NS.GCASH.number.replace(/\s+/g, '');
      var done = function () { toast('ok', 'Copied', 'GCash number ' + NS.GCASH.number); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
      else fallbackCopy(txt, done);
    });
    $('waitBtn').addEventListener('click', joinWaitlistHere);
    $('bkNotes').addEventListener('input', function () {
      $('notesCount').textContent = this.value.length + ' / 500';
    });
    $('nextFreeBtn').addEventListener('click', function () {
      var d = this.dataset.date;
      if (!d) return;
      var p = U.parseDateStr(d);
      state.calY = p.y; state.calM = p.m;
      pickDate(d);
      toast('ok', 'Jumped ahead', 'Nearest availability: ' + U.longDate(d));
    });
    $('bookingForm').addEventListener('submit', submitBooking);
    $('resetBtn').addEventListener('click', function () {
      $('bookingForm').reset();
      $('notesCount').textContent = '0 / 500';
      ['bkName', 'bkEmail', 'bkPhone', 'bkConsent', 'bkPayRef'].forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
      ['errName', 'errEmail', 'errPhone', 'errConsent', 'errPayRef'].forEach(function (id) { $(id).textContent = ''; });
      paintPayment(Store.serviceById(state.serviceId));
      validateForm(true);
      toast('ok', 'Form cleared', 'Your selections are still intact.');
    });
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function fieldError(id, errId, msg, show) {
    var el = $(id), e = $(errId);
    if (show && msg) { el.setAttribute('aria-invalid', 'true'); e.textContent = msg; }
    else { el.removeAttribute('aria-invalid'); e.textContent = ''; }
    return !msg;
  }

  /* quiet = clear messages without creating new ones
     only  = restrict visible messages to a single field (used on blur) */
  function validateForm(quiet, only) {
    var show = !quiet;
    function vis(id) { return show && (!only || only === id); }
    var name = $('bkName').value.trim();
    var email = $('bkEmail').value.trim();
    var phone = $('bkPhone').value.trim();
    var consent = $('bkConsent').checked;
    var ok = true;

    ok = fieldError('bkName', 'errName', name.length < 2 ? 'Please give your full name (2+ characters).' : '', vis('bkName')) && ok;
    ok = fieldError('bkEmail', 'errEmail', !email ? 'An email is required for your confirmation.' : (!EMAIL_RE.test(email) ? 'That email address does not look right.' : ''), vis('bkEmail')) && ok;
    var digits = phone.replace(/[^\d]/g, '');
    ok = fieldError('bkPhone', 'errPhone', phone && (digits.length < 7 || digits.length > 15) ? 'Use 7–15 digits, or leave it blank.' : '', vis('bkPhone')) && ok;
    var needRef = !$('payBox').hidden && payMethod() === 'gcash';
    var ref = $('bkPayRef').value.trim();
    ok = fieldError('bkPayRef', 'errPayRef', needRef && !/^[A-Za-z0-9]{6,20}$/.test(ref) ? 'Enter the GCash reference number (6–20 letters or digits).' : '', vis('bkPayRef')) && ok;
    ok = fieldError('bkConsent', 'errConsent', consent ? '' : 'Please accept the cancellation policy.', vis('bkConsent')) && ok;

    var steps = stepsDone();
    var btn = $('submitBtn');
    var hint = $('formHint');
    var chip = $('formChip');

    if (readyToSubmit()) {
      btn.disabled = false;
      hint.textContent = 'Everything is ready — confirm to lock the slot.';
      chip.textContent = 'ready';
      chip.className = 'chip ok';
    } else {
      btn.disabled = true;
      var missing = [];
      if (!state.serviceId) missing.push('service');
      if (!state.providerId) missing.push('specialist');
      if (!state.date) missing.push('date');
      if (state.startMin === null) missing.push('time');
      hint.textContent = 'Still needed: ' + missing.join(', ') + '.';
      chip.textContent = steps + ' / 4 steps';
      chip.className = 'chip';
    }

    return ok && readyToSubmit();
  }

  function submitBooking(e) {
    e.preventDefault();
    var valid = validateForm();
    if (!valid) {
      var firstInvalid = document.querySelector('#bookingForm [aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      if (readyToSubmit()) toast('bad', 'Check the form', 'Some details still need attention.');
      return;
    }

    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Reserving…';

    // re-verify at the moment of truth (another tab / customer may have taken it)
    setTimeout(function () {
      var res = Store.book({
        serviceId: state.serviceId,
        providerId: state.providerId,
        date: state.date,
        startMin: state.startMin,
        name: $('bkName').value,
        email: (NS.auth && NS.auth.isSignedIn && NS.auth.isSignedIn() && NS.auth.session().email) || $('bkEmail').value,
        phone: $('bkPhone').value,
        notes: $('bkNotes').value,
        reminder: '1h',
        payMethod: !$('payBox').hidden ? payMethod() : 'salon',
        payRef: $('bkPayRef').value,
        tz: state.tz
      });
      btn.textContent = 'Confirm booking';
      btn.disabled = false;

      if (!res.ok) {
        if (res.error === 'slot-unavailable') {
          toast('bad', 'Slot just taken', 'Someone booked that time seconds ago. Pick another slot.');
          state.startMin = null;
          renderSlots(); renderSummary();
        } else {
          toast('bad', 'Could not book', 'Please review your selection.');
        }
        return;
      }

      Prefs.set({
        name: $('bkName').value.trim(),
        email: $('bkEmail').value.trim().toLowerCase(),
        phone: $('bkPhone').value.trim()
      });
      openConfirmation(res.booking);
      renderAll();
    }, 320);
  }

  /* ============================================================
     confirmation
     ============================================================ */
  function payLabel(b) {
    var p = b.payment || {};
    if (p.status === 'paid') return 'Paid' + (p.method === 'gcash' ? ' · GCash' : '');
    if (p.status === 'awaiting') return 'GCash — awaiting confirmation' + (p.ref ? ' (ref ' + p.ref + ')' : '');
    return 'Pay at the salon';
  }

  function ticketHtml(b) {
    var s = Store.serviceById(b.serviceId), p = Store.providerById(b.providerId);
    var local = U.display(b.date, b.startMin, state.tz);
    return '<div class="ticket">' +
      '<div class="ticket-row"><span>Reference</span><strong class="big-ref">' + U.escapeHtml(b.ref) + '</strong></div>' +
      '<div class="ticket-row"><span>Service</span><strong>' + U.escapeHtml(s.name) + ' · ' + s.minutes + ' min</strong></div>' +
      '<div class="ticket-row"><span>Specialist</span><strong>' + U.escapeHtml(p.name) + '</strong></div>' +
      '<div class="ticket-row"><span>Date</span><strong>' + U.escapeHtml(U.longDate(b.date)) + '</strong></div>' +
      '<div class="ticket-row"><span>Time (clinic)</span><strong>' + U.minutesToTime(b.startMin) + '–' + U.minutesToTime(b.startMin + b.minutes) + '</strong></div>' +
      (state.tz !== CLINIC_TZ ? '<div class="ticket-row"><span>Time (' + U.escapeHtml(state.tz) + ')</span><strong>' + local.time + '</strong></div>' : '') +
      '<div class="ticket-row"><span>Price</span><strong>' + (b.price ? U.money(b.price) : 'Free') + '</strong></div>' +
      (b.payment && b.payment.method !== 'free' ? '<div class="ticket-row"><span>Payment</span><strong>' + U.escapeHtml(payLabel(b)) + '</strong></div>' : '') +
      '<div class="ticket-row"><span>Email</span><strong>' + U.escapeHtml(b.customer.email) + '</strong></div>' +
      '</div>';
  }

  function openConfirmation(b) {
    var pending = b.status === 'pending';
    var body = (pending
      ? '<p>Your slot is <strong>held</strong>. We will confirm it as soon as we verify your GCash payment (reference <strong>' + U.escapeHtml((b.payment && b.payment.ref) || '') + '</strong>). Track it under My bookings.</p>'
      : '<p>Your slot is locked in the studio calendar. Keep this reference for <strong>' + U.escapeHtml(b.customer.email) + '</strong>.</p>') + ticketHtml(b);
    openModal(pending ? 'Booking reserved' : 'Booking confirmed', body, [
      { label: 'Download .ics', cls: 'btn-primary', onClick: function () { downloadIcs(b); } },
      { label: 'Add to Google Calendar', cls: 'btn-ghost', onClick: function () { window.open(NS.googleCalendarUrl(b), '_blank', 'noopener'); } },
      { label: 'Copy booking link', cls: 'btn-ghost', onClick: function () { copyLink(b); } },
      { label: 'Print ticket', cls: 'btn-ghost', onClick: function () { printTicket(b); } },
      { label: 'Manage booking', cls: 'btn-ghost', onClick: function () { closeModal(); openMine(b.customer.email); setView('mine'); } }
    ]);
  }

  function downloadIcs(b) {
    var blob = new Blob([NS.ICS(b)], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'northlight-' + b.ref + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('ok', 'Calendar file ready', 'northlight-' + b.ref + '.ics downloaded.');
  }

  function copyLink(b) {
    var url = location.origin + location.pathname + '?ref=' + encodeURIComponent(b.ref);
    function done() { toast('ok', 'Link copied', url); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else fallbackCopy(url, done);
  }
  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove(); cb();
  }

  function printTicket(b) {
    var w = window.open('', '_blank', 'width=520,height=680');
    if (!w) { toast('bad', 'Popup blocked', 'Allow popups to print your ticket.'); return; }
    var s = Store.serviceById(b.serviceId), p = Store.providerById(b.providerId);
    var rows = [
      ['Reference', b.ref], ['Service', s.name + ' · ' + s.minutes + ' min'],
      ['Specialist', p.name + ' (' + p.role + ')'],
      ['Date', U.longDate(b.date) + ' (' + U.WEEKDAYS[U.weekdayOf(b.date)] + ')'],
      ['Time', U.minutesToTime(b.startMin) + '–' + U.minutesToTime(b.startMin + b.minutes) + ' ' + tzLabel(CLINIC_TZ)],
      ['Name', b.customer.name], ['Email', b.customer.email], ['Phone', b.customer.phone || '—'],
      ['Price', b.price ? U.money(b.price) : 'Free'], ['Notes', b.customer.notes || '—']
    ];
    w.document.write('<title>Ticket ' + b.ref + '</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0 0 4px}small{color:#666}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:8px 0;border-bottom:1px solid #e5e7eb}td:first-child{color:#666;width:34%}td:last-child{font-weight:600;text-align:right}.ref{font:700 18px ui-monospace,monospace}</style>');
    w.document.write('<h1>Northlight Studio</h1><small>14 Aldwych Lane, London · bookings@northlight.studio</small>');
    w.document.write('<p class="ref">' + b.ref + '</p><table>');
    rows.forEach(function (r) { w.document.write('<tr><td>' + U.escapeHtml(r[0]) + '</td><td>' + U.escapeHtml(r[1]) + '</td></tr>'); });
    w.document.write('</table><p style="margin-top:20px;color:#666;font-size:12px">Free cancellation up to 24 hours before the start time.</p>');
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  }

  /* ============================================================
     next up + live desk
     ============================================================ */
  function tickClock() {
    var now = new Date();
    var clinic = U.tzParts(now, CLINIC_TZ);
    var local = U.tzParts(now, state.tz);
    $('liveClock').textContent = U.pad(clinic.hh) + ':' + U.pad(clinic.mm) + ':' + U.pad(clinic.ss);
    $('liveDate').textContent = U.longDate(U.dateStrOf(clinic.y, clinic.m, clinic.d));
    $('liveTz').textContent = tzLabel(CLINIC_TZ);
    $('liveLocal').textContent = state.tz + ' · ' + U.pad(local.hh) + ':' + U.pad(local.mm);
    $('heroTz').textContent = tzLabel(CLINIC_TZ);

    var wd = U.weekdayOf(U.dateStrOf(clinic.y, clinic.m, clinic.d));
    var openNow = PROVIDERS.some(function (p) {
      var h = p.hours[wd];
      return h && clinic.hh * 60 + clinic.mm >= h[0] && clinic.hh * 60 + clinic.mm < h[1];
    });
    var chip = $('openChip');
    chip.textContent = openNow ? 'open now' : 'closed';
    chip.className = 'chip ' + (openNow ? 'ok' : 'bad');

    try { renderNext(); } catch (e) { /* never let one tile stop the clock */ }
  }

  function renderNext() {
    var email = Prefs.get('email', '');
    var mine = email ? Store.upcoming(function (b) { return b.customer.email === email; }) : [];
    var b = mine[0], chip = $('nextChip');
    if (!b) {
      var all = Store.upcoming();
      b = all[0];
      chip.textContent = b ? 'studio' : '—';
    } else {
      chip.textContent = 'yours';
    }
    chip.className = 'chip' + (b ? ' on' : '');

    var wrap = $('nextBody');
    if (!b) {
      wrap.innerHTML = '<p class="empty sm">No upcoming appointments yet.</p>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-goto="book">Book the first one</button>';
      wireGoto(wrap);
      return;
    }
    var s = Store.serviceById(b.serviceId), p = Store.providerById(b.providerId);
    var inst = U.instantOf(b.date, b.startMin);
    var diff = inst.getTime() - Date.now();
    wrap.innerHTML =
      '<p class="countdown" data-countdown="' + inst.getTime() + '">' + humanDiff(diff) + '</p>' +
      '<p class="next-meta"><strong>' + U.escapeHtml(s.name) + '</strong><br>' +
      U.escapeHtml(U.rangeLabel(b.date, b.startMin, b.minutes, state.tz)) +
      (state.tz !== CLINIC_TZ ? ' <span class="muted">(' + U.minutesToTime(b.startMin) + ' clinic)</span>' : '') + '<br>' +
      U.escapeHtml(p.name) + ' · ' + U.escapeHtml(b.ref) + '</p>' +
      '<div class="booking-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ics="' + b.id + '">.ics</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-remind="' + b.id + '">' + (state.notify ? 'Reminders on' : 'Remind me') + '</button>' +
      '</div>';

    var ics = wrap.querySelector('[data-ics]');
    if (ics) ics.addEventListener('click', function () { downloadIcs(Store.byId(b.id)); });
    var rem = wrap.querySelector('[data-remind]');
    if (rem) rem.addEventListener('click', function () { enableReminders(Store.byId(b.id)); });
  }

  function humanDiff(ms) {
    if (ms <= 0) return 'now';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + (h % 24) + 'h ' + (m % 60) + 'm';
    if (h > 0) return h + 'h ' + (m % 60) + 'm';
    return m + 'm';
  }

  function wireGoto(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-goto')); });
    });
  }

  /* ============================================================
     reminders (browser notifications)
     ============================================================ */
  function enableReminders(booking) {
    if (!('Notification' in window)) { toast('bad', 'Not supported', 'This browser has no notification API.'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('bad', 'Reminders blocked', 'Allow notifications to get reminders.'); return; }
      state.notify = true;
      Prefs.set({ notify: true });
      if (booking) {
        Store.setReminder(booking.id, '1h');
        State_ReminderSeen_set(booking, -1);
      }
      toast('ok', 'Reminders on', 'We will ping you 1 hour before each appointment (tab must be open).');
      renderNext();
    });
  }
  function State_ReminderSeen_set(booking, v) { fired[booking.ref] = v; }

  function checkReminders() {
    if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    var email = Prefs.get('email', '');
    Store.upcoming().forEach(function (b) {
      var lead = b.reminder === '1d' ? 24 * 60 : b.reminder === '2h' ? 120 : b.reminder === '1h' ? 60 : 15;
      var diff = U.instantOf(b.date, b.startMin).getTime() - Date.now();
      if (diff > 0 && diff <= lead * 60000 && !fired[b.ref]) {
        fired[b.ref] = true;
        try {
          new Notification('Northlight Studio', {
            body: Store.serviceById(b.serviceId).name + ' with ' + Store.providerById(b.providerId).name + ' at ' + U.minutesToTime(b.startMin) + ' clinic time.',
            tag: b.ref
          });
        } catch (e) {}
      }
    });
  }

  /* ============================================================
     my bookings — lookup / reschedule / cancel
     ============================================================ */
  function wireMine() {
    $('mineForm').addEventListener('submit', function (e) {
      e.preventDefault();
      openMine($('lookupInput').value);
    });
  }

  function openMine(query) {
    state.lookup = String(query || '').trim();
    $('lookupInput').value = state.lookup;
    renderMine();
  }

  function sessionEmail() {
    return (NS.auth && NS.auth.isSignedIn && NS.auth.isSignedIn() && NS.auth.session().email) || Prefs.get('email', '') || '';
  }

  function isPastBooking(b, now) {
    return b.status === 'cancelled' || b.status === 'completed' || U.instantOf(b.date, b.startMin).getTime() < now;
  }

  function wireMineTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mt]'), function (t) {
      t.addEventListener('click', function () { state.mineTab = t.getAttribute('data-mt'); renderMine(); });
    });
  }

  function renderMine() {
    var wrap = $('mineList'), chip = $('mineChip');
    if (!state.lookup) { state.lookup = sessionEmail(); $('lookupInput').value = state.lookup; }
    renderWaitNotes();
    if (!state.lookup) {
      wrap.innerHTML = '<p class="empty sm">Nothing looked up yet.</p>';
      chip.textContent = 'lookup'; chip.className = 'chip';
      $('mineTabs').hidden = true;
      return;
    }
    var all = Store.mine(state.lookup), now = Date.now();
    var up = all.filter(function (b) { return !isPastBooking(b, now); });
    var past = all.filter(function (b) { return isPastBooking(b, now); });
    chip.textContent = all.length + ' found';
    chip.className = 'chip' + (all.length ? ' on' : '');
    $('mineTabs').hidden = !all.length;
    $('mtUp').textContent = up.length; $('mtPast').textContent = past.length; $('mtAll').textContent = all.length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-mt]'), function (t) {
      t.setAttribute('aria-selected', t.getAttribute('data-mt') === state.mineTab ? 'true' : 'false');
    });
    if (!all.length) {
      wrap.innerHTML = '<p class="empty sm">No bookings matched <strong>' + U.escapeHtml(state.lookup) + '</strong>. Check the email or reference.</p>';
      return;
    }
    var rows = state.mineTab === 'past' ? past.slice().reverse() : state.mineTab === 'all' ? all : up;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty sm">' + (state.mineTab === 'upcoming' ? 'No upcoming bookings. Check the Past tab, or book a new visit.' : 'Nothing here yet.') + '</p>';
      return;
    }
    wrap.innerHTML = rows.map(function (b) {
      var s = Store.serviceById(b.serviceId), p = Store.providerById(b.providerId);
      var isPast = isPastBooking(b, now);
      var live = b.status === 'confirmed' || b.status === 'pending';
      var canCancel = !isPast && live;
      var hoursOut = (U.instantOf(b.date, b.startMin).getTime() - now) / 3600000;
      var feeNote = canCancel ? (hoursOut >= 24 ? 'free to cancel' : 'late cancellation') : '';
      var canReview = !b.review && (b.status === 'completed' || (b.status === 'confirmed' && isPast));
      return '<article class="booking-card" data-id="' + b.id + '">' +
        '<div class="booking-top"><span class="ref">' + U.escapeHtml(b.ref) + '</span>' +
        '<span class="badge ' + b.status + '">' + (b.status === 'pending' ? 'awaiting payment' : b.status) + '</span>' +
        (b.revisions ? '<span class="pill">moved ×' + b.revisions + '</span>' : '') +
        (canCancel ? '<span class="pill">' + U.escapeHtml(feeNote) + '</span>' : '') + '</div>' +
        '<p class="booking-when">' + U.escapeHtml(U.longDate(b.date)) + ' · ' + U.minutesToTime(b.startMin) + '–' + U.minutesToTime(b.startMin + b.minutes) +
        '<span class="muted"> (' + tzLabel(CLINIC_TZ) + ')</span></p>' +
        '<p class="booking-sub">' + U.escapeHtml(s.name) + ' with ' + U.escapeHtml(p.name) + ' · ' + (b.price ? U.money(b.price) : 'Free') +
        (state.tz !== CLINIC_TZ ? ' · ' + U.display(b.date, b.startMin, state.tz).time + ' your time' : '') + '</p>' +
        (b.payment && b.payment.method !== 'free' ? '<p class="booking-sub muted">' + U.escapeHtml(payLabel(b)) + '</p>' : '') +
        (b.review ? '<p class="booking-sub"><span class="stars">' + '★'.repeat(b.review.stars) + '<span class="muted">' + '★'.repeat(5 - b.review.stars) + '</span></span>' + (b.review.text ? ' <span class="muted">“' + U.escapeHtml(b.review.text) + '”</span>' : '') + '</p>' : '') +
        '<div class="booking-actions">' +
        (live && !isPast ? '<button type="button" class="btn btn-ghost btn-sm" data-act="resched">Reschedule</button>' : '') +
        (canCancel ? '<button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>' : '') +
        (b.status === 'cancelled' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="reinstate">Reinstate</button>' : '') +
        (canReview ? '<button type="button" class="btn btn-primary btn-sm" data-act="review">★ Rate visit</button>' : '') +
        (isPast ? '<button type="button" class="btn btn-ghost btn-sm" data-act="again">Book again</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="ics">.ics</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="detail">Details</button>' +
        '</div></article>';
    }).join('');

    Array.prototype.forEach.call(wrap.querySelectorAll('[data-act]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.closest('[data-id]').getAttribute('data-id');
        var b = Store.byId(id);
        var act = btn.getAttribute('data-act');
        if (act === 'resched') openReschedule(b);
        else if (act === 'cancel') openCancel(b);
        else if (act === 'ics') downloadIcs(b);
        else if (act === 'detail') openDetail(b);
        else if (act === 'review') openReview(b);
        else if (act === 'again') bookAgain(b);
        else if (act === 'reinstate') {
          var res = Store.setStatus(id, 'confirmed', 'Reinstated by customer');
          toast(res.ok ? 'ok' : 'bad', res.ok ? 'Booking reinstated' : 'Slot no longer free',
            res.ok ? b.ref + ' is confirmed again.' : 'Somebody else took that slot — please rebook.');
        }
      });
    });
  }

  /* "Book again": same service + specialist, pick a new date. */
  function bookAgain(b) {
    state.serviceId = b.serviceId;
    state.providerId = Store.canDeliver(Store.providerById(b.providerId), b.serviceId) ? b.providerId : null;
    state.date = null; state.startMin = null;
    Prefs.set({ serviceId: state.serviceId, providerId: state.providerId });
    setView('book', { force: !!sessionEmail() });
    renderAll();
    toast('ok', 'Pick a new date', Store.serviceById(b.serviceId).name + (state.providerId ? ' with ' + Store.providerById(b.providerId).name : '') + ' is selected.');
  }

  /* ---------------- reviews ---------------- */
  function openReview(b) {
    var rating = 0;
    var body = document.createElement('div');
    body.innerHTML = '<p class="muted sm">How was <strong>' + U.escapeHtml(Store.serviceById(b.serviceId).name) + '</strong> with ' + U.escapeHtml(Store.providerById(b.providerId).name) + '?</p>' +
      '<div class="star-row" role="radiogroup" aria-label="Rating">' +
      [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="star-btn" role="radio" aria-checked="false" data-star="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>'; }).join('') + '</div>' +
      '<div class="field"><label for="rvText">Comment <span class="opt">optional</span></label><textarea class="input" id="rvText" rows="3" maxlength="400" placeholder="What did you like?"></textarea></div>' +
      '<p class="err" id="rvErr" role="alert"></p>';
    function paintStars() {
      Array.prototype.forEach.call(body.querySelectorAll('[data-star]'), function (x) {
        var n = +x.getAttribute('data-star');
        x.classList.toggle('on', n <= rating);
        x.setAttribute('aria-checked', n === rating ? 'true' : 'false');
      });
    }
    Array.prototype.forEach.call(body.querySelectorAll('[data-star]'), function (x) {
      x.addEventListener('click', function () { rating = +x.getAttribute('data-star'); paintStars(); });
    });
    openModal('Rate your visit', body, [
      { label: 'Submit review', cls: 'btn-primary', onClick: function () {
          if (!rating) { body.querySelector('#rvErr').textContent = 'Tap a star rating first.'; return; }
          var r = Store.addReview(b.id, rating, body.querySelector('#rvText').value);
          if (!r.ok) { body.querySelector('#rvErr').textContent = 'Could not save your review.'; return; }
          closeModal(); toast('ok', 'Thank you!', 'Your review was saved.'); renderMine();
        } },
      { label: 'Not now', cls: 'btn-ghost', onClick: closeModal }
    ]);
  }

  /* ---------------- waitlist ---------------- */
  function joinWaitlistHere() {
    var email = sessionEmail();
    if (!email) { if (NS.auth && NS.auth.showScreen) NS.auth.showScreen('auth', 'signin'); return; }
    if (!state.serviceId || !state.date) return;
    var nm = (NS.auth && NS.auth.isSignedIn() && NS.auth.session().name) || $('bkName').value || '';
    var r = Store.joinWaitlist({ serviceId: state.serviceId, providerId: state.providerId, date: state.date, email: email, name: nm });
    toast('ok', r.existing ? 'Already on the list' : 'You are on the waitlist',
      U.longDate(state.date) + ' — we will flag it under “Next up” the moment a slot opens.');
    renderWaitNotes();
  }

  function renderWaitNotes() {
    var email = sessionEmail();
    var entries = email ? Store.waitlistFor(email) : [];
    var html = entries.map(function (w) {
      var sv = Store.serviceById(w.serviceId); if (!sv) return '';
      var notified = w.status === 'notified';
      if (notified && !fired['w' + w.id]) {
        fired['w' + w.id] = 1;
        toast('ok', 'A slot opened up!', sv.name + ' on ' + U.shortDate(w.date) + ' — open “Next up” to book it.');
      }
      return '<div class="wait-card' + (notified ? ' hot' : '') + '" data-wid="' + w.id + '">' +
        '<div><strong>' + (notified ? '🔔 A slot opened up' : '⏳ On the waitlist') + '</strong><br>' +
        '<span class="muted sm">' + U.escapeHtml(sv.name) + ' · ' + U.escapeHtml(U.shortDate(w.date)) + '</span></div>' +
        '<div class="booking-actions">' +
        (notified ? '<button type="button" class="btn btn-primary btn-sm" data-w="book">Book it</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-w="leave">' + (notified ? 'Dismiss' : 'Leave') + '</button></div></div>';
    }).join('');
    ['waitNotes', 'mineWait'].forEach(function (id) {
      var box = $(id); if (!box) return;
      box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll('[data-w]'), function (btn) {
        btn.addEventListener('click', function () {
          var wid = btn.closest('[data-wid]').getAttribute('data-wid');
          var w = Store.waitlistFor(email).filter(function (x) { return x.id === wid; })[0];
          if (btn.getAttribute('data-w') === 'leave') { Store.leaveWaitlist(wid); return; }
          if (!w) return;
          state.serviceId = w.serviceId; state.providerId = w.providerId || null; state.startMin = null;
          var pr = U.parseDateStr(w.date); state.calY = pr.y; state.calM = pr.m;
          Prefs.set({ serviceId: state.serviceId, providerId: state.providerId });
          setView('book', { force: !!email });
          Store.leaveWaitlist(wid);
          pickDate(w.date); renderAll();
        });
      });
    });
  }

  function openCancel(b) {
    var hours = (U.instantOf(b.date, b.startMin).getTime() - Date.now()) / 3600000;
    var free = hours >= 24;
    openModal('Cancel ' + b.ref, '<p>' + U.escapeHtml(U.longDate(b.date)) + ' at ' + U.minutesToTime(b.startMin) +
      ' with ' + U.escapeHtml(Store.providerById(b.providerId).name) + '.</p>' +
      '<p><strong>' + (free ? 'Free cancellation' : 'Inside 24 hours') + '</strong> — ' +
      (free ? 'no charge applies and the slot is released immediately.' : 'a late-cancellation fee may apply under the policy.') + '</p>',
      [
        { label: 'Yes, cancel', cls: 'btn-danger', onClick: function () {
            Store.setStatus(b.id, 'cancelled', free ? 'Cancelled by customer (free)' : 'Cancelled by customer (late)');
            closeModal();
            toast('ok', 'Booking cancelled', b.ref + ' has been released.');
          } },
        { label: 'Keep it', cls: 'btn-ghost', onClick: closeModal }
      ]);
  }

  function openReschedule(b) {
    var body = document.createElement('div');
    body.innerHTML =
      '<p class="muted sm">Moving <strong>' + U.escapeHtml(b.ref) + '</strong> — ' +
      U.escapeHtml(Store.serviceById(b.serviceId).name) + ' with ' + U.escapeHtml(Store.providerById(b.providerId).name) + '.</p>' +
      '<div class="field"><label for="rsDate">New date (clinic local time)</label>' +
      '<input class="input" type="date" id="rsDate" value="' + b.date + '" min="' + U.todayStr(CLINIC_TZ) + '" max="' + U.addDaysStr(U.todayStr(CLINIC_TZ), NS.BOOKING_WINDOW_DAYS) + '" /></div>' +
      '<p class="hint" id="rsHint">Choose a date, then a free time.</p>' +
      '<div class="slot-grid" id="rsSlots" style="max-height:230px"></div>';
    var dateInput = body.querySelector('#rsDate');
    var grid = body.querySelector('#rsSlots');
    var hint = body.querySelector('#rsHint');
    var chosen = null;

    function paint() {
      var res = Store.slotsFor(b.providerId, b.serviceId, dateInput.value, { excludeId: b.id });
      if (res.state === 'closed' || res.state === 'past') {
        grid.innerHTML = '<p class="empty sm">Closed that day — try another date.</p>';
        hint.textContent = 'No working hours on that date.';
        return;
      }
      grid.innerHTML = res.slots.map(function (s) {
        return '<button type="button" class="slot" data-s="' + s.start + '"' + (s.free ? '' : ' disabled') +
          ' aria-selected="false">' + U.minutesToTime(s.start) + '</button>';
      }).join('');
      hint.textContent = res.free + ' free slot' + (res.free === 1 ? '' : 's') + ' on that day.';
      Array.prototype.forEach.call(grid.querySelectorAll('[data-s]'), function (btn) {
        btn.addEventListener('click', function () {
          chosen = parseInt(btn.getAttribute('data-s'), 10);
          Array.prototype.forEach.call(grid.querySelectorAll('[data-s]'), function (o) { o.setAttribute('aria-selected', 'false'); });
          btn.setAttribute('aria-selected', 'true');
        });
      });
    }
    dateInput.addEventListener('change', function () { chosen = null; paint(); });
    paint();

    openModal('Reschedule booking', body, [
      { label: 'Confirm move', cls: 'btn-primary', onClick: function () {
          if (chosen === null) { toast('bad', 'Pick a time', 'Select one of the free slots first.'); return; }
          var res = Store.reschedule(b.id, dateInput.value, chosen);
          if (!res.ok) { toast('bad', 'Could not move', 'That slot was taken. Pick another.'); paint(); return; }
          closeModal();
          toast('ok', 'Booking moved', res.booking.ref + ' is now ' + U.rangeLabel(res.booking.date, res.booking.startMin, res.booking.minutes, state.tz) + '.');
          renderMine();
        } },
      { label: 'Keep as is', cls: 'btn-ghost', onClick: closeModal }
    ]);
  }

  function openDetail(b) {
    var s = Store.serviceById(b.serviceId), p = Store.providerById(b.providerId);
    var hist = (b.history || []).map(function (h) {
      return '<div class="ticket-row"><span>' + U.escapeHtml(new Date(h.at).toLocaleString()) + '</span><strong>' + U.escapeHtml(h.detail) + '</strong></div>';
    }).join('');
    var body = ticketHtml(b) +
      '<div class="ticket"><div class="ticket-row"><span>Status</span><strong>' + b.status + '</strong></div>' +
      '<div class="ticket-row"><span>Phone</span><strong>' + U.escapeHtml(b.customer.phone || '—') + '</strong></div>' +
      '<div class="ticket-row"><span>Notes</span><strong>' + U.escapeHtml(b.customer.notes || '—') + '</strong></div>' +
      '<div class="ticket-row"><span>Booked</span><strong>' + U.escapeHtml(new Date(b.createdAt).toLocaleString()) + '</strong></div>' +
      '<div class="ticket-row"><span>Revisions</span><strong>' + (b.revisions || 0) + '</strong></div></div>' +
      '<h3 style="font-size:13px;margin-top:6px">History</h3><div class="ticket">' + hist + '</div>';
    openModal('Booking ' + b.ref, body, [
      { label: '.ics', cls: 'btn-primary', onClick: function () { downloadIcs(b); } },
      { label: 'Print', cls: 'btn-ghost', onClick: function () { printTicket(b); } },
      { label: 'Close', cls: 'btn-ghost', onClick: closeModal }
    ]);
  }

  /* ============================================================
     policies tile
     ============================================================ */
  function buildPolicy() {
    var rows = '<thead><tr><th scope="col">Day</th><th scope="col">Hours (clinic)</th></tr></thead><tbody>';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (wd) {
      var blocks = PROVIDERS.map(function (p) {
        var h = p.hours[wd];
        return h ? U.minutesToTime(h[0]) + '–' + U.minutesToTime(h[1]) : null;
      }).filter(Boolean);
      var min = blocks.length ? blocks.reduce(function (a, b) { return a < b ? a : b; }) : null;
      var max = blocks.length ? blocks.reduce(function (a, b) { return a > b ? a : b; }) : null;
      rows += '<tr><td>' + U.WEEKDAYS[wd] + '</td><td>' + (min ? min + ' – ' + max : 'closed') + '</td></tr>';
    });
    rows += '</tbody>';
    $('hoursTable').innerHTML = rows;
    $('polNotice').textContent = NS.MIN_NOTICE_MINUTES + ' minutes';
    $('polWindow').textContent = NS.BOOKING_WINDOW_DAYS + ' days';
    $('polTz').textContent = tzLabel(CLINIC_TZ);
  }

  /* ============================================================
     toast + modal helpers (shared with admin)
     ============================================================ */
  function toast(kind, title, msg) {
    var wrap = $('toasts');
    // never stack identical toasts (e.g. from repeated taps)
    var dupe = false;
    Array.prototype.forEach.call(wrap.children, function (t) {
      if (t.getAttribute('data-key') === title + '|' + (msg || '')) dupe = true;
    });
    if (dupe) return;
    var el = document.createElement('div');
    el.setAttribute('data-key', title + '|' + (msg || ''));
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<strong>' + U.escapeHtml(title) + '</strong><span>' + U.escapeHtml(msg || '') + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 4200);
  }

  var modalActions = [];
  function openModal(title, body, actions) {
    $('modalTitle').textContent = title;
    var bodyEl = $('modalBody');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else { bodyEl.innerHTML = ''; bodyEl.appendChild(body); }

    var actWrap = $('modalActions');
    actWrap.innerHTML = '';
    modalActions = actions || [];
    modalActions.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      actWrap.appendChild(b);
    });
    $('modal').hidden = false;
    var first = actWrap.querySelector('button');
    if (first) first.focus();
  }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; $('modalActions').innerHTML = ''; }

  /* ============================================================
     deep link  ?ref=BK-XXXXXX
     ============================================================ */
  function handleDeepLink() {
    var m = /[?&]ref=([^&]+)/.exec(location.search);
    if (!m) return;
    var ref = decodeURIComponent(m[1]);
    var b = Store.byRef(ref);
    setView('mine');
    openMine(ref);
    if (b) {
      toast('ok', 'Booking found', b.ref + ' · ' + U.longDate(b.date) + ' ' + U.minutesToTime(b.startMin));
      openDetail(b);
    } else {
      toast('bad', 'Reference not found', 'No booking matches ' + ref + ' on this device.');
    }
  }

  /* ============================================================
     render everything
     ============================================================ */
  function renderAll() {
    paintServices();
    paintProviders();
    renderCalendar();
    renderSlots();
    renderSummary();
    renderNext();
    renderWaitNotes();
    if (state.view === 'mine') renderMine();
  }

  NS.app = { prefillFromSession: prefillFromSession, clearSessionFields: clearSessionFields, requireAuth: requireAuth, setView: setView, toast: toast, openModal: openModal, closeModal: closeModal, downloadIcs: downloadIcs, printTicket: printTicket, renderMine: renderMine, humanDiff: humanDiff, ticketHtml: ticketHtml };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();