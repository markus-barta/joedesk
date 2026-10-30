import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';

const U = await import('../public/joe/ui.js');
const D = await import('../public/joe/desk.js');
const A = await import('../public/joe/account.js');
const H = await import('../public/joe/health.js');
const S = await import('../public/joe/settings-model.js');
const R = await import('../public/joe/results.js');
const { boardStates } = await import('../public/joe/board-state.js');
const { toColumns } = await import('../public/joe/history-model.js');
const { indexResults } = await import('../public/joe/results-model.js');
const { createFeed } = await import('../public/joe/feed.js');
const { createBoardSettings } = await import('../public/joe/board-settings-write.js');
const { statusLine } = await builders('history.js', ['statusLine']);
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
if (!globalThis.document) globalThis.document = { documentElement: { dataset: {} } };
let runtimeHtml, sourceHtml, logHtml;
try { ({ runtimeHtml, sourceHtml, logHtml } = await builders('settings.js', ['runtimeHtml', 'sourceHtml', 'logHtml'])); }
finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
const { deskCard, deskProblem } = await builders('desk.js', ['deskCard', 'deskProblem']);
const { dayContent, heroSentence, renderStatus } = await builders('results.js', ['dayContent', 'heroSentence', 'renderStatus']);
const fixture = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const start = { amountEur: 100000, date: '2026-01-01' };
const snapshotURL = new URL('./fixtures/presentation-non-auth.json', import.meta.url);
const failureReasons = Object.keys(H.CELL_REASON).filter(reason => reason !== 'auth_required');

function context() {
  const feeds = Object.fromEntries(['data', 'history', 'results', 'fleet-config'].map(name => [name, { value: structuredClone(fixture[name]), reason: null }]));
  feeds.history.value.columns = toColumns(feeds.history.value.points);
  feeds.results.value.index = indexResults(feeds.results.value);
  const now = new Date(Date.parse(fixture.data.receivedAt) + 75000).toISOString();
  return { feeds, now, states: boardStates(feeds, now), actions: { entries: [], reason: null } };
}
function inject(ctx, reason, { signedOut = true, missing = false } = {}) {
  if (signedOut) ctx.states.session = 'signed-out';
  for (const cell of Object.values(ctx.states)) {
    if (!cell || typeof cell !== 'object') continue;
    Object.assign(cell, { state: 'broken', reason, retained: !missing, ageSeconds: 125, signedOut });
    if (missing) cell.value = null;
  }
  for (const name of ['positions', 'kept']) for (const row of ctx.states[name]?.value ?? []) {
    row.mark = null;
    row.reasons = { ...row.reasons, mark: reason };
  }
  ctx.actions = { entries: missing ? null : [], reason };
  return ctx;
}
// Exercise the actual render builders, including accessible names, titles,
// compact rows, chart status, and the header/phone status adapter. These are
// the seams used by the page renderers; no hand-written substitute renderer.
function surfaces(ctx) {
  const cell = ctx.states.paperAccount, view = R.resultsView(ctx), health = H.statusPresentation(ctx);
  const settings = S.accountStartRow({ accountStart: null, reason: 'auth_required' }, ctx);
  const parts = A.subParts(ctx, start, { reason: null });
  const day = view.today;
  return {
    'Desk hero': D.heroLeft(ctx),
    'Desk cards': ['j', 'joe', 'joel'].map(id => deskCard(ctx, id)).join(''),
    'Desk compact rows': ['j', 'joe', 'joel'].map(id => D.compactDesk(ctx, id)).join(''),
    Positions: D.positionsHtml(ctx).html,
    'Kept holdings': D.keptHtml(ctx),
    'Whole account': A.valueHtml(cell),
    'Account state': JSON.stringify(A.stateLine(cell)),
    'Account subline': Object.values(parts).join(''),
    Cash: A.cashPart(ctx.states.paperCash),
    'Settings Cash': U.cashCaption(ctx.states.paperCash, 'test'),
    'Settings Cash figure': U.cashCaption(ctx.states.paperCash, 'test', { figure: true }),
    'Settings runtime': runtimeHtml(ctx),
    'Settings source': sourceHtml(ctx),
    'Settings log': logHtml(ctx),
    'Settings account start': JSON.stringify(settings),
    History: statusLine(ctx.states.history),
    'Results sentence': heroSentence(view, { phrase: 'today' }, { empty: true }, 0),
    'Results day': JSON.stringify(dayContent(view, day, ['j', 'joe', 'joel'])),
    'Results state': JSON.stringify(D.disclosureProblem([['Results', D.resultsFeedProblem(view)]])),
    'Results chart status': resultsStatus(view),
    'Header and phone bar': D.headerHealth(ctx, health).html,
    'Board status': JSON.stringify(health),
  };
}
function resultsStatus(view) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = htmlDocument('<div id="resStatus"></div>');
  globalThis.document = doc;
  try { renderStatus(view); return doc.querySelector('#resStatus').innerHTML; }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
}
const forbidden = /broker (?:connection (?:down|unstable|not confirmed)|is offline)|not reported by the broker|\bAmy\b|\bfeed\b|last good|not set|\b\d+[\s\u00a0]*(?:s|min|h|days?) (?:ago|old)|data-age=/i;
function readerCopy(html) {
  const doc = htmlDocument(String(html));
  for (const node of doc.querySelectorAll('[aria-hidden="true"]')) node.remove();
  return [doc.textContent, ...[...doc.querySelectorAll('[aria-label]'), ...doc.querySelectorAll('[title]')].flatMap(n => [n.getAttribute('aria-label'), n.getAttribute('title')]),
    ...(doc.querySelectorAll('[data-age]').length ? ['data-age='] : [])].filter(Boolean).join(' ');
}
function assertSignedOut(html, name) {
  assert.doesNotMatch(readerCopy(html), forbidden, name);
}
function nonAuthSnapshot() {
  const result = {};
  for (const reason of failureReasons) for (const missing of [false, true]) {
    const ctx = inject(context(), reason, { signedOut: false, missing });
    const output = surfaces(ctx);
    // Auth settings are tested separately; status JSON includes diagnostic
    // objects rather than rendered text and is still snapshotted byte-for-byte.
    delete output['Settings account start'];
    for (const [name, html] of Object.entries(output)) (result[name] ??= []).push([reason, missing, html]);
  }
  return Object.fromEntries(Object.entries(result).map(([name, samples]) => [name, createHash('sha256').update(JSON.stringify(samples)).digest('hex')]));
}

if (process.argv.includes('--capture-non-auth')) {
  process.stdout.write(`${JSON.stringify(nonAuthSnapshot(), null, 2)}\n`);
} else {
  test('JOED-173 fix2 snapshot: every non-auth reason keeps exact existing renderer output', () => {
    assert.deepEqual(nonAuthSnapshot(), JSON.parse(readFileSync(snapshotURL)), 'frozen at fa6db1d; compare actual markup, accessible names and status text');
  });

  test('JOED-173 fix2 audit: every reason on every presentation seam is gated while signed out', () => {
    for (const reason of Object.keys(H.CELL_REASON)) for (const missing of [false, true]) {
      const ctx = inject(context(), reason, { missing });
      const before = structuredClone(ctx);
      for (const [name, html] of Object.entries(surfaces(ctx))) {
        // The object is a diagnostic carrier; its visible warning is rendered
        // by disclosureProblem, not JSON.stringify.
        if (name === 'Results state') { assertSignedOut(JSON.stringify(D.disclosureProblem([['Results', D.resultsFeedProblem(R.resultsView(ctx))]])), name); continue; }
        if (name === 'Board status') { const p = H.statusPresentation(ctx); assertSignedOut([p.sentence, p.compact, p.alert, p.label].join(' '), name); continue; }
        assertSignedOut(html, `${reason}/${missing}/${name}`);
      }
      assert.deepEqual(ctx, before, 'presentation does not erase original diagnostics or observations');
    }
  });

  test('JOED-173 fix2 audit: page renderers import age formatting through the shared gate', () => {
    for (const file of ['ui', 'health', 'desk', 'account', 'history', 'results', 'settings']) {
      const source = readFileSync(new URL(`../public/joe/${file}.js`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /import\s*\{[^}]*\bage\b[^}]*\}\s*from ['"]\.\/format\.js/, `${file}: raw age formatter bypass`);
      assert.match(source, /from ['"]\.\/presentation\.js/, `${file}: shared policy required`);
      for (const [, args] of source.matchAll(/\b(?:cellReason|dashWords)\(([^()]*)\)/g)) assert.ok(args.includes(','), `${file}: reason formatter must receive its board or cell: ${args}`);
    }
    const details = readFileSync(new URL('../public/joe/desk.js', import.meta.url), 'utf8');
    assert.equal([...details.matchAll(/\bdiagnosticReason\(/g)].length, 1, 'one explicit Details-only diagnostic escape hatch');
  });

  async function signedOutFeed(t, { failed = false, coldHistory = false } = {}) {
    t.mock.method(globalThis, 'fetch', async url => {
      const file = String(url);
      if (refused && file.endsWith(coldHistory ? 'state.json' : 'history.json')) return new Response('{}', { status: 401 });
      if (coldHistory && file.endsWith('history.json')) return new Response(JSON.stringify({ reason: 'history_size_limit' }), { status: 503 });
      if (file.endsWith('state.json')) return new Response(JSON.stringify({ serverNow: data.receivedAt, feeds: { data: { value: data } }, panels: {} }));
      return new Response(JSON.stringify(file.includes('fleet-config') ? fixture['fleet-config'] : file.endsWith('history.json') ? fixture.history : fixture.results));
    });
    const data = failed ? (() => { const f = JSON.parse(readFileSync(new URL('../fixtures/failures/a-gateway-up-but-dead.json', import.meta.url))); return { ...f.payload, receivedAt: f.receivedAt }; })() : structuredClone(fixture.data);
    let refused = false;
    const feed = createFeed(() => {});
    t.after(feed.stop);
    await feed.refresh(); refused = true; await feed.refresh();
    assert.equal(feed.select().states.session, 'signed-out');
    return feed.select();
  }

  test('JOED-173 fix2 Positions and kept: gateway-dead plus history 401 never blames the broker', async t => {
    const ctx = await signedOutFeed(t, { failed: true });
    for (const html of [D.positionsHtml(ctx).html, D.keptHtml(ctx)]) {
      assertSignedOut(html, 'position body and field dash accessible names');
      assert.match(readerCopy(html), /last known|unknown while signed out/i);
    }
  });

  test('JOED-173 fix2 compact warnings: Check-in and Results inherit the board session', () => {
    const ctx = inject(context(), 'snapshot_stale');
    for (const desk of ctx.feeds.data.value.desks) desk.heartbeatAt = new Date(Date.parse(ctx.now) - 180000).toISOString();
    const problem = deskProblem(ctx, 'j', D.deskFacts(ctx));
    assert.match(problem.detail, /Check-in:.*unknown while signed out/);
    assert.match(problem.detail, /Results:.*last known.*unknown while signed out/);
    assertSignedOut(D.compactDesk(ctx, 'j'), 'compact row');
    const clock = D.disclosureProblem([['Clock', { state: 'not reported', value: null }]], ctx);
    assert.match(clock.detail, /unknown while signed out/, 'synthetic warnings use the same board context');
  });

  test('JOED-173 fix2 account-start auth failure: Since start and Settings never say not set', async t => {
    let refused = false;
    t.mock.method(globalThis, 'fetch', async () => refused ? new Response('{}', { status: 401 }) : new Response(JSON.stringify({ accountStart: start, reason: null })));
    const settings = createBoardSettings();
    await settings.refresh(); refused = true; await settings.refresh();
    const snapshot = settings.snapshot();
    assert.equal(snapshot.reason, 'auth_required');
    const ctx = inject(context(), 'gateway_down');
    for (const text of [A.subParts(ctx, null, snapshot).wide, JSON.stringify(S.accountStartRow(snapshot))]) {
      assertSignedOut(text, 'protected account start');
      assert.match(text, /signed out/);
    }
    assert.equal(S.accountStartRow(snapshot).editable, false);
  });

  test('JOED-173 fix2 whole-account and Cash: signed-out missing accessible names override broker reasons', async t => {
    const ctx = await signedOutFeed(t, { failed: true });
    for (const html of [A.valueHtml(ctx.states.paperAccount), A.cashPart(ctx.states.paperCash), U.cashCaption(ctx.states.paperCash, 'settings')]) {
      assertSignedOut(html, 'account/Cash labels');
      assert.match(html, /unknown while signed out/);
    }
  });

  test('JOED-173 fix2 Details: row-only source_unavailable diagnostic survives sign-out', () => {
    const ctx = context(), row = ctx.states.positions.value[0];
    row.mark = null; row.reasons = { ...row.reasons, mark: 'source_unavailable' };
    for (const cell of Object.values(ctx.states)) if (cell && typeof cell === 'object') cell.signedOut = true;
    ctx.states.session = 'signed-out';
    assert.match(D.healthPop(ctx, H.statusPresentation(ctx)), /Last known diagnostics before sign-out:.*not reported by the broker/);
    assertSignedOut(D.positionsHtml(ctx).html, 'row diagnostic belongs only in Details');
    assert.equal(row.reasons.mark, 'source_unavailable');
  });

  test('JOED-173 fix2 cold History: size-limit failure then state 401 shows signed-out copy without a value', async t => {
    const ctx = await signedOutFeed(t, { coldHistory: true });
    assert.equal(ctx.states.history.value, null);
    assertSignedOut(statusLine(ctx.states.history), 'cold History');
    assert.match(statusLine(ctx.states.history), /unknown while signed out/);
    assert.doesNotMatch(statusLine(ctx.states.history), /refresh failed|history is full/i);
  });

  test('JOED-173 fix2 memoized views: sign-out invalidates Desk facts and the whole Results page with unchanged failure reasons', t => {
    const ctx = inject(context(), 'snapshot_stale', { signedOut: false });
    const before = D.deskFacts(ctx);
    const after = { ...ctx, states: { ...ctx.states, session: 'signed-out',
      ...Object.fromEntries(Object.entries(ctx.states).map(([key, cell]) => [key, { ...cell, signedOut: true }])) } };
    assert.equal(D.deskFacts(after).view.cell.signedOut, true, 'memo must not retain the signed-in Results view');
    assert.equal(before.view.cell.signedOut, false, 'previous view remains unchanged');

    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), controls = { ...R.RS };
    const nodes = new Map();
    const node = selector => {
      if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', clientWidth: 0, clientHeight: 0, querySelector: () => null, querySelectorAll: () => [] });
      return nodes.get(selector);
    };
    globalThis.document = { activeElement: null, querySelector: node, querySelectorAll: () => [] };
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; Object.assign(R.RS, controls); R.forgetResults(); });
    Object.assign(R.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
    R.forgetResults();
    R.renderResults(ctx);
    const signedIn = node('#rheroL').innerHTML;
    R.renderResults(after);
    assert.notEqual(node('#rheroL').innerHTML, signedIn, 'sign-out must rerender beyond the chart status');
    assert.match(node('#rheroL').innerHTML, /unknown while signed out/);
    for (const [selector, element] of nodes) assertSignedOut(element.innerHTML, selector);
  });
}
