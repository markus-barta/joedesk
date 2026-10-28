// Three small accepted snapshots for the hero's local/shared/mixed captions.
// Kept separate from the browser runner so Node-only tests verify their shape.
export function heroWordingFixtures(snapshot) {
  const make = reasons => () => {
    const payload = structuredClone(snapshot);
    delete payload.receivedAt;
    payload.seq++;
    payload.generatedAt = new Date(Date.parse(snapshot.receivedAt) + 30000).toISOString();
    payload.safety.gateway.checkedAt = payload.generatedAt;
    for (const source of Object.values(payload.pnlSources)) source.observedAt = payload.generatedAt;
    for (const [field, reason] of Object.entries(reasons)) {
      for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) {
        bag[field] = null; (bag.reasons ??= {})[field] = reason;
      }
      for (const sources of [payload.pnlSources, ...payload.desks.map(d => d.pnlSources)].filter(Boolean)) {
        Object.assign(sources[field === 'dayPnl' ? 'day' : 'open'], {
          status: 'unavailable', method: null, observedAt: null, reason,
        });
      }
    }
    return { feed: 'data', payload, receivedAt: payload.generatedAt,
      now: new Date(Date.parse(payload.generatedAt) + 9000).toISOString() };
  };
  return {
    'p3-not-exact-yet': make({ dayPnl: 'not_exact_yet' }),
    'p3-shared-not-exact': make({ dayPnl: 'baseline_pending', openPnl: 'baseline_pending' }),
    'p3-mixed-not-exact-fault': make({ dayPnl: 'not_exact_yet', openPnl: 'source_unavailable' }),
  };
}
