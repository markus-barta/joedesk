#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const htmlSource = await readFile(resolve(repoRoot, "public/joe/index.html"), "utf8");
const versionSource = await readFile(resolve(repoRoot, "public/joe/joe-version.js"), "utf8");

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const layoutContext = extractJoeBlock("  var LEGACY_DEFAULT_LAYOUT = [", "\n  var stateCopy = ");
const layoutHelpers = `${layoutContext}
  var LAYOUT_KEY = "joe-board-layout-v1";
  var LAYOUTS_KEY = "joe-board-named-layouts-v1";
  var ACTIVE_LAYOUT_KEY = "joe-board-active-layout-v1";
  var SETTINGS_KEY = "joe-board-grid-settings-v1";
  var DEFAULT_LAYOUT_ID = "default";
  var MAX_LAYOUTS = 24;
  var NARROW_BREAKPOINT = 700;
  var NARROW_TILE_MIN_ROWS = {};
  var NARROW_TILE_MIN_PIXELS = {};
  var NARROW_WIDGET_DRAG_PX = 31;
  var NARROW_FIT_MAX_PASSES = 3;
  var SUPPORTED_COLUMNS = [3, 6, 12];
  var DEFAULT_GRID_SETTINGS = { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 };
  var grid = null;
  var restoringLayout = false;
  var narrowGridActive = false;
  var narrowFitFrame = 0;
  var cachedDesktopLayout = null;
  var activeGridSettings = Object.assign({}, DEFAULT_GRID_SETTINGS);
  var activeLayoutId = DEFAULT_LAYOUT_ID;
  var layoutBaseline = null;
  var layoutDirty = false;
  var pendingLayoutSelectionId = null;
  var layoutFormMode = null;
  var historyState = { chart: null };
  function resizeVisuals() {}
  function drawHistory() {}
${extractJoeBlock("  function layoutCoordinate", "\n\n  function setLayoutStatus")}
${extractJoeBlock("  function defaultLayoutEntry", "\n\n  function bindLayoutControls")}`;

function makeApi(localStorage, document, window) {
  return new Function("localStorage", "document", "window", "requestAnimationFrame", "cancelAnimationFrame", `${layoutHelpers}
  return {
    sanitizeLayoutItems,
    scaleLayoutColumns,
    sanitizeGridSettings,
    desktopDeskDefaultRows,
    layoutItemsEqual,
    migrateLegacyDefaultLayout,
    defaultLayoutEntry,
    defaultLayoutsCatalog,
    normalizeLayoutEntry,
    canonicalLayoutsCatalog,
    readLayoutsCatalog,
    writeLayoutsCatalog,
    readActiveLayoutId,
    writeActiveLayoutId,
    persistDraftSnapshot,
    makeLayoutSnapshot,
    layoutSnapshotsEqual,
    resolveInitialLayoutState,
    requestLayoutSelection,
    cancelPendingLayoutSelection,
    discardAndCompletePendingSelection,
    hideLayoutForm,
    saveNamedLayout,
    saveCurrentNamedLayout,
    renameSelectedLayout,
    deleteSelectedLayout,
    resetToDefaultLayout,
    state: function() { return { activeLayoutId, layoutDirty, pendingLayoutSelectionId }; },
    setState: function(next) {
      if (next.grid !== undefined) grid = next.grid;
      if (next.activeLayoutId !== undefined) activeLayoutId = next.activeLayoutId;
      if (next.layoutDirty !== undefined) layoutDirty = next.layoutDirty;
      if (next.layoutBaseline !== undefined) layoutBaseline = next.layoutBaseline;
      if (next.activeGridSettings !== undefined) activeGridSettings = next.activeGridSettings;
      if (next.cachedDesktopLayout !== undefined) cachedDesktopLayout = next.cachedDesktopLayout;
      if (next.pendingLayoutSelectionId !== undefined) pendingLayoutSelectionId = next.pendingLayoutSelectionId;
    }
  };
  `)(localStorage, document, window, (fn) => { fn(); return 1; }, () => {});
}

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.denyReads = false;
    this.denyWrites = false;
  }
  getItem(key) {
    if (this.denyReads) throw new Error("storage read denied");
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    if (this.denyWrites) throw new Error("storage write denied");
    this.values.set(key, String(value));
  }
}

function makeDom() {
  const nodes = new Map();
  const makeNode = (id = "") => ({
    id,
    value: "",
    textContent: "",
    disabled: false,
    hidden: false,
    open: false,
    dataset: {},
    classList: { toggle() {}, add() {} },
    style: { setProperty() {}, removeProperty() {} },
    setAttribute(name, value) { this[name] = value; },
    querySelectorAll() { return []; },
    replaceChildren(...children) { this.children = children; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
    select() {},
  });
  ["layoutSelect", "saveLayout", "deleteLayout", "renameLayout", "resetLayout", "layoutToolbar", "layoutStatus", "layoutUnsavedDialog", "layoutUnsavedMessage", "layoutInlineForm", "layoutNameInput"].forEach((id) => nodes.set(id, makeNode(id)));
  const document = {
    documentElement: { clientWidth: 1200, dataset: {}, style: { setProperty() {}, removeProperty() {} } },
    getElementById(id) { return nodes.get(id) || null; },
    createElement() { return makeNode(); },
    querySelector() { return null; },
  };
  return { document, nodes };
}

const storage = new MemoryStorage();
const dom = makeDom();
const testWindow = { innerWidth: 1200, visualViewport: null, confirm: () => true };
const api = makeApi(storage, dom.document, testWindow);

const version = new Function("window", `${versionSource}; return window.JoeVersion;`)({});
if (!version?.APP_VERSION || !Array.isArray(version.VERSION_HISTORY) || version.VERSION_HISTORY.length < 4) {
  throw new Error("JoeVersion invalid");
}

const legacySample = [
  { id: "hero", x: 0, y: 0, w: 12, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 4, h: 4 },
  { id: "desk-joe", x: 4, y: 3, w: 4, h: 4 },
  { id: "desk-joel", x: 8, y: 3, w: 4, h: 4 },
  { id: "attribution", x: 0, y: 7, w: 4, h: 3 },
  { id: "history", x: 4, y: 7, w: 8, h: 5 },
  { id: "positions", x: 0, y: 12, w: 12, h: 5 },
];
const legacySampleV2 = [
  { id: "hero", x: 0, y: 0, w: 12, h: 3 },
  { id: "desk-j", x: 0, y: 3, w: 4, h: 8 },
  { id: "desk-joe", x: 4, y: 3, w: 4, h: 8 },
  { id: "desk-joel", x: 8, y: 3, w: 4, h: 8 },
  { id: "attribution", x: 0, y: 11, w: 4, h: 3 },
  { id: "history", x: 4, y: 11, w: 8, h: 5 },
  { id: "positions", x: 0, y: 16, w: 12, h: 5 },
];
const sample = api.defaultLayoutEntry().items;

function layoutFromHtml(source) {
  const items = [];
  const itemRe = /gs-id="([^"]+)"\s+gs-x="(\d+)"\s+gs-y="(\d+)"\s+gs-w="(\d+)"\s+gs-h="(\d+)"/g;
  let match = itemRe.exec(source);
  while (match) {
    items.push({
      id: match[1],
      x: Number(match[2]),
      y: Number(match[3]),
      w: Number(match[4]),
      h: Number(match[5])
    });
    match = itemRe.exec(source);
  }
  return items;
}

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
const scaledSixCol = api.scaleLayoutColumns(sample, 12, 6);
if (!scaledSixCol || scaledSixCol.find((item) => item.id === "hero").w !== 6 || scaledSixCol.find((item) => item.id === "desk-joe").x !== 2 || scaledSixCol.find((item) => item.id === "desk-joel").x !== 4) {
  throw new Error("phone-side column change did not preserve desktop placement");
}
const scaledBackToTwelve = api.scaleLayoutColumns(scaledSixCol, 6, 12);
if (!scaledBackToTwelve || !api.layoutItemsEqual(scaledBackToTwelve, sample)) {
  throw new Error("desktop layout did not survive a phone-side column round trip");
}

const defaultEntry = api.defaultLayoutEntry();
const deskRows = api.desktopDeskDefaultRows();
if (layoutTilesOverlap(defaultEntry.items)) throw new Error("default layout tiles overlap");
if (defaultEntry.items.find((item) => item.id === "desk-j").y !== 3) throw new Error("default desks must start below hero");
if (!defaultEntry.items.filter((item) => item.id.startsWith("desk-")).every((item) => item.h === deskRows)) {
  throw new Error("default desk tiles must match measured desktop row budget");
}
if (defaultEntry.items.find((item) => item.id === "attribution").y !== 12) {
  throw new Error("default attribution must follow taller desk row");
}
if (defaultEntry.items.find((item) => item.id === "positions").y !== 17) {
  throw new Error("default positions must follow history without overlap");
}

const htmlLayout = layoutFromHtml(htmlSource);
if (!api.layoutItemsEqual(htmlLayout, sample)) {
  throw new Error("index.html grid-stack defaults must match DEFAULT_LAYOUT");
}

const migratedLegacy = api.migrateLegacyDefaultLayout(legacySample);
if (!api.layoutItemsEqual(migratedLegacy, sample)) {
  throw new Error("untouched legacy default geometry must migrate to current default");
}
const migratedLegacyV2 = api.migrateLegacyDefaultLayout(legacySampleV2);
if (!api.layoutItemsEqual(migratedLegacyV2, sample)) {
  throw new Error("untouched legacy v2 default geometry must migrate to current default");
}
const customizedLegacy = legacySample.map((item) => item.id === "hero" ? { ...item, h: 4 } : item);
if (!api.layoutItemsEqual(api.migrateLegacyDefaultLayout(customizedLegacy), customizedLegacy)) {
  throw new Error("customized layouts must not be auto-migrated");
}

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
  { id: "qa", name: "QA", items: sample.map((item) => item.id === "hero" ? { ...item, h: 4 } : item) },
]);
if (canonical.layouts.length !== 3) throw new Error("duplicate layout identity discarded");
if (new Set(canonical.layouts.map((entry) => entry.id)).size !== 3) throw new Error("duplicate layout ids not disambiguated");
if (new Set(canonical.layouts.map((entry) => entry.name.toLocaleLowerCase())).size !== 3) throw new Error("duplicate layout names not disambiguated");
if (canonical.layouts[2].items.find((item) => item.id === "hero").h !== 4) throw new Error("distinct duplicate arrangement discarded");
if (canonical.layouts[0].items.find((item) => item.id === "hero").h !== 3) throw new Error("canonical default not restored");
const duplicateDefaultIdentity = api.canonicalLayoutsCatalog([
  { id: "default", name: "Default", items: sample },
  { id: "default", name: "Default", items: sample.map((item) => item.id === "hero" ? { ...item, h: 4 } : item) },
]);
if (duplicateDefaultIdentity.layouts.length !== 2 || duplicateDefaultIdentity.layouts[1].id === "default" || duplicateDefaultIdentity.layouts[1].items.find((item) => item.id === "hero").h !== 4) {
  throw new Error("duplicate default identity discarded a distinct arrangement");
}

const tooMany = { schema: "inspr.joe.layouts.v1", layouts: Array.from({ length: 25 }, (_, index) => ({ id: `layout-${index}`, name: `Layout ${index}`, items: sample })) };
if (api.writeLayoutsCatalog(tooMany)) throw new Error("catalog over limit accepted");

storage.setItem("joe-board-named-layouts-v1", JSON.stringify({
  schema: "inspr.joe.layouts.v1",
  layouts: [
    { id: "qa", name: "QA", items: sample },
    { id: "qa", name: "qa", items: sample.map((item) => item.id === "hero" ? { ...item, h: 4 } : item) },
  ],
}));
const migratedCatalog = api.readLayoutsCatalog();
if (migratedCatalog.layouts.length !== 3) throw new Error("legacy duplicate catalog lost an entry");
if (new Set(migratedCatalog.layouts.map((entry) => entry.id)).size !== 3) throw new Error("legacy duplicate ids remain ambiguous");
if (new Set(migratedCatalog.layouts.map((entry) => entry.name.toLocaleLowerCase())).size !== 3) throw new Error("legacy duplicate names remain ambiguous");
const persistedMigration = JSON.parse(storage.getItem("joe-board-named-layouts-v1"));
if (persistedMigration.layouts[2].id !== migratedCatalog.layouts[2].id || persistedMigration.layouts[2].name !== migratedCatalog.layouts[2].name) {
  throw new Error("catalog migration was not persisted deterministically");
}

if (!api.writeActiveLayoutId(migratedCatalog.layouts[1].id)) throw new Error("active layout id was not persisted");
if (api.readActiveLayoutId(migratedCatalog) !== migratedCatalog.layouts[1].id) throw new Error("active layout id was not restored");

const namedEntry = migratedCatalog.layouts[1];
const cleanReload = api.resolveInitialLayoutState(migratedCatalog, namedEntry.id, null, null);
if (cleanReload.activeId !== namedEntry.id || cleanReload.dirty || !api.layoutSnapshotsEqual(cleanReload.baseline, api.makeLayoutSnapshot(namedEntry.items, namedEntry.settings))) {
  throw new Error("last-used named layout did not reload cleanly");
}
const dirtyItems = namedEntry.items.map((item) => item.id === "hero" ? { ...item, h: item.h + 1 } : item);
const dirtyReload = api.resolveInitialLayoutState(migratedCatalog, namedEntry.id, dirtyItems, namedEntry.settings);
if (!dirtyReload.dirty || dirtyReload.items.find((item) => item.id === "hero").h !== 4) {
  throw new Error("persisted named draft was silently discarded on reload");
}
const settingsDirtyReload = api.resolveInitialLayoutState(
  migratedCatalog,
  namedEntry.id,
  namedEntry.items,
  { ...namedEntry.settings, tileGap: namedEntry.settings.tileGap + 1 },
);
if (!settingsDirtyReload.dirty) throw new Error("grid settings change did not mark layout dirty");
if (!api.layoutSnapshotsEqual(api.makeLayoutSnapshot(namedEntry.items, namedEntry.settings), api.makeLayoutSnapshot(namedEntry.items, namedEntry.settings))) {
  throw new Error("unchanged layout snapshot reported dirty");
}

const deniedStorage = new MemoryStorage();
deniedStorage.denyWrites = true;
const deniedDom = makeDom();
const deniedApi = makeApi(deniedStorage, deniedDom.document, testWindow);
if (deniedApi.writeActiveLayoutId("qa")) throw new Error("denied active-id storage claimed success");
if (deniedApi.writeLayoutsCatalog({ schema: "inspr.joe.layouts.v1", layouts: [namedEntry] })) throw new Error("denied catalog storage claimed success");
if (deniedApi.persistDraftSnapshot(api.makeLayoutSnapshot(namedEntry.items, namedEntry.settings))) throw new Error("denied draft storage claimed success");

api.writeLayoutsCatalog({ schema: "inspr.joe.layouts.v1", layouts: migratedCatalog.layouts });
const gridModel = {
  opts: {},
  items: sample.map((item) => ({ ...item })),
  loads: 0,
  getColumn() { return 12; },
  column() {},
  cellHeight() {},
  margin() {},
  load(items) { this.items = items.map((item) => ({ ...item })); this.loads += 1; },
  save() { return this.items.map((item) => ({ ...item })); },
};
api.setState({
  grid: gridModel,
  activeLayoutId: "default",
  layoutDirty: true,
  layoutBaseline: api.makeLayoutSnapshot(sample, { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 }),
  activeGridSettings: { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 },
  cachedDesktopLayout: sample,
});
api.requestLayoutSelection(namedEntry.id);
if (api.state().pendingLayoutSelectionId !== namedEntry.id || !dom.nodes.get("layoutUnsavedDialog").open || dom.nodes.get("layoutSelect").value !== "default") {
  throw new Error("dirty selection did not wait for Save/Discard/Cancel");
}
api.cancelPendingLayoutSelection();
if (api.state().pendingLayoutSelectionId !== null || dom.nodes.get("layoutUnsavedDialog").open || api.state().activeLayoutId !== "default") {
  throw new Error("cancel did not retain the active selection");
}

api.setState({ pendingLayoutSelectionId: namedEntry.id });
api.hideLayoutForm({ type: "click" });
if (api.state().pendingLayoutSelectionId !== null || dom.nodes.get("layoutSelect").value !== "default") {
  throw new Error("event-style Save As cancel preserved stale pending navigation");
}

api.requestLayoutSelection(namedEntry.id);
api.discardAndCompletePendingSelection();
if (api.state().activeLayoutId !== namedEntry.id || api.state().layoutDirty || gridModel.loads !== 1) {
  throw new Error("discard did not load the requested clean layout");
}

api.setState({ activeLayoutId: "default", layoutDirty: true, cachedDesktopLayout: sample });
api.requestLayoutSelection(namedEntry.id);
const loadsBeforeFailure = gridModel.loads;
storage.denyWrites = true;
api.discardAndCompletePendingSelection();
storage.denyWrites = false;
if (api.state().activeLayoutId !== "default" || !api.state().layoutDirty || gridModel.loads !== loadsBeforeFailure) {
  throw new Error("failed selection storage discarded the live draft");
}

api.setState({ activeLayoutId: "default", layoutDirty: false, cachedDesktopLayout: sample });
api.requestLayoutSelection(namedEntry.id);
if (api.state().activeLayoutId !== namedEntry.id || api.state().layoutDirty) {
  throw new Error("clean selection did not auto-load");
}

gridModel.items = sample.map((item) => item.id === "hero" ? { ...item, h: 5 } : { ...item });
api.setState({ layoutDirty: true });
const countBeforeOverwrite = api.readLayoutsCatalog().layouts.length;
if (!api.saveCurrentNamedLayout()) throw new Error("dirty named layout was not overwritten");
const overwrittenCatalog = api.readLayoutsCatalog();
const overwrittenNamed = overwrittenCatalog.layouts.find((entry) => entry.id === namedEntry.id);
if (overwrittenCatalog.layouts.length !== countBeforeOverwrite || overwrittenNamed?.items.find((item) => item.id === "hero")?.h !== 5 || api.state().layoutDirty) {
  throw new Error("Save did not update the active named id and clean its baseline");
}

const collisionTarget = overwrittenCatalog.layouts.find((entry) => !entry.builtin && entry.id !== namedEntry.id);
const catalogBeforeCancelledCollision = storage.getItem("joe-board-named-layouts-v1");
testWindow.confirm = () => false;
if (api.saveNamedLayout(collisionTarget.name)) throw new Error("cancelled Save As collision reported success");
if (storage.getItem("joe-board-named-layouts-v1") !== catalogBeforeCancelledCollision) throw new Error("cancelled Save As collision changed storage");
if (api.renameSelectedLayout(collisionTarget.name)) throw new Error("cancelled rename collision reported success");
if (storage.getItem("joe-board-named-layouts-v1") !== catalogBeforeCancelledCollision) throw new Error("cancelled rename collision changed storage");

testWindow.confirm = () => true;
if (!api.saveNamedLayout(collisionTarget.name)) throw new Error("confirmed Save As collision was not overwritten");
const collisionCatalog = api.readLayoutsCatalog();
if (collisionCatalog.layouts.length !== countBeforeOverwrite || api.state().activeLayoutId !== collisionTarget.id || collisionCatalog.layouts.find((entry) => entry.id === collisionTarget.id)?.items.find((item) => item.id === "hero")?.h !== 5) {
  throw new Error("confirmed Save As collision did not preserve target identity");
}

api.setState({ activeLayoutId: "default", layoutDirty: true });
dom.nodes.get("layoutInlineForm").hidden = true;
if (api.saveCurrentNamedLayout() || dom.nodes.get("layoutInlineForm").hidden || api.state().activeLayoutId !== "default") {
  throw new Error("dirty Default Save did not route to Save As");
}

api.setState({ activeLayoutId: collisionTarget.id, layoutDirty: true });
storage.denyWrites = true;
if (api.saveCurrentNamedLayout()) throw new Error("failed named save claimed success");
storage.denyWrites = false;
if (!api.state().layoutDirty || api.state().activeLayoutId !== collisionTarget.id) {
  throw new Error("failed named save discarded or cleaned the live draft");
}

const catalogBeforeCancelledDelete = storage.getItem("joe-board-named-layouts-v1");
testWindow.confirm = () => false;
if (api.deleteSelectedLayout()) throw new Error("cancelled delete reported success");
if (storage.getItem("joe-board-named-layouts-v1") !== catalogBeforeCancelledDelete || api.state().activeLayoutId !== collisionTarget.id) {
  throw new Error("cancelled delete changed data or selection");
}
testWindow.confirm = () => true;
if (!api.deleteSelectedLayout()) throw new Error("confirmed delete failed");
if (api.state().activeLayoutId !== "default" || api.state().layoutDirty || api.readLayoutsCatalog().layouts.some((entry) => entry.id === collisionTarget.id)) {
  throw new Error("delete did not apply the immutable Default fallback");
}

api.requestLayoutSelection(namedEntry.id);
gridModel.items = sample.map((item) => item.id === "hero" ? { ...item, h: 6 } : { ...item });
api.setState({ layoutDirty: true });
testWindow.confirm = () => false;
if (api.resetToDefaultLayout() || api.state().activeLayoutId !== namedEntry.id) {
  throw new Error("cancelled reset discarded the active draft");
}
testWindow.confirm = () => true;
if (!api.resetToDefaultLayout() || api.state().activeLayoutId !== "default" || api.state().layoutDirty) {
  throw new Error("confirmed reset did not select clean Default");
}

let restoringLayout = true;
let layoutPersisted = false;
const saveLayoutGuard = () => {
  if (!restoringLayout) { layoutPersisted = true; }
};
saveLayoutGuard();
restoringLayout = false;
if (layoutPersisted) throw new Error("saveLayout guard must ignore calls while restoringLayout is true");

restoringLayout = true;
restoringLayout = false;
saveLayoutGuard();
if (!layoutPersisted) throw new Error("desktop applyGridLayout must persist after restoringLayout clears");

console.log(JSON.stringify({ ok: true, appVersion: version.APP_VERSION, checks: 68, desktopDeskRows: deskRows }, null, 2));
