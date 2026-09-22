import type { CitadelsPrivateState, CitadelsPublicState } from '@zuychin-arcade/types';

type CourtContext = { status: 'playing' | 'game_over'; revision: number };

export function citadelsForfeitLabel(game: Pick<CitadelsPublicState, 'status' | 'turnOrder'>, playerId: string): string {
  if (game.status === 'game_over') return 'FORFEITED · INELIGIBLE';
  return game.turnOrder.includes(playerId) ? 'FORFEITED · FINISHING THIS ROUND' : 'FORFEITED · REMOVED FROM PLAY';
}

export function citadelsNoWinnerMessage(reason: CitadelsPublicState['terminationReason']): string {
  return reason === 'not_enough_players'
    ? 'Fewer than four eligible builders remain. The court ended immediately without final scoring or a competitive result.'
    : 'The court ended without an eligible winner.';
}

export function isOwnCitadelsCharacterKilled(
  game: Pick<CitadelsPublicState, 'status' | 'phase' | 'roomCode' | 'revision' | 'killedRole'> | null,
  mine: Pick<CitadelsPrivateState, 'roomCode' | 'revision' | 'playerId' | 'chosenRole'> | null,
  playerId: string | null,
): boolean {
  return Boolean(game && mine && playerId && mine.playerId === playerId
    && game.roomCode === mine.roomCode && game.revision === mine.revision
    && game.status === 'playing' && game.phase !== 'drafting'
    && mine.chosenRole && mine.chosenRole === game.killedRole);
}

export function citadelsSkippedTurnMessage(roleName: string, finalRound: boolean): string {
  return `Your ${roleName} was killed by the Assassin. You cannot act this round. ${finalRound
    ? 'Your city still counts in final scoring after the remaining characters finish.'
    : 'Choose a new character next round.'}`;
}

export function isCitadelsLeavePromptCurrent(captured: CourtContext, current: CourtContext | null, capturedEpoch: number, currentEpoch: number): boolean {
  return capturedEpoch === currentEpoch && current?.status === captured.status
    && current.revision >= captured.revision
    && (captured.status !== 'game_over' || current.revision === captured.revision);
}
