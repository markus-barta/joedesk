#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const phoneHelpers = `${extractJoeBlock("  var DEFAULT_LAYOUT = [", "\n  var stateCopy = ")}
  var SUPPORTED_COLUMNS = [3, 6, 12];
  var DEFAULT_GRID_SETTINGS = { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 };
${extractJoeBlock("  function layoutCoordinate", "\n\n  function safeStoredLayout")}
${extractJoeBlock("  var NARROW_BREAKPOINT = 700", "  var SUPPORTED_COLUMNS = [3, 6, 12];")}
${extractJoeBlock("  function narrowTileHeight", "\n\n  function narrowLayoutFromItems")}
${extractJoeBlock("  function narrowLayoutFromItems", "\n\n  function rememberDesktopLayout")}`;

const api = new Function(`${phoneHelpers}
  return {
    NARROW_BREAKPOINT,
    NARROW_TILE_MIN_ROWS,
    sanitizeLayoutItems,
    sanitizeGridSettings,
    narrowTileHeight,
    narrowLayoutFromItems
  };
`)();

const sample = [
  { id: "hero", x: 0, y: 0, w: 12, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 4, h: 4 },
  { id: "desk-joe", x: 4, y: 3, w: 4, h: 4 },
  { id: "desk-joel", x: 8, y: 3, w: 4, h: 4 },
  { id: "attribution", x: 0, y: 7, w: 4, h: 3 },
  { id: "history", x: 4, y: 7, w: 8, h: 5 },
  { id: "positions", x: 0, y: 12, w: 12, h: 5 },
];

const defaultSettings = api.sanitizeGridSettings({});
const compactSettings = api.sanitizeGridSettings({ columns: 12, cellHeight: 48, tilePadding: 10, tileGap: 10 });

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

function estimatedTilePixels(item, settings) {
  const h = api.narrowTileHeight(item.id, settings);
  const clean = api.sanitizeGridSettings(settings);
  return h * (clean.cellHeight + clean.tileGap);
}

if (api.NARROW_BREAKPOINT !== 700) throw new Error("narrow breakpoint must stay at 700");

const narrow = api.narrowLayoutFromItems(sample, defaultSettings);
if (!narrow || narrow.length !== sample.length) throw new Error("narrow layout must keep every tile");
if (narrow.some((item) => item.w !== 1 || item.x !== 0)) throw new Error("narrow layout must be single column");
if (layoutTilesOverlap(narrow)) throw new Error("narrow layout tiles overlap");
if (narrow[0].id !== "hero" || narrow[0].h !== api.NARROW_TILE_MIN_ROWS.hero) {
  throw new Error("hero must lead narrow stack at default row height");
}

const compact = api.narrowLayoutFromItems(sample, compactSettings);
const defaultDesk = narrow.find((item) => item.id === "desk-j");
const compactDesk = compact.find((item) => item.id === "desk-j");
if (!compactDesk || compactDesk.h <= defaultDesk.h) {
  throw new Error("48px cell height must increase narrow desk row count");
}

for (const item of compact) {
  const minPixels = item.id.startsWith("desk-") ? 300 : item.id === "hero" ? 230 : item.id === "history" ? 320 : 180;
  if (estimatedTilePixels(item, compactSettings) < minPixels - 1) {
    throw new Error(`narrow tile ${item.id} under minimum safe height at 48px cells`);
  }
}

const reordered = sample.slice().reverse();
const narrowOrder = api.narrowLayoutFromItems(reordered, defaultSettings);
if (narrowOrder?.map((item) => item.id).join() !== narrow.map((item) => item.id).join()) {
  throw new Error("narrow layout order must follow desktop y/x, not input order");
}

let yCursor = 0;
for (const item of narrow) {
  if (item.y !== yCursor) throw new Error("narrow layout must stack contiguously");
  yCursor += item.h;
}

if (!api.sanitizeLayoutItems(narrow, 1)) throw new Error("narrow layout must sanitize at one column");

console.log(JSON.stringify({
  ok: true,
  checks: 10,
  narrowBreakpoint: api.NARROW_BREAKPOINT,
  defaultDeskRows: defaultDesk.h,
  compactDeskRows: compactDesk.h,
  tileCount: narrow.length,
}, null, 2));
