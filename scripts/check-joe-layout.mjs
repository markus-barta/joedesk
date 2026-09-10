#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const versionSource = await readFile(resolve(repoRoot, "public/joe/joe-version.js"), "utf8");

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const layoutContext = extractJoeBlock("  var DEFAULT_LAYOUT = [", "\n  var stateCopy = ");
const layoutHelpers = `${layoutContext}
  var LAYOUTS_KEY = "joe-board-named-layouts-v1";
  var DEFAULT_LAYOUT_ID = "default";
  var MAX_LAYOUTS = 24;
  var SUPPORTED_COLUMNS = [3, 6, 12];
  var DEFAULT_GRID_SETTINGS = { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 };
${extractJoeBlock("  function layoutCoordinate", "\n\n  function setLayoutStatus")}
${extractJoeBlock("  function defaultLayoutEntry", "\n\n  function bindLayoutControls")}`;

const api = new Function(`${layoutHelpers}
  return {
    sanitizeLayoutItems,
    sanitizeGridSettings,
    defaultLayoutEntry,
    defaultLayoutsCatalog,
    normalizeLayoutEntry,
    canonicalLayoutsCatalog,
    writeLayoutsCatalog: function(catalog) {
      if (!catalog || catalog.schema !== "inspr.joe.layouts.v1" || !Array.isArray(catalog.layouts)) return false;
      if (catalog.layouts.length > MAX_LAYOUTS) return false;
      return canonicalLayoutsCatalog(catalog.layouts).layouts.length;
    }
  };
`)();

const version = new Function("window", `${versionSource}; return window.JoeVersion;`)({});
if (!version?.APP_VERSION || !Array.isArray(version.VERSION_HISTORY) || version.VERSION_HISTORY.length < 4) {
  throw new Error("JoeVersion invalid");
}

const sample = [
  { id: "hero", x: 0, y: 0, w: 12, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 4, h: 4 },
  { id: "desk-joe", x: 4, y: 3, w: 4, h: 4 },
  { id: "desk-joel", x: 8, y: 3, w: 4, h: 4 },
  { id: "attribution", x: 0, y: 7, w: 4, h: 3 },
  { id: "history", x: 4, y: 7, w: 8, h: 5 },
  { id: "positions", x: 0, y: 12, w: 12, h: 5 },
];

function layoutTilesOverlap(items) {
  for (let left = 0; left < items.length; left += 1) {
    const a = items[left];
    for (let right = left + 1; right < items.length; right += 1) {
      const b = items[right];
      const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
      const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlapX && overlapY) return true;
    }
  }
  return false;
}

if (!api.sanitizeLayoutItems(sample, 12)) throw new Error("valid layout rejected");
if (api.sanitizeLayoutItems(sample.slice(0, 6), 12)) throw new Error("incomplete layout accepted");
if (api.sanitizeLayoutItems(sample.map((item) => item.id === "hero" ? { ...item, w: 0 } : item), 12)) throw new Error("invalid width accepted");
if (api.sanitizeLayoutItems(sample.concat({ id: "hero", x: 0, y: 0, w: 12, h: 3 }), 12)) throw new Error("duplicate id accepted");
if (api.sanitizeLayoutItems(sample.map((item) => item.id === "hero" ? { ...item, x: 1.5 } : item), 12)) throw new Error("fractional coordinate accepted");
if (api.sanitizeLayoutItems(sample.map((item) => item.id === "hero" ? { ...item, x: 11, w: 2 } : item), 12)) throw new Error("overflow width accepted");

const sixCol = [
  { id: "hero", x: 0, y: 0, w: 6, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 2, h: 4 },
  { id: "desk-joe", x: 2, y: 3, w: 2, h: 4 },
  { id: "desk-joel", x: 4, y: 3, w: 2, h: 4 },
  { id: "attribution", x: 0, y: 7, w: 2, h: 3 },
  { id: "history", x: 2, y: 7, w: 4, h: 5 },
  { id: "positions", x: 0, y: 12, w: 6, h: 5 },
];
if (!api.sanitizeLayoutItems(sixCol, 6)) throw new Error("valid six-column layout rejected");

const defaultEntry = api.defaultLayoutEntry();
if (layoutTilesOverlap(defaultEntry.items)) throw new Error("default layout tiles overlap");
if (defaultEntry.items.find((item) => item.id === "desk-j").y !== 3) throw new Error("default desks must start below hero");

const alteredDefault = api.normalizeLayoutEntry({
  id: "default",
  name: "Default",
  items: sample.map((item) => item.id === "hero" ? { ...item, h: 9 } : item),
  settings: { columns: 6, cellHeight: 60, tilePadding: 4, tileGap: 2 },
});
if (!alteredDefault || alteredDefault.items.find((item) => item.id === "hero").h !== 3) {
  throw new Error("default layout must stay canonical");
}
if (alteredDefault.settings.columns !== 12 || alteredDefault.settings.cellHeight !== 82) {
  throw new Error("default layout settings must stay canonical");
}

const legacy = api.normalizeLayoutEntry({ id: "qa", name: "QA", items: sample });
if (!legacy || !legacy.settings || legacy.settings.columns !== 12) {
  throw new Error("legacy layout without settings must migrate defaults");
}

const custom = api.normalizeLayoutEntry({
  id: "qa",
  name: "QA",
  items: sixCol,
  settings: { columns: 6, cellHeight: 96, tilePadding: 8, tileGap: 12 },
});
if (!custom || custom.settings.columns !== 6 || custom.settings.cellHeight !== 96) {
  throw new Error("custom layout settings not preserved");
}

if (api.sanitizeGridSettings({ columns: 99, cellHeight: 12, tilePadding: -4, tileGap: 40 }).columns !== 12) {
  throw new Error("grid settings bounds failed");
}

if (api.sanitizeLayoutItems(sample, 6)) throw new Error("twelve-column geometry must not pass six-column sanitization");

const catalog = api.defaultLayoutsCatalog();
if (catalog.layouts.length !== 1 || catalog.layouts[0].id !== "default" || !catalog.layouts[0].settings) {
  throw new Error("default catalog invalid");
}

const canonical = api.canonicalLayoutsCatalog([
  { id: "default", name: "Default", items: sample.map((item) => item.id === "hero" ? { ...item, h: 9 } : item) },
  { id: "qa", name: "QA", items: sample },
  { id: "qa", name: "Dup", items: sample },
]);
if (canonical.layouts.length !== 2) throw new Error("duplicate layout ids not deduped");
if (canonical.layouts[0].items.find((item) => item.id === "hero").h !== 3) throw new Error("canonical default not restored");

const tooMany = { schema: "inspr.joe.layouts.v1", layouts: Array.from({ length: 25 }, (_, index) => ({ id: `layout-${index}`, name: `Layout ${index}`, items: sample })) };
if (api.writeLayoutsCatalog(tooMany)) throw new Error("catalog over limit accepted");

console.log(JSON.stringify({ ok: true, appVersion: version.APP_VERSION, checks: 19 }, null, 2));
