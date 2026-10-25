// Shared P3/P5 CI scenarios. No browser is launched by importing this module.
import { readFileSync } from 'node:fs';
import { configure, load, waitFor, VIEWPORTS, THEMES } from './shots.mjs';
import { setDeskDisclosures } from './desk-disclosures.mjs';
import { ingress, at } from './board.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/phase-b.json', import.meta.url)));
export async function phaseBChecks({ page, newBoard, check, shot, auditScreen, mixed = false }) {
  for (const viewport of [...VIEWPORTS, { ...VIEWPORTS[2], name: '360', width: 360 }]) for (const theme of THEMES) {
    const data = fixtures[mixed ? 'mixed' : 'exact'];
    const b = await newBoard(); b.setNow(data.generatedAt);
    const accepted = await b.push(ingress(data));
    const tag = `${viewport.name} ${theme} Phase B ${mixed ? 'mixed' : 'exact'}`;
    check('phase-b', `${tag}: real ingress accepts rev 10`, accepted.status === 200, accepted.body);
    await configure(page, viewport, theme);
    await load(page, b.url);
    await setDeskDisclosures(page, true);
    const inspect = () => page.evaluate(`(() => {
      const text = selector => document.querySelector(selector)?.innerText.replace(/\\s/g, '') ?? '';
      return {
        day: text('[data-cell="hero.day"] .bn'), since: text('[data-cell="hero.since"] .bn'),
        percentages: [...document.querySelectorAll('#heroL .performance-pct')].map(e => e.textContent.replace(/\\s/g, '')),
        j: document.querySelector('#desk-j .desk-detail')?.innerText,
        joe: document.querySelector('#desk-joe .desk-detail')?.innerText,
        joel: text('#desk-joel .dnums'),
        positions: text('#positions'),
        kept: text('#kept'),
        positionReason: document.querySelector('#positions .pstate')?.innerText,
        nulls: [...document.querySelectorAll('#positions .position-value')].map(e => ({ text: e.textContent, label: e.getAttribute('aria-label'), title: e.title })),
        keeps: [...document.querySelectorAll('[data-keep]')].map(e => ({ symbol: e.dataset.keep, actions: e.querySelectorAll('button, a, input, [tabindex]').length })),
        overflow: document.documentElement.scrollWidth > innerWidth,
        mode: document.getElementById('modeLabel')?.innerText,
      };
    })()`);
    let result = await inspect();
    if (mixed) {
      check('phase-b', `${tag}: incomplete totals stay dashes with no percentage`, result.day === '—' && result.since === '—' && result.percentages.length === 0, result);
      check('phase-b', `${tag}: independent exact desk survives ledger and SOD failures`, /desk ledger not reconciled/.test(result.j) && /start-of-day value missing/.test(result.joe) && result.joel.includes('+€5,00'), result);
      check('phase-b', `${tag}: stale conid has accessible nulls and one section reason; the fresh conid keeps its worth`,
        result.nulls.length > 0 && result.nulls.every(n => n.text === '—' && n.label === n.title && /position update is old/.test(n.label)) &&
        /position update is old/.test(result.positionReason) && result.positions.includes('$40,01') && !result.positions.includes('$30,02'), result);
      if (viewport.width !== 360) await auditScreen(page, viewport, theme, 'desk Phase B mixed');
      await shot(page, viewport, `${viewport.name}-${theme}-desk-phase-b-mixed`, 'Synthetic ledger, SOD and per-conid callback failures beside exact values');
      const recovered = ingress(fixtures.exact); recovered.seq++; recovered.generatedAt = at(data.generatedAt, 30);
      b.setNow(recovered.generatedAt);
      const recovery = await b.push(recovered);
      check('phase-b', `${tag}: exact recovery accepted`, recovery.status === 200, recovery.body);
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, `document.querySelectorAll('#heroL .performance-pct').length === 2`);
      result = await inspect();
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
    await shot(page, viewport, `${viewport.name}-${theme}-desk-phase-b-${mixed ? 'recovered' : 'exact'}`, 'Synthetic exact desk money and native position values; KEEP is account-level');
  }
}
