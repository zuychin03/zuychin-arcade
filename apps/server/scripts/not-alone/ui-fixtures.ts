import assert from 'node:assert/strict';
import type { NotAloneBoardFace, NotAloneHuntCardId, NotAlonePlaceId, NotAloneSurvivalCardId } from '@zuychin-arcade/types';
import {
  beginNotAloneHunt, beginNotAloneReckoning, initNotAloneGame, lockNotAloneHunt,
  passNotAloneReaction, placeNotAloneToken, playNotAloneSurvival, resolveNotAloneLocation,
  revealNotAlone, selectNotAlonePlaces, validateNotAloneState, type NotAloneEngineResult,
  type NotAloneServerState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState } from '../../src/game/not-alone/publicState.js';

export const NOT_ALONE_UI_FIXTURE_SCENARIOS = [
  'sacrifice-rebase', 'card-affordances', 'shelter-choice', 'lair-rover', 'lair-beach', 'lair-source', 'gate-lair',
] as const;
export type NotAloneUiFixtureScenario = typeof NOT_ALONE_UI_FIXTURE_SCENARIOS[number];

function accept(result: NotAloneEngineResult): void {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}

function arrangeSurvival(state: NotAloneServerState, hands: NotAloneSurvivalCardId[][]): void {
  for (const id of state.huntedOrder) {
    state.survivalDeck.push(...state.players.get(id)!.survivalHand);
    state.players.get(id)!.survivalHand = [];
  }
  hands.forEach((hand, index) => {
    const player = state.players.get(state.huntedOrder[index]!)!;
    for (const card of hand) {
      const position = state.survivalDeck.indexOf(card);
      assert(position >= 0, `Missing canonical Survival card ${card}`);
      state.survivalDeck.splice(position, 1); player.survivalHand.push(card);
    }
  });
}

function arrangeHunt(state: NotAloneServerState, cards: NotAloneHuntCardId[]): void {
  state.huntDeck.push(...state.huntHand); state.huntHand = [];
  for (const card of cards) {
    const position = state.huntDeck.indexOf(card);
    assert(position >= 0, `Missing canonical Hunt card ${card}`);
    state.huntDeck.splice(position, 1); state.huntHand.push(card);
  }
}

function passAvailableReactions(state: NotAloneServerState): void {
  for (const id of state.huntedOrder) {
    if (toNotAlonePrivateState(state, id).canPass) accept(passNotAloneReaction(state, id, state.revision));
  }
}

export function createNotAloneUiFixture(
  roomCode: string,
  players: Array<{ playerId: string; displayName: string }>,
  scenario: NotAloneUiFixtureScenario,
  startingRevision = 0,
  boardFace: NotAloneBoardFace = 'continuous',
): NotAloneServerState {
  assert.equal(players.length, 3, 'Exactly one Creature and two Hunted are required');
  assert(NOT_ALONE_UI_FIXTURE_SCENARIOS.includes(scenario), 'Unknown Not Alone fixture');
  assert(Number.isSafeInteger(startingRevision) && startingRevision >= 0);
  const state = initNotAloneGame(roomCode, players, () => 0.42, boardFace);
  state.revision = startingRevision;
  state.planningWindowRevision = startingRevision; state.reactionWindowRevision = startingRevision;
  const ownerId = state.huntedOrder[0]!;
  const allyId = state.huntedOrder[1]!;
  const owner = state.players.get(ownerId)!;
  if (scenario === 'card-affordances') {
    arrangeSurvival(state, [['sacrifice', 'smokescreen'], []]);
    arrangeHunt(state, ['despair', 'anticipation', 'flashback']);
    const forceFieldIndex = state.huntDeck.indexOf('force_field');
    assert(forceFieldIndex >= 0);
    state.huntDeck.splice(forceFieldIndex, 1); state.huntDiscard.push('force_field');
    assert.deepEqual(toNotAlonePrivateState(state, state.creaturePlayerId).playableHuntCardIds, ['despair', 'flashback']);
    assert.deepEqual(toNotAlonePrivateState(state, ownerId).playableSurvivalCardIds, ['sacrifice', 'smokescreen']);
    validateNotAloneState(state);
    return state;
  }
  if (scenario === 'sacrifice-rebase') {
    arrangeSurvival(state, [['sacrifice'], ['smokescreen']]);
    arrangeHunt(state, ['despair', 'stasis', 'tracking']);
    for (const id of state.huntedOrder) accept(selectNotAlonePlaces(state, id, [5], state.revision));
    assert.equal(state.phase, 'exploration_reaction');
    assert(toNotAlonePrivateState(state, ownerId).playableSurvivalCardIds.includes('sacrifice'));
    assert(toNotAlonePrivateState(state, allyId).canPass);
    assert(toNotAlonePrivateState(state, state.creaturePlayerId).playableHuntCardIds.includes('despair'));
    validateNotAloneState(state);
    return state;
  }

  arrangeSurvival(state, [scenario === 'gate-lair' ? ['gate'] : ['adrenaline'], []]);
  arrangeHunt(state, ['anticipation', 'stasis', 'tracking']);
  const creaturePlace: NotAlonePlaceId = scenario === 'lair-beach' ? 4 : scenario === 'lair-source' ? 9 : 5;
  const ownerPlace: NotAlonePlaceId = scenario === 'shelter-choice' ? 7 : scenario === 'gate-lair' ? 2 : 1;
  if (ownerPlace === 7) {
    state.reserve[7] -= 1; owner.placeHand.push(7);
    for (const card of ['detector', 'dodge'] as const) {
      const index = state.survivalDeck.indexOf(card); assert(index >= 0);
      state.survivalDeck.splice(index, 1); state.survivalDeck.unshift(card);
    }
  }
  if (scenario === 'lair-source') owner.will = 2;
  validateNotAloneState(state);
  accept(selectNotAlonePlaces(state, ownerId, [ownerPlace], state.revision));
  accept(selectNotAlonePlaces(state, allyId, [2], state.revision));
  passAvailableReactions(state);
  accept(beginNotAloneHunt(state, state.creaturePlayerId, state.revision));
  accept(placeNotAloneToken(state, state.creaturePlayerId, 'creature', [creaturePlace], state.revision));
  accept(lockNotAloneHunt(state, state.creaturePlayerId, state.revision));
  passAvailableReactions(state);
  accept(revealNotAlone(state, state.creaturePlayerId, state.revision));
  if (state.pendingPlayerId === null) {
    passAvailableReactions(state);
    accept(beginNotAloneReckoning(state, state.creaturePlayerId, state.revision));
  }
  assert.equal(state.pendingPlayerId, ownerId);
  assert.equal(state.resolutionQueue[state.pendingCursor]?.stage, 'place');
  if (scenario === 'shelter-choice') {
    accept(resolveNotAloneLocation(state, ownerId, { mode: 'power', expectedRevision: state.revision }));
    assert.equal(state.pendingSurvivalChoice?.playerId, ownerId);
    assert.equal(state.pendingSurvivalChoice?.cards.length, 2);
    assert.deepEqual(owner.survivalHand, ['adrenaline']);
  } else if (scenario === 'gate-lair') {
    accept(playNotAloneSurvival(state, ownerId, { cardId: 'gate', targetPlaceId: 1, expectedRevision: state.revision }));
    assert.equal(toNotAlonePrivateState(state, ownerId).resolutionOptions?.effectivePlaceId, 1);
  }
  validateNotAloneState(state);
  return state;
}
