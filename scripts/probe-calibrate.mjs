#!/usr/bin/env node
// Print a candidate only. A coordinator commits calibration after LEAD review.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROBE_WIDTHS, PROBE_KINDS, validateCalibration, validateCalibrationSource } from './browser/ratio-guard.mjs';

export function readProbeEvidence(text) {
  try { return [JSON.parse(text)].flat(); } catch { /* Markdown evidence blocks below. */ }
  const records = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].flatMap(match => {
    const value = JSON.parse(match[1]);
    return value?.source && Array.isArray(value.traces) ? [value] : [];
  });
  if (!records.length) throw new Error('No lossless quiet-probe JSON evidence found; use JOED-187 index.md or JSON evidence');
  return records;
}
const median = values => {
  const sorted = values.toSorted((a, b) => a - b), i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
const fields = ['layoutMedianMs', 'jsMedianMs', 'medianMs'];
const grid = () => Object.fromEntries(PROBE_WIDTHS.map(width => [width, Object.fromEntries(PROBE_KINDS.map(kind => [kind, []]))]));
export function analyzeProbeCalibration(records) {
  if (!records.length) throw new Error('No quiet run evidence');
  const host = records[0].source?.host, chrome = records[0].source?.chrome;
  const runs = new Map(), grouped = grid(), seen = new Set();
  const cold = Object.fromEntries(PROBE_WIDTHS.map(width => [width, []]));
  for (const record of records) {
    if (!record?.source || !Array.isArray(record.traces) || !record.traces.length) throw new Error('Missing run source or traces');
    validateCalibrationSource(record.source);
    if (record.source.host !== host || record.source.chrome !== chrome) throw new Error('Evidence mixes hosts or Chromes');
    const id = `${record.source.runId}/${record.source.attempt}`;
    if (!runs.has(id)) runs.set(id, { source: { ...record.source, capturedAt: null }, grouped: grid() });
    if (runs.size > 5) throw new Error('Use 1–5 quiet CI runs');
    const run = runs.get(id);
    for (const row of record.traces) {
      const load1 = row.load1 ?? row.machineLoad?.loadavg?.[0];
      if (!Number.isFinite(load1) || load1 < 0 || load1 >= 5) throw new Error('Refusing calibration: load1 must be known and < 5 for every attempt');
      if (!row.probe || !fields.every(key => Number.isFinite(row.probe[key]) && row.probe[key] > 0)) throw new Error('Refusing calibration: probe unavailable or invalid');
      if (!PROBE_WIDTHS.includes(row.viewport) || !PROBE_KINDS.includes(row.kind)) throw new Error('Unknown probe width/kind');
      // Provenance comes from the actual probe, never the browser launch.
      validateCalibrationSource({ ...record.source, capturedAt: row.probeCapturedAt });
      const identity = JSON.stringify([record.source.runId, record.source.attempt, row.viewport, row.phase, row.kind, row.probeCapturedAt]);
      if (seen.has(identity)) throw new Error('Refusing calibration: duplicate probe evidence');
      seen.add(identity);
      if (!run.source.capturedAt || Date.parse(row.probeCapturedAt) > Date.parse(run.source.capturedAt)) run.source.capturedAt = row.probeCapturedAt;
      // The Board cold read is evidence too, but the requested baseline kind
      // is board-live. Never mix its cold probe into that live baseline.
      if (row.kind === 'board-live' && row.phase !== 'live') {
        cold[row.viewport].push(row.probe.medianMs);
        continue;
      }
      run.grouped[row.viewport][row.kind].push(row.probe);
      grouped[row.viewport][row.kind].push(row.probe);
    }
  }
  for (const run of runs.values()) for (const width of PROBE_WIDTHS) for (const kind of PROBE_KINDS) {
    if (!run.grouped[width][kind].length) throw new Error(`Missing quiet probe: ${width}/${kind} in ${run.source.runId}/${run.source.attempt}; include both Board and Results evidence`);
  }
  const quiet = Object.fromEntries(PROBE_WIDTHS.map(width => [width, Object.fromEntries(PROBE_KINDS.map(kind => {
    const values = grouped[width][kind];
    return [kind, Object.fromEntries(fields.map(key => [key, median(values.map(value => value[key]))]))];
  }))]));
  const spread = Object.fromEntries(PROBE_WIDTHS.map(width => [width, Object.fromEntries(PROBE_KINDS.map(kind => [kind,
    Object.fromEntries(fields.map(key => [key, { min: Math.min(...grouped[width][kind].map(v => v[key])), max: Math.max(...grouped[width][kind].map(v => v[key])) }]))]))]));
  const coldLiveRatio = Object.fromEntries(PROBE_WIDTHS.map(width => [width, cold[width].length ? median(cold[width]) / quiet[width]['board-live'].medianMs : null]));
  const sources = [...runs.values()].map(r => r.source).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const source = sources.at(-1);
  return { record: validateCalibration({ status: 'calibrated', quiet, source, cap: 3, ...(sources.length > 1 ? { sources } : {}) }), spread, coldLiveRatio };
}
export function calibrateProbe(records) {
  return analyzeProbeCalibration(records).record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length < 3) throw new Error('Usage: node scripts/probe-calibrate.mjs <index.md or JSON evidence files from 1–5 quiet CI runs>');
    const records = process.argv.slice(2).flatMap(file => readProbeEvidence(readFileSync(file, 'utf8')));
    const { record, spread, coldLiveRatio } = analyzeProbeCalibration(records);
    for (const width of PROBE_WIDTHS) {
      for (const kind of PROBE_KINDS) console.error(`${width}/${kind} spread (ms): ${fields.map(key => `${key} ${spread[width][kind][key].min.toFixed(1)}–${spread[width][kind][key].max.toFixed(1)}`).join(', ')}`);
      console.error(`${width} cold/live ratio: ${coldLiveRatio[width]?.toFixed(2) ?? 'unavailable (no cold probes)'}`);
    }
    console.log(JSON.stringify(record, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
