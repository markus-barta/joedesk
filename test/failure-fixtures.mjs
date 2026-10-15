import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates, stateTable, PANELS } from '../contracts/panel-state.mjs';
import { validateContract } from '../contracts/index.mjs';

const read = file => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
const valid = read('valid.json');
const table = read('panel-state-table.json');
const baseline = () => Object.fromEntries(['data', 'history', 'results', 'fleet-config'].map(kind => [kind, {
  value: structuredClone(valid[kind]), receivedAt: valid.data.receivedAt,
  generatedAdvancedAt: valid.data.receivedAt, status: 200, reason: null,
}]));

test('fixture table is exhaustive for a–j and declares every panel', () => {
  assert.deepEqual(table.panels, PANELS);
  assert.deepEqual([...new Set(table.cases.map(c => c.failureClass))].sort(), 'abcdefghij'.split(''));
  assert.equal(new Set(table.cases.map(c => c.id)).size, table.cases.length);
});

for (const entry of table.cases) test(`fixture ${entry.failureClass}: ${entry.id}`, () => {
  const fixture = read(entry.file);
  assert.equal(fixture.id, entry.id);
  assert.equal(fixture.failureClass, entry.failureClass);
  assert.deepEqual(Object.keys(fixture.expected).sort(), [...PANELS].sort());
  const feeds = baseline();
  const previous = panelStates(feeds, fixture.now);
  if (fixture.transportReason) {
    feeds[fixture.feed].reason = fixture.transportReason;
  } else {
    const accepted = acceptSnapshot(fixture.feed, fixture.payload, feeds[fixture.feed], fixture.receivedAt);
    assert.equal(accepted.status, fixture.expectedStatus);
    if (accepted.status === 422) {
      assert.strictEqual(accepted.value, feeds[fixture.feed].value);
      assert.equal(accepted.value.receivedAt, valid[fixture.feed].receivedAt);
      assert.ok(Date.parse(fixture.receivedAt) > Date.parse(accepted.value.receivedAt), 'rejection must be later than last-good');
    }
    for (const error of fixture.expectedErrors || []) assert.ok(accepted.errors.some(e =>
      e.path === error.path && e.rule === error.rule), JSON.stringify(error));
    feeds[fixture.feed] = accepted;
  }
  if (fixture.fleetConfig) {
    assert.equal(validateContract('fleet-config', fixture.fleetConfig).ok, true);
    feeds['fleet-config'].value = fixture.fleetConfig;
  }
  for (const kind of fixture.absentFeeds || []) delete feeds[kind];
  const states = panelStates(feeds, fixture.now, previous);
  assert.deepEqual(stateTable(states), fixture.expected);
  for (const [panel, symbols] of Object.entries(fixture.expectedRows || {})) {
    assert.deepEqual(states[panel].value.map(row => row.symbol), symbols);
  }
  if (fixture.transportReason) assert.strictEqual(feeds[fixture.feed].value.schema, valid[fixture.feed].schema);
});
