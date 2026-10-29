// JOED-156: the account history endpoint's shape (docs/joe-history-contract.md)
// and the board's states around the valid snapshot, shared by the account
// model and hero tests. Value-free in meaning: made-up exact amounts.
import { readFileSync } from 'node:fs';
import './preview-dom.mjs';

const { boardStates } = await import('../../public/joe/board-state.js');
export const valid = JSON.parse(readFileSync(new URL('../../fixtures/valid.json', import.meta.url)));
export const words = text => String(text).replace(/\u00a0/g, ' ');

export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
export const iso = ms => new Date(ms).toISOString();

// The endpoint's shape (docs/joe-history-contract.md), value-free in meaning.
export const point = (ms, amount, reason = 'gateway_down') => ({ t: iso(ms), account: amount === null
  ? { observedAt: iso(ms), equity: null, cash: null, reasons: { equity: reason, cash: reason } }
  : { observedAt: iso(ms), equity: { amount, currency: 'EUR' }, cash: { amount: '4212.77', currency: 'EUR' } } });
export const close = (day, at, amount) => ({ day, t: at, equity: { amount, currency: 'EUR' }, cash: null, equityAt: at, cashAt: null });
export const body = (points, days, extra = {}) => ({ schema: 'inspr.joe.account-history.v1', generatedAt: points.at(-1)?.t ?? null, receivedAt: points.at(-1)?.t ?? null,
  reason: null, points, dailyCloses: { schema: 'inspr.joe.account-closes.v1', timeZone: 'Europe/Vienna', days, reason: null, ...extra.daily }, ...extra.short });

// The board's time in the fixtures: five seconds after the valid snapshot.
export const SNAP = Date.parse(valid.data.receivedAt), NOW = SNAP + 5000;
// Three days of five-minute snapshots up to the snapshot, with a two-hour
// outage (no points) and one unavailable value; 40 days of closes with one
// day missing. Amounts are exact decimal strings.
export function history() {
  const points = [];
  for (let t = SNAP - 3 * DAY, i = 0; t < SNAP; t += 5 * MIN, i++) {
    if (t >= Date.parse('2026-10-13T10:00:00.000Z') && t < Date.parse('2026-10-13T12:00:00.000Z')) continue;
    points.push(point(t, t === Date.parse('2026-10-14T09:02:22.000Z') ? null : (27000 + i * 0.5).toFixed(2)));
  }
  const days = [];
  for (let k = 39; k >= 0; k--) {
    const day = iso(SNAP - k * DAY).slice(0, 10);
    if (day === '2026-10-01') continue;
    const at = k === 0 ? '2026-10-14T17:30:00.000Z' : `${day}T19:30:00.000Z`;
    days.push(close(day, at, (26000 + (39 - k) * 25).toFixed(2)));
  }
  return body(points, days);
}

export const ctxFor = ({ now = NOW, mutate, previous } = {}) => {
  const data = structuredClone(valid.data);
  mutate?.(data);
  const feeds = { data: { value: data }, 'fleet-config': { value: structuredClone(valid['fleet-config']) } };
  return { feeds, now: iso(now), states: boardStates(feeds, iso(now), previous) };
};
