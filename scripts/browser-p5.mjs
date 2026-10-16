#!/usr/bin/env node
// P5 browser gate: Settings against Fleet Config fixtures (clean, edited,
// stale version, send failure, missing settings with the SXR8/TSLA floor),
// through the real board server, at 390/1024/1440 in light and dark (AC-22 to
// AC-29 and the Part A craft rules), plus the LIVE gate asserted at the
// network layer, Appearance (System follows the OS live), Tick's P4 focus
// carry-over and a width sweep. One headless browser, one page, sequential.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';
import * as nodeModule from 'node:module';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, ACTOR, TOKEN, NOW, at } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load, settle, waitFor } from './browser/shots.mjs';
import { createGate, shifted, WIDE_FONT } from './browser/gate.mjs';
import { designFleet, designActions, designSnapshot, longFleet } from './browser/settings-fixtures.mjs';
import { designResults } from './browser/results.mjs';

// The page's own model, for the words and keys Settings must show.
const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}
const M = await import('../public/joe/settings-model.js');

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p5');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const { results, shots, check, shot, auditScreen } = createGate(QA_DIR);
const ONLY = (process.env.JOED_P5_ONLY ?? '').split(',').filter(Boolean);
const run = name => !ONLY.length || ONLY.includes(name);
const J = JSON.stringify;
const N = text => String(text ?? '').replace(/[\s ]+/g, ' ').trim();
const schema = JSON.parse(readFileSync(new URL('../contracts/fleet-config.schema.json', import.meta.url)));
const LEAVES = M.schemaLeafKeys(schema);
const HISTORY = (() => { const w = {}; new Function('window', readFileSync(new URL('../public/joe/joe-version.js', import.meta.url), 'utf8'))(w); return w.JoeVersion.VERSION_HISTORY; })();
const SECTION_IDS = ['set-mode', 'set-runtime', ...M.GROUPS.map(g => `set-${g.id}`), 'set-how', 'set-source', 'set-log', 'set-appearance', 'set-about'];
const DESKTOP = VIEWPORTS.filter(v => !v.mobile);
const PHONE = VIEWPORTS.find(v => v.mobile);
const READS = ['/joe/state.json', '/joe/history.json', '/joe/results.json', '/joe/fleet-config.json', '/joe/fleet-config/actions.json'];
const PROPAGATE = '/joe/fleet-config/propagate';

const browser = await launch({ hostRules: 'MAP joedesk.example.test 127.0.0.1' });
const engine = await browser.send('Browser.getVersion');
const reference = `${engine.product} (headless, ${process.platform} ${process.arch}), ${cpus()[0]?.model ?? 'unknown CPU'}, Node ${process.version}`;
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: AUDIT });
const boards = [];
let sends = 0;

// One answer for matching requests of the page (a status and body, or a
// failure); an answer may first do its own work (a promise).
let route = null;
browser.on(m => {
  if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
  const id = { requestId: m.params.requestId }, r = route;
  if (!r || !m.params.request.url.includes(r.match)) { browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}); return; }
  Promise.resolve(r.answer(m.params.request)).then(a => {
    if (a.fail) return browser.send('Fetch.failRequest', { ...id, errorReason: a.fail }, m.sessionId);
    return browser.send('Fetch.fulfillRequest', { ...id, responseCode: a.status ?? 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...(a.headers ?? [])],
      body: Buffer.from(J(a.body)).toString('base64') }, m.sessionId);
  }).catch(() => {});
});
const intercept = async next => { route = next; await page.setFetch(next ? [{ urlPattern: `*${next.match}*` }] : null); };

async function designBoard({ fleet = designFleet(), actions = designActions(), raw = null, noFleet = false, snapshot: snap = {} } = {}) {
  const { snapshot, history } = designSnapshot(NOW, snap);
  const b = await startBoard({ history, fleetConfig: noFleet || raw !== null ? null : fleet, fleetConfigRaw: raw, fleetActions: actions });
  boards.push(b);
  b.setNow(NOW);
  const r = await b.push(snapshot);
  if (r.status !== 200) throw new Error(`design push failed: ${J(r.body)}`);
  b.setNow(at(NOW, 9));
  return b;
}
const served = async b => (await fetch(`${b.url}fleet-config.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();

// ---------- Page helpers ----------
const ev = expr => page.evaluate(expr);
const click = async sel => { await ev(`document.querySelector(${J(sel)}).click()`); await settle(page); };
async function centre(sel, scroll = true) {
  if (scroll) { await ev(`(() => { const e = document.querySelector(${J(sel)}); const r = e.getBoundingClientRect(); if (r.top < 120 || r.bottom > innerHeight - 140) e.scrollIntoView({ block: 'center' }); })()`); await settle(page); }
  return ev(`(() => { const r = document.querySelector(${J(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}
async function mouseAt(p) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await settle(page);
}
const mouse = async (sel, scroll = true) => mouseAt(await centre(sel, scroll));
async function tap(sel) {
  const p = await centre(sel);
  await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(page);
}
const press = async (viewport, sel) => (viewport.mobile ? tap(sel) : mouse(sel));
const CODES = { Escape: 27, Enter: 13, Tab: 9 };
async function key(name, shift = false) {
  const base = { key: name, code: name, windowsVirtualKeyCode: CODES[name], modifiers: shift ? 8 : 0 };
  await page.s('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (name === 'Enter') await page.s('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await settle(page);
}
async function type(sel, text) {
  await ev(`(() => { const e = document.querySelector(${J(sel)}); e.focus(); e.select?.(); })()`);
  await page.s('Input.insertText', { text });
  await settle(page);
}
const viewShot = async (name, what) => {
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(QA_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  shots.push({ file: `${name}.png`, what });
};
// Absolute boxes of the page (scroll-independent) and viewport boxes of the fixed bar.
// The sticky header is left out: the page scrolls between steps; boxes are absolute.
const SHIFT = ['.set-sec', '.set-sec .sec-head', '.mode-panel', '.rt-row', '.field', '.field .f-k', '.field .f-in', '.wrow', '.tbl', 'footer.foot'];
const ABOVE_LOG = ['#set-mode', '#set-runtime', '.rt-row', ...M.GROUPS.map(g => `#set-${g.id}`), '#setMain [data-row]', '#setMain [data-row] .f-in', '#set-how', '#set-source .sec-head'];
const rects = list => ev(`__audit.rects(${J(list)})`);
const bar = () => ev(`[...document.querySelectorAll('#editbar, #editNote, .edit-btns, #editbar .btn')].map((e, i) => { const r = e.getBoundingClientRect(); return { key: (e.id || e.className) + '#' + i, top: r.top, left: r.left, height: r.height, width: r.width }; })`);
const note = () => ev(`({ state: document.getElementById('editNote').dataset.state, text: document.getElementById('editNote').innerText.trim(), buttons: ['discardBtn', 'savePreview', 'reviewBtn', 'sendBtn'].map(id => !document.getElementById(id).disabled) })`);
const toastText = () => ev(`(() => { const t = document.getElementById('toast'); return t.classList.contains('on') ? t.innerText.trim() : null; })()`);
const posts = since => page.requests.slice(since).filter(r => r.method !== 'GET');
const fieldSel = key => `#setMain [data-field="${key}"]`;
const setFont = async font => { await ev(font ? `document.documentElement.style.setProperty('--font', ${J(font)})` : `document.documentElement.style.removeProperty('--font')`); await settle(page); };
const resetToast = () => ev(`document.getElementById('toast').classList.remove('on')`);

async function openSettings(b, viewport, theme, { font = null } = {}) {
  await configure(page, viewport, theme);
  await load(page, b.url, 'settings');
  await waitFor(page, `document.querySelector('#rtRows .rt-row') && document.querySelector('#log li')`);
  if (font) await setFont(font);
  await ev('window.scrollTo(0, 0)');
  await settle(page);
}

// ---------- Checks shared by the screens ----------
async function keyChecks(tag) {
  const seen = await ev(`(() => { const out = {}; const els = [...document.querySelectorAll('#setMain [data-key]')].filter(__audit.visible);
    for (const k of ${J(LEAVES)}) out[k] = els.filter(e => e.dataset.key === k).map(e => ({ text: e.textContent, mono: /mono|Menlo|Consolas|monospace/i.test(getComputedStyle(e).fontFamily) }));
    return { out, order: [...document.querySelectorAll('#setMain > .set-sec')].map(s => s.id) }; })()`);
  const missing = LEAVES.filter(k => !seen.out[k].some(e => e.text === k && e.mono));
  check('AC-22', `${tag}: all ${LEAVES.length} leaf keys of fleet-config.schema.json appear as data-key with visible mono text`, !missing.length, missing);
  check('AC-22', `${tag}: Settings starts with Mode, then Runtime state, in the spec's section order`, J(seen.order) === J(SECTION_IDS), seen.order);
}

async function editabilityChecks(tag, viewport, fleet) {
  if (viewport.mobile) {
    const ph = await ev(`({ inputs: [...document.querySelectorAll('#scr-settings input, #scr-settings select, #scr-settings textarea, #scr-settings [role=switch], #scr-settings [data-bump], #scr-settings .tog, #scr-settings [data-wwdel], #wwAdd')].filter(__audit.visible).length,
      note: __audit.visible(document.querySelector('.set-phone-note')) ? document.querySelector('.set-phone-note').innerText.trim() : null, bar: __audit.visible(document.getElementById('editbar')),
      values: Object.fromEntries([...document.querySelectorAll('#setMain [data-row]')].map(r => [r.dataset.row, [...r.querySelectorAll('.phone-only [data-value], .ro:not(.phone-only) [data-value]')].filter(__audit.visible).map(e => e.innerText.trim()).join(' | ')])) })`);
    check('AC-23', `${tag}: phones show the phone note, no inputs and no edit bar`, ph.inputs === 0 && ph.note === 'Read-only on a phone. Change fleet settings on a larger screen.' && !ph.bar, ph);
    const base = M.valuesOf(fleet), wrong = [];
    for (const k of M.EDITABLE) {
      const f = M.FIELD[k];
      const want = f.type === 'windows' ? JSON.parse(base[k]).map(w => M.display(f, J([w]))).join('') : M.display(f, base[k]);
      if (N(ph.values[k]).replace(/ /g, '') !== N(want).replace(/ /g, '')) wrong.push({ k, got: ph.values[k], want });
    }
    check('AC-23', `${tag}: phones show every editable value read-only, as saved`, !wrong.length, wrong);
    return;
  }
  const rows = await ev(`[...document.querySelectorAll('#setMain [data-row]')].map(r => ({ key: r.dataset.row,
    controls: [...r.querySelectorAll('input, select, textarea, [role=switch], [data-bump], .tog, #wwAdd, [data-wwdel]')].filter(__audit.visible).length,
    lock: [...r.querySelectorAll('.ro use')].some(u => /#i-(lock|ring)$/.test(u.getAttribute('href')) && __audit.visible(u.closest('.ro'))), why: r.querySelector('.ro-why')?.textContent.trim() ?? '' }))`);
  const bad = rows.filter(r => r.key !== 'routine-health' && (M.EDITABLE.includes(r.key) ? r.controls === 0 : r.controls > 0 || !r.lock || !r.why));
  check('AC-23', `${tag}: today's ${M.EDITABLE.length} editable settings have controls; every other one is read-only with a lock and its reason`, !bad.length && rows.length === M.FIELDS.length + 1, bad);
}

const RT_LABELS = ['Trading mode', 'Emergency stop', 'Broker connection', 'Paper executor', 'Board data', 'Board status', 'Paper account'];
const runtime = () => ev(`[...document.querySelectorAll('#rtRows .rt-row')].map(r => ({ lab: r.querySelector('.lab').innerText.trim(), val: r.querySelector('.val').innerText.trim(), src: r.querySelector('.src').innerText.trim() }))`);
async function leakChecks(tag) {
  const leak = await ev(`(() => { const html = document.documentElement.outerHTML, text = document.body.innerText;
    return { token: html.includes(${J(TOKEN)}), fullAccount: /DU[0-9]{3,}/.test(html), env: /\\b[A-Z][A-Z0-9_]{2,}=[^\\s]/.test(text), long: text.match(/[A-Za-z0-9+_=-]{40,}/g) ?? [], refs: [...document.querySelectorAll('.secret')].map(s => s.innerText.trim()) }; })()`);
  check('AC-25', `${tag}: no secret, token, full account number or environment content anywhere (the account hint is masked)`, !leak.token && !leak.fullAccount && !leak.env && !leak.long.length && leak.refs.every(r => /redacted$/.test(r)), leak);
}

// ---------- 1 · Clean: the design settings at every viewport and theme ----------
try {
  if (run('design')) {
    const fleet = designFleet();
    const b = await designBoard({ fleet });
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme}`;
      await openSettings(b, viewport, theme);
      await auditScreen(page, viewport, theme, 'settings');
      await shot(page, viewport, `${viewport.name}-${theme}-settings`, 'Settings, design fleet settings (version 12): clean');
      await keyChecks(tag);
      await editabilityChecks(tag, viewport, fleet);
      const rt = await runtime();
      const want = ['Paper · the board data and the fleet settings both say paper', 'Off · paper trading is not paused', 'Answering · checked 18 s ago (19:42:13)',
        'Running · broker reachable · brakes off · checked 19:42:13', 'Last numbers 19:42:22 · 9 s old · refreshes every 15 s', 'Board OK · numbers are up to date', 'DU…0597 · € 31.482,75 · checked 9 s ago'];
      const srcs = ['mode', 'safety.halt', 'safety.gateway', 'GET /v1/health on hsb0', 'generatedAt', 'boardHealth', 'brokerAccount.accountHint'];
      check('AC-25', `${tag}: Runtime state shows the seven rows with their sources`, J(rt.map(r => r.lab)) === J(RT_LABELS) && rt.every((r, i) => N(r.val) === N(want[i]) && r.src === srcs[i]), rt);
      await leakChecks(tag);
      // AC-27: the § 8.5 sections and their copy.
      const copy = await ev(`({ how: [...document.querySelectorAll('#set-how .how li')].map(l => l.innerText.trim()), howEnd: document.querySelector('#set-how .how-end').innerText.trim(),
        where: [...document.querySelectorAll('#srcFacts dt')].map(d => d.innerText.trim()), whereDd: [...document.querySelectorAll('#srcFacts dd')].map(d => d.innerText.trim()),
        sources: [...document.querySelectorAll('#set-source tbody tr')].map(r => [...r.cells].map(c => c.innerText.trim())),
        log: [...document.querySelectorAll('#log li')].map(l => l.innerText.replace(/\\s+/g, ' ').trim()), logIntro: document.querySelector('#set-log .sec-head p').innerText.trim(),
        app: [...document.querySelectorAll('#set-appearance [data-themeopt]')].map(b => [b.innerText.trim(), b.getAttribute('aria-pressed')]), appIntro: document.querySelector('#set-appearance .sec-head p').innerText.trim(),
        about: [...document.querySelectorAll('#set-about .ver li')].map(l => l.innerText.replace(/\\s+/g, ' ').trim()), aboutIntro: document.querySelector('#set-about .sec-head p').innerText.trim(),
        sub: document.getElementById('setSub').innerText.trim() })`);
      check('AC-27', `${tag}: How fleet settings work has its five steps and closing line`, copy.how.length === 5 && /^1\s*Change a value/.test(copy.how[0]) && /Review changes/.test(copy.how[1]) && /Confirm review/.test(copy.how[2]) && /Send to the desks/.test(copy.how[3]) && /Save draft/.test(copy.how[4]) && /Passwords, tokens, broker access/.test(copy.howEnd), copy.how);
      check('AC-27', `${tag}: Where this is defined lists the file, version and last send, and Sources has one home per setting`, J(copy.where) === J(['Format', 'Format name', 'Saved version', 'Saved at', 'File the board reads', 'Last sent']) &&
        N(copy.whereDd[2]) === 'Version 12 · fc-000012 rev' && N(copy.whereDd[3]) === '9 Oct 2026, 20:12:44 Vienna updatedAt' && / · the shared file$/.test(N(copy.whereDd[4])) && N(copy.whereDd[5]) === 'Sent · 9 Oct, 20:12 Vienna · version 12' &&
        copy.sources.length === Object.keys(M.SOURCES).length && copy.sources.every(([, from], i) => from === `fleet-config.json#${Object.keys(M.SOURCES)[i]}`), { where: copy.whereDd, sources: copy.sources.length });
      check('AC-27', `${tag}: the change log lists every send newest first, attributed, with changed keys only`, copy.log.length === 4 && /^Sent 9 Oct, 20:12:44 Version 11 ?12 markus · desks\.maxBusyDesks, quota\.codex\.reservePct$/.test(N(copy.log[0])) &&
        /^Not sent 9 Oct, 20:10:00 Version 11 · not changed markus · the version had changed · desks\.maxBusyDesks$/.test(N(copy.log[1])) && /secret values are never logged/.test(copy.logIntro), copy.log);
      check('AC-27', `${tag}: Appearance offers Light, Dark and System (System chosen with nothing stored), saved in this browser only`, J(copy.app) === J([['Light', 'false'], ['Dark', 'false'], ['System', 'true']]) && copy.appIntro === 'Saved in this browser only.', copy.app);
      check('AC-27', `${tag}: About says what JoeDesk is and lists the version history`, copy.aboutIntro === 'JoeDesk is a read-only paper board: no broker access, no order placement.' && copy.about.length === HISTORY.length && N(copy.about[0]).startsWith(`${HISTORY[0].version} 21 Sep 2026 ${HISTORY[0].title}`), copy.about.slice(0, 2));
      check('AC-22', `${tag}: the title's line names the fleet settings version and paper only`, N(copy.sub) === 'Fleet settings version 12 · paper only', copy.sub);
      // AC-39: a field's Learn tip gives the longer help, where it applies and the key.
      const learn = '#set-desks [data-term="f:desks.maxBusyDesks"]';
      if (viewport.mobile) await tap(learn); else { await ev(`document.querySelector(${J(learn)}).scrollIntoView({ block: 'center' })`); await ev(`document.querySelector(${J(learn)}).focus()`); await settle(page); }
      const tip = await ev(`(() => { const t = document.getElementById('tip'); return { on: t.classList.contains('on'), text: t.innerText, ...__audit.opaque(t) }; })()`);
      check('AC-39', `${tag}: a setting's Learn shows its longer help, where it applies and its exact key on an opaque tip`, tip.on && /A whole number from 1 to 32/.test(tip.text) && /Applies to: Paper learning-desk fleet\./.test(tip.text) && /Term: desks\.maxBusyDesks/.test(tip.text) && tip.bgAlpha === 1 && tip.opacity === 1, tip);
      if (!viewport.mobile) { await mouse(learn); check('AC-39', `${tag}: a click pins the Learn tip`, await ev(`document.getElementById('tip').classList.contains('pinned')`)); }
      await key('Escape');
      check('AC-39', `${tag}: Escape closes the Learn tip`, !(await ev(`document.getElementById('tip').classList.contains('on')`)));
      // AC-26: the sub-nav reaches every section and marks the one in view; nothing moves.
      if (!viewport.mobile) {
        await ev('window.scrollTo(0, 0)'); await settle(page);
        // The sticky header and sub-nav are measured in the window, the rest on the page.
        const PAGE = SHIFT;
        const before = await rects(PAGE);
        const navBefore = await ev(`[...document.querySelectorAll('#setNav a')].map(a => { const r = a.getBoundingClientRect(); return { key: a.dataset.sec, top: r.top, left: r.left, height: r.height, width: r.width }; })`);
        check('AC-26', `${tag}: the sub-nav lists every section in order`, J(navBefore.map(n => n.key)) === J(SECTION_IDS), navBefore.map(n => n.key));
        const faults = [];
        let navMoved = [];
        for (const id of SECTION_IDS) {
          await mouse(`#setNav a[data-sec="${id}"]`, false);
          const r = await ev(`(() => { const s = document.getElementById(${J(id)}).getBoundingClientRect(), h = document.querySelector('header.top').getBoundingClientRect();
            return { marked: [...document.querySelectorAll('#setNav a[aria-current="true"]')].map(a => a.dataset.sec), top: s.top, header: h.bottom, inner: innerHeight }; })()`);
          if (J(r.marked) !== J([id]) || r.top < r.header - 1 || r.top > r.inner - 60) faults.push({ id, ...r });
          const nav = await ev(`[...document.querySelectorAll('#setNav a')].map(a => { const r = a.getBoundingClientRect(); return { key: a.dataset.sec, top: r.top, left: r.left, height: r.height, width: r.width }; })`);
          navMoved = navMoved.concat(shifted(navBefore, nav, ['left', 'height', 'width']), nav.filter(n => Math.abs(n.top - nav[0].top - (navBefore.find(b => b.key === n.key).top - navBefore[0].top)) > 0.5));
        }
        check('AC-26', `${tag}: each of the ${SECTION_IDS.length} sub-nav links brings its section into view below the header and marks it`, !faults.length, faults);
        const pageMoved = shifted(before, await rects(PAGE));
        const stuck = await ev(`(() => { const n = document.getElementById('setNav').getBoundingClientRect(); return n.top; })()`);
        check('AC-26', `${tag}: the sub-nav keeps its links and sticks below the header; section changes move nothing (±0.5 px)`, !navMoved.length && !pageMoved.length && Math.abs(stuck - 78) <= 0.5, { nav: navMoved.slice(0, 3), page: pageMoved.slice(0, 3), stuck });
        // Scrolling by hand marks the section whose top has passed the header.
        const spy = [];
        for (const id of SECTION_IDS) {
          await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 1 });
          const r = await ev(`(() => { const s = document.getElementById(${J(id)}); const want = s.getBoundingClientRect().top + scrollY - document.querySelector('header.top').getBoundingClientRect().bottom - 12;
            const max = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, want); return { capped: want >= max - 2 }; })()`);
          await settle(page); await settle(page);
          const marked = await ev(`[...document.querySelectorAll('#setNav a[aria-current="true"]')].map(a => a.dataset.sec)`);
          const expected = r.capped ? SECTION_IDS.at(-1) : id;
          if (J(marked) !== J([expected])) spy.push({ id, marked, expected });
        }
        check('AC-26', `${tag}: scrolling by hand marks the section in view (the last one once the page ends)`, !spy.length, spy);
        await ev('window.scrollTo(0, 0)'); await settle(page);
      }
    }
    // Absent proposed fields: no executor report and no account hint read "Not reported".
    const bare = await designBoard({ fleet, snapshot: { hint: null, executor: false } });
    for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [PHONE, 'dark']]) {
      const tag = `${viewport.name} ${theme} without executor or account hint`;
      await openSettings(bare, viewport, theme);
      const rt = await runtime();
      check('AC-25', `${tag}: absent proposed fields show "Not reported"`, rt[3].val === 'Not reported' && N(rt[6].val) === 'Account number not reported · € 31.482,75 · checked 9 s ago', rt);
      await auditScreen(page, viewport, theme, 'settings (not reported)');
      await leakChecks(tag);
      if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-settings-not-reported`, 'Settings without the executor report or the account hint: "Not reported"');
    }
  }

  // ---------- 2 · Edited: Edit, Review changes, Confirm, Send; nothing moves ----------
  if (run('edit')) {
    const combos = [[VIEWPORTS[0], 'light', null], [VIEWPORTS[0], 'dark', null], [VIEWPORTS[1], 'light', null], [VIEWPORTS[1], 'dark', null], [VIEWPORTS[0], 'light', WIDE_FONT], [VIEWPORTS[1], 'dark', WIDE_FONT]];
    for (const [viewport, theme, font] of combos) {
      const tag = `${viewport.name} ${theme}${font ? ' wide font' : ''}`;
      const b = await designBoard();
      await openSettings(b, viewport, theme, { font });
      const clean = await note();
      check('AC-24', `${tag}: no changes · version 12 is current; every button off`, N(clean.text) === 'No changes · version 12 is current' && clean.buttons.every(x => !x), clean);
      const base = await rects(SHIFT), baseBar = await bar();
      let moved = [];
      const still = async what => { const m = shifted(base, await rects(SHIFT)).concat(shifted(baseBar, await bar())); if (m.length) moved.push({ what, m: m.slice(0, 3) }); };
      // Edit six settings by their own controls.
      await mouse('[data-bump="1"][data-for="desks.maxBusyDesks"]'); await still('stepper');
      await type(fieldSel('quota.codex.reservePct'), '20'); await still('reserve');
      await mouse('[data-switch="quota.behavior.amber"]'); await still('switch');
      await type(fieldSel('desks.keep'), 'DEMO'); await still('kept holdings');
      await type(fieldSel('cadence.usOpenArm'), '15:40'); await still('time');
      await mouse('[data-wday="0"][data-d="sat"]'); await still('wake window day');
      const dirty = await note();
      const saved = await ev(`Object.fromEntries([...document.querySelectorAll('#setMain [data-saved]')].map(e => [e.dataset.saved, __audit.visible(e) ? e.textContent : '']))`);
      check('AC-24', `${tag}: six changes in the draft; review before you send`, N(dirty.text) === '6 changes in your draft · review before you send' && J(dirty.buttons) === J([true, true, true, false]), dirty);
      check('AC-24', `${tag}: each changed setting shows its saved value; the reserve's meter and example follow the draft`,
        N(saved['desks.maxBusyDesks']) === 'Saved: 5 desks' && N(saved['quota.codex.reservePct']) === 'Saved: 15 %' && N(saved['quota.behavior.amber']) === 'Saved: Slow down nonessential work' && N(saved['desks.keep']) === 'Saved: SXR8, TSLA' &&
        N(saved['cadence.usOpenArm']) === 'Saved: 15:35 Vienna time' && N(saved['cadence.wakeWindows']) === 'Saved: 2 wake windows · Review changes lists every difference' && saved['quota.grok.reservePct'] === '' &&
        N(await ev(`document.querySelector('[data-example="quota.codex.reservePct"]').textContent`)) === 'Keeps 20 of every 100 units free' && (await ev(`document.querySelector('[data-meter="quota.codex.reservePct"]').style.width`)) === '20%', saved);
      // Review changes: the dialog with Before and After, the review tick, then Confirm.
      await mouse('#reviewBtn');
      const dlg = await ev(`(() => { const d = document.getElementById('diffDlg'); return { open: d.open, head: d.querySelector('h2').innerText, base: document.getElementById('diffBase').innerText, rows: [...d.querySelectorAll('#diffList li')].map(l => l.innerText.replace(/\\s+/g, ' ').trim()),
        confirm: document.getElementById('diffConfirm').disabled, ticked: document.getElementById('diffReviewed').checked, active: document.activeElement?.id, outline: getComputedStyle(document.activeElement).outlineStyle, ...__audit.opaque(d) }; })()`);
      const rowsWant = [['Busy desks at once', 'desks.maxBusyDesks', '5 desks', '6 desks'], ['Capital cap per desk'], ['Kept holdings', 'desks.keep', 'SXR8, TSLA', 'SXR8, TSLA, DEMO']];
      check('AC-24', `${tag}: Review changes opens "Check what will change" for version 12 with every Before and After; Confirm waits for the tick`, dlg.open && dlg.head === 'Check what will change' && dlg.base === 'Version 12' && dlg.rows.length === 6 &&
        N(dlg.rows[0]) === 'Busy desks at once desks.maxBusyDesks Before: 5 desks After: 6 desks' && dlg.rows.some(r => N(r) === 'Kept holdings desks.keep Before: SXR8, TSLA After: SXR8, TSLA, DEMO') &&
        dlg.rows.some(r => N(r) === 'When capacity gets low quota.behavior.amber Before: Slow down nonessential work After: Park nonessential work') && dlg.confirm && !dlg.ticked && dlg.bgAlpha === 1, { dlg, rowsWant: rowsWant.length });
      check('AC-33', `${tag}: opened by the pointer, focus is in the dialog's heading without a ring`, dlg.active === 'diffTitle' && dlg.outline === 'none', dlg);
      await still('review dialog');
      if (viewport.name === '1440' && !font) await viewShot(`${viewport.name}-${theme}-settings-review`, 'Settings: Review changes, Before and After of six settings, the review tick');
      await mouse('#diffDlg .check');
      check('AC-24', `${tag}: the review tick enables Confirm review`, !(await ev(`document.getElementById('diffConfirm').disabled`)));
      await mouse('#diffConfirm');
      const confirmed = await note();
      check('AC-24', `${tag}: Confirm review closes the dialog: six changes reviewed, ready to send as version 13`, !(await ev(`document.getElementById('diffDlg').open`)) && N(confirmed.text) === '6 changes reviewed · ready to send as version 13' && J(confirmed.buttons) === J([true, true, true, true]) &&
        (await toastText()) === 'Review confirmed for version 12.', confirmed);
      await still('confirm and toast');
      // Section changes from the sub-nav, in this font too.
      for (const id of ['set-log', 'set-cadence', 'set-about', 'set-mode']) {
        await mouse(`#setNav a[data-sec="${id}"]`, false);
        const marked = await ev(`document.querySelector('#setNav a[aria-current="true"]')?.dataset.sec`);
        if (marked !== id) moved.push({ what: `section ${id} not marked`, marked });
        await still(`section ${id}`);
      }
      check('no-shift', `${tag}: edits, the Saved lines, the review dialog, the confirmation, the toast and section changes move nothing (±0.5 px)`, !moved.length, moved);
      if (viewport.name === '1440' && !font) await viewShot(`${viewport.name}-${theme}-settings-reviewed`, 'Settings: six changes reviewed, ready to send as version 13 (edit bar, toast)');
      // Send to the desks: one POST, a paper draft of version 12; version 13 is written.
      const since = page.requests.length;
      const aboveLog = await rects(ABOVE_LOG);
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'sent'`);
      await waitFor(page, `document.querySelector('#log li')?.innerText.includes('${ACTOR}')`);
      const sent = posts(since);
      const body = sent[0]?.postData ? JSON.parse(sent[0].postData) : null;
      const c = body?.config;
      check('AC-24', `${tag}: Send to the desks makes exactly one POST to ${PROPAGATE}: { baseRev, config }, paper, kept floor intact`, sent.length === 1 && new URL(sent[0].url).pathname === PROPAGATE && body.baseRev === 'fc-000012' && c.rev === 'fc-000012' && c.mode === 'paper' &&
        J(c.desks.keep) === J(['SXR8', 'TSLA', 'DEMO']) && c.desks.maxBusyDesks === 6 && c.quota.codex.reservePct === 20 && c.quota.behavior.amber === 'park_nonessential' && c.cadence.usOpenArm === '15:40' &&
        J(c.cadence.wakeWindows[0].days) === J(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']) && J(c.tools) === J(designFleet().tools) && J(c.secretSlots) === J(designFleet().secretSlots), { sent: sent.map(r => r.url), body });
      const after = await note();
      const tst = await toastText();
      const page2 = await ev(`({ sub: document.getElementById('setSub').innerText.trim(), saved: [...document.querySelectorAll('#setMain [data-saved]')].filter(__audit.visible).map(e => e.textContent).join(''), log0: document.querySelector('#log li').innerText.replace(/\\s+/g, ' ').trim(),
        last: document.querySelectorAll('#srcFacts dd')[5].innerText.trim(), rev: document.querySelectorAll('#srcFacts dd')[2].innerText.trim(), busy: document.querySelector('${fieldSel('desks.maxBusyDesks')}').value })`);
      check('AC-24', `${tag}: sent: the edit bar says version 13 is saved and the desks' reload is not confirmed; the toast names the keys`, N(after.text) === 'Sent version 13 · saved to the shared file. The desks’ reload is not confirmed.' &&
        /^Sent version 13 to the desks: .*desks\.maxBusyDesks.*\. Amy and the desks pick it up on their next read; this board cannot confirm that\.$/.test(N(tst)) && J(after.buttons) === J([false, false, false, false]), { after, tst });
      check('AC-24', `${tag}: the page shows version 13: values saved, the change log attributes the send, Where this is defined updates`, N(page2.sub) === 'Fleet settings version 13 · paper only' && page2.saved === '' && page2.busy === '6' &&
        new RegExp(`^Sent .* Version 12 ?13 ${ACTOR} · `).test(N(page2.log0)) && /desks\.maxBusyDesks/.test(page2.log0) && /^Sent · \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d Vienna · version 13$/.test(N(page2.last)) && N(page2.rev) === 'Version 13 · fc-000013 rev', page2);
      const stored = await served(b);
      check('AC-24', `${tag}: the board server holds version 13, paper, with the reviewed changes`, stored.rev === 'fc-000013' && stored.mode === 'paper' && stored.desks.maxBusyDesks === 6 && J(stored.desks.keep) === J(['SXR8', 'TSLA', 'DEMO']), { rev: stored.rev });
      const afterLog = shifted(aboveLog, await rects(ABOVE_LOG));
      check('no-shift', `${tag}: sending moves nothing above the change log (±0.5 px)`, !afterLog.length, afterLog.slice(0, 4));
      if (viewport.name === '1440' && !font) {
        await viewShot(`${viewport.name}-${theme}-settings-sent`, 'Settings: sent as version 13 (edit bar outcome, toast)');
        await auditScreen(page, viewport, theme, 'settings (sent)');
      }
      await resetToast();
    }
    // Save draft, reload, Discard; an invalid value stops at its message.
    {
      const viewport = VIEWPORTS[1], tag = `${viewport.name} light draft`;
      const b = await designBoard();
      await openSettings(b, viewport, 'light');
      await type(fieldSel('amy.routines.close'), 'Close of day recap');
      await mouse('#savePreview');
      check('AC-24', `${tag}: Save draft keeps the draft in this browser for version 12`, (await toastText()) === 'Draft saved in this browser for version 12.' &&
        JSON.parse(await ev(`localStorage.getItem('joe-fleet-config-preview-v1')`)).baseRev === 'fc-000012');
      await load(page, b.url, 'settings');
      await waitFor(page, `document.querySelector('${fieldSel('amy.routines.close')}')?.value === 'Close of day recap'`);
      const restored = await note();
      check('AC-24', `${tag}: after a reload the saved draft is back, still to be reviewed`, N(restored.text) === '1 change in your draft · review before you send' && N(await ev(`document.querySelector('[data-saved="amy.routines.close"]').textContent`)) === 'Saved: Close recap', restored);
      await mouse('#discardBtn');
      const discarded = await note();
      check('AC-24', `${tag}: Discard restores the saved settings and forgets the draft`, (await toastText()) === 'Draft discarded. The fields show the saved settings again.' && N(discarded.text) === 'No changes · version 12 is current' &&
        (await ev(`document.querySelector('${fieldSel('amy.routines.close')}').value`)) === 'Close recap' && (await ev(`localStorage.getItem('joe-fleet-config-preview-v1')`)) === null, discarded);
      const since = page.requests.length;
      await type(fieldSel('cadence.usOpenArm'), '9:30');
      await mouse('#reviewBtn');
      check('AC-24', `${tag}: an invalid value stops at its message in a toast; no dialog, no request`, (await toastText()) === 'Earliest US-open start must use 24-hour time like 15:35.' && !(await ev(`document.getElementById('diffDlg').open`)) && !posts(since).length);
      await mouse('#discardBtn');
      await resetToast();
    }
  }

  // ---------- 3 · Stale version: another send wins; the conflict is surfaced and audited ----------
  if (run('stale')) {
    for (const viewport of DESKTOP) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme} stale`;
      const b = await designBoard();
      await openSettings(b, viewport, theme);
      await mouse('[data-bump="1"][data-for="desks.maxBusyDesks"]');
      await mouse('#reviewBtn'); await mouse('#diffDlg .check'); await mouse('#diffConfirm');
      // Another reviewer sends version 13 first.
      const other = designFleet(); other.quota.codex.reservePct = 25;
      const r = await fetch(`${b.url}fleet-config/propagate`, { method: 'POST', headers: { 'x-auth-request-user': 'amy', origin: `http://127.0.0.1:${b.port}`, 'content-type': 'application/json' }, body: J({ baseRev: 'fc-000012', config: other }) });
      check('AC-24', `${tag}: another send writes version 13 first`, r.status === 200, r.status);
      const since = page.requests.length;
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'failed'`);
      await waitFor(page, `document.querySelector('#log li')?.innerText.includes('the version had changed')`);
      const failed = await note(), tst = await toastText();
      const body = JSON.parse(posts(since)[0]?.postData ?? 'null');
      check('AC-24', `${tag}: the stale send reads "revision changed to fc-000013; reload before retrying" in the edit bar and the toast`, N(failed.text) === 'Not sent · version 12 was not confirmed as written: revision changed to fc-000013; reload before retrying.' &&
        N(tst) === 'Sending failed for version 12 (desks.maxBusyDesks): revision changed to fc-000013; reload before retrying.' && posts(since).length === 1 && body?.baseRev === 'fc-000012' && body.config.mode === 'paper', { failed, tst });
      const log = await ev(`[...document.querySelectorAll('#log li')].slice(0, 2).map(l => l.innerText.replace(/\\s+/g, ' ').trim())`);
      // The server lists every key in which the stale draft differs from the current version.
      check('AC-24', `${tag}: the conflict is audited: "Not sent · the version had changed", attributed, below it the other send`, new RegExp(`^Not sent .* Version 13 · not changed ${ACTOR} · the version had changed · (quota\\.codex\\.reservePct, )?desks\\.maxBusyDesks$`).test(N(log[0])) && /^Sent .* Version 12 ?13 amy · quota\.codex\.reservePct$/.test(N(log[1])), log);
      check('AC-24', `${tag}: the draft is kept for the reader to reload; nothing of it was written`, (await ev(`document.querySelector('${fieldSel('desks.maxBusyDesks')}').value`)) === '6' && J(failed.buttons) === J([true, true, true, false]) &&
        (await served(b)).desks.maxBusyDesks === 5 && (await served(b)).rev === 'fc-000013');
      if (viewport.name === '1440') await viewShot(`${viewport.name}-${theme}-settings-stale`, 'Settings: a stale version, "revision changed to fc-000013; reload before retrying"');
      await auditScreen(page, viewport, theme, 'settings (stale version)');
      // Reload (Discard) takes version 13; the retry is reviewed and sent as version 14.
      await mouse('#discardBtn');
      check('AC-24', `${tag}: Discard takes the newest saved version`, N((await note()).text) === 'No changes · version 13 is current' && (await ev(`document.querySelector('${fieldSel('quota.codex.reservePct')}').value`)) === '25');
      await mouse('[data-bump="1"][data-for="desks.maxBusyDesks"]');
      await mouse('#reviewBtn'); await mouse('#diffDlg .check'); await mouse('#diffConfirm');
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'sent'`);
      check('AC-24', `${tag}: the retry after the reload is sent as version 14`, N((await note()).text).startsWith('Sent version 14') && (await served(b)).rev === 'fc-000014');
      await resetToast();
    }
  }

  // ---------- 4 · Send failures: the store fails, the server is gone, the settings cannot be read ----------
  if (run('failure')) {
    for (const viewport of DESKTOP) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme} failure`;
      const b = await designBoard();
      await openSettings(b, viewport, theme);
      const ready = async () => { await mouse('#reviewBtn'); await mouse('#diffDlg .check'); await mouse('#diffConfirm'); };
      await type(fieldSel('cadence.deskWatch'), 'desk-watch-two');
      await ready();
      await intercept({ match: 'fleet-config/propagate', answer: () => ({ status: 500, body: { ok: false, error: 'fleet config store failed' } }) });
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'failed'`);
      check('AC-24', `${tag}: a failed write (a plain 500): "version 12 was not confirmed as written: fleet config store failed"; the draft stays`, N((await note()).text) === 'Not sent · version 12 was not confirmed as written: fleet config store failed.' &&
        N(await toastText()) === 'Sending failed for version 12 (cadence.deskWatch): fleet config store failed.' && (await ev(`document.querySelector('${fieldSel('cadence.deskWatch')}').value`)) === 'desk-watch-two');
      if (viewport.name === '1440') await viewShot(`${viewport.name}-${theme}-settings-failed`, 'Settings: the send failed, the draft stays');
      await auditScreen(page, viewport, theme, 'settings (send failed)');
      await ready();
      await intercept({ match: 'fleet-config/propagate', answer: () => ({ fail: 'ConnectionRefused' }) });
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'failed' && document.getElementById('editNote').innerText.includes('did not answer')`);
      check('AC-24', `${tag}: no answer: "the board server did not answer"`, N((await note()).text) === 'Not sent · version 12 was not confirmed as written: the board server did not answer.');
      await intercept(null);
      // A real, audited failure: the server cannot read its stored settings.
      if (process.getuid?.() !== 0) {
        await ready();
        const file = join(b.dataDir, 'fleet-config.json'), mode = statSync(file).mode;
        chmodSync(file, 0o000);
        try {
          await mouse('#sendBtn'); sends++;
          await waitFor(page, `document.querySelector('#log li')?.innerText.includes('could not be read')`);
          check('AC-24', `${tag}: the server's own failure is surfaced and audited ("the saved settings could not be read")`, N((await note()).text) === 'Not sent · version 12 was not confirmed as written: fleet config unavailable.' &&
            new RegExp(`^Not sent .* ${ACTOR} · the saved settings could not be read`).test(N(await ev(`document.querySelector('#log li').innerText`))));
        } finally { chmodSync(file, mode); }
      }
      // Stored, change log unfinished: the board server writes version 13 but
      // cannot finish its change-log entry (it stays pending) and answers 500
      // naming the version stored. Written: never "Not sent", never a clean success.
      await ready();
      await intercept({ match: 'fleet-config/propagate', answer: async req => {
        const r = await fetch(`${b.url}fleet-config/propagate`, { method: 'POST', headers: { 'x-auth-request-user': ACTOR, origin: `http://127.0.0.1:${b.port}`, 'content-type': 'application/json' }, body: req.postData });
        const done = await r.json();
        const file = join(b.dataDir, 'fleet-config-actions.json'), log = JSON.parse(readFileSync(file, 'utf8'));
        log.entries[log.entries.length - 1] = { ...log.entries.at(-1), outcome: 'pending', reason: 'write_started' };
        writeFileSync(file, J(log));
        return { status: 500, body: { ok: false, error: 'fleet config stored but action log finalization failed', currentRev: done.rev } };
      } });
      const aboveLog = await rects(ABOVE_LOG);
      await mouse('#sendBtn'); sends++;
      await waitFor(page, `document.getElementById('editNote').dataset.state === 'stored'`);
      const stored = await note(), storedToast = await toastText();
      await waitFor(page, `document.getElementById('setSub').innerText.includes('version 13') && document.querySelector('#log li')?.dataset.outcome === 'pending'`);
      const back = await ev(`({ sub: document.getElementById('setSub').innerText.trim(), log0: document.querySelector('#log li').innerText.replace(/\\s+/g, ' ').trim(), last: document.querySelectorAll('#srcFacts dd')[5].innerText.trim(),
        value: document.querySelector('${fieldSel('cadence.deskWatch')}').value, saved: [...document.querySelectorAll('#setMain [data-saved]')].filter(__audit.visible).map(e => e.textContent).join(''), note: document.getElementById('editNote').innerText.trim() })`);
      check('AC-24', `${tag}: stored but the change log unfinished (a 500 naming fc-000013): "Sent version 13 · saved to the shared file, but the change log could not record it", never "Not sent"`,
        N(stored.text) === 'Sent version 13 · saved to the shared file, but the change log could not record it. The desks’ reload is not confirmed.' && J(stored.buttons) === J([false, false, false, false]) &&
        N(storedToast) === 'Sent version 13 to the desks: cadence.deskWatch. The change log could not record it and shows it as pending. Amy and the desks pick it up on their next read; this board cannot confirm that.' &&
        !/Not sent|failed/.test(`${stored.text} ${storedToast}`), { stored, storedToast });
      check('AC-24', `${tag}: stored: the page reads version 13 back, the outcome stays, and the change log shows the send pending, attributed`, N(back.sub) === 'Fleet settings version 13 · paper only' && back.value === 'desk-watch-two' && back.saved === '' && N(back.note) === N(stored.text) &&
        new RegExp(`^Pending .* Version 12 ?13 · not confirmed ${ACTOR} · writing started; no outcome recorded · .*cadence\\.deskWatch`).test(N(back.log0)) && /^Pending · \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d Vienna · version 13$/.test(N(back.last)) &&
        (await served(b)).rev === 'fc-000013' && (await served(b)).cadence.deskWatch === 'desk-watch-two', back);
      check('no-shift', `${tag}: the stored outcome moves nothing above the change log (±0.5 px)`, !shifted(aboveLog, await rects(ABOVE_LOG)).length, shifted(aboveLog, await rects(ABOVE_LOG)).slice(0, 4));
      if (viewport.name === '1440') await viewShot(`${viewport.name}-${theme}-settings-stored`, 'Settings: stored as version 13, but the change log could not record it (warn outcome, toast; the log shows it pending)');
      await auditScreen(page, viewport, theme, 'settings (stored, change log unfinished)');
      await intercept(null);
      await resetToast();
    }
  }

  // ---------- 5a · Long saved values: the Saved box is sized before any edit ----------
  if (run('long')) {
    const fleet = longFleet(), b = await designBoard({ fleet });
    const KEEP_SAVED = `Saved: ${M.display(M.FIELD['desks.keep'], M.keepExtras(fleet.desks.keep).join(','))}`;
    const combos = [[VIEWPORTS[0], 'light', null], [VIEWPORTS[0], 'dark', WIDE_FONT], [VIEWPORTS[1], 'dark', null], [VIEWPORTS[1], 'light', WIDE_FONT]];
    for (const [viewport, theme, font] of combos) {
      const tag = `${viewport.name} ${theme}${font ? ' wide font' : ''} long values`;
      await openSettings(b, viewport, theme, { font });
      const base = await rects(SHIFT), baseBar = await bar();
      const moved = [];
      const still = async what => { const m = shifted(base, await rects(SHIFT)).concat(shifted(baseBar, await bar())); if (m.length) moved.push({ what, m: m.slice(0, 3) }); };
      // The 64 kept holdings lose one; the longest routine and check-in names get short.
      await type(fieldSel('desks.keep'), M.keepExtras(fleet.desks.keep).slice(0, -1).join(',')); await still('64 kept holdings');
      await type(fieldSel('cadence.deskWatch'), 'desk-watch'); await still('64-character routine name');
      await type(fieldSel('amy.routines.close'), 'Close recap'); await still('80-character check-in name');
      const boxes = await ev(`[...document.querySelectorAll('#setMain [data-saved]')].filter(__audit.visible).map(e => { const r = e.getBoundingClientRect(), lh = parseFloat(getComputedStyle(e).lineHeight);
        const top = e.scrollTop; e.scrollTop = e.scrollHeight; const end = e.scrollTop + e.clientHeight >= e.scrollHeight - 1; e.scrollTop = top;
        return { key: e.dataset.saved, text: e.textContent, height: r.height, lines: r.height / lh, scrolls: e.scrollHeight > e.clientHeight + 1, focusable: e.tabIndex === 0, end }; })`);
      const keep = boxes.find(x => x.key === 'desks.keep');
      check('no-shift', `${tag}: the three Saved lines show the whole saved values (${KEEP_SAVED.length} characters for the kept holdings)`, boxes.length === 3 && keep?.text === KEEP_SAVED &&
        boxes.find(x => x.key === 'cadence.deskWatch')?.text === `Saved: ${fleet.cadence.deskWatch}` && boxes.find(x => x.key === 'amy.routines.close')?.text === `Saved: ${fleet.amy.routines.close}`, boxes.map(x => ({ ...x, text: x.text.slice(0, 60) })));
      check('no-shift', `${tag}: a Saved box shows whole lines, at most three; past that it scrolls to its end and takes focus`, boxes.every(x => Math.abs(x.lines - Math.round(x.lines)) < 0.02 && x.lines <= 3.02 && x.focusable === x.scrolls && (!x.scrolls || x.end)) && keep?.scrolls, boxes.map(x => ({ ...x, text: undefined })));
      await mouse('#reviewBtn'); await still('review dialog');
      const rows = await ev(`[...document.querySelectorAll('#diffList li')].map(l => l.innerText.replace(/\\s+/g, ' ').trim())`);
      check('AC-24', `${tag}: Review changes shows the long Before values whole`, rows.length === 3 && rows.some(r => r.includes(`Before: ${KEEP_SAVED.slice('Saved: '.length)}`)), rows.map(r => r.slice(0, 80)));
      await mouse('#diffDlg .check'); await mouse('#diffConfirm'); await still('confirm and toast');
      for (const id of ['set-log', 'set-desks']) { await mouse(`#setNav a[data-sec="${id}"]`, false); await still(`section ${id}`); }
      if (viewport.name === '1440' && !font) {
        await ev(`document.getElementById('set-desks').scrollIntoView({ block: 'start' })`); await settle(page);
        await viewShot(`${viewport.name}-${theme}-settings-long-values`, 'Settings with the longest values: 64 kept holdings edited; the Saved box keeps three lines and scrolls; nothing moved');
      }
      await auditScreen(page, viewport, theme, 'settings (long values edited)');
      await mouse('#discardBtn'); await still('discard');
      check('no-shift', `${tag}: editing the longest values, their Saved lines, the review, the confirmation, the toast, section changes and Discard move nothing (±0.5 px)`, !moved.length, moved);
      await resetToast();
    }
    // Phones: the long values are shown whole, read-only; the gate and its toast move nothing.
    for (const [theme, font] of [['light', null], ['dark', WIDE_FONT]]) {
      const tag = `390 ${theme}${font ? ' wide font' : ''} long values`;
      await openSettings(b, PHONE, theme, { font });
      const shown = await ev(`Object.fromEntries([...document.querySelectorAll('#setMain [data-row]')].map(r => [r.dataset.row, [...r.querySelectorAll('.phone-only [data-value]')].filter(__audit.visible).map(e => e.innerText.trim()).join('')]))`);
      check('AC-23', `${tag}: phones show the long values whole, read-only`, N(shown['desks.keep']) === N(KEEP_SAVED.slice('Saved: '.length)) && shown['cadence.deskWatch'] === fleet.cadence.deskWatch && shown['amy.routines.close'] === fleet.amy.routines.close, Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, v.slice(0, 60)])));
      await auditScreen(page, PHONE, theme, 'settings (long values)');
      const base = await rects(SHIFT);
      await tap('#liveOpen'); await key('Escape');
      const toastNow = await toastText();
      check('no-shift', `${tag}: opening and closing the LIVE gate, and its toast, move nothing (±0.5 px)`, toastNow === 'Still on PAPER. Nothing was sent and the mode did not change.' && !shifted(base, await rects(SHIFT)).length, shifted(base, await rects(SHIFT)).slice(0, 3));
      if (!font) await shot(page, PHONE, `390-${theme}-settings-long-values`, 'Settings on a phone with the longest values, read-only and whole');
      await resetToast();
    }
  }

  // ---------- 5b · A malformed browser draft: dropped with the discard words; every group renders ----------
  if (run('draft')) {
    const b = await designBoard();
    const bad = { 'wake windows "null"': { 'desks.maxBusyDesks': '7', 'cadence.wakeWindows': 'null' }, 'a window without desks': { 'cadence.wakeWindows': J([{ id: 'a', days: ['mon'], from: '09:00', until: '17:00' }]) }, 'a key that is not editable': { mode: 'live' } };
    const cases = [[VIEWPORTS[0], 'light', 'wake windows "null"'], [VIEWPORTS[1], 'dark', 'a window without desks'], [PHONE, 'light', 'wake windows "null"'], [PHONE, 'dark', 'a key that is not editable']];
    for (const [viewport, theme, which] of cases) {
      const tag = `${viewport.name} ${theme} draft with ${which}`;
      await openSettings(b, viewport, theme);
      await ev(`localStorage.setItem('joe-fleet-config-preview-v1', ${J(J({ baseRev: 'fc-000012', values: bad[which] }))})`);
      await load(page, b.url, 'settings');
      await waitFor(page, `document.querySelector('#rtRows .rt-row') && document.querySelector('#log li') && document.querySelector('#grp-mac [data-row]')`);
      const s = await ev(`({ groups: Object.fromEntries([...document.querySelectorAll('#setMain .fields')].map(g => [g.id, g.querySelectorAll('[data-row]').length])), toast: document.getElementById('toast').classList.contains('on') ? document.getElementById('toast').innerText.trim() : null,
        stored: localStorage.getItem('joe-fleet-config-preview-v1'), note: document.getElementById('editNote').innerText.trim(), windows: document.querySelectorAll('#setMain [data-wrow]').length, busy: document.querySelector('${fieldSel('desks.maxBusyDesks')}')?.value ?? null })`);
      const want = Object.fromEntries(M.GROUPS.map(g => [`grp-${g.id}`, g.fields.length + (g.id === 'cadence' ? 1 : 0)]));
      check('AC-24', `${tag}: the draft is dropped with "Draft discarded. The fields show the saved settings again."`, s.toast === 'Draft discarded. The fields show the saved settings again.' && s.stored === null && (viewport.mobile || (N(s.note) === 'No changes · version 12 is current' && s.busy === '5' && s.windows === 2)), s);
      check('AC-22', `${tag}: every group renders all its settings`, J(s.groups) === J(want), { got: s.groups, want });
      await keyChecks(tag);
      await resetToast();
    }
  }

  // ---------- 5 · Missing settings: the starter file, and unreadable settings with the SXR8/TSLA floor ----------
  if (run('missing')) {
    const starter = await designBoard({ noFleet: true, actions: [] });
    for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [PHONE, 'dark']]) {
      const tag = `${viewport.name} ${theme} starter file`;
      await openSettings(starter, viewport, theme);
      const facts = await ev(`({ sub: document.getElementById('setSub').innerText.trim(), file: document.querySelectorAll('#srcFacts dd')[4].innerText.trim(), last: document.querySelectorAll('#srcFacts dd')[5].innerText.trim(), log: document.getElementById('log').innerText.trim(), floor: document.querySelector('#set-desks .kfloor').innerText.trim() })`);
      check('AC-27', `${tag}: without a stored file the board reads the starter file (version 0); nothing sent yet`, N(facts.sub) === 'Fleet settings version 0 · paper only' && /the starter file; nothing has been sent yet$/.test(N(facts.file)) && facts.last === 'None recorded' && facts.log === 'Nothing has been sent to the desks yet.' && facts.floor === 'SXR8 and TSLA are always kept', facts);
      await keyChecks(tag);
      await auditScreen(page, viewport, theme, 'settings (starter file)');
      await shot(page, viewport, `${viewport.name}-${theme}-settings-starter`, 'Settings with no stored file: the starter file, version 0');
    }
    const broken = await designBoard({ raw: '{ "schema": ', actions: [] });
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme} settings unavailable`;
      await configure(page, viewport, theme);
      await load(page, broken.url, 'settings');
      await waitFor(page, `document.getElementById('setSub').innerText.includes('unavailable')`);
      const s = await ev(`({ sub: document.getElementById('setSub').innerText.trim(), note: document.getElementById('editNote').innerText.trim(), buttons: ['discardBtn', 'savePreview', 'reviewBtn', 'sendBtn'].map(id => document.getElementById(id).disabled),
        inputs: [...document.querySelectorAll('#setMain input, #setMain [role=switch], #setMain [data-bump], #setMain .tog')].length, floor: document.querySelector('#set-desks .kfloor').innerText.trim(),
        values: [...document.querySelectorAll('#setMain .field .ro [data-value]')].filter(__audit.visible).map(e => e.innerText.trim()), mode: document.getElementById('modeLabel').innerText.trim() })`);
      check('AC-24', `${tag}: the settings are unavailable: values hidden, editing disabled, every button off`, N(s.sub) === 'Fleet settings unavailable · paper only' && s.inputs === 0 && s.buttons.every(Boolean) &&
        (viewport.mobile || N(s.note) === 'Fleet settings unavailable · values are hidden and editing is disabled. Reopen Settings to retry.') && s.values.every(v => /^(Not available|Other kept symbols are hidden|Not reported yet)$/.test(v)), s);
      check('KEEP', `${tag}: SXR8 and TSLA are named as always kept`, s.floor === 'SXR8 and TSLA are always kept' && s.mode === 'PAPER', s.floor);
      await keyChecks(tag);
      await auditScreen(page, viewport, theme, 'settings (unavailable)');
      await shot(page, viewport, `${viewport.name}-${theme}-settings-unavailable`, 'Settings when the stored fleet settings cannot be read: values hidden, editing off, the SXR8/TSLA floor named');
      // Desk keeps the safety floor: SXR8 and TSLA only under Kept holdings.
      await ev(`document.querySelector('.nav [data-go="desk"]')?.click() ?? document.querySelector('.bottom-nav [data-go="desk"]').click()`);
      await settle(page);
      const desk = await ev(`({ kept: [...document.querySelectorAll('#kept [data-keep]')].map(r => r.dataset.keep), positions: document.getElementById('positions').innerText })`);
      check('KEEP', `${tag}: with the settings unavailable, Desk still keeps SXR8 and TSLA under Kept holdings only`, J(desk.kept.sort()) === J(['SXR8', 'TSLA']) && !/\b(SXR8|TSLA)\b/.test(desk.positions), desk.kept);
    }
  }

  // ---------- 6 · The LIVE gate: never a request, never a mode change ----------
  if (run('gate')) {
    const b = await designBoard();
    const gate = () => ev(`(() => { const d = document.getElementById('gateDlg'), r = d.getBoundingClientRect(), a = document.activeElement;
      return { open: d.open, w: r.width, h: r.height, step: [...d.querySelectorAll('.gate-step')].findIndex(s => !s.hidden) + 1,
        trail: [...d.querySelectorAll('#gateTrack li:not(.sep)')].map(l => ({ t: l.innerText.trim(), cur: l.classList.contains('cur'), done: l.classList.contains('done'), weight: getComputedStyle(l).fontWeight, ok: Boolean(l.querySelector('use[href="#i-ok"]')) })),
        next: [document.getElementById('gateNext').disabled, getComputedStyle(document.getElementById('gateNext')).visibility], back: getComputedStyle(document.getElementById('gateBack')).visibility, cancel: document.getElementById('gateCancel').innerText.trim(),
        final: document.getElementById('liveFinal').disabled, match: document.getElementById('gateMatch').innerText.trim(), phrase: document.getElementById('gatePhrase').value,
        active: a?.id || (a?.matches('[data-close]') ? 'close' : a?.tagName), ring: a ? a.matches(':focus-visible') && getComputedStyle(a).outlineStyle !== 'none' : false, outline: a ? getComputedStyle(a).outlineStyle : null,
        mode: document.getElementById('modeLabel').innerText.trim(), header: document.querySelector('header.top').innerText, text: d.innerText, ...__audit.opaque(d) }; })()`);
    const storage = () => ev(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])))`);
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme} LIVE gate`;
      await openSettings(b, viewport, theme);
      const since = page.requests.length, stored = await storage(), revBefore = (await served(b)).rev;
      const before = await rects(SHIFT);
      let moved = [];
      await press(viewport, '#liveOpen');
      const s1 = await gate();
      check('AC-3', `${tag}: step 1 "LIVE means real orders with real money"; Continue`, s1.open && s1.step === 1 && /LIVE means real orders with real money/.test(s1.text) && !s1.next[0] && s1.next[1] === 'visible' && s1.back === 'hidden' && s1.cancel === 'Cancel', s1);
      check('AC-37', `${tag}: the trail has exactly three steps, the current one bold, and no "Active" step`, J(s1.trail.map(t => t.t)) === J(['Locked', 'Phrase typed', 'Markus’s approval · out of band']) && s1.trail[0].cur && Number(s1.trail[0].weight) >= 600 && !/Active/.test(s1.text), s1.trail);
      check('AC-33', `${tag}: opened by ${viewport.mobile ? 'a tap' : 'the pointer'}, focus is on the dialog's heading without a visible ring`, s1.active === 'gateTitle' && s1.outline === 'none', s1);
      check('AC-41', `${tag}: the gate dialog is opaque`, s1.bgAlpha === 1 && s1.opacity === 1, s1);
      moved = moved.concat(shifted(before, await rects(SHIFT)));
      // A term inside the dialog explains itself above the dialog; Escape closes only the tip.
      await ev(`document.querySelector('#gateDlg [data-term="executor"]').focus()`); await settle(page);
      // The tip ignores the pointer; it is probed with pointer events on for a moment.
      const tip = await ev(`(() => { const t = document.getElementById('tip'), r = t.getBoundingClientRect(); t.style.pointerEvents = 'auto'; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); t.style.pointerEvents = ''; return { on: t.classList.contains('on'), inDialog: Boolean(t.closest('#gateDlg')), top: Boolean(hit?.closest('#tip')), text: t.innerText }; })()`);
      check('AC-39', `${tag}: a term inside the gate shows its explanation above the dialog`, tip.on && tip.inDialog && tip.top && /Paper executor/.test(tip.text), tip);
      await key('Escape');
      check('AC-39', `${tag}: Escape closes the tip and keeps the gate open`, !(await ev(`document.getElementById('tip').classList.contains('on')`)) && (await gate()).open);
      await press(viewport, '#gateNext');
      const s2 = await gate();
      check('AC-3', `${tag}: step 2 asks for the phrase; Continue stays disabled until it matches`, s2.step === 2 && s2.next[0] && s2.active === 'gatePhrase' && s2.back === 'visible' && /Type switch joe to live money exactly\./.test(N(s2.text)), s2);
      await type('#gatePhrase', 'switch joe to live');
      const wrong = await gate();
      await ev(`(() => { const b = document.getElementById('gateNext'); b.disabled = false; b.click(); })()`); await settle(page);
      const forced = await gate();
      check('AC-3', `${tag}: any other text keeps Continue disabled, even clicked programmatically`, wrong.match === 'Phrase does not match yet.' && wrong.next[0] && forced.step === 2, { wrong: wrong.match, forced: forced.step });
      await type('#gatePhrase', '  Switch Joe To Live Money ');
      const right = await gate();
      check('AC-3', `${tag}: the exact phrase (case and spaces aside) matches`, right.match === 'Phrase matches.' && !right.next[0], right.match);
      await press(viewport, '#gateNext');
      const s3 = await gate();
      check('AC-3', `${tag}: step 3 waits for Markus's approval out of band; "Switch to LIVE" is disabled`, s3.step === 3 && s3.final && s3.next[1] === 'hidden' && s3.cancel === 'Cancel request' &&
        /JoeDesk does not send this request and cannot change the mode\./.test(s3.text) && s3.trail[0].done && s3.trail[1].done && s3.trail[0].ok && s3.trail[2].cur, s3);
      await ev(`(() => { const b = document.getElementById('liveFinal'); b.disabled = false; b.click(); b.disabled = true; })()`); await settle(page);
      const pushed = await gate();
      check('AC-3', `${tag}: a click on "Switch to LIVE" changes nothing`, pushed.open && pushed.step === 3 && pushed.mode === 'PAPER', pushed.step);
      check('AC-4', `${tag}: the gate keeps one size on all three steps (±0.5 px)`, [s2, s3].every(s => Math.abs(s.w - s1.w) <= 0.5 && Math.abs(s.h - s1.h) <= 0.5), [s1, s2, s3].map(s => [s.w, s.h]));
      moved = moved.concat(shifted(before, await rects(SHIFT)));
      if (viewport.name !== '1024') await viewShot(`${viewport.name}-${theme}-settings-gate-step3`, 'Settings: the LIVE gate, step 3 (approval out of band; Switch to LIVE disabled)');
      await press(viewport, '#gateCancel');
      const toast1 = await toastText(), closed = await gate();
      check('AC-3', `${tag}: Cancel request returns to PAPER with "Still on PAPER. Nothing was sent and the mode did not change."`, !closed.open && toast1 === 'Still on PAPER. Nothing was sent and the mode did not change.' && closed.phrase === '' && closed.mode === 'PAPER', { toast1, closed: closed.open });
      await resetToast();
      // From the keyboard: the close button takes focus with its ring; × closes.
      await ev(`document.getElementById('liveOpen').focus()`); await key('Enter');
      const kb = await gate();
      check('AC-33', `${tag}: opened from the keyboard, the first control has focus with a visible ring`, kb.open && kb.step === 1 && kb.active === 'close' && kb.ring, kb);
      // Tab stays in the dialog.
      const trapped = [];
      for (let i = 0; i < 8; i++) { await key('Tab'); trapped.push(await ev(`Boolean(document.activeElement?.closest('#gateDlg'))`)); }
      check('AC-33', `${tag}: Tab stays inside the gate`, trapped.every(Boolean), trapped);
      await press(viewport, '#gateDlg [data-close]');
      check('AC-3', `${tag}: × returns to PAPER with the toast`, !(await gate()).open && (await toastText()) === 'Still on PAPER. Nothing was sent and the mode did not change.');
      await resetToast();
      // Escape mid-way resets the phrase and the step.
      await press(viewport, '#liveOpen'); await press(viewport, '#gateNext'); await type('#gatePhrase', 'switch joe');
      await key('Escape');
      const esc = await gate();
      check('AC-3', `${tag}: Escape returns to PAPER with the toast`, !esc.open && (await toastText()) === 'Still on PAPER. Nothing was sent and the mode did not change.', esc.open);
      await press(viewport, '#liveOpen');
      const again = await gate();
      check('AC-3', `${tag}: reopened, the gate is back on step 1 with an empty phrase`, again.step === 1 && again.phrase === '' && again.match === '', again);
      // A click on the backdrop closes it.
      await mouseAt({ x: 4, y: 4 });
      check('AC-3', `${tag}: the backdrop returns to PAPER with the toast`, !(await gate()).open && (await toastText()) === 'Still on PAPER. Nothing was sent and the mode did not change.');
      await resetToast();
      moved = moved.concat(shifted(before, await rects(SHIFT)));
      check('AC-4', `${tag}: nothing behind the gate moves while it is open or after it closes (±0.5 px)`, !moved.length, moved.slice(0, 4));
      // The network layer: no request of any kind but the board's own reads.
      const reqs = page.requests.slice(since);
      const odd = reqs.filter(r => r.method !== 'GET' || !READS.includes(new URL(r.url).pathname));
      check('AC-3', `${tag}: no request at any step: ${reqs.length} requests, all the board's periodic reads (GET), none a write or a mode change`, !odd.length && !reqs.some(r => /live/i.test(r.url + (r.postData ?? ''))), odd);
      const after = await gate(), storedAfter = await storage(), now = await served(b);
      check('AC-3', `${tag}: no state is stored and the mode did not change (header PAPER, settings paper, ${now.rev})`, storedAfter === stored && after.mode === 'PAPER' && !/LIVE/.test(after.header) && now.mode === 'paper' && now.rev === revBefore, { stored, storedAfter });
    }
  }

  // ---------- 7 · Appearance: Light, Dark, System; System follows the OS live ----------
  if (run('appearance')) {
    const b = await designBoard();
    for (const viewport of VIEWPORTS) {
      const tag = `${viewport.name} appearance`;
      await openSettings(b, viewport, 'light');
      await ev(`localStorage.removeItem('joe-board-theme-v1'); delete document.documentElement.dataset.theme`);
      await ev(`document.getElementById('set-appearance').scrollIntoView({ block: 'center' })`); await settle(page);
      const before = await rects(SHIFT);
      const look = () => ev(`({ theme: document.documentElement.dataset.theme ?? null, stored: localStorage.getItem('joe-board-theme-v1'), pressed: [...document.querySelectorAll('[data-themeopt]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.themeopt),
        canvas: getComputedStyle(document.body).backgroundColor, label: document.getElementById('themeBtn').getAttribute('aria-label') })`);
      await press(viewport, '[data-themeopt="dark"]');
      const dark = await look();
      check('AC-31', `${tag}: Dark sets data-theme dark and saves it`, dark.theme === 'dark' && dark.stored === 'dark' && J(dark.pressed) === J(['dark']) && dark.canvas === 'rgb(18, 20, 17)' && dark.label === 'Switch to light theme', dark);
      await press(viewport, '[data-themeopt="light"]');
      const light = await look();
      check('AC-31', `${tag}: Light sets data-theme light and saves it`, light.theme === 'light' && light.stored === 'light' && J(light.pressed) === J(['light']) && light.canvas === 'rgb(246, 245, 241)', light);
      await press(viewport, '[data-themeopt="system"]');
      const system = await look();
      await page.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await settle(page);
      const osDark = await look();
      await page.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await settle(page);
      const osLight = await look();
      check('AC-31', `${tag}: System follows the OS live: dark, then light, without a reload`, system.theme === null && system.stored === 'system' && J(system.pressed) === J(['system']) && osDark.canvas === 'rgb(18, 20, 17)' && osDark.label === 'Switch to light theme' &&
        osLight.canvas === 'rgb(246, 245, 241)' && osLight.label === 'Switch to dark theme' && J(osDark.pressed) === J(['system']), { system, osDark, osLight });
      await ev(`document.getElementById('themeBtn').click()`); await settle(page);
      const header = await look();
      check('AC-31', `${tag}: the header button switches to dark and Appearance follows`, header.theme === 'dark' && header.stored === 'dark' && J(header.pressed) === J(['dark']), header);
      check('AC-31', `${tag}: switching theme moves nothing (±0.5 px)`, !shifted(before, await rects(SHIFT)).length, shifted(before, await rects(SHIFT)).slice(0, 3));
      if (viewport.mobile) await viewShot(`${viewport.name}-dark-settings-appearance`, 'Settings on a phone: Appearance, Dark chosen');
      await ev(`localStorage.removeItem('joe-board-theme-v1'); window.__joedesk.setTheme('system'); localStorage.removeItem('joe-board-theme-v1')`);
    }
  }

  // ---------- 8 · Tick's P4 carry-over: the day sheet's focus at 390 ----------
  if (run('focus')) {
    const b = await designBoard();
    const record = designResults(NOW);
    await intercept({ match: 'results.json', answer: () => ({ status: 200, body: { ...record, receivedAt: at(b.clock(), -18) }, headers: [{ name: 'X-Joe-Server-Now', value: b.clock() }] }) });
    for (const theme of THEMES) {
      const tag = `390 ${theme} day sheet`;
      await configure(page, PHONE, theme);
      await load(page, b.url, 'results');
      await waitFor(page, `document.querySelector('#tiles .tile .tval .num')`);
      const day = await ev(`[...document.querySelectorAll('#cal [data-day]')].filter(c => /from\\s\\d+\\strade/.test(c.getAttribute('aria-label'))).at(-1).dataset.day`);
      await tap(`#cal [data-day="${day}"]`);
      const tapped = await ev(`(() => { const a = document.activeElement; return { open: document.getElementById('daySheet').open, active: a?.id, outline: getComputedStyle(a).outlineStyle, visible: a.matches(':focus-visible') }; })()`);
      check('P4-carry-over', `${tag}: a tap opens the sheet with focus on its heading and no visible ring`, tapped.open && tapped.active === 'sheetTitle' && tapped.outline === 'none', tapped);
      await viewShot(`390-${theme}-results-sheet-tap`, 'Results on a phone: the day sheet opened by a tap, focus on the heading without a ring');
      await key('Escape');
      check('P4-carry-over', `${tag}: Escape closes the sheet and focus returns to the day`, !(await ev(`document.getElementById('daySheet').open`)) && (await ev(`document.activeElement?.dataset?.day`)) === day);
      await ev(`document.querySelector('#cal [data-day="${day}"]').focus()`);
      await key('Enter');
      const kb = await ev(`(() => { const a = document.activeElement; return { open: document.getElementById('daySheet').open, close: a?.matches('[data-close]'), ring: a.matches(':focus-visible'), outline: getComputedStyle(a).outlineStyle, width: getComputedStyle(a).outlineWidth }; })()`);
      check('P4-carry-over', `${tag}: opened from the keyboard, the close button has focus with its ring`, kb.open && kb.close && kb.ring && kb.outline === 'solid' && kb.width === '2px', kb);
      await key('Escape');
    }
    await intercept(null);
  }

  // ---------- 9 · Sweep: every width from 390 to 1440 px, both fonts, both themes ----------
  if (run('sweep')) {
    const b = await designBoard();
    const widths = Array.from({ length: (1440 - 390) / 10 + 1 }, (_, i) => 390 + i * 10);
    // The two longest notes: a stale version, and stored with the change log unfinished.
    const LONGEST = [['Not sent', 'version 12 was not confirmed as written: revision changed to fc-000013; reload before retrying.'],
      ['Sent version 13', 'saved to the shared file, but the change log could not record it. The desks’ reload is not confirmed.']];
    for (const theme of THEMES) for (const font of [null, WIDE_FONT]) {
      const tag = `${theme}${font ? ' wide font' : ''} settings`;
      await openSettings(b, VIEWPORTS[0], theme, { font });
      const fail = { scroll: [], past: [], header: [], nav: [], targets: [], overlaps: [], bar: [] };
      for (const width of widths) {
        await configure(page, { name: String(width), width, height: 900, mobile: width <= 700 }, theme);
        await settle(page);
        const r = await ev(`__audit.sweep(960, null)`);
        if (r.scroll > r.inner) fail.scroll.push({ width, scroll: r.scroll });
        if (r.past.length) fail.past.push({ width, past: r.past.slice(0, 3) });
        if (r.header.length) fail.header.push({ width, header: r.header });
        if (!r.nav) fail.nav.push(width);
        if (r.targets.length) fail.targets.push({ width, targets: r.targets });
        if (r.overlaps.length) fail.overlaps.push({ width, overlaps: r.overlaps.slice(0, 3) });
        if (width > 700) {
          // The edit bar with its longest notes: inside the bar, the bar inside the window, clear of the bottom bar.
          const fit = await ev(`(() => { const n = document.getElementById('editNote'), keep = n.innerHTML, faults = [];
            for (const [lead, rest] of ${J(LONGEST)}) {
              n.querySelector('.note-t').innerHTML = '<b>' + lead + '</b> · ' + rest;
              const bar = document.getElementById('editbar').getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(n.querySelector('.note-t'));
              const text = t.getBoundingClientRect(), nav = document.querySelector('.bottom-nav'), nr = nav.getBoundingClientRect(), navOn = getComputedStyle(nav).display !== 'none';
              const btns = [...document.querySelectorAll('#editbar .btn')].map(b => b.getBoundingClientRect());
              if (text.top < bar.top - 0.5 || text.bottom > bar.bottom + 0.5 || text.right > bar.right + 0.5) faults.push(lead + ': note leaves the bar');
              if (bar.left < -0.5 || bar.right > innerWidth + 0.5 || bar.bottom > innerHeight + 0.5) faults.push(lead + ': bar leaves the window');
              if (navOn && bar.bottom > nr.top + 0.5) faults.push(lead + ': bar over the bottom bar');
              if (btns.some(b => b.left < bar.left - 0.5 || b.right > bar.right + 0.5 || b.top < bar.top - 0.5 || b.bottom > bar.bottom + 0.5)) faults.push(lead + ': a button leaves the bar');
              if (btns.some((b, i) => i && b.left < btns[i - 1].right - 0.5 && b.top < btns[i - 1].bottom - 0.5)) faults.push(lead + ': buttons overlap');
            }
            n.innerHTML = keep; return faults; })()`);
          if (fit.length) fail.bar.push({ width, fit });
        }
      }
      const n = `${widths.length} widths from 390 to 1440 px`;
      check('AC-28', `sweep ${tag}: no horizontal page scroll at any of ${n}`, !fail.scroll.length, fail.scroll.slice(0, 6));
      check('AC-28', `sweep ${tag}: nothing reaches past the page's right edge at any of ${n}`, !fail.past.length, fail.past.slice(0, 4));
      check('header', `sweep ${tag}: the header stays in its row; one nav at every width`, !fail.header.length && !fail.nav.length, { header: fail.header.slice(0, 3), nav: fail.nav.slice(0, 6) });
      check('AC-30', `sweep ${tag}: the compact header's buttons and the bottom bar are 44 px targets`, !fail.targets.length, fail.targets.slice(0, 3));
      check('AC-36', `sweep ${tag}: no text overlaps other text at any of ${n}`, !fail.overlaps.length, fail.overlaps.slice(0, 4));
      check('no-shift', `sweep ${tag}: from 710 px the edit bar holds its longest notes and its buttons inside it, inside the window and above the bottom bar`, !fail.bar.length, fail.bar.slice(0, 4));
    }
    // For the visual check: the edit bar above the bottom bar at a tablet width.
    await openSettings(b, { name: '820', width: 820, height: 1000, mobile: false }, 'light');
    await mouse('[data-bump="1"][data-for="desks.maxBusyDesks"]');
    await viewShot('820-light-settings-tablet-editbar', 'Settings at 820 px: the edit bar floats above the bottom bar (two rows)');
    await mouse('#discardBtn');
  }

  // ---------- 10 · Every write the page made, across the whole run ----------
  {
    const writes = page.requests.filter(r => r.method !== 'GET' && r.method !== 'HEAD');
    const bad = writes.filter(r => { const path = new URL(r.url).pathname; let body = null; try { body = JSON.parse(r.postData ?? 'null'); } catch { /* not JSON */ }
      return r.method !== 'POST' || path !== PROPAGATE || body?.config?.mode !== 'paper' || !/^fc-\d{6}$/.test(body.baseRev ?? ''); });
    check('AC-5', `network: all ${writes.length} writes of the run were Send to the desks (${sends} sends): POST ${PROPAGATE}, a paper draft of a named version; nothing to the inbox`, !bad.length && writes.length === sends && !page.requests.some(r => /\/joe\/inbox/.test(r.url)), bad.slice(0, 3));
  }
} finally {
  await browser.close();
  for (const b of boards) await b.close();
}

const failed = results.filter(r => !r.ok);
const byAc = new Map();
for (const r of results) { const e = byAc.get(r.ac) ?? { pass: 0, fail: 0 }; e[r.ok ? 'pass' : 'fail']++; byAc.set(r.ac, e); }
const lines = [...byAc].sort().map(([ac, e]) => `| ${ac} | ${e.pass} | ${e.fail} |`);
writeFileSync(join(QA_DIR, 'index.md'), `# JoeDesk P5 · Settings · browser gate screenshots (JOED-25)

Generated by \`node scripts/browser-p5.mjs\` against the real board server with
an injected clock (Wed 14 Oct 2026, 19:42:31 Vienna), the P3 test-only
scenario for state and history, and test-only Fleet Config fixtures
(\`scripts/browser/settings-fixtures.mjs\`): the approved design's settings
(version 12, two wake windows, one host secret reference), its change log,
the snapshot with the producer-masked hint \`DU…0597\`. Fixtures: clean,
edited (sent as version 13), stale version (another send wrote version 13
first: a 409), send failures (the store fails: a plain 500; no answer; the
server cannot read its settings), stored with the change log unfinished (the
server writes version 13, its change-log entry stays pending, and it answers
500 naming fc-000013), missing settings (no stored file: the starter file; an
unreadable stored file: values hidden with the SXR8/TSLA floor), the longest
values the format accepts (64 kept holdings of 16 characters: a 1.133-character
Saved line; 64-character routine names; 80-character check-in names), and
malformed browser drafts. One headless browser,
run sequentially; reduced motion for stable geometry. Browser: ${reference}.
Compare with \`joed-19-joedesk-approved.html\` (Settings).

## Changed in fix round 1 (Codex gate r1)

- **New \`1440-light-settings-stored.png\`, \`1440-dark-settings-stored.png\`.** A
  send the server stored as version 13 but whose change-log entry it could not
  finish (HTTP 500 naming fc-000013) used to read "Not sent". It now reads
  "Sent version 13 · saved to the shared file, but the change log could not
  record it. The desks’ reload is not confirmed." with the warning icon; the
  change log shows the send pending. Only an HTTP 409 reads as a stale version
  (\`*-settings-stale.png\`); a plain 500 still reads "Not sent"
  (\`*-settings-failed.png\`). Neither changed.
- **New \`1440-light-settings-long-values.png\`, \`390-light-settings-long-values.png\`.**
  The longest values the format accepts. The Saved box is sized from the saved
  value before any edit; a 64-symbol kept list (a 1.133-character Saved line)
  no longer grows its row or moves later sections (\`no-shift\` at 1440 and 1024
  in both fonts; 390 is read-only).
- **Malformed browser drafts** (wake windows \`null\`, a window without desks, a
  key that is not editable) are dropped with the discard words, and every group
  renders (\`AC-24\`/\`AC-22\` at 1440, 1024 and 390; no new screenshot).
- **Every other screenshot** shows the same content as before this round:
  short saved values keep their one-line box. Pixel differences against the
  previous run are run noise only (temporary folder names, a clock second).
- **Keys.** The key count comes from the schema file; no test hard-codes it.

## For the visual check

- **Order.** Mode, Runtime state, Desk limits, AI capacity, Wake times, Amy’s
  check-ins, Connections, Secret references, Old Mac paths, How fleet settings
  work, Where this is defined, Change log, Appearance, About. The sticky
  sub-nav marks the section in view; a section chosen there stays marked while
  its top is in view (the last ones cannot reach the top of the window).
  Phones have no sub-nav, as in the approved design.
- **Keys.** Every leaf key of \`contracts/fleet-config.schema.json\` shows in
  mono under its setting: ${LEAVES.length} keys, derived from the schema file (the spec's
  "39" adds three rows that have no schema key: Routine health, File the board
  reads, Last sent). Long keys break after a dot, never inside a word.
- **Kept holdings.** SXR8 and TSLA are named as always kept (inert text, no
  control); only the other symbols are editable. The candidate always starts
  with the floor in its saved order.
- **Edit bar.** One row above 1180 px; two rows (note, then buttons) at 961 to
  1180 px; up to 960 px it floats above the bottom bar (\`820-light-settings-tablet-editbar.png\`).
  The note keeps two lines' room, so no state changes the bar.
- **Saved line.** Under a changed control. The box always holds the saved
  value and is shown only when the draft differs, so it is sized before any
  edit and showing it moves nothing: one line for a short value, up to three
  whole lines for a long one, and past three lines it scrolls (and takes
  focus) — the 64 kept holdings (\`1440-light-settings-long-values.png\`). The
  wake windows give their count ("Saved: 2 wake windows · Review changes lists
  every difference"); Review changes lists every difference.
- **Stored, change log unfinished.** When the server writes the version but
  cannot finish its change-log entry (a 500 naming the new version), the edit
  bar reads "Sent version 13 · saved to the shared file, but the change log
  could not record it. The desks’ reload is not confirmed." with the warning
  icon, the toast says the change log shows it as pending, and the change log
  does (\`1440-light-settings-stored.png\`). Only a 409 is a stale version.
- **Malformed browser draft.** A saved draft with a value of the wrong shape
  (for example wake windows \`null\`) or a key that is not editable is dropped
  with "Draft discarded. The fields show the saved settings again."; every
  group renders.
- **Wake windows** take the whole row (label above, one row per window).
- **Adding or removing a wake window** changes the list itself (the one edit
  that adds height); every other edit, the review, the confirmation, the
  toast and a section change move nothing (\`no-shift\`, both fonts).
- **Dialogs.** Opened by a pointer, focus goes to the dialog's heading
  without a ring; from the keyboard, to its first control with the ring. The
  same rule now opens the phone day sheet (Tick's P4 carry-over). A term's tip
  inside a dialog shows above it; Escape closes the tip first, then the dialog.
- **Runtime state** reads the shared panel states: each row carries its own
  freshness words when not fresh, and absent proposed fields read "Not reported".

## Acceptance criteria → tests

| AC | Browser (this gate) | Node |
| --- | --- | --- |
| AC-22 Mode then Runtime state; all leaf keys as data-key with visible mono text, against the schema file | \`AC-22\` (clean, starter file, unavailable; six combos) | \`schema keys\` (\`test/settings-model.mjs\`) |
| AC-23 today's editable/read-only split; phones read-only with the note, no inputs | \`AC-23\` | \`editability\` |
| AC-24 Edit → Review changes (dialog + tick) → Confirm → Send; edit-bar states and toasts; stale version "revision changed to …; reload before retrying"; audited | \`AC-24\` (edited, draft, stale = 409, failure = plain 500 / no answer / unreadable, stored = 500 naming the version, malformed draft, long values, unavailable) | \`edit flow\`, \`stale version\`, \`stored, change log unfinished\`, \`review\`, \`load states\`, \`browser draft\`, \`candidate\`, \`validation\`, \`diff model\`; server: \`Fleet Config propagates one atomic paper revision…\` |
| AC-25 seven rows; "Not reported"; no secrets, tokens, full account numbers or env content | \`AC-25\` | — |
| AC-26 sub-nav reaches every section and marks the one in view | \`AC-26\` (clicks and scrolling; nothing moves) | — |
| AC-27 How it works, Where this is defined with Sources, Change log, Appearance, About | \`AC-27\` | \`change log\` |
| AC-28 no horizontal scroll 390–1440 | \`AC-28\` (audit at six combos; sweep in 10 px steps, both fonts and themes) | — |
| AC-29 contrast ≥ 4.5:1 | \`AC-29\` (every audited state, both themes) | — |
| AC-3 / AC-4 / AC-37 the LIVE gate: three steps, phrase, disabled switch, every close route, no request, no state, one size | \`AC-3\`, \`AC-4\`, \`AC-37\` (network layer at six combos) | \`writer\` (refuses a non-paper draft before any request) |
| AC-5 no control acts on money; the only write is a paper draft to propagate | \`AC-5\` (audit; every write of the run) | \`check-joe-ui\` (one writer, one route, paper guard) |
| AC-31 Light / Dark / System; System follows the OS live; moves nothing | \`AC-31\` | — |
| AC-33 focus, trap, Escape, labels | \`AC-33\` | — |
| AC-39 Learn tips on settings and terms in dialogs | \`AC-39\` | \`editability\` (each field's Learn) |
| KEEP SXR8/TSLA floor | \`KEEP\` (unavailable settings; Desk keeps them under Kept holdings) | \`candidate\`, \`validation\` |
| Tick's P4 carry-over | \`P4-carry-over\` (tap: heading, no ring; keyboard: close button with ring) | — |
| Part A craft on Settings | AC-1, 2, 5, 28–30, 32, 33, 36, 38, 40, 42–44, 47 (\`auditScreen\`) | — |
| No layout shift on edit, review, toast or section change (both fonts) | \`no-shift\` (edited; long values at 1440 and 1024 in both fonts, 390 in both fonts; stored outcome; sweep) | — |

## Checks

| Criterion | Passed | Failed |
| --- | --- | --- |
${lines.join('\n')}

${failed.length ? `### Failures\n\n${failed.map(f => `- ${f.ac} ${f.name}: \`${J(f.detail)?.slice(0, 300)}\``).join('\n')}\n` : 'All checks passed.\n'}
## Screenshots (\`<viewport>-<theme>-<surface>.png\`)

${shots.map(s => `- \`${s.file}\` — ${s.what}`).join('\n')}
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
process.exit(failed.length ? 1 : 0);
