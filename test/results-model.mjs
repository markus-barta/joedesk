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
const page = await import('../public/joe/results.js');
const fmt = await import('../public/joe/format.js');
const { bn } = await import('../public/joe/ui.js');
const { decimalUnits, divRound, roundUnits, mulUnits, divUnits, unitsDecimal, unitsNumber } = await import('../contracts/decimal.mjs');
const { validateContract } = await import('../contracts/index.mjs');
const { acceptRead } = await import('../contracts/read.mjs');
const { panelStates } = await import('../contracts/panel-state.mjs');
const hm = await import('../public/joe/history-model.js');
const { designResults, withTradeSummaries } = await import('../scripts/browser/results.mjs');

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/results/${name}.json`, import.meta.url)));
const ALL = ['j', 'joe', 'joel'];
const E = euros => decimalUnits(String(euros));
const today = '2026-10-14';
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
function record(days, trades = [], trackingStart = '2026-09-10') {
  const r = { schema: 'inspr.joe.household.results.v2', seq: 1, generatedAt: '2026-10-14T17:40:00.000Z', receivedAt: '2026-10-14T17:40:00.000Z',
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
  const cell = (amount, retained) => ({ value: { amount, currency: 'EUR' }, retained });
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
  // Desktop holds six narrow signs, phones four (scaled forms a step smaller): measured at 390/1024/1440 in both fonts.
  for (const [v] of table) {
    assert.ok(form(v, false).length <= 5, `desktop ${v}`);
    const p = page.calAmount(E(v), true);
    assert.ok(p.text.length <= (p.cls ? 4 : 3), `phone ${v}`);
  }
});

test('JOED-29 calendar rendering: phone rounded zero has no sign or arrow, keeps its loss tint; exact zero stays flat', t => {
  const documentBefore = globalThis.document, stateBefore = { ...page.RS };
  t.after(() => {
    if (documentBefore === undefined) delete globalThis.document;
    else globalThis.document = documentBefore;
    Object.assign(page.RS, stateBefore);
  });
  // Capture the real calendar renderer's markup without starting a browser.
  const nodes = new Map(['calTitle', 'prevMonth', 'nextMonth', 'calSum', 'cal', 'calLegend', 'daypanel', 'daySheet']
    .map(id => [`#${id}`, { innerHTML: '', textContent: '' }]));
  globalThis.document = { querySelector: selector => nodes.get(selector), activeElement: null };
  const ix = M.indexResults(record([closeDay('2026-10-12', '5001'), closeDay('2026-10-13', '5001'), closeDay(today, '5000.97')], [
    tradeOf('rt-gain', 'j', '2026-10-12T15:00:00.000Z', '1'),
    tradeOf('rt-flat', 'j', '2026-10-13T15:00:00.000Z', '0'),
    tradeOf('rt-small-loss', 'j', '2026-10-14T15:00:00.000Z', '-0.03'),
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
  assert.doesNotMatch(`${loss}${flat}`, /title=/);
});
