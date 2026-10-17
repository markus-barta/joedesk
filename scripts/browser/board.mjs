// Test-only: the real P2 board server in a private temporary store with an
// injected clock, fed through its inbox. The synthetic scenario lives here,
// never under public/; P1 fixtures drive the panel states.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratch, discard } from './scratch.mjs';
import { createJoeServer } from '../../server.mjs';
import { panelStates } from '../../contracts/panel-state.mjs';
import { validateContract } from '../../contracts/index.mjs';
import { acceptSnapshot } from '../../contracts/accept.mjs';
import { historyEnvelope, historyPoint, measureHistory, HISTORY_CAP } from '../../server/history.mjs';
import { atomicWrite } from '../../server/storage.mjs';
import { nyDay, isRTH } from '../../time.mjs';

const root = new URL('../../', import.meta.url);
export const read = file => JSON.parse(readFileSync(new URL(file, root)));
export const valid = read('fixtures/valid.json');
export const fixture = id => read(`fixtures/failures/${id}.json`);
export const TOKEN = 'joedesk-p3-browser-fixture';
export const ACTOR = 'p3-browser';
export const NOW = '2026-10-14T17:42:22.000Z';
export const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();
export const ingress = value => { const copy = structuredClone(value); delete copy.receivedAt; return copy; };

export async function startBoard({ fleetConfig = null, history = null, fleetConfigRaw = null, fleetActions = null } = {}) {
  const dataDir = scratch('joed-p3-board-');
  if (fleetConfig) writeFileSync(join(dataDir, 'fleet-config.json'), JSON.stringify(fleetConfig));
  // P5: a stored file the server cannot read, and a seeded change log.
  if (fleetConfigRaw !== null) writeFileSync(join(dataDir, 'fleet-config.json'), fleetConfigRaw);
  if (fleetActions) writeFileSync(join(dataDir, 'fleet-config-actions.json'), JSON.stringify({ schema: 'inspr.joe.fleet-config.actions.v1', entries: fleetActions }));
  if (history) atomicWrite(join(dataDir, 'history-state.json'), historyEnvelope(history), HISTORY_CAP);
  let base = Date.parse(NOW), real = performance.now(), frozen = false;
  const clock = () => new Date(Math.round(base + (frozen ? 0 : performance.now() - real))).toISOString();
  const server = createJoeServer({ dataDir, clock, inboxToken: TOKEN });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const push = async (payload, kind = 'data') => {
    const response = await fetch(`http://127.0.0.1:${port}/joe/inbox${kind === 'results' ? '/results' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  return {
    port, url: `http://127.0.0.1:${port}/joe/`, push, pushResults: payload => push(payload, 'results'), clock, dataDir,
    setNow(iso, { freeze = true } = {}) { base = Date.parse(iso); real = performance.now(); frozen = freeze; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await discard(dataDir, 'board store');
    },
  };
}

// Deterministic synthetic household: three desks, two desk positions, the two
// kept holdings, a week of 4-minute history with one outage, and J's captured
// partial record. Values are cents, so family sums are exact decimals.
const money = cents => ({ amount: (cents / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'), currency: 'EUR' });
const usd = value => ({ amount: String(value), currency: 'USD' });
function random(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function scenario(now = NOW, { historyFrom = '2026-10-07T00:00:00.000Z', stepMinutes = 4, outage = ['2026-10-08T15:30:00.000Z', '2026-10-08T18:00:00.000Z'], compact = false } = {}) {
  const R = random(20261014), desks = ['j', 'joe', 'joel'];
  const drift = { j: 0.02, joe: -0.03, joel: 0.05 };
  const start = Date.parse(historyFrom), end = Date.parse(now) - 30000;
  const raw = [];
  const level = { j: 499000, joe: 500400, joel: 499500 };
  for (let t = start; t <= end; t += stepMinutes * 60000) {
    const iso = new Date(t).toISOString();
    if (t >= Date.parse(outage[0]) && t < Date.parse(outage[1])) continue;
    if (isRTH(iso)) for (const id of desks) level[id] += Math.round((R() - 0.5 + drift[id]) * 120);
    raw.push({ t: iso, cents: { ...level } });
  }
  const target = { j: 498742, joe: 498346, joel: 502630 };
  const shift = Object.fromEntries(desks.map(id => [id, target[id] - raw[raw.length - 1].cents[id]]));
  for (const r of raw) for (const id of desks) r.cents[id] += shift[id];
  const midnight = new Map();
  const deskMeta = compact ? { j: { historyBasis: 'j.paper.v2' }, joe: { historyBasis: 'joe.paper.v2' }, joel: { historyBasis: 'joel.paper.v2' } } : {
    j: { accounting: { periodStart: '2026-09-10T04:00:00.000Z', method: 'execution-fifo-net-current-fx', detail: 'J and its sub-desks J2 to J5 are counted together; earlier results are not available.' }, historyBasis: 'j.paper.v2' },
    joe: { historyBasis: 'joe.paper.v2' }, joel: { historyBasis: 'joel.paper.v2' },
  };
  const open = { j: 77, joe: 0, joel: 147 };
  const points = raw.map((r, i) => {
    const day = nyDay(r.t);
    if (!midnight.has(day)) midnight.set(day, { ...(raw[i - 1]?.cents ?? r.cents) });
    const m = midnight.get(day), last = i === raw.length - 1;
    const desksOut = {}, totals = { equity: 0, dayPnl: 0, openPnl: 0, totalPnl: 0 };
    for (const id of desks) {
      const f = { equity: r.cents[id], dayPnl: r.cents[id] - m[id], openPnl: last ? open[id] : 0, totalPnl: r.cents[id] - 500000 };
      for (const k of Object.keys(totals)) totals[k] += f[k];
      desksOut[id] = { money: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, money(v)])), ...deskMeta[id] };
    }
    return { t: r.t, desks: desksOut, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money(v)])) };
  });
  const last = points[points.length - 1];
  const checked = at(now, -9);
  const snapshot = {
    schema: 'inspr.joe.household.v2', seq: 1001, generatedAt: now, mode: 'PAPER', currency: 'EUR',
    source: { kind: 'live-ib-api', label: 'The desks’ paper book' },
    safety: { halt: false, haltReason: null, gateway: { apiSessionReady: true, checkedAt: checked },
      executor: { status: 'running', halt: false, brakes: false, gatewayReachable: true, checkedAt: checked } },
    desks: [
      { id: 'j', label: 'J', state: 'working', stateSince: '2026-10-14T13:31:00.000Z', heartbeatAt: checked,
        action: 'Holding 5 Bank of America (BAC) since 16:05; the exit rule closes it before 21:55.',
        learning: { status: 'iterating', headline: 'Testing a smaller first position against yesterday’s rule', detail: 'A half-size entry is compared with the full-size one', iteration: 18 },
        money: last.desks.j.money, ...deskMeta.j, moneyEvidence: { status: 'observed', observedAt: checked },
        backfill: { status: 'BEST_AVAILABLE', fullTotalAvailable: false,
          capturedSubtotal: { realizedPnl: usd('-37.13'), method: 'captured-fifo-matched-roundtrips', fromInclusive: '2026-09-10T08:00:00.000Z', throughInclusive: '2026-09-10T08:05:00.000Z',
            points: [[0, '0'], [40, '-4.5'], [95, '-9.2'], [150, '-16.4'], [200, '-21'], [245, '-28.75'], [300, '-37.13']].map(([s, v]) => ({ at: at('2026-09-10T08:00:00.000Z', s), realizedPnl: usd(v) })),
            pointsTruncated: false, executionCount: 43, commissionCount: 42 },
          coverage: { fromInclusive: '2026-09-10T08:00:00.000Z', toExclusive: '2026-09-10T08:20:00.000Z', gapCount: 1 }, missingOpeningLotCount: 1, orphanCommissionCount: 1 } },
      { id: 'joe', label: 'Joe', state: 'sit-out', stateSince: '2026-10-14T14:02:00.000Z', heartbeatAt: checked,
        action: 'The setup is not clean enough, so Joe is sitting out.',
        learning: { status: 'learning', headline: 'Writing down why the trade was skipped', detail: 'The next review checks if the warning repeats', iteration: 7 },
        money: last.desks.joe.money, ...deskMeta.joe, moneyEvidence: { status: 'observed', observedAt: checked } },
      { id: 'joel', label: 'Joel', state: 'working', stateSince: '2026-10-09T19:45:00.000Z', heartbeatAt: at(now, -11),
        action: 'Holding 3 Coca-Cola (KO) since Fri 9 Oct; no change is planned.',
        learning: { status: 'steady', headline: 'Rule unchanged: Joel is practising patience, not hunting for a new entry', detail: 'Rule unchanged: Joel is practising patience, not hunting for a new entry', iteration: 31 },
        money: last.desks.joel.money, ...deskMeta.joel, moneyEvidence: { status: 'observed', observedAt: checked } },
    ],
    totals: last.totals,
    pnlSources: {
      day: { status: 'available', method: 'sod-virtual-equity', currency: 'EUR', scope: 'virtual-desks', observedAt: checked, periodStart: '2026-10-14T04:00:00.000Z' },
      open: { status: 'available', method: 'owned-lots-current-mark-fx', currency: 'EUR', scope: 'virtual-desks', observedAt: checked },
    },
    brokerAccount: { equity: { amount: '31482.75', currency: 'EUR' }, scope: 'paper-account-including-keep', observedAt: checked },
    positions: { source: 'live-ib-api', observedAt: checked, rows: [
      { desk: 'j', symbol: 'BAC', company: 'Bank of America', side: 'long', quantity: '5', mark: usd('46.82'), marketValue: usd('234.1'), dayPnl: usd('0.85'), openPnl: usd('0.85'), openedAt: '2026-10-14T14:05:00.000Z', updatedAt: checked, scope: 'stage0' },
      { desk: 'joel', symbol: 'KO', company: 'Coca-Cola', side: 'long', quantity: '3', mark: usd('70.12'), marketValue: usd('210.36'), dayPnl: usd('0.42'), openPnl: usd('1.62'), openedAt: '2026-10-09T19:45:00.000Z', updatedAt: checked, scope: 'stage0' },
      { desk: null, symbol: 'SXR8', company: 'iShares Core S&P 500 ETF', side: 'long', quantity: '20', mark: { amount: '612.4', currency: 'EUR' }, marketValue: { amount: '12248', currency: 'EUR' }, updatedAt: checked, scope: 'keep' },
      { desk: null, symbol: 'TSLA', company: 'Tesla', side: 'long', quantity: '1', mark: usd('441.2'), marketValue: usd('441.2'), updatedAt: checked, scope: 'keep' },
    ] },
  };
  const history = { schema: 'inspr.joe.household.history.v2', seq: points.length, generatedAt: last.t, receivedAt: last.t, points, sizeBytes: 0 };
  measureHistory(history);
  const checks = [validateContract('data', snapshot, { stage: 'ingress' }), validateContract('history', history)];
  for (const check of checks) if (!check.ok) throw new Error(`scenario invalid: ${JSON.stringify(check.errors.slice(0, 5))}`);
  return { snapshot, history };
}

// The largest history the 8 MiB contract allows for this point shape (about
// 908 bytes each): 9,000 one-minute points for the render budget trace. With
// live pushes the server compacts at its 6.4 MiB warning, so the live trace
// uses the largest history that stays below it (7,200 points).
export function largeScenario(now = NOW, points = 9000) {
  return scenario(now, { historyFrom: at(now, -(points - 1) * 60 - 60), stepMinutes: 1, outage: ['2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'], compact: true });
}
// The next snapshot from the same producer: a new sequence and generation
// time, every check and observation just before it, money moved by cents.
export function advance(snapshot, when, seq, { cents = [37, -12, 5] } = {}) {
  const next = structuredClone(snapshot);
  const before = at(when, -3);
  next.seq = seq; next.generatedAt = when;
  next.safety.gateway.checkedAt = before; next.safety.executor.checkedAt = before;
  for (const d of next.desks) { d.heartbeatAt = before; d.moneyEvidence.observedAt = before; }
  for (const s of Object.values(next.pnlSources)) s.observedAt = before;
  next.brokerAccount.observedAt = before; next.positions.observedAt = before;
  const bump = (m, c) => (m ? { ...m, amount: (Math.round(Number(m.amount) * 100 + c) / 100).toFixed(2) } : m);
  let total = 0;
  next.desks.forEach((d, i) => { const c = cents[i] ?? 0; total += c; for (const f of ['equity', 'dayPnl', 'totalPnl']) d.money[f] = bump(d.money[f], c); });
  for (const f of ['equity', 'dayPnl', 'totalPnl']) next.totals[f] = bump(next.totals[f], total);
  return next;
}

// The contract's largest position list: 256 rows (254 desk positions and the
// two kept holdings), for the render budget with live pushes.
export function wideSnapshot(snapshot, when, seq, shift = 0) {
  const next = advance(snapshot, when, seq);
  const kept = next.positions.rows.filter(r => r.scope === 'keep');
  const rows = Array.from({ length: 254 }, (_, i) => {
    const desk = ['j', 'joe', 'joel'][i % 3];
    const mark = (20 + ((i * 7.31 + shift) % 480)).toFixed(2), qty = String(1 + (i % 9));
    const value = (Number(mark) * Number(qty)).toFixed(2), open = (((i * 13 + shift) % 41) - 20) / 10;
    return { desk, symbol: `P${String(i).padStart(3, '0')}`, company: `Practice holding ${i + 1}`, side: i % 7 === 3 ? 'short' : 'long', quantity: qty,
      mark: usd(mark), marketValue: usd(value), dayPnl: usd(open.toFixed(2)), openPnl: usd(open.toFixed(2)), openedAt: '2026-10-14T14:05:00.000Z', updatedAt: at(when, -3), scope: 'stage0' };
  });
  next.positions.rows = [...rows, ...kept.map(r => ({ ...r, updatedAt: at(when, -3) }))];
  const checked = validateContract('data', next, { stage: 'ingress' });
  if (!checked.ok) throw new Error(`wide snapshot invalid: ${JSON.stringify(checked.errors.slice(0, 5))}`);
  return next;
}

// ADR deferred P3 rows: one missing desk beside two observed siblings, and
// equity with total result both unavailable when they depend on missing marks.
export function singleMissingDesk() {
  const payload = ingress(valid.data);
  payload.seq = 102; payload.generatedAt = at(valid.data.receivedAt, 30); payload.safety.gateway.checkedAt = payload.generatedAt;
  for (const source of Object.values(payload.pnlSources)) source.observedAt = payload.generatedAt;
  payload.desks[0].money.equity = null; payload.desks[0].money.reasons = { equity: 'retained_values' };
  payload.totals.equity = null; payload.totals.reasons = { equity: 'family_projection_unavailable' };
  return { feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, 9) };
}
export function coupledUnavailable() {
  const payload = ingress(valid.data);
  payload.seq = 102; payload.generatedAt = at(valid.data.receivedAt, 30); payload.safety.gateway.checkedAt = payload.generatedAt;
  for (const source of Object.values(payload.pnlSources)) source.observedAt = payload.generatedAt;
  for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) {
    bag.equity = null; bag.totalPnl = null; bag.reasons = { equity: 'all_desk_equity_unavailable', totalPnl: 'all_desk_equity_unavailable' };
  }
  return { feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, 9) };
}

export { panelStates, acceptSnapshot, historyPoint, measureHistory };
