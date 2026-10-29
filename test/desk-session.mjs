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
function record(receivedAt = '2026-10-15T11:00:00.000Z') {
  const trades = TRADES.map((t, i) => ({ id: `rt-desk-session-${i}`, desk: t.desk, symbol: 'DEMO', company: 'Demo', side: 'long', quantity: '1',
    openedAt: '2026-10-01T14:00:00.000Z', closedAt: t.at, entryPrice: { amount: '10', currency: 'USD' }, exitPrice: { amount: '11', currency: 'USD' },
    grossEur: money(t.gross), feesEur: money(t.fees), netEur: money(t.net),
    fx: { base: 'USD', quote: 'EUR', rate: '0.9', source: 'fixture-close-rate', observedAt: t.at }, method: 'execution-fifo-net-current-fx' }));
  const days = SESSIONS.map((date, i) => ({ date, ...(PARTIAL[date] ? { coverage: 'partial', partialReasons: PARTIAL[date] } : {}),
    desks: Object.fromEntries(DESK_IDS.map(id => {
      const own = TRADES.filter(t => t.desk === id && t.day === date);
      return [id, { equityClose: money(CLOSE[id][i]), realisedNet: money(own.reduce((s, t) => s + Number(t.net), 0)),
        fees: money(own.reduce((s, t) => s + Number(t.fees), 0).toFixed(1)), trades: own.length }];
    })) }));
  const value = { schema: 'inspr.joe.household.results.v2', seq: 7, generatedAt: receivedAt, receivedAt, currency: 'EUR', timeZone: 'Europe/Vienna',
    trackingStart: '2026-09-10', days, trades, benchmark: null };
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
function context(now = NOW, { results = true, data = null } = {}) {
  const snapshot = data ?? snapshotAt(new Date(Date.parse(now) - 9000).toISOString());
  const feeds = { data: { value: snapshot } }, states = boardStates(feeds, now);
  if (results) {
    const value = record(), index = indexResults(value);
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
  assert.equal(hero.querySelector('.say').textContent, `Wednesday: J +€${NB}10,00 · Joe +€${NB}2,00 · Joel flat · 1${NB}position held overnight`);
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

test('JOED-153 M5: a desk with no trades since the start is one row, its figures still honest', () => {
  const ctx = context(), facts = desk.deskFacts(ctx);
  assert.deepEqual(DESK_IDS.map(id => desk.noTradesSinceStart(ctx, facts, id)), [false, false, true]);
  const row = htmlDocument(deskCard(ctx, 'joel'));
  assert.ok(row.querySelector('.drow'));
  assert.equal(text(row.querySelector('.who')), `Joel · sitting out · no trades since 10${NB}Sep`);
  assert.deepEqual(row.querySelectorAll('.dnums .term').map(t => t.textContent), ['Today', `Since 10${NB}Sep`]);
  assert.deepEqual(row.querySelectorAll('.dnums .v').map(v => v.textContent), ['€0,00', '€0,00']);
  assert.equal(row.querySelectorAll('.bars').length, 0);
  // Unknown is never "none": without the record, or with an old positions panel, Joel keeps the full card.
  const noRecord = context(NOW, { results: false });
  assert.equal(desk.noTradesSinceStart(noRecord, desk.deskFacts(noRecord), 'joel'), false);
  const stale = context(); stale.states.positions = { ...stale.states.positions, state: 'stale', reason: 'snapshot_stale' };
  assert.equal(desk.noTradesSinceStart(stale, desk.deskFacts(stale), 'joel'), false);
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
  const rules = [...css.matchAll(/@container spark \(max-width: ([\d.]+)px\) \{ \.bars\[data-need="(\d+)"\] \.b:not\(:hover\):not\(:focus-visible\) \.bl\.out:not\(\.keep\) \{ visibility: hidden; \} \}/g)];
  assert.deepEqual(rules.map(m => Number(m[2])), Array.from({ length: 16 }, (_, i) => 100 + 20 * i));
  assert.ok(rules.every(m => Number(m[1]) === Number(m[2]) - 0.02));
  const ctx = context(), needs = new Set();
  // Joel's one-row card (no trades) draws no bars.
  for (const id of DESK_IDS) { const bars = htmlDocument(deskCard(ctx, id)).querySelector('.bars'); if (bars) needs.add(bars.dataset.need); }
  assert.ok(needs.size >= 1 && [...needs].every(n => rules.some(m => m[2] === n)), [...needs].join());
  for (const c of [2, 3, 4, 5, 6, 7]) assert.match(css, new RegExp(`@container spark \\(min-width: \\d+px\\) \\{ \\.bars \\.b\\[data-c="${c}"\\] \\.bl\\.in \\{ display: block; \\}`));
});

// The browser check (scripts/browser/desk-sessions.mjs) expects what Desk
// renders from the same design fixtures, and both fixtures pass the board's
// ingress, so the browser gate can fail only on what the page draws.
test('JOED-153 browser fixture: the session checks expect what Desk renders from the design record', async () => {
  const { expectedSessions, SESSIONS, BEFORE_OPEN } = await import('../scripts/browser/desk-sessions.mjs');
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
});
