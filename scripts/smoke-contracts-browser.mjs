#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browser = process.env.BROWSER_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
await access(browser);
const profile = await mkdtemp(join(tmpdir(), 'joed-contract-browser-'));
const files = new Map();
for (const name of ['index.mjs', 'schema-validator.mjs', 'semantics.mjs', 'decimal.mjs', 'gateway.mjs', 'accept.mjs', 'panel-state.mjs',
  'manifest.json', 'data.schema.json', 'history.schema.json', 'results.schema.json',
  'fleet-config.schema.json', 'healthz.schema.json', 'common.schema.json', 'reason.schema.json']) {
  files.set(`/contracts/${name}`, await readFile(new URL(`../contracts/${name}`, import.meta.url)));
}
files.set('/fixtures/valid.json', await readFile(new URL('../fixtures/valid.json', import.meta.url)));
const page = `<!doctype html><body>pending<script type="module">
try {
  // Product telemetry modules must not depend on layout or storage access.
  Object.defineProperty(window, 'localStorage', {get() {throw new Error('unavailable');}});
  const {validateContract} = await import('/contracts/index.mjs');
  const {acceptSnapshot} = await import('/contracts/accept.mjs');
  const {panelStates} = await import('/contracts/panel-state.mjs');
  const samples = await (await fetch('/fixtures/valid.json')).json();
  for (const [kind, payload] of Object.entries(samples)) {
    if (!validateContract(kind, payload).ok) throw new Error(kind + ' rejected in browser');
    const old = validateContract(kind, {...payload, schema:'old.v0'});
    if (old.status !== 422 || !old.errors.some(e => e.rule === 'const' && e.path === '$.schema')) throw new Error('old schema rule missing');
  }
  const payload = structuredClone(samples.data); delete payload.receivedAt;
  const feed = acceptSnapshot('data', payload, null, samples.data.receivedAt);
  const rejected = acceptSnapshot('data', {...payload, schema:'old.v0'}, feed, samples.data.receivedAt);
  if (rejected.status !== 422 || rejected.value !== feed.value ||
      !rejected.errors.some(e => e.rule === 'const' && e.path === '$.schema')) throw new Error('last-good/schema rule lost');
  if (panelStates({data:feed}, samples.data.receivedAt).gateway.state !== 'fresh') throw new Error('panel failed');
  document.body.textContent = 'contract-browser-ok';
} catch (error) { document.body.textContent = 'FAILED: ' + error.message; }
</script>`;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.writeHead(200, {'Content-Type':'text/html'}); res.end(page); return; }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': path.endsWith('.mjs') ? 'text/javascript' : 'application/json'});
  res.end(file);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let proc;
try {
  const output = await new Promise((resolve, reject) => {
    proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=5000',
      `http://127.0.0.1:${server.address().port}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Browser smoke timed out')); }, 20000);
    proc.stdout.on('data', data => { stdout += data; });
    proc.stderr.on('data', () => {});
    proc.on('error', error => { clearTimeout(timer); reject(error); });
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`Browser exited ${code}`)); });
  });
  assert.match(output, /<body>contract-browser-ok<\/body>/);
  console.log('contract-browser-ok: five schemas, 422 + last-good, panel selectors, storage unavailable');
} finally {
  if (proc && proc.exitCode === null) proc.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
  const cleanup = spawnSync('trash', [profile], { stdio: 'ignore' });
  if (cleanup.error || cleanup.status !== 0) throw new Error('Browser profile cleanup via trash failed');
}
