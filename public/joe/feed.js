// Transport: the board server's state, history, closed-trade record and fleet
// settings, read through
// the shared acceptRead boundary and ranked only by the shared panelStates
// selector. The clock is the server's, anchored to a monotonic timer, so a
// wrong browser clock cannot make old data look fresh.
import { acceptRead } from './contracts/read.mjs';
import { panelStates } from './contracts/panel-state.mjs';
import { toColumns, sessionCloses, DESK_IDS } from './history-model.js';
import { indexResults } from './results-model.js';

export const POLL_DATA_MS = 15000;
export const POLL_HISTORY_MS = 30000;
export const TICK_MS = 1000;
// Before any server clock is known no feed holds a value (every read that
// brings one also brings the clock), so no state can depend on the instant;
// this fixed one only satisfies the selector's input.
const NO_CLOCK = '1970-01-01T00:00:00.000Z';

// The server's clock from a response: its own stamp, else the HTTP date.
export function serverClock(headers) {
  const own = headers?.get('X-Joe-Server-Now');
  if (own && Number.isFinite(Date.parse(own))) return { at: own, precise: true };
  const date = headers?.get('Date');
  return date && Number.isFinite(Date.parse(date)) ? { at: new Date(Date.parse(date)).toISOString(), precise: false } : null;
}

const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
async function read(url, init = {}) {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual', ...init });
    if (response.type === 'opaqueredirect') return { status: 302, redirected: true };
    const clock = serverClock(response.headers);
    if (AUTH.has(response.status) || response.status === 304) return { status: response.status, headers: response.headers, clock };
    let payload = null;
    try { payload = await response.json(); } catch { if (response.ok) return { status: 0, clock }; }
    return { status: response.status, payload, headers: response.headers, clock };
  } catch {
    return { status: 0 };
  }
}

export function createFeed(onChange, measure = () => {}, version = '') {
  let anchor = null, serverPanels = {}, fleetTag = null;
  const feeds = { data: null, history: null, results: null, 'fleet-config': null };
  const busy = new Set();
  const now = () => (anchor ? new Date(Math.round(anchor.serverMs + performance.now() - anchor.perf)).toISOString() : null);
  const settle = (key, value) => { feeds[key] = value; };

  // state.json's serverNow owns the clock once it has answered; until then
  // any other read's stamp (or, failing that, its HTTP date) anchors it.
  function anchorTo(serverNow, source, perf = performance.now()) {
    const ms = Date.parse(serverNow ?? '');
    if (!Number.isFinite(ms)) return;
    if (source === 'state' || !anchor || (anchor.source !== 'state' && (source === 'stamp' || anchor.source === 'date'))) {
      anchor = { serverMs: ms, perf, source };
    }
  }
  const anchorFrom = clock => { if (clock) anchorTo(clock.at, clock.precise ? 'stamp' : 'date'); };

  async function pollState() {
    if (busy.has('state')) return;
    busy.add('state');
    const res = await read('./state.json');
    busy.delete('state');
    if (res.status !== 200 || !res.payload?.feeds) {
      // Keep the last good snapshot and its original receipts; only the reason changes.
      anchorFrom(res.clock);
      settle('data', acceptRead('data', { status: res.status === 200 ? 0 : res.status, redirected: res.redirected }, feeds.data));
      onChange('data'); return;
    }
    anchorTo(res.payload.serverNow, 'state');
    const started = performance.now();
    const d = res.payload.feeds.data ?? {};
    settle('data', acceptRead('data', d.value
      ? { status: 200, payload: d.value, receivedAt: d.value.receivedAt, generatedAdvancedAt: d.generatedAdvancedAt, gatewayProgress: d.gatewayProgress, reason: d.reason ?? undefined }
      : { status: 503, payload: { reason: d.reason }, reason: d.reason ?? undefined }, feeds.data));
    // History and results have their own worker-fed reads; only the data panels carry over.
    const { history: _history, results: _results, ...panels } = res.payload.panels ?? {};
    serverPanels = panels;
    measure('data-accept', performance.now() - started);
    onChange('data');
  }

  // History and the closed-trade record are read, parsed and validated in a
  // worker; the page only receives typed columns. Workers ignore the page's
  // import map, so the worker and every module it imports load under this
  // release's own path; another release's path is not served. Without module
  // workers the same steps run here.
  let worker = null;
  try {
    worker = new Worker(new URL(`./v/${encodeURIComponent(version)}/history-worker.js`, import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const kind = data.kind === 'unchanged' ? data.feed : data.kind;
      busy.delete(kind);
      if (data.clock) anchorTo(data.clock.at, data.clock.precise ? 'stamp' : 'date');
      measure(`${kind}-worker`, data.ms);
      if (data.kind === 'unchanged') return;
      if (kind === 'results') { settle('results', resultsFeed(data.index, data.reason)); onChange('results'); return; }
      settle('history', { value: data.meta ? { ...data.meta, columns: data.columns, closes: data.closes } : null, reason: data.reason });
      onChange('history');
    };
    worker.onerror = () => { worker = null; busy.delete('history'); busy.delete('results'); pollHistory(); pollResults(); };
  } catch { worker = null; }

  let fallback = null;
  async function pollHistory() {
    if (busy.has('history')) return;
    busy.add('history');
    if (worker) { worker.postMessage('poll'); return; }
    const res = await read('./history.json');
    busy.delete('history');
    anchorFrom(res.clock);
    const reason = res.headers?.get('X-Joe-Feed-Reason') ?? undefined;
    const started = performance.now();
    const accepted = acceptRead('history', res.status === 200 ? { status: 200, payload: res.payload, reason }
      : { status: res.status, redirected: res.redirected, payload: res.payload, reason: res.payload?.reason ?? undefined }, fallback);
    fallback = accepted;
    const v = accepted.value;
    const columns = v ? toColumns(v.points) : null;
    settle('history', { value: v ? { schema: v.schema, seq: v.seq, generatedAt: v.generatedAt, receivedAt: v.receivedAt, reason: v.reason ?? null,
      points: v.points.length, columns, closes: Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)])) } : null, reason: accepted.reason ?? null });
    measure('history-accept', performance.now() - started);
    onChange('history');
  }

  // The closed-trade record (JOED-20 writes it; until then the server answers
  // "not wired"). The page keeps the record's index and its receipt.
  const resultsFeed = (index, reason) => ({ value: index ? { ...index.meta, index } : null, reason: reason ?? null });
  let resultsFallback = null;
  async function pollResults() {
    if (busy.has('results')) return;
    busy.add('results');
    if (worker) { worker.postMessage('results'); return; }
    const res = await read('./results.json');
    busy.delete('results');
    anchorFrom(res.clock);
    const reason = res.headers?.get('X-Joe-Feed-Reason') ?? undefined;
    const started = performance.now();
    const previous = resultsFallback;
    const accepted = acceptRead('results', res.status === 200 ? { status: 200, payload: res.payload, reason }
      : { status: res.status, redirected: res.redirected, payload: res.payload, reason: res.payload?.reason ?? undefined }, previous);
    resultsFallback = accepted;
    const v = accepted.value;
    const same = v && previous?.value === v && feeds.results?.value;
    settle('results', same ? { value: feeds.results.value, reason: accepted.reason ?? null } : resultsFeed(v ? indexResults(v) : null, accepted.reason));
    measure('results-accept', performance.now() - started);
    onChange('results');
  }

  async function pollFleet() {
    if (busy.has('fleet')) return;
    busy.add('fleet');
    const res = await read('./fleet-config.json', fleetTag ? { headers: { 'If-None-Match': fleetTag } } : {});
    busy.delete('fleet');
    anchorFrom(res.clock);
    if (res.status === 304) return;
    if (res.status === 200) fleetTag = res.headers.get('ETag');
    settle('fleet-config', acceptRead('fleet-config', res.status === 200
      ? { status: 200, payload: res.payload, receivedAt: res.headers.get('X-Joe-Received-At') ?? undefined }
      : { status: res.status, redirected: res.redirected, payload: res.payload }, feeds['fleet-config']));
    onChange('fleet');
  }

  // Every panel through the shared selector at the anchored server time. The
  // server's own panels carry retained last-good values and their receipts.
  // Without any server clock each panel still gets its state and reason: a
  // value that arrived without one cannot be dated, so it is not shown.
  function select() {
    const at = now();
    const input = Object.fromEntries(Object.entries(feeds).filter(([, feed]) => feed));
    if (at) return { now: at, feeds: input, states: panelStates(input, at, serverPanels) };
    const undated = Object.fromEntries(Object.entries(input).map(([key, feed]) => [key, feed.value == null ? feed : { value: null, reason: feed.reason ?? null }]));
    return { now: null, feeds: undated, states: panelStates(undated, NO_CLOCK, {}) };
  }
  // Every first read (state, history, closed-trade record, fleet settings) has
  // answered, with a value or a reason; the page then marks itself ready.
  const settled = () => ['data', 'history', 'results', 'fleet-config'].every(key => feeds[key] && (feeds[key].value != null || feeds[key].reason));

  let timers = [];
  function start() {
    pollFleet().then(pollState);
    pollHistory();
    pollResults();
    timers = [
      setInterval(pollState, POLL_DATA_MS),
      setInterval(() => { pollHistory(); pollResults(); pollFleet(); }, POLL_HISTORY_MS),
      setInterval(() => onChange('tick'), TICK_MS),
    ];
  }
  const stop = () => { timers.forEach(clearInterval); timers = []; };
  const refresh = () => Promise.all([pollFleet(), pollState(), pollHistory(), pollResults()]);
  return { start, stop, select, now, settled, refresh, refreshHistory: pollHistory, refreshResults: pollResults, usesWorker: () => Boolean(worker), feeds };
}
