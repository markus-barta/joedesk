import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates, stateTable, PANELS } from '../contracts/panel-state.mjs';

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
    if (accepted.status === 422) assert.strictEqual(accepted.value, feeds[fixture.feed].value);
    feeds[fixture.feed] = accepted;
  }
  for (const kind of fixture.absentFeeds || []) delete feeds[kind];
  const states = panelStates(feeds, fixture.now, previous);
  assert.deepEqual(stateTable(states), fixture.expected);
  if (fixture.transportReason) assert.strictEqual(feeds[fixture.feed].value.schema, valid[fixture.feed].schema);
});
