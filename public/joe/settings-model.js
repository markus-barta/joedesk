// Settings: the fleet settings' fields, their validation, the draft and its
// diff, and the edit flow's states (Edit, Review changes, Confirm, Send).
// Pure functions over plain data; settings.js draws them, fleet-write.js is
// the only place a reviewed draft leaves the browser. Paper is fixed: no
// function here can produce anything but mode "paper".
import { digits, NB } from './format.js';

export const PREVIEW_KEY = 'joe-fleet-config-preview-v1';
// The two kept holdings the settings format requires; never removable.
export const KEEP_FLOOR = Object.freeze(['SXR8', 'TSLA']);
export const MAX_WINDOWS = 32;
const ROUTINE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const PRINTABLE = /^[\x20-\x7e]+$/;
export const DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const DAY_NAME = Object.freeze({ mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' });
export const DESK_IDS = Object.freeze(['j', 'joe', 'joel']);
export const DESK_NAME = Object.freeze({ j: 'J', joe: 'Joe', joel: 'Joel' });
export const POLICY = Object.freeze({ run_normally: 'Run normally', slow_nonessential: 'Slow down nonessential work', park_nonessential: 'Park nonessential work' });

// Every group in the spec's order, with today's labels, help and editability
// (spec §8.3, approved r3 words). [key, label, help, longer help, applies to, type, extra]
export const GROUPS = Object.freeze([
  { id: 'desks', icon: 'sliders', nav: 'Desk limits', title: 'Desk limits', purpose: 'How much the paper desks may use, and what they must leave alone.', fields: [
    ['desks.maxBusyDesks', 'Busy desks at once', 'How many learning desks may work at the same time.', 'A whole number from 1 to 32. Limits how many learning desks may be busy together.', 'Paper learning-desk fleet', 'int', { min: 1, max: 32, unit: 'desks' }],
    ['desks.stage0.capEur', 'Capital cap per desk', 'The most a first-stage desk may use at a time.', 'In euros, from 0 to 1.000.000. A capital ceiling for first-stage paper work, not a daily loss limit.', 'First-stage paper desks', 'num', { min: 0, max: 1000000 }],
    ['desks.keep', 'Kept holdings', 'Symbols no desk may ever trade.', 'SXR8 and TSLA always stay on the list. Other uppercase symbols are added with commas, for example DEMO,SPY. Kept holdings show on Desk and stay out of every result.', 'Holdings named in this list', 'symbols']] },
  { id: 'quota', icon: 'gauge', nav: 'AI capacity', title: 'AI capacity', purpose: 'Keep some Grok and Codex capacity free for essential work.', fields: [
    ['quota.grok.reservePct', 'Grok capacity kept free', 'Share of Grok capacity saved for essential work.', 'From 0 to 100 %. 10 % means 10 of every 100 units stay free for watching and recovery.', 'Grok usage policy', 'pct', { min: 0, max: 100 }],
    ['quota.codex.reservePct', 'Codex capacity kept free', 'Share of Codex capacity saved for essential work.', 'From 0 to 100 %. 15 % means 15 of every 100 units stay free for watching and recovery.', 'Codex usage policy', 'pct', { min: 0, max: 100 }],
    ['quota.behavior.green', 'When capacity is plentiful', 'Work runs normally.', 'Fixed by the settings format: plenty of capacity always means normal work.', 'Fleet usage policy', 'fixed', { dot: 'ok', policy: true }],
    ['quota.behavior.amber', 'When capacity gets low', 'Slow down, or park, nonessential work.', 'Choose whether nonessential work slows down or stops (parks) when capacity runs low.', 'Fleet usage policy', 'switch', { dot: 'warn', on: 'park_nonessential', off: 'slow_nonessential', text: 'Park nonessential work instead of slowing it' }],
    ['quota.behavior.red', 'When capacity is too low', 'Nonessential work parks.', 'Fixed by the settings format: too little capacity always parks nonessential work.', 'Fleet usage policy', 'fixed', { dot: 'bad', policy: true }]] },
  { id: 'cadence', icon: 'alarm', nav: 'Wake times', title: 'Wake times', purpose: 'When the desks and their routines may run, in Vienna time.', fields: [
    ['cadence.timeZone', 'Time zone', 'Every time on this page is Vienna time.', 'Fixed by the settings format, including daylight-saving changes.', 'All schedules', 'fixed', {}],
    ['cadence.usOpenArm', 'Earliest US-open start', 'When the US-open routine may begin, Vienna time.', '24-hour time, for example 15:35. Settings say when a routine may run; they do not show whether it ran.', 'US-open paper routine', 'time'],
    ['cadence.wakeWindows', 'When desks may wake', 'Days, times and desks for each wake window.', 'An empty list does not prove the desks are asleep; their scheduler may be set elsewhere.', 'Named paper desks, Vienna time', 'windows'],
    ['cadence.deskWatch', 'Desk watcher routine', 'The name of the routine that checks the desks.', 'Lowercase routine name. This names the routine; it is not how often it runs.', 'Desk monitoring', 'routine'],
    ['cadence.darwin', 'Learning review routine', 'The name of the routine that reviews what desks learned.', 'Lowercase routine name; not a repeat interval.', 'Learning review', 'routine'],
    ['cadence.quotaGovernor', 'Capacity check routine', 'The name of the routine that applies the AI capacity rules.', 'Lowercase routine name; not a timer.', 'Capacity governor', 'routine']] },
  { id: 'amy', icon: 'chat', nav: 'Amy’s check-ins', title: 'Amy’s check-ins', purpose: 'Names for Amy’s morning, review and close check-ins.', fields: [
    ['amy.routines.morning', 'Morning check-in', 'Today’s limits and the work that matters.', 'A label up to 80 characters. It does not set a run time.', 'Amy’s morning routine', 'text'],
    ['amy.routines.review', 'Desk review', 'What each desk learned, and any guardrail that needs care.', 'A label up to 80 characters. It does not set a run time.', 'Amy’s review routine', 'text'],
    ['amy.routines.close', 'Close of day', 'The useful result, without a noisy activity feed.', 'A label up to 80 characters. It does not set a run time.', 'Amy’s close routine', 'text']] },
  { id: 'tools', icon: 'link', nav: 'Connections', title: 'Connections', purpose: 'Which connections the fleet expects. Read-only.', fields: [
    ['tools.statusSource', 'Where health comes from', 'The board reads current health here.', 'Fixed by the settings format. A connection listed below may still be down; see Runtime state.', 'This board', 'fixed', {}],
    ['tools.entries', 'Expected connections', 'Name and label of each expected connection.', 'Declared names only; host connection settings and credentials stay in their host workflow.', 'Declared connections', 'entries']] },
  { id: 'secrets', icon: 'key', nav: 'Secret references', title: 'Secret references', purpose: 'Names of locked secrets. Their values never reach JoeDesk.', fields: [
    ['secretSlots.agenix', 'Host secret store', 'Locked secrets on the host.', 'Reference names only. Rotation and injection stay in the host secret workflow.', 'Host secret store, read-only', 'refs'],
    ['secretSlots.janus', 'Handed-out secrets', 'Locked secrets handed out by the secrets service.', 'Reference names only. Their values never enter this screen.', 'Secrets service, read-only', 'refs']] },
  { id: 'mac', icon: 'folder', nav: 'Old Mac paths', title: 'Old Mac paths', purpose: 'Historical locations, kept visible so nobody edits a mirror.', fields: [
    ['mac.shared.configPath', 'Old settings mirror', 'A former copy of the settings file.', 'JoeDesk never reads it; the live file is shown under Where this is defined.', 'Mac-side mirror', 'fixed', { why: 'Read-only · not used' }],
    ['mac.shared.docsPath', 'Old documentation folder', 'A former documentation location.', 'Kept for reference; it does not control the board.', 'Mac-side documentation', 'fixed', { why: 'Read-only · not used' }],
    ['mac.knobs.syncMode', 'How readers reload', 'Readers reload when the version changes.', 'Fixed by the settings format: Amy and the desks reread the file only when its version changes.', 'Amy and desk processes', 'fixed', {}]] },
].map(g => Object.freeze({ ...g, fields: Object.freeze(g.fields.map(([key, label, help, long, scope, type, x = {}]) => Object.freeze({ key, label, help, long, scope, type, x: Object.freeze(x), group: g.id }))) })));

export const FIELDS = Object.freeze(GROUPS.flatMap(g => g.fields));
export const FIELD = Object.freeze(Object.fromEntries(FIELDS.map(f => [f.key, f])));
// Today's editability (the legacy editor's fields with editable !== false).
export const EDITABLE_TYPES = Object.freeze(['int', 'num', 'pct', 'symbols', 'time', 'routine', 'text', 'switch', 'windows']);
export const EDITABLE = Object.freeze(FIELDS.filter(f => EDITABLE_TYPES.includes(f.type)).map(f => f.key));
// Sub-keys shown beside their arrays, and the keys of Mode and Where this is defined.
export const ITEM_KEYS = Object.freeze({
  'cadence.wakeWindows': ['id', 'days', 'from', 'until', 'desks'].map(k => `cadence.wakeWindows[].${k}`),
  'tools.entries': ['id', 'label'].map(k => `tools.entries[].${k}`),
});
// An item key reads as its own name after its array's key ("id", "days").
export const itemName = key => key.slice(key.lastIndexOf('[].') + 3);
export const SOURCE_KEYS = Object.freeze(['$schema', 'schema', 'rev', 'updatedAt']);
// Every key Settings shows, in page order.
export const SHOWN_KEYS = Object.freeze(['mode', ...FIELDS.flatMap(f => [f.key, ...(ITEM_KEYS[f.key] ?? [])]), ...SOURCE_KEYS]);

// One home per setting: where each is read from, and what is never an input.
export const SOURCES = Object.freeze({
  'desks.maxBusyDesks': 'trading-team/CONFIG.md is an old policy note; JoeDesk does not read it',
  'desks.stage0.capEur': 'trading-team/CONFIG.md has old context; not used for this setting',
  'desks.keep': 'desk journals are evidence only; they never change the kept list',
  'quota.grok.reservePct': 'quota-state.json is a live reading, not a setting',
  'quota.codex.reservePct': 'quota-state.json is a live reading, not a setting',
  'quota.behavior.amber': 'quota-state.json reports capacity; the response is chosen here',
  'cadence.usOpenArm': 'schedulers must read this version; wiring is outside JoeDesk',
  'cadence.wakeWindows': 'schedulers must adopt these windows',
  'cadence.deskWatch': 'routine names in journals are history',
  'cadence.darwin': 'repeat intervals live in the scheduler',
  'cadence.quotaGovernor': 'routine names in journals are history',
  'amy.routines.morning': 'Amy’s routine definitions must read this version',
  'amy.routines.review': 'Amy’s routine definitions must read this version',
  'amy.routines.close': 'Amy’s routine definitions must read this version',
});

// Each field's Learn tip: the longer help, where it applies and the exact key.
export const FIELD_TERMS = Object.freeze(Object.fromEntries(FIELDS.map(f => [`f:${f.key}`, [f.label, `${f.long} Applies to: ${f.scope}.`, f.key]])));

// The schema's leaf keys: every property without properties of its own, and
// for an array of objects the array and each of its item keys.
export function schemaLeafKeys(schema) {
  const resolve = node => (node?.$ref ? schema.$defs[node.$ref.split('/').pop()] : node);
  const out = [];
  const walk = (raw, path) => {
    const node = resolve(raw);
    if (node.properties) { for (const [k, v] of Object.entries(node.properties)) walk(v, path ? `${path}.${k}` : k); return; }
    out.push(path);
    const item = node.type === 'array' ? resolve(node.items) : null;
    if (item?.properties) for (const k of Object.keys(item.properties)) walk(item.properties[k], `${path}[].${k}`);
  };
  walk(schema, '');
  return out;
}

export const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, path, value) {
  const parts = path.split('.');
  let cursor = o;
  for (const p of parts.slice(0, -1)) cursor = cursor[p];
  cursor[parts.at(-1)] = value;
}
export const vnum = rev => (typeof rev === 'string' && /^fc-\d{6}$/.test(rev) ? Number(rev.slice(3)) : null);
export const nextRev = rev => (vnum(rev) === null ? null : `fc-${String(vnum(rev) + 1).padStart(6, '0')}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Draft values: each editable field as the text its control holds ----------
export const keepExtras = keep => (Array.isArray(keep) ? keep.filter(s => !KEEP_FLOOR.includes(s)) : []);
// The complete normalized decimal for a cap, without exponent notation.
function capDecimal(n) {
  const [coefficient, exponent = '0'] = String(n).split('e');
  const [integer, fraction = ''] = coefficient.split('.');
  const all = integer + fraction, point = integer.length + Number(exponent);
  return point <= 0 ? `0.${'0'.repeat(-point)}${all}`
    : point >= all.length ? all.padEnd(point, '0') : `${all.slice(0, point)}.${all.slice(point)}`;
}
export function rawOf(field, config) {
  const v = get(config, field.key);
  if (field.type === 'symbols') return keepExtras(v).join(',');
  if (field.type === 'windows') return JSON.stringify(Array.isArray(v) ? v : []);
  if (field.type === 'num' && Number.isFinite(v)) return capDecimal(v);
  return v == null ? '' : String(v);
}
export const valuesOf = config => Object.fromEntries(EDITABLE.map(key => [key, rawOf(FIELD[key], config)]));

// Today's validation (parsedFleetFieldValue): a parsed value, or an Error
// with the message the toast shows.
export function parseField(field, raw) {
  const value = String(raw ?? '').trim();
  const fail = message => { throw new Error(message); };
  if (field.type === 'windows') {
    let windows;
    try { windows = JSON.parse(value); } catch { fail('The wake windows could not be read. Reload Settings and try again.'); }
    if (!Array.isArray(windows)) fail('The wake windows could not be read. Reload Settings and try again.');
    if (windows.length > MAX_WINDOWS) fail(`Use at most ${MAX_WINDOWS} wake windows.`);
    windows.forEach((w, i) => {
      const name = `Wake window ${i + 1}`;
      if (!w || typeof w !== 'object' || Array.isArray(w) || typeof w.id !== 'string' || w.id.length > 64 || !ROUTINE_ID.test(w.id)) fail(`${name} needs a lowercase name, for example us-session.`);
      if (!Array.isArray(w.days) || !w.days.length || w.days.length > 7 || new Set(w.days).size !== w.days.length || w.days.some(d => !DAYS.includes(d))) fail(`${name} needs at least one day.`);
      if (!HHMM.test(w.from ?? '') || !HHMM.test(w.until ?? '')) fail(`${name} times must use 24-hour time like 15:25.`);
      if (!Array.isArray(w.desks) || !w.desks.length || w.desks.length > 32 || new Set(w.desks).size !== w.desks.length || w.desks.some(d => typeof d !== 'string' || d.length > 64 || !ROUTINE_ID.test(d))) fail(`${name} needs at least one desk.`);
      if (Object.keys(w).some(k => !['id', 'days', 'from', 'until', 'desks'].includes(k))) fail(`${name} could not be read. Reload Settings and try again.`);
    });
    return windows.map(w => ({ id: w.id, days: DAYS.filter(d => w.days.includes(d)), from: w.from, until: w.until, desks: w.desks.slice() }));
  }
  if (field.type === 'switch') {
    if (![field.x.on, field.x.off].includes(value)) fail(`${field.label} is invalid.`);
    return value;
  }
  if (field.type === 'int' || field.type === 'pct') {
    if (!/^-?[0-9]+$/.test(value)) fail(`${field.label} must be a whole number.`);
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < field.x.min || n > field.x.max) fail(`${field.label} must be from ${field.x.min} to ${field.x.max}.`);
    return n;
  }
  if (field.type === 'num') {
    if (!/^(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?$/.test(value)) fail(`${field.label} must be a number of euros, for example 250.`);
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n) || n < field.x.min || n > field.x.max) fail(`${field.label} must be from ${digits(field.x.min, 0)} to ${digits(field.x.max, 0)} euros.`);
    return n;
  }
  if (field.type === 'symbols') {
    const extras = value.split(',').map(s => s.trim()).filter(Boolean);
    if (extras.some(s => KEEP_FLOOR.includes(s))) fail(`SXR8 and TSLA are always kept; list only the other symbols.`);
    if (extras.some(s => !SYMBOL.test(s)) || new Set(extras).size !== extras.length) fail(`${field.label} must be unique uppercase symbols separated by commas.`);
    if (extras.length + KEEP_FLOOR.length > 64) fail(`${field.label} can hold at most 64 symbols.`);
    return extras;
  }
  if (field.type === 'time' && !HHMM.test(value)) fail(`${field.label} must use 24-hour time like 15:35.`);
  if (field.type === 'routine' && (value.length > 64 || !ROUTINE_ID.test(value))) fail(`${field.label} must be a lowercase routine name, for example desk-watch.`);
  if (!value || value.length > 80 || !PRINTABLE.test(value)) fail(`${field.label} must be 1 to 80 plain characters.`);
  return value;
}

// The text a parsed value is held as again (so "  7" reviews as "7").
export function rawFromParsed(field, parsed) {
  if (field.type === 'symbols') return parsed.join(',');
  if (field.type === 'windows') return JSON.stringify(parsed);
  if (field.type === 'num') return capDecimal(parsed);
  return String(parsed);
}

export const changedKeys = (base, draft) => EDITABLE.filter(key => draft[key] !== base[key]);
export const fingerprint = (base, draft) => JSON.stringify(changedKeys(base, draft).map(key => [key, base[key], draft[key]]));

// The candidate the server receives: the saved settings with each changed,
// validated field applied. Mode, version and every read-only value are the
// saved ones; the kept list always starts with its floor.
export function buildCandidate(config, base, draft) {
  if (!config || config.mode !== 'paper') throw new Error('The saved fleet settings are not loaded.');
  const candidate = structuredClone(config);
  for (const key of changedKeys(base, draft)) {
    const field = FIELD[key];
    const parsed = parseField(field, draft[key]);
    if (field.type === 'symbols') {
      const floor = config.desks.keep.filter(s => KEEP_FLOOR.includes(s));
      for (const s of KEEP_FLOOR) if (!floor.includes(s)) floor.push(s);
      set(candidate, key, [...floor, ...parsed]);
    } else set(candidate, key, parsed);
  }
  candidate.mode = 'paper';
  return candidate;
}

// Before and After, in plain words (fleetDiffDisplay).
export function display(field, raw) {
  const value = String(raw ?? '').trim();
  if (field.type === 'symbols') return [...KEEP_FLOOR, ...value.split(',').map(s => s.trim()).filter(Boolean)].join(', ');
  if (!value) return '(empty)';
  if (field.type === 'switch') return POLICY[value] ?? value;
  if (field.type === 'windows') {
    try {
      const ws = JSON.parse(value);
      return ws.length ? ws.map(w => `${w.id}: ${w.days.map(d => DAY_NAME[d] ?? d).join(', ')}, ${w.from} to ${w.until}, desks ${w.desks.map(d => DESK_NAME[d] ?? d).join(', ')}`).join('; ') : 'No wake windows';
    } catch { return 'Unreadable wake windows'; }
  }
  if (field.type === 'num') {
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n)) return value;
    // Localize the normalized Number's complete decimal, including small
    // caps written in exponent form. toFixed would hide accepted differences.
    const [whole, tail] = capDecimal(n).split('.');
    return `€${NB}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${tail ? `,${tail}` : ''}`;
  }
  if (field.type === 'pct') return `${value}${NB}%`;
  if (field.type === 'int') return /^\d+$/.test(value) ? `${value}${NB}${Number(value) === 1 ? field.x.unit.replace(/s$/, '') : field.x.unit}` : value;
  if (field.type === 'time') return `${value} Vienna time`;
  return value;
}
// Compact Saved captions. Full values remain in the control and Review changes.
export function savedText(field, raw) {
  if (field.type === 'windows') {
    const n = windowsOf(raw)?.length ?? 0;
    return `${n} wake window${n === 1 ? '' : 's'}`;
  }
  if (field.type === 'symbols') {
    const symbols = [...new Set([...KEEP_FLOOR, ...String(raw).split(',').map(s => s.trim()).filter(Boolean)])];
    if (symbols.length > 4) return `${symbols.length} kept symbols`;
  }
  return display(field, raw);
}
// A wake window as a phone shows it: its name and times, then its days and desks.
export const windowLines = w => ({ id: w.id, times: `${w.from} to ${w.until}`,
  rest: `${w.days.map(d => DAY_NAME[d] ?? d).join(', ')} · desks ${w.desks.map(d => DESK_NAME[d] ?? d).join(', ')}` });

// ---------- The edit flow ----------
// state: { config: the saved settings the draft is based on, base, draft,
// readAvailable / readReason describe the latest fleet read independently of
// the saved version and local draft; reviewed / confirmed are fingerprints.
export function editState(config = null) {
  const values = config ? valuesOf(config) : null;
  return { config, base: values, draft: values ? { ...values } : null, readAvailable: Boolean(config), readReason: null,
    reviewed: null, confirmed: null, busy: false, outcome: null };
}
export const changes = s => (s.base ? changedKeys(s.base, s.draft) : []);
export const isDirty = s => changes(s).length > 0;
const current = s => (s.base ? fingerprint(s.base, s.draft) : null);
export const isConfirmed = s => isDirty(s) && s.confirmed !== null && s.confirmed === current(s);
export const canSend = s => s.readAvailable && isConfirmed(s) && !s.busy;

// A newer saved version replaces a clean draft; a draft in progress keeps the
// version it was made against, so its send meets the server's revision check.
export function adopt(s, config, reason = null) {
  const available = Boolean(config) && !reason;
  if (s.readAvailable !== available || s.readReason !== reason) {
    s = { ...s, readAvailable: available, readReason: reason, reviewed: null, confirmed: null };
  }
  if (!config || s.busy || s.config === config) return s;
  if (s.config && isDirty(s)) return s;
  // Just written: an older read in flight never replaces the version written.
  if ((s.outcome?.ok || s.outcome?.stored) && vnum(config.rev) < vnum(s.outcome.rev)) return s;
  const values = valuesOf(config);
  return { ...s, config, base: values, draft: { ...values }, reviewed: null, confirmed: null };
}
export function edit(s, key, raw) {
  if (!s.base || s.busy || !EDITABLE.includes(key)) return s;
  return { ...s, draft: { ...s.draft, [key]: String(raw) }, reviewed: null, confirmed: null, outcome: null };
}
// Review changes: every changed field validated; the draft keeps the parsed
// form, so the dialog shows exactly what would be sent.
export function review(s) {
  if (!s.base || s.busy) return { s, error: null, rows: [] };
  if (!s.readAvailable) return { s, error: 'The current fleet settings could not be checked. Reopen Settings to retry; your draft is kept.', rows: [] };
  const draft = { ...s.draft };
  for (const key of changedKeys(s.base, s.draft)) {
    try { draft[key] = rawFromParsed(FIELD[key], parseField(FIELD[key], draft[key])); }
    catch (error) { return { s, error: error.message, rows: [] }; }
  }
  const next = { ...s, draft, confirmed: null };
  const keys = changedKeys(next.base, draft);
  if (!keys.length) return { s: { ...next, reviewed: null }, error: 'Your draft matches the saved settings.', rows: [] };
  return { s: { ...next, reviewed: fingerprint(next.base, draft) }, error: null,
    rows: keys.map(key => ({ key, label: FIELD[key].label, before: display(FIELD[key], next.base[key]), after: display(FIELD[key], draft[key]) })) };
}
export function confirm(s, ticked) {
  if (!s.readAvailable || !ticked || !s.reviewed || s.reviewed !== current(s) || !isDirty(s)) return s;
  return { ...s, confirmed: s.reviewed };
}
export const start = s => ({ ...s, busy: true, outcome: null });
// After a send: success adopts the written settings (validated by the caller
// against the shared contract); failure keeps the draft, unconfirmed. Stored
// with an unfinished change-log entry: the reviewed draft is what the shared
// file now holds, so it shows as saved until that version is read back.
export function finish(s, result) {
  if (result.ok) {
    const values = valuesOf(result.config);
    return { ...s, config: result.config, base: values, draft: { ...values }, reviewed: null, confirmed: null, busy: false,
      outcome: { ok: true, rev: result.config.rev, keys: result.keys } };
  }
  if (result.stored) {
    return { ...s, base: { ...s.draft }, busy: false, reviewed: null, confirmed: null,
      outcome: { ok: false, stored: true, rev: result.rev, keys: result.keys, reason: result.reason } };
  }
  return { ...s, busy: false, reviewed: null, confirmed: null, outcome: { ok: false, rev: s.config?.rev ?? null, keys: result.keys, reason: result.reason } };
}
export function discard(s, config) {
  const fresh = editState(config ?? s.config);
  return { ...fresh, readAvailable: s.readAvailable, readReason: s.readReason, outcome: null };
}

// What the server's answer means (status and body as received).
export function sendOutcome(status, body, attemptedKeys) {
  if (status === 200 && body?.ok === true && body.config && typeof body.rev === 'string') {
    const keys = Array.isArray(body.action?.changedKeys) && body.action.changedKeys.length ? body.action.changedKeys : attemptedKeys;
    return { ok: true, config: body.config, rev: body.rev, keys };
  }
  if (status === 0) return { ok: false, keys: attemptedKeys, reason: 'the board server did not answer' };
  if ([301, 302, 303, 307, 308, 401, 403].includes(status) && !body?.error) return { ok: false, keys: attemptedKeys, reason: 'sign-in expired — reload' };
  const currentRev = typeof body?.currentRev === 'string' && /^fc-\d{6}$/.test(body.currentRev) ? body.currentRev : null;
  // Only a 409 is a revision conflict. A 500 naming the current version means
  // the server stored the draft as that version but could not finish its
  // change-log entry: written, not "Not sent", and not a clean success either.
  if (status === 409 && currentRev) return { ok: false, keys: attemptedKeys, reason: `revision changed to ${currentRev}; reload before retrying`, currentRev };
  if (status === 500 && currentRev) return { ok: false, stored: true, rev: currentRev, keys: attemptedKeys, reason: 'the change log could not record it' };
  const detail = Array.isArray(body?.errors) && body.errors.length ? body.errors[0] : body?.error;
  return { ok: false, keys: attemptedKeys, reason: typeof detail === 'string' && PRINTABLE.test(detail) ? detail.slice(0, 160) : 'request rejected' };
}

// The edit bar: the note and which buttons are enabled (spec §8.4, Part A words).
export function bar(s, { loaded = Boolean(s.base), failed = Boolean(s.readReason) } = {}) {
  const n = changes(s).length, v = vnum(s.config?.rev);
  const off = { discard: false, save: false, review: false, send: false };
  if (!loaded) return { tone: failed ? 'bad' : 'none', state: failed ? 'unavailable' : 'loading', lead: failed ? 'Fleet settings unavailable' : 'Loading the fleet settings', rest: failed ? 'values are hidden and editing is disabled. Reopen Settings to retry.' : 'editing starts once they arrive', buttons: off };
  if (s.busy) return { tone: 'none', state: 'writing', lead: `Writing version ${v + 1}…`, rest: '', buttons: off };
  const buttons = { discard: n > 0, save: n > 0, review: n > 0, send: canSend(s) };
  let outcome = null;
  if (s.outcome?.ok && !n) outcome = { tone: 'ok', state: 'sent', lead: `Sent version ${vnum(s.outcome.rev)}`, rest: 'saved to the shared file. The desks’ reload is not confirmed.', buttons };
  if (s.outcome?.stored && !n) outcome = { tone: 'warn', state: 'stored', lead: `Sent version ${vnum(s.outcome.rev)}`, rest: `saved to the shared file, but ${s.outcome.reason}. The desks’ reload is not confirmed.`, buttons };
  if (s.outcome && !s.outcome.ok && !s.outcome.stored) outcome = { tone: 'bad', state: 'failed', lead: 'Not sent', rest: `version ${vnum(s.outcome.rev)} was not confirmed as written: ${s.outcome.reason}.`, buttons };
  if (!s.readAvailable || failed) {
    const lead = 'Fleet settings unavailable · showing last good';
    const rest = `version ${v} could not be revalidated${s.readReason ? `: ${s.readReason === 'auth_required' ? 'sign-in required' : s.readReason.replaceAll('_', ' ')}` : ''}. Your local draft is kept; reopen Settings to retry before reviewing or sending.`;
    // Keep the write's answer first, alongside the independent read failure.
    return { tone: outcome?.tone === 'bad' ? 'bad' : 'warn', state: 'last-good', lead: outcome?.lead ?? lead,
      rest: outcome ? `${outcome.rest} ${lead}.` : rest,
      buttons: { ...off, discard: n > 0, save: n > 0 } };
  }
  if (outcome) return outcome;
  if (!n) return { tone: 'ok', state: 'clean', lead: 'No changes', rest: `version ${v} is current`, buttons };
  if (isConfirmed(s)) return { tone: 'ok', state: 'reviewed', lead: `${plural(n, 'change')} reviewed`, rest: `ready to send as version ${v + 1}`, buttons };
  return { tone: 'warn', state: 'dirty', lead: `${plural(n, 'change')} in your draft`, rest: 'review before you send', buttons };
}

// ---------- The browser-local draft (Save draft) ----------
export const previewPayload = s => JSON.stringify({ baseRev: s.config.rev, values: s.draft });
// A draft value has the shape its control can hold: a line of text, one of
// the switch's two values, or a list of wake windows the editor can draw.
// Review changes still validates the content.
const LINE = /^[^\x00-\x1f\x7f]*$/;
const WINDOW_KEYS = Object.freeze(['id', 'days', 'from', 'until', 'desks']);
export function windowsOf(raw) {
  let ws;
  try { ws = JSON.parse(raw); } catch { return null; }
  const line = v => typeof v === 'string' && LINE.test(v);
  const shaped = w => w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length === WINDOW_KEYS.length && WINDOW_KEYS.every(k => Object.hasOwn(w, k)) &&
    line(w.id) && line(w.from) && line(w.until) && Array.isArray(w.days) && w.days.length <= DAYS.length && w.days.every(d => DAYS.includes(d)) &&
    Array.isArray(w.desks) && w.desks.length <= 32 && w.desks.every(line);
  return Array.isArray(ws) && ws.length <= MAX_WINDOWS && ws.every(shaped) ? ws : null;
}
function draftValueOk(field, v) {
  if (typeof v !== 'string' || v.length > (field.type === 'windows' ? 131072 : 1200)) return false;
  if (field.type === 'windows') return windowsOf(v) !== null;
  if (field.type === 'switch') return [field.x.on, field.x.off].includes(v);
  return LINE.test(v);
}
// The draft saved in this browser comes back only for the version it names,
// and only whole: one value of the wrong shape, or a key that is not an
// editable setting, drops it (dropped: true; the caller forgets it).
export function readPreview(text, s) {
  if (!s.config || !text) return { s, dropped: false };
  let stored;
  try { stored = JSON.parse(text); } catch { return { s, dropped: true }; }
  const values = stored?.values;
  if (!stored || typeof stored !== 'object' || typeof stored.baseRev !== 'string' || !values || typeof values !== 'object' || Array.isArray(values)) return { s, dropped: true };
  if (stored.baseRev !== s.config.rev) return { s, dropped: false };
  if (Object.entries(values).some(([key, v]) => !EDITABLE.includes(key) || !draftValueOk(FIELD[key], v))) return { s, dropped: true };
  return { s: { ...s, draft: { ...s.draft, ...values }, reviewed: null, confirmed: null }, dropped: false };
}

// ---------- The change log (/joe/fleet-config/actions.json) ----------
const REASON_WORDS = Object.freeze({
  propagated: 'sent', write_started: 'writing started; no outcome recorded', revision_conflict: 'the version had changed',
  schema_rejected: 'the settings format rejected the change', read_only_tools: 'connections are read-only',
  read_only_secret_slots: 'secret references are read-only', no_changes: 'nothing had changed',
  store_failed: 'the shared file could not be written', origin_rejected: 'not sent from this board’s page',
  content_type_rejected: 'the request was malformed', body_too_large: 'the request was too large', body_rejected: 'the request was malformed',
  json_rejected: 'the request was malformed', envelope_rejected: 'the request was malformed', config_unavailable: 'the saved settings could not be read',
});
const ACTION_KEYS = ['id', 'at', 'actor', 'revBefore', 'revAfter', 'changedKeys', 'outcome', 'reason'];
export function acceptActions(payload) {
  if (!payload || payload.schema !== 'inspr.joe.fleet-config.actions.v1' || !Array.isArray(payload.entries) || payload.entries.length > 200) return null;
  const ok = e => e && typeof e === 'object' && ACTION_KEYS.every(k => Object.hasOwn(e, k)) && Number.isFinite(Date.parse(e.at)) &&
    ['pending', 'success', 'failure'].includes(e.outcome) && Array.isArray(e.changedKeys) && e.changedKeys.every(k => typeof k === 'string' && /^[A-Za-z0-9.[\]-]{1,40}$/.test(k)) &&
    typeof e.actor === 'string' && /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,159}$/.test(e.actor) && [e.revBefore, e.revAfter].every(r => r === null || vnum(r) !== null);
  if (!payload.entries.every(ok)) return null;
  return payload.entries.slice().reverse();
}
export function actionView(e) {
  const tone = e.outcome === 'success' ? 'ok' : e.outcome === 'pending' ? 'warn' : 'bad';
  const word = e.outcome === 'success' ? 'Sent' : e.outcome === 'pending' ? 'Pending' : 'Not sent';
  const before = vnum(e.revBefore), after = vnum(e.revAfter);
  const versions = e.outcome === 'success' ? { from: before, to: after } : e.outcome === 'pending' ? { from: before, to: after, note: 'not confirmed' } : { from: before, to: null, note: 'not changed' };
  const what = e.outcome === 'success' ? null : REASON_WORDS[e.reason] ?? 'not recorded';
  return { tone, word, versions, actor: e.actor, keys: e.changedKeys, what };
}
