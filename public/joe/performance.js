// Desk performance stays in the contract's exact decimal units. The data and
// fleet contracts have no starting-capital field: retain the board's established
// aggregate practice capital, never infer individual bases from current equity.
import { decimalUnits, divRound } from './contracts/decimal.mjs';
import { NOT_EXACT_REASONS } from './board-state.js';

export const STARTING_MONEY = decimalUnits('15000');

export function exactMoney(value) {
  if (value?.currency !== 'EUR') return null;
  try { return decimalUnits(value.amount); } catch { return null; }
}

export function exactCell(cell) {
  if (!cell || cell.retained || !['fresh', 'stale'].includes(cell.state) || NOT_EXACT_REASONS.has(cell.reason)) return null;
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
