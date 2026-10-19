#!/usr/bin/env node
// CI only: synthetic rev 9 data behind a loopback trusted-proxy fixture.
// Never point this helper at an OPS store or use its fixture identity on a host.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { startBoard, ACTOR, NOW, at, read } from './browser/board.mjs';
import { designFleet, designActions, designSnapshot } from './browser/settings-fixtures.mjs';
import { scratch, discard } from './browser/scratch.mjs';
import { assertValueFree, passed } from './preview-capture.mjs';

if (process.env.CI !== 'true') throw new Error('Synthetic preview browser smoke is CI-only');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/preview-capture-ci.mjs EXISTING_PRIVATE_OUTPUT');
const out = resolve(process.argv[2]);
const { snapshot, history } = designSnapshot();
snapshot.positions.rows.push(read('fixtures/positions-unmapped.json'));
assert.ok(snapshot.positions.rows.some(row => row.scope === 'keep'));
assert.ok(snapshot.positions.rows.some(row => row.reasons?.desk === 'desk_unmapped'));
const board = await startBoard({ history, fleetConfig: designFleet(), fleetActions: designActions() });
board.setNow(NOW);
let injection = '';
let egress = 0;
let foreign;
const external = createServer((_req, res) => { egress++; res.end('synthetic'); });
const proxy = createServer((req, res) => {
  if (req.url === '/joe/preview-worker.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(`fetch(${JSON.stringify(foreign)}).catch(() => {});`);
    return;
  }
  if (req.url === '/joe/preview-redirect') {
    res.writeHead(302, { location: foreign }); res.end(); return;
  }
  // The capture CLI supplies no identity header. Only this synthetic trusted
  // boundary injects it, just as OPS must use its authorized private proxy.
  const upstream = request(new URL(req.url, board.url), { method: req.method, headers: { ...req.headers, 'x-auth-request-user': ACTOR } }, answer => {
    const headers = { ...answer.headers };
    if (req.url === '/joe/' && injection) delete headers['content-length'];
    res.writeHead(answer.statusCode, headers);
    if (req.url === '/joe/' && injection) {
      const chunks = [];
      answer.on('data', chunk => chunks.push(chunk));
      answer.on('end', () => res.end(Buffer.concat(chunks).toString().replace('</head>', `<script>${injection}</script></head>`)));
    } else answer.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
async function run(dir, extra = []) {
  const cli = fileURLToPath(new URL('./preview-capture.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, '--base-url', `http://127.0.0.1:${proxy.address().port}/joe/`, '--out', dir, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.ok(!output.includes('SYNTHETIC_PRIVATE'), 'page/console/URL data must not reach CLI output');
  process.stdout.write(output);
  return code;
}
const scratchDirs = [];
try {
  await listen(proxy); await listen(external);
  assert.equal((await board.push(snapshot)).status, 200);
  board.setNow(at(NOW, 9));
  // No results push: feed_not_received is the sole allowed empty record.
  assert.equal(await run(out), 0);
  const summary = JSON.parse(readFileSync(join(out, 'summary.json')));
  assertValueFree(summary);
  assert.ok(passed(summary));
  assert.equal(summary.checks.length, 16);
  assert.ok(summary.checks.filter(c => c.screen === 'results').every(c => c.sections.find(s => s.id === 'results').allowedEmpty));
  const files = readdirSync(out);
  assert.equal(files.filter(f => f.endsWith('.png')).length, 16);
  assert.equal(files.length, 17, 'no unexpected capture/profile files');
  for (const file of files) {
    assert.equal(statSync(join(out, file)).mode & 0o777, 0o600);
    if (file.endsWith('.png')) assert.ok(readFileSync(join(out, file)).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  }
  console.log('synthetic preview: 16 PNGs, Results not received, value-free summary and 0600 files: ok');

  // Real CDP negatives on the runner; these files are never uploaded.
  foreign = `http://127.0.0.1:${external.address().port}/?account=SYNTHETIC_PRIVATE`;
  const negatives = {
    network: `fetch(${JSON.stringify(foreign)}).catch(() => {});`,
    worker: 'new Worker("/joe/preview-worker.js");',
    redirect: 'fetch("/joe/preview-redirect").catch(() => {});',
    errors: 'console.error("SYNTHETIC_PRIVATE"); setTimeout(() => { throw new Error("SYNTHETIC_PRIVATE"); }, 0);',
    empty: 'addEventListener("DOMContentLoaded", () => { document.getElementById("kept").remove(); });',
  };
  for (const [negative, source] of Object.entries(negatives)) {
    const dir = scratch('joed-preview-negative-'); scratchDirs.push(dir);
    injection = source;
    assert.equal(await run(dir, ['--screens', 'positions', '--widths', '390', '--themes', 'light']), 1);
    const rejected = JSON.parse(readFileSync(join(dir, 'summary.json')));
    assertValueFree(rejected);
    if (['network', 'worker', 'redirect'].includes(negative)) { assert.ok(rejected.counts.blockedRequests > 0); assert.equal(egress, 0); }
    if (negative === 'errors') { assert.ok(rejected.counts.pageErrors > 0); assert.ok(rejected.counts.consoleErrors > 0); }
    if (negative === 'empty') assert.ok(rejected.counts.failingSections > 0);
  }
} finally {
  await close(proxy); await close(external); await board.close();
  for (const dir of scratchDirs) await discard(dir, 'synthetic preview negative');
}
