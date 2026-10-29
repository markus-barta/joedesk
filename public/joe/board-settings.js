// Board display values only. Shared validation with the server; no policy or
// broker settings live here. Dates are calendar dates, independent of timezone.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateBoardSettings(value) {
  if (!object(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'accountStart')) return 'Expected only accountStart.';
  const start = value.accountStart;
  if (start === null) return null;
  if (!object(start) || Object.keys(start).length !== 2 || !Object.hasOwn(start, 'amountEur') || !Object.hasOwn(start, 'date')) return 'Account start needs an amount in EUR and a date.';
  if (typeof start.amountEur !== 'number' || !Number.isFinite(start.amountEur) || start.amountEur <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(start.amountEur)) || !Number.isSafeInteger(Math.round(start.amountEur * 100))) return 'Enter a positive EUR amount with at most two decimal places and safely representable cents.';
  if (typeof start.date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(start.date)) return 'Enter a real calendar date as YYYY-MM-DD.';
  const date = new Date(`${start.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start.date) return 'Enter a real calendar date as YYYY-MM-DD.';
  return null;
}

// Each failed read hides the base rather than retaining an unverified amount.
// A late read may never replace the result of a more recent save.
export function createBoardSettings({ fetcher = (...args) => fetch(...args), changed = () => {} } = {}) {
  let state = { accountStart: null, reason: 'loading' }, generation = 0, saving = false;
  const snapshot = () => structuredClone(state);
  const publish = next => { state = next; changed(); };
  async function request(method, value) {
    if (saving) return { ok: false, error: 'Account start is being saved.' };
    const current = ++generation;
    saving = method === 'POST';
    try {
      const response = await fetcher('./board-settings.json', { method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {}) });
      const body = await response.json();
      const settings = { accountStart: body?.accountStart };
      if (response.status !== 200 || validateBoardSettings(settings) || !['missing', 'invalid', 'unreadable', 'unset', null].includes(body.reason)) {
        throw new Error(response.status !== 200 && typeof body?.error === 'string' ? body.error : 'Account start could not be checked.');
      }
      if (body.reason !== null && settings.accountStart !== null) throw new Error('Account start could not be checked.');
      if (current === generation) publish({ ...settings, reason: body.reason });
      return { ok: true };
    } catch (error) {
      if (current === generation) publish({ accountStart: null, reason: 'refresh_failed' });
      return { ok: false, error: error.message || 'Account start could not be saved.' };
    } finally { if (current === generation) saving = false; }
  }
  return { snapshot, accountStart: () => snapshot().accountStart,
    refresh: () => request('GET'),
    save: value => {
      const error = validateBoardSettings(value);
      return error ? Promise.resolve({ ok: false, error }) : request('POST', value);
    } };
}

let notify = () => {};
const settings = createBoardSettings({ changed: () => notify() });
export const accountStart = () => settings.accountStart();
export const boardSettingsState = () => settings.snapshot();
export const refreshBoardSettings = () => settings.refresh();
export const saveBoardSettings = value => settings.save(value);
export const onBoardSettingsChange = callback => { notify = callback; };
