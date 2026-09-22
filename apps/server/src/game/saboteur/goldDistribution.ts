import type { PlayerGameState } from '@zuychin-arcade/types';
import { SABOTEUR_REWARDS } from '@zuychin-arcade/types';

export interface GoldDistributionState {
  order: string[];                 // miner playerIds, winner first, counter-clockwise
  currentIndex: number;
  availableCards: number[];        // nugget values still on offer
  assignments: Map<string, number>;
}

// The winning placer starts the counter-clockwise draft; saboteurs are skipped.
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
    if (players.get(pid)!.role === 'miner' && !players.get(pid)!.forfeited) order.push(pid);
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

// Prefer larger cards while requiring exact payment.
function rewardCards(deck: number[], reward: number): number[] | null {
  if (reward === 0) return [];
  for (let value = Math.min(3, reward); value >= 1; value--) {
    const index = deck.lastIndexOf(value);
    if (index < 0) continue;
    const remaining = [...deck];
    remaining.splice(index, 1);
    const rest = rewardCards(remaining, reward - value);
    if (rest) return [value, ...rest];
  }
  return null;
}

export function applySaboteurRewards(roundPlayers: Map<string, PlayerGameState>, goldDeck: number[]): void {
  const saboteurs = [...roundPlayers.values()].filter((p) => p.role === 'saboteur');
  const recipients = saboteurs.filter((p) => !p.forfeited);
  if (recipients.length === 0) return;
  const reward = SABOTEUR_REWARDS[saboteurs.length] ?? 2;
  const remaining = [...goldDeck];
  for (let paid = 0; paid < recipients.length; paid++) {
    const cards = rewardCards(remaining, reward);
    if (!cards) throw new Error('Gold deck cannot pay the Saboteur reward');
    for (const value of cards) remaining.splice(remaining.lastIndexOf(value), 1);
  }
  goldDeck.splice(0, goldDeck.length, ...remaining);
  for (const s of recipients) s.goldCollected += reward;
}
