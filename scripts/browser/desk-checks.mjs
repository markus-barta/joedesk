// Pure parts of P3's Desk checks (deskChecks), importable without a browser,
// so a unit test holds their expectations against the page's own render.
// JOED-153 gate finding 7: AC-9 read a hero figure that had moved to the
// whole-account slot, and threw before the later groups. Import this after
// the page-module resolve hooks: it formats with the page's own format.js.
import { digits } from '../../public/joe/format.js';
import { divRound, UNIT } from '../../contracts/decimal.mjs';

// A percentage as the page writes it: sign, two decimals, a no-break space, %.
export function percentText(result, base) {
  const n = divRound(result * 10000n, base);
  return `${n < 0n ? '−' : n > 0n ? '+' : ''}${digits(n * UNIT / 100n)} %`;
}

// AC-9 on the design scenario: the kept holdings count only in the paper
// account. The kept section says so with the account's amount, the desks'
// money leaves them out, and the paper account (the whole-account slot's
// first figure) includes them. `d` is deskChecks' reading of the page.
export const keptOnlyInAccount = d => /Left out of every desk result and of Results; counted in the paper account \(€\s31\.482,75\)/.test(d.keptCap ?? '') &&
  /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(d.keptState ?? '') &&
  d.kpis?.[1]?.value?.replace(/\s/g, '') === '€14.997,18' && d.slot?.[0]?.value?.replace(/\s/g, '') === '€31.482,75';
