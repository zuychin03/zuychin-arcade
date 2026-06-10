// Client-side mirror of the server's board validator, used only to highlight
// valid placement cells. The server remains authoritative for every move.
import type { BoardPosition, PathCard, PathCardEdges, PlacedCard } from '@zuychin-arcade/types';
import { BOARD } from '@zuychin-arcade/types';

type Side = 'top' | 'right' | 'bottom' | 'left';
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const NEIGHBOURS: Array<{ side: Side; dr: number; dc: number }> = [
  { side: 'top', dr: -1, dc: 0 },
  { side: 'right', dr: 0, dc: 1 },
  { side: 'bottom', dr: 1, dc: 0 },
  { side: 'left', dr: 0, dc: -1 },
];

const key = (p: BoardPosition) => `${p.row},${p.col}`;

export function rotateEdges(edges: PathCardEdges, rotated: boolean): PathCardEdges {
  if (!rotated) return edges;
  return {
    top: edges.bottom,
    bottom: edges.top,
    left: edges.right,
    right: edges.left,
    center: edges.center,
  };
}

function traversableSet(board: PlacedCard[], cells: Map<string, PlacedCard>): Set<string> {
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
      if (!nb || nb.card.edges[OPPOSITE[side]] !== 'open' || !nb.card.edges.center) continue;
      if (traversable.has(key(nb.position))) continue;
      traversable.add(key(nb.position));
      queue.push(nb);
    }
  }
  return traversable;
}

/** All cells where `card` (with `rotated` applied) can legally be placed. */
export function validPlacements(
  board: PlacedCard[],
  goalBlocked: BoardPosition[],
  card: PathCard,
  rotated: boolean,
): Set<string> {
  const cells = new Map(board.map((p) => [key(p.position), p]));
  const blocked = new Set(goalBlocked.map(key));
  const traversable = traversableSet(board, cells);
  const edges = rotateEdges(card.edges, rotated);

  const candidates = new Set<string>();
  for (const pc of board) {
    for (const { dr, dc } of NEIGHBOURS) {
      const pos = { row: pc.position.row + dr, col: pc.position.col + dc };
      if (pos.row < 0 || pos.row >= BOARD.rows || pos.col < 0 || pos.col >= BOARD.cols) continue;
      const k = key(pos);
      if (!cells.has(k) && !blocked.has(k)) candidates.add(k);
    }
  }

  const valid = new Set<string>();
  for (const k of candidates) {
    const [row, col] = k.split(',').map(Number);
    let edgesMatch = true;
    let connected = false;
    for (const { side, dr, dc } of NEIGHBOURS) {
      const nb = cells.get(key({ row: row + dr, col: col + dc }));
      if (!nb) continue;
      if (edges[side] !== nb.card.edges[OPPOSITE[side]]) {
        edgesMatch = false;
        break;
      }
      if (
        edges[side] === 'open' &&
        nb.card.edges[OPPOSITE[side]] === 'open' &&
        traversable.has(key(nb.position))
      ) {
        connected = true;
      }
    }
    if (edgesMatch && connected) valid.add(k);
  }
  return valid;
}
