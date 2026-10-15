// Results under Node (AC-12): the §4.2 definitions exactly, from the results
// v2 fixtures; Vienna dates for every trade; exact decimals; the calendar's
// tint scale; a day's trades; the hero chart's points. The browser serves
// public/joe/time.mjs and public/joe/contracts/* from the repo root; this hook
// mirrors that mapping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';

const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}

const M = await import('../public/joe/results-model.js');
const { decimalUnits, divRound, roundUnits, mulUnits, divUnits, unitsDecimal, unitsNumber } = await import('../contracts/decimal.mjs');
const { validateContract } = await import('../contracts/index.mjs');
const { acceptRead } = await import('../contracts/read.mjs');
const { panelStates } = await import('../contracts/panel-state.mjs');
const hm = await import('../public/joe/history-model.js');
const { designResults } = await import('../scripts/browser/results.mjs');

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/results/${name}.json`, import.meta.url)));
const ALL = ['j', 'joe', 'joel'];
const E = euros => decimalUnits(String(euros));
const today = '2026-10-14';
// The snapshot's current desk equity, as the page reads it from Desk's cells.
const ctxOf = (todayUnits = [null, null, null], extra = {}) => ({ today, todayUnits, nowMs: Date.parse('2026-10-14T17:42:22.000Z'), intraday: null, ...extra });
const roll = (ix, p, anchor, desks = ALL, ctx = ctxOf()) => M.rollup(ix, M.periodOf(p, anchor, ctx.today, ix.meta.trackingStart), desks, ctx);

test('fixtures: every results fixture is a valid served v2 contract', () => {
  for (const name of ['empty', 'scratches', 'no-losers', 'drawdown', 'dst-weeks']) {
    const r = validateContract('results', fixture(name));
    assert.ok(r.ok, `${name}: ${JSON.stringify(r.errors)}`);
  }
  const design = designResults();
  assert.ok(validateContract('results', design).ok, JSON.stringify(validateContract('results', design).errors));
});

test('decimal: exact multiplication, division and half-away rounding; no binary floating point', () => {
  assert.equal(divRound(5n, 2n), 3n);
  assert.equal(divRound(-5n, 2n), -3n, 'half away from zero, also below zero');
  assert.equal(divRound(4n, 3n), 1n);
  assert.equal(roundUnits(E('1.005'), 2), E('1.01'), 'a half cent rounds up to a whole cent');
  assert.equal(roundUnits(E('-1.005'), 2), E('-1.01'));
  assert.equal(roundUnits(E('1.00499999'), 2), E('1'));
  assert.equal(unitsNumber(E('1.005')), 1.01, 'Number(1.005).toFixed(2) would give 1.00');
  assert.equal(unitsNumber(E('0.0049')), 0);
  assert.equal(mulUnits(E('0.9058'), E('-0.36')), E('-0.32608800'));
  assert.equal(divUnits(E('1'), E('3')), E('0.33333333'));
  assert.equal(unitsDecimal(E('-0.005')), '-0.005');
  assert.equal(unitsDecimal(0n), '0');
});

test('fx: each trade’s gross is its quantity times the price move at the close rate, exactly', () => {
  for (const name of ['scratches', 'no-losers', 'drawdown', 'dst-weeks']) {
    for (const t of fixture(name).trades) assert.equal(M.grossFromFx(t), decimalUnits(t.grossEur.amount), `${name} ${t.id}`);
  }
  for (const t of designResults().trades) assert.equal(M.grossFromFx(t), decimalUnits(t.grossEur.amount), `design ${t.id}`);
  // A short gains when the price falls.
  const short = fixture('no-losers').trades.find(t => t.side === 'short');
  assert.ok(M.grossFromFx(short) > 0n);
});

test('win rate with scratches: ±€ 0,005 decides; ±€ 0,0049 and € 0 are flat and left out', () => {
  const ix = M.indexResults(fixture('scratches'));
  const R = roll(ix, 'day', '2026-10-13');
  assert.deepEqual([R.trades, R.won, R.lost, R.flat], [8, 3, 2, 3]);
  assert.equal(R.winRate, 60, 'won ÷ (won + lost) = 3 ÷ 5');
  assert.equal(R.small, true, 'fewer than 30 decided trades');
  assert.equal(R.units.realised, E('1.995'));
  assert.equal(R.realised, 2, 'rounded once, half away from zero');
  assert.equal(R.expectancy, 0.25, '1,995 ÷ 8 trades, flats included');
  assert.equal(R.pf, 2.99, '3,000 ÷ 1,005');
  assert.equal(R.avgWin, 1);
  assert.equal(R.avgLoss, -0.5, '−1,005 ÷ 2 = −0,5025');
  assert.equal(R.sizeRatio, 1.99, '(3 ÷ 3) ÷ (1,005 ÷ 2)');
  assert.equal(R.best.net, 2); assert.equal(R.worst.net, -1);
  assert.equal(R.units.fees, E('2.8')); assert.equal(R.units.gross, E('4.795'));
  assert.equal(R.units.gross - R.units.fees, R.units.realised, 'gross − fees = realised');
  assert.equal(R.bestDay.date, '2026-10-13'); assert.equal(R.worstDay.date, '2026-10-13');
});

test('profit factor with no losers: none, and no average loss; winners still count', () => {
  const ix = M.indexResults(fixture('no-losers'));
  const R = roll(ix, 'week', '2026-10-07');
  assert.deepEqual([R.trades, R.won, R.lost, R.flat], [3, 2, 0, 1]);
  assert.equal(R.pf, null);
  assert.equal(R.avgLoss, null); assert.equal(R.sizeRatio, null); assert.equal(R.worst, null);
  assert.equal(R.winRate, 100);
  assert.equal(R.avgWin, 0.75);
  assert.equal(R.best.symbol, 'KO');
});

test('drawdown: the deepest fall from a running peak over E(S−1) and every session close', () => {
  const ix = M.indexResults(fixture('drawdown'));
  const all = roll(ix, 'month', '2026-09-01');
  assert.equal(all.units.startE, E('15000'), 'before tracking each desk holds € 5.000');
  assert.equal(all.units.dd, E('-40'), '15.030 → 14.990');
  assert.equal(all.ddPct, -0.27, '−40 ÷ 15.030');
  assert.equal(all.net, 40);
  assert.equal(all.unreal, 45, 'Unrealised = Net − Realised (40 − (−5))');
  const j = roll(ix, 'month', '2026-09-01', ['j']);
  assert.equal(j.units.dd, E('-40')); assert.equal(j.ddPct, -0.8, '−40 ÷ 5.030');
  // A rising period has no dip.
  const up = roll(ix, 'day', '2026-09-16', ['j']);
  assert.equal(up.dd, 0);
  // Day uses the observed intraday points (History), never estimates.
  const point = (t, j) => ({ t, desks: { j: { money: { equity: { amount: j, currency: 'EUR' } } }, joe: { money: { equity: { amount: '5000', currency: 'EUR' } } }, joel: { money: { equity: null } } }, totals: {} });
  const cols = hm.toColumns([point('2026-10-14T13:30:00.000Z', '5000'), point('2026-10-14T14:30:00.000Z', '5010'), point('2026-10-14T15:30:00.000Z', '4995'), point('2026-10-14T16:30:00.000Z', '5005.5'), point('2026-10-13T15:00:00.000Z', '4000')].sort((a, b) => a.t.localeCompare(b.t)));
  const intraday = M.intraday(cols, today, ['j', 'joe']);
  assert.deepEqual(intraday.map(p => p.units), [E('10000'), E('10010'), E('9995'), E('10005.5')], 'observed rows of that Vienna date only');
  assert.equal(M.intraday(cols, today, ALL).length, 0, 'a desk without an observation leaves the row out');
  const day = roll(ix, 'day', today, ['j', 'joe'], ctxOf([E('5004'), E('5000'), null], { intraday }));
  assert.equal(day.units.dd, E('-15'), '5.010 → 4.995 inside the day');
  assert.equal(day.net, 4, 'E(today) is the snapshot now');
});

test('empty period: no trades and no change reads as empty; an unknown end is not empty', () => {
  const ix = M.indexResults(fixture('empty'));
  const flat = [E('5000'), E('5000'), E('5000')];
  const R = roll(ix, 'week', today, ALL, ctxOf(flat));
  assert.equal(R.empty, true); assert.equal(R.trades, 0); assert.equal(R.net, 0);
  assert.equal(R.winRate, null); assert.equal(R.expectancy, null); assert.equal(R.pf, null); assert.equal(R.bestDay, null);
  const unknown = roll(ix, 'week', today, ALL, ctxOf([null, null, null]));
  assert.equal(unknown.net, null, 'no snapshot and no close today: the result is not known');
  assert.equal(unknown.empty, false);
  // Before tracking: € 5.000 per desk, so August is empty.
  const august = roll(ix, 'month', '2026-08-01', ALL, ctxOf(flat));
  assert.equal(august.empty, true);
  assert.equal(august.units.startE, E('15000'));
});

test('net, realised, still open, gross and fees follow §4.2; today is the snapshot, else today’s close', () => {
  const ix = M.indexResults(fixture('scratches'));
  const now = [E('5003'), E('5000'), E('4999')];
  const week = roll(ix, 'week', today, ALL, ctxOf(now));
  assert.equal(week.units.startE, E('15000'), 'E(Sun 11 Oct): the 12 Oct close is later, so € 5.000 each');
  assert.equal(week.net, 2, '15.002 − 15.000');
  assert.equal(week.realised, 2, '1,995 rounded once');
  assert.equal(week.units.net - week.units.realised, E('0.005'), 'Unrealised = Net − Realised, exactly');
  assert.equal(week.unreal, 0.01, 'and a half cent shows as € 0,01');
  assert.equal(week.fees, 2.8); assert.equal(week.gross, 4.8, '4,795 rounded once');
  // With no current snapshot, today's close in the record stands in; with neither, Net is unknown.
  const fromClose = roll(ix, 'week', today, ALL, ctxOf([null, null, null]));
  assert.equal(fromClose.net, null, 'the record has no close for today');
  const yesterday = roll(ix, 'day', '2026-10-13', ALL, ctxOf(now));
  assert.equal(yesterday.units.net, E('1.995'), 'E(13 Oct) − E(12 Oct) from the record');
});

test('vienna dates: extended hours, the five-hour week, NY’s repeated hour, Vienna midnight and the spring twin', () => {
  const ix = M.indexResults(fixture('dst-weeks'));
  const dates = ix.trades.date;
  const of = k => ix.dates[dates[k]];
  assert.deepEqual(Array.from({ length: ix.trades.n }, (_, k) => [of(k), M.trade(ix, k).net]), [
    ['2026-10-15', 1], // 18:30 New York on 14 Oct is already Thursday in Vienna
    ['2026-10-25', 2], // Vienna midnight, the night its clocks go back
    ['2026-10-27', 3], // the five-hour week: 18:30 New York is 23:30 in Vienna, same date
    ['2026-10-28', 4], // 19:10 New York is past Vienna midnight
    ['2026-11-01', 5], // 01:30 EDT
    ['2026-11-01', 6], // 01:30 EST, an hour later by the UTC instant
    ['2027-03-16', 7], // spring twin: 18:30 New York (EDT) is 23:30 in Vienna (CET)
    ['2027-03-31', 8], // and once Vienna is on summer time, 00:30 the next day
  ]);
  const later = { ...ctxOf(), today: '2027-04-01' };
  const week = M.rollup(ix, M.periodOf('week', '2026-10-28', later.today, ix.meta.trackingStart), ALL, later);
  assert.equal(M.periodOf('week', '2026-10-28', later.today).lab, '26\u00a0Oct – 1\u00a0Nov 2026');
  assert.equal(week.trades, 4, 'Tue 27, Wed 28 and both 01:30s on Sun 1 Nov');
  assert.deepEqual(M.tradesOn(ix, '2026-11-01', ALL).map(t => t.closedAt), [Date.parse('2026-11-01T05:30:00.000Z'), Date.parse('2026-11-01T06:30:00.000Z')]);
  assert.equal(M.dayResult(ix, '2026-10-14', ALL).count, 0, 'the 14 Oct evening trade is not on 14 Oct');
  assert.equal(M.periodOf('week', '2026-10-28', later.today).start, '2026-10-26', 'weeks start on Monday, by date');
});

test('calendar: a day is Σ net of its trades; tints are quarters of the largest day; a day lists exactly its trades', () => {
  const ix = M.indexResults(designResults());
  const max = M.maxAbsDay(ix, ALL);
  assert.ok(max > 0n);
  let seen = 0;
  for (const k of ix.dates) {
    const r = M.dayResult(ix, k, ALL), rows = M.tradesOn(ix, k, ALL);
    assert.equal(rows.length, r.count, k);
    assert.equal(rows.reduce((s, t) => s + t.units.net, 0n), r.units, k);
    assert.deepEqual(rows.map(t => t.closedAt), rows.map(t => t.closedAt).slice().sort((a, b) => a - b), `${k} oldest first`);
    for (const t of rows) assert.equal(M.viennaDate(t.closedAt), k);
    if (r.count) seen++;
  }
  assert.ok(seen > 10);
  assert.equal(M.tintStep(max, max), 4);
  assert.equal(M.tintStep(max / 4n, max), 1);
  assert.equal(M.tintStep(max / 4n + 1n, max), 2);
  assert.equal(M.tintStep(-max * 3n / 4n, max), 3);
  assert.equal(M.tintStep(1n, max), 1, 'the smallest result still gets the first step');
  // Per desk: the desks' days add up to the total.
  for (const k of ix.dates) assert.equal(ALL.reduce((s, d) => s + M.dayResult(ix, k, [d]).units, 0n), M.dayResult(ix, k, ALL).units);
});

test('by desk: J, Joe and Joel add up to the total for every number that adds', () => {
  const ix = M.indexResults(designResults());
  const now = [E('4987.42'), E('4983.46'), E('5026.30')];
  for (const p of ['day', 'week', 'month', 'ytd', 'all']) {
    const ctx = ctxOf(now);
    const total = roll(ix, p, today, ALL, ctx), parts = ALL.map(d => roll(ix, p, today, [d], ctx));
    for (const key of ['realised', 'gross', 'fees', 'net']) assert.equal(parts.reduce((s, r) => s + r.units[key], 0n), total.units[key], `${p} ${key}`);
    assert.equal(parts.reduce((s, r) => s + r.trades, 0), total.trades);
    assert.equal(total.units.net - total.units.realised, total.units.net - total.units.realised);
  }
});

test('periods: plain labels, Monday weeks, the stepper between 1 Aug and today', () => {
  assert.equal(M.periodOf('week', today, today).lab, 'This week · 12–18\u00a0Oct');
  assert.equal(M.periodOf('week', '2026-10-07', today).lab, 'Last week · 5–11\u00a0Oct');
  assert.equal(M.periodOf('week', '2026-09-30', today).lab, '28\u00a0Sep – 4\u00a0Oct');
  assert.equal(M.periodOf('day', today, today).lab, 'Today · Wed 14\u00a0Oct');
  assert.equal(M.periodOf('day', '2026-10-07', today).lab, 'Wed 7\u00a0Oct 2026');
  assert.equal(M.periodOf('month', '2026-08-12', today).lab, 'August 2026');
  assert.equal(M.periodOf('all', today, today, '2026-09-10').lab, 'All time · since 10\u00a0Sep');
  assert.equal(M.periodOf('all', today, today, '2026-09-10').start, '2026-09-10');
  assert.equal(M.periodOf('ytd', today, today).start, '2026-01-01');
  for (const p of ['day', 'week', 'month', 'ytd', 'all']) assert.doesNotMatch(M.periodOf(p, today, today, '2026-09-10').lab, /\b(YTD|Wk \d+)\b/);
  assert.equal(M.stepAnchor('day', today, 1, today, '2026-09-10'), today, 'never past today');
  assert.equal(M.stepAnchor('month', '2026-08-05', -1, today, '2026-09-10'), '2026-08-01', 'never before 1 Aug of the first tracked year');
  assert.equal(M.stepAnchor('week', today, -1, today, '2026-09-10'), '2026-10-07');
  assert.equal(M.firstStep('2026-09-10'), '2026-08-01');
  assert.equal(M.firstStep('2027-03-02'), '2027-03-01', 'never after tracking starts');
});

test('kept holdings: a record that trades a symbol on the kept list is held back', () => {
  const ix = M.indexResults(designResults());
  assert.deepEqual(M.keptInRecord(ix, ['SXR8', 'TSLA']), [], 'the record never trades the safety floor');
  const symbol = ix.symbols[0];
  assert.deepEqual(M.keptInRecord(ix, ['SXR8', 'TSLA', symbol]), [symbol], 'a symbol later added to the kept list');
  // The contract itself rejects the two mandatory kept symbols.
  const bad = structuredClone(fixture('no-losers'));
  bad.trades[0].symbol = 'TSLA';
  assert.equal(validateContract('results', bad).ok, false);
});

test('hero chart: the result so far from € 0, one point per session close, today now; Day per observed point', () => {
  const ix = M.indexResults(fixture('drawdown'));
  const per = M.periodOf('month', '2026-09-01', today, ix.meta.trackingStart);
  const c = M.curve(ix, per, ['j'], ctxOf());
  assert.equal(c.pts[0].v, 0);
  assert.deepEqual(c.pts.slice(1).map(p => [p.k, p.v]), [['2026-09-10', 10], ['2026-09-11', 30], ['2026-09-14', -10], ['2026-09-15', 0], ['2026-09-16', 40]]);
  const week = M.curve(ix, M.periodOf('week', today, today, ix.meta.trackingStart), ['j'], ctxOf([E('5002'), null, null]));
  assert.deepEqual(week.pts.map(p => p.v), [0, -40, -38], 'start (E of Sun 11 Oct carries the 16 Sep close, 5.040), the 13 Oct close, today now');
  assert.equal(week.pts.at(-1).now, true);
  // Day: the regular session (15:30–22:00 in Vienna on 14 Oct), widened to any change outside it.
  const flat = h => ({ t: Date.parse(`2026-10-14T${h}:00.000Z`), units: E('5000') });
  const moved = (h, v) => ({ t: Date.parse(`2026-10-14T${h}:00.000Z`), units: E(v) });
  const quiet = [flat('00:00'), flat('06:00'), flat('12:00'), moved('14:00', '5002'), moved('17:00', '5001')];
  const day = M.curve(ix, M.periodOf('day', today, today, ix.meta.trackingStart), ['j'], ctxOf([E('5003'), null, null], { intraday: quiet }));
  assert.deepEqual(day.pts.map(p => [new Date(p.x).toISOString().slice(11, 16), p.v]), [['13:30', 0], ['14:00', 2], ['17:00', 1], ['17:42', 3]], 'from the open (flat before it), each point, then now');
  const late = M.curve(ix, M.periodOf('day', today, today, ix.meta.trackingStart), ['j'], ctxOf([E('5004'), null, null], { intraday: [...quiet, moved('11:00', '5000.5')].sort((a, b) => a.t - b.t) }));
  assert.equal(new Date(late.pts[0].x).toISOString().slice(11, 16), '06:00', 'a change before the open widens the window');
  const blind = M.curve(ix, M.periodOf('day', today, today, ix.meta.trackingStart), ['j'], ctxOf([null, null, null]));
  assert.deepEqual(blind.pts, [], 'no money now and no intraday: nothing drawn, nothing invented');
});

test('the worker’s index arrives intact by transfer', () => {
  const ix = M.indexResults(designResults());
  const copy = structuredClone(ix, { transfer: M.transferables(ix) });
  const R = roll(copy, 'all', today, ALL, ctxOf([E('4987.42'), E('4983.46'), E('5026.30')]));
  assert.ok(R.trades > 20);
  assert.equal(M.trade(copy, 0).id, designResults().trades.slice().sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || (a.id < b.id ? -1 : 1))[0].id);
});

test('read: the results read keeps the last good record on a failed refresh, and says not wired until JOED-20', () => {
  const good = fixture('scratches');
  const first = acceptRead('results', { status: 200, payload: good });
  assert.equal(first.value, good);
  const failed = acceptRead('results', { status: 0 }, first);
  assert.equal(failed.value, good); assert.equal(failed.reason, 'refresh_failed');
  const notWired = acceptRead('results', { status: 503, payload: { reason: 'results_not_wired' } });
  assert.equal(notWired.value, null); assert.equal(notWired.reason, 'results_not_wired');
  const auth = acceptRead('results', { status: 401 });
  assert.equal(auth.reason, 'auth_required');
  // The shared selector gives the record its own state and age.
  const ix = M.indexResults(good);
  const at = s => new Date(Date.parse(good.receivedAt) + s * 1000).toISOString();
  const fresh = panelStates({ results: { value: { ...ix.meta, index: ix }, reason: null } }, at(20));
  assert.deepEqual([fresh.results.state, fresh.results.reason], ['fresh', null]);
  const stale = panelStates({ results: { value: { ...ix.meta, index: ix }, reason: null } }, at(90));
  assert.deepEqual([stale.results.state, stale.results.reason], ['stale', 'snapshot_stale']);
  const kept = panelStates({ results: { value: { ...ix.meta, index: ix }, reason: 'refresh_failed' } }, at(600));
  assert.deepEqual([kept.results.state, kept.results.retained, Math.round(kept.results.ageSeconds)], ['broken', true, 600]);
});
