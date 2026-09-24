import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARTOGRAPHERS_AMBUSH_CARDS, CARTOGRAPHERS_CARD_BY_ID, CARTOGRAPHERS_CARDS, CARTOGRAPHERS_EXPLORE_CARDS,
  CARTOGRAPHERS_HERO_CARDS, CARTOGRAPHERS_MAPS, CARTOGRAPHERS_OBJECTIVES, CARTOGRAPHERS_SEASONS,
  type CartographersMapView, type CartographersTerrain,
} from '@zuychin-arcade/types';
import {
  cartographersMonsterPenalty, cartographersOccupied, chooseCartographersDestruction, createCartographersMap,
  forfeitCartographersPlayer, forfeitCartographersPlayers, initCartographersHeroesGame, legalCartographersPlacements,
  scoreCartographersObjective, soloCartographersAmbushPlacement, submitCartographersPlacement,
  transformCartographersShape, type CartographersHeroesServerState,
} from './engine.js';
import { toCartographersHeroesPrivateState, toCartographersHeroesPublicState } from './publicState.js';
import { cartographersSeed, firstCartographersPayload, simulateCartographersHeroes, stepCartographersSimulation } from '../../../scripts/cartographers-heroes/simulate.js';

function blank(): CartographersMapView {
  const map = createCartographersMap('C');
  map.cells.forEach(cell => { cell.terrain = null; });
  return map;
}
function paint(map: CartographersMapView, terrain: CartographersTerrain, points: number[][]): void {
  for (const [x, y] of points) map.cells[y! * 11 + x!]!.terrain = terrain;
}
function game(count = 3): CartographersHeroesServerState {
  return initCartographersHeroesGame(Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `Player ${i}` })), { roomCode: 'TEST-HERO', random: cartographersSeed(21) });
}
function forceCard(state: CartographersHeroesServerState, cardId: string): void {
  state.phase = 'drawing'; state.currentCardId = cardId; state.elapsed = 0; state.turnId++; state.turnRevision = state.revision;
  state.tasks = [...state.players.values()].filter(p => !p.forfeited).map(player => ({ targetPlayerId: player.playerId, actorId: player.playerId, token: `${state.turnId}:${player.playerId}`, submitted: false, fallback: !legalCartographersPlacements(player.map, CARTOGRAPHERS_CARD_BY_ID[cardId]!, true).length, fixedPlacement: null }));
}
function submitFirst(state: CartographersHeroesServerState): void {
  const task = state.tasks.find(t => !t.submitted)!;
  assert.equal(submitCartographersPlacement(state, task.actorId, firstCartographersPayload(state, task)).ok, true);
}
function snapshot(state: CartographersHeroesServerState): string {
  return JSON.stringify({ ...state, players: [...state.players], random: undefined });
}

test('final Heroes inventory and map masks are complete, not base-game substitutes', () => {
  assert.equal(CARTOGRAPHERS_EXPLORE_CARDS.length, 11); assert.equal(CARTOGRAPHERS_HERO_CARDS.length, 4);
  assert.equal(CARTOGRAPHERS_AMBUSH_CARDS.length, 4); assert.equal(CARTOGRAPHERS_OBJECTIVES.length, 16);
  assert.equal(new Set(CARTOGRAPHERS_CARDS.map(c => c.id)).size, 19);
  assert.deepEqual(CARTOGRAPHERS_SEASONS.map(s => s.threshold), [8, 7, 7, 6]);
  assert.equal(CARTOGRAPHERS_MAPS.C.mountains.length, 5); assert.equal(CARTOGRAPHERS_MAPS.D.wasteland.length, 7);
  assert.equal(createCartographersMap('C').cells.filter(cartographersOccupied).length, 5);
  assert.equal(createCartographersMap('D').cells.filter(cartographersOccupied).length, 12);
  assert.deepEqual(CARTOGRAPHERS_EXPLORE_CARDS.map(c => c.options.map(o => o.cells.length)), [[2, 4], [2, 4], [2, 5], [3, 4], [4], [5], [3], [5], [4], [6], [1]]);
  assert.deepEqual(CARTOGRAPHERS_OBJECTIVES.map(c => c.soloModifier), [16, 18, 22, 24, 12, 14, 15, 18, 14, 12, 12, 16, 28, 30, 28, 30]);
});
test('initialisation rejects unsupported counts, duplicate seats, bad map and bad revision', () => {
  assert.throws(() => game(0)); assert.throws(() => game(101));
  assert.throws(() => initCartographersHeroesGame([{ playerId: 'a', displayName: 'A' }, { playerId: 'a', displayName: 'B' }], { roomCode: 'TEST-HERO' }));
  assert.throws(() => initCartographersHeroesGame([{ playerId: 'a', displayName: 'A' }], { roomCode: 'TEST-HERO', mapSide: 'A' as 'C' }));
  assert.throws(() => initCartographersHeroesGame([{ playerId: 'a', displayName: 'A' }], { roomCode: 'TEST-HERO', startingRevision: -1 }));
});
test('setup chooses one scoring objective per category and identical map side', () => {
  const state = game(100);
  assert.equal(new Set(state.objectiveIds.map(id => CARTOGRAPHERS_OBJECTIVES.find(c => c.id === id)!.category)).size, 4);
  assert.equal(state.heroDeck.length, 3); assert.equal(state.ambushDeck.length, 3);
  assert.equal(state.deck.length + state.revealedCardIds.length, 13);
  assert.deepEqual(state.players.get('p0')!.map, state.players.get('p99')!.map);
});
test('transforms preserve disconnected shape cells and allow all eight orientations', () => {
  const card = CARTOGRAPHERS_EXPLORE_CARDS.find(c => c.id === 'wildwood_garden')!;
  const versions = new Set<string>();
  for (const rotation of [0, 90, 180, 270] as const) for (const mirrored of [false, true]) {
    const result = transformCartographersShape(card.options[0]!.cells, { anchor: { x: 3, y: 4 }, rotation, mirrored });
    assert.equal(result.length, 3); assert.ok(result.every(p => p.x >= 3 && p.y >= 4));
    versions.add(JSON.stringify(result.map(p => p.y * 11 + p.x).sort((a, b) => a - b)));
  }
  assert.equal(versions.size, 8);
});
test('shape gaps can cross filled cells, while occupied cells cannot', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); paint(map, 'mountain', [[1, 0]]); forceCard(state, 'pasture');
  const task = state.tasks[0]!;
  const payload = { ...firstCartographersPayload(state, task), anchor: { x: 0, y: 0 }, rotation: 0 as const, mirrored: false, optionIndex: 0 };
  assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true);
  assert.equal(state.players.get('p0')!.map.cells[1]!.terrain, 'mountain');
  assert.equal(state.players.get('p0')!.map.cells[2]!.terrain, 'farm');
});
for (const card of CARTOGRAPHERS_CARDS) test(`actual ${card.kind} card ${card.id} has a legal verified submission`, () => {
  const state = game(); state.players.get('p0')!.map = blank(); forceCard(state, card.id);
  const payload = firstCartographersPayload(state, state.tasks[0]!);
  assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true);
  assert.ok(state.players.get('p0')!.map.cells.some(cartographersOccupied));
});
test('all terrain choices on every explore are accepted independently', () => {
  for (const card of CARTOGRAPHERS_EXPLORE_CARDS) for (const terrain of card.terrains) {
    const state = game(); state.players.get('p0')!.map = blank(); forceCard(state, card.id);
    const payload = { ...firstCartographersPayload(state, state.tasks[0]!), terrain };
    assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true, `${card.id}/${terrain}`);
  }
});
test('same-turn concurrent revisions accepted, confirmed target immutable, prior turn rejected', () => {
  const state = game(); forceCard(state, 'lagoon');
  const first = firstCartographersPayload(state, state.tasks[0]!); const second = firstCartographersPayload(state, state.tasks[1]!);
  assert.equal(submitCartographersPlacement(state, 'p0', first).ok, true);
  let before = snapshot(state); assert.equal(submitCartographersPlacement(state, 'p0', first).ok, false); assert.equal(snapshot(state), before);
  assert.equal(submitCartographersPlacement(state, 'p1', second).ok, true);
  submitFirst(state); before = snapshot(state);
  assert.equal(submitCartographersPlacement(state, 'p0', first).ok, false); assert.equal(snapshot(state), before);
});
test('malformed, forged, future revision and illegal terrain commands are mutation-free', () => {
  const state = game(); forceCard(state, 'kethras_gates'); const valid = firstCartographersPayload(state, state.tasks[0]!);
  const variants = [{ ...valid, terrain: 'hero' }, { ...valid, terrain: 'mountain' }, { ...valid, expectedRevision: 1e9 }, { ...valid, turnId: -1 }, { ...valid, submissionToken: 'forged' }, { ...valid, anchor: { x: NaN, y: 0 } }, { ...valid, anchor: { x: -1, y: 0 } }, { ...valid, rotation: 45 }, { ...valid, optionIndex: 99 }, { ...valid, destroyTarget: { x: 0, y: 0 } }];
  for (const payload of variants) { const before = snapshot(state); assert.equal(submitCartographersPlacement(state, 'p0', payload as typeof valid).ok, false); assert.equal(snapshot(state), before); }
  const before = snapshot(state); assert.equal(submitCartographersPlacement(state, 'outsider', valid).ok, false); assert.equal(snapshot(state), before);
});
test('ordinary no-fit permits anonymous hero but no attack pattern or option coin', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); map.cells.forEach(c => { c.terrain = 'water'; }); map.cells[0]!.terrain = null;
  forceCard(state, 'mangrove_swamp'); const task = state.tasks[0]!; assert.equal(task.fallback, true);
  assert.equal(submitCartographersPlacement(state, 'p0', { ...firstCartographersPayload(state, task), terrain: 'hero' }).ok, true);
  assert.deepEqual(state.players.get('p0')!.map.attackCells, []); assert.equal(state.players.get('p0')!.map.coins, 0);
});
test('ambush no-fit is a generic monster without Gorgon power', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); map.cells.forEach(c => { c.terrain = 'water'; }); map.cells[0]!.terrain = null;
  forceCard(state, 'gorgon'); assert.equal(state.tasks[0]!.fallback, true); submitFirst(state);
  assert.deepEqual(state.players.get('p0')!.map.cells[0], { terrain: 'monster', destroyed: false, wasteland: false, monster: null });
});
test('coin awards are option-specific, mountain once only, track capped at14', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank();
  paint(map, 'mountain', [[1, 1]]); paint(map, 'farm', [[0, 1], [2, 1], [1, 0]]); map.coins = 13;
  forceCard(state, 'kethras_gates'); const task = state.tasks[0]!;
  assert.equal(submitCartographersPlacement(state, 'p0', { ...firstCartographersPayload(state, task), anchor: { x: 1, y: 2 } }).ok, true);
  assert.equal(state.players.get('p0')!.map.coins, 14); assert.deepEqual(state.players.get('p0')!.map.mountainCoins, [12]);
  forceCard(state, 'lagoon'); submitFirst(state); assert.equal(state.players.get('p0')!.map.coins, 14);
});
test('heroes destroy existing and future monsters; aura survives destroyed hero', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); paint(map, 'monster', [[1, 0]]); map.cells[1]!.monster = 'zombie';
  forceCard(state, 'dobrik'); const task = state.tasks[0]!;
  assert.equal(submitCartographersPlacement(state, 'p0', { ...firstCartographersPayload(state, task), anchor: { x: 1, y: 1 } }).ok, true);
  assert.equal(state.players.get('p0')!.map.cells[1]!.destroyed, true);
  state.players.get('p0')!.map.cells[12] = { terrain: null, monster: null, destroyed: true, wasteland: false };
  forceCard(state, 'kethras_gates'); const next = state.tasks[0]!;
  assert.equal(submitCartographersPlacement(state, 'p0', { ...firstCartographersPayload(state, next), anchor: { x: 0, y: 1 }, terrain: 'monster' }).ok, true);
  assert.equal(state.players.get('p0')!.map.cells[11]!.destroyed, true);
});
test('Gorgon target excludes mountain and aura removes its triggering cells first', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); map.attackCells = [0, 2, 12];
  forceCard(state, 'gorgon'); const payload = { ...firstCartographersPayload(state, state.tasks[0]!), anchor: { x: 0, y: 0 } }; delete payload.destroyTarget;
  assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true);
  assert.equal(state.players.get('p0')!.map.cells.filter(c => c.destroyed).length, 3);
});
test('dragon reward recognises its own destroyed cells, not touching different monsters', () => {
  const state = game(); const map = state.players.get('p0')!.map = blank(); map.attackCells = [2, 11, 12, 13, 22];
  paint(map, 'monster', [[4, 4]]); map.cells[48]!.monster = 'zombie'; forceCard(state, 'dragon');
  const payload = { ...firstCartographersPayload(state, state.tasks[0]!), anchor: { x: 0, y: 0 } };
  assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true);
  assert.equal(state.players.get('p0')!.map.coins, 3); assert.equal(state.players.get('p0')!.map.dragonRewarded, true);
  forceCard(state, 'kethras_gates'); submitFirst(state); assert.equal(state.players.get('p0')!.map.coins, 3);
});
test('monster penalty deduplicates empty neighbours and excludes destroyed monsters', () => {
  const map = blank(); paint(map, 'monster', [[0, 0], [2, 0]]); assert.equal(cartographersMonsterPenalty(map), 4);
  map.cells[0]!.terrain = null; map.cells[0]!.destroyed = true; assert.equal(cartographersMonsterPenalty(map), 3);
});

const objectiveCases: [string, number, (map: CartographersMapView) => void][] = [
  ['faunlost_thicket', 6, m => paint(m, 'forest', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]])],
  ['deepwood', 6, m => { paint(m, 'forest', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [3, 0], [3, 1], [3, 2], [3, 3], [3, 4]]); paint(m, 'village', [[4, 0]]); }],
  ['heart_of_the_forest', 2, m => paint(m, 'forest', [[0, 0], [1, 0], [0, 1]])],
  ['sleepy_valley', 8, m => paint(m, 'forest', [[0, 0], [2, 0], [4, 0], [0, 2], [2, 2], [4, 2]])],
  ['craylund', 7, m => { paint(m, 'farm', [[1, 1], [2, 1]]); paint(m, 'water', [[1, 0], [2, 0], [3, 1]]); }],
  ['ulems_wallow', 4, m => { paint(m, 'water', [[1, 1]]); paint(m, 'farm', [[0, 1], [1, 2]]); }],
  ['clawsgrave_peaks', 5, m => { paint(m, 'water', [[1, 1], [2, 1], [2, 2]]); paint(m, 'mountain', [[1, 2]]); paint(m, 'farm', [[3, 1]]); }],
  ['jorekburg', 4, m => { paint(m, 'water', [[1, 1], [1, 2], [2, 2]]); paint(m, 'farm', [[1, 3], [1, 4]]); }],
  ['traylo_monastery', 7, m => paint(m, 'village', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1]])],
  ['outer_enclave', 4, m => paint(m, 'village', [[0, 0], [1, 0], [0, 1], [1, 1]])],
  ['gnomish_colony', 6, m => paint(m, 'village', [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]])],
  ['caravansary', 5, m => paint(m, 'village', [[0, 0], [1, 0], [2, 0], [2, 1]])],
  ['dwarvenholds', 14, m => { paint(m, 'farm', Array.from({ length: 11 }, (_, n) => [n, 0])); paint(m, 'water', Array.from({ length: 11 }, (_, n) => [0, n])); paint(m, 'mountain', [[0, 0]]); }],
  ['silos', 10, m => { paint(m, 'farm', Array.from({ length: 11 }, (_, n) => [0, n])); paint(m, 'farm', Array.from({ length: 11 }, (_, n) => [1, n])); }],
  ['banded_hills', 4, m => { (['water', 'farm', 'hero', 'monster', 'mountain'] as const).forEach((t, x) => paint(m, t, [[x, 0]])); }],
  ['starlit_sigil', 4, m => { m.cells.forEach(c => { c.terrain = 'farm'; }); [0, 1, 11].forEach(i => { m.cells[i]!.terrain = null; }); }],
];
for (const [id, expected, setup] of objectiveCases) test(`objective ${id}: exact final-card condition`, () => {
  const map = blank(); setup(map); assert.equal(scoreCartographersObjective(map, id), expected);
});
test('filled no-terrain cells count for rows but not terrain diversity', () => {
  const map = blank(); for (let i = 0; i < 11; i++) map.cells[i]!.destroyed = true;
  paint(map, 'mountain', [[0, 0]]); assert.equal(scoreCartographersObjective(map, 'dwarvenholds'), 7); assert.equal(scoreCartographersObjective(map, 'banded_hills'), 0);
});
test('solo ambush corner/orientation is deterministic and no-fit skips the ambush', () => {
  const map = blank();
  const expected = [[0, 8], [0, 0], [8, 0], [8, 9]];
  CARTOGRAPHERS_AMBUSH_CARDS.forEach((card, i) => {
    const placement = soloCartographersAmbushPlacement(map, card)!;
    assert.deepEqual(placement.anchor, { x: expected[i]![0], y: expected[i]![1] }); assert.equal(placement.rotation, 0); assert.equal(placement.mirrored, false);
  });
  map.cells.forEach(c => { c.terrain = 'farm'; }); map.cells[0]!.terrain = null;
  assert.equal(soloCartographersAmbushPlacement(map, CARTOGRAPHERS_AMBUSH_CARDS[0]!), null);
});
test('forfeit reroutes unfinished monster work without losing existing owner assignment', () => {
  const state = game(4); forceCard(state, 'zombie');
  state.tasks[0]!.actorId = 'p1'; state.tasks[1]!.actorId = 'p2'; state.tasks[2]!.actorId = 'p3'; state.tasks[3]!.actorId = 'p0';
  assert.equal(forfeitCartographersPlayer(state, 'p1').ok, true);
  const own = toCartographersHeroesPrivateState(state, 'p0'); assert.equal(own.assignments.length, 2);
  for (const target of ['p0', 'p3']) {
    const task = state.tasks.find(t => t.targetPlayerId === target)!; const payload = firstCartographersPayload(state, task);
    assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, true);
    assert.equal(submitCartographersPlacement(state, 'p0', payload).ok, false);
  }
  assert.equal(state.players.get('p1')!.forfeited, true); assert.deepEqual(toCartographersHeroesPrivateState(state, 'p1').assignments, []);
});
test('forfeit preserves submitted map and prevents later scoring and winner eligibility', () => {
  const state = game(4); forceCard(state, 'lagoon'); submitFirst(state);
  const before = structuredClone(state.players.get('p0')!.map); forfeitCartographersPlayer(state, 'p0');
  while (state.status === 'playing') stepCartographersSimulation(state);
  assert.deepEqual(state.players.get('p0')!.map, before); assert.equal(state.players.get('p0')!.scores.length, 0); assert.ok(!state.winnerIds.includes('p0'));
});
test('last multiplayer survivor wins by forfeit while solo departure abandons without winner', () => {
  const state = game(2); forfeitCartographersPlayer(state, 'p0'); assert.equal(state.endReason, 'forfeit'); assert.deepEqual(state.winnerIds, ['p1']);
  const solo = game(1); forfeitCartographersPlayer(solo, 'p0'); assert.equal(solo.endReason, 'abandoned'); assert.deepEqual(solo.winnerIds, []);
});
test('simultaneous grace expiry has no fictitious last survivor', () => {
  const state = game(2);
  assert.equal(forfeitCartographersPlayers(state, ['p0', 'p1']).ok, true);
  assert.equal(state.endReason, 'abandoned'); assert.deepEqual(state.winnerIds, []);
  const invalid = game(3), before = snapshot(invalid);
  assert.equal(forfeitCartographersPlayers(invalid, ['p0', 'outsider']).ok, false); assert.equal(snapshot(invalid), before);
});
test('projections hide decks, maps and other assignments; result inspection returns one map only', () => {
  const state = game(100); forceCard(state, 'lagoon');
  const publicState = toCartographersHeroesPublicState(state), privateState = toCartographersHeroesPrivateState(state, 'p0');
  assert.ok(!JSON.stringify(publicState).includes('"cells"')); assert.ok(!('deck' in publicState)); assert.equal(privateState.assignments.length, 1); assert.equal(privateState.resultMaps.length, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(publicState)) < 24000); assert.ok(Buffer.byteLength(JSON.stringify(privateState)) < 24000);
  privateState.map.cells[0]!.terrain = 'mountain'; assert.notEqual(state.players.get('p0')!.map.cells[0]!.terrain, 'mountain');
  state.status = 'game_over'; assert.equal(toCartographersHeroesPrivateState(state, 'p0').resultMaps.length, 0); assert.equal(toCartographersHeroesPrivateState(state, 'p0', 'p99').resultMaps.length, 1);
  assert.throws(() => toCartographersHeroesPrivateState(state, 'outsider'));
});
for (const count of [1, 2, 10, 12, 100]) test(`complete seeded ${count}-player game reaches four scored seasons`, () => {
  const result = simulateCartographersHeroes(count, count + 200); assert.equal(result.players, count); assert.ok(result.winners > 0);
});
test('all-filled boards finish without fictitious placement or infinite barrier', () => {
  const state = game(); forceCard(state, 'kethras_gates');
  for (const player of state.players.values()) { player.map = blank(); player.map.cells.forEach(c => { c.terrain = 'farm'; }); }
  state.players.get('p0')!.map.cells[0]!.terrain = null; state.tasks = state.tasks.slice(0, 1); submitFirst(state);
  assert.equal(state.status, 'game_over'); assert.equal(state.players.get('p0')!.scores.length, 4);
});
test('season scoring happens before zombie expansion; expansion is one frontier, not flood fill', () => {
  const state = game(); for (const player of state.players.values()) player.map = blank();
  const map = state.players.get('p0')!.map; paint(map, 'monster', [[5, 5]]); map.cells[60]!.monster = 'zombie';
  state.activeAmbushIds = ['zombie']; forceCard(state, 'kethras_gates'); state.elapsed = 8;
  for (let i = 0; i < 3; i++) submitFirst(state);
  assert.equal(state.players.get('p0')!.scores[0]!.monsterPenalty, 4);
  assert.equal(state.players.get('p0')!.map.cells.filter(c => c.monster === 'zombie').length, 5);
});
test('Troll blocks progression for explicit owner choice and cannot destroy filled cells', () => {
  const state = game(); for (const player of state.players.values()) player.map = blank();
  const map = state.players.get('p0')!.map; paint(map, 'monster', [[5, 5]]); map.cells[60]!.monster = 'troll'; paint(map, 'farm', [[4, 5]]);
  state.activeAmbushIds = ['troll']; forceCard(state, 'kethras_gates'); state.elapsed = 8;
  for (let i = 0; i < 3; i++) submitFirst(state);
  assert.equal(state.phase, 'season_effect'); assert.equal(state.currentEffect, 'troll'); const task = state.tasks[0]!;
  const payload = { targetPlayerId: task.targetPlayerId, turnId: state.turnId, expectedRevision: state.revision, submissionToken: task.token, position: { x: 4, y: 5 } };
  const before = snapshot(state); assert.equal(chooseCartographersDestruction(state, 'p0', payload).ok, false); assert.equal(snapshot(state), before);
  assert.equal(chooseCartographersDestruction(state, 'p0', { ...payload, position: { x: 6, y: 5 } }).ok, true);
  assert.equal(state.players.get('p0')!.map.cells[61]!.destroyed, true); assert.equal(state.season, 1);
});
test('revealed hero and ambush cards never recycle; unrevealed ones carry across seasons', () => {
  const state = game(); const specials = new Set<string>(); let lastTurn = -1, lastSeason = -1;
  while (state.status === 'playing') {
    if (state.phase === 'drawing' && state.turnId !== lastTurn) {
      lastTurn = state.turnId; const card = CARTOGRAPHERS_CARD_BY_ID[state.currentCardId!]!;
      if (card.kind !== 'explore') { assert.ok(!specials.has(card.id), card.id); specials.add(card.id); }
    }
    if (state.season !== lastSeason) {
      lastSeason = state.season;
      assert.equal(state.heroDeck.length, 3 - state.season); assert.equal(state.ambushDeck.length, 3 - state.season);
      for (const card of CARTOGRAPHERS_EXPLORE_CARDS) assert.equal([...state.deck, ...state.revealedCardIds].filter(id => id === card.id).length, 1);
    }
    assert.equal(new Set(state.deck).size, state.deck.length);
    for (const id of state.deck) if (CARTOGRAPHERS_CARD_BY_ID[id]!.kind !== 'explore') assert.ok(!specials.has(id));
    stepCartographersSimulation(state);
  }
});
test('time overshoot scores only after the whole simultaneous barrier', () => {
  const state = game(); forceCard(state, 'mangrove_swamp'); state.elapsed = 9;
  submitFirst(state); submitFirst(state);
  assert.equal(state.season, 0); assert.equal(state.players.get('p0')!.scores.length, 0);
  submitFirst(state); assert.equal(state.season, 1); assert.equal(state.players.get('p0')!.scores.length, 1);
});
test('Troll and Zombie post-season effects resolve in reveal order, not fixed monster order', () => {
  for (const order of [['troll', 'zombie'], ['zombie', 'troll']]) {
    const state = game(); for (const player of state.players.values()) player.map = blank();
    const map = state.players.get('p0')!.map;
    paint(map, 'monster', [[5, 5], [3, 5]]); map.cells[60]!.monster = 'troll'; map.cells[58]!.monster = 'zombie';
    paint(map, 'farm', [[5, 4], [6, 5], [5, 6]]);
    state.activeAmbushIds = order; forceCard(state, 'kethras_gates'); state.elapsed = 8;
    submitFirst(state); submitFirst(state); submitFirst(state);
    if (order[0] === 'troll') {
      assert.equal(state.phase, 'season_effect'); assert.equal(state.players.get('p0')!.map.cells[59]!.terrain, null);
      const task = state.tasks[0]!;
      assert.equal(chooseCartographersDestruction(state, task.actorId, { targetPlayerId: task.targetPlayerId, turnId: state.turnId, expectedRevision: state.revision, submissionToken: task.token, position: { x: 4, y: 5 } }).ok, true);
      assert.equal(state.players.get('p0')!.map.cells[59]!.destroyed, true);
    } else {
      assert.equal(state.season, 1); assert.equal(state.players.get('p0')!.map.cells[59]!.monster, 'zombie');
    }
  }
});
test('winter Troll effect settles after last score without retroactive score change', () => {
  const state = game(); for (const player of state.players.values()) player.map = blank();
  state.season = 3; const map = state.players.get('p0')!.map; paint(map, 'monster', [[5, 5]]); map.cells[60]!.monster = 'troll';
  state.activeAmbushIds = ['troll']; forceCard(state, 'kethras_gates'); state.elapsed = 6;
  submitFirst(state); submitFirst(state); submitFirst(state);
  assert.equal(state.phase, 'season_effect'); const score = structuredClone(state.players.get('p0')!.scores[0]);
  stepCartographersSimulation(state); assert.equal(state.status, 'game_over'); assert.deepEqual(state.players.get('p0')!.scores[0], score);
});
test('natural score tie uses accumulated monster penalties then shares victory', () => {
  const state = game(); state.season = 3; forceCard(state, 'kethras_gates'); state.elapsed = 6;
  for (const [index, player] of [...state.players.values()].entries()) {
    player.map = blank(); player.totalScore = 100;
    player.scores = [{ season: 0, objectives: [100, 0], coins: 0, monsterPenalty: index === 1 ? 4 : 1, total: 100 }];
  }
  submitFirst(state); submitFirst(state); submitFirst(state);
  assert.equal(state.endReason, 'natural'); assert.deepEqual(state.winnerIds, ['p0', 'p2']);
});
test('solo rating subtracts all four printed modifiers once', () => {
  const state = game(1);
  while (state.status === 'playing') stepCartographersSimulation(state);
  const modifier = state.objectiveIds.reduce((sum, id) => sum + CARTOGRAPHERS_OBJECTIVES.find(o => o.id === id)!.soloModifier, 0);
  assert.equal(state.soloRating, state.players.get('p0')!.totalScore - modifier); assert.ok(state.soloTitle);
});
test('forfeit during Troll barrier settles without passive drawing or scoring later', () => {
  const state = game(4); for (const player of state.players.values()) player.map = blank();
  const map = state.players.get('p0')!.map; paint(map, 'monster', [[5, 5]]); map.cells[60]!.monster = 'troll';
  state.activeAmbushIds = ['troll']; forceCard(state, 'kethras_gates'); state.elapsed = 8;
  for (let i = 0; i < 4; i++) submitFirst(state);
  assert.equal(state.phase, 'season_effect'); const before = structuredClone(state.players.get('p0')!.map);
  forfeitCartographersPlayer(state, 'p0'); assert.equal(state.season, 1); assert.deepEqual(state.players.get('p0')!.map, before);
  while (state.status === 'playing') stepCartographersSimulation(state);
  assert.equal(state.players.get('p0')!.scores.length, 1); assert.ok(!state.winnerIds.includes('p0'));
});
