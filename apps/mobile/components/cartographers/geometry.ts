import { CARTOGRAPHERS_MAPS } from '@zuychin-arcade/types';
import type { CartographersAssignment, CartographersCard, CartographersMapSide, CartographersMapView, CartographersPoint, CartographersTerrain, CartographersTransform } from '@zuychin-arcade/types';

export const cellIndex = (p: CartographersPoint) => p.y * 11 + p.x;
export const insideMap = (p: CartographersPoint) => p.x >= 0 && p.x < 11 && p.y >= 0 && p.y < 11;
export function transformShape(points: readonly CartographersPoint[], transform: CartographersTransform, normalise = true): CartographersPoint[] {
  const rotated = points.map(p => {
    let x = transform.mirrored ? -p.x : p.x, y = p.y;
    for (let turn = 0; turn < transform.rotation / 90; turn++) [x, y] = [-y, x];
    return { x, y };
  });
  const dx = normalise ? Math.min(...rotated.map(p => p.x)) : 0;
  const dy = normalise ? Math.min(...rotated.map(p => p.y)) : 0;
  return rotated.map(p => ({ x: p.x - dx + transform.anchor.x, y: p.y - dy + transform.anchor.y }));
}
export function shapeOptions(card: CartographersCard, fallback: boolean): readonly (readonly CartographersPoint[])[] {
  return fallback || card.kind === 'hero' ? [[{ x: 0, y: 0 }]] : card.kind === 'ambush' ? [card.cells] : card.options.map(option => option.cells);
}
export function terrainOptions(card: CartographersCard, fallback: boolean): readonly CartographersTerrain[] {
  return card.kind === 'ambush' ? ['monster'] : fallback ? ['forest', 'village', 'farm', 'water', 'monster', 'hero'] : card.kind === 'hero' ? ['hero'] : card.terrains;
}
export function placementFits(map: CartographersMapView, points: readonly CartographersPoint[]): boolean {
  return points.length > 0 && points.every(p => insideMap(p) && !map.cells[cellIndex(p)]!.terrain && !map.cells[cellIndex(p)]!.destroyed && !map.cells[cellIndex(p)]!.wasteland);
}
export function neighbours(index: number): number[] {
  const p = { x: index % 11, y: Math.floor(index / 11) };
  return [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }].filter(insideMap).map(cellIndex);
}
export function destructionTargets(map: CartographersMapView, monster: 'gorgon' | 'troll'): number[] {
  return [...new Set(map.cells.flatMap((cell, i) => cell.terrain === 'monster' && cell.monster === monster ? neighbours(i) : []))]
    .filter(i => monster === 'gorgon' ? map.cells[i]!.terrain !== 'mountain' : !map.cells[i]!.terrain && !map.cells[i]!.destroyed && !map.cells[i]!.wasteland);
}
export function placementPreview(assignment: CartographersAssignment, card: CartographersCard, optionIndex: number, terrain: CartographersTerrain, transform: CartographersTransform) {
  const cells = transformShape(shapeOptions(card, assignment.fallback)[optionIndex] ?? [], transform);
  const valid = placementFits(assignment.map, cells);
  const attack = card.kind === 'hero' && !assignment.fallback ? transformShape(card.attack, transform, false).filter(insideMap).map(cellIndex) : [];
  const map = { ...assignment.map, cells: assignment.map.cells.map(cell => ({ ...cell })), attackCells: [...new Set([...assignment.map.attackCells, ...attack])] };
  if (valid) {
    for (const p of cells) map.cells[cellIndex(p)] = { terrain, monster: card.kind === 'ambush' && !assignment.fallback ? card.monster : null, destroyed: false, wasteland: false };
    for (const i of map.attackCells) if (map.cells[i]!.terrain === 'monster') map.cells[i] = { ...map.cells[i]!, terrain: null, destroyed: true };
  }
  const targets = valid && card.kind === 'ambush' && card.monster === 'gorgon' && !assignment.fallback ? destructionTargets(map, 'gorgon') : [];
  return { cells, valid, attack, targets, map };
}
export function emptyChart(side: CartographersMapSide): CartographersMapView {
  const map: CartographersMapView = { cells: Array.from({ length: 121 }, () => ({ terrain: null, destroyed: false, wasteland: false, monster: null })), attackCells: [], coins: 0, mountainCoins: [], dragonRewarded: false };
  for (const p of CARTOGRAPHERS_MAPS[side].mountains) map.cells[cellIndex(p)]!.terrain = 'mountain';
  for (const p of CARTOGRAPHERS_MAPS[side].wasteland) map.cells[cellIndex(p)]!.wasteland = true;
  return map;
}
