import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { authShapes, nativeAuthShapes, authResponse, reasons, widths, screens, pageFixture } from './fixtures/signed-out-cases.mjs';
import { nativeAuthPaths, parseSignedOutArgs, planSignedOutMatrix } from '../scripts/signed-out-plan.mjs';
import { acceptRead } from '../contracts/read.mjs';
import { freshPageSession } from './fixtures/board-session.mjs';
const { readJSON, classifyResponse, createBoardSession, boardSession, readFailure, AUTH_FAILURE } = await import('../public/joe/transport.js');
const { createFeed } = await import('../public/joe/feed.js');
const { cellReason } = await import('../public/joe/health.js');
const account = await import('../public/joe/account.js?joed179');

const browser = readFileSync(new URL('../scripts/browser/signed-out-pages.mjs', import.meta.url), 'utf8');
// Evaluate the browser's actual inputs/CLI wiring, stopping before any server
// or browser starts. A new native shape must enter this plan and the invariant.
const bootstrap = browser.slice(browser.indexOf('const nativeShapes ='), browser.indexOf('const f ='));
function plan(mode) {
  const result = runInNewContext(`${bootstrap}\nplan`, { nativeAuthShapes, widths, reasons, screens,
    parseSignedOutArgs, planSignedOutMatrix, process: { argv: ['node', 'signed-out-pages.mjs', ...(mode ? [`--${mode}`] : [])] }, console: { log() {} } });
  // The endpoint array originates in the VM; compare data, not realm prototypes.
  return JSON.parse(JSON.stringify(result));
}

test('JOED-179 (a): full reproduces all 2,496 signed-out DOM cases exactly', () => {
  const full = plan('full');
  assert.equal(full.caseCount, 2496);
  assert.equal(full.matrixCases, 2432);
  assert.equal(full.opaqueCases, 64);
  assert.equal(full.invariantCases, 0);
  assert.deepEqual(plan(), full, 'no CLI argument keeps the full audit');
  for (const view of full.views) {
    assert.deepEqual(view.matrix.map(entry => entry.shape), nativeAuthShapes);
    for (const entry of view.matrix) assert.deepEqual(entry.reasons, [null, ...reasons]);
  }
});

test('JOED-179 (b): subset including the cross-shape DOM invariant costs at most 25% of full', () => {
  const subset = plan('subset'), full = plan('full');
  assert.equal(subset.caseCount, 544);
  assert.equal(subset.matrixCases, 416);
  assert.equal(subset.opaqueCases, 64);
  assert.equal(subset.invariantCases, 64);
  assert.ok(subset.caseCount <= full.caseCount / 4);
  for (const view of subset.views) for (const entry of view.matrix) {
    assert.deepEqual(entry.reasons, entry.shape === view.fullShape ? [null, ...reasons] : [null, view.sampledReason]);
  }
});

test('JOED-179 plan: subset retains every opaque endpoint/screen and native shape/screen invariant', () => {
  const subset = plan('subset');
  for (const view of subset.views) {
    const endpoints = [...new Set(view.opaque.map(c => c.endpoint))];
    assert.equal(endpoints.length, 8);
    assert.equal(view.opaque.length, endpoints.length * screens.length);
    for (const endpoint of endpoints) for (const screen of screens) {
      assert.equal(view.opaque.filter(c => c.endpoint === endpoint && c.screen === screen).length, 1);
    }
    assert.equal(view.invariant.length, nativeAuthShapes.length * screens.length);
    for (const shape of nativeAuthShapes) for (const screen of screens) {
      assert.equal(view.invariant.filter(c => c.shape === shape && c.screen === screen).length, 1);
    }
  }
  assert.match(browser, /if \(width > 700\) for \(const auth of \['401', 'opaque redirect', 'HTML'\]\)/);
});

test('JOED-179 (d): full shapes cover distinct response paths regardless of shape ordering', () => {
  const subset = plan('subset');
  assert.deepEqual(Object.keys(nativeAuthPaths).sort(), [...nativeAuthShapes].sort(), 'every native shape has an explicit path');
  assert.deepEqual(subset.views.map(view => view.fullShape), ['302 to SSO', '401']);
  assert.deepEqual(subset.views.map(view => nativeAuthPaths[view.fullShape]), ['redirect', 'status']);
  assert.ok(new Set(subset.views.map(view => nativeAuthPaths[view.fullShape])).size >= 2);
  const reordered = planSignedOutMatrix({ mode: 'subset', widths, shapes: [...nativeAuthShapes].reverse(), reasons, screens, endpoints: ['state.json'] });
  assert.deepEqual(reordered.views.map(view => nativeAuthPaths[view.fullShape]), ['redirect', 'status']);
  assert.throws(() => planSignedOutMatrix({ mode: 'subset', widths, shapes: [...nativeAuthShapes, 'new shape'], reasons, screens, endpoints: ['state.json'] }), /Unclassified native auth shape/);
  assert.deepEqual(plan('subset'), subset);
});

test('JOED-179 sampled reasons use distinct real health wording for transport and feed failures', () => {
  const sampled = plan('subset').views.map(view => view.sampledReason);
  assert.deepEqual(sampled, ['refresh_failed', 'feed_not_received']);
  assert.deepEqual(sampled.map(cellReason), ['update failed', 'no data received yet']);
  assert.equal(new Set(sampled.map(cellReason)).size, 2);
});

test('JOED-188: each width clears leaked fixture state and fix13 fails Results from the first read of its fresh generation', async () => {
  const setup = browser.slice(browser.indexOf('    const { width } = view;'), browser.indexOf('    stage = `${width}: every feed gates recovery`;'));
  const interceptor = browser.slice(browser.indexOf('  browser.on(async m => {'), browser.indexOf('  await page.setFetch('));
  const recover = browser.slice(browser.indexOf('  const recover = async () => {'), browser.indexOf('  const go = async screen => {'));
  const cold = browser.slice(browser.indexOf("    nonAuthOnly = 'results.json';"), browser.indexOf('    assert.deepEqual(await page.evaluate(`({'));
  for (const width of widths) {
    let generation = 0, frozen = false, handler;
    const replies = [], failures = [];
    const request = () => handler({ method: 'Fetch.requestPaused', sessionId: 'owned', params: {
      requestId: 'results', request: { method: 'GET', url: 'https://board.example/joe/results.json' } } });
    const context = { assert, URL, Buffer, view: { width }, board: { url: 'https://board.example/joe/' }, f: pageFixture(),
      endpoints: ['results.json'], failures, nativeAuthPaths, visited: new Set(),
      // Reproduce the preceding invariant's reason and leave other overrides
      // dirty too: each width must establish its own baseline before loading.
      reason: 'refresh_failed', shape: 'HTML fragment', expired: true, fail503: true, only: 'state.json', nonAuthOnly: 'account-history.json',
      fleetPaused: null, settingsPaused: null,
      configure: async () => {}, settle: async () => {}, waitFor: async () => {},
      refresh: request, capture: async () => ({ marked: frozen }),
      page: { owns: id => id === 'owned',
        async s(method) { assert.equal(method, 'Page.navigate'); generation++; await request(); },
        async evaluate(source) {
          if (source === 'window.__pageGeneration') return generation;
          if (source.includes('window.__probeTimers.values()')) { generation++; frozen = false; await request(); }
        } },
      browser: { on: callback => { handler = callback; },
        async send(method, response) {
          assert.equal(method, 'Fetch.fulfillRequest');
          replies.push({ generation, ...response });
        } },
    };
    await runInNewContext(`(async () => { ${interceptor}\n${setup} })()`, context);
    assert.ok(replies.length > 0 && replies.every(r => r.responseCode === 200), 'a new width starts with successful baseline reads');
    replies.length = 0;
    frozen = true; context.expired = true; context.only = 'state.json';
    const before = generation;
    await runInNewContext(`(async () => { ${recover}\n${cold} })()`, context);
    assert.equal(generation, before + 1);
    const fresh = replies.filter(r => r.generation === generation);
    assert.ok(fresh.length > 0, 'the probe reload performs its initial Results read');
    for (const reply of fresh) {
      assert.equal(reply.responseCode, 503, 'no successful Results response in the fresh generation');
      const headerReason = reply.responseHeaders.find(h => h.name === 'X-Joe-Feed-Reason')?.value;
      assert.equal(headerReason, undefined, 'the preceding width cannot override the cold reason with a header');
      const accepted = acceptRead('results', { status: reply.responseCode, reason: headerReason,
        payload: JSON.parse(Buffer.from(reply.body, 'base64').toString()) });
      assert.equal(accepted.value, null);
      assert.equal(cellReason(accepted.reason), 'no data received yet');
    }
    assert.deepEqual(failures, []);
  }
});

test('JOED-179 signed-out planner rejects subsets with only one auth path across widths', () => {
  const inputs = { mode: 'subset', widths, shapes: nativeAuthShapes, reasons, screens, endpoints: ['state.json'] };
  for (const changes of [{ shapes: ['302 to SSO', '303 to SSO'] }, { widths: [390] }]) {
    assert.throws(() => planSignedOutMatrix({ ...inputs, ...changes }), /at least two distinct auth paths across widths/);
  }
});

test('JOED-179 signed-out fixture branches follow nativeAuthPaths and reject a mislabelled shape', async () => {
  const response = browser.slice(browser.indexOf('        // Manual 302/303'), browser.indexOf('\n        return;', browser.indexOf('        // Manual 302/303')));
  const reply = async (shape, paths = nativeAuthPaths) => {
    const sent = [];
    await runInNewContext(`(async () => { ${response} })()`, { assert, shape, nativeAuthPaths: paths,
      send: async (...args) => sent.push(args) });
    assert.equal(sent.length, 1);
    return JSON.parse(JSON.stringify(sent[0]));
  };
  for (const shape of nativeAuthShapes) {
    const [status] = await reply(shape);
    assert.equal(status, shape === '303 to SSO' ? 303 : nativeAuthPaths[shape] === 'redirect' ? 302
      : nativeAuthPaths[shape] === 'status' ? Number(shape) : 200);
  }
  // With the classification changed, the fixture must stop sending HTML.
  // A duplicate shape list silently ignores this mislabel and fails this test.
  await assert.rejects(reply('HTML body', { ...nativeAuthPaths, 'HTML body': 'status' }), /Invalid status auth shape/);
  await assert.rejects(reply('unknown'), /Unclassified native auth shape/);
});

test('JOED-179 (e) transport: only status and redirected vary across native auth shapes', async () => {
  const subset = plan('subset');
  assert.deepEqual(subset.shapes, authShapes.filter(shape => shape !== 'followed cross-origin redirect'));
  for (const view of subset.views) assert.deepEqual(view.matrix.map(entry => entry.shape), subset.shapes);
  const endpoints = [...new Set(subset.views[0].opaque.map(c => c.endpoint))];
  for (const shape of subset.shapes) for (const endpoint of endpoints) {
    const url = `https://board.example/joe/${endpoint}`;
    const response = await readJSON(url, {}, { fetcher: async (_url, init) => {
      assert.equal(init.redirect, 'manual');
      return authResponse(shape);
    } });
    const status = shape === '303 to SSO' ? 303 : ['302 to SSO', 'opaqueredirect'].includes(shape) ? 302 : shape === '403' ? 403 : 401;
    const { at, ...fields } = response;
    assert.ok(Number.isFinite(at), 'only the monotonic receipt timestamp is incidental');
    assert.deepEqual(fields, { status, ...(shape === 'opaqueredirect' ? { redirected: true } : {}),
      auth: true, clock: null, evidence: AUTH_FAILURE }, `${shape}/${endpoint}: no headers, body or reason can leak through`);
    const session = createBoardSession();
    let notifications = 0;
    session.subscribe(() => notifications++);
    const accepted = session.accept(url, response);
    session.observe(url, response);
    assert.deepEqual({ evidence: response.evidence, classification: classifyResponse(url, response),
      reason: readFailure(response), signedOut: session.signedOut(), accepting: session.accepting(),
      epoch: session.epoch(), notifications, accepted },
    { evidence: AUTH_FAILURE, classification: AUTH_FAILURE, reason: 'auth_required', signedOut: true,
      accepting: false, epoch: 1, notifications: 1, accepted: false }, `${shape}/${endpoint}`);
  }
});

test('JOED-179 (e) page: feed read() freezes before accepting any native auth body', async t => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: undefined });
  t.after(() => { if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker); else delete globalThis.Worker; });
  let shape, requested;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'manual'); requested.push(String(url)); return authResponse(shape);
  });
  const routes = { refreshState: ['state.json'], refreshHistory: ['history.json', 'history-continuity.json'],
    refreshResults: ['results.json'], refreshFleet: ['fleet-config.json'], refreshActions: ['fleet-config/actions.json'] };
  for (shape of plan('subset').shapes) for (const [method, paths] of Object.entries(routes)) {
    requested = [];
    const session = createBoardSession(), changes = [];
    const feed = createFeed(kind => changes.push(kind), () => {}, '', { session });
    try {
      const before = feed.select();
      await feed[method]();
      assert.deepEqual(requested.sort(), paths.map(path => `./${path}`).sort());
      assert.equal(session.signedOut(), true, `${shape}/${method}`);
      assert.equal(session.epoch(), 1);
      assert.deepEqual(changes, ['session'], 'no data notification after an auth refusal');
      assert.strictEqual(feed.select(), before, 'page keeps its exact selected snapshot');
      assert.deepEqual(feed.feeds, { data: null, history: null, results: null, 'fleet-config': null });
    } finally { feed.stop(); }
  }
});

test('JOED-179 (e) workers: real history and account replies freeze through the page hand-offs', async t => {
  const old = new Map(['Worker', 'self', 'JoeVersion'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let shape, requested;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'manual'); requested.push(String(url)); return authResponse(shape);
  });
  for (shape of plan('subset').shapes) for (const route of ['history', 'results', 'account']) {
    requested = [];
    const messages = [];
    let worker;
    globalThis.self = { postMessage(data, transfer) {
      const reply = structuredClone(data, { transfer }); messages.push(reply); worker.onmessage({ data: reply });
    } };
    await import(`../public/joe/${route === 'account' ? 'account' : 'history'}-worker.js?joed179-${shape}-${route}`);
    const handle = self.onmessage;
    globalThis.Worker = class {
      constructor() { worker = this; }
      postMessage(data) { handle({ data }); }
      terminate() {}
    };
    if (route === 'account') {
      const restore = freshPageSession();
      const changes = [];
      const unsubscribe = boardSession.subscribe(() => changes.push('session'));
      globalThis.JoeVersion = { APP_VERSION: 'joed179-test' };
      account.forgetAccountWorker(); account.forgetAccountHistory();
      try {
        assert.equal(await account.refreshAccountHistory(), false);
        assert.equal(boardSession.signedOut(), true, `${shape}: account.js useReply()`);
        assert.equal(boardSession.epoch(), 1);
        assert.deepEqual(changes, ['session']);
        const { ms, ...reply } = messages[0];
        assert.ok(Number.isFinite(ms));
        const status = shape === '303 to SSO' ? 303 : ['302 to SSO', 'opaqueredirect'].includes(shape) ? 302 : shape === '403' ? 403 : 401;
        assert.deepEqual(reply, { evidence: AUTH_FAILURE, kind: 'account', status, reason: 'auth_required', value: null, key: null });
      } finally { account.forgetAccountWorker(); account.forgetAccountHistory(); unsubscribe(); restore(); }
    } else {
      const session = createBoardSession(), changes = [];
      const feed = createFeed(kind => changes.push(kind), () => {}, '', { session });
      try {
        assert.equal(feed.usesWorker(), true);
        const before = feed.select();
        await feed[route === 'history' ? 'refreshHistory' : 'refreshResults']();
        assert.equal(session.signedOut(), true, `${shape}/${route}: feed.js worker.onmessage()`);
        assert.equal(session.epoch(), 1);
        assert.deepEqual(changes, ['session']);
        assert.strictEqual(feed.select(), before);
        const paths = route === 'history' ? ['/joe/history.json', '/joe/history-continuity.json'] : ['/joe/results.json'];
        assert.deepEqual(Object.keys(messages[0].status).sort(), paths.sort());
        for (const [path, status] of Object.entries(messages[0].status)) {
          assert.deepEqual(status, { state: 'auth', evidence: AUTH_FAILURE, auth: true, reason: 'auth_required',
            ...(path === '/joe/history-continuity.json' ? {} : { document: null }) });
        }
        assert.deepEqual(messages[0].auth, Object.fromEntries(paths.map(path => [path, true])));
        assert.equal(messages[0].kind, 'blocked');
        assert.equal(messages[0].feed, route);
      } finally { feed.stop(); }
    }
    assert.deepEqual(requested.sort(), (route === 'history'
      ? ['/joe/history.json', '/joe/history-continuity.json'] : [`/joe/${route === 'account' ? 'account-history' : route}.json`]).sort());
    assert.equal(messages.length, 1);
  }
});

test('JOED-179 (f): unknown and ambiguous modes are rejected before startup', () => {
  assert.equal(parseSignedOutArgs([]), 'full');
  assert.equal(parseSignedOutArgs(['--full']), 'full');
  assert.equal(parseSignedOutArgs(['--subset']), 'subset');
  for (const args of [['--unknown'], ['--subset', '--full'], ['--full', 'extra']]) {
    assert.throws(() => parseSignedOutArgs(args), /use --full or --subset/);
  }
  assert.throws(() => planSignedOutMatrix({ mode: 'unknown' }), /Unknown signed-out matrix mode/);
  assert.throws(() => plan('unknown'), /use --full or --subset/);
  assert.ok(browser.indexOf('parseSignedOutArgs(process.argv.slice(2))') < browser.indexOf('await startBoard('));
});

// Run the actual browser matrix/invariant loops with a synthetic check. This
// tests execution wiring and the invariant's negative case without a browser.
async function executeMatrix(mode, { varyShape = false, missingVisit = null } = {}) {
  const selected = plan(mode), observed = [];
  const endpoints = [...new Set(selected.views[0].opaque.map(c => c.endpoint))], visited = new Set();
  const loop = browser.slice(browser.indexOf('    for (const { shape: auth, reasons: plannedReasons }'), browser.indexOf('\n  }\n  assert.equal(checked, plan.caseCount'));
  for (const view of selected.views) {
    let generation = 1;
    const context = { assert, plan: selected, view, width: view.width, shape: null, reason: null, only: null, stage: '',
      console: { log() {} }, go: async () => {}, refresh: async () => {}, settle: async () => {},
      page: { evaluate: async source => source === 'window.__pageGeneration' ? generation : true,
        s: async method => { assert.equal(method, 'Page.reload'); generation++; } }, waitFor: async () => {} };
    context.check = async (screen, tag, compareFrozen = () => {}) => {
      observed.push({ width: view.width, shape: context.shape, reason: context.reason, only: context.only, screen, tag });
      for (const endpoint of context.only ? [context.only] : endpoints) {
        const visit = `${context.shape}/${endpoint}`;
        if (visit !== missingVisit) visited.add(visit);
      }
      compareFrozen({ dom: varyShape ? context.shape : 'complete signed-out DOM', inert: true });
    };
    await runInNewContext(`(async () => { ${loop} })()`, context);
  }
  assert.equal(observed.length, selected.caseCount);
  const visitation = browser.slice(browser.indexOf('  for (const auth of nativeShapes) for (const endpoint of endpoints)'), browser.indexOf('\n  console.log(`${checked} signed-out browser cases passed'));
  assert.ok(visitation, 'execute the actual runtime endpoint assertion');
  runInNewContext(visitation, { assert, nativeShapes: nativeAuthShapes, endpoints, visited });
  return observed;
}

test('JOED-179 (c) browser wiring: both modes execute their plan and reject a missing native shape/endpoint visit', async () => {
  for (const mode of ['full', 'subset']) {
    const observed = await executeMatrix(mode);
    for (const width of widths) for (const shape of nativeAuthShapes) {
      assert.ok(observed.some(c => c.width === width && c.shape === shape && c.only === null));
    }
    for (const view of plan(mode).views) for (const { endpoint, screen } of view.opaque) {
      assert.equal(observed.filter(c => c.width === view.width && c.only === endpoint && c.screen === screen).length, 1);
    }
    await assert.rejects(executeMatrix(mode, { missingVisit: 'HTML fragment/account-history.json' }), /HTML fragment\/account-history.json: actual auth response exercised/);
  }
  await assert.rejects(executeMatrix('subset', { varyShape: true }), /signed-out DOM must be identical across native auth shapes/);
});
