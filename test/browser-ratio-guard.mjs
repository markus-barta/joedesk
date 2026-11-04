import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CI_GUARD, REFERENCE_BUDGET } from '../scripts/browser/budget.mjs';
import { validateCalibration, attemptGuard, calibrationSummary, calibrationEvidence, reportCalibration } from '../scripts/browser/ratio-guard.mjs';
import { calibrateProbe, readProbeEvidence } from '../scripts/probe-calibrate.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const fixtureURL = new URL('./fixtures/probe-quiet.json', import.meta.url);
const evidence = () => JSON.parse(readFileSync(fixtureURL, 'utf8'));
const calibrated = () => calibrateProbe([evidence()]);
const captured = medianMs => ({ probe: { medianMs } });

test('JOED-187 (d/f): ratios floor at one and use only the same width and kind', () => {
  const calibration = calibrated();
  for (const [width, kind, quiet] of [['1440', 'board-live', 10], ['1024', 'board-live', 20], ['390', 'board-live', 40], ['1440', 'results', 20]]) {
    for (const [now, k] of [[quiet / 2, 1], [quiet, 1], [quiet * 1.6, 1.6]]) {
      const guard = attemptGuard(CI_GUARD, true, calibration, width, kind, captured(now));
      assert.equal(guard.k, k);
      assert.deepEqual(guard.limitMs, { patchMs: 40 * k, historyMs: 125 * k, taskMs: 125 * k });
    }
  }
  assert.equal(attemptGuard(REFERENCE_BUDGET, false, calibration, '1440', 'results', captured(700)).k, 1);
});

test('JOED-187 (g): strict calibration validator rejects malformed records and accepts the shipped uncalibrated record', () => {
  assert.deepEqual(validateCalibration(JSON.parse(readFileSync(new URL('../scripts/browser/probe-calibration.json', import.meta.url)))), { status: 'uncalibrated', cap: 3 });
  const mutations = [
    r => { delete r.quiet['390']; },
    r => { r.quiet['1440']['board-live'].medianMs = Infinity; },
    r => { r.quiet['1440']['board-live'].layoutMedianMs = NaN; },
    r => { r.quiet['1440']['board-live'].jsMedianMs = '4'; },
    r => { r.quiet['1440']['board-live'].medianMs = 0; },
    ...[1, 0, -1, Infinity, '3'].map(cap => r => { r.cap = cap; }),
    r => { r.quiet['1440'].unknown = r.quiet['1440'].results; },
    r => { delete r.quiet['1024'].results; },
    r => { r.source.capturedAt = '2026-02-31T12:00:00Z'; },
    r => { r.source.host = ''; },
    r => { r.source.attempt = 0; },
    r => { r.source.runId = 'run|bad'; },
    r => { r.extra = true; },
  ];
  for (const mutate of mutations) { const record = calibrated(); mutate(record); assert.throws(() => validateCalibration(record), /Invalid probe calibration/); }
  for (const record of [null, [], {}, { status: 'unknown', cap: 3 }, { status: 'uncalibrated' }, { status: 'uncalibrated', cap: 3, quiet: {} }]) {
    assert.throws(() => validateCalibration(record), /Invalid probe calibration/);
  }
});

test('JOED-187 (g): malformed committed calibration fails loudly on module import before any browser starts', async () => {
  const dir = scratch('joed-187-validator-');
  try {
    writeFileSync(join(dir, 'ratio-guard.mjs'), readFileSync(new URL('../scripts/browser/ratio-guard.mjs', import.meta.url)));
    writeFileSync(join(dir, 'probe-calibration.json'), '{"status":"calibrated","cap":0}');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(dir, 'ratio-guard.mjs')).href)})`], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Invalid probe calibration/);
  } finally { await discard(dir, 'validator fixture'); }
});

test('JOED-187 (h): calibration CLI prints the quiet fixture candidate and never writes its input', async () => {
  const before = readFileSync(fixtureURL, 'utf8');
  const cli = fileURLToPath(new URL('../scripts/probe-calibrate.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, fileURLToPath(fixtureURL)], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const record = JSON.parse(run.stdout);
  assert.deepEqual(record, calibrated());
  assert.deepEqual(record.source, evidence().source);
  assert.deepEqual(record.quiet['390'].results, { layoutMedianMs: 32, jsMedianMs: 48, medianMs: 80 });
  assert.deepEqual(record.quiet['1440']['board-live'], { layoutMedianMs: 4, jsMedianMs: 6, medianMs: 10 });
  assert.equal(record.cap, 3);
  assert.equal(readFileSync(fixtureURL, 'utf8'), before);
  const dir = scratch('joed-187-calibrate-');
  try {
    for (const load1 of [5, 8, null]) {
      const loaded = evidence(); loaded.traces[0].load1 = load1;
      const path = join(dir, 'loaded.json'); writeFileSync(path, JSON.stringify(loaded));
      const rejected = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' });
      assert.notEqual(rejected.status, 0);
      assert.equal(rejected.stdout, '');
      assert.match(rejected.stderr, /load1/);
    }
  } finally { await discard(dir, 'calibration fixtures'); }
});

test('JOED-187 (h): calibration rejects missing probes, incomplete grids and mixed provenance, and preserves lossless index evidence', () => {
  for (const mutate of [r => { r.traces[0].probe = null; }, r => { r.traces.pop(); }, r => { r.traces[0].kind = 'unknown'; }]) {
    const record = evidence(); mutate(record); assert.throws(() => calibrateProbe([record]));
  }
  const mixed = evidence(); mixed.source.runId = 'other-run';
  assert.throws(() => calibrateProbe([evidence(), mixed]), /mixes runs/);
  const first = evidence(), second = evidence();
  first.traces = first.traces.filter(r => r.kind === 'board-live');
  second.traces = second.traces.filter(r => r.kind === 'results');
  const markdown = [first, second].map(record => calibrationEvidence(record.traces.map(row => ({ ...row, machineLoad: { loadavg: [row.load1, 1, 1] } })), record.source)).join('\n');
  assert.deepEqual(calibrateProbe(readProbeEvidence(markdown)), calibrated());
  assert.deepEqual(calibrateProbe(readProbeEvidence(JSON.stringify([first, second]))), calibrated());
  const cold = evidence(); cold.traces.push({ ...cold.traces[0], phase: 'cold 9000 points', probe: { layoutMedianMs: 999, jsMedianMs: 999, medianMs: 1998 } });
  assert.deepEqual(calibrateProbe([cold]), calibrated(), 'cold evidence is checked but does not alter board-live calibration');
  cold.traces.at(-1).probe = null;
  assert.throws(() => calibrateProbe([cold]), /probe unavailable/);
});

test('JOED-187: step summary records exact calibration provenance or uncalibrated absolute guards', async () => {
  const dir = scratch('joed-187-summary-');
  const previous = process.env.GITHUB_STEP_SUMMARY;
  try {
    const path = join(dir, 'summary.txt'); process.env.GITHUB_STEP_SUMMARY = path;
    reportCalibration({ status: 'uncalibrated', cap: 3 });
    reportCalibration(calibrated());
    const summary = readFileSync(path, 'utf8');
    assert.match(summary, /uncalibrated: absolute guards/);
    assert.ok(summary.includes(calibrationSummary(calibrated())));
    for (const value of Object.values(evidence().source)) assert.ok(summary.includes(String(value)));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = previous;
    await discard(dir, 'step summary fixture');
  }
});
