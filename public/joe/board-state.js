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
const DESKS = ['j', 'joe', 'joel'];
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
      .some(reason => NOT_EXACT_REASONS.has(reason));
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
      ...unavailable(cell, cell.reason ?? (differentDay ? 'baseline_pending' : null)),
      // Value-free evidence for Results after unavailable() clears retained.
      ...(expired ? { outageExpired: true } : {}),
    };
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
  // result or combine exact siblings with an outage/missing input.
  for (const field of MONEY_FIELDS) {
    const name = `today.${field}`, cell = states[name];
    const blocked = DESKS.map(id => states[`desks.${id}.${field}`]).find(c => outageValue(c) || c.value == null);
    if (outageValue(cell) || (cell.value != null && blocked)) states[name] = withheld(cell, cell.reason ?? blocked?.reason);
  }
  for (const id of DESKS) {
    const name = `desks.${id}.totalPnl`;
    if (outageValue(states[name])) states[name] = withheld(states[name]);
  }
  return states;
}
