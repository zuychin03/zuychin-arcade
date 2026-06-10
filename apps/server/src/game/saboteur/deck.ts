import type { ActionCard, GameCard, PathCard, PathCardEdges } from '@zuychin-arcade/types';
import { ACTION_CARD_COUNTS, GOLD_NUGGET_CARDS } from '@zuychin-arcade/types';

// Edge shorthand: which sides have a tunnel opening.
// O = open, C = closed (wall). `center` = openings connect through the middle
// (false on dead-end cards: you can enter but the tunnel goes nowhere).
function edges(top: boolean, right: boolean, bottom: boolean, left: boolean, center: boolean): PathCardEdges {
  return {
    top: top ? 'open' : 'closed',
    right: right ? 'open' : 'closed',
    bottom: bottom ? 'open' : 'closed',
    left: left ? 'open' : 'closed',
    center,
  };
}

// The 40 tunnel cards of the physical deck.
// Connecting cards (31) + dead-end cards (9), counts per the original game.
const PATH_COMPOSITION: Array<{ count: number; edges: PathCardEdges; deadEnd: boolean }> = [
  // connecting cards
  { count: 5, edges: edges(true, true, true, true, true), deadEnd: false },    // crossroads
  { count: 5, edges: edges(true, false, true, true, true), deadEnd: false },   // T: vertical + left
  { count: 5, edges: edges(false, true, true, true, true), deadEnd: false },   // T: horizontal + bottom
  { count: 4, edges: edges(true, false, true, false, true), deadEnd: false },  // straight vertical
  { count: 3, edges: edges(false, true, false, true, true), deadEnd: false },  // straight horizontal
  { count: 4, edges: edges(false, false, true, true, true), deadEnd: false },  // curve bottom-left
  { count: 5, edges: edges(false, true, true, false, true), deadEnd: false },  // curve bottom-right
  // dead-end cards (one of each shape)
  { count: 1, edges: edges(true, true, true, true, false), deadEnd: true },
  { count: 1, edges: edges(true, false, true, true, false), deadEnd: true },
  { count: 1, edges: edges(false, true, true, true, false), deadEnd: true },
  { count: 1, edges: edges(true, false, true, false, false), deadEnd: true },
  { count: 1, edges: edges(false, true, false, true, false), deadEnd: true },
  { count: 1, edges: edges(false, false, true, true, false), deadEnd: true },
  { count: 1, edges: edges(false, true, true, false, false), deadEnd: true },
  { count: 1, edges: edges(false, false, true, false, false), deadEnd: true }, // single bottom
  { count: 1, edges: edges(false, true, false, false, false), deadEnd: true }, // single right
];

export function buildPathDeck(): PathCard[] {
  const cards: PathCard[] = [];
  let i = 0;
  for (const def of PATH_COMPOSITION) {
    for (let n = 0; n < def.count; n++) {
      cards.push({
        id: `path-${i++}`,
        type: 'path',
        subtype: 'tunnel',
        edges: { ...def.edges },
        isDeadEnd: def.deadEnd,
      });
    }
  }
  return cards;
}

export function buildActionDeck(): ActionCard[] {
  const cards: ActionCard[] = [];
  let i = 0;
  const push = (subtype: ActionCard['subtype'], count: number) => {
    for (let n = 0; n < count; n++) {
      cards.push({ id: `action-${i++}`, type: 'action', subtype });
    }
  };
  push('sabotage_lantern', ACTION_CARD_COUNTS.sabotage.lantern);
  push('sabotage_cart', ACTION_CARD_COUNTS.sabotage.cart);
  push('sabotage_pickaxe', ACTION_CARD_COUNTS.sabotage.pickaxe);
  push('repair_lantern', ACTION_CARD_COUNTS.repair.lantern_only);
  push('repair_cart', ACTION_CARD_COUNTS.repair.cart_only);
  push('repair_pickaxe', ACTION_CARD_COUNTS.repair.pickaxe_only);
  push('repair_lantern_cart', ACTION_CARD_COUNTS.repair.lantern_cart);
  push('repair_lantern_pickaxe', ACTION_CARD_COUNTS.repair.lantern_pickaxe);
  push('repair_cart_pickaxe', ACTION_CARD_COUNTS.repair.cart_pickaxe);
  push('map', ACTION_CARD_COUNTS.map);
  push('rockfall', ACTION_CARD_COUNTS.rockfall);
  return cards;
}

export function buildFullDeck(): GameCard[] {
  return shuffle([...buildPathDeck(), ...buildActionDeck()]);
}

// 28 nugget cards: 4×3, 8×2, 16×1
export function buildGoldDeck(): number[] {
  const deck: number[] = [];
  for (let n = 0; n < GOLD_NUGGET_CARDS.threeNugget; n++) deck.push(3);
  for (let n = 0; n < GOLD_NUGGET_CARDS.twoNugget; n++) deck.push(2);
  for (let n = 0; n < GOLD_NUGGET_CARDS.oneNugget; n++) deck.push(1);
  return shuffle(deck);
}

export function makeStartCard(): PathCard {
  return {
    id: 'start',
    type: 'path',
    subtype: 'start',
    edges: edges(true, true, true, true, true),
    isDeadEnd: false,
  };
}

// Revealed goal cards are oriented so their paths fit the maze, so we model
// them as connecting on all sides.
export function makeGoalCard(isGold: boolean, index: number): PathCard {
  return {
    id: `goal-${index}`,
    type: 'path',
    subtype: isGold ? 'goal_gold' : 'goal_stone',
    edges: edges(true, true, true, true, true),
    isDeadEnd: false,
  };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
