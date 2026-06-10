// Saboteur game constants.
//
// Values verified on 2026-06-11 against:
//   https://ultraboardgames.com/saboteur/game-rules.php
//   https://en.wikipedia.org/wiki/Saboteur_(card_game)
//   https://en.doc.boardgamearena.com/Gamehelpsaboteur
//   https://zatu.com/how-to-play-saboteur/ (redirect of board-game.co.uk/how-to-play-saboteur)
//
// Note: role cards dealt = playerCount + 1 (one card is set aside unseen each
// round), so the actual number of saboteurs in play can be one fewer than the
// table value — including zero saboteurs in small games.

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

// Board layout. Physical game: goal cards sit 8 card-lengths from the start
// card, with the outer two goals one card-width away from the centre goal.
// We orient the mine vertically: start at top centre, goals 8 rows below.
export const BOARD = {
  cols: 9,
  rows: 13,         // allow tunnels to overflow past the goal row
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
