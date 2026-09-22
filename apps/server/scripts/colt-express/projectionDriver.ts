import type { ColtPrivateState, ColtPublicState } from '@zuychin-arcade/types';

export function chooseProjectionCommand(game: ColtPublicState, mine: ColtPrivateState) {
  if (game.status !== 'playing' || mine.revision !== game.revision) return null;
  const expectedRevision = game.revision;
  const command = (action: string, payload: Record<string, unknown>): { action: string; event: string; payload: Record<string, unknown> & { expectedRevision: number } } => ({ action, event: `colt:${action}`, payload: { ...payload, expectedRevision } });
  if (mine.canChooseCharacter) return command('choose-character', { character: game.availableCharacters[game.revision % game.availableCharacters.length]! });
  if (mine.canChooseTeam) return command('choose-team', { teamIndex: game.revision % game.availableTeams.length });
  if (mine.canAssignStart) return command('assign-start', { cabooseBandit: game.revision % 2 });
  if (mine.canReserve) return command('reserve', { cardId: mine.reserveOptions.find((card) => card.action !== 'bullet')!.id });
  if (mine.canChoose && game.pending?.playerId === mine.playerId) {
    return command('choose', { optionId: game.pending.options[game.revision % game.pending.options.length]!.id });
  }
  if (mine.canProgram) {
    const cards = mine.hand.filter((card) => card.action !== 'bullet');
    const card = cards[game.revision % Math.max(1, cards.length)];
    return command('program', card ? { cardId: card.id } : { draw: true });
  }
  return null;
}
