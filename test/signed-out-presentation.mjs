import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';

const U = await import('../public/joe/ui.js');
const D = await import('../public/joe/desk.js');
const A = await import('../public/joe/account.js');
const H = await import('../public/joe/health.js');
const S = await import('../public/joe/settings-model.js');
const R = await import('../public/joe/results.js');
const { boardStates } = await import('../public/joe/board-state.js');
const { toColumns } = await import('../public/joe/history-model.js');
const { indexResults } = await import('../public/joe/results-model.js');
const { statusLine } = await builders('history.js', ['statusLine']);
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
if (!globalThis.document) globalThis.document = { documentElement: { dataset: {} } };
let runtimeHtml, sourceHtml, logHtml;
try { ({ runtimeHtml, sourceHtml, logHtml } = await builders('settings.js', ['runtimeHtml', 'sourceHtml', 'logHtml'])); }
finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
const { deskCard } = await builders('desk.js', ['deskCard']);
const { dayContent, heroSentence, renderStatus } = await builders('results.js', ['dayContent', 'heroSentence', 'renderStatus']);
const fixture = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const start = { amountEur: 100000, date: '2026-01-01' };
const snapshotURL = new URL('./fixtures/presentation-non-auth.json', import.meta.url);
const failureReasons = Object.keys(H.CELL_REASON).filter(reason => reason !== 'auth_required');

function context() {
  const feeds = Object.fromEntries(['data', 'history', 'results', 'fleet-config'].map(name => [name, { value: structuredClone(fixture[name]), reason: null }]));
  feeds.history.value.columns = toColumns(feeds.history.value.points);
  feeds.results.value.index = indexResults(feeds.results.value);
  const now = new Date(Date.parse(fixture.data.receivedAt) + 75000).toISOString();
  return { feeds, now, states: boardStates(feeds, now), actions: { entries: [], reason: null } };
}
function inject(ctx, reason, { signedOut = true, missing = false } = {}) {
  if (signedOut) ctx.states.session = 'signed-out';
  for (const cell of Object.values(ctx.states)) {
    if (!cell || typeof cell !== 'object') continue;
    Object.assign(cell, { state: 'broken', reason, retained: !missing, ageSeconds: 125, signedOut });
    if (missing) cell.value = null;
  }
  for (const name of ['positions', 'kept']) for (const row of ctx.states[name]?.value ?? []) {
    row.mark = null;
    row.reasons = { ...row.reasons, mark: reason };
  }
  ctx.actions = { entries: missing ? null : [], reason };
  return ctx;
}
// Exercise the actual render builders, including accessible names, titles,
// compact rows, chart status, and the header/phone status adapter. These are
// the seams used by the page renderers; no hand-written substitute renderer.
function surfaces(ctx) {
  const cell = ctx.states.paperAccount, view = R.resultsView(ctx), health = H.statusPresentation(ctx);
  const settings = S.accountStartRow({ accountStart: null, reason: 'auth_required' }, ctx);
  const parts = A.subParts(ctx, start, { reason: null });
  const day = view.today;
  return {
    'Desk hero': D.heroLeft(ctx),
    'Desk cards': ['j', 'joe', 'joel'].map(id => deskCard(ctx, id)).join(''),
    'Desk compact rows': ['j', 'joe', 'joel'].map(id => D.compactDesk(ctx, id)).join(''),
    Positions: D.positionsHtml(ctx).html,
    'Kept holdings': D.keptHtml(ctx),
    'Whole account': A.valueHtml(cell),
    'Account state': JSON.stringify(A.stateLine(cell)),
    'Account subline': Object.values(parts).join(''),
    Cash: A.cashPart(ctx.states.paperCash),
    'Settings Cash': U.cashCaption(ctx.states.paperCash, 'test'),
    'Settings Cash figure': U.cashCaption(ctx.states.paperCash, 'test', { figure: true }),
    'Settings runtime': runtimeHtml(ctx),
    'Settings source': sourceHtml(ctx),
    'Settings log': logHtml(ctx),
    'Settings account start': JSON.stringify(settings),
    History: statusLine(ctx.states.history),
    'Results sentence': heroSentence(view, { phrase: 'today' }, { empty: true }, 0),
    'Results day': JSON.stringify(dayContent(view, day, ['j', 'joe', 'joel'])),
    'Results state': JSON.stringify(D.disclosureProblem([['Results', D.resultsFeedProblem(view)]])),
    'Results chart status': resultsStatus(view),
    'Header and phone bar': D.headerHealth(ctx, health).html,
    'Board status': JSON.stringify(health),
  };
}
function resultsStatus(view) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = htmlDocument('<div id="resStatus"></div>');
  globalThis.document = doc;
  try { renderStatus(view); return doc.querySelector('#resStatus').innerHTML; }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
}
function nonAuthSnapshot() {
  const result = {};
  for (const reason of failureReasons) for (const missing of [false, true]) {
    const ctx = inject(context(), reason, { signedOut: false, missing });
    const output = surfaces(ctx);
    // Auth settings are tested separately; status JSON includes diagnostic
    // objects rather than rendered text and is still snapshotted byte-for-byte.
    delete output['Settings account start'];
    for (const [name, html] of Object.entries(output)) (result[name] ??= []).push([reason, missing, html]);
  }
  return Object.fromEntries(Object.entries(result).map(([name, samples]) => [name, createHash('sha256').update(JSON.stringify(samples)).digest('hex')]));
}

if (process.argv.includes('--capture-non-auth')) {
  process.stdout.write(`${JSON.stringify(nonAuthSnapshot(), null, 2)}\n`);
} else {
  test('JOED-173 fix2 snapshot: every non-auth reason keeps exact existing renderer output', () => {
    assert.deepEqual(nonAuthSnapshot(), JSON.parse(readFileSync(snapshotURL)), 'frozen at fa6db1d; compare actual markup, accessible names and status text');
  });

}
