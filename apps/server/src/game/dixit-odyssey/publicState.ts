import type { DixitPrivateState, DixitPublicState } from '@zuychin-arcade/types';
import { dixitSubmissionCount, type DixitServerState } from './engine.js';

export function toDixitPublicState(state: DixitServerState): DixitPublicState {
  const tableVisible = state.phase === 'vote' || state.phase === 'reveal' || state.phase === 'game_over';
  return {
    gameId: 'dixit_odyssey', roomCode: state.roomCode, rulesVersion: state.rulesVersion,
    revision: state.revision, status: state.status, phase: state.phase,
    terminationReason: state.terminationReason, roundNumber: state.roundNumber,
    storytellerId: state.storytellerId, clue: state.clue,
    players: state.turnOrder.map(id => {
      const player = state.players.get(id)!;
      return {
        playerId: id, displayName: player.displayName, score: player.score,
        handCount: player.hand.length, forfeited: player.forfeited,
        submitted: state.submissions.has(id), voted: state.votes.has(id), ready: state.ready.has(id),
      };
    }),
    table: tableVisible ? state.table.map((cardId, index) => ({ slot: index + 1, cardId })) : [],
    result: state.result ? structuredClone(state.result) : null,
    winnerIds: [...state.winnerIds], drawCount: state.drawPile.length,
    discardCount: state.discardPile.length, log: state.log.map(entry => ({ ...entry })),
  };
}

export function toDixitPrivateState(state: DixitServerState, playerId: string): DixitPrivateState {
  const player = state.players.get(playerId);
  const authorised = player && !player.forfeited;
  return {
    gameId: 'dixit_odyssey', roomCode: state.roomCode, revision: state.revision, playerId,
    hand: authorised ? [...player.hand] : [],
    submittedCardIds: authorised ? [...(state.submissions.get(playerId) ?? [])] : [],
    votes: authorised && state.votes.has(playerId) ? [...state.votes.get(playerId)!] : null,
    submissionCount: authorised ? dixitSubmissionCount(state, playerId) : 0,
  };
}
