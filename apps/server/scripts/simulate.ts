/**
 * Engine smoke test: plays full 3-round games with random legal moves for
 * every player count (3–10) and asserts core invariants. Run with:
 *   pnpm --filter @zuychin-arcade/server simulate
 */
import type { BoardPosition, PathCard, Tool } from '@zuychin-arcade/types';
import { BOARD, ROLE_TABLE, getHandSize } from '@zuychin-arcade/types';
import {
  advanceRound,
  chooseGold,
  initGame,
  isGoldDistributionComplete,
  passTurn,
  placeCard,
  playAction,
  type SaboteurServerState,
} from '../src/game/saboteur/engine.js';
import { boardMap, rotateEdges, validatePlacement } from '../src/game/saboteur/boardValidator.js';

let assertions = 0;
function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function candidatePositions(state: SaboteurServerState): BoardPosition[] {
  const cells = boardMap(state.board);
  const out: BoardPosition[] = [];
  const seen = new Set<string>();
  for (const pc of state.board) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const pos = { row: pc.position.row + dr, col: pc.position.col + dc };
      const k = `${pos.row},${pos.col}`;
      if (seen.has(k) || cells.has(k)) continue;
      seen.add(k);
      out.push(pos);
    }
  }
  return out;
}

function tryRandomMove(state: SaboteurServerState, playerId: string): void {
  const player = state.players.get(playerId)!;
  const blocked = state.goals.filter((g) => !g.revealed).map((g) => g.position);

  // 1. try a path card placement
  if (player.brokenTools.length === 0) {
    const pathCards = player.hand.filter((c): c is PathCard => c.type === 'path');
    const legal: Array<{ cardId: string; pos: BoardPosition; rotated: boolean }> = [];
    for (const card of pathCards) {
      for (const pos of candidatePositions(state)) {
        for (const rotated of [false, true]) {
          const oriented = { ...card, edges: rotateEdges(card.edges, rotated) };
          if (validatePlacement(state.board, oriented, pos, blocked).valid) {
            legal.push({ cardId: card.id, pos, rotated });
          }
        }
      }
    }
    if (legal.length > 0 && Math.random() < 0.85) {
      const m = rand(legal);
      const r = placeCard(state, playerId, m.cardId, m.pos, m.rotated);
      assert(r.ok, `legal placement rejected: ${(r as { reason?: string }).reason}`);
      return;
    }
  }

  // 2. try an action card
  const actions = player.hand.filter((c) => c.type === 'action');
  for (const card of actions.sort(() => Math.random() - 0.5)) {
    if (card.type !== 'action') continue;
    if (card.subtype.startsWith('sabotage_')) {
      const tool = card.subtype.slice('sabotage_'.length) as Tool;
      const targets = [...state.players.values()].filter(
        (p) => p.playerId !== playerId && !p.brokenTools.includes(tool),
      );
      if (targets.length > 0) {
        const r = playAction(state, playerId, card.id, rand(targets).playerId);
        assert(r.ok, 'legal sabotage rejected');
        return;
      }
    } else if (card.subtype.startsWith('repair_')) {
      const tools = card.subtype.slice('repair_'.length).split('_') as Tool[];
      for (const tool of tools) {
        const targets = [...state.players.values()].filter((p) => p.brokenTools.includes(tool));
        if (targets.length > 0) {
          const r = playAction(state, playerId, card.id, rand(targets).playerId, undefined, tools.length > 1 ? tool : undefined);
          assert(r.ok, 'legal repair rejected');
          return;
        }
      }
    } else if (card.subtype === 'map') {
      const unrevealed = state.goals.filter((g) => !g.revealed);
      if (unrevealed.length > 0) {
        const r = playAction(state, playerId, card.id, undefined, rand(unrevealed).position);
        assert(r.ok, 'legal map rejected');
        return;
      }
    } else if (card.subtype === 'rockfall') {
      const tunnels = state.board.filter((p) => p.card.subtype === 'tunnel');
      if (tunnels.length > 0 && Math.random() < 0.3) {
        const r = playAction(state, playerId, card.id, undefined, rand(tunnels).position);
        assert(r.ok, 'legal rockfall rejected');
        return;
      }
    }
  }

  // 3. pass, discarding a random card
  const r = passTurn(state, playerId, rand(player.hand).id);
  assert(r.ok, `pass rejected: ${(r as { reason?: string }).reason}`);
}

function playGame(playerCount: number): SaboteurServerState {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    playerId: `p${i}`,
    displayName: `Player${i}`,
  }));
  const state = initGame('TEST-99', players);

  // setup invariants
  assert(state.deck.length === 67 - playerCount * getHandSize(playerCount), 'deck size after deal');
  const ratio = ROLE_TABLE[playerCount];
  const sabs = [...state.players.values()].filter((p) => p.role === 'saboteur').length;
  assert(sabs === ratio.saboteurs, `saboteur count ${sabs} matches ratio`);
  assert(state.board.length === 1 && state.board[0].card.subtype === 'start', 'start card placed');
  assert(state.goals.filter((g) => g.isGold).length === 1, 'exactly one gold goal');
  for (const p of state.players.values()) {
    assert(p.hand.length === getHandSize(playerCount), 'hand size');
  }

  let guard = 0;
  while (state.status !== 'game_over') {
    if (++guard > 5000) throw new Error('game did not terminate');
    if (state.status === 'playing') {
      tryRandomMove(state, state.turnOrder[state.currentTurnIndex]);
    } else if (state.status === 'round_end') {
      if (!isGoldDistributionComplete(state)) {
        const dist = state.goldDistribution!;
        const picker = dist.order[dist.currentIndex];
        const r = chooseGold(state, picker, Math.floor(Math.random() * dist.availableCards.length));
        assert(r.ok, 'legal gold pick rejected');
      } else {
        advanceRound(state);   // handler does this after a pause in production
      }
    }
  }

  assert(state.round === 3, 'game lasted 3 rounds');
  assert((state.winnerIds?.length ?? 0) >= 1, 'has winners');
  const maxGold = Math.max(...[...state.players.values()].map((p) => p.goldCollected));
  for (const id of state.winnerIds!) {
    assert(state.players.get(id)!.goldCollected === maxGold, 'winners have max gold');
  }
  return state;
}

const GAMES_PER_COUNT = 30;
const results: Record<string, number> = { miners: 0, saboteurs: 0 };
for (let n = 3; n <= 10; n++) {
  for (let g = 0; g < GAMES_PER_COUNT; g++) {
    const state = playGame(n);
    if (state.roundWinner) results[state.roundWinner]++;
  }
  console.log(`player count ${n}: ${GAMES_PER_COUNT} games OK`);
}
console.log(`\nAll simulations passed. ${assertions} assertions.`);
console.log(`Final-round outcomes: miners ${results.miners}, saboteurs ${results.saboteurs}`);
