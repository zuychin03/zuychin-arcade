import type {
  CartographersAmbushCard, CartographersCard, CartographersExploreCard, CartographersHeroCard,
  CartographersMapSide, CartographersObjective, CartographersPoint, CartographersShape, CartographersTerrain,
} from './cartographers-heroes';

export const CARTOGRAPHERS_HEROES_MIN_PLAYERS = 1;
export const CARTOGRAPHERS_HEROES_MAX_PLAYERS = 100;
export const CARTOGRAPHERS_HEROES_RULES_VERSION = 'heroes-2021-standalone-v1';
export const CARTOGRAPHERS_MAP_SIZE = 11;
export const CARTOGRAPHERS_COIN_CAP = 14;
export const CARTOGRAPHERS_SEASONS = [
  { name: 'Spring', threshold: 8, edicts: [0, 1] },
  { name: 'Summer', threshold: 7, edicts: [1, 2] },
  { name: 'Autumn', threshold: 7, edicts: [2, 3] },
  { name: 'Winter', threshold: 6, edicts: [3, 0] },
] as const;

function shape(rows: string, coin = false): CartographersShape {
  return { cells: rows.split('/').flatMap((row, y) => [...row].flatMap((cell, x) => cell === 'X' ? [{ x, y }] : [])), coin };
}
function explore(id: string, name: string, time: number, terrains: CartographersTerrain[], rows: string[], coin = false): CartographersExploreCard {
  return { id, name, kind: 'explore', time, terrains, options: rows.map((row, i) => shape(row, coin && i === 0)) };
}
export const CARTOGRAPHERS_EXPLORE_CARDS: readonly CartographersExploreCard[] = [
  explore('lagoon', 'Lagoon', 1, ['water'], ['.X/X.', 'XXX/.X.'], true),
  explore('pasture', 'Pasture', 1, ['farm'], ['X.X', '.XX/XX.'], true),
  explore('settlement', 'Settlement', 1, ['village'], ['X/X', '..X/.XX/XX.'], true),
  explore('timber_grove', 'Timber Grove', 1, ['forest'], ['X./XX', 'X.X/X.X'], true),
  explore('hillside_terrace', 'Hillside Terrace', 2, ['farm', 'water'], ['XX/XX']),
  explore('frontier_dwelling', 'Frontier Dwelling', 2, ['village', 'farm'], ['XXX/.X./.X.']),
  explore('wildwood_garden', 'Wildwood Garden', 2, ['forest', 'farm'], ['.XX/X..']),
  explore('woodland_crossroads', 'Woodland Crossroads', 2, ['forest', 'village'], ['.X./XXX/.X.']),
  explore('coastal_encampment', 'Coastal Encampment', 2, ['village', 'water'], ['XXX/X..']),
  explore('mangrove_swamp', 'Mangrove Swamp', 2, ['forest', 'water'], ['XXX/XXX']),
  explore('kethras_gates', "Kethra's Gates", 0, ['forest', 'village', 'farm', 'water', 'monster'], ['X']),
];
const points = (pairs: number[][]): CartographersPoint[] => pairs.map(([x, y]) => ({ x: x!, y: y! }));
export const CARTOGRAPHERS_HERO_CARDS: readonly CartographersHeroCard[] = [
  { id: 'dobrik', name: 'Dobrik of Lorkheim', kind: 'hero', time: 0, attack: points([[-1, 0], [1, 0], [0, -1], [0, 1]]) },
  { id: 'wren', name: 'Wren the Lioness', kind: 'hero', time: 0, attack: points([[2, -1], [2, 0], [2, 1]]) },
  { id: 'freyla', name: 'Freyla the True', kind: 'hero', time: 0, attack: points([[1, 0], [2, 0], [3, 0]]) },
  { id: 'dal', name: 'Dal of Jolev', kind: 'hero', time: 0, attack: points([[-1, -1], [1, -1], [-1, 1], [1, 1]]) },
];
export const CARTOGRAPHERS_AMBUSH_CARDS: readonly CartographersAmbushCard[] = [
  { id: 'dragon', name: 'Dragon Inferno', kind: 'ambush', time: 0, monster: 'dragon', cells: shape('..X/XXX/X..').cells, direction: 'counterclockwise', soloCorner: 'bottom_left' },
  { id: 'zombie', name: 'Zombie Plague', kind: 'ambush', time: 0, monster: 'zombie', cells: shape('X').cells, direction: 'counterclockwise', soloCorner: 'top_left' },
  { id: 'troll', name: 'Giant Troll Ravage', kind: 'ambush', time: 0, monster: 'troll', cells: shape('XXX/.X.').cells, direction: 'clockwise', soloCorner: 'top_right' },
  { id: 'gorgon', name: 'Gorgon Gaze', kind: 'ambush', time: 0, monster: 'gorgon', cells: shape('X.X/.X.').cells, direction: 'clockwise', soloCorner: 'bottom_right' },
];
export const CARTOGRAPHERS_CARDS: readonly CartographersCard[] = [...CARTOGRAPHERS_EXPLORE_CARDS, ...CARTOGRAPHERS_HERO_CARDS, ...CARTOGRAPHERS_AMBUSH_CARDS];
export const CARTOGRAPHERS_CARD_BY_ID: Readonly<Record<string, CartographersCard>> = Object.fromEntries(CARTOGRAPHERS_CARDS.map(card => [card.id, card]));
const objective = (id: string, name: string, category: CartographersObjective['category'], soloModifier: number): CartographersObjective => ({ id, name, category, soloModifier });
export const CARTOGRAPHERS_OBJECTIVES: readonly CartographersObjective[] = [
  objective('faunlost_thicket', 'Faunlost Thicket', 'forest', 16), objective('deepwood', 'Deepwood', 'forest', 18),
  objective('heart_of_the_forest', 'Heart of the Forest', 'forest', 22), objective('sleepy_valley', 'Sleepy Valley', 'forest', 24),
  objective('craylund', 'Craylund', 'farm_water', 12), objective('ulems_wallow', "Ulem's Wallow", 'farm_water', 14),
  objective('clawsgrave_peaks', 'Clawsgrave Peaks', 'farm_water', 15), objective('jorekburg', 'Jorekburg', 'farm_water', 18),
  objective('traylo_monastery', 'Traylo Monastery', 'village', 14), objective('outer_enclave', 'Outer Enclave', 'village', 12),
  objective('gnomish_colony', 'Gnomish Colony', 'village', 12), objective('caravansary', 'Caravansary', 'village', 16),
  objective('dwarvenholds', 'Dwarvenholds', 'general', 28), objective('silos', 'Silos', 'general', 30),
  objective('banded_hills', 'Banded Hills', 'general', 28), objective('starlit_sigil', 'Starlit Sigil', 'general', 30),
];
export const CARTOGRAPHERS_OBJECTIVE_BY_ID: Readonly<Record<string, CartographersObjective>> = Object.fromEntries(CARTOGRAPHERS_OBJECTIVES.map(card => [card.id, card]));
export const CARTOGRAPHERS_MAPS: Record<CartographersMapSide, { mountains: readonly CartographersPoint[]; wasteland: readonly CartographersPoint[]; ruins: readonly CartographersPoint[] }> = {
  C: { mountains: points([[1, 1], [8, 3], [3, 5], [9, 8], [5, 9]]), wasteland: [], ruins: points([[4, 1], [7, 3], [6, 6], [2, 7], [8, 9], [0, 10]]) },
  D: { mountains: points([[9, 1], [3, 3], [6, 5], [2, 8], [9, 8]]), wasteland: points([[1, 1], [1, 2], [9, 5], [10, 5], [9, 6], [0, 9], [1, 9]]), ruins: points([[3, 1], [8, 1], [1, 5], [7, 6], [10, 6], [5, 9]]) },
};
export const CARTOGRAPHERS_SOLO_TITLES = [
  [30, 'Legendary Cartographer'], [20, 'Master Mapsmith'], [10, 'Journeyman Topographer'], [0, 'Apprentice Surveyor'],
  [-5, 'Amateur Assessor'], [-10, 'Inept Assistant'], [-20, 'Dimwitted Doodler'], [-30, 'Oblivious Inkdrinker'],
] as const;
