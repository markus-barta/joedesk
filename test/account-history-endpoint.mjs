import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-auth-request-user': 'synthetic-account-reader' };
  const route = base + '/joe/account-history.json';
  assert.equal((await fetch(route)).status, 401);
  const empty = await fetch(route, { headers }); assert.equal(empty.status, 200);
  assert.equal((await empty.json()).dailyCloses.reason, 'feed_not_received');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const response = await fetch(route, { method, headers });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal((await fetch(base + '/joe/inbox', { method: 'POST',
    headers: { authorization: 'Bearer synthetic-account-test-inbox' }, body: JSON.stringify(snapshot()) })).status, 200);
  const response = await fetch(route, { headers }), body = await response.json();
  assert.equal(body.schema, 'inspr.joe.account-history.v1');
  assert.deepEqual(body.points, [{ t: T0, account: { observedAt: T0, equity: eur('28000'), cash: eur('100.00000001') } }]);
  assert.equal(body.dailyCloses.schema, 'inspr.joe.account-closes.v1');
  assert.equal(body.dailyCloses.timeZone, 'Europe/Vienna'); assert.equal(body.dailyCloses.reason, null);
  assert.equal(body.dailyCloses.days[0].day, '2026-10-24');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(response.headers.get('x-joe-server-now'), T0);
  assert.equal(response.headers.get('x-joe-received-at'), T0);
  const desk = await (await fetch(base + '/joe/history.json', { headers })).json();
  assert.equal(validateContract('history', desk).ok, true);
  assert.ok(desk.points.every(p => !Object.hasOwn(p, 'account')));
});
