// Node-only DOM for the capture selector inventory. Parse the real HTML and
// rendered panels; unsupported selector syntax fails instead of matching all.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';

const baseline = process.env.JOED_PRESENTATION_BASELINE;
if (baseline && !['a941776', '204b83d', 'd83f7ff'].includes(baseline)) throw new Error('Unsupported presentation baseline');
const sourceAt = url => baseline ? execFileSync('git', ['show', `${baseline}:public/joe/${new URL(url).pathname.split('/public/joe/')[1]}`], { encoding: 'utf8' }) : fs.readFileSync(url, 'utf8');

const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context),
    load(url, context, next) {
      if (baseline && url.startsWith('file:') && /\/public\/joe\/[^/]+\.js(?:\?.*)?$/.test(url)) return { format: 'module', source: sourceAt(url), shortCircuit: true };
      return next(url, context);
    },
  });
} else {
  if (baseline) throw new Error('Baseline capture requires Node registerHooks');
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}

// Expose existing markup builders in a test-only module instance. Production
// sources and exports stay untouched; their imports retain the real modules.
export async function builders(file, names, instance = '') {
  const url = new URL(`../../public/joe/${file}`, import.meta.url);
  const source = sourceAt(url).replace(/from (['"])(\.[^'"]+)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(new URL(mapped(specifier, url.href), url).href)}`);
  return import(`data:text/javascript,${encodeURIComponent(`${source}\nexport { ${names.join(', ')} };\n//# sourceURL=${url.href}?preview-builders${instance}`)}`);
}

const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g,
  value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' })[value]);
const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function classList(element) {
  const read = () => new Set((element.getAttribute('class') ?? '').match(/[^\t\n\f\r ]+/g) ?? []);
  const write = tokens => {
    if (tokens.size || element.getAttribute('class') !== null) element.setAttribute('class', [...tokens].join(' '));
  };
  const validate = value => {
    const token = String(value);
    if (!token) throw new DOMException('Empty class token', 'SyntaxError');
    if (/[\t\n\f\r ]/.test(token)) throw new DOMException('Whitespace in class token', 'InvalidCharacterError');
    return token;
  };
  return {
    add(...values) { const tokens = values.map(validate), current = read(); tokens.forEach(t => current.add(t)); write(current); },
    remove(...values) { const tokens = values.map(validate), current = read(); tokens.forEach(t => current.delete(t)); write(current); },
    contains(value) { return read().has(validate(value)); },
    toggle(value, force) {
      const token = validate(value), current = read(), present = current.has(token);
      const next = force === undefined ? !present : Boolean(force);
      if (next !== present) { if (next) current.add(token); else current.delete(token); write(current); }
      return next;
    },
  };
}
const selectorCache = new Map();
function compileSelector(selector) {
  if (selector === '*') return () => true;
  const not = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(m => m[1]);
  let rest = selector.replace(/:not\([^)]+\)/g, '');
  const tag = rest.match(/^[\w-]+/)?.[0];
  if (tag) rest = rest.slice(tag.length);
  const parts = [...rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)];
  assertSelector(parts.map(m => m[0]).join('') === rest, selector);
  return node => (!tag || tag === node.tagName) && not.every(s => !node.matches(s)) && parts.every(([, prefix, name, attr, value]) =>
    prefix === '#' ? node.id === name : prefix === '.' ? (node.getAttribute('class') ?? '').split(/\s+/).includes(name)
      : value === undefined ? node.getAttribute(attr) !== null : node.getAttribute(attr) === value);
}
class Element {
  constructor(tagName = 'document', attributes = {}, parentElement = null) {
    const dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
    Object.assign(this, { tagName, attributes, dataset, parentElement, children: [], style: {}, clientWidth: 0, clientHeight: 0 });
    this.classList = classList(this);
  }
  get id() { return this.getAttribute('id'); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { this.toggleAttribute('hidden', value); }
  get title() { return this.getAttribute('title') ?? ''; }
  set title(value) { this.setAttribute('title', value); }
  get firstElementChild() { return this.children.find(n => n instanceof Element) ?? null; }
  set firstElementChild(value) { Object.defineProperty(this, 'firstElementChild', { value, configurable: true, writable: true }); }
  contains(node) { return Boolean(node && (node === this || this.children.some(n => n instanceof Element && n.contains(node)))); }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight }; }
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
  hasAttribute(key) { return this.getAttribute(key) !== null; }
  removeAttribute(key) { delete this.attributes[key]; }
  toggleAttribute(key, force = !this.hasAttribute(key)) { if (force) this.setAttribute(key, ''); else this.removeAttribute(key); return Boolean(force); }
  getElementById(id) { return this.querySelector(`#${id}`); }
  matches(selector) {
    if (!selectorCache.has(selector)) selectorCache.set(selector, compileSelector(selector));
    return selectorCache.get(selector)(this);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    if (selector.includes(',')) return [...new Set(selector.split(',').flatMap(s => this.querySelectorAll(s.trim())))];
    if (selector === ':scope > svg') return this.children.filter(n => n instanceof Element && n.tagName === 'svg');
    if (selector.includes(' > ')) {
      const [parent, child] = selector.split(' > ');
      return this.querySelectorAll(parent).flatMap(n => n.children.filter(c => c instanceof Element && c.matches(child)));
    }
    const parts = selector.trim().split(/\s+/);
    const simple = parts.length === 1;
    const simpleMatch = simple && /^#[\w-]+$/.test(selector) ? node => node.id === selector.slice(1)
      : simple && /^\.[\w-]+$/.test(selector) ? node => (node.getAttribute('class') ?? '').split(/\s+/).includes(selector.slice(1)) : null;
    const matches = node => {
      if (simpleMatch) return simpleMatch(node);
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
  insertBefore(node, before) {
    node.remove();
    node.parentElement = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node);
  }
}
function assertSelector(ok, selector) { if (!ok) throw new Error(`Unsupported test DOM selector: ${selector}`); }
export function htmlDocument(html) { const document = new Element(); document.innerHTML = html; document.activeElement = null; return document; }
