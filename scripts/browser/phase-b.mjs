// Shared P3/P5 CI scenarios. No browser is launched by importing this module.
import { readFileSync } from 'node:fs';
import { configure, load, settle, waitFor, copyText, VIEWPORTS, THEMES } from './shots.mjs';
import { WIDE_FONT } from './gate.mjs';
import { setDeskDisclosures } from './desk-disclosures.mjs';
import { ingress, at, advance } from './board.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/phase-b.json', import.meta.url)));

export function deskRankingSnapshot(data) {
  const next = advance(data, at(data.generatedAt, 10), data.seq + 1, { cents: [0, 0, 0] });
  const joe = next.desks.find(d => d.id === 'joe');
  joe.money.totalPnl.amount = '300'; joe.money.equity.amount = '5300';
  next.totals.totalPnl.amount = '475'; next.totals.equity.amount = '15475';
  return next;
}

// A ranking refresh changes Joe only, so J's existing button identity is a
// strict check of reordering, independent of the content-rebuild handoff.
export async function deskRankingFocusChecks({ page, newBoard, check }) {
  for (const viewport of VIEWPORTS.filter(v => v.name !== '1024')) for (const theme of THEMES) {
    for (const mode of ['focused-term', 'pinned-tip', ...(viewport.mobile ? ['phone-row'] : [])]) {
      const tag = `${viewport.name} ${theme} ${mode} ranking refresh`;
      const b = await newBoard(), data = ingress(fixtures.exact);
      b.setNow(data.generatedAt);
      check('AC-33', `${tag}: initial snapshot accepted`, (await b.push(data)).status === 200);
      await configure(page, viewport, theme);
      await load(page, b.url);
      await setDeskDisclosures(page, mode !== 'phone-row');
      // Clicking disclosures can leave focus in the grid; settle the initial
      // ranking before deliberately taking ownership of the moving J card.
      await page.evaluate(`document.activeElement.blur(); document.body.click(); window.__joedesk.refresh()`);
      await waitFor(page, `[...document.querySelector('.desk-grid').children].map(e => e.id).join() === 'desk-j,desk-joel,desk-joe'`);
      const selector = mode === 'phone-row' ? '#desk-j .desk-row' : '#desk-j [data-term="today"]';
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await settle(page);
      await page.evaluate(`(() => {
        window.__rankAnchor = document.querySelector(${JSON.stringify(selector)});
        if (${JSON.stringify(mode)} === 'pinned-tip') {
          document.activeElement.blur(); __rankAnchor.click();
        } else __rankAnchor.focus({preventScroll:true});
      })()`);
      await settle(page);
      const inspect = () => page.evaluate(`(() => {
        const a = window.__rankAnchor, tip = document.getElementById('tip');
        const rect = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
        return { connected: a.isConnected, focused: document.activeElement === a,
          tip: tip.classList.contains('on'), pinned: tip.classList.contains('pinned'),
          described: a.getAttribute('aria-describedby'), expanded: a.getAttribute('aria-expanded'),
          tipRect: rect(tip), anchorRect: rect(a), scroll: [scrollX, scrollY],
          cards: [...document.querySelector('.desk-grid').children].map(e => [e.id, ...rect(e)]),
          joe: document.querySelector('#desk-joe .dnums').textContent.replace(/\\s/g, '') };
      })()`);
      const before = await inspect();
      check('AC-33', `${tag}: interaction is active before refresh`, before.connected &&
        (mode === 'pinned-tip' ? !before.focused && before.tip && before.pinned : before.focused) &&
        (mode === 'phone-row' || before.tip && before.described === 'tip' && before.expanded === 'true'), before);
      const next = deskRankingSnapshot(data);
      b.setNow(next.generatedAt);
      const accepted = await b.push(next);
      check('AC-33', `${tag}: changed ranking accepted`, accepted.status === 200, accepted.body);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.querySelector('#desk-joe .dnums').textContent.replace(/\\s/g, '').includes('+€300,00')`);
      await settle(page);
      const after = await inspect();
      check('AC-33', `${tag}: refreshed values keep the identical focused button and open tip anchor`, after.connected &&
        (mode === 'pinned-tip' ? !after.focused && after.pinned : after.focused) &&
        (mode === 'phone-row' || after.tip && after.described === 'tip' && after.expanded === 'true' &&
          JSON.stringify(after.tipRect) === JSON.stringify(before.tipRect)) && after.joe.includes('+€300,00'), { before, after });
      check('no-shift', `${tag}: deferred ranking causes zero card movement or scroll jump`,
        JSON.stringify(after.cards) === JSON.stringify(before.cards) &&
        JSON.stringify(after.anchorRect) === JSON.stringify(before.anchorRect) &&
        JSON.stringify(after.scroll) === JSON.stringify(before.scroll), { before, after });
      await page.evaluate(`document.activeElement.blur(); document.body.click(); window.__joedesk.refresh()`);
      await waitFor(page, `[...document.querySelector('.desk-grid').children].map(e => e.id).join() === 'desk-joe,desk-j,desk-joel'`);
      check('AC-33', `${tag}: latest ranking applies after focus and tip leave`, await page.evaluate(`
        !document.querySelector('.desk-grid').contains(document.activeElement) && !document.getElementById('tip').classList.contains('on')`));
    }
  }
}

// The mixed snapshot's header, Details and desk evidence, read the same way
// at every width. On phones the page joins "·" to the word before it with a
// no-break space (app.js), so visible text compares through copyText; names
// and titles are attributes and are compared as they are.
export const mixedHeaderOk = result => result.headerTone === 'warn' && result.headerReason === 'open_unavailable_rth' &&
  /Desk values are not exact(?! yet)/.test(result.details) &&
  copyText(result.details).includes('Exact for Joel; not exact for J · desk ledger not reconciled; not exact for Joe · start-of-day value missing') &&
  !/Today: not exact/.test(result.details);
export const mixedDesksOk = result => /desk ledger not reconciled/.test(result.j) &&
  result.joeDay?.name === 'Today: not exact · start-of-day value missing' && result.joeDay.title === result.joeDay.name &&
  !/start-of-day value missing/.test(result.joe) && copyText(result.joeStatus) === 'since start · last sessions' && result.joel.includes('+€5,00');

export async function phaseBChecks({ page, newBoard, check, shot, auditScreen, mixed = false }) {
  for (const viewport of [...VIEWPORTS, { ...VIEWPORTS[2], name: '360', width: 360 }]) for (const theme of THEMES) for (const font of [null, WIDE_FONT]) {
    const data = fixtures[mixed ? 'mixed' : 'exact'];
    const b = await newBoard(); b.setNow(data.generatedAt);
    const accepted = await b.push(ingress(data));
    const fontTag = font ? '-wide' : '';
    const tag = `${viewport.name} ${theme}${fontTag} Phase B ${mixed ? 'mixed' : 'exact'}`;
    check('phase-b', `${tag}: real ingress accepts rev 10`, accepted.status === 200, accepted.body);
    await configure(page, viewport, theme);
    await load(page, b.url);
    await setDeskDisclosures(page, true);
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
    const geometry = () => page.evaluate(`__audit.rects(['.dnums > div', '.dnums .v', '.dnums .v > .bn'])`);
    const before = await geometry();
    const moneyContained = async state => {
      const money = await page.evaluate(`Array.from(document.querySelectorAll('.dnums .v > .bn'), el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
        return { text: el.textContent, left: text.left - box.left, right: box.right - text.right, height: box.height };
      })`);
      check('AC-36', `${tag} ${state}: every detail amount fits its own fixed line`, money.length === 9 &&
        money.every(m => m.left >= 0 && m.right >= 0 && m.height === 26), money);
    };
    await moneyContained('initial');
    const inspect = () => page.evaluate(`(() => {
      const text = selector => document.querySelector(selector)?.innerText.replace(/\\s/g, '') ?? '';
      return {
        day: text('[data-cell="hero.day"] .bn'), since: text('[data-cell="hero.since"] .bn'),
        percentages: [...document.querySelectorAll('#heroL .performance-pct')].map(e => e.textContent.replace(/\\s/g, '')),
        j: document.querySelector('#desk-j .desk-detail')?.innerText,
        joe: document.querySelector('#desk-joe .desk-detail')?.innerText,
        joeDay: (() => { const dash = document.querySelector('#desk-joe .desk-detail .dnums .bn'); return dash ? { name: dash.getAttribute('aria-label'), title: dash.title } : null; })(),
        joeStatus: document.querySelector('#desk-joe .mini-label')?.innerText,
        joel: text('#desk-joel .dnums'),
        positions: text('#positions'),
        kept: text('#kept'),
        positionReason: document.querySelector('#positions .pstate')?.innerText,
        nulls: [...document.querySelectorAll('#positions .position-value')].map(e => ({ text: e.textContent, label: e.getAttribute('aria-label'), title: e.title })),
        keeps: [...document.querySelectorAll('[data-keep]')].map(e => ({ symbol: e.dataset.keep, actions: e.querySelectorAll('button, a, input, [tabindex]').length })),
        overflow: document.documentElement.scrollWidth > innerWidth,
        mode: document.getElementById('modeLabel')?.innerText,
        headerTone: document.getElementById('hdrHealth')?.dataset.tone,
        headerReason: document.getElementById('hdrHealth')?.dataset.reason,
        details: document.getElementById('healthPop')?.textContent,
      };
    })()`);
    let result = await inspect();
    if (mixed) {
      // Amy's A3: the not-exact Today no longer warns; J's not-exact open result keeps the regular-hours warning.
      check('phase-b', `${tag}: withheld values keep the open-result warning, never a red header, with the not-exact status facts`, mixedHeaderOk(result), result);
      check('phase-b', `${tag}: incomplete totals stay dashes with no percentage`, result.day === '—' && result.since === '—' && result.percentages.length === 0, result);
      // JOED-148: Joe's lone not-exact Today keeps its reason on its own dash; the card adds no line.
      check('phase-b', `${tag}: independent exact desk survives ledger and SOD failures`, mixedDesksOk(result), result);
      check('phase-b', `${tag}: stale conid has accessible nulls and one section reason; the fresh conid keeps its worth`,
        result.nulls.length > 0 && result.nulls.every(n => n.text === '—' && n.label === n.title && /position update is old/.test(n.label)) &&
        /position update is old/.test(result.positionReason) && result.positions.includes('$40,01') && !result.positions.includes('$30,02'), result);
      if (viewport.width !== 360) await auditScreen(page, viewport, theme, 'desk Phase B mixed');
      await shot(page, viewport, `${viewport.name}-${theme}${fontTag}-desk-phase-b-mixed`, 'Synthetic ledger, SOD and per-conid callback failures beside exact values');
      const recovered = ingress(fixtures.exact); recovered.seq++; recovered.generatedAt = at(data.generatedAt, 30);
      b.setNow(recovered.generatedAt);
      const recovery = await b.push(recovered);
      check('phase-b', `${tag}: exact recovery accepted`, recovery.status === 200, recovery.body);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.querySelectorAll('#heroL .performance-pct').length === 2`);
      await settle(page);
      result = await inspect();
      await moneyContained('recovered');
      check('no-shift', `${tag}: mixed to recovered detail money has exactly 0 px layout shift`,
        JSON.stringify(before) === JSON.stringify(await geometry()));
    }
    check('phase-b', `${tag}: exact totals render Today and Since start in euros and percent`,
      result.day === '+€50,00' && result.since === '+€150,00' && result.percentages.join() === '+0,33%,+1,00%', result);
    check('phase-b', `${tag}: exact native position values, PAPER and inert account-level KEEP survive`,
      result.positions.includes('$20,01') && result.positions.includes('$40,01') && result.positions.includes('+$5,01') && result.positions.includes('−$0,01') &&
      result.kept.includes('Worth€600,01and$200,01now') &&
      result.keeps.map(k => k.symbol).join() === 'SXR8,TSLA' && result.keeps.every(k => k.actions === 0) && /PAPER/i.test(result.mode), result);
    check('phase-b', `${tag}: no horizontal overflow`, !result.overflow, result);
    // The shared audit's phone geometry is explicitly the 390 px reference.
    // The 360 px case above asserts its actual overflow and field behavior.
    if (viewport.width !== 360) await auditScreen(page, viewport, theme, `desk Phase B ${mixed ? 'recovered' : 'exact'}`);
    await shot(page, viewport, `${viewport.name}-${theme}${fontTag}-desk-phase-b-${mixed ? 'recovered' : 'exact'}`, 'Synthetic exact desk money and native position values; KEEP is account-level');
  }
}
