/* ============================================================
   Northlight Studio — operations dashboard
   staff sign-in · KPI stats · 14-day load chart · filters · CSV
   ============================================================ */
(function () {
  'use strict';

  var NS = window.NS, Store = NS.Store, U = NS.U;
  // Staff credentials. Front-end only: the password is stored as a SHA-256 hash, not plain text,
  // but anything shipped to the browser can be inspected. Use a real server login before going live (see README).
  var ADMIN_USER = 'admin';
  var ADMIN_HASH = '83b8397a17edc6623d874ce891048912f0d01e5b21e70869e577b6032a1af851';   // sha256('northlight:admin:' + password)
  var SESSION_KEY = 'northlight.admin.v1';
  var SESSION_MS = 2 * 60 * 60 * 1000;   // staff session lasts 2 hours, or until the tab is closed
  var MAX_TRIES = 5, LOCK_MS = 30000;
  var tries = 0, lockedUntil = 0;

  var unlocked = false;
  var filters = { provider: '', service: '', status: '', from: '', to: '', q: '' };

  var $ = function (id) { return document.getElementById(id); };

  function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('nocrypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function readSession() {
    try { var v = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); return v && v.exp > Date.now() ? v : null; } catch (e) { return null; }
  }
  function saveSession() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: ADMIN_USER, exp: Date.now() + SESSION_MS })); } catch (e) {} }
  function dropSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function showDashboard() {
    unlocked = true;
    $('adminGate').hidden = true;
    $('adminPanel').hidden = false;
    $('adminLogout').hidden = false;
    $('adminChip').textContent = 'signed in';
    $('adminChip').className = 'chip ok';
    buildFilterOptions();
    wireFilters();
    render();
  }

  function lockDashboard(silent) {
    unlocked = false;
    dropSession();
    $('adminPanel').hidden = true;
    $('adminGate').hidden = false;
    $('adminLogout').hidden = true;
    $('adminChip').textContent = 'locked';
    $('adminChip').className = 'chip';
    $('adminForm').reset();
    $('errPin').textContent = '';
    if (!silent) NS.app.toast('ok', 'Signed out', 'Staff dashboard locked.');
  }

  function setErr(msg) {
    $('errPin').textContent = msg;
    if (msg) { $('adminPin').setAttribute('aria-invalid', 'true'); } else { $('adminPin').removeAttribute('aria-invalid'); }
  }

  var wired = false;

  function init() {
    if (!$('adminForm')) return;

    if (readSession()) showDashboard();   // still signed in from earlier in this tab

    $('adminBack').addEventListener('click', function () {
      var signed = NS.auth && NS.auth.isSignedIn && NS.auth.isSignedIn();
      NS.app.setView(signed ? 'book' : 'mine', { force: true });
    });

    $('adminLogout').addEventListener('click', function () {
      lockDashboard();
      NS.app.setView(NS.auth && NS.auth.isSignedIn && NS.auth.isSignedIn() ? 'book' : 'mine', { force: true });
    });

    $('adminForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var wait = lockedUntil - Date.now();
      if (wait > 0) { setErr('Too many attempts. Try again in ' + Math.ceil(wait / 1000) + 's.'); return; }
      var user = $('adminUser').value.trim().toLowerCase(), pass = $('adminPin').value;
      if (!user || !pass) { setErr('Enter your staff username and password.'); return; }
      sha256('northlight:' + user + ':' + pass).then(function (h) {
        if (user === ADMIN_USER && h === ADMIN_HASH) {
          tries = 0; setErr(''); saveSession(); showDashboard();
          NS.app.toast('ok', 'Welcome back', 'Staff dashboard is live.');
        } else {
          tries++;
          if (tries >= MAX_TRIES) { lockedUntil = Date.now() + LOCK_MS; tries = 0; setErr('Too many attempts. Try again in 30s.'); }
          else setErr('Incorrect username or password. ' + (MAX_TRIES - tries) + ' tries left.');
          $('adminPin').value = '';
        }
      }).catch(function () { setErr('Staff sign-in needs a secure (https) connection.'); });
    });

    $('seedDemo').addEventListener('click', function () {
      var n = Store.seedDemo(26);
      NS.app.toast('ok', 'Demo data loaded', n + ' bookings generated across the studio.');
      render();
    });

    $('exportCsv').addEventListener('click', exportCsv);
    $('adminWalkIn').addEventListener('click', openWalkIn);
    $('adminReport').addEventListener('click', openReport);
    $('adminSchedule').addEventListener('click', openSchedule);

    Store.on('change', function () { if (unlocked) render(); });
  }

  function buildFilterOptions() {
    var p = $('fProvider'), s = $('fService');
    if (!p.options.length) {
      p.innerHTML = '<option value="">All</option>' + NS.PROVIDERS.map(function (x) {
        return '<option value="' + x.id + '">' + U.escapeHtml(x.name) + '</option>';
      }).join('');
      s.innerHTML = '<option value="">All</option>' + NS.SERVICES.map(function (x) {
        return '<option value="' + x.id + '">' + U.escapeHtml(x.name) + '</option>';
      }).join('');
    }
  }

  function wireFilters() {
    if (wired) return; wired = true;
    var map = { fProvider: 'provider', fService: 'service', fStatus: 'status', fFrom: 'from', fTo: 'to', fSearch: 'q' };
    Object.keys(map).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        filters[map[id]] = el.value;
        render();
      });
    });
    $('fReset').addEventListener('click', function () {
      filters = { provider: '', service: '', status: '', from: '', to: '', q: '' };
      ['fProvider', 'fService', 'fStatus', 'fFrom', 'fTo', 'fSearch'].forEach(function (id) { $(id).value = ''; });
      render();
    });
  }

  function filtered() {
    var q = filters.q.trim().toLowerCase();
    return Store.all().filter(function (b) {
      if (filters.provider && b.providerId !== filters.provider) return false;
      if (filters.service && b.serviceId !== filters.service) return false;
      if (filters.status && b.status !== filters.status) return false;
      if (filters.from && U.dayNumber(b.date) < U.dayNumber(filters.from)) return false;
      if (filters.to && U.dayNumber(b.date) > U.dayNumber(filters.to)) return false;
      if (q) {
        var hay = [b.ref, b.customer.name, b.customer.email, b.customer.phone,
          (Store.providerById(b.providerId) || {}).name, (Store.serviceById(b.serviceId) || {}).name]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function render() {
    if (!unlocked) return;
    var all = Store.all(), rows = filtered(), now = Date.now();

    var confirmed = all.filter(function (b) { return b.status === 'confirmed'; });
    var cancelled = all.filter(function (b) { return b.status === 'cancelled'; });
    var future = all.filter(function (b) { return b.status !== 'cancelled' && U.instantOf(b.date, b.startMin).getTime() > now; });
    var revenue = confirmed.concat(all.filter(function (b) { return b.status === 'completed'; }))
      .reduce(function (a, b) { return a + (b.price || 0); }, 0);
    var cancelRate = all.length ? Math.round((cancelled.length / all.length) * 100) : 0;

    // utilisation: minutes sold / minutes offered over the next 7 days
    var today = U.todayStr(NS.CLINIC_TZ), offered = 0, sold = 0;
    for (var i = 0; i < 7; i++) {
      var ds = U.addDaysStr(today, i);
      NS.PROVIDERS.forEach(function (p) {
        var block = Store.workingBlock(p, ds);
        if (!block) return;
        offered += (block.close - block.open);
      });
      all.forEach(function (b) {
        if (b.date === ds && b.status !== 'cancelled') sold += b.minutes;
      });
    }
    var util = offered ? Math.round((sold / offered) * 100) : 0;

    var leadDays = confirmed.length ? Math.round(confirmed.reduce(function (a, b) {
      return a + Math.max(0, (U.instantOf(b.date, b.startMin).getTime() - new Date(b.createdAt).getTime()) / 86400000);
    }, 0) / confirmed.length) : 0;

    $('statTotal').textContent = all.length;
    $('statTotalSub').textContent = rows.length + ' match the current filters';
    $('statConfirmed').textContent = confirmed.length;
    $('statConfirmedSub').textContent = future.length + ' still upcoming';
    $('statRevenue').textContent = U.money(revenue);
    $('statRevenueSub').textContent = 'confirmed + completed bookings';
    $('statUtil').textContent = util + '%';
    $('statUtilSub').textContent = 'next 7 days of studio hours';
    $('statLead').textContent = leadDays + 'd';
    $('statLeadSub').textContent = 'average booking lead time';
    var pend = all.filter(function (b) { return b.status === 'pending'; });
    $('statPending').textContent = pend.length;
    $('statPendingSub').textContent = U.money(pend.reduce(function (a, b) { return a + (b.price || 0); }, 0)) + ' to verify';
    var rt = Store.ratingFor();
    $('statRating').textContent = rt.count ? rt.avg.toFixed(1) + ' ★' : '—';
    $('statRatingSub').textContent = rt.count + ' review' + (rt.count === 1 ? '' : 's');
    $('statCancel').textContent = cancelRate + '%';
    $('statCancelSub').textContent = cancelled.length + ' cancelled bookings';

    renderSpark(today);
    renderTable(rows, now);

    var wl = Store.waitlistAll();
    if (wl.length) $('adminChip').textContent = wl.length + ' on waitlist';
    else if (unlocked) { $('adminChip').textContent = 'signed in'; $('adminChip').className = 'chip ok'; }
  }

  function renderSpark(today) {
    var counts = [], labels = [], max = 1, i;
    for (i = 0; i < 14; i++) {
      var ds = U.addDaysStr(today, i);
      var n = Store.all().filter(function (b) { return b.date === ds && b.status !== 'cancelled'; }).length;
      counts.push(n); labels.push(U.shortDate(ds)); if (n > max) max = n;
    }
    $('spark').innerHTML = counts.map(function (n, idx) {
      var h = n === 0 ? 4 : Math.max(8, Math.round((n / max) * 68));
      return '<div class="bar" data-v="' + n + '" data-label="' + U.escapeHtml(labels[idx] + ' · ' + n + ' booking' + (n === 1 ? '' : 's')) + '" style="height:' + h + 'px"></div>';
    }).join('');
  }

  function renderTable(rows, now) {
    var body = $('adminTableBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No bookings match these filters.</td></tr>';
      $('adminCount').textContent = '0 rows';
      return;
    }
    var tz = NS.state ? NS.state.tz : NS.CLINIC_TZ;
    body.innerHTML = rows.map(function (b) {
      var s = Store.serviceById(b.serviceId) || { name: '—' }, p = Store.providerById(b.providerId) || { name: '—' };
      var when = U.display(b.date, b.startMin, tz);
      var past = U.instantOf(b.date, b.startMin).getTime() < now;
      var actions = '<div class="row-actions">' +
        (b.status === 'pending' ? '<button class="btn btn-primary btn-sm" data-a="confirm" data-id="' + b.id + '" title="Payment received — confirm booking">Confirm</button>' : '') +
        (b.status === 'confirmed' ? '<button class="btn btn-ghost btn-sm" data-a="complete" data-id="' + b.id + '" title="Mark completed">✓</button>' : '') +
        ((b.status === 'confirmed' || b.status === 'pending') ? '<button class="btn btn-ghost btn-sm" data-a="resched" data-id="' + b.id + '" title="Reschedule">↻</button>' +
          '<button class="btn btn-ghost btn-sm" data-a="cancel" data-id="' + b.id + '" title="Cancel booking">✕</button>' : '') +
        (b.status === 'cancelled' ? '<button class="btn btn-ghost btn-sm" data-a="reinstate" data-id="' + b.id + '" title="Reinstate">↺</button>' : '') +
        '<button class="btn btn-ghost btn-sm" data-a="detail" data-id="' + b.id + '" title="Detail">⋯</button>' +
        '<button class="btn btn-ghost btn-sm" data-a="ics" data-id="' + b.id + '" title="Calendar file">ics</button>' +
        '</div>';
      return '<tr' + (past && b.status === 'confirmed' ? ' style="opacity:.72"' : '') + '>' +
        '<td><span class="ref">' + U.escapeHtml(b.ref) + '</span></td>' +
        '<td>' + U.escapeHtml(U.shortDate(when.dateStr)) + ' · ' + U.minutesToTime(b.startMin) + '–' + U.minutesToTime(b.startMin + b.minutes) + '</td>' +
        '<td>' + U.escapeHtml(s.name) + '</td>' +
        '<td>' + U.escapeHtml(p.name) + '</td>' +
        '<td>' + U.escapeHtml(b.customer.name) + (b.source === 'walk-in' ? ' <span class="pill">walk-in</span>' : '') + '<br><span class="muted" style="font-size:11px">' + U.escapeHtml(b.customer.email || b.customer.phone || '') + '</span></td>' +
        '<td><span class="badge ' + b.status + '">' + b.status + '</span>' + payBadge(b) + '</td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('[data-a]'), function (btn) {
      btn.addEventListener('click', function () {
        var b = Store.byId(btn.getAttribute('data-id'));
        var a = btn.getAttribute('data-a');
        if (!b) return;
        if (a === 'ics') NS.app.downloadIcs(b);
        else if (a === 'detail') openAdminDetail(b);
        else if (a === 'confirm') { Store.confirmPayment(b.id); NS.app.toast('ok', 'Payment confirmed', b.ref + ' is now confirmed.'); }
        else if (a === 'resched') openAdminResched(b);
        else if (a === 'complete') { Store.setStatus(b.id, 'completed', 'Completed by staff'); NS.app.toast('ok', 'Marked completed', b.ref); }
        else if (a === 'cancel') { Store.setStatus(b.id, 'cancelled', 'Cancelled by staff'); NS.app.toast('ok', 'Booking cancelled', b.ref + ' slot released.'); }
        else if (a === 'reinstate') {
          var res = Store.setStatus(b.id, 'confirmed', 'Reinstated by staff');
          if (!res.ok) NS.app.toast('bad', 'Slot already taken', 'Pick another slot for this customer.');
          else NS.app.toast('ok', 'Reinstated', b.ref + ' is confirmed again.');
        }
      });
    });

    $('adminCount').textContent = rows.length + ' row' + (rows.length === 1 ? '' : 's') +
      ' · ' + Store.waitlistAll().length + ' on the waitlist';
  }

  function openAdminDetail(b) {
    var body = NS.app.ticketHtml(b) +
      '<div class="ticket">' +
      '<div class="ticket-row"><span>Name</span><strong>' + U.escapeHtml(b.customer.name) + '</strong></div>' +
      '<div class="ticket-row"><span>Phone</span><strong>' + U.escapeHtml(b.customer.phone || '—') + '</strong></div>' +
      '<div class="ticket-row"><span>Notes</span><strong>' + U.escapeHtml(b.customer.notes || '—') + '</strong></div>' +
      '<div class="ticket-row"><span>Reminder</span><strong>' + U.escapeHtml(b.reminder || 'none') + '</strong></div>' +
      '<div class="ticket-row"><span>Booked at</span><strong>' + U.escapeHtml(new Date(b.createdAt).toLocaleString()) + '</strong></div>' +
      '<div class="ticket-row"><span>Timezone at booking</span><strong>' + U.escapeHtml(b.tzAtBooking || '—') + '</strong></div>' +
      '<div class="ticket-row"><span>Revisions</span><strong>' + (b.revisions || 0) + '</strong></div>' +
      '</div>' +
      '<h3 style="font-size:13px">History</h3><div class="ticket">' +
      (b.history || []).map(function (h) {
        return '<div class="ticket-row"><span>' + U.escapeHtml(new Date(h.at).toLocaleString()) + '</span><strong>' + U.escapeHtml(h.detail) + '</strong></div>';
      }).join('') + '</div>';
    NS.app.openModal('Booking ' + b.ref, body, [
      { label: 'Print ticket', cls: 'btn-primary', onClick: function () { NS.app.printTicket(b); } },
      { label: '.ics', cls: 'btn-ghost', onClick: function () { NS.app.downloadIcs(b); } },
      { label: 'Close', cls: 'btn-ghost', onClick: NS.app.closeModal }
    ]);
  }


  /* ============================================================
     admin tools: slot picker · reschedule · walk-in · report · schedule
     ============================================================ */
  function payBadge(b) {
    var pay = b.payment; if (!pay || pay.method === 'free') return '';
    var label = pay.status === 'paid' ? 'paid' : pay.status === 'awaiting' ? 'GCash · awaiting' : (pay.method === 'salon' ? 'pay at salon' : 'unpaid');
    return '<br><span class="muted" style="font-size:11px">' + U.escapeHtml(label) + '</span>';
  }

  function hhmm(min) { return U.minutesToTime(min); }
  function toMin(v) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d; }

  /* date input + free-slot grid for one provider/service. get() -> {date, start} or null */
  function slotPicker(host, cfg) {
    host.innerHTML =
      '<div class="field"><label>Date (clinic time)</label><input class="input" type="date" data-sp="date" /></div>' +
      '<p class="hint" data-sp="hint">Choose a date, then a free time.</p>' +
      '<div class="slot-grid" data-sp="grid" style="max-height:220px"></div>';
    var dateI = host.querySelector('[data-sp=date]'), grid = host.querySelector('[data-sp=grid]'), hint = host.querySelector('[data-sp=hint]');
    var chosen = null;
    dateI.value = cfg.date || U.todayStr(NS.CLINIC_TZ);
    dateI.min = cfg.walkIn ? U.todayStr(NS.CLINIC_TZ) : U.todayStr(NS.CLINIC_TZ);
    function paint() {
      chosen = null;
      var c = cfg.ctx();
      if (!c.providerId || !c.serviceId) { grid.innerHTML = '<p class="empty sm">Pick a service and specialist first.</p>'; hint.textContent = ''; return; }
      var res = Store.slotsFor(c.providerId, c.serviceId, dateI.value, { excludeId: cfg.excludeId, walkIn: cfg.walkIn });
      if (res.state !== 'open') { grid.innerHTML = '<p class="empty sm">' + (res.state === 'not-offered' ? 'This specialist does not offer that service.' : 'Closed or unavailable that day.') + '</p>'; hint.textContent = ''; return; }
      grid.innerHTML = res.slots.map(function (sl) {
        return '<button type="button" class="slot" data-s="' + sl.start + '"' + (sl.free ? '' : ' disabled') + ' aria-selected="false">' + hhmm(sl.start) + '</button>';
      }).join('');
      hint.textContent = res.free + ' free of ' + res.total + ' times.';
      Array.prototype.forEach.call(grid.querySelectorAll('[data-s]'), function (b) {
        b.addEventListener('click', function () {
          chosen = parseInt(b.getAttribute('data-s'), 10);
          Array.prototype.forEach.call(grid.querySelectorAll('[data-s]'), function (o) { o.setAttribute('aria-selected', 'false'); });
          b.setAttribute('aria-selected', 'true');
        });
      });
    }
    dateI.addEventListener('change', paint);
    paint();
    return { repaint: paint, get: function () { return chosen === null ? null : { date: dateI.value, start: chosen }; } };
  }

  function openAdminResched(b) {
    var body = el('<p class="muted sm">Moving <strong>' + U.escapeHtml(b.ref) + '</strong> (' + U.escapeHtml((Store.serviceById(b.serviceId) || {}).name) + ' with ' + U.escapeHtml((Store.providerById(b.providerId) || {}).name) + ').</p><div data-host></div>');
    var sp = slotPicker(body.querySelector('[data-host]'), { date: b.date, excludeId: b.id, ctx: function () { return { providerId: b.providerId, serviceId: b.serviceId }; } });
    NS.app.openModal('Reschedule ' + b.ref, body, [
      { label: 'Move booking', cls: 'btn-primary', onClick: function () {
          var pick = sp.get();
          if (!pick) { NS.app.toast('bad', 'Pick a time', 'Select a free slot first.'); return; }
          var r = Store.reschedule(b.id, pick.date, pick.start);
          if (!r.ok) { NS.app.toast('bad', 'Could not move', 'That slot was just taken.'); sp.repaint(); return; }
          NS.app.closeModal(); NS.app.toast('ok', 'Booking moved', b.ref + ' is now ' + U.shortDate(pick.date) + ' ' + hhmm(pick.start) + '.');
        } },
      { label: 'Cancel', cls: 'btn-ghost', onClick: NS.app.closeModal }
    ]);
  }

  /* ---------- walk-in ---------- */
  function openWalkIn() {
    var body = el(
      '<div class="field"><label>Services <span class="muted">(pick one or more)</span></label><div class="chip-pick" data-svc>' +
      NS.SERVICES.map(function (s) {
        return '<label class="chk-pill"><input type="checkbox" value="' + s.id + '" /><span>' + U.escapeHtml(s.emoji + ' ' + s.name) + ' · ' + (s.price ? U.money(s.price) : 'Free') + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="field"><label>Specialist</label><select class="input" data-prov></select></div>' +
      '<div data-host></div>' +
      '<div class="field-row"><div class="field"><label>Customer name</label><input class="input" data-name placeholder="Walk-in guest" /></div>' +
      '<div class="field"><label>Phone <span class="opt">optional</span></label><input class="input" data-phone type="tel" /></div></div>' +
      '<div class="field"><label>Email <span class="opt">optional</span></label><input class="input" data-email type="email" placeholder="so they can look it up later" /></div>' +
      '<label class="check"><input type="checkbox" data-paid /><span>Already paid (cash / GCash at the counter)</span></label>' +
      '<p class="err" data-err role="alert"></p>');
    var provSel = body.querySelector('[data-prov]');
    function serviceId() {
      var ids = Array.prototype.map.call(body.querySelectorAll('[data-svc] input:checked'), function (i) { return i.value; });
      return ids.length ? Store.bundleId(ids) : '';
    }
    function fillProviders() {
      var sid = serviceId();
      var pool = sid ? Store.providersFor(sid) : [];
      var keep = provSel.value;
      provSel.innerHTML = sid ? (pool.length ? pool.map(function (p) { return '<option value="' + p.id + '">' + U.escapeHtml(p.name) + '</option>'; }).join('')
        : '<option value="">No one offers all of these together</option>') : '<option value="">Pick a service first</option>';
      if (pool.some(function (p) { return p.id === keep; })) provSel.value = keep;
    }
    var sp = slotPicker(body.querySelector('[data-host]'), { walkIn: true, ctx: function () { return { providerId: provSel.value, serviceId: serviceId() }; } });
    Array.prototype.forEach.call(body.querySelectorAll('[data-svc] input'), function (i) { i.addEventListener('change', function () { fillProviders(); sp.repaint(); }); });
    provSel.addEventListener('change', sp.repaint);
    fillProviders();
    NS.app.openModal('New walk-in booking', body, [
      { label: 'Add booking', cls: 'btn-primary', onClick: function () {
          var err = body.querySelector('[data-err]'), pick = sp.get(), sid = serviceId();
          if (!sid || !provSel.value) { err.textContent = 'Choose a service and a specialist.'; return; }
          if (!pick) { err.textContent = 'Choose a free time.'; return; }
          var r = Store.book({ walkIn: true, serviceId: sid, providerId: provSel.value, date: pick.date, startMin: pick.start,
            name: body.querySelector('[data-name]').value, phone: body.querySelector('[data-phone]').value,
            email: body.querySelector('[data-email]').value, payMethod: 'cash', paid: body.querySelector('[data-paid]').checked, tz: NS.CLINIC_TZ });
          if (!r.ok) { err.textContent = 'That time was just taken — pick another.'; sp.repaint(); return; }
          NS.app.closeModal(); NS.app.toast('ok', 'Walk-in added', r.booking.ref + ' · ' + U.shortDate(pick.date) + ' ' + hhmm(pick.start));
        } },
      { label: 'Cancel', cls: 'btn-ghost', onClick: NS.app.closeModal }
    ]);
  }

  /* ---------- report ---------- */
  function rangeFor(kind, from, to) {
    var today = U.todayStr(NS.CLINIC_TZ), wd = U.weekdayOf(today);
    if (kind === 'today') return [today, today];
    if (kind === 'week') { var mon = U.addDaysStr(today, -((wd + 6) % 7)); return [mon, U.addDaysStr(mon, 6)]; }
    if (kind === 'month') { var p = U.parseDateStr(today); var first = U.dateStrOf(p.y, p.m, 1); var nx = p.m === 12 ? U.dateStrOf(p.y + 1, 1, 1) : U.dateStrOf(p.y, p.m + 1, 1); return [first, U.addDaysStr(nx, -1)]; }
    return [from || today, to || from || today];
  }

  function buildReport(a, b) {
    var rows = Store.all().filter(function (x) { return x.date >= a && x.date <= b; });
    var live = rows.filter(function (x) { return x.status !== 'cancelled'; });
    var done = rows.filter(function (x) { return x.status === 'completed'; });
    var money = function (list) { return list.reduce(function (t, x) { return t + (x.price || 0); }, 0); };
    var paid = live.filter(function (x) { return x.payment && x.payment.status === 'paid'; });
    var by = function (keyFn, nameFn) {
      var m = {};
      live.forEach(function (x) { var k = keyFn(x); m[k] = m[k] || { name: nameFn(x), n: 0, rev: 0 }; m[k].n++; m[k].rev += x.price || 0; });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (p, q) { return q.rev - p.rev || q.n - p.n; });
    };
    var rating = (function () { var r = rows.filter(function (x) { return x.review; }); return { n: r.length, avg: r.length ? r.reduce(function (t, x) { return t + x.review.stars; }, 0) / r.length : 0 }; })();
    return {
      from: a, to: b, total: rows.length, live: live.length, completed: done.length,
      cancelled: rows.filter(function (x) { return x.status === 'cancelled'; }).length,
      pending: rows.filter(function (x) { return x.status === 'pending'; }).length,
      walkins: live.filter(function (x) { return x.source === 'walk-in'; }).length,
      booked: money(live), collected: money(paid), outstanding: money(live) - money(paid),
      byService: by(function (x) { return x.serviceId; }, function (x) { return (Store.serviceById(x.serviceId) || {}).name || x.serviceId; }),
      byProvider: by(function (x) { return x.providerId; }, function (x) { return (Store.providerById(x.providerId) || {}).name || x.providerId; }),
      rating: rating, rows: rows
    };
  }

  function reportHtml(r) {
    var tbl = function (title, list) {
      return '<h3 style="font-size:13px;margin:14px 0 6px">' + title + '</h3><table class="table table-sm"><thead><tr><th>Name</th><th>Bookings</th><th>Booked value</th></tr></thead><tbody>' +
        (list.length ? list.map(function (x) { return '<tr><td>' + U.escapeHtml(x.name) + '</td><td>' + x.n + '</td><td>' + U.money(x.rev) + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="muted">No bookings in this range.</td></tr>') +
        '</tbody></table>';
    };
    var span = r.from === r.to ? U.longDate(r.from) : U.longDate(r.from) + ' – ' + U.longDate(r.to);
    return '<p class="muted sm">' + U.escapeHtml(span) + '</p>' +
      '<div class="ticket">' +
      '<div class="ticket-row"><span>Bookings (not cancelled)</span><strong>' + r.live + '</strong></div>' +
      '<div class="ticket-row"><span>Completed</span><strong>' + r.completed + '</strong></div>' +
      '<div class="ticket-row"><span>Cancelled</span><strong>' + r.cancelled + '</strong></div>' +
      '<div class="ticket-row"><span>Awaiting payment (GCash)</span><strong>' + r.pending + '</strong></div>' +
      '<div class="ticket-row"><span>Walk-ins</span><strong>' + r.walkins + '</strong></div>' +
      '<div class="ticket-row"><span>Booked value</span><strong>' + U.money(r.booked) + '</strong></div>' +
      '<div class="ticket-row"><span>Collected (paid)</span><strong>' + U.money(r.collected) + '</strong></div>' +
      '<div class="ticket-row"><span>Still to collect</span><strong>' + U.money(r.outstanding) + '</strong></div>' +
      '<div class="ticket-row"><span>Average rating</span><strong>' + (r.rating.n ? r.rating.avg.toFixed(1) + ' ★ (' + r.rating.n + ')' : '—') + '</strong></div></div>' +
      tbl('By service', r.byService) + tbl('By specialist', r.byProvider);
  }

  function printReport(r) {
    var w = window.open('', '_blank');
    if (!w) { NS.app.toast('bad', 'Popup blocked', 'Allow popups to print the report.'); return; }
    w.document.write('<title>Northlight report ' + r.from + ' to ' + r.to + '</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:6px 0}td,th{padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:left}.ticket-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb}.muted{color:#666}h3{font-size:14px}</style>');
    w.document.write('<h1>Northlight Studio — report</h1>' + reportHtml(r).replace(/class="table table-sm"/g, ''));
    w.document.close(); w.focus(); setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  }

  function openReport() {
    var kind = 'today', from = '', to = '';
    var body = el('<div class="field"><label>Range</label><select class="input" data-kind>' +
      '<option value="today">Today</option><option value="week">This week (Mon–Sun)</option><option value="month">This month</option><option value="custom">Custom dates</option></select></div>' +
      '<div class="field-row" data-custom hidden><div class="field"><label>From</label><input class="input" type="date" data-from /></div><div class="field"><label>To</label><input class="input" type="date" data-to /></div></div>' +
      '<div data-out></div>');
    var cur = null;
    function paint() {
      kind = body.querySelector('[data-kind]').value;
      body.querySelector('[data-custom]').hidden = kind !== 'custom';
      from = body.querySelector('[data-from]').value; to = body.querySelector('[data-to]').value;
      var rg = rangeFor(kind, from, to);
      if (rg[0] > rg[1]) rg = [rg[1], rg[0]];
      cur = buildReport(rg[0], rg[1]);
      body.querySelector('[data-out]').innerHTML = reportHtml(cur);
    }
    ['[data-kind]', '[data-from]', '[data-to]'].forEach(function (q) { body.querySelector(q).addEventListener('change', paint); });
    paint();
    NS.app.openModal('Sales & bookings report', body, [
      { label: 'Print / Save as PDF', cls: 'btn-primary', onClick: function () { printReport(cur); } },
      { label: 'Download CSV', cls: 'btn-ghost', onClick: function () { exportRows(cur.rows, 'northlight-report-' + cur.from + '_' + cur.to + '.csv'); } },
      { label: 'Reviews', cls: 'btn-ghost', onClick: openReviews },
      { label: 'Close', cls: 'btn-ghost', onClick: NS.app.closeModal }
    ]);
  }

  function openReviews() {
    var rev = Store.all().filter(function (b) { return b.review; }).sort(function (a, b) { return b.review.at.localeCompare(a.review.at); });
    var body = rev.length ? rev.map(function (b) {
      var p = Store.providerById(b.providerId) || {};
      return '<div class="ticket"><div class="ticket-row"><span>' + U.escapeHtml(b.customer.name) + ' → ' + U.escapeHtml(p.name || '') + '</span><strong>' + '★'.repeat(b.review.stars) + '☆'.repeat(5 - b.review.stars) + '</strong></div>' +
        (b.review.text ? '<p class="sm" style="margin:6px 0 0">' + U.escapeHtml(b.review.text) + '</p>' : '') + '</div>';
    }).join('') : '<p class="empty sm">No reviews yet. Customers can rate a visit from My bookings after it is done.</p>';
    NS.app.openModal('Customer reviews', body, [{ label: 'Back to report', cls: 'btn-ghost', onClick: openReport }, { label: 'Close', cls: 'btn-primary', onClick: NS.app.closeModal }]);
  }

  /* ---------- staff schedule ---------- */
  function openSchedule() {
    var DAYS = [1, 2, 3, 4, 5, 6, 0];
    var body = el('<p class="muted sm">Set each specialist&rsquo;s weekly hours (clinic time) and their days off. Changes apply to the booking calendar straight away.</p>' +
      '<div class="field"><label>Specialist</label><select class="input" data-prov>' + NS.PROVIDERS.map(function (p) { return '<option value="' + p.id + '">' + U.escapeHtml(p.name) + ' — ' + U.escapeHtml(p.role) + '</option>'; }).join('') + '</select></div>' +
      '<div data-hours></div><div class="form-actions"><button type="button" class="btn btn-primary btn-sm" data-save>Save weekly hours</button></div>' +
      '<h3 style="font-size:13px;margin:16px 0 6px">Days off</h3><div class="lookup"><input class="input input-sm" type="date" data-off-date /><button type="button" class="btn btn-ghost btn-sm" data-off-add>Add day off</button></div><div data-offs class="chip-pick"></div>' +
      '<h3 style="font-size:13px;margin:16px 0 6px">Studio closed for everyone</h3><div class="lookup"><input class="input input-sm" type="date" data-cl-date /><input class="input input-sm" data-cl-why placeholder="Reason (holiday…)" /><button type="button" class="btn btn-ghost btn-sm" data-cl-add>Close studio</button></div><div data-cls class="chip-pick"></div>');
    var sel = body.querySelector('[data-prov]');
    function cur() { return Store.getSchedule().providers.filter(function (p) { return p.id === sel.value; })[0]; }
    function paintHours() {
      var p = cur();
      body.querySelector('[data-hours]').innerHTML = DAYS.map(function (d) {
        var h = p.hours[d];
        return '<div class="sched-row"><label class="check"><input type="checkbox" data-on="' + d + '"' + (h ? ' checked' : '') + ' /><span>' + U.WEEKDAYS[d] + '</span></label>' +
          '<input class="input input-sm" type="time" data-open="' + d + '" value="' + hhmm(h ? h[0] : 540) + '"' + (h ? '' : ' disabled') + ' />' +
          '<span class="muted">to</span><input class="input input-sm" type="time" data-close="' + d + '" value="' + hhmm(h ? h[1] : 1020) + '"' + (h ? '' : ' disabled') + ' /></div>';
      }).join('');
      Array.prototype.forEach.call(body.querySelectorAll('[data-on]'), function (c) {
        c.addEventListener('change', function () {
          var d = c.getAttribute('data-on');
          body.querySelector('[data-open="' + d + '"]').disabled = !c.checked;
          body.querySelector('[data-close="' + d + '"]').disabled = !c.checked;
        });
      });
    }
    function paintLists() {
      var p = cur(), sc = Store.getSchedule();
      body.querySelector('[data-offs]').innerHTML = p.off.length ? p.off.map(function (d) { return '<span class="chk-pill on">' + U.escapeHtml(U.shortDate(d)) + ' <button type="button" class="x" data-rm-off="' + d + '" aria-label="Remove">✕</button></span>'; }).join('') : '<span class="muted sm">None.</span>';
      body.querySelector('[data-cls]').innerHTML = sc.closures.length ? sc.closures.map(function (c) { return '<span class="chk-pill on">' + U.escapeHtml(U.shortDate(c.date) + (c.reason ? ' · ' + c.reason : '')) + ' <button type="button" class="x" data-rm-cl="' + c.date + '" aria-label="Remove">✕</button></span>'; }).join('') : '<span class="muted sm">None.</span>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-rm-off]'), function (b) { b.addEventListener('click', function () { Store.removeDayOff(sel.value, b.getAttribute('data-rm-off')); paintLists(); }); });
      Array.prototype.forEach.call(body.querySelectorAll('[data-rm-cl]'), function (b) { b.addEventListener('click', function () { Store.removeClosure(b.getAttribute('data-rm-cl')); paintLists(); }); });
    }
    sel.addEventListener('change', function () { paintHours(); paintLists(); });
    body.querySelector('[data-save]').addEventListener('click', function () {
      var hours = {}, bad = false;
      DAYS.forEach(function (d) {
        if (!body.querySelector('[data-on="' + d + '"]').checked) return;
        var a = toMin(body.querySelector('[data-open="' + d + '"]').value), z = toMin(body.querySelector('[data-close="' + d + '"]').value);
        if (a === null || z === null || a >= z) bad = true; else hours[d] = [a, z];
      });
      if (bad) { NS.app.toast('bad', 'Check the hours', 'Closing time must be after opening time.'); return; }
      Store.setHours(sel.value, hours);
      NS.app.toast('ok', 'Schedule saved', cur().name + ' — weekly hours updated.');
    });
    body.querySelector('[data-off-add]').addEventListener('click', function () {
      var v = body.querySelector('[data-off-date]').value; if (!v) return;
      Store.addDayOff(sel.value, v); body.querySelector('[data-off-date]').value = ''; paintLists();
    });
    body.querySelector('[data-cl-add]').addEventListener('click', function () {
      var v = body.querySelector('[data-cl-date]').value; if (!v) return;
      Store.addClosure(v, body.querySelector('[data-cl-why]').value.trim()); body.querySelector('[data-cl-date]').value = ''; body.querySelector('[data-cl-why]').value = ''; paintLists();
    });
    paintHours(); paintLists();
    NS.app.openModal('Staff schedule', body, [{ label: 'Done', cls: 'btn-primary', onClick: NS.app.closeModal }]);
  }

  /* ---------------- CSV ---------------- */

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCsv() { exportRows(filtered(), 'northlight-bookings-' + U.todayStr(NS.CLINIC_TZ) + '.csv'); }

  function exportRows(rows, filename) {
    if (!rows.length) { NS.app.toast('bad', 'Nothing to export', 'No bookings match.'); return; }
    var head = ['Reference', 'Date (clinic)', 'Start', 'End', 'Duration (min)', 'Service', 'Specialist',
      'Customer', 'Email', 'Phone', 'Status', 'Price (PHP)', 'Payment', 'Source', 'Rating', 'Booked at', 'Revisions', 'Notes'];
    var lines = [head.map(csvCell).join(',')];
    rows.forEach(function (b) {
      var s = Store.serviceById(b.serviceId) || {}, p = Store.providerById(b.providerId) || {};
      lines.push([
        b.ref, b.date, U.minutesToTime(b.startMin), U.minutesToTime(b.startMin + b.minutes), b.minutes,
        s.name, p.name, b.customer.name, b.customer.email, b.customer.phone, b.status,
        b.price, b.payment ? (b.payment.method + ':' + b.payment.status) : '', b.source || 'online', b.review ? b.review.stars : '',
        new Date(b.createdAt).toISOString(), b.revisions || 0, b.customer.notes || ''
      ].map(csvCell).join(','));
    });
    var csv = '\ufeff' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    NS.app.toast('ok', 'CSV exported', rows.length + ' bookings written to file.');
  }

  window.NSAdmin = { render: render, unlock: function () { unlocked = true; }, filters: filters };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();