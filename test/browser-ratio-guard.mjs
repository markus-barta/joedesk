import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CI_GUARD, REFERENCE_BUDGET } from '../scripts/browser/budget.mjs';
import { validateCalibration, attemptGuard, calibrationSummary, calibrationEvidence, reportCalibration, ratioCells } from '../scripts/browser/ratio-guard.mjs';
import { calibrateProbe, analyzeProbeCalibration, readProbeEvidence } from '../scripts/probe-calibrate.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const fixtureURL = new URL('./fixtures/probe-quiet.json', import.meta.url);
const evidence = () => JSON.parse(readFileSync(fixtureURL, 'utf8'));
const calibrated = () => calibrateProbe([evidence()]);
const captured = medianMs => ({ probe: { medianMs } });

test('JOED-187 (d/f): ratios floor at one and use only the same width and kind', () => {
  const calibration = calibrated();
  for (const [width, kind, quiet] of [['1440', 'board-live', 10], ['1024', 'board-live', 20], ['390', 'board-live', 40], ['1440', 'results', 20]]) {
    for (const [now, k] of [[quiet / 2, 1], [quiet, 1], [quiet * 1.6, 1.6]]) {
      const guard = attemptGuard(CI_GUARD, true, calibration, width, kind, captured(now), calibration.source);
      assert.equal(guard.k, k);
      assert.deepEqual(guard.limitMs, { patchMs: 40 * k, historyMs: 125 * k, taskMs: 125 * k });
    }
  }
  assert.equal(attemptGuard(REFERENCE_BUDGET, false, calibration, '1440', 'results', captured(700), calibration.source).k, 1);
});

test('JOED-187 M2: calibration applies only to its exact host and Chrome, including hosted fallback', () => {
  const calibration = calibrated();
  for (const runSource of [{ ...calibration.source, host: 'ubuntu-latest' }, { ...calibration.source, chrome: 'HeadlessChrome upgraded' }, {}]) {
    const guard = attemptGuard(CI_GUARD, true, calibration, '1440', 'board-live', captured(16), runSource);
    assert.equal(guard.k, 1);
    assert.deepEqual(guard.limitMs, { patchMs: 40, historyMs: 125, taskMs: 125 });
    assert.equal(guard.hostTooSlowToJudge, false);
    assert.equal(guard.ratioReason, `calibration is for quiet-fixture/HeadlessChrome fixture, this run is ${runSource.host ?? 'unknown'}/${runSource.chrome ?? 'unknown'}: absolute guards`);
  }
  assert.equal(attemptGuard(CI_GUARD, true, calibration, '1440', 'board-live', captured(16), calibration.source).k, 1.6);
});

test('JOED-187 L3: tables round only display values and keep exact ratio and limits in evidence', () => {
  const calibration = calibrated();
  const guard = attemptGuard(CI_GUARD, true, calibration, '1440', 'board-live', captured(13.740000000000002), calibration.source);
  const before = JSON.stringify(guard);
  assert.match(ratioCells(guard, CI_GUARD), /1\.37 \| 55\.0 \/ 171\.8 \/ 171\.8/);
  assert.equal(JSON.stringify(guard), before);
  assert.equal(guard.limitMs.patchMs, 40 * guard.k);
});

test('JOED-187 (g): strict calibration validator rejects malformed records and accepts the shipped uncalibrated record', () => {
  assert.deepEqual(validateCalibration(JSON.parse(readFileSync(new URL('../scripts/browser/probe-calibration.json', import.meta.url)))), { status: 'uncalibrated', cap: 3 });
  const mutations = [
    r => { delete r.quiet['390']; },
    r => { r.quiet['1440']['board-live'].medianMs = Infinity; },
    r => { r.quiet['1440']['board-live'].layoutMedianMs = NaN; },
    r => { r.quiet['1440']['board-live'].jsMedianMs = '4'; },
    r => { r.quiet['1440']['board-live'].medianMs = 0; },
    ...[1000, 3.01, 1, 0, -1, Infinity, '3'].map(cap => r => { r.cap = cap; }),
    r => { r.quiet['1440'].unknown = r.quiet['1440'].results; },
    r => { delete r.quiet['1024'].results; },
    r => { r.source.capturedAt = '2026-02-31T12:00:00Z'; },
    r => { r.source.host = ''; },
    r => { r.source.attempt = 0; },
    r => { r.source.runId = 'run|bad'; },
    r => { r.source.runId = 'local-12345'; },
    r => { r.sources = null; },
    r => { r.extra = true; },
  ];
  for (const mutate of mutations) { const record = calibrated(); mutate(record); assert.throws(() => validateCalibration(record), /Invalid probe calibration/); }
  for (const record of [null, [], {}, { status: 'unknown', cap: 3 }, { status: 'uncalibrated' }, { status: 'uncalibrated', cap: 3, quiet: {} }]) {
    assert.throws(() => validateCalibration(record), /Invalid probe calibration/);
  }
});

test('JOED-187 L2/L6/L7: several quiet runs use median per cell, retain provenance, and print spread and cold/live ratios', async () => {
  const records = [1, 2, 4].map((scale, i) => {
    const r = evidence(); r.source.runId = `quiet-ci-${i}`;
    // A launch timestamp deliberately later than the probe must be ignored.
    r.source.capturedAt = '2026-11-04T12:00:00.000Z';
    for (const row of r.traces) {
      row.probeCapturedAt = `2026-11-04T10:0${i}:00.000Z`;
      for (const field of ['layoutMedianMs', 'jsMedianMs', 'medianMs']) row.probe[field] *= scale;
    }
    for (const width of ['1440', '1024', '390']) {
      const live = r.traces.find(row => row.viewport === width && row.kind === 'board-live');
      r.traces.push({ ...live, phase: 'cold 9000 points', probe: { ...live.probe, medianMs: live.probe.medianMs * 1.5 } });
    }
    return r;
  });
  const { record, spread, coldLiveRatio } = analyzeProbeCalibration(records);
  assert.deepEqual(record.quiet['1440']['board-live'], { layoutMedianMs: 8, jsMedianMs: 12, medianMs: 20 });
  assert.deepEqual(record.quiet['390'].results, { layoutMedianMs: 64, jsMedianMs: 96, medianMs: 160 });
  assert.deepEqual(spread['1440']['board-live'].medianMs, { min: 10, max: 40 });
  assert.deepEqual(coldLiveRatio, { 1440: 1.5, 1024: 1.5, 390: 1.5 });
  assert.equal(record.sources.length, 3);
  assert.deepEqual(record.sources.map(s => s.runId), ['quiet-ci-0', 'quiet-ci-1', 'quiet-ci-2']);
  assert.equal(record.source.capturedAt, '2026-11-04T10:02:00.000Z');
  assert.ok(calibrationSummary(record).includes('quiet-ci-0/2 at 2026-11-04T10:00:00.000Z'));
  assert.equal(calibrateProbe(records.slice(0, 2)).quiet['1440']['board-live'].medianMs, 15, 'even run counts use the middle pair');
  const repeated = structuredClone(records);
  repeated[0].traces.push({ ...repeated[0].traces[0], probe: { layoutMedianMs: 400, jsMedianMs: 600, medianMs: 1000 } });
  assert.throws(() => analyzeProbeCalibration(repeated), /duplicate probe evidence/);
  repeated[0].traces.at(-1).probeCapturedAt = '2026-11-04T10:00:01.000Z';
  const repeatedAnalysis = analyzeProbeCalibration(repeated);
  assert.equal(repeatedAnalysis.record.quiet['1440']['board-live'].medianMs, 30, 'all recorded sample medians contribute within their cell');
  assert.deepEqual(repeatedAnalysis.spread['1440']['board-live'].medianMs, { min: 10, max: 1000 });
  const dir = scratch('joed-187-multi-calibrate-');
  try {
    const paths = records.map((r, i) => { const path = join(dir, `run-${i}.json`); writeFileSync(path, JSON.stringify(r)); return path; });
    const cli = fileURLToPath(new URL('../scripts/probe-calibrate.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli, ...paths], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), record);
    assert.match(run.stderr, /1440\/board-live spread \(ms\): layoutMedianMs 4\.0–16\.0, jsMedianMs 6\.0–24\.0, medianMs 10\.0–40\.0/);
    for (const width of ['1440', '1024', '390']) assert.ok(run.stderr.includes(`${width} cold/live ratio: 1.50`));
    const duplicate = spawnSync(process.execPath, [cli, paths[0], paths[0]], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0);
    assert.equal(duplicate.stdout, '');
    assert.match(duplicate.stderr, /duplicate probe evidence/);
    const splitPaths = records.slice(0, 2).flatMap((r, i) => {
      const bundles = [r.traces.filter(row => row.kind === 'board-live'),
        ...['1440', '1024', '390'].map(width => r.traces.filter(row => row.kind === 'results' && row.viewport === width))];
      return bundles.map((traces, j) => {
        const path = join(dir, `run-${i}-phase-${j}.json`);
        writeFileSync(path, JSON.stringify({ source: r.source, traces }));
        return path;
      });
    });
    const split = spawnSync(process.execPath, [cli, ...splitPaths], { encoding: 'utf8' });
    assert.equal(split.status, 0, split.stderr);
    assert.deepEqual(JSON.parse(split.stdout), calibrateProbe(records.slice(0, 2)));
  } finally { await discard(dir, 'multi-run calibration fixtures'); }
  assert.throws(() => calibrateProbe(Array.from({ length: 6 }, (_, i) => ({ ...evidence(), source: { ...evidence().source, runId: `ci-${i}` } }))), /1–5/);
  for (const mutate of [r => { r.source.runId = 'local-42'; }, r => { delete r.traces[0].probeCapturedAt; }]) {
    const invalid = evidence(); mutate(invalid); assert.throws(() => calibrateProbe([invalid]));
  }
  const missing = structuredClone(records); missing[1].traces = missing[1].traces.filter(r => r.kind !== 'results');
  assert.throws(() => calibrateProbe(missing), /Missing quiet probe/);
  for (const change of [r => { r.sources[0].host = 'other'; }, r => { r.sources.push(r.sources[0]); }]) {
    const invalid = structuredClone(record); change(invalid); assert.throws(() => validateCalibration(invalid));
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
  for (const field of ['host', 'chrome']) {
    const mixed = evidence(); mixed.source[field] = 'other';
    assert.throws(() => calibrateProbe([evidence(), mixed]), /mixes hosts or Chromes/);
  }
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

test('JOED-187: injected step summary records exact calibration provenance or uncalibrated absolute guards', () => {
  const summaries = [];
  const write = text => summaries.push(text);
  reportCalibration({ status: 'uncalibrated', cap: 3 }, [], write);
  reportCalibration(calibrated(), [], write);
  assert.equal(summaries.length, 2);
  const summary = summaries.join('');
  assert.match(summary, /uncalibrated: absolute guards/);
  assert.ok(summary.includes(calibrationSummary(calibrated())));
  for (const value of Object.values(evidence().source)) assert.ok(summary.includes(String(value)));
  assert.doesNotMatch(summary, /Host too slow to judge:/);
});

test('JOED-187 (j): summary groups all widths and kinds and retains the worst over-cap ratio without changing evidence', () => {
  const calibration = calibrated();
  const traces = [];
  for (const width of ['1440', '1024', '390']) {
    for (const kind of ['board-live', 'results']) {
      const quiet = calibration.quiet[width][kind].medianMs;
      for (const k of [3.5, 4.234, 1.6]) {
        traces.push({ viewport: width, ...attemptGuard(CI_GUARD, true, calibration, width, kind, captured(quiet * k), calibration.source) });
      }
    }
  }
  const before = JSON.stringify(traces);
  const summaries = [];
  reportCalibration(calibration, traces, text => summaries.push(text));
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0].split('\n').filter(line => line.startsWith('Host too slow to judge:')),
    ['1440', '1024', '390'].flatMap(width => ['board-live', 'results'].map(kind =>
      `Host too slow to judge: ${width} ${kind}, k = 4.23× (cap 3×); absolute guards applied`)));
  assert.equal(JSON.stringify(traces), before);
});
