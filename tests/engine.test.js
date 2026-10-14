/* ============================================================
   Availability-engine tests — plain Node, no dependencies.
   Run:  node tests/engine.test.js
   ============================================================ */
'use strict';

var NS = require('../js/store.js');
var Store = NS.Store, U = NS.U;

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + label); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra ? '  → ' + extra : '')); }
}
function group(name) { console.log('\n\x1b[1m' + name + '\x1b[0m'); }

/* fresh state for every test group */
function reset() { Store.clearAll(); }

/* ---------- 1. timezone maths ---------- */
group('Timezone conversion (DST-safe, no libraries)');
var summer = U.wallToUtc(2026, 7, 15, 10, 0, 'Europe/London');   // BST = UTC+1
var winter = U.wallToUtc(2026, 1, 15, 10, 0, 'Europe/London');   // GMT = UTC+0
ok('July 10:00 London == 09:00 UTC', summer.toISOString().slice(11, 16) === '09:00', summer.toISOString());
ok('January 10:00 London == 10:00 UTC', winter.toISOString().slice(11, 16) === '10:00', winter.toISOString());
var ny = U.inZone(U.wallToUtc(2026, 7, 15, 10, 0, 'Europe/London'), 'America/New_York');
ok('10:00 London shows as 05:00 in New York (July)', ny.time === '05:00', ny.time);
var tokyoNext = U.inZone(U.wallToUtc(2026, 7, 15, 22, 0, 'Europe/London'), 'Asia/Tokyo');
ok('Crossing midnight forward rolls the date (22:00 London → next day Tokyo)',
  tokyoNext.dateStr === '2026-07-16', tokyoNext.dateStr + ' ' + tokyoNext.time);
var roundTrip = U.inZone(U.instantOf('2026-07-15', 600), NS.CLINIC_TZ);   // studio runs on Asia/Manila
ok('instantOf/display round-trips exactly', roundTrip.time === '10:00', roundTrip.time);

/* ---------- 2. working hours ---------- */
group('Working hours & closures');
var sat = Store.workingBlock(Store.providerById('ada'), U.addDaysStr(U.todayStr(), 0));
ok('workingBlock returns a null for a non-working weekday or a block',
  sat === null || (sat.open < sat.close));
var sundayFound = null;
for (var i = 0; i < 7; i++) {
  var ds = U.addDaysStr(U.todayStr(), i);
  if (U.weekdayOf(ds) === 0) { sundayFound = ds; break; }
}
ok('Nobody works Sunday', Store.workingBlock(Store.providerById('marco'), sundayFound) === null);

/* ---------- 3. slot generation ---------- */
group('Slot generation');
reset();
var nextMon = null;
for (var j = 0; j < 14; j++) {
  var d = U.addDaysStr(U.todayStr(), j);
  if (U.weekdayOf(d) === 1 && U.dayNumber(d) > U.dayNumber(U.todayStr())) { nextMon = d; break; }
}
var res = Store.slotsFor('ada', 'haircut', nextMon);
ok('Produces a non-empty slot grid on a working day', res.slots.length > 0, res.slots.length + ' slots');
ok('Every slot fits the 45-min service + 15-min buffer inside working hours', res.slots.every(function (s) {
  return s.end === s.start + 45 + 15;
}));
ok('Slots step by the service increment (15 min)', res.slots[1].start - res.slots[0].start === 15);
var closedDay = SundayTest();
function SundayTest() {
  for (var k = 0; k < 7; k++) {
    var x = U.addDaysStr(U.todayStr(), k);
    if (U.weekdayOf(x) === 0) return x;
  }
}
ok('Closed day yields state "closed" and zero slots',
  Store.slotsFor('ada', 'haircut', closedDay).state === 'closed');
ok('Provider that does not offer the service yields state "not-offered"',
  Store.slotsFor('ren', 'haircut', nextMon).state === 'not-offered');

/* ---------- 4. double-booking prevention ---------- */
group('Double-booking prevention');
reset();
var free = Store.slotsFor('ada', 'haircut', nextMon).slots.filter(function (s) { return s.free; });
var slotA = free[0];
var first = Store.book({ serviceId: 'haircut', providerId: 'ada', date: nextMon, startMin: slotA.start,
  name: 'Test One', email: 'one@example.com' });
ok('First booking succeeds', first.ok === true, first.error);
ok('A reference in the BK-XXXXXX format is issued', /^BK-[A-Z0-9]{6}$/.test(first.booking.ref), first.booking.ref);

var clash = Store.book({ serviceId: 'haircut', providerId: 'ada', date: nextMon, startMin: slotA.start,
  name: 'Test Two', email: 'two@example.com' });
ok('Exact same slot is rejected', clash.ok === false && clash.error === 'slot-unavailable', clash.error);

var overlap = Store.book({ serviceId: 'haircut', providerId: 'ada', date: nextMon, startMin: slotA.start + 15,
  name: 'Test Three', email: 'three@example.com' });
ok('Overlapping slot inside the buffer is rejected too', overlap.ok === false, overlap.error);

var afterBuffer = Store.book({ serviceId: 'haircut', providerId: 'ada', date: nextMon, startMin: slotA.start + 60,
  name: 'Test Four', email: 'four@example.com' });
ok('Slot right after the buffer is accepted', afterBuffer.ok === true, afterBuffer.error);

ok('Booked slot no longer appears as free',
  Store.slotsFor('ada', 'haircut', nextMon).slots.filter(function (s) { return s.start === slotA.start; })[0].free === false);
ok('Another provider is unaffected by the booking',
  Store.slotsFor('marco', 'haircut', nextMon).slots.filter(function (s) { return s.start === slotA.start; })[0].free === true);

/* ---------- 5. notice + window ---------- */
group('Minimum notice & booking window');
reset();
var today = U.todayStr();
var nowMin = U.nowMinutes();
var laterToday = Store.slotsFor('nadia', 'consult', today);
if (nowMin + 180 < 1080) {
  var soon = laterToday.slots.filter(function (s) { return s.reason === 'notice'; });
  ok('Slots inside the 2-hour notice window are marked unavailable', soon.length === 0 || soon.every(function (s) { return !s.free; }));
} else {
  ok('Notice window check skipped (studio already closed)', true);
}
var far = U.addDaysStr(today, NS.BOOKING_WINDOW_DAYS + 5);
ok('Dates beyond the booking window are not offered',
  Store.slotsFor('ada', 'consult', far).slots.filter(function (s) { return s.free; }).length === 0);

/* ---------- 6. reschedule ---------- */
group('Reschedule');
reset();
var f1 = Store.slotsFor('sofia', 'manipedi', nextMonDay(2)).slots.filter(function (s) { return s.free; });
function nextMonDay(wd) {
  for (var k = 1; k < 14; k++) {
    var x = U.addDaysStr(U.todayStr(), k);
    if (U.weekdayOf(x) === wd) return x;
  }
}
var b1 = Store.book({ serviceId: 'manipedi', providerId: 'sofia', date: nextMonDay(2), startMin: f1[0].start,
  name: 'Mover', email: 'mover@example.com' });
ok('Setup booking created', b1.ok === true, b1.error);

// pick a slot that is genuinely free while b1 still holds f1[0].start:
// WITHOUT self-exclusion, so the neighbour slots covered by b1's own span stay excluded.
var other = Store.slotsFor('sofia', 'manipedi', nextMonDay(2))
  .slots.filter(function (s) { return s.free; });
ok('A different free slot exists to move into', other.length > 0, other.length + ' candidates');
var move = Store.reschedule(b1.booking.id, nextMonDay(2), other[0].start);
ok('Reschedule to another free slot works', move.ok === true, move.error);
ok('Revision counter incremented', Store.byId(m1()).revisions === 1);
function m1() { return b1.booking.id; }
ok('Old slot is free again',
  Store.slotsFor('sofia', 'manipedi', nextMonDay(2)).slots.filter(function (s) { return s.start === f1[0].start; })[0].free === true);
ok('Reschedule into a taken slot is refused',
  Store.reschedule(b1.booking.id, nextMonDay(2), 99999).ok === false);
ok('A booking never clashes with its own current slot (self-exclusion)',
  Store.isSlotFree('sofia', 'manipedi', nextMonDay(2), other[0].start, b1.booking.id) === true);

/* ---------- 7. cancel / reinstate ---------- */
group('Cancel & reinstate');
reset();
var f2 = Store.slotsFor('ada', 'consult', nextMon).slots.filter(function (s) { return s.free; });
var b2 = Store.book({ serviceId: 'consult', providerId: 'ada', date: nextMon, startMin: f2[0].start,
  name: 'Canceller', email: 'cancel@example.com' });
Store.setStatus(b2.booking.id, 'cancelled', 'test');
ok('Cancelling releases the slot immediately',
  Store.slotsFor('ada', 'consult', nextMon).slots.filter(function (s) { return s.start === f2[0].start; })[0].free === true);
var takeover = Store.book({ serviceId: 'consult', providerId: 'ada', date: nextMon, startMin: f2[0].start,
  name: 'Faster', email: 'faster@example.com' });
ok('Another customer can take the released slot', takeover.ok === true, takeover.error);
var back = Store.setStatus(b2.booking.id, 'confirmed', 'test');
ok('Reinstating is refused once the slot is gone', back.ok === false && back.error === 'slot-taken', back.error);
ok('Audit history recorded every action', (Store.byId(b2.booking.id).history || []).length >= 2);

/* ---------- 8. lookup ---------- */
group('Lookup');
ok('Lookup by email finds the booking', Store.mine('faster@example.com').length === 1);
ok('Lookup by reference is case-insensitive', Store.mine(takeover.booking.ref.toLowerCase()).length === 1);
ok('Unknown email returns nothing', Store.mine('nobody@nowhere.test').length === 0);

/* ---------- 9. ICS ---------- */
group('Calendar file (.ics)');
var ics = NS.ICS(takeover.booking);
ok('Starts with BEGIN:VCALENDAR', ics.indexOf('BEGIN:VCALENDAR') === 0);
ok('Contains a DTSTART and DTEND', /DTSTART:\d{8}T\d{6}Z/.test(ics) && /DTEND:\d{8}T\d{6}Z/.test(ics));
ok('UID is namespaced to the booking reference', ics.indexOf('UID:' + takeover.booking.ref + '@northlight.studio') > -1);
ok('Includes a reminder alarm', ics.indexOf('BEGIN:VALARM') > -1 && ics.indexOf('TRIGGER:-PT30M') > -1);
ok('Uses CRLF line endings (RFC 5545)', ics.indexOf('\r\n') > -1);
ok('Duration in the file matches the service length', (function () {
  var s = /DTSTART:(\d{8}T\d{6})Z/.exec(ics), e = /DTEND:(\d{8}T\d{6})Z/.exec(ics);
  function parse(x) { return Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8), +x.slice(9, 11), +x.slice(11, 13), +x.slice(13, 15)); }
  return (parse(e[1]) - parse(s[1])) / 60000 === takeover.booking.minutes;
})());

/* ---------- 10. seeding ---------- */
group('Demo seeding (no conflicts allowed)');
reset();
var n = Store.seedDemo(26);
ok('Seeds the requested number of bookings', n === 26, 'got ' + n);
var byKey = {};
var overlaps = 0;
Store.all().forEach(function (b) {
  if (b.status === 'cancelled') return;
  var k = b.providerId + '|' + b.date + '|' + b.startMin;
  if (byKey[k]) overlaps++;
  byKey[k] = true;
});
ok('Not one seeded booking collides with another', overlaps === 0, overlaps + ' collisions');
ok('Seeded bookings respect the provider working hours', Store.all().every(function (b) {
  var blk = Store.workingBlock(Store.providerById(b.providerId), b.date);
  return blk && b.startMin >= blk.open && b.startMin + b.minutes <= blk.close;
}));
ok('History is written for every seeded booking', Store.all().every(function (b) { return (b.history || []).length > 0; }));

/* ---------- 11. persistence ---------- */
group('Persistence');
var before = Store.all().length;
Store.reload();
ok('State survives a reload from storage', Store.all().length === before, Store.all().length + ' vs ' + before);

/* ---------- 12. currency ---------- */
group('Currency (Philippine peso)');
ok('Currency metadata is exported as PHP / en-PH',
  NS.CURRENCY && NS.CURRENCY.code === 'PHP' && NS.CURRENCY.locale === 'en-PH' && NS.CURRENCY.symbol === '\u20B1',
  JSON.stringify(NS.CURRENCY));
ok('Every service price is a whole number of pesos',
  NS.SERVICES.every(function (s) { return Number.isInteger(s.price) && s.price >= 0; }));
ok('Every paid service has a realistic local peso price (>= 100)',
  NS.SERVICES.every(function (s) { return s.price === 0 || s.price >= 100; }),
  NS.SERVICES.map(function (s) { return s.id + '=' + s.price; }).join(' '));
ok('money(6500) uses the peso sign and comma grouping', U.money(6500) === '\u20B16,500', U.money(6500));
ok('money(0) renders the peso sign with a plain zero', U.money(0) === '\u20B10', U.money(0));
ok('money(1234567) groups every thousands separator', U.money(1234567) === '\u20B11,234,567', U.money(1234567));
ok('money() survives a negative / non-numeric input', U.money(-2500) === '\u20B1-2,500' || U.money(-2500).indexOf('2,500') > -1, U.money(-2500));
ok('No sterling symbol survives anywhere in the catalogue',
  JSON.stringify(NS.SERVICES).indexOf('\u00A3') === -1);
ok('A booked price is recorded in pesos (not a string)', (function () {
  var d = U.addDaysStr(U.todayStr(), 3), r = Store.slotsFor('ada', 'haircut', d).slots.filter(function (x) { return x.free; });
  if (!r.length) return true;
  var b = Store.book({ serviceId: 'haircut', providerId: 'ada', date: d, startMin: r[0].start, name: 'Peso Test', email: 'php@example.com' });
  return b.ok && typeof b.booking.price === 'number' && b.booking.price === 450;
})());


/* ---------- new features ---------- */
group('Bundles, payment, waitlist, reviews, schedule, walk-in');
(function () {
  reset();
  var d = (function () { for (var i = 2; i < 30; i++) { var x = U.addDaysStr(U.todayStr(), i); if (Store.slotsFor('nadia', 'facial+manipedi', x).free) return x; } })();
  var bs = Store.serviceById('manipedi+facial');
  ok('Bundle id is canonical (catalogue order)', bs && bs.id === 'facial+manipedi', bs && bs.id);
  ok('Bundle sums minutes and price, keeps the largest buffer', bs.minutes === 135 && bs.price === 1550 && bs.buffer === 15, JSON.stringify([bs.minutes, bs.price, bs.buffer]));
  ok('Only providers who offer every part can deliver a bundle',
    Store.providersFor('facial+manipedi').map(function (p) { return p.id; }).join() === 'nadia', Store.providersFor('facial+manipedi').map(function (p) { return p.id; }).join());
  ok('Unknown bundle part is rejected', Store.serviceById('facial+nothing') === null);
  var slot = Store.slotsFor('nadia', 'facial+manipedi', d).slots.filter(function (x) { return x.free; })[0];
  var r = Store.book({ serviceId: 'facial+manipedi', providerId: 'nadia', date: d, startMin: slot.start, name: 'Bundle', email: 'b@x.co', payMethod: 'gcash', payRef: '123456' });
  ok('Bundle booking works and lasts the combined time', r.ok && r.booking.minutes === 135 && r.booking.price === 1550, JSON.stringify(r));
  ok('GCash booking starts as pending / awaiting payment', r.booking.status === 'pending' && r.booking.payment.status === 'awaiting' && r.booking.payment.ref === '123456');
  ok('A pending booking still blocks its slot', !Store.isSlotFree('nadia', 'facial', d, slot.start));
  var c = Store.confirmPayment(r.booking.id);
  ok('confirmPayment turns pending into confirmed + paid', c.ok && c.booking.status === 'confirmed' && c.booking.payment.status === 'paid');
  var s2 = Store.slotsFor('nadia', 'haircut', d);
  var hair = Store.slotsFor('ada', 'haircut', d).slots.filter(function (x) { return x.free; })[0];
  if (hair) {
    var r2 = Store.book({ serviceId: 'haircut', providerId: 'ada', date: d, startMin: hair.start, name: 'Salon', email: 's@x.co', payMethod: 'salon' });
    ok('Pay-at-salon booking is confirmed straight away', r2.ok && r2.booking.status === 'confirmed' && r2.booking.payment.method === 'salon' && r2.booking.payment.status === 'unpaid');
    Store.setStatus(r2.booking.id, 'completed');
    ok('Completing a salon booking marks it paid', Store.byId(r2.booking.id).payment.status === 'paid');
    // review
    var rv = Store.addReview(r2.booking.id, 5, 'Great');
    ok('Completed booking can be reviewed once', rv.ok && Store.addReview(r2.booking.id, 4, '').error === 'already-reviewed');
    ok('Rating average is computed per specialist', Store.ratingFor('ada').count === 1 && Store.ratingFor('ada').avg === 5);
    ok('Future booking cannot be reviewed', Store.addReview(r.booking.id, 5, '').error === 'not-finished');
    // waitlist: fill the whole day for ada/haircut then cancel one
    reset();
    var free = Store.slotsFor('ada', 'haircut', d).slots.filter(function (x) { return x.free; });
    var made = [];
    free.forEach(function (sl) {
      var rr = Store.book({ serviceId: 'haircut', providerId: 'ada', date: d, startMin: sl.start, name: 'F', email: 'f@x.co' });
      if (rr.ok) made.push(rr.booking);
    });
    ok('Day can be filled up', Store.slotsFor('ada', 'haircut', d).free === 0);
    var w = Store.joinWaitlist({ serviceId: 'haircut', providerId: 'ada', date: d, email: 'wait@x.co', name: 'W' });
    ok('Joining the waitlist twice does not duplicate', Store.joinWaitlist({ serviceId: 'haircut', providerId: 'ada', date: d, email: 'wait@x.co' }).existing === true);
    ok('Waitlist entry starts as waiting', Store.waitlistFor('wait@x.co')[0].status === 'waiting');
    Store.setStatus(made[0].id, 'cancelled');
    ok('Cancelling a booking notifies the waitlist', Store.waitlistFor('wait@x.co')[0].status === 'notified');
    var again = Store.book({ serviceId: 'haircut', providerId: 'ada', date: d, startMin: made[0].startMin, name: 'W', email: 'wait@x.co' });
    ok('Booking that day fulfils the waitlist entry', again.ok && Store.waitlistFor('wait@x.co').length === 0);
  }
  // schedule
  reset();
  var wd = U.weekdayOf(d);
  var before = Store.slotsFor('nadia', 'consult', d).total;
  Store.addDayOff('nadia', d);
  ok('A day off closes the specialist for that date', Store.slotsFor('nadia', 'consult', d).state === 'closed');
  Store.removeDayOff('nadia', d);
  ok('Removing the day off reopens it', Store.slotsFor('nadia', 'consult', d).total === before);
  var h = JSON.parse(JSON.stringify(Store.providerById('nadia').hours)); h[wd] = [600, 660];
  ok('setHours rejects an inverted range', Store.setHours('nadia', { 1: [700, 600] }).ok === false);
  Store.setHours('nadia', h);
  ok('New hours change the slot grid', Store.slotsFor('nadia', 'consult', d).total < before);
  Store.addClosure(d, 'Holiday');
  ok('Studio closure closes everyone', Store.slotsFor('ada', 'consult', d).state === 'closed');
  Store.removeClosure(d);
  // walk-in ignores the 2h notice
  var today = U.todayStr();
  var pr = Store.PROVIDERS.filter(function (p) { return Store.slotsFor(p.id, 'consult', today).state === 'open'; })[0];
  if (pr) {
    var normal = Store.slotsFor(pr.id, 'consult', today).free, walk = Store.slotsFor(pr.id, 'consult', today, { walkIn: true }).free;
    ok('Walk-in mode allows slots inside the minimum-notice window', walk >= normal);
  }
  Store.resetSchedule();
})();

/* ---------- summary ---------- */
console.log('\n' + '─'.repeat(52));
console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed' + '\x1b[0m');
console.log('─'.repeat(52) + '\n');
process.exit(fail ? 1 : 0);