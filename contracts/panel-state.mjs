import { REASONS } from './index.mjs';
import { validInstant } from './schema-validator.mjs';

export const MONEY_FIELDS = Object.freeze(['equity', 'dayPnl', 'openPnl', 'totalPnl']);
export const DATA_PANELS = Object.freeze([
  ...MONEY_FIELDS.map(f => `today.${f}`), 'paperAccount',
  ...['j', 'joe', 'joel'].flatMap(id => MONEY_FIELDS.map(f => `desks.${id}.${f}`)),
  'positions', 'kept', 'gateway', 'halt', 'executor',
]);
export const PANELS = Object.freeze([...DATA_PANELS, 'history', 'results', 'fleet-config']);
export function feedAge(feed, now) {
  const receivedAt = feed?.value?.receivedAt ?? feed?.receivedAt;
  if (!receivedAt) return null;
  return Math.max(0, (Date.parse(now) - Date.parse(receivedAt)) / 1000);
}

// Per-field pure selector, with optional prior accepted value for null/error
// retention. Presence, errors and freshness stay independent for every cell.
export function panelState(feed, value, reason, now, lastGood = null) {
  if (!validInstant(now)) throw new TypeError('A current instant is required');
  if (reason && !REASONS.includes(reason)) throw new TypeError('Unknown panel reason');
  const age = feedAge(feed, now);
  if (feed?.reason || reason) return {
    state: 'broken', ageSeconds: age, reason: feed?.reason || reason,
    value: value ?? lastGood, retained: value == null && lastGood != null,
  };
  if (value == null) return { state: 'not reported', ageSeconds: null, reason: null, value: null, retained: false };
  const frozenAge = feed?.generatedAdvancedAt ? Math.max(0, (Date.parse(now) - Date.parse(feed.generatedAdvancedAt)) / 1000) : age;
  const frozen = frozenAge >= 60 && frozenAge > age;
  return {
    state: frozen || age >= 60 ? 'stale' : 'fresh', ageSeconds: frozen ? frozenAge : age,
    reason: frozen ? 'producer_frozen' : age >= 60 ? 'snapshot_stale' : null,
    value, retained: false,
  };
}

export function panelStates(feeds, now, previousValues = {}) {
  const data = feeds.data?.value;
  const output = {};
  const select = (name, feed, value, reason) => {
    output[name] = panelState(feed, value, reason, now, previousValues[name]?.value);
  };
  for (const field of MONEY_FIELDS) select(`today.${field}`, feeds.data, data?.totals[field], data?.totals.reasons?.[field]);
  select('paperAccount', feeds.data, data?.brokerAccount?.equity);
  for (const id of ['j', 'joe', 'joel']) {
    const desk = data?.desks.find(d => d.id === id);
    for (const field of MONEY_FIELDS) select(`desks.${id}.${field}`, feeds.data, desk?.money[field], desk?.money.reasons?.[field]);
  }
  select('positions', feeds.data, data?.positions?.rows.filter(p => p.scope !== 'keep'), data?.positions?.reason);
  select('kept', feeds.data, data?.positions?.rows.filter(p => p.scope === 'keep'), data?.positions?.reason);
  select('gateway', feeds.data, data?.safety.gateway, data?.safety.gateway?.reason);
  select('halt', feeds.data, data?.safety.halt, data?.safety.halt ? data.safety.haltReason : null);
  select('executor', feeds.data, data?.safety.executor, data?.safety.executor?.reason);
  for (const name of ['history', 'results', 'fleet-config']) {
    select(name, feeds[name], feeds[name]?.value, feeds[name]?.value?.reason);
  }
  return output;
}

export function stateTable(states) {
  return Object.fromEntries(Object.entries(states).map(([k, { state, ageSeconds, reason }]) => [k, { state, ageSeconds, reason }]));
}
