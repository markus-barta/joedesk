import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8');

// A small, fail-closed CSS parser for this stylesheet. Braces/semicolons in
// strings, brackets and functions are not delimiters; nested rules retain all
// ancestors, so @media/@supports/@layer cannot hide a theme declaration.
function parseCSS(source) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let offset = 0;
  function block(ancestors = [], nested = false) {
    const declarations = [];
    let closed = !nested;
    while (offset < source.length) {
      let token = '', quote = '', depth = 0;
      for (; offset < source.length; offset++) {
        const c = source[offset];
        if (quote) {
          token += c;
          if (c === '\\') token += source[++offset] ?? '';
          else if (c === quote) quote = '';
        } else if (c === '"' || c === "'") { quote = c; token += c; }
        else if (c === '(' || c === '[') { depth++; token += c; }
        else if (c === ')' || c === ']') { depth--; token += c; }
        else if (!depth && '{};'.includes(c)) break;
        else token += c;
        assert.ok(depth >= 0, 'balanced CSS delimiters');
      }
      assert.ok(!quote && !depth, 'complete CSS token');
      token = token.trim();
      const delimiter = source[offset++];
      if (delimiter === '{') { assert.ok(token); block([...ancestors, token], true); }
      else {
        if (token) {
          const declaration = /^([\w-]+)\s*:\s*([\s\S]+)$/.exec(token);
          assert.ok(declaration && ancestors.length, `unsupported CSS statement: ${token}`);
          declarations.push({ property: declaration[1], value: declaration[2].trim() });
        }
        if (delimiter === '}') { assert.ok(nested, 'unexpected closing CSS brace'); closed = true; break; }
        if (!delimiter) { assert.ok(!nested, 'unclosed CSS rule'); break; }
      }
    }
    assert.ok(closed, 'unclosed CSS rule');
    if (declarations.length) rules.push({ selector: ancestors.at(-1), ancestors, declarations });
  }
  block();
  return rules;
}

// The two existing theme controls are components, not theme-state selectors.
// Any selector mentioning theme/scheme (a heuristic, not all future names)
// is conservatively guarded, as are the common .dark/.light spellings.
const themeState = prelude => /theme|color-scheme|[.#](?:dark|light)\b/i.test(prelude.replace(/\.theme-(?:btn|seg)\b/g, ''));
const references = value => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
const paint = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration-color)$/;
// Deliberately accept only known colour syntax. An invalid colour inserted
// into a border shorthand can invalidate the border and change its box.
const number = '[+-]?(?:\\d*\\.)?\\d+';
const triple = unit => Array(3).fill(`${number}${unit}`).join('\\s*,\\s*');
const alpha = `(?:\\s*,\\s*${number}%?)?\\s*\\)`;
const rgb = new RegExp(`^rgba?\\(\\s*(?:${triple('')}|${triple('%')})${alpha}$`, 'i');
const hsl = new RegExp(`^hsla?\\(\\s*${number}(?:deg|grad|rad|turn)?\\s*,\\s*${number}%\\s*,\\s*${number}%${alpha}$`, 'i');

function assertThemeGeometry(source, markup = html) {
  const rules = parseCSS(source);
  const declarations = rules.flatMap(r => r.declarations);
  const values = name => declarations.filter(d => d.property === name).map(d => d.value);
  function colour(value, seen = []) {
    if (/^#[\da-f]{3}(?:[\da-f]|[\da-f]{3}|[\da-f]{5})?$/i.test(value) || /^(?:transparent|currentColor)$/i.test(value)) return true;
    if (rgb.test(value) || hsl.test(value)) return true;
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    return Boolean(ref && !seen.includes(ref[1]) && values(ref[1]).length && values(ref[1]).every(v => colour(v, [...seen, ref[1]])));
  }
  function shadow(value) {
    // Explicit shadow grammar: lengths, inset, commas and validated colours.
    let colours = 0;
    const rest = value.replace(/rgba?\([^()]*\)|#[\da-f]+\b|var\(\s*--[\w-]+\s*\)/gi, match => {
      assert.ok(colour(match), `shadow contains a non-colour: ${match}`);
      colours++;
      return '';
    });
    return colours > 0 && /^(?:(?:inset|[+-]?(?:\d*\.)?\d+(?:px)?)[\s,]*)+$/.test(rest.trim());
  }
  const themed = rules.filter(r => r.ancestors.some(themeState));
  assert.ok(themed.length, 'theme rules must be found');
  const changed = new Map();
  for (const rule of themed) for (const { property, value } of rule.declarations) {
    if (property.startsWith('--')) {
      const isShadow = /shadow/.test(property);
      assert.ok(isShadow ? shadow(value) : colour(value), `${rule.selector}: ${property} must hold only a colour or shadow`);
      changed.set(property, isShadow);
      continue;
    }
    // Named exception 1: the existing UA palette hint, on the root only.
    if (property === 'color-scheme' && /^:root(?:\[data-theme="(?:dark|light)"\]|:not\(\[data-theme="light"\]\))?$/.test(rule.selector) && /^(dark|light)$/.test(value)) continue;
    // Named exception 2: exactly the sun/moon visibility swap in one button.
    const icon = /^:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\)) \.theme-btn \.(sun|moon)$/.exec(rule.selector);
    if (property === 'display' && icon && value === (icon[1] === 'sun' ? 'none' : 'block')) continue;
    assert.fail(`theme geometry: ${rule.selector} sets ${property}: ${value}`);
  }
  // A colour-looking value is insufficient if a token is consumed by layout.
  // Follow aliases too; shadows may only reach shadow properties.
  function consumers(name, isShadow, seen = []) {
    assert.ok(!seen.includes(name), `cyclic theme token ${name}`);
    for (const d of declarations.filter(d => references(d.value).includes(name))) {
      if (d.property.startsWith('--')) consumers(d.property, isShadow, [...seen, name]);
      else assert.ok(isShadow ? /^(box-shadow|text-shadow)$/.test(d.property) : paint.test(d.property),
        `theme token ${name} reaches geometry property ${d.property}`);
    }
  }
  for (const [name, isShadow] of changed) consumers(name, isShadow);
  // Both swapped elements must occupy the same 16×16 grid slot, without
  // individual sizing/spacing overrides. The enclosing button owns its box.
  const button = /<button\b[^>]*id="themeBtn"[^>]*>([\s\S]*?)<\/button>/.exec(markup);
  assert.ok(button);
  assert.match(button[0], /class="icon-btn theme-btn"/);
  assert.match(button[1], /^<svg class="i sun" aria-hidden="true"><use href="#i-sun"\/><\/svg><svg class="i moon" aria-hidden="true"><use href="#i-moon"\/><\/svg>$/);
  const baseIcon = rules.find(r => r.selector === '.i');
  for (const property of ['width', 'height']) assert.equal(baseIcon.declarations.find(d => d.property === property)?.value, '16px');
  const buttonBox = rules.find(r => r.selector === '.icon-btn');
  assert.ok(buttonBox.declarations.some(d => d.property === 'display' && d.value === 'grid'));
  assert.ok(buttonBox.declarations.some(d => d.property === 'place-items' && d.value === 'center'));
  for (const r of rules.filter(r => /\b(sun|moon)\b/.test(r.selector))) {
    assert.ok(r.declarations.every(d => d.property === 'display'), 'swapped icons cannot have separate geometry');
    if (!r.ancestors.some(themeState)) {
      assert.equal(r.selector, '.theme-btn .moon', 'only the default moon hiding rule may distinguish the icons');
      assert.ok(r.declarations.every(d => d.value === 'none'), 'light must show exactly one icon too');
    }
  }
}

test('theme geometry: app.css changes colours/shadows and the named palette/icon exceptions only', () => {
  assertThemeGeometry(css);
  assertThemeGeometry(`${css}\n.theme-sepia { --ink: rgba(10, 20, 30, .5); --shadow-pop: 0 1px 3px #123; }`);
});

test('theme geometry: rejects layout in explicit, system, future and nested theme rules', () => {
  for (const selector of [':root[data-theme="dark"]', ':root[data-theme="sepia"]', '[data-color-scheme="night"]', '.dark', '.theme-light', '.theme-sepia']) {
    for (const declaration of ['padding: 1px', '--gutter: 10px', '--font: Arial', '--gutter: var(--ink)', '--shadow-fake: 20px', '--line: rgba(1)']) {
      assert.throws(() => assertThemeGeometry(`${css}\n${selector} { ${declaration}; }`), /theme|colour/);
    }
  }
  for (const rule of ['@media (prefers-color-scheme: dark) { .top { gap: 1px; } }',
    '@supports (display: grid) { :root[data-theme="dark"] { .top { width: 1px; } } }',
    '@layer new-theme { :root { --gutter: 2px; } }']) {
    assert.throws(() => assertThemeGeometry(`${css}\n${rule}`));
  }
});

test('theme geometry: rejects colour-token layout aliases and changes to the icon exception', () => {
  for (const rule of ['.top { width: var(--ink); }', ':root { --alias: var(--ink); } .top { gap: var(--alias); }',
    '.theme-btn .sun { width: 18px; }', '.theme-btn .moon { display: block; }', 'svg[class~="sun"] { height: 20px; }',
    ':root[data-theme="dark"] .theme-btn .sun { display: block; }',
    ':root[data-theme="dark"] .other { display: none; }', ':root[data-theme="dark"] { color-scheme: normal; }']) {
    assert.throws(() => assertThemeGeometry(`${css}\n${rule}`));
  }
  assert.throws(() => assertThemeGeometry(css, html.replace('class="i moon"', 'class="i moon" width="20"')));
  assert.throws(() => assertThemeGeometry(css.replace('.i { width: 16px', '.i { width: 18px')));
});
