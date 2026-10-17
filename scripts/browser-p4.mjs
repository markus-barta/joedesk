#!/usr/bin/env node
// P4 browser gate: Results against results v2 fixtures, through the real board
// server (state, history, fleet settings) with the closed-trade record served
// as the contract's served form, at 390/1024/1440 in light and dark
// (AC-10–17, 41, 42, 46, Part A craft), plus Tick's desk-card header at 390.
// JOED-29 adds a focused phone calendar scenario at 360/390 in both themes.
// JOED-30 adds partial-days: its own month, panel and sheet at every width.
// One headless browser, one page, run sequentially; screenshots go to the QA folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';
import * as nodeModule from 'node:module';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, scenario, NOW, at, ACTOR, valid, measureHistory } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load, go, settle, waitFor } from './browser/shots.mjs';
import { createGate, shifted, proportional, WIDE_FONT } from './browser/gate.mjs';
import { CI_GUARD, REFERENCE_BUDGET } from './browser/budget.mjs';
import { runResultsBudget, resultsBudgetTable } from './browser/results-budget.mjs';
import { designResults, withTradeSummaries, partialDaysResults } from './browser/results.mjs';

// The page's own model and formatting, for the numbers Results must show. The
// server serves time.mjs and contracts/ from the repo root; mirror that here.
const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}
const M = await import('../public/joe/results-model.js');
const hm = await import('../public/joe/history-model.js');
const fmt = await import('../public/joe/format.js');
const { decimalUnits, unitsDecimal } = await import('../contracts/decimal.mjs');
const { validateContract } = await import('../contracts/index.mjs');
const { missingResultsDays } = await import('../contracts/vienna-date.mjs');

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p4');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const { results, shots, check: gateCheck, shot, auditScreen } = createGate(QA_DIR);
const check = (ac, name, ok, detail) => {
  gateCheck(ac, name, ok, detail);
  // Preserve both geometry snapshots and every clipping row in the CI log.
  if (!ok && ['phone-calendar', 'partial-days'].includes(ac)) console.error(`PAYLOAD ${ac} ${name}: ${JSON.stringify(detail)}`);
};
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/results/${name}.json`, import.meta.url)));
const ONLY = (process.env.JOED_P4_ONLY ?? '').split(',').filter(Boolean);
const run = name => !ONLY.length || ONLY.includes(name);

const N = text => String(text ?? '').replace(/[\s ]+/g, '');
const NB = '\u00a0';
const money = n => (n === null || n === undefined ? '—' : fmt.money(n, 'EUR', true));
const two = (a, b) => `${a === null || a === undefined ? '—' : money(a)}/${b === null || b === undefined ? '—' : money(b)}`;
const DESKS = ['j', 'joe', 'joel'];
const PERIODS = ['day', 'week', 'month', 'ytd', 'all'];
const DESK_CHOICES = ['all', 'j', 'joe', 'joel'];

// Everything Results shows, read from the page.
const RES = `(() => {
  const t = el => (el?.innerText ?? '').replace(/\u00a0(?=·)/g, ' ');
  const svg = document.querySelector('#curve > svg');
  return {
    label: t(document.querySelector('#perLabel .cur')), bd: t(document.getElementById('bdTitle')), legend: [...document.querySelectorAll('#curveLegend .lg')].map(t),
    prev: document.getElementById('prevPer').disabled, next: document.getElementById('nextPer').disabled,
    who: t(document.querySelector('#rheroL .hero-k')), display: t(document.querySelector('#rheroL .display')), say: t(document.querySelector('#rheroL .say')),
    split: [...document.querySelectorAll('#rheroL .split dd')].map(t), bench: t(document.querySelector('#rheroL .bench')),
    tiles: [...document.querySelectorAll('#tiles .tile')].map(el => ({ k: el.dataset.tile, val: t(el.querySelector('.tval')), mean: t(el.querySelector('.tmean')), head: t(el.querySelector('h3')) })),
    rows: [...document.querySelectorAll('#breakdown .brow')].map(el => ({ row: el.dataset.row, sel: el.classList.contains('sel'), bg: getComputedStyle(el).backgroundColor, val: t(el.querySelector('.val')), facts: el.querySelector('.facts').textContent, bar: el.querySelector('.track .b') ? Number(el.querySelector('.track .b').dataset.v) : null })),
    cal: { title: t(document.querySelector('#calTitle .cur')), sum: document.getElementById('calSum').textContent, slots: document.querySelectorAll('#cal .cell').length, weeks: document.querySelectorAll('#cal .wk').length,
      cells: [...document.querySelectorAll('#cal [data-day]')].map(el => ({ day: el.dataset.day, cls: el.className, v: el.querySelector('.vl')?.textContent ?? el.querySelector('.v').textContent, arrow: el.querySelector('.vl use')?.getAttribute('href') ?? null,
        n: el.querySelector('.n').textContent, aria: el.getAttribute('aria-label'), bg: getComputedStyle(el).backgroundColor, ring: getComputedStyle(el).boxShadow })),
      legend: t(document.getElementById('calLegend')) },
    day: { head: t(document.querySelector('#daypanel h3')), sum: t(document.querySelector('#daypanel .dp-sum')), rows: document.querySelectorAll('#daypanel .trow').length, text: t(document.getElementById('daypanel')) },
    curve: svg ? { aria: svg.getAttribute('aria-label'), zero: svg.hasAttribute('data-zero'), lo: Number(svg.dataset.ylo), hi: Number(svg.dataset.yhi), base: svg.dataset.base === undefined ? null : Number(svg.dataset.base),
      ticks: [...svg.querySelectorAll('text[text-anchor="end"]')].filter(x => Number(x.getAttribute('x')) < 64).map(x => ({ text: x.textContent, y: Number(x.getAttribute('y')) })), strong: svg.querySelectorAll('line[stroke-width="1.4"]').length,
      marker: [...svg.querySelectorAll('text[text-anchor="start"]')].map(x => x.textContent).find(x => x.startsWith('tracking')) ?? null, estimate: svg.querySelectorAll('[data-estimate]').length,
      lines: svg.querySelectorAll('path[fill="none"]').length, empty: svg.querySelectorAll('path').length === 0, width: svg.viewBox.baseVal.width,
      paths: [...svg.querySelectorAll('path[fill="none"]')].map(p => p.getAttribute('d')) } : null,
    status: t(document.getElementById('resStatus')),
  };
})()`;

// The numbers Results must show, from the same model and inputs as the page.
function expected(ix, inputs, period, anchor, desk) {
  const desks = desk === 'all' ? DESKS : [desk];
  const per = M.periodOf(period, anchor, inputs.today, ix.meta.trackingStart);
  const ctx = desksOf => M.moneyContext(ix, inputs, per, desksOf);
  const R = M.rollup(ix, per, desks, ctx(desks));
  return { per, R, rows: [...DESKS.map(d => M.rollup(ix, per, [d], ctx([d]))), M.rollup(ix, per, DESKS, ctx(DESKS))] };
}

function compare(tag, r, e) {
  const { per, R } = e;
  const none = R.empty;
  const facts = [];
  const want = (what, got, expect) => { if (N(got) !== N(expect)) facts.push({ what, got, expect }); };
  want('stepper', r.label, per.lab);
  want('by desk heading', r.bd, `By desk · ${per.head}`);
  want('chart legend', r.legend[0], `Result so far · ${per.head}`);
  want('net', r.display, none || R.net === null ? '—' : money(R.net));
  want('closed trades', r.split[0], none ? '—' : money(R.realised));
  want('still open', r.split[1], none || R.unreal === null ? '—' : money(R.unreal));
  want('before fees', r.split[2], none ? '—' : money(R.gross));
  want('fees', r.split[3], none ? '—' : fmt.eur(R.fees ? -R.fees : 0));
  const tile = k => r.tiles.find(x => x.k === k);
  want('trades', tile('trades').val, R.trades || '—');
  if (R.trades) want('trades split', tile('trades').mean, `${R.won} won · ${R.lost} lost · ${R.flat} flat`);
  want('win rate', tile('won').val, R.winRate === null ? '—' : `${R.winRate}%`);
  if (R.winRate !== null) want('win rate sample', tile('won').mean, `${R.won} of ${R.won + R.lost}${R.small ? ' · small sample' : ''}`);
  want('average per trade', tile('avgtrade').val, R.expectancy === null ? '—' : money(R.expectancy));
  want('gains against losses', tile('pf').val, R.pf === null ? '—' : fmt.digits(R.pf));
  want('typical win and loss', tile('typical').val, R.avgWin === null && R.avgLoss === null ? '—' : two(R.avgWin, R.avgLoss));
  want('best and worst trade', tile('besttrade').val, !R.best && !R.worst ? '—' : two(R.best?.net, R.worst?.net));
  want('biggest dip', tile('dip').val, none || R.dd === null ? '—' : money(R.dd));
  const oneDay = R.bestDay && R.bestDay.date === R.worstDay.date;
  want('best and worst day', tile('bestday').val, !R.bestDay ? '—' : oneDay ? money(R.bestDay.net) : two(R.bestDay.net, R.worstDay.net));
  // AC-10: no tile and not the hero carries a period label.
  const periodWords = /\b(this week|last week|today|yesterday|this month|this year|all time)\b/i;
  if (r.tiles.some(x => periodWords.test(`${x.head} ${x.mean}`)) || periodWords.test(r.who)) facts.push({ what: 'period label on a tile or the hero' });
  ['j', 'joe', 'joel', 'all'].forEach((id, i) => {
    const x = e.rows[i], row = r.rows[i];
    want(`by desk ${id}`, row.val, x.empty || x.net === null ? '—' : money(x.net));
    if (!N(row.facts).startsWith(N(x.trades ? `${x.trades} trade` : 'No trades'))) facts.push({ what: `by desk ${id} facts`, got: row.facts, trades: x.trades });
  });
  check('AC-10', `${tag}: every number, the stepper and both headings follow ${per.p} · ${r.who.split('·').pop().trim()}`, !facts.length, facts.slice(0, 6));
  return facts;
}

// AC-14 for the month shown: 6 rows, each day's state and tint from the model.
function calendarFacts(r, ix, desks, today, trackingStart) {
  const faults = [];
  if (r.cal.slots !== 42 || r.cal.weeks !== 6) faults.push({ slots: r.cal.slots, weeks: r.cal.weeks });
  const max = M.maxAbsDay(ix, desks);
  for (const c of r.cal.cells) {
    const res = M.dayResult(ix, c.day, desks);
    const cls = c.cls.split(' ');
    if (c.day > today) { if (!cls.includes('fut') || c.v) faults.push({ day: c.day, want: 'future', cls: c.cls }); continue; }
    if (res.count) {
      const step = Math.abs(res.net) < 0.005 ? 'flat' : `${res.units > 0n ? 'g' : 'l'}${M.tintStep(res.units, max)}`;
      const sign = Math.abs(res.net) < 0.005 ? '' : res.net > 0 ? '+' : '−';
      const arrowOk = step === 'flat' ? !c.arrow : c.arrow === (res.net > 0 ? '#i-up' : '#i-down');
      if (!cls.includes(step) || !arrowOk || !c.v.startsWith(sign) || N(c.n) !== N(`${res.count} trade${res.count === 1 ? '' : 's'}`) ||
        !N(c.aria).includes(N(step === 'flat' ? fmt.money(0) : fmt.eur(res.net, true))) || c.bg === 'rgba(0, 0, 0, 0)') faults.push({ day: c.day, want: step, cls: c.cls, v: c.v, arrow: c.arrow, n: c.n, aria: c.aria });
      continue;
    }
    const closed = M.isWeekend(c.day) || M.marketHoliday(c.day);
    const want = closed ? 'we' : c.day < trackingStart ? 'pre' : 'none';
    if (!cls.includes(want) || (want === 'none' && (c.n !== 'no trades' || !/inset/.test(c.ring)))) faults.push({ day: c.day, want, cls: c.cls, n: c.n, ring: c.ring });
  }
  return faults;
}

const SHIFT = ['.res-tools', '#periodSeg', '#deskSeg', '#prevPer', '#perLabel', '#nextPer', '#rhero', '#rheroL .hero-k', '#rheroL .display', '#rheroL .split', '#rheroL .bench',
  '#curveLegend', '#curve', '.tile', '.tile .tval', '.tile .tfoot', '#bdTitle', '.brow', '.brow .val', '.brow .track', '.calcard', '.cal-head', '#calTitle', '#prevMonth', '#nextMonth',
  '.cal-legend', '#daypanel', '.dp-head', 'footer.foot'];
const SAY = ['#rheroL .say'];
// The calendar's 42 day slots, 6 week cells and the weekday row, hidden ones
// included: a month's days change, its grid never does.
const SLOTS = `[...document.querySelectorAll('#cal > *')].map((el, i) => { const r = el.getBoundingClientRect(); return { key: \`slot#\${i}\`, top: r.top + scrollY, left: r.left, height: r.height, width: r.width }; })`;
const rects = async (page, list) => [...await page.evaluate(`__audit.rects(${JSON.stringify(list)})`), ...(list === SHIFT ? await page.evaluate(SLOTS) : [])];
const click = async (page, selector) => { await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(page); };
// The window as the phone shows it (a sheet sits at the bottom of the window, not of the page).
const viewShot = async (page, name, what) => {
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(QA_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  shots.push({ file: `${name}.png`, what });
};
const key = async (page, name) => {
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13 });
  await settle(page);
};

const browser = await launch({ hostRules: 'MAP joedesk.example.test 127.0.0.1' });
const engine = await browser.send('Browser.getVersion');
const reference = `${engine.product} (headless, ${process.platform} ${process.arch}), ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, Node ${process.version}`;
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
const hostTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const expectedTimeZone = new Intl.DateTimeFormat('en', { timeZone: process.env.TZ ?? hostTimeZone }).resolvedOptions().timeZone;
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: AUDIT });
const boards = [];
async function newBoard(options) { const b = await startBoard(options); boards.push(b); return b; }
let budgetTrace = null;
const phoneMeasurements = [], phoneTapInfo = [];

// The record (or a status) for every results.json read of the page and its worker.
let answer = null;
browser.on(m => {
  if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
  const id = { requestId: m.params.requestId };
  if (!answer || !m.params.request.url.includes('results.json')) { browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}); return; }
  const a = typeof answer === 'function' ? answer() : answer;
  if (a.fail) { browser.send('Fetch.failRequest', { ...id, errorReason: a.fail }, m.sessionId).catch(() => {}); return; }
  browser.send('Fetch.fulfillRequest', { ...id, responseCode: a.status ?? 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...(a.clock ? [{ name: 'X-Joe-Server-Now', value: a.clock() }] : [])],
    body: Buffer.from(JSON.stringify(a.body)).toString('base64') }, m.sessionId).catch(() => {});
});
const serve = async next => { answer = next; await page.setFetch(next ? [{ urlPattern: '*results.json*' }] : null); };
// A served record: the contract's served form, received shortly before now.
const served = (payload, board, receivedAgo = 18) => () => ({ body: { ...payload, receivedAt: at(board.clock(), -receivedAgo) }, clock: board.clock });

// What the page reads besides the record, as the page derives it: today's
// money from the snapshot, History's columns and the basis cuts of both.
function viewInputs(snapshot, servedHistory, nowMs) {
  const todayUnits = DESKS.map(id => { const e = snapshot.desks.find(d => d.id === id).money.equity; return e ? decimalUnits(e.amount) : null; });
  const cols = hm.toColumns(servedHistory.points);
  const current = Object.fromEntries(DESKS.map((id, i) => [id, todayUnits[i] === null ? null : snapshot.desks.find(d => d.id === id)]));
  return { today: M.viennaDate(nowMs), todayUnits, nowMs, cols, cuts: M.basisCuts(cols, current, nowMs) };
}

// One board with the design scenario at a given time (edit: changes to its
// snapshot or history before they reach the board).
async function designBoard(now = NOW, fleetConfig = null, edit = null) {
  const { snapshot, history } = scenario(now, now === NOW ? {} : { historyFrom: at(now, -7 * 86400) });
  if (edit) { edit({ snapshot, history }); measureHistory(history); }
  const board = await newBoard({ history, fleetConfig });
  board.setNow(now);
  const r = await board.push(snapshot);
  if (r.status !== 200) throw new Error(`scenario push failed: ${JSON.stringify(r.body)}`);
  board.setNow(at(now, 9));
  const servedHistory = await (await fetch(`${board.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
  const inputs = viewInputs(snapshot, servedHistory, Date.parse(at(now, 9)));
  return { board, snapshot, inputs };
}
const reset = async () => { for (const s of ['#periodSeg [data-period="week"]', '#deskSeg [data-desk="all"]']) await click(page, s); };

try {
  check('host-timezone', 'the server uses the requested host zone', hostTimeZone === expectedTimeZone, { hostTimeZone, expectedTimeZone });
  const pageTimeZone = await page.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone');
  check('host-timezone', 'the page uses the requested host zone', pageTimeZone === expectedTimeZone, { pageTimeZone, expectedTimeZone });
  if (run('design')) {
    // 1 · The design record at every viewport and theme: craft audit, every
    // period × desk against the model, no shift, By desk, calendar, a day, the chart.
    const { board, inputs } = await designBoard();
    const record = designResults(NOW);
    const ix = M.indexResults({ ...record, receivedAt: record.receivedAt });
    await serve(served(record, board));
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
      await auditScreen(page, viewport, theme, 'results');
      await shot(page, viewport, `${viewport.name}-${theme}-results`, 'Results, design record: this week, all desks');
      const base = await rects(page, SHIFT), baseSay = await rects(page, SAY);
      let moved = [];
      for (const period of PERIODS) for (const desk of DESK_CHOICES) {
        await click(page, `#periodSeg [data-period="${period}"]`);
        await click(page, `#deskSeg [data-desk="${desk}"]`);
        const r = await page.evaluate(RES);
        const e = expected(ix, inputs, period, inputs.today, desk);
        compare(`${tag} ${period} ${desk}`, r, e);
        // AC-13: J, Joe, Joel and Total, the chosen one tinted.
        const tinted = r.rows.filter(x => x.sel);
        check('AC-13', `${tag} ${period} ${desk}: By desk lists J, Joe, Joel and Total; the chosen row is tinted`, r.rows.map(x => x.row).join() === 'j,joe,joel,all' && tinted.length === 1 && tinted[0].row === desk && tinted[0].bg !== 'rgba(0, 0, 0, 0)', r.rows.map(x => [x.row, x.sel, x.bg]));
        // AC-42: By desk bars proportional on one shared scale.
        const bars = await page.evaluate(`__audit.bars('#breakdown .track .b')`);
        check('AC-42', `${tag} ${period} ${desk}: By desk bars are proportional on one shared scale`, !proportional(bars, 'by desk'), proportional(bars, 'by desk'));
        // AC-17 / AC-46: to scale, zero-based, at least ±0,5 % of the period start.
        const c = r.curve;
        if (c && !c.empty) {
          const steps = c.ticks.map((t, i, l) => (i ? t.y - l[i - 1].y : null)).filter(x => x !== null);
          const linear = steps.every(s => Math.abs(s - steps[0]) < 0.6);
          const spanOk = c.base !== null && c.hi - c.lo >= Math.abs(c.base) * 0.01 - 1e-6;
          const marker = e.per.start <= ix.meta.trackingStart ? c.marker === `tracking from ${M.fmtDM(ix.meta.trackingStart)}` : c.marker === null;
          check('AC-17', `${tag} ${period} ${desk}: the chart is linear with labelled ticks, zero-based, spans ≥ 1 % of the start, shows the start line and the tracking marker, draws no benchmark`,
            c.zero && c.lo <= 0 && c.hi >= 0 && spanOk && Number(c.base) === M.unitsCents(e.R.units.startE) && c.ticks.length >= 3 && c.ticks.every(t => /€/.test(t.text)) && linear && c.strong >= 1 && marker && !c.estimate && c.lines === 1,
            { c, start: e.per.start });
        }
        check('AC-46', `${tag} ${period} ${desk}: the legend reads "Result so far" and the benchmark "No index chosen"`, r.legend[0].startsWith('Result so far · ') && r.legend.includes('Zero') && r.legend.includes('No index chosen'), r.legend);
        moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height']), shifted(baseSay, await rects(page, SAY), ['top', 'left']));
      }
      check('AC-11', `${tag}: 20 period × desk switches move nothing (±0.5 px)`, !moved.length, moved.slice(0, 6));
      await reset();
      // Stepping, the month arrows and a day: still nothing moves.
      moved = [];
      for (const [period, steps] of [['day', 6], ['week', 3], ['month', 2]]) {
        await click(page, `#periodSeg [data-period="${period}"]`);
        for (let i = 0; i < steps; i++) {
          await click(page, '#prevPer');
          const r = await page.evaluate(RES);
          const anchor = await page.evaluate(`(() => { const s = [...document.querySelectorAll('#cal [data-day].sel')][0]; return s?.dataset.day; })()`);
          compare(`${tag} ${period} back ${i + 1}`, r, expected(ix, inputs, period, anchor, 'all'));
          moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height']));
        }
        for (let i = 0; i < steps; i++) await click(page, '#nextPer');
        const r = await page.evaluate(RES);
        check('AC-10', `${tag} ${period}: the stepper stops at today`, r.next === true, r.label);
      }
      for (let i = 0; i < 3; i++) { await click(page, '#prevMonth'); moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height'])); }
      const aug = await page.evaluate(RES);
      check('AC-10', `${tag}: the months stop at 1 Aug of the first tracked year`, await page.evaluate(`document.getElementById('prevMonth').disabled`) && aug.cal.title.startsWith('July') === false, aug.cal.title);
      for (let i = 0; i < 3; i++) await click(page, '#nextMonth');
      check('AC-11', `${tag}: stepping Day, Week and Month and the month arrows move nothing (±0.5 px)`, !moved.length, moved.slice(0, 6));
      await reset();
      // AC-14 on the shown month and the two before it.
      for (let i = 0; i < 3; i++) {
        const r = await page.evaluate(RES);
        const faults = calendarFacts(r, ix, DESKS, inputs.today, ix.meta.trackingStart);
        check('AC-14', `${tag} ${r.cal.title}: 6 rows; every day's state, tint, sign and arrow follow the record`, !faults.length, faults.slice(0, 5));
        await click(page, '#prevMonth');
      }
      for (let i = 0; i < 3; i++) await click(page, '#nextMonth');
      // AC-15: a day shows exactly its closed trades.
      const days = (await page.evaluate(RES)).cal.cells.filter(c => /from\s\d+\strade/.test(c.aria)).slice(-4);
      check('AC-15', `${tag}: the month has days with trades to open`, days.length === 4, days.length);
      moved = [];
      for (const d of days) {
        const count = Number(d.aria.match(/from\s(\d+)\strade/)[1]);
        if (viewport.mobile) {
          await click(page, `#cal [data-day="${d.day}"]`);
          const sheet = await page.evaluate(`({ open: document.getElementById('daySheet').open, head: document.getElementById('sheetTitle').innerText, rows: document.querySelectorAll('#sheetBody .trow').length, active: document.activeElement?.closest('dialog')?.id ?? null, opaque: __audit.opaque(document.getElementById('daySheet')) })`);
          check('AC-15', `${tag}: tapping ${d.day} opens the sheet with exactly its ${count} trades`, sheet.open && N(sheet.head) === N(`Trades on ${M.fmtDDM(d.day)}`) && sheet.rows === count && sheet.active === 'daySheet' && sheet.opaque.bgAlpha === 1, sheet);
          if (d === days.at(-1)) await viewShot(page, `${viewport.name}-${theme}-results-sheet`, `Results on a phone: a day's trades in the sheet (${M.fmtDDM(d.day)})`);
          await key(page, 'Escape');
          const closed = await page.evaluate(`({ open: document.getElementById('daySheet').open, focus: document.activeElement?.dataset?.day ?? null })`);
          check('AC-15', `${tag}: Escape closes the sheet and focus returns to ${d.day}`, !closed.open && closed.focus === d.day, closed);
        } else {
          await click(page, `#cal [data-day="${d.day}"]`);
          const r = await page.evaluate(RES);
          const listed = M.tradesOn(ix, d.day, DESKS);
          check('AC-15', `${tag}: ${d.day} shows exactly its ${count} closed trades, its date as the heading`, N(r.day.head) === N(`Trades on ${M.fmtDDM(d.day)}`) && r.day.rows === count && listed.length === count &&
            N(r.day.sum) === N(`${count} trade${count === 1 ? '' : 's'} · ${fmt.eur(M.dayResult(ix, d.day, DESKS).net, true)}`), { head: r.day.head, rows: r.day.rows, count, sum: r.day.sum });
          moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height']));
        }
      }
      if (viewport.mobile) {
        await click(page, `#cal [data-day="${days.at(-1).day}"]`);
        await click(page, '#daySheet [data-close]');
        check('AC-15', `${tag}: the sheet's × closes it`, !(await page.evaluate(`document.getElementById('daySheet').open`)));
      } else check('AC-11', `${tag}: selecting days moves nothing (±0.5 px)`, !moved.length, moved.slice(0, 6));
      await reset();
      // AC-46 / AC-41: the crosshair tip on the hero chart.
      if (!viewport.mobile) {
        const p = await page.evaluate(`(() => { const r = document.getElementById('curve').getBoundingClientRect(); return { x: r.right - 20, y: r.top + r.height / 2 }; })()`);
        await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
        await settle(page);
        const tip = await page.evaluate(`(() => { const t = document.querySelector('#curve .ctip'); return { on: t.classList.contains('on'), text: t.innerText, ...__audit.opaque(t) }; })()`);
        check('AC-46', `${tag}: the crosshair tip reads "… · result so far ±€ …" on an opaque surface`, tip.on && /· result so far [+−]?€/.test(tip.text) && tip.bgAlpha === 1 && tip.opacity === 1, tip);
        if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-results-tip`, 'Results: the crosshair tip on the hero chart');
        await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
      }
      // Kept holdings never appear on Results.
      const kept = await page.evaluate(`/\\b(SXR8|TSLA)\\b/.test(document.getElementById('scr-results').innerText)`);
      check('AC-9', `${tag}: no kept holding appears on Results`, !kept);
    }
    // More views for the visual check.
    for (const [viewport, theme, period, desk, name, what] of [[VIEWPORTS[0], 'light', 'day', 'all', 'day', 'Day: today, all desks (intraday points from History)'],
      [VIEWPORTS[0], 'light', 'month', 'joe', 'month-joe', 'Month: October, Joe'], [VIEWPORTS[0], 'dark', 'all', 'all', 'all', 'All time: the tracking marker'],
      [VIEWPORTS[1], 'dark', 'ytd', 'joel', 'ytd-joel', 'This year, Joel'], [VIEWPORTS[2], 'light', 'month', 'all', 'month', 'Month on a phone']]) {
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
      await click(page, `#periodSeg [data-period="${period}"]`);
      await click(page, `#deskSeg [data-desk="${desk}"]`);
      await shot(page, viewport, `${viewport.name}-${theme}-results-${name}`, `Results, ${what}`);
    }
    // AC-11 in the wide font that stands in for Linux's.
    for (const [viewport, theme] of [[VIEWPORTS[2], 'light'], [VIEWPORTS[1], 'dark'], [VIEWPORTS[0], 'light']]) {
      const tag = `${viewport.name} ${theme} wide font`;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
      await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(WIDE_FONT)})`);
      await settle(page);
      await auditScreen(page, viewport, theme, 'results (wide font)');
      const base = await rects(page, SHIFT), baseSay = await rects(page, SAY);
      let moved = [];
      for (const period of PERIODS) for (const desk of DESK_CHOICES) {
        await click(page, `#periodSeg [data-period="${period}"]`);
        await click(page, `#deskSeg [data-desk="${desk}"]`);
        moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height']), shifted(baseSay, await rects(page, SAY), ['top', 'left']));
        if (period === 'month' && desk === 'all') { for (let i = 0; i < 2; i++) await click(page, '#prevPer'); for (let i = 0; i < 2; i++) await click(page, '#nextPer'); moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height'])); }
      }
      for (let i = 0; i < 2; i++) { await click(page, '#prevMonth'); moved = moved.concat(shifted(base, await rects(page, SHIFT), ['top', 'left', 'height'])); }
      const clip = await page.evaluate('__audit.clipping()');
      check('AC-36', `${tag}: the month titles and every label fit without clipping`, !clip.length, clip.slice(0, 4));
      for (let i = 0; i < 2; i++) await click(page, '#nextMonth');
      check('AC-11', `${tag}: period, desk, stepping and months move nothing (±0.5 px)`, !moved.length, moved.slice(0, 6));
      if (viewport.name === '1024') await shot(page, viewport, `${viewport.name}-${theme}-results-wide-font`, 'Results in the wide font (stands in for Linux fonts)');
    }
    await serve(null);
  }

  if (run('fixtures')) {
    // 2 · The results v2 fixtures: scratches, no losers, a drawdown, the empty record.
    const { board, inputs } = await designBoard();
    const viewports = [[VIEWPORTS[0], 'light'], [VIEWPORTS[1], 'dark'], [VIEWPORTS[2], 'light'], [VIEWPORTS[2], 'dark']];
    const cases = [
      ['scratches', 'day', '2026-10-13', r => {
        const t = k => r.tiles.find(x => x.k === k);
        return N(t('trades').val) === '8' && t('trades').mean === '3 won · 2 lost · 3 flat' && N(t('won').val) === '60%' && t('won').mean === '3 of 5 · small sample' &&
          N(t('avgtrade').val) === N(money(0.25)) && N(t('pf').val) === '2,99' && N(t('typical').val) === N(two(1, -0.5)) && N(r.split[0]) === N(money(2));
      }, 'Scratches on Tue 13 Oct: ±€ 0,005 decides, smaller results are flat'],
      ['no-losers', 'week', '2026-10-07', r => {
        const t = k => r.tiles.find(x => x.k === k);
        return N(t('pf').val) === '—' && t('pf').mean === 'Needs a losing trade' && N(t('won').val) === '100%' && N(t('typical').val) === N(`${money(0.75)}/—`) && t('besttrade').mean.endsWith('· no losing trade');
      }, 'No losing trade in the week of 5 Oct: no gains-against-losses figure'],
      ['drawdown', 'month', '2026-09-10', r => {
        const t = k => r.tiles.find(x => x.k === k);
        return N(t('dip').val) === N(money(-40)) && N(t('dip').mean) === N('0,27 % below the high point') && N(r.display) === N(money(40));
      }, 'A dip in September: 15.030 down to 14.990'],
      ['empty', 'week', '2026-10-07', r => r.display === '—' && /^No trades last week\. Paper results start on 10.Sep 2026\.$/.test(r.say) && r.tiles.every(x => x.val.trim() === '—') &&
        r.tiles.find(x => x.k === 'trades').mean === 'No finished trades' && r.rows.every(x => x.val.trim() === '—' && x.facts === 'No trades') && r.curve?.aria === 'No change in this period' && r.curve.empty &&
        r.cal.cells.filter(c => c.day >= '2026-10-05' && c.day <= '2026-10-09').every(c => c.n === 'no trades'), 'The empty record: last week reads as the designed empty state'],
    ];
    for (const [name, period, anchor, ok, what] of cases) {
      const payload = fixture(name);
      await serve(served(payload, board));
      for (const [viewport, theme] of viewports) {
        const tag = `${name} @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        await load(page, board.url, 'results');
        await click(page, `#periodSeg [data-period="${period}"]`);
        // Step to the anchor's period.
        for (let i = 0; i < 12 && !(await page.evaluate(`document.querySelector('#cal [data-day="${anchor}"]')?.classList.contains('${period === 'month' ? 'cell' : 'inper'}')`)); i++) await click(page, '#prevPer');
        if (period === 'day') await click(page, `#cal [data-day="${anchor}"]`);
        if (period === 'month') for (let i = 0; i < 2 && (await page.evaluate(RES)).cal.title !== `${M.MONTH[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`; i++) await click(page, '#prevPer');
        const r = await page.evaluate(RES);
        const ix = M.indexResults(payload);
        const e = expected(ix, inputs, period, anchor, 'all');
        compare(tag, r, e);
        check(name === 'empty' ? 'AC-16' : 'AC-12', `${tag}: ${what}`, ok(r), { display: r.display, say: r.say, split: r.split, tiles: r.tiles.map(x => [x.k, x.val, x.mean]) });
        if (viewport.mobile && theme === 'dark') await page.evaluate('document.activeElement?.blur()');
        await auditScreen(page, viewport, theme, `results (${name})`);
        if (theme === 'light') await shot(page, viewport, `${viewport.name}-${theme}-results-${name}`, `Results, ${what}`);
      }
    }
    // AC-16: before tracking starts (August) the design record is empty too.
    await serve(served(designResults(NOW), board));
    await configure(page, VIEWPORTS[0], 'light');
    await load(page, board.url, 'results');
    await click(page, '#periodSeg [data-period="month"]');
    await click(page, '#prevPer'); await click(page, '#prevPer');
    const aug = await page.evaluate(RES);
    check('AC-16', '1440 light: August, before paper results start, is the designed empty state; days before tracking show only their date',
      aug.display === '—' && /^No trades in August\. Paper results start on 10.Sep 2026\.$/.test(aug.say) && aug.cal.cells.filter(c => !M.isWeekend(c.day)).every(c => c.cls.includes('pre') && !c.n), { say: aug.say, cells: aug.cal.cells.slice(0, 3) });
    await serve(null);
  }

  if (run('states')) {
    // 3 · No push yet (the server's own answer), unavailable, stale, retained, KEEP mismatch.
    const { board } = await designBoard();
    const record = designResults(NOW);
    const shiftOf = async () => rects(page, SHIFT);
    for (const [viewport, theme] of VIEWPORTS.flatMap(v => THEMES.map(t => [v, t]))) {
      const tag = `${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      await serve(null);
      const firstPaint = await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `
        new MutationObserver(function (_, observer) {
          const say = document.querySelector('#rheroL .say');
          if (say?.textContent) { window.__resultsFirstSay = say.textContent; observer.disconnect(); }
        }).observe(document, { childList: true, subtree: true });` });
      await load(page, board.url, 'results');
      await page.s('Page.removeScriptToEvaluateOnNewDocument', firstPaint);
      const nw = await page.evaluate(RES);
      check('results-first-paint', `${tag}: first paint already says no data received yet`,
        (await page.evaluate('window.__resultsFirstSay')) === 'Results are unavailable: no data received yet.');
      check('AC-16', `${tag}: before the first push Results uses its existing unavailable state: reason, dashes, no zeros, dates kept`,
        nw.say === 'Results are unavailable: no data received yet.' && nw.display === '—' && nw.split.every(x => x === '—') && nw.tiles.every(x => x.val.trim() === '—') &&
        nw.rows.every(x => x.val.trim() === '—') && nw.cal.cells.length >= 28 && !/€\s?0,00/.test(`${nw.say}${nw.split.join('')}`) && nw.curve?.aria === 'Results are unavailable' && nw.curve.empty, nw);
      const before = await shiftOf();
      await click(page, '#periodSeg [data-period="month"]'); await click(page, '#deskSeg [data-desk="joel"]'); await click(page, '#prevPer');
      check('AC-16', `${tag}: before the first push, period and desk switches still work and move nothing`, (await page.evaluate(RES)).label.startsWith('Last month') && !shifted(before, await shiftOf(), ['top', 'left', 'height']).length, shifted(before, await shiftOf()).slice(0, 3));
      if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-not-received`, 'Results before the first accepted push: the existing unavailable state');
      await reset();
      if (theme === 'dark') continue;
      // Fresh, then stale: the record's own age, in the chart's box; nothing moves.
      await serve(served(record, board));
      await load(page, board.url, 'results');
      const fresh = await page.evaluate(RES), freshRects = await shiftOf();
      await serve(served(record, board, 300));
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.getElementById('resStatus').innerText.length > 0`);
      await settle(page);
      const stale = await page.evaluate(RES);
      check('panel-state', `${tag}: a record received 5 min ago says Stale with age in the chart's box and keeps its numbers`, /^Stale · Results as of 5.min ago · updates are late\.$/.test(stale.status) && stale.display === fresh.display &&
        !shifted(freshRects, await shiftOf(), ['top', 'left', 'height']).length, { status: stale.status, display: [fresh.display, stale.display] });
      if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-results-stale`, 'Results, the record received 5 min ago: its age and reason in the chart box');
      await serve(() => ({ fail: 'ConnectionRefused' }));
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `/refresh failed/.test(document.getElementById('resStatus').innerText)`);
      await settle(page);
      const kept = await page.evaluate(RES);
      check('panel-state', `${tag}: a failed refresh keeps the last good record and says so`, /^Stale · Results refresh failed: update failed\. Showing the last good results from \d+.(s|min) ago\.$/.test(kept.status) && kept.display === fresh.display, kept.status);
      if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-results-refresh-failed`, 'Results, refresh failed: the last good record kept, with its age');
      // Unavailable from the first read: its own reason.
      await serve(() => ({ status: 401, body: { ok: false, reason: 'auth_required' } }));
      await load(page, board.url, 'results');
      const auth = await page.evaluate(RES);
      check('panel-state', `${tag}: a sign-in that expired before the first record says why, with dashes`, auth.say === 'Results are unavailable: sign-in expired — reload.' && auth.display === '—' && auth.tiles.every(x => x.val.trim() === '—'), auth.say);
      // An invalid record is never shown: the contract rejects it.
      const broken = structuredClone(record); broken.trades[0].netEur.amount = '999';
      await serve(served(broken, board));
      await load(page, board.url, 'results');
      const invalid = await page.evaluate(RES);
      check('panel-state', `${tag}: a record that breaks the contract (net ≠ gross − fees) is rejected, never shown`, invalid.say === 'Results are unavailable: last update was rejected.' && invalid.display === '—', invalid.say);
    }
    // KEEP: a record that trades a symbol the accepted kept list protects is held back.
    const config = structuredClone(valid['fleet-config']);
    config.desks.keep = [...config.desks.keep, record.trades[0].symbol];
    const { board: keepBoard } = await designBoard(NOW, config);
    await serve(served(record, keepBoard));
    for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [VIEWPORTS[2], 'dark']]) {
      await configure(page, viewport, theme);
      await load(page, keepBoard.url, 'results');
      const r = await page.evaluate(RES);
      check('AC-9', `${viewport.name} ${theme}: a record that still trades a kept symbol (${record.trades[0].symbol}) is held back, no number derived`,
        r.say === 'Results are unavailable: held back: the kept-holdings list disagrees.' && r.display === '—' && r.rows.every(x => x.val.trim() === '—'), r.say);
      if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-results-kept-mismatch`, 'Results held back: the record trades a symbol on the kept list');
    }
    await serve(null);
  }

  if (run('vienna')) {
    // 4 · Vienna dates in the browser: the five-hour week, NY's repeated hour,
    // extended hours, Vienna midnight and the spring twin, at a later today.
    const later = '2027-04-01T12:00:00.000Z';
    const { board } = await designBoard(later);
    const payload = fixture('dst-weeks');
    const ix = M.indexResults(payload);
    await serve(served(payload, board));
    for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [VIEWPORTS[2], 'dark']]) {
      const tag = `${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      await click(page, '#periodSeg [data-period="month"]');
      const months = {};
      for (let i = 0; i < 7; i++) { const r = await page.evaluate(RES); months[r.cal.title] = r.cal.cells; await click(page, '#prevMonth'); }
      const cell = (m, day) => months[m]?.find(c => c.day === day);
      const has = (m, day, n) => N(cell(m, day)?.aria).includes(N(`from ${n} trade`));
      check('vienna', `${tag}: each trade is on its Vienna date (15, 27, 28 Oct; five on 25 Oct across fallback; two on 1 Nov; 16 and 31 Mar)`,
        has('October 2026', '2026-10-15', 1) && !has('October 2026', '2026-10-14', 1) && has('October 2026', '2026-10-25', 5) && has('October 2026', '2026-10-27', 1) && has('October 2026', '2026-10-28', 1) &&
        has('November 2026', '2026-11-01', 2) && has('March 2027', '2027-03-16', 1) && has('March 2027', '2027-03-31', 1),
        Object.fromEntries(Object.entries(months).map(([k, v]) => [k, v.filter(c => /trade/.test(c.aria)).map(c => [c.day, c.aria])])));
      for (const title of Object.keys(months)) {
        const faults = calendarFacts({ cal: { cells: months[title], slots: 42, weeks: 6 } }, ix, DESKS, '2027-04-01', ix.meta.trackingStart);
        check('AC-14', `${tag} ${title}: every day's state follows the record`, !faults.length, faults.slice(0, 4));
      }
      await click(page, '#nextMonth'); // September → October
      await click(page, '#cal [data-day="2026-10-25"]');
      const fallbackDay = await page.evaluate(viewport.mobile
        ? `({ rows: document.querySelectorAll('#sheetBody .trow').length, text: document.getElementById('sheetBody').innerText })`
        : `(${RES}).day`);
      check('vienna', `${tag}: 25 Oct keeps both 02:30s and the fallback boundary in instant order on the same Vienna day`,
        fallbackDay.rows === 5 && /closed 00:30[\s\S]*closed 02:30[\s\S]*closed 02:59[\s\S]*closed 02:00[\s\S]*closed 02:30/.test(fallbackDay.text), fallbackDay);
      if (viewport.mobile) await key(page, 'Escape');
      await load(page, board.url, 'results');
      await click(page, '#periodSeg [data-period="week"]');
      for (let i = 0; i < 30 && N((await page.evaluate(RES)).label) !== N('26 Oct – 1 Nov 2026'); i++) await click(page, '#prevPer');
      const week = await page.evaluate(RES);
      check('vienna', `${tag}: the week of 26 Oct – 1 Nov counts its 4 trades by Vienna date`, N(week.label) === N('26 Oct – 1 Nov 2026') && N(week.tiles.find(x => x.k === 'trades').val) === '4', { label: week.label, trades: week.tiles.find(x => x.k === 'trades').val });
      if (!viewport.mobile) {
        await click(page, '#nextMonth');
        await click(page, '#cal [data-day="2026-11-01"]');
        const r = await page.evaluate(RES);
        check('vienna', `${tag}: 1 Nov lists both 01:30s of New York's repeated hour, oldest first`, r.day.rows === 2 && /closed 06:30[\s\S]*closed 07:30/.test(r.day.text), r.day.text);
        await shot(page, viewport, `${viewport.name}-${theme}-results-vienna-week`, 'Results, the five-hour week (26 Oct – 1 Nov 2026): trades on their Vienna dates; 1 Nov lists both 01:30s');
      }
    }
    await serve(null);
  }

  if (run('cards')) {
    // 5 · Tick's P3 follow-up: at 390 the desk card keeps "Checked in … ago"
    // right-aligned on the name row, with an invisible 44 px hit area.
    const { board } = await designBoard();
    for (const [theme, font] of [['light', null], ['dark', null], ['light', WIDE_FONT]]) {
      const viewport = VIEWPORTS[2], tag = `390 ${theme}${font ? ' wide font' : ''}`;
      await configure(page, viewport, theme);
      await load(page, board.url, 'desk');
      if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
      const cards = await page.evaluate(`[...document.querySelectorAll('.dcard header')].map(h => {
        const b = el => el.getBoundingClientRect(), name = b(h.querySelector('h3')), hb = b(h.querySelector('.hb')), head = b(h), state = b(h.querySelector('.state'));
        const term = h.querySelector('.hb .term'), r = b(term), a = getComputedStyle(term, '::after');
        const lines = Math.round(hb.height / parseFloat(getComputedStyle(h.querySelector('.hb')).lineHeight));
        return { id: h.closest('.dcard').id, sameRow: Math.abs((hb.top + hb.bottom) / 2 - (name.top + name.bottom) / 2) < 4 && hb.bottom <= state.top + 1, right: Math.abs(hb.right - head.right) < 1, lines,
          hit: [r.width - parseFloat(a.left) - parseFloat(a.right), r.height - parseFloat(a.top) - parseFloat(a.bottom)], visibleHit: a.backgroundColor === 'rgba(0, 0, 0, 0)' && a.borderStyle === 'none' };
      })`);
      check('P3-follow-up', `${tag}: every desk card keeps "Checked in … ago" right-aligned on its name row, one line, with an invisible 44 px hit area`,
        cards.length === 3 && cards.every(c => c.sameRow && c.right && c.lines === 1 && c.hit[0] >= 43.5 && c.hit[1] >= 43.5 && c.visibleHit), cards);
      const targets = await page.evaluate('__audit.targets()');
      check('AC-30', `${tag}: 44 px targets on Desk`, !targets.length, targets.slice(0, 4));
      const sweep = await page.evaluate(`__audit.sweep(960, { labels: [], brokers: [], cards: [['Sitting out since 16:02', '23 h 59 min ago'], ['Working', '9 s ago']] })`);
      check('P3-follow-up', `${tag}: the longest state and heartbeat keep each card header in one box, nothing overlaps`, !sweep.cards.length && !sweep.overlaps.length && sweep.scroll <= sweep.inner, { cards: sweep.cards, overlaps: sweep.overlaps.slice(0, 3) });
      if (!font) {
        const r = await page.evaluate(`(() => { const b = document.querySelector('.desk-grid').getBoundingClientRect(); return { y: b.top + scrollY - 8, h: b.height + 16 }; })()`);
        const { data } = await page.s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: r.y, width: 390, height: r.h, scale: 1 }, captureBeyondViewport: true });
        writeFileSync(join(QA_DIR, `390-${theme}-desk-cards.png`), Buffer.from(data, 'base64'));
        shots.push({ file: `390-${theme}-desk-cards.png`, what: 'Desk cards at 390: "Checked in … ago" right-aligned on the name row' });
      }
    }
  }

  if (run('r1')) {
    // 6 · Fix round 1 (Codex review r1) in the page, at 1440 light and 390 dark.
    const pair = [[VIEWPORTS[0], 'light'], [VIEWPORTS[2], 'dark']];
    const open = async (board, period, desk) => {
      await click(page, `#periodSeg [data-period="${period}"]`);
      await click(page, `#deskSeg [data-desk="${desk}"]`);
      return page.evaluate(RES);
    };
    const tileOf = (r, k) => r.tiles.find(x => x.k === k);
    // (a) High: J changes its bookkeeping basis at 13:00 UTC today. Across
    // the change there is no result, dip or line; the change is said as such.
    {
      const CHANGE = Date.parse('2026-10-14T13:00:00.000Z');
      const { board, inputs } = await designBoard(NOW, null, ({ history }) => { for (const p of history.points) if (Date.parse(p.t) < CHANGE) p.desks.j.historyBasis = 'j.paper.v1'; });
      const record = designResults(NOW), ix = M.indexResults(record);
      check('r1-basis', 'the page\'s inputs carry J\'s change of basis', inputs.cuts.length === 1 && inputs.cuts[0].desk === 'j' && inputs.cuts[0].at >= CHANGE && inputs.cuts[0].at < CHANGE + 300000, inputs.cuts);
      await serve(served(record, board));
      for (const [viewport, theme] of pair) {
        const tag = `basis @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        await load(page, board.url, 'results');
        await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
        for (const period of PERIODS) for (const desk of DESK_CHOICES) {
          const r = await open(board, period, desk), e = expected(ix, inputs, period, inputs.today, desk);
          compare(`${tag} ${period} ${desk}`, r, e);
          const crosses = desk === 'all' || desk === 'j';
          const said = `No result ${e.per.phrase}: J’s bookkeeping basis changed on Wed 14${NB}Oct, and a change of basis is not a gain or a loss.`;
          check('r1-basis', `${tag} ${period} ${desk}: ${crosses ? 'no result, dip or line across J’s change; the change is said as such' : 'its own numbers stand'}`, crosses
            ? Boolean(e.R.cut) && r.display === '—' && N(r.say) === N(said) && r.split[1] === '—' && N(tileOf(r, 'dip').val) === '—' && tileOf(r, 'dip').mean === 'Bookkeeping basis changed' &&
              r.curve?.empty && N(r.curve.aria) === N(`J’s bookkeeping basis changed on Wed 14${NB}Oct`) && r.rows[0].val.trim() === '—' && r.rows[3].val.trim() === '—' && r.rows[1].val.trim() !== '—'
            : !e.R.cut && r.display !== '—' && !r.curve?.empty,
          { display: r.display, say: r.say, dip: tileOf(r, 'dip'), curve: r.curve?.aria, rows: r.rows.map(x => x.val) });
        }
        await auditScreen(page, viewport, theme, 'results (basis change)');
        await click(page, '#periodSeg [data-period="week"]'); await click(page, '#deskSeg [data-desk="all"]');
        await shot(page, viewport, `${viewport.name}-${theme}-results-basis-change`, 'Results across J’s change of bookkeeping basis: no result, dip or line; the change said as such; Joe and Joel stand');
      }
      await serve(null);
    }
    // (b) Medium: no current money for J. The record even has a close for
    // today; it never stands in for the money now.
    {
      const { board, inputs, snapshot } = await designBoard(NOW, null, ({ snapshot }) => {
        snapshot.desks[0].money.equity = null; snapshot.desks[0].money.reasons = { equity: 'retained_values' };
        snapshot.totals.equity = null; snapshot.totals.reasons = { equity: 'family_projection_unavailable' };
      });
      const record = designResults(NOW);
      const close = d => ({ equityClose: { amount: d === 'j' ? '4990' : snapshot.desks.find(x => x.id === d).money.equity.amount, currency: 'EUR' }, realisedNet: { amount: '0', currency: 'EUR' }, fees: { amount: '0', currency: 'EUR' }, trades: 0 });
      record.days.push({ date: inputs.today, desks: Object.fromEntries(DESKS.map(d => [d, close(d)])) });
      withTradeSummaries(record);
      const ix = M.indexResults(record);
      check('r1-money-now', 'J has no money now; the record has a close for today', inputs.todayUnits[0] === null && ix.dates.at(-1) === inputs.today, inputs.todayUnits);
      await serve(served(record, board));
      for (const [viewport, theme] of pair) {
        const tag = `no money now @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        await load(page, board.url, 'results');
        await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
        for (const period of PERIODS) for (const desk of DESK_CHOICES) {
          const r = await open(board, period, desk), e = expected(ix, inputs, period, inputs.today, desk);
          compare(`${tag} ${period} ${desk}`, r, e);
          const blind = desk === 'all' || desk === 'j';
          check('r1-money-now', `${tag} ${period} ${desk}: ${blind ? 'Net, Still open and the dip stay unknown; today’s close never stands in' : 'its own numbers stand'}`, blind
            ? e.R.net === null && r.display === '—' && N(r.say) === N(`The result ${e.per.phrase} is not known yet: the desks’ money now is not available.`) && r.split[1] === '—' && N(tileOf(r, 'dip').val) === '—'
            : e.R.net !== null && r.display !== '—', { display: r.display, say: r.say, split: r.split });
        }
        await auditScreen(page, viewport, theme, 'results (no money now)');
      }
      await serve(null);
    }
    // (c) Medium: the hero chart's x axis is real time. Every drawn point
    // sits at its own time; 16 Sep → 13 Oct is 27 days wide and, with its
    // sessions missing from the record, a break in the line.
    {
      const { board, inputs } = await designBoard();
      const payload = fixture('drawdown'), ix = M.indexResults(payload);
      await serve(served(payload, board));
      for (const [viewport, theme] of pair) {
        const tag = `time axis @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        await load(page, board.url, 'results');
        for (const [period, desk] of [['all', 'j'], ['ytd', 'all'], ['week', 'joel'], ['month', 'j']]) {
          const r = await open(board, period, desk), e = expected(ix, inputs, period, inputs.today, desk);
          const c = M.curve(ix, e.per, desk === 'all' ? DESKS : [desk], M.moneyContext(ix, inputs, e.per, desk === 'all' ? DESKS : [desk]));
          const [d0, d1] = c.domain, pw = r.curve.width - 64 - 14;
          const segs = [[]];
          for (const p of c.pts) { if (p.v === null) segs.push([]); else segs[segs.length - 1].push(p); }
          const want = segs.filter(g => g.length > 1).map(g => g.map(p => 64 + (p.x - d0) / (d1 - d0) * pw));
          const got = r.curve.paths.map(d => [...d.matchAll(/[ML](-?[\d.]+) /g)].map(m => Number(m[1])));
          const ok = got.length === want.length && got.every((xs, i) => xs.length === want[i].length && xs.every((x, j) => Math.abs(x - want[i][j]) <= 0.11));
          check('r1-time-axis', `${tag} ${period} ${desk}: each point at its own time on the period's real time axis${want.length > 1 ? ', the missing sessions a break' : ''}`, ok, { got, want });
        }
        await click(page, '#periodSeg [data-period="all"]'); await click(page, '#deskSeg [data-desk="j"]');
        await shot(page, viewport, `${viewport.name}-${theme}-results-time-axis`, 'Results, all time for J on the drawdown fixture: real time axis; 16 Sep → 13 Oct keeps its 27 days and breaks the line');
      }
      await serve(null);
    }
    // (d) Medium: large amounts are exact on the page (≥ € 100.000, full
    // precision), and (e) two equal days are two days, never "only day".
    {
      const { board, inputs } = await designBoard();
      const eurOf = amount => ({ amount, currency: 'EUR' });
      const trade = (id, desk, closedAt, net, fees) => ({ id, desk, symbol: 'KO', company: 'Coca-Cola', side: 'long', quantity: '1', openedAt: at(closedAt, -600), closedAt,
        entryPrice: { amount: '70.12', currency: 'USD' }, exitPrice: { amount: '70.48', currency: 'USD' }, grossEur: eurOf(unitsDecimal(decimalUnits(net) + decimalUnits(fees))), feesEur: eurOf(fees), netEur: eurOf(net),
        fx: { base: 'USD', quote: 'EUR', rate: '0.9', source: 'test-close-rate', observedAt: closedAt }, method: 'execution-fifo-net-current-fx' });
      const record = { ...fixture('empty'), trades: [trade('rt-big-1', 'j', '2026-10-12T15:00:00.000Z', '100000.12345678', '0.35'), trade('rt-big-2', 'joe', '2026-10-13T15:00:00.000Z', '-99999.98765432', '0.35'),
        trade('rt-eq-1', 'joel', '2026-10-12T16:00:00.000Z', '1', '0.35'), trade('rt-eq-2', 'joel', '2026-10-13T16:00:00.000Z', '1', '0.35')] };
      const ix = M.indexResults(record);
      await serve(served(record, board));
      for (const [viewport, theme] of pair) {
        const tag = `large amounts @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        await load(page, board.url, 'results');
        await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
        const j = await open(board, 'week', 'j');
        compare(`${tag} week j`, j, expected(ix, inputs, 'week', inputs.today, 'j'));
        check('r1-exact', `${tag}: J's € 100.000,12345678 trade reads +€ 100.000,12 everywhere, rounded once`, N(j.split[0]) === N('+€ 100.000,12') && N(tileOf(j, 'besttrade').val) === N('+€ 100.000,12/—') &&
          N(tileOf(j, 'bestday').val) === N('+€ 100.000,12') && N(tileOf(j, 'avgtrade').val) === N('+€ 100.000,12'), { split: j.split, tiles: j.tiles.map(x => [x.k, x.val]) });
        const all = await open(board, 'week', 'all');
        compare(`${tag} week all`, all, expected(ix, inputs, 'week', inputs.today, 'all'));
        check('r1-exact', `${tag}: the week's closed trades are their exact sum (100.000,12345678 − 99.999,98765432 + 2), rounded once`, N(all.split[0]) === N('+€ 2,14') && N(tileOf(all, 'besttrade').val) === N('+€ 100.000,12/−€ 99.999,99'), { split: all.split });
        const cal = Object.fromEntries(all.cal.cells.map(c => [c.day, c]));
        check('r1-exact', `${tag}: the calendar shows the days in their cells' room (${viewport.mobile ? 'phones: 0,1M' : '100k'}), the label says them exactly`,
          N(cal['2026-10-12'].v) === '+100k' && N(cal['2026-10-13'].v) === '−100k' && N(cal['2026-10-12'].aria).includes(N('+€ 100.001,12 from 2 trades')) && N(cal['2026-10-13'].aria).includes(N('−€ 99.998,99 from 2 trades')) &&
          (await page.evaluate(`[...document.querySelectorAll('#cal [data-day="2026-10-12"] .vs, #cal [data-day="2026-10-13"] .vs')].map(e => e.textContent).join('|')`)) === '+0,1M|−0,1M', { d12: cal['2026-10-12'], d13: cal['2026-10-13'] });
        const joel = await open(board, 'week', 'joel');
        check('r1-days', `${tag}: two equal days are two days, never "only day"`, N(tileOf(joel, 'bestday').val) === N('+€ 1,00/+€ 1,00') && tileOf(joel, 'bestday').mean === `Mon 12${NB}Oct · Tue 13${NB}Oct`, tileOf(joel, 'bestday'));
        await click(page, '#deskSeg [data-desk="all"]');
        await auditScreen(page, viewport, theme, 'results (large amounts)');
        await shot(page, viewport, `${viewport.name}-${theme}-results-large-amounts`, 'Results with a € 100.000,12345678 trade: exact, rounded once, nothing clipped');
      }
      await serve(null);
    }
  }

  if (run('phone-calendar')) {
    // JOED-29: this record belongs only to the focused scenario. The shared
    // design fixture and VIEWPORTS keep their existing data and expectations.
    const { board } = await designBoard();
    const august = ['03', '04', '05', '06', '07', '10', '11', '12', '13', '14', '17', '18', '19', '20', '21', '24', '25', '26', '27'];
    const september = ['01', '02', '03', '04', '08', '09', '10', '11', '14', '15', '16', '17', '18', '21', '22', '23', '24', '25', '28', '29'];
    const forms = [
      // Exact gain, current phone text, optional test-only stress form.
      ['1', '1'], ['4.1', '4,1'], ['12.58', '13'], ['123', '123'], ['999', '999'],
      ['1000', '1k'], ['1234', '1,2k'], ['12000', '12k'],
      ['1200000', '1,2M'], ['9900000', '9,9M'], ['100000', '0,1M'],
      ['100000000', '0,1B'], ['1200000000', '1,2B'], ['1200000000000', '1,2T'],
      ['1000000', '1M'], ['1000000000', '1B'], ['1000000000000', '1T'],
      ['1000000000000000', '1e15'], ['999000', '1M', '999k'],
    ];
    const cases = forms.flatMap(([amount, text, probe], i) => [
      [`2026-08-${august[i]}`, `-${amount}`, `−${text}`, probe && `−${probe}`],
      [`2026-09-${september[i]}`, amount, `+${text}`, probe && `+${probe}`],
    ]).concat([
      // October's crop includes both signs, zero, k and the widest forms.
      ['2026-10-01', '1', '+1'], ['2026-10-02', '-1', '−1'],
      ['2026-10-05', '1234', '+1,2k'], ['2026-10-06', '-1234', '−1,2k'],
      ['2026-10-07', '1200000', '+1,2M'], ['2026-10-08', '-1200000', '−1,2M'],
      ['2026-10-09', '-0.03', '0'], ['2026-10-12', '0', '0'],
      ['2026-10-13', '100000', '+0,1M'], ['2026-10-14', '-100000', '−0,1M'],
    ]);
    const missingDay = '2026-10-13';
    const eurOf = amount => ({ amount, currency: 'EUR' });
    const empty = { ...fixture('empty'), trackingStart: '2026-08-01', generatedAt: at(NOW, -20) };
    const record = withTradeSummaries({ ...empty, seq: empty.seq + 1,
      // A closed past day retains its trade but has no daily entry (JOED-28).
      days: cases.filter(([date]) => date !== missingDay).map(([date]) => ({ date, desks: Object.fromEntries(DESKS.map(id => [id, {
        equityClose: eurOf('5000'), realisedNet: eurOf('0'), fees: eurOf('0'), trades: 0,
      }])) })),
      trades: cases.map(([date, net], i) => {
        const closedAt = `${date}T15:00:00.000Z`;
        // Only a loss needs the higher entry to keep its exit price positive.
        const entry = decimalUnits('2000') + (net.startsWith('-') ? -decimalUnits(net) : 0n);
        return { id: `rt-phone-${i}`, desk: 'j', symbol: 'KO', company: 'Coca-Cola', side: 'long', quantity: '1',
          openedAt: at(closedAt, -600), closedAt,
          entryPrice: { amount: unitsDecimal(entry), currency: 'USD' },
          exitPrice: { amount: unitsDecimal(entry + decimalUnits(net)), currency: 'USD' },
          grossEur: eurOf(net), feesEur: eurOf('0'), netEur: eurOf(net),
          fx: { base: 'USD', quote: 'EUR', rate: '1', source: 'test-close-rate', observedAt: closedAt }, method: 'execution-fifo-net-current-fx' };
      }),
    });
    record.missingDays = missingResultsDays(record, at(board.clock(), -18));
    const checked = validateContract('results', record);
    check('phone-calendar', 'the focused phone record is a valid results v2 contract', checked.ok, checked.errors);
    // Change compact text without changing the maximum day's tint legend or
    // surrounding content, so geometry measures the amount update itself.
    const baseline = structuredClone(record); baseline.seq--;
    for (const [day, net] of [['2026-10-01', '4.1'], ['2026-10-02', '-4.1'], ['2026-10-09', '-0.05']]) {
      const trade = baseline.trades.find(t => t.closedAt.startsWith(day));
      trade.netEur = trade.grossEur = eurOf(net);
      trade.exitPrice.amount = unitsDecimal(decimalUnits(trade.entryPrice.amount) + decimalUnits(net));
    }
    withTradeSummaries(baseline);
    const viewports = [VIEWPORTS.find(v => v.name === '390'), { name: '360', width: 360, height: 780, mobile: true }];
    const geometry = async () => [...await rects(page, ['.calcard', '.cal-head', '#cal', '#calTitle', '#prevMonth', '#nextMonth', '.cal-legend', 'footer.foot']), ...await page.evaluate(SLOTS)];
    const crop = async (name, what) => {
      const clip = await page.evaluate(`(() => { const r = document.querySelector('.calcard').getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }; })()`);
      const { data } = await page.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      writeFileSync(join(QA_DIR, `${name}.png`), Buffer.from(data, 'base64'));
      shots.push({ file: `${name}.png`, what });
    };
    const inspectMonth = async (viewport, theme, month) => {
      const tag = `${viewport.name} ${theme} ${month}`;
      const cells = await page.evaluate(`(() => {
        return [...document.querySelectorAll('#cal [data-day]')].map(el => {
          const v = el.querySelector('.v'), pl = el.querySelector('.vs .pl');
          return { day: el.dataset.day, text: el.querySelector('.vs')?.textContent ?? '',
            cls: el.className, glyphs: el.querySelectorAll('.vs svg, .vs use').length,
            aria: el.getAttribute('aria-label'), title: el.hasAttribute('title') || Boolean(el.querySelector('[title]:not(.day-warning)')),
            warning: Boolean(el.querySelector('.day-warning')),
            visible: __audit.visible(el.querySelector('.vs')), scroll: v.scrollWidth, client: v.clientWidth,
            font: pl ? Number.parseFloat(getComputedStyle(pl).fontSize) : null };
        });
      })()`);
      for (const [day, amount, text, stress] of cases.filter(([day]) => day.startsWith(month))) {
        const cell = cells.find(c => c.day === day);
        check('phone-calendar', `${tag} ${day}: ${amount} reads ${text}, without a phone glyph or title, with its exact accessible amount`,
          cell?.text === text && cell.visible && cell.glyphs === 0 && !cell.title &&
          N(cell.aria).includes(N(fmt.eur(decimalUnits(amount), true))), cell ?? { day, text: null, scroll: null, client: null });
        if (!cell) continue;
        // Assert the actual formatter output; 999k is measured as INFO only.
        for (const [form, info] of [[text, false], ...(stress ? [[stress, true]] : [])]) {
          const measurement = await page.evaluate(`(() => {
            const cell = document.querySelector('#cal [data-day="${day}"]'), v = cell.querySelector('.v'), pl = cell.querySelector('.vs .pl');
            const probe = pl.cloneNode(false); probe.textContent = ${JSON.stringify(form)};
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:max-content';
            pl.parentElement.append(probe);
            probe.style.fontSize = '11.5px'; const px115 = probe.getBoundingClientRect().width;
            probe.style.fontSize = '10px'; const px10 = probe.getBoundingClientRect().width;
            probe.remove();
            const saved = pl.textContent, savedClass = pl.className;
            if (${info}) { pl.textContent = ${JSON.stringify(form)}; pl.className = 'pl sc'; }
            const result = { day: cell.dataset.day, text: pl.textContent, px115, px10,
              width: v.getBoundingClientRect().width, ink: pl.getBoundingClientRect().width,
              scroll: v.scrollWidth, client: v.clientWidth, font: Number.parseFloat(getComputedStyle(pl).fontSize) };
            pl.textContent = saved; pl.className = savedClass;
            return result;
          })()`);
          phoneMeasurements.push({ viewport: viewport.name, theme, info, ...measurement });
          if (info) console.log(`INFO phone-calendar probe (not asserted): ${JSON.stringify({ viewport: viewport.name, theme, ...measurement })}`);
          else check('phone-calendar', `${tag} ${day}: ${measurement.text} fits at 10 px and uses the step-down when 11.5 px overflows`,
            measurement.px10 <= measurement.width && measurement.ink <= measurement.width && measurement.font >= 10 &&
            (measurement.px115 <= measurement.width || measurement.font === 10) && measurement.scroll <= measurement.client, measurement);
        }
      }
      check('phone-calendar', `${tag}: only the closed past day without a daily entry has a warning`,
        cells.filter(c => c.warning).map(c => c.day).join() === (month === '2026-10' ? missingDay : ''), cells.filter(c => c.warning));
      const loss = cells.find(c => c.day === '2026-10-09'), flat = cells.find(c => c.day === '2026-10-12');
      if (loss) check('phone-calendar', `${tag}: −0,03 reads 0 with no sign or glyph, in the first loss tint`,
        loss.text === '0' && loss.glyphs === 0 && loss.cls.split(' ').includes('l1'), loss);
      if (flat) check('phone-calendar', `${tag}: an exactly zero day stays flat with no sign or glyph`,
        flat.text === '0' && flat.glyphs === 0 && flat.cls.split(' ').includes('flat'), flat);
      const clipped = await page.evaluate(`[...document.querySelectorAll('#cal .cell .v')].filter(el => el.scrollWidth > el.clientWidth).map(el =>
        ({ day: el.closest('[data-day]')?.dataset.day, text: el.innerText, scroll: el.scrollWidth, client: el.clientWidth }))`);
      check('phone-calendar', `${tag}: every calendar amount fits without clipping`, !clipped.length, clipped);
    };
    for (const viewport of viewports) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme}`;
      await serve(served(baseline, board));
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      await waitFor(page, `document.querySelector('#cal [data-day="2026-10-01"] .vs')?.textContent === '+4,1'`);
      const before = await geometry();
      await serve(served(record, board));
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.querySelector('#cal [data-day="2026-10-09"].l1 .vs')?.textContent === '0'`);
      await settle(page);
      await inspectMonth(viewport, theme, '2026-10');
      const after = await geometry();
      check('phone-calendar', `${tag}: calendar outer geometry and all slots move exactly 0 px when compact amounts change`,
        JSON.stringify(before) === JSON.stringify(after), { before, after });
      for (const month of ['2026-09', '2026-08']) {
        await click(page, '#prevMonth');
        await inspectMonth(viewport, theme, month);
        const previousMonth = await geometry();
        check('phone-calendar', `${tag}: changing to ${month} moves outer geometry and slots exactly 0 px`,
          JSON.stringify(after) === JSON.stringify(previousMonth), { before: after, after: previousMonth });
      }
      await click(page, '#nextMonth');
      await click(page, '#nextMonth');
      const returned = await geometry();
      check('phone-calendar', `${tag}: returning to October moves outer geometry and slots exactly 0 px`,
        JSON.stringify(after) === JSON.stringify(returned), { before: after, after: returned });
      const warning = await page.evaluate(`(() => {
        const cell = document.querySelector('#cal [data-day="${missingDay}"]'), mark = cell.querySelector('.day-warning');
        if (!mark) return null;
        const r = mark.getBoundingClientRect(), c = cell.getBoundingClientRect(), padding = getComputedStyle(cell), offset = getComputedStyle(mark);
        return { visible: __audit.visible(mark) && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom,
          icon: Boolean(mark.querySelector('use[href="#i-half"]')), aria: cell.getAttribute('aria-label'),
          aligned: offset.top === padding.paddingTop && offset.right === padding.paddingRight,
          padding: padding.paddingRight, right: offset.right };
      })()`);
      check('phone-calendar', `${tag}: October crop includes the missing-day warning aligned at 3 px`,
        warning?.visible && warning.icon && warning.aligned && warning.padding === '3px' && warning.right === '3px' && /Stale: daily summary missing/.test(warning.aria), warning);
      await crop(`${viewport.name}-${theme}-results-phone-calendar`, 'October phone calendar: ±1,2M, gain, loss, zero, k and the missing-day warning on 13 October; no phone arrows, 10 px scaled amounts');
      const beforeTap = await geometry();
      await click(page, '#cal [data-day="2026-10-02"]');
      // A day tap changes the period anchor and can move content above the
      // calendar. Measure the sheet close against the settled OPEN state.
      const sheetOpen = await geometry();
      const tap = { viewport: viewport.name, theme, moved: beforeTap.filter(r => ['.calcard#0', '#cal#0'].includes(r.key)).map(r => {
        const next = sheetOpen.find(a => a.key === r.key);
        return { key: r.key, top: next.top - r.top, left: next.left - r.left, width: next.width - r.width, height: next.height - r.height };
      }) };
      tap.shifted = tap.moved.some(r => r.top !== 0 || r.left !== 0 || r.width !== 0 || r.height !== 0);
      phoneTapInfo.push(tap);
      console.log(`INFO phone-calendar tap geometry: ${JSON.stringify(tap)}`);
      const sheet = await page.evaluate(`({ open: document.getElementById('daySheet').open,
        sum: document.querySelector('#sheetBody .dp-sum')?.textContent,
        net: document.querySelector('#sheetBody .trow .net')?.textContent,
        cell: (() => { const c = document.querySelector('#cal [data-day="2026-10-02"]'), v = c.querySelector('.v');
          return { day: c.dataset.day, text: v.innerText, scroll: v.scrollWidth, client: v.clientWidth }; })() })`);
      check('phone-calendar', `${tag}: the −1 day opens a sheet with the exact −€ 1,00`,
        sheet.open && N(sheet.sum) === N('1 trade · −€ 1,00') && N(sheet.net) === N('−€ 1,00'), sheet);
      await key(page, 'Escape');
      const sheetClosed = await geometry();
      check('phone-calendar', `${tag}: closing the settled open sheet moves outer geometry exactly 0 px`,
        JSON.stringify(sheetOpen) === JSON.stringify(sheetClosed), { before: sheetOpen, after: sheetClosed });
    }
    const desktop = VIEWPORTS.find(v => v.name === '1440');
    await configure(page, desktop, 'light');
    await load(page, board.url, 'results');
    await waitFor(page, `document.querySelector('#cal [data-day="2026-10-01"] .vs')?.textContent === '+1'`);
    const desktopGlyphs = await page.evaluate(`[...document.querySelectorAll('#cal [data-day]')].map(c => {
      const v = c.querySelector('.v'); return { day: c.dataset.day, text: v.innerText, scroll: v.scrollWidth, client: v.clientWidth,
        glyph: c.querySelector('.vl use')?.getAttribute('href') ?? null, visible: __audit.visible(c.querySelector('.vl')) };
    })`);
    for (const [day, amount] of cases.filter(([day]) => day.startsWith('2026-10'))) {
      const cell = desktopGlyphs.find(c => c.day === day);
      const glyph = amount === '0' ? null : amount.startsWith('-') ? '#i-down' : '#i-up';
      check('phone-calendar', `1440 light ${day}: desktop keeps its ${glyph ?? 'flat'} treatment`, cell?.visible && cell.glyph === glyph,
        cell ?? { day, text: null, scroll: null, client: null });
    }
    check('phone-calendar', '1440 light: the same October crop includes the missing-day warning',
      await page.evaluate(`Boolean(document.querySelector('#cal [data-day="${missingDay}"] .day-warning use[href="#i-half"]'))`));
    await crop('1440-light-results-phone-calendar', 'Same October calendar: ±€ 1.200.000, gain, loss, zero, k and the missing-day warning, with the original desktop up/down glyphs');
    await serve(null);
  }

  if (run('ingress')) {
    // JOED-27: real HTTP push/read, with no results interception. Exercise both
    // the module worker and the fallback, including server rejection headers.
    await serve(null);
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const { board } = await designBoard();
      const record = designResults(NOW); delete record.receivedAt;
      const pushed = await board.pushResults(record);
      check('results-ingress', `${viewport.name} ${theme}: the real results inbox accepts v2`, pushed.status === 200, pushed);
      const fallback = viewport.mobile && theme === 'dark';
      const injection = fallback ? await page.s('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.Worker = undefined;' }) : null;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      if (injection) await page.s('Page.removeScriptToEvaluateOnNewDocument', injection);
      const live = await page.evaluate(RES), before = await rects(page, SHIFT);
      check('results-ingress', `${viewport.name} ${theme}: accepted push renders live through ${fallback ? 'fallback' : 'worker'}`,
        live.display !== '—' && !live.status && (await page.evaluate('window.__joedesk.worker()')) === !fallback, live.status);
      if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-ingress-live`, 'Results live from POST /joe/inbox/results');
      board.setNow(at(NOW, 69)); // exactly 60 s after the accepted receipt
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `/updates are late/.test(document.getElementById('resStatus').innerText)`);
      const stale = await page.evaluate(RES);
      check('results-ingress', `${viewport.name} ${theme}: at 60 s the real feed is stale, keeps its numbers and moves nothing`,
        /^Stale · Results as of 1.min ago · updates are late\.$/.test(stale.status) && stale.display === live.display &&
        !shifted(before, await rects(page, SHIFT), ['top', 'left', 'height']).length, stale.status);
      if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-ingress-stale`, 'Results stale 60 seconds after its last accepted push');
      const bad = structuredClone(record); bad.seq++; bad.generatedAt = board.clock(); bad.trades[0].netEur.amount = '999';
      const rejected = await board.pushResults(bad);
      check('results-ingress', `${viewport.name} ${theme}: a bad pushed record is rejected with 422 contract_invalid`,
        rejected.status === 422 && rejected.body.reason === 'contract_invalid', rejected);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `/last update was rejected/.test(document.getElementById('resStatus').innerText)`);
      const retained = await page.evaluate(RES);
      check('results-ingress', `${viewport.name} ${theme}: rejection header keeps last good numbers with their original age`,
        /last good results from 1.min ago/.test(retained.status) && retained.display === live.display, retained.status);
      const next = { ...record, seq: record.seq + 1, generatedAt: board.clock() };
      check('results-ingress', `${viewport.name} ${theme}: a new accepted push recovers`, (await board.pushResults(next)).status === 200);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.getElementById('resStatus').innerText.length === 0`);
      check('results-ingress', `${viewport.name} ${theme}: recovery clears the rejection`, !(await page.evaluate(RES)).status);
    }
  }

  if (run('partial-days')) {
    // Real ingress, worker and fallback. T+1 permits only yesterday to remain
    // Partial; the empty snapshot shows that same day without visible trades.
    await serve(null);
    const { board } = await designBoard('2026-10-16T12:00:00.000Z', null, ({ snapshot }) => {
      // Two paper positions under Joe: one opened yesterday, one today.
      snapshot.positions.rows.filter(p => p.scope === 'stage0').forEach((p, i) => {
        p.desk = 'joe'; p.openedAt = `2026-10-${i ? '16' : '15'}T09:15:00.000Z`;
      });
    });
    const { dates, baseline, partial, empty, missing, large, emptyMonth, reasons, singleReason, counted, threeReasons, emptyToday, todayWithoutReasons } = partialDaysResults(board.clock());
    const { partial: partialTrade, escalated, missing: stale, normal, emptyEscalated, today } = dates;
    const filteredReasons = structuredClone(singleReason);
    filteredReasons.days.find(d => d.date === today).partialReasons = ['history_gap'];
    // The 14th has a trade but no opened-position sentence. Five reasons
    // leave three hidden lines, so revealing them grows the content below cap.
    const growingReasons = structuredClone(partial), growingDay = escalated;
    growingReasons.days.find(d => d.date === growingDay).partialReasons = ['capture_gap', 'history_gap',
      'broker_trade_count_mismatch', 'broker_realised_pnl_mismatch', 'unattributed_activity'];
    const reason = "Part of this day's activity couldn't be confirmed, so its result may be incomplete.";
    let seq = baseline.seq;
    const replace = async (record, label) => {
      const oldCalendar = await page.evaluate('document.getElementById("cal").innerHTML');
      check('partial-days', `${label}: accepted ingress`, (await board.pushResults({ ...record, seq: ++seq })).status === 200);
      await page.evaluate('window.__joedesk.refresh()');
      const count = record.trades.filter(t => t.closedAt.startsWith(partialTrade)).length;
      await waitFor(page, `document.getElementById('cal').innerHTML !== ${JSON.stringify(oldCalendar)} && document.querySelector('#cal [data-day="${partialTrade}"] .n').textContent === ${JSON.stringify(
        record === missing ? 'Stale' : record.days.find(d => d.date === partialTrade)?.coverage === 'partial' ? 'Partial' :
          count + '\u00a0' + (count === 1 ? 'trade' : 'trades'))}`);
      await settle(page);
    };
    const inspect = () => page.evaluate(`(${(() => {
      const probe = document.createElement('span'); probe.style.color = 'var(--warn)'; document.body.append(probe);
      const warn = getComputedStyle(probe).color; probe.remove();
      return [...document.querySelectorAll('#cal [data-day]')].map(cell => {
        const markers = [...cell.querySelectorAll('.day-warning')], note = cell.querySelector('.n');
        const marker = markers[0], r = marker?.getBoundingClientRect(), c = cell.getBoundingClientRect();
        const css = getComputedStyle(cell), offset = marker && getComputedStyle(marker);
        const tone = marker && getComputedStyle(marker.querySelector('svg')).color;
        return { day: cell.dataset.day, markers: markers.length, half: Boolean(marker?.querySelector('use[href="#i-half"]')),
          warn: tone === warn, ink: tone === css.color, noteInk: getComputedStyle(note).color === css.color,
          inside: r ? r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom : false,
          aligned: offset ? offset.top === css.paddingTop && offset.right === css.paddingRight : false,
          note: note.textContent, noteVisible: __audit.visible(note), value: cell.querySelector('.v').innerText,
          muted: Boolean(cell.querySelector('.v .muted')), cls: cell.className, bg: css.backgroundColor, ring: css.boxShadow,
          aria: cell.getAttribute('aria-label'), clipped: [cell, cell.querySelector('.v'), marker].filter(Boolean).some(el => el.scrollWidth > el.clientWidth) };
      });
    }).toString()})()`);
    const monthProbe = () => page.evaluate(`(${(() => {
      const el = document.getElementById('calSum'), head = el.parentElement, st = el.querySelector('.st.warn');
      return { visible: __audit.visible(el), text: el.innerText, hint: st?.innerText, compact: el.classList.contains('compact'),
        clipped: el.scrollWidth > el.clientWidth || head.scrollWidth > head.clientWidth,
        height: el.getBoundingClientRect().height };
    }).toString()})()`);
    const contentSlots = ['#cal .cell .d', '#cal .cell .v', '#cal .cell .n'];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const noteLayout = rootSelector => page.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(rootSelector)}), reason = root.querySelector('.dp-note-lines'), position = root.querySelector('.dp-position-note');
      return { reason: reason?.innerText ?? '', lines: [...(reason?.children ?? [])].map(el => el.textContent.trim()),
        position: position?.innerText ?? '', reasonTag: reason?.tagName, positionTag: position?.tagName,
        siblings: Boolean(reason && position && reason.nextElementSibling === position && reason.parentElement === position.parentElement),
        gap: reason && position ? position.getBoundingClientRect().top - reason.getBoundingClientRect().bottom : null,
        cssGap: getComputedStyle(root.querySelector('.dp-note-copy')).rowGap };
    })()`);
    const checkNoteGap = async (rootSelector, label) => {
      const layout = await noteLayout(rootSelector);
      check('partial-days', `${label}: reason block and positions are separate paragraphs exactly 8 px apart`,
        layout.reasonTag === 'P' && layout.positionTag === 'P' && layout.siblings && layout.gap === 8 && layout.cssGap === '8px', layout);
      return layout;
    };
    const cropNoteView = async (selector, name, what) => {
      const clip = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }; })()`);
      const { data } = await page.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      writeFileSync(join(QA_DIR, `${name}.png`), Buffer.from(data, 'base64'));
      shots.push({ file: `${name}.png`, what });
    };
    const viewports = [...VIEWPORTS, { name: '360', width: 360, height: 800, mobile: true }];
    for (const viewport of viewports) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme}`;
      check('partial-days', `${tag}: full baseline accepts`, (await board.pushResults({ ...baseline, seq: ++seq })).status === 200);
      const fallback = viewport.mobile && theme === 'dark';
      const injection = fallback ? await page.s('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.Worker = undefined;' }) : null;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      if (injection) await page.s('Page.removeScriptToEvaluateOnNewDocument', injection);
      await click(page, '#periodSeg [data-period="month"]');
      await click(page, `#cal [data-day="${partialTrade}"]`);
      if (viewport.mobile) await key(page, 'Escape');
      const before = await rects(page, SHIFT), full = await page.evaluate(RES), contentRects = await rects(page, contentSlots);
      await replace(partial, tag);
      const shown = await page.evaluate(RES), cells = await inspect(), cell = day => cells.find(c => c.day === day);
      const trade = cell(partialTrade), old = cell(escalated), oldEmpty = cell(emptyEscalated);
      check('partial-days', `${tag}: Partial inherits tint ink, keeps its slot and accessible reason`,
        trade.markers === 1 && trade.half && trade.ink && trade.inside && trade.aligned && trade.note === 'Partial' &&
        trade.noteVisible === !viewport.mobile && trade.aria.includes("; Partial: this day's record is incomplete") &&
        trade.aria.includes(reason) && !trade.clipped, trade);
      check('partial-days', `${tag}: partial trade keeps the exact amount and loss tint`,
        N(trade.aria).includes(N('−€ 1,00 from 1 trade')) && /\bl[1-4]\b/.test(trade.cls) &&
        shown.cal.cells.find(c => c.day === partialTrade).v === full.cal.cells.find(c => c.day === partialTrade).v, trade);
      check('partial-days', `${tag}: both traded and empty old partial dates escalate to exactly one Stale marker`,
        [old, oldEmpty].every(c => c.markers === 1 && c.half && c.ink && c.note === 'Stale' && c.noteInk &&
          c.aria.includes(`Stale: still incomplete; ${reason}`) && !c.clipped), [old, oldEmpty]);
      check('partial-days', `${tag}: missing-day Stale, open today and normal retain their states`,
        cell(stale).markers === 1 && cell(stale).note === 'Stale' && cell(stale).aria.includes('daily summary missing') &&
        cell(today).markers === 0 && !cell(today).aria.includes('Partial') && /\btoday\b/.test(cell(today).cls) &&
        cell(normal).markers === 0 && cell(normal).note !== 'Partial', cells.filter(c => [stale, today, normal].includes(c.day)));
      check('partial-days', `${tag}: adding warnings and the month hint moves outer and cell slots exactly 0 px`,
        same(before, await rects(page, SHIFT)) && same(contentRects, await rects(page, contentSlots)));
      check('partial-days', `${tag}: trade totals and the record status stay unchanged`,
        shown.display === full.display && same(shown.split, full.split) && shown.status === full.status && !shown.status);
      const month = await monthProbe();
      check('partial-days', `${tag}: desktop month hint counts all 3 closed partial days, including 2 escalated, and never clips or wraps`,
        month.visible === !viewport.mobile && (viewport.mobile || (month.hint === 'incl. 3 partial days' && !month.clipped && month.height <= 20)), month);
      check('partial-days', `${tag}: read uses the expected ${fallback ? 'fallback' : 'worker'}`,
        await page.evaluate('window.__joedesk.worker()') === !fallback);
      // The general mobile audit requires the standard 390 px/44 px targets.
      // Like JOED-29, 360 keeps all focused checks without running that audit.
      if (viewport.name !== '360') await auditScreen(page, viewport, theme, 'results (partial coverage)');
      await shot(page, viewport, `${viewport.name}-${theme}-results-partial-days`, 'October: Partial 15th, Stale missing 13th, Stale incomplete 11th/14th, normal 12th, open today 16th');
      if (!viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-partial-month-hint`, 'Desktop month summary: incl. 3 partial days, including 2 escalated, excluding today and missing-summary Stale');

      // Computed browser colours, every tint, including the neutral card's
      // composed background. Probes inherit the actual calendar's ancestors.
      const contrasts = await page.evaluate(`(${(() => {
        const rgb = c => c.match(/[\d.]+/g).map(Number);
        const composite = (front, back) => { const a = front[3] ?? 1; return front.slice(0, 3).map((c, i) => c * a + back[i] * (1 - a)); };
        const background = el => {
          const chain = []; for (let p = el; p; p = p.parentElement) chain.unshift(p);
          return chain.reduce((bg, p) => composite(rgb(getComputedStyle(p).backgroundColor), bg), [255, 255, 255]);
        };
        const luminance = cs => cs.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
          .reduce((s, c, i) => s + c * [.2126, .7152, .0722][i], 0);
        return ['g1', 'g2', 'g3', 'g4', 'l1', 'l2', 'l3', 'l4', 'flat', 'none'].map(cls => {
          const cell = document.querySelector('#cal .day-incomplete').cloneNode(true);
          cell.className = 'cell ' + cls + ' day-incomplete'; cell.style.cssText = 'position:fixed;top:0;left:0;width:62px';
          const marker = cell.querySelector('.day-warning'); marker.className = 'day-warning st' + (cls === 'none' ? ' warn' : '');
          document.getElementById('cal').append(cell);
          const fg = getComputedStyle(marker.querySelector('svg')).color, bg = background(cell), x = luminance(rgb(fg)), y = luminance(bg);
          const ratio = (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
          cell.remove(); return { cls, fg, bg, ratio };
        });
      }).toString()})()`);
      check('partial-days', `${tag}: every computed partial icon contrast is at least 3:1`, contrasts.every(c => c.ratio >= 3), contrasts);

      for (const hasTrades of [true, false]) {
        if (!hasTrades) await replace(empty, `${tag} empty`);
        const c = (await inspect()).find(c => c.day === partialTrade);
        if (!hasTrades) {
          check('partial-days', `${tag}: no-trade Partial is a neutral muted dash, warn icon and full-ink note`,
            c.markers === 1 && c.half && c.warn && c.noteInk && c.note === 'Partial' && c.value === '—' && c.muted &&
            /\bnone\b/.test(c.cls) && c.bg === 'rgba(0, 0, 0, 0)' && /inset/.test(c.ring) &&
            c.aria.includes('no complete record; Partial:') && !/€|no trades|sat out/.test(c.aria) && !c.clipped, c);
          await shot(page, viewport, `${viewport.name}-${theme}-results-partial-empty-days`, 'Same October snapshot with an unattributed-only Partial on the 15th');
        }
        const closedSheet = viewport.mobile ? await rects(page, SHIFT) : null;
        await click(page, `#cal [data-day="${partialTrade}"]`);
        const detail = await page.evaluate(`(() => {
          const root = document.querySelector(${JSON.stringify(viewport.mobile ? '#sheetBody' : '#daypanel')});
          const sum = root.querySelector('.dp-sum'), note = root.querySelector('.dp-note-lines');
          return { sum: sum.innerText, text: root.innerText, rows: root.querySelectorAll('.trow').length,
            warning: root.querySelectorAll('.dp-sum .st.warn use[href="#i-half"]').length,
            reason: note?.innerText, noteVisible: __audit.visible(note), info: Boolean(root.querySelector('.dp-note use[href="#i-info"]')),
            clipped: [root, sum, note, ...root.querySelectorAll('.trow')].filter(Boolean).some(el => el.scrollWidth > el.clientWidth) };
        })()`);
        check('partial-days', `${tag}: ${hasTrades ? 'traded' : 'empty'} ${viewport.mobile ? 'sheet' : 'panel'} keeps the amount/reason without clipping`,
          (hasTrades ? /^Partial·(?:1trade·)?−€1,00sofar$/.test(N(detail.sum)) : N(detail.sum) === N('Partial · record incomplete')) &&
          detail.rows === (hasTrades ? 1 : 0) && detail.warning === 1 &&
          detail.reason === reason &&
          detail.noteVisible && detail.info && !detail.clipped &&
          (hasTrades || !/€|no trades|sat out|so far/i.test(detail.text)), detail);
        const name = `${viewport.name}-${theme}-results-partial-${hasTrades ? 'trade' : 'empty'}-${viewport.mobile ? 'sheet' : 'panel'}`;
        const layout = await checkNoteGap(viewport.mobile ? '#sheetBody' : '#daypanel', `${tag} ${hasTrades ? 'traded' : 'empty'} legacy`);
        check('partial-days', `${tag}: legacy positions paragraph retains its exact sentence`,
          layout.position === 'Bank of America (BAC, Joe), opened this day, is still open; it counts as Still open and on Desk.', layout);
        if (viewport.name === '1440' && !hasTrades) await cropNoteView('#daypanel', name + '-crop', 'Legacy empty panel: separate position paragraph, exactly 8 px after the default reason');
        if (viewport.mobile) {
          await viewShot(page, name, `Partial on 15 October: ${hasTrades ? 'exact money so far' : 'unknown amount and incomplete record'}`);
          await key(page, 'Escape');
          check('partial-days', `${tag}: closing the partial sheet returns to exactly the same geometry`, same(closedSheet, await rects(page, SHIFT)));
        } else await shot(page, viewport, name, `Partial on 15 October: ${hasTrades ? 'exact money so far' : 'unknown amount and incomplete record'}`);
      }

      await replace(missing, `${tag} missing handoff`);
      const handoffBefore = await rects(page, SHIFT), handoffSlots = await rects(page, contentSlots);
      const handoffStale = (await inspect()).find(c => c.day === partialTrade);
      await replace(partial, `${tag} partial handoff`);
      const handoffPartial = (await inspect()).find(c => c.day === partialTrade);
      check('partial-days', `${tag}: JOED-28 Stale swaps to JOED-30 Partial at exactly 0 px`,
        handoffStale.note === 'Stale' && handoffStale.aria.includes('daily summary missing') && handoffPartial.note === 'Partial' &&
        handoffPartial.markers === 1 && handoffStale.value === handoffPartial.value &&
        same(handoffBefore, await rects(page, SHIFT)) && same(handoffSlots, await rects(page, contentSlots)));

      // Same 99 trade rows before and after: adding Partial/so far cannot
      // change the fixed 36 px header or the settled phone sheet's geometry.
      const largeFull = structuredClone(large); largeFull.days.find(d => d.date === partialTrade).coverage = 'full';
      withTradeSummaries(largeFull);
      await replace(largeFull, `${tag} full large summary`);
      if (viewport.mobile) await click(page, `#cal [data-day="${partialTrade}"]`);
      const headerSelectors = viewport.mobile ? ['.dlg-h', '#sheetBody .dp-sum'] : ['.dp-head'];
      const headerBefore = await rects(page, headerSelectors);
      await replace(large, `${tag} partial large summary`);
      const largeDetail = await page.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(viewport.mobile ? '#sheetBody' : '#daypanel')});
        const sum = root.querySelector('.dp-sum'), header = root.querySelector('.dp-head'), amount = sum.querySelector('.dp-amount');
        return { visible: sum.innerText, complete: sum.textContent, height: header?.getBoundingClientRect().height,
          clipped: sum.scrollWidth > sum.clientWidth || Boolean(header && header.scrollWidth > header.clientWidth),
          amountClipped: amount.getBoundingClientRect().right > sum.getBoundingClientRect().right };
      })()`);
      check('partial-days', `${tag}: worst summary keeps Partial, −€ 999.999,99 and so far; optional count drops first; 0 px`,
        /^Partial·(?:99trades·)?−€999\.999,99sofar$/.test(N(largeDetail.visible)) &&
        N(largeDetail.complete) === N('Partial · 99 trades · −€ 999.999,99 so far') && !largeDetail.clipped && !largeDetail.amountClipped &&
        (viewport.mobile || largeDetail.height === 36) && same(headerBefore, await rects(page, headerSelectors)), largeDetail);
      const largeName = `${viewport.name}-${theme}-results-partial-so-far`;
      if (viewport.mobile) { await viewShot(page, largeName, 'Worst partial amount so far; trade count yields first'); await key(page, 'Escape'); }
      else await shot(page, viewport, largeName, 'Worst partial amount so far in the fixed 36 px day header');

      await replace(emptyMonth, `${tag} no trades this month`);
      const emptyMonthProbe = await monthProbe();
      check('partial-days', `${tag}: an empty month with Partial says No trades recorded this month; hint fits`,
        !viewport.mobile ? N(emptyMonthProbe.text) === N('No trades recorded this month · incl. 3 partial days') && !emptyMonthProbe.clipped && emptyMonthProbe.height <= 20
          : !emptyMonthProbe.visible, emptyMonthProbe);
      if (!viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-partial-empty-month-hint`, 'No trades recorded this month · incl. 3 partial days');

      // Rev 5: 9 accepted codes render 8 sentences after FX dedup. All reason
      // variants use real ingress and the same worker/fallback paths above.
      await replace(reasons, `${tag} nine reasons`);
      const reasonRoot = viewport.mobile ? '#sheetBody' : '#daypanel';
      if (viewport.mobile) await click(page, `#cal [data-day="${partialTrade}"]`);
      const reasonProbe = () => page.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(reasonRoot)}), note = root.querySelector('.dp-note');
        const lines = [...root.querySelectorAll('.dp-reason')], button = root.querySelector('.dp-reasons-more');
        return { lead: root.querySelector('.dp-note-lead')?.innerText, lines: lines.map(el => ({ text: el.innerText, visible: __audit.visible(el) })),
          button: button && { text: button.innerText, height: button.getBoundingClientRect().height, name: button.getAttribute('aria-label'),
            expanded: button.getAttribute('aria-expanded'), keyboard: button.tagName === 'BUTTON' && !button.disabled && button.tabIndex === 0 },
          focused: document.activeElement === root.querySelector('.dp-reasons-extra .dp-reason') && document.activeElement?.tabIndex === -1,
          live: root.querySelector('.dp-reasons-extra')?.getAttribute('aria-live'),
          sheet: ${viewport.mobile} ? { reservedHeight: parseFloat(document.getElementById('daySheet').style.height),
            cap: innerHeight * .8, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight } : null,
          clipped: [note, ...lines.filter(el => __audit.visible(el))].some(el => el.scrollWidth > el.clientWidth) };
      })()`);
      let reasonDetail = await reasonProbe();
      await checkNoteGap(reasonRoot, `${tag} nine reasons collapsed`);
      const expectedReasons = M.partialReasons(reasons.days.find(d => d.date === partialTrade)).map(r => r.text);
      check('partial-days', `${tag}: canonical reason sentences wrap cleanly; FX disabled suppresses missing`,
        reasonDetail.lead === 'Result may be incomplete.' && same(reasonDetail.lines.map(l => l.text), expectedReasons) &&
        reasonDetail.lines.filter(l => l.visible).length === (viewport.mobile ? 2 : 8) && !reasonDetail.clipped &&
        (!viewport.mobile ? !reasonDetail.button : reasonDetail.button.text === '+6 more' && reasonDetail.button.height >= 44 &&
          reasonDetail.button.keyboard && reasonDetail.button.name === 'Show 6 more reasons'), reasonDetail);
      const reasonsName = `${viewport.name}-${theme}-results-partial-nine-reasons`;
      const sheetGeometry = () => page.evaluate(`(() => { const r = document.getElementById('daySheet').getBoundingClientRect(); return { top: r.top, height: r.height }; })()`);
      let nineReasonHeight;
      if (viewport.mobile) {
        await viewShot(page, reasonsName + '-collapsed', 'Nine codes: two visible reason lines and +6 more');
        const above = ['.dlg-h', '#sheetBody .dp-sum', '#sheetBody .trow', '#sheetBody .dp-note-lead',
          // Only the first two reason lines, visible before either reveal.
          '#sheetBody .dp-note-lines > .dp-reason:nth-child(2)', '#sheetBody .dp-note-lines > .dp-reason:nth-child(3)'];
        const fixedBefore = await rects(page, above), outerBefore = await rects(page, SHIFT), sheetBefore = await sheetGeometry();
        const movedRects = (before, after) => {
          const old = new Map(before.map(r => [r.key, r])), next = new Map(after.map(r => [r.key, r]));
          return [...new Set([...old.keys(), ...next.keys()])].filter(key => !same(old.get(key), next.get(key))).map(key => {
            const a = old.get(key), b = next.get(key);
            return { key, before: a ?? null, after: b ?? null,
              delta: a && b ? Object.fromEntries(['top', 'left', 'height', 'width'].map(k => [k, b[k] - a[k]])) : null };
          });
        };
        const revealGeometry = async before => {
          const after = await sheetGeometry(), fixedAfter = await rects(page, above), outerAfter = await rects(page, SHIFT);
          return { unchanged: same(before, after) && same(fixedBefore, fixedAfter) && same(outerBefore, outerAfter),
            sheet: { before, after, delta: { top: after.top - before.top, height: after.height - before.height } },
            aboveMoved: movedRects(fixedBefore, fixedAfter), outerMoved: movedRects(outerBefore, outerAfter) };
        };
        nineReasonHeight = sheetBefore.height;
        check('partial-days', `${tag}: geometry tracks exactly the two reasons visible before expansion`,
          fixedBefore.filter(r => r.key.includes('.dp-reason:nth-child(')).length === 2, fixedBefore);
        check('partial-days', `${tag}: nine-reason sheet is capped at 80vh`, nineReasonHeight <= viewport.height * .8, sheetBefore);
        await page.evaluate('document.querySelector("#sheetBody .dp-reasons-more").focus({preventScroll:true})');
        await key(page, 'Enter');
        await waitFor(page, '!document.querySelector("#sheetBody .dp-reasons-more") && !document.getElementById("dayReasonsExtra").hidden');
        reasonDetail = await reasonProbe();
        let geometry = await revealGeometry(sheetBefore);
        check('partial-days', `${tag}: keyboard reveal removes the button, focuses and politely announces all 8 reasons with 0 px sheet movement`,
          reasonDetail.lines.length === 8 && reasonDetail.lines.every(l => l.visible) && !reasonDetail.button && reasonDetail.focused && reasonDetail.live === 'polite' && !reasonDetail.clipped &&
          geometry.unchanged, { ...reasonDetail, geometry });
        check('partial-days', `${tag}: keyboard-expanded sheet holds all content without scrolling when below the 80vh cap`,
          reasonDetail.sheet.reservedHeight >= reasonDetail.sheet.cap || reasonDetail.sheet.scrollHeight <= reasonDetail.sheet.clientHeight, reasonDetail.sheet);
        await checkNoteGap(reasonRoot, `${tag} nine reasons keyboard-expanded`);
        await key(page, 'Escape');
        await click(page, `#cal [data-day="${partialTrade}"]`);
        const reopened = await reasonProbe(), pointerBefore = await sheetGeometry();
        check('partial-days', `${tag}: reopening the sheet starts collapsed with the same full-content height`,
          reopened.button?.text === '+6 more' && reopened.lines.filter(l => l.visible).length === 2 && same(sheetBefore, pointerBefore), reopened);
        const target = await page.evaluate(`(() => { const r = document.querySelector('#sheetBody .dp-reasons-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target] });
        await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page);
        await waitFor(page, '!document.querySelector("#sheetBody .dp-reasons-more") && !document.getElementById("dayReasonsExtra").hidden');
        reasonDetail = await reasonProbe();
        geometry = await revealGeometry(pointerBefore);
        check('partial-days', `${tag}: a real pointer tap reveals all reasons and keeps sheet top, height and prior content exactly 0 px`,
          reasonDetail.lines.length === 8 && reasonDetail.lines.every(l => l.visible) && !reasonDetail.button && reasonDetail.focused && !reasonDetail.clipped &&
          geometry.unchanged, { ...reasonDetail, geometry });
        check('partial-days', `${tag}: pointer-expanded sheet holds all content without scrolling when below the 80vh cap`,
          reasonDetail.sheet.reservedHeight >= reasonDetail.sheet.cap || reasonDetail.sheet.scrollHeight <= reasonDetail.sheet.clientHeight, reasonDetail.sheet);
        await checkNoteGap(reasonRoot, `${tag} nine reasons pointer-expanded`);
        await viewShot(page, reasonsName + '-expanded', 'All eight reason sentences revealed in place');
        if (viewport.name === '360') await cropNoteView('#daySheet', reasonsName + '-expanded-crop', 'All eight reasons plus a separate position paragraph after an exact 8 px gap');
        await key(page, 'Escape');
      } else await shot(page, viewport, reasonsName + '-panel', 'All eight reason sentences in canonical order');

      for (const [record, suffix, sentence] of [[singleReason, 'single-reason', 'The trade history has a gap that covers this day.'],
        [counted, 'counted', "2\u00a0trades couldn't be matched to a desk."]]) {
        await replace(record, `${tag} ${suffix}`);
        if (viewport.mobile) await click(page, `#cal [data-day="${partialTrade}"]`);
        const detail = await reasonProbe();
        check('partial-days', `${tag}: ${suffix} has exact copy without a disclosure`, detail.lines.length === 1 && detail.lines[0].text === sentence && !detail.button && !detail.clipped, detail);
        if (viewport.mobile && record === singleReason) {
          const one = await sheetGeometry();
          check('partial-days', `${tag}: a one-reason day has a shorter sheet than the nine-code day`, one.height < nineReasonHeight && one.height < viewport.height * .8, { one, nineReasonHeight });
        }
        if (viewport.mobile) { await viewShot(page, `${viewport.name}-${theme}-results-partial-${suffix}`, sentence); await key(page, 'Escape'); }
        else await shot(page, viewport, `${viewport.name}-${theme}-results-partial-${suffix}`, sentence);
      }

      await replace(threeReasons, `${tag} one more reason`);
      if (viewport.mobile) await click(page, `#cal [data-day="${partialTrade}"]`);
      const singular = await reasonProbe();
      check('partial-days', `${tag}: a single hidden reason has singular accessible copy`,
        viewport.mobile ? singular.button?.text === '+1 more' && singular.button.name === 'Show 1 more reason' : !singular.button, singular);
      if (viewport.mobile) {
        // Three reasons are the two visible lines plus +1 more: exercise the
        // below-cap reveal independently of the capped nine-reason sheet.
        const above = ['.dlg-h', '#sheetBody .dp-sum', '#sheetBody .trow', '#sheetBody .dp-note-lead',
          '#sheetBody .dp-note-lines > .dp-reason:nth-child(2)', '#sheetBody .dp-note-lines > .dp-reason:nth-child(3)'];
        const movedRects = (before, after) => {
          const old = new Map(before.map(r => [r.key, r])), next = new Map(after.map(r => [r.key, r]));
          return [...new Set([...old.keys(), ...next.keys()])].filter(key => !same(old.get(key), next.get(key))).map(key => {
            const a = old.get(key), b = next.get(key);
            return { key, before: a ?? null, after: b ?? null,
              delta: a && b ? Object.fromEntries(['top', 'left', 'height', 'width'].map(k => [k, b[k] - a[k]])) : null };
          });
        };
        const expected = M.partialReasons(threeReasons.days.find(d => d.date === partialTrade)).map(r => r.text);
        for (const input of ['keyboard', 'pointer']) {
          if (input === 'pointer') await click(page, `#cal [data-day="${partialTrade}"]`);
          const collapsed = await reasonProbe(), sheetBefore = await sheetGeometry();
          const fixedBefore = await rects(page, above), outerBefore = await rects(page, SHIFT);
          check('partial-days', `${tag}: ${input} three-reason sheet starts below the 80vh cap with two visible lines and +1 more`,
            collapsed.button?.text === '+1 more' && collapsed.button.name === 'Show 1 more reason' &&
            collapsed.lines.filter(l => l.visible).length === 2 &&
            fixedBefore.filter(r => r.key.includes('.dp-reason:nth-child(')).length === 2 &&
            sheetBefore.height < collapsed.sheet.cap && collapsed.sheet.reservedHeight < collapsed.sheet.cap,
            { ...collapsed, sheetBefore, above: fixedBefore, outer: outerBefore });
          if (input === 'keyboard') {
            await page.evaluate('document.querySelector("#sheetBody .dp-reasons-more").focus({preventScroll:true})');
            await key(page, 'Enter');
          } else {
            const target = await page.evaluate(`(() => { const r = document.querySelector('#sheetBody .dp-reasons-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target] });
            await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
          }
          await waitFor(page, '!document.querySelector("#sheetBody .dp-reasons-more") && !document.getElementById("dayReasonsExtra").hidden');
          const expanded = await reasonProbe(), sheetAfter = await sheetGeometry();
          const fixedAfter = await rects(page, above), outerAfter = await rects(page, SHIFT);
          const geometry = {
            unchanged: same(sheetBefore, sheetAfter) && same(fixedBefore, fixedAfter) && same(outerBefore, outerAfter),
            sheet: { before: sheetBefore, after: sheetAfter,
              delta: { top: sheetAfter.top - sheetBefore.top, height: sheetAfter.height - sheetBefore.height } },
            aboveMoved: movedRects(fixedBefore, fixedAfter), outerMoved: movedRects(outerBefore, outerAfter),
          };
          check('partial-days', `${tag}: ${input} reveals all three reasons with sheet top, height and prior content exactly 0 px`,
            expanded.lines.length === 3 && same(expanded.lines.map(l => l.text), expected) && expanded.lines.every(l => l.visible) &&
            !expanded.button && expanded.focused && expanded.live === 'polite' && !expanded.clipped && geometry.unchanged,
            { ...expanded, geometry });
          check('partial-days', `${tag}: ${input}-expanded three-reason content is below the 80vh cap and fits the reserved body without scrolling`,
            expanded.sheet.reservedHeight < expanded.sheet.cap && expanded.sheet.scrollHeight <= expanded.sheet.clientHeight, expanded.sheet);
          await key(page, 'Escape');
        }
      }

      if (viewport.mobile) {
        await replace(growingReasons, `${tag} growing reasons below cap`);
        const above = ['.dlg-h', '#sheetBody .dp-sum', '#sheetBody .trow', '#sheetBody .dp-note-lead',
          '#sheetBody .dp-note-lines > .dp-reason:nth-child(2)', '#sheetBody .dp-note-lines > .dp-reason:nth-child(3)'];
        const movedRects = (before, after) => {
          const old = new Map(before.map(r => [r.key, r])), next = new Map(after.map(r => [r.key, r]));
          return [...new Set([...old.keys(), ...next.keys()])].filter(key => !same(old.get(key), next.get(key))).map(key => {
            const a = old.get(key), b = next.get(key);
            return { key, before: a ?? null, after: b ?? null,
              delta: a && b ? Object.fromEntries(['top', 'left', 'height', 'width'].map(k => [k, b[k] - a[k]])) : null };
          });
        };
        const contentProbe = () => page.evaluate(`(() => {
          const root = document.getElementById('sheetBody'), extra = root.querySelector('.dp-reasons-extra'), button = root.querySelector('.dp-reasons-more');
          // scrollHeight includes the reserved blank space. Measure the actual
          // content through the last block's bottom, including body padding.
          const height = () => root.lastElementChild.getBoundingClientRect().bottom - root.getBoundingClientRect().top + parseFloat(getComputedStyle(root).paddingBottom);
          const collapsed = height(), extraHidden = extra.hidden, buttonHidden = button?.hidden;
          let expanded;
          try {
            extra.hidden = false;
            if (button) button.hidden = true;
            expanded = height();
          } finally {
            extra.hidden = extraHidden;
            if (button) button.hidden = buttonHidden;
          }
          return { collapsed, expanded, expandedSheetHeight: document.querySelector('#daySheet .dlg-h').getBoundingClientRect().height + expanded,
            positionNotes: [...root.querySelectorAll('.dp-position-note')].map(el => el.innerText) };
        })()`);
        const cropSheet = async (name, what) => {
          const clip = await page.evaluate(`(() => { const r = document.getElementById('daySheet').getBoundingClientRect();
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }; })()`);
          const { data } = await page.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
          writeFileSync(join(QA_DIR, `${name}.png`), Buffer.from(data, 'base64'));
          shots.push({ file: `${name}.png`, what });
        };
        const expected = M.partialReasons(growingReasons.days.find(d => d.date === growingDay)).map(r => r.text);
        const growingName = `${viewport.name}-${theme}-results-partial-growing-reasons`;
        for (const input of ['keyboard', 'pointer']) {
          await click(page, `#cal [data-day="${growingDay}"]`);
          if (viewport.name === '360' && input === 'keyboard') await cropSheet(growingName + '-collapsed', 'Below-cap growing sheet: two visible reasons and +3 more, without a position sentence');
          const collapsed = await reasonProbe(), contentBefore = await contentProbe(), sheetBefore = await sheetGeometry();
          const fixedBefore = await rects(page, above), outerBefore = await rects(page, SHIFT);
          check('partial-days', `${tag}: ${input} growing five-reason sheet starts below the 80vh cap with two visible lines and +3 more`,
            collapsed.button?.text === '+3 more' && collapsed.button.name === 'Show 3 more reasons' && collapsed.button.height >= 44 && collapsed.button.keyboard &&
            collapsed.lines.length === 5 && same(collapsed.lines.map(l => l.text), expected) && collapsed.lines.filter(l => l.visible).length === 2 &&
            fixedBefore.filter(r => r.key.includes('.dp-reason:nth-child(')).length === 2 && !contentBefore.positionNotes.length &&
            contentBefore.expanded > contentBefore.collapsed && contentBefore.expandedSheetHeight < collapsed.sheet.cap &&
            sheetBefore.height < collapsed.sheet.cap && collapsed.sheet.reservedHeight < collapsed.sheet.cap,
            { ...collapsed, content: contentBefore, sheetBefore, above: fixedBefore, outer: outerBefore });
          if (input === 'keyboard') {
            await page.evaluate('document.querySelector("#sheetBody .dp-reasons-more").focus({preventScroll:true})');
            await key(page, 'Enter');
          } else {
            const target = await page.evaluate(`(() => { const r = document.querySelector('#sheetBody .dp-reasons-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target] });
            await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
          }
          await waitFor(page, '!document.querySelector("#sheetBody .dp-reasons-more") && !document.getElementById("dayReasonsExtra").hidden');
          const expanded = await reasonProbe(), contentAfter = await contentProbe(), sheetAfter = await sheetGeometry();
          const fixedAfter = await rects(page, above), outerAfter = await rects(page, SHIFT);
          const geometry = {
            unchanged: same(sheetBefore, sheetAfter) && same(fixedBefore, fixedAfter) && same(outerBefore, outerAfter),
            sheet: { before: sheetBefore, after: sheetAfter,
              delta: { top: sheetAfter.top - sheetBefore.top, height: sheetAfter.height - sheetBefore.height } },
            aboveMoved: movedRects(fixedBefore, fixedAfter), outerMoved: movedRects(outerBefore, outerAfter),
          };
          check('partial-days', `${tag}: ${input} reveals all five reasons as content grows with sheet top, height and prior content exactly 0 px`,
            expanded.lines.length === 5 && same(expanded.lines.map(l => l.text), expected) && expanded.lines.every(l => l.visible) &&
            contentAfter.expanded > contentBefore.collapsed && !contentAfter.positionNotes.length &&
            !expanded.button && expanded.focused && expanded.live === 'polite' && !expanded.clipped && geometry.unchanged,
            { ...expanded, contentBefore, contentAfter, geometry });
          check('partial-days', `${tag}: ${input}-expanded growing five-reason content is below the 80vh cap and fits the reserved body without scrolling`,
            sheetAfter.height < expanded.sheet.cap && expanded.sheet.reservedHeight < expanded.sheet.cap &&
            contentAfter.expandedSheetHeight < expanded.sheet.cap && expanded.sheet.scrollHeight <= expanded.sheet.clientHeight,
            { ...expanded.sheet, content: contentAfter, sheetAfter });
          if (viewport.name === '360' && input === 'keyboard') await cropSheet(growingName + '-expanded', 'All five reasons revealed in place: content grows, sheet stays below cap without moving');
          await key(page, 'Escape');
        }
      }

      for (const [record, kind] of [[partial, 'legacy'], [filteredReasons, 'reasoned']]) {
        await replace(record, `${tag} ${kind} reason`);
        await click(page, '#deskSeg [data-desk="joe"]');
        for (const day of [partialTrade, today]) {
          await click(page, `#cal [data-day="${day}"]`);
          const layout = await noteLayout(reasonRoot);
          const expected = [
            ...(kind === 'legacy' ? day === today ? [] : [reason] : ['Result may be incomplete.', 'The trade history has a gap that covers this day.']),
            ...(kind === 'legacy' && day === today ? [] : [M.PARTIAL_DESK_NOTE]),
          ];
          const position = `${day === today ? 'Coca-Cola (KO, Joe), opened today at 11:15' : 'Bank of America (BAC, Joe), opened this day'}, is still open; it counts as Still open and on Desk.`;
          check('partial-days', `${tag}: filtered ${kind} partial ${day === today ? 'today' : 'closed day'} has exact order: explanation, desk scope, opened position`,
            same(layout.lines.map(N), expected.map(N)) && layout.position === position && layout.positionTag === 'P', { layout, expected, position });
          if (expected.length) await checkNoteGap(reasonRoot, `${tag} filtered ${kind} ${day}`);
          else check('partial-days', `${tag}: legacy today has only a positions paragraph`, !layout.reasonTag && layout.gap === null, layout);
          const name = `${viewport.name}-${theme}-results-partial-desk-filtered-${kind}-${day === today ? 'today' : 'closed'}`;
          if (viewport.mobile) { await viewShot(page, name, 'Partial explanation, whole-day scope, then the open Joe position'); await key(page, 'Escape'); }
          else await shot(page, viewport, name, 'Partial explanation, whole-day scope, then the open Joe position');
        }
        await click(page, '#deskSeg [data-desk="all"]');
      }
      await replace(todayWithoutReasons, `${tag} today without explicit reasons`);
      for (const desk of ['all', 'joe', 'j']) {
        await click(page, `#deskSeg [data-desk="${desk}"]`);
        await click(page, `#cal [data-day="${today}"]`);
        const detail = await page.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(reasonRoot)}); return {
          sum: root.querySelector('.dp-sum').innerText, note: root.querySelector('.dp-note')?.innerText ?? '',
          reasons: root.querySelectorAll('.dp-note-lines, .dp-note-lead, .dp-reason, .dp-desk-note').length,
          positions: [...root.querySelectorAll('.dp-position-note')].map(el => ({ tag: el.tagName, text: el.innerText })),
          noteCount: root.querySelectorAll('.dp-note').length }; })()`);
        const hasPosition = desk !== 'j';
        check('partial-days', `${tag}: today without explicit reasons under ${desk} has no reason note and only its optional position paragraph`,
          detail.sum === 'No trades so far' && detail.reasons === 0 && detail.noteCount === (hasPosition ? 1 : 0) &&
          same(detail.positions, hasPosition ? [{ tag: 'P', text: 'Coca-Cola (KO, Joe), opened today at 11:15, is still open; it counts as Still open and on Desk.' }] : []), detail);
        if (viewport.name === '360' && desk === 'all') await cropNoteView('#daySheet', `${viewport.name}-${theme}-results-partial-today-without-reasons-crop`, 'Today without explicit reasons: positions paragraph only');
        if (viewport.mobile) await key(page, 'Escape');
      }
      await click(page, '#deskSeg [data-desk="all"]');
      await replace(reasons, `${tag} today reason`);
      await click(page, `#cal [data-day="${today}"]`);
      const todayDetail = await page.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(reasonRoot)}); return { sum: root.querySelector('.dp-sum').innerText,
        note: root.querySelector('.dp-note').innerText, markers: document.querySelectorAll('#cal [data-day="${today}"] .day-warning').length }; })()`);
      check('partial-days', `${tag}: today keeps its known amount so far and reason without a Partial marker`,
        /so far/.test(todayDetail.sum) && !/Partial/.test(todayDetail.sum) && todayDetail.markers === 0 &&
        todayDetail.note.includes('The trade history has a gap that covers this day.'), todayDetail);
      await checkNoteGap(reasonRoot, `${tag} today with explicit reasons`);
      if (viewport.mobile) { await viewShot(page, `${viewport.name}-${theme}-results-partial-today-so-far`, 'Open Vienna day: exact known amount so far, without a Partial marker'); await key(page, 'Escape'); }
      else await shot(page, viewport, `${viewport.name}-${theme}-results-partial-today-so-far`, 'Open Vienna day: exact known amount so far, without a Partial marker');

      const todayDesk = reasons.trades.find(t => t.closedAt.startsWith(today)).desk;
      const emptyDesk = ['j', 'joe', 'joel'].find(d => d !== todayDesk);
      for (const emptyRow of [false, true]) {
        if (emptyRow) {
          await click(page, '#deskSeg [data-desk="all"]');
          await replace(emptyToday, `${tag} empty today row`);
        } else await click(page, `#deskSeg [data-desk="${emptyDesk}"]`);
        if (viewport.mobile) await click(page, `#cal [data-day="${today}"]`);
        const noTrades = await page.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(reasonRoot)}); return {
          sum: root.querySelector('.dp-sum').innerText, rows: root.querySelectorAll('.trow').length,
          markers: document.querySelectorAll('#cal [data-day="${today}"] .day-warning').length }; })()`);
        check('partial-days', `${tag}: today with ${emptyRow ? 'an empty-desk row' : 'no trades in the selected desk'} says No trades so far`,
          noTrades.sum === 'No trades so far' && noTrades.rows === 0 && noTrades.markers === 0, noTrades);
        const name = `${viewport.name}-${theme}-results-partial-today-${emptyRow ? 'no-trades' : 'empty-filtered'}`;
        if (viewport.mobile) { await viewShot(page, name, 'No trades so far on the open Vienna day'); await key(page, 'Escape'); }
        else await shot(page, viewport, name, 'No trades so far on the open Vienna day');
      }

    }
  }

  if (run('missing-days')) {
    // JOED-28: real ingress diagnostics through both read paths. The complete
    // and missing records share trade money, so geometry can be compared.
    await serve(null);
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme}`;
      const { board } = await designBoard('2026-10-16T12:00:00.000Z');
      const record = structuredClone(valid.results); delete record.receivedAt;
      record.generatedAt = board.clock();
      record.trades.push({ ...structuredClone(record.trades[0]), id: 'rt-missing-day',
        openedAt: '2026-10-15T15:00:00.000Z', closedAt: '2026-10-15T15:00:00.000Z' });
      // Fully covered baseline: JOED-30's separate scenario owns partial.
      record.days.push({ date: '2026-10-15', desks: structuredClone(valid.results.days[0].desks) });
      withTradeSummaries(record);
      check('missing-days', `${tag}: covered day accepts`, (await board.pushResults(record)).status === 200);
      const fallback = viewport.mobile && theme === 'dark';
      const injection = fallback ? await page.s('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.Worker = undefined;' }) : null;
      await configure(page, viewport, theme);
      await load(page, board.url, 'results');
      if (injection) await page.s('Page.removeScriptToEvaluateOnNewDocument', injection);
      await click(page, '#cal [data-day="2026-10-15"]');
      if (viewport.mobile) await key(page, 'Escape');
      const covered = await page.evaluate(RES), before = await rects(page, SHIFT);
      const coveredSummary = await page.evaluate('document.querySelector("#daypanel .dp-sum").textContent');
      check('missing-days', `${tag}: covered day has no warning`, !await page.evaluate('Boolean(document.querySelector("#cal .day-warning"))'));
      const missing = { ...structuredClone(record), seq: record.seq + 1 };
      missing.days = missing.days.filter(day => day.date !== '2026-10-15');
      check('missing-days', `${tag}: missing closed day accepts with 200`, (await board.pushResults(missing)).status === 200);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `Boolean(document.querySelector('#cal [data-day="2026-10-15"] .day-warning'))`);
      const warned = await page.evaluate(RES);
      const marker = await page.evaluate(`(() => {
        const cell = document.querySelector('#cal [data-day="2026-10-15"]');
        const mark = cell.querySelector('.day-warning'), r = mark.getBoundingClientRect(), c = cell.getBoundingClientRect();
        const padding = getComputedStyle(cell), offset = getComputedStyle(mark);
        const panel = document.getElementById('daypanel'), head = panel.querySelector('.dp-head').getBoundingClientRect();
        const heading = panel.querySelector('h3').getBoundingClientRect(), sum = panel.querySelector('.dp-sum'), s = sum.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0 && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom,
          aria: cell.getAttribute('aria-label'), icon: Boolean(mark.querySelector('use[href="#i-half"]')) && Boolean(document.querySelector('#daypanel .st.warn use[href="#i-half"]')),
          aligned: offset.top === padding.paddingTop && offset.right === padding.paddingRight,
          summary: sum.textContent, note: panel.querySelector('.dp-note')?.innerText ?? '', noteVisible: __audit.visible(panel.querySelector('.dp-note')),
          singleLine: head.height === 36 && s.height <= head.height && heading.right <= s.left && s.right <= head.right && getComputedStyle(sum).whiteSpace === 'nowrap' };
      })()`);
      check('missing-days', `${tag}: affected day shows the existing warning marker through ${fallback ? 'fallback' : 'worker'}`,
        marker.visible && marker.icon && /Stale: daily summary missing/.test(marker.aria) && N(marker.summary) === N(`Stale · ${coveredSummary}`) && !warned.status, marker);
      check('missing-days', `${tag}: warning icon follows the date padding`, marker.aligned, marker);
      if (!viewport.mobile) {
        check('missing-days', `${tag}: day panel keeps its single-line 36 px header and a visible reason`,
          marker.singleLine && marker.noteVisible && marker.note.includes('Daily summary missing'), marker);
      }
      check('missing-days', `${tag}: warning changes no trade amounts or outer geometry`,
        covered.display === warned.display && covered.cal.cells.find(c => c.day === '2026-10-15').v === warned.cal.cells.find(c => c.day === '2026-10-15').v &&
        !shifted(before, await rects(page, SHIFT), ['top', 'left', 'width', 'height']).length);
      await auditScreen(page, viewport, theme, 'results (missing daily summary)');
      await shot(page, viewport, `${viewport.name}-${theme}-results-missing-day`, 'Results: Stale on 15 October, whose daily summary is missing');
      if (viewport.mobile) {
        await click(page, '#cal [data-day="2026-10-15"]');
        const sheet = await page.evaluate(`(() => {
          const body = document.getElementById('sheetBody'), sum = body.querySelector('.dp-sum'), note = body.querySelector('.dp-note');
          return { summary: sum.textContent, trades: body.querySelectorAll('.trow').length,
            note: note?.innerText ?? '', noteVisible: __audit.visible(note),
            singleLine: getComputedStyle(sum).whiteSpace === 'nowrap' && sum.scrollWidth <= sum.clientWidth };
        })()`);
        check('missing-days', `${tag}: phone sheet retains the summary and trade with a visible missing-summary reason`,
          N(sheet.summary) === N(`Stale · ${coveredSummary}`) && sheet.trades === 1 && sheet.note.includes('Daily summary missing') && sheet.noteVisible && sheet.singleLine, sheet);
        await viewShot(page, `${viewport.name}-${theme}-results-missing-day-sheet`, 'Phone day sheet: Stale with the retained summary and missing daily summary reason');
      }
      const { nodes } = await page.s('Accessibility.getFullAXTree');
      const accessibleText = nodes.filter(n => !n.ignored && n.role?.value === 'StaticText').map(n => n.name?.value ?? '');
      check('missing-days', `${tag}: Stale and its reason are readable in the accessibility tree`,
        accessibleText.includes('Stale') && accessibleText.some(text => text.includes('Daily summary missing')), accessibleText.filter(text => /Stale|Daily summary missing/.test(text)));
      if (viewport.mobile) {
        await key(page, 'Escape');
      }
      await click(page, '#deskSeg [data-desk="joe"]');
      check('missing-days', `${tag}: a desk without trades on that date has no warning`, !await page.evaluate(`Boolean(document.querySelector('#cal [data-day="2026-10-15"] .day-warning'))`));
      await click(page, '#deskSeg [data-desk="all"]');
      const fixed = { ...record, seq: missing.seq + 1 };
      check('missing-days', `${tag}: a covered replacement accepts`, (await board.pushResults(fixed)).status === 200);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, '!document.querySelector("#cal .day-warning")');
      check('missing-days', `${tag}: subsequent full coverage clears the warning`, (await page.evaluate(RES)).day.sum === covered.day.sum);
      // A trade on today's open Vienna date remains silent even without a day.
      const open = { ...structuredClone(missing), seq: fixed.seq + 1 };
      open.trades.at(-1).openedAt = open.trades.at(-1).closedAt = '2026-10-16T10:00:00.000Z';
      check('missing-days', `${tag}: open date accepts`, (await board.pushResults(open)).status === 200);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.querySelector('#cal [data-day="2026-10-15"] .n').textContent === 'no trades'`);
      check('missing-days', `${tag}: open date has no warning`, !await page.evaluate('Boolean(document.querySelector("#cal .day-warning"))'));
    }
  }

  if (run('budget')) {
    // 7 · The Results render budget's CI guard (ADR §9; the reference budget is
    // measured on a reference device by scripts/budget-reference.mjs).
    budgetTrace = await runResultsBudget({ page, newBoard, check, limits: CI_GUARD, serve: async (body, board) => { await serve(served(body, board)); return () => serve(null); } });
  }
  if (process.env.TZ) check('host-timezone', 'dedicated workers use the requested host zone',
    page.workerTimeZones.length > 0 && page.workerTimeZones.every(zone => zone === expectedTimeZone),
    { workerTimeZones: page.workerTimeZones, expectedTimeZone });
} finally {
  await browser.close();
  for (const b of boards) await b.close();
}

const failed = results.filter(r => !r.ok);
const byAc = new Map();
for (const r of results) { const e = byAc.get(r.ac) ?? { pass: 0, fail: 0 }; e[r.ok ? 'pass' : 'fail']++; byAc.set(r.ac, e); }
const lines = [...byAc].sort().map(([ac, e]) => `| ${ac} | ${e.pass} | ${e.fail} |`);
const px = value => value === undefined ? 'missing' : String(Number(value.toFixed(3)));
const phoneWidthRows = [];
for (const theme of THEMES) for (const form of new Set(phoneMeasurements.filter(m => m.theme === theme).map(m => m.text))) {
  const at = width => phoneMeasurements.find(m => m.theme === theme && m.text === form && m.viewport === width);
  const narrow = at('360'), wide = at('390');
  phoneWidthRows.push(`| ${theme} | ${form} | ${narrow?.info ? 'INFO only' : 'asserted'} | ${px(narrow?.px115)} / ${px(wide?.px115)} | ${px(narrow?.px10)} / ${px(wide?.px10)} | ${px(narrow?.width)} / ${px(wide?.width)} | ${narrow?.client ?? 'missing'} / ${wide?.client ?? 'missing'} |`);
}
const phoneWidthReport = phoneMeasurements.length ? `## Phone calendar measurements (JOED-29)

Each signed form and unsigned 0 is measured inside a real phone cell in this
browser, at 11.5 px and 10 px. Width pairs below are **360 / 390**; the amount
box width is fractional (getBoundingClientRect), with clientWidth shown
separately. Phone cells have 3 px horizontal padding. Gains and losses are
separate rows. The full asserted set is ±1, ±4,1, ±13, ±123, ±999, ±1k,
±1,2k, ±12k, ±1M, ±1,2M, ±9,9M, ±0,1M, ±0,1B, ±1,2B, ±1,2T, ±1B,
±1T, ±1e15 and unsigned 0. Both signed 999k probes are INFO only and never
asserted: the unchanged formatter emits 1M for € 999.000.
Scaled forms use 10 px; actual forms must fit the fractional box and satisfy
scrollWidth ≤ clientWidth. A form that exceeds the fractional box at 11.5 px
must use the 10 px step-down. A failure retains day, text, fractional box and
ink widths, scrollWidth, clientWidth and both measured sizes.

| Theme | Form | Check | Width at 11.5 px (360 / 390) | Width at 10 px (360 / 390) | Fractional box width (360 / 390) | clientWidth (360 / 390) |
| --- | --- | --- | --- | --- | --- | --- |
${phoneWidthRows.join('\n')}

${phoneTapInfo.map(info => `- INFO tap geometry (no assertion): ${JSON.stringify(info)}`).join('\n')}
` : '';
if (phoneWidthReport) console.log(phoneWidthReport);
writeFileSync(join(QA_DIR, 'index.md'), `# JoeDesk P4 · Results · browser gate screenshots (JOED-24)

Generated by \`node scripts/browser-p4.mjs\` against the real board server with
an injected clock (Wed 14 Oct 2026, 19:42:31 Vienna; the Vienna-date views use
Thu 1 Apr 2027), the P3 test-only scenario for state, history and fleet
settings, and the closed-trade record served in the results v2 contract's
served form: a deterministic test-only design record and the reviewed
fixtures in \`fixtures/results/\`. JOED-27's ingress cases use real machine
pushes and protected reads, then advance the injected clock to stale at 60 s;
before the first push the feed says no data received yet. One
headless browser, run sequentially; reduced motion for stable geometry.
Host and browser time zone: ${expectedTimeZone}; dedicated worker zones are checked too.
Compare with \`joed-19-joedesk-approved.html\` (Results).

## For the visual check

- **Hero chart scale.** The chart is zero-based (r3.1, AC-46) and also keeps
  §4.7's minimum span, at least ±0,5 % of the desks' money at the period
  start (AC-17): about ±€ 75 for all desks, ±€ 25 for one. A week of +€ 23
  therefore uses part of the height instead of all of it; a few euros never
  look like a crash. The zero line is the period-start line.
- **Hero layout.** The split and the benchmark line sit at the bottom of the
  hero, the sentence under the number; a sentence of one, two or three lines
  never moves a number (wide font included).
- **Best and worst trade** name each trade by symbol and desk ("UBER (Joel)")
  rather than the company, so a long company name can never clip the tile.
- **Calendar.** US market holidays read "closed", like weekends. Weeks still
  ahead show no sum. A day before tracking shows only its date. A day's
  amount always fits its cell, rounded once: desktop "4,10", "123", "12k",
  "1,2M"; phones "1", "4,1", "123", "1k", "1,2k", "1M", "0,1M" (scaled
  forms at 10 px, with no trailing ",0"). Phone day cells have no arrows;
  their sign and tint carry direction. A phone amount rounded to zero
  has no sign and keeps its day tint; exactly zero stays flat.
  The cell's label and the day's trades give the exact amount
  (\`*-results-large-amounts.png\`). JOED-29's focused calendar screenshots at
  360/390 in light/dark are \`*-results-phone-calendar.png\`: October crops
  with ±1,2M (±€ 1.200.000), a gain, loss, zero, k and the missing-day warning
  on 13 October; the 1440 light crop shows the same month with its original
  desktop arrows. August and September add the full signed form set, with
  ±999k measured as INFO only. Amount changes, month changes and closing a settled
  open sheet must move geometry exactly 0 px. The tap's own movement is INFO.
- **Partial coverage (JOED-30).** The dedicated \`partial-days\` scenario uses
  real ingress at 1440/1024/390/360, light and dark, through the worker and
  fallback. October shows yesterday (15th) as Partial, missing-summary Stale
  on the 13th, Stale-escalated partials on the 11th/14th, a normal 12th and
  open today (16th) with no marker. A separate accepted snapshot makes the
  15th unattributed-only: T+1 allows only yesterday to remain Partial. \`*-results-partial-days.png\` captures the
  month; \`*-results-partial-{trade,empty}-{panel,sheet}.png\` captures each
  partial summary and its info-note reason. The partial replacement must
  preserve trade amounts, totals and geometry exactly; all cells and detail
  summaries must satisfy scrollWidth ≤ clientWidth. Both theme token sets
  get computed icon contrast checks for every tint (≥ 3:1), including neutral.
  A missing-summary Stale hands off to Partial at 0 px. Desktop month hints
  count every closed partial date, including Stale-escalated dates; today and
  missing-summary Stale never count. They hide on phones and never clip.
  Worst-case 99-trade summaries preserve Partial, exact money and “so far”
  at every width; the count yields first. The general audit runs only on
  standard viewports, while 360 keeps every focused assertion. Rev-5 crops
  \`*-results-partial-nine-reasons-panel.png\` show all eight displayed sentences
  (nine codes with FX dedup); phones use
  \`*-results-partial-nine-reasons-{collapsed,expanded}.png\`. Keyboard and pointer
  reveals remove the 44 px button, politely announce and focus the first revealed
  reason, and move the sheet top, height and prior content exactly 0 px. The
  pointer case uses a real touch tap after reopening collapsed. A one-reason
  sheet must be shorter than the nine-code sheet. A five-reason day without
  position sentences proves content grows below the 80vh cap at 360/390 in both
  themes; Enter and real touch preserve sheet, prior content and outer geometry
  exactly. Its 360 crops are \`360-*-results-partial-growing-reasons-{collapsed,expanded}.png\`.
  The reason/desk block and position note must be sibling paragraphs exactly
  8 px apart in every variant, before and after reveals. Extra crops are
  \`1440-*-results-partial-empty-panel-crop.png\`,
  \`360-*-results-partial-nine-reasons-expanded-crop.png\` and
  \`360-*-results-partial-today-without-reasons-crop.png\`. Today without explicit
  reasons has no reason/desk note under All, Joe or J; only a matching open
  position keeps a note. Explicit reasons keep their lead and sentences.
  Other crops cover
  \`*-results-partial-{single-reason,counted,desk-filtered,today-so-far,today-no-trades,today-empty-filtered}.png\`.
- **Hero chart time axis** (fix round 1). The x axis is real time: each close
  sits at the end of its Vienna date, today's money at now; missing dates keep
  their width, and a session without a close in the record breaks the line
  (\`*-results-time-axis.png\`). Before tracking the line is zero by definition.
- **A change of bookkeeping basis** (fix round 1) is said as such: across it
  there is no result, dip or line, only the sentence "No result this week:
  J’s bookkeeping basis changed on Wed 14 Oct, and a change of basis is not a
  gain or a loss." Closed-trade numbers and the other desks stand
  (\`*-results-basis-change.png\`).
- **Desk card at 390** (P3 follow-up): "Checked in … ago" sits right-aligned on
  the name row; the state has the row below. The same holds for any card
  narrower than 340 px (two-column widths).

## Acceptance criteria → tests

| AC | Browser (this gate) | Node (\`test/results-model.mjs\`) |
| --- | --- | --- |
| AC-10 switches drive every number; period only in the stepper and the two headings | \`AC-10\`: every period × desk at six combos and every step, against the model | \`periods\` |
| AC-11 no layout shift (±0.5 px) | \`AC-11\`: switches, steps, month arrows, day selection; wide font at 390/1024/1440 | — |
| AC-12 §4.2 exactly | \`AC-12\`: scratches, no losers, drawdown fixtures as shown | \`win rate with scratches\`, \`profit factor with no losers\`, \`drawdown\` (Day intraday), \`empty period\`, \`net, realised, …\`, \`decimal\`, \`fx\` |
| AC-13 By desk J, Joe, Joel, Total; chosen row tinted | \`AC-13\` | \`by desk\` (desks add up to the total) |
| AC-14 6 rows; day states and tints; sign + tint, desktop/week arrows | \`AC-14\` (three months, plus the Vienna-date months) | \`calendar\` |
| AC-15 a day shows exactly its trades; phones open the sheet | \`AC-15\` (panel; sheet, Escape, ×, focus back) | \`calendar\` (rows = count, oldest first) |
| AC-16 designed empty/unavailable states | \`AC-16\` (empty record, August before tracking, no push received) | \`empty period\`, \`read\` |
| AC-17 / AC-46 chart to scale; zero-based; legend and tip | \`AC-17\`, \`AC-46\`, \`AC-41\` (opaque tip) | \`hero chart\` |
| AC-9 / KEEP excluded | \`AC-9\` (no kept symbol on Results; a record trading a kept symbol is held back) | \`kept holdings\` |
| Vienna dates (ADR deferred P4 row) | \`vienna\` | \`vienna dates\` |
| Panel states of the record | \`panel-state\` (stale, refresh failed, sign-in, rejected record) | \`read\` |
| Part A craft on Results | AC-1, 2, 5, 28–30, 32, 33, 36, 38, 40, 42–44, 47 (\`auditScreen\`) | — |
| P3 follow-up: desk card at 390 | \`P3-follow-up\`, \`AC-30\` | — |
| ADR §9 budget | \`budget\` (CI guard) | — |
| Fix round 1 · High: a change of bookkeeping basis is never a result | \`r1-basis\` (every period × desk: no result, dip or line across J's change, the change said; Joe and Joel stand) | \`basis: …\` |
| Fix round 1 · today's money only from the snapshot | \`r1-money-now\` (J without money now; the record's close for today never stands in) | \`today’s money: …\` |
| Fix round 1 · Week/Month by period kind | \`AC-10\` (the model's period kind, on every switch) | \`period kind decides: …\` |
| Fix round 1 · real time axis | \`r1-time-axis\` (every drawn point at its own time; the missing sessions a break) | \`hero chart: a real time axis …\`, \`hero chart\` |
| Fix round 1 · exact money at any size | \`r1-exact\` (€ 100.000,12345678 trades: tiles, split, calendar, labels) | \`money: exact …\`, \`calendar amounts: …\` |
| Fix round 1 · equal days are two days | \`r1-days\` | \`best and worst day: …\` |
| JOED-29 phone amounts, 10 px floor, no clipping and 0 px shift | \`phone-calendar\` (360/390, both themes; measurements below; desktop glyph crop) | \`JOED-29 calendar rendering: …\` |

## Checks

| Criterion | Passed | Failed |
| --- | --- | --- |
${lines.join('\n')}

${failed.length ? `### Failures\n\n${failed.map(f => `- ${f.ac} ${f.name}: \`${JSON.stringify(f.detail)?.slice(0, f.ac === 'phone-calendar' ? undefined : 300)}\``).join('\n')}\n` : 'All checks passed.\n'}
${phoneWidthReport}
## Render budget (ADR §9)

This run: ${reference}. Held here: the ${CI_GUARD.name} (a Results render at
most ${CI_GUARD.patchMs} ms, no task reaching ${CI_GUARD.taskMs} ms). The ${REFERENCE_BUDGET.name}
itself (under ${REFERENCE_BUDGET.patchMs} ms, no task reaching ${REFERENCE_BUDGET.taskMs} ms) is measured on a
reference device by \`node scripts/budget-reference.mjs\`.

${budgetTrace ? resultsBudgetTable(budgetTrace, CI_GUARD) : 'Not run.\n'}
## Screenshots (\`<viewport>-<theme>-<surface>.png\`)

${shots.map(s => `- \`${s.file}\` — ${s.what}`).join('\n')}
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
process.exit(failed.length ? 1 : 0);
