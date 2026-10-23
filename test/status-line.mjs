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
  assert.equal(view.label, 'Live. Numbers are up to date. Open status details.');
  assert.equal(headerHealth({ ...ctx, now: at(ctx.now, 1) }, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now)).label, view.label);
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

test('red controls use a short label; the complete sentence stays in the alert, Details and accessible name', () => {
  const ctx = context();
  for (const [tone, reason] of cases.filter(c => c[0] === 'red')) {
    const health = { tone, reason, statusTone: 'bad', explanation: REASON_COPY[reason] };
    const view = headerHealth(ctx, health);
    assert.equal(view.control, reason === 'halt_on' ? 'Emergency stop' : 'Problem');
    assert.equal(view.compact, view.control);
    assert.ok(view.label.includes(view.sentence));
    assert.ok(view.alert.startsWith(view.sentence));
    assert.ok(healthPop(ctx, health).includes(view.sentence));
    assert.match(view.html, new RegExp(`class="status-full">${view.sentence}<`));
    assert.match(view.html, new RegExp(`class="status-compact">${view.control}<`));
  }
});

test('yellow controls offer short narrow-screen copy and retain the complete sentence', () => {
  const ctx = context();
  for (const [tone, reason] of cases.filter(c => c[0] === 'yellow')) {
    const health = { tone, reason, statusTone: 'warn', explanation: REASON_COPY[reason] };
    const view = headerHealth(ctx, health);
    assert.ok(view.compact.length <= 17, `${reason}: ${view.compact}`);
    assert.equal(view.control, view.sentence);
    assert.ok(view.label.includes(view.sentence));
    assert.ok(healthPop(ctx, health).includes(view.sentence));
  }
});

test('missing or invalid check-ins fall back to snapshot age only once it is stale', () => {
  for (const heartbeatAt of [undefined, null, 'invalid']) {
    const ctx = context(0);
    ctx.feeds.data.value.desks[0].heartbeatAt = heartbeatAt;
    for (const seconds of [0, 59, 60, 61]) {
      const html = deskCard({ ...ctx, now: at(ctx.now, seconds) }, 'j', 100, false);
      assert.equal(html.includes('Data <span class="age" data-age="hb.j"'), seconds >= 60);
      assert.ok(!html.includes('data-term="heartbeat"'));
    }
  }
  assert.ok(!deskCard({ feeds: {}, states: {}, now: valid.data.receivedAt }, 'j', 100, false).includes('data-age="hb.j"'));
});

test('term tips survive an unrelated Details close, and focus suppression cannot escape its synchronous handoff', async t => {
  const { initTips, rebuilt } = await builders('ui.js', ['rebuilt']);
  const listeners = new Map();
  const emit = (type, target, extra = {}) => {
    for (const fn of listeners.get(type) ?? []) fn({ target, pointerType: 'mouse', preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  };
  const classes = new Set();
  const body = { append(el) { el.parentElement = body; } };
  const tip = { style: {}, parentElement: body, offsetWidth: 200, offsetHeight: 80,
    classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); },
      toggle(name, yes) { if (yes) classes.add(name); else classes.delete(name); } } };
  const doc = { body, activeElement: null, querySelector: () => tip, addEventListener(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]); } };
  const globals = { document: doc, innerWidth: 1000, innerHeight: 800, addEventListener: (type, fn) => doc.addEventListener(type, fn) };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const anchor = term => ({ dataset: { term }, attributes: {},
    closest(selector) { return selector.includes('[data-term]') ? this : null; },
    getBoundingClientRect: () => ({ left: 50, right: 100, top: 80, bottom: 100 }),
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
    focus() { if (doc.activeElement !== this) { doc.activeElement = this; emit('focusin', this); } },
  });
  const tips = initTips(), inside = anchor('broker'), outside = anchor('today');
  const pop = { contains: el => el === inside };
  inside.focus();
  assert.ok(classes.has('on'));
  assert.match(tip.innerHTML, /Broker connection/);
  emit('click', outside); // capture-phase tip opens before the Details bubble handler
  tips.hide(pop);
  assert.ok(classes.has('on'));
  assert.equal(outside.attributes['aria-expanded'], 'true');
  assert.match(tip.innerHTML, /Today/);
  tips.hide();
  emit('pointermove', outside);
  assert.ok(classes.has('on'), 'pointer movement restores a tip dismissed by scroll');
  tips.hide();
  rebuilt.tip.focus(inside);
  rebuilt.tip.focus(inside); // no focus event: must not suppress the next user's focus
  outside.focus();
  assert.ok(classes.has('on'));
  assert.equal(outside.attributes['aria-expanded'], 'true');
  inside.focus();
  tips.hide(pop);
  assert.ok(!classes.has('on'));
  assert.equal(inside.attributes['aria-expanded'], 'false');
});
