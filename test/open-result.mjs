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
const { quietResults, withQuietRecord } = await import('./fixtures/quiet-record.mjs');
const { heroProblemCaption } = await import('../scripts/browser/desk-checks.mjs');
const { viennaDay } = await import('../time.mjs');
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
    assert.equal(summary, rejected ? 'Open result: unavailable · not found on the board server' : 'Open result: not reported');
    assert.doesNotMatch(hero.textContent, /Unavailable for|unavailable for/);
  }
});

test('JOED-158: contract-valid absent P&L has no synthesized fault; supplied fault evidence still escalates', () => {
  for (const field of ['dayPnl', 'openPnl']) {
    const data = structuredClone(exact), period = field === 'dayPnl' ? 'day' : 'open';
    data.totals[field] = null;
    delete data.pnlSources[period];
    for (const desk of data.desks) { desk.money[field] = null; delete desk.pnlSources[period]; }
    assert.equal(validateContract('data', data).ok, true, `${field}: absent source is a valid payload`);
    let view = viewOf(data), hero = htmlDocument(heroLeft(view));
    assert.equal(view.states[`today.${field}`].state, 'not reported');
    assert.equal(view.states[`today.${field}`].reason, null);
    assert.doesNotMatch(hero.textContent, /Unavailable for|unavailable for/);
    if (field === 'openPnl') {
      assert.equal(localBoardHealth(view.states, view.feeds, now).tone, 'yellow');
      assert.equal(hero.querySelector('.account-section .summary-text').textContent, 'Open result: unavailable');
      assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, 'Unavailable');
      assert.equal(heroProblemCaption(view, 'hero.open').text, 'Unavailable', 'browser expectation agrees');
      assert.doesNotMatch(hero.querySelector('.account-section').textContent, /no data received yet/);
    }
    for (const channel of ['money', 'source', 'lastGood']) {
      const faulty = structuredClone(data), desk = faulty.desks[1];
      if (channel === 'money') (desk.money.reasons ??= {})[field] = 'source_unavailable';
      else desk.pnlSources[period] = { ...exact.desks[1].pnlSources[period],
        status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' };
      assert.equal(validateContract('data', faulty).ok, true, `${field} ${channel}: fault fixture is valid`);
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
  waitMoney: { fine: true, word: 'waiting on prices', amount: false },
  waitSource: { fine: true, word: 'waiting on prices', amount: false },
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
  wait: { fine: true, word: 'waiting on prices' },
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
    word: deskFault ? inputs.find(input => !input.fine).word : own.fine && !allExact ? inputs.find(input => input.word !== 'exact').word : own.word };
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
    if (option === 'waitMoney') withhold(money, source, 'open_pnl_unavailable', null);
    if (option === 'waitSource') withhold(money, source, null, 'open_pnl_unavailable');
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
  const reason = { notExact: 'not_exact_yet', wait: 'open_pnl_unavailable', fault: 'source_unavailable', nullNoReason: null }[household];
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
    'Open result: unavailable for Joe · not reported by the broker; not exact for J');
});

test('JOED-157 fix3: price waits and last-good desks keep their own words in fault-first headlines', () => {
  for (const [desks, caption] of [
    [['waitMoney', 'faultSource', 'waitSource'], 'Unavailable for Joe · not reported by the broker; waiting on prices for J and Joel'],
    [['notExactMoney', 'lastGood', 'exact'], 'Last good for Joe · not reported by the broker; not exact for J'],
    [['waitSource', 'lastGood', 'exact'], 'Last good for Joe · not reported by the broker; waiting on prices for J'],
  ]) {
    const view = combination(desks, 'notExact'), hero = htmlDocument(heroLeft(view));
    assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, caption);
    assert.equal(hero.querySelector('.account-section .summary-text').textContent, `Open result: ${caption[0].toLowerCase()}${caption.slice(1)}`);
    const row = detailsRow(htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now))), 'Open positions');
    desks.forEach((option, i) => {
      const word = DESK_OPEN[option].word;
      if (word === 'exact') return;
      const group = row.split('; ').find(text => new RegExp(`\\b${NAMES[i]}\\b`).test(text));
      assert.ok(group?.includes(`: ${word}`), `${NAMES[i]} in ${row}`);
      const card = htmlDocument(deskCard(view, DESKS[i]));
      assert.match((card.querySelector('.card-status')?.textContent ?? ''), new RegExp(`Open result: ${word}`));
      assert.match(htmlDocument(compactDesk(view, DESKS[i])).querySelector('.summary-text').textContent, new RegExp(`Open result: ${word}`));
    });
  }
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

test('JOED-157: every desk and household Open combination matches the plain-words oracle through light and renderers (10368 cases)', async t => {
  const mismatches = {}, examples = [];
  // JOED-153 merge gate: the cards' Open caption and the one-row card. A
  // complete record without trades makes every desk one row.
  const quiet = await quietResults(viennaDay(now), now);
  const STATE_CAPTION = /^(Waiting on prices|Not exact|Unavailable|Not reported|Last good)$/, captionOf = word => word[0].toUpperCase() + word.slice(1);
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
      check(expected.word === 'exact' ? !summary.includes('Open result:') : summary.includes(`Open result: ${expected.word}`), 'hero summary', label);
      const deskFault = expected.inputs.some(input => !input.fine);
      if (!deskFault && HOUSEHOLD_OPEN[household].reason && !HOUSEHOLD_OPEN[household].fine)
        check(summary.includes(HOUSEHOLD_OPEN[household].reason), 'own household fault reason', label);
      if (expected.fault) check(!summary.includes('Open result: not exact'), 'fault wins household caption', label);
      if (deskFault) {
        const caption = hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent;
        for (const text of [caption, summary]) {
          const groups = text.split('; ');
          check(new RegExp(`^(${expected.inputs.filter(input => !input.fine).map(input => input.word).join('|')}) for `, 'i').test(groups[0].replace('Open result: ', '')), 'fault caption first', label);
          const faultPositions = [], waitPositions = [];
          expected.inputs.forEach((input, i) => {
            if (input.word === 'exact') return;
            const group = groups.find(group => new RegExp(`\\b${NAMES[i]}\\b`).test(group));
            check(Boolean(group) && new RegExp(`^(?:Open result: )?${input.word} for `, 'i').test(group), 'caption agrees with desk word', `${label}: ${NAMES[i]}`);
            (input.fine ? waitPositions : faultPositions).push(groups.indexOf(group));
            if (input.reason && input.reason !== input.word && !input.fine) check(group?.includes(input.reason), 'fault caption desk reason', `${label}: ${NAMES[i]}`);
          });
          check(!waitPositions.length || Math.max(...faultPositions) < Math.min(...waitPositions), 'all fault groups precede waits', label);
        }
      }

      const pop = htmlDocument(healthPop(view, boardHealthPresentation(view.states, view.feeds, now)));
      const row = detailsRow(pop, 'Open positions');
      check(Boolean(row), 'Details row exists', label);
      if (expected.fault) check(row.includes('Household unavailable'), 'household fault Details', label);
      if (expected.inputs.every(input => input.word === 'exact') && expected.word !== 'exact') {
        check(row.includes(`Household ${expected.word === 'not reported' ? 'unavailable' : expected.word}`) && row.includes('each desk exact'), 'household-only Details', label);
        const reason = HOUSEHOLD_OPEN[household].reason;
        if (reason) check(row.includes(reason), 'household-only reason', label);
      }
      const groups = (row ?? '').split('; ').map(text => text.match(/^(.*?): (exact|not exact|waiting on prices|unavailable|last good|not reported)(?: · (.*))?$/i)).filter(Boolean);
      DESKS.forEach((id, i) => {
        const input = expected.inputs[i], name = NAMES[i];
        check(pop.textContent.includes(`${name}’s Open result is`) === !input.fine, 'Details diagnostic', `${label}: ${name}`);
        if (groups.length) {
          const group = groups.find(match => new RegExp(`\\b${name}\\b`).test(match[1]));
          check(group?.[2].toLowerCase() === input.word, 'Details desk classification', `${label}: ${name}`);
          if (input.reason && input.reason !== input.word) check(group?.[3] === input.reason, 'Details desk reason', `${label}: ${name}`);
        } else check(expected.inputs.every(input => input.word === 'exact'), 'Details names desk gaps', label);

        const card = htmlDocument(deskCard(view, id));
        check((card.querySelectorAll('.dnums .bn')[1].textContent !== '—') === input.amount, 'card amount', `${label}: ${name}`);
        const cardLine = (card.querySelector('.card-status')?.textContent ?? '');
        check(cardLine.includes('Open result:') === (input.word !== 'exact'), 'card status', `${label}: ${name}`);
        if (input.word !== 'exact') check(cardLine.includes(`Open result: ${input.word}`), 'card agrees with desk word', `${label}: ${name}`);
        if (input.reason) check(cardLine.includes(input.reason), 'card reason', `${label}: ${name}`);
        // The Open caption says what the status line says (JOED-157's words).
        const openCaption = card.querySelectorAll('.dnums .c')[1]?.textContent ?? '';
        check(input.word === 'exact' ? !STATE_CAPTION.test(openCaption) : openCaption === captionOf(input.word), 'card Open caption', `${label}: ${name}: ${openCaption}`);
        // One row keeps the same lines: Open's state, age and reason.
        const row = htmlDocument(deskCard(withQuietRecord(view, quiet), id)), rowLine = row.querySelector('.drow .drow-status')?.textContent;
        check(rowLine !== undefined, 'one row', `${label}: ${name}`);
        check((rowLine ?? '').includes('Open result:') === (input.word !== 'exact'), 'one-row status', `${label}: ${name}`);
        if (input.word !== 'exact') check((rowLine ?? '').includes(`Open result: ${input.word}`), 'one-row agrees with desk word', `${label}: ${name}`);
        if (input.reason) check((rowLine ?? '').includes(input.reason), 'one-row reason', `${label}: ${name}`);

        const phone = htmlDocument(compactDesk(view, id));
        const phoneLine = phone.querySelector('.summary-text')?.textContent ?? '';
        check(input.word === 'exact' ? !phoneLine.includes('Open result:') : phoneLine.includes(`Open result: ${input.word}`), 'phone summary', `${label}: ${name}`);
        if (input.reason) check(phoneLine.includes(input.reason), 'phone reason', `${label}: ${name}`);
        // Changing Open must never change the phone's Today amount.
        check(phone.querySelector('[data-compact-value="dayPnl"] .bn').textContent !== '—', 'Today unchanged', `${label}: ${name}`);
      });
      count++;
    }
  }
  // JOED-153 merge gate: Today withheld at once for the same reason as Open's
  // price wait (contract valid). Open keeps its own word, line and caption;
  // Today's same raw state, a fault in Today's words, keeps its own line.
  for (const [i, id] of DESKS.entries()) for (const option of ['waitMoney', 'waitSource']) {
    const data = combination(DESKS.map((_, k) => (k === i ? option : 'exact')), 'wait').feeds.data.value;
    for (const [bag, sources] of [[data.desks[i].money, data.desks[i].pnlSources], [data.totals, data.pnlSources]]) {
      bag.dayPnl = null;
      if (option === 'waitMoney') (bag.reasons ??= {}).dayPnl = 'open_pnl_unavailable';
      Object.assign(sources.day, { status: 'unavailable', method: null, observedAt: null }, option === 'waitSource' ? { reason: 'open_pnl_unavailable' } : {});
    }
    const label = `${NAMES[i]}'s Today and Open (${option}) withheld at once`, view = viewOf(data);
    check(validateContract('data', data).ok, 'beside Today: contract', label);
    const lines = ['Today: unavailable · open result not available', `Open result: ${DESK_OPEN[option].word}`];
    const card = htmlDocument(deskCard(view, id)), cardLines = card.querySelectorAll('.card-status .st').map(line => line.textContent);
    check(JSON.stringify(cardLines) === JSON.stringify(lines), 'beside Today: card lines', `${label}: ${cardLines.join(' / ')}`);
    const captions = card.querySelectorAll('.dnums .c').map(caption => caption.textContent);
    check(captions[0] === 'Unavailable' && captions[1] === captionOf(DESK_OPEN[option].word), 'beside Today: card captions', `${label}: ${captions.join(' / ')}`);
    const rowLines = htmlDocument(deskCard(withQuietRecord(view, quiet), id)).querySelectorAll('.drow .drow-status .st').map(line => line.textContent);
    check(JSON.stringify(rowLines) === JSON.stringify(lines), 'beside Today: one-row lines', `${label}: ${rowLines.join(' / ')}`);
  }
  t.diagnostic(JSON.stringify({ count, greens, wrongGreens, wrongGreensCurrent, mismatches, examples }));
  assert.equal(count, 12 ** 3 * 6);
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
      assert.match(htmlDocument(compactDesk(view, 'joe')).querySelector('.summary-text').textContent, /Open result: unavailable/, channel);
    }
  }
});


test('JOED-158 Open: mixed waiting and not-exact blockers are all named regardless of wire desk order', () => {
  for (const options of [['waitMoney', 'notExactMoney', 'exact'], ['notExactMoney', 'waitMoney', 'exact']]) {
    for (const household of ['current', 'notExact', 'wait']) {
      const view = combination(options, household), data = view.feeds.data.value;
      const waiting = NAMES[options.indexOf('waitMoney')], pending = NAMES[options.indexOf('notExactMoney')];
      const expected = options[0] === 'waitMoney' ? `Waiting on prices for ${waiting}; not exact for ${pending}`
        : `Not exact for ${pending}; waiting on prices for ${waiting}`;
      for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
        const original = data.desks.slice(); data.desks = order.map(i => original.find(d => d.id === DESKS[i]));
        const hero = htmlDocument(heroLeft(view));
        assert.equal(hero.querySelector('[data-cell="hero.open"] .account-caption').children[0].textContent, expected);
        assert.equal(hero.querySelector('.account-section .summary-text').textContent, `Open result: ${expected[0].toLowerCase()}${expected.slice(1)}`);
      }
    }
  }
});
