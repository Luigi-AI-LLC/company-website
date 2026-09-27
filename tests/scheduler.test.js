/*
 * Unit tests for the pure parts of scheduler.js.
 * Run: node tests/scheduler.test.js
 */
const assert = require('node:assert/strict');
const S = require('../scheduler.js');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ✓', name); }
    catch (e) { console.error('  ✗', name); console.error(e); process.exitCode = 1; }
}

const weekly = {
    mon: [['09:00', '12:00'], ['13:00', '17:00']],
    tue: [['09:00', '12:00'], ['13:00', '17:00']],
    wed: [['09:00', '12:00'], ['13:00', '17:00']],
    thu: [['09:00', '12:00'], ['13:00', '17:00']],
    fri: [['09:00', '12:00'], ['13:00', '15:00']]
};

console.log('time-zone math');
test('zonedTimeToUtc converts Chicago CDT wall time', () => {
    // 2026-09-28 09:00 America/Chicago is UTC-5 → 14:00Z
    assert.equal(S.zonedTimeToUtc(2026, 9, 28, 9, 0, 'America/Chicago').toISOString(), '2026-09-28T14:00:00.000Z');
});
test('zonedTimeToUtc converts Chicago CST wall time (after DST ends)', () => {
    // 2026-11-02 09:00 America/Chicago is UTC-6 → 15:00Z
    assert.equal(S.zonedTimeToUtc(2026, 11, 2, 9, 0, 'America/Chicago').toISOString(), '2026-11-02T15:00:00.000Z');
});
test('zonedTimeToUtc handles a positive-offset zone', () => {
    assert.equal(S.zonedTimeToUtc(2026, 9, 28, 9, 0, 'Asia/Tokyo').toISOString(), '2026-09-28T00:00:00.000Z');
});
test('ymdInZone respects the zone', () => {
    const d = new Date('2026-09-28T03:30:00Z');
    assert.equal(S.ymdInZone(d, 'America/Chicago'), '2026-09-27');
    assert.equal(S.ymdInZone(d, 'Asia/Tokyo'), '2026-09-28');
});
test('addDays crosses month boundaries', () => {
    assert.equal(S.addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
});
test('weekdayOf is correct', () => {
    assert.equal(S.weekdayOf('2026-09-28'), 'mon');
    assert.equal(S.weekdayOf('2026-09-27'), 'sun');
});

console.log('slot generation');
const now = new Date('2026-09-25T20:00:00Z'); // Fri 3pm Chicago
const base = { timezone: 'America/Chicago', slotMinutes: 30, minNoticeHours: 24, horizonDays: 21, weekly };

test('generates only slots inside working windows, sorted', () => {
    const slots = S.generateSlots(base, now);
    assert.ok(slots.length > 0);
    for (let i = 1; i < slots.length; i++) assert.ok(slots[i].start > slots[i - 1].start, 'sorted');
    slots.forEach(s => {
        const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false, minute: '2-digit' }).format(s.start);
        const [hh, mm] = h.split(':').map(Number);
        const mins = hh * 60 + mm;
        assert.ok((mins >= 540 && mins < 720) || (mins >= 780 && mins < 1020), 'inside window: ' + h);
        assert.equal(s.end - s.start, 30 * 60000);
    });
});
test('no weekend slots', () => {
    const slots = S.generateSlots(base, now);
    slots.forEach(s => {
        const wd = S.weekdayOf(S.ymdInZone(s.start, 'America/Chicago'));
        assert.ok(wd !== 'sat' && wd !== 'sun');
    });
});
test('respects minimum notice', () => {
    const slots = S.generateSlots(base, now);
    assert.ok(slots[0].start.getTime() >= now.getTime() + 24 * 3600000);
    // Fri 3pm + 24h = Sat 3pm → first slot must be Monday 09:00 CDT = 14:00Z
    assert.equal(slots[0].start.toISOString(), '2026-09-28T14:00:00.000Z');
});
test('friday window ends at 15:00', () => {
    const slots = S.generateSlots(base, now);
    const fri = slots.filter(s => S.weekdayOf(S.ymdInZone(s.start, 'America/Chicago')) === 'fri');
    assert.ok(fri.length > 0);
    fri.forEach(s => {
        const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(s.start);
        assert.ok(Number(h) < 15, 'friday slot before 15:00, got ' + h);
    });
});
test('blackout dates are removed', () => {
    const slots = S.generateSlots({ ...base, blackoutDates: ['2026-09-28'] }, now);
    assert.ok(!slots.some(s => S.ymdInZone(s.start, 'America/Chicago') === '2026-09-28'));
});
test('booked slots are removed', () => {
    const slots = S.generateSlots({ ...base, bookedSlots: ['2026-09-28T14:00:00Z'] }, now);
    assert.ok(!slots.some(s => s.start.toISOString() === '2026-09-28T14:00:00.000Z'));
    assert.equal(slots[0].start.toISOString(), '2026-09-28T14:30:00.000Z');
});
test('horizon is honoured', () => {
    const slots = S.generateSlots({ ...base, horizonDays: 7 }, now);
    slots.forEach(s => assert.ok(s.start.getTime() <= now.getTime() + 7 * 86400000));
});
test('stays correct across the DST change (Nov 1 2026)', () => {
    const late = new Date('2026-10-29T12:00:00Z');
    const slots = S.generateSlots({ ...base, horizonDays: 10 }, late);
    const mon = slots.filter(s => S.ymdInZone(s.start, 'America/Chicago') === '2026-11-02');
    assert.equal(mon[0].start.toISOString(), '2026-11-02T15:00:00.000Z', 'Mon 9am CST is 15:00Z');
    const fri = slots.filter(s => S.ymdInZone(s.start, 'America/Chicago') === '2026-10-30');
    assert.equal(fri[0].start.toISOString(), '2026-10-30T14:00:00.000Z', 'Fri 9am CDT is 14:00Z');
});
test('empty weekly config yields no slots', () => {
    assert.deepEqual(S.generateSlots({ ...base, weekly: {} }, now), []);
});

console.log('multi-host availability');
const twoHosts = {
    slotMinutes: 30, minNoticeHours: 0, horizonDays: 10,
    hosts: [
        { name: 'McAllen, TX', timezone: 'America/Chicago', weekly: {
            mon: [['19:00', '22:00']], tue: [['19:00', '22:00']], wed: [['19:00', '22:00']], thu: [['19:00', '22:00']], fri: [['19:00', '22:00']],
            sat: [['08:00', '22:00']], sun: [['08:00', '22:00']] } },
        { name: 'Muscat, Oman', timezone: 'Asia/Muscat', weekly: {
            mon: [['12:00', '16:00']], tue: [['12:00', '16:00']], wed: [['12:00', '16:00']], thu: [['12:00', '16:00']], fri: [['12:00', '16:00']],
            sat: [['08:00', '22:00']], sun: [['08:00', '22:00']] } }
    ]
};
const fri = new Date('2026-10-02T12:00:00Z');
const two = S.generateSlots(twoHosts, fri);
const at = iso => two.find(s => s.start.toISOString() === iso);

test('hostsOf falls back to a single host from flat config', () => {
    const h = S.hostsOf(base);
    assert.equal(h.length, 1);
    assert.equal(h[0].timezone, 'America/Chicago');
});
test('weekday Muscat window 12–16 local = 08:00Z–12:00Z, Muscat only', () => {
    assert.deepEqual(at('2026-10-05T08:00:00.000Z').hosts, ['Muscat, Oman']);
    assert.deepEqual(at('2026-10-05T11:30:00.000Z').hosts, ['Muscat, Oman']);
    assert.equal(at('2026-10-05T12:00:00.000Z'), undefined, 'window end is exclusive');
    assert.equal(at('2026-10-05T07:30:00.000Z'), undefined, 'before window');
});
test('weekday McAllen window 19–22 CDT = 00:00Z–03:00Z next day, McAllen only', () => {
    assert.deepEqual(at('2026-10-06T00:00:00.000Z').hosts, ['McAllen, TX']);
    assert.deepEqual(at('2026-10-06T02:30:00.000Z').hosts, ['McAllen, TX']);
    assert.equal(at('2026-10-06T03:00:00.000Z'), undefined);
});
test('weekend overlap lists both hosts', () => {
    // Sat 2026-10-03 09:00 CDT = 14:00Z = 18:00 Muscat: both inside 08–22
    assert.deepEqual(at('2026-10-03T14:00:00.000Z').hosts.sort(), ['McAllen, TX', 'Muscat, Oman']);
});
test('weekend edges: Muscat-only morning, McAllen-only late night', () => {
    // Sat 08:00 Muscat = 04:00Z; McAllen is 23:00 Fri → outside 19–22
    assert.deepEqual(at('2026-10-03T04:00:00.000Z').hosts, ['Muscat, Oman']);
    // Sat 21:30 CDT = 02:30Z Sun; Muscat is 06:30 Sun → outside 08–22
    assert.deepEqual(at('2026-10-04T02:30:00.000Z').hosts, ['McAllen, TX']);
});
test('no slots when nobody is available', () => {
    // Mon 2026-10-05 04:00Z = Sun 23:00 CDT (outside) and Mon 08:00 Muscat (weekday window is 12–16)
    assert.equal(at('2026-10-05T04:00:00.000Z'), undefined);
});
test('slots are unique by start time and sorted', () => {
    const keys = two.map(s => s.start.getTime());
    assert.equal(new Set(keys).size, keys.length);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i] > keys[i - 1]);
});
test('global bookedSlots hide a slot for every host', () => {
    const s2 = S.generateSlots({ ...twoHosts, bookedSlots: ['2026-10-03T14:00:00Z'] }, fri);
    assert.ok(!s2.some(s => s.start.toISOString() === '2026-10-03T14:00:00.000Z'));
});

console.log('ics');
test('buildIcs emits a valid tentative VEVENT', () => {
    const ics = S.buildIcs({ start: new Date('2026-09-28T14:00:00Z'), end: new Date('2026-09-28T14:30:00Z'), summary: 'Call, with; commas', tentative: true });
    assert.ok(ics.includes('DTSTART:20260928T140000Z'));
    assert.ok(ics.includes('DTEND:20260928T143000Z'));
    assert.ok(ics.includes('STATUS:TENTATIVE'));
    assert.ok(ics.includes('SUMMARY:Call\\, with\\; commas'));
    assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.endsWith('END:VCALENDAR'));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
