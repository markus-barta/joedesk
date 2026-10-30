// Render complete page entry points into the real index.html preview DOM.
// Assertions consume only the resulting document, never presentation helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { reasons, authShapes, widths, screens, pageFixture, dirtyPreview, authResponse, renderedSnapshot, assertSignedOutPage, retainedDocument, blame } from './fixtures/signed-out-cases.mjs';
const { boardSession } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const { history: accountHistory } = await import('./fixtures/account-fixtures.mjs');
const { createFeed } = await import('../public/joe/feed.js');
const { createObservedEvents } = await import('../public/joe/events.js');
const D = await builders('desk.js', []);
const A = await builders('account.js', ['store', 'last']);
A.store.next = Infinity;
const H = await builders('history.js', []);
const R = await import('../public/joe/results.js');
const { boardHealthPresentation } = await import('../public/joe/health.js');
const { addTerms } = await import('../public/joe/ui.js');
const M = await import('../public/joe/settings-model.js');
const { forgetChartMemory } = await import('../public/joe/chart.js');
const { refreshBoardSettings } = await import('../public/joe/board-settings.js');

// The preview DOM has no layout engine: model the shell's CSS visibility;
// Chrome repeats the same oracle with getComputedStyle/getClientRects.
function visible(node, width) {
  if (!node) return false;
  {
    const n = node;
    const c = n.classList;
    if (n.hidden || ['head', 'style', 'script', 'symbol', 'noscript'].includes(n.tagName) || n.tagName === 'dialog' && !n.hasAttribute('open')) return false;
    if (c.contains('screen') && !c.contains('on') || c.contains('pop') && !c.contains('on')) return false;
    if (c.contains('cash-sizing') || c.contains('rt-sizing') || c.contains('vh') || c.contains('f-saved') && !c.contains('on')) return false;
    if (width <= 700 && c.contains('dsk') || width > 700 && c.contains('phone-only')) return false;
    if (width > 480 && c.contains('compact-row') || width <= 480 && c.contains('c-px')) return false;
    if (['say-size', 'cmp-size', 'bt', 'ctip', 'tip'].some(name => c.contains(name))) return false;
    if (n.hasAttribute('aria-hidden') && (n.parentElement?.classList.contains('step-label') || n.parentElement?.id === 'calTitle')) return false;
    if (width <= 480 && c.contains('acct-wide') || width > 480 && c.contains('acct-narrow')) return false;
    if (width > 1100 && c.contains('bottom-nav')) return false;
  }
  return true;
}
function snapshot(doc, width) {
  const visibility = new Map(), texts = new Map();
  const shown = n => { if (!visibility.has(n)) visibility.set(n, Boolean(n) && (!n.parentElement || shown(n.parentElement)) && visible(n, width)); return visibility.get(n); };
  const text = node => {
    if (!texts.has(node)) texts.set(node, !shown(node) ? '' : node.children.map(n => typeof n === 'string' ? n.replace(/&nbsp;/g, '\u00a0') : text(n)).join(' '));
    return texts.get(node);
  };
  text(doc);
  for (const n of [doc, ...doc.querySelectorAll('*')]) Object.defineProperty(n, 'innerText', { configurable: true, get: () => text(n) });
  return renderedSnapshot(doc, shown);
}
let instance = 0;
async function preview(t, width, shape = '401', populated = true) {
  const controls = { ...R.RS };
  Object.assign(R.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
  R.forgetResults();
  const old = Object.fromEntries(['document', 'matchMedia', 'localStorage', 'innerHeight', 'scrollY', 'CSS', 'window'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  doc.documentElement = doc.querySelector('html'); doc.body = doc.querySelector('body');
  globalThis.document = doc;
  globalThis.CSS = { escape: text => text };
  globalThis.innerHeight = 900; globalThis.scrollY = 0;
  globalThis.matchMedia = query => ({ matches: /prefers-reduced-motion/.test(query) || [...query.matchAll(/max-width: (\d+)px/g)].some(m => width <= Number(m[1])) });
  const f = pageFixture();
  globalThis.localStorage = { getItem: key => key.includes('preview') ? dirtyPreview(f['fleet-config']) : null, setItem() {}, removeItem() {} };
  globalThis.window = { localStorage: globalThis.localStorage };
  forgetChartMemory();
  let refused = false, failed503 = false, pendingPost = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST' && pendingPost) return pendingPost;
    const path = String(url);
    if (failed503) return new Response('{}', { status: 503 });
    if (refused) return authResponse(shape);
    const payload = path.includes('board-settings') ? { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null }
      : path.endsWith('state.json') ? { serverNow: f.data.receivedAt, feeds: { data: { value: f.data } }, panels: {} }
      : path.includes('actions') ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] }
      : path.includes('fleet-config') ? f['fleet-config'] : path.includes('account-history') ? accountHistory() : path.includes('history') ? f.history : f.results;
    return new Response(JSON.stringify(payload), { headers: { 'X-Joe-Received-At': f.data.receivedAt } });
  });
  // Fresh module instance gives each scenario its own settings draft/cache.
  const S = await builders('settings.js', ['buildSkeleton', 'reviewAccountStart', 'saveAccountStart'], String(++instance));
  addTerms(M.FIELD_TERMS);
  S.buildSkeleton();
  doc.getElementById('acctHero').innerHTML = A.accountSkeleton();
  const feed = createFeed(() => {}, () => {}, '', { actionsWanted: () => true, session: boardSession });
  const freeze = createBoardFreeze(doc, boardSession);
  A.forgetAccountHistory(); A.store.next = Infinity;
  Object.assign(A.AS, { range: '1M', view: null, follow: true, details: false, full: null, shown: null });
  Object.assign(A.last, { key: null, ctx: null, series: null, drawn: null });
  if (populated) {
    A.useAccountHistory(accountHistory());
    Object.assign(doc.getElementById('acctChart'), { clientWidth: width === 390 ? 330 : 900, clientHeight: 230 });
  }
  await feed.refresh(); await refreshBoardSettings();
  const events = createObservedEvents(null), prior = structuredClone(f.data);
  prior.generatedAt = new Date(Date.parse(f.data.generatedAt) - 1000).toISOString();
  for (const desk of prior.desks) { desk.action = 'Working'; desk.issues = []; desk.learning = null; }
  events.observe(prior);
  const observed = structuredClone(f.data); observed.desks[0].issues = [blame]; events.observe(observed);
  // Open the phone disclosures so the oracle includes their full bodies.
  for (const id of ['j', 'joe', 'joel', 'positions', 'kept', 'chart']) D.toggleDeskDisclosure(id);
  let renders = 0;
  const render = (ctx, screen) => {
    if (freeze.sync()) return;
    renders++;
    for (const n of doc.querySelectorAll('.screen')) n.classList.toggle('on', n.id === `scr-${screen}`);
    doc.body.dataset.screen = screen;
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now), head = D.headerHealth(ctx, health);
    doc.getElementById('hdrHealth').innerHTML = head.html;
    doc.getElementById('hdrHealth').setAttribute('aria-label', head.label);
    doc.getElementById('hdrHealth').title = head.title ?? '';
    doc.getElementById('statusAlertText').textContent = head.alert;
    doc.getElementById('statusAlert').setAttribute('aria-hidden', 'false');
    if (screen === 'desk') {
      // The preview parser retains whitespace text nodes; browser .children
      // contains only elements (the renderer uses it to preserve card order).
      const grid = doc.querySelector('.desk-grid'); grid.children = grid.children.filter(n => typeof n !== 'string');
      A.renderAccount(ctx); D.renderDesk(ctx);
    } else if (screen === 'history') H.renderHistory(ctx);
    else if (screen === 'results') { R.forgetResults(); R.renderResults(ctx); }
    else S.renderSettings(ctx);
    return populated ? undefined : snapshot(doc, width);
  };
  const context = reason => {
    const selected = feed.select();
    const ctx = { ...selected, now: new Date(Date.parse(f.data.receivedAt) + 75000).toISOString(), feeds: structuredClone(selected.feeds), states: structuredClone(selected.states), events };
    for (const cell of Object.values(ctx.states)) if (cell && typeof cell === 'object') Object.assign(cell, reason ? { reason, state: 'broken', ageSeconds: 125 } : {});
    for (const item of Object.values(ctx.feeds)) if (item) item.reason = reason;
    for (const key of ['positions', 'kept']) for (const row of ctx.states[key]?.value ?? []) row.reasons = Object.fromEntries(['quantity', 'mark', 'marketValue', 'openPnl', 'dayPnl'].map(k => [k, reason]));
    ctx.actions = { entries: [], reason };
    return ctx;
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    feed.stop(); freeze.stop();
    for (const route of ['state.json', 'history.json', 'history-continuity.json', 'results.json', 'fleet-config.json', 'fleet-config/actions.json', 'board-settings.json', 'account-history.json']) boardSession.observe('/joe/' + route, { auth: false });
    A.forgetAccountHistory(); A.store.next = Infinity;
    Object.assign(R.RS, controls); R.forgetResults();
    for (const id of ['j', 'joe', 'joel', 'positions', 'kept', 'chart']) D.toggleDeskDisclosure(id);
    for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    forgetChartMemory();
  };
  t.after(close);
  return { doc, render, context, close, settings: S, deferPost() { let resolve; pendingPost = new Promise(done => { resolve = done; }); return resolve; }, capture: () => retainedDocument(doc), renders: () => renders,
    async signOut() { refused = true; await feed.refresh(); await refreshBoardSettings(); },
    async fail503() { failed503 = true; await feed.refresh(); await refreshBoardSettings(); },
    async recover() { refused = failed503 = false; await feed.refresh(); await refreshBoardSettings(); }, f };
}

// Every earlier reproducer now exercises the same structural invariant; these
// names retain the review history, with populated account history and dirty fields.
const reproducers = [
  ['fix1 hero caption age', 'desk'], ['fix1 missing cells and shared hero copy', 'desk'],
  ['fix1 retained card captions', 'desk'], ['fix2 Positions and kept gateway-dead', 'desk'],
  ['fix2 Check-in and Results compact warnings', 'desk'], ['fix2 account-start auth failure', 'settings'],
  ['fix2 whole-account and Cash accessible names', 'desk'], ['fix2 row-only diagnostics', 'desk'],
  ['fix2 cold History size-limit before 401', 'history'], ['fix2 memoized views', 'results'],
  ['fix3 displayed Cash amount', 'desk'], ['fix3 derived Desk amounts and Since start', 'desk'],
  ['fix3 retained holdings in account strip', 'desk'], ['fix3 Settings Cash', 'settings'],
  ['fix3 dirty Settings caption and saved control descriptions', 'settings'],
  ['fix3 desk action', 'desk'], ['fix3 desk learning', 'desk'], ['fix3 observed History issues', 'history'],
  ['fix3 review retained session bars including amounts and CSS off state', 'desk'],
  ['fix3 review retained position count', 'desk'], ['fix3 review populated account range amount percentage and 1M', 'desk'],
  ['fix3 review 503 after 401 retains account-start comparison', 'desk'],
  ['fix3 review phone blocked-learning disclosure retains content', 'desk'],
  ['fix3 review kept-holdings aggregate worth', 'desk'],
  ['fix3 review Vienna minute and market countdown boundary', 'desk'],
  ['fix3 review independent opaque redirects on all transports', 'history'],
];
for (const [name, screen] of reproducers) test(`JOED-173 fix4 reproducer: ${name}`, async t => {
  const p = await preview(t, name.includes('phone') ? 390 : 1440, name.includes('opaque') ? 'opaqueredirect' : '401');
  const ctx = p.context(name.includes('cold') ? 'history_size_limit' : name.includes('gateway-dead') ? 'gateway_down' : null);
  if (name.includes('cold')) { ctx.states.history.value = null; ctx.feeds.history.value = null; }
  ctx.now = '2026-10-14T17:43:59.000Z';
  p.render(ctx, screen);
  const before = p.capture(), count = p.renders();
  if (name.includes('range')) {
    const text = p.doc.getElementById('acctChange').textContent;
    assert.match(text, /1M/); assert.match(text, /1.800,00/); assert.match(text, /6,87.*%/);
  }
  if (name.includes('session bars')) {
    assert.ok(p.doc.querySelector('#desk-j .bars .today .bl'), 'the retained Today bar starts with its amount');
    assert.ok(!p.doc.querySelector('#desk-j .sessions')?.classList.contains('off'), 'session bars start visible');
  }
  if (name.includes('position count')) assert.match(p.doc.getElementById('desk-j').textContent, /1\sposition/);
  if (name.includes('aggregate worth')) assert.match(p.doc.getElementById('kept').textContent, /600,00.*200,00/);
  if (name.includes('account-start comparison')) assert.match(p.doc.getElementById('acctSub').textContent, /72.000,00.*72,00/);
  await p.signOut();
  p.render({ ...ctx, now: '2026-10-14T17:44:01.000Z' }, screen);
  assertSignedOutPage(p.capture(), before, name);
  await p.fail503();
  p.render(p.context('refresh_failed'), screen);
  assertSignedOutPage(p.capture(), before, `${name}/503 after 401`);
  assert.equal(p.renders(), count, 'no renderer runs on auth failure or subsequent 503');
});

for (const width of widths) for (const shape of authShapes) test(`JOED-173 fix4 entire document: ${width}px / ${shape} / every reason and page`, async t => {
  const p = await preview(t, width, shape);
  for (const reason of [null, ...reasons]) for (const screen of screens) {
    p.render(p.context(reason), screen);
    const before = p.capture(), count = p.renders(), tag = `${width}/${shape}/${reason}/${screen}`;
    await p.signOut();
    const after = p.capture();
    assertSignedOutPage(after, before, tag);
    const changed = p.context('refresh_failed');
    changed.now = new Date(Date.parse(changed.now) + 125000).toISOString();
    p.render(changed, screen);
    assert.deepEqual(p.capture(), after, `${tag}: time and changed state cannot re-render`);
    await p.fail503();
    assertSignedOutPage(p.capture(), before, `${tag}/503`);
    assert.equal(p.renders(), count, `${tag}: no failed render`);
    await p.recover();
    assert.equal(p.capture().reload, false, `${tag}: recovery hides banner`);
    assert.equal(p.capture().marked, false, `${tag}: recovery removes last-known marking`);
    p.render(p.context(null), screen);
    assert.equal(p.renders(), count + 1, `${tag}: authenticated recovery resumes rendering`);
  }
});

test('JOED-173 fix4 pending account-start save cannot change the frozen draft or comparison', async t => {
  const p = await preview(t, 1440);
  p.render(p.context(null), 'settings');
  p.doc.getElementById('accountStartAmount').value = '100001';
  p.doc.getElementById('accountStartDate').value = '2026-01-01';
  p.doc.getElementById('accountStartClear').checked = false;
  p.doc.getElementById('accountStartConfirmed').focus = () => {};
  p.settings.reviewAccountStart();
  p.doc.getElementById('accountStartConfirmed').checked = true;
  const complete = p.deferPost();
  const save = p.settings.saveAccountStart({ preventDefault() {} });
  const before = p.capture();
  await p.signOut(); complete(authResponse('401')); await save;
  assertSignedOutPage(p.capture(), before, 'pending save receives auth failure');
});

test('JOED-173 fix4 a toast timeout cannot erase retained visible text while signed out', async t => {
  const p = await preview(t, 1440);
  p.render(p.context(null), 'settings');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  p.settings.toast('Synthetic saved draft notice'); const before = p.capture();
  await p.signOut(); t.mock.timers.tick(10000);
  assertSignedOutPage(p.capture(), before, 'toast timer');
  await p.recover();
  assert.equal(p.doc.getElementById('toast').classList.contains('on'), false, 'expired toast dismisses after recovery');
});

test('JOED-173 fix4 oracle rejects arbitrary added copy and every dropped element or form value', async t => {
  const p = await preview(t, 1440);
  p.render(p.context(null), 'settings'); const before = p.capture(); await p.signOut();
  for (const copy of ['not exact', 'updates are stuck', 'Learning blocked', 'totally new leak']) {
    const node = p.doc.getElementById('setSub'), children = node.children;
    node.textContent += copy;
    assert.throws(() => assertSignedOutPage(p.capture(), before, copy));
    node.children = children;
  }
  const input = p.doc.querySelector('input'), value = input.value;
  input.value = 'changed'; assert.throws(() => assertSignedOutPage(p.capture(), before, 'input value')); input.value = value;
  const valueNode = p.doc.getElementById('accountStartSummary'), children = valueNode.children;
  valueNode.textContent = ''; assert.throws(() => assertSignedOutPage(p.capture(), before, 'lost comparison')); valueNode.children = children;
  assertSignedOutPage(p.capture(), before, 'restored');
});

test('JOED-173 fix3 snapshot: complete non-auth pages keep exact text, labels and titles', async t => {
  const output = {};
  for (const width of widths) {
    const p = await preview(t, width, '401', false);
    for (const reason of reasons.filter(r => r !== 'auth_required')) for (const screen of screens) {
      const rendered = p.render(p.context(reason), screen);
      output[`${width}/${reason}/${screen}`] = createHash('sha256').update(JSON.stringify(rendered)).digest('hex');
    }
    p.close();
  }
  const url = new URL('./fixtures/presentation-pages-non-auth.json', import.meta.url);
  if (process.argv.includes('--capture-pages-non-auth')) writeFileSync(url, JSON.stringify(output, null, 2) + '\n');
  else assert.deepEqual(output, JSON.parse(readFileSync(url)), 'frozen from complete a941776 rendered pages');
});
