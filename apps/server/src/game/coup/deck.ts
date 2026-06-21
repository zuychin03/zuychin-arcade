import type { CoupCharacter, CoupVariant } from '@zuychin-arcade/types';
import { charactersForVariant, copiesPerCharacter } from '@zuychin-arcade/types';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The shuffled court deck: `copies` of each character in play for the variant. */
export function buildCourtDeck(variant: CoupVariant, playerCount: number): CoupCharacter[] {
  const chars = charactersForVariant(variant);
  const copies = copiesPerCharacter(playerCount);
  const deck: CoupCharacter[] = [];
  for (const c of chars) {
    for (let i = 0; i < copies; i++) deck.push(c);
  }
  return shuffle(deck);
}
