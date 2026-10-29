// JOED-133: source-derived contrast and real builders, using synthetic money.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { validateContract } from '../contracts/index.mjs';
import { sessionBounds } from '../time.mjs';

const { capturedHtml, compareLine } = await builders('history.js', ['capturedHtml', 'compareLine']);
const { marketBlock } = await import('../public/joe/desk.js');
const { toColumns, sharedWindowCompare } = await import('../public/joe/history-model.js');
const { boardStates } = await import('../public/joe/board-state.js');
const { boardHealthPresentation } = await import('../public/joe/health.js');
const { pct } = await import('../public/joe/format.js');
const { TERMS } = await import('../public/joe/terms.js');
const exact = () => JSON.parse(readFileSync(new URL('../fixtures/phase-b.json', import.meta.url))).exact;
const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');

const composite = (color, background) => color.slice(0, 3).map((v, i) => v * color[3] + background[i] * (1 - color[3]));
function rgba(value) {
  if (/^#[a-f0-9]{6}$/i.test(value)) return [...value.slice(1).match(/../g).map(c => parseInt(c, 16)), 1];
  const match = /^rgba\((\d+), (\d+), (\d+), ([.\d]+)\)$/.exec(value);
  assert.ok(match, `supported color: ${value}`);
  return match.slice(1).map(Number);
}
const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

for (const [theme, pattern] of [
  ['light', /:root \{([^}]+)\}/],
  ['system dark', /:root:not\(\[data-theme="light"\]\) \{([^}]+)\}/],
  ['explicit dark', /:root\[data-theme="dark"\] \{([^}]+)\}/],
]) test(`JOED-133 Settings boundaries: ${theme} composites meet 3:1`, t => {
  const tokens = Object.fromEntries([...css.match(pattern)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));
  const color = name => rgba(tokens[name]);
  const canvas = color('--canvas').slice(0, 3);
  // Settings controls sit on the canvas, cards and sunken wake-window rows.
  const backdrops = { canvas, surface: color('--surface').slice(0, 3), card: composite(color('--card'), canvas),
    sunken: composite(color('--sunken'), canvas) };
  for (const selector of ['inp', 'affix', 'stepper']) {
    const rule = css.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))[1];
    const boundary = rule.match(/box-shadow: inset 0 0 0 1px var\((--[\w-]+)\)/)?.[1];
    assert.ok(boundary, `${selector} has a token-based boundary`);
    for (const [name, backdrop] of Object.entries(backdrops)) {
      const field = composite(color('--field-bg'), backdrop), edge = composite(color(boundary), field);
      const inside = contrast(edge, field), outside = contrast(edge, backdrop);
      t.diagnostic(`${selector}/${name}: boundary/field ${inside.toFixed(2)}, boundary/background ${outside.toFixed(2)}`);
      assert.ok(inside >= 3 && outside >= 3, `${selector}/${name}: ${inside.toFixed(2)} / ${outside.toFixed(2)} must be >= 3`);
    }
  }
});

// JOED-153: J's identity colour is plum in every theme. Each desk colour keeps
// 3:1 against every backdrop its mark, line or badge sits on, and J's hue is
// far from the gain green and the loss red, so a desk tint never reads as a result.
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
for (const [theme, pattern, plum] of [
  ['light', /:root \{([^}]+)\}/, '#7b51a8'],
  ['system dark', /:root:not\(\[data-theme="light"\]\) \{([^}]+)\}/, '#c0a2e8'],
  ['explicit dark', /:root\[data-theme="dark"\] \{([^}]+)\}/, '#c0a2e8'],
]) test(`JOED-153 desk colours: ${theme} J is plum, keeps 3:1 and is never a gain or loss hue`, t => {
  const tokens = Object.fromEntries([...css.match(pattern)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));
  const color = name => rgba(tokens[name]);
  assert.equal(tokens['--desk-j'], plum);
  const canvas = color('--canvas').slice(0, 3);
  const backdrops = { canvas, surface: color('--surface').slice(0, 3), card: composite(color('--card'), canvas), sunken: composite(color('--sunken'), canvas) };
  for (const id of ['j', 'joe', 'joel']) for (const [name, backdrop] of Object.entries(backdrops)) {
    const ratio = contrast(color(`--desk-${id}`).slice(0, 3), backdrop);
    t.diagnostic(`${id}/${name}: ${ratio.toFixed(2)}`);
    assert.ok(ratio >= 3, `${id} on ${name}: ${ratio.toFixed(2)} must be >= 3`);
  }
  const j = hue(color('--desk-j').slice(0, 3));
  assert.ok(j >= 260 && j <= 300, `J's hue ${j.toFixed(0)} is plum`);
  for (const result of ['--gain', '--loss']) assert.ok(hueGap(j, hue(color(result).slice(0, 3))) >= 90, `J is far from ${result}`);
});

test('JOED-133 Settings boundaries: forced colors retain a real system-color border', () => {
  const forced = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(forced, /\.inp, \.affix, \.stepper\s*\{[^}]*border: 1px solid CanvasText;/);
  assert.match(forced, /box-shadow: none;/);
  assert.match(forced, /\.affix \.inp\s*\{[^}]*border: 0;/, 'affixed fields keep a single outside boundary');
});

function capturedData(amount, first = amount, last = amount) {
  const data = exact(), desk = data.desks.find(d => d.id === 'j'), end = data.generatedAt;
  const start = new Date(Date.parse(end) - 60000).toISOString();
  const money = amount => ({ amount, currency: 'USD' });
  desk.backfill = { status: 'BEST_AVAILABLE', fullTotalAvailable: false,
    capturedSubtotal: { realizedPnl: amount === null ? null : money(amount), method: 'captured-fifo-matched-roundtrips',
      fromInclusive: start, throughInclusive: end, points: first === null ? [] : [
        { at: start, realizedPnl: money(first) }, { at: end, realizedPnl: money(last) },
      ], pointsTruncated: false, executionCount: 2, commissionCount: 2 },
    coverage: { fromInclusive: start, toExclusive: end, gapCount: 0 }, missingOpeningLotCount: 0, orphanCommissionCount: 0 };
  assert.equal(validateContract('data', data).ok, true, 'synthetic backfill is contract-valid');
  return desk;
}

for (const [amount, expected] of [
  ['1.005', '+$ 1,01'], ['-1.005', '−$ 1,01'],
  ['9007199254740993.005', '+$ 9.007.199.254.740.993,01'],
  ['-9007199254740993.005', '−$ 9.007.199.254.740.993,01'],
  ['0.00499999', '$ 0,00'], ['-0.00499999', '$ 0,00'],
]) test(`JOED-133 captured money: ${amount} keeps exact visible and spoken rounding`, () => {
  const desk = capturedData(amount), original = structuredClone(desk);
  const doc = htmlDocument(capturedHtml(desk));
  assert.equal(doc.querySelector('dd').textContent, `${expected} from 2 fills and 2 commissions`);
  assert.equal(doc.querySelector('svg').getAttribute('aria-label'), `Captured J results in dollars: from ${expected} to ${expected}`);
  assert.deepEqual(desk, original, 'display never changes source money');
});

test('JOED-133 captured money: chart names use their own exact first and last points', () => {
  const doc = htmlDocument(capturedHtml(capturedData('2.005', '-1.005', '3.005')));
  assert.equal(doc.querySelector('dd').textContent, '+$ 2,01 from 2 fills and 2 commissions');
  assert.equal(doc.querySelector('svg').getAttribute('aria-label'), 'Captured J results in dollars: from −$ 1,01 to +$ 3,01');
});

test('JOED-133 captured money: absent subtotal stays a dash, including with points', () => {
  for (const first of [null, '1.005']) {
    const doc = htmlDocument(capturedHtml(capturedData(null, first, first)));
    assert.equal(doc.querySelector('dd').textContent, '— from 2 fills and 2 commissions');
    assert.equal(Boolean(doc.querySelector('svg')), first !== null);
  }
  assert.equal(capturedHtml({}), '');
});

test('JOED-133 percentages: zero at display precision has no sign', () => {
  for (const d of [0, 1, 2, 3]) for (const signed of [false, true]) {
    const zero = `${d ? `0,${'0'.repeat(d)}` : '0'} %`;
    for (const n of [0, -0, .49 * 10 ** -d, -.49 * 10 ** -d, Number.MIN_VALUE, -Number.MIN_VALUE]) {
      assert.equal(pct(n, d, signed), zero, `${n}, precision ${d}, signed ${signed}`);
    }
    const nonzero = `${d ? `0,${'0'.repeat(d - 1)}1` : '1'} %`;
    assert.equal(pct(.51 * 10 ** -d, d, signed), `${signed ? '+' : ''}${nonzero}`);
    assert.equal(pct(-.51 * 10 ** -d, d, signed), `−${nonzero}`);
  }
  for (const n of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(pct(n, 2, true), '—');
});

test('JOED-133 History comparison suppresses signed zero without changing model values', () => {
  const start = Date.parse(exact().generatedAt), end = start + 300000;
  const row = (ms, values) => ({ t: new Date(ms).toISOString(),
    desks: Object.fromEntries(['j', 'joe', 'joel'].map((id, i) => [id, { money: { equity: { amount: values[i], currency: 'EUR' } } }])), totals: {} });
  const cols = toColumns([row(start, ['1000', '1000', '1000']), row(end, ['999.9999', '1000.0001', '1000'])]);
  const model = sharedWindowCompare(cols, ['j', 'joe', 'joel'], [start, end], end);
  assert.equal(model.ok, true);
  assert.ok(model.desks[0].pct < 0 && model.desks[1].pct > 0, 'actual changes remain nonzero');
  // Both measures (JOED-154): a change below half a cent reads € 0,00, unsigned.
  assert.match(compareLine(cols, [start, end], end, 'change').text, /J €\s0,00 · Joe €\s0,00 · Joel €\s0,00$/);
  assert.match(compareLine(cols, [start, end], end, 'money').text, /J €\s1\.000,00 to €\s1\.000,00 · Joe €\s1\.000,00 to €\s1\.000,00 · Joel €\s1\.000,00 to €\s1\.000,00$/);
});

test('JOED-133 Board light help: green allows explained not-exact dashes', () => {
  const data = exact();
  data.desks[0].money.equity = null;
  data.desks[0].money.reasons = { equity: 'not_exact_yet' };
  data.totals.equity = null;
  data.totals.reasons = { equity: 'not_exact_yet' };
  assert.equal(validateContract('data', data).ok, true);
  const feeds = { data: { value: data } }, now = data.receivedAt, states = boardStates(feeds, now);
  assert.equal(states['today.equity'].value, null);
  assert.equal(boardHealthPresentation(states, feeds, now).tone, 'green');
  const help = TERMS.boardok[1];
  assert.match(help, /freshness/);
  assert.match(help, /broker connection/);
  assert.match(help, /safety/);
  assert.match(help, /not exact/);
  assert.doesNotMatch(help, /not exact yet/, 'the board cannot say when a value becomes exact');
  assert.match(help, /explained dashes/);
  assert.doesNotMatch(help, /every number is fresh and complete/);
});

test('JOED-133 Regular session help: normal hours are qualified by holidays and early closes', () => {
  const instant = '2026-11-27T15:00:00.000Z', bounds = sessionBounds(instant);
  assert.equal(bounds.closeAt, '2026-11-27T18:00:00.000Z');
  // JOED-153 M3: the market block's day bar ends the session at the calendar's early close.
  const doc = htmlDocument(marketBlock(instant).html);
  assert.match(doc.textContent, /closes 19:00 · 3\sh left/);
  assert.match(doc.textContent, /Early close today · session 15:30–19:00 Vienna/);
  assert.equal(doc.querySelector('.mkt-s .term').dataset.term, 'session', 'the session help stays one tap away');
  assert.match(doc.querySelector('.daybar').getAttribute('aria-label'), /regular session 15:30 to 19:00; now 16:00$/);
  const help = TERMS.session[1];
  assert.match(help, /[Nn]ormal.*09:30 to 16:00/);
  assert.match(help, /[Hh]olidays and early closes/);
  assert.match(help, /session times shown/);
  assert.match(help, /both clocks/);
});
