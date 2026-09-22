import {
  NOT_ALONE_HUNT_CARDS, NOT_ALONE_SURVIVAL_CARDS,
  type NotAloneHuntCardId, type NotAloneSurvivalCardId,
} from '@zuychin-arcade/types';

export type NotAloneRandomSource = () => number;

export function shuffleNotAlone<T>(items: readonly T[], rng: NotAloneRandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

export function createSurvivalDeck(rng: NotAloneRandomSource): NotAloneSurvivalCardId[] {
  return shuffleNotAlone(NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id), rng);
}

export function createHuntDeck(rng: NotAloneRandomSource): NotAloneHuntCardId[] {
  return shuffleNotAlone(NOT_ALONE_HUNT_CARDS.map((card) => card.id), rng);
}
