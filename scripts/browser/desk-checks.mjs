// Pure parts of P3's Desk checks (deskChecks), importable without a browser,
// so a unit test holds their expectations against the page's own render.
// JOED-153 gate finding 7: AC-9 read a hero figure that had moved to the
// whole-account slot, and threw before the later groups (the slot is the
// whole-account block's since JOED-156). Import this after
// the page-module resolve hooks: it formats with the page's own format.js.
import { digits } from '../../public/joe/format.js';
import { divRound, UNIT } from '../../contracts/decimal.mjs';
import { copyText } from './shots.mjs';
import { boardCaptionCell, sharesBoardCaption, sharedSectionReason, sharedSectionPhrase, householdPnlReason } from '../../public/joe/desk.js';
import { waitingOnPrices, absentPnl } from '../../public/joe/board-state.js';
import { statePhrase } from '../../public/joe/ui.js';
import { capital, cellReason } from '../../public/joe/health.js';

const HERO_PANELS = { 'hero.day': 'today.dayPnl', 'hero.open': 'today.openPnl', 'hero.since': 'today.totalPnl', 'hero.equity': 'today.equity' };
// Expected copy and its owner in the fixture walk. Use the approved household
// classifier for desk attribution, retaining the exact comparison of words.
export function heroProblemCaption(ctx, key) {
  const { states, feeds } = ctx, cell = states[HERO_PANELS[key]], board = boardCaptionCell(ctx);
  const shared = sharedSectionReason(Object.values(HERO_PANELS).map(panel => states[panel]));
  const onBoard = sharesBoardCaption(cell, board), inSection = cell.reason && cellReason(cell.reason) === shared;
  const sectionOnBoard = inSection && board?.reason && cellReason(board.reason) === shared;
  const field = { 'hero.day': 'dayPnl', 'hero.open': 'openPnl' }[key];
  const household = field && !onBoard ? householdPnlReason(states, feeds.data?.value, field, shared) ??
    (key === 'hero.open' && feeds.data?.value && absentPnl(states, feeds.data.value, field) ? 'Unavailable' : null) : null;
  const text = onBoard || sectionOnBoard ? capital(statePhrase(board, '').text)
    : inSection ? sharedSectionPhrase(cell) : household ?? (key === 'hero.open' && waitingOnPrices(cell) ? 'Waiting on prices' : capital(statePhrase(cell, '', 'last good value', shared).text));
  return { section: Boolean(onBoard || inSection), text };
}

// The journey's separate reasons stay local. Open's pending broker prices
// use JOED-157's waiting words; Today gives its reason once, in its caption.
export const brokenJourneyTotalsOk = ui => {
  const { cells, account, say } = copyText(ui);
  return cells['hero.day'].state === 'broken' && cells['hero.day'].cap === 'Not exact · waiting on the start-of-day value' &&
    say === 'No desk has an exact result for today.' && cells['hero.open'].state === 'broken' && cells['hero.open'].cap === 'Waiting on prices' &&
    cells['hero.since'].state === 'broken' && cells['hero.since'].cap === 'Unavailable · desk total incomplete' &&
    cells['hero.equity'].state === 'fresh' && account.state === 'fresh' && account.line === null;
};

// A percentage as the page writes it: sign, two decimals, a no-break space, %.
export function percentText(result, base) {
  const n = divRound(result * 10000n, base);
  return `${n < 0n ? '−' : n > 0n ? '+' : ''}${digits(n * UNIT / 100n)} %`;
}

// AC-9 on the design scenario: the kept holdings count only in the paper
// account. The kept section says so with the account's amount, the desks'
// money leaves them out, and the paper account (the whole-account block's
// value above the hero, JOED-156) includes them. `d` is deskChecks' reading
// of the page.
export const keptOnlyInAccount = d => /Left out of every desk result and of Results; counted in the paper account \(€\s31\.482,75\)/.test(d.keptCap ?? '') &&
  /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(d.keptState ?? '') &&
  d.kpis?.[1]?.value?.replace(/\s/g, '') === '€14.997,18' && d.account?.value?.replace(/\s/g, '') === '€31.482,75';
