import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { authShapes, nativeAuthShapes, authResponse, reasons, widths, screens, pageFixture } from './fixtures/signed-out-cases.mjs';
import { nativeAuthPaths, parseSignedOutArgs, parseSignedOutOptions, planSignedOutMatrix, shardSignedOutPlan, signedOutCaseTags,
  assertSignedOutTransportCoverage, mergeSignedOutShards } from '../scripts/signed-out-plan.mjs';
import { acceptRead } from '../contracts/read.mjs';
import { freshPageSession } from './fixtures/board-session.mjs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { runSignedOutShards } from '../scripts/browser/signed-out-shards.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
const { readJSON, classifyResponse, createBoardSession, boardSession, readFailure, AUTH_FAILURE } = await import('../public/joe/transport.js');
const { createFeed } = await import('../public/joe/feed.js');
const { cellReason } = await import('../public/joe/health.js');
const account = await import('../public/joe/account.js?joed179');

const browser = readFileSync(new URL('../scripts/browser/signed-out-pages.mjs', import.meta.url), 'utf8');
// Evaluate the browser's actual inputs/CLI wiring, stopping before any server
// or browser starts. A new native shape must enter this plan and the invariant.
const bootstrap = browser.slice(browser.indexOf('const nativeShapes ='), browser.indexOf('const f ='));
function plan(mode, extra = []) {
  const result = runInNewContext(`${bootstrap}\nplan`, { nativeAuthShapes, widths, reasons, screens,
    parseSignedOutOptions, planSignedOutMatrix, shardSignedOutPlan,
    process: { argv: ['node', 'signed-out-pages.mjs', ...(mode ? [`--${mode}`] : []), ...extra] }, console: { log() {} } });
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
  assert.ok(browser.indexOf('parseSignedOutOptions(process.argv.slice(2))') < browser.indexOf('await startBoard('));
  assert.ok(browser.indexOf('if (options.parallel) process.exit(await runSignedOutShards(') < browser.indexOf('await startBoard('), 'the parallel runner starts no server or browser of its own');
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
  assert.deepEqual(observed.map(c => c.tag), signedOutCaseTags(selected), 'the planned tags are exactly the executed check() tags');
  assert.ok(browser.includes('if (!options.shard) assertSignedOutTransportCoverage(visited, nativeShapes, endpoints);'), 'the runtime endpoint assertion runs unsharded');
  assertSignedOutTransportCoverage(visited, nativeAuthShapes, endpoints);
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

test('JOED-190 options: --parallel and --shard need the full matrix and well-formed counts', () => {
  assert.deepEqual(parseSignedOutOptions(['--full', '--parallel', '4']), { mode: 'full', parallel: 4, shard: null, report: null });
  assert.deepEqual(parseSignedOutOptions(['--parallel', '4']), { mode: 'full', parallel: 4, shard: null, report: null });
  assert.deepEqual(parseSignedOutOptions(['--full', '--shard', '2/4', '--report', '/tmp/r.json']),
    { mode: 'full', parallel: null, shard: { index: 2, count: 4 }, report: '/tmp/r.json' });
  assert.equal(parseSignedOutArgs(['--full', '--parallel', '4']), 'full');
  for (const args of [['--subset', '--parallel', '4'], ['--subset', '--shard', '1/2', '--report', 'r'], ['--parallel', '1'], ['--parallel', '17'],
    ['--parallel', '04'], ['--parallel'], ['--parallel', '--full'], ['--parallel', '2', '--parallel', '3'], ['--shard', '1/4'], ['--shard', '5/4', '--report', 'r'],
    ['--shard', '0/4', '--report', 'r'], ['--shard', '1/1', '--report', 'r'], ['--report', 'r'], ['--parallel', '4', '--shard', '1/4', '--report', 'r']]) {
    assert.throws(() => parseSignedOutOptions(args), /use --full or --subset/, args.join(' '));
  }
  assert.equal(plan('full', ['--parallel', '4']).caseCount, 2496, 'the parallel runner merges against the full plan');
  assert.throws(() => plan('subset', ['--parallel', '4']), /shards need the full matrix/);
});

test('JOED-190 shards: every full case lands in exactly one shard, in the unsharded order', () => {
  const full = plan('full'), expected = signedOutCaseTags(full);
  assert.equal(expected.length, 2496);
  assert.equal(new Set(expected).size, expected.length);
  for (let count = 2; count <= 16; count++) {
    const shards = Array.from({ length: count }, (_, i) => shardSignedOutPlan(full, i + 1, count));
    const tags = shards.flatMap(signedOutCaseTags);
    assert.deepEqual(tags, expected, `${count} shards concatenate to the full plan`);
    assert.equal(shards.reduce((n, shard) => n + shard.caseCount, 0), full.caseCount);
    for (const shard of shards) {
      assert.ok(shard.caseCount > 0 && shard.views.length > 0);
      assert.equal(signedOutCaseTags(shard).length, shard.caseCount);
      assert.equal(shard.invariantCases, 0);
    }
  }
  const four = Array.from({ length: 4 }, (_, i) => plan('full', ['--shard', `${i + 1}/4`, '--report', 'r']));
  assert.deepEqual(four.map(shard => shard.views.map(view => `${view.width}:${view.matrix.length}+${view.opaque.length}`)),
    [['390:4+0'], ['390:4+32'], ['1440:4+0'], ['1440:4+32']], 'four shards: one width each, four auth shapes, opaque cases once per width');
  assert.throws(() => shardSignedOutPlan(plan('subset'), 1, 2), /require the full matrix/);
  assert.throws(() => shardSignedOutPlan(full, 1, 17), /shard count/);
  assert.throws(() => shardSignedOutPlan(full, 3, 2), /shard index/);
});

test('JOED-190 merge: rejects a missing, duplicated, reordered or foreign shard and a missing transport visit', () => {
  const full = plan('full'), count = 4, endpoints = [...new Set(full.views[0].opaque.map(c => c.endpoint))];
  const visitedAll = nativeAuthShapes.flatMap(shape => endpoints.map(endpoint => `${shape}/${endpoint}`));
  const reports = () => Array.from({ length: count }, (_, i) => {
    const tags = signedOutCaseTags(shardSignedOutPlan(full, i + 1, count));
    return { schema: 'joedesk.signed-out-shard.v1', shard: `${i + 1}/${count}`, caseCount: tags.length, tags,
      visited: visitedAll.filter((_, n) => n % count === i) };
  });
  const options = { shapes: nativeAuthShapes, endpoints };
  assert.equal(mergeSignedOutShards(full, reports(), options), 2496);
  const cases = {
    'missing case': r => { r[1].tags.pop(); r[1].caseCount--; },
    'reordered cases': r => { r[2].tags.reverse(); },
    'duplicated case': r => { r[0].tags[1] = r[0].tags[0]; },
    'foreign schema': r => { r[3].schema = 'other'; },
    'wrong shard label': r => { r[3].shard = '1/4'; },
    'missing visit': r => { for (const report of r) report.visited = report.visited.filter(v => v !== 'HTML fragment/account-history.json'); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const r = reports(); mutate(r);
    assert.throws(() => mergeSignedOutShards(full, r, options), /planned cases|exactly once|foreign report|actual auth response exercised/, name);
  }
  assert.throws(() => mergeSignedOutShards(full, reports().slice(0, 3), options), /planned cases|exactly once|foreign report/, 'a lost shard fails the merge');
});

test('JOED-190 runner: spawns every shard, merges their reports and fails on a failed or incomplete shard', async t => {
  const dir = scratch('joed190-shards-');
  t.after(() => discard(dir, 'JOED-190 shard runner test'));
  const full = plan('full'), endpoints = [...new Set(full.views[0].opaque.map(c => c.endpoint))];
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(full));
  // A stand-in for signed-out-pages.mjs --full --shard K/N --report FILE that
  // reports its planned tags; JOED190_FAKE selects a failing variant.
  const fake = join(dir, 'fake-shard.mjs');
  writeFileSync(fake, `import { readFileSync, writeFileSync } from 'node:fs';
import { shardSignedOutPlan, signedOutCaseTags } from ${JSON.stringify(new URL('../scripts/signed-out-plan.mjs', import.meta.url).href)};
const args = process.argv.slice(2);
if (args[0] !== '--full' || args[1] !== '--shard' || args[3] !== '--report' || args.length !== 5) process.exit(9);
const [index, count] = args[2].split('/').map(Number);
const full = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'plan.json'))}, 'utf8'));
const tags = signedOutCaseTags(shardSignedOutPlan(full, index, count));
const mode = process.env.JOED190_FAKE ?? '';
if (mode === 'exit' && index === 2) process.exit(3);
if (mode === 'hang') { writeFileSync(${JSON.stringify(dir)} + '/pid-' + index, String(process.pid)); setInterval(() => {}, 1000); }
else {
if (mode === 'drop' && index === 3) tags.pop();
const visited = ${JSON.stringify(nativeAuthShapes)}.flatMap(shape => ${JSON.stringify(endpoints)}.map(endpoint => shape + '/' + endpoint));
console.log('fake shard ' + index + '/' + count);
writeFileSync(args[4], JSON.stringify({ schema: 'joedesk.signed-out-shard.v1', shard: index + '/' + count, caseCount: tags.length, tags, visited }), { flag: 'wx' });
}
`);
  const run = async (variant, signal) => {
    const prior = process.env.JOED190_FAKE, priorTemp = process.env.RUNNER_TEMP;
    process.env.JOED190_FAKE = variant; process.env.RUNNER_TEMP = dir;
    try { return await runSignedOutShards({ count: 4, plan: full, shapes: nativeAuthShapes, endpoints, script: fake, signal }); }
    finally {
      if (prior === undefined) delete process.env.JOED190_FAKE; else process.env.JOED190_FAKE = prior;
      if (priorTemp === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = priorTemp;
    }
  };
  assert.equal(await run(''), 0, 'four complete shards merge');
  assert.equal(await run('exit'), 1, 'a failed shard fails the phase');
  assert.equal(await run('drop'), 1, 'a shard that skipped a case fails the merge');
  // Cancellation stops every running shard and waits for it before returning.
  const controller = new AbortController();
  const pids = [1, 2, 3, 4].map(i => join(dir, `pid-${i}`));
  const watcher = setInterval(() => { if (pids.every(existsSync)) controller.abort(); }, 20);
  let code;
  try { code = await run('hang', controller.signal); } finally { clearInterval(watcher); }
  assert.equal(code, 1, 'a cancelled phase fails');
  for (const file of pids) {
    assert.throws(() => process.kill(Number(readFileSync(file, 'utf8')), 0), { code: 'ESRCH' }, `${file}: shard stopped before the runner returned`);
  }
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('joedesk-signed-out-shards-')), [], 'shard reports directory removed');
  assert.equal(await run('', AbortSignal.abort()), 1, 'an already-aborted runner starts no shard');
  // A shard that cannot start stops and awaits the shards already running.
  for (const file of pids) rmSync(file, { force: true });
  const startFailure = (command, args, options) => args.includes('3/4')
    ? spawn(join(dir, 'missing-node'), args, options) : spawn(command, args, options);
  process.env.JOED190_FAKE = 'hang'; process.env.RUNNER_TEMP = dir;
  try {
    assert.equal(await runSignedOutShards({ count: 4, plan: full, shapes: nativeAuthShapes, endpoints, script: fake, spawnShard: startFailure }), 1);
  } finally { delete process.env.JOED190_FAKE; delete process.env.RUNNER_TEMP; }
  for (const file of pids.filter(existsSync)) {
    assert.throws(() => process.kill(Number(readFileSync(file, 'utf8')), 0), { code: 'ESRCH' }, `${file}: started shard stopped after a start failure`);
  }
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('joedesk-signed-out-shards-')), [], 'reports directory removed after a start failure');
  // A real SIGTERM to the runner process (CI job cancellation) does the same.
  for (const file of pids) rmSync(file, { force: true });
  const parent = join(dir, 'parent.mjs');
  writeFileSync(parent, `import { runSignedOutShards } from ${JSON.stringify(new URL('../scripts/browser/signed-out-shards.mjs', import.meta.url).href)};
import { readFileSync } from 'node:fs';
const full = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'plan.json'))}, 'utf8'));
process.exit(await runSignedOutShards({ count: 4, plan: full, shapes: ${JSON.stringify(nativeAuthShapes)}, endpoints: ${JSON.stringify(endpoints)}, script: ${JSON.stringify(fake)} }));
`);
  const child = spawn(process.execPath, [parent], { stdio: 'ignore', env: { ...process.env, JOED190_FAKE: 'hang', RUNNER_TEMP: dir } });
  const exited = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  await new Promise(resolve => { const poll = setInterval(() => { if (pids.every(existsSync)) { clearInterval(poll); resolve(); } }, 20); });
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null }, 'SIGTERM fails the phase with 143 after the shards exit');
  for (const file of pids) {
    assert.throws(() => process.kill(Number(readFileSync(file, 'utf8')), 0), { code: 'ESRCH' }, `${file}: no orphaned shard after SIGTERM`);
  }
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('joedesk-signed-out-shards-')), [], 'reports directory removed after SIGTERM');
});
