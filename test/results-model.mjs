// Results under Node (AC-12): the §4.2 definitions exactly, from the results
// v2 fixtures; Vienna dates for every trade; exact decimals; the calendar's
// tint scale; a day's trades; the hero chart's points. The browser serves
// public/joe/time.mjs and public/joe/contracts/* from the repo root; this hook
// mirrors that mapping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';

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
const page = await import('../public/joe/results.js');
const fmt = await import('../public/joe/format.js');
const { bn } = await import('../public/joe/ui.js');
const { STARTING_MONEY, percentOf, sincePercent } = await import('../public/joe/performance.js');
const { decimalUnits, divRound, roundUnits, mulUnits, divUnits, unitsDecimal, unitsNumber } = await import('../contracts/decimal.mjs');
const { validateContract } = await import('../contracts/index.mjs');
const { missingResultsDays } = await import('../contracts/vienna-date.mjs');
const { acceptRead } = await import('../contracts/read.mjs');
const { acceptSnapshot } = await import('../contracts/accept.mjs');
const { panelStates } = await import('../contracts/panel-state.mjs');
const hm = await import('../public/joe/history-model.js');
const { designResults, largeResults, withTradeSummaries, partialDaysResults, periodHintResults, tradeAmountResults, retainedPartialResults } = await import('../scripts/browser/results.mjs');
const { scenario, preflightSnapshot } = await import('../scripts/browser/board.mjs');
const { priorRollupBase, priorRollupPercent } = await import('./fixtures/period-base-reference.mjs');

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/results/${name}.json`, import.meta.url)));
const ALL = ['j', 'joe', 'joel'];
const E = euros => decimalUnits(String(euros));
const today = '2026-10-14';
// Markup-only sinks have no disclosure bodies or focusable descendants.
const markupNode = () => ({ innerHTML: '', textContent: '', querySelectorAll: () => [] });
// The snapshot's current desk equity, as the page reads it from Desk's cells.
const ctxOf = (todayUnits = [null, null, null], extra = {}) => ({ today, todayUnits, nowMs: Date.parse('2026-10-14T17:42:22.000Z'), intraday: null, ...extra });
const roll = (ix, p, anchor, desks = ALL, ctx = ctxOf()) => M.rollup(ix, M.periodOf(p, anchor, ctx.today, ix.meta.trackingStart), desks, ctx);
// A small served record built in the test: closes per date (J, Joe, Joel) and trades.
const eurOf = amount => ({ amount, currency: 'EUR' });
const closeDay = (date, j, joe = '5000', joel = '5000') => ({ date, desks: Object.fromEntries([['j', j], ['joe', joe], ['joel', joel]].map(([id, v]) =>
  [id, { equityClose: v === null ? null : eurOf(v), realisedNet: eurOf('0'), fees: eurOf('0'), trades: 0 }])) });
const tradeOf = (id, desk, closedAt, net, fees = '0') => ({ id, desk, symbol: 'KO', company: 'Coca-Cola', side: 'long', quantity: '1', openedAt: closedAt, closedAt,
  entryPrice: { amount: '70', currency: 'USD' }, exitPrice: { amount: '70', currency: 'USD' }, grossEur: eurOf(unitsDecimal(decimalUnits(net) + decimalUnits(fees))),
  feesEur: eurOf(fees), netEur: eurOf(net), fx: { base: 'USD', quote: 'EUR', rate: '0.9', source: 'test-close-rate', observedAt: closedAt }, method: 'execution-fifo-net-current-fx' });
function record(days, trades = [], trackingStart = '2026-09-10', receivedAt = '2026-10-14T17:40:00.000Z') {
  const r = { schema: 'inspr.joe.household.results.v2', seq: 1, generatedAt: receivedAt, receivedAt,
    currency: 'EUR', timeZone: 'Europe/Vienna', trackingStart, days, trades, benchmark: null };
  withTradeSummaries(r);
  const checked = validateContract('results', r);
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  return r;
}
// A History point: each desk's equity (null: not observed) and its bookkeeping basis.
const histRow = (t, desks) => ({ t, desks: Object.fromEntries(Object.entries(desks).map(([id, [equity, basis]]) =>
  [id, { money: { equity: equity === null ? null : eurOf(equity) }, ...(basis ? { historyBasis: basis } : {}) }])), totals: {} });

test('JOED-28 results: server missing-day warnings survive indexing and worker transfer without changing trade money', () => {
  const value = fixture('scratches');
  const before = M.indexResults(value);
  value.missingDays = ['2026-10-13'];
  const ix = M.indexResults(value);
  const transferred = structuredClone(ix, { transfer: M.transferables(ix) });
  assert.deepEqual([...transferred.missingDays], ['2026-10-13']);
  for (const id of M.DESK_IDS) {
    assert.deepEqual(M.dayResult(transferred, '2026-10-13', [id]), M.dayResult(before, '2026-10-13', [id]));
  }
  assert.equal(before.missingDays.size, 0);
});

test('JOED-30 results: partial dates, empty desks and nullable summaries validate and survive worker transfer', () => {
  const value = fixture('partial-day');
  value.days.push({ date: '2026-10-13', desks: {}, coverage: 'partial', partialReasons: ['history_gap'] });
  const day = value.days[0];
  day.desks.j.realisedNet = day.desks.j.fees = null;
  assert.ok(validateContract('results', value).ok);
  const ix = M.indexResults(value);
  const copy = structuredClone(ix, { transfer: M.transferables(ix) });
  assert.deepEqual([...copy.partialDays].sort(), ['2026-10-13', '2026-10-14']);
  assert.equal(M.dayResult(copy, '2026-10-14', ALL).units, E('-1'));
  assert.deepEqual(M.dayResult(copy, '2026-10-13', ALL), { count: 0, units: 0n, net: 0 });
  assert.equal(M.indexResults(fixture('scratches')).partialDays.size, 0, 'omitted coverage stays full');
});

test('fixtures: every results fixture is a valid served v2 contract', () => {
  for (const name of ['empty', 'scratches', 'no-losers', 'drawdown', 'dst-weeks', 'exact-decimals', 'partial-day']) {
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
  for (const name of ['scratches', 'no-losers', 'drawdown', 'dst-weeks', 'exact-decimals']) {
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
  const { pts: intraday, cut } = M.intraday(cols, today, ['j', 'joe']);
  assert.equal(cut, null, 'one bookkeeping basis all day');
  assert.deepEqual(intraday.map(p => p.units), [E('10000'), E('10010'), E('9995'), E('10005.5')], 'observed rows of that Vienna date only');
  assert.equal(M.intraday(cols, today, ALL).pts.length, 0, 'a desk without an observation leaves the row out');
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
  // With no current snapshot money, Net is unknown (see "today's money" below).
  const blind = roll(ix, 'week', today, ALL, ctxOf([null, null, null]));
  assert.equal(blind.net, null, 'no money now');
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
    ['2026-10-25', 9], // 02:30 CEST, before fallback
    ['2026-10-25', 10], // 02:59:59.999 CEST
    ['2026-10-25', 11], // 02:00 CET, exactly at fallback
    ['2026-10-25', 12], // the second 02:30, now CET
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

test('vienna dates: the fallback day lasts 25 hours; both midnights and repeated hours use Vienna', () => {
  const vectors = [
    ['2026-10-24T21:59:59.999Z', '2026-10-24'],
    ['2026-10-24T22:00:00.000Z', '2026-10-25'],
    ['2026-10-25T00:59:59.999Z', '2026-10-25'],
    ['2026-10-25T01:00:00.000Z', '2026-10-25'],
    ['2026-10-25T22:59:59.999Z', '2026-10-25'],
    ['2026-10-25T23:00:00.000Z', '2026-10-26'],
  ];
  for (const [instant, day] of vectors) {
    assert.equal(M.viennaDate(Date.parse(instant)), day);
    assert.equal(page.resultsToday(instant), day);
  }
  assert.equal(M.viennaMidnight('2026-10-25'), Date.parse('2026-10-24T22:00:00.000Z'));
  assert.equal(M.viennaMidnight('2026-10-26'), Date.parse('2026-10-25T23:00:00.000Z'));
  assert.equal(M.viennaMidnight('2026-10-26') - M.viennaMidnight('2026-10-25'), 25 * 3600000);
  const ix = M.indexResults(fixture('dst-weeks'));
  assert.equal(M.dayResult(ix, '2026-10-25', ALL).units, E('44'));
  assert.deepEqual(M.tradesOn(ix, '2026-10-25', ALL).map(t => t.closedAt), [
    '2026-10-24T22:30:00.000Z', '2026-10-25T00:30:00.000Z', '2026-10-25T00:59:59.999Z',
    '2026-10-25T01:00:00.000Z', '2026-10-25T01:30:00.000Z',
  ].map(Date.parse));
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
  assert.deepEqual(c.pts.filter(p => !p.edge).map(p => [p.k, p.v]), [['2026-09-10', 10], ['2026-09-11', 30], ['2026-09-14', -10], ['2026-09-15', 0], ['2026-09-16', 40]]);
  const week = M.curve(ix, M.periodOf('week', today, today, ix.meta.trackingStart), ['j'], ctxOf([E('5002'), null, null]));
  assert.deepEqual(week.pts.map(p => p.v), [0, null, -40, -38], 'start (E of Sun 11 Oct carries the 16 Sep close, 5.040), a break for Mon 12 Oct (a session without a close), the 13 Oct close, today now');
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

test('read: results keeps last good on a failed refresh and says no data before the first push', () => {
  const good = fixture('scratches');
  const first = acceptRead('results', { status: 200, payload: good });
  assert.equal(first.value, good);
  const failed = acceptRead('results', { status: 0 }, first);
  assert.equal(failed.value, good); assert.equal(failed.reason, 'refresh_failed');
  const missing = acceptRead('results', { status: 503, payload: { reason: 'feed_not_received' } });
  assert.equal(missing.value, null); assert.equal(missing.reason, 'feed_not_received');
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

test('first paint: Results has the no-data reason before any feed or state arrives', () => {
  for (const cell of [undefined, { value: null, reason: null }]) {
    const view = page.resultsView({ now: '2026-10-14T17:42:22.000Z', states: { results: cell }, feeds: {} });
    assert.equal(view.ix, null);
    assert.equal(view.reason, 'feed_not_received');
  }
});

test('results: sum exact trade money before display rounding, including gross and fees', () => {
  const r = fixture('exact-decimals');
  const R = roll(M.indexResults(r), 'day', '2026-10-14');
  assert.deepEqual([R.units.gross, R.units.fees, R.units.realised], [E('0.0396'), E('0.0118'), E('0.0278')]);
  assert.deepEqual([fmt.eur(R.units.gross), fmt.eur(R.units.fees), fmt.eur(R.units.realised)], ['€ 0,04', '€ 0,01', '€ 0,03']);
  for (const [field, sum] of [['grossEur', R.units.gross], ['feesEur', R.units.fees], ['netEur', R.units.realised]]) {
    const roundedFirst = r.trades.reduce((s, t) => s + roundUnits(E(t[field].amount)), 0n);
    assert.notEqual(roundedFirst, roundUnits(sum), field);
  }
});

test('results: partial day summaries never replace the exact visible trade-level P&L', () => {
  const r = fixture('partial-day');
  const ix = M.indexResults(r);
  const R = roll(ix, 'day', '2026-10-14');
  assert.deepEqual([R.trades, R.units.realised, R.units.fees], [1, E('-1'), E('0.64')]);
  assert.equal(M.dayResult(ix, '2026-10-14', ALL).units, E('-1'));
  assert.equal(r.days[0].desks.j.realisedNet.amount, '-2', 'the wider summary is validated as partial, never used as trade P&L');
});

// ---------- Fix round 1 (Codex review r1): each fails on 7009b62 ----------

test('basis: a change of bookkeeping basis is shown as such, never as a result, a dip or a line (r1 High)', () => {
  // J closes 12 and 13 Oct at € 7.000 on basis A; at 13:00 UTC on 14 Oct it is € 5.000 on basis B.
  const ix = M.indexResults(record([closeDay('2026-10-12', '7000'), closeDay('2026-10-13', '7000')]));
  const others = { joe: ['5000', 'joe.v1'], joel: ['5000', 'joel.v1'] };
  const cols = hm.toColumns([
    histRow('2026-10-13T19:55:00.000Z', { j: ['7000', 'j.a'], ...others }),
    histRow('2026-10-14T12:00:00.000Z', { j: ['7000', 'j.a'], ...others }),
    histRow('2026-10-14T12:30:00.000Z', { j: [null, null], ...others }), // unknown, not a new basis
    histRow('2026-10-14T13:00:00.000Z', { j: ['5000', 'j.b'], ...others }),
    histRow('2026-10-14T16:00:00.000Z', { j: ['4990', 'j.b'], ...others }),
    histRow('2026-10-14T17:00:00.000Z', { j: ['5010', 'j.b'], ...others })]);
  const nowMs = Date.parse('2026-10-14T17:42:22.000Z'), CHANGE = Date.parse('2026-10-14T13:00:00.000Z');
  // The intraday observations themselves never mix bases (old: 7.000, 5.000, 4.990, 5.010 as one series).
  const points = M.intraday(cols, today, ['j']);
  assert.deepEqual([points.pts, points.cut], [[], { desks: ['j'], at: CHANGE }]);
  const snap = j => ({ j: { id: 'j', historyBasis: j }, joe: { id: 'joe', historyBasis: 'joe.v1' }, joel: { id: 'joel', historyBasis: 'joel.v1' } });
  const inputs = { today, todayUnits: [E('5010'), E('5000'), E('5000')], nowMs, cols, cuts: M.basisCuts(cols, snap('j.b'), nowMs) };
  assert.deepEqual(inputs.cuts.map(c => [c.desk, c.from, c.at]), [['j', Date.parse('2026-10-14T12:00:00.000Z'), CHANGE]]);
  const view = (p, desks, anchor = today, given = inputs) => {
    const per = M.periodOf(p, anchor, today, ix.meta.trackingStart), ctx = M.moneyContext(ix, given, per, desks);
    return { R: M.rollup(ix, per, desks, ctx), c: M.curve(ix, per, desks, ctx) };
  };
  for (const p of ['day', 'week', 'month', 'ytd', 'all']) for (const desks of [['j'], ALL]) {
    const { R, c } = view(p, desks);
    assert.deepEqual([R.net, R.unreal, R.dd, R.units.dd, R.empty], [null, null, null, null, false], `${p} ${desks}: no result and no dip across J's change (old: −€ 2.000)`);
    assert.deepEqual(R.cut, { desks: ['j'], at: CHANGE }, `${p} ${desks}: the change itself is reported`);
    assert.deepEqual([c.pts, c.cut], [[], R.cut], `${p} ${desks}: nothing plotted across it`);
    assert.equal(R.realised, 0, 'closed-trade numbers do not depend on the money and stand');
  }
  // Joe kept its basis: its numbers stand. So does J's day before the change.
  const joe = view('day', ['joe']);
  assert.deepEqual([joe.R.net, joe.R.dd, joe.R.cut], [0, 0, null]);
  const before = view('day', ['j'], '2026-10-13');
  assert.deepEqual([before.R.cut, before.R.net], [null, 0]);
  // A snapshot whose money now is on another basis than History's last row: a cut at now.
  const moved = { ...inputs, cuts: M.basisCuts(hm.toColumns([histRow('2026-10-14T17:00:00.000Z', { j: ['5010', 'j.b'], ...others })]), snap('j.c'), nowMs) };
  assert.deepEqual(moved.cuts.map(c => [c.desk, c.at, c.now]), [['j', nowMs, true]]);
  assert.deepEqual(view('week', ['j'], today, moved).R.cut, { desks: ['j'], at: nowMs });
  assert.equal(view('week', ['j'], '2026-10-07', moved).R.cut, null, 'last week ended before it');
  assert.deepEqual(M.basisCuts(cols, { ...snap('j.c'), j: null }, nowMs), inputs.cuts, 'no money now: no basis now to compare');
});

test('today’s money: only the snapshot’s current equity; a close in the record never stands in (r1 Medium)', () => {
  // The record already has a close for today (J € 5.020); the snapshot has no money now.
  const ix = M.indexResults(record([closeDay('2026-10-13', '5000'), closeDay(today, '5020')]));
  for (const p of ['day', 'week', 'month', 'ytd', 'all']) {
    const R = roll(ix, p, today, ALL, ctxOf([null, null, null]));
    assert.deepEqual([R.net, R.unreal, R.dd, R.empty], [null, null, null, false], `${p}: Net, Still open and the dip stay unknown (old: today's close stood in)`);
    const c = M.curve(ix, M.periodOf(p, today, today, ix.meta.trackingStart), ALL, ctxOf([null, null, null]));
    assert.ok(c.pts.every(pt => !pt.now || pt.v === null), `${p}: no point for the money now`);
  }
  assert.equal(roll(ix, 'week', today, ALL, ctxOf([E('5020'), null, E('5000')])).net, null, 'one desk without money now leaves the sum unknown');
  assert.equal(roll(ix, 'week', today, ALL, ctxOf([E('5020'), E('5000'), E('5000')])).net, 20);
  // The page passes no money now for a retained (last good) equity cell, nor for a missing one.
  const cell = (amount, retained) => ({ state: retained ? 'broken' : 'fresh', value: { amount, currency: 'EUR' }, retained });
  const v = page.resultsView({ now: '2026-10-14T17:42:22.000Z', feeds: {},
    states: { results: { value: { ...ix.meta, index: ix }, reason: null }, 'desks.j.equity': cell('5020', true), 'desks.joe.equity': cell('5000', false), 'desks.joel.equity': { value: null, retained: false } } });
  assert.deepEqual(v.todayUnits, [null, E('5000'), null]);
});

test('period kind decides: Week on its Monday, Month on its 1st, the year on 1 Jan and All on day one use closes, never Day’s points (r1 Medium)', () => {
  const ix = M.indexResults(record([closeDay('2026-09-30', '5000'), closeDay('2026-10-09', '5000'), closeDay('2026-12-31', '5000')]));
  const dip = k => [['14:00', '5000'], ['15:00', '4990'], ['17:00', '5000']].map(([h, v]) => ({ t: Date.parse(`${k}T${h}:00.000Z`), units: E(v) }));
  const ctxAt = k => ({ today: k, todayUnits: [E('5000'), E('5000'), E('5000')], nowMs: Date.parse(`${k}T17:42:00.000Z`), intraday: dip(k), cut: null });
  for (const [p, k] of [['week', '2026-10-12'], ['month', '2026-10-01'], ['ytd', '2027-01-01'], ['all', '2026-09-10']]) {
    const per = M.periodOf(p, k, k, ix.meta.trackingStart), ctx = ctxAt(k);
    assert.equal(per.start, k, `${p}: the period so far is one date`);
    const R = M.rollup(ix, per, ['j'], ctx);
    assert.equal(R.dd, 0, `${p} on ${k}: E(S−1) and the money now, both € 5.000 (old: Day's −€ 10)`);
    assert.equal(M.curve(ix, per, ['j'], ctx).day, false, `${p}: drawn from closes, not as a day`);
    assert.equal(M.rollup(ix, M.periodOf('day', k, k, ix.meta.trackingStart), ['j'], ctx).dd, -10, 'Day keeps its intraday dip');
  }
  // The shared context fetches History's points for Day only.
  const k = '2026-10-12';
  const cols = hm.toColumns(dip(k).map(p => histRow(new Date(p.t).toISOString(), { j: [unitsDecimal(p.units), 'j.v1'], joe: ['5000', 'joe.v1'], joel: ['5000', 'joel.v1'] })));
  const inputs = { today: k, todayUnits: ctxAt(k).todayUnits, nowMs: ctxAt(k).nowMs, cols, cuts: [] };
  assert.equal(M.moneyContext(ix, inputs, M.periodOf('week', k, k, ix.meta.trackingStart), ['j']).intraday, null);
  assert.equal(M.moneyContext(ix, inputs, M.periodOf('day', k, k, ix.meta.trackingStart), ['j']).intraday.length, 3);
});

test('hero chart: a real time axis; missing dates keep their width and a session without a close breaks the line (r1 Medium)', () => {
  const ix = M.indexResults(fixture('drawdown'));
  const nowMs = Date.parse('2026-10-14T17:42:22.000Z');
  const all = M.curve(ix, M.periodOf('all', today, today, ix.meta.trackingStart), ['j'], ctxOf([E('5002'), null, null]));
  const x = k => all.pts.find(p => p.k === k && !p.edge).x;
  assert.equal(x('2026-10-13') - x('2026-09-16'), 27 * 864e5, '16 Sep → 13 Oct spans its 27 days (old: one step, like a single session)');
  assert.equal(x('2026-09-14') - x('2026-09-11'), 3 * 864e5, 'a weekend keeps its width and is no gap');
  const endOf = k => M.viennaMidnight(M.addDays(k, 1));
  assert.equal(M.viennaMidnight('2026-09-10'), Date.parse('2026-09-09T22:00:00.000Z'), 'Vienna midnight in summer time');
  assert.equal(M.viennaMidnight('2026-10-26'), Date.parse('2026-10-25T23:00:00.000Z'), 'and after the clocks go back');
  assert.deepEqual(all.domain, [M.viennaMidnight('2026-09-10'), nowMs]);
  assert.equal(all.tracking, M.viennaMidnight('2026-09-10'));
  assert.deepEqual(all.pts.map(p => [p.k ?? null, p.v, p.x]), [
    ['2026-09-10', 0, M.viennaMidnight('2026-09-10')],
    ['2026-09-10', 10, endOf('2026-09-10')], ['2026-09-11', 30, endOf('2026-09-11')], ['2026-09-14', -10, endOf('2026-09-14')],
    ['2026-09-15', 0, endOf('2026-09-15')], ['2026-09-16', 40, endOf('2026-09-16')],
    [null, null, (endOf('2026-09-16') + endOf('2026-10-13')) / 2],
    ['2026-10-13', 0, endOf('2026-10-13')], ['2026-10-14', 2, nowMs]]);
  // A month that starts before tracking: zero until 10 Sep, at its real place, then the closes.
  const sep = M.curve(ix, M.periodOf('month', '2026-09-01', today, ix.meta.trackingStart), ['j'], ctxOf());
  assert.deepEqual(sep.domain, [M.viennaMidnight('2026-09-01'), M.viennaMidnight('2026-10-01')]);
  assert.deepEqual(sep.pts.slice(0, 2).map(p => [p.edge, p.v, p.x]), [['start', 0, M.viennaMidnight('2026-09-01')], ['tracking', 0, M.viennaMidnight('2026-09-10')]]);
  assert.equal(sep.tracking, M.viennaMidnight('2026-09-10'));
  assert.ok(sep.pts.every(p => p.v !== null), 'no session is missing between its points');
});

test('money: exact at any size the contract accepts; no 64-bit wrap in a trade, a close or a sum (r1 Medium)', () => {
  const big = '100000000000.12345678';        // € 100 billion to the 10⁻⁸: past a signed 64-bit count of units
  const half = '60000000000.00000001';         // two of these sum past it
  const small = '100000.12345678';             // ≥ € 100.000, full precision
  const max = '9999999999999999999999.99999999'; // the longest negative amount the contract allows
  const ix = M.indexResults(record([closeDay('2026-10-12', '5000'), closeDay('2026-10-13', '100000005000.12345678')], [
    tradeOf('rt-a', 'j', '2026-10-13T14:00:00.000Z', big, '1.5'), tradeOf('rt-b', 'joe', '2026-10-13T14:10:00.000Z', half),
    tradeOf('rt-c', 'joe', '2026-10-13T14:20:00.000Z', half), tradeOf('rt-d', 'joel', '2026-10-13T14:30:00.000Z', small),
    tradeOf('rt-e', 'joel', '2026-10-12T14:30:00.000Z', `-${max}`)]));
  assert.deepEqual(Array.from({ length: ix.trades.n }, (_, k) => M.trade(ix, k).units.net), [E(`-${max}`), E(big), E(half), E(half), E(small)]);
  assert.equal(M.trade(ix, 1).units.gross, E('100000000001.62345678'));
  const day = roll(ix, 'day', '2026-10-13');
  assert.equal(day.units.realised, E(big) + 2n * E(half) + E(small));
  assert.equal(unitsDecimal(day.units.realised), '220000100000.24691358');
  assert.equal(roll(ix, 'day', '2026-10-13', ['joe']).units.realised, E('120000000000.00000002'), 'a sum past 64 bits');
  assert.equal(day.units.net, E('100000000000.12345678'), 'E(13 Oct) − E(12 Oct), exactly');
  assert.equal(M.dayResult(ix, '2026-10-12', ALL).units, E(`-${max}`));
  assert.equal(M.maxAbsDay(ix, ALL), E(max));
  assert.equal(roll(ix, 'all', today, ALL, ctxOf([E('5000'), E('5000'), E('5000')])).units.realised, E(big) + 2n * E(half) + E(small) - E(max));
  // Rounded once to the cent for the text, never through a Number.
  assert.equal(fmt.eur(day.units.realised, true), '+€ 220.000.100.000,25');
  assert.equal(fmt.eur(E(small)), '€ 100.000,12');
  assert.equal(fmt.eur(E(`-${max}`), true), '−€ 10.000.000.000.000.000.000.000,00');
  assert.match(bn(day.units.net), /\+<span class="u">€<\/span>100\.000\.000\.000,12</);
  assert.equal(fmt.money(E('123456789.12345678'), 'USD', false, 8), '$ 123.456.789,12345678', 'a price in full');
  // Day's intraday points are exact too: History carries each desk's equity in units.
  const cols = hm.toColumns([histRow('2026-10-14T14:00:00.000Z', { j: ['100000000000.12345678', 'j.v1'], joe: ['5000', 'joe.v1'], joel: ['5000', 'joel.v1'] }),
    histRow('2026-10-14T15:00:00.000Z', { j: ['100000000000.12345679', 'j.v1'], joe: ['5000', 'joe.v1'], joel: ['5000', 'joel.v1'] })]);
  assert.deepEqual(M.intraday(cols, today, ['j']).pts.map(p => unitsDecimal(p.units)), ['100000000000.12345678', '100000000000.12345679'], 'old: Number(…) × 1e8 lost the last digits');
  // The exact columns survive the worker's transfer.
  const copy = structuredClone(ix, { transfer: M.transferables(ix) });
  assert.equal(roll(copy, 'day', '2026-10-13').units.realised, day.units.realised);
});

test('best and worst day: equal days are two days, never "only day" (r1 Medium)', () => {
  const ix = M.indexResults(record([closeDay('2026-10-12', '5001'), closeDay('2026-10-13', '5002')],
    [tradeOf('rt-1', 'j', '2026-10-12T15:00:00.000Z', '1'), tradeOf('rt-2', 'j', '2026-10-13T15:00:00.000Z', '1')]));
  const R = roll(ix, 'week', today, ['j'], ctxOf([E('5002'), null, null]));
  assert.equal(R.days, 2);
  assert.deepEqual([R.bestDay.date, R.worstDay.date], ['2026-10-12', '2026-10-13'], 'ties: the first is the best, the last the worst');
  const tile = page.dayTile(R);
  assert.equal(tile.mean, 'Mon 12 Oct · Tue 13 Oct', 'old: "Mon 12 Oct · only day"');
  assert.match(tile.val, /<span class="sl">\/<\/span>/, 'both values');
  const one = page.dayTile(roll(ix, 'day', '2026-10-12', ['j']));
  assert.equal(one.mean, 'Mon 12 Oct · only day');
  assert.equal(page.dayTile(roll(ix, 'week', '2026-10-05', ['j'])).mean, 'No trading day');
});

test('calendar amounts: exact, rounded once, and in their cell’s room at any size (found with the r1 large-amount check)', () => {
  const form = (v, phone) => page.calAmount(E(v), phone).text;
  const table = [
    // amount, desktop (also the week column), phone
    ['0', '0,00', '0'], ['1', '1,00', '1'], ['-1', '1,00', '1'], ['12.58', '12,58', '13'],
    ['0.95', '0,95', '1'], ['0.94', '0,94', '0,9'], ['1.05', '1,05', '1,1'], ['1.04', '1,04', '1'],
    ['2.25', '2,25', '2,3'], ['-2.25', '2,25', '2,3'], ['2.249', '2,25', '2,2'],
    ['0.05', '0,05', '0,1'], ['0.049', '0,05', '0'], ['-0.03', '0,03', '0'],
    ['1234', '1.234', '1,2k'], ['-1000', '1.000', '1k'], ['1000000', '1,0M', '1M'],
    ['4.1', '4,10', '4,1'], ['-9.949', '9,95', '9,9'], ['99.994', '99,99', '100'], ['99.995', '100', '100'], ['123.45', '123', '123'],
    ['999.5', '1.000', '1k'], ['9999.49', '9.999', '10k'], ['9999.5', '10k', '10k'], ['100000.12345678', '100k', '0,1M'],
    ['999499', '999k', '1M'], ['1234567', '1,2M', '1,2M'], ['99950000', '100M', '0,1B'], ['123456789012', '123B', '0,1T'],
    ['999500000000000', '1e15', '1e15'], ['99999999999999999999999999999999', '1e32', '1e32']];
  for (const [v, desktop, phone] of table) assert.deepEqual([form(v, false), form(v, true)], [desktop, phone], v);
  // Formatting bounds only; the browser scenario measures signed phone forms
  // at 360/390 in Linux Chrome, including the 10 px scaled forms.
  for (const [v] of table) {
    assert.ok(form(v, false).length <= 5, `desktop ${v}`);
    const p = page.calAmount(E(v), true);
    assert.ok(p.text.length <= (p.cls ? 4 : 3), `phone ${v}`);
  }
});

test('JOED-29 calendar rendering: phone cells keep signs and tints without arrows; desktop and week arrows remain', t => {
  const documentBefore = globalThis.document, stateBefore = { ...page.RS };
  t.after(() => {
    if (documentBefore === undefined) delete globalThis.document;
    else globalThis.document = documentBefore;
    Object.assign(page.RS, stateBefore);
  });
  // Capture the real calendar renderer's markup without starting a browser.
  const nodes = new Map(['calTitle', 'prevMonth', 'nextMonth', 'calSum', 'cal', 'calLegend', 'daypanel', 'daySheet']
    .map(id => [`#${id}`, markupNode()]));
  globalThis.document = { querySelector: selector => nodes.get(selector), activeElement: null };
  const ix = M.indexResults(record([closeDay('2026-10-12', '5001'), closeDay('2026-10-13', '5001'), closeDay(today, '5000.97')], [
    tradeOf('rt-gain', 'j', '2026-10-12T15:00:00.000Z', '1'),
    tradeOf('rt-flat', 'j', '2026-10-13T15:00:00.000Z', '0'),
    tradeOf('rt-small-loss', 'j', '2026-10-14T15:00:00.000Z', '-0.03'),
    tradeOf('rt-loss', 'j', '2026-10-08T15:00:00.000Z', '-1'),
    tradeOf('rt-scaled-gain', 'j', '2026-10-09T15:00:00.000Z', '1234'),
    tradeOf('rt-scaled-loss', 'j', '2026-10-06T15:00:00.000Z', '-1234'),
    tradeOf('rt-million', 'j', '2026-10-07T15:00:00.000Z', '100000'),
    tradeOf('rt-week-loss', 'j', '2026-10-01T15:00:00.000Z', '-1'),
  ]));
  Object.assign(page.RS, { cal: [2026, 9], sel: today, period: 'week' });
  page.renderCalendar({ ix, today, trackingStart: ix.meta.trackingStart }, M.periodOf('week', today, today, ix.meta.trackingStart), ALL);
  const html = nodes.get('#cal').innerHTML;
  const cell = day => html.match(new RegExp(`<button[^>]*data-day="${day}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
  const phone = day => cell(day)?.match(/<span class="vs">([\s\S]*?)<\/span><\/span><span class="n">/)?.[1];
  const loss = cell(today), flat = cell('2026-10-13');
  assert.ok(loss && flat, 'both calendar cells were rendered');
  assert.match(loss, /class="cell l1\b/);
  assert.equal(phone(today), '<span class="pl">0</span>');
  assert.doesNotMatch(phone(today), /[−+]|<svg|<use/);
  assert.match(loss, /aria-label="[^"]*−€ 0,03 from 1 trade"/, 'the exact loss stays accessible');
  assert.match(loss, /class="vl">[\s\S]*href="#i-down"\/><\/svg>−0,03/, 'desktop still shows the exact loss');
  assert.match(flat, /class="cell flat\b/);
  assert.equal(phone('2026-10-13'), '<span class="pl">0</span>');
  assert.match(flat, /class="vl"><span class="pl">0,00<\/span>/);
  for (const [day, cls, text, direction] of [
    ['2026-10-12', '', '+1', 'up'], ['2026-10-08', '', '−1', 'down'],
    ['2026-10-09', ' sc', '+1,2k', 'up'], ['2026-10-06', ' sc', '−1,2k', 'down'],
    ['2026-10-07', ' sx', '+0,1M', 'up'],
  ]) {
    assert.equal(phone(day), `<span class="pl${cls}">${text}</span>`, day);
    assert.match(cell(day), new RegExp(`class="vl">[\\s\\S]*href="#i-${direction}"`), day);
    assert.match(cell(day), new RegExp(`class="cell ${direction === 'up' ? 'g' : 'l'}[1-4]\\b`), day);
  }
  const weeks = htmlDocument(html).querySelectorAll('.wk');
  assert.ok(weeks.some(week => week.querySelector('use[href="#i-up"]')), 'a positive week keeps its arrow');
  assert.ok(weeks.some(week => week.querySelector('use[href="#i-down"]')), 'a negative week keeps its arrow');
  assert.doesNotMatch(html, /title=/);
});

// Real calendar, panel and already-open phone sheet renderers, captured under
// Node. No browser is started; CI measures the same markup at phone widths.
function calendarCapture(t) {
  const before = globalThis.document, state = { ...page.RS };
  t.after(() => {
    if (before === undefined) delete globalThis.document;
    else globalThis.document = before;
    Object.assign(page.RS, state);
  });
  const nodes = new Map(['calTitle', 'prevMonth', 'nextMonth', 'calSum', 'cal', 'calLegend', 'daypanel', 'daySheet', 'sheetTitle', 'sheetBody']
    .map(id => [`#${id}`, markupNode()]));
  nodes.get('#daySheet').open = true;
  globalThis.document = { querySelector: selector => nodes.get(selector), activeElement: null };
  return (value, now, selected, desks = ALL, positions = []) => {
    const ix = M.indexResults(value), today = page.resultsToday(now);
    Object.assign(page.RS, { cal: M.ymOf(selected), sel: selected, period: 'month' });
    page.renderCalendar({ ix, today, trackingStart: ix.meta.trackingStart, positions }, M.periodOf('month', selected, today, ix.meta.trackingStart), desks);
    const html = nodes.get('#cal').innerHTML;
    return { html, cell: day => html.match(new RegExp(`<button[^>]*data-day="${day}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0],
      panel: nodes.get('#daypanel').innerHTML, sheet: nodes.get('#sheetBody').innerHTML, month: nodes.get('#calSum').innerHTML };
  };
}
const partialReason = "Part of this day's activity couldn't be confirmed, so its result may be incomplete.";
test('JOED-140: a complete 99-trade sheet body participates in the production focus trap', async t => {
  const render = calendarCapture(t), value = fixture('scratches');
  value.trades = Array.from({ length: 99 }, (_, i) => ({ ...value.trades[0], id: `rt-scroll-${i}` }));
  withTradeSummaries(value);
  assert.equal(validateContract('results', value).ok, true);
  const selected = M.viennaDate(Date.parse(value.trades[0].closedAt));
  const rendered = render(value, value.receivedAt, selected);
  assert.equal(htmlDocument(rendered.sheet).querySelectorAll('.trow').length, 99);
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const sheet = doc.querySelector('#daySheet'), body = doc.querySelector('#sheetBody');
  const close = sheet.querySelector('[data-close]');
  body.innerHTML = rendered.sheet;
  // Supply visibility/focus only; the production selector decides which
  // elements participate. Native interior Tab/scroll is verified in CI.
  const all = sheet.querySelectorAll('[tabindex]').concat(sheet.querySelectorAll('button'));
  for (const el of all) {
    el.getClientRects = () => [{}];
    el.focus = () => { doc.activeElement = el; };
  }
  sheet.contains = el => el === close || el === body;
  const select = sheet.querySelectorAll.bind(sheet);
  sheet.querySelectorAll = selector => selector.split(', ').flatMap(s => select(s));
  const handlers = new Map();
  doc.querySelectorAll = () => [sheet];
  doc.addEventListener = (type, fn) => handlers.set(type, fn);
  const beforeStyle = globalThis.getComputedStyle;
  t.after(() => { globalThis.getComputedStyle = beforeStyle; });
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  globalThis.document = doc;
  const ui = await import(`../public/joe/ui.js?joed140-focus`);
  ui.trapDialogs();
  const tab = shiftKey => {
    let prevented = false;
    handlers.get('keydown')({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  close.focus();
  assert.equal(tab(false), false, 'Tab from Close must reach the native scroll-body stop');
  assert.equal(body.getAttribute('tabindex'), '0');
  assert.equal(tab(true), true);
  assert.equal(doc.activeElement, body, 'Shift+Tab wraps Close to the scroll body');
  assert.equal(tab(false), true);
  assert.equal(doc.activeElement, close, 'Tab wraps the body back to Close');
});

test('JOED-140: trade fields have accessible names and list ownership in panel and sheet', t => {
  const value = fixture('scratches'), selected = M.viennaDate(Date.parse(value.trades[0].closedAt));
  const r = calendarCapture(t)(value, value.receivedAt, selected);
  for (const html of [r.panel, r.sheet]) {
    const doc = htmlDocument(html), rows = doc.querySelectorAll('.trow');
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.getAttribute('role'), 'listitem');
      assert.equal(row.parentElement.getAttribute('role'), 'list');
      for (const name of ['Entry price', 'Exit price', 'Net after fees']) {
        const field = row.querySelectorAll('[aria-label]').find(el => el.getAttribute('aria-label') === name);
        assert.ok(field, name);
        assert.equal(field.getAttribute('role'), 'group');
        assert.ok(field.textContent.trim(), 'the named field retains its amount');
      }
    }
  }
});

// Source constraint probes, not pixel measurements: CI exercises the same
// layouts in Chrome, including a 640 px window's 200% zoom equivalent.
const resultsCss = () => readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
function maxWidthRules(css, width) {
  const blocks = [];
  for (const match of css.matchAll(new RegExp(`@media \\(max-width: ${width}px\\) \\{`, 'g'))) {
    let depth = 1, end = match.index + match[0].length;
    for (; depth && end < css.length; end++) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') depth--;
    }
    blocks.push(css.slice(match.index, end));
  }
  return blocks.join('\n');
}
test('JOED-140: the narrow period stepper releases its 210 px minimum and wraps text', () => {
  const css = resultsCss();
  const narrow = maxWidthRules(css, 700);
  assert.match(narrow, /\.res-tools \.step-label\s*\{[^}]*min-width:\s*0\s*;/);
  assert.match(narrow, /\.res-tools \.step-label\s*\{[^}]*white-space:\s*normal\s*;/);
  assert.match(narrow, /\.res-tools \.step-label\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.ok(320 - 32 - 2 * 44 - 2 * 4 > 0, 'the remaining label track is positive at 320 CSS px');
});

test('JOED-140: calendar exposes a named button group without orphan grid roles', t => {
  const value = fixture('scratches'), selected = M.viennaDate(Date.parse(value.trades[0].closedAt));
  const r = calendarCapture(t)(value, value.receivedAt, selected);
  const shell = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const cal = shell.querySelector('#cal');
  cal.innerHTML = r.html;
  assert.equal(cal.getAttribute('role'), 'group');
  assert.equal(cal.getAttribute('aria-label'), 'Result calendar');
  assert.equal(cal.querySelectorAll('[role="columnheader"]').length, 0);
  const buttons = cal.querySelectorAll('[data-day]');
  assert.equal(buttons.length, 31);
  for (const button of buttons) {
    assert.ok(button.getAttribute('aria-label').startsWith(M.fmtDay(button.dataset.day)));
    assert.equal(button.getAttribute('aria-pressed'), String(button.dataset.day === selected));
  }
  const weeks = cal.querySelectorAll('.wk').filter(el => el.getAttribute('aria-hidden') !== 'true');
  assert.ok(weeks.length >= 4);
  const start = M.monday(`${selected.slice(0, 7)}-01`);
  for (const [i, week] of weeks.entries()) {
    assert.equal(week.getAttribute('role'), 'group');
    assert.equal(week.getAttribute('aria-label'), `Week of ${M.fmtDay(M.addDays(start, i * 7))}`);
    assert.ok(week.querySelector('.v'), 'the named group owns its week result');
  }
});

test('JOED-140: agenda ends at 382 px and seven-column targets fit from 383 px', () => {
  const css = resultsCss(), narrow = maxWidthRules(css, 382);
  const columns = narrow.match(/\.cal\s*\{[^}]*grid-template-columns:\s*repeat\((\d+),\s*minmax\(0,\s*1fr\)\)/);
  assert.ok(columns, 'narrow agenda declares its column count');
  assert.match(narrow, /\.cal \.cell\s*\{[^}]*min-height:\s*44px/);
  assert.match(narrow, /\.cal \.dow\s*\{\s*display:\s*none/);
  assert.match(narrow, /\.cal \.agenda-date\s*\{\s*display:\s*inline/);
  for (const viewport of [320, 360, 382]) {
    const count = Number(columns[1]), width = (viewport - 32 - 8 - 16 - (count - 1) * 3) / count;
    assert.ok(width >= 44, `${viewport}: agenda targets fit, including a reserved 16 px scrollbar`);
  }
  assert.match(maxWidthRules(css, 700), /\.cal\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  for (const viewport of [383, 390, 393]) {
    const width = (viewport - 32 - 8 - 16 - 6 * 3) / 7;
    assert.ok(width >= 44, `${viewport}: seven-column targets fit, including a reserved 16 px scrollbar`);
  }
});

const textOf = html => html.replace(/<[^>]+>/g, '').replaceAll('&#39;', "'").replaceAll('\u00ad', '');

function heroCapture() {
  return (value, now, period, anchor, desks = ALL, todayUnits = [E('5000'), E('5000'), E('5000')], inputs = {}) => {
    const ix = value ? M.indexResults(value) : null, today = page.resultsToday(now);
    const view = { ix, today, trackingStart: ix?.meta.trackingStart, todayUnits, nowMs: Date.parse(now), ...inputs };
    const per = M.periodOf(period, anchor, today, view.trackingStart);
    const R = view.ix ? M.rollup(view.ix, per, desks, M.moneyContext(view.ix, view, per, desks)) : null;
    const before = globalThis.document, node = markupNode();
    globalThis.document = { querySelector: () => node };
    try { page.renderHero(view, per, desks, R); }
    finally {
      if (before === undefined) delete globalThis.document;
      else globalThis.document = before;
    }
    return { html: node.innerHTML, sentence: node.innerHTML.match(/<p class="say">([\s\S]*?)<\/p>/)[1] };
  };
}

test('JOED-83: the period base adds the exact prior after-fee rollup, including open movement', () => {
  const ix = M.indexResults(record([closeDay('2026-09-30', '5150.12345678')], [
    tradeOf('rt-prior', 'j', '2026-09-30T15:00:00.000Z', '100', '10'),
  ]));
  const per = M.periodOf('month', today, today, ix.meta.trackingStart);
  const inputs = ctxOf([E('5160.12845678'), E('5000'), E('5000')]);
  const R = M.rollup(ix, per, ALL, M.moneyContext(ix, inputs, per, ALL));
  assert.equal(R.units.net, E('10.005'));
  assert.equal(M.periodBase(ix, inputs, per, ALL), E('15150.12345678'));
  assert.equal(M.periodPercent(ix, inputs, per, ALL, R), percentOf(E('10.005'), E('15150.12345678')));
  assert.notEqual(M.periodBase(ix, inputs, per, ALL), E('15100'), 'closed trades alone omit open movement');
  const early = M.periodOf('month', '2026-09-10', today, ix.meta.trackingStart);
  assert.equal(M.periodBase(ix, inputs, early, ALL), STARTING_MONEY, 'before tracking there is no prior result');
});

test('JOED-83: All time equals Desk Since start on the same exact aggregate result', () => {
  const ix = M.indexResults(record([])), per = M.periodOf('all', today, today, ix.meta.trackingStart);
  for (const amount of ['150', '-150', '0.75']) {
    const net = E(amount), inputs = ctxOf([E('5000') + net, E('5000'), E('5000')]);
    const R = M.rollup(ix, per, ALL, M.moneyContext(ix, inputs, per, ALL));
    assert.equal(M.periodBase(ix, inputs, per, ALL), STARTING_MONEY);
    assert.equal(M.periodPercent(ix, inputs, per, ALL, R), sincePercent({
      'today.totalPnl': { state: 'fresh', value: eurOf(amount) },
    }));
  }
});

test('JOED-83: the percentage rounds once, half away from zero, without cent-rounding either input', () => {
  const ix = M.indexResults(record([closeDay('2026-09-30', '10000')]));
  const per = M.periodOf('month', today, today, ix.meta.trackingStart);
  for (const [net, want] of [['2.99999999', 1n], ['3', 2n], ['-2.99999999', -1n], ['-3', -2n]]) {
    const inputs = ctxOf([E('10000') + E(net), E('5000'), E('5000')]);
    const R = M.rollup(ix, per, ALL, M.moneyContext(ix, inputs, per, ALL));
    assert.equal(M.periodBase(ix, inputs, per, ALL), E('20000'));
    assert.equal(M.periodPercent(ix, inputs, per, ALL, R), want, net);
  }
});

test('JOED-83: individual desks, empty, cut, unknown and non-exact results omit the percentage', () => {
  const ix = M.indexResults(record([])), per = M.periodOf('all', today, today, ix.meta.trackingStart);
  const inputs = ctxOf([E('5150'), E('5000'), E('5000')]);
  const R = M.rollup(ix, per, ALL, M.moneyContext(ix, inputs, per, ALL));
  for (const desks of [['j'], ['joe'], ['joel'], ['j', 'joe'], ['j', 'j', 'joe']]) {
    assert.equal(M.periodBase(ix, inputs, per, desks), null);
    assert.equal(M.periodPercent(ix, inputs, per, desks, R), null);
  }
  for (const result of [null, { ...R, empty: true }, { ...R, cut: { desks: ['j'], at: 1 } },
    { ...R, net: null }, { ...R, units: { ...R.units, net: null } }, { ...R, units: { ...R.units, net: 150 } }]) {
    assert.equal(M.periodPercent(ix, inputs, per, ALL, result), null);
  }
  const unknown = ctxOf([null, E('5000'), E('5000')]);
  assert.equal(M.periodPercent(ix, unknown, per, ALL, M.rollup(ix, per, ALL, unknown)), null);
  assert.equal(M.periodBase(null, inputs, per, ALL), null);
});

test('JOED-83: an unknown, zero or negative base and a prior basis change omit the percentage', () => {
  const inputs = ctxOf([E('5100'), E('5000'), E('5000')]);
  for (const [j, joe, joel] of [[null, '5000', '5000'], ['0', '0', '0'], ['-0.01', '0', '0']]) {
    const ix = M.indexResults(record([closeDay('2026-09-30', j, joe, joel)]));
    const per = M.periodOf('month', today, today, ix.meta.trackingStart);
    const R = M.rollup(ix, per, ALL, M.moneyContext(ix, inputs, per, ALL));
    assert.equal(M.periodBase(ix, inputs, per, ALL), null);
    assert.equal(M.periodPercent(ix, inputs, per, ALL, R), null);
  }
  const ix = M.indexResults(record([closeDay('2026-09-30', '5000')]));
  const per = M.periodOf('month', today, today, ix.meta.trackingStart);
  const withCut = { ...inputs, cuts: [{ desk: 'j', at: Date.parse('2026-09-30T12:00:00Z') }] };
  const R = M.rollup(ix, per, ALL, M.moneyContext(ix, withCut, per, ALL));
  assert.equal(R.cut, null, 'the selected period itself is comparable');
  assert.equal(M.periodBase(ix, withCut, per, ALL), null, 'the aggregate prefix crosses a basis change');
  assert.equal(M.periodPercent(ix, withCut, per, ALL, R), null);
});

test('JOED-89: a tracking-start gap carries pre-tracking valued and unknown closes into the cached base', async t => {
  for (const unknown of [null, ...ALL]) await t.test(unknown ? `unknown ${unknown} close` : 'valued close', () => {
    const amounts = ALL.map(id => id === unknown ? null : id === 'j' ? '5100.12345678' : '5000');
    const ix = M.indexResults(record([closeDay('2026-09-11', ...amounts), closeDay('2026-09-21', '5200')], [], '2026-09-14'));
    const inputs = ctxOf(), per = M.periodOf('day', '2026-09-15', today, ix.meta.trackingStart);
    const want = unknown ? null : E('15100.12345678');
    assert.equal(priorRollupBase(ix, inputs, per, ALL), want, 'independent old rollup defines the expected base');
    assert.equal(M.periodBase(ix, inputs, per, ALL), want, 'the latest indexed date is still before tracking starts');
  });
});

test('JOED-89: tracking-start boundaries, sparse gaps and desk sets keep old-rollup base and percentage parity', () => {
  const trackingStart = '2026-09-14', inputs = ctxOf([E('5300'), E('5000'), E('5000')]);
  const deskSets = Array.from({ length: 8 }, (_, mask) => ALL.filter((_, i) => mask & (1 << i)));
  deskSets.push([...ALL].reverse(), ['j', 'j', 'joe']);
  const gaps = [[], ['2026-09-13'], [trackingStart], ['2026-09-13', trackingStart, '2026-09-16']];
  const amounts = [['5100.12345678', '5000', '5000'], [null, '5000', '5000'], ['5000', null, '5000'],
    ['5000', '5000', null], ['0', '0', '0'], ['-0.00000001', '0', '0']];
  for (const closes of amounts) for (const gap of gaps) {
    const days = [closeDay('2026-09-10', '5050'), closeDay('2026-09-11', ...closes),
      ...gap.map(date => ({ date, desks: {} })), closeDay('2026-09-21', '5200')];
    const trades = [tradeOf('rt-pre-tracking', 'j', '2026-09-12T15:00:00.000Z', '999.12345678')];
    const ix = M.indexResults(record(days, trades, trackingStart));
    for (const anchor of ['2026-09-10', '2026-09-13', trackingStart, '2026-09-15', '2026-09-17', '2026-09-21', '2026-09-22']) {
      for (const kind of ['day', 'week', 'month', 'ytd', 'all']) for (const desks of deskSets) {
        const per = M.periodOf(kind, anchor, today, trackingStart);
        const result = M.rollup(ix, per, desks, M.moneyContext(ix, inputs, per, desks));
        const label = `${closes.join(',')} gap=${gap.join(',')} ${kind} ${anchor} ${desks.join(',')}`;
        assert.equal(M.periodBase(ix, inputs, per, desks), priorRollupBase(ix, inputs, per, desks), label);
        assert.equal(M.periodPercent(ix, inputs, per, desks, result), priorRollupPercent(ix, inputs, per, desks, result), label);
      }
    }
    const recovered = M.periodOf('day', '2026-09-22', today, trackingStart);
    assert.equal(M.periodBase(ix, inputs, recovered, ALL), E('15200'), 'the next known close recovers the base');
    for (const anchor of ['2026-09-13', trackingStart]) {
      assert.equal(M.periodBase(ix, inputs, M.periodOf('day', anchor, today, trackingStart), ALL), STARTING_MONEY,
        'periods before or at tracking start retain the authoritative initial base');
    }
  }
});

test('JOED-89: cached bases and percentages equal the old rollup for the large budget fixture and every desk set', () => {
  const value = largeResults(), ix = M.indexResults(value);
  assert.equal(value.trades.length, 14000);
  assert.equal(value.days.length, 288);
  const inputs = ctxOf([E('4987.42'), E('4983.46'), E('5026.30')]);
  const deskSets = Array.from({ length: 8 }, (_, mask) => ALL.filter((_, i) => mask & (1 << i)));
  deskSets.push([...ALL].reverse(), ['j', 'j', 'joe']);
  const anchors = [M.addDays(ix.meta.trackingStart, -1), ix.meta.trackingStart, ...ix.dates, today, M.addDays(today, 1)];
  for (const anchor of anchors) for (const kind of ['day', 'week', 'month', 'ytd', 'all']) {
    const per = M.periodOf(kind, anchor, today, ix.meta.trackingStart);
    for (const desks of deskSets) {
      const result = M.rollup(ix, per, desks, M.moneyContext(ix, inputs, per, desks));
      const label = `${kind} ${anchor} ${desks.join(',')}`;
      assert.equal(M.periodBase(ix, inputs, per, desks), priorRollupBase(ix, inputs, per, desks), label);
      assert.equal(M.periodPercent(ix, inputs, per, desks, result), priorRollupPercent(ix, inputs, per, desks, result), label);
    }
  }
});

test('JOED-89: the exact prefix carries sparse closes, recovers from unknowns, transfers and belongs to one index', () => {
  const days = [closeDay('2026-09-11', '5000.00000001'), closeDay('2026-09-14', null),
    { date: '2026-09-15', desks: {} }, closeDay('2026-09-16', '100000000000.12345678', '-99999999999.99999999'),
    closeDay('2026-09-17', '-10000'), closeDay('2026-09-18', '-10000.00000001')];
  // A trade-only date also carries the latest close, not its realised result.
  const value = record(days, [tradeOf('rt-only', 'j', '2026-09-12T15:00:00.000Z', '123.45678901', '0.00000001')]);
  const ix = M.indexResults(value), copy = structuredClone(ix, { transfer: M.transferables(ix) });
  assert.deepEqual(copy.netPrefix, [E('0.00000001'), E('0.00000001'), null, null, E('-9999.87654321'), E('-15000'), E('-15000.00000001')]);
  const inputs = ctxOf([E('5001'), E('5000'), E('5000')]);
  for (let anchor = '2026-09-01'; anchor <= '2026-09-22'; anchor = M.addDays(anchor, 1)) {
    const per = M.periodOf('day', anchor, today, copy.meta.trackingStart);
    assert.equal(M.periodBase(copy, inputs, per, ALL), priorRollupBase(copy, inputs, per, ALL), anchor);
    const result = M.rollup(copy, per, ALL, M.moneyContext(copy, inputs, per, ALL));
    assert.equal(M.periodPercent(copy, inputs, per, ALL, result), priorRollupPercent(copy, inputs, per, ALL, result), anchor);
  }
  const per = M.periodOf('day', '2026-09-17', today, copy.meta.trackingStart);
  assert.equal(M.periodBase(copy, inputs, per, ALL), E('5000.12345679'), 'huge cancelling values keep every decimal');
  const replacement = M.indexResults(record([closeDay('2026-09-16', '5005')]));
  assert.equal(M.periodBase(replacement, inputs, per, ALL), E('15005'));
  assert.equal(M.periodBase(copy, inputs, per, ALL), E('5000.12345679'), 'a new record cannot reuse or overwrite the old prefix');
  const huge = M.indexResults(record([closeDay('2026-09-16', '100000000000.12345678')]));
  assert.equal(M.periodBase(huge, inputs, per, ALL), E('100000010000.12345678'), 'a base beyond 64-bit units does not wrap');
  assert.equal(M.periodBase(huge, inputs, per, ALL), priorRollupBase(huge, inputs, per, ALL));
});

test('JOED-89: repeated cached lookups recheck cuts, live money and the board date', () => {
  const ix = M.indexResults(record([closeDay('2026-09-30', '5000.12345678'), closeDay(today, '9000')]));
  const per = M.periodOf('month', today, today, ix.meta.trackingStart);
  const future = M.periodOf('day', M.addDays(today, 1), today, ix.meta.trackingStart);
  const inputs = ctxOf([E('5100.00000001'), E('5000'), E('5000')]);
  const variants = [inputs,
    { ...inputs, cuts: [{ desk: 'j', at: M.viennaMidnight('2026-09-30') }] },
    { ...inputs, cuts: [{ desk: 'joe', at: M.viennaMidnight('2026-10-01') }] },
    { ...inputs, todayUnits: [E('5200.00000002'), E('5000'), E('5000')] },
    { ...inputs, todayUnits: [null, E('5000'), E('5000')] },
    { ...inputs, today: '2026-09-30' },
    { ...inputs, today: '2026-09-09', todayUnits: [null, null, null] },
    { ...inputs, today: '2026-09-08' }, inputs];
  for (const current of variants) for (const selected of [per, future]) {
    assert.equal(M.periodBase(ix, current, selected, ALL), priorRollupBase(ix, current, selected, ALL));
    const result = M.rollup(ix, selected, ALL, M.moneyContext(ix, current, selected, ALL));
    assert.equal(M.periodPercent(ix, current, selected, ALL, result), priorRollupPercent(ix, current, selected, ALL, result));
  }
  assert.equal(M.periodBase(ix, inputs, per, ALL), E('15000.12345678'));
  assert.equal(M.periodBase(ix, inputs, future, ALL), E('15100.00000001'), 'a stored close never replaces live equity');
});

test('JOED-83: the hero keeps Desk signs/tones and reads the percentage with its period-start meaning', () => {
  const render = heroCapture(), now = '2026-10-14T17:42:22.000Z', value = record([]);
  for (const [net, text, tone] of [['150', '+1,00 %', 'gain'], ['-150', '−1,00 %', 'loss'], ['0.01', '0,00 %', '']]) {
    const { html } = render(value, now, 'all', today, ALL, [E('5000') + E(net), E('5000'), E('5000')]);
    const doc = htmlDocument(html), percent = doc.querySelector('.performance-pct');
    assert.equal(percent.textContent, text);
    assert.equal(percent.getAttribute('class'), `performance-pct${tone ? ` ${tone}` : ''}`);
    // JOED-151: the base is shown beside the percentage; its meaning stays spoken.
    assert.equal(doc.querySelector('.period-percent-slot .vh').textContent, ', the money at the period start');
    assert.equal(doc.querySelector('.period-percent-slot .of').textContent, 'of €\u00a015.000,00');
    assert.equal(doc.querySelector('.period-percent-slot .of').dataset.term, 'result');
    assert.equal(doc.querySelector('.result-figure').getAttribute('role'), 'group');
    assert.ok(doc.querySelector('.display .bn'));
  }
  for (const [source, desks, money, inputs] of [
    [null, ALL, [E('5000'), E('5000'), E('5000')], {}],
    [value, ['j'], [E('5150'), E('5000'), E('5000')], {}],
    [value, ALL, [E('5000'), E('5000'), E('5000')], {}],
    [value, ALL, [null, E('5000'), E('5000')], {}],
    [value, ALL, [E('5150'), E('5000'), E('5000')], { cuts: [{ desk: 'j', at: Date.parse(now) }] }],
  ]) {
    const doc = htmlDocument(render(source, now, 'all', today, desks, money, inputs).html);
    assert.equal(doc.querySelector('.performance-pct'), null);
    assert.equal(doc.querySelector('.period-percent-slot').textContent, '', 'keep only the empty geometry reserve');
  }
});

test('JOED-32 hero: only a sentence without a partial-day hint keeps its final full stop', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const dates = ['2026-10-14', '2026-10-15'];
  const { baseline: value } = periodHintResults(now);
  const baseline = render(value, now, 'month', '2026-10-16').sentence;
  assert.ok(baseline.endsWith('.'), 'the unhinted sentence keeps its full stop');
  for (const count of [0, 1, 2]) {
    const covered = structuredClone(value);
    for (const day of covered.days) if (dates.slice(0, count).includes(day.date)) {
      day.coverage = 'partial'; day.partialReasons = ['history_gap'];
    }
    const { html, sentence } = render(covered, now, 'month', '2026-10-16');
    assert.ok(sentence.startsWith(count ? baseline.slice(0, -1) + ' ' : baseline), 'only the final full stop changes');
    assert.equal((sentence.match(/class="st warn"/g) ?? []).length, count ? 1 : 0);
    assert.equal((html.match(/incl\./g) ?? []).length, count ? 1 : 0, 'the hero has only one hint');
    if (count) {
      assert.doesNotMatch(sentence, /·|\. <span class="st warn">/);
      assert.match(sentence, / <span class="st warn"><svg/);
      assert.match(sentence, /href="#i-half"/);
      assert.ok(textOf(sentence).endsWith(`incl. ${count} partial day${count === 1 ? '' : 's'}`));
    }
  }
  assert.doesNotMatch(render(null, now, 'month', '2026-10-16').sentence, /incl\./);
});

test('JOED-32 hero: empty periods say recorded only when they include counted partial days', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const full = record([closeDay('2026-09-30', '5000'), closeDay('2026-10-15', '5000')]);
  const partial = structuredClone(full);
  partial.days[1].coverage = 'partial';
  partial.days[1].partialReasons = ['history_gap'];
  for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    const sentence = textOf(render(partial, now, 'month', '2026-10-16', desks).sentence);
    assert.match(sentence, /^No trades recorded this month\. Paper results start on .+ incl\. 1 partial day$/);
    const plain = textOf(render(full, now, 'month', '2026-10-16', desks).sentence);
    assert.match(plain, /^No trades this month\. Paper results start on .+\.$/);
    assert.doesNotMatch(plain, /recorded|incl\./);
    assert.doesNotMatch(textOf(render(partial, now, 'day', '2026-10-16', desks).sentence), /recorded|incl\./,
      'partial days outside the selected period do not change the wording');
  }
});

test('JOED-32 hero: partial days with no closed trades keep the open-position gain or loss sentence', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  for (const [close, direction] of [['4999', 'Up'], ['5001', 'Down']]) {
    const days = [closeDay('2026-09-30', close, close, close), closeDay('2026-10-15', close, close, close)];
    const full = record(days), partial = structuredClone(full);
    partial.days[1].coverage = 'partial';
    partial.days[1].partialReasons = ['history_gap'];
    for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
      const { html, sentence } = render(partial, now, 'month', '2026-10-16', desks);
      const amount = fmt.eur(E(desks.length));
      assert.equal(textOf(sentence), `${direction} ${amount} this month incl. 1 partial day`);
      assert.doesNotMatch(html.match(/<div class="display">([\s\S]*?)<\/div>/)[1], /muted/,
        'open-position movement keeps its hero number');
      const plain = textOf(render(full, now, 'month', '2026-10-16', desks).sentence);
      assert.equal(plain, `${direction} ${amount} this month.`);
    }
  }
  const { partial } = periodHintResults(now);
  assert.doesNotMatch(textOf(render(partial, now, 'month', '2026-10-16').sentence), /No trades/,
    'traded periods keep their result sentence');
});

test('JOED-32 hero: unknown-money explanations never carry a partial-day hint', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const full = record([closeDay('2026-09-30', null, null, null), closeDay('2026-10-15', null, null, null)]);
  const partial = structuredClone(full);
  partial.days[1].coverage = 'partial';
  partial.days[1].partialReasons = ['history_gap'];
  for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    const plain = textOf(render(full, now, 'month', '2026-10-16', desks).sentence);
    assert.equal(plain, 'The result this month is not known yet: the desks’ money now is not available.');
    assert.equal(textOf(render(partial, now, 'month', '2026-10-16', desks).sentence), plain);
    const olderWeek = 'The result in the week of 21\u00a0Sep is not known yet: the desks’ money on Sun 27\u00a0Sep is not available.';
    for (const coverage of [false, true]) {
      const value = record([{ ...closeDay('2026-09-27', null, null, null), ...(coverage ? { coverage: 'partial', partialReasons: ['history_gap'] } : {}) }]);
      assert.equal(textOf(render(value, now, 'week', '2026-09-21', desks).sentence), olderWeek);
    }
  }
});

test('JOED-32 hero: basis-change explanations never carry a partial-day hint', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const { baseline, partial } = periodHintResults(now);
  for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    const cuts = desks.map(desk => ({ desk, at: Date.parse('2026-10-14T10:00:00.000Z') }));
    const sentences = [baseline, partial].map(value => textOf(render(value, now, 'month', '2026-10-16', desks, undefined, { cuts }).sentence));
    const who = desks.length === 3 ? 'J, Joe and Joel' : { j: 'J', joe: 'Joe', joel: 'Joel' }[desks[0]];
    assert.equal(sentences[0], `No result this month: ${who}’s bookkeeping basis changed on Wed 14\u00a0Oct, and a change of basis is not a gain or a loss.`);
    assert.equal(sentences[1], sentences[0], 'partial dates do not qualify a basis-change explanation');
  }
});

test('JOED-32 hero: unavailable records never carry a partial-day hint', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const { baseline, partial } = periodHintResults(now);
  const plain = render(null, now, 'month', '2026-10-16').sentence;
  assert.match(textOf(plain), /^Results are unavailable: .+\.$/);
  assert.doesNotMatch(plain, /incl\./);
  for (const value of [baseline, partial]) for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    assert.equal(render(value, now, 'month', '2026-10-16', desks, undefined, { ix: null }).sentence, plain,
      'an unavailable source cannot expose coverage from its retained record');
  }
});

test('JOED-32 count: Day, Week, Month, This year and All use the selected inclusive Vienna range', t => {
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z', today = page.resultsToday(now);
  const value = record(['2025-12-31', '2026-01-01', '2026-09-30', '2026-10-01', '2026-10-11', '2026-10-14', '2026-10-15', today, '2026-10-17']
    .map(date => ({ date, desks: {}, coverage: 'partial', ...(date < today ? { partialReasons: ['history_gap'] } : {}) })), [], '2025-12-01');
  const ix = M.indexResults(value);
  for (const [period, anchor, count] of [['day', today, 0], ['day', '2026-10-15', 1], ['day', '2026-10-13', 0],
    ['week', today, 2], ['week', '2026-10-11', 1], ['month', today, 4], ['month', '2026-09-30', 1], ['ytd', today, 6], ['all', today, 7]]) {
    const per = M.periodOf(period, anchor, today, ix.meta.trackingStart);
    assert.equal(M.countPartialDays(ix, per, today), count, `${period} ${anchor}`);
    for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
      const { sentence } = render(value, now, period, anchor, desks);
      assert.equal(sentence.includes('incl.'), count >= 1, `${period} ${anchor} ${desks}`);
      if (count) assert.ok(textOf(sentence).endsWith(`incl. ${count} partial day${count === 1 ? '' : 's'}`));
    }
  }
});

test('JOED-32 hero and month counts agree: escalated and empty partials count; missing-summary Stale and today do not', t => {
  const calendar = calendarCapture(t), hero = heroCapture(t);
  const { partial } = partialDaysResults(), now = '2026-10-16T12:00:00.000Z';
  partial.missingDays = missingResultsDays(partial, now);
  for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    const cal = calendar(partial, now, '2026-10-15', desks);
    const result = hero(partial, now, 'month', '2026-10-16', desks);
    assert.equal(result.sentence.match(/incl\. \d+ partial days?/)[0], cal.month.match(/incl\. \d+ partial days?/)[0]);
    assert.match(result.sentence, /incl\. 3 partial days/);
    assert.match(cal.cell('2026-10-14'), /<span class="n">Stale<\/span>/);
    assert.match(cal.cell('2026-10-11'), /<span class="n">Stale<\/span>/);
    if (desks.includes('j')) assert.match(cal.cell('2026-10-13'), /daily summary missing/);
    assert.doesNotMatch(hero(partial, now, 'day', '2026-10-13', desks).sentence, /incl\./);
  }
});

test('JOED-32 hero: Vienna midnight closes partial dates across DST and the year boundary', t => {
  const render = heroCapture(t);
  for (const [day, before, after] of [
    ['2026-10-25', '2026-10-25T22:59:59.999Z', '2026-10-25T23:00:00.000Z'],
    ['2026-12-31', '2026-12-31T22:59:59.999Z', '2026-12-31T23:00:00.000Z'],
  ]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial' }]);
    assert.doesNotMatch(render(value, before, 'day', day).sentence, /incl\./);
    assert.match(render(value, after, 'day', day).sentence, /incl\. 1 partial day/);
    assert.match(render(value, after, 'all', day).sentence, /incl\. 1 partial day/);
  }
});

test('JOED-32 browser snapshots: valid ingress, two closed partial dates and real long-sentence paths', t => {
  const { baseline, partial, empty, unknown } = periodHintResults();
  for (const value of [baseline, partial, empty, unknown]) {
    const checked = validateContract('results', value, { stage: 'ingress', receivedAt: value.generatedAt });
    assert.ok(checked.ok, JSON.stringify(checked.errors));
    assert.equal(preflightSnapshot('results', value, null, value.generatedAt).status, 200);
    for (const day of value.days) if (day.coverage === 'partial' && day.date < page.resultsToday(value.generatedAt)) {
      assert.ok(day.partialReasons?.length, `${day.date}: a closed partial day carries a reason`);
    }
  }
  assert.deepEqual(partial.trades, baseline.trades);
  assert.deepEqual(partial.days.map(d => Object.values(d.desks).map(d => d.equityClose)), baseline.days.map(d => Object.values(d.desks).map(d => d.equityClose)));
  assert.equal(M.countPartialDays(M.indexResults(baseline), M.periodOf('month', '2026-10-16', '2026-10-16'), '2026-10-16'), 0);
  assert.equal(M.countPartialDays(M.indexResults(partial), M.periodOf('month', '2026-10-16', '2026-10-16'), '2026-10-16'), 2);
  const render = heroCapture(t), now = '2026-10-16T12:00:00.000Z';
  const todayUnits = scenario(now).snapshot.desks.map(d => E(d.money.equity.amount));
  assert.equal(empty.trades.length, 0);
  assert.equal(empty.trackingStart, '2026-09-30');
  for (const day of empty.days) assert.deepEqual(ALL.map(id => E(day.desks[id].equityClose.amount)), todayUnits);
  assert.equal(textOf(render(empty, now, 'month', '2026-10-16', ALL, todayUnits).sentence),
    'No trades recorded this month. Paper results start on 30\u00a0Sep 2026 incl. 2 partial days');
  assert.match(textOf(render(unknown, now, 'month', '2026-10-16').sentence), /^The result this month is not known yet: .+\.$/);
  assert.doesNotMatch(render(unknown, now, 'month', '2026-10-16').sentence, /incl\./);
});

test('JOED-32 hero warning: the existing warn token exceeds 3:1 on both neutral theme surfaces', () => {
  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  const luminance = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0);
  for (const block of [css.match(/:root \{([^}]+)\}/)[1], css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1]]) {
    const palette = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\b/gi)].map(m => [m[1], m[2]]));
    for (const background of [palette.surface, palette.canvas]) {
      const x = luminance(palette.warn), y = luminance(background);
      assert.ok((Math.max(x, y) + .05) / (Math.min(x, y) + .05) >= 3);
    }
  }
});

test('JOED-31 copy: remove soft hyphens, normalize NBSP and preserve all other characters exactly', () => {
  const selected = 'DEMO · Demonstration\u00a0company\r\n−€\u00a01.000.000,12\nÜberraschung\t𐐀 & <name> - ‐ ‑ –\u200b';
  const plain = 'DEMO · Demonstration company\r\n−€ 1.000.000,12\nÜberraschung\t𐐀 & <name> - ‐ ‑ –\u200b';
  assert.equal(page.stripSoftHyphens('\u00ad' + selected.replace('Demonstration', 'Dem\u00adons\u00adtra\u00adtion') + '\u00ad\u00ad'), plain);
  assert.equal(page.stripSoftHyphens(selected), plain);
  assert.equal(page.stripSoftHyphens(plain), plain);
  assert.equal(page.stripSoftHyphens(''), '');
  assert.equal(page.stripSoftHyphens('\u00ad\u00ad'), '');
});

test('JOED-31 copy: only intercept a nonempty selection wholly inside the detail surface', () => {
  const inside = {}, outside = {}, writes = [];
  const selection = { rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ commonAncestorContainer: inside }),
    toString: () => 'Dem\u00adonstration\n−€\u00a012,34' };
  const event = { currentTarget: { ownerDocument: { getSelection: () => selection }, contains: node => node === inside },
    clipboardData: { setData: (...args) => writes.push(args) }, preventDefault: () => writes.push('prevented') };
  page.copyDayText(event);
  assert.deepEqual(writes, [['text/plain', 'Demonstration\n−€ 12,34'], 'prevented']);
  writes.length = 0;
  for (const ranges of [[outside], [inside, outside], []]) {
    selection.rangeCount = ranges.length;
    selection.getRangeAt = i => ({ commonAncestorContainer: ranges[i] });
    page.copyDayText(event);
  }
  selection.rangeCount = 1; selection.getRangeAt = () => ({ commonAncestorContainer: inside });
  selection.isCollapsed = true; page.copyDayText(event);
  selection.isCollapsed = false; page.copyDayText({ ...event, clipboardData: null });
  page.copyDayText({ ...event, currentTarget: { ...event.currentTarget, ownerDocument: { getSelection: () => null } } });
  assert.deepEqual(writes, []);
});

test('JOED-31 rendering: exact extreme amounts and prices survive whole-word names and atomic meta units', t => {
  const { date, record: value } = tradeAmountResults();
  assert.equal(validateContract('results', value, { stage: 'ingress' }).ok, true);
  assert.equal(M.dayResult(M.indexResults(value), date, ALL).units, E('-99987.91'));
  const render = calendarCapture(t), r = render(value, '2026-10-16T12:00:00.000Z', date);
  for (const html of [r.panel, r.sheet]) {
    assert.ok(textOf(html).includes('−€ 1.000.000,12'));
    assert.ok(textOf(html).includes('$ 102.000,12345678'));
    assert.ok(textOf(html).includes('$ 2.000,12345678'));
    assert.ok(textOf(html).includes('Demonstration company with a long name'));
    assert.equal((html.match(/<div class="name" lang="en"><b class="word">DEMO<\/b> · /g) ?? []).length, 4);
    assert.equal((html.match(/class="meta-unit"/g) ?? []).length, 16);
    assert.match(html.replaceAll('\u00ad', ''), /<span class="word">Demonstration<\/span> <span class="word">company<\/span>/);
    assert.equal((html.match(/class="meta-sep" aria-hidden="true"> ·<\/span><\/span> <span class="meta-unit">/g) ?? []).length, 12);
    assert.match(html, /<span class="meta-unit">closed 17:02<span class="meta-sep" aria-hidden="true"> ·<\/span><\/span> <span class="meta-unit">held 1 h 2 min<\/span>/);
  }
});

test('JOED-31 rendering: long company words have deterministic soft hyphens and at least three source letters per fragment', t => {
  const cases = [
    ['abcdefgh', 'abc\u00addefgh'],
    ['abcdefghi', 'abc\u00addef\u00adghi'],
    ['abcdefghij', 'abc\u00addef\u00adghij'],
    ['Demonstration', 'Dem\u00adons\u00adtra\u00adtion'],
    ['Überraschung', 'Übe\u00adrra\u00adsch\u00adung'],
    ['𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇', '𐐀𐐁𐐂\u00ad𐐃𐐄𐐅𐐆𐐇'],
  ];
  const words = [...cases.map(([source]) => source), ...Array.from({ length: 25 }, (_, i) => 'A'.repeat(i + 8))];
  const { date, record: value } = tradeAmountResults();
  value.trades.forEach(trade => { trade.company = words.join(' '); });
  const render = calendarCapture(t), r = render(value, '2026-10-16T12:00:00.000Z', date);
  for (const html of [r.panel, r.sheet]) {
    const names = [...html.matchAll(/<div class="name"[^>]*>([\s\S]*?)<span class="meta">/g)];
    assert.equal(names.length, 4);
    assert.ok(!html.replace(/<span class="word">[^<]*<\/span>/g, '').includes('\u00ad'), 'only company tokens contain soft hyphens');
    for (const [, name] of names) {
      const tokens = [...name.matchAll(/<span class="word">([^<]*)<\/span>/g)].map(([, text]) => text);
      assert.deepEqual(tokens.slice(0, cases.length), cases.map(([, expected]) => expected));
      assert.deepEqual(tokens.map(text => text.replaceAll('\u00ad', '')), words);
      for (const token of tokens) {
        const fragments = token.split('\u00ad');
        assert.ok(fragments.length > 1, token);
        assert.ok(fragments.every(fragment => [...fragment].length >= 3), token);
      }
    }
  }
  assert.equal(value.trades[0].company, words.join(' '), 'the recorded company text is unchanged');
});

test('JOED-31 rendering: short words, symbols, numbers and meta units never gain soft hyphens', t => {
  const { date, record: value } = tradeAmountResults();
  const company = 'A BB CCC DDDD EEEEE FFFFFF company 1234567890';
  value.trades.forEach(trade => { trade.company = company; trade.symbol = 'LONGSYMBOL'; });
  const render = calendarCapture(t), r = render(value, '2026-10-16T12:00:00.000Z', date);
  for (const html of [r.panel, r.sheet]) {
    assert.ok(!html.includes('\u00ad'));
    assert.equal((html.match(/<b class="word">LONGSYMBOL<\/b>/g) ?? []).length, 4);
    assert.equal(textOf(html).split(company).length - 1, 4);
    assert.ok(textOf(html).includes('Long 10'));
    assert.ok(textOf(html).includes('closed 17:02'));
    assert.ok(textOf(html).includes('held 1 h 2 min'));
    assert.ok(textOf(html).includes('$ 102.000,12345678'));
  }
});

test('JOED-119 rendering: accepted company separators round-trip and render in panel and sheet', t => {
  const companies = ['Acme\u001fHoldings', '"Acme" \\ \u0000\n& <name> 𐐀', undefined];
  const trades = companies.map((company, i) => {
    const trade = tradeOf(`rt-company-${i}`, 'j', '2026-10-13T15:00:00.000Z', '0');
    if (company === undefined) delete trade.company;
    else trade.company = company;
    return trade;
  });
  const value = record([closeDay('2026-10-13', '5000')], trades);
  const rendered = calendarCapture(t)(value, '2026-10-14T12:00:00.000Z', '2026-10-13');
  const ix = M.indexResults(value);
  const copy = structuredClone(ix, { transfer: M.transferables(ix) });
  for (const [i, source] of trades.entries()) {
    const decoded = M.trade(copy, i);
    assert.equal(decoded.id, source.id);
    assert.equal(decoded.company, source.company ?? null);
    assert.equal(decoded.side, source.side);
    assert.equal(decoded.quantity, source.quantity);
    assert.deepEqual(decoded.entry, source.entryPrice);
    assert.deepEqual(decoded.exit, source.exitPrice);
  }
  for (const html of [rendered.panel, rendered.sheet]) {
    assert.equal((html.match(/class="trow"/g) ?? []).length, trades.length);
    assert.ok(textOf(html).includes(companies[0]));
    assert.ok(html.includes('&lt;name&gt;'));
    assert.ok(!html.includes('<name>'));
    assert.ok(textOf(html).includes('$ 70,00'));
  }
});

test('JOED-119 rendering: sub-cent execution prices retain their recorded precision', t => {
  const trade = tradeOf('rt-sub-cent', 'j', '2026-10-13T15:00:00.000Z', '1');
  trade.quantity = '1000';
  trade.entryPrice.amount = '0.003';
  trade.exitPrice.amount = '0.004';
  trade.fx.rate = '1';
  const value = record([closeDay('2026-10-13', '5001')], [trade]);
  assert.equal(M.grossFromFx(trade), E('1'));
  const rendered = calendarCapture(t)(value, '2026-10-14T12:00:00.000Z', '2026-10-13');
  for (const html of [rendered.panel, rendered.sheet]) {
    const prices = html.match(/<div class="px">[\s\S]*?<\/div>/)[0];
    assert.ok(textOf(prices).includes('$ 0,003'), prices);
    assert.ok(textOf(prices).includes('$ 0,004'), prices);
    assert.ok(textOf(html).includes('+€ 1,00'));
  }
});

test('JOED-119 money: zero suppression follows requested precision with exact half-away rounding', () => {
  for (const [amount, d, expected] of [
    ['0.003', 3, '+$ 0,003'], ['-0.004', 3, '−$ 0,004'],
    ['0.00000001', 8, '+$ 0,00000001'], ['-0.00000001', 8, '−$ 0,00000001'],
    ['0.00049999', 3, '$ 0,000'], ['-0.00049999', 3, '$ 0,000'],
    ['0.0005', 3, '+$ 0,001'], ['-0.0005', 3, '−$ 0,001'],
    ['0.49', 0, '$ 0'], ['-0.49', 0, '$ 0'], ['0.5', 0, '+$ 1'], ['-0.5', 0, '−$ 1'],
  ]) assert.equal(fmt.money(E(amount), 'USD', true, d), expected, `${amount} at ${d} decimals`);
  for (const n of [E('0.004'), E('-0.004'), 0.004, -0.004]) {
    assert.equal(fmt.money(n, 'USD', true), '$ 0,00', 'default two-decimal behavior');
    assert.equal(fmt.money(n, 'USD', true, 3), n < 0 ? '−$ 0,004' : '+$ 0,004');
  }
});

test('JOED-31 rendering: company tokens preserve spacing and escape markup in panel and sheet', t => {
  const { date, record: value } = tradeAmountResults();
  value.trades[2].company = 'First  <script> & "company"';
  const render = calendarCapture(t), r = render(value, '2026-10-16T12:00:00.000Z', date);
  for (const html of [r.panel, r.sheet]) {
    assert.ok(html.includes('<span class="word">First</span>  <span class="word">&lt;script&gt;</span>'));
    assert.ok(html.includes('<span class="word">&amp;</span>'));
    assert.ok(html.includes('<span class="word">&quot;company&quot;</span>'));
    assert.ok(!html.includes('<script>'));
  }
});

test('JOED-30 rendering: closed partial trades keep their exact amount, tint and one warning in every day view', t => {
  const render = calendarCapture(t), value = fixture('partial-day');
  let r = render(value, '2026-10-15T12:00:00.000Z', '2026-10-14');
  const cell = r.cell('2026-10-14');
  assert.match(cell, /class="cell l[1-4]\b/);
  assert.match(cell, /class="day-warning st"[^>]*>[\s\S]*href="#i-half"/);
  assert.equal((cell.match(/class="day-warning/g) ?? []).length, 1);
  assert.match(cell, /<span class="n">Partial<\/span>/);
  assert.match(textOf(cell), /−1,00/);
  assert.match(cell.replaceAll('&#39;', "'"), /−€ 1,00 from 1 trade; Partial: this day's record is incomplete/);
  assert.ok(cell.includes(fmt.esc(partialReason)), 'the accessible label and tooltip carry the reason');
  for (const html of [r.panel, r.sheet]) {
    assert.match(textOf(html), /Partial · 1 trade · −€ 1,00 so far/);
    assert.match(html, /class="st warn"[^>]*>[\s\S]*href="#i-half"/);
    assert.ok(textOf(html).includes(partialReason));
    assert.equal((html.match(/class="trow"/g) ?? []).length, 1);
    assert.match(html, /class="dp-note">[\s\S]*href="#i-info"/);
  }
  // Coverage is day-wide: filtering to a desk without visible trades cannot
  // claim that desk sat out when the day's record is incomplete.
  r = render(value, '2026-10-15T12:00:00.000Z', '2026-10-14', ['joe']);
  assert.match(r.cell('2026-10-14'), /class="cell none\b/);
  assert.match(textOf(r.sheet), /Partial · record incomplete/);
  assert.doesNotMatch(textOf(r.sheet), /[Nn]o trades|sat out|€/);
});

test('JOED-30 rendering: a partial date with no trades is a neutral dash and incomplete record, including weekends', t => {
  const render = calendarCapture(t);
  for (const day of ['2026-10-13', '2026-10-25']) {
    // Accepted while open; the retained record still renders its fallback
    // after midnight without pretending a cause was supplied at acceptance.
    const value = record([{ date: day, desks: {}, coverage: 'partial' }], [], '2026-09-10', `${day}T12:00:00.000Z`);
    const r = render(value, `${M.addDays(day, 1)}T12:00:00.000Z`, day), cell = r.cell(day);
    assert.match(cell, /class="cell none\b/);
    assert.match(cell, /<span class="v"><span class="muted">—<\/span><\/span>/);
    assert.match(cell, /<span class="n">Partial<\/span>/);
    assert.match(cell, /class="day-warning st warn"/);
    assert.match(cell, /\bday-incomplete\b/);
    assert.match(cell.replaceAll('&#39;', "'"), /no complete record; Partial: this day's record is incomplete/);
    assert.doesNotMatch(cell, /class="cell (?:g|l|flat|we)|class="pl"|[Nn]o trades|sat out|€|>0</);
    for (const html of [r.panel, r.sheet]) {
      assert.match(textOf(html), /Partial · record incomplete/);
      assert.ok(textOf(html).includes(partialReason));
      assert.doesNotMatch(textOf(html), /[Nn]o trades|sat out|€|\b0\b|so far/);
    }
  }
});

test('JOED-30 rendering: Stale wins over partial coverage in the cell, panel and phone sheet', t => {
  const render = calendarCapture(t), value = fixture('partial-day');
  value.missingDays = ['2026-10-14'];
  const r = render(value, '2026-10-16T12:00:00.000Z', '2026-10-14'), cell = r.cell('2026-10-14');
  assert.equal((cell.match(/class="day-warning/g) ?? []).length, 1);
  assert.match(cell, /<span class="n">Stale<\/span>/);
  assert.match(cell, /Stale: daily summary missing/);
  assert.doesNotMatch(textOf(cell), /Partial|incomplete/);
  for (const html of [r.panel, r.sheet]) {
    assert.match(textOf(html), /Stale · 1 trade · −€ 1,00/);
    assert.match(textOf(html), /Daily summary missing\./);
    assert.doesNotMatch(textOf(html), /Partial|incomplete/);
  }
});

test('JOED-30 browser snapshots: each partial, empty, Stale handoff, worst amount and empty month is valid ingress', () => {
  const { dates, ...snapshots } = partialDaysResults();
  for (const [name, payload] of Object.entries(snapshots)) {
    const checked = validateContract('results', payload, { stage: 'ingress', receivedAt: payload.generatedAt });
    assert.ok(checked.ok, `${name}: ${JSON.stringify(checked.errors)}`);
    assert.equal(preflightSnapshot('results', payload, null, payload.generatedAt).status, 200, name);
  }
  assert.equal(M.dayResult(M.indexResults(snapshots.large), dates.partial, ALL).count, 99);
  assert.equal(M.dayResult(M.indexResults(snapshots.large), dates.partial, ALL).units, E('-999999.99'));
  assert.equal(snapshots.empty.days.find(d => d.date === dates.partial).coverage, 'partial');
  assert.equal(M.dayResult(M.indexResults(snapshots.empty), dates.partial, ALL).count, 0);
});

test('browser preflight: rejects closed reasonless fixtures and replays before any page wait', () => {
  const { receivedAt, record } = retainedPartialResults();
  const open = preflightSnapshot('results', record, null, receivedAt);
  const closedAt = '2026-10-15T22:00:00.000Z';
  assert.throws(() => preflightSnapshot('results', record, null, closedAt), /partialReasonsRequired/);
  assert.throws(() => preflightSnapshot('results', record, open, receivedAt), /sequenceReplayed/);
  const intentional = preflightSnapshot('results', record, open, receivedAt, { status: 422, reason: 'sequence_replayed' });
  assert.equal(intentional.value, open.value);
  const unknown = structuredClone(record);
  unknown.days.at(-1).partialReasons = ['future_reason'];
  assert.throws(() => preflightSnapshot('results', unknown, null, receivedAt), /enum/);
});

test('browser default-line fixture: accepted while open, readable and rendered after Vienna midnight', t => {
  const { receivedAt, record } = retainedPartialResults();
  const accepted = preflightSnapshot('results', record, null, receivedAt);
  const now = '2026-10-16T12:00:00.000Z';
  assert.ok(validateContract('results', accepted.value).ok);
  const read = acceptRead('results', { status: 200, payload: accepted.value }, null);
  assert.equal(read.value.receivedAt, receivedAt);
  const r = calendarCapture(t)(read.value, now, '2026-10-15');
  for (const html of [r.panel, r.sheet]) {
    assert.match(textOf(html), /Partial/);
    assert.ok(textOf(html).includes(M.PARTIAL_REASON));
    assert.doesNotMatch(html, /dp-note-lead|dp-reason/);
  }
});

test('JOED-30 rendering: only closed Vienna dates show partial, across midnight and the autumn DST boundary', t => {
  const render = calendarCapture(t);
  for (const [day, open, closed] of [
    ['2026-10-14', '2026-10-14T21:59:59.999Z', '2026-10-14T22:00:00.000Z'],
    ['2026-10-25', '2026-10-25T22:59:59.999Z', '2026-10-25T23:00:00.000Z'],
  ]) for (const hasTrades of [false, true]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial' }], hasTrades ? [tradeOf('rt-boundary', 'j', `${day}T14:00:00.000Z`, '1.005')] : []);
    const r = render(value, open, day);
    assert.match(r.cell(day), /\btoday\b/);
    assert.doesNotMatch(r.cell(day), /Partial|day-warning|incomplete/);
    assert.doesNotMatch(r.panel + r.sheet, />Partial</);
    if (hasTrades) assert.match(textOf(r.panel), /so far/);
    const later = render(value, closed, day);
    assert.match(later.cell(day), /day-warning/);
    assert.match(textOf(later.sheet), hasTrades ? /Partial · 1 trade · \+€ 1,01/ : /Partial · record incomplete/);
    const ahead = render(value, `${M.addDays(day, -1)}T12:00:00.000Z`, day);
    assert.match(ahead.cell(day), /class="cell fut\b/);
    assert.doesNotMatch(ahead.cell(day), /Partial|day-warning/);
  }
});

test('JOED-30 rendering: T+1 becomes Stale at Vienna D+2, across autumn DST and month/year boundaries', t => {
  const render = calendarCapture(t);
  for (const [day, before, after] of [
    ['2026-10-24', '2026-10-25T22:59:59.999Z', '2026-10-25T23:00:00.000Z'],
    ['2026-10-25', '2026-10-26T22:59:59.999Z', '2026-10-26T23:00:00.000Z'],
    ['2026-10-31', '2026-11-01T22:59:59.999Z', '2026-11-01T23:00:00.000Z'],
    ['2026-12-31', '2027-01-01T22:59:59.999Z', '2027-01-01T23:00:00.000Z'],
  ]) for (const hasTrades of [false, true]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial' }],
      hasTrades ? [tradeOf('rt-escalate', 'j', `${day}T14:00:00.000Z`, '-12.4')] : []);
    const partial = render(value, before, day), stale = render(value, after, day);
    assert.match(partial.cell(day), /<span class="n">Partial<\/span>/);
    assert.match(partial.month, /incl\. 1 partial day/);
    assert.match(stale.cell(day), /<span class="n">Stale<\/span>/);
    assert.equal((stale.cell(day).match(/class="day-warning/g) ?? []).length, 1);
    assert.ok(stale.cell(day).includes(fmt.esc(`Stale: still incomplete; ${partialReason}`)));
    assert.match(stale.month, /incl\. 1 partial day/);
    for (const html of [stale.panel, stale.sheet]) {
      assert.match(textOf(html), hasTrades ? /Stale · 1 trade · −€ 12,40 so far/ : /Stale · record incomplete/);
      assert.ok(textOf(html).includes(partialReason));
      assert.doesNotMatch(html, /Daily summary missing|sat out/);
    }
    assert.equal(stale.cell(day).match(/class="cell ([^ ]+)/)[1], partial.cell(day).match(/class="cell ([^ ]+)/)[1]);
  }
});

test('JOED-30 rendering: missing summary hands off to Partial without changing the amount or cell slots', t => {
  const render = calendarCapture(t), day = '2026-10-15';
  const value = record([], [tradeOf('rt-handoff', 'j', `${day}T14:00:00.000Z`, '-1')]);
  value.missingDays = [day];
  const stale = render(value, '2026-10-16T12:00:00.000Z', day);
  assert.match(stale.cell(day), /Stale: daily summary missing/);
  value.days.push({ date: day, desks: {}, coverage: 'partial' });
  value.missingDays = [];
  const partial = render(value, '2026-10-16T12:00:00.000Z', day);
  assert.match(partial.cell(day), /<span class="n">Partial<\/span>/);
  assert.doesNotMatch(partial.cell(day), /Stale/);
  for (const slot of ['d', 'v']) assert.equal(partial.cell(day).match(new RegExp(`<span class="${slot}">[\\s\\S]*?<span class="${slot === 'd' ? 'day-warning' : 'n'}`))?.[0],
    stale.cell(day).match(new RegExp(`<span class="${slot}">[\\s\\S]*?<span class="${slot === 'd' ? 'day-warning' : 'n'}`))?.[0]);
  assert.equal((partial.cell(day).match(/class="day-warning/g) ?? []).length, 1);
});

test('JOED-30 month summary: every closed partial date counts, including escalated dates, with unknown/no-trade wording', t => {
  const render = calendarCapture(t);
  const value = record(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']
    .map(date => ({ date, desks: {}, coverage: 'partial' })));
  let r = render(value, '2026-10-16T12:00:00.000Z', '2026-10-15');
  assert.equal(textOf(r.month), 'No trades recorded this month incl. 2 partial days');
  assert.match(r.month, / <span class="st warn">/);
  assert.doesNotMatch(r.month, /·/);
  assert.doesNotMatch(r.html, /incl\.|so far/);
  value.missingDays = ['2026-10-15'];
  value.trades.push(tradeOf('rt-partial-count', 'j', '2026-10-15T14:00:00.000Z', '-0.03'));
  r = render(value, '2026-10-16T12:00:00.000Z', '2026-10-15');
  assert.match(r.month, /incl\. 2 partial days/, 'coverage still counts if the marker is Stale');
  value.missingDays = [];
  r = render(value, '2026-10-16T12:00:00.000Z', '2026-10-15');
  assert.match(r.month, /Down € 0,03/);
  assert.match(r.month, /class="month-long">over 1 trading day/);
  assert.match(r.month, /class="month-short">in 1 day/);
  assert.match(r.month, /incl\. 2 partial days/);
  assert.doesNotMatch(r.month, /·/);
  const singular = render(record([{ date: '2026-10-15', desks: {}, coverage: 'partial' }]), '2026-10-16T12:00:00.000Z', '2026-10-15');
  assert.equal(textOf(singular.month), 'No trades recorded this month incl. 1 partial day');
  assert.match(singular.month, / <span class="st warn"><svg[^>]*><use href="#i-half"\/><\/svg><span>incl\. 1 partial day<\/span><\/span>$/);
  const empty = render(record([]), '2026-10-16T12:00:00.000Z', '2026-10-15');
  assert.equal(empty.month, 'No trades this month');
});

test('JOED-30 partial icon: inherited tint ink and neutral warn are at least 3:1 in both theme token sets', t => {
  const render = calendarCapture(t), css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\b/gi)].map(m => [m[1], m[2]]));
  const light = tokens(css.match(/:root \{([^}]+)\}/)[1]);
  const dark = tokens(css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1]);
  const luminance = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const [cls, net] of [['g1', '1'], ['g2', '300'], ['g3', '600'], ['g4', '1000'],
    ['l1', '-1'], ['l2', '-300'], ['l3', '-600'], ['l4', '-1000'], ['flat', '0'], ['none', null]]) {
    const value = record([{ date: '2026-10-15', desks: {}, coverage: 'partial' }], [
      tradeOf('rt-max-tint', 'j', '2026-10-14T14:00:00.000Z', '1000'),
      ...(net === null ? [] : [tradeOf('rt-partial-tint', 'j', '2026-10-15T14:00:00.000Z', net)]),
    ]);
    const cell = render(value, '2026-10-16T12:00:00.000Z', '2026-10-15').cell('2026-10-15');
    assert.match(cell, new RegExp(`class="cell ${cls}\\b`));
    assert.match(cell, new RegExp(`class="day-warning st${cls === 'none' ? ' warn' : ''}"`));
    for (const [theme, palette] of [['light', light], ['dark', dark]]) {
      const foreground = palette[cls === 'none' ? 'warn' : 'ink'];
      for (const background of cls === 'none' ? [palette.surface, palette.canvas] : [palette[cls]])
        assert.ok(contrast(foreground, background) >= 3, `${theme} ${cls}: ${contrast(foreground, background)}`);
    }
  }
  assert.match(css, /\.cell\.day-incomplete \.n \{ color: var\(--ink\); \}/, 'the neutral Partial note uses full ink');
});

test('JOED-30 partial summary: 99 trades keep the exact large amount and so far in a single removable-count slot', t => {
  const render = calendarCapture(t), day = '2026-10-15';
  const value = record([{ date: day, desks: {}, coverage: 'partial' }], Array.from({ length: 99 }, (_, i) =>
    tradeOf(`rt-partial-large-${i}`, 'j', `${day}T14:00:00.000Z`, i === 98 ? '-999999.99' : '0')));
  const r = render(value, '2026-10-16T12:00:00.000Z', day);
  for (const html of [r.panel, r.sheet]) {
    assert.match(textOf(html), /Partial · 99 trades · −€ 999\.999,99 so far/);
    assert.match(html, /<span class="dp-trades">99 trades · <\/span><span class="dp-amount">−€ 999\.999,99 so far<\/span>/);
  }
  assert.doesNotMatch(r.cell(day), /so far/);
});


test('JOED-30 rev 5 copy: every sentence, short label, count form, FX dedup and unknown-code fallback', () => {
  const expected = [
    ['capture_gap', 'Capture gap', 'Trade capture had a gap on this day.'],
    ['history_gap', 'History gap', 'The trade history has a gap that covers this day.'],
    ['broker_trade_count_mismatch', 'Broker trade count mismatch', "Our trade count differs from the broker's."],
    ['broker_realised_pnl_mismatch', 'Broker result mismatch', "Our result differs from the broker's by more than €0.01."],
    ['unattributed_activity', 'Unattributed activity', "Some trades couldn't be matched to a desk."],
    ['avg_cost_mismatch', 'Average-cost mismatch', "Our average cost differs from the broker's."],
    ['fx_disabled', 'FX sampling off', 'EUR conversion was switched off for this day.'],
    ['fx_missing', 'FX missing', 'No EUR exchange rate was recorded for this day.'],
    ['broker_evidence_missing', 'Broker evidence missing', "The broker hasn't confirmed fees or results for some trades yet."],
  ];
  for (const [code, label, text] of expected) {
    assert.deepEqual(M.partialReasons({ partialReasons: [code] }), [{ label, text }]);
    assert.equal(M.partialReasonLabel({ partialReasons: [code] }), label);
  }
  for (const n of [1, 2]) assert.equal(M.partialReasons({ partialReasons: ['unattributed_activity'], unattributedCount: n })[0].text,
    `${n}\u00a0trade${n === 1 ? '' : 's'} couldn't be matched to a desk.`);
  const counted = M.partialReasons({ partialReasons: ['unattributed_activity'], unattributedCount: 2 })[0].text;
  assert.equal(counted.charCodeAt(1), 0x00a0, 'keep the number with its unit using the house NO-BREAK SPACE');
  assert.equal(M.partialReasons({ partialReasons: ['unattributed_activity'], unattributedCount: 0 })[0].text,
    "Some trades couldn't be matched to a desk.", 'defensive rendering never presents a contradictory zero count');
  for (const partialReasons of [undefined, [], ['unknown_code']]) {
    assert.deepEqual(M.partialReasons({ partialReasons }), []);
    assert.equal(M.partialReasonLabel({ partialReasons }), partialReason);
  }
  const day = { partialReasons: ['unknown_code', ...expected.map(([code]) => code).reverse()] };
  assert.deepEqual(M.partialReasons(day), expected.filter(([code]) => code !== 'fx_missing').map(([, label, text]) => ({ label, text })));
  assert.equal(M.partialReasonLabel(day), 'Capture gap, and 7 more');
});

test('JOED-30 rev 5 rendering: exact note sentences, first reason aria, default, desk scope and phone expansion markup', t => {
  const render = calendarCapture(t), day = '2026-10-15', now = '2026-10-16T12:00:00.000Z';
  for (const partialReasons of [undefined, ['unknown_code'], ['history_gap'], ['unknown_code', 'history_gap'],
    ['capture_gap', 'history_gap', 'broker_trade_count_mismatch'], M.PARTIAL_REASONS.map(([code]) => code)]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial' }]);
    // Unknown future codes cannot enter rev 5; exercise the renderer defensively.
    if (partialReasons) value.days[0].partialReasons = partialReasons;
    const r = render(value, now, day), reasons = M.partialReasons(value.days[0]);
    for (const html of [r.panel, r.sheet]) {
      assert.ok(textOf(html).includes(reasons.length ? 'Result may be incomplete.' : partialReason));
      for (const reason of reasons) assert.ok(textOf(html).includes(reason.text), reason.text);
      assert.doesNotMatch(html, /unknown_code|capture_gap|history_gap|fx_missing/);
    }
    assert.ok(r.cell(day).includes(fmt.esc(M.partialReasonLabel(value.days[0]))));
    assert.equal((r.panel.match(/class="dp-reason"/g) ?? []).length, reasons.length);
    assert.doesNotMatch(r.panel, /dp-reasons-more|dayReasonsExtra/);
    if (reasons.length > 2) {
      const n = reasons.length - 2;
      assert.ok(r.sheet.includes(`aria-expanded="false" aria-controls="dayReasonsExtra" aria-label="Show ${n} more reason${n === 1 ? '' : 's'}">+${n} more`));
      assert.match(r.sheet, /id="dayReasonsExtra" aria-live="polite" hidden/);
      assert.equal((r.sheet.match(/class="dp-reason" tabindex="-1"/g) ?? []).length, n);
      assert.equal((r.sheet.split('class="dp-reasons-more"')[0].match(/class="dp-reason"/g) ?? []).length, 2);
    } else assert.doesNotMatch(r.sheet, /dp-reasons-more/);
    for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
      const filtered = render(value, now, day, desks);
      assert.match(filtered.cell(day), /class="v"><span class="muted">—/);
      assert.match(filtered.month, /incl\. 1 partial day/);
      assert.equal(textOf(filtered.sheet).includes(M.PARTIAL_DESK_NOTE), desks.length === 1);
      if (desks.length === 1) for (const html of [filtered.panel, filtered.sheet]) {
        const explanation = reasons.at(-1)?.text ?? partialReason;
        const at = textOf(html).indexOf(explanation);
        assert.ok(at >= 0 && at < textOf(html).indexOf(M.PARTIAL_DESK_NOTE), 'scope follows the sentence it qualifies');
      }
    }
  }
});

for (const reasoned of [false, true]) test(`JOED-30 note order: ${reasoned ? 'reasoned' : 'legacy'} partial → desk scope → opened position on today and closed days`, t => {
  const render = calendarCapture(t), day = '2026-10-15';
  const value = record([{ date: day, desks: {}, coverage: 'partial',
    ...(reasoned ? { partialReasons: ['capture_gap', 'history_gap'] } : {}) }]);
  const positions = [{ desk: 'joe', symbol: 'KO', company: 'Coca-Cola', openedAt: `${day}T09:15:00.000Z` }];
  for (const today of [day, '2026-10-16', '2026-10-17']) for (const desks of [ALL, ['joe']]) {
    const r = render(value, `${today}T12:00:00.000Z`, day, desks, positions);
    const explanation = reasoned ? 'Result may be incomplete.Trade capture had a gap on this day.The trade history has a gap that covers this day.' : today === day ? '' : partialReason;
    const scope = explanation && desks.length === 1 ? M.PARTIAL_DESK_NOTE : '';
    const position = `Coca-Cola (KO, Joe), opened ${today === day ? 'today at 11:15' : 'this day'}, is still open; it counts as Still open and on Desk.`;
    for (const html of [r.panel, r.sheet]) {
      const reasonBlock = html.match(/<p class="dp-note-lines">([\s\S]*?)<\/p>/)?.[1] ?? '';
      const positionBlock = html.match(/<p class="dp-position-note">([\s\S]*?)<\/p>/)?.[1];
      assert.equal(textOf(reasonBlock), explanation + scope, 'the explanation and optional desk scope share their own paragraph');
      assert.equal(textOf(positionBlock), position, 'the opened position has its own paragraph');
      if (explanation) assert.match(html, /<\/p><p class="dp-position-note">/, 'reason and positions are sibling paragraphs');
      else assert.doesNotMatch(html, /dp-note-lines|dp-desk-note/, 'today without reasons has only its position paragraph');
    }
  }
});

test('JOED-30 today without explicit reasons: no reason note, with only an optional separate position paragraph', t => {
  const render = calendarCapture(t), { dates, todayWithoutReasons } = partialDaysResults();
  const day = dates.today;
  assert.equal(todayWithoutReasons.days.find(d => d.date === day).coverage, 'partial');
  assert.equal(todayWithoutReasons.days.find(d => d.date === day).partialReasons, undefined);
  const position = { desk: 'joe', symbol: 'KO', company: 'Coca-Cola', openedAt: `${day}T09:15:00.000Z` };
  for (const traded of [false, true]) for (const desks of [ALL, ['joe']]) for (const positions of [[], [position]]) {
    const value = structuredClone(todayWithoutReasons);
    if (traded) value.trades.push(tradeOf('rt-today-no-reasons', 'joe', `${day}T10:00:00.000Z`, '-12.4'));
    const r = render(value, `${day}T12:00:00.000Z`, day, desks, positions);
    for (const html of [r.panel, r.sheet]) {
      assert.doesNotMatch(html, /dp-note-lines|dp-note-lead|dp-reason|dp-desk-note/);
      assert.ok(!textOf(html).includes(partialReason));
      assert.ok(!textOf(html).includes('Result may be incomplete.'));
      if (positions.length) {
        assert.match(html, /<div class="dp-note-copy"><p class="dp-position-note">/);
        assert.match(textOf(html), /Coca-Cola \(KO, Joe\), opened today at 11:15, is still open; it counts as Still open and on Desk\./);
      } else assert.doesNotMatch(html, /class="dp-note"|dp-position-note/, 'no explanatory note at all');
    }
  }
});

test('JOED-34 rev 6 rendering: accepted open partial days have no note unless a real FX cause exists, including DST', t => {
  const render = calendarCapture(t);
  for (const [now, day] of [
    ['2026-10-15T22:00:00.000Z', '2026-10-16'],
    ['2026-10-25T00:30:00.000Z', '2026-10-25'],
    ['2026-10-25T01:30:00.000Z', '2026-10-25'],
    ['2027-03-28T21:59:59.999Z', '2027-03-28'],
  ]) for (const partialReasons of [undefined, ['fx_missing']]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial', ...(partialReasons ? { partialReasons } : {}) }]);
    delete value.receivedAt; value.generatedAt = now;
    const accepted = acceptSnapshot('results', value, null, now);
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.value.days[0].partialReasons, partialReasons, 'acceptance invents no cause');
    assert.ok(validateContract('results', accepted.value).ok);
    for (const desks of [ALL, ['joe']]) {
      const r = render(accepted.value, now, day, desks);
      assert.doesNotMatch(r.cell(day), /day-warning|Partial|Stale/);
      for (const html of [r.panel, r.sheet]) {
        if (partialReasons) {
          const note = html.match(/<p class="dp-note-lines">([\s\S]*?)<\/p>/)?.[1];
          assert.equal(textOf(note), 'Result may be incomplete.No EUR exchange rate was recorded for this day.' +
            (desks.length === 1 ? M.PARTIAL_DESK_NOTE : ''));
        } else assert.doesNotMatch(html, /class="dp-note"|dp-note-lines|dp-note-lead|dp-reason|dp-desk-note/);
      }
    }
  }
});

test('JOED-30 rev 5: count copy renders singular/plural and reason metadata survives worker transfer', t => {
  const render = calendarCapture(t), day = '2026-10-15';
  for (const n of [1, 2, 4]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial', partialReasons: ['unattributed_activity'], unattributedCount: n }]);
    const ix = M.indexResults(value), copy = structuredClone(ix, { transfer: M.transferables(ix) });
    assert.deepEqual(copy.partialDetails.get(day), { partialReasons: ['unattributed_activity'], unattributedCount: n });
    const r = render(value, '2026-10-16T12:00:00.000Z', day);
    for (const html of [r.panel, r.sheet]) assert.ok(textOf(html).includes(`${n}\u00a0trade${n === 1 ? '' : 's'} couldn't be matched to a desk.`));
  }
});

test('JOED-30 rev 5 today: known amounts say so far and reasons render without a Partial marker', t => {
  const render = calendarCapture(t), day = '2026-10-25';
  const value = record([{ date: day, desks: {}, coverage: 'partial', partialReasons: ['capture_gap'] }],
    [tradeOf('rt-today-reason', 'j', `${day}T14:00:00.000Z`, '-12.4')]);
  const r = render(value, `${day}T22:59:59.999Z`, day);
  assert.doesNotMatch(r.cell(day), /day-warning|Partial|incomplete/);
  for (const html of [r.panel, r.sheet]) {
    assert.match(textOf(html), /1 trade · −€ 12,40 so far/);
    assert.match(html, /<p class="dp-note-lines"><span class="dp-note-lead">Result may be incomplete\.<\/span>/);
    assert.ok(textOf(html).includes('Trade capture had a gap on this day.'));
    assert.doesNotMatch(html, /class="st warn"|>Partial</);
  }
});

test('JOED-30 rev 5 today: an empty selected desk or empty-desk row says No trades so far without Partial', t => {
  const render = calendarCapture(t), day = '2026-10-25';
  for (const partialReasons of [undefined, ['capture_gap']]) for (const traded of [false, true]) {
    const value = record([{ date: day, desks: {}, coverage: 'partial', ...(partialReasons ? { partialReasons } : {}) }],
      traded ? [tradeOf('rt-today-other-desk', 'j', `${day}T14:00:00.000Z`, '-12.4')] : []);
    for (const desks of traded ? [['joe'], ['joel']] : [ALL, ['j'], ['joe'], ['joel']]) {
      const r = render(value, `${day}T22:59:59.999Z`, day, desks);
      for (const html of [r.panel, r.sheet]) {
        assert.match(html, /class="dp-sum">No trades so far</);
        assert.doesNotMatch(html, /record incomplete|Partial|sat out|>—</);
      }
    }
  }
});


test('JOED-30 rev 5: every individual reason sentence renders in both details, including FX missing alone', t => {
  const render = calendarCapture(t), day = '2026-10-15';
  for (const [code, label, sentence] of M.PARTIAL_REASONS) {
    const value = record([{ date: day, desks: {}, coverage: 'partial', partialReasons: [code] }]);
    const r = render(value, '2026-10-16T12:00:00.000Z', day);
    for (const html of [r.panel, r.sheet]) assert.ok(textOf(html).includes(sentence), code);
    assert.ok(r.cell(day).includes(fmt.esc(label)));
    const stale = render(value, '2026-10-17T12:00:00.000Z', day);
    assert.ok(stale.cell(day).includes(fmt.esc(`Stale: still incomplete; ${label}`)));
  }
});

test('JOED-30 rev 5: empty-desk rows stay unknown under every filter, add nothing and count with escalated partials', t => {
  const render = calendarCapture(t), day = '2026-10-15';
  const base = record([], [tradeOf('rt-missing-closed', 'j', '2026-10-12T14:00:00.000Z', '12.4')]);
  base.missingDays = ['2026-10-12'];
  const value = structuredClone(base);
  value.days = ['2026-10-13', '2026-10-14', day, '2026-10-16'].map(date =>
    ({ date, desks: {}, coverage: 'partial', partialReasons: ['history_gap'] }));
  for (const desks of [ALL, ['j'], ['joe'], ['joel']]) {
    const r = render(value, '2026-10-16T12:00:00.000Z', day, desks);
    assert.match(r.month, /incl\. 3 partial days/);
    for (const date of ['2026-10-13', '2026-10-14', day]) assert.match(r.cell(date), /class="v"><span class="muted">—/);
    assert.match(r.cell('2026-10-13'), /<span class="n">Stale/);
    assert.match(r.cell('2026-10-14'), /<span class="n">Stale/);
    assert.match(r.cell(day), /<span class="n">Partial/);
    for (const ix of [M.indexResults(base), M.indexResults(value)]) {
      const R = roll(ix, 'month', day, desks, { ...ctxOf(), today: '2026-10-16' });
      assert.equal(R.units.realised, desks.includes('j') ? E('12.4') : 0n);
      assert.equal(R.trades, desks.includes('j') ? 1 : 0);
    }
  }
});

test('JOED-30 rev 5 phone disclosure: removes its control and focuses the first revealed reason without scrolling', () => {
  const events = [];
  const firstReason = { focus: options => events.push(['focus', options]) };
  const extra = { hidden: true, querySelector: selector => selector === '.dp-reason' ? firstReason : null };
  const button = { parentElement: { querySelector: () => extra }, remove: () => events.push(['remove']) };
  page.toggleDayReasons(button);
  assert.equal(extra.hidden, false);
  assert.deepEqual(events, [['remove'], ['focus', { preventScroll: true }]]);
});

// ---------- JOED-151: the approved Results design and its deep links ----------

test('JOED-151 deep links: parsing keeps only valid parts; the canonical form names all three', () => {
  assert.deepEqual(M.parseResultsRoute('period=day&date=2026-10-28&desk=j'), { period: 'day', date: '2026-10-28', desk: 'j' });
  assert.deepEqual(M.parseResultsRoute('?period=year'), { period: 'ytd', date: null, desk: null }, 'a leading ? is accepted; year is This year');
  assert.deepEqual(M.parseResultsRoute('period=Week&desk=ALL'), { period: 'week', date: null, desk: 'all' }, 'letter case is ignored');
  assert.deepEqual(M.parseResultsRoute('desk=joel&date=2026-09-10&period=all&extra=1'), { period: 'all', date: '2026-09-10', desk: 'joel' });
  for (const query of ['', '?', 'period=ytd', 'period=quarter', 'period=__proto__', 'period=constructor', 'desk=toString', 'desk=hasOwnProperty',
    'desk=bob', 'desk=', 'date=2026-02-30', 'date=2026-13-01', 'date=26-10-28', 'date=0099-01-01', 'date=2026-10-28T00:00', 'date=2026-1-5']) {
    assert.deepEqual(M.parseResultsRoute(query), { period: null, date: null, desk: null }, query);
  }
  assert.deepEqual(M.parseResultsRoute(null), { period: null, date: null, desk: null });
  const names = { day: 'day', week: 'week', month: 'month', ytd: 'year', all: 'all' };
  for (const period of ['day', 'week', 'month', 'ytd', 'all']) for (const desk of ['all', 'j', 'joe', 'joel']) {
    const query = M.resultsRoute({ period, date: '2026-10-28', desk });
    assert.equal(query, `period=${names[period]}&date=2026-10-28&desk=${desk}`);
    assert.deepEqual(M.parseResultsRoute(query), { period, date: '2026-10-28', desk }, 'serialising then parsing is the identity');
  }
});

test('JOED-151 deep links: a link sets what it names; missing or invalid parts keep the current view', () => {
  const saved = { ...page.RS }, view = { today: '2026-10-29', trackingStart: '2026-09-10' };
  const state = () => ({ period: page.RS.period, anchor: page.RS.anchor, sel: page.RS.sel, desk: page.RS.desk, cal: page.RS.cal, moved: page.RS.moved });
  try {
    Object.assign(page.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
    // Nothing set: This week, today and All desks.
    assert.equal(page.applyResultsRoute('', view), false);
    assert.equal(page.resultsUrl(view), '#results?period=week&date=2026-10-29&desk=all');
    assert.equal(page.applyResultsRoute('period=day&date=2026-10-28&desk=j', view), true);
    assert.deepEqual(state(), { period: 'day', anchor: '2026-10-28', sel: '2026-10-28', desk: 'j', cal: [2026, 9], moved: true });
    assert.equal(page.resultsUrl(view), '#results?period=day&date=2026-10-28&desk=j');
    // Missing parts keep the view.
    page.applyResultsRoute('period=month', view);
    assert.deepEqual(state(), { period: 'month', anchor: '2026-10-28', sel: '2026-10-28', desk: 'j', cal: [2026, 9], moved: true });
    page.applyResultsRoute('desk=joel', view);
    assert.equal(page.resultsUrl(view), '#results?period=month&date=2026-10-28&desk=joel');
    // Invalid values fall back silently: unknown words, impossible or future
    // dates and dates before the first step change nothing.
    const before = state();
    for (const query of ['period=quarter', 'date=2026-02-30', 'desk=bob', 'date=2026-10-30', 'date=2026-07-31', 'period=__proto__&desk=constructor']) {
      assert.equal(page.applyResultsRoute(query, view), false, query);
      assert.deepEqual(state(), before, query);
    }
    // Valid parts apply even beside invalid ones.
    page.applyResultsRoute('period=week&desk=bob&date=2026-13-40', view);
    assert.deepEqual(state(), { ...before, period: 'week' });
    // The date picks the period that contains it: Day the date, Week its
    // Monday-to-Sunday week, Month its month, year its calendar year, All
    // the whole record (the date is the selected day).
    for (const [query, start, end, lab] of [
      ['period=day&date=2026-10-12', '2026-10-12', '2026-10-12', 'Mon 12 Oct 2026'],
      ['period=week&date=2026-10-28', '2026-10-26', '2026-11-01', 'This week · 26 Oct – 1 Nov'],
      ['period=week&date=2026-10-25', '2026-10-19', '2026-10-25', 'Last week · 19–25 Oct'],
      ['period=month&date=2026-09-30', '2026-09-01', '2026-09-30', 'Last month · September'],
      ['period=year&date=2026-09-30', '2026-01-01', '2026-10-29', 'This year · since 1 Jan'],
      ['period=all&date=2026-09-30', '2026-09-10', '2026-10-29', 'All time · since 10 Sep'],
    ]) {
      page.applyResultsRoute(query, view);
      const per = M.periodOf(page.RS.period, page.RS.anchor, view.today, view.trackingStart);
      assert.deepEqual([per.start, per.end, per.lab], [start, end, lab], query);
      assert.equal(page.RS.sel, new URLSearchParams(query).get('date'), `${query}: the date is the selected day`);
      assert.equal(page.resultsUrl(view), `#results?${query}&desk=joel`, `${query}: the address names the same view`);
    }
    // A link to today keeps following the board's today.
    page.applyResultsRoute('period=day&date=2026-10-29', view);
    assert.equal(page.RS.moved, false);
  } finally { Object.assign(page.RS, saved); }
});

test('JOED-151 year: the period is the calendar year that contains its date', () => {
  const today = '2027-02-01', ts = '2026-09-10';
  assert.deepEqual(M.periodOf('ytd', today, today, ts), { p: 'ytd', start: '2027-01-01', end: today, lab: 'This year · since 1 Jan', head: 'this year', phrase: 'this year' });
  assert.deepEqual(M.periodOf('ytd', '2026-03-01', today, ts), { p: 'ytd', start: '2026-01-01', end: '2026-12-31', lab: 'Last year · 2026', head: 'last year', phrase: 'last year' });
  assert.deepEqual(M.periodOf('ytd', '2025-06-01', today, ts), { p: 'ytd', start: '2025-01-01', end: '2025-12-31', lab: '2025', head: '2025', phrase: 'in 2025' });
  const saved = { ...page.RS };
  try {
    Object.assign(page.RS, { period: 'week', anchor: today, sel: today, desk: 'all', cal: [2027, 1], moved: false });
    assert.equal(page.applyResultsRoute('period=year&date=2026-11-02', { today, trackingStart: ts }), true);
    const per = M.periodOf(page.RS.period, page.RS.anchor, today, ts);
    assert.deepEqual([per.start, per.end], ['2026-01-01', '2026-12-31']);
    assert.equal(page.resultsUrl({ today, trackingStart: ts }), '#results?period=year&date=2026-11-02&desk=all');
  } finally { Object.assign(page.RS, saved); }
});

test('JOED-151 hero: it names result, desks and period, shows the base beside the percentage and a signed split', () => {
  const render = heroCapture(), now = '2026-10-14T17:42:22.000Z';
  // J closes Friday 9 Oct at € 5.001: the week's base is € 15.000 plus that € 1.
  const value = record([closeDay('2026-10-09', '5001'), closeDay('2026-10-12', '5001')], [tradeOf('rt-hero-win', 'j', '2026-10-12T15:00:00.000Z', '2', '0.5'),
    tradeOf('rt-hero-loss', 'joe', '2026-10-13T15:00:00.000Z', '-1', '0.25')]);
  const all = htmlDocument(render(value, now, 'week', today, ALL, [E('5001.5'), E('4999'), E('5000')]).html);
  assert.equal(all.querySelector('.hero-k').textContent, 'Result · All desks · this week');
  assert.equal(all.querySelector('.hero-k .term').dataset.term, 'result');
  assert.ok(all.querySelector('.performance-pct'), 'All desks shows its percentage');
  assert.equal(all.querySelector('.period-percent-slot .of').textContent, `of € ${fmt.digits(E('15001'))}`, 'the base: € 15.000 plus the result before the week');
  const dd = all.querySelectorAll('.split dd');
  assert.deepEqual(dd.map(d => d.textContent), ['+€\u00a01,00', '−€\u00a01,50', '+€\u00a01,75', '−€\u00a00,75']);
  assert.deepEqual(dd.slice(0, 3).map(d => d.querySelector('.nw').getAttribute('class')), ['nw gain', 'nw loss', 'nw gain'],
    'amounts sit in no-wrap spans, coloured by their sign');
  assert.equal(dd[3].querySelector('.nw').getAttribute('class'), 'nw', 'fees carry no gain or loss colour');
  assert.equal(all.querySelectorAll('.bench').length, 0, 'the benchmark moved to the chart legend');
  const joe = htmlDocument(render(value, now, 'month', today, ['joe'], [E('5001.5'), E('4999'), E('5000')]).html);
  assert.equal(joe.querySelector('.hero-k').textContent, 'Result · Joe · this month');
  assert.equal(joe.querySelector('.period-percent-slot').textContent, '', 'an individual desk has no percentage and no base');
});

const { TERMS } = await import('../public/joe/terms.js');
const { renderTiles: tilesOf, renderBreakdown: breakdownOf } = await (await import('./fixtures/preview-dom.mjs')).builders('results.js', ['renderTiles', 'renderBreakdown']);
function markupOf(render) {
  const before = globalThis.document, node = markupNode();
  globalThis.document = { querySelector: () => node, activeElement: null };
  try { render(); } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
  return htmlDocument(node.innerHTML);
}

test('JOED-151 tiles: eight compact tiles keep their explanations; values size from their own text', () => {
  const ix = M.indexResults(record([closeDay('2026-10-12', '5001')], [tradeOf('rt-tile-win', 'j', '2026-10-12T15:00:00.000Z', '2', '0.5'),
    tradeOf('rt-tile-loss', 'joe', '2026-10-13T15:00:00.000Z', '-1', '0.25')]));
  const R = roll(ix, 'week', today, ALL, ctxOf([E('5001.5'), E('4999'), E('5000')]));
  for (const doc of [markupOf(() => tilesOf(R)), markupOf(() => tilesOf(null))]) {
    const tiles = doc.querySelectorAll('.tile');
    assert.deepEqual(tiles.map(t => t.dataset.tile), ['trades', 'won', 'avgtrade', 'pf', 'typical', 'besttrade', 'dip', 'bestday']);
    for (const tile of tiles) {
      const key = tile.dataset.tile, info = tile.querySelector('.metric-info');
      assert.equal(tile.querySelector('h3').textContent, TERMS[key][0]);
      assert.equal(info.getAttribute('aria-label'), `Learn about ${TERMS[key][0]}`);
      assert.equal(info.dataset.term, key);
      const value = tile.querySelector('.tval');
      assert.equal(value.getAttribute('style'), `--characters:${Math.max(1, value.textContent.length)}`, key);
      assert.ok(tile.querySelector('.tmean').textContent.trim(), `${key} says what it means`);
    }
    assert.equal(doc.querySelectorAll('.ico-sq').length + doc.querySelectorAll('.tfoot').length, 0, 'no icon squares or footers');
  }
  const pair = markupOf(() => tilesOf(R)).querySelector('[data-tile="typical"] .tval');
  assert.equal(pair.querySelectorAll('.pair-value').length, 2, 'a pair keeps both values and each one’s own length');
});

test('JOED-151 By desk: one card that ends in All desks, every bar coloured by its own sign', () => {
  const ix = M.indexResults(record([closeDay('2026-10-12', '5001')], [tradeOf('rt-bd-win', 'j', '2026-10-12T15:00:00.000Z', '2', '0.5'),
    tradeOf('rt-bd-loss', 'joe', '2026-10-13T15:00:00.000Z', '-1', '0.25')]));
  const inputs = ctxOf([E('5001.5'), E('4999'), E('5000')]);
  const rows = [...ALL.map(d => roll(ix, 'week', today, [d], inputs)), roll(ix, 'week', today, ALL, inputs)];
  const doc = markupOf(() => breakdownOf({ ix, today }, M.periodOf('week', today, today), ALL, rows));
  assert.deepEqual(doc.querySelectorAll('.brow').map(r => r.dataset.row), ['j', 'joe', 'joel', 'all']);
  const total = doc.querySelector('[data-row="all"]');
  assert.equal(total.querySelector('.who').textContent, 'All desks');
  assert.equal(total.querySelectorAll('.dmark').length, 0);
  assert.match(total.querySelector('.track .b').getAttribute('style'), /background:var\(--gain\)/, 'the total is coloured by its sign too');
  assert.match(doc.querySelector('[data-row="joe"] .track .b').getAttribute('style'), /background:var\(--loss\)/);
  assert.match(doc.querySelector('[data-row="j"] .facts').textContent, /^1 trade · 100 % won · fees € 0,50$/);
  const index = readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8');
  assert.match(index, /<div class="card bdcard" id="breakdown"><\/div>/, 'By desk is one card');
});

test('JOED-151 trades: each row shows the trade’s own rate as recorded; a listed day explains its currencies', t => {
  const render = calendarCapture(t);
  const usd = tradeOf('rt-rate-usd', 'j', '2026-10-13T15:00:00.000Z', '1');
  const precise = { ...tradeOf('rt-rate-precise', 'joe', '2026-10-13T16:00:00.000Z', '1'), fx: { ...usd.fx, rate: '0.85861234' } };
  const r = render(record([closeDay('2026-10-13', '5002')], [usd, precise]), '2026-10-14T12:00:00.000Z', '2026-10-13');
  for (const html of [r.panel, r.sheet]) {
    const doc = htmlDocument(html), rates = doc.querySelectorAll('[aria-label]').filter(el => el.getAttribute('aria-label') === 'Exchange rate');
    assert.deepEqual(rates.map(el => el.textContent), ['at € 0,90 per $', 'at € 0,85861234 per $'], 'at least two decimals, all recorded ones');
    assert.ok(rates.every(el => el.parentElement.getAttribute('class') === 'ln'), 'the rate sits with the prices');
    const note = doc.querySelector('.dp-fx');
    assert.equal(textOf(note.children.at(-1).textContent), 'Prices in USD, as traded. Fees and results in EUR at each trade’s Interactive Brokers rate (€ per $). Kept holdings never appear here.');
    // No control in the note: the phone sheet's focus order stays Close, then its body (JOED-140).
    assert.equal(note.querySelectorAll('button').length + note.querySelectorAll('a').length + note.querySelectorAll('[tabindex]').length, 0);
    assert.equal(doc.querySelectorAll('.dp-fx').length, 1);
  }
  const euro = { ...tradeOf('rt-rate-eur', 'j', '2026-10-13T15:00:00.000Z', '1'), entryPrice: { amount: '70', currency: 'EUR' }, exitPrice: { amount: '71', currency: 'EUR' },
    fx: { ...usd.fx, base: 'EUR', rate: '1' } };
  const e = render(record([closeDay('2026-10-13', '5001')], [euro]), '2026-10-14T12:00:00.000Z', '2026-10-13');
  assert.equal(htmlDocument(e.panel).querySelectorAll('[aria-label]').filter(el => el.getAttribute('aria-label') === 'Exchange rate').length, 0, 'a euro price has no rate to show');
  assert.equal(textOf(htmlDocument(e.panel).querySelector('.dp-fx').children.at(-1).textContent),
    'Prices as traded, each in its own currency. Fees and results in EUR at each trade’s Interactive Brokers rate. Kept holdings never appear here.');
  const none = render(record([closeDay('2026-10-13', '5000')], [usd]), '2026-10-14T12:00:00.000Z', '2026-10-12');
  assert.equal(htmlDocument(none.panel).querySelectorAll('.dp-fx').length, 0, 'a day without listed trades has no prices to explain');
});

test('JOED-151 chart: quiet time marks at Vienna midnights, by the length of the period', () => {
  const at = k => M.viennaMidnight(k), day = k => new Date(at(k)).toISOString();
  // A week: every midnight inside it, also across the October clock change.
  assert.deepEqual(page.timeMarks('2026-10-19', at('2026-10-19'), at('2026-10-26')).map(x => new Date(x).toISOString()),
    ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map(day));
  // This week so far: only the midnights before now.
  assert.deepEqual(page.timeMarks('2026-10-12', at('2026-10-12'), Date.parse('2026-10-14T17:42:31.000Z')), [at('2026-10-13'), at('2026-10-14')]);
  // A month: its Mondays after the first; longer periods: each first of a month.
  assert.deepEqual(page.timeMarks('2026-10-01', at('2026-10-01'), at('2026-11-01')), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map(at));
  const year = page.timeMarks('2025-10-01', at('2025-10-01'), at('2026-10-15'));
  assert.deepEqual(year, ['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
    '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map(at));
  assert.deepEqual(page.timeMarks('2026-10-14', at('2026-10-14'), at('2026-10-14') + 3600000), [], 'nothing inside a single hour');
});

test('JOED-151 CSS: every Results-only rule lives in one delimited block', () => {
  const css = resultsCss();
  const open = '/* ==================== Results (one block) ====================', close = '/* ==================== end of Results ==================== */';
  const start = css.indexOf(open), end = css.indexOf(close);
  assert.ok(start > 0 && end > start && css.indexOf(open, start + 1) < 0 && css.indexOf(close, end + 1) < 0, 'one block, opened and closed once');
  const outside = `${css.slice(0, start)}${css.slice(end + close.length)}`.replace(/\/\*[\s\S]*?\*\//g, '');
  const results = /^(?:\.res-tools|\.step(?:-label)?|\.rhero(?:-[lr])?|\.result-figure|\.period-percent-slot|\.rchart|\.res-(?:status|state)|\.tiles?|\.tile-top|\.tval|\.tmean|\.pair-value|\.metric-info|\.bdcard|\.bars|\.brow|\.track|\.calcard|\.cal(?:-head|-legend)?|\.cell|\.dow|\.wk|\.ramp|\.agenda-date|#calSum|#cal|\.daypanel|\.dp-[\w-]+|\.trow|\.sheet|\.lg-b|button\.cell)(?![\w-])/;
  const leaked = [...outside.matchAll(/([^{}]+)\{/g)].map(([, prelude]) => prelude.trim())
    .filter(prelude => !prelude.startsWith('@') && prelude.split(',').map(s => s.trim()).every(s => results.test(s)));
  assert.deepEqual(leaked, [], 'Results-only selectors outside the block');
  const inside = css.slice(start, end);
  for (const rule of ['.rhero {', '.tile {', '.bdcard {', '.trow .px {', '.trow .net::after {', '.dp-fx {', '@media (max-width: 382px) {']) assert.ok(inside.includes(rule), rule);
});
