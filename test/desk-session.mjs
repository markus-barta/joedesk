// JOED-153: Desk's session-dated hero (M1, A2), the market-day bar (M3), the
// desk cards (M5) with their last ten sessions (M4) and the links (M6).
// Browser-free; synthetic money only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { validateContract } from '../contracts/index.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { zonedInstant, nyDay, NY } from '../time.mjs';
const { boardStates } = await import('../public/joe/board-state.js');
const { indexResults, rollup, moneyContext, periodOf, periodBase, DESK_IDS } = await import('../public/joe/results-model.js');
const { resultsView } = await import('../public/joe/results.js');
const { cellReason } = await import('../public/joe/health.js');
const { eur } = await import('../public/joe/format.js');
const { STARTING_MONEY, percentOf, todayBase, todayPercent, exactCell } = await import('../public/joe/performance.js');
const desk = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { dayWarning } = await builders('results.js', ['dayWarning']);
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url))).data;

const NOW = valid.receivedAt; // Wed 14 Oct 2026, 13:42 New York: the regular session
const NB = '\u00a0';
const money = amount => ({ amount: String(amount), currency: 'EUR' });
// Synthetic closes: J's ten session results are +12, −64, +8, −22, −46, +20, −9, +4, +18 and +10.
const SESSIONS = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
const CLOSE = {
  j: [5012, 4948, 4956, 4934, 4888, 4908, 4899, 4903, 4921, 4931],
  joe: [5003, 5000, 5011, 5011, 5014, 5006, 5011, 5012, 5010, 5012],
  joel: SESSIONS.map(() => 5000),
};
const J_DAYS = [12, -64, 8, -22, -46, 20, -9, 4, 18, 10];
const TRADES = [
  { desk: 'j', day: '2026-10-02', at: '2026-10-02T15:00:00.000Z', gross: '-49.3', fees: '0.7', net: '-50' },
  { desk: 'joe', day: '2026-10-08', at: '2026-10-08T15:00:00.000Z', gross: '5.7', fees: '0.7', net: '5' },
];
// 9 Oct is still incomplete (Stale from 14 Oct on), 14 Oct is the open or last day (Partial on 15 Oct).
const PARTIAL = { '2026-10-09': ['fx_missing'], '2026-10-14': ['fx_missing'] };
// The sessions from the desks' start (10 Sep) before the ten above: flat, no
// trades. With them the record covers every closed session (M5's proof).
const EARLY = ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'];
function record(receivedAt = '2026-10-15T11:00:00.000Z', partial = PARTIAL, { early = false } = {}) {
  const trades = TRADES.map((t, i) => ({ id: `rt-desk-session-${i}`, desk: t.desk, symbol: 'DEMO', company: 'Demo', side: 'long', quantity: '1',
    openedAt: '2026-10-01T14:00:00.000Z', closedAt: t.at, entryPrice: { amount: '10', currency: 'USD' }, exitPrice: { amount: '11', currency: 'USD' },
    grossEur: money(t.gross), feesEur: money(t.fees), netEur: money(t.net),
    fx: { base: 'USD', quote: 'EUR', rate: '0.9', source: 'fixture-close-rate', observedAt: t.at }, method: 'execution-fifo-net-current-fx' }));
  // An empty reason list is an open day still in progress: partial, no cause.
  const cover = date => (partial[date] ? { coverage: 'partial', ...(partial[date].length ? { partialReasons: partial[date] } : {}) } : {});
  const days = SESSIONS.map((date, i) => ({ date, ...cover(date),
    desks: Object.fromEntries(DESK_IDS.map(id => {
      const own = TRADES.filter(t => t.desk === id && t.day === date);
      return [id, { equityClose: money(CLOSE[id][i]), realisedNet: money(own.reduce((s, t) => s + Number(t.net), 0)),
        fees: money(own.reduce((s, t) => s + Number(t.fees), 0).toFixed(1)), trades: own.length }];
    })) }));
  const flat = date => ({ date, ...cover(date), desks: Object.fromEntries(DESK_IDS.map(id => [id, { equityClose: money(5000), realisedNet: money(0), fees: money(0), trades: 0 }])) });
  const value = { schema: 'inspr.joe.household.results.v2', seq: 7, generatedAt: receivedAt, receivedAt, currency: 'EUR', timeZone: 'Europe/Vienna',
    trackingStart: '2026-09-10', days: [...(early ? EARLY.map(flat) : []), ...days], trades, benchmark: null };
  const check = validateContract('results', value);
  assert.ok(check.ok, JSON.stringify(check.errors));
  return value;
}
// The fixture snapshot moved to `at`, so its own times agree with the clock.
function snapshotAt(at) {
  const data = structuredClone(valid);
  const move = (o, key) => { if (typeof o[key] === 'string') o[key] = at; };
  for (const key of ['generatedAt', 'receivedAt']) move(data, key);
  move(data.safety.gateway, 'checkedAt'); move(data.safety.executor, 'checkedAt'); move(data.brokerAccount, 'observedAt'); move(data.positions, 'observedAt');
  for (const d of data.desks) move(d, 'heartbeatAt');
  for (const row of data.positions.rows) move(row, 'updatedAt');
  move(data.pnlSources.day, 'observedAt'); move(data.pnlSources.open, 'observedAt');
  data.pnlSources.day.periodStart = zonedInstant(nyDay(at), '00:00:00', NY);
  return data;
}
function context(now = NOW, { results = true, data = null, partial = PARTIAL, early = false, edit = null, receivedAt = undefined } = {}) {
  const snapshot = data ?? snapshotAt(new Date(Date.parse(now) - 9000).toISOString());
  const feeds = { data: { value: snapshot } }, states = boardStates(feeds, now);
  if (results) {
    const value = record(receivedAt, partial, { early }), index = indexResults(edit ? edit(value) : value);
    feeds.results = { value: { ...index.meta, index } };
    states.results = { state: 'fresh', value: { ...index.meta, index }, reason: null, ageSeconds: 9 };
  }
  return { feeds, now, states };
}
const text = doc => doc.textContent.replace(/[ \t\n]+/g, ' ').trim();
const visible = doc => { for (const selector of ['.cash-sizing', '.vh']) for (const node of doc.querySelectorAll(selector)) node.remove(); return doc; };

test('JOED-153 M1: the first figure names its session in every phase, with its own link and term', () => {
  for (const [now, phase, label, term, href] of [
    [NOW, 'live', `Today · Wed 14${NB}Oct · live`, 'today', '#results?period=day&date=2026-10-14&desk=all'],
    ['2026-10-14T21:00:00.000Z', 'closed', `Wed 14${NB}Oct · session closed`, 'closedday', '#results?period=day&date=2026-10-14&desk=all'],
    ['2026-10-15T12:00:00.000Z', 'last', `Last session · Wed 14${NB}Oct`, 'lastsession', '#results?period=day&date=2026-10-14&desk=all'],
    ['2026-10-17T10:00:00.000Z', 'last', `Last session · Fri 16${NB}Oct`, 'lastsession', null],
  ]) {
    const ctx = context(now), hero = htmlDocument(desk.heroLeft(ctx)), first = hero.querySelector('[data-cell="hero.day"]');
    assert.equal(first.dataset.phase, phase, now);
    assert.equal(first.querySelector('.hero-k .term').textContent, label, now);
    assert.equal(first.querySelector('.hero-k .term').dataset.term, term, now);
    assert.equal(Boolean(first.querySelector('.live-dot')), phase === 'live', `${now}: the live dot only while live`);
    if (href) assert.equal(first.querySelector('.fig-link').getAttribute('href'), href, now);
  }
});

test('JOED-153 A2: before the open the hero shows the last session’s Results · Day figure, its basis and its record marker', () => {
  const ctx = context('2026-10-15T12:00:00.000Z'), view = resultsView(ctx);
  const hero = visible(htmlDocument(desk.heroLeft(ctx))), first = hero.querySelector('[data-cell="hero.day"]');
  // Results' own numbers for that Vienna day, all desks.
  const per = periodOf('day', '2026-10-14', view.today, view.trackingStart);
  const R = rollup(view.ix, per, DESK_IDS, moneyContext(view.ix, view, per, DESK_IDS)), base = periodBase(view.ix, view, per, DESK_IDS);
  assert.equal(R.units.net, decimalUnits('12'));
  assert.equal(base, decimalUnits('14931'), '€ 15.000 plus the after-fee result before that day');
  assert.equal(first.querySelector('.display .bn').textContent, '+€12,00');
  assert.equal(first.querySelector('.pct-slot').textContent, `+0,08${NB}% of ${eur(base)}`);
  assert.equal(first.querySelector('.pct-slot .basis').dataset.term, 'result', 'the tip gives Results’ day base, nothing invented');
  assert.equal(percentOf(R.units.net, base), 8n);
  // The full caption, and the short one a phone shows (CSS picks one).
  assert.equal(first.querySelector('.primary-caption .cap-long').textContent, `closed €${NB}0,00 · still open +€${NB}12,00 · after fees · from the trade record`);
  assert.equal(first.querySelector('.primary-caption .cap-short').textContent, `closed €${NB}0,00 · still open +€${NB}12,00`);
  assert.equal(first.querySelector('.primary-caption .st').textContent, 'Partial');
  assert.equal(first.querySelector('.primary-caption .st').getAttribute('title'), `Partial: this day's record is incomplete. FX missing`);
  assert.equal(first.dataset.state, 'stale');
  // The sentence: each desk's figure for that session, then the positions held.
  // Joel neither traded nor moved: the record says no trades recorded, never
  // € 0, with that day's Partial marker (gate findings 2 and, round 2, 1).
  assert.equal(hero.querySelector('.say').textContent, `Wednesday: J +€${NB}10,00 · Joe +€${NB}2,00 · Joel no trades recorded (Partial) · 1${NB}position held overnight`);
  assert.deepEqual(hero.querySelectorAll('.say .num').map(n => n.getAttribute('class')), ['num gain', 'num gain'], 'sign colours');
});

test('JOED-153 A2: without a Results figure the last session is a dash with one plain reason', () => {
  const ctx = context('2026-10-15T12:00:00.000Z', { results: false });
  const first = htmlDocument(desk.heroLeft(ctx)).querySelector('[data-cell="hero.day"]');
  assert.equal(first.querySelector('.display').textContent, '—');
  assert.equal(first.querySelector('.bn').getAttribute('aria-label'), `Last session · Wed 14${NB}Oct: Results unavailable · no data received yet`);
  assert.equal(first.querySelector('.primary-caption').textContent, 'Results unavailable · no data received yet');
  assert.equal(first.querySelector('.pct-slot').textContent, '');
  assert.equal(first.querySelectorAll('.fig-link').length, 0, 'a dash is never a link');
});

test('JOED-153: Today keeps the classifier in the session; its basis is the board’s own', () => {
  const ctx = context(), hero = htmlDocument(desk.heroLeft(ctx)), first = hero.querySelector('[data-cell="hero.day"]');
  const base = todayBase(ctx.states, ctx.feeds.data.value.pnlSources.day);
  assert.equal(base, exactCell(ctx.states['today.equity']) - exactCell(ctx.states['today.dayPnl']), 'their money now minus today’s result');
  assert.equal(todayPercent(ctx.states, ctx.feeds.data.value.pnlSources.day), percentOf(exactCell(ctx.states['today.dayPnl']), base));
  assert.equal(first.querySelector('.pct-slot .basis').textContent, `of ${eur(base)}`);
  assert.equal(first.querySelector('.pct-slot .basis').dataset.term, 'today');
  assert.equal(first.querySelector('.primary-caption').textContent, 'since New York midnight · after fees');
  assert.equal(hero.querySelector('.say').textContent, `J −€${NB}1,00 · Joe flat · Joel flat`, 'the per-desk breakdown, one line');
  // An estimate's percentage and base stay omitted, as before.
  const estimate = structuredClone(ctx.feeds.data.value.pnlSources.day); estimate.method = 'session-open-estimate';
  assert.equal(todayBase(ctx.states, estimate), null);
  // Different snapshots never make a base.
  const states = { ...ctx.states, 'today.equity': { ...ctx.states['today.equity'], valueReceivedAt: '2026-10-14T17:41:00.000Z' } };
  assert.equal(todayBase(states, ctx.feeds.data.value.pnlSources.day), null);
});

test('JOED-153: after the close the caption says what still moves Today, with no timing promise', () => {
  const first = htmlDocument(desk.heroLeft(context('2026-10-14T21:00:00.000Z'))).querySelector('[data-cell="hero.day"]');
  assert.equal(first.querySelector('.primary-caption').textContent, 'after fees · after-hours prices and the exchange rate still move it');
  assert.doesNotMatch(first.textContent, /final|until \d|will be|yet\b/);
});

test('JOED-153 summary row: Open result with its fresh position count, Desks’ money with its start, and the History link', () => {
  const hero = visible(htmlDocument(desk.heroLeft(context())));
  const open = hero.querySelector('[data-cell="hero.open"]'), money = hero.querySelector('[data-cell="hero.equity"]');
  assert.equal(open.querySelector('dt').textContent, 'Open result');
  assert.equal(open.querySelector('.account-caption').children[0].textContent, `1${NB}position · changes until they close`);
  assert.equal(money.querySelector('.account-caption').children[0].textContent, `started with ${eur(STARTING_MONEY, false, 0)} on 10${NB}Sep`);
  assert.equal(money.querySelector('.fig-link').getAttribute('href'), '#history?range=week&mode=money');
  assert.equal(hero.querySelector('[data-cell="hero.since"] .fig-link').getAttribute('href'), '#results?period=all&date=2026-10-14&desk=all');
  // A positions panel that is not fresh gives no count, never an old one.
  const ctx = context(); ctx.states.positions = { ...ctx.states.positions, state: 'stale', reason: 'snapshot_stale' };
  assert.equal(visible(htmlDocument(desk.heroLeft(ctx))).querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, 'changes until they close');
  assert.equal(desk.positionCounts(ctx.states), null);
});

test('JOED-153 M4: last ten sessions from Results’ per-desk Day figures, today live, a label on every bar', () => {
  const ctx = context(), card = htmlDocument(deskCard(ctx, 'j')), bars = card.querySelectorAll('.bars .b');
  assert.equal(bars.length, 10);
  // Results' own per-desk figure for each past session, then today's Today.
  const view = resultsView(ctx);
  for (const [i, k] of SESSIONS.slice(0, 9).entries()) {
    const per = periodOf('day', k, view.today, view.trackingStart);
    assert.equal(rollup(view.ix, per, ['j'], moneyContext(view.ix, view, per, ['j'])).units.net, decimalUnits(String(J_DAYS[i])), k);
    assert.equal(bars[i].getAttribute('href'), `#results?period=day&date=${k}&desk=j`);
  }
  assert.deepEqual(bars.map(b => b.querySelector('.bl.out').textContent), ['+12', '−64', '+8', '−22', '−46', '+20', '−9', '+4', '+18', '−1']);
  assert.deepEqual(bars.map(b => b.querySelector('i').getAttribute('class')), ['gain', 'loss', 'gain', 'loss', 'loss', 'gain', 'loss', 'gain', 'gain', 'loss live']);
  // Today's bar: filled at 60 % with its outline (CSS), never thinner than 3 px, its label outside.
  const live = bars[9];
  assert.equal(live.getAttribute('class'), 'b today');
  assert.ok(Number(live.querySelector('i').getAttribute('style').match(/height:([\d.]+)px/)[1]) >= 3);
  assert.equal(live.querySelectorAll('.bl.in').length, 0, 'today’s label never sits on its 60 % fill');
  assert.equal(live.getAttribute('aria-label'), `Today · Wed 14${NB}Oct: −€${NB}1,00, so far · after fees`);
  // Inside when it fits, else at the bar's x on the other side of zero.
  const top = b => Number(b.querySelector('i').getAttribute('style').match(/top:([\d.]+)px/)[1]);
  const height = b => Number(b.querySelector('i').getAttribute('style').match(/height:([\d.]+)px/)[1]);
  const labelTop = b => Number(b.querySelector('.bl.out').getAttribute('style').match(/top:([\d.]+)px/)[1]);
  const zero = Number(card.querySelector('.bz').getAttribute('style').match(/top:([\d.]+)px/)[1]);
  // A bar tall enough carries its label inside, in the bar itself (its own fill
  // is the label's background), at its far end; CSS shows it there only when
  // the bar is also wide enough (data-c), else the label beside zero shows.
  const inside = bars[1].querySelector('i .bl.in');
  assert.ok(height(bars[1]) >= 15 && inside, '−64 fits inside');
  assert.deepEqual([inside.textContent, inside.getAttribute('style'), bars[1].dataset.c], ['−64', 'bottom:2px', '3']);
  assert.match(bars[1].getAttribute('class'), /\bhas-in\b/);
  // Joe's +11 is his tallest bar: a gain's inside label sits at its top.
  const joeGain = htmlDocument(deskCard(ctx, 'joe')).querySelectorAll('.bars .b')[2];
  assert.deepEqual([joeGain.querySelector('i .bl.in').textContent, joeGain.querySelector('i .bl.in').getAttribute('style')], ['+11', 'top:2px']);
  assert.equal(bars[2].querySelectorAll('.bl.in').length, 0, '+8 is too short for its label');
  assert.ok(labelTop(bars[2]) > zero, 'a positive bar’s label beside zero sits below it');
  assert.ok(labelTop(bars[6]) + 11 < zero, 'a negative bar’s label beside zero sits above it');
  // Collisions: the extremes and today keep their labels; the width rule lives in CSS.
  assert.deepEqual(bars.map(b => /\bkeep\b/.test(b.querySelector('.bl.out').getAttribute('class'))), [false, true, false, false, false, true, false, false, false, true]);
  assert.equal(card.querySelector('.bars').dataset.lc, '3');
  assert.equal(card.querySelector('.bars').dataset.need, '220');
  // Hover or focus shows the date and the exact amount; Results' markers come along.
  assert.equal(bars[0].querySelector('.bt').textContent, `Thu 1${NB}Oct · +€${NB}12,00after fees · from Results`);
  assert.equal(bars[0].querySelector('.bt').getAttribute('aria-hidden'), 'true', 'the link’s own name says it');
  assert.match(bars[6].getAttribute('aria-label'), /Stale: still incomplete; FX missing$/);
  assert.deepEqual(card.querySelectorAll('.bars-ax span').map(s => s.textContent), [`Thu 1${NB}Oct`, 'today']);
  assert.equal(card.querySelector('.spark-h').textContent, 'Last 10 sessions · each session’s result in €, after fees');
});

test('JOED-153 M4: a not-exact Today is a dashed outline without a number; a missing record says why once', () => {
  const ctx = context();
  ctx.states['desks.j.dayPnl'] = { state: 'broken', value: null, reason: 'not_exact_yet', retained: false };
  const today = htmlDocument(deskCard(ctx, 'j')).querySelectorAll('.bars .b')[9];
  assert.equal(today.querySelector('i').getAttribute('class'), 'nx');
  assert.equal(today.querySelectorAll('.bl').length, 0);
  assert.equal(today.getAttribute('aria-label'), `Today · Wed 14${NB}Oct: not exact today`);
  const none = htmlDocument(deskCard(context(NOW, { results: false }), 'j'));
  assert.equal(none.querySelectorAll('.bars .b').length, 0);
  assert.equal(none.querySelector('.bars-why').textContent, 'Results unavailable · no data received yet');
});

test('JOED-153 barLabel: whole euros from exact units, two decimals under € 1, k and M above a thousand', () => {
  for (const [amount, label] of [['0', '0'], ['0.004', '0'], ['0.4', '+0,40'], ['-0.04', '−0,04'], ['12.49', '+12'], ['-12.5', '−13'], ['999.4', '+999'],
    ['1234', '+1,2k'], ['-1950', '−2k'], ['9960', '+10k'], ['123456', '+123k'], ['1250000', '+1,3M'], ['-12300000', '−12M']]) {
    assert.equal(desk.barLabel(decimalUnits(amount)), label, amount);
  }
});

test('JOED-153 M5: card header says what the desk does; one Results link; first figure labelled per phase', () => {
  const live = htmlDocument(deskCard(context(), 'j'));
  assert.equal(text(live.querySelector('header .state')), `Working${NB}· 1${NB}position`);
  assert.equal(live.querySelector('header .state span').getAttribute('title'), live.querySelector('header .state span').textContent, 'the full state is its title');
  assert.equal(live.querySelectorAll('.card-go').length, 1);
  assert.equal(live.querySelector('.card-go').getAttribute('href'), '#results?period=week&date=2026-10-14&desk=j');
  assert.equal(live.querySelector('.dnums .term').textContent, 'Today');
  assert.deepEqual(live.querySelectorAll('.dnums .c').map(c => c.textContent), ['so far · after fees', `1${NB}position`, 'after fees']);
  const closed = htmlDocument(deskCard(context('2026-10-14T21:00:00.000Z'), 'j'));
  assert.equal(closed.querySelector('.dnums .term').textContent, `Wed 14${NB}Oct`);
  assert.equal(text(closed.querySelector('header .state')), `Working${NB}· 1${NB}position held overnight`);
  const last = htmlDocument(deskCard(context('2026-10-15T12:00:00.000Z'), 'j'));
  assert.equal(last.querySelector('.dnums .term').dataset.term, 'lastsession');
  assert.equal(last.querySelector('.dnums .v .bn').textContent, '+€10,00');
  assert.equal(last.querySelector('.dnums .fig-link').getAttribute('href'), '#results?period=day&date=2026-10-14&desk=j');
  assert.equal(visible(last).querySelector('.dnums .c').textContent, `closed €${NB}0,00 · still open +€${NB}10,00 Partial`);
  assert.deepEqual(last.querySelectorAll('.bars-ax span').map(s => s.textContent), [`Thu 1${NB}Oct`, `Wed 14${NB}Oct`]);
  // A desk sitting out with nothing held says so; a weekend says how positions are held.
  assert.equal(text(htmlDocument(deskCard(context(), 'joe')).querySelector('header .state')), `Sitting out${NB}· no positions`);
  assert.equal(text(htmlDocument(deskCard(context('2026-10-17T10:00:00.000Z'), 'j')).querySelector('header .state')), `Working${NB}· 1${NB}position held over the weekend`);
});

// Gate findings 4 and 6: the one-row card is the record's claim. It needs a
// record that covers the desk's whole period, and only the record decides it,
// so a positions panel going stale changes words inside, never the layout.
test('JOED-153 M5: one row only when the record proves no trades for the whole period; positions never decide', () => {
  const full = { partial: {}, early: true };
  const ctx = context(NOW, full), facts = desk.deskFacts(ctx);
  assert.deepEqual(DESK_IDS.map(id => desk.noTradesSinceStart(ctx, facts, id)), [null, null, '2026-09-10']);
  const row = htmlDocument(deskCard(ctx, 'joel'));
  assert.ok(row.querySelector('.drow'));
  assert.equal(text(row.querySelector('.who')), `Joel · sitting out · no trades since 10${NB}Sep · no positions`);
  assert.deepEqual(row.querySelectorAll('.dnums .term').map(t => t.textContent), ['Today', `Since 10${NB}Sep`]);
  assert.deepEqual(row.querySelectorAll('.dnums .v').map(v => v.textContent), ['€0,00', '€0,00']);
  assert.equal(row.querySelectorAll('.bars').length, 0);
  // 75 s later the positions panel is stale: the same layouts (so the same
  // grid columns), and the row says the positions are not current.
  const data = snapshotAt(new Date(Date.parse(NOW) - 9000).toISOString());
  const later = context(new Date(Date.parse(NOW) + 75000).toISOString(), { ...full, data });
  assert.equal(later.states.positions.state, 'stale');
  const laterFacts = desk.deskFacts(later);
  assert.deepEqual(DESK_IDS.map(id => desk.noTradesSinceStart(later, laterFacts, id)), [null, null, '2026-09-10']);
  assert.equal(text(htmlDocument(deskCard(later, 'joel')).querySelector('.who')), `Joel · sitting out · no trades since 10${NB}Sep · positions not current`);
  // A full card says the same about its positions, in its header.
  assert.match(htmlDocument(deskCard(later, 'j')).querySelector('header .state span').textContent, /· positions not current$/);
  // Unknown is never "none": the normal card whenever the record cannot prove it.
  const cases = {
    'no record': context(NOW, { results: false }),
    'a partial closed day (FX)': context(NOW, { early: true }),
    'a capture gap': context(NOW, { early: true, partial: { '2026-09-21': ['capture_gap'] } }),
    'unattributed activity': context(NOW, { early: true, partial: { '2026-10-06': ['unattributed_activity'] } }),
    'an open day with a real cause': context(NOW, { early: true, partial: { '2026-10-14': ['fx_missing'] } }),
    'a missing daily summary': context(NOW, { early: true, partial: {}, edit: v => ({ ...v, missingDays: ['2026-10-07'] }) }),
    'sessions without a summary': context(NOW, { partial: {} }),
    'tracking that started after the desk': context(NOW, { early: true, partial: {}, edit: v => ({ ...v, trackingStart: '2026-09-21', days: v.days.filter(d => d.date >= '2026-09-21') }) }),
  };
  for (const [name, c] of Object.entries(cases)) assert.equal(desk.noTradesSinceStart(c, desk.deskFacts(c), 'joel'), null, name);
  // An open day still in progress (partial, no cause) is no gap.
  const open = context(NOW, { early: true, partial: { '2026-10-14': [] }, receivedAt: '2026-10-14T17:40:00.000Z' });
  assert.equal(desk.noTradesSinceStart(open, desk.deskFacts(open), 'joel'), '2026-09-10');
  // A retained (last good) record proves nothing new.
  const retained = context(NOW, full);
  retained.states.results = { ...retained.states.results, state: 'broken', retained: true, reason: 'contract_invalid' };
  assert.equal(desk.noTradesSinceStart(retained, desk.deskFacts(retained), 'joel'), null);
  // An old but accepted record still holds: its age alone flips nothing.
  const old = context(NOW, full);
  old.states.results = { ...old.states.results, state: 'stale', reason: 'snapshot_stale', ageSeconds: 75 };
  assert.equal(desk.noTradesSinceStart(old, desk.deskFacts(old), 'joel'), '2026-09-10');
});

test('JOED-153: the phone row labels its first figure per phase and counts what is held', () => {
  assert.deepEqual(htmlDocument(desk.compactDesk(context(), 'j')).querySelectorAll('.compact-label').map(l => l.textContent), ['Today', 'Since']);
  assert.equal(htmlDocument(desk.compactDesk(context(), 'j')).querySelector('.compact-word').textContent, `Working · 1${NB}open`);
  const last = htmlDocument(desk.compactDesk(context('2026-10-15T12:00:00.000Z'), 'j'));
  assert.deepEqual(last.querySelectorAll('.compact-label').map(l => l.textContent), ['Wed', 'Since']);
  assert.equal(last.querySelector('[data-compact-value="dayPnl"] .bn').textContent, '+€10,00');
  assert.equal(last.querySelector('.compact-word').textContent, `Working · 1${NB}held`);
});

test('JOED-153 Partial/Stale markers are Results’ own: same label and words as Results · Day', () => {
  for (const now of [NOW, '2026-10-15T12:00:00.000Z', '2026-10-20T12:00:00.000Z']) {
    const view = resultsView(context(now));
    for (const k of SESSIONS) for (const desks of [DESK_IDS, ['j'], ['joel']]) {
      const ours = desk.sessionWarning(view, k, desks), theirs = dayWarning(view, k, desks);
      assert.deepEqual(ours, theirs && { label: theirs.label, text: theirs.text }, `${now} ${k} ${desks}`);
    }
  }
});

test('JOED-153 heldWord: overnight, over the weekend or over a weekday holiday; nothing while live', () => {
  const label = now => desk.deskFacts(context(now)).label;
  for (const [now, word] of [[NOW, ''], ['2026-10-14T21:00:00.000Z', 'overnight'], ['2026-10-15T12:00:00.000Z', 'overnight'],
    ['2026-10-16T21:00:00.000Z', 'over the weekend'], ['2026-10-17T10:00:00.000Z', 'over the weekend'], ['2026-11-25T22:00:00.000Z', 'over the holiday']]) {
    assert.equal(desk.heldWord(now, label(now)), word, now);
  }
});

test('JOED-153 M3: the market block states the session, the next one and New York’s own time', () => {
  for (const [now, words, summary] of [
    [NOW, ['New York market', 'open', 'closes 22:00 · 2\u00a0h\u00a017\u00a0min left', 'Regular session 15:30–22:00 Vienna', 'New York 13:42 · 6\u00a0h behind'], 'Open · closes 22:00 · 2\u00a0h\u00a017\u00a0min left'],
    ['2026-10-14T12:00:00.000Z', ['closed', 'Next session today 15:30–22:00 · opens in 1\u00a0h\u00a030\u00a0min'], 'Closed · opens 15:30 · in 1\u00a0h\u00a030\u00a0min'],
    ['2026-10-14T21:00:00.000Z', ['closed', 'since 22:00', 'Next session Thu 15\u00a0Oct, 15:30–22:00 Vienna'], 'Closed at 22:00 · next Thu 15\u00a0Oct, 15:30'],
    ['2026-10-17T10:00:00.000Z', ['for the weekend', 'Next session Mon 19\u00a0Oct, 15:30–22:00 Vienna', 'no session today'], 'Closed for the weekend · next Mon 19\u00a0Oct, 15:30'],
    ['2026-11-26T15:00:00.000Z', ['for the holiday', 'Next session Fri 27\u00a0Nov, 15:30–19:00 Vienna'], 'Closed for the holiday · next Fri 27\u00a0Nov, 15:30'],
    ['2026-10-29T15:40:00.000Z', ['closes 21:00', 'Regular session 14:30–21:00 Vienna', 'New York 11:40 · 5\u00a0h behind until Sun 1\u00a0Nov (usually 6\u00a0h)'], 'Open · closes 21:00 · 4\u00a0h\u00a020\u00a0min left'],
  ]) {
    const block = desk.marketBlock(now), doc = htmlDocument(block.html), all = doc.textContent;
    for (const w of words) assert.ok(all.includes(w), `${now}: ${w} in ${all}`);
    assert.equal(block.summary, summary, now);
  }
  assert.deepEqual(desk.marketBlock(null).summary, 'Time not known');
});

test('JOED-153 M3: the day bar places New York’s day, the session (early closes included) and now on the Vienna day', () => {
  const at = (doc, selector) => Number((doc.querySelector(selector).getAttribute('style').match(/left:(?:calc\()?([\d.]+)%/) ?? [])[1]);
  const minutes = hm => hm.split(':').reduce((h, m) => Number(h) * 60 + Number(m)) / 1440 * 100;
  for (const [now, nyStart, open, close, phase, vday] of [
    [NOW, '06', '15:30', '22:00', 'live', 1440],
    ['2026-10-29T15:40:00.000Z', '05', '14:30', '21:00', 'live', 1440],
    ['2026-11-27T15:00:00.000Z', '06', '15:30', '19:00', 'live', 1440],
    ['2026-10-14T12:00:00.000Z', '06', '15:30', '22:00', 'upcoming', 1440],
    ['2026-10-14T21:00:00.000Z', '06', '15:30', '22:00', 'done', 1440],
  ]) {
    const doc = htmlDocument(desk.marketBlock(now).html);
    assert.equal(doc.querySelectorAll('.db-ticks span')[1].textContent, nyStart, `${now}: New York's day starts at ${nyStart}`);
    assert.ok(Math.abs(at(doc, '.db-ny') - minutes(`${nyStart}:00`)) < 0.01, now);
    assert.ok(Math.abs(at(doc, '.db-sess') - minutes(open)) < 0.01, now);
    assert.equal(doc.querySelector('.db-sess').getAttribute('class'), `db-sess ${phase}`);
    assert.deepEqual(doc.querySelectorAll('.db-ticks span').map(s => s.textContent).filter(t => /:/.test(t)), [open, close], now);
    assert.equal(Boolean(doc.querySelector('.db-fill')), phase === 'live');
    assert.match(doc.querySelector('.daybar').getAttribute('aria-label'), new RegExp(`New York day begins at ${nyStart}:00, regular session ${open} to ${close}; now \\d\\d:\\d\\d$`));
  }
  // A day without a session keeps its usual place, outlined and empty.
  const weekend = htmlDocument(desk.marketBlock('2026-10-17T10:00:00.000Z').html);
  assert.equal(weekend.querySelector('.db-sess').getAttribute('class'), 'db-sess none');
  assert.equal(weekend.querySelectorAll('.db-fill').length, 0);
  assert.ok(weekend.textContent.includes('no session today'));
});

test('JOED-153 slot: the whole-account block’s place above the hero, marked for it, with the account’s own figures until then', () => {
  const html = readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8');
  const desk0 = html.indexOf('id="scr-desk"'), slot = html.indexOf('id="accountSlot"'), hero = html.indexOf('id="deskHero"');
  assert.ok(desk0 < slot && slot < hero, 'the slot sits above the desk hero');
  assert.match(html.slice(desk0, slot), /<!-- JOED-156 slot: the whole-account block/);
  const doc = htmlDocument(desk.accountSlot(context()));
  assert.equal(doc.querySelector('[data-cell="hero.account"] .bn').textContent, '€28.000,00');
  assert.equal(doc.querySelectorAll('[data-cash="hero.cash"]').length, 1);
  assert.equal(doc.querySelectorAll('.card').length, 0, 'the interim figures are no card of their own (AC-44)');
  assert.equal(desk.desksEyebrow().includes('kept holdings left out'), true);
});

// The label width a card writes (data-need) always has its CSS rule, at the
// width it names, and every inside label its threshold.
test('JOED-153 M4: every label width the cards can write has its collision rule in app.css', () => {
  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  // A tapped bar (touch) keeps its label, as a hovered or focused one does.
  const rules = [...css.matchAll(/@container spark \(max-width: ([\d.]+)px\) \{ \.desk-sessions \.bars\[data-need="(\d+)"\] \.b:not\(:hover\):not\(:focus-visible\):not\(\.tapped\) \.bl\.out:not\(\.keep\) \{ visibility: hidden; \} \}/g)];
  assert.deepEqual(rules.map(m => Number(m[2])), Array.from({ length: 16 }, (_, i) => 100 + 20 * i));
  assert.ok(rules.every(m => Number(m[1]) === Number(m[2]) - 0.02));
  const ctx = context(), needs = new Set();
  for (const id of DESK_IDS) { const bars = htmlDocument(deskCard(ctx, id)).querySelector('.bars'); if (bars?.dataset.need) needs.add(bars.dataset.need); }
  assert.ok(needs.size >= 1 && [...needs].every(n => rules.some(m => m[2] === n)), [...needs].join());
  for (const c of [2, 3, 4, 5, 6, 7]) assert.match(css, new RegExp(`@container spark \\(min-width: \\d+px\\) \\{ \\.desk-sessions \\.bars \\.b\\[data-c="${c}"\\] \\.bl\\.in \\{ display: block; \\}`));
});

// Every selector of a CSS text, outside at-rule preludes and comments.
const cssSelectors = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
  .map(m => m[1].trim()).filter(pre => pre && !pre.startsWith('@')).flatMap(pre => pre.split(',').map(sel => sel.trim().replace(/\s+/g, ' ')));
// A selector widened to what the test DOM reads: no pseudo-classes or
// -elements and descendants for every combinator, so it matches a superset.
const widened = sel => sel.replace(/::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, '').replace(/\s*[>+~]\s*/g, ' ').trim();
const DESK_BLOCK = (() => {
  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  return css.slice(css.indexOf('/* ---------- Desk hero and cards (JOED-153'), css.indexOf('/* ---------- end Desk hero and cards (JOED-153)'));
})();

// Gate finding 1: the Desk block's rules reach Desk only. Results' breakdown
// is also a `.bars` of `.b` bars; it keeps exactly its own styles.
test('JOED-153 CSS: no Desk hero or card rule reaches Results; Results’ breakdown keeps its own styles', async () => {
  const page = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const { renderBreakdown, RS } = await builders('results.js', ['renderBreakdown']);
  const ctx = context('2026-10-15T12:00:00.000Z'), view = resultsView(ctx), saved = globalThis.document, savedDesk = RS.desk;
  const per = periodOf('week', '2026-10-14', view.today, view.trackingStart);
  const rows = [...DESK_IDS.map(id => rollup(view.ix, per, [id], moneyContext(view.ix, view, per, [id]))), rollup(view.ix, per, DESK_IDS, moneyContext(view.ix, view, per, DESK_IDS))];
  globalThis.document = page;
  try { RS.desk = 'all'; renderBreakdown(view, per, DESK_IDS, rows); } finally {
    RS.desk = savedDesk; if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
  }
  const results = page.querySelector('#scr-results');
  assert.ok(results.querySelectorAll('#breakdown .brow .track .b').length >= 2, 'the breakdown draws its result bars');
  const selectors = cssSelectors(DESK_BLOCK).map(widened).filter(Boolean);
  assert.deepEqual(selectors.filter(sel => results.querySelectorAll(sel).length), [], 'Desk rules that reach the Results screen');
  // Not vacuous: the same rules do reach a Desk card's session bars.
  const card = htmlDocument(`<article class="card dcard" id="desk-j"><div class="desk-detail">${deskCard(context(), 'j')}</div></article>`);
  assert.equal(card.querySelectorAll(widened('.desk-sessions .bars .b')).length, 10);
  assert.ok(selectors.includes('.desk-sessions .bars .b'));
  // Every bars rule of the block is scoped to Desk's session charts.
  assert.deepEqual(cssSelectors(DESK_BLOCK).filter(sel => /(^|\s)\.(bars|bl|bt|bz|bars-ax|bars-tap)\b/.test(sel) && !sel.startsWith('.desk-sessions ')), []);
});

// Gate finding 2: an accepted record without days or trades is no evidence
// of a result. Last session is A2's dash with one plain reason, as Results'
// Day hero shows a dash for it: never € 0 or 0 %.
test('JOED-153 A2: an accepted empty record gives the last session a dash and “No trades recorded”, never € 0', () => {
  const empty = v => ({ ...v, days: [], trades: [] });
  assert.ok(validateContract('results', empty(record())).ok, 'an accepted envelope');
  const ctx = context('2026-10-15T12:00:00.000Z', { edit: empty }), view = resultsView(ctx);
  const per = periodOf('day', '2026-10-14', view.today, view.trackingStart);
  assert.equal(rollup(view.ix, per, DESK_IDS, moneyContext(view.ix, view, per, DESK_IDS)).empty, true, 'Results’ Day hero: a dash, “No trades …”');
  const hero = htmlDocument(desk.heroLeft(ctx)), first = hero.querySelector('[data-cell="hero.day"]');
  assert.equal(first.querySelector('.display').textContent, '—');
  assert.equal(first.querySelector('.bn').getAttribute('aria-label'), `Last session · Wed 14${NB}Oct: no trades recorded`);
  assert.equal(first.querySelector('.primary-caption').textContent, 'No trades recorded');
  assert.equal(first.querySelector('.pct-slot').textContent, '');
  assert.equal(hero.querySelector('.say').textContent, `No trades recorded on Wednesday · 1${NB}position held overnight`);
  assert.doesNotMatch(first.textContent + hero.querySelector('.say').textContent, /€\s?0,00|0,00\s?%/);
  // The record covers no session, so no desk is one row; every bar is a dashed
  // outline that says so, none a zero.
  for (const id of DESK_IDS) {
    const card = htmlDocument(deskCard(ctx, id)), bars = card.querySelectorAll('.bars .b');
    assert.equal(card.querySelectorAll('.drow').length, 0, id);
    assert.equal(card.querySelector('.dnums .v .bn').getAttribute('aria-label'), `${{ j: 'J', joe: 'Joe', joel: 'Joel' }[id]} · Wed 14${NB}Oct: no trades recorded`);
    assert.equal(bars.length, 10);
    assert.ok(bars.every(b => b.querySelector('i.nx') && !b.querySelector('.bl') && b.getAttribute('aria-label').endsWith(': no trades recorded')), id);
  }
  // Within a record, a desk-day without a trade or a change is the same: a dash.
  const quiet = desk.resultsDay(resultsView(context('2026-10-15T12:00:00.000Z')), '2026-10-13', ['joel']);
  assert.deepEqual([quiet.units, quiet.kind, quiet.reason], [null, 'empty', 'no trades recorded']);
});

// Gate finding 3: before the open, a phone row's first figure is Results'
// last session. Its Partial/Stale marker and the record's state stay with it:
// in the row's visible warning line and its accessible name.
test('JOED-153: a phone row keeps the last session’s marker and the record’s state, in its text and its name', () => {
  const at = '2026-10-15T08:00:00.000Z';
  const summary = row => [row.querySelector('.disclosure-warning .summary-text')?.textContent ?? '', row.querySelector('.disclosure-warning .vh')?.textContent ?? ''];
  // Wed 14 Oct is Partial in the record (FX missing).
  const partial = htmlDocument(desk.compactDesk(context(at), 'j'));
  assert.equal(partial.querySelector('[data-compact-value="dayPnl"] .compact-state').getAttribute('aria-label'), 'Partial');
  assert.deepEqual(summary(partial), Array(2).fill('Last session: partial · this day\'s record is incomplete. FX missing'));
  // Without a day marker, an old record says how old it is.
  const old = context(at, { partial: {} });
  old.states.results = { ...old.states.results, state: 'stale', reason: 'snapshot_stale', ageSeconds: 300 };
  const stale = htmlDocument(desk.compactDesk(old, 'j'));
  assert.equal(stale.querySelector('[data-compact-value="dayPnl"] .compact-state').getAttribute('aria-label'), 'Stale');
  // The record's own state is a problem of its own (fix round 2, finding 2).
  assert.equal(summary(stale)[0], 'Results: stale · updates are late');
  // Results unavailable: the row says so; a fact (no trades recorded) is no problem.
  assert.equal(summary(htmlDocument(desk.compactDesk(context(at, { results: false }), 'j')))[0], 'Results: not reported · no data received yet');
  assert.equal(summary(htmlDocument(desk.compactDesk(context(at, { edit: v => ({ ...v, days: [], trades: [] }) }), 'j')))[0], '');
  // In the session the Today cell is the row's figure, as before.
  assert.equal(htmlDocument(desk.compactDesk(context(), 'j')).querySelectorAll('[data-compact-value="dayPnl"] .compact-state').length, 0);
});

// Gate finding 5: on a touch screen a first tap shows the bar's tip with the
// way to Results; that link or a second tap opens Results; Escape or a tap
// elsewhere closes it. A mouse and the keyboard keep hover and focus.
test('JOED-153 M4 touch: first tap shows the tip, a second tap or its link opens Results, Escape or elsewhere closes', async () => {
  const A = 'desk-j|2026-10-13', B = 'desk-j|2026-10-12';
  for (const [open, event, want] of [
    [null, { bar: A, touch: true }, 'open'], [A, { bar: A, touch: true }, 'follow'], [A, { bar: B, touch: true }, 'open'],
    [A, { inTip: true, onTip: true }, 'follow'], [A, { onTip: true }, null], [A, {}, 'close'], [A, { bar: A, touch: false }, 'close'], [null, { bar: A, touch: false }, null], [null, {}, null],
  ]) assert.equal(desk.barTapAction(open, event), want, JSON.stringify([open, event]));
  const href = '#results?period=day&date=2026-10-13&desk=j';
  const tipHtml = desk.barTipHtml(`<b>Tue 13${NB}Oct</b> · +€${NB}18,00<span>after fees · from Results</span>`, href);
  const tip = htmlDocument(tipHtml);
  assert.equal(tip.querySelector('a.bars-go').getAttribute('href'), href);
  assert.equal(tip.querySelector('a.bars-go').textContent, 'Open in Results');
  assert.equal(tip.querySelector('a.bars-go use').getAttribute('href'), '#i-chev-r', 'the chevron icon, never a glyph');
  assert.doesNotMatch(tipHtml, /›/);
  // The events, through the real handlers, on the test DOM with a card in it.
  const cardHtml = deskCard(context(), 'j');
  const doc = htmlDocument(`<article class="card dcard" id="desk-j"><div class="desk-detail">${cardHtml}</div></article>`);
  // The test DOM keeps no markup of parsed nodes: give each hover tip its own.
  const words = [...cardHtml.matchAll(/<span class="bt" aria-hidden="true">(.*?<\/span>)<\/span><\/a>/g)].map(m => m[1]);
  doc.querySelectorAll('.bars a.b .bt').forEach((bt, i) => { bt.html = words[i]; });
  const listeners = {};
  Object.assign(doc, { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } });
  const proto = Object.getPrototypeOf(doc);
  const savedRect = proto.getBoundingClientRect, saved = globalThis.document;
  proto.getBoundingClientRect = () => ({ left: 0, width: 30 });
  const tipEl = doc.querySelector('.bars-tap');
  Object.defineProperty(tipEl, 'hidden', { get() { return this.getAttribute('hidden') !== null; }, set(v) { if (v) this.setAttribute('hidden', ''); else delete this.attributes.hidden; }, configurable: true });
  const bars = doc.querySelectorAll('.bars a.b'), barAt = i => bars[i];
  const fire = (type, init) => { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init }; for (const fn of listeners[type] ?? []) fn(e); return e; };
  const tap = target => { fire('pointerdown', { pointerType: 'touch', target }); return fire('click', { pointerType: 'touch', detail: 1, target }); };
  globalThis.document = doc;
  try {
    desk.initBarTaps();
    const first = tap(barAt(8));
    assert.equal(first.defaultPrevented, true, 'a first tap does not navigate');
    assert.equal(tipEl.hidden, false);
    assert.match(tipEl.innerHTML, /Tue 13.*Oct.*Open in Results/s);
    assert.ok(barAt(8).classList.contains('tapped'), 'the tapped bar shows its label');
    const second = tap(barAt(8));
    assert.equal(second.defaultPrevented, false, 'a second tap on the same bar opens Results');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(tipEl.hidden, true);
    tap(barAt(8));
    tap(tipEl.querySelector('b'));
    assert.equal(tipEl.hidden, false, 'a tap inside the tip keeps it');
    const link = tap(tipEl.querySelector('a.bars-go'));
    assert.equal(link.defaultPrevented, false, 'its link opens Results');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(tipEl.hidden, true);
    tap(barAt(8));
    fire('keydown', { key: 'Escape', target: doc });
    assert.equal(tipEl.hidden, true, 'Escape closes it');
    tap(barAt(8));
    const elsewhere = fire('click', { pointerType: 'touch', detail: 1, target: doc.querySelector('.spark-h') });
    assert.equal(elsewhere.defaultPrevented, false);
    assert.equal(tipEl.hidden, true, 'a tap elsewhere closes it');
    // A mouse click and the keyboard's Enter open Results straight away.
    fire('pointerdown', { pointerType: 'mouse', target: barAt(3) });
    assert.equal(fire('click', { pointerType: 'mouse', detail: 1, target: barAt(3) }).defaultPrevented, false);
    assert.equal(fire('click', { pointerType: '', detail: 0, target: barAt(3) }).defaultPrevented, false);
    assert.equal(tipEl.hidden, true);
  } finally {
    proto.getBoundingClientRect = savedRect;
    if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
  }
  // Wired once by the app; styled on Desk only.
  assert.match(readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8'), /\n  initBarTaps\(\);\n/);
  assert.match(DESK_BLOCK, /\.desk-sessions \.bars-tap \{[^}]*background: var\(--tip-bg\)/);
});

// Gate finding 7: P3's Desk checks must read the page as it now is. On the
// design scenario the page's own render passes AC-9 (the paper account is the
// whole-account slot's first figure, no longer a hero figure) and writes its
// percentages exactly as the check expects them (with the no-break space).
test('JOED-153 browser checks: AC-9 and the percent text hold on the page’s own render of the P3 design scenario', async () => {
  const { keptOnlyInAccount, percentText } = await import('../scripts/browser/desk-checks.mjs');
  const { scenario, NOW: P3_NOW, at, preflightSnapshot } = await import('../scripts/browser/board.mjs');
  const { snapshot } = scenario(P3_NOW);
  const now = at(P3_NOW, 9), feeds = { data: { value: preflightSnapshot('data', snapshot, null, P3_NOW).value }, results: { value: null, reason: 'feed_not_received' } };
  const ctx = { feeds, now, states: boardStates(feeds, now) };
  const hero = htmlDocument(desk.heroLeft(ctx)), slot = htmlDocument(desk.accountSlot(ctx)), kept = htmlDocument(desk.keptHtml(ctx));
  const value = k => (k.querySelector('dd .bn') ?? k.querySelector('.cash-amount'))?.textContent;
  const d = { kpis: hero.querySelectorAll('.kpi').map(k => ({ value: value(k) })), slot: slot.querySelectorAll('.kpi').map(k => ({ value: value(k) })),
    keptCap: text(kept.querySelector('.keep-cap')), keptState: text(kept.querySelector('.pstate')) };
  assert.equal(d.kpis.length, 2, 'the hero keeps Open result and Desks’ money only');
  assert.equal(keptOnlyInAccount(d), true, JSON.stringify(d));
  const day = decimalUnits(snapshot.totals.dayPnl.amount), equity = decimalUnits(snapshot.totals.equity.amount), since = decimalUnits(snapshot.totals.totalPnl.amount);
  assert.deepEqual(hero.querySelectorAll('.performance-pct').map(p => p.textContent), [percentText(day, equity - day), percentText(since, decimalUnits('15000'))]);
});

// Fix round 2, finding 1: a capture gap can hide trades, so a day without
// recorded trades on it is "no trades recorded" with its Partial marker, on
// every surface and in every name, never "no trades".
test('JOED-153 A2: a capture-gap day without recorded trades is “no trades recorded (Partial)”, marked everywhere', () => {
  const ctx = context('2026-10-15T12:00:00.000Z', { partial: { '2026-10-14': ['capture_gap'] } });
  const warning = desk.sessionWarning(resultsView(ctx), '2026-10-14', ['joel']);
  assert.equal(warning.label, 'Partial');
  const say = htmlDocument(desk.heroLeft(ctx)).querySelector('.say').textContent;
  assert.match(say, /· Joel no trades recorded \(Partial\) ·/);
  assert.doesNotMatch(say, /Joel no trades(?! recorded)/);
  const named = `Joel · Wed 14${NB}Oct: no trades recorded · ${warning.text}`;
  // The phone row: the marker by the dash, its name, and the row's warning line.
  const row = htmlDocument(desk.compactDesk(ctx, 'joel')), figure = row.querySelector('[data-compact-value="dayPnl"]');
  assert.equal(figure.querySelector('.compact-state').getAttribute('aria-label'), 'Partial');
  assert.equal(figure.querySelector('.bn').getAttribute('aria-label'), named);
  assert.equal(row.querySelector('.disclosure-warning .summary-text').textContent, `Last session: partial · ${warning.text.replace(/^Partial: /, '')}`);
  // The card: the same name, the marker in the caption, and the day's bar.
  const card = htmlDocument(deskCard(ctx, 'joel'));
  assert.equal(card.querySelector('.dnums .v .bn').getAttribute('aria-label'), named);
  assert.equal(card.querySelector('.dnums .c .st').textContent, 'Partial');
  assert.equal(card.querySelectorAll('.bars .b').at(-1).getAttribute('aria-label'), `Wed 14${NB}Oct: no trades recorded · ${warning.text}`);
  // A fully covered quiet day stays unqualified, and still never "no trades".
  const covered = htmlDocument(desk.heroLeft(context('2026-10-15T12:00:00.000Z', { partial: {} }))).querySelector('.say').textContent;
  assert.match(covered, /· Joel no trades recorded ·/);
});

// Fix round 2, finding 2: the Results feed's own fault is a row problem of
// its own, whatever the day's figure or marker: a rejected read keeps the
// last good record, and the row says so.
test('JOED-153: a phone row names the Results feed’s fault independently of the day’s figure or marker', () => {
  const at = '2026-10-15T12:00:00.000Z';
  const retained = c => { c.states.results = { ...c.states.results, state: 'broken', retained: true, reason: 'contract_invalid', ageSeconds: 120 }; return c; };
  const detail = c => htmlDocument(desk.compactDesk(c, 'j')).querySelector('.disclosure-warning .vh')?.textContent ?? '';
  const fault = `Results: last good · ${cellReason('contract_invalid')}`;
  // An empty retained record: no figure and no day marker, and still the fault.
  assert.equal(detail(retained(context(at, { edit: v => ({ ...v, days: [], trades: [] }) }))), fault);
  // A Partial day from a retained record: the day's marker and the feed's fault.
  const both = detail(retained(context(at)));
  assert.ok(both.includes(fault) && both.includes("Last session: partial · this day's record is incomplete. FX missing"), both);
  // A fresh, fully covered record adds nothing.
  assert.equal(detail(context(at, { partial: {} })), '');
});

// Fix round 2, finding 3: the coverage proof must reach the desk's start, and
// a day outside the pinned market calendar (2026–2028) proves nothing.
test('JOED-153 M5: a desk start the market calendar does not cover cannot be proved: the normal card', () => {
  const now = '2026-01-05T12:00:00.000Z', data = snapshotAt(new Date(Date.parse(now) - 9000).toISOString());
  const startJ = iso => { data.desks.find(d => d.id === 'j').accounting = { periodStart: iso, method: 'execution-fifo-net-current-fx', detail: 'Test start.' }; };
  const flat = date => ({ date, desks: Object.fromEntries(DESK_IDS.map(id => [id, { equityClose: money(5000), realisedNet: money(0), fees: money(0), trades: 0 }])) });
  const only = (trackingStart, ...dates) => v => ({ ...v, trackingStart, days: dates.map(flat), trades: [] });
  startJ('2025-12-01T05:00:00.000Z');
  const outside = context(now, { data, partial: {}, edit: only('2025-12-01', '2026-01-02') });
  assert.equal(desk.noTradesSinceStart(outside, desk.deskFacts(outside), 'j'), null);
  assert.equal(htmlDocument(deskCard(outside, 'j')).querySelectorAll('.drow').length, 0, 'no “no trades since 1 Dec”');
  // Inside the calendar the same kind of record does prove it: one row.
  startJ('2026-01-02T05:00:00.000Z');
  const inside = context(now, { data, partial: {}, edit: only('2026-01-02', '2026-01-02') });
  assert.equal(desk.noTradesSinceStart(inside, desk.deskFacts(inside), 'j'), '2026-01-02');
});

// The browser check (scripts/browser/desk-sessions.mjs) expects what Desk
// renders from the same design fixtures, and both fixtures pass the board's
// ingress, so the browser gate can fail only on what the page draws.
test('JOED-153 browser fixture: the session checks expect what Desk renders from the design record', async () => {
  const { expectedSessions, SESSIONS, BEFORE_OPEN, quietJoelResults } = await import('../scripts/browser/desk-sessions.mjs');
  const { scenario, NOW: P3_NOW, at, preflightSnapshot } = await import('../scripts/browser/board.mjs');
  const { designResults } = await import('../scripts/browser/results.mjs');
  const { toColumns } = await import('../public/joe/history-model.js');
  for (const when of [P3_NOW, BEFORE_OPEN]) {
    const live = when === P3_NOW, { snapshot, history } = scenario(when);
    const data = preflightSnapshot('data', snapshot, null, when).value;
    const pushed = designResults(when); delete pushed.receivedAt;
    const results = preflightSnapshot('results', pushed, null, when).value;
    const now = at(when, 9), want = expectedSessions({ record: results, snapshot, points: history.points, nowMs: Date.parse(now), live });
    const index = indexResults(results);
    const feeds = { data: { value: data }, history: { value: { columns: toColumns(history.points) } }, results: { value: { ...index.meta, index } } };
    const states = boardStates(feeds, now);
    states.results = { state: 'fresh', value: { ...index.meta, index }, reason: null, ageSeconds: 9 };
    const ctx = { feeds, now, states };
    assert.equal(desk.deskFacts(ctx).label.phase, live ? 'live' : 'last');
    for (const id of DESK_IDS) {
      assert.deepEqual(want.bars[id].map(w => w.day), SESSIONS);
      assert.ok(want.bars[id].every(w => w.units !== null), `${id}: every session has a figure`);
      const bars = htmlDocument(deskCard(ctx, id)).querySelectorAll('.bars .b');
      assert.deepEqual(bars.map(b => [b.getAttribute('href'), b.getAttribute('aria-label'), b.querySelector('.bl.out').textContent, /\btoday\b/.test(b.getAttribute('class'))]),
        want.bars[id].map(w => [w.href, w.name, w.label, w.today]), `${id} at ${when}`);
    }
    if (live) {
      // The browser's stale step: 75 s later, with the board's own Results state.
      const later = at(when, 75), staleStates = boardStates(feeds, later);
      assert.equal(staleStates['today.dayPnl'].state, 'stale');
      const stale = { feeds, now: later, states: staleStates };
      for (const id of DESK_IDS) {
        const bars = htmlDocument(deskCard(stale, id)).querySelectorAll('.bars .b'), today = bars.at(-1);
        assert.equal(bars.length, 10);
        assert.ok(today.querySelector('i.nx') && !today.querySelector('i.live') && today.querySelectorAll('.bl').length === 0, id);
        assert.match(today.getAttribute('aria-label'), new RegExp(`^Today · Wed 14${NB}Oct: [^€]+$`));
        assert.deepEqual(bars.slice(0, -1).map(b => b.getAttribute('aria-label')), want.bars[id].slice(0, -1).map(w => w.name));
      }
    }
    if (!live) {
      const first = htmlDocument(desk.heroLeft(ctx)).querySelector('[data-cell="hero.day"]');
      assert.equal(first.querySelector('.fig-link').getAttribute('href'), '#results?period=day&date=2026-10-14&desk=all');
      assert.equal(first.querySelector('.fig-link').getAttribute('aria-label'), `Last session · Wed 14${NB}Oct: ${eur(want.last.units, true)}. Opens Results for that day.`);
      assert.equal(first.querySelector('.pct-slot .basis').textContent, `of ${eur(want.last.base)}`);
      assert.equal(first.querySelector('.pct-slot .performance-pct').textContent, desk.percentHtml(want.last.percent).replace(/<[^>]+>/g, ''));
      for (const id of DESK_IDS) {
        const link = htmlDocument(deskCard(ctx, id)).querySelector('.dnums .fig-link');
        assert.equal(link.getAttribute('href'), `#results?period=day&date=2026-10-14&desk=${id}`);
        assert.ok(link.getAttribute('aria-label').includes(`: ${eur(want.last.desks[id], true)}. Opens Results`), id);
      }
    }
  }
  // The one-row variant (quietJoelChecks): accepted; Joel is one row with his
  // positions inside, and keeps it when the positions panel goes stale.
  const quiet = quietJoelResults(P3_NOW); delete quiet.receivedAt;
  const quietIndex = indexResults(preflightSnapshot('results', quiet, null, P3_NOW).value);
  const data = preflightSnapshot('data', scenario(P3_NOW).snapshot, null, P3_NOW).value;
  for (const [later, held] of [[at(P3_NOW, 9), `1${NB}position`], [at(P3_NOW, 75), 'positions not current']]) {
    const feeds = { data: { value: data }, results: { value: { ...quietIndex.meta, index: quietIndex } } };
    const ctx = { feeds, now: later, states: boardStates(feeds, later) }, facts = desk.deskFacts(ctx);
    assert.deepEqual(DESK_IDS.map(id => desk.noTradesSinceStart(ctx, facts, id)), [null, null, '2026-09-10'], later);
    assert.ok(text(htmlDocument(deskCard(ctx, 'joel')).querySelector('.drow .who')).endsWith(`· no trades since 10${NB}Sep · ${held}`), later);
  }
});
