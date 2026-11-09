// The Results render budget (ADR §9), shared by the P4 gate (CI guard, 2.5 ×)
// and the reference-device run (scripts/budget-reference.mjs). The largest
// closed-trade record the 8 MiB contract allows for the design trade shape is
// read, validated and indexed in the worker; then every period and desk switch,
// a step and a day selection must render under the patch budget, with no task
// on the page reaching the long-task limit.
import { scenario, NOW, at } from './board.mjs';
import { largeResults } from './results.mjs';
import { VIEWPORTS, configure, load, settle, waitFor } from './shots.mjs';
import { decideTaskGuard, TIMING_GUARDS, CI_GUARD } from './budget.mjs';
import { captureMachineLoad, machineLoadTable, waitForQuietHost, quietWaitCells, budgetAttemptLine } from './machine-load.mjs';
import { runReferenceProbe, captureReferenceProbe, probeCell } from './reference-probe.mjs';
import { PROBE_CALIBRATION, validateCalibration, attemptGuard, applyAttemptGuard, guardCheck, calibrationSummary, ratioCells, calibrationEvidence } from './ratio-guard.mjs';

const max = list => (list.length ? Math.max(...list) : NaN);

// Answer the page's (and its worker's) results.json reads with one record, in
// its served form, and the board's clock.
export async function serveResults(browser, page, board, payload) {
  const body = () => Buffer.from(JSON.stringify({ ...payload, receivedAt: at(board.clock(), -18) })).toString('base64');
  const handler = m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    const id = { requestId: m.params.requestId };
    if (!m.params.request.url.includes('results.json')) { browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}); return; }
    browser.send('Fetch.fulfillRequest', { ...id, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Joe-Server-Now', value: board.clock() }], body: body() }, m.sessionId).catch(() => {});
  };
  browser.on(handler);
  await page.setFetch([{ urlPattern: '*results.json*' }]);
  return async () => { await page.setFetch(null); browser.off(handler); };
}

export async function runResultsBudget({ page, newBoard, check, limits, serve, sampleLoad = captureMachineLoad, waitForQuiet = waitForQuietHost, probe = runReferenceProbe, calibration = PROBE_CALIBRATION, runSource, traces = [] }) {
  validateCalibration(calibration);
  const within = (ms, limit) => (limits.atMost ? ms <= limit : ms < limit);
  const displayMs = limit => Number.isInteger(limit) ? limit : limit.toFixed(1);
  const bound = limit => `${limits.atMost ? 'at most' : 'under'} ${displayMs(limit)} ms`;
  const { snapshot, history } = scenario(NOW);
  const board = await newBoard({ history });
  board.setNow(NOW);
  if ((await board.push(snapshot)).status !== 200) throw new Error('budget scenario push failed');
  board.setNow(at(NOW, 9));
  const record = largeResults(NOW);
  const sizeBytes = new TextEncoder().encode(JSON.stringify(record)).length;
  const unserve = await serve(record, board);
  const measure = async (viewport, timing) => {
    const { identifier } = await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__long = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([e.startTime, Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });` });
    await load(page, board.url, 'results');
    await waitFor(page, `window.__joedesk.timings.some(t => t.reason === 'results-worker') && document.querySelectorAll('#tiles .tile .tval .num').length > 0`, 30000);
    await settle(page);
    await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const arrived = await page.evaluate(`window.__joedesk.timings.find(t => t.reason === 'results-worker')?.at ?? 0`);
    await page.evaluate('window.__joedesk.timings.length = 0');
    const clicks = ['#periodSeg [data-period="all"]', '#deskSeg [data-desk="j"]', '#periodSeg [data-period="ytd"]', '#deskSeg [data-desk="all"]', '#periodSeg [data-period="month"]',
      '#prevPer', '#periodSeg [data-period="day"]', '#cal [data-day]:not(.fut)', '#periodSeg [data-period="week"]', '#deskSeg [data-desk="joel"]', '#deskSeg [data-desk="all"]'];
    for (const sel of clicks) { await page.evaluate(`document.querySelector('${sel}').click()`); await settle(page); }
    const trace = await page.evaluate(`({ timings: window.__joedesk.timings.slice(), long: (window.__long ?? []).slice(), worker: window.__joedesk.worker() })`);
    const renders = trace.timings.filter(t => t.reason.startsWith('results-') && !/-(accept|worker)$/.test(t.reason)).map(t => t.ms);
    const row = { viewport: viewport.name, phase: `${record.trades.length} trades, ${record.days.length} days (${(sizeBytes / 1048576).toFixed(2)} MiB)`, switches: renders.length, switchWorst: max(renders),
      mainThreadResults: trace.timings.filter(t => t.reason === 'results-accept').length, longTasks: trace.long.filter(([start, ms]) => start + ms >= arrived).map(([, ms]) => ms) };
    return { row, checks: [
      { name: `${viewport.name}: the ${record.trades.length}-trade record is read, validated and indexed in the worker, never on the page`,
        conditions: { worker: trace.worker, noMainThreadResults: !row.mainThreadResults } },
      { name: `${viewport.name}: each of ${clicks.length} period, desk, step and day changes renders Results in ${bound(timing.patchMs)} (${limits.name})`,
        conditions: { switchRenders: renders.length >= clicks.length, renderBudget: within(row.switchWorst, timing.patchMs) } },
      { name: `${viewport.name}: no task on the page reaches ${displayMs(timing.taskMs)} ms once the record has arrived (${limits.name})`,
        conditions: { taskBudget: !row.longTasks.some(ms => ms >= timing.taskMs) } },
    ] };
  };
  try {
    for (const viewport of VIEWPORTS) {
      await configure(page, viewport, 'light');
      const conditions = result => Object.assign({}, ...result.checks.map(c => c.conditions));
      const firstLoad = sampleLoad();
      const firstProbe = await captureReferenceProbe(page, probe, waitFor);
      const firstGuard = attemptGuard(limits, limits === CI_GUARD, calibration, viewport.name, 'results', firstProbe, runSource);
      const first = await measure(viewport, firstGuard.limitMs);
      applyAttemptGuard(first, firstGuard);
      const rows = [{ ...first.row, machineLoad: firstLoad, ...firstProbe, attempt: 1 }];
      traces.push(rows[0]);
      console.log(budgetAttemptLine('Results', rows[0]));
      let decision = decideTaskGuard(conditions(first), null, limits);
      // Two explicit calls: only a CI timing-only breach gets a second sample.
      const quietWait = decision.remeasure ? await waitForQuiet() : null;
      const secondLoad = decision.remeasure ? sampleLoad() : null;
      const secondProbe = decision.remeasure ? await captureReferenceProbe(page, probe, waitFor) : null;
      const secondGuard = decision.remeasure ? attemptGuard(limits, limits === CI_GUARD, calibration, viewport.name, 'results', secondProbe, runSource) : null;
      const second = decision.remeasure ? await measure(viewport, secondGuard.limitMs) : null;
      if (second) {
        applyAttemptGuard(second, secondGuard);
        rows.push({ ...second.row, machineLoad: secondLoad, ...secondProbe, quietWait, attempt: 2 });
        traces.push(rows[1]);
        console.log(budgetAttemptLine('Results', rows[1]));
      }
      if (second) decision = decideTaskGuard(conditions(first), conditions(second), limits);
      for (const row of rows) Object.assign(row, { attempts: decision.attempts, remeasured: decision.remeasured });
      const result = decision.remeasured ? second : first;
      for (const original of result.checks) {
        const { name, conditions } = guardCheck(original.name, original.conditions, rows.at(-1), TIMING_GUARDS);
        const failed = Object.keys(conditions).filter(key => !conditions[key]);
        const label = decision.remeasured && Object.keys(conditions).some(key => TIMING_GUARDS.includes(key))
          ? name.replace(`(${limits.name})`, `(${limits.name}; re-measured once after a breach)`) : name;
        check('budget', label, !failed.length, { failed, conditions,
          // Keep both concise samples ahead of potentially large task lists.
          measurements: rows.map(r => ({ attempt: r.attempt, k: r.k, limitMs: r.limitMs, hostTooSlowToJudge: r.hostTooSlowToJudge, ratioReason: r.ratioReason,
            switchMs: r.switchWorst, taskMs: r.longTasks.length ? max(r.longTasks) : null,
            load1: r.machineLoad?.loadavg?.[0] ?? null, probeMs: r.probeMs,
            ...(r.quietWait ? { quietWait: { waitedSeconds: r.quietWait.waitedSeconds, quiet: r.quietWait.quiet,
              threshold: r.quietWait.threshold, skipped: r.quietWait.skipped, skipReason: r.quietWait.skipReason } } : {}) })),
          calibration: rows.at(-1).calibration,
          offendingTasks: rows.at(-1).longTasks.filter(ms => ms >= rows.at(-1).limitMs.taskMs),
          ...rows.at(-1), ...(decision.remeasured ? { attemptRows: rows } : {}) });
      }
    }
  } finally { await unserve(); }
  return traces;
}

export function resultsBudgetTable(traces, limits, source) {
  const remeasured = traces.some(r => r.remeasured);
  return `Probe calibration: ${traces[0]?.calibration ?? calibrationSummary()}

| Width | Record | Probe layout / JS (ms) | k | Applied limits patch / history / task (ms) | Ratio evidence |${remeasured ? ' Attempt | Quiet wait seconds | Quiet reached | Quiet threshold (load1) | Wait start load1 | Job wait budget before (s) | Job wait budget after (s) | Wait skipped | Skip reason | Budget state |' : ''} Results render worst (ms) | Renders | Long task worst (ms) | Long tasks (≥ 50 ms) | Tasks ≥ applied task limit |
| --- | --- | --- | --- | --- | --- |${remeasured ? ' --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |' : ''} --- | --- | --- | --- | --- |
${traces.map(r => `| ${r.viewport} | ${r.phase} | ${probeCell(r)} |${ratioCells(r, limits)}${remeasured ? ` ${r.attempt}/${r.attempts}${r.remeasured ? ' (re-measured)' : ''} |${quietWaitCells(r.quietWait)}` : ''} ${r.switchWorst.toFixed(1)} | ${r.switches} | ${r.longTasks.length ? max(r.longTasks).toFixed(1) : '—'} | ${r.longTasks.length} | ${r.longTasks.filter(ms => ms >= (r.limitMs ?? limits).taskMs).length} |`).join('\n')}

${machineLoadTable(traces)}
${calibrationEvidence(traces, source)}
`;
}
