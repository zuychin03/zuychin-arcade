import type { KingOfTokyoDieFace } from './king-of-tokyo';

export const KING_OF_TOKYO_RULES_VERSION = 'base-publisher-2023-11-digital-v2';
export const KING_OF_TOKYO_MIN_PLAYERS = 2;
export const KING_OF_TOKYO_MAX_PLAYERS = 6;
export const KING_OF_TOKYO_STARTING_HEALTH = 10;
export const KING_OF_TOKYO_MAX_HEALTH = 10;
export const KING_OF_TOKYO_VICTORY_POINTS = 20;
export const KING_OF_TOKYO_DICE_COUNT = 6;
export const KING_OF_TOKYO_MAX_ROLLS = 3;
export const KING_OF_TOKYO_BAY_MIN_PLAYERS = 5;

export const KING_OF_TOKYO_DIE_FACES: readonly KingOfTokyoDieFace[] = [
  1,
  2,
  3,
  'energy',
  'smash',
  'heart',
];

export function kingOfTokyoCapacity(playerCount: number): 1 | 2 {
  return playerCount >= KING_OF_TOKYO_BAY_MIN_PLAYERS ? 2 : 1;
}
