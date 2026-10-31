// All JSON reads use this boundary, on the page and in workers. Authentication
// evidence is separate from a bad document or an unavailable board server.
import { validateContract, REASONS } from './contracts/index.mjs';

export const AUTH_FAILURE = 'AUTH_FAILURE';
export const AUTHENTICATED = 'AUTHENTICATED';
export const NO_EVIDENCE = 'NO_EVIDENCE';

// The endpoint owns validation; a parsed 200 alone never proves sign-in.
function validBody(url, response) {
  const path = new URL(url, 'https://board/joe/').pathname, body = response.payload;
  if (path === '/joe/state.json') {
    const data = body?.feeds?.data;
    return Boolean(data && (data.value ? validateContract('data', data.value).ok
      : data.value === null && REASONS.includes(data.reason)));
  }
  return false;
}

export function classifyResponse(url, response = {}) {
  if (response.crossedOrigin) return NO_EVIDENCE;
  if (response.auth === true || AUTH.has(response.status)) return AUTH_FAILURE;
  if (!(response.status >= 200 && response.status < 300)) return NO_EVIDENCE;
  try { return validBody(url, response) ? AUTHENTICATED : NO_EVIDENCE; }
  catch { return NO_EVIDENCE; }
}

const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
const HTML = /^\s*(?:<!doctype\s+html\b|<!--|<\/?[a-z][\w:-]*(?:\s|\/?>))/i;
export function serverClock(headers) {
  const own = headers?.get('X-Joe-Server-Now');
  if (own && Number.isFinite(Date.parse(own))) return { at: own, precise: true };
  const date = headers?.get('Date');
  return date && Number.isFinite(Date.parse(date)) ? { at: new Date(Date.parse(date)).toISOString(), precise: false } : null;
}

export async function readJSON(url, init = {}, { text = false, fetcher = (...args) => fetch(...args), timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  let timer, clock = null, at, timedOut = false;
  try {
    const result = await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Read timed out')); }, timeoutMs); }),
      (async () => {
        const response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin', ...init, redirect: 'manual', signal: controller.signal });
        at = performance.now();
        clock = serverClock(response.headers);
        const crossedOrigin = response.redirected && response.url && new URL(response.url).origin !== new URL(url, globalThis.location?.href ?? import.meta.url).origin;
        if (crossedOrigin) return { status: 0, crossedOrigin: true, clock, at };
        if (response.type === 'opaqueredirect') return { status: 302, redirected: true, auth: true, clock, at };
        if (AUTH.has(response.status)) return { status: response.status, auth: true, clock, at };
        if (response.status === 304) return { status: 304, headers: response.headers, auth: false, clock, at };
        const ok = response.status >= 200 && response.status < 300;
        // A proxy's 5xx HTML error remains a server failure. Successful HTML
        // instead of the requested JSON is the sign-in page.
        if (ok && /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers?.get('Content-Type') ?? ''))
          return { status: 401, auth: true, clock, at };
        let payload = null, body;
        try {
          if (typeof response.text === 'function') {
            body = await response.text();
            if (ok && HTML.test(body)) return { status: 401, auth: true, clock, at };
            payload = JSON.parse(body);
          } else { payload = await response.json(); if (text) body = JSON.stringify(payload); }
        } catch { if (ok) return { status: 0, httpStatus: response.status, clock, at }; }
        return { status: response.status, payload, ...(text ? { text: body } : {}), headers: response.headers,
          ...(ok ? { auth: false } : {}), clock, at };
      })(),
    ]);
    const evidence = result.auth === true ? AUTH_FAILURE : NO_EVIDENCE;
    return { ...result, evidence };
  } catch { return { status: 0, evidence: NO_EVIDENCE, clock, at, ...(timedOut ? { timedOut: true } : {}) }; } finally { clearTimeout(timer); }
}

export const readFailure = ({ auth, status }) => auth ? 'auth_required' : status === 404 ? 'route_not_found' : 'refresh_failed';

// Compare validated documents independently of the server's failure label.
// A sequence_replayed header can accompany useful last-good data on a cold read.
export const documentRegressed = (retained, incoming) => Boolean(retained && incoming &&
  (incoming.seq < retained.seq || Date.parse(incoming.receivedAt) < Date.parse(retained.receivedAt)));

// Expiry is a page-lifetime latch. Only a new document creates a live session.
export function createBoardSession() {
  const listeners = new Set();
  let frozen = false, epoch = 0;
  const session = {
    signedOut: () => frozen,
    epoch: () => epoch,
    accepting: () => !frozen,
    observe(_key, response = {}) {
      if (!frozen && !response.crossedOrigin && (response.auth === true || AUTH.has(response.status) || response.evidence === AUTH_FAILURE)) {
        frozen = true; epoch++;
        for (const listener of listeners) listener();
      }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    accept(key, response) { session.observe(key, response); return !frozen; },
  };
  return session;
}
export const boardSession = createBoardSession();

export const PROBE_RELOAD_KEY = 'joe-auth-probe-reloads-v1';
const RELOAD_WINDOW_MS = 10 * 60 * 1000;
// One normal, validated protected read. This never accepts data into a store.
export function startAuthProbe(session, {
  read = () => readJSON('/joe/state.json'),
  reload = () => globalThis.location.reload(),
  storage = () => globalThis.sessionStorage,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = id => clearTimeout(id),
} = {}) {
  let timer = null, stopped = false, paused = false, pending = false, delay = 30000, pageReloads = 0, storageFailed = false;
  const history = () => {
    if (storageFailed) return null;
    try {
      const value = JSON.parse(storage().getItem(PROBE_RELOAD_KEY) ?? '[]');
      if (!Array.isArray(value) || value.some(at => !Number.isFinite(at))) throw new Error('Invalid reload history');
      return value.filter(at => at > now() - RELOAD_WINDOW_MS);
    } catch { storageFailed = true; return null; }
  };
  const allowed = entries => entries === null ? pageReloads < 1 : entries.length < 3;
  const arm = () => {
    if (stopped || paused || pending || timer !== null || !session.signedOut()) return;
    if (!allowed(history())) { stopped = true; return; }
    timer = schedule(probe, delay);
  };
  async function probe() {
    timer = null;
    if (stopped || paused || pending || !session.signedOut()) return;
    pending = true;
    try {
      const response = await read();
      if (stopped || paused) return;
      if (classifyResponse('/joe/state.json', response) === AUTHENTICATED) {
        const entries = history();
        if (!allowed(entries)) { stopped = true; return; }
        if (entries !== null) {
          try { storage().setItem(PROBE_RELOAD_KEY, JSON.stringify([...entries, now()])); }
          catch { storageFailed = true; if (pageReloads >= 1) { stopped = true; return; } }
        }
        pageReloads++;
        stopped = true;
        reload();
        return;
      }
    } catch { /* Network/storage/reload failure leaves the marked document. */ }
    finally {
      pending = false;
      if (!stopped && !paused) {
        delay = Math.min(delay * 2, 120000);
        arm();
      }
    }
  }
  const unsubscribe = session.subscribe(arm);
  arm();
  // A cached document keeps its subscription, backoff and reload guard. Only
  // disposal is permanent; neither resume nor a late read can undo it.
  const pause = () => { paused = true; if (timer !== null) cancel(timer); timer = null; };
  return Object.assign(() => { stopped = true; pause(); unsubscribe(); }, {
    pause,
    resume() { paused = false; arm(); },
  });
}
