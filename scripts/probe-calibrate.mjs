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
export function calibrateProbe(records) {
  if (!records.length) throw new Error('No quiet run evidence');
  const source = { ...records[0].source };
  const grouped = Object.fromEntries(PROBE_WIDTHS.map(width => [width, Object.fromEntries(PROBE_KINDS.map(kind => [kind, []]))]));
  for (const record of records) {
    if (!record.source || !Array.isArray(record.traces) || !record.traces.length) throw new Error('Missing run source or traces');
    for (const key of ['runId', 'attempt', 'host', 'chrome']) if (record.source[key] !== source[key]) throw new Error(`Evidence mixes runs: ${key}`);
    // Validate each provenance independently, including its timestamp.
    validateCalibrationSource(record.source);
    if (record.source.capturedAt > source.capturedAt) source.capturedAt = record.source.capturedAt;
    for (const row of record.traces) {
      const load1 = row.load1 ?? row.machineLoad?.loadavg?.[0];
      if (!Number.isFinite(load1) || load1 < 0 || load1 >= 5) throw new Error('Refusing calibration: load1 must be known and < 5 for every attempt');
      if (!row.probe || !['layoutMedianMs', 'jsMedianMs', 'medianMs'].every(key => Number.isFinite(row.probe[key]) && row.probe[key] > 0)) throw new Error('Refusing calibration: probe unavailable or invalid');
      if (!PROBE_WIDTHS.includes(row.viewport) || !PROBE_KINDS.includes(row.kind)) throw new Error('Unknown probe width/kind');
      // The Board cold read is evidence too, but the requested baseline kind
      // is board-live. Never mix its cold probe into that live baseline.
      if (row.kind === 'board-live' && row.phase !== 'live') continue;
      grouped[row.viewport][row.kind].push(row.probe);
    }
  }
  const quiet = Object.fromEntries(PROBE_WIDTHS.map(width => [width, Object.fromEntries(PROBE_KINDS.map(kind => {
    const values = grouped[width][kind];
    if (!values.length) throw new Error(`Missing quiet probe: ${width}/${kind}; include both Board and Results evidence`);
    return [kind, Object.fromEntries(['layoutMedianMs', 'jsMedianMs', 'medianMs'].map(key => [key, median(values.map(value => value[key]))]))];
  }))]));
  return validateCalibration({ status: 'calibrated', quiet, source, cap: 3 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length < 3) throw new Error('Usage: node scripts/probe-calibrate.mjs <index.md or JSON evidence> [more evidence files]');
    const records = process.argv.slice(2).flatMap(file => readProbeEvidence(readFileSync(file, 'utf8')));
    console.log(JSON.stringify(calibrateProbe(records), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
