import type { CitadelsPrivateState, CitadelsPublicState } from '@zuychin-arcade/types';
import {
  CITADELS_DISTRICT_PRESET,
  CITADELS_MODE_DESCRIPTION,
} from '@zuychin-arcade/types';
import { citadelsBuildCost, type CitadelsServerState } from './engine.js';

export function toCitadelsPublicState(state: CitadelsServerState): CitadelsPublicState {
  return {
    gameId: 'citadels', roomCode: state.roomCode, rulesVersion: state.rulesVersion,
    districtPreset: CITADELS_DISTRICT_PRESET, modeDescription: CITADELS_MODE_DESCRIPTION,
    revision: state.revision,
    status: state.status, terminationReason: state.terminationReason, phase: state.phase, roundNumber: state.roundNumber,
    crownPlayerId: state.crownPlayerId, draftPlayerId: state.draftPlayerId,
    activePlayerId: state.activePlayerId, activeRole: state.activeRole,
    faceUpDiscard: [...state.faceUpDiscard], calledRoles: [...state.calledRoles],
    killedRole: state.killedRole, robbedRole: state.robbedRole,
    firstCompletedPlayerId: state.firstCompletedPlayerId,
    turnOrder: [...state.turnOrder],
    players: [...state.players.values()].map((player) => {
      const playerId = player.playerId;
      return {
        playerId, displayName: player.displayName, gold: player.gold, handCount: player.hand.length,
        city: player.city.map((card) => ({ ...card })), revealedRole: player.revealedRole,
        isCrowned: state.crownPlayerId === playerId && !player.forfeited,
        hasCompletedCity: player.city.length >= 7, score: player.score,
        forfeited: player.forfeited,
      };
    }),
    winnerIds: [...state.winnerIds],
    scoreBreakdowns: Object.fromEntries(Object.entries(state.scoreBreakdowns).map(([id, score]) => [id, { ...score }])),
    log: state.log.map((entry) => ({ ...entry })),
  };
}

export function toCitadelsPrivateState(state: CitadelsServerState, playerId: string): CitadelsPrivateState {
  const player = state.players.get(playerId);
  if (!player) throw new Error('Cannot project Citadels state for a missing player');
  const canAct = !player.forfeited && state.phase === 'action' && state.activePlayerId === playerId;
  const canUseAbilities = (
    !player.forfeited && (state.phase === 'choose_income' || state.phase === 'action')
    && state.activePlayerId === playerId
  );
  const buildLimit = player.role === 'architect' ? 3 : 1;
  const effectiveBuildCosts = Object.fromEntries(
    player.hand.map((card) => [card.id, citadelsBuildCost(player, card)]),
  );
  const legalBuildCardIds = canAct && player.builtThisTurn < buildLimit
    ? player.hand.filter((card) => (
      effectiveBuildCosts[card.id]! <= player.gold
      && !player.city.some((built) => built.name === card.name)
    )).map((card) => card.id)
    : [];
  return {
    gameId: 'citadels', roomCode: state.roomCode, revision: state.revision, playerId,
    hand: player.hand.map((card) => ({ ...card })), chosenRole: player.role,
    availableRoles: !player.forfeited && state.phase === 'drafting' && state.draftPlayerId === playerId ? [...state.availableRoles] : [],
    drawnCards: !player.forfeited && state.phase === 'choose_cards' && state.activePlayerId === playerId
      ? state.pendingDraw.map((card) => ({ ...card })) : [],
    canAct, canUseAbilities,
    canBuild: legalBuildCardIds.length > 0,
    buildLimit, builtThisTurn: player.builtThisTurn, taxUsed: player.taxUsed,
    specialUsed: player.specialUsed,
    usableDistrictIds: canUseAbilities ? player.city.filter((card) => (
      (card.effect === 'laboratory' && player.hand.length > 0) || (card.effect === 'smithy' && player.gold >= 2)
    ) && !player.usedDistrictIds.has(card.id)).map((card) => card.id) : [],
    legalBuildCardIds,
    effectiveBuildCosts,
  };
}
