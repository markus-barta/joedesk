// Settings: Mode (paper fixed, live locked), Runtime state, every fleet
// setting with today's editability, How it works, Where this is defined, the
// change log, Appearance and About. The edit flow is Edit, Review changes
// (dialog and review tick), Confirm, Send to the desks; fleet-write.js sends.
// The LIVE gate never sends anything and cannot change the mode.
import { $, $$, icon, term, learnBtn, st, ageSpan, patch, statePhrase, addTerms, openDialog, fromPointer, isPhone } from './ui.js';
import { esc, age, money, amountOf, timeHMS, dayDM, dateTimeFull, NB } from './format.js';
import { boardHealthPresentation, brokerState, dataAge, cellReason, STALE_AFTER_S } from './health.js';
import { setTheme, storedTheme } from './theme.js';
import { validateContract } from './contracts/index.mjs';
import { sendFleetDraft } from './fleet-write.js';
import * as M from './settings-model.js';

export const SECTIONS = Object.freeze([
  { id: 'set-mode', nav: 'Mode', icon: 'shield' },
  { id: 'set-runtime', nav: 'Runtime state', icon: 'gauge' },
  ...M.GROUPS.map(g => ({ id: `set-${g.id}`, nav: g.nav, icon: g.icon })),
  { id: 'set-how', nav: 'How fleet settings work', icon: 'help' },
  { id: 'set-source', nav: 'Where this is defined', icon: 'file' },
  { id: 'set-log', nav: 'Change log', icon: 'log' },
  { id: 'set-appearance', nav: 'Appearance', icon: 'palette' },
  { id: 'set-about', nav: 'About', icon: 'about' },
]);
const PHRASE = 'switch joe to live money';
const TOAST_MS = 4400;

let feed = null, tips = null, rerender = () => {};
let state = M.editState();
let restored = false, fieldsKey = null, lastCtx = null, pinnedSec = null, gateStep = 1, lastNote = null;

// Long keys may break after a dot or the file name, never inside a word.
const breakable = text => esc(text).replace(/([.#/])/g, '$1<wbr>');
const keyCode = key => `<code class="key" data-key="${esc(key)}">${breakable(key)}</code>`;
// An array's item key, by its own name ("id"); data-key holds the full key.
const leafCode = key => `<code class="leaf" data-key="${esc(key)}">${esc(M.itemName(key))}</code>`;
const fieldId = key => `f-${key.replace(/[^A-Za-z0-9]/g, '-')}`;
const loadedConfig = ctx => ctx?.feeds['fleet-config']?.value ?? null;

// ---------- Toast: one opaque line, bottom right, never pushing content ----------
export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.innerHTML = `${icon('info')}<span>${esc(message)}</span>`;
  el.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('on'), TOAST_MS);
}

// ---------- Static sections, built once ----------
const LOCK_ART = `<svg viewBox="0 0 132 132" role="img" aria-label="Paper trading, live trading locked">
  <circle cx="66" cy="66" r="62" fill="var(--accent-tint)"/>
  <g transform="rotate(-6 50 60)"><rect x="24" y="26" width="58" height="72" rx="8" fill="var(--surface)" stroke="var(--line-2)" stroke-width="1.5"/><path d="M34 44h30M34 54h38M34 64h26M34 74h34" stroke="var(--line-2)" stroke-width="3" stroke-linecap="round"/><rect x="34" y="82" width="22" height="7" rx="3.5" fill="var(--paper-bg)"/></g>
  <rect x="62" y="64" width="44" height="36" rx="8" fill="var(--ink)"/><path d="M72 64v-9a12 12 0 0 1 24 0v9" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"/><circle cx="84" cy="80" r="4" fill="var(--canvas)"/><path d="M84 83v7" stroke="var(--canvas)" stroke-width="3" stroke-linecap="round"/></svg>`;
const secHead = (ic, id, title, purpose) => `<div class="sec-head"><span class="ico-sq">${icon(ic)}</span><div><h2 id="${id}" tabindex="-1">${title}</h2><p>${purpose}</p></div></div>`;

function modeSection() {
  return `<section class="set-sec" id="set-mode" aria-labelledby="h-mode">
    <div class="card mode-panel">
      <div class="mode-art">${LOCK_ART}</div>
      <div class="mode-body">
        <h2 id="h-mode" tabindex="-1">Joe trades on paper. Live trading is locked.</h2>
        <p class="lede" id="modeLede"></p>
        <div class="mode-opts">
          <div class="mode-opt current">
            <div class="row opt-top"><span class="mode-label">${icon('paper')}PAPER</span><span class="st ok">${icon('ok')}<span>Current mode</span></span></div>
            <h3>Paper trading</h3><p>Practice orders on the paper account. This is the only mode in this phase.</p>
          </div>
          <div class="mode-opt locked">
            <div class="row opt-top"><span class="mode-label live">${icon('live')}LIVE</span><span class="st none">${icon('lock')}<span>Locked</span></span></div>
            <h3>Live trading</h3><p>Real orders with real money. Locked: the ${term('executor', 'paper executor')} is paper-only by design, and the ${term('fleet', 'fleet settings')} accept only paper.</p>
            <div class="row"><span class="sub">Needs Markus’s approval</span><button type="button" class="btn" id="liveOpen" aria-haspopup="dialog">${icon('lock')}Switch to LIVE…</button></div>
          </div>
        </div>
        <p class="mode-key">${keyCode('mode')} = "paper" · fixed by the settings format</p>
      </div>
    </div>
  </section>`;
}

function runtimeSection() {
  return `<section class="set-sec" id="set-runtime" aria-labelledby="h-rt">
    ${secHead('gauge', 'h-rt', 'Runtime state', 'What the board sees right now. Read-only: nothing here can be changed, paused or restarted. Secrets, tokens and full account numbers are never shown.')}
    <div class="rt" id="rtRows"></div>
  </section>`;
}

function groupSection(g) {
  return `<section class="set-sec" id="set-${g.id}" aria-labelledby="h-${g.id}">
    ${secHead(g.icon, `h-${g.id}`, esc(g.title), esc(g.purpose))}
    <div class="fields" id="grp-${g.id}"></div>
  </section>`;
}

function howSection() {
  return `<section class="set-sec" id="set-how" aria-labelledby="h-how">
    ${secHead('help', 'h-how', 'How fleet settings work', `The ${term('fleet', 'fleet settings')} are the one place to change a board-controlled setting. Paper only: they cannot place a trade.`)}
    <ol class="how">
      <li><span class="n">1</span><span><b>Change a value</b> next to its explanation. Learn says where it applies.</span></li>
      <li><span class="n">2</span><span><b>Review changes</b> shows every Before and After value; tick the box when you have read them.</span></li>
      <li><span class="n">3</span><span><b>Confirm review</b> marks that exact version as reviewed.</span></li>
      <li><span class="n">4</span><span><b>${term('send')}</b> writes the next version. Amy and the desks pick it up when they next read it; this board cannot confirm that.</span></li>
      <li><span class="n">5</span><span><b>Save draft</b> keeps your changes in this browser only. <b>Discard</b> throws them away.</span></li>
    </ol>
    <p class="sub how-end">Passwords, tokens, broker access and the ${term('halt', 'emergency stop')} stay in their own host and safety workflows. Board colours stay in this browser.</p>
  </section>`;
}

function sourceSection() {
  return `<section class="set-sec" id="set-source" aria-labelledby="h-src">
    ${secHead('file', 'h-src', 'Where this is defined', 'The file the board reads, and where each setting comes from.')}
    <dl class="facts-dl src-dl" id="srcFacts"></dl>
    <h3 class="src-h">One home per setting</h3>
    <p class="sub">Each setting is read from one key in the file above. The places on the right are history or evidence, never inputs.</p>
    <table class="tbl src-tbl"><thead><tr><th>Setting</th><th>Read from</th><th>Not an input</th></tr></thead><tbody>
      ${Object.entries(M.SOURCES).map(([k, note]) => `<tr><td>${esc(M.FIELD[k].label)}</td><td><code>${breakable(`fleet-config.json#${k}`)}</code></td><td class="ink2">${esc(note)}</td></tr>`).join('')}
    </tbody></table>
  </section>`;
}

function logSection() {
  return `<section class="set-sec" id="set-log" aria-labelledby="h-log">
    ${secHead('log', 'h-log', 'Change log', 'Every send to the desks, with who sent it. Changed setting names only; secret values are never logged.')}
    <ul class="log" id="log"></ul>
  </section>`;
}

function appearanceSection() {
  return `<section class="set-sec" id="set-appearance" aria-labelledby="h-app">
    ${secHead('palette', 'h-app', 'Appearance', 'Saved in this browser only.')}
    <div class="field"><div><div class="f-l">Theme</div><p class="f-h">The round button in the header switches between light and dark.</p></div>
      <div class="f-in"><div class="seg theme-seg" role="group" aria-label="Theme">
        <button type="button" data-themeopt="light" aria-pressed="false">${icon('sun')}Light</button><button type="button" data-themeopt="dark" aria-pressed="false">${icon('moon')}Dark</button><button type="button" data-themeopt="system" aria-pressed="false">${icon('monitor')}System</button>
      </div></div></div>
  </section>`;
}

// Version history titles; a trade term in an old title keeps its explanation.
const versionTitle = text => esc(text).replace(/\bFleet Config\b/g, () => term('fleet', 'Fleet Config'));
function aboutSection() {
  const history = globalThis.JoeVersion?.VERSION_HISTORY ?? [];
  const when = date => (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? `${Number(date.slice(8))}${NB}${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : '');
  return `<section class="set-sec" id="set-about" aria-labelledby="h-about">
    ${secHead('about', 'h-about', 'About', 'JoeDesk is a read-only paper board: no broker access, no order placement.')}
    <ul class="ver">${history.length ? history.map(v => `<li><span class="t${v.versionScheme ? ' product-version' : ''}"${v.versionScheme ? ` data-product-version="${esc(v.version)}" data-version-scheme="${esc(v.versionScheme)}"` : ''}>${esc(v.version)}</span>${when(v.date) ? ` <span class="m">${when(v.date)}</span>` : ''}<p>${versionTitle(v.title)}</p></li>`).join('')
      : '<li><p>The version history is not available.</p></li>'}</ul>
  </section>`;
}

function buildSkeleton() {
  $('#setNav').innerHTML = SECTIONS.map((s, i) => `<a href="#settings/${s.id}" data-sec="${s.id}"${i === 0 ? ' class="on" aria-current="true"' : ''}>${icon(s.icon)}<span>${esc(s.nav)}</span></a>`).join('');
  $('#setMain').innerHTML = [modeSection(), runtimeSection(), ...M.GROUPS.map(groupSection), howSection(), sourceSection(), logSection(), appearanceSection(), aboutSection()].join('');
}

// ---------- Fleet setting fields ----------
const loaded = () => Boolean(state.config);
function readOnly(text, why, tone = 'lock') {
  return `<div class="ro">${icon(tone)}<span data-value>${text}</span></div>${why ? `<div class="ro-why">${why}</div>` : ''}`;
}
function fixedValue(f, v) {
  if (f.x.policy) return esc(M.POLICY[v] ?? v);
  return `<span class="mono">${breakable(v)}</span>`;
}
const phoneValue = html => `<div class="ro phone-only"><span data-value>${html}</span></div>`;

function keepControl(f) {
  const floor = `<p class="kfloor">${icon('keep')}<span><span class="mono">SXR8</span> and <span class="mono">TSLA</span> are always kept</span></p>`;
  if (!loaded()) return `${floor}${readOnly('Other kept symbols are hidden', '', 'ring')}`;
  const shown = esc(M.display(f, state.base[f.key]));
  return `${floor}<label class="sub dsk f-sub" for="${fieldId(f.key)}">Other kept symbols, separated by commas</label>
    <input class="inp mono dsk" id="${fieldId(f.key)}" data-field="${f.key}" value="${esc(state.draft[f.key])}" autocomplete="off" spellcheck="false">
    ${phoneValue(shown)}<div class="f-saved dsk" data-saved="${f.key}"></div>`;
}

function controlHtml(f) {
  if (f.type === 'symbols') return keepControl(f);
  if (!loaded()) return readOnly('Not available', '', 'ring');
  const v = state.draft[f.key], id = fieldId(f.key), label = esc(f.label);
  const phone = phoneValue(esc(M.display(f, state.base[f.key])));
  const saved = `<div class="f-saved dsk" data-saved="${f.key}"></div>`;
  if (f.type === 'int' || f.type === 'pct') {
    const unit = f.type === 'pct' ? '%' : esc(f.x.unit);
    const meter = f.type === 'pct' ? `<div class="meter dsk" role="img" aria-label="${esc(v)}${NB}% kept free" data-meter-box="${f.key}"><i data-meter="${f.key}" style="width:${Math.max(0, Math.min(100, Number(v) || 0))}%"></i></div>` : '';
    return `<div class="stepper dsk"><button type="button" data-bump="-1" data-for="${f.key}" aria-label="Lower ${label}">${icon('minus')}</button><input id="${id}" data-field="${f.key}" inputmode="numeric" value="${esc(v)}" aria-label="${label}" autocomplete="off"><span class="u">${unit}</span><button type="button" data-bump="1" data-for="${f.key}" aria-label="Raise ${label}">${icon('plus')}</button></div>${meter}${phone}${saved}`;
  }
  if (f.type === 'num') return `<div class="affix dsk"><span class="ax">€</span><input class="inp" id="${id}" data-field="${f.key}" inputmode="decimal" value="${esc(v)}" aria-label="${label}, in euros" autocomplete="off"></div>${phone}${saved}`;
  if (f.type === 'time') return `<div class="affix dsk time"><span class="ax">${icon('clock')}</span><input class="inp mono" id="${id}" data-field="${f.key}" value="${esc(v)}" aria-label="${label}, 24-hour Vienna time" autocomplete="off" spellcheck="false"></div>${phone}${saved}`;
  if (f.type === 'switch') return `<button type="button" role="switch" class="switch dsk" id="${id}" data-switch="${f.key}" aria-checked="${v === f.x.on}"><span class="tr" aria-hidden="true"></span><span>${esc(f.x.text)}</span></button>${phone}${saved}`;
  if (f.type === 'routine') return `<input class="inp mono dsk" id="${id}" data-field="${f.key}" value="${esc(v)}" aria-label="${label}" autocomplete="off" spellcheck="false">${phone}${saved}`;
  return `<input class="inp dsk" id="${id}" data-field="${f.key}" value="${esc(v)}" aria-label="${label}" autocomplete="off">${phone}${saved}`;
}

function readOnlyControl(f, config) {
  // The connections' line names their item keys, with or without the values.
  const perEntry = f.type === 'entries' ? `Read-only · ${M.ITEM_KEYS[f.key].map(leafCode).join(' and ')} per connection` : '';
  if (!config) return readOnly('Not available', perEntry, 'ring');
  const v = M.get(config, f.key);
  if (f.type === 'fixed') return readOnly(fixedValue(f, v), f.x.why ?? 'Fixed by the settings format');
  if (f.type === 'entries') return readOnly(v.map(e => `<span class="entry"><span class="mono">${esc(e.id)}</span> · ${esc(e.label)}</span>`).join(''), perEntry);
  if (f.type === 'refs') return readOnly(v.length ? v.map(r => `<span class="secret"><span class="mono">${esc(r)}</span><span class="redacted">${icon('lock')}redacted</span></span>`).join('') : 'None declared', 'Reference names only');
  return '';
}

// The wake windows' item keys follow their key: "· each window: id · days · …".
// The connections' item keys are named in their read-only line.
const fieldLeft = f => {
  const lab = f.x.dot ? st(f.x.dot, esc(f.label)) : `<span>${esc(f.label)}</span>`;
  const items = f.type === 'windows' ? ` <span class="key-each">· each window: ${M.ITEM_KEYS[f.key].map(leafCode).join(' · ')}</span>` : '';
  return `<div class="f-k"><div class="f-l">${lab}${learnBtn(`f:${f.key}`)}</div><p class="f-h">${esc(f.help)}</p>${keyCode(f.key)}${items}</div>`;
};

function windowsHtml(f) {
  const left = fieldLeft(f);
  if (!loaded()) return `<div class="field ww" data-row="${f.key}">${left}<div class="f-in">${readOnly('Not available', '', 'ring')}</div></div>`;
  const ws = M.windowsOf(state.draft[f.key]) ?? [];
  const desks = [...M.DESK_IDS, ...new Set(ws.flatMap(w => w.desks).filter(d => !M.DESK_IDS.includes(d)))];
  const rows = ws.map((w, i) => {
    const n = i + 1;
    return `<div class="wrow dsk" data-wrow="${i}">
      <div class="wgrid">
        <div class="times">
          <input class="inp mono wn" data-ww="${i}" data-wk="id" value="${esc(w.id)}" aria-label="Wake window ${n} name" autocomplete="off" spellcheck="false">
          <input class="inp mono wt" data-ww="${i}" data-wk="from" value="${esc(w.from)}" aria-label="Wake window ${n} start, Vienna time" autocomplete="off" spellcheck="false"><span>to</span>
          <input class="inp mono wt" data-ww="${i}" data-wk="until" value="${esc(w.until)}" aria-label="Wake window ${n} end, Vienna time" autocomplete="off" spellcheck="false">
        </div>
        <div class="togs" role="group" aria-label="Wake window ${n} days">${M.DAYS.map(d => `<button type="button" class="tog" data-wday="${i}" data-d="${d}" aria-pressed="${w.days.includes(d)}">${M.DAY_NAME[d]}</button>`).join('')}</div>
        <div class="togs" role="group" aria-label="Wake window ${n} desks">${desks.map(d => `<button type="button" class="tog" data-wdesk="${i}" data-d="${esc(d)}" aria-pressed="${w.desks.includes(d)}">${esc(M.DESK_NAME[d] ?? d)}</button>`).join('')}</div>
      </div>
      <button type="button" class="btn quiet" data-wwdel="${i}" aria-label="Remove wake window ${n}">${icon('trash')}Remove</button>
    </div>`;
  }).join('');
  // Phones: one tinted block per saved window, its name and times, then its days and desks.
  const saved = M.windowsOf(state.base[f.key]) ?? [];
  const shown = saved.length ? `<div class="phone-only ww-ph">${saved.map(w => { const l = M.windowLines(w); return `<p class="wph" data-value><span><b>${esc(l.id)}</b> · ${esc(l.times)}</span><span class="wph-2">${esc(l.rest)}</span></p>`; }).join('')}</div>`
    : phoneValue('No wake windows');
  return `<div class="field ww" data-row="${f.key}">${left}<div class="f-in ww-in">
    ${shown}
    <div class="ww-list dsk">${rows || '<p class="ww-none">No wake windows yet.</p>'}</div>
    <div class="ww-add dsk"><button type="button" class="btn" id="wwAdd"${ws.length >= M.MAX_WINDOWS ? ' disabled' : ''}>${icon('plus')}Add wake window</button></div>
    <div class="f-saved dsk" data-saved="${f.key}"></div>
  </div></div>`;
}

function fieldHtml(f, config) {
  if (f.type === 'windows') return windowsHtml(f);
  const right = M.EDITABLE.includes(f.key) ? controlHtml(f) : readOnlyControl(f, config);
  return `<div class="field" data-row="${f.key}">${fieldLeft(f)}<div class="f-in">${right}</div></div>`;
}
const routineHealth = () => `<div class="field" data-row="routine-health"><div class="f-k"><div class="f-l"><span>Routine health</span></div><p class="f-h">Settings say when a routine should run; this would show what the scheduler saw.</p></div>
  <div class="f-in">${readOnly('Not reported yet', 'No scheduler signal reaches the board', 'ring')}</div></div>`;

function windowsShape() {
  const ws = state.draft ? M.windowsOf(state.draft['cadence.wakeWindows']) : null;
  return ws && [ws.length, [...new Set(ws.flatMap(w => w.desks))].sort().join()];
}
function renderFields(force = false) {
  const config = state.config;
  const key = JSON.stringify([config?.rev ?? null, config ? 1 : 0, windowsShape(), state.base?.['desks.keep'] ?? null]);
  if (!force && key === fieldsKey) return false;
  fieldsKey = key;
  for (const g of M.GROUPS) {
    const html = g.fields.map(f => fieldHtml(f, config)).join('') + (g.id === 'cadence' ? routineHealth() : '');
    patch($(`#grp-${g.id}`), html);
  }
  syncDraft();
  return true;
}

// The draft's own marks: the Saved line, the reserve meters, the
// controls' values when they changed by a button, never under the caret.
// The Saved line always holds the saved value and is only shown when the
// draft differs, so its box is sized before any edit and showing it moves
// nothing. One line; clipped text remains complete for focus and assistive tech.
function syncDraft() {
  if (!state.base) return;
  const ch = new Set(M.changes(state));
  for (const el of $$('#setMain [data-saved]')) {
    const k = el.dataset.saved, on = ch.has(k);
    const text = `Saved: ${M.savedText(M.FIELD[k], state.base[k])}`;
    if (el.textContent !== text) el.textContent = text;
    el.title = text;
    el.setAttribute('aria-label', text);
    if (el.classList.contains('on') !== on) el.classList.toggle('on', on);
    const clipped = on && el.scrollWidth > el.clientWidth + 1;
    if (clipped) el.tabIndex = 0; else el.removeAttribute('tabindex');
  }
  for (const el of $$('#setMain [data-field]')) {
    if (el !== document.activeElement && el.value !== state.draft[el.dataset.field]) el.value = state.draft[el.dataset.field];
  }
  for (const el of $$('#setMain [data-switch]')) el.setAttribute('aria-checked', String(state.draft[el.dataset.switch] === M.FIELD[el.dataset.switch].x.on));
  for (const el of $$('#setMain [data-meter]')) {
    const v = state.draft[el.dataset.meter], pct = /^\d+$/.test(String(v).trim()) ? Math.max(0, Math.min(100, Number(v))) : 0;
    el.style.width = `${pct}%`;
    el.parentElement.setAttribute('aria-label', `${String(v).trim()}${NB}% kept free`);
  }
  const ws = M.windowsOf(state.draft['cadence.wakeWindows']) ?? [];
  for (const el of $$('#setMain [data-ww]')) { const w = ws[Number(el.dataset.ww)]; if (w && el !== document.activeElement && el.value !== w[el.dataset.wk]) el.value = w[el.dataset.wk]; }
  for (const el of $$('#setMain [data-wday]')) { const w = ws[Number(el.dataset.wday)]; if (w) el.setAttribute('aria-pressed', String(w.days.includes(el.dataset.d))); }
  for (const el of $$('#setMain [data-wdesk]')) { const w = ws[Number(el.dataset.wdesk)]; if (w) el.setAttribute('aria-pressed', String(w.desks.includes(el.dataset.d))); }
}

// ---------- Runtime state (read-only, seven rows) ----------
const rtRow = (ic, label, value, source) => `<div class="rt-row"><div class="lab">${icon(ic)}<span>${label}</span></div><div class="val">${value}</div><div class="src"><code>${source}</code></div></div>`;
// A value with its panel's own state: the fresh words, or the words plus the state.
function withState(cell, key, tone, html, held) {
  const p = statePhrase(cell, key, held);
  if (p.state === 'fresh') return st(tone, html);
  return st(tone === 'bad' ? 'bad' : p.tone, `${html} · ${p.text}`);
}
function runtimeHtml(ctx) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value ?? null, fleet = loadedConfig(ctx);
  const rows = [];
  const mode = data && fleet ? 'the board data and the fleet settings both say paper' : data ? 'the board data says paper; the fleet settings have not reported'
    : fleet ? 'the fleet settings say paper; the board data has not reported' : 'fixed in this phase; neither the board data nor the fleet settings have reported';
  rows.push(rtRow('paper', 'Trading mode', `<span class="st">${icon('paper')}<span>Paper · ${mode}</span></span>`, 'mode'));
  const notReported = (cell) => st('none', `Not reported${cell?.reason && cell.reason !== 'feed_not_received' ? ` · ${esc(cellReason(cell.reason))}` : ''}`);
  const halt = states.halt;
  rows.push(rtRow('stop', term('halt'), halt?.value == null ? notReported(halt)
    : halt.value ? st('bad', `On · ${esc(cellReason(data?.safety.haltReason ?? halt.reason ?? 'halt_on'))}`)
      : withState(halt, 'rt.halt', 'ok', 'Off · paper trading is not paused'), 'safety.halt'));
  let broker;
  if (!data || !states.gateway?.value) broker = notReported(states.gateway);
  else {
    const b = brokerState(states, data), g = data.safety.gateway, ago = states.gateway.ageSeconds;
    const words = b.word === 'OK' ? `Answering · checked ${ageSpan('rt.broker', `${age(ago)} ago`)} (${timeHMS(g.checkedAt)})`
      : b.word === 'down' ? `Down · ${esc(cellReason(g.reason))}` : b.word === 'degraded' ? `Unstable · ${esc(cellReason(g.reason))}`
        : `Not confirmed · ${ago == null ? 'no check-in time' : `last checked ${ageSpan('rt.broker', `${age(ago)} ago`)}`}`;
    broker = st(b.tone, words);
  }
  rows.push(rtRow('plug', term('broker'), broker, 'safety.gateway'));
  const exCell = states.executor, ex = exCell?.value;
  let executor;
  if (!ex) executor = notReported(exCell);
  else {
    const status = { running: 'Running', degraded: 'Degraded', down: 'Down' }[ex.status] ?? 'Not reported';
    const parts = [status, ...(ex.halt ? ['emergency stop on'] : []), `broker ${ex.gatewayReachable ? 'reachable' : 'not reachable'}`, `${term('brakes', 'brakes')} ${ex.brakes ? 'on' : 'off'}`, `checked ${timeHMS(ex.checkedAt)}`];
    const tone = ex.status === 'down' || ex.halt ? 'bad' : ex.status === 'degraded' || ex.brakes || !ex.gatewayReachable ? 'warn' : 'ok';
    executor = withState(exCell, 'rt.executor', tone, parts.join(' · '));
  }
  rows.push(rtRow('cpu', term('executor'), executor, 'GET /v1/health on hsb0'));
  let board;
  if (!data) board = st('none', `Not reported · ${esc(cellReason(feeds.data?.reason ?? 'feed_not_received'))}`);
  else {
    const { receipt, frozen } = dataAge(feeds, now);
    const failed = feeds.data.reason ? ` · ${esc(cellReason(feeds.data.reason))}` : '';
    const stuck = frozen !== null && frozen >= STALE_AFTER_S && frozen > (receipt ?? 0) ? ` · unchanged for ${ageSpan('rt.frozen', age(frozen))}` : '';
    const tone = failed || stuck || receipt >= STALE_AFTER_S ? 'warn' : 'ok';
    board = st(tone, `Last numbers ${timeHMS(data.generatedAt)} · ${ageSpan('rt.data', `${age(receipt)} old`)} · refreshes every 15${NB}s${stuck}${failed}`);
  }
  rows.push(rtRow('feed', 'Board data', board, 'generatedAt'));
  const health = boardHealthPresentation(states, feeds, now);
  rows.push(rtRow('gauge', term('boardok', 'Board status'), st(health.statusTone, `${esc(health.label)} · ${esc(health.explanation)}`), 'boardHealth'));
  const acct = states.paperAccount, hint = data?.brokerAccount?.accountHint;
  const who = hint ? term('account', hint) : 'Account number not reported';
  let account;
  if (acct?.value == null && !hint) account = notReported(acct);
  else if (acct?.value == null) account = st('none', `${who} · total not reported${acct?.reason ? ` · ${esc(cellReason(acct.reason))}` : ''}`);
  else account = withState(acct, 'rt.account', 'ok', `${who} · ${money(amountOf(acct.value), acct.value.currency)} · checked ${ageSpan('rt.account.age', `${age(acct.ageSeconds)} ago`)}`, 'last good total');
  rows.push(rtRow('wallet', term('paperacct'), account, 'brokerAccount.accountHint'));
  return rows.join('');
}

// ---------- Where this is defined, change log ----------
function sourceHtml(ctx) {
  const c = state.config ?? loadedConfig(ctx), src = ctx.fleetSource, log = ctx.actions;
  const na = '<span class="muted">Not available</span>';
  const file = src?.path ? `<span class="mono">${breakable(src.path)}</span> · ${src.kind === 'example' ? 'the starter file; nothing has been sent yet' : src.kind === 'stored' ? 'the shared file' : 'kind not reported'}` : 'Not reported';
  const last = log?.entries?.[0];
  const lastText = log?.entries == null ? (log ? 'Unknown · the change log is unavailable' : 'Loading') : last
    ? `${M.actionView(last).word} · ${dayDM(last.at)}, ${timeHMS(last.at).slice(0, 5)} Vienna · version ${M.vnum(last.revAfter ?? last.revBefore) ?? '—'}` : 'None recorded';
  return [
    ['Format', `${c ? `<span class="mono">${esc(c.$schema)}</span>` : na} ${keyCode('$schema')}`],
    ['Format name', `${c ? `<span class="mono">${esc(c.schema)}</span>` : na} ${keyCode('schema')}`],
    [`Saved ${term('version', 'version')}`, `${c ? `Version ${M.vnum(c.rev)} · <span class="mono">${esc(c.rev)}</span>` : na} ${keyCode('rev')}`],
    ['Saved at', `${c ? `${dateTimeFull(c.updatedAt)} Vienna` : na} ${keyCode('updatedAt')}`],
    ['File the board reads', file],
    ['Last sent', lastText],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function logHtml(ctx) {
  const log = ctx.actions;
  if (!log) return '<li class="log-empty">Loading the change log…</li>';
  if (log.entries == null) return `<li class="log-empty">${st('bad', `The change log is unavailable · ${esc(cellReason(log.reason))}`)}</li>`;
  const stale = log.reason ? `<li class="log-empty">${st('warn', `The change log could not be refreshed · ${esc(cellReason(log.reason))}; showing the last good log`)}</li>` : '';
  if (!log.entries.length) return `${stale}<li class="log-empty">Nothing has been sent to the desks yet.</li>`;
  const arrow = icon('arrow', 'i arr');
  return stale + log.entries.map(e => {
    const v = M.actionView(e);
    const versions = `Version ${v.versions.from ?? '—'}${v.versions.to != null ? `${arrow}${v.versions.to}` : ''}${v.versions.note ? ` · ${v.versions.note}` : ''}`;
    const keys = v.keys.length ? `<span class="mono">${esc(v.keys.join(', '))}</span>` : '';
    const what = [v.what ? esc(v.what) : '', keys].filter(Boolean).join(' · ');
    return `<li data-outcome="${esc(e.outcome)}">${st(v.tone, v.word)}<span class="num">${dayDM(e.at)}, ${timeHMS(e.at)}</span><span>${versions}</span><span class="keys">${esc(v.actor)}${what ? ` · ${what}` : ''}</span></li>`;
  }).join('');
}

// ---------- The edit bar ----------
function renderBar(ctx) {
  const failed = !state.config && Boolean(ctx?.feeds['fleet-config']?.reason);
  const b = M.bar(state, { failed });
  const toneIcon = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' }[b.tone];
  const lead = b.state === 'unavailable' ? `${term('fleet', 'Fleet settings')} unavailable` : esc(b.lead);
  const note = `<span class="note-i tone-${b.tone}">${icon(toneIcon)}</span><span class="note-t"><b>${lead}</b>${b.rest ? ` · ${esc(b.rest).replace(/revision changed to (fc-\d{6})/, 'revision changed to <span class="mono">$1</span>')}` : ''}</span>`;
  const el = $('#editNote');
  if (lastNote !== note) { el.innerHTML = note; el.dataset.state = b.state; lastNote = note; }
  const set = (id, on) => { const btn = $(id); if (btn.disabled === on) btn.disabled = !on; };
  set('#discardBtn', b.buttons.discard); set('#savePreview', b.buttons.save); set('#reviewBtn', b.buttons.review); set('#sendBtn', b.buttons.send);
  $('#editbar').dataset.state = b.state;
}

// ---------- Rendering ----------
export function renderSettings(ctx) {
  lastCtx = ctx;
  const config = loadedConfig(ctx);
  const before = state;
  state = M.adopt(state, config);
  if (!restored && state.config) {
    restored = true;
    let text = null;
    try { text = localStorage.getItem(M.PREVIEW_KEY); } catch { /* storage unavailable: no draft */ }
    const r = M.readPreview(text, state);
    state = r.s;
    if (r.dropped) {
      try { localStorage.removeItem(M.PREVIEW_KEY); } catch { /* nothing stored */ }
      toast('Draft discarded. The fields show the saved settings again.');
    }
  }
  const rebuilt = renderFields(state.config !== before.config);
  if (!rebuilt && state !== before) syncDraft();
  const hint = ctx.feeds.data?.value?.brokerAccount?.accountHint;
  patch($('#modeLede'), `Every order goes to the practice account${hint ? ` ${term('account', hint)}` : ' on Interactive Brokers'}. No real money moves, and nothing on JoeDesk can change that.`);
  patch($('#rtRows'), runtimeHtml(ctx));
  patch($('#srcFacts'), sourceHtml(ctx));
  patch($('#log'), logHtml(ctx));
  const sub = state.config ? `${term('fleet', 'Fleet settings')} version ${M.vnum(state.config.rev)} · paper only` : `${term('fleet', 'Fleet settings')} ${ctx.feeds['fleet-config']?.reason ? 'unavailable' : 'loading'} · paper only`;
  patch($('#setSub'), sub);
  syncTheme();
  renderBar(ctx);
  markSection();
}

export function syncTheme() {
  const mode = document.documentElement.dataset.theme ? storedTheme() : 'system';
  for (const b of $$('[data-themeopt]')) { const on = String(b.dataset.themeopt === mode); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); }
}

// The section in view: the last whose top has passed the header; a section
// chosen in the sub-nav stays marked while its top is in view.
export function markSection() {
  if (document.body.dataset.screen !== 'settings') return;
  const line = ($('header.top')?.getBoundingClientRect().bottom ?? 58) + 24;
  let cur = SECTIONS[0].id;
  for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el && el.getBoundingClientRect().top <= line) cur = s.id; }
  if (pinnedSec) {
    const r = document.getElementById(pinnedSec)?.getBoundingClientRect();
    if (r && r.top >= -1 && r.top < innerHeight - 60) cur = pinnedSec; else pinnedSec = null;
  } else if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = SECTIONS.at(-1).id;
  for (const a of $$('#setNav a')) {
    const on = a.dataset.sec === cur;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
}
export function showSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  pinnedSec = id;
  el.scrollIntoView({ block: 'start' });
  markSection();
}

// ---------- The edit flow ----------
const editing = () => state.config && !state.busy && !isPhone();
function update(next) { if (next === state) return; state = next; syncDraft(); renderBar(lastCtx); }
function editWindows(fn) {
  const ws = M.windowsOf(state.draft['cadence.wakeWindows']);
  if (!ws) return;
  fn(ws);
  update(M.edit(state, 'cadence.wakeWindows', JSON.stringify(ws)));
  renderFields();
}

function review(event) {
  if (!editing()) return;
  const r = M.review(state);
  state = r.s;
  syncDraft(); renderBar(lastCtx);
  if (r.error) { toast(r.error); return; }
  $('#diffBase').textContent = `Version ${M.vnum(state.config.rev)}`;
  // Wake windows read one window per line.
  const lines = (row, text) => (row.key === 'cadence.wakeWindows' ? esc(text).replace(/; /g, '<br>') : esc(text));
  $('#diffList').innerHTML = r.rows.map(row => `<li><div class="d-k"><strong>${esc(row.label)}</strong> <code class="key" data-key="${esc(row.key)}">${esc(row.key)}</code></div>
    <div class="ba${row.key === 'cadence.wakeWindows' ? ' stack' : ''}"><span>Before: <span data-value>${lines(row, row.before)}</span></span>${icon('arrow')}<span>After: <b data-value>${lines(row, row.after)}</b></span></div></li>`).join('');
  $('#diffReviewed').checked = false;
  $('#diffConfirm').disabled = true;
  tips?.hide();
  openDialog($('#diffDlg'), { pointer: fromPointer(event) });
}

async function send() {
  if (!M.canSend(state) || isPhone()) return;
  const keys = M.changes(state), baseRev = state.config.rev;
  let candidate;
  try { candidate = M.buildCandidate(state.config, state.base, state.draft); } catch (error) { toast(error.message); return; }
  state = M.start(state);
  renderBar(lastCtx);
  const answer = await sendFleetDraft(baseRev, candidate);
  let outcome = M.sendOutcome(answer.status, answer.body, keys);
  if (outcome.ok && (!validateContract('fleet-config', outcome.config).ok || outcome.config.mode !== 'paper')) {
    outcome = { ok: false, keys, reason: 'the written settings could not be checked; reload before retrying' };
  }
  state = M.finish(state, outcome);
  renderFields(true);
  renderBar(lastCtx);
  if (outcome.ok || outcome.stored) {
    try { localStorage.removeItem(M.PREVIEW_KEY); } catch { /* nothing stored */ }
    toast(outcome.ok ? `Sent version ${M.vnum(outcome.rev)} to the desks: ${outcome.keys.join(', ')}. Amy and the desks pick it up on their next read; this board cannot confirm that.`
      : `Sent version ${M.vnum(outcome.rev)} to the desks: ${outcome.keys.join(', ')}. The change log could not record it and shows it as pending. Amy and the desks pick it up on their next read; this board cannot confirm that.`);
  } else toast(`Sending failed for version ${M.vnum(baseRev)} (${keys.join(', ')}): ${outcome.reason}.`);
  feed?.refreshFleet();
  feed?.refreshActions();
  rerender('fleet');
}

// ---------- The LIVE gate: three fixed-size steps; it never sends or sets anything ----------
const phraseOk = () => $('#gatePhrase').value.trim().toLowerCase() === PHRASE;
function gateTrack() {
  const items = [['lock', 'Locked'], ['type', 'Phrase typed'], ['clock', 'Markus’s approval · out of band']];
  const cur = gateStep - 1;
  $('#gateTrack').innerHTML = items.map(([ic, t], i) => `${i ? `<li class="sep" aria-hidden="true">${icon('chev-r')}</li>` : ''}<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"${i === cur ? ' aria-current="step"' : ''}>${icon(i < cur ? 'ok' : ic)}<span>${t}</span></li>`).join('');
}
function gateMatch() {
  const v = $('#gatePhrase').value.trim();
  $('#gateMatch').innerHTML = !v ? '' : phraseOk() ? `${icon('ok')}<span>Phrase matches.</span>` : '<span>Phrase does not match yet.</span>';
  $('#gateNext').disabled = gateStep === 2 && !phraseOk();
}
function gateShow(n) {
  gateStep = n;
  for (const s of $$('#gateDlg .gate-step')) s.hidden = Number(s.dataset.step) !== n;
  gateTrack();
  $('#gateBack').style.visibility = n === 2 ? 'visible' : 'hidden';
  $('#gateNext').style.visibility = n === 3 ? 'hidden' : 'visible';
  $('#gateNext').disabled = n === 2 && !phraseOk();
  $('#gateCancel').textContent = n === 3 ? 'Cancel request' : 'Cancel';
  if (n === 2) $('#gatePhrase').focus({ preventScroll: true });
  if (n === 3) $('#gateDlg h2').focus({ preventScroll: true });
}

// ---------- Wiring ----------
export function initSettings(options) {
  ({ feed, tips } = options);
  rerender = options.schedule ?? rerender;
  addTerms(M.FIELD_TERMS);
  buildSkeleton();
  renderFields(true);
  const main = $('#scr-settings');

  main.addEventListener('input', e => {
    const t = e.target;
    if (!editing()) return;
    if (t.dataset.field) update(M.edit(state, t.dataset.field, t.value));
    else if (t.dataset.ww != null) {
      const i = Number(t.dataset.ww), k = t.dataset.wk, value = t.value.trim();
      const ws = M.windowsOf(state.draft['cadence.wakeWindows']);
      if (!ws?.[i]) return;
      ws[i][k] = value;
      update(M.edit(state, 'cadence.wakeWindows', JSON.stringify(ws)));
    }
  });
  main.addEventListener('click', e => {
    const nav = e.target.closest('#setNav a[data-sec]');
    if (nav) { e.preventDefault(); showSection(nav.dataset.sec); return; }
    const opt = e.target.closest('[data-themeopt]');
    if (opt) { setTheme(opt.dataset.themeopt); syncTheme(); rerender('theme'); return; }
    if (e.target.closest('#liveOpen')) {
      $('#gatePhrase').value = '';
      gateShow(1); gateMatch();
      tips?.hide();
      openDialog($('#gateDlg'), { pointer: fromPointer(e) });
      return;
    }
    if (!editing()) return;
    const bump = e.target.closest('[data-bump]');
    if (bump) {
      const f = M.FIELD[bump.dataset.for], n = Number.parseInt(state.draft[f.key], 10);
      const next = Math.max(f.x.min, Math.min(f.x.max, (Number.isFinite(n) ? n : f.x.min) + Number(bump.dataset.bump)));
      update(M.edit(state, f.key, String(next)));
      return;
    }
    const sw = e.target.closest('[data-switch]');
    if (sw) { const f = M.FIELD[sw.dataset.switch]; update(M.edit(state, f.key, state.draft[f.key] === f.x.on ? f.x.off : f.x.on)); return; }
    const tog = e.target.closest('[data-wday], [data-wdesk]');
    if (tog) {
      const days = tog.dataset.wday != null, i = Number(days ? tog.dataset.wday : tog.dataset.wdesk), d = tog.dataset.d;
      const ws = M.windowsOf(state.draft['cadence.wakeWindows']);
      if (!ws?.[i]) return;
      const list = days ? 'days' : 'desks', order = days ? M.DAYS : [...M.DESK_IDS, ...ws[i].desks.filter(x => !M.DESK_IDS.includes(x))];
      ws[i][list] = ws[i][list].includes(d) ? ws[i][list].filter(x => x !== d) : order.filter(x => x === d || ws[i][list].includes(x));
      update(M.edit(state, 'cadence.wakeWindows', JSON.stringify(ws)));
      return;
    }
    const del = e.target.closest('[data-wwdel]');
    if (del) { const i = Number(del.dataset.wwdel); editWindows(ws => ws.splice(i, 1)); $('#wwAdd')?.focus({ preventScroll: true }); return; }
    if (e.target.closest('#wwAdd')) {
      let added = -1;
      editWindows(ws => { if (ws.length < M.MAX_WINDOWS) { ws.push({ id: `window-${ws.length + 1}`, days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', until: '17:00', desks: ['j'] }); added = ws.length - 1; } });
      if (added >= 0) $(`[data-ww="${added}"][data-wk="id"]`)?.focus({ preventScroll: true });
    }
  });

  // A scroll by the reader (not the sub-nav's own) frees the chosen section.
  for (const type of ['wheel', 'touchstart']) addEventListener(type, () => { pinnedSec = null; }, { passive: true });
  addEventListener('keydown', e => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && !e.target.closest?.('input, textarea, dialog')) pinnedSec = null; });
  let frame = 0;
  addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; markSection(); }); }, { passive: true });

  // Edit bar.
  $('#discardBtn').addEventListener('click', () => {
    if (!editing()) return;
    state = M.discard(state, loadedConfig(lastCtx) ?? state.config);
    try { localStorage.removeItem(M.PREVIEW_KEY); } catch { /* nothing stored */ }
    renderFields(true); renderBar(lastCtx);
    toast('Draft discarded. The fields show the saved settings again.');
  });
  $('#savePreview').addEventListener('click', () => {
    if (!editing()) return;
    try { localStorage.setItem(M.PREVIEW_KEY, M.previewPayload(state)); toast(`Draft saved in this browser for version ${M.vnum(state.config.rev)}.`); }
    catch { toast('The draft could not be saved in this browser.'); }
  });
  $('#reviewBtn').addEventListener('click', review);
  $('#sendBtn').addEventListener('click', send);

  // Review dialog.
  $('#diffReviewed').addEventListener('change', e => { $('#diffConfirm').disabled = !e.target.checked; });
  $('#diffCancel').addEventListener('click', () => $('#diffDlg').close());
  $('#diffConfirm').addEventListener('click', () => {
    const next = M.confirm(state, $('#diffReviewed').checked);
    if (next === state) return;
    state = next;
    $('#diffDlg').close();
    renderBar(lastCtx);
    toast(`Review confirmed for version ${M.vnum(state.config.rev)}.`);
  });

  // LIVE gate.
  $('#gatePhrase').addEventListener('input', gateMatch);
  $('#gateNext').addEventListener('click', () => {
    if (gateStep === 1) gateShow(2);
    else if (gateStep === 2 && phraseOk()) gateShow(3);
  });
  $('#gateBack').addEventListener('click', () => gateShow(1));
  $('#gateCancel').addEventListener('click', () => $('#gateDlg').close());
  $('#liveFinal').addEventListener('click', e => e.preventDefault());
  $('#gateDlg').addEventListener('close', () => {
    gateStep = 1;
    $('#gatePhrase').value = '';
    gateShow(1); gateMatch();
    tips?.hide();
    toast('Still on PAPER. Nothing was sent and the mode did not change.');
  });
  for (const d of ['#gateDlg', '#diffDlg']) {
    const dialog = $(d);
    dialog.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => tips?.hide());
  }
}

// Test hook: the edit state as plain data (read-only).
export const settingsState = () => structuredClone({ ...state, config: state.config ? { rev: state.config.rev } : null });
