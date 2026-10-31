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
// The key fingerprints the complete response (its length in bytes and a
// 64-bit FNV-1a hash of them): every time, amount, reason and day of both
// stores. "unchanged" needs more than a matching key: the response must be
// exactly the one this worker last sent the page.
import { acceptAccountHistory, accountTransferables } from './account-model.js';

import { readJSON, readFailure } from './transport.js';
const read = url => readJSON(url, {}, { text: true });

// 64-bit FNV-1a over bytes, in four 16-bit limbs (exact without BigInt):
// hash ^= byte, then hash *= 2^40 + 0x1b3, modulo 2^64.
export function fnv1a64(bytes) {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i++) {
    h0 ^= bytes[i];
    const r0 = h0 * 0x1b3, r1 = h1 * 0x1b3 + (r0 >>> 16), r2 = h2 * 0x1b3 + h0 * 0x100 + (r1 >>> 16), r3 = h3 * 0x1b3 + h1 * 0x100 + (r2 >>> 16);
    h0 = r0 & 0xffff; h1 = r1 & 0xffff; h2 = r2 & 0xffff; h3 = r3 & 0xffff;
  }
  return [h3, h2, h1, h0].map(h => h.toString(16).padStart(4, '0')).join('');
}
// The response's fingerprint: its length in bytes and their hash.
export function fingerprint(text) {
  const bytes = new TextEncoder().encode(text);
  return `${bytes.length}:${fnv1a64(bytes)}`;
}
// The response last sent to the page with its data, to confirm "unchanged".
let sent = null;

export async function readAccount(have = null) {
  const started = performance.now(), ms = () => performance.now() - started;
  const res = await read('/joe/account-history.json');
  if (res.status !== 200) return { message: { evidence: res.evidence, kind: 'account', status: res.status, reason: readFailure(res), value: null, key: null, ms: ms() }, transfer: [] };
  const key = fingerprint(res.text);
  if (have !== null && have === key && sent?.key === key && sent.text === res.text) return { message: { evidence: res.evidence, kind: 'unchanged', feed: 'account', key, ms: ms() }, transfer: [] };
  let value;
  try { value = acceptAccountHistory(res.payload); } catch { return { message: { evidence: res.evidence, kind: 'account', status: 200, reason: 'contract_invalid', value: null, key: null, ms: ms() }, transfer: [] }; }
  sent = { key, text: res.text };
  return { message: { evidence: res.evidence, kind: 'account', status: 200, reason: null, value, key, ms: ms() }, transfer: accountTransferables(value) };
}

self.onmessage = async ({ data }) => {
  if (data?.read !== 'account') return;
  const { message, transfer } = await readAccount(typeof data.have === 'string' ? data.have : null);
  self.postMessage(message, transfer);
};
