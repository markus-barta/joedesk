// Desk's first block: the whole IB paper account, kept holdings included, in
// EUR (the account's base currency). Its value is the largest number on Desk;
// below it the change over the chosen range, Since start from the account
// start set in Settings, Cash and the kept holdings in their own currencies,
// then a stock-app chart (1D to All) of what the board server recorded, with
// History's natural input and, on wider screens, an overview strip.
// Read-only: nothing here can trade, and kept holdings are never actionable.
import { $, $$, icon, term, bn, statePhrase, patch, dashWords, moneyNoWrap, NOT_EXACT } from './ui.js';
import { esc, money, digits, dayDM, dayDDM, timeHM, age, MINUS, NB, cashAmount } from './format.js';
import { decimalUnits } from './contracts/decimal.mjs';
import { cellReason, capital } from './health.js';
import { outageValue, trustedCurrent, NOT_EXACT_REASONS } from './board-state.js';
import { accountStart, boardSettingsState } from './board-settings.js';
import { drawChart, chartAxis, chartDots, axis, eurAxis, overviewTargets, createWheelLatch, wheelPixels, wheelZoomFactor, chartHintSeen, dismissChartHint, createAxisMode } from './chart.js';
import { panWindow, zoomWindow, placeWindow, endsAtNewest, atLiveEdge, easeOut, lerpWindow, toStrip, fromStrip } from './history-model.js';
import { zonedInstant, VIENNA } from './time.mjs';
import * as M from './account-model.js';
import { readJSON, readFailure, boardSession } from './transport.js';

const TONE_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
const MIN = 60e3;
// The chart's state: the chosen range, a window the viewer moved (null while
// a range shows) and whether it follows the newest value. full and shown are
// the loaded range and the window drawn last, for the input below.
export const AS = { range: '1M', view: null, follow: true, details: false, full: null, shown: null };
// The account history as last read: the accepted series (kept through failed
// reads), why the last read failed, and when to read again.
const store = { value: null, reason: 'loading', loadedAt: null, key: null, version: 0, busy: false, next: 0 };
const READ_MS = 60000, RETRY_MS = 15000, TIMEOUT_MS = 15000;
const phone = () => matchMedia('(max-width: 480px)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => matchMedia('(pointer: coarse), (max-width: 700px)').matches;
// A sign never splits from its amount (JOED-152): moneyNoWrap (ui.js) for
// money, this for a percentage.
const nw = html => `<span class="nowrap">${html}</span>`;
const units = value => { try { return typeof value?.amount === 'string' && typeof value.currency === 'string' ? decimalUnits(value.amount) : null; } catch { return null; } };
const plain = html => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
const startDate = date => `${dayDM(zonedInstant(date, '12:00:00', VIENNA))} ${date.slice(0, 4)}`;
const startMoney = start => { const cents = Math.round(start.amountEur * 100); return moneyNoWrap(BigInt(cents) * 1000000n, 'EUR', false, cents % 100 ? 2 : 0); };
// A plain link: the router (route.js) opens Settings at the account start.
const settingsLink = words => `<a class="set-link" href="#settings/set-account">${words}</a>`;

// The vertical axis, every time chart's (JOED-154, chart.js): Auto fits the
// shown window and glides with every move, Max holds everything loaded (the
// store drawn: snapshots or daily closes), Custom is the viewer's own bottom
// and top in euros. One choice for this chart, 'account', remembered per
// viewer in this browser; Controls offers it.
const yAxis = createAxisMode('account');
export const accountAxis = () => yAxis;

// The first-visit hint under the chart is every chart's (chart.js): shown
// until the first drag, zoom or key on any chart, then never again in this
// browser (JOED-154's chartHintSeen and dismissChartHint).

// ---------- The figures ----------
// The value, or a dash with the reason. A value that is not current and
// exact keeps its state words in the change line, never shown as current.
export function valueHtml(cell) {
  const n = cell?.value?.currency === 'EUR' ? units(cell.value) : null;
  if (n === null) {
    const words = `Whole account: ${dashWords(cell?.reason ?? (cell?.state === 'not reported' ? 'feed_not_received' : null))}`;
    return `<span class="bn muted" role="img" title="${esc(words)}" aria-label="${esc(words)}">—</span>`;
  }
  return bn(n, 'EUR', false);
}
// The value's own state when it is not current and exact, in one line.
export function stateLine(cell) {
  if (trustedCurrent(cell)) return null;
  const p = statePhrase(cell, 'acct.value', 'last good value');
  const text = capital(p.text || 'not available');
  return { tone: p.tone, icon: p.icon ?? TONE_ICON[p.tone], html: text, text: plain(text) };
}
// The change over the window: arrow, signed amount, percent and the range,
// or the words for what the window covers when it is not a whole range.
export function changeHtml(change, chip, chipTitle) {
  const tag = `<span class="acct-rng mono" title="${esc(chipTitle)}">${esc(chip)}</span>`;
  if (!change) return `<span class="acct-delta"><span class="bn muted">—</span>${tag}</span>`;
  const tone = change.change > 0n ? 'gain' : change.change < 0n ? 'loss' : '';
  return `<span class="acct-delta">${bn(change.change, 'EUR', true)}<span class="acct-pct ${tone}">${nw(M.pctText(change.pct))}</span>${tag}</span>`;
}
// Since start, against the account start in Settings. Until it is set the
// board shows no figure and says where to set it.
function sinceParts(cell, start, settings) {
  const n = trustedCurrent(cell) ? units(cell.value) : null;
  if (!start) {
    const reason = settings?.reason;
    const words = reason === 'loading' ? 'Account start loading' : reason === 'refresh_failed' ? 'Account start could not be checked'
      : ['invalid', 'unreadable'].includes(reason) ? 'Account start unreadable' : 'Account start not set';
    const link = reason === 'loading' ? '' : ` · ${settingsLink(reason === 'refresh_failed' ? 'open Settings' : 'set in Settings')}`;
    return { wide: `${words}${link}`, narrow: `${words}${link}`, detail: '' };
  }
  const since = M.sinceStart(n, start);
  const tone = since ? since.change > 0n ? ' gain' : since.change < 0n ? ' loss' : '' : '';
  const amount = since ? moneyNoWrap(since.change, 'EUR', true) : '—', pct = since ? nw(M.pctText(since.pct)) : '';
  const basis = `${startMoney(start)} on ${esc(startDate(start.date))}`;
  return { wide: `Since start (${basis}): <b class="acct-fig${tone}">${amount}</b>${pct ? ` · <b class="acct-fig${tone}">${pct}</b>` : ''}`,
    narrow: `Since start <b class="acct-fig${tone}">${amount}</b>${pct ? ` <b class="acct-fig${tone}">(${pct})</b>` : ''}`,
    detail: `Start: <b>${basis}</b> · ${settingsLink('change in Settings')}` };
}
// Desk's Cash (JOED-49), as the broker reports it: two decimals, the broker's
// exact lexeme in the title and accessible name, and Desk's dash rules. A
// missing Cash names its reason once ("no data received yet" when none came),
// a not-exact one "not exact" (JOED-148), and Cash an outage kept
// is withheld (JOED-91). A reason the account value shares is said once, in
// the change line; the name always carries it.
export function cashPart(cash, shared = null) {
  const value = cash?.state === 'broken' && cash.retained ? null : cash?.value ?? null;
  const n = value ? units(value) : null;
  const reason = cash?.reason ?? (n === null ? 'feed_not_received' : null);
  const why = reason ? cellReason(reason) : '', own = reason && reason !== shared ? why : '';
  let shown, name;
  if (n !== null) {
    shown = `<b>${moneyNoWrap(n, value.currency)}</b>${own ? ` · ${esc(own)}` : ''}`;
    name = `${cashAmount(value).title}${cash?.reason ? ` · ${why}` : ''}`;
  } else if (NOT_EXACT_REASONS.has(cash?.reason)) {
    shown = `<b class="muted">—</b> · ${NOT_EXACT}${own && own !== NOT_EXACT ? ` · ${esc(own)}` : ''}`;
    name = `Cash: ${dashWords(cash.reason)}`;
  } else {
    shown = `<b class="muted">—</b>${own ? ` · ${esc(own)}` : ''}`;
    name = `Cash ${dashWords(reason)}`;
  }
  return `<span class="acct-cash" data-cash="acct.cash" data-state="${esc(cash?.state ?? 'not reported')}" role="group" title="${esc(name)}" aria-label="${esc(name)}">Cash ${shown}</span>`;
}
// Each kept holding in the currency the feed carries it in, never converted.
// Plain text: nothing about a kept holding can be acted on.
export function keptWorth(kept, shared) {
  const rows = kept?.value;
  const own = kept?.reason && kept.reason !== shared ? ` · ${esc(cellReason(kept.reason))}` : '';
  if (!rows || outageValue(kept)) return { html: `<b>—</b>${own}`, rows: null };
  const list = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(r => {
    const n = units(r.marketValue);
    return `<b class="nowrap">${esc(r.symbol)} ${n === null ? '—' : esc(money(n, r.marketValue.currency))}</b>`;
  });
  return { html: list.join(' · '), rows: rows.length };
}
export function subParts(ctx, start = accountStart(), settings = boardSettingsState()) {
  const cell = ctx.states.paperAccount, shared = cell?.reason ?? null;
  const since = sinceParts(cell, start, settings), cash = cashPart(ctx.states.paperCash, shared), kept = keptWorth(ctx.states.kept, shared);
  const sep = '<span class="acct-sep" aria-hidden="true"></span>';
  const keptWide = kept.rows === 0 ? 'no kept holdings in this snapshot' : `incl. kept holdings ${kept.html}${kept.rows ? ', each in its own currency' : ''}`;
  const keptDetail = kept.rows === 0 ? 'No kept holdings in this snapshot.' : `Kept holdings, each in its own currency: ${kept.html}. They count only in this whole-account figure.`;
  return {
    wide: `<span class="acct-item">${since.wide}</span>${sep}<span class="acct-item">${cash}</span>${sep}<span class="acct-item">${keptWide}</span>`,
    narrow: `<span class="acct-item">${since.narrow}</span> · <span class="acct-item">${cash}</span>`,
    details: `<p>${keptDetail}</p>${since.detail ? `<p>${since.detail}</p>` : ''}`,
  };
}

// ---------- The account history ----------
// Read by a worker (account-worker.js) that parses and checks it off the
// main thread and hands over compact columns; without module workers, or
// when the worker fails or does not answer, the same read and checks run
// here (the worker's life is below, at `reader`). A failed read
// keeps the last good series and says why. The worker is started on the
// first read, under this release's own path, as feed.js starts History's.
const timing = (reason, ms) => {
  const list = globalThis.__joedesk?.timings;
  if (!Array.isArray(list) || !Number.isFinite(ms)) return;
  list.push({ reason, ms, at: performance.now() });
  if (list.length > 200) list.shift();
};
const read = readJSON;
// Takes an endpoint body read on the page; on a refused one the last good series stays.
export function useAccountHistory(body, at = performance.now()) {
  try {
    store.value = M.acceptAccountHistory(body);
    store.reason = null; store.loadedAt = at; store.key = null; store.version++;
    return true;
  } catch { store.reason = 'contract_invalid'; return false; }
}
// A worker's or the page's reply; returns whether the history is current.
function useReply(reply) {
  if (!boardSession.accept('/joe/account-history.json', { auth: reply?.reason === 'auth_required' ? true
    : reply?.kind === 'unchanged' || reply?.status === 200 || reply?.value ? false : undefined })) return false;
  if (reply?.kind === 'unchanged' && store.value) { store.reason = null; store.loadedAt = performance.now(); return true; }
  if (reply?.kind === 'account' && reply.value) {
    Object.assign(store, { value: reply.value, reason: null, loadedAt: performance.now(), key: reply.key ?? null, version: store.version + 1 });
    return true;
  }
  store.reason = reply?.reason ?? 'refresh_failed';
  return false;
}
// The read worker's life. It starts on the first read. One that times out or
// fails is terminated, never posted to again, and that read goes to the page
// at once. The next read tries one new worker; after a second failure (or
// without module workers) the page reads for the rest of the session.
const reader = { worker: null, failures: 0, waiting: null, reading: null };
const WORKER_TRIES = 2;
// Each worker fails once, however many errors it reports.
function dropWorker(w) {
  if (reader.worker !== w) return;
  reader.worker = null;
  reader.failures++;
  try { w.terminate(); } catch { /* already gone */ }
}
function startWorker() {
  if (reader.worker || reader.failures >= WORKER_TRIES) return reader.worker;
  const version = globalThis.JoeVersion?.APP_VERSION;
  if (!version || typeof Worker !== 'function') { reader.failures = WORKER_TRIES; return null; }
  try {
    const w = new Worker(new URL(`./v/${encodeURIComponent(version)}/account-worker.js`, import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => { if (reader.worker !== w) return; const done = reader.waiting; reader.waiting = null; done?.(data); };
    // A failure during a read ends that read (refresh drops the worker);
    // one between reads drops it now.
    w.onerror = () => { if (reader.worker !== w) return; const done = reader.waiting; reader.waiting = null; if (done) done(null); else dropWorker(w); };
    reader.worker = w;
  } catch { reader.failures = WORKER_TRIES; reader.worker = null; }
  return reader.worker;
}
async function readOnPage() {
  const started = performance.now(), res = await read('./account-history.json');
  if (res.status !== 200) return { kind: 'account', status: res.status, reason: readFailure(res), value: null };
  try {
    const value = M.acceptAccountHistory(res.payload);
    timing('account-accept', performance.now() - started);
    return { kind: 'account', status: 200, reason: null, value };
  } catch { return { kind: 'account', status: 200, reason: 'contract_invalid', value: null }; }
}
// One read at a time: a read asked for while one runs is that read, so no
// reply can go to the wrong caller (and leave a healthy worker timed out).
function refresh() {
  if (!reader.reading) {
    const now = readHistory().finally(() => { if (reader.reading === now) reader.reading = null; });
    reader.reading = now;
  }
  return reader.reading;
}
async function readHistory() {
  store.busy = true;
  const w = startWorker();
  let reply = null;
  if (w) {
    let guard;
    // The worker's own read gives up after TIMEOUT_MS; this guard catches a
    // worker that never answers at all. A refused post fails it at once.
    reply = await Promise.race([
      new Promise(resolve => {
        reader.waiting = resolve;
        try { w.postMessage({ read: 'account', have: store.value ? store.key : null }); } catch { resolve(null); }
      }),
      new Promise(resolve => { guard = setTimeout(() => resolve(null), TIMEOUT_MS + 5000); }),
    ]);
    clearTimeout(guard); reader.waiting = null;
    if (reply) timing('account-worker', reply.ms);
    else dropWorker(w);
  }
  // No worker, or it timed out or failed: this same read runs on the page.
  const ok = useReply(reply ?? await readOnPage());
  store.busy = false;
  store.next = performance.now() + (ok ? READ_MS : RETRY_MS);
  if (last.ctx) renderAccount(last.ctx);
}
export const forgetAccountHistory = () => Object.assign(store, { value: null, reason: 'loading', loadedAt: null, key: null, version: store.version + 1, busy: false, next: 0 });
// Read now (a retry, the budget run, a test), whatever the schedule says.
export const refreshAccountHistory = () => refresh();
// Forget the worker and its failures (tests): the next read starts a new one.
export const forgetAccountWorker = () => {
  try { reader.worker?.terminate?.(); } catch { /* already gone */ }
  Object.assign(reader, { worker: null, failures: 0, waiting: null, reading: null });
};
// The live value at the end of the chosen source, kept per series and value.
const merged = { key: null, series: null };
function seriesFor(source, live) {
  const base = store.value?.[source] ?? M.emptySeries(source);
  const key = `${store.version}|${source}|${live?.t ?? ''}|${live?.amount ?? ''}`;
  if (merged.key !== key) { merged.key = key; merged.series = M.withLive(base, live); }
  return merged.series;
}
// One plain line under the chart about the history shown, or ''. A failed
// read leads, then the store's own state, then a range longer than the record.
function noteText(series, source, now) {
  if (store.reason && store.reason !== 'loading') {
    const why = store.reason === 'contract_invalid' ? 'the history could not be checked' : cellReason(store.reason);
    return store.value ? `Update failed · showing what loaded ${age((performance.now() - store.loadedAt) / 1000)} ago` : `History unavailable · ${why}`;
  }
  return M.storeNote(series) || M.recordingText(M.coverage(series, AS.range, now), source, now);
}
function emptyText(series) {
  if (store.reason === 'loading' && !store.value) return 'Loading the account history';
  if (!store.value) return 'Account history unavailable';
  return series.t.length ? 'No value recorded yet' : 'Nothing recorded yet';
}

// ---------- The chart ----------
// The chart's and the strip's sizes come from a ResizeObserver, so a Desk
// update never asks the browser for layout. Without one (or before its first
// report) an element's own size is read, as a draw does anyway. A size the
// chart was not drawn at draws it again.
const sizes = new WeakMap();
let watched = null;
function watchSizes() {
  watched?.disconnect();
  watched = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) sizes.set(target, { w: Math.round(contentRect.width), h: Math.round(contentRect.height),
      ...(target.id === 'acctTrack' ? { off: target.offsetLeft || 0, room: $('#acctStrip')?.clientWidth || 0 } : {}) });
    if (last.ctx && drawKey(last.ctx) !== last.key) requestDraw();
  }) : null;
  for (const el of [$('#acctChart'), $('#acctTrack')]) if (el) watched?.observe(el);
}
const sizeOf = el => sizes.get(el) ?? { w: el.clientWidth, h: el.clientHeight };
// Every drawing of the chart and of the strip, counted (tests).
const counts = { chart: 0, strip: 0 };
export const accountDraws = () => ({ ...counts });
const chartDraw = (el, o) => { counts.chart++; return drawChart(el, o); };
// key: what the chart was drawn for (drawKey); moved: the live value it
// shows; drawn: what moveLive needs to move a new one in place; fine: the
// window ends at "now" itself (zoomed in, a minute is more than a pixel).
const last = { ctx: null, key: null, scale: null, series: null, live: null, frame: 0, moved: null, drawn: null, fine: false };
const liveKey = live => (live ? `${live.t}|${live.amount}` : '');
const motion = { from: null, start: 0 };
// The automatic fits' margin: a share of the values' range on each side.
const AXIS_MARGIN = 0.08;
const eurK = (v, step) => (step >= 1000 ? `${v < 0 ? MINUS : ''}€${NB}${digits(Math.abs(v) / 1000, step >= 10000 ? 0 : 1)}k` : eurAxis(v, step));
const padFor = () => (phone() ? { l: 50, r: 8, t: 12, b: 22 } : { l: 58, r: 14, t: 14, b: 24 });
function glide() { if (AS.shown && !reducedMotion()) { motion.from = AS.shown.slice(); motion.start = performance.now(); } }
function frameWindow(target) {
  if (!motion.from) return target;
  const k = (performance.now() - motion.start) / 200;
  if (k >= 1) { motion.from = null; return target; }
  requestDraw();
  return lerpWindow(motion.from, target, easeOut(k));
}
function requestDraw() {
  if (last.frame || typeof requestAnimationFrame !== 'function') return;
  last.frame = requestAnimationFrame(() => { last.frame = 0; draw(); });
}
const whenText = ms => { const at = new Date(Math.round(ms)).toISOString(); return `${dayDDM(at)}, ${timeHM(at)}`; };
// One wording for the visible tooltip and the polite keyboard announcement.
export function pointDetails(p, x, series) {
  if (!p) return { html: '', text: '' };
  if (p.gap) {
    const lines = [`${whenText(x)} Vienna time`, `No value recorded here${p.why ? ` · ${cellReason(p.why)}` : ''}`];
    return { text: lines.join('\n'), html: `<b>${esc(lines[0])}</b><br>${esc(lines[1])}` };
  }
  const at = new Date(p.x).toISOString(), value = money(p.u);
  if (series.source === 'daily') {
    const today = p.i === series.t.length - 1 && series.live === p.x;
    const lines = [`${dayDDM(at)} · ${today ? 'so far today' : 'last value of the day'}`, `${value} at ${timeHM(at)} Vienna time`];
    return { text: lines.join('\n'), html: `<b>${esc(lines[0])}</b><br>${esc(value)} <span class="t2">at ${esc(timeHM(at))} Vienna time</span>` };
  }
  const lines = [`${dayDDM(at)}, ${timeHM(at)} Vienna time`, value];
  return { text: lines.join('\n'), html: `<b>${esc(lines[0])}</b><br>${esc(value)}` };
}
// What a change covers, in a few words for its chip: since when, when it
// runs to now, else from one end to the other. The title gives it whole.
// Snapshots name their time: on the same day the time alone, within six
// days the weekday and time ("since Tue 19:47"), else the date and time.
const spanChip = ([a, b], source, toNow) => {
  const at = ms => new Date(ms).toISOString();
  if (source === 'daily') return toNow ? `since ${dayDM(at(a))}` : `${dayDM(at(a))} – ${dayDM(at(b))}`;
  const moment = (ms, sameDay) => (sameDay ? timeHM(at(ms)) : b - ms < 6 * 864e5 ? `${dayDDM(at(ms)).split(' ')[0]} ${timeHM(at(ms))}` : `${dayDM(at(ms))}, ${timeHM(at(ms))}`);
  const sameDay = dayDM(at(a)) === dayDM(at(b));
  return toNow ? `since ${moment(a, sameDay)}` : `${moment(a, sameDay)} – ${sameDay ? timeHM(at(b)) : moment(b, false)}`;
};
const spanLabel = ([a, b], source, toNow) => {
  const at = ms => new Date(ms).toISOString();
  if (source === 'daily') return `${dayDM(at(a))} – ${toNow ? 'now' : dayDM(at(b))}`;
  const sameDay = dayDM(at(a)) === dayDM(at(b));
  return `${dayDM(at(a))}, ${timeHM(at(a))} – ${toNow ? 'now' : sameDay ? timeHM(at(b)) : `${dayDM(at(b))}, ${timeHM(at(b))}`}`;
};

// What the chart and the strip are drawn for. Anything else (a new live
// value inside the minute) moves in place (moveLive); zoomed in, the live
// value is part of it.
function drawKey(ctx, live = ctx ? M.liveObservation(ctx.states.paperAccount, ctx.feeds.data?.value) : null) {
  const size = el => (el ? sizeOf(el) : { w: 0, h: 0 }), chart = size($('#acctChart')), track = size($('#acctTrack'));
  const now = ctx?.now ? Date.parse(ctx.now) : null;
  return JSON.stringify([store.version, store.reason, Boolean(live), AS.range, AS.view, AS.follow, chart.w, chart.h, track.w, track.h, yAxis.get(),
    now === null ? null : Math.floor(now / MIN), phone(), last.fine ? liveKey(live) : '']);
}
function chartLabel(source, range, choice = { mode: 'auto' }) {
  const axisWords = choice.mode === 'max' ? '; vertical axis fixed to everything loaded'
    : choice.mode === 'custom' ? `; custom vertical axis from ${money(choice.min, 'EUR')} to ${money(choice.max, 'EUR')}` : '';
  return range ? `The whole paper account, kept holdings included, ${M.RANGE_WORD[range]}, in euros${axisWords}`
    : `The whole paper account, kept holdings included, zoomed: ${spanLabel(AS.shown, source, false)} Vienna time, in euros${axisWords}`;
}
function draw() {
  if (boardSession.signedOut()) return;
  const el = $('#acctChart'), size = el ? sizeOf(el) : null;
  if (!el || !size.w) { syncWindowParts(); return; }
  const ctx = last.ctx, inspect = { description: 'acctInspectHelp', live: $('#acctLive'), points: [] }, pad = padFor();
  // What this drawing is for (again below, once the window's kind is known).
  last.drawn = null; last.key = drawKey(ctx);
  const empty = text => { AS.full = null; AS.shown = null; last.scale = chartDraw(el, { size, series: [], xDomain: [0, 1], empty: true, emptyText: text, inspect, pad, label: `The whole paper account over time: ${text.toLowerCase()}` }); stripOff(); syncWindowParts(); };
  if (!ctx?.now) { empty('Waiting for the board server’s clock'); return; }
  const source = M.sourceOf(AS.range), live = M.liveObservation(ctx.states.paperAccount, ctx.feeds.data?.value);
  const series = seriesFor(source, live), now = Date.parse(ctx.now);
  last.series = series; last.live = live; last.moved = liveKey(live);
  // "Now" to the minute, or a later value: the now marker, and the end of a
  // gap since the last value. The window ends there too where a minute is
  // more than a pixel (zoomed in); otherwise at the end of the minute, at
  // most a pixel on, so a new live value inside the minute moves in place.
  const settled = Math.max(Math.floor(now / MIN) * MIN, series.t.at(-1) ?? -Infinity);
  const pw = Math.max(1, size.w - pad.l - pad.r);
  let full = M.keptRange(series, Math.max(settled, Math.floor(now / MIN) * MIN + MIN)), target = full && M.accountWindow(full, AS);
  last.fine = Boolean(target) && pw * MIN > target[1] - target[0];
  if (last.fine) { full = M.keptRange(series, settled); target = M.accountWindow(full, AS); }
  last.key = drawKey(ctx);
  if (!full) { empty(emptyText(series)); return; }
  AS.full = full;
  const [x0, x1] = frameWindow(target);
  AS.shown = [x0, x1];
  const buckets = Math.max(200, size.w);
  const { pts, bands, thinned } = M.chartPoints(series, [x0, x1], settled, buckets);
  const ext = M.extents(series, [x0, x1]);
  const first = pts.find(p => p.v !== null && p.x >= x0);
  const base = first?.v ?? ext.visible?.[0] ?? 0;
  const ticks = phone() ? 3 : 4;
  const time = M.timeLabels(x0, x1, pw, phone() ? 50 : 56);
  const following = AS.follow && atLiveEdge(full, [x0, x1]);
  const range = M.windowRange(full, [x0, x1], source, AS.range);
  // The tip and the reading follow the live value as it moves (last.series).
  const hitTest = x => { const p = M.pointNear(last.series ?? series, x); return [!p ? null : p.stands ? { ...p, gap: false } : { x, v: p.v, gap: true, why: p.why, estimated: true }]; };
  // Auto: the values in the window, with the money charts' honest minimum span
  // (base); Max: every value loaded; Custom: the viewer's own bounds.
  const choice = yAxis.get();
  last.scale = chartDraw(el, {
    size,
    // Max keeps one base too (the lowest value loaded), so no window rescales it.
    axis: choice, maxValues: ext.loaded ?? null, ease: 180, easeKey: source, again: requestDraw,
    series: [{ pts, color: 'var(--accent)', w: 1.9, live: following && Boolean(series.live), area: false }],
    xDomain: [x0, x1], base: choice.mode === 'max' && ext.loaded ? ext.loaded[0] : base, yValues: ext.visible ?? [], margin: AXIS_MARGIN, yFmt: eurK, ticks, pad, bands,
    vlines: time.lines, xLabels: time.labels, now: following ? settled : null,
    emptyText: 'No value recorded in this window', label: chartLabel(source, range, choice),
    isPanning: () => Boolean(input.drag?.moved || (input.touch && input.touch.phase !== 'scrub')), isPinned: () => input.pinned,
    inspect: { ...inspect, points: M.observedTimes(series, [x0, x1]) },
    hitTest, tipFmt: (near, x) => pointDetails(near[0], x, last.series ?? series),
  });
  const svg = el.querySelector(':scope > svg'), points = pts.filter(p => p.v !== null).length;
  if (svg) Object.assign(svg.dataset, { x0: String(Math.round(x0)), x1: String(Math.round(x1)), source, range: range ?? '', points: String(points) });
  if (!last.fine) {
    const notes = ext.visible && { above: ext.visible[1] > last.scale?.ax.hi, below: ext.visible[0] < last.scale?.ax.lo };
    last.drawn = drawnLive(el, series, { source, x0, x1, buckets, thinned, following, choice, base, baseIsLive: Boolean(series.live) && first?.x === series.t.at(-1), ticks, points, notes });
  }
  el.classList.toggle('pannable', canPan());
  if (input.announce && inspect.live) { inspect.live.textContent = input.announce; input.announce = null; }
  drawStrip(series, full, [x0, x1], settled);
  syncWindowParts();
}

// ---------- The overview strip (not on a phone) ----------
const setAttrs = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) if (node.getAttribute(k) !== String(v)) node.setAttribute(k, String(v)); };
function stripOff() {
  const strip = $('#acctStrip');
  if (!strip) return;
  strip.setAttribute('data-off', '');
  for (const n of [$('#acctWin'), ...$$('#acctStrip [data-edge]')]) if (n) setAttrs(n, { tabindex: '-1', 'aria-hidden': 'true' });
  const plot = $('#acctMiniPlot');
  if (plot?.innerHTML) plot.innerHTML = '';
  Object.assign(strips, { key: null, series: null, live: null });
}
// The strip as drawn: what for (key), from which series, and what moving a
// new live value in place needs (stripSvg).
const strips = { key: null, series: null, live: null };
function stripSvg(series, full, width, height, settled) {
  const buckets = Math.max(50, Math.round(width));
  const { pts, bands, thinned } = M.chartPoints(series, full, settled, buckets);
  const values = pts.filter(p => p.v !== null).map(p => p.v);
  if (!values.length) return { html: '', live: null };
  const ax = axis(Math.min(...values), Math.max(...values), 2, values[0]);
  const X = x => toStrip(full, width, x).toFixed(1), Y = v => (4 + (ax.hi - v) / (ax.hi - ax.lo) * (height - 8)).toFixed(1);
  let g = bands.length ? '<defs><pattern id="ht-acctmini" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--line-2)" stroke-width="1.2"/></pattern></defs>' : '';
  for (const [a, b] of bands) g += `<rect x="${X(a)}" y="0" width="${Math.max(1, toStrip(full, width, b) - toStrip(full, width, a)).toFixed(1)}" height="${height}" fill="url(#ht-acctmini)"/>`;
  // The line; the points a new live value changes are its last (M.liveTail),
  // while no gap runs from it to now.
  const n = series.t.length - 1, tail = n >= 0 && !M.gapToNow(series, n, settled) ? M.liveTail(series, full, buckets, thinned) : null;
  const cut = tail ? pts.length - tail.pts.length : -1;
  let path = '', pen = false, before = null;
  pts.forEach((p, i) => {
    if (i === cut) before = { d: path, pen };
    if (p.v === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${X(p.x)} ${Y(p.v)}`; pen = true;
  });
  if (path) g += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-linejoin="round" stroke-opacity=".85"/>`;
  const html = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${g}</svg>`;
  if (!before || !tail.pts.every((q, i) => pts[cut + i].x === q.x && pts[cut + i].v === q.v)) return { html, live: null };
  const rest = values.slice(0, values.length - tail.pts.length);
  return { html, live: { full, buckets, thinned, ax, X, Y, before, from: tail.from, length: series.t.length,
    lo: Math.min(...rest), hi: Math.max(...rest), first: rest.length ? rest[0] : null } };
}
// Moves a new live value on the drawn strip; false when the strip must be
// drawn again (its scale would change, or the line before it).
function moveStripLive(series, settled) {
  const s = strips.live, path = $('#acctMiniPlot')?.querySelector('path');
  if (!s || !path || series.t.length !== s.length || M.gapToNow(series, s.length - 1, settled)) return false;
  const tail = M.liveTail(series, s.full, s.buckets, s.thinned);
  if (!tail || tail.from !== s.from) return false;
  const vs = tail.pts.map(p => p.v), ax = axis(Math.min(s.lo, ...vs), Math.max(s.hi, ...vs), 2, s.first ?? vs[0]);
  if (ax.lo !== s.ax.lo || ax.hi !== s.ax.hi) return false;
  path.setAttribute('d', tail.pts.reduce((d, p, i) => `${d}${i || s.before.pen ? 'L' : 'M'}${s.X(p.x)} ${s.Y(p.v)}`, s.before.d));
  strips.series = series;
  return true;
}
// The strip for this series, drawn again only when it must.
function stripFor(series, full, width, height, settled) {
  const plot = $('#acctMiniPlot');
  const key = `${width}|${height}|${store.version}|${series.source}|${Boolean(series.live)}|${Math.round(full[0])}|${Math.round(full[1])}`;
  if (strips.key === key && (strips.series === series || moveStripLive(series, settled))) return;
  counts.strip++;
  const drawn = stripSvg(series, full, width, height, settled);
  plot.innerHTML = drawn.html;
  Object.assign(strips, { key, series, live: drawn.live });
}
function drawStrip(series, full, [a, b], settled) {
  const strip = $('#acctStrip'), track = $('#acctTrack'), plot = $('#acctMiniPlot');
  if (!strip || !track || !plot) return;
  const { w: width, h: height, off = track.offsetLeft || 0, room = strip.clientWidth || 0 } = sizeOf(track);
  if (!width || !height || full[1] <= full[0]) { stripOff(); return; }
  // The observer measures the handle room with the track. Before its first
  // report, read once here, before replacing the strip's SVG.
  strip.removeAttribute('data-off');
  setAttrs(strip, { 'data-k0': Math.round(full[0]), 'data-k1': Math.round(full[1]) });
  // Drawn again for a new history, range, size or end (each minute, or each
  // value zoomed in); a new live value inside the minute moves in place.
  stripFor(series, full, width, height, settled);
  const t = overviewTargets({ width, left: toStrip(full, width, a), right: toStrip(full, width, b), hit: coarse() ? 44 : 16, lo: -off, hi: Math.max(width, room - off) });
  const win = $('#acctWin'), from = $('#acctStrip [data-edge="from"]'), to = $('#acctStrip [data-edge="to"]');
  win.style.left = `${t.win.x}px`; win.style.width = `${t.win.w}px`;
  win.style.setProperty?.('--hl', `${t.win.hit.x - t.win.x}px`);
  win.style.setProperty?.('--hr', `${t.win.x + t.win.w - t.win.hit.x - t.win.hit.w}px`);
  for (const [node, box] of [[from, t.from], [to, t.to]]) {
    node.style.left = `${box.x}px`; node.style.width = `${box.w}px`;
    node.firstElementChild.style.left = `${box.gx - box.x}px`;
  }
  const min = ms => Math.round(ms / MIN), live = AS.follow && atLiveEdge(full, [a, b]), source = series.source;
  const span = M.spanWords(full[1] - full[0]);
  setAttrs(win, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(full[0]), 'aria-valuemax': min(full[1] - (b - a)), 'aria-valuenow': min(a),
    'aria-valuetext': `${spanLabel([a, b], source, live)} Vienna time, of ${span} loaded${live ? ', following the newest' : ''}` });
  setAttrs(from, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(full[0]), 'aria-valuemax': min(b), 'aria-valuenow': min(a), 'aria-valuetext': `From ${whenText(a)} Vienna time` });
  // Following, the window may end with the minute: its end is "now" to the minute.
  setAttrs(to, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(a), 'aria-valuemax': min(full[1]), 'aria-valuenow': min(b), 'aria-valuetext': `To ${whenText(live ? Math.min(b, settled) : b)} Vienna time${live ? ', the newest' : ''}` });
}

// ---------- Parts that follow the window ----------
// The change line (or the value's state), the pressed range and the line
// under the chart, kept in step with the window drawn.
function syncWindowParts() {
  if (boardSession.signedOut()) return;
  const ctx = last.ctx;
  if (!ctx) return;
  const cell = ctx.states.paperAccount, state = stateLine(cell), source = M.sourceOf(AS.range);
  const series = last.series ?? seriesFor(source, null), now = ctx.now ? Date.parse(ctx.now) : null;
  const range = AS.full && AS.shown ? M.windowRange(AS.full, AS.shown, source, AS.range) : AS.view ? null : AS.range;
  for (const b of $$('#acctRanges [data-acct-range]')) setAttrs(b, { 'aria-pressed': b.dataset.acctRange === range });
  const box = $('#acctChange');
  if (state) {
    patch(box, `<span class="st ${state.tone} acct-state" title="${esc(state.text)}">${icon(state.icon)}<span data-clamp="1">${state.html}</span></span>`);
    // Ages tick in place; the full words follow them in the title.
    const text = box.querySelector('[data-clamp]')?.textContent ?? state.text, node = box.querySelector('.acct-state');
    if (node && node.getAttribute('title') !== text) node.setAttribute('title', text);
  } else {
    const change = AS.shown ? M.rangeChange(series, AS.shown) : null;
    // It ends now when it ends on the value shown above (recorded or not yet).
    const live = last.live, liveAt = live ? (source === 'daily' ? Date.parse(live.observedAt) : live.t) : null;
    const toNow = Boolean(change && liveAt !== null && change.to >= liveAt);
    // The range's name only when the change covers all of it: from its start
    // (recorded that far back) to now. Otherwise the span it does cover.
    const whole = Boolean(range && change?.fromStart && toNow && now !== null && M.coverage(series, range, now).complete);
    const covered = change ? [change.from, change.to] : AS.shown;
    const chip = whole ? range : covered ? spanChip(covered, source, toNow) : AS.range;
    const title = whole ? M.RANGE_TITLE[range] : covered ? `Change from ${spanLabel(covered, source, toNow).replace(' – ', ' to ')}` : M.RANGE_TITLE[AS.range];
    patch(box, changeHtml(change, chip, title));
    if (input.announceChange) {
      input.announceChange = false;
      const region = $('#acctLive');
      if (region) region.textContent = change ? `${title}: ${money(change.change, 'EUR', true)}, ${M.pctText(change.pct)}` : `${title}: no change recorded yet`;
    }
  }
  const note = $('#acctNote'), text = now === null ? '' : noteText(series, source, now);
  const hint = !text && !chartHintSeen();
  patch(note, text ? esc(text) : hint ? '<span class="hint-fine">Drag or scroll sideways to move · <span class="mod-key">Ctrl</span>-scroll or pinch to zoom</span><span class="hint-touch">Swipe · pinch · double-tap</span>' : '');
  if (hint && isMac()) for (const k of $$('#acctNote .mod-key')) if (k.textContent !== '⌘') k.textContent = '⌘';
  note?.setAttribute('data-kind', text ? 'note' : hint ? 'hint' : 'none');
}
const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

// ---------- Rendering ----------
export function renderAccount(ctx) {
  if (boardSession.signedOut()) return;
  last.ctx = ctx;
  const root = $('#acctHero');
  if (!root) return;
  if (!store.busy && performance.now() >= store.next && typeof fetch === 'function') refresh();
  // The value and its panel state (fresh, stale, broken or not reported).
  const value = $('#acctValue'), state = ctx.states.paperAccount?.state ?? 'not reported';
  patch(value, valueHtml(ctx.states.paperAccount));
  if (value.dataset.state !== state) value.dataset.state = state;
  const parts = subParts(ctx);
  patch($('#acctSub'), parts.wide);
  patch($('#acctSubN'), parts.narrow);
  patch($('#acctDetails'), parts.details);
  root.dataset.history = store.value ? 'ok' : store.reason ?? 'ok';
  // The chart and the strip are drawn again only for what drawKey names; a
  // new live value inside the minute moves in place (moveLive).
  const live = M.liveObservation(ctx.states.paperAccount, ctx.feeds.data?.value);
  if (drawKey(ctx, live) !== last.key || motion.from) { draw(); return; }
  if (liveKey(live) !== last.moved && !moveLive()) { draw(); return; }
  syncWindowParts();
}

// ---------- The live value, in place ----------
// A new live value inside the minute changes only the line's last points
// (M.liveTail), its end dot and halo, and "now" where it stands on the live
// value. moveLive moves them on the drawn chart where a new drawing would
// put them, while a new drawing would draw nothing else differently: the
// same window, the same vertical axis (Auto and Max follow the values; a
// custom axis keeps its notes), no gap to now, no tip open. Anything else is
// drawn again. drawnLive keeps what that needs, or null when the drawing has
// no live value, its axis is still gliding or its line draws in.
const vertex = (scale, p) => `${scale.X(p.x).toFixed(1)} ${scale.Y(p.v).toFixed(1)}`;
function drawnLive(el, series, o) {
  const svg = el.querySelector(':scope > svg'), scale = last.scale, n = series.t.length - 1;
  if (!svg || !scale || !series.live || n < 1 || scale.ax.lo !== scale.target.lo || scale.ax.hi !== scale.target.hi) return null;
  const drawing = { ...o, el, svg, scale, length: series.t.length, tail: null };
  // The window ends before the value before the live one: neither is drawn.
  if (series.t[n - 1] > o.x1) return drawing;
  const tail = M.liveTail(series, [o.x0, o.x1], o.buckets, o.thinned);
  const path = [...svg.querySelectorAll('path')].filter(p => p.getAttribute('stroke') === 'var(--accent)').at(-1);
  if (!tail || !path || path.getAttribute('data-draw') !== null) return null;
  const drawn = (path.getAttribute('d') ?? '').slice(1).split(' L'), at = drawn.length - tail.pts.length;
  if (at < 0 || tail.pts.some((p, i) => vertex(scale, p) !== drawn[at + i])) return null;
  const circles = [...svg.querySelectorAll('circle')];
  return { ...drawing, tail, path, before: drawn.slice(0, at),
    ring: circles.find(c => c.getAttribute('r') === '4' && c.getAttribute('class') === null) ?? null,
    halo: circles.find(c => c.getAttribute('class') === 'dot-live') ?? null,
    now: svg.querySelector('[data-now]'), nowText: [...svg.querySelectorAll('text')].find(t => t.textContent === 'now') ?? null };
}
// Moves a new live value on the drawn chart and strip; false when the chart
// must be drawn again.
function moveLive() {
  const d = last.drawn, ctx = last.ctx;
  if (!d || !ctx?.now || d.el.querySelector(':scope > svg') !== d.svg || d.el.querySelector('.ctip.on')) return false;
  const live = M.liveObservation(ctx.states.paperAccount, ctx.feeds.data?.value);
  const series = seriesFor(d.source, live), n = series.t.length - 1, now = Date.parse(ctx.now);
  if (!series.live || series.t.length !== d.length) return false;
  const settled = Math.max(Math.floor(now / MIN) * MIN, series.t[n]);
  // The vertical axis a new drawing would settle on (drawChart's Auto and
  // Max fits), or a custom axis's notes on values beyond it.
  const ext = M.extents(series, [d.x0, d.x1]), { ax, target } = d.scale;
  if (!ext.visible) return false;
  if (d.choice.mode === 'custom') {
    if (!d.notes || (ext.visible[1] > ax.hi) !== d.notes.above || (ext.visible[0] < ax.lo) !== d.notes.below) return false;
  } else {
    const next = chartAxis({ axis: d.choice, maxValues: ext.loaded, margin: AXIS_MARGIN, ticks: d.ticks,
      base: d.choice.mode === 'max' && ext.loaded ? ext.loaded[0] : d.baseIsLive ? series.v[n] : d.base }, ext.visible, d.scale.ph);
    if (next.lo !== target.lo || next.hi !== target.hi || next.step !== target.step) return false;
  }
  if (d.tail) {
    const tail = M.gapToNow(series, n, settled) ? null : M.liveTail(series, [d.x0, d.x1], d.buckets, d.thinned);
    if (!tail || tail.from !== d.tail.from) return false;
    // The end dot and its halo where a drawing draws them (drawChart's fits).
    const { X, Y } = d.scale, x = series.t[n], cy = Y(series.v[n]);
    const { ring, halo, beyond } = chartDots(d.scale).end(x, series.v[n], d.following);
    const nowAt = d.following && settled >= d.x0 && settled <= d.x1;
    if (ring !== Boolean(d.ring) || halo !== Boolean(d.halo) || beyond || nowAt !== Boolean(d.now)) return false;
    d.path.setAttribute('d', `M${[...d.before, ...tail.pts.map(p => vertex(d.scale, p))].join(' L')}`);
    for (const dot of [d.ring, d.halo]) if (dot) { dot.setAttribute('cx', X(x).toFixed(1)); dot.setAttribute('cy', cy.toFixed(1)); }
    if (d.now) {
      for (const k of ['x1', 'x2']) d.now.setAttribute(k, X(settled).toFixed(1));
      d.nowText?.setAttribute('x', (X(settled) - 5).toFixed(1));
    }
    d.points += tail.pts.length - d.tail.pts.length;
    d.svg.dataset.points = String(d.points);
    d.tail = tail;
  }
  last.series = series; last.live = live; last.moved = liveKey(live);
  if (strips.key) { const { w, h } = sizeOf($('#acctTrack')); stripFor(series, AS.full, w, h, settled); }
  return true;
}

// ---------- Input ----------
// History's model: a drag or a sideways wheel pans, ⌘ or Ctrl with the wheel
// and a pinch zoom at the pointer, a plain vertical wheel scrolls the page,
// double-click shows everything loaded; keys on the chart and the strip.
const input = { drag: null, touch: null, pinned: false, lastTap: null, announce: null, announceChange: false };
const canPan = () => Boolean(AS.full && AS.shown && AS.shown[1] - AS.shown[0] < (AS.full[1] - AS.full[0]) * 0.999);
const current = () => (motion.from || !AS.full || !AS.shown ? AS.shown : M.accountWindow(AS.full, AS));
function seen() { if (dismissChartHint()) syncWindowParts(); }
function setView(next) {
  if (!AS.full) return;
  AS.view = next; AS.follow = endsAtNewest(AS.full, next);
  seen(); requestDraw();
}
// No window narrows below the source's floor (minutes of snapshots, days of
// closes): zooms clamp their factor to it, and every resize of an edge, by
// pointer or key, goes through resizeTo.
const floorSpan = () => Math.min(M.MIN_SPAN[M.sourceOf(AS.range)], AS.full[1] - AS.full[0]);
function zoomBy(base, factor, at) {
  return zoomWindow(AS.full, base, Math.max(factor, floorSpan() / Math.max(1, base[1] - base[0])), at);
}
const resizeTo = (base, edge, to) => M.resizeWithin(AS.full, base, edge, to, floorSpan());
function announceWindow() {
  if (!AS.full) return;
  const next = M.accountWindow(AS.full, AS);
  input.announce = `Showing ${spanLabel(next, M.sourceOf(AS.range), AS.follow)} Vienna time`;
}
export function chooseRange(range) {
  if (!M.RANGES.includes(range)) return;
  if (M.sourceOf(range) === M.sourceOf(AS.range)) glide(); else motion.from = null;
  Object.assign(AS, { range, view: null, follow: true });
  input.announceChange = true;
  requestDraw();
}
function fitAll() { if (!AS.full) return; glide(); AS.view = AS.full.slice(); AS.follow = true; seen(); requestDraw(); }
const unpin = () => { if (input.pinned) { input.pinned = false; last.scale?.release(); } };

function bindChart(chart, track) {
  const plotWidth = () => last.scale?.pw ?? Math.max(1, chart.clientWidth - padFor().l - padFor().r);
  const perPx = () => (AS.shown ? (AS.shown[1] - AS.shown[0]) / plotWidth() : 0);
  const chartTime = (clientX, [a, b] = current()) => {
    const r = chart.getBoundingClientRect();
    return a + Math.min(1, Math.max(0, (clientX - r.left - (last.scale?.pad.l ?? padFor().l)) / plotWidth())) * (b - a);
  };
  const stripTime = clientX => fromStrip(AS.full, track.clientWidth, clientX - track.getBoundingClientRect().left);
  const stop = () => { motion.from = null; };
  const latch = createWheelLatch();
  const wheel = (e, time) => {
    if (!AS.full || !AS.shown) return;
    const intent = latch(e, e.timeStamp);
    if (intent === 'page') return;
    e.preventDefault();
    const base = current(), dx = wheelPixels(e.deltaX, e.deltaMode), dy = wheelPixels(e.deltaY, e.deltaMode);
    stop();
    if (intent === 'zoom') setView(zoomBy(base, wheelZoomFactor(dy), time(e.clientX, base)));
    else setView(panWindow(AS.full, base, (e.shiftKey && Math.abs(dy) > Math.abs(dx) ? dy : dx) * (base[1] - base[0]) / plotWidth()));
  };
  chart.addEventListener('wheel', e => wheel(e, chartTime), { passive: false });
  track.addEventListener('wheel', e => wheel(e, stripTime), { passive: false });
  // Safari reports a trackpad pinch as gesture events, not as a Ctrl wheel.
  const touches = new Map();
  let gesture = null;
  chart.addEventListener('gesturestart', e => { if (!AS.shown || touches.size) return; const start = current(); e.preventDefault(); stop(); gesture = { start, at: chartTime(e.clientX, start) }; });
  chart.addEventListener('gesturechange', e => { if (!gesture) return; e.preventDefault(); setView(zoomBy(gesture.start, 1 / Math.max(0.05, e.scale), gesture.at)); });
  chart.addEventListener('gestureend', () => { gesture = null; });
  // Mouse and pen drag after 3 px; touch pans only after a clear sideways
  // swipe (a vertical one scrolls the page), pinches with two fingers, a tap
  // or a long press inspects and a double tap shows everything.
  chart.addEventListener('pointerdown', e => {
    if (!AS.shown) return;
    const start = current();
    stop();
    if (e.pointerType !== 'touch') {
      if (e.button === 0 && canPan()) input.drag = { id: e.pointerId, x: e.clientX, start, perPx: perPx(), moved: false };
      return;
    }
    // Hold each finger until it lifts, even beyond the chart: redrawing the
    // SVG under it ends the browser's own hold and would leave it in touches.
    chart.setPointerCapture?.(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(input.touch?.timer);
    if (touches.size === 1) {
      const t = { phase: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, down: e.timeStamp, start, perPx: perPx() };
      t.timer = setTimeout(() => { if (input.touch === t && t.phase === 'pending') { t.phase = 'scrub'; input.pinned = true; last.scale?.inspectAt(t.lastX); } }, 350);
      input.touch = t;
    } else if (touches.size === 2) {
      const [p, q] = [...touches.values()], mid = (p.x + q.x) / 2;
      unpin();
      input.touch = { phase: 'pinch', start, spread: Math.max(24, Math.abs(p.x - q.x)), mid, at: chartTime(mid, start), perPx: perPx() };
    }
  });
  chart.addEventListener('pointermove', e => {
    const d = input.drag;
    if (d && !d.strip && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 3) return;
      if (!d.moved) { d.moved = true; chart.setPointerCapture?.(e.pointerId); chart.classList.add('panning'); last.scale?.release(); }
      setView(panWindow(AS.full, d.start, -dx * d.perPx));
      return;
    }
    if (!touches.has(e.pointerId) || !input.touch) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const t = input.touch;
    if (t.phase === 'pinch') {
      if (touches.size !== 2) return;
      const [p, q] = [...touches.values()], spread = Math.max(24, Math.abs(p.x - q.x)), mid = (p.x + q.x) / 2;
      const zoomed = zoomBy(t.start, t.spread / spread, t.at);
      setView(panWindow(AS.full, zoomed, -(mid - t.mid) * t.perPx * (zoomed[1] - zoomed[0]) / (t.start[1] - t.start[0])));
      return;
    }
    if (t.id !== e.pointerId) return;
    t.lastX = e.clientX;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (t.phase === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(t.timer);
      if (Math.abs(dx) <= Math.abs(dy)) { t.phase = 'page'; return; }
      unpin();
      t.phase = canPan() ? 'pan' : 'scrub';
      if (t.phase === 'scrub') input.pinned = true;
    }
    if (t.phase === 'pan') setView(panWindow(AS.full, t.start, -dx * t.perPx));
  });
  const release = e => {
    if (input.drag && !input.drag.strip && input.drag.id === e.pointerId) { input.drag = null; chart.classList.remove('panning'); return; }
    if (!touches.delete(e.pointerId)) return;
    const t = input.touch;
    if (!touches.size) input.touch = null;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.phase === 'pinch' || t.phase === 'done') { if (touches.size) t.phase = 'done'; return; }
    if (t.id !== e.pointerId) return;
    input.touch = null;
    if (e.type === 'pointercancel') { unpin(); return; }
    if (t.phase !== 'pending' || e.timeStamp - t.down > 300) return;
    const tap = input.lastTap;
    if (tap && e.timeStamp - tap.at < 300 && Math.abs(e.clientX - tap.x) < 24) { input.lastTap = null; unpin(); fitAll(); return; }
    input.lastTap = { at: e.timeStamp, x: e.clientX };
    input.pinned = Boolean(last.scale?.inspectAt(e.clientX));
  };
  chart.addEventListener('pointerup', release);
  chart.addEventListener('pointercancel', release);
  chart.addEventListener('dblclick', () => fitAll());
  document.addEventListener('pointerdown', e => { if (!chart.contains(e.target)) unpin(); }, true);
  // Keys on the focused chart: the arrows alone inspect (drawChart).
  chart.addEventListener('keydown', e => {
    if (e.target !== chart || e.altKey || e.ctrlKey || e.metaKey || !AS.shown) return;
    if (!['Tab', 'Shift'].includes(e.key)) seen();
    const shown = current(), [a, b] = shown, w = b - a, anchor = AS.follow ? b : (a + b) / 2;
    const next = e.shiftKey && e.key === 'ArrowLeft' ? panWindow(AS.full, shown, -w * 0.1)
      : e.shiftKey && e.key === 'ArrowRight' ? panWindow(AS.full, shown, w * 0.1)
        : e.shiftKey && e.key === 'Home' ? placeWindow(AS.full, w, AS.full[0], 0)
          : e.shiftKey && e.key === 'End' ? placeWindow(AS.full, w, AS.full[1], 1)
            : e.key === '+' || e.key === '=' ? zoomBy(shown, 1 / 1.5, anchor)
              : e.key === '-' || e.key === '_' ? zoomBy(shown, 1.5, anchor) : null;
    if (e.key === '0') { e.preventDefault(); fitAll(); announceWindow(); return; }
    if (!next) return;
    e.preventDefault(); stop();
    setView(next); announceWindow();
  });
  // The strip: drag the window to pan, drag an edge to resize, click beside
  // the window to centre it there; its window and edges are sliders.
  track.addEventListener('pointerdown', e => {
    if (!AS.full || !AS.shown || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const edge = e.target.closest('[data-edge]')?.dataset.edge ?? null, start = current();
    stop();
    input.drag = { strip: true, kind: edge ? 'edge' : e.target.closest('#acctWin') ? 'window' : 'strip', edge, id: e.pointerId, x: e.clientX, start, moved: false };
    track.setPointerCapture?.(e.pointerId);
  });
  track.addEventListener('pointermove', e => {
    const d = input.drag;
    if (!d?.strip || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) { d.moved = true; track.classList.add('dragging'); }
    const per = (AS.full[1] - AS.full[0]) / track.clientWidth;
    setView(d.kind === 'edge' ? resizeTo(d.start, d.edge, d.start[d.edge === 'from' ? 0 : 1] + dx * per) : panWindow(AS.full, d.start, dx * per));
  });
  const drop = e => {
    const d = input.drag;
    if (!d?.strip || d.id !== e.pointerId) return;
    input.drag = null; track.classList.remove('dragging');
    if (d.moved || d.kind !== 'strip' || e.type !== 'pointerup') return;
    glide();
    setView(placeWindow(AS.full, d.start[1] - d.start[0], stripTime(e.clientX), 0.5));
  };
  track.addEventListener('pointerup', drop);
  track.addEventListener('pointercancel', drop);
  track.addEventListener('keydown', e => {
    const target = e.target.closest('#acctWin, [data-edge]');
    if (!target || !AS.full || !AS.shown || e.altKey || e.ctrlKey || e.metaKey) return;
    const full = AS.full, shown = current(), [a, b] = shown, w = b - a, edge = target.dataset.edge;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    let next = null;
    if (edge) {
      const at = edge === 'from' ? a : b;
      const to = step ? at + step * w * (e.shiftKey ? 0.5 : 0.1) : { PageUp: at + w, PageDown: at - w, Home: full[0], End: full[1] }[e.key];
      if (to !== undefined) next = resizeTo(shown, edge, to);
    } else if (step && e.shiftKey) next = zoomBy(shown, step < 0 ? 1 / 1.5 : 1.5, AS.follow ? b : (a + b) / 2);
    else if (step) next = panWindow(full, shown, step * w * 0.1);
    else if (e.key === 'PageUp' || e.key === 'PageDown') next = panWindow(full, shown, (e.key === 'PageUp' ? 1 : -1) * w);
    else if (e.key === 'Home') next = placeWindow(full, w, full[0], 0);
    else if (e.key === 'End') next = placeWindow(full, w, full[1], 1);
    if (!next) return;
    e.preventDefault(); stop();
    if (!step) glide();
    setView(next);
  });
}

// ---------- Controls: how to move, zoom and read the chart ----------
// A disclosure under the chart: the pointer's or the finger's list, whichever
// this device has. The vertical axis control joins it with JOED-154.
export function controlsHtml() {
  return `<dl class="acct-keys hint-fine">
    <dt>Drag, or scroll sideways</dt><dd>move in time</dd>
    <dt><kbd class="mod-key">Ctrl</kbd> + scroll, or pinch</dt><dd>zoom at the pointer</dd>
    <dt>Scroll up or down</dt><dd>moves the page, never the chart</dd>
    <dt>Double-click</dt><dd>show everything loaded</dd>
    <dt><kbd>Left</kbd> <kbd>Right</kbd></dt><dd>read value by value</dd>
    <dt><kbd>Shift</kbd> + <kbd>Left</kbd> <kbd>Right</kbd></dt><dd>move</dd>
    <dt><kbd>+</kbd> <kbd>−</kbd> · <kbd>0</kbd></dt><dd>zoom · show everything</dd>
    <dt>Overview strip</dt><dd>drag the window or an edge, or click to jump there</dd>
  </dl><dl class="acct-keys hint-touch">
    <dt>Swipe sideways</dt><dd>move in time</dd><dt>Pinch</dt><dd>zoom</dd>
    <dt>Double-tap</dt><dd>show everything loaded</dd><dt>Tap or hold</dt><dd>read a value</dd>
  </dl><div class="ctl-axis">
    <p class="ctl-h" id="acctAxisName">Vertical axis</p>
    <div class="seg" role="group" aria-labelledby="acctAxisName" aria-describedby="acctAxisNote" id="acctAxis">
      <button type="button" data-axis="auto" aria-pressed="true">Auto</button><button type="button" data-axis="max" aria-pressed="false">Max</button><button type="button" data-axis="custom" aria-pressed="false">Custom</button>
    </div>
    <p class="ctl-note" id="acctAxisNote">${AXIS_NOTE.auto}</p>
    <form class="ctl-custom" id="acctAxisForm" novalidate hidden>
      <label for="acctAxisMin">Bottom</label><input class="inp" id="acctAxisMin" inputmode="decimal" autocomplete="off" aria-invalid="false" aria-describedby="acctAxisUnit">
      <label for="acctAxisMax">Top</label><input class="inp" id="acctAxisMax" inputmode="decimal" autocomplete="off" aria-invalid="false" aria-describedby="acctAxisUnit">
      <button type="submit" class="btn">Apply</button>
      <p class="ctl-note" id="acctAxisUnit">In euros, for example 980000 or 985000,50.</p>
      <p class="ctl-err" id="acctAxisError" aria-live="polite"></p>
    </form>
  </div>`;
}
// The vertical axis in Controls, as on History: Auto, Max and Custom apply at
// once; Custom starts from the axis on screen, and its bottom and top apply
// with Enter or Apply. A bound that cannot be read is refused with its reason.
const AXIS_NOTE = {
  auto: 'Fits the shown window and glides with every move.',
  max: 'Holds everything loaded, so moving never rescales.',
  custom: 'Your own bottom and top, in euros.',
};
const typedBound = n => `${n < 0 ? MINUS : ''}${String(Math.abs(n)).replace('.', ',')}`;
const axisShown = { key: null };
function markBound(field, invalid) {
  if (!field) return;
  field.setAttribute('aria-invalid', String(invalid));
  field.setAttribute('aria-describedby', invalid ? 'acctAxisUnit acctAxisError' : 'acctAxisUnit');
}
const axisError = text => { const error = $('#acctAxisError'); if (error && error.textContent !== text) error.textContent = text; };
// The control follows the saved choice; the fields only when the choice
// changes, never while the viewer is typing in them.
function syncAxisControls(force = false) {
  if (!$('#acctAxis')) return;
  const choice = yAxis.get();
  for (const b of $$('#acctAxis [data-axis]')) setAttrs(b, { 'aria-pressed': b.dataset.axis === choice.mode });
  const note = $('#acctAxisNote');
  if (note && note.textContent !== AXIS_NOTE[choice.mode]) note.textContent = AXIS_NOTE[choice.mode];
  const form = $('#acctAxisForm');
  if (form) form.hidden = choice.mode !== 'custom';
  const key = `${choice.mode}|${choice.min}|${choice.max}`;
  if (!force && axisShown.key === key) return;
  axisShown.key = key;
  for (const [id, value] of [['#acctAxisMin', choice.min], ['#acctAxisMax', choice.max]]) {
    const field = $(id);
    markBound(field, false);
    if (field && document.activeElement !== field) field.value = choice.mode === 'custom' ? typedBound(value) : '';
  }
  axisError('');
}
function axisChanged() { syncAxisControls(true); last.key = null; requestDraw(); }
export function chooseAxis(mode) {
  if (mode !== 'custom') { yAxis.setAxisMode({ mode }); axisChanged(); return; }
  if (yAxis.get().mode !== 'custom') {
    // Custom starts from the axis on screen, in whole euros.
    const shown = last.scale?.target, lo = Math.floor(shown?.lo ?? 0), hi = Math.ceil(shown?.hi ?? 1);
    const result = yAxis.setAxisMode({ mode: 'custom', min: lo, max: hi > lo ? hi : lo + 1 });
    if (!result.ok) { syncAxisControls(true); axisError(result.error); return; }
  }
  axisChanged();
  $('#acctAxisMin')?.focus();
}
export function applyCustomAxis() {
  const min = $('#acctAxisMin'), max = $('#acctAxisMax');
  if (!min || !max) return false;
  const result = yAxis.setAxisMode({ mode: 'custom', min: min.value, max: max.value });
  if (!result.ok) {
    markBound(min, result.field === 'min');
    markBound(max, result.field === 'max');
    axisError(result.error);
    (result.field === 'min' ? min : max).focus();
    return false;
  }
  // Both fields read again as the bounds now drawn.
  for (const field of [min, max]) markBound(field, false);
  min.value = typedBound(result.choice.min); max.value = typedBound(result.choice.max);
  axisChanged();
  return true;
}
function openControls(open) {
  const pop = $('#acctPop'), button = $('#acctCtl');
  if (!pop || !button) return;
  if (open && !pop.innerHTML) {
    pop.innerHTML = controlsHtml();
    if (isMac()) for (const k of $$('#acctPop .mod-key')) k.textContent = '⌘';
  }
  if (open) syncAxisControls(true);
  pop.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}
function bindControls() {
  const button = $('#acctCtl'), pop = $('#acctPop'), foot = $('#acctHero .acct-foot');
  if (!button || !pop || !foot) return;
  button.addEventListener('click', () => openControls(pop.hidden));
  // The vertical axis inside: its three choices and Custom's form (filled on first open).
  pop.addEventListener('click', e => { const b = e.target?.closest?.('[data-axis]'); if (b) chooseAxis(b.dataset.axis); });
  pop.addEventListener('submit', e => { e.preventDefault(); applyCustomAxis(); });
  // Escape, a press outside or focus leaving closes it; Escape keeps focus on Controls.
  foot.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); openControls(false); button.focus({ preventScroll: true }); } });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !foot.contains(e.target)) openControls(false); }, true);
  foot.addEventListener('focusout', e => { if (!pop.hidden && e.relatedTarget && !foot.contains(e.relatedTarget)) openControls(false); });
}

// ---------- Skeleton ----------
// Built once: the parts that change are patched, the controls keep their
// listeners. The phone shows the short eyebrow, the one-line Since start and
// Cash, Account details, and no overview strip.
export function accountSkeleton() {
  const ranges = M.RANGES.map(r => `<button type="button" data-acct-range="${r}" aria-pressed="${r === AS.range}" title="${esc(M.RANGE_TITLE[r])}"><span class="mono">${r}</span></button>`).join('');
  return `<div class="acct-eyebrow">${icon('keep')}<h2 class="acct-title" id="acctTitle"><span class="acct-wide">${term('paperacct', 'IB paper account')} · whole account</span><span class="acct-narrow">Whole account</span></h2><span class="acct-chip keep">incl. kept holdings</span><span class="acct-chip mono">EUR · <span class="acct-wide">account </span>base currency</span><button type="button" class="acct-dbtn" id="acctDetailsBtn" aria-expanded="false" aria-controls="acctDetails">Account details${icon('chev-d')}</button></div>
    <div class="acct-value" id="acctValue"></div>
    <div class="acct-change" id="acctChange"></div>
    <p class="acct-sub acct-wide" id="acctSub"></p>
    <p class="acct-sub acct-narrow" id="acctSubN"></p>
    <div class="acct-details" id="acctDetails" hidden></div>
    <div class="seg acct-ranges" role="group" aria-label="Chart range" id="acctRanges">${ranges}</div>
    <div class="chart acct-chart" id="acctChart"><div class="ctip" id="acctTip" aria-hidden="true"></div></div>
    <p class="vh" id="acctInspectHelp">Use Left and Right to read the recorded values, Home and End for the ends, and Page Up and Page Down for larger steps. Shift with Left and Right moves the shown time, plus and minus zoom, and 0 shows everything loaded. Escape leaves the chart’s reading; Tab moves on.</p>
    <div class="vh" id="acctLive" aria-live="polite" aria-atomic="true"></div>
    <div class="acct-strip" id="acctStrip" data-off role="group" aria-label="Everything loaded, with the shown window">
      <div class="mini-track" id="acctTrack"><div class="mini-plot" id="acctMiniPlot"></div>
        <div class="mini-win" id="acctWin" role="slider" tabindex="-1" aria-hidden="true" aria-label="Shown window" aria-describedby="acctMiniHelp" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
        <div class="mini-h" data-edge="from" role="slider" tabindex="-1" aria-hidden="true" aria-label="Start of the shown window" aria-describedby="acctMiniHelp" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span class="grip"></span></div>
        <div class="mini-h" data-edge="to" role="slider" tabindex="-1" aria-hidden="true" aria-label="End of the shown window" aria-describedby="acctMiniHelp" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span class="grip"></span></div>
      </div>
    </div>
    <p class="vh" id="acctMiniHelp">Left and Right move the shown window by a tenth, Page Up and Page Down by its width, Home and End to the oldest and newest values; Shift with Left and Right makes it narrower or wider. On an edge, Left and Right move that edge.</p>
    <div class="acct-foot"><p class="acct-note" id="acctNote"></p><button type="button" class="acct-ctl" id="acctCtl" aria-expanded="false" aria-controls="acctPop">${icon('sliders')}Controls</button>
      <div class="acct-pop" id="acctPop" role="group" aria-label="Chart controls" hidden></div></div>`;
}
export function initAccount() {
  const root = $('#acctHero');
  if (!root) return;
  root.innerHTML = accountSkeleton();
  watchSizes();
  // The board's own read-only hooks: read the account history now, and
  // whether a worker reads it (the browser budget checks both).
  const hooks = globalThis.__joedesk;
  if (hooks && typeof hooks === 'object') Object.assign(hooks, { refreshAccount: () => refresh(), accountWorker: () => Boolean(reader.worker) });
  $('#acctRanges').addEventListener('click', e => {
    const b = e.target.closest('[data-acct-range]');
    if (b) chooseRange(b.dataset.acctRange);
  });
  $('#acctDetailsBtn').addEventListener('click', () => {
    AS.details = !AS.details;
    $('#acctDetailsBtn').setAttribute('aria-expanded', String(AS.details));
    $('#acctDetails').hidden = !AS.details;
  });
  bindChart($('#acctChart'), $('#acctTrack'));
  bindControls();
}
