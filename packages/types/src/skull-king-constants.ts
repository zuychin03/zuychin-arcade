export const SKULL_KING_MIN_PLAYERS = 3;
export const SKULL_KING_MAX_PLAYERS = 8;
export const SKULL_KING_ROUNDS = 10;
export const SKULL_KING_DECK_SIZE = 70;
export const SKULL_KING_RULES_VERSION = 'classic-core-3-8-v2';
export const SKULL_KING_MODE_DESCRIPTION = 'Digital Base Voyage · 3–8 players · No Graybeard, advanced cards or pirate powers. Departed seats forfeit immediately, finish only the current round automatically, then leave the rotation. Below three eligible captains ends without a winner.';

export const SKULL_KING_SUITS = ['green', 'purple', 'yellow', 'black'] as const;

export function skullKingCardsPerPlayer(roundNumber: number, playerCount: number): number {
  const normalRound = Math.min(Math.max(1, roundNumber), SKULL_KING_ROUNDS);
  return Math.min(normalRound, Math.floor(SKULL_KING_DECK_SIZE / playerCount));
}
