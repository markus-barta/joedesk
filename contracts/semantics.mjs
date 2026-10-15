import { decimalUnits } from './decimal.mjs';

const FIELDS = ['equity', 'dayPnl', 'openPnl', 'totalPnl'];
const KEEP = ['SXR8', 'TSLA'];
const DESKS = ['j', 'joe', 'joel'];

export function checkSemantics(kind, payload, stage, errors) {
  const fail = (path, rule) => { if (errors.length < 32) errors.push({ path, rule }); };
  const eur = (money, path) => {
    if (money && money.currency !== 'EUR') fail(path, 'EUR');
  };
  function walk(value, path) {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'amount') && Object.hasOwn(value, 'currency') && value.fx) {
      if (value.fx.quote !== value.currency) fail(path, 'fxCurrency');
    }
    if (Object.hasOwn(value, 'rate') && Object.hasOwn(value, 'base') && decimalUnits(value.rate) <= 0n) fail(path, 'positiveFxRate');
    Object.entries(value).forEach(([k, v]) => walk(v, `${path}.${k}`));
  }
  walk(payload, '$');
  if (['data', 'history', 'results'].includes(kind)) {
    if (stage === 'served' && !payload.receivedAt) fail('$.receivedAt', 'required');
    if (stage === 'ingress' && Object.hasOwn(payload, 'receivedAt')) fail('$.receivedAt', 'serverOwned');
  }
  const checkBag = (bag, path) => FIELDS.forEach(f => eur(bag?.[f], `${path}.${f}`));
  if (kind === 'data') {
    if (new Set(payload.desks.map(d => d.id)).size !== 3) fail('$.desks', 'uniqueDesk');
    checkBag(payload.totals, '$.totals');
    payload.desks.forEach((d, i) => {
      checkBag(d.money, `$.desks[${i}].money`);
      if (d.backfill && d.id !== 'j') fail(`$.desks[${i}].backfill`, 'jOnly');
      if (d.backfill?.fullTotalAvailable && (d.backfill.status !== 'COMPLETE' ||
          d.backfill.coverage.gapCount || d.backfill.missingOpeningLotCount || d.backfill.orphanCommissionCount)) {
        fail(`$.desks[${i}].backfill`, 'incompleteCoverage');
      }
    });
    eur(payload.brokerAccount?.equity, '$.brokerAccount.equity');
    for (const field of FIELDS) {
      const parts = payload.desks.map(d => d.money[field]);
      const total = payload.totals[field];
      if (parts.every(Boolean) && total && parts.reduce((sum, v) => sum + decimalUnits(v.amount), 0n) !== decimalUnits(total.amount)) {
        fail(`$.totals.${field}`, 'deskSum');
      }
      if (parts.some(v => !v) && total) fail(`$.totals.${field}`, 'incompleteDeskSum');
    }
    for (const [kind, field] of [['day', 'dayPnl'], ['open', 'openPnl']]) {
      const source = payload.pnlSources?.[kind];
      const values = [payload.totals[field], ...payload.desks.map(d => d.money[field])];
      if (values.some(Boolean) && (source?.status !== 'available' || !source.method || !source.observedAt)) fail(`$.pnlSources.${kind}`, 'evidenceRequired');
      if (source?.status === 'available' && !values.every(Boolean)) fail(`$.pnlSources.${kind}`, 'completeEvidenceRequired');
      if (source?.status === 'available' && kind === 'day' && !['ib-daily-pnl', 'sod-virtual-equity'].includes(source.method)) fail('$.pnlSources.day', 'dayMethod');
      if (source?.status === 'available' && kind === 'open' && !['ib-unrealized-pnl', 'owned-lots-current-mark-fx'].includes(source.method)) fail('$.pnlSources.open', 'openMethod');
      if (source?.method === 'sod-virtual-equity' && !source.periodStart) fail('$.pnlSources.day.periodStart', 'baselineRequired');
    }
    payload.positions?.rows.forEach((p, i) => {
      if ((KEEP.includes(p.symbol) && p.scope !== 'keep') || (p.scope === 'keep' && p.desk !== null)) fail(`$.positions.rows[${i}]`, 'keepExcluded');
      if (p.scope === 'stage0' && !DESKS.includes(p.desk)) fail(`$.positions.rows[${i}]`, 'deskRequired');
      for (const field of ['mark', 'marketValue', 'dayPnl', 'openPnl']) {
        if (p[field] && p.mark && p[field].currency !== p.mark.currency) fail(`$.positions.rows[${i}].${field}`, 'nativeCurrency');
      }
    });
    const gateway = payload.safety.gateway;
    if (gateway && !gateway.apiSessionReady && !gateway.reason) fail('$.safety.gateway.reason', 'reasonRequired');
    if (gateway?.apiSessionReady && gateway.reason) fail('$.safety.gateway', 'contradictorySession');
    if (payload.safety.halt && !payload.safety.haltReason) fail('$.safety.haltReason', 'reasonRequired');
  }
  if (kind === 'history') {
    let previous = -Infinity;
    payload.points.forEach((p, i) => {
      if (Date.parse(p.t) <= previous) fail(`$.points[${i}].t`, 'strictOrder');
      previous = Date.parse(p.t);
      checkBag(p.totals, `$.points[${i}].totals`);
      Object.entries(p.desks).forEach(([id, d]) => checkBag(d.money, `$.points[${i}].desks.${id}.money`));
    });
  }
  if (kind === 'results') {
    const seen = new Set();
    payload.days.forEach((day, i) => Object.values(day.desks).forEach(d =>
      ['equityClose', 'realisedNet', 'fees'].forEach(f => eur(d[f], `$.days[${i}].${f}`))));
    payload.trades.forEach((t, i) => {
      const at = `$.trades[${i}]`;
      if (seen.has(t.id)) fail(`${at}.id`, 'uniqueTrade');
      seen.add(t.id);
      if (KEEP.includes(t.symbol)) fail(`${at}.symbol`, 'keepExcluded');
      if (Date.parse(t.openedAt) > Date.parse(t.closedAt)) fail(at, 'tradeTimeOrder');
      if (decimalUnits(t.quantity) <= 0n) fail(`${at}.quantity`, 'positive');
      ['grossEur', 'feesEur', 'netEur'].forEach(f => eur(t[f], `${at}.${f}`));
      if (t.entryPrice.currency !== t.exitPrice.currency || t.fx.base !== t.entryPrice.currency) fail(at, 'fxCurrency');
      if (decimalUnits(t.feesEur.amount) < 0n) fail(`${at}.feesEur`, 'nonnegative');
      if (decimalUnits(t.grossEur.amount) - decimalUnits(t.feesEur.amount) !== decimalUnits(t.netEur.amount)) fail(at, 'netAfterFees');
    });
  }
  if (kind === 'healthz') {
    // Strict schema is the allowlist; no free text, money or identifiers.
    for (const [key, feed] of Object.entries(payload.feeds)) {
      if (['stale', 'broken'].includes(feed.state) && !feed.reason) fail(`$.feeds.${key}.reason`, 'reasonRequired');
      if (feed.state === 'fresh' && feed.reason) fail(`$.feeds.${key}`, 'freshWithReason');
      if (feed.state !== 'not reported' && feed.ageSeconds === null && feed.state !== 'broken') fail(`$.feeds.${key}.ageSeconds`, 'ageRequired');
    }
    const coordinate = payload.version.slice(0, 12);
    const instant = `20${coordinate.slice(0, 2)}-${coordinate.slice(2, 4)}-${coordinate.slice(4, 6)}T${coordinate.slice(6, 8)}:${coordinate.slice(8, 10)}:${coordinate.slice(10, 12)}.000Z`;
    if (!Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant) fail('$.version', 'calendarCoordinate');
  }
}
