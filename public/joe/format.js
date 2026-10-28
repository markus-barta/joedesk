// Display formatting only: English words, Austrian digits, Vienna time, true
// minus. Money arrives as exact decimal strings and is formatted from BigInt
// units (10⁻⁸, contracts/decimal.mjs), rounded once, half away from zero.
// Number remains available for chart geometry and non-money display.
import { wall, VIENNA, NY } from './time.mjs';
import { decimalUnits, roundUnits, UNIT } from './contracts/decimal.mjs';

export const MINUS = '−';
export const NB = ' ';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SYMBOL = { EUR: '€', USD: '$' };

export const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const amountOf = money => (money && typeof money.amount === 'string' ? Number(money.amount) : null);
export const currencySymbol = currency => SYMBOL[currency] ?? currency;

// Decimal MB/GB/TB, rounded half-even directly from integer bytes. Promote
// after rounding too, so 999,95 MB reads 1,0 GB rather than 1000,0 MB.
export function ledgerAmount(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Nonnegative integer bytes required');
  const value = BigInt(bytes), units = ['MB', 'GB', 'TB'];
  for (let i = 0, step = 100000n; i < units.length; i++, step *= 1000n) {
    let tenths = value / step;
    const remainder = value % step, half = step / 2n;
    if (remainder > half || (remainder === half && tenths % 2n !== 0n)) tenths++;
    if (tenths >= 10000n && i < units.length - 1) continue;
    return `${tenths / 10n},${tenths % 10n}${NB}${units[i]}`;
  }
}

export function ledgerSize(executor) {
  if (executor?.ledgerBytes == null) return null;
  const { ledgerBytes: bytes, ledgerCapBytes: cap } = executor;
  return {
    text: `ledger ${ledgerAmount(bytes)}${cap == null ? '' : ` of ${ledgerAmount(cap)}`}`,
    title: `Ledger: ${bytes} bytes${cap == null ? '' : ` of ${cap} bytes`}`,
  };
}

// Round only the display from exact units. The broker's original decimal
// lexeme stays byte-for-byte in the tooltip and accessible name.
export function cashAmount(value) {
  return { text: money(decimalUnits(value.amount), value.currency), title: `Cash: ${value.currency} ${value.amount}` };
}

function exactParts(units, d) {
  const abs = roundUnits(units < 0n ? -units : units, d);
  return [String(abs / UNIT), String(abs % UNIT).padStart(8, '0').slice(0, d)];
}
export function digits(n, d = 2) {
  const [whole, fraction] = typeof n === 'bigint' ? exactParts(n, d) : Math.abs(n).toFixed(d).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? `,${fraction}` : '');
}

// A value to show: a finite Number or exact units.
export const known = n => typeof n === 'bigint' || Number.isFinite(n);
// Zero has no sign and no arrow; a half cent rounds to zero for display.
const HALF_CENT = UNIT / 200n;
export const isZero = n => (typeof n === 'bigint' ? n > -HALF_CENT && n < HALF_CENT : Math.abs(n) < 0.005);
export const tone = n => (n == null || !known(n) || isZero(n) ? '' : n > 0 ? 'gain' : 'loss');
export const arrowOf = n => (isZero(n) ? 'flat' : n > 0 ? 'up' : 'down');

export function money(n, currency = 'EUR', signed = false, d = 2) {
  if (n == null || !known(n)) return '—';
  // Suppress signs only when zero at the requested display precision.
  if (typeof n === 'bigint' ? roundUnits(n, d) === 0n : Math.abs(n) < 0.5 * 10 ** -d) n = typeof n === 'bigint' ? 0n : 0;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `${sign}${currencySymbol(currency)}${NB}${digits(n, d)}`;
}
export const eur = (n, signed = false, d = 2) => money(n, 'EUR', signed, d);
export const pct = (n, d = 0, signed = false) => (n == null || !Number.isFinite(n) ? '—'
  : `${n < 0 ? MINUS : signed && n > 0 ? '+' : ''}${digits(n, d)}${NB}%`);

// Exact per-currency sums for native values (Kept holdings never convert).
export function sumByCurrency(values) {
  if (values.some(value => value == null)) return null;
  const sums = new Map();
  for (const value of values) {
    sums.set(value.currency, (sums.get(value.currency) ?? 0n) + decimalUnits(value.amount));
  }
  return [...sums].map(([currency, units]) => ({ currency, units }));
}

export function quantity(value) {
  // Keep every accepted digit, including fractional precision, without a float.
  const [whole, fraction] = String(value).split('.');
  return whole.replace('-', MINUS).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction === undefined ? '' : `,${fraction}`);
}

// Wall-clock parts per instant and zone. A position list repeats the same few
// instants hundreds of times, so the last ones are kept (display only).
const seen = new Map();
const parts = (instant, zone = VIENNA) => {
  const key = `${zone}|${instant}`;
  const hit = seen.get(key);
  if (hit) return hit;
  const w = wall(instant, zone);
  const date = new Date(`${w.slice(0, 10)}T12:00:00Z`);
  const p = { w, day: w.slice(0, 10), dow: DOW[date.getUTCDay()], d: date.getUTCDate(), mon: MON[date.getUTCMonth()], y: w.slice(0, 4), hm: w.slice(11, 16), hms: w.slice(11, 19) };
  if (seen.size >= 512) seen.clear();
  seen.set(key, p);
  return p;
};
export const localDay = (instant, zone = VIENNA) => parts(instant, zone).day;
export const timeHM = (instant, zone) => parts(instant, zone).hm;
export const timeHMS = (instant, zone) => parts(instant, zone).hms;
export const dayDM = (instant, zone) => { const p = parts(instant, zone); return `${p.d}${NB}${p.mon}`; };
export const dayDDM = (instant, zone) => { const p = parts(instant, zone); return `${p.dow} ${p.d}${NB}${p.mon}`; };
export const dayFull = (instant, zone) => { const p = parts(instant, zone); return `${p.dow} ${p.d}${NB}${p.mon} ${p.y}`; };
export const dateTimeFull = (instant, zone) => { const p = parts(instant, zone); return `${p.d}${NB}${p.mon} ${p.y}, ${p.hms}`; };
export const nyDayDM = instant => dayDM(instant, NY);

// Ages read as plain words with joined units: 9 s, 4 min, 2 h 18 min, 3 days.
export function age(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}${NB}s`;
  if (s < 3600) return `${Math.floor(s / 60)}${NB}min`;
  if (s < 86400) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return m ? `${h}${NB}h${NB}${m}${NB}min` : `${h}${NB}h`;
  }
  const days = Math.floor(s / 86400);
  return `${days}${NB}day${days === 1 ? '' : 's'}`;
}

// Numbers never part from their units, in any text the board writes.
const UNIT_FIX = [
  [/(\d)[ ](s|min|h|ms|%|desks?|trades?|days?|sessions?|units?)(?![\w])/g, `$1${NB}$2`],
  [/([€$])[ ](?=[−+\-]?\d)/g, `$1${NB}`],
  [/(\d) h (\d)/g, `$1${NB}h${NB}$2`],
];
export function joinUnits(text, { joinDot = false } = {}) {
  let out = text;
  for (const [pattern, replacement] of UNIT_FIX) out = out.replace(pattern, replacement);
  return joinDot ? out.replace(/ (?=·)/g, NB) : out;
}
