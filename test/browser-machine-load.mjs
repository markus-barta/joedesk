import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureMachineLoad, machineLoadTable, waitForQuietHost, quietWaitCells, budgetAttemptLine } from '../scripts/browser/machine-load.mjs';

test('JOED-188: budget log distinguishes skipped waits, unknown allowances and failed refunds on one line', () => {
  for (const skipped of [true, false]) {
    const line = budgetAttemptLine('Results', { viewport: '1440', phase: 'record', attempt: 2,
      probe: null, probeMs: null, probeReason: 'probe\nfailed',
      quietWait: { waitedSeconds: skipped ? 0 : 5, quiet: false, threshold: 13, startLoad1: 43,
        budgetBeforeSeconds: skipped ? null : 300, budgetAfterSeconds: null, skipped,
        skipReason: skipped ? 'quiet-wait budget unavailable' : null,
        budgetState: skipped ? 'unavailable (EACCES)' : 'existing',
        ...(!skipped ? { refundBudgetState: 'unavailable (EEXIST)', refundReason: 'abandoned quiet-wait budget lock (>10 s) during refund' } : {}) } });
    assert.doesNotMatch(line, /[\r\n]/);
    assert.match(line, /reference probe: layout\/JS=unavailable \(probe failed\)/);
    assert.match(line, /budgetAfterSeconds=unavailable/);
    assert.ok(line.includes(`skipped=${skipped ? 'yes' : 'no'}`));
    if (skipped) assert.match(line, /budgetBeforeSeconds=unavailable.*skipReason=quiet-wait budget unavailable/);
    else assert.match(line, /refundBudgetState=unavailable \(EEXIST\), refundReason=abandoned quiet-wait budget lock/);
  }
});

test('JOED-180 budget refund failure preserves reservation state and never claims the completed wait was skipped', async () => {
  for (const staleLock of [false, true]) {
    let transactions = 0;
    const result = await waitForQuietHost({ load: () => [1], parallelism: () => 8, now: () => 0,
      budget: async change => {
        if (++transactions === 2) throw Object.assign(new Error('refund failed'), { code: 'EEXIST', staleLock });
        return change({ remainingSeconds: 300, failed: false }, 'corrupt (reset to 300 s)');
      } });
    assert.equal(result.budgetState, 'corrupt (reset to 300 s)');
    assert.equal(result.refundBudgetState, 'unavailable (EEXIST)');
    assert.equal(result.budgetAfterSeconds, null);
    assert.equal(result.skipped, false);
    assert.equal(result.skipReason, null);
    assert.equal(result.refundReason ?? null, staleLock ? 'abandoned quiet-wait budget lock (>10 s) during refund' : null);
    if (staleLock) assert.ok(quietWaitCells(result).includes(result.refundReason));
  }
});

test('budget host evidence counts browser executable names without requesting process arguments', () => {
  const sample = captureMachineLoad({
    platform: 'darwin',
    clock: () => new Date('2026-10-30T03:00:00Z'), cpuList: () => Array(12), load: () => [3, 2, 1],
    ps: (command, args, options) => {
      assert.equal(command, 'ps');
      assert.deepEqual(args, ['-A', '-o', 'comm=']);
      assert.equal(options.timeout, 2000);
      return { status: 0, stdout: ['/opt/chrome/chrome', 'chromium', 'chrome_crashpad',
        'headless_shell', 'chrome-headless-shell',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer)',
        'Chromium Helper', 'node', 'bash', 'not-chromium', 'my-chrome-tool', ''].join('\n') };
    },
  });
  assert.deepEqual(sample, { sampledAt: '2026-10-30T03:00:00.000Z', loadavg: [3, 2, 1], cpuCount: 12, browserProcesses: 8,
    availableParallelism: 'unavailable', cpusAllowed: 'unavailable', cgroup: 'unavailable', cpuMax: 'unavailable' });
  const table = machineLoadTable([{ viewport: '390', phase: 'live', attempt: 2, attempts: 2, machineLoad: sample }]);
  assert.match(table, /390.*live.*2\/2.*2026-10-30T03:00:00.000Z.*3\.00 \/ 2\.00 \/ 1\.00.*12.*8/);
});

test('budget host evidence distinguishes no browsers from unavailable process inspection', () => {
  for (const result of [{ status: 1, stdout: '' }, { status: 0, error: new Error('timeout'), stdout: 'chrome' }, { status: null }]) {
    const sample = captureMachineLoad({ ps: () => result });
    assert.equal(sample.browserProcesses, null);
    const table = machineLoadTable([{ viewport: '1024', phase: 'cold', machineLoad: sample }]);
    assert.match(table, /\| unavailable \|\n$/);
  }
  assert.equal(captureMachineLoad({ ps: () => ({ status: 0, stdout: 'node\nbash\n' }) }).browserProcesses, 0);
  assert.match(machineLoadTable([{ viewport: '1440', phase: 'legacy' }]), /unavailable/);
});

test('QA machine-load tables retain the job lock wait evidence and distinguish hosted bypass from missing evidence', () => {
  const table = machineLoadTable([], {
    JOED_BROWSER_LOCK_STATE: 'held', JOED_BROWSER_LOCK_WAIT_STARTED_AT: '2026-10-30T03:00:00Z',
    JOED_BROWSER_LOCK_ACQUIRED_AT: '2026-10-30T03:30:00Z', JOED_BROWSER_LOCK_WAIT_SECONDS: '1800',
  });
  assert.match(table, /\| held \| 2026-10-30T03:00:00Z \| 2026-10-30T03:30:00Z \| 1800 \|/);
  assert.ok(table.indexOf('Waited seconds') < table.indexOf('Machine load before each attempt'));
  assert.match(machineLoadTable([], { JOED_BROWSER_LOCK_STATE: 'bypassed', JOED_BROWSER_LOCK_WAIT_SECONDS: '0' }), /\| bypassed \| unavailable \| unavailable \| 0 \|/);
  assert.match(machineLoadTable([], {}), /unavailable \(outside CI wrapper\)/);
});

test('QA machine-load tables show unavailable host lock state and the infrastructure failure reason', () => {
  for (const reason of ['flock not found', 'cannot open /run/joedesk-browser/browser.lock; shared directory or group access may be missing', 'flock failed (exit 69)']) {
    const table = machineLoadTable([], {
      JOED_BROWSER_LOCK_STATE: 'unavailable', JOED_BROWSER_LOCK_REASON: reason,
      JOED_BROWSER_LOCK_ACQUIRED_AT: 'unavailable', JOED_BROWSER_LOCK_WAIT_SECONDS: '0',
    });
    assert.match(table, /Waited seconds \| Reason/);
    assert.ok(table.includes(`| unavailable | unavailable | unavailable | 0 | ${reason} |`));
    assert.ok(table.indexOf(reason) < table.indexOf('Machine load before each attempt'));
    assert.doesNotMatch(table, /outside CI wrapper/);
  }
});

const evidenceKeys = ['availableParallelism', 'cpusAllowed', 'cgroup', 'cpuMax'];
const fakeCPUFiles = cgroup => new Map([
  ['/proc/self/status', 'Name:\tnode\nCpus_allowed_list:\t0-5\nMems_allowed_list:\t0\n'],
  ['/proc/self/cgroup', `4:cpu:/legacy\n0::${cgroup}\n`],
  [`/sys/fs/cgroup${cgroup === '/' ? '' : cgroup}/cpu.max`, '800000 100000\n'],
]);
const fakeCPUSample = (files, extra = {}) => captureMachineLoad({
  platform: 'linux', parallelism: () => 4, ps: () => ({ status: 0, stdout: '' }),
  readFile: (file, encoding) => {
    assert.equal(encoding, 'utf8');
    if (!files.has(file)) throw new Error('unreadable');
    return files.get(file);
  }, ...extra,
});

test('JOED-186 CPU evidence reads the process affinity and its own v2 cgroup quota', () => {
  for (const cgroup of ['/job/worker', '/']) {
    const sample = fakeCPUSample(fakeCPUFiles(cgroup));
    assert.deepEqual(evidenceKeys.map(key => sample[key]), [4, 'Cpus_allowed_list:\t0-5', cgroup, '800000 100000']);
  }
});

test('JOED-186 CPU evidence is independently unavailable on read errors or missing v2 fields', () => {
  for (const file of ['/proc/self/status', '/proc/self/cgroup', '/sys/fs/cgroup/job/worker/cpu.max']) {
    const files = fakeCPUFiles('/job/worker'); files.delete(file);
    const sample = fakeCPUSample(files);
    assert.equal(sample.availableParallelism, 4);
    assert.equal(sample.cpusAllowed, file.endsWith('status') ? 'unavailable' : 'Cpus_allowed_list:\t0-5');
    assert.equal(sample.cgroup, file.endsWith('cgroup') ? 'unavailable' : '/job/worker');
    assert.equal(sample.cpuMax, file.endsWith('status') ? '800000 100000' : 'unavailable');
  }
  for (const contents of ['', '4:cpu:/legacy\n']) {
    const files = new Map([['/proc/self/status', contents], ['/proc/self/cgroup', contents]]);
    assert.deepEqual(evidenceKeys.map(key => fakeCPUSample(files)[key]), [4, 'unavailable', 'unavailable', 'unavailable']);
  }
  const sample = fakeCPUSample(new Map(), { parallelism: () => { throw new Error('unavailable'); } });
  assert.ok(evidenceKeys.every(key => sample[key] === 'unavailable'));
});

test('JOED-186 CPU evidence is unavailable outside Linux without attempting Linux reads', () => {
  for (const platform of ['darwin', 'win32', 'freebsd']) {
    const sample = fakeCPUSample(new Map(), { platform,
      parallelism: () => assert.fail('Linux-only evidence'), readFile: () => assert.fail('Linux-only reads') });
    assert.ok(evidenceKeys.every(key => sample[key] === 'unavailable'));
  }
});

test('JOED-186 CPU evidence caps display strings without truncating the quota lookup path or breaking tables', () => {
  const cgroup = '/job/' + 'worker'.repeat(30) + '|pipe';
  const files = fakeCPUFiles(cgroup);
  files.set('/proc/self/status', 'Cpus_allowed_list:\t' + '0,'.repeat(100));
  files.set(`/sys/fs/cgroup${cgroup}/cpu.max`, '800000 100000 '.repeat(10));
  const sample = fakeCPUSample(files);
  for (const key of ['cpusAllowed', 'cgroup', 'cpuMax']) assert.equal(sample[key].length, 80);
  assert.ok(sample.cpuMax.startsWith('800000 100000'));
  const table = machineLoadTable([
    { viewport: '390', phase: 'cold', machineLoad: sample },
    { viewport: '1024', phase: 'live', machineLoad: sample,
      quietWait: { waitedSeconds: 1, quiet: true, threshold: 2, startLoad1: 3 } },
    { viewport: '1440', phase: 'missing' },
  ], {});
  const rows = table.split('Machine load before each attempt')[1].split('\n').filter(row => row.startsWith('|'));
  assert.equal(rows.length, 5);
  for (const row of rows) assert.equal(row.split('|').length - 2, 21, row);
  assert.match(rows[0], /availableParallelism \| cpusAllowed \| cgroup \| cpuMax/);
});
