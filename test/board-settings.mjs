import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { createBoardSettingsStore, validateBoardSettings, BOARD_SETTINGS_MAX_BYTES } from '../server/board-settings.mjs';
import { createBoardSettings, accountStart } from '../public/joe/board-settings.js';

const value = { accountStart: { amountEur: 12.34, date: '2024-02-29' } };
function temporary(t) { const root = scratch('joed-155-store-'); t.after(() => discard(root, 'board settings unit test')); return root; }

test('missing, unset and corrupt storage never invent an account start', t => {
  const dataDir = temporary(t), file = path.join(dataDir, 'board-settings.json');
  const store = createBoardSettingsStore({ dataDir });
  assert.deepEqual(store.read(), { accountStart: null, reason: 'missing' });
  assert.equal(fs.existsSync(file), false, 'reading missing storage does not create it');
  for (const body of ['{', '{}', 'null', JSON.stringify({ ...value, policy: 'paper' }), ' '.repeat(BOARD_SETTINGS_MAX_BYTES + 1)]) {
    fs.writeFileSync(file, body);
    assert.deepEqual(store.read(), { accountStart: null, reason: 'invalid' });
  }
  store.save({ accountStart: null });
  assert.deepEqual(store.read(), { accountStart: null, reason: 'unset' });
});

test('store writes only its own bounded private file, reads after restart and refuses invalid replacements', t => {
  const dataDir = temporary(t), file = path.join(dataDir, 'board-settings.json');
  const store = createBoardSettingsStore({ dataDir });
  assert.deepEqual(store.save(value), { ...value, reason: null });
  assert.deepEqual(createBoardSettingsStore({ dataDir }).read(), { ...value, reason: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dataDir), ['board-settings.json']);
  assert.throws(() => store.save({ accountStart: { amountEur: 0, date: '2024-02-29' } }), /positive EUR/);
  assert.deepEqual(store.read(), { ...value, reason: null });
  const failed = createBoardSettingsStore({ dataDir, write: () => { throw new Error('fixture write failed'); } });
  assert.throws(() => failed.save({ accountStart: null }), /fixture write failed/);
  assert.deepEqual(store.read(), { ...value, reason: null });
});

test('unreadable storage is unset with a distinct reason', t => {
  const dataDir = temporary(t);
  fs.mkdirSync(path.join(dataDir, 'board-settings.json'));
  assert.deepEqual(createBoardSettingsStore({ dataDir }).read(), { accountStart: null, reason: 'unreadable' });
});

test('amount and calendar validation is strict, timezone independent and never rounds input', () => {
  for (const amountEur of [0.01, 0.29, 1, 12.34, 100.1]) assert.equal(validateBoardSettings({ accountStart: { ...value.accountStart, amountEur } }), null);
  for (const amountEur of [0, -1, -0, NaN, Infinity, '12.34', null, 0.001, 1.001, 1.0000000000000002, 1e21, 9007199254740991]) {
    assert.match(validateBoardSettings({ accountStart: { ...value.accountStart, amountEur } }), /positive EUR/);
  }
  for (const date of ['2023-02-29', '2024-02-30', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '0000-01-01', '2024-2-01', '2024-01-01T00:00:00Z', '', null]) {
    assert.match(validateBoardSettings({ accountStart: { ...value.accountStart, date } }), /calendar date/);
  }
  for (const date of ['0001-01-01', '2024-03-31', '2024-11-03', '9999-12-31']) assert.equal(validateBoardSettings({ accountStart: { amountEur: 1, date } }), null);
  for (const bad of [null, [], {}, { accountStart: {} }, { accountStart: [] }, { accountStart: { ...value.accountStart, extra: true } }, { ...value, reason: null }]) assert.ok(validateBoardSettings(bad));
  assert.equal(validateBoardSettings({ accountStart: null }), null);
});

const response = (body, status = 200) => ({ status, json: async () => body });
test('page accessor starts unset; private reads and saves expose only validated server values', async () => {
  assert.equal(accountStart(), null);
  const calls = [];
  const client = createBoardSettings({ fetcher: async (...args) => { calls.push(args); return response({ ...value, reason: null }); } });
  assert.equal(client.accountStart(), null);
  assert.deepEqual(await client.refresh(), { ok: true });
  assert.deepEqual(client.accountStart(), value.accountStart);
  const copy = client.accountStart(); copy.amountEur = 99;
  assert.deepEqual(client.accountStart(), value.accountStart);
  assert.deepEqual(await client.save(value), { ok: true });
  assert.deepEqual(calls.map(([, options]) => [options.method, options.credentials, options.cache, options.redirect]), [
    ['GET', 'same-origin', 'no-store', 'manual'], ['POST', 'same-origin', 'no-store', 'manual'],
  ]);
  assert.equal(calls[1][1].body, JSON.stringify(value));
  assert.equal((await client.save({ accountStart: {} })).ok, false);
  assert.equal(calls.length, 2);
});

test('client hides account start on failed or invalid reads and accepts missing/unset reasons', async () => {
  let body = { ...value, reason: null }, status = 200;
  const client = createBoardSettings({ fetcher: async () => response(body, status) });
  await client.refresh();
  for (const invalid of [{ ...value, reason: 'invalid' }, { ...value, reason: 'unknown' }, { accountStart: {} }, {}]) {
    body = invalid; assert.equal((await client.refresh()).ok, false); assert.equal(client.accountStart(), null);
  }
  body = { ...value, reason: null }; status = 401;
  assert.equal((await client.refresh()).ok, false); assert.equal(client.accountStart(), null);
  status = 200;
  for (const reason of ['missing', 'unset', 'invalid', 'unreadable']) {
    body = { accountStart: null, reason }; assert.equal((await client.refresh()).ok, true);
    assert.deepEqual(client.snapshot(), body);
  }
});

test('late GET cannot overwrite a newer save; background refresh does not race an active save', async () => {
  let resolveRead, resolveSave;
  const client = createBoardSettings({ fetcher: (_, options) => new Promise(resolve => { if (options.method === 'GET') resolveRead = resolve; else resolveSave = resolve; }) });
  const read = client.refresh(), save = client.save(value);
  assert.equal((await client.refresh()).ok, false);
  resolveSave(response({ ...value, reason: null })); await save;
  resolveRead(response({ accountStart: null, reason: 'missing' })); await read;
  assert.deepEqual(client.accountStart(), value.accountStart);
});
