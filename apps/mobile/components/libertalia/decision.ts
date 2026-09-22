import { LIBERTALIA_CREW, LIBERTALIA_MIN_PLAYERS, type LibertaliaChoiceKind, type LibertaliaChoiceOption, type LibertaliaPrivateState, type LibertaliaPublicState, type RoomPublicState } from '@zuychin-arcade/types';

type RematchSeat = Pick<RoomPublicState['players'][number], 'isConnected' | 'hasLeft'>;

export function libertaliaRematchBlock(seats: RematchSeat[]): 'reconnecting' | 'not_enough_players' | null {
  if (seats.some(seat => !seat.isConnected && !seat.hasLeft)) return 'reconnecting';
  return seats.filter(seat => seat.isConnected && !seat.hasLeft).length < LIBERTALIA_MIN_PLAYERS ? 'not_enough_players' : null;
}

export function libertaliaRematchMessage(seats: RematchSeat[], isHost: boolean): string {
  const blocked = libertaliaRematchBlock(seats);
  if (blocked === 'reconnecting') return 'Waiting for an admiral to reconnect or their reconnect grace to expire before a rematch.';
  if (blocked === 'not_enough_players') return 'At least two connected seats are needed for a rematch.';
  return isHost ? 'The table is ready for a rematch.' : 'The host can start another expedition.';
}

export function libertaliaResultPlayers(game: Pick<LibertaliaPublicState, 'players' | 'winnerPlayerIds'>): LibertaliaPublicState['players'] {
  return [...game.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited)
    || Number(game.winnerPlayerIds.includes(b.playerId)) - Number(game.winnerPlayerIds.includes(a.playerId))
    || b.score - a.score || b.reputation - a.reputation);
}

type OptionGame = Pick<LibertaliaPublicState, 'players'> & Partial<Pick<LibertaliaPublicState, 'currentLoot'>>;

export function libertaliaOptionHelp(kind: LibertaliaChoiceKind | undefined, option: LibertaliaChoiceOption, game: OptionGame): string | null {
  if (option.lootId === undefined || (kind !== 'loot_current' && kind !== 'loot_ship')) return null;
  const tokens = kind === 'loot_current' ? game.currentLoot ?? [] : game.players.flatMap(player => player.loot);
  const token = tokens.find(item => item.id === option.lootId);
  return token ? `Calm-side effect: ${LIBERTALIA_LOOT_HELP[token.kind]}` : null;
}

export function libertaliaOptionLabel(option: LibertaliaChoiceOption, game: OptionGame, playerId: string | null, kind?: LibertaliaChoiceKind): string {
  const owner = option.playerId ? option.playerId === playerId ? 'You' : game.players.find(player => player.playerId === option.playerId)?.displayName : null;
  const help = libertaliaOptionHelp(kind, option, game);
  const crew = option.rank === undefined ? undefined : LIBERTALIA_CREW[option.rank - 1];
  return `${option.label}${owner ? ` · ${owner}` : ''}${option.detail ? `. ${option.detail}` : ''}${crew ? `. Timing: ${crew.phases.join(', ')}. ${crew.summary}` : ''}${help ? `. ${help}` : ''}`;
}

export function libertaliaLeaveMessage(): string {
  return 'You will forfeit immediately and cannot win. If today’s crew is already revealed, legal automatic choices finish only this day, then your seat leaves active play. During secret selection your seat leaves immediately. One remaining eligible admiral wins; if none remain, there is no winner.';
}

export function libertaliaEmptySelection(game: Pick<LibertaliaPublicState, 'status' | 'phase' | 'turnOrder'>, player: LibertaliaPublicState['players'][number] | undefined): boolean {
  return game.status === 'playing' && game.phase === 'selection' && player !== undefined
    && !player.forfeited && game.turnOrder.includes(player.playerId) && player.handCount === 0;
}

export function libertaliaDecisionKey(game: LibertaliaPublicState | null, mine: LibertaliaPrivateState | null): string | null {
  if (!game || !mine || game.status !== 'playing') return null;
  if (mine.pendingChoice) return `choice:${game.voyage}:${game.day}:${mine.pendingChoice.id}`;
  return mine.canSelect ? `crew:${game.voyage}:${game.day}` : null;
}

export function isLibertaliaLeavePromptCurrent(captured: Pick<LibertaliaPublicState, 'status' | 'revision'>, current: Pick<LibertaliaPublicState, 'status' | 'revision'> | null, epoch: number, currentEpoch: number): boolean {
  return epoch === currentEpoch && current?.status === captured.status && current.revision >= captured.revision
    && (captured.status !== 'game_over' || current.revision === captured.revision);
}

export const LIBERTALIA_LOOT_HELP = {
  map: 'Anchor: sets of 2 score 7; sets of 3 score 12. Combine sets for the best total.',
  barrel: 'Gain 1 reputation at dusk, then 1 doubloon at anchor.',
  amulet: 'Gain 3 doubloons at anchor.',
  chest: 'Gain 5 doubloons at anchor.',
  hook: 'At anchor, keep a ship character for the next voyage or gain 2 doubloons.',
  saber: 'At dusk, discard another admiral’s character still on the island.',
  relic: 'Lose 3 doubloons at anchor.',
} as const;
