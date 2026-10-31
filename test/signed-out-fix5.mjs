import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { htmlDocument, builders } from './fixtures/preview-dom.mjs';
const { createBoardSession, boardSession } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const { sendFleetDraft } = await import('../public/joe/fleet-write.js');
const source = file => process.env.JOED_PRESENTATION_BASELINE
  ? execFileSync('git', ['show', `${process.env.JOED_PRESENTATION_BASELINE}:public/joe/${file}`], { encoding: 'utf8' })
  : readFileSync(new URL(`../public/joe/${file}`, import.meta.url), 'utf8');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
function shell(t) {
  const doc = htmlDocument(source('index.html'));
  const session = createBoardSession(), freeze = createBoardFreeze(doc, session);
  t.after(freeze.stop);
  return { doc, session, freeze, expire: () => session.observe('test', { auth: true }) };
}
test('JOED-173 fix5 inert board blocks chart hover, focus, keyboard and History wheel as a region', t => {
  const p = shell(t); p.expire();
  assert.equal(p.doc.getElementById('app').hasAttribute('inert'), true);
  assert.equal(p.doc.getElementById('signedOutBanner').closest('[inert]'), null);
});
test('JOED-173 fix5 open modal cannot block banner Reload', t => {
  const p = shell(t), dialog = p.doc.getElementById('diffDlg');
  dialog.setAttribute('open', ''); let closes = 0;
  dialog.close = () => { closes++; dialog.removeAttribute('open'); };
  p.expire(); assert.equal(closes, 1); assert.equal(dialog.hasAttribute('open'), false);
});
test('JOED-173 fix5 account Controls and chart inspection close once at expiry', t => {
  const p = shell(t);
  p.doc.getElementById('acctHero').innerHTML = '<button id="acctCtl" aria-controls="acctPop" aria-expanded="true"></button><div id="acctPop"></div><div class="ctip on"></div>';
  p.expire();
  assert.equal(p.doc.getElementById('acctPop').hidden, true);
  assert.equal(p.doc.getElementById('acctCtl').getAttribute('aria-expanded'), 'false');
  assert.equal(p.doc.querySelector('.ctip.on'), null);
});
test('JOED-173 fix5 frozen timestamp is the last rendered server time in Vienna', t => {
  const p = shell(t); p.freeze.remember?.('2026-10-14T17:43:59.000Z'); p.expire();
  assert.equal(p.doc.querySelector('#signedOutBanner strong').textContent, 'Signed out — data as of 19:43:59 (Vienna), not updating — reload to sign in');
});
test('JOED-173 fix5 every value section is explicitly marked stale', t => {
  const p = shell(t); p.expire();
  for (const id of ['acctHero', 'deskHero', 'desk-j', 'desk-joe', 'desk-joel', 'positions', 'kept', 'rhero', 'tiles', 'breakdown', 'cal', 'daypanel', 'histChart', 'histCompare', 'jAcct', 'setMain'])
    assert.equal(p.doc.getElementById(id).hasAttribute('data-frozen'), true, id);
});
test('JOED-173 fix5 authenticated recovery renders fresh data before stale marking is removed', async t => {
  const p = shell(t); let recover;
  assert.equal(typeof p.session.coordinateRecovery, 'function');
  p.session.coordinateRecovery(async () => { await new Promise(done => { recover = done; }); });
  p.expire(); p.session.observe('other-feed', { auth: false }); await Promise.resolve();
  assert.equal(p.session.signedOut(), true, 'authenticated evidence starts a refresh, not a live display');
  assert.equal(p.doc.getElementById('app').hasAttribute('data-last-known'), true);
  recover(); await Promise.resolve();
  p.session.finishRecovery(() => {
    assert.equal(p.doc.getElementById('app').hasAttribute('data-last-known'), true);
    p.doc.getElementById('acctHero').textContent = 'fresh document';
    p.freeze.rendered('2026-10-14T17:44:02.000Z');
  });
  assert.equal(p.doc.getElementById('acctHero').textContent, 'fresh document');
  assert.equal(p.doc.getElementById('app').hasAttribute('data-last-known'), false);
});
for (const file of ['account.js', 'history.js']) test(`JOED-173 fix5 pre-expiry touch/long-press timer is cancelled: ${file}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const m = await builders(file, ['input'], 'fix5-cancel');
  let inspected = false;
  m.input.touch = { timer: setTimeout(() => { inspected = true; }, 350) };
  assert.equal(typeof m.cancelInteractions, 'function');
  m.cancelInteractions(); t.mock.timers.tick(500);
  assert.equal(inspected, false); assert.equal(m.input.touch, null);
});
for (const shape of ['401', 'opaque redirect', 'HTML']) test(`JOED-173 fix5 fleet write auth freezes before submission error UI: ${shape}`, async t => {
  t.after(() => boardSession.observe('/joe/fleet-config/propagate', { auth: false }));
  t.mock.method(globalThis, 'fetch', async () => shape === '401' ? new Response('{}', { status: 401 })
    : shape === 'HTML' ? new Response('<form>Sign in</form>') : { type: 'opaqueredirect', status: 0 });
  await sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  assert.equal(boardSession.signedOut(), true);
});
test('JOED-173 fix5 latest address is queued while frozen and followed after recovery', () => {
  const app = source('app.js'), start = app.indexOf('  const follow = '), end = app.indexOf("  addEventListener('popstate'", start);
  const calls = [], state = { frozen: true, hash: '#results' };
  const scope = { places: { step: () => true, saved: () => 0 }, parseRoute: hash => ({ screen: hash.slice(1) }), location: state,
    sameRoute: () => false, shown: { screen: 'desk' }, freeze: { frozen: () => state.frozen },
    go: screen => { if (!state.frozen) calls.push(screen); }, queuedRoute: null };
  runInNewContext(app.slice(start, end) + '\nthis.follow = follow;', scope);
  scope.follow(); state.hash = '#history'; scope.follow();
  assert.equal(scope.queuedRoute?.screen, 'history');
});
test('JOED-173 fix5 system appearance callback cannot repaint a frozen version', () => {
  const text = source('version-display.js'), start = text.indexOf('export function paintVersions()');
  let reads = 0;
  const scope = { boardSession: { signedOut: () => true }, document: { querySelectorAll() { reads++; return []; } } };
  runInNewContext(text.slice(start, text.indexOf('export function initVersionDisplay', start)).replace('export ', '') + '\npaintVersions();', scope);
  assert.equal(reads, 0);
});

test('JOED-173 fix5 account-history retry polls while signed out, independent of rendering', async t => {
  const A = await builders('account.js', ['store'], 'fix5-poll');
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => { reads++; return new Response('{}', { status: 401 }); });
  t.after(() => boardSession.observe('/joe/account-history.json', { auth: false }));
  boardSession.observe('/joe/account-history.json', { auth: true }); A.store.next = 0;
  assert.equal(typeof A.pollAccountHistory, 'function');
  await A.pollAccountHistory(); assert.equal(reads, 1);
  A.store.next = 0; await A.pollAccountHistory(); assert.equal(reads, 2);
});
for (const kind of ['history', 'results']) test(`JOED-173 fix5 first successful ${kind} worker document survives recovery`, async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'self');
  t.after(() => { if (old) Object.defineProperty(globalThis, 'self', old); else delete globalThis.self; });
  let resolve, refused = false, seq = valid[kind].seq;
  globalThis.self = { postMessage: data => resolve(data) };
  await import(`../public/joe/history-worker.js?fix5-first-${kind}`);
  const handle = self.onmessage;
  t.mock.method(globalThis, 'fetch', async url => refused ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(
    String(url).includes('continuity') ? {} : { ...valid[kind], seq }), { headers: { 'X-Joe-Feed-Reason': 'contract_invalid' } }));
  const poll = () => new Promise(done => { resolve = done; handle({ data: kind === 'history' ? 'poll' : 'results' }); });
  await poll(); refused = true; await poll(); handle({ data: { frozen: true } });
  refused = false; seq++; const first = await poll();
  assert.equal(first.valid, true, 'a validated document may report a previous server rejection');
  assert.equal(first.kind, kind, 'a recovering body must not be posted as blocked');
  assert.equal(kind === 'history' ? first.meta.seq : first.index.meta.seq, seq);
});
test('JOED-173 fix5 any authenticated feed can start recovery of an account-only expiry', async () => {
  const session = createBoardSession(); let started = 0;
  session.coordinateRecovery(async () => { started++; });
  session.observe('/joe/account-history.json', { auth: true });
  session.observe('/joe/state.json', { auth: false }); await Promise.resolve();
  assert.equal(started, 1); assert.equal(session.signedOut(), true, 'refresh still has to complete and render');
});
test('JOED-173 fix5 failed recovery keeps stale markings until a later full refresh', async t => {
  const p = shell(t); let complete;
  p.session.coordinateRecovery(async () => { await new Promise(done => { complete = done; }); });
  p.expire(); p.session.observe('other', { auth: false }); await Promise.resolve();
  p.session.accept('state', { status: 503 });
  let rendered = false;
  assert.equal(p.session.finishRecovery(() => { rendered = true; }), false);
  assert.equal(rendered, false); assert.equal(p.doc.getElementById('app').hasAttribute('inert'), true);
  complete(); await Promise.resolve();
});

test('JOED-173 fix5 account focusout cannot change retained Controls after expiry', async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = htmlDocument('<div id="acctHero"><div class="acct-foot"><button id="acctCtl" aria-expanded="true"></button><div id="acctPop"></div></div></div><button id="outside"></button>');
  globalThis.document = doc;
  t.after(() => { if (old) Object.defineProperty(globalThis, 'document', old); else delete globalThis.document; boardSession.observe('focusout', { auth: false }); });
  for (const node of [doc, ...doc.querySelectorAll('*')]) node.addEventListener = (type, fn) => { (node.listeners ??= {})[type] = fn; };
  const A = await builders('account.js', ['bindControls'], 'fix5-focusout'); A.bindControls();
  boardSession.observe('focusout', { auth: true });
  doc.querySelector('.acct-foot').listeners.focusout({ relatedTarget: doc.getElementById('outside') });
  assert.equal(doc.getElementById('acctPop').hidden, false);
  assert.equal(doc.getElementById('acctCtl').getAttribute('aria-expanded'), 'true');
});
for (const id of ['acctChart', 'histChart', 'heroChart', 'curve']) test(`JOED-173 fix5 chart hover/focus/keyboard cannot rewrite the frozen inspector: ${id}`, async t => {
  const oldDoc = Object.getOwnPropertyDescriptor(globalThis, 'document'), oldMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const doc = htmlDocument(`<div id="${id}"><div class="ctip"></div></div><div id="live"></div>`);
  globalThis.document = doc; globalThis.matchMedia = () => ({ matches: true });
  t.after(() => {
    for (const [key, old] of [['document', oldDoc], ['matchMedia', oldMedia]]) { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; }
    boardSession.observe('chart-input', { auth: false });
  });
  const { drawChart, changeAxis } = await import('../public/joe/chart.js');
  const el = doc.getElementById(id); Object.assign(el, { clientWidth: 600, clientHeight: 300 });
  const matches = el.matches.bind(el); el.matches = selector => selector === ':focus-visible' || matches(selector);
  let tips = 0;
  const scale = drawChart(el, { series: [{ pts: [{ x: 0, v: 1 }, { x: 1, v: 2 }], color: 'red' }], xDomain: [0, 1], zero: true, yFmt: changeAxis,
    tipFmt: () => { tips++; return { html: 'inspected', text: 'inspected' }; }, inspect: { points: [0, 1], live: doc.getElementById('live') } });
  boardSession.observe('chart-input', { auth: true }); el.setAttribute('inert', '');
  scale.inspectAt(300); el.onpointermove({ clientX: 300, target: el });
  el.onfocus(); el.onkeydown({ target: el, key: 'ArrowRight', preventDefault() {} });
  assert.equal(tips, 0); assert.equal(doc.querySelector('.ctip').textContent, '');
});

for (const malformed of [false, true]) test(`JOED-173 fix5 recovery distinguishes recorded contract failure from invalid new data: malformed=${malformed}`, async t => {
  const { createFeed } = await import('../public/joe/feed.js');
  const session = createBoardSession();
  let finish, recovery;
  session.coordinateRecovery(async () => { await new Promise(done => { finish = done; }); });
  const feed = createFeed(() => {}, () => {}, '', { session }); t.after(feed.stop);
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(String(url).endsWith('state.json')
    ? { serverNow: valid.data.receivedAt, feeds: { data: { value: malformed ? {} : valid.data, reason: 'contract_invalid' } }, panels: {} }
    : String(url).includes('continuity') ? {} : String(url).includes('history') ? valid.history : String(url).includes('fleet-config') ? valid['fleet-config'] : valid.results),
  { headers: { 'X-Joe-Received-At': valid.data.receivedAt, 'X-Joe-Feed-Reason': 'contract_invalid' } }));
  session.observe('expiry', { auth: true });
  await feed.refresh();
  const rendered = session.finishRecovery(() => { recovery = true; });
  assert.equal(rendered, !malformed); assert.equal(Boolean(recovery), !malformed);
  finish(); await Promise.resolve();
});
