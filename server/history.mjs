import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { viennaDay } from '../time.mjs';
import { accountObservation, validAccountObservation } from './account-history.mjs';

export const HISTORY_CAP = 8 * 1024 * 1024;
export const HISTORY_WARNING = Math.floor(HISTORY_CAP * 0.8);
const DESKS = ['j', 'joe', 'joel'];
const MAX_AGE = 14 * 86400000;
export const historyEnvelope = value => ({ format: value.points.some(p => Object.hasOwn(p, 'account'))
  ? 'joedesk.history-store.v3' : 'joedesk.history-store.v2', value });

// The immutable desk wire contract has no extension fields. The server's v3
// envelope records account observations; the sibling account endpoint exposes
// them without changing the existing page's validation or desk calculations.
export function deskHistory(value) {
  if (!value || !value.points.some(p => Object.hasOwn(p, 'account'))) return value;
  return { ...value, points: value.points.map(({ account, ...point }) => point) };
}

export function validHistory(value) {
  return Array.isArray(value?.points) && value.points.every(p => !Object.hasOwn(p, 'account') ||
    (validAccountObservation(p.account) && (!(p.account.equity || p.account.cash) || Date.parse(p.account.observedAt) <= Date.parse(p.t)))) &&
    validateContract('history', deskHistory(value)).ok;
}

export function historyPoint(snapshot, states) {
  const desks = {};
  for (const id of DESKS) {
    const source = snapshot.desks.find(d => d.id === id);
    const money = {}, reasons = {};
    for (const field of MONEY_FIELDS) {
      const cell = states[`desks.${id}.${field}`];
      money[field] = cell.state === 'fresh' && !cell.retained ? cell.value ?? null : null;
      if (!money[field]) reasons[field] = cell.reason ?? 'retained_values';
    }
    if (Object.keys(reasons).length) money.reasons = reasons;
    desks[id] = { money, ...(source?.accounting ? { accounting: source.accounting } : {}),
      ...(source?.historyBasis ? { historyBasis: source.historyBasis } : {}) };
  }
  const totals = {}, reasons = {};
  for (const field of MONEY_FIELDS) {
    const cell = states[`today.${field}`];
    totals[field] = DESKS.every(id => desks[id].money[field]) && cell.state === 'fresh' && !cell.retained ? cell.value ?? null : null;
    if (!totals[field]) reasons[field] = cell.reason ?? 'family_projection_unavailable';
  }
  if (Object.keys(reasons).length) totals.reasons = reasons;
  return { t: snapshot.generatedAt, desks, totals, account: accountObservation(snapshot, states) };
}

// One bounded pass: bucket endpoints, every series' extrema, both sides of each
// null gap and every desk's composite accounting/historyBasis transition.
export function compactPoints(points, bucketSize = 64) {
  const keep = new Set([0, points.length - 1]);
  const series = p => [...DESKS.map(id => p.desks[id]?.money), p.totals];
  const basis = p => JSON.stringify(DESKS.map(id => [p.desks[id]?.accounting ?? null, p.desks[id]?.historyBasis ?? null]));
  let previousBasis, previousPresence, previousDay;
  let dailyLast = [];
  let extrema = new Map();
  for (let i = 0; i < points.length; i++) {
    if (i % bucketSize === 0) { extrema = new Map(); keep.add(i); if (i) keep.add(i - 1); }
    const p = points[i], identity = basis(p);
    const day = viennaDay(p.t);
    if (previousDay && day !== previousDay) {
      for (const index of dailyLast) if (index !== undefined) keep.add(index);
      dailyLast = [];
    }
    const values = series(p).flatMap(bag => MONEY_FIELDS.map(field => bag?.[field] ?? null));
    const presence = values.map(v => v !== null).join(',');
    if (i && (identity !== previousBasis || presence !== previousPresence)) { keep.add(i - 1); keep.add(i); }
    values.forEach((value, key) => {
      if (!value) return;
      dailyLast[key] = i;
      const units = decimalUnits(value.amount), old = extrema.get(key);
      if (!old) extrema.set(key, { min: units, max: units, minAt: i, maxAt: i });
      else {
        if (units < old.min) { old.min = units; old.minAt = i; }
        if (units > old.max) { old.max = units; old.maxAt = i; }
      }
    });
    if ((i + 1) % bucketSize === 0 || i === points.length - 1) {
      for (const e of extrema.values()) { keep.add(e.minAt); keep.add(e.maxAt); }
    }
    previousBasis = identity; previousPresence = presence; previousDay = day;
  }
  for (const index of dailyLast) if (index !== undefined) keep.add(index);
  return points.filter((_, i) => keep.has(i));
}

export function measureHistory(value) {
  // sizeBytes measures the persisted UTF-8 envelope, including this field.
  let bytes = 0;
  do { value.sizeBytes = bytes; bytes = Buffer.byteLength(JSON.stringify(historyEnvelope(value))); }
  while (value.sizeBytes !== bytes);
  return bytes;
}

export function boundHistory(value) {
  if (value.reason === 'history_compacted') delete value.reason;
  const bytes = measureHistory(value);
  if (bytes >= HISTORY_WARNING || value.points.length > 10000) {
    value.points = compactPoints(value.points);
    value.compactedThrough = value.points.at(-1)?.t ?? value.generatedAt;
    measureHistory(value);
  }
  if (value.sizeBytes > HISTORY_CAP || value.points.length > 10000) throw new Error('history_size_limit');
  if (!validHistory(value)) throw new Error('history_write_failed');
  return value;
}

export function appendHistory(previous, snapshot, states, now) {
  if (previous && Date.parse(snapshot.generatedAt) <= Date.parse(previous.points.at(-1)?.t)) return previous;
  const cutoff = Date.parse(now) - MAX_AGE;
  const points = (previous?.points ?? []).filter(p => Date.parse(p.t) >= cutoff);
  // Retain compaction metadata until its entire range leaves retention.
  const compacted = previous?.compactedThrough &&
    points.some(p => Date.parse(p.t) <= Date.parse(previous.compactedThrough));
  points.push(historyPoint(snapshot, states));
  return boundHistory({ schema: CONTRACTS.contracts.history, seq: (previous?.seq ?? 0) + 1,
    generatedAt: now, receivedAt: now, points, sizeBytes: 0,
    ...(compacted ? { compactedThrough: previous.compactedThrough } : {}) });
}
