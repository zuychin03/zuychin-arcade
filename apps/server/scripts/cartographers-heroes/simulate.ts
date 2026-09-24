import { pathToFileURL } from 'node:url';
import {
  CARTOGRAPHERS_CARD_BY_ID, type CartographersCard, type CartographersPlacementPayload,
} from '@zuychin-arcade/types';
import {
  cartographersGorgonTargets, cartographersNeighbours, cartographersOccupied, chooseCartographersDestruction,
  initCartographersHeroesGame, legalCartographersPlacements, submitCartographersPlacement,
  transformCartographersShape, type CartographersHeroesServerState, type CartographersTask,
} from '../../src/game/cartographers-heroes/engine.js';

export function cartographersSeed(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
export function firstCartographersPayload(state: CartographersHeroesServerState, task: CartographersTask): CartographersPlacementPayload {
  const card = CARTOGRAPHERS_CARD_BY_ID[state.currentCardId!]!;
  const map = state.players.get(task.targetPlayerId)!.map;
  const fallbackCard: CartographersCard = { id: 'fallback', name: 'Fallback', kind: 'explore', time: 0, terrains: ['forest'], options: [{ cells: [{ x: 0, y: 0 }], coin: false }] };
  const legal = task.fixedPlacement ? { ...task.fixedPlacement, optionIndex: 0 } : legalCartographersPlacements(map, task.fallback ? fallbackCard : card, true)[0];
  if (!legal) throw new Error('Pending placement has no legal move');
  const terrain = card.kind === 'ambush' ? 'monster' : task.fallback ? 'forest' : card.kind === 'hero' ? 'hero' : card.terrains[0]!;
  const payload: CartographersPlacementPayload = { ...legal, terrain, targetPlayerId: task.targetPlayerId, turnId: state.turnId, expectedRevision: state.revision, submissionToken: task.token };
  if (card.kind === 'ambush' && card.monster === 'gorgon' && !task.fallback) {
    const preview = structuredClone(map);
    for (const p of transformCartographersShape(card.cells, payload)) {
      const index = p.y * 11 + p.x, destroyed = preview.attackCells.includes(index);
      preview.cells[index] = { terrain: destroyed ? null : 'monster', monster: 'gorgon', destroyed, wasteland: false };
    }
    const target = cartographersGorgonTargets(preview)[0];
    if (target) payload.destroyTarget = target;
  }
  return payload;
}
export function stepCartographersSimulation(state: CartographersHeroesServerState): void {
  const task = state.tasks.find(value => !value.submitted);
  if (!task) throw new Error('Playing game has no pending task');
  let result;
  if (state.phase === 'season_effect') {
    const map = state.players.get(task.targetPlayerId)!.map;
    const index = map.cells.flatMap((cell, i) => cell.terrain === 'monster' && cell.monster === 'troll' ? cartographersNeighbours(i) : []).find(i => !cartographersOccupied(map.cells[i]!));
    if (index === undefined) throw new Error('Troll choice has no legal target');
    result = chooseCartographersDestruction(state, task.actorId, {
      targetPlayerId: task.targetPlayerId, turnId: state.turnId, expectedRevision: state.revision,
      submissionToken: task.token, position: { x: index % 11, y: Math.floor(index / 11) },
    });
  } else result = submitCartographersPlacement(state, task.actorId, firstCartographersPayload(state, task));
  if (!result.ok) throw new Error(result.reason);
}
export function simulateCartographersHeroes(count: number, seed = count): { players: number; actions: number; winners: number; scores: number[] } {
  const state = initCartographersHeroesGame(Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `Player ${i + 1}` })), { roomCode: 'TEST-HERO', mapSide: count % 2 ? 'C' : 'D', random: cartographersSeed(seed) });
  let actions = 0;
  while (state.status === 'playing') {
    if (++actions > count * 100) throw new Error('Simulation exceeded action bound');
    stepCartographersSimulation(state);
  }
  if (state.endReason !== 'natural' || !state.winnerIds.length || [...state.players.values()].some(p => p.scores.length !== 4 || p.map.cells.length !== 121 || p.map.coins > 14)) throw new Error('Simulation invariant failed');
  return { players: count, actions, winners: state.winnerIds.length, scores: [...state.players.values()].map(p => p.totalScore) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = Array.from({ length: 100 }, (_, i) => simulateCartographersHeroes(i + 1));
  console.log(JSON.stringify({ games: results.length, playerCounts: '1–100', actions: results.reduce((sum, r) => sum + r.actions, 0), results }));
}
