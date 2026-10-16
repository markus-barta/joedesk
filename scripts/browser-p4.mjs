#!/usr/bin/env node
// P4 browser gate: Results against results v2 fixtures, through the real board
// server (state, history, fleet settings) with the closed-trade record served
// as the contract's served form, at 390/1024/1440 in light and dark
// (AC-10–17, 41, 42, 46, Part A craft), plus Tick's desk-card header at 390.
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
import { designResults } from './browser/results.mjs';

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

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p4');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const { results, shots, check, shot, auditScreen } = createGate(QA_DIR);
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
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13 });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: name === 'Escape' ? 27 : 13 });
  await settle(page);
};

const browser = await launch({ hostRules: 'MAP joedesk.example.test 127.0.0.1' });
const engine = await browser.send('Browser.getVersion');
const reference = `${engine.product} (headless, ${process.platform} ${process.arch}), ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, Node ${process.version}`;
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: AUDIT });
const boards = [];
async function newBoard(options) { const b = await startBoard(options); boards.push(b); return b; }
let budgetTrace = null;

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
      await load(page, board.url, 'results');
      const nw = await page.evaluate(RES);
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
      check('panel-state', `${tag}: a record received 5 min ago says so in the chart's box and keeps its numbers`, /^Results as of 5.min ago · updates are late\.$/.test(stale.status) && stale.display === fresh.display &&
        !shifted(freshRects, await shiftOf(), ['top', 'left', 'height']).length, { status: stale.status, display: [fresh.display, stale.display] });
      if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-results-stale`, 'Results, the record received 5 min ago: its age and reason in the chart box');
      await serve(() => ({ fail: 'ConnectionRefused' }));
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `/refresh failed/.test(document.getElementById('resStatus').innerText)`);
      await settle(page);
      const kept = await page.evaluate(RES);
      check('panel-state', `${tag}: a failed refresh keeps the last good record and says so`, /^Results refresh failed: update failed\. Showing the last good results from \d+.(s|min) ago\.$/.test(kept.status) && kept.display === fresh.display, kept.status);
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
      check('vienna', `${tag}: each trade is on its Vienna date (15, 25, 27, 28 Oct; two on 1 Nov; 16 and 31 Mar)`,
        has('October 2026', '2026-10-15', 1) && !has('October 2026', '2026-10-14', 1) && has('October 2026', '2026-10-25', 1) && has('October 2026', '2026-10-27', 1) && has('October 2026', '2026-10-28', 1) &&
        has('November 2026', '2026-11-01', 2) && has('March 2027', '2027-03-16', 1) && has('March 2027', '2027-03-31', 1),
        Object.fromEntries(Object.entries(months).map(([k, v]) => [k, v.filter(c => /trade/.test(c.aria)).map(c => [c.day, c.aria])])));
      for (const title of Object.keys(months)) {
        const faults = calendarFacts({ cal: { cells: months[title], slots: 42, weeks: 6 } }, ix, DESKS, '2027-04-01', ix.meta.trackingStart);
        check('AC-14', `${tag} ${title}: every day's state follows the record`, !faults.length, faults.slice(0, 4));
      }
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
        /^Results as of 1.min ago · updates are late\.$/.test(stale.status) && stale.display === live.display &&
        !shifted(before, await rects(page, SHIFT), ['top', 'left', 'height']).length, stale.status);
      if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-ingress-stale`, 'Results stale 60 seconds after its last accepted push');
      const bad = structuredClone(record); bad.seq++; bad.generatedAt = board.clock(); bad.trades[0].netEur.amount = '999';
      const rejected = await board.pushResults(bad);
      check('results-ingress', `${viewport.name} ${theme}: a bad pushed record is rejected with 422`, rejected.status === 422, rejected);
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

  if (run('budget')) {
    // 7 · The Results render budget's CI guard (ADR §9; the reference budget is
    // measured on a reference device by scripts/budget-reference.mjs).
    budgetTrace = await runResultsBudget({ page, newBoard, check, limits: CI_GUARD, serve: async (body, board) => { await serve(served(body, board)); return () => serve(null); } });
  }
} finally {
  await browser.close();
  for (const b of boards) await b.close();
}

const failed = results.filter(r => !r.ok);
const byAc = new Map();
for (const r of results) { const e = byAc.get(r.ac) ?? { pass: 0, fail: 0 }; e[r.ok ? 'pass' : 'fail']++; byAc.set(r.ac, e); }
const lines = [...byAc].sort().map(([ac, e]) => `| ${ac} | ${e.pass} | ${e.fail} |`);
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
  "1,2M"; phones "4,1", "123", "1,2k", "0,1M" (scaled forms a step smaller).
  The cell's label and the day's trades give the exact amount
  (\`*-results-large-amounts.png\`).
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
| AC-14 6 rows; day states and tints; sign + arrow + tint | \`AC-14\` (three months, plus the Vienna-date months) | \`calendar\` |
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

## Checks

| Criterion | Passed | Failed |
| --- | --- | --- |
${lines.join('\n')}

${failed.length ? `### Failures\n\n${failed.map(f => `- ${f.ac} ${f.name}: \`${JSON.stringify(f.detail)?.slice(0, 300)}\``).join('\n')}\n` : 'All checks passed.\n'}
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
