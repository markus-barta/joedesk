// Small, independently runnable JOED-70 presentation tests. The helper maps
// the browser's contract/time URLs to their authoritative repository files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { copyText } from '../scripts/browser/shots.mjs';
const { statusSentence, statusPresentation, boardHealthPresentation, REASON_COPY } = await import('../public/joe/health.js');
const { headerHealth, healthPop } = await import('../public/joe/desk.js');
const { fitStatusLine } = await import('../public/joe/ui.js');
const { joinUnits } = await import('../public/joe/format.js');
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
test('compact green copy remains recognizable after the browser joins its separator', () => {
  const view = statusPresentation(context());
  const rendered = joinUnits(view.compact, { joinDot: true });
  assert.equal(rendered, 'Live · 9 s');
  assert.match(copyText(rendered), /^Live ·/);
  assert.equal(copyText(rendered), view.compact);
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
  assert.ok(details.indexOf('class="status-sentence"') < details.indexOf('class="health-facts"'), 'the complete sentence comes first in Details');
  for (const term of ['broker', 'halt', 'datafrom', 'heartbeat']) assert.ok(details.includes(`data-term="${term}"`));
  for (const words of ['Numbers up to date', 'Emergency stop', 'Data from', 'refreshes every 15']) assert.ok(details.includes(words), words);
});
test('Details retains executor diagnostics after the status summary without changing board health', () => {
  const capture = 'Paper executor degraded: results capture failing, trading continues';
  const cases = [
    ['degraded-no-reason', { status: 'degraded' }, 'No current problems.', 'ok'],
    ['capture-degraded', { status: 'degraded', reason: 'results_capture_failed', ledgerBytes: 3250000, ledgerCapBytes: 8000000 }, `${capture} (ledger 3,2 MB of 8,0 MB).`, 'ok'],
    ['ledger-full', { status: 'degraded', reason: 'ledger_size_limit', ledgerBytes: 9000000, ledgerCapBytes: 8000000 }, 'Trade record is full: new orders refused (ledger 9,0 MB of 8,0 MB).', 'bad'],
    ['capture-bytes-only', { status: 'degraded', reason: 'results_capture_failed', ledgerBytes: 3350000 }, `${capture} (ledger 3,4 MB).`, 'ok'],
    ['capture-no-ledger', { status: 'degraded', reason: 'results_capture_failed' }, `${capture}.`, 'ok'],
    ['healthy', { status: 'running' }, 'No current problems.', 'ok'],
  ];
  for (const [name, executor, problem, tone] of cases) {
    const ctx = context();
    ctx.feeds.data.value.safety.executor = executor;
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
    const details = htmlDocument(healthPop(ctx, health));
    assert.equal(details.querySelector('p').getAttribute('class'), 'status-sentence', name);
    assert.equal(details.querySelector('.status-sentence').textContent, statusPresentation(ctx, health).sentence, name);
    assert.equal(details.querySelector('p:not(.status-sentence)').textContent, problem, name);
    assert.equal(health.statusTone, tone, name);
  }
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
    assert.notEqual(view.compact, view.sentence, 'the short control must not repeat the sentence on the reserved line');
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

test('term tips capture native focus, survive an unrelated Details close, and suppress only synchronous handoff focus', async t => {
  const { initTips, rebuilt } = await builders('ui.js', ['rebuilt']);
  const listeners = new Map(), captures = new Map();
  const emit = (type, target, extra = {}) => {
    for (const fn of listeners.get(type) ?? []) fn({ target, pointerType: 'mouse', preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  };
  const classes = new Set();
  const body = { append(el) { el.parentElement = body; } };
  const tip = { style: {}, parentElement: body, offsetWidth: 200, offsetHeight: 80,
    classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); },
      toggle(name, yes) { if (yes) classes.add(name); else classes.delete(name); } } };
  const doc = { body, activeElement: null, querySelector: () => tip, addEventListener(type, fn, capture) {
    listeners.set(type, [...listeners.get(type) ?? [], fn]); captures.set(type, capture);
  } };
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
    focus() { if (doc.activeElement !== this) { doc.activeElement = this; emit('focus', this); } },
  });
  const tips = initTips(), inside = anchor('broker'), outside = anchor('today');
  assert.equal(captures.get('focus'), true, 'delegated native focus must be captured because it does not bubble');
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
  for (const [term, heading] of Object.entries({ broker: 'Broker connection', halt: 'Emergency stop', datafrom: 'Data from', heartbeat: 'Checked in' })) {
    const button = anchor(term);
    button.focus();
    assert.ok(classes.has('on'), `${term} opens on native focus without waiting for focusin`);
    assert.equal(button.attributes['aria-expanded'], 'true');
    assert.equal(button.attributes['aria-describedby'], 'tip');
    assert.ok(tip.innerHTML.startsWith(`<b>${heading}</b>`), `${term} shows its own explanation`);
    emit('focusout', button);
    assert.ok(!classes.has('on'));
  }
  // Exercise the real tip render and its accessible description, not only
  // the time calculation. Rendering must never mutate the frozen dictionary.
  const { TERMS } = await import('../public/joe/terms.js');
  const original = [...TERMS.today];
  assert.ok(Object.isFrozen(TERMS));
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  for (const [now, expected] of [
    ['2026-10-24T12:00:00Z', '06:00'],
    ['2026-10-28T12:00:00Z', '05:00'],
    ['2027-03-20T12:00:00Z', '05:00'],
    ['2026-11-01T20:00:00Z', '05:00'], // NY changes after this day's midnight
    ['2026-11-02T12:00:00Z', '06:00'],
    ['2026-03-08T20:00:00Z', '06:00'], // likewise, before NY's spring jump
    ['2026-03-09T12:00:00Z', '05:00'],
  ]) {
    t.mock.timers.setTime(Date.parse(now));
    const button = anchor('today');
    button.focus();
    assert.ok(classes.has('on'));
    assert.equal(button.attributes['aria-describedby'], 'tip');
    assert.match(tip.innerHTML, new RegExp(`midnight in New York, ${expected} in Vienna`), now);
    assert.doesNotMatch(tip.innerHTML, /\{nyMidnightVienna\}/);
    emit('focusout', button);
  }
  assert.deepEqual(TERMS.today, original);
});

test('a compact non-green control puts the sentence on the reserved line; fitting warnings keep it in the control', () => {
  const element = () => ({ attributes: new Map(),
    toggleAttribute(key, value) { if (value) this.attributes.set(key, ''); else this.attributes.delete(key); },
    setAttribute(key, value) { this.attributes.set(key, value); } });
  const line = element(), control = Object.assign(element(), { dataset: {}, querySelector: () => full });
  const full = { clientWidth: 240, scrollWidth: 240 };
  for (const tone of ['ok', 'warn', 'bad']) for (const narrow of [false, true]) for (const overflow of [false, true]) {
    control.dataset.tone = tone;
    full.scrollWidth = overflow ? 241 : 240;
    fitStatusLine(control, line, narrow);
    const compact = tone === 'bad' || narrow || overflow;
    const visible = tone === 'bad' || (tone === 'warn' && compact);
    assert.equal(control.attributes.has('data-compact'), compact, `${tone}, narrow=${narrow}, overflow=${overflow}`);
    assert.equal(line.attributes.has('data-visible'), visible);
    assert.equal(line.attributes.get('aria-hidden'), String(!visible));
  }
});
