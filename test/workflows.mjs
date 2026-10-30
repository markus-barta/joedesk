import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { parseResultsGateArgs } from '../scripts/results-gate-plan.mjs';
// Both lightweight suites join the existing contracts/CI path.
import './results-gate.mjs';
import './browser-lock.mjs';

const GUARDED_RUNNER = '${{ (vars.JOEDESK_AGM2 == \'on\' && (github.event_name != \'pull_request\' || github.event.pull_request.head.repo.full_name == github.repository)) && fromJSON(\'["self-hosted","agm2"]\') || \'ubuntu-latest\' }}';
const directory = new URL('../.github/workflows/', import.meta.url);
const files = readdirSync(directory).filter(name => /\.ya?ml$/i.test(name)).sort();
assert.ok(files.length, 'At least one workflow must be checked');

function runnerPolicy(source, name) {
  const workflow = parse(source, { version: '1.2', uniqueKeys: true });
  assert.ok(workflow && typeof workflow === 'object' && !Array.isArray(workflow), `${name}: workflow mapping required`);
  const triggers = typeof workflow.on === 'string' ? [workflow.on] :
    Array.isArray(workflow.on) ? workflow.on : Object.keys(workflow.on ?? {});
  assert.ok(!triggers.includes('pull_request_target'), `${name}: pull_request_target is forbidden`);
  assert.ok(workflow.jobs && Object.keys(workflow.jobs).length, `${name}: jobs required`);
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.equal(job['runs-on'], GUARDED_RUNNER, `${name}/${id}: exact fork-safe, opt-in runner expression required`);
    const labels = Array.isArray(job['runs-on']) ? job['runs-on'] : [job['runs-on']];
    assert.ok(!labels.includes('self-hosted'), `${name}/${id}: unguarded self-hosted label is forbidden`);
  }
  return workflow;
}

const workflows = new Map(files.map(name => [name, readFileSync(new URL(name, directory), 'utf8')]));
for (const [name, source] of workflows) test(`workflow ${name}: every job uses the opt-in same-repository guard`, () => {
  runnerPolicy(source, name);
});

test('workflow lint rejects alternate trigger syntax, unguarded labels and a bypass on an extra job', () => {
  const fixture = { on: { push: null }, jobs: { package: { 'runs-on': GUARDED_RUNNER } } };
  assert.doesNotThrow(() => runnerPolicy(JSON.stringify(fixture), 'fixture.yaml'));
  for (const on of ['pull_request_target', ['push', 'pull_request_target'], { pull_request_target: null }]) {
    assert.throws(() => runnerPolicy(JSON.stringify({ ...fixture, on }), 'fixture.yaml'), /pull_request_target is forbidden/);
  }
  for (const runner of ['self-hosted', ['self-hosted', 'agm2'], { group: 'agm2' },
    'ubuntu-latest', "${{ vars.JOEDESK_AGM2 == 'on' && 'self-hosted' || 'ubuntu-latest' }}"]) {
    assert.throws(() => runnerPolicy(JSON.stringify({ ...fixture,
      jobs: { ...fixture.jobs, extra: { 'runs-on': runner } } }), 'fixture.yaml'), /exact fork-safe/);
  }
  assert.throws(() => runnerPolicy('on: push\njobs: {}\njobs: {}\n', 'fixture.yaml'), /keys must be unique/);
});

test('runner expression stays hosted by default and for fork PRs even when opted in', () => {
  // The policy above accepts only this fixed expression, whose operators also
  // have JavaScript syntax. Evaluate its actual branches with fixture contexts.
  const evaluate = new Function('vars', 'github', 'fromJSON', `return (${GUARDED_RUNNER.slice(3, -2)});`);
  const repository = 'markus-barta/joedesk';
  for (const setting of [undefined, '', 'off', 'on']) {
    for (const event of ['push', 'workflow_dispatch', 'pull_request']) {
      for (const head of [repository, 'outside/fork', undefined]) {
        const github = { repository, event_name: event, event: {
          pull_request: head ? { head: { repo: { full_name: head } } } : { head: { repo: {} } },
        } };
        const expected = setting === 'on' && (event !== 'pull_request' || head === repository)
          ? ['self-hosted', 'agm2'] : 'ubuntu-latest';
        assert.deepEqual(evaluate({ JOEDESK_AGM2: setting }, github, JSON.parse), expected,
          `${setting ?? 'unset'} / ${event} / ${head ?? 'missing head'}`);
      }
    }
  }
  assert.deepEqual(evaluate({ JOEDESK_AGM2: 'on' }, { repository, event_name: 'push', event: {} }, JSON.parse), ['self-hosted', 'agm2']);
});

const ci = parse(workflows.get('ci.yml'));
test('CI retains every run and locks all six browser phases once with room for three typical queued jobs', () => {
  assert.equal(ci.concurrency, undefined, 'workflow concurrency must not replace pending PR runs');
  for (const job of Object.values(ci.jobs)) assert.equal(job.concurrency, undefined);
  const steps = ci.jobs.browser.steps.filter(step => /scripts\/(?:browser-p[3456]|preview-capture(?:-ci)?)\.mjs|npm run test:results/.test(step.run ?? ''));
  assert.equal(steps.length, 1, 'no browser execution outside the combined step');
  assert.equal(steps[0].shell, 'bash scripts/with-browser-lock.sh {0}');
  assert.equal(ci.jobs.browser.steps.filter(step => step.shell?.includes('with-browser-lock.sh')).length, 1);
  for (const script of ['browser-p3', 'browser-p5', 'browser-p6', 'preview-capture', 'preview-capture-ci']) {
    assert.ok(steps[0].run.includes(`scripts/${script}.mjs`));
  }
  assert.equal(ci.jobs.browser['timeout-minutes'], 60 + 45 + 15);
});

function simulateBrowserPhases(t, { event = 'push', fail = '' } = {}) {
  const step = ci.jobs.browser.steps.find(step => step.shell?.includes('with-browser-lock.sh'));
  const dir = scratch('joed-workflow-phases-');
  t.after(() => discard(dir, 'workflow browser phases test'));
  const output = join(dir, 'commands');
  // Exercise the actual combined shell, replacing only browser/npm entry
  // points. Never launch a browser, server or real npm command.
  const fake = `#!/bin/sh
printf '%s|%s|%s\\n' "$*" "$JOED_QA_DIR" "$TZ" >> "$JOED_PHASE_COMMANDS"
case "$*" in
  *"$JOED_FAIL_PHASE"*) if [ -n "$JOED_FAIL_PHASE" ]; then exit 7; fi ;;
esac
case "$1" in scripts/preview-capture.mjs) exit 2 ;; esac
`;
  for (const command of ['node', 'npm']) writeFileSync(join(dir, command), fake, { mode: 0o700 });
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir,
      JOED_QA_ROOT: join(dir, 'qa'), GITHUB_EVENT_NAME: event, JOED_PHASE_COMMANDS: output, GITHUB_OUTPUT: join(dir, 'outputs'),
      JOED_FAIL_PHASE: fail },
  });
  return { result, dir, outputs: existsSync(join(dir, 'outputs')) ? readFileSync(join(dir, 'outputs'), 'utf8') : '',
    commands: readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('|')) };
}

test('combined browser step preserves all phase arguments, Results zone plans and QA directories for each event', t => {
  const step = ci.jobs.browser.steps.find(step => step.shell?.includes('with-browser-lock.sh'));
  assert.equal(step.env.JOED_QA_ROOT, '${{ runner.temp }}/joedesk-qa');
  const artifact = ci.jobs.browser.steps.find(step => step.with?.name === 'joedesk-p4-screenshots');
  assert.equal(artifact.if, 'always()');
  assert.equal(artifact.with.path, '${{ runner.temp }}/joedesk-qa/p4');
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
    const { result, dir, commands } = simulateBrowserPhases(t, { event });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(commands.length, 6, 'all browser phases execute inside the one shell');
    assert.equal(commands[0][0], `scripts/browser-p3.mjs ${event === 'pull_request' ? '--subset' : '--full'}`);
    assert.equal(commands[0][1], join(dir, 'qa/p3'));
    assert.equal(commands[1][1], join(dir, 'qa/p4'));
    assert.ok(commands[1][0].startsWith('run test:results -- '));
    assert.deepEqual(parseResultsGateArgs(commands[1][0].split(' ').slice(3)), event === 'push'
      ? ['UTC', 'Europe/Vienna', 'America/New_York'].map(timeZone => ({ timeZone, mode: 'full' }))
      : [{ timeZone: 'Europe/Vienna', mode: 'full' }, { timeZone: 'UTC', mode: 'subset' }, { timeZone: 'America/New_York', mode: 'subset' }]);
    assert.deepEqual(commands[2], ['scripts/browser-p5.mjs', join(dir, 'qa/p5'), 'UTC']);
    assert.match(commands[3][0], /^scripts\/preview-capture.mjs --base-url http:\/\/127.0.0.1:1\/joe\/ --out /);
    assert.deepEqual(commands[4], [`scripts/preview-capture-ci.mjs ${dir}/joedesk-preview-capture/proxy ${dir}/joedesk-preview-capture/actor`, '', 'UTC']);
    assert.deepEqual(commands[5], ['scripts/browser-p6.mjs', join(dir, 'qa/p6a'), 'UTC']);
  }
});

test('combined step retains failures, runs Results/Settings after earlier failures and gates previews/carry-overs', t => {
  for (const [fail, count] of [['browser-p3.mjs', 3], ['run test:results', 3], ['browser-p5.mjs', 3],
    ['preview-capture.mjs', 4], ['preview-capture-ci.mjs', 5], ['browser-p6.mjs', 6]]) {
    const { result, commands, outputs } = simulateBrowserPhases(t, { fail });
    assert.notEqual(result.status, 0, fail);
    assert.equal(commands.length, count, `${fail}: subsequent phases follow the previous failure policy`);
    assert.equal(outputs, fail === 'browser-p6.mjs' ? 'preview_ready=true\n' : '', 'completed previews survive carry-over failure');
  }
  const preview = ci.jobs.browser.steps.find(step => step.with?.name === 'joedesk-preview-capture');
  assert.equal(preview.if, "always() && steps.browser_phases.outputs.preview_ready == 'true'");
  for (const name of ['joedesk-p3-screenshots', 'joedesk-p4-screenshots', 'joedesk-p5-screenshots', 'joedesk-p6a-screenshots']) {
    const artifact = ci.jobs.browser.steps.find(step => step.with?.name === name);
    assert.equal(artifact.if, 'always()', `${name}: failed checks retain evidence`);
  }
});

test('CI preserves push/PR triggers, offers manual dispatch and keeps host package installation hosted-only', t => {
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null, workflow_dispatch: null });
  const dir = scratch('joed-workflow-env-');
  t.after(() => discard(dir, 'workflow environment test'));
  for (const [id, job] of Object.entries(ci.jobs)) {
    const first = job.steps[0], output = join(dir, id);
    assert.equal(first.name, 'Keep temporary files under RUNNER_TEMP');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', first.run], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, GITHUB_ENV: output },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), `TMPDIR=${dir}\nTMP=${dir}\nTEMP=${dir}\nNPM_CONFIG_CACHE=${dir}/npm-cache\n`);
    const checkouts = job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
    assert.ok(checkouts.length, `${id}: checkout required`);
    for (const step of checkouts) {
      assert.equal(step.with.clean, true, `${id}: clean checkout required`);
      assert.equal(step.with['persist-credentials'], false, `${id}: checkout must not persist credentials`);
    }
    for (const step of job.steps) {
      if (/\bsudo\b|\bapt(?:-get)?\b/.test(step.run ?? '')) {
        assert.equal(step.if, "runner.environment == 'github-hosted'", `${id}: host package installation must be hosted-only`);
      }
      assert.doesNotMatch(step.run ?? '', /\bnpm\s+(?:i|install)\b[^\n]*(?:--global\b|(?:^|\s)-g\b)/);
      assert.doesNotMatch(step.run ?? '', /\/tmp\//, `${id}: use RUNNER_TEMP for temporary files`);
      assert.equal(step.env?.BROWSER_PATH, undefined, `${id}: browser path must be inherited from GITHUB_ENV`);
    }
  }
});

const browserStep = ci.jobs.browser.steps.find(step => step.name === 'Resolve browser path');
test('browser resolution prefers executable BROWSER_PATH, falls back to PATH and keeps the hosted path without launching it', t => {
  assert.ok(browserStep, 'early browser resolution step required');
  assert.equal(browserStep.env.RUNNER_KIND, '${{ runner.environment }}');
  assert.ok(ci.jobs.browser.steps.indexOf(browserStep) < ci.jobs.browser.steps.findIndex(step => step.run?.includes('scripts/browser-p3.mjs')));
  const bash = spawnSync('bash', ['--noprofile', '--norc', '-c', 'command -v bash'], { encoding: 'utf8' });
  assert.equal(bash.status, 0, bash.stderr);
  for (const [kind, installed, expected, configuredMode] of [
    ['github-hosted', ['chromium'], '/usr/bin/google-chrome'],
    ['github-hosted', ['chromium'], '/usr/bin/google-chrome', 0o700],
    ['self-hosted', ['chromium', 'chromium-browser', 'google-chrome'], 'chromium'],
    ['self-hosted', ['chromium-browser', 'google-chrome'], 'chromium-browser'],
    ['self-hosted', ['google-chrome'], 'google-chrome'],
    ['self-hosted', [], null],
    ['self-hosted', ['chromium'], 'configured browser', 0o700],
    ['self-hosted', [], 'configured browser', 0o700],
    ['self-hosted', ['chromium'], 'chromium', 0o600],
    ['self-hosted', [], null, 0o600],
  ]) {
    const dir = scratch('joed-workflow-browser-');
    t.after(() => discard(dir, 'workflow browser resolution test'));
    const output = join(dir, 'github-output');
    // Keep lookup isolated from host browsers while resolving bash from PATH.
    symlinkSync(bash.stdout.trim(), join(dir, 'bash'));
    for (const binary of installed) writeFileSync(join(dir, binary), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    const configuredPath = configuredMode === undefined ? '' : join(dir, 'configured browser');
    if (configuredPath) writeFileSync(configuredPath, '#!/bin/sh\nexit 99\n', { mode: configuredMode });
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', browserStep.run], {
      encoding: 'utf8', env: { ...process.env, PATH: dir, BROWSER_PATH: configuredPath, RUNNER_KIND: kind, GITHUB_ENV: output },
    });
    assert.equal(result.status, expected ? 0 : 1, result.stderr);
    if (expected) assert.equal(readFileSync(output, 'utf8'), `BROWSER_PATH=${kind === 'github-hosted' ? expected : join(dir, expected)}\n`);
    else {
      assert.match(result.stdout, /::error::No browser found/);
      assert.ok(!existsSync(output), 'a missing browser must not export an empty path');
    }
  }
});

test('Docker commands avoid privileged builds and host networking; self-hosted builder setup requires a rootless daemon', t => {
  const steps = ci.jobs.docker.steps;
  const preflight = steps.find(step => step.name === 'Require rootless Docker on the self-hosted runner');
  assert.ok(preflight);
  assert.equal(preflight.if, "runner.environment == 'self-hosted'");
  assert.ok(steps.indexOf(preflight) < steps.findIndex(step => step.uses?.startsWith('docker/setup-buildx-action@')));
  for (const step of steps) assert.doesNotMatch(step.run ?? '', /--privileged\b|--network(?:=|\s+)host\b|--allow(?:=|\s+)(?:security\.insecure|network\.host)/);
  const dir = scratch('joed-workflow-docker-');
  t.after(() => discard(dir, 'workflow Docker preflight test'));
  // Fake only `docker info`; no daemon or container is started by this test.
  const docker = join(dir, 'docker');
  for (const [security, expected] of [[['name=rootless', 'name=seccomp,profile=builtin'], 0], [['name=seccomp,profile=builtin'], 1]]) {
    writeFileSync(docker, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(security)}'\n`, { mode: 0o700 });
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', preflight.run], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(result.status, expected, result.stderr);
    if (expected) assert.match(result.stderr, /requires a rootless Docker daemon/);
  }
});
