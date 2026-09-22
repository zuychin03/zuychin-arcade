import assert from 'node:assert/strict';
import { forfeitNotAlonePlayers, initNotAloneGame, playNotAloneSurvival, resolveNotAloneLocation, selectNotAlonePlaces, validateNotAloneState } from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';
import type { NotAlonePlaceId, NotAloneResolvePayload } from '@zuychin-arcade/types';
import { NOT_ALONE_SURVIVAL_BY_ID } from '@zuychin-arcade/types';

const roster = [{ playerId: 'creature', displayName: 'Creature' }, { playerId: 'hunted', displayName: 'Hunted' }];
const create = () => initNotAloneGame('ASTRA', roster, () => 0.42);
const snapshot = (value: unknown) => JSON.stringify(value, (_key, entry) => entry instanceof Map ? [...entry] : entry instanceof Set ? [...entry] : entry);

for (const mutate of [
  (state: ReturnType<typeof create>) => { state.players.get('hunted')!.will = Number.NaN; },
  (state: ReturnType<typeof create>) => { state.players.get('hunted')!.placeHand.push(11 as NotAlonePlaceId); },
  (state: ReturnType<typeof create>) => { state.rescueProgress = Number.NaN; },
  (state: ReturnType<typeof create>) => { state.reserve[6] = 0.5; state.reserve[1] = 0.5; },
  (state: ReturnType<typeof create>) => { state.huntedOrder[0] = 'creature'; },
  (state: ReturnType<typeof create>) => { state.turnOrder.reverse(); },
]) {
  const state = create(); mutate(state);
  assert.throws(() => validateNotAloneState(state), 'Malformed canonical state must be rejected');
}
assert.throws(() => initNotAloneGame('ASTRA', [{ playerId: '', displayName: 'Creature' }, roster[1]!]));
assert.throws(() => initNotAloneGame('ASTRA', roster, Math.random, 'unknown' as 'continuous'));

for (const invalidPlace of [11, -1, 6.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const state = create();
  const player = state.players.get('hunted')!;
  player.selectedPlaces = [5]; player.playedPlaces = [5];
  state.phase = 'reckoning'; state.reckoningStageIndex = 3;
  state.resolutionQueue = [{ playerId: 'hunted', placeIndex: 0, stage: 'place' }];
  state.pendingPlayerId = 'hunted';
  validateNotAloneState(state);
  const before = snapshot(state);
  const result = resolveNotAloneLocation(state, 'hunted', { mode: 'power', targetPlaceId: invalidPlace as NotAlonePlaceId, expectedRevision: state.revision });
  assert.equal(result.ok, false, `Rover must reject invalid Place ${invalidPlace}`);
  assert.equal(snapshot(state), before, 'Invalid Rover resolution must not mutate any state');
}

for (const playerId of ['creature', 'hunted']) {
  const state = create();
  assert.equal(toNotAlonePublicState(state, playerId).viewerPlayerId, playerId);
  assert.equal(toNotAlonePrivateState(state, playerId).roomCode, 'ASTRA');
}

{
  const state = initNotAloneGame('PRIVATE', [...roster, { playerId: 'ally', displayName: 'Ally' }], () => 0.42);
  const hunted = state.players.get('hunted')!;
  hunted.placeHand.splice(hunted.placeHand.indexOf(2), 1); hunted.discard.push(2);
  state.effects.smokescreen = true;
  assert.equal(selectNotAlonePlaces(state, 'hunted', [5], state.revision).ok, true);
  const before = snapshot(state);
  for (const viewer of ['creature', 'hunted', 'ally']) {
    const publicState = toNotAlonePublicState(state, viewer);
    const privateState = toNotAlonePrivateState(state, viewer);
    const publicHunted = publicState.players.find((player) => player.playerId === 'hunted')!;
    assert.deepEqual(publicHunted.revealedPlaces, [], 'Committed destination stays hidden');
    assert.deepEqual(publicHunted.discard, viewer === 'creature' ? [] : [2], 'Smokescreen is viewer-specific');
    assert.deepEqual(privateState.selectedPlaces, viewer === 'hunted' ? [5] : [], 'Only owner sees the locked destination');
    assert.equal(privateState.huntHand.length, viewer === 'creature' ? 3 : 0, 'Hunt hand remains Creature-only');
    publicState.players[1]!.discard.push(10); publicState.huntTokens.creature.push(10);
    publicState.reserve[6] = -1; publicState.log[0]!.text = 'tampered';
    privateState.placeHand.push(10); privateState.selectedPlaces.push(10); privateState.survivalHand.length = 0;
    assert.equal(snapshot(state), before, 'Projection mutation cannot alter authoritative state');
  }
}

{
  const state = create();
  const player = state.players.get('hunted')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 3;
  state.resolutionQueue = [{ playerId: 'hunted', placeIndex: 0, stage: 'place' }];
  state.pendingPlayerId = 'hunted'; state.huntTokens.creature = [5];
  validateNotAloneState(state);
  assert(toNotAlonePrivateState(state, 'hunted').resolutionOptions?.copyablePlaceIds.includes(5));
  const result = resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: 5, expectedRevision: state.revision });
  assert.equal(result.ok, true, 'An advertised Lair copy of Rover must have a legal continuation');
}

function lairCheckpoint(target: NotAlonePlaceId, persecution = false) {
  const state = initNotAloneGame('COPY', [...roster, { playerId: 'ally', displayName: 'Ally' }], () => 0.42);
  const player = state.players.get('hunted')!;
  player.placeHand = [1, 2, 3]; player.discard = [4, 5];
  player.selectedPlaces = [1]; player.playedPlaces = [1]; player.ignoreCreature = target === 1;
  const ally = state.players.get('ally')!; ally.selectedPlaces = [2]; ally.playedPlaces = [2];
  state.phase = 'reckoning'; state.reckoningStageIndex = 3;
  state.resolutionQueue = [{ playerId: 'hunted', placeIndex: 0, stage: 'place' }];
  state.pendingPlayerId = 'hunted'; state.huntTokens.creature = [target]; state.effects.persecution = persecution;
  validateNotAloneState(state);
  return state;
}

for (const target of [1, 2, 3, 4, 5, 6, 7, 8, 9] as NotAlonePlaceId[]) {
  for (const persecution of [false, true]) {
    const state = lairCheckpoint(target, persecution);
    const revision = state.revision;
    assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: target, expectedRevision: revision }).ok, true);
    const pending = snapshot(state.resolutionQueue);
    const options = toNotAlonePrivateState(state, 'hunted').resolutionOptions!;
    assert.equal(options.effectivePlaceId, target);
    assert.equal(options.mustUsePlacePower, true);
    assert.equal(options.canRecoverPlace, false);
    assert.equal(state.pendingPlayerId, 'hunted');
    assert.deepEqual(state.players.get('hunted')!.playedPlaces, [1]);
    const afterCopy = snapshot(state);
    assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: target, expectedRevision: revision }).ok, false);
    assert.equal(snapshot(state), afterCopy, 'Stale copy must not mutate the committed event');
    if (target !== 1) {
      assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: target, expectedRevision: state.revision }).ok, false);
      assert.equal(snapshot(state), afterCopy, 'A committed copied power cannot be switched');
    }
    const payload: NotAloneResolvePayload = { mode: 'power', expectedRevision: state.revision };
    if ([1, 2, 6].includes(target)) payload.placeIds = options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount);
    if (target === 4) payload.choice = 'charge';
    if (target === 5) payload.targetPlaceId = options.roverPlaceIds[0];
    if (target === 9) payload.choice = 'card';
    assert.equal(snapshot(state.resolutionQueue), pending, 'Copy choices do not open another encounter');
    assert.equal(resolveNotAloneLocation(state, 'hunted', payload).ok, true, `Copied Place ${target} resolves`);
    validateNotAloneState(state);

    const departure = lairCheckpoint(target, persecution);
    assert.equal(resolveNotAloneLocation(departure, 'hunted', { mode: 'copy', targetPlaceId: target, expectedRevision: departure.revision }).ok, true);
    assert.equal(forfeitNotAlonePlayers(departure, ['hunted'], departure.revision).ok, true, `Forfeited copied Place ${target} settles`);
    assert.notEqual(departure.pendingPlayerId, 'hunted');
    validateNotAloneState(departure);
  }
}

{
  const state = lairCheckpoint(5);
  const player = state.players.get('hunted')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2];
  for (const zone of [state.survivalDeck, state.survivalDiscard, ...[...state.players.values()].map((seat) => seat.survivalHand)]) {
    const index = zone.indexOf('gate'); if (index >= 0) zone.splice(index, 1);
  }
  player.survivalHand.push('gate');
  assert.equal(playNotAloneSurvival(state, 'hunted', { cardId: 'gate', targetPlaceId: 1, expectedRevision: state.revision }).ok, true);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: 5, expectedRevision: state.revision }).ok, true);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'power', targetPlaceId: 6, expectedRevision: state.revision }).ok, true);
  assert.deepEqual(player.playedPlaces, [2], 'Gate to Lair to Rover retains the original physical card');
  assert(player.placeHand.includes(6));
  validateNotAloneState(state);
}

for (const target of [5, 10] as NotAlonePlaceId[]) {
  const state = lairCheckpoint(target);
  if (target === 5) {
    const player = state.players.get('hunted')!;
    for (const place of [6, 7, 8, 9, 10] as NotAlonePlaceId[]) { state.reserve[place] -= 1; player.placeHand.push(place); }
  }
  validateNotAloneState(state);
  const before = snapshot(state);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: target, expectedRevision: state.revision }).ok, false);
  assert.equal(snapshot(state), before, 'Forbidden Artefact or unavailable Rover copy cannot mutate state');
}

{
  const state = lairCheckpoint(2, true);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: 2, expectedRevision: state.revision }).ok, true);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'power', placeIds: [], expectedRevision: state.revision }).ok, true);
  assert(state.players.get('hunted')!.returnPlayed.has(1), 'Persecution can return the physical Lair instead of recovering another card');
  assert.deepEqual(state.players.get('hunted')!.discard, [4, 5]);
}

{
  const state = lairCheckpoint(1);
  const player = state.players.get('hunted')!;
  player.placeHand.push(...player.discard); player.discard = [];
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'copy', targetPlaceId: 1, expectedRevision: state.revision }).ok, true);
  assert.equal(resolveNotAloneLocation(state, 'hunted', { mode: 'power', placeIds: [], expectedRevision: state.revision }).ok, true);
  assert.notEqual(state.pendingPlayerId, 'hunted', 'Empty Lair recovery remains a legal completing no-op');
}

// Licensed clarification: https://en.doc.boardgamearena.com/Gamehelpnotalone#Wrong_Track
assert.equal(NOT_ALONE_SURVIVAL_BY_ID.wrong_track.summary,
  'Move the Creature token, or the Target token while Clone is active, to an adjacent place.');
for (const clone of [false, true]) {
  const state = create();
  const player = state.players.get('hunted')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2];
  state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.reactionWindowRevision = state.revision;
  state.huntTokens.creature = [2]; state.huntTokens.target = [2];
  const huntCard = clone ? 'clone' : 'scream';
  for (const zone of [state.huntDeck, state.huntHand]) {
    const index = zone.indexOf(huntCard); if (index >= 0) zone.splice(index, 1);
  }
  state.activeHuntCards = [huntCard]; state.pendingHuntDiscard = [huntCard]; state.effects.clone = clone;
  for (const zone of [state.survivalDeck, ...[...state.players.values()].map((seat) => seat.survivalHand)]) {
    const index = zone.indexOf('wrong_track'); if (index >= 0) zone.splice(index, 1);
  }
  player.survivalHand.push('wrong_track');
  validateNotAloneState(state);
  const mine = toNotAlonePrivateState(state, 'hunted');
  assert(mine.playableSurvivalCardIds.includes('wrong_track'));
  assert(mine.survivalOptions.wrongTrackCreaturePlaceIds.includes(3));
  assert.equal(mine.survivalOptions.wrongTrackTargetPlaceIds.includes(3), clone);
  if (!clone) {
    assert.deepEqual(mine.survivalOptions.wrongTrackTargetPlaceIds, []);
    const before = snapshot(state);
    assert.equal(playNotAloneSurvival(state, 'hunted', {
      cardId: 'wrong_track', token: 'target', placeIds: [3], expectedRevision: state.revision,
    }).ok, false);
    assert.equal(snapshot(state), before, 'A non-Clone Target cannot be moved by Wrong Track');
  }
  const token = clone ? 'target' : 'creature';
  assert.equal(playNotAloneSurvival(state, 'hunted', {
    cardId: 'wrong_track', token, placeIds: [3], expectedRevision: state.revision,
  }).ok, true);
  assert.deepEqual(state.huntTokens[token], [3]);
  assert.deepEqual(state.huntTokens[clone ? 'creature' : 'target'], [2]);
  assert(!player.survivalHand.includes('wrong_track'));
  validateNotAloneState(state);
}

console.log('Astra Not Alone focused regressions passed, including 18 copy resolutions, 18 pending-copy forfeits, Gate nesting and two Wrong Track target cases.');
