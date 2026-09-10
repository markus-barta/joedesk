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

const historyHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
  var number = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 4 });
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function historyRangeSpanMs(range)", "\n\n  function seriesBag(point, deskId)")}
${extractJoeBlock("  function seriesBag(point, deskId)", "\n\n  function destroyHistoryChart")}
${extractJoeBlock("  function formatPctChange(value)", "\n\n  function sharedWindowCompare(points, deskIds, range)")}
${extractJoeBlock("  function sharedWindowCompare(points, deskIds, range)", "\n\n  function deskDisplayName(deskId)")}
${extractJoeBlock("  function historyFailureMessage(error, hasRetainedSeries)", "\n\n  function updateHistoryStatusUI")}`;

const api = new Function(`${historyHelpers}
  return {
    filterPoints,
    historyRangeSpanMs,
    validateHistoryPayload,
    applyHistoryFetchResult,
    historyFailureMessage,
    sparklineSamples,
    sharedWindowCompare,
    formatPctChange
  };
`)();

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

const oneDay = api.filterPoints(points, "1d");
if (oneDay.length !== 1 || oneDay[0].t !== points[2].t) {
  throw new Error("filterPoints must keep samples inside the selected time window");
}
if (api.filterPoints(points, "all").length !== 3) {
  throw new Error("filterPoints all must preserve every sample");
}

const validPayload = {
  schema: "inspr.joe.household.history.v1",
  points
};
const parsed = api.validateHistoryPayload(validPayload);
if (parsed.length !== 3) throw new Error("valid history payload rejected");

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

console.log(JSON.stringify({
  ok: true,
  checks: [
    "time-window-filter",
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
    "zero-baseline-honest"
  ]
}, null, 2));
