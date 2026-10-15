#!/usr/bin/env node
// The render budget itself (ADR §9) on a named reference device: a normal
// Desk patch under 16 ms, a History draw under 50 ms and no task on the page
// reaching 50 ms, on the browser gate's own workload. CI holds only a 2.5 ×
// regression guard of these numbers (scripts/browser-p3.mjs), because its
// runners are slower and vary. Run this on mbp2606 or mbp2607 and record
// which, with the figures, in the ADR. One headless browser, nothing else.
import { hostname, cpus } from 'node:os';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, ACTOR } from './browser/board.mjs';
import { runBudget, budgetTable, REFERENCE_BUDGET, REFERENCE_DEVICES } from './browser/budget.mjs';

const device = hostname().split('.')[0];
const results = [];
function check(ac, name, ok, detail) {
  results.push({ ac, name, ok: Boolean(ok), detail });
  if (!ok) console.error(`FAIL ${ac} ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail).slice(0, 1200)}`}`);
}

const browser = await launch();
const engine = await browser.send('Browser.getVersion');
const boards = [];
let traces = null;
try {
  const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
  traces = await runBudget({ page, newBoard: async options => { const b = await startBoard(options); boards.push(b); return b; }, check, limits: REFERENCE_BUDGET });
} finally {
  await browser.close();
  for (const b of boards) await b.close();
}

const failed = results.filter(r => !r.ok);
console.log(`Device: ${device}${REFERENCE_DEVICES.includes(device) ? ' (reference device)' : ` (not a reference device: ${REFERENCE_DEVICES.join(' or ')}; these figures do not count)`}
Browser: ${engine.product} (headless, ${process.platform} ${process.arch}), ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, Node ${process.version}
Measured: ${new Date().toISOString()}

${budgetTable(traces, REFERENCE_BUDGET)}
${results.length - failed.length}/${results.length} ${REFERENCE_BUDGET.name} checks passed`);
process.exit(failed.length ? 1 : 0);
