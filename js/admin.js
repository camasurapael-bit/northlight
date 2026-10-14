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
    if (NS.Cloud) NS.Cloud.clearAdmin();
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
          tries = 0; setErr(''); saveSession();
          if (NS.Cloud) NS.Cloud.setAdmin(pass);   // the server re-checks this password (ADMIN_PASSCODE)
          showDashboard();
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
        (b.status === 'confirmed' ? '<button class="btn btn-ghost btn-sm" data-a="complete" data-id="' + b.id + '" title="Mark completed">✓</button>' +
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
        '<td>' + U.escapeHtml(b.customer.name) + '<br><span class="muted" style="font-size:11px">' + U.escapeHtml(b.customer.email) + '</span></td>' +
        '<td><span class="badge ' + b.status + '">' + b.status + '</span></td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('[data-a]'), function (btn) {
      btn.addEventListener('click', function () {
        var b = Store.byId(btn.getAttribute('data-id'));
        var a = btn.getAttribute('data-a');
        if (!b) return;
        if (a === 'ics') NS.app.downloadIcs(b);
        else if (a === 'detail') openAdminDetail(b);
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

  /* ---------------- CSV ---------------- */

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    var rows = filtered();
    if (!rows.length) { NS.app.toast('bad', 'Nothing to export', 'No bookings match the filters.'); return; }
    var head = ['Reference', 'Date (clinic)', 'Start', 'End', 'Duration (min)', 'Service', 'Specialist',
      'Customer', 'Email', 'Phone', 'Status', 'Price (PHP)', 'Reminder', 'Booked at', 'Revisions', 'Notes'];
    var lines = [head.map(csvCell).join(',')];
    rows.forEach(function (b) {
      var s = Store.serviceById(b.serviceId) || {}, p = Store.providerById(b.providerId) || {};
      lines.push([
        b.ref, b.date, U.minutesToTime(b.startMin), U.minutesToTime(b.startMin + b.minutes), b.minutes,
        s.name, p.name, b.customer.name, b.customer.email, b.customer.phone, b.status,
        b.price, b.reminder || 'none', new Date(b.createdAt).toISOString(), b.revisions || 0, b.customer.notes || ''
      ].map(csvCell).join(','));
    });
    var csv = '\ufeff' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'northlight-bookings-' + U.todayStr(NS.CLINIC_TZ) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    NS.app.toast('ok', 'CSV exported', rows.length + ' bookings written to file.');
  }

  window.NSAdmin = { render: render, unlock: function () { unlocked = true; }, lock: lockDashboard, filters: filters };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();