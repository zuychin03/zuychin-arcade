import assert from 'node:assert/strict';
import type { KingOfTokyoPowerCardId } from '@zuychin-arcade/types';
import {
  buyPowerCard, initKingOfTokyoGame, prepareDiceResolution, resolveDiceResults,
  validateKingOfTokyoState, type KingOfTokyoServerState,
} from '../../src/game/king-of-tokyo/engine.js';
import { toKingOfTokyoPublicState } from '../../src/game/king-of-tokyo/publicState.js';

export const KOT_UI_FIXTURE_SCENARIOS = ['bay_occupied', 'mimic_initial', 'mimic_retarget', 'dfa', 'lab', 'opportunist', 'hearts', 'defence', 'rapid_regeneration', 'card_headings'] as const;
export type KotUiFixtureScenario = typeof KOT_UI_FIXTURE_SCENARIOS[number];

function take(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId) {
  const index = state.deck.findIndex((card) => card.cardId === cardId);
  if (index >= 0) return state.deck.splice(index, 1)[0]!;
  const marketIndex = state.market.findIndex((card) => card?.cardId === cardId);
  assert(marketIndex >= 0, `Canonical fixture card ${cardId} exists`);
  const card = state.market[marketIndex]!;
  state.market[marketIndex] = state.deck.shift() ?? null;
  return card;
}

function give(state: KingOfTokyoServerState, playerId: string, cardId: KingOfTokyoPowerCardId) {
  const card = { ...take(state, cardId), counters: 0, mimicTargetInstanceId: null as string | null };
  state.players.get(playerId)!.powerCards.push(card);
  return card;
}

function expose(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId, slot = 0) {
  const card = take(state, cardId);
  if (state.market[slot]) state.deck.push(state.market[slot]);
  state.market[slot] = card;
}

export function createKingOfTokyoUiFixture(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  scenario: KotUiFixtureScenario,
  revision: number,
): KingOfTokyoServerState {
  assert.equal(process.env.KING_OF_TOKYO_UI_FIXTURES, 'true', 'Explicit isolated fixture mode is required');
  assert(players.length === 5 || players.length === 6, 'These canonical fixtures use five or six synthetic seats');
  assert(KOT_UI_FIXTURE_SCENARIOS.includes(scenario));
  assert(Number.isSafeInteger(revision) && revision >= 0);
  const [host, second, third] = players.map((player) => player.playerId);
  const state = initKingOfTokyoGame(roomCode, players, () => 0.42, host);
  state.startingRevision = state.revision = revision;
  state.players.get(host)!.energy = 20;
  if (scenario === 'bay_occupied') {
    state.players.get(second)!.tokyoZone = 'tokyo_city';
    state.players.get(third)!.tokyoZone = 'tokyo_bay';
  } else if (scenario === 'mimic_initial' || scenario === 'mimic_retarget') {
    const ownTarget = give(state, host, 'acid_attack');
    if (scenario === 'mimic_initial') {
      expose(state, 'mimic');
      state.phase = 'buying_cards';
      assert(buyPowerCard(state, host, 0, state.revision, () => 0.42).ok);
      assert(toKingOfTokyoPublicState(state, host).pendingMimicTargetPlayerId === host);
    } else {
      const otherTarget = give(state, second, 'giant_brain');
      give(state, host, 'mimic').mimicTargetInstanceId = otherTarget.instanceId;
      state.maxRolls = 4;
    }
    assert(state.players.get(host)!.powerCards.some((card) => card.instanceId === ownTarget.instanceId));
  } else if (scenario === 'dfa') {
    state.players.get(second)!.tokyoZone = 'tokyo_city';
    state.players.get(third)!.tokyoZone = 'tokyo_bay';
    state.phase = 'buying_cards';
    expose(state, 'drop_from_high_altitude');
  } else if (scenario === 'lab') {
    give(state, host, 'made_in_a_lab');
    give(state, host, 'regeneration');
    state.players.get(host)!.health = 6;
    state.phase = 'buying_cards';
    state.labOffersRemaining = 1;
    const card = take(state, 'heal');
    state.deck.unshift(card);
    assert(toKingOfTokyoPublicState(state, host).labCard?.instanceId === card.instanceId);
    assert(toKingOfTokyoPublicState(state, second).labCard === null);
  } else if (scenario === 'opportunist') {
    give(state, host, 'opportunist');
    state.currentTurnIndex = 1;
    state.players.get(second)!.energy = 20;
    state.phase = 'buying_cards';
    expose(state, 'acid_attack');
    const offer = take(state, 'complete_destruction');
    state.deck.unshift(offer);
    assert(buyPowerCard(state, second, 0, state.revision, () => 0.42).ok);
    assert.equal(state.phase, 'awaiting_opportunist');
    assert.equal(state.pendingOpportunist?.cardInstanceId, offer.instanceId);
    assert.equal(state.pendingOpportunist?.playerIds[0], host);
  } else if (scenario === 'card_headings') {
    state.phase = 'buying_cards';
    const headings = ['complete_destruction', 'apartment_building', 'regeneration'] as const;
    headings.forEach((cardId, slot) => expose(state, cardId, slot));
    assert.deepEqual(state.market.map((card) => card?.cardId), headings);
  } else if (scenario === 'hearts') {
    give(state, host, 'healing_ray');
    state.players.get(host)!.health = 8;
    state.players.get(host)!.poisonTokens = 1;
    state.players.get(second)!.health = 8;
    state.players.get(second)!.energy = 4;
    state.dice = ['heart', 'heart', 'heart', 1, 2, 3].map((face) => ({ face: face as 'heart' | 1 | 2 | 3, kept: false }));
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    assert(prepareDiceResolution(state, host, state.revision).ok);
    assert(resolveDiceResults(state, host, { resolutionOrder: ['hearts', 'points', 'energy', 'smash'] }, state.revision, () => 0).ok);
    assert.equal(state.phase, 'awaiting_heart_allocation');
  } else {
    if (scenario === 'rapid_regeneration') {
      give(state, host, 'rapid_healing');
      give(state, host, 'regeneration');
      state.players.get(host)!.health = 3;
      state.players.get(host)!.energy = 6;
    } else {
      give(state, host, 'camouflage');
      give(state, host, 'stretchy');
    }
    state.players.get(host)!.tokyoZone = 'tokyo_city';
    state.currentTurnIndex = 1;
    state.dice = ['smash', 'smash', 1, 2, 3, 'energy'].map((face) => ({ face: face as 'smash' | 'energy' | 1 | 2 | 3, kept: false }));
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    assert(prepareDiceResolution(state, second, state.revision).ok);
    assert(resolveDiceResults(state, second, { resolutionOrder: ['smash', 'points', 'energy', 'hearts'] }, state.revision, () => 0).ok);
    assert.equal(state.pendingDefenseDecision?.playerId, host);
  }
  validateKingOfTokyoState(state);
  return state;
}
