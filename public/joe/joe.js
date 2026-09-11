(function () {
  "use strict";

  function isCanonicalJoeHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    if (host.charAt(0) === "[" && host.charAt(host.length - 1) === "]") {
      host = host.slice(1, -1);
    }
    if (
      host === "cs0.barta.cm" || host === "cs0" ||
      host === "hsb1.lan" || host === "hsb1" ||
      host === "localhost" || host === "127.0.0.1" || host === "::1"
    ) {
      return true;
    }
    var parts = host.split(".");
    if (parts.length === 4) {
      var octets = [];
      var i;
      var valid = true;
      for (i = 0; i < 4; i += 1) {
        if (!/^(0|[1-9]\d{0,2})$/.test(parts[i])) {
          valid = false;
          break;
        }
        var n = Number(parts[i]);
        if (n > 255) {
          valid = false;
          break;
        }
        octets.push(n);
      }
      if (valid && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        return true;
      }
    }
    return host.slice(-7) === ".ts.net" && host.indexOf("hsb1") !== -1;
  }

  var LAYOUT_KEY = "joe-board-layout-v1";
  var LAYOUTS_KEY = "joe-board-named-layouts-v1";
  var SETTINGS_KEY = "joe-board-grid-settings-v1";
  var THEME_KEY = "joe-board-theme-v1";
  var DEFAULT_LAYOUT_ID = "default";
  var MAX_LAYOUTS = 24;
  var NARROW_BREAKPOINT = 700;
  var NARROW_TILE_MIN_ROWS = {
    hero: 3,
    "desk-j": 5,
    "desk-joe": 5,
    "desk-joel": 5,
    attribution: 4,
    history: 8,
    positions: 7
  };
  var NARROW_TILE_MIN_PIXELS = {
    hero: 215,
    "desk-j": 439,
    "desk-joe": 439,
    "desk-joel": 439,
    attribution: 190,
    history: 320,
    positions: 290
  };
  var NARROW_WIDGET_DRAG_PX = 31;
  var NARROW_FIT_MAX_PASSES = 3;
  var SUPPORTED_COLUMNS = [3, 6, 12];
  var THEME_MODES = ["light", "dark", "system"];
  var DEFAULT_GRID_SETTINGS = { columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 };
  var DESK_IDS = ["j", "joe", "joel"];
  var ACCOUNTING_METHOD = "execution-fifo-net-current-fx";
  var ACCOUNTING_DETAIL_MAX = 240;
  var HISTORY_BASIS_MAX = 96;
  var HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
  var LEGACY_DEFAULT_LAYOUT = [
    { id: "hero", x: 0, y: 0, w: 12, h: 3 },
    { id: "desk-j", x: 0, y: 3, w: 4, h: 4 },
    { id: "desk-joe", x: 4, y: 3, w: 4, h: 4 },
    { id: "desk-joel", x: 8, y: 3, w: 4, h: 4 },
    { id: "attribution", x: 0, y: 7, w: 4, h: 3 },
    { id: "history", x: 4, y: 7, w: 8, h: 5 },
    { id: "positions", x: 0, y: 12, w: 12, h: 5 }
  ];
  var LEGACY_DEFAULT_LAYOUT_V2 = [
    { id: "hero", x: 0, y: 0, w: 12, h: 3 },
    { id: "desk-j", x: 0, y: 3, w: 4, h: 8 },
    { id: "desk-joe", x: 4, y: 3, w: 4, h: 8 },
    { id: "desk-joel", x: 8, y: 3, w: 4, h: 8 },
    { id: "attribution", x: 0, y: 11, w: 4, h: 3 },
    { id: "history", x: 4, y: 11, w: 8, h: 5 },
    { id: "positions", x: 0, y: 16, w: 12, h: 5 }
  ];
  var DESKTOP_DESK_DEFAULT_ROWS = 9;
  var DEFAULT_LAYOUT = [
    { id: "hero", x: 0, y: 0, w: 12, h: 3 },
    { id: "desk-j", x: 0, y: 3, w: 4, h: 9 },
    { id: "desk-joe", x: 4, y: 3, w: 4, h: 9 },
    { id: "desk-joel", x: 8, y: 3, w: 4, h: 9 },
    { id: "attribution", x: 0, y: 12, w: 4, h: 3 },
    { id: "history", x: 4, y: 12, w: 8, h: 5 },
    { id: "positions", x: 0, y: 17, w: 12, h: 5 }
  ];
  var stateCopy = { working: "Working", "sit-out": "Sitting out", stuck: "Stuck" };
  var learningStatusCopy = { learning: "Learning", iterating: "Iterating", steady: "Steady", blocked: "Blocked" };
  var OBSERVED_EVENTS_KEY = "joe-board-observed-events-v1";
  var MAX_OBSERVED_EVENTS = 200;
  var DESK_TIMELINE_LIMIT = 5;
  var money = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
  var moneyFormatters = { EUR: money };
  var number = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 4 });
  var dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Vienna" });
  var shortTime = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
  var accountingDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "America/New_York" });
  var grid = null;
  var restoringLayout = false;
  var narrowGridActive = false;
  var narrowFitFrame = 0;
  var viewportSyncFrame = 0;
  var cachedDesktopLayout = null;
  var latestSnapshot = null;
  var lastValidSnapshot = null;
  var refreshError = null;
  var positionFilter = "all";
  var historyState = { selected: DESK_IDS.slice(), range: "all", points: [], chart: null };
  var historyError = null;
  var lastObservedSnapshot = null;
  var observedEventsMemory = null;
  var layoutFormMode = null;
  var activeGridSettings = Object.assign({}, DEFAULT_GRID_SETTINGS);
  var activeThemeMode = "dark";
  var settingsFormDirty = false;

  var gate = document.getElementById("privateGate");
  var dashboard = document.getElementById("dashboard");
  if (!isCanonicalJoeHost(location.hostname)) {
    document.title = "Joe · Private household board";
    document.documentElement.dataset.joeView = "stub";
    gate.hidden = false;
    return;
  }
  document.documentElement.dataset.joeView = "board";
  dashboard.hidden = false;

  function required(condition, message) {
    if (!condition) { throw new Error(message); }
  }

  function finiteOrNull(value, path) {
    required(value === null || Number.isFinite(value), path + " must be a number or null");
  }

  function validateAccounting(accounting, path) {
    required(accounting && typeof accounting === "object" && !Array.isArray(accounting), path + " must be an object");
    Object.keys(accounting).forEach(function (key) {
      required(["periodStart", "method", "detail"].includes(key), path + " has unknown key " + key);
    });
    required(validIsoTimestamp(accounting.periodStart), path + ".periodStart is invalid");
    required(accounting.method === ACCOUNTING_METHOD, path + ".method is invalid");
    required(
      typeof accounting.detail === "string" &&
      accounting.detail.length >= 1 &&
      accounting.detail.length <= ACCOUNTING_DETAIL_MAX &&
      /^[\x20-\x7e]+$/.test(accounting.detail),
      path + ".detail must be 1-" + ACCOUNTING_DETAIL_MAX + " printable English characters"
    );
    return accounting;
  }

  function validateHistoryBasis(historyBasis, path) {
    required(
      typeof historyBasis === "string" &&
      historyBasis.length >= 1 &&
      historyBasis.length <= HISTORY_BASIS_MAX &&
      HISTORY_BASIS.test(historyBasis),
      path + " must be a stable lowercase basis id"
    );
    return historyBasis;
  }

  function accountingPeriodLabel(accounting) {
    var parts = accountingDate.formatToParts(new Date(accounting.periodStart));
    var day = parts.find(function (part) { return part.type === "day"; });
    var month = parts.find(function (part) { return part.type === "month"; });
    var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Number(day.value) + " " + monthNames[Number(month.value) - 1];
  }

  function accountingSinceLabel(desk) {
    return desk.accounting ? "Since " + accountingPeriodLabel(desk.accounting) : "Since start";
  }

  function renderAccountingBasis(desk) {
    if (!desk.accounting) { return null; }
    var root = el("div", "desk-accounting");
    var scope = desk.id === "j" ? "J + J2–J5" : desk.label;
    root.appendChild(el("p", "desk-accounting-basis", scope + " · verified from " + accountingPeriodLabel(desk.accounting)));
    root.appendChild(el("p", "desk-accounting-detail", desk.accounting.detail));
    return root;
  }

  function validate(data) {
    required(data && typeof data === "object", "data must be an object");
    required(data.schema === "inspr.joe.household.v1", "unknown schema");
    required(data.mode === "PAPER", "mode must be PAPER");
    required(data.currency === "EUR", "currency must be EUR");
    required(!Number.isNaN(Date.parse(data.generatedAt)), "generatedAt must be an ISO timestamp");
    required(data.safety && typeof data.safety === "object", "safety is required");
    required(typeof data.safety.halt === "boolean", "safety.halt must be boolean");
    required(["ok", "degraded", "down"].includes(data.safety.gateway && data.safety.gateway.status), "gateway status is invalid");
    required(Number.isFinite(data.safety.staleAfterSeconds) && data.safety.staleAfterSeconds > 0, "staleAfterSeconds is invalid");
    required(Array.isArray(data.desks) && data.desks.length === 3, "exactly three desks are required");
    required(new Set(data.desks.map(function (desk) { return desk.id; })).size === 3, "desk ids must be unique");
    data.desks.forEach(function (desk, index) {
      var path = "desks[" + index + "]";
      required(DESK_IDS.includes(desk.id), path + ".id is invalid");
      required(typeof desk.label === "string" && desk.label.length, path + ".label is required");
      required(["working", "sit-out", "stuck"].includes(desk.state), path + ".state is invalid");
      required(typeof desk.action === "string" && desk.action.length, path + ".action is required");
      required(desk.learning && typeof desk.learning.headline === "string" && typeof desk.learning.detail === "string", path + ".learning is invalid");
      required(desk.money && typeof desk.money === "object", path + ".money is required");
      ["equity", "dayPnl", "totalPnl"].forEach(function (key) { finiteOrNull(desk.money[key], path + ".money." + key); });
      if (Object.prototype.hasOwnProperty.call(desk.money, "openPnl")) { finiteOrNull(desk.money.openPnl, path + ".money.openPnl"); }
      if (Object.prototype.hasOwnProperty.call(desk, "accounting")) { validateAccounting(desk.accounting, path + ".accounting"); }
      if (Object.prototype.hasOwnProperty.call(desk, "historyBasis")) { validateHistoryBasis(desk.historyBasis, path + ".historyBasis"); }
      required(Array.isArray(desk.issues), path + ".issues must be an array");
    });
    required(data.totals && typeof data.totals === "object", "totals are required");
    ["equity", "dayPnl", "totalPnl"].forEach(function (key) { finiteOrNull(data.totals[key], "totals." + key); });
    if (Object.prototype.hasOwnProperty.call(data.totals, "openPnl")) { finiteOrNull(data.totals.openPnl, "totals.openPnl"); }
    return data;
  }

  function amount(value, signed) {
    if (!Number.isFinite(value)) { return "—"; }
    var formatted = money.format(Math.abs(value));
    if (!signed || value === 0) { return value < 0 ? "−" + formatted : formatted; }
    return (value > 0 ? "+" : "−") + formatted;
  }

  function moneyForCurrency(currencyCode) {
    if (!currencyCode) { return null; }
    if (moneyFormatters[currencyCode]) { return moneyFormatters[currencyCode]; }
    try {
      moneyFormatters[currencyCode] = new Intl.NumberFormat("de-AT", { style: "currency", currency: currencyCode, minimumFractionDigits: 2 });
      return moneyFormatters[currencyCode];
    } catch (_) {
      return null;
    }
  }

  function positionCurrencyCode(position) {
    if (!position || typeof position.currency !== "string") { return null; }
    var code = position.currency.trim();
    return /^[A-Z]{3}$/.test(code) ? code : null;
  }

  function positionAccountingScopeLabel(position) {
    if (position && position.accountingScope === "legacy") {
      return "Legacy · excluded from Stage-0";
    }
    return null;
  }

  function formatPositionMoney(value, signed, currencyCode) {
    var formatter = moneyForCurrency(currencyCode);
    if (!formatter || !Number.isFinite(value)) { return "—"; }
    var formatted = formatter.format(Math.abs(value));
    if (!signed || value === 0) { return value < 0 ? "−" + formatted : formatted; }
    return (value > 0 ? "+" : "−") + formatted;
  }

  function positionMarketValue(position) {
    return Number.isFinite(position.marketValue) ? position.marketValue : null;
  }

  function positionSymbolText(position) {
    return position && position.symbol ? String(position.symbol) : "—";
  }

  function tone(value) {
    if (!Number.isFinite(value) || value === 0) { return "neutral"; }
    return value > 0 ? "positive" : "negative";
  }

  function setMoney(node, value, signed) {
    node.textContent = amount(value, signed);
    node.classList.remove("positive", "negative", "neutral");
    node.classList.add(tone(value));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function endpoint(metaName, globalName, fallback) {
    var meta = document.querySelector('meta[name="' + metaName + '"]');
    return window[globalName] || (meta && meta.content) || fallback;
  }

  function layoutCoordinate(value, min, max) {
    if (!Number.isFinite(value) || Math.floor(value) !== value) { return null; }
    if (value < min || value > max) { return null; }
    return value;
  }

  function boundedInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) { return fallback; }
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function sanitizeGridSettings(value) {
    if (!value || typeof value !== "object") {
      return Object.assign({}, DEFAULT_GRID_SETTINGS);
    }
    var columns = SUPPORTED_COLUMNS.includes(value.columns) ? value.columns : DEFAULT_GRID_SETTINGS.columns;
    return {
      columns: columns,
      cellHeight: boundedInt(value.cellHeight, 48, 140, DEFAULT_GRID_SETTINGS.cellHeight),
      tilePadding: boundedInt(value.tilePadding, 0, 24, DEFAULT_GRID_SETTINGS.tilePadding),
      tileGap: boundedInt(value.tileGap, 0, 24, DEFAULT_GRID_SETTINGS.tileGap)
    };
  }

  function desktopColumnCount() {
    return activeGridSettings.columns;
  }

  function layoutViewportWidth() {
    var widths = [];
    var doc = document.documentElement;
    if (doc && Number.isFinite(doc.clientWidth) && doc.clientWidth > 0) {
      widths.push(doc.clientWidth);
    }
    var gridEl = document.getElementById("joeGrid");
    if (gridEl && Number.isFinite(gridEl.clientWidth) && gridEl.clientWidth > 0) {
      widths.push(gridEl.clientWidth);
    }
    if (window.visualViewport && Number.isFinite(window.visualViewport.width) && window.visualViewport.width > 0) {
      widths.push(window.visualViewport.width);
    }
    if (widths.length) {
      return Math.min.apply(Math, widths);
    }
    return window.innerWidth;
  }

  function isNarrowGridViewport() {
    return layoutViewportWidth() <= NARROW_BREAKPOINT;
  }

  function columnOptsFor(columns) {
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    return {
      breakpoints: [{ w: NARROW_BREAKPOINT, c: 1 }],
      layout: "list",
      columnMax: cols
    };
  }

  function narrowGridRowPixels(settings) {
    if (typeof grid !== "undefined" && grid && typeof grid.getCellHeight === "function") {
      var live = grid.getCellHeight();
      if (Number.isFinite(live) && live > 0) { return live; }
    }
    return sanitizeGridSettings(settings).cellHeight;
  }

  function narrowGridTilePixels(rows, settings) {
    if (!Number.isFinite(rows) || rows <= 0) { return 0; }
    return rows * narrowGridRowPixels(settings);
  }

  function narrowRowsForOuterPixels(outerPixels, settings) {
    var clean = sanitizeGridSettings(settings);
    var needed = Math.max(0, Math.ceil(outerPixels));
    var rows = 1;
    while (rows < 48 && narrowGridTilePixels(rows, clean) < needed) {
      rows += 1;
    }
    return rows;
  }

  function narrowChromeForTile(id, settings) {
    var pad = sanitizeGridSettings(settings).tilePadding * 2;
    if (id === "hero") { return pad; }
    return pad + NARROW_WIDGET_DRAG_PX;
  }

  function narrowOuterPixelsForContent(id, contentPixels, settings) {
    return Math.ceil(contentPixels) + narrowChromeForTile(id, settings);
  }

  function narrowMeasureElement(itemEl, id) {
    if (!itemEl) { return null; }
    if (id.indexOf("desk-") === 0) { return itemEl.querySelector(".desk-slot"); }
    if (id === "hero") { return itemEl.querySelector(".hero-widget"); }
    if (id === "attribution") { return itemEl.querySelector(".widget-body"); }
    if (id === "history") { return itemEl.querySelector(".history-widget"); }
    if (id === "positions") { return itemEl.querySelector(".positions-widget"); }
    return itemEl.querySelector(".grid-stack-item-content");
  }

  function narrowTileHeight(id, settings) {
    var clean = sanitizeGridSettings(settings);
    var baseRows = NARROW_TILE_MIN_ROWS[id] || 4;
    var minContent = NARROW_TILE_MIN_PIXELS[id] || narrowGridTilePixels(baseRows, clean) - narrowChromeForTile(id, clean);
    var outerPixels = narrowOuterPixelsForContent(id, minContent, clean);
    return Math.max(baseRows, narrowRowsForOuterPixels(outerPixels, clean));
  }

  function scheduleNarrowFit(pass) {
    if (!grid || !isNarrowGridViewport()) { return; }
    var nextPass = pass || 0;
    if (nextPass >= NARROW_FIT_MAX_PASSES) { return; }
    if (narrowFitFrame) { cancelAnimationFrame(narrowFitFrame); }
    narrowFitFrame = requestAnimationFrame(function () {
      narrowFitFrame = 0;
      fitNarrowLayoutToContent(nextPass);
    });
  }

  function fitNarrowLayoutToContent(pass) {
    if (!grid || !isNarrowGridViewport() || restoringLayout) { return false; }
    var settings = activeGridSettings;
    var nodes = grid.engine && grid.engine.nodes ? grid.engine.nodes.slice() : [];
    if (!nodes.length) { return false; }
    var items = nodes.map(function (node) {
      return { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h };
    }).sort(function (a, b) {
      if (a.y !== b.y) { return a.y - b.y; }
      return a.x - b.x;
    });
    var changed = false;
    items = items.map(function (item) {
      var itemEl = document.querySelector('#joeGrid [gs-id="' + item.id + '"]');
      var measureEl = narrowMeasureElement(itemEl, item.id);
      var contentPixels = measureEl ? Math.ceil(measureEl.scrollHeight) : 0;
      var minContent = NARROW_TILE_MIN_PIXELS[item.id] || 0;
      if (contentPixels < minContent) { contentPixels = minContent; }
      var needRows = Math.max(
        NARROW_TILE_MIN_ROWS[item.id] || 4,
        narrowRowsForOuterPixels(narrowOuterPixelsForContent(item.id, contentPixels, settings), settings)
      );
      if (needRows > item.h) {
        changed = true;
        return Object.assign({}, item, { h: needRows });
      }
      return item;
    });
    if (!changed) { return false; }
    var y = 0;
    var stacked = items.map(function (item) {
      var next = { id: item.id, x: 0, y: y, w: 1, h: item.h };
      y += next.h;
      return next;
    });
    restoringLayout = true;
    grid.load(stacked, false);
    restoringLayout = false;
    if ((pass || 0) + 1 < NARROW_FIT_MAX_PASSES) { scheduleNarrowFit((pass || 0) + 1); }
    return true;
  }

  function narrowLayoutFromItems(items, settings) {
    if (!Array.isArray(items)) { return null; }
    var sorted = items.slice().sort(function (a, b) {
      if (a.y !== b.y) { return a.y - b.y; }
      return a.x - b.x;
    });
    var y = 0;
    return sorted.map(function (item) {
      var h = narrowTileHeight(item.id, settings || activeGridSettings);
      var next = { id: item.id, x: 0, y: y, w: 1, h: h };
      y += h;
      return next;
    });
  }

  function rememberDesktopLayout(items) {
    var cols = desktopColumnCount();
    var clean = sanitizeLayoutItems(items, cols);
    if (!clean) { return null; }
    cachedDesktopLayout = clean;
    return clean;
  }

  function desktopLayoutSnapshot() {
    var cols = desktopColumnCount();
    if (cachedDesktopLayout && sanitizeLayoutItems(cachedDesktopLayout, cols)) {
      return cachedDesktopLayout.map(function (item) {
        return { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
      });
    }
    return safeStoredLayout();
  }

  function persistDesktopItems(items) {
    var clean = rememberDesktopLayout(items);
    if (!clean) { return false; }
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(clean));
    } catch (_) { /* private browsing may reject storage */ }
    return true;
  }

  function loadNarrowGridLayout(desktopItems) {
    var narrowItems = narrowLayoutFromItems(desktopItems, activeGridSettings);
    if (!narrowItems || !grid) { return false; }
    restoringLayout = true;
    if (typeof grid.checkDynamicColumn === "function") { grid.checkDynamicColumn(); }
    grid.load(narrowItems, false);
    restoringLayout = false;
    scheduleNarrowFit(0);
    return true;
  }

  function restoreDesktopGridLayout(columns) {
    if (!grid) { return; }
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    var desktop = desktopLayoutSnapshot() || DEFAULT_LAYOUT.slice();
    restoringLayout = true;
    if (grid.getColumn() !== cols) {
      grid.column(cols, "moveScale");
    }
    grid.load(desktop, false);
    restoringLayout = false;
    narrowGridActive = false;
  }

  function syncViewportDataset() {
    document.documentElement.dataset.joeViewport = isNarrowGridViewport() ? "narrow" : "desktop";
  }

  function syncLayoutViewport() {
    syncViewportDataset();
    positionHeaderMenus();
    if (grid) {
      syncGridColumnConfig(desktopColumnCount());
    }
  }

  function scheduleViewportSync() {
    if (viewportSyncFrame) { cancelAnimationFrame(viewportSyncFrame); }
    viewportSyncFrame = requestAnimationFrame(function () {
      viewportSyncFrame = 0;
      syncLayoutViewport();
    });
  }

  function scheduleViewportSettle() {
    requestAnimationFrame(function () {
      syncLayoutViewport();
      requestAnimationFrame(function () {
        syncLayoutViewport();
      });
    });
  }

  function syncGridColumnConfig(columns) {
    if (!grid) { return; }
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    var onNarrow = isNarrowGridViewport();
    grid.opts.columnOpts = columnOptsFor(cols);
    if (onNarrow) {
      if (!narrowGridActive) {
        persistDesktopLayoutGeometry(cols);
        narrowGridActive = true;
      }
      if (typeof grid.checkDynamicColumn === "function") { grid.checkDynamicColumn(); }
      var stored = desktopLayoutSnapshot() || DEFAULT_LAYOUT.slice();
      loadNarrowGridLayout(stored);
      return;
    }
    if (narrowGridActive) {
      restoreDesktopGridLayout(cols);
      return;
    }
    if (grid.getColumn() !== cols) {
      grid.column(cols, "moveScale");
    }
  }

  function gridColumnCount() {
    return grid ? grid.getColumn() : null;
  }

  function layoutItemsFromGrid(cols) {
    if (!grid) { return null; }
    return sanitizeLayoutItems(grid.save(false, false, undefined, cols).map(function (item) {
      return { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
    }), cols);
  }

  function captureDesktopGridLayout(cols) {
    if (!grid) { return sanitizeLayoutItems(DEFAULT_LAYOUT.slice(), cols); }
    var previousCols = grid.getColumn();
    var items = null;
    restoringLayout = true;
    grid.opts.columnOpts = columnOptsFor(cols);
    if (previousCols !== cols) {
      grid.column(cols, "moveScale");
    }
    items = layoutItemsFromGrid(cols);
    if (previousCols !== cols) {
      grid.column(previousCols, previousCols === 1 ? "list" : "moveScale");
      grid.opts.columnOpts = columnOptsFor(desktopColumnCount());
    }
    restoringLayout = false;
    return items;
  }

  function persistDesktopLayoutGeometry(cols) {
    var saved = captureDesktopGridLayout(cols);
    if (!saved) { return false; }
    rememberDesktopLayout(saved);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved));
    } catch (_) { /* private browsing may reject storage */ }
    return true;
  }

  function catalogContainsEntry(catalog, entryId) {
    return Boolean(catalog && catalog.layouts.some(function (entry) { return entry.id === entryId; }));
  }

  function writeNamedLayoutsCatalog(catalog, entryId) {
    if (!writeLayoutsCatalog(catalog)) {
      return false;
    }
    return catalogContainsEntry(readLayoutsCatalog(), entryId);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function deskColor(deskId) {
    var map = { j: "--desk-j", joe: "--desk-joe", joel: "--desk-joel" };
    return cssVar(map[deskId]) || "#888888";
  }

  function readActiveGridSettings() {
    try {
      return sanitizeGridSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)));
    } catch (_) {
      return Object.assign({}, DEFAULT_GRID_SETTINGS);
    }
  }

  function writeActiveGridSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeGridSettings(settings)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyTilePadding(padding) {
    document.documentElement.style.setProperty("--joe-tile-padding", padding + "px");
  }

  function applyGridSettings(settings, skipPersist) {
    var clean = sanitizeGridSettings(settings);
    activeGridSettings = clean;
    applyTilePadding(clean.tilePadding);
    if (grid) {
      grid.opts.columnOpts = columnOptsFor(clean.columns);
      grid.cellHeight(clean.cellHeight);
      grid.margin(clean.tileGap);
      syncGridColumnConfig(clean.columns);
    }
    if (!skipPersist && !writeActiveGridSettings(clean)) {
      setLayoutStatus("Settings storage is unavailable.", true);
      resizeVisuals();
      if (historyState.chart) { drawHistory(); }
      return false;
    }
    if (isNarrowGridViewport()) {
      persistDesktopLayoutGeometry(clean.columns);
    }
    resizeVisuals();
    if (historyState.chart) { drawHistory(); }
    return true;
  }

  function readStoredThemeMode() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      return THEME_MODES.includes(stored) ? stored : "dark";
    } catch (_) {
      return "dark";
    }
  }

  function readThemeMode() {
    return activeThemeMode;
  }

  function resolveTheme(mode) {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return mode === "light" ? "light" : "dark";
  }

  function applyTheme(mode, skipPersist) {
    var clean = THEME_MODES.includes(mode) ? mode : "dark";
    activeThemeMode = clean;
    document.documentElement.dataset.themeMode = clean;
    document.documentElement.dataset.theme = resolveTheme(clean);
    if (!skipPersist) {
      try {
        localStorage.setItem(THEME_KEY, clean);
      } catch (_) {
        return false;
      }
    }
    if (historyState.chart) { drawHistory(); }
    drawSparklines();
    return true;
  }

  function populateSettingsForm(settings, themeMode) {
    if (settingsFormDirty) { return; }
    var clean = sanitizeGridSettings(settings);
    document.getElementById("settingsColumns").value = String(clean.columns);
    document.getElementById("settingsCellHeight").value = String(clean.cellHeight);
    document.getElementById("settingsTilePadding").value = String(clean.tilePadding);
    document.getElementById("settingsTileGap").value = String(clean.tileGap);
    var mode = THEME_MODES.includes(themeMode) ? themeMode : activeThemeMode;
    document.getElementById("themeLight").checked = mode === "light";
    document.getElementById("themeDark").checked = mode === "dark";
    document.getElementById("themeSystem").checked = mode === "system";
  }

  function readSettingsField(id, current, min, max) {
    var value = document.getElementById(id).value;
    if (value === "") { return current; }
    return boundedInt(value, min, max, current);
  }

  function readSettingsFromForm() {
    return sanitizeGridSettings({
      columns: Number(document.getElementById("settingsColumns").value),
      cellHeight: readSettingsField("settingsCellHeight", activeGridSettings.cellHeight, 48, 140),
      tilePadding: readSettingsField("settingsTilePadding", activeGridSettings.tilePadding, 0, 24),
      tileGap: readSettingsField("settingsTileGap", activeGridSettings.tileGap, 0, 24)
    });
  }

  function readThemeFromForm() {
    var selected = document.querySelector('input[name="themeMode"]:checked');
    return selected && THEME_MODES.includes(selected.value) ? selected.value : activeThemeMode;
  }

  function positionHeaderMenus() {
    if (!isNarrowGridViewport()) {
      document.documentElement.style.removeProperty("--joe-header-bottom");
      return;
    }
    var header = document.querySelector(".topline");
    if (!header) { return; }
    var bottom = Math.ceil(header.getBoundingClientRect().bottom + 8);
    document.documentElement.style.setProperty("--joe-header-bottom", bottom + "px");
  }

  function desktopDeskDefaultRows() {
    return DESKTOP_DESK_DEFAULT_ROWS;
  }

  function layoutItemsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) { return false; }
    var byId = {};
    var i;
    for (i = 0; i < right.length; i += 1) {
      byId[right[i].id] = right[i];
    }
    for (i = 0; i < left.length; i += 1) {
      var item = left[i];
      var other = byId[item.id];
      if (!other || item.x !== other.x || item.y !== other.y || item.w !== other.w || item.h !== other.h) {
        return false;
      }
    }
    return true;
  }

  function migrateLegacyDefaultLayout(items) {
    if (layoutItemsEqual(items, LEGACY_DEFAULT_LAYOUT) || layoutItemsEqual(items, LEGACY_DEFAULT_LAYOUT_V2)) {
      return DEFAULT_LAYOUT.slice();
    }
    return items;
  }

  function sanitizeLayoutItems(value, columns) {
    if (!Array.isArray(value)) { return null; }
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    var requiredIds = DEFAULT_LAYOUT.map(function (item) { return item.id; });
    if (value.length !== requiredIds.length) { return null; }
    var allowed = new Set(requiredIds);
    var seen = new Set();
    var clean = [];
    var i;
    for (i = 0; i < value.length; i += 1) {
      var item = value[i];
      if (!item || !allowed.has(item.id) || seen.has(item.id)) { return null; }
      var x = layoutCoordinate(item.x, 0, cols - 1);
      var y = layoutCoordinate(item.y, 0, 999);
      var w = layoutCoordinate(item.w, 1, cols);
      var h = layoutCoordinate(item.h, 2, 24);
      if (x === null || y === null || w === null || h === null || x + w > cols) { return null; }
      seen.add(item.id);
      clean.push({ id: item.id, x: x, y: y, w: w, h: h });
    }
    if (seen.size !== requiredIds.length) { return null; }
    return clean;
  }

  function safeStoredLayout() {
    try {
      var parsed = sanitizeLayoutItems(JSON.parse(localStorage.getItem(LAYOUT_KEY)), desktopColumnCount());
      if (!parsed) { return null; }
      var migrated = migrateLegacyDefaultLayout(parsed);
      if (!layoutItemsEqual(migrated, parsed)) {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(migrated)); } catch (_) {}
      }
      return migrated;
    } catch (_) {
      return null;
    }
  }

  function defaultLayoutEntry() {
    return {
      id: DEFAULT_LAYOUT_ID,
      name: "Default",
      items: DEFAULT_LAYOUT.slice(),
      settings: Object.assign({}, DEFAULT_GRID_SETTINGS),
      builtin: true
    };
  }

  function defaultLayoutsCatalog() {
    return { schema: "inspr.joe.layouts.v1", layouts: [defaultLayoutEntry()] };
  }

  function normalizeLayoutEntry(entry) {
    if (!entry || typeof entry !== "object") { return null; }
    var id = typeof entry.id === "string" && entry.id.length ? entry.id.slice(0, 64) : null;
    var name = typeof entry.name === "string" && entry.name.trim().length ? entry.name.trim().slice(0, 48) : null;
    if (!id || !name) { return null; }
    if (id === DEFAULT_LAYOUT_ID) {
      return defaultLayoutEntry();
    }
    var settings = sanitizeGridSettings(entry.settings);
    var items = sanitizeLayoutItems(entry.items, settings.columns);
    if (!items) { return null; }
    return { id: id, name: name, items: items, settings: settings, builtin: false };
  }

  function canonicalLayoutsCatalog(layouts) {
    var seen = new Set();
    var normalized = layouts.map(normalizeLayoutEntry).filter(function (entry) {
      if (!entry || seen.has(entry.id)) { return false; }
      seen.add(entry.id);
      return true;
    });
    normalized = normalized.filter(function (entry) { return entry.id !== DEFAULT_LAYOUT_ID; });
    normalized.unshift(defaultLayoutEntry());
    return { schema: "inspr.joe.layouts.v1", layouts: normalized };
  }

  function readLayoutsCatalog() {
    try {
      var raw = JSON.parse(localStorage.getItem(LAYOUTS_KEY));
      if (!raw || raw.schema !== "inspr.joe.layouts.v1" || !Array.isArray(raw.layouts)) {
        return defaultLayoutsCatalog();
      }
      return canonicalLayoutsCatalog(raw.layouts);
    } catch (_) {
      return defaultLayoutsCatalog();
    }
  }

  function writeLayoutsCatalog(catalog) {
    if (!catalog || catalog.schema !== "inspr.joe.layouts.v1" || !Array.isArray(catalog.layouts)) {
      return false;
    }
    if (catalog.layouts.length > MAX_LAYOUTS) {
      return false;
    }
    try {
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(canonicalLayoutsCatalog(catalog.layouts)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function setLayoutStatus(message, isError) {
    var node = document.getElementById("layoutStatus");
    if (!node) { return; }
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError));
  }

  function currentGridLayout() {
    var cols = desktopColumnCount();
    if (!grid) { return DEFAULT_LAYOUT.slice(); }
    if (!isNarrowGridViewport()) {
      var live = layoutItemsFromGrid(cols);
      return live || DEFAULT_LAYOUT.slice();
    }
    var stored = desktopLayoutSnapshot();
    if (stored && sanitizeLayoutItems(stored, cols)) {
      return stored;
    }
    var captured = captureDesktopGridLayout(cols);
    return captured || DEFAULT_LAYOUT.slice();
  }

  function applyGridLayout(items) {
    if (!grid) { return false; }
    var clean = sanitizeLayoutItems(items, desktopColumnCount());
    if (!clean) { return false; }
    if (isNarrowGridViewport()) {
      persistDesktopItems(clean);
      loadNarrowGridLayout(clean);
    } else {
      restoringLayout = true;
      grid.load(clean, false);
      restoringLayout = false;
      saveLayout();
    }
    resizeVisuals();
    return true;
  }

  function updateLayoutControlState() {
    var select = document.getElementById("layoutSelect");
    if (!select) { return; }
    if (!grid) {
      setLayoutToolbarEnabled(false);
      document.getElementById("resetLayout").disabled = true;
      return;
    }
    setLayoutToolbarEnabled(true);
    var catalog = readLayoutsCatalog();
    var selected = catalog.layouts.find(function (entry) { return entry.id === select.value; });
    document.getElementById("deleteLayout").disabled = !selected || selected.builtin;
    document.getElementById("renameLayout").disabled = !selected || selected.builtin;
  }

  function setLayoutToolbarEnabled(enabled) {
    var toolbar = document.getElementById("layoutToolbar");
    if (!toolbar) { return; }
    toolbar.querySelectorAll("button, select, input").forEach(function (node) {
      node.disabled = !enabled;
    });
  }

  function renderLayoutSelect(selectedId) {
    var select = document.getElementById("layoutSelect");
    if (!select) { return; }
    var catalog = readLayoutsCatalog();
    var current = selectedId || select.value;
    select.replaceChildren.apply(select, catalog.layouts.map(function (entry) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.name;
      return option;
    }));
    if (catalog.layouts.some(function (entry) { return entry.id === current; })) {
      select.value = current;
    } else {
      select.value = DEFAULT_LAYOUT_ID;
    }
    updateLayoutControlState();
  }

  function hideLayoutForm() {
    layoutFormMode = null;
    document.getElementById("layoutInlineForm").hidden = true;
    document.getElementById("layoutNameInput").value = "";
  }

  function showLayoutForm(mode) {
    if (!grid) { return; }
    layoutFormMode = mode;
    var input = document.getElementById("layoutNameInput");
    var select = document.getElementById("layoutSelect");
    var catalog = readLayoutsCatalog();
    var selected = catalog.layouts.find(function (entry) { return entry.id === select.value; });
    input.value = mode === "rename" && selected ? selected.name : "";
    document.getElementById("layoutInlineForm").hidden = false;
    input.focus();
    input.select();
  }

  function uniqueLayoutId(name) {
    var base = String(name || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "layout";
    var catalog = readLayoutsCatalog();
    var candidate = base;
    var suffix = 2;
    while (catalog.layouts.some(function (entry) { return entry.id === candidate; })) {
      candidate = base + "-" + suffix;
      suffix += 1;
    }
    return candidate.slice(0, 64);
  }

  function saveNamedLayout(name) {
    if (!grid) { return false; }
    var trimmed = String(name || "").trim();
    if (!trimmed) {
      setLayoutStatus("Enter a layout name.", true);
      return false;
    }
    var catalog = readLayoutsCatalog();
    if (catalog.layouts.length >= MAX_LAYOUTS) {
      setLayoutStatus("Layout catalog is full (" + MAX_LAYOUTS + " saved layouts). Delete one before saving.", true);
      return false;
    }
    var settings = Object.assign({}, activeGridSettings);
    var items = sanitizeLayoutItems(currentGridLayout(), settings.columns);
    if (!items) {
      setLayoutStatus("That layout could not be saved with the current grid settings.", true);
      return false;
    }
    var entry = {
      id: uniqueLayoutId(trimmed),
      name: trimmed,
      items: items,
      settings: settings,
      builtin: false
    };
    catalog.layouts.push(entry);
    if (!writeNamedLayoutsCatalog(catalog, entry.id)) {
      setLayoutStatus("That layout could not be saved.", true);
      return false;
    }
    renderLayoutSelect(entry.id);
    hideLayoutForm();
    setLayoutStatus('Saved layout "' + trimmed + '".');
    return true;
  }

  function renameSelectedLayout(name) {
    if (!grid) { return false; }
    var trimmed = String(name || "").trim();
    if (!trimmed) {
      setLayoutStatus("Enter a layout name.", true);
      return false;
    }
    var select = document.getElementById("layoutSelect");
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === select.value; });
    if (!entry || entry.builtin) {
      setLayoutStatus("The default layout cannot be renamed.", true);
      return false;
    }
    entry.name = trimmed;
    if (!writeLayoutsCatalog(catalog)) {
      setLayoutStatus("Layout storage is unavailable.", true);
      return false;
    }
    renderLayoutSelect(entry.id);
    hideLayoutForm();
    setLayoutStatus('Renamed layout to "' + trimmed + '".');
    return true;
  }

  function loadSelectedLayout() {
    if (!grid) { return false; }
    var select = document.getElementById("layoutSelect");
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === select.value; });
    if (!entry) {
      setLayoutStatus("Choose a saved layout.", true);
      return false;
    }
    if (entry.settings) { applyGridSettings(entry.settings); }
    if (!applyGridLayout(entry.items)) {
      setLayoutStatus("That layout could not be loaded.", true);
      return false;
    }
    setLayoutStatus('Loaded layout "' + entry.name + '".');
    return true;
  }

  function deleteSelectedLayout() {
    if (!grid) { return false; }
    var select = document.getElementById("layoutSelect");
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === select.value; });
    if (!entry || entry.builtin) {
      setLayoutStatus("The default layout cannot be deleted.", true);
      return false;
    }
    catalog.layouts = catalog.layouts.filter(function (item) { return item.id !== entry.id; });
    if (!writeLayoutsCatalog(catalog)) {
      setLayoutStatus("Layout storage is unavailable.", true);
      return false;
    }
    renderLayoutSelect(DEFAULT_LAYOUT_ID);
    setLayoutStatus('Deleted layout "' + entry.name + '".');
    return true;
  }

  function bindLayoutControls() {
    renderLayoutSelect();
    document.getElementById("layoutSelect").addEventListener("change", updateLayoutControlState);
    document.getElementById("saveLayout").addEventListener("click", function () { showLayoutForm("save"); });
    document.getElementById("renameLayout").addEventListener("click", function () { showLayoutForm("rename"); });
    document.getElementById("loadLayout").addEventListener("click", loadSelectedLayout);
    document.getElementById("deleteLayout").addEventListener("click", deleteSelectedLayout);
    document.getElementById("layoutFormCancel").addEventListener("click", hideLayoutForm);
    document.getElementById("layoutFormConfirm").addEventListener("click", function () {
      var name = document.getElementById("layoutNameInput").value;
      if (layoutFormMode === "rename") { renameSelectedLayout(name); }
      else { saveNamedLayout(name); }
    });
    document.getElementById("layoutNameInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("layoutFormConfirm").click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hideLayoutForm();
      }
    });
  }

  function renderVersionPanel() {
    var version = window.JoeVersion || { APP_VERSION: "0.2.0", VERSION_HISTORY: [] };
    document.getElementById("appVersion").textContent = version.APP_VERSION;
    var panel = document.getElementById("versionPanel");
    panel.replaceChildren.apply(panel, version.VERSION_HISTORY.map(function (entry) {
      var section = el("section", "version__entry");
      var heading = el("h3");
      heading.appendChild(document.createTextNode(entry.version === "unversioned milestone" ? "Unversioned milestone" : "v" + entry.version));
      heading.appendChild(el("span", "", entry.date));
      section.appendChild(heading);
      section.appendChild(el("p", "version__title", entry.title));
      var list = el("ul");
      entry.changes.forEach(function (change) { list.appendChild(el("li", "", change)); });
      section.appendChild(list);
      return section;
    }));
  }

  function bindDismissableDetails() {
    document.addEventListener("click", function (event) {
      document.querySelectorAll("details[data-dismissable][open]").forEach(function (open) {
        if (event.target instanceof Node && !open.contains(event.target)) {
          if (open.matches("[data-settings-menu]")) {
            settingsFormDirty = false;
            populateSettingsForm(activeGridSettings, readThemeMode());
          }
          open.removeAttribute("open");
        }
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") { return; }
      document.querySelectorAll("details[data-dismissable][open]").forEach(function (open) {
        if (open.matches("[data-settings-menu]")) {
          settingsFormDirty = false;
          populateSettingsForm(activeGridSettings, readThemeMode());
        }
        open.removeAttribute("open");
      });
    });
    document.querySelectorAll("details[data-settings-menu]").forEach(function (menu) {
      menu.addEventListener("toggle", function () {
        if (menu.open) {
          positionHeaderMenus();
          if (!settingsFormDirty) { populateSettingsForm(activeGridSettings, activeThemeMode); }
        } else {
          settingsFormDirty = false;
        }
      });
    });
    document.querySelectorAll("details.header-menu").forEach(function (menu) {
      menu.addEventListener("toggle", function () {
        if (menu.open) { positionHeaderMenus(); }
      });
    });
  }

  function bindSettingsControls() {
    var menu = document.getElementById("settingsMenu");
    menu.querySelectorAll("input, select").forEach(function (node) {
      node.addEventListener("input", function () { settingsFormDirty = true; });
      node.addEventListener("change", function () { settingsFormDirty = true; });
    });
    document.getElementById("settingsApply").addEventListener("click", function () {
      var nextSettings = readSettingsFromForm();
      var nextTheme = readThemeFromForm();
      var settingsOk = applyGridSettings(nextSettings);
      var themeOk = applyTheme(nextTheme);
      settingsFormDirty = false;
      populateSettingsForm(activeGridSettings, activeThemeMode);
      if (settingsOk && themeOk) {
        menu.removeAttribute("open");
        setLayoutStatus("Board settings applied.");
      } else if (!settingsOk && !themeOk) {
        setLayoutStatus("Settings applied for this session but storage is unavailable.", true);
      } else if (!themeOk) {
        setLayoutStatus("Theme applied for this session but storage is unavailable.", true);
      }
    });
    document.getElementById("settingsCancel").addEventListener("click", function () {
      settingsFormDirty = false;
      populateSettingsForm(activeGridSettings, readThemeMode());
      menu.removeAttribute("open");
    });
    var media = window.matchMedia("(prefers-color-scheme: light)");
    var onSystemThemeChange = function () {
      if (activeThemeMode === "system") { applyTheme("system", true); }
    };
    if (media.addEventListener) { media.addEventListener("change", onSystemThemeChange); }
    else { media.addListener(onSystemThemeChange); }
  }

  function initTheme() {
    activeThemeMode = readStoredThemeMode();
    applyTheme(activeThemeMode, true);
  }

  function saveLayout() {
    if (!grid || restoringLayout || isNarrowGridViewport()) { return; }
    var cols = desktopColumnCount();
    var saved = layoutItemsFromGrid(cols);
    if (!saved) { return; }
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved)); } catch (_) { /* private browsing may reject storage */ }
  }

  function initGrid() {
    activeGridSettings = readActiveGridSettings();
    applyTilePadding(activeGridSettings.tilePadding);
    if (!window.GridStack) {
      document.getElementById("joeGrid").classList.add("grid-fallback");
      document.getElementById("resetLayout").disabled = true;
      setLayoutToolbarEnabled(false);
      return;
    }
    grid = window.GridStack.init({
      column: activeGridSettings.columns,
      columnOpts: columnOptsFor(activeGridSettings.columns),
      cellHeight: activeGridSettings.cellHeight,
      margin: activeGridSettings.tileGap,
      float: false,
      handle: ".widget-drag",
      resizable: { handles: "e,se,s,sw,w" }
    }, "#joeGrid");
    var stored = safeStoredLayout();
    restoringLayout = true;
    grid.load(stored || DEFAULT_LAYOUT.slice(), false);
    restoringLayout = false;
    syncGridColumnConfig(activeGridSettings.columns);
    scheduleViewportSettle();
    grid.on("change dragstop resizestop", saveLayout);
    grid.on("resizestop", function () { resizeVisuals(); });
    document.getElementById("resetLayout").addEventListener("click", function () {
      try { localStorage.removeItem(LAYOUT_KEY); } catch (_) { /* storage unavailable */ }
      applyGridSettings(defaultLayoutEntry().settings, false);
      applyGridLayout(DEFAULT_LAYOUT);
      writeActiveGridSettings(activeGridSettings);
      setLayoutStatus("Reset to default layout with taller desk tiles for learning and timeline content.");
    });
  }

  function ageInSeconds(iso) {
    var parsed = Date.parse(iso || "");
    return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : null;
  }

  function ageLabel(seconds) {
    if (!Number.isFinite(seconds)) { return "unknown"; }
    if (seconds < 60) { return seconds + "s"; }
    if (seconds < 3600) { return Math.floor(seconds / 60) + "m"; }
    return Math.floor(seconds / 3600) + "h";
  }

  // HOSTD-33 / Wave D: Day P&L stays unavailable in Stage 0 until producer contract lands.
  function dayPnlDisplayValue() {
    return null;
  }

  function daysInMonth(year, month) {
    if (month === 2) {
      var leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function validIsoTimestamp(iso) {
    if (typeof iso !== "string" || !iso.length) { return false; }
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(iso);
    if (!match) { return false; }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4]);
    var minute = Number(match[5]);
    var second = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) { return false; }
    if (hour > 23 || minute > 59 || second > 59) { return false; }
    if (match[8] === "Z") { return true; }
    var offsetHours = Number(match[10]);
    var offsetMinutes = Number(match[11]);
    return offsetHours <= 14 && offsetMinutes <= 59 && (offsetHours < 14 || offsetMinutes === 0);
  }

  function gatewayHeartbeatAge(data) {
    var gateway = data && data.safety && data.safety.gateway;
    var lastSeen = gateway && gateway.lastSeenAt;
    if (!validIsoTimestamp(lastSeen)) { return null; }
    return ageInSeconds(lastSeen);
  }

  function snapshotProblems(data, snapshotAge) {
    var problems = [];
    if (!data) { return problems; }
    var gateway = data.safety.gateway;
    if (data.safety.halt) { problems.push("HALT is on" + (data.safety.haltReason ? ": " + data.safety.haltReason : ".")); }
    if (gateway.status !== "ok") { problems.push("Gateway is " + gateway.status + (gateway.detail ? ": " + gateway.detail : ".")); }
    if (snapshotAge > data.safety.staleAfterSeconds) { problems.push("The snapshot is stale (" + snapshotAge + " seconds old)."); }
    data.desks.forEach(function (desk) { if (desk.state === "stuck") { problems.push(desk.label + " is stuck: " + desk.action); } });
    return problems;
  }

  function applyAttentionState(problems) {
    var alarm = document.getElementById("alarm");
    alarm.hidden = problems.length === 0;
    document.getElementById("alarmText").textContent = problems.join(" ");
    document.documentElement.dataset.joeState = problems.length ? "attention" : "ok";
  }

  function setMoneyField(node, value, signed, fieldKind) {
    if (fieldKind === "day") {
      node.textContent = "—";
      node.classList.remove("positive", "negative");
      node.classList.add("neutral");
      node.title = "Day P&L is not available yet.";
      return;
    }
    node.title = "";
    setMoney(node, value, signed);
  }

  function labelPaperCapital() {
    var heroLabels = document.querySelectorAll(".hero-values .hero-stat .label");
    if (heroLabels[0]) { heroLabels[0].textContent = "Virt net · paper"; }
    if (heroLabels[1]) { heroLabels[1].textContent = "Day"; }
    if (heroLabels[2]) { heroLabels[2].textContent = "Open"; }
    if (heroLabels[3]) { heroLabels[3].textContent = "Snapshot age"; }
  }

  function deskFreshnessFooter(desk, snapshotAge, snapshotStale, gatewayDown, staleAfterSeconds) {
    var heartbeatIso = desk.heartbeatAt || null;
    var heartbeatAge = validIsoTimestamp(heartbeatIso) ? ageInSeconds(heartbeatIso) : null;
    var offline = gatewayDown || (heartbeatIso && Number.isFinite(heartbeatAge) && heartbeatAge > staleAfterSeconds);
    var stale = !offline && snapshotStale;
    return {
      text: heartbeatIso
        ? "Heartbeat " + ageLabel(heartbeatAge) + " ago"
        : "Snapshot " + ageLabel(snapshotAge) + " ago",
      offline: offline,
      stale: stale
    };
  }

  function updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale) {
    var freshValue = document.getElementById("freshValue");
    freshValue.textContent = (snapshotStale ? "STALE · " : "Fresh · ") + ageLabel(snapshotAge);
    freshValue.className = snapshotStale ? "negative" : "positive";
    var gateway = data.safety.gateway;
    var gatewayAge = gatewayHeartbeatAge(data);
    var gatewayText = gateway.status === "ok" ? "OK · connected" : gateway.status.toUpperCase();
    if (Number.isFinite(gatewayAge)) {
      gatewayText += " · gateway seen " + ageLabel(gatewayAge) + " ago";
    } else if (gateway.lastSeenAt) {
      gatewayText += " · gateway seen unknown";
    }
    setSignal("gatewaySignal", "gatewayValue", gatewayText, gateway.status === "ok" ? "good" : gateway.status === "degraded" ? "warn" : "bad");
    var updatedAt = document.getElementById("updatedAt");
    var suffix = refreshError ? " · refresh failed" : " · refreshes every 15 seconds";
    updatedAt.textContent = "Snapshot " + dateTime.format(new Date(data.generatedAt)) + " · " + ageLabel(snapshotAge) + " old" + suffix;
  }

  function updateDeskFreshnessFooters(data, snapshotAge, snapshotStale, gatewayDown) {
    data.desks.forEach(function (desk) {
      var slot = document.querySelector('[data-desk-slot="' + desk.id + '"]');
      if (!slot) { return; }
      var heartbeatEl = slot.querySelector(".desk-heartbeat");
      var badgeEl = slot.querySelector(".desk-footer .status-badge");
      if (!heartbeatEl) { return; }
      var footer = deskFreshnessFooter(desk, snapshotAge, snapshotStale, gatewayDown, data.safety.staleAfterSeconds);
      heartbeatEl.textContent = footer.text;
      heartbeatEl.className = "desk-heartbeat" + (footer.offline ? " offline" : footer.stale ? " stale" : "");
      var offline = footer.offline;
      var stale = footer.stale;
      if (badgeEl) {
        if (offline || stale) {
          badgeEl.textContent = offline ? "Offline" : "Stale";
          badgeEl.className = "status-badge " + (offline ? "offline" : "stale");
        } else {
          badgeEl.remove();
        }
      } else if (offline || stale) {
        var footerSlot = slot.querySelector(".desk-footer");
        if (footerSlot) {
          footerSlot.appendChild(el("span", "status-badge " + (offline ? "offline" : "stale"), offline ? "Offline" : "Stale"));
        }
      }
    });
  }

  function updateFreshnessTick() {
    if (!lastValidSnapshot) { return; }
    var data = lastValidSnapshot;
    var snapshotAge = ageInSeconds(data.generatedAt);
    var snapshotStale = snapshotAge > data.safety.staleAfterSeconds;
    var gatewayDown = data.safety.gateway.status === "down";
    updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale);
    updateDeskFreshnessFooters(data, snapshotAge, snapshotStale, gatewayDown);
    var problems = snapshotProblems(data, snapshotAge);
    if (refreshError) { problems.push(refreshFailureMessage(refreshError)); }
    applyAttentionState(problems);
  }

  function refreshFailureMessage(error) {
    return "Latest refresh failed; showing last valid snapshot. " + error.message;
  }

  function setSignal(id, valueId, value, signalTone) {
    document.getElementById(id).dataset.tone = signalTone;
    document.getElementById(valueId).textContent = value;
  }

  function openPnl(data) {
    if (Number.isFinite(data.totals.openPnl)) { return data.totals.openPnl; }
    var positions = collectPositions(data);
    if (positions.length && positions.every(function (position) { return Number.isFinite(position.openPnl); })) {
      return positions.reduce(function (sum, position) { return sum + position.openPnl; }, 0);
    }
    var deskValues = data.desks.map(function (desk) { return desk.money.openPnl; });
    return deskValues.every(Number.isFinite) ? deskValues.reduce(function (sum, value) { return sum + value; }, 0) : null;
  }

  function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length ? value.trim() : null;
  }

  function learningStatusLabel(status) {
    if (!status) { return "Unknown"; }
    return learningStatusCopy[status] || status;
  }

  function formatDeskLearningCopy(desk) {
    var happenedParts = [];
    var action = nonEmptyString(desk.action);
    if (action) { happenedParts.push(action); }
    if (desk.state === "stuck" && Array.isArray(desk.issues) && desk.issues.length) {
      happenedParts.push(desk.issues.join(" · "));
    }
    var headline = desk.learning ? nonEmptyString(desk.learning.headline) : null;
    var detail = desk.learning ? nonEmptyString(desk.learning.detail) : null;
    var nextParts = [];
    if (headline) { nextParts.push(headline); }
    if (detail && detail !== headline) { nextParts.push(detail); }
    if (desk.learning && Number.isFinite(desk.learning.iteration)) {
      nextParts.push("Pass " + desk.learning.iteration);
    }
    return {
      whatHappened: happenedParts.length ? happenedParts.join(" · ") : "Not supplied",
      whatNext: nextParts.length ? nextParts.join(" · ") : "Not supplied",
      statusLabel: learningStatusLabel(desk.learning && desk.learning.status)
    };
  }

  function deskTrackFields(desk) {
    return {
      state: desk.state,
      action: desk.action,
      learningStatus: desk.learning && desk.learning.status,
      learningHeadline: desk.learning && desk.learning.headline,
      learningDetail: desk.learning && desk.learning.detail,
      learningIteration: desk.learning && desk.learning.iteration,
      issuesKey: Array.isArray(desk.issues) ? desk.issues.join("|") : ""
    };
  }

  function deskTrackFieldsEqual(left, right) {
    if (!left || !right) { return false; }
    return left.state === right.state &&
      left.action === right.action &&
      left.learningStatus === right.learningStatus &&
      left.learningHeadline === right.learningHeadline &&
      left.learningDetail === right.learningDetail &&
      left.learningIteration === right.learningIteration &&
      left.issuesKey === right.issuesKey;
  }

  function readObservedEvents() {
    if (observedEventsMemory) { return observedEventsMemory; }
    try {
      var raw = localStorage.getItem(OBSERVED_EVENTS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.schema === "inspr.joe.observed-events.v1" && Array.isArray(parsed.events)) {
          observedEventsMemory = parsed;
          return observedEventsMemory;
        }
      }
    } catch (_) {}
    observedEventsMemory = { schema: "inspr.joe.observed-events.v1", events: [] };
    return observedEventsMemory;
  }

  function writeObservedEvents(store) {
    observedEventsMemory = store;
    try { localStorage.setItem(OBSERVED_EVENTS_KEY, JSON.stringify(store)); } catch (_) {}
  }

  function diffDeskToEvents(previousFields, desk, snapshotAt, sourceLabel) {
    if (!previousFields) { return []; }
    var nextFields = deskTrackFields(desk);
    if (deskTrackFieldsEqual(previousFields, nextFields)) { return []; }
    var events = [];
    if (previousFields.state !== nextFields.state) {
      events.push({
        deskId: desk.id,
        kind: "state",
        summary: "State observed as " + stateCopy[desk.state] + (desk.action ? " · " + desk.action : ""),
        snapshotAt: snapshotAt,
        sourceLabel: sourceLabel
      });
    } else if (previousFields.action !== nextFields.action) {
      events.push({
        deskId: desk.id,
        kind: "action",
        summary: desk.action,
        snapshotAt: snapshotAt,
        sourceLabel: sourceLabel
      });
    }
    if (previousFields.learningStatus !== nextFields.learningStatus ||
        previousFields.learningHeadline !== nextFields.learningHeadline ||
        previousFields.learningDetail !== nextFields.learningDetail ||
        previousFields.learningIteration !== nextFields.learningIteration) {
      var learningParts = [];
      if (nextFields.learningHeadline) { learningParts.push(nextFields.learningHeadline); }
      if (nextFields.learningDetail && nextFields.learningDetail !== nextFields.learningHeadline) {
        learningParts.push(nextFields.learningDetail);
      }
      if (Number.isFinite(nextFields.learningIteration)) {
        learningParts.push("Pass " + nextFields.learningIteration);
      }
      events.push({
        deskId: desk.id,
        kind: "learning",
        summary: learningParts.length ? learningParts.join(" · ") : "Learning update not supplied",
        snapshotAt: snapshotAt,
        sourceLabel: sourceLabel
      });
    }
    if (previousFields.issuesKey !== nextFields.issuesKey && nextFields.issuesKey) {
      events.push({
        deskId: desk.id,
        kind: "issues",
        summary: desk.issues.join(" · "),
        snapshotAt: snapshotAt,
        sourceLabel: sourceLabel
      });
    }
    return events;
  }

  function snapshotInstantMs(generatedAt) {
    var ms = Date.parse(generatedAt);
    return Number.isNaN(ms) ? null : ms;
  }

  function observeSnapshotChanges(data) {
    var sourceLabel = data.source && data.source.label ? data.source.label : "snapshot";
    var generatedAt = data.generatedAt;
    var observedAtMs = snapshotInstantMs(generatedAt);
    if (observedAtMs === null) { return; }
    if (!lastObservedSnapshot) {
      lastObservedSnapshot = { generatedAt: generatedAt, observedAtMs: observedAtMs, desks: {} };
      data.desks.forEach(function (desk) {
        lastObservedSnapshot.desks[desk.id] = deskTrackFields(desk);
      });
      return;
    }
    if (observedAtMs <= lastObservedSnapshot.observedAtMs) { return; }
    var store = readObservedEvents();
    data.desks.forEach(function (desk) {
      diffDeskToEvents(lastObservedSnapshot.desks[desk.id], desk, generatedAt, sourceLabel).forEach(function (event) {
        store.events.push(event);
      });
      lastObservedSnapshot.desks[desk.id] = deskTrackFields(desk);
    });
    lastObservedSnapshot.generatedAt = generatedAt;
    lastObservedSnapshot.observedAtMs = observedAtMs;
    if (store.events.length > MAX_OBSERVED_EVENTS) {
      store.events = store.events.slice(store.events.length - MAX_OBSERVED_EVENTS);
    }
    writeObservedEvents(store);
  }

  function deskObservedEvents(deskId) {
    return readObservedEvents().events.filter(function (event) { return event.deskId === deskId; });
  }

  function formatPctChange(value) {
    if (!Number.isFinite(value)) { return "—"; }
    var sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return sign + number.format(Math.abs(value)) + "%";
  }

  function sharedWindowCompare(points, deskIds, range) {
    if (!Array.isArray(deskIds) || deskIds.length < 2 || !Array.isArray(points) || !points.length) {
      return { ok: false, reason: "insufficient-selection" };
    }
    var filtered = filterPoints(points, range);
    if (filtered.length < 2) {
      return { ok: false, reason: "insufficient-points" };
    }
    var comparable = [];
    var latestBreak = "incomplete-coverage";
    filtered.forEach(function (point) {
      var complete = deskIds.every(function (deskId) {
        var bag = seriesBag(point, deskId);
        return bag && Number.isFinite(bag.equity);
      });
      if (!complete) {
        comparable = [];
        latestBreak = "incomplete-coverage";
        return;
      }
      if (!comparable.length) {
        comparable = [point];
        return;
      }
      var previous = comparable[comparable.length - 1];
      var basisChanged = deskIds.some(function (deskId) {
        return !compatibleAccountingBasis(previous, point, deskId);
      });
      if (basisChanged) {
        comparable = [point];
        latestBreak = "incompatible-basis";
        return;
      }
      comparable.push(point);
    });
    if (comparable.length < 2) {
      return { ok: false, reason: latestBreak, deskIds: deskIds.slice() };
    }
    var startPoint = comparable[0];
    var endPoint = comparable[comparable.length - 1];
    return {
      ok: true,
      startAt: startPoint.t,
      endAt: endPoint.t,
      pointCount: comparable.length,
      desks: deskIds.map(function (deskId) {
        var startEquity = seriesBag(startPoint, deskId).equity;
        var endEquity = seriesBag(endPoint, deskId).equity;
        var pctChange = startEquity === 0 ? null : (endEquity - startEquity) / startEquity * 100;
        return { deskId: deskId, startEquity: startEquity, endEquity: endEquity, pctChange: pctChange };
      })
    };
  }

  function deskDisplayName(deskId) {
    if (deskId === "j") { return "J"; }
    return deskId.charAt(0).toUpperCase() + deskId.slice(1);
  }

  function renderDeskTimeline(deskId) {
    var timeline = el("div", "desk-timeline");
    timeline.appendChild(el("span", "label", "Observed changes"));
    var events = deskObservedEvents(deskId);
    if (!events.length) {
      timeline.appendChild(el("p", "desk-timeline-empty", lastObservedSnapshot
        ? "Baseline recorded. Changes appear when later snapshots differ."
        : "Waiting for the first snapshot."));
      return timeline;
    }
    var list = el("ul", "desk-timeline-list");
    events.slice(-DESK_TIMELINE_LIMIT).reverse().forEach(function (event) {
      var item = el("li", "desk-timeline-item");
      item.appendChild(el("span", "desk-timeline-summary", event.summary));
      item.appendChild(el("span", "desk-timeline-meta", "Observed " + dateTime.format(new Date(event.snapshotAt)) + " · " + event.sourceLabel));
      list.appendChild(item);
    });
    timeline.appendChild(list);
    return timeline;
  }

  function renderHistoryCompare() {
    var node = document.getElementById("historyCompare");
    if (!node) { return; }
    if (historyState.selected.length < 2) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    var result = sharedWindowCompare(historyState.points, historyState.selected, historyState.range);
    if (!result.ok) {
      node.hidden = false;
      if (result.reason === "incomplete-coverage") {
        node.textContent = "Shared compare needs the same timestamps for every selected desk in this range.";
      } else if (result.reason === "incompatible-basis") {
        node.textContent = "Shared compare needs at least two points with compatible accounting bases.";
      } else if (result.reason === "insufficient-points") {
        node.textContent = "Not enough history in this range for a shared compare.";
      } else {
        node.textContent = "Select two or more desks to compare over a shared window.";
      }
      return;
    }
    var windowLabel = shortTime.format(new Date(result.startAt)) + " → " + shortTime.format(new Date(result.endAt));
    var parts = result.desks.map(function (desk) {
      return deskDisplayName(desk.deskId) + " " + formatPctChange(desk.pctChange);
    });
    node.hidden = false;
    node.textContent = "Shared window " + windowLabel + " · " + parts.join(" · ");
  }

  function renderDesk(desk, data, snapshotAge, snapshotStale, gatewayDown) {
    var slot = document.querySelector('[data-desk-slot="' + desk.id + '"]');
    var content = el("div", "desk-content");
    var top = el("div", "desk-top");
    top.appendChild(el("h2", "desk-name", desk.label));
    top.appendChild(el("span", "state state-" + desk.state, stateCopy[desk.state]));
    content.appendChild(top);

    var moneyRow = el("div", "desk-money-row");
    [
      ["Virt net · paper", desk.money.equity, false, "equity"],
      ["Day", desk.money.dayPnl, true, "day"],
      [accountingSinceLabel(desk), desk.money.totalPnl, true, "since"],
      ["Open", desk.money.openPnl, true, "open"],
      ["Trades", Number.isFinite(desk.tradeCount) ? desk.tradeCount : null, false, "trades"]
    ].forEach(function (item) {
      var cellNode = el("div", "desk-money-cell");
      cellNode.appendChild(el("span", "label", item[0]));
      var value = el("strong");
      if (item[3] === "trades") {
        value.textContent = Number.isFinite(item[1]) ? number.format(item[1]) : "—";
      } else if (item[3] === "day") {
        setMoneyField(value, item[1], item[2], "day");
      } else {
        setMoney(value, item[1], item[2]);
      }
      cellNode.appendChild(value);
      moneyRow.appendChild(cellNode);
    });
    content.appendChild(moneyRow);
    var accountingBasisNode = renderAccountingBasis(desk);
    if (accountingBasisNode) { content.appendChild(accountingBasisNode); }
    var spark = el("div", "spark-wrap");
    var canvas = el("canvas");
    canvas.dataset.spark = desk.id;
    canvas.setAttribute("aria-label", desk.label + " recent equity sparkline");
    spark.appendChild(canvas);
    content.appendChild(spark);

    var learningCopy = formatDeskLearningCopy(desk);
    var learning = el("div", "desk-learning");
    var happenedRow = el("div", "desk-learning-row");
    happenedRow.appendChild(el("span", "label", "What happened"));
    happenedRow.appendChild(el("p", "desk-learning-text", learningCopy.whatHappened));
    learning.appendChild(happenedRow);
    var nextRow = el("div", "desk-learning-row");
    nextRow.appendChild(el("span", "label", "What next · " + learningCopy.statusLabel));
    nextRow.appendChild(el("p", "desk-learning-text", learningCopy.whatNext));
    learning.appendChild(nextRow);
    content.appendChild(learning);
    content.appendChild(renderDeskTimeline(desk.id));
    if (desk.issues.length && desk.state !== "stuck") {
      content.appendChild(el("p", "issues negative", desk.issues.join(" · ")));
    }

    var footer = el("div", "desk-footer");
    var deskFooter = deskFreshnessFooter(desk, snapshotAge, snapshotStale, gatewayDown, data.safety.staleAfterSeconds);
    var heartbeat = el("span", "desk-heartbeat" + (deskFooter.offline ? " offline" : deskFooter.stale ? " stale" : ""), deskFooter.text);
    footer.appendChild(heartbeat);
    if (deskFooter.offline || deskFooter.stale) { footer.appendChild(el("span", "status-badge " + (deskFooter.offline ? "offline" : "stale"), deskFooter.offline ? "Offline" : "Stale")); }
    content.appendChild(footer);
    slot.replaceChildren(content);
  }

  function renderAttribution() {
    var root = document.getElementById("attribution");
    root.replaceChildren(el("p", "widget-note empty-attribution", "Day P&L is not available yet; attribution will appear when it is."));
  }

  function collectPositions(data) {
    var result = [];
    var topLevel = Array.isArray(data.positions) ? data.positions : null;
    if (!data || !Array.isArray(data.desks)) { return result; }
    data.desks.forEach(function (desk) {
      if (Object.prototype.hasOwnProperty.call(desk, "positions")) {
        if (!Array.isArray(desk.positions)) { return; }
        desk.positions.forEach(function (position) {
          result.push(Object.assign({ desk: desk.id }, position));
        });
        return;
      }
      if (topLevel) {
        topLevel.forEach(function (position) {
          var rowDesk = position.desk || position.deskId;
          if (rowDesk === desk.id) {
            result.push(Object.assign({}, position, { desk: desk.id }));
          }
        });
      }
    });
    return result.map(function (position) {
      return Object.assign({}, position, { desk: position.desk || position.deskId || "?" });
    }).sort(function (a, b) { return String(a.desk).localeCompare(String(b.desk)) || String(a.symbol || "").localeCompare(String(b.symbol || "")); });
  }

  function deskPositionsCoverage(deskId, data) {
    if (!data || !Array.isArray(data.desks)) { return "absent"; }
    var desk = data.desks.find(function (entry) { return entry.id === deskId; });
    if (!desk) { return "absent"; }
    if (Object.prototype.hasOwnProperty.call(desk, "positions")) {
      if (!Array.isArray(desk.positions)) { return "invalid"; }
      return desk.positions.length ? "present" : "empty";
    }
    if (!Object.prototype.hasOwnProperty.call(data, "positions")) { return "absent"; }
    if (!Array.isArray(data.positions)) { return "invalid"; }
    if (!data.positions.length) { return "empty"; }
    var rows = data.positions.filter(function (position) {
      return (position.desk || position.deskId) === deskId;
    });
    return rows.length ? "present" : "absent";
  }

  function positionsAvailability(data) {
    if (!data || typeof data !== "object") { return "absent"; }
    var coverages = DESK_IDS.map(function (deskId) { return deskPositionsCoverage(deskId, data); });
    if (coverages.every(function (state) { return state === "absent"; })) { return "absent"; }
    if (coverages.some(function (state) { return state === "invalid"; })) { return "partial"; }
    if (coverages.some(function (state) { return state === "absent"; })) { return "partial"; }
    if (collectPositions(data).length) { return "present"; }
    if (coverages.every(function (state) { return state === "empty"; })) { return "empty"; }
    return "partial";
  }

  function cell(text, className) {
    return el("td", className || "", text);
  }

  function positionsSummaryText(data) {
    var availability = positionsAvailability(data);
    if (availability === "absent") {
      return "Position detail not supplied in this snapshot";
    }
    if (availability === "partial") {
      return "Partial position coverage — some desks unavailable";
    }
    if (availability === "empty") {
      return "No open positions · complete empty coverage supplied";
    }
    var all = collectPositions(data);
    return all.length + " open position" + (all.length === 1 ? "" : "s") + " · grouped by desk";
  }

  function positionsEmptyMessage(data, filterDesk) {
    if (filterDesk !== "all") {
      var deskCoverage = deskPositionsCoverage(filterDesk, data);
      if (deskCoverage === "empty") { return "No positions for this desk."; }
      if (deskCoverage === "absent" || deskCoverage === "invalid") {
        return "Position detail not available for this desk.";
      }
      return "No positions for this desk.";
    }
    var availability = positionsAvailability(data);
    if (availability === "absent") {
      return "Position detail is not present in this snapshot. The board will populate this table when the projection adds it.";
    }
    if (availability === "partial") {
      return "Position coverage is partial — not every desk is represented in this snapshot.";
    }
    if (availability === "empty") {
      return "No open positions.";
    }
    return "No positions for this desk.";
  }

  function syncPositionsTableLayout() {
    var table = document.querySelector(".positions-widget table");
    var body = document.getElementById("positionsBody");
    if (!table || !body) { return; }
    var onlyEmpty = body.children.length === 1 && body.querySelector("td.empty-cell");
    table.classList.toggle("positions-table-empty", Boolean(onlyEmpty));
  }

  function renderPositions(data) {
    var all = collectPositions(data);
    var positions = positionFilter === "all" ? all : all.filter(function (position) { return position.desk === positionFilter; });
    var body = document.getElementById("positionsBody");
    document.getElementById("positionsSummary").textContent = positionsSummaryText(data);
    if (!positions.length) {
      var emptyMessage = positionsEmptyMessage(data, positionFilter);
      var row = el("tr");
      row.appendChild(cell(emptyMessage, "empty-cell"));
      row.firstChild.colSpan = 9;
      body.replaceChildren(row);
      syncPositionsTableLayout();
      return;
    }
    body.replaceChildren.apply(body, positions.map(function (position) {
      var row = el("tr");
      row.dataset.desk = position.desk;
      var quantity = Number.isFinite(position.quantity) ? position.quantity : position.qty;
      var currencyCode = positionCurrencyCode(position);
      var marketValue = positionMarketValue(position);
      var scopeLabel = positionAccountingScopeLabel(position);
      row.appendChild(cell(String(position.desk).toUpperCase()));
      var symbolCell = el("td");
      symbolCell.appendChild(document.createTextNode(positionSymbolText(position)));
      if (scopeLabel) {
        symbolCell.appendChild(el("span", "position-scope-note", " · " + scopeLabel));
      }
      row.appendChild(symbolCell);
      row.appendChild(cell(position.side || (Number.isFinite(quantity) && quantity < 0 ? "Short" : Number.isFinite(quantity) ? "Long" : "—")));
      row.appendChild(cell(Number.isFinite(quantity) ? number.format(quantity) : "—", "number"));
      row.appendChild(cell(formatPositionMoney(position.mark, false, currencyCode), "number"));
      row.appendChild(cell(formatPositionMoney(marketValue, false, currencyCode), "number"));
      row.appendChild(cell("—", "number neutral"));
      row.appendChild(cell(formatPositionMoney(position.openPnl, true, currencyCode), "number " + tone(position.openPnl)));
      row.appendChild(cell(position.updatedAt && Number.isFinite(Date.parse(position.updatedAt)) ? shortTime.format(new Date(position.updatedAt)) : "—"));
      return row;
    }));
    syncPositionsTableLayout();
  }

  function render(data) {
    latestSnapshot = data;
    lastValidSnapshot = data;
    refreshError = null;
    var snapshotAge = ageInSeconds(data.generatedAt);
    var stale = snapshotAge > data.safety.staleAfterSeconds;
    var gateway = data.safety.gateway;
    var gatewayDown = gateway.status === "down";
    var problems = snapshotProblems(data, snapshotAge);

    setMoney(document.getElementById("totalEquity"), data.totals.equity, false);
    setMoneyField(document.getElementById("totalDay"), data.totals.dayPnl, true, "day");
    setMoney(document.getElementById("totalOpen"), openPnl(data), true);
    updateSnapshotFreshnessUI(data, snapshotAge, stale);
    setSignal("haltSignal", "haltValue", data.safety.halt ? "ON" : "Off", data.safety.halt ? "bad" : "good");
    applyAttentionState(problems);
    observeSnapshotChanges(data);
    data.desks.forEach(function (desk) { renderDesk(desk, data, snapshotAge, stale, gatewayDown); });
    renderAttribution();
    renderPositions(data);
    labelPaperCapital();
    document.getElementById("sourceLine").textContent = "Source: " + (data.source && data.source.label ? data.source.label : "book.json projection") + " · paper projection";
    drawSparklines();
    if (isNarrowGridViewport()) { scheduleNarrowFit(0); }
  }

  function renderNoData(error) {
    latestSnapshot = null;
    lastValidSnapshot = null;
    refreshError = error;
    setSignal("gatewaySignal", "gatewayValue", "Unknown", "bad");
    setSignal("haltSignal", "haltValue", "Unknown", "bad");
    document.getElementById("totalEquity").textContent = "—";
    document.getElementById("totalDay").textContent = "—";
    document.getElementById("totalOpen").textContent = "—";
    ["totalEquity", "totalDay", "totalOpen"].forEach(function (id) {
      document.getElementById(id).classList.remove("positive", "negative");
      document.getElementById(id).classList.add("neutral");
    });
    document.getElementById("freshValue").textContent = "NO DATA";
    document.getElementById("freshValue").className = "negative";
    var alarm = document.getElementById("alarm");
    alarm.hidden = false;
    document.getElementById("alarmText").textContent = "No household snapshot is available yet. " + error.message;
    document.getElementById("updatedAt").textContent = "data.json unavailable";
    document.getElementById("sourceLine").textContent = "Source: unavailable · paper projection";
    DESK_IDS.forEach(function (deskId) {
      var slot = document.querySelector('[data-desk-slot="' + deskId + '"]');
      if (slot) { slot.replaceChildren(el("p", "empty-cell", "Waiting for the first valid snapshot.")); }
    });
    document.getElementById("attribution").replaceChildren(el("p", "widget-note", "Day P&L is not available yet; attribution will appear when it is."));
    document.getElementById("positionsSummary").textContent = "Position detail not supplied in this snapshot";
    var emptyPositionsRow = el("tr");
    var emptyPositionsCell = cell("Position detail is not present in this snapshot.", "empty-cell");
    emptyPositionsCell.colSpan = 9;
    emptyPositionsRow.appendChild(emptyPositionsCell);
    document.getElementById("positionsBody").replaceChildren(emptyPositionsRow);
    syncPositionsTableLayout();
    labelPaperCapital();
    document.documentElement.dataset.joeState = "broken";
  }

  function renderRefreshFailure(error) {
    refreshError = error;
    if (!lastValidSnapshot) {
      renderNoData(error);
      return;
    }
    updateFreshnessTick();
  }

  function historyRangeSpanMs(range) {
    if (range === "1d") { return 864e5; }
    if (range === "1w") { return 7 * 864e5; }
    if (range === "1m") { return 30 * 864e5; }
    return null;
  }

  function filterPoints(points, range) {
    if (!points.length || range === "all") { return points.slice(); }
    var last = Date.parse(points[points.length - 1].t);
    var span = historyRangeSpanMs(range);
    if (!span) { return points.slice(); }
    return points.filter(function (point) { return Date.parse(point.t) >= last - span; });
  }

  function isValidHistoryPoint(point) {
    if (!point || typeof point !== "object") { return false; }
    if (typeof point.t !== "string" || !Number.isFinite(Date.parse(point.t))) { return false; }
    if (!point.desks || typeof point.desks !== "object") { return false; }
    if (Object.prototype.hasOwnProperty.call(point, "accounting")) {
      if (!point.accounting || typeof point.accounting !== "object" || Array.isArray(point.accounting)) { return false; }
      var accountingIds = Object.keys(point.accounting);
      if (accountingIds.some(function (deskId) { return !DESK_IDS.includes(deskId); })) { return false; }
      try {
        accountingIds.forEach(function (deskId) {
          validateAccounting(point.accounting[deskId], "accounting." + deskId);
        });
      } catch (_) {
        return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(point, "historyBasis")) {
      if (!point.historyBasis || typeof point.historyBasis !== "object" || Array.isArray(point.historyBasis)) { return false; }
      var historyBasisIds = Object.keys(point.historyBasis);
      if (historyBasisIds.some(function (deskId) { return !DESK_IDS.includes(deskId); })) { return false; }
      try {
        historyBasisIds.forEach(function (deskId) {
          validateHistoryBasis(point.historyBasis[deskId], "historyBasis." + deskId);
        });
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  function validateHistoryPayload(data) {
    required(data && data.schema === "inspr.joe.household.history.v1", "unknown history schema");
    required(Array.isArray(data.points), "history points must be an array");
    if (!data.points.length) { return []; }
    data.points.forEach(function (point, index) {
      required(isValidHistoryPoint(point), "invalid history sample at index " + index);
    });
    return data.points;
  }

  function applyHistoryFetchResult(currentPoints, data) {
    try {
      return { points: validateHistoryPayload(data), error: null };
    } catch (error) {
      return {
        points: currentPoints,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  function historyFailureMessage(error, hasRetainedSeries) {
    if (!error) { return ""; }
    var detail = error.message || String(error);
    if (hasRetainedSeries) {
      return "History refresh failed: " + detail + ". Showing the last good series.";
    }
    return "History unavailable: " + detail + ". Use Retry when the connection recovers.";
  }

  function updateHistoryStatusUI() {
    var status = document.getElementById("historyStatus");
    var text = document.getElementById("historyStatusText");
    if (!status || !text) { return; }
    if (!historyError) {
      status.hidden = true;
      text.textContent = "";
      return;
    }
    status.hidden = false;
    text.textContent = historyFailureMessage(historyError, historyState.points.length > 0);
  }

  function historyEmptyMessage() {
    if (historyError && !historyState.points.length) {
      return historyFailureMessage(historyError, false);
    }
    return "History will fill as snapshots arrive.";
  }

  function sparklineSamples(points, range, deskId) {
    return basisAwareSeries(filterPoints(points, range), deskId);
  }

  function pointAccountingBasis(point, deskId) {
    return point && point.accounting && point.accounting[deskId] ? point.accounting[deskId] : null;
  }

  function pointHistoryBasis(point, deskId) {
    var explicit = point && point.historyBasis && Object.prototype.hasOwnProperty.call(point.historyBasis, deskId)
      ? point.historyBasis[deskId]
      : null;
    var accounting = pointAccountingBasis(point, deskId);
    return JSON.stringify([
      explicit,
      accounting ? accounting.periodStart : null,
      accounting ? accounting.method : null
    ]);
  }

  function hasIdentifiedHistoryBasis(point, deskId) {
    return Boolean(
      point && point.historyBasis && Object.prototype.hasOwnProperty.call(point.historyBasis, deskId)
    ) || Boolean(pointAccountingBasis(point, deskId));
  }

  function hasMeaningfulDeskObservation(point, deskId) {
    if (hasIdentifiedHistoryBasis(point, deskId)) { return true; }
    var bag = seriesBag(point, deskId);
    return Boolean(bag) && ["equity", "dayPnl", "totalPnl"].some(function (key) {
      return Number.isFinite(bag[key]);
    });
  }

  function compatibleAccountingBasis(leftPoint, rightPoint, deskId) {
    return pointHistoryBasis(leftPoint, deskId) === pointHistoryBasis(rightPoint, deskId);
  }

  function latestCompatibleBasis(points, deskId) {
    if (!points.length) { return { points: [], excludedCount: 0 }; }
    var anchor = -1;
    var index;
    for (index = points.length - 1; index >= 0; index -= 1) {
      if (hasMeaningfulDeskObservation(points[index], deskId)) {
        anchor = index;
        break;
      }
    }
    if (anchor < 0) {
      return { points: points.slice(), excludedCount: 0, identified: false };
    }
    var start = anchor;
    for (index = anchor - 1; index >= 0; index -= 1) {
      if (!hasMeaningfulDeskObservation(points[index], deskId)) { continue; }
      if (!compatibleAccountingBasis(points[index], points[anchor], deskId)) { break; }
      start = index;
    }
    var excludedCount = points.slice(0, start).filter(function (point) {
      var bag = seriesBag(point, deskId);
      return bag && Number.isFinite(bag.equity);
    }).length;
    return {
      points: points.slice(start),
      excludedCount: excludedCount,
      identified: hasIdentifiedHistoryBasis(points[anchor], deskId)
    };
  }

  function basisAwareSeries(points, deskId) {
    var selected = latestCompatibleBasis(points, deskId).points;
    var samples = [];
    selected.forEach(function (point) {
      var bag = seriesBag(point, deskId);
      var sample = {
        x: Date.parse(point.t),
        y: bag && Number.isFinite(bag.equity) ? bag.equity : null
      };
      samples.push(sample);
    });
    return samples;
  }

  function seriesBag(point, deskId) {
    return point.desks && point.desks[deskId];
  }

  function historyBasisNotice(points, deskIds, range) {
    var filtered = filterPoints(points, range);
    var excluded = deskIds.map(function (deskId) {
      var selected = latestCompatibleBasis(filtered, deskId);
      return { deskId: deskId, count: selected.excludedCount, identified: selected.identified };
    }).filter(function (entry) { return entry.count > 0; });
    if (!excluded.length) { return ""; }
    var labels = excluded.map(function (entry) {
      return entry.deskId === "j" ? "J" : entry.deskId.charAt(0).toUpperCase() + entry.deskId.slice(1);
    });
    return "This chart shows comparable records for " + labels.join(" and ") + ". Older or unidentified records are retained in history.json.";
  }

  function renderHistoryBasisNotice() {
    var node = document.getElementById("historyBasisNotice");
    if (!node) { return; }
    var message = historyBasisNotice(historyState.points, historyState.selected, historyState.range);
    node.hidden = !message;
    node.textContent = message;
  }

  function destroyHistoryChart() {
    if (historyState.chart) { historyState.chart.destroy(); historyState.chart = null; }
  }

  function showHistoryEmpty(message) {
    destroyHistoryChart();
    var empty = document.getElementById("historyEmpty");
    empty.hidden = false;
    empty.textContent = message;
    renderHistoryCompare();
  }

  function easternOffsetMinutes(date) {
    var year = date.getUTCFullYear();
    var march = new Date(Date.UTC(year, 2, 8));
    march.setUTCDate(8 + (7 - march.getUTCDay()) % 7);
    var november = new Date(Date.UTC(year, 10, 1));
    november.setUTCDate(1 + (7 - november.getUTCDay()) % 7);
    return date >= march && date < november ? 240 : 300;
  }

  function easternSessionBounds(dayStartMs) {
    var day = new Date(dayStartMs);
    day.setUTCHours(0, 0, 0, 0);
    var offset = easternOffsetMinutes(day);
    var open = day.getTime() + ((9 * 60 + 30) + offset) * 60 * 1000;
    var close = day.getTime() + (16 * 60 + offset) * 60 * 1000;
    return { open: open, close: close };
  }

  function chartVisibleDomain(chart) {
    var scale = chart.scales.x;
    if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) { return null; }
    return { min: scale.min, max: scale.max };
  }

  function utcDayStart(ms) {
    var day = new Date(ms);
    day.setUTCHours(0, 0, 0, 0);
    return day.getTime();
  }

  function todayUtcMidnight() {
    return utcDayStart(Date.now());
  }

  var historyOverlayPlugin = {
    id: "joeHistoryOverlay",
    beforeDatasetsDraw: function (chart) {
      var area = chart.chartArea;
      var scale = chart.scales.x;
      if (!area || !scale) { return; }
      var domain = chartVisibleDomain(chart);
      if (!domain || domain.max <= domain.min) { return; }
      var context = chart.ctx;
      var maxShadingSpanMs = 400 * 86400000;
      context.save();
      context.beginPath();
      context.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      context.clip();
      if (domain.max - domain.min <= maxShadingSpanMs) {
        context.fillStyle = cssVar("--chart-session-fill") || "rgba(169, 201, 154, 0.06)";
        var day = utcDayStart(domain.min);
        var lastDay = utcDayStart(domain.max);
        while (day <= lastDay) {
          var weekday = new Date(day).getUTCDay();
          if (weekday >= 1 && weekday <= 5) {
            var session = easternSessionBounds(day);
            var start = Math.max(domain.min, session.open);
            var end = Math.min(domain.max, session.close);
            if (end > start) {
              var left = scale.getPixelForValue(start);
              var right = scale.getPixelForValue(end);
              var x = Math.max(area.left, Math.min(left, right));
              var x2 = Math.min(area.right, Math.max(left, right));
              var width = x2 - x;
              if (width > 0) {
                context.fillRect(x, area.top, width, area.bottom - area.top);
              }
            }
          }
          day += 86400000;
        }
      }
      var todayMs = todayUtcMidnight();
      if (todayMs >= domain.min && todayMs <= domain.max) {
        var marker = scale.getPixelForValue(todayMs);
        if (marker >= area.left && marker <= area.right) {
          context.strokeStyle = cssVar("--chart-today-line") || "rgba(238, 230, 212, 0.55)";
          context.lineWidth = 1;
          context.setLineDash([4, 4]);
          context.beginPath();
          context.moveTo(marker, area.top);
          context.lineTo(marker, area.bottom);
          context.stroke();
          context.setLineDash([]);
          context.fillStyle = cssVar("--chart-today-label") || "rgba(238, 230, 212, 0.75)";
          context.font = "10px SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace";
          context.fillText("Today UTC", Math.min(marker + 4, area.right - 58), area.top + 12);
        }
      }
      context.restore();
    }
  };

  function updateSeriesButtons() {
    var allSelected = DESK_IDS.every(function (id) { return historyState.selected.includes(id); });
    document.getElementById("seriesAll").setAttribute("aria-pressed", String(allSelected && historyState.selected.length === DESK_IDS.length));
    document.querySelectorAll("button[data-series]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(historyState.selected.includes(button.dataset.series)));
    });
  }

  function drawHistory() {
    renderHistoryBasisNotice();
    if (!window.Chart) { showHistoryEmpty("The local chart library could not be loaded."); return; }
    if (!historyState.selected.length) {
      showHistoryEmpty("Select one or more desks to compare.");
      return;
    }
    var points = filterPoints(historyState.points, historyState.range);
    var datasets = historyState.selected.map(function (deskId) {
      var series = basisAwareSeries(points, deskId);
      if (!series.some(function (sample) { return Number.isFinite(sample.y); })) { return null; }
      var finiteCount = series.filter(function (sample) { return Number.isFinite(sample.y); }).length;
      return {
        label: deskId === "j" ? "J" : deskId.charAt(0).toUpperCase() + deskId.slice(1),
        data: series,
        spanGaps: false,
        borderColor: deskColor(deskId), backgroundColor: deskColor(deskId), borderWidth: 2,
        pointRadius: finiteCount === 1 ? 3 : 0, pointHoverRadius: 4, tension: .2
      };
    }).filter(Boolean);
    if (!datasets.length) {
      if (historyError && historyState.points.length) { updateHistoryStatusUI(); }
      showHistoryEmpty(historyEmptyMessage());
      return;
    }
    document.getElementById("historyEmpty").hidden = true;
    var tickFont = { family: "SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace", size: 10 };
    var config = {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: false, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { display: true, labels: { color: cssVar("--chart-legend") || "#aaa79d", boxWidth: 14, boxHeight: 2, font: tickFont } },
          tooltip: {
            backgroundColor: cssVar("--chart-tooltip-bg") || "rgba(41,42,38,.96)",
            titleColor: cssVar("--chart-tooltip-title") || "#eee6d4",
            bodyColor: cssVar("--chart-tooltip-body") || "#c9c4b7",
            borderColor: cssVar("--chart-tooltip-border") || "#454641",
            borderWidth: 1,
            callbacks: {
            title: function (items) { return items.length ? dateTime.format(new Date(items[0].parsed.x)) : ""; },
            label: function (item) { return item.dataset.label + "  " + amount(item.parsed.y, false); }
          } },
          zoom: {
            limits: { x: { minRange: 60 * 1000 } },
            pan: { enabled: true, mode: "x", modifierKey: "shift" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        },
        scales: {
          x: { type: "linear", ticks: { color: cssVar("--chart-tick") || "#77766f", maxTicksLimit: 7, font: tickFont, callback: function (value) { return shortTime.format(new Date(value)); } }, grid: { color: cssVar("--chart-grid") || "rgba(63,64,59,.45)" } },
          y: { ticks: { color: cssVar("--chart-tick") || "#77766f", font: tickFont, callback: function (value) { return amount(value, false); } }, grid: { color: cssVar("--chart-grid") || "rgba(63,64,59,.45)" } }
        }
      },
      plugins: [historyOverlayPlugin]
    };
    destroyHistoryChart();
    historyState.chart = new window.Chart(document.getElementById("historyChart").getContext("2d"), config);
    renderHistoryCompare();
    resizeVisuals();
  }

  function drawSpark(canvas, samples, color) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { return; }
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    var context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!samples.length) {
      context.strokeStyle = cssVar("--spark-empty") || "#4a4b44"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(0, rect.height / 2); context.lineTo(rect.width, rect.height / 2); context.stroke();
      return;
    }
    var finite = samples.filter(function (sample) { return Number.isFinite(sample.y); });
    if (finite.length < 2) {
      context.strokeStyle = cssVar("--spark-empty") || "#4a4b44"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(0, rect.height / 2); context.lineTo(rect.width, rect.height / 2); context.stroke();
      return;
    }
    var minX = samples[0].x;
    var maxX = samples[samples.length - 1].x;
    var minY = Math.min.apply(Math, finite.map(function (sample) { return sample.y; }));
    var maxY = Math.max.apply(Math, finite.map(function (sample) { return sample.y; }));
    var spreadX = maxX - minX || 1;
    var spreadY = maxY - minY || 1;
    context.strokeStyle = color; context.lineWidth = 1.7; context.setLineDash([]); context.beginPath();
    var drawing = false;
    samples.forEach(function (sample) {
      if (!Number.isFinite(sample.y)) {
        drawing = false;
        return;
      }
      var x = (sample.x - minX) / spreadX * rect.width;
      var y = 5 + (maxY - sample.y) / spreadY * (rect.height - 10);
      if (drawing) {
        context.lineTo(x, y);
      } else {
        context.moveTo(x, y);
        drawing = true;
      }
    });
    context.stroke();
  }

  function drawSparklines() {
    document.querySelectorAll("canvas[data-spark]").forEach(function (canvas) {
      var id = canvas.dataset.spark;
      drawSpark(canvas, sparklineSamples(historyState.points, historyState.range, id), deskColor(id));
    });
  }

  function resizeVisuals() {
    window.requestAnimationFrame(function () {
      if (historyState.chart) {
        var wrap = document.querySelector(".history-canvas-wrap");
        historyState.chart.resize(Math.max(1, Math.floor(wrap.clientWidth)), Math.max(1, Math.floor(wrap.clientHeight)));
      }
      drawSparklines();
      if (isNarrowGridViewport()) { scheduleNarrowFit(0); }
    });
  }

  function bindControls() {
    document.getElementById("seriesAll").addEventListener("click", function () {
      if (historyState.selected.length === DESK_IDS.length) {
        historyState.selected = [];
      } else {
        historyState.selected = DESK_IDS.slice();
      }
      updateSeriesButtons();
      drawHistory();
    });
    document.querySelectorAll("button[data-series]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.dataset.series;
        var index = historyState.selected.indexOf(id);
        if (index >= 0) {
          historyState.selected.splice(index, 1);
        } else {
          historyState.selected.push(id);
        }
        updateSeriesButtons();
        drawHistory();
      });
    });
    document.querySelectorAll("button[data-range]").forEach(function (button) {
      button.addEventListener("click", function () {
        historyState.range = button.dataset.range;
        document.querySelectorAll("button[data-range]").forEach(function (candidate) { candidate.setAttribute("aria-pressed", String(candidate === button)); });
        drawHistory();
        drawSparklines();
      });
    });
    document.getElementById("resetZoom").addEventListener("click", function () { if (historyState.chart && historyState.chart.resetZoom) { historyState.chart.resetZoom(); } });
    document.getElementById("historyRetry").addEventListener("click", function () { refreshHistory(); });
    document.querySelectorAll("button[data-position-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        positionFilter = button.dataset.positionFilter;
        document.querySelectorAll("button[data-position-filter]").forEach(function (candidate) { candidate.setAttribute("aria-pressed", String(candidate === button)); });
        if (latestSnapshot) { renderPositions(latestSnapshot); }
      });
    });
    window.addEventListener("resize", function () {
      scheduleViewportSync();
      resizeVisuals();
    });
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener("resize", scheduleViewportSync);
    }
  }

  async function refreshHistory() {
    try {
      var response = await fetch(endpoint("joe-history-endpoint", "JOE_HISTORY_URL", "./history.json"), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      var result = applyHistoryFetchResult(historyState.points, await response.json());
      historyState.points = result.points;
      historyError = result.error;
    } catch (error) {
      historyError = error instanceof Error ? error : new Error(String(error));
    }
    updateHistoryStatusUI();
    drawHistory();
    drawSparklines();
  }

  async function refresh() {
    try {
      var response = await fetch(endpoint("joe-data-endpoint", "JOE_DATA_URL", "./data.json"), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { throw new Error("HTTP " + response.status + " for data.json"); }
      render(validate(await response.json()));
    } catch (error) {
      renderRefreshFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }

  window.JoeBoard = Object.freeze({
    ingest: function (snapshot) { render(validate(snapshot)); },
    dayPnlDisplayValue: dayPnlDisplayValue,
    deskPositionsCoverage: deskPositionsCoverage,
    positionsAvailability: positionsAvailability,
    positionsEmptyMessage: positionsEmptyMessage,
    deskFreshnessFooter: deskFreshnessFooter,
    snapshotProblems: snapshotProblems,
    gatewayHeartbeatAge: gatewayHeartbeatAge,
    validIsoTimestamp: validIsoTimestamp,
    collectPositions: collectPositions,
    positionCurrencyCode: positionCurrencyCode,
    positionAccountingScopeLabel: positionAccountingScopeLabel,
    formatPositionMoney: formatPositionMoney,
    positionMarketValue: positionMarketValue,
    positionSymbolText: positionSymbolText,
    validate: validate,
    refresh: refresh,
    layoutStorageKey: LAYOUT_KEY,
    layoutsStorageKey: LAYOUTS_KEY,
    settingsStorageKey: SETTINGS_KEY,
    themeStorageKey: THEME_KEY,
    defaultLayoutId: DEFAULT_LAYOUT_ID,
    maxLayouts: MAX_LAYOUTS,
    defaultGridSettings: Object.assign({}, DEFAULT_GRID_SETTINGS),
    readLayoutsCatalog: readLayoutsCatalog,
    writeLayoutsCatalog: writeLayoutsCatalog,
    readActiveGridSettings: readActiveGridSettings,
    sanitizeGridSettings: sanitizeGridSettings,
    sanitizeLayoutItems: sanitizeLayoutItems,
    canonicalLayoutsCatalog: canonicalLayoutsCatalog,
    applyGridSettings: applyGridSettings,
    applyTheme: applyTheme,
    readThemeMode: readThemeMode,
    readStoredThemeMode: readStoredThemeMode,
    resolveTheme: resolveTheme,
    desktopColumnCount: desktopColumnCount,
    gridColumnCount: gridColumnCount,
    syncGridColumnConfig: syncGridColumnConfig,
    captureDesktopGridLayout: captureDesktopGridLayout,
    layoutItemsFromGrid: layoutItemsFromGrid,
    positionHeaderMenus: positionHeaderMenus,
    narrowBreakpoint: NARROW_BREAKPOINT,
    narrowGridRowPixels: narrowGridRowPixels,
    narrowGridTilePixels: narrowGridTilePixels,
    narrowRowsForOuterPixels: narrowRowsForOuterPixels,
    narrowOuterPixelsForContent: narrowOuterPixelsForContent,
    narrowTileHeight: narrowTileHeight,
    narrowLayoutFromItems: narrowLayoutFromItems,
    layoutViewportWidth: layoutViewportWidth,
    isNarrowGridViewport: isNarrowGridViewport,
    syncLayoutViewport: syncLayoutViewport,
    rememberDesktopLayout: rememberDesktopLayout,
    desktopLayoutSnapshot: desktopLayoutSnapshot,
    todayUtcMidnight: todayUtcMidnight,
    filterPoints: filterPoints,
    historyRangeSpanMs: historyRangeSpanMs,
    validateHistoryPayload: validateHistoryPayload,
    applyHistoryFetchResult: applyHistoryFetchResult,
    historyFailureMessage: historyFailureMessage,
    sparklineSamples: sparklineSamples,
    basisAwareSeries: basisAwareSeries,
    latestCompatibleBasis: latestCompatibleBasis,
    historyBasisNotice: historyBasisNotice,
    compatibleAccountingBasis: compatibleAccountingBasis,
    accountingPeriodLabel: accountingPeriodLabel,
    accountingSinceLabel: accountingSinceLabel,
    formatDeskLearningCopy: formatDeskLearningCopy,
    deskTrackFields: deskTrackFields,
    diffDeskToEvents: diffDeskToEvents,
    observeSnapshotChanges: observeSnapshotChanges,
    readObservedEvents: readObservedEvents,
    writeObservedEvents: writeObservedEvents,
    sharedWindowCompare: sharedWindowCompare,
    formatPctChange: formatPctChange
  });
  initTheme();
  initGrid();
  bindControls();
  bindLayoutControls();
  bindSettingsControls();
  bindDismissableDetails();
  populateSettingsForm(activeGridSettings, readThemeMode());
  renderVersionPanel();
  updateSeriesButtons();
  refresh();
  refreshHistory();
  window.setInterval(refresh, 15000);
  window.setInterval(refreshHistory, 30000);
  window.setInterval(updateFreshnessTick, 1000);
}());
