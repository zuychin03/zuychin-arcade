// Coup (+ Reformation) constants and rules data.
//
// Verified 2026-06-21 against:
//   https://www.ultraboardgames.com/coup/game-rules.php
//   https://ultraboardgames.com/coup/reformation.php
//   https://coup.thebrown.net/rules.html  (faithful online implementation)
// See COUP_PLAN.md §2 for the full rules reference.

import type { CoupActionType, CoupCharacter, CoupVariant } from './coup';

export const STARTING_INFLUENCE = 2;

export const COUP_COST = 7;
export const ASSASSINATE_COST = 3;
export const TAX_GAIN = 3;
export const FOREIGN_AID_GAIN = 2;
export const INCOME_GAIN = 1;
export const STEAL_MAX = 2;
export const CONVERT_SELF_COST = 1; // reformation
export const CONVERT_OTHER_COST = 2; // reformation

// At >= 10 coins at the start of your turn, your only legal action is Coup.
export const MANDATORY_COUP_AT = 10;

// Auto-pass timeout for challenge/block response windows (COUP_PLAN.md §3).
export const RESPONSE_TIMEOUT_MS = 30_000;

// Per-variant player limits.
export const COUP_LIMITS: Record<CoupVariant, { min: number; max: number }> = {
  base: { min: 2, max: 6 },
  reformation: { min: 2, max: 10 },
};

/** Starting coins: 2, except the first player in a 2-player base game gets 1. */
export function startingCoins(playerCount: number, isFirstPlayer: boolean): number {
  return playerCount === 2 && isFirstPlayer ? 1 : 2;
}

/** Court-deck copies of each character, scaled by player count (Reformation). */
export function copiesPerCharacter(playerCount: number): number {
  if (playerCount <= 6) return 3;
  if (playerCount <= 8) return 4;
  return 5;
}

/** The 5 characters in play for a variant (Inquisitor replaces Ambassador). */
export function charactersForVariant(variant: CoupVariant): CoupCharacter[] {
  const shared: CoupCharacter[] = ['duke', 'assassin', 'captain', 'contessa'];
  return variant === 'reformation'
    ? [...shared, 'inquisitor']
    : [...shared, 'ambassador'];
}

// ---------------------------------------------------------------------------
// Action metadata. `cost` is the up-front coin cost (Convert is computed
// dynamically per self/other). `claim` is the character the actor asserts
// (challengeable). `blockableBy` lists every character that could block —
// the engine filters by the variant's character set. Embezzle is a *reverse*
// challenge (actor claims NOT to hold a Duke) and is handled specially.
// ---------------------------------------------------------------------------
export interface CoupActionMeta {
  cost: number;
  needsTarget: boolean;
  claim: CoupCharacter | null;
  challengeable: boolean;
  blockableBy: CoupCharacter[];
  reformationOnly: boolean;
  reverseChallenge?: CoupCharacter; // embezzle: challenger asserts the actor HAS this
}

export const ACTION_META: Record<CoupActionType, CoupActionMeta> = {
  income: { cost: 0, needsTarget: false, claim: null, challengeable: false, blockableBy: [], reformationOnly: false },
  foreign_aid: { cost: 0, needsTarget: false, claim: null, challengeable: false, blockableBy: ['duke'], reformationOnly: false },
  coup: { cost: COUP_COST, needsTarget: true, claim: null, challengeable: false, blockableBy: [], reformationOnly: false },
  tax: { cost: 0, needsTarget: false, claim: 'duke', challengeable: true, blockableBy: [], reformationOnly: false },
  assassinate: { cost: ASSASSINATE_COST, needsTarget: true, claim: 'assassin', challengeable: true, blockableBy: ['contessa'], reformationOnly: false },
  steal: { cost: 0, needsTarget: true, claim: 'captain', challengeable: true, blockableBy: ['captain', 'ambassador', 'inquisitor'], reformationOnly: false },
  exchange: { cost: 0, needsTarget: false, claim: 'ambassador', challengeable: true, blockableBy: [], reformationOnly: false },
  convert: { cost: 0, needsTarget: false, claim: null, challengeable: false, blockableBy: [], reformationOnly: true },
  embezzle: { cost: 0, needsTarget: false, claim: null, challengeable: true, blockableBy: [], reformationOnly: true, reverseChallenge: 'duke' },
  inquisitor_exchange: { cost: 0, needsTarget: false, claim: 'inquisitor', challengeable: true, blockableBy: [], reformationOnly: true },
  inquisitor_examine: { cost: 0, needsTarget: true, claim: 'inquisitor', challengeable: true, blockableBy: [], reformationOnly: true },
};

/** Actions that may only target a player of the *other* allegiance (Reformation). */
export const ALLEGIANCE_RESTRICTED: CoupActionType[] = ['coup', 'assassinate', 'steal'];
