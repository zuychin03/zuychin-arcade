// Rules: https://blog.amigo-spiele.de/content/ap/rule/04900-GB-AmigoRule.pdf
// Digital rules add the board cap, guaranteed opposition and immediate forfeits.
export const SABOTEUR_RULESET_VERSION = 'base-v4-2025-digital-20260920';

// Deal players + 1 roles, set one aside, and repeat only opposition-free deals.

export const ROLE_TABLE: Record<number, { miners: number; saboteurs: number }> = {
  3:  { miners: 3, saboteurs: 1 },
  4:  { miners: 4, saboteurs: 1 },
  5:  { miners: 4, saboteurs: 2 },
  6:  { miners: 5, saboteurs: 2 },
  7:  { miners: 5, saboteurs: 3 },
  8:  { miners: 6, saboteurs: 3 },
  9:  { miners: 7, saboteurs: 3 },
  10: { miners: 7, saboteurs: 4 },
};

export const HAND_SIZE_TABLE: Record<string, number> = {
  '3-5':  6,
  '6-7':  5,
  '8-10': 4,
};

export function getHandSize(playerCount: number): number {
  if (playerCount <= 5) return 6;
  if (playerCount <= 7) return 5;
  return 4;
}

// 27 action cards total: 9 sabotage + 9 repair + 6 map + 3 rockfall
export const ACTION_CARD_COUNTS = {
  sabotage: { lantern: 3, cart: 3, pickaxe: 3 },
  repair: {
    lantern_only: 2,
    cart_only: 2,
    pickaxe_only: 2,
    lantern_cart: 1,
    lantern_pickaxe: 1,
    cart_pickaxe: 1,
  },
  map: 6,
  rockfall: 3,
};

// 28 gold nugget cards total
export const GOLD_NUGGET_CARDS = {
  threeNugget: 4,
  twoNugget: 8,
  oneNugget: 16,
};

// Nuggets awarded per saboteur when saboteurs win a round, by saboteur count
export const SABOTEUR_REWARDS: Record<number, number> = {
  1: 4,
  2: 3,
  3: 3,
  4: 2,
};

// The legal board is deliberately capped for mobile observability. BOARD keeps
// the larger viewport dimensions used to frame that playable area.
export const SABOTEUR_PLAYABLE_BOUNDS = Object.freeze({
  minRow: 0,
  maxRow: 8,
  minCol: 2,
  maxCol: 6,
});

// Physical goal spacing, rotated vertically: start at top centre, goals 8 rows
// below. The viewport may include non-playable framing outside these bounds.
export const BOARD = {
  cols: 9,
  rows: 13,
  playableBounds: SABOTEUR_PLAYABLE_BOUNDS,
  startPos: { row: 0, col: 4 },
  goalPositions: [
    { row: 8, col: 2 },
    { row: 8, col: 4 },
    { row: 8, col: 6 },
  ],
};

export const ROUNDS_PER_GAME = 3;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
