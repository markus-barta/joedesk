// History is the board's largest read (up to 8 MiB). It is fetched, parsed and
// validated here, off the page's main thread, through the same acceptRead
// boundary; the page receives typed columns by transfer, never a copy.
import { acceptRead } from './contracts/read.mjs';
import { toColumns, transferables, sessionCloses, DESK_IDS } from './history-model.js';

let previous = null, posted = null;
const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);

async function read() {
  try {
    const response = await fetch('./history.json', { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
    if (response.type === 'opaqueredirect') return { status: 302, redirected: true };
    if (AUTH.has(response.status)) return { status: response.status };
    const reason = response.headers.get('X-Joe-Feed-Reason') ?? undefined;
    let payload = null;
    try { payload = await response.json(); } catch { if (response.ok) return { status: 0 }; }
    return response.ok ? { status: 200, payload, reason } : { status: response.status, payload, reason: payload?.reason ?? undefined };
  } catch {
    return { status: 0 };
  }
}

self.onmessage = async ({ data }) => {
  if (data !== 'poll') return;
  const started = performance.now();
  const accepted = acceptRead('history', await read(), previous);
  previous = accepted;
  const value = accepted.value;
  const meta = value ? { schema: value.schema, seq: value.seq, generatedAt: value.generatedAt, receivedAt: value.receivedAt,
    sizeBytes: value.sizeBytes, compactedThrough: value.compactedThrough ?? null, reason: value.reason ?? null, points: value.points.length } : null;
  const key = JSON.stringify([meta, accepted.reason]);
  if (key === posted) { self.postMessage({ kind: 'unchanged', ms: performance.now() - started }); return; }
  posted = key;
  if (!value) { self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta: null, ms: performance.now() - started }); return; }
  const columns = toColumns(value.points);
  const closes = Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)]));
  self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta, columns, closes, ms: performance.now() - started }, transferables(columns));
};
