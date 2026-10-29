import calendar from './market-calendar.json' with { type: 'json' };
import { validDate, validInstant } from './contracts/schema-validator.mjs';
import { viennaDay } from './contracts/vienna-date.mjs';

export const NY = 'America/New_York';
export const VIENNA = 'Europe/Vienna';
// History: the longest time between two received rows that still counts as
// continuous reporting. The producer's slowest normal cadence is its
// overnight regime, one snapshot every 900 s; 20 minutes leaves 5 minutes
// for a late push or a restart, while a missed snapshot (30 minutes) is a
// gap. The server's compaction (server/history.mjs) and the page
// (history-model.js) share this one value; the History copy names it.
export const GAP_MS = 20 * 60 * 1000;
Object.freeze(calendar.years); Object.freeze(calendar.holidays); Object.freeze(calendar.earlyCloses);
export const MARKET_CALENDAR = Object.freeze(calendar);
const formatters = new Map([NY, VIENNA].map(timeZone => [timeZone,
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })]));

export function wall(instant, zone) {
  if (!validInstant(instant) || !formatters.has(zone)) throw new TypeError('Explicit supported zone and UTC instant required');
  const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export const nyDay = instant => wall(instant, NY).slice(0, 10);
export { viennaDay };

export function viennaISOWeek(instant) {
  const d = new Date(`${viennaDay(instant)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Calendar labels are iterated as dates, never as 24h elapsed in a DST zone.
export function* calendarDays(from, through) {
  if (!validDate(from) || !validDate(through) || through < from ||
      Date.parse(through) - Date.parse(from) > 3660 * 86400000) throw new TypeError('Bounded calendar range required');
  for (let ms = Date.parse(from); ms <= Date.parse(through); ms += 86400000) yield new Date(ms).toISOString().slice(0, 10);
}

export function marketSession(instant) {
  const local = wall(instant, NY);
  const day = local.slice(0, 10);
  if (!calendar.years.includes(Number(day.slice(0, 4)))) return { day, rth: false, reason: 'calendar_unavailable', close: null };
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const closed = weekday === 0 || weekday === 6 || calendar.holidays.includes(day);
  const close = calendar.earlyCloses[day] ?? '16:00:00';
  return { day, rth: !closed && local.slice(11) >= '09:30:00' && local.slice(11) < close,
    reason: closed ? 'market_closed' : null, close: closed ? null : close };
}
export const isRTH = instant => marketSession(instant).rth;

// A wall-clock date and time in an explicit zone, as a UTC instant. Converges on
// the zone's own offset rather than assuming one; the session's 09:30 and close
// are never inside a DST gap or a repeated hour.
export function zonedInstant(day, time, zone) {
  if (!validDate(day) || !/^\d{2}:\d{2}:\d{2}$/.test(time) || !formatters.has(zone)) throw new TypeError('Explicit zone, date and time required');
  const target = Date.parse(`${day}T${time}.000Z`);
  let guess = target;
  for (let pass = 0; pass < 3; pass++) {
    guess += target - Date.parse(`${wall(new Date(guess).toISOString(), zone).replace(' ', 'T')}.000Z`);
  }
  return new Date(guess).toISOString();
}

// The New York regular session of the instant's NY day, with its UTC bounds.
export function sessionBounds(instant) {
  const session = marketSession(instant);
  if (!session.close) return { ...session, openAt: null, closeAt: null };
  return { ...session, openAt: zonedInstant(session.day, '09:30:00', NY), closeAt: zonedInstant(session.day, session.close, NY) };
}

// The next regular open strictly after the instant, from the pinned calendar.
export function nextOpen(instant) {
  const first = nyDay(instant);
  for (let offset = 0; offset < 12; offset++) {
    const day = new Date(Date.parse(`${first}T12:00:00.000Z`) + offset * 86400000).toISOString().slice(0, 10);
    const { openAt } = sessionBounds(zonedInstant(day, '12:00:00', NY));
    if (openAt && Date.parse(openAt) > Date.parse(instant)) return openAt;
  }
  return null;
}
