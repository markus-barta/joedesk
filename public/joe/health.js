// The board light: today's health rules (localBoardHealth, its labels and
// reason copy) applied to the shared panel states. Freshness itself comes from
// contracts/panel-state.mjs; this module only ranks what the states say.
import { feedAge, panelState } from './contracts/panel-state.mjs';
import { gatewayCheckAgeMs } from './contracts/gateway.mjs';
import { isRTH } from './time.mjs';
import { age } from './format.js';
import { NOT_EXACT_REASONS, stoppedData, classifyDays, classifyCells } from './board-state.js';

// The contract's freshness bound: two 30-second producer cadences.
export const STALE_AFTER_S = 60;
// Today's stricter stopped-feed presentation: three bounds without an update is red.
export const FEED_STOPPED_S = 3 * STALE_AFTER_S;
// Today's grace for carried equity: yellow for five minutes, never a red flash.
export const RETAINED_GRACE_S = 300;
// Deliberately uncaptured desk values are neutral; 'yellow' opts into a warning.
export const NOT_EXACT_TONE = 'green';

export const REASON_COPY = Object.freeze({
  'signed-out': 'signed out — reload to sign in',
  board_ok: 'numbers are up to date',
  values_not_exact: 'desk values are not exact',
  snapshot_stale: 'updates are late — reload; if still late, tell Amy',
  retained_values: 'numbers a bit old — carrying the last good values',
  gateway_degraded: 'the broker connection is unstable — reload; if it persists, tell Amy',
  gateway_unconfirmed: 'the broker connection has not checked in — reload; if still old, tell Amy',
  open_unavailable_rth: 'waiting on broker prices — the desks’ money is still available',
  open_fault_rth: 'open result is unavailable — reload; if it stays, tell Amy',
  day_pending: 'today’s result is late — reload; if it stays, tell Amy',
  halt_on: 'paper trading is paused — the operator must check',
  gateway_down: 'the broker is offline — tell Amy to check the paper broker connection',
  feed_disconnected: 'board updates stopped — tell Amy to check the feed',
  equity_unavailable: 'board numbers are missing — the operator must check',
  producer_stuck: 'board updates are stuck — the operator must check',
  day_unavailable_rth: 'today’s result is waiting on data — the operator must check',
  refresh_failed: 'update failed — reload; if it repeats, tell Amy',
  no_snapshot: 'no board data — reload; if still empty, tell Amy',
  ledger_size_limit: 'trade record is full — new orders refused',
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
  ledger_size_limit: 'trade record is full — new orders refused',
  history_write_failed: 'history could not be saved',
  halt_on: 'emergency stop is on',
  executor_broker_disagreement: 'executor and broker disagree',
  results_capture_failed: 'results capture failing',
  // The board cannot say when a value becomes exact, so its words promise no time.
  not_exact_yet: 'not exact',
  source_unavailable: 'not reported by the broker',
  desk_unmapped: 'not matched to a desk',
  sod_missing: 'start-of-day value missing',
  ledger_unreconciled: 'desk ledger not reconciled',
  position_stale: 'position update is old',
});
export const cellReason = reason => CELL_REASON[reason] ?? 'not available';
export const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const FALLBACK_COPY = 'the operator must check the details';
const DESKS = ['j', 'joe', 'joel'];
const TRANSPORT = ['refresh_failed', 'auth_required', 'route_not_found'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const EQUITY_CELLS = ['today.equity', ...DESKS.map(id => `desks.${id}.equity`)];
const notExact = cell => cell?.value == null && NOT_EXACT_REASONS.has(cell?.reason);
export const deskValuesNotExact = states => EQUITY_CELLS.some(name => notExact(states[name]));
// Today's carried valuation: equity and total result retained from a last good value.
const CARRIED_CELLS = ['today.equity', 'today.totalPnl', ...DESKS.flatMap(id => [`desks.${id}.equity`, `desks.${id}.totalPnl`])];
// Amy's A3 (2026-10-29) with the JOED-148 gates: in regular hours Today holds
// only when the household Today and every desk's Today are each exact or
// withheld as not exact (classifyDays, every channel). A fault anywhere is a
// real gap, also beside a current household Today; Details says why.
const todayHolds = (states, data) => Object.values(classifyDays(states, data)).every(day => day.kind !== 'fault');
// Board totals may be hidden while their observations remain usable for health.
const observation = cell => cell?.health ?? { available: cell?.value != null, retained: cell?.retained, ageSeconds: cell?.ageSeconds };

// Broker connection: API session readiness and its check age, never a port.
export function brokerState(states, data) {
  if (states.session === 'signed-out' || states.gateway?.signedOut || states.gateway?.reason === 'auth_required') return { tone: 'none', word: 'unknown while signed out' };
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

export function executorPresentation(executor, globalHalt = false) {
  const status = { running: 'Running', degraded: 'Degraded', down: 'Down' }[executor.status] ?? 'Not reported';
  const tone = executor.reason === 'ledger_size_limit' || executor.status === 'down' || executor.halt ? 'bad'
    : executor.status === 'degraded' || executor.brakes || !executor.gatewayReachable ? 'warn' : 'ok';
  const continues = ['running', 'degraded'].includes(executor.status) && !globalHalt &&
    !executor.halt && !executor.brakes && executor.gatewayReachable !== false;
  const reason = executor.reason ? cellReason(executor.reason) : null;
  return { status, tone, reason: reason && executor.reason === 'results_capture_failed' && continues
    ? `${reason} — trading continues` : reason };
}

export function localBoardHealth(states, feeds, now) {
  if (isSignedOut(states, feeds)) return { tone: 'yellow', reason: 'signed-out' };
  const data = feeds.data?.value;
  if (!data) return { tone: 'red', reason: 'no_snapshot' };
  const broker = brokerState(states, data);
  const { receipt, frozen } = dataAge(feeds, now);
  // A failed read keeps the last good snapshot; a rejected push keeps it too.
  const transport = TRANSPORT.includes(feeds.data.reason);
  const rejected = Boolean(feeds.data.reason) && !transport;
  if (states.halt?.value === true) return { tone: 'red', reason: 'halt_on' };
  if (data.safety.executor?.reason === 'ledger_size_limit') return { tone: 'red', reason: 'ledger_size_limit' };
  if (broker.word === 'down') return { tone: 'red', reason: 'gateway_down' };
  if (receipt !== null && receipt >= FEED_STOPPED_S) return { tone: 'red', reason: 'feed_disconnected' };
  if (frozen !== null && frozen >= FEED_STOPPED_S) return { tone: 'red', reason: 'producer_stuck' };
  // Without a canonical real check, the panel age may only be receipt age.
  // Otherwise retain the selector's elapsed/progress age for the actual check.
  const gatewayAge = gatewayCheckAgeMs(data.safety.gateway, data.generatedAt) === null ? null : states.gateway?.ageSeconds;
  const briefBrokerGap = broker.word === 'unsure' && Number.isFinite(gatewayAge) && gatewayAge >= 0 && gatewayAge < FEED_STOPPED_S;
  const excused = cell => briefBrokerGap && !observation(cell).available && cell?.reason === 'gateway_unconfirmed';
  const usable = EQUITY_CELLS.every(name => {
    const cell = states[name];
    if (notExact(cell)) return true;
    const seen = observation(cell);
    if (!seen.available) return excused(cell);
    return !seen.retained || (Number.isFinite(seen.ageSeconds) && seen.ageSeconds >= 0 && seen.ageSeconds <= RETAINED_GRACE_S);
  });
  if (!usable) return { tone: 'red', reason: 'equity_unavailable' };
  if (EQUITY_CELLS.some(name => excused(states[name]))) return { tone: 'yellow', reason: 'gateway_unconfirmed' };
  if (broker.word === 'degraded') return { tone: 'yellow', reason: 'gateway_degraded' };
  if (transport) return { tone: 'yellow', reason: 'refresh_failed' };
  if (rejected) return { tone: 'yellow', reason: 'retained_values' };
  if (receipt >= STALE_AFTER_S || frozen >= STALE_AFTER_S) return { tone: 'yellow', reason: 'snapshot_stale' };
  if (broker.word !== 'OK') return { tone: 'yellow', reason: 'gateway_unconfirmed' };
  // Scoped stalls have no independent age; a fresh envelope cannot date them.
  if (CARRIED_CELLS.some(name => observation(states[name]).retained || stoppedData(states[name]))) return { tone: 'yellow', reason: 'retained_values' };
  if (data.desks.some(desk => desk.state === 'stuck')) return { tone: 'yellow', reason: 'retained_values' };
  if (isRTH(now) && !todayHolds(states, data)) return { tone: 'yellow', reason: 'day_pending' };
  if (isRTH(now)) {
    const opens = Object.values(classifyCells(states, data, 'openPnl'));
    if (opens.some(open => open.kind === 'fault')) return { tone: 'yellow', reason: 'open_fault_rth' };
    if (opens.some(open => open.kind !== 'exact')) return { tone: 'yellow', reason: 'open_unavailable_rth' };
  }
  if (NOT_EXACT_TONE === 'yellow' && deskValuesNotExact(states)) return { tone: 'yellow', reason: 'values_not_exact' };
  return { tone: 'green', reason: 'board_ok' };
}

export function boardHealthPresentation(states, feeds, now) {
  const health = localBoardHealth(states, feeds, now);
  const { frozen } = dataAge(feeds, now);
  const label = health.reason === 'signed-out' ? 'Signed out' : health.tone === 'green' ? 'Board OK'
    : health.tone === 'red' ? 'Needs fix'
      : health.reason === 'snapshot_stale' ? `Stale ${age(frozen)}`
        : health.reason === 'gateway_unconfirmed' ? 'Broker unsure'
          : 'Data delayed';
  return { ...health, label, explanation: REASON_COPY[health.reason] ?? FALLBACK_COPY,
    statusTone: health.tone === 'green' ? 'ok' : health.tone === 'red' ? 'bad' : 'warn' };
}

// Presentation only: the selector above still owns every threshold and rank.
// Keep the action from the existing reason copy in Details and the red line.
export function statusSentence(health, { receipt = null, gatewayAge = null } = {}) {
  if (health.reason === 'signed-out') return 'Signed out — reload to sign in';
  if (health.tone === 'green') return `Live · updated ${age(receipt)} ago`;
  if (health.reason === 'halt_on') return 'Emergency stop is ON';
  if (health.reason === 'gateway_unconfirmed') return Number.isFinite(gatewayAge)
    ? `Broker unsure: last check ${age(gatewayAge)} ago` : 'Broker unsure: no check reported';
  return capital((REASON_COPY[health.reason] ?? FALLBACK_COPY).split(' — ')[0]);
}

export function statusPresentation(ctx, health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now)) {
  const receipt = dataAge(ctx.feeds, ctx.now).receipt;
  const data = ctx.feeds.data?.value;
  const gatewayAge = data && gatewayCheckAgeMs(data.safety.gateway, data.generatedAt) !== null
    ? ctx.states.gateway?.ageSeconds : null;
  const sentence = statusSentence(health, { receipt, gatewayAge });
  const explanation = REASON_COPY[health.reason] ?? FALLBACK_COPY;
  const action = health.reason !== 'signed-out' && explanation.includes(' — ') ? capital(explanation.split(' — ')[1]) : '';
  const short = {
    'signed-out': 'Signed out',
    values_not_exact: 'Not exact', snapshot_stale: 'Updates late', retained_values: 'Older numbers',
    gateway_degraded: 'Broker unstable', gateway_unconfirmed: 'Broker unsure', open_unavailable_rth: 'Prices pending',
    open_fault_rth: 'Open unavailable',
    day_pending: 'Result late', refresh_failed: 'Data delayed',
  };
  const control = health.tone === 'red' ? health.reason === 'halt_on' ? 'Emergency stop' : 'Problem' : sentence;
  return { ...health, sentence, control,
    compact: health.tone === 'green' ? `Live · ${age(receipt)}` : health.tone === 'red' ? control : short[health.reason] ?? 'Check details',
    alert: `${sentence}${action ? ` · ${action}` : ''}`,
    // Receipt/check ages tick; announcements change only with the ranked state.
    announcementKey: `${health.tone}:${health.reason}`,
    announcement: health.tone === 'green' ? 'Live. Numbers are up to date.' : `${sentence}${action ? `. ${action}` : ''}` };
}

const PNL_COPY = { day: 'Today’s result', open: 'The open result' };
export const isSignedOut = (states, feeds) => states.session === 'signed-out' || Object.values(feeds).some(feed => feed?.reason === 'auth_required');
// A stuck desk is one whose positions, orders or executions the pusher cannot
// currently confirm; its own status text names no cause, so the board says this.
export const STUCK_REASON = 'its trading activity can’t be confirmed';
export function boardDiagnostics(states, feeds, now) {
  if (isSignedOut(states, feeds)) return ['The sign-in has expired; reload to sign in. Values shown are last known. Broker connection and panel ages are unknown while signed out.'];
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
    else if (cell?.value == null && cell?.reason && !notExact(cell)) problems.push(`${LABEL[id]}’s money is unavailable: ${cellReason(cell.reason)}.`);
  }
  for (const desk of data.desks) if (desk.state === 'stuck') problems.push(`${desk.label} is stuck: ${STUCK_REASON}.`);
  if (isRTH(now)) {
    // The same classifier as the light: each Today fault, household or desk, once.
    const days = classifyDays(states, data);
    if (days.today.kind === 'fault') problems.push(`${PNL_COPY.day} is unavailable during New York regular hours: ${cellReason(days.today.reason ?? data.pnlSources?.day?.reason ?? 'feed_not_received')}.`);
    for (const id of DESKS) if (days[id].kind === 'fault') {
      const lastGood = states[`desks.${id}.dayPnl`]?.retained, reason = days[id].reason;
      const why = reason && !(lastGood && reason === 'retained_values') ? `: ${cellReason(reason)}` : '';
      problems.push(`${LABEL[id]}’s Today is ${lastGood ? 'only a last good value' : 'unavailable'}${why}.`);
    }
    const opens = classifyCells(states, data, 'openPnl');
    if (opens.today.kind !== 'exact') problems.push(`${PNL_COPY.open} is unavailable during New York regular hours: ${cellReason(opens.today.reason ?? 'feed_not_received')}.`);
    for (const id of DESKS) if (opens[id].kind === 'fault') {
      const lastGood = states[`desks.${id}.openPnl`]?.retained, reason = opens[id].reason;
      const why = reason && !(lastGood && reason === 'retained_values') ? `: ${cellReason(reason)}` : '';
      problems.push(`${LABEL[id]}’s Open result is ${lastGood ? 'only a last good value' : 'unavailable'}${why}.`);
    }
  }
  return problems;
}
