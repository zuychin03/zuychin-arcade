import {
  CARTOGRAPHERS_SEASONS, type CartographersHeroesPrivateState, type CartographersHeroesPublicState,
  type CartographersMapView,
} from '@zuychin-arcade/types';
import type { CartographersHeroesServerState } from './engine.js';

function mapView(map: CartographersMapView): CartographersMapView {
  return { ...map, cells: map.cells.map(cell => ({ ...cell })), attackCells: [...map.attackCells], mountainCoins: [...map.mountainCoins] };
}
export function toCartographersHeroesPublicState(state: CartographersHeroesServerState): CartographersHeroesPublicState {
  return {
    gameId: 'cartographers_heroes', roomCode: state.roomCode, revision: state.revision, rulesVersion: state.rulesVersion,
    status: state.status, phase: state.phase, mapSide: state.mapSide, solo: state.solo, season: state.season,
    elapsed: state.elapsed, threshold: CARTOGRAPHERS_SEASONS[state.season]!.threshold, turnId: state.turnId,
    turnRevision: state.turnRevision, currentCardId: state.currentCardId, currentEffect: state.currentEffect,
    objectiveIds: [...state.objectiveIds], revealedCardIds: [...state.revealedCardIds], deckCount: state.deck.length,
    players: [...state.players.values()].map(player => ({
      playerId: player.playerId, displayName: player.displayName, forfeited: player.forfeited,
      submitted: !state.tasks.some(task => task.actorId === player.playerId && !task.submitted),
      coins: player.map.coins, totalScore: player.totalScore,
      scores: player.scores.map(score => ({ ...score, objectives: [...score.objectives] })),
    })),
    winnerIds: [...state.winnerIds], endReason: state.endReason, soloRating: state.soloRating, soloTitle: state.soloTitle,
  };
}
export function toCartographersHeroesPrivateState(state: CartographersHeroesServerState, playerId: string, inspectPlayerId?: string): CartographersHeroesPrivateState {
  const player = state.players.get(playerId);
  if (!player) throw new Error('Missing Cartographers viewer');
  return {
    gameId: 'cartographers_heroes', roomCode: state.roomCode, revision: state.revision, playerId, map: mapView(player.map),
    assignments: player.forfeited ? [] : state.tasks.filter(task => task.actorId === playerId && !task.submitted).map(task => ({
      targetPlayerId: task.targetPlayerId, displayName: state.players.get(task.targetPlayerId)!.displayName,
      submissionToken: task.token, map: mapView(state.players.get(task.targetPlayerId)!.map), fallback: task.fallback,
      fixedPlacement: task.fixedPlacement ? { ...task.fixedPlacement, anchor: { ...task.fixedPlacement.anchor } } : null,
    })),
    resultMaps: state.status === 'game_over' && inspectPlayerId && state.players.has(inspectPlayerId)
      ? [{ playerId: inspectPlayerId, displayName: state.players.get(inspectPlayerId)!.displayName, map: mapView(state.players.get(inspectPlayerId)!.map) }] : [],
  };
}
