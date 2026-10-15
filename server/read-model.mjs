import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONTRACTS, REASONS, validateContract } from '../contracts/index.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates, DATA_PANELS, MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { gatewayCheckAgeMs } from '../contracts/gateway.mjs';
import { validInstant } from '../contracts/schema-validator.mjs';
import { atomicWrite, readJson } from './storage.mjs';
import { appendHistory, historyEnvelope, HISTORY_CAP, measureHistory } from './history.mjs';

const STATE_CAP = 2 * 1024 * 1024;
const FORMAT = 'joedesk.data-store.v2';
const isMissing = error => error.code === 'ENOENT';
const failed = (status, reason) => ({ ok: false, status, reason });
// JSON object order is immaterial. Hash only the validated ingress payload;
// the server's receipt is deliberately excluded when comparing a stored value.
const payloadDigest = value => createHash('sha256').update(JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ?
    Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)).digest('hex');

export function createReadModel({ dataDir, clock = () => new Date().toISOString(), write = atomicWrite }) {
  const stateFile = path.join(dataDir, 'data-state.json');
  const historyFile = path.join(dataDir, 'history-state.json');
  const rejectionFile = path.join(dataDir, 'feed-rejections.json');
  const fleetFile = path.join(dataDir, 'fleet-receipt.json');
  let state = null, history = null, rejections = {}, fleet = null, storageInvalid = false, historyStorageInvalid = false;
  try {
    state = readJson(stateFile, STATE_CAP);
    if (state.format !== FORMAT || !validateContract('data', state.feed?.value).ok ||
        !validInstant(state.feed.generatedAdvancedAt) || Date.parse(state.feed.generatedAdvancedAt) > Date.parse(state.feed.value.receivedAt) || !state.cells ||
        Object.keys(state.cells).length !== DATA_PANELS.length ||
        DATA_PANELS.some(name => !state.cells[name] || !Object.hasOwn(state.cells[name], 'value') ||
          !Object.hasOwn(state.cells[name], 'valueReceivedAt') || (state.cells[name].value != null &&
            (!validInstant(state.cells[name].valueReceivedAt) || Date.parse(state.cells[name].valueReceivedAt) > Date.parse(state.feed.value.receivedAt)))) ||
        (state.gatewayProgress && (!validInstant(state.gatewayProgress.checkedAt) ||
          !validInstant(state.gatewayProgress.advancedAt) || !Number.isFinite(state.gatewayProgress.initialAgeMs) || state.gatewayProgress.initialAgeMs < 0))) {
      throw new Error('contract_invalid');
    }
  } catch (error) { state = null; if (!isMissing(error)) { storageInvalid = true; rejections.data = 'contract_invalid'; } }
  try {
    const stored = readJson(historyFile, HISTORY_CAP);
    history = stored.value;
    if (stored.format !== 'joedesk.history-store.v2' || !validateContract('history', history).ok ||
        measureHistory(structuredClone(history)) !== history.sizeBytes) throw new Error('contract_invalid');
  } catch (error) {
    history = null;
    if (!isMissing(error)) { historyStorageInvalid = true; rejections.history = 'history_write_failed'; }
  }
  try {
    const stored = readJson(rejectionFile, 16384);
    if (Object.keys(stored).some(k => !['data', 'history'].includes(k)) || Object.values(stored).some(r => !REASONS.includes(r))) throw new Error('contract_invalid');
    rejections = { ...stored, ...rejections };
  } catch (error) { if (!isMissing(error)) rejections.data = 'contract_invalid'; }
  try {
    fleet = readJson(fleetFile, CONTRACTS.limits['fleet-config'] + 4096);
    if (!validInstant(fleet.receivedAt) || !validateContract('fleet-config', fleet.value).ok) throw new Error('contract_invalid');
  } catch (error) { fleet = null; if (!isMissing(error)) rejections['fleet-config'] = 'contract_invalid'; }
  let savedReasons = JSON.stringify(Object.fromEntries(Object.entries(rejections).filter(([k]) => ['data', 'history'].includes(k))));

  const feeds = () => ({ data: { ...state?.feed, gatewayProgress: state?.gatewayProgress, reason: rejections.data ?? (state ? null : 'feed_not_received') },
    history: { value: history, reason: rejections.history ?? (history ? null : 'feed_not_received') },
    results: { value: null, reason: 'results_not_wired' },
    'fleet-config': { value: fleet?.value, receivedAt: fleet?.receivedAt, reason: rejections['fleet-config'] ?? (fleet ? null : 'feed_not_received') } });
  const panels = (now = clock()) => panelStates(feeds(), now, state?.cells ?? {});
  function persistReasons() {
    const reasons = Object.fromEntries(Object.entries(rejections).filter(([k]) => ['data', 'history'].includes(k)));
    const encoded = JSON.stringify(reasons);
    if (encoded === savedReasons) return;
    write(rejectionFile, reasons, 16384); savedReasons = encoded;
  }
  function reject(reason, status = 422) {
    rejections.data = reason;
    try { persistReasons(); } catch { return failed(500, 'refresh_failed'); }
    return failed(status, reason);
  }
  function accept(candidate) {
    const now = clock();
    if (storageInvalid) return failed(503, 'contract_invalid');
    const accepted = acceptSnapshot('data', candidate, state?.feed ?? null, now);
    if (accepted.status !== 200) {
      const errors = accepted.errors.slice(0, 20).map(({ path, rule }) => ({ path, rule }));
      if (accepted.reason === 'sequence_replayed' && candidate.seq === state?.feed.value.seq) {
        const { receivedAt, ...previous } = state.feed.value;
        if (payloadDigest(candidate) === payloadDigest(previous)) return { ...failed(422, accepted.reason), errors };
      }
      return { ...reject(accepted.reason), errors };
    }
    const check = candidate.safety.gateway;
    let gatewayProgress = state?.gatewayProgress ?? null;
    const checkAge = gatewayCheckAgeMs(check, candidate.generatedAt);
    // A future check can describe an unconfirmed outage, but cannot poison the
    // durable advancement watermark and prevent a genuine later recovery.
    if (checkAge !== null && gatewayProgress && Date.parse(check.checkedAt) < Date.parse(gatewayProgress.checkedAt)) return {
      ...reject('clock_regressed'), errors: [{ path: '$.safety.gateway.checkedAt', rule: 'clockRegressed' }],
    };
    if (checkAge !== null && check.checkedAt !== gatewayProgress?.checkedAt) {
      gatewayProgress = { checkedAt: check.checkedAt, advancedAt: now,
        initialAgeMs: checkAge };
    }
    const nextFeeds = { ...feeds(), data: { ...accepted, gatewayProgress } };
    const selected = panelStates(nextFeeds, now, state?.cells ?? {});
    // Only current observations advance receipt metadata. Retained cells keep
    // their original receipt, including false HALT and known-empty row sets.
    const cells = Object.fromEntries(DATA_PANELS.map(name => {
      const cell = selected[name];
      return [name, { value: cell.value ?? null, valueReceivedAt: cell.valueReceivedAt ?? null }];
    }));
    const next = { format: FORMAT, feed: { value: accepted.value, generatedAdvancedAt: accepted.generatedAdvancedAt }, gatewayProgress, cells };
    let stateSyncFailed = false;
    try { write(stateFile, next, STATE_CAP); }
    catch (error) {
      if (!error.committed) return reject('refresh_failed', 500);
      // Rename already advanced the durable sequence. Record its history point
      // before replying, since the producer's retry will be a replay.
      stateSyncFailed = true;
    }
    state = next; delete rejections.data;
    // Snapshot is durable even if the independent history store fails.
    let historyReason = rejections.history ?? null;
    // An unreadable history store stays untouched until operator recovery.
    // Its independent alarm must not prevent the money board from advancing.
    if (!historyStorageInvalid) try {
      const nextHistory = appendHistory(history, accepted.value, selected, now);
      if (nextHistory !== history) {
        try { write(historyFile, historyEnvelope(nextHistory), HISTORY_CAP); }
        catch (error) { if (error.committed) history = nextHistory; throw error; }
        delete rejections.history;
      }
      history = nextHistory;
      historyReason = rejections.history ?? history.reason ?? null;
    } catch (error) {
      historyReason = error.message === 'history_size_limit' ? error.message : 'history_write_failed';
      rejections.history = historyReason;
    }
    if (stateSyncFailed) return reject('refresh_failed', 500);
    try { persistReasons(); } catch { rejections.data = 'refresh_failed'; return failed(500, 'refresh_failed'); }
    return { ok: true, status: 200, reason: null, receivedAt: now, historyPoints: history?.points.length ?? 0, historyReason };
  }
  function observeFleet(value) {
    const checked = validateContract('fleet-config', value);
    if (!checked.ok) { rejections['fleet-config'] = checked.reason; return checked; }
    if (fleet?.value.rev === value.rev) {
      if (JSON.stringify(fleet.value) !== JSON.stringify(value)) { rejections['fleet-config'] = 'contract_invalid'; return failed(503, 'contract_invalid'); }
      delete rejections['fleet-config']; return { ok: true };
    }
    const now = clock();
    if (fleet && Date.parse(now) < Date.parse(fleet.receivedAt)) return failed(503, 'clock_regressed');
    const next = { value, receivedAt: now };
    try { write(fleetFile, next, CONTRACTS.limits['fleet-config'] + 4096); }
    catch { rejections['fleet-config'] = 'refresh_failed'; return failed(503, 'refresh_failed'); }
    fleet = next; delete rejections['fleet-config']; return { ok: true };
  }
  function view(now = clock()) {
    const selected = panels(now);
    const source = feeds();
    // Feed rejection is a separate header/state diagnostic. Only actual
    // session or KEEP-policy constraints may withhold snapshot values.
    const projection = panelStates({ ...source, data: { ...source.data, reason: null } }, now, state?.cells ?? {});
    let value = state?.feed.value ? structuredClone(state.feed.value) : null;
    if (value) {
      const setBag = (bag, prefix) => {
        for (const field of MONEY_FIELDS) if (projection[`${prefix}.${field}`].state === 'broken' &&
            (projection[`${prefix}.${field}`].retained || projection[`${prefix}.${field}`].value == null)) {
          bag[field] = null; (bag.reasons ??= {})[field] = projection[`${prefix}.${field}`].reason;
        }
      };
      setBag(value.totals, 'today');
      for (const desk of value.desks) { setBag(desk.money, `desks.${desk.id}`); if (MONEY_FIELDS.every(f => desk.money[f] == null)) delete desk.moneyEvidence; }
      if (value.brokerAccount && projection.paperAccount.state === 'broken' &&
          (projection.paperAccount.retained || projection.paperAccount.value == null)) {
        value.brokerAccount.equity = null; value.brokerAccount.reason = projection.paperAccount.reason;
      }
      for (const [period, field] of [['day', 'dayPnl'], ['open', 'openPnl']]) {
        if (value.pnlSources?.[period] && state.feed.value.totals[field] != null && value.totals[field] == null) value.pnlSources[period] = {
          ...value.pnlSources[period], status: 'unavailable', reason: value.totals.reasons?.[field] ?? 'family_projection_unavailable' };
      }
      if (value.positions && projection.positions.state === 'broken' &&
          (projection.positions.retained || projection.positions.value == null || projection.positions.reason === 'source_not_authoritative')) {
        value.positions.reason = projection.positions.reason;
        value.positions.rows = value.positions.rows.map(row => ({ ...row,
          ...Object.fromEntries(['mark', 'marketValue', 'dayPnl', 'openPnl'].filter(f => Object.hasOwn(row, f)).map(f => [f, null])) }));
      }
    }
    return { serverNow: now, feeds: feeds(), panels: selected, data: value };
  }
  return { accept, reject, feeds, panels, view, observeFleet,
    fleetFailure: () => { rejections['fleet-config'] = 'refresh_failed'; },
    hasData: () => Boolean(state) };
}
