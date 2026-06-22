// Single source of truth for Coup's player-facing reference card: the emoji,
// accent color, and the rules blurb for every character and general action.
// Consumed by CharacterCard (faces) and ReferenceSheet (the in-game rulebook).
import type { CoupCharacter } from '@zuychin-arcade/types';
import { COUP, COUP_CHARACTER_COLOR } from './theme';

export const CHARACTER_EMOJI: Record<CoupCharacter, string> = {
  duke: '👑',
  assassin: '🗡️',
  captain: '⚓',
  ambassador: '🤝',
  contessa: '🌹',
  inquisitor: '🔍',
};

export interface CharacterRef {
  name: string;
  action: string; // what its action does ('—' when it has none)
  blocks: string; // what it can block ('—' when it blocks nothing)
}

/** Per-character rulebook rows, keyed to the engine's CoupCharacter union. */
export const CHARACTER_REF: Record<CoupCharacter, CharacterRef> = {
  duke: { name: 'Duke', action: 'Tax — take 3 coins', blocks: 'Foreign Aid' },
  assassin: { name: 'Assassin', action: 'Assassinate — pay 3, a player loses an influence', blocks: '—' },
  captain: { name: 'Captain', action: 'Steal — take 2 coins from a player', blocks: 'Stealing' },
  ambassador: { name: 'Ambassador', action: 'Exchange — draw 2, keep the best, return 2', blocks: 'Stealing' },
  contessa: { name: 'Contessa', action: '—', blocks: 'Assassination' },
  inquisitor: { name: 'Inquisitor', action: 'Exchange 1 with the deck · or examine a player’s card', blocks: 'Stealing' },
};

export interface ActionRef {
  emoji: string;
  name: string;
  detail: string;
  tag: string; // short risk/blocker hint
  tagColor: string;
}

/** General actions any player may take — no character to claim. */
export const GENERAL_ACTIONS: ActionRef[] = [
  { emoji: '🪙', name: 'Income', detail: 'Take 1 coin.', tag: 'safe', tagColor: COUP.green },
  { emoji: '💰', name: 'Foreign Aid', detail: 'Take 2 coins.', tag: 'Duke blocks', tagColor: COUP.purple },
  { emoji: '💥', name: 'Coup', detail: 'Pay 7 — a player loses an influence.', tag: 'unblockable', tagColor: COUP.crimson },
];

/** Reformation-only actions, shown only when that variant is active. */
export const REFORMATION_ACTIONS: ActionRef[] = [
  { emoji: '⛪', name: 'Convert', detail: 'Pay 1 (self) or 2 (another) into the Treasury to switch allegiance.', tag: 'reformation', tagColor: COUP.gold },
  { emoji: '🏦', name: 'Embezzle', detail: 'Take all Treasury coins — you claim to hold no Duke.', tag: 'challengeable', tagColor: COUP.crimson },
];

/** Core rules every player should know, shown at the top of the reference. */
export const RULES_NOTES: { icon: string; title: string; body: string }[] = [
  { icon: '🎯', title: 'Goal', body: 'Be the last player with influence. Lose both your cards and you are out.' },
  { icon: '🚩', title: 'Challenge', body: 'Doubt a claimed character. If they were bluffing they lose an influence; if not, you do (and they redraw the card).' },
  { icon: '🛡️', title: 'Block', body: 'Claim a character that stops an action against you. A block can itself be challenged.' },
  { icon: '🪙', title: 'Coins', body: 'At 10+ coins your only legal move is Coup. A coup or successful assassination is unstoppable.' },
];

export { COUP_CHARACTER_COLOR };
