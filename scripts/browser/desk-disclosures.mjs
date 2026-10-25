// Shared P3/P5 phone mechanics. Exercise actual buttons before reading details.
// No production test hooks or storage are needed.
import { settle } from './shots.mjs';

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
      rows: rows.map(e => ({ ...rect(e), key: e.dataset.deskDisclosure, text: e.innerText, icon: Boolean(e.querySelector('.dmark svg')), state: e.querySelector('.compact-word').innerText,
        card: rect(e.closest('.dcard')),
        warningLineBottom: (() => { const w = e.querySelector('.disclosure-warning'); return rect(w).top + parseFloat(getComputedStyle(w).lineHeight); })(),
        values: [...e.querySelectorAll('.compact-figure')].map(v => v.querySelector('.bn').innerText),
        detailValues: [...document.querySelectorAll('#detail-' + e.dataset.deskDisclosure + ' .dnums .v .bn')].filter((v, i) => i !== 1).map(v => v.textContent) })),
      controls: controls.map(e => { const body = document.getElementById(e.getAttribute('aria-controls')), summary = e.querySelector('.summary-text');
        return { ...rect(e), key: e.dataset.deskDisclosure, expanded: e.getAttribute('aria-expanded'), hidden: body.hidden, visible: __audit.visible(body),
          warning: summary?.innerText ?? '', detail: summary?.title ?? '', icon: e.querySelector('.disclosure-warning use')?.getAttribute('href') ?? null }; }),
    };
  })()`);
}
