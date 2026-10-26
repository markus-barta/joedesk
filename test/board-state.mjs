// Focused board policy checks: no server process, browser or full-suite runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates, MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { validateContract } from '../contracts/index.mjs';
import { decimalUnits, unitsDecimal } from '../contracts/decimal.mjs';
const { boardStates, NOT_EXACT_REASONS, RETENTION_SECONDS } = await import('../public/joe/board-state.js');
const { exactCell, rankDesks, todayPercent, sincePercent } = await import('../public/joe/performance.js');
const { cellView, heroLeft, keptHtml, positionsHtml } = await import('../public/joe/desk.js');
const { resultsView } = await import('../public/joe/results.js');
const { createFeed } = await import('../public/joe/feed.js');
const { bookkeepingHtml } = await builders('history.js', ['bookkeepingHtml']);
const exact = JSON.parse(readFileSync(new URL('../fixtures/phase-b.json', import.meta.url))).exact;
const DESKS = ['j', 'joe', 'joel'];
const at = seconds => new Date(Date.parse(exact.receivedAt) + seconds * 1000).toISOString();
const previous = panelStates({ data: { value: exact } }, exact.receivedAt);
const ctx = (data, seconds = 30, reason = null) => {
  const feeds = { data: { value: data, reason } }, now = at(seconds);
  return { feeds, now, states: boardStates(feeds, now, previous) };
};
function missing(reason) {
  const data = structuredClone(exact);
  data.generatedAt = data.receivedAt = at(20);
  data.safety.gateway.checkedAt = at(20);
  for (const bag of [data.totals, ...data.desks.map(d => d.money)]) {
    bag.reasons = Object.fromEntries(MONEY_FIELDS.map(field => [field, reason]));
    for (const field of MONEY_FIELDS) bag[field] = null;
  }
  for (const sources of [data.pnlSources, ...data.desks.map(d => d.pnlSources)]) {
    for (const source of Object.values(sources)) Object.assign(source, { status: 'unavailable', method: null, observedAt: null, reason });
  }
  assert.equal(validateContract('data', data).ok, true);
  return data;
}

for (const reason of NOT_EXACT_REASONS) test(`${reason}: previous accepted money never fills the dash, even behind a feed/gateway failure`, () => {
  const data = missing(reason);
  for (const feedReason of [null, 'refresh_failed']) {
    const view = ctx(data, 30, feedReason);
    for (const name of ['today', ...DESKS.map(id => `desks.${id}`)]) for (const field of MONEY_FIELDS) {
      const cell = view.states[`${name}.${field}`];
      assert.equal(cell.value, null, `${name}.${field}`);
      assert.equal(cell.retained, false);
      assert.equal(cellView(cell, 'value').html.includes('—'), true);
      assert.equal(exactCell(cell), null);
    }
    assert.equal(todayPercent(view.states), null);
    assert.equal(sincePercent(view.states), null);
  }
  data.safety.gateway.checkedAt = exact.receivedAt;
  assert.equal(ctx(data, 65).states['desks.j.equity'].value, null);
});

for (const reason of ['source_unavailable', 'gateway_down', 'upstream_lost']) test(`${reason}: individual last-good values stay marked below 60 min; sums, since-start and percentages stay unknown`, () => {
  const data = missing(reason);
  data.brokerAccount.equity = null; data.brokerAccount.reason = reason;
  const view = ctx(data, 59 * 60);
  const cell = view.states['desks.j.equity'];
  assert.deepEqual(cell.value, exact.desks[0].money.equity);
  assert.equal(cell.retained, true);
  assert.match(cellView(cell, 'equity').caption, /Last good value, .*59\smin ago.* · /);
  assert.match(cellView(cell, 'equity').caption, reason === 'source_unavailable' ? /not reported by the broker/ : /broker connection down/);
  for (const field of MONEY_FIELDS) assert.equal(view.states[`today.${field}`].value, null, field);
  for (const id of DESKS) assert.equal(view.states[`desks.${id}.totalPnl`].value, null, id);
  assert.equal(todayPercent(view.states), null);
  assert.equal(sincePercent(view.states), null);
  assert.deepEqual(resultsView(view).todayUnits, [null, null, null]);
  const hero = htmlDocument(heroLeft(view));
  for (const key of ['day', 'since', 'open', 'equity']) assert.equal(hero.querySelector(`[data-cell="hero.${key}"] .bn`).textContent, '—');
  assert.equal(hero.querySelectorAll('.performance-pct').length, 0);
  assert.equal(htmlDocument(bookkeepingHtml(view)).querySelector('.jtotal .muted').textContent, '—');
});

test('60-minute cutoff uses the last-good receipt, expires on ticks, and recovery shows fresh values', () => {
  const data = missing('source_unavailable');
  data.brokerAccount.equity = null; data.brokerAccount.reason = 'source_unavailable';
  for (const seconds of [RETENTION_SECONDS - 0.001, RETENTION_SECONDS, RETENTION_SECONDS + 1]) {
    const cell = ctx(data, seconds).states['desks.j.equity'];
    assert.equal(cell.value !== null, seconds < RETENTION_SECONDS);
    assert.equal(cell.retained, seconds < RETENTION_SECONDS);
    assert.equal(cell.reason, 'source_unavailable');
    if (seconds >= RETENTION_SECONDS) assert.equal(cellView(cell, 'equity').caption, 'Unavailable · not reported by the broker');
  }
  const recovered = structuredClone(exact);
  recovered.generatedAt = recovered.receivedAt = recovered.safety.gateway.checkedAt = at(4000);
  recovered.desks[0].money.equity.amount = '5500';
  recovered.totals.equity.amount = unitsDecimal(decimalUnits(exact.totals.equity.amount) + decimalUnits('350'));
  assert.equal(validateContract('data', recovered).ok, true);
  const view = ctx(recovered, 4000);
  assert.equal(view.states['desks.j.equity'].value.amount, '5500');
  assert.equal(view.states['desks.j.equity'].retained, false);
  assert.equal(view.states['desks.j.equity'].state, 'fresh');
});

test('undated last-good values fail closed and non-exact results cannot rank desks or feed Results', () => {
  const feeds = { data: { value: missing('source_unavailable') } };
  const undated = { ...previous, 'desks.j.equity': { value: exact.desks[0].money.equity, valueReceivedAt: null } };
  assert.equal(boardStates(feeds, at(30), undated)['desks.j.equity'].value, null);
  const states = structuredClone(previous);
  states['desks.j.totalPnl'] = { ...states['desks.j.totalPnl'], retained: true, value: { amount: '999999', currency: 'EUR' } };
  states['desks.joe.totalPnl'] = { ...states['desks.joe.totalPnl'], reason: 'sod_missing' };
  assert.deepEqual(rankDesks(states, DESKS), ['joel', 'j', 'joe']);
  for (const reason of NOT_EXACT_REASONS) {
    states['desks.j.equity'] = { ...states['desks.j.equity'], reason };
    assert.equal(resultsView({ states, feeds: {}, now: at(30) }).todayUnits[0], null);
  }
});

test('each exactness reason keeps individual position fields null after an accepted value, including a failed read', () => {
  for (const reason of NOT_EXACT_REASONS) for (const feedReason of [null, 'refresh_failed']) {
    const data = structuredClone(exact), row = data.positions.rows.find(p => p.scope !== 'keep');
    for (const field of ['quantity', 'mark', 'marketValue', 'dayPnl', 'openPnl']) {
      row[field] = null; (row.reasons ??= {})[field] = reason;
    }
    assert.equal(validateContract('data', data).ok, true);
    const view = ctx(data, 30, feedReason), shown = view.states.positions.value.find(p => p.symbol === row.symbol);
    for (const field of ['quantity', 'mark', 'marketValue', 'dayPnl', 'openPnl']) assert.equal(shown[field], null, `${reason}: ${field}`);
    assert.match(positionsHtml(view).html, /Last price: not reported/);
  }
});

test('retained position rows cannot feed kept-worth sums or relative bars; per-field exactness still wins', () => {
  const data = structuredClone(exact);
  data.safety.gateway.checkedAt = at(-20);
  const row = data.positions.rows.find(p => p.scope !== 'keep');
  row.mark = null; (row.reasons ??= {}).mark = 'not_exact_yet';
  assert.equal(validateContract('data', data).ok, true);
  const view = ctx(data, 45);
  const shown = view.states.positions.value.find(p => p.symbol === row.symbol);
  assert.equal(shown.mark, null);
  assert.equal(shown.reasons.mark, 'not_exact_yet');
  assert.equal(view.states.kept.retained, true);
  const kept = htmlDocument(keptHtml(view));
  assert.match(kept.querySelector('.pstate').textContent, /Last good values, .*45\ss ago.* · worth —$/);
  assert.match(kept.querySelector('.keep-cap').textContent, /paper account \(—\)/);
  assert.equal(htmlDocument(positionsHtml(view).html).querySelectorAll('.vbar i').length, 0);
  const expired = ctx(data, RETENTION_SECONDS, 'refresh_failed');
  for (const name of ['positions', 'kept', 'paperAccount']) assert.equal(expired.states[name].value, null, name);
});

test('caption sizing markup remains unchanged across retention and expiry', () => {
  const reserve = view => htmlDocument(heroLeft(view)).querySelectorAll('.cash-sizing').map(el => el.textContent);
  assert.ok(reserve(ctx(exact)).length > 0);
  assert.deepEqual(reserve(ctx(missing('source_unavailable'), 30)), reserve(ctx(missing('source_unavailable'), 3600)));
});

test('the actual feed adapter applies board policy on reads, failed refreshes, and expiry', async t => {
  const realFetch = globalThis.fetch;
  let now = exact.receivedAt, data = structuredClone(exact), rejected = false;
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  try {
    globalThis.fetch = async url => {
      const stateRead = String(url).includes('state.json');
      const body = stateRead ? { serverNow: now, feeds: { data: { value: data } }, panels: previous } : { reason: 'feed_not_received' };
      return new Response(JSON.stringify(body), { status: stateRead && !rejected ? 200 : 503, headers: { 'X-Joe-Server-Now': now } });
    };
    const feed = createFeed(() => {});
    await feed.refresh();
    assert.notEqual(feed.select().states['today.equity'].value, null);
    now = at(30); data = missing('not_exact_yet'); data.seq++;
    await feed.refresh();
    assert.equal(feed.select().states['desks.j.equity'].value, null);
    now = at(40); data = structuredClone(exact); data.seq += 2;
    data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = now;
    await feed.refresh();
    assert.equal(feed.select().states['desks.j.equity'].retained, false);
    rejected = true; now = at(70); elapsed = 30000;
    await feed.refresh();
    assert.equal(feed.select().states['desks.j.equity'].retained, true);
    assert.equal(feed.select().states['today.equity'].value, null);
    elapsed = RETENTION_SECONDS * 1000;
    assert.equal(feed.select().states['desks.j.equity'].value, null);
  } finally { globalThis.fetch = realFetch; }
});
