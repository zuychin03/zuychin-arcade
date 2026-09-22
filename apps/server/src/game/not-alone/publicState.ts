import type { NotAloneHuntCardId, NotAlonePrivateState, NotAlonePublicState } from '@zuychin-arcade/types';
import { NOT_ALONE_CONTENT_SET, NOT_ALONE_HUNT_BY_ID, NOT_ALONE_MODE_DESCRIPTION } from '@zuychin-arcade/types';
import {
  legalNotAloneCataclysmPlaces,
  legalNotAloneDetourDestinations,
  notAloneResolutionOptions,
  notAloneSurvivalOptions,
  playableNotAloneHuntCards,
  playableNotAloneSurvivalCards,
  type NotAloneServerState,
} from './engine.js';

function effectiveHuntCards(state: NotAloneServerState): NotAloneHuntCardId[] {
  return state.activeHuntCards.flatMap((cardId) => cardId === 'flashback'
    ? (state.copiedHuntCard ? [state.copiedHuntCard] : [])
    : [cardId]);
}

function requiredTokenCount(state: NotAloneServerState, token: 'target' | 'artemia'): number | null {
  const cards = effectiveHuntCards(state).filter((id) => NOT_ALONE_HUNT_BY_ID[id].token === token);
  if (token === 'artemia' && state.artemiaAvailable && cards.length === 0) return 1;
  return cards.length ? Math.max(...cards.map((id) => NOT_ALONE_HUNT_BY_ID[id].placeCount ?? 1)) : null;
}

function everyLiveHuntedPassed(state: NotAloneServerState): boolean {
  return state.huntedOrder.every((id) => state.players.get(id)!.forfeited
    || state.reactionPasses.has(id)
    || playableNotAloneSurvivalCards(state, id).length === 0);
}

function reactionWindowOpen(state: NotAloneServerState): boolean {
  if (state.pendingCardChoice || state.pendingSurvivalChoice) return false;
  return state.phase === 'exploration_reaction'
    || state.phase === 'hunting_reaction'
    || (state.phase === 'reckoning' && state.pendingPlayerId === null && state.pendingCardChoice === null)
    || state.phase === 'end_of_turn';
}

export function toNotAlonePublicState(state: NotAloneServerState, viewerId: string): NotAlonePublicState {
  const reveal = state.phase === 'reckoning' || state.phase === 'end_of_turn' || state.phase === 'game_over';
  const showTokens = !['hunted_planning', 'exploration_reaction'].includes(state.phase) || state.huntTokens.target.length > 0;
  return {
    gameId: 'not_alone', viewerPlayerId: viewerId, roomCode: state.roomCode, rulesVersion: state.rulesVersion,
    contentSet: NOT_ALONE_CONTENT_SET, modeDescription: NOT_ALONE_MODE_DESCRIPTION, revision: state.revision,
    status: state.status, phase: state.phase, roundNumber: state.roundNumber, boardFace: state.boardFace,
    pendingCardChoice: state.pendingCardChoice ? {
      kind: state.pendingCardChoice.kind,
      playerId: state.pendingCardChoice.playerId,
      count: state.pendingCardChoice.count,
      submittedCount: state.pendingCardChoice.kind === 'forbidden_zone' ? state.pendingCardChoice.sealedChoices?.size ?? 0 : 0,
      eligibleCount: state.pendingCardChoice.kind === 'forbidden_zone' ? state.pendingCardChoice.eligiblePlayerIds?.length ?? 0 : 1,
    } : null,
    creaturePlayerId: state.creaturePlayerId, huntedOrder: [...state.huntedOrder], pendingPlayerId: state.pendingPlayerId,
    pendingPlaceId: state.phase === 'reckoning' && state.pendingPlayerId
      ? state.players.get(state.pendingPlayerId)!.selectedPlaces[state.pendingPlaceIndex] ?? null : null,
    pendingPlaceIndex: state.pendingPlaceIndex,
    pendingEncounterStage: state.resolutionQueue[state.pendingCursor]?.stage ?? null,
    rescueProgress: state.rescueProgress, rescueGoal: state.rescueGoal,
    assimilationProgress: state.assimilationProgress, assimilationGoal: state.assimilationGoal,
    artemiaAvailable: state.artemiaAvailable, beachCharged: state.beachCharged,
    huntTokens: showTokens ? {
      creature: [...state.huntTokens.creature], target: [...state.huntTokens.target], artemia: [...state.huntTokens.artemia],
    } : { creature: [], target: [], artemia: [] },
    activeHuntCards: [...state.activeHuntCards], effectiveHuntCardIds: effectiveHuntCards(state), copiedHuntCard: state.copiedHuntCard,
    anticipationTargetPlayerId: state.effects.anticipationTarget,
    selectionBlockedPlaces: [...state.selectionBlockedPlaces], disabledPlaces: [...state.disabledPlaces], reserve: { ...state.reserve },
    players: [...state.players.values()].map((player) => {
      const playerId = player.playerId;
      const hideDiscard = state.effects.smokescreen && viewerId === state.creaturePlayerId && player.role === 'hunted';
      return {
        playerId, displayName: player.displayName, role: player.role,
        will: player.role === 'hunted' ? player.will : null,
        handCount: player.role === 'hunted'
          ? player.placeHand.length - player.playedPlaces.filter((place) => !player.returnPlayed.has(place)).length
          : state.huntHand.length,
        discard: hideDiscard ? [] : [...player.discard], discardCount: player.discard.length,
        survivalCount: player.survivalHand.length, forfeited: player.forfeited,
        isReady: player.role === 'creature' ? state.phase !== 'hunted_planning' : player.selectedPlaces.length > 0,
        reactionPassed: state.reactionPasses.has(playerId),
        revealedPlaces: reveal && player.role === 'hunted' ? [...player.selectedPlaces] : [],
        originalRevealedPlaces: reveal && player.role === 'hunted' ? [...player.playedPlaces] : [],
      };
    }), winner: state.winner, endReason: state.endReason, log: state.log.map((entry) => ({ ...entry })),
  };
}

export function toNotAlonePrivateState(state: NotAloneServerState, playerId: string): NotAlonePrivateState {
  const player = state.players.get(playerId); if (!player) throw new Error('Player missing from NOT ALONE state');
  const actionsUnlocked = !player.forfeited && !state.pendingCardChoice && !state.pendingSurvivalChoice;
  const ownsCardChoice = state.pendingCardChoice?.kind === 'forbidden_zone'
    ? (state.pendingCardChoice.eligiblePlayerIds?.includes(playerId) ?? false)
      && !(state.pendingCardChoice.sealedChoices?.has(playerId) ?? false)
    : state.pendingCardChoice?.playerId === playerId;
  const mode = player.role === 'hunted' ? (player.artefactNext ? 'artefact' : player.riverNext ? 'river' : 'single') : 'single';
  const playableHuntCardIds = player.role === 'creature' ? playableNotAloneHuntCards(state) : [];
  const targetPlayerIds = player.role === 'creature'
    ? state.huntedOrder.filter((id) => !state.players.get(id)!.forfeited)
    : [];
  const discardDownTargetPlayerIds = targetPlayerIds.filter((id) => {
    const target = state.players.get(id)!;
    return target.placeHand.filter((place) => !target.playedPlaces.includes(place) || target.returnPlayed.has(place)).length > 2;
  });
  const detourOptions = player.role === 'creature' && playableHuntCardIds.some((cardId) => {
    const effective = cardId === 'flashback' ? state.huntDiscard.at(-1) : cardId;
    return effective === 'detour';
  })
    ? targetPlayerIds.flatMap((targetPlayerId) => state.players.get(targetPlayerId)!.selectedPlaces.flatMap((originPlaceId, placeIndex) => {
      const destinationPlaceIds = legalNotAloneDetourDestinations(state, targetPlayerId, placeIndex);
      return destinationPlaceIds.length > 0 ? [{
        playerId: targetPlayerId,
        placeIndex: placeIndex as 0 | 1,
        originPlaceId,
        destinationPlaceIds,
      }] : [];
    }))
    : [];
  const targetCount = requiredTokenCount(state, 'target'); const artemiaCount = requiredTokenCount(state, 'artemia');
  const canReveal = actionsUnlocked && player.role === 'creature' && state.phase === 'hunting_reaction' && state.huntPlanLocked
    && state.huntTokens.creature.length === 1
    && (targetCount === null || state.huntTokens.target.length === targetCount)
    && (artemiaCount === null || state.huntTokens.artemia.length === artemiaCount)
    && everyLiveHuntedPassed(state);
  const canPass = player.role === 'hunted' && !player.forfeited && reactionWindowOpen(state)
    && !state.reactionPasses.has(playerId) && playableNotAloneSurvivalCards(state, playerId).length > 0;
  return {
    gameId: 'not_alone', roomCode: state.roomCode, revision: state.revision, playerId, role: player.role,
    placeHand: [...player.placeHand], survivalHand: [...player.survivalHand], selectedPlaces: [...player.selectedPlaces], playedPlaces: [...player.playedPlaces],
    huntHand: player.role === 'creature' ? [...state.huntHand] : [],
    lastDiscardedHuntCard: player.role === 'creature' ? state.huntDiscard.at(-1) ?? null : null,
    survivalChoiceCards: state.pendingSurvivalChoice?.playerId === playerId ? [...state.pendingSurvivalChoice.cards] : [],
    canChooseSurvivalCard: !player.forfeited && state.pendingSurvivalChoice?.playerId === playerId,
    cardChoice: !player.forfeited && state.pendingCardChoice && ownsCardChoice ? {
      kind: state.pendingCardChoice.kind, count: state.pendingCardChoice.count,
      placeOptions: state.pendingCardChoice.kind === 'artefact_order'
        ? [...player.selectedPlaces]
        : player.placeHand.filter((id) => !player.playedPlaces.includes(id) || player.returnPlayed.has(id)),
      placeIndexes: state.pendingCardChoice.kind === 'artefact_order' ? player.selectedPlaces.map((_, index) => index) : [],
    } : null,
    cardChoiceSubmitted: state.pendingCardChoice?.kind === 'forbidden_zone'
      && (state.pendingCardChoice.sealedChoices?.has(playerId) ?? false),
    revealedHuntedHands: player.role === 'creature' ? Object.fromEntries(Object.entries(state.revealedHuntedHands).map(([id, cards]) => [id, [...cards]])) : {},
    canSelect: actionsUnlocked && player.role === 'hunted' && !player.forfeited && state.phase === 'hunted_planning' && player.selectedPlaces.length === 0,
    canGiveUp: player.role === 'hunted' && !player.forfeited && state.phase === 'hunted_planning'
      && actionsUnlocked && player.selectedPlaces.length === 0
      && (!player.recoveryActionUsed
        || player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place)).length < (player.artefactNext || player.riverNext ? 2 : 1)),
    resistOptions: player.role === 'hunted' && !player.forfeited && state.phase === 'hunted_planning'
      && actionsUnlocked && player.selectedPlaces.length === 0 && !player.recoveryActionUsed
      ? ([1, 2] as const).filter((willCost) => player.will >= willCost && player.discard.length >= willCost * 2)
        .map((willCost) => ({ willCost, recoveryCount: willCost * 2 }))
      : [],
    canChooseRiver: actionsUnlocked && player.role === 'hunted' && !player.forfeited && state.phase === 'river_choice' && state.pendingPlayerId === playerId,
    canHunt: actionsUnlocked && player.role === 'creature' && state.phase === 'creature_planning',
    playableHuntCardIds, huntOptions: {
      targetPlayerIds,
      ascendancyTargetPlayerIds: discardDownTargetPlayerIds,
      phobiaTargetPlayerIds: discardDownTargetPlayerIds,
      cataclysmPlaceIds: playableHuntCardIds.some((cardId) => {
        const effective = cardId === 'flashback' ? state.huntDiscard.at(-1) : cardId;
        return effective === 'cataclysm';
      }) ? legalNotAloneCataclysmPlaces(state) : [],
      detourOptions,
    },
    playableSurvivalCardIds: playableNotAloneSurvivalCards(state, playerId), canReveal,
    canLockHunt: actionsUnlocked && player.role === 'creature' && state.phase === 'creature_planning'
      && state.huntTokens.creature.length === 1
      && (targetCount === null || state.huntTokens.target.length === targetCount)
      && (artemiaCount === null || state.huntTokens.artemia.length === artemiaCount),
    canBeginReckoning: actionsUnlocked && player.role === 'creature' && state.phase === 'reckoning' && state.pendingPlayerId === null && everyLiveHuntedPassed(state),
    canBeginHunt: actionsUnlocked && player.role === 'creature' && state.phase === 'exploration_reaction' && everyLiveHuntedPassed(state),
    canEndTurn: actionsUnlocked && player.role === 'creature' && state.phase === 'end_of_turn' && everyLiveHuntedPassed(state),
    canPass, canResolve: actionsUnlocked
      && state.phase === 'reckoning' && state.pendingPlayerId === playerId,
    resolutionOptions: player.forfeited ? null : notAloneResolutionOptions(state, playerId), survivalOptions: notAloneSurvivalOptions(state, playerId),
    requiredSelectionCount: player.role === 'hunted' && (player.artefactNext || player.riverNext) ? 2 : 1,
    selectionMode: mode, maxHuntCards: state.maxHuntCards, huntCardsPlayed: state.activeHuntCards.length,
  };
}
