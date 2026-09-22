const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { checkArtemiaRound } = require('./not-alone-ui-smoke.cjs');

const frame = changes => ({ roomCode: 'QA-BOARD', roundNumber: 2, revision: 20, status: 'playing', phase: 'hunted_planning',
  boardFace: 'alternating', rescueGoal: 14, rescueProgress: 3, artemiaAvailable: true, ...changes });

test('both printed faces validate every initial track position against their marked spaces', () => {
  for (const boardFace of ['continuous', 'alternating']) {
    const marked = boardFace === 'continuous' ? [8, 9, 10, 11, 12, 13] : [3, 5, 7, 9, 11, 13];
    for (let rescueProgress = 0; rescueProgress <= 14; rescueProgress += 1) {
      const available = marked.includes(rescueProgress);
      const state = frame({ boardFace, rescueProgress, artemiaAvailable: available });
      const result = checkArtemiaRound(state);
      assert.equal(result.startRescueProgress, rescueProgress);
      assert.equal(result.available, available);
      assert(Object.isFrozen(result));
      assert.throws(() => checkArtemiaRound({ ...state, artemiaAvailable: !available }), /wrong initial Artemia status/);
    }
  }
});

test('Beach and Wreck progress changes retain the established round availability in either direction', () => {
  for (const [start, moved, available] of [[3, 4, true], [2, 3, false]]) {
    const baseline = checkArtemiaRound(frame({ rescueProgress: start, artemiaAvailable: available }));
    for (const phase of ['hunted_planning', 'exploration_reaction', 'creature_planning', 'hunting_reaction', 'reckoning', 'end_of_turn']) {
      const current = frame({ phase, rescueProgress: moved, artemiaAvailable: available, revision: 27 });
      assert.equal(checkArtemiaRound(current, baseline), baseline);
      assert.throws(() => checkArtemiaRound({ ...current, artemiaAvailable: !available }, baseline), /changed within the round/);
    }
  }
});

test('each following round requires a fresh planning baseline rather than accepting the prior flag', () => {
  const previous = checkArtemiaRound(frame());
  for (const [rescueProgress, artemiaAvailable] of [[5, true], [6, false]]) {
    const current = frame({ roundNumber: 3, rescueProgress, artemiaAvailable, revision: 50 });
    const next = checkArtemiaRound(current, previous);
    assert.notEqual(next, previous);
    assert.equal(next.roundNumber, 3);
    assert.equal(next.available, artemiaAvailable);
    assert.equal(next.revision, 50);
    assert.throws(() => checkArtemiaRound({ ...current, artemiaAvailable: !artemiaAvailable }, previous), /wrong initial Artemia status/);
    assert.throws(() => checkArtemiaRound({ ...current, phase: 'reckoning' }, previous), /missed the new-round baseline/);
  }
});

test('terminal state preserves the actual last-round flag even when Rescue reaches its goal', () => {
  for (const available of [true, false]) {
    const baseline = checkArtemiaRound(frame({ rescueProgress: available ? 13 : 12, artemiaAvailable: available }));
    const terminal = frame({ status: 'game_over', phase: 'game_over', rescueProgress: 14, artemiaAvailable: available });
    assert.equal(checkArtemiaRound(terminal, baseline), baseline);
    assert.throws(() => checkArtemiaRound({ ...terminal, artemiaAvailable: !available }, baseline), /changed within the round/);
    assert.throws(() => checkArtemiaRound(terminal), /missed the new-round baseline/);
  }
});

test('missing baselines, skipped rounds and changed board identities cannot silently pass', () => {
  const previous = checkArtemiaRound(frame());
  for (const phase of ['exploration_reaction', 'creature_planning', 'reckoning', 'end_of_turn']) {
    assert.throws(() => checkArtemiaRound(frame({ phase })), /missed the new-round baseline/);
  }
  for (const roundNumber of [1, 4]) assert.throws(() => checkArtemiaRound(frame({ roundNumber }), previous), /skipped or reversed/);
  for (const change of [{ roomCode: 'OTHER' }, { boardFace: 'continuous' }, { rescueGoal: 12 }]) {
    assert.throws(() => checkArtemiaRound(frame(change), previous), /board identity changed/);
  }
  for (const roundNumber of [0, -1, 1.5, NaN, undefined]) assert.throws(() => checkArtemiaRound(frame({ roundNumber })), /valid round/);
  assert.throws(() => checkArtemiaRound(frame({ artemiaAvailable: 1 })), /must be boolean/);
  assert.throws(() => checkArtemiaRound(frame({ boardFace: 'unknown' })), /Unknown Artemia board face/);
});

test('a fresh match resets its baseline while retaining every phase and availability assertion', () => {
  const rematch = checkArtemiaRound(frame({ roundNumber: 1, boardFace: 'continuous', rescueProgress: 0, artemiaAvailable: false }));
  assert.equal(rematch.roundNumber, 1);
  assert.equal(rematch.available, false);
  const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8');
  assert.match(driver, /let observedBoardRound = null/);
  assert.match(driver, /observedBoardRound = await observeBoardStatus\(active\[0\], observedBoardRound, matchNumber\)/);
  assert.match(driver, /evidence\.artemiaRoundBaselines/);
  assert.match(driver, /evidence\.lastBoardObservation/);
  assert.match(driver, /FINAL ROUND · ARTEMIA WAS/);
  assert.match(driver, /Artemia status was not exposed to assistive technology/);
});

test('the driver waits for delayed private frames before observing a planning or terminal snapshot', async () => {
  const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8');
  const source = driver.slice(driver.indexOf('async function driveFullMatch'), driver.indexOf('async function assertGameOverDialog'));
  for (const status of ['playing', 'game_over']) {
    const events = [], observed = new Error('planning observed');
    const player = { latestPublic: frame({ status, revision: 30 }), latestPrivate: { revision: 29 } };
    const drive = vm.runInNewContext(`(${source})`, {
      assert, livePlayers: () => [player], observePhase: () => {},
      async waitForPairedState(current) {
        assert.equal(current, player);
        await Promise.resolve(); current.latestPrivate = { revision: 30 };
        events.push('paired'); return { publicState: current.latestPublic, privateState: current.latestPrivate };
      },
      async observeBoardStatus(current, baseline, match) {
        assert.equal(current.latestPrivate.revision, current.latestPublic.revision);
        assert.equal(baseline, null); assert.equal(match, 1); events.push('observed');
        if (status === 'playing') throw observed;
        return {};
      },
      checkpoint: () => events.push('terminal'),
      performOneAction: () => assert.fail('No action may precede the planning observation'),
    });
    if (status === 'playing') await assert.rejects(drive([player], 1, 'own-view'), error => error === observed);
    else assert.equal(await drive([player], 1, 'own-view'), 0);
    assert.deepEqual(events, status === 'playing' ? ['paired', 'observed'] : ['paired', 'observed', 'terminal']);
  }
});
