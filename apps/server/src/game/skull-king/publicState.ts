import type { SkullKingPrivateState, SkullKingPublicState } from '@zuychin-arcade/types';
import { SKULL_KING_MODE_DESCRIPTION } from '@zuychin-arcade/types';
import type { SkullKingServerState } from './engine.js';
import { legalCardIds } from './resolver.js';

export function toSkullKingPublicState(state: SkullKingServerState): SkullKingPublicState {
  const bidsRevealed = state.phase !== 'bidding' && (state.terminationReason === null
    || state.turnOrder.every((id) => state.players.get(id)!.bid !== null));
  return {
    gameId: 'skull_king', roomCode: state.roomCode, revision: state.revision,
    rulesVersion: state.rulesVersion, modeDescription: SKULL_KING_MODE_DESCRIPTION,
    status: state.status, phase: state.phase, terminationReason: state.terminationReason,
    roundNumber: state.roundNumber, cardsPerPlayer: state.cardsPerPlayer,
    trickNumber: state.trickNumber, dealerId: state.turnOrder[state.dealerIndex]!,
    leaderId: state.leaderId, currentPlayerId: state.currentPlayerId, bidsRevealed,
    players: [...state.players.values()].map((player) => {
      return {
        playerId: player.playerId, displayName: player.displayName, cardCount: player.hand.length,
        bid: bidsRevealed ? player.bid : null,
        bidSubmitted: bidsRevealed ? player.bid !== null : !player.forfeited && player.bid !== null,
        tricksWon: player.tricksWon, roundScore: player.roundScore,
        totalScore: player.totalScore, exactLastRound: player.exactLastRound,
        forfeited: player.forfeited,
      };
    }),
    turnOrder: [...state.turnOrder], currentTrick: state.currentTrick.map((card) => ({ ...card })),
    lastTrick: state.lastTrick ? { ...state.lastTrick, cards: state.lastTrick.cards.map((card) => ({ ...card })) } : null,
    scoreHistory: state.scoreHistory.map((round) => ({ ...round, players: round.players.map((player) => ({ ...player })) })),
    winnerIds: [...state.winnerIds], log: state.log.map((entry) => ({ ...entry })),
  };
}

export function toSkullKingPrivateState(state: SkullKingServerState, playerId: string): SkullKingPrivateState {
  const player = state.players.get(playerId);
  if (!player) throw new Error('Cannot project private state for missing player');
  return {
    gameId: 'skull_king', roomCode: state.roomCode, revision: state.revision, playerId,
    hand: player.hand.map((card) => ({ ...card })),
    legalCardIds: state.phase === 'trick_play' && state.currentPlayerId === playerId
      ? legalCardIds(player.hand, state.currentTrick) : [],
    submittedBid: player.bid,
  };
}
