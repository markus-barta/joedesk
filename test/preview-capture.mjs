import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { openPage } from '../scripts/browser/cdp.mjs';
import { screenshot } from '../scripts/browser/shots.mjs';
import { parseArgs, privateOutput, SECTIONS, inspectSections, serializeSummary, assertValueFree, passed, restrictOrigin, capture } from '../scripts/preview-capture.mjs';

const execute = promisify(execFile);
const BASE = 'http://127.0.0.1:8080/joe/';
const HEALTH = { version: '261019102825.0.0', schemaVersion: 'joedesk.contracts.v2', resultsNotReceived: true };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const opts = out => parseArgs(['--base-url', BASE, '--out', out]);
function temporary(t) {
  const dir = scratch('joed-preview-test-');
  fs.chmodSync(dir, 0o700);
  t.after(() => discard(dir, 'preview capture test'));
  return dir;
}
const complete = options => options.screens.flatMap(screen => options.widths.flatMap(width => options.themes.map(theme => ({
  screen, width, theme, sections: SECTIONS.filter(s => s.screens.includes(screen)).map(s => ({ id: s.id, present: true, nonEmpty: true, states: ['fresh'], invalidStates: 0 })),
}))));

test('preview CLI: defaults, custom widths and optional History use the shared themes', () => {
  const options = opts('/private/capture');
  assert.deepEqual(options.widths, [1440, 390]);
  assert.deepEqual(options.themes, ['light', 'dark']);
  assert.deepEqual(options.screens, ['desk', 'positions', 'settings', 'results']);
  assert.equal(parseArgs(['--base-url', 'http://localhost:80/joe/', '--out', '/private/capture']).baseUrl, 'http://localhost/joe/');
  assert.deepEqual(parseArgs(['--out', '/private/capture', '--base-url', BASE, '--widths', '320,1024,3840', '--themes', 'dark', '--screens', 'history']).screens, ['history']);
});

test('preview CLI: rejects unknown, duplicate, missing and malformed arguments without echoing values', () => {
  const standard = ['--base-url', BASE, '--out', '/private/capture'];
  for (const args of [[], ['--out'], [...standard, '--bad', 'PRIVATE_VALUE'], [...standard, '--out', '/other'],
    ...['319', '3841', '0390', '+390', '390.0', '390,', '390,390', '390, 1440', 'NaN'].map(w => [...standard, '--widths', w]),
    ...['dark,', 'system', 'light,light', 'LIGHT'].map(theme => [...standard, '--themes', theme]),
    ...['settings/', '../../PRIVATE_VALUE', 'desk,desk', ''].map(screen => [...standard, '--screens', screen]),
    ...['file:///joe/', 'https://user:PRIVATE_VALUE@localhost/joe/', BASE + '?account=PRIVATE_VALUE', BASE + '#PRIVATE_VALUE',
      'http://localhost/joe', 'http://localhost/other/', ' http://localhost/joe/', 'http://@localhost/joe/', 'http://localhost/x/../joe/'].map(url => ['--base-url', url, '--out', '/private/capture']),
  ]) {
    assert.throws(() => parseArgs(args), error => error.exitCode === 2 && !error.message.includes('PRIVATE_VALUE'));
  }
});

test('preview permissions: 0755, absent, regular file, symlink and foreign owner exit 2 before browser launch or writes', async t => {
  const root = temporary(t), publicDir = join(root, 'public'), absent = join(root, 'absent'), plain = join(root, 'plain'), link = join(root, 'link');
  fs.mkdirSync(publicDir, { mode: 0o755 }); fs.chmodSync(publicDir, 0o755);
  fs.writeFileSync(plain, 'fixture'); fs.symlinkSync(root, link);
  for (const out of [publicDir, absent, plain, link]) {
    await assert.rejects(capture(opts(out), { launchBrowser: () => assert.fail('browser must not launch') }), e => e.exitCode === 2);
  }
  const uid = process.getuid;
  try {
    process.getuid = () => uid() + 1;
    assert.throws(() => privateOutput(root, ['summary.json']), e => e.exitCode === 2);
  } finally { process.getuid = uid; }
  assert.deepEqual(fs.readdirSync(publicDir), []);
  const result = await execute(process.execPath, ['scripts/preview-capture.mjs', '--base-url', BASE, '--out', publicDir]).catch(e => e);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /no group or other permission bits/);
  assert.deepEqual(fs.readdirSync(publicDir), []);
});

test('preview writer: accepts stricter directories, writes 0600, refuses overwrites, escapes, symlink races and changed permissions', t => {
  const dir = temporary(t), target = join(dir, 'target');
  fs.chmodSync(dir, 0o300);
  const output = privateOutput(dir, ['summary.json', 'desk-390-light.png']);
  fs.chmodSync(dir, 0o700);
  output.write('summary.json', '{}');
  assert.equal(fs.statSync(join(dir, 'summary.json')).mode & 0o777, 0o600);
  assert.throws(() => output.write('summary.json', 'replaced'), /private output write failed/);
  assert.equal(fs.readFileSync(join(dir, 'summary.json'), 'utf8'), '{}');
  assert.throws(() => output.write('../outside', 'bad'), /unexpected output filename/);
  fs.writeFileSync(target, 'untouched');
  fs.symlinkSync(target, join(dir, 'desk-390-light.png'));
  assert.throws(() => output.write('desk-390-light.png', PNG), /private output write failed/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  fs.chmodSync(dir, 0o755);
  assert.throws(() => output.verify(), e => e.exitCode === 2);
  fs.chmodSync(dir, 0o700);
  assert.throws(() => privateOutput(dir, ['summary.json']), e => e.exitCode === 2);
});

test('preview summary.json: allow-list drops a DOM dump full of money, quantities, symbols, account hints, URLs and errors', t => {
  const dir = temporary(t), options = opts(dir), checks = complete(options);
  const dump = {
    textContent: '€ 92871.63 412.87 LEAKSYMBOL DU…9981', innerHTML: '<input value="PRICE_PRIVATE">',
    money: '92871.63', quantity: '412.87', symbol: 'LEAKSYMBOL', accountHint: 'DU…9981',
    url: 'https://external.test/?account=QUERY_PRIVATE', exception: 'ERROR_PRIVATE',
  };
  for (const check of checks) {
    Object.assign(check, dump);
    for (const section of check.sections) Object.assign(section, dump);
    check.sections.push({ id: 'LEAKSYMBOL', ...dump });
  }
  const text = serializeSummary(options, { ...HEALTH, ...dump, feeds: dump }, checks, { permissionsValid: true, ...dump });
  privateOutput(dir, ['summary.json']).write('summary.json', text);
  const onDisk = fs.readFileSync(join(dir, 'summary.json'), 'utf8');
  for (const value of Object.values(dump)) assert.ok(!onDisk.includes(value));
  for (const value of ['92871.63', '412.87', 'LEAKSYMBOL', 'DU…9981', 'QUERY_PRIVATE', 'ERROR_PRIVATE', 'PRICE_PRIVATE']) assert.ok(!onDisk.includes(value));
  const summary = JSON.parse(onDisk);
  assertValueFree(summary);
  assert.equal(passed(summary), true);
  assert.deepEqual(summary.health, { version: HEALTH.version, schemaVersion: HEALTH.schemaVersion });
});

test('preview summary: rejects injected metadata/state strings and extra serialized fields; missing combinations and all error counts fail', () => {
  const options = opts('/private/capture'), checks = complete(options);
  checks[0].sections[0].states.push('SYMBOL_PRIVATE');
  const summary = JSON.parse(serializeSummary(options, { version: 'PRICE_PRIVATE', schemaVersion: 'ACCOUNT_PRIVATE' }, checks, { permissionsValid: true }));
  assert.ok(!JSON.stringify(summary).includes('PRIVATE'));
  assert.equal(summary.checks[0].sections[0].invalidStates, 1);
  assert.equal(passed(summary), false);
  assertValueFree(summary);
  const good = JSON.parse(serializeSummary(options, HEALTH, complete(options), { permissionsValid: true }));
  for (const mutate of [s => { s.text = 'PRIVATE'; }, s => { s.health.account = 'PRIVATE'; }, s => { s.checks[0].sections[0].states = ['PRIVATE']; },
    s => { s.checks[0].sections[0].id = 'PRIVATE'; }, s => { s.checks[0].pageErrors = 'PRIVATE'; }]) {
    const copy = structuredClone(good); mutate(copy); assert.throws(() => assertValueFree(copy));
  }
  for (const key of ['pageErrors', 'consoleErrors', 'blockedRequests', 'interceptionErrors', 'checkErrors']) {
    assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options), { permissionsValid: true, [key]: 1 }))), false, key);
  }
  assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options).slice(1), { permissionsValid: true }))), false);
  assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options)))), false);
});

function dom({ empty = false, missing = false, state = 'fresh', nodes = true } = {}) {
  const leaf = { textContent: empty ? ' — ' : 'VALUE_PRIVATE', getAttribute: () => state };
  return { querySelector: () => missing ? null : { getAttribute: () => null, querySelectorAll: selector => selector === '[data-state]' ? [leaf] : nodes ? [leaf] : [] } };
}
test('preview sections: only a rendered Results empty with feed_not_received is allowed; missing sections and unknown states fail', () => {
  const table = SECTIONS.filter(s => ['results', 'positions', 'desk-hero'].includes(s.id));
  const inspect = (notReceived, document) => inspectSections(table, notReceived, document);
  const empty = inspect(true, dom({ empty: true, state: 'not reported' }));
  assert.deepEqual(empty.map(s => s.allowedEmpty), [false, false, true]);
  assert.ok(empty.every(s => s.nonEmpty === false));
  assert.ok(inspect(false, dom({ empty: true })).every(s => !s.allowedEmpty));
  assert.ok(inspect(true, dom({ missing: true })).every(s => !s.allowedEmpty && !s.present));
  assert.ok(inspect(true, dom({ nodes: false })).every(s => !s.allowedEmpty));
  const poisoned = inspect(true, dom({ state: 'ACCOUNT_PRIVATE' }));
  assert.ok(poisoned.every(s => s.invalidStates === 1 && s.states.length === 0));
  assert.ok(!JSON.stringify(poisoned).includes('PRIVATE'));
});

function fakeBrowser({ failFetch = null, failScreenshot = false } = {}) {
  const listeners = new Set(), calls = [];
  let mobile = false;
  const browser = {
    calls, on: fn => listeners.add(fn), off: fn => listeners.delete(fn),
    emit: async message => { await Promise.all([...listeners].map(fn => fn(message))); },
    async send(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === 'Fetch.enable' && failFetch === sessionId) throw new Error('INTERCEPTION_PRIVATE');
      if (method === 'Target.createTarget') return { targetId: 'page-target' };
      if (method === 'Target.attachToTarget') return { sessionId: 'page' };
      if (method === 'Emulation.setTouchEmulationEnabled') mobile = params.enabled;
      if (method === 'Page.captureScreenshot') {
        if (failScreenshot) throw new Error('SCREENSHOT_PRIVATE');
        return { data: PNG.toString('base64') };
      }
      if (method === 'Runtime.evaluate') {
        const e = params.expression;
        let value = true;
        if (e.includes('inspectSections(')) value = runInNewContext(e, { document: dom() });
        else if (e.includes('const response = await fetch')) value = HEALTH;
        else if (e.includes("matchMedia('(hover: hover)')")) value = mobile ? 'no hover, coarse' : 'hover, fine';
        else if (e.includes('Math.ceil(document.documentElement.scrollHeight)')) value = 1000;
        else if (e.includes('getBoundingClientRect')) value = { x: 16, y: 300, width: 358, height: 400, scale: 1 };
        return { result: { value } };
      }
      return {};
    },
    async close() {},
  };
  return browser;
}
test('preview network: Fetch blocks cross-origin, cross-port, malformed and redirect destinations on page and worker targets', async () => {
  const browser = fakeBrowser(), page = await openPage(browser), counts = { blockedRequests: 0, interceptionErrors: 0 };
  const restriction = await restrictOrigin(browser, page, BASE, counts);
  for (const sessionId of ['page', 'worker']) {
    if (sessionId === 'worker') await browser.emit({ method: 'Target.attachedToTarget', sessionId: 'page', params: { sessionId, targetInfo: { type: 'worker', targetId: 'worker-target' } } });
    for (const url of [BASE, BASE + '?private=QUERY_PRIVATE', 'http://127.0.0.1:8081/joe/', 'https://external.test/?private=QUERY_PRIVATE', 'file:///private', 'malformed']) {
      await browser.emit({ method: 'Fetch.requestPaused', sessionId, params: { requestId: url, request: { url } } });
    }
  }
  await restriction.drain(); restriction.dispose();
  assert.equal(counts.blockedRequests, 8);
  assert.equal(browser.calls.filter(c => c.method === 'Fetch.failRequest').length, 8);
  assert.equal(browser.calls.filter(c => c.method === 'Fetch.continueRequest').length, 4);
  assert.ok(browser.calls.some(c => c.method === 'Fetch.enable' && c.params.patterns[0].urlPattern === '*' && c.sessionId === 'worker'));
  assert.ok(browser.calls.some(c => c.method === 'Runtime.enable' && c.sessionId === 'worker'));
});

test('preview network: strict interception failure rejects the page and never resumes an unprotected worker', async () => {
  const failed = fakeBrowser({ failFetch: 'page' }), failedPage = await openPage(failed);
  await assert.rejects(restrictOrigin(failed, failedPage, BASE, {}));
  assert.equal(failedPage.routing.errors, 1);
  const browser = fakeBrowser({ failFetch: 'worker' }), page = await openPage(browser);
  await restrictOrigin(browser, page, BASE, {});
  await browser.emit({ method: 'Target.attachedToTarget', sessionId: 'page', params: { sessionId: 'worker', targetInfo: { type: 'worker', targetId: 'worker-target' } } });
  assert.equal(page.routing.errors, 1);
  assert.ok(browser.calls.some(c => c.method === 'Target.closeTarget' && c.params.targetId === 'worker-target'));
  assert.ok(!browser.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger' && c.sessionId === 'worker'));
});

test('preview capture: the orchestration writes only named 0600 PNGs and a value-free summary using shared capture helpers', async t => {
  const dir = temporary(t), browser = fakeBrowser(), lines = [];
  const options = { ...opts(dir), widths: [390], themes: ['light'] };
  assert.equal(await capture(options, { launchBrowser: async args => { assert.equal(args.profileParent, fs.realpathSync(dir)); return browser; }, log: line => lines.push(line) }), 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['desk-390-light.png', 'positions-390-light.png', 'results-390-light.png', 'settings-390-light.png', 'summary.json']);
  for (const file of fs.readdirSync(dir)) assert.equal(fs.statSync(join(dir, file)).mode & 0o777, 0o600);
  const summary = JSON.parse(fs.readFileSync(join(dir, 'summary.json')));
  assertValueFree(summary);
  assert.equal(summary.checks.length, 4);
  assert.ok(!JSON.stringify(summary).includes('VALUE_PRIVATE'));
  assert.ok(lines.every(line => !line.includes('PRIVATE')));
  assert.ok(browser.calls.some(c => c.method === 'Page.captureScreenshot' && c.params.clip?.height === 400));
});

test('preview capture: page/console/blocked errors are counted without messages and make the run fail', async t => {
  const dir = temporary(t), browser = fakeBrowser(), originalSend = browser.send.bind(browser);
  let injected = false;
  browser.send = async (method, params, sessionId) => {
    if (method === 'Page.navigate' && !injected) {
      injected = true;
      await browser.emit({ method: 'Runtime.exceptionThrown', sessionId: 'page', params: { exceptionDetails: { text: 'ERROR_PRIVATE' } } });
      await browser.emit({ method: 'Runtime.consoleAPICalled', sessionId: 'page', params: { type: 'error', args: [{ value: 'CONSOLE_PRIVATE' }] } });
      await browser.emit({ method: 'Fetch.requestPaused', sessionId: 'page', params: { requestId: 'blocked', request: { url: 'https://external.test/?account=URL_PRIVATE' } } });
    }
    return originalSend(method, params, sessionId);
  };
  assert.equal(await capture({ ...opts(dir), screens: ['desk'], widths: [390], themes: ['light'] }, { launchBrowser: async () => browser, log: () => {} }), 1);
  const text = fs.readFileSync(join(dir, 'summary.json'), 'utf8'), summary = JSON.parse(text);
  assert.equal(summary.counts.pageErrors, 1); assert.equal(summary.counts.consoleErrors, 1); assert.equal(summary.counts.blockedRequests, 1);
  assert.ok(!text.includes('PRIVATE'));
  assertValueFree(summary);
});

test('preview shared screenshot: buffer capture restores the viewport after a capture failure', async () => {
  const browser = fakeBrowser({ failScreenshot: true }), page = await openPage(browser);
  const viewport = { width: 390, height: 844, mobile: true };
  await assert.rejects(screenshot(page, viewport));
  const metrics = browser.calls.filter(c => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.equal(metrics.at(-1).params.height, 844);
});
