/* ============================================================
   Northlight Studio — data layer
   Catalogue · timezone maths · availability engine · persistence · ICS
   Pure ES5-safe, no dependencies. Runs in the browser and in Node
   (used by the test script) via a memory-backed store fallback.
   ============================================================ */
(function (global) {
  'use strict';

  var CLINIC_TZ = 'Asia/Manila';   // studio runs on Philippine time (UTC+8, no DST)
  var STORE_KEY = 'northlight.bookings.v1';
  var WAIT_KEY = 'northlight.waitlist.v1';
  var PREF_KEY = 'northlight.prefs.v1';
  var SCHED_KEY = 'northlight.schedule.v1';
  var CHANNEL = 'northlight.realtime.v1';

  var MIN_NOTICE_MINUTES = 120;   // earliest bookable start from now
  var BOOKING_WINDOW_DAYS = 60;   // how far ahead you can book
  var REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* Money: ONE place to change currency for the entire app. */
  /* Where customers send GCash payments. CHANGE THIS to the salon's real number before going live. */
  var GCASH = { number: '0917 000 0000', name: 'Northlight Studio' };

  var CURRENCY = { code: 'PHP', symbol: '\u20B1', locale: 'en-PH', name: 'Philippine peso' };

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------- catalogue ---------------- */

  var SERVICES = [
    { id: 'consult',  name: 'Free Beauty Consultation', emoji: '💬', minutes: 30,  buffer: 15, price: 0,    step: 15, color: '#6c8cff', blurb: 'Free chat about hair, skin or nails before you book.' },
    { id: 'haircut',  name: 'Haircut & Blow-dry',       emoji: '✂️', minutes: 45,  buffer: 15, price: 450,  step: 15, color: '#a06bff', blurb: 'Wash, cut and blow-dry with a senior stylist.' },
    { id: 'facial',   name: 'Facial Treatment',         emoji: '🧖', minutes: 45,  buffer: 15, price: 900,  step: 15, color: '#f0689b', blurb: 'Deep-cleansing facial for fresh, glowing skin.' },
    { id: 'manipedi', name: 'Manicure & Pedicure',      emoji: '💅', minutes: 90,  buffer: 15, price: 650,  step: 30, color: '#25c79b', blurb: 'Classic mani-pedi with the polish of your choice.' },
    { id: 'hilot',    name: 'Hilot (Filipino Massage)', emoji: '💆', minutes: 60,  buffer: 15, price: 800,  step: 15, color: '#ffb347', blurb: 'Traditional Filipino massage to ease tired muscles.' },
    { id: 'rebond',   name: 'Hair Rebond',              emoji: '💇', minutes: 150, buffer: 30, price: 3500, step: 30, color: '#4fd1e0', blurb: 'Straightening treatment for smooth, sleek hair.' }
  ];

  /* hours are minutes-from-midnight in studio local time (Philippine time), keyed by JS weekday (0 = Sunday) */
  var PROVIDERS = [
    { id: 'ada',    name: 'Emily Carter',     role: 'Senior hair stylist',   initials: 'EC', color: '#6c8cff',
      services: ['consult', 'haircut', 'rebond'],
      hours: { 1: [540, 1020], 2: [540, 1020], 3: [540, 1020], 4: [540, 1020], 5: [540, 900] },
      off: [] },
    { id: 'marco',  name: 'Michael Brooks',   role: 'Barber & colorist',     initials: 'MB', color: '#f0689b',
      services: ['consult', 'haircut', 'rebond'],
      hours: { 1: [540, 1080], 2: [540, 1080], 4: [540, 1080], 5: [540, 960], 6: [540, 840] },
      off: [] },
    { id: 'sofia',  name: 'Sophie Anderson',  role: 'Nail technician',       initials: 'SA', color: '#25c79b',
      services: ['consult', 'manipedi'],
      hours: { 2: [480, 960], 3: [480, 960], 4: [480, 960], 6: [540, 780] },
      off: [] },
    { id: 'ren',    name: 'Ryan Mitchell',    role: 'Massage therapist',     initials: 'RM', color: '#ffb347',
      services: ['hilot', 'consult'],
      hours: { 1: [660, 1020], 3: [660, 1020], 5: [660, 1020] },
      off: [] },
    { id: 'nadia',  name: 'Natalie Hughes',   role: 'Spa & skin therapist',  initials: 'NH', color: '#a06bff',
      services: ['consult', 'facial', 'hilot', 'manipedi'],
      hours: { 1: [540, 1080], 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080] },
      off: [] }
  ];

  var CLOSURES = [
    { date: null, reason: '' } // placeholder; closures can be pushed at runtime
  ];

  /* ---------------- events ---------------- */

  var Events = {
    handlers: {},
    on: function (type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    emit: function (type, data) {
      (this.handlers[type] || []).forEach(function (fn) {
        try { fn(data); } catch (e) { if (global.console) console.error(e); }
      });
    }
  };

  /* ---------------- storage (localStorage, memory fallback) ---------------- */

  var memory = {};

  function safeGet(k) {
    try { if (global.localStorage) return global.localStorage.getItem(k); } catch (e) {}
    return memory[k] === undefined ? null : memory[k];
  }
  function safeSet(k, v) {
    memory[k] = v;
    try { if (global.localStorage) global.localStorage.setItem(k, v); } catch (e) {}
  }
  function readJSON(k, fallback) {
    try {
      var raw = safeGet(k);
      if (!raw) return fallback;
      var val = JSON.parse(raw);
      return Array.isArray(fallback) ? (Array.isArray(val) ? val : fallback) : (val || fallback);
    } catch (e) { return fallback; }
  }
  function writeJSON(k, v) { safeSet(k, JSON.stringify(v)); }

  /* ---------------- timezone maths (no libraries) ---------------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function tzParts(d, tz) {
    var dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || CLINIC_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {}, parts = dtf.formatToParts(d);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    var hh = parseInt(p.hour, 10); if (hh === 24) hh = 0;
    return { y: +p.year, m: +p.month, d: +p.day, hh: hh, mm: +p.minute, ss: +p.second };
  }

  function offsetMinutes(d, tz) {
    var p = tzParts(d, tz);
    return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - d.getTime()) / 60000);
  }

  /* wall-clock time in `tz`  ->  absolute UTC instant (handles DST safely) */
  function wallToUtc(y, m, d, hh, mm, tz) {
    var guess = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    var off = offsetMinutes(new Date(guess), tz);
    var ts = guess - off * 60000;
    off = offsetMinutes(new Date(ts), tz);
    ts = guess - off * 60000;
    return new Date(ts);
  }

  function dateStrOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseDateStr(s) { var a = String(s).split('-'); return { y: +a[0], m: +a[1], d: +a[2] }; }
  function dayNumber(s) { var p = parseDateStr(s); return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }
  function addDaysStr(s, n) {
    var p = parseDateStr(s);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d));
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }
  function weekdayOf(s) { var p = parseDateStr(s); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function todayStr(tz) { var p = tzParts(new Date(), tz || CLINIC_TZ); return dateStrOf(p.y, p.m, p.d); }
  function nowMinutes(tz) { var p = tzParts(new Date(), tz || CLINIC_TZ); return p.hh * 60 + p.mm; }
  function minutesToTime(min) { min = ((min % 1440) + 1440) % 1440; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  /* clinic wall time -> absolute instant */
  function instantOf(dateS, startMin) {
    var p = parseDateStr(dateS);
    return wallToUtc(p.y, p.m, p.d, Math.floor(startMin / 60), startMin % 60, CLINIC_TZ);
  }

  /* absolute instant -> display representation in any zone */
  function inZone(instant, tz) {
    var p = tzParts(instant, tz);
    var ds = dateStrOf(p.y, p.m, p.d);
    return { dateStr: ds, time: pad(p.hh) + ':' + pad(p.mm), minutes: p.hh * 60 + p.mm, wd: weekdayOf(ds) };
  }
  function display(dateS, startMin, tz) {
    var inst = instantOf(dateS, startMin);
    var z = inZone(inst, tz || CLINIC_TZ);
    z.instant = inst;
    return z;
  }

  function longDate(s) {
    var p = parseDateStr(s);
    return WEEKDAYS[weekdayOf(s)] + ', ' + p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }
  function shortDate(s) {
    var p = parseDateStr(s);
    return WEEKDAYS_SHORT[weekdayOf(s)] + ' ' + p.d + ' ' + MONTHS_SHORT[p.m - 1];
  }
  function rangeLabel(dateS, startMin, minutes, tz) {
    var a = display(dateS, startMin, tz);
    var b = display(dateS, startMin + minutes, tz);
    return shortDate(a.dateStr) + ' ' + a.time + '–' + b.time;
  }

  function zoneList() {
    if (global.Intl && Intl.supportedValuesOf) {
      try { return Intl.supportedValuesOf('timeZone'); } catch (e) {}
    }
    return ['UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
      'Europe/Stockholm', 'Europe/Lisbon', 'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City',
      'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Jerusalem', 'Asia/Dubai',
      'Asia/Karachi', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong',
      'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney',
      'Pacific/Auckland'];
  }
  function guessZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Formats an amount in the studio currency. Intl gives correct grouping and the
     guard means an ICU-less runtime still prints exactly the same string. */
  function money(n) {
    n = Number(n) || 0;
    try {
      if (global.Intl && Intl.NumberFormat) {
        var out = new Intl.NumberFormat(CURRENCY.locale, {
          style: 'currency', currency: CURRENCY.code,
          minimumFractionDigits: 0, maximumFractionDigits: 0
        }).format(n);
        if (out.indexOf(CURRENCY.symbol) !== -1) return out;
      }
    } catch (e) {}
    return CURRENCY.symbol + n.toLocaleString('en-US');
  }

  var U = {
    pad: pad, tzParts: tzParts, offsetMinutes: offsetMinutes, wallToUtc: wallToUtc,
    dateStrOf: dateStrOf, parseDateStr: parseDateStr, dayNumber: dayNumber, addDaysStr: addDaysStr,
    weekdayOf: weekdayOf, todayStr: todayStr, nowMinutes: nowMinutes, minutesToTime: minutesToTime,
    instantOf: instantOf, inZone: inZone, display: display, longDate: longDate, shortDate: shortDate,
    rangeLabel: rangeLabel, zoneList: zoneList, money: money, guessZone: guessZone, escapeHtml: escapeHtml,
    WEEKDAYS: WEEKDAYS, WEEKDAYS_SHORT: WEEKDAYS_SHORT, MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT
  };

  /* ---------------- catalogue lookups ---------------- */

  var bundleCache = {};
  function baseService(id) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i];
    return null;
  }
  /* A service id may be a bundle such as "haircut+manipedi": one appointment, services back to back. */
  function serviceParts(id) {
    return String(id || '').split('+').filter(Boolean);
  }
  function bundleId(ids) {
    var seen = {}, out = [];
    SERVICES.forEach(function (s) { if (ids.indexOf(s.id) >= 0 && !seen[s.id]) { seen[s.id] = 1; out.push(s.id); } });
    return out.join('+');
  }
  function serviceById(id) {
    if (!id) return null;
    var one = baseService(id);
    if (one) return one;
    if (String(id).indexOf('+') < 0) return null;
    if (bundleCache[id]) return bundleCache[id];
    var parts = serviceParts(id).map(baseService);
    if (parts.length < 2 || parts.some(function (x) { return !x; })) return null;
    var b = {
      id: bundleId(parts.map(function (x) { return x.id; })),
      name: parts.map(function (x) { return x.name; }).join(' + '),
      emoji: parts.map(function (x) { return x.emoji; }).join(''),
      minutes: parts.reduce(function (a, x) { return a + x.minutes; }, 0),
      buffer: Math.max.apply(null, parts.map(function (x) { return x.buffer || 0; })),
      price: parts.reduce(function (a, x) { return a + x.price; }, 0),
      step: Math.min.apply(null, parts.map(function (x) { return x.step || 15; })),
      color: parts[0].color,
      blurb: 'Back-to-back in one visit: ' + parts.map(function (x) { return x.name; }).join(', ') + '.',
      parts: parts.map(function (x) { return x.id; })
    };
    bundleCache[id] = b; bundleCache[b.id] = b;
    return b;
  }
  function canDeliver(provider, serviceId) {
    var parts = serviceParts(serviceId);
    return !!provider && parts.length > 0 && parts.every(function (p) { return provider.services.indexOf(p) >= 0; });
  }
  function providerById(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return null;
  }
  function providersFor(serviceId) {
    return PROVIDERS.filter(function (p) { return canDeliver(p, serviceId); });
  }
  function isClosure(dateS) {
    return CLOSURES.some(function (c) { return c && c.date === dateS; });
  }
  function workingBlock(provider, dateS) {
    if (!provider) return null;
    if (provider.off && provider.off.indexOf(dateS) >= 0) return null;
    if (isClosure(dateS)) return null;
    var h = provider.hours[weekdayOf(dateS)];
    if (!h) return null;
    return { open: h[0], close: h[1] };
  }

  /* ---------------- persistence ---------------- */

  var list = [];
  var waitlist = [];
  var channel = null;

  /* ---------------- shared database hooks (Firebase Firestore, see js/cloud.js) ----------------
     Without js/cloud.js (or when Firebase is unreachable) everything keeps working on this device only. */
  var cloud = null;     // set by Store.attachCloud()
  var synced = {};      // booking id -> JSON of the version known to be in the database
  var pending = {};     // booking id -> number of pushes still in flight
  var chain = {};       // booking id -> promise of the latest push
  var busy = {};        // 'providerId__date' -> [{id,start,end}] public availability from the database
  var extras = {};      // bookings fetched by reference lookup

  function cloudState() { return cloud ? cloud.state() : 'off'; }   // 'off' | 'connecting' | 'on'

  function readList() {
    var arr = readJSON(STORE_KEY, []);
    if (!Array.isArray(arr)) return [];
    // drop bookings saved under an older catalogue (unknown service/provider) so they can't crash the UI
    return arr.filter(function (b) { return b && serviceById(b.serviceId) && providerById(b.providerId) && b.customer; });
  }
  function persist() {
    writeJSON(STORE_KEY, list);
  }
  function broadcast() {
    if (channel) { try { channel.postMessage({ t: 'change', at: Date.now() }); } catch (e) {} }
  }
  function announce() {
    persist();
    Events.emit('change');
    broadcast();
    syncUp();
  }

  function intervalOf(b) {
    var sv = serviceById(b.serviceId) || { buffer: 0 };
    var mins = b.minutes || (sv.minutes || 30);
    return { start: b.startMin, end: b.startMin + mins + (sv.buffer || 0) };
  }
  function replaceLocal(b) {
    for (var i = 0; i < list.length; i++) if (list[i].id === b.id) { list[i] = b; return; }
    list.push(b);
  }
  function removeLocal(id) {
    list = list.filter(function (x) { return x.id !== id; });
  }

  /* push one booking (and its slot claim) to the database, one at a time per booking */
  function queuePush(id) {
    pending[id] = (pending[id] || 0) + 1;
    var run = (chain[id] || Promise.resolve({ ok: true })).then(function () {
      var cur = Store.byId(id);
      if (!cur) return { ok: true };
      var json = JSON.stringify(cur);
      if (synced[id] === json) return { ok: true };
      var prev = synced[id] ? JSON.parse(synced[id]) : null;
      return cloud.pushBooking(JSON.parse(json), prev).then(function (r) {
        if (r.ok) { synced[id] = json; return r; }
        if (prev) replaceLocal(prev); else removeLocal(id);   // refused: put things back as they were
        persist();
        Events.emit('change');
        Events.emit('cloud-error', { id: id, error: r.error, fresh: !prev });
        return r;
      });
    }).then(function (r) {
      pending[id] = (pending[id] || 1) - 1;
      if (!pending[id]) delete pending[id];
      return r;
    });
    chain[id] = run;
    return run;
  }
  function syncUp() {
    if (cloudState() !== 'on') return;
    list.slice().forEach(function (b) {
      if (synced[b.id] !== JSON.stringify(b)) queuePush(b.id);
    });
  }

  /* the database says what the bookings are now */
  function applyRemoteBookings(arr) {
    var remote = {}, next = [], seen = {};
    (arr || []).forEach(function (d) {
      if (d && d.id && d.customer && serviceById(d.serviceId) && providerById(d.providerId)) remote[d.id] = d;
    });
    Object.keys(remote).forEach(function (id) {
      seen[id] = 1;
      if (pending[id]) { next.push(Store.byId(id) || remote[id]); }
      else { next.push(remote[id]); synced[id] = JSON.stringify(remote[id]); }
    });
    list.forEach(function (b) {
      if (!seen[b.id] && (pending[b.id] || extras[b.id])) next.push(b);
    });
    list = next;
    Object.keys(synced).forEach(function (id) {
      if (!seen[id] && !pending[id] && !extras[id]) delete synced[id];
    });
    persist();
    Events.emit('change', { remote: true });
  }

  /* ---------------- availability engine ---------------- */

  function occupiedIntervals(dateS, providerId, excludeId) {
    var known = {}, out = [];
    list.forEach(function (b) {
      known[b.id] = 1;
      if (b.providerId === providerId && b.date === dateS && b.status !== 'cancelled' && b.id !== excludeId) out.push(intervalOf(b));
    });
    // other people's bookings: only their time ranges are shared, never their details
    (busy[providerId + '__' + dateS] || []).forEach(function (it) {
      if (!known[it.id] && it.id !== excludeId) out.push({ start: it.start, end: it.end });
    });
    return out;
  }

  /**
   * Slot grid for one provider + service + clinic date.
   * A candidate is free only when it fits inside working hours (turnaround
   * buffer included), does not overlap any live booking, respects the
   * minimum-notice rule and sits inside the booking window.
   */
  function slotsFor(providerId, serviceId, dateS, opts) {
    opts = opts || {};
    var provider = providerById(providerId), service = serviceById(serviceId);
    if (!provider || !service) return { slots: [], total: 0, free: 0, block: null, state: 'incomplete' };
    if (!canDeliver(provider, serviceId)) return { slots: [], total: 0, free: 0, block: null, state: 'not-offered' };

    var block = workingBlock(provider, dateS);
    var today = todayStr(CLINIC_TZ);
    if (!block) {
      return { slots: [], total: 0, free: 0, block: null, state: dayNumber(dateS) < dayNumber(today) ? 'past' : 'closed' };
    }

    var dur = service.minutes, buf = service.buffer || 0, step = service.step || 15;
    var occ = occupiedIntervals(dateS, providerId, opts.excludeId);
    var lastBookable = addDaysStr(today, BOOKING_WINDOW_DAYS);
    var isPast = dayNumber(dateS) < dayNumber(today);
    var beyondWindow = dayNumber(dateS) > dayNumber(lastBookable);
    var earliest = Date.now() + MIN_NOTICE_MINUTES * 60000;

    var slots = [];
    for (var t = block.open; t + dur + buf <= block.close; t += step) {
      var end = t + dur + buf;
      var clash = false;
      for (var i = 0; i < occ.length; i++) {
        if (t < occ[i].end && end > occ[i].start) { clash = true; break; }
      }
      var tooSoon = opts.walkIn ? instantOf(dateS, t).getTime() < Date.now() - 30 * 60000 : instantOf(dateS, t).getTime() < earliest;
      var free = !clash && !isPast && !beyondWindow && !tooSoon;
      // `end` is the OCCUPIED end (service + turnaround buffer) — that is the span
      // the conflict test uses. `finish` is when the customer is actually done.
      slotPush(slots, { start: t, end: t + dur + buf, finish: t + dur, free: free, reason: clash ? 'conflict' : (isPast ? 'past' : (beyondWindow ? 'window' : (tooSoon ? 'notice' : ''))) });
    }
    var freeCount = slots.filter(function (s) { return s.free; }).length;
    return { slots: slots, total: slots.length, free: freeCount, block: block, state: 'open' };
  }
  function slotPush(arr, o) { arr.push(o); }

  function isSlotFree(providerId, serviceId, dateS, startMin, excludeId, walkIn) {
    var r = slotsFor(providerId, serviceId, dateS, { excludeId: excludeId, walkIn: walkIn });
    for (var i = 0; i < r.slots.length; i++) {
      if (r.slots[i].start === startMin) return r.slots[i].free;
    }
    return false;
  }

  /* aggregated day health used by the calendar (works before a provider is chosen) */
  function daySummary(serviceId, providerId, dateS) {
    var provs = providerId ? [providerById(providerId)] : providersFor(serviceId || 'consult');
    provs = provs.filter(Boolean);
    var free = 0, total = 0, open = false;
    provs.forEach(function (p) {
      var r = slotsFor(p.id, serviceId || 'consult', dateS);
      if (r.state === 'open') { open = true; free += r.free; total += r.total; }
    });
    return { free: free, total: total, open: open };
  }

  /* ---------------- booking records ---------------- */

  function makeRef() {
    var s = '', i;
    for (i = 0; i < 6; i++) s += REF_ALPHABET.charAt(Math.floor(Math.random() * REF_ALPHABET.length));
    return 'BK-' + s;
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function nowIso() { return new Date().toISOString(); }

  function sorted() {
    return list.slice().sort(function (a, b) {
      return (a.date + ':' + pad(a.startMin)).localeCompare(b.date + ':' + pad(b.startMin));
    });
  }

  /* ---------------- payment ---------------- */
  function paymentFor(price, p) {
    if (!price) return { method: 'free', status: 'free', amount: 0 };
    if (p.payMethod === 'gcash' && !p.walkIn) {
      return { method: 'gcash', status: 'awaiting', amount: price, ref: String(p.payRef || '').trim() };
    }
    return { method: p.walkIn ? (p.payMethod || 'cash') : 'salon', status: p.walkIn && p.paid ? 'paid' : 'unpaid', amount: price };
  }

  /* ---------------- waitlist helpers ---------------- */
  function fulfilWaitlist(b) {
    var email = b.customer && b.customer.email, changed = false;
    if (!email) return;
    waitlist.forEach(function (w) {
      if ((w.status === 'waiting' || w.status === 'notified') && w.email === email && w.date === b.date) {
        w.status = 'fulfilled'; changed = true;
      }
    });
    if (changed) writeJSON(WAIT_KEY, waitlist);
  }

  /* After a slot is released, tell anyone waiting for that day. */
  function notifyWaitlist() {
    var changed = false;
    waitlist.forEach(function (w) {
      if (w.status !== 'waiting') return;
      var pool = w.providerId ? [providerById(w.providerId)] : providersFor(w.serviceId);
      var open = pool.some(function (pr) {
        return pr && slotsFor(pr.id, w.serviceId, w.date).free > 0;
      });
      if (open) { w.status = 'notified'; w.notifiedAt = nowIso(); changed = true; }
    });
    if (changed) writeJSON(WAIT_KEY, waitlist);
  }

  /* ---------------- staff schedule overrides ---------------- */
  var closureDates = [];
  function applySchedule(obj) {
    var saved = obj || readJSON(SCHED_KEY, null);
    if (!saved) return;
    PROVIDERS.forEach(function (pr) {
      var o = saved.providers && saved.providers[pr.id];
      if (!o) return;
      var hours = {};
      Object.keys(o.hours || {}).forEach(function (k) {
        var h = o.hours[k];
        if (h && h.length === 2 && h[0] < h[1]) hours[k] = [h[0], h[1]];
      });
      pr.hours = hours;
      pr.off = Array.isArray(o.off) ? o.off.slice() : [];
    });
    CLOSURES.length = 0;
    (saved.closures || []).forEach(function (c) { if (c && c.date) CLOSURES.push({ date: c.date, reason: c.reason || '' }); });
  }
  function saveSchedule() {
    var out = { providers: {}, closures: CLOSURES.filter(function (c) { return c && c.date; }) };
    PROVIDERS.forEach(function (pr) { out.providers[pr.id] = { hours: pr.hours, off: pr.off || [] }; });
    writeJSON(SCHED_KEY, out);
    if (cloudState() === 'on' && cloud.isStaff()) cloud.saveSchedule(out);
  }

  var Store = {
    CLINIC_TZ: CLINIC_TZ,
    STORE_KEY: STORE_KEY,
    WAIT_KEY: WAIT_KEY,
    MIN_NOTICE_MINUTES: MIN_NOTICE_MINUTES,
    BOOKING_WINDOW_DAYS: BOOKING_WINDOW_DAYS,
    SERVICES: SERVICES,
    PROVIDERS: PROVIDERS,
    Events: Events,
    U: U,

    init: function () {
      applySchedule();
      list = readList();
      waitlist = readJSON(WAIT_KEY, []);
      return Store;
    },
    reload: function () {
      list = readList();
      waitlist = readJSON(WAIT_KEY, []);
      return Store;
    },
    startSync: function () {
      if (global.BroadcastChannel) {
        try {
          channel = new BroadcastChannel(CHANNEL);
          channel.onmessage = function (ev) {
            if (ev && ev.data && ev.data.t === 'change') { Store.reload(); Events.emit('change', { remote: true }); }
          };
        } catch (e) { channel = null; }
      }
      if (global.addEventListener) {
        global.addEventListener('storage', function (e) {
          if (e.key === STORE_KEY || e.key === WAIT_KEY) { Store.reload(); Events.emit('change', { remote: true }); }
        });
      }
      return Store;
    },

    /* shared database (js/cloud.js) */
    attachCloud: function (c) { cloud = c; return Store; },
    cloudState: cloudState,
    cloudOn: function () { return cloudState() === 'on'; },
    intervalOf: intervalOf,
    whenSynced: function (id) { return chain[id] || Promise.resolve({ ok: true }); },
    lookupRemote: function (query) {
      if (cloudState() !== 'on') return Promise.resolve(0);
      return cloud.lookup(String(query || '').trim()).then(function (docs) {
        var n = 0;
        (docs || []).forEach(function (d) {
          if (!d || !d.id || !d.customer || !serviceById(d.serviceId) || !providerById(d.providerId)) return;
          if (Store.byId(d.id)) return;
          extras[d.id] = d; synced[d.id] = JSON.stringify(d); list.push(d); n++;
        });
        if (n) { persist(); Events.emit('change', { remote: true }); }
        return n;
      });
    },
    _remote: {
      bookings: applyRemoteBookings,
      days: function (map) { busy = map || {}; notifyWaitlist(); Events.emit('change', { remote: true }); },
      schedule: function (obj) { if (!obj) return; writeJSON(SCHED_KEY, obj); applySchedule(obj); Events.emit('change', { remote: true }); },
      state: function () { Events.emit('change', { remote: true }); }
    },

    serviceById: serviceById,
    serviceParts: serviceParts,
    bundleId: bundleId,
    canDeliver: canDeliver,
    providerById: providerById,
    providersFor: providersFor,
    workingBlock: workingBlock,
    slotsFor: slotsFor,
    isSlotFree: isSlotFree,
    daySummary: daySummary,

    all: sorted,
    raw: function () { return list; },
    byId: function (id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    byRef: function (ref) {
      var q = String(ref || '').trim().toUpperCase();
      for (var i = 0; i < list.length; i++) if (String(list[i].ref).toUpperCase() === q) return list[i];
      return null;
    },
    mine: function (query) {
      var q = String(query || '').trim().toLowerCase();
      if (!q) return [];
      return sorted().filter(function (b) {
        return (b.customer.email && b.customer.email.toLowerCase() === q) ||
               String(b.ref).toLowerCase() === q;
      });
    },
    upcoming: function (filterFn) {
      var now = Date.now();
      return sorted().filter(function (b) {
        if (b.status === 'cancelled') return false;
        if (filterFn && !filterFn(b)) return false;
        return instantOf(b.date, b.startMin).getTime() > now;
      });
    },
    past: function () {
      var now = Date.now();
      return sorted().filter(function (b) { return instantOf(b.date, b.startMin).getTime() <= now; });
    },

    /* --- mutations --- */

    book: function (p) {
      if (cloudState() === 'connecting') return { ok: false, error: 'connecting' };
      var service = serviceById(p.serviceId), provider = providerById(p.providerId);
      if (!service || !provider) return { ok: false, error: 'invalid-selection' };
      if (!canDeliver(provider, service.id)) return { ok: false, error: 'provider-skill' };
      if (!Store.isSlotFree(provider.id, service.id, p.date, p.startMin, null, !!p.walkIn)) return { ok: false, error: 'slot-unavailable' };

      var clash = false, ref;
      do { ref = makeRef(); } while (Store.byRef(ref));

      var booking = {
        id: uid('bk'),
        ref: ref,
        uid: (cloudState() === 'on' && cloud.uid()) || '',
        serviceId: service.id,
        providerId: provider.id,
        date: p.date,
        startMin: p.startMin,
        minutes: service.minutes,
        price: service.price,
        payment: paymentFor(service.price, p),
        source: p.walkIn ? 'walk-in' : 'online',
        customer: {
          name: String(p.name || '').trim() || (p.walkIn ? 'Walk-in guest' : ''),
          email: String(p.email || '').trim().toLowerCase(),
          phone: String(p.phone || '').trim(),
          notes: String(p.notes || '').trim()
        },
        reminder: p.reminder || 'none',
        status: (p.payMethod === 'gcash' && service.price > 0 && !p.walkIn) ? 'pending' : 'confirmed',
        tzAtBooking: p.tz || CLINIC_TZ,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revisions: 0,
        history: [{ at: nowIso(), action: 'created', detail: (p.walkIn ? 'Walk-in: ' : 'Booked ') + service.name + ' with ' + provider.name }]
      };
      list.push(booking);
      fulfilWaitlist(booking);
      announce();
      return { ok: true, booking: booking, clash: clash };
    },

    setStatus: function (id, status, detail) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      if (status !== 'cancelled' && status !== 'confirmed') {
        if (b.status === status) return { ok: true, booking: b };
      }
      if (status === 'confirmed' && b.status === 'cancelled') {
        if (!Store.isSlotFree(b.providerId, b.serviceId, b.date, b.startMin, b.id)) {
          return { ok: false, error: 'slot-taken' };
        }
        b.cancelledAt = null;
      }
      if (status === 'confirmed' && b.payment && b.payment.status === 'awaiting') status = 'pending';
      b.status = status;
      b.updatedAt = nowIso();
      if (status === 'cancelled') b.cancelledAt = nowIso();
      if (status === 'completed' && b.payment && b.payment.status === 'unpaid') { b.payment.status = 'paid'; b.payment.paidAt = nowIso(); }
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: status, detail: detail || ('Marked ' + status) });
      if (status === 'cancelled') notifyWaitlist();
      announce();
      return { ok: true, booking: b };
    },

    /* Staff confirms that a GCash deposit/payment arrived (pending -> confirmed). */
    confirmPayment: function (id) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      b.payment = b.payment || { method: 'gcash', amount: b.price };
      b.payment.status = 'paid'; b.payment.paidAt = nowIso();
      if (b.status === 'pending') b.status = 'confirmed';
      b.updatedAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: 'paid', detail: 'Payment received (' + (b.payment.method || 'cash') + ') — booking confirmed' });
      announce();
      return { ok: true, booking: b };
    },

    markPaid: function (id, method) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      b.payment = b.payment || { amount: b.price };
      b.payment.status = 'paid'; b.payment.paidAt = nowIso();
      if (method) b.payment.method = method;
      b.updatedAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: 'paid', detail: 'Marked paid (' + (b.payment.method || 'cash') + ')' });
      announce();
      return { ok: true, booking: b };
    },

    /* --- reviews --- */
    addReview: function (id, stars, text) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      var done = b.status === 'completed' || (b.status === 'confirmed' && instantOf(b.date, b.startMin).getTime() < Date.now());
      if (!done) return { ok: false, error: 'not-finished' };
      if (b.review) return { ok: false, error: 'already-reviewed' };
      stars = Math.round(Number(stars));
      if (!(stars >= 1 && stars <= 5)) return { ok: false, error: 'bad-rating' };
      b.review = { stars: stars, text: String(text || '').trim().slice(0, 400), at: nowIso() };
      b.updatedAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: 'reviewed', detail: 'Left a ' + stars + '-star review' });
      announce();
      return { ok: true, booking: b };
    },
    ratingFor: function (providerId) {
      var n = 0, sum = 0;
      list.forEach(function (b) {
        if (b.review && (!providerId || b.providerId === providerId)) { n++; sum += b.review.stars; }
      });
      return { count: n, avg: n ? Math.round((sum / n) * 10) / 10 : 0 };
    },

    /* --- staff schedule --- */
    getSchedule: function () {
      return {
        providers: PROVIDERS.map(function (pr) { return { id: pr.id, name: pr.name, role: pr.role, hours: JSON.parse(JSON.stringify(pr.hours)), off: (pr.off || []).slice() }; }),
        closures: CLOSURES.filter(function (c) { return c && c.date; }).map(function (c) { return { date: c.date, reason: c.reason }; })
      };
    },
    setHours: function (providerId, hours) {
      var pr = providerById(providerId);
      if (!pr) return { ok: false, error: 'not-found' };
      var clean = {};
      for (var d = 0; d < 7; d++) {
        var h = hours && hours[d];
        if (!h) continue;
        if (!(h[0] >= 0 && h[1] <= 1440 && h[0] < h[1])) return { ok: false, error: 'bad-hours', day: d };
        clean[d] = [h[0], h[1]];
      }
      pr.hours = clean; saveSchedule(); announce();
      return { ok: true };
    },
    addDayOff: function (providerId, dateS) {
      var pr = providerById(providerId);
      if (!pr || !/^\d{4}-\d{2}-\d{2}$/.test(dateS)) return { ok: false, error: 'bad-input' };
      pr.off = pr.off || [];
      if (pr.off.indexOf(dateS) < 0) pr.off.push(dateS);
      pr.off.sort(); saveSchedule(); announce();
      return { ok: true };
    },
    removeDayOff: function (providerId, dateS) {
      var pr = providerById(providerId);
      if (!pr) return { ok: false, error: 'not-found' };
      pr.off = (pr.off || []).filter(function (x) { return x !== dateS; });
      saveSchedule(); announce();
      notifyWaitlist();
      return { ok: true };
    },
    addClosure: function (dateS, reason) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateS)) return { ok: false, error: 'bad-input' };
      if (!CLOSURES.some(function (c) { return c && c.date === dateS; })) CLOSURES.push({ date: dateS, reason: reason || '' });
      saveSchedule(); announce();
      return { ok: true };
    },
    removeClosure: function (dateS) {
      for (var i = CLOSURES.length - 1; i >= 0; i--) if (CLOSURES[i] && CLOSURES[i].date === dateS) CLOSURES.splice(i, 1);
      saveSchedule(); announce(); notifyWaitlist();
      return { ok: true };
    },
    resetSchedule: function () {
      try { if (global.localStorage) global.localStorage.removeItem(SCHED_KEY); } catch (e) {}
      return { ok: true };
    },

    reschedule: function (id, dateS, startMin) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      if (b.status === 'cancelled') return { ok: false, error: 'cancelled' };
      if (!Store.isSlotFree(b.providerId, b.serviceId, dateS, startMin, b.id)) return { ok: false, error: 'slot-unavailable' };
      var from = U.rangeLabel(b.date, b.startMin, b.minutes, CLINIC_TZ);
      b.date = dateS;
      b.startMin = startMin;
      b.revisions = (b.revisions || 0) + 1;
      b.updatedAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: 'rescheduled', detail: 'Moved from ' + from + ' to ' + U.rangeLabel(dateS, startMin, b.minutes, CLINIC_TZ) });
      notifyWaitlist();
      announce();
      return { ok: true, booking: b };
    },

    updateCustomer: function (id, patch) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      b.customer = b.customer || {};
      Object.keys(patch || {}).forEach(function (k) { b.customer[k] = patch[k]; });
      b.updatedAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: 'edited', detail: 'Customer details updated' });
      announce();
      return { ok: true, booking: b };
    },

    setReminder: function (id, reminder) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      b.reminder = reminder;
      b.updatedAt = nowIso();
      announce();
      return { ok: true, booking: b };
    },

    /* --- waitlist --- */

    joinWaitlist: function (p) {
      var email = String(p.email || '').trim().toLowerCase();
      var dup = waitlist.filter(function (w) {
        return (w.status === 'waiting' || w.status === 'notified') && w.email === email && w.serviceId === p.serviceId &&
          (w.providerId || '') === (p.providerId || '') && w.date === p.date;
      })[0];
      if (dup) return { ok: true, entry: dup, existing: true };
      var entry = {
        id: uid('wl'), serviceId: p.serviceId, providerId: p.providerId || '', date: p.date,
        email: email, name: String(p.name || '').trim(),
        createdAt: nowIso(), status: 'waiting'
      };
      waitlist.push(entry);
      writeJSON(WAIT_KEY, waitlist);
      announce();
      return { ok: true, entry: entry };
    },
    leaveWaitlist: function (id) {
      waitlist = waitlist.filter(function (w) { return w.id !== id; });
      writeJSON(WAIT_KEY, waitlist);
      announce();
    },
    /* waitlist entries for one customer that are still live */
    waitlistFor: function (email) {
      email = String(email || '').trim().toLowerCase();
      return waitlist.filter(function (w) { return w.email === email && (w.status === 'waiting' || w.status === 'notified'); });
    },
    waitlistAll: function () { return waitlist.slice(); },

    /* --- bulk --- */

    clearAll: function () {
      if (cloudState() === 'on') return;   // never wipe the shared database from the browser
      list = []; waitlist = [];
      persist(); writeJSON(WAIT_KEY, waitlist);
      announce();
    },

    /* populate a believable back-catalogue so the dashboard is not empty */
    seedDemo: function (count) {
      if (cloudState() === 'on') return 0;   // demo data stays out of the shared database
      count = count || 26;
      var names = ['Olivia Turner', 'Tom Whitfield', 'Jessica Reed', 'Luke Harrison', 'Grace Miller',
        'Daniel Foster', 'Hannah Cole', 'Jacob Morgan', 'Ella Parker', 'Sam Rutherford',
        'Mia Collins', 'Oliver Grant', 'Fiona Walsh', 'Jack Watson', 'Chloe Ward'];
      var notes = ['Bringing a reference photo.', 'First visit, referred by a friend.', 'Prefers a quiet room.',
        'Please use fragrance-free products.', 'May arrive a few minutes early.', '', ''];
      var reminders = ['none', '1h', '1d'];
      var created = 0, i = 0, guard = 0;
      var base = todayStr(CLINIC_TZ);
      while (created < count && guard < count * 40) {
        guard++;
        var offset = -14 + Math.floor(Math.random() * 32);
        var dateS = addDaysStr(base, offset);
        var service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
        var pool = providersFor(service.id);
        if (!pool.length) continue;
        var provider = pool[Math.floor(Math.random() * pool.length)];
        var r = slotsFor(provider.id, service.id, dateS);
        var open = r.slots.filter(function (s) { return s.free; });
        if (!open.length) continue;
        var slot = open[Math.floor(Math.random() * open.length)];
        var name = names[i % names.length];
        i++;
        var isPast = instantOf(dateS, slot.start).getTime() < Date.now();
        var status = isPast ? 'completed' : 'confirmed';
        if (!isPast && Math.random() < 0.12) status = 'cancelled';

        list.push({
          id: uid('bk'),
          ref: makeRef(),
          serviceId: service.id,
          providerId: provider.id,
          date: dateS,
          startMin: slot.start,
          minutes: service.minutes,
          price: service.price,
          customer: {
            name: name,
            email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com',
            phone: '+44 7700 900' + (100 + Math.floor(Math.random() * 800)),
            notes: notes[Math.floor(Math.random() * notes.length)]
          },
          reminder: reminders[Math.floor(Math.random() * reminders.length)],
          status: status,
          tzAtBooking: CLINIC_TZ,
          createdAt: new Date(Date.now() - Math.floor(Math.random() * 12) * 86400000).toISOString(),
          updatedAt: nowIso(),
          revisions: Math.random() < 0.2 ? 1 : 0,
          history: [{ at: nowIso(), action: 'created', detail: 'Seeded demo booking' }]
        });
        created++;
      }
      waitlist = waitlist.concat([
        { id: uid('wl'), serviceId: 'hilot', providerId: 'ren', date: addDaysStr(base, 9), email: 'waiting@example.com', name: 'Wendy Clark', createdAt: nowIso(), status: 'waiting' },
        { id: uid('wl'), serviceId: 'rebond', providerId: 'ada', date: addDaysStr(base, 4), email: 'queue@example.com', name: 'Noah Bennett', createdAt: nowIso(), status: 'waiting' }
      ]);
      writeJSON(WAIT_KEY, waitlist);
      announce();
      return created;
    }
  };

  /* ---------------- calendar files ---------------- */

  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function icsStamp(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function ICS(booking) {
    var service = serviceById(booking.serviceId) || { name: 'Appointment' };
    var provider = providerById(booking.providerId) || { name: 'Northlight team' };
    var start = instantOf(booking.date, booking.startMin);
    var end = new Date(start.getTime() + booking.minutes * 60000);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Northlight Studio//Booking//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + booking.ref + '@northlight.studio',
      'DTSTAMP:' + icsStamp(new Date()),
      'DTSTART:' + icsStamp(start),
      'DTEND:' + icsStamp(end),
      'SUMMARY:' + icsEscape(service.name + ' — Northlight Studio'),
      'DESCRIPTION:' + icsEscape('Reference ' + booking.ref + '\\nWith ' + provider.name + ' (' + provider.role + ')\\nService: ' + service.name + ' (' + booking.minutes + ' min)' + (booking.customer && booking.customer.notes ? '\\nNotes: ' + booking.customer.notes : '')),
      'LOCATION:' + icsEscape('Northlight Studio, 14 Aldwych Lane, London (online link emailed)'),
      'STATUS:CONFIRMED',
      'SEQUENCE:' + (booking.revisions || 0),
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape('Reminder: ' + service.name + ' at Northlight'),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.join('\r\n');
  }

  function googleCalendarUrl(booking) {
    var service = serviceById(booking.serviceId) || { name: 'Appointment' };
    var provider = providerById(booking.providerId) || { name: 'Northlight' };
    var start = instantOf(booking.date, booking.startMin);
    var end = new Date(start.getTime() + booking.minutes * 60000);
    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(service.name + ' — Northlight Studio'),
      'dates=' + icsStamp(start) + '/' + icsStamp(end),
      'details=' + encodeURIComponent('Reference ' + booking.ref + ' · with ' + provider.name),
      'location=' + encodeURIComponent('Northlight Studio, 14 Aldwych Lane, London')
    ];
    return 'https://calendar.google.com/calendar/render?' + params.join('&');
  }

  /* ---------------- prefs ---------------- */

  var Prefs = {
    all: function () { return readJSON(PREF_KEY, {}); },
    get: function (k, d) { var a = this.all(); return a[k] === undefined ? d : a[k]; },
    set: function (patch) {
      var a = this.all();
      Object.keys(patch || {}).forEach(function (k) { a[k] = patch[k]; });
      writeJSON(PREF_KEY, a);
      return a;
    }
  };

  /* ---------------- export ---------------- */

  var NS = {
    CLINIC_TZ: CLINIC_TZ,
    CURRENCY: CURRENCY,
    GCASH: GCASH,
    SERVICES: SERVICES,
    PROVIDERS: PROVIDERS,
    CLOSURES: CLOSURES,
    U: U,
    Store: Store,
    Prefs: Prefs,
    Events: Events,
    ICS: ICS,
    googleCalendarUrl: googleCalendarUrl,
    MIN_NOTICE_MINUTES: MIN_NOTICE_MINUTES,
    BOOKING_WINDOW_DAYS: BOOKING_WINDOW_DAYS,
    uid: uid,
    nowIso: nowIso,
    SCHED_KEY: SCHED_KEY,
    STORE_KEY: STORE_KEY,
    WAIT_KEY: WAIT_KEY
  };

  // Public subscription alias. app.js / admin.js call Store.on(type, fn);
  // assigning it here (after the object literal exists) keeps it reliable.
  Store.on = function (type, fn) { Events.on(type, fn); return Store; };
  Store.off = function (type, fn) {
    var h = Events.handlers[type] || [];
    var i = h.indexOf(fn); if (i >= 0) h.splice(i, 1);
  };

  Store.init();

  global.NS = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;

})(typeof window !== 'undefined' ? window : globalThis);