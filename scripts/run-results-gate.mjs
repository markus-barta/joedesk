#!/usr/bin/env node
// One browser suite at a time. Positional zones retain the full matrix;
// --full/--subset choose which complete scenarios repeat in other zones.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseResultsGateArgs, selectP4Scenarios } from './results-gate-plan.mjs';

const script = fileURLToPath(new URL('./browser-p4.mjs', import.meta.url));

export function runResultsGate(args, {
  qaRoot = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p4'),
  spawn = spawnSync,
} = {}) {
  const plan = parseResultsGateArgs(args).map(run => ({ ...run, status: 'not run',
    scenarios: selectP4Scenarios({ zoneSubset: run.mode === 'subset', only: (process.env.JOED_P4_ONLY ?? '').split(',').filter(Boolean) }),
    directory: run.timeZone.replaceAll('/', '-'),
  }));
  mkdirSync(qaRoot, { recursive: true });
  const index = () => writeFileSync(join(qaRoot, 'index.md'), `# Results gate · zone runs

${process.env.JOED_P4_ONLY ? 'Focused by JOED_P4_ONLY.\n' : ''}
| Host zone | Mode | Scenarios | Result | Report |
| --- | --- | --- | --- | --- |
${plan.map(run => `| ${run.timeZone} | ${run.mode} | ${run.scenarios.length} | ${run.status} | [zone index](${run.directory}/index.md) |`).join('\n')}

${plan.map(run => `## ${run.timeZone} · ${run.mode}\n\n${run.scenarios.map(s => `- \`${s.name}\` — ${s.reason}`).join('\n')}`).join('\n\n')}
`);
  index();
  for (const run of plan) {
    console.log(`Results gate: ${run.mode} in ${run.timeZone} (${run.scenarios.length} scenarios; server, page and worker)`);
    const result = spawn(process.execPath, [script, ...(run.mode === 'subset' ? ['--zone-subset'] : [])], {
      stdio: 'inherit',
      env: { ...process.env, TZ: run.timeZone, JOED_QA_DIR: join(qaRoot, run.directory) },
    });
    run.status = result.status === 0 ? 'passed' : 'failed';
    index();
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runResultsGate(process.argv.slice(2));
}
