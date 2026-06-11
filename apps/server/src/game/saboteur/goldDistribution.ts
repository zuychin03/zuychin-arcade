import type { PlayerGameState } from '@zuychin-arcade/types';
import { SABOTEUR_REWARDS } from '@zuychin-arcade/types';

export interface GoldDistributionState {
  order: string[];                 // miner playerIds, winner first, counter-clockwise
  currentIndex: number;
  availableCards: number[];        // nugget values still on offer
  assignments: Map<string, number>;
}

/**
 * Miners win: draw one nugget card per miner; the player who placed the
 * winning card picks first, then the cards pass counter-clockwise (i.e.
 * against turn order) to the next miner.
 */
export function initGoldDistribution(
  players: Map<string, PlayerGameState>,
  turnOrder: string[],
  lastPlacerId: string | null,
  goldDeck: number[],
): GoldDistributionState {
  const n = turnOrder.length;
  const startIdx = lastPlacerId ? Math.max(turnOrder.indexOf(lastPlacerId), 0) : 0;

  const order: string[] = [];
  for (let i = 0; i < n; i++) {
    const pid = turnOrder[(startIdx - i + n * 2) % n];   // backwards = counter-clockwise
    if (players.get(pid)!.role === 'miner') order.push(pid);
  }

  const drawCount = Math.min(order.length, goldDeck.length);
  const availableCards = goldDeck.splice(0, drawCount);
  return {
    order: order.slice(0, drawCount),
    currentIndex: 0,
    availableCards,
    assignments: new Map(),
  };
}

/**
 * Saboteurs win: each saboteur receives nuggets per the reward table
 * (1 saboteur → 4, 2–3 → 3 each, 4 → 2 each).
 */
export function applySaboteurRewards(players: Map<string, PlayerGameState>): void {
  const saboteurs = [...players.values()].filter((p) => p.role === 'saboteur');
  if (saboteurs.length === 0) return;
  const reward = SABOTEUR_REWARDS[saboteurs.length] ?? 2;
  for (const s of saboteurs) s.goldCollected += reward;
}
