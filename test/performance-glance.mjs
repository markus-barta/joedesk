// Focused JOED-77 checks; no server, browser or full-suite runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
const { STARTING_MONEY, exactMoney, exactCell, percentOf, todayPercent, sincePercent, rankDesks } = await import('../public/joe/performance.js');
const { boardCaptionCell, sharesBoardCaption, heroLeft, cardStatus, percentHtml, positionsHtml } = await import('../public/joe/desk.js');
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
  assert.equal(todayPercent(stale), 500n, 'an exact stale observation stays usable with its state caption');
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

test('hero preserves all five figures and promotes Since start beside Today', () => {
  const ctx = context(), doc = htmlDocument(heroLeft(ctx));
  assert.equal(doc.querySelectorAll('[data-cell]').length, 5);
  assert.deepEqual(doc.querySelectorAll('.performance .primary').map(el => el.dataset.cell), ['hero.day', 'hero.since']);
  assert.equal(doc.querySelectorAll('.performance-pct').length, 2);
  assert.equal(doc.querySelector('[data-cell="hero.since"] .term').textContent, 'Since start');
  assert.equal(doc.querySelectorAll('.kpi').length, 4);
  assert.deepEqual(doc.querySelectorAll('.kpi dt').map(el => el.textContent), ['Open positions', 'Desks’ money', 'Paper account', 'Cash']);
  assert.equal(doc.querySelector('[data-cell="hero.day"] .bn').textContent, '−€1,00');
});

test('separate Cash figure preserves exact values, reasons and stable caption reserves', () => {
  const ctx = context(), reserve = html => htmlDocument(html).querySelector('.cash-kpi .cash-reserve').children.slice(1).map(el => el.textContent);
  let baseline;
  for (const cash of [
    cell('12345.67890123'), cell('12345.67890123', { state: 'stale', reason: 'snapshot_stale' }),
    cell(null, { state: 'broken', reason: 'gateway_unconfirmed' }),
    cell('12345.67890123', { state: 'broken', retained: true, reason: 'gateway_unconfirmed' }),
  ]) {
    ctx.states.paperCash = cash;
    const html = heroLeft(ctx), doc = htmlDocument(html), figure = doc.querySelector('.cash-kpi');
    const actual = figure.querySelector('[data-cash="hero.cash"]');
    assert.equal(figure.querySelector('.cash-caption').textContent, 'cash · as the broker reports it');
    assert.equal(actual.getAttribute('aria-label'), actual.getAttribute('title'));
    assert.equal(figure.querySelector('.cash-amount').textContent, cash.value && !cash.retained ? '€ 12.345,68' : 'not reported');
    if (cash.reason) assert.match(actual.textContent, cash.reason === 'snapshot_stale' ? /updates are late/ : /broker connection not confirmed/);
    baseline ??= reserve(html);
    assert.deepEqual(reserve(html), baseline);
  }
});

test('shared stale captions appear once, with local subtle state icons intact', () => {
  const ctx = context(75), board = boardCaptionCell(ctx), doc = htmlDocument(heroLeft(ctx));
  assert.match(doc.querySelector('.board-caption').textContent, /As of 1 min ago · updates are late/);
  assert.doesNotMatch(doc.querySelector('.say').textContent, /updates are late/);
  assert.equal(doc.querySelector('[data-cell="hero.since"] .account-caption').children[0].textContent, '');
  assert.equal(doc.querySelectorAll('.cell-state').length, 5);
  for (const id of ['j', 'joe', 'joel']) {
    const c = htmlDocument(deskCard(ctx, id, 10, true));
    assert.equal(c.querySelectorAll('.cell-state').length, 3);
    assert.doesNotMatch(c.querySelector('.mini-label').textContent, /updates are late/);
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
  ctx.states['today.openPnl'] = { ...original, state: 'broken', reason: 'open_pnl_unavailable', retained: true };
  const doc = htmlDocument(heroLeft(ctx));
  assert.match(doc.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, /Last good value, 1 min ago · open result not available/);
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
  for (const id of ['j', 'joe', 'joel']) assert.doesNotMatch(deskCard(ctx, id, 10, true), /performance-pct/);
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
