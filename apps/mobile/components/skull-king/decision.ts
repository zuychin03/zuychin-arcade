import type { SkullKingCard, SkullKingPlayedCard, SkullKingPlayerPublic, SkullKingPublicState } from '@zuychin-arcade/types';

export const SKULL_LEAVE_MESSAGE = 'You will forfeit immediately, score no further points and cannot win. Your seat plays legal cards automatically only until this round ends, then is removed. If fewer than three eligible captains remain, the voyage ends immediately without a winner and the unfinished round is not scored.';

export function skullKingNoWinnerCopy(reason: SkullKingPublicState['terminationReason']) {
  return reason === 'not_enough_players'
    ? { title: 'NO WINNER', summary: 'No winner, fewer than three captains remain.', detail: 'The unfinished round was not scored. Completed-round scores remain available. No competitive result is recorded.' }
    : { title: 'NO ELIGIBLE WINNER', summary: 'The voyage ended without an eligible winner.', detail: '' };
}

export function skullKingForfeitStatus(game: Pick<SkullKingPublicState, 'status' | 'turnOrder'>, player: Pick<SkullKingPlayerPublic, 'playerId' | 'forfeited'>) {
  if (!player.forfeited) return null;
  if (game.status === 'game_over') return { label: 'FORFEITED', detail: 'Historical score only. This seat cannot win.' };
  return game.turnOrder.includes(player.playerId)
    ? { label: 'FORFEITED · FINISHING ROUND', detail: 'Legal cards play automatically for this round only. No further points or victory; removed before the next round.' }
    : { label: 'REMOVED · FORFEITED', detail: 'Removed from play. Historical score only; no further cards, points or victory.' };
}

export function skullKingRosterSummary(game: Pick<SkullKingPublicState, 'players' | 'turnOrder'>): string {
  const historical = game.players.filter((player) => !game.turnOrder.includes(player.playerId)).length;
  return historical ? `${game.turnOrder.length} this round · ${historical} historical` : `${game.turnOrder.length} captains`;
}

type VoyageContext = { status: 'playing' | 'game_over'; revision: number };

export function isSkullLeavePromptCurrent(captured: VoyageContext, current: VoyageContext | null, capturedEpoch: number, currentEpoch: number): boolean {
  return capturedEpoch === currentEpoch && current?.status === captured.status
    && current.revision >= captured.revision
    && (captured.status !== 'game_over' || current.revision === captured.revision);
}

export function skullKingPlayInstruction(trick: SkullKingPlayedCard[], hand: SkullKingCard[]): string {
  const lead = trick.find((card) => card.kind !== 'escape' && !(card.kind === 'tigress' && card.tigressMode === 'escape'));
  if (!lead) return trick.length ? 'Only Escapes have been played. Any card is legal.' : 'You lead this trick. Any card is legal.';
  if (lead.kind !== 'number') return 'A special card set no numbered lead. Any card is legal.';
  return hand.some((card) => card.kind === 'number' && card.suit === lead.suit)
    ? `Follow ${lead.suit} with a numbered card, or play a special card. Dimmed cards cannot follow suit.`
    : `You have no ${lead.suit} cards. Any card is legal.`;
}
