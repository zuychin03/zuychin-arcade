import type {
  SkullKingCard, SkullKingPlayedCard, SkullKingSuit, SkullKingTigressMode,
} from '@zuychin-arcade/types';

type EffectiveKind = Exclude<SkullKingCard['kind'], 'tigress'>;

export function effectiveKind(card: SkullKingPlayedCard): EffectiveKind {
  if (card.kind !== 'tigress') return card.kind;
  return card.tigressMode === 'escape' ? 'escape' : 'pirate';
}

export function deriveLeadSuit(trick: SkullKingPlayedCard[]): SkullKingSuit | null {
  for (const card of trick) {
    const kind = effectiveKind(card);
    if (kind === 'escape') continue;
    return kind === 'number' ? card.suit ?? null : null;
  }
  return null;
}

export function legalCardIds(hand: SkullKingCard[], trick: SkullKingPlayedCard[]): string[] {
  const leadSuit = deriveLeadSuit(trick);
  if (!leadSuit) return hand.map((card) => card.id);
  const follows = hand.filter((card) => card.kind === 'number' && card.suit === leadSuit);
  if (follows.length === 0) return hand.map((card) => card.id);
  return hand
    .filter((card) => card.kind !== 'number' || card.suit === leadSuit)
    .map((card) => card.id);
}

export interface ResolvedTrick {
  winnerId: string;
  reason: string;
  bonus: number;
}

function firstOf(trick: SkullKingPlayedCard[], kind: EffectiveKind): SkullKingPlayedCard | undefined {
  return trick.find((card) => effectiveKind(card) === kind);
}

export function resolveTrick(trick: SkullKingPlayedCard[]): ResolvedTrick {
  if (trick.length === 0) throw new Error('Cannot resolve an empty trick');
  const nonEscapes = trick.filter((card) => effectiveKind(card) !== 'escape');
  let winner: SkullKingPlayedCard;
  let reason: string;

  if (nonEscapes.length === 0) {
    winner = trick[0]!;
    reason = 'First escape wins an all-escape trick';
  } else {
    const mermaid = firstOf(trick, 'mermaid');
    const skullKing = firstOf(trick, 'skull_king');
    const pirate = firstOf(trick, 'pirate');
    if (mermaid && skullKing) {
      winner = mermaid;
      reason = 'Mermaid charms the Skull King';
    } else if (skullKing) {
      winner = skullKing;
      reason = 'Skull King defeats every pirate and numbered card';
    } else if (pirate) {
      winner = pirate;
      reason = 'First pirate defeats the remaining cards';
    } else if (mermaid) {
      winner = mermaid;
      reason = 'First mermaid defeats every numbered card';
    } else {
      const numbered = nonEscapes.filter((card) => effectiveKind(card) === 'number');
      const trump = numbered.filter((card) => card.suit === 'black');
      const leadSuit = deriveLeadSuit(trick);
      const candidates = trump.length > 0
        ? trump
        : numbered.filter((card) => card.suit === leadSuit);
      winner = candidates.reduce((best, card) => (card.rank! > best.rank! ? card : best));
      reason = trump.length > 0 ? 'Highest black trump wins' : 'Highest card of the lead suit wins';
    }
  }

  let bonus = trick.reduce((sum, card) => {
    if (card.kind !== 'number' || card.rank !== 14) return sum;
    return sum + (card.suit === 'black' ? 20 : 10);
  }, 0);
  const winnerKind = effectiveKind(winner);
  if (winnerKind === 'mermaid' && firstOf(trick, 'skull_king')) bonus += 40;
  else if (winnerKind === 'skull_king') {
    bonus += trick.filter((card) => effectiveKind(card) === 'pirate').length * 30;
  } else if (winnerKind === 'pirate') {
    bonus += trick.filter((card) => effectiveKind(card) === 'mermaid').length * 20;
  }
  return { winnerId: winner.playerId, reason, bonus };
}

export function isTigressMode(value: unknown): value is SkullKingTigressMode {
  return value === 'pirate' || value === 'escape';
}
