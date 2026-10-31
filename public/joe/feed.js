// Transport: the board server's state, history, closed-trade record and fleet
// settings, read through
// the shared acceptRead boundary and selector, then the board display policy.
// The clock is the server's, anchored to a monotonic timer, so a
// wrong browser clock cannot make old data look fresh.
import { acceptRead } from './contracts/read.mjs';
import { boardStates } from './board-state.js';
import { toColumns, sessionCloses, DESK_IDS } from './history-model.js';
import { indexResults } from './results-model.js';
import { acceptActions } from './settings-model.js';

export const POLL_DATA_MS = 15000;
export const POLL_HISTORY_MS = 30000;
export const TICK_MS = 1000;
// Before any server clock is known no feed holds a value (every read that
// brings one also brings the clock), so no state can depend on the instant;
// this fixed one only satisfies the selector's input.
const NO_CLOCK = '1970-01-01T00:00:00.000Z';

export { serverClock } from './transport.js';
import { readJSON, createBoardSession, acceptRecovery, documentRegressed } from './transport.js';

export function createFeed(onChange, measure = () => {}, version = '', { actionsWanted = () => false, session = createBoardSession() } = {}) {
  let anchor = null, serverPanels = {}, fleetTag = null;
  let frozen = null, selected = null;
  const unsubscribe = session.subscribe(() => {
    frozen = session.signedOut() ? selected ?? select() : null;
    worker?.postMessage({ frozen: session.signedOut() });
    onChange('session');
  });
  const read = async (url, init) => {
    const res = await readJSON(url, init);
    return session.accept(new URL(url, 'https://board/joe/').pathname, res) ? res : null;
  };
  // Where the server read the fleet settings from, and its change log.
  let fleetSource = null, actions = null;
  const feeds = { data: null, history: null, results: null, 'fleet-config': null };
  const reads = new Map();
  // Overlapping refreshes await the same bounded attempt, including acceptance.
  const poll = (kind, run) => {
    if (reads.has(kind)) return reads.get(kind);
    const promise = run().finally(() => { if (reads.get(kind) === promise) reads.delete(kind); });
    reads.set(kind, promise);
    return promise;
  };
  const now = () => frozen ? frozen.now : (anchor ? new Date(Math.round(anchor.serverMs + performance.now() - anchor.perf)).toISOString() : null);
  const settle = (key, value) => { feeds[key] = value; };
  const recoveryRead = (kind, incoming, status) => {
    const accepted = acceptRecovery(feeds[kind]?.value, incoming, status);
    if (!accepted.ok) session.invalidateRecovery(`/joe/${kind}.json`);
    return accepted;
  };

  // state.json's serverNow owns the clock once it has answered; until then
  // any other read's stamp (or, failing that, its HTTP date) anchors it.
  function anchorTo(serverNow, source, perf = performance.now()) {
    const ms = Date.parse(serverNow ?? '');
    if (!Number.isFinite(ms)) return;
    if (source === 'state' || !anchor || (anchor.source !== 'state' && (source === 'stamp' || anchor.source === 'date'))) {
      anchor = { serverMs: ms, perf, source };
    }
  }
  const anchorFrom = res => { if (res.clock) anchorTo(res.clock.at, res.clock.precise ? 'stamp' : 'date', res.at); };

  function pollState() { return poll('state', async () => {
    const res = await read('./state.json');
    if (!res || !session.accepting()) return;
    if (res.status !== 200 || !res.payload?.feeds) {
      if (res.status === 200) session.invalidateRecovery('/joe/state.json');
      // Keep the last good snapshot and its original receipts; only the reason changes.
      anchorFrom(res);
      settle('data', acceptRead('data', { status: res.status === 200 ? 0 : res.status, redirected: res.redirected }, feeds.data));
      onChange('data'); return;
    }
    anchorTo(res.payload.serverNow, 'state', res.at);
    const started = performance.now();
    const d = res.payload.feeds.data ?? {};
    settle('data', acceptRead('data', d.value
      ? { status: 200, payload: d.value, receivedAt: d.value.receivedAt, generatedAdvancedAt: d.generatedAdvancedAt, gatewayProgress: d.gatewayProgress, reason: d.reason ?? undefined }
      : { status: 503, payload: { reason: d.reason }, reason: d.reason ?? undefined }, feeds.data));
    if (d.value ? feeds.data.value !== d.value : Boolean(feeds.data.value)) session.invalidateRecovery('/joe/state.json');
    // History and results have their own worker-fed reads; only the data panels carry over.
    const { history: _history, results: _results, ...panels } = res.payload.panels ?? {};
    serverPanels = panels;
    measure('data-accept', performance.now() - started);
    onChange('data');
  }); }

  // History and the closed-trade record are read, parsed and validated in a
  // worker; the page only receives typed columns. Workers ignore the page's
  // import map, so the worker and every module it imports load under this
  // release's own path; another release's path is not served. Without module
  // workers the same steps run here.
  let worker = null;
  // A refresh completes when its worker reply has been accepted, including an
  // unchanged reply. Dispatch alone keeps the read pending: the next refresh would
  // otherwise silently skip the read (for example after a rejected push).
  const workerReads = new Map();
  const readInWorker = (kind, message) => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    workerReads.set(kind, { promise, resolve });
    worker.postMessage(message);
    return promise;
  };
  try {
    worker = new Worker(new URL(`./v/${encodeURIComponent(version)}/history-worker.js`, import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const kind = ['unchanged', 'blocked'].includes(data.kind) ? data.feed : data.kind;
      const pending = workerReads.get(kind);
      workerReads.delete(kind);
      try {
        const paths = kind === 'history' ? ['/joe/history.json', '/joe/history-continuity.json'] : ['/joe/results.json'];
        const evidence = paths.map(key => [key, data.status?.[key]]);
        // Even a blocked document reply reports every sibling's latest auth
        // outcome; its undecoded body cannot prove authenticated recovery.
        if (data.kind === 'blocked') {
          for (const [key, status] of evidence) {
            session.observe(key, { auth: status?.state === 'auth' ? true : status?.auth });
            session.invalidateRecovery(key);
          }
          return;
        }
        if (evidence.some(([, status]) => !['auth', 'ok', 'error'].includes(status?.state))) {
          for (const [key] of evidence) session.invalidateRecovery(key);
          return;
        }
        const acceptance = evidence.map(([key, status]) => {
          const accepted = session.accept(key, { auth: status?.state === 'auth' ? true : status?.auth });
          if (status.state !== 'ok' || status.auth !== false || status.reason) session.invalidateRecovery(key);
          return accepted;
        });
        const status = data.status?.[`/joe/${kind}.json`], document = status?.document;
        const prior = feeds[kind]?.value;
        const recovery = recoveryRead(kind, document, { ...status, valid: data.valid, reason: status?.reason ?? data.reason });
        if (evidence.some(([, s]) => s.state !== 'ok' || s.auth !== false || s.reason)) session.invalidateRecovery(`/joe/${kind}.json`);
        if (!session.accepting() || acceptance.includes(false)) return;
        if (data.clock) anchorTo(data.clock.at, data.clock.precise ? 'stamp' : 'date');
        measure(`${kind}-worker`, data.ms);
        // An unchanged hint still carries the attempt's reason and receipt.
        // It can confirm only the document already held by this page.
        if (data.kind === 'unchanged') {
          if (!prior || document?.seq !== prior.seq || document?.receivedAt !== prior.receivedAt) {
            session.invalidateRecovery(`/joe/${kind}.json`); return;
          }
          settle(kind, { ...feeds[kind], reason: recovery.reason,
            ...(data.generatedAdvancedAt ? { generatedAdvancedAt: data.generatedAdvancedAt } : {}) });
          onChange(kind); return;
        }
        if (documentRegressed(prior, document)) {
          settle(kind, { ...feeds[kind], reason: 'sequence_replayed' }); onChange(kind); return;
        }
        if (kind === 'results') { settle('results', resultsFeed(data.index, recovery.reason, data.generatedAdvancedAt)); onChange('results'); return; }
        settle('history', { value: data.meta ? { ...data.meta, columns: data.columns, closes: data.closes } : null, reason: recovery.reason });
        onChange('history');
      } finally { pending?.resolve(); }
    };
    worker.onerror = () => {
      const pending = [...workerReads.values()]; workerReads.clear();
      worker = null; reads.delete('history'); reads.delete('results');
      const complete = () => pending.forEach(read => read.resolve());
      Promise.all([pollHistory(), pollResults()]).then(complete, complete);
    };
  } catch { worker = null; }

  let fallback = null;
  function pollHistory() { return poll('history', async () => {
    if (worker) return readInWorker('history', 'poll');
    const [res, sidecar] = await Promise.all([read('./history.json'), read('./history-continuity.json')]);
    if (!res || !sidecar || !session.accepting()) {
      if (session.signedOut()) session.invalidateRecovery('/joe/history.json');
      return;
    }
    anchorFrom(res);
    const reason = res.headers?.get('X-Joe-Feed-Reason') ?? undefined;
    const started = performance.now();
    const accepted = acceptRead('history', res.status === 200 ? { status: 200, payload: res.payload, reason }
      : { status: res.status, redirected: res.redirected, payload: res.payload, reason: res.payload?.reason ?? undefined }, fallback);
    const recovery = recoveryRead('history', accepted.value, { state: res.status === 200 ? 'ok' : 'error', auth: res.auth,
      valid: res.status !== 200 || accepted.value === res.payload, reason: accepted.reason });
    if (sidecar.status !== 200 || sidecar.auth !== false || sidecar.headers?.get('X-Joe-Feed-Reason')) session.invalidateRecovery('/joe/history-continuity.json');
    if (documentRegressed(feeds.history?.value, accepted.value) || (!accepted.value && feeds.history?.value)) {
      settle('history', { ...feeds.history, reason: recovery.reason }); onChange('history'); return;
    }
    fallback = accepted;
    const v = accepted.value;
    const columns = v ? toColumns(v.points, sidecar.status === 200 ? sidecar.payload : null, v.seq) : null;
    settle('history', { value: v ? { schema: v.schema, seq: v.seq, generatedAt: v.generatedAt, receivedAt: v.receivedAt, compactedThrough: v.compactedThrough ?? null, reason: v.reason ?? null,
      points: v.points.length, columns, closes: Object.fromEntries(DESK_IDS.map(id => [id, sessionCloses(columns, id, 'totalPnl', 9)])) } : null, reason: recovery.reason });
    measure('history-accept', performance.now() - started);
    onChange('history');
  }); }

  // The accepted closed-trade record from the machine inbox. Keep its index,
  // original receipt and generation progress through refreshes and rejections.
  const resultsFeed = (index, reason, generatedAdvancedAt) => ({ value: index ? { ...index.meta, index } : null, reason: reason ?? null,
    ...(generatedAdvancedAt ? { generatedAdvancedAt } : {}) });
  let resultsFallback = null;
  function pollResults() { return poll('results', async () => {
    if (worker) return readInWorker('results', 'results');
    const res = await read('./results.json');
    if (!res || !session.accepting()) return;
    anchorFrom(res);
    const reason = res.headers?.get('X-Joe-Feed-Reason') ?? undefined;
    const started = performance.now();
    const previous = resultsFallback;
    const accepted = acceptRead('results', res.status === 200 ? { status: 200, payload: res.payload, reason,
      generatedAdvancedAt: res.headers?.get('X-Joe-Generated-Advanced-At') ?? undefined }
      : { status: res.status, redirected: res.redirected, payload: res.payload, reason: res.payload?.reason ?? undefined }, previous);
    const recovery = recoveryRead('results', accepted.value, { state: res.status === 200 ? 'ok' : 'error', auth: res.auth,
      valid: res.status !== 200 || accepted.value === res.payload, reason: accepted.reason });
    if (documentRegressed(feeds.results?.value, accepted.value) || (!accepted.value && feeds.results?.value)) {
      settle('results', { ...feeds.results, reason: recovery.reason }); onChange('results'); return;
    }
    resultsFallback = accepted;
    const v = accepted.value;
    const same = v && previous?.value === v && feeds.results?.value;
    settle('results', same ? { ...feeds.results, reason: recovery.reason }
      : resultsFeed(v ? indexResults(v) : null, recovery.reason, accepted.generatedAdvancedAt));
    measure('results-accept', performance.now() - started);
    onChange('results');
  }); }

  function pollFleet() { return poll('fleet', async () => {
    const res = await read('./fleet-config.json', fleetTag ? { headers: { 'If-None-Match': fleetTag } } : {});
    if (!res || !session.accepting()) return;
    anchorFrom(res);
    // Only a conditional response for the validated saved document can clear
    // a rejection. Its receipt still belongs to the original read.
    if (res.status === 304 && fleetTag && feeds['fleet-config']?.value && res.headers?.get('ETag') === fleetTag) {
      if (feeds['fleet-config'].reason != null) {
        settle('fleet-config', { ...feeds['fleet-config'], reason: null });
        onChange('fleet');
      }
      return;
    }
    const accepted = acceptRead('fleet-config', res.status === 200
      ? { status: 200, payload: res.payload, receivedAt: res.headers.get('X-Joe-Received-At') ?? undefined }
      : { status: res.status, redirected: res.redirected, payload: res.payload }, feeds['fleet-config']);
    if (res.status === 200 && !accepted.reason) {
      fleetTag = res.headers.get('ETag');
      const path = res.headers.get('X-Joe-Fleet-Source-Path'), kind = res.headers.get('X-Joe-Fleet-Source-Kind');
      fleetSource = { path: path && /^\/[\x20-\x7e]{1,200}$/.test(path) ? path : null, kind: ['stored', 'example'].includes(kind) ? kind : null };
    }
    if (accepted.reason === 'contract_invalid') session.invalidateRecovery('/joe/fleet-config.json');
    settle('fleet-config', accepted);
    onChange('fleet');
  }); }

  // The fleet settings' change log: every send to the desks, newest first.
  // A failed read keeps the last good log and says why.
  function pollActions() { return poll('actions', async () => {
    const res = await read('./fleet-config/actions.json');
    if (!res || !session.accepting()) return;
    anchorFrom(res);
    const entries = res.status === 200 ? acceptActions(res.payload) : null;
    if (!entries && res.status === 200) session.invalidateRecovery('/joe/fleet-config/actions.json');
    actions = entries ? { entries, reason: null } : { entries: actions?.entries ?? null, reason: res.auth ? 'auth_required' : res.status === 200 ? 'contract_invalid' : 'refresh_failed' };
    onChange('actions');
  }); }

  // Every panel through the shared selector at the anchored server time. The
  // server's own panels carry retained last-good values and their receipts.
  // Without any server clock each panel still gets its state and reason: a
  // value that arrived without one cannot be dated, so it is not shown.
  function select() {
    if (frozen) return frozen;
    const at = now();
    const input = Object.fromEntries(Object.entries(feeds).filter(([, feed]) => feed));
    if (at) return (selected = { now: at, feeds: input, states: boardStates(input, at, serverPanels), fleetSource, actions });
    const undated = Object.fromEntries(Object.entries(input).map(([key, feed]) => [key, feed.value == null ? feed : { value: null, reason: feed.reason ?? null }]));
    return (selected = { now: null, feeds: undated, states: boardStates(undated, NO_CLOCK, {}), fleetSource, actions });
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
      setInterval(() => { pollHistory(); pollResults(); pollFleet(); if (actionsWanted() || session.signedOut()) pollActions(); }, POLL_HISTORY_MS),
      setInterval(() => { if (!session.signedOut()) onChange('tick'); }, TICK_MS),
    ];
  }
  const stop = () => { timers.forEach(clearInterval); timers = []; worker?.terminate?.(); unsubscribe(); };
  const refresh = () => Promise.all([pollFleet(), pollState(), pollHistory(), pollResults()]);
  return { start, stop, whenIdle: () => Promise.all([...reads.values()]), select, now, settled, signedOut: session.signedOut, refresh, refreshState: pollState, refreshHistory: pollHistory, refreshResults: pollResults, refreshFleet: pollFleet, refreshActions: pollActions, usesWorker: () => Boolean(worker), feeds };
}
