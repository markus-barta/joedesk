// History and the closed-trade record are the board's largest reads (up to
// 8 MiB each). They are fetched, parsed and validated here, off the page's
// main thread, through the same acceptRead boundary; the page receives typed
// columns by transfer, never a copy. The page starts this worker under its
// release's own path, so the imports below resolve to that same release.
import { acceptRead } from './contracts/read.mjs';
import { toColumns, transferables, sessionCloses, DESK_IDS } from './history-model.js';
import { indexResults, transferables as resultsTransferables } from './results-model.js';

const previous = { history: null, results: null }, posted = { history: null, results: null };
let frozen = false;
import { readJSON } from './transport.js';
const evidence = responses => Object.fromEntries(responses.map(([url, res]) => [url, res.auth]));
// Auth, document acceptance and freshness are separate evidence. In particular,
// a validated last-good body with a failure header is still a failed attempt.
function outcome(res, accepted) {
  return { state: res.auth === true ? 'auth' : res.auth === false && res.status === 200 && !accepted.reason ? 'ok' : 'error',
    auth: res.auth, reason: res.auth === true ? 'auth_required' : accepted.reason ?? (res.status === 200 && res.auth === false ? null : 'refresh_failed'),
    document: accepted.value ? { seq: accepted.value.seq, receivedAt: accepted.value.receivedAt } : null };
}
function accept(kind, res) {
  const prior = previous[kind];
  let accepted = acceptRead(kind, res, prior);
  const value = accepted.value;
  if (value && prior?.value && (value.seq < prior.value.seq || Date.parse(value.receivedAt) < Date.parse(prior.value.receivedAt)))
    accepted = { ...prior, reason: 'sequence_replayed' };
  previous[kind] = accepted;
  return accepted;
}
const sidecarOutcome = res => ({ state: res.auth === true ? 'auth' : res.auth === false && res.status === 200 && !res.reason ? 'ok' : 'error',
  auth: res.auth, reason: res.auth === true ? 'auth_required' : res.reason ?? (res.status === 200 ? null : res.status === 404 ? 'route_not_found' : 'refresh_failed') });
async function read(url) {
  const res = await readJSON(url);
  return { ...res, reason: res.headers?.get('X-Joe-Feed-Reason') ?? (res.status === 200 ? undefined : res.payload?.reason),
    generatedAdvancedAt: res.headers?.get('X-Joe-Generated-Advanced-At') ?? undefined };
}

// The server's time when this message leaves: its stamp plus the time spent here.
const clockNow = res => (res.clock ? { at: new Date(Date.parse(res.clock.at) + performance.now() - res.at).toISOString(), precise: res.clock.precise } : null);

async function pollHistory(started) {
  const [res, sidecar] = await Promise.all([read('/joe/history.json'), read('/joe/history-continuity.json')]);
  const auth = evidence([['/joe/history.json', res], ['/joe/history-continuity.json', sidecar]]);
  if (res.auth === true || sidecar.auth === true) { self.postMessage({ kind: 'blocked', feed: 'history', auth,
    status: { '/joe/history.json': outcome(res, { reason: res.auth ? 'auth_required' : 'refresh_failed' }), '/joe/history-continuity.json': sidecarOutcome(sidecar) } }); return; }
  const accepted = accept('history', res);
  const status = { '/joe/history.json': outcome(res, accepted), '/joe/history-continuity.json': sidecarOutcome(sidecar) };
  const value = accepted.value;
  const meta = value ? { schema: value.schema, seq: value.seq, generatedAt: value.generatedAt, receivedAt: value.receivedAt,
    sizeBytes: value.sizeBytes, compactedThrough: value.compactedThrough ?? null, reason: value.reason ?? null, points: value.points.length } : null;
  const provenance = sidecar.status === 200 ? sidecar.payload : null;
  const key = JSON.stringify([meta, accepted.reason, provenance]);
  if (!frozen && key === posted.history) { self.postMessage({ status, reason: accepted.reason ?? null, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'unchanged', feed: 'history', clock: clockNow(res), ms: performance.now() - started }); return; }
  posted.history = key;
  if (!value) { self.postMessage({ status, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'history', reason: accepted.reason ?? null, meta: null, clock: clockNow(res), ms: performance.now() - started }); return; }
  const columns = toColumns(value.points, provenance, value.seq);
  const closes = Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)]));
  self.postMessage({ status, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'history', reason: accepted.reason ?? null, meta, columns, closes, clock: clockNow(res), ms: performance.now() - started }, transferables(columns));
}

// The closed-trade record: indexed once per accepted value (spec r3 §4.2 is
// computed from the index on the page); an unchanged record is not re-sent.
async function pollResults(started) {
  const res = await read('/joe/results.json');
  const auth = evidence([['/joe/results.json', res]]);
  if (res.auth === true) { self.postMessage({ kind: 'blocked', feed: 'results', auth, status: { '/joe/results.json': outcome(res, { reason: 'auth_required' }) } }); return; }
  const accepted = accept('results', res);
  const status = { '/joe/results.json': outcome(res, accepted) };
  const value = accepted.value;
  const key = JSON.stringify([value ? [value.seq, value.generatedAt, value.receivedAt] : null, accepted.reason ?? null]);
  if (!frozen && key === posted.results) { self.postMessage({ status, reason: accepted.reason ?? null, generatedAdvancedAt: accepted.generatedAdvancedAt, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'unchanged', feed: 'results', clock: clockNow(res), ms: performance.now() - started }); return; }
  posted.results = key;
  if (!value) { self.postMessage({ status, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'results', reason: accepted.reason ?? null, index: null, clock: clockNow(res), ms: performance.now() - started }); return; }
  const index = indexResults(value);
  self.postMessage({ status, valid: res.status !== 200 || accepted.value === res.payload, auth: { ...auth }, kind: 'results', reason: accepted.reason ?? null, generatedAdvancedAt: accepted.generatedAdvancedAt,
    index, clock: clockNow(res), ms: performance.now() - started }, resultsTransferables(index));
}

self.onmessage = ({ data }) => {
  if (typeof data?.frozen === 'boolean') {
    frozen = data.frozen;
    // A document posted while another read was expiring may not have reached
    // the page. Recovery sends complete columns instead of an unchanged hint.
    posted.history = posted.results = null;
    return;
  }
  const started = performance.now();
  if (data === 'poll') pollHistory(started);
  if (data === 'results') pollResults(started);
};
