// Settings owns this write capability; the page facade re-exports only reads.
import { validateBoardSettings } from './board-settings-validation.js';
import { readJSON, boardSession } from './transport.js';

// Each failed read hides the base rather than retaining an unverified amount.
// A late read may never replace the result of a more recent save.
export function createBoardSettings({ fetcher = (...args) => fetch(...args), changed = () => {}, timeoutMs = 15000 } = {}) {
  let state = { accountStart: null, reason: 'loading' }, generation = 0, saving = false;
  const snapshot = () => structuredClone(state);
  const publish = next => { state = next; changed(); };
  async function request(method, value) {
    if (saving) return { ok: false, error: 'Account start is being saved.' };
    const current = ++generation;
    saving = method === 'POST';
    let failureReason = 'refresh_failed';
    try {
      const response = await readJSON('./board-settings.json', { method, credentials: 'same-origin',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {}) }, { fetcher, timeoutMs });
      if (current === generation) boardSession.observe('/joe/board-settings.json', response);
      if (response.auth) { failureReason = 'auth_required'; throw new Error('Sign-in expired. Reload to sign in.'); }
      if (response.timedOut) throw new Error('Account start request timed out. Refresh before retrying.');
      const body = response.payload;
      const settings = { accountStart: body?.accountStart };
      if (response.status !== 200 || validateBoardSettings(settings) || !['missing', 'invalid', 'unreadable', 'unset', null].includes(body.reason)) {
        throw new Error(response.status !== 200 && typeof body?.error === 'string' ? body.error : 'Account start could not be checked.');
      }
      if ((body.reason === null) !== (settings.accountStart !== null)) throw new Error('Account start could not be checked.');
      if (method === 'POST' && (body.ok !== true || (value.accountStart === null ? settings.accountStart !== null :
        settings.accountStart?.amountEur !== value.accountStart.amountEur || settings.accountStart?.date !== value.accountStart.date))) throw new Error('The saved account start could not be confirmed. Refresh before retrying.');
      if (current === generation) publish({ ...settings, reason: body.reason });
      return { ok: true };
    } catch (error) {
      if (current === generation) publish({ accountStart: null, reason: failureReason });
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

const listeners = new Set();
const settings = createBoardSettings({ changed: () => { for (const listener of listeners) listener(); } });
export const accountStart = () => settings.accountStart();
export const boardSettingsState = () => settings.snapshot();
export const refreshBoardSettings = () => settings.refresh();
export const saveBoardSettings = value => settings.save(value);
export const onBoardSettingsChange = callback => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
