#!/usr/bin/env node
// Private-host capture, never a shipped asset. DOM text stays in the browser;
// only the allow-list projection below may reach summary.json or the terminal.
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { launch, openPage } from './browser/cdp.mjs';
import { VIEWPORTS, THEMES, configure, load, go, settle, screenshot } from './browser/shots.mjs';
import { setDeskDisclosures } from './browser/desk-disclosures.mjs';

const SCREENS = ['desk', 'positions', 'settings', 'results', 'history'];
const DEFAULT_SCREENS = SCREENS.slice(0, 4);
const STATES = ['fresh', 'stale', 'not reported', 'broken'];
const COUNTERS = ['pageErrors', 'consoleErrors', 'blockedRequests', 'interceptionErrors', 'checkErrors', 'writeBlocked'];
const ACTOR = /^[a-z][a-z0-9-]{2,39}$/;
const VERSION = /^(?:[1-9][0-9]{11}\.0\.0|[0-9]{2}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]{2}\.[0-9]{2})?)$/;

// The single selector inventory. Non-empty requires actual content nodes,
// beyond a section heading. History is checked with Desk, before its PNG.
export const SECTIONS = Object.freeze([
  { id: 'desk-hero', route: 'desk', screens: ['desk'], selector: '#heroL', content: '.display' },
  ...['j', 'joe', 'joel'].map(id => ({ id: `desk-${id}`, route: 'desk', screens: ['desk'], selector: `#desk-${id}`, content: '.now' })),
  { id: 'positions', route: 'desk', screens: ['desk', 'positions'], selector: '#positions', content: '.prow:not(.hd) .name' },
  { id: 'kept', route: 'desk', screens: ['desk', 'positions'], selector: '#kept', content: '.prow .name' },
  { id: 'history', route: 'history', screens: ['desk', 'history'], selector: '#histChart', content: 'svg path[stroke]', graphic: true },
  { id: 'history-bookkeeping', route: 'history', screens: ['desk', 'history'], selector: '#jAcct', content: 'dd' },
  { id: 'history-events', route: 'history', screens: ['desk', 'history'], selector: '#events', content: 'li' },
  { id: 'results', route: 'results', screens: ['results'], selector: '#rhero', content: '#rheroL .display' },
  { id: 'results-tiles', route: 'results', screens: ['results'], selector: '#tiles', content: '.tval', item: '.tile', explanation: '.tmean' },
  { id: 'results-calendar', route: 'results', screens: ['results'], selector: '#cal', content: '.cell:not(.out)' },
  { id: 'results-breakdown', route: 'results', screens: ['results'], selector: '#breakdown', content: '.track', graphic: true },
  { id: 'settings-mode', route: 'settings', screens: ['settings'], selector: '#set-mode', content: '#modeLede' },
  { id: 'settings-runtime', route: 'settings', screens: ['settings'], selector: '#rtRows', content: '.rt-row' },
  ...['desks', 'quota', 'cadence', 'amy', 'mac', 'tools', 'secrets'].map(id => ({
    id: `settings-${id}`, route: 'settings', screens: ['settings'], selector: `#grp-${id}`, content: '.field .f-l',
  })),
  { id: 'settings-source', route: 'settings', screens: ['settings'], selector: '#srcFacts', content: 'dd' },
  { id: 'settings-log', route: 'settings', screens: ['settings'], selector: '#log', content: 'li' },
  { id: 'settings-appearance', route: 'settings', screens: ['settings'], selector: '#set-appearance', content: '[data-themeopt]' },
  { id: 'settings-about', route: 'settings', screens: ['settings'], selector: '#set-about', content: '[data-product-version]' },
]);
const sectionsFor = screen => SECTIONS.filter(s => s.screens.includes(screen));

export class CaptureError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}
const usageError = message => { throw new CaptureError(message, 2); };
function actorName(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value !== value.trim() || !ACTOR.test(value)) usageError('--actor must match /^[a-z][a-z0-9-]{2,39}$/');
  return value;
}
function tunnelActor(baseUrl, value) {
  const actor = actorName(value);
  if (actor && !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(baseUrl).hostname)) usageError('--actor requires a loopback --base-url (127.0.0.1, ::1 or localhost)');
  return actor;
}
function list(value, allowed, label) {
  const values = value.split(',');
  if (!values.length || values.some(v => !allowed.includes(v)) || new Set(values).size !== values.length) usageError(`invalid ${label}`);
  return values;
}
export function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--base-url', '--out', '--widths', '--themes', '--screens', '--actor'].includes(key)) usageError('unknown argument; use --base-url, --out, --widths, --themes, --screens, --actor');
    if (Object.hasOwn(values, key)) usageError('duplicate argument');
    if (typeof args[i + 1] !== 'string' || !args[i + 1].trim() || args[i + 1].startsWith('--')) usageError('argument needs a value');
    values[key] = args[i + 1];
  }
  if (!values['--base-url'] || !values['--out']) usageError('--base-url and --out are required');
  let base;
  try { base = new URL(values['--base-url']); } catch { usageError('invalid --base-url'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/joe/' ||
      base.search || base.hash || !/^https?:\/\/[^/@?#\\\s]+\/joe\/$/.test(values['--base-url'])) usageError('--base-url must be an HTTP(S) /joe/ URL without credentials, query or fragment');
  const widths = (values['--widths'] ?? '1440,390').split(',');
  if (widths.some(w => !/^[1-9][0-9]{2,3}$/.test(w) || Number(w) < 320 || Number(w) > 3840) || new Set(widths).size !== widths.length) usageError('--widths must be unique integers from 320 to 3840');
  if (values['--out'].includes('\0')) usageError('invalid --out');
  return {
    baseUrl: base.href, out: resolve(values['--out']), widths: widths.map(Number), actor: tunnelActor(base.href, values['--actor']),
    themes: list(values['--themes'] ?? THEMES.join(','), THEMES, '--themes'),
    screens: list(values['--screens'] ?? DEFAULT_SCREENS.join(','), SCREENS, '--screens'),
  };
}
export function viewportFor(width) {
  return VIEWPORTS.find(v => v.width === width) ?? { name: String(width), width, height: width <= 700 ? 844 : 1000, mobile: width <= 700 };
}
const namesFor = options => options.screens.flatMap(screen => options.widths.flatMap(width => options.themes.map(theme => `${screen}-${width}-${theme}.png`))).concat('summary.json');

export function privateOutput(out, names) {
  const check = dir => {
    let stat;
    try { stat = fs.lstatSync(dir); } catch { usageError('--out must already exist'); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) usageError('--out must be a physical directory');
    if (typeof process.getuid !== 'function' || stat.uid !== process.getuid()) usageError('--out must be owned by the current user');
    if (stat.mode & 0o077) usageError('--out must have no group or other permission bits (0700 or stricter)');
    return stat;
  };
  check(out);
  const dir = fs.realpathSync(out), original = check(dir);
  const verify = () => {
    const stat = check(dir);
    if (stat.dev !== original.dev || stat.ino !== original.ino) usageError('--out directory changed during capture');
  };
  const allowed = new Set(names);
  for (const name of allowed) {
    if (!/^(?:summary\.json|(?:desk|positions|settings|results|history)-[0-9]{3,4}-(?:light|dark)\.png)$/.test(name)) usageError('invalid output filename');
    try { fs.lstatSync(join(dir, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw new CaptureError('cannot check output files'); }
    usageError('output files must not already exist; use a fresh private directory');
  }
  return {
    dir, verify,
    write(name, bytes) {
      verify();
      if (!allowed.has(name)) throw new CaptureError('unexpected output filename');
      let fd;
      try {
        fd = fs.openSync(join(dir, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, bytes);
      } catch { throw new CaptureError('private output write failed'); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    },
  };
}

// Runs in the page. Text/HTML/attributes containing board values never cross
// CDP. Unknown data-state strings become a count, never an exported string.
export function inspectSections(table, notReceived, document) {
  const known = ['fresh', 'stale', 'not reported', 'broken'];
  const hasText = node => Boolean(node?.textContent.replace(/[\s—−-]/g, ''));
  return table.map(section => {
    const root = document.querySelector(section.selector);
    const nodes = root ? [...root.querySelectorAll(section.content)] : [];
    const present = Boolean(root);
    const explained = node => {
      const scope = section.item ? node.closest(section.item) : root;
      return Boolean(scope && section.explanation && [...scope.querySelectorAll(section.explanation)].some(hasText));
    };
    const nonEmpty = nodes.length > 0 && (section.graphic || nodes.some(hasText) || nodes.every(explained));
    const seen = root ? [root, ...root.querySelectorAll('[data-state]')].map(n => n.getAttribute('data-state')).filter(s => s !== null) : [];
    return {
      id: section.id, present, nonEmpty,
      states: known.filter(s => seen.includes(s)), invalidStates: seen.filter(s => !known.includes(s)).length,
      allowedEmpty: present && nodes.length > 0 && !nonEmpty && section.route === 'results' && notReceived === true,
    };
  });
}

const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 1;
// Explicit construction at every level. Never spread a DOM/health/error
// object, stringify it directly, or use its keys as output keys.
export function serializeSummary(options, health, checks, totals = {}) {
  const actor = actorName(options.actor);
  const screens = list(options.screens.join(','), SCREENS, 'summary screens');
  const themes = list(options.themes.join(','), THEMES, 'summary themes');
  const widths = options.widths.map(w => {
    if (!Number.isInteger(w) || w < 320 || w > 3840) usageError('invalid summary width');
    return w;
  });
  const safeChecks = screens.flatMap(screen => widths.flatMap(width => themes.map(theme => {
    const raw = checks.find(c => c.screen === screen && c.width === width && c.theme === theme);
    const sections = sectionsFor(screen).map(def => {
      const section = raw?.sections?.find(s => s.id === def.id);
      const present = section?.present === true, nonEmpty = section?.nonEmpty === true;
      const states = STATES.filter(s => section?.states?.includes(s));
      const invalidStates = count(section?.invalidStates ?? 0) + (Array.isArray(section?.states) ? section.states.filter(s => !STATES.includes(s)).length : 1);
      const allowedEmpty = present && !nonEmpty && def.route === 'results' && section?.allowedEmpty === true;
      return { id: def.id, present, nonEmpty, states, invalidStates, allowedEmpty, ok: present && (nonEmpty || allowedEmpty) && invalidStates === 0 };
    });
    return { screen, width, theme, sections, ...Object.fromEntries(COUNTERS.map(k => [k, count(raw?.[k] ?? (k === 'checkErrors' && !raw ? 1 : 0))])) };
  })));
  const version = typeof health?.version === 'string' && VERSION.test(health.version) ? health.version : null;
  const schemaVersion = health?.schemaVersion === 'joedesk.contracts.v2' ? health.schemaVersion : null;
  const counts = Object.fromEntries(COUNTERS.map(k => [k, Math.max(count(totals[k] ?? 0), safeChecks.reduce((n, c) => n + c[k], 0))]));
  if (!version || !schemaVersion) counts.checkErrors = Math.max(1, counts.checkErrors);
  counts.failingSections = safeChecks.reduce((n, c) => n + c.sections.filter(s => !s.ok).length, 0);
  return JSON.stringify({ screens, widths, themes, actor, health: { version, schemaVersion }, permissionsValid: totals.permissionsValid === true, checks: safeChecks, counts }, null, 2) + '\n';
}
export function assertValueFree(summary) {
  // A strict round trip also rejects extra keys, unknown state/section names,
  // error messages and strings where only a boolean/count is permitted.
  const projected = JSON.parse(serializeSummary(summary, summary.health, summary.checks, { ...summary.counts, permissionsValid: summary.permissionsValid }));
  if (!isDeepStrictEqual(summary, projected)) throw new CaptureError('summary is not the value-free allow-list projection');
}
export const passed = summary => summary.permissionsValid && Object.values(summary.counts).every(n => n === 0);

function logCheckError(log, step, error) {
  const classes = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError', 'URIError', 'CaptureError'];
  const name = error instanceof CaptureError ? 'CaptureError' : classes.find(c => c === error?.name) ?? 'Error';
  // Step ids and exception classes are fixed code vocabulary. Only synthetic
  // CI may print the exception message; none of it enters summary.json.
  log(`preview-capture: step=${step} exception=${name}${process.env.CI === 'true' ? ` message=${JSON.stringify(error?.message ?? 'check failed')}` : ''}`);
}

export async function restrictOrigin(browser, page, baseUrl, counts, actor = null) {
  actor = tunnelActor(baseUrl, actor);
  const origin = new URL(baseUrl).origin;
  const pending = new Set();
  const listener = m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    let allowed = false;
    try { allowed = new URL(m.params.request.url).origin === origin; } catch { /* blocked */ }
    if (!allowed) counts.blockedRequests++;
    const write = actor !== null && !['GET', 'HEAD'].includes(m.params.request.method);
    if (write) counts.writeBlocked++;
    const blocked = !allowed || write;
    const task = browser.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
      requestId: m.params.requestId, ...(blocked ? { errorReason: 'BlockedByClient' } : {}),
    }, m.sessionId).catch(() => { counts.interceptionErrors++; });
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  browser.on(listener);
  await page.setFetch([{ urlPattern: '*', requestStage: 'Request' }], { strict: true });
  return { drain: () => Promise.all([...pending]), dispose: () => browser.off(listener) };
}

async function readHealth(page, baseUrl) {
  return page.evaluate(`(async () => {
    const access = await fetch(${JSON.stringify(new URL('state.json', baseUrl).href)}, { redirect: 'error', cache: 'no-store' });
    if (!access.ok) throw new Error('protected board read unavailable');
    await access.body?.cancel();
    const response = await fetch(${JSON.stringify(new URL('healthz', baseUrl).href)}, { redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error('health unavailable');
    const h = await response.json();
    let resultsNotReceived = false;
    if (h.feeds?.results?.state === 'not reported' && h.feeds?.results?.reason === 'feed_not_received') {
      const results = await fetch(${JSON.stringify(new URL('results.json', baseUrl).href)}, { redirect: 'error', cache: 'no-store' });
      if (results.status === 503) resultsNotReceived = (await results.json()).reason === 'feed_not_received';
      else await results.body?.cancel();
    }
    return { version: h.version, schemaVersion: h.schemaVersion,
      resultsNotReceived };
  })()`);
}

export async function capture(options, { launchBrowser = launch, log = console.log } = {}) {
  // Validation and filename preflight precede even the browser profile write.
  const actor = tunnelActor(options.baseUrl, options.actor);
  const output = privateOutput(options.out, namesFor(options));
  const oldMask = process.umask(0o077);
  const counts = Object.fromEntries(COUNTERS.map(k => [k, 0]));
  const checks = [];
  let browser, page, restriction, onError, health;
  let step = 'launch';
  try {
    browser = await launchBrowser({ profileParent: output.dir, commandTimeout: 20000 });
    step = 'downloads';
    await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    step = 'open-page';
    // openPage installs these headers on the page and on dedicated/nested
    // workers before resuming them. Fetch stays on their owning page/frame.
    page = await openPage(browser, actor ? { headers: { 'x-auth-request-user': actor } } : undefined);
    onError = m => {
      if (!page.owns(m.sessionId)) return;
      if (m.method === 'Runtime.exceptionThrown') counts.pageErrors++;
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') counts.consoleErrors++;
    };
    browser.on(onError);
    step = 'restrict-origin';
    restriction = await restrictOrigin(browser, page, options.baseUrl, counts, actor);
    for (const screen of options.screens) for (const width of options.widths) for (const theme of options.themes) {
      const before = { ...counts };
      const check = { screen, width, theme, sections: [] };
      try {
        step = 'output-permissions';
        output.verify();
        const viewport = viewportFor(width);
        step = 'configure';
        await configure(page, viewport, theme);
        step = 'load';
        await load(page, options.baseUrl, screen === 'positions' ? 'desk' : screen);
        step = 'health';
        health = await readHealth(page, options.baseUrl);
        const table = sectionsFor(screen);
        for (const route of new Set(table.map(s => s.route))) {
          step = `${route}-navigate`;
          await go(page, route);
          const selection = table.filter(s => s.route === route);
          step = `${route}-sections`;
          const sections = await page.evaluate(`(${inspectSections.toString()})(${JSON.stringify(selection)}, ${health.resultsNotReceived === true}, document)`);
          check.sections.push(...sections);
        }
        step = 'capture-navigate';
        await go(page, screen === 'positions' ? 'desk' : screen);
        if (screen === 'positions') await setDeskDisclosures(page, true);
        step = 'settle';
        await settle(page);
        step = 'screenshot';
        const bytes = await screenshot(page, viewport, undefined, screen === 'positions' ? { selector: '#positions' } : {});
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new CaptureError('invalid PNG');
        step = 'write-png';
        output.write(`${screen}-${width}-${theme}.png`, bytes);
      } catch (error) {
        if (error instanceof CaptureError && error.exitCode === 2) throw error;
        counts.checkErrors++;
        logCheckError(log, step, error);
      }
      step = 'drain-requests';
      await restriction.drain();
      for (const k of COUNTERS) check[k] = counts[k] - before[k];
      checks.push(check);
      const projected = JSON.parse(serializeSummary({ ...options, screens: [screen], widths: [width], themes: [theme] }, health, [check])).checks[0];
      for (const section of projected.sections) log(`${screen} ${width} ${theme} ${section.id}: ${section.ok ? 'ok' : 'failed'}`);
      log(`${screen} ${width} ${theme}: pageErrors=${check.pageErrors} consoleErrors=${check.consoleErrors} blockedRequests=${check.blockedRequests} checkErrors=${check.checkErrors}`);
    }
  } catch (error) {
    if (error instanceof CaptureError && error.exitCode === 2) throw error;
    counts.checkErrors++;
    logCheckError(log, step, error);
  } finally {
    try { await browser?.close(); } catch { counts.checkErrors++; }
    if (restriction) { await restriction.drain(); restriction.dispose(); }
    if (onError) browser.off(onError);
    counts.interceptionErrors += page?.routing.errors ?? 0;
    process.umask(oldMask);
  }
  output.verify();
  const serialized = serializeSummary(options, health, checks, { ...counts, permissionsValid: true });
  output.write('summary.json', serialized);
  const summary = JSON.parse(serialized);
  log(`preview-capture: ${passed(summary) ? 'ok' : 'failed'}`);
  return passed(summary) ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await capture(parseArgs(process.argv.slice(2))); }
  catch (error) {
    // Never print CDP exceptions, page values, request URLs or filesystem errors.
    console.error(`preview-capture: ${error instanceof CaptureError ? error.message : 'capture failed'}`);
    process.exitCode = error instanceof CaptureError ? error.exitCode : 1;
  }
}
