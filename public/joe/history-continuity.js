// Optional provenance beside the unchanged History contract. Claims name an
// exact adjacent pair of kept observations, never an inferred cadence.
export const CONTINUITY_SCHEMA = 'joedesk.history-continuity.v1';
export const CONTINUITY_CAP = 1024 * 1024;
export const emptyContinuity = (historySeq = null) => ({ schema: CONTINUITY_SCHEMA, historySeq, intervals: [] });
const instant = t => typeof t === 'string' && t.length === 24 && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t;

export function validContinuity(value) {
  if (!value || value.schema !== CONTINUITY_SCHEMA ||
      Object.keys(value).some(k => !['schema', 'historySeq', 'intervals'].includes(k)) ||
      !(value.historySeq === null || (Number.isSafeInteger(value.historySeq) && value.historySeq > 0)) ||
      !Array.isArray(value.intervals) || value.intervals.length > 10000) return false;
  let previous = null;
  for (const pair of value.intervals) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(instant) || pair[0] >= pair[1] ||
        (previous !== null && pair[0] < previous)) return false;
    previous = pair[1];
  }
  return true;
}

export function continuityClaims(value, historySeq = value?.historySeq) {
  return new Set(validContinuity(value) && value.historySeq === historySeq
    ? value.intervals.map(([a, b]) => `${a}/${b}`) : []);
}
