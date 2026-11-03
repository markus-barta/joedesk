import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { authShapes, nativeAuthShapes, authResponse, reasons, widths, screens } from './fixtures/signed-out-cases.mjs';
import { parseSignedOutArgs, planSignedOutMatrix } from '../scripts/signed-out-plan.mjs';
const { readJSON, classifyResponse, createBoardSession, readFailure, AUTH_FAILURE } = await import('../public/joe/transport.js');

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

test('JOED-179 (c): subset visits every native shape × endpoint at every width and preserves the opaque sweep', () => {
  const subset = plan('subset');
  for (const view of subset.views) {
    const endpoints = [...new Set(view.opaque.map(c => c.endpoint))];
    assert.equal(endpoints.length, 8);
    const visits = new Set();
    for (const entry of view.matrix) for (const reason of entry.reasons) for (const screen of subset.screens) {
      // Matrix cases expire all protected reads, as the browser's only=null
      // and refresh() do. Opaque cases then isolate each endpoint separately.
      for (const endpoint of endpoints) visits.add(`${entry.shape}/${endpoint}`);
      assert.ok(reason === null || reasons.includes(reason));
      assert.ok(screens.includes(screen));
    }
    for (const shape of nativeAuthShapes) for (const endpoint of endpoints) assert.ok(visits.has(`${shape}/${endpoint}`));
    assert.equal(view.opaque.length, endpoints.length * screens.length);
    for (const endpoint of endpoints) for (const screen of screens) {
      assert.equal(view.opaque.filter(c => c.endpoint === endpoint && c.screen === screen).length, 1);
    }
    assert.equal(view.invariant.length, nativeAuthShapes.length * screens.length);
    for (const shape of nativeAuthShapes) for (const screen of screens) {
      assert.equal(view.invariant.filter(c => c.shape === shape && c.screen === screen).length, 1);
    }
  }
  assert.match(browser, /for \(const auth of nativeShapes\) for \(const endpoint of endpoints\) assert\.ok\(visited\.has/);
  assert.match(browser, /if \(width > 700\) for \(const auth of \['401', 'opaque redirect', 'HTML'\]\)/);
});

test('JOED-179 (d): full shapes rotate deterministically between the two widths', () => {
  const subset = plan('subset');
  assert.notEqual(subset.views[0].fullShape, subset.views[1].fullShape);
  assert.deepEqual(subset.views.map(view => view.fullShape), nativeAuthShapes.slice(0, widths.length));
  assert.deepEqual(plan('subset'), subset);
});

test('JOED-179 (e): every planned native shape classifies identically through the page transport and session', async () => {
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
async function executeMatrix(mode, varyShape = false) {
  const selected = plan(mode), observed = [];
  const loop = browser.slice(browser.indexOf('    for (const { shape: auth, reasons: plannedReasons }'), browser.indexOf('\n  }\n  assert.equal(checked, plan.caseCount'));
  for (const view of selected.views) {
    let generation = 1;
    const context = { assert, plan: selected, view, width: view.width, shape: null, reason: null, only: null, stage: '',
      console: { log() {} }, go: async () => {}, refresh: async () => {}, settle: async () => {},
      page: { evaluate: async source => source === 'window.__pageGeneration' ? generation : true,
        s: async method => { assert.equal(method, 'Page.reload'); generation++; } }, waitFor: async () => {} };
    context.check = async (screen, tag, compareFrozen = () => {}) => {
      observed.push({ width: view.width, shape: context.shape, reason: context.reason, only: context.only, screen, tag });
      compareFrozen({ dom: varyShape ? context.shape : 'complete signed-out DOM', inert: true });
    };
    await runInNewContext(`(async () => { ${loop} })()`, context);
  }
  assert.equal(observed.length, selected.caseCount);
  return observed;
}

test('JOED-179 browser wiring: both modes execute their plan, and subset rejects shape-dependent captured DOM', async () => {
  for (const mode of ['full', 'subset']) {
    const observed = await executeMatrix(mode);
    for (const width of widths) for (const shape of nativeAuthShapes) {
      assert.ok(observed.some(c => c.width === width && c.shape === shape && c.only === null));
    }
    for (const view of plan(mode).views) for (const { endpoint, screen } of view.opaque) {
      assert.equal(observed.filter(c => c.width === view.width && c.only === endpoint && c.screen === screen).length, 1);
    }
  }
  await assert.rejects(executeMatrix('subset', true), /signed-out DOM must be identical across native auth shapes/);
});

test('JOED-179 CI: PRs select subset; push and dispatch retain full', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const modeBlock = /^          board_mode=.+\n[^\n]+/m.exec(workflow)?.[0];
  assert.ok(modeBlock);
  assert.match(workflow, /TZ=UTC node scripts\/browser\/signed-out-pages\.mjs "\$board_mode" \|\| status=\$\?/);
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', `${modeBlock}\nprintf '%s' "$board_mode"`],
      { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseSignedOutArgs([result.stdout]), event === 'pull_request' ? 'subset' : 'full');
  }
});
