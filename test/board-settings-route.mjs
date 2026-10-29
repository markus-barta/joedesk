import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { createJoeServer } from '../server.mjs';
import { atomicWrite } from '../server/storage.mjs';
import release from '../release.json' with { type: 'json' };

const value = { accountStart: { amountEur: 12.34, date: '2024-02-29' } };
const actor = { 'x-auth-request-user': 'fixture-user' };
async function setup(t, options = {}) {
  const dataDir = scratch('joed-155-route-');
  t.after(() => discard(dataDir, 'board settings route test'));
  const server = createJoeServer({ dataDir, clock: () => '2026-10-29T10:00:00.000Z', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { ...actor, origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const request = async (init = {}, route = '/joe/board-settings.json') => {
    const response = await fetch(base + route, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  const post = (body = value, override = {}) => request({ method: 'POST', headers: { ...headers, ...override }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { dataDir, request, post, headers };
}

test('GET is authenticated, no-store, CSP protected and gives explicit unset reasons', async t => {
  const s = await setup(t);
  assert.equal((await s.request()).status, 401);
  const read = await s.request({ headers: actor });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { accountStart: null, reason: 'missing' });
  assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.equal(read.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(read.headers.get('x-frame-options'), 'DENY');
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(read.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal((await s.request({ method: 'HEAD' })).status, 401);
  const head = await s.request({ method: 'HEAD', headers: actor });
  assert.equal(head.status, 200); assert.equal(head.body, null);
  fs.writeFileSync(path.join(s.dataDir, 'board-settings.json'), '{');
  assert.deepEqual((await s.request({ headers: actor })).body, { accountStart: null, reason: 'invalid' });
});

test('write mirrors Fleet Settings identity and CSRF refusals, including Bearer-only requests', async t => {
  const s = await setup(t);
  for (const override of [
    { 'x-auth-request-user': '' }, { 'x-auth-request-user': 'invalid user' },
    { 'x-auth-request-user': '', authorization: 'Bearer fixture-only' },
    { origin: '' }, { origin: 'https://foreign.invalid' }, { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'none' },
  ]) {
    const headers = { ...s.headers, ...override };
    const board = await s.post(value, override);
    const fleet = await s.request({ method: 'POST', headers, body: '{}' }, '/joe/fleet-config/propagate');
    assert.equal(board.status, 403); assert.equal(board.status, fleet.status);
    assert.equal(board.body.error, fleet.body.error);
  }
  assert.equal(fs.existsSync(path.join(s.dataDir, 'board-settings.json')), false);
  assert.equal((await s.request({ method: 'PUT', headers: s.headers, body: JSON.stringify(value) })).status, 405);
  // Origin is mandatory; Fetch Metadata is optional, just as in Fleet Config.
  assert.equal((await s.post(value, { 'sec-fetch-site': '' })).status, 200);
  assert.equal((await s.post(value, { origin: 'https://fixture.invalid', 'x-forwarded-host': 'fixture.invalid' })).status, 200);
});

test('write rejects content type, JSON, oversize and invalid values without replacing saved settings', async t => {
  const s = await setup(t);
  assert.equal((await s.post()).status, 200);
  for (const [body, headers, status] of [
    [value, { 'content-type': 'text/plain' }, 415], [value, { 'content-type': '' }, 415],
    ['{', {}, 400], [' '.repeat(262145), {}, 413],
    [{ ...value, actor: 'fixture' }, {}, 422], [{ accountStart: { amountEur: 0, date: '2024-02-29' } }, {}, 422],
    [{ accountStart: { amountEur: 1.001, date: '2024-02-29' } }, {}, 422],
    [{ accountStart: { amountEur: 1, date: '2023-02-29' } }, {}, 422],
  ]) {
    const answer = await s.post(body, headers);
    assert.equal(answer.status, status); assert.equal(answer.body.ok, false); assert.ok(answer.body.error);
    assert.deepEqual((await s.request({ headers: actor })).body, { ...value, reason: null });
  }
});

test('save, restart read and clear never modify executor policy and log only actor/keys/outcome', async t => {
  const logs = [];
  t.mock.method(console, 'info', text => logs.push(JSON.parse(text)));
  const s = await setup(t);
  const policy = fs.readFileSync(new URL('../public/joe/fleet-config.example.json', import.meta.url), 'utf8');
  fs.writeFileSync(path.join(s.dataDir, 'fleet-config.json'), policy);
  const answer = await s.post();
  assert.equal(answer.status, 200); assert.deepEqual(answer.body, { ok: true, ...value, reason: null });
  assert.equal(fs.readFileSync(path.join(s.dataDir, 'fleet-config.json'), 'utf8'), policy);
  assert.equal(fs.existsSync(path.join(s.dataDir, 'fleet-config-actions.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'board-settings.json'), 'utf8')), value);
  const restarted = createJoeServer({ dataDir: s.dataDir });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { restarted.closeAllConnections(); restarted.close(resolve); }));
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${restarted.address().port}/joe/board-settings.json`, { headers: actor })).json(), { ...value, reason: null });
  assert.deepEqual((await s.post({ accountStart: null })).body, { ok: true, accountStart: null, reason: 'unset' });
  assert.deepEqual((await s.request({ headers: actor })).body, { accountStart: null, reason: 'unset' });
  assert.deepEqual(logs.map(log => [log.outcome, log.reason]), [['pending', 'write_started'], ['success', 'saved'], ['pending', 'write_started'], ['success', 'saved']]);
  for (const log of logs) {
    assert.equal(log.actor, actor['x-auth-request-user']);
    assert.deepEqual(log.changedKeys, ['accountStart']);
    assert.deepEqual(Object.keys(log).sort(), ['actor', 'at', 'changedKeys', 'event', 'outcome', 'reason']);
  }
});

test('failed atomic writes return a clear failure and preserve the previous base', async t => {
  let fail = false;
  const s = await setup(t, { write: (file, ...args) => { if (fail && file.endsWith('board-settings.json')) throw new Error('fixture failure'); atomicWrite(file, ...args); } });
  assert.equal((await s.post()).status, 200); fail = true;
  const answer = await s.post({ accountStart: null });
  assert.equal(answer.status, 500); assert.equal(answer.body.error, 'board settings store failed');
  assert.deepEqual((await s.request({ headers: actor })).body, { ...value, reason: null });
});

test('new module is served on the existing release paths without changing release coordinates', async t => {
  const s = await setup(t);
  for (const route of ['/joe/board-settings.js', `/joe/v/${release.version}/board-settings.js`]) {
    const response = await fetch(s.headers.origin + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /export const accountStart/);
  }
});
