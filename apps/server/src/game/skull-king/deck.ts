import type { SkullKingCard, SkullKingSuit } from '@zuychin-arcade/types';
import { SKULL_KING_SUITS } from '@zuychin-arcade/types';

export type RandomSource = () => number;

export function createSkullKingDeck(): SkullKingCard[] {
  const cards: SkullKingCard[] = [];
  for (const suit of SKULL_KING_SUITS) {
    for (let rank = 1; rank <= 14; rank += 1) {
      cards.push({ id: `${suit}-${rank}`, kind: 'number', suit: suit as SkullKingSuit, rank });
    }
  }
  for (let copy = 1; copy <= 5; copy += 1) cards.push({ id: `pirate-${copy}`, kind: 'pirate', copy });
  cards.push({ id: 'tigress', kind: 'tigress' });
  cards.push({ id: 'skull-king', kind: 'skull_king' });
  for (let copy = 1; copy <= 2; copy += 1) cards.push({ id: `mermaid-${copy}`, kind: 'mermaid', copy });
  for (let copy = 1; copy <= 5; copy += 1) cards.push({ id: `escape-${copy}`, kind: 'escape', copy });
  return cards;
}

export function shuffleSkullKingDeck(rng: RandomSource = Math.random): SkullKingCard[] {
  const cards = createSkullKingDeck();
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [cards[index], cards[swap]] = [cards[swap]!, cards[index]!];
  }
  return cards;
}
