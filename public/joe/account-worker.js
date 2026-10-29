// The whole account's history (two stores, up to 2 MiB each) is fetched,
// parsed and checked here, off the page's main thread, through the same
// acceptance as on the page (acceptAccountHistory); the page receives the
// compact columns by transfer, never a copy. The page starts this worker
// under its release's own path (as history-worker.js), so the imports below
// resolve to that same release.
//
// Message in: { read: 'account', have }: have is the key of the history the
// page holds (or null). Messages out:
//   { kind: 'account', status, reason, value, key, ms }: value holds the two
//     series (null when the read failed, with its reason);
//   { kind: 'unchanged', feed: 'account', key, ms }: the page's copy is current.
import { acceptAccountHistory, accountTransferables } from './account-model.js';

const AUTH = new Set([301, 302, 303, 307, 308, 401, 403]);
const READ_TIMEOUT_MS = 15000;

async function read(url) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: 0 }); }, READ_TIMEOUT_MS); }),
      (async () => {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual', signal: controller.signal });
        if (response.type === 'opaqueredirect') return { status: 302 };
        if (response.status !== 200) return { status: response.status };
        return { status: 200, body: await response.json() };
      })(),
    ]);
  } catch { return { status: 0 }; } finally { clearTimeout(timer); }
}
const readReason = status => (AUTH.has(status) ? 'auth_required' : status === 404 ? 'route_not_found' : 'refresh_failed');

// What the page needs to know whether its copy is current: the shape, the
// newest times, the store reasons and sums over every time and amount (a
// late close for an older day changes them).
export function historyKey(value) {
  const part = s => { let t = 0, u = 0n; for (let i = 0; i < s.t.length; i++) { t += s.t[i]; u += s.u[i]; } return [s.t.length, s.t.at(-1) ?? null, t, String(u), s.reason, s.loss?.at ?? null]; };
  return JSON.stringify([part(value.short), part(value.daily)]);
}

export async function readAccount(have = null) {
  const started = performance.now(), ms = () => performance.now() - started;
  const res = await read('/joe/account-history.json');
  if (res.status !== 200) return { message: { kind: 'account', status: res.status, reason: readReason(res.status), value: null, key: null, ms: ms() }, transfer: [] };
  let value;
  try { value = acceptAccountHistory(res.body); } catch { return { message: { kind: 'account', status: 200, reason: 'contract_invalid', value: null, key: null, ms: ms() }, transfer: [] }; }
  const key = historyKey(value);
  if (key === have) return { message: { kind: 'unchanged', feed: 'account', key, ms: ms() }, transfer: [] };
  return { message: { kind: 'account', status: 200, reason: null, value, key, ms: ms() }, transfer: accountTransferables(value) };
}

self.onmessage = async ({ data }) => {
  if (data?.read !== 'account') return;
  const { message, transfer } = await readAccount(typeof data.have === 'string' ? data.have : null);
  self.postMessage(message, transfer);
};
