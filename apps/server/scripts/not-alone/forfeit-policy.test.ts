import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotAlonePlaceId } from '@zuychin-arcade/types';
import { notAloneTrackGoals } from '@zuychin-arcade/types';
import {
  beginNotAloneHunt, beginNotAloneReckoning, chooseNotAloneRiverDestination,
  endNotAloneTurn, forfeitNotAlonePlayers, giveUpNotAlone, initNotAloneGame,
  lockNotAloneHunt, passNotAloneReaction, placeNotAloneToken, resolveNotAloneLocation,
  revealNotAlone, selectNotAlonePlaces, settleNotAloneAutopilot, validateNotAloneState,
  type NotAloneEngineResult, type NotAloneServerState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';
import { createNotAloneUiFixture } from './ui-fixtures.js';

const roster = (count: number) => Array.from({ length: count }, (_, index) => ({ playerId: `p${index}`, displayName: `Seat ${index}` }));
const serialise = (value: unknown) => JSON.stringify(value, (_key, entry) => entry instanceof Map || entry instanceof Set ? [...entry] : entry);
function accept(state: NotAloneServerState, result: NotAloneEngineResult) {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  validateNotAloneState(state);
}

function step(state: NotAloneServerState) {
  settleNotAloneAutopilot(state);
  if (state.status !== 'playing') return;
  assert.equal(state.pendingCardChoice, null);
  assert.equal(state.pendingSurvivalChoice, null);
  for (const id of state.huntedOrder) {
    const mine = toNotAlonePrivateState(state, id);
    if (mine.canSelect) {
      const choices = mine.placeHand.slice(0, mine.requiredSelectionCount);
      if (choices.length < mine.requiredSelectionCount) accept(state, giveUpNotAlone(state, id, state.revision));
      else accept(state, selectNotAlonePlaces(state, id, choices, state.revision));
      return;
    }
    if (mine.canPass) { accept(state, passNotAloneReaction(state, id, state.revision)); return; }
    if (mine.canChooseRiver) { accept(state, chooseNotAloneRiverDestination(state, id, mine.selectedPlaces[0]!, state.revision)); return; }
    if (mine.canResolve) {
      const options = mine.resolutionOptions!;
      accept(state, resolveNotAloneLocation(state, id, {
        mode: 'recover', placeIds: options.canRecoverPlace ? options.recoverablePlaceIds.slice(0, options.recoverCount) : [], expectedRevision: state.revision,
      }));
      return;
    }
  }
  const creature = state.creaturePlayerId;
  const mine = toNotAlonePrivateState(state, creature);
  if (mine.canBeginHunt) accept(state, beginNotAloneHunt(state, creature, state.revision));
  else if (mine.canHunt) {
    accept(state, placeNotAloneToken(state, creature, 'creature', [10], state.revision));
    if (state.artemiaAvailable) accept(state, placeNotAloneToken(state, creature, 'artemia', [9], state.revision));
    accept(state, lockNotAloneHunt(state, creature, state.revision));
  } else if (mine.canReveal) accept(state, revealNotAlone(state, creature, state.revision));
  else if (mine.canBeginReckoning) accept(state, beginNotAloneReckoning(state, creature, state.revision));
  else if (mine.canEndTurn) accept(state, endNotAloneTurn(state, creature, state.revision));
  else assert.fail(`Unowned pending step: ${state.phase}`);
}

function finishRound(state: NotAloneServerState) {
  const round = state.roundNumber;
  for (let steps = 0; state.status === 'playing' && state.roundNumber === round; steps += 1) {
    assert(steps < 150, 'Round must remain live after a departure');
    step(state);
  }
}

function noPrivateActions(state: NotAloneServerState, id: string) {
  const mine = toNotAlonePrivateState(state, id);
  for (const [key, value] of Object.entries(mine)) if (key.startsWith('can')) assert.equal(value, false, `${key} still enabled for forfeited seat`);
  assert.equal(mine.resolutionOptions, null);
  assert.equal(mine.cardChoice, null);
  assert.deepEqual(mine.playableSurvivalCardIds, []);
  assert.deepEqual(mine.resistOptions, []);
}

for (let count = 3; count <= 7; count += 1) {
  for (const boardFace of ['continuous', 'alternating'] as const) {
    test(`${count} seats/${boardFace}: ghost only this round, canonical retirement and fixed original setup`, () => {
      const state = initNotAloneGame('RETIRE', roster(count), () => 0.42, boardFace);
      const retired = state.players.get('p1')!;
      state.reserve[7] -= 1; retired.placeHand.push(7); retired.riverNext = true;
      const returnedSurvival = [...retired.survivalHand];
      accept(state, forfeitNotAlonePlayers(state, ['p1'], state.revision));
      assert(state.huntedOrder.includes('p1'));
      assert.equal(retired.selectedPlaces.length, 2, 'Current River obligation is selected legally');
      noPrivateActions(state, 'p1');
      finishRound(state);
      assert.equal(state.roundNumber, 2);
      assert(!state.huntedOrder.includes('p1'));
      assert(!state.turnOrder.includes('p1'));
      assert.equal(state.players.size, count);
      assert(retired.placeHand.includes(7), 'Retired advanced Place remains out of play, not in reserve');
      assert.equal(state.reserve[7], count < 5 ? 1 : 2);
      assert.deepEqual(retired.survivalHand, []);
      assert(returnedSurvival.every((card) => state.survivalDiscard.includes(card)));
      assert.deepEqual([state.rescueGoal, state.assimilationGoal], Object.values(notAloneTrackGoals(count)));
      noPrivateActions(state, 'p1');
      const publicState = toNotAlonePublicState(state, 'p0');
      assert.equal(publicState.players.length, count);
      assert(publicState.players.find((player) => player.playerId === 'p1')!.forfeited);
      assert(!toNotAlonePrivateState(state, 'p0').huntOptions.targetPlayerIds.includes('p1'));
      const original = serialise(state);
      publicState.huntedOrder.push('p1'); publicState.players[1]!.discard.push(10);
      assert.equal(serialise(state), original, 'Historical projection must remain detached');
      for (const command of [
        () => selectNotAlonePlaces(state, 'p1', [7], state.revision),
        () => giveUpNotAlone(state, 'p1', state.revision),
        () => resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [], expectedRevision: state.revision }),
      ]) { assert.equal(command().ok, false); assert.equal(serialise(state), original); }
      const archived = serialise(retired);
      finishRound(state);
      assert.equal(serialise(retired), archived, 'No next-round catch, exhaustion, draw or cleanup may touch retired seats');
      state.effects.smokescreen = true;
      assert.deepEqual(toNotAlonePublicState(state, 'p0').players[1]!.discard, []);
      assert.deepEqual(toNotAlonePublicState(state, 'p2').players[1]!.discard, retired.discard);
      validateNotAloneState(state);
      const goals = state.rescueGoal; state.rescueGoal -= 1;
      assert.throws(() => validateNotAloneState(state), /Original track goals changed/); state.rescueGoal = goals;
      retired.selectedPlaces = [7]; assert.throws(() => validateNotAloneState(state), /Retired Hunted/);
    });
  }
}

test('A batch retires in original order without returning advanced supply', () => {
  const state = initNotAloneGame('BATCH', roster(7), () => 0.42);
  accept(state, forfeitNotAlonePlayers(state, ['p4', 'p1', 'p3', 'p4'], state.revision));
  finishRound(state);
  assert.deepEqual(state.huntedOrder, ['p2', 'p5', 'p6']);
  assert.deepEqual(state.turnOrder, ['p0', 'p2', 'p5', 'p6']);
  assert.equal(state.reserve[6], 3, 'Original six-Hunted reserve remains fixed');
});

for (const pending of ['shelter-choice', 'lair-rover', 'lair-beach', 'lair-source', 'gate-lair'] as const) {
  test(`${pending}: committed nested choice settles before retirement`, () => {
    const state = createNotAloneUiFixture('NESTED', roster(3), pending);
    if (pending !== 'shelter-choice') accept(state, resolveNotAloneLocation(state, 'p1', {
      mode: 'copy', targetPlaceId: (pending === 'lair-beach' ? 4 : pending === 'lair-source' ? 9 : 5) as NotAlonePlaceId,
      expectedRevision: state.revision,
    }));
    accept(state, forfeitNotAlonePlayers(state, ['p1'], state.revision));
    assert.notEqual(state.pendingPlayerId, 'p1');
    assert.equal(state.pendingSurvivalChoice, null);
    noPrivateActions(state, 'p1');
    finishRound(state);
    assert.deepEqual(state.huntedOrder, ['p2']);
    validateNotAloneState(state);
  });
}

for (let count = 2; count <= 7; count += 1) {
  for (const departure of ['creature', 'hunted', 'all'] as const) {
    test(`${count} seats: ${departure} terminal departure remains atomic and immutable`, () => {
      const state = initNotAloneGame('TERMINAL', roster(count), () => 0.42);
      const ids = departure === 'creature' ? ['p0'] : departure === 'hunted' ? [...state.huntedOrder] : [...state.turnOrder].reverse();
      accept(state, forfeitNotAlonePlayers(state, ids, state.revision));
      assert.equal(state.status, 'game_over'); assert.equal(state.endReason, 'forfeit');
      assert.equal(state.winner, departure === 'creature' ? 'hunted' : departure === 'hunted' ? 'creature' : null);
      const terminal = serialise(state);
      assert.equal(forfeitNotAlonePlayers(state, state.turnOrder, state.revision).ok, false);
      settleNotAloneAutopilot(state);
      assert.equal(serialise(state), terminal);
    });
  }
}

test('Shelter pending cards remain conserved on immediate abandonment', () => {
  const state = createNotAloneUiFixture('SHELTER-END', roster(3), 'shelter-choice');
  const pendingCards = [...state.pendingSurvivalChoice!.cards];
  accept(state, forfeitNotAlonePlayers(state, ['p0', 'p1', 'p2'], state.revision));
  assert.equal(state.winner, null);
  assert.equal(state.pendingSurvivalChoice, null);
  assert(pendingCards.every((card) => state.survivalDiscard.includes(card)));
});

test('Final Rescue step ends naturally without starting a new retired-seat round', () => {
  const state = initNotAloneGame('FINAL', roster(3), () => 0.42);
  accept(state, forfeitNotAlonePlayers(state, ['p1'], state.revision));
  state.rescueProgress = state.rescueGoal - 1;
  finishRound(state);
  assert.equal(state.winner, 'hunted'); assert.equal(state.endReason, 'track');
  assert.equal(state.roundNumber, 1);
  assert(state.players.get('p1')!.forfeited, 'Team win never restores departed eligibility');
});
