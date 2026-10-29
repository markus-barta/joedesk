import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { viennaDay, GAP_MS } from '../time.mjs';

export const HISTORY_CAP = 8 * 1024 * 1024;
export const HISTORY_WARNING = Math.floor(HISTORY_CAP * 0.8);
const DESKS = ['j', 'joe', 'joel'];
const MAX_AGE = 14 * 86400000;
export const historyEnvelope = value => ({ format: 'joedesk.history-store.v2', value });

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
  return { t: snapshot.generatedAt, desks, totals };
}

// One bounded pass: bucket endpoints, every series' extrema, both sides of each
// null gap and every desk's composite accounting/historyBasis transition.
// It is gap-preserving, so every interval between kept rows says what it is.
// Rows more than GAP_MS apart (time.mjs) are a gap in reporting: both rows
// around it are kept, so a pass never merges across one and every run of
// continuous reporting keeps its first and last row. Inside a run no pass
// leaves more than GAP_MS between kept rows. A kept interval of at most
// GAP_MS is therefore continuous reporting, thinned or not, and a longer one
// is exactly a gap the input had. No row needs a mark for that: the history
// contract stays as it is, and every older page and server reads it.
export function compactPoints(points, bucketSize = 64) {
  const keep = new Set([0, points.length - 1]);
  const at = points.map(p => Date.parse(p.t));
  const series = p => [...DESKS.map(id => p.desks[id]?.money), p.totals];
  const basis = p => JSON.stringify(DESKS.map(id => [p.desks[id]?.accounting ?? null, p.desks[id]?.historyBasis ?? null]));
  let previousBasis, previousPresence, previousDay;
  let dailyLast = [];
  let extrema = new Map();
  for (let i = 0; i < points.length; i++) {
    if (i % bucketSize === 0) { extrema = new Map(); keep.add(i); if (i) keep.add(i - 1); }
    if (i && at[i] - at[i - 1] > GAP_MS) { keep.add(i - 1); keep.add(i); }
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
  // Between two kept rows of one run, keep the furthest row within GAP_MS of
  // the last kept one until the next is in reach. Gap ends are kept, so every
  // row between two kept ones is at most GAP_MS from the row before it.
  const kept = [...keep].sort((a, b) => a - b);
  for (let k = 1; k < kept.length; k++) {
    for (let last = kept[k - 1]; kept[k] > last + 1 && at[kept[k]] - at[last] > GAP_MS;) {
      let next = last + 1;
      while (next + 1 < kept[k] && at[next + 1] - at[last] <= GAP_MS) next++;
      keep.add(next); last = next;
    }
  }
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
  const check = validateContract('history', value);
  if (!check.ok) throw new Error('history_write_failed');
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
