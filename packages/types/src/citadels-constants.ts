import type { CitadelsDistrictCard, CitadelsDistrictColor, CitadelsRole, CitadelsRoleInfo } from './citadels';

export const CITADELS_MIN_PLAYERS = 4;
export const CITADELS_MAX_PLAYERS = 7;
export const CITADELS_CITY_SIZE = 7;
export const CITADELS_RULES_VERSION = 'revised-2016-custom-4-7-digital-v2';
export const CITADELS_DISTRICT_PRESET = 'curated-custom-14-v1';
export const CITADELS_MODE_DESCRIPTION = 'Z-Man 2016 revised rules · original rank 1–8 cast · curated custom set of 14 official unique districts · 4–7 players · random opening crown · automatic King crown, Merchant bonus, passive district effects and scoring; other optional abilities are player-controlled · leaving or expired reconnect grace forfeits immediately; legal autopilot finishes only the current round, then the seat is removed; fewer than four eligible builders ends immediately without a winner · 2–3 dual-role, 8-player rank-9, alternate characters and other unique districts excluded.';

export const CITADELS_ROLES: readonly CitadelsRoleInfo[] = [
  { role: 'assassin', rank: 1, name: 'Assassin', summary: 'Name another role. If chosen, that character silently loses the turn.' },
  { role: 'thief', rank: 2, name: 'Thief', summary: 'Name a legal role and take all of its gold when that character is called.' },
  { role: 'magician', rank: 3, name: 'Magician', summary: 'Swap your hand with a rival, or discard any number to draw replacements.' },
  { role: 'king', rank: 4, name: 'King', summary: 'Take the crown and collect one gold per noble district.' },
  { role: 'bishop', rank: 5, name: 'Bishop', summary: 'Collect one gold per religious district; the Warlord cannot attack you.' },
  { role: 'merchant', rank: 6, name: 'Merchant', summary: 'Gain one extra gold, plus one gold per trade district.' },
  { role: 'architect', rank: 7, name: 'Architect', summary: 'Draw two extra districts and build up to three this turn.' },
  { role: 'warlord', rank: 8, name: 'Warlord', summary: 'Collect from military districts and pay cost minus one to destroy a district.' },
] as const;

export const CITADELS_ROLE_ORDER = CITADELS_ROLES.map((role) => role.role) as CitadelsRole[];
export const CITADELS_ROLE_BY_ID = Object.fromEntries(CITADELS_ROLES.map((role) => [role.role, role])) as Record<CitadelsRole, CitadelsRoleInfo>;

type DistrictTemplate = Omit<CitadelsDistrictCard, 'id'> & { count: number };
const standard = (templateId: string, name: string, color: CitadelsDistrictColor, cost: number, count: number): DistrictTemplate => ({ templateId, name, color, cost, count });
const unique = (templateId: string, name: string, cost: number, effect: CitadelsDistrictCard['effect'], effectText: string, count = 1): DistrictTemplate => ({ templateId, name, color: 'unique', cost, count, effect, effectText });

export const CITADELS_DISTRICT_MANIFEST: readonly DistrictTemplate[] = [
  standard('manor', 'Manor', 'noble', 3, 5), standard('castle', 'Castle', 'noble', 4, 4), standard('palace', 'Palace', 'noble', 5, 3),
  standard('temple', 'Temple', 'religious', 1, 3), standard('church', 'Church', 'religious', 2, 3), standard('monastery', 'Monastery', 'religious', 3, 3), standard('cathedral', 'Cathedral', 'religious', 5, 2),
  standard('tavern', 'Tavern', 'trade', 1, 5), standard('market', 'Market', 'trade', 2, 4), standard('trading_post', 'Trading Post', 'trade', 2, 3), standard('docks', 'Docks', 'trade', 3, 3), standard('harbor', 'Harbor', 'trade', 4, 3), standard('town_hall', 'Town Hall', 'trade', 5, 2),
  standard('watchtower', 'Watchtower', 'military', 1, 3), standard('prison', 'Prison', 'military', 2, 3), standard('barracks', 'Barracks', 'military', 3, 3), standard('fortress', 'Fortress', 'military', 5, 2),
  unique('haunted_quarter', 'Haunted Quarter', 2, 'haunted_city', 'May count as one missing district type for the diversity bonus.'),
  unique('keep', 'Keep', 3, 'keep', 'The Warlord cannot destroy the Keep.'),
  unique('imperial_treasury', 'Imperial Treasury', 5, 'imperial_treasury', 'Score one extra point for every gold you hold.'),
  unique('map_room', 'Map Room', 5, 'map_room', 'Score one extra point for every district card in your hand.'),
  unique('laboratory', 'Laboratory', 5, 'laboratory', 'Once per turn, discard one district card to gain two gold.'),
  unique('observatory', 'Observatory', 4, 'observatory', 'When drawing income cards, draw three and keep one.'),
  unique('smithy', 'Smithy', 5, 'smithy', 'Once per turn, pay two gold to draw three district cards.'),
  unique('library', 'Library', 6, 'library', 'Keep every district card drawn during card income.'),
  unique('school_of_magic', 'School of Magic', 6, 'school_of_magic', 'Counts as the active character’s income colour when collecting taxes.'),
  unique('dragon_gate', 'Dragon Gate', 6, 'dragon_gate', 'Worth eight points at game end.'),
  unique('great_wall', 'Great Wall', 6, 'great_wall', 'The Warlord pays one additional gold to destroy your other districts.'),
  unique('factory', 'Factory', 5, 'factory', 'Pay one fewer gold to build each other unique district.'),
  unique('gold_mine', 'Gold Mine', 6, 'gold_mine', 'Gain one extra gold when choosing gold during resource gathering.'),
  unique('wishing_well', 'Wishing Well', 5, 'wishing_well', 'Score one extra point for every unique district in your city, including the Wishing Well.'),
] as const;

export function citadelsFaceUpDiscardCount(players: number): number {
  return players === 4 ? 2 : players === 5 ? 1 : 0;
}

export const CITADELS_COLOR_LABELS: Record<CitadelsDistrictColor, string> = {
  noble: 'Noble', religious: 'Religious', trade: 'Trade', military: 'Military', unique: 'Unique',
};
