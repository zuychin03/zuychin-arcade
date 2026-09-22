import type {
  NotAloneBoardFace,
  NotAloneHuntCardId,
  NotAlonePlaceId,
  NotAloneResolvePayload,
  NotAloneSurvivalCardId,
  NotAloneSurvivalPayload,
} from '@zuychin-arcade/types';
import {
  NOT_ALONE_HUNT_CARDS,
  NOT_ALONE_CONTENT_SET,
  NOT_ALONE_MODE_DESCRIPTION,
  NOT_ALONE_RULES_VERSION,
  NOT_ALONE_SURVIVAL_CARDS,
  notAloneAdvancedCopies,
  notAloneArtemiaAvailable,
  notAloneTrackGoals,
} from '@zuychin-arcade/types';
import {
  beginNotAloneHunt,
  beginNotAloneReckoning,
  chooseNotAloneCardEffect,
  chooseNotAloneRiverDestination,
  chooseNotAloneSurvivalCard,
  endNotAloneTurn,
  forfeitNotAlonePlayers,
  giveUpNotAlone,
  initNotAloneGame,
  lockNotAloneHunt,
  notAloneResolutionOptions,
  passNotAloneReaction,
  placeNotAloneToken,
  playNotAloneHuntCard,
  playNotAloneSurvival,
  resolveNotAloneLocation,
  revealNotAlone,
  resistNotAlone,
  selectNotAlonePlaces,
  settleNotAloneAutopilot,
  validateNotAloneState,
  type NotAloneEngineResult,
  type NotAloneServerState,
} from '../../src/game/not-alone/engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function roster(count: number): Array<{ playerId: string; displayName: string }> {
  return Array.from({ length: count }, (_, index) => ({ playerId: `p${index}`, displayName: `Player ${index}` }));
}

function removeOne<T>(items: T[], value: T): void {
  const index = items.indexOf(value);
  if (index >= 0) items.splice(index, 1);
}

function allPhysicalSurvivalCards(state: NotAloneServerState): NotAloneSurvivalCardId[] {
  return [
    ...state.survivalDeck,
    ...state.survivalDiscard,
    ...state.pendingSurvivalDiscard,
    ...(state.pendingSurvivalChoice?.cards ?? []),
    ...[...state.players.values()].flatMap((player) => player.survivalHand),
  ];
}

function allPhysicalHuntCards(state: NotAloneServerState): NotAloneHuntCardId[] {
  return [...state.huntDeck, ...state.huntDiscard, ...state.pendingHuntDiscard, ...state.huntHand];
}

function assertConservation(state: NotAloneServerState): void {
  validateNotAloneState(state);
  const originalHunted = [...state.players.values()].filter((player) => player.role === 'hunted');
  const survival = allPhysicalSurvivalCards(state);
  const hunt = allPhysicalHuntCards(state);
  const survivalManifest = NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id).sort();
  const huntManifest = NOT_ALONE_HUNT_CARDS.map((card) => card.id).sort();
  assert(survival.length === 15 && new Set(survival).size === 15, 'Survival cards must remain unique and conserved');
  assert(hunt.length === 20 && new Set(hunt).size === 20, 'Hunt cards must remain unique and conserved');
  assert([...survival].sort().join(',') === survivalManifest.join(','), 'Survival manifest changed');
  assert([...hunt].sort().join(',') === huntManifest.join(','), 'Hunt manifest changed');
  for (const player of originalHunted) {
    const playerId = player.playerId;
    for (const basic of [1, 2, 3, 4, 5] as NotAlonePlaceId[]) {
      assert(player.placeHand.filter((id) => id === basic).length + player.discard.filter((id) => id === basic).length === 1,
        `${playerId} lost or duplicated basic Place ${basic}`);
    }
    assert(player.playedPlaces.every((place) => player.placeHand.includes(place)
      || (player.returnPlayed.has(place) && player.discard.includes(place))), `${playerId} played Place left its authoritative owned zone`);
    assert(player.playedPlaces.length === player.selectedPlaces.length, `${playerId} slot identities diverged`);
  }
  const copies = notAloneAdvancedCopies(originalHunted.length);
  for (const advanced of [6, 7, 8, 9, 10] as NotAlonePlaceId[]) {
    const owned = originalHunted.reduce((total, player) => {
      return total + player.placeHand.filter((place) => place === advanced).length + player.discard.filter((place) => place === advanced).length;
    }, 0);
    assert(owned + state.reserve[advanced] === copies, `Advanced Place ${advanced} is not conserved`);
  }
  assert(state.activeHuntCards.every((card) => state.pendingHuntDiscard.includes(card) || state.huntDiscard.includes(card)), 'Active Hunt card lacks a physical discard zone');
  assert(state.rescueProgress >= 0 && state.rescueProgress <= state.rescueGoal, 'Rescue progress is out of range');
  assert(state.assimilationProgress >= 0 && state.assimilationProgress <= state.assimilationGoal, 'Assimilation progress is out of range');
  if (state.pendingPlayerId && state.phase === 'reckoning') {
    const pending = state.resolutionQueue[state.pendingCursor];
    assert(pending?.playerId === state.pendingPlayerId && pending.placeIndex === state.pendingPlaceIndex, 'Pending resolver and physical slot diverged');
  }
  const publicState = toNotAlonePublicState(state, state.creaturePlayerId);
  for (const playerId of state.huntedOrder) {
    const player = state.players.get(playerId)!;
    const expected = player.placeHand.length - player.playedPlaces.filter((place) => !player.returnPlayed.has(place)).length;
    assert(publicState.players.find((entry) => entry.playerId === playerId)?.handCount === expected, 'Public hand count leaked a played or returned physical card');
  }
}

function act(state: NotAloneServerState, result: NotAloneEngineResult, label: string): void {
  assert(result.ok, `${label}: ${result.ok ? '' : result.reason}`);
  assertConservation(state);
}

function rejectAct(state: NotAloneServerState, result: NotAloneEngineResult, label: string): void {
  assert(!result.ok, `${label}: invalid action was accepted`);
  assertConservation(state);
}

function moveHuntToHand(state: NotAloneServerState, cardId: NotAloneHuntCardId): void {
  removeOne(state.huntDeck, cardId);
  removeOne(state.huntDiscard, cardId);
  removeOne(state.pendingHuntDiscard, cardId);
  removeOne(state.huntHand, cardId);
  state.activeHuntCards = state.activeHuntCards.filter((card) => card !== cardId);
  state.huntHand.push(cardId);
}

function moveSurvivalToHand(state: NotAloneServerState, playerId: string, cardId: NotAloneSurvivalCardId): void {
  removeOne(state.survivalDeck, cardId);
  removeOne(state.survivalDiscard, cardId);
  removeOne(state.pendingSurvivalDiscard, cardId);
  if (state.pendingSurvivalChoice) removeOne(state.pendingSurvivalChoice.cards, cardId);
  for (const id of state.huntedOrder) removeOne(state.players.get(id)!.survivalHand, cardId);
  state.players.get(playerId)!.survivalHand.push(cardId);
}

function movePlaceToDiscard(state: NotAloneServerState, playerId: string, placeId: NotAlonePlaceId): void {
  const player = state.players.get(playerId)!;
  removeOne(player.placeHand, placeId);
  if (!player.discard.includes(placeId)) player.discard.push(placeId);
}

function grantAdvancedPlace(state: NotAloneServerState, playerId: string, placeId: NotAlonePlaceId): void {
  assert(placeId >= 6 && state.reserve[placeId] > 0, `Advanced Place ${placeId} is unavailable`);
  state.reserve[placeId] -= 1;
  state.players.get(playerId)!.placeHand.push(placeId);
}

function openPlaceResolution(state: NotAloneServerState, playerId: string, placeId: NotAlonePlaceId): void {
  const player = state.players.get(playerId)!;
  player.selectedPlaces = [placeId]; player.playedPlaces = [placeId];
  state.phase = 'reckoning'; state.reckoningStageIndex = 3;
  state.resolutionQueue = [{ playerId, placeIndex: 0, stage: 'place' }];
  state.pendingCursor = 0; state.pendingPlayerId = playerId; state.pendingPlaceIndex = 0;
}

function prepareAllHuntedForHunt(state: NotAloneServerState, placeId: NotAlonePlaceId = 1): void {
  for (const playerId of state.huntedOrder) {
    const player = state.players.get(playerId)!;
    player.selectedPlaces = [placeId]; player.playedPlaces = [placeId];
  }
}

function activateHuntCard(state: NotAloneServerState, cardId: NotAloneHuntCardId): void {
  moveHuntToHand(state, cardId);
  removeOne(state.huntHand, cardId);
  state.activeHuntCards.push(cardId);
  state.pendingHuntDiscard.push(cardId);
}

function resolveAutomatically(state: NotAloneServerState, playerId: string, usePlacePower = false): NotAloneResolvePayload {
  const options = notAloneResolutionOptions(state, playerId);
  assert(options, 'Pending player has no authoritative resolution options');
  const payload: NotAloneResolvePayload = { mode: 'recover', placeIds: [], expectedRevision: state.revision };
  if (options.screamDiscardCount === 2) {
    payload.huntChoice = 'discard';
    payload.huntPlaceIds = options.screamDiscardPlaceIds.slice(0, 2);
  } else if (options.canLoseWillForScream) payload.huntChoice = 'will';
  if (options.toxinSurvivalCardIds.length) payload.huntSurvivalCardId = options.toxinSurvivalCardIds[0];
  if (options.stage === 'place' && usePlacePower && options.canUsePlacePower) {
    payload.mode = 'power';
    if ([1, 2, 6].includes(options.effectivePlaceId)) payload.placeIds = options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount);
    else if (options.effectivePlaceId === 4) payload.choice = options.beachChoices[0];
    else if (options.effectivePlaceId === 5) payload.targetPlaceId = options.roverPlaceIds[0];
    else if (options.effectivePlaceId === 9) {
      payload.choice = options.sourceChoices[0];
      if (payload.choice === 'will') payload.targetPlayerId = options.healTargetPlayerIds[0];
    }
  } else if (options.stage === 'place' && options.canRecoverPlace) {
    payload.placeIds = options.recoverablePlaceIds.slice(0, options.recoverCount);
  }
  return payload;
}

function passEligibleHunted(state: NotAloneServerState): void {
  const windowRevision = state.reactionWindowRevision;
  for (const playerId of state.huntedOrder) {
    if (toNotAlonePrivateState(state, playerId).canPass) {
      act(state, passNotAloneReaction(state, playerId, windowRevision), `${playerId} passes`);
    }
  }
}

type FullGamePolicy = 'safe' | 'hunt' | 'mixed';

function assignMixedGameHands(state: NotAloneServerState): void {
  const phaseOneCards: NotAloneSurvivalCardId[] = ['ingenuity', 'adrenaline', 'sacrifice', 'sixth_sense', 'smokescreen', 'strike_back'];
  state.survivalDeck = NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id);
  state.survivalDiscard = []; state.pendingSurvivalDiscard = []; state.pendingSurvivalChoice = null;
  for (const playerId of state.huntedOrder) state.players.get(playerId)!.survivalHand = [];
  state.huntedOrder.forEach((playerId, index) => moveSurvivalToHand(state, playerId, phaseOneCards[index]!));
  state.huntDeck = NOT_ALONE_HUNT_CARDS.map((card) => card.id);
  state.huntDiscard = []; state.pendingHuntDiscard = []; state.huntHand = []; state.activeHuntCards = [];
  for (const cardId of ['anticipation', 'fierceness', 'stasis'] as NotAloneHuntCardId[]) moveHuntToHand(state, cardId);
}

function mixedExplorerDestination(state: NotAloneServerState, playerId: string, count: number): NotAlonePlaceId[] {
  const player = state.players.get(playerId)!;
  const route: NotAlonePlaceId[] = [5, 6, 5, 6, 7, 6, 5, 6, 8, 6, 5, 6, 9, 6, 5, 6, 10];
  const desired = route[state.roundNumber - 1];
  const legal = player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place));
  if (count === 1 && desired && legal.includes(desired)) return [desired];
  return legal.slice(0, count);
}

function runFullGame(playerCount: number, face: NotAloneBoardFace, seed: number, policy: FullGamePolicy,
  departurePhase?: NotAloneServerState['phase']): number {
  const state = initNotAloneGame(`SIM-${playerCount}-${face}-${seed}`, roster(playerCount), seeded(seed), face);
  if (policy === 'mixed') assignMixedGameHands(state);
  assertConservation(state);
  let commands = 0;
  let departed = false;
  const retiredSnapshots = new Map<string, string>();
  const serialisePlayer = (id: string) => JSON.stringify(state.players.get(id), (_key, value) => value instanceof Set ? [...value] : value);
  while (state.status === 'playing' && commands < 2_000) {
    if (!departed && departurePhase === state.phase && state.roundNumber === 2) {
      const departing = state.huntedOrder.slice(0, Math.max(1, state.huntedOrder.length - 1));
      act(state, forfeitNotAlonePlayers(state, departing, state.revision), 'batch current-round departures');
      departed = true;
      if (state.status !== 'playing') break;
    }
    settleNotAloneAutopilot(state);
    assertConservation(state);
    for (const player of state.players.values()) {
      if (player.role !== 'hunted' || state.huntedOrder.includes(player.playerId)) continue;
      const before = retiredSnapshots.get(player.playerId);
      if (before) assert(before === serialisePlayer(player.playerId), 'Retired seat changed in a future round');
      else retiredSnapshots.set(player.playerId, serialisePlayer(player.playerId));
    }
    if (state.status !== 'playing') break;
    const publicState = toNotAlonePublicState(state, state.creaturePlayerId);
    if (!['reckoning', 'end_of_turn', 'game_over'].includes(state.phase)) {
      assert(publicState.players.every((player) => player.revealedPlaces.length === 0), 'Creature saw a hidden destination before reveal');
    }
    if (state.pendingCardChoice) {
      const pending = state.pendingCardChoice;
      if (pending.kind === 'forbidden_zone') {
        const playerId = pending.eligiblePlayerIds!.find((id) => !pending.sealedChoices!.has(id))!;
        const player = state.players.get(playerId)!;
        const choices = player.placeHand.filter((id) => !player.playedPlaces.includes(id) || player.returnPlayed.has(id)).slice(0, 1);
        act(state, chooseNotAloneCardEffect(state, playerId, choices, pending.choiceWindowRevision), 'seal Forbidden Zone choice');
      } else if (pending.kind === 'artefact_order') {
        act(state, chooseNotAloneCardEffect(state, pending.playerId!, [], state.revision, [0, 1]), 'order Artefact slots');
      } else {
        const player = state.players.get(pending.playerId!)!;
        const choices = player.placeHand.filter((id) => !player.playedPlaces.includes(id) || player.returnPlayed.has(id)).slice(0, pending.count);
        act(state, chooseNotAloneCardEffect(state, pending.playerId!, choices, state.revision), 'resolve private Hunt choice');
      }
    } else if (state.pendingSurvivalChoice) {
      act(state, chooseNotAloneSurvivalCard(state, state.pendingSurvivalChoice.playerId, state.pendingSurvivalChoice.cards[0]!, state.revision), 'choose Shelter card');
    } else if (state.phase === 'hunted_planning') {
      const mixedExplorer = state.huntedOrder[0]!;
      if (policy === 'mixed' && state.roundNumber === 1
        && toNotAlonePrivateState(state, mixedExplorer).playableSurvivalCardIds.includes('ingenuity')) {
        act(state, playNotAloneSurvival(state, mixedExplorer, { cardId: 'ingenuity', expectedRevision: state.planningWindowRevision }), 'mixed policy plays Ingenuity');
        commands += 1; continue;
      }
      const sharedRevision = state.planningWindowRevision;
      for (const playerId of state.huntedOrder) {
        const player = state.players.get(playerId)!;
        if (player.selectedPlaces.length) continue;
        const count = toNotAlonePrivateState(state, playerId).requiredSelectionCount;
        let choices = policy === 'mixed' && playerId === mixedExplorer
          ? mixedExplorerDestination(state, playerId, count)
          : player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place)).slice(0, count);
        if (choices.length < count) {
          act(state, giveUpNotAlone(state, playerId, sharedRevision), `${playerId} gives up to restore mandatory choices`);
          commands += 1;
          if (state.status !== 'playing') break;
          choices = policy === 'mixed' && playerId === mixedExplorer
            ? mixedExplorerDestination(state, playerId, count)
            : player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place)).slice(0, count);
        }
        assert(choices.length === count, 'Full-game policy could not make a mandatory selection');
        act(state, selectNotAlonePlaces(state, playerId, choices, sharedRevision), `${playerId} selects`);
      }
    } else if (state.phase === 'exploration_reaction') {
      passEligibleHunted(state);
      act(state, beginNotAloneHunt(state, state.creaturePlayerId, state.revision), 'begin Hunt');
    } else if (state.phase === 'creature_planning') {
      const mixedTarget = state.huntedOrder[1] ?? state.huntedOrder[0]!;
      if (policy === 'mixed' && state.roundNumber === 1
        && toNotAlonePrivateState(state, state.creaturePlayerId).playableHuntCardIds.includes('anticipation')) {
        act(state, playNotAloneHuntCard(state, state.creaturePlayerId, {
          cardId: 'anticipation', targetPlayerId: mixedTarget, expectedRevision: state.revision,
        }), 'mixed policy plays Anticipation');
        commands += 1; continue;
      }
      const selected = new Set(state.huntedOrder.flatMap((id) => state.players.get(id)!.selectedPlaces));
      const catchPlace = policy === 'hunt'
        ? state.players.get(state.huntedOrder[0]!)!.selectedPlaces[0]!
        : policy === 'mixed' && state.roundNumber % 4 === 0
          ? state.players.get(mixedTarget)!.selectedPlaces[0]!
          : ([10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as NotAlonePlaceId[]).find((place) => !selected.has(place))!;
      act(state, placeNotAloneToken(state, state.creaturePlayerId, 'creature', [catchPlace], state.revision), 'place Creature token');
      if (state.artemiaAvailable) {
        const artemiaPlace = ([10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as NotAlonePlaceId[])
          .find((place) => place !== catchPlace && !selected.has(place)) ?? (catchPlace === 10 ? 9 : 10);
        act(state, placeNotAloneToken(state, state.creaturePlayerId, 'artemia', [artemiaPlace], state.revision), 'place Artemia token');
      }
      act(state, lockNotAloneHunt(state, state.creaturePlayerId, state.revision), 'lock Hunt');
    } else if (state.phase === 'hunting_reaction') {
      passEligibleHunted(state);
      act(state, revealNotAlone(state, state.creaturePlayerId, state.revision), 'reveal Hunt');
    } else if (state.phase === 'river_choice') {
      const playerId = state.pendingPlayerId!;
      act(state, chooseNotAloneRiverDestination(state, playerId, state.players.get(playerId)!.selectedPlaces[0]!, state.revision), 'choose River destination');
    } else if (state.phase === 'reckoning') {
      if (state.pendingPlayerId) {
        act(state, resolveNotAloneLocation(state, state.pendingPlayerId, resolveAutomatically(state, state.pendingPlayerId, policy === 'mixed')), 'resolve Reckoning event');
      } else {
        passEligibleHunted(state);
        if (state.phase === 'reckoning' && !state.pendingPlayerId && !state.pendingCardChoice) {
          act(state, beginNotAloneReckoning(state, state.creaturePlayerId, state.revision), 'continue Reckoning');
        }
      }
    } else if (state.phase === 'end_of_turn') {
      if (policy === 'mixed' && state.roundNumber === 9
        && toNotAlonePrivateState(state, state.creaturePlayerId).playableHuntCardIds.includes('stasis')) {
        act(state, playNotAloneHuntCard(state, state.creaturePlayerId, { cardId: 'stasis', expectedRevision: state.revision }), 'mixed policy offsets Wreck with Stasis');
        commands += 1; continue;
      }
      passEligibleHunted(state);
      act(state, endNotAloneTurn(state, state.creaturePlayerId, state.revision), 'end round');
    }
    commands += 1;
  }
  assert(state.status === 'game_over', `Full ${playerCount}P ${face} game stalled after ${commands} commands`);
  if (departurePhase) {
    assert(departed, 'Scheduled departure was not reached');
    assert(state.players.size === playerCount, 'Historical roster was removed');
    assert(state.rescueGoal === notAloneTrackGoals(playerCount).rescue
      && state.assimilationGoal === notAloneTrackGoals(playerCount).assimilation, 'Departure changed original track goals');
    if (playerCount === 2) {
      assert(state.winner === 'creature' && state.endReason === 'forfeit', 'Last Hunted departure must end for Creature');
      return commands;
    }
    assert(retiredSnapshots.size === playerCount - 2, 'Departed seats were not retired at the boundary');
  }
  const expectedWinner = policy === 'hunt' ? 'creature' : 'hunted';
  assert(state.winner === expectedWinner, `${policy} policy produced the wrong team winner`);
  if (expectedWinner === 'hunted') assert(state.rescueProgress === state.rescueGoal, 'Hunted policy ended before the printed Rescue goal');
  else assert(state.assimilationProgress === state.assimilationGoal, 'Hunt policy ended before the printed Assimilation goal');
  return commands;
}

assert(NOT_ALONE_SURVIVAL_CARDS.length === 15, 'Base set must contain 15 Survival cards');
assert(NOT_ALONE_HUNT_CARDS.length === 20, 'Base set must contain 20 Hunt cards');
assert(NOT_ALONE_RULES_VERSION === 'original-base-2016-digital-v2', 'Rules contract version drifted');
assert(NOT_ALONE_CONTENT_SET === 'original-base-2016', 'Content contract drifted');
assert(!NOT_ALONE_MODE_DESCRIPTION.includes('BGA'), 'User-visible mode copy must not imply third-party affiliation');
const coveredSurvivalCards = new Set<NotAloneSurvivalCardId>();
const coveredHuntCards = new Set<NotAloneHuntCardId>();
const coveredPlacePowers = new Set<NotAlonePlaceId>();

for (let players = 2; players <= 7; players += 1) {
  const goals = notAloneTrackGoals(players);
  assert(goals.rescue === players + 11 && goals.assimilation === players + 5, `${players}P track distances are wrong`);
  for (let progress = 0; progress <= goals.rescue; progress += 1) {
    const expectedContinuous = progress >= goals.rescue - 6 && progress < goals.rescue;
    const expectedAlternating = progress >= players && progress < goals.rescue && (progress - players) % 2 === 0;
    assert(notAloneArtemiaAvailable('continuous', progress, goals.rescue) === expectedContinuous, `${players}P continuous Artemia mismatch at ${progress}`);
    assert(notAloneArtemiaAvailable('alternating', progress, goals.rescue) === expectedAlternating, `${players}P alternating Artemia mismatch at ${progress}`);
  }
}

{
  const rescue = initNotAloneGame('FINAL-ROUND-ARTEMIA-RESCUE', roster(2), seeded(9));
  prepareAllHuntedForHunt(rescue); rescue.phase = 'end_of_turn'; rescue.rescueProgress = rescue.rescueGoal - 1;
  rescue.artemiaAvailable = true; rescue.reactionPasses.add('p1');
  act(rescue, endNotAloneTurn(rescue, 'p0', rescue.revision), 'finish Rescue with Artemia active');
  assert(rescue.status === 'game_over' && rescue.artemiaAvailable, 'Rescue ending must preserve final-round Artemia availability');

  const assimilation = initNotAloneGame('FINAL-ROUND-ARTEMIA-ASSIMILATION', roster(2), seeded(91));
  assimilation.assimilationProgress = assimilation.assimilationGoal - 1; assimilation.artemiaAvailable = true;
  act(assimilation, giveUpNotAlone(assimilation, 'p1', assimilation.planningWindowRevision), 'finish Assimilation with Artemia active');
  assert(assimilation.status === 'game_over' && assimilation.artemiaAvailable, 'Assimilation ending must preserve final-round Artemia availability');
}

{
  const state = initNotAloneGame('FLASHBACK', roster(2), seeded(10));
  state.phase = 'end_of_turn';
  state.players.get('p1')!.selectedPlaces = [1]; state.players.get('p1')!.playedPlaces = [1];
  moveHuntToHand(state, 'flashback');
  removeOne(state.huntDeck, 'stasis'); state.huntDiscard.push('stasis');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'flashback', expectedRevision: state.revision }), 'play Flashback');
  assert(toNotAlonePublicState(state, 'p0').effectiveHuntCardIds.join(',') === 'stasis', 'Flashback must be substituted in situ');
  coveredHuntCards.add('flashback');
}

{
  const state = initNotAloneGame('PHASE-CARDS', roster(2), seeded(11));
  const hunted = state.players.get('p1')!;
  hunted.selectedPlaces = [2]; hunted.playedPlaces = [2];
  state.phase = 'reckoning'; state.huntPlanLocked = true; state.reactionWindowRevision = state.revision;
  moveHuntToHand(state, 'cataclysm');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'cataclysm', placeIds: [2], expectedRevision: state.revision }), 'play Phase 3 Hunt after lock');
  assert(state.disabledPlaces.has(2), 'Cataclysm must remain reachable before an unresolved Place action');
  coveredHuntCards.add('cataclysm');
  state.phase = 'end_of_turn';
  for (const card of [...state.pendingHuntDiscard]) { removeOne(state.pendingHuntDiscard, card); state.huntDiscard.push(card); }
  state.activeHuntCards = [];
  moveHuntToHand(state, 'stasis');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'stasis', expectedRevision: state.revision }), 'play Phase 4 Hunt after lock');
  assert(state.effects.stasis, 'Stasis must remain reachable during Phase 4');
  coveredHuntCards.add('stasis');
}

{
  const state = initNotAloneGame('TARGET-CHECKPOINT', roster(2), seeded(12));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2];
  state.phase = 'reckoning'; state.huntTokens.target = [2]; state.effects.scream = true;
  removeOne(state.huntDeck, 'scream'); state.pendingHuntDiscard.push('scream'); state.activeHuntCards = ['scream'];
  state.maxHuntCards = 2; moveHuntToHand(state, 'cataclysm');
  state.reactionWindowRevision = state.revision;
  act(state, beginNotAloneReckoning(state, 'p0', state.revision), 'schedule Target event');
  act(state, resolveNotAloneLocation(state, 'p1', {
    mode: 'recover', placeIds: [], huntChoice: 'discard', huntPlaceIds: [3, 4], expectedRevision: state.revision,
  }), 'resolve Scream atomically');
  assert(state.pendingPlayerId === null && toNotAlonePrivateState(state, 'p0').playableHuntCardIds.includes('cataclysm'), 'Priority must reopen after Scream');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'cataclysm', placeIds: [2], expectedRevision: state.revision }), 'play Cataclysm before Place action');
  assert(state.pendingPlayerId === 'p1' && notAloneResolutionOptions(state, 'p1')?.canContinue === true, 'Disabled Place must expose a continue action');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [], expectedRevision: state.revision }), 'skip disabled Place');
  assert(state.resolvedPlaceActions.has('p1:0'), 'Disabled Place action must settle exactly once');
  coveredHuntCards.add('scream');
}

{
  const state = initNotAloneGame('MOVE-OFF', roster(2), seeded(13));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2];
  state.phase = 'reckoning'; state.huntTokens.target = [2]; state.huntTokens.artemia = [2]; state.effects.scream = true;
  removeOne(state.huntDeck, 'scream'); state.pendingHuntDiscard.push('scream'); state.activeHuntCards = ['scream'];
  moveSurvivalToHand(state, 'p1', 'hologram'); state.reactionWindowRevision = state.revision;
  act(state, passNotAloneReaction(state, 'p1', state.reactionWindowRevision), 'pass initial move-off window');
  act(state, beginNotAloneReckoning(state, 'p0', state.revision), 'schedule stacked Target');
  act(state, resolveNotAloneLocation(state, 'p1', {
    mode: 'recover', placeIds: [], huntChoice: 'discard', huntPlaceIds: [3, 4], expectedRevision: state.revision,
  }), 'resolve Target before movement');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'hologram', targetPlaceId: 1, expectedRevision: state.revision }), 'move Artemia off physical slot');
  assert(state.pendingPlayerId === 'p1' && state.resolutionQueue[0]?.stage === 'place', 'Move-off must preserve an unresolved Place action');
  const options = notAloneResolutionOptions(state, 'p1')!;
  assert(options.recoverablePlaceIds.includes(3) && options.recoverablePlaceIds.includes(4), 'Scream discards must be recoverable before Place resolution');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [3], expectedRevision: state.revision }), 'resolve moved-off Place once');
  assert(state.resolvedPlaceActions.has('p1:0'), 'Moved-off Place was not marked resolved');
  coveredSurvivalCards.add('hologram');
}

{
  const state = initNotAloneGame('NO-REWIND', roster(3), seeded(14));
  const first = state.players.get('p1')!, second = state.players.get('p2')!;
  first.selectedPlaces = [2]; first.playedPlaces = [2]; second.selectedPlaces = [4]; second.playedPlaces = [4];
  state.phase = 'reckoning'; state.huntTokens.target = [2]; state.huntTokens.artemia = [4]; state.effects.scream = true;
  removeOne(state.huntDeck, 'scream'); state.pendingHuntDiscard.push('scream'); state.activeHuntCards = ['scream']; state.maxHuntCards = 2;
  moveHuntToHand(state, 'detour'); state.reactionWindowRevision = state.revision;
  act(state, beginNotAloneReckoning(state, 'p0', state.revision), 'begin no-rewind test');
  act(state, resolveNotAloneLocation(state, 'p1', {
    mode: 'recover', placeIds: [], huntChoice: 'discard', huntPlaceIds: [3, 4], expectedRevision: state.revision,
  }), 'resolve first Target');
  act(state, beginNotAloneReckoning(state, 'p0', state.revision), 'decline Detour before first Place');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [3], expectedRevision: state.revision }), 'resolve first Place');
  assert(state.pendingPlayerId === null, 'Priority checkpoint must precede the Artemia event');
  act(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'detour', targetPlayerId: 'p2', originPlaceId: 4, placeIndex: 0, placeIds: [3], expectedRevision: state.revision,
  }), 'move second Hunted onto a past Target');
  assert(state.pendingPlayerId === 'p2' && state.resolutionQueue[0]?.stage === 'place', 'Past Target must not rewind after Detour');
  assert(second.will === 3 && second.discard.length === 0, 'Past Target effect was applied again');
  coveredHuntCards.add('detour');
}

{
  const state = initNotAloneGame('NO-LATE-HUNT-NOOPS', roster(2), seeded(140));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 2; state.huntTokens.creature = [1];
  state.resolvedEncounterStages.add('p1:0:creature'); state.resolvedPlaceActions.add('p1:0');
  state.reactionWindowRevision = state.revision;
  moveHuntToHand(state, 'cataclysm'); moveHuntToHand(state, 'detour');
  const privateState = toNotAlonePrivateState(state, 'p0');
  assert(!privateState.playableHuntCardIds.includes('cataclysm')
    && !privateState.playableHuntCardIds.includes('detour'), 'Resolved Reckoning must not advertise no-op Hunt cards');
  assert(privateState.huntOptions.cataclysmPlaceIds.length === 0
    && privateState.huntOptions.detourOptions.length === 0, 'Resolved Reckoning exposed no-op Hunt targets');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'cataclysm', placeIds: [1], expectedRevision: state.revision,
  }), 'Cataclysm after the final Place action');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'detour', targetPlayerId: 'p1', originPlaceId: 1, placeIndex: 0, placeIds: [2], expectedRevision: state.revision,
  }), 'Detour after the final encounter and Place action');
}

for (const effect of ['cataclysm', 'detour'] as const) {
  const state = initNotAloneGame(`NO-LATE-FLASHBACK-${effect}`, roster(2), seeded(effect === 'cataclysm' ? 143 : 144));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 2; state.huntTokens.creature = [1];
  state.resolvedEncounterStages.add('p1:0:creature'); state.resolvedPlaceActions.add('p1:0');
  state.reactionWindowRevision = state.revision;
  moveHuntToHand(state, 'flashback'); removeOne(state.huntDeck, effect); state.huntDiscard.push(effect);
  assert(!toNotAlonePrivateState(state, 'p0').playableHuntCardIds.includes('flashback'), `Flashback must inherit ${effect}'s no-op cutoff`);
  rejectAct(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'flashback', targetPlayerId: 'p1', originPlaceId: 1, placeIndex: 0, placeIds: [effect === 'cataclysm' ? 1 : 2],
    expectedRevision: state.revision,
  }), `Flashback copying late ${effect}`);
}

{
  const state = initNotAloneGame('DETOUR-DISABLED-ENDPOINTS', roster(2), seeded(146));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2];
  state.phase = 'reckoning'; state.reckoningStageIndex = -1; state.reactionWindowRevision = state.revision;
  state.cataclysmPlaces.add(2); state.cataclysmPlaces.add(3); state.disabledPlaces.add(2); state.disabledPlaces.add(3);
  moveHuntToHand(state, 'detour');
  const option = toNotAlonePrivateState(state, 'p0').huntOptions.detourOptions.find((candidate) => candidate.playerId === 'p1');
  assert(option && !option.destinationPlaceIds.includes(3), 'Detour must omit a destination when both Place actions are already ineffective');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'detour', targetPlayerId: 'p1', originPlaceId: 2, placeIndex: 0, placeIds: [3], expectedRevision: state.revision,
  }), 'Detour between two already ineffective Place actions');
}

for (const token of ['artemia', 'creature', 'target'] as const) {
  const cardId = token === 'artemia' ? 'hologram' : 'wrong_track';
  const state = initNotAloneGame(`MOVEMENT-PRIORITY-${token}`, roster(3), seeded(147));
  for (const [playerId, place] of [['p1', 1], ['p2', 2]] as const) {
    const player = state.players.get(playerId)!;
    player.selectedPlaces = [place]; player.playedPlaces = [place];
  }
  state.phase = 'reckoning'; state.reckoningStageIndex = -1; state.reactionWindowRevision = state.revision;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'place' }];
  state.pendingPlayerId = 'p1'; state.huntTokens[token] = [2];
  if (token === 'target') { activateHuntCard(state, 'clone'); state.effects.clone = true; }
  moveSurvivalToHand(state, 'p1', cardId);
  const closed = toNotAlonePrivateState(state, 'p1');
  assert(!closed.playableSurvivalCardIds.includes(cardId), 'A closed priority window advertised token movement');
  const destinations = token === 'artemia' ? closed.survivalOptions.hologramPlaceIds
    : token === 'creature' ? closed.survivalOptions.wrongTrackCreaturePlaceIds : closed.survivalOptions.wrongTrackTargetPlaceIds;
  assert(destinations.length === 0, 'An active event exposed token movement targets');
  const movement: Omit<NotAloneSurvivalPayload, 'expectedRevision'> = {
    cardId, token: token === 'target' ? 'target' : 'creature', placeIds: [3],
  };
  const closedRevision = state.revision;
  rejectAct(state, playNotAloneSurvival(state, 'p1', { ...movement, expectedRevision: closedRevision }), 'token movement during an active event');
  assert(state.revision === closedRevision && state.huntTokens[token][0] === 2
    && state.players.get('p1')!.survivalHand.includes(cardId), 'Rejected movement changed the active event');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [], expectedRevision: state.revision }), 'complete the current Place event');
  assert(state.pendingPlayerId === null && toNotAlonePrivateState(state, 'p1').playableSurvivalCardIds.includes(cardId),
    'Token movement did not return at the next priority checkpoint');
  act(state, playNotAloneSurvival(state, 'p1', { ...movement, expectedRevision: state.revision }), 'move token at the next priority checkpoint');
  assert(state.huntTokens[token].join(',') === '3', 'Checkpoint movement did not update the token');
}

{
  const hologram = initNotAloneGame('NO-LATE-HOLOGRAM', roster(2), seeded(141));
  const player = hologram.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  hologram.phase = 'reckoning'; hologram.reckoningStageIndex = 1; hologram.huntTokens.artemia = [1];
  hologram.resolvedEncounterStages.add('p1:0:artemia'); hologram.resolvedPlaceActions.add('p1:0');
  hologram.reactionWindowRevision = hologram.revision; moveSurvivalToHand(hologram, 'p1', 'hologram');
  assert(!toNotAlonePrivateState(hologram, 'p1').playableSurvivalCardIds.includes('hologram')
    && toNotAlonePrivateState(hologram, 'p1').survivalOptions.hologramPlaceIds.length === 0,
  'Resolved Artemia must not advertise Hologram');
  rejectAct(hologram, playNotAloneSurvival(hologram, 'p1', {
    cardId: 'hologram', placeIds: [2], expectedRevision: hologram.revision,
  }), 'Hologram after the final Artemia encounter');

  const wrongTrack = initNotAloneGame('NO-LATE-WRONG-TRACK', roster(2), seeded(142));
  const wrongTrackPlayer = wrongTrack.players.get('p1')!;
  wrongTrackPlayer.selectedPlaces = [1]; wrongTrackPlayer.playedPlaces = [1];
  wrongTrack.phase = 'reckoning'; wrongTrack.reckoningStageIndex = 2; wrongTrack.huntTokens.creature = [1];
  wrongTrack.resolvedEncounterStages.add('p1:0:creature'); wrongTrack.resolvedPlaceActions.add('p1:0');
  wrongTrack.reactionWindowRevision = wrongTrack.revision; moveSurvivalToHand(wrongTrack, 'p1', 'wrong_track');
  assert(!toNotAlonePrivateState(wrongTrack, 'p1').playableSurvivalCardIds.includes('wrong_track')
    && toNotAlonePrivateState(wrongTrack, 'p1').survivalOptions.wrongTrackCreaturePlaceIds.length === 0,
  'Resolved Creature must not advertise Wrong Track');
  rejectAct(wrongTrack, playNotAloneSurvival(wrongTrack, 'p1', {
    cardId: 'wrong_track', token: 'creature', placeIds: [2], expectedRevision: wrongTrack.revision,
  }), 'Wrong Track after the final Creature encounter');
}

{
  const state = initNotAloneGame('WRONG-TRACK-LAIR-COPY', roster(2), seeded(145));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 2; state.huntTokens.creature = [6];
  state.reactionWindowRevision = state.revision; moveSurvivalToHand(state, 'p1', 'wrong_track');
  const privateState = toNotAlonePrivateState(state, 'p1');
  assert(privateState.playableSurvivalCardIds.includes('wrong_track')
    && privateState.survivalOptions.wrongTrackCreaturePlaceIds.includes(7), 'Wrong Track must remain legal when it changes an unresolved Lair copy');
  act(state, playNotAloneSurvival(state, 'p1', {
    cardId: 'wrong_track', token: 'creature', placeIds: [7], expectedRevision: state.revision,
  }), 'move Creature to change Lair copy options');
  assert(state.huntTokens.creature[0] === 7, 'Wrong Track did not move the Lair copy source');
}

{
  const state = initNotAloneGame('SURVIVAL-PHASE-ONE', roster(2), seeded(20));
  const player = state.players.get('p1')!;
  player.will = 2;
  moveSurvivalToHand(state, 'p1', 'adrenaline');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'adrenaline', expectedRevision: state.planningWindowRevision }), 'play Adrenaline');
  assert(player.will === 3, 'Adrenaline must restore exactly one Will');
  coveredSurvivalCards.add('adrenaline');
}

{
  const state = initNotAloneGame('SURVIVAL-INGENUITY', roster(2), seeded(21));
  moveSurvivalToHand(state, 'p1', 'ingenuity');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'ingenuity', expectedRevision: state.planningWindowRevision }), 'play Ingenuity');
  assert(state.beachCharged, 'Ingenuity must charge the Beach beacon');
  coveredSurvivalCards.add('ingenuity');
}

{
  const state = initNotAloneGame('SURVIVAL-SACRIFICE', roster(2), seeded(22));
  const player = state.players.get('p1')!;
  moveSurvivalToHand(state, 'p1', 'sacrifice');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'sacrifice', placeIds: [1], expectedRevision: state.planningWindowRevision }), 'play Sacrifice');
  assert(state.effects.noHuntCard && !player.placeHand.includes(1) && player.discard.includes(1), 'Sacrifice must discard one unplayed Place and prevent Hunt cards');
  moveHuntToHand(state, 'force_field');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [2, 3], expectedRevision: state.revision }), 'Sacrifice blocks later Hunt play');
  coveredSurvivalCards.add('sacrifice');
}

{
  const state = initNotAloneGame('SURVIVAL-SIXTH-SENSE', roster(2), seeded(23));
  const player = state.players.get('p1')!;
  movePlaceToDiscard(state, 'p1', 1); movePlaceToDiscard(state, 'p1', 2);
  moveSurvivalToHand(state, 'p1', 'sixth_sense');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'sixth_sense', placeIds: [1, 2], expectedRevision: state.planningWindowRevision }), 'play Sixth Sense');
  assert(player.discard.length === 0 && player.placeHand.includes(1) && player.placeHand.includes(2), 'Sixth Sense must recover two discarded Places');
  coveredSurvivalCards.add('sixth_sense');
}

{
  const state = initNotAloneGame('SURVIVAL-SMOKESCREEN', roster(2), seeded(24));
  movePlaceToDiscard(state, 'p1', 1);
  moveSurvivalToHand(state, 'p1', 'smokescreen');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'smokescreen', expectedRevision: state.planningWindowRevision }), 'play Smokescreen');
  const creatureView = toNotAlonePublicState(state, 'p0').players.find((entry) => entry.playerId === 'p1')!;
  const huntedView = toNotAlonePublicState(state, 'p1').players.find((entry) => entry.playerId === 'p1')!;
  assert(creatureView.discard.length === 0 && creatureView.discardCount === 1, 'Smokescreen must hide identities but preserve public discard count from the Creature');
  assert(huntedView.discard.join(',') === '1', 'Smokescreen must not hide a Hunted discard from its owner');
  coveredSurvivalCards.add('smokescreen');
}

{
  const state = initNotAloneGame('SURVIVAL-STRIKE-BACK', roster(2), seeded(25));
  moveSurvivalToHand(state, 'p1', 'strike_back');
  const before = state.huntHand.length;
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'strike_back', expectedRevision: state.planningWindowRevision }), 'play Strike Back');
  assert(state.huntHand.length === Math.max(0, before - 2), 'Strike Back must remove exactly two random Hunt cards when available');
  coveredSurvivalCards.add('strike_back');
}

{
  const state = initNotAloneGame('SURVIVAL-VORTEX', roster(2), seeded(26));
  const player = state.players.get('p1')!;
  movePlaceToDiscard(state, 'p1', 3);
  player.selectedPlaces = [1, 2]; player.playedPlaces = [1, 2];
  state.phase = 'hunting_reaction'; state.huntPlanLocked = true; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'vortex');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'vortex', placeIndex: 1, placeIds: [3], expectedRevision: state.reactionWindowRevision }), 'play Vortex on the second physical slot');
  assert(player.selectedPlaces.join(',') === '1,3' && player.playedPlaces.join(',') === '1,3', 'Vortex must replace exactly the chosen Artefact slot');
  assert(!player.placeHand.includes(2) && player.discard.includes(2) && player.placeHand.includes(3) && !player.discard.includes(3), 'Vortex must exchange the replaced physical card with the discarded replacement');
  coveredSurvivalCards.add('vortex');
}

{
  const state = initNotAloneGame('SURVIVAL-DETECTOR', roster(2), seeded(27));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.artemia = [1];
  state.phase = 'reckoning'; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'detector');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'detector', expectedRevision: state.reactionWindowRevision }), 'play Detector');
  assert(player.ignoreArtemia, 'Detector must ignore Artemia for the whole turn');
  coveredSurvivalCards.add('detector');
}

{
  const state = initNotAloneGame('SURVIVAL-DODGE', roster(2), seeded(28));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.target = [1]; activateHuntCard(state, 'clone'); state.effects.clone = true;
  state.phase = 'reckoning'; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'dodge');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'dodge', expectedRevision: state.reactionWindowRevision }), 'play Dodge against Clone');
  assert(player.ignoreCreature, 'Dodge must ignore the actual and Clone Creature tokens');
  coveredSurvivalCards.add('dodge');
}

{
  const state = initNotAloneGame('SURVIVAL-DRONE', roster(2), seeded(29));
  openPlaceResolution(state, 'p1', 1);
  moveSurvivalToHand(state, 'p1', 'drone');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'drone', expectedRevision: state.revision }), 'play Drone at a Place action');
  assert(state.players.get('p1')!.copyPower === 5, 'Drone must commit the Rover power');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', targetPlaceId: 6, expectedRevision: state.revision }), 'resolve Drone Rover power');
  assert(state.players.get('p1')!.placeHand.includes(6) && state.reserve[6] === 0, 'Drone must take an available advanced Place');
  coveredSurvivalCards.add('drone');
}

{
  const state = initNotAloneGame('SURVIVAL-GATE', roster(2), seeded(30));
  movePlaceToDiscard(state, 'p1', 4);
  openPlaceResolution(state, 'p1', 2);
  state.huntTokens.creature = [1];
  state.disabledPlaces.add(1);
  moveSurvivalToHand(state, 'p1', 'gate');
  assert(toNotAlonePrivateState(state, 'p1').survivalOptions.gatePlaceIds.includes(1), 'Gate may copy an ineffective adjacent Place when the initially played Place is usable');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'gate', targetPlaceId: 1, expectedRevision: state.revision }), 'play Gate to copy Lair');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', placeIds: [4], expectedRevision: state.revision }), 'resolve Gate copied Lair');
  assert(state.players.get('p1')!.discard.length === 0 && state.players.get('p1')!.copyPower === null, 'Gate must resolve and atomically clear the copied power');
  coveredSurvivalCards.add('gate');
}

{
  const state = initNotAloneGame('SURVIVAL-WRONG-TRACK', roster(2), seeded(31));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.huntTokens.creature = [2, 3]; state.phase = 'reckoning'; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'wrong_track');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', token: 'creature', placeIds: [1], expectedRevision: state.reactionWindowRevision }), 'play Wrong Track');
  assert(state.huntTokens.creature.join(',') === '1', 'Wrong Track must collapse a moved two-Place footprint onto one Place adjacent to either origin');
  coveredSurvivalCards.add('wrong_track');
}

{
  const state = initNotAloneGame('SURVIVAL-AMPLIFIER', roster(2), seeded(32));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1]; state.phase = 'end_of_turn'; state.beachCharged = true; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'amplifier');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'amplifier', expectedRevision: state.reactionWindowRevision }), 'play Amplifier');
  assert(state.rescueProgress === 1 && !state.beachCharged, 'Amplifier must spend the beacon and advance Rescue');
  coveredSurvivalCards.add('amplifier');
}

{
  const state = initNotAloneGame('SURVIVAL-DOUBLE-BACK', roster(2), seeded(33));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [3, 3]; player.playedPlaces = [1, 3]; state.phase = 'end_of_turn'; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'double_back');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'double_back', placeIndex: 1, expectedRevision: state.reactionWindowRevision }), 'play Double Back on duplicate destination slot');
  assert(player.returnPlayed.has(3) && !player.returnPlayed.has(1), 'Double Back must identify the chosen physical card by slot');
  coveredSurvivalCards.add('double_back');
}

{
  const state = initNotAloneGame('HUNT-ANTICIPATION', roster(3), seeded(40));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'anticipation');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'anticipation', targetPlayerId: 'p1', expectedRevision: state.revision }), 'play Anticipation');
  assert(state.effects.anticipationTarget === 'p1', 'Anticipation must retain its declared target');
  assert(toNotAlonePublicState(state, 'p2').anticipationTargetPlayerId === 'p1', 'Anticipation target must be public to every viewer');
  coveredHuntCards.add('anticipation');
}

{
  const state = initNotAloneGame('HUNT-ASCENDANCY', roster(2), seeded(41));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'ascendancy');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'ascendancy', targetPlayerId: 'p1', expectedRevision: state.revision }), 'play Ascendancy');
  assert(state.pendingCardChoice?.kind === 'ascendancy' && state.pendingCardChoice.count === 2, 'Ascendancy must ask the target to keep two unplayed Places');
  act(state, chooseNotAloneCardEffect(state, 'p1', [2, 3], state.revision), 'resolve Ascendancy privately');
  assert(state.players.get('p1')!.placeHand.filter((id) => !state.players.get('p1')!.playedPlaces.includes(id)).length === 2
    && state.players.get('p1')!.discard.length === 2, 'Ascendancy must leave exactly two unplayed Place cards in hand');
  coveredHuntCards.add('ascendancy');
}

{
  const state = initNotAloneGame('HUNT-ASCENDANCY-ELIGIBILITY', roster(2), seeded(411));
  prepareAllHuntedForHunt(state); movePlaceToDiscard(state, 'p1', 2); movePlaceToDiscard(state, 'p1', 3);
  state.phase = 'creature_planning'; moveHuntToHand(state, 'ascendancy');
  assert(!toNotAlonePrivateState(state, 'p0').playableHuntCardIds.includes('ascendancy')
    && toNotAlonePrivateState(state, 'p0').huntOptions.ascendancyTargetPlayerIds.length === 0, 'Ascendancy must not advertise a Hunted holding only two unplayed Places');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: 'ascendancy', targetPlayerId: 'p1', expectedRevision: state.revision }), 'Ascendancy rejects an ineligible target');
  state.players.get('p1')!.returnPlayed.add(1);
  assert(toNotAlonePrivateState(state, 'p0').huntOptions.ascendancyTargetPlayerIds.join(',') === 'p1', 'A physically returned Place must count as held for Ascendancy eligibility');
}

{
  const state = initNotAloneGame('HUNT-CLONE', roster(2), seeded(42));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'clone');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'clone', expectedRevision: state.revision }), 'play Clone');
  assert(state.effects.clone && !toNotAlonePrivateState(state, 'p0').canLockHunt, 'Clone must require a Target token footprint');
  coveredHuntCards.add('clone');
}

{
  const state = initNotAloneGame('HUNT-DESPAIR', roster(3), seeded(43));
  const oldPlanningWindow = state.planningWindowRevision;
  act(state, selectNotAlonePlaces(state, 'p1', [1], state.planningWindowRevision), 'first Hunted locks before Despair');
  moveHuntToHand(state, 'despair');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'despair', expectedRevision: state.revision }), 'play Despair');
  assert(state.effects.noSurvival && state.players.get('p1')!.selectedPlaces.length === 0
    && state.players.get('p1')!.playedPlaces.length === 0
    && state.players.get('p2')!.selectedPlaces.length === 0 && state.phase === 'hunted_planning', 'Despair must privately reset every locked destination for reselection');
  rejectAct(state, selectNotAlonePlaces(state, 'p2', [2], oldPlanningWindow), 'pre-Despair planning actions cannot cross the reset');
  act(state, selectNotAlonePlaces(state, 'p1', [2], state.planningWindowRevision), 'first Hunted privately reselects after Despair');
  coveredHuntCards.add('despair');
}

{
  const state = initNotAloneGame('HUNT-DESPAIR-ALL-LOCKED', roster(2), seeded(431));
  act(state, selectNotAlonePlaces(state, 'p1', [1], state.planningWindowRevision), 'Hunted locks before late Despair');
  moveHuntToHand(state, 'despair');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'despair', expectedRevision: state.revision }), 'play Despair after every Hunted locks');
  assert(state.phase === 'hunted_planning' && state.players.get('p1')!.selectedPlaces.length === 0
    && state.players.get('p1')!.playedPlaces.length === 0, 'Despair after all locks must reopen private planning without leaking the old destination');
  act(state, selectNotAlonePlaces(state, 'p1', [2], state.planningWindowRevision), 'reselect after all-locked Despair');
  assert(String(state.phase) === 'exploration_reaction' && state.players.get('p1')!.selectedPlaces.join(',') === '2', 'Reselection must restore the normal Exploration reaction phase');
}

for (let totalPlayers = 2; totalPlayers <= 7; totalPlayers += 1) {
  const state = initNotAloneGame(`HUNT-DESPAIR-RESET-${totalPlayers}P`, roster(totalPlayers), seeded(432 + totalPlayers));
  const artefactPlayer = state.players.get(state.huntedOrder[0]!)!; artefactPlayer.artefactNext = true;
  const window = state.planningWindowRevision;
  for (const [index, playerId] of state.huntedOrder.entries()) {
    act(state, selectNotAlonePlaces(state, playerId, index === 0 ? [1, 2] : [1], window), `${totalPlayers}P pre-Despair lock`);
  }
  moveHuntToHand(state, 'despair');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'despair', expectedRevision: state.revision }), `${totalPlayers}P Despair reset`);
  assert(state.phase === 'hunted_planning' && state.huntedOrder.every((id) => state.players.get(id)!.selectedPlaces.length === 0
    && state.players.get(id)!.playedPlaces.length === 0) && artefactPlayer.artefactNext,
  `Despair must reset every private physical slot and restore Artefact mode at ${totalPlayers}P`);
}

{
  const state = initNotAloneGame('HUNT-FIERCENESS', roster(2), seeded(44));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'fierceness');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'fierceness', expectedRevision: state.revision }), 'play Fierceness');
  assert(state.effects.fierceness, 'Fierceness must arm an extra Will loss on Creature-token catches');
  coveredHuntCards.add('fierceness');
}

{
  const state = initNotAloneGame('HUNT-FORBIDDEN-ZONE', roster(3), seeded(45));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'forbidden_zone');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'forbidden_zone', expectedRevision: state.revision }), 'play Forbidden Zone');
  assert(state.pendingCardChoice?.kind === 'forbidden_zone', 'Forbidden Zone must create private discard choices');
  const sealedWindow = state.pendingCardChoice!.choiceWindowRevision!;
  act(state, chooseNotAloneCardEffect(state, 'p1', [2], sealedWindow), 'first sealed Forbidden Zone choice');
  assert(!state.players.get('p1')!.discard.includes(2) && !state.players.get('p2')!.discard.includes(2)
    && state.pendingCardChoice?.playerId === null, 'Forbidden Zone must not apply or identify a choice before every Hunted commits');
  assert(toNotAlonePrivateState(state, 'p1').cardChoice === null && toNotAlonePrivateState(state, 'p1').cardChoiceSubmitted
    && toNotAlonePrivateState(state, 'p2').cardChoice?.kind === 'forbidden_zone'
    && !toNotAlonePrivateState(state, 'p2').cardChoiceSubmitted
    && toNotAlonePrivateState(state, 'p0').cardChoice === null && !toNotAlonePrivateState(state, 'p0').cardChoiceSubmitted,
  'Only each Hunted may see whether their own sealed Forbidden Zone choice was submitted');
  const anonymousProgress = toNotAlonePublicState(state, 'p0').pendingCardChoice;
  assert(anonymousProgress?.submittedCount === 1 && anonymousProgress.eligibleCount === 2,
    'Forbidden Zone public progress must expose anonymous counts without player identities');
  rejectAct(state, chooseNotAloneCardEffect(state, 'p1', [3], sealedWindow), 'duplicate Forbidden Zone commitment');
  act(state, chooseNotAloneCardEffect(state, 'p2', [2], sealedWindow), 'second simultaneous Forbidden Zone choice from the original epoch');
  assert(state.players.get('p1')!.discard.includes(2) && state.players.get('p2')!.discard.includes(2), 'Forbidden Zone must make every Hunted discard one unplayed Place');
  coveredHuntCards.add('forbidden_zone');
}

for (let totalPlayers = 3; totalPlayers <= 7; totalPlayers += 1) {
  const state = initNotAloneGame(`HUNT-FORBIDDEN-SEALED-${totalPlayers}P`, roster(totalPlayers), seeded(450 + totalPlayers));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'forbidden_zone');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'forbidden_zone', expectedRevision: state.revision }), `${totalPlayers}P Forbidden Zone`);
  const pending = state.pendingCardChoice!; const window = pending.choiceWindowRevision!;
  const reverseOrder = [...state.huntedOrder].reverse();
  for (const [index, playerId] of reverseOrder.entries()) {
    act(state, chooseNotAloneCardEffect(state, playerId, [2], window), `${totalPlayers}P sealed Forbidden choice`);
    if (index < reverseOrder.length - 1) {
      assert(state.huntedOrder.every((id) => !state.players.get(id)!.discard.includes(2)),
        'Forbidden Zone must reveal no discard identity before the final simultaneous commitment');
    }
  }
  assert(state.pendingCardChoice === null && state.huntedOrder.every((id) => state.players.get(id)!.discard.includes(2)),
    `Forbidden Zone simultaneous resolution failed at ${totalPlayers}P`);
}

{
  const state = initNotAloneGame('HUNT-FORCE-FIELD', roster(2), seeded(46));
  moveHuntToHand(state, 'force_field');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [1, 2], expectedRevision: state.revision }), 'play Force Field before selection');
  assert(state.selectionBlockedPlaces.has(1) && state.selectionBlockedPlaces.has(2), 'Force Field must publish two inaccessible Places');
  assert(!state.disabledPlaces.has(1) && !state.disabledPlaces.has(2), 'Force Field must not disable powers at previously legal destinations');
  rejectAct(state, selectNotAlonePlaces(state, 'p1', [1], state.planningWindowRevision), 'Force Field blocks later selection');
  coveredHuntCards.add('force_field');
}

{
  const state = initNotAloneGame('HUNT-FORCE-FIELD-LATE', roster(3), seeded(47));
  act(state, selectNotAlonePlaces(state, 'p1', [1], state.planningWindowRevision), 'lock before Force Field timing check');
  moveHuntToHand(state, 'force_field');
  assert(!toNotAlonePrivateState(state, 'p0').playableHuntCardIds.includes('force_field'), 'Force Field projection must close after the first Hunted play');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [2, 3], expectedRevision: state.revision }), 'Force Field cannot be played after any Hunted selection');
}

{
  const state = initNotAloneGame('HUNT-INTERFERENCE', roster(2), seeded(48));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'interference');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'interference', expectedRevision: state.revision }), 'play Interference');
  assert(state.disabledPlaces.has(4) && state.disabledPlaces.has(8), 'Interference must disable Beach and Wreck powers');
  coveredHuntCards.add('interference');
}

{
  const state = initNotAloneGame('HUNT-MIRAGE', roster(2), seeded(49));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'mirage');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: 'mirage', placeIds: [2, 3], expectedRevision: state.revision }), 'Mirage rejects a card-payload token footprint');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'mirage', expectedRevision: state.revision }), 'play Mirage');
  act(state, placeNotAloneToken(state, 'p0', 'target', [2, 3], state.revision), 'place Mirage Target footprint');
  assert(state.disabledPlaces.has(2) && state.disabledPlaces.has(3), 'Mirage must disable its live Target footprint');
  act(state, placeNotAloneToken(state, 'p0', 'target', [4, 5], state.revision), 'reposition unlocked Mirage footprint');
  assert(!state.disabledPlaces.has(2) && !state.disabledPlaces.has(3) && state.disabledPlaces.has(4) && state.disabledPlaces.has(5), 'Mirage disablement must follow the live Target footprint without accumulation');
  coveredHuntCards.add('mirage');
}

{
  const state = initNotAloneGame('HUNT-MUTATION', roster(2), seeded(50));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'mutation');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'mutation', expectedRevision: state.revision }), 'play Mutation');
  assert(state.effects.mutation, 'Mutation must arm a Will loss for Artemia encounters');
  coveredHuntCards.add('mutation');
}

{
  const state = initNotAloneGame('HUNT-PERSECUTION', roster(2), seeded(51));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'persecution');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'persecution', expectedRevision: state.revision }), 'play Persecution');
  movePlaceToDiscard(state, 'p1', 2); movePlaceToDiscard(state, 'p1', 3);
  openPlaceResolution(state, 'p1', 1);
  const options = notAloneResolutionOptions(state, 'p1')!;
  assert(options.powerRecoveryCount === 1, 'Persecution must cap Lair recovery at one Place');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', placeIds: [2], expectedRevision: state.revision }), 'resolve Persecution-capped Lair');
  assert(state.players.get('p1')!.discard.join(',') === '3', 'Persecution must leave excess discarded Places behind');
  coveredHuntCards.add('persecution');
}

{
  const returnJungle = initNotAloneGame('PERSECUTION-JUNGLE-SELF', roster(2), seeded(511));
  movePlaceToDiscard(returnJungle, 'p1', 1); returnJungle.effects.persecution = true; openPlaceResolution(returnJungle, 'p1', 2);
  const returnOptions = notAloneResolutionOptions(returnJungle, 'p1')!;
  assert(returnOptions.canReturnPlayedPlace && returnOptions.returnablePlayedPlaceId === 2
    && returnOptions.powerRecoveryCount === 1, 'Persecution Jungle must offer either its physical card or one discarded Place');
  act(returnJungle, resolveNotAloneLocation(returnJungle, 'p1', {
    mode: 'power', placeIds: [], expectedRevision: returnJungle.revision,
  }), 'return Jungle itself under Persecution');
  assert(returnJungle.players.get('p1')!.returnPlayed.has(2) && returnJungle.players.get('p1')!.discard.includes(1),
    'Returning Jungle under Persecution must not also recover a discard');

  const recoverOther = initNotAloneGame('PERSECUTION-JUNGLE-DISCARD', roster(2), seeded(512));
  movePlaceToDiscard(recoverOther, 'p1', 1); recoverOther.effects.persecution = true; openPlaceResolution(recoverOther, 'p1', 2);
  act(recoverOther, resolveNotAloneLocation(recoverOther, 'p1', {
    mode: 'power', placeIds: [1], expectedRevision: recoverOther.revision,
  }), 'recover another Place instead of Jungle under Persecution');
  assert(!recoverOther.players.get('p1')!.returnPlayed.has(2) && recoverOther.players.get('p1')!.placeHand.includes(1),
    'Recovering another Place under Persecution must leave Jungle to be discarded');

  const swamp = initNotAloneGame('PERSECUTION-SWAMP-CAP', roster(2), seeded(513));
  grantAdvancedPlace(swamp, 'p1', 6); movePlaceToDiscard(swamp, 'p1', 1); movePlaceToDiscard(swamp, 'p1', 2);
  swamp.effects.persecution = true; openPlaceResolution(swamp, 'p1', 6);
  rejectAct(swamp, resolveNotAloneLocation(swamp, 'p1', {
    mode: 'power', placeIds: [1, 2], expectedRevision: swamp.revision,
  }), 'Persecution prevents Swamp returning or recovering more than one card');
  act(swamp, resolveNotAloneLocation(swamp, 'p1', {
    mode: 'power', placeIds: [1], expectedRevision: swamp.revision,
  }), 'recover one discard with Swamp under Persecution');
  assert(!swamp.players.get('p1')!.returnPlayed.has(6) && swamp.players.get('p1')!.discard.join(',') === '2',
    'Persecution Swamp recovery must total exactly one card');
}

{
  const state = initNotAloneGame('HUNT-PHOBIA', roster(2), seeded(52));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'phobia');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'phobia', targetPlayerId: 'p1', expectedRevision: state.revision }), 'play Phobia');
  act(state, chooseNotAloneCardEffect(state, 'p1', [2, 3], state.revision), 'choose two hidden Phobia cards');
  assert(state.revealedHuntedHands.p1?.length === 2, 'Phobia must reveal all but two unplayed Place cards to the Creature');
  assert(Object.keys(toNotAlonePrivateState(state, 'p1').revealedHuntedHands).length === 0, 'Phobia reveal must remain Creature-private');
  assert(toNotAlonePrivateState(state, 'p0').revealedHuntedHands.p1?.length === 2, 'Creature must receive the Phobia reveal');
  coveredHuntCards.add('phobia');
}

{
  const state = initNotAloneGame('HUNT-PHOBIA-ELIGIBILITY', roster(2), seeded(521));
  prepareAllHuntedForHunt(state); movePlaceToDiscard(state, 'p1', 2); movePlaceToDiscard(state, 'p1', 3);
  state.phase = 'creature_planning'; moveHuntToHand(state, 'phobia');
  assert(!toNotAlonePrivateState(state, 'p0').playableHuntCardIds.includes('phobia')
    && toNotAlonePrivateState(state, 'p0').huntOptions.phobiaTargetPlayerIds.length === 0, 'Phobia must not advertise a Hunted holding only two unplayed Places');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: 'phobia', targetPlayerId: 'p1', expectedRevision: state.revision }), 'Phobia rejects an ineligible target');
}

{
  const state = initNotAloneGame('HUNT-TOXIN', roster(2), seeded(53));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'toxin');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'toxin', expectedRevision: state.revision }), 'play Toxin');
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.target = [1]; state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  const discarded = player.survivalHand[0]!;
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', huntSurvivalCardId: discarded, expectedRevision: state.revision }), 'resolve Toxin Survival discard');
  assert(state.survivalDiscard.includes(discarded), 'Toxin must discard one owned Survival card');
  coveredHuntCards.add('toxin');
}

{
  const state = initNotAloneGame('HUNT-TOXIN-EMPTY', roster(2), seeded(54));
  activateHuntCard(state, 'toxin'); state.effects.toxin = true;
  const player = state.players.get('p1')!;
  state.survivalDeck.push(...player.survivalHand); player.survivalHand = [];
  player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.target = [1]; state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  rejectAct(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', huntSurvivalCardId: 'adrenaline', expectedRevision: state.revision }), 'Toxin cannot conjure a non-owned Survival card');
}

{
  const state = initNotAloneGame('HUNT-TRACKING', roster(2), seeded(55));
  prepareAllHuntedForHunt(state); state.phase = 'end_of_turn'; moveHuntToHand(state, 'tracking');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'tracking', expectedRevision: state.revision }), 'play Tracking');
  assert(state.nextMaxHuntCards === 2, 'Tracking must allow two Hunt cards next round');
  coveredHuntCards.add('tracking');
}

{
  const state = initNotAloneGame('HUNT-VIRUS', roster(2), seeded(56));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; moveHuntToHand(state, 'virus');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'virus', expectedRevision: state.revision }), 'play Virus');
  act(state, placeNotAloneToken(state, 'p0', 'artemia', [2, 3], state.revision), 'place Virus Artemia footprint');
  assert(state.huntTokens.artemia.join(',') === '2,3', 'Virus must require two adjacent Artemia Places');
  coveredHuntCards.add('virus');
}

{
  const state = initNotAloneGame('PLACE-LAIR', roster(2), seeded(60));
  movePlaceToDiscard(state, 'p1', 2); movePlaceToDiscard(state, 'p1', 3);
  openPlaceResolution(state, 'p1', 1);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', placeIds: [2, 3], expectedRevision: state.revision }), 'resolve Lair recovery');
  assert(state.players.get('p1')!.discard.length === 0, 'Lair must recover every discarded Place');
  coveredPlacePowers.add(1);
}

{
  const state = initNotAloneGame('PLACE-LAIR-CLONE', roster(2), seeded(601));
  openPlaceResolution(state, 'p1', 1);
  activateHuntCard(state, 'clone'); state.effects.clone = true;
  state.huntTokens.creature = [6]; state.huntTokens.target = [7];
  const options = notAloneResolutionOptions(state, 'p1')!;
  assert(options.copyablePlaceIds.join(',') === '6,7', 'Lair must expose available powers beneath both physical and Clone Creature tokens');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', targetPlaceId: 7, expectedRevision: state.revision }), 'copy Shelter beneath Clone Target with Lair');
  assert(state.pendingSurvivalChoice?.playerId === 'p1', 'Lair must execute the Place power beneath the Clone Target');

  const blocked = initNotAloneGame('PLACE-LAIR-CLONE-BLOCKED', roster(2), seeded(602));
  openPlaceResolution(blocked, 'p1', 1); activateHuntCard(blocked, 'clone'); blocked.effects.clone = true;
  blocked.huntTokens.creature = [8]; blocked.huntTokens.target = [5]; blocked.effects.interference = true;
  blocked.disabledPlaces.add(8);
  for (const place of [6, 7, 8, 9, 10] as NotAlonePlaceId[]) grantAdvancedPlace(blocked, 'p1', place);
  assert(notAloneResolutionOptions(blocked, 'p1')!.copyablePlaceIds.join(',') === '8', 'A copied destination may be ineffective, while intrinsic no-effect powers remain omitted');
  rejectAct(blocked, resolveNotAloneLocation(blocked, 'p1', { mode: 'power', targetPlaceId: 5, expectedRevision: blocked.revision }), 'Lair direct action rejects an unavailable Clone power');
  act(blocked, resolveNotAloneLocation(blocked, 'p1', { mode: 'power', targetPlaceId: 8, expectedRevision: blocked.revision }), 'Lair copies an ineffective Wreck beneath the physical Creature');
  assert(blocked.rescueProgress === 1, 'Copied ineffective Place power must still resolve');
}

{
  const lair = initNotAloneGame('PLACE-LAIR-COPIES-JUNGLE', roster(2), seeded(603));
  movePlaceToDiscard(lair, 'p1', 4); openPlaceResolution(lair, 'p1', 1); lair.huntTokens.creature = [2];
  act(lair, resolveNotAloneLocation(lair, 'p1', {
    mode: 'power', targetPlaceId: 2, placeIds: [4], expectedRevision: lair.revision,
  }), 'Lair copies Jungle text');
  assert(lair.players.get('p1')!.returnPlayed.has(1) && lair.players.get('p1')!.placeHand.includes(4),
    'Lair copying Jungle must treat the physically played Lair as this Place card');

  const gate = initNotAloneGame('SURVIVAL-GATE-COPIES-SWAMP', roster(2), seeded(604));
  movePlaceToDiscard(gate, 'p1', 4); movePlaceToDiscard(gate, 'p1', 5); openPlaceResolution(gate, 'p1', 1);
  moveSurvivalToHand(gate, 'p1', 'gate');
  act(gate, playNotAloneSurvival(gate, 'p1', {
    cardId: 'gate', targetPlaceId: 6, expectedRevision: gate.revision,
  }), 'Gate copies adjacent Swamp');
  assert(notAloneResolutionOptions(gate, 'p1')!.returnablePlayedPlaceId === 1, 'Gate copied return must identify the initial physical Place');
  act(gate, resolveNotAloneLocation(gate, 'p1', {
    mode: 'power', placeIds: [4, 5], expectedRevision: gate.revision,
  }), 'resolve Gate copied Swamp');
  assert(gate.players.get('p1')!.returnPlayed.has(1) && gate.players.get('p1')!.discard.length === 0,
    'Gate copying Swamp must return the initial physical Place plus two discards');

  const persecuted = initNotAloneGame('PLACE-LAIR-COPY-PERSECUTION', roster(2), seeded(605));
  movePlaceToDiscard(persecuted, 'p1', 4); persecuted.effects.persecution = true;
  openPlaceResolution(persecuted, 'p1', 1); persecuted.huntTokens.creature = [2];
  act(persecuted, resolveNotAloneLocation(persecuted, 'p1', {
    mode: 'power', targetPlaceId: 2, placeIds: [], expectedRevision: persecuted.revision,
  }), 'return physical Lair from copied Jungle under Persecution');
  assert(persecuted.players.get('p1')!.returnPlayed.has(1) && persecuted.players.get('p1')!.discard.includes(4),
    'Persecution copied Jungle must return either the initial physical Place or one discard, never both');

  const persecutedGate = initNotAloneGame('SURVIVAL-GATE-COPY-PERSECUTION', roster(2), seeded(606));
  movePlaceToDiscard(persecutedGate, 'p1', 4); movePlaceToDiscard(persecutedGate, 'p1', 5);
  persecutedGate.effects.persecution = true; openPlaceResolution(persecutedGate, 'p1', 1);
  moveSurvivalToHand(persecutedGate, 'p1', 'gate');
  act(persecutedGate, playNotAloneSurvival(persecutedGate, 'p1', {
    cardId: 'gate', targetPlaceId: 6, expectedRevision: persecutedGate.revision,
  }), 'Gate copies Swamp under Persecution');
  act(persecutedGate, resolveNotAloneLocation(persecutedGate, 'p1', {
    mode: 'power', placeIds: [4], expectedRevision: persecutedGate.revision,
  }), 'recover one discard through copied Swamp under Persecution');
  assert(!persecutedGate.players.get('p1')!.returnPlayed.has(1) && persecutedGate.players.get('p1')!.discard.join(',') === '5',
    'Persecution Gate copied Swamp must recover one discard instead of also returning the initial physical Place');
}

{
  const state = initNotAloneGame('PLACE-JUNGLE', roster(2), seeded(61));
  movePlaceToDiscard(state, 'p1', 1); openPlaceResolution(state, 'p1', 2);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', placeIds: [1], expectedRevision: state.revision }), 'resolve Jungle');
  const player = state.players.get('p1')!;
  assert(player.returnPlayed.has(2) && player.placeHand.includes(1), 'Jungle must return itself and one discarded Place');
  coveredPlacePowers.add(2);
}

{
  const state = initNotAloneGame('PLACE-RIVER', roster(2), seeded(62));
  openPlaceResolution(state, 'p1', 3);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'resolve River');
  assert(state.players.get('p1')!.riverNext, 'River must prepare a two-card next-turn choice');
  coveredPlacePowers.add(3);
}

{
  const state = initNotAloneGame('PLACE-BEACH-CHARGE', roster(2), seeded(63));
  openPlaceResolution(state, 'p1', 4);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', choice: 'charge', expectedRevision: state.revision }), 'charge Beach');
  assert(state.beachCharged, 'Beach must charge explicitly');
  const launch = initNotAloneGame('PLACE-BEACH-LAUNCH', roster(2), seeded(64));
  launch.beachCharged = true; openPlaceResolution(launch, 'p1', 4);
  act(launch, resolveNotAloneLocation(launch, 'p1', { mode: 'power', choice: 'launch', expectedRevision: launch.revision }), 'launch Beach');
  assert(!launch.beachCharged && launch.rescueProgress === 1, 'Charged Beach must explicitly launch and advance Rescue');
  coveredPlacePowers.add(4);
}

{
  const state = initNotAloneGame('PLACE-ROVER', roster(2), seeded(65));
  openPlaceResolution(state, 'p1', 5);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', targetPlaceId: 6, expectedRevision: state.revision }), 'resolve Rover');
  assert(state.players.get('p1')!.placeHand.includes(6) && state.reserve[6] === 0, 'Rover must take one available advanced Place');
  coveredPlacePowers.add(5);
}

{
  const state = initNotAloneGame('PLACE-SWAMP', roster(2), seeded(66));
  grantAdvancedPlace(state, 'p1', 6); movePlaceToDiscard(state, 'p1', 1); movePlaceToDiscard(state, 'p1', 2);
  openPlaceResolution(state, 'p1', 6);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', placeIds: [1, 2], expectedRevision: state.revision }), 'resolve Swamp');
  const player = state.players.get('p1')!;
  assert(player.returnPlayed.has(6) && player.discard.length === 0, 'Swamp must return itself and two discarded Places');
  coveredPlacePowers.add(6);
}

{
  const state = initNotAloneGame('PLACE-SHELTER', roster(2), seeded(67));
  grantAdvancedPlace(state, 'p1', 7); openPlaceResolution(state, 'p1', 7);
  const before = state.players.get('p1')!.survivalHand.length;
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'resolve Shelter draw');
  assert(state.pendingSurvivalChoice?.cards.length === 2, 'Shelter must draw two cards for a private choice');
  const pendingCards = [...state.pendingSurvivalChoice.cards];
  assert(toNotAlonePrivateState(state, 'p1').canResolve === false
    && toNotAlonePrivateState(state, 'p1').resolutionOptions === null, 'Shelter choice must suspend Place resolution');
  rejectAct(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [], expectedRevision: state.revision }), 'fresh-revision Shelter bypass');
  assert(state.pendingSurvivalChoice?.cards.join(',') === pendingCards.join(','), 'Rejected Shelter bypass changed the private draw');
  act(state, chooseNotAloneSurvivalCard(state, 'p1', state.pendingSurvivalChoice!.cards[0]!, state.revision), 'choose Shelter card');
  assert(state.players.get('p1')!.survivalHand.length === before + 1, 'Shelter must keep exactly one of two drawn cards');
  rejectAct(state, chooseNotAloneSurvivalCard(state, 'p1', pendingCards[1]!, state.revision), 'repeat Shelter choice');
  coveredPlacePowers.add(7);
}

{
  const state = initNotAloneGame('PLACE-SHELTER-FORFEIT', roster(3), seeded(670));
  prepareAllHuntedForHunt(state); grantAdvancedPlace(state, 'p1', 7); openPlaceResolution(state, 'p1', 7);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'open forfeited Shelter choice');
  act(state, forfeitNotAlonePlayers(state, ['p1'], state.revision), 'forfeit pending Shelter chooser');
  assert(state.pendingSurvivalChoice === null, 'Forfeited Shelter choice did not settle deterministically');
}

{
  const state = initNotAloneGame('PLACE-WRECK', roster(2), seeded(68));
  grantAdvancedPlace(state, 'p1', 8); openPlaceResolution(state, 'p1', 8);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'resolve Wreck');
  assert(state.rescueProgress === 1 && state.usedWreck, 'Wreck must advance Rescue once per round');
  coveredPlacePowers.add(8);
}

{
  const state = initNotAloneGame('PLACE-SOURCE', roster(3), seeded(69));
  prepareAllHuntedForHunt(state); grantAdvancedPlace(state, 'p1', 9); state.players.get('p2')!.will = 2; openPlaceResolution(state, 'p1', 9);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', choice: 'will', targetPlayerId: 'p2', expectedRevision: state.revision }), 'resolve Source healing');
  assert(state.players.get('p2')!.will === 3, 'Source must restore one Will to an active Hunted');
  coveredPlacePowers.add(9);
}

{
  const state = initNotAloneGame('PLACE-ARTEFACT', roster(2), seeded(70));
  grantAdvancedPlace(state, 'p1', 10); openPlaceResolution(state, 'p1', 10);
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'resolve Artefact');
  assert(state.players.get('p1')!.artefactNext, 'Artefact must prepare two physical Place slots next turn');
  coveredPlacePowers.add(10);
}

{
  const state = initNotAloneGame('RIVER-CHOICE', roster(2), seeded(71));
  const player = state.players.get('p1')!; player.riverNext = true;
  act(state, selectNotAlonePlaces(state, 'p1', [1, 2], state.planningWindowRevision), 'prepare two River destinations');
  assert(player.selectedPlaces.length === 2 && player.playedPlaces.length === 2, 'River must commit two physical candidates');
  state.phase = 'river_choice'; state.pendingPlayerId = 'p1';
  act(state, chooseNotAloneRiverDestination(state, 'p1', 2, state.revision), 'choose River destination after Hunt lock');
  assert(player.selectedPlaces.join(',') === '2' && player.playedPlaces.join(',') === '2', 'River must retain only the chosen physical slot');
}

{
  const state = initNotAloneGame('ARTEFACT-SELECTION', roster(2), seeded(72));
  const player = state.players.get('p1')!; player.artefactNext = true;
  act(state, selectNotAlonePlaces(state, 'p1', [1, 2], state.planningWindowRevision), 'select two Artefact slots');
  assert(player.selectedPlaces.join(',') === '1,2' && player.playedPlaces.join(',') === '1,2' && !player.artefactNext, 'Artefact must preserve two physical slot identities and consume its flag');
}

{
  const state = initNotAloneGame('RIVER-ARTEFACT-MUTUAL', roster(2), seeded(73));
  grantAdvancedPlace(state, 'p1', 10); const player = state.players.get('p1')!; player.riverNext = true;
  openPlaceResolution(state, 'p1', 10);
  rejectAct(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'Artefact cannot stack with River');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [], expectedRevision: state.revision }), 'recover instead of stacking River and Artefact');
  assert(player.riverNext && !player.artefactNext, 'River and Artefact next-turn powers must remain mutually exclusive');
}

{
  const state = initNotAloneGame('DESPAIR-PLACE-FALLBACK', roster(3), seeded(74));
  prepareAllHuntedForHunt(state); grantAdvancedPlace(state, 'p1', 7); movePlaceToDiscard(state, 'p1', 1); state.effects.noSurvival = true;
  openPlaceResolution(state, 'p1', 7);
  const shelter = notAloneResolutionOptions(state, 'p1')!;
  assert(!shelter.canUsePlacePower && shelter.canRecoverPlace, 'Despair must project Shelter recovery instead of a draw');
  rejectAct(state, resolveNotAloneLocation(state, 'p1', { mode: 'power', expectedRevision: state.revision }), 'Shelter cannot draw under Despair');
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', placeIds: [1], expectedRevision: state.revision }), 'recover at Shelter under Despair');

  const sourceState = initNotAloneGame('DESPAIR-SOURCE', roster(3), seeded(75));
  prepareAllHuntedForHunt(sourceState); grantAdvancedPlace(sourceState, 'p1', 9); sourceState.effects.noSurvival = true; sourceState.players.get('p2')!.will = 2;
  openPlaceResolution(sourceState, 'p1', 9);
  const source = notAloneResolutionOptions(sourceState, 'p1')!;
  assert(source.sourceChoices.join(',') === 'will', 'Despair Source options must omit Survival draw');
  act(sourceState, resolveNotAloneLocation(sourceState, 'p1', { mode: 'power', choice: 'will', targetPlayerId: 'p2', expectedRevision: sourceState.revision }), 'heal with Source under Despair');

  const fallback = initNotAloneGame('DESPAIR-SOURCE-RECOVERY', roster(3), seeded(751));
  prepareAllHuntedForHunt(fallback); grantAdvancedPlace(fallback, 'p1', 9); movePlaceToDiscard(fallback, 'p1', 1); fallback.effects.noSurvival = true;
  openPlaceResolution(fallback, 'p1', 9);
  const fallbackOptions = notAloneResolutionOptions(fallback, 'p1')!;
  assert(!fallbackOptions.canUsePlacePower && fallbackOptions.canRecoverPlace && fallbackOptions.sourceChoices.length === 0,
    'Source with no wounded Hunted under Despair must project recovery, not a no-op power');
  rejectAct(fallback, resolveNotAloneLocation(fallback, 'p1', { mode: 'power', choice: 'card', expectedRevision: fallback.revision }), 'Source cannot draw under Despair');
  act(fallback, resolveNotAloneLocation(fallback, 'p1', { mode: 'recover', placeIds: [1], expectedRevision: fallback.revision }), 'recover at unusable Source under Despair');
}

{
  const state = initNotAloneGame('CLONE-STACK', roster(3), seeded(80));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; state.maxHuntCards = 3;
  for (const [cardId, payload] of [
    ['anticipation', { targetPlayerId: 'p1' }], ['fierceness', {}], ['clone', {}],
  ] as const) {
    moveHuntToHand(state, cardId);
    act(state, playNotAloneHuntCard(state, 'p0', { cardId, ...payload, expectedRevision: state.revision }), `play ${cardId} in Clone stack`);
  }
  const cloneTarget = state.players.get('p1')!, creatureTarget = state.players.get('p2')!;
  cloneTarget.selectedPlaces = [2]; cloneTarget.playedPlaces = [2]; creatureTarget.selectedPlaces = [3]; creatureTarget.playedPlaces = [3];
  state.huntTokens.target = [2]; state.huntTokens.creature = [3]; state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'resolve Clone-only catch');
  assert(cloneTarget.will === 1, 'Clone plus Fierceness must remove two Will away from the Lair');
  assert(state.assimilationProgress === 2, 'Clone catch must advance ordinary catch and Anticipation exactly once');
  state.reckoningStageIndex = 2; state.resolutionQueue = [{ playerId: 'p2', placeIndex: 0, stage: 'creature' }]; state.pendingPlayerId = 'p2';
  act(state, resolveNotAloneLocation(state, 'p2', { mode: 'recover', expectedRevision: state.revision }), 'resolve physical Creature catch after Clone');
  assert(creatureTarget.will === 1 && state.assimilationProgress === 2, 'A later physical Creature catch must not repeat global catch or Anticipation advances');
}

{
  const state = initNotAloneGame('CLONE-ARTEFACT', roster(2), seeded(81));
  prepareAllHuntedForHunt(state); state.phase = 'creature_planning'; state.maxHuntCards = 3;
  for (const [cardId, payload] of [
    ['anticipation', { targetPlayerId: 'p1' }], ['fierceness', {}], ['clone', {}],
  ] as const) {
    moveHuntToHand(state, cardId);
    act(state, playNotAloneHuntCard(state, 'p0', { cardId, ...payload, expectedRevision: state.revision }), `play ${cardId} for Artefact overlap`);
  }
  const player = state.players.get('p1')!;
  player.selectedPlaces = [2, 3]; player.playedPlaces = [2, 3]; state.huntTokens.target = [2]; state.huntTokens.creature = [3];
  state.phase = 'reckoning'; state.reckoningStageIndex = 0; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'resolve Artefact Clone encounter');
  state.reckoningStageIndex = 2; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 1, stage: 'creature' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'resolve Artefact Creature encounter');
  assert(player.will === 3 && state.assimilationProgress === 3, 'Artefact must lose Will at both Creature signals while catch and Anticipation remain once, plus one exhaustion advance');
}

{
  const state = initNotAloneGame('CLONE-DODGE', roster(2), seeded(82));
  activateHuntCard(state, 'clone'); state.effects.clone = true;
  const player = state.players.get('p1')!;
  player.selectedPlaces = [2]; player.playedPlaces = [2]; player.ignoreCreature = true;
  state.huntTokens.target = [2]; state.huntTokens.creature = [2]; state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'Dodge evades Clone');
  state.reckoningStageIndex = 2; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'creature' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'Dodge evades physical Creature');
  assert(player.will === 3 && state.assimilationProgress === 0, 'One Dodge must suppress both Creature-token signals and all their track effects');
}

{
  const state = initNotAloneGame('MUTATION-ENCOUNTER', roster(2), seeded(83));
  activateHuntCard(state, 'mutation'); state.effects.mutation = true;
  const player = state.players.get('p1')!; player.selectedPlaces = [2]; player.playedPlaces = [2]; state.huntTokens.artemia = [2];
  state.phase = 'reckoning'; state.reckoningStageIndex = 1; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'artemia' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'open Artemia private discard');
  assert(state.pendingCardChoice?.kind === 'artemia_discard', 'Artemia must request a private Place discard');
  act(state, chooseNotAloneCardEffect(state, 'p1', [1], state.revision), 'resolve Mutation Artemia discard');
  assert(player.will === 2 && player.discard.includes(1), 'Mutation must remove one Will after Artemia makes its private discard');
}

{
  const state = initNotAloneGame('ARTEFACT-RETURNED-SCREAM', roster(2), seeded(831));
  activateHuntCard(state, 'scream'); state.effects.scream = true;
  const player = state.players.get('p1')!;
  player.placeHand = [2, 3, 4]; player.discard = [1, 5]; player.selectedPlaces = [2, 3]; player.playedPlaces = [2, 3]; player.returnPlayed.add(2);
  state.huntTokens.target = [3]; state.phase = 'reckoning'; state.reckoningStageIndex = 0;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 1, stage: 'target' }]; state.pendingPlayerId = 'p1'; state.pendingPlaceIndex = 1;
  const options = notAloneResolutionOptions(state, 'p1')!;
  assert(options.screamDiscardCount === 2 && options.screamDiscardPlaceIds.sort().join(',') === '2,4', 'Scream must offer a Place returned by an earlier Artefact slot');
  act(state, resolveNotAloneLocation(state, 'p1', {
    mode: 'recover', huntChoice: 'discard', huntPlaceIds: [2, 4], expectedRevision: state.revision,
  }), 'discard returned and ordinary held Places to Scream');
  assert(player.discard.sort().join(',') === '1,2,4,5' && toNotAlonePublicState(state, 'p0').players.find((entry) => entry.playerId === 'p1')!.handCount === 0,
    'Scream must move the returned physical card into discard without double-counting the represented hand');
}

{
  const state = initNotAloneGame('ARTEFACT-RETURNED-ARTEMIA', roster(2), seeded(832));
  const player = state.players.get('p1')!;
  player.placeHand = [2, 3]; player.discard = [1, 4, 5]; player.selectedPlaces = [2, 3]; player.playedPlaces = [2, 3]; player.returnPlayed.add(2);
  state.huntTokens.artemia = [3]; state.phase = 'reckoning'; state.reckoningStageIndex = 1;
  state.resolutionQueue = [{ playerId: 'p1', placeIndex: 1, stage: 'artemia' }]; state.pendingPlayerId = 'p1'; state.pendingPlaceIndex = 1;
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'open Artemia choice after a prior Artefact return');
  assert(state.pendingCardChoice?.kind === 'artemia_discard' && toNotAlonePrivateState(state, 'p1').cardChoice?.placeOptions.join(',') === '2',
    'Artemia must require the sole Place returned by the earlier Artefact slot');
  act(state, chooseNotAloneCardEffect(state, 'p1', [2], state.revision), 'discard the returned physical Place to Artemia');
  assert(player.discard.sort().join(',') === '1,2,4,5', 'Artemia must discard the returned Place exactly once');
}

{
  const state = initNotAloneGame('FORCE-FIELD-MOVEMENT', roster(2), seeded(84));
  state.maxHuntCards = 2; moveHuntToHand(state, 'force_field');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [1, 2], expectedRevision: state.revision }), 'establish Force Field footprint');
  const player = state.players.get('p1')!; player.selectedPlaces = [3]; player.playedPlaces = [3];
  state.phase = 'reckoning'; state.reactionWindowRevision = state.revision; moveHuntToHand(state, 'detour');
  const detourOptions = toNotAlonePrivateState(state, 'p0').huntOptions.detourOptions.find((option) => option.playerId === 'p1' && option.placeIndex === 0)!;
  assert(!detourOptions.destinationPlaceIds.includes(2), 'Detour projection must omit inaccessible Force Field destinations');
  rejectAct(state, playNotAloneHuntCard(state, 'p0', {
    cardId: 'detour', targetPlayerId: 'p1', originPlaceId: 3, placeIndex: 0, placeIds: [2], expectedRevision: state.revision,
  }), 'Detour cannot move a Hunted into a Force Field');
}

{
  const state = initNotAloneGame('FORCE-FIELD-MIRAGE-MOVE', roster(2), seeded(85));
  state.maxHuntCards = 3; activateHuntCard(state, 'force_field'); activateHuntCard(state, 'mirage'); activateHuntCard(state, 'clone');
  state.effects.clone = true; state.forceFieldPlaces = new Set([2, 3]); state.huntTokens.target = [2, 3];
  const player = state.players.get('p1')!; player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'reckoning'; state.reactionWindowRevision = state.revision; moveSurvivalToHand(state, 'p1', 'wrong_track');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', token: 'target', placeIds: [4], expectedRevision: state.reactionWindowRevision }), 'move Clone Target carrying Mirage');
  assert(state.selectionBlockedPlaces.has(2) && state.selectionBlockedPlaces.has(3) && !state.selectionBlockedPlaces.has(4), 'Force Field inaccessible footprint must remain immutable after Target movement');
  assert(!state.disabledPlaces.has(2) && !state.disabledPlaces.has(3) && state.disabledPlaces.has(4), 'Mirage power disablement must follow the live Target');
}

{
  const state = initNotAloneGame('STASIS-AMPLIFIER', roster(2), seeded(86));
  const player = state.players.get('p1')!; player.selectedPlaces = [1]; player.playedPlaces = [1];
  state.phase = 'end_of_turn'; state.maxHuntCards = 2; state.beachCharged = true; moveHuntToHand(state, 'stasis'); moveSurvivalToHand(state, 'p1', 'amplifier');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'stasis', expectedRevision: state.revision }), 'play Stasis before Amplifier');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'amplifier', expectedRevision: state.reactionWindowRevision }), 'play Amplifier after Stasis');
  assert(state.rescueProgress === 0, 'Earlier Stasis must suppress later Amplifier movement');

  const reverse = initNotAloneGame('AMPLIFIER-STASIS', roster(2), seeded(87));
  const reversePlayer = reverse.players.get('p1')!; reversePlayer.selectedPlaces = [1]; reversePlayer.playedPlaces = [1];
  reverse.phase = 'end_of_turn'; reverse.maxHuntCards = 2; reverse.beachCharged = true; moveHuntToHand(reverse, 'stasis'); moveSurvivalToHand(reverse, 'p1', 'amplifier');
  act(reverse, playNotAloneSurvival(reverse, 'p1', { cardId: 'amplifier', expectedRevision: reverse.reactionWindowRevision }), 'play Amplifier before Stasis');
  act(reverse, playNotAloneHuntCard(reverse, 'p0', { cardId: 'stasis', expectedRevision: reverse.revision }), 'play Stasis after Amplifier');
  assert(reverse.rescueProgress === 1, 'Amplifier must advance immediately before a later Stasis');
}

{
  const state = initNotAloneGame('REACTION-EPOCH-SURVIVAL', roster(3), seeded(88));
  const first = state.players.get('p1')!, second = state.players.get('p2')!;
  first.selectedPlaces = [1]; first.playedPlaces = [1]; second.selectedPlaces = [2]; second.playedPlaces = [2];
  state.phase = 'reckoning'; state.huntTokens.creature = [1]; state.huntTokens.artemia = [2]; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'wrong_track'); moveSurvivalToHand(state, 'p2', 'detector');
  const oldWindow = state.reactionWindowRevision;
  act(state, passNotAloneReaction(state, 'p2', oldWindow), 'second Hunted passes old reaction window');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', placeIds: [2], expectedRevision: oldWindow }), 'first Hunted changes token state');
  const beforeReplay = state.revision;
  rejectAct(state, passNotAloneReaction(state, 'p2', oldWindow), 'delayed pass cannot cross a Survival state change');
  assert(state.revision === beforeReplay && !state.reactionPasses.has('p2'), 'Rejected old-window pass must not mutate state');
  act(state, passNotAloneReaction(state, 'p2', state.reactionWindowRevision), 'second Hunted passes fresh reaction window');
}

{
  const state = initNotAloneGame('REACTION-EPOCH-HUNT', roster(2), seeded(89));
  const player = state.players.get('p1')!; player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.artemia = [1];
  state.phase = 'reckoning'; state.maxHuntCards = 2; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'detector'); moveHuntToHand(state, 'cataclysm');
  const oldWindow = state.reactionWindowRevision;
  act(state, passNotAloneReaction(state, 'p1', oldWindow), 'Hunted passes before Creature reaction');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'cataclysm', placeIds: [1], expectedRevision: state.revision }), 'Creature changes reaction state');
  const beforeReplay = state.revision;
  rejectAct(state, passNotAloneReaction(state, 'p1', oldWindow), 'delayed pass cannot cross a Hunt state change');
  assert(state.revision === beforeReplay && !state.reactionPasses.has('p1'), 'Old pass must stay cleared after Creature action');
}

{
  const state = initNotAloneGame('NO-OP-PASS', roster(2), seeded(90));
  prepareAllHuntedForHunt(state); state.phase = 'reckoning'; state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'adrenaline');
  rejectAct(state, passNotAloneReaction(state, 'p1', state.reactionWindowRevision), 'seat without a legal reaction cannot create a no-op pass');
}

{
  const state = initNotAloneGame('FORCE-FIELD-SHORTAGE', roster(3), seeded(91));
  const player = state.players.get('p1')!; player.artefactNext = true;
  for (const place of [1, 2, 4, 5] as NotAlonePlaceId[]) movePlaceToDiscard(state, 'p1', place);
  act(state, resistNotAlone(state, 'p1', 1, [1, 2], state.planningWindowRevision), 'Resist before Force Field shortage');
  moveHuntToHand(state, 'force_field');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [1, 2], expectedRevision: state.revision }), 'Force Field removes recovered Artefact choices');
  assert(toNotAlonePrivateState(state, 'p1').canGiveUp, 'A stranded Artefact Hunted must receive a forced Give Up escape');
  act(state, giveUpNotAlone(state, 'p1', state.planningWindowRevision), 'forced Give Up after Force Field shortage');
  assert(player.placeHand.length === 5 && state.assimilationProgress === 1, 'Forced Give Up must restore a legal hand and advance Assimilation once');
}

{
  const state = initNotAloneGame('FORCE-FIELD-FORFEIT', roster(3), seeded(92));
  const player = state.players.get('p1')!; player.artefactNext = true;
  for (const place of [1, 2, 4, 5] as NotAlonePlaceId[]) movePlaceToDiscard(state, 'p1', place);
  act(state, resistNotAlone(state, 'p1', 1, [1, 2], state.planningWindowRevision), 'forfeited seat resists before shortage');
  moveHuntToHand(state, 'force_field');
  act(state, playNotAloneHuntCard(state, 'p0', { cardId: 'force_field', placeIds: [1, 2], expectedRevision: state.revision }), 'Force Field strands future forfeited seat');
  act(state, forfeitNotAlonePlayers(state, ['p1'], state.revision), 'forfeit stranded Artefact seat');
  assert(player.forfeited && player.selectedPlaces.length === 2, 'Autopilot must Give Up and then make a legal two-slot selection');
}

{
  const state = initNotAloneGame('DURABLE-TOXIN-BLOCK', roster(2), seeded(93));
  activateHuntCard(state, 'toxin'); activateHuntCard(state, 'clone'); state.effects.toxin = true; state.effects.clone = true; state.maxHuntCards = 2;
  const player = state.players.get('p1')!; player.selectedPlaces = [2]; player.playedPlaces = [2]; state.huntTokens.target = [2]; state.huntTokens.creature = [5];
  moveSurvivalToHand(state, 'p1', 'wrong_track'); moveSurvivalToHand(state, 'p1', 'adrenaline');
  state.phase = 'reckoning'; state.reckoningStageIndex = 0; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', huntSurvivalCardId: 'adrenaline', expectedRevision: state.revision }), 'resolve Toxin before token movement');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', token: 'target', placeIds: [1], expectedRevision: state.reactionWindowRevision }), 'move Target away after Toxin');
  assert(state.resolvedPlaceActions.has('p1:0'), 'Resolved Toxin must durably block the physical slot after Target moves away');
}

{
  const state = initNotAloneGame('DURABLE-CLONE-BLOCK', roster(2), seeded(94));
  activateHuntCard(state, 'clone'); activateHuntCard(state, 'toxin'); state.effects.clone = true; state.effects.toxin = true; state.maxHuntCards = 2;
  const player = state.players.get('p1')!; player.selectedPlaces = [2]; player.playedPlaces = [2]; state.huntTokens.target = [2]; state.huntTokens.creature = [5];
  moveSurvivalToHand(state, 'p1', 'wrong_track');
  state.phase = 'reckoning'; state.reckoningStageIndex = 0; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', { mode: 'recover', expectedRevision: state.revision }), 'resolve Clone before token movement');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', token: 'target', placeIds: [1], expectedRevision: state.reactionWindowRevision }), 'move Target away after Clone');
  assert(state.resolvedPlaceActions.has('p1:0'), 'Resolved Clone catch must durably block the physical slot after Target moves away');
}

{
  const state = initNotAloneGame('SCREAM-MOVE-OFF-PERMITS-PLACE', roster(2), seeded(95));
  activateHuntCard(state, 'scream'); activateHuntCard(state, 'clone'); state.effects.scream = true; state.effects.clone = true; state.maxHuntCards = 2;
  const player = state.players.get('p1')!; player.selectedPlaces = [2]; player.playedPlaces = [2]; state.huntTokens.target = [2]; state.huntTokens.creature = [5];
  moveSurvivalToHand(state, 'p1', 'wrong_track');
  state.phase = 'reckoning'; state.reckoningStageIndex = 0; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = 'p1';
  act(state, resolveNotAloneLocation(state, 'p1', {
    mode: 'recover', huntChoice: 'discard', huntPlaceIds: [3, 4], expectedRevision: state.revision,
  }), 'resolve Scream before moving Target');
  act(state, playNotAloneSurvival(state, 'p1', { cardId: 'wrong_track', token: 'target', placeIds: [1], expectedRevision: state.reactionWindowRevision }), 'move Target away before Clone');
  assert(!state.resolvedPlaceActions.has('p1:0') && state.pendingPlayerId === 'p1'
    && state.resolutionQueue[state.pendingCursor]?.stage === 'place', 'Scream alone must not block the moved-off physical Place action');
}

{
  const state = initNotAloneGame('LATE-DETECTOR', roster(2), seeded(96));
  const player = state.players.get('p1')!; player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.artemia = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 1; state.resolvedEncounterStages.add('p1:0:artemia'); state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'detector');
  assert(!toNotAlonePrivateState(state, 'p1').playableSurvivalCardIds.includes('detector'), 'Detector must disappear after the last Artemia encounter resolves');
  rejectAct(state, playNotAloneSurvival(state, 'p1', { cardId: 'detector', expectedRevision: state.reactionWindowRevision }), 'late Detector cannot be consumed as a no-op');

  const multi = initNotAloneGame('LATE-DETECTOR-MULTI', roster(2), seeded(97));
  const multiPlayer = multi.players.get('p1')!; multiPlayer.selectedPlaces = [1, 2]; multiPlayer.playedPlaces = [1, 2]; multi.huntTokens.artemia = [1, 2];
  multi.phase = 'reckoning'; multi.reckoningStageIndex = 1; multi.resolvedEncounterStages.add('p1:0:artemia'); multi.reactionWindowRevision = multi.revision;
  moveSurvivalToHand(multi, 'p1', 'detector');
  assert(toNotAlonePrivateState(multi, 'p1').playableSurvivalCardIds.includes('detector'), 'Detector must remain legal while a second physical slot still faces Artemia');
  act(multi, playNotAloneSurvival(multi, 'p1', { cardId: 'detector', expectedRevision: multi.reactionWindowRevision }), 'Detector protects remaining Artefact slot');
}

{
  const state = initNotAloneGame('LATE-DODGE', roster(2), seeded(98));
  activateHuntCard(state, 'clone'); state.effects.clone = true;
  const player = state.players.get('p1')!; player.selectedPlaces = [1]; player.playedPlaces = [1]; state.huntTokens.target = [1];
  state.phase = 'reckoning'; state.reckoningStageIndex = 0; state.resolvedTargetEffects.add('p1:0:0'); state.resolvedEncounterStages.add('p1:0:target'); state.reactionWindowRevision = state.revision;
  moveSurvivalToHand(state, 'p1', 'dodge');
  assert(!toNotAlonePrivateState(state, 'p1').playableSurvivalCardIds.includes('dodge'), 'Dodge must disappear after the last Creature-token encounter resolves');
  rejectAct(state, playNotAloneSurvival(state, 'p1', { cardId: 'dodge', expectedRevision: state.reactionWindowRevision }), 'late Dodge cannot be consumed as a no-op');

  const multi = initNotAloneGame('LATE-DODGE-MULTI', roster(2), seeded(99));
  activateHuntCard(multi, 'clone'); multi.effects.clone = true;
  const multiPlayer = multi.players.get('p1')!; multiPlayer.selectedPlaces = [1, 2]; multiPlayer.playedPlaces = [1, 2]; multi.huntTokens.target = [1, 2];
  multi.phase = 'reckoning'; multi.reckoningStageIndex = 0; multi.resolvedTargetEffects.add('p1:0:0'); multi.reactionWindowRevision = multi.revision;
  moveSurvivalToHand(multi, 'p1', 'dodge');
  assert(toNotAlonePrivateState(multi, 'p1').playableSurvivalCardIds.includes('dodge'), 'Dodge must remain legal for a second unresolved Clone slot');
  act(multi, playNotAloneSurvival(multi, 'p1', { cardId: 'dodge', expectedRevision: multi.reactionWindowRevision }), 'Dodge protects remaining Artefact Clone slot');
}

{
  const state = initNotAloneGame('SOURCE-PARITY', roster(3), seeded(15));
  const source = state.players.get('p1')!, target = state.players.get('p2')!;
  source.selectedPlaces = [9]; source.playedPlaces = [9]; target.will = 2;
  state.phase = 'reckoning'; state.resolutionQueue = [{ playerId: 'p1', placeIndex: 0, stage: 'place' }]; state.pendingPlayerId = 'p1';
  target.forfeited = true;
  const options = notAloneResolutionOptions(state, 'p1')!;
  assert(!options.healTargetPlayerIds.includes('p2') && !options.sourceChoices.includes('will'), 'Source projected a forfeited heal target');
  const rejected = resolveNotAloneLocation(state, 'p1', { mode: 'power', choice: 'will', targetPlayerId: 'p2', expectedRevision: state.revision });
  assert(!rejected.ok && target.will === 2, 'Source direct action accepted a forfeited target');
}

{
  const state = initNotAloneGame('AUTOPILOT-ORDER', roster(2), seeded(16));
  const player = state.players.get('p1')!;
  player.selectedPlaces = [1, 2]; player.playedPlaces = [1, 2]; player.forfeited = true;
  state.phase = 'reckoning'; state.pendingCardChoice = {
    kind: 'artefact_order', playerId: 'p1', count: 2, queue: [], artefactStage: 'place', artefactSignature: '1,2',
  };
  settleNotAloneAutopilot(state);
  assert(state.pendingCardChoice === null, 'Forfeited Artefact order did not settle');
}

for (const definition of NOT_ALONE_SURVIVAL_CARDS) {
  const state = initNotAloneGame(`SURVIVAL-TIMING-${definition.id}`, roster(2), seeded(200 + definition.phase));
  moveSurvivalToHand(state, 'p1', definition.id);
  if (definition.phase === 1) prepareAllHuntedForHunt(state);
  state.phase = definition.phase === 1 ? 'end_of_turn' : 'hunted_planning';
  const expectedRevision = state.phase === 'end_of_turn' ? state.reactionWindowRevision : state.planningWindowRevision;
  rejectAct(state, playNotAloneSurvival(state, 'p1', { cardId: definition.id, expectedRevision }), `${definition.name} rejects the wrong phase`);
}

for (const definition of NOT_ALONE_HUNT_CARDS) {
  const state = initNotAloneGame(`HUNT-TIMING-${definition.id}`, roster(2), seeded(300 + definition.phase));
  moveHuntToHand(state, definition.id);
  if (definition.phase === 1) prepareAllHuntedForHunt(state);
  state.phase = definition.phase === 1 ? 'end_of_turn' : 'hunted_planning';
  rejectAct(state, playNotAloneHuntCard(state, 'p0', { cardId: definition.id, expectedRevision: state.revision }), `${definition.name} rejects an illegal timing or unavailable copy`);
}

assert([...coveredSurvivalCards].sort().join(',') === NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id).sort().join(','),
  `Survival behavioural matrix incomplete: ${[...coveredSurvivalCards].sort().join(',')}`);
assert([...coveredHuntCards].sort().join(',') === NOT_ALONE_HUNT_CARDS.map((card) => card.id).sort().join(','),
  `Hunt behavioural matrix incomplete: ${[...coveredHuntCards].sort().join(',')}`);
assert([...coveredPlacePowers].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8,9,10',
  `Place-power behavioural matrix incomplete: ${[...coveredPlacePowers].sort((a, b) => a - b).join(',')}`);

let games = 0;
let commands = 0;
const seedOffset = Number(process.env.NOT_ALONE_SEED_OFFSET ?? 0);
if (!Number.isSafeInteger(seedOffset) || seedOffset < 0) throw new Error('Invalid NOT_ALONE_SEED_OFFSET');
for (let players = 2; players <= 7; players += 1) {
  for (const face of ['continuous', 'alternating'] as const) {
    for (let seedIndex = 0; seedIndex < 16; seedIndex += 1) {
      commands += runFullGame(players, face, seedOffset + 1000 + players * 100 + seedIndex * 10 + (face === 'continuous' ? 0 : 1), 'safe');
      commands += runFullGame(players, face, seedOffset + 2000 + players * 100 + seedIndex * 10 + (face === 'continuous' ? 0 : 1), 'hunt');
      games += 2;
    }
    commands += runFullGame(players, face, seedOffset + 7000 + players * 100 + (face === 'continuous' ? 0 : 1), 'mixed'); games += 1;
  }
}
let departureGames = 0;
for (let players = 2; players <= 7; players += 1) {
  for (const face of ['continuous', 'alternating'] as const) {
    for (const phase of ['hunted_planning', 'exploration_reaction', 'creature_planning', 'hunting_reaction', 'reckoning', 'end_of_turn'] as const) {
      for (const policy of ['safe', 'hunt'] as const) {
        commands += runFullGame(players, face, seedOffset + 9000 + players * 100 + departureGames, policy, phase);
        departureGames += 1;
      }
    }
  }
}
console.log(`NOT ALONE SIM PASS: ${games} normal full games and ${departureGames} departure full games (2-7 players, both faces; seed offset ${seedOffset}), ${commands} loop commands, ${assertions} assertions; 15/15 Survival, 20/20 Hunt and 10/10 Place behaviours covered.`);
