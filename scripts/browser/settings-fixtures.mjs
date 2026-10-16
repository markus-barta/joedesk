// Test-only: the fleet settings of the approved design (version 12, two wake
// windows, one host secret reference), its change log, and the snapshot with
// the producer-masked paper account hint. Never shipped, never under public/.
import { valid, scenario, NOW, at } from './board.mjs';
import { validateContract } from '../../contracts/index.mjs';

export function designFleet() {
  const c = structuredClone(valid['fleet-config']);
  Object.assign(c, { rev: 'fc-000012', updatedAt: '2026-10-09T18:12:44.000Z' });
  c.quota.codex.reservePct = 15;
  c.cadence.wakeWindows = [
    { id: 'us-session', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:25', until: '22:05', desks: ['j', 'joe', 'joel'] },
    { id: 'eu-morning', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:55', until: '11:30', desks: ['joel'] },
  ];
  c.secretSlots.agenix = ['joe-board-push-token'];
  const checked = validateContract('fleet-config', c);
  if (!checked.ok) throw new Error(`design fleet settings invalid: ${JSON.stringify(checked.errors.slice(0, 3))}`);
  return c;
}

// The longest values the settings format accepts (test-only): 64 kept
// holdings of 16 characters (a 1.133-character Saved line), 64-character
// routine names and 80-character check-in names.
export function longFleet() {
  const c = designFleet();
  c.desks.keep = ['SXR8', 'TSLA', ...Array.from({ length: 62 }, (_, i) => `LONGSYMBOL${String(i).padStart(2, '0')}.XYZ`)];
  c.cadence.deskWatch = 'desk-watch-routine-for-the-paper-learning-desks-on-the-host-zero';
  c.cadence.darwin = 'learning-review-routine-for-what-the-paper-desks-learned-in-day';
  c.amy.routines.morning = 'Morning check-in: the limits for today, the work that matters and any guardrails';
  c.amy.routines.close = 'Close of day: the useful result of each desk, without a noisy activity feed here';
  const checked = validateContract('fleet-config', c);
  if (!checked.ok) throw new Error(`long fleet settings invalid: ${JSON.stringify(checked.errors.slice(0, 3))}`);
  return c;
}

// The log the design shows: two sends, a conflict that was not sent, an older send.
export function designActions() {
  return [
    { id: 'fa-1758902520000-0a1b2c3d', at: '2026-09-26T07:02:00.000Z', actor: 'markus', revBefore: 'fc-000009', revAfter: 'fc-000010', changedKeys: ['desks.stage0.capEur', 'desks.keep'], outcome: 'success', reason: 'propagated' },
    { id: 'fa-1759423260000-1b2c3d4e', at: '2026-10-02T16:41:00.000Z', actor: 'markus', revBefore: 'fc-000010', revAfter: 'fc-000011', changedKeys: ['cadence.wakeWindows'], outcome: 'success', reason: 'propagated' },
    { id: 'fa-1760033400000-2c3d4e5f', at: '2026-10-09T18:10:00.000Z', actor: 'markus', revBefore: 'fc-000011', revAfter: 'fc-000011', changedKeys: ['desks.maxBusyDesks'], outcome: 'failure', reason: 'revision_conflict' },
    { id: 'fa-1760033564000-3d4e5f60', at: '2026-10-09T18:12:44.000Z', actor: 'markus', revBefore: 'fc-000011', revAfter: 'fc-000012', changedKeys: ['desks.maxBusyDesks', 'quota.codex.reservePct'], outcome: 'success', reason: 'propagated' },
  ];
}

// The design snapshot with the paper account hint, masked by the producer.
export function designSnapshot(now = NOW, { hint = 'DU…0597', executor = true } = {}) {
  const { snapshot, history } = scenario(now);
  if (hint) snapshot.brokerAccount.accountHint = hint;
  if (!executor) delete snapshot.safety.executor;
  return { snapshot, history };
}

export { at, NOW };
