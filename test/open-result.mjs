// Focused Node-only policy and renderer checks. The oracle below describes
// outcomes in plain words and never calls the production classifier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import { validateContract } from '../contracts/index.mjs';
const board = await import('../public/joe/board-state.js');
const { localBoardHealth, boardHealthPresentation, boardDiagnostics, statusPresentation } = await import('../public/joe/health.js');
const { heroLeft, healthPop, compactDesk } = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const exact = JSON.parse(readFileSync(new URL('../fixtures/phase-b.json', import.meta.url))).exact;
const DESKS = ['j', 'joe', 'joel'], NAMES = ['J', 'Joe', 'Joel'];
const now = new Date(Date.parse(exact.receivedAt) + 30000).toISOString(); // regular hours
const previous = panelStates({ data: { value: exact } }, exact.receivedAt);
const viewOf = (data, prior = {}) => {
  const feeds = { data: { value: data } };
  return { feeds, now, states: board.boardStates(feeds, now, prior) };
};
const detailsRow = (pop, name) => {
  const keys = pop.querySelectorAll('dt');
  return pop.querySelectorAll('dd')[keys.findIndex(node => node.textContent === name)]?.textContent;
};

// Open is green only when every result is exact. Explained not-exact gaps
// keep the existing price warning; faults get unavailable wording. `fine`
// below means no fault, so diagnostics distinguish faults from not-exact gaps.
// Amounts beside a fault remain observations but cannot form a desk total.
const DESK_OPEN = {
  exact: { fine: true, word: 'exact', amount: true },
  notExactMoney: { fine: true, word: 'not exact', amount: false, reason: 'not exact' },
  notExactSource: { fine: true, word: 'not exact', amount: false, reason: 'not exact' },
  faultMoney: { fine: false, word: 'unavailable', amount: false, reason: 'not reported by the broker' },
  faultSource: { fine: false, word: 'unavailable', amount: false, reason: 'not reported by the broker' },
  notExactMoneyFaultSource: { fine: false, word: 'unavailable', amount: false, reason: 'not reported by the broker' },
  faultMoneyNotExactSource: { fine: false, word: 'unavailable', amount: false, reason: 'not reported by the broker' },
  unavailable: { fine: false, word: 'not reported', amount: false },
  lastGood: { fine: false, word: 'last good', amount: true, reason: 'not reported by the broker' },
  valueKeptFaultMoney: { fine: false, word: 'unavailable', amount: true, reason: 'not reported by the broker' },
};
const HOUSEHOLD_OPEN = {
  current: { fine: true, word: 'exact', amount: true },
  notExact: { fine: true, word: 'not exact', reason: 'not exact' },
  fault: { fine: false, word: 'unavailable', reason: 'not reported by the broker' },
  nullNoReason: { fine: false, word: 'not reported' },
  valueKeptFaultMoney: { fine: false, word: 'unavailable', amount: true, reason: 'not reported by the broker' },
};
// Independent outcome rule: any faulty desk makes the household unavailable,
// never not exact, regardless of desk order or the household's original dash.
// Otherwise a total needs three exact desks, and a not-exact input explains
// why a current total is withheld. An own household fault stays a fault.
function oracle(desks, household) {
  const own = HOUSEHOLD_OPEN[household], inputs = desks.map(option => DESK_OPEN[option]);
  const deskFault = inputs.some(input => !input.fine), allExact = inputs.every(input => input.word === 'exact');
  const green = own.word === 'exact' && allExact, fault = !own.fine || deskFault;
  return { inputs, green, fault, shown: Boolean(own.amount) && allExact,
    word: deskFault ? 'unavailable' : own.word === 'exact' && !allExact ? 'not exact' : own.word,
    reason: deskFault ? 'not reported by the broker' : own.word === 'exact' && !allExact ? 'not exact' : own.reason };
}

function combination(desks, household) {
  const data = structuredClone(exact), prior = {};
  const withhold = (money, source, moneyReason, sourceReason) => {
    money.openPnl = null;
    if (moneyReason) (money.reasons ??= {}).openPnl = moneyReason;
    Object.assign(source, { status: 'unavailable', method: null, observedAt: null });
    if (sourceReason) source.reason = sourceReason;
  };
  desks.forEach((option, i) => {
    const desk = data.desks[i], source = desk.pnlSources.open, money = desk.money;
    if (option === 'notExactMoney') withhold(money, source, 'not_exact_yet', null);
    if (option === 'notExactSource') withhold(money, source, null, 'not_exact_yet');
    if (option === 'faultMoney') withhold(money, source, 'source_unavailable', null);
    if (option === 'faultSource') withhold(money, source, null, 'source_unavailable');
    if (option === 'notExactMoneyFaultSource') withhold(money, source, 'not_exact_yet', 'source_unavailable');
    if (option === 'faultMoneyNotExactSource') withhold(money, source, 'source_unavailable', 'not_exact_yet');
    if (option === 'unavailable') withhold(money, source, null, null);
    if (option === 'lastGood') {
      withhold(money, source, 'source_unavailable', 'source_unavailable');
      prior[`desks.${desk.id}.openPnl`] = previous[`desks.${desk.id}.openPnl`];
    }
    if (option === 'valueKeptFaultMoney') (money.reasons ??= {}).openPnl = 'source_unavailable';
  });
  const reason = { notExact: 'not_exact_yet', fault: 'source_unavailable', nullNoReason: null }[household];
  if (household === 'valueKeptFaultMoney') (data.totals.reasons ??= {}).openPnl = 'source_unavailable';
  else if (household !== 'current') withhold(data.totals, data.pnlSources.open, reason, reason);
  return viewOf(data, prior);
}

test('JOED-157: household-current shape never exempts a desk open fault (contract valid)', () => {
  const view = combination(['exact', 'valueKeptFaultMoney', 'exact'], 'current');
  assert.equal(validateContract('data', view.feeds.data.value).ok, true);
  assert.deepEqual(localBoardHealth(view.states, view.feeds, now), { tone: 'yellow', reason: 'open_fault_rth' });
  assert.equal(view.states['today.openPnl'].value, null);
  assert.equal(view.states['today.openPnl'].reason, 'source_unavailable');
  assert.match(boardDiagnostics(view.states, view.feeds, now).join(' '), /Joe’s Open result is unavailable: not reported by the broker/);
});

test('JOED-157: Details keeps the household own fault beside desk gaps', () => {
  const data = combination(['notExactMoney', 'exact', 'exact'], 'valueKeptFaultMoney').feeds.data.value;
  data.totals.reasons.openPnl = 'open_pnl_unavailable';
  const view = viewOf(data), row = detailsRow(htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now))), 'Open positions');
  assert.match(row, /Household unavailable · open result not available/);
  assert.match(row, /J: not exact/);
});

test('JOED-157: every desk and household Open combination matches the plain-words oracle through light and renderers (5000 cases)', t => {
  const mismatches = {}, examples = [];
  let count = 0, greens = 0, wrongGreens = 0, wrongGreensCurrent = 0;
  const check = (ok, category, label) => {
    if (ok) return;
    mismatches[category] = (mismatches[category] ?? 0) + 1;
    if (examples.length < 8) examples.push(`${category}: ${label}`);
  };
  for (const j of Object.keys(DESK_OPEN)) for (const joe of Object.keys(DESK_OPEN)) for (const joel of Object.keys(DESK_OPEN)) {
    for (const household of Object.keys(HOUSEHOLD_OPEN)) {
      const desks = [j, joe, joel], expected = oracle(desks, household), view = combination(desks, household);
      const label = `${household}: J ${j}; Joe ${joe}; Joel ${joel}`;
      const health = localBoardHealth(view.states, view.feeds, now);
      check(health.tone === (expected.green ? 'green' : 'yellow') && health.reason === (expected.green ? 'board_ok' : expected.fault ? 'open_fault_rth' : 'open_unavailable_rth'), 'light', label);
      const status = statusPresentation(view);
      check(expected.green || status.sentence === (expected.fault ? 'Open result is unavailable' : 'Waiting on broker prices'), 'light wording', label);
      if (health.tone === 'green' && !expected.green) { wrongGreens++; if (household === 'current') wrongGreensCurrent++; }
      if (expected.green) greens++;
      check((view.states['today.openPnl'].value != null) === expected.shown, 'household amount', label);

      const hero = htmlDocument(heroLeft(view));
      check((hero.querySelector('[data-cell="hero.open"] .bn').textContent !== '—') === expected.shown, 'hero amount', label);
      const summary = hero.querySelector('.account-section .summary-text')?.textContent ?? '';
      check(expected.word === 'exact' ? !summary.includes('Open positions:') : summary.includes(`Open positions: ${expected.word}`), 'hero summary', label);
      if (expected.reason) check(summary.includes(expected.reason), 'hero reason', label);
      if (expected.fault) check(!summary.includes('Open positions: not exact'), 'fault wins household caption', label);

      const pop = htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now)));
      const row = detailsRow(pop, 'Open positions');
      check(Boolean(row), 'Details row exists', label);
      if (expected.fault) check(row.includes('Household unavailable'), 'household fault Details', label);
      if (expected.inputs.every(input => input.word === 'exact') && expected.word !== 'exact') {
        check(row.includes(`Household ${expected.word === 'not exact' ? 'not exact' : 'unavailable'}`) && row.includes('each desk exact'), 'household-only Details', label);
        if (expected.reason) check(row.includes(expected.reason), 'household-only reason', label);
      }
      const groups = (row ?? '').split('; ').map(text => text.match(/^(.*?): (exact|not exact|unavailable|last good|not reported)(?: · (.*))?$/i)).filter(Boolean);
      DESKS.forEach((id, i) => {
        const input = expected.inputs[i], name = NAMES[i];
        check(pop.textContent.includes(`${name}’s Open result is`) === !input.fine, 'Details diagnostic', `${label}: ${name}`);
        if (groups.length) {
          const group = groups.find(match => new RegExp(`\\b${name}\\b`).test(match[1]));
          check(group?.[2].toLowerCase() === input.word, 'Details desk classification', `${label}: ${name}`);
          if (input.reason && input.reason !== input.word) check(group?.[3] === input.reason, 'Details desk reason', `${label}: ${name}`);
        } else check(expected.inputs.every(input => input.word === 'exact'), 'Details names desk gaps', label);

        const card = htmlDocument(deskCard(view, id, 50, true));
        check((card.querySelectorAll('.dnums .bn')[1].textContent !== '—') === input.amount, 'card amount', `${label}: ${name}`);
        const cardLine = card.querySelector('.mini-label').textContent;
        check(cardLine.includes('Open positions:') === (input.word !== 'exact'), 'card status', `${label}: ${name}`);
        if (input.reason) check(cardLine.includes(input.reason), 'card reason', `${label}: ${name}`);

        const phone = htmlDocument(compactDesk(view, id));
        const phoneLine = phone.querySelector('.summary-text')?.textContent ?? '';
        check(input.word === 'exact' ? !phoneLine.includes('Open positions:') : phoneLine.includes(`Open positions: ${input.word}`), 'phone summary', `${label}: ${name}`);
        if (input.reason) check(phoneLine.includes(input.reason), 'phone reason', `${label}: ${name}`);
        // Changing Open must never change the phone's Today amount.
        check(phone.querySelector('[data-compact-value="dayPnl"] .bn').textContent !== '—', 'Today unchanged', `${label}: ${name}`);
      });
      count++;
    }
  }
  t.diagnostic(JSON.stringify({ count, greens, wrongGreens, wrongGreensCurrent, mismatches, examples }));
  assert.equal(count, 5000);
  assert.equal(greens, 1);
  assert.deepEqual(mismatches, {});
});

test('JOED-157: shared classifier and Open channels cover source fallback, status, and every not-exact reason', () => {
  const fresh = { state: 'fresh', value: { amount: '1', currency: 'EUR' }, retained: false, reason: null };
  const available = { status: 'available', method: 'owned-lots-current-mark-fx' };
  const data = structuredClone(exact);
  delete data.desks[1].pnlSources.open;
  assert.equal(board.pnlChannels(data, 'joe', 'openPnl').source, data.pnlSources.open);
  assert.equal(board.pnlChannels(data, 'j', 'openPnl').source, data.desks[0].pnlSources.open);
  assert.equal(board.pnlChannels(data, 'today', 'openPnl').source, data.pnlSources.open);
  assert.deepEqual(board.classifyCell(fresh, { source: available }), { kind: 'exact', reason: null, estimated: false });
  assert.deepEqual(board.classifyCell(fresh, { source: { status: 'unavailable' } }), { kind: 'fault', reason: null });
  assert.deepEqual(board.classifyCell(undefined), { kind: 'fault', reason: null });
  for (const reason of ['not_exact_yet', 'sod_missing', 'ledger_unreconciled', 'position_stale', 'baseline_pending', 'day_pnl_unavailable']) {
    const data = structuredClone(exact);
    data.desks[1].money.openPnl = null;
    data.desks[1].money.reasons = { openPnl: reason };
    Object.assign(data.desks[1].pnlSources.open, { status: 'unavailable', reason, method: null, observedAt: null });
    const view = viewOf(data, previous);
    assert.deepEqual(localBoardHealth(view.states, view.feeds, now), { tone: 'yellow', reason: 'open_unavailable_rth' }, reason);
    assert.equal(view.states['today.openPnl'].value, null, reason);
    assert.equal(board.classifyCells(view.states, data, 'openPnl').joe.kind, 'notExact', reason);
    data.desks[1].pnlSources.open.reason = 'source_unavailable';
    const faulty = viewOf(data);
    assert.equal(localBoardHealth(faulty.states, faulty.feeds, now).tone, 'yellow', reason);
    assert.equal(faulty.states['desks.joe.openPnl'].reason, 'source_unavailable', reason);
  }
  // Available methods must never replace a fault explanation in Details.
  for (const scope of ['today', 'joe']) for (const channel of ['money', 'source', 'status']) {
    const data = structuredClone(exact);
    const money = scope === 'today' ? data.totals : data.desks[1].money;
    const source = scope === 'today' ? data.pnlSources.open : data.desks[1].pnlSources.open;
    if (channel === 'money') (money.reasons ??= {}).openPnl = 'source_unavailable';
    if (channel === 'source') source.reason = 'source_unavailable';
    if (channel === 'status') source.status = 'unavailable';
    const view = viewOf(data), pop = htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now)));
    assert.equal(localBoardHealth(view.states, view.feeds, now).tone, 'yellow', `${scope} ${channel}`);
    assert.match(detailsRow(pop, 'Open positions'), /unavailable/i, `${scope} ${channel}`);
    assert.doesNotMatch(detailsRow(pop, 'Open positions'), /Valued/, `${scope} ${channel}`);
    if (scope === 'joe') {
      assert.equal(view.states['today.openPnl'].value, null, channel);
      assert.equal(view.states['desks.joe.openPnl'].state, 'broken', channel);
      assert.match(htmlDocument(compactDesk(view, 'joe')).querySelector('.summary-text').textContent, /Open positions: unavailable/, channel);
    }
  }
});
