import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { htmlDocument, builders } from './fixtures/preview-dom.mjs';
import { freshPageSession } from './fixtures/board-session.mjs';
beforeEach(t => { const restore = freshPageSession(); t.after(restore); });
const { createBoardSession, boardSession } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const { createBoardSettings } = await import('../public/joe/board-settings-write.js');
const { sendFleetDraft } = await import('../public/joe/fleet-write.js');
const { sendOutcome } = await import('../public/joe/settings-model.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const keys = ['state', 'history', 'history-continuity', 'results', 'account-history', 'board-settings', 'fleet-config', 'fleet-config/actions'].map(s => `/joe/${s}.json`);
const good = { evidence: 'AUTHENTICATED', status: 200, auth: false };
test('JOED-173 fix6 collapsed Positions and Kept holdings headers and the calendar total carry frozen marks', t => {
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const s = createBoardSession(), freeze = createBoardFreeze(doc, s); t.after(freeze.stop);
  s.observe('expiry', { auth: true });
  for (const id of ['positionsTitle', 'keptTitle', 'calSum']) {
    const node = doc.getElementById(id);
    assert.ok(node.closest('[data-frozen]'), `${id}: section marking must include its header`);
  }
});
for (const pending of [false, true]) test(`JOED-173 fix6 version feedback and clipboard completion are neutralized at freeze, pending=${pending}`, async t => {
  const doc = htmlDocument('<button id="versionMode"></button><span data-product-version="261030154842.0.0" data-version-scheme="inspr-calver-3"></span>');
  let release, fallback = 0, invalidTimerReceivers = 0, stopVersion;
  for (const node of [doc, ...doc.querySelectorAll('*')]) {
    node.ownerDocument = doc;
    const listeners = new Map(); node.addEventListener = (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    node.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn));
    node.fire = type => { for (const fn of listeners.get(type) ?? []) fn({ target: node, pointerType: 'mouse' }); };
  }
  const make = () => {
    const node = htmlDocument('<span></span>').querySelector('span');
    node.ownerDocument = doc; node.append = (...nodes) => { for (const n of nodes) { n.parentElement = node; node.children.push(n); } };
    node.replaceChildren = (...nodes) => { node.children = []; node.append(...nodes); };
    node.remove = () => { node.parentElement.children = node.parentElement.children.filter(n => n !== node); };
    node.addEventListener = () => {}; node.removeEventListener = () => {}; node.focus = () => {}; node.select = () => {};
    return node;
  };
  doc.createElement = make;
  for (const node of doc.querySelectorAll('*')) {
    node.append = (...nodes) => { for (const n of nodes) { n.parentElement = node; node.children.push(n); } };
    node.replaceChildren = (...nodes) => { node.children = []; node.append(...nodes); };
  }
  doc.execCommand = () => { fallback++; return false; };
  const hostAttributes = doc.querySelector('[data-product-version]').attributes;
  Object.defineProperty(hostAttributes, Symbol.iterator, { value: function* () { for (const [name, value] of Object.entries(this)) yield { name, value }; } });
  const old = new Map(['document', 'getComputedStyle', 'MutationObserver', 'matchMedia', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { stopVersion?.(); boardSession.observe('version', good); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  Object.defineProperties(globalThis, {
    document: { value: doc, configurable: true }, getComputedStyle: { value: () => ({ getPropertyValue: () => '#aa9900' }), configurable: true },
    MutationObserver: { value: class { observe() {} }, configurable: true }, matchMedia: { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true },
    navigator: { value: { clipboard: { writeText: () => pending ? new Promise((_, reject) => { release = reject; }) : Promise.resolve() } }, configurable: true },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const key of ['setTimeout', 'clearTimeout']) {
    const timer = globalThis[key];
    t.mock.method(globalThis, key, function (...args) { if (this !== globalThis) invalidTimerReceivers++; return Reflect.apply(timer, globalThis, args); });
  }
  const V = await import(`../public/joe/version-display.js?fix6-${pending}`); stopVersion = V.initVersionDisplay();
  const host = doc.querySelector('[data-product-version]'); host.fire('click');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  boardSession.observe('version', { auth: true });
  const atFreeze = JSON.stringify([host.attributes, host.dataset, host.innerHTML, host.textContent]);
  if (pending) release(new Error('clipboard refused after freeze'));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.equal(JSON.stringify([host.attributes, host.dataset, host.innerHTML, host.textContent]), atFreeze);
  assert.equal(invalidTimerReceivers, 0, 'browser timers require the global receiver');
  assert.equal(fallback, 0, 'late clipboard failure cannot create fallback UI');
  assert.equal(host.dataset.copyState, undefined);
  stopVersion?.(); boardSession.observe('version', good);
});
test('JOED-173 fix6 malformed non-auth 200 fleet POST keeps exact request rejected wording', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken'));
  const answer = await sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  assert.equal(sendOutcome(answer.status, answer.body, []).reason, 'request rejected');
});
test('JOED-173 fix15 pending account-start POST and later GET cannot change the frozen baseline', async t => {
  let release, reads = 0;
  const original = { accountStart: { amountEur: 100, date: '2026-01-01' }, reason: null };
  const client = createBoardSettings({ fetcher: async (_, init) => init.method === 'POST'
    ? new Promise(done => { release = done; }) : (reads++, new Response(JSON.stringify(original))) });
  t.after(client.stop);
  await client.refresh();
  const pending = client.save({ accountStart: { amountEur: 200, date: '2026-01-01' } });
  boardSession.observe('expiry', { auth: true });
  assert.equal((await client.refresh()).ok, false); assert.equal(reads, 1);
  release(new Response(JSON.stringify({ ok: true, accountStart: { amountEur: 200, date: '2026-01-01' }, reason: null })));
  assert.equal((await pending).abandoned, true);
  assert.deepEqual(client.snapshot(), original);
});
test('JOED-173 fix15 board-settings GET spanning expiry is ignored even with a valid body', async t => {
  let release;
  const client = createBoardSettings({ fetcher: () => new Promise(done => { release = done; }) }); t.after(client.stop);
  const pending = client.refresh(), frozen = client.snapshot();
  boardSession.observe('expiry', { auth: true });
  release(new Response(JSON.stringify({ accountStart: { amountEur: 200, date: '2026-01-01' }, reason: null })));
  assert.equal((await pending).ok, false);
  assert.equal(boardSession.signedOut(), true); assert.deepEqual(client.snapshot(), frozen);
});
test('JOED-173 fix15 account-history failures and successes preserve frozen store', async () => {
  const A = await builders('account.js', ['useReply', 'store'], 'fix15-account');
  const before = structuredClone(A.store);
  boardSession.observe('expiry', { auth: true });
  for (const reply of [{ kind: 'account', status: 503, reason: 'refresh_failed', value: null },
    { kind: 'account', status: 200, value: { seq: 99 } }, { kind: 'unchanged', status: 200 }]) {
    assert.equal(A.useReply(reply), false); assert.deepEqual(A.store, before);
  }
});
test('JOED-173 fix15 late fleet POST is abandoned after all feeds return success', async t => {
  let release;
  t.mock.method(globalThis, 'fetch', () => new Promise(done => { release = done; }));
  const pending = sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  boardSession.observe('expiry', { auth: true });
  for (const key of keys) boardSession.accept(key, good);
  release(new Response(JSON.stringify({ ok: true })));
  assert.equal((await pending).abandoned, true); assert.equal(boardSession.signedOut(), true);
});
