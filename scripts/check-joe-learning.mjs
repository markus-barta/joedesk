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

const learningHelpers = `${extractJoeBlock("  var stateCopy = {", "\n  var money = new Intl.NumberFormat")}
  var lastObservedSnapshot = null;
  var observedEventsMemory = null;
  var number = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 4 });
${extractJoeBlock("  function hasCapturedJResults(desk)", "\n\n  function snapshotProblems")}
${extractJoeBlock("  function nonEmptyString(value)", "\n\n  function deskTrackFields(desk)")}
${extractJoeBlock("  function deskTrackFields(desk)", "\n\n  function deskTrackFieldsEqual(left, right)")}
${extractJoeBlock("  function deskTrackFieldsEqual(left, right)", "\n\n  function readObservedEvents()")}
${extractJoeBlock("  function readObservedEvents()", "\n\n  function diffDeskToEvents(previousFields, desk, snapshotAt, sourceLabel)")}
${extractJoeBlock("  function diffDeskToEvents(previousFields, desk, snapshotAt, sourceLabel)", "\n\n  function snapshotInstantMs(generatedAt)")}
${extractJoeBlock("  function snapshotInstantMs(generatedAt)", "\n\n  function observeSnapshotChanges(data)")}
${extractJoeBlock("  function observeSnapshotChanges(data)", "\n\n  function deskObservedEvents(deskId)")}`;

const api = new Function(`${learningHelpers}
  return {
    formatDeskLearningCopy,
    deskTrackFields,
    diffDeskToEvents,
    learningStatusLabel,
    observeSnapshotChanges,
    readObservedEvents,
    resetObservation: function () {
      lastObservedSnapshot = null;
      observedEventsMemory = null;
    },
    lastObservedSnapshot: function () { return lastObservedSnapshot; }
  };
`)();

const sampleDesk = {
  id: "joe",
  label: "Joe",
  state: "sit-out",
  action: "The setup is not clean enough, so Joe is sitting out.",
  learning: {
    status: "learning",
    headline: "Recording why the trade was skipped",
    detail: "The next review checks whether the same warning appears again.",
    iteration: 7
  },
  issues: []
};

const copy = api.formatDeskLearningCopy(sampleDesk);
if (!copy.whatHappened.includes("setup is not clean")) {
  throw new Error("what happened must come from action");
}
if (!copy.whatNext.includes("Recording why") || !copy.whatNext.includes("Pass 7")) {
  throw new Error("what next must use supplied learning fields");
}
if (copy.statusLabel !== "Learning") {
  throw new Error("learning status must map to readable label");
}

const emptyDesk = {
  id: "j",
  label: "J",
  state: "working",
  action: "   ",
  learning: { status: "steady", headline: "", detail: "", iteration: null },
  issues: []
};
const emptyCopy = api.formatDeskLearningCopy(emptyDesk);
if (emptyCopy.whatHappened !== "Not supplied" || emptyCopy.whatNext !== "Not supplied") {
  throw new Error("empty supplied fields must stay honest");
}

const stuckDesk = {
  id: "joel",
  label: "Joel",
  state: "stuck",
  action: "Broker feed stopped updating.",
  learning: { status: "blocked", headline: "Paused", detail: "Waiting for feed", iteration: 2 },
  issues: ["Gateway timeout", "No quotes"]
};
const stuckCopy = api.formatDeskLearningCopy(stuckDesk);
if (!stuckCopy.whatHappened.includes("Gateway timeout")) {
  throw new Error("stuck issues must appear in what happened");
}

const capturedJCopy = api.formatDeskLearningCopy({
  ...stuckDesk,
  id: "j",
  label: "J",
  action: "BACKFILL_REQUIRED at midnight",
  issues: ["raw accounting diagnostic"],
  backfill: { capturedSubtotal: { realizedPnl: -12.5, currency: "USD", executionCount: 7 } },
});
if (!/Captured partial J history is available/.test(capturedJCopy.whatHappened) ||
    /BACKFILL_REQUIRED|raw accounting diagnostic/.test(capturedJCopy.whatHappened)) {
  throw new Error("captured J learning copy must keep raw accounting diagnostics out of the primary card copy");
}

const completeCapturedJCopy = api.formatDeskLearningCopy({
  ...stuckDesk,
  id: "j",
  label: "J",
  money: { equity: 5004, dayPnl: null, totalPnl: 4, openPnl: 0 },
  backfill: { capturedSubtotal: { realizedPnl: -12.5, currency: "USD", executionCount: 7, points: [{ at: "2026-09-10T10:00:00Z", realizedPnl: -12.5 }] } },
});
if (!/Complete J accounting is available/.test(completeCapturedJCopy.whatHappened) ||
    /complete J equity remains unavailable|Broker feed stopped|Gateway timeout/.test(completeCapturedJCopy.whatHappened)) {
  throw new Error("complete J money must not be described as unavailable merely because captured history remains present");
}

const previous = api.deskTrackFields(sampleDesk);
const changedAction = {
  ...sampleDesk,
  action: "Joe is still sitting out; no new setup yet."
};
const actionEvents = api.diffDeskToEvents(previous, changedAction, "2026-09-09T10:00:00+02:00", "book.json");
if (actionEvents.length !== 1 || actionEvents[0].kind !== "action") {
  throw new Error("action change must emit one observed action event");
}
if (!actionEvents[0].summary.includes("still sitting out")) {
  throw new Error("action event must carry supplied action text");
}

const replayEvents = api.diffDeskToEvents(previous, sampleDesk, "2026-09-09T10:00:00+02:00", "book.json");
if (replayEvents.length !== 0) {
  throw new Error("identical desk fields must not create fake events");
}

const stateChange = {
  ...sampleDesk,
  state: "working",
  action: "A cleaner setup appeared; Joe is watching it."
};
const stateEvents = api.diffDeskToEvents(previous, stateChange, "2026-09-09T10:05:00+02:00", "book.json");
if (stateEvents.length !== 1 || stateEvents[0].kind !== "state") {
  throw new Error("state change must emit one observed state event");
}

const learningChange = {
  ...sampleDesk,
  learning: {
    status: "iterating",
    headline: "Trying a smaller first size",
    detail: "Pass 8 compares half-size entry.",
    iteration: 8
  }
};
const learningEvents = api.diffDeskToEvents(previous, learningChange, "2026-09-09T10:10:00+02:00", "book.json");
if (learningEvents.length !== 1 || learningEvents[0].kind !== "learning") {
  throw new Error("learning-only change must emit one learning event");
}
if (learningEvents[0].summary.includes("€") || learningEvents[0].summary.toLowerCase().includes("trade p")) {
  throw new Error("learning events must not invent trade or euro P&L");
}

function snapshotDesk(action, generatedAt) {
  return {
    generatedAt,
    source: { label: "book.json" },
    desks: [{
      id: "joe",
      label: "Joe",
      state: "sit-out",
      action,
      learning: {
        status: "learning",
        headline: "Recording why the trade was skipped",
        detail: "The next review checks whether the same warning appears again.",
        iteration: 7
      },
      issues: []
    }]
  };
}

api.resetObservation();
api.observeSnapshotChanges(snapshotDesk("Baseline action.", "2026-09-09T10:00:00+02:00"));
if (api.readObservedEvents().events.length !== 0) {
  throw new Error("first snapshot must be baseline-only");
}

api.observeSnapshotChanges(snapshotDesk("Newer action after baseline.", "2026-09-09T10:05:00+02:00"));
const newerEvents = api.readObservedEvents().events.filter((event) => event.deskId === "joe");
if (newerEvents.length !== 1 || newerEvents[0].kind !== "action") {
  throw new Error("newer changed action must create one observed event");
}
if (!newerEvents[0].summary.includes("Newer action after baseline")) {
  throw new Error("newer event must carry the accepted action text");
}

const baselineBeforeOlder = api.lastObservedSnapshot().desks.joe.action;
api.observeSnapshotChanges(snapshotDesk("Older different action must be ignored.", "2026-09-09T09:55:00+02:00"));
if (api.readObservedEvents().events.length !== 1) {
  throw new Error("older different action must not append timeline events");
}
if (api.lastObservedSnapshot().desks.joe.action !== baselineBeforeOlder) {
  throw new Error("older different action must not change the accepted baseline");
}

api.observeSnapshotChanges(snapshotDesk("Same instant different offset must be ignored.", "2026-09-09T08:05:00Z"));
if (api.readObservedEvents().events.length !== 1) {
  throw new Error("same instant with different timezone must not append timeline events");
}
if (api.lastObservedSnapshot().desks.joe.action !== baselineBeforeOlder) {
  throw new Error("same instant replay must not change the accepted baseline");
}

api.observeSnapshotChanges(snapshotDesk("Next newer legitimate transition.", "2026-09-09T10:10:00+02:00"));
const timelineEvents = api.readObservedEvents().events.filter((event) => event.deskId === "joe");
if (timelineEvents.length !== 2 || timelineEvents[1].kind !== "action") {
  throw new Error("next newer action must produce exactly one legitimate transition");
}
if (!timelineEvents[1].summary.includes("Next newer legitimate transition")) {
  throw new Error("legitimate newer transition must compare against the last accepted baseline");
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    "learning-copy-from-supplied-fields",
    "honest-empty-learning",
    "stuck-issues-in-what-happened",
    "captured-j-primary-copy-hides-raw-diagnostic",
    "complete-j-with-captured-history-keeps-complete-copy",
    "observed-action-diff",
    "no-fake-replay-events",
    "observed-state-diff",
    "observed-learning-diff",
    "baseline-only-first-snapshot",
    "newer-action-one-event",
    "older-different-action-ignored",
    "same-instant-timezone-ignored",
    "next-newer-legitimate-transition"
  ]
}, null, 2));
