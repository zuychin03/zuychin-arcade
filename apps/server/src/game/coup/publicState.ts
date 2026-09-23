// Projections from the authoritative Coup state to what clients may see.
// This is the only place engine state is serialized for clients: a player's
// own face-down characters go solely to that player via toPrivateState; the
// public state exposes counts, revealed cards, coins, and the pending window.

import type {
  CoupCharacter,
  CoupPrivateState,
  CoupPublicPlayer,
  CoupPublicState,
} from '@zuychin-arcade/types';
import type { CoupServerState } from './engine.js';
import { canTargetCoupPlayer } from '@zuychin-arcade/types';

function aliveCount(chars: { revealed: boolean }[]): number {
  return chars.filter((i) => !i.revealed).length;
}

// Mirror of the engine's eligibility logic, for the public `waitingOn` list.
function waitingOn(state: CoupServerState): string[] {
  const p = state.pending;
  const alive = state.turnOrder.filter((id) => aliveCount(state.players.get(id)!.influences) > 0);
  const notPassed = (ids: string[]) => ids.filter((id) => !p.passed.has(id));
  switch (p.phase) {
    case 'awaiting_allegiance':
      return [p.actorId];
    case 'awaiting_examine_selection':
      return p.examineTargetId ? [p.examineTargetId] : [];
    case 'awaiting_action':
      return p.actorId ? [p.actorId] : [];
    case 'awaiting_action_challenge':
      return notPassed(alive.filter((id) => id !== p.actorId));
    case 'awaiting_block':
      if (p.action === 'foreign_aid') return notPassed(alive.filter((id) =>
        canTargetCoupPlayer(state.variant, [...state.players.values()], p.actorId, id)));
      if ((p.action === 'assassinate' || p.action === 'steal') && p.targetId) {
        return notPassed([p.targetId].filter((id) => alive.includes(id)));
      }
      return [];
    case 'awaiting_block_challenge':
      return notPassed(alive.filter((id) => id !== p.blockerId));
    case 'awaiting_challenge_decision': {
      const claimantId = p.challengeKind === 'block' ? p.blockerId : p.actorId;
      return claimantId && alive.includes(claimantId) ? [claimantId] : [];
    }
    case 'awaiting_lose_influence':
      return p.losingPlayerId ? [p.losingPlayerId] : [];
    case 'awaiting_exchange':
    case 'awaiting_examine':
      return [p.actorId];
    default:
      return [];
  }
}

export function toPublicState(state: CoupServerState): CoupPublicState {
  const currentTurnPlayerId =
    state.status === 'playing' ? state.turnOrder[state.currentTurnIndex] : null;

  const players: CoupPublicPlayer[] = state.turnOrder.map((id) => {
    const p = state.players.get(id)!;
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      coins: p.coins,
      allegiance: p.allegiance,
      influenceCount: aliveCount(p.influences),
      revealedCharacters: p.influences.filter((i) => i.revealed).map((i) => i.character),
      eliminated: p.eliminated,
      forfeited: p.forfeited,
      isCurrentTurn: id === currentTurnPlayerId,
    };
  });

  return {
    gameId: 'coup',
    roomCode: state.roomCode,
    revision: state.revision,
    variant: state.variant,
    status: state.status,
    players,
    currentTurnPlayerId,
    treasuryReserve: state.treasuryReserve,
    deckSize: state.deck.length,
    pending: {
      phase: state.pending.phase,
      actorId: state.pending.actorId || null,
      action: state.pending.action,
      targetId: state.pending.targetId,
      claimedCharacter: state.pending.claimedCharacter,
      blockerId: state.pending.blockerId,
      blockCharacter: state.pending.blockCharacter,
      challengerId: state.pending.challengerId,
      waitingOn: waitingOn(state),
      responded: [...state.pending.passed],
      deadline: state.pending.deadline,
      losingPlayerId: state.pending.losingPlayerId,
      loseReason: state.pending.loseReason,
    },
    log: state.log.map((entry) => ({ ...entry })),
    winnerId: state.winnerId,
    terminationReason: state.terminationReason,
  };
}

export function toPrivateState(state: CoupServerState, playerId: string): CoupPrivateState | null {
  const p = state.players.get(playerId);
  if (!p) return null;
  const pend = state.pending;
  const exchange =
    pend.phase === 'awaiting_exchange' && pend.actorId === playerId && pend.exchangePool
      ? { pool: [...pend.exchangePool] as CoupCharacter[], keepCount: pend.exchangeKeep }
      : null;
  return {
    gameId: 'coup',
    roomCode: state.roomCode,
    revision: state.revision,
    playerId: p.playerId,
    influences: p.influences.map((influence) => ({ ...influence })),
    exchange,
    examine: pend.phase === 'awaiting_examine' && pend.actorId === playerId && pend.examineCharacter && pend.examineTargetId
      ? { targetId: pend.examineTargetId, targetName: state.players.get(pend.examineTargetId)!.displayName, character: pend.examineCharacter }
      : null,
  };
}
