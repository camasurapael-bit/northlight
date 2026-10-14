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
  var CHANNEL = 'northlight.realtime.v1';

  var MIN_NOTICE_MINUTES = 120;   // earliest bookable start from now
  var BOOKING_WINDOW_DAYS = 60;   // how far ahead you can book
  var REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* Money: ONE place to change currency for the entire app. */
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

  function serviceById(id) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i];
    return null;
  }
  function providerById(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return null;
  }
  function providersFor(serviceId) {
    return PROVIDERS.filter(function (p) { return p.services.indexOf(serviceId) >= 0; });
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
  var busy = [];   // other customers' time blocks from the shared database (no personal data)

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
  }

  /* ---------------- availability engine ---------------- */

  function occupiedIntervals(dateS, providerId, excludeId) {
    var out = list.filter(function (b) {
      return b.providerId === providerId && b.date === dateS && b.status !== 'cancelled' && b.id !== excludeId;
    }).map(function (b) {
      var s = serviceById(b.serviceId) || { buffer: 0 };
      var mins = b.minutes || (s.minutes || 30);
      return { start: b.startMin, end: b.startMin + mins + (s.buffer || 0) };
    });
    if (busy.length) {
      var known = {};
      list.forEach(function (b) { known[b.id] = true; });
      busy.forEach(function (x) {
        // a booking we hold locally is judged by its local state; the stub only covers other people's
        if (known[x.id] || x.id === excludeId || x.providerId !== providerId || x.date !== dateS) return;
        var s = serviceById(x.serviceId) || { buffer: 0 };
        out.push({ start: x.startMin, end: x.startMin + x.minutes + (s.buffer || 0) });
      });
    }
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
    if (provider.services.indexOf(serviceId) < 0) return { slots: [], total: 0, free: 0, block: null, state: 'not-offered' };

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
      var tooSoon = instantOf(dateS, t).getTime() < earliest;
      var free = !clash && !isPast && !beyondWindow && !tooSoon;
      // `end` is the OCCUPIED end (service + turnaround buffer) — that is the span
      // the conflict test uses. `finish` is when the customer is actually done.
      slotPush(slots, { start: t, end: t + dur + buf, finish: t + dur, free: free, reason: clash ? 'conflict' : (isPast ? 'past' : (beyondWindow ? 'window' : (tooSoon ? 'notice' : ''))) });
    }
    var freeCount = slots.filter(function (s) { return s.free; }).length;
    return { slots: slots, total: slots.length, free: freeCount, block: block, state: 'open' };
  }
  function slotPush(arr, o) { arr.push(o); }

  function isSlotFree(providerId, serviceId, dateS, startMin, excludeId) {
    var r = slotsFor(providerId, serviceId, dateS, { excludeId: excludeId });
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

  function localByRef(ref) {
    var q = String(ref || '').trim().toUpperCase();
    for (var i = 0; i < list.length; i++) if (String(list[i].ref).toUpperCase() === q) return list[i];
    return null;
  }

  function sorted() {
    return list.slice().sort(function (a, b) {
      return (a.date + ':' + pad(a.startMin)).localeCompare(b.date + ':' + pad(b.startMin));
    });
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

    /* set by js/cloud.js when the shared database (Supabase, via /api/bookings) is reachable */
    sync: null,
    isCloud: function () { return !!(Store.sync && Store.sync.enabled); },

    init: function () {
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

    serviceById: serviceById,
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
      var b = localByRef(ref);
      if (!b && Store.isCloud()) Store.sync.lookup(String(ref || '').trim());
      return b;
    },
    /* promise version for callers that must wait for the shared database (deep links) */
    findRef: function (ref) {
      var b = localByRef(ref);
      if (b || !Store.sync) return Promise.resolve(b);
      return Store.sync.lookupRef(String(ref || '').trim()).then(function () { return localByRef(ref); });
    },
    mine: function (query) {
      var q = String(query || '').trim().toLowerCase();
      if (!q) return [];
      if (Store.isCloud()) Store.sync.lookup(q);   // refresh in the background; 'change' fires when it lands
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

    /* --- shared database --- */

    /* o.bookings: upsert (or replace the whole list with o.replace); o.drop: refs the server
       does not know; o.only: keep just these refs (used when staff sign out); o.busy / o.waitlist. */
    applyRemote: function (o) {
      o = o || {};
      var before = JSON.stringify([list, busy, waitlist]);
      if (o.busy) busy = o.busy;
      if (o.waitlist) { waitlist = o.waitlist; writeJSON(WAIT_KEY, waitlist); }
      if (o.bookings) {
        var incoming = o.bookings.filter(function (b) { return b && serviceById(b.serviceId) && providerById(b.providerId) && b.customer; });
        if (o.replace) list = incoming;
        else {
          var byId = {};
          incoming.forEach(function (b) { byId[b.id] = b; });
          list = list.map(function (b) { return byId[b.id] || b; });
          var have = {};
          list.forEach(function (b) { have[b.id] = true; });
          incoming.forEach(function (b) { if (!have[b.id]) list.push(b); });
        }
      }
      if (o.drop && o.drop.length) {
        var gone = {};
        o.drop.forEach(function (r) { gone[String(r).toUpperCase()] = true; });
        list = list.filter(function (b) { return !gone[String(b.ref).toUpperCase()]; });
      }
      if (o.only) {
        var keep = {};
        o.only.forEach(function (r) { keep[String(r).toUpperCase()] = true; });
        list = list.filter(function (b) { return keep[String(b.ref).toUpperCase()]; });
      }
      if (JSON.stringify([list, busy, waitlist]) === before) return false;
      persist();
      Events.emit('change', { remote: true });
      broadcast();
      return true;
    },

    /* books through the shared database when it is on (slot is re-checked server-side), else locally */
    bookAsync: function (p) {
      if (!Store.isCloud()) return Promise.resolve(Store.book(p));
      var service = serviceById(p.serviceId), provider = providerById(p.providerId);
      if (!service || !provider) return Promise.resolve({ ok: false, error: 'invalid-selection' });
      if (provider.services.indexOf(service.id) < 0) return Promise.resolve({ ok: false, error: 'provider-skill' });
      return Store.sync.create(p).then(function (res) {
        if (res && res.ok && res.booking) Store.applyRemote({ bookings: [res.booking] });
        return res;
      });
    },

    /* --- mutations --- */

    book: function (p) {
      var service = serviceById(p.serviceId), provider = providerById(p.providerId);
      if (!service || !provider) return { ok: false, error: 'invalid-selection' };
      if (provider.services.indexOf(service.id) < 0) return { ok: false, error: 'provider-skill' };
      if (!Store.isSlotFree(provider.id, service.id, p.date, p.startMin)) return { ok: false, error: 'slot-unavailable' };

      var clash = false, ref;
      do { ref = makeRef(); } while (localByRef(ref));

      var booking = {
        id: uid('bk'),
        ref: ref,
        serviceId: service.id,
        providerId: provider.id,
        date: p.date,
        startMin: p.startMin,
        minutes: service.minutes,
        price: service.price,
        customer: {
          name: String(p.name || '').trim(),
          email: String(p.email || '').trim().toLowerCase(),
          phone: String(p.phone || '').trim(),
          notes: String(p.notes || '').trim()
        },
        reminder: p.reminder || 'none',
        status: 'confirmed',
        tzAtBooking: p.tz || CLINIC_TZ,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revisions: 0,
        history: [{ at: nowIso(), action: 'created', detail: 'Booked ' + service.name + ' with ' + provider.name }]
      };
      list.push(booking);
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
      b.status = status;
      b.updatedAt = nowIso();
      if (status === 'cancelled') b.cancelledAt = nowIso();
      b.history = b.history || [];
      b.history.push({ at: nowIso(), action: status, detail: detail || ('Marked ' + status) });
      announce();
      if (Store.isCloud()) Store.sync.push('status', b, { status: status, detail: detail || ('Marked ' + status) });
      return { ok: true, booking: b };
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
      announce();
      if (Store.isCloud()) Store.sync.push('reschedule', b, { date: dateS, startMin: startMin });
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
      if (Store.isCloud()) Store.sync.push('update', b, { customer: patch });
      return { ok: true, booking: b };
    },

    setReminder: function (id, reminder) {
      var b = Store.byId(id);
      if (!b) return { ok: false, error: 'not-found' };
      b.reminder = reminder;
      b.updatedAt = nowIso();
      announce();
      if (Store.isCloud()) Store.sync.push('update', b, { reminder: reminder });
      return { ok: true, booking: b };
    },

    /* --- waitlist --- */

    joinWaitlist: function (p) {
      var entry = {
        id: uid('wl'), serviceId: p.serviceId, providerId: p.providerId, date: p.date,
        email: String(p.email || '').trim().toLowerCase(), name: String(p.name || '').trim(),
        createdAt: nowIso(), status: 'waiting'
      };
      waitlist.push(entry);
      writeJSON(WAIT_KEY, waitlist);
      announce();
      if (Store.isCloud()) Store.sync.pushWaitlist(entry);
      return { ok: true, entry: entry };
    },
    waitlistAll: function () { return waitlist.slice(); },

    /* --- bulk --- */

    clearAll: function () {
      list = []; waitlist = [];
      persist(); writeJSON(WAIT_KEY, waitlist);
      announce();
    },

    /* populate a believable back-catalogue so the dashboard is not empty */
    seedDemo: function (count) {
      count = count || 26;
      var names = ['Olivia Turner', 'Tom Whitfield', 'Jessica Reed', 'Luke Harrison', 'Grace Miller',
        'Daniel Foster', 'Hannah Cole', 'Jacob Morgan', 'Ella Parker', 'Sam Rutherford',
        'Mia Collins', 'Oliver Grant', 'Fiona Walsh', 'Jack Watson', 'Chloe Ward'];
      var notes = ['Bringing a reference photo.', 'First visit, referred by a friend.', 'Prefers a quiet room.',
        'Please use fragrance-free products.', 'May arrive a few minutes early.', '', ''];
      var reminders = ['none', '1h', '1d'];
      var created = 0, i = 0, guard = 0;
      var startLen = list.length;
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
      var madeWait = [
        { id: uid('wl'), serviceId: 'hilot', providerId: 'ren', date: addDaysStr(base, 9), email: 'waiting@example.com', name: 'Wendy Clark', createdAt: nowIso(), status: 'waiting' },
        { id: uid('wl'), serviceId: 'rebond', providerId: 'ada', date: addDaysStr(base, 4), email: 'queue@example.com', name: 'Noah Bennett', createdAt: nowIso(), status: 'waiting' }
      ];
      waitlist = waitlist.concat(madeWait);
      writeJSON(WAIT_KEY, waitlist);
      announce();
      if (Store.isCloud()) Store.sync.importMany(list.slice(startLen), madeWait);
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