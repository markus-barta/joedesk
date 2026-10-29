// Shared P3/P5 phone mechanics. Exercise actual buttons before reading details.
// No production test hooks or storage are needed.
import { settle } from './shots.mjs';

// JOED-157: the household summary names its faulty desks. The complete
// reason is stated once across its independent figures, in the title and
// accessible text; a short first-figure warning need not repeat that reason.
export function collapsedMoneySummariesOk(snapshot, neutral) {
  const controls = snapshot.controls.filter(c => ['j', 'joe', 'joel', 'account'].includes(c.key));
  const reason = neutral ? 'not exact' : 'not reported by the broker';
  return controls.map(c => c.key).sort().join() === 'account,j,joe,joel' && controls.every(c => {
    const warning = c.key === 'account' ? `Open result: ${neutral ? 'not exact' : 'unavailable for J, Joe and Joel'}`
      : `Today: ${neutral ? 'not exact' : 'unavailable · not reported by the broker'}`;
    return c.hidden && !c.visible && c.expanded === 'false' && c.warning === warning &&
      c.icon === (neutral ? '#i-info' : '#i-stop') && c.detail.startsWith(warning) && c.detail.includes(reason) &&
      (neutral || c.detail.split(reason).length === 2) && c.accessible === c.detail;
  }) && snapshot.horizontal.scroll <= snapshot.horizontal.inner;
}

export async function setDeskDisclosures(page, open) {
  await page.evaluate(`(() => {
    if (!matchMedia('(max-width: 480px)').matches) return;
    for (const b of document.querySelectorAll('[data-desk-disclosure]')) {
      if (b.getAttribute('aria-expanded') !== ${JSON.stringify(String(open))}) b.click();
    }
  })()`);
  await settle(page);
}

export async function phoneDeskSnapshot(page) {
  return page.evaluate(`(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height, left: r.left, right: r.right }; };
    const controls = [...document.querySelectorAll('[data-desk-disclosure]')];
    const rows = [...document.querySelectorAll('.desk-row')];
    return {
      phone: matchMedia('(max-width: 480px)').matches,
      width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight,
      horizontal: __audit.horizontal(), header: rect(document.querySelector('header.top')),
      bottomBar: rect(document.querySelector('.bottom-nav')),
      primary: [...document.querySelectorAll('#heroL .primary')].map(e => ({ ...rect(e), euros: e.querySelector('.display').innerText, pct: e.querySelector('.pct-slot').innerText })),
      sentence: rect(document.querySelector('#heroL .say')),
      desks: rect(document.querySelector('#desks')),
      // JOED-156: the whole account, first on Desk (JOED-153's slot), open on a
      // phone: its value, change line, Cash and chart, with the gap below it.
      account: (() => { const e = document.getElementById('acctHero'); if (!e) return null;
        const cash = [...e.querySelectorAll('[data-cash]')].find(__audit.visible);
        return { ...rect(e), gap: parseFloat(getComputedStyle(e).marginBottom) || 0, value: e.querySelector('#acctValue').innerText,
          line: e.querySelector('#acctChange [data-clamp]')?.innerText ?? null, chart: rect(e.querySelector('#acctChart')),
          cash: cash ? { ...rect(cash), text: cash.innerText.replace(/\\s+/g, ' ').trim(), name: cash.getAttribute('aria-label'), state: cash.dataset.state } : null }; })(),
      rows: rows.map(e => ({ ...rect(e), key: e.dataset.deskDisclosure, text: e.innerText, icon: Boolean(e.querySelector('.dmark svg')), state: e.querySelector('.compact-word').innerText,
        card: rect(e.closest('.dcard')),
        warningLineBottom: (() => { const w = e.querySelector('.disclosure-warning'); return rect(w).top + parseFloat(getComputedStyle(w).lineHeight); })(),
        values: [...e.querySelectorAll('.compact-figure')].map(v => v.querySelector('.bn').innerText),
        detailValues: [...document.querySelectorAll('#detail-' + e.dataset.deskDisclosure + ' .dnums .v .bn')].filter((v, i) => i !== 1).map(v => v.textContent) })),
      controls: controls.map(e => { const body = document.getElementById(e.getAttribute('aria-controls')), summary = e.querySelector('.summary-text');
        return { ...rect(e), key: e.dataset.deskDisclosure, expanded: e.getAttribute('aria-expanded'), hidden: body.hidden, visible: __audit.visible(body),
          warning: summary?.innerText ?? '', detail: summary?.title ?? '', accessible: e.querySelector('.disclosure-warning .vh')?.textContent ?? '',
          icon: e.querySelector('.disclosure-warning use')?.getAttribute('href') ?? null }; }),
    };
  })()`);
}
