#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const cssSource = await readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8");

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
${extractJoeBlock("  var PHONE_BREAKPOINT = 390", "  var SUPPORTED_COLUMNS = [3, 6, 12];")}
${extractJoeBlock("  function phoneLayoutFromItems", "\n\n  function persistDesktopItems")}`;

const api = new Function(`${phoneHelpers}
  return {
    PHONE_BREAKPOINT,
    PHONE_TILE_HEIGHTS,
    sanitizeLayoutItems,
    phoneLayoutFromItems
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

if (api.PHONE_BREAKPOINT !== 390) throw new Error("phone breakpoint must be 390");
if (!api.PHONE_TILE_HEIGHTS.hero || api.PHONE_TILE_HEIGHTS.history < 6) {
  throw new Error("phone tile heights missing or too short");
}

const phone = api.phoneLayoutFromItems(sample);
if (!phone || phone.length !== sample.length) throw new Error("phone layout must keep every tile");
if (phone.some((item) => item.w !== 1 || item.x !== 0)) throw new Error("phone layout must be single column");
if (layoutTilesOverlap(phone)) throw new Error("phone layout tiles overlap");
if (phone[0].id !== "hero" || phone[0].h !== 3) throw new Error("hero must lead phone stack at h=3");
if (phone.find((item) => item.id === "history")?.h !== api.PHONE_TILE_HEIGHTS.history) {
  throw new Error("history phone height not applied");
}
if (!api.sanitizeLayoutItems(phone, 1)) throw new Error("phone layout must sanitize at one column");

const reordered = sample.slice().reverse();
const phoneOrder = api.phoneLayoutFromItems(reordered);
if (phoneOrder?.map((item) => item.id).join() !== phone.map((item) => item.id).join()) {
  throw new Error("phone layout order must follow desktop y/x, not input order");
}

let yCursor = 0;
for (const item of phone) {
  if (item.y !== yCursor) throw new Error("phone layout must stack contiguously");
  yCursor += item.h;
}

if (!cssSource.includes("@media (max-width: 390px)")) throw new Error("phone css breakpoint missing");
if (/clamp\(9px,\s*2\.7vw,\s*11px\)/.test(cssSource)) throw new Error("compact-mode hero scaling still present");
if (!cssSource.includes("min-height: 44px")) throw new Error("touch target sizing missing");
if (!cssSource.includes("[data-joe-viewport=\"phone\"]")) throw new Error("phone viewport dataset styles missing");

console.log(JSON.stringify({ ok: true, checks: 12, phoneBreakpoint: api.PHONE_BREAKPOINT, tileCount: phone.length }, null, 2));
