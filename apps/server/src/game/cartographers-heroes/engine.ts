import {
  CARTOGRAPHERS_AMBUSH_CARDS, CARTOGRAPHERS_CARD_BY_ID, CARTOGRAPHERS_COIN_CAP,
  CARTOGRAPHERS_EXPLORE_CARDS, CARTOGRAPHERS_HERO_CARDS, CARTOGRAPHERS_HEROES_MAX_PLAYERS,
  CARTOGRAPHERS_HEROES_RULES_VERSION, CARTOGRAPHERS_MAPS, CARTOGRAPHERS_OBJECTIVES,
  CARTOGRAPHERS_OBJECTIVE_BY_ID, CARTOGRAPHERS_SEASONS, CARTOGRAPHERS_SOLO_TITLES,
  type CartographersAmbushCard, type CartographersCard, type CartographersCell,
  type CartographersDestructionPayload, type CartographersHeroesPublicState, type CartographersMapSide,
  type CartographersMapView, type CartographersMonster, type CartographersPlacementPayload,
  type CartographersPoint, type CartographersSeasonScore, type CartographersSubmission,
  type CartographersTerrain, type CartographersTransform,
} from '@zuychin-arcade/types';

export type CartographersEngineResult = { ok: true } | { ok: false; reason: string };
export interface CartographersServerPlayer {
  playerId: string; displayName: string; forfeited: boolean; map: CartographersMapView;
  scores: CartographersSeasonScore[]; totalScore: number;
}
export interface CartographersTask {
  targetPlayerId: string; actorId: string; token: string; submitted: boolean; fallback: boolean;
  fixedPlacement: CartographersTransform | null;
}
export interface CartographersHeroesServerState {
  roomCode: string; revision: number; turnRevision: number; turnId: number; rulesVersion: string;
  status: 'playing' | 'game_over'; phase: 'drawing' | 'season_effect' | 'game_over';
  mapSide: CartographersMapSide; solo: boolean; season: number; elapsed: number;
  players: Map<string, CartographersServerPlayer>; turnOrder: string[]; objectiveIds: string[];
  deck: string[]; heroDeck: string[]; ambushDeck: string[]; revealedCardIds: string[];
  activeAmbushIds: string[]; currentCardId: string | null; effectIndex: number;
  currentEffect: CartographersMonster | null; tasks: CartographersTask[];
  winnerIds: string[]; endReason: CartographersHeroesPublicState['endReason'];
  soloRating: number | null; soloTitle: string | null; random: () => number;
}
const ok = (): CartographersEngineResult => ({ ok: true });
const fail = (reason: string): CartographersEngineResult => ({ ok: false, reason });
const at = ({ x, y }: CartographersPoint) => y * 11 + x;
const point = (index: number): CartographersPoint => ({ x: index % 11, y: Math.floor(index / 11) });
const inside = ({ x, y }: CartographersPoint) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 11 && y < 11;
export const cartographersOccupied = (cell: CartographersCell): boolean => cell.terrain !== null || cell.destroyed || cell.wasteland;
export function cartographersNeighbours(index: number): number[] {
  const { x, y } = point(index);
  return [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }].filter(inside).map(at);
}
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Random source must return [0,1)');
    const j = Math.floor(sample * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function createCartographersMap(side: CartographersMapSide): CartographersMapView {
  const cells: CartographersCell[] = Array.from({ length: 121 }, () => ({ terrain: null, destroyed: false, wasteland: false, monster: null }));
  for (const p of CARTOGRAPHERS_MAPS[side].mountains) cells[at(p)]!.terrain = 'mountain';
  for (const p of CARTOGRAPHERS_MAPS[side].wasteland) cells[at(p)]!.wasteland = true;
  return { cells, attackCells: [], coins: 0, mountainCoins: [], dragonRewarded: false };
}
function relative(points: readonly CartographersPoint[], rotation: number, mirrored: boolean): CartographersPoint[] {
  return points.map(p => {
    let x = mirrored ? -p.x : p.x, y = p.y;
    for (let i = 0; i < rotation / 90; i++) [x, y] = [-y, x];
    return { x, y };
  });
}
export function transformCartographersShape(points: readonly CartographersPoint[], transform: CartographersTransform, normalise = true): CartographersPoint[] {
  const rotated = relative(points, transform.rotation, transform.mirrored);
  const dx = normalise ? Math.min(...rotated.map(p => p.x)) : 0;
  const dy = normalise ? Math.min(...rotated.map(p => p.y)) : 0;
  return rotated.map(p => ({ x: p.x - dx + transform.anchor.x, y: p.y - dy + transform.anchor.y }));
}
const single = [{ x: 0, y: 0 }];
function shapeOptions(card: CartographersCard): readonly (readonly CartographersPoint[])[] {
  return card.kind === 'explore' ? card.options.map(option => option.cells) : card.kind === 'ambush' ? [card.cells] : [single];
}
function canPlace(map: CartographersMapView, points: readonly CartographersPoint[]): boolean {
  return points.length > 0 && points.every(p => inside(p) && !cartographersOccupied(map.cells[at(p)]!));
}
export interface CartographersLegalPlacement extends CartographersTransform { optionIndex: number }
export function legalCartographersPlacements(map: CartographersMapView, card: CartographersCard, firstOnly = false): CartographersLegalPlacement[] {
  const legal: CartographersLegalPlacement[] = [];
  const seen = new Set<string>();
  for (let optionIndex = 0; optionIndex < shapeOptions(card).length; optionIndex++) {
    const shape = shapeOptions(card)[optionIndex]!;
    for (const mirrored of [false, true]) for (const rotation of [0, 90, 180, 270] as const) {
      const normal = transformCartographersShape(shape, { anchor: { x: 0, y: 0 }, rotation, mirrored });
      const signature = `${optionIndex}:${normal.map(at).sort((a, b) => a - b).join(',')}`;
      if (seen.has(signature) && card.kind !== 'hero') continue;
      seen.add(signature);
      for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
        const transform = { anchor: { x, y }, rotation, mirrored };
        if (canPlace(map, normal.map(p => ({ x: p.x + x, y: p.y + y })))) {
          legal.push({ ...transform, optionIndex });
          if (firstOnly) return legal;
        }
      }
    }
  }
  return legal;
}
export function soloCartographersAmbushPlacement(map: CartographersMapView, card: CartographersAmbushCard): CartographersTransform | null {
  const width = Math.max(...card.cells.map(p => p.x)) + 1;
  const height = Math.max(...card.cells.map(p => p.y)) + 1;
  for (let layer = 0; layer <= 5; layer++) {
    const left = layer, top = layer, right = 11 - width - layer, bottom = 11 - height - layer;
    if (left > right || top > bottom) break;
    const ring: CartographersPoint[] = [];
    for (let x = left; x <= right; x++) ring.push({ x, y: top });
    for (let y = top + 1; y <= bottom; y++) ring.push({ x: right, y });
    if (bottom > top) for (let x = right - 1; x >= left; x--) ring.push({ x, y: bottom });
    if (right > left) for (let y = bottom - 1; y > top; y--) ring.push({ x: left, y });
    const corner = { x: card.soloCorner.endsWith('left') ? left : right, y: card.soloCorner.startsWith('top') ? top : bottom };
    const start = ring.findIndex(p => p.x === corner.x && p.y === corner.y);
    const step = card.direction === 'clockwise' ? 1 : -1;
    for (let offset = 0; offset < ring.length; offset++) {
      const anchor = ring[(start + step * offset + ring.length) % ring.length]!;
      const transform: CartographersTransform = { anchor, rotation: 0, mirrored: false };
      if (canPlace(map, transformCartographersShape(card.cells, transform))) return transform;
    }
  }
  return null;
}
function components(map: CartographersMapView, terrain: CartographersTerrain | null): number[][] {
  const matches = (i: number) => terrain === null ? !cartographersOccupied(map.cells[i]!) : map.cells[i]!.terrain === terrain;
  const visited = new Set<number>(), result: number[][] = [];
  for (let i = 0; i < 121; i++) {
    if (visited.has(i) || !matches(i)) continue;
    const cluster = [i]; visited.add(i);
    for (let cursor = 0; cursor < cluster.length; cursor++) for (const neighbour of cartographersNeighbours(cluster[cursor]!)) {
      if (!visited.has(neighbour) && matches(neighbour)) { visited.add(neighbour); cluster.push(neighbour); }
    }
    result.push(cluster);
  }
  return result;
}
const boundary = (cluster: number[]): number[] => [...new Set(cluster.flatMap(cartographersNeighbours))].filter(i => !cluster.includes(i));
export function scoreCartographersObjective(map: CartographersMapView, objectiveId: string): number {
  const type = (i: number, terrain: CartographersTerrain) => map.cells[i]?.terrain === terrain;
  const rows = Array.from({ length: 11 }, (_, y) => Array.from({ length: 11 }, (_, x) => y * 11 + x));
  const columns = Array.from({ length: 11 }, (_, x) => Array.from({ length: 11 }, (_, y) => y * 11 + x));
  const count = (indices: number[], terrain: CartographersTerrain) => indices.filter(i => type(i, terrain)).length;
  const full = (indices: number[]) => indices.every(i => cartographersOccupied(map.cells[i]!));
  switch (objectiveId) {
    case 'faunlost_thicket': {
      let best = 0;
      for (const column of columns) { let run = 0; for (const i of column) { run = type(i, 'forest') ? run + 1 : 0; best = Math.max(best, run); } }
      return 2 * best;
    }
    case 'deepwood': return 6 * components(map, 'forest').filter(c => c.length >= 5 && !boundary(c).some(i => type(i, 'village'))).length;
    case 'heart_of_the_forest': return 2 * map.cells.filter((cell, i) => cell.terrain === 'forest' && cartographersNeighbours(i).every(n => type(n, 'forest'))).length;
    case 'sleepy_valley': return 4 * rows.filter(row => count(row, 'forest') >= 3).length;
    case 'craylund': return 7 * components(map, 'farm').filter(c => count(boundary(c), 'water') >= 3).length;
    case 'ulems_wallow': return 4 * map.cells.filter((cell, i) => cell.terrain === 'water' && count(cartographersNeighbours(i), 'farm') >= 2).length;
    case 'clawsgrave_peaks': {
      const linked = new Set<number>();
      for (const c of components(map, 'water')) { const neighbours = boundary(c); if (neighbours.some(i => type(i, 'farm'))) neighbours.filter(i => type(i, 'mountain')).forEach(i => linked.add(i)); }
      return 5 * linked.size;
    }
    case 'jorekburg': return 4 * columns.filter(c => count(c, 'farm') > 0 && count(c, 'farm') === count(c, 'water')).length;
    case 'traylo_monastery': return 7 * components(map, 'village').filter(c => c.some(i => [1, 11].some(step => [1, 2, 3].every(n => c.includes(i + step * n) && (step === 11 || Math.floor(i / 11) === Math.floor((i + step * n) / 11)))))).length;
    case 'outer_enclave': return Math.max(0, ...components(map, 'village').map(c => boundary(c).filter(i => !cartographersOccupied(map.cells[i]!)).length));
    case 'gnomish_colony': return 6 * components(map, 'village').filter(c => c.some(i => i % 11 < 10 && [1, 11, 12].every(delta => c.includes(i + delta)))).length;
    case 'caravansary': return Math.max(0, ...components(map, 'village').map(c => new Set(c.map(i => i % 11)).size + new Set(c.map(i => Math.floor(i / 11))).size));
    case 'dwarvenholds': return 7 * [...rows, ...columns].filter(c => full(c) && c.some(i => type(i, 'mountain'))).length;
    case 'silos': return 10 * columns.filter((c, x) => x % 2 === 0 && full(c)).length;
    case 'banded_hills': return 4 * rows.filter(row => new Set(row.map(i => map.cells[i]!.terrain).filter(t => t !== null)).size >= 5).length;
    case 'starlit_sigil': return 4 * components(map, null).filter(c => c.length === 3).length;
    default: throw new Error(`Unknown objective: ${objectiveId}`);
  }
}
export function cartographersMonsterPenalty(map: CartographersMapView): number {
  return new Set(map.cells.flatMap((cell, i) => cell.terrain === 'monster' ? cartographersNeighbours(i).filter(n => !cartographersOccupied(map.cells[n]!)) : [])).size;
}
function destroy(map: CartographersMapView, index: number): void {
  map.cells[index] = { ...map.cells[index]!, terrain: null, destroyed: true };
}
function rewards(map: CartographersMapView): void {
  map.cells.forEach((cell, i) => {
    if (cell.terrain === 'mountain' && !map.mountainCoins.includes(i) && cartographersNeighbours(i).every(n => cartographersOccupied(map.cells[n]!))) {
      map.mountainCoins.push(i); map.coins++;
    }
  });
  const dragonCells = map.cells.map((cell, i) => cell.monster === 'dragon' ? i : -1).filter(i => i >= 0);
  if (!map.dragonRewarded && dragonCells.length > 0 && dragonCells.every(i => map.cells[i]!.destroyed || cartographersNeighbours(i).every(n => cartographersOccupied(map.cells[n]!)))) {
    map.dragonRewarded = true; map.coins += 3;
  }
  map.coins = Math.min(CARTOGRAPHERS_COIN_CAP, map.coins);
}
function writeCells(map: CartographersMapView, points: readonly CartographersPoint[], terrain: CartographersTerrain, monster: CartographersMonster | null): void {
  for (const p of points) {
    const i = at(p); map.cells[i] = { terrain, monster, destroyed: false, wasteland: false };
    if (terrain === 'monster' && map.attackCells.includes(i)) destroy(map, i);
  }
}
function monsterTargets(map: CartographersMapView, monster: CartographersMonster, emptyOnly: boolean): number[] {
  const cells = map.cells.map((cell, i) => cell.terrain === 'monster' && cell.monster === monster ? i : -1).filter(i => i >= 0);
  return [...new Set(cells.flatMap(cartographersNeighbours))].filter(i => emptyOnly ? !cartographersOccupied(map.cells[i]!) : map.cells[i]!.terrain !== 'mountain');
}
function activePlayers(state: CartographersHeroesServerState): CartographersServerPlayer[] {
  return state.turnOrder.map(id => state.players.get(id)!).filter(player => !player.forfeited);
}
function beginTasks(state: CartographersHeroesServerState): void {
  state.turnId++; state.turnRevision = state.revision; state.tasks = [];
}
function addTask(state: CartographersHeroesServerState, target: CartographersServerPlayer, actorId: string, fallback = false, fixedPlacement: CartographersTransform | null = null): void {
  state.tasks.push({ targetPlayerId: target.playerId, actorId, token: `${state.turnId}:${target.playerId}`, submitted: false, fallback, fixedPlacement });
}
function finish(state: CartographersHeroesServerState, reason: 'natural' | 'forfeit' | 'abandoned'): void {
  state.status = 'game_over'; state.phase = 'game_over'; state.endReason = reason; state.tasks = []; state.currentEffect = null;
  const active = activePlayers(state);
  if (!active.length) { state.winnerIds = []; return; }
  if (reason === 'forfeit') { state.winnerIds = active.map(p => p.playerId); return; }
  const highest = Math.max(...active.map(p => p.totalScore));
  const tied = active.filter(p => p.totalScore === highest);
  const penalty = (p: CartographersServerPlayer) => p.scores.reduce((total, s) => total + s.monsterPenalty, 0);
  const leastPenalty = Math.min(...tied.map(penalty));
  state.winnerIds = tied.filter(p => penalty(p) === leastPenalty).map(p => p.playerId);
  if (state.solo) {
    state.soloRating = active[0]!.totalScore - state.objectiveIds.reduce((total, id) => total + CARTOGRAPHERS_OBJECTIVE_BY_ID[id]!.soloModifier, 0);
    state.soloTitle = CARTOGRAPHERS_SOLO_TITLES.find(([threshold]) => state.soloRating! >= threshold)?.[1] ?? CARTOGRAPHERS_SOLO_TITLES[7][1];
  }
}
function prepareSeason(state: CartographersHeroesServerState): void {
  const remnants = state.deck.filter(id => CARTOGRAPHERS_CARD_BY_ID[id]!.kind !== 'explore');
  state.deck = shuffled([...CARTOGRAPHERS_EXPLORE_CARDS.map(c => c.id), ...remnants, state.heroDeck.shift()!, state.ambushDeck.shift()!], state.random);
  state.elapsed = 0; state.revealedCardIds = []; state.phase = 'drawing'; state.currentCardId = null; state.currentEffect = null;
}
function scoreSeason(state: CartographersHeroesServerState): void {
  const season = CARTOGRAPHERS_SEASONS[state.season]!;
  for (const player of activePlayers(state)) {
    const objectives: [number, number] = [scoreCartographersObjective(player.map, state.objectiveIds[season.edicts[0]]!), scoreCartographersObjective(player.map, state.objectiveIds[season.edicts[1]]!)];
    const monsterPenalty = cartographersMonsterPenalty(player.map);
    const score = { season: state.season, objectives, coins: player.map.coins, monsterPenalty, total: objectives[0] + objectives[1] + player.map.coins - monsterPenalty };
    player.scores.push(score); player.totalScore += score.total;
  }
  state.phase = 'season_effect'; state.effectIndex = 0; state.currentCardId = null;
}
function advance(state: CartographersHeroesServerState): void {
  while (state.status === 'playing' && state.tasks.every(task => task.submitted)) {
    state.tasks = [];
    if (state.phase === 'season_effect') {
      let waits = false;
      while (state.effectIndex < state.activeAmbushIds.length) {
        const monster = (CARTOGRAPHERS_CARD_BY_ID[state.activeAmbushIds[state.effectIndex++]!] as CartographersAmbushCard).monster;
        if (monster === 'zombie') {
          for (const player of activePlayers(state)) {
            const targets = monsterTargets(player.map, 'zombie', true);
            writeCells(player.map, targets.map(point), 'monster', 'zombie'); rewards(player.map);
          }
        } else if (monster === 'troll') {
          state.currentEffect = 'troll'; beginTasks(state);
          for (const player of activePlayers(state)) if (monsterTargets(player.map, 'troll', true).length) addTask(state, player, player.playerId);
          if (state.tasks.length) { waits = true; break; }
        }
      }
      if (waits) return;
      if (state.season === 3) { finish(state, 'natural'); return; }
      state.season++; prepareSeason(state);
    } else if (state.currentCardId !== null && state.elapsed >= CARTOGRAPHERS_SEASONS[state.season]!.threshold) {
      scoreSeason(state); continue;
    }
    const cardId = state.deck.shift();
    if (!cardId) throw new Error('Explore deck exhausted before seasonal threshold');
    const card = CARTOGRAPHERS_CARD_BY_ID[cardId]!;
    state.currentCardId = cardId; state.revealedCardIds.push(cardId); state.elapsed += card.time;
    state.currentEffect = null; state.phase = 'drawing'; beginTasks(state);
    if (card.kind === 'ambush') state.activeAmbushIds.push(cardId);
    const players = activePlayers(state);
    for (let index = 0; index < players.length; index++) {
      const target = players[index]!;
      if (target.map.cells.every(cartographersOccupied)) continue;
      if (card.kind === 'ambush' && state.solo) {
        const fixed = soloCartographersAmbushPlacement(target.map, card);
        if (fixed) addTask(state, target, target.playerId, false, fixed);
      } else {
        const offset = card.kind === 'ambush' ? (card.direction === 'clockwise' ? 1 : -1) : 0;
        const actor = players[(index + offset + players.length) % players.length]!;
        const fallback = !legalCartographersPlacements(target.map, card, true).length;
        addTask(state, target, actor.playerId, fallback);
      }
    }
  }
}
export function initCartographersHeroesGame(
  players: { playerId: string; displayName: string }[],
  options: { roomCode: string; mapSide?: CartographersMapSide; random?: () => number; startingRevision?: number },
): CartographersHeroesServerState {
  if (players.length < 1 || players.length > CARTOGRAPHERS_HEROES_MAX_PLAYERS || new Set(players.map(p => p.playerId)).size !== players.length || players.some(p => !p.playerId)) throw new Error('Cartographers Heroes needs 1–100 unique players');
  if (options.mapSide !== undefined && options.mapSide !== 'C' && options.mapSide !== 'D') throw new Error('Invalid map side');
  const random = options.random ?? Math.random, mapSide = options.mapSide ?? 'C';
  const revision = options.startingRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision');
  const objectiveIds = shuffled(['forest', 'farm_water', 'village', 'general'].map(category => shuffled(CARTOGRAPHERS_OBJECTIVES.filter(c => c.category === category), random)[0]!.id), random);
  const state: CartographersHeroesServerState = {
    roomCode: options.roomCode, revision, turnRevision: revision, turnId: 0, rulesVersion: CARTOGRAPHERS_HEROES_RULES_VERSION,
    status: 'playing', phase: 'drawing', mapSide, solo: players.length === 1, season: 0, elapsed: 0,
    players: new Map(players.map(p => [p.playerId, { ...p, forfeited: false, map: createCartographersMap(mapSide), scores: [], totalScore: 0 }])),
    turnOrder: players.map(p => p.playerId), objectiveIds, deck: [], heroDeck: shuffled(CARTOGRAPHERS_HERO_CARDS.map(c => c.id), random),
    ambushDeck: shuffled(CARTOGRAPHERS_AMBUSH_CARDS.map(c => c.id), random), revealedCardIds: [], activeAmbushIds: [],
    currentCardId: null, effectIndex: 0, currentEffect: null, tasks: [], winnerIds: [], endReason: null, soloRating: null, soloTitle: null, random,
  };
  prepareSeason(state); advance(state); return state;
}
function submissionTask(state: CartographersHeroesServerState, actorId: string, payload: CartographersSubmission): CartographersTask | null {
  if (!payload || state.status !== 'playing' || state.players.get(actorId)?.forfeited !== false || payload.turnId !== state.turnId
    || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < state.turnRevision || payload.expectedRevision > state.revision) return null;
  return state.tasks.find(task => task.actorId === actorId && task.targetPlayerId === payload.targetPlayerId && task.token === payload.submissionToken && !task.submitted) ?? null;
}
function validTransform(payload: CartographersTransform): boolean {
  return !!payload.anchor && inside(payload.anchor) && [0, 90, 180, 270].includes(payload.rotation) && typeof payload.mirrored === 'boolean';
}
function cloneMap(map: CartographersMapView): CartographersMapView {
  return { ...map, cells: map.cells.map(cell => ({ ...cell })), attackCells: [...map.attackCells], mountainCoins: [...map.mountainCoins] };
}
export function cartographersGorgonTargets(map: CartographersMapView): CartographersPoint[] {
  return monsterTargets(map, 'gorgon', false).map(point);
}
export function submitCartographersPlacement(state: CartographersHeroesServerState, actorId: string, payload: CartographersPlacementPayload): CartographersEngineResult {
  const task = submissionTask(state, actorId, payload);
  if (!task || state.phase !== 'drawing') return fail('This placement is stale, already submitted, or not assigned to you');
  if (!validTransform(payload) || !Number.isInteger(payload.optionIndex)) return fail('Invalid placement transform');
  const card = CARTOGRAPHERS_CARD_BY_ID[state.currentCardId!]!;
  const player = state.players.get(task.targetPlayerId)!;
  const options = task.fallback ? [single] : shapeOptions(card);
  const cells = options[payload.optionIndex];
  if (!cells) return fail('Invalid shape option');
  const terrains: readonly CartographersTerrain[] = card.kind === 'ambush' ? ['monster'] : task.fallback
    ? ['forest', 'village', 'farm', 'water', 'monster', 'hero'] : card.kind === 'hero' ? ['hero'] : card.terrains;
  if (!terrains.includes(payload.terrain)) return fail('Invalid terrain');
  if (task.fixedPlacement && (payload.rotation !== 0 || payload.mirrored || payload.anchor.x !== task.fixedPlacement.anchor.x || payload.anchor.y !== task.fixedPlacement.anchor.y)) return fail('Solo ambush placement is fixed');
  const drawn = transformCartographersShape(cells, payload);
  if (!canPlace(player.map, drawn)) return fail('Shape overlaps filled cells or the map edge');
  const next = cloneMap(player.map);
  writeCells(next, drawn, payload.terrain, card.kind === 'ambush' && !task.fallback ? card.monster : null);
  if (card.kind === 'hero' && !task.fallback) {
    const attack = transformCartographersShape(card.attack, payload, false).filter(inside).map(at);
    next.attackCells = [...new Set([...next.attackCells, ...attack])];
    for (const i of next.attackCells) if (next.cells[i]!.terrain === 'monster') destroy(next, i);
  }
  if (card.kind === 'ambush' && card.monster === 'gorgon' && !task.fallback) {
    const candidates = monsterTargets(next, 'gorgon', false);
    if (candidates.length) {
      if (!payload.destroyTarget || !inside(payload.destroyTarget) || !candidates.includes(at(payload.destroyTarget))) return fail('Choose a non-mountain space adjacent to a surviving Gorgon');
      destroy(next, at(payload.destroyTarget));
    } else if (payload.destroyTarget !== undefined) return fail('No surviving Gorgon can destroy that space');
  } else if (payload.destroyTarget !== undefined) return fail('This card has no destruction choice');
  if (card.kind === 'explore' && !task.fallback && card.options[payload.optionIndex]!.coin) next.coins++;
  rewards(next); player.map = next; task.submitted = true; state.revision++; advance(state); return ok();
}
export function chooseCartographersDestruction(state: CartographersHeroesServerState, actorId: string, payload: CartographersDestructionPayload): CartographersEngineResult {
  const task = submissionTask(state, actorId, payload);
  if (!task || state.phase !== 'season_effect' || state.currentEffect !== 'troll') return fail('This destruction choice is stale or not yours');
  const map = state.players.get(task.targetPlayerId)!.map;
  if (!payload.position || !inside(payload.position) || !monsterTargets(map, 'troll', true).includes(at(payload.position))) return fail('Choose an empty space adjacent to a surviving Troll');
  destroy(map, at(payload.position)); rewards(map); task.submitted = true; state.revision++; advance(state); return ok();
}
export function forfeitCartographersPlayer(state: CartographersHeroesServerState, playerId: string): CartographersEngineResult {
  return forfeitCartographersPlayers(state, [playerId]);
}
export function forfeitCartographersPlayers(state: CartographersHeroesServerState, playerIds: readonly string[]): CartographersEngineResult {
  if (!playerIds.length || state.status !== 'playing' || playerIds.some(id => !state.players.has(id) || state.players.get(id)!.forfeited)) return fail('Players cannot forfeit');
  const departed = new Set(playerIds);
  for (const id of departed) state.players.get(id)!.forfeited = true;
  state.revision++;
  const remaining = activePlayers(state);
  if (!remaining.length) { finish(state, 'abandoned'); return ok(); }
  if (!state.solo && remaining.length === 1) { finish(state, 'forfeit'); return ok(); }
  for (const task of state.tasks) {
    if (departed.has(task.targetPlayerId)) task.submitted = true;
    else if (departed.has(task.actorId) && !task.submitted) task.actorId = task.targetPlayerId;
  }
  advance(state); return ok();
}
