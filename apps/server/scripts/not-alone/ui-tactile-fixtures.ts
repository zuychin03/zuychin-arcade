import assert from 'node:assert/strict';
import { notAloneArtemiaAvailable, type NotAloneBoardFace, type NotAloneHuntCardId, type NotAlonePlaceId } from '@zuychin-arcade/types';
import {
  beginNotAloneHunt, beginNotAloneReckoning, endNotAloneTurn, initNotAloneGame,
  lockNotAloneHunt, passNotAloneReaction, placeNotAloneToken, playNotAloneHuntCard,
  playNotAloneSurvival, resolveNotAloneLocation, revealNotAlone, selectNotAlonePlaces,
  validateNotAloneState, type NotAloneEngineResult, type NotAloneServerState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState } from '../../src/game/not-alone/publicState.js';

export const TACTILE_NOT_ALONE_SCENARIOS = ['map-status', 'hidden-trails', 'sealed-choice', 'seven-final'] as const;
export type NotAloneTactileScenario = typeof TACTILE_NOT_ALONE_SCENARIOS[number];

function accept(result: NotAloneEngineResult): void {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}

function arrangeHunt(state: NotAloneServerState, cards: NotAloneHuntCardId[]): void {
  state.huntDeck.push(...state.huntHand);
  state.huntHand = [];
  for (const card of cards) {
    const index = state.huntDeck.indexOf(card);
    assert(index >= 0, `Missing canonical Hunt card ${card}`);
    state.huntDeck.splice(index, 1);
    state.huntHand.push(card);
  }
}

function passReactions(state: NotAloneServerState): void {
  for (const id of state.huntedOrder) {
    if (toNotAlonePrivateState(state, id).canPass) accept(passNotAloneReaction(state, id, state.revision));
  }
}

function prepareHunt(state: NotAloneServerState, destinations: NotAlonePlaceId[]): void {
  assert.equal(destinations.length, state.huntedOrder.length);
  state.huntedOrder.forEach((id, index) => accept(selectNotAlonePlaces(state, id, [destinations[index]!], state.revision)));
  passReactions(state);
  accept(beginNotAloneHunt(state, state.creaturePlayerId, state.revision));
}

function reachEndOfTurn(state: NotAloneServerState): void {
  accept(placeNotAloneToken(state, state.creaturePlayerId, 'creature', [1], state.revision));
  if (state.artemiaAvailable) accept(placeNotAloneToken(state, state.creaturePlayerId, 'artemia', [2], state.revision));
  accept(lockNotAloneHunt(state, state.creaturePlayerId, state.revision));
  passReactions(state);
  accept(revealNotAlone(state, state.creaturePlayerId, state.revision));
  for (let step = 0; state.phase === 'reckoning' && step < 40; step++) {
    assert.equal(state.pendingCardChoice, null);
    assert.equal(state.pendingSurvivalChoice, null);
    if (state.pendingPlayerId) {
      const mine = toNotAlonePrivateState(state, state.pendingPlayerId);
      assert(mine.resolutionOptions);
      accept(resolveNotAloneLocation(state, state.pendingPlayerId, {
        mode: 'recover', placeIds: mine.resolutionOptions.recoverablePlaceIds.slice(0, mine.resolutionOptions.recoverCount), expectedRevision: state.revision,
      }));
    } else {
      passReactions(state);
      accept(beginNotAloneReckoning(state, state.creaturePlayerId, state.revision));
    }
  }
  assert.equal(state.phase, 'end_of_turn', 'Fixture must reach a real End-of-Turn window');
  passReactions(state);
  assert.equal(toNotAlonePrivateState(state, state.creaturePlayerId).canEndTurn, true);
}

export function createNotAloneTactileFixture(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  scenario: NotAloneTactileScenario,
  startingRevision = 0,
  boardFace: NotAloneBoardFace = 'continuous',
): NotAloneServerState {
  assert(TACTILE_NOT_ALONE_SCENARIOS.includes(scenario), 'Unknown Not Alone tactile fixture');
  assert.equal(players.length, scenario === 'seven-final' ? 7 : 3, 'Wrong roster for Not Alone tactile fixture');
  assert(Number.isSafeInteger(startingRevision) && startingRevision >= 0, 'Invalid fixture revision');
  const state = initNotAloneGame(roomCode, players, () => 0.42, boardFace);
  state.revision = startingRevision;
  state.planningWindowRevision = startingRevision;
  state.reactionWindowRevision = startingRevision;
  for (const id of state.huntedOrder) {
    state.survivalDeck.push(...state.players.get(id)!.survivalHand);
    state.players.get(id)!.survivalHand = [];
  }
  arrangeHunt(state, scenario === 'map-status' ? ['tracking', 'force_field', 'interference']
    : scenario === 'sealed-choice' ? ['forbidden_zone', 'anticipation', 'persecution']
      : ['interference', 'anticipation', 'persecution']);

  if (scenario === 'seven-final') {
    // Arrange the track checkpoint, then reach the final action through real play.
    state.rescueProgress = state.rescueGoal - 1;
    state.artemiaAvailable = notAloneArtemiaAvailable(boardFace, state.rescueProgress, state.rescueGoal);
    validateNotAloneState(state);
    prepareHunt(state, state.huntedOrder.map(() => 4));
    reachEndOfTurn(state);
  } else if (scenario === 'sealed-choice') {
    prepareHunt(state, [4, 5]);
    accept(playNotAloneHuntCard(state, state.creaturePlayerId, { cardId: 'forbidden_zone', expectedRevision: state.revision }));
    assert.equal(state.pendingCardChoice?.kind, 'forbidden_zone');
    assert.equal(state.pendingCardChoice?.sealedChoices?.size, 0);
  } else {
    prepareHunt(state, [3, 3]);
    reachEndOfTurn(state);
    if (scenario === 'map-status') {
      accept(playNotAloneHuntCard(state, state.creaturePlayerId, { cardId: 'tracking', expectedRevision: state.revision }));
    }
    accept(endNotAloneTurn(state, state.creaturePlayerId, state.revision));
    if (scenario === 'map-status') {
      assert.equal(state.maxHuntCards, 2);
      accept(playNotAloneHuntCard(state, state.creaturePlayerId, { cardId: 'force_field', placeIds: [1, 2], expectedRevision: state.revision }));
      prepareHunt(state, [4, 5]);
      accept(playNotAloneHuntCard(state, state.creaturePlayerId, { cardId: 'interference', expectedRevision: state.revision }));
      assert.deepEqual([...state.selectionBlockedPlaces], [1, 2]);
      assert.deepEqual([...state.disabledPlaces], [4, 8]);
    } else {
      const index = state.survivalDeck.indexOf('smokescreen');
      assert(index >= 0);
      state.survivalDeck.splice(index, 1);
      state.players.get(state.huntedOrder[0]!)!.survivalHand.push('smokescreen');
      accept(playNotAloneSurvival(state, state.huntedOrder[0]!, { cardId: 'smokescreen', expectedRevision: state.revision }));
      assert(state.effects.smokescreen);
      assert(state.huntedOrder.every(id => state.players.get(id)!.discard.includes(3)));
    }
  }
  validateNotAloneState(state);
  return state;
}
