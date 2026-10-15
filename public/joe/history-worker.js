// History is the board's largest read (up to 8 MiB). It is fetched, parsed and
// validated here, off the page's main thread, through the same acceptRead
// boundary; the page receives typed columns by transfer, never a copy. The
// page starts this worker under its release's own path, so the imports below
// resolve to that same release.
import { acceptRead } from './contracts/read.mjs';
import { toColumns, transferables, sessionCloses, DESK_IDS } from './history-model.js';

let previous = null, posted = null;
const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
// The board server's clock from a response: its own stamp, else the HTTP date.
function serverClock(headers) {
  const own = headers.get('X-Joe-Server-Now');
  if (own && Number.isFinite(Date.parse(own))) return { at: own, precise: true };
  const date = headers.get('Date');
  return date && Number.isFinite(Date.parse(date)) ? { at: new Date(Date.parse(date)).toISOString(), precise: false } : null;
}

async function read() {
  try {
    const response = await fetch('/joe/history.json', { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
    if (response.type === 'opaqueredirect') return { status: 302, redirected: true };
    const clock = serverClock(response.headers), at = performance.now();
    if (AUTH.has(response.status)) return { status: response.status, clock, at };
    const reason = response.headers.get('X-Joe-Feed-Reason') ?? undefined;
    let payload = null;
    try { payload = await response.json(); } catch { if (response.ok) return { status: 0, clock, at }; }
    return { ...(response.ok ? { status: 200, payload, reason } : { status: response.status, payload, reason: payload?.reason ?? undefined }), clock, at };
  } catch {
    return { status: 0 };
  }
}

// The server's time when this message leaves: its stamp plus the time spent here.
const clockNow = res => (res.clock ? { at: new Date(Date.parse(res.clock.at) + performance.now() - res.at).toISOString(), precise: res.clock.precise } : null);

self.onmessage = async ({ data }) => {
  if (data !== 'poll') return;
  const started = performance.now();
  const res = await read();
  const accepted = acceptRead('history', res, previous);
  previous = accepted;
  const value = accepted.value;
  const meta = value ? { schema: value.schema, seq: value.seq, generatedAt: value.generatedAt, receivedAt: value.receivedAt,
    sizeBytes: value.sizeBytes, compactedThrough: value.compactedThrough ?? null, reason: value.reason ?? null, points: value.points.length } : null;
  const key = JSON.stringify([meta, accepted.reason]);
  if (key === posted) { self.postMessage({ kind: 'unchanged', clock: clockNow(res), ms: performance.now() - started }); return; }
  posted = key;
  if (!value) { self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta: null, clock: clockNow(res), ms: performance.now() - started }); return; }
  const columns = toColumns(value.points);
  const closes = Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)]));
  self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta, columns, closes, clock: clockNow(res), ms: performance.now() - started }, transferables(columns));
};
