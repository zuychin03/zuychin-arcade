import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  beginNotAloneHunt, chooseNotAloneSurvivalCard, lockNotAloneHunt,
  placeNotAloneToken, playNotAloneHuntCard, playNotAloneSurvival, resolveNotAloneLocation,
  selectNotAlonePlaces, validateNotAloneState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';
import { createNotAloneUiFixture, NOT_ALONE_UI_FIXTURE_SCENARIOS } from './ui-fixtures.js';

const players = ['Creature', 'Hunted', 'Ally'].map((displayName, index) => ({ playerId: `p${index}`, displayName }));
test('fixture service forwards the requested face without relaxing the ordinary browser gate', () => {
  const service = readFileSync(new URL('./ui-fixture.ts', import.meta.url), 'utf8');
  assert.match(service, /createNotAloneUiFixture\(room.roomCode, players, scenario, initial.revision, initial.boardFace\)/);
  const driver = readFileSync(new URL('../../../mobile/scripts/not-alone-ui-smoke.cjs', import.meta.url), 'utf8');
  assert.match(driver, /assert\(host.latestPublic.boardFace === 'alternating', 'Lobby board-face choice did not reach authoritative game state'\)/);
});

for (const boardFace of ['continuous', 'alternating'] as const) {
  test(`every canonical fixture preserves requested ${boardFace} face in all viewer projections`, () => {
    for (const scenario of NOT_ALONE_UI_FIXTURE_SCENARIOS) {
      const state = createNotAloneUiFixture('FACE-TEST', players, scenario, 20, boardFace);
      validateNotAloneState(state);
      assert.equal(state.boardFace, boardFace, scenario);
      for (const player of players) {
        assert.equal(toNotAlonePublicState(state, player.playerId).boardFace, boardFace, scenario);
      }
      assert(state.revision >= 20);
    }
  });
}

for (const scenario of NOT_ALONE_UI_FIXTURE_SCENARIOS) {
  test(`canonical three-seat fixture: ${scenario}`, () => {
    const state = createNotAloneUiFixture('FIXTURE', players, scenario, 20);
    assert.equal(state.boardFace, 'continuous', 'Existing fixture callers retain the default face');
    validateNotAloneState(state);
    const mine = toNotAlonePrivateState(state, 'p1');
    assert.equal(mine.roomCode, 'FIXTURE');
    assert.equal(mine.revision, toNotAlonePublicState(state, 'p1').revision);
    assert.equal(toNotAlonePrivateState(state, 'p0').survivalChoiceCards.length, 0);
    assert.equal(toNotAlonePrivateState(state, 'p2').survivalChoiceCards.length, 0);
    if (scenario === 'sacrifice-rebase' || scenario === 'card-affordances') return;
    if (scenario === 'shelter-choice') {
      assert(mine.canChooseSurvivalCard);
      assert.equal(mine.canResolve, false);
      assert.equal(mine.resolutionOptions, null);
      const card = mine.survivalChoiceCards[0]!;
      const before = [...mine.survivalHand];
      assert.equal(chooseNotAloneSurvivalCard(state, 'p1', card, mine.revision).ok, true);
      assert.deepEqual(state.players.get('p1')!.survivalHand, [...before, card]);
      assert.equal(chooseNotAloneSurvivalCard(state, 'p1', card, mine.revision).ok, false);
    } else {
      const target = scenario === 'lair-beach' ? 4 : scenario === 'lair-source' ? 9 : 5;
      assert(mine.resolutionOptions?.copyablePlaceIds.includes(target));
      assert.equal(resolveNotAloneLocation(state, 'p1', { mode: 'copy', targetPlaceId: target, expectedRevision: state.revision }).ok, true);
      const next = toNotAlonePrivateState(state, 'p1');
      assert.equal(next.resolutionOptions?.effectivePlaceId, target);
      assert.equal(next.resolutionOptions?.mustUsePlacePower, true);
      assert.deepEqual(next.playedPlaces, scenario === 'gate-lair' ? [2] : [1]);
      assert.equal(resolveNotAloneLocation(state, 'p1', {
        mode: 'power', expectedRevision: state.revision,
        ...(target === 5 ? { targetPlaceId: 6 as const } : target === 4 ? { choice: 'charge' as const } : { choice: 'will' as const, targetPlayerId: 'p1' }),
      }).ok, true);
      if (target === 5) assert(state.players.get('p1')!.placeHand.includes(6));
      if (target === 4) assert(state.beachCharged);
      if (target === 9) assert.equal(state.players.get('p1')!.will, 3);
    }
    validateNotAloneState(state);
  });
}
test('card affordances preserve legal timing and progress into ready-to-lock Hunt planning', () => {
  const state = createNotAloneUiFixture('FIXTURE', players, 'card-affordances');
  const creature = () => toNotAlonePrivateState(state, 'p0');
  assert.equal(state.phase, 'hunted_planning');
  assert.equal(creature().lastDiscardedHuntCard, 'force_field');
  assert.deepEqual(creature().playableHuntCardIds, ['despair', 'flashback']);
  assert.deepEqual(toNotAlonePrivateState(state, 'p1').survivalHand, ['sacrifice', 'smokescreen']);
  assert.equal(playNotAloneSurvival(state, 'p1', { cardId: 'smokescreen', expectedRevision: state.revision }).ok, true);
  assert.deepEqual(toNotAlonePrivateState(state, 'p1').survivalHand, ['sacrifice']);
  for (const id of state.huntedOrder) assert.equal(selectNotAlonePlaces(state, id, [5], state.revision).ok, true);
  assert.equal(state.phase, 'exploration_reaction');
  assert.deepEqual(creature().playableHuntCardIds, ['despair']);
  assert.equal(playNotAloneHuntCard(state, 'p0', { cardId: 'flashback', placeIds: [1, 2], expectedRevision: state.revision }).ok, false);
  assert.equal(toNotAlonePrivateState(state, 'p1').canPass, false);
  assert.equal(beginNotAloneHunt(state, 'p0', state.revision).ok, true);
  assert.equal(creature().canHunt, true);
  assert.equal(creature().canLockHunt, false);
  assert.deepEqual(creature().playableHuntCardIds, ['anticipation']);
  assert.equal(playNotAloneHuntCard(state, 'p0', { cardId: 'anticipation', targetPlayerId: 'p1', expectedRevision: state.revision }).ok, true);
  assert.equal(placeNotAloneToken(state, 'p0', 'creature', [5], state.revision).ok, true);
  assert.equal(creature().canHunt, true);
  assert.equal(creature().canLockHunt, true);
  assert.equal(lockNotAloneHunt(state, 'p0', state.revision).ok, true);
  validateNotAloneState(state);
});
test('card affordances offer genuine configured Flashback and immediate Despair alternatives', () => {
  const configured = createNotAloneUiFixture('FIXTURE', players, 'card-affordances');
  assert.equal(playNotAloneHuntCard(configured, 'p0', { cardId: 'flashback', placeIds: [1, 2], expectedRevision: configured.revision }).ok, true);
  assert.equal(configured.copiedHuntCard, 'force_field');
  assert.deepEqual(toNotAlonePublicState(configured, 'p0').selectionBlockedPlaces, [1, 2]);
  validateNotAloneState(configured);

  const immediate = createNotAloneUiFixture('FIXTURE', players, 'card-affordances');
  assert.equal(playNotAloneHuntCard(immediate, 'p0', { cardId: 'despair', expectedRevision: immediate.revision }).ok, true);
  assert.deepEqual(toNotAlonePrivateState(immediate, 'p1').playableSurvivalCardIds, []);
  validateNotAloneState(immediate);
});
test('fixture rejects unsupported roster or scenario', () => {
  assert.throws(() => createNotAloneUiFixture('FIXTURE', players.slice(0, 2), 'shelter-choice'));
  assert.throws(() => createNotAloneUiFixture('FIXTURE', players, 'unknown' as 'shelter-choice'));
});
