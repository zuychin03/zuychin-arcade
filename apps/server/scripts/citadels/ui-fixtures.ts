import assert from 'node:assert/strict';
import type { CitadelsDistrictCard, CitadelsRole } from '@zuychin-arcade/types';
import {
  chooseCharacter, chooseIncome, endCitadelsTurn, initCitadelsGame, validateCitadelsState,
  type CitadelsEngineResult, type CitadelsServerState,
} from '../../src/game/citadels/engine.js';

export const CITADELS_UI_FIXTURE_SCENARIOS = [
  'magician_redraw', 'warlord_targets', 'district_abilities',
  'observatory_draw', 'library_draw', 'final_scoring', 'killed_merchant',
] as const;
export type CitadelsUiFixtureScenario = typeof CITADELS_UI_FIXTURE_SCENARIOS[number];
export const CITADELS_SEVEN_LAYOUT_SCENARIO = 'seven_seat_layout' as const;
export const CITADELS_SEVEN_LAYOUT_NAMES = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth', 'Fixture Fifth', 'Fixture Sixth', 'ABCDEFGHIJKLMNOPQRST'] as const;

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function accepted(result: CitadelsEngineResult): void {
  assert(result.ok, result.ok ? '' : result.reason);
}

function prepareTurn(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  roles: CitadelsRole[],
): CitadelsServerState {
  for (let seed = 1; seed <= 512; seed += 1) {
    const state = initCitadelsGame(roomCode, players, seeded(seed));
    if (!roles.every(role => state.availableRoles.includes(role))) continue;
    while (state.phase === 'drafting') {
      const seat = players.findIndex(player => player.playerId === state.draftPlayerId);
      accepted(chooseCharacter(state, players[seat]!.playerId, roles[seat]!, state.revision));
    }
    while (state.activePlayerId !== players[0]!.playerId) {
      assert.equal(state.phase, 'choose_income');
      accepted(chooseIncome(state, state.activePlayerId!, 'gold', state.revision));
      accepted(endCitadelsTurn(state, state.activePlayerId!, state.revision));
    }
    return state;
  }
  throw new Error('Unable to prepare the requested legal character draft');
}

export function createCitadelsUiFixture(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  scenario: CitadelsUiFixtureScenario,
  revision: number,
): CitadelsServerState {
  assert.equal(process.env.CITADELS_UI_FIXTURES, 'true', 'Explicit isolated fixture mode is required');
  assert(CITADELS_UI_FIXTURE_SCENARIOS.includes(scenario));
  assert.equal(players.length, 4, 'Citadels UI checkpoints require four synthetic seats');
  assert(Number.isSafeInteger(revision) && revision >= 0);
  const roles: CitadelsRole[] = scenario === 'killed_merchant'
    ? ['assassin', 'merchant', 'king', 'bishop']
    : scenario === 'warlord_targets' || scenario === 'final_scoring'
      ? ['warlord', 'bishop', 'king', 'merchant']
    : scenario === 'district_abilities'
      ? ['merchant', 'king', 'bishop', 'warlord']
      : scenario === 'observatory_draw' || scenario === 'library_draw'
        ? ['bishop', 'king', 'merchant', 'warlord']
        : ['magician', 'king', 'bishop', 'warlord'];
  const state = prepareTurn(roomCode, players, roles);
  const ids = players.map(player => player.playerId);
  const pool = [...state.districtDeck, ...[...state.players.values()].flatMap(player => player.hand)];
  assert.equal(pool.length, 68);
  state.districtDeck = [];
  for (const player of state.players.values()) player.hand = [];
  const take = (templateId: string): CitadelsDistrictCard => {
    const index = pool.findIndex(card => card.templateId === templateId);
    assert(index >= 0, `Canonical district ${templateId} must be available`);
    return pool.splice(index, 1)[0]!;
  };
  const give = (seat: number, zone: 'city' | 'hand', templates: string[]) => {
    state.players.get(ids[seat]!)![zone].push(...templates.map(take));
  };
  const host = state.players.get(ids[0]!)!;
  host.gold = 12;

  if (scenario === 'killed_merchant') {
    give(0, 'hand', ['temple']);
    give(1, 'city', ['market']);
  } else if (scenario === 'magician_redraw') {
    give(0, 'hand', ['manor', 'temple', 'tavern', 'haunted_quarter', 'imperial_treasury', 'school_of_magic']);
    give(0, 'city', ['library']);
  } else if (scenario === 'warlord_targets') {
    give(0, 'city', ['watchtower', 'manor']);
    give(1, 'city', ['temple', 'church']);
    give(2, 'city', ['great_wall', 'keep', 'castle']);
    give(3, 'city', ['tavern', 'market', 'trading_post', 'docks', 'harbor', 'town_hall', 'prison']);
    state.firstCompletedPlayerId = ids[3]!;
    state.completionOrder = [ids[3]!];
    give(0, 'hand', ['barracks']);
  } else if (scenario === 'district_abilities') {
    give(0, 'city', ['laboratory', 'smithy', 'school_of_magic', 'factory']);
    give(0, 'hand', ['haunted_quarter', 'dragon_gate', 'map_room', 'gold_mine', 'imperial_treasury']);
  } else if (scenario === 'observatory_draw' || scenario === 'library_draw') {
    give(0, 'city', scenario === 'library_draw' ? ['observatory', 'library'] : ['observatory']);
    give(0, 'hand', ['temple', 'haunted_quarter']);
  } else {
    give(0, 'city', ['manor', 'temple', 'tavern', 'watchtower', 'dragon_gate', 'imperial_treasury']);
    give(0, 'hand', ['map_room', 'castle']);
    give(1, 'city', ['church', 'monastery']);
    give(2, 'city', ['palace', 'market']);
    give(3, 'city', ['trading_post', 'harbor']);
  }
  for (const id of ids.slice(1)) state.players.get(id)!.hand = pool.splice(0, 4);
  state.districtDeck = pool;
  if (scenario === 'magician_redraw' || scenario === 'warlord_targets' || scenario === 'final_scoring') {
    accepted(chooseIncome(state, ids[0]!, 'gold', state.revision));
  } else if (scenario === 'observatory_draw') {
    accepted(chooseIncome(state, ids[0]!, 'cards', state.revision));
  }
  state.revision = revision;
  state.log = [{ id: 1, text: `Canonical UI checkpoint: ${scenario}.` }];
  state.nextLogId = 2;
  const cards = [...state.districtDeck, ...state.pendingDraw,
    ...[...state.players.values()].flatMap(player => [...player.hand, ...player.city])];
  assert.equal(cards.length, 68);
  assert.equal(new Set(cards.map(card => card.id)).size, 68);
  validateCitadelsState(state);
  return state;
}

export function createCitadelsSevenSeatLayout(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  revision: number,
): CitadelsServerState {
  assert.equal(process.env.CITADELS_UI_FIXTURES, 'true', 'Explicit isolated fixture mode is required');
  assert.equal(process.env.CITADELS_SEVEN_SEAT_LAYOUT, 'true', 'Separate seven-seat opt-in is required');
  assert.equal(players.length, 7, 'Seven-seat layout requires seven synthetic seats');
  assert(Number.isSafeInteger(revision) && revision >= 0);
  const state = prepareTurn(roomCode, players, ['magician', 'king', 'bishop', 'merchant', 'warlord', 'architect', 'thief']);
  const pool = [...state.districtDeck, ...[...state.players.values()].flatMap(player => player.hand)];
  assert.equal(pool.length, 68);
  state.districtDeck = [];
  for (const player of state.players.values()) player.hand = [];
  const take = (templateId: string) => {
    const index = pool.findIndex(card => card.templateId === templateId);
    assert(index >= 0, `Canonical district ${templateId} must be available`);
    return pool.splice(index, 1)[0]!;
  };
  const cities = [
    ['manor', 'temple', 'tavern', 'watchtower', 'haunted_quarter', 'school_of_magic'],
    ['castle', 'church'], ['palace', 'monastery'], ['market', 'trading_post'],
    ['prison', 'barracks'], ['docks', 'harbor'], ['great_wall', 'imperial_treasury'],
  ];
  players.forEach((player, index) => { state.players.get(player.playerId)!.city = cities[index]!.map(take); });
  const host = state.players.get(players[0]!.playerId)!;
  host.hand = ['laboratory', 'smithy', 'map_room', 'dragon_gate', 'gold_mine', 'library'].map(take);
  host.gold = 12;
  for (const player of players.slice(1)) state.players.get(player.playerId)!.hand = pool.splice(0, 4);
  state.districtDeck = pool;
  accepted(chooseIncome(state, players[0]!.playerId, 'gold', state.revision));
  state.revision = revision;
  state.log = [{ id: 1, text: 'Canonical layout checkpoint: seven_seat_layout. Not a natural seven-player game.' }];
  state.nextLogId = 2;
  assert.equal(state.districtDeck.length, 20);
  validateCitadelsState(state);
  return state;
}
