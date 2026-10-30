// JOED-170: fresh early-exit scans and frozen legacy fallback on every fit.
// The 14000-trade / 288-day fixture counts all explicit geometry getters on
// eleven switches, including natural copies; CSSOM reads are counted
// separately. No browser, timing-budget change or guard change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { htmlDocument, builders } from './fixtures/preview-dom.mjs';
import { createHash } from 'node:crypto';
import { NOW } from '../scripts/browser/board.mjs';
import { largeResults } from '../scripts/browser/results.mjs';

const rootUrl = new URL('../', import.meta.url);
const moduleUrl = file => new URL(`public/joe/${file}`, rootUrl);
function sourceModule(file, revision, modelUrl, transform = value => value) {
  const url = moduleUrl(file);
  // The frozen release-40 sources are vendored (byte-identical to rebuild/v2 28e1edb, i.e. 2818f8c),
  // because CI's shallow checkout has no history to `git show` from.
  const source = transform(revision ? readFileSync(new URL(`test/fixtures/results-legacy-r40/${file}`, rootUrl), 'utf8') : readFileSync(url, 'utf8'));
  const absolute = source.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) => {
    const target = specifier === './results-model.js' && modelUrl ? modelUrl
      : new URL(specifier === './time.mjs' || specifier.startsWith('./contracts/') ? `../../${specifier.slice(2)}` : specifier, url).href;
    return `from ${JSON.stringify(target)}`;
  });
  return `data:text/javascript,${encodeURIComponent(absolute)}`;
}
async function loadRevision(revision) {
  const modelUrl = sourceModule('results-model.js', revision);
  return { page: await import(sourceModule('results.js', revision, modelUrl)), model: await import(modelUrl) };
}
const PARENT = '2818f8c';
const legacy = await loadRevision(PARENT);
const page = await import('../public/joe/results.js');
const { joinUnits } = await import('../public/joe/format.js');
const M = await import('../public/joe/results-model.js');

// Frozen verbatim from 9becb33:public/joe/results.js (export/name only changed).
function legacyFitTradeRows(root) {
  const rows = [...root?.querySelectorAll?.('.trow') ?? []];
  const columns = rows.map(row => {
    const px = row.querySelector('.px');
    row.classList.remove('prices-below');
    px.classList.remove('small', 'wrap-fee');
    const ln = px.querySelector('.ln'), prices = [...ln.children], fee = px.querySelector('.fee');
    return { row, px, ln, prices, fee };
  });
  const overflows = (el, column) => {
    const box = column.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(el);
    // scrollWidth misses overflow to the left of right-aligned fee text.
    return el.scrollWidth > el.clientWidth || [...range.getClientRects()].some(r => r.left < box.left || r.right > box.right);
  };
  const needsSmall = columns.some(({ px, ln, prices, fee }) => px.clientWidth &&
    (prices.some(el => overflows(el, ln)) || overflows(fee, px)));
  // Decide once for the panel, before any fee or below-row fallback.
  if (needsSmall) for (const { px } of columns) px.classList.add('small');
  for (const { row, px, ln, prices, fee } of columns) {
    if (!px.clientWidth) continue;
    const pricesOverflow = () => prices.some(el => overflows(el, ln));
    if (pricesOverflow() || overflows(fee, px)) px.classList.add('wrap-fee');
    // Beyond the supported long-price fixture, keep an indivisible price
    // visible beneath the first row if even the small token cannot fit.
    if (pricesOverflow()) row.classList.add('prices-below');
  }
  for (const row of rows) {
    const units = [...row.querySelectorAll('.meta-unit')];
    for (const [i, unit] of units.entries()) {
      const suffix = unit.querySelector('.meta-sep');
      if (!suffix || !unit.clientWidth) continue;
      const box = unit.getBoundingClientRect(), next = units[i + 1]?.getBoundingClientRect();
      // Visibility keeps the suffix's width. Repeated fits and resizes cannot
      // move a unit back onto the preceding line and flip the dot on again.
      suffix.classList.toggle('line-end', !next || next.top >= box.bottom - 0.5);
    }
  }
}

const GAP = 8, GRID = 10, ICON = 12, IGAP = 5;
const units3 = [{ w: 120 }, { w: 120 }, { w: 80 }];

function rowHtml(spec) {
  const prices = spec.prices.map(p => `<span>${p.icon ? '<svg class="i"></svg>' : ''}${p.text}</span>`).join('');
  const units = spec.units.map(() => '<span class="meta-unit">meta<span class="meta-sep"> ·</span></span>').join('');
  return `<div class="trow"><div class="name">${units}</div><div class="px"><span class="ln">${prices}</span><span class="fee">fees</span></div><div class="net">net</div></div>`;
}
function place(widths, max) {
  const items = [];
  let right = 0, placed = false;
  for (const w of widths) {
    if (!(w > 0)) { items.push({ start: 0, w: 0 }); continue; }
    if (placed && right + GAP + w > max) { right = 0; placed = false; }
    const start = placed ? right + GAP : 0;
    items.push({ start, w });
    right = start + w;
    placed = true;
  }
  return items;
}
// Resolve both native scrollbars together: horizontal overflow consumes height,
// and vertical overflow consumes width. Responsive rows can depend on either.
function scrollState(list) {
  const scroll = list._scroll;
  // Preserve the original gutter-first fixture for f3. Explicit 0 selects
  // native two-axis solving too, so overlay scrollbars cannot mask f5.
  if (scroll.horizontalGutter === undefined) {
    const vertical = list.style.overflowY === 'scroll' || (list.style.overflowY !== 'hidden'
      && contentHeight(list, true) + tailHeight(list, true) > scroll.viewport);
    return { vertical, horizontal: false, width: scroll.width - (vertical ? scroll.gutter : 0), height: scroll.viewport };
  }
  let vertical = list.style.overflowY === 'scroll', horizontal = false;
  for (let pass = 0; pass < 3; pass++) {
    const height = scroll.viewport - (horizontal ? scroll.horizontalGutter ?? 0 : 0);
    if (list.style.overflowY !== 'hidden' && contentHeight(list, vertical, horizontal) + tailHeight(list, vertical) > height) vertical = true;
    if (horizontalExcess(list, vertical) > 0) horizontal = true;
  }
  return { vertical, horizontal, width: scroll.width - (vertical ? scroll.gutter : 0),
    height: scroll.viewport - (horizontal ? scroll.horizontalGutter ?? 0 : 0) };
}
function tailHeight(list, gutter) {
  return (!gutter ? list._scroll.noteWithoutGutter : undefined) ?? list._scroll.tailHeight ?? 0;
}
function horizontalExcess(list, gutter) {
  return Math.max(0, ...list._rows.map(row => {
    const spec = row._spec, px = row._px;
    const scale = (px.classList.contains('small') ? spec.smallFont ?? 11 : naturalFont(row)) / 12.5;
    const hint = px.classList.contains('small') ? spec.smallAdjustment ?? 0 : 0;
    const width = spec.pxW - (gutter ? list._scroll.gutter : 0);
    return Math.max(spec.fee.text * scale * (spec.advance ?? 1) + (spec.spacing ?? 0) + hint,
      ...spec.prices.map(price => (price.icon ? ICON + IGAP : 0) + price.text * scale * (spec.advance ?? 1) + (spec.spacing ?? 0) + hint)) - width;
  }));
}
function columnWidth(row) {
  const list = row.closest('.dp-list'), scroll = list?._scroll;
  if (!scroll) return row._spec.pxW;
  return row._spec.pxW - (scrollState(list).vertical ? scroll.gutter : 0);
}
const naturalFont = row => row._spec.maskedFont && row.closest('.large-natural') ? 16 : row._spec.fontSize ?? 12.5;
function contentHeight(list, gutter, horizontal = false) {
  return (list._rows ?? [...list.querySelectorAll('.trow')]).filter(item => item.style.position !== 'fixed')
    .reduce((sum, item) => sum + rowHeight(item, gutter, horizontal), list._scroll?.headerHeight ?? 0);
}
function rowHeight(row, gutter, horizontal = false) {
  const scroll = row.closest('.dp-list')?._scroll;
  if (!scroll) return 40;
  const px = row._px ?? row.querySelector('.px');
  if (gutter === undefined) {
    const list = row.closest('.dp-list');
    ({ vertical: gutter, horizontal } = scrollState(list));
  }
  if (row._spec.heights) {
    const step = row.classList.contains('prices-below') ? 3 : px.classList.contains('wrap-fee') ? 2 : px.classList.contains('small') ? 1 : 0;
    return row._spec.heights[step] + (gutter ? row._spec.gutterHeight ?? 0 : 0)
      + (horizontal ? row._spec.horizontalHeight ?? 0 : 0);
  }
  return (px.classList.contains('small') ? scroll.smallHeight : scroll.naturalHeight)
    + (px.classList.contains('wrap-fee') ? scroll.wrapHeight : 0)
    + (row.classList.contains('prices-below') ? scroll.belowHeight : 0);
}
function armScroll(list) {
  list._rows = [...list.querySelectorAll('.trow')];
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => scrollState(list).height });
  Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => scrollState(list).width });
  Object.defineProperty(list, 'offsetWidth', { configurable: true, get: () => list._scroll.width });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => {
    const state = scrollState(list);
    return Math.max(state.height, contentHeight(list, state.vertical, state.horizontal) + tailHeight(list, state.vertical));
  } });
  Object.defineProperty(list, 'scrollWidth', { configurable: true, get: () => {
    const state = scrollState(list);
    return state.width + (list._scroll.horizontalGutter !== undefined ? horizontalExcess(list, state.vertical) : 0);
  } });
  list.getBoundingClientRect = () => ({ top: 0, bottom: list._scroll.viewport, height: list._scroll.viewport });
  const last = [...list.children].at(-1);
  if (last && !last.matches('.trow') && !last.matches('.scroll-tail')) last.getBoundingClientRect = () => {
    const state = scrollState(list);
    const height = contentHeight(list, state.vertical, state.horizontal) + tailHeight(list, state.vertical);
    return { top: 0, bottom: height, height };
  };
}
function armTail(tail) {
  tail.getBoundingClientRect = () => {
    const list = tail.closest('.dp-list'), height = tailHeight(list, scrollState(list).vertical);
    const top = [...list.querySelectorAll('.trow')].reduce((sum, row) => sum + rowHeight(row), 0);
    return { top, bottom: top + height, height };
  };
}
function armReactive(row) {
  const spec = row._spec;
  const px = row.querySelector('.px'), ln = row.querySelector('.ln'), fee = row.querySelector('.fee');
  row._px = px;
  const prices = [...ln.children].filter(node => typeof node !== 'string');
  const units = [...row.querySelectorAll('.meta-unit')];
  prices.forEach((el, i) => { el._text = spec.prices[i].text; el._icon = Boolean(spec.prices[i].icon); });
  fee._text = spec.fee.text;
  units.forEach((el, i) => { el._w = spec.units[i].w; el.clientWidth = spec.units[i].w; });
  row.querySelector('.name').clientWidth = spec.nameW;
  const laid = () => {
    const scale = (px.classList.contains('small') ? spec.smallFont ?? 11 : naturalFont(row)) / 12.5;
    const advance = spec.advance ?? 1;
    const wrap = px.classList.contains('wrap-fee');
    const hint = px.classList.contains('small') ? spec.smallAdjustment ?? 0 : 0;
    const widths = prices.map(el => (el._icon ? ICON + IGAP : 0) + el._text * scale * advance + (spec.spacing ?? 0) + hint);
    const feeW = fee._text * scale * advance + (spec.spacing ?? 0) + hint;
    const gap = spec.ancestorGap && row.closest('.wide-gap') ? 20 : GRID;
    const beside = Math.max(0, columnWidth(row) - gap - feeW);
    const lnMax = wrap ? columnWidth(row) : beside;
    const placed = place(widths, lnMax);
    const contentMax = placed.reduce((max, item) => Math.max(max, item.start + item.w), 0);
    const lnW = Math.min(lnMax, contentMax);
    const lnRect = { left: 0, right: lnW, top: 0, bottom: 18, width: lnW, height: 18 };
    const priceGeom = placed.map(item => ({
      clientWidth: Math.round(item.w), scrollWidth: Math.round(item.w),
      rect: { left: item.start, right: item.start + item.w, top: 0, bottom: 18, width: item.w, height: 18 },
    }));
    const feeLeft = wrap ? 0 : lnW + gap;
    const feeGeom = { clientWidth: Math.round(feeW), scrollWidth: Math.round(feeW), rect: { left: feeLeft, right: feeLeft + feeW, top: 0, bottom: 18, width: feeW, height: 18 } };
    return { lnRect, priceGeom, feeGeom };
  };
  const bind = (el, read) => {
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => read().clientWidth });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => read().scrollWidth });
    el._box = () => read().rect;
    el.getBoundingClientRect = () => el._box();
  };
  bind(px, () => ({ clientWidth: columnWidth(row), scrollWidth: columnWidth(row), rect: { left: 0, right: columnWidth(row), top: 0, bottom: 40, width: columnWidth(row), height: 40 } }));
  bind(ln, () => { const box = laid().lnRect; return { clientWidth: box.width, scrollWidth: box.width, rect: box }; });
  prices.forEach((el, i) => bind(el, () => laid().priceGeom[i]));
  bind(fee, () => laid().feeGeom);
  units.forEach((el, i) => {
    el._box = () => {
      let x = 0, y = 0;
      const boxes = units.map(unit => {
        const w = unit._w;
        if (x > 0 && x + w > spec.nameW) { x = 0; y += 16; }
        const rect = { left: x, top: y, right: x + w, bottom: y + 16, width: w, height: 16 };
        x += w + 4;
        return rect;
      });
      return boxes[i];
    };
    el.getBoundingClientRect = () => el._box();
  });
}
function mount(spec) {
  const own = { ...spec, pxW: spec.pxW, nameW: spec.nameW, prices: spec.prices.map(p => ({ ...p })), fee: { ...spec.fee }, units: spec.units.map(u => ({ ...u })) };
  const doc = htmlDocument(`<div id="root">${rowHtml(own)}</div>`);
  doc.createRange = () => ({ selectNodeContents(el) { this.el = el; }, getClientRects() {
    const rect = this.el._box(), ink = this.el.closest('.trow')._spec.inkLeft ?? 0;
    return [{ ...rect, left: rect.left - ink }];
  } });
  const row = doc.querySelector('.trow');
  row._spec = own;
  armReactive(row);
  enableCopies(doc);
  return { doc, root: doc.querySelector('#root'), spec: own };
}
function enableCopies(doc, count = null) {
  const proto = Object.getPrototypeOf(doc);
  if (!proto.appendChild) proto.appendChild = function(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  };
  if (!proto.cloneNode) proto.cloneNode = function(deep) {
    const clone = node => {
      const next = new node.constructor(node.tagName, { ...node.attributes });
      next.style = { ...node.style };
      next._count = node._count;
      next._scroll = node._scroll;
      if (deep) for (const child of node.children) {
        const item = typeof child === 'string' ? child : clone(child);
        next.children.push(item);
        if (typeof item !== 'string') item.parentElement = next;
      }
      if (node._spec) { next._spec = node._spec; armReactive(next); }
      if (node._scroll) armScroll(next);
      if (node.classList.contains('scroll-tail')) armTail(next);
      if (node._wrapColumns) { next._wrapColumns = node._wrapColumns; armWrappingBody(next); }
      if (node._bodyMeasure) {
        next._bodyMeasure = node._bodyMeasure;
        Object.defineProperty(next, 'scrollHeight', { configurable: true, get: () =>
          next.querySelector('.dp-reasons-more')?.hidden ? next._bodyMeasure.expanded : next._bodyMeasure.collapsed });
      }
      if (node._summary) armSummary(next, node._summary, node._count);
      next.hidden = node.hidden;
      return next;
    };
    const copy = clone(this);
    copy._probe = true;
    if (this._summary) armSummary(copy, this._summary, this._count);
    instrument(copy, this._count);
    return copy;
  };
  const visit = el => {
    el._count = count;
    for (const child of el.children) if (typeof child !== 'string') visit(child);
  };
  visit(doc);
  doc.styleSheets = [];
  doc.fonts = { status: 'loaded' };
}
function installCSSOM() {
  globalThis.getComputedStyle = el => {
    el._count?.styleRead();
    const row = el.closest('.trow'), spec = row?._spec;
    const small = Boolean(el.closest('.px')?.classList.contains('small'));
    const summary = el._summary ?? el.parentElement?._summary;
    const fontSize = spec?.maskedFont && !el.closest('.px') ? 12.5
      : small ? spec?.smallFont ?? 11 : spec ? naturalFont(row) : 12.5;
    const width = spec ? el === row ? columnWidth(row) + spec.nameW + 50
      : el.classList.contains('name') ? spec.nameW : columnWidth(row) : summary?.width ?? 0;
    return { width: `${el._scroll?.width ?? width}px`, height: el._scroll ? `${el._scroll.viewport}px` : 'auto', maxHeight: 'none', display: 'block', boxSizing: 'content-box',
      fontFamily: spec?.fontFamily ?? 'DejaVu Sans', fontWeight: String(spec?.fontWeight ?? 400),
      fontSize: `${fontSize}px`, letterSpacing: `${spec?.spacing ?? 0}px`,
      columnGap: `${spec?.ancestorGap && row.closest('.wide-gap') ? 20 : GRID}px`,
      getPropertyValue: name => name === '--trade-price-small' ? `${spec?.smallFont ?? 11}px` : '' };
  };
}
function instrument(el, count) {
  if (!count || el._instrumented) return;
  el._instrumented = true;
  watch(el, count);
  for (const name of ['clientWidth', 'clientHeight', 'scrollWidth', 'offsetWidth', 'scrollHeight']) {
    const desc = Object.getOwnPropertyDescriptor(el, name);
    if (desc && !desc.configurable) continue;
    let value = desc?.value ?? 0;
    Object.defineProperty(el, name, { configurable: true,
      get() { count.read(name, this); return desc?.get ? desc.get.call(this) : value; },
      set(next) { if (desc?.set) desc.set.call(this, next); else value = next; } });
  }
  if (el.getBoundingClientRect) {
    const read = el.getBoundingClientRect;
    el.getBoundingClientRect = function() { count.read('rect', this); return read.call(this); };
  }
  for (const child of el.children) if (typeof child !== 'string') instrument(child, count);
}
function armSummary(el, spec, count) {
  el._summary = spec;
  el._count = count;
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => spec.width });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => {
    const sum = el.querySelector('#calSum');
    const compact = (sum ?? el).classList.contains('compact');
    const trades = el.querySelector('.dp-trades');
    return compact || trades?.hidden ? spec.short : spec.full;
  } });
  el.getBoundingClientRect = () => ({ left: 0, right: spec.width, width: spec.width, top: 0, bottom: 20, height: 20 });
  for (const child of el.children) if (typeof child !== 'string') armSummary(child, spec, count);
}

function fitSig(root) {
  return [...root.querySelectorAll('.trow')].map(row => {
    const px = row.querySelector('.px');
    const ends = [...row.querySelectorAll('.meta-sep')].map(el => (el.classList.contains('line-end') ? '1' : '0')).join('');
    return `${px.classList.contains('small') ? 's' : ''}${px.classList.contains('wrap-fee') ? 'w' : ''}${row.classList.contains('prices-below') ? 'b' : ''}/${ends}`;
  }).join(';');
}
function fitBoth(spec) {
  const before = globalThis.document;
  const oldDom = mount(spec), nextDom = mount(spec);
  globalThis.document = oldDom.doc;
  legacyFitTradeRows(oldDom.root);
  globalThis.document = nextDom.doc;
  page.fitTradeRows(nextDom.root);
  const sig = [fitSig(oldDom.root), fitSig(nextDom.root)];
  if (before === undefined) delete globalThis.document;
  else globalThis.document = before;
  return { sig, nextDom };
}

function counter() {
  return {
    reads: 0, styleReads: 0, writes: 0, probeWrites: 0, rects: 0, scanReads: 0, scannedRows: new Set(), containerReads: [], transitions: 0, dirty: false, wrote: false, interleaved: false,
    read(kind, el) {
      const row = el?.closest('.trow');
      if (row && !liveElement(el)) { this.scanReads++; this.scannedRows.add(row._spec.rowIndex); }
      if (el && !row && !liveElement(el)) this.containerReads.push(kind);
      if (this.dirty) { this.transitions++; this.dirty = false; }
      this.reads += 1;
      if (kind === 'rects') this.rects += 1;
      if (this.wrote) this.interleaved = true;
    },
    styleRead() { this.styleReads += 1; if (this.wrote) this.interleaved = true; },
    write(probe = false) { this.dirty = true; if (probe) this.probeWrites += 1; else { this.writes += 1; this.wrote = true; } },
    reset() { this.reads = 0; this.styleReads = 0; this.writes = 0; this.probeWrites = 0; this.rects = 0; this.scanReads = 0; this.scannedRows.clear(); this.containerReads = []; this.transitions = 0; this.dirty = false; this.wrote = false; this.interleaved = false; },
  };
}
// Count explicit geometry and class/style-write-to-geometry-read transitions,
// including attached copies. CSSOM reads are separate; attachment/removal events
// are excluded. Interleaving records live writes; legacy fallback permits them.
function liveElement(el) {
  for (let node = el; node; node = node.parentElement) if (node._probe) return false;
  return Boolean(el.closest('document'));
}
function watch(el, count) {
  if (el._watched) return;
  el._watched = true;
  const orig = Object.getPrototypeOf(el).setAttribute;
  el.setAttribute = function setAttribute(key, value) {
    const next = String(value);
    if ((key === 'class' || key === 'style') && this.getAttribute(key) !== next && this.closest('document')) count.write(!liveElement(this));
    return orig.call(this, key, value);
  };
  el.style = new Proxy(el.style, { set(style, key, value) {
    if (style[key] !== value && el.closest('document')) count.write(!liveElement(el));
    style[key] = value; return true;
  } });
  let hidden = Boolean(el.hidden ?? el.getAttribute('hidden') !== null);
  Object.defineProperty(el, 'hidden', {
    configurable: true,
    get() { return hidden; },
    set(value) { const on = Boolean(value); if (on !== hidden && this.closest('document')) count.write(!liveElement(this)); hidden = on; },
  });
}
function box(el, rect, count) {
  el._box = () => rect;
  el.getBoundingClientRect = () => { count.read('rect'); return el._box(); };
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get() { count.read('offset'); return rect.width; } });
}
function armBudget(panel, count) {
  for (const row of panel.querySelectorAll('.trow')) {
    const prices = [...row.querySelector('.ln').children].filter(el => el?.classList);
    row._spec = { pxW: count.pxW ?? 420, nameW: 300, prices: prices.map(el => ({ text: 70, icon: Boolean(el.querySelector('.i')) })),
      fee: { text: 60 }, units: [...row.querySelectorAll('.meta-unit')].map(() => ({ w: 40 })) };
    armReactive(row);
    const visit = el => { el._count = count; for (const child of el.children) if (typeof child !== 'string') visit(child); };
    visit(row);
    instrument(row, count);
  }
  const head = panel.querySelector('.dp-head');
  if (head) { armSummary(head, { width: 100, full: 180, short: 80 }, count); instrument(head, count); }
}

function hookPanel(panel, count) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(panel), 'innerHTML');
  Object.defineProperty(panel, 'innerHTML', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(html) { desc.set.call(this, html); armBudget(this, count); },
  });
}
function skeleton() {
  return `<div id="periodSeg">
      <button type="button" data-period="day">Day</button><button type="button" data-period="week" aria-pressed="true">Week</button>
      <button type="button" data-period="month">Month</button><button type="button" data-period="ytd">Year</button><button type="button" data-period="all">All</button>
    </div>
    <button type="button" id="prevPer"></button><span id="perLabel"></span><button type="button" id="nextPer"></button>
    <div id="deskSeg"></div><div id="rheroL"></div><div id="curveLegend"></div>
    <div id="curve"><div id="resStatus"></div></div><div id="tiles"></div><h2 id="bdTitle"></h2><div id="breakdown"></div>
    <button type="button" id="prevMonth"></button><h3 id="calTitle"></h3><button type="button" id="nextMonth"></button>
    <div class="cal-head"><span class="sub" id="calSum"></span></div>
    <div id="cal"></div><div id="calLegend"></div><div id="daypanel"></div>
    <dialog id="daySheet"><h2 id="sheetTitle"></h2><div id="sheetBody"></div></dialog>`;
}
function prepare(doc, count) {
  enableCopies(doc, count);
  doc.activeElement = null;
  doc.createRange = () => ({
    selectNodeContents(el) { this.el = el; },
    getClientRects() { count.read('rects', this.el); return [this.el?._box?.() ?? { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }]; },
  });
  const curve = doc.querySelector('#curve');
  curve.clientWidth = 0;
  curve.clientHeight = 0;
  box(curve, { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }, count);
  const calSum = doc.querySelector('#calSum');
  armSummary(calSum.parentElement, { width: 100, full: 180, short: 80 }, count);
  instrument(calSum.parentElement, count);
  hookPanel(doc.querySelector('#daypanel'), count);
  const sheet = doc.querySelector('#daySheet');
  sheet.open = false;
  hookPanel(doc.querySelector('#sheetBody'), count);
}
function switchesOf(target, model, doc, count, record) {
  const before = globalThis.document;
  globalThis.document = doc;
  Object.assign(target.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
  target.forgetResults();
  const ctx = {
    now: NOW,
    states: { results: { state: 'fresh', value: { index: model.indexResults(record) }, reason: null } },
    feeds: { data: { value: { desks: [] } }, history: { value: null } },
  };
  const view = () => target.resultsView(ctx);
  target.renderResults(ctx);
  const clicks = [
    () => target.choosePeriod('all', view()),
    () => target.chooseDesk('j'),
    () => target.choosePeriod('ytd', view()),
    () => target.chooseDesk('all'),
    () => target.choosePeriod('month', view()),
    () => target.stepPeriod(-1, view()),
    () => target.choosePeriod('day', view()),
    () => target.selectDay(doc.querySelector('#cal [data-day]:not(.fut)').dataset.day, view()),
    () => target.choosePeriod('week', view()),
    () => target.chooseDesk('joel'),
    () => target.chooseDesk('all'),
  ];
  const switches = clicks.map(click => {
    count.reset();
    click();
    target.renderResults(ctx);
    return { reads: count.reads, styleReads: count.styleReads, writes: count.writes, probeWrites: count.probeWrites, rects: count.rects, transitions: count.transitions, scanReads: count.scanReads, interleaved: count.interleaved, sig: fitClasses(doc) };
  });
  if (before === undefined) delete globalThis.document;
  else globalThis.document = before;
  return switches;
}
function fitClasses(doc) {
  return [...doc.querySelectorAll('#daypanel .trow')].map(row => {
    const px = row.querySelector('.px');
    const ends = [...row.querySelectorAll('.meta-sep')].map(el => (el.classList.contains('line-end') ? '1' : '0')).join('');
    return `${px?.classList.contains('small') ? 's' : ''}${px?.classList.contains('wrap-fee') ? 'w' : ''}${row.classList.contains('prices-below') ? 'b' : ''}/${ends}`;
  }).join(';');
}

test('JOED-170 batches Results geometry reads and keeps the fit classes', { timeout: 180000 }, async t => {
  const css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  assert.doesNotMatch(page.renderHero.toString(), /periodBase/, 'the hero asks for the base once');
  assert.match(page.renderHero.toString(), /periodQuote/);
  const cases = [
    ['wide', { pxW: 420, nameW: 400, prices: [{ text: 70, icon: false }, { text: 70, icon: false }, { text: 70, icon: false }], fee: { text: 60 }, units: units3 }],
    ['wraps inside the line', { pxW: 250, nameW: 400, prices: [{ text: 100, icon: false }, { text: 100, icon: false }, { text: 100, icon: false }], fee: { text: 40 }, units: units3 }],
    ['medium', { pxW: 400, nameW: 400, prices: [{ text: 360, icon: false }], fee: { text: 40 }, units: units3 }],
    ['icon stays full size', { pxW: 400, nameW: 400, prices: [{ text: 385, icon: true }], fee: { text: 40 }, units: units3 }],
    ['narrow', { pxW: 220, nameW: 400, prices: [{ text: 200, icon: false }], fee: { text: 80 }, units: units3 }],
    ['tiny', { pxW: 180, nameW: 400, prices: [{ text: 250, icon: false }], fee: { text: 30 }, units: units3 }],
    ['left ink overhang', { pxW: 420, nameW: 200, prices: [{ text: 70 }], fee: { text: 40 }, units: units3, inkLeft: 0.25 }],
    ['hidden price, visible metadata', { pxW: 0, nameW: 200, prices: [{ text: 70 }], fee: { text: 40 }, units: units3 }],
    ['meta wraps', { pxW: 420, nameW: 200, prices: [{ text: 70, icon: false }], fee: { text: 40 }, units: units3 }],
  ];
  const expected = {
    wide: '/001', 'wraps inside the line': '/001', medium: 's/001', 'icon stays full size': 'sw/001',
    narrow: 'sw/001', tiny: 'swb/001', 'meta wraps': '/111', 'left ink overhang': 'swb/111', 'hidden price, visible metadata': '/111',
  };
  for (const [label, spec] of cases) {
    const { sig } = fitBoth(spec);
    assert.equal(sig[0], expected[label], `legacy ${label}`);
    assert.equal(sig[1], sig[0], label);
  }
  const shrunk = { pxW: 400, nameW: 300, prices: [{ text: 360, icon: false }], fee: { text: 40 }, units: units3 };
  const stayed = fitBoth(shrunk).nextDom;
  stayed.spec.pxW = 180;
  const fresh = mount({ ...shrunk, pxW: 180 });
  const before = globalThis.document;
  globalThis.document = stayed.doc;
  page.fitTradeRows(stayed.root);
  globalThis.document = fresh.doc;
  legacyFitTradeRows(fresh.root);
  assert.equal(fitSig(fresh.root), 'swb/011', 'legacy narrows to the below-row fallback');
  assert.equal(fitSig(stayed.root), fitSig(fresh.root), 'a narrower column remeasures the natural states');
  const grown = fitBoth(shrunk).nextDom;
  grown.spec.pxW = 800;
  const grownFresh = mount({ ...shrunk, pxW: 800 });
  globalThis.document = grown.doc;
  page.fitTradeRows(grown.root);
  globalThis.document = grownFresh.doc;
  legacyFitTradeRows(grownFresh.root);
  assert.equal(fitSig(grownFresh.root), '/011');
  assert.equal(fitSig(grown.root), fitSig(grownFresh.root), 'a wider column drops the small token');
  if (before === undefined) delete globalThis.document;
  else globalThis.document = before;

  const hidden = mount({ pxW: 0, nameW: 0, prices: [{ text: 80, icon: false }], fee: { text: 20 }, units: [{ w: 0 }, { w: 0 }, { w: 0 }] });
  const px = hidden.root.querySelector('.px'), row = hidden.root.querySelector('.trow');
  px.classList.add('small', 'wrap-fee');
  row.classList.add('prices-below');
  hidden.root.querySelector('.meta-sep').classList.add('line-end');
  const reads = counter();
  const savedRead = globalThis.document;
  globalThis.document = hidden.doc;
  const visit = el => {
    if (el.getBoundingClientRect) {
      const orig = el.getBoundingClientRect;
      el.getBoundingClientRect = () => { reads.read('rect'); return orig.call(el); };
    }
    for (const child of el.children) if (child && typeof child !== 'string') visit(child);
  };
  visit(hidden.root);
  page.fitTradeRows(hidden.root);
  if (savedRead === undefined) delete globalThis.document;
  else globalThis.document = savedRead;
  assert.equal(reads.reads, 0, 'hidden source rows do not measure their own geometry');
  assert.equal(px.classList.contains('small') || px.classList.contains('wrap-fee') || row.classList.contains('prices-below'), false);
  assert.equal(hidden.root.querySelector('.meta-sep').classList.contains('line-end'), true);

  const record = largeResults();
  assert.equal(record.trades.length, 14000);
  assert.equal(record.days.length, 288);
  const ix = M.indexResults(record);
  const per = M.periodOf('week', '2026-10-14', '2026-10-14', record.trackingStart);
  const inputs = { today: '2026-10-14', cols: null, cuts: [], nowMs: Date.parse(NOW) };
  const result = M.rollup(ix, per, M.DESK_IDS, M.moneyContext(ix, inputs, per, M.DESK_IDS));
  const quote = M.periodQuote(ix, inputs, per, M.DESK_IDS, result);
  assert.equal(quote.percent, M.periodPercent(ix, inputs, per, M.DESK_IDS, result));
  assert.equal(quote.base, quote.percent === null ? null : M.periodBase(ix, inputs, per, M.DESK_IDS));

  const oldCount = counter(), nextCount = counter();
  const oldDoc = htmlDocument(skeleton()), nextDoc = htmlDocument(skeleton());
  prepare(oldDoc, oldCount);
  prepare(nextDoc, nextCount);
  const beforeSwitches = switchesOf(legacy.page, legacy.model, oldDoc, oldCount, record);
  const afterSwitches = switchesOf(page, M, nextDoc, nextCount, record);
  const sum = list => list.reduce((total, step) => total + step.reads, 0);
  const beforeReads = sum(beforeSwitches), afterReads = sum(afterSwitches);
  const beforeRects = beforeSwitches.reduce((total, step) => total + step.rects, 0);
  const afterRects = afterSwitches.reduce((total, step) => total + step.rects, 0);
  const writes = list => list.reduce((total, step) => total + step.writes, 0);
  const transitions = list => list.reduce((total, step) => total + step.transitions, 0);
  console.log(`JOED-170 reads before=${beforeReads} after=${afterReads} rects before=${beforeRects} after=${afterRects} writes before=${writes(beforeSwitches)} after=${writes(afterSwitches)}`);
  console.log(`JOED-170 per switch before ${beforeSwitches.map(s => s.reads).join(',')} after ${afterSwitches.map(s => s.reads).join(',')}`);
  console.log(`JOED-170 normal transitions before=${beforeSwitches.map(s => s.transitions).join(',')} after=${afterSwitches.map(s => s.transitions).join(',')}`);
  console.log(`JOED-170 normal transition totals before=${transitions(beforeSwitches)} after=${transitions(afterSwitches)}`);
  assert.deepEqual(afterSwitches.map(s => s.sig), beforeSwitches.map(s => s.sig), 'legacy identity at every normal switch');
  assert.equal(beforeSwitches.length, 11);
  assert.equal(afterSwitches.length, 11);
  assert.ok(beforeReads > 0, 'the previous fit measured the fixture');
  assert.ok(afterReads > 0, 'a changed day still measures');
  assert.ok(afterReads * 2 <= beforeReads, `geometry reads ${afterReads} are not at most half of ${beforeReads}`);
  assert.ok(afterRects > 0, 'legacy fractional ink checks remain enabled');
  for (const [i, step] of afterSwitches.entries()) assert.equal(step.interleaved, false, `switch ${i} read after a style write`);
  // Only the column width changes for the narrow eleven-switch budget.
  const oldNarrowCount = counter(), nextNarrowCount = counter();
  oldNarrowCount.pxW = nextNarrowCount.pxW = 100;
  const oldNarrowDoc = htmlDocument(skeleton()), nextNarrowDoc = htmlDocument(skeleton());
  prepare(oldNarrowDoc, oldNarrowCount);
  prepare(nextNarrowDoc, nextNarrowCount);
  const oldNarrow = switchesOf(legacy.page, legacy.model, oldNarrowDoc, oldNarrowCount, record);
  const nextNarrow = switchesOf(page, M, nextNarrowDoc, nextNarrowCount, record);
  const narrowScanReads = nextNarrow.reduce((total, step) => total + step.scanReads, 0);
  assert.ok(sum(nextNarrow) <= sum(oldNarrow) + narrowScanReads, 'total narrow overhead is bounded by early-exit reads');
  assert.deepEqual(nextNarrow.map(s => s.sig), oldNarrow.map(s => s.sig), 'legacy identity at every narrow switch');
  for (const i of [5, 6, 8, 9, 10]) {
    assert.ok(nextNarrow[i].scanReads > 0, `overflowing switch ${i} scans a natural row on every fit`);
    assert.ok(nextNarrow[i].reads - oldNarrow[i].reads <= nextNarrow[i].scanReads,
      `overflowing switch ${i} overhead is bounded by its early-exit scan`);
    assert.ok(nextNarrow[i].transitions <= oldNarrow[i].transitions, 'scan adds no write/read transitions');
    assert.equal(nextNarrow[i].probeWrites, 0, 'overflow never restyles an attached trade copy');
  }
  console.log(`JOED-170 narrow reads before=${sum(oldNarrow)} after=${sum(nextNarrow)}`);
  console.log(`JOED-170 narrow per switch before=${oldNarrow.map(s => s.reads).join(',')} after=${nextNarrow.map(s => s.reads).join(',')}`);
  console.log(`JOED-170 narrow transitions before=${oldNarrow.map(s => s.transitions).join(',')} after=${nextNarrow.map(s => s.transitions).join(',')}`);
  console.log(`JOED-170 narrow transition totals before=${transitions(oldNarrow)} after=${transitions(nextNarrow)}`);
  console.log(`JOED-170 narrow early scans=${nextNarrow.map(s => s.scanReads).join(',')} overhead=${nextNarrow.map((s, i) => s.reads - oldNarrow[i].reads).join(',')}`);

  console.log(`JOED-170 ranges before=${beforeSwitches.map(s => s.rects).join(',')} after=${afterSwitches.map(s => s.rects).join(',')}`);
  console.log(`JOED-170 CSSOM reads after=${afterSwitches.map(s => s.styleReads).join(',')}`);
  console.log(`JOED-170 writes before=${beforeSwitches.map(s => s.writes).join(',')} after=${afterSwitches.map(s => s.writes).join(',')}`);
  // Same static columns, so both fits settle on the same classes. Re-render the
  // last switch's panel by comparing the documents each run left behind.
  assert.equal(fitClasses(nextDoc), fitClasses(oldDoc));
});

function mountRows(specs) {
  const dom = mount(specs[0]);
  dom.specs = [dom.spec];
  for (const spec of specs.slice(1)) {
    const next = mount(spec);
    dom.root.appendChild(next.root.querySelector('.trow'));
    dom.specs.push(next.spec);
  }
  return dom;
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
test('JOED-170: seeded differential against the frozen 9becb33 fitter, including repeated and changed fits', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  assert.equal(createHash('sha256').update(legacyFitTradeRows.toString()).digest('hex'), '40ffb6ec14a0db1100d77d54f5764888a65ba2e1295d75ed8b88b36fb62440fd', 'the legacy oracle is frozen');
  const seed = 0x170f1, random = seeded(seed), panels = 1024;
  let rows = 0, comparisons = 0;
  for (let i = 0; i < panels; i++) {
    const specs = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
      pxW: 80 + random() * 600, nameW: 70 + random() * 500,
      prices: Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ text: 10 + random() * 650, icon: random() > 0.5 })),
      fee: { text: 5 + random() * 160 }, units: Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({ w: 15 + random() * 170 })),
      fontSize: 9 + random() * 15, smallFont: 8 + random() * 6, spacing: random() * 2, smallAdjustment: random() * 1.5 - 0.75,
      fontFamily: random() > 0.5 ? 'DejaVu Sans' : 'Arial', fontWeight: random() > 0.5 ? 400 : 650,
    }));
    rows += specs.length;
    const old = mountRows(specs), next = mountRows(specs);
    for (const phase of ['first', 'repeat', 'repeat-again', 'width', 'font', 'repeat-font', 'masked-font', 'repeat-masked-font']) {
      if (phase === 'width') for (const dom of [old, next]) for (const spec of dom.specs) { spec.pxW = spec.pxW * 0.73 + 0.375; spec.nameW *= 0.81; }
      if (phase === 'font') for (const dom of [old, next]) for (const spec of dom.specs) {
        spec.fontSize += 1.125; spec.smallFont += 0.625; spec.advance = 1.13; spec.spacing += 0.375;
        spec.fontFamily = 'Replacement Face'; spec.fontWeight = 700;
      }
      if (phase === 'masked-font') for (const dom of [old, next]) for (const spec of dom.specs) spec.fontSize *= 0.73;
      globalThis.document = old.doc;
      legacyFitTradeRows(old.root);
      globalThis.document = next.doc;
      page.fitTradeRows(next.root);
      assert.equal(fitSig(next.root), fitSig(old.root), `seed=${seed} panel=${i} phase=${phase}`);
      assert.equal(next.root.querySelectorAll('.trow').length, specs.length, 'no measurement copies survive');
      comparisons++;
    }
  }
  assert.ok(rows >= 1000);
  console.log(`JOED-170 differential seed=0x${seed.toString(16)} panels=${panels} rows=${rows} comparisons=${comparisons}`);
});

test('JOED-170: overflow fallback is frozen with only early-exit scan overhead', async t => {
  const target = await builders('results.js', ['fitTradeRowsLegacy']);
  assert.equal(target.fitTradeRowsLegacy.toString().replace('fitTradeRowsLegacy', 'legacyFitTradeRows'), legacyFitTradeRows.toString(),
    'whole-pass fallback remains verbatim 9becb33 logic');
  const forced = await import(sourceModule('results.js', null, moduleUrl('results-model.js').href,
    source => source.replace('if (probe.some(needsFit))', 'if (true)')));
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  for (const first of [0, 1, 24, 48]) {
    const specs = Array.from({ length: 49 }, (_, rowIndex) => ({ rowIndex, pxW: rowIndex >= first ? 100 : 420,
      nameW: 300, prices: [{ text: 70 }, { text: 70 }, { text: 70 }], fee: { text: 60 }, units: units3 }));
    const run = fit => {
      const dom = mountRows(specs), count = counter();
      enableCopies(dom.doc, count);
      instrument(dom.root, count);
      dom.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; },
        getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
      globalThis.document = dom.doc;
      fit(dom.root);
      return { dom, count };
    };
    const old = run(legacyFitTradeRows), next = run(page.fitTradeRows), control = run(forced.fitTradeRows);
    assert.equal(fitSig(next.dom.root), fitSig(old.dom.root));
    assert.equal(fitSig(control.dom.root), fitSig(old.dom.root));
    assert.deepEqual([...next.count.scannedRows], Array.from({ length: first + 1 }, (_, i) => i), 'stop immediately at the first overflow');
    assert.equal(next.count.reads - old.count.reads, next.count.scanReads, 'overhead is exactly the natural scan');
    assert.equal(next.count.reads - control.count.reads, next.count.scanReads, 'removing only the scan removes exactly its reads');
    assert.equal(control.count.reads, old.count.reads, 'forced fallback reads exactly the frozen legacy geometry');
    assert.equal(next.count.transitions, old.count.transitions, 'scan adds no class write/read cycle');
    assert.equal(next.count.probeWrites, 0, 'attached natural copies receive no class/style writes');
    assert.equal(next.dom.doc.querySelectorAll('.trow').length, specs.length, 'no copies survive');
    console.log(`JOED-170 first-overflow=${first} legacy=${old.count.reads}/${old.count.transitions} new=${next.count.reads}/${next.count.transitions} scan=${next.count.scanReads}`);
  }
});

test('JOED-170: repeated content, width and font changes preserve frozen legacy identity', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle, dpr = globalThis.devicePixelRatio;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle;
    if (dpr === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = dpr; });
  const spec = { pxW: 230.125, nameW: 300.375, prices: [{ text: 200.49 }], fee: { text: 40.49 }, units: units3 };
  const old = mount(spec), dom = mount(spec);
  const count = counter();
  enableCopies(dom.doc, count);
  instrument(dom.root, count);
  dom.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; }, getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  for (const item of [old, dom]) {
    item.doc.documentElement = htmlDocument('<html data-theme="light"></html>').querySelector('html');
    item.doc.styleSheets = [{ disabled: false, cssRules: [{ cssText: '.px { font-size: 12.5px }' }] }];
  }
  const fit = label => {
    globalThis.document = old.doc;
    legacyFitTradeRows(old.root);
    globalThis.document = dom.doc;
    count.reset();
    page.fitTradeRows(dom.root);
    assert.equal(fitSig(dom.root), fitSig(old.root), label);
    assert.ok(count.scanReads > 0, `${label}: scan fresh natural trade geometry`);
    assert.equal(count.probeWrites, 0, 'attached scans are read-only');
  };
  fit('first');
  assert.match(fitSig(dom.root), /^s/);
  for (let i = 0; i < 4; i++) fit(`unchanged small repeat ${i}`);
  const changes = [
    ['fractional container width', item => { item.spec.pxW += 0.125; }],
    ['fractional name-column width', item => { item.spec.nameW += 0.125; }],
    ['font family', item => { item.spec.fontFamily = 'Second Face'; item.spec.advance = 1.05; }],
    ['font weight', item => { item.spec.fontWeight = 650; item.spec.advance = 1.1; }],
    ['font size', item => { item.spec.fontSize = 13.125; }],
    ['letter spacing', item => { item.spec.spacing = 0.4; }],
    ['small token', item => { item.spec.smallFont = 10.625; }],
    ['font loading', item => { item.doc.fonts.status = 'loading'; }],
    ['fonts loaded', item => { item.doc.fonts.status = 'loaded'; }],
    ['natural CSS rule while small', item => { item.doc.styleSheets[0].cssRules[0].cssText = '.px { font-size: 13px }'; item.spec.fontSize = 13; }],
    ['theme', item => { item.doc.documentElement.setAttribute('data-theme', 'dark'); }],
    ['zoom', () => { globalThis.devicePixelRatio = 2; }],
    ['text outside price and name', item => { item.root.querySelector('.net').textContent = 'changed net'; }],
    ['price content grows', item => { item.root.querySelector('.ln').children[0]._text = item.spec.prices[0].text = 350;
      item.root.querySelector('.ln').children[0].textContent = '350'; }],
    ['price content shrinks', item => { item.root.querySelector('.ln').children[0]._text = item.spec.prices[0].text = 70;
      item.root.querySelector('.ln').children[0].textContent = '70'; }],
  ];
  for (const [label, mutate] of changes) {
    for (const item of [old, dom]) mutate(item);
    fit(label);
    fit(`${label} repeat`);
  }
  // The integer scrollWidth of each token hides this fractional overflow.
  const fractional = fitBoth({ pxW: 222, nameW: 300, prices: [{ text: 200.49 }], fee: { text: 40.49 }, units: units3 }).sig;
  assert.equal(fractional[0], fractional[1]);
  assert.match(fractional[1], /^sw/);
  for (const item of [old, dom]) item.spec.pxW = 1000;
  fit('returning to natural sizing');
  assert.doesNotMatch(fitSig(dom.root), /^s/);
  fit('restored natural repeat');
});

test('JOED-170: legacy overflow fallback and batched summaries preserve open-sheet fits', async t => {
  const target = await builders('results.js', ['fitLayouts']);
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const specs = [
    { pxW: 230, nameW: 200, prices: [{ text: 200 }], fee: { text: 40 }, units: units3 },
    { pxW: 180, nameW: 200, prices: [{ text: 250 }], fee: { text: 30 }, units: units3 },
  ];
  const count = counter(), doc = htmlDocument(`
    <div class="cal-head"><span id="calSum" class="compact">full month</span></div>
    <div id="panel"><div class="dp-head"><span class="dp-sum"><span class="dp-trades">count</span>amount</span></div>
      <div class="dp-list">${specs.map(rowHtml).join('')}</div></div>
    <dialog id="daySheet"><div class="dlg-h">Title</div><div class="dlg-b" id="sheetBody">
      <div class="dp-sum"><span class="dp-trades">count</span>amount</div>
      ${specs.map(rowHtml).join('')}<button class="dp-reasons-more">more</button>
      <div class="dp-reasons-extra" hidden>all reasons</div></div></dialog>`);
  enableCopies(doc, count);
  for (const root of [doc.querySelector('#panel'), doc.querySelector('#sheetBody')]) {
    [...root.querySelectorAll('.trow')].forEach((row, i) => { row._spec = specs[i]; armReactive(row); });
  }
  const month = doc.querySelector('#calSum'), panel = doc.querySelector('#panel'), body = doc.querySelector('#sheetBody');
  armSummary(month.parentElement, { width: 100, full: 180, short: 80 }, count);
  armSummary(panel.querySelector('.dp-head'), { width: 100, full: 180, short: 80 }, count);
  armSummary(body.querySelector('.dp-sum'), { width: 100, full: 180, short: 80 }, count);
  body._bodyMeasure = { collapsed: 120, expanded: 170 };
  const head = doc.querySelector('.dlg-h');
  head.getBoundingClientRect = () => ({ height: 20 });
  doc.querySelector('#daySheet').getBoundingClientRect = () => ({ height: 190 });
  doc.createRange = () => ({ selectNodeContents(el) { this.el = el; }, getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  enableCopies(doc, count);
  instrument(doc, count);
  globalThis.document = doc;
  const sheet = doc.querySelector('#daySheet');
  sheet.open = true;
  for (let i = 0; i < 3; i++) {
    count.reset();
    target.fitLayouts([panel, body], month, sheet);
    assert.equal(count.interleaved, true, 'every legacy overflow pass interleaves live writes and reads');
    if (i === 0) {
      assert.ok(count.writes > 0, 'overflowing fit writes live classes');
      assert.equal(count.probeWrites, 0, 'natural trade scans never mutate attached copies');
    }
    count.reset();
    await Promise.resolve();
    assert.equal(count.interleaved, false, `open fit ${i} reads before any live class, visibility or height write`);
    assert.ok(count.reads > 0, 'sheet height reads are instrumented');
    if (i === 0) assert.ok(count.writes > 0, 'the deferred fit writes the sheet height');
    assert.equal(fitSig(panel), 's/111;swb/111');
    assert.equal(fitSig(body), fitSig(panel));
    assert.equal(month.classList.contains('compact'), true);
    assert.equal(panel.querySelector('.dp-trades').hidden, true);
    assert.equal(body.querySelector('.dp-trades').hidden, true);
    assert.equal(sheet.style.height, '190px');
    assert.equal(doc.querySelectorAll('.trow').length, 4, 'all probes removed');
    assert.equal(doc.querySelectorAll('.dp-reasons-extra').length, 1);
    assert.equal(doc.querySelector('.dp-reasons-extra').hidden, true);
  }
  // A wider summary must restore the full wording/count from its natural fit.
  month._summary.width = 300;
  panel.querySelector('.dp-head')._summary.width = 300;
  count.reset();
  target.fitLayouts([panel, body], month, sheet);
  assert.equal(count.interleaved, true, 'overflow still uses the frozen fitter when summaries widen');
  assert.equal(month.classList.contains('compact'), false);
  assert.equal(panel.querySelector('.dp-trades').hidden, false);
  count.reset();
  await Promise.resolve();
  assert.equal(count.interleaved, false);
});

test('JOED-170: height-dependent scrollbars and masked ancestor fonts match the frozen fitter', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const seed = 0x170f2, random = seeded(seed);
  let comparisons = 0, panels = 0;
  const compare = (specs, scroll, phases) => {
    const old = mountRows(specs), next = mountRows(specs);
    for (const dom of [old, next]) {
      dom.root.classList.add('dp-list');
      dom.root._scroll = { ...scroll };
      dom.root.appendChild(htmlDocument('<div class="scroll-header"></div>').querySelector('.scroll-header'));
      dom.root.appendChild(htmlDocument('<div class="scroll-tail"></div>').querySelector('.scroll-tail'));
      armScroll(dom.root);
      armTail(dom.root.querySelector('.scroll-tail'));
    }
    panels++;
    for (const [phase, mutate] of phases) {
      for (const dom of [old, next]) mutate?.(dom);
      globalThis.document = old.doc;
      legacyFitTradeRows(old.root);
      globalThis.document = next.doc;
      page.fitTradeRows(next.root);
      assert.equal(fitSig(next.root), fitSig(old.root), `seed=${seed} panel=${panels} phase=${phase}`);
      assert.equal(next.root.querySelectorAll('.trow').length, specs.length, 'no panel copies survive');
      comparisons++;
    }
    return next;
  };
  const repeated = Array.from({ length: 6 }, (_, i) => [`repeat-${i}`]);
  const nonTradeChanges = [
    ['tail grows', dom => { dom.root._scroll.tailHeight = 35; dom.root.querySelector('.scroll-tail').textContent = 'Longer tail'; }],
    ['tail growth repeat'],
    ['tail shrinks', dom => { dom.root._scroll.tailHeight = 0; dom.root.querySelector('.scroll-tail').textContent = ''; }],
    ['tail shrink repeat'],
    ['header grows', dom => { dom.root._scroll.headerHeight = 35; dom.root.querySelector('.scroll-header').textContent = 'Longer header'; }],
    ['header growth repeat'],
    ['header shrinks', dom => { dom.root._scroll.headerHeight = 0; dom.root.querySelector('.scroll-header').textContent = ''; }],
    ['header shrink repeat'],
  ];
  const boundary = compare([{ pxW: 256, nameW: 300, prices: [{ text: 200 }], fee: { text: 40 }, units: units3 }],
    { width: 606, viewport: 32, gutter: 16, naturalHeight: 40, smallHeight: 24, wrapHeight: 16, belowHeight: 20 }, repeated);
  assert.equal(fitSig(boundary.root), 's/011', 'natural rows need the scrollbar on every repeated fit');
  const masked = compare([{ pxW: 260, nameW: 300, prices: [{ text: 200 }], fee: { text: 40 }, units: units3, maskedFont: true }],
    { width: 610, viewport: 100, gutter: 16, naturalHeight: 40, smallHeight: 24, wrapHeight: 16, belowHeight: 20 }, [
      ['large ancestor', dom => {
        dom.root.classList.add('large-natural');
        dom.doc.styleSheets = [{ disabled: false, cssRules: [{ cssText: '.large-natural .px { font-size: 16px } .small { font-size: 11px }' }] }];
      }],
      ['large repeat'],
      ['masked ancestor removed', dom => {
        const px = dom.root.querySelector('.px');
        assert.equal(getComputedStyle(px).fontSize, '11px', 'the fitted price font masks the natural ancestor rule');
        dom.root.classList.remove('large-natural');
        assert.equal(getComputedStyle(px).fontSize, '11px', 'the currently fitted font stays unchanged');
      }],
      ['normal repeat'],
    ]);
  assert.equal(fitSig(masked.root), '/011', 'removing the ancestor restores the natural size despite unchanged small fonts/rule bytes');
  for (let i = 0; i < 256; i++) {
    const specs = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
      pxW: 160 + random() * 300, nameW: 100 + random() * 300,
      prices: Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ text: 30 + random() * 400, icon: random() > 0.5 })),
      fee: { text: 10 + random() * 80 }, units: units3,
      fontSize: 10 + random() * 7, smallFont: 9 + random() * 4,
    }));
    compare(specs, { width: 800, viewport: 20 + random() * specs.length * 70, gutter: 16,
      naturalHeight: 40, smallHeight: 24, wrapHeight: 16, belowHeight: 20 }, [
      ['first'], ['repeat'], ['repeat-again'],
      ['viewport', dom => { dom.root._scroll.viewport *= 0.5; }],
      ['font', dom => { for (const spec of dom.specs) spec.fontSize *= 0.75; }],
      ['repeat-font'],
      ...nonTradeChanges,
    ]);
  }
  for (let i = 0; i < 128; i++) {
    const specs = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({
      pxW: 150 + random() * 180, nameW: 100 + random() * 300,
      prices: Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ text: 40 + random() * 300, icon: random() > 0.5 })),
      fee: { text: 20 + random() * 170 }, units: units3,
      heights: [60 + random() * 40, 20 + random() * 40, 20 + random() * 60, 40 + random() * 60],
      gutterHeight: random() * 32,
    }));
    compare(specs, { width: 680, viewport: specs.length * (25 + random() * 60), gutter: 16, tailHeight: (i % 3) * 13 }, [
      ['responsive first'], ['responsive repeat'],
      ...nonTradeChanges,
      ['threshold', dom => { dom.root._scroll.viewport = dom.specs.reduce((sum, spec) => sum + spec.heights[2] + spec.gutterHeight, 0); }],
      ['threshold repeat'],
      ['always overflowing', dom => { dom.root._scroll.viewport = 1; }],
      ['never overflowing', dom => { dom.root._scroll.viewport = 1000; }],
    ]);
  }
  const seen = new Set();
  const setPrice = (dom, value) => {
    [...dom.root.querySelectorAll('.trow')].forEach((row, i) => {
      const price = row.querySelector('.ln').children[0];
      price._text = dom.specs[i].prices[0].text = value(dom.specs[i]);
      price.textContent = String(price._text);
    });
  };
  for (let i = 0; i < 128; i++) {
    const pxW = 180 + random() * 140;
    const specs = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({
      pxW, nameW: 300, prices: [{ text: pxW * (0.9 + random() * 0.3) }],
      fee: { text: 20 + random() * 130 }, units: units3,
      heights: [40 + random() * 40, 20 + random() * 40, 20 + random() * 60, 40 + random() * 60],
      gutterHeight: random() * 16, horizontalHeight: random() * 16,
    }));
    const observe = dom => {
      const state = scrollState(dom.root);
      seen.add(`${Number(state.vertical)}${Number(state.horizontal)}`);
    };
    const total = specs.reduce((sum, spec) => sum + spec.heights[0], 0);
    compare(specs, { width: pxW + 350, viewport: total + 8, gutter: 16, horizontalGutter: i % 4 ? 16 : 0 }, [
      ['two-axis first', observe], ['two-axis repeat', observe],
      ...nonTradeChanges,
      ['vertical threshold below', dom => { dom.root._scroll.viewport = total - 0.25; observe(dom); }],
      ['vertical threshold above', dom => { dom.root._scroll.viewport = total + 16.25; observe(dom); }],
      ['horizontal threshold below', dom => {
        setPrice(dom, spec => (spec.pxW - 16) / (spec.smallFont ?? 11) * 12.5 - 0.25);
        observe(dom);
      }],
      ['horizontal threshold above', dom => { setPrice(dom, spec => spec.prices[0].text + 0.5); observe(dom); }],
      ['both overflow', dom => {
        dom.root._scroll.viewport = 1;
        setPrice(dom, spec => spec.pxW * 2);
        observe(dom);
      }],
      ['neither overflows', dom => {
        dom.root._scroll.viewport = 1000;
        setPrice(dom, () => 30);
        observe(dom);
      }],
      ['settled repeat', observe],
    ]);
  }
  assert.deepEqual([...seen].sort(), ['00', '01', '10', '11'], 'differential exercises every scrollbar combination');
  console.log(`JOED-170 scrollbar differential seed=0x${seed.toString(16)} panels=${panels} comparisons=${comparisons}`);
});

const responsivePair = () => [
  { pxW: 230, nameW: 300, prices: [{ text: 70 }, { text: 70 }, { text: 70 }], fee: { text: 180 }, units: units3, heights: [80, 60, 40, 40] },
  { pxW: 230, nameW: 300, prices: [{ text: 200 }], fee: { text: 40 }, units: units3, heights: [60, 40, 60, 60], gutterHeight: 16 },
];
test('JOED-170 f7: tail growth and shrinkage between repeated fits preserve frozen legacy identity', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const old = mountRows(responsivePair()), next = mountRows(responsivePair());
  const count = counter();
  for (const dom of [old, next]) {
    dom.root.classList.add('dp-list');
    dom.root._scroll = { width: 580, viewport: 100, gutter: 16, horizontalGutter: 0, tailHeight: 0 };
    dom.root.appendChild(htmlDocument('<div class="scroll-tail"></div>').querySelector('.scroll-tail'));
    armScroll(dom.root);
    armTail(dom.root.querySelector('.scroll-tail'));
  }
  enableCopies(next.doc, count);
  instrument(next.root, count);
  next.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; },
    getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  for (const [tailHeight, expected, repeats] of [[0, 'sw/011;s/011', 1], [35, 'sw/011;sw/011', 3], [0, 'sw/011;s/011', 3]]) {
    for (const dom of [old, next]) {
      dom.root._scroll.tailHeight = tailHeight;
      dom.root.querySelector('.scroll-tail').textContent = `Tail: ${tailHeight}`;
    }
    for (let repeat = 0; repeat < repeats; repeat++) {
      globalThis.document = old.doc;
      legacyFitTradeRows(old.root);
      globalThis.document = next.doc;
      count.reset();
      page.fitTradeRows(next.root);
      assert.equal(fitSig(old.root), expected, 'named frozen expectation');
      assert.equal(fitSig(next.root), fitSig(old.root), `tail=${tailHeight} repeat=${repeat}`);
      assert.equal(count.probeWrites, 0, 'natural inputs are read without attached-copy writes');
      assert.equal(count.containerReads.length, 0, 'no container-key measurements');
      assert.ok(count.scanReads > 0, 'every repeated fit scans natural trade geometry');
      assert.equal(next.doc.querySelectorAll('.trow').length, 2, 'no copies survive');
    }
  }
});
test('JOED-170 f8: gutter-dependent note with identical natural samples preserves frozen legacy identity', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const old = mountRows(responsivePair()), next = mountRows(responsivePair());
  for (const dom of [old, next]) {
    dom.root.classList.add('dp-list');
    dom.root._scroll = { width: 580, viewport: 100, gutter: 16, horizontalGutter: 0, tailHeight: 35 };
    dom.root.appendChild(htmlDocument('<div class="scroll-tail">Unchanged note</div>').querySelector('.scroll-tail'));
    armScroll(dom.root);
    armTail(dom.root.querySelector('.scroll-tail'));
  }
  const count = counter();
  enableCopies(next.doc, count);
  instrument(next.root, count);
  next.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; },
    getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  for (const [phase, withoutGutter, expected] of [
    ['constant note', 35, 'sw/011;sw/011'],
    ['responsive note', 0, 'sw/011;s/011'],
    ['constant note restored', 35, 'sw/011;sw/011'],
  ]) {
    for (const dom of [old, next]) {
      dom.root._scroll.noteWithoutGutter = withoutGutter;
      // Inspect the natural sample on a separate panel, retaining the fitted
      // live classes across the repeat-fit change that exposed the stale plan.
      const natural = mountRows(responsivePair());
      natural.root.classList.add('dp-list');
      natural.root._scroll = { ...dom.root._scroll };
      armScroll(natural.root);
      const el = natural.root;
      assert.deepEqual([el.scrollHeight, el.clientHeight, el.clientWidth, el.offsetWidth,
        el.scrollWidth > el.clientWidth, el.scrollHeight > el.clientHeight], [191, 100, 564, 580, false, true],
      `${phase}: identical natural sample`);
    }
    for (let repeat = 0; repeat < 3; repeat++) {
      globalThis.document = old.doc;
      legacyFitTradeRows(old.root);
      globalThis.document = next.doc;
      count.reset();
      page.fitTradeRows(next.root);
      assert.equal(fitSig(old.root), expected, `${phase}: named frozen expectation`);
      assert.equal(fitSig(next.root), fitSig(old.root), `${phase} repeat=${repeat}`);
      assert.ok(count.scanReads > 0, 'every fit scans fresh natural geometry');
      assert.equal(count.probeWrites, 0, 'attached scans are read-only');
      assert.equal(next.doc.querySelectorAll('.trow').length, 2, 'no copies survive');
    }
  }
});

test('JOED-170 f8: ancestor column-gap changes preserve frozen legacy identity on repeated fits', t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const spec = { pxW: 230, nameW: 300, prices: [{ text: 200 }], fee: { text: 40 }, units: units3, ancestorGap: true };
  const old = mount(spec), next = mount(spec);
  const count = counter();
  enableCopies(next.doc, count);
  instrument(next.root, count);
  next.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; },
    getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  for (const dom of [old, next]) {
    dom.doc.styleSheets = [{ disabled: false, cssRules: [{ cssText: '.wide-gap .px { column-gap: 20px }' }] }];
  }
  for (const [wide, expected] of [[false, 's/011'], [true, 'sw/011'], [false, 's/011']]) {
    for (const dom of [old, next]) dom.root.classList.toggle('wide-gap', wide);
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal(getComputedStyle(next.root.querySelector('.px')).columnGap, wide ? '20px' : '10px');
      globalThis.document = old.doc;
      legacyFitTradeRows(old.root);
      globalThis.document = next.doc;
      count.reset();
      page.fitTradeRows(next.root);
      assert.equal(fitSig(old.root), expected, 'named frozen expectation');
      assert.equal(fitSig(next.root), fitSig(old.root), `wide-gap=${wide} repeat=${repeat}`);
      assert.ok(count.scanReads > 0, 'every fit scans fresh natural geometry');
      assert.equal(count.probeWrites, 0, 'attached scans are read-only');
      assert.equal(next.doc.querySelectorAll('.trow').length, 1, 'no copies survive');
    }
  }
});

const viewport100Pair = () => [
  { pxW: 230, nameW: 300, prices: [{ text: 70 }, { text: 70 }, { text: 70 }], fee: { text: 180 }, units: units3, heights: [80, 80, 40, 40], gutterHeight: 20 },
  { pxW: 230, nameW: 300, prices: [{ text: 200 }], fee: { text: 40 }, units: units3, heights: [80, 40, 80, 80], gutterHeight: 20 },
];
const reviewCases = [
  ['f3: responsive gutter heights retain the scrollbar', responsivePair(), { viewport: 90 }, 'sw/011;sw/011'],
  ['f3: viewport-100 mixed prefix loses the scrollbar', responsivePair(), { viewport: 100 }, 'sw/011;s/011'],
  ['f4: removing horizontal overflow restores viewport height', [235, 200].map((price, i) => ({ pxW: 230, nameW: 300,
    prices: [{ text: price }], fee: { text: i ? 40 : 60 }, units: units3, heights: [48, 48, 48, 48] })),
    { viewport: 108, horizontalGutter: 16 }, 'sw/011;s/011'],
  ...[0, 16].flatMap(horizontalGutter => [
    [`f5: native mixed prefix loses the scrollbar (horizontalGutter=${horizontalGutter})`, responsivePair(),
      { viewport: 90, horizontalGutter }, 'sw/011;s/011'],
    [`f5: viewport-100 responsive pair (horizontalGutter=${horizontalGutter})`, responsivePair(),
      { viewport: 100, horizontalGutter }, 'sw/011;s/011'],
    [`f5: viewport-100 uniform minima witness (horizontalGutter=${horizontalGutter})`, viewport100Pair(),
      { viewport: 100, horizontalGutter }, 'sw/011;s/011'],
  ]),
  ['f5: both scrollbars disappear during the below-row decision', [
    { pxW: 310, nameW: 300, prices: [{ text: 350 }], fee: { text: 128 }, units: units3,
      heights: [100, 60, 20, 60], gutterHeight: 24, horizontalHeight: 16 },
    { pxW: 310, nameW: 300, prices: [{ text: 320 }], fee: { text: 48 }, units: units3,
      heights: [40, 20, 100, 80], gutterHeight: 0, horizontalHeight: 8 },
  ], { width: 660, viewport: 70, horizontalGutter: 16 }, 'sw/011;sw/011'],
];
for (const [name, specs, scroll, expected] of reviewCases) test(`JOED-170 review reproducer ${name}`, t => {
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const old = mountRows(specs), next = mountRows(specs);
  const count = counter();
  for (const dom of [old, next]) {
    dom.root.classList.add('dp-list');
    dom.root._scroll = { width: 580, gutter: 16, ...scroll };
    armScroll(dom.root);
  }
  enableCopies(next.doc, count);
  instrument(next.root, count);
  next.doc.createRange = () => ({ selectNodeContents(el) { this.el = el; },
    getClientRects() { count.read('rects', this.el); return [this.el._box()]; } });
  for (let repeat = 0; repeat < 3; repeat++) {
    globalThis.document = old.doc;
    legacyFitTradeRows(old.root);
    globalThis.document = next.doc;
    count.reset();
    page.fitTradeRows(next.root);
    assert.equal(fitSig(old.root), expected, 'named frozen expectation');
    assert.equal(fitSig(next.root), fitSig(old.root), `legacy identity repeat ${repeat}`);
    assert.equal(count.probeWrites, 0, 'no attached-copy class/style writes');
    assert.ok(count.scanReads > 0, 'every repeated fit scans natural geometry');
    assert.equal(next.doc.querySelectorAll('.trow').length, specs.length, 'no copies survive');
  }
});

// Break only at ordinary spaces. NBSP inside a number/unit group makes the
// entire group move to the next line, matching the typography regression.
function armWrappingBody(body) {
  Object.defineProperty(body, 'scrollHeight', { configurable: true, get() {
    const text = body.querySelector('.dp-position-note').textContent;
    let lines = 1, used = 0;
    for (const word of text.split(' ')) {
      if (used && used + 1 + word.length > body._wrapColumns) { lines++; used = 0; }
      used += (used ? 1 : 0) + word.length;
    }
    return lines * 18 + (body.querySelector('.dp-reasons-more').hidden ? 80 : 0);
  } });
}

test('JOED-170: sheet height waits for unit joining and matches the frozen sheet fitter', async t => {
  const target = await builders('results.js', ['fitLayouts']);
  const oracle = await import(sourceModule('results.js', '9becb33', null, source => `${source}\nexport { fitDaySheet };`));
  const before = globalThis.document, css = globalThis.getComputedStyle;
  installCSSOM();
  t.after(() => { globalThis.document = before; if (css) globalThis.getComputedStyle = css; else delete globalThis.getComputedStyle; });
  const mountSheet = () => {
    const doc = htmlDocument(`<dialog id="daySheet"><div class="dlg-h">Title</div><div class="dlg-b">
      <p class="dp-position-note">AAAAAAAAAAAAAAAAAAAAAAA 1 trade B CCCCCCCCCCCCCCCCCCCCCC DDDDDDDDDDDDDDDDDDDDDDDDDDDDD EEEEEEEEEEEEEEEEEEEEEEEEEEEEE</p>
      <button class="dp-reasons-more">more</button><div class="dp-reasons-extra" hidden>reasons</div>
    </div></dialog>`);
    const body = doc.querySelector('.dlg-b'), sheet = doc.querySelector('#daySheet');
    body.querySelector('.dp-reasons-more').hidden = false;
    body.querySelector('.dp-reasons-extra').hidden = true;
    body._wrapColumns = 30;
    armWrappingBody(body);
    enableCopies(doc);
    sheet.open = true;
    sheet.getBoundingClientRect = () => ({ height: 0 });
    sheet.querySelector('.dlg-h').getBoundingClientRect = () => ({ height: 20 });
    return { doc, body, sheet };
  };
  const heights = [];
  for (const legacy of [true, false]) {
    const { doc, body, sheet } = mountSheet();
    globalThis.document = doc;
    assert.equal(body.scrollHeight, 72, 'four lines before joining');
    const note = body.querySelector('.dp-position-note');
    queueMicrotask(() => { note.textContent = joinUnits(note.textContent); });
    if (legacy) oracle.fitDaySheet(sheet);
    else target.fitLayouts([body], null, sheet);
    assert.equal(sheet.style.height, undefined, 'height is deferred until the typography observer has run');
    await Promise.resolve();
    assert.equal(body.scrollHeight, 90, 'five lines after joining');
    heights.push(sheet.style.height);
    assert.equal(sheet.querySelector('.dp-reasons-more').hidden, false);
    assert.equal(sheet.querySelector('.dp-reasons-extra').hidden, true);
    assert.equal(doc.querySelectorAll('.dlg-b').length, 1, 'height copies removed');
    sheet.style.height = 'sentinel';
    queueMicrotask(() => { sheet.open = false; });
    if (legacy) oracle.fitDaySheet(sheet);
    else target.fitLayouts([body], null, sheet);
    await Promise.resolve();
    assert.equal(sheet.style.height, 'sentinel', 'closing before the queued fit prevents a stale height write');
  }
  assert.deepEqual(heights, ['190px', '190px']);
});
