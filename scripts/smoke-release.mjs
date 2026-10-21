#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateContract, CONTRACTS } from '../contracts/index.mjs';
import { parseVersion } from '../release/versioning.mjs';

export const PROTECTED_READS = ['data.json', 'history.json', 'results.json', 'state.json', 'fleet-config.json', 'fleet-config/actions.json'];
// Every app response carries this stamp; the edge must preserve it and never
// add it to its own denials. A bare app's 401 is not SSO evidence.
export const APP_ORIGIN_HEADER = 'x-joedesk-origin';
const AUTH_STATUSES = [301, 302, 303, 307, 308, 401, 403];
export async function smokeRelease(baseURL, expected, { fetcher = fetch, maxSnapshotAgeSeconds = 60, allowUnreported = false,
  maxWaitSeconds = 150, clock = () => performance.now(), wait = sleep } = {}) {
  parseVersion(expected);
  if (!Number.isInteger(maxWaitSeconds) || maxWaitSeconds < 0 || maxWaitSeconds > 600) throw new Error('smoke_wait_invalid');
  const base = new URL(baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/joe/') throw new Error('smoke_base_invalid');
  // No cookie jar or authorization. Identity is sent only as an explicit
  // synthetic spoof probe. Never follow an SSO redirect or log response bodies.
  const request = (url, headers = {}, timeout = 10000) => fetcher(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json', ...headers } });
  const readHealth = async timeout => {
    const response = await request(new URL('healthz', base), {}, timeout);
    if (AUTH_STATUSES.includes(response.status)) { await response.body?.cancel(); throw new Error('auth_required'); }
    if (response.status !== 200 || response.redirected) throw new Error('health_unavailable');
    if (response.headers.get(APP_ORIGIN_HEADER) !== 'app') { await response.body?.cancel(); throw new Error('app_origin_not_proven'); }
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
    return health;
  };
  const deadline = clock() + maxWaitSeconds * 1000;
  let health, gatewayConfirmed = false;
  for (;;) {
    const remaining = deadline - clock();
    if (health && remaining < 0) throw new Error('feeds_not_ready');
    try { health = await readHealth(allowUnreported || maxWaitSeconds === 0 ? 10000 : Math.max(1, Math.min(10000, Math.ceil(remaining)))); }
    catch (error) {
      if (error.name === 'TimeoutError' && !allowUnreported && maxWaitSeconds > 0 && clock() >= deadline) throw new Error('feeds_not_ready');
      throw error;
    }
    gatewayConfirmed ||= health.gateway.confirmed;
    const feedsReady = health.snapshotAgeSeconds !== null && health.snapshotAgeSeconds < maxSnapshotAgeSeconds &&
      ['data', 'history'].every(k => health.feeds[k].state === 'fresh' && health.feeds[k].ageSeconds !== null && health.feeds[k].ageSeconds < maxSnapshotAgeSeconds) &&
      health.feeds['fleet-config'].state === 'fresh' && health.feeds['fleet-config'].reason === null;
    if (allowUnreported || (feedsReady && gatewayConfirmed && (maxWaitSeconds === 0 || clock() <= deadline))) break;
    const delay = deadline - clock();
    if (delay <= 0) throw new Error('feeds_not_ready');
    await wait(Math.min(10000, delay));
  }
  const surfaces = ['', `app.js?v=${encodeURIComponent(expected.version)}`, 'healthz/', 'healthz-extra'];
  for (const spoof of [false, true]) for (const route of [...PROTECTED_READS, ...surfaces]) {
    const read = await request(new URL(route, base), spoof ? {
      'x-auth-request-user': 'joedesk-smoke-spoof', 'x-forwarded-user': 'joedesk-smoke-spoof',
    } : {});
    try {
      if (!AUTH_STATUSES.includes(read.status) || read.redirected) throw new Error(spoof ? 'spoofed_identity_exposed' : PROTECTED_READS.includes(route) ? 'protected_read_exposed' : 'protected_ui_exposed');
      if (read.headers.has(APP_ORIGIN_HEADER) || (read.status < 400 && !read.headers.get('location'))) throw new Error('sso_not_proven');
    } finally { await read.body?.cancel(); }
  }
  return { ok: true, version: health.version, versionScheme: health.versionScheme, schemaVersion: health.schemaVersion,
    snapshotAgeSeconds: health.snapshotAgeSeconds, feeds: health.feeds, protectedReads: 'sso-rejected', protectedUI: 'sso-rejected',
    spoofedIdentity: 'sso-rejected', healthException: 'exact-path', results: health.feeds.results.state };
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base, version_scheme, version, ...flags] = process.argv.slice(2);
    if (flags.length && (flags.length !== 2 || flags[0] !== '--max-wait-seconds' || !/^(?:0|[1-9]\d*)$/.test(flags[1]))) throw new Error('smoke_usage');
    const options = flags.length ? { maxWaitSeconds: Number(flags[1]) } : {};
    console.log(JSON.stringify(await smokeRelease(base, { version_scheme, version }, options)));
  }
  catch (error) { console.error(['auth_required', 'release_mismatch', 'feeds_not_ready', 'protected_read_exposed', 'protected_ui_exposed', 'spoofed_identity_exposed', 'sso_not_proven', 'app_origin_not_proven'].includes(error.message) ? error.message : 'release_smoke_failed'); process.exitCode = 1; }
}
