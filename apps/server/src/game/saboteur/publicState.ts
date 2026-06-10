import type {
  SaboteurPrivateState,
  SaboteurPublicState,
} from '@zuychin-arcade/types';
import type { SaboteurServerState } from './engine.js';

export function toPublicState(state: SaboteurServerState): SaboteurPublicState {
  const showRoles = state.status === 'round_end' || state.status === 'game_over';
  const currentTurnPlayerId =
    state.status === 'playing' ? state.turnOrder[state.currentTurnIndex] : null;

  return {
    roomCode: state.roomCode,
    round: state.round,
    status: state.status,
    board: state.board,
    goals: state.goals.map((g) => ({
      position: g.position,
      revealed: g.revealed,
      isGold: g.revealed ? g.isGold : null,
    })),
    deckSize: state.deck.length,
    discardSize: state.discard.length,
    players: state.turnOrder.map((pid) => {
      const p = state.players.get(pid)!;
      return {
        playerId: p.playerId,
        displayName: p.displayName,
        handSize: p.hand.length,
        brokenTools: p.brokenTools,
        isCurrentTurn: pid === currentTurnPlayerId,
        goldCollected: p.goldCollected,
      };
    }),
    currentTurnPlayerId,
    revealedGoalPositions: state.goals.filter((g) => g.revealed).map((g) => g.position),
    roundWinner: state.roundWinner,
    goldDistribution: state.goldDistribution
      ? {
          order: state.goldDistribution.order,
          currentPickerId:
            state.goldDistribution.currentIndex < state.goldDistribution.order.length
              ? state.goldDistribution.order[state.goldDistribution.currentIndex]
              : null,
          availableCards: state.goldDistribution.availableCards,
          steps: state.goldDistribution.order.map((pid) => ({
            playerId: pid,
            chosenCard: state.goldDistribution!.assignments.get(pid) ?? null,
          })),
        }
      : null,
    revealedRoles: showRoles
      ? state.turnOrder.map((pid) => {
          const p = state.players.get(pid)!;
          return { playerId: p.playerId, displayName: p.displayName, role: p.role };
        })
      : null,
    winnerIds: state.winnerIds,
  };
}

export function toPrivateState(state: SaboteurServerState, playerId: string): SaboteurPrivateState | null {
  const p = state.players.get(playerId);
  if (!p) return null;
  return {
    playerId: p.playerId,
    role: p.role,
    hand: p.hand,
    peekedGoals: p.peekedGoals,
  };
}
