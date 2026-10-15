import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { feedAge, panelState } from '../contracts/panel-state.mjs';
import { gatewayCheckAgeMs } from '../contracts/gateway.mjs';

export function healthProjection(model, release, now) {
  const source = model.feeds();
  const feeds = {};
  for (const name of ['data', 'history', 'results', 'fleet-config']) {
    const feed = source[name];
    let state = panelState(feed, feed.value, feed.value?.reason, now);
    if (!feed.value && (!feed.reason || feed.reason === 'results_not_wired')) state = {
      state: 'not reported', ageSeconds: null, reason: feed.reason ?? 'refresh_failed' };
    if (feed.value && Date.parse(now) < Date.parse(feed.value.receivedAt ?? feed.receivedAt)) state = {
      state: 'broken', ageSeconds: null, reason: 'clock_regressed' };
    feeds[name] = { state: state.state, ageSeconds: state.ageSeconds, reason: state.reason };
  }
  const gateway = model.panels(now).gateway;
  const data = source.data.value;
  const age = gatewayCheckAgeMs(data?.safety.gateway, data?.generatedAt) === null ? null : gateway.ageSeconds;
  const confirmed = Boolean(source.data.value?.safety.gateway?.apiSessionReady &&
    !gateway.reason && age !== null && age < 60);
  const result = { schema: CONTRACTS.contracts.healthz, version: release.version, versionScheme: release.version_scheme,
    schemaVersion: CONTRACTS.schema, serverNow: now, snapshotAgeSeconds: feedAge(source.data, now), feeds,
    gateway: { confirmed, checkAgeSeconds: age, reason: confirmed ? null : gateway.reason ?? 'gateway_unconfirmed' } };
  if (!validateContract('healthz', result).ok) throw new Error('contract_invalid');
  return result;
}
