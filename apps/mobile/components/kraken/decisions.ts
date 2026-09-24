import type { FeedTheKrakenCharacter, FeedTheKrakenPublicState } from '@zuychin-arcade/types';

export function targetSlots(character: FeedTheKrakenCharacter): string[] {
  if (character === 'spiritualist') return ['First donor', 'Second donor', 'Recipient'];
  if (character === 'herbalist') return ['Remove off-duty sign from', 'Give off-duty sign to'];
  if (character === 'minstrel' || character === 'agitator') return ['First crew member', 'Second crew member'];
  return ['kleptomaniac', 'troublemaker', 'peacemaker', 'smuggler', 'adviser', 'archivist', 'mentor', 'debt_collector', 'instigator'].includes(character) ? ['Crew member'] : [];
}
export function characterTargets(game: FeedTheKrakenPublicState, character: FeedTheKrakenCharacter, actor: string, slot: number, selected: string[]) {
  const alive = game.players.filter(p => p.aboard && !p.forfeited);
  const rested = alive.filter(p => p.playerId !== game.captainId && !p.offDuty);
  return alive.filter(p => {
    if (slot === 1 && p.playerId === selected[0]) return false;
    if (character === 'herbalist' && slot === 0) return p.offDuty;
    if (character === 'mentor') return p.playerId !== actor && p.characterRevealed;
    if (character === 'instigator') return p.playerId !== game.captainId;
    if (character === 'smuggler' || character === 'archivist') return [game.captainId, game.lieutenantId].includes(p.playerId);
    if (character === 'debt_collector') return [game.captainId, game.lieutenantId, game.navigatorId].includes(p.playerId);
    if (character === 'adviser') return p.playerId !== game.captainId && (rested.length < 2 || !p.offDuty);
    return true;
  });
}
export const phaseNames = {
  priority: 'Character window', appointment: 'Appoint the navigation team', mutiny: 'Seal your mutiny bid', tie_veto: 'Break the captaincy tie',
  navigation: 'Send one navigation card', navigator: 'Choose the ship’s course', emergency: 'Appoint an emergency navigator',
  map_action: 'Resolve the landing', effect_target: 'Choose a recipient', telescope: 'Inspect the horizon', ritual: 'A ritual is resolving', instigator: 'Answer the instigator', game_over: 'The voyage has ended',
} as const;
