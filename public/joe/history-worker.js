// History and the closed-trade record are the board's largest reads (up to
// 8 MiB each). They are fetched, parsed and validated here, off the page's
// main thread, through the same acceptRead boundary; the page receives typed
// columns by transfer, never a copy. The page starts this worker under its
// release's own path, so the imports below resolve to that same release.
import { acceptRead } from './contracts/read.mjs';
import { toColumns, transferables, sessionCloses, DESK_IDS } from './history-model.js';
import { indexResults, transferables as resultsTransferables } from './results-model.js';

const previous = { history: null, results: null }, posted = { history: null, results: null };
const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
// The board server's clock from a response: its own stamp, else the HTTP date.
function serverClock(headers) {
  const own = headers.get('X-Joe-Server-Now');
  if (own && Number.isFinite(Date.parse(own))) return { at: own, precise: true };
  const date = headers.get('Date');
  return date && Number.isFinite(Date.parse(date)) ? { at: new Date(Date.parse(date)).toISOString(), precise: false } : null;
}

async function read(url) {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
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

async function pollHistory(started) {
  const res = await read('/joe/history.json');
  const accepted = acceptRead('history', res, previous.history);
  previous.history = accepted;
  const value = accepted.value;
  const meta = value ? { schema: value.schema, seq: value.seq, generatedAt: value.generatedAt, receivedAt: value.receivedAt,
    sizeBytes: value.sizeBytes, compactedThrough: value.compactedThrough ?? null, reason: value.reason ?? null, points: value.points.length } : null;
  const key = JSON.stringify([meta, accepted.reason]);
  if (key === posted.history) { self.postMessage({ kind: 'unchanged', feed: 'history', clock: clockNow(res), ms: performance.now() - started }); return; }
  posted.history = key;
  if (!value) { self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta: null, clock: clockNow(res), ms: performance.now() - started }); return; }
  const columns = toColumns(value.points);
  const closes = Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)]));
  self.postMessage({ kind: 'history', reason: accepted.reason ?? null, meta, columns, closes, clock: clockNow(res), ms: performance.now() - started }, transferables(columns));
}

// The closed-trade record: indexed once per accepted value (spec r3 §4.2 is
// computed from the index on the page); an unchanged record is not re-sent.
async function pollResults(started) {
  const res = await read('/joe/results.json');
  const accepted = acceptRead('results', res, previous.results);
  previous.results = accepted;
  const value = accepted.value;
  const key = JSON.stringify([value ? [value.seq, value.generatedAt, value.receivedAt] : null, accepted.reason ?? null]);
  if (key === posted.results) { self.postMessage({ kind: 'unchanged', feed: 'results', clock: clockNow(res), ms: performance.now() - started }); return; }
  posted.results = key;
  if (!value) { self.postMessage({ kind: 'results', reason: accepted.reason ?? null, index: null, clock: clockNow(res), ms: performance.now() - started }); return; }
  const index = indexResults(value);
  self.postMessage({ kind: 'results', reason: accepted.reason ?? null, index, clock: clockNow(res), ms: performance.now() - started }, resultsTransferables(index));
}

self.onmessage = ({ data }) => {
  const started = performance.now();
  if (data === 'poll') pollHistory(started);
  if (data === 'results') pollResults(started);
};
