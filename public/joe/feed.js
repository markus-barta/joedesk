// Transport: the board server's state, history and fleet settings, read through
// the shared acceptRead boundary and ranked only by the shared panelStates
// selector. The clock is the server's, anchored to a monotonic timer, so a
// wrong browser clock cannot make old data look fresh.
import { acceptRead } from './contracts/read.mjs';
import { panelStates } from './contracts/panel-state.mjs';
import { toColumns, sessionCloses, DESK_IDS } from './history-model.js';

export const POLL_DATA_MS = 15000;
export const POLL_HISTORY_MS = 30000;
export const TICK_MS = 1000;

const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
async function read(url, init = {}) {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual', ...init });
    if (response.type === 'opaqueredirect') return { status: 302, redirected: true };
    if (AUTH.has(response.status) || response.status === 304) return { status: response.status, headers: response.headers };
    let payload = null;
    try { payload = await response.json(); } catch { if (response.ok) return { status: 0 }; }
    return { status: response.status, payload, headers: response.headers };
  } catch {
    return { status: 0 };
  }
}

export function createFeed(onChange, measure = () => {}, version = '') {
  let anchor = null, serverPanels = {}, fleetTag = null;
  const feeds = { data: null, history: null, results: { value: null, reason: 'results_not_wired' }, 'fleet-config': null };
  const busy = new Set();
  const now = () => (anchor ? new Date(Math.round(anchor.serverMs + performance.now() - anchor.perf)).toISOString() : null);
  const settle = (key, value) => { feeds[key] = value; };

  function anchorTo(serverNow) {
    const ms = Date.parse(serverNow ?? '');
    if (Number.isFinite(ms)) anchor = { serverMs: ms, perf: performance.now() };
  }

  async function pollState() {
    if (busy.has('state')) return;
    busy.add('state');
    const res = await read('./state.json');
    busy.delete('state');
    if (res.status !== 200 || !res.payload?.feeds) {
      // Keep the last good snapshot and its original receipts; only the reason changes.
      settle('data', acceptRead('data', { status: res.status === 200 ? 0 : res.status, redirected: res.redirected }, feeds.data));
      onChange('data'); return;
    }
    anchorTo(res.payload.serverNow);
    const started = performance.now();
    const d = res.payload.feeds.data ?? {};
    settle('data', acceptRead('data', d.value
      ? { status: 200, payload: d.value, receivedAt: d.value.receivedAt, generatedAdvancedAt: d.generatedAdvancedAt, gatewayProgress: d.gatewayProgress, reason: d.reason ?? undefined }
      : { status: 503, payload: { reason: d.reason }, reason: d.reason ?? undefined }, feeds.data));
    if (res.payload.feeds.results) settle('results', { value: null, reason: res.payload.feeds.results.reason ?? 'results_not_wired' });
    // History has its own worker-fed feed; only the data panels carry over.
    const { history: _history, ...panels } = res.payload.panels ?? {};
    serverPanels = panels;
    measure('data-accept', performance.now() - started);
    onChange('data');
  }

  // History is read, parsed and validated in a worker; the page only receives
  // typed columns. Without module workers the same steps run here.
  let worker = null;
  try {
    worker = new Worker(new URL(`./history-worker.js?v=${encodeURIComponent(version)}`, import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      busy.delete('history');
      measure('history-accept', data.ms);
      if (data.kind === 'unchanged') return;
      settle('history', { value: data.meta ? { ...data.meta, columns: data.columns, closes: data.closes } : null, reason: data.reason });
      onChange('history');
    };
    worker.onerror = () => { worker = null; busy.delete('history'); };
  } catch { worker = null; }

  async function pollHistory() {
    if (busy.has('history')) return;
    busy.add('history');
    if (worker) { worker.postMessage('poll'); return; }
    const res = await read('./history.json');
    busy.delete('history');
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
  let fallback = null;

  async function pollFleet() {
    if (busy.has('fleet')) return;
    busy.add('fleet');
    const res = await read('./fleet-config.json', fleetTag ? { headers: { 'If-None-Match': fleetTag } } : {});
    busy.delete('fleet');
    if (res.status === 304) return;
    if (res.status === 200) fleetTag = res.headers.get('ETag');
    settle('fleet-config', acceptRead('fleet-config', res.status === 200
      ? { status: 200, payload: res.payload, receivedAt: res.headers.get('X-Joe-Received-At') ?? undefined }
      : { status: res.status, redirected: res.redirected, payload: res.payload }, feeds['fleet-config']));
    onChange('fleet');
  }

  // Every panel through the shared selector at the anchored server time. The
  // server's own panels carry retained last-good values and their receipts.
  function select() {
    const at = now();
    if (!at) return null;
    const input = Object.fromEntries(Object.entries(feeds).filter(([, feed]) => feed));
    return { now: at, feeds: input, states: panelStates(input, at, serverPanels) };
  }

  let timers = [];
  function start() {
    pollFleet().then(pollState);
    pollHistory();
    timers = [
      setInterval(pollState, POLL_DATA_MS),
      setInterval(() => { pollHistory(); pollFleet(); }, POLL_HISTORY_MS),
      setInterval(() => onChange('tick'), TICK_MS),
    ];
  }
  const stop = () => { timers.forEach(clearInterval); timers = []; };
  const refresh = () => Promise.all([pollFleet(), pollState(), pollHistory()]);
  return { start, stop, select, now, refresh, refreshHistory: pollHistory, feeds };
}
