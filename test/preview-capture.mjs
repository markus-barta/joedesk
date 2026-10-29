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
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { designSnapshot, designFleet, designActions, NOW, at } from '../scripts/browser/settings-fixtures.mjs';
import { panelStates } from '../contracts/panel-state.mjs';

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
globalThis.document ??= { documentElement: { dataset: {} } };
const [deskUI, historyUI, resultsUI, settingsUI, settingsModel, resultsModel, ui, historyModel] = await Promise.all([
  builders('desk.js', ['deskCard']), builders('history.js', ['bookkeepingHtml', 'eventsHtml']),
  builders('results.js', ['renderTiles', 'renderBreakdown']),
  builders('settings.js', ['buildSkeleton', 'fieldHtml', 'runtimeHtml', 'sourceHtml', 'logHtml']),
  import('../public/joe/settings-model.js'), import('../public/joe/results-model.js'),
  import('../public/joe/ui.js'), import('../public/joe/history-model.js'),
]).finally(() => { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; });

const execute = promisify(execFile);
const BASE = 'http://127.0.0.1:8080/joe/';
const activeRelease = JSON.parse(fs.readFileSync(new URL('../release.json', import.meta.url)));
const HEALTH = { version: activeRelease.version, schemaVersion: 'joedesk.contracts.v2', resultsNotReceived: true };
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
  assert.equal(options.actor, null);
  assert.equal(parseArgs(['--base-url', 'http://localhost:80/joe/', '--out', '/private/capture']).baseUrl, 'http://localhost/joe/');
  assert.deepEqual(parseArgs(['--out', '/private/capture', '--base-url', BASE, '--widths', '320,1024,3840', '--themes', 'dark', '--screens', 'history']).screens, ['history']);
});

test('preview actor: strict names, loopback IPv4/IPv6/localhost only; no actor keeps remote URLs available', async t => {
  const dir = temporary(t);
  for (const host of ['127.0.0.1:8080', '[::1]:8080', 'localhost:8080']) {
    for (const actor of ['joe', 'joedesk-qa', 'a' + '9-'.repeat(19) + 'z']) {
      assert.equal(parseArgs(['--base-url', `http://${host}/joe/`, '--out', dir, '--actor', actor]).actor, actor);
    }
  }
  for (const actor of ['', 'ab', 'a'.repeat(41), '1joe', 'Joe', 'joe_qa', 'joe.qa', ' joe', 'joe ', 'joe\n', 'joe\r\n', 'joe\0qa', 'joe:qa']) {
    assert.throws(() => parseArgs(['--base-url', BASE, '--out', dir, '--actor', actor]), e => e.exitCode === 2);
  }
  for (const host of ['example.invalid', '127.0.0.2', 'localhost.example.invalid', '[::ffff:127.0.0.1]']) {
    const baseUrl = `http://${host}/joe/`;
    assert.equal(parseArgs(['--base-url', baseUrl, '--out', dir]).actor, null);
    assert.throws(() => parseArgs(['--base-url', baseUrl, '--out', dir, '--actor', 'joedesk-qa']), e => e.exitCode === 2 && /loopback/.test(e.message));
    await assert.rejects(capture({ ...opts(dir), baseUrl, actor: 'joedesk-qa' }, { launchBrowser: () => assert.fail('browser must not launch') }), e => e.exitCode === 2);
  }
  const result = await execute(process.execPath, ['scripts/preview-capture.mjs', '--base-url', 'http://example.invalid/joe/', '--out', dir, '--actor', 'joedesk-qa']).catch(e => e);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /loopback --base-url/);
  assert.deepEqual(fs.readdirSync(dir), []);
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
  assert.equal(summary.actor, null);
  assert.equal(summary.counts.writeBlocked, 0);
  const actorSummary = JSON.parse(serializeSummary({ ...options, actor: 'joedesk-qa' }, HEALTH, checks, { permissionsValid: true, writeBlocked: 1 }));
  assertValueFree(actorSummary);
  assert.equal(actorSummary.actor, 'joedesk-qa');
  assert.equal(actorSummary.counts.writeBlocked, 1);
  assert.equal(passed(actorSummary), false);
  assert.throws(() => serializeSummary({ ...options, actor: dump.url }, HEALTH, checks));
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
    s => { s.checks[0].sections[0].id = 'PRIVATE'; }, s => { s.checks[0].pageErrors = 'PRIVATE'; },
    s => { s.actor = 'ACCOUNT_PRIVATE'; }, s => { s.counts.writeBlocked = 'PRIVATE'; }, s => { s.checks[0].writeBlocked = 'PRIVATE'; }]) {
    const copy = structuredClone(good); mutate(copy); assert.throws(() => assertValueFree(copy));
  }
  for (const key of ['pageErrors', 'consoleErrors', 'blockedRequests', 'interceptionErrors', 'checkErrors', 'writeBlocked']) {
    assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options), { permissionsValid: true, [key]: 1 }))), false, key);
  }
  assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options).slice(1), { permissionsValid: true }))), false);
  assert.equal(passed(JSON.parse(serializeSummary(options, HEALTH, complete(options)))), false);
});

test('preview actor routing: only GET/HEAD continue, every write fails, foreign origins stay blocked', async () => {
  const browser = fakeBrowser(), page = await openPage(browser, { headers: { 'x-auth-request-user': 'joedesk-qa' } });
  const counts = { blockedRequests: 0, interceptionErrors: 0, writeBlocked: 0 };
  const restriction = await restrictOrigin(browser, page, BASE, counts, 'joedesk-qa');
  const requests = [
    ...['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE', 'get', undefined].map(method => ({ url: BASE, method })),
    { url: 'http://127.0.0.1:8081/joe/', method: 'GET' },
    { url: 'https://external.test/', method: 'POST' },
  ];
  for (const [i, request] of requests.entries()) await browser.emit({ method: 'Fetch.requestPaused', sessionId: 'page', params: { requestId: String(i), request } });
  await restriction.drain(); restriction.dispose();
  assert.equal(counts.writeBlocked, 10);
  assert.equal(counts.blockedRequests, 2);
  assert.equal(counts.interceptionErrors, 0);
  assert.deepEqual(browser.calls.filter(c => c.method === 'Fetch.continueRequest').map(c => c.params.requestId), ['0', '1']);
  const failed = browser.calls.filter(c => c.method === 'Fetch.failRequest');
  assert.equal(failed.length, 11);
  assert.ok(failed.every(c => c.params.errorReason === 'BlockedByClient' && !Object.hasOwn(c.params, 'headers')));
});

test('preview actor capture: headers precede worker resume, writes fail on owning sessions, no-actor requests are unchanged', async t => {
  for (const actor of [null, 'joedesk-qa']) {
    const dir = temporary(t), browser = fakeBrowser(), send = browser.send.bind(browser);
    let injected = false;
    browser.send = async (method, params, sessionId) => {
      if (method.startsWith('Fetch.') && ['worker', 'nested'].includes(sessionId)) assert.fail('workers have no Fetch domain');
      if (method === 'Page.navigate' && !injected) {
        injected = true;
        for (const [id, parent, type] of [['worker', 'page', 'worker'], ['nested', 'worker', 'worker'], ['frame', 'page', 'iframe']]) {
          await browser.emit({ method: 'Target.attachedToTarget', sessionId: parent, params: { sessionId: id, targetInfo: { type, targetId: id } } });
          for (const verb of ['GET', 'HEAD', 'POST']) await browser.emit({ method: 'Fetch.requestPaused', sessionId: id === 'frame' ? id : 'page', params: { requestId: `${id}-${verb}`, request: { url: BASE + 'history.json', method: verb } } });
        }
      }
      return send(method, params, sessionId);
    };
    assert.equal(await capture({ ...opts(dir), actor, screens: ['desk'], widths: [390], themes: ['light'] }, { launchBrowser: async () => browser, log: () => {} }), actor ? 1 : 0);
    const summary = JSON.parse(fs.readFileSync(join(dir, 'summary.json')));
    assertValueFree(summary);
    assert.equal(summary.actor, actor);
    assert.equal(summary.counts.writeBlocked, actor ? 3 : 0);
    assert.equal(summary.checks[0].writeBlocked, actor ? 3 : 0);
    assert.equal(summary.counts.interceptionErrors, 0);
    assert.equal(browser.calls.filter(c => c.method === 'Fetch.failRequest').length, actor ? 3 : 0);
    assert.equal(browser.calls.filter(c => c.method === 'Fetch.continueRequest').length, actor ? 6 : 9);
    const headers = browser.calls.filter(c => c.method === 'Network.setExtraHTTPHeaders');
    assert.deepEqual(headers.map(c => c.sessionId), actor ? ['page', 'worker', 'nested', 'frame'] : []);
    for (const call of headers) {
      assert.deepEqual(call.params.headers, { 'x-auth-request-user': actor });
      if (call.sessionId !== 'page') assert.ok(browser.calls.indexOf(call) < browser.calls.findIndex(c => c.method === 'Runtime.runIfWaitingForDebugger' && c.sessionId === call.sessionId));
    }
  }
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

function renderedBoard(t) {
  const document = htmlDocument(fs.readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries({ document, matchMedia: () => ({ matches: true }), JoeVersion: {} })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (before) Object.defineProperty(globalThis, key, before); else delete globalThis[key]; });
  }
  const window = {};
  runInNewContext(fs.readFileSync(new URL('../public/joe/joe-version.js', import.meta.url), 'utf8'), { window });
  globalThis.JoeVersion = window.JoeVersion;
  const { snapshot, history } = designSnapshot();
  const results = JSON.parse(fs.readFileSync(new URL('../fixtures/results/no-losers.json', import.meta.url)));
  const feeds = { data: { value: { ...snapshot, receivedAt: NOW } },
    history: { value: { ...history, columns: historyModel.toColumns(history.points) } },
    results: { value: { ...results, index: resultsModel.indexResults(results) } },
    'fleet-config': { value: designFleet(), receivedAt: NOW } };
  const ctx = { feeds, now: at(NOW, 9), states: panelStates(feeds, at(NOW, 9)),
    events: { recent: () => [], baseline: () => true }, actions: { entries: designActions() } };
  const set = (selector, html) => { const node = document.querySelector(selector); assert.ok(node, selector); node.innerHTML = html; };
  set('#heroL', deskUI.heroLeft(ctx));
  for (const id of ['j', 'joe', 'joel']) set(`#desk-${id}`, deskUI.deskCard(ctx, id));
  set('#positions', deskUI.positionsHtml(ctx).html);
  set('#kept', deskUI.keptHtml(ctx));
  set('#jAcct', historyUI.bookkeepingHtml(ctx));
  set('#events', historyUI.eventsHtml(ctx));
  Object.assign(document.querySelector('#histChart'), { clientWidth: 900, clientHeight: 300 });
  historyUI.historyChart(ctx);
  const view = resultsUI.resultsView(ctx), desks = ['j', 'joe', 'joel'];
  Object.assign(resultsUI.RS, { period: 'all', cal: resultsModel.ymOf(view.today), sel: view.today });
  const per = resultsModel.periodOf('all', view.today, view.today, view.trackingStart);
  const rollup = chosen => resultsModel.rollup(view.ix, per, chosen, resultsModel.moneyContext(view.ix, view, per, chosen));
  resultsUI.renderHero(view, per, desks, rollup(desks));
  resultsUI.renderTiles(rollup(desks));
  resultsUI.renderBreakdown(view, per, desks, desks.map(id => rollup([id])).concat(rollup(desks)));
  resultsUI.renderCalendar(view, per, desks);
  ui.addTerms(settingsModel.FIELD_TERMS);
  settingsUI.buildSkeleton();
  set('#modeLede', 'Every order goes to the practice account.');
  set('#rtRows', settingsUI.runtimeHtml(ctx));
  for (const group of settingsModel.GROUPS) set(`#grp-${group.id}`, group.fields.map(field => settingsUI.fieldHtml(field, feeds['fleet-config'].value)).join(''));
  set('#srcFacts', settingsUI.sourceHtml(ctx));
  set('#log', settingsUI.logHtml(ctx));
  return document;
}

test('preview sections: the real multi-section board markup passes the entire serialized selector table through capture', async t => {
  const document = renderedBoard(t), dir = temporary(t);
  const versions = document.querySelectorAll('[data-product-version]').map(e => e.dataset.productVersion);
  assert.equal(versions.length, 15, 'P6 expects the footer and fourteen calendar releases in rendered About');
  assert.equal(versions.filter(v => v === activeRelease.version).length, 2, 'current release appears in footer and About');
  const history = document.querySelectorAll('#set-about .ver .t').map(e => e.textContent);
  assert.deepEqual(history.slice(0, 15), [activeRelease.version, '261029075623.0.0', '261028202622.0.0', '261028081016.0.0', '261027124551.0.0', '261026232616.0.0', '261026070713.0.0', '261025221940.0.0', '261025144826.0.0', '261023155418.0.0',
    '261023100632.0.0', '261021113113.0.0', '261021083537.0.0', '261021015923.0.0', '26.09.21.12.00'],
  'rendered About orders sequence 39, published sequence 38, deployed sequences 37 through 26, then legacy history');
  for (const version of ['261019102825.0.0', '261016151218.0.0']) assert.equal(history.includes(version), false);
  assert.ok(document.querySelector('#tiles [data-tile="pf"] .tval').textContent.trim() === '—');
  assert.match(document.querySelector('#tiles [data-tile="pf"] .tmean').textContent, /losing trade/);
  const sections = inspectSections(SECTIONS, false, document);
  assert.deepEqual(sections.filter(s => !s.present || !s.nonEmpty || s.invalidStates).map(s => s.id), []);
  const browser = fakeBrowser({ document, health: { ...HEALTH, resultsNotReceived: false } });
  assert.equal(await capture({ ...opts(dir), screens: ['desk', 'positions', 'settings', 'results', 'history'] },
    { launchBrowser: async () => browser, log: () => {} }), 0);
  const summary = JSON.parse(fs.readFileSync(join(dir, 'summary.json')));
  assertValueFree(summary);
  assert.equal(summary.checks.length, 20);
  assert.ok(summary.checks.every(c => c.sections.every(s => s.nonEmpty && s.ok && !s.allowedEmpty)));
  document.querySelector('#kept').remove();
  assert.deepEqual(inspectSections(SECTIONS, false, document).filter(s => !s.present || !s.nonEmpty).map(s => s.id), ['kept']);
});

test('preview Results tiles: real values or each dash’s own explanation count; unexplained all-dash and missing content fail', () => {
  const table = SECTIONS.filter(s => s.id === 'results-tiles');
  const inspect = (html, notReceived = false) => inspectSections(table, notReceived, htmlDocument(html))[0];
  const tile = (value, why = '') => `<article class="tile"><div class="tval">${value}</div>${why ? `<p class="tmean">${why}</p>` : ''}</article>`;
  assert.equal(inspect(`<div id="tiles">${tile('12')}${tile('—', 'Needs a losing trade')}</div>`).nonEmpty, true);
  assert.equal(inspect(`<div id="tiles">${tile('12')}${tile('—')}</div>`).nonEmpty, true);
  const explained = `<div id="tiles">${tile('—', 'Needs a won or lost trade')}${tile('—', 'Needs a losing trade')}</div>`;
  assert.equal(inspect(explained).nonEmpty, true);
  assert.equal(inspect(`<div id="tiles">${tile('—', 'Needs a losing trade')}${tile('—')}</div>`).nonEmpty, false);
  const empty = `<div id="tiles">${tile('—')}${tile(' − ')}</div>`;
  assert.deepEqual([inspect(empty).nonEmpty, inspect(empty).allowedEmpty], [false, false]);
  assert.deepEqual([inspect(empty, true).nonEmpty, inspect(empty, true).allowedEmpty], [false, true]);
  assert.equal(inspect('<div id="tiles"></div>', true).allowedEmpty, false);
  assert.equal(inspect('<div></div>', true).allowedEmpty, false);
});

function fakeBrowser({ failFetch = null, failScreenshot = false, document = dom(), health = HEALTH } = {}) {
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
        assert.equal(params.returnByValue, true);
        if (sessionId === 'page') assert.equal(params.awaitPromise, true);
        if (e.includes('inspectSections(')) value = runInNewContext(e, { document });
        else if (e.includes('const response = await fetch')) value = health;
        else if (e === 'Intl.DateTimeFormat().resolvedOptions().timeZone') value = 'UTC';
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
      // Chromium delivers dedicated-worker Fetch pauses on the owning page,
      // even though Network events belong to the worker's own session.
      await browser.emit({ method: 'Fetch.requestPaused', sessionId: 'page', params: { requestId: `${sessionId}-${url}`, request: { url } } });
    }
  }
  await restriction.drain(); restriction.dispose();
  assert.equal(counts.blockedRequests, 8);
  assert.equal(browser.calls.filter(c => c.method === 'Fetch.failRequest').length, 8);
  assert.equal(browser.calls.filter(c => c.method === 'Fetch.continueRequest').length, 4);
  assert.ok(browser.calls.some(c => c.method === 'Fetch.enable' && c.params.patterns[0].urlPattern === '*' && c.sessionId === 'page'));
  assert.ok(!browser.calls.some(c => c.method === 'Fetch.enable' && c.sessionId === 'worker'));
  assert.ok(browser.calls.some(c => c.method === 'Runtime.enable' && c.sessionId === 'worker'));
});

test('preview network: strict interception failure rejects the page and never resumes an unprotected frame', async () => {
  const failed = fakeBrowser({ failFetch: 'page' }), failedPage = await openPage(failed);
  await assert.rejects(restrictOrigin(failed, failedPage, BASE, {}));
  assert.equal(failedPage.routing.errors, 1);
  const browser = fakeBrowser({ failFetch: 'frame' }), page = await openPage(browser);
  await restrictOrigin(browser, page, BASE, {});
  await browser.emit({ method: 'Target.attachedToTarget', sessionId: 'page', params: { sessionId: 'frame', targetInfo: { type: 'iframe', targetId: 'frame-target' } } });
  assert.equal(page.routing.errors, 1);
  assert.ok(browser.calls.some(c => c.method === 'Target.closeTarget' && c.params.targetId === 'frame-target'));
  assert.ok(!browser.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger' && c.sessionId === 'frame'));
});

test('preview network: real worker protocol shape resumes dedicated and nested workers; frame interception stays strict', async () => {
  const browser = fakeBrowser(), send = browser.send.bind(browser);
  browser.send = async (method, params, sessionId) => {
    if (method.startsWith('Fetch.') && ['worker', 'nested-worker'].includes(sessionId)) throw new Error('Fetch domain is unavailable on dedicated workers');
    return send(method, params, sessionId);
  };
  const page = await openPage(browser, { timeZone: 'UTC' }), counts = { blockedRequests: 0, interceptionErrors: 0 };
  const restriction = await restrictOrigin(browser, page, BASE, counts);
  for (const [sessionId, parent, type] of [['worker', 'page', 'worker'], ['nested-worker', 'worker', 'worker'], ['frame', 'page', 'iframe']]) {
    await browser.emit({ method: 'Target.attachedToTarget', sessionId: parent, params: { sessionId, targetInfo: { type, targetId: `${sessionId}-target` } } });
    assert.equal(page.owns(sessionId), true);
    assert.ok(browser.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger' && c.sessionId === sessionId));
    assert.ok(browser.calls.some(c => c.method === 'Target.setAutoAttach' && c.sessionId === sessionId));
  }
  await page.setFetch([{ urlPattern: '*', requestStage: 'Request' }], { strict: true });
  await browser.emit({ method: 'Fetch.requestPaused', sessionId: 'page', params: { requestId: 'nested-egress', request: { url: 'https://external.test/' } } });
  await restriction.drain(); restriction.dispose();
  assert.equal(page.routing.errors, 0);
  assert.deepEqual(page.workerTimeZones, ['UTC', 'UTC']);
  assert.equal(counts.blockedRequests, 1);
  assert.equal(counts.interceptionErrors, 0);
  assert.ok(browser.calls.some(c => c.method === 'Fetch.failRequest' && c.sessionId === 'page' && c.params.requestId === 'nested-egress'));
  assert.ok(browser.calls.some(c => c.method === 'Fetch.enable' && c.sessionId === 'frame'));
  await browser.emit({ method: 'Target.detachedFromTarget', sessionId: 'worker', params: { sessionId: 'nested-worker' } });
  assert.equal(page.owns('nested-worker'), false);
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

test('preview capture: failure diagnostics name the step and exception class; messages are CI-only and never in summary.json', async t => {
  const before = process.env.CI;
  try {
    for (const ci of ['false', 'true', '1']) for (const step of ['load', 'desk-sections']) {
      process.env.CI = ci;
      const dir = temporary(t), browser = fakeBrowser(), send = browser.send.bind(browser), lines = [];
      browser.send = async (method, params, sessionId) => {
        if ((step === 'load' && method === 'Page.navigate') ||
            (step === 'desk-sections' && method === 'Runtime.evaluate' && params.expression.includes('inspectSections('))) throw new TypeError('DIAGNOSTIC_PRIVATE');
        return send(method, params, sessionId);
      };
      assert.equal(await capture({ ...opts(dir), screens: ['desk'], widths: [390], themes: ['light'] },
        { launchBrowser: async () => browser, log: line => lines.push(line) }), 1);
      assert.ok(lines.some(line => line.includes(`step=${step} exception=TypeError`)));
      assert.equal(lines.some(line => line.includes('DIAGNOSTIC_PRIVATE')), ci === 'true');
      const text = fs.readFileSync(join(dir, 'summary.json'), 'utf8'), summary = JSON.parse(text);
      assert.equal(summary.counts.checkErrors, 1);
      assert.ok(!text.includes('DIAGNOSTIC_PRIVATE') && !text.includes('TypeError'));
      assertValueFree(summary);
    }
  } finally { if (before === undefined) delete process.env.CI; else process.env.CI = before; }
});

test('preview shared screenshot: buffer capture restores the viewport after a capture failure', async () => {
  const browser = fakeBrowser({ failScreenshot: true }), page = await openPage(browser);
  const viewport = { width: 390, height: 844, mobile: true };
  await assert.rejects(screenshot(page, viewport));
  const metrics = browser.calls.filter(c => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.equal(metrics.at(-1).params.height, 844);
});
