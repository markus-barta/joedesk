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
        if (!text || !visible(el)) continue;
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
        if (el.closest('svg') || !visible(el)) continue;
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
          if (child.nodeType === 3) { if (child.parentElement && visible(child.parentElement)) parts.push({ text: child.nodeValue, term: Boolean(child.parentElement.closest('.term, .learn, code, .mono, #tip')) }); }
          else if (child.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(child.tagName)) walk(child);
        }
      };
      walk(document.body);
      return parts;
    },
    gui27() {
      const out = { italics: [], borders: [], pills: [], uppercase: [], cards: [], boxes: [] };
      const primary = ['hero', 'dcard', 'rhero', 'tile', 'calcard', 'hcard'];
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
  };
})();
