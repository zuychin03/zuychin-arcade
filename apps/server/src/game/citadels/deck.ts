import { CITADELS_DISTRICT_MANIFEST } from '@zuychin-arcade/types';
import type { CitadelsDistrictCard } from '@zuychin-arcade/types';

export type CitadelsRandomSource = () => number;

export function shuffleCitadels<T>(items: readonly T[], rng: CitadelsRandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

export function createCitadelsDistrictDeck(rng: CitadelsRandomSource): CitadelsDistrictCard[] {
  const cards: CitadelsDistrictCard[] = [];
  for (const template of CITADELS_DISTRICT_MANIFEST) {
    for (let copy = 1; copy <= template.count; copy += 1) {
      const { count: _count, ...card } = template;
      cards.push({ ...card, id: `${template.templateId}-${copy}` });
    }
  }
  return shuffleCitadels(cards, rng);
}
