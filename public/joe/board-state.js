// Board display policy layered over the unchanged producer contract selector.
import { panelStates, MONEY_FIELDS } from './contracts/panel-state.mjs';
import { nyDay } from './time.mjs';
import { validInstant } from './contracts/schema-validator.mjs';

export const RETENTION_SECONDS = 60 * 60;
export const NOT_EXACT_REASONS = new Set(['not_exact_yet', 'sod_missing', 'ledger_unreconciled', 'position_stale', 'baseline_pending', 'day_pnl_unavailable']);
const DESKS = ['j', 'joe', 'joel'];
const positionKey = row => JSON.stringify([row.scope, row.desk, row.symbol]);
const unavailable = (cell, reason = cell.reason) => ({ ...cell, state: cell.state === 'fresh' ? 'broken' : cell.state, value: null, retained: false, reason });
// Hiding a derived amount does not erase the observation's health/grace.
// Keep only value-free evidence; calculations and rendering still see null.
const withheld = (cell, reason = cell.reason) => ({ ...unavailable(cell, reason),
  health: { available: cell.value != null, retained: cell.retained, ageSeconds: cell.ageSeconds } });

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
    const cell = states[name], field = name.split('.').at(-1);
    const sourceReasons = name === 'paperAccount' ? [data?.brokerAccount?.reason]
      : name === 'paperCash' ? [data?.brokerAccount?.reasons?.cash]
        : ['positions', 'kept'].includes(name) ? [data?.positions?.reason] : fieldReason(name, field);
    // Scoped exactness failures still apply when a feed/gateway failure masks
    // their reason in the shared selector. An outage cannot restore an amount.
    const inexact = [cell.reason, ...sourceReasons]
      .some(reason => NOT_EXACT_REASONS.has(reason));
    const expired = cell.retained && (cell.ageSeconds == null || cell.ageSeconds >= RETENTION_SECONDS);
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
    if (inexact || expired || differentDay) states[name] = unavailable(cell, cell.reason ?? (differentDay ? 'baseline_pending' : null));
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
  // result or combine exact siblings with a retained/missing input.
  for (const field of MONEY_FIELDS) {
    const name = `today.${field}`, cell = states[name];
    const blocked = DESKS.map(id => states[`desks.${id}.${field}`]).find(c => c.retained || c.value == null);
    if (cell.retained || (cell.value != null && blocked)) states[name] = withheld(cell, cell.reason ?? blocked?.reason);
  }
  for (const id of DESKS) {
    const name = `desks.${id}.totalPnl`;
    if (states[name].retained) states[name] = withheld(states[name]);
  }
  return states;
}
