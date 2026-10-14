/* ============================================================
   Northlight — English / Tagalog switch.
   Works by swapping exact text (and placeholders) that appear in the dictionary below,
   including text the app inserts later. Text not in the dictionary simply stays in English.
   To add or fix a translation, edit the TL table.
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'northlight.prefs.v1';
  var TL = {
    /* navigation + header */
    'Book': 'Mag-book', 'My bookings': 'Mga booking ko', 'Admin': 'Admin', 'live': 'live',
    'Studio Booking': 'Booking sa Studio', 'Sign in': 'Mag-sign in', 'Sign out': 'Mag-sign out',
    /* sign in */
    'Account required to book': 'Kailangan ng account para mag-book', 'Sign in to': 'Mag-sign in sa',
    'One account keeps your appointments, reschedules and reminders in one place.': 'Isang account lang para sa lahat ng appointment, reschedule at paalala mo.',
    'Log in': 'Mag-log in', 'Create account': 'Gumawa ng account', 'Continue with': 'Magpatuloy gamit ang',
    'Sign in with a Gmail code': 'Mag-sign in gamit ang Gmail code', 'or use your email': 'o gamitin ang iyong email',
    'Email': 'Email', 'Password': 'Password', 'Keep me signed in': 'Manatiling naka-sign in', 'Forgot password?': 'Nakalimutan ang password?',
    'No account on this device yet?': 'Wala pang account sa device na ito?', 'Create one': 'Gumawa ng isa', '— it takes a moment.': '— sandali lang.',
    'Full name': 'Buong pangalan', 'Confirm password': 'Kumpirmahin ang password',
    'I agree to the terms and the 24-hour cancellation policy.': 'Sumasang-ayon ako sa mga tuntunin at sa 24-oras na patakaran sa pagkansela.',
    'Create account & continue': 'Gumawa ng account at magpatuloy', 'Already registered here?': 'Nakarehistro ka na rito?', 'Log in instead': 'Mag-log in na lang',
    'Not ready to sign up?': 'Hindi pa handang mag-sign up?', 'Find an existing booking as a guest': 'Maghanap ng booking bilang guest', 'Keep browsing': 'Magpatuloy sa pag-browse',
    'Why an account?': 'Bakit kailangan ng account?', 'Everything in one place': 'Lahat nasa isang lugar',
    'Every appointment, reschedule and cancellation on one timeline.': 'Bawat appointment, reschedule at kanselasyon sa iisang timeline.',
    'Reminders that reach you': 'Mga paalalang aabot sa iyo', 'Browser notifications one hour before, plus a calendar invite.': 'Notification isang oras bago ang appointment, kasama ang calendar invite.',
    'Timezone-safe': 'Tama ang oras saan ka man', 'Bookings stored in studio time, shown in yours — Philippine time included.': 'Naka-save sa oras ng studio, ipinapakita sa oras mo — kasama ang oras sa Pilipinas.',
    'Prices in pesos': 'Presyo sa piso', 'Sessions are quoted and totalled in ₱ with no conversion surprises.': 'Nasa ₱ ang presyo at kabuuan, walang sorpresa sa palitan.',
    'Enter your Gmail address. We will email you a 6-digit code.': 'Ilagay ang iyong Gmail. Magpapadala kami ng 6-digit na code.',
    'Gmail address': 'Gmail address', 'Send code': 'Ipadala ang code', 'Enter your code': 'Ilagay ang code', '6-digit code': '6-digit na code',
    'Verify & sign in': 'I-verify at mag-sign in', 'Resend code': 'Ipadala ulit ang code', 'Use another Gmail': 'Gumamit ng ibang Gmail', 'Sign in with Gmail': 'Mag-sign in gamit ang Gmail',
    'Your name': 'Pangalan mo',
    /* hero + live desk */
    'Live availability ·': 'Live na availability ·', 'Book time with the': 'Mag-book ng oras sa',  'team.': 'team.',
    'Pick a service, choose a specialist, take a slot. Every booking is validated in real time against working hours, travel buffers and existing appointments — so double-booking is structurally impossible, not just unlikely.': 'Pumili ng serbisyo, pumili ng espesyalista, kunin ang oras. Bawat booking ay chine-check agad sa oras ng trabaho at sa mga kasalukuyang appointment — kaya imposible ang double-booking.',
    'Start a booking': 'Magsimulang mag-book', 'Find my booking': 'Hanapin ang booking ko', 'Conflict-free slots': 'Walang banggaang oras', '.ics invite': '.ics invite',
    'Reschedule & cancel': 'Reschedule at kansela', 'CSV export': 'CSV export', 'Live desk': 'Live desk', 'Clinic timezone': 'Oras ng studio', 'Your timezone': 'Oras mo',
    'open now': 'bukas ngayon', 'closed': 'sarado', 'Next up': 'Susunod', 'No upcoming appointments yet.': 'Wala pang paparating na appointment.', 'Book the first one': 'I-book ang una',
    'studio': 'studio', 'yours': 'sa iyo', 'Remind me': 'Paalalahanan ako', 'Reminders on': 'Naka-on ang paalala',
    /* booking steps */
    'Choose service(s)': 'Pumili ng serbisyo', 'nothing selected': 'wala pang napili', 'Tap more than one to combine them in a single visit.': 'Pumili ng higit sa isa para pagsamahin sa iisang bisita.',
    'Choose a specialist': 'Pumili ng espesyalista', 'pick one': 'pumili ng isa', 'pick a service first': 'pumili muna ng serbisyo', 'Pick a date': 'Pumili ng petsa',
    'slots free': 'may bakante', 'nearly full': 'halos puno', 'closed / full': 'sarado / puno',
    'Mon': 'Lun', 'Tue': 'Mar', 'Wed': 'Miy', 'Thu': 'Huw', 'Fri': 'Biy', 'Sat': 'Sab', 'Sun': 'Lin',
    'Pick a time': 'Pumili ng oras', 'pick a date ': 'pumili ng petsa', 'not ready': 'hindi pa handa', 'Times are shown in your selected timezone.': 'Ipinapakita ang oras ayon sa napili mong timezone.',
    'Jump to the next free day': 'Pumunta sa susunod na bakanteng araw', '🔔 Notify me if a slot opens this day': '🔔 Abisuhan ako kung may mabakante sa araw na ito',
    'Choose a service to unlock times.': 'Pumili ng serbisyo para makita ang mga oras.', 'Choose a specialist to see their day.': 'Pumili ng espesyalista para makita ang iskedyul.',
    'Pick a date and the free times appear here.': 'Pumili ng petsa at lalabas dito ang mga bakanteng oras.',
    'Your details': 'Iyong detalye', 'Service': 'Serbisyo', 'Specialist': 'Espesyalista', 'When': 'Kailan', 'Total': 'Kabuuan', 'Phone': 'Telepono', 'optional': 'opsyonal',
    'Anything we should prepare?': 'May dapat ba kaming ihanda?', 'Payment': 'Bayad', 'Pay at the salon': 'Magbayad sa salon',
    'Cash, GCash or card on the day. Your slot is confirmed right away.': 'Cash, GCash o card sa mismong araw. Kumpirmado agad ang oras mo.',
    'Pay now with GCash': 'Magbayad ngayon gamit ang GCash', 'Your slot is held until we confirm your payment.': 'Hawak ang oras mo hanggang makumpirma namin ang bayad.',
    'to GCash number:': 'sa GCash number:', 'Copy': 'Kopyahin', 'Account name:': 'Pangalan ng account:', 'GCash reference number': 'GCash reference number',
    'I agree to the cancellation policy (free up to 24h before) and to receive a confirmation email.': 'Sumasang-ayon ako sa patakaran sa pagkansela (libre hanggang 24 oras bago) at sa pagtanggap ng confirmation.',
    'Confirm booking': 'Kumpirmahin ang booking', 'Clear form': 'I-clear ang form', 'Select a service, specialist, date and time to continue.': 'Pumili ng serbisyo, espesyalista, petsa at oras para magpatuloy.',
    'Reserving…': 'Nire-reserve…', 'Booking confirmed': 'Kumpirmado ang booking', 'Booking reserved': 'Naka-reserve ang booking',
    'Download .ics': 'I-download ang .ics', 'Add to Google Calendar': 'Idagdag sa Google Calendar', 'Copy booking link': 'Kopyahin ang link ng booking', 'Print ticket': 'I-print ang ticket', 'Manage booking': 'I-manage ang booking',
    /* my bookings */
    'Manage a booking': 'I-manage ang booking', 'lookup': 'hanapin', 'Find': 'Hanapin', 'Reschedule': 'I-reschedule', 'Cancel': 'Kanselahin', 'Reinstate': 'Ibalik', 'Details': 'Detalye',
    'Upcoming': 'Paparating', 'Past': 'Nakaraan', 'All': 'Lahat', 'Book again': 'Mag-book ulit', '★ Rate visit': '★ I-rate ang bisita', 'Rate your visit': 'I-rate ang bisita mo',
    'Submit review': 'Isumite ang review', 'Not now': 'Mamaya na', 'Comment': 'Komento', 'Thank you!': 'Salamat!',
    'No upcoming bookings. Check the Past tab, or book a new visit.': 'Walang paparating na booking. Tingnan ang Nakaraan, o mag-book ng bago.',
    'confirmed': 'kumpirmado', 'cancelled': 'nakansela', 'completed': 'tapos na', 'awaiting payment': 'hinihintay ang bayad', 'pending': 'nakabinbin',
    'free to cancel': 'libre ang pagkansela', 'late cancellation': 'huling kansela', 'Yes, cancel': 'Oo, kanselahin', 'Keep it': 'Panatilihin', 'Close': 'Isara',
    'Confirm move': 'Kumpirmahin ang paglipat', 'Keep as is': 'Huwag galawin', 'Booking cancelled': 'Nakansela ang booking', 'Booking moved': 'Nailipat ang booking',
    '🔔 A slot opened up': '🔔 May nabakante na', '⏳ On the waitlist': '⏳ Nasa waitlist', 'Book it': 'I-book ito', 'Dismiss': 'Alisin', 'Leave': 'Umalis',
    /* admin */
    'Operations dashboard': 'Dashboard ng operasyon', 'locked': 'naka-lock', 'signed in': 'naka-sign in', 'Staff sign in': 'Sign in ng staff',
    'For Northlight staff only. Customers do not need this — use the booking page.': 'Para lang sa staff ng Northlight. Hindi ito kailangan ng customer — gamitin ang booking page.',
    'Staff username': 'Username ng staff', 'Sign in to dashboard': 'Mag-sign in sa dashboard',
    'Total bookings': 'Kabuuang booking', 'Confirmed': 'Kumpirmado', 'Revenue booked': 'Kita sa booking', 'Utilisation': 'Gamit ng oras', 'Avg. lead time': 'Karaniwang lead time',
    'Awaiting payment': 'Hinihintay ang bayad', 'Average rating': 'Karaniwang rating', 'Cancellation rate': 'Rate ng kanselasyon', 'Bookings per day (next 14 days)': 'Booking kada araw (susunod na 14 araw)',
    'Status': 'Status', 'Pending payment': 'Hinihintay ang bayad', 'Cancelled': 'Nakansela', 'Completed': 'Tapos na', 'From': 'Mula', 'To': 'Hanggang', 'Search': 'Hanapin', 'Reset': 'I-reset',
    '+ Walk-in': '+ Walk-in', 'Staff schedule': 'Iskedyul ng staff', 'Report': 'Ulat', 'Export CSV': 'I-export ang CSV', 'Load demo data': 'Mag-load ng demo data',
    'Ref': 'Ref', 'When (your tz)': 'Kailan (oras mo)', 'Customer': 'Customer', 'Actions': 'Aksyon', 'Confirm': 'Kumpirmahin',
    'New walk-in booking': 'Bagong walk-in booking', 'Add booking': 'Idagdag ang booking', 'Sales & bookings report': 'Ulat ng benta at booking', 'Print / Save as PDF': 'I-print / I-save bilang PDF',
    'Download CSV': 'I-download ang CSV', 'Reviews': 'Mga review', 'Customer reviews': 'Mga review ng customer', 'Done': 'Tapos', 'Save weekly hours': 'I-save ang lingguhang oras', 'Days off': 'Mga day off',
    /* policy */
    'Working hours & policy': 'Oras ng trabaho at patakaran', 'clinic local time': 'oras ng studio', 'Minimum notice': 'Pinakamaikling abiso', 'before the start time.': 'bago ang simula.',
    'Booking window': 'Saklaw ng booking', '— up to': '— hanggang', 'ahead.': 'mula ngayon.', 'Buffers': 'Pagitan', 'Timezones': 'Timezone', 'Cancellation': 'Pagkansela', 'Timezone': 'Timezone',
    '— free up to 24h before; the slot is released immediately for others.': '— libre hanggang 24 oras bago; agad na mabibigyan ang iba ng oras.',
    /* common toasts */
    'Signed in': 'Naka-sign in', 'Signed out': 'Naka-sign out', 'Pick a time': 'Pumili ng oras', 'Copied': 'Nakopya', 'Slot just taken': 'Kakakuha lang ng oras na iyon',
    'Search city or region': 'Maghanap ng lungsod o rehiyon', 'Staff username ': 'Username ng staff'
  };
  var PH = {
    'you@example.ph': 'ikaw@example.ph', 'Search city or region': 'Maghanap ng lungsod o rehiyon', 'name, email, ref': 'pangalan, email, ref',
    'ada@example.com or BK-4KQ7T2': 'email o BK-4KQ7T2', 'Context, links, agenda…': 'Detalye, link, paalala…', 'Repeat it': 'Ulitin ito', '6+ characters': '6+ na character'
  };
  var ATTRS = ['placeholder', 'aria-label', 'title'];
  var ATTR_TL = {};
  Object.keys(TL).forEach(function (k) { ATTR_TL[k] = TL[k]; });
  Object.keys(PH).forEach(function (k) { ATTR_TL[k] = PH[k]; });

  function saved() { try { return (JSON.parse(localStorage.getItem(KEY) || '{}') || {}).lang || 'en'; } catch (e) { return 'en'; } }
  function save(l) { try { var a = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; a.lang = l; localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }

  var lang = saved() === 'tl' ? 'tl' : 'en';
  var orig = new WeakMap();
  var obs = null;
  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function skip(node) {
    for (var n = node.nodeType === 1 ? node : node.parentNode; n && n.nodeType === 1; n = n.parentNode) {
      var t = n.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'CODE' || t === 'TITLE') return true;
      if (n.hasAttribute && n.hasAttribute('data-noi18n')) return true;
    }
    return false;
  }

  function doText(node) {
    if (skip(node)) return;
    var cur = node.nodeValue;
    if (lang === 'tl') {
      var base = orig.has(node) && TL[norm(orig.get(node))] ? orig.get(node) : cur;
      var t = TL[norm(base)];
      if (t) {
        var lead = base.match(/^\s*/)[0], trail = base.match(/\s*$/)[0];
        orig.set(node, base);
        if (cur !== lead + t + trail) node.nodeValue = lead + t + trail;
      } else { orig.delete(node); }
    } else if (orig.has(node)) {
      node.nodeValue = orig.get(node); orig.delete(node);
    }
  }

  function doAttrs(el) {
    if (skip(el)) return;
    ATTRS.forEach(function (a) {
      var key = 'data-i18n-' + a;
      if (!el.hasAttribute(a) && !el.hasAttribute(key)) return;
      if (lang === 'tl') {
        var base = el.hasAttribute(key) ? el.getAttribute(key) : el.getAttribute(a);
        var t = ATTR_TL[norm(base)];
        if (t) { el.setAttribute(key, base); if (el.getAttribute(a) !== t) el.setAttribute(a, t); }
        else if (el.hasAttribute(key)) el.removeAttribute(key);
      } else if (el.hasAttribute(key)) {
        el.setAttribute(a, el.getAttribute(key)); el.removeAttribute(key);
      }
    });
  }

  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  function labels() {
    var tl = lang === 'tl';
    var b = document.getElementById('langToggle'), t = document.getElementById('langTab');
    if (b) b.textContent = tl ? 'EN' : 'TL';
    if (t) t.textContent = tl ? '🌐 Wika: Tagalog (tap para sa English)' : '🌐 Language: English (tap for Tagalog)';
    document.documentElement.setAttribute('lang', tl ? 'tl' : 'en');
  }

  function apply() { walk(document.body); labels(); if (obs) obs.takeRecords(); }

  function toggle() {
    lang = lang === 'tl' ? 'en' : 'tl';
    save(lang);
    apply();
  }

  function start() {
    obs = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList') Array.prototype.forEach.call(m.addedNodes, walk);
        else if (m.type === 'characterData') { orig.delete(m.target); doText(m.target); }
        else if (m.type === 'attributes' && m.target.nodeType === 1) {
          m.target.removeAttribute('data-i18n-' + m.attributeName);
          doAttrs(m.target);
        }
      });
      obs.takeRecords();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    ['langToggle', 'langTab'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('click', toggle); });
    if (lang === 'tl') apply(); else labels();
  }

  window.NSLang = { toggle: toggle, get: function () { return lang; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
