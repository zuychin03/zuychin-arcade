import type { BoardPosition, PathCard, PathCardEdges, PlacedCard } from '@zuychin-arcade/types';
import { BOARD } from '@zuychin-arcade/types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const key = (p: BoardPosition) => `${p.row},${p.col}`;

type Side = 'top' | 'right' | 'bottom' | 'left';
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const NEIGHBOURS: Array<{ side: Side; dr: number; dc: number }> = [
  { side: 'top', dr: -1, dc: 0 },
  { side: 'right', dr: 0, dc: 1 },
  { side: 'bottom', dr: 1, dc: 0 },
  { side: 'left', dr: 0, dc: -1 },
];

// A 180° rotation swaps top↔bottom and left↔right
export function rotateEdges(edges: PathCardEdges, rotated: boolean): PathCardEdges {
  if (!rotated) return { ...edges };
  return {
    top: edges.bottom,
    bottom: edges.top,
    left: edges.right,
    right: edges.left,
    center: edges.center,
  };
}

export function boardMap(board: PlacedCard[]): Map<string, PlacedCard> {
  const m = new Map<string, PlacedCard>();
  for (const pc of board) m.set(key(pc.position), pc);
  return m;
}

/**
 * Set of positions whose cards are "traversable": reachable from the start
 * card through mutually-open edges, passing only through cards whose openings
 * connect at the centre. Dead-end cards are reachable but never traversed.
 */
export function traversableSet(board: PlacedCard[]): Set<string> {
  const cells = boardMap(board);
  const start = board.find((p) => p.card.subtype === 'start');
  if (!start) return new Set();

  const traversable = new Set<string>([key(start.position)]);
  const queue: PlacedCard[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { side, dr, dc } of NEIGHBOURS) {
      if (cur.card.edges[side] !== 'open') continue;
      const npos = { row: cur.position.row + dr, col: cur.position.col + dc };
      const nb = cells.get(key(npos));
      if (!nb) continue;
      if (nb.card.edges[OPPOSITE[side]] !== 'open') continue;
      if (!nb.card.edges.center) continue;           // dead end: cannot pass through
      if (traversable.has(key(nb.position))) continue;
      traversable.add(key(nb.position));
      queue.push(nb);
    }
  }
  return traversable;
}

/**
 * Validate placing `card` (edges already rotated) at `position`.
 * `blockedPositions` are cells occupied by face-down goal cards.
 */
export function validatePlacement(
  board: PlacedCard[],
  card: PathCard,
  position: BoardPosition,
  blockedPositions: BoardPosition[],
): ValidationResult {
  const { row, col } = position;
  if (row < 0 || row >= BOARD.rows || col < 0 || col >= BOARD.cols) {
    return { valid: false, reason: 'Position is outside the board' };
  }

  const cells = boardMap(board);
  if (cells.has(key(position))) {
    return { valid: false, reason: 'Position is already occupied' };
  }
  if (blockedPositions.some((p) => p.row === row && p.col === col)) {
    return { valid: false, reason: 'Cannot place a card on a goal position' };
  }

  // Must touch at least one placed path card, and every shared edge must match
  // (open↔open or closed↔closed). Face-down goals impose no edge constraint.
  let hasNeighbour = false;
  for (const { side, dr, dc } of NEIGHBOURS) {
    const nb = cells.get(key({ row: row + dr, col: col + dc }));
    if (!nb) continue;
    hasNeighbour = true;
    const myEdge = card.edges[side];
    const theirEdge = nb.card.edges[OPPOSITE[side]];
    if (myEdge !== theirEdge) {
      return { valid: false, reason: `Edges do not match on the ${side} side` };
    }
  }
  if (!hasNeighbour) {
    return { valid: false, reason: 'Card must touch an existing path card' };
  }

  // Must have an uninterrupted connection back to the start card: an open edge
  // facing the open edge of a card in the start-connected (traversable) network.
  const traversable = traversableSet(board);
  for (const { side, dr, dc } of NEIGHBOURS) {
    if (card.edges[side] !== 'open') continue;
    const npos = { row: row + dr, col: col + dc };
    const nb = cells.get(key(npos));
    if (!nb) continue;
    if (nb.card.edges[OPPOSITE[side]] !== 'open') continue;
    if (traversable.has(key(npos))) return { valid: true };
  }
  return { valid: false, reason: 'No connection back to the start card' };
}

/**
 * A goal is reached when a traversable card sits adjacent to the goal position
 * with an open edge facing it.
 */
export function isGoalReached(board: PlacedCard[], goalPosition: BoardPosition): boolean {
  const cells = boardMap(board);
  const traversable = traversableSet(board);
  for (const { side, dr, dc } of NEIGHBOURS) {
    // neighbour at goal + offset, whose `OPPOSITE[side]` edge faces the goal
    const npos = { row: goalPosition.row + dr, col: goalPosition.col + dc };
    const nb = cells.get(key(npos));
    if (!nb) continue;
    if (!traversable.has(key(npos))) continue;
    if (nb.card.edges[OPPOSITE[side]] === 'open') return true;
  }
  return false;
}

/** Does the player have at least one legal placement for any path card in hand? */
export function hasAnyLegalPlacement(
  board: PlacedCard[],
  hand: PathCard[],
  blockedPositions: BoardPosition[],
): boolean {
  const candidates = new Set<string>();
  const cells = boardMap(board);
  for (const pc of board) {
    for (const { dr, dc } of NEIGHBOURS) {
      const pos = { row: pc.position.row + dr, col: pc.position.col + dc };
      if (!cells.has(key(pos))) candidates.add(key(pos));
    }
  }
  for (const k of candidates) {
    const [row, col] = k.split(',').map(Number);
    for (const card of hand) {
      for (const rotated of [false, true]) {
        const c = { ...card, edges: rotateEdges(card.edges, rotated) };
        if (validatePlacement(board, c, { row, col }, blockedPositions).valid) return true;
      }
    }
  }
  return false;
}
