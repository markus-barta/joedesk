// Independent browser oracle for the approved Change comparison. The caller
// checks the interval/basis and that both endpoints are actual chart points.
// Keep exact stored units: subtract before rounding to displayed cents.
import { age, dayDDM, timeHM, eur } from '../../public/joe/format.js';

const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
export function historyChangeText(result) {
  if (!result.ok) return null;
  const when = iso => `${dayDDM(iso)}, ${timeHM(iso)}`;
  const figures = result.desks.map(d => `${LABEL[d.id]} ${eur(d.endUnits - d.startUnits, true)}`).join(' · ');
  const lead = result.after
    ? `Change in the last ${age((Date.parse(result.endAt) - Date.parse(result.startAt)) / 1000)} ${result.after === 'incompatible-basis' ? 'on the current bookkeeping' : 'with continuous data'}, from ${when(result.startAt)}`
    : `Change from ${when(result.startAt)} to ${when(result.endAt)}`;
  return `${lead}: ${figures}`;
}
