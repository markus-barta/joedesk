#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateHouseholdSnapshot } from "../validate.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const serverSource = await readFile(resolve(repoRoot, "server.mjs"), "utf8");

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const historyHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
  var number = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 4 });
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function daysInMonth(year, month)", "\n\n  function gatewayHeartbeatAge")}
${extractJoeBlock("  function historyRangeSpanMs(range)", "\n\n  function seriesBag(point, deskId)")}
${extractJoeBlock("  function seriesBag(point, deskId)", "\n\n  function destroyHistoryChart")}
${extractJoeBlock("  function formatPctChange(value)", "\n\n  function sharedWindowCompare(points, deskIds, range)")}
${extractJoeBlock("  function sharedWindowCompare(points, deskIds, range)", "\n\n  function deskDisplayName(deskId)")}
${extractJoeBlock("  function historyFailureMessage(error, hasRetainedSeries)", "\n\n  function updateHistoryStatusUI")}`;

const api = new Function(`${historyHelpers}
  return {
    filterPoints,
    capturedHistoryWindow,
    historyRangeSpanMs,
    validateHistoryPayload,
    applyHistoryFetchResult,
    historyFailureMessage,
    historyContinuitySeries,
    toggleHistoryDeskDatasets,
    historyTooltipItemVisible,
    historyAxisPlan,
    historyAxisLabel,
    historyCalendarBoundaries,
    currentHistoryPlotWidth,
    sparklineSamples,
    basisAwareSeries,
    latestCompatibleBasis,
    historyBasisNotice,
    compatibleAccountingBasis,
    sharedWindowCompare,
    formatPctChange
  };
`)();

function extractServerBlock(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from server.mjs`);
  return serverSource.slice(start, end);
}

const historyPointFromSnapshot = new Function(
  `const HISTORY_BASIS_MAX = 96;
   const HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
   ${extractServerBlock("function moneyBag(bag)", "\nfunction pruneHistoryPoints")}
   return historyPointFromSnapshot;`,
)();

const points = [
  {
    t: "2026-09-08T12:00:00+02:00",
    desks: { j: { equity: 100 }, joe: { equity: 200 }, joel: { equity: 300 } }
  },
  {
    t: "2026-09-09T11:00:00+02:00",
    desks: { j: { equity: 110 }, joe: { equity: 210 }, joel: { equity: 310 } }
  },
  {
    t: "2026-09-10T12:00:00+02:00",
    desks: { j: { equity: 120 }, joe: { equity: null }, joel: { equity: 330 } }
  }
];

if (api.historyRangeSpanMs("1d") !== 864e5) throw new Error("1d span mismatch");
if (api.historyRangeSpanMs("all") !== null) throw new Error("all span must be open-ended");

const axisRange = (from, to, width) => api.historyAxisPlan(Date.parse(from), Date.parse(to), width);
const closeAxis = axisRange("2026-09-11T08:00:00Z", "2026-09-11T12:00:00Z", 720);
const dailyAxis = axisRange("2026-09-08T00:00:00Z", "2026-09-15T00:00:00Z", 720);
const weeklyAxis = axisRange("2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z", 720);
const monthlyAxis = axisRange("2025-09-01T00:00:00Z", "2026-09-01T00:00:00Z", 720);
const yearlyAxis = axisRange("2016-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 720);
if (closeAxis.unit !== "minute" || closeAxis.separatorUnit !== "day") {
  throw new Error("close history ranges must show readable times with Vienna day separators");
}
if (dailyAxis.unit !== "day" || weeklyAxis.unit !== "week" || monthlyAxis.unit !== "month" || yearlyAxis.unit !== "year") {
  throw new Error("history axis must transition through day, week, month, and year calendar scales");
}
[closeAxis, dailyAxis, weeklyAxis, monthlyAxis, yearlyAxis].forEach((plan) => {
  if (plan.ticks.length > Math.floor(720 / 50) + 1) {
    throw new Error(`history ${plan.unit} ticks exceed the available plot-width density`);
  }
  if (plan.ticks.some((tick, index) => index && tick <= plan.ticks[index - 1])) {
    throw new Error(`history ${plan.unit} ticks must be strictly ordered`);
  }
});
const narrowDailyAxis = axisRange("2026-09-08T00:00:00Z", "2026-09-15T00:00:00Z", 260);
if (narrowDailyAxis.ticks.length >= dailyAxis.ticks.length) {
  throw new Error("narrow history plots must reduce tick density");
}
const dayLabel = api.historyAxisLabel(dailyAxis.ticks[0], dailyAxis);
if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)$/.test(dayLabel)) {
  throw new Error("daily history labels must use short English weekday/date copy");
}
if (closeAxis.ticks.some((tick) => !/^([A-Z][a-z]{2} )?\d{2}:\d{2}$/.test(api.historyAxisLabel(tick, closeAxis)))) {
  throw new Error("close history labels must use compact English weekday/time copy as width permits");
}

function assertAxisPlanFits(plan, width, label) {
  plan.labelBoxes.forEach((box, index) => {
    if (box.left < 0 || box.right > width) {
      throw new Error(`${label} tick label must stay inside its actual plot width`);
    }
    if (index && box.left - plan.labelBoxes[index - 1].right < 8) {
      throw new Error(`${label} tick labels must retain measured spacing, including inner-aligned edges`);
    }
  });
}

const resizedPlotWidth = api.currentHistoryPlotWidth({
  chart: {
    width: 418,
    chartArea: { left: 74, right: 866 },
    scales: { y: { width: 74.009765625 } },
  },
}, 866);
if (Math.abs(resizedPlotWidth - 335.990234375) > 0.001) {
  throw new Error("history planning must use current chart width and y-axis gutter, not stale chartArea width");
}
const resizedAxis = axisRange("2026-09-01T00:00:00Z", "2026-09-13T00:00:00Z", resizedPlotWidth);
assertAxisPlanFits(resizedAxis, resizedPlotWidth, "post-phone 768px resize");
if (resizedAxis.ticks.length >= 6) {
  throw new Error("the reproduced 342.99px plot must not retain the six overlapping desktop ticks");
}
const reviewerBlankRepro = axisRange("2026-09-01T00:00:00Z", "2026-09-07T20:00:00Z", 259);
assertAxisPlanFits(reviewerBlankRepro, 259, "reviewer blank-axis repro");
if (!reviewerBlankRepro.ticks.length || !reviewerBlankRepro.labelBoxes[0].label.trim()) {
  throw new Error("the reviewer blank-axis repro must retain a useful date label");
}

[
  ["2026-09-11T08:00:00Z", "2026-09-11T08:01:00Z", 80, "one-minute phone zoom"],
  ["2026-09-11T08:00:00Z", "2026-09-11T14:00:00Z", 80, "six-hour phone zoom"],
  ["2026-09-10T08:00:00Z", "2026-09-12T08:00:00Z", 120, "two-day narrow zoom"],
  ["2026-09-01T00:00:00Z", "2026-09-13T00:00:00Z", 256.99, "phone plot"],
  ["2016-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 180, "ten-year narrow plot"],
].forEach(([from, to, width, label]) => {
  const plan = axisRange(from, to, width);
  assertAxisPlanFits(plan, width, label);
  if (!plan.ticks.length || !plan.labelBoxes.some((box) => box.label.trim())) {
    throw new Error(`${label} planner must always retain a meaningful label`);
  }
  if (plan.ticks.length > Math.floor(width / 50) + 1) {
    throw new Error(`${label} planner must not overflow its width budget`);
  }
});

const slidingBase = Date.parse("2026-09-01T00:00:00Z");
for (let hour = 0; hour < 336; hour += 1) {
  const start = slidingBase + hour * 3600000;
  [
    [7 * 86400000, 259, "sliding 1W"],
    [30 * 86400000, 259, "sliding 1M"],
    [7.5 * 86400000, 343, "sliding 7.5-day"],
    [12 * 86400000, 259, "sliding 12-day phone"],
    [12 * 86400000, 343, "sliding 12-day tablet"],
    [20 * 86400000, 259, "sliding 20-day phone"],
    [20 * 86400000, 343, "sliding 20-day tablet"],
  ].forEach(([span, width, label]) => {
    const plan = api.historyAxisPlan(start, start + span, width);
    assertAxisPlanFits(plan, width, label);
    if (!plan.ticks.length || !plan.labelBoxes.some((box) => box.label.trim())) {
      throw new Error(`${label} plan must not be blank at offset hour ${hour}`);
    }
  });
}
const withinYear = axisRange("2027-02-01T00:00:00Z", "2027-11-30T00:00:00Z", 259);
assertAxisPlanFits(withinYear, 259, "single-year nine-month view");
if (!withinYear.ticks.length || withinYear.unit !== "month" || !withinYear.labelBoxes.every((box) => /2027/.test(box.label))) {
  throw new Error("a single-year multi-month view without January must retain useful month/year labels");
}

const springBoundaries = api.historyCalendarBoundaries(
  Date.parse("2026-03-27T00:00:00Z"), Date.parse("2026-03-31T00:00:00Z"), "day", 1
);
const springDurations = springBoundaries.slice(1).map((value, index) => value - springBoundaries[index]);
if (!springDurations.includes(23 * 3600000)) {
  throw new Error("Vienna spring DST calendar boundaries must include a 23-hour local day");
}
const fallBoundaries = api.historyCalendarBoundaries(
  Date.parse("2026-10-23T00:00:00Z"), Date.parse("2026-10-27T00:00:00Z"), "day", 1
);
const fallDurations = fallBoundaries.slice(1).map((value, index) => value - fallBoundaries[index]);
if (!fallDurations.includes(25 * 3600000)) {
  throw new Error("Vienna fall DST calendar boundaries must include a 25-hour local day");
}
[
  ["2026-03-29T00:00:00Z", "2026-03-29T05:00:00Z", "spring"],
  ["2026-10-25T00:00:00Z", "2026-10-25T05:00:00Z", "fall"],
].forEach(([from, to, season]) => {
  const ticks = api.historyCalendarBoundaries(Date.parse(from), Date.parse(to), "hour", 1);
  if (!ticks.length || ticks.length > 8 || ticks.some((tick, index) => index && tick <= ticks[index - 1])) {
    throw new Error(`Vienna ${season} DST intraday boundaries must make bounded forward progress`);
  }
});

const resizeHelpers = extractJoeBlock("  function resizeHistoryChart(force)", "\n\n  function bindControls()");
const resizeHarness = new Function(`
  var pendingFrame = null;
  var observerCallback = null;
  var narrowFits = 0;
  var chartResizes = 0;
  var historyChartSize = { width: 0, height: 0 };
  var visualResizeFrame = 0;
  var visualResizeNeedsNarrowFit = false;
  var historyResizeObserver = null;
  var wrap = { clientWidth: 332, clientHeight: 178 };
  var historyState = { chart: { resize: function () { chartResizes += 1; } } };
  var document = { querySelector: function () { return wrap; } };
  function FakeResizeObserver(callback) { observerCallback = callback; }
  FakeResizeObserver.prototype.observe = function () {};
  FakeResizeObserver.prototype.disconnect = function () {};
  var window = {
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: function (callback) { pendingFrame = callback; return 1; },
    cancelAnimationFrame: function () { pendingFrame = null; },
    addEventListener: function () {}
  };
  function drawSparklines() {}
  function isNarrowGridViewport() { return true; }
  function scheduleNarrowFit() { narrowFits += 1; }
${resizeHelpers}
  return {
    observe: observeHistoryCanvas,
    observerTick: function () { observerCallback(); },
    generalResize: function () { resizeVisuals(); },
    flush: function () { var callback = pendingFrame; pendingFrame = null; if (callback) { callback(); } },
    counts: function () { return { fits: narrowFits, chartResizes: chartResizes }; }
  };
`);
const resizeApi = resizeHarness();
resizeApi.observe();
resizeApi.observerTick();
resizeApi.flush();
if (resizeApi.counts().fits !== 0 || resizeApi.counts().chartResizes !== 1) {
  throw new Error("history ResizeObserver must resize the chart without rearming narrow content fit");
}
resizeApi.generalResize();
resizeApi.observerTick();
resizeApi.flush();
if (resizeApi.counts().fits !== 1) {
  throw new Error("normal window/grid resize must preserve one bounded narrow content-fit request");
}
resizeApi.observerTick();
resizeApi.flush();
if (resizeApi.counts().fits !== 1) {
  throw new Error("observer-only resize must not recursively grow the mobile history tile");
}

const narrowHistoryFitRows = new Function(`
  var NARROW_TILE_MIN_ROWS = { history: 8 };
  function narrowGridTilePixels(rows) { return rows * 82; }
  function narrowRowsForOuterPixels(pixels) { return Math.max(1, Math.ceil(pixels / 82)); }
${extractJoeBlock("  function narrowHistoryFitRows(item, historyWidget, settings)", "\n\n  function scheduleNarrowFit(pass)")}
  return narrowHistoryFitRows;
`)();
const fittedHistoryWidget = { clientHeight: 636, scrollHeight: 636 };
const initialHistoryItem = { id: "history", h: 8 };
const firstStableRows = narrowHistoryFitRows(initialHistoryItem, fittedHistoryWidget, {});
const repeatedStableRows = narrowHistoryFitRows({ ...initialHistoryItem, h: firstStableRows }, fittedHistoryWidget, {});
if (firstStableRows !== 8 || repeatedStableRows !== 8) {
  throw new Error("repeated history draws must not add drag, border, or tile padding to an already fitted widget");
}
const overflowRows = narrowHistoryFitRows(initialHistoryItem, { clientHeight: 636, scrollHeight: 700 }, {});
const settledRows = narrowHistoryFitRows({ ...initialHistoryItem, h: overflowRows }, { clientHeight: 718, scrollHeight: 718 }, {});
if (overflowRows !== 9 || settledRows !== 9) {
  throw new Error("history fitting must grow once for true intrinsic overflow and remain stable after it fits");
}

const oneDay = api.filterPoints(points, "1d");
if (oneDay.length !== 1 || oneDay[0].t !== points[2].t) {
  throw new Error("filterPoints must keep samples inside the selected time window");
}
if (api.filterPoints(points, "all").length !== 3) {
  throw new Error("filterPoints all must preserve every sample");
}

const capturedBackfill = {
  capturedSubtotal: {
    points: [
      { at: "2026-09-10T08:00:00.000Z", realizedPnl: -2 },
      { at: "2026-09-10T11:00:00.000Z", realizedPnl: 4 },
      { at: "2026-09-10T16:30:00.000Z", realizedPnl: 4 },
    ],
  },
};
if (api.capturedHistoryWindow(capturedBackfill, "1d", "2026-09-11T16:31:00.000Z").length !== 0) {
  throw new Error("captured 1D history must be an exact trailing 24-hour window, not an all-time fallback");
}
const capturedInWindow = api.capturedHistoryWindow(capturedBackfill, "1d", "2026-09-11T08:00:00.000Z");
if (capturedInWindow.length !== 3 || capturedInWindow[0].at !== capturedBackfill.capturedSubtotal.points[0].at) {
  throw new Error("captured 1D history must preserve only actual points inside the reference window");
}
if (api.capturedHistoryWindow(capturedBackfill, "all", "2026-09-20T00:00:00.000Z").length !== 3) {
  throw new Error("captured ALL history must preserve every actual point");
}

const validPayload = {
  schema: "inspr.joe.household.history.v1",
  points
};
const retainedLegacyBytes = JSON.stringify(validPayload.points);
const parsed = api.validateHistoryPayload(validPayload);
if (parsed.length !== 3) throw new Error("valid history payload rejected");
api.basisAwareSeries(parsed, "joel");
if (JSON.stringify(validPayload.points) !== retainedLegacyBytes) {
  throw new Error("reading legacy samples must leave their serialized bytes unchanged");
}

const emptyPayload = { schema: "inspr.joe.household.history.v1", points: [] };
if (api.validateHistoryPayload(emptyPayload).length !== 0) {
  throw new Error("genuine empty history must be accepted");
}

let rejected = false;
try {
  api.validateHistoryPayload({ schema: "inspr.joe.household.history.v1", points: [{ t: "bad", desks: {} }] });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("invalid history samples must be rejected");

const goodPoints = api.validateHistoryPayload(validPayload);
const malformed = api.applyHistoryFetchResult(goodPoints, {
  schema: "inspr.joe.household.history.v1",
  points: [{ t: "still-bad", desks: {} }]
});
if (malformed.points.length !== goodPoints.length || !malformed.error) {
  throw new Error("malformed refresh must preserve last good history");
}

const cleared = api.applyHistoryFetchResult(goodPoints, validPayload);
if (cleared.error || cleared.points.length !== 3) {
  throw new Error("successful refresh must clear history error and accept payload");
}

let mixedRejected = false;
try {
  api.validateHistoryPayload({
    schema: "inspr.joe.household.history.v1",
    points: [points[0], { t: "bad", desks: {} }]
  });
} catch {
  mixedRejected = true;
}
if (!mixedRejected) {
  throw new Error("mixed valid/malformed history payload must be rejected whole");
}

const mixedMalformed = api.applyHistoryFetchResult(goodPoints, {
  schema: "inspr.joe.household.history.v1",
  points: [points[0], { t: "bad", desks: {} }]
});
if (mixedMalformed.points.length !== goodPoints.length || !mixedMalformed.error) {
  throw new Error("mixed valid/malformed refresh must preserve last good history");
}

const emptyClear = api.applyHistoryFetchResult(mixedMalformed.points, emptyPayload);
if (emptyClear.error || emptyClear.points.length !== 0) {
  throw new Error("genuine valid empty refresh must clear history error");
}

const firstFetchMessage = api.historyFailureMessage(new Error("HTTP 404"), false);
if (firstFetchMessage.includes("last good")) {
  throw new Error("first-fetch failure must not claim a retained series");
}
if (!firstFetchMessage.includes("Retry")) {
  throw new Error("first-fetch failure must invite retry");
}

const retainedMessage = api.historyFailureMessage(new Error("HTTP 503"), true);
if (!retainedMessage.includes("last good series")) {
  throw new Error("retained-series failure must say last good series is shown");
}

const samples = api.sparklineSamples(points, "1w", "joe");
if (samples.length !== 3) {
  throw new Error("sparkline samples must follow the filtered time window, not a fixed count");
}
if (samples[1].y !== 210 || samples[2].y !== null) {
  throw new Error("sparkline samples must preserve null gaps instead of compressing values");
}

const timeSpan = samples[2].x - samples[0].x;
const middleOffset = samples[1].x - samples[0].x;
if (Math.abs(middleOffset - timeSpan / 2) < 60 * 60 * 1000) {
  throw new Error("sparkline samples must stay proportional to actual timestamps, not index spacing");
}

const shortWindow = api.sparklineSamples(points, "1d", "j");
if (shortWindow.length !== 1 || shortWindow[0].y !== 120) {
  throw new Error("range changes must narrow sparkline samples to the selected window");
}

const compare = api.sharedWindowCompare(points, ["j", "joel"], "all");
if (!compare.ok || compare.desks.length !== 2) {
  throw new Error("shared compare must work on common timestamps");
}
if (compare.desks[0].pctChange !== 20 || compare.desks[1].pctChange !== 10) {
  throw new Error("shared compare must use percent change from common start/end");
}
if (compare.startAt !== points[0].t || compare.endAt !== points[2].t) {
  throw new Error("shared compare must use earliest and latest common timestamps");
}

const sparsePoints = [
  { t: "2026-09-08T12:00:00+02:00", desks: { j: { equity: 100 }, joe: { equity: 200 } } },
  { t: "2026-09-09T11:00:00+02:00", desks: { j: { equity: 110 } } },
  { t: "2026-09-10T12:00:00+02:00", desks: { j: { equity: 120 }, joe: { equity: null } } }
];
const incomplete = api.sharedWindowCompare(sparsePoints, ["j", "joe"], "all");
if (incomplete.ok || incomplete.reason !== "incomplete-coverage") {
  throw new Error("incomplete common coverage must not fabricate a compare");
}

const zeroBaselinePoints = [
  { t: "2026-09-08T12:00:00+02:00", desks: { j: { equity: 0 }, joe: { equity: 0 } } },
  { t: "2026-09-09T12:00:00+02:00", desks: { j: { equity: 100 }, joe: { equity: 50 } } }
];
const zeroCompare = api.sharedWindowCompare(zeroBaselinePoints, ["j", "joe"], "all");
if (!zeroCompare.ok || Number.isFinite(zeroCompare.desks[0].pctChange)) {
  throw new Error("zero baseline must yield honest missing percent change");
}
if (api.formatPctChange(null) !== "—") {
  throw new Error("missing percent change must render as dash");
}

const accounting = {
  periodStart: "2026-09-10T04:00:00Z",
  method: "execution-fifo-net-current-fx",
  detail: "Net of recorded fees; converted at observed FX. Earlier results unavailable."
};
const laterAccounting = { ...accounting, periodStart: "2026-09-11T04:00:00Z" };
const sharedHistoryBasis = { j: "j.synthetic-stable.v1" };
const sameIdEarlierPeriod = {
  t: "2026-09-10T12:00:00Z",
  desks: { j: { equity: 50 } },
  accounting: { j: accounting },
  historyBasis: sharedHistoryBasis
};
const sameIdLaterPeriod = {
  t: "2026-09-11T12:00:00Z",
  desks: { j: { equity: 51 } },
  accounting: { j: laterAccounting },
  historyBasis: sharedHistoryBasis
};
if (api.compatibleAccountingBasis(sameIdEarlierPeriod, sameIdLaterPeriod, "j")) {
  throw new Error("a stable history basis id must not override a changed accounting periodStart");
}
const sameIdDifferentMethod = {
  ...sameIdLaterPeriod,
  accounting: { j: { ...accounting, method: "synthetic-other-method" } }
};
if (api.compatibleAccountingBasis(sameIdEarlierPeriod, sameIdDifferentMethod, "j")) {
  throw new Error("a stable history basis id must not override a changed accounting method");
}
const legacyServerPoint = historyPointFromSnapshot({
  generatedAt: "2026-09-09T12:00:00Z",
  desks: [{ id: "j", money: { equity: 100, dayPnl: 0, totalPnl: 0 } }],
  totals: { equity: 100, dayPnl: 0, totalPnl: 0 }
});
if (Object.prototype.hasOwnProperty.call(legacyServerPoint, "accounting")) {
  throw new Error("server must not add accounting to legacy history points");
}
const scopedServerPoint = historyPointFromSnapshot({
  generatedAt: "2026-09-10T12:00:00Z",
  desks: [
    { id: "j", accounting, money: { equity: 50, dayPnl: 0, totalPnl: 0 } },
    { id: "joe", money: { equity: 210, dayPnl: 2, totalPnl: 10 } },
    { id: "joel", money: { equity: 310, dayPnl: 3, totalPnl: 20 } }
  ],
  totals: { equity: 570, dayPnl: 5, totalPnl: 30 }
});
if (JSON.stringify(scopedServerPoint.accounting) !== JSON.stringify({ j: accounting })) {
  throw new Error("server history point must preserve J accounting basis");
}
const explicitlyBasedServerPoint = historyPointFromSnapshot({
  generatedAt: "2026-09-10T12:30:00Z",
  desks: [
    { id: "joel", historyBasis: "joel.stage0-keep-excluded.v1", money: { equity: 5000, dayPnl: null, totalPnl: 0 } }
  ],
  totals: { equity: 5000, dayPnl: null, totalPnl: 0 }
});
if (JSON.stringify(explicitlyBasedServerPoint.historyBasis) !== JSON.stringify({ joel: "joel.stage0-keep-excluded.v1" })) {
  throw new Error("server history point must preserve the explicit per-desk history basis");
}
const unavailableServerPoint = historyPointFromSnapshot({
  generatedAt: "2026-09-10T13:00:00Z",
  desks: [
    {
      id: "j",
      money: { equity: null, dayPnl: null, totalPnl: null },
      backfill: {
        capturedSubtotal: {
          realizedPnl: -37.125,
          currency: "USD",
          points: [
            { at: "2026-09-10T08:01:00.000Z", realizedPnl: 6.5 },
            { at: "2026-09-10T08:05:00.000Z", realizedPnl: -37.125 },
          ],
          pointsTruncated: false,
        },
      }
    },
    { id: "joe", money: { equity: 211, dayPnl: 2, totalPnl: 11 } },
    { id: "joel", money: { equity: 311, dayPnl: 3, totalPnl: 21 } }
  ],
  totals: { equity: null, dayPnl: null, totalPnl: null }
});
if (Object.prototype.hasOwnProperty.call(unavailableServerPoint, "accounting")) {
  throw new Error("an unavailable untyped J row must remain explicitly without accounting metadata");
}
if (Object.prototype.hasOwnProperty.call(unavailableServerPoint.desks.j, "backfill") ||
    JSON.stringify(unavailableServerPoint).includes("-37.125") ||
    JSON.stringify(unavailableServerPoint).includes("2026-09-10T08:01:00.000Z")) {
  throw new Error("server history must not copy partial J backfill metadata, subtotal, or curve");
}
if (
  unavailableServerPoint.desks.j.equity !== null ||
  unavailableServerPoint.desks.j.totalPnl !== null ||
  unavailableServerPoint.totals.equity !== null ||
  unavailableServerPoint.desks.joe.equity !== 211 ||
  unavailableServerPoint.desks.joel.equity !== 311
) {
  throw new Error("server history must retain J/totals null without altering Joe or Joel");
}
const restoredServerPoint = historyPointFromSnapshot({
  generatedAt: "2026-09-10T14:00:00Z",
  desks: [
    { id: "j", accounting, money: { equity: 55, dayPnl: 1, totalPnl: 5 } },
    { id: "joe", money: { equity: 212, dayPnl: 2, totalPnl: 12 } },
    { id: "joel", money: { equity: 312, dayPnl: 3, totalPnl: 22 } }
  ],
  totals: { equity: 579, dayPnl: 6, totalPnl: 39 }
});
const unavailableWindow = [scopedServerPoint, unavailableServerPoint, restoredServerPoint];
const trailingUnavailableJSeries = api.sparklineSamples(unavailableWindow.slice(0, 2), "all", "j");
if (JSON.stringify(trailingUnavailableJSeries.map((sample) => sample.y)) !== JSON.stringify([50, null])) {
  throw new Error("a trailing untyped all-null J row must preserve the last valid J basis and remain a gap");
}
const unavailableJSeries = api.sparklineSamples(unavailableWindow, "all", "j");
if (JSON.stringify(unavailableJSeries.map((sample) => sample.y)) !== JSON.stringify([50, null, 55])) {
  throw new Error("J series must retain the explicit unavailable gap");
}
const uninterruptedJoeSeries = api.sparklineSamples(unavailableWindow, "all", "joe");
if (JSON.stringify(uninterruptedJoeSeries.map((sample) => sample.y)) !== JSON.stringify([210, 211, 212])) {
  throw new Error("Joe series must remain available through J's gap");
}
const gapCompare = api.sharedWindowCompare(unavailableWindow, ["j", "joe"], "all");
if (gapCompare.ok || gapCompare.reason !== "incomplete-coverage") {
  throw new Error("shared compare must not bridge J's unavailable history gap");
}
const unaffectedCompare = api.sharedWindowCompare(unavailableWindow, ["joe", "joel"], "all");
if (!unaffectedCompare.ok || unaffectedCompare.pointCount !== 3) {
  throw new Error("Joe/Joel compare must continue through J's unavailable history gap");
}
const transitionPoints = [
  { t: "2026-09-09T12:00:00Z", desks: { j: { equity: 100 }, joe: { equity: 200 }, joel: { equity: 300 } } },
  { t: "2026-09-10T12:00:00Z", desks: { j: { equity: 50 }, joe: { equity: 210 }, joel: { equity: 310 } }, accounting: { j: accounting } },
  { t: "2026-09-11T12:00:00Z", desks: { j: { equity: 60 }, joe: { equity: 220 }, joel: { equity: 330 } }, accounting: { j: accounting } }
];
const transitionPayload = { schema: "inspr.joe.household.history.v1", points: transitionPoints };
if (api.validateHistoryPayload(transitionPayload).length !== 3) {
  throw new Error("history points with optional per-desk accounting must be accepted");
}
const brokenJ = api.sparklineSamples(transitionPoints, "all", "j");
if (brokenJ.length !== 2 || brokenJ[0].y !== 50 || brokenJ[1].y !== 60) {
  throw new Error("J sparkline must select only the newest verified accounting basis");
}
const changedKnownPeriodPoints = [
  sameIdEarlierPeriod,
  sameIdLaterPeriod,
  {
    ...sameIdLaterPeriod,
    t: "2026-09-11T13:00:00Z",
    desks: { j: { equity: 52 } }
  }
];
const changedKnownPeriodSeries = api.basisAwareSeries(changedKnownPeriodPoints, "j");
if (JSON.stringify(changedKnownPeriodSeries.map((sample) => sample.y)) !== JSON.stringify([51, 52])) {
  throw new Error("a true accounting-period change must select only the new known period");
}
const unchangedJoe = api.sparklineSamples(transitionPoints, "all", "joe");
if (unchangedJoe.length !== 3 || unchangedJoe.some((sample) => sample.y === null)) {
  throw new Error("Joe sparkline must remain unchanged when only J accounting changes");
}
const scopedCompare = api.sharedWindowCompare(transitionPoints, ["j", "joe"], "all");
if (!scopedCompare.ok || scopedCompare.startAt !== transitionPoints[1].t || scopedCompare.pointCount !== 2) {
  throw new Error("J compare must begin at the newest compatible accounting window");
}
if (scopedCompare.desks[0].pctChange !== 20) {
  throw new Error("J compare must not use legacy equity as the verified-period baseline");
}
const unchangedCompare = api.sharedWindowCompare(transitionPoints, ["joe", "joel"], "all");
if (!unchangedCompare.ok || unchangedCompare.startAt !== transitionPoints[0].t || unchangedCompare.pointCount !== 3) {
  throw new Error("Joe/Joel compare must remain unchanged by J's accounting transition");
}
const oneVerifiedPoint = api.sharedWindowCompare(transitionPoints.slice(0, 2), ["j", "joe"], "all");
if (oneVerifiedPoint.ok || oneVerifiedPoint.reason !== "incompatible-basis") {
  throw new Error("compare must not connect a legacy point to a lone verified point");
}

let malformedAccountingRejected = false;
try {
  api.validateHistoryPayload({
    schema: "inspr.joe.household.history.v1",
    points: [{ ...transitionPoints[1], accounting: { j: { ...accounting, periodStart: "2026-09-10" } } }]
  });
} catch {
  malformedAccountingRejected = true;
}
if (!malformedAccountingRejected) {
  throw new Error("malformed history accounting basis must be rejected");
}

const syntheticJoelBasisPoints = [
  { t: "2026-09-08T12:00:00Z", desks: { j: { equity: 5000 }, joe: { equity: 5000 }, joel: { equity: 12000 } } },
  { t: "2026-09-09T12:00:00Z", desks: { j: { equity: 5001 }, joe: { equity: 5000 }, joel: { equity: 11000 } } },
  { t: "2026-09-10T12:00:00Z", desks: { j: { equity: 5002 }, joe: { equity: 5000 }, joel: { equity: 5000 } }, historyBasis: { joel: "joel.stage0-keep-excluded.v1" } },
  { t: "2026-09-11T12:00:00Z", desks: { j: { equity: 5003 }, joe: { equity: 5000 }, joel: { equity: 5002 } }, historyBasis: { joel: "joel.stage0-keep-excluded.v1" } }
];
const joelLatest = api.basisAwareSeries(syntheticJoelBasisPoints, "joel");
if (JSON.stringify(joelLatest.map((sample) => sample.y)) !== JSON.stringify([5000, 5002])) {
  throw new Error("explicit ALL must select only Joel's latest compatible basis");
}
const visibleDomain = joelLatest.filter((sample) => Number.isFinite(sample.y)).map((sample) => sample.y);
if (Math.min(...visibleDomain) !== 5000 || Math.max(...visibleDomain) !== 5002) {
  throw new Error("incompatible legacy Joel values must not enter the visible y-domain");
}
const basisNotice = api.historyBasisNotice(syntheticJoelBasisPoints, ["j", "joe", "joel"], "all");
if (basisNotice !== "This chart shows comparable records for Joel. Older or unidentified records are retained in history.json.") {
  throw new Error("basis exclusion notice must explain retained older Joel observations honestly");
}
if (api.basisAwareSeries(syntheticJoelBasisPoints, "joe").length !== 4) {
  throw new Error("Joe's independent untyped history must remain unchanged");
}
const latestAllCompare = api.sharedWindowCompare(syntheticJoelBasisPoints, ["j", "joe", "joel"], "all");
if (!latestAllCompare.ok || latestAllCompare.startAt !== syntheticJoelBasisPoints[2].t || latestAllCompare.pointCount !== 2) {
  throw new Error("all-bots compare must use the shared suffix on the latest compatible desk bases");
}

const missingLatestBasis = syntheticJoelBasisPoints.concat({
  t: "2026-09-11T13:00:00Z",
  desks: { joel: { equity: 5003 } }
});
const missingSelection = api.latestCompatibleBasis(missingLatestBasis, "joel");
if (missingSelection.points.length !== 1 || missingSelection.excludedCount !== 4) {
  throw new Error("a newest untyped observation must not be silently merged into an explicit basis");
}
const unidentifiedNotice = api.historyBasisNotice(missingLatestBasis, ["joel"], "all");
if (unidentifiedNotice !== "This chart shows comparable records for Joel. Older or unidentified records are retained in history.json.") {
  throw new Error("unidentified basis copy must avoid claiming whether old and new calculations match");
}
if (api.sharedWindowCompare(missingLatestBasis, ["j", "joel"], "all").ok) {
  throw new Error("mixed missing basis metadata must not fabricate a comparison");
}

const literalUntypedIdPoints = [
  { t: "2026-09-10T10:00:00Z", desks: { joel: { equity: 12000 } } },
  { t: "2026-09-10T11:00:00Z", desks: { joel: { equity: 5000 } }, historyBasis: { joel: "untyped" } }
];
api.validateHistoryPayload({ schema: "inspr.joe.household.history.v1", points: literalUntypedIdPoints });
const literalUntypedIdSeries = api.basisAwareSeries(literalUntypedIdPoints, "joel");
if (literalUntypedIdSeries.length !== 1 || literalUntypedIdSeries[0].y !== 5000) {
  throw new Error("a valid literal untyped basis id must remain distinct from absent basis metadata");
}

const sameTagAroundUnidentified = [
  { t: "2026-09-10T10:00:00Z", desks: { joel: { equity: 5000 } }, historyBasis: { joel: "joel.synthetic.v1" } },
  { t: "2026-09-10T11:00:00Z", desks: { joel: { equity: null, totalPnl: 0 } } },
  { t: "2026-09-10T12:00:00Z", desks: { joel: { equity: 5001 } }, historyBasis: { joel: "joel.synthetic.v1" } }
];
const sameTagSeparatedSeries = api.basisAwareSeries(sameTagAroundUnidentified, "joel");
if (sameTagSeparatedSeries.length !== 1 || sameTagSeparatedSeries[0].y !== 5001) {
  throw new Error("an unidentified meaningful row must prevent matching tags from being joined across it");
}
const neutralSeparatedNotice = api.historyBasisNotice(sameTagAroundUnidentified, ["joel"], "all");
if (neutralSeparatedNotice !== "This chart shows comparable records for Joel. Older or unidentified records are retained in history.json.") {
  throw new Error("same tags separated by an unidentified meaningful row must use neutral history copy");
}
if (/changed/i.test(neutralSeparatedNotice)) {
  throw new Error("history notice must not claim a known calculation change across unidentified records");
}

let malformedHistoryBasisRejected = false;
try {
  api.validateHistoryPayload({
    schema: "inspr.joe.household.history.v1",
    points: [{ ...syntheticJoelBasisPoints[2], historyBasis: { joel: "KEEP excluded current" } }]
  });
} catch {
  malformedHistoryBasisRejected = true;
}
if (!malformedHistoryBasisRejected) {
  throw new Error("malformed explicit history basis must be rejected");
}

const snapshotFixture = JSON.parse(
  await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8")
);
snapshotFixture.desks.find((desk) => desk.id === "joel").historyBasis = "joel.stage0-keep-excluded.v1";
if (!validateHouseholdSnapshot(snapshotFixture).ok) {
  throw new Error("snapshot validator must accept a valid explicit per-desk history basis");
}
snapshotFixture.desks.find((desk) => desk.id === "joel").historyBasis = "KEEP excluded current";
if (validateHouseholdSnapshot(snapshotFixture).ok) {
  throw new Error("snapshot validator must reject a malformed explicit per-desk history basis");
}

if (api.basisAwareSeries([], "joel").length !== 0) {
  throw new Error("empty history must remain honestly empty");
}
const oneCurrentPoint = api.basisAwareSeries(syntheticJoelBasisPoints.slice(0, 3), "joel");
if (oneCurrentPoint.length !== 1 || oneCurrentPoint[0].y !== 5000) {
  throw new Error("a single current-basis point must be retained without inventing a trend");
}

const continuityReference = Date.parse("2026-09-11T12:00:00Z");
const expectedRangeSpans = { "1d": 864e5, "1w": 7 * 864e5, "1m": 30 * 864e5, all: 864e5 };
for (const deskId of ["j", "joe", "joel"]) {
  for (const range of ["1d", "1w", "1m", "all"]) {
    const emptyContinuity = api.historyContinuitySeries([], deskId, range, continuityReference);
    if (emptyContinuity.endAt !== continuityReference || emptyContinuity.startAt !== continuityReference - expectedRangeSpans[range]) {
      throw new Error(`${deskId} ${range} continuity must use the deterministic reference and exact range`);
    }
    if (emptyContinuity.observed.length !== 0 || emptyContinuity.gapFill.length !== 2) {
      throw new Error(`${deskId} ${range} no-history continuity must retain an empty observed series and one guide`);
    }
    if (emptyContinuity.gapFill.some((sample) => sample.y !== 5000 || sample.joeEvidence !== "gap-fill" || !sample.estimated)) {
      throw new Error(`${deskId} ${range} no-history guide must remain explicitly estimated at EUR 5000`);
    }
  }
}

const continuityStart = Date.parse("2026-09-11T10:00:00Z");
const leadingFixture = [
  { t: new Date(continuityStart).toISOString(), desks: { j: {}, joe: {}, joel: {} } },
  { t: new Date(continuityStart + 10 * 60e3).toISOString(), desks: { j: { equity: 5100 }, joe: { equity: 5200 }, joel: { equity: 5300 } } }
];
const leadingBytes = JSON.stringify(leadingFixture);
for (const deskId of ["j", "joe", "joel"]) {
  const model = api.historyContinuitySeries(leadingFixture, deskId, "all", continuityStart + 20 * 60e3);
  const firstGap = model.gapFill.find((sample) => Number.isFinite(sample.y));
  const lastGap = model.gapFill.filter((sample) => Number.isFinite(sample.y)).at(-1);
  if (!firstGap || firstGap.x !== continuityStart || firstGap.y !== 5000 || !firstGap.baseline || firstGap.assumption !== "assumed-baseline") {
    throw new Error(`${deskId} leading continuity must anchor an explicit display-only EUR 5000 baseline`);
  }
  if (!lastGap || lastGap.x !== model.endAt || lastGap.y !== 5000 + ({ j: 100, joe: 200, joel: 300 })[deskId] || !lastGap.carried) {
    throw new Error(`${deskId} trailing continuity must carry the last observation to the reference time`);
  }
  if (model.observed.filter((sample) => Number.isFinite(sample.y)).length !== 1 || !model.observed.find((sample) => sample.isolated)) {
    throw new Error(`${deskId} isolated observation must remain visible as recorded evidence`);
  }
}
if (JSON.stringify(leadingFixture) !== leadingBytes) {
  throw new Error("continuity modeling must not mutate retained history");
}

const explicitNullFixture = [
  { t: "2026-09-11T10:00:00Z", desks: { joe: { equity: 5000 } } },
  { t: "2026-09-11T10:02:00Z", desks: { joe: { equity: null } } },
  { t: "2026-09-11T10:04:00Z", desks: { joe: { equity: 5004 } } }
];
const explicitNull = api.historyContinuitySeries(explicitNullFixture, "joe", "all", Date.parse("2026-09-11T10:06:00Z"));
const nullEstimate = explicitNull.gapFill.find((sample) => sample.x === Date.parse("2026-09-11T10:02:00Z") && Number.isFinite(sample.y));
if (!nullEstimate || nullEstimate.y !== 5002 || nullEstimate.gapReason !== "explicit-null" || nullEstimate.assumption !== "interpolated") {
  throw new Error("explicit null must become a labelled linear interpolation, never a solid bridge");
}
if (!explicitNull.observed.some((sample) => sample.y === null && sample.gapReason === "explicit-null")) {
  throw new Error("explicit null must break the observed dataset");
}

const absentFixture = [
  { t: "2026-09-11T10:00:00Z", desks: { j: { equity: 5000 } } },
  { t: "2026-09-11T10:02:00Z", desks: {} },
  { t: "2026-09-11T10:04:00Z", desks: { j: { equity: 5008 } } }
];
const absentContinuity = api.historyContinuitySeries(absentFixture, "j", "all", Date.parse("2026-09-11T10:04:00Z"));
const absentEstimate = absentContinuity.gapFill.find((sample) => sample.x === Date.parse("2026-09-11T10:02:00Z") && Number.isFinite(sample.y));
if (!absentEstimate || absentEstimate.y !== 5004 || absentEstimate.gapReason !== "absent-observation") {
  throw new Error("an absent desk sample must become an explicitly estimated interpolation");
}

const timestampHoleFixture = [
  { t: "2026-09-11T10:00:00Z", desks: { joel: { equity: 5000 } } },
  { t: "2026-09-11T10:05:00Z", desks: { joel: { equity: 5005 } } },
  { t: "2026-09-11T10:10:01Z", desks: { joel: { equity: 5010 } } }
];
const timestampHole = api.historyContinuitySeries(timestampHoleFixture, "joel", "all", Date.parse("2026-09-11T10:10:01Z"));
if (!timestampHole.observed.some((sample) => sample.y === null && sample.gapReason === "timestamp-gap")) {
  throw new Error("an observation interval over five minutes must break the solid dataset");
}
if (!timestampHole.gapFill.some((sample) => Number.isFinite(sample.y) && sample.gapReason === "timestamp-gap")) {
  throw new Error("a timestamp hole must receive a dotted interpolated connector");
}

const whollyMissing = api.historyContinuitySeries([
  { t: "2026-09-08T12:00:00Z", desks: { j: { equity: 5123 } } }
], "j", "1d", continuityReference);
const whollyMissingFinite = whollyMissing.gapFill.filter((sample) => Number.isFinite(sample.y));
if (whollyMissing.observed.length !== 0 || whollyMissingFinite.length !== 2 ||
    whollyMissingFinite[0].x !== whollyMissing.startAt || whollyMissingFinite[1].x !== whollyMissing.endAt ||
    whollyMissingFinite.some((sample) => sample.y !== 5123 || sample.assumption !== "last-value-carry")) {
  throw new Error("a view wholly inside a trailing hole must draw a clipped carried connector across the full window");
}

const futureExcluded = api.historyContinuitySeries([
  { t: "2026-09-11T11:58:00Z", desks: { joe: { equity: 5001 } } },
  { t: "2026-09-11T12:01:00Z", desks: { joe: { equity: 9999 } } }
], "joe", "1d", continuityReference);
if (futureExcluded.observed.some((sample) => sample.y === 9999) || futureExcluded.gapFill.some((sample) => sample.y === 9999)) {
  throw new Error("continuity must not observe or extrapolate a future sample past the reference time");
}

const joelContinuity = api.historyContinuitySeries(syntheticJoelBasisPoints, "joel", "all", continuityReference);
if (joelContinuity.observed.some((sample) => sample.y === 11000 || sample.y === 12000) ||
    joelContinuity.gapFill.some((sample) => sample.y === 11000 || sample.y === 12000)) {
  throw new Error("continuity must not reintroduce incompatible legacy accounting values as observations or estimates");
}
if (!joelContinuity.gapFill.some((sample) => sample.baseline && sample.y === 5000)) {
  throw new Error("excluded leading accounting history must be joined only from the assumed display baseline");
}

const compareFixtureBytes = JSON.stringify(unavailableWindow);
const compareBeforeContinuity = JSON.stringify(api.sharedWindowCompare(unavailableWindow, ["joe", "joel"], "all"));
api.historyContinuitySeries(unavailableWindow, "j", "all", Date.parse("2026-09-10T15:00:00Z"));
const compareAfterContinuity = JSON.stringify(api.sharedWindowCompare(unavailableWindow, ["joe", "joel"], "all"));
if (compareAfterContinuity !== compareBeforeContinuity || JSON.stringify(unavailableWindow) !== compareFixtureBytes) {
  throw new Error("display continuity must leave compare results and history input unchanged");
}

if (!/joeEvidence:\s*"observed"[\s\S]*joeEvidence:\s*"gap-fill"/.test(joeSource) ||
    !/borderColor:\s*cssVar\("--chart-gap-fill"\)/.test(joeSource) ||
    !/borderDash:\s*\[2, 4\]/.test(joeSource) ||
    !/filter:\s*function \(item, chartData\).*joeEvidence !== "gap-fill"/.test(joeSource)) {
  throw new Error("Chart.js history rendering must expose two evidence datasets and hide dotted connectors from its ordinary legend");
}
if (!joeSource.includes("assumed €5,000 starting baseline (display only)") ||
    !joeSource.includes("estimated · last recorded value carried")) {
  throw new Error("gap tooltips must explicitly distinguish baseline assumptions and estimates");
}

const legendDatasets = [
  { joeDeskId: "joe", joeEvidence: "observed" },
  { joeDeskId: "joe", joeEvidence: "gap-fill" },
  { joeDeskId: "joel", joeEvidence: "observed" },
  { joeDeskId: "joel", joeEvidence: "gap-fill" }
];
const legendVisibility = [true, true, true, true];
let legendUpdates = 0;
const legendChart = {
  data: { datasets: legendDatasets },
  isDatasetVisible(index) { return legendVisibility[index]; },
  setDatasetVisibility(index, visible) { legendVisibility[index] = visible; },
  update() { legendUpdates += 1; }
};
if (api.toggleHistoryDeskDatasets(legendChart, 0) !== false ||
    JSON.stringify(legendVisibility) !== JSON.stringify([false, false, true, true]) || legendUpdates !== 1) {
  throw new Error("legend hide must toggle both datasets for one desk and leave another desk untouched");
}
if (api.toggleHistoryDeskDatasets(legendChart, 0) !== true ||
    JSON.stringify(legendVisibility) !== JSON.stringify([true, true, true, true]) || legendUpdates !== 2) {
  throw new Error("legend show must restore both desk datasets and the observed legend state together");
}
if (!/onClick:\s*function \(_event, item, legend\) \{ toggleHistoryDeskDatasets\(legend\.chart, item\.datasetIndex\); \}/.test(joeSource)) {
  throw new Error("the Chart.js legend click handler must use the coordinated desk-pair toggle");
}

const tooltipItems = {
  observed: { dataset: { joeEvidence: "observed" }, raw: { observedBoundary: true } },
  boundary: { dataset: { joeEvidence: "gap-fill" }, raw: { observedBoundary: true } },
  interpolated: { dataset: { joeEvidence: "gap-fill" }, raw: { assumption: "interpolated" } },
  baseline: { dataset: { joeEvidence: "gap-fill" }, raw: { assumption: "assumed-baseline", baseline: true } },
  carried: { dataset: { joeEvidence: "gap-fill" }, raw: { assumption: "last-value-carry", carried: true } }
};
if (!api.historyTooltipItemVisible(tooltipItems.observed) ||
    api.historyTooltipItemVisible(tooltipItems.boundary) ||
    !api.historyTooltipItemVisible(tooltipItems.interpolated) ||
    !api.historyTooltipItemVisible(tooltipItems.baseline) ||
    !api.historyTooltipItemVisible(tooltipItems.carried)) {
  throw new Error("history tooltips must suppress duplicate gap boundaries while retaining recorded and genuine estimate items");
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    "time-window-filter",
    "adaptive-vienna-axis-scales",
    "plot-width-tick-density",
    "current-width-after-resize",
    "measured-inner-edge-label-spacing",
    "narrow-intraday-planner-budget",
    "sliding-narrow-windows-never-blank",
    "chartjs-single-tick-right-align-model",
    "single-year-range-keeps-month-year-label",
    "english-weekday-date-time-labels",
    "vienna-spring-dst-day-boundary",
    "vienna-fall-dst-day-boundary",
    "vienna-dst-intraday-forward-progress",
    "observer-chart-resize-does-not-rearm-mobile-fit",
    "history-mobile-fit-idempotent-after-draw",
    "history-mobile-fit-grows-only-for-real-overflow",
    "valid-empty-history",
    "reject-malformed-history",
    "preserve-last-good-on-fail",
    "reject-mixed-valid-malformed",
    "preserve-last-good-on-mixed-fail",
    "genuine-valid-empty-clear",
    "first-fetch-honest-copy",
    "retained-series-copy",
    "sparkline-time-proportional",
    "range-aware-sparklines",
    "shared-window-percent-compare",
    "incomplete-coverage-honest",
    "zero-baseline-honest",
    "history-basis-adds-to-accounting-period-method",
    "legacy-server-history-unchanged",
    "legacy-samples-byte-unchanged",
    "server-history-persists-accounting",
    "server-history-persists-explicit-basis",
    "server-history-preserves-null",
    "server-history-excludes-backfill",
    "j-unavailable-series-gap",
    "j-trailing-untyped-null-preserves-last-valid",
    "j-gap-compare-blocked",
    "joe-joel-gap-unaffected",
    "accounting-history-optional",
    "j-latest-basis-selection",
    "j-true-period-change-selects-new-period",
    "joe-series-unchanged",
    "compatible-basis-compare",
    "joe-joel-compare-unchanged",
    "legacy-vs-verified-compare-blocked",
    "malformed-history-accounting-rejected",
    "joel-all-latest-basis-selection",
    "joel-y-domain-excludes-legacy",
    "basis-exclusion-notice",
    "joe-independent-history-unchanged",
    "all-bots-shared-latest-basis",
    "mixed-missing-basis-honest",
    "unidentified-basis-copy-honest",
    "literal-untyped-id-distinct-from-absence",
    "same-tag-unidentified-gap-neutral-copy",
    "malformed-history-basis-rejected",
    "snapshot-history-basis-validation",
    "empty-current-one-point-honest",
    "continuity-every-range-and-desk",
    "continuity-display-baseline-and-trailing-carry",
    "continuity-isolated-observation-visible",
    "continuity-input-immutable",
    "continuity-explicit-null-interpolation",
    "continuity-absent-desk-interpolation",
    "continuity-five-minute-threshold",
    "continuity-wholly-missing-window",
    "continuity-future-excluded",
    "continuity-accounting-basis-exclusion",
    "continuity-compare-unaffected",
    "continuity-chart-datasets-and-legend",
    "continuity-explicit-tooltip-copy",
    "continuity-legend-pair-toggle",
    "continuity-tooltip-boundary-deduplication"
  ]
}, null, 2));
