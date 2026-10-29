#!/usr/bin/env node
// Static checks on the shipped board UI (public/joe): the craft rules that can
// be read from source, the read-only transport with its one paper write, and
// the term dictionary. The browser gates (scripts/browser-p3/p4/p5.mjs) check
// the rendered pages; P5 also proves the write at the network layer.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../public/joe/", import.meta.url));
const names = (await readdir(root)).filter(name => /\.(js|css|html)$/.test(name) && name !== "joe-version.js");
const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(root, name), "utf8")])));
const modules = Object.entries(files).filter(([name]) => name.endsWith(".js"));
const failures = [];
const required = (ok, message) => { if (!ok) failures.push(message); };

const GLYPHS = /[▲▼►◄✓✔✕✖★☆⚠ⓘ◷⏸⛔→←↑↓↗↘•›‹»«÷]/;
for (const [name, text] of Object.entries(files)) required(!GLYPHS.test(text), `${name}: text glyph used as an icon (${text.match(GLYPHS)?.[0]})`);

const css = files["app.css"];
required(!/font-style:\s*italic/.test(css), "app.css: no italics");
required(!/border-(left|right|top|bottom)(-width)?:\s*([2-9]|\d{2,})px/.test(css), "app.css: no one-sided border of 2 px or more");
required(!/text-transform:\s*uppercase/.test(css), "app.css: no uppercase eyebrows");
required(/\.ctip[^{]*\{[^}]*background:\s*var\(--tip-bg\)/.test(css) && /\.tip \{[^}]*background:\s*var\(--tip-bg\)/.test(css) && /\.pop \{[^}]*background:\s*var\(--surface\)/.test(css), "app.css: tip, chart tip and details use opaque surfaces");
required(/scrollbar-gutter:\s*stable/.test(css), "app.css: scrollbar gutter is stable");
required(/prefers-reduced-motion:\s*no-preference/.test(css), "app.css: motion only without reduced motion");

// The icon is fixed-width; its sibling must fill the remaining note width
// independently of the disclosure's intrinsic size or presence. Paragraphs
// stretch across that column, with the separate positions note 8 px below.
const noteCopy = css.match(/\.dp-note-copy\s*\{([^}]+)\}/)?.[1] ?? '';
required(/flex:\s*1\s+1\s+0\s*;/.test(noteCopy) && /min-width:\s*0\s*;/.test(noteCopy), "app.css: note column width is independent of the disclosure");
required(/display:\s*flex\s*;/.test(noteCopy) && /flex-direction:\s*column\s*;/.test(noteCopy) && /gap:\s*8px\s*;/.test(noteCopy), "app.css: note paragraphs fill the column with an 8 px gap");
required(/\.dp-note-lead,\s*\.dp-reason,\s*\.dp-desk-note,\s*\.dp-reasons-extra\s*\{\s*display:\s*block\s*;/.test(css), "app.css: every reason block fills the text column");
const reasonsMore = css.match(/\.dp-reasons-more\s*\{([^}]+)\}/)?.[1] ?? '';
required(/display:\s*block\s*;/.test(reasonsMore) && /width:\s*100%\s*;/.test(reasonsMore) && /min-height:\s*44px\s*;/.test(reasonsMore) && /text-align:\s*left\s*;/.test(reasonsMore) && /padding:\s*0\s*;/.test(reasonsMore), "app.css: reason disclosure has its own full-width row aligned with the text");

// Fleet policy has one writer. Display settings use a separate bounded route;
// only Settings imports either save function. Neither path can set live mode.
const WRITER = 'fleet-write.js';
const DISPLAY_WRITER = 'board-settings-write.js';
for (const [name, text] of modules) {
  if (!['settings.js', 'board-settings.js', DISPLAY_WRITER].includes(name)) {
    // Match the capability module, regardless of imported binding, alias,
    // namespace, dynamic import or re-export syntax. The facade is checked below.
    required(!/board-settings-write\.js|\b(?:createBoardSettings|saveBoardSettings)\b/.test(text), `${name}: only Settings may import the board display writer`);
  }
  if (name === WRITER) continue;
  if (name !== DISPLAY_WRITER) required(!/method:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(text) && !/\/inbox|fleet-config\/propagate/.test(text), `${name}: the board only reads`);
  if (name !== 'settings.js') required(!/from\s+['"]\.\/fleet-write\.js['"]|import\(\s*['"]\.\/fleet-write/.test(text), `${name}: only Settings may import the fleet settings' writer`);
}
{
  const facade = (files['board-settings.js'] ?? '').replace(/\/\/[^\n]*/g, '');
  const readExports = [...facade.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;/g)];
  const expected = {
    './board-settings-validation.js': ['validateBoardSettings'],
    './board-settings-write.js': ['accountStart', 'boardSettingsState', 'refreshBoardSettings', 'onBoardSettingsChange'],
  };
  required(readExports.length === 2 && readExports.every(([, names, path]) =>
    expected[path] && JSON.stringify(names.split(',').map(name => name.trim()).sort()) === JSON.stringify([...expected[path]].sort())) &&
    facade.replace(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;/g, '').trim() === '',
    'board-settings.js: only Settings may access saves; the page facade exports only the named read APIs and validation');
  const display = files[DISPLAY_WRITER] ?? '';
  required(/fetcher\('\.\/board-settings\.json',/.test(display) && /request\('POST', value\)/.test(display), 'board-settings-write.js: display writes stay on the board settings route');
  required(/validateBoardSettings\(value\)/.test(display) && /credentials: 'same-origin'/.test(display), 'board-settings-write.js: validated same-origin display writes');
  required(!/\/inbox|fleet-config\/propagate/.test(display), 'board-settings-write.js: display settings never write feeds or fleet policy');
}
{
  const writer = files[WRITER] ?? '';
  required((writer.match(/fetch\(/g) ?? []).length === 1 && (writer.match(/method:\s*['"`]POST['"`]/g) ?? []).length === 1, `${WRITER}: exactly one request, a POST`);
  required(/const ROUTE = '\.\/fleet-config\/propagate';/.test(writer) && /fetch\(ROUTE,/.test(writer), `${WRITER}: the request goes only to the propagate route`);
  required(/config\.mode !== 'paper'/.test(writer) && /config\.rev !== baseRev/.test(writer) && /throw new Error/.test(writer), `${WRITER}: a non-paper draft, or one not based on the version it names, is refused before any request`);
  required(!/\/inbox/.test(writer), `${WRITER}: never the inbox`);
}
for (const [name, text] of modules) {
  required(!/\bmode\s*[:=]\s*['"`](live|LIVE)['"`]/.test(text) && !/\.mode\s*=\s*(?!['"`]paper['"`])['"`]/.test(text), `${name}: no code path sets a live mode`);
  required(!/serviceWorker/.test(text), `${name}: no service worker`);
  for (const [, key] of text.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]+)\)/g)) {
    required(/THEME_KEY|OBSERVED_EVENTS_KEY|PREVIEW_KEY|joe-board-theme-v1/.test(key), `${name}: only theme, observed events and the fleet settings draft use browser storage (${key})`);
  }
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const [, quote, body] of code.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    required(!/\b(TODO|FIXME|HOSTD-\d+|JOED-\d+|NIX-\d+|OPS-\d+)\b/.test(body) || name === "terms.js" && /OPS-266/.test(body), `${name}: implementer string in copy (${quote}${body.slice(0, 40)})`);
  }
}
required(!/GridStack|gridstack|layout-v1|phone-order/.test(Object.values(files).join("\n")), "no layout manager or layout storage");
required(!/\b(TODO|FIXME|HOSTD-\d+|JOED-\d+)\b/.test(files["index.html"].replace(/<!--[\s\S]*?-->/g, "")), "index.html: implementer string");

const model = files['settings-model.js'] ?? '';
required(/PREVIEW_KEY = 'joe-fleet-config-preview-v1'/.test(model), "settings-model.js: the draft keeps today's browser key");
required(/KEEP_FLOOR = Object\.freeze\(\['SXR8', 'TSLA'\]\)/.test(model) && /candidate\.mode = 'paper'/.test(model), "settings-model.js: the kept-holdings floor is SXR8 and TSLA, and a candidate is always paper");

const { TERMS } = await import(pathToFileURL(join(root, "terms.js")).href);
const used = new Set();
for (const [, text] of [...modules, ["index.html", files["index.html"]]]) {
  for (const [, key] of text.matchAll(/(?:term|learnBtn)\('([a-z0-9]+)'/g)) used.add(key);
  for (const [, key] of text.matchAll(/data-term="([a-z0-9]+)"/g)) used.add(key);
}
for (const key of used) required(TERMS[key], `term "${key}" has no explanation`);

const { isCanonicalJoeHost } = await import(pathToFileURL(join(root, "host.js")).href);
required(isCanonicalJoeHost("cs0.barta.cm") && isCanonicalJoeHost("hsb1.lan") && !isCanonicalJoeHost("example.com"), "host gate: the production host is canonical");

const kept = files["desk.js"].slice(files["desk.js"].indexOf("function keptHtml"), files["desk.js"].indexOf("const chartKeys"));
const row = kept.slice(kept.indexOf("data-keep"));
required(!/<button|<a |term\(|title=|href=|tabindex|role=/.test(row), "kept rows stay inert");

if (failures.length) { console.error(failures.map(f => `check-joe-ui: ${f}`).join("\n")); process.exit(1); }
console.log(JSON.stringify({ ok: true, files: names.length, terms: used.size }, null, 2));
