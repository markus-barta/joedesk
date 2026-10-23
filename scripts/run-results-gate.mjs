#!/usr/bin/env node
// One browser suite at a time. Positional zones retain the full matrix;
// --full/--subset choose which complete views repeat in other zones.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createP4Views, parseResultsGateArgs, selectP4Views, summarizeP4Views, P4_DATE_PATHS } from './results-gate-plan.mjs';
import { realResultsFixtures } from './results-fixtures.mjs';

const script = fileURLToPath(new URL('./browser-p4.mjs', import.meta.url));

export function runResultsGate(args, {
  qaRoot = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p4'),
  spawn = spawnSync,
} = {}) {
  const zones = parseResultsGateArgs(args);
  const allViews = createP4Views(realResultsFixtures().map(f => f.name));
  const plan = zones.map(run => {
    const views = selectP4Views({ zoneSubset: run.mode === 'subset', only: (process.env.JOED_P4_ONLY ?? '').split(',').filter(Boolean) }, allViews);
    return { ...run, status: 'not run', views, summary: summarizeP4Views(views, allViews), directory: run.timeZone.replaceAll('/', '-') };
  });
  const subset = summarizeP4Views(selectP4Views({ zoneSubset: true }, allViews), allViews);
  mkdirSync(qaRoot, { recursive: true });
  const index = () => writeFileSync(join(qaRoot, 'index.md'), `# Results gate · zone runs

${process.env.JOED_P4_ONLY ? 'Focused by JOED_P4_ONLY.\n' : ''}
Static subset: **${subset.views}/${allViews.length} views**, **${subset.checks}/${subset.fullChecks} checks (${(100 * subset.share).toFixed(2)}% of P4)**.
Counts describe the successful baseline plan; each zone report records actual executed checks.
Subset target: at most 25% of full P4 checks. Host-zone checks, measured screenshot variants and one representative per date code path repeat in UTC and New York.

| Date code path | Representative view |
| --- | --- |
${P4_DATE_PATHS.map(path => `| ${path.name} | \`${path.representative}\` |`).join('\n')}

| Group | Sensitive views | Independent views |
| --- | --- | --- |
${subset.groups.map(g => `| ${g.name} | ${g.sensitive} | ${g.independent} |`).join('\n')}

| Host zone | Mode | Views | Static checks | P4 share | Result | Report |
| --- | --- | --- | --- | --- | --- | --- |
${plan.map(run => `| ${run.timeZone} | ${run.mode} | ${run.views.length} | ${run.summary.checks} | ${(100 * run.summary.share).toFixed(2)}% | ${run.status} | [zone index](${run.directory}/index.md) |`).join('\n')}

${plan.map(run => `## ${run.timeZone} · ${run.mode}\n\n${run.views.map(v => `- \`${v.name}\` — ${v.checks} checks; ${v.reason}`).join('\n')}`).join('\n\n')}
`);
  index();
  for (const run of plan) {
    console.log(`Results gate: ${run.mode} in ${run.timeZone} (${run.views.length} views, ${run.summary.checks} static checks, ${(100 * run.summary.share).toFixed(2)}% of P4; server, page and worker)`);
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
