// Small, independently runnable JOED-70 presentation tests. The helper maps
// the browser's contract/time URLs to their authoritative repository files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders } from './fixtures/preview-dom.mjs';
const { statusSentence, statusPresentation, boardHealthPresentation, REASON_COPY } = await import('../public/joe/health.js');
const { headerHealth, healthPop } = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { acceptSnapshot } = await import('../contracts/accept.mjs');
const { panelStates } = await import('../contracts/panel-state.mjs');
const at = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString();
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
function context(seconds = 9) {
  const payload = structuredClone(valid.data);
  delete payload.receivedAt;
  const feeds = { data: acceptSnapshot('data', payload, null, valid.data.receivedAt) };
  const now = at(valid.data.receivedAt, seconds);
  return { feeds, states: panelStates(feeds, now), now };
}
const cases = [
  ['green', 'board_ok', 'Live · updated 9 s ago'],
  ['yellow', 'values_not_exact', 'Desk values are not exact yet'],
  ['yellow', 'snapshot_stale', 'Updates are late'],
  ['yellow', 'retained_values', 'Numbers a bit old'],
  ['yellow', 'gateway_degraded', 'The broker connection is unstable'],
  ['yellow', 'gateway_unconfirmed', 'Broker unsure: last check 1 min ago'],
  ['yellow', 'open_unavailable_rth', 'Waiting on broker prices'],
  ['yellow', 'day_pending', 'Today’s result is waiting on data'],
  ['red', 'halt_on', 'Emergency stop is ON'],
  ['red', 'gateway_down', 'The broker is offline'],
  ['red', 'feed_disconnected', 'Board updates stopped'],
  ['red', 'equity_unavailable', 'Board numbers are missing'],
  ['red', 'producer_stuck', 'Board updates are stuck'],
  ['red', 'day_unavailable_rth', 'Today’s result is waiting on data'],
  ['yellow', 'refresh_failed', 'Update failed'],
  ['red', 'no_snapshot', 'No board data'],
  ['red', 'ledger_size_limit', 'Trade record is full'],
];
for (const [tone, reason, sentence] of cases) test(`${tone}: ${reason} sentence`, () => {
  assert.equal(statusSentence({ tone, reason }, { receipt: 9, gatewayAge: 66 }), sentence);
});
test('sentence table covers every existing health reason, without changing the reasons', () => {
  assert.deepEqual(cases.map(c => c[1]).sort(), Object.keys(REASON_COPY).sort());
  assert.equal(statusSentence({ tone: 'yellow', reason: 'gateway_unconfirmed' }), 'Broker unsure: no check reported');
});
test('receipt age ticks and resets, while the announcement key stays stable', () => {
  const ctx = context();
  const first = statusPresentation(ctx);
  const second = statusPresentation({ ...ctx, now: at(ctx.now, 1) });
  assert.equal(first.sentence, 'Live · updated 9 s ago');
  assert.equal(second.sentence, 'Live · updated 10 s ago');
  assert.equal(first.compact, 'Live · 9 s');
  assert.equal(first.announcementKey, second.announcementKey);
  assert.equal(first.announcement, second.announcement);
  const late = statusPresentation({ ...ctx, now: at(ctx.now, 66), states: ctx.states });
  assert.equal(late.reason, 'snapshot_stale');
  assert.notEqual(late.announcementKey, first.announcementKey);
});
test('emergency stop keeps precedence over ledger, broker and stopped updates', () => {
  const ctx = context(200);
  ctx.states.halt.value = true;
  ctx.feeds.data.value.safety.executor.reason = 'ledger_size_limit';
  Object.assign(ctx.feeds.data.value.safety.gateway, { apiSessionReady: false, reason: 'gateway_down' });
  const status = statusPresentation(ctx);
  assert.equal(status.reason, 'halt_on');
  assert.equal(status.sentence, 'Emergency stop is ON');
  assert.equal(status.alert, 'Emergency stop is ON · The operator must check');
  assert.equal(status.statusTone, 'bad');
});
test('header gives the complete sentence and opens Details, with no second broker label', () => {
  const ctx = context();
  const view = headerHealth(ctx, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now));
  assert.match(view.html, /#i-check/);
  assert.doesNotMatch(view.html, /Board OK|Broker OK|lbl-long/);
  assert.equal(view.label, 'Live · updated 9 s ago. Open status details.');
  assert.equal(view.title, view.sentence);
  const details = healthPop(ctx, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now));
  for (const term of ['broker', 'halt', 'datafrom', 'heartbeat']) assert.ok(details.includes(`data-term="${term}"`));
  for (const words of ['Numbers up to date', 'Emergency stop', 'Data from', 'refreshes every 15']) assert.ok(details.includes(words), words);
});
test('desk check-ins disappear while fresh and return at the existing 60-second bound', () => {
  const ctx = context(0), data = ctx.feeds.data.value;
  data.desks[0].heartbeatAt = data.generatedAt;
  for (const seconds of [0, 59, 60, 61]) {
    const current = { ...ctx, now: at(ctx.now, seconds) };
    const html = deskCard(current, 'j', 100, false);
    assert.equal(html.includes('data-term="heartbeat"'), seconds >= 60, String(seconds));
    if (seconds >= 60) assert.match(html, /class="hb warn"/);
  }
});

test('broker sentence never presents receipt age as a real check', () => {
  for (const checkedAt of [null, undefined, 'invalid']) {
    const ctx = context();
    ctx.feeds.data.value.safety.gateway.checkedAt = checkedAt;
    ctx.states.gateway.ageSeconds = 9;
    const view = statusPresentation(ctx, { tone: 'yellow', reason: 'gateway_unconfirmed', statusTone: 'warn' });
    assert.equal(view.sentence, 'Broker unsure: no check reported');
  }
});
