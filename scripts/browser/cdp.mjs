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

export async function launch({ hostRules = '' } = {}) {
  const profile = scratch('joed-p3-browser-');
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
    const n = ++id;
    pending.set(n, { resolve, reject, method });
    proc.stdio[3].write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  const exited = new Promise(resolve => proc.on('exit', resolve));
  return {
    send, on: fn => listeners.add(fn), off: fn => listeners.delete(fn),
    async close() {
      try { await Promise.race([send('Browser.close'), new Promise(r => setTimeout(r, 3000))]); } catch { /* already closing */ }
      if (proc.exitCode === null) proc.kill('SIGTERM');
      await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
      discard(profile, 'browser profile');
    },
  };
}

export async function openPage(browser, { headers = {} } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
  const page = { headers };
  if (Object.keys(headers).length) await s('Network.setExtraHTTPHeaders', { headers });
  const errors = [], requests = [];
  // Workers are their own targets: give them the same request headers and
  // the same request routing before they run.
  const children = new Set();
  let fetchPatterns = null;
  await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  browser.on(async m => {
    if (m.method === 'Target.detachedFromTarget' && m.sessionId === sessionId) children.delete(m.params.sessionId);
    if (m.method !== 'Target.attachedToTarget' || m.sessionId !== sessionId) return;
    const child = m.params.sessionId;
    children.add(child);
    try {
      await browser.send('Network.enable', {}, child);
      if (Object.keys(page.headers).length) await browser.send('Network.setExtraHTTPHeaders', { headers: page.headers }, child);
      if (fetchPatterns) await browser.send('Fetch.enable', { patterns: fetchPatterns }, child);
    } catch { /* not a network-capable target */ }
    browser.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
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
  const setFetch = async patterns => {
    fetchPatterns = patterns;
    for (const target of [sessionId, ...children]) {
      try { await browser.send(patterns ? 'Fetch.enable' : 'Fetch.disable', patterns ? { patterns } : {}, target); } catch { /* the worker has gone */ }
    }
  };
  const owns = id => id === sessionId || children.has(id);
  return { s, evaluate, errors, requests, targetId, setHeaders, setFetch, owns };
}
