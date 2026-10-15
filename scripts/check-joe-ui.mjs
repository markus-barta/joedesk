#!/usr/bin/env node
// Static checks on the shipped board UI (public/joe): the craft rules that can
// be read from source, the read-only transport and the term dictionary. The
// browser gate (scripts/browser-p3.mjs) checks the rendered pages.
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

for (const [name, text] of modules) {
  required(!/method:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(text) && !/\/inbox|propagate/.test(text), `${name}: the board only reads`);
  required(!/serviceWorker/.test(text), `${name}: no service worker`);
  for (const [, key] of text.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]+)\)/g)) {
    required(/THEME_KEY|OBSERVED_EVENTS_KEY|joe-board-theme-v1/.test(key), `${name}: only theme and observed events use browser storage (${key})`);
  }
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const [, quote, body] of code.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    required(!/\b(TODO|FIXME|HOSTD-\d+|JOED-\d+|NIX-\d+|OPS-\d+)\b/.test(body) || name === "terms.js" && /OPS-266/.test(body), `${name}: implementer string in copy (${quote}${body.slice(0, 40)})`);
  }
}
required(!/GridStack|gridstack|layout-v1|phone-order/.test(Object.values(files).join("\n")), "no layout manager or layout storage");
required(!/\b(TODO|FIXME|HOSTD-\d+|JOED-\d+)\b/.test(files["index.html"].replace(/<!--[\s\S]*?-->/g, "")), "index.html: implementer string");

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
