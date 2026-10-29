import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { createJoeServer } from '../server.mjs';
import { validateContract } from '../contracts/index.mjs';

const T0 = '2026-10-24T21:59:59.000Z';
const eur = amount => ({ amount, currency: 'EUR' });
function snapshot() {
  const value = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url))).data;
  delete value.receivedAt;
  value.generatedAt = value.safety.gateway.checkedAt = value.brokerAccount.observedAt = T0;
  value.brokerAccount.cash = eur('100.00000001');
  return value;
}

test('read-only account endpoint exposes both stores with existing auth, cache and CSP; desk endpoint stays v2', async t => {
  const dataDir = scratch('joed-150-http-'); t.after(() => discard(dataDir, 'JOED-150 HTTP fixture'));
  const server = createJoeServer({ dataDir, clock: () => T0, inboxToken: 'synthetic-account-test-inbox' });
  // Exercise the actual handler without a listening socket, as board-state
  // tests do. Every persisted path belongs to this disposable fixture.
  const request = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
    Object.assign(req, { url, method, headers });
    let status, responseHeaders, responseBody;
    const res = { writeHead(code, values) { status = code; responseHeaders = new Headers(values); },
      end(value) { responseBody = value; } };
    await server.listeners('request')[0](req, res);
    return { status, headers: responseHeaders, json: async () => JSON.parse(responseBody) };
  };
  const headers = { 'x-auth-request-user': 'synthetic-account-reader' };
  const route = '/joe/account-history.json';
  assert.equal((await request(route)).status, 401);
  const empty = await request(route, { headers }); assert.equal(empty.status, 200);
  assert.equal((await empty.json()).dailyCloses.reason, 'feed_not_received');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const response = await request(route, { method, headers });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal((await request('/joe/inbox', { method: 'POST',
    headers: { authorization: 'Bearer synthetic-account-test-inbox' }, body: JSON.stringify(snapshot()) })).status, 200);
  const response = await request(route, { headers }), body = await response.json();
  assert.equal(body.schema, 'inspr.joe.account-history.v1');
  assert.deepEqual(body.points, [{ t: T0, account: { observedAt: T0, equity: eur('28000'), cash: eur('100.00000001') } }]);
  assert.equal(body.dailyCloses.schema, 'inspr.joe.account-closes.v1');
  assert.equal(body.dailyCloses.timeZone, 'Europe/Vienna'); assert.equal(body.dailyCloses.reason, null);
  assert.equal(body.dailyCloses.days[0].day, '2026-10-24');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(response.headers.get('x-joe-server-now'), T0);
  assert.equal(response.headers.get('x-joe-received-at'), T0);
  const desk = await (await request('/joe/history.json', { headers })).json();
  assert.equal(validateContract('history', desk).ok, true);
  assert.ok(desk.points.every(p => !Object.hasOwn(p, 'account')));
  assert.equal(desk.sizeBytes, statSync(join(dataDir, 'history-state.json')).size);
});
