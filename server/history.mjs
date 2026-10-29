import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { viennaDay, GAP_MS } from '../time.mjs';
import { emptyContinuity, continuityClaims } from '../public/joe/history-continuity.js';

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

// Absolute UTC buckets, coarsening with age: 4 h in the newest UTC day,
// 12 h on the preceding six UTC days, 24 h before that. Widths divide the next width, so
// advancing age only merges buckets. The reference is explicit and fixed for
// a pass (default: newest observation); never align to the first kept row.
const DAY = 86400000;
export const HISTORY_BUCKET_MS = Object.freeze([4 * 3600000, 12 * 3600000, DAY]);
export function compactHistory(points, { now = points.at(-1)?.t, continuity = null } = {}) {
  if (!points.length) return { points: [], intervals: [] };
  const keep = new Set([0, points.length - 1]);
  const claims = continuityClaims(continuity);
  const at = points.map(p => Date.parse(p.t));
  const today = Math.floor(Date.parse(now) / DAY) * DAY;
  const bucket = t => {
    const age = today - Math.floor(t / DAY) * DAY;
    const band = age < DAY ? 0 : age < 7 * DAY ? 1 : 2;
    return `${band}/${Math.floor(t / HISTORY_BUCKET_MS[band])}`;
  };
  const series = p => [...DESKS.map(id => p.desks[id]?.money), p.totals];
  const basis = p => JSON.stringify(DESKS.map(id => [p.desks[id]?.accounting ?? null, p.desks[id]?.historyBasis ?? null]));
  let previousBasis, previousPresence, previousDay, previousBucket;
  let dailyLast = [], extrema = new Map();
  // A prefix count lets us prove a kept interval contains no unknown/raw gap.
  const breaks = new Uint32Array(points.length);
  const finishBucket = last => {
    if (last < 0) return;
    keep.add(last); // last actual observation, not a synthetic average
    for (const e of extrema.values()) { keep.add(e.minAt); keep.add(e.maxAt); }
  };
  for (let i = 0; i < points.length; i++) {
    const connected = i && (at[i] - at[i - 1] <= GAP_MS || claims.has(`${points[i - 1].t}/${points[i].t}`));
    breaks[i] = (breaks[i - 1] ?? 0) + (i && !connected ? 1 : 0);
    const key = bucket(at[i]);
    if (i && (!connected || key !== previousBucket)) {
      finishBucket(i - 1); extrema = new Map();
    }
    if (i && !connected) { keep.add(i - 1); keep.add(i); }
    const p = points[i], identity = basis(p), day = viennaDay(p.t);
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
    previousBasis = identity; previousPresence = presence; previousDay = day; previousBucket = key;
  }
  finishBucket(points.length - 1);
  for (const index of dailyLast) if (index !== undefined) keep.add(index);
  const indices = [...keep].sort((a, b) => a - b), intervals = [];
  for (let k = 1; k < indices.length; k++) {
    const a = indices[k - 1], b = indices[k];
    if (breaks[a] === breaks[b] && (b > a + 1 || claims.has(`${points[a].t}/${points[b].t}`))) {
      intervals.push([points[a].t, points[b].t]);
    }
  }
  return { points: indices.map(i => points[i]), intervals };
}

// Compatibility for callers needing only the unchanged rows. Without a
// sidecar, previously thinned long intervals are conservatively run edges.
export const compactPoints = points => compactHistory(points).points;

// Retain claims only for exact adjacent pairs still in the retained store.
export function retainedContinuity(points, continuity, historySeq) {
  const claims = continuityClaims(continuity), intervals = [];
  for (let i = 1; i < points.length; i++) if (claims.has(`${points[i - 1].t}/${points[i].t}`)) intervals.push([points[i - 1].t, points[i].t]);
  return { ...emptyContinuity(historySeq), intervals };
}

export function measureHistory(value) {
  // sizeBytes measures the persisted UTF-8 envelope, including this field.
  let bytes = 0;
  do { value.sizeBytes = bytes; bytes = Buffer.byteLength(JSON.stringify(historyEnvelope(value))); }
  while (value.sizeBytes !== bytes);
  return bytes;
}

export function boundHistory(value, continuity = emptyContinuity()) {
  if (value.reason === 'history_compacted') delete value.reason;
  const bytes = measureHistory(value);
  if (bytes >= HISTORY_WARNING || value.points.length > 10000) {
    const compacted = compactHistory(value.points, { now: value.generatedAt, continuity });
    value.points = compacted.points;
    continuity.intervals = compacted.intervals;
    value.compactedThrough = value.points.at(-1)?.t ?? value.generatedAt;
    measureHistory(value);
  }
  Object.assign(continuity, retainedContinuity(value.points, continuity, value.seq));
  if (value.sizeBytes > HISTORY_CAP || value.points.length > 10000) throw new Error('history_size_limit');
  const check = validateContract('history', value);
  if (!check.ok) throw new Error('history_write_failed');
  return value;
}

export function appendHistory(previous, snapshot, states, now, continuity = emptyContinuity()) {
  if (previous && Date.parse(snapshot.generatedAt) <= Date.parse(previous.points.at(-1)?.t)) return previous;
  const cutoff = Date.parse(now) - MAX_AGE;
  const points = (previous?.points ?? []).filter(p => Date.parse(p.t) >= cutoff);
  // Retain compaction metadata until its entire range leaves retention.
  const compacted = previous?.compactedThrough &&
    points.some(p => Date.parse(p.t) <= Date.parse(previous.compactedThrough));
  points.push(historyPoint(snapshot, states));
  return boundHistory({ schema: CONTRACTS.contracts.history, seq: (previous?.seq ?? 0) + 1,
    generatedAt: now, receivedAt: now, points, sizeBytes: 0,
    ...(compacted ? { compactedThrough: previous.compactedThrough } : {}) }, continuity);
}
