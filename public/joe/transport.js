// All JSON reads use this boundary, on the page and in workers. Authentication
// evidence is separate from a bad document or an unavailable board server.
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
    return await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Read timed out')); }, timeoutMs); }),
      (async () => {
        const response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin', ...init, redirect: 'manual', signal: controller.signal });
        at = performance.now();
        clock = serverClock(response.headers);
        const crossedOrigin = response.redirected && response.url && new URL(response.url).origin !== new URL(url, globalThis.location?.href ?? import.meta.url).origin;
        if (response.type === 'opaqueredirect' || crossedOrigin) return { status: 302, redirected: true, auth: true, clock, at };
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
            if (!text) payload = JSON.parse(body);
          } else { payload = await response.json(); if (text) body = JSON.stringify(payload); }
        } catch { if (ok) return { status: 0, httpStatus: response.status, clock, at }; }
        return { status: response.status, payload, ...(text ? { text: body } : {}), headers: response.headers,
          ...(ok ? { auth: false } : {}), clock, at };
      })(),
    ]);
  } catch { return { status: 0, clock, at, ...(timedOut ? { timedOut: true } : {}) }; } finally { clearTimeout(timer); }
}

export const readFailure = ({ auth, status }) => auth ? 'auth_required' : status === 404 ? 'route_not_found' : 'refresh_failed';

// History/Results use this policy in the worker, on worker replies, and after
// worker failure. The page's retained document remains the ordering floor even
// when the fallback's raw-document cache has never received a value.
export function acceptRecovery(retained, incoming, status) {
  const valid = incoming && Number.isSafeInteger(incoming.seq) && Number.isFinite(Date.parse(incoming.receivedAt));
  const ordered = valid && (!retained || (incoming.seq >= retained.seq && Date.parse(incoming.receivedAt) >= Date.parse(retained.receivedAt)));
  const reason = status?.auth === true ? 'auth_required'
    : !valid ? status?.reason ?? 'contract_invalid'
    : !ordered ? 'sequence_replayed'
    : status?.valid === false ? status?.reason ?? 'contract_invalid'
    : status?.state !== 'ok' || status?.auth !== false ? status?.reason ?? 'refresh_failed'
    : status.reason ?? null;
  return { ok: reason === null, reason };
}

// The shell coordinates recovery: any authenticated read can start a full
// refresh, while the displayed document stays frozen until that refresh renders.
export function createBoardSession() {
  const blocked = new Set(), authenticated = new Set(), listeners = new Set();
  const required = ['state', 'history', 'history-continuity', 'results', 'account-history', 'board-settings', 'fleet-config', 'fleet-config/actions'].map(name => `/joe/${name}.json`);
  let recover = null, recovering = false, recoveryOK = false, frozen = false, requiredFeeds = required, epoch = 0;
  const session = {
    signedOut: () => frozen || blocked.size > 0,
    recovering: () => recovering,
    epoch: () => epoch,
    invalidateRecovery: key => { if (key) authenticated.delete(key); else recoveryOK = false; },
    accepting: () => !session.signedOut() || recovering,
    coordinateRecovery(callback, feeds = required) { recover = callback; requiredFeeds = feeds; return () => { recover = null; recovering = false; frozen = false; }; },
    finishRecovery(render) {
      if (!recovering || !recoveryOK || blocked.size || requiredFeeds.some(key => !authenticated.has(key))) return false;
      recovering = frozen = false;
      try {
        for (const listener of listeners) listener();
        if (render() !== false) return true;
      } catch { /* Keep the last marked document and retry after another read. */ }
      frozen = true;
      for (const listener of listeners) listener();
      return false;
    },
    observe(key, { auth } = {}) {
      const before = session.signedOut();
      if (auth === true) {
        if (!before) { authenticated.clear(); epoch++; }
        blocked.add(key); authenticated.delete(key);
        if (recover) frozen = true;
      }
      if (auth === false) {
        blocked.delete(key);
        if (before) authenticated.add(key);
        if (recover && before && !recovering) {
          recovering = recoveryOK = true;
          // Let the successful read finish acceptance before refreshing it.
          queueMicrotask(async () => {
            try { await recover(); } catch { recoveryOK = false; }
            finally { recovering = false; }
          });
        }
      }
      if (before !== session.signedOut()) for (const listener of listeners) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Auth responses never enter stores. A non-auth failure can update the
    // normal reason only after that feed's post-freeze authenticated success.
    // The displayed selection stays frozen until finishRecovery renders it.
    accept(key, response) {
      session.observe(key, response);
      return response?.auth !== true && session.accepting() && (!session.signedOut() || response?.auth === false || authenticated.has(key));
    },
  };
  return session;
}
export const boardSession = createBoardSession();
