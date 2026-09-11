#!/usr/bin/env node
/**
 * Package layout + version sync checks (no runtime deps).
 */
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const REQUIRED = [
  "package.json",
  "server.mjs",
  "validate.mjs",
  "fleet-config.mjs",
  "Dockerfile",
  "public/joe/index.html",
  "public/joe/joe.js",
  "public/joe/joe.css",
  "public/joe/joe-version.js",
  "public/joe/data.schema.json",
  "public/joe/fleet-config.schema.json",
  "public/joe/fleet-config.example.json",
  "public/joe/vendor/chart-4.4.8.umd.js",
  "public/joe/vendor/chartjs-plugin-zoom-2.2.0.min.js",
  "public/joe/vendor/gridstack-13.2.0-all.js",
  "public/joe/vendor/gridstack-13.2.0.min.css",
  "public/joe/vendor/hammer-2.0.8.min.js",
];

const STATIC_ROUTES = [
  "index.html",
  "data.schema.json",
  "fleet-config.schema.json",
  "fleet-config.example.json",
  "joe.css",
  "joe.js",
  "joe-version.js",
  "vendor/chart-4.4.8.umd.js",
  "vendor/chartjs-plugin-zoom-2.2.0.min.js",
  "vendor/gridstack-13.2.0-all.js",
  "vendor/gridstack-13.2.0.min.css",
  "vendor/hammer-2.0.8.min.js",
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

const vendorLicenses = ["LICENSE.chartjs", "LICENSE.chartjs-plugin-zoom", "LICENSE.hammerjs"];
for (const name of vendorLicenses) {
  try {
    await access(join(repoRoot, "public/joe/vendor", name), constants.R_OK);
  } catch {
    fail(`vendor license missing: public/joe/vendor/${name}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  name: pkg.name,
  version: pkg.version,
  joeVersion: joeVersion.APP_VERSION,
  staticAssets: STATIC_ROUTES.length,
  vendorLicenses: vendorLicenses.length,
}, null, 2));
