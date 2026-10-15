// Shared pieces: icons from the inline sprite, terms, big numbers, desk marks
// and the one opaque tip. Everything returns escaped HTML strings.
import { TERMS } from './terms.js';
import { esc, money, digits, tone, arrowOf, isZero, age, MINUS, currencySymbol } from './format.js';
import { cellReason, capital } from './health.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const icon = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
export const learnBtn = key => `<button type="button" class="learn" data-term="${key}" data-learn="1" aria-expanded="false" aria-label="Learn: ${esc(TERMS[key][0])}">${icon('book')}Learn</button>`;
export const term = (key, text) => `<button type="button" class="term" data-term="${key}">${esc(text ?? TERMS[key][0])}</button>`;

const ST_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
export const st = (tone, html) => `<span class="st ${tone}">${icon(ST_ICON[tone])}<span>${html}</span></span>`;

// A signed result: arrow icon, sign, small unit, tabular digits. Zero has no
// sign or arrow; an unavailable value is a dash.
export function bn(n, currency = 'EUR', signed = true, d = 2) {
  if (n == null || !Number.isFinite(n)) return '<span class="bn muted">—</span>';
  if (isZero(n)) n = 0;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `<span class="bn ${signed ? tone(n) : ''}">${signed && n ? icon(arrowOf(n), 'i ar') : ''}${sign}<span class="u">${esc(currencySymbol(currency))}</span>${digits(n, d)}</span>`;
}
export const pl = (n, currency = 'EUR') => (n == null || !Number.isFinite(n) ? '<span class="muted">—</span>'
  : isZero(n) ? `<span class="pl">${money(0, currency)}</span>`
    : `<span class="pl ${tone(n)}">${icon(arrowOf(n))}${money(n, currency, true)}</span>`);

const BARS = [[1, 14, 12], [10.5, 10, 16], [20, 6, 20]];
const DESK_BAR = { j: 0, joe: 1, joel: 2 };
const bars = id => BARS.map((b, i) => `<rect x="${b[0]}" y="${b[1]}" width="7" height="${b[2]}" rx="1.6" fill="${i === DESK_BAR[id] ? `var(--desk-${id})` : 'var(--line-2)'}"/>`).join('');
export const deskMark = id => `<span class="dmark" aria-hidden="true"><svg viewBox="0 0 28 28">${bars(id)}</svg></span>`;
export const inlineMark = id => `<svg class="i im" viewBox="0 0 28 28" aria-hidden="true">${bars(id)}</svg>`;
export const symBadge = (symbol, desk) => `<span class="sym"${desk ? ` style="--c:var(--desk-${desk})"` : ''} aria-hidden="true">${esc(symbol)}</span>`;
export const swatch = (stroke, dash = '', width = 2) => `<svg viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
export const isPhone = () => matchMedia('(max-width: 700px)').matches;

// One shared, opaque tip. Hover or focus shows it, a click or tap pins it,
// Escape closes it and keeps focus; scrolling closes it only if the anchor moved.
export function initTips() {
  const tip = $('#tip');
  let anchor = null, pinned = false, quiet = false, at = null;
  function place(el) {
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let y = r.bottom + 8;
    if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 8);
    tip.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, el.dataset.learn ? r.right - w : r.left))}px`;
    tip.style.top = `${y}px`;
    at = { x: r.left, y: r.top };
  }
  function show(el, pin) {
    const entry = TERMS[el.dataset.term];
    if (!entry) return;
    if (anchor && anchor !== el) anchor.setAttribute('aria-expanded', 'false');
    anchor = el; pinned = Boolean(pin);
    tip.innerHTML = `<b>${esc(entry[0])}</b>${esc(entry[1])}<span class="t2">${el.dataset.learn ? 'Term' : 'Also called'}: ${esc(entry[2])}</span>`;
    tip.classList.toggle('pinned', pinned);
    place(el);
    tip.classList.add('on');
    el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip');
  }
  function hide(force) {
    if (pinned && !force) return;
    tip.classList.remove('on', 'pinned');
    if (anchor) { anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-describedby'); }
    anchor = null; pinned = false;
  }
  // A rebuilt section hands an open tip to the same term in the new markup.
  rebuilt.tip = {
    anchor: () => anchor,
    // Focus handed back by a rebuild is not a new focus: it leaves the tip as it was.
    quiet() { quiet = true; },
    moved(el) {
      if (!el || el.dataset.term !== anchor?.dataset.term) { hide(true); return; }
      anchor = el;
      el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip');
      place(el);
    },
  };
  document.addEventListener('pointerover', e => {
    const el = e.target.closest?.('[data-term]');
    if (el && e.pointerType !== 'touch' && !(pinned && anchor !== el) && el !== anchor) show(el, false);
  });
  document.addEventListener('pointerout', e => {
    const el = e.target.closest?.('[data-term]');
    if (el && el === anchor && !el.contains(e.relatedTarget)) hide(false);
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-term]');
    if (quiet) { quiet = false; return; }
    if (el && el !== anchor) show(el, false);
  });
  document.addEventListener('focusout', e => {
    // A rebuild removing the focused term is not the user leaving it.
    if (rebuilt.busy) return;
    const el = e.target.closest?.('[data-term]');
    if (el && el === anchor) hide(false);
  });
  addEventListener('scroll', () => {
    if (!anchor || !at) return;
    const r = anchor.getBoundingClientRect();
    if (Math.abs(r.left - at.x) > 1 || Math.abs(r.top - at.y) > 1) hide(true);
  }, { passive: true, capture: true });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-term]');
    if (el) { if (anchor === el && pinned) hide(true); else show(el, true); e.preventDefault(); return; }
    if (pinned && !e.target.closest('#tip')) hide(true);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !anchor) return;
    const el = anchor;
    hide(true);
    if (document.activeElement !== el) { quiet = true; el.focus(); }
    e.stopImmediatePropagation();
  }, true);
  return { hide: () => hide(true) };
}

// Ages tick every second without rebuilding a section: structure changes
// replace the section, otherwise only the age texts are patched in place.
// A rebuild keeps keyboard focus and an open tip on the same control.
export const ageSpan = (key, text) => `<span class="age" data-age="${key}">${esc(text)}</span>`;
const AGE_RE = /<span class="age" data-age="([^"]+)">([^<]*)<\/span>/g;
const structure = new WeakMap();
const rebuilt = { tip: null, busy: false };
const KEYS = ['data-term', 'data-go', 'data-hdesk', 'data-range', 'data-desk', 'data-day', 'data-period'];
function identity(node, root) {
  if (node.id) return { sel: `#${CSS.escape(node.id)}`, index: 0 };
  const attr = KEYS.find(k => node.hasAttribute(k));
  const sel = attr ? `[${attr}="${CSS.escape(node.getAttribute(attr))}"]` : node.tagName.toLowerCase();
  return { sel, index: [...root.querySelectorAll(sel)].indexOf(node) };
}
const find = (root, id) => (id ? root.querySelectorAll(id.sel)[id.index] ?? null : null);
export function patch(el, html) {
  if (!el) return false;
  const key = html.replace(AGE_RE, '<span class="age" data-age="$1"></span>');
  if (structure.get(el) !== key) {
    const active = document.activeElement;
    const focused = active && active !== el && el.contains(active) ? identity(active, el) : null;
    const tipAnchor = rebuilt.tip?.anchor();
    const tipped = tipAnchor && el.contains(tipAnchor) ? identity(tipAnchor, el) : null;
    rebuilt.busy = true;
    try { el.innerHTML = html; } finally { rebuilt.busy = false; }
    structure.set(el, key);
    if (tipped) rebuilt.tip.moved(find(el, tipped));
    const again = find(el, focused);
    if (again) { rebuilt.tip?.quiet(); again.focus({ preventScroll: true }); }
    return true;
  }
  for (const [, name, text] of html.matchAll(AGE_RE)) {
    const node = el.querySelector(`[data-age="${name}"]`);
    const plain = text.replace(/&amp;/g, '&');
    if (node && node.textContent !== plain) node.textContent = plain;
  }
  return false;
}

// The words for one panel state exactly as the shared selector gave it, with
// that panel's own age and reason; never re-ranked or borrowed from another.
// `held` names a retained value ("last good value", "last good positions").
export function statePhrase(cell, key, held = 'last good value') {
  const state = cell?.state ?? 'not reported';
  const why = cell?.reason ? cellReason(cell.reason) : null;
  const ago = () => ageSpan(key, cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`);
  if (state === 'fresh') return { tone: 'ok', text: '', state };
  if (state === 'not reported') return { tone: 'none', text: `not reported${why ? ` · ${esc(why)}` : ''}`, state };
  if (cell.value == null) return { tone: 'bad', text: `unavailable · ${esc(why ?? 'not available')}`, state };
  if (cell.retained) return { tone: 'warn', text: `${held}, ${ago()}${why ? ` · ${esc(why)}` : ''}`, state };
  if (state === 'stale') return { tone: 'warn', text: `as of ${ago()}${why ? ` · ${esc(why)}` : ''}`, state };
  return { tone: 'bad', text: `${esc(why ?? 'not available')} · as of ${ago()}`, state };
}
// A caption: the designed one when fresh, otherwise the state's own words.
export function stateCaption(cell, key, fresh = '', held) {
  const p = statePhrase(cell, key, held);
  return p.state === 'fresh' ? fresh : capital(p.text);
}
