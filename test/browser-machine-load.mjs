import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureMachineLoad, captureLoadOwners, assessBudgetCheck, machineLoadTable, waitForQuietHost, quietWaitCells, budgetAttemptLine } from '../scripts/browser/machine-load.mjs';
import { TIMING_GUARDS } from '../scripts/browser/budget.mjs';
import { reportCalibration, calibrationEvidence } from '../scripts/browser/ratio-guard.mjs';
import { createGate } from '../scripts/browser/gate.mjs';

test('JOED-197: load owners are the top five by CPU, with only executable names retained', () => {
  const owners = captureLoadOwners({ platform: 'linux', ps: (command, args, options) => {
    assert.equal(command, 'ps');
    assert.deepEqual(args, ['-eo', 'comm=,pcpu=']);
    assert.equal(options.timeout, 2000);
    assert.equal(options.env.LC_ALL, 'C');
    return { status: 0, stdout: [
      'bash 1.0', '/usr/bin/node 35.0', 'chrome 99.9', 'rustc 90.0', 'nix 75.0',
      'python3 42.0', 'ps 0.1', 'USER=private 100.0', 'node --secret private 110.0',
      'malformed', 'bad NaN', ''].join('\n') };
  } });
  assert.deepEqual(owners, ['chrome', 'rustc', 'nix', 'python3', 'node']);
  assert.doesNotMatch(owners.join(', '), /[/%=]|private|secret|usr|\d+\.\d+/);
});

test('JOED-197: load-owner collection is best effort and unavailable outside Linux', () => {
  for (const result of [{ status: 1, stdout: 'node 90.0' }, { status: 0, error: new Error('timeout') },
    { status: null }, { status: 0, stdout: '' }, { status: 0, stdout: 'bad Infinity' }]) {
    assert.equal(captureLoadOwners({ platform: 'linux', ps: () => result }), 'unavailable');
  }
  assert.equal(captureLoadOwners({ platform: 'linux', ps: () => { throw new Error('unavailable'); } }), 'unavailable');
  assert.equal(captureLoadOwners({ platform: 'darwin', ps: () => assert.fail('Linux only') }), 'unavailable');
});

test('JOED-197: owners rank summed pcpu by command and preserve kernel-thread names', () => {
  const owners = captureLoadOwners({ platform: 'linux', ps: () => ({ status: 0, stdout: [
    'chrome 30.0', 'node 50.0', 'chrome 40.0', '/usr/bin/node 10.0',
    'kworker/u64:2 65.0', '[kworker/1:2] 5.0', 'rustc 1.0',
  ].join('\n') }) });
  assert.deepEqual(owners, ['chrome', 'kworker/u64:2', 'node', '[kworker/1:2]', 'rustc']);
  assert.equal(new Set(owners).size, owners.length);
});

test('JOED-197: inconclusive checks stay green in gate aggregation and each gets a summary line and JSON reason', () => {
  const row = { viewport: '1024', phase: 'results', kind: 'results', attempt: 2, attempts: 2, remeasured: true,
    switchWorst: 48.2, longTasks: [125, 150], limitMs: { patchMs: 40, taskMs: 125 },
    quietWait: { quiet: false, endLoad1: 51, threshold: 3 } };
  const gate = createGate('/unused');
  let samples = 0;
  const assess = conditions => assessBudgetCheck('1024: timing', conditions, row, TIMING_GUARDS, {
    sampleLoadOwners: () => { samples++; return ['chrome', 'node']; },
  });
  for (const conditions of [{ renderBudget: false }, { taskBudget: false }]) {
    const verdict = assess(conditions);
    gate.check('budget', verdict.name, verdict.ok, verdict);
  }
  assert.equal(gate.results.filter(r => !r.ok).length, 0, 'same aggregation used for the P3/P4 exit code');
  assert.equal(samples, 1, 'one snapshot at the first inconclusive check, shared by that attempt');
  assert.equal(row.inconclusiveChecks.length, 2);
  const functional = assess({ worker: false, renderBudget: false });
  assert.equal(functional.ok, false);
  assert.equal(functional.inconclusive, false, 'a functional check does not inherit another check outcome');
  const summaries = [];
  reportCalibration({ status: 'uncalibrated', cap: 3 }, [row], text => summaries.push(text), { phase: 'P4' });
  const lines = summaries[0].split('\n');
  assert.equal(lines.filter(line => line.startsWith('**Inconclusive:** P4 1024: timing')).length, 2);
  assert.deepEqual(lines.filter(line => line.startsWith('Top load owners')),
    ['Top load owners by summed pcpu (lifetime-average CPU, names only): chrome, node']);
  assert.ok(lines.some(line => line.startsWith('**Inconclusive:**') && line.endsWith('render worst 48.2 ms (applied limit 40.0 ms)')));
  assert.ok(lines.some(line => line.startsWith('**Inconclusive:**') && line.endsWith('task worst 150.0 ms (applied limit 125.0 ms)')));
  assert.match(summaries[0], /expired at load1=51\.00, threshold 3/);
  const json = JSON.parse(calibrationEvidence([row], { runId: '123' }).split('```json\n')[1].split('\n```')[0]);
  assert.ok(json.traces[0].inconclusiveChecks.every(c => c.inconclusive === true && c.inconclusiveReason.includes('load1=51.00')));
  assert.deepEqual(json.traces[0].inconclusiveChecks.map(c => c.failed), [['renderBudget'], ['taskBudget']]);
});

test('JOED-197: Board inconclusive summaries pair each measured worst with its applied limit and owners once per attempt', () => {
  const rows = [
    { kind: 'board-live', renderWorst: 130, limitMs: { historyMs: 125 }, conditions: { renderBudget: false } },
    { kind: 'board-live', deskWorst: 48.2, historyWorst: 140, limitMs: { patchMs: 40, historyMs: 125 }, conditions: { patchBudget: false, historyBudget: false } },
  ];
  for (const row of rows) {
    Object.assign(row, { attempt: 2, attempts: 2, remeasured: true, quietWait: { quiet: false } });
    assessBudgetCheck('Board timing', row.conditions, row, TIMING_GUARDS, { sampleLoadOwners: () => ['node'] });
  }
  const summaries = [];
  reportCalibration({ status: 'uncalibrated', cap: 3 }, rows, text => summaries.push(text));
  assert.match(summaries[0], /render worst 130\.0 ms \(applied limit 125\.0 ms\)/);
  assert.match(summaries[0], /patch worst 48\.2 ms \(applied limit 40\.0 ms\); history worst 140\.0 ms \(applied limit 125\.0 ms\)/);
  assert.equal(summaries[0].split('\n').filter(line => line.startsWith('Top load owners')).length, 2);
});

test('JOED-197: owner collection errors cannot turn an inconclusive check into a failure', () => {
  const row = { attempt: 2, attempts: 2, remeasured: true, quietWait: { quiet: false, skipped: true, threshold: 3 } };
  const verdict = assessBudgetCheck('timing', { taskBudget: false }, row, TIMING_GUARDS, {
    sampleLoadOwners: () => { throw new Error('ps unavailable'); },
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.loadOwners, 'unavailable');
  const summaries = [];
  reportCalibration({ status: 'uncalibrated', cap: 3 }, [row], text => summaries.push(text));
  assert.match(summaries[0], /Top load owners by summed pcpu \(lifetime-average CPU, names only\): unavailable/);
});

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
    assert.deepEqual(evidenceKeys.map(key => sample[key]), [4, '0-5', cgroup, '800000 100000']);
  }
});

test('JOED-189 CPU evidence stores only the trimmed allowed CPU list', () => {
  for (const [line, expected] of [
    ['Cpus_allowed_list:\t 0-15  \n', '0-15'],
    ['Cpus_allowed_list: 0-5,8-15\r\n', '0-5,8-15'],
    ['Cpus_allowed_list:\t\n', 'unavailable'],
    ['Name:\tnode\nMems_allowed_list:\t0\n', 'unavailable'],
  ]) {
    const files = fakeCPUFiles('/job/worker'); files.set('/proc/self/status', line);
    const sample = fakeCPUSample(files);
    assert.equal(sample.cpusAllowed, expected);
    const row = { viewport: '390', phase: 'live', attempt: 1, machineLoad: sample };
    assert.ok(machineLoadTable([row]).includes(`| ${expected} |`));
    assert.ok(budgetAttemptLine('Board', row).includes(`cpusAllowed=${expected},`));
    assert.doesNotMatch(machineLoadTable([row]) + budgetAttemptLine('Board', row), /Cpus_allowed_list:/);
  }
});

test('JOED-186 CPU evidence is independently unavailable on read errors or missing v2 fields', () => {
  for (const file of ['/proc/self/status', '/proc/self/cgroup', '/sys/fs/cgroup/job/worker/cpu.max']) {
    const files = fakeCPUFiles('/job/worker'); files.delete(file);
    const sample = fakeCPUSample(files);
    assert.equal(sample.availableParallelism, 4);
    assert.equal(sample.cpusAllowed, file.endsWith('status') ? 'unavailable' : '0-5');
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
  for (const row of rows) assert.equal(row.split('|').length - 2, 24, row);
  assert.match(rows[0], /availableParallelism \| cpusAllowed \| cgroup \| cpuMax/);
});
