// Display formatting only: English words, Austrian digits, Vienna time, true
// minus. Money arrives as exact decimal strings; Number is used for display.
import { wall, VIENNA, NY } from './time.mjs';
import { decimalUnits } from './contracts/decimal.mjs';

export const MINUS = '−';
export const NB = ' ';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SYMBOL = { EUR: '€', USD: '$' };

export const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const amountOf = money => (money && typeof money.amount === 'string' ? Number(money.amount) : null);
export const currencySymbol = currency => SYMBOL[currency] ?? currency;

export function digits(n, d = 2) {
  const [whole, fraction] = Math.abs(n).toFixed(d).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? `,${fraction}` : '');
}

// Zero has no sign and no arrow; a half cent rounds to zero for display.
export const isZero = n => Math.abs(n) < 0.005;
export const tone = n => (n == null || !Number.isFinite(n) || isZero(n) ? '' : n > 0 ? 'gain' : 'loss');
export const arrowOf = n => (isZero(n) ? 'flat' : n > 0 ? 'up' : 'down');

export function money(n, currency = 'EUR', signed = false, d = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (isZero(n)) n = 0;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `${sign}${currencySymbol(currency)}${NB}${digits(n, d)}`;
}
export const eur = (n, signed = false, d = 2) => money(n, 'EUR', signed, d);
export const pct = (n, d = 0, signed = false) => (n == null || !Number.isFinite(n) ? '—'
  : `${n < 0 ? MINUS : signed && n > 0 ? '+' : ''}${digits(n, d)}${NB}%`);

// Exact per-currency sums for native values (Kept holdings never convert).
export function sumByCurrency(values) {
  const sums = new Map();
  for (const value of values) {
    if (!value) continue;
    sums.set(value.currency, (sums.get(value.currency) ?? 0n) + decimalUnits(value.amount));
  }
  return [...sums].map(([currency, units]) => ({ currency, amount: Number(units) / 1e8 }));
}

export function quantity(value) {
  const n = Number(value);
  return Number.isInteger(n) ? digits(n, 0) : String(value).replace('.', ',');
}

const parts = (instant, zone = VIENNA) => {
  const w = wall(instant, zone);
  const date = new Date(`${w.slice(0, 10)}T12:00:00Z`);
  return { w, day: w.slice(0, 10), dow: DOW[date.getUTCDay()], d: date.getUTCDate(), mon: MON[date.getUTCMonth()], y: w.slice(0, 4), hm: w.slice(11, 16), hms: w.slice(11, 19) };
};
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
export function joinUnits(text) {
  let out = text;
  for (const [pattern, replacement] of UNIT_FIX) out = out.replace(pattern, replacement);
  return out;
}
