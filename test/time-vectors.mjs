import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { wall as productionWall, NY, VIENNA, isRTH, marketSession, nyDay, viennaDay, viennaISOWeek, calendarDays, MARKET_CALENDAR,
  zonedInstant, sessionBounds, nextOpen } from '../time.mjs';
import { REASONS } from '../contracts/index.mjs';
import { panelState, feedAge } from '../contracts/panel-state.mjs';

const { vectors } = JSON.parse(readFileSync(new URL('../fixtures/time-vectors.json', import.meta.url)));

// Test-only IANA oracle: verifies the hand-written vectors while the production
// time module remains assigned to P2. Do not import this into the product.
function wall(utc, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

for (const vector of vectors) test(`time vector: ${vector.id}`, () => {
  const ny = wall(vector.utc, 'America/New_York');
  const vienna = wall(vector.utc, 'Europe/Vienna');
  assert.equal(ny, vector.ny);
  assert.equal(vienna, vector.vienna);
  assert.equal(productionWall(vector.utc, NY), vector.ny);
  assert.equal(productionWall(vector.utc, VIENNA), vector.vienna);
  assert.equal(viennaDay(vector.utc), vector.vienna.slice(0, 10));
  assert.equal(isRTH(vector.utc), vector.rth);
  const offset = (Date.parse(vienna.replace(' ', 'T') + 'Z') - Date.parse(ny.replace(' ', 'T') + 'Z')) / 3600000;
  assert.equal(offset, vector.offsetHours);
  const weekday = new Date(`${ny.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const time = ny.slice(11);
  assert.equal(weekday > 0 && weekday < 6 && time >= '09:30:00' && time < '16:00:00', vector.rth);
});

test('time: pinned holidays and early closes are closed at the exact boundary', () => {
  for (const day of MARKET_CALENDAR.holidays) assert.equal(isRTH(`${day}T16:00:00.000Z`), false, day);
  for (const day of Object.keys(MARKET_CALENDAR.earlyCloses)) {
    const utcHour = day.endsWith('07-03') ? '17' : '18';
    assert.equal(isRTH(`${day}T${String(Number(utcHour) - 1)}:59:59.999Z`), true, day);
    assert.equal(isRTH(`${day}T${utcHour}:00:00.000Z`), false, day);
  }
  assert.equal(isRTH('2027-12-31T16:00:00.000Z'), true);
  assert.equal(isRTH('2029-01-02T16:00:00.000Z'), false);
});

test('time: 2027 spring mismatch spans US 14 March through EU 28 March', () => {
  for (const [utc, ny, vienna] of [
    ['2027-03-14T06:59:59.000Z', '2027-03-14 01:59:59', '2027-03-14 07:59:59'],
    ['2027-03-14T07:00:00.000Z', '2027-03-14 03:00:00', '2027-03-14 08:00:00'],
    ['2027-03-15T13:30:00.000Z', '2027-03-15 09:30:00', '2027-03-15 14:30:00'],
    ['2027-03-28T00:59:59.000Z', '2027-03-27 20:59:59', '2027-03-28 01:59:59'],
    ['2027-03-28T01:00:00.000Z', '2027-03-27 21:00:00', '2027-03-28 03:00:00'],
    ['2027-03-29T13:30:00.000Z', '2027-03-29 09:30:00', '2027-03-29 15:30:00'],
  ]) { assert.equal(productionWall(utc, NY), ny); assert.equal(productionWall(utc, VIENNA), vienna); }
});

test('time: Vienna midnight and ISO week are independent of NY accounting day', () => {
  const before = '2026-10-25T22:59:59.999Z', after = '2026-10-25T23:00:00.000Z';
  assert.equal(viennaDay(before), '2026-10-25'); assert.equal(viennaDay(after), '2026-10-26');
  assert.equal(nyDay(before), '2026-10-25'); assert.equal(nyDay(after), '2026-10-25');
  assert.equal(viennaISOWeek(before), '2026-W43'); assert.equal(viennaISOWeek(after), '2026-W44');
  assert.equal(viennaISOWeek('2027-01-01T12:00:00.000Z'), '2026-W53');
  assert.deepEqual([...calendarDays('2026-10-24', '2026-10-27')], ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
});

test('time: repeated NY 01:xx instants remain distinct; extended hours after 18 NY stay outside RTH', () => {
  const a = '2026-11-01T05:30:00.000Z', b = '2026-11-01T06:30:00.000Z';
  assert.equal(productionWall(a, NY), productionWall(b, NY));
  assert.notEqual(productionWall(a, VIENNA), productionWall(b, VIENNA));
  assert.equal(feedAge({ receivedAt: a }, b), 3600);
  const late = '2026-10-27T23:30:00.000Z';
  assert.equal(productionWall(late, NY), '2026-10-27 19:30:00');
  assert.equal(nyDay(late), '2026-10-27'); assert.equal(viennaDay(late), '2026-10-28'); assert.equal(isRTH(late), false);
});

test('time: every market-session reason is closed and accepted by browser selectors', () => {
  for (const [instant, expected] of [
    ['2026-10-14T15:00:00.000Z', { day: '2026-10-14', rth: true, reason: null, close: '16:00:00' }],
    ['2026-10-17T15:00:00.000Z', { day: '2026-10-17', rth: false, reason: 'market_closed', close: null }],
    ['2026-12-25T15:00:00.000Z', { day: '2026-12-25', rth: false, reason: 'market_closed', close: null }],
    ['2026-11-27T18:00:00.000Z', { day: '2026-11-27', rth: false, reason: null, close: '13:00:00' }],
    ['2029-01-02T16:00:00.000Z', { day: '2029-01-02', rth: false, reason: 'calendar_unavailable', close: null }],
  ]) {
    const session = marketSession(instant);
    assert.deepEqual(session, expected);
    if (session.reason) assert.ok(REASONS.includes(session.reason));
    assert.doesNotThrow(() => panelState({ receivedAt: instant }, session, session.reason, instant));
  }
});

test('time: session bounds follow both zones through the five-hour week and early closes', () => {
  for (const [instant, open, close, openVienna, closeVienna] of [
    ['2026-10-14T17:42:22.000Z', '2026-10-14T13:30:00.000Z', '2026-10-14T20:00:00.000Z', '15:30:00', '22:00:00'],
    ['2026-10-28T15:00:00.000Z', '2026-10-28T13:30:00.000Z', '2026-10-28T20:00:00.000Z', '14:30:00', '21:00:00'],
    ['2026-11-04T15:00:00.000Z', '2026-11-04T14:30:00.000Z', '2026-11-04T21:00:00.000Z', '15:30:00', '22:00:00'],
    ['2026-11-27T15:00:00.000Z', '2026-11-27T14:30:00.000Z', '2026-11-27T18:00:00.000Z', '15:30:00', '19:00:00'],
    ['2027-03-15T15:00:00.000Z', '2027-03-15T13:30:00.000Z', '2027-03-15T20:00:00.000Z', '14:30:00', '21:00:00'],
  ]) {
    const bounds = sessionBounds(instant);
    assert.equal(bounds.openAt, open); assert.equal(bounds.closeAt, close);
    assert.equal(productionWall(bounds.openAt, VIENNA).slice(11), openVienna);
    assert.equal(productionWall(bounds.closeAt, VIENNA).slice(11), closeVienna);
  }
  assert.deepEqual(sessionBounds('2026-10-17T15:00:00.000Z'), { day: '2026-10-17', rth: false, reason: 'market_closed', close: null, openAt: null, closeAt: null });
  assert.equal(zonedInstant('2026-11-01', '09:30:00', NY), '2026-11-01T14:30:00.000Z');
  assert.equal(zonedInstant('2026-10-25', '06:00:00', VIENNA), '2026-10-25T05:00:00.000Z');
});

test('time: next regular open skips weekends, holidays and a finished session', () => {
  assert.equal(nextOpen('2026-10-17T15:00:00.000Z'), '2026-10-19T13:30:00.000Z');
  assert.equal(nextOpen('2026-10-14T12:00:00.000Z'), '2026-10-14T13:30:00.000Z');
  assert.equal(nextOpen('2026-10-14T20:30:00.000Z'), '2026-10-15T13:30:00.000Z');
  assert.equal(nextOpen('2026-11-25T22:00:00.000Z'), '2026-11-27T14:30:00.000Z');
  assert.equal(nextOpen('2028-12-30T12:00:00.000Z'), null);
});
