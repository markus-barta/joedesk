// JOED-156: the whole account's model as pure functions: the endpoint's two
// series, the live edge, ranges, honest coverage, exact changes, gaps, the
// tooltip's nearest value and the time axis on Vienna wall-clock ticks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN, HOUR, DAY, iso, valid, words, point, close, body, SNAP, NOW, history, ctxFor } from './fixtures/account-fixtures.mjs';

const M = await import('../public/joe/account-model.js');
const { decimalUnits } = await import('../contracts/decimal.mjs');

test('JOED-167 account calendar: repeated draws preserve consecutive closes across leap days, years and DST', () => {
  for (const days of [
    ['2024-02-28', '2024-02-29', '2024-03-01'], ['2026-02-28', '2026-03-01', '2026-03-02'],
    ['2026-12-31', '2027-01-01', '2027-01-02'], ['2026-03-28', '2026-03-29', '2026-03-30'],
    ['2026-10-24', '2026-10-25', '2026-10-26'],
  ]) {
    const closes = days.map(day => close(day, `${day}T19:30:00.000Z`, '100.00'));
    for (const gap of [false, true]) {
      const series = M.acceptAccountHistory(body([], gap ? [closes[0], closes[2]] : closes)).daily;
      const window = [series.t[0], series.t.at(-1)];
      const first = M.chartPoints(series, window, window[1]);
      assert.equal(first.bands.length, gap ? 1 : 0, `${days}: ${gap ? 'missing day stays a gap' : 'consecutive days join'}`);
      assert.deepEqual(M.chartPoints(series, window, window[1]), first, 'a cached successor preserves the drawing');
    }
  }
});

test('JOED-156 model: the endpoint becomes two typed series; anything off the documented shape is refused', () => {
  const h = M.acceptAccountHistory(history());
  assert.equal(h.short.source, 'short');
  assert.equal(h.daily.source, 'daily');
  assert.ok(h.short.t.length > 800 && h.daily.t.length === 39);
  const gap = h.short.v.findIndex(Number.isNaN);
  assert.ok(gap > 0 && h.short.u[gap] === 0n && M.reasonAt(h.short, gap) === 'gateway_down' && M.reasonAt(h.short, gap - 1) === null, 'an unavailable value is a gap with its reason, never a value');
  assert.equal(h.short.u[0], decimalUnits('27000.00'), 'exact amounts are kept, as units');
  // Compact columns, each with its own buffer, ready to transfer from a worker.
  assert.ok(h.short.t instanceof Float64Array && h.short.v instanceof Float64Array && h.short.u instanceof BigInt64Array && h.short.why instanceof Uint8Array);
  assert.ok(h.daily.t instanceof Float64Array && Array.isArray(h.daily.day) && h.short.day === null);
  const buffers = M.accountTransferables(h);
  assert.equal(buffers.length, 8);
  assert.equal(new Set(buffers).size, 8, 'no buffer twice');
  assert.deepEqual(h.daily.day.slice(-2), ['2026-10-13', '2026-10-14']);
  assert.ok(!h.daily.day.includes('2026-10-01'), 'a missing day stays missing');
  // A day that recorded only cash has no account value.
  const cashOnly = history();
  cashOnly.dailyCloses.days[0] = { ...cashOnly.dailyCloses.days[0], equity: null, equityAt: null, cash: { amount: '1', currency: 'EUR' }, cashAt: cashOnly.dailyCloses.days[0].t };
  assert.equal(M.acceptAccountHistory(cashOnly).daily.t.length, 38);
  const bad = [
    b => { b.schema = 'inspr.joe.account-history.v2'; },
    b => { b.points.reverse(); },
    b => { b.points[3].account.equity = { amount: '1e5', currency: 'EUR' }; },
    b => { b.points[3].account.equity = { amount: '100', currency: 'USD' }; },
    b => { b.points[3].t = '2026-10-12 10:00'; },
    b => { b.dailyCloses.days.reverse(); },
    b => { b.dailyCloses.days[2].equityAt = b.dailyCloses.days[3].equityAt; },
    b => { b.points[3].account.equity = { amount: '92233720369', currency: 'EUR' }; },
    b => { delete b.dailyCloses; },
  ];
  for (const change of bad) { const b = history(); change(b); assert.throws(() => M.acceptAccountHistory(b), /contract_invalid/); }
  const lost = history();
  lost.dailyCloses.reason = 'contract_invalid';
  lost.dailyCloses.discontinuity = { at: '2026-10-12T08:00:00.000Z', reason: 'contract_invalid', preservedAs: 'account-closes-state.json.damaged-x' };
  lost.reason = 'history_write_failed';
  const seen = M.acceptAccountHistory(lost);
  assert.deepEqual([seen.short.reason, seen.daily.reason, seen.daily.loss?.at], ['history_write_failed', 'contract_invalid', '2026-10-12T08:00:00.000Z']);
});


test('JOED-156 model: only a current, exact account value joins the chart, after the last snapshot or as today’s close so far', () => {
  const ctx = ctxFor();
  const live = M.liveObservation(ctx.states.paperAccount, ctx.feeds.data.value);
  assert.deepEqual(live, { t: SNAP, observedAt: valid.data.brokerAccount.observedAt, amount: '28000' });
  // Stale, not exact, unavailable or observed after the snapshot: nothing joins.
  assert.equal(M.liveObservation(ctxFor({ now: SNAP + 75000 }).states.paperAccount, ctx.feeds.data.value), null, 'a stale value is never the live edge');
  const notExact = ctxFor({ mutate: d => { d.brokerAccount = { ...d.brokerAccount, equity: null, reason: 'not_exact_yet' }; } });
  assert.equal(M.liveObservation(notExact.states.paperAccount, notExact.feeds.data.value), null);
  assert.equal(M.liveObservation(ctx.states.paperAccount, { ...ctx.feeds.data.value, brokerAccount: { ...ctx.feeds.data.value.brokerAccount, observedAt: iso(SNAP + 1000) } }), null);
  const h = M.acceptAccountHistory(history());
  const short = M.withLive(h.short, live);
  assert.deepEqual([short.t.at(-1), short.u.at(-1), short.live, short.t.length], [SNAP, decimalUnits('28000'), SNAP, h.short.t.length + 1]);
  assert.ok(short.u instanceof BigInt64Array && short.why.at(-1) === 0, 'still compact columns');
  assert.equal(M.withLive(short, live), short, 'the same snapshot never joins twice');
  assert.equal(M.withLive(h.short, { ...live, t: h.short.t.at(-1) }), h.short, 'nor one the server already recorded');
  const daily = M.withLive(h.daily, live);
  assert.deepEqual([daily.t.length, daily.day.at(-1), daily.u.at(-1), daily.t.at(-1)], [h.daily.t.length, '2026-10-14', decimalUnits('28000'), SNAP], 'today’s close so far is replaced');
  const older = M.withLive(h.daily, { ...live, observedAt: '2026-10-14T17:00:00.000Z' });
  assert.equal(older, h.daily, 'an older observation never replaces a newer close');
  const nextDay = M.withLive(h.daily, { t: SNAP + DAY, observedAt: iso(SNAP + DAY), amount: '28100.5' });
  assert.deepEqual([nextDay.t.length, nextDay.day.at(-1)], [h.daily.t.length + 1, '2026-10-15']);
  assert.equal(M.withLive(h.daily, null), h.daily);
  const none = M.emptySeries('short');
  assert.equal(M.withLive(none, live), none, 'the live value alone is no history');
});

test('JOED-156 model: ranges end now; YTD starts at Vienna midnight on 1 January; a range longer than the record shows all of it', () => {
  const full = [Date.parse('2024-03-01T00:00:00.000Z'), NOW];
  for (const [range, span] of [['1D', DAY], ['5D', 5 * DAY], ['1M', 30 * DAY], ['6M', 182 * DAY], ['1Y', 365 * DAY]]) {
    assert.deepEqual(M.presetWindow(full, range), [NOW - span, NOW], range);
  }
  assert.deepEqual(M.presetWindow(full, 'YTD'), [Date.parse('2025-12-31T23:00:00.000Z'), NOW], 'Vienna is UTC+1 on 1 January');
  assert.deepEqual(M.presetWindow(full, 'All'), full);
  const short = [NOW - 3 * DAY, NOW];
  assert.deepEqual(M.presetWindow(short, '5D'), short, 'five days asked, three recorded: all three');
  assert.deepEqual(M.presetWindow(short, '1D'), [NOW - DAY, NOW]);
  // A moved window follows the newest value only while it ends there.
  assert.deepEqual(M.accountWindow(short, { range: '1D', view: [NOW - 2 * DAY, NOW - DAY], follow: false }), [NOW - 2 * DAY, NOW - DAY]);
  assert.deepEqual(M.accountWindow(short, { range: '1D', view: [NOW - 2 * DAY, NOW - DAY], follow: true }), [NOW - DAY, NOW]);
  assert.equal(M.windowRange(short, [NOW - DAY, NOW], 'short', '1D'), '1D');
  assert.equal(M.windowRange(short, short, 'short', '5D'), '5D', 'the chosen range wins when two ranges show the same window');
  assert.equal(M.windowRange(short, [NOW - DAY - HOUR, NOW - HOUR], 'short', '1D'), null, 'a window in the past is no range');
  assert.deepEqual(M.RANGES, ['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All']);
  assert.deepEqual(M.RANGES.map(M.sourceOf), ['short', 'short', 'daily', 'daily', 'daily', 'daily', 'daily']);
});

test('JOED-156 model: a range without enough history says since when it records, never extrapolates', () => {
  const h = M.acceptAccountHistory(history());
  const say = (series, range, now = NOW) => words(M.recordingText(M.coverage(series, range, now), series.source, now));
  assert.equal(say(h.daily, '1M'), '', 'a month is recorded');
  assert.equal(say(h.daily, '6M'), 'Recording since 5 Sep · 39 days so far');
  assert.equal(say(h.daily, 'YTD'), 'Recording since 5 Sep · 39 days so far');
  assert.equal(say(h.daily, 'All'), '', 'All is everything recorded');
  assert.equal(say(h.short, '1D'), '');
  assert.equal(say(h.short, '5D'), 'Recording since 11 Oct, 19:42 · 3 days so far');
  const one = M.sliceSeries(h.daily, h.daily.t.length - 1, h.daily.t.length);
  assert.equal(say(one, '1M'), 'Recording since 14 Oct · 1 day so far');
  const fresh = M.sliceSeries(h.short, h.short.t.length - 30, h.short.t.length);
  assert.equal(say(fresh, '1D'), 'Recording since 14 Oct, 17:12 · 2 h so far');
  assert.deepEqual(M.coverage(M.emptySeries('daily'), '1M', NOW), { recorded: false, complete: false });
  for (const text of [say(h.daily, '6M'), say(h.short, '5D'), 'Recording since 30 Sep, 23:59 · 23 h so far', `Recording since 30 Sep · 2196 days so far`]) {
    assert.ok(words(text).length <= 56, `fits two phone lines: ${text}`);
  }
  for (const reason of ['history_write_failed', 'store_version_unsupported', 'contract_invalid', 'feed_not_received', null]) {
    const note = M.storeNote({ reason, loss: null });
    assert.ok(note.length <= 56, note);
    assert.equal(Boolean(note), ['history_write_failed', 'store_version_unsupported', 'contract_invalid'].includes(reason));
  }
  assert.equal(words(M.storeNote({ reason: 'contract_invalid', loss: { at: '2026-10-12T08:00:00.000Z' } })), 'Recording restarted 12 Oct after the store was damaged');
});

test('JOED-156 model: the change over a window is exact, from the value standing at its start', () => {
  const h = M.acceptAccountHistory(history());
  const live = { t: SNAP, observedAt: valid.data.brokerAccount.observedAt, amount: '28000' };
  const daily = M.withLive(h.daily, live);
  const month = M.rangeChange(daily, M.presetWindow([daily.t[0], NOW], '1M'));
  // The month starts on 14 Sep 19:42; the 13 Sep close stands for it.
  assert.equal(iso(month.from), '2026-09-13T19:30:00.000Z');
  assert.equal(month.to, SNAP);
  assert.equal(month.startUnits, decimalUnits('26200.00'));
  assert.equal(month.change, decimalUnits('28000') - decimalUnits('26200.00'));
  assert.equal(month.pct, 687n, '1.800 of 26.200 is 6,87 % (half away from zero)');
  assert.equal(month.fromStart, true);
  // Six months: the record starts later, so the change says from when.
  const half = M.rangeChange(daily, M.presetWindow([daily.t[0], NOW], '6M'));
  assert.deepEqual([iso(half.from), half.fromStart], ['2026-09-05T19:30:00.000Z', true], 'the window is the record, which starts there');
  // A window starting inside a gap starts at the first value inside it.
  const short = M.withLive(h.short, live);
  const outage = [Date.parse('2026-10-13T11:00:00.000Z'), SNAP];
  const after = M.rangeChange(short, outage);
  assert.deepEqual([iso(after.from), after.fromStart], ['2026-10-13T12:02:22.000Z', false]);
  const one = M.sliceSeries(short, short.t.length - 1, short.t.length);
  assert.equal(M.rangeChange(one, [SNAP - HOUR, SNAP]), null, 'one value is no change');
  assert.equal(M.rangeChange(M.emptySeries('short'), [0, 1]), null);
  // A short window still starts at the value standing at its start.
  assert.equal(iso(M.rangeChange(short, [SNAP - 1000, SNAP]).from), iso(SNAP - 5 * MIN));
});

test('JOED-156 model: Since start uses the Settings start exactly; percentages are hundredths, signed with a true minus', () => {
  const s = M.sinceStart(decimalUnits('985100.10'), { amountEur: 1000000, date: '2025-06-02' });
  assert.equal(s.change, decimalUnits('-14899.90'));
  assert.equal(s.pct, -149n);
  assert.equal(words(M.pctText(s.pct)), '−1,49 %');
  assert.equal(words(M.pctText(675n)), '+6,75 %');
  assert.equal(words(M.pctText(0n)), '0,00 %');
  assert.equal(M.pctText(null), '—');
  assert.equal(M.sinceStart(decimalUnits('12.34'), { amountEur: 12.34, date: '2024-02-29' }).change, 0n);
  assert.equal(M.sinceStart(null, { amountEur: 1, date: '2024-02-29' }), null, 'no value, no figure');
  assert.equal(M.sinceStart(decimalUnits('1'), null), null, 'no start, no figure');
});

test('JOED-156 model: gaps break the line and are hatched; values are never joined across them or drawn past the last one', () => {
  const h = M.acceptAccountHistory(history());
  const short = h.short;
  const day = [SNAP - 2 * DAY, SNAP];
  const { pts, bands } = M.chartPoints(short, day, NOW);
  const breaks = pts.filter(p => p.v === null);
  assert.ok(breaks.length >= 2, 'the outage and the unavailable value each break the line');
  const outage = bands.find(([a, b]) => a < Date.parse('2026-10-13T10:00:00.000Z') && b > Date.parse('2026-10-13T12:00:00.000Z'));
  assert.ok(outage && outage[1] - outage[0] < 2 * HOUR + 10 * MIN, 'the two-hour outage is one band between the values around it');
  const unavailable = bands.find(([a, b]) => a < Date.parse('2026-10-14T09:02:22.000Z') && b > Date.parse('2026-10-14T09:02:22.000Z'));
  assert.ok(unavailable && unavailable[1] - unavailable[0] === 10 * MIN, 'one unavailable value: a band from the value before to the one after');
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v === null || pts[i - 1].v === null) continue;
    assert.ok(pts[i].x - pts[i - 1].x <= M.SHORT_GAP_MS, 'joined values are at most the gap rule apart');
  }
  // Stopped recording: a band from the last value to now, and no line there.
  const stopped = M.chartPoints(short, [SNAP - DAY, SNAP + 3 * HOUR], SNAP + 3 * HOUR);
  assert.deepEqual(stopped.bands.at(-1), [short.t.at(-1), SNAP + 3 * HOUR]);
  assert.ok(stopped.pts.filter(p => p.v !== null).every(p => p.x <= short.t.at(-1)));
  // Closes join from one calendar day to the next only.
  const daily = M.chartPoints(h.daily, [h.daily.t[0], NOW], NOW);
  assert.equal(daily.bands.length, 1, 'the missing day is the one gap');
  assert.deepEqual(daily.bands[0].map(iso), ['2026-09-30T19:30:00.000Z', '2026-10-02T19:30:00.000Z']);
  // Thinning for drawing keeps the extremes and every break.
  const many = Array.from({ length: 4000 }, (_, i) => ({ x: i, v: i === 1234 ? 99 : i === 2345 ? -99 : i % 7 }));
  many.splice(3000, 0, { x: 2999.5, v: null });
  const thin = M.downsample(many, 0, 4000, 100);
  assert.ok(thin.length < many.length / 4 && thin.some(p => p.v === 99) && thin.some(p => p.v === -99) && thin.some(p => p.v === null));
});

test('JOED-156 model: the tooltip names the nearest recorded value, or says none was recorded there and why', () => {
  const h = M.acceptAccountHistory(history());
  const at = Date.parse('2026-10-14T08:00:00.000Z');
  const near = M.pointNear(h.short, at + 2 * MIN);
  assert.equal(near.stands, true);
  assert.ok(Math.abs(near.x - (at + 2 * MIN)) <= 2.5 * MIN);
  const outage = M.pointNear(h.short, Date.parse('2026-10-13T11:00:00.000Z'));
  assert.equal(outage.stands, false, 'an hour from any value');
  const unavailable = M.pointNear(h.short, Date.parse('2026-10-14T09:02:22.000Z'));
  assert.deepEqual([unavailable.stands, unavailable.why], [false, 'gateway_down']);
  assert.equal(M.pointNear(M.emptySeries('short'), at), null);
  const closeDay = M.pointNear(h.daily, Date.parse('2026-10-05T06:00:00.000Z'));
  assert.equal(closeDay.day, '2026-10-04', 'the nearest close');
  // The axis fits the window's values and where its line crosses each edge.
  const window = [Date.parse('2026-10-14T07:01:00.000Z'), Date.parse('2026-10-14T07:59:00.000Z')];
  const ext = M.extents(h.short, window);
  const inside = h.short.v.filter((v, i) => h.short.t[i] >= window[0] && h.short.t[i] <= window[1]);
  assert.ok(ext.visible[0] < Math.min(...inside) && ext.visible[1] > Math.max(...inside), 'edge crossings widen the fit slightly');
  assert.deepEqual(ext.loaded, [27000, Math.max(...h.short.v.filter(Number.isFinite))]);
});

test('JOED-156 model: time labels keep their distance on Vienna wall-clock ticks, in every timezone the test runs', () => {
  const day = M.timeLabels(NOW - DAY, NOW, 900);
  assert.ok(day.labels.length >= 6);
  for (let i = 1; i < day.labels.length; i++) assert.ok((day.labels[i].x - day.labels[i - 1].x) / DAY * 900 >= 56);
  const midnight = day.labels.find(l => l.date);
  assert.equal(iso(midnight.x), '2026-10-13T22:00:00.000Z', 'Vienna midnight in summer time');
  assert.equal(words(midnight.text), '14 Oct');
  assert.ok(day.labels.filter(l => !l.date).every(l => /^\d\d:\d\d$/.test(l.text)));
  assert.ok(day.lines.every(l => l.dashed) && day.lines.length === 1, 'a dashed line at the one midnight');
  // The autumn clock change: no instant twice, in order.
  const change = M.timeLabels(Date.parse('2026-10-24T22:00:00.000Z'), Date.parse('2026-10-25T23:00:00.000Z'), 1600);
  const xs = change.labels.map(l => l.x);
  assert.deepEqual(xs, [...new Set(xs)].sort((a, b) => a - b));
  const month = M.timeLabels(NOW - 30 * DAY, NOW, 900);
  assert.ok(month.labels.length >= 3 && month.labels.every(l => l.date && /^\d{1,2}\s\w{3}$/.test(words(l.text))));
  const weeks = M.timeLabels(NOW - 90 * DAY, NOW, 900);
  assert.ok(weeks.labels.length >= 6 && weeks.labels.every(l => new Date(l.x + 2 * HOUR).getUTCDay() === 1), 'weeks start on Monday, Vienna time');
  assert.ok(weeks.lines.every(l => !l.dashed) && weeks.lines.length === weeks.labels.length, 'a faint line behind each label');
  const year = M.timeLabels(Date.parse('2026-01-01T00:00:00.000Z') - 200 * DAY, NOW, 1200);
  assert.ok(year.labels.some(l => l.text === '2026'), 'January is its year');
  assert.ok(year.labels.filter(l => l.text !== '2026').every(l => /^[A-Z][a-z]{2}$/.test(l.text)));
});

// ---------- Fix round 1 (the Codex gate's findings) ----------
const T10 = Date.parse('2026-10-14T08:00:00.000Z'); // 10:00 Vienna
const atMin = m => T10 + m * MIN;
const shortOf = points => M.acceptAccountHistory(body(points, [])).short;

test('JOED-156 fix 1: a window starting on an unavailable snapshot starts at the first value after it, never at an older one', () => {
  // Five-minute snapshots from 10:00 to 11:00; the 10:10 one is unavailable.
  const series = shortOf(Array.from({ length: 13 }, (_, i) => point(atMin(5 * i), i === 2 ? null : (27000 + i).toFixed(2))));
  const change = M.rangeChange(series, [atMin(11), atMin(60)]);
  assert.equal(iso(change.from), iso(atMin(15)), 'the first value after the unavailable one, not the 10:05 value before it');
  assert.equal(change.fromStart, false, 'and it does not claim the window’s start');
  assert.equal(change.change, decimalUnits('27012.00') - decimalUnits('27003.00'));
  // A gap (more than 20 minutes without a snapshot) right after the value before the start: the same.
  const gap = shortOf([point(atMin(0), '27000.00'), point(atMin(30), '27001.00'), point(atMin(35), '27002.00')]);
  const afterGap = M.rangeChange(gap, [atMin(5), atMin(35)]);
  assert.deepEqual([iso(afterGap.from), afterGap.fromStart], [iso(atMin(30)), false]);
  // A value with the line running on from it still stands for the start.
  const kept = M.rangeChange(series, [atMin(22), atMin(60)]);
  assert.deepEqual([iso(kept.from), kept.fromStart], [iso(atMin(20)), true]);
  // So does an observation exactly at the start, whatever follows it.
  const exact = M.rangeChange(gap, [atMin(0), atMin(35)]);
  assert.deepEqual([iso(exact.from), exact.fromStart], [iso(atMin(0)), true]);
});

test('JOED-156 fix 2: a window ending inside a run of unavailable snapshots shows the gap up to its edge', () => {
  // Valid 10:00, unavailable 10:05, 10:10 and 10:15, valid 10:20 and 10:25; the window ends at 10:06.
  const points = [point(atMin(0), '27000.00'), point(atMin(5), null), point(atMin(10), null), point(atMin(15), null), point(atMin(20), '27001.00'), point(atMin(25), '27002.00')];
  const { pts, bands } = M.chartPoints(shortOf(points), [atMin(-30), atMin(6)], atMin(30));
  assert.deepEqual(bands, [[atMin(0), atMin(20)]], 'from the last value to the value after the run: drawn to the edge');
  assert.ok(pts.some(p => p.v === null) && pts.filter(p => p.v !== null).every(p => p.x === atMin(0) || p.x === atMin(20)), 'the line breaks across it');
  // A run that reaches the end of the record: to now.
  assert.deepEqual(M.chartPoints(shortOf(points.slice(0, 4)), [atMin(-30), atMin(6)], atMin(30)).bands, [[atMin(0), atMin(30)]]);
  // And the closes: a missing day after the window's end still shows.
  const closes = M.acceptAccountHistory(body([], [
    { day: '2026-10-10', t: '2026-10-10T20:00:00.000Z', equity: { amount: '1', currency: 'EUR' }, cash: null, equityAt: '2026-10-10T20:00:00.000Z', cashAt: null },
    { day: '2026-10-12', t: '2026-10-12T20:00:00.000Z', equity: { amount: '2', currency: 'EUR' }, cash: null, equityAt: '2026-10-12T20:00:00.000Z', cashAt: null }])).daily;
  assert.deepEqual(M.chartPoints(closes, [Date.parse('2026-10-09T00:00:00.000Z'), Date.parse('2026-10-11T00:00:00.000Z')], Date.parse('2026-10-12T21:00:00.000Z')).bands,
    [[Date.parse('2026-10-10T20:00:00.000Z'), Date.parse('2026-10-12T20:00:00.000Z')]]);
});

test('JOED-156 fix 3: one resize rule keeps the source’s floor, inside the range, for either edge', () => {
  const full = [NOW - 40 * DAY, NOW], week = [NOW - 7 * DAY, NOW];
  assert.deepEqual(M.resizeWithin(full, week, 'from', NOW - 5 * DAY, M.MIN_SPAN.daily), [NOW - 5 * DAY, NOW], 'a resize above the floor is History’s');
  assert.deepEqual(M.resizeWithin(full, week, 'from', NOW - HOUR, M.MIN_SPAN.daily), [NOW - 3 * DAY, NOW], 'the start edge stops three days before the end');
  assert.deepEqual(M.resizeWithin(full, week, 'to', NOW - 7 * DAY + HOUR, M.MIN_SPAN.daily), [NOW - 7 * DAY, NOW - 4 * DAY], 'the end edge three days after the start');
  assert.deepEqual(M.resizeWithin(full, [full[0], full[0] + 7 * DAY], 'to', full[0] - DAY, M.MIN_SPAN.daily), [full[0], full[0] + 3 * DAY], 'never outside the range');
  assert.deepEqual(M.resizeWithin(full, week, 'from', NOW, M.MIN_SPAN.short), [NOW - 5 * MIN, NOW], 'five minutes of snapshots');
  const short = [NOW - DAY, NOW];
  assert.deepEqual(M.resizeWithin(short, short, 'from', NOW, 10 * DAY), short, 'a range shorter than the floor is the narrowest window');
});

test('JOED-156 r39: liveTail is the end of chartPoints’ drawing, thinned or not; the points before it never depend on the live value', () => {
  const h = M.acceptAccountHistory(history()), last = h.short.t.at(-1);
  const live = (after, amount) => M.withLive(h.short, { t: last + after, observedAt: iso(last + after), amount });
  // Three days of five-minute values in 200 buckets are thinned; Infinity keeps every one.
  const window = [last - 3 * DAY, last + 15 * MIN], now = last + 15 * MIN;
  for (const buckets of [Infinity, 200]) {
    let before = null;
    // The lowest, the highest and a middle value of its bucket, and one in the next bucket.
    for (const [after, amount] of [[MIN, '26000.00'], [3 * MIN, '30000.00'], [4 * MIN, '27420.00'], [14 * MIN, '27421.00']]) {
      const series = live(after, amount), { pts, thinned } = M.chartPoints(series, window, now, buckets);
      const tail = M.liveTail(series, window, buckets, thinned), head = pts.slice(0, pts.length - tail.pts.length);
      assert.equal(thinned, buckets === 200);
      assert.deepEqual(pts.slice(head.length), tail.pts, `${buckets} buckets, ${amount}: the drawing ends on the tail`);
      assert.deepEqual(head, before ?? head, `${buckets} buckets, ${amount}: the drawing before it is the same`);
      before = head;
      assert.equal(tail.from < series.t.length - 1, thinned, 'thinned, with the bucket of the value before it');
    }
  }
  // No tail without a live value joined to the value before it.
  assert.equal(M.liveTail(h.short, window, 200, true), null);
  assert.equal(M.liveTail(live(30 * MIN, '27000.00'), [last - DAY, last + 31 * MIN], Infinity, false), null, 'after a gap');
  // The time to now is a gap past the snapshot cadence, or a day without a close.
  assert.deepEqual([M.gapToNow(h.short, h.short.t.length - 1, last + 20 * MIN), M.gapToNow(h.short, h.short.t.length - 1, last + 20 * MIN + 1)], [false, true]);
});
