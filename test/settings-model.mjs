// Settings under Node: every schema leaf key is shown, today's editability,
// validation, the candidate sent, the edit flow (Edit, Review changes,
// Confirm, Send) and its diff, the change log, and the one writer's guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';

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
