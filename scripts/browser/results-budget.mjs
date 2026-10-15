// The Results render budget (ADR §9), shared by the P4 gate (CI guard, 2.5 ×)
// and the reference-device run (scripts/budget-reference.mjs). The largest
// closed-trade record the 8 MiB contract allows for the design trade shape is
// read, validated and indexed in the worker; then every period and desk switch,
// a step and a day selection must render under the patch budget, with no task
// on the page reaching the long-task limit.
import { scenario, NOW, at } from './board.mjs';
import { largeResults } from './results.mjs';
import { VIEWPORTS, configure, load, settle, waitFor } from './shots.mjs';

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

export async function runResultsBudget({ page, newBoard, check, limits, serve }) {
  const within = (ms, limit) => (limits.atMost ? ms <= limit : ms < limit);
  const bound = limit => `${limits.atMost ? 'at most' : 'under'} ${limit} ms`;
  const { snapshot, history } = scenario(NOW);
  const board = await newBoard({ history });
  board.setNow(NOW);
  if ((await board.push(snapshot)).status !== 200) throw new Error('budget scenario push failed');
  board.setNow(at(NOW, 9));
  const record = largeResults(NOW);
  const sizeBytes = new TextEncoder().encode(JSON.stringify(record)).length;
  const unserve = await serve(record, board);
  const traces = [];
  try {
    for (const viewport of VIEWPORTS) {
      await configure(page, viewport, 'light');
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
      traces.push(row);
      check('budget', `${viewport.name}: the ${record.trades.length}-trade record is read, validated and indexed in the worker, never on the page`, trace.worker && !row.mainThreadResults, row);
      check('budget', `${viewport.name}: each of ${clicks.length} period, desk, step and day changes renders Results in ${bound(limits.patchMs)} (${limits.name})`, renders.length >= clicks.length && within(row.switchWorst, limits.patchMs), row);
      check('budget', `${viewport.name}: no task on the page reaches ${limits.taskMs} ms once the record has arrived (${limits.name})`, !row.longTasks.filter(ms => ms >= limits.taskMs).length, row);
    }
  } finally { await unserve(); }
  return traces;
}

export function resultsBudgetTable(traces, limits) {
  return `| Width | Record | Results render worst (ms) | Renders | Long tasks (≥ 50 ms) | Tasks ≥ ${limits.taskMs} ms |
| --- | --- | --- | --- | --- | --- |
${traces.map(r => `| ${r.viewport} | ${r.phase} | ${r.switchWorst.toFixed(1)} | ${r.switches} | ${r.longTasks.length} | ${r.longTasks.filter(ms => ms >= limits.taskMs).length} |`).join('\n')}
`;
}
