import type {
  NotAloneBoardFace,
  NotAloneCardDefinition, NotAloneHuntCardId, NotAlonePlaceDefinition,
  NotAlonePlaceId, NotAloneSurvivalCardId,
} from './not-alone';

export function notAloneArtemiaAvailable(face: NotAloneBoardFace, rescueProgress: number, rescueGoal: number): boolean {
  if (rescueProgress >= rescueGoal) return false;
  if (face === 'continuous') return rescueProgress >= rescueGoal - 6;
  const firstAlternatingSpace = rescueGoal - 11;
  return rescueProgress >= firstAlternatingSpace && (rescueProgress - firstAlternatingSpace) % 2 === 0;
}

export const NOT_ALONE_MIN_PLAYERS = 2;
export const NOT_ALONE_MAX_PLAYERS = 7;
export const NOT_ALONE_RULES_VERSION = 'original-base-2016-digital-v2';
export const NOT_ALONE_CONTENT_SET = 'original-base-2016' as const;
export const NOT_ALONE_MODE_DESCRIPTION = 'Original 2016 base game for 2-7 players: 10 Places, 15 Survival cards and 20 Hunt cards. The host is the Creature and chooses the printed board face. Base three-Will recovery is used; the expert variant, Remastered edition, Exploration, Sanctuary and promotional content are excluded. Digital adjudication uses explicit priority passes before each Phase 3 event, locks the complete Hunt plan before phase-2 Survival reactions, resolves physical Artefact slots in chosen order within each shared category, and preserves the printed safe, Target, Artemia, Creature order. Forbidden Zone choices are sealed until every affected Hunted commits. Despair resets locked destinations for private reselection; Shelter and an otherwise unusable Source recover a Place instead of drawing. Leaving or reconnect-grace expiry forfeits eligibility immediately. Legal automatic play finishes only the current round for a departed Hunted, then removes that seat from active play. Original track goals and Place supply stay fixed; retired Place holdings leave play and Survival cards return to the discard. Creature departure or loss of the last eligible Hunted ends the game immediately for the remaining team; simultaneous departure of every eligible seat ends without a winner.';

export const NOT_ALONE_PLACES: readonly NotAlonePlaceDefinition[] = [
  { id: 1, name: 'The Lair', accent: '#B98CFF', summary: 'Recover your discarded places or copy the place beneath the Creature. Being caught here costs one extra Will.' },
  { id: 2, name: 'The Jungle', accent: '#E58BFF', summary: 'Return the Jungle and one discarded Place card to your hand.' },
  { id: 3, name: 'The River', accent: '#F8C75A', summary: 'Prepare two Place cards next round, then choose the real destination after the Hunt tokens are placed.' },
  { id: 4, name: 'The Beach', accent: '#FF9B64', summary: 'Charge the beacon, or launch it later to advance Rescue.' },
  { id: 5, name: 'The Rover', accent: '#79E6D0', summary: 'Explore one advanced place from the shared reserve.' },
  { id: 6, name: 'The Swamp', accent: '#D9A66C', summary: 'Return the Swamp and two discarded Place cards to your hand.' },
  { id: 7, name: 'The Shelter', accent: '#57D6A4', summary: 'Draw two Survival cards and keep one.' },
  { id: 8, name: 'The Wreck', accent: '#64D8FF', summary: 'Advance the Rescue mission once this round.' },
  { id: 9, name: 'The Source', accent: '#5CE0C4', summary: 'Restore one Will to a Hunted player, or draw a Survival card.' },
  { id: 10, name: 'The Artefact', accent: '#8EA6FF', summary: 'Play and resolve two Place cards next round.' },
] as const;

export const NOT_ALONE_PLACE_BY_ID = Object.fromEntries(NOT_ALONE_PLACES.map((place) => [place.id, place])) as Record<NotAlonePlaceId, NotAlonePlaceDefinition>;

export const NOT_ALONE_SURVIVAL_CARDS: readonly NotAloneCardDefinition<NotAloneSurvivalCardId>[] = [
  { id: 'adrenaline', name: 'Adrenaline', phase: 1, summary: 'Regain one Will.' },
  { id: 'amplifier', name: 'Amplifier', phase: 4, summary: 'Spend the charged Beach beacon to advance Rescue.' },
  { id: 'detector', name: 'Detector', phase: 3, summary: 'Ignore the Artemia token this turn.' },
  { id: 'dodge', name: 'Dodge', phase: 3, summary: 'Ignore the Creature token this turn.' },
  { id: 'double_back', name: 'Double Back', phase: 4, summary: 'Return the Place card you just explored to your hand.' },
  { id: 'drone', name: 'Drone', phase: 3, summary: 'Use the Rover power instead of your current place.' },
  { id: 'gate', name: 'Gate', phase: 3, summary: 'Use the power of a place adjacent to your current place.' },
  { id: 'hologram', name: 'Hologram', phase: 3, summary: 'Move the Artemia token to an adjacent place.' },
  { id: 'ingenuity', name: 'Ingenuity', phase: 1, summary: 'Charge the Beach beacon.' },
  { id: 'sacrifice', name: 'Sacrifice', phase: 1, summary: 'Discard a Place card; the Creature cannot play a Hunt card this round.' },
  { id: 'sixth_sense', name: 'Sixth Sense', phase: 1, summary: 'Recover two Place cards from your discard pile.' },
  { id: 'smokescreen', name: 'Smokescreen', phase: 1, summary: 'Hide every Hunted discard pile from the Creature this round.' },
  { id: 'strike_back', name: 'Strike Back', phase: 1, summary: 'Return two random cards from the Creature hand to the bottom of its deck.' },
  { id: 'vortex', name: 'Vortex', phase: 2, summary: 'Exchange your selected Place card with one from your discard pile.' },
  { id: 'wrong_track', name: 'Wrong Track', phase: 3, summary: 'Move the Creature token, or the Target token while Clone is active, to an adjacent place.' },
] as const;

export const NOT_ALONE_HUNT_CARDS: readonly NotAloneCardDefinition<NotAloneHuntCardId>[] = [
  { id: 'anticipation', name: 'Anticipation', phase: 2, summary: 'If the chosen Hunted is caught, gain one extra Assimilation.' },
  { id: 'ascendancy', name: 'Ascendancy', phase: 2, summary: 'A chosen Hunted discards down to two Place cards.' },
  { id: 'cataclysm', name: 'Cataclysm', phase: 3, summary: 'Disable one place power this round.' },
  { id: 'clone', name: 'Clone', phase: 2, token: 'target', summary: 'The Target token acts as a second Creature token.' },
  { id: 'despair', name: 'Despair', phase: 1, token: 'artemia', summary: 'No Survival cards may be played or drawn this round.' },
  { id: 'detour', name: 'Detour', phase: 3, summary: 'Move a chosen Hunted to an adjacent place after reveal.' },
  { id: 'fierceness', name: 'Fierceness', phase: 2, summary: 'The Creature token removes one additional Will.' },
  { id: 'flashback', name: 'Flashback', phase: 0, summary: 'Repeat the last discarded Hunt card.' },
  { id: 'forbidden_zone', name: 'Forbidden Zone', phase: 2, summary: 'Every Hunted discards one Place card.' },
  { id: 'force_field', name: 'Force Field', phase: 1, token: 'target', placeCount: 2, summary: 'Two adjacent places cannot be selected this round.' },
  { id: 'interference', name: 'Interference', phase: 2, summary: 'Disable the Beach and Wreck powers.' },
  { id: 'mirage', name: 'Mirage', phase: 2, token: 'target', placeCount: 2, summary: 'Disable two adjacent place powers.' },
  { id: 'mutation', name: 'Mutation', phase: 2, token: 'artemia', summary: 'Artemia also removes one Will.' },
  { id: 'persecution', name: 'Persecution', phase: 2, summary: 'Place powers return at most one Place card total, including a played card.' },
  { id: 'phobia', name: 'Phobia', phase: 2, token: 'artemia', summary: 'Reveal all but two cards in a chosen Hunted hand to the Creature.' },
  { id: 'scream', name: 'Scream', phase: 2, token: 'target', summary: 'Hunted at the Target discard two Place cards or lose one Will.' },
  { id: 'stasis', name: 'Stasis', phase: 4, summary: 'The automatic Rescue advance is prevented this round.' },
  { id: 'toxin', name: 'Toxin', phase: 2, token: 'target', summary: 'Hunted at the Target discard a Survival card and cannot use that place.' },
  { id: 'tracking', name: 'Tracking', phase: 4, summary: 'The Creature may play two Hunt cards next round.' },
  { id: 'virus', name: 'Virus', phase: 2, token: 'artemia', placeCount: 2, summary: 'Apply the Artemia token to two adjacent places.' },
] as const;

export const NOT_ALONE_SURVIVAL_BY_ID = Object.fromEntries(NOT_ALONE_SURVIVAL_CARDS.map((card) => [card.id, card])) as Record<NotAloneSurvivalCardId, NotAloneCardDefinition<NotAloneSurvivalCardId>>;
export const NOT_ALONE_HUNT_BY_ID = Object.fromEntries(NOT_ALONE_HUNT_CARDS.map((card) => [card.id, card])) as Record<NotAloneHuntCardId, NotAloneCardDefinition<NotAloneHuntCardId>>;

export function notAloneTrackGoals(totalPlayers: number): { rescue: number; assimilation: number } {
  return { rescue: 11 + totalPlayers, assimilation: 5 + totalPlayers };
}

export function notAloneAdvancedCopies(huntedPlayers: number): number {
  return huntedPlayers === 1 ? 1 : huntedPlayers <= 3 ? 2 : 3;
}

export function notAloneAdjacent(a: NotAlonePlaceId, b: NotAlonePlaceId): boolean {
  const ax = (a - 1) % 5; const ay = Math.floor((a - 1) / 5);
  const bx = (b - 1) % 5; const by = Math.floor((b - 1) / 5);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}
