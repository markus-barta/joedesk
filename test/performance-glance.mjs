// Focused JOED-77 checks; no server, browser or full-suite runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
const { boardStates } = await import('../public/joe/board-state.js');
import { copyText } from '../scripts/browser/shots.mjs';
const { joinUnits, eur } = await import('../public/joe/format.js');
const { STARTING_MONEY, SINCE_START, sinceStarts, exactMoney, exactCell, percentOf, todayPercent, sincePercent, rankDesks } = await import('../public/joe/performance.js');
const { boardCaptionCell, sharesBoardCaption, heroLeft, cardStatus, percentHtml, positionsHtml, compactDesk, healthPop } = await import('../public/joe/desk.js');
// JOED-156: the whole account (with Cash) fills the slot above the hero.
const { accountSkeleton, cashPart } = await import('../public/joe/account.js');
const { cellReason } = await import('../public/joe/health.js');
const { boardHealthPresentation } = await import('../public/joe/health.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { tile, two } = await builders('results.js', ['tile', 'two']);
const { TERMS } = await import('../public/joe/terms.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const money = amount => ({ amount, currency: 'EUR' });
const cell = (amount, extra = {}) => ({ state: 'fresh', value: amount === null ? null : money(amount), retained: false, reason: null,
  valueReceivedAt: valid.data.receivedAt, ageSeconds: 9, ...extra });
function context(seconds = 9) {
  const feeds = { data: { value: structuredClone(valid.data) } };
  const now = new Date(Date.parse(valid.data.receivedAt) + seconds * 1000).toISOString();
  return { feeds, now, states: panelStates(feeds, now) };
}

for (const [result, base, expected] of [
  ['50', '1000', 500n], ['-50', '1000', -500n], ['0', '1000', 0n],
  ['0.00000001', '0.000001', 100n], ['1', '32', 313n], ['-1', '32', -313n],
  ['1', '3', 3333n], ['-1', '3', -3333n],
]) test(`percent ${result} / ${base}: exact, signed and rounded once`, () => {
  assert.equal(percentOf(decimalUnits(result), decimalUnits(base)), expected);
});

test('zero, negative, unknown and inexact bases never produce a percentage', () => {
  for (const base of [0n, -1n, null, undefined, 100, '100']) assert.equal(percentOf(1n, base), null);
  for (const result of [null, undefined, 1, '1']) assert.equal(percentOf(result, 100n), null);
  for (const value of [null, money('bad'), money('0.000000001'), { amount: 10, currency: 'EUR' }, { amount: '10', currency: 'USD' }]) assert.equal(exactMoney(value), null);
});

test('Today divides by exact money at the start of today, including negative days', () => {
  const states = { 'today.dayPnl': cell('50'), 'today.equity': cell('1050') };
  assert.equal(todayPercent(states), 500n);
  states['today.dayPnl'] = cell('-50'); states['today.equity'] = cell('950');
  assert.equal(todayPercent(states), -500n);
  states['today.dayPnl'] = cell('0'); states['today.equity'] = cell('1000');
  assert.equal(todayPercent(states), 0n);
  states['today.dayPnl'] = cell('1000');
  assert.equal(todayPercent(states), null);
});

test('Today never rounds large money through a Number or subtracts rounded cents', () => {
  const states = { 'today.dayPnl': cell('10000000000000000000.00000001'), 'today.equity': cell('10000000000000000001.00000001') };
  assert.equal(todayPercent(states), 100000000000000000000000n);
  states['today.dayPnl'] = cell('0.00000001'); states['today.equity'] = cell('0.00000101');
  assert.equal(todayPercent(states), 100n);
});

test('unknown, not-exact, retained, mismatched and estimated Today inputs omit %', () => {
  const states = { 'today.dayPnl': cell('50'), 'today.equity': cell('1050') };
  for (const key of Object.keys(states)) for (const extra of [
    { value: null }, { reason: 'not_exact_yet' }, { state: 'broken', reason: 'baseline_pending' },
    { state: 'not reported' }, { retained: true }, { valueReceivedAt: '2026-10-01T00:00:00.000Z' },
  ]) assert.equal(todayPercent({ ...states, [key]: { ...states[key], ...extra } }), null, `${key}: ${JSON.stringify(extra)}`);
  assert.equal(todayPercent(states, { method: 'session-open-estimate' }), null);
  const stale = Object.fromEntries(Object.entries(states).map(([k, c]) => [k, { ...c, state: 'stale', reason: 'snapshot_stale' }]));
  assert.equal(todayPercent(stale), null, 'a stopped feed keeps its state caption but cannot supply a percentage');
});

test('Since start retains established aggregate capital and suppresses unknown results', () => {
  assert.equal(STARTING_MONEY, decimalUnits('15000'));
  assert.equal(sincePercent({ 'today.totalPnl': cell('150') }), 100n);
  assert.equal(sincePercent({ 'today.totalPnl': cell('-150') }), -100n);
  for (const c of [null, cell(null), cell('150', { retained: true }), cell('150', { reason: 'not_exact_yet' })]) {
    assert.equal(exactCell(c), null);
    assert.equal(sincePercent({ 'today.totalPnl': c }), null);
  }
});

test('percentage display has two decimals, true minus, semantic tones and no invented dash', () => {
  assert.equal(percentHtml(null), '');
  for (const [value, text, tone] of [[313n, '+3,13 %', 'gain'], [-313n, '−3,13 %', 'loss'], [0n, '0,00 %', '']]) {
    const el = htmlDocument(percentHtml(value)).querySelector('.performance-pct');
    assert.equal(el.textContent, text);
    assert.equal(el.getAttribute('class'), `performance-pct${tone ? ` ${tone}` : ''}`);
  }
});

test('ranking is exact, descending, stable in current order, with unknown results last', () => {
  const order = ['j', 'joe', 'joel'];
  const states = { 'desks.j.totalPnl': cell('-10'), 'desks.joe.totalPnl': cell('0'), 'desks.joel.totalPnl': cell('10') };
  assert.deepEqual(rankDesks(states, order), ['joel', 'joe', 'j']);
  assert.deepEqual(order, ['j', 'joe', 'joel'], 'input order is not mutated');
  states['desks.j.totalPnl'] = cell('10');
  assert.deepEqual(rankDesks(states, ['joel', 'j', 'joe']), ['joel', 'j', 'joe']);
  states['desks.joe.totalPnl'] = cell(null);
  states['desks.j.totalPnl'] = cell('10000000000000000000.00000001');
  states['desks.joel.totalPnl'] = cell('10000000000000000000.00000002');
  assert.deepEqual(rankDesks(states, order), ['joel', 'j', 'joe']);
  assert.deepEqual(rankDesks({}, ['joel', 'joe', 'j']), ['joel', 'joe', 'j']);
});

test('hero keeps the desks’ four figures and promotes Since start beside Today; the whole account sits in its block above', () => {
  const ctx = context(), doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelectorAll('[data-cell]').length, 4);
  assert.deepEqual(doc.querySelectorAll('.performance .primary').map(el => el.dataset.cell), ['hero.day', 'hero.since']);
  assert.equal(doc.querySelectorAll('.performance-pct').length, 2);
  // Amy's A4: every desk counts from 10 Sep 2026 (New York), so the label names the day.
  assert.equal(doc.querySelector('[data-cell="hero.since"] .term').textContent, 'Since 10\u00a0Sep');
  // JOED-153: the summary row is Open result and Desks' money; the kept holdings never enter a desk figure.
  assert.deepEqual(doc.querySelectorAll('.kpi dt').map(el => el.textContent), ['Open result', 'Desks’ money']);
  assert.equal(doc.querySelector('.desk-scope').textContent, 'Desk figures never include the kept holdings. The whole account, with them, is at the top.');
  assert.equal(doc.querySelector('[data-cell="hero.day"] .bn').textContent, '−€1,00');
  // JOED-156: the paper account, kept holdings included, and Cash are the whole-account block's, once.
  const whole = htmlDocument(accountSkeleton());
  assert.equal(whole.querySelector('#acctTitle .acct-wide').textContent, 'IB paper account · whole account');
  assert.equal(whole.querySelector('.acct-chip.keep').textContent, 'incl. kept holdings');
  assert.equal(htmlDocument(cashPart(ctx.states.paperCash)).querySelectorAll('[data-cash="acct.cash"]').length, 1);
  assert.doesNotMatch(heroLeft(ctx), /data-cash=|hero\.account/, 'neither is a desk figure');
});

// JOED-49's Cash on Desk is the whole account's (JOED-156): two decimals, the
// broker's exact lexeme in the name, and Desk's dash rules for every state.
test('Desk’s Cash, in the whole account, preserves exact values and keeps unavailable wording beside its dash', () => {
  for (const cash of [
    cell('12345.67890123'), cell('12345.67890123', { state: 'stale', reason: 'snapshot_stale' }),
    cell(null, { state: 'not reported', reason: 'feed_not_received' }),
    cell(null, { state: 'broken', reason: 'gateway_unconfirmed' }),
    cell(null, { state: 'broken', reason: 'source_unavailable' }),
    cell(null, { state: 'broken', reason: 'not_exact_yet' }),
    cell('12345.67890123', { state: 'broken', retained: true, reason: 'gateway_unconfirmed' }),
  ]) {
    const doc = htmlDocument(cashPart(cash)), actual = doc.querySelector('[data-cash="acct.cash"]');
    const hasValue = Boolean(cash.value && !cash.retained), why = cash.reason ? cellReason(cash.reason) : null;
    const plain = actual.textContent.replace(/\s+/g, ' ').trim(), name = actual.getAttribute('aria-label');
    assert.equal(name, actual.getAttribute('title'));
    assert.equal(actual.dataset.state, cash.state);
    assert.equal(actual.querySelector('b').textContent, hasValue ? '€\u00a012.345,68' : '—', 'two decimals, one unit, or a dash (an outage’s kept Cash is withheld)');
    assert.equal(Boolean(actual.querySelector('b.muted')), !hasValue);
    if (hasValue) {
      assert.equal(plain, `Cash € 12.345,68${why ? ` · ${why}` : ''}`);
      assert.equal(name, `Cash: EUR 12345.67890123${why ? ` · ${why}` : ''}`, 'the broker’s exact lexeme');
    } else if (cash.reason === 'not_exact_yet') {
      // JOED-148: a not-exact Cash is named like every other not-exact dash.
      assert.equal(plain, 'Cash — · not exact');
      assert.equal(name, 'Cash: not exact');
    } else {
      assert.equal(plain, `Cash — · ${why}`);
      assert.equal(name, `Cash ${why}`);
    }
    if (cash.reason === 'gateway_unconfirmed') assert.match(plain, /broker connection not confirmed/);
    if (cash.reason === 'snapshot_stale') assert.match(plain, /updates are late/);
  }
});

test('JOED-158 Cash: a shared missing-value reason stays in the account change line and in the Cash name', () => {
  const cash = cell(null, { state: 'broken', reason: 'source_unavailable' });
  const figure = htmlDocument(cashPart(cash, cash.reason)).querySelector('[data-cash="acct.cash"]');
  assert.equal(figure.textContent, 'Cash —');
  assert.equal(figure.getAttribute('aria-label'), 'Cash not reported by the broker');
  assert.equal(figure.getAttribute('title'), figure.getAttribute('aria-label'));
});

test('omitted Cash is a muted dash with the missing-data explanation beside it', () => {
  const ctx = context();
  delete ctx.states.paperCash;
  const figure = htmlDocument(cashPart(ctx.states.paperCash)).querySelector('[data-cash="acct.cash"]');
  assert.equal(figure.querySelector('b.muted').textContent, '—');
  assert.equal(figure.textContent.replace(/\s+/g, ' ').trim(), 'Cash — · no data received yet');
  assert.equal(figure.getAttribute('aria-label'), 'Cash no data received yet');
  assert.equal(figure.dataset.state, 'not reported');
});

// The fixture's open desk positions, as the fresh positions panel lists them.
const positionCount = ctx => ctx.states.positions.value.filter(row => row.quantity == null || decimalUnits(row.quantity) !== 0n).length;
test('AC-19 supporting captions and Cash explanation survive phone separator typography', () => {
  const ctx = context();
  delete ctx.states.paperCash;
  for (const joinDot of [false, true]) {
    const hero = htmlDocument(heroLeft(ctx)), cash = htmlDocument(cashPart(ctx.states.paperCash));
    const captions = [...hero.querySelectorAll('.kpi')].map(figure => joinUnits(figure.querySelector('.account-caption').children[0].textContent, { joinDot }));
    // Cash's explanation, in the whole account's line above the hero (JOED-156).
    const reason = joinUnits(cash.querySelector('[data-cash]').textContent.replace(/\s+/g, ' ').trim().replace(/^Cash — · /, ''), { joinDot });
    assert.deepEqual(copyText(captions), [`${positionCount(ctx)}\u00a0position · changes until they close`, `started with ${eur(STARTING_MONEY, false, 0)} on 10\u00a0Sep`]);
    assert.equal(copyText(reason), 'no data received yet');
    if (joinDot) assert.match(joinUnits(cash.querySelector('[data-cash]').textContent, { joinDot }), /—\u00a0·/);
  }
});

test('shared stale captions appear once, with local subtle state icons intact', () => {
  const ctx = context(75), board = boardCaptionCell(ctx), doc = htmlDocument(heroLeft(ctx));
  assert.match(doc.querySelector('.board-caption').textContent, /As of 1 min ago · updates are late/);
  assert.doesNotMatch(doc.querySelector('.say').textContent, /updates are late/);
  assert.equal(doc.querySelector('[data-cell="hero.since"] .account-caption').children[0].textContent, '');
  assert.equal(doc.querySelectorAll('.cell-state').length, 4);
  for (const id of ['j', 'joe', 'joel']) {
    const c = htmlDocument(deskCard(ctx, id));
    assert.equal(c.querySelectorAll('.cell-state').length, 3);
    assert.doesNotMatch(c.querySelector('.spark-h').textContent, /updates are late/);
    assert.equal(cardStatus(id, [['Today', ctx.states[`desks.${id}.dayPnl`]]], board), '');
  }
});

test('different reasons, ages, retained observations and missing values keep local captions', () => {
  const ctx = context(75), board = boardCaptionCell(ctx), original = ctx.states['today.openPnl'];
  assert.equal(sharesBoardCaption(original, board), true);
  for (const extra of [{ ageSeconds: 74 }, { state: 'broken' }, { retained: true }, { value: null }, { reason: 'producer_frozen' }]) {
    const c = { ...original, ...extra };
    assert.equal(sharesBoardCaption(c, board), false);
    assert.ok(cardStatus('j', [['Open positions', c]], board));
  }
  const differingAges = htmlDocument(cardStatus('j', [['Today', { ...original, ageSeconds: 90 }], ['Open positions', { ...original, ageSeconds: 150 }]], board));
  assert.equal(differingAges.querySelectorAll('.st').length, 2, 'different local ages never collapse into one caption');
  const data = ctx.feeds.data.value;
  data.totals.openPnl = null; (data.totals.reasons ??= {}).openPnl = 'open_pnl_unavailable';
  ctx.states = boardStates(ctx.feeds, ctx.now, ctx.states);
  const doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelector('[data-cell="hero.open"] .bn').textContent, '—');
  assert.equal(doc.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, 'Waiting on prices');
});

test('no snapshot keeps every original missing explanation and omits both percentages', () => {
  const ctx = { feeds: {}, now: valid.data.receivedAt, states: panelStates({}, valid.data.receivedAt) };
  const doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelectorAll('.performance-pct').length, 0);
  assert.equal(boardCaptionCell(ctx), null);
  assert.match(doc.querySelector('.say').textContent, /No numbers yet/);
  assert.match(doc.querySelector('[data-cell="hero.since"] .account-caption').children[0].textContent, /Not reported/);
});

test('per-desk base omission is explained and position open results retain native currency', () => {
  const ctx = context();
  assert.match(TERMS.since[1], /do not provide a starting base per desk/);
  for (const id of ['j', 'joe', 'joel']) assert.doesNotMatch(deskCard(ctx, id), /performance-pct/);
  ctx.states.positions.value = [{ desk: 'j', symbol: 'ABC', side: 'long', quantity: '1', scope: 'stage0',
    mark: { amount: '10', currency: 'USD' }, marketValue: { amount: '10', currency: 'USD' }, openPnl: { amount: '2', currency: 'USD' } }];
  assert.match(positionsHtml(ctx).sub, /each in its own currency/);
  assert.match(positionsHtml(ctx).html, /\$/);
});

test('all eight metric info buttons preserve their original term and explanation hooks', () => {
  for (const key of ['trades', 'won', 'avgtrade', 'pf', 'typical', 'besttrade', 'dip', 'bestday']) {
    const doc = htmlDocument(tile(key, '—', 'Unavailable'));
    const button = doc.querySelector('.metric-info');
    assert.equal(button.dataset.term, key);
    assert.equal(button.dataset.learn, '1');
    assert.equal(button.getAttribute('aria-label'), `Learn about ${TERMS[key][0]}`);
    assert.equal(button.textContent, '');
    assert.match(button.innerHTML || tile(key, '—', ''), /#i-info/);
  }
  const pair = htmlDocument(two('+€100.000,12', '−€99.999,99'));
  assert.equal(pair.querySelectorAll('.pair-value').length, 2);
  assert.equal(pair.textContent, '+€100.000,12/−€99.999,99');
});

// JOED-148 A4 (Amy 2026-10-29): Since start counts from 10 Sep 2026, New York,
// for all three desks; a desk's own accounting date wins for that desk.
test('JOED-148 A4: Since start names its day and its basis from the configured starting money', () => {
  assert.equal(SINCE_START, '2026-09-10');
  const ctx = context(), doc = htmlDocument(heroLeft(ctx));
  for (const node of doc.querySelectorAll('.cash-sizing')) node.remove();
  const since = doc.querySelector('[data-cell="hero.since"]');
  assert.equal(since.querySelector('.term').textContent, 'Since 10 Sep');
  // JOED-153: the basis sits beside the percentage it defines; the caption says what is counted.
  assert.equal(since.querySelector('.pct-slot').textContent, `−0,01\u00a0% of ${eur(STARTING_MONEY, false, 0)}`);
  assert.equal(since.querySelector('.account-caption').children[0].textContent, 'after fees, incl. open positions');
  assert.equal(since.querySelector('.phone-primary-note').textContent, 'after fees, incl. open positions');
  assert.equal(doc.querySelector('[data-cell="hero.equity"] .account-caption').children[0].textContent, `started with ${eur(STARTING_MONEY, false, 0)} on 10 Sep`);
  for (const id of ['j', 'joe', 'joel']) {
    const card = htmlDocument(deskCard(ctx, id));
    assert.equal(card.querySelectorAll('.dnums .term')[2].textContent, 'Since 10 Sep', id);
    // The phone row says "Since"; the Desks heading carries the one start day.
    assert.equal(htmlDocument(compactDesk(ctx, id)).querySelectorAll('.compact-label')[1].textContent, 'Since');
  }
  assert.equal(sinceStarts(ctx.feeds).common, SINCE_START);
});

test('JOED-148 A4: a desk’s own accounting start wins; another Results start leaves the date off and Details flags it', () => {
  const ctx = context();
  ctx.feeds.data.value.desks[0].accounting = { periodStart: '2026-09-12T04:00:00.000Z', method: 'execution-fifo-net-current-fx' };
  assert.deepEqual(sinceStarts(ctx.feeds).days, { j: '2026-09-12', joe: SINCE_START, joel: SINCE_START });
  let doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelector('[data-cell="hero.since"] .term').textContent, 'Since start', 'no single day for the household');
  for (const node of doc.querySelectorAll('.cash-sizing')) node.remove();
  assert.equal(doc.querySelector('[data-cell="hero.equity"] .account-caption').children[0].textContent, `started with ${eur(STARTING_MONEY, false, 0)}`);
  assert.equal(htmlDocument(deskCard(ctx, 'j')).querySelectorAll('.dnums .term')[2].textContent, 'Since 12 Sep');
  assert.equal(htmlDocument(deskCard(ctx, 'joe')).querySelectorAll('.dnums .term')[2].textContent, 'Since 10 Sep');
  assert.equal(htmlDocument(compactDesk(ctx, 'j')).querySelectorAll('.compact-label')[1].textContent, 'Since 12 Sep');
  // Results agreeing changes nothing; Results starting elsewhere drops the board's date.
  delete ctx.feeds.data.value.desks[0].accounting;
  ctx.feeds.results = { value: { trackingStart: SINCE_START } };
  assert.equal(sinceStarts(ctx.feeds).conflict, false);
  assert.equal(htmlDocument(heroLeft(ctx)).querySelector('[data-cell="hero.since"] .term').textContent, 'Since 10 Sep');
  ctx.feeds.results = { value: { trackingStart: '2026-09-12' } };
  assert.deepEqual(sinceStarts(ctx.feeds).days, { j: null, joe: null, joel: null });
  doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelector('[data-cell="hero.since"] .term').textContent, 'Since start');
  for (const id of ['j', 'joe', 'joel']) assert.equal(htmlDocument(deskCard(ctx, id)).querySelectorAll('.dnums .term')[2].textContent, 'Since start');
  const details = htmlDocument(healthPop(ctx, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now)));
  const flag = details.querySelectorAll('.st.warn').map(e => e.textContent);
  assert.ok(flag.includes('Since start dates differ: Results start on 12 Sep; J, Joe and Joel count from 10 Sep. Desk shows no date until they agree.'), flag.join(' | '));
  assert.equal(boardHealthPresentation(ctx.states, ctx.feeds, ctx.now).tone, 'green', 'a date question never changes the light');
});

// JOED-148 fix round 1 (gate finding 2): Results is checked against each desk's
// effective start (its own accounting date, else SINCE_START), never against the
// fallback alone, and the warning names the days the desks actually count from.
const accountingStart = (ctx, ids, periodStart) => {
  for (const desk of ctx.feeds.data.value.desks) if (ids.includes(desk.id)) desk.accounting = { periodStart, method: 'execution-fifo-net-current-fx' };
};
const sinceView = ctx => {
  const hero = htmlDocument(heroLeft(ctx));
  for (const node of hero.querySelectorAll('.cash-sizing')) node.remove();
  const details = htmlDocument(healthPop(ctx, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now)));
  return {
    hero: hero.querySelector('[data-cell="hero.since"] .term').textContent,
    money: hero.querySelector('[data-cell="hero.equity"] .account-caption').children[0].textContent,
    cards: ['j', 'joe', 'joel'].map(id => htmlDocument(deskCard(ctx, id)).querySelectorAll('.dnums .term')[2].textContent),
    warning: details.querySelectorAll('.st.warn').map(e => e.textContent).find(text => text.startsWith('Since start dates differ')) ?? null,
  };
};
test('JOED-148 A4: desks that all send 12 Sep beside Results on 12 Sep read "Since 12 Sep" with no warning', () => {
  const ctx = context();
  accountingStart(ctx, ['j', 'joe', 'joel'], '2026-09-12T04:00:00.000Z');
  ctx.feeds.results = { value: { trackingStart: '2026-09-12' } };
  const starts = sinceStarts(ctx.feeds);
  assert.deepEqual([starts.common, starts.conflict, starts.differ], ['2026-09-12', false, []]);
  assert.deepEqual(sinceView(ctx), { hero: 'Since 12 Sep', money: `started with ${eur(STARTING_MONEY, false, 0)} on 12 Sep`,
    cards: ['Since 12 Sep', 'Since 12 Sep', 'Since 12 Sep'], warning: null });
});

test('JOED-148 A4: mixed and contradicting starts name each desk’s effective day in the warning', () => {
  const nb = ' ';
  for (const [what, own, results, expected] of [
    ['every desk’s own date against another Results day', ['j', 'joe', 'joel'], '2026-09-10',
      { hero: `Since 12${nb}Sep`, cards: [`Since 12${nb}Sep`, `Since 12${nb}Sep`, `Since 12${nb}Sep`],
        warning: `Since start dates differ: Results start on 10${nb}Sep; J, Joe and Joel count from 12${nb}Sep.` }],
    ['J’s own date agrees, the fallback does not', ['j'], '2026-09-12',
      { hero: 'Since start', cards: [`Since 12${nb}Sep`, 'Since start', 'Since start'],
        warning: `Since start dates differ: Results start on 12${nb}Sep; J counts from 12${nb}Sep, Joe and Joel from 10${nb}Sep. Desk shows no date for Joe and Joel until they agree.` }],
    ['J’s own date disagrees, the fallback agrees', ['j'], '2026-09-10',
      { hero: 'Since start', cards: [`Since 12${nb}Sep`, `Since 10${nb}Sep`, `Since 10${nb}Sep`],
        warning: `Since start dates differ: Results start on 10${nb}Sep; J counts from 12${nb}Sep, Joe and Joel from 10${nb}Sep.` }],
    ['no own dates against another Results day', [], '2026-09-12',
      { hero: 'Since start', cards: ['Since start', 'Since start', 'Since start'],
        warning: `Since start dates differ: Results start on 12${nb}Sep; J, Joe and Joel count from 10${nb}Sep. Desk shows no date until they agree.` }],
  ]) {
    const ctx = context();
    accountingStart(ctx, own, '2026-09-12T04:00:00.000Z');
    ctx.feeds.results = { value: { trackingStart: results } };
    const view = sinceView(ctx);
    assert.deepEqual({ hero: view.hero, cards: view.cards, warning: view.warning }, expected, what);
    assert.doesNotMatch(view.warning, /bookkeeping on/, `${what}: never the fallback alone`);
  }
});
