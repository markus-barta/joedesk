// JOED-83's original computation, retained independently of the cached path
// for equality tests and the offline model benchmark. Never shipped.
import * as M from '../../public/joe/results-model.js';
import { STARTING_MONEY, percentOf } from '../../public/joe/performance.js';

export function priorRollupBase(ix, inputs, per, desks) {
  if (!ix || desks.length !== M.DESK_IDS.length || !M.DESK_IDS.every(id => desks.includes(id))) return null;
  if (per.p === 'all' || per.start <= ix.meta.trackingStart) return STARTING_MONEY;
  const before = { p: 'all', start: ix.meta.trackingStart, end: M.addDays(per.start, -1) };
  const prior = M.rollup(ix, before, desks, M.moneyContext(ix, inputs, before, desks));
  if (prior.cut || prior.net === null || typeof prior.units.net !== 'bigint') return null;
  const base = STARTING_MONEY + prior.units.net;
  return base > 0n ? base : null;
}

export function priorRollupPercent(ix, inputs, per, desks, result) {
  if (!result || result.cut || result.empty || result.net == null || typeof result.units?.net !== 'bigint') return null;
  return percentOf(result.units.net, priorRollupBase(ix, inputs, per, desks));
}
