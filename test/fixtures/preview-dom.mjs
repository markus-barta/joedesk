// Node-only DOM for the capture selector inventory. Parse the real HTML and
// rendered panels; unsupported selector syntax fails instead of matching all.
import fs from 'node:fs';
import * as nodeModule from 'node:module';

const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}

// Expose existing markup builders in a test-only module instance. Production
// sources and exports stay untouched; their imports retain the real modules.
export async function builders(file, names) {
  const url = new URL(`../../public/joe/${file}`, import.meta.url);
  const source = fs.readFileSync(url, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(new URL(mapped(specifier, url.href), url).href)}`);
  return import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { ${names.join(', ')} };\n//# sourceURL=${url.href}?preview-builders`)}`);
}

const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g,
  value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' })[value]);
const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
class Element {
  constructor(tagName = 'document', attributes = {}, parentElement = null) {
    const dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
    Object.assign(this, { tagName, attributes, dataset, parentElement, children: [], style: {}, clientWidth: 0, clientHeight: 0 });
  }
  get id() { return this.getAttribute('id'); }
  get textContent() { return this.children.map(n => typeof n === 'string' ? decode(n) : n.textContent).join(''); }
  set textContent(text) { this.children = [text]; }
  get innerHTML() { return this.html ?? ''; }
  set innerHTML(html) {
    this.html = html;
    this.children = [];
    let parent = this;
    for (const [token] of html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<!doctype[^>]*>/gi, '')
      .matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g)) {
      if (!token.startsWith('<')) { parent.children.push(token); continue; }
      if (token.startsWith('</')) { parent = parent.parentElement ?? this; continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const attributes = {};
      for (const [, key, double, single, bare] of token.slice(tag.length + 1, token.endsWith('/>') ? -2 : -1)
        .matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[key] = decode(double ?? single ?? bare ?? '');
      const node = new Element(tag.toLowerCase(), attributes, parent);
      parent.children.push(node);
      if (!voids.has(node.tagName) && !token.endsWith('/>')) parent = node;
    }
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  matches(selector) {
    const not = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(m => m[1]);
    let rest = selector.replace(/:not\([^)]+\)/g, '');
    const tag = rest.match(/^[\w-]+/)?.[0];
    if (tag) rest = rest.slice(tag.length);
    const parts = [...rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)];
    assertSelector(parts.map(m => m[0]).join('') === rest, selector);
    return (!tag || tag === this.tagName) && not.every(s => !this.matches(s)) && parts.every(([, prefix, name, attr, value]) =>
      prefix === '#' ? this.id === name : prefix === '.' ? (this.getAttribute('class') ?? '').split(/\s+/).includes(name)
        : value === undefined ? this.getAttribute(attr) !== null : this.getAttribute(attr) === value);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    if (selector === ':scope > svg') return this.children.filter(n => n instanceof Element && n.tagName === 'svg');
    const parts = selector.trim().split(/\s+/);
    const matches = node => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const found = [];
    const walk = node => { for (const child of node.children) if (child instanceof Element) { if (matches(child)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  insertAdjacentHTML(position, html) {
    assertSelector(position === 'afterbegin', position);
    const fragment = new Element(); fragment.innerHTML = html;
    for (const child of fragment.children) if (child instanceof Element) child.parentElement = this;
    this.children.unshift(...fragment.children);
  }
  remove() { this.parentElement.children = this.parentElement.children.filter(n => n !== this); }
}
function assertSelector(ok, selector) { if (!ok) throw new Error(`Unsupported test DOM selector: ${selector}`); }
export function htmlDocument(html) { const document = new Element(); document.innerHTML = html; document.activeElement = null; return document; }
