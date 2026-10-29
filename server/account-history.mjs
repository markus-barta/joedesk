import { REASONS } from '../contracts/index.mjs';
import { validInstant } from '../contracts/schema-validator.mjs';
import { viennaDay } from '../time.mjs';

export const ACCOUNT_FIELDS = Object.freeze(['equity', 'cash']);
export const ACCOUNT_CLOSES_FORMAT = 'joedesk.account-closes-store.v1';
export const ACCOUNT_CLOSES_SCHEMA = 'inspr.joe.account-closes.v1';
export const ACCOUNT_CLOSES_CAP = 2 * 1024 * 1024;
// Six years of calendar dates (including leap days), independent of market
// calendar coverage. No missing day is synthesized or forward-filled.
export const ACCOUNT_CLOSES_DAYS = 2196;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const exactEUR = value => keysOnly(value, ['amount', 'currency']) && value.currency === 'EUR' &&
  typeof value.amount === 'string' && value.amount.length <= 32 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value.amount);

export function accountObservation(snapshot, states) {
  const observedAt = snapshot.brokerAccount?.observedAt ?? null;
  const timingReason = !validInstant(observedAt) ? 'source_unavailable'
    : Date.parse(observedAt) > Date.parse(snapshot.generatedAt) ? 'clock_ahead' : null;
  const account = { observedAt }, reasons = {};
  for (const [field, panel] of [['equity', 'paperAccount'], ['cash', 'paperCash']]) {
    const cell = states[panel], value = snapshot.brokerAccount?.[field];
    const reason = field === 'equity' ? snapshot.brokerAccount?.reason : snapshot.brokerAccount?.reasons?.cash;
    account[field] = value && !timingReason && cell?.state === 'fresh' && !cell.retained && !cell.reason && !reason
      ? { amount: value.amount, currency: value.currency } : null;
    if (account[field] === null) reasons[field] = cell?.reason ?? reason ?? timingReason ?? (cell?.retained ? 'retained_values' : 'source_unavailable');
  }
  if (Object.keys(reasons).length) account.reasons = reasons;
  return account;
}

export function validAccountObservation(account) {
  return keysOnly(account, [...ACCOUNT_FIELDS, 'observedAt', 'reasons']) &&
    (account.observedAt === null || validInstant(account.observedAt)) &&
    (account.reasons === undefined || keysOnly(account.reasons, ACCOUNT_FIELDS)) &&
    ACCOUNT_FIELDS.every(field => account[field] === null
      ? REASONS.includes(account.reasons?.[field])
      : validInstant(account.observedAt) && exactEUR(account[field]) && account.reasons?.[field] === undefined);
}

export const emptyAccountCloses = () => ({ schema: ACCOUNT_CLOSES_SCHEMA, timeZone: 'Europe/Vienna', days: [] });
export const accountClosesEnvelope = value => ({ format: ACCOUNT_CLOSES_FORMAT, value });

export function validateAccountCloses(value) {
  if (!keysOnly(value, ['schema', 'timeZone', 'days']) || value.schema !== ACCOUNT_CLOSES_SCHEMA ||
      value.timeZone !== 'Europe/Vienna' || !Array.isArray(value.days) || value.days.length > ACCOUNT_CLOSES_DAYS ||
      Buffer.byteLength(JSON.stringify(accountClosesEnvelope(value))) > ACCOUNT_CLOSES_CAP) throw new Error('contract_invalid');
  let previous;
  for (const day of value.days) {
    if (!keysOnly(day, ['day', 't', 'equity', 'cash', 'equityAt', 'cashAt']) || !validInstant(day.t) ||
        day.day !== viennaDay(day.t) || (previous && day.day <= previous) ||
        !ACCOUNT_FIELDS.some(field => day[field] !== null) ||
        !ACCOUNT_FIELDS.every(field => day[field] === null ? day[`${field}At`] === null :
          exactEUR(day[field]) && validInstant(day[`${field}At`]) && viennaDay(day[`${field}At`]) === day.day &&
          Date.parse(day[`${field}At`]) <= Date.parse(day.t)) ||
        !ACCOUNT_FIELDS.some(field => day[`${field}At`] === day.t)) throw new Error('contract_invalid');
    previous = day.day;
  }
  return value;
}

// Fields advance independently: an unavailable later sample never overwrites
// an exact close or gives it a newer observation timestamp.
export function appendAccountClose(previous, t, account) {
  if (!validInstant(t) || t !== account?.observedAt || !validAccountObservation(account)) throw new Error('contract_invalid');
  if (!ACCOUNT_FIELDS.some(field => account[field] !== null)) return previous;
  const day = viennaDay(t);
  if (previous.days.length === ACCOUNT_CLOSES_DAYS && day < previous.days[0].day) return previous;
  const index = previous.days.findIndex(entry => entry.day === day);
  const entry = index >= 0 ? { ...previous.days[index] } : { day, t, equity: null, cash: null, equityAt: null, cashAt: null };
  let changed = false;
  for (const field of ACCOUNT_FIELDS) if (account[field] !== null &&
      (entry[`${field}At`] === null || Date.parse(t) > Date.parse(entry[`${field}At`]))) {
    entry[field] = account[field]; entry[`${field}At`] = t;
    changed = true;
  }
  if (!changed) return previous;
  entry.t = ACCOUNT_FIELDS.map(field => entry[`${field}At`]).filter(Boolean).sort().at(-1);
  const days = [...previous.days];
  if (index >= 0) days[index] = entry;
  else { days.push(entry); days.sort((a, b) => a.day.localeCompare(b.day)); }
  return validateAccountCloses({ ...previous, days: days.slice(-ACCOUNT_CLOSES_DAYS) });
}
