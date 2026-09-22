import type { KingOfTokyoPublicState } from '@zuychin-arcade/types';
import { kingOfTokyoCapacity } from '@zuychin-arcade/types';
import { availableOncePerTurnPowerCardInstanceIds, rapidHealingOptions, type KingOfTokyoServerState } from './engine.js';

export function toKingOfTokyoPublicState(state: KingOfTokyoServerState, viewerPlayerId?: string): KingOfTokyoPublicState {
  const players = state.turnOrder.map((id) => {
    const player = state.players.get(id)!;
    const { defenseMode: _defenseMode, rapidHealingMode: _rapidHealingMode, tokenPreference: _tokenPreference, ...publicPlayer } = player;
    return {
      ...publicPlayer,
      powerCards: player.powerCards.map((card) => ({ ...card })),
    };
  });
  const livingCount = players.filter((player) => !player.eliminated).length;
  const labCard = state.labOffersRemaining > 0 && viewerPlayerId === state.turnOrder[state.currentTurnIndex] && state.deck[0]
    ? { ...state.deck[0] }
    : null;
  const pendingMimicTargetCardInstanceId = [...state.usedThisTurn]
    .find((key) => key.startsWith('mimic_initial:'))?.slice('mimic_initial:'.length) ?? null;
  const pendingMimicTargetPlayerId = pendingMimicTargetCardInstanceId
    ? players.find((player) => player.powerCards.some((card) => card.instanceId === pendingMimicTargetCardInstanceId))?.playerId ?? null
    : null;
  const pendingDamageTarget = state.pendingDamageWorkflow?.targets[state.pendingDamageWorkflow.targetIndex];

  return {
    gameId: 'king_of_tokyo',
    roomCode: state.roomCode,
    viewerPlayerId: viewerPlayerId && state.players.has(viewerPlayerId) ? viewerPlayerId : null,
    revision: state.revision,
    rulesVersion: state.rulesVersion,
    status: state.status,
    phase: state.phase,
    players,
    viewerPreferences: viewerPlayerId && state.players.has(viewerPlayerId)
      ? {
          defenseMode: state.players.get(viewerPlayerId)!.defenseMode,
          rapidHealingMode: state.players.get(viewerPlayerId)!.rapidHealingMode,
          tokenPreference: state.players.get(viewerPlayerId)!.tokenPreference,
        }
      : null,
    viewerAvailableOncePerTurnCardInstanceIds: viewerPlayerId
      ? availableOncePerTurnPowerCardInstanceIds(state, viewerPlayerId)
      : [],
    turnOrder: [...state.turnOrder],
    currentPlayerId:
      state.status === 'playing' && state.phase !== 'determining_first_player'
        ? state.turnOrder[state.currentTurnIndex]
        : null,
    rollCount: state.rollCount,
    maxRolls: state.maxRolls,
    dice: state.dice.map((die) => ({ ...die })),
    tokyoCapacity: kingOfTokyoCapacity(livingCount),
    rollOffRound: state.rollOffRound,
    pendingTokyoDecisionPlayerId: state.pendingTokyoDecisions[0] ?? null,
    hasDeferredSmashDamage: Boolean(state.pendingTokyoDecisions[0] && state.pendingTokyoDamage.has(state.pendingTokyoDecisions[0])),
    pendingHeartAllocation: state.pendingHeartAllocation ? {
      playerId: state.pendingHeartAllocation.playerId,
      heartIndexes: [...state.pendingHeartAllocation.heartIndexes],
      healingRayAvailable: state.pendingHeartAllocation.healingRayAvailable,
      healingRayTargetPlayerIds: state.pendingHeartAllocation.healingRayAvailable
        ? state.turnOrder.filter((playerId) => {
            const player = state.players.get(playerId)!;
            return playerId !== state.pendingHeartAllocation!.playerId &&
              !player.eliminated && player.health < player.maxHealth;
          })
        : [],
    } : null,
    pendingDefenseDecision: state.pendingDefenseDecision ? {
      ...state.pendingDefenseDecision,
      ...(state.pendingDefenseDecision.kind === 'rapid_healing'
        ? rapidHealingOptions(state, state.pendingDefenseDecision.playerId)
        : { healingPerActivation: 1 }),
      dice: [...state.pendingDefenseDecision.dice],
      stretchyAvailable: state.pendingDefenseDecision.kind === 'camouflage' &&
        pendingDamageTarget?.playerId === state.pendingDefenseDecision.playerId &&
        pendingDamageTarget.entitlements.stretchy > 0,
    } : null,
    pendingFreezeTimePlayerId: state.pendingFreezeTimeDecisions[0]?.playerId ?? null,
    pendingFreezeTimeDicePenalty: state.pendingFreezeTimeDecisions[0]?.dicePenalty ?? null,
    pendingFreezeTimeChoicesRemaining: state.pendingFreezeTimeDecisions.length,
    pendingDeathFromAbovePlayerId: state.pendingDeathFromAbove?.playerId ?? null,
    pendingDeathFromAboveTargetPlayerIds: [...(state.pendingDeathFromAbove?.targetPlayerIds ?? [])],
    pendingPsychicProbePlayerId: state.pendingPsychicProbes[0]?.playerId ?? null,
    pendingPsychicProbeCardInstanceId: state.pendingPsychicProbes[0]?.cardInstanceId ?? null,
    pendingOpportunistPlayerId: state.pendingOpportunist?.playerIds[0] ?? null,
    pendingOpportunistCardInstanceId: state.pendingOpportunist?.cardInstanceId ?? null,
    pendingMimicTargetPlayerId,
    pendingMimicTargetCardInstanceId,
    pendingEndTurnEffects: viewerPlayerId === state.turnOrder[state.currentTurnIndex]
      ? state.pendingEndTurnEffects.map((effect) => ({ ...effect }))
      : [],
    market: state.market.map((card) => card ? { ...card } : null),
    deckCount: state.deck.length,
    discardCount: state.discardPile.length,
    labCard,
    startRolls: Object.fromEntries(state.startRolls),
    startingRollContenders: [...state.startingRollContenders],
    winnerId: state.winnerId,
    victoryType: state.victoryType,
    terminationReason: state.terminationReason,
    log: state.log.map((entry) => ({ ...entry })),
  };
}
