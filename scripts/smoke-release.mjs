#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { validateContract, CONTRACTS } from '../contracts/index.mjs';
import { parseVersion } from '../release/versioning.mjs';

export const PROTECTED_READS = ['data.json', 'history.json', 'results.json', 'state.json', 'fleet-config.json', 'fleet-config/actions.json'];
export async function smokeRelease(baseURL, expected, { fetcher = fetch, maxSnapshotAgeSeconds = 60, allowUnreported = false } = {}) {
  parseVersion(expected);
  const base = new URL(baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/joe/') throw new Error('smoke_base_invalid');
  // No cookie jar, authorization or identity headers. Never follow an SSO redirect.
  const request = url => fetcher(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  const response = await request(new URL('healthz', base));
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw new Error('auth_required');
  if (response.status !== 200 || response.redirected) throw new Error('health_unavailable');
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > CONTRACTS.limits.healthz) { await reader.cancel(); throw new Error('health_size_limit'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const health = JSON.parse(bytes);
  if (!validateContract('healthz', health).ok) throw new Error('health_contract_invalid');
  if (health.version !== expected.version || health.versionScheme !== expected.version_scheme || health.schemaVersion !== CONTRACTS.schema) throw new Error('release_mismatch');
  if (!allowUnreported && (health.snapshotAgeSeconds === null || health.snapshotAgeSeconds >= maxSnapshotAgeSeconds ||
      ['data', 'history', 'fleet-config'].some(k => health.feeds[k].state !== 'fresh' || health.feeds[k].ageSeconds === null || health.feeds[k].ageSeconds >= maxSnapshotAgeSeconds) || !health.gateway.confirmed)) throw new Error('feeds_not_ready');
  for (const route of PROTECTED_READS) {
    const read = await request(new URL(route, base));
    if (![301, 302, 303, 307, 308, 401, 403].includes(read.status)) throw new Error('protected_read_exposed');
    // Consume/cancel without logging a potentially private error body.
    await read.body?.cancel();
  }
  return { ok: true, version: health.version, versionScheme: health.versionScheme, schemaVersion: health.schemaVersion,
    snapshotAgeSeconds: health.snapshotAgeSeconds, feeds: health.feeds, protectedReads: 'anonymous-rejected', results: health.feeds.results.state };
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, version_scheme, version] = process.argv.slice(2);
  try { console.log(JSON.stringify(await smokeRelease(base, { version_scheme, version }))); }
  catch (error) { console.error(['auth_required', 'release_mismatch', 'feeds_not_ready', 'protected_read_exposed'].includes(error.message) ? error.message : 'release_smoke_failed'); process.exitCode = 1; }
}
