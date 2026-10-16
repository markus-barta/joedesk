// Injected into the page: measurements for the craft rules and the AC scans.
// Returns plain data; the runner decides pass or fail.
(() => {
  const visible = el => {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (n.hidden) return false;
    }
    return true;
  };
  function parseColor(value) {
    const s = String(value).trim();
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
    m = s.match(/^color\(srgb\s+([^)]+)\)$/);
    if (m) { const [rgb, a] = m[1].split('/'); const p = rgb.trim().split(/\s+/).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: a === undefined ? 1 : Number(a) }; }
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  }
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  function background(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = parseColor(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) bg = over(layer, bg);
    return bg;
  }
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim();

  window.__audit = {
    visible, parseColor,
    contrast() {
      const failures = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'text') continue;
        const text = el.tagName.toLowerCase() === 'text' ? el.textContent.trim() : ownText(el);
        // Shared version separators are decorative (aria-hidden); the digits
        // and the canonical accessible name are covered by P6.
        if (!text || !visible(el) || el.closest('.coordinate .separator')) continue;
        const cs = getComputedStyle(el);
        const fg = parseColor(el.tagName.toLowerCase() === 'text' ? cs.fill : cs.color);
        if (!fg) continue;
        const host = el.closest('svg') ? el.closest('svg').parentElement : el;
        const bg = background(host);
        const value = ratio(over(fg, bg), bg);
        if (value < 4.5) failures.push({ text: text.slice(0, 40), ratio: Number(value.toFixed(2)), cls: el.className?.baseVal ?? el.className });
      }
      return failures;
    },
    clipping() {
      const failures = [];
      for (const el of document.querySelectorAll('body *')) {
        // The two clamped state lines (data-clamp) are measured by clamps().
        if (el.closest('svg') || !visible(el) || el.closest('[data-clamp]')) continue;
        // P6 Saved captions have an explicit one-line contract, checked by the
        // P6 browser suite (full title and the field control's description;
        // the Saved line itself never takes focus).
        if (el.matches('[data-saved]')) continue;
        const cs = getComputedStyle(el);
        if (cs.textOverflow === 'ellipsis' && el.textContent.trim()) failures.push({ el: el.className || el.tagName, why: 'ellipsis' });
        const clips = /(hidden|clip|auto|scroll)/.test(cs.overflowX) && !el.classList.contains('vh') && el.id !== 'tip';
        if (clips && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) failures.push({ el: `${el.tagName}.${el.className}`, why: `scroll ${el.scrollWidth} > ${el.clientWidth}`, text: el.textContent.trim().slice(0, 40) });
        // Visible overflow clips too: text wider than its own cell spills
        // under its neighbour. Only boxes with their own text are measured.
        else if (!clips && cs.display !== 'inline' && el.clientWidth > 0 && ownText(el) && !el.closest('.ctip, #tip, .vh')) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const box = el.getBoundingClientRect(), text = range.getBoundingClientRect();
          const inner = { left: box.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0) - 1, right: box.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0) + 1 };
          if (text.width > 0 && (text.left < inner.left || text.right > inner.right)) failures.push({ el: `${el.tagName}.${el.className}`, why: `text ${Math.round(text.left)}–${Math.round(text.right)} outside ${Math.round(inner.left)}–${Math.round(inner.right)}`, text: el.textContent.trim().slice(0, 40) });
        }
      }
      return failures;
    },
    // A clamped line shows only whole lines (none is cut through), ends in an
    // ellipsis when it is longer, and its full text is given elsewhere: the
    // title for one line, the explanation tip (data-say) for two.
    clamps() {
      return [...document.querySelectorAll('[data-clamp]')].filter(visible).map(el => {
        const lines = Number(el.dataset.clamp), cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight);
        const box = el.getBoundingClientRect(), shown = box.height / lh;
        const range = document.createRange();
        range.selectNodeContents(el);
        const cut = [...range.getClientRects()].filter(r => r.width > 0 && r.top < box.bottom - 0.5 && r.bottom > box.bottom + 0.5).length;
        const whole = Math.abs(shown - Math.round(shown)) < 0.02 && Math.round(shown) >= 1 && Math.round(shown) <= lines;
        const ellipsis = lines === 1 ? cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden'
          : cs.webkitLineClamp === String(lines) && cs.overflowY === 'hidden';
        const full = el.textContent.trim();
        const given = lines === 1 ? el.closest('[title]')?.title === full : Boolean(el.closest('[data-say]'));
        const truncated = lines === 1 ? el.scrollWidth > el.clientWidth + 0.5 : el.scrollHeight > el.clientHeight + 0.5;
        return { ok: !cut && whole && ellipsis && given, text: full.slice(0, 60), lines, shown: Number(shown.toFixed(3)), cut, ellipsis, given, truncated };
      });
    },
    horizontal() {
      return { scroll: document.documentElement.scrollWidth, inner: innerWidth, client: document.documentElement.clientWidth,
        gutter: parseFloat(getComputedStyle(document.querySelector('main.page')).paddingLeft),
        wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .map(e => `${e.tagName}.${e.className?.baseVal ?? e.className}#${e.id} ${Math.round(e.getBoundingClientRect().right)}`).slice(0, 8) };
    },
    targets() {
      const failures = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        const after = getComputedStyle(el, '::after');
        if (after.content && after.content !== 'none' && after.position === 'absolute') {
          const inset = k => parseFloat(after[k]) || 0;
          w = r.width - inset('left') - inset('right'); h = r.height - inset('top') - inset('bottom');
        }
        if (w < 43.5 || h < 43.5) failures.push({ el: `${el.tagName}.${el.className}`, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(w), h: Math.round(h) });
      }
      return failures;
    },
    text() {
      const parts = [];
      const walk = node => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { if (child.parentElement && visible(child.parentElement)) parts.push({ text: child.nodeValue, term: Boolean(child.parentElement.closest('.term, .learn, code, .mono, #tip, [data-value]')) }); }
          else if (child.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(child.tagName)) walk(child);
        }
      };
      walk(document.body);
      return parts;
    },
    gui27() {
      const out = { italics: [], borders: [], pills: [], uppercase: [], cards: [], boxes: [] };
      const primary = ['hero', 'dcard', 'rhero', 'tile', 'calcard', 'hcard', 'mode-panel'];
      for (const el of document.querySelectorAll('body *')) {
        if (!visible(el) || el.closest('svg')) continue;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (cs.fontStyle === 'italic' && ownText(el)) out.italics.push(el.className);
        const widths = ['Top', 'Right', 'Bottom', 'Left'].map(k => parseFloat(cs[`border${k}Width`]));
        if (widths.some(w => w >= 2) && new Set(widths).size > 1) out.borders.push(el.className);
        if (cs.textTransform === 'uppercase' && el.id !== 'modeLabel') out.uppercase.push(el.className);
        const interactive = el.matches('button, a, input, select, [role="button"]') || el.closest('button, a');
        const radius = parseFloat(cs.borderTopLeftRadius);
        const filled = (parseColor(cs.backgroundColor)?.a ?? 0) > 0 || /inset/.test(cs.boxShadow);
        if (!interactive && el.textContent.trim() && r.height <= 30 && radius >= r.height / 2 - 1 && filled && el.id !== 'modeLabel' && !el.closest('#modeLabel')) out.pills.push({ cls: el.className, text: el.textContent.trim().slice(0, 30) });
        if (el.classList.contains('card')) out.cards.push(primary.find(c => el.classList.contains(c)) ?? `OTHER:${el.className}`);
        else if (r.width * r.height > 40000 && (widths.every(w => w >= 1) || /inset 0px 0px 0px 1px/.test(cs.boxShadow)) && !el.matches('main, body, html, header, nav, .page')) out.boxes.push(el.className || el.tagName);
      }
      return out;
    },
    terms() {
      return [...document.querySelectorAll('.term')].filter(visible).map(el => {
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), style: cs.textDecorationStyle, thickness: cs.textDecorationThickness, offset: cs.textUnderlineOffset, alpha: parseColor(cs.textDecorationColor)?.a };
      });
    },
    charts() {
      return [...document.querySelectorAll('svg[data-ylo]')].filter(visible).map(svg => ({ id: svg.parentElement.id || svg.getAttribute('class'), zero: svg.hasAttribute('data-zero'), lo: Number(svg.dataset.ylo), hi: Number(svg.dataset.yhi), base: svg.dataset.base === undefined ? null : Number(svg.dataset.base), estimate: svg.querySelectorAll('[data-estimate]').length }));
    },
    bars(selector) {
      return [...document.querySelectorAll(selector)].filter(el => el.isConnected && el.getBoundingClientRect().width > 0).map(el => ({ v: Number(el.dataset.v), cur: el.dataset.cur ?? 'EUR', w: el.getBoundingClientRect().width, track: el.parentElement.getBoundingClientRect().width }));
    },
    rects(selectors) {
      const out = [];
      for (const sel of selectors) document.querySelectorAll(sel).forEach((el, i) => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        out.push({ key: `${sel}#${i}`, top: r.top + scrollY, left: r.left, height: r.height, width: r.width });
      });
      return out;
    },
    opaque(el) {
      const cs = getComputedStyle(el);
      return { bgAlpha: parseColor(cs.backgroundColor)?.a, opacity: Number(cs.opacity), visible: cs.visibility };
    },
    // One width of the width sweep: the page's right edge, the header's row,
    // the one nav, 44 px targets and centred icons in the compact header, and
    // (light given) every light label put through the header.
    sweep(compactMax, light) {
      const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const name = el => el.id || String(el.className?.baseVal ?? el.className).split(' ')[0] || el.tagName.toLowerCase();
      const inFixed = el => { for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true; return false; };
      const edge = document.body.clientWidth + 0.5;
      const past = [...document.querySelectorAll('body *')].filter(el => {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > edge && !el.closest('.vh') && visible(el) && !inFixed(el);
      }).map(el => `${name(el)} ${Math.round(el.getBoundingClientRect().right)} > ${Math.round(edge)}`);
      const top = document.querySelector('.top-in'), cs = getComputedStyle(top), t = box(top);
      const row = { left: t.left + parseFloat(cs.paddingLeft) - 0.5, right: t.right - parseFloat(cs.paddingRight) + 0.5, top: t.top - 0.5, bottom: t.bottom + 0.5 };
      const items = [...top.children].filter(visible);
      const headerFaults = () => {
        const rs = items.map(el => ({ id: name(el), ...box(el) }));
        return rs.filter(r => r.left < row.left || r.right > row.right || r.top < row.top || r.bottom > row.bottom).map(r => `${r.id} leaves the row`)
          .concat(rs.slice(1).filter((r, i) => r.left < rs[i].right - 0.5).map((r, i) => `${r.id} overlaps ${rs[i].id}`));
      };
      const compact = innerWidth <= compactMax;
      const nav = document.querySelector('.top .nav'), bar = document.querySelector('.bottom-nav');
      const shown = compact ? bar : nav, hidden = compact ? nav : bar;
      const buttons = [...shown.querySelectorAll('button')];
      const navOk = visible(shown) && !visible(hidden) && buttons.length === 4 && buttons.every(b => { const r = box(b); return visible(b) && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5; });
      const health = document.getElementById('hdrHealth'), theme = document.getElementById('themeBtn');
      const targets = compact ? [health, theme, ...bar.querySelectorAll('button')].filter(visible).map(b => ({ id: name(b), ...box(b) })).filter(b => b.width < 43.5 || b.height < 43.5)
        .map(b => `${b.id} ${Math.round(b.width)}×${Math.round(b.height)}`) : [];
      const icons = [];
      const centred = (el, axes, what) => {
        const icon = [...el.querySelectorAll(':scope > svg')].find(visible);
        if (!icon) { icons.push(`${what}: no icon`); return; }
        const a = box(el), i = box(icon);
        const dx = (i.left + i.right) / 2 - (a.left + a.right) / 2, dy = (i.top + i.bottom) / 2 - (a.top + a.bottom) / 2;
        if ((axes.includes('x') && Math.abs(dx) > 0.5) || (axes.includes('y') && Math.abs(dy) > 0.5)) icons.push(`${what} off by ${dx.toFixed(2)}, ${dy.toFixed(2)}`);
      };
      centred(theme, 'xy', 'theme');
      centred(health, 'y', 'light');
      centred(document.getElementById('modeLabel'), 'y', 'PAPER');
      buttons.forEach(b => centred(b, compact ? 'x' : 'y', `${compact ? 'bar' : 'nav'} ${b.dataset.go}`));
      // Text on text: any two visible text boxes of the same layer (the page,
      // or the header and bottom bar above it) that overlap.
      const texts = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest('svg, .vh, #tip, .ctip, .pop') && visible(n.parentElement) ? 1 : 2) });
        const boxes = [];
        for (let n; (n = walker.nextNode());) {
          const range = document.createRange();
          range.selectNodeContents(n);
          // The page, or the fixed chrome above it (header, bottom bar, Settings' edit bar).
          const layer = Boolean(n.parentElement.closest('header.top, .bottom-nav, .editbar'));
          for (const q of range.getClientRects()) if (q.width > 0.5 && q.height > 0.5) boxes.push({ text: n.nodeValue.trim().slice(0, 30), layer, q });
        }
        const hits = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          if (a.layer !== c.layer) continue;
          if (Math.min(a.q.right, c.q.right) - Math.max(a.q.left, c.q.left) > 1 && Math.min(a.q.bottom, c.q.bottom) - Math.max(a.q.top, c.q.top) > 2) hits.push(`${a.text} × ${c.text}`);
        }
        return hits;
      };
      const out = { scroll: document.documentElement.scrollWidth, inner: innerWidth, past, header: headerFaults(), nav: navOk, targets, icons, overlaps: texts(), labels: [], cards: [] };
      if (!light) return out;
      // Each desk card's header with the longest state and heartbeat texts:
      // no overlap, inside the card, at most two heartbeat lines, one height.
      for (const [state, ago] of light.cards) {
        const heads = [...document.querySelectorAll('.dcard header')];
        const keep = heads.map(h => [h.querySelector('.state > span').textContent, h.querySelector('.hb .age')?.textContent]);
        const before = heads.map(h => box(h).height);
        heads.forEach(h => { h.querySelector('.state > span').textContent = state; const a = h.querySelector('.hb .age'); if (a) a.textContent = ago; });
        heads.forEach((h, i) => {
          const card = box(h.closest('.dcard')), hb = h.querySelector('.hb'), lines = Math.round(box(hb).height / parseFloat(getComputedStyle(hb).lineHeight));
          const range = document.createRange();
          range.selectNodeContents(h.querySelector('.state'));
          const s = range.getBoundingClientRect(), b = box(hb), faults = [];
          if (Math.min(s.right, b.right) - Math.max(s.left, b.left) > 0.5 && Math.min(s.bottom, b.bottom) - Math.max(s.top, b.top) > 0.5) faults.push('state × heartbeat');
          if (s.right > card.right - 17.5 || b.right > card.right - 17.5) faults.push('leaves the card');
          if (lines > 2) faults.push(`${lines} heartbeat lines`);
          if (getComputedStyle(hb).gridColumnStart === '2') {
            const t = document.createRange();
            t.selectNodeContents(hb);
            if (Math.abs(t.getBoundingClientRect().left - box(h.querySelector('.state')).left) > 0.5) faults.push('heartbeat not under the state');
          }
          if (Math.abs(box(h).height - before[i]) > 0.5) faults.push(`height ${before[i]} → ${box(h).height}`);
          if (faults.length) out.cards.push({ card: h.closest('.dcard').id, texts: `${state} · ${ago}`, faults });
        });
        heads.forEach((h, i) => { h.querySelector('.state > span').textContent = keep[i][0]; const a = h.querySelector('.hb .age'); if (a) a.textContent = keep[i][1]; });
      }
      const b = health.querySelector('b'), long = health.querySelector('.lbl-long'), lbl = health.querySelector('.lbl') ?? b;
      const keep = [b.textContent, long.textContent];
      const main = document.getElementById('main'), header = document.querySelector('header.top');
      const still = () => [header, ...items.filter(el => el !== health), main].map(el => ({ id: name(el), ...box(el) }));
      const base = still();
      for (const label of light.labels) for (const word of light.brokers) {
        b.textContent = label; long.textContent = `· ${word}`;
        const faults = headerFaults();
        still().forEach((r, i) => { if (['left', 'top', 'width', 'height'].some(k => Math.abs(r[k] - base[i][k]) > 0.5)) faults.push(`${r.id} moved`); });
        const h = box(health), hs = getComputedStyle(health);
        const lines = Math.round(lbl.getBoundingClientRect().height / parseFloat(getComputedStyle(lbl).lineHeight));
        for (const part of [b, long].filter(visible)) {
          const range = document.createRange();
          range.selectNodeContents(part);
          const r = range.getBoundingClientRect();
          if (r.left < h.left + parseFloat(hs.paddingLeft) - 1 || r.right > h.right - parseFloat(hs.paddingRight) + 1 || r.top < h.top - 0.5 || r.bottom > h.bottom + 0.5) faults.push(`${part === b ? 'label' : 'broker word'} leaves the button`);
        }
        if (lines > 2) faults.push(`${lines} lines`);
        if (faults.length) out.labels.push({ light: `${label} · ${word}`, faults });
      }
      b.textContent = keep[0]; long.textContent = keep[1];
      return out;
    },
  };
})();
