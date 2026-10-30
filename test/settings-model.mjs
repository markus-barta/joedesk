// Settings under Node: every schema leaf key is shown, today's editability,
// validation, the candidate sent, the edit flow (Edit, Review changes,
// Confirm, Send) and its diff, the change log, and the one writer's guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { SETTINGS_SECTION_IDS, PHONE_SETTINGS_NOTE, fleetSettingsControls } from '../scripts/browser/settings-checks.mjs';

const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}

const M = await import('../public/joe/settings-model.js');
const { validateContract } = await import('../contracts/index.mjs');
const { withNextFleetRevision } = await import('../fleet-config.mjs');
const schema = JSON.parse(readFileSync(new URL('../contracts/fleet-config.schema.json', import.meta.url)));
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const NB = '\u00a0'; // numbers never part from their units

test('Settings browser expectations include Account start in both rendered sections and canonical sub-nav links', async () => {
  const { builders, htmlDocument } = await import('./fixtures/preview-dom.mjs');
  const previous = globalThis.document;
  const doc = htmlDocument('<nav id="setNav"></nav><main id="setMain"></main>');
  doc.documentElement = { dataset: {} };
  globalThis.document = doc;
  try {
    const page = await builders('settings.js', ['buildSkeleton', 'renderFields']);
    const { addTerms } = await import('../public/joe/ui.js');
    addTerms(M.FIELD_TERMS);
    page.buildSkeleton();
    const main = doc.querySelector('#setMain');
    const sections = main.children.filter(node => typeof node !== 'string' && node.matches('.set-sec'));
    assert.deepEqual(sections.map(node => node.id), SETTINGS_SECTION_IDS);
    const links = doc.querySelectorAll('#setNav a');
    assert.deepEqual(links.map(node => node.dataset.sec), SETTINGS_SECTION_IDS);
    assert.deepEqual(links.map(node => node.getAttribute('href')), SETTINGS_SECTION_IDS.map(id => `#settings/${id}`));
    assert.equal(links[1].textContent, 'Account start');

    // Render the real cold/unavailable fleet fields alongside the independent
    // account form. The old page-wide selector counted its four hidden inputs.
    page.renderFields(true);
    assert.deepEqual(main.querySelectorAll('input').map(node => node.id), [
      'accountStartAmount', 'accountStartDate', 'accountStartClear', 'accountStartConfirmed',
    ]);
    // The small Node DOM handles individual selectors; supply native union
    // semantics while running the exact function serialized by the browser gate.
    const root = { querySelectorAll: selector => [...new Set(selector.split(',').flatMap(part => main.querySelectorAll(part.trim())))] };
    const controls = () => Array.from(runInNewContext(`(${fleetSettingsControls.toString()})(root)`, { root }));
    assert.equal(controls().length, 0);
    assert.equal(main.querySelectorAll('[data-value]').some(node => node.textContent === 'Not available'), true);

    // Hidden or disabled fleet controls still fail, across every control type.
    // Excluding only visible inputs would conceal a real outage regression.
    const group = doc.querySelector('#grp-desks');
    for (const html of [
      '<input id="unexpected" hidden disabled>', '<select id="unexpected" hidden disabled></select>',
      '<textarea id="unexpected" hidden disabled></textarea>', '<button id="unexpected" role="switch" hidden disabled></button>',
      '<button id="unexpected" data-bump="1" hidden disabled></button>', '<button id="unexpected" class="tog" hidden disabled></button>',
      '<button id="unexpected" data-wwdel="0" hidden disabled></button>', '<button id="wwAdd" hidden disabled></button>',
    ]) {
      group.insertAdjacentHTML('afterbegin', html);
      assert.equal(controls().length, 1, html);
      group.children[0].remove();
    }
    // A control outside the account section cannot evade the assertion by
    // reusing an account input id, or by being outside the usual fleet rows.
    doc.querySelector('#set-how').insertAdjacentHTML('afterbegin', '<input id="accountStartAmount">');
    assert.equal(controls().length, 1);
  } finally { globalThis.document = previous; }
});

test('phone Settings note exactly describes the independent account and appearance settings', async () => {
  const { htmlDocument } = await import('./fixtures/preview-dom.mjs');
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  assert.equal(doc.querySelector('.set-phone-note').textContent.trim(), PHONE_SETTINGS_NOTE);
});

test('account start row shows the saved EUR amount/date or exact honest unset text with a reason', () => {
  const unset = "Not set: the whole account's 'Since start' stays hidden until you set it.";
  const accountStart = { amountEur: 12.34, date: '2024-02-29' };
  assert.deepEqual(M.accountStartRow({ accountStart, reason: null }), { text: `Account start: €${NB}12,34 on 2024-02-29`, note: '', editable: true });
  for (const reason of ['missing', 'invalid', 'unreadable', 'unset', 'loading', 'refresh_failed']) {
    const row = M.accountStartRow({ accountStart: null, reason });
    assert.equal(row.text, unset);
    assert.equal(row.editable, !['loading', 'refresh_failed'].includes(reason));
    if (reason !== 'unset') assert.ok(row.note);
  }
  assert.match(M.accountStartRow({ accountStart, reason: 'refresh_failed' }).text, /Not set/);
  assert.equal(M.accountStartRow({ accountStart: {}, reason: null }).editable, false);
  assert.deepEqual(M.accountStartDraft(null), { amount: '', date: '', clear: false }, 'no sample defaults');
  assert.deepEqual(M.accountStartDraft(accountStart), { amount: '12.34', date: '2024-02-29', clear: false });
});

test('account start review validates text without rounding, keeps calendar dates and permits a reviewed clear', () => {
  const snapshot = { accountStart: null, reason: 'missing' };
  const draft = { amount: '12,34', date: '2024-02-29', clear: false };
  const review = M.reviewAccountStart(draft, snapshot);
  assert.deepEqual(review.value, { accountStart: { amountEur: 12.34, date: '2024-02-29' } });
  assert.equal(review.base, 'null'); assert.match(review.before, /Not set/);
  assert.equal(review.after, `Account start: €${NB}12,34 on 2024-02-29`);
  for (const amount of ['', '0', '-1', '1.001', '1,001', '1.234,56', '1,234.56', '1e2', 'Infinity', '0x10']) assert.ok(M.reviewAccountStart({ ...draft, amount }, snapshot).error, amount);
  assert.ok(M.reviewAccountStart({ ...draft, date: '2023-02-29' }, snapshot).error);
  const saved = { ...review.value, reason: null };
  assert.match(M.reviewAccountStart(draft, saved).error, /matches the saved/);
  const clear = M.reviewAccountStart({ amount: '', date: '', clear: true }, saved);
  assert.deepEqual(clear.value, { accountStart: null }); assert.match(clear.after, /Not set/);
  for (const reason of ['loading', 'refresh_failed']) assert.match(M.reviewAccountStart(draft, { accountStart: null, reason }).error, /Refresh/);
  assert.equal(M.reviewAccountStart(draft, { accountStart: null, reason: 'invalid' }).error, undefined, 'a corrupt setting can be replaced');
});

test('JOED-155 Low 2: reviewed unset replaces missing or damaged storage with an honest explanation', () => {
  for (const reason of ['missing', 'invalid', 'unreadable']) {
    const review = M.reviewAccountStart({ clear: true }, { accountStart: null, reason });
    assert.equal(review.error, undefined, reason);
    assert.deepEqual(review.value, { accountStart: null });
    assert.equal(review.before, `Replace the ${reason} account start with 'not set'.`);
    assert.match(review.after, /Not set/);
  }
  assert.match(M.reviewAccountStart({ clear: true }, { accountStart: null, reason: 'unset' }).error, /matches the saved/);
});

test('account start rendered form requires confirmation, invalidates edited/stale reviews and keeps failed drafts', async () => {
  const { builders, htmlDocument } = await import('./fixtures/preview-dom.mjs');
  const board = await import('../public/joe/board-settings.js');
  const realDocument = globalThis.document, realFetch = globalThis.fetch;
  const doc = htmlDocument('<nav id="setNav"></nav><main id="setMain"></main>');
  let focused = null, calls = [], stored = { accountStart: null, reason: 'missing' }, fail = false;
  const selectAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = selector => selectAll(selector).map(el => { el.focus = () => { focused = el.id; }; return el; });
  globalThis.document = doc;
  globalThis.fetch = async (_, init) => {
    calls.push(init);
    if (init.method === 'POST') {
      if (fail) return { status: 500, json: async () => ({ ok: false, error: 'fixture store failure' }) };
      stored = { ...JSON.parse(init.body), reason: JSON.parse(init.body).accountStart ? null : 'unset' };
      return { status: 200, json: async () => ({ ok: true, ...stored }) };
    }
    return { status: 200, json: async () => stored };
  };
  const $ = selector => doc.querySelector(selector);
  const event = { preventDefault() {} };
  try {
    await board.refreshBoardSettings();
    const page = await builders('settings.js', ['buildSkeleton', 'renderAccountStart', 'reviewAccountStart', 'saveAccountStart', 'resetAccountReview']);
    page.buildSkeleton(); page.renderAccountStart();
    assert.match($('#accountStartSummary').textContent, /Not set/);
    assert.equal($('#accountStartAmount').getAttribute('placeholder'), null);
    for (const [input, label] of [['accountStartAmount', 'Amount in EUR'], ['accountStartDate', 'Start date']]) {
      assert.match($(`label[for="${input}"]`).textContent, new RegExp(label));
    }
    assert.equal($('#accountStartSummary').getAttribute('aria-live'), 'polite');
    $('#accountStartForm').hidden = false;
    // Low 6: validate each field, describe its own error and focus the first failure.
    for (const [amount, date, invalid] of [
      ['', '', ['Amount', 'Date']], ['0', '2024-02-29', ['Amount']],
      ['1.001', '2024-02-29', ['Amount']], ['12.34', '2023-02-29', ['Date']],
      ['12.34', '', ['Date']],
    ]) {
      $('#accountStartAmount').value = amount; $('#accountStartDate').value = date;
      page.resetAccountReview(); page.reviewAccountStart();
      assert.equal(focused, `accountStart${invalid[0]}`);
      for (const field of ['Amount', 'Date']) {
        const input = $(`#accountStart${field}`), bad = invalid.includes(field);
        assert.equal(input.getAttribute('aria-invalid'), String(bad));
        const errorId = `accountStart${field}Error`;
        assert.equal(input.getAttribute('aria-describedby').split(/\s+/).includes(errorId), true);
        assert.equal(Boolean($(`#${errorId}`).textContent), bad);
      }
    }
    $('#accountStartClear').checked = true; page.resetAccountReview();
    for (const field of ['Amount', 'Date']) {
      assert.equal($(`#accountStart${field}`).getAttribute('aria-invalid'), 'false');
      assert.equal($(`#accountStart${field}Error`).textContent, '');
    }
    $('#accountStartClear').checked = false; page.resetAccountReview();
    $('#accountStartAmount').value = '12,34'; $('#accountStartDate').value = '2024-02-29';
    page.reviewAccountStart();
    assert.equal(focused, 'accountStartConfirmed');
    assert.equal($('#accountStartSave').disabled, true);
    const count = calls.length;
    await page.saveAccountStart(event);
    assert.equal(calls.length, count, 'unchecked review never writes');
    $('#accountStartConfirmed').checked = true;
    $('#accountStartAmount').value = '13.34';
    await page.saveAccountStart(event);
    assert.equal(calls.length, count, 'unannounced control changes never send the prior review');
    assert.match($('#accountStartMessage').textContent, /Review the current/);
    page.reviewAccountStart(); $('#accountStartConfirmed').checked = true;
    await page.saveAccountStart(event);
    assert.equal(calls.at(-1).method, 'POST');
    assert.deepEqual(JSON.parse(calls.at(-1).body), { accountStart: { amountEur: 13.34, date: '2024-02-29' } });
    assert.equal($('#accountStartForm').hidden, true);
    assert.equal(focused, 'accountStartEdit');
    assert.equal($('#accountStartSummary').textContent, `Account start: €${NB}13,34 on 2024-02-29`);
    assert.equal($('#accountStartMessage').textContent, 'Account start saved for this board.');

    $('#accountStartForm').hidden = false;
    $('#accountStartAmount').value = '14.34'; page.reviewAccountStart();
    $('#accountStartConfirmed').checked = true;
    stored = { accountStart: { amountEur: 15.34, date: '2024-02-29' }, reason: null };
    await board.refreshBoardSettings(); page.renderAccountStart();
    assert.equal($('#accountStartSave').disabled, true);
    assert.equal($('#accountStartReviewBox').hidden, true);
    assert.match($('#accountStartMessage').textContent, /saved account start changed/);

    page.reviewAccountStart(); $('#accountStartConfirmed').checked = true; fail = true;
    await page.saveAccountStart(event);
    assert.equal($('#accountStartForm').hidden, false);
    assert.equal($('#accountStartAmount').value, '14.34');
    assert.equal($('#accountStartSave').disabled, true);
    assert.equal(focused, 'accountStartRetry');
    assert.match($('#accountStartMessage').textContent, /fixture store failure.*Refresh before retrying/);
    assert.equal(board.accountStart(), null);
    assert.match($('#accountStartReason').textContent, /could not be refreshed/);
    fail = false; await board.refreshBoardSettings();
    $('#accountStartClear').checked = true; page.resetAccountReview();
    assert.equal($('#accountStartAmount').disabled, true);
    page.reviewAccountStart(); $('#accountStartConfirmed').checked = true;
    await page.saveAccountStart(event);
    assert.deepEqual(JSON.parse(calls.at(-1).body), { accountStart: null });
    assert.equal(board.accountStart(), null);
    for (const reason of ['missing', 'invalid', 'unreadable']) {
      stored = { accountStart: null, reason }; await board.refreshBoardSettings();
      $('#accountStartForm').hidden = false; page.resetAccountReview(); page.reviewAccountStart();
      assert.equal($('#accountStartBefore').textContent, `Before: Replace the ${reason} account start with 'not set'.`);
      $('#accountStartConfirmed').checked = true;
      await page.saveAccountStart(event);
      assert.deepEqual(JSON.parse(calls.at(-1).body), { accountStart: null });
      assert.deepEqual(board.boardSettingsState(), { accountStart: null, reason: 'unset' });
    }
  } finally {
    globalThis.fetch = realFetch;
    if (realDocument === undefined) delete globalThis.document; else globalThis.document = realDocument;
  }
});

test('P6 Saved captions: window and long symbol counts, complete strings for accessible ellipsis', () => {
  assert.equal(M.savedText(M.FIELD['cadence.wakeWindows'], '[]'), '0 wake windows');
  assert.equal(M.savedText(M.FIELD['desks.keep'], 'AAA,BBB,CCC,DDD,EEE'), '7 kept symbols');
  assert.equal(M.savedText(M.FIELD['desks.keep'], ''), 'SXR8, TSLA');
  assert.equal(M.savedText(M.FIELD['amy.routines.close'], 'x'.repeat(80)), 'x'.repeat(80));
});

// The approved design's settings (test-only): version 12, two wake windows.
function design() {
  const c = structuredClone(valid['fleet-config']);
  Object.assign(c, { rev: 'fc-000012', updatedAt: '2026-10-09T18:12:44.000Z' });
  c.quota.codex.reservePct = 15;
  c.cadence.wakeWindows = [
    { id: 'us-session', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:25', until: '22:05', desks: ['j', 'joe', 'joel'] },
    { id: 'eu-morning', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:55', until: '11:30', desks: ['joel'] },
  ];
  c.secretSlots.agenix = ['joe-board-push-token'];
  return c;
}

test('schema keys: Settings shows every leaf key of fleet-config.schema.json, and only those', () => {
  const leaves = M.schemaLeafKeys(schema);
  // Derived from the schema file, never counted by hand: the leaves are exactly
  // the value paths of a valid settings file (an array of objects is listed
  // with its item keys). The spec's "39" adds three rows that have no schema
  // key: Routine health, File the board reads and Last sent.
  const paths = new Set();
  const walk = (v, path) => {
    if (Array.isArray(v)) { paths.add(path); for (const item of v) if (item && typeof item === 'object') for (const k of Object.keys(item)) paths.add(`${path}[].${k}`); return; }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k); return; }
    paths.add(path);
  };
  walk(design(), '');
  assert.deepEqual([...paths].sort(), [...leaves].sort(), 'each leaf names one value of a valid settings file, and every value sits under a leaf');
  assert.deepEqual([...M.SHOWN_KEYS].sort(), [...leaves].sort());
  assert.equal(new Set(M.SHOWN_KEYS).size, M.SHOWN_KEYS.length, 'each key once in page order');
  assert.equal(M.SHOWN_KEYS[0], 'mode', 'Mode comes first');
  // An array's item keys show by their own names after the array's key.
  for (const [key, items] of Object.entries(M.ITEM_KEYS)) for (const item of items) assert.equal(`${key}[].${M.itemName(item)}`, item);
  assert.deepEqual(M.ITEM_KEYS['cadence.wakeWindows'].map(M.itemName), ['id', 'days', 'from', 'until', 'desks']);
  // Every leaf of the served (public) copy is the same set.
  const served = JSON.parse(readFileSync(new URL('../public/joe/fleet-config.schema.json', import.meta.url)));
  assert.deepEqual(M.schemaLeafKeys(served).sort(), [...leaves].sort());
});

test('editability: exactly today’s editable fields; everything else read-only with a reason', () => {
  // The legacy editor's fields with editable !== false (joe.js FLEET_CONFIG).
  const today = ['quota.grok.reservePct', 'quota.codex.reservePct', 'quota.behavior.amber', 'desks.maxBusyDesks', 'desks.stage0.capEur', 'desks.keep',
    'cadence.usOpenArm', 'cadence.wakeWindows', 'cadence.deskWatch', 'cadence.darwin', 'cadence.quotaGovernor', 'amy.routines.morning', 'amy.routines.review', 'amy.routines.close'];
  assert.deepEqual([...M.EDITABLE].sort(), today.sort());
  for (const f of M.FIELDS.filter(x => !M.EDITABLE.includes(x.key))) assert.ok(['fixed', 'entries', 'refs'].includes(f.type), f.key);
  assert.ok(!M.EDITABLE.includes('mode') && !M.EDITABLE.some(k => k.startsWith('tools') || k.startsWith('secretSlots') || k.startsWith('mac')));
  // Spec order of the groups.
  assert.deepEqual(M.GROUPS.map(g => g.id), ['desks', 'quota', 'cadence', 'amy', 'tools', 'secrets', 'mac']);
  // Each field's Learn tip: longer help, where it applies, the exact key.
  for (const f of M.FIELDS) {
    const [name, meaning, key] = M.FIELD_TERMS[`f:${f.key}`];
    assert.equal(name, f.label); assert.match(meaning, /Applies to: .+\.$/); assert.equal(key, f.key);
  }
  for (const k of Object.keys(M.SOURCES)) assert.ok(M.EDITABLE.includes(k), `source row ${k} is an editable setting`);
});

test('validation: today’s messages for every field type', () => {
  const msg = (key, raw) => { try { M.parseField(M.FIELD[key], raw); return null; } catch (e) { return e.message; } };
  assert.equal(M.parseField(M.FIELD['desks.maxBusyDesks'], ' 7 '), 7);
  assert.equal(msg('desks.maxBusyDesks', '4.5'), 'Busy desks at once must be a whole number.');
  assert.equal(msg('desks.maxBusyDesks', '33'), 'Busy desks at once must be from 1 to 32.');
  assert.equal(msg('quota.grok.reservePct', '-1'), 'Grok capacity kept free must be from 0 to 100.');
  assert.equal(M.parseField(M.FIELD['desks.stage0.capEur'], '250,5'), 250.5);
  assert.equal(msg('desks.stage0.capEur', '1000001'), 'Capital cap per desk must be from 0 to 1.000.000 euros.');
  assert.equal(msg('desks.stage0.capEur', 'lots'), 'Capital cap per desk must be a number of euros, for example 250.');
  assert.deepEqual(M.parseField(M.FIELD['desks.keep'], ' DEMO, SPY '), ['DEMO', 'SPY']);
  assert.equal(msg('desks.keep', 'demo'), 'Kept holdings must be unique uppercase symbols separated by commas.');
  assert.equal(msg('desks.keep', 'DEMO,DEMO'), 'Kept holdings must be unique uppercase symbols separated by commas.');
  assert.equal(msg('desks.keep', 'SXR8'), 'SXR8 and TSLA are always kept; list only the other symbols.');
  assert.equal(msg('cadence.usOpenArm', '25:00'), 'Earliest US-open start must use 24-hour time like 15:35.');
  assert.equal(msg('cadence.deskWatch', 'Desk Watch'), 'Desk watcher routine must be a lowercase routine name, for example desk-watch.');
  assert.equal(msg('amy.routines.morning', ''), 'Morning check-in must be 1 to 80 plain characters.');
  assert.equal(msg('amy.routines.morning', 'x'.repeat(81)), 'Morning check-in must be 1 to 80 plain characters.');
  assert.equal(msg('quota.behavior.amber', 'run_normally'), 'When capacity gets low is invalid.');
  const w = [{ id: 'a', days: ['tue', 'mon'], from: '09:00', until: '17:00', desks: ['j'] }];
  assert.deepEqual(M.parseField(M.FIELD['cadence.wakeWindows'], JSON.stringify(w))[0].days, ['mon', 'tue'], 'days in week order');
  assert.equal(msg('cadence.wakeWindows', JSON.stringify([{ ...w[0], days: [] }])), 'Wake window 1 needs at least one day.');
  assert.equal(msg('cadence.wakeWindows', JSON.stringify([{ ...w[0], desks: [] }])), 'Wake window 1 needs at least one desk.');
  assert.equal(msg('cadence.wakeWindows', JSON.stringify([{ ...w[0], id: 'Bad Name' }])), 'Wake window 1 needs a lowercase name, for example us-session.');
  assert.equal(msg('cadence.wakeWindows', JSON.stringify([{ ...w[0], until: '7pm' }])), 'Wake window 1 times must use 24-hour time like 15:25.');
  assert.equal(msg('cadence.wakeWindows', JSON.stringify(Array.from({ length: 33 }, (_, i) => ({ ...w[0], id: `w${i}` })))), 'Use at most 32 wake windows.');
});

test('diff model: Before and After in plain words; the kept floor always shows', () => {
  const s = M.editState(design());
  assert.equal(s.base['desks.keep'], '', 'only the symbols beyond the floor are editable');
  assert.equal(M.display(M.FIELD['desks.keep'], ''), 'SXR8, TSLA');
  assert.equal(M.display(M.FIELD['desks.keep'], 'DEMO'), 'SXR8, TSLA, DEMO');
  assert.equal(M.display(M.FIELD['desks.maxBusyDesks'], '1'), `1${NB}desk`);
  assert.equal(M.display(M.FIELD['desks.maxBusyDesks'], '6'), `6${NB}desks`);
  assert.equal(M.display(M.FIELD['desks.stage0.capEur'], '1250'), `€${NB}1.250`);
  assert.equal(M.display(M.FIELD['quota.codex.reservePct'], '15'), `15${NB}%`);
  assert.equal(M.display(M.FIELD['quota.behavior.amber'], 'park_nonessential'), 'Park nonessential work');
  assert.equal(M.display(M.FIELD['cadence.usOpenArm'], '15:35'), '15:35 Vienna time');
  assert.equal(M.display(M.FIELD['cadence.wakeWindows'], s.base['cadence.wakeWindows']),
    'us-session: Mon, Tue, Wed, Thu, Fri, 15:25 to 22:05, desks J, Joe, Joel; eu-morning: Mon, Tue, Wed, Thu, Fri, 08:55 to 11:30, desks Joel');
  assert.equal(M.display(M.FIELD['cadence.wakeWindows'], '[]'), 'No wake windows');
  assert.equal(M.display(M.FIELD['amy.routines.close'], ' '), '(empty)');
});

test('phone wake windows: one block each, the name and times, then the days and desks', () => {
  const [us, eu] = M.windowsOf(M.editState(design()).base['cadence.wakeWindows']);
  assert.deepEqual(M.windowLines(us), { id: 'us-session', times: '15:25 to 22:05', rest: 'Mon, Tue, Wed, Thu, Fri · desks J, Joe, Joel' });
  assert.deepEqual(M.windowLines(eu), { id: 'eu-morning', times: '08:55 to 11:30', rest: 'Mon, Tue, Wed, Thu, Fri · desks Joel' });
  assert.equal(M.windowLines({ id: 'x', days: ['sat'], from: '09:00', until: '10:00', desks: ['desk-7'] }).rest, 'Sat · desks desk-7', 'an unknown desk keeps its id');
});

test('candidate: changed fields only; paper, version, read-only values and the kept floor are the saved ones', () => {
  const config = design();
  config.desks.keep = ['TSLA', 'SXR8', 'OLD'];
  let s = M.editState(config);
  assert.equal(s.base['desks.keep'], 'OLD');
  s = M.edit(s, 'desks.maxBusyDesks', '6');
  s = M.edit(s, 'desks.keep', 'OLD, DEMO');
  s = M.edit(s, 'quota.behavior.amber', 'park_nonessential');
  const c = M.buildCandidate(s.config, s.base, s.draft);
  assert.equal(c.mode, 'paper'); assert.equal(c.rev, 'fc-000012'); assert.equal(c.updatedAt, config.updatedAt);
  assert.equal(c.desks.maxBusyDesks, 6);
  assert.deepEqual(c.desks.keep, ['TSLA', 'SXR8', 'OLD', 'DEMO'], 'the floor keeps its saved order and is never dropped');
  assert.equal(c.quota.behavior.amber, 'park_nonessential');
  assert.deepEqual(c.tools, config.tools); assert.deepEqual(c.secretSlots, config.secretSlots); assert.deepEqual(c.mac, config.mac);
  assert.ok(validateContract('fleet-config', c).ok, 'the server would accept the candidate');
  assert.ok(validateContract('fleet-config', withNextFleetRevision(c, c.rev)).ok, 'and its next version');
  // An unchanged keep keeps the saved array exactly.
  const plain = M.buildCandidate(config, M.valuesOf(config), M.valuesOf(config));
  assert.deepEqual(plain, config);
  // No input can remove the floor or change the mode.
  const tampered = { ...s.draft, 'desks.keep': '' };
  assert.deepEqual(M.buildCandidate(s.config, s.base, tampered).desks.keep, ['TSLA', 'SXR8']);
  assert.throws(() => M.buildCandidate({ ...config, mode: 'live' }, s.base, s.draft), /not loaded/);
  assert.throws(() => M.buildCandidate(null, s.base, s.draft), /not loaded/);
});

test('edit flow: draft, review (dialog rows), tick and confirm, send; each state’s edit bar', () => {
  let s = M.editState(design());
  assert.deepEqual(M.bar(s), { tone: 'ok', state: 'clean', lead: 'No changes', rest: 'version 12 is current', buttons: { discard: false, save: false, review: false, send: false } });
  s = M.edit(s, 'desks.maxBusyDesks', ' 6');
  s = M.edit(s, 'quota.codex.reservePct', '20');
  let b = M.bar(s);
  assert.equal(b.state, 'dirty'); assert.equal(`${b.lead} · ${b.rest}`, '2 changes in your draft · review before you send');
  assert.deepEqual(b.buttons, { discard: true, save: true, review: true, send: false });
  const r = M.review(s);
  assert.equal(r.error, null);
  assert.deepEqual(r.rows, [
    { key: 'desks.maxBusyDesks', label: 'Busy desks at once', before: `5${NB}desks`, after: `6${NB}desks` },
    { key: 'quota.codex.reservePct', label: 'Codex capacity kept free', before: `15${NB}%`, after: `20${NB}%` },
  ]);
  s = r.s;
  assert.equal(s.draft['desks.maxBusyDesks'], '6', 'review keeps the parsed form');
  assert.equal(M.confirm(s, false), s, 'no tick, no confirmation');
  const edited = M.edit(s, 'amy.routines.close', 'Close recap!');
  assert.equal(M.confirm(edited, true), edited, 'an edit after review needs a new review');
  s = M.confirm(s, true);
  b = M.bar(s);
  assert.equal(`${b.lead} · ${b.rest}`, '2 changes reviewed · ready to send as version 13');
  assert.ok(b.buttons.send && M.canSend(s));
  assert.ok(!M.canSend(M.edit(s, 'desks.maxBusyDesks', '7')), 'any edit withdraws the confirmation');
  s = M.start(s);
  b = M.bar(s);
  assert.equal(b.state, 'writing'); assert.equal(b.lead, 'Writing version 13…'); assert.deepEqual(Object.values(b.buttons), [false, false, false, false]);
  const written = withNextFleetRevision(M.buildCandidate(s.config, s.base, s.draft), 'fc-000012', new Date('2026-10-14T17:42:40.000Z'));
  const ok = M.sendOutcome(200, { ok: true, rev: written.rev, config: written, action: { changedKeys: ['quota.codex.reservePct', 'desks.maxBusyDesks'] } }, M.changes(s));
  assert.deepEqual(ok.keys, ['quota.codex.reservePct', 'desks.maxBusyDesks']);
  s = M.finish(s, ok);
  b = M.bar(s);
  assert.equal(`${b.lead} · ${b.rest}`, 'Sent version 13 · saved to the shared file. The desks’ reload is not confirmed.');
  assert.equal(s.config.rev, 'fc-000013'); assert.ok(!M.isDirty(s));
  // An older read still in flight never replaces the version just written.
  assert.equal(M.adopt(s, design()), s);
  const newer = { ...written };
  assert.equal(M.adopt(s, newer).config, newer);
  // The outcome stays until the next edit.
  assert.equal(M.bar(M.edit(s, 'desks.maxBusyDesks', '8')).state, 'dirty');
});

test('stale version: the conflict reads "revision changed to …; reload before retrying"; the draft stays', () => {
  let s = M.confirm(M.review(M.edit(M.editState(design()), 'desks.maxBusyDesks', '6')).s, true);
  s = M.start(s);
  const out = M.sendOutcome(409, { ok: false, error: 'fleet config revision conflict', currentRev: 'fc-000013', action: { outcome: 'failure' } }, M.changes(s));
  assert.deepEqual(out, { ok: false, keys: ['desks.maxBusyDesks'], reason: 'revision changed to fc-000013; reload before retrying', currentRev: 'fc-000013' });
  s = M.finish(s, out);
  const b = M.bar(s);
  assert.equal(`${b.lead} · ${b.rest}`, 'Not sent · version 12 was not confirmed as written: revision changed to fc-000013; reload before retrying.');
  assert.equal(s.draft['desks.maxBusyDesks'], '6', 'the draft is kept');
  assert.ok(!M.canSend(s), 'a new review is needed');
  assert.deepEqual(b.buttons, { discard: true, save: true, review: true, send: false });
  // A draft in progress keeps its version when a newer one arrives, so its send meets the server's check.
  const pinned = M.adopt(s, { ...design(), rev: 'fc-000013' });
  assert.equal(pinned, s);
  // Discard takes the newest saved settings.
  const fresh = M.discard(s, { ...design(), rev: 'fc-000013' });
  assert.equal(fresh.config.rev, 'fc-000013'); assert.ok(!M.isDirty(fresh)); assert.equal(fresh.outcome, null);
  // Other failures. Only a 409 is a revision conflict.
  assert.equal(M.sendOutcome(422, { ok: false, error: 'schema validation failed', errors: ['/desks/keep: contains'] }, []).reason, '/desks/keep: contains');
  assert.deepEqual(M.sendOutcome(500, { ok: false, error: 'fleet config store failed' }, ['cadence.deskWatch']), { ok: false, keys: ['cadence.deskWatch'], reason: 'fleet config store failed' });
  assert.deepEqual(M.sendOutcome(409, { ok: false, error: 'fleet config revision conflict' }, []), { ok: false, keys: [], reason: 'fleet config revision conflict' });
  assert.deepEqual(M.sendOutcome(422, { ok: false, error: 'schema validation failed', currentRev: 'fc-000013' }, []), { ok: false, keys: [], reason: 'schema validation failed' }, 'a version named by another failure is no conflict');
  assert.equal(M.sendOutcome(0, null, []).reason, 'the board server did not answer');
  assert.equal(M.sendOutcome(302, null, []).reason, 'sign-in expired — reload');
  assert.equal(M.sendOutcome(200, { ok: true }, []).ok, false, 'an answer without the written settings is not a success');
});

test('stored, change log unfinished: a 500 naming the new version is written, never "Not sent", never a clean success', () => {
  let s = M.confirm(M.review(M.edit(M.editState(design()), 'cadence.deskWatch', 'desk-watch-two')).s, true);
  s = M.start(s);
  // The server stored version 13, then could not finish its change-log entry.
  const out = M.sendOutcome(500, { ok: false, error: 'fleet config stored but action log finalization failed', currentRev: 'fc-000013' }, M.changes(s));
  assert.deepEqual(out, { ok: false, stored: true, rev: 'fc-000013', keys: ['cadence.deskWatch'], reason: 'the change log could not record it' });
  s = M.finish(s, out);
  const b = M.bar(s);
  assert.deepEqual({ tone: b.tone, state: b.state, text: `${b.lead} · ${b.rest}` },
    { tone: 'warn', state: 'stored', text: 'Sent version 13 · saved to the shared file, but the change log could not record it. The desks’ reload is not confirmed.' });
  assert.ok(!/Not sent/.test(`${b.lead} ${b.rest}`));
  assert.deepEqual(b.buttons, { discard: false, save: false, review: false, send: false }, 'nothing left to send');
  assert.ok(!M.isDirty(s), 'what was written shows as saved');
  assert.equal(s.base['cadence.deskWatch'], 'desk-watch-two');
  // The written version replaces the view when it is read back; an older read in flight never does.
  assert.equal(M.adopt(s, design()), s);
  const written = { ...design(), rev: 'fc-000013', cadence: { ...design().cadence, deskWatch: 'desk-watch-two' } };
  const read = M.adopt(s, written);
  assert.equal(read.config, written); assert.ok(!M.isDirty(read));
  assert.equal(M.bar(read).state, 'stored', 'the outcome stays until the next edit');
  assert.equal(M.bar(M.edit(read, 'cadence.darwin', 'darwin-two')).state, 'dirty');
});

test('review: an invalid field stops at its message; a draft equal to the saved settings has nothing to review', () => {
  const s = M.edit(M.editState(design()), 'cadence.usOpenArm', '9:30');
  const r = M.review(s);
  assert.equal(r.error, 'Earliest US-open start must use 24-hour time like 15:35.');
  assert.equal(r.s.reviewed, null);
  const same = M.review(M.edit(M.editState(design()), 'desks.maxBusyDesks', ' 5 '));
  assert.equal(same.error, 'Your draft matches the saved settings.');
  assert.ok(!M.isDirty(same.s));
});

test('load states: loading and unavailable disable every button', () => {
  const none = M.editState();
  assert.deepEqual(M.bar(none), { tone: 'none', state: 'loading', lead: 'Loading the fleet settings', rest: 'editing starts once they arrive', buttons: { discard: false, save: false, review: false, send: false } });
  const failed = M.bar(none, { failed: true });
  assert.equal(failed.state, 'unavailable'); assert.equal(failed.rest, 'values are hidden and editing is disabled. Reopen Settings to retry.');
  assert.equal(M.edit(none, 'desks.maxBusyDesks', '6'), none, 'nothing to edit before the settings arrive');
});

test('JOED-117 warm refresh failure: last-good settings keep the draft but cannot be reviewed or sent', () => {
  const config = design();
  for (const [reason, words] of [['refresh_failed', 'refresh failed'], ['auth_required', 'sign-in required'], ['contract_invalid', 'contract invalid']]) {
    let s = M.adopt(M.editState(), config);
    const clean = M.adopt(s, config, reason);
    assert.equal(M.bar(clean).state, 'last-good');
    assert.match(M.bar(clean).lead, /last good/i);
    assert.doesNotMatch(M.bar(clean).rest, /is current/);
    assert.ok(M.bar(clean).rest.includes(words));
    s = M.confirm(M.review(M.edit(s, 'desks.maxBusyDesks', '6')).s, true);
    assert.ok(M.canSend(s));
    const failed = M.adopt(s, config, reason);
    assert.equal(failed.readReason, reason);
    assert.equal(failed.readAvailable, false);
    assert.deepEqual(failed.draft, s.draft);
    assert.equal(failed.config, config);
    assert.equal(M.canSend(failed), false);
    assert.deepEqual(M.bar(failed).buttons, { discard: true, save: true, review: false, send: false });
    assert.equal(M.review(failed).rows.length, 0);
    assert.equal(M.canSend(M.confirm(failed, true)), false);
    const duringWrite = M.adopt(M.start(s), config, reason);
    const finished = M.finish(duringWrite, { ok: true, config, keys: M.changes(s) });
    assert.equal(finished.readAvailable, false, 'a completed write cannot erase a failed refresh');
    assert.equal(M.bar(finished).state, 'last-good');
    const discarded = M.discard(failed, config);
    assert.equal(M.bar(discarded).state, 'last-good', 'discard cannot revalidate the read');
    const recovered = M.adopt(failed, config);
    assert.equal(recovered.readAvailable, true);
    assert.deepEqual(recovered.draft, s.draft);
    assert.equal(M.canSend(recovered), false, 'recovery requires a new review');
    assert.ok(M.canSend(M.confirm(M.review(recovered).s, true)));
  }
});

test('JOED-117 fleet transport: a validated same-revision 304 clears rejection without freshening the receipt', async () => {
  const { createFeed } = await import('../public/joe/feed.js');
  const realFetch = globalThis.fetch;
  const config = design(), tag = `"${config.rev}"`, receipt = valid.data.receivedAt;
  let answer, requestedTag;
  const notifications = [];
  globalThis.fetch = async (_url, init) => { requestedTag = init.headers?.['If-None-Match']; return answer(); };
  try {
    for (const status of [503, 401, 0]) {
      const feed = createFeed(key => notifications.push(key));
      answer = () => new Response(JSON.stringify(config), { headers: { ETag: tag, 'X-Joe-Server-Now': receipt, 'X-Joe-Received-At': receipt } });
      await feed.refreshFleet();
      const saved = feed.feeds['fleet-config'].value;
      answer = () => { if (!status) throw new TypeError('offline'); return new Response('{}', { status }); };
      await feed.refreshFleet();
      assert.equal(feed.feeds['fleet-config'].reason, status === 401 ? 'auth_required' : 'refresh_failed');
      const later = new Date(Date.parse(receipt) + 60000).toISOString();
      answer = () => new Response(null, { status: 304, headers: { ETag: tag, 'X-Joe-Server-Now': later, 'X-Joe-Received-At': later } });
      const before = notifications.length;
      await feed.refreshFleet();
      assert.equal(requestedTag, tag);
      assert.equal(feed.feeds['fleet-config'].reason, null);
      assert.equal(feed.feeds['fleet-config'].value, saved);
      assert.equal(feed.feeds['fleet-config'].receivedAt, receipt);
      assert.equal(feed.select().states['fleet-config'].state, 'stale', 'revalidation does not reset receipt age');
      assert.ok(feed.select().states['fleet-config'].ageSeconds >= 60);
      assert.deepEqual(notifications.slice(before), ['fleet'], 'recovery redraws Settings');
      answer = () => new Response(null, { status: 304, headers: { ETag: '"unrelated"' } });
      await feed.refreshFleet();
      assert.equal(feed.feeds['fleet-config'].reason, 'refresh_failed', 'an unrelated 304 cannot validate the saved value');
      answer = () => new Response(JSON.stringify({ ...config, mode: 'live' }), {
        headers: { ETag: '"invalid"', 'X-Joe-Received-At': later },
      });
      await feed.refreshFleet();
      assert.equal(feed.feeds['fleet-config'].reason, 'contract_invalid');
      answer = () => new Response(null, { status: 304, headers: { ETag: tag } });
      await feed.refreshFleet();
      assert.equal(requestedTag, tag, 'a rejected 200 cannot replace the validated conditional tag');
      assert.equal(feed.feeds['fleet-config'].reason, null);
      assert.equal(feed.feeds['fleet-config'].value, saved);
      assert.equal(feed.feeds['fleet-config'].receivedAt, receipt);
    }
    const cold = createFeed(() => {});
    answer = () => new Response(null, { status: 304, headers: { ETag: tag } });
    await cold.refreshFleet();
    assert.equal(cold.feeds['fleet-config'].value, null);
    assert.equal(cold.feeds['fleet-config'].reason, 'refresh_failed');
  } finally { globalThis.fetch = realFetch; }
});

test('JOED-117 send outcomes precede the last-good note, with review and send blocked throughout the outage', () => {
  const config = design();
  const reviewed = M.confirm(M.review(M.edit(M.editState(config), 'desks.maxBusyDesks', '6')).s, true);
  const written = withNextFleetRevision(M.buildCandidate(config, reviewed.base, reviewed.draft), config.rev);
  for (const result of [
    { ok: false, reason: 'fleet config unavailable', keys: M.changes(reviewed) },
    { ok: true, config: written, keys: M.changes(reviewed) },
    { ok: false, stored: true, rev: written.rev, reason: 'the change log could not record it', keys: M.changes(reviewed) },
  ]) {
    const expected = M.bar(M.finish(M.start(reviewed), result));
    for (const reason of ['refresh_failed', 'auth_required', 'contract_invalid']) {
      // A read can fail either during the write or after its answer arrives.
      for (const duringWrite of [true, false]) {
        const s = duringWrite
          ? M.finish(M.adopt(M.start(reviewed), config, reason), result)
          : M.adopt(M.finish(M.start(reviewed), result), config, reason);
        const b = M.bar(s);
        assert.equal(b.state, 'last-good');
        assert.equal(b.lead, expected.lead);
        assert.equal(b.rest, `${expected.rest} Fleet settings unavailable · showing last good.`);
        assert.equal(b.tone, result.ok || result.stored ? 'warn' : 'bad');
        assert.deepEqual(b.buttons, { discard: !result.ok && !result.stored, save: !result.ok && !result.stored, review: false, send: false });
        assert.equal(M.canSend(s), false);
        const recovered = M.bar(M.adopt(s, result.ok ? written : config));
        assert.equal(recovered.state, expected.state);
        assert.equal(recovered.rest, expected.rest);
      }
    }
  }
});

test('JOED-117 fleet transport: healthy matching 304s preserve the feed object and emit no redraw', async () => {
  const { createFeed } = await import('../public/joe/feed.js');
  const realFetch = globalThis.fetch;
  const config = design(), tag = `"${config.rev}"`, receipt = valid.data.receivedAt;
  const notifications = [];
  const feed = createFeed(key => notifications.push(key));
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(config), { headers: { ETag: tag, 'X-Joe-Server-Now': receipt, 'X-Joe-Received-At': receipt } });
    await feed.refreshFleet();
    const saved = feed.feeds['fleet-config'];
    assert.equal(saved.reason, null);
    notifications.length = 0;
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers['If-None-Match'], tag);
      return new Response(null, { status: 304, headers: { ETag: tag } });
    };
    for (let poll = 0; poll < 3; poll++) {
      await feed.refreshFleet();
      assert.equal(feed.feeds['fleet-config'], saved);
      assert.equal(feed.feeds['fleet-config'].receivedAt, receipt);
    }
    assert.deepEqual(notifications, []);
  } finally { globalThis.fetch = realFetch; }
});

test('JOED-117 rendered Settings: a failed warm read labels last-good values and disables send until revalidated', async () => {
  const { builders, htmlDocument } = await import('./fixtures/preview-dom.mjs');
  const realDocument = globalThis.document;
  const doc = htmlDocument('<nav id="setNav"></nav><main id="setMain"></main><p id="setSub"></p><div id="editbar"><p id="editNote"></p><button id="discardBtn"></button><button id="savePreview"></button><button id="reviewBtn"></button><button id="sendBtn"></button></div><dialog id="diffDlg" open><input id="diffReviewed" type="checkbox"></dialog><div id="toast"></div>');
  // Only the DOM operations used by the real render/update path; no browser.
  const decorated = new WeakSet();
  const decorate = el => {
    if (!el || decorated.has(el)) return el;
    decorated.add(el);
    el.disabled = el.getAttribute('disabled') !== null;
    el.removeAttribute = key => { delete el.attributes[key]; };
    if (el.tagName === 'dialog') el.close = () => el.removeAttribute('open');
    return el;
  };
  const selectAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = selector => selectAll(selector).map(decorate);
  doc.getElementById = id => doc.querySelector(`#${id}`);
  doc.documentElement = { dataset: {} };
  doc.body = { dataset: {} }; // Section scrolling is outside this render test.
  globalThis.document = doc;
  let page;
  try {
    page = await builders('settings.js', ['buildSkeleton', 'update', 'confirmReview']);
    const { addTerms } = await import('../public/joe/ui.js');
    addTerms(M.FIELD_TERMS);
    page.buildSkeleton();
    const config = design();
    config.desks.stage0.capEur = 1.001;
    const ctx = { feeds: { 'fleet-config': { value: config, reason: null } }, states: {}, now: valid.data.receivedAt };
    page.renderSettings(ctx);
    assert.match(doc.querySelector('#editNote').textContent, /version 12 is current/);
    assert.equal(doc.querySelector('[data-row="desks.stage0.capEur"] .phone-only').textContent, `€${NB}1,001`);
    let draft = M.edit(M.editState(config), 'desks.stage0.capEur', '1.002');
    draft = M.confirm(M.review(draft).s, true);
    page.update(draft);
    assert.equal(doc.querySelector('#sendBtn').disabled, false);
    ctx.feeds['fleet-config'].reason = 'refresh_failed';
    page.renderSettings(ctx);
    assert.equal(doc.querySelector('#editNote').dataset.state, 'last-good');
    assert.match(doc.querySelector('#editNote').textContent, /showing last good.*refresh failed/);
    assert.match(doc.querySelector('#setSub').textContent, /unavailable · last good version 12/);
    assert.match(doc.querySelector('#srcFacts').textContent, /Last good version/);
    assert.equal(doc.querySelector('[data-saved="desks.stage0.capEur"]').textContent, `Last good: €${NB}1,001`);
    assert.equal(page.settingsState().draft['desks.stage0.capEur'], '1.002');
    assert.equal(doc.querySelector('#sendBtn').disabled, true);
    assert.equal(doc.querySelector('#reviewBtn').disabled, true);
    doc.querySelector('#diffReviewed').checked = true;
    const beforeConfirm = page.settingsState();
    page.confirmReview();
    assert.deepEqual(page.settingsState(), beforeConfirm, 'outage confirmation keeps the draft unconfirmed');
    assert.equal(doc.querySelector('#diffDlg').getAttribute('open'), null, 'close the invalidated review so the toast is visible above its former backdrop');
    assert.equal(doc.querySelector('#toast').textContent, 'The current fleet settings could not be checked. Reopen Settings to retry; your draft is kept.');
    assert.ok(doc.querySelector('#toast').classList.contains('on'));
    ctx.feeds['fleet-config'].reason = null;
    page.renderSettings(ctx);
    assert.equal(doc.querySelector('#editNote').dataset.state, 'dirty');
    assert.equal(doc.querySelector('#reviewBtn').disabled, false);
    assert.equal(doc.querySelector('#sendBtn').disabled, true, 'a new review is still required');
    assert.equal(doc.querySelector('[data-saved="desks.stage0.capEur"]').textContent, `Saved: €${NB}1,001`);
  } finally {
    clearTimeout(page?.toast.timer);
    if (realDocument === undefined) delete globalThis.document; else globalThis.document = realDocument;
  }
});

test('JOED-117 cap review and saved displays preserve every normalized accepted digit', () => {
  const field = M.FIELD['desks.stage0.capEur'];
  for (const [before, after, expectedBefore, expectedAfter] of [
    [1.001, '1.0020', '1,001', '1,002'],
    [1000.0000000000001, '1000.0000000000002', '1.000,0000000000001', '1.000,0000000000002'],
    [0.0000001, '0.0000002', '0,0000001', '0,0000002'],
    [0, '0.' + '0'.repeat(323) + '5', '0', '0,' + '0'.repeat(323) + '5'],
  ]) {
    const config = design();
    config.desks.stage0.capEur = before;
    const r = M.review(M.edit(M.editState(config), field.key, after));
    assert.equal(r.error, null);
    assert.equal(r.rows[0].before, `€${NB}${expectedBefore}`);
    assert.equal(r.rows[0].after, `€${NB}${expectedAfter}`);
    assert.notEqual(r.rows[0].before, r.rows[0].after);
    assert.equal(M.savedText(field, String(before)), r.rows[0].before);
    assert.equal(M.display(field, r.s.draft[field.key]), r.rows[0].after, 'phone and review use the same complete value');
    const candidate = M.buildCandidate(config, r.s.base, r.s.draft);
    assert.ok(validateContract('fleet-config', candidate).ok);
    assert.equal(candidate.desks.stage0.capEur, Number(after));
  }
});

test('browser draft: restored only for the same version, and only whole and well shaped; a malformed draft is dropped', () => {
  let s = M.editState(design());
  s = M.edit(s, 'desks.maxBusyDesks', '7');
  const text = M.previewPayload(s);
  assert.deepEqual(JSON.parse(text), { baseRev: 'fc-000012', values: s.draft });
  const fresh = M.editState(design());
  const back = M.readPreview(text, fresh);
  assert.equal(back.dropped, false); assert.equal(back.s.draft['desks.maxBusyDesks'], '7');
  const other = M.readPreview(text, M.editState({ ...design(), rev: 'fc-000013' }));
  assert.equal(other.dropped, false, 'another version’s draft is left alone');
  assert.equal(other.s.draft['desks.maxBusyDesks'], '5', 'and not applied');
  assert.deepEqual(M.readPreview(null, fresh), { s: fresh, dropped: false }, 'no draft');
  // An in-progress value of the right shape comes back; Review changes judges it.
  const typing = M.readPreview(JSON.stringify({ baseRev: 'fc-000012', values: { 'cadence.usOpenArm': '9:3', 'cadence.wakeWindows': JSON.stringify([{ id: 'Late Night', days: [], from: '9', until: '', desks: ['j'] }]) } }), fresh);
  assert.equal(typing.dropped, false); assert.equal(typing.s.draft['cadence.usOpenArm'], '9:3');
  assert.equal(M.review(typing.s).error, 'Earliest US-open start must use 24-hour time like 15:35.');
  // Malformed: dropped whole, the saved settings stay.
  const windows = raw => JSON.stringify({ baseRev: 'fc-000012', values: { 'desks.maxBusyDesks': '7', 'cadence.wakeWindows': raw } });
  const w = { id: 'a', days: ['mon'], from: '09:00', until: '17:00', desks: ['j'] };
  const malformed = {
    'not JSON': '{bad',
    'no values': JSON.stringify({ baseRev: 'fc-000012' }),
    'values a list': JSON.stringify({ baseRev: 'fc-000012', values: ['7'] }),
    'no version': JSON.stringify({ values: { 'desks.maxBusyDesks': '7' } }),
    'wake windows null': windows('null'),
    'wake windows an object': windows('{"id":"a"}'),
    'wake windows unreadable': windows('[{'),
    'a window null': windows('[null]'),
    'a window without desks': windows(JSON.stringify([{ ...w, desks: undefined }])),
    'a window with another key': windows(JSON.stringify([{ ...w, extra: 1 }])),
    'a window name not text': windows(JSON.stringify([{ ...w, id: 7 }])),
    'a day not a day': windows(JSON.stringify([{ ...w, days: ['mon', 'someday'] }])),
    'desks not a list': windows(JSON.stringify([{ ...w, desks: 'j' }])),
    'too many windows': windows(JSON.stringify(Array.from({ length: 33 }, () => w))),
    'a number, not text': JSON.stringify({ baseRev: 'fc-000012', values: { 'desks.maxBusyDesks': 7 } }),
    'a control character': JSON.stringify({ baseRev: 'fc-000012', values: { 'desks.maxBusyDesks': '\u0007' } }),
    'the switch off its two values': JSON.stringify({ baseRev: 'fc-000012', values: { 'quota.behavior.amber': 'run_normally' } }),
    'a key that is not editable': JSON.stringify({ baseRev: 'fc-000012', values: { 'desks.maxBusyDesks': '7', mode: 'live' } }),
    'too long': JSON.stringify({ baseRev: 'fc-000012', values: { 'amy.routines.close': 'x'.repeat(1201) } }),
  };
  for (const [why, raw] of Object.entries(malformed)) assert.deepEqual(M.readPreview(raw, fresh), { s: fresh, dropped: true }, why);
  // The shape the page draws: a list of windows, or nothing.
  assert.deepEqual(M.windowsOf(JSON.stringify([w])), [w]);
  assert.equal(M.windowsOf('null'), null);
  assert.equal(M.windowsOf(undefined), null);
});

test('change log: newest first; outcomes in plain words; malformed logs are refused', () => {
  const entries = [
    { id: 'fa-1-aaaaaaaa', at: '2026-10-09T18:12:44.000Z', actor: 'markus', revBefore: 'fc-000011', revAfter: 'fc-000012', changedKeys: ['desks.maxBusyDesks', 'desks.stage0.capEur'], outcome: 'success', reason: 'propagated' },
    { id: 'fa-2-bbbbbbbb', at: '2026-10-09T18:20:00.000Z', actor: 'markus', revBefore: 'fc-000012', revAfter: 'fc-000012', changedKeys: ['desks.keep'], outcome: 'failure', reason: 'revision_conflict' },
    { id: 'fa-3-cccccccc', at: '2026-10-09T18:21:00.000Z', actor: 'markus', revBefore: 'fc-000012', revAfter: 'fc-000013', changedKeys: ['tools.[read-only]', 'secretSlots.[redacted]'], outcome: 'pending', reason: 'write_started' },
  ];
  const log = M.acceptActions({ schema: 'inspr.joe.fleet-config.actions.v1', entries });
  assert.deepEqual(log.map(e => e.id), ['fa-3-cccccccc', 'fa-2-bbbbbbbb', 'fa-1-aaaaaaaa']);
  assert.deepEqual(M.actionView(entries[0]), { tone: 'ok', word: 'Sent', versions: { from: 11, to: 12 }, actor: 'markus', keys: ['desks.maxBusyDesks', 'desks.stage0.capEur'], what: null });
  // Every audit name the server can log is accepted.
  const names = JSON.parse(readFileSync(new URL('../public/joe/fleet-config-actions.schema.json', import.meta.url))).$defs.action.properties.changedKeys.items.enum;
  assert.ok(M.acceptActions({ schema: 'inspr.joe.fleet-config.actions.v1', entries: [{ ...entries[0], changedKeys: names }] }), 'all audit names');
  assert.deepEqual(M.actionView(entries[1]), { tone: 'bad', word: 'Not sent', versions: { from: 12, to: null, note: 'not changed' }, actor: 'markus', keys: ['desks.keep'], what: 'the version had changed' });
  assert.equal(M.actionView(entries[2]).versions.note, 'not confirmed');
  assert.equal(M.acceptActions({ schema: 'other', entries }), null);
  assert.equal(M.acceptActions({ schema: 'inspr.joe.fleet-config.actions.v1', entries: [{ ...entries[0], actor: 'x y' }] }), null);
  assert.equal(M.acceptActions({ schema: 'inspr.joe.fleet-config.actions.v1', entries: Array.from({ length: 201 }, () => entries[0]) }), null);
});

test('writer: a non-paper draft, or one not based on the version it names, is refused before any request', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { type: 'basic', status: 200, json: async () => ({ ok: true }) }; };
  try {
    const { sendFleetDraft } = await import('../public/joe/fleet-write.js');
    const c = design();
    await assert.rejects(sendFleetDraft('fc-000012', { ...c, mode: 'live' }), /refused/);
    await assert.rejects(sendFleetDraft('fc-000011', c), /refused/);
    await assert.rejects(sendFleetDraft('fc-000012', null), /refused/);
    assert.equal(calls.length, 0, 'no request for any refused draft');
    const answer = await sendFleetDraft('fc-000012', c);
    assert.deepEqual(answer, { status: 200, body: { ok: true } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, './fleet-config/propagate');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { baseRev: 'fc-000012', config: c });
  } finally { globalThis.fetch = realFetch; }
});


test('JOED-158 p6: Saved-description refusal evaluates all whitespace-separated ID tokens', () => {
  const source = readFileSync(new URL('../scripts/browser-p6.mjs', import.meta.url), 'utf8');
  // Select the actual evaluated assertion, including its template escaping.
  const expression = source.split('discarding clears Saved descriptions')[1]?.match(/page\.evaluate\(`([^`]+)`\)/)?.[1];
  assert.ok(expression);
  const evaluated = runInNewContext('`' + expression + '`');
  for (const value of ['f-saved\tother', 'other\nf-saved', 'other\r\nf-saved', 'f-saved  other']) {
    const document = { querySelectorAll: selector => selector.includes('[aria-describedby]')
      ? [{ getAttribute: () => value }] : [{ hidden: true }] };
    assert.equal(runInNewContext(evaluated, { document }), false, JSON.stringify(value));
  }
  assert.equal(runInNewContext(evaluated, { document: { querySelectorAll: () => [] } }), true);
});
