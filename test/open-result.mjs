// Focused Node-only policy and renderer checks. The oracle below describes
// outcomes in plain words and never calls the production classifier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import { validateContract, REASONS } from '../contracts/index.mjs';
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

test('JOED-157 fix3: cold boardStates preserves the browser first-load state and captions', () => {
  for (const feeds of [{}, { data: { value: null } }, { data: { value: null, reason: 'route_not_found' } }]) {
    const states = board.boardStates(feeds, now), hero = htmlDocument(heroLeft({ feeds, now, states }));
    const rejected = feeds.data?.reason === 'route_not_found';
    for (const scope of ['today', ...DESKS.map(id => `desks.${id}`)]) for (const field of ['dayPnl', 'openPnl']) {
      assert.equal(states[`${scope}.${field}`].state, rejected ? 'broken' : 'not reported');
      assert.equal(states[`${scope}.${field}`].reason, rejected ? 'route_not_found' : null);
    }
    // browser-p3:1119-1121 reads data-state, not just the visible dash.
    assert.equal(hero.querySelector('[data-cell="hero.day"]').dataset.state, rejected ? 'broken' : 'not reported');
    assert.equal(hero.querySelector('.say').textContent, rejected
      ? 'No numbers: not found on the board server.' : 'No numbers yet: no board data has arrived.');
    assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent,
      rejected ? 'Unavailable · not found on the board server' : '');
    assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent,
      rejected ? 'Unavailable · not found on the board server' : 'Not reported');
    const summary = hero.querySelector('.account-section .summary-text').textContent;
    assert.equal(summary, rejected ? 'Open positions: unavailable · not found on the board server' : 'Open positions: not reported · no data received yet');
    assert.doesNotMatch(hero.textContent, /Unavailable for|unavailable for/);
  }
});

test('JOED-157 fix3: absent P&L is not a synthesized fault, but real fault evidence still escalates', () => {
  for (const field of ['dayPnl', 'openPnl']) {
    const data = structuredClone(exact), period = field === 'dayPnl' ? 'day' : 'open';
    data.totals[field] = null;
    for (const desk of data.desks) desk.money[field] = null;
    // The source has no fault evidence; null amounts alone mean absent.
    let view = viewOf(data), hero = htmlDocument(heroLeft(view));
    assert.equal(view.states[`today.${field}`].state, 'not reported');
    assert.equal(view.states[`today.${field}`].reason, null);
    assert.doesNotMatch(hero.textContent, /Unavailable for|unavailable for/);
    for (const channel of ['money', 'source', 'status', 'lastGood']) {
      const faulty = structuredClone(data), desk = faulty.desks[1];
      if (channel === 'money') (desk.money.reasons ??= {})[field] = 'source_unavailable';
      if (channel === 'source') desk.pnlSources[period].reason = 'source_unavailable';
      if (channel === 'status') desk.pnlSources[period].status = 'unavailable';
      if (channel === 'lastGood') {
        desk.pnlSources[period].reason = 'source_unavailable';
        desk.pnlSources[period].status = 'unavailable';
      }
      const prior = channel === 'lastGood' ? { [`desks.joe.${field}`]: previous[`desks.joe.${field}`] } : {};
      view = viewOf(faulty, prior);
      assert.equal(view.states[`today.${field}`].state, 'broken', `${field} ${channel}`);
      assert.equal(view.states[`today.${field}`].value, null);
    }
  }
});

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

test('JOED-157 fix2: household Open captions name faulty desks before not-exact desks', () => {
  const view = combination(['notExactMoney', 'faultSource', 'exact'], 'notExact');
  const hero = htmlDocument(heroLeft(view));
  assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent,
    'Unavailable for Joe · not reported by the broker; not exact for J');
  assert.equal(hero.querySelector('.account-section .summary-text').textContent,
    'Open positions: unavailable for Joe · not reported by the broker; not exact for J');
});

test('JOED-157 fix2: a shared fault reason keeps the faulty desk named in Today and Open', () => {
  const data = combination(['exact', 'faultMoney', 'exact'], 'current').feeds.data.value;
  (data.desks[1].money.reasons ??= {}).dayPnl = 'source_unavailable';
  const hero = htmlDocument(heroLeft(viewOf(data)));
  assert.equal(hero.querySelector('.board-caption').textContent, 'Numbers unavailable · not reported by the broker');
  assert.equal(hero.querySelector('[data-cell="hero.day"] .primary-caption').textContent, 'Unavailable for Joe');
  assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, 'Unavailable for Joe');
});

test('JOED-157: Details keeps the household own fault beside desk gaps', () => {
  const data = combination(['notExactMoney', 'exact', 'exact'], 'valueKeptFaultMoney').feeds.data.value;
  data.totals.reasons.openPnl = 'history_write_failed';
  const view = viewOf(data), row = detailsRow(htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now))), 'Open positions');
  assert.match(row, /Household unavailable · history could not be saved/);
  assert.match(row, /J: not exact/);
});

test('JOED-157 fix2: open_pnl_unavailable is an Open-only broker-price wait on every channel', () => {
  for (const scope of ['today', ...DESKS]) for (const channel of ['cell', 'money', 'source']) {
    const data = structuredClone(exact), desk = data.desks.find(desk => desk.id === scope);
    const money = desk ? desk.money : data.totals, source = desk ? desk.pnlSources.open : data.pnlSources.open;
    const key = scope === 'today' ? 'today.openPnl' : `desks.${scope}.openPnl`;
    money.openPnl = null;
    Object.assign(source, { status: 'unavailable', method: null, observedAt: null });
    if (channel === 'money') (money.reasons ??= {}).openPnl = 'open_pnl_unavailable';
    if (channel === 'source') source.reason = 'open_pnl_unavailable';
    const view = viewOf(data, previous);
    if (channel === 'cell') {
      view.states[key].reason = 'open_pnl_unavailable';
      // Rebuild the derived household from this cell-only observation.
      if (scope !== 'today') view.states['today.openPnl'] = { ...view.states[key] };
    }
    const label = `${scope} ${channel}`;
    assert.deepEqual(localBoardHealth(view.states, view.feeds, now), { tone: 'yellow', reason: 'open_unavailable_rth' }, label);
    const status = statusPresentation(view);
    assert.equal(status.sentence, 'Waiting on broker prices', label);
    assert.doesNotMatch(`${status.alert} ${status.announcement}`, /tell Amy|reload/i, label);
    assert.equal(view.states['today.openPnl'].value, null, label);
    assert.equal(board.classifyCells(view.states, data, 'openPnl')[scope].kind, 'notExact', label);
    if (scope !== 'today' && channel !== 'cell') assert.equal(view.states[key].retained, true, `${label}: base retained observation survives the price wait`);
    // A waiting channel must never excuse a real fault on another channel.
    if (channel === 'source') (money.reasons ??= {}).openPnl = 'source_unavailable';
    else source.reason = 'source_unavailable';
    assert.equal(board.classifyCells(view.states, data, 'openPnl')[scope].kind, 'fault', label);
    assert.equal(localBoardHealth(view.states, view.feeds, now).reason, 'open_fault_rth', label);
    const rebuilt = viewOf(data, previous);
    assert.equal(localBoardHealth(rebuilt.states, rebuilt.feeds, now).reason, 'open_fault_rth', label);
    assert.equal(rebuilt.states[key].reason, 'source_unavailable', `${label}: real fault replaces the wait caption`);
  }
  const fresh = { state: 'fresh', value: { amount: '1', currency: 'EUR' }, retained: false, reason: null };
  assert.equal(board.classifyDay(fresh, { moneyReason: 'open_pnl_unavailable' }).kind, 'fault', 'Today keeps its existing rule');
  const notExact = ['not_exact_yet', 'sod_missing', 'ledger_unreconciled', 'position_stale', 'baseline_pending', 'day_pnl_unavailable'];
  for (const reason of [...REASONS, 'unknown_open_reason']) {
    if (notExact.includes(reason) || reason === 'open_pnl_unavailable') continue;
    for (const channel of ['cell', 'money', 'source']) {
      const cell = { ...fresh, ...(channel === 'cell' ? { reason } : {}) };
      const channels = channel === 'money' ? { moneyReason: reason } : channel === 'source' ? { source: { status: 'available', reason } } : {};
      assert.equal(board.classifyCell(cell, channels, 'openPnl').kind, 'fault', `${reason} ${channel}`);
    }
  }
});

test('JOED-157 fix2: not-exact household Open retains its Details problem line', () => {
  const view = combination(['exact', 'exact', 'exact'], 'notExact');
  const diagnostic = 'The open result is unavailable during New York regular hours: not exact.';
  assert.deepEqual(boardDiagnostics(view.states, view.feeds, now), [diagnostic]);
  const pop = htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now)));
  assert.match(pop.textContent, /The open result is unavailable during New York regular hours: not exact\./);
  assert.equal(detailsRow(pop, 'Open positions'), 'Household not exact; each desk exact');
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
      if (expected.inputs.some(input => !input.fine)) {
        const caption = hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent;
        for (const text of [caption, summary]) {
          const groups = text.split('; ');
          check(/unavailable for/i.test(groups[0]), 'fault caption first', label);
          expected.inputs.forEach((input, i) => {
            if (input.fine) return;
            const group = groups.find(group => new RegExp(`\\b${NAMES[i]}\\b`).test(group));
            check(Boolean(group) && !/not exact/i.test(group), 'fault caption names desk', `${label}: ${NAMES[i]}`);
          });
        }
      }

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
