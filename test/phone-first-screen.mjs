// JOED-79: small, browser-free checks of summary truth and disclosure state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import { cashSessionSnapshot, designSnapshot } from '../scripts/browser/settings-fixtures.mjs';
import { preflightSnapshot } from '../scripts/browser/board.mjs';
const { compactDesk, disclosureProblem, rowProblems, syncDeskDisclosures, toggleDeskDisclosure, heroLeft } = await import('../public/joe/desk.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const cell = (state, reason = null, value = null, retained = false) => ({ state, reason, value, retained });
function context() {
  const feeds = { data: { value: structuredClone(valid.data) } }, now = valid.data.receivedAt;
  return { feeds, now, states: panelStates(feeds, now) };
}

test('summary selects the worst actual state and retains every independent reason', () => {
  assert.equal(disclosureProblem([['Cash', cell('fresh', null, {})]]), null);
  const p = disclosureProblem([
    ['History', cell('not reported', 'feed_not_received')],
    ['Today', cell('stale', 'snapshot_stale', {})],
    ['Broker', cell('broken', 'gateway_unconfirmed')],
  ]);
  assert.equal(p.tone, 'bad');
  assert.equal(p.icon, 'stop');
  assert.equal(p.text, 'Broker: unavailable · broker connection not confirmed');
  assert.match(p.detail, /History: not reported · no data received yet/);
  assert.match(p.detail, /Today: stale · updates are late/);
  assert.equal(disclosureProblem([['Today', cell('broken', 'baseline_pending', {}, true)]]).tone, 'warn');
  assert.equal(disclosureProblem([['Today', cell('broken', 'not_exact_yet')]]).icon, 'info');
});

test('opened not-exact desk summaries leave shared reasons in the body and keep independent problems', () => {
  for (const reason of ['not_exact_yet', 'sod_missing']) {
    const candidates = ['Today', 'Open positions', 'Since start'].map(label => [label, cell('broken', reason)]);
    const p = disclosureProblem(candidates);
    assert.equal(p.icon, 'info');
    assert.equal(p.expanded, null, `${reason}: no repeated detail in the expanded header`);
    assert.equal(p.sharedReason, reason === 'not_exact_yet' ? 'not exact' : 'start-of-day value missing');
    assert.equal(p.text, reason === 'not_exact_yet' ? 'Today: not exact' : 'Today: not exact · start-of-day value missing');
    const mixed = disclosureProblem([...candidates, ['History', cell('stale', 'snapshot_stale', {})]]);
    assert.equal(mixed.expanded.detail, 'History: stale · updates are late');
  }
});

test('one-line summaries expose every independent reason in the accessible button text', () => {
  const ctx = context();
  ctx.states['today.openPnl'] = cell('broken', 'not_exact_yet');
  ctx.states.paperAccount = cell('stale', 'snapshot_stale', { amount: '12.34', currency: 'EUR' });
  ctx.states.paperCash = cell('broken', 'gateway_unconfirmed');
  const doc = htmlDocument(heroLeft(ctx)), warning = doc.querySelector('.disclosure-warning');
  const summary = warning.querySelector('.summary-text'), accessible = warning.querySelector('.vh');
  assert.equal(summary.getAttribute('aria-hidden'), 'true', 'do not announce the short reason twice');
  assert.equal(accessible.textContent, summary.getAttribute('title'));
  assert.doesNotMatch(accessible.textContent, /not exact yet/);
  for (const label of ['Open positions: not exact', 'Paper account: stale', 'Cash: unavailable']) {
    assert.ok(accessible.textContent.includes(label));
  }
});

test('cash session fixture passes real ingress while preserving desk content and withholding current money', () => {
  const base = designSnapshot().snapshot;
  base.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  const before = structuredClone(base);
  const session = cashSessionSnapshot(base);
  const accepted = preflightSnapshot('data', session, null, session.generatedAt);
  assert.equal(accepted.status, 200);
  assert.deepEqual(base, before, 'the baseline is immutable');
  for (const [i, desk] of session.desks.entries()) {
    const { money, moneyEvidence, ...content } = desk;
    const { money: oldMoney, moneyEvidence: oldEvidence, ...oldContent } = base.desks[i];
    assert.deepEqual(content, oldContent, 'actions, learning and other desk content remain identical');
    assert.equal(moneyEvidence, undefined);
    for (const field of ['equity', 'dayPnl', 'openPnl', 'totalPnl']) assert.equal(money[field], null);
  }
  assert.equal(session.brokerAccount.equity, null);
  assert.equal(session.brokerAccount.cash, null);
  for (const [i, row] of session.positions.rows.entries()) {
    const { mark, marketValue, dayPnl, openPnl, ...content } = row;
    const { mark: oldMark, marketValue: oldValue, dayPnl: oldDay, openPnl: oldOpen, ...oldContent } = base.positions.rows[i];
    assert.deepEqual(content, oldContent, 'position identities and quantities remain identical');
    assert.ok([mark, marketValue, dayPnl, openPnl].every(value => value == null));
  }
  const states = panelStates({ data: accepted }, session.generatedAt);
  assert.equal(states.gateway.state, 'broken');
  assert.equal(states.gateway.reason, 'gateway_unconfirmed');
});

test('fresh position panels expose null-field and unmatched-desk problems in the summary', () => {
  const c = cell('fresh', null, [{ symbol: 'AAA', reasons: { marketValue: 'not_exact_yet', desk: 'desk_unmapped' } }]);
  const p = disclosureProblem([['Positions', c], ...rowProblems(c)]);
  assert.equal(p.tone, 'bad');
  assert.match(p.text, /AAA desk: unavailable/);
  assert.match(p.detail, /AAA Worth: not exact(?! yet)/);
  assert.deepEqual(rowProblems(cell('broken')), []);
});

test('missing Cash keeps the figure’s default reason in its collapsed Account summary', () => {
  const ctx = context();
  for (const absent of [undefined, cell('not reported')]) {
    ctx.states.paperCash = absent;
    const doc = htmlDocument(heroLeft(ctx));
    const summary = doc.querySelector('.disclosure-warning .summary-text');
    assert.equal(summary.textContent, 'Cash: not reported · no data received yet');
    assert.equal(doc.querySelector('.disclosure-warning use').getAttribute('href'), '#i-ring');
    assert.match(doc.querySelector('.cash-reason').textContent, /no data received yet/);
  }
});

test('unavailable money leads an old check-in without losing its neutral not-exact icon', () => {
  const ctx = context(), desk = ctx.feeds.data.value.desks[0];
  desk.heartbeatAt = new Date(Date.parse(ctx.now) - 120000).toISOString();
  ctx.states.history = cell('fresh', null, {});
  for (const reason of ['not_exact_yet', 'source_unavailable', 'not_exact_yet']) {
    for (const name of ['dayPnl', 'openPnl', 'totalPnl']) ctx.states[`desks.${desk.id}.${name}`] = cell('broken', reason);
    const doc = htmlDocument(compactDesk(ctx, desk.id));
    const summary = doc.querySelector('.disclosure-warning .summary-text');
    assert.match(summary.textContent, reason === 'not_exact_yet' ? /Today: not exact(?! yet)/ : /Today: unavailable · not reported by the broker/);
    assert.equal(doc.querySelector('.disclosure-warning use').getAttribute('href'), reason === 'not_exact_yet' ? '#i-info' : '#i-stop');
    assert.match(summary.getAttribute('title'), /Check-in: stale/);
  }
});

test('compact rows preserve exact signed money, state word, stale markers and the existing card target', () => {
  const ctx = context();
  ctx.states['desks.j.dayPnl'] = cell('stale', 'snapshot_stale', { amount: '-0.01', currency: 'EUR' });
  ctx.states['desks.j.totalPnl'] = cell('fresh', null, { amount: '12.34', currency: 'EUR' });
  ctx.states.history = cell('fresh', null, {});
  const doc = htmlDocument(compactDesk(ctx, 'j')), button = doc.querySelector('button');
  assert.equal(button.getAttribute('aria-controls'), 'detail-j');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.querySelector('[data-compact-value="dayPnl"] .bn').textContent, '−€0,01');
  assert.equal(doc.querySelector('[data-compact-value="totalPnl"] .bn').textContent, '+€12,34');
  assert.equal(doc.querySelectorAll('.compact-state').length, 1);
  assert.match(doc.querySelector('.compact-word').textContent, /Working|Sitting out|Stuck/);
  assert.match(doc.querySelector('.disclosure-warning').textContent, /stale · updates are late/);
  assert.match(doc.querySelector('.bn').getAttribute('class'), /loss/);
});

test('compact summaries expose stuck desks, blocked learning and old check-ins', () => {
  const ctx = context(), desk = ctx.feeds.data.value.desks[0];
  ctx.states.history = cell('fresh', null, {});
  desk.state = 'stuck'; desk.learning = { status: 'blocked' };
  desk.heartbeatAt = new Date(Date.parse(ctx.now) - 120000).toISOString();
  const doc = htmlDocument(compactDesk(ctx, desk.id));
  const detail = doc.querySelector('.summary-text').getAttribute('title');
  assert.match(detail, /Desk stuck/);
  assert.match(detail, /Learning blocked/);
  assert.match(detail, /Check-in: stale/);
});

test('untrusted desk names stay escaped and absent values stay dashes', () => {
  const ctx = context(); ctx.feeds.data.value.desks[0].label = '<img src=x>';
  delete ctx.states['desks.j.dayPnl'];
  const html = compactDesk(ctx, 'j');
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<img'));
  assert.equal(htmlDocument(html).querySelector('[data-compact-value="dayPnl"] .bn').textContent, '—');
});

test('all phone sections default collapsed, toggle independently and remain expanded on desktop without storage', () => {
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const hero = htmlDocument(heroLeft(context()));
  const keys = ['account', 'chart', 'j', 'joe', 'joel', 'positions', 'kept'];
  const bodies = new Map(), controls = keys.map(key => {
    const body = { hidden: false }, attrs = { 'aria-controls': `test-${key}` };
    bodies.set(`test-${key}`, body);
    return { dataset: { deskDisclosure: key }, getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
  });
  assert.equal(doc.querySelectorAll('[data-desk-disclosure]').length, 3);
  assert.equal(hero.querySelector('[data-desk-disclosure]').dataset.deskDisclosure, 'account');
  const previous = globalThis.document;
  globalThis.document = { querySelectorAll: () => controls, querySelector: () => null, getElementById: id => bodies.get(id) };
  try {
    syncDeskDisclosures(true);
    assert.ok(controls.every(c => c.getAttribute('aria-expanded') === 'false'));
    assert.ok([...bodies.values()].every(b => b.hidden));
    toggleDeskDisclosure('j'); syncDeskDisclosures(true);
    assert.equal(controls[2].getAttribute('aria-expanded'), 'true');
    assert.ok(!bodies.get('test-j').hidden && bodies.get('test-joe').hidden);
    syncDeskDisclosures(false);
    assert.ok([...bodies.values()].every(b => !b.hidden));
    syncDeskDisclosures(true);
    assert.ok(!bodies.get('test-j').hidden && bodies.get('test-account').hidden);
    toggleDeskDisclosure('j'); syncDeskDisclosures(true);
    assert.ok([...bodies.values()].every(b => b.hidden));
  } finally { globalThis.document = previous; }
});

test('native disclosure clicks use the real tooltip API and toggle the matching body without losing focus', async t => {
  const { initTips } = await builders('ui.js', []);
  const app = readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8');
  const click = app.match(/  document.addEventListener\('click', e => \{[\s\S]*?^  \}\);/m)?.[0];
  assert.ok(click, 'exercise the production click handler');
  const body = {}, tip = { parentElement: body, classList: { remove() {} } };
  const control = { dataset: { deskDisclosure: 'j' }, attributes: { 'aria-controls': 'detail-j' },
    getAttribute(key) { return this.attributes[key]; }, setAttribute(key, value) { this.attributes[key] = value; },
  };
  const detail = { hidden: false };
  const doc = { body, activeElement: control, addEventListener() {},
    querySelector: selector => selector === '#tip' ? tip : null,
    querySelectorAll: () => [control], getElementById: () => detail,
  };
  for (const [key, value] of Object.entries({ document: doc, addEventListener() {} })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const tips = initTips(), listeners = [];
  let renders = 0;
  runInNewContext(click, { document: { addEventListener: (_name, fn) => listeners.push(fn) }, tips, toggleDeskDisclosure,
    render: () => { renders++; syncDeskDisclosures(true); } });
  syncDeskDisclosures(true);
  for (const open of [true, false]) {
    // Enter, Space and pointer activation all dispatch this native click path.
    listeners[0]({ target: { closest: () => control } });
    assert.equal(control.getAttribute('aria-expanded'), String(open));
    assert.equal(detail.hidden, !open);
    assert.equal(doc.activeElement, control);
  }
  assert.equal(renders, 2);
});

test('real patches retain disclosure visibility and pin/focus on a rebuilt visible Account term', async t => {
  const { initTips, patch } = await builders('ui.js', []);
  const doc = htmlDocument('<div id="heroL"></div>'), root = doc.querySelector('#heroL');
  const listeners = new Map(), classes = new Set(), measuredVisibility = [];
  const emit = (type, target) => {
    for (const fn of listeners.get(type) ?? []) fn({ target, preventDefault() {}, stopImmediatePropagation() {} });
  };
  const body = { append(el) { el.parentElement = body; } };
  const tip = { style: {}, parentElement: body, offsetWidth: 200, offsetHeight: 80,
    classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); },
      toggle(name, yes) { if (yes) classes.add(name); else classes.delete(name); } } };
  const nativeQuery = doc.querySelector.bind(doc);
  Object.assign(doc, { body, getElementById: id => nativeQuery(`#${id}`),
    querySelector: selector => selector === '#tip' ? tip : nativeQuery(selector === '#heroL .say > span' ? '#heroL .say span' : selector),
    addEventListener(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]); },
  });
  // Add the small native DOM surface used by patch/initTips to parsed markup.
  // Geometry is a fixed test input; browser CI owns actual pixels and scrolling.
  const decorate = node => {
    node.hidden = node.getAttribute('hidden') !== null;
    node.hasAttribute = key => node.getAttribute(key) !== null;
    node.removeAttribute = key => { delete node.attributes[key]; };
    node.contains = other => node === other || node.children.some(child => typeof child !== 'string' && child.contains(other));
    const closest = node.closest.bind(node);
    node.closest = selector => selector.includes(',') ? selector.split(',').map(s => closest(s.trim())).find(Boolean) ?? null : closest(selector);
    node.getBoundingClientRect = () => {
      measuredVisibility.push(doc.getElementById('accountDetail')?.hidden);
      return { left: 50, right: 100, top: 80, bottom: 100 };
    };
    node.focus = () => { if (doc.activeElement !== node) { doc.activeElement = node; emit('focus', node); } };
    for (const child of node.children) if (typeof child !== 'string') decorate(child);
  };
  const html = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(root), 'innerHTML');
  Object.defineProperty(root, 'innerHTML', {
    get() { return html.get.call(root); },
    set(value) { html.set.call(root, value); decorate(root); },
  });
  for (const [key, value] of Object.entries({ document: doc, CSS: { escape: value => value }, innerWidth: 390, innerHeight: 844,
    requestAnimationFrame() {},
    addEventListener: (type, fn) => doc.addEventListener(type, fn) })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const tips = initTips(), ctx = context();
  patch(root, heroLeft(ctx)); syncDeskDisclosures(true);
  t.after(() => { if (!doc.getElementById('accountDetail').hidden) toggleDeskDisclosure('account'); });
  // A closed body must remain closed before the primary term is measured.
  // Then the same handoff must work for a visible term inside the open body.
  for (const open of [false, true]) {
    if (open) { toggleDeskDisclosure('account'); syncDeskDisclosures(true); }
    const old = doc.querySelector(open ? '#accountDetail .term' : '.hero-primary .term');
    old.focus(); emit('click', old);
    assert.ok(classes.has('pinned'));
    measuredVisibility.length = 0;
    ctx.states['today.dayPnl'] = cell('fresh', null, { amount: open ? '2' : '1', currency: 'EUR' });
    assert.ok(patch(root, heroLeft(ctx)));
    const again = doc.activeElement;
    assert.notEqual(again, old);
    assert.ok(!root.contains(old) && root.contains(again));
    assert.equal(again.dataset.term, old.dataset.term);
    assert.equal(Boolean(again.closest('#accountDetail')), open);
    assert.equal(doc.getElementById('accountDetail').hidden, !open);
    assert.deepEqual(measuredVisibility, [!open], 'tip geometry must see the restored disclosure layout');
    assert.ok(classes.has('on') && classes.has('pinned'), 'focus handoff must not unpin the explanation');
    assert.equal(again.getAttribute('aria-expanded'), 'true');
    assert.equal(again.getAttribute('aria-describedby'), 'tip');
    assert.equal(tip.style.left, '50px');
    assert.equal(tip.style.top, '108px');
    emit('scroll', doc);
    assert.ok(classes.has('pinned'), 'an unchanged rebuilt anchor survives the scroll check');
    tips.hide();
  }
});

test('expanding measured chart boxes plots observed closes and current values on the first render', async t => {
  const { drawHeroChart, drawMiniCharts } = await builders('desk.js', ['drawHeroChart', 'drawMiniCharts']);
  const ctx = context();
  const doc = htmlDocument(`<div id="heroChart"></div>${['j', 'joe', 'joel'].map(id => `<div id="mini-${id}"><div class="mini-label"></div></div>`).join('')}`);
  const charts = [doc.querySelector('#heroChart'), ...['j', 'joe', 'joel'].map(id => doc.querySelector(`#mini-${id}`))];
  for (const [key, value] of Object.entries({ document: doc, matchMedia: () => ({ matches: true }) })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const history = { closes: Object.fromEntries(['j', 'joe', 'joel'].map(id => [id, [{ v: -1.25 }, { v: 2.5 }]])) };
  drawHeroChart(ctx, null); drawMiniCharts(ctx, history);
  assert.equal(doc.querySelectorAll('svg').length, 0, 'collapsed boxes cannot be measured or cached as drawn');
  for (const chart of charts) { chart.clientWidth = 322; chart.clientHeight = 84; }
  drawHeroChart(ctx, null); drawMiniCharts(ctx, history);
  assert.equal(doc.querySelectorAll('svg').length, 4);
  for (const id of ['j', 'joe', 'joel']) {
    const svg = doc.querySelector(`#mini-${id} svg`);
    const current = Number(ctx.states[`desks.${id}.totalPnl`].value.amount);
    assert.equal(svg.dataset.values, `-1.25 2.5 ${current}`);
    assert.equal(svg.getAttribute('data-zero'), '1');
    assert.equal(svg.querySelectorAll('[data-estimate]').length, 0);
  }
});
