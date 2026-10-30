// Render complete page entry points into the real index.html preview DOM.
// Assertions consume only the resulting document, never presentation helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { reasons, authShapes, widths, screens, pageFixture, dirtyPreview, authResponse, renderedSnapshot, assertSignedOutPage, blame } from './fixtures/signed-out-cases.mjs';
const { createFeed } = await import('../public/joe/feed.js');
const { createObservedEvents } = await import('../public/joe/events.js');
const D = await builders('desk.js', []);
const A = await builders('account.js', ['store']);
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
async function preview(t, width, shape = '401') {
  const controls = { ...R.RS };
  Object.assign(R.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
  R.forgetResults();
  const old = Object.fromEntries(['document', 'matchMedia', 'localStorage', 'innerHeight', 'scrollY', 'CSS', 'window'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  doc.documentElement = doc.querySelector('html'); doc.body = doc.querySelector('body');
  globalThis.document = doc;
  globalThis.CSS = { escape: text => text };
  globalThis.innerHeight = 900; globalThis.scrollY = 0;
  globalThis.matchMedia = query => ({ matches: [...query.matchAll(/max-width: (\d+)px/g)].some(m => width <= Number(m[1])) });
  const f = pageFixture();
  globalThis.localStorage = { getItem: key => key.includes('preview') ? dirtyPreview(f['fleet-config']) : null, setItem() {}, removeItem() {} };
  globalThis.window = { localStorage: globalThis.localStorage };
  forgetChartMemory();
  let refused = false;
  t.mock.method(globalThis, 'fetch', async url => {
    const path = String(url);
    if (refused) return authResponse(shape);
    const payload = path.includes('board-settings') ? { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null }
      : path.endsWith('state.json') ? { serverNow: f.data.receivedAt, feeds: { data: { value: f.data } }, panels: {} }
      : path.includes('actions') ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] }
      : path.includes('fleet-config') ? f['fleet-config'] : path.includes('history') ? f.history : f.results;
    return new Response(JSON.stringify(payload), { headers: { 'X-Joe-Received-At': f.data.receivedAt } });
  });
  // Fresh module instance gives each scenario its own settings draft/cache.
  const S = await builders('settings.js', ['buildSkeleton'], String(++instance));
  addTerms(M.FIELD_TERMS);
  S.buildSkeleton();
  doc.getElementById('acctHero').innerHTML = A.accountSkeleton();
  const feed = createFeed(() => {}, () => {}, '', { actionsWanted: () => true });
  await feed.refresh(); await refreshBoardSettings();
  const events = createObservedEvents(null), prior = structuredClone(f.data);
  prior.generatedAt = new Date(Date.parse(f.data.generatedAt) - 1000).toISOString();
  for (const desk of prior.desks) { desk.action = 'Working'; desk.issues = []; desk.learning = null; }
  events.observe(prior);
  const observed = structuredClone(f.data); observed.desks[0].issues = [blame]; events.observe(observed);
  // Open the phone disclosures so the oracle includes their full bodies.
  for (const id of ['j', 'joe', 'joel', 'positions', 'kept', 'chart']) D.toggleDeskDisclosure(id);
  const render = (ctx, screen) => {
    for (const n of doc.querySelectorAll('.screen')) n.classList.toggle('on', n.id === `scr-${screen}`);
    doc.body.dataset.screen = screen;
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now), head = D.headerHealth(ctx, health);
    doc.getElementById('hdrHealth').innerHTML = head.html;
    doc.getElementById('hdrHealth').setAttribute('aria-label', head.label);
    doc.getElementById('hdrHealth').title = head.title ?? '';
    doc.getElementById('statusAlertText').textContent = head.alert;
    doc.getElementById('statusAlert').setAttribute('aria-hidden', 'false');
    doc.getElementById('signInReload').hidden = health.reason !== 'signed-out';
    if (screen === 'desk') {
      // The preview parser retains whitespace text nodes; browser .children
      // contains only elements (the renderer uses it to preserve card order).
      const grid = doc.querySelector('.desk-grid'); grid.children = grid.children.filter(n => typeof n !== 'string');
      A.renderAccount(ctx); D.renderDesk(ctx);
    } else if (screen === 'history') H.renderHistory(ctx);
    else if (screen === 'results') { R.forgetResults(); R.renderResults(ctx); }
    else S.renderSettings(ctx);
    return snapshot(doc, width);
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
    feed.stop();
    Object.assign(R.RS, controls); R.forgetResults();
    for (const id of ['j', 'joe', 'joel', 'positions', 'kept', 'chart']) D.toggleDeskDisclosure(id);
    for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    forgetChartMemory();
  };
  t.after(close);
  return { doc, render, context, close, async signOut() { refused = true; await feed.refresh(); await refreshBoardSettings(); },
    f };
}

if (!process.argv.includes('--capture-pages-non-auth')) for (const [name, screen, check] of [
  ['warm sign-out keeps the displayed cash amount', 'desk', (after, before) => assert.ok(after.regions.acctHero.includes('1.234,56'))],
  ['warm sign-out keeps derived Desk amounts and the Since start comparison', 'desk', (after, before) => assertSignedOutPage(after, before, 'derived amounts and Since start')],
  ['warm sign-out keeps the retained holdings in the account strip', 'desk', after => assert.match(after.regions.acctHero, /SXR8/)],
  ['warm sign-out keeps Settings Cash visible', 'settings', after => assert.ok(after.regions.rtRows.includes('1.234,56'))],
  ['dirty Settings caption uses last known after fleet 401', 'settings', after => { assert.doesNotMatch(after.copy, /last good/i); assert.match(after.copy, /Last known:.*250/); }],
  ['retained desk action suppresses broker blame', 'desk', after => assert.doesNotMatch(after.regions['desk-j'], /Amy|\bfeed\b/i)],
  ['retained desk learning suppresses broker blame', 'desk', (after, before) => { assert.match(before.regions['desk-j'], /Learning.*Amy/i); assert.doesNotMatch(after.regions['desk-j'], /Learning\s*:.*Amy/i); }],
  ['History observed issues suppress broker blame after sign-out', 'history', after => assert.doesNotMatch(after.copy, /Amy|\bfeed\b/i)],
]) test(`JOED-173 fix3: ${name}`, async t => {
  const p = await preview(t, 1440), before = p.render(p.context(null), screen);
  await p.signOut();
  const ctx = p.context('gateway_down'), after = p.render(ctx, screen);
  check(after, before);
});

if (!process.argv.includes('--capture-pages-non-auth')) for (const width of widths) for (const shape of authShapes) test(`JOED-173 fix3 rendered pages: ${width}px / ${shape} / every reason`, async t => {
  const p = await preview(t, width, shape);
  const before = Object.fromEntries(screens.map(screen => [screen, p.render(p.context(null), screen)]));
  await p.signOut();
  for (const reason of reasons) for (const screen of screens) {
    const ctx = p.context(reason), tag = `${width}/${shape}/${reason}/${screen}`;
    const accepted = structuredClone(ctx.feeds);
    const after = p.render(ctx, screen);
    assertSignedOutPage(after, before[screen], tag);
    const later = { ...ctx, now: new Date(Date.parse(ctx.now) + 2000).toISOString() };
    for (const cell of Object.values(later.states)) if (cell && typeof cell === 'object' && cell.ageSeconds != null) cell.ageSeconds += 2;
    assert.deepEqual(p.render(later, screen), after, `${tag}: two seconds cannot tick any displayed age`);
    assert.deepEqual(ctx.feeds, accepted, `${tag}: rendering preserves diagnostics`);
    if (screen === 'desk') {
      // Also expose every row-level reason through a missing field's visible
      // caption, title and accessibility name. No missing number is invented.
      const missing = { ...ctx, states: structuredClone(ctx.states) };
      for (const key of ['positions', 'kept']) for (const row of missing.states[key]?.value ?? [])
        for (const field of ['quantity', 'mark', 'marketValue', 'openPnl', 'dayPnl']) row[field] = null;
      assertSignedOutPage(p.render(missing, screen), { values: {} }, `${tag}/missing fields`);
    }
  }
});


test('JOED-173 fix3 snapshot: complete non-auth pages keep exact text, labels and titles', async t => {
  const output = {};
  for (const width of widths) {
    const p = await preview(t, width);
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
