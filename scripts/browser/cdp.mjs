// A small Chrome DevTools Protocol client over --remote-debugging-pipe. No
// dependencies; one browser, one page, used sequentially by the P3 tests.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { scratch, discard } from './scratch.mjs';

export function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue;
    const shells = readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const dir of shells) {
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-linux']) {
        for (const bin of ['chrome-headless-shell', 'headless_shell']) {
          const candidate = join(cache, dir, sub, bin);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome found; set BROWSER_PATH');
}

export async function closeBrowserProcess(proc, requestClose, timeout = 3000) {
  const hasExited = () => proc.exitCode !== null || proc.signalCode !== null;
  if (hasExited()) return;
  let onExit;
  const exited = new Promise(resolve => { onExit = () => resolve(true); proc.once('exit', onExit); });
  const waitForExit = async () => {
    let timer;
    try {
      return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeout); })]);
    } finally { clearTimeout(timer); }
  };
  try {
    // A CDP acknowledgement (or a disconnected pipe) is not process exit.
    // Keep the exit listener installed before asking Chrome to close.
    Promise.resolve().then(requestClose).catch(() => { /* pipe may close with Chrome */ });
    if (await waitForExit()) return;
    if (!hasExited()) proc.kill('SIGTERM');
    if (await waitForExit()) return;
    if (!hasExited()) proc.kill('SIGKILL');
    if (!await waitForExit()) throw new Error('Browser did not exit; profile retained');
  } finally { proc.off('exit', onExit); }
}

export async function launch({ hostRules = '', profileParent, commandTimeout = 0 } = {}) {
  const profile = scratch('joed-p3-browser-', profileParent);
  const args = ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-background-networking', '--disable-extensions', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--js-flags=--max-old-space-size=256',
    '--font-render-hinting=none', `--user-data-dir=${profile}`,
    // The pointer is the test's, not the host's. Chrome asks the OS for a
    // mouse: a Mac always has one, a Linux runner has none, so there
    // (hover: hover) never matched (the Linux CI run of c942831). Every
    // document starts with a fine, hovering pointer; touch emulation
    // (configure) makes it coarse and hover-less for the phone cases.
    // Emulation.setEmulatedMedia ignores hover and pointer.
    '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2'];
  if (hostRules) args.push(`--host-resolver-rules=${hostRules}`);
  const proc = spawn(findBrowser(), args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});
  let buffer = '', id = 0;
  const pending = new Map(), listeners = new Set();
  let stopped = false;
  const disconnected = () => {
    stopped = true;
    for (const { reject } of pending.values()) reject(new Error('Browser disconnected'));
    pending.clear();
  };
  proc.on('error', disconnected);
  proc.on('exit', disconnected);
  proc.stdio[4].on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result);
      } else for (const fn of listeners) fn(message);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error('Browser disconnected')); return; }
    const n = ++id;
    const timer = commandTimeout ? setTimeout(() => {
      pending.delete(n);
      reject(new Error('Browser command timed out'));
    }, commandTimeout) : null;
    pending.set(n, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }, method });
    proc.stdio[3].write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  return {
    send, on: fn => listeners.add(fn), off: fn => listeners.delete(fn),
    async close() {
      await closeBrowserProcess(proc, () => send('Browser.close'));
      await discard(profile, 'browser profile', { strict: Boolean(profileParent) });
    },
  };
}

export async function openPage(browser, { headers = {}, timeZone = process.env.TZ } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
  // macOS Chrome can use the OS zone despite TZ in its environment. Emulate
  // the requested host zone explicitly; dedicated workers inherit this zone.
  if (timeZone) await s('Emulation.setTimezoneOverride', { timezoneId: timeZone });
  const page = { headers };
  if (Object.keys(headers).length) await s('Network.setExtraHTTPHeaders', { headers });
  const errors = [], requests = [], workerTimeZones = [];
  // Workers are their own targets: give them the same request headers and
  // the same request routing before they run.
  const children = new Set();
  let fetchPatterns = null;
  let strictFetch = false;
  const routing = { errors: 0 };
  await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  browser.on(async m => {
    if (m.method === 'Target.detachedFromTarget' && (m.sessionId === sessionId || children.has(m.sessionId))) children.delete(m.params.sessionId);
    if (m.method !== 'Target.attachedToTarget' || (m.sessionId !== sessionId && !(strictFetch && children.has(m.sessionId)))) return;
    const child = m.params.sessionId;
    children.add(child);
    try {
      await browser.send('Network.enable', {}, child);
      if (Object.keys(page.headers).length) await browser.send('Network.setExtraHTTPHeaders', { headers: page.headers }, child);
      if (fetchPatterns) await browser.send('Fetch.enable', { patterns: fetchPatterns }, child);
      if (strictFetch) {
        await browser.send('Runtime.enable', {}, child);
        await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, child);
      }
    } catch {
      if (strictFetch) {
        routing.errors++;
        // Never run a target whose request interception could not be installed.
        await browser.send('Target.closeTarget', { targetId: m.params.targetInfo.targetId }).catch(() => {});
        return;
      }
    }
    await browser.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
    if (timeZone && m.params.targetInfo.type === 'worker') {
      try {
        await browser.send('Runtime.enable', {}, child);
        const result = await browser.send('Runtime.evaluate', {
          expression: 'Intl.DateTimeFormat().resolvedOptions().timeZone', returnByValue: true,
        }, child);
        workerTimeZones.push(result.result.value);
      } catch { workerTimeZones.push(null); }
    }
  });
  browser.on(m => {
    if (m.method === 'Network.requestWillBeSent' && m.sessionId && m.sessionId !== sessionId) requests.push({ url: m.params.request.url, method: m.params.request.method, postData: m.params.request.postData, worker: true });
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Network.requestWillBeSent') requests.push({ url: m.params.request.url, method: m.params.request.method, postData: m.params.request.postData });
  });
  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const setHeaders = async next => { page.headers = next; await s('Network.setExtraHTTPHeaders', { headers: next }); };
  // Pause matching requests of the page and of every worker it starts.
  const setFetch = async (patterns, { strict = false } = {}) => {
    fetchPatterns = patterns;
    strictFetch = strict;
    for (const target of [sessionId, ...children]) {
      try { await browser.send(patterns ? 'Fetch.enable' : 'Fetch.disable', patterns ? { patterns } : {}, target); }
      catch (error) {
        if (strict) { routing.errors++; throw error; }
        /* the worker has gone */
      }
    }
  };
  const owns = id => id === sessionId || children.has(id);
  return { s, evaluate, errors, requests, workerTimeZones, targetId, setHeaders, setFetch, owns, routing };
}
