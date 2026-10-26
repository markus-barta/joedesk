// Focused board policy checks: no server process, browser or full-suite runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates, MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { validateContract } from '../contracts/index.mjs';
import { decimalUnits, unitsDecimal } from '../contracts/decimal.mjs';
const { boardStates, NOT_EXACT_REASONS, RETENTION_SECONDS } = await import('../public/joe/board-state.js');
const { exactCell, rankDesks, todayPercent, sincePercent } = await import('../public/joe/performance.js');
const { cellView, heroLeft, keptHtml, positionsHtml, compactDesk } = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { resultsView } = await import('../public/joe/results.js');
const { createFeed } = await import('../public/joe/feed.js');
const { localBoardHealth, statusPresentation, cellReason, RETAINED_GRACE_S, FEED_STOPPED_S } = await import('../public/joe/health.js');
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

test('JOED-98: retained cells carrying an exactness reason cannot return through a later outage', () => {
  for (const reason of NOT_EXACT_REASONS) {
    const prior = Object.fromEntries(Object.entries(previous).map(([name, cell]) => [name, { ...cell, reason }]));
    const data = missing('source_unavailable');
    data.brokerAccount.equity = data.brokerAccount.cash = null;
    data.brokerAccount.reason = 'source_unavailable'; data.brokerAccount.reasons = { cash: 'source_unavailable' };
    const states = boardStates({ data: { value: data } }, at(600), prior);
    for (const name of ['paperAccount', 'paperCash', ...MONEY_FIELDS.flatMap(f => DESKS.map(id => `desks.${id}.${f}`))]) {
      assert.equal(states[name].value, null, `${reason}: ${name}`);
      assert.equal(states[name].retained, false, name);
    }
  }
});

for (const id of ['b-weekend-no-sod', 'j-ny-midnight-gap']) test(`JOED-94 ${id}: all desk Today cells dash with their reason; Since start stays exact`, () => {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/failures/${id}.json`, import.meta.url)));
  const feed = acceptSnapshot('data', fixture.payload, null, fixture.receivedAt);
  assert.equal(feed.status, 200);
  const feeds = { data: feed }, now = fixture.now, states = boardStates(feeds, now, previous);
  const view = { feeds, now, states };
  for (const desk of DESKS) {
    const day = states[`desks.${desk}.dayPnl`];
    assert.equal(day.value, null); assert.equal(day.retained, false);
    assert.equal(day.reason, fixture.payload.desks.find(d => d.id === desk).money.reasons.dayPnl);
    assert.notEqual(states[`desks.${desk}.totalPnl`].value, null);
    const card = htmlDocument(deskCard(view, desk, 50, true));
    assert.equal(card.querySelector('.dnums .bn').textContent, '—');
    const phone = htmlDocument(compactDesk(view, desk));
    assert.equal(phone.querySelector('[data-compact-value="dayPnl"] .bn').textContent, '—');
    assert.match(phone.querySelector('.vh').textContent, new RegExp(cellReason(day.reason)));
  }
  assert.equal(todayPercent(states), null);
  assert.notEqual(sincePercent(states), null);
});

// Test both sides of UTC midnight, Vienna midnight and NY midnight, including
// NY DST offsets. This policy is independent of the test runner's local zone.
for (const midnight of ['2026-10-15T04:00:00.000Z', '2026-11-03T05:00:00.000Z']) test(`JOED-94: Today expires at NY midnight ${midnight}, including a real outage`, () => {
  const before = new Date(Date.parse(midnight) - 10000).toISOString();
  const data = structuredClone(exact); data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = before;
  for (const sources of [data.pnlSources, ...data.desks.map(d => d.pnlSources)]) sources.day.observedAt = before;
  const feeds = { data: { value: data } }, prior = boardStates(feeds, before);
  const outage = missing('source_unavailable');
  outage.generatedAt = outage.receivedAt = outage.safety.gateway.checkedAt = new Date(Date.parse(midnight) - 5000).toISOString();
  for (const current of [feeds, { data: { value: outage } }]) {
    const sameDay = boardStates(current, before, prior);
    assert.notEqual(sameDay['desks.j.dayPnl'].value, null);
    const states = boardStates(current, midnight, prior), view = { states, feeds: current, now: midnight };
    for (const desk of DESKS) {
      assert.equal(states[`desks.${desk}.dayPnl`].value, null, desk);
      assert.equal(states[`desks.${desk}.dayPnl`].retained, false);
      assert.equal(states[`desks.${desk}.dayPnl`].reason, current === feeds ? 'day_pnl_unavailable' : 'source_unavailable');
      assert.equal(htmlDocument(deskCard(view, desk, 50, true)).querySelector('.dnums .bn').textContent, '—');
      assert.equal(htmlDocument(compactDesk(view, desk)).querySelector('[data-compact-value="dayPnl"] .bn').textContent, '—');
      assert.notEqual(states[`desks.${desk}.equity`].value, null, 'other outage last-good stays');
    }
    assert.equal(states['today.dayPnl'].value, null);
    assert.equal(todayPercent(states), null);
    if (current === feeds) assert.notEqual(sincePercent(states), null, 'Since start has no day boundary');
  }
  const delayed = structuredClone(data); delayed.generatedAt = delayed.receivedAt = delayed.safety.gateway.checkedAt = midnight;
  const states = boardStates({ data: { value: delayed } }, midnight, prior);
  assert.equal(states['desks.j.dayPnl'].value, null, 'a new receipt cannot refresh an old observed date');
  for (const sources of [delayed.pnlSources, ...delayed.desks.map(d => d.pnlSources)]) sources.day.observedAt = midnight;
  assert.notEqual(boardStates({ data: { value: delayed } }, midnight, prior)['desks.j.dayPnl'].value, null, 'a new-day exact observation recovers');
});

test('JOED-94: UTC and Vienna midnight do not expire the same New York day', () => {
  for (const [before, now] of [['2026-10-14T21:59:59.000Z', '2026-10-14T22:00:00.000Z'], ['2026-10-14T23:59:59.000Z', '2026-10-15T00:00:00.000Z']]) {
    const data = structuredClone(exact); data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = before;
    for (const sources of [data.pnlSources, ...data.desks.map(d => d.pnlSources)]) sources.day.observedAt = before;
    const states = boardStates({ data: { value: data } }, now);
    for (const desk of DESKS) assert.notEqual(states[`desks.${desk}.dayPnl`].value, null);
  }
});

test('JOED-95: session estimates are visible and accessible beside all desktop and phone Today figures; exact recovery removes the marks', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/failures/b-session-open-estimate.json', import.meta.url)));
  const feed = acceptSnapshot('data', fixture.payload, null, fixture.receivedAt);
  assert.equal(feed.status, 200);
  const feeds = { data: feed }, now = fixture.now, view = { feeds, now, states: boardStates(feeds, now) };
  assert.match(heroLeft(view), /Estimated from the session open/);
  for (const desk of DESKS) for (const render of [v => deskCard(v, desk, 50, true), v => compactDesk(v, desk)]) {
    const estimated = htmlDocument(render(view)), exactDoc = htmlDocument(render(ctx(exact, 0)));
    const marks = estimated.querySelectorAll('.estimate-mark');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, 'Estimated');
    assert.equal(marks[0].getAttribute('role'), 'img');
    assert.match(marks[0].getAttribute('aria-label'), /^Today: Estimated from the session open at /);
    assert.equal(exactDoc.querySelectorAll('.estimate-mark').length, 0);
    assert.equal(estimated.querySelectorAll('button').length, exactDoc.querySelectorAll('button').length, 'no new interaction targets');
  }
  assert.equal(todayPercent(view.states, feed.value.pnlSources.day), null, 'estimate percentage policy stays unchanged');
  const unavailable = { ...view, states: boardStates({ data: { value: missing('baseline_pending') } }, at(30), view.states) };
  for (const desk of DESKS) assert.equal(htmlDocument(compactDesk(unavailable, desk)).querySelectorAll('.estimate-mark').length, 0, 'no estimate mark on a dash');
});

for (const id of ['b-weekend-no-sod', 'j-ny-midnight-gap']) test(`${id}: dashed Today shows its reason in its local caption`, () => {
  const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/failures/${id}.json`, import.meta.url)));
  const payload = structuredClone(valid.data); delete payload.receivedAt;
  const first = acceptSnapshot('data', payload, null, valid.data.receivedAt);
  const feeds = { data: acceptSnapshot('data', fixture.payload, first, fixture.receivedAt) };
  assert.equal(first.status, 200);
  assert.equal(feeds.data.status, 200);
  const now = fixture.now, prior = boardStates({ data: first }, valid.data.receivedAt);
  const states = boardStates(feeds, now, prior), day = states['today.dayPnl'];
  assert.equal(day.state, 'broken');
  assert.equal(day.value, null);
  const hero = htmlDocument(heroLeft({ states, feeds, now }));
  const today = hero.querySelector('[data-cell="hero.day"]');
  assert.equal(today.querySelector('.bn').textContent, '—');
  assert.equal(today.querySelector('.primary-caption').textContent, `Unavailable · ${cellReason(day.reason)}`);
  assert.equal(today.querySelector('.bn').getAttribute('aria-label'), `Today: not reported · ${cellReason(day.reason)}`);
});

for (const reason of NOT_EXACT_REASONS) test(`${reason}: dashed hero reasons stay local unless the section explains them`, () => {
  const dayOnly = structuredClone(exact), mixed = missing('source_unavailable');
  for (const data of [dayOnly, mixed]) {
    for (const bag of [data.totals, ...data.desks.map(d => d.money)]) {
      bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = reason;
    }
    for (const sources of [data.pnlSources, ...data.desks.map(d => d.pnlSources)]) {
      Object.assign(sources.day, { status: 'unavailable', method: null, observedAt: null, reason });
    }
    assert.equal(validateContract('data', data).ok, true);
  }
  for (const data of [dayOnly, mixed, missing(reason)]) {
    const view = ctx(data), hero = htmlDocument(heroLeft(view));
    // Hidden sizing copies contain every reason and must not count as evidence.
    for (const node of hero.querySelectorAll('.cash-sizing')) node.remove();
    const section = hero.querySelector('.board-caption').textContent;
    const dayCaption = hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent;
    if (data === dayOnly || data === mixed) assert.equal(dayCaption, `Unavailable · ${cellReason(reason)}`);
    else {
      assert.equal(dayCaption, '', 'a shared reason is not repeated on Today');
      assert.equal(section, `Numbers unavailable · ${cellReason(reason)}`);
    }
    for (const node of hero.querySelectorAll('[data-cell]')) {
      if (node.dataset.state !== 'broken') continue;
      assert.equal(node.querySelector('.bn').textContent, '—');
      const name = { day: 'dayPnl', since: 'totalPnl', open: 'openPnl', equity: 'equity' }[node.dataset.cell.split('.')[1]];
      const why = cellReason(view.states[`today.${name}`].reason);
      assert.ok(node.querySelector('.c').textContent.includes(why) || section.includes(why), `${node.dataset.cell}: ${why}`);
    }
  }
});

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

test('withheld totals keep retained equity yellow, including failed and rejected refreshes, without exposing derived amounts', () => {
  for (const [feedReason, reason] of [[null, 'retained_values'], ['refresh_failed', 'refresh_failed'], ['contract_invalid', 'retained_values']]) {
    const view = ctx(missing('source_unavailable'), 30, feedReason);
    assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason });
    const status = statusPresentation(view);
    assert.equal(status.label, 'Data delayed');
    assert.equal(status.statusTone, 'warn');
    assert.equal(view.states['desks.j.equity'].retained, true);
    assert.match(cellView(view.states['desks.j.equity'], 'equity').caption, /Last good value/);
    for (const field of MONEY_FIELDS) assert.equal(view.states[`today.${field}`].value, null, field);
    for (const id of DESKS) assert.equal(view.states[`desks.${id}.totalPnl`].value, null, id);
    assert.equal(todayPercent(view.states), null);
    assert.equal(sincePercent(view.states), null);
    assert.deepEqual(resultsView(view).todayUnits, [null, null, null]);
  }
});

test('retained equity keeps the inclusive five-minute grace while fresh receipts advance; 60-minute display expiry stays independent', () => {
  for (const seconds of [RETAINED_GRACE_S - 0.001, RETAINED_GRACE_S, RETAINED_GRACE_S + 0.001, RETENTION_SECONDS]) {
    const data = missing('source_unavailable');
    data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = at(seconds - 9);
    assert.equal(validateContract('data', data).ok, true);
    const view = ctx(data, seconds);
    assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), seconds <= RETAINED_GRACE_S
      ? { tone: 'yellow', reason: 'retained_values' } : { tone: 'red', reason: 'equity_unavailable' });
    assert.equal(view.states['today.equity'].value, null);
    assert.equal(view.states['desks.j.equity'].value !== null, seconds < RETENTION_SECONDS);
  }
});

test('withheld retained equity in a broker gap preserves transport and rejection warning precedence', () => {
  const data = missing('source_unavailable');
  data.safety.gateway.checkedAt = exact.receivedAt;
  for (const [feedReason, reason] of [[null, 'gateway_unconfirmed'], ['refresh_failed', 'refresh_failed'], ['contract_invalid', 'retained_values']]) {
    const view = ctx(data, 65, feedReason);
    assert.equal(view.states['today.equity'].value, null);
    assert.equal(view.states['desks.j.equity'].retained, true);
    assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason });
  }
});

test('grace never excuses cold, undated or independently missing equity', () => {
  const data = missing('source_unavailable'), feeds = { data: { value: data } }, now = at(30);
  const check = states => assert.deepEqual(localBoardHealth(states, feeds, now), { tone: 'red', reason: 'equity_unavailable' });
  check(boardStates(feeds, now));
  for (const name of ['today.equity', 'desks.j.equity']) {
    const undated = { ...previous, [name]: { ...previous[name], valueReceivedAt: null } };
    check(boardStates(feeds, now, undated));
  }
  for (const desk of data.desks) desk.money = structuredClone(exact.desks.find(d => d.id === desk.id).money);
  check(boardStates(feeds, now));
});

test('a withheld current household amount does not make a retained desk red; hidden since-start carries still warn', () => {
  const data = structuredClone(exact);
  data.desks[0].money.equity = null;
  data.desks[0].money.reasons = { equity: 'source_unavailable' };
  let view = ctx(data);
  assert.equal(view.states['today.equity'].value, null);
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason: 'retained_values' });
  data.desks[0].money = structuredClone(exact.desks[0].money);
  for (const bag of [data.totals, data.desks[0].money]) {
    bag.totalPnl = null; bag.reasons = { totalPnl: 'source_unavailable' };
  }
  view = ctx(data);
  assert.equal(view.states['today.totalPnl'].value, null);
  assert.equal(view.states['desks.j.totalPnl'].value, null);
  assert.equal(view.states['today.equity'].retained, false);
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason: 'retained_values' });
});

test('retained grace preserves halt, ledger, broker-down, stopped-feed and frozen-producer precedence', () => {
  const cases = [
    [view => { Object.assign(view.feeds.data.value.safety, { halt: true, haltReason: 'halt_on' }); }, 'halt_on'],
    [view => { view.feeds.data.value.safety.executor.reason = 'ledger_size_limit'; }, 'ledger_size_limit'],
    [view => { Object.assign(view.feeds.data.value.safety.gateway, { apiSessionReady: false, reason: 'gateway_down' }); }, 'gateway_down'],
    [view => { view.now = at(20 + FEED_STOPPED_S); }, 'feed_disconnected'],
    [view => {
      const data = view.feeds.data.value;
      data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = at(FEED_STOPPED_S - 9);
      view.feeds.data.generatedAdvancedAt = exact.receivedAt;
      view.now = at(FEED_STOPPED_S);
    }, 'producer_stuck'],
  ];
  for (const [change, reason] of cases) {
    const view = ctx(missing('source_unavailable'));
    change(view);
    view.states = boardStates(view.feeds, view.now, previous);
    assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'red', reason });
  }
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
    assert.deepEqual(localBoardHealth(feed.select().states, feed.select().feeds, feed.select().now), { tone: 'yellow', reason: 'refresh_failed' });
    elapsed = RETENTION_SECONDS * 1000;
    assert.equal(feed.select().states['desks.j.equity'].value, null);
  } finally { globalThis.fetch = realFetch; }
});
