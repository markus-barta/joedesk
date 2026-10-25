// The render budget's workload (ADR §9), shared by the CI gate and the
// reference-device run. First the largest history the contract allows (9,000
// points, 8 MiB) read cold; then live pushes of the largest position list
// (256 rows) over the largest history the server keeps while pushes arrive
// (it compacts at 6.4 MiB). Every update must be rendered and measured, and
// history is read and validated in the worker, never on the page. Only the
// limits differ: the reference device holds the budget itself
// (scripts/budget-reference.mjs); CI holds a regression guard of 2.5 × it.
import { largeScenario, wideSnapshot, NOW, at, ACTOR } from './board.mjs';
import { VIEWPORTS, configure, load, go, settle, waitFor } from './shots.mjs';
import { observeBudgetTasks, attributeBudgetTasks } from './budget-tasks.mjs';

export const REFERENCE_DEVICES = Object.freeze(['mbp2606', 'mbp2607']);
export const REFERENCE_BUDGET = Object.freeze({ name: 'reference budget', patchMs: 16, historyMs: 50, taskMs: 50, atMost: false });
export const CI_GUARD = Object.freeze({ name: 'CI guard, 2.5 × the reference budget', patchMs: 2.5 * REFERENCE_BUDGET.patchMs,
  historyMs: 2.5 * REFERENCE_BUDGET.historyMs, taskMs: 2.5 * REFERENCE_BUDGET.taskMs, atMost: true });

const max = list => (list.length ? Math.max(...list) : NaN);
// renderBudget is the cold History draw; historyBudget is its live update.
export const TIMING_GUARDS = Object.freeze(['patchBudget', 'historyBudget', 'renderBudget', 'taskBudget']);

// Only CI may repeat when every failed condition is a timing guard. The
// second measurement is final, including any functional failure it finds;
// reference limits stay strict. Keep the JOED-61 helper's calling contract.
export function decideTaskGuard(firstConditions, secondConditions, limits) {
  const failed = Object.keys(firstConditions).filter(key => !firstConditions[key]);
  const timingOnly = limits === CI_GUARD && failed.length > 0 && failed.every(key => TIMING_GUARDS.includes(key));
  const remeasured = timingOnly && secondConditions !== null;
  return { ok: remeasured ? Object.values(secondConditions).every(Boolean) : failed.length === 0,
    remeasure: timingOnly && !remeasured, remeasured, attempts: remeasured ? 2 : 1 };
}

export async function runBudget({ page, newBoard, check, limits }) {
  const within = (ms, limit) => (limits.atMost ? ms <= limit : ms < limit);
  const bound = limit => `${limits.atMost ? 'at most' : 'under'} ${limit} ms`;
  const tooLong = tasks => tasks.filter(ms => ms >= limits.taskMs);
  const observerSource = `(${observeBudgetTasks.toString()})()`;
  const verify = (name, conditions, row) => {
    const failed = Object.keys(conditions).filter(k => !conditions[k]);
    check('budget', name, !failed.length, { failed, conditions,
      // Put both concise measurements before the potentially large task
      // attribution so the failure log's detail limit cannot hide either one.
      ...(row.attemptRows ? { measurements: row.attemptRows.map(r => ({ attempt: r.attempt,
        patchMs: r.deskWorst ?? null, historyMs: r.historyWorst ?? r.renderWorst,
        taskMs: r.longTasks.length ? max(r.longTasks) : 0 })) } : {}),
      offendingTasks: row.longTaskDetails?.filter(t => t.duration >= limits.taskMs), ...row });
  };
  const traces = [];
  const runViewport = async (viewport, measure) => {
    await configure(page, viewport, 'light');
    const conditions = result => Object.assign({}, ...result.checks.map(c => c.conditions));
    const first = await measure(viewport);
    let decision = decideTaskGuard(conditions(first), null, limits);
    // Two explicit calls, never a retry loop: at most once per width/phase.
    const second = decision.remeasure ? await measure(viewport) : null;
    if (second) decision = decideTaskGuard(conditions(first), conditions(second), limits);
    const rows = (decision.remeasured ? [first, second] : [first]).map((result, i) => ({ ...result.row,
      attempt: i + 1, attempts: decision.attempts, remeasured: decision.remeasured,
      offendingTasks: result.row.longTaskDetails.filter(t => t.duration >= limits.taskMs) }));
    traces.push(...rows);
    const result = decision.remeasured ? second : first;
    for (const { name, conditions } of result.checks) {
      const label = decision.remeasured && Object.keys(conditions).some(key => TIMING_GUARDS.includes(key))
        ? name.replace(`(${limits.name})`, `(${limits.name}; re-measured once after a breach)`) : name;
      verify(label, conditions, { ...rows.at(-1), ...(decision.remeasured ? { attemptRows: rows } : {}) });
    }
  };
  const full = largeScenario(NOW);
  const measureCold = async viewport => {
    const cold = await newBoard({ history: full.history });
    cold.setNow(at(full.history.receivedAt, 9));
    const { identifier } = await page.s('Page.addScriptToEvaluateOnNewDocument', { source: observerSource });
    await load(page, cold.url, 'history');
    await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
    await waitFor(page, `window.__joedesk.timings.some(t => t.reason === 'history-worker')`, 30000);
    await settle(page);
    await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const trace = await page.evaluate(`({ timings: window.__joedesk.timings.slice(), tasks: window.__budgetTasks.snapshot(), worker: window.__joedesk.worker(), lines: document.querySelectorAll('#histChart > svg path[stroke^="var(--desk-"]').length })`);
    const work = trace.timings.filter(x => x.reason === 'history-worker');
    const renders = trace.timings.filter(x => ['history', 'history-range'].includes(x.reason)).map(x => x.ms);
    // Page start-up is not a poll; the tasks that count begin with History's arrival.
    const arrived = work[0]?.at ?? Infinity;
    const details = attributeBudgetTasks(trace.tasks, trace.timings, [{ name: 'cold history', start: arrived, end: Infinity }]);
    const row = { viewport: viewport.name, phase: `cold ${full.history.points.length} points`, workerRead: max(work.map(x => x.ms)), renders: renders.length, renderWorst: max(renders),
      mainThreadHistory: trace.timings.filter(x => x.reason === 'history-accept').length,
      longTasks: details.filter(t => t.phases.length).map(t => t.duration), startup: details.filter(t => !t.phases.length).map(t => t.duration),
      longTaskDetails: details.filter(t => t.phases.length), setupTasks: details.filter(t => !t.phases.length), frameAttributionSupported: trace.tasks.hasFrames };
    return { row, checks: [
      { name: `${viewport.name}: the ${full.history.points.length}-point (8 MiB) history is read and validated in the worker and drawn`,
        conditions: { worker: trace.worker, historyRead: work.length >= 1, noMainThreadHistory: !row.mainThreadHistory, drawn: trace.lines >= 3 } },
      { name: `${viewport.name}: drawing the full 8 MiB history takes ${bound(limits.historyMs)} with no task on the page reaching ${limits.taskMs} ms (${limits.name})`,
        conditions: { measured: renders.length > 0, renderBudget: within(row.renderWorst, limits.historyMs), taskBudget: !tooLong(row.longTasks).length } },
    ] };
  };
  for (const viewport of VIEWPORTS) await runViewport(viewport, measureCold);

  const live = largeScenario(NOW, 7200);
  const measureLive = async viewport => {
    const b = await newBoard({ history: live.history });
    let seq = live.snapshot.seq, t = 0;
    const pushWide = async () => {
      t += 30; const when = at(NOW, t);
      b.setNow(when);
      const r = await b.push(wideSnapshot(live.snapshot, when, ++seq, t));
      if (r.status !== 200) throw new Error(`wide push failed: ${JSON.stringify(r.body)}`);
      b.setNow(at(when, 1));
      // Row P000 (desk J) carries this push's price, so its render is visible.
      return `$${(20 + (t % 480)).toFixed(2).replace('.', ',')}`;
    };
    const firstMark = `document.querySelector('#positions .prow[data-desk="j"] .c-px')?.textContent.replace(/\\s/g, '')`;
    await pushWide();
    const { identifier } = await page.s('Page.addScriptToEvaluateOnNewDocument', { source: observerSource });
    await load(page, b.url, 'desk');
    await waitFor(page, `document.querySelectorAll('#positions .prow:not(.hd)').length === 254`);
    await settle(page);
    await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const deskSetup = await page.evaluate('({ timings: window.__joedesk.timings.splice(0), end: performance.now() })');
    const pushes = 5;
    for (let i = 0; i < pushes; i++) {
      const mark = await pushWide();
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `${firstMark} === ${JSON.stringify(mark)}`);
      await settle(page);
    }
    const deskEnd = await page.evaluate('({ timings: window.__joedesk.timings.splice(0), end: performance.now() })');
    await go(page, 'history');
    await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
    await settle(page);
    // Navigation and selecting the initial range are setup, not live polls.
    // Retain their tasks and attribution, but start History's update window
    // only after both have settled. Never drop a task overlapping a push.
    const historySetup = await page.evaluate('({ timings: window.__joedesk.timings.splice(0), end: performance.now() })');
    for (let i = 0; i < 3; i++) {
      await pushWide();
      const redraws = await page.evaluate(`window.__joedesk.timings.filter(t => t.reason === 'history').length`);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `window.__joedesk.timings.filter(t => t.reason === 'history').length > ${redraws}`, 30000);
      await settle(page);
    }
    const trace = await page.evaluate(`({ timings: window.__joedesk.timings.splice(0), end: performance.now(), tasks: window.__budgetTasks.snapshot(), worker: window.__joedesk.worker() })`);
    const deskPhase = deskEnd.timings, histPhase = trace.timings;
    const windows = [{ name: 'desk setup', start: 0, end: deskSetup.end },
      { name: 'desk updates', start: deskSetup.end, end: deskEnd.end },
      { name: 'history setup', start: deskEnd.end, end: historySetup.end },
      { name: 'history updates', start: historySetup.end, end: trace.end }];
    const details = attributeBudgetTasks(trace.tasks, [...deskSetup.timings, ...deskPhase, ...historySetup.timings, ...histPhase], windows);
    const measured = task => task.phases.some(phase => phase === 'desk updates' || phase === 'history updates');
    // Reads and their worker time are not renders (P4 adds the closed-trade record's).
    const renders = list => list.filter(x => !/-(accept|worker)$/.test(x.reason)).map(x => x.ms);
    const deskRenders = renders(deskPhase), histRenders = renders(histPhase);
    const work = [...deskPhase, ...histPhase].filter(x => x.reason === 'history-worker').map(x => x.ms);
    const mainAccept = [...deskPhase, ...histPhase].filter(x => x.reason === 'history-accept').length;
    const historyRedraws = histPhase.filter(x => x.reason === 'history').length;
    const row = { viewport: viewport.name, phase: 'live', deskRenders: deskRenders.length, deskWorst: max(deskRenders), historyRenders: histRenders.length, historyRedraws, historyWorst: max(histRenders),
      workerReads: work.length, workerWorst: max(work), mainThreadHistory: mainAccept,
      longTasks: details.filter(measured).map(t => t.duration), windows,
      longTaskDetails: details.filter(measured), setupTasks: details.filter(t => !measured(t)), frameAttributionSupported: trace.tasks.hasFrames };
    const kept = await (await fetch(`${b.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    row.points = kept.points.length;
    row.sizeBytes = kept.sizeBytes;
    return { row, checks: [
      { name: `${viewport.name}: ${pushes} live pushes of 256 positions were each rendered and measured`,
        conditions: { deskPushes: deskRenders.length >= pushes, historyPushes: histRenders.length >= 3, finite: [...deskRenders, ...histRenders].every(Number.isFinite) } },
      { name: `${viewport.name}: a normal patch (Desk data update) takes ${bound(limits.patchMs)} (${limits.name})`,
        conditions: { measured: deskRenders.length > 0, patchBudget: within(row.deskWorst, limits.patchMs) } },
      { name: `${viewport.name}: a History update with the near-maximum series renders in ${bound(limits.historyMs)} (${limits.name})`,
        conditions: { redraws: historyRedraws >= 3, historyBudget: within(row.historyWorst, limits.historyMs) } },
      { name: `${viewport.name}: no task on the page reaches ${limits.taskMs} ms during these updates (${limits.name})`,
        conditions: { taskBudget: !tooLong(row.longTasks).length } },
      { name: `${viewport.name}: history is read and validated in the worker, never on the page`,
        conditions: { worker: trace.worker, historyReads: work.length >= 3, noMainThreadHistory: !mainAccept } },
      { name: `${viewport.name}: the live trace kept a near-maximum history (${kept.points.length} points, ${(kept.sizeBytes / 1048576).toFixed(2)} MiB, not compacted)`,
        conditions: { nearMaximum: kept.points.length > 7200, notCompacted: !kept.compactedThrough } },
    ] };
  };
  for (const viewport of VIEWPORTS) await runViewport(viewport, measureLive);
  return traces;
}

// The trace as a table: one row per width and phase; with a guard above the
// 50 ms long-task line, the tasks that reach the guard get their own column.
export function budgetTable(traces, limits) {
  const guard = limits.taskMs > 50;
  const remeasured = traces.some(r => r.remeasured);
  return `| Width | Phase |${remeasured ? ' Attempt |' : ''} Desk patch worst (ms) | History draw worst (ms) | Worker read worst (ms) | Long tasks (≥ 50 ms) |${guard ? ` Tasks ≥ ${limits.taskMs} ms |` : ''}
| --- | --- |${remeasured ? ' --- |' : ''} --- | --- | --- | --- |${guard ? ' --- |' : ''}
${traces.map(r => `| ${r.viewport} | ${r.phase} |${remeasured ? ` ${r.attempt}/${r.attempts}${r.remeasured ? ' (re-measured)' : ''} |` : ''} ${r.deskWorst?.toFixed?.(1) ?? '—'} | ${(r.historyWorst ?? r.renderWorst)?.toFixed(1)} | ${(r.workerWorst ?? r.workerRead)?.toFixed(1)} | ${r.longTasks.length} |${guard ? ` ${r.longTasks.filter(ms => ms >= limits.taskMs).length} |` : ''}`).join('\n')}
`;
}
