// Desk performance stays in the contract's exact decimal units. The data and
// fleet contracts have no starting-capital field: retain the board's established
// aggregate practice capital, never infer individual bases from current equity.
import { decimalUnits, divRound } from './contracts/decimal.mjs';
import { NOT_EXACT_REASONS, outageValue } from './board-state.js';
import { nyDay } from './time.mjs';

export const STARTING_MONEY = decimalUnits('15000');
// Since start counts from the paper desks' verified ledger start, one New York
// trading day for all three desks: the board pusher's PERIOD_START
// 2026-09-10T04:00:00Z (desk-ledger.mjs; J's FIXED_PERIOD_START in
// family-ledger.mjs is the same instant). Amy confirmed it on 2026-10-29 (A4).
export const SINCE_START = '2026-09-10';
const DESK_IDS = ['j', 'joe', 'joel'];

// The New York day each desk's Since start counts from, or null when unknown:
// the desk's own accounting.periodStart when the feed sends one, else
// SINCE_START, unless the closed-trade record (Results' trackingStart) starts
// on another day; then the board cannot tell which is right and shows no date.
// `common` is the day all three share, if they do.
export function sinceStarts(feeds) {
  const desks = feeds?.data?.value?.desks ?? [];
  const trackingStart = feeds?.results?.value?.trackingStart ?? null;
  const conflict = Boolean(trackingStart) && trackingStart !== SINCE_START;
  const days = Object.fromEntries(DESK_IDS.map(id => {
    const own = desks.find(desk => desk.id === id)?.accounting?.periodStart;
    return [id, own ? nyDay(own) : conflict ? null : SINCE_START];
  }));
  const common = days.j && DESK_IDS.every(id => days[id] === days.j) ? days.j : null;
  return { days, common, trackingStart, conflict };
}

export function exactMoney(value) {
  if (value?.currency !== 'EUR') return null;
  try { return decimalUnits(value.amount); } catch { return null; }
}

export function exactCell(cell) {
  if (!cell || outageValue(cell) || !['fresh', 'stale'].includes(cell.state) || NOT_EXACT_REASONS.has(cell.reason)) return null;
  return exactMoney(cell.value);
}

// Integer hundredths of one percent, rounded once, half away from zero.
export function percentOf(result, base) {
  return typeof result === 'bigint' && typeof base === 'bigint' && base > 0n
    ? divRound(result * 10000n, base) : null;
}

export function todayPercent(states, source) {
  if (source?.method === 'session-open-estimate') return null;
  const day = states['today.dayPnl'], equity = states['today.equity'];
  const result = exactCell(day), moneyNow = exactCell(equity);
  // Never combine observations from different snapshots into a new baseline.
  if (result === null || moneyNow === null || day.valueReceivedAt !== equity.valueReceivedAt) return null;
  return percentOf(result, moneyNow - result);
}

export const sincePercent = states => percentOf(exactCell(states['today.totalPnl']), STARTING_MONEY);

export function rankDesks(states, order) {
  return order.map((id, index) => ({ id, index, result: exactCell(states[`desks.${id}.totalPnl`]) }))
    .sort((a, b) => a.result === b.result ? a.index - b.index
      : a.result === null ? 1 : b.result === null ? -1 : a.result > b.result ? -1 : 1)
    .map(d => d.id);
}
