import assert from 'node:assert/strict';
import type { LibertaliaChoiceKind, LibertaliaLoot, LibertaliaLootToken } from '@zuychin-arcade/types';
import { initLibertaliaGame, resolveLibertaliaChoice, selectLibertaliaCrew, validateLibertalia, type LibertaliaResult, type LibertaliaServerState } from '../../src/game/libertalia/engine.js';
import type { ServerRoom } from '../../src/store/RoomStore.js';

export const LIBERTALIA_FIXTURE_NAMES = ['Fixture Host', 'Fixture Second', 'Fixture Third'] as const;
export const LIBERTALIA_SIX_FIXTURE_NAMES = ['FixtureHost', 'FixtureSecond', 'FixtureThird', 'FixtureFourth', 'FixtureFifth', 'FixtureSixth'].map(name => name.padEnd(20, 'X'));
export const LIBERTALIA_UI_FIXTURE_SCENARIOS = [
  'scout-hand', 'gunner-ship', 'necromancer-relic', 'watchman-swap', 'saber-island', 'hook-anchor',
  'night-nymph-clash', 'empty-effect', 'empty-hand', 'midshipman-two', 'six-fleet', 'six-results',
] as const;
export type LibertaliaUiFixtureScenario = typeof LIBERTALIA_UI_FIXTURE_SCENARIOS[number];
type Base = { playerId: string; displayName: string };

export const LIBERTALIA_FIXTURE_REACHABILITY = {
  reachableKinds: ['hand_character', 'ship_character', 'graveyard_character', 'island_character', 'loot_current', 'loot_ship', 'loot_swap', 'ability', 'hook_option'] as LibertaliaChoiceKind[],
  unsupported: [
    { case: 'player', reason: 'Declared type only; no current engine choice producer.' },
    { case: 'optional', reason: 'All current chooseOne producers pass optional=false.' },
    { case: 'empty-pending', reason: 'chooseOne immediately continues on zero options; validation rejects an empty pending choice.' },
    { case: 'multi-select', reason: 'All produced pending choices require exactly one option; multiple options do not mean multiple selections.' },
  ],
  scope: 'Arranged canonical checkpoints, not natural games. All pending callbacks and subsequent transitions are created by authoritative select/choice actions.',
};

export function fixtureNames(scenario: LibertaliaUiFixtureScenario): readonly string[] {
  return scenario.startsWith('six-') ? LIBERTALIA_SIX_FIXTURE_NAMES
    : scenario === 'midshipman-two' || scenario === 'empty-hand' ? LIBERTALIA_FIXTURE_NAMES.slice(0, 2) : LIBERTALIA_FIXTURE_NAMES;
}

const specifications: Record<LibertaliaUiFixtureScenario, { ranks: number[]; kind: LibertaliaChoiceKind | null; path: string[]; postcondition: string }> = {
  'scout-hand': { ranks: [1, 5, 6], kind: 'hand_character', path: ['hand:{owner}:6'], postcondition: 'Scout enters own graveyard; chosen Bandit leaves own hand and enters the canonical day.' },
  'gunner-ship': { ranks: [18, 7, 8, 5], kind: 'ship_character', path: ['ship:{second}:8'], postcondition: 'Second owner Barkeep moves from ship to graveyard; Gunner applies minus one reputation, including the boundary coin rule.' },
  'necromancer-relic': { ranks: [19, 7, 8, 5], kind: 'loot_ship', path: ['ship:{owner}:41', 'grave:{owner}:7'], postcondition: 'Relic41 returns to bag; Preacher moves from own graveyard to ship through nested graveyard_character choice.' },
  'watchman-swap': { ranks: [27, 5], kind: 'loot_swap', path: ['swap:1:19'], postcondition: 'Map1 and amulet19 exchange today/tomorrow slots; no acquisition is implied.' },
  'saber-island': { ranks: [13, 5], kind: 'island_character', path: ['option.playerId={second}'], postcondition: 'Saber35 is already acquired through engine loot choice; selected rival Cabin Boy moves to its graveyard.' },
  'hook-anchor': { ranks: [5, 29], kind: 'hook_option', path: ['keep', 'ship:{owner}:29'], postcondition: 'Hook keeps Infantry29 aboard through voyage completion; alternative coins path gains two.' },
  'night-nymph-clash': { ranks: [37, 24, 5], kind: 'ability', path: ['night:37', 'night:24'], postcondition: 'Host chooses Nymph before Topman; second chooses Topman before Nymph. Both Nymphs are discarded using the captured two-owner census.' },
  'empty-effect': { ranks: [4, 5], kind: 'loot_current', path: ['first option'], postcondition: 'Empty Innkeeper ship-choice auto-continues to normal loot, with no empty pending object.' },
  'empty-hand': { ranks: [1, 2, 19, 25, 5, 6], kind: null, path: ['second selects first owned hand rank', 'resolve legal pending choices to voyage2'], postcondition: 'Exhausted host cannot select but remains eligible and receives the next six crew after canonical night/scoring continuation.' },
  'midshipman-two': { ranks: [6, 5], kind: 'loot_current', path: ['first option'], postcondition: 'Host removes loot for neutral Midshipman20.5 without acquiring it; two-player mode and inactive reputation tokens remain.' },
  'six-fleet': { ranks: [5, 8, 10, 15, 20, 22, 24, 28, 32, 34, 35, 37, 1, 2, 3, 4, 6, 7], kind: null, path: [], postcondition: 'Layout-only six long-name selection checkpoint: 10 ship cards, six hand cards, two graveyard cards and two loot tokens per owner. No final-day gameplay or scoring is claimed.' },
  'six-results': { ranks: [5, 8, 10, 15, 20, 22, 24, 28, 32, 34, 35, 37, 1, 2, 3, 4, 6, 7], kind: null, path: [], postcondition: 'Same six-seat checkpoint is completed through actual engine scoring; winner is not assigned by the fixture.' },
};

export const LIBERTALIA_UI_FIXTURE_MANIFEST = LIBERTALIA_UI_FIXTURE_SCENARIOS.map(scenario => ({
  scenario, names: [...fixtureNames(scenario)], players: fixtureNames(scenario).length,
  ownerIndex: 0, observerIndex: 1, ...specifications[scenario],
}));

export function assertLibertaliaFixtureEnvironment(env: NodeJS.ProcessEnv): void {
  assert.equal(env.LIBERTALIA_UI_FIXTURES, 'true', 'Explicit LIBERTALIA_UI_FIXTURES=true required');
  assert.equal(env.ARCADE_INSECURE_LOCAL_DEV, 'true', 'Explicit insecure local development mode required');
  for (const [key, value] of Object.entries(env)) if (key.startsWith('SUPABASE_') || key === 'DATABASE_URL') {
    assert(!value?.trim(), `Fixture service refuses persistence environment: ${key}`);
  }
}

export function assertLibertaliaFixtureRoom(room: ServerRoom | undefined, scenario: string | undefined): asserts room is ServerRoom & { game: { id: 'libertalia'; state: LibertaliaServerState } } {
  assert(LIBERTALIA_UI_FIXTURE_SCENARIOS.includes(scenario as LibertaliaUiFixtureScenario), 'Unknown fixture');
  assert(room && room.gameId === 'libertalia' && room.game?.id === 'libertalia', 'Started Libertalia room required');
  const names = fixtureNames(scenario as LibertaliaUiFixtureScenario);
  assert.equal(room.players.size, names.length, 'Exact synthetic roster required');
  const roster = [...room.players.values()];
  assert(names.every(name => roster.some(p => p.displayName === name && p.isConnected && !p.hasLeft && p.socketId)), 'Exact connected synthetic names required');
  assert.equal(room.hostPlayerId, roster.find(p => p.displayName === names[0])?.playerId, 'Synthetic host mismatch');
}

function accept(result: LibertaliaResult): void { assert(result.ok, result.ok ? undefined : result.reason); }
function choose(state: LibertaliaServerState, optionId: string): void {
  const choice = state.pendingChoice;
  assert(choice, 'Canonical choice expected');
  accept(resolveLibertaliaChoice(state, choice.playerId, choice.id, [optionId], state.revision));
}
function takeLoot(state: LibertaliaServerState, kind: LibertaliaLoot, destination: LibertaliaLootToken[]): LibertaliaLootToken {
  const zones = [state.lootBag, ...state.lootDays].filter(zone => zone !== destination);
  const token = zones.flat().filter(t => t.kind === kind).sort((a, b) => a.id - b.id)[0];
  assert(token, `Canonical ${kind} token unavailable`);
  const source = zones.find(zone => zone.includes(token))!;
  source.splice(source.indexOf(token), 1); destination.push(token); return token;
}
function zoneCrew(state: LibertaliaServerState, id: string, ranks: number[], zone: 'ship' | 'graveyard'): void {
  const owner = state.players.get(id)!;
  for (const rank of ranks) { const index = owner.hand.indexOf(rank); assert(index >= 0); owner.hand.splice(index, 1); owner[zone].push(rank); }
}
function play(state: LibertaliaServerState, ranks: number[]): void {
  state.turnOrder.forEach((id, index) => accept(selectLibertaliaCrew(state, id, ranks[index]!, state.revision)));
}
function continueChoice(state: LibertaliaServerState): void {
  const pending = state.pendingChoice;
  assert(pending, 'Expected pending choice while advancing a checkpoint');
  choose(state, pending.options.find(o => o.label !== 'SABER')?.id ?? pending.options[0]!.id);
}
function finishDay(state: LibertaliaServerState): void {
  const day = state.day, voyage = state.voyage;
  for (let step = 0; state.status === 'playing' && state.day === day && state.voyage === voyage; step++) {
    assert(step < 200, 'Bounded fixture day failed to finish'); continueChoice(state);
  }
}

export function createLibertaliaUiFixture(roomCode: string, bases: Base[], scenario: LibertaliaUiFixtureScenario, startingRevision = 0): LibertaliaServerState {
  assert(LIBERTALIA_UI_FIXTURE_SCENARIOS.includes(scenario), 'Unknown fixture');
  assert.deepEqual(bases.map(p => p.displayName), [...fixtureNames(scenario)], 'Exact ordered synthetic names required');
  assert(Number.isSafeInteger(startingRevision) && startingRevision >= 0);
  const state = initLibertaliaGame(roomCode, bases, () => 0.42);
  state.revision = startingRevision;
  const six = scenario.startsWith('six-');
  const dealt = [...new Set([...specifications[scenario].ranks, ...Array.from({ length: 40 }, (_, i) => i + 1)])].slice(0, six ? 18 : 6);
  state.voyage = six ? 3 : 1; state.daysInVoyage = state.voyage + 3;
  state.undealtCrew = Array.from({ length: 40 }, (_, i) => i + 1).filter(rank => !dealt.includes(rank));
  for (const p of state.players.values()) { p.hand = [...dealt]; p.dealtRanks = [...dealt]; }
  state.lootBag.push(...state.lootDays.flat()); state.lootBag.sort((a, b) => a.id - b.id); state.lootDays = [];
  const perDay = bases.length === 2 ? 3 : bases.length;
  const kinds: LibertaliaLoot[] = ['map', 'barrel', 'chest', 'amulet', 'hook', 'relic'];
  for (let day = 0; day < state.daysInVoyage; day++) {
    const row: LibertaliaLootToken[] = []; state.lootDays.push(row);
    for (let i = 0; i < perDay; i++) {
      const kind = kinds[(day * perDay + i) % kinds.length]!;
      const index = state.lootBag.findIndex(t => t.kind === kind);
      row.push(state.lootBag.splice(index < 0 ? 0 : index, 1)[0]!);
    }
  }
  const [owner, second] = state.turnOrder;
  const p = state.players.get(owner!)!;
  state.reputationTrack = bases.length === 2
    ? ['inactive:0', 'inactive:1', owner!, second!, 'inactive:2', 'inactive:3']
    : [...state.turnOrder, ...Array.from({ length: 6 - bases.length }, (_, i) => `inactive:${i}`)];
  state.log = [{ id: ++state.logSeq, text: `Local canonical checkpoint: ${scenario}. This is not a naturally played match.` }];

  if (six) {
    state.day = 6;
    state.lootBag.push(...state.lootDays.slice(0, 5).flat()); state.lootDays = [[], [], [], [], [], state.lootDays[5]!];
    for (const [index, id] of state.turnOrder.entries()) {
      zoneCrew(state, id, [8, 10, 15, 20, 22, 24, 28, 32, 34, 35], 'ship');
      zoneCrew(state, id, [1, 2], 'graveyard');
      const player = state.players.get(id)!; player.score = 35 + index * 3; player.doubloons = 12 + index;
      takeLoot(state, 'map', player.loot); takeLoot(state, index % 2 ? 'relic' : 'barrel', player.loot);
    }
    validateLibertalia(state);
    if (scenario === 'six-results') {
      play(state, bases.map(() => 5));
      for (let steps = 0; state.status !== 'game_over'; steps++) { assert(steps < 300); continueChoice(state); }
      assert.equal(state.endReason, 'score');
    }
  } else if (scenario === 'empty-hand') {
    validateLibertalia(state);
    play(state, [1, 5]); choose(state, `hand:${owner}:25`); choose(state, `hand:${owner}:5`); finishDay(state);
    play(state, [2, 6]); choose(state, `ship:${owner}:25`); choose(state, `hand:${owner}:19`); finishDay(state);
    play(state, [6, 19]); finishDay(state);
    assert.equal(state.day, 4); assert.equal(state.phase, 'selection'); assert.equal(p.hand.length, 0); assert.equal(p.forfeited, false);
  } else {
    let rank = specifications[scenario].ranks[0]!;
    if (scenario === 'gunner-ship') { zoneCrew(state, owner!, [7], 'ship'); zoneCrew(state, second!, [8], 'ship'); }
    if (scenario === 'necromancer-relic') { zoneCrew(state, owner!, [7, 8], 'graveyard'); takeLoot(state, 'relic', p.loot); }
    if (scenario === 'hook-anchor') {
      state.day = 4; state.lootBag.push(...state.lootDays.slice(0, 3).flat()); state.lootDays = [[], [], [], state.lootDays[3]!];
      zoneCrew(state, owner!, [29], 'ship'); takeLoot(state, 'hook', p.loot); rank = 5;
    }
    if (scenario === 'night-nymph-clash') {
      for (const id of [owner!, second!]) { zoneCrew(state, id, [37, 24], 'ship'); state.players.get(id)!.doubloons = 10; }
      rank = 5;
    }
    if (scenario === 'saber-island') {
      const row = state.lootDays[0]!; state.lootBag.push(...row.splice(0)); takeLoot(state, 'saber', row); takeLoot(state, 'map', row); takeLoot(state, 'barrel', row);
    }
    validateLibertalia(state);
    play(state, bases.map((_, i) => i === 0 ? rank : scenario === 'midshipman-two' ? 6 : 5));
    if (scenario === 'saber-island') choose(state, state.pendingChoice!.options.find(o => o.label === 'SABER')!.id);
    assert.equal(state.pendingChoice?.kind, specifications[scenario].kind, scenario);
    assert.equal(state.pendingChoice?.playerId, owner, 'Fixture pending owner must be the host');
    if (scenario === 'night-nymph-clash') assert.deepEqual(state.nightNymphOwners, [owner, second]);
  }
  validateLibertalia(state);
  return state;
}

export function libertaliaFixtureProof(state: LibertaliaServerState) {
  return {
    revision: state.revision, status: state.status, phase: state.phase, voyage: state.voyage, day: state.day,
    players: [...state.players.values()].map(p => ({ playerId: p.playerId, displayName: p.displayName, hand: [...p.hand], ship: [...p.ship], graveyard: [...p.graveyard], loot: p.loot.map(t => ({ ...t })), score: p.score, doubloons: p.doubloons, forfeited: p.forfeited })),
    island: state.island.map(c => ({ ...c })), lootDays: state.lootDays.map(row => row.map(t => ({ ...t }))),
    choice: state.pendingChoice ? { id: state.pendingChoice.id, playerId: state.pendingChoice.playerId, kind: state.pendingChoice.kind, prompt: state.pendingChoice.prompt, optional: state.pendingChoice.optional, min: state.pendingChoice.min, max: state.pendingChoice.max, options: state.pendingChoice.options.map(o => ({ ...o })) } : null,
    nightNymphOwners: [...state.nightNymphOwners], winnerPlayerIds: [...state.winnerPlayerIds], endReason: state.endReason,
    canonicalLoot: 48, dealtPerPlayer: state.voyage * 6,
  };
}

export function libertaliaFixtureManifest() {
  return LIBERTALIA_UI_FIXTURE_MANIFEST.map(entry => ({
    ...entry,
    exampleCheckpoint: libertaliaFixtureProof(createLibertaliaUiFixture('FIXTURE', entry.names.map((displayName, i) => ({ playerId: `fixture-seat-${i}`, displayName })), entry.scenario)),
    proofUse: 'Fixture oracle only. Browser actions must still use the acting owner projection; private arrays are not public UI data.',
  }));
}
