import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateContract } from '../contracts/index.mjs';
import { anonymizeResults, assertAlreadyAnonymous, nonIdentifyingProjection, resultsStringPolicies } from '../scripts/anonymize-results.mjs';
import { realResultsFixtures } from '../scripts/results-fixtures.mjs';
import { setDeploymentPins } from '../scripts/set-deployment-pins.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const base = new URL('../fixtures/results/', import.meta.url);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const fixture = () => read(new URL('exact-decimals.json', base));
const script = fileURLToPath(new URL('../scripts/anonymize-results.mjs', import.meta.url));
function temporary(t) { const dir = scratch('joed-40-'); t.after(() => discard(dir, 'JOED-40 test')); return dir; }
function run(args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
function injected() {
  const value = fixture();
  value.days[0].desks.j.equityClose.amount = '4999.00000000';
  value.days[0].desks.j.equityClose.fx = { ...value.trades[0].fx, source: 'DU1234567 synthetic-person synthetic-host' };
  value.trades.forEach((trade, i) => {
    trade.id = `rt-du1234567-order-938${i}-exec-55-permid-99`;
    trade.company = i % 2 ? 'U7654321 synthetic-other-person' : 'DU****1234 synthetic-person';
    trade.fx.source = 'DU1234567 synthetic-person synthetic-host';
    trade.entryPrice.amount = '20.00000000';
    trade.quantity = '1.00000000';
    trade.fx.rate = '0.50000000';
  });
  return value;
}
// Independent projection covers every non-identifying leaf, not just money.
function expectedProjection(value) {
  const result = structuredClone(value);
  for (const trade of result.trades) {
    trade.id = null;
    if (Object.hasOwn(trade, 'company')) trade.company = null;
  }
  function sources(v) {
    if (!v || typeof v !== 'object') return;
    if (v.fx) v.fx.source = null;
    Object.values(v).forEach(sources);
  }
  sources(result);
  return result;
}

test('Results anonymizer classifies the current schema and preserves every non-identifying leaf', () => {
  assert.ok([...resultsStringPolicies().values()].every(p => p !== 'unknown'));
  const input = injected(), before = structuredClone(input);
  assert.equal(validateContract('results', input).ok, true);
  const { output } = anonymizeResults(input);
  assert.deepEqual(input, before);
  assert.deepEqual(expectedProjection(output), expectedProjection(input));
  assert.deepEqual(nonIdentifyingProjection(output), expectedProjection(input));
  assert.deepEqual(output.trades.map(t => t.id), ['rt-anon-1', 'rt-anon-2', 'rt-anon-3', 'rt-anon-4']);
  assert.deepEqual(output.trades.map(t => t.company), ['company-1', 'company-2', 'company-1', 'company-2']);
  assert.ok(output.trades.every(t => t.fx.source === 'source-1'));
  assert.equal(output.days[0].desks.j.equityClose.fx.source, 'source-1');
  assert.doesNotMatch(JSON.stringify(output), /DU|U7654321|synthetic-person|synthetic-other-person|synthetic-host|938|permid|exec-/);
  assert.deepEqual(anonymizeResults(input).output, output);
  assert.deepEqual(anonymizeResults(output).output, output);
  assert.equal(assertAlreadyAnonymous(output), true);
  assert.throws(() => assertAlreadyAnonymous(input), /identifier at \$\.days\[0\]/);
});

test('Results anonymizer covers every existing synthetic fixture in ingress and served form', () => {
  for (const name of readdirSync(base).filter(n => n.endsWith('.json'))) {
    const input = read(new URL(name, base));
    for (const value of [input, (({ receivedAt, missingDays, ...v }) => v)(input)]) {
      const { output } = anonymizeResults(value);
      assert.deepEqual(expectedProjection(output), expectedProjection(value));
      assert.equal(assertAlreadyAnonymous(output), true);
    }
  }
});

test('Results CLI writes 0600, preserves decimal bytes, refuses overwrite, and prints only counts', t => {
  const dir = temporary(t), input = join(dir, 'input.json'), output = join(dir, 'output.json');
  writeFileSync(input, JSON.stringify(injected()), { mode: 0o600 });
  const result = run([input, output]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^anonymized strings: \d+\n$/);
  assert.equal(result.stderr, '');
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(expectedProjection(read(output)), expectedProjection(read(input)));
  assert.equal(read(output).trades[0].entryPrice.amount, '20.00000000');
  assert.equal(read(output).trades[0].quantity, '1.00000000');
  assert.equal(read(output).trades[0].fx.rate, '0.50000000');
  const checked = run(['--check', output]);
  assert.equal(checked.status, 0); assert.equal(checked.stdout, 'anonymous check passed at $\n'); assert.equal(checked.stderr, '');
  const bytes = readFileSync(output);
  assert.equal(run([input, output]).status, 1);
  assert.deepEqual(readFileSync(output), bytes);
  assert.equal(run([input, input]).status, 1);
  assert.deepEqual(read(input), injected());
  const link = join(dir, 'symlink.json'); symlinkSync(output, link);
  assert.equal(run([input, link]).status, 1);
  assert.deepEqual(readFileSync(output), bytes);
});

test('Results CLI fails closed on unknown strings; contract and parse errors exit 2 without values', t => {
  const dir = temporary(t), input = join(dir, 'input.json'), output = join(dir, 'output.json');
  for (const field of ['accountId', 'accountHint', 'orderId', 'execId', 'permId', 'orderRef', 'person', 'host', 'unknown']) {
    const value = injected(); value.trades[0][field] = 'DU9999999-value-must-never-print';
    writeFileSync(input, JSON.stringify(value), { mode: 0o600 });
    const result = run([input, output]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `unclassified string at $.trades[0].${field}\n`);
    assert.equal(existsSync(output), false);
  }
  const invalid = injected(); invalid.trades[0].netEur.amount = '9999';
  for (const bytes of [JSON.stringify(invalid), '{"secret":"DU9999999-value-must-never-print"',
    JSON.stringify({ ...fixture(), seq: 0 }), JSON.stringify({ ...fixture(), seq: 'invalid-count' }), 'null', '"invalid-root"']) {
    writeFileSync(input, bytes, { mode: 0o600 });
    const result = run([input, output]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^invalid (results contract|JSON) at \$\n$/);
    assert.equal(existsSync(output), false);
  }
  writeFileSync(input, JSON.stringify(injected()), { mode: 0o600 });
  const checked = run(['--check', input]);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /^identifier at \$[a-zA-Z0-9.\[\]]+\n$/);
  const missing = run([join(dir, 'DU9999999-private-path'), output]);
  assert.equal(missing.status, 1); assert.equal(missing.stderr, 'input read failed at $\n');
});

test('real Results CI slot validates every producer fixture and requires already anonymous strings', t => {
  const fixtures = realResultsFixtures();
  if (!fixtures.length) t.diagnostic('no real fixture yet');
  for (const { payload } of fixtures) assert.equal(assertAlreadyAnonymous(payload), true);
});

test('real Results discovery picks up a file drop and rejects identifying or invalid files', t => {
  const dir = temporary(t);
  assert.deepEqual(realResultsFixtures(dir), []);
  const file = join(dir, 'producer.json');
  const anonymous = anonymizeResults(injected()).output;
  writeFileSync(file, JSON.stringify(anonymous));
  assert.deepEqual(realResultsFixtures(dir).map(f => f.payload), [anonymous]);
  assert.equal(realResultsFixtures(dir)[0].now, anonymous.receivedAt);
  writeFileSync(file, JSON.stringify(injected()));
  assert.throws(() => realResultsFixtures(dir), /identifier at/);
  writeFileSync(file, JSON.stringify({ ...anonymous, seq: 0 }));
  assert.throws(() => realResultsFixtures(dir), /invalid results contract/);
  writeFileSync(file, JSON.stringify(anonymous));
  symlinkSync(file, join(dir, 'link.json'));
  assert.throws(() => realResultsFixtures(dir), /regular JSON file/);
});

test('deployment pin helper validates SHA40, changes only requested pins, and preserves statuses', t => {
  const manifest = read(new URL('../release/contracts.json', import.meta.url)), before = structuredClone(manifest);
  const producer = 'a'.repeat(40), pusher = 'b'.repeat(40), executor = 'C'.repeat(40);
  const output = setDeploymentPins(manifest, ['--producer', producer, '--pusher', pusher, '--executor', executor]);
  assert.deepEqual(manifest, before);
  assert.deepEqual(output, { ...before, producers: { results: { deployment_pin: producer }, pusher: { deployment_pin: pusher }, executor: { deployment_pin: executor } } });
  const populated = { ...manifest, producers: { results: { status: 'pending sign-off', deployment_pin: null }, executor: { status: 'pending', deployment_pin: executor } } };
  assert.deepEqual(setDeploymentPins(populated, ['--producer', producer]), { ...populated, producers: { ...populated.producers, results: { ...populated.producers.results, deployment_pin: producer } } });
  for (const args of [[], ['--pusher', pusher], ['--producer'], ['--producer', 'a'.repeat(39)], ['--producer', 'z'.repeat(40)], ['--producer', producer, '--producer', producer], ['--producer', producer, '--unknown', pusher]])
    assert.throws(() => setDeploymentPins(manifest, args), /pin_usage/);
  const dir = temporary(t); mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'release'));
  const cli = join(dir, 'scripts/set-deployment-pins.mjs'), target = join(dir, 'release/contracts.json');
  copyFileSync(new URL('../scripts/set-deployment-pins.mjs', import.meta.url), cli);
  writeFileSync(target, JSON.stringify(manifest));
  const bad = spawnSync(process.execPath, [cli, '--producer', 'invalid'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.deepEqual(read(target), manifest);
  const good = spawnSync(process.execPath, [cli, '--producer', producer], { encoding: 'utf8' });
  assert.equal(good.status, 0); assert.equal(good.stderr, '');
  assert.deepEqual(read(target), setDeploymentPins(manifest, ['--producer', producer]));
});
