#!/usr/bin/env node
// One browser suite at a time. Local defaults guard two non-Vienna hosts;
// pass explicit IANA zones to reproduce or run the full CI matrix.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const zones = process.argv.length > 2 ? process.argv.slice(2) : ['UTC', 'America/New_York'];
const qaRoot = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p4');
const script = fileURLToPath(new URL('./browser-p4.mjs', import.meta.url));
for (const timeZone of zones) {
  new Intl.DateTimeFormat('en', { timeZone }); // refuse invalid zones before launch
  console.log(`Results gate: server, page and worker in ${timeZone}`);
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, TZ: timeZone, JOED_QA_DIR: join(qaRoot, timeZone.replaceAll('/', '-')) },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
