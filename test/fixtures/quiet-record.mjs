// Test-only: a complete closed-trade record with no trade at all, from the
// board's start (10 Sep 2026) through the day before `today`, every session
// summarised and nothing partial or missing. With it every desk proves "no
// trades since 10 Sep" and Desk shows its card as one row (JOED-153 M5), so
// the exhaustive Today and Open oracles can run through that branch too.
// Import it after preview-dom.mjs: it indexes with the page's own model.
import { validateContract } from '../../contracts/index.mjs';
import { sessionBounds, zonedInstant, NY } from '../../time.mjs';

const START = '2026-09-10';
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
const money = amount => ({ amount, currency: 'EUR' });

export async function quietResults(today, receivedAt) {
  const { indexResults } = await import('../../public/joe/results-model.js');
  const days = [];
  for (let day = START; day < today; day = addDays(day, 1)) {
    if (!sessionBounds(zonedInstant(day, '12:00:00', NY)).openAt) continue;
    days.push({ date: day, desks: Object.fromEntries(['j', 'joe', 'joel'].map(id => [id, { equityClose: money('5000'), realisedNet: money('0'), fees: money('0'), trades: 0 }])) });
  }
  const value = { schema: 'inspr.joe.household.results.v2', seq: 1, generatedAt: receivedAt, receivedAt, currency: 'EUR', timeZone: 'Europe/Vienna',
    trackingStart: START, days, trades: [], benchmark: null };
  const checked = validateContract('results', value);
  if (!checked.ok) throw new Error(`quiet record invalid: ${JSON.stringify(checked.errors.slice(0, 3))}`);
  const index = indexResults(value);
  return { feed: { value: { ...index.meta, index } }, state: { state: 'fresh', value: { ...index.meta, index }, reason: null, retained: false, ageSeconds: 9 } };
}
// The same view with that record: Desk then shows every desk as one row.
export const withQuietRecord = (view, quiet) => ({ ...view, feeds: { ...view.feeds, results: quiet.feed }, states: { ...view.states, results: quiet.state } });
