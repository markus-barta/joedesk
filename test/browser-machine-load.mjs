import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureMachineLoad, machineLoadTable } from '../scripts/browser/machine-load.mjs';

test('budget host evidence counts browser executable names without requesting process arguments', () => {
  const sample = captureMachineLoad({
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
  assert.deepEqual(sample, { sampledAt: '2026-10-30T03:00:00.000Z', loadavg: [3, 2, 1], cpuCount: 12, browserProcesses: 8 });
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
