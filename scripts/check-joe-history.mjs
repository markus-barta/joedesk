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
    historyRangeSpanMs,
    validateHistoryPayload,
    applyHistoryFetchResult,
    historyFailureMessage,
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
    "empty-current-one-point-honest"
  ]
}, null, 2));
