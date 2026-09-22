import type { NotAloneHuntCardId, NotAlonePublicState, NotAloneSurvivalCardId } from '@zuychin-arcade/types';

export function notAloneHuntNeedsOptions(cardId: NotAloneHuntCardId, lastDiscarded: NotAloneHuntCardId | null): boolean {
  const effect = cardId === 'flashback' ? lastDiscarded : cardId;
  return effect !== null && ['anticipation', 'ascendancy', 'phobia', 'detour', 'cataclysm', 'force_field'].includes(effect);
}

export function notAloneSurvivalNeedsOptions(cardId: NotAloneSurvivalCardId): boolean {
  return ['sacrifice', 'sixth_sense', 'vortex', 'double_back', 'gate', 'hologram', 'wrong_track'].includes(cardId);
}

type ExpeditionContext = { status: 'playing' | 'game_over'; revision: number };

export function notAloneLeaveMessage(game: Pick<NotAlonePublicState, 'status' | 'players'>, playerId: string | null): string {
  if (game.status === 'game_over') return 'This closes your seat and returns to the arcade.';
  const player = game.players.find((seat) => seat.playerId === playerId);
  if (!player) return 'Leaving closes your session. Any active seat you own will forfeit and cannot win.';
  if (player.forfeited) return 'You have already forfeited. This closes your seat and returns to the arcade.';
  if (player.role === 'creature') return 'You will forfeit immediately. The expedition ends and the remaining Hunted win.';
  const otherHunted = game.players.some((seat) => seat.role === 'hunted' && !seat.forfeited && seat.playerId !== playerId);
  if (!otherHunted) return 'You are the last Hunted still eligible to win. Leaving ends the expedition with a Creature victory.';
  return 'You will forfeit immediately and cannot win. Legal automatic play finishes only the current round, then your seat is removed. Rescue and Assimilation targets stay unchanged. If no Hunted remain eligible, the Creature wins.';
}

type ForfeitContext = Pick<NotAlonePublicState, 'status' | 'huntedOrder'>;
type ForfeitSeat = Pick<NotAlonePublicState['players'][number], 'playerId' | 'role' | 'forfeited'>;

export function notAloneForfeitLabel(game: ForfeitContext, player: ForfeitSeat): string {
  if (!player.forfeited) return '';
  if (game.status === 'game_over' || player.role === 'creature') return 'FORFEITED';
  return game.huntedOrder.includes(player.playerId) ? 'FORFEITED · FINISHING THIS ROUND' : 'FORFEITED · REMOVED FROM PLAY';
}

export function notAloneForfeitMessage(game: ForfeitContext, player: ForfeitSeat): string {
  if (!player.forfeited) return '';
  if (game.status === 'game_over' || player.role === 'creature') return 'You forfeited and were not eligible to win.';
  return game.huntedOrder.includes(player.playerId)
    ? 'You forfeited and cannot win. Automatic play finishes this round only; your seat is removed before the next round.'
    : 'You forfeited and are no longer in active play. Your seat is retained only in expedition history.';
}

export function isNotAloneLeavePromptCurrent(captured: ExpeditionContext, current: ExpeditionContext | null, capturedEpoch: number, currentEpoch: number): boolean {
  return capturedEpoch === currentEpoch && current?.status === captured.status
    && current.revision >= captured.revision
    && (captured.status !== 'game_over' || current.revision === captured.revision);
}
