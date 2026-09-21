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
  var ACTIVE_LAYOUT_KEY = "joe-board-active-layout-v1";
  var SETTINGS_KEY = "joe-board-grid-settings-v1";
  var PHONE_ORDER_KEY = "joe-board-phone-order-v1";
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
  var BOARD_HEALTH_TONES = ["green", "yellow", "red"];
  var BOARD_HEALTH_REASON_TONES = {
    board_ok: "green",
    snapshot_stale: "yellow",
    retained_values: "yellow",
    gateway_degraded: "yellow",
    open_unavailable_rth: "yellow",
    day_pending: "yellow",
    halt_on: "red",
    gateway_down: "red",
    equity_unavailable: "red",
    producer_stuck: "red",
    day_unavailable_rth: "red"
  };
  var ACCOUNTING_METHOD = "execution-fifo-net-current-fx";
  var ACCOUNTING_DETAIL_MAX = 240;
  var HISTORY_BASIS_MAX = 96;
  var HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
  var BROKER_ACCOUNT_KEYS = ["equity", "currency", "observedAt", "scope", "status"];
  var PNL_SOURCE_GROUP_KEYS = ["day", "open"];
  var DAY_PNL_SOURCE_KEYS = ["status", "method", "currency", "scope", "observedAt", "periodStart", "detail"];
  var OPEN_PNL_SOURCE_KEYS = ["status", "method", "currency", "scope", "observedAt", "detail"];
  var MONEY_EVIDENCE_KEYS = ["status", "observedAt"];
  var BACKFILL_KEYS = ["status", "fullTotalAvailable", "capturedSubtotal", "coverage", "missingOpeningLotCount", "orphanCommissionCount"];
  var BACKFILL_CAPTURE_KEYS = ["realizedPnl", "currency", "method", "executionCount", "commissionCount", "fromInclusive", "throughInclusive", "points", "pointsTruncated"];
  var BACKFILL_CAPTURE_REQUIRED_KEYS = ["realizedPnl", "currency", "executionCount", "commissionCount", "fromInclusive", "throughInclusive"];
  var BACKFILL_POINT_KEYS = ["at", "realizedPnl"];
  var BACKFILL_COVERAGE_KEYS = ["target", "completeIntervalCount", "knownIntervalCount", "gapCount", "firstGap"];
  var BACKFILL_INTERVAL_KEYS = ["fromInclusive", "toExclusive"];
  var MAX_BACKFILL_COUNT = 1000000;
  var MAX_BACKFILL_POINTS = 2048;
  var BACKFILL_ENDPOINT_TOLERANCE = 0.000001;
  var CAPTURED_FIFO_METHOD = "captured-fifo-matched-roundtrips";
  var VIRTUAL_STARTING_CAPITAL_EUR = 15000;
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
  var newYorkClock = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" });
  var grid = null;
  var restoringLayout = false;
  var narrowGridActive = false;
  var narrowFitFrame = 0;
  var viewportSyncFrame = 0;
  var cachedDesktopLayout = null;
  var latestSnapshot = null;
  var lastValidSnapshot = null;
  var lastGoodEquitySnapshot = null;
  var refreshError = null;
  var positionFilter = "all";
  var historyState = { selected: DESK_IDS.slice(), range: "all", points: [], chart: null };
  var historyError = null;
  var lastObservedSnapshot = null;
  var observedEventsMemory = null;
  var layoutFormMode = null;
  var activeLayoutId = DEFAULT_LAYOUT_ID;
  var layoutBaseline = null;
  var layoutDirty = false;
  var activePhoneOrder = null;
  var pendingLayoutSelectionId = null;
  var activeGridSettings = Object.assign({}, DEFAULT_GRID_SETTINGS);
  var activeThemeMode = "dark";
  var settingsFormDirty = false;
  var historyResizeObserver = null;
  var visualResizeFrame = 0;
  var visualResizeNeedsNarrowFit = false;
  var historyChartSize = { width: 0, height: 0 };
  var FLEET_PREVIEW_KEY = "joe-fleet-config-preview-v1";
  var FLEET_CONFIG = {
    quota: {
      label: "Quota policy",
      headline: "Keep a little in the tank.",
      intro: "Keep some AI capacity for essential work. Choose the reserve below and see what each quota color asks the fleet to do.",
      status: true,
      sections: [
        ["Learning desks", "Reserves apply to Grok and Codex usage. Desk limits and capital caps are in Desk limits."],
        ["Failsafe arms", "GREEN runs normally. AMBER follows the selected policy. RED parks nonessential work. These are configured policies, not a live quota reading."],
        ["Plain files. Locked secrets.", "Fleet settings stay in plaintext so changes are easy to read and compare. Only references point to encrypted values; secret material never appears here."],
        ["Preview → Confirm → Propagate", "Review the change before the fleet receives it."],
      ],
      fields: [
        { key: "grok.reservePct", label: "Keep this much Grok capacity free (%)", help: "0–100%. Reserved capacity stays available for watch and recovery.", value: "10", path: "quota.grok.reservePct", type: "integer", min: 0, max: 100 },
        { key: "codex.reservePct", label: "Keep this much Codex capacity free (%)", help: "0–100%. Reserved capacity stays available for watch and recovery.", value: "10", path: "quota.codex.reservePct", type: "integer", min: 0, max: 100 },
        { key: "onGreen", label: "When capacity is healthy (fixed)", help: "Normal work runs. The v1 safety rule fixes this value.", value: "run_normally", path: "quota.behavior.green", editable: false },
        { key: "onAmber", label: "When capacity is getting low", help: "Choose whether nonessential work slows or parks.", value: "slow_nonessential", path: "quota.behavior.amber", choices: [{ value: "slow_nonessential", label: "Slow nonessential work" }, { value: "park_nonessential", label: "Park nonessential work" }] },
        { key: "onRed", label: "When capacity is critical (fixed)", help: "Nonessential work parks. The v1 safety rule fixes this value.", value: "park_nonessential", path: "quota.behavior.red", editable: false },
      ],
    },
    desks: {
      label: "Desk limits",
      headline: "Set the paper desks’ boundaries.",
      intro: "Set the Stage-0 capital cap, how many desks may be busy, and which holdings learning desks must leave alone.",
      sections: [
        ["Keep means keep", "Symbols in the KEEP list are excluded from learning-desk changes."],
        ["Paper first", "Desk learning stays in the paper environment. Nothing on this plane can place a trade."],
        ["Small, reversible steps", "Diff shows your changes. Confirm approves that preview. Propagate writes a new shared-file revision; it does not confirm consumer reload."],
      ],
      fields: [
        { key: "maxBusyDesks", label: "Maximum busy J desks at once", help: "A whole number from 1 to 32.", value: "5", path: "desks.maxBusyDesks", type: "integer", min: 1, max: 32 },
        { key: "stage0CapEur", label: "Stage-0 euro ceiling", help: "Paper Stage-0 limit in euros; 0 to 1,000,000.", value: "250", path: "desks.stage0.capEur", type: "number", min: 0, max: 1000000 },
        { key: "keepSymbols", label: "Protected KEEP symbols", help: "Uppercase symbols separated by commas, for example SXR8,TSLA.", value: "SXR8,TSLA", path: "desks.keep", type: "symbols", maxLength: 160 },
      ],
    },
    cadence: {
      label: "Wake times & cadence",
      headline: "The fleet wakes up on a schedule.",
      intro: "These settings say when routines should run. They do not show whether a wake actually happened.",
      sections: [
        ["US-open arm", "Use the US-open start time below. All configured times use Europe/Vienna, including daylight-saving changes."],
        ["Watch before work", "The desk watcher is the configured routine for checking fleet state."],
        ["Capacity has the last word", "The quota governor can slow or park nonessential work."],
      ],
      fields: [
        { key: "usOpenArm", label: "Earliest US-open arm (Vienna time)", help: "24-hour time, for example 15:35.", value: "15:35", path: "cadence.usOpenArm", type: "time" },
        { key: "wakeWindows", label: "Desk wake windows", value: "[]", path: "cadence.wakeWindows", type: "windows", maxLength: 131072 },
        { key: "watcher", label: "Desk check routine ID", help: "Lowercase routine name that checks the desks.", value: "desk-watch", path: "cadence.deskWatch", type: "routine", maxLength: 64 },
        { key: "darwin", label: "Darwin routine ID", help: "Lowercase routine name for Darwin.", value: "darwin", path: "cadence.darwin", type: "routine", maxLength: 64 },
        { key: "governor", label: "Quota capacity routine ID", help: "Lowercase routine name that slows or parks extra work.", value: "quota-governor", path: "cadence.quotaGovernor", type: "routine", maxLength: 64 },
      ],
    },
    paths: {
      label: "Legacy shared paths",
      headline: "Old shelves are labels, not steering wheels.",
      intro: "The live fleet file is on the board host. These old Mac paths are kept visible only so nobody mistakes a mirror for a control input.",
      sections: [
        ["Board source", "The definition strip above shows the actual file this board reads."],
        ["Deprecated mirrors", "~/trading-team/shared/fleet-config.json and its docs folder are historical locations. JoeDesk does not read them."],
        ["References, not secret values", "Shared files may name encrypted slots but never contain the secret material."],
      ],
      fields: [
        { key: "configPath", label: "Deprecated config mirror", value: "~/trading-team/shared/fleet-config.json", path: "mac.shared.configPath", type: "path", maxLength: 160, editable: false },
        { key: "docsPath", label: "Deprecated docs mirror", value: "~/trading-team/shared/docs", path: "mac.shared.docsPath", type: "path", maxLength: 160, editable: false },
      ],
    },
    routines: {
      label: "Amy’s check-ins",
      headline: "Name Amy’s three check-ins.",
      intro: "These are names for morning, review and close. Fleet Config v1 does not store Amy’s run times or prove that a routine ran.",
      sections: [
        ["Morning brief", "Start with the current constraints and the work that matters today."],
        ["Desk review", "Check what each desk learned and whether any guardrail needs attention."],
        ["Close recap", "Record the useful result without turning the board into a noisy activity feed."],
      ],
      fields: [
        { key: "morningRoutine", label: "Morning", value: "Morning brief", path: "amy.routines.morning" },
        { key: "reviewRoutine", label: "Review", value: "Desk review", path: "amy.routines.review" },
        { key: "closeRoutine", label: "Close", value: "Close recap", path: "amy.routines.close" },
      ],
    },
    tools: {
      label: "Tools",
      headline: "See which connections are declared.",
      intro: "These are declared connection names. Current health comes from /joe/data.json; this list does not prove connectivity.",
      sections: [
        ["Connection names", "The saved tool entries name the expected connections. Technical shows the complete list of IDs and labels."],
        ["Connection health", "Read current availability on the trading board. A tool listed here may still be unavailable."],
        ["Host setup", "Authentication and host connection settings stay in their existing host workflow."],
      ],
      fields: [
        { key: "gateway", label: "Gateway", value: "IB Gateway", path: "tools.entries.0.label", editable: false },
        { key: "joelAdapter", label: "Integration", value: "joel-ib", path: "tools.entries.1.label", editable: false },
        { key: "hostTool", label: "Host tool", value: "codexbar@hsb0", path: "tools.entries.2.label", editable: false },
      ],
    },
    secrets: {
      label: "Secret slots",
      headline: "Names on the board. Values stay in AGE.",
      intro: "Fleet Config is a readable paper file. AGE/agenix holds the encrypted secret material. This plane lists capability and path refs only.",
      sections: [
        ["Plaintext policy vs AGE secrets", "Quota, desks and paths stay in plaintext so changes are easy to read. Secret values never enter this JSON, this browser, previews or diffs. AGE ciphertext lives only in the host secret store."],
        ["Always REDACTED", "Each slot shows its agenix or Janus capability/path ref and a REDACTED marker. The UI has no field for a password, token or key value."],
        ["Janus/agenix ops", "Rotation and injection stay in the existing host workflow. The short note under Secret slots points at Janus/agenix ops for v1."],
      ],
      fields: [
        { key: "agenixRefs", label: "agenix refs", value: "joe-board-push-token", path: "secretSlots.agenix", type: "refs", editable: false },
        { key: "janusRefs", label: "Janus refs", value: "", path: "secretSlots.janus", type: "refs", editable: false },
        { key: "displayMode", label: "Display", value: "REDACTED", editable: false },
      ],
    },
  };
  var FLEET_LIMITS_HOME = {
    label: "Limits home",
    headline: "See the paper fleet’s limits in one place.",
    intro: "Set desk risk caps, the busy-desk maximum, quota behavior and wake times here. These settings apply to paper learning only.",
    sections: [
      ["Quota", "Reserve capacity for essential work and choose how AMBER handles nonessential work. GREEN and RED are fixed by v1."],
      ["Desk limits", "Set simultaneous busy desks, the Stage-0 capital ceiling and protected KEEP symbols."],
      ["Wake times", "Set wake windows and the US-open start in Vienna time. Routine names identify the work; they do not set repeat intervals."],
      ["Saved means written", "Edit a named setting, review Diff, Confirm it, then Propagate a shared-file revision. This changes paper settings only; it does not place a trade, and the board cannot confirm consumer reload."],
    ],
    fields: [],
  };
  var FLEET_SOURCES = {
    quota: {
      "grok.reservePct": ["quota.grok.reservePct", "quota-state.json is a live capacity reading, not a setting"],
      "codex.reservePct": ["quota.codex.reservePct", "quota-state.json is a live capacity reading, not a setting"],
      onGreen: ["quota.behavior.green", "fixed by the v1 schema; journals do not set policy"],
      onAmber: ["quota.behavior.amber", "quota-state.json reports capacity; choose the response here"],
      onRed: ["quota.behavior.red", "desk journals may record a quota state; they never set policy"],
    },
    desks: {
      maxBusyDesks: ["desks.maxBusyDesks", "trading-team/CONFIG.md is a historical policy note; it is not read by JoeDesk"],
      stage0CapEur: ["desks.stage0.capEur", "trading-team/CONFIG.md has stage-cap context; do not use it for this board knob"],
      keepSymbols: ["desks.keep", "desk journals are evidence only; they do not change KEEP"],
    },
    cadence: {
      usOpenArm: ["cadence.usOpenArm", "Amy and desk schedulers must consume this revision; wiring is outside JoeDesk"],
      wakeWindows: ["cadence.wakeWindows", "external schedulers must adopt these windows; an empty list does not prove desks are asleep"],
      darwin: ["cadence.darwin", "routine name only; repeat intervals live in the scheduler"],
      watcher: ["cadence.deskWatch", "routine names in journals are historical, not configuration"],
      governor: ["cadence.quotaGovernor", "routine names in journals are historical, not configuration"],
    },
    paths: {
      configPath: ["mac.shared.configPath", "~/trading-team/shared/fleet-config.json is DEPRECATED; JoeDesk never reads it"],
      docsPath: ["mac.shared.docsPath", "~/trading-team/shared/docs is DEPRECATED as a control path"],
    },
    routines: {
      morningRoutine: ["amy.routines.morning", "Amy routine definitions outside this repo must adopt the revision; journals are history"],
      reviewRoutine: ["amy.routines.review", "Amy routine definitions outside this repo must adopt the revision; journals are history"],
      closeRoutine: ["amy.routines.close", "Amy routine definitions outside this repo must adopt the revision; journals are history"],
    },
    tools: {
      gateway: ["tools.entries.0.label", "host connection settings and credentials stay outside Fleet Config"],
      joelAdapter: ["tools.entries.1.label", "host connection settings and credentials stay outside Fleet Config"],
      hostTool: ["tools.entries.2.label", "host connection settings and credentials stay outside Fleet Config"],
    },
    secrets: {
      agenixRefs: ["secretSlots.agenix", "credentials stay in the host secret store — never a board setting"],
      janusRefs: ["secretSlots.janus", "credentials stay in the host secret store — never a board setting"],
      displayMode: ["secretSlots", "JoeDesk inbox credential is at /run/secrets/joe-board-push-token; JOE_INBOX_TOKEN is dev-only fallback"],
    },
  };
  var fleetSectionId = "desks";
  var fleetLoadState = "loading";
  var fleetDraft = {};
  var fleetBaseline = {};
  var fleetLastOutcome = "";
  var fleetBaselineConfig = null;
  var fleetDiffFingerprint = "";
  var fleetConfirmedFingerprint = "";
  var fleetConfirmed = false;
  var fleetBusy = false;
  var fleetToastTimer = 0;
  var fleetFlipTimer = 0;

  var gate = document.getElementById("privateGate");
  var dashboard = document.getElementById("dashboard");
  if (!isCanonicalJoeHost(location.hostname)) {
    document.title = "Joe · Private household board";
    document.documentElement.dataset.joeView = "stub";
    gate.hidden = false;
    return;
  }
  document.documentElement.dataset.joeView = "board";
  document.documentElement.dataset.joePlane = "trading";
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

  function validateBrokerAccount(account) {
    required(account && typeof account === "object" && !Array.isArray(account), "brokerAccount must be an object");
    Object.keys(account).forEach(function (key) {
      required(BROKER_ACCOUNT_KEYS.includes(key), "brokerAccount has unknown key " + key);
    });
    BROKER_ACCOUNT_KEYS.forEach(function (key) {
      required(Object.prototype.hasOwnProperty.call(account, key), "brokerAccount." + key + " is required");
    });
    finiteOrNull(account.equity, "brokerAccount.equity");
    required(account.currency === "EUR", "brokerAccount.currency must be EUR");
    required(validIsoTimestamp(account.observedAt), "brokerAccount.observedAt is invalid");
    required(account.scope === "paper-account-including-keep", "brokerAccount.scope is invalid");
    required(["available", "unavailable"].includes(account.status), "brokerAccount.status is invalid");
    required(account.status !== "available" || Number.isFinite(account.equity), "brokerAccount.equity must be finite when available");
    return account;
  }

  function validateExactKeys(value, keys, path, requiredKeys) {
    required(value && typeof value === "object" && !Array.isArray(value), path + " must be an object");
    Object.keys(value).forEach(function (key) {
      required(keys.includes(key), path + " has unknown key " + key);
    });
    (requiredKeys || keys).forEach(function (key) {
      required(Object.prototype.hasOwnProperty.call(value, key), path + "." + key + " is required");
    });
  }

  function validatePnlSource(source, kind, path) {
    var keys = kind === "day" ? DAY_PNL_SOURCE_KEYS : OPEN_PNL_SOURCE_KEYS;
    validateExactKeys(source, keys, path);
    required(["available", "unavailable"].includes(source.status), path + ".status is invalid");
    required(source.currency === "EUR", path + ".currency must be EUR");
    required(source.scope === "virtual-desks", path + ".scope is invalid");
    required(source.observedAt === null || validIsoTimestamp(source.observedAt), path + ".observedAt is invalid");
    required(typeof source.detail === "string" && source.detail.length >= 1 && source.detail.length <= 160 && /^[ -~]+$/.test(source.detail), path + ".detail is invalid");
    if (kind === "day") {
      required(["ib-daily-pnl", "sod-virtual-equity", null].includes(source.method), path + ".method is invalid");
      required(source.periodStart === null || validIsoTimestamp(source.periodStart), path + ".periodStart is invalid");
      required(source.method !== "sod-virtual-equity" || validIsoTimestamp(source.periodStart), path + ".periodStart is required for SOD method");
    } else {
      required(["ib-unrealized-pnl", "owned-lots-current-mark-fx", null].includes(source.method), path + ".method is invalid");
    }
    if (source.status === "available") {
      required(source.method !== null, path + ".method is required when available");
      required(validIsoTimestamp(source.observedAt), path + ".observedAt is required when available");
    }
  }

  function validatePnlSources(sources) {
    validateExactKeys(sources, PNL_SOURCE_GROUP_KEYS, "pnlSources", []);
    if (Object.prototype.hasOwnProperty.call(sources, "day")) validatePnlSource(sources.day, "day", "pnlSources.day");
    if (Object.prototype.hasOwnProperty.call(sources, "open")) validatePnlSource(sources.open, "open", "pnlSources.open");
  }

  function validateMoneyEvidence(evidence, path) {
    validateExactKeys(evidence, MONEY_EVIDENCE_KEYS, path);
    required(["observed", "carried"].includes(evidence.status), path + ".status is invalid");
    required(validIsoTimestamp(evidence.observedAt), path + ".observedAt is invalid");
    return evidence;
  }

  function validatePnlEvidenceValues(data) {
    if (!Array.isArray(data.desks) || !data.totals) { return; }
    var positions = Array.isArray(data.positions) ? data.positions.slice() : [];
    data.desks.forEach(function (desk) {
      if (Array.isArray(desk && desk.positions)) {
        positions = positions.concat(desk.positions);
      }
    });
    [["day", "dayPnl"], ["open", "openPnl"]].forEach(function (entry) {
      var kind = entry[0];
      var field = entry[1];
      var source = data.pnlSources && data.pnlSources[kind];
      required(
        !positions.some(function (position) { return Number.isFinite(position && position[field]); }) || (source && source.status === "available"),
        "position " + field + " requires available pnlSources." + kind
      );
      if (!source) { return; }
      var values = data.desks.map(function (desk) { return desk && desk.money && desk.money[field]; });
      var total = data.totals[field];
      if (source.status === "available") {
        required(values.every(Number.isFinite) && Number.isFinite(total), "pnlSources." + kind + " available requires finite " + field + " for every desk and totals");
        if (values.every(Number.isFinite) && Number.isFinite(total)) {
          required(Math.abs(values.reduce(function (sum, value) { return sum + value; }, 0) - total) < 0.01, "totals." + field + " must equal all desk " + field + " values");
        }
      } else if (source.status === "unavailable") {
        required(values.every(function (value) { return value === null; }) && total === null, "pnlSources." + kind + " unavailable requires null " + field + " for every desk and totals");
      }
    });
  }

  function validateBackfillPoints(captured, path) {
    var hasPoints = Object.prototype.hasOwnProperty.call(captured, "points");
    var hasTruncated = Object.prototype.hasOwnProperty.call(captured, "pointsTruncated");
    if (!hasPoints && !hasTruncated) { return; }
    required(hasPoints && hasTruncated, path + ".points and " + path + ".pointsTruncated must appear together");
    required(Array.isArray(captured.points) && captured.points.length <= MAX_BACKFILL_POINTS, path + ".points is invalid");
    required(typeof captured.pointsTruncated === "boolean", path + ".pointsTruncated must be boolean");
    var from = Date.parse(captured.fromInclusive);
    var through = Date.parse(captured.throughInclusive);
    var previous = null;
    captured.points.forEach(function (point, index) {
      var pointPath = path + ".points[" + index + "]";
      validateExactKeys(point, BACKFILL_POINT_KEYS, pointPath);
      required(validIsoTimestamp(point.at), pointPath + ".at is invalid");
      required(Number.isFinite(point.realizedPnl), pointPath + ".realizedPnl must be finite");
      var at = Date.parse(point.at);
      required(at >= from && at <= through, pointPath + ".at is outside the captured interval");
      required(previous === null || at > previous, path + ".points timestamps must be strictly increasing");
      previous = at;
    });
    if (captured.points.length === 0) {
      required(captured.realizedPnl === null, path + ".points cannot be empty with a finite subtotal");
      required(captured.pointsTruncated === false, path + ".pointsTruncated cannot be true for an empty series");
      return;
    }
    required(
      Number.isFinite(captured.realizedPnl) &&
      Math.abs(captured.points[captured.points.length - 1].realizedPnl - captured.realizedPnl) <= BACKFILL_ENDPOINT_TOLERANCE,
      path + ".points endpoint must match realizedPnl"
    );
  }

  function validateBackfillCount(value, path) {
    required(Number.isInteger(value) && value >= 0 && value <= MAX_BACKFILL_COUNT, path + " is invalid");
  }

  function validateBackfillInterval(interval, path) {
    validateExactKeys(interval, BACKFILL_INTERVAL_KEYS, path);
    required(validIsoTimestamp(interval.fromInclusive), path + ".fromInclusive is invalid");
    required(validIsoTimestamp(interval.toExclusive), path + ".toExclusive is invalid");
    required(Date.parse(interval.fromInclusive) < Date.parse(interval.toExclusive), path + " must have positive duration");
  }

  function validateBackfill(backfill, path) {
    validateExactKeys(backfill, BACKFILL_KEYS, path);
    required(["BEST_AVAILABLE", "COMPLETE"].includes(backfill.status), path + ".status is invalid");
    required(typeof backfill.fullTotalAvailable === "boolean", path + ".fullTotalAvailable must be boolean");
    validateBackfillCount(backfill.missingOpeningLotCount, path + ".missingOpeningLotCount");
    validateBackfillCount(backfill.orphanCommissionCount, path + ".orphanCommissionCount");

    var captured = backfill.capturedSubtotal;
    var capturedPath = path + ".capturedSubtotal";
    validateExactKeys(captured, BACKFILL_CAPTURE_KEYS, capturedPath, BACKFILL_CAPTURE_REQUIRED_KEYS);
    finiteOrNull(captured.realizedPnl, capturedPath + ".realizedPnl");
    required(["USD", "EUR", null].includes(captured.currency), capturedPath + ".currency is invalid");
    required(!Number.isFinite(captured.realizedPnl) || captured.currency !== null, capturedPath + ".currency is required for finite subtotal");
    if (Object.prototype.hasOwnProperty.call(captured, "method")) {
      required([CAPTURED_FIFO_METHOD, null].includes(captured.method), capturedPath + ".method is invalid");
    }
    required(
      captured.realizedPnl !== null || captured.method !== CAPTURED_FIFO_METHOD,
      capturedPath + ".method must be null when subtotal is unavailable"
    );
    validateBackfillCount(captured.executionCount, capturedPath + ".executionCount");
    validateBackfillCount(captured.commissionCount, capturedPath + ".commissionCount");
    required(validIsoTimestamp(captured.fromInclusive), capturedPath + ".fromInclusive is invalid");
    required(validIsoTimestamp(captured.throughInclusive), capturedPath + ".throughInclusive is invalid");
    required(Date.parse(captured.fromInclusive) <= Date.parse(captured.throughInclusive), capturedPath + " interval is invalid");
    validateBackfillPoints(captured, capturedPath);

    var coverage = backfill.coverage;
    var coveragePath = path + ".coverage";
    validateExactKeys(coverage, BACKFILL_COVERAGE_KEYS, coveragePath);
    validateBackfillInterval(coverage.target, coveragePath + ".target");
    validateBackfillCount(coverage.completeIntervalCount, coveragePath + ".completeIntervalCount");
    validateBackfillCount(coverage.knownIntervalCount, coveragePath + ".knownIntervalCount");
    validateBackfillCount(coverage.gapCount, coveragePath + ".gapCount");
    if (coverage.firstGap === null) {
      required(coverage.gapCount === 0, coveragePath + ".firstGap is required when gaps exist");
    } else {
      validateBackfillInterval(coverage.firstGap, coveragePath + ".firstGap");
      required(coverage.gapCount > 0, coveragePath + ".firstGap must be null without gaps");
    }
    if (backfill.fullTotalAvailable) {
      required(
        backfill.status === "COMPLETE" && coverage.gapCount === 0 &&
        backfill.missingOpeningLotCount === 0 && backfill.orphanCommissionCount === 0,
        path + ".fullTotalAvailable conflicts with incomplete coverage"
      );
    }
    return backfill;
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

  function backfillPresentation(backfill, deskMoney) {
    if (!backfill) { return null; }
    var captured = backfill.capturedSubtotal;
    var coverage = backfill.coverage;
    var completeJMoney = deskMoney && Number.isFinite(deskMoney.equity) && Number.isFinite(deskMoney.totalPnl);
    var subtotal = Number.isFinite(captured.realizedPnl) && captured.currency
      ? captured.currency + " " + formatPositionMoney(captured.realizedPnl, true, captured.currency)
      : "Captured subtotal unavailable";
    var knownCount = coverage.knownIntervalCount;
    var interval = "Known capture " + shortTime.format(new Date(captured.fromInclusive)) + " → " +
      shortTime.format(new Date(captured.throughInclusive)) + " · " + knownCount +
      " known interval" + (knownCount === 1 ? "" : "s");
    var coverageText;
    if (backfill.fullTotalAvailable) {
      coverageText = "Coverage reports complete; captured results remain separate from J totals.";
    } else if (coverage.gapCount > 0) {
      coverageText = (completeJMoney ? "Historical capture gap: " : "Full J total unavailable · Coverage gap: ") + coverage.gapCount +
        (coverage.firstGap
          ? "; first " + shortTime.format(new Date(coverage.firstGap.fromInclusive)) + " → " +
            shortTime.format(new Date(coverage.firstGap.toExclusive))
          : "");
    } else if (backfill.status === "COMPLETE") {
      coverageText = completeJMoney
        ? "Historical capture coverage is complete; current J accounting is shown separately."
        : "Full J total unavailable · Coverage is complete, but no verified total is available.";
    } else {
      coverageText = completeJMoney
        ? "Historical capture is best-available and not a complete history."
        : "Full J total unavailable · Best-available coverage is not a complete history.";
    }
    var quality = [];
    if (backfill.missingOpeningLotCount) {
      quality.push(backfill.missingOpeningLotCount + " missing opening lot" + (backfill.missingOpeningLotCount === 1 ? "" : "s"));
    }
    if (backfill.orphanCommissionCount) {
      quality.push(backfill.orphanCommissionCount + " unmatched commission" + (backfill.orphanCommissionCount === 1 ? "" : "s"));
    }
    return {
      title: backfill.fullTotalAvailable ? "Captured results" : "Captured results (partial)",
      subtotal: subtotal + " · " + captured.executionCount + " fills · " + captured.commissionCount + " commissions",
      method: Number.isFinite(captured.realizedPnl) && captured.method === CAPTURED_FIFO_METHOD
        ? "J-family FIFO, net of fees"
        : null,
      interval: interval,
      coverage: coverageText,
      fx: captured.currency === "USD" && !backfill.fullTotalAvailable
        ? "Historical EUR FX is not evidenced; the subtotal stays in USD."
        : null,
      quality: quality.join(" · "),
      captureTitle: captured.fromInclusive + " through " + captured.throughInclusive,
      targetTitle: coverage.target.fromInclusive + " to " + coverage.target.toExclusive
    };
  }

  function capturedHistorySeries(backfill) {
    var captured = backfill && backfill.capturedSubtotal;
    var source = captured && Array.isArray(captured.points) ? captured.points : [];
    if (!source.length) { return { available: false, points: [], path: "", zeroY: null }; }
    var width = 320;
    var height = 96;
    var insetX = 10;
    var insetY = 12;
    var times = source.map(function (point) { return Date.parse(point.at); });
    var values = source.map(function (point) { return point.realizedPnl; });
    var firstTime = times[0];
    var lastTime = times[times.length - 1];
    var low = Math.min.apply(null, values);
    var high = Math.max.apply(null, values);
    function xFor(time) {
      return firstTime === lastTime ? width / 2 : insetX + ((time - firstTime) / (lastTime - firstTime)) * (width - insetX * 2);
    }
    function yFor(value) {
      return low === high ? height / 2 : insetY + ((high - value) / (high - low)) * (height - insetY * 2);
    }
    var points = source.map(function (point, index) {
      return { at: point.at, realizedPnl: point.realizedPnl, x: xFor(times[index]), y: yFor(point.realizedPnl) };
    });
    return {
      available: true,
      width: width,
      height: height,
      points: points,
      low: low,
      high: high,
      path: points.length > 1 ? points.map(function (point, index) {
        return (index ? "L" : "M") + point.x.toFixed(2) + " " + point.y.toFixed(2);
      }).join(" ") : "",
      zeroY: low <= 0 && high >= 0 ? yFor(0) : null
    };
  }

  function svgEl(tag, className) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (className) { node.setAttribute("class", className); }
    return node;
  }

  function renderCapturedHistory(backfill) {
    var captured = backfill.capturedSubtotal;
    var currency = captured.currency || "currency unavailable";
    var titleText = "Captured J history · " + currency + " · " + (backfill.fullTotalAvailable ? "complete" : "partial");
    var details = el("details", "desk-backfill-history");
    details.appendChild(el("summary", "desk-backfill-history-summary", titleText));
    var series = capturedHistorySeries(backfill);
    if (!series.available) {
      details.appendChild(el("p", "desk-backfill-history-empty", "Captured J history is unavailable."));
      return details;
    }

    var svg = svgEl("svg", "desk-backfill-chart");
    svg.setAttribute("viewBox", "0 0 " + series.width + " " + series.height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", titleText);
    var title = svgEl("title");
    title.textContent = titleText;
    svg.appendChild(title);
    if (series.zeroY !== null) {
      var zero = svgEl("line", "desk-backfill-zero");
      zero.setAttribute("x1", "0");
      zero.setAttribute("x2", String(series.width));
      zero.setAttribute("y1", series.zeroY.toFixed(2));
      zero.setAttribute("y2", series.zeroY.toFixed(2));
      svg.appendChild(zero);
    }
    if (series.path) {
      var path = svgEl("path", "desk-backfill-path");
      path.setAttribute("d", series.path);
      svg.appendChild(path);
    }
    series.points.forEach(function (point, index) {
      if (series.points.length > 1 && index !== series.points.length - 1) { return; }
      var dot = svgEl("circle", "desk-backfill-point");
      dot.setAttribute("cx", point.x.toFixed(2));
      dot.setAttribute("cy", point.y.toFixed(2));
      dot.setAttribute("r", series.points.length === 1 ? "3.5" : "2.5");
      svg.appendChild(dot);
    });
    details.appendChild(svg);
    var first = series.points[0];
    var last = series.points[series.points.length - 1];
    var meta = series.points.length === 1
      ? "Actual point " + shortTime.format(new Date(first.at)) + " · " + currency + " " + formatPositionMoney(first.realizedPnl, true, currency)
      : shortTime.format(new Date(first.at)) + " → " + shortTime.format(new Date(last.at)) + " · " + series.points.length + " actual points";
    details.appendChild(el("p", "desk-backfill-history-meta", meta));
    if (captured.pointsTruncated) {
      details.appendChild(el("p", "desk-backfill-history-meta", "Showing only the latest captured points."));
    }
    return details;
  }

  function renderBackfill(backfill, deskMoney) {
    var copy = backfillPresentation(backfill, deskMoney);
    if (!copy) { return null; }
    var root = el("section", "desk-backfill");
    root.appendChild(el("h3", "desk-backfill-title", copy.title));
    root.appendChild(el("p", "desk-backfill-subtotal", copy.subtotal));
    if (copy.method) { root.appendChild(el("p", "desk-backfill-meta", copy.method)); }
    var interval = el("p", "desk-backfill-meta", copy.interval);
    interval.title = copy.captureTitle;
    root.appendChild(interval);
    var coverage = el("p", "desk-backfill-coverage", copy.coverage);
    coverage.title = copy.targetTitle;
    root.appendChild(coverage);
    if (copy.fx) { root.appendChild(el("p", "desk-backfill-meta", copy.fx)); }
    if (copy.quality) { root.appendChild(el("p", "desk-backfill-meta", copy.quality)); }
    root.appendChild(renderCapturedHistory(backfill));
    return root;
  }

  function validate(data) {
    required(data && typeof data === "object", "data must be an object");
    required(data.schema === "inspr.joe.household.v1", "unknown schema");
    required(data.mode === "PAPER", "mode must be PAPER");
    required(data.currency === "EUR", "currency must be EUR");
    required(!Number.isNaN(Date.parse(data.generatedAt)), "generatedAt must be an ISO timestamp");
    var hasBoardHealth = Object.prototype.hasOwnProperty.call(data, "boardHealth");
    var hasShortReason = Object.prototype.hasOwnProperty.call(data, "shortReason");
    required(hasBoardHealth === hasShortReason, "boardHealth and shortReason must appear together");
    if (hasBoardHealth && hasShortReason) {
      required(BOARD_HEALTH_TONES.includes(data.boardHealth), "boardHealth is invalid");
      required(Object.prototype.hasOwnProperty.call(BOARD_HEALTH_REASON_TONES, data.shortReason), "shortReason is invalid");
      required(BOARD_HEALTH_REASON_TONES[data.shortReason] === data.boardHealth, "shortReason does not match boardHealth");
    }
    required(data.safety && typeof data.safety === "object", "safety is required");
    required(typeof data.safety.halt === "boolean", "safety.halt must be boolean");
    required(["ok", "degraded", "down"].includes(data.safety.gateway && data.safety.gateway.status), "gateway status is invalid");
    required(Number.isFinite(data.safety.staleAfterSeconds) && data.safety.staleAfterSeconds > 0, "staleAfterSeconds is invalid");
    if (Object.prototype.hasOwnProperty.call(data, "brokerAccount")) { validateBrokerAccount(data.brokerAccount); }
    if (Object.prototype.hasOwnProperty.call(data, "pnlSources")) { validatePnlSources(data.pnlSources); }
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
      if (Object.prototype.hasOwnProperty.call(desk, "moneyEvidence")) { validateMoneyEvidence(desk.moneyEvidence, path + ".moneyEvidence"); }
      if (Object.prototype.hasOwnProperty.call(desk, "accounting")) { validateAccounting(desk.accounting, path + ".accounting"); }
      if (Object.prototype.hasOwnProperty.call(desk, "historyBasis")) { validateHistoryBasis(desk.historyBasis, path + ".historyBasis"); }
      if (Object.prototype.hasOwnProperty.call(desk, "backfill")) {
        required(desk.id === "j", path + ".backfill is only valid for desk j");
        validateBackfill(desk.backfill, path + ".backfill");
      }
      required(Array.isArray(desk.issues), path + ".issues must be an array");
    });
    required(data.totals && typeof data.totals === "object", "totals are required");
    ["equity", "dayPnl", "totalPnl"].forEach(function (key) { finiteOrNull(data.totals[key], "totals." + key); });
    if (Object.prototype.hasOwnProperty.call(data.totals, "openPnl")) { finiteOrNull(data.totals.openPnl, "totals.openPnl"); }
    validatePnlEvidenceValues(data);
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

  function narrowHistoryFitRows(item, historyWidget, settings) {
    var minRows = NARROW_TILE_MIN_ROWS.history;
    if (!historyWidget) { return Math.max(minRows, item.h); }
    var overflow = Math.max(0, Math.ceil(historyWidget.scrollHeight - historyWidget.clientHeight));
    var currentOuterPixels = narrowGridTilePixels(item.h, settings);
    return Math.max(minRows, item.h, narrowRowsForOuterPixels(currentOuterPixels + overflow, settings));
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

  function loadFittedNarrowLayout(items) {
    if (!grid) { return false; }
    var animated = typeof grid.hasAnimationCSS === "function" && grid.hasAnimationCSS();
    if (animated) { grid.setAnimation(false); }
    try {
      grid.load(items, false);
      // GridStack updates node.h before its animated CSS height settles. A
      // content fit must expose the matching box before the next measurement.
      if (grid.el) { void grid.el.offsetHeight; }
    } finally {
      if (animated) { grid.setAnimation(true); }
    }
    return true;
  }

  function fitNarrowLayoutToContent(pass) {
    if (!grid || !isNarrowGridViewport() || restoringLayout) { return false; }
    var settings = activeGridSettings;
    var nodes = grid.engine && grid.engine.nodes ? grid.engine.nodes.slice() : [];
    if (!nodes.length) { return false; }
    var byId = {};
    nodes.forEach(function (node) {
      byId[node.id] = node;
    });
    var items = resolvePhoneOrder(activePhoneOrder, desktopLayoutSnapshot() || DEFAULT_LAYOUT).map(function (id) {
      var node = byId[id];
      return { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h };
    });
    var changed = false;
    items = items.map(function (item) {
      var itemEl = document.querySelector('#joeGrid [gs-id="' + item.id + '"]');
      var measureEl = narrowMeasureElement(itemEl, item.id);
      var contentPixels = measureEl ? Math.ceil(measureEl.scrollHeight) : 0;
      var minContent = NARROW_TILE_MIN_PIXELS[item.id] || 0;
      if (contentPixels < minContent) { contentPixels = minContent; }
      var needRows = item.id === "history"
        ? narrowHistoryFitRows(item, measureEl, settings)
        : Math.max(
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
    loadFittedNarrowLayout(stacked);
    restoringLayout = false;
    if ((pass || 0) + 1 < NARROW_FIT_MAX_PASSES) { scheduleNarrowFit((pass || 0) + 1); }
    return true;
  }

  function narrowLayoutFromItems(items, settings, phoneOrder) {
    if (!Array.isArray(items)) { return null; }
    var byId = {};
    items.forEach(function (item) { byId[item.id] = item; });
    var sorted = resolvePhoneOrder(phoneOrder, items).map(function (id) {
      return byId[id];
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
    return writeJsonStorage(LAYOUT_KEY, clean);
  }

  function loadNarrowGridLayout(desktopItems) {
    var narrowItems = narrowLayoutFromItems(desktopItems, activeGridSettings, activePhoneOrder);
    if (!narrowItems || !grid) { return false; }
    var wasRestoring = restoringLayout;
    restoringLayout = true;
    if (typeof grid.checkDynamicColumn === "function") { grid.checkDynamicColumn(); }
    loadFittedNarrowLayout(narrowItems);
    restoringLayout = wasRestoring;
    scheduleNarrowFit(0);
    return true;
  }

  function restoreDesktopGridLayout(columns) {
    if (!grid) { return; }
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    var desktop = desktopLayoutSnapshot() || DEFAULT_LAYOUT.slice();
    var wasRestoring = restoringLayout;
    restoringLayout = true;
    if (grid.getColumn() !== cols) {
      grid.column(cols, "moveScale");
    }
    grid.load(desktop, false);
    restoringLayout = wasRestoring;
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

  function syncGridDragScrollPolicy(onNarrow) {
    if (!grid || !grid.opts || !grid.opts.draggable) { return; }
    grid.opts.draggable.scroll = !onNarrow;
  }

  function syncGridColumnConfig(columns) {
    if (!grid) { return; }
    var cols = SUPPORTED_COLUMNS.includes(columns) ? columns : DEFAULT_GRID_SETTINGS.columns;
    var onNarrow = isNarrowGridViewport();
    syncGridDragScrollPolicy(onNarrow);
    grid.opts.columnOpts = columnOptsFor(cols);
    if (onNarrow) {
      if (!narrowGridActive) {
        if (!restoringLayout) { persistDesktopLayoutGeometry(cols); }
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
    var wasRestoring = restoringLayout;
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
    restoringLayout = wasRestoring;
    return items;
  }

  function persistDesktopLayoutGeometry(cols) {
    var saved = captureDesktopGridLayout(cols);
    if (!saved) { return false; }
    rememberDesktopLayout(saved);
    return writeJsonStorage(LAYOUT_KEY, saved);
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

  function readStoredGridSettings() {
    try {
      var stored = localStorage.getItem(SETTINGS_KEY);
      return stored === null ? null : sanitizeGridSettings(JSON.parse(stored));
    } catch (_) {
      return null;
    }
  }

  function readActiveGridSettings() {
    return readStoredGridSettings() || Object.assign({}, DEFAULT_GRID_SETTINGS);
  }

  function writeActiveGridSettings(settings) {
    return writeJsonStorage(SETTINGS_KEY, sanitizeGridSettings(settings));
  }

  function applyTilePadding(padding) {
    document.documentElement.style.setProperty("--joe-tile-padding", padding + "px");
  }

  function applyGridSettings(settings, skipPersist) {
    var previousSettings = activeGridSettings;
    var narrowSettingsChange = Boolean(grid && isNarrowGridViewport() && previousSettings.columns !== sanitizeGridSettings(settings).columns);
    var previousDesktop = narrowSettingsChange ? desktopLayoutSnapshot() : null;
    var clean = sanitizeGridSettings(settings);
    activeGridSettings = clean;
    var scaledDesktop = narrowSettingsChange
      ? scaleLayoutColumns(previousDesktop, previousSettings.columns, clean.columns)
      : null;
    if (scaledDesktop) {
      rememberDesktopLayout(scaledDesktop);
      narrowGridActive = true;
    }
    applyTilePadding(clean.tilePadding);
    if (grid) {
      grid.opts.columnOpts = columnOptsFor(clean.columns);
      grid.cellHeight(clean.cellHeight);
      grid.margin(clean.tileGap);
      syncGridColumnConfig(clean.columns);
    }
    if (isNarrowGridViewport() && !restoringLayout) {
      if (scaledDesktop) { persistDesktopItems(scaledDesktop); }
      else { persistDesktopLayoutGeometry(clean.columns); }
    }
    var persisted = true;
    if (!skipPersist) {
      persisted = persistDraftSnapshot(currentLayoutSnapshot());
      if (!persisted) { setLayoutStatus("Settings applied for this session but storage is unavailable.", true); }
      if (layoutBaseline) { refreshLayoutDirty(true); }
    }
    resizeVisuals();
    if (historyState.chart) { drawHistory(); }
    return persisted;
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

  function derivePhoneOrder(items) {
    var requiredIds = DEFAULT_LAYOUT.map(function (item) { return item.id; });
    var allowed = new Set(requiredIds);
    var seen = new Set();
    var candidates = [];
    if (Array.isArray(items)) {
      items.forEach(function (item) {
        if (!item || !allowed.has(item.id) || seen.has(item.id) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) { return; }
        seen.add(item.id);
        candidates.push(item);
      });
    }
    if (candidates.length !== requiredIds.length) {
      candidates = DEFAULT_LAYOUT.slice();
    }
    return candidates.slice().sort(function (a, b) {
      if (a.y !== b.y) { return a.y - b.y; }
      if (a.x !== b.x) { return a.x - b.x; }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }).map(function (item) { return item.id; });
  }

  function sanitizePhoneOrder(value) {
    if (!Array.isArray(value) || value.length !== DEFAULT_LAYOUT.length) { return null; }
    var allowed = new Set(DEFAULT_LAYOUT.map(function (item) { return item.id; }));
    var seen = new Set();
    var clean = [];
    for (var i = 0; i < value.length; i += 1) {
      var id = value[i];
      if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) { return null; }
      seen.add(id);
      clean.push(id);
    }
    return seen.size === allowed.size ? clean : null;
  }

  function resolvePhoneOrder(value, items) {
    return sanitizePhoneOrder(value) || derivePhoneOrder(items);
  }

  function phoneOrdersEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(function (id, index) {
      return id === right[index];
    });
  }

  function gridSettingsEqual(left, right) {
    var a = sanitizeGridSettings(left);
    var b = sanitizeGridSettings(right);
    return a.columns === b.columns && a.cellHeight === b.cellHeight &&
      a.tilePadding === b.tilePadding && a.tileGap === b.tileGap;
  }

  function makeLayoutSnapshot(items, settings, phoneOrder) {
    var cleanSettings = sanitizeGridSettings(settings);
    var cleanItems = sanitizeLayoutItems(items, cleanSettings.columns);
    if (!cleanItems) { return null; }
    return { items: cleanItems, settings: cleanSettings, phoneOrder: resolvePhoneOrder(phoneOrder, cleanItems) };
  }

  function layoutSnapshotsEqual(left, right) {
    return Boolean(left && right && layoutItemsEqual(left.items, right.items) && gridSettingsEqual(left.settings, right.settings) &&
      phoneOrdersEqual(left.phoneOrder, right.phoneOrder));
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

  function scaleLayoutColumns(items, fromColumns, toColumns) {
    var from = SUPPORTED_COLUMNS.includes(fromColumns) ? fromColumns : DEFAULT_GRID_SETTINGS.columns;
    var to = SUPPORTED_COLUMNS.includes(toColumns) ? toColumns : DEFAULT_GRID_SETTINGS.columns;
    var clean = sanitizeLayoutItems(items, from);
    if (!clean) { return null; }
    if (from === to) { return clean; }
    return sanitizeLayoutItems(clean.map(function (item) {
      var x = Math.round(item.x * to / from);
      var w = Math.max(1, Math.round(item.w * to / from));
      if (x + w > to) { x = Math.max(0, to - w); }
      return { id: item.id, x: x, y: item.y, w: w, h: item.h };
    }), to);
  }

  function safeStoredLayout(preserveLegacyGeometry) {
    try {
      var parsed = sanitizeLayoutItems(JSON.parse(localStorage.getItem(LAYOUT_KEY)), desktopColumnCount());
      if (!parsed) { return null; }
      var migrated = preserveLegacyGeometry ? parsed : migrateLegacyDefaultLayout(parsed);
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
    var normalized = { id: id, name: name, items: items, settings: settings, builtin: false };
    var phoneOrder = sanitizePhoneOrder(entry.phoneOrder);
    if (phoneOrder) { normalized.phoneOrder = phoneOrder; }
    return normalized;
  }

  function uniqueCatalogText(value, used, maxLength) {
    var base = String(value || "Layout").trim() || "Layout";
    var candidate = base.slice(0, maxLength);
    var suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      var ending = " (" + suffix + ")";
      candidate = base.slice(0, Math.max(1, maxLength - ending.length)) + ending;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function uniqueCatalogId(value, used) {
    var base = String(value || "layout").slice(0, 64) || "layout";
    var candidate = base;
    var suffix = 2;
    while (used.has(candidate)) {
      var ending = "-" + suffix;
      candidate = base.slice(0, Math.max(1, 64 - ending.length)) + ending;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function canonicalLayoutsCatalog(layouts) {
    var usedIds = new Set([DEFAULT_LAYOUT_ID]);
    var usedNames = new Set(["default"]);
    var normalized = [];
    var sawStoredDefault = false;
    (Array.isArray(layouts) ? layouts : []).forEach(function (rawEntry) {
      if (rawEntry && rawEntry.id === DEFAULT_LAYOUT_ID && !sawStoredDefault) {
        sawStoredDefault = true;
        return;
      }
      var candidateEntry = rawEntry && rawEntry.id === DEFAULT_LAYOUT_ID
        ? Object.assign({}, rawEntry, { id: DEFAULT_LAYOUT_ID + "-copy" })
        : rawEntry;
      var entry = normalizeLayoutEntry(candidateEntry);
      if (!entry) { return; }
      entry.id = uniqueCatalogId(entry.id, usedIds);
      entry.name = uniqueCatalogText(entry.name, usedNames, 48);
      normalized.push(entry);
    });
    normalized.unshift(defaultLayoutEntry());
    return { schema: "inspr.joe.layouts.v1", layouts: normalized };
  }

  function readLayoutsCatalog() {
    try {
      var raw = JSON.parse(localStorage.getItem(LAYOUTS_KEY));
      if (!raw || raw.schema !== "inspr.joe.layouts.v1" || !Array.isArray(raw.layouts)) {
        return defaultLayoutsCatalog();
      }
      var canonical = canonicalLayoutsCatalog(raw.layouts);
      if (JSON.stringify(raw) !== JSON.stringify(canonical)) {
        try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(canonical)); } catch (_) {}
      }
      return canonical;
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
      var canonical = canonicalLayoutsCatalog(catalog.layouts);
      var serialized = JSON.stringify(canonical);
      localStorage.setItem(LAYOUTS_KEY, serialized);
      return localStorage.getItem(LAYOUTS_KEY) === serialized;
    } catch (_) {
      return false;
    }
  }

  function readActiveLayoutId(catalog) {
    var available = catalog || readLayoutsCatalog();
    try {
      var stored = localStorage.getItem(ACTIVE_LAYOUT_KEY);
      if (available.layouts.some(function (entry) { return entry.id === stored; })) { return stored; }
    } catch (_) {}
    return DEFAULT_LAYOUT_ID;
  }

  function writeActiveLayoutId(entryId) {
    try {
      localStorage.setItem(ACTIVE_LAYOUT_KEY, entryId);
      return localStorage.getItem(ACTIVE_LAYOUT_KEY) === entryId;
    } catch (_) {
      return false;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      var serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return localStorage.getItem(key) === serialized;
    } catch (_) {
      return false;
    }
  }

  function readStoredPhoneOrder() {
    try {
      return sanitizePhoneOrder(JSON.parse(localStorage.getItem(PHONE_ORDER_KEY)));
    } catch (_) {
      return null;
    }
  }

  function resolveInitialLayoutState(catalog, entryId, draftItems, draftSettings, draftPhoneOrder) {
    var available = catalog || defaultLayoutsCatalog();
    var activeEntry = available.layouts.find(function (entry) { return entry.id === entryId; }) || defaultLayoutEntry();
    var hasDraftSettings = draftSettings !== null && draftSettings !== undefined;
    var settings = hasDraftSettings ? sanitizeGridSettings(draftSettings) : sanitizeGridSettings(activeEntry.settings);
    var items = sanitizeLayoutItems(draftItems, settings.columns);
    if (!items) {
      items = scaleLayoutColumns(activeEntry.items, activeEntry.settings.columns, settings.columns);
    }
    var baseline = entryLayoutSnapshot(activeEntry);
    var phoneOrder = sanitizePhoneOrder(draftPhoneOrder) || sanitizePhoneOrder(activeEntry.phoneOrder);
    var snapshot = makeLayoutSnapshot(items, settings, phoneOrder);
    return {
      activeId: activeEntry.id,
      items: snapshot.items,
      settings: snapshot.settings,
      phoneOrder: snapshot.phoneOrder,
      baseline: baseline,
      dirty: !layoutSnapshotsEqual(snapshot, baseline)
    };
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

  function currentLayoutSnapshot() {
    return makeLayoutSnapshot(currentGridLayout(), activeGridSettings, activePhoneOrder);
  }

  function entryLayoutSnapshot(entry) {
    return entry ? makeLayoutSnapshot(entry.items, entry.settings, entry.phoneOrder) : null;
  }

  function persistDraftSnapshot(snapshot) {
    if (!snapshot) { return false; }
    var geometryOk = writeJsonStorage(LAYOUT_KEY, snapshot.items);
    var settingsOk = writeJsonStorage(SETTINGS_KEY, snapshot.settings);
    var phoneOrderOk = writeJsonStorage(PHONE_ORDER_KEY, snapshot.phoneOrder);
    return geometryOk && settingsOk && phoneOrderOk;
  }

  function refreshLayoutDirty(announce) {
    var wasDirty = layoutDirty;
    layoutDirty = !layoutSnapshotsEqual(currentLayoutSnapshot(), layoutBaseline);
    updateLayoutControlState();
    if (announce && layoutDirty && !wasDirty) {
      setLayoutStatus("Layout has unsaved changes.");
    }
    return layoutDirty;
  }

  function applyGridLayout(items, skipPersist) {
    if (!grid) { return false; }
    var clean = sanitizeLayoutItems(items, desktopColumnCount());
    if (!clean) { return false; }
    rememberDesktopLayout(clean);
    var wasRestoring = restoringLayout;
    restoringLayout = true;
    if (isNarrowGridViewport()) {
      loadNarrowGridLayout(clean);
    } else {
      grid.load(clean, false);
    }
    restoringLayout = wasRestoring;
    if (!skipPersist && !persistDraftSnapshot(makeLayoutSnapshot(clean, activeGridSettings, activePhoneOrder))) {
      setLayoutStatus("Layout changed for this session but storage is unavailable.", true);
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
    var selected = catalog.layouts.find(function (entry) { return entry.id === activeLayoutId; });
    var saveButton = document.getElementById("saveLayout");
    if (saveButton) { saveButton.disabled = !layoutDirty; }
    document.getElementById("deleteLayout").disabled = !selected || selected.builtin;
    document.getElementById("renameLayout").disabled = !selected || selected.builtin;
    var toolbar = document.getElementById("layoutToolbar");
    if (toolbar) { toolbar.dataset.dirty = layoutDirty ? "true" : "false"; }
    select.setAttribute("aria-label", (selected ? selected.name : "Saved layout") + (layoutDirty ? " (unsaved changes)" : ""));
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
    var current = selectedId || activeLayoutId || select.value;
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

  function hideLayoutForm(keepPendingSelection) {
    layoutFormMode = null;
    document.getElementById("layoutInlineForm").hidden = true;
    document.getElementById("layoutNameInput").value = "";
    if (keepPendingSelection !== true) {
      pendingLayoutSelectionId = null;
      renderLayoutSelect(activeLayoutId);
    }
  }

  function showLayoutForm(mode) {
    if (!grid) { return; }
    layoutFormMode = mode;
    var menu = document.getElementById("layoutMenu");
    var input = document.getElementById("layoutNameInput");
    var select = document.getElementById("layoutSelect");
    var catalog = readLayoutsCatalog();
    var selected = catalog.layouts.find(function (entry) { return entry.id === select.value; });
    input.value = mode === "rename" && selected ? selected.name : "";
    if (menu) { menu.open = true; }
    document.getElementById("layoutInlineForm").hidden = false;
    input.focus();
    input.select();
  }

  function uniqueLayoutId(name, catalog) {
    var base = String(name || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "layout";
    var available = catalog || readLayoutsCatalog();
    var candidate = base;
    var suffix = 2;
    while (available.layouts.some(function (entry) { return entry.id === candidate; })) {
      var ending = "-" + suffix;
      candidate = base.slice(0, Math.max(1, 64 - ending.length)) + ending;
      suffix += 1;
    }
    return candidate.slice(0, 64);
  }

  function findLayoutByName(catalog, name, exceptId) {
    var wanted = String(name || "").trim().toLowerCase();
    return catalog.layouts.find(function (entry) {
      return entry.id !== exceptId && entry.name.toLowerCase() === wanted;
    });
  }

  function applyLayoutEntryLive(entry) {
    var snapshot = entryLayoutSnapshot(entry);
    if (!snapshot || !grid) { return false; }
    var wasRestoring = restoringLayout;
    restoringLayout = true;
    activeGridSettings = snapshot.settings;
    activePhoneOrder = snapshot.phoneOrder;
    rememberDesktopLayout(snapshot.items);
    applyGridSettings(snapshot.settings, true);
    var applied = applyGridLayout(snapshot.items, true);
    restoringLayout = wasRestoring;
    if (!applied) { return false; }
    activeLayoutId = entry.id;
    layoutBaseline = snapshot;
    layoutDirty = false;
    renderLayoutSelect(activeLayoutId);
    return true;
  }

  function loadLayoutById(entryId) {
    if (!grid) { return false; }
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === entryId; });
    var snapshot = entryLayoutSnapshot(entry);
    if (!entry || !snapshot) {
      setLayoutStatus("Choose a saved layout.", true);
      renderLayoutSelect(activeLayoutId);
      return false;
    }
    if (!persistDraftSnapshot(snapshot) || !writeActiveLayoutId(entry.id)) {
      setLayoutStatus("That layout could not be loaded because storage is unavailable.", true);
      renderLayoutSelect(activeLayoutId);
      return false;
    }
    if (!applyLayoutEntryLive(entry)) {
      setLayoutStatus("That layout could not be loaded.", true);
      renderLayoutSelect(activeLayoutId);
      return false;
    }
    setLayoutStatus('Loaded layout "' + entry.name + '".');
    return true;
  }

  function completePendingLayoutSelection() {
    if (!pendingLayoutSelectionId) { return true; }
    var nextId = pendingLayoutSelectionId;
    pendingLayoutSelectionId = null;
    return loadLayoutById(nextId);
  }

  function saveNamedLayout(name) {
    if (!grid) { return false; }
    var trimmed = String(name || "").trim();
    if (!trimmed) {
      setLayoutStatus("Enter a layout name.", true);
      return false;
    }
    var catalog = readLayoutsCatalog();
    var conflict = findLayoutByName(catalog, trimmed);
    if (conflict && conflict.builtin) {
      setLayoutStatus('"Default" is reserved. Choose another layout name.', true);
      return false;
    }
    if (conflict && !window.confirm('Replace the saved layout "' + conflict.name + '"?')) {
      return false;
    }
    if (!conflict && catalog.layouts.length >= MAX_LAYOUTS) {
      setLayoutStatus("Layout catalog is full (" + MAX_LAYOUTS + " saved layouts). Delete one before saving.", true);
      return false;
    }
    var snapshot = currentLayoutSnapshot();
    if (!snapshot) {
      setLayoutStatus("That layout could not be saved with the current grid settings.", true);
      return false;
    }
    var entry = {
      id: conflict ? conflict.id : uniqueLayoutId(trimmed, catalog),
      name: trimmed,
      items: snapshot.items,
      settings: snapshot.settings,
      phoneOrder: snapshot.phoneOrder,
      builtin: false
    };
    if (conflict) {
      catalog.layouts = catalog.layouts.map(function (item) { return item.id === conflict.id ? entry : item; });
    } else {
      catalog.layouts.push(entry);
    }
    if (!persistDraftSnapshot(snapshot) || !writeNamedLayoutsCatalog(catalog, entry.id) || !writeActiveLayoutId(entry.id)) {
      setLayoutStatus("That layout could not be saved because storage is unavailable.", true);
      return false;
    }
    activeLayoutId = entry.id;
    layoutBaseline = snapshot;
    layoutDirty = false;
    renderLayoutSelect(activeLayoutId);
    hideLayoutForm(true);
    setLayoutStatus('Saved layout "' + trimmed + '".');
    completePendingLayoutSelection();
    return true;
  }

  function saveCurrentNamedLayout() {
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === activeLayoutId; });
    if (!entry || entry.builtin) {
      showLayoutForm("save");
      return false;
    }
    if (!layoutDirty) { return true; }
    var snapshot = currentLayoutSnapshot();
    if (!snapshot) {
      setLayoutStatus("That layout could not be saved with the current grid settings.", true);
      return false;
    }
    entry.items = snapshot.items;
    entry.settings = snapshot.settings;
    entry.phoneOrder = snapshot.phoneOrder;
    if (!persistDraftSnapshot(snapshot) || !writeNamedLayoutsCatalog(catalog, entry.id) || !writeActiveLayoutId(entry.id)) {
      setLayoutStatus("That layout could not be saved because storage is unavailable.", true);
      return false;
    }
    layoutBaseline = snapshot;
    layoutDirty = false;
    renderLayoutSelect(activeLayoutId);
    setLayoutStatus('Saved layout "' + entry.name + '".');
    completePendingLayoutSelection();
    return true;
  }

  function renameSelectedLayout(name) {
    if (!grid) { return false; }
    var trimmed = String(name || "").trim();
    if (!trimmed) {
      setLayoutStatus("Enter a layout name.", true);
      return false;
    }
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === activeLayoutId; });
    if (!entry || entry.builtin) {
      setLayoutStatus("The default layout cannot be renamed.", true);
      return false;
    }
    var conflict = findLayoutByName(catalog, trimmed, entry.id);
    if (conflict && conflict.builtin) {
      setLayoutStatus('"Default" is reserved. Choose another layout name.', true);
      return false;
    }
    if (conflict && !window.confirm('Replace the saved layout "' + conflict.name + '"?')) {
      return false;
    }
    if (conflict) {
      catalog.layouts = catalog.layouts.filter(function (item) { return item.id !== conflict.id; });
    }
    entry.name = trimmed;
    if (!writeLayoutsCatalog(catalog) || !writeActiveLayoutId(entry.id)) {
      setLayoutStatus("Layout storage is unavailable.", true);
      return false;
    }
    renderLayoutSelect(entry.id);
    hideLayoutForm(true);
    setLayoutStatus('Renamed layout to "' + trimmed + '".');
    return true;
  }

  function cancelPendingLayoutSelection() {
    pendingLayoutSelectionId = null;
    renderLayoutSelect(activeLayoutId);
    var dialog = document.getElementById("layoutUnsavedDialog");
    if (dialog && dialog.open) { dialog.close(); }
  }

  function requestLayoutSelection(entryId) {
    if (!entryId || entryId === activeLayoutId) {
      renderLayoutSelect(activeLayoutId);
      return true;
    }
    if (!layoutDirty) { return loadLayoutById(entryId); }
    pendingLayoutSelectionId = entryId;
    renderLayoutSelect(activeLayoutId);
    var catalog = readLayoutsCatalog();
    var target = catalog.layouts.find(function (entry) { return entry.id === entryId; });
    var message = document.getElementById("layoutUnsavedMessage");
    if (message) {
      message.textContent = 'Save changes before switching to "' + (target ? target.name : "that layout") + '"?';
    }
    var dialog = document.getElementById("layoutUnsavedDialog");
    if (!dialog || typeof dialog.showModal !== "function") {
      cancelPendingLayoutSelection();
      setLayoutStatus("Unsaved layout changes must be saved or discarded before switching.", true);
      return false;
    }
    dialog.showModal();
    return false;
  }

  function discardAndCompletePendingSelection() {
    var dialog = document.getElementById("layoutUnsavedDialog");
    if (dialog && dialog.open) { dialog.close(); }
    return completePendingLayoutSelection();
  }

  function saveBeforePendingSelection() {
    var dialog = document.getElementById("layoutUnsavedDialog");
    if (dialog && dialog.open) { dialog.close(); }
    return saveCurrentNamedLayout();
  }

  function deleteSelectedLayout() {
    if (!grid) { return false; }
    var catalog = readLayoutsCatalog();
    var entry = catalog.layouts.find(function (item) { return item.id === activeLayoutId; });
    if (!entry || entry.builtin) {
      setLayoutStatus("The default layout cannot be deleted.", true);
      return false;
    }
    if (!window.confirm('Delete layout "' + entry.name + '"' + (layoutDirty ? " and discard its unsaved changes" : "") + "?")) {
      renderLayoutSelect(activeLayoutId);
      return false;
    }
    var fallback = defaultLayoutEntry();
    var fallbackSnapshot = entryLayoutSnapshot(fallback);
    if (!persistDraftSnapshot(fallbackSnapshot) || !writeActiveLayoutId(DEFAULT_LAYOUT_ID)) {
      setLayoutStatus("That layout could not be deleted because storage is unavailable.", true);
      return false;
    }
    catalog.layouts = catalog.layouts.filter(function (item) { return item.id !== entry.id; });
    if (!writeLayoutsCatalog(catalog)) {
      setLayoutStatus("Layout storage is unavailable.", true);
      return false;
    }
    applyLayoutEntryLive(fallback);
    setLayoutStatus('Deleted layout "' + entry.name + '".');
    return true;
  }

  function resetToDefaultLayout() {
    if (layoutDirty && !window.confirm("Discard unsaved layout changes and reset to Default?")) {
      renderLayoutSelect(activeLayoutId);
      return false;
    }
    return loadLayoutById(DEFAULT_LAYOUT_ID);
  }

  function bindLayoutControls() {
    renderLayoutSelect(activeLayoutId);
    document.getElementById("layoutSelect").addEventListener("change", function (event) {
      requestLayoutSelection(event.target.value);
    });
    document.getElementById("saveLayout").addEventListener("click", saveCurrentNamedLayout);
    var saveAsButton = document.getElementById("saveAsLayout");
    if (saveAsButton) { saveAsButton.addEventListener("click", function () { showLayoutForm("save"); }); }
    document.getElementById("renameLayout").addEventListener("click", function () { showLayoutForm("rename"); });
    document.getElementById("deleteLayout").addEventListener("click", deleteSelectedLayout);
    document.getElementById("layoutFormCancel").addEventListener("click", function () { hideLayoutForm(); });
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
    var unsavedDialog = document.getElementById("layoutUnsavedDialog");
    if (unsavedDialog) {
      document.getElementById("layoutUnsavedSave").addEventListener("click", saveBeforePendingSelection);
      document.getElementById("layoutUnsavedDiscard").addEventListener("click", discardAndCompletePendingSelection);
      document.getElementById("layoutUnsavedCancel").addEventListener("click", cancelPendingLayoutSelection);
      unsavedDialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        cancelPendingLayoutSelection();
      });
    }
  }

  function renderVersionPanel() {
    var version = window.JoeVersion || { APP_VERSION: document.getElementById("appVersion").textContent, VERSION_HISTORY: [] };
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
      if (event.target instanceof Element && event.target.closest("dialog")) { return; }
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
        setLayoutStatus("Board settings applied." + (layoutDirty ? " Layout has unsaved changes." : ""));
      } else if (!settingsOk && !themeOk) {
        setLayoutStatus("Settings applied for this session but storage is unavailable.", true);
      } else if (!settingsOk) {
        setLayoutStatus("Grid settings applied for this session but storage is unavailable.", true);
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
    if (!grid || restoringLayout || isNarrowGridViewport() ||
      (typeof grid.isIgnoreChangeCB === "function" && grid.isIgnoreChangeCB())) { return; }
    var snapshot = makeLayoutSnapshot(layoutItemsFromGrid(desktopColumnCount()), activeGridSettings, activePhoneOrder);
    if (!snapshot) { return; }
    rememberDesktopLayout(snapshot.items);
    if (!persistDraftSnapshot(snapshot)) {
      setLayoutStatus("Layout changed for this session but storage is unavailable.", true);
    }
    refreshLayoutDirty(true);
  }

  function livePhoneOrder() {
    if (!grid || !isNarrowGridViewport()) { return null; }
    var items = grid.save(false, false, undefined, grid.getColumn()).map(function (item) {
      return { id: item.id, x: item.x, y: item.y };
    });
    return sanitizePhoneOrder(items.sort(function (a, b) {
      if (a.y !== b.y) { return a.y - b.y; }
      if (a.x !== b.x) { return a.x - b.x; }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }).map(function (item) { return item.id; }));
  }

  function savePhoneOrderFromDrag() {
    if (!grid || restoringLayout || !isNarrowGridViewport()) { return; }
    var nextOrder = livePhoneOrder();
    if (!nextOrder || phoneOrdersEqual(nextOrder, activePhoneOrder)) {
      scheduleNarrowFit(0);
      return;
    }
    activePhoneOrder = nextOrder;
    if (!persistDraftSnapshot(currentLayoutSnapshot())) {
      setLayoutStatus("Phone order changed for this session but storage is unavailable.", true);
    }
    refreshLayoutDirty(true);
    scheduleNarrowFit(0);
  }

  function initGrid() {
    var catalog = readLayoutsCatalog();
    activeLayoutId = readActiveLayoutId(catalog);
    var draftSettings = readStoredGridSettings();
    var activeEntry = catalog.layouts.find(function (entry) { return entry.id === activeLayoutId; }) || defaultLayoutEntry();
    activeGridSettings = draftSettings || sanitizeGridSettings(activeEntry.settings);
    var initial = resolveInitialLayoutState(
      catalog,
      activeLayoutId,
      safeStoredLayout(activeLayoutId !== DEFAULT_LAYOUT_ID),
      draftSettings,
      readStoredPhoneOrder()
    );
    activeLayoutId = initial.activeId;
    activeGridSettings = initial.settings;
    activePhoneOrder = initial.phoneOrder;
    var initialItems = initial.items;
    layoutBaseline = initial.baseline;
    layoutDirty = initial.dirty;
    rememberDesktopLayout(initialItems);
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
    restoringLayout = true;
    grid.load(initialItems, false);
    restoringLayout = false;
    syncGridColumnConfig(activeGridSettings.columns);
    scheduleViewportSettle();
    grid.on("change", saveLayout);
    grid.on("dragstop", savePhoneOrderFromDrag);
    grid.on("resizestop", function () { resizeVisuals(); });
    document.getElementById("resetLayout").addEventListener("click", resetToDefaultLayout);
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

  function hasUsableEquity(data) {
    return Boolean(data && data.totals && Number.isFinite(data.totals.equity) &&
      Array.isArray(data.desks) && data.desks.every(function (desk) {
        return Number.isFinite(desk.money && desk.money.equity);
      }));
  }

  function retainedEquityView(data, lastGood, at) {
    if (hasUsableEquity(data) || !hasUsableEquity(lastGood)) { return data; }
    var staleAfter = Number.isFinite(data && data.safety && data.safety.staleAfterSeconds)
      ? data.safety.staleAfterSeconds
      : 300;
    var now = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
    if (!Number.isFinite(now)) { now = Date.now(); }
    var lastGoodAt = Date.parse(lastGood.generatedAt || "");
    if (!Number.isFinite(lastGoodAt) || Math.max(0, now - lastGoodAt) > staleAfter * 1000) { return data; }

    var retainedDesks = data.desks.map(function (desk) {
      var previous = lastGood.desks.find(function (candidate) { return candidate.id === desk.id; });
      if (!previous || !previous.money) { return desk; }
      var retainEquity = !Number.isFinite(desk.money && desk.money.equity) && Number.isFinite(previous.money.equity);
      var retainTotalPnl = !Number.isFinite(desk.money && desk.money.totalPnl) && Number.isFinite(previous.money.totalPnl);
      if (!retainEquity && !retainTotalPnl) { return desk; }
      var observedAt = previous.moneyEvidence && validIsoTimestamp(previous.moneyEvidence.observedAt)
        ? previous.moneyEvidence.observedAt
        : lastGood.generatedAt;
      return Object.assign({}, desk, {
        money: Object.assign({}, desk.money, {
          equity: retainEquity ? previous.money.equity : desk.money.equity,
          totalPnl: retainTotalPnl ? previous.money.totalPnl : desk.money.totalPnl
        }),
        moneyEvidence: { status: "carried", observedAt: observedAt }
      });
    });
    return Object.assign({}, data, {
      desks: retainedDesks,
      totals: Object.assign({}, data.totals, { equity: lastGood.totals.equity }),
      _retainedEquityGeneratedAt: lastGood.generatedAt
    });
  }

  function hasRetainedEquityWithinGrace(data, at) {
    if (!hasUsableEquity(data)) { return false; }
    var staleAfter = Number.isFinite(data && data.safety && data.safety.staleAfterSeconds)
      ? data.safety.staleAfterSeconds
      : 300;
    var now = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
    if (!Number.isFinite(now)) { now = Date.now(); }
    var retainedAt = Date.parse(data._retainedEquityGeneratedAt || "");
    if (Number.isFinite(retainedAt)) { return Math.max(0, now - retainedAt) <= staleAfter * 1000; }
    return data.desks.some(function (desk) {
      var evidence = desk.moneyEvidence;
      var observedAt = evidence && Date.parse(evidence.observedAt || "");
      return evidence && evidence.status === "carried" && Number.isFinite(observedAt) &&
        Math.max(0, now - observedAt) <= staleAfter * 1000;
    });
  }

  function moneyEvidencePresentation(desk) {
    var evidence = desk && desk.moneyEvidence;
    if (!evidence) { return { status: "legacy", carried: false, age: null, text: null, title: "" }; }
    var age = ageInSeconds(evidence.observedAt);
    if (evidence.status !== "carried") {
      return { status: "observed", carried: false, age: age, text: null, title: "" };
    }
    var observed = dateTime.format(new Date(evidence.observedAt));
    return {
      status: "carried",
      carried: true,
      age: age,
      text: "Valuation input " + ageLabel(age) + " ago",
      title: "Retained value; valuation input observed " + observed
    };
  }

  function pnlSource(data, kind) {
    var source = data && data.pnlSources && data.pnlSources[kind];
    return source && source.status === "available" ? source : null;
  }

  function pnlSourceLabel(source) {
    if (!source) { return null; }
    if (source.method === "sod-virtual-equity" && /^session_open_proxy(?:\b|[: _-])/.test(source.detail)) { return "Session estimate"; }
    if (source.method === "sod-virtual-equity") { return "SOD · virtual desks"; }
    if (source.method === "ib-daily-pnl") { return "IB DailyPnL · virtual desks"; }
    if (source.method === "ib-unrealized-pnl") { return "IB unrealized · virtual desks"; }
    if (source.method === "owned-lots-current-mark-fx") { return "Owned lots · current marks"; }
    return null;
  }

  function pnlUnavailableCopy(data, kind) {
    var declared = data && data.pnlSources && data.pnlSources[kind];
    if (declared && declared.status === "unavailable") { return declared.detail; }
    var gatewayStatus = data && data.safety && data.safety.gateway && data.safety.gateway.status;
    if (gatewayStatus === "down") { return "Unavailable · Gateway down"; }
    if (gatewayStatus === "degraded") { return "Unavailable · Gateway degraded"; }
    return kind === "day" ? "Not wired yet · HOSTD-33" : "Not wired yet · IB unrealized";
  }

  function pnlMetricPresentation(data, kind, value) {
    var source = pnlSource(data, kind);
    if (source && Number.isFinite(value)) {
      return { value: value, note: pnlSourceLabel(source), title: source.detail, available: true };
    }
    var note = pnlUnavailableCopy(data, kind);
    return { value: null, note: note, title: note, available: false };
  }

  function dayPnlDisplayValue(data, value) {
    return pnlMetricPresentation(data, "day", value).value;
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

  function brokerAccountPresentation(data) {
    var account = data && data.brokerAccount;
    if (!account) {
      return {
        value: null,
        state: "legacy",
        meta: "Whole IB paper account including KEEP · not virtual desk capital · not supplied",
        problem: null
      };
    }
    var hasEquity = Number.isFinite(account.equity);
    var observedAge = ageInSeconds(account.observedAt);
    var stale = Number.isFinite(observedAge) && observedAge > data.safety.staleAfterSeconds;
    var unavailable = account.status === "unavailable";
    var observationCopy = (unavailable ? "last observed " : "observed ") + ageLabel(observedAge) + " ago";
    var state = unavailable ? "unavailable" : stale ? "stale" : "available";
    return {
      value: hasEquity ? account.equity : null,
      state: state,
      meta: "Whole IB paper account including KEEP · not virtual desk capital · " + observationCopy + (unavailable ? " · unavailable" : stale ? " · stale" : ""),
      problem: unavailable
        ? "IB paper account NAV is unavailable; any displayed value is the last complete broker observation."
        : stale
        ? "IB paper account NAV is stale."
        : null
    };
  }

  function renderBrokerAccountSummary(data) {
    var view = brokerAccountPresentation(data);
    var value = document.getElementById("brokerEquity");
    var meta = document.getElementById("brokerAccountMeta");
    setMoney(value, view.value, false);
    value.classList.remove("broker-stale", "broker-unavailable");
    meta.className = "hero-meta";
    if (view.state === "stale") {
      value.classList.add("broker-stale");
      meta.classList.add("attention");
    } else if (view.state === "unavailable") {
      value.classList.add("broker-unavailable");
      meta.classList.add("unavailable");
    }
    meta.textContent = view.meta;
    meta.title = data.brokerAccount
      ? "Broker observation " + dateTime.format(new Date(data.brokerAccount.observedAt))
      : "Older compatible payload without brokerAccount";
  }

  function renderDeskTotalsSummary(data) {
    var j = data.desks.find(function (desk) { return desk.id === "j"; });
    var incompleteJ = !j || !Number.isFinite(j.money.equity) || !Number.isFinite(j.money.totalPnl);
    var meta = document.getElementById("deskTotalsMeta");
    meta.textContent = incompleteJ
      ? "J accounting incomplete · desk total unavailable"
      : "J + Joe + Joel virtual books";
    meta.className = "hero-meta" + (incompleteJ ? " attention" : "");
  }

  function gatewayHeartbeatAge(data, at) {
    var gateway = data && data.safety && data.safety.gateway;
    var lastSeen = gateway && gateway.lastSeenAt;
    if (!validIsoTimestamp(lastSeen)) { return null; }
    var now = at === undefined ? Date.now() : new Date(at).getTime();
    return Number.isFinite(now) ? Math.max(0, Math.floor((now - Date.parse(lastSeen)) / 1000)) : null;
  }

  function hasCapturedJResults(desk) {
    var captured = desk && desk.id === "j" && desk.backfill && desk.backfill.capturedSubtotal;
    return Boolean(captured && Number.isFinite(captured.realizedPnl) && captured.currency && captured.executionCount > 0);
  }

  function hasCapturedHistory(desk) {
    var captured = desk && desk.id === "j" && desk.backfill && desk.backfill.capturedSubtotal;
    return Boolean(captured && Array.isArray(captured.points) && captured.points.length > 0);
  }

  function hasIncompleteJAccounting(desk) {
    return Boolean(desk && desk.id === "j" &&
      (!desk.money || !Number.isFinite(desk.money.equity) || !Number.isFinite(desk.money.totalPnl)));
  }

  function isNewYorkRegularHours(at) {
    var date = at instanceof Date ? at : new Date(at === undefined ? Date.now() : at);
    if (!Number.isFinite(date.getTime())) { return false; }
    var parts = {};
    newYorkClock.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") { parts[part.type] = part.value; }
    });
    if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday)) { return false; }
    var minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 570 && minutes < 960;
  }

  function pnlMetricAvailable(data, kind) {
    var source = data && data.pnlSources && data.pnlSources[kind];
    var field = kind === "day" ? "dayPnl" : "openPnl";
    return Boolean(source && source.status === "available" && data.totals && Number.isFinite(data.totals[field]));
  }

  function hasStaleBoardSource(data, at) {
    var now = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
    if (!Number.isFinite(now)) { now = Date.now(); }
    var sources = [data.generatedAt];
    if (data.brokerAccount) { sources.push(data.brokerAccount.observedAt); }
    data.desks.forEach(function (desk) {
      if (desk.moneyEvidence) { sources.push(desk.moneyEvidence.observedAt); }
    });
    ["day", "open"].forEach(function (kind) {
      var source = data.pnlSources && data.pnlSources[kind];
      if (source && source.status === "available") { sources.push(source.observedAt); }
    });
    return sources.some(function (iso) {
      var observed = Date.parse(iso || "");
      var age = now - observed;
      return !Number.isFinite(observed) || age < 0 || age > data.safety.staleAfterSeconds * 1000;
    });
  }

  function localBoardHealth(data, snapshotAge, at, refreshFailed) {
    var gateway = data.safety.gateway;
    var gatewayAge = gatewayHeartbeatAge(data, at);
    var staleAfter = data.safety.staleAfterSeconds;
    var rth = isNewYorkRegularHours(at);
    var equityUsable = hasUsableEquity(data);
    if (data.safety.halt) { return { tone: "red", reason: "halt_on" }; }
    if (gateway.status === "down") { return { tone: "red", reason: "gateway_down" }; }
    if (snapshotAge > staleAfter * 3) { return { tone: "red", reason: "feed_disconnected" }; }
    if (!equityUsable) { return { tone: "red", reason: "equity_unavailable" }; }
    if (gateway.status === "degraded") { return { tone: "yellow", reason: "gateway_degraded" }; }
    if (refreshFailed) { return { tone: "yellow", reason: "refresh_failed" }; }
    if (snapshotAge > staleAfter) {
      return { tone: "yellow", reason: "snapshot_stale" };
    }
    if (gateway.status === "ok" && (gatewayAge === null || gatewayAge > staleAfter)) {
      return { tone: "yellow", reason: "gateway_unconfirmed" };
    }
    if (data.desks.some(function (desk) { return moneyEvidencePresentation(desk).carried; })) {
      return { tone: "yellow", reason: "retained_values" };
    }
    if (hasStaleBoardSource(data, at)) { return { tone: "yellow", reason: "snapshot_stale" }; }
    if (data.desks.some(function (desk) { return desk.state === "stuck"; })) {
      return { tone: "yellow", reason: "retained_values" };
    }
    if (rth && !pnlMetricAvailable(data, "day")) { return { tone: "yellow", reason: "day_pending" }; }
    if (rth && !pnlMetricAvailable(data, "open")) { return { tone: "yellow", reason: "open_unavailable_rth" }; }
    return { tone: "green", reason: "board_ok" };
  }

  function boardHealthPresentation(data, snapshotAge, at, refreshFailed) {
    var health = localBoardHealth(data, snapshotAge, at, refreshFailed);
    var producerTone = data.boardHealth;
    var retainedLocally = health.tone === "yellow" && health.reason === "retained_values" &&
      hasRetainedEquityWithinGrace(data, at);
    var incompleteProducerRed = data.shortReason === "equity_unavailable" || data.shortReason === "producer_stuck";
    if (producerTone && BOARD_HEALTH_TONES.indexOf(producerTone) > BOARD_HEALTH_TONES.indexOf(health.tone) &&
        !(retainedLocally && incompleteProducerRed)) {
      health = { tone: producerTone, reason: data.shortReason };
    }
    var label = health.tone === "green"
      ? "Board OK"
      : health.tone === "red"
      ? "Needs fix"
      : health.reason === "snapshot_stale"
      ? "Stale " + ageLabel(snapshotAge)
      : health.reason === "gateway_unconfirmed"
      ? "Gateway unsure"
      : "Data delayed";
    var reasonCopy = {
      board_ok: "numbers are up to date",
      snapshot_stale: "updates are late — reload; if still late, tell Amy",
      retained_values: "numbers a bit old — carrying last good equity",
      gateway_degraded: "IB connection is unstable — reload; if it persists, tell Amy",
      gateway_unconfirmed: "Gateway has not checked in — reload; if still old, tell Amy",
      open_unavailable_rth: "waiting on IB prices — equity is still available",
      day_pending: "DAY is waiting on data — equity is still available",
      halt_on: "paper trading is paused — the operator must check",
      gateway_down: "IB is offline — tell Amy to check the paper Gateway",
      feed_disconnected: "board updates stopped — tell Amy to check the feed",
      equity_unavailable: "board numbers are missing — the operator must check",
      producer_stuck: "board updates are stuck — the operator must check",
      day_unavailable_rth: "DAY is waiting on data — the operator must check",
      refresh_failed: "update failed — reload; if it repeats, tell Amy"
    };
    return { tone: health.tone, reason: health.reason, label: label, explanation: reasonCopy[health.reason] || "the operator must check the details" };
  }

  function boardDiagnostics(data, snapshotAge, at, refreshFailed, health) {
    var problems = snapshotProblems(data, snapshotAge);
    if (isNewYorkRegularHours(at) && !pnlMetricAvailable(data, "day")) {
      problems.push("DAY is unavailable during New York regular trading hours: " + pnlUnavailableCopy(data, "day") + ".");
    }
    if (isNewYorkRegularHours(at) && !pnlMetricAvailable(data, "open")) {
      problems.push("OPEN is unavailable during New York regular trading hours: " + pnlUnavailableCopy(data, "open") + ".");
    }
    if (refreshFailed) { problems.push(refreshFailureMessage(refreshError)); }
    if (!problems.length && health.reason !== "board_ok") {
      problems.push("Producer status: " + health.reason.replaceAll("_", " ") + ".");
    }
    return problems;
  }

  function snapshotProblems(data, snapshotAge) {
    var problems = [];
    if (!data) { return problems; }
    var gateway = data.safety.gateway;
    if (data.safety.halt) { problems.push("HALT is on" + (data.safety.haltReason ? ": " + data.safety.haltReason : ".")); }
    if (gateway.status !== "ok") { problems.push("Gateway is " + gateway.status + (gateway.detail ? ": " + gateway.detail : ".")); }
    var gatewayAge = gatewayHeartbeatAge(data);
    if (gateway.status === "ok" && (gatewayAge === null || gatewayAge > data.safety.staleAfterSeconds)) {
      problems.push(gatewayAge === null
        ? "Gateway check-in time is unknown; current connection is unconfirmed."
        : "Gateway last checked in " + ageLabel(gatewayAge) + " ago; current connection is unconfirmed.");
    }
    if (snapshotAge > data.safety.staleAfterSeconds) { problems.push("The snapshot is stale (" + snapshotAge + " seconds old)."); }
    var brokerProblem = brokerAccountPresentation(data).problem;
    if (brokerProblem) { problems.push(brokerProblem); }
    data.desks.forEach(function (desk) {
      var valuation = moneyEvidencePresentation(desk);
      if (valuation.carried && desk.state === "stuck" && !hasCapturedJResults(desk)) {
        problems.push(desk.label + " valuation is stale; retained value uses input observed " + ageLabel(valuation.age) +
          " ago. Producer state remains stuck: " + desk.action);
        return;
      }
      if (valuation.carried) {
        problems.push(desk.label + " valuation is stale; retained value uses input observed " + ageLabel(valuation.age) + " ago.");
      }
      if (desk.state !== "stuck") { return; }
      if (hasCapturedJResults(desk)) {
        problems.push(hasIncompleteJAccounting(desk)
          ? "J complete equity is unavailable; captured partial results are available below. Coverage gaps remain."
          : "J is marked stuck; complete accounting is available. See Accounting diagnostic.");
      } else {
        problems.push(desk.label + " is stuck: " + desk.action);
      }
    });
    return problems;
  }

  function applyBoardHealth(health, problems) {
    var alarm = document.getElementById("alarm");
    alarm.dataset.tone = health.tone;
    document.getElementById("alarmLabel").textContent = health.label;
    document.getElementById("alarmReason").textContent = health.explanation;
    document.getElementById("alarmText").textContent = problems.length ? problems.join(" ") : "No current diagnostic issues.";
    document.documentElement.dataset.joeState = health.tone === "green" ? "ok" : health.tone === "yellow" ? "attention" : "broken";
  }

  function setMoneyField(node, value, signed, fieldKind, data, noteNode) {
    if (fieldKind === "day" || fieldKind === "open") {
      var view = pnlMetricPresentation(data, fieldKind, value);
      setMoney(node, view.value, signed);
      node.title = view.title;
      if (noteNode) {
        noteNode.textContent = view.note;
        noteNode.title = view.title;
        noteNode.classList.toggle("pnl-note--missing", !view.available);
      }
      return view;
    }
    node.title = "";
    setMoney(node, value, signed);
    return { value: value, note: "", title: "", available: Number.isFinite(value) };
  }

  function labelPaperCapital() {
    var heroLabels = document.querySelectorAll(".hero-values .hero-stat .label");
    if (heroLabels[0]) { heroLabels[0].textContent = "Virtual desk equity"; }
    if (heroLabels[1]) { heroLabels[1].textContent = "Day"; }
    if (heroLabels[2]) { heroLabels[2].textContent = "Open"; }
    if (heroLabels[3]) { heroLabels[3].textContent = "Snapshot age"; }
  }

  function deskFreshnessFooter(desk, snapshotAge, snapshotStale, gatewayDown, staleAfterSeconds) {
    var heartbeatIso = desk.heartbeatAt || null;
    var heartbeatAge = validIsoTimestamp(heartbeatIso) ? ageInSeconds(heartbeatIso) : null;
    var offline = gatewayDown || (heartbeatIso && Number.isFinite(heartbeatAge) && heartbeatAge > staleAfterSeconds);
    var stale = !offline && snapshotStale;
    var valuation = moneyEvidencePresentation(desk);
    var activityText = heartbeatIso
      ? "Heartbeat " + ageLabel(heartbeatAge) + " ago"
      : "Snapshot " + ageLabel(snapshotAge) + " ago";
    return {
      text: valuation.carried ? valuation.text + " · " + activityText : activityText,
      title: valuation.title,
      offline: offline,
      stale: stale,
      valuationStale: valuation.carried
    };
  }

  function deskFreshnessBadge(footer) {
    if (footer.offline) { return { text: "Offline", className: "offline" }; }
    if (footer.valuationStale) { return { text: "Valuation stale", className: "valuation-stale" }; }
    if (footer.stale) { return { text: "Stale", className: "stale" }; }
    return null;
  }

  function updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale) {
    var freshValue = document.getElementById("freshValue");
    freshValue.textContent = (snapshotStale ? "STALE · " : "Fresh · ") + ageLabel(snapshotAge);
    freshValue.className = snapshotStale ? "negative" : "positive";
    var gateway = data.safety.gateway;
    var gatewayAge = gatewayHeartbeatAge(data);
    var gatewayStale = gateway.status === "ok" && (gatewayAge === null || gatewayAge > data.safety.staleAfterSeconds);
    var gatewayText = gateway.status === "ok" ? gatewayStale ? "CHECKING · heartbeat missing/late" : "OK · connected" : gateway.status.toUpperCase();
    if (Number.isFinite(gatewayAge)) {
      gatewayText += " · gateway seen " + ageLabel(gatewayAge) + " ago";
    } else if (gateway.lastSeenAt) {
      gatewayText += " · gateway seen unknown";
    }
    setSignal("gatewaySignal", "gatewayValue", gatewayText, gateway.status === "ok" && !gatewayStale ? "good" : gateway.status === "down" ? "bad" : "warn");
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
      heartbeatEl.title = footer.title;
      heartbeatEl.className = "desk-heartbeat" + (footer.offline ? " offline" : footer.stale ? " stale" : "");
      var badge = deskFreshnessBadge(footer);
      if (badgeEl) {
        if (badge) {
          badgeEl.textContent = badge.text;
          badgeEl.className = "status-badge " + badge.className;
        } else {
          badgeEl.remove();
        }
      } else if (badge) {
        var footerSlot = slot.querySelector(".desk-footer");
        if (footerSlot) {
          footerSlot.appendChild(el("span", "status-badge " + badge.className, badge.text));
        }
      }
    });
  }

  function updateFreshnessTick() {
    if (!lastValidSnapshot) { return; }
    var data = retainedEquityView(lastValidSnapshot, lastGoodEquitySnapshot, Date.now());
    var snapshotAge = ageInSeconds(data.generatedAt);
    var snapshotStale = snapshotAge > data.safety.staleAfterSeconds;
    var gatewayDown = data.safety.gateway.status === "down";
    updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale);
    renderBrokerAccountSummary(data);
    updateDeskFreshnessFooters(data, snapshotAge, snapshotStale, gatewayDown);
    var at = Date.now();
    var health = boardHealthPresentation(data, snapshotAge, at, Boolean(refreshError));
    applyBoardHealth(health, boardDiagnostics(data, snapshotAge, at, Boolean(refreshError), health));
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
    var hasCapturedJ = desk.state === "stuck" && hasCapturedJResults(desk);
    var hasIncompleteCapturedJ = hasCapturedJ && hasIncompleteJAccounting(desk);
    if (hasIncompleteCapturedJ) {
      happenedParts.push("Captured partial J history is available; complete J equity remains unavailable.");
    } else if (hasCapturedJ) {
      happenedParts.push("Complete J accounting is available; captured native-currency history remains separate.");
    } else if (action) {
      happenedParts.push(action);
    }
    if (!hasCapturedJ && desk.state === "stuck" && Array.isArray(desk.issues) && desk.issues.length) {
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

  function compactLearningText(value, maxLength) {
    var text = nonEmptyString(value) || "Not supplied";
    if (text.length <= maxLength) { return text; }
    return text.slice(0, maxLength - 1).trimEnd() + "…";
  }

  function renderDecisionStrip(data) {
    var summary = document.getElementById("learningStripSummary");
    var scope = document.getElementById("learningStripScope");
    var gridNode = document.getElementById("learningStripGrid");
    if (!summary || !scope || !gridNode) { return; }
    if (!data || !Array.isArray(data.desks)) {
      summary.textContent = "Waiting for the first snapshot";
      scope.textContent = "Paper · virtual desks only";
      gridNode.replaceChildren(el("p", "learning-strip-empty", "The household rollup will appear when the paper snapshot arrives."));
      return;
    }
    var busy = data.desks.filter(function (desk) { return desk.state === "working"; }).length;
    var rollup = data.desks.map(function (desk) { return desk.label; }).join(" + ");
    summary.textContent = "Busy " + busy + "/" + data.desks.length + " virtual desks · DAY/OPEN stay evidence-gated";
    scope.textContent = "KEEP stays outside virtual desk rollup · " + rollup;
    gridNode.replaceChildren.apply(gridNode, data.desks.map(function (desk) {
      var copy = formatDeskLearningCopy(desk);
      var item = el("article", "learning-strip-item");
      var itemHead = el("div", "learning-strip-item-head");
      itemHead.appendChild(el("strong", "learning-strip-desk", desk.label));
      itemHead.appendChild(el("span", "learning-strip-state state state-" + desk.state, stateCopy[desk.state]));
      item.appendChild(itemHead);
      item.appendChild(el("p", "learning-strip-happened", "Happened · " + compactLearningText(copy.whatHappened, 82)));
      item.appendChild(el("p", "learning-strip-next", "Next · " + compactLearningText(copy.whatNext, 82)));
      return item;
    }));
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
    var states = el("div", "desk-states");
    if (moneyEvidencePresentation(desk).carried) {
      states.appendChild(el("span", "state valuation-stale", "Valuation stale"));
    }
    states.appendChild(el("span", "state state-" + desk.state, stateCopy[desk.state]));
    top.appendChild(states);
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
      var metricNote = item[3] === "day" || item[3] === "open" ? el("small", "pnl-note") : null;
      if (item[3] === "trades") {
        value.textContent = Number.isFinite(item[1]) ? number.format(item[1]) : "—";
      } else if (metricNote) {
        setMoneyField(value, item[1], item[2], item[3], data, metricNote);
      } else {
        setMoney(value, item[1], item[2]);
      }
      cellNode.appendChild(value);
      if (metricNote) { cellNode.appendChild(metricNote); }
      moneyRow.appendChild(cellNode);
    });
    content.appendChild(moneyRow);
    var accountingBasisNode = renderAccountingBasis(desk);
    if (accountingBasisNode) { content.appendChild(accountingBasisNode); }
    var backfillNode = renderBackfill(desk.backfill, desk.money);
    if (backfillNode) { content.appendChild(backfillNode); }
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
    if (desk.id === "j" && desk.state === "stuck" && desk.backfill) {
      var diagnostic = el("details", "desk-diagnostic");
      diagnostic.appendChild(el("summary", "", "Accounting diagnostic"));
      var rawDiagnostic = [nonEmptyString(desk.action)].concat(Array.isArray(desk.issues) ? desk.issues : []).filter(Boolean);
      diagnostic.appendChild(el("p", "", rawDiagnostic.length ? rawDiagnostic.join(" · ") : "No diagnostic detail supplied."));
      content.appendChild(diagnostic);
    }
    content.appendChild(renderDeskTimeline(desk.id));
    if (desk.issues.length && desk.state !== "stuck") {
      content.appendChild(el("p", "issues negative", desk.issues.join(" · ")));
    }

    var footer = el("div", "desk-footer");
    var deskFooter = deskFreshnessFooter(desk, snapshotAge, snapshotStale, gatewayDown, data.safety.staleAfterSeconds);
    var heartbeat = el("span", "desk-heartbeat" + (deskFooter.offline ? " offline" : deskFooter.stale ? " stale" : ""), deskFooter.text);
    heartbeat.title = deskFooter.title;
    footer.appendChild(heartbeat);
    var freshnessBadge = deskFreshnessBadge(deskFooter);
    if (freshnessBadge) { footer.appendChild(el("span", "status-badge " + freshnessBadge.className, freshnessBadge.text)); }
    content.appendChild(footer);
    slot.replaceChildren(content);
  }

  function renderAttribution(data) {
    var root = document.getElementById("attribution");
    var rows = data.desks.map(function (desk) {
      return { desk: desk, value: dayPnlDisplayValue(data, desk.money.dayPnl) };
    });
    if (!rows.every(function (row) { return Number.isFinite(row.value); })) {
      var missing = pnlMetricPresentation(data, "day", null);
      root.replaceChildren(el("p", "widget-note empty-attribution", missing.note + ". Attribution waits for complete desk DAY values."));
      return;
    }
    var max = Math.max.apply(null, rows.map(function (row) { return Math.abs(row.value); }).concat([1]));
    root.replaceChildren.apply(root, rows.map(function (row) {
      var item = el("div", "attribution-row");
      item.appendChild(el("span", "", row.desk.label));
      var track = el("span", "attribution-track");
      var fill = el("span", "attribution-fill" + (row.value < 0 ? " negative" : ""));
      fill.style.width = Math.max(2, Math.abs(row.value) / max * 100) + "%";
      track.appendChild(fill);
      item.appendChild(track);
      item.appendChild(el("strong", "attribution-value " + tone(row.value), amount(row.value, true)));
      return item;
    }));
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
      var dayView = pnlMetricPresentation(data, "day", position.dayPnl);
      var openView = pnlMetricPresentation(data, "open", position.openPnl);
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
      var dayCell = cell(formatPositionMoney(dayView.value, true, currencyCode), "number " + tone(dayView.value));
      dayCell.title = dayView.title;
      row.appendChild(dayCell);
      var openCell = cell(formatPositionMoney(openView.value, true, currencyCode), "number " + tone(openView.value));
      openCell.title = openView.title;
      row.appendChild(openCell);
      row.appendChild(cell(position.updatedAt && Number.isFinite(Date.parse(position.updatedAt)) ? shortTime.format(new Date(position.updatedAt)) : "—"));
      return row;
    }));
    syncPositionsTableLayout();
  }

  function render(snapshot) {
    if (hasUsableEquity(snapshot)) { lastGoodEquitySnapshot = snapshot; }
    var data = retainedEquityView(snapshot, lastGoodEquitySnapshot, Date.now());
    latestSnapshot = data;
    lastValidSnapshot = snapshot;
    refreshError = null;
    var snapshotAge = ageInSeconds(data.generatedAt);
    var stale = snapshotAge > data.safety.staleAfterSeconds;
    var gateway = data.safety.gateway;
    var gatewayDown = gateway.status === "down";
    var at = Date.now();
    var health = boardHealthPresentation(data, snapshotAge, at, false);

    renderBrokerAccountSummary(data);
    setMoney(document.getElementById("totalEquity"), data.totals.equity, false);
    document.getElementById("virtualStartingCapital").textContent = amount(VIRTUAL_STARTING_CAPITAL_EUR, false);
    renderDeskTotalsSummary(data);
    setMoneyField(document.getElementById("totalDay"), data.totals.dayPnl, true, "day", data, document.getElementById("totalDayNote"));
    setMoneyField(document.getElementById("totalOpen"), openPnl(data), true, "open", data, document.getElementById("totalOpenNote"));
    updateSnapshotFreshnessUI(data, snapshotAge, stale);
    setSignal("haltSignal", "haltValue", data.safety.halt ? "ON" : "Off", data.safety.halt ? "bad" : "good");
    applyBoardHealth(health, boardDiagnostics(data, snapshotAge, at, false, health));
    renderDecisionStrip(data);
    observeSnapshotChanges(data);
    data.desks.forEach(function (desk) { renderDesk(desk, data, snapshotAge, stale, gatewayDown); });
    renderAttribution(data);
    renderPositions(data);
    labelPaperCapital();
    document.getElementById("sourceLine").textContent = "Source: " + (data.source && data.source.label ? data.source.label : "book.json projection") + " · paper projection";
    renderPrimaryCapturedHistory();
    drawSparklines();
    if (isNarrowGridViewport()) { scheduleNarrowFit(0); }
  }

  function renderNoData(error) {
    latestSnapshot = null;
    lastValidSnapshot = null;
    refreshError = error;
    renderDecisionStrip(null);
    setSignal("gatewaySignal", "gatewayValue", "Unknown", "bad");
    setSignal("haltSignal", "haltValue", "Unknown", "bad");
    document.getElementById("totalEquity").textContent = "—";
    document.getElementById("virtualStartingCapital").textContent = amount(VIRTUAL_STARTING_CAPITAL_EUR, false);
    document.getElementById("brokerEquity").textContent = "—";
    document.getElementById("brokerAccountMeta").textContent = "Whole IB paper account including KEEP · not virtual desk capital · waiting for observation";
    document.getElementById("brokerAccountMeta").className = "hero-meta unavailable";
    document.getElementById("deskTotalsMeta").textContent = "Waiting for desk accounting";
    document.getElementById("deskTotalsMeta").className = "hero-meta attention";
    document.getElementById("totalDay").textContent = "—";
    document.getElementById("totalOpen").textContent = "—";
    document.getElementById("totalDayNote").textContent = "Unavailable · no snapshot";
    document.getElementById("totalOpenNote").textContent = "Unavailable · no snapshot";
    document.getElementById("totalDayNote").classList.add("pnl-note--missing");
    document.getElementById("totalOpenNote").classList.add("pnl-note--missing");
    ["brokerEquity", "totalEquity", "totalDay", "totalOpen"].forEach(function (id) {
      document.getElementById(id).classList.remove("positive", "negative");
      document.getElementById(id).classList.add("neutral");
    });
    document.getElementById("freshValue").textContent = "NO DATA";
    document.getElementById("freshValue").className = "negative";
    applyBoardHealth(
      { tone: "red", reason: "no_snapshot", label: "Needs fix", explanation: "no board data — reload; if still empty, tell Amy" },
      ["No household snapshot is available yet. " + error.message]
    );
    document.getElementById("updatedAt").textContent = "data.json unavailable";
    document.getElementById("sourceLine").textContent = "Source: unavailable · paper projection";
    DESK_IDS.forEach(function (deskId) {
      var slot = document.querySelector('[data-desk-slot="' + deskId + '"]');
      if (slot) { slot.replaceChildren(el("p", "empty-cell", "Waiting for the first valid snapshot.")); }
    });
    document.getElementById("attribution").replaceChildren(el("p", "widget-note", "Unavailable · no snapshot. Attribution waits for complete desk DAY values."));
    document.getElementById("positionsSummary").textContent = "Position detail not supplied in this snapshot";
    var emptyPositionsRow = el("tr");
    var emptyPositionsCell = cell("Position detail is not present in this snapshot.", "empty-cell");
    emptyPositionsCell.colSpan = 9;
    emptyPositionsRow.appendChild(emptyPositionsCell);
    document.getElementById("positionsBody").replaceChildren(emptyPositionsRow);
    syncPositionsTableLayout();
    renderPrimaryCapturedHistory();
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

  function capturedHistoryWindow(backfill, range, referenceAt) {
    var captured = backfill && backfill.capturedSubtotal;
    var source = captured && Array.isArray(captured.points) ? captured.points : [];
    if (!source.length || range === "all") { return source.slice(); }
    var reference = Date.parse(referenceAt);
    var span = historyRangeSpanMs(range);
    if (!Number.isFinite(reference) || !span) { return []; }
    return source.filter(function (point) {
      var at = Date.parse(point.at);
      return at >= reference - span && at <= reference;
    });
  }

  function capturedHistoryReferenceAt(snapshot, historyPoints) {
    if (historyPoints.length) { return historyPoints[historyPoints.length - 1].t; }
    return snapshot && snapshot.generatedAt ? snapshot.generatedAt : null;
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

  var HISTORY_TIME_ZONE = "Europe/Vienna";
  var HISTORY_CALENDAR_PARTS = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone: HISTORY_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  var HISTORY_WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: HISTORY_TIME_ZONE, weekday: "short" });
  var HISTORY_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: HISTORY_TIME_ZONE, month: "short" });
  var HISTORY_TOOLTIP_TIME = new Intl.DateTimeFormat("en-GB", {
    timeZone: HISTORY_TIME_ZONE,
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short"
  });

  function viennaCalendarParts(ms) {
    var values = {};
    HISTORY_CALENDAR_PARTS.formatToParts(new Date(ms)).forEach(function (part) {
      if (part.type !== "literal") { values[part.type] = Number(part.value); }
    });
    return {
      year: values.year, month: values.month, day: values.day,
      hour: values.hour, minute: values.minute, second: values.second
    };
  }

  function viennaCalendarInstant(parts) {
    var target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    var guess = target;
    for (var pass = 0; pass < 4; pass += 1) {
      var observed = viennaCalendarParts(guess);
      var observedWallTime = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      var adjustment = target - observedWallTime;
      if (!adjustment) { break; }
      guess += adjustment;
    }
    return guess;
  }

  function shiftViennaCalendar(parts, unit, amount) {
    var calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0));
    if (unit === "minute") { calendar.setUTCMinutes(calendar.getUTCMinutes() + amount); }
    else if (unit === "hour") { calendar.setUTCHours(calendar.getUTCHours() + amount); }
    else if (unit === "day" || unit === "week") { calendar.setUTCDate(calendar.getUTCDate() + amount * (unit === "week" ? 7 : 1)); }
    else if (unit === "month") { calendar.setUTCMonth(calendar.getUTCMonth() + amount); }
    else { calendar.setUTCFullYear(calendar.getUTCFullYear() + amount); }
    return {
      year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(),
      hour: calendar.getUTCHours(), minute: calendar.getUTCMinutes(), second: calendar.getUTCSeconds()
    };
  }

  function historyCalendarBoundaries(min, max, unit, step) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) { return []; }
    var increment = Math.max(1, Math.floor(step || 1));
    var local = viennaCalendarParts(min);
    var cursor;
    if (unit === "minute") {
      local.second = 0;
      local.minute -= local.minute % increment;
      cursor = viennaCalendarInstant(local);
    } else if (unit === "hour") {
      local.minute = 0; local.second = 0;
      local.hour -= local.hour % increment;
      cursor = viennaCalendarInstant(local);
    } else if (unit === "day") {
      local.hour = 0; local.minute = 0; local.second = 0;
      cursor = viennaCalendarInstant(local);
    } else if (unit === "week") {
      local.hour = 0; local.minute = 0; local.second = 0;
      var localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
      local.day -= (localDate.getUTCDay() + 6) % 7;
      cursor = viennaCalendarInstant(local);
    } else if (unit === "month") {
      local.day = 1; local.hour = 0; local.minute = 0; local.second = 0;
      local.month -= (local.month - 1) % increment;
      cursor = viennaCalendarInstant(local);
    } else {
      local.month = 1; local.day = 1; local.hour = 0; local.minute = 0; local.second = 0;
      local.year -= local.year % increment;
      cursor = viennaCalendarInstant(local);
    }
    var boundaries = [];
    var guard = 0;
    while (cursor < min && guard < 512) {
      local = shiftViennaCalendar(viennaCalendarParts(cursor), unit, increment);
      cursor = viennaCalendarInstant(local);
      guard += 1;
    }
    while (cursor <= max && guard < 512) {
      boundaries.push(cursor);
      local = shiftViennaCalendar(viennaCalendarParts(cursor), unit, increment);
      var next = viennaCalendarInstant(local);
      if (next <= cursor) { break; }
      cursor = next;
      guard += 1;
    }
    return boundaries;
  }

  function historyAxisStep(unit, rawStep) {
    var choices = unit === "minute" ? [1, 2, 5, 10, 15, 30, 60, 120, 180, 360]
      : unit === "hour" ? [1, 2, 3, 6, 12, 24, 48]
        : unit === "day" ? [1, 2, 3, 7, 14]
          : unit === "week" ? [1, 2, 4, 8, 13, 26, 52]
            : unit === "month" ? [1, 2, 3, 6, 12, 24, 60]
              : [1, 2, 5, 10, 20, 50, 100];
    for (var i = 0; i < choices.length; i += 1) {
      if (choices[i] >= rawStep) { return choices[i]; }
    }
    var largest = choices[choices.length - 1];
    return largest * Math.ceil(rawStep / largest);
  }

  function historyAxisLabelBoxes(ticks, min, max, plotWidth, plan) {
    var width = Math.max(1, plotWidth);
    var span = Math.max(1, max - min);
    return ticks.map(function (tick, index) {
      var x = (tick - min) / span * width;
      var label = historyAxisLabel(tick, plan);
      var labelWidth = label.length * 6 + 2;
      var left = ticks.length === 1 ? x - labelWidth
        : index === 0 ? x
          : index === ticks.length - 1 ? x - labelWidth : x - labelWidth / 2;
      return { value: tick, label: label, left: left, right: left + labelWidth };
    });
  }

  function historyAxisLabelsFit(boxes, plotWidth) {
    for (var i = 0; i < boxes.length; i += 1) {
      if (boxes[i].left < 0 || boxes[i].right > plotWidth) { return false; }
      if (i && boxes[i].left - boxes[i - 1].right < 8) { return false; }
    }
    return true;
  }

  function currentHistoryPlotWidth(scale, fallbackWidth) {
    var chart = scale && scale.chart;
    var chartWidth = chart && Number.isFinite(chart.width) && chart.width > 0 ? chart.width : fallbackWidth;
    var yScale = chart && chart.scales && chart.scales.y;
    var yGutter = yScale && Number.isFinite(yScale.width) && yScale.width > 0 ? yScale.width : 72;
    return Math.max(80, chartWidth - yGutter - 8);
  }

  function historyAxisPlan(min, max, plotWidth) {
    var width = Math.max(80, Number(plotWidth) || 0);
    var span = Math.max(1, max - min);
    var daySpan = span / 86400000;
    var pixelsPerDay = width / daySpan;
    var separatorUnit = pixelsPerDay >= 36 ? "day"
      : pixelsPerDay * 7 >= 48 ? "week"
        : pixelsPerDay * 30.4375 >= 35 ? "month" : "year";
    var unit = span <= 6 * 3600000 ? "minute"
      : span <= 2 * 86400000 ? "hour"
        : daySpan <= 21 ? "day"
          : daySpan <= 120 ? "week"
            : daySpan <= 2 * 365.2425 ? "month" : "year";
    var nominal = { minute: 60000, hour: 3600000, day: 86400000, week: 7 * 86400000, month: 30.4375 * 86400000, year: 365.2425 * 86400000 }[unit];
    var minimumSpacing = unit === "minute" || unit === "hour" ? 64 : unit === "year" ? 50 : 78;
    var tickBudget = Math.max(2, Math.floor(width / minimumSpacing));
    var rawStep = Math.max(1, Math.ceil((span / nominal) / tickBudget));
    var step = historyAxisStep(unit, rawStep);
    var plan;
    for (var pass = 0; pass < 12; pass += 1) {
      var ticks = historyCalendarBoundaries(min, max, unit, step);
      var detailedTime = (unit === "minute" || unit === "hour") && ticks.length * 78 <= width;
      plan = {
        unit: unit,
        step: step,
        ticks: ticks,
        separatorUnit: separatorUnit,
        separators: historyCalendarBoundaries(min, max, separatorUnit, 1),
        detailedTime: detailedTime,
        timeZone: HISTORY_TIME_ZONE
      };
      plan.labelBoxes = historyAxisLabelBoxes(ticks, min, max, width, plan);
      if (ticks.length && historyAxisLabelsFit(plan.labelBoxes, width)) { return plan; }
      if (detailedTime) {
        plan.detailedTime = false;
        plan.labelBoxes = historyAxisLabelBoxes(ticks, min, max, width, plan);
        if (ticks.length && historyAxisLabelsFit(plan.labelBoxes, width)) { return plan; }
      }
      step = historyAxisStep(unit, step + 1);
    }
    var anchor = min + span / 2;
    var fallback = {
      unit: unit,
      step: 0,
      ticks: [anchor],
      separatorUnit: separatorUnit,
      separators: historyCalendarBoundaries(min, max, separatorUnit, 1),
      detailedTime: false,
      fallback: true,
      timeZone: HISTORY_TIME_ZONE
    };
    fallback.labelBoxes = historyAxisLabelBoxes(fallback.ticks, min, max, width, fallback);
    if (fallback.labelBoxes[0].left < 4) {
      var labelWidth = fallback.labelBoxes[0].right - fallback.labelBoxes[0].left;
      var anchorX = Math.min(width - 4, Math.max(width / 2, labelWidth + 4));
      fallback.ticks = [min + anchorX / width * span];
      fallback.labelBoxes = historyAxisLabelBoxes(fallback.ticks, min, max, width, fallback);
    }
    return fallback;
  }

  function historyAxisLabel(ms, plan) {
    var date = new Date(ms);
    var parts = viennaCalendarParts(ms);
    var day = String(parts.day);
    var month = HISTORY_MONTH.format(date);
    var weekday = HISTORY_WEEKDAY.format(date);
    var time = String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0");
    if (plan.unit === "minute" || plan.unit === "hour") { return plan.detailedTime ? weekday + " " + time : time; }
    if (plan.unit === "day" || plan.unit === "week") { return weekday + " " + day + " " + month; }
    if (plan.unit === "month") { return month + " " + parts.year; }
    return String(parts.year);
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
    if (primaryCapturedHistoryModel(latestSnapshot, historyState.selected, historyState.range, historyState.points)) {
      var j = latestSnapshot.desks.find(function (desk) { return desk.id === "j"; });
      return hasIncompleteJAccounting(j)
        ? "Complete EUR J equity history is unavailable; captured native-currency results are shown separately."
        : "No compatible EUR J history is available in this range; current J equity remains available above and captured native-currency results are shown separately.";
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

  var HISTORY_ASSUMED_BASELINE = 5000;
  var HISTORY_OBSERVATION_INTERVAL_MS = 5 * 60 * 1000;

  function continuityGapPoint(x, y, deskId, assumption, gapReason, extra) {
    return Object.assign({
      x: x,
      y: y,
      joeDeskId: deskId,
      joeEvidence: "gap-fill",
      observed: false,
      estimated: true,
      gap: true,
      assumption: assumption,
      gapReason: gapReason
    }, extra || {});
  }

  function continuityValueAt(samples, x) {
    if (x <= samples[0].x) { return samples[0].y; }
    if (x >= samples[samples.length - 1].x) { return samples[samples.length - 1].y; }
    var index;
    for (index = 1; index < samples.length; index += 1) {
      if (samples[index].x < x) { continue; }
      var left = samples[index - 1];
      var right = samples[index];
      if (right.x === left.x) { return right.y; }
      return left.y + (right.y - left.y) * ((x - left.x) / (right.x - left.x));
    }
    return samples[samples.length - 1].y;
  }

  function clipContinuityGap(samples, startAt, endAt, deskId) {
    if (!samples.length || samples[samples.length - 1].x < startAt || samples[0].x > endAt) { return []; }
    var clippedStart = Math.max(startAt, samples[0].x);
    var clippedEnd = Math.min(endAt, samples[samples.length - 1].x);
    var template = samples[0];
    var clipped = [];
    if (clippedStart > samples[0].x) {
      clipped.push(continuityGapPoint(
        clippedStart,
        continuityValueAt(samples, clippedStart),
        deskId,
        template.assumption === "assumed-baseline" ? "baseline-interpolation" : template.assumption,
        template.gapReason,
        { displayBoundary: true }
      ));
    }
    samples.forEach(function (sample) {
      if (sample.x >= clippedStart && sample.x <= clippedEnd) { clipped.push(sample); }
    });
    if (clippedEnd < samples[samples.length - 1].x && !clipped.some(function (sample) { return sample.x === clippedEnd; })) {
      clipped.push(continuityGapPoint(
        clippedEnd,
        continuityValueAt(samples, clippedEnd),
        deskId,
        template.assumption === "assumed-baseline" ? "baseline-interpolation" : template.assumption,
        template.gapReason,
        { displayBoundary: true }
      ));
    }
    return clipped;
  }

  function clipContinuityObserved(samples, startAt, endAt) {
    if (!samples.length) { return []; }
    var firstInside = samples.findIndex(function (sample) { return sample.x >= startAt; });
    if (firstInside < 0) { return []; }
    var lastInside = -1;
    var index;
    for (index = samples.length - 1; index >= 0; index -= 1) {
      if (samples[index].x <= endAt) { lastInside = index; break; }
    }
    if (lastInside < 0) { return []; }
    var from = Math.max(0, firstInside - 1);
    var to = Math.min(samples.length - 1, lastInside + 1);
    if (firstInside > lastInside) {
      from = Math.max(0, lastInside);
      to = Math.min(samples.length - 1, firstInside);
    }
    return samples.slice(from, to + 1);
  }

  function historyContinuitySeries(points, deskId, range, referenceMs) {
    var endAt = Number.isFinite(referenceMs) ? referenceMs : Date.now();
    var retained = (Array.isArray(points) ? points : []).map(function (point, index) {
      return { point: point, index: index, x: point && typeof point.t === "string" ? Date.parse(point.t) : NaN };
    }).filter(function (entry) {
      return Number.isFinite(entry.x) && entry.x <= endAt;
    }).sort(function (left, right) {
      return left.x === right.x ? left.index - right.index : left.x - right.x;
    }).map(function (entry) { return entry.point; });
    var span = historyRangeSpanMs(range);
    var earliestRetainedAt = retained.length ? Date.parse(retained[0].t) : null;
    var startAt = span
      ? endAt - span
      : earliestRetainedAt === null ? endAt - 864e5 : earliestRetainedAt;
    var selected = latestCompatibleBasis(retained, deskId).points;
    var rows = selected.map(function (point) {
      var bag = seriesBag(point, deskId);
      var hasEquity = Boolean(bag) && Object.prototype.hasOwnProperty.call(bag, "equity");
      return {
        x: Date.parse(point.t),
        y: bag && Number.isFinite(bag.equity) ? bag.equity : null,
        gapReason: hasEquity ? "explicit-null" : "absent-observation"
      };
    });
    var observed = [];
    rows.forEach(function (row, index) {
      var previous = index ? rows[index - 1] : null;
      if (previous && row.x - previous.x > HISTORY_OBSERVATION_INTERVAL_MS) {
        observed.push({
          x: previous.x + (row.x - previous.x) / 2,
          y: null,
          joeDeskId: deskId,
          joeEvidence: "observed",
          observed: false,
          gap: true,
          gapReason: "timestamp-gap"
        });
      }
      if (Number.isFinite(row.y)) {
        var previousSolid = Boolean(previous) && Number.isFinite(previous.y) && row.x - previous.x <= HISTORY_OBSERVATION_INTERVAL_MS;
        var next = index + 1 < rows.length ? rows[index + 1] : null;
        var nextSolid = Boolean(next) && Number.isFinite(next.y) && next.x - row.x <= HISTORY_OBSERVATION_INTERVAL_MS;
        observed.push({
          x: row.x,
          y: row.y,
          joeDeskId: deskId,
          joeEvidence: "observed",
          observed: true,
          estimated: false,
          isolated: !previousSolid && !nextSolid
        });
      } else {
        observed.push({
          x: row.x,
          y: null,
          joeDeskId: deskId,
          joeEvidence: "observed",
          observed: false,
          gap: true,
          gapReason: row.gapReason
        });
      }
    });

    var observationIndexes = [];
    rows.forEach(function (row, index) {
      if (Number.isFinite(row.y)) { observationIndexes.push(index); }
    });
    var gapGroups = [];
    if (!observationIndexes.length) {
      gapGroups.push([
        continuityGapPoint(startAt, HISTORY_ASSUMED_BASELINE, deskId, "no-history-baseline", "no-observation", { baseline: true }),
        continuityGapPoint(endAt, HISTORY_ASSUMED_BASELINE, deskId, "no-history-baseline", "no-observation")
      ]);
    } else {
      var firstObservationIndex = observationIndexes[0];
      var firstObservation = rows[firstObservationIndex];
      var baselineAt = earliestRetainedAt === null ? startAt : Math.min(startAt, earliestRetainedAt);
      if (baselineAt < firstObservation.x) {
        gapGroups.push([
          continuityGapPoint(baselineAt, HISTORY_ASSUMED_BASELINE, deskId, "assumed-baseline", "leading-history", { baseline: true }),
          continuityGapPoint(firstObservation.x, firstObservation.y, deskId, "baseline-interpolation", "leading-history", { observedBoundary: true })
        ]);
      }
      observationIndexes.forEach(function (leftIndex, observationOffset) {
        if (observationOffset + 1 >= observationIndexes.length) { return; }
        var rightIndex = observationIndexes[observationOffset + 1];
        var left = rows[leftIndex];
        var right = rows[rightIndex];
        var markers = [];
        var rowIndex;
        for (rowIndex = leftIndex; rowIndex < rightIndex; rowIndex += 1) {
          var nextRow = rows[rowIndex + 1];
          if (nextRow.x - rows[rowIndex].x > HISTORY_OBSERVATION_INTERVAL_MS) {
            markers.push({ x: rows[rowIndex].x + (nextRow.x - rows[rowIndex].x) / 2, reason: "timestamp-gap" });
          }
          if (rowIndex > leftIndex && !Number.isFinite(rows[rowIndex].y)) {
            markers.push({ x: rows[rowIndex].x, reason: rows[rowIndex].gapReason });
          }
        }
        if (!markers.length && rightIndex === leftIndex + 1 && right.x - left.x <= HISTORY_OBSERVATION_INTERVAL_MS) { return; }
        markers.sort(function (a, b) { return a.x - b.x; });
        var reasons = Array.from(new Set(markers.map(function (marker) { return marker.reason; })));
        var reason = reasons.join("+") || "missing-history";
        var group = [continuityGapPoint(left.x, left.y, deskId, "interpolated", reason, { observedBoundary: true })];
        markers.forEach(function (marker) {
          if (group.some(function (sample) { return sample.x === marker.x; })) { return; }
          var y = left.y + (right.y - left.y) * ((marker.x - left.x) / (right.x - left.x));
          group.push(continuityGapPoint(marker.x, y, deskId, "interpolated", marker.reason));
        });
        group.push(continuityGapPoint(right.x, right.y, deskId, "interpolated", reason, { observedBoundary: true }));
        gapGroups.push(group);
      });
      var lastObservation = rows[observationIndexes[observationIndexes.length - 1]];
      if (lastObservation.x < endAt) {
        gapGroups.push([
          continuityGapPoint(lastObservation.x, lastObservation.y, deskId, "last-value-carry", "trailing-history", { observedBoundary: true }),
          continuityGapPoint(endAt, lastObservation.y, deskId, "last-value-carry", "trailing-history", { carried: true })
        ]);
      }
    }

    var gapFill = [];
    gapGroups.forEach(function (group) {
      var clipped = clipContinuityGap(group, startAt, endAt, deskId);
      if (!clipped.length) { return; }
      if (gapFill.length) {
        gapFill.push({
          x: clipped[0].x,
          y: null,
          joeDeskId: deskId,
          joeEvidence: "gap-fill",
          observed: false,
          estimated: true,
          gap: true,
          separator: true
        });
      }
      gapFill = gapFill.concat(clipped);
    });
    return {
      observed: clipContinuityObserved(observed, startAt, endAt),
      gapFill: gapFill,
      startAt: startAt,
      endAt: endAt,
      assumedBaseline: HISTORY_ASSUMED_BASELINE,
      observationIntervalMs: HISTORY_OBSERVATION_INTERVAL_MS
    };
  }

  function toggleHistoryDeskDatasets(chart, datasetIndex) {
    if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) { return false; }
    var selected = chart.data.datasets[datasetIndex];
    if (!selected || !selected.joeDeskId) { return false; }
    var pairedIndexes = [];
    chart.data.datasets.forEach(function (dataset, index) {
      if (dataset.joeDeskId === selected.joeDeskId) { pairedIndexes.push(index); }
    });
    if (!pairedIndexes.length) { return false; }
    var showPair = !pairedIndexes.some(function (index) { return chart.isDatasetVisible(index); });
    pairedIndexes.forEach(function (index) { chart.setDatasetVisibility(index, showPair); });
    chart.update();
    return showPair;
  }

  function historyTooltipItemVisible(item) {
    return !(item.dataset.joeEvidence === "gap-fill" && item.raw && item.raw.observedBoundary);
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
    historyChartSize = { width: 0, height: 0 };
  }

  function showHistoryEmpty(message) {
    destroyHistoryChart();
    var empty = document.getElementById("historyEmpty");
    empty.hidden = false;
    empty.textContent = message;
    renderHistoryCompare();
  }

  function chartVisibleDomain(chart) {
    var scale = chart.scales.x;
    if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max)) { return null; }
    return { min: scale.min, max: scale.max };
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
      var plan = historyAxisPlan(domain.min, domain.max, area.right - area.left);
      context.save();
      context.beginPath();
      context.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      context.clip();
      context.strokeStyle = cssVar("--chart-calendar-line") || cssVar("--chart-grid") || "rgba(127, 126, 119, 0.32)";
      context.lineWidth = plan.separatorUnit === "month" || plan.separatorUnit === "year" ? 1.25 : 1;
      context.setLineDash(plan.separatorUnit === "day" ? [2, 3] : []);
      plan.separators.forEach(function (boundary) {
        var marker = scale.getPixelForValue(boundary);
        if (marker < area.left || marker > area.right) { return; }
        context.beginPath();
        context.moveTo(Math.round(marker) + 0.5, area.top);
        context.lineTo(Math.round(marker) + 0.5, area.bottom);
        context.stroke();
      });
      context.restore();
    }
  };

  function primaryCapturedHistoryModel(snapshot, selected, range, historyPoints) {
    if (!snapshot || !selected.includes("j")) { return null; }
    var desk = snapshot.desks.find(function (candidate) { return candidate.id === "j"; });
    if (!desk || !desk.backfill || !hasCapturedHistory(desk)) { return null; }
    var captured = desk.backfill.capturedSubtotal;
    var currency = captured.currency || "currency unavailable";
    var referenceAt = capturedHistoryReferenceAt(snapshot, historyPoints);
    var points = capturedHistoryWindow(desk.backfill, range, referenceAt);
    var scopedBackfill = Object.assign({}, desk.backfill, {
      capturedSubtotal: Object.assign({}, captured, { points: points })
    });
    return {
      title: "Captured J results · " + currency + " · " + (desk.backfill.fullTotalAvailable ? "complete" : "partial"),
      currency: currency,
      range: range,
      referenceAt: referenceAt,
      points: points,
      series: capturedHistorySeries(scopedBackfill),
      presentation: backfillPresentation(desk.backfill, desk.money),
      fillCount: captured.executionCount,
      method: captured.method === CAPTURED_FIFO_METHOD ? "J-family FIFO, net of fees" : null,
      truncated: captured.pointsTruncated
    };
  }

  function renderPrimaryCapturedHistory() {
    var root = document.getElementById("historyCaptured");
    if (!root) { return; }
    var model = primaryCapturedHistoryModel(latestSnapshot, historyState.selected, historyState.range, historyState.points);
    root.hidden = !model;
    if (!model) { return; }
    document.getElementById("historyCapturedTitle").textContent = model.title;
    document.getElementById("historyCapturedValue").textContent = model.fillCount + " fills" + (model.method ? " · " + model.method : "");
    var rangeLabel = model.range === "all" ? "all captured points" : model.range.toUpperCase() + " window";
    var metadata = rangeLabel + " · " + model.presentation.coverage;
    if (model.presentation.fx) { metadata += " " + model.presentation.fx; }
    if (model.truncated) { metadata += " Showing only the latest captured points."; }
    document.getElementById("historyCapturedMeta").textContent = metadata;
    var plot = document.getElementById("historyCapturedPlot");
    if (!model.series.available) {
      plot.replaceChildren(el("div", "history-captured-empty", "No actual captured J points fall within this range."));
      return;
    }
    var svg = svgEl("svg", "desk-backfill-chart");
    svg.setAttribute("viewBox", "0 0 " + model.series.width + " " + model.series.height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", model.title);
    var title = svgEl("title");
    title.textContent = model.title;
    svg.appendChild(title);
    if (model.series.zeroY !== null) {
      var zero = svgEl("line", "desk-backfill-zero");
      zero.setAttribute("x1", "0");
      zero.setAttribute("x2", String(model.series.width));
      zero.setAttribute("y1", model.series.zeroY.toFixed(2));
      zero.setAttribute("y2", model.series.zeroY.toFixed(2));
      svg.appendChild(zero);
    }
    if (model.series.path) {
      var path = svgEl("path", "desk-backfill-path");
      path.setAttribute("d", model.series.path);
      svg.appendChild(path);
    }
    model.series.points.forEach(function (point, index) {
      if (model.series.points.length > 1 && index !== model.series.points.length - 1) { return; }
      var dot = svgEl("circle", "desk-backfill-point");
      dot.setAttribute("cx", point.x.toFixed(2));
      dot.setAttribute("cy", point.y.toFixed(2));
      dot.setAttribute("r", model.series.points.length === 1 ? "3.5" : "2.5");
      svg.appendChild(dot);
    });
    var first = model.series.points[0];
    var last = model.series.points[model.series.points.length - 1];
    var scale = el("p", "history-captured-scale", "Native " + model.currency + " scale · " +
      formatPositionMoney(model.series.low, true, model.currency) + " to " +
      formatPositionMoney(model.series.high, true, model.currency) + " · " +
      shortTime.format(new Date(first.at)) + (first.at === last.at ? " · one actual point" : " → " + shortTime.format(new Date(last.at)) + " · " + model.series.points.length + " actual points"));
    plot.replaceChildren(svg, scale);
  }

  function updateSeriesButtons() {
    var allSelected = DESK_IDS.every(function (id) { return historyState.selected.includes(id); });
    document.getElementById("seriesAll").setAttribute("aria-pressed", String(allSelected && historyState.selected.length === DESK_IDS.length));
    document.querySelectorAll("button[data-series]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(historyState.selected.includes(button.dataset.series)));
    });
  }

  function drawHistory() {
    renderHistoryBasisNotice();
    renderPrimaryCapturedHistory();
    if (!window.Chart) { showHistoryEmpty("The local chart library could not be loaded."); return; }
    if (!historyState.selected.length) {
      showHistoryEmpty("Select one or more desks to compare.");
      return;
    }
    var chartReferenceMs = Date.now();
    var continuity = historyState.selected.map(function (deskId) {
      return { deskId: deskId, model: historyContinuitySeries(historyState.points, deskId, historyState.range, chartReferenceMs) };
    });
    var datasets = [];
    continuity.forEach(function (entry) {
      var deskId = entry.deskId;
      var label = deskDisplayName(deskId);
      datasets.push({
        label: label,
        data: entry.model.observed,
        joeDeskId: deskId,
        joeEvidence: "observed",
        spanGaps: false,
        borderColor: deskColor(deskId), backgroundColor: deskColor(deskId), borderWidth: 2,
        pointRadius: function (context) { return context.raw && context.raw.isolated ? 3 : 0; },
        pointHoverRadius: 4,
        tension: .2
      });
      datasets.push({
        label: label,
        data: entry.model.gapFill,
        joeDeskId: deskId,
        joeEvidence: "gap-fill",
        spanGaps: false,
        borderColor: cssVar("--chart-gap-fill") || "#85857d",
        backgroundColor: cssVar("--chart-gap-fill") || "#85857d",
        borderWidth: 1.5,
        borderDash: [2, 4],
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0
      });
    });
    document.getElementById("historyEmpty").hidden = true;
    var tickFont = { family: "SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace", size: 10 };
    var historyCanvas = document.getElementById("historyChart");
    var historyWrap = document.querySelector(".history-canvas-wrap");
    var initialWidth = historyWrap ? Math.max(1, Math.floor(historyWrap.clientWidth)) : 1;
    var initialHeight = historyWrap ? Math.max(1, Math.floor(historyWrap.clientHeight)) : 1;
    historyCanvas.width = initialWidth;
    historyCanvas.height = initialHeight;
    var config = {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: false, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: {
            display: true,
            onClick: function (_event, item, legend) { toggleHistoryDeskDatasets(legend.chart, item.datasetIndex); },
            labels: {
              color: cssVar("--chart-legend") || "#aaa79d",
              boxWidth: 14,
              boxHeight: 2,
              font: tickFont,
              filter: function (item, chartData) { return chartData.datasets[item.datasetIndex].joeEvidence !== "gap-fill"; }
            }
          },
          tooltip: {
            backgroundColor: cssVar("--chart-tooltip-bg") || "rgba(41,42,38,.96)",
            titleColor: cssVar("--chart-tooltip-title") || "#eee6d4",
            bodyColor: cssVar("--chart-tooltip-body") || "#c9c4b7",
            borderColor: cssVar("--chart-tooltip-border") || "#454641",
            borderWidth: 1,
            filter: historyTooltipItemVisible,
            callbacks: {
            title: function (items) { return items.length ? HISTORY_TOOLTIP_TIME.format(new Date(items[0].parsed.x)) : ""; },
            label: function (item) {
              var raw = item.raw || {};
              if (item.dataset.joeEvidence !== "gap-fill") {
                return item.dataset.label + "  " + amount(item.parsed.y, false) + " · recorded";
              }
              var explanation = "estimated through missing history";
              if (raw.assumption === "assumed-baseline") { explanation = "estimated · assumed €5,000 starting baseline (display only)"; }
              if (raw.assumption === "baseline-interpolation") { explanation = "estimated · interpolated from assumed €5,000 baseline"; }
              if (raw.assumption === "last-value-carry") { explanation = "estimated · last recorded value carried"; }
              if (raw.assumption === "no-history-baseline") { explanation = "estimated · assumed €5,000 guide · no recorded history"; }
              return item.dataset.label + "  " + amount(item.parsed.y, false) + " · " + explanation;
            }
          } },
          zoom: {
            limits: { x: { minRange: 60 * 1000 } },
            pan: { enabled: true, mode: "x", modifierKey: "shift" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        },
        scales: {
          x: {
            type: "linear",
            min: continuity[0].model.startAt,
            max: continuity[0].model.endAt,
            afterBuildTicks: function (scale) {
              var plotWidth = currentHistoryPlotWidth(scale, initialWidth);
              var plan = historyAxisPlan(scale.min, scale.max, plotWidth);
              scale.$joeHistoryAxisPlan = plan;
              scale.ticks = plan.ticks.map(function (value) { return { value: value }; });
            },
            ticks: {
              color: cssVar("--chart-tick") || "#77766f", autoSkip: false,
              minRotation: 0, maxRotation: 0, align: "inner", font: tickFont,
              callback: function (value) {
                return historyAxisLabel(value, this.$joeHistoryAxisPlan || historyAxisPlan(this.min, this.max, this.width));
              }
            },
            grid: { display: false }
          },
          y: { ticks: { color: cssVar("--chart-tick") || "#77766f", font: tickFont, callback: function (value) { return amount(value, false); } }, grid: { color: cssVar("--chart-grid") || "rgba(63,64,59,.45)" } }
        }
      },
      plugins: [historyOverlayPlugin]
    };
    destroyHistoryChart();
    historyState.chart = new window.Chart(historyCanvas.getContext("2d"), config);
    resizeHistoryChart(true);
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

  function resizeHistoryChart(force) {
    if (!historyState.chart) { return; }
    var wrap = document.querySelector(".history-canvas-wrap");
    if (!wrap) { return; }
    var width = Math.max(1, Math.floor(wrap.clientWidth));
    var height = Math.max(1, Math.floor(wrap.clientHeight));
    if (!force && width === historyChartSize.width && height === historyChartSize.height) { return; }
    historyChartSize = { width: width, height: height };
    historyState.chart.resize(width, height);
  }

  function resizeVisuals(includeNarrowFit) {
    if (includeNarrowFit !== false) { visualResizeNeedsNarrowFit = true; }
    if (visualResizeFrame) { return; }
    visualResizeFrame = window.requestAnimationFrame(function () {
      visualResizeFrame = 0;
      var needsNarrowFit = visualResizeNeedsNarrowFit;
      visualResizeNeedsNarrowFit = false;
      resizeHistoryChart(false);
      drawSparklines();
      if (needsNarrowFit && isNarrowGridViewport()) { scheduleNarrowFit(0); }
    });
  }

  function observeHistoryCanvas() {
    if (historyResizeObserver || !window.ResizeObserver) { return; }
    var wrap = document.querySelector(".history-canvas-wrap");
    if (!wrap) { return; }
    historyResizeObserver = new window.ResizeObserver(function () { resizeVisuals(false); });
    historyResizeObserver.observe(wrap);
    window.addEventListener("pagehide", function () {
      historyResizeObserver.disconnect();
      historyResizeObserver = null;
      visualResizeNeedsNarrowFit = false;
      if (visualResizeFrame) { window.cancelAnimationFrame(visualResizeFrame); visualResizeFrame = 0; }
    }, { once: true });
  }

  function fleetFieldDefinitions() {
    return Object.keys(FLEET_CONFIG).flatMap(function (sectionId) {
      return FLEET_CONFIG[sectionId].fields;
    });
  }

  function fleetDefaultValues() {
    var values = {};
    fleetFieldDefinitions().forEach(function (field) { values[field.key] = field.value; });
    return values;
  }

  function fleetPathValue(source, field) {
    if (!field.path) { return field.value; }
    var value = field.path.split(".").reduce(function (current, key) {
      return current === null || current === undefined ? undefined : current[key];
    }, source);
    if (Array.isArray(value)) {
      if (field.type === "windows") { return JSON.stringify(value); }
      return field.type === "refs" && !value.length ? "none" : value.join(",");
    }
    return value === null || value === undefined ? (field.editable === false ? "Not declared" : "") : String(value);
  }

  function fleetValuesFromConfig(config) {
    var values = {};
    fleetFieldDefinitions().forEach(function (field) { values[field.key] = fleetPathValue(config, field); });
    return values;
  }

  function readFleetPreview(baseRev, defaults) {
    var values = Object.assign({}, defaults);
    try {
      var stored = JSON.parse(localStorage.getItem(FLEET_PREVIEW_KEY) || "null");
      if (!stored || stored.baseRev !== baseRev || !stored.values || typeof stored.values !== "object" || Array.isArray(stored.values)) { return values; }
      fleetFieldDefinitions().forEach(function (field) {
        if (field.editable !== false && typeof stored.values[field.key] === "string" && stored.values[field.key].length <= (field.maxLength || 80) && /^[\x20-\x7e]*$/.test(stored.values[field.key])) {
          values[field.key] = stored.values[field.key];
        }
      });
    } catch (_) {
      return values;
    }
    return values;
  }

  function fleetChangedEntries() {
    return Object.keys(fleetBaseline).filter(function (key) { return fleetDraft[key] !== fleetBaseline[key]; });
  }

  function fleetChangeFingerprint() {
    return JSON.stringify(fleetChangedEntries().map(function (key) { return [key, fleetBaseline[key], fleetDraft[key]]; }));
  }

  function updateFleetActionStates() {
    var changes = fleetChangedEntries();
    var fingerprint = fleetChangeFingerprint();
    document.querySelectorAll('[data-fleet-action="diff"]').forEach(function (button) {
      button.disabled = fleetBusy || !fleetBaselineConfig || !changes.length;
    });
    document.querySelectorAll('[data-fleet-action="confirm"]').forEach(function (button) {
      button.disabled = fleetBusy || !changes.length || fleetDiffFingerprint !== fingerprint || !document.getElementById("fleetDiffReviewed").checked;
    });
    document.querySelectorAll('[data-fleet-action="propagate"]').forEach(function (button) {
      button.disabled = fleetBusy || !changes.length || !fleetConfirmed || fleetConfirmedFingerprint !== fingerprint;
    });
  }

  function updateFleetPreviewNote() {
    var note = document.getElementById("fleetPreviewNote");
    if (!note) { return; }
    var count = fleetChangedEntries().length;
    note.textContent = fleetBusy
      ? "Writing a new revision…"
      : !fleetBaselineConfig
        ? (fleetLoadState === "failed" ? "Unavailable · propagation disabled" : "Loading current Fleet Config…")
        : fleetLastOutcome
          ? fleetLastOutcome
        : fleetConfirmed && count
          ? count + " change" + (count === 1 ? "" : "s") + " confirmed for " + fleetBaselineConfig.rev
      : count
          ? count + " preview change" + (count === 1 ? "" : "s") + " · Diff before confirm"
          : "Current " + fleetBaselineConfig.rev + " · No preview changes";
    updateFleetActionStates();
  }

  function updateFleetReadouts() {
    document.querySelectorAll("[data-fleet-readout]").forEach(function (readout) {
      var key = readout.dataset.fleetReadout;
      var value = key === "displayMode" ? "REDACTED" : fleetDraft[key] === undefined ? "" : fleetDraft[key];
      if (readout.dataset.fleetWindowCount) {
        var count = fleetWindows().length;
        value = count + " wake window" + (count === 1 ? "" : "s");
      }
      if (readout.dataset.fleetJoin) { value = value.split(",").map(function (part) { return part.trim(); }).filter(Boolean).join(readout.dataset.fleetJoin); }
      if (readout.dataset.fleetHumanize) {
        value = value.replace(/[_-]+/g, " ");
        value = value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
      }
      readout.textContent = fleetBaselineConfig ? (readout.dataset.fleetPrefix || "") + value + (readout.dataset.fleetSuffix || "") : "—";
    });
    ["grok.reservePct", "codex.reservePct"].forEach(function (key) {
      var raw = fleetDraft[key];
      var numeric = Math.max(0, Math.min(100, Number(raw)));
      var value = Number.isFinite(numeric) ? numeric : 0;
      var meter = document.querySelector('[data-fleet-meter="' + key + '"]');
      if (meter) { meter.style.width = value + "%"; }
    });
    renderSecretSlots();
    renderFleetSectionDetails();
    var examples = ["grok", "codex"].map(function (provider) {
      var raw = fleetDraft[provider + ".reservePct"];
      var amount = Number(raw);
      var label = provider === "grok" ? "Grok" : "Codex";
      return fleetBaselineConfig && /^\d+$/.test(raw) && amount >= 0 && amount <= 100
        ? label + ": " + amount + "% means keep " + amount + " of every 100 units for essential work."
        : label + ": enter a whole percentage from 0 to 100.";
    });
    document.getElementById("fleetQuotaExample").textContent = examples.join(" ");
  }

  function fleetSecretRefName(value) {
    return typeof value === "string" && /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/.test(value) ? value : "";
  }

  function fleetSecretSlotRefs(capability) {
    var slots = fleetBaselineConfig && fleetBaselineConfig.secretSlots;
    var listed = slots && Array.isArray(slots[capability]) ? slots[capability] : null;
    if (!listed && capability === "agenix") { return ["joe-board-push-token"]; }
    return (listed || []).map(fleetSecretRefName).filter(Boolean);
  }

  function renderSecretSlots() {
    var list = document.getElementById("fleetSecretSlots");
    if (!list) { return; }
    var rows = [];
    ["agenix", "janus"].forEach(function (capability) {
      var refs = fleetSecretSlotRefs(capability);
      if (!refs.length) {
        var empty = el("span", "fleet-secret-slot fleet-secret-slot--empty");
        empty.appendChild(el("span", "fleet-secret-capability", capability));
        empty.appendChild(el("span", "fleet-secret-empty", "No slots declared"));
        rows.push(empty);
        return;
      }
      refs.forEach(function (ref) {
        var item = el("span", "fleet-secret-slot");
        item.appendChild(el("span", "fleet-secret-capability", capability));
        item.appendChild(el("code", "fleet-secret-ref", ref));
        item.appendChild(el("em", "fleet-redacted", "REDACTED"));
        rows.push(item);
      });
    });
    list.replaceChildren.apply(list, rows);
  }

  function fleetFieldGuide(field) {
    var guides = {
      "quota.grok.reservePct": ["Grok capacity to keep (%)", "Leave this much Grok capacity for essential work.", "Grok quota policy"],
      "quota.codex.reservePct": ["Codex capacity to keep (%)", "Leave this much Codex capacity for essential work.", "Codex quota policy"],
      "quota.behavior.green": ["GREEN · plenty of capacity", "Let work continue normally. Fixed by the v1 schema.", "Fleet quota policy"],
      "quota.behavior.amber": ["AMBER · capacity getting low", "Slow down or pause nonessential work to save capacity.", "Fleet quota policy"],
      "quota.behavior.red": ["RED · capacity too low", "Pause nonessential work. Fixed by the v1 schema.", "Fleet quota policy"],
      "desks.maxBusyDesks": ["Maximum busy desks", "Limit how many learning desks may work at the same time.", "Paper learning-desk fleet"],
      "desks.stage0.capEur": ["Stage-0 risk cap (€)", "Set the capital ceiling for Stage-0 paper work; this is not a daily-loss limit.", "Stage-0 paper desks"],
      "desks.keep": ["Holdings to leave alone (KEEP)", "Keep these symbols outside learning-desk changes. Separate symbols with commas.", "Holdings named in this list"],
      "cadence.usOpenArm": ["US-open start time", "Set when the US-open workflow may arm, in Vienna time.", "US-open paper workflow · Europe/Vienna"],
      "cadence.deskWatch": ["Desk watcher routine", "Name the routine that checks desks; this is not its repeat interval.", "Desk monitoring"],
      "cadence.darwin": ["Learning review routine", "Name the learning-review routine; this is not its repeat interval.", "Darwin learning review"],
      "cadence.quotaGovernor": ["Capacity-check routine", "Name the routine that applies the quota policy; this is not a timer.", "Fleet quota governor"],
      "cadence.wakeWindows": ["When desks may wake", "Choose days, start/end times and desks for each wake window.", "Named paper desks · Europe/Vienna"],
      "amy.routines.morning": ["Morning check-in name", "Name Amy’s morning brief. This label does not set a run time.", "Amy morning routine"],
      "amy.routines.review": ["Desk-review name", "Name Amy’s review. This label does not set a run time.", "Amy review routine"],
      "amy.routines.close": ["Closing check-in name", "Name Amy’s closing recap. This label does not set a run time.", "Amy close routine"],
      "mac.shared.configPath": ["Mac config mirror path", "Historical mirror location, kept for reference. The board reads the file in the definition strip.", "Mac-side consumer declaration"],
      "mac.shared.docsPath": ["Mac explanations folder", "Historical documentation location, kept for reference. It does not control the board.", "Mac-side documentation"],
      "tools.entries.0.label": ["First declared tool", "Read the first declared tool label. Health is shown on the board.", "Declared tool entry · read-only"],
      "tools.entries.1.label": ["Second declared tool", "Read the second declared tool label. Health is shown on the board.", "Declared tool entry · read-only"],
      "tools.entries.2.label": ["Third declared tool", "Read the third declared tool label. Health is shown on the board.", "Declared tool entry · read-only"],
      "secretSlots.agenix": ["agenix secret references", "Names of encrypted secret slots. Their values never enter this screen.", "Host secret store · read-only"],
      "secretSlots.janus": ["Janus secret references", "Names of secret capabilities. Their values never enter this screen.", "Janus secret workflow · read-only"],
    };
    var guide = guides[field.path] || [field.label, "Reference display only; secret values stay outside this screen.", "This board · read-only"];
    return { label: guide[0], help: guide[1], scope: guide[2] };
  }

  function fleetPolicyLabel(value) {
    return { run_normally: "Run normally", slow_nonessential: "Slow nonessential work", park_nonessential: "Pause nonessential work" }[value] || "Unavailable";
  }

  function renderFleetDefinition(path, kind) {
    var config = fleetBaselineConfig;
    document.getElementById("fleetSchemaId").textContent = config ? config.schema : "Unavailable";
    document.getElementById("fleetSourceRevision").textContent = config ? config.rev : "Unavailable";
    document.getElementById("fleetSourcePath").textContent = path || "Server did not report the file path";
    document.getElementById("fleetSourceKind").textContent = kind === "example" ? "Starter example · not propagated" : kind === "stored" ? "Saved shared file" : "Source not reported";
  }

  function renderFleetSectionDetails() {
    var config = fleetBaselineConfig;
    var coverage = document.getElementById("fleetSectionCoverage");
    coverage.replaceChildren();
    document.getElementById("fleetSecretsDetail").hidden = fleetSectionId !== "secrets";
    var fields = document.getElementById("fleetTechnicalFields");
    fields.replaceChildren();
    if (!config) {
      ["Green", "Amber", "Red"].forEach(function (color) { document.getElementById("fleet" + color + "Behavior").textContent = "Unavailable"; });
      return;
    }
    var behavior = config.quota.behavior;
    ["green", "amber", "red"].forEach(function (color) {
      var definition = fleetFieldDefinitions().find(function (field) { return field.path === "quota.behavior." + color; });
      var policy = definition ? fleetDraft[definition.key] : behavior[color];
      document.getElementById("fleet" + color.charAt(0).toUpperCase() + color.slice(1) + "Behavior").textContent = fleetPolicyLabel(policy) + (color === "amber" ? " · configured policy" : " · fixed in v1");
    });
    var windows = config.cadence.wakeWindows;
    document.getElementById("fleetWakeSummary").textContent = windows.length ? windows.length + " saved wake window" + (windows.length === 1 ? "" : "s") : "No wake windows saved";
    if (fleetSectionId === "cadence") {
      coverage.appendChild(el("p", "", windows.length ? "Saved wake windows · Europe/Vienna" : "No wake windows are saved. An empty list does not prove the desks are asleep; their scheduler may be configured elsewhere."));
      var list = el("ul");
      windows.forEach(function (window) {
        list.appendChild(el("li", "", window.days.join(", ") + " · " + window.from + "–" + window.until + " · desks: " + window.desks.join(", ")));
      });
      if (windows.length) { coverage.appendChild(list); }
    }
    var root = { paths: "mac", routines: "amy", secrets: "secretSlots" }[fleetSectionId] || fleetSectionId;
    function append(value, path) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.keys(value).forEach(function (key) { append(value[key], path + "." + key); });
        return;
      }
      var row = el("div");
      row.appendChild(el("dt", "", path));
      row.appendChild(el("dd", "", Array.isArray(value) ? (value.length ? JSON.stringify(value, null, 2) : "[] · none declared") : String(value)));
      fields.appendChild(row);
    }
    if (fleetSectionId === "limits") { ["quota", "desks", "cadence"].forEach(function (key) { append(config[key], key); }); }
    else { append(config[root], root); }
  }

  function renderFleetSources(sectionId) {
    var list = document.getElementById("fleetSourcesList");
    var status = document.getElementById("fleetSourcesStatus");
    if (!list || !status) { return; }
    var root = document.getElementById("fleetSourcePath").textContent;
    var revision = fleetBaselineConfig && fleetBaselineConfig.rev ? fleetBaselineConfig.rev : "unavailable";
    status.textContent = fleetBaselineConfig
      ? "Read revision " + revision + " · " + document.getElementById("fleetSourceKind").textContent
      : "Source unavailable · keys below are the schema map only";
    var sections = sectionId === "limits" ? ["quota", "desks", "cadence"] : [sectionId];
    var rows = sections.flatMap(function (id) {
      var sourceMap = FLEET_SOURCES[id] || {};
      return FLEET_CONFIG[id].fields.map(function (field) {
        var entry = sourceMap[field.key] || [field.path || "(display only)", "outside the board writer"];
        return [fleetFieldGuide(field).label, entry[0], entry[1], field, id];
      });
    });
    list.replaceChildren.apply(list, rows.map(function (entry) {
      var item = el("li", "fleet-source-row");
      item.appendChild(el("strong", "fleet-source-knob", entry[0]));
      item.appendChild(el("code", "fleet-source-path", entry[1].startsWith("/") ? entry[1] : root + "#" + entry[1]));
      var jump = el("button", "fleet-button fleet-source-edit", entry[3].editable === false ? "View field" : "Edit field");
      jump.type = "button";
      jump.dataset.fleetSourceEdit = entry[3].key;
      jump.setAttribute("aria-label", jump.textContent + ": " + entry[0]);
      jump.addEventListener("click", function () {
        renderFleetConfigSection(entry[4], false);
        var target = entry[3].type === "windows"
          ? document.querySelector(".fleet-window-editor input, .fleet-window-editor > button")
          : Array.from(document.querySelectorAll("[data-fleet-field]")).find(function (input) { return input.dataset.fleetField === entry[3].key; });
        if (target) { target.scrollIntoView({ block: "center", behavior: "auto" }); target.focus({ preventScroll: true }); }
      });
      item.appendChild(jump);
      var legacy = el("span", "fleet-source-legacy");
      legacy.appendChild(el("b", "fleet-source-deprecated", "DEPRECATED / OUTSIDE"));
      legacy.appendChild(document.createTextNode(" " + entry[2]));
      item.appendChild(legacy);
      return item;
    }));
  }

  function renderFleetConfigSection(sectionId, focusHeading) {
    var section = sectionId === "limits" ? FLEET_LIMITS_HOME : FLEET_CONFIG[sectionId];
    if (!section) { return false; }
    fleetSectionId = sectionId;
    document.getElementById("fleetLimitsHome").hidden = sectionId !== "limits";
    document.getElementById("fleetEditStrip").hidden = sectionId === "limits";
    document.getElementById("fleetQuotaExample").hidden = sectionId !== "quota";
    document.querySelectorAll("[data-fleet-section]").forEach(function (button) {
      var selected = button.dataset.fleetSection === sectionId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.getElementById("fleetSelectedLabel").textContent = "Selected: " + section.label;
    var headline = document.getElementById("fleetEliHeadline");
    headline.textContent = section.headline;
    document.getElementById("fleetEliIntro").textContent = section.intro;
    document.getElementById("fleetEliStatus").hidden = !section.status;
    var explanation = document.getElementById("fleetEliSections");
    explanation.replaceChildren.apply(explanation, section.sections.map(function (entry) {
      var item = el("section", "fleet-eli-section");
      item.appendChild(el("h4", "", entry[0]));
      item.appendChild(el("p", "", entry[1]));
      return item;
    }));
    var status = document.getElementById("fleetLoadStatus");
    status.hidden = Boolean(fleetBaselineConfig);
    status.textContent = fleetLoadState === "failed" ? "Fleet Config is unavailable. Values are hidden and editing is disabled. Reopen settings to retry." : "Loading current Fleet Config…";
    var fields = document.getElementById("fleetEditFields");
    fields.replaceChildren.apply(fields, section.fields.map(function (field, index) {
      if (field.type === "windows") { return renderFleetWindowEditor(field); }
      var label = el("label", "fleet-edit-field");
      var inputId = "fleetField" + sectionId.charAt(0).toUpperCase() + sectionId.slice(1) + index;
      var guide = fleetFieldGuide(field);
      var caption = el("span", "", guide.label);
      var input = field.choices ? el("select") : el("input");
      input.id = inputId;
      if (!field.choices) { input.type = "text"; }
      input.maxLength = field.maxLength || 80;
      input.autocomplete = "off";
      input.spellcheck = false;
      if (field.choices) {
        field.choices.forEach(function (choice) {
          var option = el("option", "", choice.label);
          option.value = choice.value;
          input.appendChild(option);
        });
      }
      input.value = fleetBaselineConfig ? fleetDraft[field.key] : "";
      input.disabled = !fleetBaselineConfig;
      input.setAttribute("aria-describedby", inputId + "Help " + inputId + "Scope");
      input.readOnly = field.editable === false;
      if (input.readOnly) {
        input.setAttribute("aria-readonly", "true");
        if (fleetBaselineConfig && field.path && field.path.indexOf("quota.behavior.") === 0) { input.value = fleetPolicyLabel(fleetDraft[field.key]); }
      }
      input.setAttribute("aria-label", guide.label);
      input.dataset.fleetField = field.key;
      input.addEventListener("input", function () {
        if (field.editable === false) { return; }
        fleetDraft[field.key] = input.value;
        fleetConfirmed = false;
        fleetDiffFingerprint = "";
        fleetConfirmedFingerprint = "";
        fleetLastOutcome = "";
        updateFleetPreviewNote();
        updateFleetReadouts();
      });
      label.appendChild(caption);
      label.appendChild(input);
      var help = el("small", "fleet-field-help", guide.help);
      help.id = inputId + "Help";
      var scope = el("small", "fleet-field-scope", "Applies to: " + guide.scope);
      scope.id = inputId + "Scope";
      label.appendChild(help);
      label.appendChild(scope);
      return label;
    }));
    updateFleetPreviewNote();
    updateFleetReadouts();
    renderFleetSources(sectionId);
    if (focusHeading) { headline.focus({ preventScroll: true }); }
    return true;
  }

  function fleetWindows() {
    try {
      var windows = JSON.parse(fleetDraft.wakeWindows || "[]");
      return Array.isArray(windows) ? windows : [];
    } catch (_) { return []; }
  }

  function renderFleetWindowEditor(field) {
    var editor = el("div", "fleet-window-editor");
    var heading = el("div", "fleet-window-heading");
    var guide = fleetFieldGuide(field);
    heading.appendChild(el("strong", "", guide.label));
    heading.appendChild(el("small", "", guide.help));
    heading.appendChild(el("small", "", "Applies to: " + guide.scope));
    editor.appendChild(heading);
    var windows = fleetBaselineConfig ? fleetWindows() : [];
    function commit() {
      fleetDraft.wakeWindows = JSON.stringify(windows);
      fleetConfirmed = false;
      fleetDiffFingerprint = "";
      fleetConfirmedFingerprint = "";
      fleetLastOutcome = "";
      updateFleetPreviewNote();
      updateFleetReadouts();
    }
    windows.forEach(function (windowValue, index) {
      var row = el("div", "fleet-window-row");
      [
        ["id", "Window name", "e.g. us-open"],
        ["days", "Days to wake", "mon,tue,wed"],
        ["from", "Start (Vienna)", "09:00"],
        ["until", "End (Vienna)", "17:00"],
        ["desks", "Wake these desk IDs", "desk-a,desk-b"],
      ].forEach(function (definition) {
        var label = el("label", "fleet-window-field");
        label.appendChild(el("span", "", definition[1]));
        var input = el("input");
        input.type = "text";
        input.value = Array.isArray(windowValue[definition[0]]) ? windowValue[definition[0]].join(",") : windowValue[definition[0]] || "";
        input.placeholder = definition[2];
        input.setAttribute("aria-label", "Wake window " + (index + 1) + " " + definition[1]);
        input.addEventListener("input", function () {
          windowValue[definition[0]] = definition[0] === "days" || definition[0] === "desks"
            ? input.value.split(",").map(function (part) { return part.trim(); }).filter(Boolean)
            : input.value.trim();
          commit();
        });
        label.appendChild(input);
        row.appendChild(label);
      });
      var remove = el("button", "fleet-button", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove wake window " + (index + 1));
      remove.addEventListener("click", function () { windows.splice(index, 1); commit(); renderFleetConfigSection(fleetSectionId, false); });
      row.appendChild(remove);
      editor.appendChild(row);
    });
    var add = el("button", "fleet-button", "+ Add wake window");
    add.type = "button";
    add.disabled = !fleetBaselineConfig || windows.length >= 32;
    add.addEventListener("click", function () {
      windows.push({ id: "new-window", days: ["mon"], from: "09:00", until: "17:00", desks: ["desk-a"] });
      commit();
      renderFleetConfigSection(fleetSectionId, false);
    });
    editor.appendChild(add);
    return editor;
  }

  function showFleetToast(message, warning) {
    var toast = document.getElementById("fleetToast");
    window.clearTimeout(fleetToastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-warning", Boolean(warning));
    toast.hidden = false;
    fleetToastTimer = window.setTimeout(function () { toast.hidden = true; }, 4400);
  }

  function fleetActionTime(value) {
    var instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) { return "Unknown time"; }
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Vienna",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(instant);
  }

  function renderFleetActions(payload) {
    var list = document.getElementById("fleetActionLog");
    if (!list) { return; }
    var entries = payload && payload.schema === "inspr.joe.fleet-config.actions.v1" && Array.isArray(payload.entries)
      ? payload.entries.slice(-5).reverse()
      : [];
    var last = entries[0];
    document.getElementById("fleetLastPropagate").textContent = last ? last.outcome + " · " + fleetActionTime(last.at) + " Vienna · " + (last.revAfter || last.revBefore || "unknown revision") : "None recorded";
    document.getElementById("fleetLastPropagate").title = last ? last.at : "";
    if (!entries.length) {
      list.replaceChildren(el("li", "fleet-action-empty", "No propagation attempts recorded yet."));
      return;
    }
    list.replaceChildren.apply(list, entries.map(function (entry) {
      var item = el("li", "fleet-action-item fleet-action-item--" + entry.outcome);
      var outcome = el("strong", "fleet-action-outcome", entry.outcome);
      var identity = el("span", "fleet-action-identity", entry.actor + " · " + fleetActionTime(entry.at));
      var revisions = el("code", "fleet-action-revisions", (entry.revBefore || "—") + " → " + (entry.revAfter || "—"));
      var keys = Array.isArray(entry.changedKeys) && entry.changedKeys.length ? entry.changedKeys.join(", ") : "no accepted config keys";
      var summary = el("span", "fleet-action-keys", keys);
      item.appendChild(outcome);
      item.appendChild(identity);
      item.appendChild(revisions);
      item.appendChild(summary);
      return item;
    }));
  }

  async function loadFleetActions(showWarning) {
    try {
      var response = await fetch("./fleet-config/actions.json", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      var payload = await response.json();
      if (!payload || payload.schema !== "inspr.joe.fleet-config.actions.v1" || !Array.isArray(payload.entries)) {
        throw new Error("invalid action log response");
      }
      renderFleetActions(payload);
    } catch (_) {
      var list = document.getElementById("fleetActionLog");
      if (list) { list.replaceChildren(el("li", "fleet-action-empty fleet-action-empty--warning", "Propagation log unavailable.")); }
      document.getElementById("fleetLastPropagate").textContent = "Unknown · log unavailable";
      if (showWarning) { showFleetToast("Propagation log could not be refreshed.", true); }
    }
  }

  function setFleetPath(target, path, value) {
    var parts = path.split(".");
    var cursor = target;
    parts.slice(0, -1).forEach(function (part) { cursor = cursor[part]; });
    cursor[parts[parts.length - 1]] = value;
  }

  function parsedFleetFieldValue(field, raw) {
    var value = raw.trim();
    if (field.type === "windows") {
      var windows;
      try { windows = JSON.parse(value); } catch (_) { throw new Error("Desk wake windows could not be read. Reopen Cadence and retry."); }
      if (!Array.isArray(windows) || windows.length > 32) { throw new Error("Use at most 32 desk wake windows."); }
      windows.forEach(function (entry, index) {
        var name = "Wake window " + (index + 1);
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(entry.id) || entry.id.length > 64) { throw new Error(name + " needs a lowercase window ID."); }
        if (!Array.isArray(entry.days) || !entry.days.length || entry.days.length > 7 || new Set(entry.days).size !== entry.days.length || entry.days.some(function (day) { return !["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(day); })) { throw new Error(name + " needs unique days like mon,tue,wed."); }
        if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(entry.from || "") || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(entry.until || "")) { throw new Error(name + " times must use HH:mm."); }
        if (!Array.isArray(entry.desks) || !entry.desks.length || entry.desks.length > 32 || new Set(entry.desks).size !== entry.desks.length || entry.desks.some(function (desk) { return typeof desk !== "string" || desk.length > 64 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(desk); })) { throw new Error(name + " needs unique lowercase desk IDs."); }
      });
      return windows;
    }
    if (field.choices) {
      if (!field.choices.some(function (choice) { return choice.value === value; })) { throw new Error(field.label + " is invalid."); }
      return value;
    }
    if (field.type === "integer") {
      if (!/^-?[0-9]+$/.test(value)) { throw new Error(field.label + " must be a whole number."); }
      var integer = Number(value);
      if (!Number.isSafeInteger(integer) || integer < field.min || integer > field.max) { throw new Error(field.label + " must be from " + field.min + " to " + field.max + "."); }
      return integer;
    }
    if (field.type === "number") {
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) { throw new Error(field.label + " must be a decimal number."); }
      var numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < field.min || numberValue > field.max) { throw new Error(field.label + " must be from " + field.min + " to " + field.max + "."); }
      return numberValue;
    }
    if (field.type === "symbols") {
      var symbols = value.split(",").map(function (part) { return part.trim(); }).filter(Boolean);
      if (symbols.length > 64 || symbols.some(function (symbol) { return !/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(symbol); }) || new Set(symbols).size !== symbols.length) {
        throw new Error(field.label + " must be unique uppercase symbols separated by commas.");
      }
      return symbols;
    }
    if (field.type === "time" && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) { throw new Error(field.label + " must use HH:mm."); }
    if (field.type === "routine" && !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) { throw new Error(field.label + " must be a lowercase routine id."); }
    if (field.type === "path" && !/^(?:~\/|\/)[\x20-\x7e]+$/.test(value)) { throw new Error(field.label + " must be an absolute or ~/ path."); }
    if (!value || value.length > (field.maxLength || 80) || !/^[\x20-\x7e]+$/.test(value)) { throw new Error(field.label + " is invalid."); }
    return value;
  }

  function fleetCandidateConfig() {
    if (!fleetBaselineConfig) { throw new Error("Current Fleet Config is not loaded."); }
    var candidate = JSON.parse(JSON.stringify(fleetBaselineConfig));
    fleetFieldDefinitions().forEach(function (field) {
      if (field.editable === false || !field.path) { return; }
      setFleetPath(candidate, field.path, parsedFleetFieldValue(field, fleetDraft[field.key]));
    });
    return candidate;
  }

  function closeFleetDiff() {
    var dialog = document.getElementById("fleetDiffDialog");
    if (dialog && dialog.open) { dialog.close(); }
  }

  function showFleetDiff(changes) {
    var list = document.getElementById("fleetDiffList");
    list.replaceChildren.apply(list, changes.map(function (key) {
      var field = fleetFieldDefinitions().find(function (entry) { return entry.key === key; });
      var row = el("li", "fleet-diff-row");
      row.appendChild(el("strong", "fleet-diff-label", field ? field.label : key));
      row.appendChild(el("span", "fleet-diff-old", "Before: " + fleetDiffDisplay(field, fleetBaseline[key])));
      row.appendChild(el("span", "fleet-diff-arrow", "→"));
      row.appendChild(el("span", "fleet-diff-new", "After: " + fleetDiffDisplay(field, fleetDraft[key])));
      return row;
    }));
    document.getElementById("fleetDiffBase").textContent = fleetBaselineConfig.rev;
    document.getElementById("fleetDiffReviewed").checked = false;
    updateFleetActionStates();
    var dialog = document.getElementById("fleetDiffDialog");
    if (!dialog.open) { dialog.showModal(); }
  }

  function fleetDiffDisplay(field, raw) {
    if (!raw) { return "(empty)"; }
    if (field && /\.reservePct$/.test(field.path || "")) { return raw + "% kept free"; }
    if (field && field.path === "desks.maxBusyDesks") { return raw + " busy J desks"; }
    if (field && field.path === "desks.stage0.capEur") { return "€" + raw + " Stage-0 ceiling"; }
    if (field && field.path === "cadence.usOpenArm") { return raw + " Vienna time"; }
    if (field && field.type === "windows") {
      try {
        var windows = JSON.parse(raw);
        return windows.length ? windows.map(function (entry) {
          return entry.id + ": " + entry.days.join(", ") + " " + entry.from + "–" + entry.until + " → " + entry.desks.join(", ");
        }).join("\n") : "No wake windows";
      } catch (_) { return "Invalid wake windows"; }
    }
    if (field && field.choices) {
      var option = field.choices.find(function (choice) { return choice.value === raw; });
      return option ? option.label : raw;
    }
    return raw;
  }

  async function loadFleetConfig() {
    try {
      var response = await fetch("./fleet-config.json", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      var config = await response.json();
      if (!config || config.schema !== "inspr.joe.fleet-config.v1" || !/^fc-[0-9]{6}$/.test(config.rev) || config.mode !== "paper") {
        throw new Error("invalid Fleet Config response");
      }
      fleetBaselineConfig = config;
      fleetLoadState = "ready";
      renderFleetDefinition(response.headers.get("X-Joe-Fleet-Source-Path"), response.headers.get("X-Joe-Fleet-Source-Kind"));
      fleetBaseline = fleetValuesFromConfig(config);
      fleetDraft = readFleetPreview(config.rev, fleetBaseline);
      fleetDiffFingerprint = "";
      fleetConfirmedFingerprint = "";
      fleetConfirmed = false;
      document.getElementById("fleetRevision").textContent = config.rev;
      renderFleetConfigSection(fleetSectionId, false);
    } catch (error) {
      fleetBaselineConfig = null;
      fleetLoadState = "failed";
      renderFleetDefinition("Unavailable", "unavailable");
      document.getElementById("fleetWakeSummary").textContent = "Wake windows unavailable";
      fleetBaseline = fleetDefaultValues();
      fleetDraft = Object.assign({}, fleetBaseline);
      document.getElementById("fleetRevision").textContent = "unavailable";
      renderFleetConfigSection(fleetSectionId, false);
      showFleetToast("Fleet Config could not be loaded. Propagation is disabled.", true);
    }
  }

  async function runFleetAction(action) {
    var changes = fleetChangedEntries();
    if (action === "diff") {
      if (!changes.length) { showFleetToast("Preview matches the current Fleet Config revision.", false); return; }
      var previewCandidate;
      try { previewCandidate = fleetCandidateConfig(); } catch (error) { showFleetToast(error.message, true); return; }
      var normalized = fleetValuesFromConfig(previewCandidate);
      fleetFieldDefinitions().forEach(function (field) {
        if (field.editable !== false) { fleetDraft[field.key] = normalized[field.key]; }
      });
      changes = fleetChangedEntries();
      renderFleetConfigSection(fleetSectionId, false);
      if (!changes.length) { showFleetToast("Preview matches the current Fleet Config revision.", false); return; }
      fleetDiffFingerprint = fleetChangeFingerprint();
      fleetConfirmed = false;
      fleetConfirmedFingerprint = "";
      updateFleetPreviewNote();
      showFleetDiff(changes);
      showFleetToast(changes.length + " preview change" + (changes.length === 1 ? "" : "s") + ": " + changes.join(", ") + ".", false);
      return;
    }
    if (action === "save") {
      try {
        if (!fleetBaselineConfig) { throw new Error("not loaded"); }
        localStorage.setItem(FLEET_PREVIEW_KEY, JSON.stringify({ baseRev: fleetBaselineConfig.rev, values: fleetDraft }));
        showFleetToast("Preview saved in this browser for " + fleetBaselineConfig.rev + ".", false);
      } catch (_) {
        showFleetToast("Preview could not be saved in this browser.", true);
      }
      updateFleetPreviewNote();
      return;
    }
    if (action === "confirm") {
      if (!changes.length) {
        showFleetToast("There are no preview changes to confirm.", true);
        return;
      }
      if (fleetDiffFingerprint !== fleetChangeFingerprint()) {
        showFleetToast("Preview the current diff before confirming.", true);
        return;
      }
      if (!document.getElementById("fleetDiffDialog").open || !document.getElementById("fleetDiffReviewed").checked) {
        showFleetToast("Read the diff and tick the review box before confirming.", true);
        return;
      }
      fleetConfirmed = true;
      fleetConfirmedFingerprint = fleetDiffFingerprint;
      updateFleetPreviewNote();
      closeFleetDiff();
      showFleetToast("Preview confirmed for " + fleetBaselineConfig.rev + ".", false);
      return;
    }
    if (action === "propagate") {
      if (!fleetConfirmed || fleetConfirmedFingerprint !== fleetChangeFingerprint()) {
        showFleetToast("Preview and confirm the current diff before propagating.", true);
        return;
      }
      var candidate;
      try { candidate = fleetCandidateConfig(); } catch (error) { showFleetToast(error.message, true); return; }
      var attemptedRev = fleetBaselineConfig.rev;
      var attemptedKeys = changes.slice();
      fleetBusy = true;
      updateFleetPreviewNote();
      try {
        var propagated = await fetch("./fleet-config/propagate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseRev: fleetBaselineConfig.rev, config: candidate }),
        });
        var result = await propagated.json();
        if (!propagated.ok || !result.ok || !result.config) {
          var detail = Array.isArray(result.errors) && result.errors.length ? result.errors[0] : result.error;
          throw new Error(result.currentRev ? "revision changed to " + result.currentRev + "; reload before retrying" : detail || "request rejected");
        }
        fleetBaselineConfig = result.config;
        renderFleetDefinition(result.adapter && result.adapter.path, "stored");
        fleetBaseline = fleetValuesFromConfig(result.config);
        fleetDraft = Object.assign({}, fleetBaseline);
        fleetDiffFingerprint = "";
        fleetConfirmedFingerprint = "";
        fleetConfirmed = false;
        localStorage.removeItem(FLEET_PREVIEW_KEY);
        fleetLastOutcome = "Success · " + result.rev + " saved to the shared file. Consumer reload is not confirmed.";
        document.getElementById("fleetRevision").textContent = result.rev;
        renderFleetConfigSection(fleetSectionId, false);
        var writtenKeys = result.action && Array.isArray(result.action.changedKeys) && result.action.changedKeys.length
          ? result.action.changedKeys
          : attemptedKeys;
        showFleetToast("Propagated " + result.rev + ": " + writtenKeys.join(", ") + ". Shared file ready for Amy and desks.", false);
      } catch (error) {
        fleetConfirmed = false;
        fleetConfirmedFingerprint = "";
        fleetLastOutcome = "Failed · " + attemptedRev + " was not confirmed as written. " + (error.message || "Request rejected") + ".";
        showFleetToast("Propagation failed for " + attemptedRev + " (" + attemptedKeys.join(", ") + "): " + (error.message || "request rejected") + ".", true);
      } finally {
        fleetBusy = false;
        updateFleetPreviewNote();
        await loadFleetActions(false);
      }
    }
  }

  function setBoardPlane(showFleet) {
    var flipper = document.getElementById("boardFlipper");
    var stage = document.getElementById("dashboard");
    var front = document.getElementById("tradingBoard");
    var back = document.getElementById("fleetConfigBoard");
    if (!flipper || flipper.classList.contains("is-flipped") === showFleet) { return; }
    window.clearTimeout(fleetFlipTimer);
    document.querySelectorAll("details[data-dismissable][open]").forEach(function (open) { open.removeAttribute("open"); });
    front.inert = showFleet;
    back.inert = !showFleet;
    front.setAttribute("aria-hidden", String(showFleet));
    back.setAttribute("aria-hidden", String(!showFleet));
    document.documentElement.dataset.joePlane = showFleet ? "fleet-config" : "trading";
    stage.classList.add("is-flipping");
    if (showFleet) {
      stage.classList.add("is-fleet");
      if (fleetLoadState === "failed") { void loadFleetConfig(); }
    }
    if (showFleet) { window.scrollTo(0, 0); }
    window.requestAnimationFrame(function () { flipper.classList.toggle("is-flipped", showFleet); });
    fleetFlipTimer = window.setTimeout(function () {
      stage.classList.remove("is-flipping");
      if (!showFleet) { stage.classList.remove("is-fleet"); }
      if (showFleet) {
        document.getElementById("fleetConfigTitle").setAttribute("tabindex", "-1");
        document.getElementById("fleetConfigTitle").focus({ preventScroll: true });
      } else {
        document.getElementById("fleetConfigOpen").focus({ preventScroll: true });
        resizeVisuals();
      }
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 780);
  }

  function bindFleetConfigControls() {
    fleetBaseline = fleetDefaultValues();
    fleetDraft = Object.assign({}, fleetBaseline);
    renderFleetConfigSection(fleetSectionId, false);
    document.getElementById("fleetConfigOpen").addEventListener("click", function () { setBoardPlane(true); });
    document.getElementById("settingsFleetConfig").addEventListener("click", function () {
      document.getElementById("settingsMenu").open = false;
      setBoardPlane(true);
    });
    document.getElementById("fleetConfigClose").addEventListener("click", function () { setBoardPlane(false); });
    document.querySelectorAll("[data-fleet-section]").forEach(function (button) {
      button.addEventListener("click", function () { renderFleetConfigSection(button.dataset.fleetSection, true);
        if (window.matchMedia("(max-width: 700px)").matches) { document.getElementById("fleetEliHeadline").scrollIntoView({ block: "start", behavior: "instant" }); }
      });
    });
    document.querySelectorAll("[data-fleet-jump]").forEach(function (button) {
      button.addEventListener("click", function () {
        renderFleetConfigSection(button.dataset.fleetJump, false);
        document.getElementById("fleetEditFields").scrollIntoView({ behavior: "smooth", block: "center" });
        var first = document.querySelector("#fleetEditFields input:not([readonly]), #fleetEditFields select");
        if (first) { first.focus({ preventScroll: true }); }
      });
    });
    document.querySelectorAll("[data-fleet-action]").forEach(function (button) {
      button.addEventListener("click", function () { void runFleetAction(button.dataset.fleetAction); });
    });
    document.getElementById("fleetDiffCancel").addEventListener("click", closeFleetDiff);
    document.getElementById("fleetDiffReviewed").addEventListener("change", updateFleetActionStates);
    document.getElementById("fleetActionLogRefresh").addEventListener("click", function () { void loadFleetActions(true); });
    document.getElementById("fleetDiffDialog").addEventListener("cancel", function (event) {
      event.preventDefault();
      closeFleetDiff();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.documentElement.dataset.joePlane === "fleet-config") {
        if (document.getElementById("fleetDiffDialog").open) { return; }
        setBoardPlane(false);
      }
    });
    void loadFleetConfig();
    void loadFleetActions(false);
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
    deskFreshnessBadge: deskFreshnessBadge,
    moneyEvidencePresentation: moneyEvidencePresentation,
    hasUsableEquity: hasUsableEquity,
    retainedEquityView: retainedEquityView,
    hasRetainedEquityWithinGrace: hasRetainedEquityWithinGrace,
    snapshotProblems: snapshotProblems,
    brokerAccountPresentation: brokerAccountPresentation,
    backfillPresentation: backfillPresentation,
    capturedHistorySeries: capturedHistorySeries,
    capturedHistoryWindow: capturedHistoryWindow,
    primaryCapturedHistoryModel: primaryCapturedHistoryModel,
    renderBackfill: renderBackfill,
    gatewayHeartbeatAge: gatewayHeartbeatAge,
    isNewYorkRegularHours: isNewYorkRegularHours,
    boardHealthPresentation: boardHealthPresentation,
    boardDiagnostics: boardDiagnostics,
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
    activeLayoutStorageKey: ACTIVE_LAYOUT_KEY,
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
    scaleLayoutColumns: scaleLayoutColumns,
    canonicalLayoutsCatalog: canonicalLayoutsCatalog,
    resolveInitialLayoutState: resolveInitialLayoutState,
    layoutSnapshotsEqual: layoutSnapshotsEqual,
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
    historyAxisPlan: historyAxisPlan,
    historyAxisLabel: historyAxisLabel,
    historyCalendarBoundaries: historyCalendarBoundaries,
    filterPoints: filterPoints,
    historyRangeSpanMs: historyRangeSpanMs,
    validateHistoryPayload: validateHistoryPayload,
    applyHistoryFetchResult: applyHistoryFetchResult,
    historyFailureMessage: historyFailureMessage,
    historyContinuitySeries: historyContinuitySeries,
    toggleHistoryDeskDatasets: toggleHistoryDeskDatasets,
    historyTooltipItemVisible: historyTooltipItemVisible,
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
    formatPctChange: formatPctChange,
    fleetPreviewStorageKey: FLEET_PREVIEW_KEY,
    fleetChangedEntries: fleetChangedEntries,
    loadFleetActions: loadFleetActions,
    selectFleetConfigSection: renderFleetConfigSection,
    showFleetConfig: function () { setBoardPlane(true); },
    showTradingBoard: function () { setBoardPlane(false); }
  });
  initTheme();
  initGrid();
  bindControls();
  bindFleetConfigControls();
  observeHistoryCanvas();
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
