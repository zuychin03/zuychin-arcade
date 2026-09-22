import assert from 'node:assert/strict';
import type { SkullKingCard, SkullKingPlayedCard } from '@zuychin-arcade/types';
import { createSkullKingDeck } from '../../src/game/skull-king/deck.js';
import {
  initSkullKingGame, validateSkullKingState, type SkullKingServerState,
} from '../../src/game/skull-king/engine.js';

export const SKULL_UI_FIXTURE_SCENARIOS = [
  'tigress_follow', 'character_lead', 'royal_bonus', 'eight_final_tie', 'royal_terminal',
] as const;
export type SkullUiFixtureScenario = typeof SKULL_UI_FIXTURE_SCENARIOS[number];

export function createSkullKingUiFixture(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  scenario: SkullUiFixtureScenario,
  revision: number,
): SkullKingServerState {
  assert.equal(process.env.SKULL_KING_UI_FIXTURES, 'true', 'Explicit isolated fixture mode is required');
  assert(SKULL_UI_FIXTURE_SCENARIOS.includes(scenario));
  assert.equal(players.length, scenario === 'eight_final_tie' ? 8 : 4, 'Fixture seat count must match its scenario');
  assert(Number.isSafeInteger(revision) && revision >= 0);
  const state = initSkullKingGame(roomCode, players, () => 0.42);
  const ids = players.map((player) => player.playerId);
  const pool = createSkullKingDeck();
  const take = (id: string): SkullKingCard => {
    const index = pool.findIndex((card) => card.id === id);
    assert(index >= 0, `Canonical fixture card ${id} is available exactly once`);
    return pool.splice(index, 1)[0]!;
  };
  const hand = (seat: number, cardIds: string[]) => {
    state.players.get(ids[seat]!)!.hand = cardIds.map(take);
  };
  const played = (seat: number, id: string): SkullKingPlayedCard => ({
    ...take(id), playerId: ids[seat]!, ...(id === 'tigress' ? { tigressMode: 'escape' as const } : {}),
  });
  for (const player of state.players.values()) {
    player.hand = [];
    player.bid = 0;
  }
  state.revision = state.biddingRevision = revision;
  state.phase = 'trick_play';
  state.currentPlayerId = ids[0]!;
  state.log = [{ id: 1, text: `Canonical UI checkpoint: ${scenario}.` }];
  state.nextLogId = 2;

  if (scenario === 'tigress_follow') {
    state.roundNumber = state.cardsPerPlayer = 2;
    state.dealerIndex = 0;
    state.leaderId = ids[1]!;
    state.currentTrick = [played(1, 'escape-1'), played(2, 'green-5'), played(3, 'pirate-1')];
    hand(0, ['green-1', 'tigress']);
    hand(1, ['yellow-14']);
    hand(2, ['black-14']);
    hand(3, ['green-2']);
  } else if (scenario === 'character_lead') {
    state.roundNumber = state.cardsPerPlayer = 2;
    state.dealerIndex = 1;
    state.leaderId = ids[2]!;
    state.currentTrick = [played(2, 'pirate-1'), played(3, 'green-5')];
    hand(0, ['green-1', 'yellow-14']);
    hand(1, ['escape-1', 'black-1']);
    hand(2, ['green-2']);
    hand(3, ['purple-1']);
  } else if (scenario === 'royal_bonus' || scenario === 'royal_terminal') {
    state.dealerIndex = 0;
    state.leaderId = ids[1]!;
    state.currentTrick = [played(1, 'yellow-14'), played(2, 'pirate-1'), played(3, 'skull-king')];
    hand(0, ['mermaid-1']);
    state.players.get(ids[0]!)!.bid = 1;
    if (scenario === 'royal_terminal') {
      state.roundNumber = state.cardsPerPlayer = state.trickNumber = 10;
      state.players.get(ids[0]!)!.totalScore = 200;
      state.players.get(ids[1]!)!.bid = 9;
      state.players.get(ids[1]!)!.tricksWon = 9;
    }
  } else {
    state.roundNumber = 10;
    state.cardsPerPlayer = state.trickNumber = 8;
    state.dealerIndex = 0;
    state.leaderId = ids[1]!;
    state.currentTrick = [
      played(1, 'escape-1'), played(2, 'escape-2'), played(3, 'escape-3'), played(4, 'escape-4'),
      played(5, 'escape-5'), played(6, 'tigress'), played(7, 'green-1'),
    ];
    hand(0, ['black-14']);
    state.players.get(ids[0]!)!.bid = 1;
    state.players.get(ids[0]!)!.totalScore = 100;
    state.players.get(ids[1]!)!.bid = 7;
    state.players.get(ids[1]!)!.tricksWon = 7;
  }

  const exposed = [...state.players.values()].flatMap((player) => player.hand).concat(state.currentTrick);
  assert.equal(new Set(exposed.map((card) => card.id)).size, exposed.length);
  assert.equal(exposed.length + pool.length, 70, 'Fixture uses only distinct cards from the complete base deck');
  validateSkullKingState(state);
  return state;
}
