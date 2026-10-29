// Board display policy layered over the unchanged producer contract selector.
import { panelStates, panelState, MONEY_FIELDS } from './contracts/panel-state.mjs';
import { nyDay } from './time.mjs';
import { validInstant } from './contracts/schema-validator.mjs';

export const RETENTION_SECONDS = 60 * 60;
// DATA-feed stalls follow the outage policy without changing selector health
// or the existing stale captions. Replays keep their existing advisory policy.
export const stoppedData = cell => ['snapshot_stale', 'producer_frozen'].includes(cell?.reason);
export const outageValue = cell => Boolean(cell?.retained || stoppedData(cell));
export const NOT_EXACT_REASONS = new Set(['not_exact_yet', 'sod_missing', 'ledger_unreconciled', 'position_stale', 'baseline_pending', 'day_pnl_unavailable']);
// A dash the feed explains as not exact (never a fault, never a last value).
export const notExactDash = cell => cell?.value == null && NOT_EXACT_REASONS.has(cell?.reason);
// The board's one test for a value it may treat as current and true: shown,
// fresh, with no reason at all (no fault and not "not exact"), not an outage's
// last good value, and not from a source that calls itself unavailable.
export const trustedCurrent = cell => cell?.value != null && cell.state === 'fresh' && !cell.reason && !outageValue(cell) &&
  (cell.valueSource == null || cell.valueSource.status === 'available');
const DESKS = ['j', 'joe', 'joel'];

// Every channel a P&L figure has on the wire besides the board's own cell:
// its money reason and its source's status and reason. A desk
// without its own source uses the snapshot's, as the selector does.
export function pnlChannels(data, scope, field) {
  const desk = scope === 'today' ? null : data?.desks?.find(d => d.id === scope);
  const bag = scope === 'today' ? data?.totals : desk?.money;
  const period = field === 'dayPnl' ? 'day' : 'open';
  return { moneyReason: bag?.reasons?.[field] ?? null, source: (desk?.pnlSources?.[period] ?? data?.pnlSources?.[period]) ?? null };
}
export const dayChannels = (data, scope) => pnlChannels(data, scope, 'dayPnl');
// The one classifier for a Today or Open figure, over every channel: the board's cell
// (value, state, freshness, retention and the reason the selector or the
// board chose), the money reason and the source's status and reason.
// - 'fault' wins: any fault reason on any channel, a missing cell, a last good
//   value or stopped data, or anything that is neither of the two below.
// - 'notExact': withheld, and every reason on every channel is a not-exact one.
// - 'exact': a trustworthy current value (trustedCurrent) from an available
//   source, with no reason on any channel; `estimated` marks a session-open estimate.
export function classifyCell(cell, { moneyReason = null, source = null } = {}) {
  const reasons = [cell?.reason, moneyReason, source?.reason].filter(Boolean);
  const fault = reasons.find(reason => !NOT_EXACT_REASONS.has(reason));
  if (fault) return { kind: 'fault', reason: fault };
  if (!cell || outageValue(cell)) return { kind: 'fault', reason: null };
  const notExact = reasons.find(reason => NOT_EXACT_REASONS.has(reason));
  if (notExact) return { kind: 'notExact', reason: notExact };
  if (trustedCurrent(cell) && (source == null || source.status === 'available')) {
    return { kind: 'exact', reason: null, estimated: source?.method === 'session-open-estimate' };
  }
  return { kind: 'fault', reason: null };
}
export const classifyDay = (cell, channels) => classifyCell(cell, channels);
// The household and every desk, classified the same way for either P&L field.
export const classifyCells = (states, data, field) => Object.fromEntries(['today', ...DESKS].map(scope =>
  [scope, classifyCell(states[scope === 'today' ? `today.${field}` : `desks.${scope}.${field}`], pnlChannels(data, scope, field))]));
export const classifyDays = (states, data) => classifyCells(states, data, 'dayPnl');
const positionKey = row => JSON.stringify([row.scope, row.desk, row.symbol]);
const unavailable = (cell, reason = cell.reason) => ({ ...cell, state: cell.state === 'fresh' ? 'broken' : cell.state, value: null, retained: false, reason });
// Hiding a derived amount does not erase the observation's health/grace.
// Keep only value-free evidence; calculations and rendering still see null.
const withheld = (cell, reason = cell.reason) => ({ ...unavailable(cell, reason),
  health: cell.health ?? { available: cell.value != null, retained: cell.retained, ageSeconds: cell.ageSeconds } });

export function withGenerationAge(cell, feed, now) {
  const generationAge = validInstant(feed?.generatedAdvancedAt)
    ? Math.max(0, (Date.parse(now) - Date.parse(feed.generatedAdvancedAt)) / 1000) : null;
  // Rejection takes precedence over producer_frozen in the selector. It
  // must not reset a retained observation to the most recent re-send's age.
  // Keep the selector's health/grace separate from the display clock.
  return cell.retained && cell.ageSeconds != null && generationAge >= 60 && generationAge > cell.ageSeconds
    ? { ...cell, ageSeconds: generationAge,
      health: cell.health ?? { available: cell.value != null, retained: cell.retained, ageSeconds: cell.ageSeconds } }
    : cell;
}

export function boardStates(feeds, now, previous = {}) {
  const states = panelStates(feeds, now, previous);
  const data = feeds.data?.value;
  const fieldReason = (name, field) => {
    const desk = name.startsWith('desks.') ? data?.desks.find(d => d.id === name.split('.')[1]) : null;
    const bag = desk?.money ?? data?.totals;
    const period = field === 'dayPnl' ? 'day' : field === 'openPnl' ? 'open' : null;
    return [bag?.reasons?.[field], period ? (desk?.pnlSources?.[period] ?? data?.pnlSources?.[period])?.reason : null];
  };
  const numeric = ['paperAccount', 'paperCash', 'positions', 'kept',
    ...MONEY_FIELDS.flatMap(field => [`today.${field}`, ...DESKS.map(id => `desks.${id}.${field}`)])];
  for (const name of numeric) {
    const field = name.split('.').at(-1);
    const sourceReasons = name === 'paperAccount' ? [data?.brokerAccount?.reason]
      : name === 'paperCash' ? [data?.brokerAccount?.reasons?.cash]
        : ['positions', 'kept'].includes(name) ? [data?.positions?.reason] : fieldReason(name, field);
    // The sealed selector accepts legacy non-null retained_values. Discard
    // that candidate amount and select only the trusted prior observation.
    if (sourceReasons.includes('retained_values')) {
      const prior = previous[name];
      states[name] = panelState(feeds.data, null, states[name].reason ?? 'retained_values', now,
        prior?.value, prior?.valueReceivedAt);
    }
    states[name] = withGenerationAge(states[name], feeds.data, now);
    const cell = states[name];
    // Scoped exactness failures still apply when a feed/gateway failure masks
    // their reason in the shared selector. An outage cannot restore an amount.
    const inexact = [cell.reason, ...sourceReasons]
      .find(reason => NOT_EXACT_REASONS.has(reason));
    // Beside a not-exact channel, a fault on another of the figure's own
    // channels (money or source) is the cell's reason: it never hides behind
    // "not exact". A feed or gateway failure still does not replace the scoped
    // not-exact reason (it stays on the header path, JOED-98).
    const scopedFault = sourceReasons.find(reason => reason && !NOT_EXACT_REASONS.has(reason));
    const expired = outageValue(cell) && (cell.ageSeconds == null || cell.ageSeconds >= RETENTION_SECONDS);
    // Today belongs to the observation's NY date, even if a real outage or
    // stopped feed spans midnight. Receipt time cannot freshen old evidence.
    let differentDay = false;
    if (field === 'dayPnl' && cell.value != null) {
      const desk = name.startsWith('desks.') ? data?.desks.find(d => d.id === name.split('.')[1]) : null;
      cell.valueSource = cell.retained ? previous[name]?.valueSource ?? null
        : (desk?.pnlSources?.day ?? data?.pnlSources?.day) ?? null;
      const observedAt = cell.retained ? previous[name]?.valueObservedAt ?? cell.valueReceivedAt
        : (desk?.pnlSources?.day ?? data?.pnlSources?.day)?.observedAt ?? data?.generatedAt ?? cell.valueReceivedAt;
      cell.valueObservedAt = observedAt;
      differentDay = !validInstant(observedAt) || nyDay(observedAt) !== nyDay(now);
    }
    if (inexact || expired || differentDay) states[name] = {
      // Preserve scoped exactness for every existing cell/health consumer.
      // Feed rejection and transport evidence stays on the feed/header path.
      ...unavailable(cell, inexact ? scopedFault ?? inexact : cell.reason ?? (differentDay ? 'baseline_pending' : null)),
      // Value-free evidence for Results after unavailable() clears retained.
      ...(expired ? { outageExpired: true } : {}),
    };
    // An unavailable Open source without a reason cannot leave a fresh-looking
    // amount on the cards. Keep its observation, but expose the classifier's fault.
    if (field === 'openPnl') {
      const scope = name.startsWith('desks.') ? name.split('.')[1] : 'today';
      const result = classifyCell(states[name], pnlChannels(data, scope, field));
      if (result.kind === 'fault' && states[name].state === 'fresh') states[name] = {
        ...states[name], state: 'broken', reason: result.reason ?? 'source_unavailable',
      };
    }
  }
  // Recheck policy after every prior-array fallback, including retained_values.
  // Withhold moved rows rather than inventing new scope/desk evidence or age.
  const keep = new Set(['SXR8', 'TSLA', ...(feeds['fleet-config']?.value?.desks.keep ?? [])]);
  const affectedDesks = new Set();
  for (const row of [...(data?.positions?.rows ?? []), ...(states.positions.value ?? []), ...(states.kept.value ?? [])]) {
    if (keep.has(row.symbol) !== (row.scope === 'keep') || (keep.has(row.symbol) && row.desk !== null))
      for (const id of row.desk ? [row.desk] : DESKS) affectedDesks.add(id);
  }
  for (const name of ['positions', 'kept']) {
    const cell = states[name];
    if (cell.value) states[name] = { ...cell, value: cell.value.filter(row => keep.has(row.symbol) === (name === 'kept')) };
  }
  // A changed partition invalidates affected prior desk amounts too.
  for (const id of affectedDesks) for (const field of MONEY_FIELDS) {
    const name = `desks.${id}.${field}`;
    states[name] = withheld(states[name], states[name].reason ?? 'source_not_authoritative');
  }
  // An outage can retain an older position list, but current per-field
  // exactness failures still invalidate those same older fields.
  const currentRows = new Map((data?.positions?.rows ?? []).map(row => [positionKey(row), row]));
  for (const name of ['positions', 'kept']) {
    const cell = states[name];
    if (!cell.value) continue;
    states[name] = { ...cell, value: cell.value.map(row => {
      const current = currentRows.get(positionKey(row));
      const blocked = Object.entries({ ...row.reasons, ...current?.reasons }).filter(([field, reason]) =>
        ['quantity', 'mark', 'marketValue', 'dayPnl', 'openPnl'].includes(field) && NOT_EXACT_REASONS.has(reason));
      return blocked.length ? { ...row, ...Object.fromEntries(blocked.map(([field]) => [field, null])),
        reasons: { ...row.reasons, ...Object.fromEntries(blocked) } } : row;
    }) };
  }
  // Totals and since-start are derived figures. Never display a carried
  // result or combine exact siblings with an outage/missing input. A desk
  // Today or Open the classifier calls a fault (even beside a value)
  // is no input for the household total either (JOED-148, JOED-157).
  for (const field of MONEY_FIELDS) {
    const name = `today.${field}`, cell = states[name];
    const inputs = DESKS.map(id => ({ cell: states[`desks.${id}.${field}`],
      result: ['dayPnl', 'openPnl'].includes(field) ? classifyCell(states[`desks.${id}.${field}`], pnlChannels(data, id, field)) : null }));
    const faulty = inputs.find(input => input.result?.kind === 'fault');
    const blocked = faulty ?? inputs.find(({ cell: c }) => outageValue(c) || c.value == null);
    const own = faulty ? classifyCell(cell, pnlChannels(data, 'today', field)) : null;
    // A fault wins the caption even if the household already had a not-exact
    // dash. Desk order cannot turn that fault into a not-exact explanation.
    if (outageValue(cell) || (cell.value != null && blocked) || faulty) states[name] = withheld(
      faulty && cell.state === 'not reported' ? { ...cell, state: 'broken' } : cell,
      faulty ? (own.kind === 'fault' ? own.reason : null) ?? faulty.result.reason ?? 'source_unavailable' : cell.reason ?? blocked?.cell.reason);
  }
  for (const id of DESKS) {
    const name = `desks.${id}.totalPnl`;
    if (outageValue(states[name])) states[name] = withheld(states[name]);
  }
  return states;
}
