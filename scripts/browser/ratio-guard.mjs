// JOED-187: validated, reviewable quiet-host calibration. Never infer a
// baseline from another width/kind, or learn one during a CI run.
import { readFileSync, appendFileSync } from 'node:fs';

export const PROBE_WIDTHS = Object.freeze(['1440', '1024', '390']);
export const PROBE_KINDS = Object.freeze(['board-live', 'results']);
const medians = ['layoutMedianMs', 'jsMedianMs', 'medianMs'];
const fail = message => { throw new Error(`Invalid probe calibration: ${message}`); };
function keys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail(path);
}
export function validateCalibration(record) {
  if (!['uncalibrated', 'calibrated'].includes(record?.status)) fail('status');
  keys(record, record.status === 'calibrated' ? ['status', 'quiet', 'source', 'cap', ...(Object.hasOwn(record, 'sources') ? ['sources'] : [])] : ['status', 'cap'], 'record fields');
  if (!Number.isFinite(record.cap) || record.cap <= 1 || record.cap > 3) fail('cap must be finite and 1 < cap <= 3');
  if (record.status === 'uncalibrated') return record;
  keys(record.quiet, PROBE_WIDTHS, 'quiet widths');
  for (const width of PROBE_WIDTHS) {
    keys(record.quiet[width], PROBE_KINDS, `quiet.${width} kinds`);
    for (const kind of PROBE_KINDS) {
      const value = record.quiet[width][kind];
      keys(value, medians, `quiet.${width}.${kind} fields`);
      for (const field of medians) if (!Number.isFinite(value[field]) || value[field] <= 0) fail(`quiet.${width}.${kind}.${field}`);
    }
  }
  validateCalibrationSource(record.source);
  if (Object.hasOwn(record, 'sources')) {
    if (!Array.isArray(record.sources) || record.sources.length < 2 || record.sources.length > 5) fail('sources must contain 2–5 quiet runs');
    const identities = new Set();
    for (const source of record.sources) {
      validateCalibrationSource(source);
      if (source.host !== record.source.host || source.chrome !== record.source.chrome) fail('sources must share host and Chrome');
      identities.add(`${source.runId}/${source.attempt}`);
    }
    if (identities.size !== record.sources.length || !record.sources.some(s => Object.keys(record.source).every(key => s[key] === record.source[key]))) fail('sources provenance');
  }
  return record;
}
export function validateCalibrationSource(source) {
  keys(source, ['runId', 'attempt', 'capturedAt', 'host', 'chrome'], 'source fields');
  for (const field of ['runId', 'host', 'chrome']) {
    if (typeof source[field] !== 'string' || !source[field].trim() || /[\x00-\x1f|`]/.test(source[field])) fail(`source.${field}`);
  }
  if (source.runId.startsWith('local-')) fail('source.runId must be a CI run, not local-…');
  if (!Number.isInteger(source.attempt) || source.attempt < 1) fail('source.attempt');
  if (typeof source.capturedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(source.capturedAt) ||
    !Number.isFinite(Date.parse(source.capturedAt)) ||
    new Date(source.capturedAt).toISOString() !== source.capturedAt.replace(/Z$/, source.capturedAt.includes('.') ? 'Z' : '.000Z')) fail('source.capturedAt');
  return source;
}
// Import-time validation fails loudly before a runner can open its browser.
export const PROBE_CALIBRATION = validateCalibration(JSON.parse(readFileSync(new URL('./probe-calibration.json', import.meta.url), 'utf8')));

export function attemptGuard(limits, enabled, calibration, width, kind, captured, runSource = {}) {
  let k = 1;
  let ratioReason = !enabled ? 'reference budget: absolute guards'
    : calibration.status === 'uncalibrated' ? 'uncalibrated: absolute guards' : 'same-width, same-kind quiet probe';
  if (enabled && calibration.status === 'calibrated') {
    if (!PROBE_WIDTHS.includes(width) || !PROBE_KINDS.includes(kind)) fail('attempt width/kind');
    if (runSource.host !== calibration.source.host || runSource.chrome !== calibration.source.chrome) {
      ratioReason = `calibration is for ${calibration.source.host}/${calibration.source.chrome}, this run is ${runSource.host ?? 'unknown'}/${runSource.chrome ?? 'unknown'}: absolute guards`;
    } else if (!Number.isFinite(captured.probe?.medianMs) || captured.probe.medianMs <= 0) ratioReason = 'probe unavailable: k = 1, absolute guards';
    else k = Math.max(1, captured.probe.medianMs / calibration.quiet[width][kind].medianMs);
  } else if (enabled && !captured.probe) ratioReason += '; probe unavailable: k = 1';
  const hostTooSlowToJudge = enabled && k > calibration.cap;
  const scale = hostTooSlowToJudge ? 1 : k;
  return { k, ratioReason, kind, calibration: calibrationSummary(calibration), hostTooSlowToJudge,
    cap: calibration.cap, limitMs: { patchMs: limits.patchMs * scale, historyMs: limits.historyMs * scale, taskMs: limits.taskMs * scale } };
}

// Over-cap attempts use absolute limits and keep the existing decision path.
export function applyAttemptGuard(result, guard) {
  result.row = { ...result.row, ...guard };
  return result;
}
export function guardCheck(name, conditions, row, timingKeys) {
  if (!row.hostTooSlowToJudge || !Object.keys(conditions).some(key => timingKeys.includes(key))) return { name, conditions };
  return { name: `${name}; host too slow to judge (k = ${row.k.toFixed(2)}× the quiet probe, cap ${row.cap}): absolute guards`, conditions };
}
export function calibrationSummary(record = PROBE_CALIBRATION) {
  if (record.status === 'uncalibrated') return 'uncalibrated: absolute guards';
  const s = record.source;
  return `calibrated: run ${s.runId}, attempt ${s.attempt}, ${s.capturedAt}, host ${s.host}, Chrome ${s.chrome}; cap ${record.cap}×${record.sources ? `; quiet runs ${record.sources.map(r => `${r.runId}/${r.attempt} at ${r.capturedAt}`).join(', ')}` : ''}`;
}
export function reportCalibration(record) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Probe calibration: ${calibrationSummary(record)}\n\n`);
}
export function ratioCells(row, limits) {
  const l = row.limitMs ?? limits;
  const display = value => Number.isFinite(value) ? value.toFixed(1) : value ?? '—';
  return ` ${(row.k ?? 1).toFixed(2)} | ${display(l.patchMs)} / ${display(l.historyMs)} / ${display(l.taskMs)} | ${row.ratioReason ?? 'absolute guards'}${row.hostTooSlowToJudge ? '; host too slow to judge: absolute guards' : ''} |`;
}

// A compact, lossless block for the calibration tool; human tables may round.
export function calibrationEvidence(traces, source) {
  if (!source) return '';
  const capturedAt = traces.map(r => r.probeCapturedAt).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  const evidence = { source: { ...source, capturedAt }, traces: traces.map(r => ({ viewport: r.viewport, phase: r.phase, kind: r.kind,
    attempt: r.attempt, load1: r.machineLoad?.loadavg?.[0] ?? null, probeCapturedAt: r.probeCapturedAt, probe: r.probe })) };
  return `Quiet-probe candidate evidence (JOED-187):\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`;
}
