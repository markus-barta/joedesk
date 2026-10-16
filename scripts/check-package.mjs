#!/usr/bin/env node
/**
 * Package layout + version sync checks (no runtime deps).
 */
import { readFile, readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const UI_MODULES = ["app.js", "host.js", "ui.js", "terms.js", "format.js", "health.js", "feed.js", "events.js",
  "desk.js", "history.js", "history-model.js", "history-worker.js", "chart.js", "results.js", "results-model.js", "theme.js",
  "settings.js", "settings-model.js", "fleet-write.js"];
const CONTRACT_MODULES = ["index.mjs", "read.mjs", "schema-validator.mjs", "semantics.mjs", "decimal.mjs", "gateway.mjs", "panel-state.mjs",
  "manifest.json", "common.schema.json", "reason.schema.json", "data.schema.json", "history.schema.json", "results.schema.json",
  "fleet-config.schema.json", "healthz.schema.json"];

const REQUIRED = [
  "package.json",
  "server.mjs",
  "validate.mjs",
  "fleet-config.mjs",
  "Dockerfile",
  "time.mjs",
  "market-calendar.json",
  "public/joe/index.html",
  "public/joe/app.css",
  "public/joe/joe-version.js",
  "public/joe/data.schema.json",
  "public/joe/fleet-config.schema.json",
  "public/joe/fleet-config-actions.schema.json",
  "public/joe/fleet-config.example.json",
  ...UI_MODULES.map(name => `public/joe/${name}`),
];

const STATIC_ROUTES = [
  "index.html",
  "app.css",
  ...UI_MODULES,
  "data.schema.json",
  "fleet-config.schema.json",
  "fleet-config-actions.schema.json",
  "fleet-config.example.json",
  "joe-version.js",
];

function fail(message) {
  console.error(`check-package: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
if (pkg.name !== "joedesk") fail(`package name must be joedesk, got ${pkg.name}`);

const versionSource = await readFile(join(repoRoot, "public/joe/joe-version.js"), "utf8");
const joeVersion = new Function("window", `${versionSource}; return window.JoeVersion;`)({});
if (!joeVersion?.APP_VERSION) fail("JoeVersion.APP_VERSION missing");
if (pkg.version !== joeVersion.APP_VERSION) {
  fail(`package.json version ${pkg.version} != JoeVersion.APP_VERSION ${joeVersion.APP_VERSION}`);
}

const indexHtml = await readFile(join(repoRoot, "public/joe/index.html"), "utf8");
const appVersionSpanRe = /<span[^>]*\bid\s*=\s*["']appVersion["'][^>]*>([^<]*)<\/span>/gi;
const appVersionMatches = [...indexHtml.matchAll(appVersionSpanRe)];
if (appVersionMatches.length === 0) {
  fail("index.html missing static #appVersion fallback span");
}
if (appVersionMatches.length > 1) {
  fail(`index.html has ${appVersionMatches.length} #appVersion spans, expected exactly 1`);
}
const htmlFallbackVersion = appVersionMatches[0][1].trim();
if (htmlFallbackVersion !== joeVersion.APP_VERSION || htmlFallbackVersion !== pkg.version) {
  fail(
    `index.html #appVersion fallback "${htmlFallbackVersion}" must match package.json (${pkg.version}) and JoeVersion.APP_VERSION (${joeVersion.APP_VERSION})`,
  );
}

const release = JSON.parse(await readFile(join(repoRoot, "release.json"), "utf8"));
if (release.version !== joeVersion.APP_VERSION || release.version_scheme !== "calendar") {
  fail("release metadata must match the calendar product version scheme and UI version");
}
if (!/^\d{2}\.\d{2}\.\d{2}(?:\.\d{2}\.\d{2})?$/.test(joeVersion.APP_VERSION)) {
  fail("JoeVersion.APP_VERSION must use calendar yy.mm.dd[.hh.mm]");
}
if (!Number.isSafeInteger(release.release_sequence) || release.release_sequence < 1) {
  fail("release metadata must have a positive integer release_sequence");
}
if (joeVersion.VERSION_HISTORY?.[0]?.version !== joeVersion.APP_VERSION) {
  fail("latest VERSION_HISTORY entry must match JoeVersion.APP_VERSION");
}
for (const rel of REQUIRED) {
  try {
    await access(join(repoRoot, rel), constants.R_OK);
  } catch {
    fail(`missing required file: ${rel}`);
  }
}

for (const rel of STATIC_ROUTES) {
  try {
    await access(join(repoRoot, "public/joe", rel), constants.R_OK);
  } catch {
    fail(`static route asset missing under public/joe/: ${rel}`);
  }
}

// Versioned asset URLs: one release closure, every module mapped to this version.
const server = await readFile(join(repoRoot, "server.mjs"), "utf8");
const serverModules = JSON.parse(server.match(/const UI_MODULES = (\[[^\]]+\]);/)[1]);
if (JSON.stringify([...serverModules].sort()) !== JSON.stringify([...UI_MODULES].sort())) fail("server UI_MODULES must list exactly the UI modules");
const shipped = (await readdir(join(repoRoot, "public/joe"))).filter(name => /\.(m?js|css|html)$/.test(name));
const unlisted = shipped.filter(name => !STATIC_ROUTES.includes(name));
if (unlisted.length) fail(`public/joe files without a route or check: ${unlisted.join(", ")}`);
const importMap = JSON.parse(indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? "null");
if (!importMap?.imports) fail("index.html needs an import map");
const versioned = [...UI_MODULES, "time.mjs", "market-calendar.json", ...CONTRACT_MODULES.map(name => `contracts/${name}`)];
for (const name of versioned) {
  if (importMap.imports[`/joe/${name}`] !== `/joe/${name}?v=${pkg.version}`) fail(`import map must pin /joe/${name} to version ${pkg.version}`);
}
if (Object.keys(importMap.imports).length !== versioned.length) fail("import map lists an unknown module");
for (const asset of ["app.css", "app.js"]) {
  if (!indexHtml.includes(`./${asset}?v=${pkg.version}`)) fail(`index.html must load ./${asset}?v=${pkg.version}`);
}
if (/serviceWorker/.test(shipped.map(name => name).join(" ")) || /navigator\.serviceWorker/.test(await readFile(join(repoRoot, "public/joe/app.js"), "utf8"))) {
  fail("no service worker may ship");
}
// No sample data ships: docs/examples stays out of public/.
const examples = await readdir(join(repoRoot, "docs/examples"));
const publicFiles = await readdir(join(repoRoot, "public"), { recursive: true });
const leaked = publicFiles.filter(name => examples.some(example => name.endsWith(example)) || /sample/i.test(name));
if (leaked.length) fail(`sample data under public/: ${leaked.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  name: pkg.name,
  version: pkg.version,
  joeVersion: joeVersion.APP_VERSION,
  staticAssets: STATIC_ROUTES.length,
  versionedModules: versioned.length,
}, null, 2));
