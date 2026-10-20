import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

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
test('CI preserves push/PR triggers, offers manual dispatch and keeps host package installation hosted-only', t => {
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null, workflow_dispatch: null });
  const dir = scratch('joed-workflow-env-');
  t.after(() => discard(dir, 'workflow environment test'));
  for (const [id, job] of Object.entries(ci.jobs)) {
    const first = job.steps[0], output = join(dir, id);
    assert.equal(first.name, 'Keep temporary files under RUNNER_TEMP');
    const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', first.run], {
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
test('browser resolution exports the hosted path or the first installed self-hosted browser without launching it', t => {
  assert.ok(browserStep, 'early browser resolution step required');
  assert.equal(browserStep.env.RUNNER_KIND, '${{ runner.environment }}');
  assert.ok(ci.jobs.browser.steps.indexOf(browserStep) < ci.jobs.browser.steps.findIndex(step => step.run?.includes('scripts/browser-p3.mjs')));
  for (const [kind, installed, expected] of [
    ['github-hosted', ['chromium'], '/usr/bin/google-chrome'],
    ['self-hosted', ['chromium', 'chromium-browser', 'google-chrome'], 'chromium'],
    ['self-hosted', ['chromium-browser', 'google-chrome'], 'chromium-browser'],
    ['self-hosted', ['google-chrome'], 'google-chrome'],
    ['self-hosted', [], null],
  ]) {
    const dir = scratch('joed-workflow-browser-');
    t.after(() => discard(dir, 'workflow browser resolution test'));
    const output = join(dir, 'github-output');
    for (const binary of installed) writeFileSync(join(dir, binary), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', browserStep.run], {
      encoding: 'utf8', env: { ...process.env, PATH: dir, RUNNER_KIND: kind, GITHUB_ENV: output },
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
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', preflight.run], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(result.status, expected, result.stderr);
    if (expected) assert.match(result.stderr, /requires a rootless Docker daemon/);
  }
});
