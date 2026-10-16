// The board light: today's health rules (localBoardHealth, its labels and
// reason copy) applied to the shared panel states. Freshness itself comes from
// contracts/panel-state.mjs; this module only ranks what the states say.
import { feedAge, panelState } from './contracts/panel-state.mjs';
import { isRTH } from './time.mjs';
import { age } from './format.js';

// The contract's freshness bound: two 30-second producer cadences.
export const STALE_AFTER_S = 60;
// Today's stricter stopped-feed presentation: three bounds without an update is red.
export const FEED_STOPPED_S = 3 * STALE_AFTER_S;
// Today's grace for carried equity: yellow for five minutes, never a red flash.
export const RETAINED_GRACE_S = 300;

export const REASON_COPY = Object.freeze({
  board_ok: 'numbers are up to date',
  snapshot_stale: 'updates are late — reload; if still late, tell Amy',
  retained_values: 'numbers a bit old — carrying the last good values',
  gateway_degraded: 'the broker connection is unstable — reload; if it persists, tell Amy',
  gateway_unconfirmed: 'the broker connection has not checked in — reload; if still old, tell Amy',
  open_unavailable_rth: 'waiting on broker prices — the desks’ money is still available',
  day_pending: 'today’s result is waiting on data — the desks’ money is still available',
  halt_on: 'paper trading is paused — the operator must check',
  gateway_down: 'the broker is offline — tell Amy to check the paper broker connection',
  feed_disconnected: 'board updates stopped — tell Amy to check the feed',
  equity_unavailable: 'board numbers are missing — the operator must check',
  producer_stuck: 'board updates are stuck — the operator must check',
  day_unavailable_rth: 'today’s result is waiting on data — the operator must check',
  refresh_failed: 'update failed — reload; if it repeats, tell Amy',
  no_snapshot: 'no board data — reload; if still empty, tell Amy',
});

// Closed wire reasons, as the short plain words a cell or diagnostic shows.
export const CELL_REASON = Object.freeze({
  gateway_down: 'broker connection down',
  upstream_lost: 'broker connection down',
  gateway_degraded: 'broker connection unstable',
  gateway_unconfirmed: 'broker connection not confirmed',
  retained_values: 'carrying the last good value',
  family_projection_unavailable: 'desk total incomplete',
  day_pnl_unavailable: 'today’s result not available',
  all_desk_equity_unavailable: 'desks’ money not available',
  open_pnl_unavailable: 'open result not available',
  baseline_pending: 'waiting on the start-of-day value',
  snapshot_stale: 'updates are late',
  producer_frozen: 'updates are stuck',
  schema_unsupported: 'last update had an unknown format',
  contract_invalid: 'last update was rejected',
  sequence_replayed: 'last update repeated an old one',
  clock_regressed: 'last update had a clock behind',
  clock_ahead: 'last update had a clock ahead',
  feed_not_received: 'no data received yet',
  market_closed: 'market closed',
  calendar_unavailable: 'market calendar not available',
  refresh_failed: 'update failed',
  auth_required: 'sign-in expired — reload',
  route_not_found: 'not found on the board server',
  source_not_authoritative: 'held back: the kept-holdings list disagrees',
  history_size_limit: 'history is full',
  history_compacted: 'history was compacted',
  ledger_size_limit: 'trade record is full',
  history_write_failed: 'history could not be saved',
  halt_on: 'emergency stop is on',
  executor_broker_disagreement: 'executor and broker disagree',
});
export const cellReason = reason => CELL_REASON[reason] ?? 'not available';
export const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const FALLBACK_COPY = 'the operator must check the details';
// Every sentence the Desk health line can start with; the browser gate puts
// each through the line to prove that none of them moves the page.
export const HEALTH_LINES = Object.freeze([...new Set(['numbers up to date', ...Object.values(REASON_COPY), FALLBACK_COPY].map(capital))]);

const DESKS = ['j', 'joe', 'joel'];
const TRANSPORT = ['refresh_failed', 'auth_required', 'route_not_found'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const EQUITY_CELLS = ['today.equity', ...DESKS.map(id => `desks.${id}.equity`)];
// Today's carried valuation: equity and total result retained from a last good value.
const CARRIED_CELLS = ['today.equity', 'today.totalPnl', ...DESKS.flatMap(id => [`desks.${id}.equity`, `desks.${id}.totalPnl`])];
const current = cell => cell?.value != null && !cell.retained;

// Broker connection: API session readiness and its check age, never a port.
export function brokerState(states, data) {
  const cell = states.gateway;
  const gateway = data?.safety.gateway;
  if (gateway?.apiSessionReady === false && ['gateway_down', 'upstream_lost'].includes(gateway.reason)) return { tone: 'bad', word: 'down' };
  if (gateway?.apiSessionReady === false && gateway.reason === 'gateway_degraded') return { tone: 'warn', word: 'degraded' };
  if (cell?.state === 'fresh' && gateway?.apiSessionReady === true) return { tone: 'ok', word: 'OK' };
  return { tone: 'warn', word: 'unsure' };
}

// The data feed's own freshness, from the shared selector: receipt age, or the
// generation-progress age when the producer froze. A rejection is ranked apart.
export function dataAge(feeds, now) {
  const value = feeds.data?.value;
  if (!value) return { receipt: null, frozen: null };
  const cell = panelState({ ...feeds.data, reason: null }, value.generatedAt, null, now);
  return { receipt: feedAge(feeds.data, now), frozen: cell.ageSeconds, state: cell.state, reason: cell.reason };
}

export function localBoardHealth(states, feeds, now) {
  const data = feeds.data?.value;
  if (!data) return { tone: 'red', reason: 'no_snapshot' };
  const broker = brokerState(states, data);
  const { receipt, frozen } = dataAge(feeds, now);
  // A failed read keeps the last good snapshot; a rejected push keeps it too.
  const transport = TRANSPORT.includes(feeds.data.reason);
  const rejected = Boolean(feeds.data.reason) && !transport;
  if (states.halt?.value === true) return { tone: 'red', reason: 'halt_on' };
  if (broker.word === 'down') return { tone: 'red', reason: 'gateway_down' };
  if (receipt !== null && receipt >= FEED_STOPPED_S) return { tone: 'red', reason: 'feed_disconnected' };
  if (frozen !== null && frozen >= FEED_STOPPED_S) return { tone: 'red', reason: 'producer_stuck' };
  const usable = EQUITY_CELLS.every(name => {
    const cell = states[name];
    if (cell?.value == null) return false;
    return !cell.retained || (cell.ageSeconds !== null && cell.ageSeconds <= RETAINED_GRACE_S);
  });
  if (!usable) return { tone: 'red', reason: 'equity_unavailable' };
  if (broker.word === 'degraded') return { tone: 'yellow', reason: 'gateway_degraded' };
  if (transport) return { tone: 'yellow', reason: 'refresh_failed' };
  if (rejected) return { tone: 'yellow', reason: 'retained_values' };
  if (receipt >= STALE_AFTER_S || frozen >= STALE_AFTER_S) return { tone: 'yellow', reason: 'snapshot_stale' };
  if (broker.word !== 'OK') return { tone: 'yellow', reason: 'gateway_unconfirmed' };
  if (CARRIED_CELLS.some(name => states[name]?.retained)) return { tone: 'yellow', reason: 'retained_values' };
  if (data.desks.some(desk => desk.state === 'stuck')) return { tone: 'yellow', reason: 'retained_values' };
  if (isRTH(now) && !current(states['today.dayPnl'])) return { tone: 'yellow', reason: 'day_pending' };
  if (isRTH(now) && !current(states['today.openPnl'])) return { tone: 'yellow', reason: 'open_unavailable_rth' };
  return { tone: 'green', reason: 'board_ok' };
}

export function boardHealthPresentation(states, feeds, now) {
  const health = localBoardHealth(states, feeds, now);
  const { frozen } = dataAge(feeds, now);
  const label = health.tone === 'green' ? 'Board OK'
    : health.tone === 'red' ? 'Needs fix'
      : health.reason === 'snapshot_stale' ? `Stale ${age(frozen)}`
        : health.reason === 'gateway_unconfirmed' ? 'Broker unsure'
          : 'Data delayed';
  return { ...health, label, explanation: REASON_COPY[health.reason] ?? FALLBACK_COPY,
    statusTone: health.tone === 'green' ? 'ok' : health.tone === 'red' ? 'bad' : 'warn' };
}

const PNL_COPY = { day: 'Today’s result', open: 'The open result' };
export function boardDiagnostics(states, feeds, now) {
  const data = feeds.data?.value;
  const problems = [];
  if (!data) {
    problems.push(feeds.data?.reason === 'auth_required' ? 'The sign-in has expired; reload the page to sign in again.'
      : feeds.data?.reason && feeds.data.reason !== 'feed_not_received' ? `No valid numbers yet: ${cellReason(feeds.data.reason)}.`
        : 'No numbers have reached the board yet.');
    return problems;
  }
  const gateway = data.safety.gateway;
  const broker = brokerState(states, data);
  const { receipt, frozen } = dataAge(feeds, now);
  if (states.halt?.value === true) problems.push(`The emergency stop is on${data.safety.haltReason ? `: ${cellReason(data.safety.haltReason)}` : ''}.`);
  if (broker.word === 'down' || broker.word === 'degraded') problems.push(`The broker connection is ${broker.word === 'down' ? 'down' : 'unstable'}: ${cellReason(gateway.reason)}.`);
  else if (broker.word === 'unsure') problems.push(states.gateway?.ageSeconds == null
    ? 'The broker connection’s check-in time is unknown; the current connection is unconfirmed.'
    : `The broker connection last checked in ${age(states.gateway.ageSeconds)} ago; the current connection is unconfirmed.`);
  if (feeds.data.reason === 'auth_required') problems.push('The sign-in has expired; reload the page to sign in again. The board shows the last good numbers.');
  else if (feeds.data.reason === 'refresh_failed' || feeds.data.reason === 'route_not_found') problems.push(`The board could not load new numbers (${cellReason(feeds.data.reason)}); it shows the last good numbers.`);
  else if (feeds.data.reason) problems.push(`The last update was not used (${cellReason(feeds.data.reason)}); the board shows the last good numbers.`);
  if (frozen > receipt && frozen >= STALE_AFTER_S) problems.push(`The numbers have not changed for ${age(frozen)}, although updates arrive.`);
  else if (receipt >= STALE_AFTER_S) problems.push(`The data is ${age(receipt)} old.`);
  if (states.paperAccount?.state === 'broken') problems.push(`The paper account total is unavailable (${cellReason(states.paperAccount.reason)})${states.paperAccount.value ? '; the value shown is the last good one' : ''}.`);
  for (const id of DESKS) {
    const cell = states[`desks.${id}.equity`];
    if (cell?.retained && cell.value) problems.push(`${LABEL[id]}’s money is carried from ${age(cell.ageSeconds)} ago (${cellReason(cell.reason)}).`);
    else if (cell?.value == null && cell?.reason) problems.push(`${LABEL[id]}’s money is unavailable: ${cellReason(cell.reason)}.`);
  }
  for (const desk of data.desks) if (desk.state === 'stuck') problems.push(`${desk.label} is stuck: ${desk.action}`);
  if (isRTH(now)) for (const [kind, field] of [['day', 'dayPnl'], ['open', 'openPnl']]) {
    const cell = states[`today.${field}`];
    if (!current(cell)) problems.push(`${PNL_COPY[kind]} is unavailable during New York regular hours: ${cellReason(cell?.reason ?? data.pnlSources?.[kind]?.reason ?? 'feed_not_received')}.`);
  }
  return problems;
}
