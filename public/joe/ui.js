// Shared pieces: icons from the inline sprite, terms, big numbers, desk marks
// and the one opaque tip. Everything returns escaped HTML strings.
import { TERMS } from './terms.js';
import { esc, money, eur, digits, tone, arrowOf, isZero, known, age, dayFull, MINUS, currencySymbol, cashAmount } from './format.js';
import { cellReason, capital, CELL_REASON } from './health.js';
import { NOT_EXACT_REASONS, notExactDash } from './board-state.js';
import { STARTING_MONEY, sinceStarts } from './performance.js';
import { nyDay, zonedInstant, wall, NY, VIENNA } from './time.mjs';

// The words for every value the feed explains as not exact.
export const NOT_EXACT = CELL_REASON.not_exact_yet;
// A dash's accessible name and title after its label, shared by money cells,
// positions and Cash: a value the feed sent as not exact says "not exact"
// (with a reason only when it adds words), never "not reported"; every other
// missing value names its reason once, or says "not reported" without one.
export function dashWords(reason) {
  const why = reason ? cellReason(reason) : null;
  return NOT_EXACT_REASONS.has(reason) ? `${NOT_EXACT}${why !== NOT_EXACT ? ` · ${why}` : ''}` : why ?? 'not reported';
}
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const icon = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
// Entries added at run time (each fleet setting's Learn tip) beside the fixed dictionary.
const added = new Map();
export const addTerms = entries => { for (const [key, entry] of Object.entries(entries)) added.set(key, entry); };
// Since start's explanation states the board's configured basis, never a
// literal: the start day (unless Results' record disagrees), the starting
// money, each desk's share, and Results' agreement once its record says so.
function sinceHelp(text, since = sinceStarts(null)) {
  const day = since.common, money = eur(STARTING_MONEY, false, 0);
  return text.replace('{since}', day ? ` on ${dayFull(zonedInstant(day, '12:00:00', NY), NY)} (New York trading day)` : '')
    .replaceAll('{startingMoney}', money).replace('{deskMoney}', eur(STARTING_MONEY / 3n, false, 0))
    .replace('{sameStart}', day && since.trackingStart === day ? ' Same start as Results · All time.' : '');
}
const entryOf = (key, now = null, since = null) => {
  const entry = TERMS[key] ?? added.get(key);
  if (key === 'since') return [entry[0], sinceHelp(entry[1], since ?? undefined), entry[2]];
  if (key !== 'today') return entry;
  // Resolve at each tip render, including after midnight. Intl supplies both
  // zones' offsets at NY midnight itself, even on a clock-change Sunday.
  const midnight = zonedInstant(nyDay(now ?? new Date().toISOString()), '00:00:00', NY);
  const viennaTime = wall(midnight, VIENNA).slice(11, 16);
  return [entry[0], entry[1].replace('{nyMidnightVienna}', viennaTime), entry[2]];
};
export const learnBtn = key => `<button type="button" class="learn" data-term="${esc(key)}" data-learn="1" aria-expanded="false" aria-label="Learn: ${esc(entryOf(key)[0])}">${icon('book')}Learn</button>`;
export const term = (key, text) => `<button type="button" class="term" data-term="${key}">${esc(text ?? TERMS[key][0])}</button>`;

const ST_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
export const st = (tone, html, symbol = ST_ICON[tone]) => `<span class="st ${tone}">${icon(symbol)}<span>${html}</span></span>`;

// A signed result: arrow icon, sign, small unit, tabular digits. Zero has no
// sign or arrow; an unavailable value is a dash. Exact units (BigInt) format exactly.
export function bn(n, currency = 'EUR', signed = true, d = 2) {
  if (n == null || !known(n)) return '<span class="bn muted">—</span>';
  if (isZero(n)) n = typeof n === 'bigint' ? 0n : 0;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `<span class="bn ${signed ? tone(n) : ''}">${signed && n ? icon(arrowOf(n), 'i ar') : ''}${sign}<span class="u">${esc(currencySymbol(currency))}</span>${digits(n, d)}</span>`;
}
// Money inside running text (captions, sentences, the header): one unit that
// never wraps, so a line cannot end in its sign with the amount on the next.
// bn() and pl() already keep their figures whole.
export const moneyNoWrap = (n, currency = 'EUR', signed = false, d = 2) => `<span class="nowrap">${esc(money(n, currency, signed, d))}</span>`;
export const pl = (n, currency = 'EUR') => (n == null || !known(n) ? '<span class="muted">—</span>'
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

// Both labels occupy the same fixed track, even while one is invisible, so
// measuring the full sentence never changes the control's size or oscillates.
export function fitStatusLine(control, line, narrow = matchMedia('(max-width: 1100px)').matches) {
  const full = control.querySelector('.status-full');
  const compact = control.dataset.reason === 'signed-out' || control.dataset.tone === 'bad' || narrow || Boolean(full && full.scrollWidth > full.clientWidth + 0.5);
  control.toggleAttribute('data-compact', compact);
  const visible = control.dataset.reason === 'signed-out' || control.dataset.tone === 'bad' || (control.dataset.tone === 'warn' && compact);
  line.toggleAttribute('data-visible', visible);
  line.setAttribute('aria-hidden', String(!visible));
}

// One shared, opaque tip. Hover or focus shows it, a click or tap pins it,
// Escape closes it and keeps focus; scrolling closes it only if the anchor moved.
// A clamped sentence (data-say) shows itself whole there on a click, tap or
// keyboard focus; hovering it shows nothing, as its words are already in view.
const TRIGGER = '[data-term], [data-say]';
export function initTips({ now = () => null, since = () => null } = {}) {
  const tip = $('#tip');
  let anchor = null, pinned = false, quiet = null, at = null, dismissal = null;
  let restoreFocus = null;
  let focusPlacement = null;
  const cancelDismissal = () => { clearTimeout(dismissal); dismissal = null; };
  const overTip = el => el === tip || el?.closest?.('#tip') === tip;
  const inHoverRegion = el => overTip(el) || Boolean(anchor && el && anchor.contains(el));
  const inBox = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const overTipBox = e => Boolean(anchor && inBox(tip.getBoundingClientRect(), e));
  const inGap = e => {
    const a = anchor.getBoundingClientRect(), b = tip.getBoundingClientRect();
    return inBox({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
      top: Math.min(a.bottom, b.bottom), bottom: Math.max(a.top, b.top) }, e);
  };
  const delayDismissal = () => { cancelDismissal(); dismissal = setTimeout(() => hide(false), 150); };
  function place(el) {
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(10, Math.min(innerWidth - w - 10, el.dataset.learn ? r.right - w : r.left));
    let y = r.bottom + 8;
    if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 8);
    // A tip flipped above its term must leave the sticky Details control clear.
    const health = document.getElementById?.('hdrHealth')?.getBoundingClientRect();
    if (health && x < health.right && x + w > health.left && y < health.bottom && y + h > health.top) y = health.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    at = { x: r.left, y: r.top };
  }
  function fill(el) {
    if (el.dataset.say) {
      if (!TERMS[el.dataset.say]) return false;
      tip.innerHTML = `<b>${esc(TERMS[el.dataset.say][0])}</b>${el.querySelector('[data-clamp]')?.innerHTML ?? ''}`;
      return true;
    }
    const entry = entryOf(el.dataset.term, now(), since());
    if (!entry) return false;
    tip.innerHTML = `<b>${esc(entry[0])}</b>${esc(entry[1])}<span class="t2">${el.dataset.learn ? 'Term' : 'Also called'}: ${esc(entry[2])}</span>`;
    return true;
  }
  function show(el, pin) {
    if (!fill(el)) return;
    focusPlacement = null;
    restoreFocus?.();
    cancelDismissal();
    // Inside an open dialog the tip joins it, so it shows above the dialog.
    const host = el.closest('dialog[open]') ?? document.body;
    if (tip.parentElement !== host) host.append(tip);
    if (anchor && anchor !== el) {
      anchor.setAttribute('aria-expanded', 'false');
      anchor.removeAttribute('aria-describedby');
    }
    anchor = el; pinned = Boolean(pin);
    tip.classList.toggle('pinned', pinned);
    place(el);
    tip.classList.add('on');
    el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip');
  }
  function hide(force) {
    cancelDismissal();
    if (pinned && !force) return;
    focusPlacement = null;
    restoreFocus?.();
    tip.classList.remove('on', 'pinned');
    if (anchor) { anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-describedby'); }
    anchor = null; pinned = false;
    if (tip.parentElement !== document.body) document.body.append(tip);
  }
  function showFocused(el) {
    show(el, false);
    if (anchor !== el) return;
    // Native focus fires before scrolling an offscreen control into view.
    // Follow that initial scroll through the next frame; later scrolling
    // still dismisses a moved anchor. Layout can also retarget a stationary
    // pointer during this handoff, which is not a new hover interaction.
    const placement = focusPlacement = {};
    requestAnimationFrame(() => {
      if (focusPlacement !== placement) return;
      if (anchor && document.activeElement === anchor) place(anchor);
      focusPlacement = null;
    });
  }
  function reopenOnRefocus(el) {
    // Calling focus() on the active element emits no native focus event.
    // Watch only the Escape-dismissed control until it reopens or loses focus;
    // preserve the native call and the rebuild's quiet focus handoff.
    const own = Object.getOwnPropertyDescriptor(el, 'focus'), focus = el.focus;
    restoreFocus = () => {
      if (own) Object.defineProperty(el, 'focus', own);
      else delete el.focus;
      restoreFocus = null;
    };
    Object.defineProperty(el, 'focus', { configurable: true, writable: true, enumerable: own?.enumerable ?? false,
      value: function (...args) {
        const result = focus.apply(this, args);
        if (this === el && quiet !== el && document.activeElement === el) showFocused(el);
        return result;
      } });
  }
  // A rebuilt section hands an open tip to the same term in the new markup.
  rebuilt.tip = {
    anchor: () => anchor,
    // Focus handed back by a rebuild is not a new focus: it leaves the tip as it was.
    focus(el) {
      quiet = el;
      try { el.focus({ preventScroll: true }); } finally { quiet = null; }
    },
    moved(el) {
      if (!el || el.dataset.term !== anchor?.dataset.term || el.dataset.say !== anchor?.dataset.say) { hide(true); return; }
      anchor = el;
      if (el.dataset.say) fill(el);
      el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'tip');
      place(el);
    },
  };
  const hover = e => {
    if (e.pointerType === 'touch') return;
    if (focusPlacement && e.type === 'pointerover') return;
    focusPlacement = null;
    const el = e.target.closest?.('[data-term]');
    // Unpinned tips pass events through. Another trigger beneath the tip wins
    // immediately; otherwise its visible box still belongs to the hover region.
    if (el && el !== anchor && !pinned) { show(el, false); return; }
    if (!anchor || pinned) return;
    if (inHoverRegion(e.target) || overTipBox(e)) cancelDismissal();
    else if (inGap(e)) delayDismissal();
    else hide(false);
  };
  document.addEventListener('pointerover', hover);
  // A scroll can dismiss a tip while the pointer remains over its term.
  document.addEventListener('pointermove', hover);
  document.addEventListener('pointerout', e => {
    if (focusPlacement) return;
    if (!anchor || pinned || !inHoverRegion(e.target) || inHoverRegion(e.relatedTarget) || overTipBox(e)) return;
    // Leave time to cross the positioning gap between the term and its tip.
    delayDismissal();
  });
  document.addEventListener('pointerdown', e => {
    focusPlacement = null;
    if (anchor && !pinned && !inHoverRegion(e.target)) hide(false);
  }, true);
  // Capture native focus before a section can rebuild its focused term.
  document.addEventListener('focus', e => {
    const el = e.target.closest?.(TRIGGER);
    if (quiet === e.target) return;
    if (el && el !== anchor) showFocused(el);
  }, true);
  document.addEventListener('focusout', e => {
    // A rebuild removing the focused term is not the user leaving it.
    if (rebuilt.busy) return;
    restoreFocus?.();
    const el = e.target.closest?.(TRIGGER);
    if (el && el === anchor) hide(false);
  });
  addEventListener('scroll', () => {
    if (!anchor || !at) return;
    if (focusPlacement && document.activeElement === anchor) { place(anchor); return; }
    const r = anchor.getBoundingClientRect();
    if (Math.abs(r.left - at.x) > 1 || Math.abs(r.top - at.y) > 1) hide(true);
  }, { passive: true, capture: true });
  document.addEventListener('click', e => {
    const el = e.target.closest(TRIGGER);
    if (el) { if (anchor === el && pinned) hide(true); else show(el, true); e.preventDefault(); return; }
    if (!overTip(e.target)) hide(true);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !anchor) return;
    const el = anchor;
    hide(true);
    if (document.activeElement !== el) rebuilt.tip.focus(el);
    reopenOnRefocus(el);
    // Escape closes the tip only; an open dialog stays open for the next Escape.
    if (el.closest('dialog[open]')) e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  return { hide: root => { if (!root || root.contains(anchor)) hide(true); } };
}

// Dialogs open modal. Opened by a pointer, focus goes to the dialog's heading
// (tabindex -1) without a visible ring; opened from the keyboard, the dialog's
// first control takes focus with its ring. Tab stays inside an open dialog.
const controlsOf = root => $$('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])', root)
  .filter(n => !n.disabled && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
export function openDialog(dialog, { pointer = false } = {}) {
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  // The browser's own first focus may land on the heading; choose explicitly.
  const heading = dialog.querySelector('h2[tabindex="-1"]');
  if (pointer && heading) heading.focus({ preventScroll: true });
  else controlsOf(dialog)[0]?.focus({ preventScroll: true });
}
// A click from a mouse, pen or touch; a keyboard's click has no pointer type.
export const fromPointer = event => (typeof event?.pointerType === 'string' ? ['mouse', 'pen', 'touch'].includes(event.pointerType) : Boolean(event && event.detail > 0));
let dialogTrap = false;
export function trapDialogs() {
  if (dialogTrap) return;
  dialogTrap = true;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (!dialog) return;
    const items = controlsOf(dialog);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (!dialog.contains(active) || active === dialog || active.matches('h2[tabindex="-1"]')) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });
}

// Ages tick every second without rebuilding a section: structure changes
// replace the section, otherwise only the age texts are patched in place.
// A rebuild keeps keyboard focus and an open tip on the same control.
export const ageSpan = (key, text) => `<span class="age" data-age="${key}">${esc(text)}</span>`;
const AGE_RE = /<span class="age" data-age="([^"]+)">([^<]*)<\/span>/g;
const structure = new WeakMap();
const rebuilt = { tip: null, busy: false };
// Keep an interacting region stationary, even when a pointer-pinned tip has
// no keyboard focus. The next render after leaving may apply its new order.
export function interactionWithin(root) {
  const anchor = rebuilt.tip?.anchor();
  return root.contains(document.activeElement) || Boolean(anchor && root.contains(anchor));
}
const KEYS = ['data-term', 'data-say', 'data-desk-disclosure', 'data-go', 'data-hdesk', 'data-range', 'data-desk', 'data-day', 'data-period', 'data-field', 'data-themeopt', 'data-sec'];
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
    const disclosures = [...el.querySelectorAll('.disclosure-body[id]')].map(body => ({ id: body.id, hidden: body.hidden }));
    rebuilt.busy = true;
    try { el.innerHTML = html; } finally { rebuilt.busy = false; }
    structure.set(el, key);
    // Restore disclosure layout before measuring a rebuilt explanation anchor.
    // Otherwise a collapsed body briefly opens and places the tip in that layout.
    for (const body of disclosures) {
      const again = el.querySelector(`#${CSS.escape(body.id)}`);
      if (again) again.hidden = body.hidden;
    }
    if (tipped) rebuilt.tip.moved(find(el, tipped));
    const again = find(el, focused);
    if (again) rebuilt.tip?.focus(again);
    return true;
  }
  // A sentence shown whole in the tip ticks there too.
  const tipAnchor = rebuilt.tip?.anchor();
  const copy = tipAnchor?.dataset.say && el.contains(tipAnchor) ? $('#tip') : null;
  for (const [, name, text] of html.matchAll(AGE_RE)) {
    const plain = text.replace(/&amp;/g, '&');
    for (const node of [el.querySelector(`[data-age="${name}"]`), copy?.querySelector(`[data-age="${name}"]`)]) {
      if (node && node.textContent !== plain) node.textContent = plain;
    }
  }
  return false;
}

// The words for one panel state exactly as the shared selector gave it, with
// that panel's own age and reason; never re-ranked or borrowed from another.
// `held` names a retained value ("last good value", "last good positions").
export function statePhrase(cell, key, held = 'last good value', sharedReason = null) {
  const state = cell?.state ?? 'not reported';
  if (cell?.signedOut) return { tone: 'none', icon: 'ring', state,
    text: `${cell.value == null ? 'unavailable' : 'last known value'} · unknown while signed out` };
  const why = cell?.reason ? cellReason(cell.reason) : null;
  const localWhy = why !== sharedReason ? why : null;
  const suffix = localWhy ? ` · ${esc(localWhy)}` : '';
  const ago = () => ageSpan(key, cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`);
  // Said once: the reason follows only when it adds words to "not exact".
  if (notExactDash(cell)) return { tone: 'none', icon: 'info',
    text: `${NOT_EXACT}${localWhy === NOT_EXACT ? '' : suffix}`, state };
  if (state === 'fresh') return { tone: 'ok', text: '', state };
  if (state === 'not reported') return { tone: 'none', text: `not reported${suffix}`, state };
  if (cell.value == null) return { tone: 'bad', text: `unavailable${why ? suffix : ' · not available'}`, state };
  if (cell.retained) return { tone: 'warn', text: `${held}, ${ago()}${suffix}`, state };
  if (state === 'stale') return { tone: 'warn', text: `as of ${ago()}${suffix}`, state };
  return { tone: 'bad', text: `${localWhy ? `${esc(localWhy)} · ` : why ? '' : 'not available · '}as of ${ago()}`, state };
}
// A caption: the designed one when fresh, otherwise the state's own words.
export function stateCaption(cell, key, fresh = '', held, sharedReason = null) {
  const p = statePhrase(cell, key, held, sharedReason);
  return p.state === 'fresh' ? fresh : capital(p.text);
}

// Use the real caption builder for every state/reason combination. Days and
// hours exercise both long ages and the longest unbroken age token; unknown
// ages have their own wording. Sizing copies never tick or enter accessibility.
export const CAPTION_PHRASES = [...new Set([null, ...Object.keys(CELL_REASON)].flatMap(reason =>
  [null, 999 * 86400, 23 * 3600 + 59 * 60].flatMap(ageSeconds => [
    { state: 'not reported', value: null },
    { state: 'broken', value: null },
    { state: 'broken', value: {}, retained: true },
    { state: 'stale', value: {} },
    { state: 'broken', value: {} },
  ].map(cell => stateCaption({ ...cell, reason, ageSeconds }, 'sizing').replace(AGE_RE, '$2')))
))];
// A caption's box is as tall as its tallest phrase, and the tallest phrases
// are the longest: the sixteen longest are laid out, not all 401 (every Desk
// update rebuilt some 1,200 hidden boxes for the hero's three captions).
// ui-modules.mjs measures that they reserve every phrase's lines at every
// width, in the wide font and in a narrower one.
const plainLength = text => text.replace(/&[#\w]+;/g, '&').length;
export const CAPTION_RESERVE = CAPTION_PHRASES.map((text, i) => ({ text, i }))
  .sort((a, b) => plainLength(b.text) - plainLength(a.text) || a.i - b.i).slice(0, 16).map(p => p.text);
const CAPTION_SIZING = CAPTION_RESERVE.map(text => `<span class="cash-sizing" aria-hidden="true">${text}</span>`).join('');
export function reservedCaption(caption, freshCaptions) {
  const fresh = [...new Set(freshCaptions)].map(text =>
    `<span class="cash-sizing" aria-hidden="true">${stateCaption({ state: 'fresh' }, '', text)}</span>`).join('');
  return `<span class="account-caption"><span>${caption}</span>${fresh}${CAPTION_SIZING}</span>`;
}

// Each reason reserves its actual wrapping, including the session form at
// 360 px: character count cannot predict how words wrap in a narrow column.
// The label and Amy's caption have their own fixed rows in both surfaces.
const CASH_SIZING = [...new Set(Object.keys(CELL_REASON).flatMap(reason =>
  [dashWords(reason), `−€ 999.999,99 · ${cellReason(reason)}`]))
].map(text => `<span class="cash-sizing" aria-hidden="true">${esc(text)}</span>`).join('');
export function cashCaption(cell, key, { figure = false, sharedReason = null } = {}) {
  const value = cell?.state === 'broken' && cell.retained ? null : cell?.value;
  const why = cell?.reason ? cellReason(cell.reason) : null;
  // A missing Cash is named like every other dash: "not exact" when the feed
  // says so, else its reason once (no data received yet by default).
  const notExact = value == null && NOT_EXACT_REASONS.has(cell?.reason);
  const missing = dashWords(cell?.reason ?? 'feed_not_received');
  const view = value == null ? { text: missing, title: `Cash${notExact ? ':' : ''} ${missing}` } : cashAmount(value);
  if (value != null && why) { view.text += ` · ${why}`; view.title += ` · ${why}`; }
  if (figure) {
    const amount = value == null ? '—' : cashAmount(value).text;
    const reason = why ?? (value == null ? cellReason('feed_not_received') : '');
    const localReason = reason !== sharedReason ? reason : '';
    const state = notExact ? `${NOT_EXACT}${localReason && localReason !== NOT_EXACT ? ` · ${esc(localReason)}` : ''}`
      : value == null ? esc(localReason) : localReason ? ` · ${esc(localReason)}` : '';
    return `<div class="kpi cash-kpi cash-block"><dt class="cash-label">Cash</dt><dd><span class="account-cash" data-cash="${esc(key)}" data-state="${cell?.state ?? 'not reported'}" role="group" title="${esc(view.title)}" aria-label="${esc(view.title)}"><span class="cash-amount${value == null ? ' muted' : ''}">${esc(amount)}</span>
      <span class="cash-caption cash-reserve c"><span class="cash-description">cash · as the broker reports it</span>
        <span class="cash-reason">${state}</span></span></span></dd></div>`;
  }
  return `<span class="cash-block"><span class="cash-label">Cash</span><span class="cash-caption">cash · as the broker reports it</span><span class="cash-reserve"><span class="account-cash" data-cash="${esc(key)}" data-state="${cell?.state ?? 'not reported'}" role="group" title="${esc(view.title)}" aria-label="${esc(view.title)}">${esc(view.text)}</span>${CASH_SIZING}</span></span>`;
}
