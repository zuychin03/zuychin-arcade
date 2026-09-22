import assert from 'node:assert/strict';
import test from 'node:test';
import { NOT_ALONE_HUNT_CARDS, NOT_ALONE_SURVIVAL_CARDS, notAloneArtemiaAvailable } from '@zuychin-arcade/types';
import {
  chooseNotAloneCardEffect, endNotAloneTurn, lockNotAloneHunt, placeNotAloneToken,
  selectNotAlonePlaces, validateNotAloneState, type NotAloneServerState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';
import { createNotAloneTactileFixture, TACTILE_NOT_ALONE_SCENARIOS } from './ui-tactile-fixtures.js';

const roster = (count: number) => Array.from({ length: count }, (_, index) => ({ playerId: `p${index}`, displayName: `Expedition Member ${String(index + 1).padStart(2, '0')}` }));

function conserved(state: NotAloneServerState): void {
  validateNotAloneState(state);
  const hunt = [...state.huntDeck, ...state.huntHand, ...state.huntDiscard, ...state.pendingHuntDiscard].sort();
  const survival = [...state.survivalDeck, ...state.survivalDiscard, ...state.pendingSurvivalDiscard,
    ...(state.pendingSurvivalChoice?.cards ?? []), ...[...state.players.values()].flatMap(player => player.survivalHand)].sort();
  assert.deepEqual(hunt, NOT_ALONE_HUNT_CARDS.map(card => card.id).sort());
  assert.deepEqual(survival, NOT_ALONE_SURVIVAL_CARDS.map(card => card.id).sort());
}

for (const boardFace of ['continuous', 'alternating'] as const) {
  for (const scenario of TACTILE_NOT_ALONE_SCENARIOS) {
    test(`${scenario} preserves canonical material, ${boardFace} face, revision and every owned projection`, () => {
      const players = roster(scenario === 'seven-final' ? 7 : 3);
      const state = createNotAloneTactileFixture('TACTILE', players, scenario, 30, boardFace);
      conserved(state);
      assert.equal(state.boardFace, boardFace);
      assert(state.revision > 30);
      assert.equal(state.status, 'playing');
      assert.equal(state.winner, null);
      assert.equal(state.endReason, null);
      assert.equal(state.artemiaAvailable, notAloneArtemiaAvailable(boardFace, state.rescueProgress, state.rescueGoal));
      for (const player of players) {
        const publicState = toNotAlonePublicState(state, player.playerId), mine = toNotAlonePrivateState(state, player.playerId);
        assert.equal(publicState.viewerPlayerId, player.playerId);
        assert.equal(mine.playerId, player.playerId);
        assert.equal(publicState.roomCode, 'TACTILE'); assert.equal(mine.roomCode, 'TACTILE');
        assert.equal(publicState.revision, state.revision); assert.equal(mine.revision, state.revision);
        assert.equal(publicState.boardFace, boardFace);
        assert.deepEqual(publicState.players.map(seat => seat.displayName), players.map(seat => seat.displayName));
        assert(publicState.players.every(seat => !seat.forfeited));
        assert.deepEqual(mine.placeHand, state.players.get(player.playerId)!.placeHand);
        assert.deepEqual(mine.survivalHand, state.players.get(player.playerId)!.survivalHand);
        assert.deepEqual(mine.revealedHuntedHands, {});
        assert.deepEqual(mine.survivalChoiceCards, []);
        assert.deepEqual(mine.huntHand, player.playerId === state.creaturePlayerId ? state.huntHand : []);
        for (const projected of publicState.players) {
          assert.equal('placeHand' in projected, false); assert.equal('survivalHand' in projected, false);
          assert.equal('selectedPlaces' in projected, false); assert.equal('huntHand' in projected, false);
          if (scenario !== 'seven-final') {
            assert.deepEqual(projected.revealedPlaces, []); assert.deepEqual(projected.originalRevealedPlaces, []);
          }
        }
      }
    });
  }

  test(`map-status earns two Hunt plays through Tracking on ${boardFace}, with distinct real effects`, () => {
    const state = createNotAloneTactileFixture('MAP', roster(3), 'map-status', 0, boardFace);
    assert.equal(state.roundNumber, 2); assert.equal(state.phase, 'creature_planning');
    assert.equal(state.maxHuntCards, 2);
    assert(state.huntDiscard.includes('tracking'));
    assert.deepEqual(state.activeHuntCards, ['force_field', 'interference']);
    assert.deepEqual([...state.selectionBlockedPlaces], [1, 2]);
    assert.deepEqual([...state.disabledPlaces], [4, 8]);
    assert.equal(state.selectionBlockedPlaces.has(4), false); assert.equal(state.disabledPlaces.has(1), false);
    assert.deepEqual(toNotAlonePrivateState(state, 'p1').selectedPlaces, [4]);
    assert.deepEqual(toNotAlonePrivateState(state, 'p2').selectedPlaces, [5]);
    assert.deepEqual(toNotAlonePrivateState(state, 'p0').selectedPlaces, []);
    assert.equal(toNotAlonePrivateState(state, 'p0').canHunt, true);
    assert.equal(placeNotAloneToken(state, 'p0', 'creature', [1], state.revision).ok, true);
    assert.equal(toNotAlonePrivateState(state, 'p0').canLockHunt, true);
    assert.equal(lockNotAloneHunt(state, 'p0', state.revision).ok, true);
    conserved(state);
  });

  test(`hidden-trails hides actual prior-round discards only from the Creature on ${boardFace}`, () => {
    const state = createNotAloneTactileFixture('TRAILS', roster(3), 'hidden-trails', 0, boardFace);
    assert.equal(state.roundNumber, 2); assert.equal(state.phase, 'hunted_planning');
    assert(state.effects.smokescreen);
    assert(state.pendingSurvivalDiscard.includes('smokescreen'));
    for (const viewer of ['p0', 'p1', 'p2']) {
      const projection = toNotAlonePublicState(state, viewer);
      for (const id of ['p1', 'p2']) {
        const player = projection.players.find(player => player.playerId === id)!;
        assert.equal(player.discardCount, 1);
        assert.deepEqual(player.discard, viewer === 'p0' ? [] : [3]);
        assert(!toNotAlonePrivateState(state, id).placeHand.includes(3));
      }
    }
    assert.equal(selectNotAlonePlaces(state, 'p1', [1], state.revision).ok, true);
    assert.deepEqual(toNotAlonePublicState(state, 'p0').players.find(player => player.playerId === 'p1')!.revealedPlaces, []);
    conserved(state);
  });

  test(`sealed-choice keeps both owners unsubmitted and all progress anonymous until legal commitments on ${boardFace}`, () => {
    const state = createNotAloneTactileFixture('SEALED', roster(3), 'sealed-choice', 0, boardFace);
    assert.equal(state.phase, 'creature_planning');
    assert.deepEqual(state.activeHuntCards, ['forbidden_zone']);
    for (const id of ['p0', 'p1', 'p2']) {
      const pending = toNotAlonePublicState(state, id).pendingCardChoice!;
      assert.deepEqual(pending, { kind: 'forbidden_zone', playerId: null, count: 1, submittedCount: 0, eligibleCount: 2 });
      const mine = toNotAlonePrivateState(state, id);
      assert.equal(mine.cardChoiceSubmitted, false);
      assert.equal(mine.canHunt, false); assert.equal(mine.canLockHunt, false);
      assert.equal(mine.cardChoice?.kind ?? null, id === 'p0' ? null : 'forbidden_zone');
    }
    assert.deepEqual(toNotAlonePrivateState(state, 'p1').cardChoice!.placeOptions, [1, 2, 3, 5]);
    assert.deepEqual(toNotAlonePrivateState(state, 'p2').cardChoice!.placeOptions, [1, 2, 3, 4]);
    const window = state.pendingCardChoice!.choiceWindowRevision!;
    assert.equal(chooseNotAloneCardEffect(state, 'p1', [2], window).ok, true);
    assert.equal(toNotAlonePrivateState(state, 'p1').cardChoiceSubmitted, true);
    assert.equal(toNotAlonePrivateState(state, 'p1').cardChoice, null);
    assert.equal(toNotAlonePrivateState(state, 'p2').cardChoiceSubmitted, false);
    for (const id of ['p0', 'p1', 'p2']) {
      const projection = toNotAlonePublicState(state, id);
      assert.equal(projection.pendingCardChoice!.submittedCount, 1);
      assert.equal(projection.pendingCardChoice!.playerId, null);
      assert(projection.players.every(player => player.discardCount === 0));
      assert.equal('sealedChoices' in projection.pendingCardChoice!, false);
    }
    assert.equal(chooseNotAloneCardEffect(state, 'p1', [3], window).ok, false);
    assert.equal(chooseNotAloneCardEffect(state, 'p2', [3], window).ok, true);
    assert.equal(state.pendingCardChoice, null);
    assert.deepEqual(state.players.get('p1')!.discard, [2]); assert.deepEqual(state.players.get('p2')!.discard, [3]);
    conserved(state);
  });

  test(`seven-final reaches a track win through one legal Finish round action on ${boardFace}`, () => {
    const players = roster(7), state = createNotAloneTactileFixture('FINAL', players, 'seven-final', 70, boardFace);
    assert(players.every(player => [...player.displayName].length === 20));
    assert.equal(state.phase, 'end_of_turn'); assert.equal(state.rescueProgress, 17); assert.equal(state.rescueGoal, 18);
    assert.equal(toNotAlonePrivateState(state, 'p0').canEndTurn, true);
    for (const player of players.slice(1)) assert.equal(toNotAlonePrivateState(state, player.playerId).canEndTurn, false);
    const revision = state.revision;
    assert.equal(endNotAloneTurn(state, 'p1', revision).ok, false);
    assert.equal(state.revision, revision);
    assert.equal(endNotAloneTurn(state, 'p0', revision).ok, true);
    assert.equal(state.status, 'game_over'); assert.equal(state.phase, 'game_over');
    assert.equal(state.endReason, 'track'); assert.equal(state.winner, 'hunted');
    assert.equal(state.rescueProgress, state.rescueGoal);
    assert.equal(state.players.size, 7); assert.equal(state.revision, revision + 1);
    for (const player of players) {
      const result = toNotAlonePublicState(state, player.playerId);
      assert.equal(result.players.length, 7); assert(result.players.every(seat => !seat.forfeited));
      assert.deepEqual(result.players.map(seat => seat.displayName), players.map(seat => seat.displayName));
    }
    conserved(state);
  });
}

test('tactile constructors reject unknown scenarios, wrong rosters and invalid revisions', () => {
  assert.throws(() => createNotAloneTactileFixture('BAD', roster(3), 'unknown' as 'map-status'), /Unknown/);
  for (const scenario of TACTILE_NOT_ALONE_SCENARIOS) {
    assert.throws(() => createNotAloneTactileFixture('BAD', roster(scenario === 'seven-final' ? 3 : 7), scenario), /Wrong roster/);
    for (const revision of [-1, 0.5, NaN, Infinity]) assert.throws(() => createNotAloneTactileFixture('BAD', roster(scenario === 'seven-final' ? 7 : 3), scenario, revision), /revision/);
  }
  assert.equal(createNotAloneTactileFixture('DEFAULT', roster(3), 'hidden-trails').boardFace, 'continuous');
});
