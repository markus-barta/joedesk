// JOED-79: small, browser-free checks of summary truth and disclosure state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
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

test('fresh position panels expose null-field and unmatched-desk problems in the summary', () => {
  const c = cell('fresh', null, [{ symbol: 'AAA', reasons: { marketValue: 'not_exact_yet', desk: 'desk_unmapped' } }]);
  const p = disclosureProblem([['Positions', c], ...rowProblems(c)]);
  assert.equal(p.tone, 'bad');
  assert.match(p.text, /AAA desk: unavailable/);
  assert.match(p.detail, /AAA Worth: unavailable · not exact yet/);
  assert.deepEqual(rowProblems(cell('broken')), []);
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
