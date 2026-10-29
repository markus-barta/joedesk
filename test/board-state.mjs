// Focused board policy checks: no server process, browser or full-suite runner.
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { createReadModel } from '../server/read-model.mjs';
import { createJoeServer } from '../server.mjs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { heroWordingFixtures } from '../scripts/browser/hero-wording-fixtures.mjs';
import { panelStates, MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { validateContract, CONTRACTS, REASONS } from '../contracts/index.mjs';
import { decimalUnits, unitsDecimal } from '../contracts/decimal.mjs';
const { sendOutcome } = await import('../public/joe/settings-model.js');
const { boardStates, NOT_EXACT_REASONS, RETENTION_SECONDS, trustedCurrent, classifyDay, classifyDays, dayChannels } = await import('../public/joe/board-state.js');
const { exactCell, rankDesks, todayPercent, sincePercent } = await import('../public/joe/performance.js');
const { cellView, heroLeft, keptHtml, positionsHtml, compactDesk, healthPop } = await import('../public/joe/desk.js');
const { statePhrase } = await import('../public/joe/ui.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { resultsView } = await import('../public/joe/results.js');
const { age, eur } = await import('../public/joe/format.js');
const { createFeed } = await import('../public/joe/feed.js');
const { localBoardHealth, boardHealthPresentation, statusPresentation, boardDiagnostics, cellReason, CELL_REASON, RETAINED_GRACE_S, FEED_STOPPED_S } = await import('../public/joe/health.js');
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

test('JOED-98: current scoped exactness failures withhold values even when the gateway masks their reason', () => {
  for (const reason of NOT_EXACT_REASONS) {
    const data = missing(reason);
    data.brokerAccount.equity = data.brokerAccount.cash = null;
    data.brokerAccount.reason = reason; data.brokerAccount.reasons = { cash: reason };
    data.safety.gateway.apiSessionReady = false; data.safety.gateway.reason = 'gateway_down';
    // Exercise the board's own guard; production's server already clears
    // these last-good cells before passing its selection to the board.
    const prior = panelStates({ data: { value: data } }, at(30), previous);
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
    const card = htmlDocument(deskCard(view, desk));
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
      assert.equal(states[`desks.${desk}.dayPnl`].reason, current === feeds ? 'baseline_pending' : 'source_unavailable');
      assert.equal(htmlDocument(deskCard(view, desk)).querySelector('.dnums .bn').textContent, '—');
      assert.equal(htmlDocument(compactDesk(view, desk)).querySelector('[data-compact-value="dayPnl"] .bn').textContent, '—');
      assert.notEqual(states[`desks.${desk}.equity`].value, null, 'other outage last-good stays');
    }
    assert.equal(states['today.dayPnl'].value, null);
    assert.equal(todayPercent(states), null);
    if (current === feeds) assert.notEqual(sincePercent(states), null, 'Since start has no day boundary');
    if (current === feeds) {
      // JOED-153 A2: from New York midnight until the open the first figure is
      // the last session's, from Results (not received here: one plain reason).
      // Today's own not-exact state is said once, in the sentence (A5: no timing).
      const hero = htmlDocument(heroLeft(view)), first = hero.querySelector('[data-cell="hero.day"]');
      const lastDay = midnight === '2026-10-15T04:00:00.000Z' ? 'Wed 14\u00a0Oct' : 'Mon 2\u00a0Nov';
      assert.equal(first.dataset.phase, 'last');
      assert.equal(first.querySelector('.hero-k').textContent, `Last session · ${lastDay}`);
      assert.equal(first.querySelector('.primary-caption').textContent, 'Results unavailable · no data received yet');
      assert.equal(first.querySelector('.bn').getAttribute('aria-label'), `Last session · ${lastDay}: Results unavailable · no data received yet`);
      assert.match(hero.querySelector('.say').textContent, /(?:^|· )Today: not exact · waiting on the start-of-day value$/);
      assert.equal(hero.querySelector('.say').textContent.match(/waiting on the start-of-day value/g).length, 1);
      // The card's figure is the last session's too; Today's reason is not repeated on it.
      const card = htmlDocument(deskCard(view, 'j'));
      assert.equal(card.querySelector('.card-status'), null);
      assert.doesNotMatch(card.textContent, /not exact|start-of-day/);
      const dash = card.querySelector('.dnums .bn');
      assert.equal(dash.getAttribute('aria-label'), `J · ${lastDay}: Results unavailable · no data received yet`);
      assert.equal(dash.getAttribute('title'), dash.getAttribute('aria-label'));
      assert.equal(card.querySelector('.dnums .term').dataset.term, 'lastsession');
    }
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
  for (const desk of DESKS) for (const render of [v => deskCard(v, desk), v => compactDesk(v, desk)]) {
    const estimated = htmlDocument(render(view)), exactDoc = htmlDocument(render(ctx(exact, 0)));
    const marks = estimated.querySelectorAll('.estimate-mark');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, 'Estimated');
    assert.equal(marks[0].getAttribute('role'), 'img');
    assert.match(marks[0].getAttribute('aria-label'), /^Estimated from the session open at /);
    assert.equal(marks[0].getAttribute('title'), null, 'no unreachable hover explanation');
    assert.equal(exactDoc.querySelectorAll('.estimate-mark').length, 0);
    assert.equal(estimated.querySelectorAll('button').length, exactDoc.querySelectorAll('button').length, 'no new interaction targets');
  }
  assert.equal(todayPercent(view.states, feed.value.pnlSources.day), null, 'estimate percentage policy stays unchanged');
  // Follow name-from-content semantics for the phone button's descendants.
  const accessibleName = node => typeof node === 'string' ? node
    : node.getAttribute('aria-hidden') === 'true' ? ''
      : node.getAttribute('aria-label') ?? node.children.map(accessibleName).join(' ');
  for (const desk of DESKS) {
    const phone = htmlDocument(compactDesk(view, desk));
    assert.equal(accessibleName(phone.querySelector('.desk-row')).match(/\bToday\b/g)?.length, 1, 'Today is spoken once');
  }
  const outageFeeds = { data: { value: missing('source_unavailable') } };
  const outage = { feeds: outageFeeds, now: at(30), states: boardStates(outageFeeds, at(30), view.states) };
  for (const desk of DESKS) for (const render of [v => deskCard(v, desk), v => compactDesk(v, desk)]) {
    assert.equal(outage.states[`desks.${desk}.dayPnl`].retained, true);
    assert.equal(htmlDocument(render(outage)).querySelectorAll('.estimate-mark').length, 1, 'last-good estimate keeps its mark');
  }
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
  // Every desk shares the reason, so the household caption needs no names.
  assert.equal(today.querySelector('.primary-caption').textContent, `Not exact · ${cellReason(day.reason)}`);
  assert.equal(today.querySelector('.bn').getAttribute('aria-label'), `Today: not exact · ${cellReason(day.reason)}`);
  assert.equal(hero.querySelector('.say').textContent, 'No desk has an exact result for today.', 'the sentence never repeats the caption');
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
    // Every desk shares the reason here, so the caption gives it without names.
    if (data === dayOnly || data === mixed) assert.equal(dayCaption, `Not exact${reason === 'not_exact_yet' ? '' : ` · ${cellReason(reason)}`}`);
    else {
      assert.equal(dayCaption, '', 'a shared reason is not repeated on Today');
      const wording = `Numbers: not exact${reason === 'not_exact_yet' ? '' : ` · ${cellReason(reason)}`}`;
      assert.equal(section, wording);
      assert.equal(hero.querySelector('.account-state').textContent, wording);
    }
    for (const node of hero.querySelectorAll('[data-cell]')) {
      if (node.dataset.state !== 'broken') continue;
      assert.equal(node.querySelector('.bn').textContent, '—');
      const name = { day: 'dayPnl', since: 'totalPnl', open: 'openPnl', equity: 'equity' }[node.dataset.cell.split('.')[1]];
      const why = cellReason(view.states[`today.${name}`].reason);
      assert.ok(node.querySelector('.c').textContent.toLowerCase().includes(why) || section.includes(why), `${node.dataset.cell}: ${why}`);
    }
  }
});

test('JOED-107: a shared real fault keeps the unavailable wording in both hero sections', () => {
  const hero = htmlDocument(heroLeft(ctx(missing('source_unavailable'))));
  for (const selector of ['.board-caption', '.account-state']) {
    assert.equal(hero.querySelector(selector).textContent, 'Numbers unavailable · not reported by the broker');
  }
});

const browserSnapshot = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url))).data;
for (const [id, fixture] of Object.entries(heroWordingFixtures(browserSnapshot))) test(`JOED-107 ${id}: accepted fixture exercises its intended hero wording shape`, () => {
  const f = fixture(), first = { value: browserSnapshot };
  const feed = acceptSnapshot('data', f.payload, first, f.receivedAt);
  assert.equal(feed.status, 200, JSON.stringify(feed.errors));
  const feeds = { data: feed }, states = boardStates(feeds, f.now, panelStates({ data: first }, browserSnapshot.receivedAt));
  const status = statusPresentation({ states, feeds, now: f.now });
  // Amy's A3 excuses only Today. Open not-exact gaps and faults stay yellow.
  assert.deepEqual([status.tone, status.label, status.reason], id === 'p3-not-exact-yet'
    ? ['green', 'Board OK', 'board_ok'] : ['yellow', 'Data delayed', id === 'p3-mixed-not-exact-fault' ? 'open_fault_rth' : 'open_unavailable_rth']);
  const brokenHero = ['today.dayPnl', 'today.openPnl', 'today.totalPnl', 'today.equity', 'paperAccount']
    .filter(name => states[name].state === 'broken');
  assert.deepEqual(brokenHero, id === 'p3-not-exact-yet' ? ['today.dayPnl'] : ['today.dayPnl', 'today.openPnl']);
  const hero = htmlDocument(heroLeft({ states, feeds, now: f.now }));
  for (const node of hero.querySelectorAll('.cash-sizing')) node.remove();
  assert.equal(states['today.dayPnl'].state, 'broken');
  assert.equal(states['today.dayPnl'].value, null);
  if (id === 'p3-shared-not-exact') {
    assert.equal(states['today.openPnl'].state, 'broken');
    assert.equal(states['today.openPnl'].value, null);
    assert.equal(hero.querySelector('.board-caption').textContent, 'Numbers: not exact · waiting on the start-of-day value');
    assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, '');
  } else {
    assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Not exact');
    if (id === 'p3-mixed-not-exact-fault') {
      assert.equal(states['today.openPnl'].state, 'broken');
      assert.equal(states['today.openPnl'].value, null);
      assert.equal(hero.querySelector('[data-cell="hero.open"] .c').textContent, 'Last good for J, Joe and Joel · not reported by the broker');
    } else assert.equal(states['today.openPnl'].state, 'fresh');
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
    // JOED-148: the dash says what the feed said, not exact, never "not reported".
    const name = `Last price: not exact${reason === 'not_exact_yet' ? '' : ` · ${cellReason(reason)}`}`;
    assert.ok(positionsHtml(view).html.includes(`title="${name}" aria-label="${name}"`), `${reason}: ${name}`);
    assert.doesNotMatch(positionsHtml(view).html, /Last price: not reported/);
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

for (const fallback of ['gateway_expiry', 'retained_values', 'failed_read']) test(`JOED-129: current KEEP filters prior arrays after ${fallback}`, () => {
  const data = structuredClone(exact);
  data.safety.gateway.checkedAt = at(-50);
  const policy = structuredClone(JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)))['fleet-config']);
  const model = createReadModel({ dataDir: '/__joed129_board_memory_only__', clock: () => at(0), write: () => {} });
  assert.equal(model.observeFleet(policy).ok, true);
  const ingress = structuredClone(data); delete ingress.receivedAt;
  assert.equal(model.accept(ingress).ok, true);
  const before = boardStates(model.feeds(), at(0), model.panels());
  const symbol = data.positions.rows.find(row => row.scope === 'stage0').symbol;
  assert.ok(before.positions.value.some(row => row.symbol === symbol));
  policy.desks.keep.push(symbol); policy.rev = 'fc-000013'; policy.updatedAt = at(10);
  assert.equal(model.observeFleet(policy).ok, true);
  const feeds = structuredClone(model.feeds());
  if (fallback === 'retained_values') {
    feeds.data.value.positions.reason = 'retained_values';
    feeds.data.value.safety.gateway.checkedAt = at(0);
    feeds.data.gatewayProgress = { checkedAt: at(0), advancedAt: at(0), initialAgeMs: 0 };
  }
  if (fallback === 'failed_read') feeds.data.reason = 'refresh_failed';
  const states = boardStates(feeds, at(10), before);
  const view = { feeds, states, now: at(10) };
  assert.equal(states.positions.value.some(row => row.symbol === symbol), false, 'new KEEP symbol cannot retain desk attribution');
  assert.equal(resultsView(view).positions.some(row => row.symbol === symbol), false, 'withheld row cannot supply a desk contribution note');
  assert.equal(htmlDocument(positionsHtml(view).html).querySelectorAll('.prow:not(.hd) .name b')
    .some(node => node.textContent === symbol), false);
  // Withhold the moved row until producer scope agrees. Existing KEEP rows
  // retain their own provenance and exactness rather than borrowing its age.
  assert.deepEqual(states.kept.value.map(row => row.symbol), before.kept.value.map(row => row.symbol));
  for (const name of ['positions', 'kept']) {
    assert.equal(states[name].retained, true);
    assert.equal(states[name].valueReceivedAt, before[name].valueReceivedAt);
    assert.equal(states[name].ageSeconds, 10);
    assert.equal(states[name].reason, fallback === 'gateway_expiry' ? 'gateway_unconfirmed'
      : fallback === 'failed_read' ? 'refresh_failed' : 'retained_values');
  }
  for (const field of MONEY_FIELDS) {
    assert.equal(states[`desks.j.${field}`].value, null, 'current KEEP invalidates older affected desk figures');
    assert.equal(states[`today.${field}`].value, null);
  }
  assert.equal(states.paperAccount.value.amount, exact.brokerAccount.equity.amount);
});

test('JOED-129: retained KEEP arrays also obey removal and the mandatory SXR8/TSLA floor', () => {
  const data = structuredClone(exact), moved = data.positions.rows.find(row => row.scope === 'stage0');
  data.safety.gateway.checkedAt = at(-50);
  moved.scope = 'keep'; moved.desk = null;
  const policy = { desks: { keep: [moved.symbol] } };
  const before = boardStates({ data: { value: data }, 'fleet-config': { value: policy } }, at(0));
  const feeds = { data: { value: data, reason: 'refresh_failed' }, 'fleet-config': { value: { desks: { keep: [] } } } };
  const states = boardStates(feeds, at(10), before);
  assert.deepEqual(states.kept.value.map(row => row.symbol).sort(), ['SXR8', 'TSLA']);
  assert.equal(states.positions.value.some(row => row.symbol === moved.symbol), false, 'no invented desk evidence for a formerly kept row');
  assert.equal(states.kept.valueReceivedAt, before.kept.valueReceivedAt);
  assert.equal(states.kept.ageSeconds, 10);
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

// JOED-96: a DATA stall follows the same numeric policy as an outage, while
// preserving the shared selector's original state, reason and health evidence.
for (const frozen of [false, true]) test(`JOED-96 ${frozen ? 'producer_frozen' : 'snapshot_stale'}: marked values, no derived numbers, cell-age expiry, recovery`, () => {
  const reason = frozen ? 'producer_frozen' : 'snapshot_stale';
  for (const seconds of [60, 3539, 3540, 3541, 3599, 3600, 3601]) {
    const feeds = { data: { value: exact, ...(frozen ? { generatedAdvancedAt: at(-60) } : {}) } };
    const now = at(seconds), raw = panelStates(feeds, now, previous);
    const states = boardStates(feeds, now, previous), view = { feeds, now, states };
    const name = 'desks.j.equity', cell = states[name];
    assert.equal(cell.state, 'stale'); assert.equal(cell.reason, reason); assert.equal(cell.retained, false);
    assert.equal(cell.ageSeconds, raw[name].ageSeconds, 'original caption age is preserved');
    assert.equal(cell.ageSeconds, seconds + (frozen ? 60 : 0), 'expiry uses the independently known generation age');
    assert.deepEqual(localBoardHealth(states, feeds, now), localBoardHealth(raw, feeds, now), 'header health is unchanged');
    if (cell.ageSeconds < RETENTION_SECONDS) {
      assert.deepEqual(cell.value, exact.desks[0].money.equity);
      assert.match(htmlDocument(cellView(cell, 'equity').caption).textContent, /As of .*ago · updates are (late|stuck)/);
      assert.deepEqual(states['today.equity'].health, { available: true, retained: false, ageSeconds: raw['today.equity'].ageSeconds });
      assert.notEqual(states.positions.value, null);
      assert.notEqual(states.kept.value, null);
      assert.equal(htmlDocument(positionsHtml(view).html).querySelectorAll('.vbar i').length, 0);
      const kept = htmlDocument(keptHtml(view));
      assert.match(kept.querySelector('.pstate').textContent, /updates are (late|stuck) · worth —$/);
      assert.match(kept.querySelector('.keep-cap').textContent, /paper account \(—\)/);
      for (const id of DESKS) {
        assert.equal(htmlDocument(deskCard(view, id)).querySelectorAll('.dbar i').length, 0);
        assert.notEqual(states[`desks.${id}.dayPnl`].value, null, 'individual Today remains visible');
      }
    } else {
      for (const name of ['paperAccount', 'paperCash', 'positions', 'kept', ...DESKS.flatMap(id => MONEY_FIELDS.map(f => `desks.${id}.${f}`))]) {
        assert.equal(states[name].value, null, name);
        assert.equal(states[name].reason, reason, name);
      }
      assert.match(cellView(cell, 'equity', { label: 'Equity' }).html, /—/);
      assert.match(cellView(cell, 'equity').caption, /updates are (late|stuck)/);
    }
    for (const field of MONEY_FIELDS) assert.equal(states[`today.${field}`].value, null, field);
    for (const id of DESKS) assert.equal(states[`desks.${id}.totalPnl`].value, null, id);
    assert.equal(exactCell(cell), null);
    assert.equal(todayPercent(states), null); assert.equal(sincePercent(states), null);
    assert.deepEqual(rankDesks(states, ['joe', 'j', 'joel']), ['joe', 'j', 'joel']);
    assert.deepEqual(resultsView(view).todayUnits, [null, null, null]);
    const hero = htmlDocument(heroLeft(view));
    assert.equal(hero.querySelectorAll('.performance-pct').length, 0);
    for (const key of ['day', 'since', 'open', 'equity']) assert.equal(hero.querySelector(`[data-cell="hero.${key}"] .bn`).textContent, '—');
  }
  // Re-sends keep arriving, but cannot renew the frozen generation's age.
  if (frozen) {
    for (const seconds of [3599, 3600, 3601, 7200]) {
      const data = structuredClone(exact); data.receivedAt = at(seconds - 10);
      const feeds = { data: { value: data, generatedAdvancedAt: exact.receivedAt } };
      const states = boardStates(feeds, at(seconds), previous);
      assert.equal(states['desks.j.equity'].ageSeconds, seconds);
      assert.equal(states['desks.j.equity'].value === null, seconds >= 3600, 'a recent re-send cannot defer expiry');
      assert.equal(exactCell(states['desks.j.equity']), null, 'frozen receipt still cannot feed derived money');
    }
  }
  const data = structuredClone(exact);
  data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = at(3610);
  for (const source of [data.pnlSources.day, ...data.desks.map(d => d.pnlSources.day)]) source.observedAt = at(3610);
  const recovered = ctx(data, 3610);
  for (const field of MONEY_FIELDS) assert.notEqual(exactCell(recovered.states[`today.${field}`]), null, field);
  assert.notEqual(todayPercent(recovered.states), null); assert.notEqual(sincePercent(recovered.states), null);
  assert.ok(resultsView(recovered).todayUnits.every(v => typeof v === 'bigint'));
  assert.ok(htmlDocument(keptHtml(recovered)).querySelector('.pstate').textContent.includes('Worth'));
  assert.ok(htmlDocument(positionsHtml(recovered).html).querySelectorAll('.vbar i').length > 0);
});

for (const reason of ['snapshot_stale', 'producer_frozen']) for (const field of ['equity', 'totalPnl'])
for (const scope of ['desk', 'household']) test(`JOED-114 ${scope} ${field} ${reason}: withheld totals keep health evidence and warn without a fresh-envelope age`, () => {
  const data = structuredClone(exact);
  const bag = scope === 'desk' ? data.desks[0].money : data.totals;
  bag.reasons = { [field]: reason };
  assert.equal(validateContract('data', data).ok, true);
  const view = ctx(data, 0);
  assert.notEqual(view.states['desks.j.equity'].value, null);
  assert.equal(view.states[`today.${field}`].value, null);
  assert.equal(view.states[`today.${field}`].reason, reason);
  assert.deepEqual(view.states[`today.${field}`].health, { available: true, retained: false, ageSeconds: 0 });
  if (scope === 'desk' && field === 'totalPnl') assert.equal(view.states['desks.j.totalPnl'].value, null);
  const health = boardHealthPresentation(view.states, view.feeds, view.now);
  assert.equal(health.tone, 'yellow');
  assert.equal(health.statusTone, 'warn');
  assert.equal(health.reason, 'retained_values');
  assert.equal(health.label, 'Data delayed');
  const status = statusPresentation(view);
  assert.equal(status.sentence, 'Numbers a bit old');
  assert.equal(status.compact, 'Older numbers');
  assert.equal(status.announcement, 'Numbers a bit old. Carrying the last good values');
});

test('JOED-96: sequence_replayed retains the existing advisory and retention policy', () => {
  const feeds = { data: { value: exact, reason: 'sequence_replayed' } };
  for (const seconds of [30, 3600]) {
    const raw = panelStates(feeds, at(seconds), previous), view = { feeds, now: at(seconds), states: boardStates(feeds, at(seconds), previous) };
    assert.equal(view.states['desks.j.equity'].state, raw['desks.j.equity'].state);
    assert.equal(view.states['desks.j.equity'].retained, seconds < 3600 ? raw['desks.j.equity'].retained : false);
    assert.equal(view.states['desks.j.equity'].value !== null, seconds < 3600);
    assert.equal(exactCell(view.states['desks.j.equity']), null, 'retained replay was already excluded');
  }
  const advisory = { state: 'stale', value: exact.desks[0].money.equity, reason: 'sequence_replayed', retained: false };
  assert.notEqual(exactCell(advisory), null, 'non-retained advisory remains usable');
});

test('JOED-96: Results withholds money now and period percent and explains the DATA stall in its existing status slot', async t => {
  const M = await import('../public/joe/results-model.js');
  const { renderStatus, RS } = await builders('results.js', ['renderStatus']);
  const record = JSON.parse(readFileSync(new URL('../fixtures/results/no-losers.json', import.meta.url)));
  const ix = M.indexResults(record), savedDesk = RS.desk;
  const document = htmlDocument('<div id="resStatus" class="res-status"></div>');
  const savedDocument = globalThis.document;
  globalThis.document = document;
  // The simple DOM is enough for the real status builder, with no browser.
  try {
    for (const reason of ['snapshot_stale', 'producer_frozen']) {
      const view = ctx(exact, 90); view.states.results = { state: 'fresh', value: { index: ix }, reason: null, retained: false, ageSeconds: 0 };
      if (reason === 'producer_frozen') for (const id of DESKS) view.states[`desks.${id}.equity`].reason = reason;
      const results = resultsView(view), per = M.periodOf('week', results.today, results.today, results.trackingStart);
      const R = M.rollup(ix, per, DESKS, M.moneyContext(ix, results, per, DESKS));
      assert.equal(R.net, null); assert.equal(M.periodPercent(ix, results, per, DESKS, R), null);
      const fresh = ctx(exact, 0); fresh.states.results = view.states.results;
      const freshResults = resultsView(fresh), freshPer = M.periodOf('week', freshResults.today, freshResults.today, freshResults.trackingStart);
      const freshR = M.rollup(ix, freshPer, DESKS, M.moneyContext(ix, freshResults, freshPer, DESKS));
      assert.notEqual(freshR.net, null); assert.notEqual(M.periodPercent(ix, freshResults, freshPer, DESKS, freshR), null);
      RS.desk = 'all'; renderStatus(results);
      assert.match(document.querySelector('#resStatus').textContent, /Desks’ money is not available: updates are (late|stuck)\./);
      assert.equal(document.querySelectorAll('.res-state').length, 1);
      results.cell = { ...results.cell, state: 'stale', reason: 'snapshot_stale', ageSeconds: 90 };
      renderStatus(results);
      assert.match(document.querySelector('#resStatus').textContent, /^Stale · Results as of .*updates are late\. Desks’ money is not available: updates are (late|stuck)\.$/);
      results.cell = freshResults.cell;
      results.moneyCells = DESKS.map(() => ({ state: 'fresh', reason: null }));
      renderStatus(results); assert.equal(document.querySelector('#resStatus').textContent, '', 'fresh recovery clears the DATA warning');
      results.moneyCells[0] = { state: 'stale', reason };
      RS.desk = 'joe'; renderStatus(results);
      assert.equal(document.querySelector('#resStatus').textContent, '', 'an unselected stale desk does not warn for a fresh desk');
    }
  } finally { RS.desk = savedDesk; if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument; }
});

test('JOED-96: Results explains retained and expired DATA outages in the existing status slot, scoped to the selected desks', async () => {
  const M = await import('../public/joe/results-model.js');
  const { renderStatus, RS } = await builders('results.js', ['renderStatus']);
  const record = JSON.parse(readFileSync(new URL('../fixtures/results/no-losers.json', import.meta.url)));
  const ix = M.indexResults(record), savedDesk = RS.desk, savedDocument = globalThis.document;
  globalThis.document = htmlDocument('<div id="resStatus" class="res-status"></div>');
  try {
    for (const reason of ['refresh_failed', 'contract_invalid', 'gateway_down']) for (const seconds of [30, 3599, 3600, 3601, 7200]) {
      const data = structuredClone(exact);
      if (reason === 'gateway_down') Object.assign(data.safety.gateway, { apiSessionReady: false, reason });
      const view = ctx(data, seconds, reason === 'gateway_down' ? null : reason);
      view.states.results = { state: 'fresh', value: { index: ix }, reason: null, retained: false, ageSeconds: 0 };
      const results = resultsView(view), per = M.periodOf('week', results.today, results.today, results.trackingStart);
      assert.ok(results.moneyCells.every(cell => cell.reason === reason && (seconds < 3600
        ? cell.retained && cell.value != null && !cell.outageExpired
        : !cell.retained && cell.value === null && cell.outageExpired)));
      assert.deepEqual(results.todayUnits, [null, null, null]);
      const R = M.rollup(ix, per, DESKS, M.moneyContext(ix, results, per, DESKS));
      assert.equal(R.net, null); assert.equal(M.periodPercent(ix, results, per, DESKS, R), null);
      RS.desk = 'all'; renderStatus(results);
      const status = document.querySelector('#resStatus');
      const warning = `Desks’ money is not available: ${cellReason(reason)}.`;
      assert.equal(status.textContent, warning);
      assert.equal(status.querySelectorAll('.res-state').length, 1);
      results.cell = { ...results.cell, state: 'stale', reason: 'snapshot_stale', ageSeconds: 90 };
      renderStatus(results);
      assert.ok(status.textContent.startsWith('Stale · Results as of '));
      assert.ok(status.textContent.endsWith(warning), 'both feed warnings share the same status box');
      const fresh = ctx(exact, 0); fresh.states.results = view.states.results;
      const recovered = resultsView(fresh);
      renderStatus(recovered);
      assert.equal(status.textContent, '', 'fresh recovery clears the outage explanation');
      assert.ok(recovered.todayUnits.every(value => typeof value === 'bigint'));
      recovered.moneyCells[0] = results.moneyCells[0];
      RS.desk = 'joe'; renderStatus(recovered);
      assert.equal(status.textContent, '', 'an outage in an unselected desk does not warn');
      RS.desk = 'j'; renderStatus(recovered);
      assert.equal(status.textContent, warning);
    }
  } finally {
    RS.desk = savedDesk;
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument;
  }
});

test('JOED-96: rejected pushes and failed reads cannot re-show a frozen generation or renew its caption age', () => {
  const numeric = ['paperAccount', 'paperCash', 'positions', 'kept',
    ...MONEY_FIELDS.flatMap(field => [`today.${field}`, ...DESKS.map(id => `desks.${id}.${field}`)])];
  for (const reason of ['contract_invalid', 'sequence_replayed', 'refresh_failed']) {
    for (const seconds of [60, 299, 300, 301, 600, 3599, 3600, 3601, 3700, 7200]) {
      const data = structuredClone(exact); data.receivedAt = at(seconds - 10);
      const feeds = { data: { value: data, generatedAdvancedAt: exact.receivedAt } };
      const before = boardStates(feeds, at(seconds), previous);
      feeds.data.reason = reason;
      const raw = panelStates(feeds, at(seconds), previous);
      const states = boardStates(feeds, at(seconds), previous);
      for (const name of numeric) {
        const cell = states[name];
        assert.equal(cell.ageSeconds, seconds, `${name}: original generation receipt owns the clock`);
        assert.equal(cell.reason, reason);
        assert.equal(cell.value === null, before[name].value === null, `${name}: rejection cannot restore an expired amount`);
        if (seconds >= 3600) assert.equal(cell.outageExpired, true, name);
      }
      assert.deepEqual(localBoardHealth(states, feeds, at(seconds)), localBoardHealth(raw, feeds, at(seconds)),
        'truthful display age does not change selector health or retained grace');
      const hero = htmlDocument(heroLeft({ feeds, now: at(seconds), states }));
      assert.equal(hero.querySelector('.board-caption').textContent,
        `Last good value, ${age(seconds)} ago · ${cellReason(reason)}`,
        'the hero caption uses the same generation clock before and after value expiry');
      const equity = states['desks.j.equity'];
      if (seconds < 3600) {
        assert.equal(equity.retained, true);
        assert.equal(htmlDocument(cellView(equity, 'frozen').caption).textContent,
          `Last good value, ${age(seconds)} ago · ${cellReason(reason)}`);
      } else {
        assert.equal(equity.retained, false);
        assert.match(cellView(equity, 'frozen', { label: 'Equity' }).html, /—/);
      }
      assert.deepEqual(resultsView({ feeds, now: at(seconds), states }).todayUnits, [null, null, null]);
    }
  }
  // If the retained value is older than the current generation, keep its
  // own earlier receipt rather than replacing it with the generation clock.
  const data = missing('source_unavailable');
  const feeds = { data: { value: data, generatedAdvancedAt: at(20), reason: 'contract_invalid' } };
  const states = boardStates(feeds, at(120), previous);
  assert.equal(states['desks.j.equity'].ageSeconds, 120);
});

test('JOED-96: cold and warm feed reads preserve the frozen clock through rejection, failed refresh and tick expiry', async t => {
  const realFetch = globalThis.fetch;
  let seconds = 3599, rejectedPush = false, failedRead = false, elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  try {
    globalThis.fetch = async url => {
      const stateRead = String(url).includes('state.json');
      const data = structuredClone(exact); data.receivedAt = at(seconds - 10);
      const dataFeed = { value: data, generatedAdvancedAt: exact.receivedAt, reason: rejectedPush ? 'contract_invalid' : null };
      const body = stateRead ? { serverNow: at(seconds), feeds: { data: dataFeed },
        panels: panelStates({ data: dataFeed }, at(seconds), previous) } : { reason: 'feed_not_received' };
      return new Response(JSON.stringify(body), { status: stateRead && !failedRead ? 200 : 503,
        headers: { 'X-Joe-Server-Now': at(seconds) } });
    };
    const warm = createFeed(() => {});
    await warm.refresh();
    assert.equal(warm.select().states['desks.j.equity'].ageSeconds, 3599);
    assert.notEqual(warm.select().states['desks.j.equity'].value, null);
    rejectedPush = true;
    for (const feed of [warm, createFeed(() => {})]) {
      await feed.refresh();
      const cell = feed.select().states['desks.j.equity'];
      assert.equal(cell.reason, 'contract_invalid');
      assert.equal(cell.ageSeconds, 3599, 'cold clients also have the generation receipt');
      assert.notEqual(cell.value, null);
    }
    elapsed = 1000;
    assert.equal(warm.select().states['desks.j.equity'].ageSeconds, 3600);
    assert.equal(warm.select().states['desks.j.equity'].value, null, 'tick expiry uses the original receipt');
    seconds = 7200; elapsed = 2000;
    const cold = createFeed(() => {});
    await cold.refresh();
    assert.equal(cold.select().states['desks.j.equity'].ageSeconds, 7200);
    assert.equal(cold.select().states['desks.j.equity'].value, null, 'an expired frozen generation cannot reappear on cold load');
    failedRead = true;
    await cold.refresh();
    assert.equal(cold.select().states['desks.j.equity'].reason, 'refresh_failed');
    assert.equal(cold.select().states['desks.j.equity'].ageSeconds, 7200);
    assert.equal(cold.select().states['desks.j.equity'].value, null, 'failed refresh preserves the generation watermark');
  } finally { globalThis.fetch = realFetch; }
});

for (const seeded of [false, true]) test(`JOED-120 F2: legacy non-null retained_values cannot freshen observations or derived amounts (seeded=${seeded})`, () => {
  for (const seconds of [30, 3599, 3600, 3660]) {
    const data = structuredClone(exact);
    data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = at(seconds);
    for (const bag of [data.totals, ...data.desks.map(d => d.money)])
      bag.reasons = Object.fromEntries(MONEY_FIELDS.map(field => [field, 'retained_values']));
    data.brokerAccount.reason = 'retained_values'; data.brokerAccount.reasons = { cash: 'retained_values' };
    assert.equal(validateContract('data', data).ok, true);
    const states = boardStates({ data: { value: data } }, at(seconds), seeded ? previous : {});
    for (const name of ['desks.j.equity', 'paperAccount', 'paperCash']) {
      assert.equal(states[name].value != null, seeded && seconds < 3600, name);
      assert.equal(states[name].retained, seeded && seconds < 3600, name);
      if (seeded) assert.equal(states[name].ageSeconds, seconds, name);
    }
    for (const name of ['today.equity', 'today.dayPnl', 'today.openPnl', 'today.totalPnl', 'desks.j.totalPnl'])
      assert.equal(states[name].value, null, name);
  }
});

// Memory-only server acceptance/restart checks run in the existing CI unit file.
{
  const read = file => JSON.parse(fs.readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
  const fixture = read('valid.json').data, exact = read('phase-b.json').exact;
  const at = seconds => new Date(Date.parse(fixture.receivedAt) + seconds * 1000).toISOString();
  const bytes = value => Buffer.byteLength(JSON.stringify(value));
  const ingress = value => { const copy = structuredClone(value); delete copy.receivedAt; return copy; };
  function harness(t) {
    const files = new Map(), fds = new Map();
    let seconds = 0, nextFd = 1000000;
    for (const name of ['openSync', 'fstatSync', 'readFileSync', 'closeSync']) {
      const original = fs[name];
      t.mock.method(fs, name, (key, ...args) => {
        if (name === 'readFileSync' && files.has(String(key))) return files.get(String(key));
        if (name === 'openSync' && files.has(String(key))) { const fd = nextFd++; fds.set(fd, String(key)); return fd; }
        if (fds.has(key)) {
          const body = files.get(fds.get(key));
          if (name === 'fstatSync') return { size: Buffer.byteLength(body) };
          if (name === 'readFileSync') return body;
          if (name === 'closeSync') return fds.delete(key);
        }
        return original(key, ...args);
      });
    }
    const options = { dataDir: '/nonexistent-joed120-memory', clock: () => at(seconds),
      write: (file, value) => files.set(file, JSON.stringify(value)) };
    const stored = name => files.get(`${options.dataDir}/${name}-state.json`);
    return { model: createReadModel(options), restart: () => createReadModel(options),
      server: () => createJoeServer(options),
      replaceFleet: value => files.set(`${options.dataDir}/fleet-config.json`, JSON.stringify(value)),
      fleetReceipt: () => files.get(`${options.dataDir}/fleet-receipt.json`),
      time: value => { seconds = value; }, stored,
      replaceState: value => files.set(`${options.dataDir}/data-state.json`, JSON.stringify(value)),
      cells: model => boardStates(model.feeds(), at(seconds), model.panels()) };
  }
  async function fleetRead(server, headers = {}) {
    let status, responseHeaders, text;
    await server.listeners('request')[0]({ url: '/joe/fleet-config.json', method: 'GET',
      headers: { host: 'fixture.invalid', 'x-auth-request-user': 'fixture', ...headers } }, {
      writeHead(code, value) { status = code; responseHeaders = new Headers(value); },
      end(value) { text = String(value ?? ''); },
    });
    return { status, headers: responseHeaders, text, value: text ? JSON.parse(text) : null };
  }
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
    return value;
  }
  for (const nested of [false, true]) test(`JOED-131 F2: reordered ${nested ? 'nested' : 'top-level'} keys preserve settings reads, ETag and receipt across restart`, async t => {
    const h = harness(t), config = JSON.parse(fs.readFileSync(new URL('../public/joe/fleet-config.example.json', import.meta.url)));
    config.rev = 'fc-000019'; h.replaceFleet(config);
    const server = h.server();
    const first = await fleetRead(server);
    assert.equal(first.status, 200);
    const receipt = h.fleetReceipt(), etag = first.headers.get('etag');
    assert.equal(etag, '"fc-000019"');
    const reordered = nested ? reverseKeys(config) : Object.fromEntries(Object.entries(config).reverse());
    assert.deepEqual(reordered, config);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(config));
    assert.equal(validateContract('fleet-config', reordered).ok, true);
    h.replaceFleet(reordered); h.time(45);
    // Construct the restart before either read, so it must load the original receipt.
    for (const current of [server, h.server()]) {
      const response = await fleetRead(current);
      assert.equal(response.status, 200);
      assert.deepEqual(response.value, config);
      assert.equal(response.headers.get('etag'), etag);
      assert.equal(response.headers.get('x-joe-received-at'), at(0));
      assert.equal(response.headers.get('x-joe-feed-reason'), null);
      const cached = await fleetRead(current, { 'if-none-match': etag });
      assert.equal(cached.status, 304); assert.equal(cached.text, '');
      assert.equal(cached.headers.get('x-joe-received-at'), at(0));
      assert.equal(current.readModel.panels()['fleet-config'].ageSeconds, 45);
      assert.equal(current.readModel.feeds()['fleet-config'].reason, null);
      assert.equal(h.fleetReceipt(), receipt, 'unchanged content must not rewrite the receipt');
    }
  });
  for (const [field, change] of [
    ['nested value', config => { config.desks.maxBusyDesks--; }],
    ['timestamp', config => { config.updatedAt = at(1); }],
    ['array order', config => { config.desks.keep.reverse(); }],
  ]) test(`JOED-131: same-revision ${field} changes still fail closed across restart`, async t => {
    const h = harness(t), config = JSON.parse(fs.readFileSync(new URL('../public/joe/fleet-config.example.json', import.meta.url)));
    config.rev = 'fc-000019'; h.replaceFleet(config);
    const server = h.server();
    assert.equal((await fleetRead(server)).status, 200);
    const receipt = h.fleetReceipt(), changed = reverseKeys(config);
    change(changed); assert.equal(validateContract('fleet-config', changed).ok, true);
    h.replaceFleet(changed); h.time(45);
    for (const current of [server, h.server()]) {
      assert.deepEqual(current.readModel.observeFleet(changed), { ok: false, status: 503, reason: 'contract_invalid' });
      for (const headers of [{}, { 'if-none-match': '"fc-000019"' }]) {
        const response = await fleetRead(current, headers);
        assert.equal(response.status, 503); assert.equal(response.value.reason, 'refresh_failed');
      }
      assert.deepEqual(current.readModel.feeds()['fleet-config'].value, config);
      assert.equal(h.fleetReceipt(), receipt);
    }
    h.replaceFleet(config);
    assert.equal((await fleetRead(server)).status, 200);
    assert.equal(server.readModel.feeds()['fleet-config'].reason, null);
    assert.equal(h.fleetReceipt(), receipt);
  });
  function retained(value, seconds, seq) {
    const copy = ingress(value);
    copy.seq = seq; copy.generatedAt = copy.safety.gateway.checkedAt = at(seconds);
    for (const bag of [copy.totals, ...copy.desks.map(d => d.money)])
      bag.reasons = Object.fromEntries(MONEY_FIELDS.map(field => [field, 'retained_values']));
    copy.brokerAccount.reason = 'retained_values'; copy.brokerAccount.reasons = { cash: 'retained_values' };
    return copy;
  }

  test('JOED-120: advancing JOED-95 estimate transitions keep their method and original anchor during outage', t => {
    const h = harness(t), estimate = ingress(fixture), recovery = ingress(fixture);
    estimate.pnlSources.day = read('failures/b-session-open-estimate.json').payload.pnlSources.day;
    let seq = fixture.seq;
    assert.equal(h.model.accept(ingress(fixture)).status, 200);
    // Same sequence as the browser fixture: exact -> estimate -> exact ->
    // estimate -> stale -> null outage. A method change advances generation.
    for (const [candidate, seconds, method] of [[estimate, 1, 'session-open-estimate'],
      [recovery, 2, 'sod-virtual-equity'], [estimate, 3, 'session-open-estimate']]) {
      candidate.seq = ++seq; candidate.generatedAt = at(seconds); h.time(seconds);
      assert.equal(h.model.accept(candidate).status, 200);
      for (const name of ['today.dayPnl', ...DESKS.map(id => `desks.${id}.dayPnl`)]) {
        assert.equal(JSON.parse(h.stored('data')).cells[name].valueSource.method, method, name);
      }
    }
    h.time(70);
    for (const desk of DESKS) assert.equal(h.cells(h.model)[`desks.${desk}.dayPnl`].state, 'stale');
    const outage = structuredClone(estimate); outage.seq = ++seq;
    outage.generatedAt = outage.safety.gateway.checkedAt = at(80);
    for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
      bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = 'source_unavailable';
    }
    for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)].filter(Boolean)) {
      Object.assign(sources.day, { status: 'unavailable', observedAt: null, reason: 'source_unavailable' });
    }
    h.time(80); assert.equal(h.model.accept(outage).status, 200); h.time(85);
    for (const model of [h.model, h.restart()]) {
      const states = h.cells(model), view = { feeds: model.feeds(), states, now: at(85) };
      assert.equal(states['today.dayPnl'].value, null, 'derived household Today stays withheld');
      for (const name of DESKS.map(id => `desks.${id}.dayPnl`)) {
        const cell = states[name];
        assert.equal(cell.state, 'broken', name);
        assert.equal(cell.retained, true, name);
        assert.equal(cell.valueReceivedAt, at(3), name);
        assert.equal(cell.ageSeconds, 82, name);
        assert.equal(cell.valueSource.method, 'session-open-estimate', name);
        assert.equal(cell.valueObservedAt, estimate.pnlSources.day.observedAt, name);
      }
      for (const desk of DESKS) for (const render of [v => deskCard(v, desk), v => compactDesk(v, desk)]) {
        const marks = htmlDocument(render(view)).querySelectorAll('.estimate-mark');
        assert.equal(marks.length, 1, `${desk}: kept desktop/phone Today has its estimate mark`);
        assert.equal(marks[0].textContent, 'Estimated');
        assert.equal(marks[0].getAttribute('role'), 'img');
        assert.match(marks[0].getAttribute('aria-label'), /^Estimated from the session open at /);
      }
    }
    h.time(3603);
    for (const desk of DESKS) {
      const states = h.cells(h.model), view = { feeds: h.model.feeds(), states, now: at(3603) };
      assert.equal(states[`desks.${desk}.dayPnl`].value, null, 'outage receipt cannot extend retention');
      assert.equal(htmlDocument(compactDesk(view, desk)).querySelectorAll('.estimate-mark').length, 0);
    }
  });

  test('JOED-120 F1: frozen re-send then advancing outage never resurrects expired last-good, including restart', t => {
    const h = harness(t), candidate = ingress(fixture);
    assert.equal(h.model.accept(candidate).status, 200);
    const original = JSON.parse(h.stored('data')).cells;
    h.time(4000); candidate.seq++;
    assert.equal(h.model.accept(candidate).status, 200);
    assert.equal(h.cells(h.model)['desks.j.equity'].value, null);
    const saved = JSON.parse(h.stored('data'));
    assert.deepEqual(saved.cells, original, 'a frozen generation cannot renew any observation/source');
    h.time(4030);
    const dead = read('failures/a-gateway-up-but-dead.json').payload;
    dead.seq = candidate.seq + 1; dead.generatedAt = dead.safety.gateway.checkedAt = at(4030);
    assert.equal(h.model.accept(dead).status, 200);
    for (const model of [h.model, h.restart()]) for (const name of ['desks.j.equity', 'paperAccount']) {
      assert.equal(h.cells(model)[name].value, null, name);
      assert.equal(h.cells(model)[name].ageSeconds, 4030, name);
    }
  });

  test('JOED-120 M1: restart repairs release-36 renewed receipts before an advancing outage', t => {
    const h = harness(t), candidate = ingress(fixture);
    assert.equal(h.model.accept(candidate).status, 200);
    h.time(4000); candidate.seq++;
    assert.equal(h.model.accept(candidate).status, 200);
    const saved = JSON.parse(h.stored('data'));
    for (const cell of Object.values(saved.cells)) if (cell.value != null) cell.valueReceivedAt = at(4000);
    assert.equal(saved.feed.generatedAdvancedAt, at(0));
    h.replaceState(saved);
    const cold = h.restart();
    assert.equal(cold.hasData(), true);
    h.time(4030);
    const dead = read('failures/a-gateway-up-but-dead.json').payload;
    dead.seq = candidate.seq + 1; dead.generatedAt = dead.safety.gateway.checkedAt = at(4030);
    assert.equal(cold.accept(dead).status, 200);
    const repaired = JSON.parse(h.stored('data'));
    for (const model of [cold, h.restart()]) for (const name of ['desks.j.equity', 'paperAccount']) {
      assert.equal(repaired.cells[name].valueReceivedAt, at(0), name);
      const cell = h.cells(model)[name];
      assert.equal(cell.value, null, name);
      assert.equal(cell.ageSeconds, 4030, name);
    }
    const cells = h.cells(cold);
    t.diagnostic(`M1 probe: ${JSON.stringify(Object.fromEntries([['deskEquity', 'desks.j.equity'], ['account', 'paperAccount']]
      .map(([label, name]) => [label, { shown: cells[name].value != null, retained: cells[name].retained,
        ageSeconds: cells[name].ageSeconds, reason: cells[name].reason }])))}`);
  });

  for (const seeded of [false, true]) test(`JOED-120 F2: non-null retained_values uses only verified last-good (seeded=${seeded})`, t => {
    const h = harness(t);
    if (seeded) assert.equal(h.model.accept(ingress(exact)).status, 200);
    for (const seconds of [30, 120, 3599, 3600, 3660]) {
      h.time(seconds);
      const candidate = retained(exact, seconds, exact.seq + seconds);
      assert.equal(validateContract('data', candidate, { stage: 'ingress' }).ok, true);
      assert.equal(h.model.accept(candidate).status, 200);
      const saved = JSON.parse(h.stored('data'));
      for (const name of ['desks.j.equity', 'paperAccount', 'paperCash']) {
        assert.equal(saved.cells[name].valueReceivedAt, seeded ? at(0) : null, name);
        for (const model of [h.model, h.restart()]) {
          const cell = h.cells(model)[name];
          assert.equal(cell.value != null, seeded && seconds < 3600, name);
          if (seeded) assert.equal(cell.ageSeconds, seconds, name);
        }
      }
      const states = h.cells(h.model);
      for (const name of ['today.equity', 'today.dayPnl', 'today.openPnl', 'today.totalPnl', 'desks.j.totalPnl'])
        assert.equal(states[name].value, null, name);
      assert.equal(h.model.view().data.desks[0].money.equity, null, 'served projection withholds reasoned current input');
      assert.equal(h.model.feeds().history.value.points.at(-1).desks.j.money.equity, null);
    }
  });

  test('JOED-120 F2: restart discards legacy saved cells promoted from a non-null retained_values candidate', t => {
    const h = harness(t);
    assert.equal(h.model.accept(ingress(exact)).status, 200);
    const saved = JSON.parse(h.stored('data'));
    h.time(30);
    saved.feed.value = { ...retained(exact, 30, exact.seq + 1), receivedAt: at(30) };
    saved.feed.generatedAdvancedAt = at(30);
    for (const cell of Object.values(saved.cells)) if (cell.value != null) cell.valueReceivedAt = at(30);
    h.replaceState(saved);
    const cold = h.restart();
    assert.equal(cold.hasData(), true);
    for (const name of ['desks.j.equity', 'paperAccount', 'paperCash']) assert.equal(h.cells(cold)[name].value, null, name);
  });

  test('JOED-120 L1: retained day-P&L cleanup then frozen re-send keeps verified last-goods across restart', t => {
    const h = harness(t);
    assert.equal(h.model.accept(ingress(exact)).status, 200);
    const saved = JSON.parse(h.stored('data'));
    h.time(30);
    const candidate = retained(exact, 30, exact.seq + 1);
    saved.feed.value = { ...candidate, receivedAt: at(30) };
    saved.feed.generatedAdvancedAt = at(30);
    const dayPanels = Object.keys(saved.cells).filter(name => name.endsWith('.dayPnl'));
    assert.equal(dayPanels.length, 4);
    for (const name of dayPanels) {
      assert.notEqual(saved.cells[name].value, null, name);
      assert.ok(Object.hasOwn(saved.cells[name], 'valueSource'), name);
      saved.cells[name].valueReceivedAt = at(30);
    }
    h.replaceState(saved);
    const cold = h.restart();
    const names = ['desks.j.equity', 'today.equity'];
    const before = names.map(name => cold.panels()[name].value != null);
    assert.deepEqual(before, [true, true]);
    h.time(60); candidate.seq++;
    assert.equal(cold.accept(candidate).status, 200);
    const cleaned = JSON.parse(h.stored('data'));
    for (const name of dayPanels) assert.deepEqual(cleaned.cells[name], {
      value: null, valueReceivedAt: null, valueObservedAt: null, valueSource: null,
    }, name);
    const restarted = h.restart();
    assert.equal(restarted.hasData(), true);
    const after = names.map(name => restarted.panels()[name].value != null);
    assert.deepEqual(after, [true, true]);
    for (const name of names) assert.equal(restarted.panels()[name].valueReceivedAt, at(0), name);
    t.diagnostic(`L1 probe: ${JSON.stringify({ before, after, dayPnlKeys: Object.keys(cleaned.cells[dayPanels[0]]) })}`);
  });

  function boundary(seq, limit) {
    const candidate = ingress(fixture), points = [];
    candidate.seq = seq; candidate.desks[0].action = 'x';
    candidate.desks.find(d => d.id === 'j').backfill = { status: 'BEST_AVAILABLE', fullTotalAvailable: false,
      capturedSubtotal: { realizedPnl: null, method: null, fromInclusive: candidate.generatedAt,
        throughInclusive: candidate.generatedAt, points, pointsTruncated: false, executionCount: 0, commissionCount: 0 },
      coverage: { fromInclusive: candidate.generatedAt, toExclusive: candidate.generatedAt, gapCount: 1 },
      missingOpeningLotCount: 1, orphanCommissionCount: 0 };
    const point = { at: candidate.generatedAt, realizedPnl: { amount: '0', currency: 'EUR',
      fx: { base: 'USD', quote: 'EUR', rate: '1', source: 'x'.repeat(80), observedAt: candidate.generatedAt } } };
    const servedBytes = () => bytes({ ...candidate, receivedAt: at(0) });
    while (servedBytes() + bytes(point) + 1 <= limit) points.push(structuredClone(point));
    candidate.desks[0].action += 'x'.repeat(limit - servedBytes());
    assert.equal(servedBytes(), limit);
    assert.equal(validateContract('data', candidate, { stage: 'ingress' }).ok, true);
    return candidate;
  }

  test('JOED-120 F3: inclusive served-size limit persists; one byte over preserves state, history and sequence through restart', t => {
    const h = harness(t), candidate = boundary(fixture.seq, CONTRACTS.limits.data);
    assert.equal(h.model.accept(candidate).status, 200);
    assert.equal(bytes(h.model.view().data), CONTRACTS.limits.data);
    assert.equal(validateContract('data', h.model.view().data).ok, true);
    assert.equal(h.restart().hasData(), true);
    const saved = h.stored('data'), history = h.stored('history');
    candidate.seq++; candidate.desks[0].action += 'x';
    const result = h.model.accept(candidate);
    assert.equal(result.status, 422);
    assert.equal(result.reason, 'contract_invalid');
    assert.deepEqual(result.errors, [{ path: '$', rule: 'maxBytes' }]);
    assert.equal(h.stored('data'), saved); assert.equal(h.stored('history'), history);
    const cold = h.restart();
    assert.equal(cold.hasData(), true); assert.equal(cold.feeds().data.value.seq, fixture.seq);
    candidate.desks[0].action = candidate.desks[0].action.slice(0, -1);
    assert.equal(cold.accept(candidate).status, 200, 'rejected sequence is still available');
  });
}

// JOED-129 request-listener regressions: memory-only, no sockets or host stores.
{
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
  const starter = JSON.parse(fs.readFileSync(new URL('../public/joe/fleet-config.example.json', import.meta.url)));

  function harness(t) {
    const root = '/__joed129_memory_only__';
    const current = structuredClone(starter); current.rev = 'fc-000019';
    const files = new Map([[`${root}/fleet-config.json`, JSON.stringify(current)]]);
    const fds = new Map(); let fd = 1000000, actionWrites = 0, seconds = 0;
    const faults = { receipt: false, finalize: false };
    const virtual = p => typeof p === 'string' && p.startsWith(`${root}/`);
    const missing = () => { throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' }); };
    for (const name of ['existsSync', 'openSync', 'fstatSync', 'readFileSync', 'closeSync']) {
      const original = fs[name];
      t.mock.method(fs, name, (p, ...args) => {
        const key = fds.get(p) ?? p;
        if (!virtual(key)) return original(p, ...args);
        if (name === 'existsSync') return files.has(key);
        if (!files.has(key)) return missing();
        if (name === 'openSync') { const n = fd++; fds.set(n, key); return n; }
        if (name === 'fstatSync') return { size: Buffer.byteLength(files.get(key)) };
        if (name === 'closeSync') return fds.delete(p);
        return args[0] === 'utf8' ? files.get(key) : Buffer.from(files.get(key));
      });
    }
    t.mock.method(fs, 'mkdirSync', p => assert.ok(p === root || virtual(p)));
    t.mock.method(fs, 'chmodSync', p => assert.ok(virtual(p)));
    t.mock.method(fs, 'writeFileSync', (p, value) => {
      assert.ok(virtual(p));
      if (p.endsWith('fleet-config-actions.json.next') && ++actionWrites === 2 && faults.finalize)
        throw new Error('synthetic audit failure');
      files.set(p, String(value));
    });
    t.mock.method(fs, 'renameSync', (a, b) => {
      assert.ok(virtual(a) && virtual(b)); files.set(b, files.get(a)); files.delete(a);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const now = () => new Date(Date.parse(fixture.data.receivedAt) + seconds * 1000).toISOString();
    const server = createJoeServer({ dataDir: root, clock: now, inboxToken: 'synthetic-fixture-only',
      write: (p, value) => {
        assert.ok(virtual(p));
        if (faults.receipt && p.endsWith('fleet-receipt.json')) throw new Error('synthetic receipt failure');
        files.set(p, JSON.stringify(value));
      } });
    async function request(url, { method = 'GET', headers = {}, body } = {}) {
      const req = new EventEmitter();
      Object.assign(req, { url, method, headers: { host: 'fixture.invalid', 'x-auth-request-user': 'fixture', ...headers } });
      let status, payload;
      const res = { writeHead(s) { status = s; }, end(b) { payload = String(b ?? ''); } };
      const done = server.listeners('request')[0](req, res);
      if (body !== undefined) queueMicrotask(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
      await done;
      return { status, body: JSON.parse(payload) };
    }
    const propagate = () => {
      const candidate = structuredClone(current); candidate.desks.keep.push('DEMO');
      return request('/joe/fleet-config/propagate', { method: 'POST',
        headers: { origin: 'http://fixture.invalid', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: JSON.stringify({ baseRev: current.rev, config: candidate }) });
    };
    return { model: server.readModel, faults, request, propagate, now,
      time: value => { seconds = value; }, stored: name => JSON.parse(files.get(`${root}/${name}.json`)) };
  }

  for (const seconds of [0, -10]) for (const mode of ['control', 'receipt', 'finalize']) test(`JOED-129 F1: ${mode}${seconds < 0 ? ' after clock rollback' : ''} enforces committed KEEP before later inbox/history`, async t => {
    const h = harness(t); h.time(seconds); h.faults[mode] = true;
    const sent = await h.propagate();
    assert.equal(h.stored('fleet-config').rev, 'fc-000020');
    assert.equal(h.model.feeds()['fleet-config'].value.rev, 'fc-000020', 'committed policy is effective despite ancillary failure');
    if (mode !== 'control') {
      const outcome = sendOutcome(sent.status, sent.body, ['desks.keep']);
      assert.equal(outcome.stored, true, 'Settings must report the committed KEEP change as saved');
      assert.equal(outcome.rev, 'fc-000020');
    }
    assert.equal(sent.status, mode === 'control' ? 200 : 500);
    assert.equal(sent.body.ok, mode === 'control');
    assert.equal(h.stored('fleet-config-actions').entries.at(-1).outcome, mode === 'control' ? 'success' : 'pending');
    const observedAt = new Date(Date.parse(fixture.data.receivedAt) + seconds * 1000).toISOString();
    assert.equal(h.model.feeds()['fleet-config'].receivedAt, observedAt, 'receipt records the actual observation clock, including rollback');
    h.time(0);
    const data = structuredClone(fixture.data); delete data.receivedAt;
    const pushed = await h.request('/joe/inbox', { method: 'POST',
      headers: { authorization: 'Bearer synthetic-fixture-only' }, body: JSON.stringify(data) });
    assert.equal(pushed.status, 200);
    assert.equal(h.model.panels()['desks.j.equity'].reason, 'source_not_authoritative');
    for (const field of MONEY_FIELDS) {
      assert.equal(h.model.feeds().history.value.points.at(-1).desks.j.money[field], null);
      assert.equal(h.model.feeds().history.value.points.at(-1).totals[field], null);
    }
    h.time(10);
    if (mode === 'receipt') {
      assert.equal((await h.request('/joe/fleet-config.json')).status, 503, 'failed receipt is retried, never silently acknowledged');
      assert.equal(h.stored('fleet-receipt').value.rev, 'fc-000019');
    }
    h.faults.receipt = false;
    assert.equal((await h.request('/joe/fleet-config.json')).status, 200);
    assert.equal(h.stored('fleet-receipt').value.rev, 'fc-000020');
    assert.equal(h.stored('fleet-receipt').receivedAt, observedAt, 'retry preserves the policy observation age');
    assert.equal(h.model.feeds().history.value.points.at(-1).desks.j.money.equity, null);
  });
}

// Scout3's complete wire matrix. F = generic fault, N = deliberate not-exact,
// O = stopped/retained outage, T = transport on a feed, A = replay advisory,
// M = successful history-compaction metadata. Every code also has field scope.
const reasonMatrix = [
  ['gateway_down', 'F', 'broker connection down'],
  ['upstream_lost', 'F', 'broker connection down'],
  ['gateway_degraded', 'F', 'broker connection unstable'],
  ['gateway_unconfirmed', 'F', 'broker connection not confirmed'],
  ['retained_values', 'O', 'carrying the last good value'],
  ['family_projection_unavailable', 'F', 'desk total incomplete'],
  ['day_pnl_unavailable', 'N', 'today’s result not available'],
  ['all_desk_equity_unavailable', 'F', 'desks’ money not available'],
  ['open_pnl_unavailable', 'F', 'open result not available'],
  ['baseline_pending', 'N', 'waiting on the start-of-day value'],
  ['snapshot_stale', 'O', 'updates are late'],
  ['producer_frozen', 'O', 'updates are stuck'],
  ['schema_unsupported', 'F', 'last update had an unknown format'],
  ['contract_invalid', 'F', 'last update was rejected'],
  ['sequence_replayed', 'A', 'last update repeated an old one'],
  ['clock_regressed', 'F', 'last update had a clock behind'],
  ['clock_ahead', 'F', 'last update had a clock ahead'],
  ['feed_not_received', 'F', 'no data received yet'],
  ['market_closed', 'F', 'market closed'],
  ['calendar_unavailable', 'F', 'market calendar not available'],
  ['refresh_failed', 'T', 'update failed'],
  ['auth_required', 'T', 'sign-in expired — reload'],
  ['route_not_found', 'T', 'not found on the board server'],
  ['source_not_authoritative', 'F', 'held back: the kept-holdings list disagrees'],
  ['history_size_limit', 'F', 'history is full'],
  ['history_compacted', 'M', 'history was compacted'],
  ['ledger_size_limit', 'F', 'trade record is full — new orders refused'],
  ['history_write_failed', 'F', 'history could not be saved'],
  ['halt_on', 'F', 'emergency stop is on'],
  ['executor_broker_disagreement', 'F', 'executor and broker disagree'],
  ['results_capture_failed', 'F', 'results capture failing'],
  ['not_exact_yet', 'N', 'not exact'],
  ['source_unavailable', 'F', 'not reported by the broker'],
  ['desk_unmapped', 'F', 'not matched to a desk'],
  ['sod_missing', 'N', 'start-of-day value missing'],
  ['ledger_unreconciled', 'N', 'desk ledger not reconciled'],
  ['position_stale', 'N', 'position update is old'],
];
function reasonedEquity(reason) {
  const data = structuredClone(exact);
  for (const bag of [data.totals, data.desks[0].money]) {
    bag.equity = null;
    (bag.reasons ??= {}).equity = reason;
  }
  assert.equal(validateContract('data', data).ok, true);
  return data;
}
test('JOED-142 reason matrix covers the sealed wire enum and shared dictionary exactly', () => {
  assert.deepEqual(reasonMatrix.map(([code]) => code).sort(), [...REASONS].sort());
  assert.deepEqual(Object.keys(CELL_REASON).sort(), [...REASONS].sort());
  assert.deepEqual(reasonMatrix.filter(([, kind]) => kind === 'N').map(([code]) => code).sort(), [...NOT_EXACT_REASONS].sort());
});
for (const [reason, kind, words] of reasonMatrix) test(`JOED-142 reason matrix: ${reason} in board-state, health and UI`, () => {
  const data = reasonedEquity(reason), feeds = { data: { value: data } }, now = data.receivedAt;
  const states = boardStates(feeds, now), cell = states['desks.j.equity'];
  assert.deepEqual([cell.state, cell.value, cell.retained, cell.reason], ['broken', null, false, reason]);
  assert.deepEqual(localBoardHealth(states, feeds, now), kind === 'N'
    ? { tone: 'green', reason: 'board_ok' } : { tone: 'red', reason: 'equity_unavailable' });
  assert.equal(cellReason(reason), words);
  const phrase = statePhrase(cell, 'matrix');
  assert.equal(phrase.tone, kind === 'N' ? 'none' : 'bad');
  assert.equal(phrase.text, kind === 'N' ? `not exact${reason === 'not_exact_yet' ? '' : ` · ${words}`}` : `unavailable · ${words}`);
  if (kind === 'N') assert.doesNotMatch(phrase.text, /\byet\b/, 'the board cannot say when a value becomes exact');
  // Verified individual observations obey E/O; derived totals remain withheld.
  const carried = boardStates(feeds, now, previous), retained = carried['desks.j.equity'];
  assert.equal(retained.value == null, kind === 'N');
  assert.equal(retained.retained, kind !== 'N');
  assert.equal(carried['today.equity'].value, null);
  assert.equal(statePhrase(retained, 'matrix').tone, kind === 'N' ? 'none' : 'warn');
  assert.deepEqual(localBoardHealth(carried, feeds, now), kind === 'N'
    ? { tone: 'green', reason: 'board_ok' } : { tone: 'yellow', reason: 'retained_values' });
  assert.equal(boardStates(feeds, at(RETENTION_SECONDS), previous)['desks.j.equity'].value, null);
  // Feed scope ranks T separately from rejection/advisory, without losing copy.
  if (kind !== 'N' && reason !== 'feed_not_received') {
    const failed = { data: { value: exact, reason } }, selected = boardStates(failed, now, previous);
    assert.deepEqual(localBoardHealth(selected, failed, now), { tone: 'yellow', reason: kind === 'T' ? 'refresh_failed' : 'retained_values' });
    assert.equal(selected['desks.j.equity'].state, kind === 'A' ? 'stale' : 'broken');
  }
});
for (const reason of NOT_EXACT_REASONS) for (const failure of ['refresh_failed', 'auth_required', 'route_not_found', 'sequence_replayed', 'contract_invalid']) {
  test(`JOED-142 F1: ${reason} stays neutral behind ${failure}`, () => {
    const data = reasonedEquity(reason), now = data.receivedAt;
    const initial = { data: { value: data } }, prior = boardStates(initial, now);
    const feeds = { data: { value: data, reason: failure } }, states = boardStates(feeds, now, prior);
    for (const name of ['today.equity', 'desks.j.equity']) {
      assert.equal(states[name].value, null);
      assert.equal(states[name].retained, false);
      const phrase = statePhrase(states[name], name);
      assert.equal(phrase.tone, 'none');
      assert.equal(phrase.icon, 'info');
      assert.match(phrase.text, /^not exact(?! yet)/);
      assert.ok(phrase.text.includes(cellReason(reason)));
    }
    const health = boardHealthPresentation(states, feeds, now);
    assert.deepEqual([health.tone, health.reason], ['yellow', ['refresh_failed', 'auth_required', 'route_not_found'].includes(failure) ? 'refresh_failed' : 'retained_values']);
    const details = htmlDocument(healthPop({ states, feeds, now }, health)).textContent;
    assert.match(details, /Desk values are not exact(?! yet)/);
    assert.ok(details.includes(cellReason(failure)));
    assert.doesNotMatch(details, /J’s money is unavailable/);
    assert.equal(feeds.data.reason, failure);
    // A later exact observation removes the scoped not-exact classification.
    const recovered = boardStates({ data: { value: exact } }, now, states);
    assert.equal(recovered['desks.j.equity'].reason, null);
    assert.notEqual(recovered['desks.j.equity'].value, null);
  });
}
test('JOED-142 F1: masked exactness preserves halt, ledger, broker, stopped-feed and frozen-producer precedence', () => {
  for (const reason of NOT_EXACT_REASONS) for (const [change, expected] of [
    [data => Object.assign(data.safety, { halt: true, haltReason: 'halt_on' }), 'halt_on'],
    [data => { data.safety.executor.reason = 'ledger_size_limit'; }, 'ledger_size_limit'],
    [data => Object.assign(data.safety.gateway, { apiSessionReady: false, reason: 'gateway_down' }), 'gateway_down'],
    [() => {}, 'feed_disconnected'],
    [() => {}, 'producer_stuck'],
  ]) {
    const data = reasonedEquity(reason); change(data);
    const now = expected === 'feed_disconnected' ? at(FEED_STOPPED_S) : data.receivedAt;
    const feeds = { data: { value: data, reason: 'refresh_failed',
      ...(expected === 'producer_stuck' ? { generatedAdvancedAt: at(-FEED_STOPPED_S) } : {}) } };
    assert.deepEqual(localBoardHealth(boardStates(feeds, now, previous), feeds, now), { tone: 'red', reason: expected });
  }
});

// JOED-148 P0-1: one honest reason per dash. Synthetic amounts only.
function dayNotExact(reasons) {
  const data = structuredClone(exact);
  for (const desk of data.desks) {
    const reason = reasons[desk.id];
    if (!reason) continue;
    desk.money.dayPnl = null; (desk.money.reasons ??= {}).dayPnl = reason;
    Object.assign(desk.pnlSources.day, { status: 'unavailable', method: null, observedAt: null, reason });
  }
  const first = data.desks.map(d => reasons[d.id]).find(Boolean);
  data.totals.dayPnl = null; (data.totals.reasons ??= {}).dayPnl = first;
  Object.assign(data.pnlSources.day, { status: 'unavailable', method: null, observedAt: null, reason: first });
  assert.equal(validateContract('data', data).ok, true);
  return data;
}
const visibleText = doc => { for (const node of doc.querySelectorAll('.cash-sizing')) node.remove(); return doc.textContent; };
// One Details row's value by its label (the dialog's rows are dt/dd pairs).
const detailsRow = (view, label) => {
  const pop = htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, view.now)));
  const i = pop.querySelectorAll('dt').findIndex(dt => dt.textContent === label);
  return i < 0 ? null : pop.querySelectorAll('dd')[i].textContent;
};

test('JOED-148: the household Today names the desks that keep it from being exact, once', () => {
  const view = ctx(dayNotExact({ j: 'not_exact_yet', joe: 'not_exact_yet' }));
  const hero = htmlDocument(heroLeft(view)), today = hero.querySelector('[data-cell="hero.day"]');
  assert.equal(today.querySelector('.bn').textContent, '—');
  assert.equal(today.querySelector('.primary-caption').textContent, 'Not exact for J and Joe');
  assert.equal(today.querySelector('.bn').getAttribute('aria-label'), 'Today: not exact');
  assert.equal(today.querySelector('.cell-state').getAttribute('aria-hidden'), 'true', 'the icon marks the dash; the caption speaks');
  // The sentence gives what is known instead of repeating the reason: each
  // exact desk's own Today (JOED-153: the per-desk breakdown), then Open result.
  const open = ` · open result ${eur(exactCell(view.states['today.openPnl']), true)}`;
  assert.equal(hero.querySelector('.say').textContent, `Joel ${eur(decimalUnits('5'), true)}${open}`);
  assert.equal(hero.querySelector('.board-caption').textContent, '');
  const words = visibleText(hero.querySelector('.hero-primary')).match(/not exact/gi) ?? [];
  assert.equal(words.length, 1, 'the hero states the reason once');
  assert.equal(detailsRow(view, 'Today’s result'), 'Exact for Joel; not exact for J and Joe');
  // Joel's own flat or negative day reads the same way.
  for (const [amount, move] of [['0', 'flat'], ['-1.25', eur(decimalUnits('-1.25'), true)]]) {
    const data = dayNotExact({ j: 'not_exact_yet', joe: 'not_exact_yet' });
    data.desks.find(d => d.id === 'joel').money.dayPnl.amount = amount;
    assert.equal(htmlDocument(heroLeft(ctx(data))).querySelector('.say').textContent, `Joel ${move}${open}`);
  }
});

for (const reason of NOT_EXACT_REASONS) test(`JOED-148 ${reason}: each dash states its one reason once, without "yet" or "not reported"`, () => {
  const words = cellReason(reason), named = `not exact${reason === 'not_exact_yet' ? '' : ` · ${words}`}`;
  const view = ctx(dayNotExact({ j: reason }));
  const hero = htmlDocument(heroLeft(view));
  assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, `Not exact for J${reason === 'not_exact_yet' ? '' : ` · ${words}`}`);
  assert.equal(hero.querySelector('.say').textContent, `Joe ${eur(decimalUnits('-5'), true)} · Joel ${eur(decimalUnits('5'), true)} · open result ${eur(exactCell(view.states['today.openPnl']), true)}`);
  assert.equal(detailsRow(view, 'Today’s result'), `Exact for Joe and Joel; not exact for J${reason === 'not_exact_yet' ? '' : ` · ${words}`}`);
  // J's card: the info icon and the dash carry the reason; no card line repeats
  // it, and the caption under the dash says only its state (JOED-153 M5).
  const card = htmlDocument(deskCard(view, 'j')), dash = card.querySelector('.dnums .bn'), mark = card.querySelector('.dnums .cell-state');
  assert.equal(card.querySelector('.card-status'), null);
  assert.equal(card.querySelector('.dnums .c').textContent, 'Not exact today');
  assert.equal(dash.getAttribute('aria-label'), `Today: ${named}`);
  assert.equal(dash.getAttribute('title'), `Today: ${named}`);
  assert.deepEqual([mark.getAttribute('aria-hidden'), mark.getAttribute('title')], ['true', `${named[0].toUpperCase()}${named.slice(1)}`]);
  // The phone row keeps the reason visible once, in its warning line.
  const phone = htmlDocument(compactDesk(view, 'j'));
  assert.equal(phone.querySelector('.summary-text').textContent, `Today: ${named}`);
  for (const html of [heroLeft(view), deskCard(view, 'j'), compactDesk(view, 'j'), healthPop(view, boardHealthPresentation(view.states, view.feeds, view.now))]) {
    assert.doesNotMatch(html, /not exact yet|not reported · not exact/);
  }
});

test('JOED-148: different desk reasons name their desks; the section line keeps the shared one', () => {
  const mixed = JSON.parse(readFileSync(new URL('../fixtures/phase-b.json', import.meta.url))).mixed;
  const view = ctx(mixed), hero = htmlDocument(heroLeft(view));
  assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Not exact for J and Joe');
  assert.equal(hero.querySelector('.board-caption').textContent, 'Numbers: not exact · desk ledger not reconciled');
  assert.equal(hero.querySelector('.say').textContent, `Joel ${eur(decimalUnits('5'), true)}`, 'no exact Open result here, so none is said');
  assert.equal(detailsRow(view, 'Today’s result'), 'Exact for Joel; not exact for J · desk ledger not reconciled; not exact for Joe · start-of-day value missing');
  // Every desk blocked for one reason needs no names; a fault keeps its own word.
  const all = ctx(dayNotExact({ j: 'sod_missing', joe: 'sod_missing', joel: 'sod_missing' }));
  assert.equal(htmlDocument(heroLeft(all)).querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Not exact · start-of-day value missing');
  assert.equal(htmlDocument(heroLeft(all)).querySelector('.say').textContent, 'No desk has an exact result for today.');
  const fault = dayNotExact({ j: 'not_exact_yet', joe: 'source_unavailable' });
  // An outage keeps Joe's last good value (never in the household total); a
  // cold page has none. Either way the household caption leads with the
  // fault using Joe's own state word, as do Details and the cards.
  const carried = ctx(fault), cold = { ...carried, states: boardStates(carried.feeds, carried.now) };
  assert.equal(htmlDocument(heroLeft(carried)).querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Last good for Joe · not reported by the broker; not exact for J');
  assert.equal(detailsRow(carried, 'Today’s result'), 'Exact for Joel; not exact for J; last good for Joe · not reported by the broker');
  assert.equal(htmlDocument(heroLeft(cold)).querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Unavailable for Joe · not reported by the broker; not exact for J');
  assert.equal(detailsRow(cold, 'Today’s result'), 'Exact for Joel; not exact for J; unavailable for Joe · not reported by the broker');
});

test('JOED-148: a card line stays when the not-exact Today is not the card’s only problem', () => {
  const data = dayNotExact({ j: 'not_exact_yet' });
  const j = data.desks.find(d => d.id === 'j');
  j.money.openPnl = null; j.money.reasons.openPnl = 'source_unavailable';
  Object.assign(j.pnlSources.open, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  data.totals.openPnl = null; data.totals.reasons.openPnl = 'source_unavailable';
  Object.assign(data.pnlSources.open, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  assert.equal(validateContract('data', data).ok, true);
  const lines = htmlDocument(deskCard(ctx(data), 'j')).querySelectorAll('.card-status .st').map(line => line.textContent);
  assert.deepEqual(lines, ['Today: not exact', `Open result: last good, ${age(30)} ago · not reported by the broker`]);
});

// JOED-148 P0-5: the v2 feed sends no learning and no check-ins, and its desk
// actions are the pusher's valuation sentences. None of that is shown as news.
function quietV2() {
  const data = structuredClone(exact);
  const sentences = { j: 'Some paper desk values are unavailable.', joe: 'Paper desk values are available.', joel: 'Valuation is not exact yet.' };
  for (const desk of data.desks) { delete desk.heartbeatAt; delete desk.learning; desk.action = sentences[desk.id]; }
  assert.equal(validateContract('data', data).ok, true);
  return data;
}
const pop = view => htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, view.now)));

test('JOED-148: no Learning line without learning; the line returns when the feed reports learning', () => {
  const data = quietV2(), view = ctx(data);
  for (const id of DESKS) {
    const card = htmlDocument(deskCard(view, id));
    assert.equal(card.querySelector('footer'), null, `${id}: no permanent "Learning: not reported"`);
    assert.doesNotMatch(card.textContent, /Learning|not reported/);
  }
  data.desks[0].learning = { status: 'blocked', headline: 'Synthetic headline', detail: 'Synthetic detail', iteration: 2 };
  assert.equal(validateContract('data', data).ok, true);
  const footer = htmlDocument(deskCard(ctx(data), 'j')).querySelector('footer');
  assert.equal(footer.textContent, 'Learning: Synthetic headline · Synthetic detail · round 2 · blocked');
});

test('JOED-148: check-in warnings and the Checked in row appear only when the feed carries check-ins', () => {
  const view = ctx(quietV2());
  view.states.history = { state: 'fresh', value: {}, reason: null };
  for (const id of DESKS) {
    const row = htmlDocument(compactDesk(view, id));
    assert.doesNotMatch(row.textContent, /Check-in/, `${id}: no false phone warning`);
    assert.equal(row.querySelector('.summary-text'), null, `${id}: a quiet row has no warning at all`);
  }
  const details = pop(view);
  assert.equal(details.querySelectorAll('dt').some(dt => dt.textContent === 'Checked in'), false);
  assert.doesNotMatch(healthPop(view, boardHealthPresentation(view.states, view.feeds, view.now)), /data-term="heartbeat"/);
  // A feed with check-ins still names the desk whose check-in is missing.
  const data = structuredClone(exact); delete data.desks[2].heartbeatAt;
  const carried = ctx(data);
  assert.match(htmlDocument(compactDesk(carried, 'joel')).querySelector('.summary-text').textContent, /^Check-in: not reported/);
  assert.doesNotMatch(htmlDocument(compactDesk(carried, 'j')).textContent, /Check-in/);
  const row = pop(carried).querySelectorAll('dt').findIndex(dt => dt.textContent === 'Checked in');
  assert.match(pop(carried).querySelectorAll('dd')[row].textContent, /Joel: not reported$/);
});

test('JOED-148: the pusher’s valuation sentences give way to the desk’s state; real activity stays', () => {
  const data = quietV2(), view = ctx(data);
  // JOED-153 M5: the card's header says what the desk is doing; no line repeats the pusher.
  const card = id => htmlDocument(deskCard(view, id));
  for (const id of DESKS) assert.equal(card(id).querySelector('.now'), null, id);
  assert.deepEqual(DESKS.map(id => card(id).querySelector('header .state span').textContent.split(/\s· /)[0]), ['Working', 'Sitting out', 'Sitting out']);
  assert.doesNotMatch(DESKS.map(id => card(id).textContent).join(' '), /values are|Valuation/);
  data.desks[0].state = 'stuck';
  assert.match(htmlDocument(deskCard(ctx(data), 'j')).querySelector('header .state span').textContent, /^Stuck\s· its trading activity can’t be confirmed$/);
  assert.ok(boardDiagnostics(ctx(data).states, ctx(data).feeds, ctx(data).now).includes('J is stuck: its trading activity can’t be confirmed.'));
  assert.doesNotMatch(boardDiagnostics(ctx(data).states, ctx(data).feeds, ctx(data).now).join(' '), /values are|Valuation/);
  // A desk's own activity sentence is news and stays verbatim (escaped).
  data.desks[0].action = 'Synthetic <b>activity</b> sentence.';
  assert.equal(htmlDocument(deskCard(ctx(data), 'j')).querySelector('.now').textContent, 'Synthetic <b>activity</b> sentence.');
  assert.ok(deskCard(ctx(data), 'j').includes('Synthetic &lt;b&gt;activity&lt;/b&gt; sentence.'));
});

// JOED-148 A3 (Amy 2026-10-29): during regular hours a Today the feed explains
// as not exact keeps the light green with one Details line; real gaps stay yellow.
test('JOED-148 A3: a not-exact Today keeps the regular-hours light green and says why in Details', () => {
  for (const reasons of [{ j: 'not_exact_yet', joe: 'not_exact_yet' }, ...[...NOT_EXACT_REASONS].map(r => ({ j: r, joe: r, joel: r }))]) {
    const view = ctx(dayNotExact(reasons));  // 13:42 New York time on a Wednesday: regular hours
    const health = boardHealthPresentation(view.states, view.feeds, view.now);
    assert.deepEqual([health.tone, health.reason, health.label], ['green', 'board_ok', 'Board OK'], JSON.stringify(reasons));
    assert.match(statusPresentation(view, health).sentence, /^Live · updated /);
    // Details explains it once, in its "Today’s result" row (no second note).
    const details = pop(view), notes = details.querySelectorAll('.st.none').map(note => note.textContent);
    const reason = reasons.joel ? cellReason(reasons.joel) : null;
    const expected = reasons.joel ? `Not exact for J, Joe and Joel${reason === 'not exact' ? '' : ` · ${reason}`}` : 'Exact for Joel; not exact for J and Joe';
    assert.equal(detailsRow(view, 'Today’s result'), expected, JSON.stringify(reasons));
    assert.ok(!notes.some(note => note.startsWith('Today')), `${JSON.stringify(reasons)}: ${notes}`);
    assert.equal(details.querySelectorAll('p').find(p => p.textContent === 'No current problems.')?.textContent, 'No current problems.', 'a not-exact Today is not a problem');
    assert.doesNotMatch(details.textContent, /during New York regular hours|money is unavailable/);
  }
});

test('JOED-148 A3: real gaps keep the yellow Today warning: no reason, a fault reason, or a desk without an explained Today', () => {
  // Details names each real gap once: the household's, and each desk's own.
  const yellow = (view, why, problem) => {
    const health = boardHealthPresentation(view.states, view.feeds, view.now), status = statusPresentation(view, health);
    assert.deepEqual([health.tone, health.reason, health.label], ['yellow', 'day_pending', 'Data delayed'], why);
    assert.deepEqual([status.sentence, status.alert, status.compact], ['Today’s result is late', 'Today’s result is late · Reload; if it stays, tell Amy', 'Result late'], why);
    assert.match(pop(view).textContent, problem, why);
  };
  const household = /Today’s result is unavailable during New York regular hours/;
  const none = ctx(exact); none.states['today.dayPnl'] = { state: 'broken', value: null, reason: null, retained: false };
  yellow(none, 'no reason', household);
  const cold = data => { const view = ctx(data); return { ...view, states: boardStates(view.feeds, view.now) }; };
  yellow(cold(dayNotExact({ j: 'source_unavailable', joe: 'source_unavailable', joel: 'source_unavailable' })), 'a fault reason', household);
  yellow(cold(dayNotExact({ j: 'not_exact_yet', joe: 'source_unavailable' })), 'one desk has a real gap', /Joe’s Today is unavailable: not reported by the broker\./);
  yellow(ctx(dayNotExact({ j: 'not_exact_yet', joe: 'source_unavailable' })), 'one desk only has a last good value', /Joe’s Today is only a last good value: not reported by the broker\./);
  // JOED-103 stays: not-exact values never turn the board red.
  for (const reason of NOT_EXACT_REASONS) assert.notEqual(boardHealthPresentation(ctx(missing(reason)).states, ctx(missing(reason)).feeds, ctx(missing(reason)).now).tone, 'red', reason);
});

// JOED-148 fix round 1 (gate finding 1): A3 may excuse only desks whose Today
// is trustworthy and current or withheld as not exact. A shown value that
// carries a fault reason, a non-current state, a last good value or an
// unavailable source is a real gap.
test('JOED-148 A3: a desk Today shown with a fault reason keeps the light yellow (contract-valid wire case)', () => {
  const data = dayNotExact({ j: 'not_exact_yet' });
  const joe = data.desks.find(d => d.id === 'joe');
  assert.notEqual(joe.money.dayPnl, null);
  joe.money.reasons = { ...joe.money.reasons, dayPnl: 'source_unavailable' };
  assert.equal(validateContract('data', data).ok, true);
  const view = ctx(data), cell = view.states['desks.joe.dayPnl'];
  assert.deepEqual([cell.state, cell.value != null, cell.retained, cell.reason], ['broken', true, false, 'source_unavailable']);
  const health = boardHealthPresentation(view.states, view.feeds, view.now);
  assert.deepEqual([health.tone, health.reason], ['yellow', 'day_pending']);
  // The hero and Details name Joe's real gap with the same test the light uses.
  assert.equal(htmlDocument(heroLeft(view)).querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Unavailable for Joe · not reported by the broker; not exact for J');
  assert.equal(detailsRow(view, 'Today’s result'), 'Exact for Joel; not exact for J; unavailable for Joe · not reported by the broker');
});

const FAULT_REASONS = REASONS.filter(reason => !NOT_EXACT_REASONS.has(reason));
const shown = { amount: '-5', currency: 'EUR' };
const joeTodayGaps = [
  ...FAULT_REASONS.map(reason => [`shown with ${reason}`, { state: 'broken', value: shown, retained: false, reason }]),
  ['stale', { state: 'stale', value: shown, retained: false, reason: 'snapshot_stale' }],
  ['frozen', { state: 'stale', value: shown, retained: false, reason: 'producer_frozen' }],
  ['replay advisory', { state: 'stale', value: shown, retained: false, reason: 'sequence_replayed' }],
  ['last good', { state: 'broken', value: shown, retained: true, reason: 'gateway_down', ageSeconds: 30 }],
  ['fresh, from an unavailable source', { state: 'fresh', value: shown, retained: false, reason: null, valueSource: { status: 'unavailable', reason: 'source_unavailable' } }],
  ['fresh with a fault reason', { state: 'fresh', value: shown, retained: false, reason: 'source_unavailable' }],
  ['not reported', { state: 'not reported', value: null, retained: false, reason: null }],
  ['unavailable', { state: 'broken', value: null, retained: false, reason: 'source_unavailable' }],
  ['missing', undefined],
];
for (const [what, gap] of joeTodayGaps) test(`JOED-148 A3: J not exact beside Joe's Today ${what} is a real gap: yellow`, () => {
  const view = ctx(dayNotExact({ j: 'not_exact_yet' }));
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'green', reason: 'board_ok' }, 'control: Joe exact');
  if (gap === undefined) delete view.states['desks.joe.dayPnl']; else view.states['desks.joe.dayPnl'] = gap;
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason: 'day_pending' }, what);
  // Details names Joe's own gap; the household (J not exact) is not the fault.
  assert.match(boardDiagnostics(view.states, view.feeds, view.now).join(' '), what === 'last good' ? /Joe’s Today is only a last good value/ : /Joe’s Today is unavailable/);
  assert.equal(trustedCurrent(view.states['desks.joe.dayPnl']), false);
});

test('JOED-148: trustedCurrent is the one test for a current, true value', () => {
  const fresh = { state: 'fresh', value: shown, retained: false, reason: null };
  assert.equal(trustedCurrent(fresh), true);
  assert.equal(trustedCurrent({ ...fresh, valueSource: { status: 'available', method: 'sod-virtual-equity' } }), true);
  assert.equal(trustedCurrent({ ...fresh, valueSource: { status: 'available', method: 'session-open-estimate' } }), true, 'an estimate is current; its cards mark it');
  for (const [, gap] of joeTodayGaps) assert.equal(trustedCurrent(gap), false);
  for (const reason of NOT_EXACT_REASONS) assert.equal(trustedCurrent({ ...fresh, value: null, state: 'broken', reason }), false);
});

// JOED-148 fix round 1 (design review of the JOED-147 mockup): Details states a
// not-exact Today once, in its "Today’s result" row; no separate note repeats it.
test('JOED-148: Details carries one line for a not-exact Today', () => {
  for (const data of [dayNotExact({ j: 'not_exact_yet', joe: 'not_exact_yet' }), JSON.parse(readFileSync(new URL('../fixtures/phase-b.json', import.meta.url))).mixed]) {
    const view = ctx(data), text = pop(view).textContent;
    assert.equal(text.match(/not exact for J\b/g)?.length, 1, text);
    assert.doesNotMatch(text, /Today: not exact/);
  }
});

// JOED-148 fix round 2: one classifier for a Today figure over every channel
// the contract allows (the board's cell, the money reason, the source's status
// and reason). A fault on any channel wins.
test('JOED-148: classifyDay truth table over every channel', () => {
  const fresh = { state: 'fresh', value: { amount: '1', currency: 'EUR' }, retained: false, reason: null };
  const dash = reason => ({ state: 'broken', value: null, retained: false, reason });
  const available = { status: 'available', method: 'sod-virtual-equity' };
  const unavailable = reason => ({ status: 'unavailable', method: null, ...(reason ? { reason } : {}) });
  for (const [what, cell, moneyReason, source, kind, reason] of [
    ['a current value from an available source', fresh, null, available, 'exact', null],
    ['a current session-open estimate', fresh, null, { status: 'available', method: 'session-open-estimate' }, 'exact', null],
    ['a current value without source evidence', fresh, null, null, 'exact', null],
    ['not exact on the money channel', dash('not_exact_yet'), 'not_exact_yet', unavailable(), 'notExact', 'not_exact_yet'],
    ['not exact on the source channel', dash('not_exact_yet'), null, unavailable('not_exact_yet'), 'notExact', 'not_exact_yet'],
    ['the board’s New York-day guard', dash('baseline_pending'), null, available, 'notExact', 'baseline_pending'],
    ['a fault on the money channel', dash('source_unavailable'), 'source_unavailable', unavailable(), 'fault', 'source_unavailable'],
    ['a fault on the source channel', dash('source_unavailable'), null, unavailable('source_unavailable'), 'fault', 'source_unavailable'],
    ['not exact money beside a faulty source', dash('not_exact_yet'), 'not_exact_yet', unavailable('source_unavailable'), 'fault', 'source_unavailable'],
    ['a money fault beside a not-exact source', dash('not_exact_yet'), 'source_unavailable', unavailable('not_exact_yet'), 'fault', 'source_unavailable'],
    ['a value kept beside a money fault', { ...fresh, state: 'broken', reason: 'source_unavailable' }, 'source_unavailable', available, 'fault', 'source_unavailable'],
    ['a value from a source that says it is unavailable', fresh, null, unavailable(), 'fault', null],
    ['a last good value', { ...fresh, state: 'broken', retained: true, reason: 'gateway_down' }, 'source_unavailable', unavailable('source_unavailable'), 'fault', 'gateway_down'],
    ['a last good value with a not-exact reason', { ...fresh, state: 'broken', retained: true, reason: 'not_exact_yet' }, null, null, 'fault', null],
    ['stopped data', { ...fresh, state: 'stale', reason: 'snapshot_stale' }, null, available, 'fault', 'snapshot_stale'],
    ['not reported, no reason anywhere', { state: 'not reported', value: null, retained: false, reason: null }, null, unavailable(), 'fault', null],
    ['a missing cell', undefined, null, null, 'fault', null],
  ]) {
    const day = classifyDay(cell, { moneyReason, source });
    assert.deepEqual([day.kind, day.reason], [kind, reason], what);
    assert.equal(Boolean(day.estimated), what === 'a current session-open estimate', what);
  }
  // Channels come from the snapshot: the desk's own source, else the snapshot's.
  const data = structuredClone(exact);
  delete data.desks[1].pnlSources;
  data.desks[1].money.reasons = { dayPnl: 'not_exact_yet' };
  assert.deepEqual(dayChannels(data, 'joe'), { moneyReason: 'not_exact_yet', source: data.pnlSources.day });
  assert.deepEqual(dayChannels(data, 'j'), { moneyReason: null, source: data.desks[0].pnlSources.day });
  assert.deepEqual(dayChannels(data, 'today'), { moneyReason: null, source: data.pnlSources.day });
  assert.deepEqual(Object.keys(classifyDays({}, data)), ['today', 'j', 'joe', 'joel']);
});

// The re-gate's two concrete reproductions, contract-valid, by name.
test('JOED-148 re-gate High 1: a current household Today never exempts a desk whose Today is a fault', () => {
  const data = structuredClone(exact);
  data.desks.find(d => d.id === 'joe').money.reasons = { dayPnl: 'source_unavailable' };
  assert.equal(validateContract('data', data).ok, true);
  const view = ctx(data), joe = view.states['desks.joe.dayPnl'];
  // Joe keeps a value beside a fault reason; the pusher's household total is current on its own channels.
  assert.deepEqual([joe.state, joe.value != null, joe.retained, joe.reason], ['broken', true, false, 'source_unavailable']);
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason: 'day_pending' });
  assert.ok(boardDiagnostics(view.states, view.feeds, view.now).includes('Joe’s Today is unavailable: not reported by the broker.'));
  assert.deepEqual(classifyDay(joe, dayChannels(data, 'joe')), { kind: 'fault', reason: 'source_unavailable' });
  // A total across a faulty desk is no clean household result: the hero
  // withholds it and keeps the exact desks' own results.
  assert.deepEqual([view.states['today.dayPnl'].value, view.states['today.dayPnl'].reason], [null, 'source_unavailable']);
  const hero = htmlDocument(heroLeft(view));
  assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Unavailable for Joe · not reported by the broker');
  assert.equal(hero.querySelector('.say').textContent, `J ${eur(decimalUnits('50'), true)} · Joel ${eur(decimalUnits('5'), true)}${exactCell(view.states['today.openPnl']) === null ? '' : ` · open result ${eur(exactCell(view.states['today.openPnl']), true)}`}`);
  assert.equal(todayPercent(view.states, data.pnlSources.day), null);
});

test('JOED-148 re-gate High 2: a not-exact money reason never masks a faulty source', () => {
  const data = dayNotExact({ joe: 'not_exact_yet' });
  Object.assign(data.desks.find(d => d.id === 'joe').pnlSources.day, { reason: 'source_unavailable' });
  assert.equal(validateContract('data', data).ok, true);
  const view = ctx(data);
  assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'yellow', reason: 'day_pending' });
  assert.deepEqual(classifyDays(view.states, data).joe, { kind: 'fault', reason: 'source_unavailable' });
  // The cell itself carries the fault, so the card, the hero and Details agree.
  assert.deepEqual([view.states['desks.joe.dayPnl'].value, view.states['desks.joe.dayPnl'].reason], [null, 'source_unavailable']);
  assert.equal(htmlDocument(heroLeft(view)).querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Unavailable for Joe · not reported by the broker');
  assert.equal(detailsRow(view, 'Today’s result'), 'Exact for J and Joel; unavailable for Joe · not reported by the broker');
  assert.equal(htmlDocument(deskCard(view, 'joe')).querySelector('.card-status').textContent, 'Today: unavailable · not reported by the broker');
});

// Every combination of the desks' and the household's Today channels during
// regular hours, judged by an oracle written in plain words, apart from the
// board's code, on every surface that shows Today: the light, Details, the
// hero, each desk card and each phone row. Many of these snapshots are ones
// the contract would reject at ingress; the board must still never call a
// fault green or show it as anything but a fault.
//
// The oracle. The test's fault reason (source_unavailable) in the board's words:
const BROKER = 'not reported by the broker';
// Each desk's Today: what it is; whether it is fine during regular hours; the
// one word the board uses for it, with its reason; whether the desk still
// shows a value; and the one line its card and its phone row carry (none when
// it is exact, or when a not-exact dash's own name says it).
const AS_FAULT = { fine: false, word: 'unavailable', reason: BROKER, value: false, card: `Today: unavailable · ${BROKER}`, phone: `Today: unavailable · ${BROKER}` };
const DESK_TODAY = {
  exact: { says: 'an exact, current value', fine: true, word: 'exact', value: true, card: null, phone: null },
  notExactMoney: { says: 'withheld as not exact on the money channel', fine: true, word: 'not exact', value: false, card: null, phone: 'Today: not exact' },
  notExactSource: { says: 'withheld as not exact on the source channel', fine: true, word: 'not exact', value: false, card: null, phone: 'Today: not exact' },
  faultMoney: { says: 'withheld for a fault on the money channel', ...AS_FAULT },
  faultSource: { says: 'withheld for a fault on the source channel', ...AS_FAULT },
  notExactMoneyFaultSource: { says: 'not exact on the money channel but a fault on the source channel', ...AS_FAULT },
  faultMoneyNotExactSource: { says: 'a fault on the money channel but not exact on the source channel', ...AS_FAULT },
  // The phone row adds its own fallback reason to a reason-less dash (since 811f9b2).
  unavailable: { says: 'unavailable, with no reason on any channel', fine: false, word: 'not reported', value: false, card: 'Today: not reported',
    phone: /^Today: not reported(?: · no data received yet)?$/ },
  lastGood: { says: 'only a last good value from before an outage', fine: false, word: 'last good', reason: BROKER, value: true,
    card: `Today: last good, ${age(30)} ago · ${BROKER}`, phone: `Today: last good · ${BROKER}` },
  valueKeptFaultMoney: { says: 'a value kept beside a fault on the money channel', fine: false, word: 'unavailable', reason: BROKER, value: true,
    card: `Today: unavailable · ${BROKER} · as of ${age(30)} ago`, phone: `Today: unavailable · ${BROKER}` },
};
// The household's Today, and whether it is fine:
const HOUSEHOLD_TODAY = {
  current: { says: 'a current total', fine: true },
  notExact: { says: 'withheld as not exact', fine: true },
  fault: { says: 'withheld for a fault', fine: false },
  nullNoReason: { says: 'missing, with no reason', fine: false },
};
// What the board must show, surface by surface:
// - The light is green only when no Today is a fault: the household's Today
//   is fine and so is every desk's. Anything else is yellow, "Today’s result
//   is late".
// - The household Today is shown only as a current total of three exact
//   desks: the hero gives the fixture's total with no caption and says "Up …
//   today across J, Joe and Joel". Otherwise the hero shows a dash. When the
//   dash has a caption, the sentence gives each exact desk's own result and
//   no other desk's, or says that no desk is exact (Today withheld as not
//   exact with every desk fine) or that Today's result is not available (an
//   own or inherited fault wins even beside a not-exact household); without a
//   caption, the sentence itself says that Today's result is not available.
// - The hero's dash has a caption unless the household Today came with no
//   reason at all and every desk is fine. The caption names a desk only in
//   that desk's own word, never an exact desk, and when it names any desk it
//   names every desk that is not exact. When everything is fine it says
//   "Not exact" and nothing worse; otherwise the caption or sentence says so.
// - Details states each desk whose Today is not fine once, in its own words,
//   and no other desk. A household Today that is not fine gets its own line;
//   one withheld as not exact, or current beside fine desks, gets none unless
//   it inherits a desk's fault. The "Today’s result" row lists every desk
//   exactly once in its own word and reason whenever it lists desks, and must
//   do so when the household Today is withheld as not exact; otherwise it
//   gives the household's own source ("Counted from …", or "Not available · …").
// - Each card and each phone row shows the desk's own value or a dash. A dash
//   is named with its reason; the desk's problem, if any, is its one line.
const NAMES = { j: 'J', joe: 'Joe', joel: 'Joel' };
const FIGURE = { j: '+€50,00', joe: '−€5,00', joel: '+€5,00' };  // the fixture's desk results
const OWN_FIGURE = { j: eur(decimalUnits('50'), true), joe: eur(decimalUnits('-5'), true), joel: eur(decimalUnits('5'), true) };
const FAULT_WORDS = /unavailable|not available|not reported|last good/i;
const PROBLEM = { unavailable: `is unavailable: ${BROKER}.`, 'not reported': 'is unavailable.', 'last good': `is only a last good value: ${BROKER}.` };
const SOURCE_ROW = /^(?:Counted from 06:00 \(midnight in New York\)|Not available · .+)$/;
// "Exact for Joel; not exact for J and Joe · reason" as [name, word, reason] per named desk.
const namedIn = text => text.split('; ').flatMap(group => {
  const m = group.match(/^(exact|estimated|not exact|unavailable|not reported|last good|stale) for (.+?)(?: · (.+))?$/i);
  return m ? m[2].split(/, | and /).map(name => [name, m[1].toLowerCase(), m[3] ?? null]) : [];
});
const sameNames = (named, desks) => JSON.stringify(named.map(([name]) => name).sort()) === JSON.stringify(desks.map(d => d.name).sort());
// A dash names its reason: "Today: not exact", "Today: not reported", or a
// fault's own words; a fault is never named "not exact".
const dashNamed = (name, desk) => desk.word === 'not exact' ? name === 'Today: not exact'
  : desk.word === 'not reported' ? name === 'Today: not reported'
    : name?.startsWith('Today: ') && name.endsWith(` · ${desk.reason}`) && !name.includes('not exact');
// The hero also renders Since start and the account panel; only its Today
// cell and its sentence are parsed, to keep 4000 renders fast.
function heroToday(html) {
  const since = html.indexOf('<div class="primary since-primary"'), say = html.indexOf('<button type="button" class="say"');
  const account = html.indexOf('<div class="account-section"');
  assert.ok(since > 0 && say > since && account > say, 'the hero markup changed; update heroToday');
  return htmlDocument(html.slice(0, since) + html.slice(say, account));
}
// A card's and a phone row's Today, read from their parsed markup. Cards and
// rows repeat across cases, so each distinct markup is parsed and read once.
const cardToday = doc => {
  const cell = doc.querySelector('.dnums .bn');
  // JOED-153: a card's status lines sit over its bars (.card-status).
  return { figure: cell.textContent, name: cell.getAttribute('aria-label'), lines: doc.querySelectorAll('.card-status .st').map(line => line.textContent) };
};
const phoneToday = doc => {
  const cell = doc.querySelector('[data-compact-value="dayPnl"] .bn');
  return { figure: cell.textContent, name: cell.getAttribute('aria-label'), line: doc.querySelector('.summary-text')?.textContent ?? null };
};
const readCards = new Map(), readRows = new Map();
const readOnce = (seen, html, read) => seen.get(html) ?? seen.set(html, read(htmlDocument(html))).get(html);
function dayCombination(desks, household) {
  const data = structuredClone(exact), prior = {};
  const withhold = (bag, source, moneyReason, sourceReason) => {
    bag.dayPnl = null;
    if (moneyReason) (bag.reasons ??= {}).dayPnl = moneyReason; else if (bag.reasons) delete bag.reasons.dayPnl;
    Object.assign(source, { status: 'unavailable', method: null, observedAt: null });
    if (sourceReason) source.reason = sourceReason; else delete source.reason;
  };
  desks.forEach((option, i) => {
    const desk = data.desks[i], source = desk.pnlSources.day, money = desk.money;
    if (option === 'notExactMoney') withhold(money, source, 'not_exact_yet', null);
    if (option === 'notExactSource') withhold(money, source, null, 'not_exact_yet');
    if (option === 'faultMoney') withhold(money, source, 'source_unavailable', null);
    if (option === 'faultSource') withhold(money, source, null, 'source_unavailable');
    if (option === 'notExactMoneyFaultSource') withhold(money, source, 'not_exact_yet', 'source_unavailable');
    if (option === 'faultMoneyNotExactSource') withhold(money, source, 'source_unavailable', 'not_exact_yet');
    if (option === 'unavailable') withhold(money, source, null, null);
    if (option === 'lastGood') {
      withhold(money, source, 'source_unavailable', 'source_unavailable');
      prior[`desks.${desk.id}.dayPnl`] = previous[`desks.${desk.id}.dayPnl`];
    }
    if (option === 'valueKeptFaultMoney') (money.reasons ??= {}).dayPnl = 'source_unavailable';
  });
  const householdReason = { notExact: 'not_exact_yet', fault: 'source_unavailable', nullNoReason: null }[household];
  if (household !== 'current') withhold(data.totals, data.pnlSources.day, householdReason, householdReason);
  const feeds = { data: { value: data } }, now = at(30);  // 13:42 New York on a Wednesday: regular hours
  const states = boardStates(feeds, now, prior);
  states.history = { state: 'fresh', value: {}, reason: null };  // no History feed here; its line stays quiet
  return { feeds, now, states };
}
// Every surface against the oracle; returns what is wrong, in words.
function daySurfaces(view, desks, household) {
  const wrong = [], expect = (ok, what) => { if (!ok) wrong.push(what); };
  const own = desks.map((option, i) => ({ id: DESKS[i], name: NAMES[DESKS[i]], reason: null, ...DESK_TODAY[option] }));
  const fine = HOUSEHOLD_TODAY[household].fine && own.every(d => d.fine);
  const householdFault = !HOUSEHOLD_TODAY[household].fine || own.some(d => !d.fine);
  const shown = household === 'current' && own.every(d => d.word === 'exact');
  const exactDesks = own.filter(d => d.word === 'exact'), notExactDesks = own.filter(d => d.word === 'not exact');
  // The light.
  const health = boardHealthPresentation(view.states, view.feeds, view.now);
  expect(health.tone === (fine ? 'green' : 'yellow') && health.reason === (fine ? 'board_ok' : 'day_pending'), `light: ${health.tone} ${health.reason}`);
  // Details: one line per desk that is not fine, the household's own line, and the Today row.
  // Details joins its problems into one paragraph, a sentence each.
  const details = htmlDocument(healthPop(view, health)), lines = details.querySelectorAll('p').flatMap(p => p.textContent.split(/(?<=\.) (?=[A-Z])/));
  const deskLines = lines.filter(line => /^(?:J|Joe|Joel)’s Today is /.test(line));
  expect(JSON.stringify(deskLines) === JSON.stringify(own.filter(d => !d.fine).map(d => `${d.name}’s Today ${PROBLEM[d.word]}`)), `Details lines: ${deskLines.join(' ')}`);
  const householdLine = lines.some(line => line.startsWith('Today’s result is unavailable during New York regular hours: '));
  if (!HOUSEHOLD_TODAY[household].fine) expect(householdLine, 'Details: no line for the household Today');
  else if (own.every(d => d.fine)) expect(!householdLine, 'Details: a household line beside a fine household Today');
  // JOED-157: a not-exact household takes on a desk's fault (fault wins), so Details names it too.
  if (household === 'notExact' && own.some(d => !d.fine)) expect(householdLine, 'Details: the household Today inherits the desk fault');
  const row = details.querySelectorAll('dd')[details.querySelectorAll('dt').findIndex(dt => dt.textContent === 'Today’s result')].textContent;
  const rowNamed = namedIn(row);
  if (shown) expect(row === 'Counted from 06:00 (midnight in New York)', `Today row: ${row}`);
  else if (household === 'notExact' && exactDesks.length === 3) expect(row === 'Household not exact; each desk exact', `Today row: ${row}`);
  else if (household === 'notExact' || (household === 'current' && own.every(d => d.fine))) expect(rowNamed.length > 0, `Today row lists no desk: ${row}`);
  if (rowNamed.length) {
    expect(sameNames(rowNamed, own), `Today row names: ${row}`);
    for (const d of own) {
      const [, word, reason] = rowNamed.find(([name]) => name === d.name) ?? [];
      expect(word === d.word && reason === d.reason, `Today row on ${d.name}: ${row}`);
    }
  } else if (!shown && row !== 'Household not exact; each desk exact') expect(SOURCE_ROW.test(row), `Today row: ${row}`);
  // The hero: figure, caption and sentence.
  const hero = heroToday(heroLeft(view)), day = hero.querySelector('[data-cell="hero.day"]'), figure = day.querySelector('.bn');
  const caption = day.querySelector('.primary-caption').textContent, sentence = hero.querySelector('.say').textContent;
  expect(figure.textContent === (shown ? '+€50,00' : '—'), `hero figure: ${figure.textContent}`);
  // JOED-153: the sentence is the per-desk breakdown of the exact desks
  // ("J +€ 50,00 · Joe −€ 5,00 · Joel +€ 5,00"), with the open result when
  // the household Today is not shown; a shown Today has its designed caption.
  const open = exactCell(view.states['today.openPnl']);
  const breakdown = (desks, withOpen) => [...desks.map(d => `${d.name} ${OWN_FIGURE[d.id]}`), ...(withOpen && open !== null ? [`open result ${eur(open, true)}`] : [])].join(' · ');
  if (shown) {
    expect(caption === 'since New York midnight · after fees', `hero caption: ${caption}`);
    expect(sentence === breakdown(own, false), `hero sentence: ${sentence}`);
  } else {
    const sentences = !caption ? ['Today’s result is not available.']
      : exactDesks.length ? [breakdown(exactDesks, true)]
      : householdFault ? ['Today’s result is not available.']
        : ['No desk has an exact result for today.'];
    expect(sentences.includes(sentence), `hero sentence: ${sentence}`);
    // JOED-157: a reason-less household with a faulty desk takes on that fault, so the caption names the desk.
    expect(!caption === (household === 'nullNoReason' && own.every(d => d.fine)), `hero caption: ${caption}`);
    const named = namedIn(caption);
    for (const [name, word] of named) expect(word !== 'exact' && own.find(d => d.name === name)?.word === word, `hero caption on ${name}: ${caption}`);
    if (named.length) expect(sameNames(named, own.filter(d => d.word !== 'exact')), `hero caption names: ${caption}`);
    if (fine) {
      expect(/^Not exact/.test(caption) && !FAULT_WORDS.test(caption), `hero caption: ${caption}`);
      expect(named.length === (notExactDesks.length < 3 ? notExactDesks.length : 0), `hero caption names: ${caption}`);
      expect(figure.getAttribute('aria-label') === 'Today: not exact', `hero dash: ${figure.getAttribute('aria-label')}`);
    } else expect(FAULT_WORDS.test(caption) || FAULT_WORDS.test(sentence), `hero hides the fault: ${caption} / ${sentence}`);
  }
  // Each card's Today cell and line, and each phone row.
  for (const d of own) {
    const card = readOnce(readCards, deskCard(view, d.id), cardToday);
    expect(card.figure === (d.value ? FIGURE[d.id] : '—'), `${d.name}'s card: ${card.figure}`);
    if (!d.value) expect(dashNamed(card.name, d), `${d.name}'s card dash: ${card.name}`);
    expect(JSON.stringify(card.lines) === JSON.stringify(d.card ? [d.card] : []), `${d.name}'s card lines: ${card.lines.join(' / ')}`);
    const phone = readOnce(readRows, compactDesk(view, d.id), phoneToday);
    expect(phone.figure === (d.value ? FIGURE[d.id] : '—'), `${d.name}'s phone row: ${phone.figure}`);
    if (!d.value) expect(dashNamed(phone.name, d), `${d.name}'s phone dash: ${phone.name}`);
    expect(d.phone instanceof RegExp ? d.phone.test(phone.line ?? '') : phone.line === d.phone, `${d.name}'s phone line: ${phone.line}`);
  }
  return wrong;
}
test('JOED-148: every desk and household Today combination matches the plain-words oracle on every surface (4000 cases)', () => {
  let count = 0, green = 0;
  for (const j of Object.keys(DESK_TODAY)) for (const joe of Object.keys(DESK_TODAY)) for (const joel of Object.keys(DESK_TODAY)) {
    for (const household of Object.keys(HOUSEHOLD_TODAY)) {
      const desks = [j, joe, joel], view = dayCombination(desks, household);
      const label = `household ${HOUSEHOLD_TODAY[household].says}; ${desks.map((option, i) => `${NAMES[DESKS[i]]} ${DESK_TODAY[option].says}`).join('; ')}`;
      assert.deepEqual(daySurfaces(view, desks, household), [], label);
      assert.equal(view.states['today.dayPnl'].value != null, household === 'current' && desks.every(option => option === 'exact'), `${label}: household shown`);
      // JOED-157: a faulty desk leads the household caption with its own state word,
      // even after a not-exact desk or beside an already not-exact household dash.
      if (desks.some(option => !DESK_TODAY[option].fine)) {
        assert.equal(view.states['today.dayPnl'].reason, 'source_unavailable', `${label}: fault wins household reason`);
        const caption = heroToday(heroLeft(view)).querySelector('[data-cell="hero.day"] .primary-caption').textContent;
        assert.match(caption.split('; ')[0], /^(Unavailable|Last good|Not reported) for /, `${label}: household caption leads with faults`);
      }
      count++;
      if (HOUSEHOLD_TODAY[household].fine && desks.every(option => DESK_TODAY[option].fine)) green++;
    }
  }
  assert.equal(count, 10 ** 3 * 4);
  assert.equal(green, 3 ** 3 * 2, 'green only for fine desks beside a current or not-exact household');
});

// The re-gate's Medium: the household Today withheld as not exact while every
// desk's own Today is exact. The one "Today’s result" row still says why.
function householdNotExact(reason) {
  const data = structuredClone(exact);
  data.totals.dayPnl = null; (data.totals.reasons ??= {}).dayPnl = reason;
  Object.assign(data.pnlSources.day, { status: 'unavailable', method: null, observedAt: null, reason });
  assert.equal(validateContract('data', data).ok, true);
  return data;
}
test('JOED-148 re-gate Medium: a household Today withheld as not exact beside three exact desks is explained in its one Details row', () => {
  for (const reason of NOT_EXACT_REASONS) {
    const view = ctx(householdNotExact(reason));
    assert.deepEqual(localBoardHealth(view.states, view.feeds, view.now), { tone: 'green', reason: 'board_ok' }, reason);
    assert.equal(detailsRow(view, 'Today’s result'), `Household not exact${reason === 'not_exact_yet' ? '' : ` · ${cellReason(reason)}`}; each desk exact`, reason);
    const text = pop(view).textContent;
    assert.equal(text.match(/not exact/gi)?.length, 1, `${reason}: Details says it once: ${text}`);
  }
  assert.equal(detailsRow(ctx(householdNotExact('sod_missing')), 'Today’s result'), 'Household not exact · start-of-day value missing; each desk exact');
  // A desk's own not-exact Today keeps the per-desk row (no household prefix).
  assert.equal(detailsRow(ctx(dayNotExact({ j: 'not_exact_yet' })), 'Today’s result'), 'Exact for Joe and Joel; not exact for J');
});

// Found by the every-surface oracle: a household Today missing without any
// reason has no caption, so the hero's sentence keeps its one statement
// instead of giving the exact desks' results beside a bare dash.
test('JOED-148: a hero dash without a caption keeps its statement in the sentence', () => {
  const data = structuredClone(exact);
  data.totals.dayPnl = null;
  Object.assign(data.pnlSources.day, { status: 'unavailable', method: null, observedAt: null });
  assert.equal(validateContract('data', data).ok, true);
  const hero = htmlDocument(heroLeft(ctx(data)));
  assert.deepEqual([hero.querySelector('[data-cell="hero.day"] .bn').textContent, hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent], ['—', '']);
  assert.equal(hero.querySelector('.say').textContent, 'Today’s result is not available.');
  // With a caption, the sentence gives what is known instead: each desk's own
  // Today and the open result (JOED-153's breakdown).
  const captioned = ctx(householdNotExact('not_exact_yet'));
  assert.equal(htmlDocument(heroLeft(captioned)).querySelector('.say').textContent,
    `J ${eur(decimalUnits('50'), true)} · Joe ${eur(decimalUnits('-5'), true)} · Joel ${eur(decimalUnits('5'), true)} · open result ${eur(exactCell(captioned.states['today.openPnl']), true)}`);
});
