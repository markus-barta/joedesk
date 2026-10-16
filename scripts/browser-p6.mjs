#!/usr/bin/env node
// Local headless regression and Tick shots; no product review or approval.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, ACTOR, NOW, at } from './browser/board.mjs';
import { designSnapshot, longFleet } from './browser/settings-fixtures.mjs';
import { VIEWPORTS, THEMES, configure, load, settle, waitFor, screenshot } from './browser/shots.mjs';

const output = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p6a');
mkdirSync(output, { recursive: true });
const browser = await launch();
const boards = [], shots = [], checks = [];
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__copies=[]; Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copies.push(text);}},configurable:true});` });
const active = JSON.parse(readFileSync(new URL('../release.json', import.meta.url)));
const test = (name, condition) => { assert.ok(condition, name); checks.push(name); };
try {
  const fleet = longFleet();
  const { snapshot, history } = designSnapshot(NOW);
  const board = await startBoard({ fleetConfig: fleet, history, fleetActions: [] }); boards.push(board);
  board.setNow(NOW); assert.equal((await board.push(snapshot)).status, 200); board.setNow(at(NOW, 9));
  for (const viewport of VIEWPORTS.filter(v => v.name !== '1024')) for (const theme of THEMES) {
    const tag = `${viewport.name}-${theme}`;
    await configure(page, viewport, theme); await load(page, board.url, 'settings');
    await waitFor(page, `document.querySelector('#grp-amy [data-row]')`);
    await page.evaluate(`document.getElementById('set-about').scrollIntoView({block:'center'})`); await settle(page);
    const version = await page.evaluate(`(() => { const e=document.getElementById('appVersion'); return {canonical:e.dataset.canonical,title:e.title,label:e.getAttribute('aria-label'),segments:[...e.children].filter(n=>['yy','mm','dd','hh','mi','ss'].includes(n.className)).length,tail:!!e.querySelector('.tail,.v'),seconds:e.querySelector('.ss').getBoundingClientRect().width,transition:e.querySelector('.ss').style.transition,all:[...document.querySelectorAll('[data-product-version]')].map(n=>n.dataset.canonical)}; })()`);
    test(`${tag}: six-segment shared Pretty with hidden seconds and no decorative v/tail`, version.canonical === active.version && version.segments === 6 && !version.tail && version.seconds === 0 && version.all.length === 2 && version.all.every(v=>v===active.version));
    test(`${tag}: exact canonical coordinate and human UTC in tooltip and accessible name`, version.title.includes(active.version) && version.title.includes('2026-10-16 15:12:18 UTC') && version.label.includes(active.version) && version.label.includes('UTC'));
    await screenshot(page, viewport, join(output, `${tag}-version.png`)); shots.push(`${tag}-version.png`);
    await page.evaluate(`document.getElementById('appVersion').scrollIntoView({block:'center'})`); await settle(page);
    if (viewport.mobile) {
      const p=await page.evaluate(`(()=>{const r=document.getElementById('appVersion').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await page.s('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]}); await page.s('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await page.evaluate(`document.getElementById('appVersion').focus(); document.getElementById('appVersion').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
    }
    await settle(page);
    const reveal=await page.evaluate(`(()=>{const e=document.getElementById('appVersion'),s=e.querySelector('.ss');return{copy:__copies.at(-1),state:e.dataset.copyState,width:s.getBoundingClientRect().width,opacity:Number(s.style.opacity),transition:s.style.transition,tail:!!e.querySelector('.tail,.v')};})()`);
    test(`${tag}: ${viewport.mobile?'touch':'keyboard'} reveals and copies exact canonical .0.0 with English feedback`,reveal.copy===active.version && reveal.state==='copied' && reveal.width>0 && reveal.opacity>=.7 && !reveal.tail);
    test(`${tag}: reduced motion has no reveal transition`,reveal.transition==='none');
    const revealedFile=`${tag}-version-revealed.png`; const revealShot=await page.s('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,revealedFile),Buffer.from(revealShot.data,'base64'));shots.push(revealedFile);
    await new Promise(r=>setTimeout(r,2150)); await settle(page);
    if(viewport.mobile)test(`${tag}: touch returns to rest after confirmation`,await page.evaluate(`document.getElementById('appVersion').dataset.versionView==='pretty'`));
    else {
      await page.s('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'no-preference'}]});
      await page.evaluate(`document.getElementById('appVersion').blur()`);
      await page.s('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      const point=await page.evaluate(`(()=>{const r=document.getElementById('appVersion').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await page.s('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await settle(page);
      test(`${tag}: hover uses the shared one-second ease transition`,await page.evaluate(`document.getElementById('appVersion').querySelector('.ss').style.transition.includes('1000ms')`));
      await page.s('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      await page.s('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});await settle(page);
    }
    await page.evaluate(`document.getElementById('versionMode').click()`);await settle(page);
    test(`${tag}: SemVer displays the complete canonical coordinate`,await page.evaluate(`document.getElementById('appVersion').textContent===${JSON.stringify(active.version)}`));
    const semverFile=`${tag}-version-semver.png`;const semverShot=await page.s('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,semverFile),Buffer.from(semverShot.data,'base64'));shots.push(semverFile);
    await page.evaluate(`document.getElementById('appVersion').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await settle(page);
    test(`${tag}: reduced display reuses shared canonical copy`,await page.evaluate(`__copies.at(-1)===${JSON.stringify(active.version)}`));
    await page.evaluate(`document.getElementById('versionMode').click()`);await settle(page);
    if (!viewport.mobile) {
      for (const [key, value] of [['desks.keep', 'DEMO'], ['amy.routines.close', 'Close recap']]) {
        await page.evaluate(`(() => { const e = document.querySelector('[data-field="${key}"]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      }
      await settle(page);
      const saved = await page.evaluate(`[...document.querySelectorAll('[data-saved].on')].map(e => { const control=document.getElementById('f-' + e.dataset.saved.replace(/[^A-Za-z0-9]/g, '-')), description=document.getElementById(control.getAttribute('aria-describedby')); return {text:e.textContent, title:e.title, description:description?.textContent, hidden:description?.hidden, width:description?.getBoundingClientRect().width, lines:e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight), ellipsis:getComputedStyle(e).textOverflow, clipped:e.scrollWidth>e.clientWidth+1, tab:e.hasAttribute('tabindex')}; })`);
      test(`${tag}: compact kept count`, saved.some(s => s.text === 'Saved: 64 kept symbols'));
      test(`${tag}: strings stay on one line with accessible complete text and no extra tab stop`, saved.length === 2 && saved.every(s => s.lines === 1 && s.ellipsis === 'ellipsis' && s.title === s.text && s.description === s.text && !s.hidden && s.width === 1 && !s.tab));
      const clip = await page.evaluate(`(() => { const e = document.querySelector('[data-saved="amy.routines.close"]'), control=e.closest('.f-in').querySelector('input'); control.focus(); e.focus(); return { controlFocused:document.activeElement===control, clipped:e.scrollWidth>e.clientWidth+1 }; })()`);
      test(`${tag}: clipped Saved text leaves keyboard focus on its field control`, clip.controlFocused && clip.clipped);
      const { root: doc } = await page.s('DOM.getDocument');
      const { nodeId } = await page.s('DOM.querySelector', { nodeId: doc.nodeId, selector: '[data-field="amy.routines.close"]' });
      const { nodes } = await page.s('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      test(`${tag}: accessibility tree exposes the complete Saved description on the input`, nodes.some(n => n.description?.value === saved.find(s => s.clipped)?.text));
      for (const section of ['desks','amy']) {
        await page.evaluate(`document.getElementById('set-${section}').scrollIntoView({block:'center'})`); await settle(page);
        const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
        const file = `${tag}-saved-${section}.png`; writeFileSync(join(output, file), Buffer.from(data, 'base64')); shots.push(file);
      }
      // Compound fields describe their group once; stepper buttons do not
      // repeat the description belonging to the primary input.
      await page.evaluate(`(() => { const e=document.querySelector('[data-field="desks.maxBusyDesks"]'); e.value=String(Number(e.value)+1); e.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-wday="0"]').click(); })()`);
      await settle(page);
      const owners = await page.evaluate(`['desks.maxBusyDesks','cadence.wakeWindows'].map(key => { const e=document.getElementById('f-'+key.replace(/[^A-Za-z0-9]/g,'-')), row=e.closest('[data-row]'), id=e.getAttribute('aria-describedby'); return {key,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),described:[...row.querySelectorAll('[aria-describedby]')].map(n=>n===e),description:document.getElementById(id)?.textContent,caption:row.querySelector('[data-saved]').textContent,hidden:row.querySelector('[data-saved]').getAttribute('aria-hidden')}; })`);
      test(`${tag}: Saved text describes only the primary input or named wake-window group`, owners.every(o=>o.described.length===1 && o.described[0] && o.description===o.caption && o.hidden==='true') && owners[1].role==='group' && !!owners[1].label);
      const { nodeId: groupId } = await page.s('DOM.querySelector', { nodeId: doc.nodeId, selector: '#f-cadence-wakeWindows' });
      const { nodes: groups } = await page.s('Accessibility.getPartialAXTree', { nodeId: groupId, fetchRelatives: false });
      test(`${tag}: accessibility tree gives the wake-window group the complete Saved description`, groups.some(n=>n.role?.value==='group' && n.description?.value===owners[1].description));
      await page.evaluate(`document.getElementById('discardBtn').click()`); await settle(page);
      test(`${tag}: discarding clears Saved descriptions from primary controls and groups`, await page.evaluate(`!document.querySelector('#setMain [aria-describedby]') && [...document.querySelectorAll('#setMain .vh[id$="-saved"]')].every(e=>e.hidden)`));
    } else {
      const stray = await page.evaluate(`(() => { const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT), bad=[]; for(let n=walker.nextNode();n;n=walker.nextNode()) if(/ ·/.test(n.nodeValue) && n.parentElement.getClientRects().length && getComputedStyle(n.parentElement).visibility!=='hidden') bad.push(n.nodeValue); return bad; })()`);
      test(`${tag}: phone spaces before middle dots do not break`, !stray.length);
      test(`${tag}: separator across inline markup also has a nonbreaking space`, await page.evaluate(`document.querySelector('.key-each').previousSibling.nodeValue.endsWith('\\u00a0')`));
      await page.evaluate(`document.getElementById('set-cadence').scrollIntoView({block:'center'})`); await settle(page);
      const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
      const file = `${tag}-phone-separators.png`; writeFileSync(join(output, file), Buffer.from(data, 'base64')); shots.push(file);
    }
    test(`${tag}: no horizontal overflow`, await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    test(`${tag}: no service worker`, !(await page.evaluate(`navigator.serviceWorker?.controller != null`)));
  }
  test('no browser errors', !page.errors.length);
  writeFileSync(join(output, 'results.json'), JSON.stringify({ checks, shots, presentation: 'integrated', candidate: active.version }, null, 2) + '\n');
  writeFileSync(join(output, 'index.md'), `# JOED-26 P6a local screenshots\n\nSynthetic fixtures; one headless browser, no production connection. ${checks.length} regression checks passed.\n\nCandidate ${active.version}, sequence 24. Shared global presentation pinned to INSPR-486's reviewed 01b3080948c21899cbbacbfa3447da6799af1b56 bundle. Pretty draws six segments; canonical copy/UTC accessibility, SemVer, reduced motion and keyboard/touch are tested. Tick/coordinator review, producer/OPS compatibility and Markus's cutover remain outstanding.\n\n${shots.map(s => `- [${s}](./${s})`).join('\n')}\n`);
  console.log(JSON.stringify({ checks: checks.length, screenshots: shots.length, presentation: 'integrated' }));
} finally {
  await browser.close(); for (const board of boards) await board.close();
}
