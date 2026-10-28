import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTRACTS, REASONS, validateContract } from '../contracts/index.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates, panelState, DATA_PANELS, MONEY_FIELDS } from '../contracts/panel-state.mjs';
import { gatewayCheckAgeMs } from '../contracts/gateway.mjs';
import { validInstant } from '../contracts/schema-validator.mjs';
import { viennaDay } from '../contracts/vienna-date.mjs';
import { atomicWrite, readJson } from './storage.mjs';
import { appendHistory, historyEnvelope, HISTORY_CAP, measureHistory } from './history.mjs';

const STATE_CAP = 2 * 1024 * 1024;
const FORMAT = 'joedesk.data-store.v2';
const RESULTS_FORMAT = 'joedesk.results-store.v2';
// The snapshot is bounded by the contracts package; leave room only for the
// server-owned envelope and generation-progress metadata on disk.
const RESULTS_CAP = CONTRACTS.limits.results + 4096;
const ROLLOVER_RESEND_MAX_SKEW_MS = 5 * 60 * 1000;
const isMissing = error => error.code === 'ENOENT';
const failed = (status, reason) => ({ ok: false, status, reason });
// Board retention policy, independent of the immutable rev-10 selector.
// Keep aligned with public/joe/board-state.js, including rev-9 missing SOD.
const NOT_EXACT_REASONS = new Set(['not_exact_yet', 'sod_missing', 'ledger_unreconciled', 'position_stale', 'baseline_pending', 'day_pnl_unavailable']);
function fieldReasons(data, name) {
  const field = name.split('.').at(-1);
  const desk = name.startsWith('desks.') ? data?.desks.find(d => d.id === name.split('.')[1]) : null;
  const bag = desk?.money ?? data?.totals;
  const period = field === 'dayPnl' ? 'day' : field === 'openPnl' ? 'open' : null;
  const reasons = name === 'paperAccount' ? [data?.brokerAccount?.reason]
    : name === 'paperCash' ? [data?.brokerAccount?.reasons?.cash]
      : ['positions', 'kept'].includes(name) ? [data?.positions?.reason]
        : [bag?.reasons?.[field], period ? (desk?.pnlSources?.[period] ?? data?.pnlSources?.[period])?.reason : null];
  return reasons;
}
const exactnessFailure = (data, name) => fieldReasons(data, name).some(reason => NOT_EXACT_REASONS.has(reason));
// Legacy producers may attach retained_values to a non-null amount. Only a
// previously verified observation can fill that unavailable current input.
function policyPanels(feeds, now, previous = {}) {
  const selected = panelStates(feeds, now, previous);
  for (const name of DATA_PANELS) if (fieldReasons(feeds.data?.value, name).includes('retained_values')) {
    const prior = previous[name];
    selected[name] = panelState(feeds.data, null, selected[name].reason ?? 'retained_values', now,
      prior?.value, prior?.valueReceivedAt);
  }
  return selected;
}
function daySource(data, name) {
  const desk = name.startsWith('desks.') ? data?.desks.find(d => d.id === name.split('.')[1]) : null;
  return (desk?.pnlSources?.day ?? data?.pnlSources?.day) ?? null;
}
function dayObservedAt(data, name) {
  return daySource(data, name)?.observedAt ?? data?.generatedAt ?? null;
}
// JSON object order is immaterial. Hash only the validated ingress payload;
// the server's receipt is deliberately excluded when comparing a stored value.
const payloadDigest = value => createHash('sha256').update(JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ?
    Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)).digest('hex');

function resultsRolloverDay(candidate, errors, receivedAt) {
  if (!validInstant(candidate?.generatedAt) || !errors.length) return null;
  const skew = Date.parse(receivedAt) - Date.parse(candidate.generatedAt);
  if (skew <= 0 || skew > ROLLOVER_RESEND_MAX_SKEW_MS) return null;
  const generatedDay = viennaDay(candidate.generatedAt);
  // Advance the date key in UTC, not the local instant by an elapsed 24 hours.
  const nextDay = new Date(`${generatedDay}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (viennaDay(receivedAt) !== nextDay.toISOString().slice(0, 10)) return null;
  return errors.every(({ path, rule }) => {
    const match = /^\$\.days\[(\d+)\]\.partialReasons$/.exec(path);
    return rule === 'partialReasonsRequired' && match && candidate.days[Number(match[1])]?.date === generatedDay;
  }) ? generatedDay : null;
}

export function createReadModel({ dataDir, clock = () => new Date().toISOString(), write = atomicWrite }) {
  if (['data.json', 'history.json'].some(name => existsSync(path.join(dataDir, name)))) throw new Error('data_migration_required');
  const stateFile = path.join(dataDir, 'data-state.json');
  const historyFile = path.join(dataDir, 'history-state.json');
  const resultsFile = path.join(dataDir, 'results-state.json');
  const rejectionFile = path.join(dataDir, 'feed-rejections.json');
  const fleetFile = path.join(dataDir, 'fleet-receipt.json');
  let state = null, history = null, rejections = {}, fleet = null, storageInvalid = false, historyStorageInvalid = false;
  let fleetReceiptPending = false;
  let results = null, resultsStorageInvalid = false;
  // One exemption until a successful results acceptance; restart re-arms it.
  let rolloverResendPending = false;
  try {
    state = readJson(stateFile, STATE_CAP);
    // Rev 7 stores have every original cell and no cash observation. Accept
    // that exact older shape without discarding the sequence or last-goods.
    if (state.format === FORMAT && state.cells && !Object.hasOwn(state.cells, 'paperCash') &&
        !Object.hasOwn(state.feed?.value?.brokerAccount ?? {}, 'cash')) {
      state.cells.paperCash = { value: null, valueReceivedAt: null };
    }
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
    // Pre-34 stores have no Today provenance and cannot prove the exactness
    // of last-goods hidden by a later outage. Drop kept day/equity once,
    // preserving current observations, receipt/sequence and unrelated cells.
    const dayPanels = DATA_PANELS.filter(name => name.endsWith('.dayPnl'));
    const legacyLastGoods = dayPanels.every(name => !Object.hasOwn(state.cells[name], 'valueSource'));
    for (const name of DATA_PANELS) if (exactnessFailure(state.feed.value, name) ||
        (fieldReasons(state.feed.value, name).includes('retained_values') &&
          state.cells[name].valueReceivedAt === state.feed.value.receivedAt) ||
        (legacyLastGoods && /\.(?:dayPnl|equity)$/.test(name) && state.cells[name].value != null &&
          state.cells[name].valueReceivedAt !== state.feed.value.receivedAt)) {
      state.cells[name] = { value: null, valueReceivedAt: null,
        ...(name.endsWith('.dayPnl') ? { valueObservedAt: null, valueSource: null } : {}) };
    }
    // Release 36 renewed receipts on frozen re-sends. No observation can be
    // newer than the last generation advance; restore that original anchor.
    for (const cell of Object.values(state.cells)) if (cell.value != null &&
        Date.parse(cell.valueReceivedAt) > Date.parse(state.feed.generatedAdvancedAt)) {
      cell.valueReceivedAt = state.feed.generatedAdvancedAt;
    }
    if (legacyLastGoods) {
      // Explicit provenance keys mark the upgraded shape, even when all
      // Today cells are empty. Current observations keep their source and date.
      for (const name of dayPanels) Object.assign(state.cells[name], {
        valueObservedAt: state.cells[name].value == null ? null : dayObservedAt(state.feed.value, name),
        valueSource: state.cells[name].value == null ? null : daySource(state.feed.value, name),
      });
      // Best effort: keep the cleaned memory if storage fails. The next
      // accepted snapshot persists it; otherwise next boot repeats the clean.
      try { write(stateFile, state, STATE_CAP); }
      catch (error) { console.error('read-model: upgrade_write_failed', error?.code ?? 'unknown'); }
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
    results = readJson(resultsFile, RESULTS_CAP);
    if (results.format !== RESULTS_FORMAT || !validateContract('results', results.feed?.value).ok ||
        !validInstant(results.feed.generatedAdvancedAt) ||
        Date.parse(results.feed.generatedAdvancedAt) > Date.parse(results.feed.value.receivedAt)) throw new Error('contract_invalid');
  } catch (error) {
    results = null;
    if (!isMissing(error)) { resultsStorageInvalid = true; rejections.results = 'contract_invalid'; }
  }
  try {
    const stored = readJson(rejectionFile, 16384);
    if (Object.keys(stored).some(k => !['data', 'history', 'results'].includes(k)) || Object.values(stored).some(r => !REASONS.includes(r))) throw new Error('contract_invalid');
    rejections = { ...stored, ...rejections };
  } catch (error) { if (!isMissing(error)) rejections.data = 'contract_invalid'; }
  try {
    fleet = readJson(fleetFile, CONTRACTS.limits['fleet-config'] + 4096);
    if (!validInstant(fleet.receivedAt) || !validateContract('fleet-config', fleet.value).ok) throw new Error('contract_invalid');
  } catch (error) { fleet = null; if (!isMissing(error)) rejections['fleet-config'] = 'contract_invalid'; }
  const durableReasons = () => Object.fromEntries(Object.entries(rejections).filter(([k]) => ['data', 'history', 'results'].includes(k)));
  let savedReasons = JSON.stringify(durableReasons());

  const feeds = () => ({ data: { ...state?.feed, gatewayProgress: state?.gatewayProgress, reason: rejections.data ?? (state ? null : 'feed_not_received') },
    history: { value: history, reason: rejections.history ?? (history ? null : 'feed_not_received') },
    results: { ...results?.feed, reason: rejections.results ?? (results ? null : 'feed_not_received') },
    'fleet-config': { value: fleet?.value, receivedAt: fleet?.receivedAt, reason: rejections['fleet-config'] ?? (fleet ? null : 'feed_not_received') } });
  const panels = (now = clock()) => {
    const selected = policyPanels(feeds(), now, state?.cells ?? {});
    for (const name of DATA_PANELS.filter(n => n.endsWith('.dayPnl'))) {
      const cell = selected[name];
      cell.valueObservedAt = cell.retained ? state?.cells[name]?.valueObservedAt ?? cell.valueReceivedAt
        : dayObservedAt(state?.feed.value, name);
      cell.valueSource = cell.retained ? state?.cells[name]?.valueSource ?? null : daySource(state?.feed.value, name);
    }
    return selected;
  };
  function persistReasons() {
    const reasons = durableReasons();
    const encoded = JSON.stringify(reasons);
    if (encoded === savedReasons) return;
    write(rejectionFile, reasons, 16384); savedReasons = encoded;
  }
  function reject(reason, status = 422, kind = 'data') {
    rejections[kind] = reason;
    try { persistReasons(); } catch { return failed(kind === 'results' ? 503 : 500, 'refresh_failed'); }
    return failed(status, reason);
  }
  function acceptResults(candidate) {
    if (resultsStorageInvalid) return failed(503, 'contract_invalid');
    const now = clock();
    const accepted = acceptSnapshot('results', candidate, results?.feed ?? null, now);
    if (accepted.status !== 200) {
      const errors = accepted.errors.slice(0, 20).map(({ path, rule }) => ({ path, rule }));
      // Like data, an exact retry is a rejected no-op: it cannot freshen the
      // record, overwrite a different rejection or change the displayed state.
      if (accepted.reason === 'sequence_replayed' && candidate.seq === results?.feed.value.seq) {
        const { receivedAt, missingDays, ...previous } = results.feed.value;
        if (payloadDigest(candidate) === payloadDigest(previous)) return { ...failed(422, accepted.reason), errors };
      }
      const rolloverDay = !rolloverResendPending && resultsRolloverDay(candidate, accepted.errors, now);
      if (rolloverDay) {
        rolloverResendPending = true;
        console.info(JSON.stringify({ event: 'rollover_resend_pending', generatedAt: candidate.generatedAt,
          receivedAt: now, days: [rolloverDay] }));
        return { ...failed(422, accepted.reason), errors };
      }
      return { ...reject(accepted.reason, 422, 'results'), errors };
    }
    // Receipt stamping must not turn a valid ingress into an oversized,
    // unreadable served snapshot, especially at the 8 MiB boundary.
    const served = validateContract('results', accepted.value);
    if (!served.ok) return { ...reject(served.reason, 422, 'results'),
      errors: served.errors.slice(0, 20).map(({ path, rule }) => ({ path, rule })) };
    const next = { format: RESULTS_FORMAT, feed: { value: accepted.value, generatedAdvancedAt: accepted.generatedAdvancedAt } };
    try { write(resultsFile, next, RESULTS_CAP); }
    catch (error) {
      // A rename may have committed before the directory fsync failed. Honor
      // that sequence in memory too; never let a retry replace committed data.
      if (error.committed) results = next;
      return reject('refresh_failed', 503, 'results');
    }
    results = next; delete rejections.results;
    try { persistReasons(); }
    catch { rejections.results = 'refresh_failed'; return failed(503, 'refresh_failed'); }
    rolloverResendPending = false;
    return { ok: true, status: 200, reason: null, receivedAt: now };
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
    // Validate the receipt-stamped form before any snapshot/history write.
    const served = validateContract('data', accepted.value);
    if (!served.ok) return { ...reject(served.reason),
      errors: served.errors.slice(0, 20).map(({ path, rule }) => ({ path, rule })) };
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
    const selected = policyPanels(nextFeeds, now, state?.cells ?? {});
    // Only current observations advance receipt metadata. Retained cells keep
    // their original receipt, including false HALT and known-empty row sets.
    const cells = Object.fromEntries(DATA_PANELS.map(name => {
      const cell = selected[name];
      // Even value + reason is legal in rev 9 for some fields. It is never
      // last-good, and must invalidate an older exact observation too.
      if (exactnessFailure(accepted.value, name)) return [name, { value: null, valueReceivedAt: null,
        ...(name.endsWith('.dayPnl') ? { valueObservedAt: null, valueSource: null } : {}) }];
      // A new transport receipt for the same generation is not an observation.
      // Keep exactness invalidation above, but never renew last-good provenance.
      if (state && accepted.value.generatedAt === state.feed.value.generatedAt) return [name, state.cells[name]];
      return [name, { value: cell.value ?? null, valueReceivedAt: cell.value == null ? null : cell.valueReceivedAt ?? null,
        ...(name.endsWith('.dayPnl') ? { valueObservedAt: cell.retained ? state?.cells[name]?.valueObservedAt ?? cell.valueReceivedAt
          : dayObservedAt(accepted.value, name),
          valueSource: cell.retained ? state?.cells[name]?.valueSource ?? null : daySource(accepted.value, name) } : {}) }];
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
    // The starter is only a first-use policy, never recovery for a lost file.
    if (value.rev === 'fc-000000' && fleet && fleet.value.rev !== value.rev) {
      rejections['fleet-config'] = 'refresh_failed'; return failed(503, 'refresh_failed');
    }
    if (fleet?.value.rev === value.rev) {
      if (JSON.stringify(fleet.value) !== JSON.stringify(value)) { rejections['fleet-config'] = 'contract_invalid'; return failed(503, 'contract_invalid'); }
      if (!fleetReceiptPending) { delete rejections['fleet-config']; return { ok: true }; }
    } else {
      const now = clock();
      if (fleet && Date.parse(now) < Date.parse(fleet.receivedAt)) return failed(503, 'clock_regressed');
      // The validated source policy governs immediately, even when its
      // ancillary receipt cannot be saved. Never fall back to the old KEEP.
      fleet = { value, receivedAt: now };
      fleetReceiptPending = true;
    }
    // Retry the original observation without renewing its age.
    try { write(fleetFile, fleet, CONTRACTS.limits['fleet-config'] + 4096); }
    catch { rejections['fleet-config'] = 'refresh_failed'; return failed(503, 'refresh_failed'); }
    fleetReceiptPending = false; delete rejections['fleet-config']; return { ok: true };
  }
  function view(now = clock()) {
    const selected = panels(now);
    const source = feeds();
    // Feed rejection is a separate header/state diagnostic. Only actual
    // session or KEEP-policy constraints may withhold snapshot values.
    const projection = policyPanels({ ...source, data: { ...source.data, reason: null } }, now, state?.cells ?? {});
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
      if (value.brokerAccount && Object.hasOwn(value.brokerAccount, 'cash') && projection.paperCash.state === 'broken' &&
          (projection.paperCash.retained || projection.paperCash.value == null)) {
        value.brokerAccount.cash = null; (value.brokerAccount.reasons ??= {}).cash = projection.paperCash.reason;
      }
      for (const [period, field] of [['day', 'dayPnl'], ['open', 'openPnl']]) {
        if (value.pnlSources?.[period] && state.feed.value.totals[field] != null && value.totals[field] == null) value.pnlSources[period] = {
          ...value.pnlSources[period], status: 'unavailable', reason: value.totals.reasons?.[field] ?? 'family_projection_unavailable' };
        for (const desk of value.desks) {
          const original = state.feed.value.desks.find(d => d.id === desk.id);
          if (desk.pnlSources?.[period] && original.money[field] != null && desk.money[field] == null) desk.pnlSources[period] = {
            ...desk.pnlSources[period], status: 'unavailable', reason: desk.money.reasons?.[field] ?? 'family_projection_unavailable' };
        }
      }
      if (value.positions && projection.positions.state === 'broken' &&
          (projection.positions.retained || projection.positions.value == null || projection.positions.reason === 'source_not_authoritative')) {
        value.positions.reason = projection.positions.reason;
        value.positions.rows = value.positions.rows.map(row => {
          const fields = ['mark', 'marketValue', 'dayPnl', 'openPnl'].filter(f => Object.hasOwn(row, f));
          return { ...row, ...Object.fromEntries(fields.map(f => [f, null])),
            reasons: { ...row.reasons, ...Object.fromEntries(fields.map(f => [f,
              row[f] == null && row.reasons?.[f] ? row.reasons[f] : projection.positions.reason])) } };
        });
      }
    }
    return { serverNow: now, feeds: feeds(), panels: selected, data: value };
  }
  return { accept, acceptResults, reject, feeds, panels, view, observeFleet,
    fleetFailure: () => { rejections['fleet-config'] = 'refresh_failed'; },
    hasData: () => Boolean(state) };
}
