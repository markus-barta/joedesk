// JOED-153 in a real browser: Desk beside the design Results record, in the
// regular session and before the next open. Every card's last ten sessions
// (M4) are Results' per-desk Day figures; before the open the hero and the
// cards show the last session from the trade record (A2). Shared by P3;
// importing it launches nothing. Import it after the page-module resolve
// hooks (browser-p3.mjs registers them): it reads the page's own model.
import { scenario, NOW, at, ACTOR } from './board.mjs';
import { designResults } from './results.mjs';
import { VIEWPORTS, THEMES, configure, load, settle, waitFor } from './shots.mjs';
import { setDeskDisclosures } from './desk-disclosures.mjs';
import { sessionDayName } from '../../time.mjs';
import { decimalUnits } from '../../contracts/decimal.mjs';
import * as M from '../../public/joe/results-model.js';
import * as hm from '../../public/joe/history-model.js';
import { eur } from '../../public/joe/format.js';
import { percentOf } from '../../public/joe/performance.js';
import { barLabel, resultsHref, percentHtml } from '../../public/joe/desk.js';

const DESKS = ['j', 'joe', 'joel'];
// Thu 15 Oct 2026, 04:00 in New York: before the open, Desk shows Wednesday.
export const BEFORE_OPEN = '2026-10-15T08:00:00.000Z';
// The ten regular sessions on the bars at both times (the market is open on
// Columbus Day, 12 Oct). At NOW the last one is today's live bar.
export const SESSIONS = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];

const words = text => String(text ?? '').replace(/\s+/g, ' ').trim();
// Amounts compare without their spaces: the figure markup puts none after €.
const bare = text => String(text ?? '').replace(/\s+/g, '');

// What Desk must show, from the record and the page's inputs through Results'
// own model (as P4's expected()): each desk's Day figure per session; live,
// today's bar from the desk's exact Today; before the open, the household's
// last session with Results' base for that day.
export function expectedSessions({ record, snapshot, points, nowMs, live }) {
  const ix = M.indexResults(record), today = M.viennaDate(nowMs), ts = ix.meta.trackingStart;
  const deskOf = id => snapshot.desks.find(d => d.id === id);
  const todayUnits = DESKS.map(id => { const e = deskOf(id)?.money.equity; return e ? decimalUnits(e.amount) : null; });
  const cols = hm.toColumns(points);
  const current = Object.fromEntries(DESKS.map((id, i) => [id, todayUnits[i] === null ? null : deskOf(id)]));
  const inputs = { today, todayUnits, nowMs, cols, cuts: M.basisCuts(cols, current, nowMs) };
  const dayOf = (k, desks) => {
    const per = M.periodOf('day', k, today, ts);
    return { per, R: M.rollup(ix, per, desks, M.moneyContext(ix, inputs, per, desks)) };
  };
  const bars = Object.fromEntries(DESKS.map(id => [id, SESSIONS.map((k, i) => {
    const href = resultsHref('day', k, id);
    if (live && i === SESSIONS.length - 1) {
      const units = decimalUnits(deskOf(id).money.dayPnl.amount);
      return { day: k, today: true, href, units, label: barLabel(units), name: `Today · ${sessionDayName(k)}: ${eur(units, true)}, so far · after fees` };
    }
    const units = dayOf(k, [id]).R.units.net;
    return { day: k, today: false, href, units, label: units === null ? null : barLabel(units),
      name: `${sessionDayName(k)}: ${units === null ? '' : eur(units, true)}, after fees · from Results` };
  })]));
  let last = null;
  if (!live) {
    const k = SESSIONS.at(-1), { per, R } = dayOf(k, DESKS), base = M.periodBase(ix, inputs, per, DESKS);
    last = { day: k, units: R.units.net, base, percent: percentOf(R.units.net, base),
      desks: Object.fromEntries(DESKS.map(id => [id, dayOf(k, [id]).R.units.net])) };
  }
  return { bars, last };
}

// The page's bars, labels, zero lines and (before the open) the dated hero
// and card figures, as rectangles and words.
const readDesk = page => page.evaluate(`(() => {
  const rect = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const shown = e => { if (!e || !e.getClientRects().length) return false; const s = getComputedStyle(e); return s.display !== 'none' && s.visibility === 'visible'; };
  const words = e => (e?.innerText ?? e?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const hero = document.querySelector('#heroL [data-cell="hero.day"]');
  const slot = document.getElementById('sessSlot');
  const desks = {};
  for (const id of ['j', 'joe', 'joel']) {
    const card = document.getElementById('desk-' + id), box = card?.querySelector('.bars:not(.bars-why)');
    const first = card?.querySelector('.desk-detail .dnums > div');
    desks[id] = {
      card: rect(card), why: words(card?.querySelector('.bars-why')),
      first: first ? { label: words(first.querySelector('.k')), value: words(first.querySelector('.v .bn')), href: first.querySelector('.v a.fig-link')?.getAttribute('href') ?? null } : null,
      axis: [...(card?.querySelectorAll('.bars-ax span') ?? [])].map(s => words(s)),
      box: rect(box), zero: rect(box?.querySelector('.bz')), need: box ? Number(box.dataset.need) : null,
      bars: box ? [...box.querySelectorAll('a.b')].map(a => {
        const i = a.querySelector('i'), inner = a.querySelector('.bl.in'), outer = a.querySelector('.bl.out');
        const label = shown(inner) ? inner : shown(outer) ? outer : null, s = getComputedStyle(i);
        return { href: a.getAttribute('href'), name: a.getAttribute('aria-label'), today: a.classList.contains('today'), tone: i.className,
          bar: rect(i), fill: s.backgroundColor, ring: s.boxShadow, keep: Boolean(outer?.classList.contains('keep')),
          text: (inner ?? outer)?.textContent ?? null, label: label ? { inside: label === inner, ...rect(label) } : null };
      }) : [],
    };
  }
  return {
    width: innerWidth, phase: document.getElementById('deskHero')?.dataset.phase ?? null,
    hero: hero ? { phase: hero.dataset.phase, label: words(hero.querySelector('.hero-k')), value: words(hero.querySelector('.display .bn')),
      href: hero.querySelector('.display a.fig-link')?.getAttribute('href') ?? null, pct: words(hero.querySelector('.pct-slot .performance-pct')),
      basis: (hero.querySelector('.pct-slot .basis')?.textContent ?? '').replace(/\\s+/g, ' ').trim() } : null,
    slot: slot ? { display: getComputedStyle(slot).display, height: slot.getBoundingClientRect().height } : null,
    chartHidden: document.getElementById('heroChart')?.hidden ?? null,
    desks,
  };
})()`);

// The tip of one bar under keyboard focus: focus its neighbour, then Tab or
// Shift+Tab onto it, so the bar matches :focus-visible as a keyboard user's would.
async function focusBar(page, id, index) {
  const from = index === 0 ? 1 : index - 1;
  await page.evaluate(`document.querySelectorAll('#desk-${id} .bars a.b')[${from}].focus()`);
  const shift = index === 0;
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
  await settle(page);
  return page.evaluate(`(() => {
    const a = document.querySelectorAll('#desk-${id} .bars a.b')[${index}], tip = a.querySelector('.bt'), card = document.getElementById('desk-${id}');
    const outer = a.querySelector('.bl.out'), inner = a.querySelector('.bl.in');
    const shown = e => Boolean(e && e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility === 'visible');
    const r = tip.getBoundingClientRect(), c = card.getBoundingClientRect();
    return { focused: document.activeElement === a && a.matches(':focus-visible'), tip: shown(tip), text: tip.textContent.replace(/\\s+/g, ' ').trim(),
      label: shown(outer) || shown(inner), inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.left >= 0 && r.right <= document.documentElement.clientWidth };
  })()`);
}

const alpha = color => { const m = color.match(/^rgba\(.*,\s*([\d.]+)\)$/) ?? color.match(/\/\s*([\d.]+)\)$/); return m ? Number(m[1]) : 1; };
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

export async function deskSessionChecks({ page, newBoard, check, shot, auditScreen }) {
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const when of [NOW, BEFORE_OPEN]) {
    const live = when === NOW, phase = live ? 'live' : 'before the open';
    const { snapshot, history } = scenario(when);
    const b = await newBoard({ history });
    b.setNow(when);
    const pushed = await b.push(snapshot);
    check('M4', `sessions ${phase}: the design snapshot is accepted`, pushed.status === 200, pushed.body);
    const record = designResults(when); delete record.receivedAt;
    const accepted = await b.pushResults(record);
    check('M4', `sessions ${phase}: the design Results record is accepted`, accepted.status === 200, accepted.body);
    b.setNow(at(when, 9));
    const served = await (await fetch(`${b.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    const want = expectedSessions({ record: { ...record, receivedAt: accepted.body.receivedAt ?? when }, snapshot, points: served.points, nowMs: Date.parse(at(when, 9)), live });
    for (const viewport of [...VIEWPORTS, { ...VIEWPORTS[2], name: '360', width: 360 }]) for (const theme of THEMES) {
      const tag = `${viewport.name} ${theme} sessions ${phase}`;
      await configure(page, viewport, theme);
      await load(page, b.url, 'desk');
      await setDeskDisclosures(page, true);
      await waitFor(page, `document.querySelectorAll('.dcard .bars a.b').length === 30`);
      await settle(page);
      const r = await readDesk(page);
      // Check details are logged as JSON: no BigInt in them.
      const facts = id => ({ id, bars: r.desks[id].bars.map(x => ({ href: x.href, name: x.name, text: x.text, today: x.today, label: x.label })),
        want: want.bars[id].map(w => ({ ...w, units: String(w.units) })) });
      check('M4', `${tag}: every card draws its last ten sessions, each opening Results for that day and desk`,
        DESKS.every(id => r.desks[id].bars.length === 10 && r.desks[id].bars.every((x, i) => x.href === want.bars[id][i].href && x.today === want.bars[id][i].today)), DESKS.map(facts));
      check('M4', `${tag}: each bar is Results’ Day figure for its desk, today’s the desk’s live Today`,
        DESKS.every(id => r.desks[id].bars.every((x, i) => x.name === want.bars[id][i].name && x.text === want.bars[id][i].label)), DESKS.map(facts));
      // Own scale, sign colours, from one zero line: gains end on it, losses start on it.
      const scale = DESKS.map(id => {
        const d = r.desks[id], ws = want.bars[id];
        const gains = d.bars.filter((x, i) => ws[i].units > 0n), losses = d.bars.filter((x, i) => ws[i].units < 0n);
        const tall = Math.max(0, ...gains.map(x => x.bar.h)) + Math.max(0, ...losses.map(x => x.bar.h));
        return { id, tall, zero: d.zero?.t, tones: d.bars.map((x, i) => [x.tone, String(ws[i].units)]),
          ok: d.bars.every((x, i) => { const u = ws[i].units, tone = u > 0n ? 'gain' : u < 0n ? 'loss' : 'flat';
            return x.tone.split(' ').includes(tone) && (u > 0n ? Math.abs(x.bar.b - d.zero.t) <= 0.6 : u < 0n ? Math.abs(x.bar.t - d.zero.t) <= 0.6 : true); }) && Math.abs(tall - 50) <= 1 };
      });
      check('M4', `${tag}: every card is on its own scale, sign-coloured, from its zero line`, scale.every(s => s.ok), scale);
      if (live) {
        const todays = DESKS.map(id => { const x = r.desks[id].bars.at(-1); return { id, tone: x.tone, h: x.bar.h, alpha: alpha(x.fill), ring: x.ring, label: x.label, keep: x.keep }; });
        check('M4', `${tag}: today’s bar is filled at 60 % with an outline, at least 3 px, and keeps its label outside`,
          todays.every(t => /\blive\b/.test(t.tone) && t.h >= 2.95 && Math.abs(t.alpha - 0.6) <= 0.02 && /inset/.test(t.ring) && t.keep && t.label && !t.label.inside), todays);
      } else {
        check('M4', `${tag}: before the open no bar is today’s and the axis ends on the last session`,
          DESKS.every(id => r.desks[id].bars.every(x => !x.today) && r.desks[id].axis.at(-1) === words(sessionDayName(SESSIONS.at(-1)))), DESKS.map(id => ({ id, axis: r.desks[id].axis })));
      }
      // Labels: inside the bar when shown there, else at its x across zero;
      // none collide; the extremes and today's are always shown.
      const labels = DESKS.map(id => {
        const d = r.desks[id], ws = want.bars[id], seen = d.bars.filter(x => x.label);
        const placed = d.bars.every((x, i) => {
          if (!x.label) return true;
          const L = x.label, mid = (x.bar.l + x.bar.r) / 2;
          if (L.inside) return L.l >= x.bar.l - 0.5 && L.r <= x.bar.r + 0.5 && L.t >= x.bar.t - 0.5 && L.b <= x.bar.b + 0.5;
          return Math.abs((L.l + L.r) / 2 - mid) <= 1 && (ws[i].units > 0n ? L.t >= d.zero.b - 0.5 : L.b <= d.zero.t + 0.5);
        });
        const clashes = [];
        for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) if (overlap(seen[i].label, seen[j].label) > 0.5) clashes.push([seen[i].text, seen[j].text]);
        const boxWidth = d.box.w, all = d.bars.every(x => x.label);
        return { id, placed, clashes, kept: d.bars.every(x => !x.keep || x.label), all, need: d.need, boxWidth,
          ok: placed && !clashes.length && d.bars.every(x => !x.keep || x.label) && (boxWidth <= d.need - 0.02 || all) };
      });
      check('M4', `${tag}: every bar carries its value inside or across zero, labels never collide, and the extremes and today keep theirs`, labels.every(l => l.ok), labels);
      // The craft audit with the bars drawn (the 390 px audit is the phone reference).
      if (viewport.width !== 360) await auditScreen(page, viewport, theme, `desk sessions ${phase}`);
      await shot(page, viewport, `${viewport.name}-${theme}-desk-sessions-${live ? 'live' : 'before-open'}`, `Desk with the design Results record, ${phase}`);
      // Keyboard focus shows the date and the exact amount, on the card.
      const tips = [];
      for (const index of [0, 4, 9]) {
        const t = await focusBar(page, 'joe', index), w = want.bars.joe[index];
        tips.push({ index, ...t, want: words(`${w.today ? `Today · ${sessionDayName(w.day)}` : sessionDayName(w.day)} · ${eur(w.units, true)}`) });
      }
      check('M4', `${tag}: keyboard focus on a bar shows its label and a tip with the date and the exact amount, inside the card`,
        tips.every(t => t.focused && t.tip && t.label && t.inside && t.text.startsWith(t.want)), tips);
      await page.evaluate('document.activeElement?.blur()');
      if (!live) {
        const hero = r.hero, last = want.last;
        check('A2', `${tag}: before the open the hero shows the last session from Results with its base`,
          r.phase === 'last' && hero?.phase === 'last' && hero.label === words(`Last session · ${sessionDayName(last.day)}`) && bare(hero.value) === bare(eur(last.units, true)) &&
          hero.href === resultsHref('day', last.day, 'all') && hero.basis === words(`of ${eur(last.base)}`) && hero.pct === words(percentHtml(last.percent).replace(/<[^>]+>/g, '')),
          { hero, want: { units: String(last.units), base: String(last.base), percent: String(last.percent) } });
        check('A2', `${tag}: before the open each card’s first figure is its last session from Results`,
          DESKS.every(id => { const f = r.desks[id].first; return f && f.label.startsWith(words(sessionDayName(last.day))) && bare(f.value) === bare(eur(last.desks[id], true)) && f.href === resultsHref('day', last.day, id); }),
          DESKS.map(id => ({ id, first: r.desks[id].first, want: String(last.desks[id]) })));
        check('M3', `${tag}: before the open the session line keeps no space and draws nothing`, r.slot?.display === 'none' && r.chartHidden === true, r.slot);
      }
    }
    if (!live) continue;
    // Stale (no update for 75 s): Today is no longer current, so today's bar
    // becomes the dashed outline without a number, like every other derived
    // amount; the past sessions keep Results' figures.
    b.setNow(at(when, 75));
    await configure(page, VIEWPORTS[0], 'light');
    await load(page, b.url, 'desk');
    await waitFor(page, `document.querySelector('#hdrHealth').dataset.reason === 'snapshot_stale' && document.querySelectorAll('.dcard .bars a.b').length === 30`);
    await settle(page);
    const stale = await page.evaluate(`[...document.querySelectorAll('.dcard')].map(c => {
      const bars = [...c.querySelectorAll('.bars a.b')], t = bars.at(-1);
      return { id: c.id.slice(5), n: bars.length, today: Boolean(t?.classList.contains('today')), dashed: Boolean(t?.querySelector('i.nx')), live: Boolean(t?.querySelector('i.live')),
        labels: t ? t.querySelectorAll('.bl').length : -1, name: t?.getAttribute('aria-label') ?? null, past: bars.slice(0, -1).map(a => a.getAttribute('aria-label')) };
    })`);
    check('M4', 'sessions stale: today’s bar turns into a dashed outline without a number; the past sessions keep Results’ figures',
      stale.length === 3 && stale.every(x => x.n === 10 && x.today && x.dashed && !x.live && x.labels === 0 && x.name?.startsWith(`Today · ${sessionDayName(SESSIONS.at(-1))}: `) && !x.name.includes('€') &&
        JSON.stringify(x.past) === JSON.stringify(want.bars[x.id].slice(0, -1).map(w => w.name))), stale);
  }
}
