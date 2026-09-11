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

const viewportBlock = extractJoeBlock("  function layoutViewportWidth", "\n\n  function columnOptsFor");
const dragScrollPolicyBlock = extractJoeBlock("  function syncGridDragScrollPolicy", "\n\n  function syncGridColumnConfig");
const gridColumnConfigBlock = extractJoeBlock("  function syncGridColumnConfig", "\n\n  function gridColumnCount");

const phoneHelpers = `${extractJoeBlock("  var DEFAULT_LAYOUT = [", "\n  var stateCopy = ")}
  var SUPPORTED_COLUMNS = [3, 6, 12];
  var DEFAULT_GRID_SETTINGS = { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 };
${extractJoeBlock("  function layoutCoordinate", "\n\n  function safeStoredLayout")}
${extractJoeBlock("  var NARROW_BREAKPOINT = 700", "  var SUPPORTED_COLUMNS = [3, 6, 12];")}
${viewportBlock}
${extractJoeBlock("  function narrowGridTilePixels", "\n\n  function narrowLayoutFromItems")}
${extractJoeBlock("  function narrowLayoutFromItems", "\n\n  function rememberDesktopLayout")}`;

const api = new Function(`${phoneHelpers}
  return {
    NARROW_BREAKPOINT,
    NARROW_TILE_MIN_ROWS,
    NARROW_TILE_MIN_PIXELS,
    NARROW_WIDGET_DRAG_PX,
    sanitizeLayoutItems,
    sanitizeGridSettings,
    derivePhoneOrder,
    sanitizePhoneOrder,
    narrowGridTilePixels,
    narrowRowsForOuterPixels,
    narrowOuterPixelsForContent,
    narrowTileHeight,
    narrowLayoutFromItems
  };
`)();

const sample = [
  { id: "hero", x: 0, y: 0, w: 12, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 4, h: 9 },
  { id: "desk-joe", x: 4, y: 3, w: 4, h: 9 },
  { id: "desk-joel", x: 8, y: 3, w: 4, h: 9 },
  { id: "attribution", x: 0, y: 12, w: 4, h: 3 },
  { id: "history", x: 4, y: 12, w: 8, h: 5 },
  { id: "positions", x: 0, y: 17, w: 12, h: 5 },
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

function innerPixelsForTile(item, settings) {
  const outer = api.narrowGridTilePixels(item.h, settings);
  const chrome = item.id === "hero"
    ? settings.tilePadding * 2
    : settings.tilePadding * 2 + api.NARROW_WIDGET_DRAG_PX;
  return outer - chrome;
}

if (api.NARROW_BREAKPOINT !== 700) throw new Error("narrow breakpoint must stay at 700");

if (api.narrowGridTilePixels(5, defaultSettings) !== 5 * 82) {
  throw new Error("narrow grid outer height must be rows times cellHeight only");
}
if (api.narrowGridTilePixels(1, compactSettings) !== 48) {
  throw new Error("single-row narrow tile must equal cellHeight");
}
if (api.narrowGridTilePixels(9, compactSettings) !== 432) {
  throw new Error("measured 48px nine-row outer height must be 432px");
}

const narrow = api.narrowLayoutFromItems(sample, defaultSettings);
if (!narrow || narrow.length !== sample.length) throw new Error("narrow layout must keep every tile");
if (narrow.some((item) => item.w !== 1 || item.x !== 0)) throw new Error("narrow layout must be single column");
if (layoutTilesOverlap(narrow)) throw new Error("narrow layout tiles overlap");
if (narrow[0].id !== "hero" || narrow[0].h !== api.NARROW_TILE_MIN_ROWS.hero) {
  throw new Error("hero must lead narrow stack at default row height");
}

const defaultDesk = narrow.find((item) => item.id === "desk-j");
const compact = api.narrowLayoutFromItems(sample, compactSettings);
const compactDesk = compact.find((item) => item.id === "desk-j");
if (!defaultDesk || defaultDesk.h !== 6) {
  throw new Error("82px desk tiles must allocate six rows for measured phone content");
}
if (!compactDesk || compactDesk.h <= defaultDesk.h) {
  throw new Error("48px cell height must increase narrow desk row count");
}
if (compactDesk.h !== 11) {
  throw new Error("48px desk tiles must allocate eleven rows for measured phone content");
}

for (const item of compact) {
  const minInner = item.id.startsWith("desk-") ? 439 : item.id === "hero" ? 215 : item.id === "history" ? 320 : 180;
  if (innerPixelsForTile(item, compactSettings) < minInner - 1) {
    throw new Error(`narrow tile ${item.id} under measured inner height at 48px cells`);
  }
}

const reordered = sample.slice().reverse();
const narrowOrder = api.narrowLayoutFromItems(reordered, defaultSettings);
if (narrowOrder?.map((item) => item.id).join() !== narrow.map((item) => item.id).join()) {
  throw new Error("narrow layout order must follow desktop y/x, not input order");
}

const customPhoneOrder = ["hero", "desk-joe", "desk-j", "desk-joel", "history", "attribution", "positions"];
const customNarrow = api.narrowLayoutFromItems(sample, defaultSettings, customPhoneOrder);
if (customNarrow?.map((item) => item.id).join() !== customPhoneOrder.join()) {
  throw new Error("valid phone order did not control narrow stacking");
}
const invalidNarrow = api.narrowLayoutFromItems(sample, defaultSettings, ["hero", "hero"]);
if (invalidNarrow?.map((item) => item.id).join() !== narrow.map((item) => item.id).join()) {
  throw new Error("invalid phone order did not derive from desktop geometry");
}

let yCursor = 0;
for (const item of narrow) {
  if (item.y !== yCursor) throw new Error("narrow layout must stack contiguously");
  yCursor += item.h;
}

if (!api.sanitizeLayoutItems(narrow, 1)) throw new Error("narrow layout must sanitize at one column");

const deskOuter = api.narrowOuterPixelsForContent("desk-j", api.NARROW_TILE_MIN_PIXELS["desk-j"], defaultSettings);
if (api.narrowRowsForOuterPixels(deskOuter, defaultSettings) !== defaultDesk.h) {
  throw new Error("narrow row solver must match desk tile height at 82px cells");
}

const compactDeskInner = innerPixelsForTile(compactDesk, compactSettings);
if (compactDeskInner < api.NARROW_TILE_MIN_PIXELS["desk-j"]) {
  throw new Error("48px desk inner height must cover measured scroll content");
}

function viewportApi(docWidth, gridWidth, innerWidth, visualWidth) {
  return new Function(`
    var NARROW_BREAKPOINT = 700;
    var document = {
      documentElement: { clientWidth: ${docWidth} },
      getElementById: function(id) { return id === "joeGrid" ? { clientWidth: ${gridWidth} } : null; }
    };
    var window = { innerWidth: ${innerWidth}, visualViewport: { width: ${visualWidth} } };
    ${viewportBlock}
    return { layoutViewportWidth, isNarrowGridViewport };
  `)();
}

const mobileMismatch = viewportApi(390, 366, 1280, 390);
if (!mobileMismatch.isNarrowGridViewport()) {
  throw new Error("390px client width must count as narrow when innerWidth is still desktop-sized");
}
if (mobileMismatch.layoutViewportWidth() !== 366) {
  throw new Error("layout viewport width must use the narrowest reliable client measure");
}

const desktopViewport = viewportApi(1440, 1400, 1440, 1440);
if (desktopViewport.isNarrowGridViewport()) {
  throw new Error("1440px client width must stay desktop");
}
if (desktopViewport.layoutViewportWidth() !== 1400) {
  throw new Error("desktop layout viewport must follow the grid container width");
}

function dragScrollAfterSync(initialValue, onNarrow) {
  return new Function(`
    var grid = { opts: { draggable: { scroll: ${initialValue} } } };
    ${dragScrollPolicyBlock}
    syncGridDragScrollPolicy(${onNarrow});
    return grid.opts.draggable.scroll;
  `)();
}

if (dragScrollAfterSync(true, true) !== false) {
  throw new Error("narrow grid must disable GridStack helper autoscroll");
}
if (dragScrollAfterSync(false, false) !== true) {
  throw new Error("desktop grid must retain GridStack helper autoscroll");
}
if (!gridColumnConfigBlock.includes("syncGridDragScrollPolicy(onNarrow);")) {
  throw new Error("responsive grid sync must refresh the drag scroll policy");
}

console.log(JSON.stringify({
  ok: true,
  checks: 25,
  narrowBreakpoint: api.NARROW_BREAKPOINT,
  defaultDeskRows: defaultDesk.h,
  compactDeskRows: compactDesk.h,
  tileCount: narrow.length,
}, null, 2));
