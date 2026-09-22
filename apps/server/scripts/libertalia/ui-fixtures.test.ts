import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LIBERTALIA_LOOT_COUNTS } from '@zuychin-arcade/types';
import { resolveLibertaliaChoice, selectLibertaliaCrew, validateLibertalia } from '../../src/game/libertalia/engine.js';
import { toLibertaliaPrivateState, toLibertaliaPublicState } from '../../src/game/libertalia/publicState.js';
import { createLibertaliaUiFixture, fixtureNames, libertaliaFixtureManifest, libertaliaFixtureProof, LIBERTALIA_FIXTURE_REACHABILITY, LIBERTALIA_UI_FIXTURE_MANIFEST, LIBERTALIA_UI_FIXTURE_SCENARIOS, type LibertaliaUiFixtureScenario } from './ui-fixtures.js';

const bases = (scenario: LibertaliaUiFixtureScenario) => fixtureNames(scenario).map((displayName, i) => ({ playerId: `seat${i}`, displayName }));
const fixture = (scenario: LibertaliaUiFixtureScenario) => createLibertaliaUiFixture('FIXTURE', bases(scenario), scenario, 100);
type State = ReturnType<typeof fixture>;
function choose(state: State, optionId: string): void {
  const pending = state.pendingChoice!;
  const result = resolveLibertaliaChoice(state, pending.playerId, pending.id, [optionId], state.revision);
  assert(result.ok, result.ok ? undefined : result.reason); validateLibertalia(state);
}

for (const scenario of LIBERTALIA_UI_FIXTURE_SCENARIOS) test(`${scenario}: canonical checkpoint, detached proof and owner-only choices`, () => {
  const state = fixture(scenario); validateLibertalia(state);
  const loot = [...state.lootBag, ...state.lootDays.flat(), ...[...state.players.values()].flatMap(p => p.loot)];
  assert.equal(loot.length, Object.values(LIBERTALIA_LOOT_COUNTS).reduce((a, b) => a + b, 0));
  assert.equal(new Set(loot.map(t => t.id)).size, 48);
  assert(state.revision >= 100);
  const publicState = toLibertaliaPublicState(state);
  for (const p of publicState.players) { assert(!Object.hasOwn(p, 'hand')); assert(!Object.hasOwn(p, 'graveyard')); assert(!Object.hasOwn(p, 'selectedRank')); }
  for (const p of state.players.values()) {
    const privateState = toLibertaliaPrivateState(state, p.playerId);
    assert.equal(privateState.pendingChoice?.playerId ?? null, state.pendingChoice?.playerId === p.playerId ? p.playerId : null);
    if (privateState.pendingChoice) assert(!Object.hasOwn(privateState.pendingChoice, 'resolve'));
  }
  const proof = libertaliaFixtureProof(state); proof.players[0]!.hand.length = 0; proof.lootDays.flat().forEach(t => { t.id = -1; });
  validateLibertalia(state);
  if (state.pendingChoice) {
    const before = state.revision, pending = state.pendingChoice;
    assert.equal(typeof pending.resolve, 'function'); assert(pending.options.length > 0);
    assert.equal(pending.optional, false); assert.equal(pending.min, 1); assert.equal(pending.max, 1);
    assert.equal(resolveLibertaliaChoice(state, pending.playerId, pending.id, [], state.revision).ok, false);
    assert.equal(resolveLibertaliaChoice(state, pending.playerId, pending.id, [pending.options[0]!.id], state.revision - 1).ok, false);
    const other = state.turnOrder.find(id => id !== pending.playerId)!;
    assert.equal(resolveLibertaliaChoice(state, other, pending.id, [pending.options[0]!.id], state.revision).ok, false);
    assert.equal(state.revision, before); assert.equal(state.pendingChoice, pending);
    choose(state, pending.options[0]!.id);
    assert.equal(state.revision, before + 1);
  }
});

test('manifest discloses non-produced variants without fake choice callbacks', () => {
  assert.equal(LIBERTALIA_FIXTURE_REACHABILITY.reachableKinds.length, 9);
  assert.deepEqual(LIBERTALIA_FIXTURE_REACHABILITY.unsupported.map(x => x.case), ['player', 'optional', 'empty-pending', 'multi-select']);
  assert.equal(LIBERTALIA_UI_FIXTURE_MANIFEST.length, 12);
  const engine = readFileSync(new URL('../../src/game/libertalia/engine.ts', import.meta.url), 'utf8');
  const producers = [...new Set([...engine.matchAll(/chooseOne\(s,p,'([^']+)'/g)].map(match => match[1]))].sort();
  assert.deepEqual(producers, [...LIBERTALIA_FIXTURE_REACHABILITY.reachableKinds].sort());
  for (const entry of libertaliaFixtureManifest()) {
    assert.equal(entry.exampleCheckpoint.players.length, entry.names.length);
    assert.equal(entry.exampleCheckpoint.choice?.kind ?? null, entry.kind);
    assert.equal(entry.exampleCheckpoint.canonicalLoot, 48);
  }
  for (const scenario of ['six-fleet', 'six-results'] as const) assert(fixtureNames(scenario).every(name => name.length === 20));
});

test('Scout and Gunner callbacks mutate their exact canonical crew zones', () => {
  const scout = fixture('scout-hand'); choose(scout, 'hand:seat0:6');
  assert(scout.players.get('seat0')!.graveyard.includes(1)); assert(!scout.players.get('seat0')!.hand.includes(6));
  const gunner = fixture('gunner-ship'); const position = gunner.reputationTrack.indexOf('seat0');
  const coins = gunner.players.get('seat0')!.doubloons; choose(gunner, 'ship:seat1:8');
  assert(!gunner.players.get('seat1')!.ship.includes(8)); assert(gunner.players.get('seat1')!.graveyard.includes(8));
  assert.equal(gunner.reputationTrack.indexOf('seat0'), Math.max(0, position - 1));
  assert.equal(gunner.players.get('seat0')!.doubloons, coins - 1);
});

test('Necromancer exposes the canonical nested graveyard choice after consuming its real relic', () => {
  const state = fixture('necromancer-relic');
  assert.deepEqual(state.pendingChoice!.options.map(o => o.id), ['ship:seat0:41']);
  choose(state, 'ship:seat0:41'); assert.equal(state.pendingChoice!.kind, 'graveyard_character');
  assert.deepEqual(state.pendingChoice!.options.map(o => o.id), ['grave:seat0:7', 'grave:seat0:8']);
  choose(state, 'grave:seat0:7');
  assert(state.players.get('seat0')!.ship.includes(7)); assert(!state.players.get('seat0')!.graveyard.includes(7));
  assert(state.lootBag.some(t => t.id === 41));
});

test('Watchman swaps two physical IDs instead of awarding loot', () => {
  const state = fixture('watchman-swap'); assert.equal(state.pendingChoice!.options.length, 9);
  const count = state.players.get('seat0')!.loot.length;
  choose(state, 'swap:1:19');
  assert(state.lootDays[0]!.some(t => t.id === 19)); assert(state.lootDays[1]!.some(t => t.id === 1));
  assert.equal(state.players.get('seat0')!.loot.length, count);
});

test('Saber target comes from a real acquired token and discards only the chosen island card', () => {
  const state = fixture('saber-island');
  assert(state.players.get('seat0')!.loot.some(t => t.id === 35));
  const option = state.pendingChoice!.options.find(o => o.playerId === 'seat1')!;
  choose(state, option.id);
  assert(state.players.get('seat1')!.graveyard.includes(5)); assert(!state.players.get('seat2')!.graveyard.includes(5));
});

test('Hook alternatives use canonical callbacks and retained crew survives voyage settlement', () => {
  const keep = fixture('hook-anchor'); choose(keep, 'keep');
  assert.equal(keep.pendingChoice!.kind, 'ship_character'); choose(keep, 'ship:seat0:29');
  assert.equal(keep.voyage, 2); assert(keep.players.get('seat0')!.ship.includes(29));
  const coins = fixture('hook-anchor'); const before = coins.players.get('seat0')!.doubloons; choose(coins, 'coins');
  assert.equal(coins.players.get('seat0')!.score, before + 2); assert(!coins.players.get('seat0')!.ship.includes(29));
});

test('simultaneous Nymph census survives different owner resolution orders', () => {
  const state = fixture('night-nymph-clash'); assert.deepEqual(state.nightNymphOwners, ['seat0', 'seat1']);
  const before = state.players.get('seat0')!.doubloons;
  choose(state, 'night:37'); assert.equal(state.pendingChoice!.playerId, 'seat1');
  assert(!state.players.get('seat0')!.ship.includes(37)); assert(state.players.get('seat1')!.ship.includes(37));
  assert.deepEqual(state.nightNymphOwners, ['seat0', 'seat1']);
  choose(state, 'night:24'); assert.equal(state.day, 2);
  assert(!state.players.get('seat1')!.ship.includes(37)); assert.equal(state.players.get('seat0')!.doubloons, before + 2);
  assert.equal(state.players.get('seat1')!.doubloons, 11);
});

test('empty option producer auto-continues; neutral Midshipman is not Freed Prisoner', () => {
  const empty = fixture('empty-effect'); assert.match(empty.pendingChoice!.prompt, /loot token from the island/); assert.equal(empty.pendingChoice!.kind, 'loot_current');
  const state = fixture('midshipman-two'); const neutral = toLibertaliaPublicState(state).island.find(c => c.neutral)!;
  assert.equal(neutral.rank, 20.5); assert.equal(neutral.name, 'Midshipman'); assert.equal(neutral.playerId, null);
  assert.equal(toLibertaliaPublicState(state).reputationTrack.filter(p => !p.active).length, 4);
  const id = state.pendingChoice!.options[0]!.lootId!; choose(state, state.pendingChoice!.options[0]!.id);
  assert(state.lootBag.some(t => t.id === id)); assert(!state.players.get('seat0')!.loot.some(t => t.id === id));
});

test('actual hand exhaustion continues without forfeiture and deals six new cards', () => {
  const state = fixture('empty-hand'); const owner = state.players.get('seat0')!;
  assert.equal(owner.hand.length, 0); assert.equal(toLibertaliaPrivateState(state, 'seat0').canSelect, false);
  const second = state.players.get('seat1')!;
  assert(selectLibertaliaCrew(state, second.playerId, second.hand[0]!, state.revision).ok);
  for (let i = 0; state.voyage === 1; i++) { assert(i < 100); choose(state, state.pendingChoice!.options.find(o => o.label !== 'SABER')?.id ?? state.pendingChoice!.options[0]!.id); }
  assert.equal(owner.forfeited, false); assert.equal(owner.hand.length, 6); validateLibertalia(state);
});

test('six-fleet manifest describes layout-only selection, distinct from engine-scored six-results', () => {
  const manifest = libertaliaFixtureManifest();
  const fleet = manifest.find(entry => entry.scenario === 'six-fleet')!;
  const result = manifest.find(entry => entry.scenario === 'six-results')!;
  assert.deepEqual(fleet.path, []);
  assert.match(fleet.postcondition, /Layout-only.*selection checkpoint/);
  assert.match(fleet.postcondition, /No final-day gameplay or scoring is claimed/);
  assert.equal(fleet.exampleCheckpoint.status, 'playing');
  assert.equal(fleet.exampleCheckpoint.phase, 'selection');
  assert.equal(fleet.exampleCheckpoint.revision, 0);
  assert.equal(fleet.exampleCheckpoint.choice, null);
  assert.equal(fleet.exampleCheckpoint.endReason, null);
  assert.deepEqual(fleet.exampleCheckpoint.winnerPlayerIds, []);
  assert.deepEqual(result.path, []);
  assert.match(result.postcondition, /actual engine scoring/);
  assert.equal(result.exampleCheckpoint.status, 'game_over');
  assert.equal(result.exampleCheckpoint.endReason, 'score');
  assert(result.exampleCheckpoint.revision > fleet.exampleCheckpoint.revision);
});

test('six-seat fleet and actual scored result conserve all18 owned ranks and never assign an arbitrary winner', () => {
  const fleet = fixture('six-fleet');
  assert.equal(fleet.revision, 100);
  assert([...fleet.players.values()].every(p => p.selectedRank === null));
  for (const p of fleet.players.values()) { assert.equal(p.ship.length, 10); assert.equal(p.hand.length, 6); assert.equal(p.graveyard.length, 2); assert.equal(p.loot.length, 2); }
  const result = fixture('six-results'); assert.equal(result.status, 'game_over'); assert.equal(result.endReason, 'score');
  assert.equal(result.pendingChoice, null); assert.equal(result.queue.length, 0); assert.equal(result.players.size, 6);
  const winner = result.players.get(result.winnerPlayerIds[0]!)!;
  assert.equal(winner.score, Math.max(...[...result.players.values()].map(p => p.score)));
  assert([...result.players.values()].every(p => !p.forfeited)); validateLibertalia(result);
});
