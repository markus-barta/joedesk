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
  ['yellow', 'values_not_exact', 'Desk values are not exact'],
  ['yellow', 'snapshot_stale', 'Updates are late'],
  ['yellow', 'retained_values', 'Numbers a bit old'],
  ['yellow', 'gateway_degraded', 'The broker connection is unstable'],
  ['yellow', 'gateway_unconfirmed', 'Broker unsure: last check 1 min ago'],
  ['yellow', 'open_unavailable_rth', 'Waiting on broker prices'],
  ['yellow', 'day_pending', 'Today’s result is late'],
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
  const { initTips, rebuilt, interactionWithin } = await builders('ui.js', ['rebuilt']);
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
  const globals = { document: doc, innerWidth: 1000, innerHeight: 800, requestAnimationFrame() {},
    addEventListener: (type, fn) => doc.addEventListener(type, fn) };
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
  const grid = { contains: el => el === outside };
  assert.equal(interactionWithin(grid), false, 'unrelated focus and tip do not hold desk order');
  emit('click', outside); // capture-phase tip opens before the Details bubble handler
  assert.equal(interactionWithin(grid), true, 'a pinned grid tip holds order even with focus elsewhere');
  tips.hide(pop);
  assert.ok(classes.has('on'));
  assert.equal(outside.attributes['aria-expanded'], 'true');
  assert.match(tip.innerHTML, /Today/);
  tips.hide();
  assert.equal(interactionWithin(grid), false, 'dismissing the tip releases the deferred order');
  emit('pointermove', outside);
  assert.ok(classes.has('on'), 'pointer movement restores a tip dismissed by scroll');
  assert.equal(interactionWithin(grid), true, 'an unpinned hover tip also holds order');
  tips.hide();
  rebuilt.tip.focus(inside);
  rebuilt.tip.focus(inside); // no focus event: must not suppress the next user's focus
  outside.focus();
  tips.hide();
  assert.equal(interactionWithin(grid), true, 'focused grid controls hold order even with the tip dismissed');
  emit('focus', outside);
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
  emit('click', outside);
  emit('keydown', outside, { key: 'Escape' });
  rebuilt.tip.focus(outside);
  assert.ok(!classes.has('on'), 'a quiet rebuild handoff must preserve Escape dismissal');
  outside.focus();
  assert.ok(classes.has('on'), 'an explicit refocus after the handoff reopens the explanation');
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

test('JOED-130 Today explanation follows the board clock across DST and midnight with a wrong browser date', async t => {
  let now = null;
  const { emit, anchor, tip } = await termTipFixture(t, { now: () => now });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  for (const [serverNow, expected] of [
    [null, '06:00'],
    ['2026-10-28T12:00:00.000Z', '05:00'],
    ['2026-11-02T04:59:59.000Z', '05:00'],
    ['2026-11-02T05:00:00.000Z', '06:00'],
    ['2026-03-09T12:00:00.000Z', '05:00'],
  ]) {
    now = serverNow;
    const button = anchor('today');
    emit('click', button);
    assert.match(tip.innerHTML, new RegExp(`midnight in New York, ${expected} in Vienna`), String(serverNow));
    assert.equal(button.attrs['aria-describedby'], 'tip');
    emit('keydown', button, { key: 'Escape' });
  }
  t.mock.timers.setTime(NaN);
  assert.ok(Number.isNaN(new Date().getTime()), 'invalid browser clock');
  now = '2026-10-28T12:00:00.000Z';
  emit('click', anchor('today'));
  assert.match(tip.innerHTML, /midnight in New York, 05:00 in Vienna/);
});

test('JOED-148 A4: Since start’s explanation states the configured basis and day, never a placeholder or the retired J sentence', async t => {
  let since = null;
  const { emit, anchor, tip } = await termTipFixture(t, { since: () => since });
  const { TERMS } = await import('../public/joe/terms.js');
  const { STARTING_MONEY, SINCE_START } = await import('../public/joe/performance.js');
  const { eur } = await import('../public/joe/format.js');
  const original = [...TERMS.since];
  const show = () => {
    const button = anchor('since');
    emit('click', button);
    const html = tip.innerHTML;
    emit('keydown', button, { key: 'Escape' });
    return html;
  };
  // Before any feed answers, the board's own basis applies.
  let html = show();
  assert.ok(html.startsWith('<b>Since start</b>'));
  assert.match(html, /since paper results were verified on Thu 10\sSep 2026 \(New York trading day\), after fees/);
  assert.ok(html.includes(`against the ${eur(STARTING_MONEY, false, 0)} they started with (${eur(STARTING_MONEY / 3n, false, 0)} each)`));
  assert.ok(html.includes(`The percentage divides by that ${eur(STARTING_MONEY, false, 0)}.`));
  assert.doesNotMatch(html, /[{}]|J’s bookkeeping starts on its own date|Same start as Results/);
  since = { common: SINCE_START, trackingStart: SINCE_START, conflict: false };
  assert.match(show(), /open positions at the last price\. Same start as Results · All time\./);
  // Results starting on another day: no date is claimed.
  since = { common: null, trackingStart: '2026-09-12', conflict: true };
  html = show();
  assert.match(html, /since paper results were verified, after fees/);
  assert.doesNotMatch(html, /10\sSep|Same start/);
  assert.deepEqual(TERMS.since, original, 'rendering never changes the frozen dictionary');
});

async function termTipFixture(t, options) {
  const { initTips } = await import('../public/joe/ui.js');
  const listeners = new Map(), classes = new Set(), frames = [];
  const body = { append(el) { el.parentElement = this; } };
  const tip = { style: {}, parentElement: body, offsetWidth: 200, offsetHeight: 80,
    getBoundingClientRect() { const left = parseFloat(this.style.left), top = parseFloat(this.style.top);
      return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight }; },
    contains(el) { return el === this || el?.parentElement === this; },
    closest(selector) { return selector === '#tip' ? this : null; },
    classList: { add(...xs) { xs.forEach(x => classes.add(x)); }, remove(...xs) { xs.forEach(x => classes.delete(x)); },
      toggle(x, yes) { yes ? classes.add(x) : classes.delete(x); } } };
  const doc = { body, activeElement: null, querySelector: () => tip, getElementById: () => null,
    addEventListener(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]); } };
  const descriptors = new Map();
  for (const [key, value] of Object.entries({ document: doc, innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame: fn => frames.push(fn),
    addEventListener: (type, fn) => doc.addEventListener(type, fn) })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const emit = (type, target, extra = {}) => {
    let stopped = false;
    const event = { type, target, pointerType: 'mouse', defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { stopped = true; }, ...extra };
    for (const fn of listeners.get(type) ?? []) { fn(event); if (stopped) break; }
    return event;
  };
  // Resolve the real stylesheet's tip hit-testing policy for an overlapping
  // box; Node has no layout engine. Pointer coordinates are supplied by tests.
  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  const hit = underneath => {
    let events = 'auto';
    for (const [, suffix, declarations] of css.matchAll(/\.tip(\.[\w-]+)?\s*\{([^}]+)\}/g)) {
      if (suffix && !classes.has(suffix.slice(1))) continue;
      const value = declarations.match(/pointer-events:\s*(\w+)\s*;/)?.[1];
      if (value) events = value;
    }
    return classes.has('on') && events !== 'none' ? tip : underneath;
  };
  const anchor = term => ({ dataset: { term }, attrs: {},
    closest(selector) { return selector.includes('[data-term]') ? this : null; },
    contains(el) { return el === this || el?.parentElement === this; },
    getBoundingClientRect: () => ({ left: 50, right: 100, top: 80, bottom: 100 }),
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    focus() {
      if (doc.activeElement === this) return;
      const previous = doc.activeElement;
      doc.activeElement = this;
      if (previous) emit('focusout', previous, { relatedTarget: this });
      emit('focus', this);
    } });
  const api = initTips(options);
  t.after(() => {
    api.hide();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { emit, anchor, tip, classes, doc, api, hit, frame: () => frames.splice(0).forEach(fn => fn()) };
}

for (const width of [1024, 1440, 390]) test(`AC-39 at ${width}: focus survives its native scroll with the pointer at the hero click`, async t => {
  const { emit, anchor, tip, classes, doc, frame } = await termTipFixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.innerWidth = width;
  globalThis.innerHeight = width === 1024 ? 768 : width === 1440 ? 1000 : 844;
  const hero = anchor('today'), desk = anchor('today');
  const pointer = { clientX: 75, clientY: 90 };
  // The fresh design fixture omits heartbeat terms: both selectors find Today,
  // but they are distinct controls. The 1024 hero has two supporting KPI rows;
  // unlike __audit.visible, native focus must bring an offscreen desk into view.
  let deskTop = width === 1024 ? 820 : 600;
  desk.getBoundingClientRect = () => ({ left: 50, right: 100, top: deskTop, bottom: deskTop + 20 });
  emit('pointerover', hero, pointer);
  emit('pointerdown', hero, pointer);
  hero.focus();
  emit('click', hero, pointer);
  frame();
  emit('keydown', hero, { key: 'Escape' });
  frame();
  assert.ok(!classes.has('on'));
  assert.equal(doc.activeElement, hero);

  desk.focus(); // focus event runs before the native focus algorithm scrolls
  assert.equal(doc.activeElement, desk);
  assert.equal(desk.attrs['aria-expanded'], 'true', 'the new control is expanded synchronously');
  if (width === 1024) {
    deskTop = 374; // input geometry, not a browser pixel measurement
    emit('scroll', doc);
    assert.ok(classes.has('on'), 'the focus scroll itself must preserve the newly opened tip');
    const background = { closest: () => null };
    emit('pointerout', hero, { ...pointer, relatedTarget: background });
    emit('pointerover', background, { ...pointer, relatedTarget: hero });
  }
  frame(); // settle() paints twice and then waits 30 ms
  frame();
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'focus-induced scrolling must not dismiss its explanation');
  assert.ok(!classes.has('pinned'));
  assert.equal(desk.attrs['aria-expanded'], 'true');
  assert.equal(desk.attrs['aria-describedby'], 'tip');
  assert.equal(hero.attrs['aria-expanded'], 'false');
  assert.equal(hero.attrs['aria-describedby'], undefined);
  assert.ok(tip.innerHTML.startsWith('<b>Today</b>'));
  const box = tip.getBoundingClientRect();
  assert.equal(box.top, deskTop + 28, 'tip is placed against the anchor after native scrolling');
  assert.ok(box.bottom <= innerHeight - 10 && box.top >= 10, 'tip follows the final visible anchor');
  deskTop -= 20;
  emit('scroll', doc);
  assert.ok(!classes.has('on'), 'a later scroll still dismisses a moved anchor');
});

test('the initial focus frame yields to pointer movement, outside press and Escape', async t => {
  const { emit, anchor, tip, classes, frame } = await termTipFixture(t);
  const today = anchor('today'), broker = anchor('broker');
  today.focus();
  emit('pointermove', broker, { clientX: 75, clientY: 90 });
  frame();
  assert.ok(tip.innerHTML.startsWith('<b>Broker connection</b>'), 'a real move still switches terms immediately');
  assert.equal(broker.attrs['aria-describedby'], 'tip');
  assert.equal(today.attrs['aria-describedby'], undefined);
  broker.focus();
  today.focus();
  emit('keydown', today, { key: 'Escape' });
  frame();
  assert.ok(!classes.has('on'), 'a queued focus placement never reopens an Escape-dismissed tip');
  today.focus();
  emit('pointerdown', { closest: () => null });
  frame();
  assert.ok(!classes.has('on'), 'an outside press cancels the focus handoff before the control action');
});

for (const same of [true, false]) test(`after pin and Escape, focusing ${same ? 'the same' : 'another'} term shows its explanation`, async t => {
  const { emit, anchor, tip, classes, doc } = await termTipFixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = anchor('today'), next = same ? first : anchor('broker');
  const originalFocus = first.focus;
  first.focus(); // native pointer focus precedes the click
  emit('click', first);
  assert.ok(classes.has('on') && classes.has('pinned'));
  emit('keydown', first, { key: 'Escape' });
  assert.equal(doc.activeElement, first, 'Escape keeps focus on the term');
  assert.ok(!classes.has('on'));
  assert.equal(first.attrs['aria-expanded'], 'false');
  assert.equal(first.attrs['aria-describedby'], undefined);
  t.mock.timers.tick(1000);
  assert.ok(!classes.has('on'), 'Escape stays closed until a new interaction');
  next.focus(); // the browser emits no focus event for the already-focused term
  assert.equal(doc.activeElement, next);
  assert.ok(classes.has('on'));
  assert.ok(!classes.has('pinned'), 'refocusing opens an unpinned explanation');
  assert.equal(next.attrs['aria-expanded'], 'true');
  assert.equal(next.attrs['aria-describedby'], 'tip');
  assert.ok(tip.innerHTML.startsWith(`<b>${same ? 'Today' : 'Broker connection'}</b>`));
  assert.equal(first.focus, originalFocus, 'reopening or leaving restores the original focus method');
  if (!same) {
    assert.equal(first.attrs['aria-expanded'], 'false');
    assert.equal(first.attrs['aria-describedby'], undefined);
  }
});

test('hovering the next term under an unpinned tip immediately shows its own heading', async t => {
  const { emit, anchor, tip, classes, hit } = await termTipFixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const broker = anchor('broker'), halt = anchor('halt'), datafrom = anchor('datafrom');
  halt.getBoundingClientRect = () => ({ left: 50, right: 100, top: 120, bottom: 140 });
  datafrom.getBoundingClientRect = () => ({ left: 50, right: 100, top: 160, bottom: 180 });
  emit('pointerover', broker);
  for (const [previous, next, heading] of [[broker, halt, 'Emergency stop'], [halt, datafrom, 'Data from']]) {
    const { top, bottom } = next.getBoundingClientRect(), clientY = (top + bottom) / 2;
    const box = tip.getBoundingClientRect();
    assert.ok(clientY > box.top && clientY < box.bottom, 'the next trigger really overlaps the preceding tip box');
    const target = hit(next); // next term lies beneath the preceding tip
    emit('pointerout', previous, { relatedTarget: target, clientX: 70, clientY });
    emit('pointerover', target, { clientX: 70, clientY });
    emit('pointermove', target, { clientX: 70, clientY });
    assert.ok(tip.innerHTML.startsWith(`<b>${heading}</b>`), 'handover must not wait for a dismissal timer');
    assert.equal(previous.attrs['aria-describedby'], undefined);
    assert.equal(next.attrs['aria-describedby'], 'tip');
    t.mock.timers.tick(1000);
    assert.ok(classes.has('on'), 'the preceding term timer must not close the new tip');
  }
  emit('pointermove', { closest: () => null }, { clientX: 2, clientY: 2 });
  assert.ok(!classes.has('on'), 'moving away from the tip and gap dismisses immediately before dialog Escape');
});

test('an unpinned tip lets another control receive its press and action, then closes', async t => {
  const { emit, anchor, tip, classes, doc, hit } = await termTipFixture(t);
  const broker = anchor('broker'), control = { closest: () => null };
  let actions = 0;
  doc.addEventListener('click', event => { if (event.target === control && !event.defaultPrevented) actions++; });
  for (const open of [() => emit('pointerover', broker), () => broker.focus()]) {
    open();
    emit('pointermove', hit(control), { clientX: 70, clientY: 130 });
    assert.ok(classes.has('on'), 'hovering the tip box preserves it despite click-through hit-testing');
    const target = hit(control);
    const press = emit('pointerdown', target, { clientX: 70, clientY: 130 });
    assert.equal(press.defaultPrevented, false);
    assert.ok(!classes.has('on'), 'outside press closes the unpinned tip before the control action');
    emit('click', target);
    assert.equal(broker.attrs['aria-describedby'], undefined);
  }
  assert.equal(actions, 2, 'hover- and focus-opened tips must let the control action run');
  emit('pointerover', broker);
  emit('click', control); // keyboard/programmatic activation has no pointerdown
  assert.ok(!classes.has('on'), 'non-pointer control activation also closes the tip');
  emit('click', broker);
  assert.equal(hit(control), tip, 'a deliberately pinned tip retains its own hit-testing');
});

test('an unpinned tip flipped upward leaves the header Details control clear', async t => {
  const { emit, anchor, tip, doc } = await termTipFixture(t);
  globalThis.innerHeight = 190;
  const header = { left: 40, right: 300, top: 0, bottom: 58 };
  doc.getElementById = id => id === 'hdrHealth' ? { getBoundingClientRect: () => header } : null;
  emit('pointerover', anchor('broker'));
  assert.ok(tip.getBoundingClientRect().top >= header.bottom + 8);
});

test('switching a pinned term clears its old ARIA description through dismissal', async t => {
  const { emit, anchor, tip, classes, api } = await termTipFixture(t);
  const today = anchor('today'), broker = anchor('broker');
  emit('click', today);
  assert.equal(today.attrs['aria-describedby'], 'tip');
  broker.focus();
  assert.equal(today.attrs['aria-expanded'], 'false');
  assert.equal(today.attrs['aria-describedby'], undefined, 'Today must not describe itself with Broker content');
  assert.equal(broker.attrs['aria-describedby'], 'tip');
  assert.ok(tip.innerHTML.startsWith('<b>Broker connection</b>'));
  api.hide();
  assert.ok(!classes.has('on'));
  for (const button of [today, broker]) {
    assert.equal(button.attrs['aria-expanded'], 'false');
    assert.equal(button.attrs['aria-describedby'], undefined);
  }
});

test('hover tips stay open across the gap and over their content, then dismiss outside the region', async t => {
  const { emit, anchor, tip, classes, doc } = await termTipFixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const today = anchor('today'), broker = anchor('broker');
  const text = { parentElement: tip, closest: selector => tip.closest(selector) };
  const outside = { closest: () => null };
  emit('pointerover', today);
  emit('pointerout', today, { relatedTarget: outside, clientX: 70, clientY: 104 });
  emit('pointermove', outside, { clientX: 70, clientY: 104 });
  t.mock.timers.tick(50);
  assert.ok(classes.has('on'), 'crossing the actual gap preserves the tip briefly');
  emit('pointermove', outside, { clientX: 70, clientY: 130 });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'the tip box stays hovered when the event targets content beneath it');
  emit('pointermove', outside, { clientX: 2, clientY: 2 });
  assert.ok(!classes.has('on'), 'moving elsewhere dismisses without a delay');
  emit('pointerover', today);
  assert.ok(classes.has('on'));
  assert.ok(!classes.has('pinned'));
  emit('pointerout', today, { relatedTarget: outside }); // cross the 8px positioning gap
  assert.ok(classes.has('on'), 'the gap must allow time to reach the tip');
  t.mock.timers.tick(50);
  emit('pointerover', text, { relatedTarget: outside });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'entering tip content cancels gap dismissal');
  emit('pointerout', text, { relatedTarget: tip });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'moving within the tip stays in the region');
  emit('pointerout', tip, { relatedTarget: today });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'returning directly to the trigger stays in the region');
  emit('pointerout', today, { relatedTarget: text });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'moving directly onto the tip stays in the region');
  emit('pointerout', text, { relatedTarget: outside });
  t.mock.timers.tick(1000);
  assert.ok(!classes.has('on'), 'leaving the whole region dismisses the unpinned tip');
  assert.equal(today.attrs['aria-describedby'], undefined);

  emit('pointerover', today);
  emit('pointerout', today, { relatedTarget: outside });
  t.mock.timers.tick(50);
  emit('pointerover', today);
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'returning to the same trigger cancels dismissal');
  emit('pointerout', today, { relatedTarget: outside });
  emit('click', today);
  t.mock.timers.tick(1000);
  assert.ok(classes.has('pinned'), 'pinning cancels a pending hover dismissal');
  emit('pointerout', today, { relatedTarget: outside });
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'a pinned tip survives leaving the region');
  emit('click', outside);
  assert.ok(!classes.has('on'), 'outside click still dismisses a pinned tip');

  emit('pointerover', today);
  emit('pointerout', today, { relatedTarget: outside });
  broker.focus();
  t.mock.timers.tick(1000);
  assert.ok(classes.has('on'), 'an old hover timer must not dismiss a newly focused term');
  emit('focusout', broker);
  doc.activeElement = null;
  assert.ok(!classes.has('on'), 'leaving keyboard focus still dismisses the tip');
  emit('pointerover', today);
  emit('keydown', today, { key: 'Escape' });
  assert.ok(!classes.has('on'), 'Escape closes an unpinned tip');
  assert.equal(doc.activeElement, today, 'Escape returns focus without reopening the tip');
  emit('click', today);
  emit('keydown', today, { key: 'Escape' });
  assert.ok(!classes.has('on'), 'Escape also closes a pinned tip');

  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.tip\s*\{[^}]*pointer-events:\s*none\s*;/, 'unpinned tips must let underlying controls receive clicks');
  assert.doesNotMatch(css, /\.tip\.on\s*\{[^}]*pointer-events:\s*auto\s*;/);
  assert.match(css, /\.tip\.pinned\s*\{[^}]*pointer-events:\s*auto\s*;/);
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
