import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { vectors } = JSON.parse(readFileSync(new URL('../fixtures/time-vectors.json', import.meta.url)));

// Test-only IANA oracle: verifies the hand-written vectors while the production
// time module remains assigned to P2. Do not import this into the product.
function wall(utc, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

for (const vector of vectors) test(`time vector: ${vector.id}`, () => {
  const ny = wall(vector.utc, 'America/New_York');
  const vienna = wall(vector.utc, 'Europe/Vienna');
  assert.equal(ny, vector.ny);
  assert.equal(vienna, vector.vienna);
  const offset = (Date.parse(vienna.replace(' ', 'T') + 'Z') - Date.parse(ny.replace(' ', 'T') + 'Z')) / 3600000;
  assert.equal(offset, vector.offsetHours);
  const weekday = new Date(`${ny.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const time = ny.slice(11);
  assert.equal(weekday > 0 && weekday < 6 && time >= '09:30:00' && time < '16:00:00', vector.rth);
});
