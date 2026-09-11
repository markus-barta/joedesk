#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const cssSource = await readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8");
const htmlSource = await readFile(resolve(repoRoot, "public/joe/index.html"), "utf8");
const sample = JSON.parse(await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"));

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const trustHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
  var accountingDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "America/New_York" });
  var shortTime = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
  var money = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
  var moneyFormatters = { EUR: money };
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function amount(value, signed)", "\n\n  function moneyForCurrency")}
${extractJoeBlock("  function moneyForCurrency(currencyCode)", "\n\n  function positionMarketValue(position)")}
${extractJoeBlock("  function el(tag, className, text)", "\n\n  function endpoint")}
${extractJoeBlock("  function ageInSeconds(iso)", "\n\n  function openPnl(data)")}
${extractJoeBlock("  function openPnl(data)", "\n\n  function nonEmptyString(value)")}
${extractJoeBlock("  // HOSTD-33 / Wave D: Day P&L stays unavailable", "\n\n  function labelPaperCapital()")}
${extractJoeBlock("  function deskFreshnessFooter(desk, snapshotAge", "\n\n  function updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale)")}
${extractJoeBlock("  function collectPositions(data)", "\n\n  function deskPositionsCoverage(deskId, data)")}
${extractJoeBlock("  function deskPositionsCoverage(deskId, data)", "\n\n  function positionsAvailability(data)")}
${extractJoeBlock("  function positionsAvailability(data)", "\n\n  function positionsSummaryText(data)")}
${extractJoeBlock("  function positionsEmptyMessage(data, filterDesk)", "\n\n  function renderPositions(data)")}`;

const createdTags = [];
function fakeNode(tag) {
  return {
    tag,
    className: "",
    attributes: {},
    children: [],
    textContent: "",
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") this.className = String(value);
    },
  };
}
const fakeDocument = {
  createElement(tag) {
    createdTags.push(tag);
    return fakeNode(tag);
  },
  createElementNS(_namespace, tag) {
    createdTags.push(tag);
    return fakeNode(tag);
  },
};

function descendants(node) {
  return [node, ...(node.children || []).flatMap(descendants)];
}

const api = new Function("document", `${trustHelpers}
  return {
    validate,
    validateAccounting,
    accountingPeriodLabel,
    accountingSinceLabel,
    renderAccountingBasis,
    amount,
    dayPnlDisplayValue,
    deskPositionsCoverage,
    positionsAvailability,
    positionsEmptyMessage,
    deskFreshnessFooter,
    snapshotProblems,
    brokerAccountPresentation,
    backfillPresentation,
    capturedHistorySeries,
    renderBackfill,
    gatewayHeartbeatAge,
    validIsoTimestamp,
    collectPositions,
    ageInSeconds,
    ageLabel,
    openPnl
  };
`)(fakeDocument);

const validated = api.validate(structuredClone(sample));
const syntheticBackfill = {
  status: "BEST_AVAILABLE",
  fullTotalAvailable: false,
  capturedSubtotal: {
    realizedPnl: -37.125,
    currency: "USD",
    executionCount: 43,
    commissionCount: 42,
    fromInclusive: "2026-09-10T08:00:00.000Z",
    throughInclusive: "2026-09-10T08:05:00.000Z",
  },
  coverage: {
    target: { fromInclusive: "2026-09-10T08:00:00.000Z", toExclusive: "2026-09-10T08:20:00.000Z" },
    completeIntervalCount: 0,
    knownIntervalCount: 1,
    gapCount: 1,
    firstGap: { fromInclusive: "2026-09-10T08:05:00.000Z", toExclusive: "2026-09-10T08:20:00.000Z" },
  },
  missingOpeningLotCount: 1,
  orphanCommissionCount: 1,
};
const partialJBackfill = structuredClone(sample);
partialJBackfill.desks[0].backfill = syntheticBackfill;
partialJBackfill.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
partialJBackfill.totals = { equity: null, dayPnl: null, totalPnl: null };
const validatedBackfill = api.validate(partialJBackfill);
const backfillCopy = api.backfillPresentation(validatedBackfill.desks[0].backfill);
if (
  backfillCopy.title !== "Captured results (partial)" ||
  !/^USD /.test(backfillCopy.subtotal) ||
  !/43 fills/.test(backfillCopy.subtotal) ||
  !/known interval/.test(backfillCopy.interval) ||
  !/Full J total unavailable/.test(backfillCopy.coverage) ||
  !/Coverage gap/.test(backfillCopy.coverage) ||
  !/Historical EUR FX is not evidenced/.test(backfillCopy.fx) ||
  backfillCopy.method !== null
) {
  throw new Error("legacy partial USD backfill must render truth without implicitly claiming FIFO");
}
const backfillNode = api.renderBackfill(validatedBackfill.desks[0].backfill);
if (backfillNode.children[0].textContent !== "Captured results (partial)" || createdTags.includes("script")) {
  throw new Error("backfill must render bounded literal UI content");
}
const unavailableHistory = descendants(backfillNode).find((node) => node.className === "desk-backfill-history-empty");
if (unavailableHistory?.textContent !== "Captured J history is unavailable.") {
  throw new Error("legacy backfill without points must explicitly mark its curve unavailable");
}

const curvedBackfill = structuredClone(partialJBackfill);
curvedBackfill.desks[0].backfill.capturedSubtotal.method = "captured-fifo-matched-roundtrips";
curvedBackfill.desks[0].backfill.capturedSubtotal.points = [
  { at: "2026-09-10T08:00:20.000Z", realizedPnl: -4.5 },
  { at: "2026-09-10T08:01:20.000Z", realizedPnl: 8.25 },
  { at: "2026-09-10T08:04:20.000Z", realizedPnl: 8.25 },
  { at: "2026-09-10T08:05:00.000Z", realizedPnl: -37.125 },
];
curvedBackfill.desks[0].backfill.capturedSubtotal.pointsTruncated = true;
const validatedCurve = api.validate(curvedBackfill).desks[0].backfill;
const curve = api.capturedHistorySeries(validatedCurve);
if (!curve.available || curve.points.length !== 4 || !curve.path ||
    !(curve.points[1].x - curve.points[0].x < curve.points[2].x - curve.points[1].x) ||
    curve.points[1].y !== curve.points[2].y || curve.points[0].realizedPnl !== -4.5) {
  throw new Error("captured curve must scale nonuniform actual times and negative-positive-flat native values");
}
const curveNode = api.renderBackfill(validatedCurve);
const curveNodes = descendants(curveNode);
const curveSummary = curveNodes.find((node) => node.className === "desk-backfill-history-summary");
const curveSvg = curveNodes.find((node) => node.tag === "svg");
const curvePath = curveNodes.find((node) => node.className === "desk-backfill-path");
if (curveSummary?.textContent !== "Captured J history · USD · partial" ||
    curveSvg?.attributes.role !== "img" || curveSvg?.attributes["aria-label"] !== curveSummary.textContent ||
    !curvePath?.attributes.d || !curveNodes.some((node) => node.textContent === "J-family FIFO, net of fees") ||
    !curveNodes.some((node) => /latest captured points/.test(node.textContent))) {
  throw new Error("captured curve must be accessible, separately titled, visible, and honest about truncation");
}

const stuckCapturedJ = structuredClone(curvedBackfill);
stuckCapturedJ.desks[0].state = "stuck";
stuckCapturedJ.desks[0].action = "BACKFILL_REQUIRED at 00:00:00";
stuckCapturedJ.desks[0].issues = ["raw internal accounting detail"];
const capturedProblems = api.snapshotProblems(api.validate(stuckCapturedJ), 0);
if (!capturedProblems.some((problem) => /captured partial results are available/i.test(problem)) ||
    capturedProblems.some((problem) => /BACKFILL_REQUIRED|raw internal accounting detail/.test(problem))) {
  throw new Error("captured J alarm copy must be useful while raw accounting diagnostics stay out of the banner");
}

const completeCapturedJ = structuredClone(stuckCapturedJ);
completeCapturedJ.desks[0].money = { equity: 5012.5, dayPnl: null, totalPnl: 12.5, openPnl: 0 };
completeCapturedJ.totals = { equity: 15012.5, dayPnl: null, totalPnl: 12.5, openPnl: 0 };
const completeCapturedProblems = api.snapshotProblems(api.validate(completeCapturedJ), 0);
if (completeCapturedProblems.some((problem) => /complete equity is unavailable|Coverage gaps remain/.test(problem))) {
  throw new Error("restored complete J money must not produce the partial-accounting gap banner");
}
if (!completeCapturedProblems.some((problem) => /complete accounting is available/.test(problem)) ||
    completeCapturedProblems.some((problem) => /BACKFILL_REQUIRED|raw internal accounting detail/.test(problem))) {
  throw new Error("a still-stuck complete J must keep raw diagnostics behind details without hiding restored accounting");
}

const unrelatedMethod = structuredClone(syntheticBackfill);
unrelatedMethod.capturedSubtotal.method = "account-average-cost-realized";
if (api.backfillPresentation(unrelatedMethod).method !== null) {
  throw new Error("an unrelated account-realized method must never be presented as J-family FIFO");
}

const singletonBackfill = structuredClone(partialJBackfill);
singletonBackfill.desks[0].backfill.capturedSubtotal.points = [
  { at: "2026-09-10T08:03:00.000Z", realizedPnl: -37.125 },
];
singletonBackfill.desks[0].backfill.capturedSubtotal.pointsTruncated = false;
const singleton = api.validate(singletonBackfill).desks[0].backfill;
const singletonSeries = api.capturedHistorySeries(singleton);
const singletonNodes = descendants(api.renderBackfill(singleton));
if (singletonSeries.points.length !== 1 || singletonSeries.path !== "" ||
    !singletonNodes.some((node) => node.tag === "circle") ||
    !singletonNodes.some((node) => /^Actual point /.test(node.textContent))) {
  throw new Error("singleton captured history must render only its actual point and label");
}
const eurBackfill = structuredClone(partialJBackfill);
eurBackfill.desks[0].backfill.capturedSubtotal.currency = "EUR";
eurBackfill.desks[0].backfill.capturedSubtotal.realizedPnl = 18.625;
const eurCopy = api.backfillPresentation(api.validate(eurBackfill).desks[0].backfill);
if (!/^EUR /.test(eurCopy.subtotal) || eurCopy.fx !== null) {
  throw new Error("EUR backfill must stay in EUR without a missing-FX warning");
}
const eurCurve = structuredClone(curvedBackfill);
eurCurve.desks[0].backfill.capturedSubtotal.currency = "EUR";
const eurCurveNodes = descendants(api.renderBackfill(api.validate(eurCurve).desks[0].backfill));
if (!eurCurveNodes.some((node) => node.textContent === "Captured J history · EUR · partial")) {
  throw new Error("captured history title must use its native EUR currency");
}
const updatedBackfill = structuredClone(validatedBackfill.desks[0].backfill);
updatedBackfill.capturedSubtotal.executionCount = 45;
if (!/45 fills/.test(api.backfillPresentation(updatedBackfill).subtotal)) {
  throw new Error("updated familyHistory summary must have a live presentation path");
}
for (const mutate of [
  function (snapshot) { snapshot.desks[0].backfill.status = "PARTIAL"; },
  function (snapshot) { snapshot.desks[0].backfill.capturedSubtotal.currency = "GBP"; },
  function (snapshot) { snapshot.desks[0].backfill.capturedSubtotal.method = "account-average-cost-realized"; },
  function (snapshot) { snapshot.desks[0].backfill.coverage.gapCount = 0; },
  function (snapshot) { snapshot.desks[0].backfill.receipts = []; },
  function (snapshot) { snapshot.desks[1].backfill = snapshot.desks[0].backfill; delete snapshot.desks[0].backfill; },
]) {
  const malformed = structuredClone(partialJBackfill);
  mutate(malformed);
  let rejected = false;
  try { api.validate(malformed); } catch (_) { rejected = true; }
  if (!rejected) { throw new Error("client validator accepted malformed or misplaced J backfill"); }
}
for (const mutate of [
  function (captured) { delete captured.pointsTruncated; },
  function (captured) { captured.points[1].at = captured.points[0].at; },
  function (captured) { captured.points[0].at = "2026-09-10T07:59:00.000Z"; },
  function (captured) { captured.points[0].realizedPnl = Number.NaN; },
  function (captured) { captured.points[captured.points.length - 1].realizedPnl = -37; },
  function (captured) { captured.points[0].execId = "private"; },
  function (captured) { captured.points[0].currency = "USD"; },
]) {
  const malformed = structuredClone(curvedBackfill);
  mutate(malformed.desks[0].backfill.capturedSubtotal);
  let rejected = false;
  try { api.validate(malformed); } catch (_) { rejected = true; }
  if (!rejected) { throw new Error("client validator accepted malformed captured history points"); }
}
const olderPayload = structuredClone(sample);
delete olderPayload.brokerAccount;
const olderValidated = api.validate(olderPayload);
if (api.brokerAccountPresentation(olderValidated).state !== "legacy") {
  throw new Error("older payload without brokerAccount must remain compatible");
}

const freshAccount = structuredClone(sample);
freshAccount.generatedAt = new Date().toISOString();
freshAccount.brokerAccount.observedAt = freshAccount.generatedAt;
const freshAccountValidated = api.validate(freshAccount);
const freshAccountView = api.brokerAccountPresentation(freshAccountValidated);
if (
  freshAccountView.value !== sample.brokerAccount.equity ||
  freshAccountView.state !== "available" ||
  !/including KEEP/i.test(freshAccountView.meta) ||
  !/not virtual desk capital/.test(freshAccountView.meta)
) {
  throw new Error("valid broker account equity must be useful and explicitly include KEEP");
}

const incompleteJAccount = structuredClone(freshAccount);
incompleteJAccount.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
incompleteJAccount.totals = { equity: null, dayPnl: null, totalPnl: null };
const incompleteJValidated = api.validate(incompleteJAccount);
if (api.brokerAccountPresentation(incompleteJValidated).value !== sample.brokerAccount.equity) {
  throw new Error("incomplete J accounting must not blank valid broker account equity");
}

const retainedAccount = structuredClone(freshAccount);
retainedAccount.brokerAccount.status = "unavailable";
const retainedView = api.brokerAccountPresentation(api.validate(retainedAccount));
if (retainedView.value !== sample.brokerAccount.equity || retainedView.state !== "unavailable" || !/last observed/.test(retainedView.meta)) {
  throw new Error("last-good broker equity must display with honest unavailable treatment");
}

const staleAccount = structuredClone(freshAccount);
staleAccount.brokerAccount.observedAt = new Date(Date.now() - 3600_000).toISOString();
const staleView = api.brokerAccountPresentation(api.validate(staleAccount));
if (staleView.state !== "stale" || !/stale/.test(staleView.meta) || !staleView.problem) {
  throw new Error("old broker observation must receive explicit stale treatment");
}

const missingAccountEquity = structuredClone(freshAccount);
missingAccountEquity.brokerAccount.status = "unavailable";
missingAccountEquity.brokerAccount.equity = null;
const missingAccountView = api.brokerAccountPresentation(api.validate(missingAccountEquity));
if (missingAccountView.value !== null || missingAccountView.state !== "unavailable") {
  throw new Error("unavailable broker equity must remain an explicit unknown");
}

const partialOpenPnl = structuredClone(incompleteJAccount);
partialOpenPnl.positions = [{ desk: "joel", symbol: "DEMO", openPnl: 9 }];
if (api.openPnl(api.validate(partialOpenPnl)) !== null) {
  throw new Error("partial position P&L must not fabricate a household total");
}

for (const [field, value] of [
  ["equity", null],
  ["currency", "USD"],
  ["observedAt", "2026-09-08"],
  ["scope", "virtual-desks"],
  ["status", "stale"],
]) {
  const malformed = structuredClone(freshAccount);
  malformed.brokerAccount[field] = value;
  let rejected = false;
  try { api.validate(malformed); } catch (_) { rejected = true; }
  if (!rejected) { throw new Error("client validator accepted invalid brokerAccount." + field); }
}
if (api.dayPnlDisplayValue(validated, validated.totals.dayPnl) !== null) {
  throw new Error("day P&L must stay unavailable until producer contract lands");
}
if (api.positionsAvailability(validated) !== "absent") {
  throw new Error("sample without positions keys must be absent");
}
if (api.accountingSinceLabel(validated.desks[0]) !== "Since start") {
  throw new Error("legacy desk must retain Since start label");
}

const accountingSnapshot = structuredClone(sample);
accountingSnapshot.desks[0].accounting = {
  periodStart: "2026-09-10T04:00:00Z",
  method: "execution-fifo-net-current-fx",
  detail: "<img src=x onerror=globalThis.accountingInjected=true>",
};
const accountingValidated = api.validate(accountingSnapshot);
if (api.accountingSinceLabel(accountingValidated.desks[0]) !== "Since 10 Sep") {
  throw new Error("accounting period label must derive Sep 10 in New York from periodStart");
}
const basisNode = api.renderAccountingBasis(accountingValidated.desks[0]);
if (
  basisNode.children[0].textContent !== "J + J2–J5 · verified from 10 Sep" ||
  basisNode.children[1].textContent !== accountingSnapshot.desks[0].accounting.detail ||
  createdTags.includes("img") || createdTags.includes("script") || globalThis.accountingInjected
) {
  throw new Error("accounting detail must render as literal text without markup execution");
}

const malformedAccounting = structuredClone(accountingSnapshot);
malformedAccounting.desks[0].accounting.periodStart = "2026-09-10";
let malformedAccountingRejected = false;
try {
  api.validate(malformedAccounting);
} catch {
  malformedAccountingRejected = true;
}
if (!malformedAccountingRejected) {
  throw new Error("client validator must reject invalid accounting periodStart");
}

const unavailableJ = structuredClone(accountingSnapshot);
unavailableJ.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
delete unavailableJ.desks[0].positions;
unavailableJ.totals = { equity: null, dayPnl: null, totalPnl: null };
const unavailableJValidated = api.validate(unavailableJ);
if (
  api.amount(unavailableJValidated.desks[0].money.equity, false) !== "—" ||
  api.deskPositionsCoverage("j", unavailableJValidated) !== "absent"
) {
  throw new Error("unavailable J must render unknown money and unavailable positions, not zero or known-empty");
}

const nullTop = api.validate(Object.assign(structuredClone(sample), { positions: null }));
if (api.positionsAvailability(nullTop) !== "partial") {
  throw new Error("positions:null must be partial, not empty");
}

const malformedTop = api.validate(Object.assign(structuredClone(sample), { positions: "bad" }));
if (api.positionsAvailability(malformedTop) !== "partial") {
  throw new Error("non-array positions must be partial");
}

const oneDeskEmpty = structuredClone(sample);
oneDeskEmpty.desks[0].positions = [];
const oneDeskEmptyValidated = api.validate(oneDeskEmpty);
if (api.positionsAvailability(oneDeskEmptyValidated) !== "partial") {
  throw new Error("one empty desk with others absent must be partial");
}
if (api.deskPositionsCoverage("j", oneDeskEmptyValidated) !== "empty") {
  throw new Error("desk j with positions:[] must be known empty");
}
if (api.deskPositionsCoverage("joe", oneDeskEmptyValidated) !== "absent") {
  throw new Error("desk joe without positions key must stay absent in partial coverage");
}

const allDeskEmpty = structuredClone(sample);
allDeskEmpty.desks.forEach((desk) => { desk.positions = []; });
const allDeskEmptyValidated = api.validate(allDeskEmpty);
if (api.positionsAvailability(allDeskEmptyValidated) !== "empty") {
  throw new Error("complete per-desk empty coverage must be empty");
}

const topLevelEmpty = api.validate(Object.assign(structuredClone(sample), { positions: [] }));
if (api.positionsAvailability(topLevelEmpty) !== "empty") {
  throw new Error("top-level positions:[] without desk keys must be complete empty");
}

const presentPositions = structuredClone(sample);
presentPositions.positions = [
  { desk: "j", symbol: "DEMO", side: "Long", quantity: 1, mark: 10, marketValue: 10, dayPnl: null, openPnl: 1, updatedAt: sample.generatedAt },
];
const presentValidated = api.validate(presentPositions);
if (api.positionsAvailability(presentValidated) !== "partial") {
  throw new Error("single-desk top-level rows must be partial coverage");
}
if (api.deskPositionsCoverage("j", presentValidated) !== "present") {
  throw new Error("desk j must be present when row supplied");
}
if (api.deskPositionsCoverage("joe", presentValidated) !== "absent") {
  throw new Error("desk joe must remain absent under partial top-level coverage");
}

const partialMessage = api.positionsEmptyMessage(presentValidated, "all");
if (!/partial/i.test(partialMessage)) {
  throw new Error("partial coverage must not claim a full-account flat state");
}

const deskOnlyMessage = api.positionsEmptyMessage(oneDeskEmptyValidated, "joe");
if (!/not available for this desk/i.test(deskOnlyMessage)) {
  throw new Error("filtered absent desk must not inherit another desk's empty state");
}

const desk = validated.desks[0];
const updatedAtOnly = api.deskFreshnessFooter(
  Object.assign({}, desk, { updatedAt: new Date().toISOString(), heartbeatAt: null }),
  30,
  false,
  false,
  300
);
if (/Heartbeat/.test(updatedAtOnly.text)) {
  throw new Error("updatedAt must not be relabeled as heartbeat");
}
if (!/Snapshot/.test(updatedAtOnly.text)) {
  throw new Error("without heartbeatAt the footer must use snapshot age");
}

const heartbeatDesk = api.deskFreshnessFooter(
  Object.assign({}, desk, { heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  30,
  false,
  false,
  300
);
if (!/Heartbeat/.test(heartbeatDesk.text)) {
  throw new Error("heartbeatAt must label the desk footer as heartbeat");
}

const gatewaySeen = api.gatewayHeartbeatAge(validated);
if (!Number.isFinite(gatewaySeen)) {
  throw new Error("valid gateway.lastSeenAt must produce an age");
}
const badGateway = structuredClone(validated);
badGateway.safety.gateway.lastSeenAt = "not-a-date";
if (api.gatewayHeartbeatAge(badGateway) !== null) {
  throw new Error("invalid gateway.lastSeenAt must be unknown");
}

const staleProblems = api.snapshotProblems(validated, validated.safety.staleAfterSeconds + 5);
if (!staleProblems.some((problem) => /stale/i.test(problem))) {
  throw new Error("snapshotProblems must flag stale age without a successful fetch");
}
const halted = structuredClone(validated);
halted.safety.halt = true;
halted.safety.haltReason = "Operator check";
const haltProblems = api.snapshotProblems(halted, 1);
if (!haltProblems.some((problem) => /HALT/.test(problem))) {
  throw new Error("snapshotProblems must retain HALT even when snapshot age is fresh");
}

if (/attributionNote\.textContent\s*=\s*"Day P&L is not available yet; attribution/.test(joeSource)) {
  throw new Error("labelPaperCapital must not duplicate attribution unavailable copy");
}
const attributionBodyHtml = htmlSource.match(/attribution-body[\s\S]*?<div id="attribution"/);
if (attributionBodyHtml && /<p class="widget-note">/.test(attributionBodyHtml[0])) {
  throw new Error("attribution tile must not keep a static note above the dynamic body");
}
if (/\+ "snapshot " \+ ageLabel\(snapshotAge\)/.test(joeSource)) {
  throw new Error("hero freshness value must not repeat snapshot in the value cell");
}
if (!/table\.positions-table-empty\s*\{[^}]*min-width:\s*0/.test(cssSource)) {
  throw new Error("positions empty table must drop the wide min-width");
}
if (!/table\.positions-table-empty thead\s*\{[^}]*display:\s*none/.test(cssSource)) {
  throw new Error("empty positions table must hide column headers that force horizontal scroll");
}
if (!/syncPositionsTableLayout/.test(joeSource) || !/positions-table-empty/.test(joeSource)) {
  throw new Error("renderPositions must toggle the empty positions table layout");
}
const virtualEquityAt = htmlSource.indexOf("Virtual desk equity");
const brokerNavAt = htmlSource.indexOf("IB paper account NAV");
if (virtualEquityAt < 0 || brokerNavAt < 0 || virtualEquityAt > brokerNavAt || !/id="brokerEquity"/.test(htmlSource) || !/including KEEP/.test(htmlSource)) {
  throw new Error("hero must lead with virtual desk equity and keep whole-account IB NAV secondary");
}
if (!/Virtual starting capital/.test(htmlSource) || !/J accounting incomplete · desk total unavailable/.test(joeSource) || !/not virtual desk capital/.test(joeSource)) {
  throw new Error("hero must separate starting capital, virtual desk equity, and whole-account NAV scope");
}
if (!/\.desk-backfill-history\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/.test(cssSource) ||
    !/\.desk-backfill-chart\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/.test(cssSource)) {
  throw new Error("captured history disclosure and SVG must remain bounded on mobile");
}
if (!/\.history-captured\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/.test(cssSource) ||
    !/id="historyCaptured"/.test(htmlSource) || !/Native /.test(joeSource)) {
  throw new Error("main History must provide a bounded, explicitly native-currency J panel");
}

console.log(JSON.stringify({
  ok: true,
  checks: 62,
  positionsPartial: api.positionsAvailability(oneDeskEmptyValidated),
  dayPnl: api.dayPnlDisplayValue(validated, 0),
}, null, 2));
