import type {
  KingOfTokyoDiceResolutionCategory,
  KingOfTokyoDiceResolutionPlan,
  KingOfTokyoDieFace,
  KingOfTokyoHeartAllocation,
  KingOfTokyoOwnedPowerCard,
  KingOfTokyoPowerCardId,
} from '@zuychin-arcade/types';
import {
  KING_OF_TOKYO_DECK_SIZE,
  KING_OF_TOKYO_POWER_CARD_BY_ID,
  KING_OF_TOKYO_POWER_CARDS,
} from '@zuychin-arcade/types';
import {
  buyLabCard,
  buyOwnedPowerCard,
  buyPowerCard,
  chooseDeathFromAboveTarget,
  decideDefense,
  decideFreezeTime,
  decideHeartAllocation,
  decideOpportunist,
  decidePsychicProbe,
  decideTokyoYield,
  endTurn,
  forfeitPlayer,
  forfeitPlayers,
  initKingOfTokyoGame,
  prepareDiceResolution,
  resolveAbsentDecision,
  resolveDiceResults,
  resolveEndTurnEffect,
  rollDice,
  rollForFirstPlayer,
  sellOwnedPowerCard,
  setKeptDice,
  sweepPowerCards,
  updatePreferences,
  usePowerCard,
  validateKingOfTokyoState,
  type EngineResult,
  type KingOfTokyoServerState,
  type RandomSource,
} from '../../src/game/king-of-tokyo/engine.js';
import { toKingOfTokyoPublicState } from '../../src/game/king-of-tokyo/publicState.js';

let assertions = 0;

function assert(condition: boolean, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error('ASSERT FAILED: ' + message);
}

function seededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function players(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    playerId: 'p' + index,
    displayName: 'Monster ' + (index + 1),
  }));
}

function currentId(state: KingOfTokyoServerState): string {
  return state.turnOrder[state.currentTurnIndex];
}

function snapshot(state: KingOfTokyoServerState): string {
  return JSON.stringify({
    ...state,
    players: state.turnOrder.map((id) => [id, state.players.get(id)]),
    startRolls: [...state.startRolls],
    pendingTokyoDamage: [...state.pendingTokyoDamage],
    usedThisTurn: [...state.usedThisTurn],
    wingsProtected: [...state.wingsProtected],
  });
}

function accept(state: KingOfTokyoServerState, label: string, action: () => EngineResult): void {
  const beforeRevision = state.revision;
  const result = action();
  assert(result.ok, label + (result.ok ? '' : ': ' + result.reason));
  assert(state.revision === beforeRevision + 1, label + ' must increment revision exactly once');
  validateKingOfTokyoState(state);
}

function rejectUnchanged(state: KingOfTokyoServerState, label: string, action: () => EngineResult): void {
  const before = snapshot(state);
  const beforeRevision = state.revision;
  const result = action();
  assert(!result.ok, label + ' must be rejected');
  assert(state.revision === beforeRevision, label + ' must not increment revision');
  assert(snapshot(state) === before, label + ' must not mutate state');
}

function assertThrows(action: () => unknown, message: string): void {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function completeRollOff(state: KingOfTokyoServerState, winnerId = state.turnOrder[0]): void {
  for (const id of [...state.startingRollContenders]) {
    const rng = id === winnerId ? () => 0.75 : () => 0;
    accept(state, 'first-player roll for ' + id, () =>
      rollForFirstPlayer(state, id, rng, state.revision, state.rollOffRound));
  }
  assert(state.phase === 'awaiting_roll', 'roll-off must start the winning monster turn');
  assert(currentId(state) === winnerId, 'the greatest Smash roll must start');
  assert(state.startingRollContenders.length === 0, 'settled roll-off must clear contenders');
}

function setFaces(state: KingOfTokyoServerState, faces: KingOfTokyoDieFace[]): void {
  state.dice = faces.map((face) => ({ face, kept: false }));
  state.rollCount = 1;
  state.phase = 'choosing_dice';
  state.pendingPsychicProbes = [];
  state.pendingDiceResolution = null;
  state.pendingHeartAllocation = null;
  state.pendingTokyoDecisions = [];
  state.pendingTokyoDamage.clear();
}

function plan(overrides: Partial<KingOfTokyoDiceResolutionPlan> = {}): KingOfTokyoDiceResolutionPlan {
  return {
    resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    ...overrides,
  };
}

function heartAllocation(
  overrides: Partial<KingOfTokyoHeartAllocation> = {},
): KingOfTokyoHeartAllocation {
  return {
    healingRayUses: [],
    poisonTokensToRemove: 0,
    shrinkTokensToRemove: 0,
    ...overrides,
  };
}

function allocateHearts(
  state: KingOfTokyoServerState,
  allocation: KingOfTokyoHeartAllocation = heartAllocation(),
  label = 'allocate Hearts',
  rng: RandomSource = () => 0,
): void {
  const actorId = currentId(state);
  assert(state.phase === 'awaiting_heart_allocation', label + ' requires a pending Heart window');
  assert(state.pendingHeartAllocation?.playerId === actorId, label + ' must belong to the active monster');
  accept(state, label, () =>
    decideHeartAllocation(state, actorId, allocation, state.revision, rng));
}

function prepareAndResolve(
  state: KingOfTokyoServerState,
  resolutionPlan = plan(),
  rng: RandomSource = () => 0,
): void {
  const actorId = currentId(state);
  accept(state, 'prepare final dice', () => prepareDiceResolution(state, actorId, state.revision));
  while (state.phase === 'awaiting_psychic_probe') {
    const responderId = state.pendingPsychicProbes[0].playerId;
    accept(state, 'pass Psychic Probe', () =>
      decidePsychicProbe(state, responderId, null, rng, state.revision));
  }
  accept(state, 'resolve final dice', () =>
    resolveDiceResults(state, actorId, resolutionPlan, state.revision, rng));
}

function takeCard(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId) {
  const marketIndex = state.market.findIndex((card) => card?.cardId === cardId);
  if (marketIndex >= 0) {
    const card = state.market[marketIndex]!;
    state.market[marketIndex] = null;
    return card;
  }
  const deckIndex = state.deck.findIndex((card) => card.cardId === cardId);
  if (deckIndex >= 0) return state.deck.splice(deckIndex, 1)[0];
  const discardIndex = state.discardPile.findIndex((card) => card.cardId === cardId);
  if (discardIndex >= 0) return state.discardPile.splice(discardIndex, 1)[0];
  throw new Error('Card unavailable in fixture: ' + cardId);
}

function giveKeepCard(
  state: KingOfTokyoServerState,
  playerId: string,
  cardId: KingOfTokyoPowerCardId,
): KingOfTokyoOwnedPowerCard {
  const definition = KING_OF_TOKYO_POWER_CARD_BY_ID[cardId];
  assert(definition.kind === 'keep', cardId + ' must be a Keep card');
  const card = takeCard(state, cardId);
  const owned = {
    ...card,
    counters: cardId === 'battery_monster' ? 6 : cardId === 'smoke_cloud' ? 3 : 0,
    mimicTargetInstanceId: null,
  };
  const player = state.players.get(playerId)!;
  player.powerCards.push(owned);
  if (cardId === 'even_bigger') {
    player.maxHealth += 2;
    player.health = Math.min(player.health + 2, player.maxHealth);
  }
  return owned;
}

function exposeCard(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId, slot = 0): void {
  const marketIndex = state.market.findIndex((card) => card?.cardId === cardId);
  if (marketIndex >= 0) {
    [state.market[slot], state.market[marketIndex]] = [state.market[marketIndex], state.market[slot]];
    return;
  }
  const deckIndex = state.deck.findIndex((card) => card.cardId === cardId);
  if (deckIndex >= 0) {
    const previous = state.market[slot];
    state.market[slot] = state.deck[deckIndex];
    if (previous) state.deck[deckIndex] = previous;
    else state.deck.splice(deckIndex, 1);
    return;
  }
  const discardIndex = state.discardPile.findIndex((card) => card.cardId === cardId);
  assert(discardIndex >= 0, 'card ' + cardId + ' must be available');
  const previous = state.market[slot];
  state.market[slot] = state.discardPile[discardIndex];
  if (previous) state.discardPile[discardIndex] = previous;
  else state.discardPile.splice(discardIndex, 1);
}

function putCardOnDeckTop(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId): void {
  const deckIndex = state.deck.findIndex((card) => card.cardId === cardId);
  if (deckIndex >= 0) {
    [state.deck[0], state.deck[deckIndex]] = [state.deck[deckIndex], state.deck[0]];
    return;
  }
  const marketIndex = state.market.findIndex((card) => card?.cardId === cardId);
  assert(marketIndex >= 0, 'deck-top fixture card must be available');
  [state.deck[0], state.market[marketIndex]] = [state.market[marketIndex]!, state.deck[0]];
}

function logGrammarScenarios(): void {
  const state = initKingOfTokyoGame('LOG-GRAMMAR', players(2), seededRandom(17), 'p0');
  accept(state, 'roll six dice for log copy', () => rollDice(state, 'p0', () => 0, state.revision));
  assert(state.log.at(-1)?.text === 'Monster 1 rolled 6 dice (1/3).', 'multiple dice must retain plural copy');
  accept(state, 'keep five dice for log copy', () => setKeptDice(state, 'p0', [0, 1, 2, 3, 4], state.revision));
  accept(state, 'reroll one die for log copy', () => rollDice(state, 'p0', () => 0, state.revision));
  assert(state.log.at(-1)?.text === 'Monster 1 rolled 1 die (2/3).', 'one die must use singular copy');

  for (const points of [1, 4]) {
    const scoring = initKingOfTokyoGame('LOG-POINTS', players(2), seededRandom(18), 'p0');
    setFaces(scoring, points === 1 ? [1, 1, 1, 2, 2, 3] : [1, 1, 1, 1, 1, 1]);
    prepareAndResolve(scoring);
    const expected = `Monster 1 gained ${points} victory ${points === 1 ? 'point' : 'points'} from the final roll.`;
    assert(scoring.log.some((entry) => entry.text === expected), 'number scoring must use matching point grammar');
  }
}

function setupAndDiceScenarios(): void {
  assertThrows(() => initKingOfTokyoGame('ONE', players(1)), 'one-player setup must fail');
  assertThrows(() => initKingOfTokyoGame('SEVEN', players(7)), 'seven-player setup must fail');
  assertThrows(
    () => initKingOfTokyoGame('DUP', [players(2)[0], players(2)[0]]),
    'duplicate player IDs must fail',
  );

  const setup = initKingOfTokyoGame('SETUP', players(6), seededRandom(1));
  assert(setup.gameId === 'king_of_tokyo', 'server state must include the game ID');
  assert(setup.market.filter(Boolean).length === 3, 'setup must reveal three market cards');
  assert(setup.deck.length === 63, 'setup must retain 63 cards in the draw deck');
  const instanceIds = [...setup.deck, ...setup.market.filter((card) => card !== null)]
    .map((card) => card!.instanceId);
  assert(instanceIds.length === KING_OF_TOKYO_DECK_SIZE, 'setup must contain the full 66-card deck');
  assert(new Set(instanceIds).size === instanceIds.length, 'every card instance must be unique');

  const concurrent = initKingOfTokyoGame('CONCURRENT-ROLL-OFF', players(6), seededRandom(2001));
  const sharedRevision = concurrent.revision;
  const sharedRound = concurrent.rollOffRound;
  for (const playerId of concurrent.turnOrder) {
    accept(concurrent, `${playerId} shared-revision roll`, () => rollForFirstPlayer(
      concurrent,
      playerId,
      playerId === 'p0' ? () => 0.75 : () => 0,
      sharedRevision,
      sharedRound,
    ));
  }
  assert(
    concurrent.phase === 'awaiting_roll' && currentId(concurrent) === 'p0' &&
      concurrent.revision === sharedRevision + 6,
    'all six players must submit once from one shared roll-off revision without racing each other stale',
  );

  const eliminatedRoll = initKingOfTokyoGame('ELIMINATED-ROLL-OFF', players(2), seededRandom(2002));
  Object.assign(eliminatedRoll.players.get('p1')!, { health: 0, eliminated: true });
  rejectUnchanged(eliminatedRoll, 'eliminated roll-off player', () => rollForFirstPlayer(
    eliminatedRoll,
    'p1',
    () => 0.75,
    eliminatedRoll.revision,
    eliminatedRoll.rollOffRound,
  ));

  const tie = initKingOfTokyoGame('TIE', players(3), seededRandom(2));
  const roundOneRevision = tie.revision;
  const roundOne = tie.rollOffRound;
  accept(tie, 'p0 concurrent round-one roll', () =>
    rollForFirstPlayer(tie, 'p0', () => 0.75, roundOneRevision, roundOne));
  let duplicateRollRngCalls = 0;
  rejectUnchanged(tie, 'duplicate p0 round-one roll', () =>
    rollForFirstPlayer(tie, 'p0', () => {
      duplicateRollRngCalls += 1;
      return 0;
    }, roundOneRevision, roundOne));
  assert(duplicateRollRngCalls === 0, 'duplicate roll-off submission must not consume randomness');
  rejectUnchanged(tie, 'future-revision round-one roll', () =>
    rollForFirstPlayer(tie, 'p1', () => 0.75, tie.revision + 1, roundOne));
  accept(tie, 'p1 concurrent round-one roll', () =>
    rollForFirstPlayer(tie, 'p1', () => 0.75, roundOneRevision, roundOne));
  accept(tie, 'p2 concurrent losing roll', () =>
    rollForFirstPlayer(tie, 'p2', () => 0, roundOneRevision, roundOne));
  assert(
    tie.startingRollContenders.join(',') === 'p0,p1' &&
      tie.startRolls.get('p0') === null &&
      tie.startRolls.get('p1') === null &&
      tie.rollOffRound === roundOne + 1,
    'only tied leaders must reroll',
  );
  rejectUnchanged(tie, 'delayed packet from completed roll-off round', () =>
    rollForFirstPlayer(tie, 'p0', () => 0, roundOneRevision, roundOne));
  rejectUnchanged(tie, 'non-contender roll-off player in tie-break', () =>
    rollForFirstPlayer(tie, 'p2', () => 0.75, tie.revision, tie.rollOffRound));
  rejectUnchanged(tie, 'invalid zero roll-off round', () =>
    rollForFirstPlayer(tie, 'p0', () => 0.75, tie.revision, 0));
  const roundTwoRevision = tie.revision;
  const roundTwo = tie.rollOffRound;
  accept(tie, 'p0 concurrent tie-break roll', () =>
    rollForFirstPlayer(tie, 'p0', () => 0.75, roundTwoRevision, roundTwo));
  rejectUnchanged(tie, 'duplicate p0 tie-break roll', () =>
    rollForFirstPlayer(tie, 'p0', () => 0, roundTwoRevision, roundTwo));
  accept(tie, 'p1 concurrent tie-break roll', () =>
    rollForFirstPlayer(tie, 'p1', () => 0, roundTwoRevision, roundTwo));
  assert(tie.phase === 'awaiting_roll' && currentId(tie) === 'p0', 'unique tie-break winner must start');

  const rematch = initKingOfTokyoGame('REMATCH', players(4), seededRandom(3), 'p2');
  assert(rematch.phase === 'awaiting_roll' && currentId(rematch) === 'p2', 'prior winner must start a rematch');
  assertThrows(
    () => initKingOfTokyoGame('BAD-STARTER', players(2), seededRandom(4), 'missing'),
    'unknown rematch starter must fail',
  );

  const reroll = initKingOfTokyoGame('REROLL', players(2), seededRandom(5), 'p0');
  const firstFaces = [0.7, 0.9, 0.1, 0.3, 0.5, 0.7];
  let firstIndex = 0;
  accept(reroll, 'initial six-die roll', () =>
    rollDice(reroll, 'p0', () => firstFaces[firstIndex++], reroll.revision));
  accept(reroll, 'keep first die', () => setKeptDice(reroll, 'p0', [0], reroll.revision));
  accept(reroll, 'release a previously kept die', () => setKeptDice(reroll, 'p0', [], reroll.revision));
  accept(reroll, 'reroll all dice', () => rollDice(reroll, 'p0', () => 0, reroll.revision));
  assert(reroll.dice.every((die) => die.face === 1), 'released dice must be rerolled');

  const scoring = initKingOfTokyoGame('SCORING', players(2), seededRandom(6), 'p0');
  scoring.players.get('p0')!.health = 8;
  setFaces(scoring, [1, 1, 1, 1, 'energy', 'heart']);
  prepareAndResolve(scoring);
  const scorer = scoring.players.get('p0')!;
  assert(scorer.victoryPoints === 3, 'four 1s plus mandatory Tokyo entry must score 3 total');
  assert(scorer.energy === 1, 'one Energy result must grant one energy');
  assert(scorer.health === 9, 'one Heart outside Tokyo must heal one health');
  assert(scorer.tokyoZone === 'tokyo_city', 'empty Tokyo must be entered without Smash');

  const bayEntry = initKingOfTokyoGame('BAY-ENTRY', players(5), seededRandom(7), 'p0');
  bayEntry.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(bayEntry, [1, 2, 3, 'energy', 'heart', 'heart']);
  prepareAndResolve(bayEntry);
  assert(bayEntry.players.get('p0')!.tokyoZone === 'tokyo_bay', 'active monster must enter open Bay without Smash');

  const zeroDice = initKingOfTokyoGame('ZERO-DICE', players(2), seededRandom(8), 'p0');
  zeroDice.players.get('p1')!.shrinkTokens = 6;
  zeroDice.phase = 'buying_cards';
  accept(zeroDice, 'end into zero-dice turn', () => endTurn(zeroDice, 'p0', zeroDice.revision));
  assert(zeroDice.dice.length === 0 && currentId(zeroDice) === 'p1', 'six Shrink tokens must allow zero dice');
  accept(zeroDice, 'record empty roll', () => rollDice(zeroDice, 'p1', seededRandom(9), zeroDice.revision));
  assert(String(zeroDice.phase) === 'choosing_dice', 'empty roll must advance without deadlock');
  prepareAndResolve(zeroDice);
  assert(zeroDice.phase === 'buying_cards', 'zero-dice turn must reach buy phase');
}

function resolutionOrderAndPrivacyScenarios(): void {
  const makeOrderState = (roomCode: string) => {
    const state = initKingOfTokyoGame(roomCode, players(2), seededRandom(10), 'p0');
    giveKeepCard(state, 'p0', 'healing_ray');
    giveKeepCard(state, 'p1', 'wings');
    const target = state.players.get('p1')!;
    target.tokyoZone = 'tokyo_city';
    target.health = 9;
    target.energy = 2;
    target.defenseMode = 'always';
    setFaces(state, ['heart', 'smash', 1, 2, 3, 'energy']);
    return state;
  };

  const heartsFirst = makeOrderState('HEARTS-FIRST');
  prepareAndResolve(heartsFirst, plan({
    resolutionOrder: ['hearts', 'smash', 'points', 'energy'],
  }));
  assert(heartsFirst.phase === 'awaiting_heart_allocation', 'Heart-first order must pause at current Heart allocation');
  assert(heartsFirst.players.get('p1')!.health === 9, 'Smash must not resolve before a Heart-first allocation');
  allocateHearts(heartsFirst, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
  }), 'allocate Heart before Smash');
  assert(String(heartsFirst.phase) === 'awaiting_tokyo_decision', 'Heart-first order must remove Wings energy before Smash');
  assert(heartsFirst.players.get('p0')!.energy === 2, 'Heart-first Healing Ray must transfer 2 energy');
  assert(heartsFirst.players.get('p1')!.health === 9, 'Heart-first target must heal then lose Smash health');
  accept(heartsFirst, 'stay after Heart-first attack', () =>
    decideTokyoYield(heartsFirst, 'p1', false, heartsFirst.revision));
  assert(heartsFirst.players.get('p0')!.energy === 3, 'later Energy category must still resolve after Tokyo choice');

  const smashFirst = makeOrderState('SMASH-FIRST');
  prepareAndResolve(smashFirst, plan({
    resolutionOrder: ['smash', 'hearts', 'points', 'energy'],
  }));
  assert(smashFirst.pendingDefenseDecision?.kind === 'wings', 'Smash-first order must offer Wings at damage time');
  assert(smashFirst.pendingHeartAllocation === null, 'Heart allocation must not open behind unresolved Smash defence');
  accept(smashFirst, 'use Wings before later categories', () =>
    decideDefense(smashFirst, 'p1', { kind: 'wings', use: true }, smashFirst.revision, seededRandom(101)));
  assert(String(smashFirst.phase) === 'awaiting_heart_allocation', 'Smash-first order must offer Hearts after Wings completes');
  assert(
    (smashFirst.pendingHeartAllocation as { healingRayAvailable: boolean } | null)?.healingRayAvailable === true,
    'Healing Ray entitlement must be captured at Heart event time',
  );
  assert(
    smashFirst.players.get('p1')!.health === 9 && smashFirst.players.get('p1')!.energy === 0,
    'Wings must spend the target\'s last energy before Heart allocation',
  );
  allocateHearts(smashFirst, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
  }), 'heal zero-energy target after Wings');
  assert(String(smashFirst.phase) === 'buying_cards', 'post-Smash Heart allocation must resume the remaining categories');
  assert(smashFirst.players.get('p0')!.energy === 1, 'a zero-energy Healing Ray target must transfer no energy');
  assert(smashFirst.players.get('p1')!.health === 10, 'a zero-energy target must still receive Healing Ray health');

  const fullTarget = initKingOfTokyoGame('FULL-RAY', players(3), seededRandom(11), 'p0');
  giveKeepCard(fullTarget, 'p0', 'healing_ray');
  fullTarget.players.get('p2')!.health = 9;
  setFaces(fullTarget, ['heart', 1, 2, 3, 'energy', 1]);
  prepareAndResolve(fullTarget);
  assert(fullTarget.phase === 'awaiting_heart_allocation', 'another wounded rival must keep the Heart window open');
  const fullTargetProjection = toKingOfTokyoPublicState(fullTarget, 'p0').pendingHeartAllocation;
  assert(
    fullTargetProjection?.healingRayTargetPlayerIds.join(',') === 'p2',
    'Heart projection must expose only currently wounded rivals, including zero-energy rivals',
  );
  rejectUnchanged(fullTarget, 'full-health Healing Ray target', () =>
    decideHeartAllocation(fullTarget, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    }), fullTarget.revision));
  rejectUnchanged(fullTarget, 'non-owner Heart allocation', () =>
    decideHeartAllocation(fullTarget, 'p1', heartAllocation(), fullTarget.revision));
  allocateHearts(fullTarget, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p2' }],
  }), 'allocate to projected wounded target');

  const freeRay = initKingOfTokyoGame('FREE-RAY', players(2), seededRandom(111), 'p0');
  giveKeepCard(freeRay, 'p0', 'healing_ray');
  freeRay.players.get('p1')!.health = 8;
  setFaces(freeRay, ['heart', 'heart', 1, 2, 3, 1]);
  prepareAndResolve(freeRay);
  const freeRayRevision = freeRay.revision;
  allocateHearts(freeRay, heartAllocation({
    healingRayUses: [
      { dieIndex: 0, targetPlayerId: 'p1' },
      { dieIndex: 1, targetPlayerId: 'p1' },
    ],
  }), 'heal a zero-energy target twice');
  assert(
    freeRay.players.get('p1')!.health === 10 && freeRay.players.get('p1')!.energy === 0 &&
      freeRay.players.get('p0')!.energy === 0,
    'zero-energy Healing Ray target must receive every assigned health and pay zero',
  );
  rejectUnchanged(freeRay, 'duplicate committed Heart allocation', () =>
    decideHeartAllocation(freeRay, 'p0', heartAllocation(), freeRayRevision));

  const partialRay = initKingOfTokyoGame('PARTIAL-RAY', players(2), seededRandom(112), 'p0');
  giveKeepCard(partialRay, 'p0', 'healing_ray');
  Object.assign(partialRay.players.get('p1')!, { health: 8, energy: 1 });
  setFaces(partialRay, ['heart', 'heart', 1, 2, 3, 1]);
  prepareAndResolve(partialRay);
  allocateHearts(partialRay, heartAllocation({
    healingRayUses: [
      { dieIndex: 0, targetPlayerId: 'p1' },
      { dieIndex: 1, targetPlayerId: 'p1' },
    ],
  }), 'heal twice for all remaining target energy');
  assert(
    partialRay.players.get('p1')!.health === 10 && partialRay.players.get('p1')!.energy === 0 &&
      partialRay.players.get('p0')!.energy === 1,
    'a target with insufficient energy must receive all assigned healing and pay only what it has',
  );

  const probe = initKingOfTokyoGame('PROBE', players(2), seededRandom(12), 'p0');
  giveKeepCard(probe, 'p0', 'healing_ray');
  giveKeepCard(probe, 'p1', 'psychic_probe');
  probe.players.get('p1')!.health = 8;
  probe.players.get('p1')!.energy = 2;
  setFaces(probe, ['heart', 1, 2, 3, 'energy', 'smash']);
  accept(probe, 'open Psychic Probe window', () => prepareDiceResolution(probe, 'p0', probe.revision));
  assert(
    probe.players.get('p1')!.health === 8 && probe.players.get('p1')!.energy === 2,
    'Healing Ray must not consume Hearts before every Probe resolves',
  );
  accept(probe, 'Probe rerolls planned Heart', () =>
    decidePsychicProbe(probe, 'p1', 0, () => 0.55, probe.revision));
  accept(probe, 'resolve post-Probe faces', () =>
    resolveDiceResults(probe, 'p0', plan(), probe.revision));
  assert(
    probe.pendingHeartAllocation === null && probe.players.get('p1')!.energy === 2,
    'post-Probe non-Heart face must never open or spend a stale Healing Ray allocation',
  );

  const privacy = initKingOfTokyoGame('PRIVACY', players(3), seededRandom(13), 'p0');
  privacy.players.get('p0')!.defenseMode = 'always';
  privacy.players.get('p0')!.rapidHealingMode = 'off';
  privacy.players.get('p0')!.tokenPreference = 'shrink';
  privacy.players.get('p1')!.defenseMode = 'off';
  privacy.players.get('p1')!.rapidHealingMode = 'always';
  const p0View = toKingOfTokyoPublicState(privacy, 'p0');
  const p1View = toKingOfTokyoPublicState(privacy, 'p1');
  const anonymousView = toKingOfTokyoPublicState(privacy);
  assert(!('defenseMode' in p0View.players[0]), 'public players must omit Wings automation');
  assert(!('rapidHealingMode' in p0View.players[1]), 'public players must omit Rapid Healing automation');
  assert(!('tokenPreference' in p1View.players[0]), 'public players must omit token priority');
  assert(
    p0View.viewerPreferences?.defenseMode === 'always' &&
      p0View.viewerPreferences.rapidHealingMode === 'off' &&
      p0View.viewerPreferences.tokenPreference === 'shrink',
    'owner projection must include only that owner preferences',
  );
  assert(p1View.viewerPreferences?.defenseMode === 'off', 'second viewer must receive their own preferences');
  assert(anonymousView.viewerPreferences === null, 'anonymous projection must expose no preferences');
}

function heartAllocationTimingScenarios(): void {
  const postSmash = initKingOfTokyoGame('POST-SMASH-RAY', players(2), seededRandom(113), 'p0');
  giveKeepCard(postSmash, 'p0', 'healing_ray');
  Object.assign(postSmash.players.get('p1')!, { tokyoZone: 'tokyo_city' as const, energy: 3 });
  setFaces(postSmash, ['smash', 'heart', 1, 2, 3, 1]);
  prepareAndResolve(postSmash, plan({
    resolutionOrder: ['smash', 'hearts', 'points', 'energy'],
  }));
  assert(
    postSmash.phase === 'awaiting_tokyo_decision' && postSmash.pendingHeartAllocation === null &&
      postSmash.players.get('p1')!.health === 9,
    'Smash must wound and finish its Tokyo decision before post-Smash Heart eligibility is evaluated',
  );
  accept(postSmash, 'stay before post-Smash Healing Ray', () =>
    decideTokyoYield(postSmash, 'p1', false, postSmash.revision));
  assert(String(postSmash.phase) === 'awaiting_heart_allocation', 'surviving newly wounded target must open a later Heart window');
  assert(
    toKingOfTokyoPublicState(postSmash, 'p0').pendingHeartAllocation?.healingRayTargetPlayerIds.join(',') === 'p1',
    'post-Smash projection must expose a target that was full before Smash',
  );
  allocateHearts(postSmash, heartAllocation({
    healingRayUses: [{ dieIndex: 1, targetPlayerId: 'p1' }],
  }), 'heal newly wounded post-Smash target');
  assert(
    postSmash.players.get('p1')!.health === 10 && postSmash.players.get('p1')!.energy === 1 &&
      postSmash.players.get('p0')!.energy === 2,
    'post-Smash Healing Ray must heal once and transfer exactly 2 energy',
  );

  const killedTarget = initKingOfTokyoGame('KILLED-RAY-TARGET', players(3), seededRandom(114), 'p0');
  giveKeepCard(killedTarget, 'p0', 'healing_ray');
  killedTarget.players.get('p0')!.health = 8;
  Object.assign(killedTarget.players.get('p1')!, { health: 1, tokyoZone: 'tokyo_city' as const, energy: 2 });
  setFaces(killedTarget, ['smash', 'heart', 1, 2, 3, 1]);
  prepareAndResolve(killedTarget, plan({
    resolutionOrder: ['smash', 'hearts', 'points', 'energy'],
  }));
  assert(
    killedTarget.players.get('p1')!.eliminated && killedTarget.pendingHeartAllocation === null &&
      killedTarget.players.get('p0')!.health === 9,
    'a target eliminated before Hearts must not be resurrected and its Heart must remain for normal healing',
  );

  const mixed = initKingOfTokyoGame('MIXED-HEARTS', players(2), seededRandom(115), 'p0');
  giveKeepCard(mixed, 'p0', 'healing_ray');
  Object.assign(mixed.players.get('p0')!, { health: 7, poisonTokens: 2, shrinkTokens: 2 });
  Object.assign(mixed.players.get('p1')!, { health: 9, energy: 2 });
  setFaces(mixed, ['heart', 'heart', 'heart', 'heart', 1, 2]);
  prepareAndResolve(mixed);
  allocateHearts(mixed, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    poisonTokensToRemove: 1,
    shrinkTokensToRemove: 1,
  }), 'resolve mixed Healing Ray, token and self-healing allocation');
  assert(
    mixed.players.get('p0')!.health === 8 && mixed.players.get('p0')!.poisonTokens === 1 &&
      mixed.players.get('p0')!.shrinkTokens === 1 && mixed.players.get('p0')!.energy === 2 &&
      mixed.players.get('p1')!.health === 10 && mixed.players.get('p1')!.energy === 0,
    'mixed Heart allocation must spend each Heart once and preserve the chosen allocation',
  );

  const race = initKingOfTokyoGame('HEART-RACE', players(2), seededRandom(116), 'p0');
  giveKeepCard(race, 'p0', 'healing_ray');
  const rapid = giveKeepCard(race, 'p1', 'rapid_healing');
  Object.assign(race.players.get('p1')!, { health: 9, energy: 2 });
  setFaces(race, ['heart', 1, 2, 3, 1, 2]);
  prepareAndResolve(race);
  const reconnectProjection = JSON.stringify(toKingOfTokyoPublicState(race, 'p0').pendingHeartAllocation);
  assert(
    reconnectProjection === JSON.stringify(toKingOfTokyoPublicState(race, 'p0').pendingHeartAllocation),
    'requesting state again during a Heart window must reproduce the same serialisable decision',
  );
  const allocationRevision = race.revision;
  accept(race, 'target Rapid Heals during Heart allocation', () =>
    usePowerCard(race, 'p1', rapid.instanceId, {}, race.revision, seededRandom(117)));
  assert(
    race.phase === 'awaiting_heart_allocation' &&
      toKingOfTokyoPublicState(race, 'p0').pendingHeartAllocation?.healingRayTargetPlayerIds.length === 0,
    'a target that heals to full during the window must disappear from refreshed eligibility',
  );
  rejectUnchanged(race, 'stale Heart allocation after target action', () =>
    decideHeartAllocation(race, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    }), allocationRevision));
  rejectUnchanged(race, 'refreshed full-health target', () =>
    decideHeartAllocation(race, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    }), race.revision));
  allocateHearts(race, heartAllocation(), 'resolve refreshed empty Heart allocation');

  const tokenDefault = initKingOfTokyoGame('HEART-TOKEN-DEFAULT', players(2), seededRandom(118), 'p0');
  Object.assign(tokenDefault.players.get('p0')!, {
    health: 8,
    poisonTokens: 2,
    shrinkTokens: 2,
    tokenPreference: 'shrink' as const,
  });
  setFaces(tokenDefault, ['heart', 'heart', 'heart', 1, 2, 3]);
  prepareAndResolve(tokenDefault);
  accept(tokenDefault, 'absent Heart allocator uses token preference', () =>
    resolveAbsentDecision(tokenDefault, 'p0', tokenDefault.revision, seededRandom(119)));
  assert(
    tokenDefault.players.get('p0')!.shrinkTokens === 0 &&
      tokenDefault.players.get('p0')!.poisonTokens === 1 && tokenDefault.players.get('p0')!.health === 8,
    'absence default must spend Hearts on the preferred token type first and never invent healing',
  );

  const rayDefault = initKingOfTokyoGame('HEART-RAY-DEFAULT', players(2), seededRandom(120), 'p0');
  giveKeepCard(rayDefault, 'p0', 'healing_ray');
  rayDefault.players.get('p0')!.health = 9;
  Object.assign(rayDefault.players.get('p1')!, { health: 9, energy: 2 });
  setFaces(rayDefault, ['heart', 1, 2, 3, 1, 2]);
  prepareAndResolve(rayDefault);
  accept(rayDefault, 'absent Heart allocator declines Healing Ray', () =>
    resolveAbsentDecision(rayDefault, 'p0', rayDefault.revision, seededRandom(121)));
  assert(
    rayDefault.players.get('p0')!.health === 10 && rayDefault.players.get('p1')!.health === 9 &&
      rayDefault.players.get('p1')!.energy === 2,
    'absence default must not force Healing Ray and must use the unassigned Heart normally',
  );

  const copiedRay = initKingOfTokyoGame('COPIED-RAY-SNAPSHOT', players(3), seededRandom(122), 'p0');
  const sourceRay = giveKeepCard(copiedRay, 'p1', 'healing_ray');
  giveKeepCard(copiedRay, 'p0', 'mimic').mimicTargetInstanceId = sourceRay.instanceId;
  Object.assign(copiedRay.players.get('p2')!, { health: 9, energy: 2 });
  setFaces(copiedRay, ['heart', 1, 2, 3, 1, 2]);
  prepareAndResolve(copiedRay);
  accept(copiedRay, 'copied Healing Ray source forfeits during Heart window', () =>
    forfeitPlayer(copiedRay, 'p1', copiedRay.revision, seededRandom(123)));
  assert(
    copiedRay.phase === 'awaiting_heart_allocation' && copiedRay.pendingHeartAllocation?.healingRayAvailable === true &&
      copiedRay.players.get('p0')!.powerCards[0]?.mimicTargetInstanceId === null,
    'an opened Heart window must retain its event-time Healing Ray entitlement after the copied source disappears',
  );
  allocateHearts(copiedRay, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p2' }],
  }), 'use snapshotted copied Healing Ray');
  assert(
    copiedRay.players.get('p2')!.health === 10 && copiedRay.players.get('p2')!.energy === 0 &&
      copiedRay.players.get('p0')!.energy === 2,
    'snapshotted copied Healing Ray must complete exactly once',
  );

  const targetLeaves = initKingOfTokyoGame('RAY-TARGET-LEAVES', players(3), seededRandom(124), 'p0');
  giveKeepCard(targetLeaves, 'p0', 'healing_ray');
  Object.assign(targetLeaves.players.get('p1')!, { health: 9, energy: 2 });
  Object.assign(targetLeaves.players.get('p2')!, { health: 9, energy: 1 });
  setFaces(targetLeaves, ['heart', 1, 2, 3, 1, 2]);
  prepareAndResolve(targetLeaves);
  const beforeTargetForfeitRevision = targetLeaves.revision;
  accept(targetLeaves, 'one Healing Ray target forfeits during choice', () =>
    forfeitPlayer(targetLeaves, 'p1', targetLeaves.revision, seededRandom(125)));
  assert(
    targetLeaves.phase === 'awaiting_heart_allocation' &&
      toKingOfTokyoPublicState(targetLeaves, 'p0').pendingHeartAllocation?.healingRayTargetPlayerIds.join(',') === 'p2',
    'a forfeited target must be removed while the actor retains other current choices',
  );
  rejectUnchanged(targetLeaves, 'stale allocation to forfeited target', () =>
    decideHeartAllocation(targetLeaves, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    }), beforeTargetForfeitRevision));
  allocateHearts(targetLeaves, heartAllocation({
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p2' }],
  }), 'allocate after target forfeit');

  const actorLeaves = initKingOfTokyoGame('HEART-ACTOR-LEAVES', players(3), seededRandom(126), 'p0');
  giveKeepCard(actorLeaves, 'p0', 'healing_ray');
  actorLeaves.players.get('p1')!.health = 9;
  setFaces(actorLeaves, ['heart', 1, 2, 3, 1, 2]);
  prepareAndResolve(actorLeaves);
  accept(actorLeaves, 'active Heart allocator forfeits', () =>
    forfeitPlayer(actorLeaves, 'p0', actorLeaves.revision, seededRandom(127)));
  assert(
    actorLeaves.pendingHeartAllocation === null && actorLeaves.pendingDiceResolution === null &&
      currentId(actorLeaves) === 'p1' && actorLeaves.phase === 'awaiting_roll',
    'active-player forfeit must clear the Heart continuation and advance without deadlock',
  );
}

function tokyoAndDefenseScenarios(): void {
  const moveBay = initKingOfTokyoGame('MOVE-BAY', players(5), seededRandom(14), 'p0');
  moveBay.players.get('p1')!.tokyoZone = 'tokyo_bay';
  accept(moveBay, 'forfeit fifth monster with empty City', () =>
    forfeitPlayer(moveBay, 'p4', moveBay.revision));
  assert(moveBay.players.get('p1')!.tokyoZone === 'tokyo_city', 'Bay occupant must move to empty City at four survivors');

  const ejectBay = initKingOfTokyoGame('EJECT-BAY', players(5), seededRandom(15), 'p0');
  ejectBay.players.get('p1')!.tokyoZone = 'tokyo_city';
  ejectBay.players.get('p2')!.tokyoZone = 'tokyo_bay';
  accept(ejectBay, 'forfeit fifth monster with occupied City', () =>
    forfeitPlayer(ejectBay, 'p4', ejectBay.revision));
  assert(ejectBay.players.get('p2')!.tokyoZone === null, 'Bay occupant must leave if City stays occupied');

  const targeting = initKingOfTokyoGame('TARGETING', players(5), seededRandom(16), 'p0');
  targeting.players.get('p1')!.tokyoZone = 'tokyo_city';
  targeting.players.get('p2')!.tokyoZone = 'tokyo_bay';
  setFaces(targeting, ['smash', 'smash', 1, 2, 3, 'energy']);
  prepareAndResolve(targeting);
  assert(
    targeting.players.get('p1')!.health === 8 &&
      targeting.players.get('p2')!.health === 8 &&
      targeting.players.get('p3')!.health === 10,
    'outside Smash must hit both Tokyo occupants and no outside monster',
  );
  accept(targeting, 'City occupant stays', () =>
    decideTokyoYield(targeting, 'p1', false, targeting.revision));
  accept(targeting, 'Bay occupant stays', () =>
    decideTokyoYield(targeting, 'p2', false, targeting.revision));

  const tokenRemoval = initKingOfTokyoGame('TOKENS', players(2), seededRandom(17), 'p0');
  const tokenPlayer = tokenRemoval.players.get('p0')!;
  tokenPlayer.health = 8;
  tokenPlayer.poisonTokens = 2;
  tokenPlayer.shrinkTokens = 2;
  setFaces(tokenRemoval, ['heart', 'heart', 'heart', 1, 2, 3]);
  prepareAndResolve(tokenRemoval);
  allocateHearts(tokenRemoval, heartAllocation({
    poisonTokensToRemove: 1,
    shrinkTokensToRemove: 1,
  }), 'choose token removal and self-healing');
  assert(
    tokenPlayer.poisonTokens === 1 && tokenPlayer.shrinkTokens === 1 && tokenPlayer.health === 9,
    'outside Hearts must remove chosen tokens and heal with remainder',
  );

  const tokyoHearts = initKingOfTokyoGame('TOKYO-HEARTS', players(2), seededRandom(18), 'p0');
  const tokyoPlayer = tokyoHearts.players.get('p0')!;
  giveKeepCard(tokyoHearts, 'p0', 'healing_ray');
  tokyoPlayer.tokyoZone = 'tokyo_city';
  tokyoPlayer.health = 7;
  tokyoPlayer.poisonTokens = 1;
  tokyoHearts.players.get('p1')!.health = 9;
  setFaces(tokyoHearts, ['heart', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(tokyoHearts);
  rejectUnchanged(tokyoHearts, 'Tokyo token removal', () =>
    decideHeartAllocation(tokyoHearts, 'p0', heartAllocation({ poisonTokensToRemove: 1 }), tokyoHearts.revision));
  allocateHearts(tokyoHearts, heartAllocation(), 'resolve ineffective Tokyo Hearts');
  assert(tokyoPlayer.health === 7 && tokyoPlayer.poisonTokens === 1, 'Tokyo Hearts must not heal or remove tokens');

  const jets = initKingOfTokyoGame('JETS', players(2), seededRandom(19), 'p0');
  giveKeepCard(jets, 'p1', 'jets');
  giveKeepCard(jets, 'p0', 'poison_spit');
  jets.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(jets, ['smash', 'smash', 1, 2, 3, 'energy']);
  prepareAndResolve(jets);
  assert(jets.players.get('p1')!.health === 10, 'Jets must defer Smash damage until yield choice');
  accept(jets, 'Jets yield', () => decideTokyoYield(jets, 'p1', true, jets.revision));
  assert(
    jets.players.get('p1')!.health === 10 && jets.players.get('p1')!.poisonTokens === 0,
    'Jets yield must prevent Smash wounds and attack tokens',
  );
  assert(jets.players.get('p0')!.tokyoZone === 'tokyo_city', 'attacker must enter yielded zone');

  const jetsStay = initKingOfTokyoGame('JETS-STAY', players(2), seededRandom(20), 'p0');
  giveKeepCard(jetsStay, 'p1', 'jets');
  const spit = giveKeepCard(jetsStay, 'p0', 'poison_spit');
  giveKeepCard(jetsStay, 'p0', 'mimic').mimicTargetInstanceId = spit.instanceId;
  jetsStay.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(jetsStay, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(jetsStay);
  accept(jetsStay, 'Jets stay', () => decideTokyoYield(jetsStay, 'p1', false, jetsStay.revision));
  assert(
    jetsStay.players.get('p1')!.health === 9 && jetsStay.players.get('p1')!.poisonTokens === 2,
    'staying with Jets must take Smash and one token from each copied source',
  );

  const novaTokyo = initKingOfTokyoGame('NOVA-TOKYO', players(5), seededRandom(21), 'p0');
  giveKeepCard(novaTokyo, 'p0', 'nova_breath');
  novaTokyo.players.get('p0')!.tokyoZone = 'tokyo_city';
  novaTokyo.players.get('p1')!.tokyoZone = 'tokyo_bay';
  setFaces(novaTokyo, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(novaTokyo);
  assert(
    novaTokyo.players.get('p1')!.health === 9 &&
      String(novaTokyo.phase) === 'awaiting_tokyo_decision' &&
      novaTokyo.pendingTokyoDecisions[0] === 'p1',
    'Nova Breath must let a Tokyo occupant yield after another Tokyo occupant wounds them with Smash',
  );
  accept(novaTokyo, 'Nova-wounded Bay occupant yields', () =>
    decideTokyoYield(novaTokyo, 'p1', true, novaTokyo.revision));
  assert(
    novaTokyo.players.get('p1')!.tokyoZone === null && String(novaTokyo.phase) === 'buying_cards',
    'Nova Breath yield must complete the active monster’s dice resolution',
  );

  const forcedBayExit = initKingOfTokyoGame('FORCED-BAY-EXIT', players(5), seededRandom(211), 'p0');
  giveKeepCard(forcedBayExit, 'p0', 'nova_breath');
  giveKeepCard(forcedBayExit, 'p0', 'poison_spit');
  giveKeepCard(forcedBayExit, 'p1', 'jets');
  forcedBayExit.players.get('p0')!.tokyoZone = 'tokyo_city';
  forcedBayExit.players.get('p1')!.tokyoZone = 'tokyo_bay';
  forcedBayExit.players.get('p2')!.health = 1;
  setFaces(forcedBayExit, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(forcedBayExit);
  assert(
    forcedBayExit.players.get('p2')!.eliminated && forcedBayExit.players.get('p1')!.tokyoZone === null &&
      forcedBayExit.players.get('p1')!.health === 9 && forcedBayExit.players.get('p1')!.poisonTokens === 1 &&
      !forcedBayExit.pendingTokyoDecisions.length && !forcedBayExit.pendingTokyoDamage.size &&
      String(forcedBayExit.phase) === 'buying_cards',
    'forced Bay exit must resolve deferred Jets damage and tokens without leaving an orphaned decision',
  );

  const bayMovesToCity = initKingOfTokyoGame('BAY-MOVES-TO-CITY', players(5), seededRandom(212), 'p0');
  giveKeepCard(bayMovesToCity, 'p1', 'jets');
  bayMovesToCity.players.get('p1')!.tokyoZone = 'tokyo_bay';
  bayMovesToCity.players.get('p2')!.tokyoZone = 'tokyo_city';
  bayMovesToCity.players.get('p2')!.health = 1;
  setFaces(bayMovesToCity, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(bayMovesToCity);
  assert(
    bayMovesToCity.players.get('p2')!.eliminated &&
      bayMovesToCity.players.get('p1')!.tokyoZone === 'tokyo_city' &&
      bayMovesToCity.pendingTokyoDecisions.join(',') === 'p1' && bayMovesToCity.pendingTokyoDamage.has('p1'),
    'Bay occupant moved into an empty City must retain its deferred Jets decision',
  );
  accept(bayMovesToCity, 'moved Bay occupant resolves Jets decision', () =>
    decideTokyoYield(bayMovesToCity, 'p1', false, bayMovesToCity.revision));
  assert(bayMovesToCity.players.get('p1')!.health === 9, 'moved Bay occupant must take Smash when staying');

  const bayExitDuringForfeit = initKingOfTokyoGame('BAY-EXIT-FORFEIT', players(5), seededRandom(213), 'p0');
  giveKeepCard(bayExitDuringForfeit, 'p2', 'jets');
  bayExitDuringForfeit.players.get('p1')!.tokyoZone = 'tokyo_city';
  bayExitDuringForfeit.players.get('p2')!.tokyoZone = 'tokyo_bay';
  setFaces(bayExitDuringForfeit, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(bayExitDuringForfeit);
  assert(
    bayExitDuringForfeit.pendingTokyoDecisions.join(',') === 'p1,p2',
    'City and Bay Jets decisions must both be pending before the unrelated forfeit',
  );
  accept(bayExitDuringForfeit, 'unrelated outsider forfeits during Jets decisions', () =>
    forfeitPlayer(bayExitDuringForfeit, 'p4', bayExitDuringForfeit.revision));
  assert(
    bayExitDuringForfeit.pendingTokyoDecisions.join(',') === 'p1' &&
      !bayExitDuringForfeit.pendingTokyoDamage.has('p1') && !bayExitDuringForfeit.pendingTokyoDamage.has('p2') &&
      bayExitDuringForfeit.players.get('p1')!.health === 9 &&
      bayExitDuringForfeit.players.get('p2')!.tokyoZone === null && bayExitDuringForfeit.players.get('p2')!.health === 9,
    'forfeit-driven Bay closure must settle and remove only the forced-out Bay decision',
  );
  accept(bayExitDuringForfeit, 'remaining City occupant resolves Jets decision', () =>
    decideTokyoYield(bayExitDuringForfeit, 'p1', false, bayExitDuringForfeit.revision));

  const burrowing = initKingOfTokyoGame('BURROWING', players(3), seededRandom(22), 'p0');
  giveKeepCard(burrowing, 'p1', 'burrowing');
  burrowing.players.get('p1')!.tokyoZone = 'tokyo_city';
  burrowing.players.get('p0')!.health = 1;
  setFaces(burrowing, ['smash', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(burrowing);
  accept(burrowing, 'yield with Burrowing retaliation', () =>
    decideTokyoYield(burrowing, 'p1', true, burrowing.revision));
  assert(burrowing.players.get('p0')!.eliminated, 'Burrowing must eliminate one-health attacker');
  assert(
    currentId(burrowing) === 'p1' && burrowing.phase === 'awaiting_roll',
    'eliminated attacker must not deadlock in buy phase',
  );

  const yieldBatch = initKingOfTokyoGame('YIELD-BATCH', players(5), seededRandom(221), 'p2');
  giveKeepCard(yieldBatch, 'p0', 'burrowing');
  giveKeepCard(yieldBatch, 'p1', 'jets');
  giveKeepCard(yieldBatch, 'p2', 'poison_spit');
  yieldBatch.players.get('p0')!.tokyoZone = 'tokyo_city';
  yieldBatch.players.get('p1')!.tokyoZone = 'tokyo_bay';
  yieldBatch.players.get('p2')!.health = 1;
  setFaces(yieldBatch, ['smash', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(yieldBatch);
  assert(
    yieldBatch.pendingTokyoDecisions.join(',') === 'p0,p1' &&
      yieldBatch.players.get('p0')!.health === 9 && yieldBatch.players.get('p1')!.health === 10,
    'City then Bay Yield decisions must be queued clockwise with Jets damage deferred',
  );
  accept(yieldBatch, 'City yields before the Bay decision', () =>
    decideTokyoYield(yieldBatch, 'p0', true, yieldBatch.revision));
  assert(
    !yieldBatch.players.get('p2')!.eliminated && currentId(yieldBatch) === 'p2' &&
      yieldBatch.phase === 'awaiting_tokyo_decision' && yieldBatch.pendingTokyoDecisions.join(',') === 'p1',
    `Burrowing must wait until the attacker takes the yielded City place (${JSON.stringify({
      active: currentId(yieldBatch), activeEliminated: yieldBatch.players.get('p2')!.eliminated,
      phase: yieldBatch.phase, pending: yieldBatch.pendingTokyoDecisions,
    })})`,
  );
  accept(yieldBatch, 'Bay Jets occupant stays before City entry', () =>
    decideTokyoYield(yieldBatch, 'p1', false, yieldBatch.revision));
  assert(
    yieldBatch.players.get('p1')!.health === 9 && yieldBatch.players.get('p1')!.poisonTokens === 1 &&
      currentId(yieldBatch) === 'p3' && String(yieldBatch.phase) === 'awaiting_roll' &&
      !yieldBatch.pendingTokyoDecisions.length && !yieldBatch.pendingTokyoDamage.size,
    'deferred Jets damage and tokens must settle before City entry triggers lethal Burrowing',
  );

  const reverseYieldBatch = initKingOfTokyoGame('YIELD-BATCH-REVERSE', players(5), seededRandom(222), 'p2');
  giveKeepCard(reverseYieldBatch, 'p3', 'burrowing');
  giveKeepCard(reverseYieldBatch, 'p0', 'jets');
  reverseYieldBatch.players.get('p3')!.tokyoZone = 'tokyo_bay';
  reverseYieldBatch.players.get('p0')!.tokyoZone = 'tokyo_city';
  reverseYieldBatch.players.get('p2')!.health = 1;
  setFaces(reverseYieldBatch, ['smash', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(reverseYieldBatch);
  assert(
    reverseYieldBatch.pendingTokyoDecisions.join(',') === 'p3,p0',
    'Yield order must be clockwise from the active monster, not absolute seat or Tokyo-zone order',
  );
  accept(reverseYieldBatch, 'Bay yields before the City decision', () =>
    decideTokyoYield(reverseYieldBatch, 'p3', true, reverseYieldBatch.revision));
  assert(
    !reverseYieldBatch.players.get('p2')!.eliminated && reverseYieldBatch.phase === 'awaiting_tokyo_decision' &&
      reverseYieldBatch.pendingTokyoDecisions[0] === 'p0',
    'Bay Burrowing must wait for an exact-place entry while the City decision remains',
  );
  accept(reverseYieldBatch, 'City Jets occupant yields after Bay', () =>
    decideTokyoYield(reverseYieldBatch, 'p0', true, reverseYieldBatch.revision));
  assert(
    reverseYieldBatch.players.get('p0')!.health === 10 && reverseYieldBatch.players.get('p2')!.health === 1 &&
      reverseYieldBatch.players.get('p2')!.tokyoZone === 'tokyo_city' && currentId(reverseYieldBatch) === 'p2' &&
      String(reverseYieldBatch.phase) === 'buying_cards',
    'taking City after both occupants yield must not trigger the displaced Bay monster\'s Burrowing',
  );

  const exactZoneYield = initKingOfTokyoGame('BURROWING-EXACT-ZONE', players(5), seededRandom(2221), 'p2');
  const cityBurrowing = giveKeepCard(exactZoneYield, 'p0', 'burrowing');
  giveKeepCard(exactZoneYield, 'p1', 'mimic').mimicTargetInstanceId = cityBurrowing.instanceId;
  exactZoneYield.players.get('p0')!.tokyoZone = 'tokyo_city';
  exactZoneYield.players.get('p1')!.tokyoZone = 'tokyo_bay';
  setFaces(exactZoneYield, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(exactZoneYield);
  accept(exactZoneYield, 'City Burrowing occupant yields', () =>
    decideTokyoYield(exactZoneYield, 'p0', true, exactZoneYield.revision));
  accept(exactZoneYield, 'Bay copied-Burrowing occupant yields', () =>
    decideTokyoYield(exactZoneYield, 'p1', true, exactZoneYield.revision));
  assert(
    exactZoneYield.players.get('p2')!.tokyoZone === 'tokyo_city' &&
      exactZoneYield.players.get('p2')!.health === 9,
    'when City and Bay both yield, entering City must trigger only the City occupant\'s Burrowing',
  );

  const snapshottedBurrowing = initKingOfTokyoGame('BURROWING-YIELD-SNAPSHOT', players(5), seededRandom(2223), 'p1');
  giveKeepCard(snapshottedBurrowing, 'p1', 'fire_breathing');
  giveKeepCard(snapshottedBurrowing, 'p0', 'burrowing');
  snapshottedBurrowing.players.get('p0')!.tokyoZone = 'tokyo_city';
  snapshottedBurrowing.players.get('p0')!.health = 2;
  snapshottedBurrowing.players.get('p2')!.tokyoZone = 'tokyo_bay';
  setFaces(snapshottedBurrowing, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(snapshottedBurrowing);
  accept(snapshottedBurrowing, 'Bay yields before snapshotted City Burrowing', () =>
    decideTokyoYield(snapshottedBurrowing, 'p2', true, snapshottedBurrowing.revision));
  accept(snapshottedBurrowing, 'City yields before Fire removes its Burrowing source', () =>
    decideTokyoYield(snapshottedBurrowing, 'p0', true, snapshottedBurrowing.revision));
  assert(
    snapshottedBurrowing.players.get('p0')!.eliminated &&
      snapshottedBurrowing.players.get('p0')!.powerCards.length === 0 &&
      snapshottedBurrowing.players.get('p1')!.tokyoZone === 'tokyo_city' &&
      snapshottedBurrowing.players.get('p1')!.health === 9,
    'Burrowing captured at Yield must still hit the monster taking that zone after the source is eliminated',
  );

  const novaAlreadyInside = initKingOfTokyoGame('BURROWING-NOVA-INSIDE', players(6), seededRandom(2222), 'p0');
  giveKeepCard(novaAlreadyInside, 'p0', 'nova_breath');
  giveKeepCard(novaAlreadyInside, 'p1', 'burrowing');
  novaAlreadyInside.players.get('p0')!.tokyoZone = 'tokyo_city';
  novaAlreadyInside.players.get('p1')!.tokyoZone = 'tokyo_bay';
  setFaces(novaAlreadyInside, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(novaAlreadyInside);
  accept(novaAlreadyInside, 'Bay yields to Nova attacker already in City', () =>
    decideTokyoYield(novaAlreadyInside, 'p1', true, novaAlreadyInside.revision));
  assert(
    novaAlreadyInside.players.get('p0')!.health === 10 &&
      novaAlreadyInside.players.get('p0')!.tokyoZone === 'tokyo_city' &&
      novaAlreadyInside.players.get('p1')!.tokyoZone === null,
    'an attacker already in Tokyo takes no new place and must not suffer the yielder\'s Burrowing',
  );

  const yieldForfeit = initKingOfTokyoGame('YIELD-BATCH-FORFEIT', players(5), seededRandom(223), 'p2');
  giveKeepCard(yieldForfeit, 'p0', 'burrowing');
  giveKeepCard(yieldForfeit, 'p1', 'jets');
  yieldForfeit.players.get('p0')!.tokyoZone = 'tokyo_city';
  yieldForfeit.players.get('p1')!.tokyoZone = 'tokyo_bay';
  yieldForfeit.players.get('p2')!.health = 1;
  setFaces(yieldForfeit, ['smash', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(yieldForfeit);
  accept(yieldForfeit, 'first occupant yields before queued forfeit', () =>
    decideTokyoYield(yieldForfeit, 'p0', true, yieldForfeit.revision));
  accept(yieldForfeit, 'remaining queued occupant forfeits', () =>
    forfeitPlayer(yieldForfeit, 'p1', yieldForfeit.revision));
  assert(
    currentId(yieldForfeit) === 'p3' && yieldForfeit.phase === 'awaiting_roll' &&
      !yieldForfeit.pendingTokyoDecisions.length && !yieldForfeit.pendingTokyoDamage.size,
    'forfeiting the last queued occupant must clean the batch and advance its dead attacker',
  );

  const burrowingCopies = initKingOfTokyoGame('BURROWING-COPIES', players(3), seededRandom(22), 'p0');
  giveKeepCard(burrowingCopies, 'p0', 'armor_plating');
  const burrowingSource = giveKeepCard(burrowingCopies, 'p1', 'burrowing');
  giveKeepCard(burrowingCopies, 'p1', 'mimic').mimicTargetInstanceId = burrowingSource.instanceId;
  burrowingCopies.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(burrowingCopies, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(burrowingCopies);
  accept(burrowingCopies, 'yield against copied Burrowing', () =>
    decideTokyoYield(burrowingCopies, 'p1', true, burrowingCopies.revision));
  assert(
    burrowingCopies.players.get('p0')!.health === 10,
    'each Burrowing copy must be an independent 1-health source for Armor Plating',
  );

  const passiveFirst = initKingOfTokyoGame('PASSIVE-FIRST', players(2), seededRandom(23), 'p0');
  giveKeepCard(passiveFirst, 'p1', 'armor_plating');
  giveKeepCard(passiveFirst, 'p1', 'wings');
  passiveFirst.players.get('p1')!.tokyoZone = 'tokyo_city';
  passiveFirst.players.get('p1')!.energy = 2;
  passiveFirst.players.get('p1')!.defenseMode = 'always';
  setFaces(passiveFirst, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(passiveFirst);
  assert(
    passiveFirst.players.get('p1')!.health === 10 &&
      passiveFirst.players.get('p1')!.energy === 2 &&
      passiveFirst.phase === 'buying_cards',
    'Armor Plating must prevent 1 health before Wings spends energy',
  );

  const selfWings = initKingOfTokyoGame('SELF-WINGS', players(3), seededRandom(23), 'p0');
  giveKeepCard(selfWings, 'p0', 'wings');
  const winged = selfWings.players.get('p0')!;
  winged.health = 3;
  winged.energy = 9;
  winged.defenseMode = 'always';
  selfWings.phase = 'buying_cards';
  exposeCard(selfWings, 'high_altitude_bombing');
  accept(selfWings, 'Wings protects self from bombing', () =>
    buyPowerCard(selfWings, 'p0', 0, selfWings.revision, seededRandom(24)));
  assert(selfWings.pendingDefenseDecision?.kind === 'wings', 'bombing must offer Wings at damage time');
  accept(selfWings, 'accept Wings against bombing', () =>
    decideDefense(selfWings, 'p0', { kind: 'wings', use: true }, selfWings.revision, seededRandom(241)));
  assert(winged.health === 3 && winged.energy === 3, 'self Power-card loss must allow Wings after payment');
  exposeCard(selfWings, 'national_guard');
  accept(selfWings, 'Wings remains active whole turn', () =>
    buyPowerCard(selfWings, 'p0', 0, selfWings.revision, seededRandom(25)));
  assert(winged.health === 3 && Number(winged.energy) === 0, 'whole-turn Wings must cover later self damage');

  const rapid = initKingOfTokyoGame('RAPID', players(2), seededRandom(26), 'p0');
  giveKeepCard(rapid, 'p1', 'rapid_healing');
  const rapidTarget = rapid.players.get('p1')!;
  rapidTarget.health = 1;
  rapidTarget.energy = 2;
  rapidTarget.rapidHealingMode = 'lethal';
  rapid.players.get('p0')!.tokyoZone = 'tokyo_city';
  setFaces(rapid, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(rapid);
  assert(rapid.pendingDefenseDecision?.kind === 'rapid_healing', 'lethal Smash must offer Rapid Healing at damage time');
  accept(rapid, 'heal before lethal Smash', () =>
    decideDefense(rapid, 'p1', { kind: 'rapid_healing', activations: 1 }, rapid.revision, seededRandom(261)));
  assert(
    !rapidTarget.eliminated && rapidTarget.health === 1 && rapidTarget.energy === 0,
    'off-turn lethal Rapid Healing must spend before incoming Smash',
  );

  const camouflageOnly = initKingOfTokyoGame('CAMOUFLAGE-ONLY', players(2), seededRandom(2601), 'p0');
  camouflageOnly.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(camouflageOnly, 'p1', 'camouflage');
  camouflageOnly.players.get('p1')!.energy = 4;
  setFaces(camouflageOnly, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(camouflageOnly, plan(), () => 0);
  assert(
    camouflageOnly.pendingDefenseDecision === null &&
      toKingOfTokyoPublicState(camouflageOnly, 'p1').pendingDefenseDecision === null &&
      camouflageOnly.players.get('p1')!.health === 9,
    'Camouflage without packet-time Stretchy must resolve as rolled without offering a paid die change',
  );
  rejectUnchanged(camouflageOnly, 'Camouflage-only cannot submit a Stretchy change', () =>
    decideDefense(camouflageOnly, 'p1', {
      kind: 'camouflage', changes: [{ dieIndex: 0, face: 'heart' }],
    }, camouflageOnly.revision));

  const camouflage = initKingOfTokyoGame('CAMOUFLAGE-STRETCHY', players(3), seededRandom(261), 'p0');
  camouflage.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(camouflage, 'p1', 'camouflage');
  giveKeepCard(camouflage, 'p1', 'stretchy');
  camouflage.players.get('p1')!.energy = 4;
  setFaces(camouflage, ['smash', 'smash', 'smash', 1, 2, 3]);
  const camouflageRolls = [0.9, 0, 0];
  prepareAndResolve(camouflage, plan(), () => camouflageRolls.shift() ?? 0);
  const camouflageDecision = camouflage.pendingDefenseDecision;
  assert(
    camouflageDecision?.kind === 'camouflage' && camouflageDecision.playerId === 'p1' &&
      camouflageDecision.incomingDamage === 3 && camouflageDecision.remainingDamage === 3 &&
      camouflageDecision.camouflageCopy === 1 && camouflageDecision.camouflageCopies === 1 &&
      camouflageDecision.dice.join(',') === 'heart,1,1',
    'Camouflage must expose its exact per-health roll to the off-turn Stretchy owner',
  );
  const ownerView = toKingOfTokyoPublicState(camouflage, 'p1');
  const observerView = toKingOfTokyoPublicState(camouflage, 'p2');
  assert(
    ownerView.pendingDefenseDecision?.dice.join(',') === 'heart,1,1' &&
      ownerView.pendingDefenseDecision.stretchyAvailable === true &&
      observerView.pendingDefenseDecision?.dice.join(',') === 'heart,1,1' &&
      observerView.pendingDefenseDecision.stretchyAvailable === true,
    'reconnect and observer projections must preserve the committed Camouflage dice and packet entitlement',
  );
  rejectUnchanged(camouflage, 'only the defender may change Camouflage dice', () =>
    decideDefense(camouflage, 'p2', { kind: 'camouflage', changes: [] }, camouflage.revision));
  rejectUnchanged(camouflage, 'stale Camouflage revision', () =>
    decideDefense(camouflage, 'p1', { kind: 'camouflage', changes: [] }, camouflage.revision + 1));
  rejectUnchanged(camouflage, 'duplicate Camouflage die change', () =>
    decideDefense(camouflage, 'p1', {
      kind: 'camouflage',
      changes: [{ dieIndex: 1, face: 'heart' }, { dieIndex: 1, face: 'smash' }],
    }, camouflage.revision));
  rejectUnchanged(camouflage, 'out-of-range Camouflage die change', () =>
    decideDefense(camouflage, 'p1', {
      kind: 'camouflage', changes: [{ dieIndex: 3, face: 'heart' }],
    }, camouflage.revision));
  rejectUnchanged(camouflage, 'unchanged Camouflage die face', () =>
    decideDefense(camouflage, 'p1', {
      kind: 'camouflage', changes: [{ dieIndex: 0, face: 'heart' }],
    }, camouflage.revision));
  rejectUnchanged(camouflage, 'unaffordable Camouflage Stretchy changes', () =>
    decideDefense(camouflage, 'p1', {
      kind: 'camouflage',
      changes: [
        { dieIndex: 0, face: 1 },
        { dieIndex: 1, face: 'heart' },
        { dieIndex: 2, face: 'heart' },
      ],
    }, camouflage.revision));
  accept(camouflage, 'Stretchy changes both failed Camouflage dice', () =>
    decideDefense(camouflage, 'p1', {
      kind: 'camouflage',
      changes: [{ dieIndex: 1, face: 'heart' }, { dieIndex: 2, face: 'heart' }],
    }, camouflage.revision, seededRandom(262)));
  assert(
    camouflage.players.get('p1')!.health === 10 && camouflage.players.get('p1')!.energy === 0 &&
      String(camouflage.phase) === 'buying_cards',
    'paid Stretchy changes must prevent only the Camouflage health represented by changed Hearts',
  );

  const copiedStretchy = initKingOfTokyoGame('CAMOUFLAGE-COPIED-STRETCHY', players(3), seededRandom(2621), 'p0');
  copiedStretchy.players.get('p0')!.tokyoZone = 'tokyo_city';
  const stretchySource = giveKeepCard(copiedStretchy, 'p1', 'stretchy');
  giveKeepCard(copiedStretchy, 'p2', 'camouflage');
  giveKeepCard(copiedStretchy, 'p2', 'mimic').mimicTargetInstanceId = stretchySource.instanceId;
  copiedStretchy.players.get('p2')!.energy = 2;
  setFaces(copiedStretchy, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(copiedStretchy, plan(), () => 0);
  assert(
    copiedStretchy.pendingDefenseDecision?.kind === 'camouflage' &&
      copiedStretchy.pendingDefenseDecision.playerId === 'p2' &&
      toKingOfTokyoPublicState(copiedStretchy, 'p2').pendingDefenseDecision?.stretchyAvailable === true,
    'copied Stretchy must be projected from the entitlement captured by the triggering damage packet',
  );
  accept(copiedStretchy, 'remove copied Stretchy source during the committed defence packet', () =>
    forfeitPlayer(copiedStretchy, 'p1', copiedStretchy.revision, seededRandom(2622)));
  assert(
    copiedStretchy.players.get('p2')!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId === null &&
      copiedStretchy.pendingDefenseDecision?.kind === 'camouflage' &&
      toKingOfTokyoPublicState(copiedStretchy, 'p2').pendingDefenseDecision?.stretchyAvailable === true &&
      toKingOfTokyoPublicState(copiedStretchy, 'p0').pendingDefenseDecision?.stretchyAvailable === true,
    'the public Camouflage decision must retain its snapshotted Stretchy entitlement after source loss',
  );
  accept(copiedStretchy, 'use packet-entitled Stretchy after its copied source disappears', () =>
    decideDefense(copiedStretchy, 'p2', {
      kind: 'camouflage', changes: [{ dieIndex: 0, face: 'heart' }],
    }, copiedStretchy.revision, seededRandom(2623)));
  assert(
    copiedStretchy.players.get('p2')!.health === 10 && copiedStretchy.players.get('p2')!.energy === 0,
    'source loss must not revoke paid Stretchy from an already committed Camouflage packet',
  );

  const absentCamouflage = initKingOfTokyoGame('ABSENT-CAMOUFLAGE', players(2), seededRandom(263), 'p0');
  absentCamouflage.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(absentCamouflage, 'p1', 'camouflage');
  giveKeepCard(absentCamouflage, 'p1', 'stretchy');
  absentCamouflage.players.get('p1')!.energy = 2;
  setFaces(absentCamouflage, ['smash', 'smash', 'smash', 1, 2, 3]);
  const absentCamouflageRolls = [0.9, 0, 0];
  prepareAndResolve(absentCamouflage, plan(), () => absentCamouflageRolls.shift() ?? 0);
  accept(absentCamouflage, 'absent Stretchy owner keeps Camouflage roll', () =>
    resolveAbsentDecision(absentCamouflage, 'p1', absentCamouflage.revision, seededRandom(264)));
  assert(
    absentCamouflage.players.get('p1')!.health === 8 && absentCamouflage.players.get('p1')!.energy === 2,
    'Camouflage reconnect timeout must safely keep the rolled dice without spending energy',
  );

  const defenseOrder = initKingOfTokyoGame('DEFENSE-ORDER', players(2), seededRandom(265), 'p0');
  defenseOrder.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(defenseOrder, 'p1', 'camouflage');
  giveKeepCard(defenseOrder, 'p1', 'stretchy');
  giveKeepCard(defenseOrder, 'p1', 'armor_plating');
  giveKeepCard(defenseOrder, 'p1', 'wings');
  const orderedRapid = giveKeepCard(defenseOrder, 'p1', 'rapid_healing');
  Object.assign(defenseOrder.players.get('p1')!, { health: 3, energy: 4 });
  setFaces(defenseOrder, ['smash', 'smash', 'smash', 1, 2, 3]);
  const defenseOrderRolls = [0.9, 0, 0];
  prepareAndResolve(defenseOrder, plan(), () => defenseOrderRolls.shift() ?? 0);
  assert(defenseOrder.pendingDefenseDecision?.kind === 'camouflage', 'Camouflage must resolve before other defences');
  rejectUnchanged(defenseOrder, 'manual Rapid Healing cannot interrupt a committed defence packet', () =>
    usePowerCard(defenseOrder, 'p1', orderedRapid.instanceId, {}, defenseOrder.revision));
  accept(defenseOrder, 'keep ordered Camouflage dice', () =>
    decideDefense(defenseOrder, 'p1', { kind: 'camouflage', changes: [] }, defenseOrder.revision));
  assert(
    String(defenseOrder.pendingDefenseDecision?.kind) === 'wings' &&
      defenseOrder.pendingDefenseDecision.remainingDamage === 2,
    'Armor must run after Camouflage and Wings must receive the residual multi-health packet',
  );
  accept(defenseOrder, 'decline ordered Wings', () =>
    decideDefense(defenseOrder, 'p1', { kind: 'wings', use: false }, defenseOrder.revision));
  assert(
    String(defenseOrder.pendingDefenseDecision?.kind) === 'rapid_healing' &&
      defenseOrder.pendingDefenseDecision.maxActivations === 2,
    'Rapid Healing must be offered after Wings with an event-time activation limit',
  );
  accept(defenseOrder, 'choose one ordered Rapid Healing activation', () =>
    decideDefense(defenseOrder, 'p1', { kind: 'rapid_healing', activations: 1 }, defenseOrder.revision));
  assert(
    defenseOrder.players.get('p1')!.health === 2 && defenseOrder.players.get('p1')!.energy === 2,
    'Rapid Healing must apply the chosen healing immediately before residual health loss',
  );

  const timeoutWings = initKingOfTokyoGame('ABSENT-WINGS', players(2), seededRandom(266), 'p0');
  timeoutWings.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(timeoutWings, 'p1', 'wings');
  Object.assign(timeoutWings.players.get('p1')!, { health: 2, energy: 2, defenseMode: 'lethal' as const });
  setFaces(timeoutWings, ['smash', 'smash', 1, 2, 3, 'energy']);
  prepareAndResolve(timeoutWings);
  accept(timeoutWings, 'absent Wings owner uses lethal reconnect default', () =>
    resolveAbsentDecision(timeoutWings, 'p1', timeoutWings.revision, seededRandom(267)));
  assert(
    timeoutWings.players.get('p1')!.health === 2 && timeoutWings.players.get('p1')!.energy === 0,
    'Wings timeout must honour the saved lethal reconnect preference',
  );

  const timeoutRapid = initKingOfTokyoGame('ABSENT-RAPID', players(2), seededRandom(268), 'p0');
  timeoutRapid.players.get('p0')!.tokyoZone = 'tokyo_city';
  giveKeepCard(timeoutRapid, 'p1', 'rapid_healing');
  Object.assign(timeoutRapid.players.get('p1')!, { health: 1, energy: 6, rapidHealingMode: 'lethal' as const });
  setFaces(timeoutRapid, ['smash', 'smash', 'smash', 1, 2, 3]);
  prepareAndResolve(timeoutRapid);
  accept(timeoutRapid, 'absent Rapid Healing owner uses lethal reconnect default', () =>
    resolveAbsentDecision(timeoutRapid, 'p1', timeoutRapid.revision, seededRandom(269)));
  assert(
    timeoutRapid.players.get('p1')!.health === 1 && timeoutRapid.players.get('p1')!.energy === 0,
    'Rapid Healing timeout must buy exactly the health needed to survive in lethal mode',
  );
}

function powerCardScenarios(): void {
  assert(KING_OF_TOKYO_POWER_CARDS.length === 64, 'catalogue must contain 64 distinct powers');
  assert(KING_OF_TOKYO_DECK_SIZE === 66, 'catalogue copies must produce the 66-card deck');
  assert(KING_OF_TOKYO_POWER_CARD_BY_ID.energy_drink.cost === 4, '2016 Energy Drink must cost 4 energy');
  for (const definition of KING_OF_TOKYO_POWER_CARDS) {
    const state = initKingOfTokyoGame('CARD-' + definition.id, players(6), seededRandom(100), 'p0');
    const buyer = state.players.get('p0')!;
    buyer.energy = 100;
    state.phase = 'buying_cards';
    exposeCard(state, definition.id);
    accept(state, 'acquire catalogue card ' + definition.id, () =>
      buyPowerCard(state, 'p0', 0, state.revision, seededRandom(101)));
    if (definition.kind === 'keep') {
      assert(buyer.powerCards.some((card) => card.cardId === definition.id), definition.id + ' must attach');
    } else {
      assert(state.discardPile.some((card) => card.cardId === definition.id), definition.id + ' must discard');
    }
  }

  const atomicDiscardOutcome = (
    cardId: 'flame_thrower' | 'gas_refinery' | 'high_altitude_bombing',
    order: readonly string[],
  ) => {
    const state = initKingOfTokyoGame(
      `ATOMIC-${cardId}`,
      order.map((playerId) => ({ playerId, displayName: playerId })),
      seededRandom(102),
      'p0',
    );
    const amount = cardId === 'flame_thrower' ? 2 : 3;
    const biggerSource = giveKeepCard(state, 'p1', 'even_bigger');
    const copiedBigger = giveKeepCard(state, 'p2', 'mimic');
    copiedBigger.mimicTargetInstanceId = biggerSource.instanceId;
    giveKeepCard(state, 'p2', 'it_has_a_child');
    giveKeepCard(state, 'p3', 'eater_of_the_dead');
    giveKeepCard(state, 'p4', 'wings');
    state.players.get('p0')!.energy = 100;
    state.players.get('p1')!.health = amount;
    state.players.get('p2')!.maxHealth = 12;
    state.players.get('p2')!.health = amount + 1;
    state.players.get('p4')!.health = amount;
    state.players.get('p4')!.energy = 2;
    state.players.get('p4')!.defenseMode = 'lethal';
    state.phase = 'buying_cards';
    exposeCard(state, cardId);
    accept(state, `${cardId} resolves one atomic damage packet`, () =>
      buyPowerCard(state, 'p0', 0, state.revision, seededRandom(103)));
    assert(
      state.pendingDefenseDecision?.kind === 'wings' && state.pendingDefenseDecision.playerId === 'p4',
      `${cardId} must pause for the off-turn Wings owner`,
    );
    accept(state, `${cardId} Wings decision`, () =>
      decideDefense(state, 'p4', { kind: 'wings', use: true }, state.revision, seededRandom(1031)));
    const outcome = Object.fromEntries(['p0', 'p1', 'p2', 'p3', 'p4'].map((playerId) => {
      const player = state.players.get(playerId)!;
      return [playerId, {
        health: player.health,
        maxHealth: player.maxHealth,
        eliminated: player.eliminated,
        victoryPoints: player.victoryPoints,
        energy: player.energy,
        cards: player.powerCards.map((card) => card.cardId).sort(),
      }];
    }));
    assert(
      outcome.p1.eliminated && !outcome.p2.eliminated && outcome.p2.health === 1 &&
        outcome.p2.maxHealth === 10 && outcome.p2.cards.length === 2 &&
        outcome.p3.victoryPoints === 3 && outcome.p4.health === amount && outcome.p4.energy === 0,
      `${cardId} must resolve its damage once, without a second fatal packet from copied maximum loss`,
    );
    if (cardId === 'high_altitude_bombing') {
      assert(outcome.p0.health === 7, 'High Altitude Bombing must include its buyer in the atomic packet');
    } else {
      assert(outcome.p0.health === 10, `${cardId} must damage rivals only`);
    }
    return JSON.stringify(outcome);
  };
  for (const cardId of ['flame_thrower', 'gas_refinery', 'high_altitude_bombing'] as const) {
    assert(
      atomicDiscardOutcome(cardId, ['p0', 'p1', 'p2', 'p3', 'p4']) ===
        atomicDiscardOutcome(cardId, ['p0', 'p4', 'p3', 'p2', 'p1']),
      `${cardId} damage and fatal topology must not depend on seating order`,
    );
  }

  const tiedUnderdog = initKingOfTokyoGame('UNDERDOG-TIE', players(3), seededRandom(104), 'p0');
  giveKeepCard(tiedUnderdog, 'p0', 'rooting_for_underdog');
  tiedUnderdog.players.get('p0')!.victoryPoints = 1;
  tiedUnderdog.players.get('p1')!.victoryPoints = 1;
  tiedUnderdog.players.get('p2')!.victoryPoints = 2;
  tiedUnderdog.phase = 'buying_cards';
  accept(tiedUnderdog, 'tied-lowest Underdog ends turn', () =>
    endTurn(tiedUnderdog, 'p0', tiedUnderdog.revision, seededRandom(105)));
  assert(
    tiedUnderdog.players.get('p0')!.victoryPoints === 1 &&
      !tiedUnderdog.pendingEndTurnEffects.some((effect) => effect.kind === 'rooting_for_underdog'),
    'Rooting for the Underdog must not reward a player tied for the lowest score',
  );

  const soleUnderdog = initKingOfTokyoGame('UNDERDOG-SOLE', players(3), seededRandom(106), 'p0');
  giveKeepCard(soleUnderdog, 'p0', 'rooting_for_underdog');
  soleUnderdog.players.get('p1')!.victoryPoints = 1;
  soleUnderdog.players.get('p2')!.victoryPoints = 2;
  soleUnderdog.phase = 'buying_cards';
  accept(soleUnderdog, 'sole-lowest Underdog scores', () =>
    endTurn(soleUnderdog, 'p0', soleUnderdog.revision, seededRandom(107)));
  assert(soleUnderdog.players.get('p0')!.victoryPoints === 1,
    'Rooting for the Underdog must reward the sole lowest score');

  const offTurnUnderdog = initKingOfTokyoGame('UNDERDOG-OFF-TURN', players(3), seededRandom(108), 'p0');
  giveKeepCard(offTurnUnderdog, 'p1', 'rooting_for_underdog');
  offTurnUnderdog.players.get('p0')!.victoryPoints = 2;
  offTurnUnderdog.players.get('p2')!.victoryPoints = 3;
  offTurnUnderdog.phase = 'buying_cards';
  accept(offTurnUnderdog, 'opponent ends turn before lowest-score owner', () =>
    endTurn(offTurnUnderdog, 'p0', offTurnUnderdog.revision));
  assert(offTurnUnderdog.players.get('p1')!.victoryPoints === 0,
    'Underdog must not score at another monster turn end');

  const copiedUnderdog = initKingOfTokyoGame('UNDERDOG-COPIED', players(2), seededRandom(109), 'p0');
  const rootingSource = giveKeepCard(copiedUnderdog, 'p0', 'rooting_for_underdog');
  const rootingMimic = giveKeepCard(copiedUnderdog, 'p0', 'mimic');
  rootingMimic.mimicTargetInstanceId = rootingSource.instanceId;
  copiedUnderdog.players.get('p1')!.victoryPoints = 3;
  copiedUnderdog.phase = 'buying_cards';
  accept(copiedUnderdog, 'copied sole-lowest Underdog scores', () =>
    endTurn(copiedUnderdog, 'p0', copiedUnderdog.revision, seededRandom(110)));
  assert(copiedUnderdog.players.get('p0')!.victoryPoints === 2,
    'two effective Rooting for the Underdog copies must stack for the sole lowest score');

  const tokyoDeathFromAbove = initKingOfTokyoGame('DFA-IN-TOKYO', players(2), seededRandom(111), 'p0');
  tokyoDeathFromAbove.players.get('p0')!.tokyoZone = 'tokyo_city';
  tokyoDeathFromAbove.players.get('p0')!.energy = 20;
  tokyoDeathFromAbove.phase = 'buying_cards';
  exposeCard(tokyoDeathFromAbove, 'drop_from_high_altitude');
  accept(tokyoDeathFromAbove, 'Death from Above scores while already in Tokyo', () =>
    buyPowerCard(tokyoDeathFromAbove, 'p0', 0, tokyoDeathFromAbove.revision, seededRandom(112)));
  assert(
    tokyoDeathFromAbove.players.get('p0')!.victoryPoints === 2 &&
      tokyoDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city',
    'Death from Above grants its printed points without entering Tokyo twice',
  );

  const emptyDeathFromAbove = initKingOfTokyoGame('DFA-EMPTY', players(2), seededRandom(113), 'p0');
  emptyDeathFromAbove.players.get('p0')!.energy = 20;
  emptyDeathFromAbove.phase = 'buying_cards';
  exposeCard(emptyDeathFromAbove, 'drop_from_high_altitude');
  accept(emptyDeathFromAbove, 'Death from Above enters empty Tokyo', () =>
    buyPowerCard(emptyDeathFromAbove, 'p0', 0, emptyDeathFromAbove.revision, seededRandom(114)));
  assert(
    emptyDeathFromAbove.players.get('p0')!.victoryPoints === 3 &&
      emptyDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city',
    'outside Death from Above must gain 2 points then normal entry point in an empty Tokyo City',
  );

  const openCityDeathFromAbove = initKingOfTokyoGame('DFA-FORCED-BAY', players(5), seededRandom(115), 'p0');
  openCityDeathFromAbove.players.get('p1')!.tokyoZone = 'tokyo_bay';
  giveKeepCard(openCityDeathFromAbove, 'p1', 'burrowing');
  openCityDeathFromAbove.players.get('p0')!.energy = 20;
  openCityDeathFromAbove.phase = 'buying_cards';
  exposeCard(openCityDeathFromAbove, 'drop_from_high_altitude');
  accept(openCityDeathFromAbove, 'Death from Above displaces the sole occupant despite an open zone', () =>
    buyPowerCard(openCityDeathFromAbove, 'p0', 0, openCityDeathFromAbove.revision, seededRandom(116)));
  assert(
    openCityDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city' &&
      openCityDeathFromAbove.players.get('p0')!.victoryPoints === 3 &&
      openCityDeathFromAbove.players.get('p0')!.health === 10 &&
      openCityDeathFromAbove.players.get('p1')!.tokyoZone === null,
    'Death from Above clears Bay and enters empty City, without taking the Burrowing zone',
  );

  const chosenDeathFromAbove = initKingOfTokyoGame('DFA-CHOICE', players(5), seededRandom(117), 'p0');
  chosenDeathFromAbove.players.get('p1')!.tokyoZone = 'tokyo_city';
  chosenDeathFromAbove.players.get('p2')!.tokyoZone = 'tokyo_bay';
  const cityBurrowing = giveKeepCard(chosenDeathFromAbove, 'p1', 'burrowing');
  giveKeepCard(chosenDeathFromAbove, 'p2', 'mimic').mimicTargetInstanceId = cityBurrowing.instanceId;
  giveKeepCard(chosenDeathFromAbove, 'p3', 'opportunist');
  chosenDeathFromAbove.players.get('p0')!.energy = 20;
  chosenDeathFromAbove.players.get('p3')!.energy = 20;
  chosenDeathFromAbove.phase = 'buying_cards';
  exposeCard(chosenDeathFromAbove, 'drop_from_high_altitude');
  putCardOnDeckTop(chosenDeathFromAbove, 'corner_store');
  accept(chosenDeathFromAbove, 'Death from Above resolves both Tokyo occupants', () =>
    buyPowerCard(chosenDeathFromAbove, 'p0', 0, chosenDeathFromAbove.revision, seededRandom(118)));
  assert(
    chosenDeathFromAbove.pendingDeathFromAbove === null &&
      chosenDeathFromAbove.players.get('p0')!.victoryPoints === 3 &&
      chosenDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city',
    'Death from Above resolves all yields and entry without an obsolete target choice',
  );
  rejectUnchanged(chosenDeathFromAbove, 'Death from Above rejects an outside target', () =>
    chooseDeathFromAboveTarget(chosenDeathFromAbove, 'p0', 'p4', chosenDeathFromAbove.revision));
  assert(
    chosenDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city' &&
      chosenDeathFromAbove.players.get('p0')!.victoryPoints === 3 &&
      chosenDeathFromAbove.players.get('p0')!.health === 9 &&
      chosenDeathFromAbove.players.get('p1')!.tokyoZone === null &&
      chosenDeathFromAbove.players.get('p2')!.tokyoZone === null,
    'both occupants yield, but only the Burrowing owner whose zone is entered retaliates',
  );
  assert(
    String(chosenDeathFromAbove.phase) === 'awaiting_opportunist' &&
      chosenDeathFromAbove.pendingOpportunist?.playerIds[0] === 'p3',
    'the replacement reveal Opportunist window must resume only after Death from Above is complete',
  );

  const labDeathFromAbove = initKingOfTokyoGame('DFA-LAB', players(5), seededRandom(120), 'p0');
  giveKeepCard(labDeathFromAbove, 'p0', 'made_in_a_lab');
  labDeathFromAbove.players.get('p1')!.tokyoZone = 'tokyo_city';
  labDeathFromAbove.players.get('p2')!.tokyoZone = 'tokyo_bay';
  labDeathFromAbove.players.get('p0')!.energy = 20;
  labDeathFromAbove.phase = 'buying_cards';
  labDeathFromAbove.labOffersRemaining = 1;
  putCardOnDeckTop(labDeathFromAbove, 'drop_from_high_altitude');
  accept(labDeathFromAbove, 'Made in a Lab buys Death from Above', () =>
    buyLabCard(labDeathFromAbove, 'p0', labDeathFromAbove.revision, seededRandom(121)));
  assert(
    labDeathFromAbove.pendingDeathFromAbove === null &&
      labDeathFromAbove.players.get('p0')!.tokyoZone === 'tokyo_city' &&
      labDeathFromAbove.players.get('p2')!.tokyoZone === null,
    'Lab acquisition resolves all yields before buying resumes',
  );
  assert(
    currentId(labDeathFromAbove) === 'p0' && String(labDeathFromAbove.phase) === 'buying_cards',
    'Death from Above bought through Lab must resume the same buying turn',
  );

  const opportunistDeathFromAbove = initKingOfTokyoGame('DFA-OPPORTUNIST-POISON', players(5), seededRandom(123), 'p0');
  giveKeepCard(opportunistDeathFromAbove, 'p1', 'opportunist');
  opportunistDeathFromAbove.players.get('p0')!.tokyoZone = 'tokyo_city';
  opportunistDeathFromAbove.players.get('p2')!.tokyoZone = 'tokyo_bay';
  opportunistDeathFromAbove.players.get('p0')!.health = 1;
  opportunistDeathFromAbove.players.get('p0')!.poisonTokens = 1;
  opportunistDeathFromAbove.players.get('p1')!.energy = 20;
  opportunistDeathFromAbove.phase = 'awaiting_opportunist';
  exposeCard(opportunistDeathFromAbove, 'drop_from_high_altitude');
  opportunistDeathFromAbove.pendingOpportunist = {
    cardInstanceId: opportunistDeathFromAbove.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  accept(opportunistDeathFromAbove, 'off-turn Opportunist buys Death from Above', () =>
    decideOpportunist(opportunistDeathFromAbove, 'p1', true, opportunistDeathFromAbove.revision, seededRandom(124)));
  assert(opportunistDeathFromAbove.pendingDeathFromAbove === null &&
    opportunistDeathFromAbove.players.get('p1')!.tokyoZone === 'tokyo_city',
    'off-turn Death from Above resolves every other occupant without a choice');
  Object.assign(opportunistDeathFromAbove.players.get('p3')!, { health: 0, eliminated: true });
  Object.assign(opportunistDeathFromAbove.players.get('p4')!, { health: 0, eliminated: true });
  accept(opportunistDeathFromAbove, 'target forfeit resolves remaining Death from Above choice', () =>
    forfeitPlayer(opportunistDeathFromAbove, 'p2', opportunistDeathFromAbove.revision, seededRandom(127)));
  assert(
    opportunistDeathFromAbove.status === 'playing' &&
      !opportunistDeathFromAbove.players.get('p0')!.eliminated &&
      !opportunistDeathFromAbove.players.get('p1')!.eliminated &&
      opportunistDeathFromAbove.players.get('p0')!.tokyoZone === null &&
      opportunistDeathFromAbove.players.get('p1')!.tokyoZone === 'tokyo_city' &&
      String(opportunistDeathFromAbove.phase) === 'awaiting_opportunist' &&
      opportunistDeathFromAbove.pendingOpportunist?.playerIds[0] === 'p1',
    'off-turn Death from Above must resume its replacement reveal before the active buy step',
  );
  accept(opportunistDeathFromAbove, 'decline resumed Death from Above replacement reveal', () =>
    decideOpportunist(opportunistDeathFromAbove, 'p1', false, opportunistDeathFromAbove.revision));
  accept(opportunistDeathFromAbove, 'pending Poison adjudicates after provisional sole survivor', () =>
    endTurn(opportunistDeathFromAbove, 'p0', opportunistDeathFromAbove.revision, seededRandom(128)));
  assert(
    String(opportunistDeathFromAbove.status) === 'game_over' &&
      opportunistDeathFromAbove.winnerId === 'p1' &&
      opportunistDeathFromAbove.victoryType === 'last_monster_standing',
    'the active monster must still suffer end-turn Poison before the remaining monster wins',
  );

  const market = initKingOfTokyoGame('MARKET', players(2), seededRandom(27), 'p0');
  market.players.get('p0')!.energy = 100;
  market.phase = 'buying_cards';
  for (const cardId of ['corner_store', 'commuter_train', 'skyscraper'] as const) {
    exposeCard(market, cardId);
    accept(market, 'repeat market buy ' + cardId, () =>
      buyPowerCard(market, 'p0', 0, market.revision, seededRandom(28)));
  }
  accept(market, 'first repeated sweep', () =>
    sweepPowerCards(market, 'p0', market.revision, seededRandom(29)));
  accept(market, 'second repeated sweep', () =>
    sweepPowerCards(market, 'p0', market.revision, seededRandom(30)));
  assert(market.market.every(Boolean), 'every purchase and sweep must immediately restock');

  const restock = initKingOfTokyoGame('RESTOCK', players(2), seededRandom(31), 'p0');
  restock.players.get('p0')!.energy = 10;
  restock.phase = 'buying_cards';
  restock.discardPile.push(...restock.deck.splice(0));
  accept(restock, 'discard reshuffle sweep', () =>
    sweepPowerCards(restock, 'p0', restock.revision, seededRandom(32)));
  assert(restock.market.every(Boolean) && restock.deck.length > 0, 'empty deck must reshuffle discarded powers');

  for (const deckLength of [0, 1, 2]) {
    const exhaustedSweep = initKingOfTokyoGame(`SWEEP-SHORT-DECK-${deckLength}`, players(3), seededRandom(321 + deckLength), 'p0');
    if (deckLength === 0) {
      giveKeepCard(exhaustedSweep, 'p1', 'opportunist');
      exhaustedSweep.players.get('p1')!.energy = 100;
    }
    for (let index = 0; index < exhaustedSweep.market.length; index += 1) {
      if (!exhaustedSweep.market[index]) exhaustedSweep.market[index] = exhaustedSweep.deck.shift()!;
    }
    const originalMarketIds = exhaustedSweep.market.map((card) => card!.instanceId);
    const shortDeck = exhaustedSweep.deck.splice(0, deckLength);
    exhaustedSweep.discardPile.push(...exhaustedSweep.deck.splice(0));
    exhaustedSweep.deck = shortDeck;
    exhaustedSweep.players.get('p0')!.energy = 10;
    exhaustedSweep.phase = 'buying_cards';
    let inspectedReshuffle = false;
    const inspectSweepReshuffle = () => {
      if (!inspectedReshuffle) {
        inspectedReshuffle = true;
        assert(
          originalMarketIds.every((instanceId) =>
            [...exhaustedSweep.deck, ...exhaustedSweep.discardPile]
              .some((card) => card.instanceId === instanceId)),
          `all market slots must enter discard before a ${deckLength}-card deck is reshuffled`,
        );
      }
      return 0.25;
    };
    accept(exhaustedSweep, `${deckLength}-card deck sweep`, () =>
      sweepPowerCards(exhaustedSweep, 'p0', exhaustedSweep.revision, inspectSweepReshuffle));
    assert(inspectedReshuffle && exhaustedSweep.market.every(Boolean),
      `${deckLength}-card sweep must reshuffle only after clearing and refill all three slots`);
    if (deckLength === 0) {
      assert(
        String(exhaustedSweep.phase) === 'awaiting_opportunist' &&
          exhaustedSweep.pendingOpportunist?.cardInstanceId === exhaustedSweep.market[0]!.instanceId &&
          exhaustedSweep.opportunistRevealQueue.length === 2,
        'all three short-deck sweep replacements must retain their ordered Opportunist windows',
      );
    }
  }

  const priority = initKingOfTokyoGame('OPPORTUNIST', players(4), seededRandom(33), 'p0');
  const opportunity = giveKeepCard(priority, 'p1', 'opportunist');
  giveKeepCard(priority, 'p3', 'mimic').mimicTargetInstanceId = opportunity.instanceId;
  priority.players.get('p0')!.energy = 20;
  priority.players.get('p1')!.energy = 20;
  priority.players.get('p3')!.energy = 20;
  priority.phase = 'buying_cards';
  accept(priority, 'open clockwise Opportunist window', () =>
    sweepPowerCards(priority, 'p0', priority.revision, seededRandom(34)));
  assert(
    priority.pendingOpportunist?.playerIds.join(',') === 'p1,p3',
    'Opportunist must start clockwise after active and exclude active buyer',
  );

  const ownOpportunity = initKingOfTokyoGame('OWN-OPPORTUNIST', players(3), seededRandom(35), 'p0');
  giveKeepCard(ownOpportunity, 'p0', 'opportunist');
  ownOpportunity.players.get('p0')!.energy = 20;
  ownOpportunity.phase = 'buying_cards';
  accept(ownOpportunity, 'active Opportunist sweeps normally', () =>
    sweepPowerCards(ownOpportunity, 'p0', ownOpportunity.revision, seededRandom(36)));
  assert(
    ownOpportunity.phase === 'buying_cards' && ownOpportunity.pendingOpportunist === null,
    'active owner must buy normally rather than pre-empt themself',
  );

  const probeOrder = initKingOfTokyoGame('PROBE-ORDER', players(5), seededRandom(37), 'p3');
  const probe = giveKeepCard(probeOrder, 'p4', 'psychic_probe');
  giveKeepCard(probeOrder, 'p1', 'mimic').mimicTargetInstanceId = probe.instanceId;
  setFaces(probeOrder, [1, 2, 3, 'energy', 'smash', 'heart']);
  accept(probeOrder, 'open ordered Probe reactions', () =>
    prepareDiceResolution(probeOrder, 'p3', probeOrder.revision));
  assert(
    probeOrder.pendingPsychicProbes.map((entry) => entry.playerId).join(',') === 'p4,p1',
    'multiple Probe reactions use deterministic clockwise-from-active order',
  );

  const mimic = initKingOfTokyoGame('MIMIC', players(2), seededRandom(38), 'p0');
  const mimicCard = giveKeepCard(mimic, 'p0', 'mimic');
  const acid = giveKeepCard(mimic, 'p1', 'acid_attack');
  const bigger = giveKeepCard(mimic, 'p1', 'even_bigger');
  mimic.players.get('p0')!.energy = 5;
  accept(mimic, 'single Mimic start retarget', () =>
    usePowerCard(mimic, 'p0', mimicCard.instanceId, {
      targetCardInstanceId: bigger.instanceId,
    }, mimic.revision));
  rejectUnchanged(mimic, 'second Mimic retarget in one start', () =>
    usePowerCard(mimic, 'p0', mimicCard.instanceId, {
      targetCardInstanceId: acid.instanceId,
    }, mimic.revision));

  const initialMimic = initKingOfTokyoGame('INITIAL-MIMIC', players(2), seededRandom(39), 'p0');
  const ownAcid = giveKeepCard(initialMimic, 'p0', 'acid_attack');
  const rivalBigger = giveKeepCard(initialMimic, 'p1', 'even_bigger');
  initialMimic.players.get('p0')!.energy = 20;
  initialMimic.phase = 'buying_cards';
  exposeCard(initialMimic, 'mimic');
  accept(initialMimic, 'buy initial Mimic', () =>
    buyPowerCard(initialMimic, 'p0', 0, initialMimic.revision, seededRandom(40)));
  const boughtMimic = initialMimic.players.get('p0')!.powerCards.find((card) => card.cardId === 'mimic')!;
  accept(initialMimic, 'initial Mimic own Keep target', () =>
    usePowerCard(initialMimic, 'p0', boughtMimic.instanceId, {
      targetCardInstanceId: ownAcid.instanceId,
    }, initialMimic.revision));
  rejectUnchanged(initialMimic, 'initial Mimic cannot choose twice', () =>
    usePowerCard(initialMimic, 'p0', boughtMimic.instanceId, {
      targetCardInstanceId: rivalBigger.instanceId,
    }, initialMimic.revision));

  const activeMimicReveal = initKingOfTokyoGame('INITIAL-MIMIC-REVEAL', players(3), seededRandom(401), 'p0');
  const activeRevealOpportunity = giveKeepCard(activeMimicReveal, 'p1', 'opportunist');
  const activeRevealTarget = giveKeepCard(activeMimicReveal, 'p2', 'acid_attack');
  activeMimicReveal.players.get('p0')!.energy = 20;
  activeMimicReveal.players.get('p1')!.energy = 20;
  activeMimicReveal.phase = 'buying_cards';
  exposeCard(activeMimicReveal, 'mimic');
  putCardOnDeckTop(activeMimicReveal, 'corner_store');
  accept(activeMimicReveal, 'active player buys Mimic before replacement reveal', () =>
    buyPowerCard(activeMimicReveal, 'p0', 0, activeMimicReveal.revision, seededRandom(402)));
  const activeBoughtMimic = activeMimicReveal.players.get('p0')!.powerCards.find((card) => card.cardId === 'mimic')!;
  assert(
    String(activeMimicReveal.phase) === 'buying_cards' && activeMimicReveal.pendingOpportunist === null &&
      activeMimicReveal.opportunistRevealQueue.length === 1,
    'replacement reveal must remain queued until the newly bought Mimic chooses its initial target',
  );
  accept(activeMimicReveal, 'active Mimic target releases replacement reveal', () =>
    usePowerCard(activeMimicReveal, 'p0', activeBoughtMimic.instanceId, {
      targetCardInstanceId: activeRevealTarget.instanceId,
    }, activeMimicReveal.revision));
  assert(
    String(activeMimicReveal.phase) === 'awaiting_opportunist' &&
      (activeMimicReveal.pendingOpportunist as { playerIds: string[] } | null)?.playerIds.join(',') === 'p1' &&
      activeRevealOpportunity.cardId === 'opportunist',
    'the queued replacement reveal must open to eligible Opportunists only after initial targeting',
  );

  const offTurnMimicReveal = initKingOfTokyoGame('OPPORTUNIST-MIMIC-REVEAL', players(3), seededRandom(403), 'p0');
  giveKeepCard(offTurnMimicReveal, 'p1', 'opportunist');
  const offTurnRevealTarget = giveKeepCard(offTurnMimicReveal, 'p2', 'acid_attack');
  offTurnMimicReveal.players.get('p1')!.energy = 30;
  offTurnMimicReveal.phase = 'awaiting_opportunist';
  exposeCard(offTurnMimicReveal, 'mimic');
  putCardOnDeckTop(offTurnMimicReveal, 'corner_store');
  offTurnMimicReveal.pendingOpportunist = {
    cardInstanceId: offTurnMimicReveal.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  accept(offTurnMimicReveal, 'off-turn Opportunist buys Mimic before replacement reveal', () =>
    decideOpportunist(offTurnMimicReveal, 'p1', true, offTurnMimicReveal.revision, seededRandom(404)));
  const offTurnBoughtMimic = offTurnMimicReveal.players.get('p1')!.powerCards.find((card) => card.cardId === 'mimic')!;
  assert(
    String(offTurnMimicReveal.phase) === 'awaiting_opportunist' && offTurnMimicReveal.pendingOpportunist === null &&
      offTurnMimicReveal.opportunistRevealQueue.length === 1,
    'off-turn Mimic targeting must own the decision before the replacement Opportunist window',
  );
  accept(offTurnMimicReveal, 'off-turn Mimic target releases its replacement reveal', () =>
    usePowerCard(offTurnMimicReveal, 'p1', offTurnBoughtMimic.instanceId, {
      targetCardInstanceId: offTurnRevealTarget.instanceId,
    }, offTurnMimicReveal.revision));
  assert(
    String(offTurnMimicReveal.phase) === 'awaiting_opportunist' &&
      (offTurnMimicReveal.pendingOpportunist as { playerIds: string[] } | null)?.playerIds.join(',') === 'p1',
    'off-turn Mimic buyer must retain its physical Opportunist eligibility for the delayed reveal',
  );

  const sameBatteryMimic = initKingOfTokyoGame('MIMIC-SAME-BATTERY', players(2), seededRandom(405), 'p0');
  const batteryMimic = giveKeepCard(sameBatteryMimic, 'p0', 'mimic');
  const batteryTarget = giveKeepCard(sameBatteryMimic, 'p1', 'battery_monster');
  batteryMimic.mimicTargetInstanceId = batteryTarget.instanceId;
  batteryMimic.counters = 4;
  sameBatteryMimic.players.get('p0')!.energy = 5;
  rejectUnchanged(sameBatteryMimic, 'Mimic cannot pay to refresh the same Battery target', () =>
    usePowerCard(sameBatteryMimic, 'p0', batteryMimic.instanceId, {
      targetCardInstanceId: batteryTarget.instanceId,
    }, sameBatteryMimic.revision));

  const sameSmokeMimic = initKingOfTokyoGame('MIMIC-SAME-SMOKE', players(2), seededRandom(406), 'p0');
  const smokeMimic = giveKeepCard(sameSmokeMimic, 'p0', 'mimic');
  const smokeTarget = giveKeepCard(sameSmokeMimic, 'p1', 'smoke_cloud');
  smokeMimic.mimicTargetInstanceId = smokeTarget.instanceId;
  smokeMimic.counters = 1;
  sameSmokeMimic.players.get('p0')!.energy = 5;
  rejectUnchanged(sameSmokeMimic, 'Mimic cannot pay to refresh the same Smoke target', () =>
    usePowerCard(sameSmokeMimic, 'p0', smokeMimic.instanceId, {
      targetCardInstanceId: smokeTarget.instanceId,
    }, sameSmokeMimic.revision));

  const metamorph = initKingOfTokyoGame('METAMORPH', players(2), seededRandom(41), 'p0');
  const meta = giveKeepCard(metamorph, 'p0', 'metamorph');
  const metaAcid = giveKeepCard(metamorph, 'p0', 'acid_attack');
  metamorph.phase = 'buying_cards';
  rejectUnchanged(metamorph, 'Metamorph sale before end-turn window', () =>
    sellOwnedPowerCard(metamorph, 'p0', meta.instanceId, metamorph.revision));
  accept(metamorph, 'open sole Metamorph end-turn window', () =>
    endTurn(metamorph, 'p0', metamorph.revision));
  assert(String(metamorph.phase) === 'selling_cards', 'Metamorph must open sales during the end-turn step');
  accept(metamorph, 'sell Metamorph itself first', () =>
    sellOwnedPowerCard(metamorph, 'p0', meta.instanceId, metamorph.revision));
  accept(metamorph, 'preserve open Metamorph entitlement', () =>
    sellOwnedPowerCard(metamorph, 'p0', metaAcid.instanceId, metamorph.revision));
  assert(
    metamorph.players.get('p0')!.energy === 9 && String(metamorph.phase) === 'selling_cards',
    'sequential sales must return printed costs without reopening the buy phase',
  );
  accept(metamorph, 'finish sole Metamorph window', () => endTurn(metamorph, 'p0', metamorph.revision));
  assert(currentId(metamorph) === 'p1', 'Done Selling must finish the turn when no effects remain');

  const solarThenMetamorph = initKingOfTokyoGame('SOLAR-THEN-METAMORPH', players(2), seededRandom(411), 'p0');
  const soldResolvedSolar = giveKeepCard(solarThenMetamorph, 'p0', 'solar_powered');
  giveKeepCard(solarThenMetamorph, 'p0', 'metamorph');
  solarThenMetamorph.phase = 'buying_cards';
  accept(solarThenMetamorph, 'collect Solar and Metamorph', () =>
    endTurn(solarThenMetamorph, 'p0', solarThenMetamorph.revision));
  accept(solarThenMetamorph, 'resolve Solar before Metamorph', () =>
    resolveEndTurnEffect(solarThenMetamorph, 'p0', 'solar_powered', solarThenMetamorph.revision));
  accept(solarThenMetamorph, 'resolve Metamorph after Solar', () =>
    resolveEndTurnEffect(solarThenMetamorph, 'p0', 'metamorph', solarThenMetamorph.revision));
  accept(solarThenMetamorph, 'sell already-resolved Solar', () =>
    sellOwnedPowerCard(solarThenMetamorph, 'p0', soldResolvedSolar.instanceId, solarThenMetamorph.revision));
  assert(
    solarThenMetamorph.players.get('p0')!.energy === 3,
    'Solar must resolve before its card is sold when the active player chooses Solar then Metamorph',
  );
  accept(solarThenMetamorph, 'finish Solar then Metamorph', () =>
    endTurn(solarThenMetamorph, 'p0', solarThenMetamorph.revision));

  const metamorphThenSolar = initKingOfTokyoGame('METAMORPH-THEN-SOLAR', players(2), seededRandom(412), 'p0');
  giveKeepCard(metamorphThenSolar, 'p0', 'metamorph');
  const untriggeredSolar = giveKeepCard(metamorphThenSolar, 'p0', 'solar_powered');
  metamorphThenSolar.phase = 'buying_cards';
  accept(metamorphThenSolar, 'collect Metamorph and Solar', () =>
    endTurn(metamorphThenSolar, 'p0', metamorphThenSolar.revision));
  accept(metamorphThenSolar, 'resolve Metamorph before Solar', () =>
    resolveEndTurnEffect(metamorphThenSolar, 'p0', 'metamorph', metamorphThenSolar.revision));
  accept(metamorphThenSolar, 'sell still-pending Solar', () =>
    sellOwnedPowerCard(metamorphThenSolar, 'p0', untriggeredSolar.instanceId, metamorphThenSolar.revision));
  assert(
    !metamorphThenSolar.pendingEndTurnEffects.some((effect) => effect.kind === 'solar_powered'),
    'selling Solar before it resolves must cancel its pending card effect',
  );
  accept(metamorphThenSolar, 'finish Metamorph then Solar', () =>
    endTurn(metamorphThenSolar, 'p0', metamorphThenSolar.revision));
  assert(
    metamorphThenSolar.players.get('p0')!.energy === 2,
    'a sold pending Solar must return its cost without also granting Solar energy',
  );

  const metamorphThenHoarder = initKingOfTokyoGame('METAMORPH-THEN-HOARDER', players(2), seededRandom(413), 'p0');
  giveKeepCard(metamorphThenHoarder, 'p0', 'metamorph');
  giveKeepCard(metamorphThenHoarder, 'p0', 'energy_hoarder');
  const recoveredAcid = giveKeepCard(metamorphThenHoarder, 'p0', 'acid_attack');
  metamorphThenHoarder.phase = 'buying_cards';
  accept(metamorphThenHoarder, 'collect Metamorph and Hoarder', () =>
    endTurn(metamorphThenHoarder, 'p0', metamorphThenHoarder.revision));
  accept(metamorphThenHoarder, 'resolve Metamorph before Hoarder', () =>
    resolveEndTurnEffect(metamorphThenHoarder, 'p0', 'metamorph', metamorphThenHoarder.revision));
  accept(metamorphThenHoarder, 'recover energy before Hoarder', () =>
    sellOwnedPowerCard(metamorphThenHoarder, 'p0', recoveredAcid.instanceId, metamorphThenHoarder.revision));
  accept(metamorphThenHoarder, 'resume Hoarder after sales', () =>
    endTurn(metamorphThenHoarder, 'p0', metamorphThenHoarder.revision));
  assert(
    metamorphThenHoarder.players.get('p0')!.energy === 6 && metamorphThenHoarder.players.get('p0')!.victoryPoints === 1,
    'retained Energy Hoarder must score from energy recovered through Metamorph',
  );

  const pendingMimic = initKingOfTokyoGame('METAMORPH-MIMIC-PENDING', players(2), seededRandom(414), 'p0');
  giveKeepCard(pendingMimic, 'p0', 'metamorph');
  const pendingHoarder = giveKeepCard(pendingMimic, 'p0', 'energy_hoarder');
  const soldMimic = giveKeepCard(pendingMimic, 'p0', 'mimic');
  soldMimic.mimicTargetInstanceId = pendingHoarder.instanceId;
  pendingMimic.phase = 'buying_cards';
  accept(pendingMimic, 'collect copied Hoarder effects', () =>
    endTurn(pendingMimic, 'p0', pendingMimic.revision));
  assert(
    pendingMimic.pendingEndTurnEffects.find((effect) => effect.kind === 'energy_hoarder')?.copies === 2,
    'Mimic must contribute a separate pending Hoarder copy',
  );
  accept(pendingMimic, 'resolve Metamorph before copied Hoarder', () =>
    resolveEndTurnEffect(pendingMimic, 'p0', 'metamorph', pendingMimic.revision));
  accept(pendingMimic, 'sell pending Mimic effect copy', () =>
    sellOwnedPowerCard(pendingMimic, 'p0', soldMimic.instanceId, pendingMimic.revision));
  assert(
    pendingMimic.pendingEndTurnEffects.find((effect) => effect.kind === 'energy_hoarder')?.copies === 1,
    'selling Mimic must decrement the still-pending effective card copies',
  );
  accept(pendingMimic, 'resume reduced Hoarder effect', () =>
    endTurn(pendingMimic, 'p0', pendingMimic.revision));
  assert(
    pendingMimic.players.get('p0')!.victoryPoints === 1,
    'only the retained Hoarder source may score after its Mimic copy is sold',
  );

  const pendingSource = initKingOfTokyoGame('METAMORPH-SOURCE-PENDING', players(2), seededRandom(415), 'p0');
  giveKeepCard(pendingSource, 'p0', 'metamorph');
  const soldHoarder = giveKeepCard(pendingSource, 'p0', 'energy_hoarder');
  giveKeepCard(pendingSource, 'p0', 'mimic').mimicTargetInstanceId = soldHoarder.instanceId;
  pendingSource.phase = 'buying_cards';
  accept(pendingSource, 'collect source and Mimic Hoarder effects', () =>
    endTurn(pendingSource, 'p0', pendingSource.revision));
  accept(pendingSource, 'resolve Metamorph before Hoarder source', () =>
    resolveEndTurnEffect(pendingSource, 'p0', 'metamorph', pendingSource.revision));
  accept(pendingSource, 'sell pending Hoarder source', () =>
    sellOwnedPowerCard(pendingSource, 'p0', soldHoarder.instanceId, pendingSource.revision));
  assert(
    !pendingSource.pendingEndTurnEffects.some((effect) => effect.kind === 'energy_hoarder'),
    'selling a pending source must cancel both it and any Mimic whose effective ID depended on it',
  );
  accept(pendingSource, 'finish cancelled Hoarder source', () =>
    endTurn(pendingSource, 'p0', pendingSource.revision));
  assert(pendingSource.players.get('p0')!.victoryPoints === 0, 'cancelled Hoarder effects must not score');

  const poisonAfterMetamorph = initKingOfTokyoGame('METAMORPH-POISON', players(2), seededRandom(416), 'p0');
  const discardedMetamorph = giveKeepCard(poisonAfterMetamorph, 'p0', 'metamorph');
  poisonAfterMetamorph.players.get('p0')!.poisonTokens = 1;
  poisonAfterMetamorph.phase = 'buying_cards';
  accept(poisonAfterMetamorph, 'collect Metamorph and Poison', () =>
    endTurn(poisonAfterMetamorph, 'p0', poisonAfterMetamorph.revision));
  accept(poisonAfterMetamorph, 'resolve Metamorph before Poison', () =>
    resolveEndTurnEffect(poisonAfterMetamorph, 'p0', 'metamorph', poisonAfterMetamorph.revision));
  accept(poisonAfterMetamorph, 'sell Metamorph while Poison remains', () =>
    sellOwnedPowerCard(poisonAfterMetamorph, 'p0', discardedMetamorph.instanceId, poisonAfterMetamorph.revision));
  assert(
    poisonAfterMetamorph.pendingEndTurnEffects.some((effect) => effect.kind === 'poison'),
    'Metamorph sales must not cancel token-based Poison damage',
  );
  accept(poisonAfterMetamorph, 'resume Poison after Metamorph', () =>
    endTurn(poisonAfterMetamorph, 'p0', poisonAfterMetamorph.revision));
  assert(poisonAfterMetamorph.players.get('p0')!.health === 9, 'Poison must resolve after the sales window');

  const copiedSourceLeaves = initKingOfTokyoGame('COPIED-SOURCE-LEAVES', players(3), seededRandom(417), 'p0');
  const leavingHoarder = giveKeepCard(copiedSourceLeaves, 'p1', 'energy_hoarder');
  const copiedHoarder = giveKeepCard(copiedSourceLeaves, 'p0', 'mimic');
  copiedHoarder.mimicTargetInstanceId = leavingHoarder.instanceId;
  copiedSourceLeaves.players.get('p0')!.energy = 6;
  copiedSourceLeaves.players.get('p0')!.poisonTokens = 1;
  copiedSourceLeaves.phase = 'buying_cards';
  accept(copiedSourceLeaves, 'collect Poison and copied Hoarder', () =>
    endTurn(copiedSourceLeaves, 'p0', copiedSourceLeaves.revision));
  accept(copiedSourceLeaves, 'copied Hoarder source owner leaves', () =>
    forfeitPlayer(copiedSourceLeaves, 'p1', copiedSourceLeaves.revision));
  assert(
    copiedHoarder.mimicTargetInstanceId === null && copiedSourceLeaves.players.get('p0')!.victoryPoints === 0 &&
      copiedSourceLeaves.players.get('p0')!.health === 9 && currentId(copiedSourceLeaves) === 'p2' &&
      !copiedSourceLeaves.pendingEndTurnEffects.length,
    'source-owner leave must cancel stale copied effects while preserving and resolving Poison',
  );

  const sourceLeavesDuringSales = initKingOfTokyoGame('SOURCE-LEAVES-DURING-SALES', players(3), seededRandom(418), 'p0');
  giveKeepCard(sourceLeavesDuringSales, 'p0', 'metamorph');
  giveKeepCard(sourceLeavesDuringSales, 'p0', 'herbivore');
  const salesHoarder = giveKeepCard(sourceLeavesDuringSales, 'p1', 'energy_hoarder');
  const salesMimic = giveKeepCard(sourceLeavesDuringSales, 'p0', 'mimic');
  salesMimic.mimicTargetInstanceId = salesHoarder.instanceId;
  sourceLeavesDuringSales.players.get('p0')!.energy = 6;
  sourceLeavesDuringSales.phase = 'buying_cards';
  accept(sourceLeavesDuringSales, 'collect Metamorph, Herbivore and copied Hoarder', () =>
    endTurn(sourceLeavesDuringSales, 'p0', sourceLeavesDuringSales.revision));
  accept(sourceLeavesDuringSales, 'open Metamorph before source leave', () =>
    resolveEndTurnEffect(sourceLeavesDuringSales, 'p0', 'metamorph', sourceLeavesDuringSales.revision));
  accept(sourceLeavesDuringSales, 'copied source owner leaves during sales', () =>
    forfeitPlayer(sourceLeavesDuringSales, 'p1', sourceLeavesDuringSales.revision));
  assert(
    String(sourceLeavesDuringSales.phase) === 'selling_cards' &&
      sourceLeavesDuringSales.pendingEndTurnEffects.map((effect) => effect.kind).join(',') === 'herbivore',
    'source-owner leave during sales must remove stale copied effects but keep the sale window open',
  );
  accept(sourceLeavesDuringSales, 'finish sales after copied source leaves', () =>
    endTurn(sourceLeavesDuringSales, 'p0', sourceLeavesDuringSales.revision));
  assert(
    sourceLeavesDuringSales.players.get('p0')!.victoryPoints === 1 && currentId(sourceLeavesDuringSales) === 'p2',
    'Done Selling must continue the reconciled remaining end-turn queue',
  );

  const labSourceLeaves = initKingOfTokyoGame('LAB-SOURCE-LEAVES', players(3), seededRandom(419), 'p0');
  const leavingLab = giveKeepCard(labSourceLeaves, 'p1', 'made_in_a_lab');
  const copiedLab = giveKeepCard(labSourceLeaves, 'p0', 'mimic');
  copiedLab.mimicTargetInstanceId = leavingLab.instanceId;
  labSourceLeaves.players.get('p0')!.energy = 20;
  labSourceLeaves.phase = 'buying_cards';
  labSourceLeaves.labOffersRemaining = 1;
  accept(labSourceLeaves, 'copied Lab source owner leaves', () =>
    forfeitPlayer(labSourceLeaves, 'p1', labSourceLeaves.revision, seededRandom(420)));
  assert(
    copiedLab.mimicTargetInstanceId === null && labSourceLeaves.labOffersRemaining === 0 &&
      String(labSourceLeaves.phase) === 'buying_cards',
    'source-owner leave must revoke the active copied Lab offer without ending the buy step',
  );
  rejectUnchanged(labSourceLeaves, 'revoked copied Lab offer', () =>
    buyLabCard(labSourceLeaves, 'p0', labSourceLeaves.revision, seededRandom(421)));

  const transferredLab = initKingOfTokyoGame('TRANSFERRED-LAB-SOURCE', players(3), seededRandom(422), 'p0');
  const ownedLabSource = giveKeepCard(transferredLab, 'p1', 'made_in_a_lab');
  const transferredLabMimic = giveKeepCard(transferredLab, 'p0', 'mimic');
  transferredLabMimic.mimicTargetInstanceId = ownedLabSource.instanceId;
  giveKeepCard(transferredLab, 'p0', 'parasitic_tentacles');
  transferredLab.players.get('p0')!.energy = 30;
  transferredLab.phase = 'buying_cards';
  transferredLab.labOffersRemaining = 1;
  accept(transferredLab, 'transfer copied Lab source without discarding it', () =>
    buyOwnedPowerCard(transferredLab, 'p0', 'p1', ownedLabSource.instanceId, transferredLab.revision));
  assert(
    transferredLabMimic.mimicTargetInstanceId === ownedLabSource.instanceId && transferredLab.labOffersRemaining === 2,
    'Parasitic transfer must preserve the in-play Mimic target and add exactly one new Lab offer',
  );
  putCardOnDeckTop(transferredLab, 'corner_store');
  accept(transferredLab, 'use first transferred Lab offer', () =>
    buyLabCard(transferredLab, 'p0', transferredLab.revision, seededRandom(423)));
  putCardOnDeckTop(transferredLab, 'commuter_train');
  accept(transferredLab, 'use second transferred Lab offer', () =>
    buyLabCard(transferredLab, 'p0', transferredLab.revision, seededRandom(424)));
  assert(Number(transferredLab.labOffersRemaining) === 0, 'each live Lab copy must grant only one offer');

  const exhaustedLab = initKingOfTokyoGame('LAB-SHORT-DECK', players(3), seededRandom(4240), 'p0');
  const exhaustedLabSource = giveKeepCard(exhaustedLab, 'p0', 'made_in_a_lab');
  const exhaustedLabMimic = giveKeepCard(exhaustedLab, 'p0', 'mimic');
  exhaustedLabMimic.mimicTargetInstanceId = exhaustedLabSource.instanceId;
  exhaustedLab.players.get('p0')!.energy = 100;
  exhaustedLab.phase = 'buying_cards';
  exhaustedLab.labOffersRemaining = 2;
  putCardOnDeckTop(exhaustedLab, 'acid_attack');
  exhaustedLab.discardPile.push(...exhaustedLab.deck.splice(1));
  assert(toKingOfTokyoPublicState(exhaustedLab, 'p0').labCard?.cardId === 'acid_attack',
    'the first Lab offer must expose the sole deck card privately');
  accept(exhaustedLab, 'buy first Lab offer before discard reshuffle', () =>
    buyLabCard(exhaustedLab, 'p0', exhaustedLab.revision, seededRandom(42400)));
  assert(
    exhaustedLab.labOffersRemaining === 1 && exhaustedLab.deck.length > 0 &&
      toKingOfTokyoPublicState(exhaustedLab, 'p0').labCard !== null &&
      toKingOfTokyoPublicState(exhaustedLab, 'p1').labCard === null,
    'a remaining Lab offer must reshuffle and privately expose its next card instead of becoming blind',
  );

  for (const health of [1, 2, 9, 12]) {
    const state = initKingOfTokyoGame('BIGGER-CLAMP-' + health, players(3), seededRandom(42400 + health), 'p0');
    giveKeepCard(state, 'p0', 'metamorph');
    const bigger = giveKeepCard(state, 'p0', 'even_bigger');
    for (const card of ['wings', 'rapid_healing', 'camouflage', 'stretchy', 'armor_plating',
      'it_has_a_child', 'making_it_stronger'] as const) giveKeepCard(state, 'p0', card);
    giveKeepCard(state, 'p1', 'eater_of_the_dead');
    const owner = state.players.get('p0')!;
    Object.assign(owner, { health, energy: 6, victoryPoints: 4, defenseMode: 'always', rapidHealingMode: 'always' });
    state.phase = 'buying_cards';
    accept(state, 'open clamp-only sale', () => endTurn(state, 'p0', state.revision));
    accept(state, 'sell Even Bigger without damage', () =>
      sellOwnedPowerCard(state, 'p0', bigger.instanceId, state.revision));
    assert(owner.health === Math.min(health, 10) && owner.maxHealth === 10 &&
      owner.energy === 10 && owner.victoryPoints === 4 && !owner.eliminated &&
      state.players.get('p1')!.victoryPoints === 0 &&
      owner.powerCards.some((card) => card.cardId === 'it_has_a_child') &&
      state.pendingDefenseDecision === null && state.pendingDamageWorkflow === null && String(state.phase) === 'selling_cards',
    'cap loss must not deal damage, offer defences, trigger Child/Eater/Stronger or delay sale proceeds');
  }

  const doubleClamp = initKingOfTokyoGame('BIGGER-DOUBLE-CLAMP', players(3), seededRandom(424025), 'p0');
  giveKeepCard(doubleClamp, 'p0', 'metamorph');
  const doubleSource = giveKeepCard(doubleClamp, 'p0', 'even_bigger');
  const doubleMimic = giveKeepCard(doubleClamp, 'p0', 'mimic');
  doubleMimic.mimicTargetInstanceId = doubleSource.instanceId;
  Object.assign(doubleClamp.players.get('p0')!, { health: 13, maxHealth: 14 });
  doubleClamp.phase = 'buying_cards';
  accept(doubleClamp, 'open doubled cap sale', () => endTurn(doubleClamp, 'p0', doubleClamp.revision));
  accept(doubleClamp, 'sell source of own copied Even Bigger', () =>
    sellOwnedPowerCard(doubleClamp, 'p0', doubleSource.instanceId, doubleClamp.revision));
  assert(doubleClamp.players.get('p0')!.health === 10 && doubleClamp.players.get('p0')!.maxHealth === 10 &&
    doubleMimic.mimicTargetInstanceId === null && doubleClamp.pendingDefenseDecision === null,
  'losing two effective copies clamps to the remaining maximum without damage packets');

  const retargetClamp = initKingOfTokyoGame('BIGGER-RETARGET-CLAMP', players(3), seededRandom(42403), 'p0');
  const retargetSource = giveKeepCard(retargetClamp, 'p1', 'even_bigger');
  const retargetMimic = giveKeepCard(retargetClamp, 'p0', 'mimic');
  const retargetAcid = giveKeepCard(retargetClamp, 'p2', 'acid_attack');
  retargetMimic.mimicTargetInstanceId = retargetSource.instanceId;
  Object.assign(retargetClamp.players.get('p0')!, { health: 9, maxHealth: 12, energy: 2 });
  accept(retargetClamp, 'retarget copied Even Bigger without damage', () =>
    usePowerCard(retargetClamp, 'p0', retargetMimic.instanceId,
      { targetCardInstanceId: retargetAcid.instanceId }, retargetClamp.revision));
  assert(retargetClamp.players.get('p0')!.health === 9 && retargetClamp.players.get('p0')!.maxHealth === 10 &&
    retargetClamp.players.get('p0')!.energy === 1 && retargetClamp.phase === 'awaiting_roll',
  'paid retarget preserves wounded health and only removes the copied maximum');

  for (const copierId of ['p0', 'p2']) {
    const state = initKingOfTokyoGame('BIGGER-TRANSFER-' + copierId, players(3), seededRandom(42404), 'p0');
    giveKeepCard(state, 'p0', 'parasitic_tentacles');
    const source = giveKeepCard(state, 'p1', 'even_bigger');
    const mimic = giveKeepCard(state, copierId, 'mimic');
    mimic.mimicTargetInstanceId = source.instanceId;
    Object.assign(state.players.get(copierId)!, { health: 9, maxHealth: 12 });
    state.players.get('p1')!.health = 9;
    state.players.get('p0')!.energy = 20;
    state.phase = 'buying_cards';
    const buyerBefore = state.players.get('p0')!.health;
    accept(state, 'transfer Even Bigger while a live copy remains', () =>
      buyOwnedPowerCard(state, 'p0', 'p1', source.instanceId, state.revision));
    assert(state.players.get('p1')!.health === 9 && state.players.get('p1')!.maxHealth === 10 &&
      state.players.get('p0')!.health === buyerBefore + 2 &&
      state.players.get('p0')!.maxHealth === (copierId === 'p0' ? 14 : 12) &&
      mimic.mimicTargetInstanceId === source.instanceId && state.pendingDefenseDecision === null,
    'transfer clamps the seller, heals the buyer once and preserves the live copied source');
    if (copierId === 'p2') assert(state.players.get('p2')!.health === 9 && state.players.get('p2')!.maxHealth === 12,
      'third-party copied Even Bigger is unchanged by ownership transfer');
  }

  const sourceLeaves = initKingOfTokyoGame('BIGGER-SOURCE-FORFEIT', players(5), seededRandom(42405), 'p0');
  const lostSource = giveKeepCard(sourceLeaves, 'p1', 'even_bigger');
  const sourceCopy = giveKeepCard(sourceLeaves, 'p2', 'mimic');
  sourceCopy.mimicTargetInstanceId = lostSource.instanceId;
  giveKeepCard(sourceLeaves, 'p2', 'it_has_a_child');
  Object.assign(sourceLeaves.players.get('p2')!, { health: 1, maxHealth: 12, tokyoZone: 'tokyo_bay' });
  sourceLeaves.players.get('p0')!.tokyoZone = 'tokyo_city';
  accept(sourceLeaves, 'forfeit copied source without damaging its owner', () =>
    forfeitPlayer(sourceLeaves, 'p1', sourceLeaves.revision));
  assert(sourceLeaves.players.get('p2')!.health === 1 && sourceLeaves.players.get('p2')!.maxHealth === 10 &&
    !sourceLeaves.players.get('p2')!.eliminated && sourceLeaves.players.get('p2')!.tokyoZone === null &&
    sourceCopy.mimicTargetInstanceId === null && sourceLeaves.pendingDefenseDecision === null,
  'source removal preserves the wounded body while closing Tokyo Bay below five players');


  const transferredLabMimicState = initKingOfTokyoGame('TRANSFERRED-LAB-MIMIC', players(3), seededRandom(4241), 'p0');
  const remoteLab = giveKeepCard(transferredLabMimicState, 'p2', 'made_in_a_lab');
  const remoteLabMimic = giveKeepCard(transferredLabMimicState, 'p1', 'mimic');
  remoteLabMimic.mimicTargetInstanceId = remoteLab.instanceId;
  giveKeepCard(transferredLabMimicState, 'p0', 'parasitic_tentacles');
  transferredLabMimicState.players.get('p0')!.energy = 20;
  transferredLabMimicState.phase = 'buying_cards';
  accept(transferredLabMimicState, 'transfer a Mimic with a live Lab target', () =>
    buyOwnedPowerCard(transferredLabMimicState, 'p0', 'p1', remoteLabMimic.instanceId, transferredLabMimicState.revision));
  assert(
    remoteLabMimic.mimicTargetInstanceId === remoteLab.instanceId && transferredLabMimicState.labOffersRemaining === 1,
    'transferring a live copied Lab must preserve its target and grant exactly one active offer',
  );

  const childLab = initKingOfTokyoGame('CHILD-DISCARDS-LAB', players(3), seededRandom(425), 'p0');
  giveKeepCard(childLab, 'p0', 'made_in_a_lab');
  giveKeepCard(childLab, 'p0', 'it_has_a_child');
  childLab.players.get('p0')!.health = 2;
  childLab.players.get('p0')!.energy = 20;
  childLab.phase = 'buying_cards';
  childLab.labOffersRemaining = 1;
  putCardOnDeckTop(childLab, 'national_guard');
  accept(childLab, 'Lab purchase triggers It Has a Child', () =>
    buyLabCard(childLab, 'p0', childLab.revision, seededRandom(426)));
  assert(
    childLab.players.get('p0')!.health === 10 && childLab.players.get('p0')!.powerCards.length === 0 &&
      childLab.labOffersRemaining === 0,
    'It Has a Child must discard Made in a Lab and revoke its remaining offer without underflow',
  );
  rejectUnchanged(childLab, 'discarded Child Lab cannot buy again', () =>
    buyLabCard(childLab, 'p0', childLab.revision, seededRandom(427)));

  const probeSourceLeaves = initKingOfTokyoGame('PROBE-SOURCE-LEAVES', players(4), seededRandom(428), 'p0');
  giveKeepCard(probeSourceLeaves, 'p1', 'acid_attack');
  const leavingProbe = giveKeepCard(probeSourceLeaves, 'p1', 'psychic_probe');
  const copiedProbe = giveKeepCard(probeSourceLeaves, 'p2', 'mimic');
  copiedProbe.mimicTargetInstanceId = leavingProbe.instanceId;
  setFaces(probeSourceLeaves, [1, 2, 3, 'energy', 'heart', 'smash']);
  accept(probeSourceLeaves, 'open source-leave Probe queue', () =>
    prepareDiceResolution(probeSourceLeaves, 'p0', probeSourceLeaves.revision));
  assert(
    probeSourceLeaves.pendingPsychicProbes.map((entry) => entry.playerId).join(',') === 'p1,p2',
    'real and copied Probe must both enter the response queue',
  );
  accept(probeSourceLeaves, 'multi-card Probe source owner leaves', () =>
    forfeitPlayer(probeSourceLeaves, 'p1', probeSourceLeaves.revision, seededRandom(429)));
  assert(
    copiedProbe.mimicTargetInstanceId === null && !probeSourceLeaves.pendingPsychicProbes.length &&
      String(probeSourceLeaves.phase) === 'awaiting_dice_resolution',
    'batched source discard must remove every stale Probe entry and advance the window once',
  );
  accept(probeSourceLeaves, 'resolve after removed Probe queue', () =>
    resolveDiceResults(probeSourceLeaves, 'p0', plan(), probeSourceLeaves.revision, seededRandom(430)));

  const probeHeart = initKingOfTokyoGame('PROBE-HEART-CLEARS-COPY', players(3), seededRandom(431), 'p0');
  const heartProbe = giveKeepCard(probeHeart, 'p1', 'psychic_probe');
  const heartProbeMimic = giveKeepCard(probeHeart, 'p2', 'mimic');
  heartProbeMimic.mimicTargetInstanceId = heartProbe.instanceId;
  setFaces(probeHeart, [1, 2, 3, 'energy', 'heart', 'smash']);
  accept(probeHeart, 'open Heart Probe queue', () =>
    prepareDiceResolution(probeHeart, 'p0', probeHeart.revision));
  accept(probeHeart, 'source Probe rolls a Heart', () =>
    decidePsychicProbe(probeHeart, 'p1', 0, () => 0.9, probeHeart.revision));
  assert(
    heartProbeMimic.mimicTargetInstanceId === null && !probeHeart.pendingPsychicProbes.length &&
      String(probeHeart.phase) === 'awaiting_dice_resolution',
    'discarding the used Probe must remove its copied queued response without skipping another entry',
  );

  const opportunistSourceLeaves = initKingOfTokyoGame('OPPORTUNIST-SOURCE-LEAVES', players(4), seededRandom(432), 'p0');
  giveKeepCard(opportunistSourceLeaves, 'p2', 'acid_attack');
  const leavingOpportunist = giveKeepCard(opportunistSourceLeaves, 'p2', 'opportunist');
  const copiedOpportunist = giveKeepCard(opportunistSourceLeaves, 'p1', 'mimic');
  copiedOpportunist.mimicTargetInstanceId = leavingOpportunist.instanceId;
  opportunistSourceLeaves.players.get('p0')!.energy = 20;
  opportunistSourceLeaves.players.get('p1')!.energy = 20;
  opportunistSourceLeaves.players.get('p2')!.energy = 20;
  opportunistSourceLeaves.phase = 'buying_cards';
  accept(opportunistSourceLeaves, 'open source-leave Opportunist queue', () =>
    sweepPowerCards(opportunistSourceLeaves, 'p0', opportunistSourceLeaves.revision, seededRandom(433)));
  assert(
    opportunistSourceLeaves.pendingOpportunist?.playerIds.join(',') === 'p1,p2',
    'real and copied Opportunist must both enter the priority queue',
  );
  accept(opportunistSourceLeaves, 'multi-card Opportunist source owner leaves', () =>
    forfeitPlayer(opportunistSourceLeaves, 'p2', opportunistSourceLeaves.revision, seededRandom(434)));
  assert(
    copiedOpportunist.mimicTargetInstanceId === null &&
      opportunistSourceLeaves.pendingOpportunist?.playerIds.join(',') === 'p1' &&
      String(opportunistSourceLeaves.phase) === 'awaiting_opportunist',
    'an already triggered copied Opportunist right must survive loss of its source',
  );
  accept(opportunistSourceLeaves, 'copied Opportunist passes after source loss', () =>
    decideOpportunist(opportunistSourceLeaves, 'p1', false, opportunistSourceLeaves.revision, seededRandom(435)));

  const rapidHealingNextResponder = initKingOfTokyoGame('OPPORTUNIST-RAPID-NEXT', players(3), seededRandom(43501), 'p0');
  const queuedOpportunist = giveKeepCard(rapidHealingNextResponder, 'p1', 'opportunist');
  const queuedRapidHealing = giveKeepCard(rapidHealingNextResponder, 'p1', 'rapid_healing');
  const queuedOpportunistMimic = giveKeepCard(rapidHealingNextResponder, 'p2', 'mimic');
  queuedOpportunistMimic.mimicTargetInstanceId = queuedOpportunist.instanceId;
  rapidHealingNextResponder.players.get('p1')!.energy = 3;
  rapidHealingNextResponder.players.get('p1')!.health = 9;
  rapidHealingNextResponder.players.get('p2')!.energy = 3;
  exposeCard(rapidHealingNextResponder, 'corner_store');
  rapidHealingNextResponder.phase = 'awaiting_opportunist';
  rapidHealingNextResponder.pendingOpportunist = {
    cardInstanceId: rapidHealingNextResponder.market[0]!.instanceId,
    playerIds: ['p1', 'p2'],
  };
  accept(rapidHealingNextResponder, 'queued Opportunist spends below affordability', () =>
    usePowerCard(
      rapidHealingNextResponder,
      'p1',
      queuedRapidHealing.instanceId,
      {},
      rapidHealingNextResponder.revision,
      seededRandom(43502),
    ));
  assert(
    rapidHealingNextResponder.players.get('p1')!.energy === 1 &&
      rapidHealingNextResponder.players.get('p1')!.health === 10 &&
      rapidHealingNextResponder.pendingOpportunist?.playerIds.join(',') === 'p2' &&
      String(rapidHealingNextResponder.phase) === 'awaiting_opportunist',
    'Rapid Healing must preserve its paid effect and advance an unaffordable Opportunist to the next responder',
  );

  const rapidHealingFinalResponder = initKingOfTokyoGame('OPPORTUNIST-RAPID-FINAL', players(3), seededRandom(43503), 'p0');
  giveKeepCard(rapidHealingFinalResponder, 'p1', 'opportunist');
  const finalRapidHealing = giveKeepCard(rapidHealingFinalResponder, 'p1', 'rapid_healing');
  rapidHealingFinalResponder.players.get('p1')!.energy = 3;
  rapidHealingFinalResponder.players.get('p1')!.health = 9;
  exposeCard(rapidHealingFinalResponder, 'corner_store');
  rapidHealingFinalResponder.phase = 'awaiting_opportunist';
  rapidHealingFinalResponder.pendingOpportunist = {
    cardInstanceId: rapidHealingFinalResponder.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  accept(rapidHealingFinalResponder, 'final Opportunist spends below affordability', () =>
    usePowerCard(
      rapidHealingFinalResponder,
      'p1',
      finalRapidHealing.instanceId,
      {},
      rapidHealingFinalResponder.revision,
      seededRandom(43504),
    ));
  assert(
    rapidHealingFinalResponder.players.get('p1')!.energy === 1 &&
      rapidHealingFinalResponder.players.get('p1')!.health === 10 &&
      rapidHealingFinalResponder.pendingOpportunist === null &&
      String(rapidHealingFinalResponder.phase) === 'buying_cards',
    'Rapid Healing must preserve its paid effect and close an unaffordable final Opportunist window',
  );

  const discountedOpportunity = initKingOfTokyoGame('OPPORTUNIST-LOSES-DISCOUNT', players(4), seededRandom(4351), 'p0');
  giveKeepCard(discountedOpportunity, 'p1', 'opportunist');
  const leavingOrigin = giveKeepCard(discountedOpportunity, 'p2', 'alien_origin');
  const originMimic = giveKeepCard(discountedOpportunity, 'p1', 'mimic');
  originMimic.mimicTargetInstanceId = leavingOrigin.instanceId;
  discountedOpportunity.players.get('p0')!.energy = 20;
  discountedOpportunity.players.get('p1')!.energy = 4;
  discountedOpportunity.phase = 'buying_cards';
  exposeCard(discountedOpportunity, 'corner_store');
  putCardOnDeckTop(discountedOpportunity, 'giant_brain');
  accept(discountedOpportunity, 'open discounted Opportunist window', () =>
    buyPowerCard(discountedOpportunity, 'p0', 0, discountedOpportunity.revision, seededRandom(4352)));
  assert(
    discountedOpportunity.pendingOpportunist?.playerIds.join(',') === 'p1',
    'copied Alien Origin must make the revealed card affordable to Opportunist',
  );
  accept(discountedOpportunity, 'discount source owner leaves during Opportunist', () =>
    forfeitPlayer(discountedOpportunity, 'p2', discountedOpportunity.revision, seededRandom(4353)));
  assert(
    originMimic.mimicTargetInstanceId === null && discountedOpportunity.pendingOpportunist === null &&
      String(discountedOpportunity.phase) === 'buying_cards',
    'losing a copied discount must revoke an unaffordable pending Opportunist purchase',
  );

  const giantSourceLeaves = initKingOfTokyoGame('GIANT-BRAIN-SOURCE-LEAVES', players(3), seededRandom(436));
  const leavingBrain = giveKeepCard(giantSourceLeaves, 'p1', 'giant_brain');
  const brainMimic = giveKeepCard(giantSourceLeaves, 'p0', 'mimic');
  brainMimic.mimicTargetInstanceId = leavingBrain.instanceId;
  const energyDrink = giveKeepCard(giantSourceLeaves, 'p0', 'energy_drink');
  giantSourceLeaves.players.get('p0')!.energy = 1;
  completeRollOff(giantSourceLeaves, 'p0');
  assert(giantSourceLeaves.maxRolls === 4, 'copied Giant Brain must add one live standard reroll');
  accept(giantSourceLeaves, 'first copied Brain roll', () =>
    rollDice(giantSourceLeaves, 'p0', seededRandom(437), giantSourceLeaves.revision));
  accept(giantSourceLeaves, 'consume Energy Drink reroll', () =>
    usePowerCard(giantSourceLeaves, 'p0', energyDrink.instanceId, {}, giantSourceLeaves.revision, seededRandom(438)));
  accept(giantSourceLeaves, 'second copied Brain roll', () =>
    rollDice(giantSourceLeaves, 'p0', seededRandom(439), giantSourceLeaves.revision));
  accept(giantSourceLeaves, 'copied Giant Brain source owner leaves', () =>
    forfeitPlayer(giantSourceLeaves, 'p1', giantSourceLeaves.revision, seededRandom(440)));
  assert(
    brainMimic.mimicTargetInstanceId === null && giantSourceLeaves.maxRolls === 4,
    'losing copied Giant Brain must revoke only its unused reroll and preserve consumed Energy Drink',
  );
  accept(giantSourceLeaves, 'third post-Brain roll', () =>
    rollDice(giantSourceLeaves, 'p0', seededRandom(441), giantSourceLeaves.revision));
  accept(giantSourceLeaves, 'fourth Energy Drink roll', () =>
    rollDice(giantSourceLeaves, 'p0', seededRandom(442), giantSourceLeaves.revision));
  rejectUnchanged(giantSourceLeaves, 'revoked fifth Brain roll', () =>
    rollDice(giantSourceLeaves, 'p0', seededRandom(443), giantSourceLeaves.revision));

  const retargetLiveDice = initKingOfTokyoGame('RETARGET-LIVE-DICE', players(3), seededRandom(4431));
  const retargetBrain = giveKeepCard(retargetLiveDice, 'p1', 'giant_brain');
  const retargetHead = giveKeepCard(retargetLiveDice, 'p2', 'extra_head');
  const liveDiceMimic = giveKeepCard(retargetLiveDice, 'p0', 'mimic');
  liveDiceMimic.mimicTargetInstanceId = retargetBrain.instanceId;
  retargetLiveDice.players.get('p0')!.energy = 1;
  completeRollOff(retargetLiveDice, 'p0');
  assert(
    retargetLiveDice.maxRolls === 4 && retargetLiveDice.dice.length === 6,
    'turn setup must cache the copied Giant Brain benefit',
  );
  accept(retargetLiveDice, 'retarget live Mimic from Brain to Head', () =>
    usePowerCard(retargetLiveDice, 'p0', liveDiceMimic.instanceId, {
      targetCardInstanceId: retargetHead.instanceId,
    }, retargetLiveDice.revision));
  assert(
    Number(retargetLiveDice.maxRolls) === 3 && Number(retargetLiveDice.dice.length) === 7,
    'start-turn retarget must revoke Giant Brain and add Extra Head before any roll',
  );

  const headSourceLeaves = initKingOfTokyoGame('EXTRA-HEAD-SOURCE-LEAVES', players(3), seededRandom(444));
  giveKeepCard(headSourceLeaves, 'p0', 'extra_head');
  const leavingHead = giveKeepCard(headSourceLeaves, 'p1', 'extra_head');
  const headMimic = giveKeepCard(headSourceLeaves, 'p0', 'mimic');
  headMimic.mimicTargetInstanceId = leavingHead.instanceId;
  completeRollOff(headSourceLeaves, 'p0');
  assert(headSourceLeaves.dice.length === 8, 'real and copied Extra Head must produce eight active dice');
  accept(headSourceLeaves, 'roll both Extra Head dice', () =>
    rollDice(headSourceLeaves, 'p0', seededRandom(445), headSourceLeaves.revision));
  const retainedHeadFaces = headSourceLeaves.dice.slice(0, 7).map((die) => die.face).join(',');
  accept(headSourceLeaves, 'copied Extra Head source owner leaves', () =>
    forfeitPlayer(headSourceLeaves, 'p1', headSourceLeaves.revision, seededRandom(446)));
  assert(
    headMimic.mimicTargetInstanceId === null && Number(headSourceLeaves.dice.length) === 7 &&
      headSourceLeaves.dice.map((die) => die.face).join(',') === retainedHeadFaces,
    'losing copied Extra Head before resolution must remove one deterministic die and preserve the real copy',
  );

  const resolvedHead = initKingOfTokyoGame('RESOLVED-EXTRA-HEAD', players(4), seededRandom(4461), 'p0');
  giveKeepCard(resolvedHead, 'p0', 'nova_breath');
  const doomedHead = giveKeepCard(resolvedHead, 'p1', 'extra_head');
  const resolvedHeadMimic = giveKeepCard(resolvedHead, 'p0', 'mimic');
  resolvedHeadMimic.mimicTargetInstanceId = doomedHead.instanceId;
  resolvedHead.players.get('p0')!.tokyoZone = 'tokyo_city';
  resolvedHead.players.get('p1')!.health = 1;
  setFaces(resolvedHead, [1, 1, 2, 3, 'energy', 'smash', 1]);
  accept(resolvedHead, 'prepare already-rolled copied Head die', () =>
    prepareDiceResolution(resolvedHead, 'p0', resolvedHead.revision));
  accept(resolvedHead, 'resolve Smash before copied Head scoring die', () =>
    resolveDiceResults(resolvedHead, 'p0', plan({
      resolutionOrder: ['smash', 'points', 'energy', 'hearts'],
    }), resolvedHead.revision, seededRandom(4462)));
  assert(
    resolvedHead.players.get('p1')!.eliminated && resolvedHeadMimic.mimicTargetInstanceId === null &&
      resolvedHead.dice.length === 7 && resolvedHead.players.get('p0')!.victoryPoints === 1,
    `a copied Extra Head die already committed to resolution must still score after its source dies (${JSON.stringify({
      sourceEliminated: resolvedHead.players.get('p1')!.eliminated,
      mimicTarget: resolvedHeadMimic.mimicTargetInstanceId,
      dice: resolvedHead.dice.length,
      points: resolvedHead.players.get('p0')!.victoryPoints,
    })})`,
  );

  const orphanedInitialMimic = initKingOfTokyoGame('ORPHANED-INITIAL-MIMIC', players(3), seededRandom(447), 'p0');
  giveKeepCard(orphanedInitialMimic, 'p1', 'acid_attack');
  orphanedInitialMimic.players.get('p0')!.energy = 20;
  orphanedInitialMimic.phase = 'buying_cards';
  exposeCard(orphanedInitialMimic, 'mimic');
  accept(orphanedInitialMimic, 'buy Mimic before final rival Keep leaves', () =>
    buyPowerCard(orphanedInitialMimic, 'p0', 0, orphanedInitialMimic.revision, seededRandom(448)));
  assert(
    [...orphanedInitialMimic.usedThisTurn].some((key) => key.startsWith('mimic_initial:')),
    'new Mimic must wait for a legal initial target',
  );
  accept(orphanedInitialMimic, 'last eligible Mimic source owner leaves', () =>
    forfeitPlayer(orphanedInitialMimic, 'p1', orphanedInitialMimic.revision, seededRandom(449)));
  assert(
    ![...orphanedInitialMimic.usedThisTurn].some((key) => key.startsWith('mimic_initial:')) &&
      orphanedInitialMimic.log.some((entry) => entry.text.includes('Mimic remained inactive')),
    'initial Mimic must become inactive instead of deadlocking when no rival Keep remains',
  );
  accept(orphanedInitialMimic, 'end turn after orphaned initial Mimic', () =>
    endTurn(orphanedInitialMimic, 'p0', orphanedInitialMimic.revision, seededRandom(450)));

  const staleJets = initKingOfTokyoGame('JETS-SOURCE-LEAVES', players(4), seededRandom(451), 'p0');
  const leavingJets = giveKeepCard(staleJets, 'p2', 'jets');
  const jetsMimic = giveKeepCard(staleJets, 'p1', 'mimic');
  jetsMimic.mimicTargetInstanceId = leavingJets.instanceId;
  staleJets.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(staleJets, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(staleJets);
  assert(
    String(staleJets.phase) === 'awaiting_tokyo_decision' && staleJets.pendingTokyoDamage.has('p1'),
    'copied Jets must defer Smash until the occupant decides',
  );
  accept(staleJets, 'copied Jets source owner leaves before Yield', () =>
    forfeitPlayer(staleJets, 'p2', staleJets.revision, seededRandom(452)));
  assert(
    staleJets.players.get('p1')!.health === 9 && !staleJets.pendingTokyoDamage.has('p1') &&
      staleJets.pendingTokyoDecisions.join(',') === 'p1',
    'losing unresolved Jets must settle Smash and retain an ordinary Yield choice for the survivor',
  );
  accept(staleJets, 'ordinary Yield after copied Jets loss', () =>
    decideTokyoYield(staleJets, 'p1', true, staleJets.revision, seededRandom(453)));
  assert(staleJets.players.get('p1')!.tokyoZone === null, 'surviving occupant may still Yield after Jets loss');

  const defendedJets = initKingOfTokyoGame('DEFENDED-JETS-SOURCE-LEAVES', players(4), seededRandom(4531), 'p0');
  const defendedJetsSource = giveKeepCard(defendedJets, 'p2', 'jets');
  const defendedJetsMimic = giveKeepCard(defendedJets, 'p1', 'mimic');
  defendedJetsMimic.mimicTargetInstanceId = defendedJetsSource.instanceId;
  giveKeepCard(defendedJets, 'p1', 'wings');
  defendedJets.players.get('p1')!.tokyoZone = 'tokyo_city';
  defendedJets.players.get('p1')!.energy = 2;
  defendedJets.players.get('p1')!.defenseMode = 'always';
  setFaces(defendedJets, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(defendedJets);
  accept(defendedJets, 'copied Jets source leaves before Wings defense', () =>
    forfeitPlayer(defendedJets, 'p2', defendedJets.revision, seededRandom(4532)));
  assert(
    defendedJets.pendingDefenseDecision?.kind === 'wings' && defendedJets.pendingDefenseDecision.playerId === 'p1',
    'stale Jets settlement must pause for the defender even when its copied source forfeits',
  );
  accept(defendedJets, 'use Wings against settled stale Jets', () =>
    decideDefense(defendedJets, 'p1', { kind: 'wings', use: true }, defendedJets.revision, seededRandom(4533)));
  assert(
    defendedJets.players.get('p1')!.health === 10 && defendedJets.players.get('p1')!.energy === 0 &&
      defendedJets.players.get('p1')!.tokyoZone === 'tokyo_city' && !defendedJets.pendingTokyoDecisions.length &&
      !defendedJets.pendingTokyoDamage.size && String(defendedJets.phase) === 'buying_cards',
    'a fully defended stale Jets hit must not create an ordinary Yield choice',
  );

  const childLosesJets = initKingOfTokyoGame('CHILD-LOSES-JETS', players(4), seededRandom(454), 'p0');
  giveKeepCard(childLosesJets, 'p0', 'nova_breath');
  giveKeepCard(childLosesJets, 'p0', 'poison_spit');
  const fatalJetsSource = giveKeepCard(childLosesJets, 'p2', 'jets');
  const childJetsMimic = giveKeepCard(childLosesJets, 'p1', 'mimic');
  childJetsMimic.mimicTargetInstanceId = fatalJetsSource.instanceId;
  giveKeepCard(childLosesJets, 'p1', 'it_has_a_child');
  childLosesJets.players.get('p1')!.tokyoZone = 'tokyo_city';
  childLosesJets.players.get('p1')!.health = 1;
  childLosesJets.players.get('p2')!.health = 1;
  setFaces(childLosesJets, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(childLosesJets, plan(), seededRandom(455));
  assert(
    childLosesJets.players.get('p2')!.eliminated && childLosesJets.players.get('p1')!.health === 1 &&
      childLosesJets.pendingTokyoDamage.get('p1')?.jetsSnapshotGranted === true &&
      childLosesJets.pendingTokyoDecisions.join(',') === 'p1' && String(childLosesJets.phase) === 'awaiting_tokyo_decision',
    'simultaneous source death must preserve the Jets grant already triggered by this Smash packet',
  );
  accept(childLosesJets, 'stay using snapshotted Jets before Child revival', () =>
    decideTokyoYield(childLosesJets, 'p1', false, childLosesJets.revision, seededRandom(456)));
  assert(
    childLosesJets.players.get('p1')!.health === 10 && childLosesJets.players.get('p1')!.tokyoZone === null &&
      childLosesJets.players.get('p1')!.powerCards.length === 0 && childLosesJets.players.get('p1')!.poisonTokens === 1 &&
      !childLosesJets.pendingTokyoDamage.size && !childLosesJets.pendingTokyoDecisions.length &&
      String(childLosesJets.phase) === 'buying_cards',
    'staying with snapshotted Jets must resolve Smash, Child revival, and attack tokens exactly once',
  );

  const lab = initKingOfTokyoGame('LAB-OPPORTUNIST', players(3), seededRandom(42), 'p0');
  giveKeepCard(lab, 'p1', 'opportunist');
  lab.players.get('p0')!.energy = 20;
  lab.players.get('p1')!.energy = 20;
  lab.phase = 'buying_cards';
  exposeCard(lab, 'corner_store');
  putCardOnDeckTop(lab, 'made_in_a_lab');
  accept(lab, 'active buys before Lab reveal', () =>
    buyPowerCard(lab, 'p0', 0, lab.revision, seededRandom(43)));
  assert(
    String(lab.phase) === 'awaiting_opportunist' && lab.pendingOpportunist?.playerIds[0] === 'p1',
    'off-turn Opportunist must receive Lab offer before active resumes',
  );
  accept(lab, 'off-turn owner buys Lab', () =>
    decideOpportunist(lab, 'p1', true, lab.revision, seededRandom(44)));
  assert(lab.labOffersRemaining === 0, 'off-turn Lab purchase must not inspect current active deck');

  const frenzy = initKingOfTokyoGame('FRENZY', players(2), seededRandom(45), 'p0');
  frenzy.players.get('p0')!.health = 5;
  frenzy.players.get('p0')!.poisonTokens = 2;
  frenzy.players.get('p0')!.energy = 10;
  frenzy.phase = 'buying_cards';
  exposeCard(frenzy, 'frenzy');
  accept(frenzy, 'Frenzy purchase', () =>
    buyPowerCard(frenzy, 'p0', 0, frenzy.revision, seededRandom(46)));
  assert(String(frenzy.phase) === 'buying_cards' && frenzy.players.get('p0')!.health === 5,
    'Frenzy must leave the current buying step open');
  accept(frenzy, 'finish the ordinary turn before Frenzy', () =>
    endTurn(frenzy, 'p0', frenzy.revision, seededRandom(461)));
  assert(
    currentId(frenzy) === 'p0' && String(frenzy.phase) === 'awaiting_roll' &&
      frenzy.players.get('p0')!.health === 3,
    'Frenzy must resolve end-turn Poison before starting its extra turn',
  );

  const frenzyWin = initKingOfTokyoGame('FRENZY-WIN', players(2), seededRandom(47), 'p0');
  frenzyWin.players.get('p0')!.victoryPoints = 20;
  frenzyWin.players.get('p0')!.energy = 10;
  frenzyWin.phase = 'buying_cards';
  exposeCard(frenzyWin, 'frenzy');
  accept(frenzyWin, 'Frenzy purchased during a winning turn', () =>
    buyPowerCard(frenzyWin, 'p0', 0, frenzyWin.revision, seededRandom(48)));
  assert(String(frenzyWin.phase) === 'buying_cards', 'Frenzy must not end a winning turn at purchase');
  accept(frenzyWin, 'finish winning turn before queued Frenzy', () =>
    endTurn(frenzyWin, 'p0', frenzyWin.revision));
  assert(
    String(frenzyWin.phase) === 'game_over' && frenzyWin.winnerId === 'p0' &&
      frenzyWin.victoryType === 'victory_points',
    'Frenzy must adjudicate the turn-ending 20-point win before its extra turn',
  );

  const labFrenzyWin = initKingOfTokyoGame('LAB-FRENZY-WIN', players(2), seededRandom(49), 'p0');
  giveKeepCard(labFrenzyWin, 'p0', 'made_in_a_lab');
  labFrenzyWin.players.get('p0')!.victoryPoints = 20;
  labFrenzyWin.players.get('p0')!.energy = 10;
  labFrenzyWin.phase = 'buying_cards';
  labFrenzyWin.labOffersRemaining = 1;
  putCardOnDeckTop(labFrenzyWin, 'frenzy');
  accept(labFrenzyWin, 'Lab Frenzy purchased during a winning turn', () =>
    buyLabCard(labFrenzyWin, 'p0', labFrenzyWin.revision, seededRandom(50)));
  assert(String(labFrenzyWin.phase) === 'buying_cards', 'Lab Frenzy must preserve the buying step');
  accept(labFrenzyWin, 'finish Lab winning turn before queued Frenzy', () =>
    endTurn(labFrenzyWin, 'p0', labFrenzyWin.revision));
  assert(
    String(labFrenzyWin.phase) === 'game_over' && labFrenzyWin.winnerId === 'p0' &&
      labFrenzyWin.victoryType === 'victory_points',
    'Made in a Lab must use the same Frenzy end-turn victory timing',
  );

  const fatalFrenzy = initKingOfTokyoGame('FRENZY-POISON-FATAL', players(3), seededRandom(501), 'p0');
  Object.assign(fatalFrenzy.players.get('p0')!, { health: 1, poisonTokens: 1, energy: 10 });
  fatalFrenzy.phase = 'buying_cards';
  exposeCard(fatalFrenzy, 'frenzy');
  accept(fatalFrenzy, 'buy extra turn before lethal Poison', () =>
    buyPowerCard(fatalFrenzy, 'p0', 0, fatalFrenzy.revision));
  accept(fatalFrenzy, 'resolve lethal end-turn Poison before extra turn', () =>
    endTurn(fatalFrenzy, 'p0', fatalFrenzy.revision));
  assert(fatalFrenzy.players.get('p0')!.eliminated && currentId(fatalFrenzy) === 'p1' &&
    !fatalFrenzy.queuedExtraTurns.some((turn) => turn.playerId === 'p0'),
  'a dead Frenzy owner must not take its queued extra turn');

  const opportunistFrenzy = initKingOfTokyoGame('FRENZY-OPPORTUNIST', players(3), seededRandom(502), 'p0');
  giveKeepCard(opportunistFrenzy, 'p1', 'opportunist');
  Object.assign(opportunistFrenzy.players.get('p0')!, { health: 5, poisonTokens: 1, energy: 5 });
  opportunistFrenzy.players.get('p1')!.energy = 7;
  opportunistFrenzy.phase = 'buying_cards';
  exposeCard(opportunistFrenzy, 'corner_store');
  putCardOnDeckTop(opportunistFrenzy, 'frenzy');
  accept(opportunistFrenzy, 'reveal Frenzy for an off-turn buyer', () =>
    buyPowerCard(opportunistFrenzy, 'p0', 0, opportunistFrenzy.revision));
  accept(opportunistFrenzy, 'Opportunist purchases Frenzy', () =>
    decideOpportunist(opportunistFrenzy, 'p1', true, opportunistFrenzy.revision));
  assert(currentId(opportunistFrenzy) === 'p0' && opportunistFrenzy.phase === 'buying_cards',
    'off-turn Frenzy must not interrupt the current owner');
  accept(opportunistFrenzy, 'finish current owner before off-turn Frenzy', () =>
    endTurn(opportunistFrenzy, 'p0', opportunistFrenzy.revision));
  assert(currentId(opportunistFrenzy) === 'p1' && opportunistFrenzy.players.get('p0')!.health === 4 &&
    opportunistFrenzy.resumeAfterExtraTurnsPlayerId === 'p0',
  'off-turn Frenzy begins only after current-owner Poison resolves');

  for (const prevented of [false, true]) {
    const state = initKingOfTokyoGame('HERBIVORE-SELF-' + prevented, players(3), seededRandom(503), 'p0');
    const herbivore = giveKeepCard(state, 'p0', 'herbivore');
    giveKeepCard(state, 'p0', 'mimic').mimicTargetInstanceId = herbivore.instanceId;
    if (prevented) giveKeepCard(state, 'p0', 'wings');
    state.players.get('p0')!.energy = 20;
    state.phase = 'buying_cards';
    exposeCard(state, 'jet_fighters');
    accept(state, 'Jet Fighters self-damage with Herbivore', () =>
      buyPowerCard(state, 'p0', 0, state.revision));
    if (prevented) accept(state, 'prevent self-inflicted loss with Wings', () =>
      decideDefense(state, 'p0', { kind: 'wings', use: true }, state.revision));
    assert(state.turnDealtDamage === !prevented,
      'only actual self-inflicted health loss disqualifies Herbivore');
    accept(state, 'finish Herbivore self-damage turn', () => endTurn(state, 'p0', state.revision));
    assert(state.players.get('p0')!.victoryPoints === (prevented ? 7 : 5),
      'physical and copied Herbivore must respect the same self-damage eligibility');
  }

  const blockedHerbivore = initKingOfTokyoGame('HERBIVORE-BLOCKED-SMASH', players(3), seededRandom(504), 'p0');
  giveKeepCard(blockedHerbivore, 'p0', 'herbivore');
  giveKeepCard(blockedHerbivore, 'p1', 'armor_plating');
  blockedHerbivore.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(blockedHerbivore, ['smash', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(blockedHerbivore);
  accept(blockedHerbivore, 'finish fully prevented Smash turn', () =>
    endTurn(blockedHerbivore, 'p0', blockedHerbivore.revision));
  assert(blockedHerbivore.players.get('p0')!.victoryPoints === 1,
    'attacking without causing health loss must not disqualify Herbivore');

  const poisonedHerbivore = initKingOfTokyoGame('HERBIVORE-POISON', players(3), seededRandom(505), 'p0');
  giveKeepCard(poisonedHerbivore, 'p0', 'herbivore');
  Object.assign(poisonedHerbivore.players.get('p0')!, { health: 5, poisonTokens: 1 });
  poisonedHerbivore.phase = 'buying_cards';
  accept(poisonedHerbivore, 'collect Poison and Herbivore', () =>
    endTurn(poisonedHerbivore, 'p0', poisonedHerbivore.revision));
  accept(poisonedHerbivore, 'resolve unowned Poison before Herbivore', () =>
    resolveEndTurnEffect(poisonedHerbivore, 'p0', 'poison', poisonedHerbivore.revision));
  assert(poisonedHerbivore.players.get('p0')!.health === 4 &&
    poisonedHerbivore.players.get('p0')!.victoryPoints === 1,
  'Poison loss is not damage dealt by the active owner and does not disqualify Herbivore');

  const friend = initKingOfTokyoGame('FRIEND', players(2), seededRandom(51), 'p0');
  giveKeepCard(friend, 'p0', 'friend_of_children');
  giveKeepCard(friend, 'p0', 'solar_powered');
  setFaces(friend, ['energy', 1, 2, 3, 'heart', 'heart']);
  prepareAndResolve(friend);
  assert(friend.players.get('p0')!.energy === 2, 'Friend of Children must add one to rolled Energy');
  friend.players.get('p0')!.energy = 0;
  accept(friend, 'Solar plus Friend', () => endTurn(friend, 'p0', friend.revision));
  assert(friend.players.get('p0')!.energy === 2, 'Friend of Children must combine with Solar Powered');

  const battery = initKingOfTokyoGame('BATTERY', players(2), seededRandom(48), 'p0');
  giveKeepCard(battery, 'p1', 'battery_monster');
  giveKeepCard(battery, 'p1', 'friend_of_children');
  battery.phase = 'buying_cards';
  accept(battery, 'advance to Battery owner', () => endTurn(battery, 'p0', battery.revision));
  assert(battery.players.get('p1')!.energy === 2, 'Battery recovery must not trigger Friend of Children');

  const everyTurnBattery = initKingOfTokyoGame('BATTERY-OWNER-TURN', players(3), seededRandom(481), 'p0');
  const batterySource = giveKeepCard(everyTurnBattery, 'p1', 'battery_monster');
  giveKeepCard(everyTurnBattery, 'p1', 'friend_of_children');
  const copiedBattery = giveKeepCard(everyTurnBattery, 'p2', 'mimic');
  copiedBattery.mimicTargetInstanceId = batterySource.instanceId;
  copiedBattery.counters = 6;
  everyTurnBattery.phase = 'buying_cards';
  accept(everyTurnBattery, 'advance into physical Battery owner turn', () =>
    endTurn(everyTurnBattery, 'p0', everyTurnBattery.revision));
  assert(
    everyTurnBattery.players.get('p1')!.energy === 2 && everyTurnBattery.players.get('p2')!.energy === 0 &&
      batterySource.counters === 4 && copiedBattery.counters === 6,
    'only the active owner Battery transfers energy, without Friend of Children bonus',
  );
  everyTurnBattery.phase = 'buying_cards';
  accept(everyTurnBattery, 'advance into copied Battery owner turn', () =>
    endTurn(everyTurnBattery, 'p1', everyTurnBattery.revision));
  assert(
    everyTurnBattery.players.get('p1')!.energy === 2 && everyTurnBattery.players.get('p2')!.energy === 2 &&
      Number(batterySource.counters) === 4 && Number(copiedBattery.counters) === 4,
    'copied Battery transfers independently on its own owner turn',
  );
  everyTurnBattery.phase = 'buying_cards';
  accept(everyTurnBattery, 'advance into a turn without Battery', () =>
    endTurn(everyTurnBattery, 'p2', everyTurnBattery.revision));
  assert(
    everyTurnBattery.players.get('p1')!.energy === 2 && everyTurnBattery.players.get('p2')!.energy === 2 &&
      Number(batterySource.counters) === 4 && Number(copiedBattery.counters) === 4,
    'opponent turns must not drain either Battery',
  );
  for (const actorId of ['p0', 'p1', 'p2', 'p0']) {
    everyTurnBattery.phase = 'buying_cards';
    accept(everyTurnBattery, 'advance towards physical Battery exhaustion', () =>
      endTurn(everyTurnBattery, actorId, everyTurnBattery.revision));
  }
  assert(everyTurnBattery.players.get('p1')!.energy === 6 &&
    everyTurnBattery.players.get('p2')!.energy === 4 && Number(batterySource.counters) === 0 &&
    !everyTurnBattery.players.get('p1')!.powerCards.includes(batterySource) &&
    copiedBattery.mimicTargetInstanceId === null,
  'the physical third owner turn discards its Battery and deactivates the rival copy before its next turn');

  const ownBatteryCopies = initKingOfTokyoGame('BATTERY-OWN-COPIES', players(2), seededRandom(483), 'p0');
  const ownBattery = giveKeepCard(ownBatteryCopies, 'p1', 'battery_monster');
  const ownBatteryMimic = giveKeepCard(ownBatteryCopies, 'p1', 'mimic');
  ownBatteryMimic.mimicTargetInstanceId = ownBattery.instanceId;
  ownBattery.counters = 2;
  ownBatteryMimic.counters = 2;
  ownBatteryCopies.phase = 'buying_cards';
  accept(ownBatteryCopies, 'exhaust both same-owner Battery copies', () =>
    endTurn(ownBatteryCopies, 'p0', ownBatteryCopies.revision));
  assert(ownBatteryCopies.players.get('p1')!.energy === 4 &&
    !ownBatteryCopies.players.get('p1')!.powerCards.includes(ownBattery) &&
    !ownBatteryCopies.players.get('p1')!.powerCards.includes(ownBatteryMimic),
  'same-owner copies both transfer before source removal and both discard when exhausted');

  const expiringBatterySource = initKingOfTokyoGame('BATTERY-SOURCE-EXPIRES', players(3), seededRandom(482), 'p0');
  const expiringSource = giveKeepCard(expiringBatterySource, 'p1', 'battery_monster');
  const survivingBatteryMimic = giveKeepCard(expiringBatterySource, 'p2', 'mimic');
  survivingBatteryMimic.mimicTargetInstanceId = expiringSource.instanceId;
  expiringSource.counters = 2;
  survivingBatteryMimic.counters = 4;
  expiringBatterySource.phase = 'buying_cards';
  accept(expiringBatterySource, 'advance into expiring Battery source trigger', () =>
    endTurn(expiringBatterySource, 'p0', expiringBatterySource.revision));
  assert(
    expiringBatterySource.players.get('p1')!.energy === 2 && expiringBatterySource.players.get('p2')!.energy === 0 &&
      !expiringBatterySource.players.get('p1')!.powerCards.some((card) => card.instanceId === expiringSource.instanceId) &&
      expiringBatterySource.players.get('p2')!.powerCards.includes(survivingBatteryMimic) &&
      survivingBatteryMimic.mimicTargetInstanceId === null,
    'an off-turn copied Battery receives nothing before its empty source is discarded and deactivates it',
  );

  const regeneration = initKingOfTokyoGame('REGEN', players(2), seededRandom(49), 'p0');
  giveKeepCard(regeneration, 'p0', 'regeneration');
  regeneration.players.get('p0')!.health = 5;
  setFaces(regeneration, ['heart', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(regeneration);
  assert(regeneration.players.get('p0')!.health === 8, 'rolled Hearts must trigger one Regeneration health');

  const background = initKingOfTokyoGame('BACKGROUND', players(2), seededRandom(50), 'p0');
  const dweller = giveKeepCard(background, 'p0', 'background_dweller');
  setFaces(background, [3, 3, 1, 2, 'energy', 'heart']);
  accept(background, 'first Background Dweller reroll', () =>
    usePowerCard(background, 'p0', dweller.instanceId, { dieIndex: 0 }, background.revision, () => 0));
  accept(background, 'second Background Dweller reroll', () =>
    usePowerCard(background, 'p0', dweller.instanceId, { dieIndex: 1 }, background.revision, () => 0));
  assert(background.dice[0].face === 1 && background.dice[1].face === 1, 'Background Dweller must be unlimited');

  const freezeDecline = initKingOfTokyoGame('FREEZE-DECLINE', players(2), seededRandom(51), 'p0');
  giveKeepCard(freezeDecline, 'p0', 'freeze_time');
  setFaces(freezeDecline, [1, 1, 1, 2, 'energy', 'heart']);
  prepareAndResolve(freezeDecline);
  assert(freezeDecline.phase === 'awaiting_freeze_time', 'Freeze Time must ask before granting its optional extra turn');
  accept(freezeDecline, 'decline optional Freeze turn', () =>
    decideFreezeTime(freezeDecline, 'p0', false, freezeDecline.revision));
  assert(
    String(freezeDecline.phase) === 'buying_cards' && freezeDecline.queuedExtraTurns.length === 0,
    'declining Freeze Time must resume the unresolved dice categories without queuing a turn',
  );

  const freeze = initKingOfTokyoGame('FREEZE-COPIED', players(2), seededRandom(511), 'p0');
  const freezeCard = giveKeepCard(freeze, 'p0', 'freeze_time');
  const freezeMimic = giveKeepCard(freeze, 'p0', 'mimic');
  freezeMimic.mimicTargetInstanceId = freezeCard.instanceId;
  setFaces(freeze, [1, 1, 1, 2, 'energy', 'heart']);
  prepareAndResolve(freeze);
  assert(
    freeze.phase === 'awaiting_freeze_time' && freeze.pendingFreezeTimeDecisions.length === 2 &&
      freeze.pendingFreezeTimeDecisions.every((decision) => decision.dicePenalty === 1),
    'physical and copied Freeze Time must create two separate optional choices at the same one-die penalty',
  );
  const freezeOwnerView = toKingOfTokyoPublicState(freeze, 'p0');
  const freezeObserverView = toKingOfTokyoPublicState(freeze, 'p1');
  for (const view of [freezeOwnerView, freezeObserverView]) {
    assert(view.pendingFreezeTimePlayerId === 'p0', 'Freeze Time owner must be visible to owner and observers');
    assert(view.pendingFreezeTimeDicePenalty === 1, 'Freeze Time penalty must be projected');
    assert(view.pendingFreezeTimeChoicesRemaining === 2, 'Freeze Time choice count must be projected');
  }
  accept(freeze, 'accept physical Freeze turn', () =>
    decideFreezeTime(freeze, 'p0', true, freeze.revision));
  assert(
    freeze.phase === 'awaiting_freeze_time' && freeze.queuedExtraTurns[0]?.dicePenalty === 1,
    'accepting one copied trigger must leave the second choice pending',
  );
  accept(freeze, 'accept copied Freeze turn', () =>
    decideFreezeTime(freeze, 'p0', true, freeze.revision));
  assert(
    String(freeze.phase) === 'buying_cards' && freeze.queuedExtraTurns.length === 2 &&
      freeze.queuedExtraTurns.every((turn) => turn.dicePenalty === 1),
    'two simultaneous Freeze triggers must queue 5-die and 5-die turns, never 5 then 4',
  );
  accept(freeze, 'finish base Freeze turn', () => endTurn(freeze, 'p0', freeze.revision));
  assert(freeze.dice.length === 5, 'first copied Freeze extra turn must use one fewer die');
  setFaces(freeze, [1, 1, 1, 'energy', 'heart']);
  prepareAndResolve(freeze);
  assert(
    freeze.pendingFreezeTimeDecisions.length === 2 &&
      freeze.pendingFreezeTimeDecisions.every((decision) => decision.dicePenalty === 2),
    'an accepted Freeze child turn must independently offer both copied triggers at its own penalty plus one',
  );
  accept(freeze, 'accept one child Freeze turn', () =>
    decideFreezeTime(freeze, 'p0', true, freeze.revision));
  accept(freeze, 'decline the other child Freeze turn', () =>
    decideFreezeTime(freeze, 'p0', false, freeze.revision));
  accept(freeze, 'finish first copied Freeze extra turn', () => endTurn(freeze, 'p0', freeze.revision));
  assert(freeze.dice.length === 5, 'the simultaneous sibling Freeze turn must still use five dice');
  freeze.phase = 'buying_cards';
  accept(freeze, 'finish sibling Freeze turn', () => endTurn(freeze, 'p0', freeze.revision));
  assert(Number(freeze.dice.length) === 4, 'the accepted child Freeze turn must use four dice');

  const absentFreeze = initKingOfTokyoGame('FREEZE-ABSENT', players(2), seededRandom(512), 'p0');
  giveKeepCard(absentFreeze, 'p0', 'freeze_time');
  setFaces(absentFreeze, [1, 1, 1, 2, 'energy', 'heart']);
  prepareAndResolve(absentFreeze);
  accept(absentFreeze, 'absence declines optional Freeze turn', () =>
    resolveAbsentDecision(absentFreeze, 'p0', absentFreeze.revision, seededRandom(513)));
  assert(
    absentFreeze.phase === 'buying_cards' && absentFreeze.queuedExtraTurns.length === 0,
    'Freeze Time recovery must deterministically decline and resume dice resolution',
  );

  const lostFreezeSource = initKingOfTokyoGame('FREEZE-SOURCE-FORFEIT', players(3), seededRandom(514), 'p0');
  const rivalFreeze = giveKeepCard(lostFreezeSource, 'p1', 'freeze_time');
  const copiedRivalFreeze = giveKeepCard(lostFreezeSource, 'p0', 'mimic');
  copiedRivalFreeze.mimicTargetInstanceId = rivalFreeze.instanceId;
  setFaces(lostFreezeSource, [1, 1, 1, 2, 'energy', 'heart']);
  prepareAndResolve(lostFreezeSource);
  assert(
    lostFreezeSource.phase === 'awaiting_freeze_time' && lostFreezeSource.pendingFreezeTimeDecisions.length === 1,
    'copied rival Freeze Time must open an optional choice',
  );
  accept(lostFreezeSource, 'rival forfeits with copied Freeze offer pending', () =>
    forfeitPlayer(lostFreezeSource, 'p1', lostFreezeSource.revision, seededRandom(515)));
  assert(
    String(lostFreezeSource.phase) === 'buying_cards' && Number(lostFreezeSource.pendingFreezeTimeDecisions.length) === 0 &&
      lostFreezeSource.queuedExtraTurns.length === 0 && copiedRivalFreeze.mimicTargetInstanceId === null,
    'discarding a forfeiting source must expire its copied Freeze offer and resume unresolved dice',
  );

  const forfeitedFreezeOwner = initKingOfTokyoGame('FREEZE-OWNER-FORFEIT', players(3), seededRandom(516), 'p0');
  giveKeepCard(forfeitedFreezeOwner, 'p0', 'freeze_time');
  setFaces(forfeitedFreezeOwner, [1, 1, 1, 2, 'energy', 'heart']);
  prepareAndResolve(forfeitedFreezeOwner);
  accept(forfeitedFreezeOwner, 'active Freeze owner forfeits during choice', () =>
    forfeitPlayer(forfeitedFreezeOwner, 'p0', forfeitedFreezeOwner.revision, seededRandom(517)));
  assert(
    forfeitedFreezeOwner.pendingFreezeTimeDecisions.length === 0 &&
      currentId(forfeitedFreezeOwner) === 'p1' && forfeitedFreezeOwner.phase === 'awaiting_roll',
    'forfeiting the active Freeze owner must clear its choices and advance exactly once',
  );

  const seatedPlayers = (order: readonly string[]) => order.map((playerId) => ({
    playerId,
    displayName: `Monster ${playerId.slice(1)}`,
  }));
  const combatResult = (state: KingOfTokyoServerState, playerIds: readonly string[]) => JSON.stringify(
    playerIds.map((playerId) => {
      const player = state.players.get(playerId)!;
      return {
        playerId,
        health: player.health,
        maxHealth: player.maxHealth,
        victoryPoints: player.victoryPoints,
        energy: player.energy,
        tokyoZone: player.tokyoZone,
        eliminated: player.eliminated,
        poisonTokens: player.poisonTokens,
        shrinkTokens: player.shrinkTokens,
        cards: player.powerCards.map((card) => ({
          cardId: card.cardId,
          mimicTargetInstanceId: card.mimicTargetInstanceId,
        })),
      };
    }),
  );

  const fireCopies = initKingOfTokyoGame('FIRE-COPIES', players(2), seededRandom(52), 'p0');
  const fire = giveKeepCard(fireCopies, 'p0', 'fire_breathing');
  giveKeepCard(fireCopies, 'p0', 'mimic').mimicTargetInstanceId = fire.instanceId;
  giveKeepCard(fireCopies, 'p1', 'armor_plating');
  fireCopies.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(fireCopies, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(fireCopies);
  assert(
    fireCopies.players.get('p1')!.health === 10,
    'Armor must ignore base Smash and each copied 1-health Fire source independently',
  );

  const fireChildPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('FIRE-ATOMIC-CHILD', seatedPlayers(order), seededRandom(521), 'p0');
    giveKeepCard(state, 'p0', 'fire_breathing');
    const child = giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = child.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = 1;
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(
      state.players.get('p1')!.health === 10 && state.players.get('p2')!.health === 10 &&
        !state.players.get('p1')!.eliminated && !state.players.get('p2')!.eliminated &&
        state.players.get('p1')!.powerCards.length === 0 && state.players.get('p2')!.powerCards.length === 0,
      'both neighbours must retain Child entitlements captured for one Fire Breathing effect',
    );
    return state;
  };
  const fireChildSourceFirst = fireChildPacket(['p0', 'p2', 'p1']);
  const fireChildCopierFirst = fireChildPacket(['p0', 'p1', 'p2']);
  assert(
    combatResult(fireChildSourceFirst, ['p1', 'p2']) === combatResult(fireChildCopierFirst, ['p1', 'p2']),
    'Fire Breathing Child outcomes must not depend on which neighbour is seated first',
  );

  const fireWingsPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('FIRE-ATOMIC-WINGS', seatedPlayers(order), seededRandom(522), 'p0');
    giveKeepCard(state, 'p0', 'fire_breathing');
    const wings = giveKeepCard(state, 'p1', 'wings');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = wings.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = 1;
    state.players.get('p2')!.energy = 2;
    state.players.get('p2')!.defenseMode = 'always';
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(
      state.pendingDefenseDecision?.kind === 'wings' && state.pendingDefenseDecision.playerId === 'p2',
      'copied Wings must remain offered after its source reaches zero in the same Fire packet',
    );
    accept(state, 'use copied Wings in Fire packet', () =>
      decideDefense(state, 'p2', { kind: 'wings', use: true }, state.revision, seededRandom(5221)));
    assert(
      state.players.get('p1')!.eliminated && !state.players.get('p2')!.eliminated &&
        state.players.get('p2')!.health === 1 && state.players.get('p2')!.energy === 0,
      'copied Wings must remain available to the second neighbour when its source dies in the same Fire effect',
    );
    return state;
  };
  const fireWingsSourceFirst = fireWingsPacket(['p0', 'p2', 'p1']);
  const fireWingsCopierFirst = fireWingsPacket(['p0', 'p1', 'p2']);
  assert(
    combatResult(fireWingsSourceFirst, ['p1', 'p2']) === combatResult(fireWingsCopierFirst, ['p1', 'p2']),
    'Fire Breathing Wings outcomes must not depend on which neighbour is seated first',
  );

  const fireBiggerPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('FIRE-ATOMIC-EVEN-BIGGER', seatedPlayers(order), seededRandom(523), 'p0');
    giveKeepCard(state, 'p0', 'fire_breathing');
    const bigger = giveKeepCard(state, 'p1', 'even_bigger');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = bigger.instanceId;
    giveKeepCard(state, 'p2', 'it_has_a_child');
    Object.assign(state.players.get('p1')!, { health: 1, maxHealth: 12 });
    Object.assign(state.players.get('p2')!, { health: 2, maxHealth: 12 });
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(
      state.players.get('p1')!.eliminated && state.players.get('p2')!.health === 1 &&
        state.players.get('p2')!.maxHealth === 10 && !state.players.get('p2')!.eliminated &&
        state.players.get('p2')!.powerCards.length === 2,
      'Fire damage resolves once; lost copied maximum must not consume Child on a living body',
    );
    return state;
  };
  const fireBiggerSourceFirst = fireBiggerPacket(['p0', 'p2', 'p1']);
  const fireBiggerCopierFirst = fireBiggerPacket(['p0', 'p1', 'p2']);
  assert(
    combatResult(fireBiggerSourceFirst, ['p1', 'p2']) === combatResult(fireBiggerCopierFirst, ['p1', 'p2']),
    'Fire Breathing Even Bigger topology must not depend on which neighbour is seated first',
  );

  const fireArmorPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('FIRE-ATOMIC-ARMOR', seatedPlayers(order), seededRandom(524), 'p0');
    giveKeepCard(state, 'p0', 'fire_breathing');
    const armor = giveKeepCard(state, 'p1', 'armor_plating');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = armor.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = 1;
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(
      state.players.get('p1')!.health === 1 && state.players.get('p2')!.health === 1,
      'actual and copied Armor Plating must each ignore the same one-point Fire effect',
    );
    return state;
  };
  const fireArmorSourceFirst = fireArmorPacket(['p0', 'p2', 'p1']);
  const fireArmorCopierFirst = fireArmorPacket(['p0', 'p1', 'p2']);
  assert(
    combatResult(fireArmorSourceFirst, ['p1', 'p2']) === combatResult(fireArmorCopierFirst, ['p1', 'p2']),
    'Fire Breathing Armor outcomes must not depend on which neighbour is seated first',
  );

  const camouflageCopies = initKingOfTokyoGame('CAMO-COPIES', players(2), seededRandom(53), 'p0');
  const camouflage = giveKeepCard(camouflageCopies, 'p1', 'camouflage');
  giveKeepCard(camouflageCopies, 'p1', 'mimic').mimicTargetInstanceId = camouflage.instanceId;
  camouflageCopies.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(camouflageCopies, ['smash', 'smash', 1, 2, 3, 'energy']);
  let camouflageRoll = 0;
  prepareAndResolve(camouflageCopies, plan(), () => {
    camouflageRoll += 1;
    return camouflageRoll <= 2 ? 0 : 0.9;
  });
  assert(
    camouflageCopies.players.get('p1')!.health === 10,
    'original and Mimic Camouflage must independently roll prevention',
  );

  const childPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('SMASH-CHILD-PACKET', seatedPlayers(order), seededRandom(531), 'p0');
    state.players.get('p0')!.tokyoZone = 'tokyo_city';
    giveKeepCard(state, 'p0', 'poison_spit');
    giveKeepCard(state, 'p0', 'shrink_ray');
    const child = giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = child.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = 1;
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    for (const playerId of ['p1', 'p2']) {
      const player = state.players.get(playerId)!;
      assert(
        !player.eliminated && player.health === 10 && player.powerCards.length === 0 &&
          player.poisonTokens === 1 && player.shrinkTokens === 1,
        `${playerId} must retain its snapshotted Child entitlement and receive attack tokens after revival`,
      );
    }
    assert(
      state.status === 'playing' && String(state.phase) === 'buying_cards',
      'simultaneous Child revivals must not cause premature survivor or mutual-destruction adjudication',
    );
    return state;
  };
  const childSourceFirst = childPacket(['p0', 'p1', 'p2']);
  const childCopyFirst = childPacket(['p0', 'p2', 'p1']);
  assert(
    combatResult(childSourceFirst, ['p1', 'p2']) === combatResult(childCopyFirst, ['p1', 'p2']),
    'source-first and copied-Child-first seating must produce identical Smash outcomes',
  );

  const eaterPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('SMASH-EATER-PACKET', seatedPlayers(order), seededRandom(532), 'p0');
    state.players.get('p0')!.tokyoZone = 'tokyo_city';
    giveKeepCard(state, 'p1', 'it_has_a_child');
    const eater = giveKeepCard(state, 'p1', 'eater_of_the_dead');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = eater.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p3')!.health = 1;
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(state.players.get('p1')!.health === 10 && state.players.get('p1')!.victoryPoints === 0,
      'a revived Eater owner must reset points after simultaneous death triggers');
    assert(state.players.get('p2')!.victoryPoints === 6,
      'a snapshotted copied Eater must score once for each other monster that reaches zero in the packet');
    assert(state.players.get('p3')!.eliminated, 'the unprotected one-health target must be eliminated');
    return state;
  };
  const eaterSourceFirst = eaterPacket(['p0', 'p1', 'p2', 'p3']);
  const eaterVictimFirst = eaterPacket(['p0', 'p3', 'p2', 'p1']);
  assert(
    combatResult(eaterSourceFirst, ['p1', 'p2', 'p3']) === combatResult(eaterVictimFirst, ['p1', 'p2', 'p3']),
    'Eater triggers and Child reset must be independent of fatal-target seating order',
  );

  const copiedDefensePacket = (
    cardId: 'camouflage' | 'armor_plating' | 'wings' | 'rapid_healing' | 'making_it_stronger',
    order: readonly string[],
  ) => {
    const state = initKingOfTokyoGame(`SMASH-${cardId}`, seatedPlayers(order), seededRandom(533), 'p0');
    state.players.get('p0')!.tokyoZone = 'tokyo_city';
    const source = giveKeepCard(state, 'p1', cardId);
    giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = source.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = cardId === 'making_it_stronger' || cardId === 'armor_plating' ? 3 : 1;
    if (cardId === 'wings' || cardId === 'rapid_healing') {
      state.players.get('p2')!.energy = 2;
      if (cardId === 'wings') state.players.get('p2')!.defenseMode = 'always';
    }
    setFaces(state, cardId === 'making_it_stronger' || cardId === 'armor_plating'
      ? ['smash', 'smash', 1, 2, 3, 'energy']
      : ['smash', 1, 2, 3, 'energy', 'heart']);
    const camouflageRolls = order.filter((playerId) => playerId !== 'p0')
      .map((playerId) => playerId === 'p1' ? 0 : 0.9);
    prepareAndResolve(state, plan(), cardId === 'camouflage'
      ? () => camouflageRolls.shift() ?? 0
      : () => 0);
    if (cardId === 'wings') {
      assert(
        state.pendingDefenseDecision?.kind === 'wings' && state.pendingDefenseDecision.playerId === 'p2',
        'copied Wings must remain offered throughout its triggering Smash packet',
      );
      accept(state, 'use copied Wings in shared Smash packet', () =>
        decideDefense(state, 'p2', { kind: 'wings', use: true }, state.revision, seededRandom(5331)));
    }
    if (cardId === 'rapid_healing') {
      assert(
        state.pendingDefenseDecision?.kind === 'rapid_healing' &&
          state.pendingDefenseDecision.playerId === 'p2',
        'copied Rapid Healing must remain offered throughout its triggering Smash packet',
      );
      accept(state, 'use copied Rapid Healing in shared Smash packet', () =>
        decideDefense(
          state,
          'p2',
          { kind: 'rapid_healing', activations: 1 },
          state.revision,
          seededRandom(5332),
        ));
    }
    return state;
  };
  for (const cardId of ['camouflage', 'armor_plating', 'wings', 'rapid_healing', 'making_it_stronger'] as const) {
    const sourceFirst = copiedDefensePacket(cardId, ['p0', 'p1', 'p2']);
    const copierFirst = copiedDefensePacket(cardId, ['p0', 'p2', 'p1']);
    assert(
      combatResult(sourceFirst, ['p1', 'p2']) === combatResult(copierFirst, ['p1', 'p2']),
      `copied ${cardId} resolution must not depend on whether its source is seated first`,
    );
    const copier = sourceFirst.players.get('p2')!;
    if (cardId === 'camouflage') assert(copier.health === 1 && !copier.eliminated,
      'copied Camouflage must remain available throughout its triggering Smash packet');
    if (cardId === 'wings') assert(copier.health === 1 && copier.energy === 0 && !copier.eliminated,
      'copied Wings must be allowed to spend energy before its source is discarded');
    if (cardId === 'rapid_healing') assert(copier.health === 1 && copier.energy === 0 && !copier.eliminated,
      'copied Rapid Healing must be allowed to prevent lethal Smash before source discard');
    if (cardId === 'making_it_stronger') assert(copier.health === 1 && copier.energy === 1,
      'copied Making It Stronger must trigger from the same Smash packet before source discard');
    if (cardId === 'armor_plating') assert(copier.health === 1,
      'Armor Plating must consistently ignore only one-point packets, independent of seating');
  }

  const copiedJetsPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('SMASH-JETS-SNAPSHOT', seatedPlayers(order), seededRandom(534), 'p0');
    giveKeepCard(state, 'p0', 'nova_breath');
    const jets = giveKeepCard(state, 'p1', 'jets');
    giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = jets.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.tokyoZone = 'tokyo_city';
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(
      String(state.phase) === 'awaiting_tokyo_decision' && state.pendingTokyoDecisions[0] === 'p2' &&
        state.pendingTokyoDamage.get('p2')?.jetsSnapshotGranted === true,
      'a copied Jets grant triggered by the packet must survive its source Child discard',
    );
    accept(state, 'yield using packet-snapshotted Jets', () =>
      decideTokyoYield(state, 'p2', true, state.revision, seededRandom(535)));
    assert(state.players.get('p2')!.health === 10 && state.players.get('p2')!.tokyoZone === null,
      'snapshotted Jets must prevent the triggering Smash when the target yields');
    return state;
  };
  const jetsSourceFirst = copiedJetsPacket(['p0', 'p1', 'p2']);
  const jetsTargetFirst = copiedJetsPacket(['p0', 'p2', 'p1']);
  assert(
    combatResult(jetsSourceFirst, ['p1', 'p2']) === combatResult(jetsTargetFirst, ['p1', 'p2']),
    'copied Jets source removal must be independent of seating order',
  );

  const jetsStayEntitlementPacket = (
    cardId: 'it_has_a_child' | 'wings',
    order: readonly string[],
  ) => {
    const state = initKingOfTokyoGame(`JETS-STAY-${cardId}`, seatedPlayers(order), seededRandom(5351), 'p0');
    giveKeepCard(state, 'p0', 'nova_breath');
    const source = giveKeepCard(state, 'p1', cardId);
    if (cardId !== 'it_has_a_child') giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'jets');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = source.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.health = 1;
    state.players.get('p2')!.tokyoZone = 'tokyo_city';
    if (cardId === 'wings') {
      state.players.get('p2')!.energy = 2;
      state.players.get('p2')!.defenseMode = 'always';
    }
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    const pending = state.pendingTokyoDamage.get('p2');
    assert(
      pending?.smashEntitlements.childEntitled === (cardId === 'it_has_a_child') &&
        pending?.smashEntitlements.wings === (cardId === 'wings' ? 1 : 0) &&
        state.players.get('p2')!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId === null,
      `Jets must retain packet-time copied ${cardId} after the source disappears`,
    );
    accept(state, `stay with snapshotted ${cardId}`, () =>
      decideTokyoYield(state, 'p2', false, state.revision, seededRandom(5352)));
    if (cardId === 'wings') {
      assert(
        state.pendingDefenseDecision?.kind === 'wings' && state.pendingDefenseDecision.playerId === 'p2',
        'Jets STAY must offer copied Wings captured by the triggering Smash',
      );
      accept(state, 'use copied Wings after Jets STAY', () =>
        decideDefense(state, 'p2', { kind: 'wings', use: true }, state.revision, seededRandom(53521)));
    }
    const target = state.players.get('p2')!;
    if (cardId === 'it_has_a_child') {
      assert(target.health === 10 && !target.eliminated && target.powerCards.length === 0 && target.tokyoZone === null,
        'Jets STAY must honour copied Child captured by the triggering Smash');
    } else {
      assert(target.health === 1 && target.energy === 0 && !target.eliminated && target.tokyoZone === 'tokyo_city',
        'Jets STAY must honour copied Wings captured by the triggering Smash');
    }
    return state;
  };
  for (const cardId of ['it_has_a_child', 'wings'] as const) {
    const sourceFirst = jetsStayEntitlementPacket(cardId, ['p0', 'p1', 'p2']);
    const targetFirst = jetsStayEntitlementPacket(cardId, ['p0', 'p2', 'p1']);
    assert(
      combatResult(sourceFirst, ['p1', 'p2']) === combatResult(targetFirst, ['p1', 'p2']),
      `Jets STAY with copied ${cardId} must be independent of seating order`,
    );
  }

  const jetsStayBiggerPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('JETS-STAY-EVEN-BIGGER', seatedPlayers(order), seededRandom(5353), 'p0');
    giveKeepCard(state, 'p0', 'nova_breath');
    const bigger = giveKeepCard(state, 'p1', 'even_bigger');
    giveKeepCard(state, 'p2', 'jets');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = bigger.instanceId;
    giveKeepCard(state, 'p2', 'it_has_a_child');
    giveKeepCard(state, 'p3', 'eater_of_the_dead');
    state.players.get('p1')!.health = 1;
    Object.assign(state.players.get('p2')!, { health: 2, maxHealth: 12, tokyoZone: 'tokyo_city' as const });
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    const pending = state.pendingTokyoDamage.get('p2');
    assert(
      pending?.deferredEvenBiggerLoss === 0 && state.players.get('p2')!.health === 2 &&
        state.players.get('p2')!.maxHealth === 10 && state.players.get('p3')!.victoryPoints === 3,
      'copied maximum loss must clamp immediately without adding a deferred damage packet',
    );
    accept(state, 'stay before deferred Even Bigger loss', () =>
      decideTokyoYield(state, 'p2', false, state.revision, seededRandom(5354)));
    assert(
      state.players.get('p2')!.health === 1 && state.players.get('p2')!.maxHealth === 10 &&
        !state.players.get('p2')!.eliminated && state.players.get('p2')!.powerCards.length === 3 &&
        state.players.get('p3')!.victoryPoints === 3,
      'Jets STAY must apply only committed Smash without phantom Child or Eater triggers',
    );
    return state;
  };
  const biggerSourceFirst = jetsStayBiggerPacket(['p0', 'p1', 'p2', 'p3']);
  const biggerTargetFirst = jetsStayBiggerPacket(['p0', 'p2', 'p3', 'p1']);
  assert(
    combatResult(biggerSourceFirst, ['p1', 'p2', 'p3']) === combatResult(biggerTargetFirst, ['p1', 'p2', 'p3']),
    'Jets STAY with copied Even Bigger loss must be independent of seating order',
  );

  const jetsYieldBigger = initKingOfTokyoGame('JETS-YIELD-EVEN-BIGGER', players(3), seededRandom(5355), 'p0');
  giveKeepCard(jetsYieldBigger, 'p0', 'nova_breath');
  const yieldedBigger = giveKeepCard(jetsYieldBigger, 'p1', 'even_bigger');
  giveKeepCard(jetsYieldBigger, 'p2', 'jets');
  giveKeepCard(jetsYieldBigger, 'p2', 'mimic').mimicTargetInstanceId = yieldedBigger.instanceId;
  jetsYieldBigger.players.get('p1')!.health = 1;
  Object.assign(jetsYieldBigger.players.get('p2')!, { health: 4, maxHealth: 12, tokyoZone: 'tokyo_city' as const });
  setFaces(jetsYieldBigger, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(jetsYieldBigger);
  accept(jetsYieldBigger, 'yield before deferred Even Bigger loss', () =>
    decideTokyoYield(jetsYieldBigger, 'p2', true, jetsYieldBigger.revision, seededRandom(5356)));
  assert(
    jetsYieldBigger.players.get('p2')!.health === 4 && jetsYieldBigger.players.get('p2')!.maxHealth === 10 &&
      !jetsYieldBigger.players.get('p2')!.eliminated && jetsYieldBigger.players.get('p2')!.tokyoZone === null,
    'Jets YIELD must prevent Smash without additional damage from losing its copied maximum',
  );


  const copiedBurrowingPacket = (order: readonly string[]) => {
    const state = initKingOfTokyoGame('SMASH-BURROWING-LIVE', seatedPlayers(order), seededRandom(536), 'p0');
    giveKeepCard(state, 'p0', 'nova_breath');
    const burrowing = giveKeepCard(state, 'p1', 'burrowing');
    giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p2', 'mimic').mimicTargetInstanceId = burrowing.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.tokyoZone = 'tokyo_city';
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(String(state.phase) === 'awaiting_tokyo_decision' && state.pendingTokyoDecisions[0] === 'p2',
      'the wounded Tokyo target must receive a normal Yield decision');
    accept(state, 'yield after copied Burrowing source leaves', () =>
      decideTokyoYield(state, 'p2', true, state.revision, seededRandom(537)));
    assert(state.players.get('p0')!.health === 10,
      'Burrowing retaliation must query live cards at the later Yield decision');
    return state;
  };
  const burrowingSourceFirst = copiedBurrowingPacket(['p0', 'p1', 'p2']);
  const burrowingTargetFirst = copiedBurrowingPacket(['p0', 'p2', 'p1']);
  assert(
    combatResult(burrowingSourceFirst, ['p0', 'p1', 'p2']) ===
      combatResult(burrowingTargetFirst, ['p0', 'p1', 'p2']),
    'live Burrowing Yield resolution must be independent of seating order',
  );

  const preventedAttack = initKingOfTokyoGame('PREVENTED-ROLLED-ATTACK', players(2), seededRandom(538), 'p0');
  giveKeepCard(preventedAttack, 'p0', 'alpha_monster');
  giveKeepCard(preventedAttack, 'p0', 'fire_breathing');
  giveKeepCard(preventedAttack, 'p1', 'camouflage');
  preventedAttack.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(preventedAttack, ['smash', 1, 2, 3, 'energy', 'heart']);
  const preventedRolls = [0.9, 0];
  prepareAndResolve(preventedAttack, plan(), () => preventedRolls.shift() ?? 0);
  assert(
    preventedAttack.players.get('p0')!.victoryPoints === 1 && preventedAttack.players.get('p1')!.health === 9 &&
      preventedAttack.log.some((entry) => entry.text.includes('from Alpha Monster')),
    'rolled Smash must trigger Alpha and separate Fire loss even when direct Smash is wholly prevented',
  );

  const yieldedAttack = initKingOfTokyoGame('JETS-YIELD-ROLLED-ATTACK', players(2), seededRandom(539), 'p0');
  giveKeepCard(yieldedAttack, 'p0', 'alpha_monster');
  giveKeepCard(yieldedAttack, 'p0', 'fire_breathing');
  giveKeepCard(yieldedAttack, 'p1', 'jets');
  yieldedAttack.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(yieldedAttack, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(yieldedAttack);
  assert(yieldedAttack.players.get('p0')!.victoryPoints === 0,
    'Alpha and Fire must remain pending until the rolled Smash and Yield batch finishes');
  accept(yieldedAttack, 'Jets yields from the only Smash', () =>
    decideTokyoYield(yieldedAttack, 'p1', true, yieldedAttack.revision, seededRandom(540)));
  assert(
    yieldedAttack.players.get('p0')!.victoryPoints === 2 && yieldedAttack.players.get('p1')!.health === 9 &&
      yieldedAttack.log.some((entry) => entry.text.includes('from Alpha Monster')),
    'rolled Smash must trigger Alpha and separate Fire loss after Jets prevents direct Smash',
  );

  const emptyTokyoAttack = initKingOfTokyoGame('EMPTY-TOKYO-ROLLED-ATTACK', players(2), seededRandom(5391), 'p0');
  giveKeepCard(emptyTokyoAttack, 'p0', 'alpha_monster');
  giveKeepCard(emptyTokyoAttack, 'p0', 'fire_breathing');
  setFaces(emptyTokyoAttack, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(emptyTokyoAttack);
  assert(
    emptyTokyoAttack.players.get('p0')!.victoryPoints === 2 && emptyTokyoAttack.players.get('p1')!.health === 9 &&
      emptyTokyoAttack.log.some((entry) => entry.text.includes("Smash hit no monsters")),
    'rolled Smash must trigger Alpha and Fire even when Tokyo is empty and direct Smash has no targets',
  );

  const addedSmashOnly = initKingOfTokyoGame('CARD-ADDED-SMASH-CASCADE', players(2), seededRandom(5392), 'p0');
  giveKeepCard(addedSmashOnly, 'p0', 'acid_attack');
  giveKeepCard(addedSmashOnly, 'p0', 'spiked_tail');
  giveKeepCard(addedSmashOnly, 'p0', 'alpha_monster');
  giveKeepCard(addedSmashOnly, 'p0', 'fire_breathing');
  addedSmashOnly.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(addedSmashOnly, [1, 2, 3, 'energy', 'heart', 'heart']);
  prepareAndResolve(addedSmashOnly);
  accept(addedSmashOnly, 'stay after card-added Smash only', () =>
    decideTokyoYield(addedSmashOnly, 'p1', false, addedSmashOnly.revision, seededRandom(5393)));
  assert(
    addedSmashOnly.players.get('p0')!.victoryPoints === 1 && addedSmashOnly.players.get('p1')!.health === 7 &&
      addedSmashOnly.log.some((entry) => entry.text.includes('from Alpha Monster')),
    'Acid-added Smash must cascade into Spiked Tail, Alpha Monster, and Fire Breathing',
  );

  const burrowingOnly = initKingOfTokyoGame('BURROWING-ADDED-SMASH', players(2), seededRandom(5394), 'p0');
  giveKeepCard(burrowingOnly, 'p0', 'burrowing');
  burrowingOnly.players.get('p0')!.tokyoZone = 'tokyo_city';
  setFaces(burrowingOnly, [1, 2, 3, 'energy', 'heart', 'heart']);
  prepareAndResolve(burrowingOnly);
  assert(
    burrowingOnly.players.get('p1')!.health === 9,
    'Burrowing must add Smash to an in-Tokyo roll even when no other Smash source exists',
  );

  const burrowingCascade = initKingOfTokyoGame('BURROWING-SMASH-CASCADE', players(2), seededRandom(5395), 'p0');
  giveKeepCard(burrowingCascade, 'p0', 'burrowing');
  giveKeepCard(burrowingCascade, 'p0', 'spiked_tail');
  giveKeepCard(burrowingCascade, 'p0', 'urbavore');
  giveKeepCard(burrowingCascade, 'p0', 'alpha_monster');
  giveKeepCard(burrowingCascade, 'p0', 'fire_breathing');
  burrowingCascade.players.get('p0')!.tokyoZone = 'tokyo_city';
  setFaces(burrowingCascade, [1, 2, 3, 'energy', 'heart', 'heart']);
  prepareAndResolve(burrowingCascade);
  assert(
    burrowingCascade.players.get('p0')!.victoryPoints === 1 &&
      burrowingCascade.players.get('p1')!.health === 6,
    'Burrowing-added Smash must cascade into Spiked Tail, Urbavore, Alpha Monster, and Fire Breathing',
  );

  const woundedFireCopies = initKingOfTokyoGame('WOUNDED-FIRE-COPIES', players(2), seededRandom(541), 'p0');
  const fireSource = giveKeepCard(woundedFireCopies, 'p0', 'fire_breathing');
  giveKeepCard(woundedFireCopies, 'p0', 'mimic').mimicTargetInstanceId = fireSource.instanceId;
  giveKeepCard(woundedFireCopies, 'p0', 'alpha_monster');
  woundedFireCopies.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(woundedFireCopies, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(woundedFireCopies);
  assert(woundedFireCopies.players.get('p0')!.victoryPoints === 0,
    'attack rewards must wait for the full Smash and Yield batch');
  accept(woundedFireCopies, 'stay after wounded copied Fire attack', () =>
    decideTokyoYield(woundedFireCopies, 'p1', false, woundedFireCopies.revision, seededRandom(542)));
  assert(
    woundedFireCopies.players.get('p0')!.victoryPoints === 1 && woundedFireCopies.players.get('p1')!.health === 7,
    'a wound must trigger Alpha once and each snapshotted Fire Breathing copy once',
  );

  const woundedAlphaCopies = initKingOfTokyoGame('WOUNDED-ALPHA-COPIES', players(2), seededRandom(543), 'p0');
  const alphaSource = giveKeepCard(woundedAlphaCopies, 'p0', 'alpha_monster');
  giveKeepCard(woundedAlphaCopies, 'p0', 'mimic').mimicTargetInstanceId = alphaSource.instanceId;
  giveKeepCard(woundedAlphaCopies, 'p0', 'fire_breathing');
  woundedAlphaCopies.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(woundedAlphaCopies, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(woundedAlphaCopies);
  accept(woundedAlphaCopies, 'stay after wounded copied Alpha attack', () =>
    decideTokyoYield(woundedAlphaCopies, 'p1', false, woundedAlphaCopies.revision, seededRandom(544)));
  assert(
    woundedAlphaCopies.players.get('p0')!.victoryPoints === 2 && woundedAlphaCopies.players.get('p1')!.health === 8,
    'each snapshotted Alpha copy and Fire source must trigger exactly once after a wound',
  );

  const capturedAttackCard = (cardId: 'alpha_monster' | 'fire_breathing', order: readonly string[]) => {
    const state = initKingOfTokyoGame(`CAPTURED-${cardId}`, seatedPlayers(order), seededRandom(545), 'p0');
    giveKeepCard(state, 'p0', 'nova_breath');
    const source = giveKeepCard(state, 'p1', cardId);
    giveKeepCard(state, 'p1', 'it_has_a_child');
    giveKeepCard(state, 'p0', 'mimic').mimicTargetInstanceId = source.instanceId;
    state.players.get('p1')!.health = 1;
    state.players.get('p2')!.tokyoZone = 'tokyo_city';
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state);
    assert(state.players.get('p0')!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId === null,
      `copied ${cardId} source must actually leave before attack aftermath`);
    accept(state, `stay after captured ${cardId} source leaves`, () =>
      decideTokyoYield(state, 'p2', false, state.revision, seededRandom(546)));
    if (cardId === 'alpha_monster') {
      assert(state.players.get('p0')!.victoryPoints === 1,
        'captured Alpha count must survive its source leaving during the Smash packet');
    } else {
      assert(state.players.get('p1')!.health === 9 && state.players.get('p2')!.health === 8,
        'captured Fire count and neighbour identities must survive source removal during the Smash packet');
    }
    return state;
  };
  for (const cardId of ['alpha_monster', 'fire_breathing'] as const) {
    const sourceFirst = capturedAttackCard(cardId, ['p0', 'p1', 'p2']);
    const otherTargetFirst = capturedAttackCard(cardId, ['p0', 'p2', 'p1']);
    assert(
      combatResult(sourceFirst, ['p0', 'p1', 'p2']) === combatResult(otherTargetFirst, ['p0', 'p1', 'p2']),
      `captured ${cardId} aftermath must be independent of target seating`,
    );
  }

  const composed = initKingOfTokyoGame('COMPOSED', players(2), seededRandom(54), 'p0');
  giveKeepCard(composed, 'p0', 'poison_quills');
  giveKeepCard(composed, 'p0', 'spiked_tail');
  giveKeepCard(composed, 'p0', 'alpha_monster');
  giveKeepCard(composed, 'p0', 'fire_breathing');
  composed.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(composed, [2, 2, 2, 1, 'energy', 'heart']);
  prepareAndResolve(composed);
  accept(composed, 'stay after composed Quills attack', () =>
    decideTokyoYield(composed, 'p1', false, composed.revision, seededRandom(55)));
  assert(composed.players.get('p1')!.health === 6, 'Quills must compose with Spiked Tail and Fire Breathing');
  assert(composed.players.get('p0')!.victoryPoints === 3, 'Quills attack must trigger Alpha plus triple-2 score');
}

function committedForfeitScenarios(): void {
  const activeJets = initKingOfTokyoGame('FORFEIT-ACTIVE-JETS', players(4), seededRandom(546), 'p0');
  giveKeepCard(activeJets, 'p0', 'fire_breathing');
  giveKeepCard(activeJets, 'p1', 'jets');
  activeJets.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(activeJets, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(activeJets);
  assert(
    String(activeJets.phase) === 'awaiting_tokyo_decision' && activeJets.pendingTokyoDamage.has('p1'),
    'active-forfeit Jets fixture must commit deferred Smash before the attacker leaves',
  );
  accept(activeJets, 'active attacker forfeits after Jets damage commits', () =>
    forfeitPlayer(activeJets, 'p0', activeJets.revision, seededRandom(5461)));
  assert(
    String(activeJets.phase) === 'awaiting_tokyo_decision' && activeJets.pendingTokyoDamage.has('p1') &&
      activeJets.pendingSmashAftermath?.fireSources === 1,
    'active forfeit must preserve committed Jets damage and captured Fire aftermath',
  );
  accept(activeJets, 'Jets target yields after attacker forfeit', () =>
    decideTokyoYield(activeJets, 'p1', true, activeJets.revision, seededRandom(5462)));
  assert(
    activeJets.players.get('p1')!.health === 9 && activeJets.players.get('p3')!.health === 9 &&
      activeJets.players.get('p1')!.tokyoZone === null && currentId(activeJets) === 'p1' &&
      String(activeJets.phase) === 'awaiting_roll',
    'Jets prevention must settle before captured Fire and only then advance the forfeited attacker turn',
  );

  const activeFire = initKingOfTokyoGame('FORFEIT-ACTIVE-FIRE', players(3), seededRandom(5463), 'p0');
  giveKeepCard(activeFire, 'p0', 'fire_breathing');
  giveKeepCard(activeFire, 'p1', 'camouflage');
  giveKeepCard(activeFire, 'p1', 'stretchy');
  activeFire.players.get('p1')!.energy = 2;
  setFaces(activeFire, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(activeFire, plan(), () => 0);
  assert(
    activeFire.pendingDefenseDecision?.kind === 'camouflage' && activeFire.pendingDefenseDecision.playerId === 'p1',
    'active-forfeit Fire fixture must pause inside its committed neighbour packet',
  );
  accept(activeFire, 'active Fire owner forfeits during neighbour defence', () =>
    forfeitPlayer(activeFire, 'p0', activeFire.revision, seededRandom(5464)));
  accept(activeFire, 'Fire neighbour resolves after active source forfeit', () =>
    decideDefense(activeFire, 'p1', { kind: 'camouflage', changes: [] }, activeFire.revision, seededRandom(5465)));
  assert(
    activeFire.players.get('p1')!.health === 9 && activeFire.players.get('p2')!.health === 9 &&
      currentId(activeFire) === 'p1' && String(activeFire.phase) === 'awaiting_roll',
    'forfeiting the active Fire source must not spare either victim in the committed packet',
  );

  const targetFire = initKingOfTokyoGame('FORFEIT-TARGET-FIRE', players(4), seededRandom(5466), 'p0');
  giveKeepCard(targetFire, 'p0', 'fire_breathing');
  giveKeepCard(targetFire, 'p1', 'camouflage');
  giveKeepCard(targetFire, 'p1', 'stretchy');
  targetFire.players.get('p1')!.energy = 2;
  setFaces(targetFire, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(targetFire, plan(), () => 0);
  assert(
    targetFire.pendingDefenseDecision?.kind === 'camouflage' && targetFire.pendingDefenseDecision.playerId === 'p1',
    'target-forfeit Fire fixture must pause on the first neighbour',
  );
  accept(targetFire, 'current Fire target forfeits during defence', () =>
    forfeitPlayer(targetFire, 'p1', targetFire.revision, seededRandom(5467)));
  assert(
    targetFire.players.get('p1')!.eliminated && targetFire.players.get('p3')!.health === 9 &&
      String(targetFire.phase) === 'buying_cards',
    'a target forfeit may skip that body but must not cancel later victims in the Fire packet',
  );

  const copiedFire = initKingOfTokyoGame('FORFEIT-COPIED-FIRE-SOURCE', players(3), seededRandom(5468), 'p0');
  const remoteFire = giveKeepCard(copiedFire, 'p1', 'fire_breathing');
  giveKeepCard(copiedFire, 'p0', 'mimic').mimicTargetInstanceId = remoteFire.instanceId;
  giveKeepCard(copiedFire, 'p2', 'camouflage');
  giveKeepCard(copiedFire, 'p2', 'stretchy');
  copiedFire.players.get('p2')!.energy = 2;
  setFaces(copiedFire, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(copiedFire, plan(), () => 0);
  assert(
    copiedFire.pendingDefenseDecision?.kind === 'camouflage' && copiedFire.pendingDefenseDecision.playerId === 'p2',
    'copied Fire fixture must reach the second neighbour defence',
  );
  accept(copiedFire, 'copied Fire physical source forfeits mid-packet', () =>
    forfeitPlayer(copiedFire, 'p1', copiedFire.revision, seededRandom(5469)));
  assert(
    copiedFire.players.get('p0')!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId === null,
    'source forfeit must still clear the now-broken Fire Mimic',
  );
  accept(copiedFire, 'copied Fire victim resolves after source loss', () =>
    decideDefense(copiedFire, 'p2', { kind: 'camouflage', changes: [] }, copiedFire.revision, seededRandom(5470)));
  assert(
    copiedFire.players.get('p2')!.health === 9 && String(copiedFire.phase) === 'buying_cards',
    'losing a copied Fire source must not revoke the already committed neighbour packet',
  );

  const activeOpportunist = initKingOfTokyoGame('FORFEIT-ACTIVE-OPPORTUNIST', players(3), seededRandom(5471), 'p0');
  giveKeepCard(activeOpportunist, 'p1', 'opportunist');
  activeOpportunist.players.get('p1')!.energy = 20;
  activeOpportunist.phase = 'awaiting_opportunist';
  activeOpportunist.pendingOpportunist = {
    cardInstanceId: activeOpportunist.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  accept(activeOpportunist, 'active buyer forfeits during rival Opportunist right', () =>
    forfeitPlayer(activeOpportunist, 'p0', activeOpportunist.revision, seededRandom(5472)));
  assert(
    activeOpportunist.pendingOpportunist?.playerIds.join(',') === 'p1' &&
      String(activeOpportunist.phase) === 'awaiting_opportunist',
    'active forfeit must preserve an already offered rival Opportunist right',
  );
  accept(activeOpportunist, 'rival passes Opportunist after active forfeit', () =>
    decideOpportunist(activeOpportunist, 'p1', false, activeOpportunist.revision, seededRandom(5473)));
  assert(
    currentId(activeOpportunist) === 'p1' && String(activeOpportunist.phase) === 'awaiting_roll',
    'the dead active turn must advance only after the captured Opportunist right settles',
  );

  const nextOpportunist = initKingOfTokyoGame('FORFEIT-FIRST-OPPORTUNIST', players(4), seededRandom(5474), 'p0');
  const opportunistSource = giveKeepCard(nextOpportunist, 'p1', 'opportunist');
  giveKeepCard(nextOpportunist, 'p2', 'mimic').mimicTargetInstanceId = opportunistSource.instanceId;
  nextOpportunist.players.get('p1')!.energy = 20;
  nextOpportunist.players.get('p2')!.energy = 20;
  nextOpportunist.phase = 'awaiting_opportunist';
  nextOpportunist.pendingOpportunist = {
    cardInstanceId: nextOpportunist.market[0]!.instanceId,
    playerIds: ['p1', 'p2'],
  };
  accept(nextOpportunist, 'first Opportunist responder forfeits', () =>
    forfeitPlayer(nextOpportunist, 'p1', nextOpportunist.revision, seededRandom(5475)));
  assert(
    nextOpportunist.pendingOpportunist?.playerIds.join(',') === 'p2' &&
      nextOpportunist.players.get('p2')!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId === null,
    'the next captured Opportunist right must survive the first responder and source forfeiting',
  );
  accept(nextOpportunist, 'next captured Opportunist passes', () =>
    decideOpportunist(nextOpportunist, 'p2', false, nextOpportunist.revision, seededRandom(5476)));

  const initialMimic = initKingOfTokyoGame('FORFEIT-ACTIVE-MANDATORY-MIMIC', players(3), seededRandom(5477), 'p0');
  giveKeepCard(initialMimic, 'p1', 'opportunist');
  const mimicTarget = giveKeepCard(initialMimic, 'p2', 'acid_attack');
  initialMimic.players.get('p1')!.energy = 20;
  exposeCard(initialMimic, 'mimic');
  initialMimic.phase = 'awaiting_opportunist';
  initialMimic.pendingOpportunist = {
    cardInstanceId: initialMimic.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  accept(initialMimic, 'off-turn Opportunist buys mandatory Mimic', () =>
    decideOpportunist(initialMimic, 'p1', true, initialMimic.revision, seededRandom(5478)));
  const boughtMimic = initialMimic.players.get('p1')!.powerCards.find((card) => card.cardId === 'mimic')!;
  assert(
    initialMimic.usedThisTurn.has(`mimic_initial:${boughtMimic.instanceId}`) &&
      String(initialMimic.phase) === 'awaiting_opportunist',
    'off-turn bought Mimic must stop the market continuation for its mandatory initial target',
  );
  accept(initialMimic, 'active player forfeits during mandatory off-turn Mimic', () =>
    forfeitPlayer(initialMimic, 'p0', initialMimic.revision, seededRandom(5479)));
  assert(
    initialMimic.usedThisTurn.has(`mimic_initial:${boughtMimic.instanceId}`),
    'active forfeit must not erase another player’s mandatory initial Mimic choice',
  );
  accept(initialMimic, 'off-turn Mimic chooses its target after active forfeit', () =>
    usePowerCard(initialMimic, 'p1', boughtMimic.instanceId, {
      targetCardInstanceId: mimicTarget.instanceId,
    }, initialMimic.revision, seededRandom(5480)));
  assert(
    boughtMimic.mimicTargetInstanceId === mimicTarget.instanceId &&
      !initialMimic.usedThisTurn.has(`mimic_initial:${boughtMimic.instanceId}`),
    'mandatory Mimic target must be retained and applied after the active player leaves',
  );
  for (let responses = 0; String(initialMimic.phase) === 'awaiting_opportunist' && responses < 4; responses += 1) {
    const responderId = initialMimic.pendingOpportunist?.playerIds[0];
    if (!responderId) break;
    accept(initialMimic, 'pass refill Opportunist after mandatory Mimic', () =>
      decideOpportunist(initialMimic, responderId, false, initialMimic.revision, seededRandom(5481 + responses)));
  }
  assert(
    currentId(initialMimic) === 'p1' && String(initialMimic.phase) === 'awaiting_roll',
    'the forfeited active turn must advance after mandatory Mimic and queued market rights finish',
  );
}

function victoryAndRecoveryScenarios(): void {
  const flameThenPoison = initKingOfTokyoGame('FLAME-THEN-POISON', players(2), seededRandom(549), 'p0');
  flameThenPoison.players.get('p0')!.health = 1;
  flameThenPoison.players.get('p0')!.poisonTokens = 1;
  flameThenPoison.players.get('p0')!.energy = 10;
  flameThenPoison.players.get('p1')!.health = 2;
  flameThenPoison.phase = 'buying_cards';
  exposeCard(flameThenPoison, 'flame_thrower');
  accept(flameThenPoison, 'last rival falls to Flame Thrower', () =>
    buyPowerCard(flameThenPoison, 'p0', 0, flameThenPoison.revision, seededRandom(5491)));
  assert(
    flameThenPoison.status === 'playing' && flameThenPoison.players.get('p1')!.eliminated &&
      flameThenPoison.phase === 'buying_cards',
    'a sole survivor created by an atomic card effect must still finish the active turn',
  );
  accept(flameThenPoison, 'sole survivor resolves Poison at end of turn', () =>
    endTurn(flameThenPoison, 'p0', flameThenPoison.revision, seededRandom(5492)));
  assert(
    flameThenPoison.victoryType === 'mutual_destruction' && flameThenPoison.winnerId === null,
    'end-turn Poison must be able to eliminate the provisional sole survivor',
  );

  const delayedSurvivor = initKingOfTokyoGame('DELAYED-SURVIVOR', players(3), seededRandom(55), 'p0');
  delayedSurvivor.players.get('p0')!.tokyoZone = 'tokyo_city';
  delayedSurvivor.players.get('p0')!.health = 2;
  delayedSurvivor.players.get('p0')!.energy = 3;
  delayedSurvivor.players.get('p1')!.health = 1;
  delayedSurvivor.players.get('p2')!.health = 1;
  setFaces(delayedSurvivor, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(delayedSurvivor);
  assert(
    String(delayedSurvivor.phase) === 'buying_cards' && delayedSurvivor.status === 'playing',
    'sole survivor must still reach Buy before end-turn adjudication',
  );
  exposeCard(delayedSurvivor, 'national_guard');
  accept(delayedSurvivor, 'sole survivor self-eliminates in Buy', () =>
    buyPowerCard(delayedSurvivor, 'p0', 0, delayedSurvivor.revision, seededRandom(56)));
  assert(
    delayedSurvivor.victoryType === 'mutual_destruction' && delayedSurvivor.winnerId === null,
    'self-eliminating last survivor must leave no winner',
  );

  const twentyAndDead = initKingOfTokyoGame('TWENTY-DEAD', players(2), seededRandom(57), 'p0');
  const doomed = twentyAndDead.players.get('p0')!;
  doomed.victoryPoints = 18;
  doomed.health = 2;
  doomed.energy = 3;
  setFaces(twentyAndDead, [1, 1, 1, 2, 3, 'energy']);
  prepareAndResolve(twentyAndDead);
  assert(doomed.victoryPoints === 20 && twentyAndDead.status === 'playing', '20 points must wait until End');
  exposeCard(twentyAndDead, 'national_guard');
  accept(twentyAndDead, '20-point monster dies before End', () =>
    buyPowerCard(twentyAndDead, 'p0', 0, twentyAndDead.revision, seededRandom(58)));
  assert(
    twentyAndDead.winnerId === 'p1' && twentyAndDead.victoryType === 'last_monster_standing',
    '20 points plus 0 health in one turn must lose to the survivor',
  );

  const offTurnTwenty = initKingOfTokyoGame('OFF-TURN-TWENTY', players(3), seededRandom(59), 'p0');
  offTurnTwenty.players.get('p0')!.tokyoZone = 'tokyo_city';
  offTurnTwenty.players.get('p1')!.victoryPoints = 17;
  giveKeepCard(offTurnTwenty, 'p1', 'eater_of_the_dead');
  offTurnTwenty.players.get('p2')!.health = 1;
  setFaces(offTurnTwenty, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(offTurnTwenty);
  assert(offTurnTwenty.players.get('p1')!.victoryPoints === 20, 'Eater may reach 20 off-turn');
  accept(offTurnTwenty, 'active monster ends while rival has 20', () =>
    endTurn(offTurnTwenty, 'p0', offTurnTwenty.revision));
  assert(
    offTurnTwenty.status === 'playing' && currentId(offTurnTwenty) === 'p1',
    'a monster wins only at the end of its own turn',
  );
  offTurnTwenty.phase = 'buying_cards';
  accept(offTurnTwenty, 'off-turn scorer reaches own End', () =>
    endTurn(offTurnTwenty, 'p1', offTurnTwenty.revision));
  assert(
    offTurnTwenty.winnerId === 'p1' && offTurnTwenty.victoryType === 'victory_points',
    'off-turn scorer must win at the end of its own surviving turn',
  );

  const simultaneous = initKingOfTokyoGame('SIMULTANEOUS', players(2), seededRandom(60), 'p0');
  simultaneous.players.get('p0')!.health = 3;
  simultaneous.players.get('p1')!.health = 3;
  simultaneous.players.get('p0')!.energy = 7;
  simultaneous.phase = 'buying_cards';
  exposeCard(simultaneous, 'high_altitude_bombing');
  accept(simultaneous, 'all monsters eliminated simultaneously', () =>
    buyPowerCard(simultaneous, 'p0', 0, simultaneous.revision, seededRandom(61)));
  assert(
    simultaneous.victoryType === 'mutual_destruction' && simultaneous.winnerId === null,
    'simultaneous elimination must produce no winner',
  );

  const child = initKingOfTokyoGame('CHILD-END-EFFECTS', players(2), seededRandom(62), 'p0');
  giveKeepCard(child, 'p0', 'it_has_a_child');
  giveKeepCard(child, 'p0', 'energy_hoarder');
  const childPlayer = child.players.get('p0')!;
  childPlayer.health = 1;
  childPlayer.energy = 6;
  childPlayer.poisonTokens = 1;
  child.phase = 'buying_cards';
  accept(child, 'open Child end-effect ordering', () =>
    endTurn(child, 'p0', child.revision, seededRandom(63)));
  assert(String(child.phase) === 'resolving_end_turn', 'Child fixture must expose ordered end effects');
  accept(child, 'Poison triggers It Has a Child', () =>
    resolveEndTurnEffect(child, 'p0', 'poison', child.revision, seededRandom(64)));
  assert(
    childPlayer.health === 10 && childPlayer.victoryPoints === 0 && childPlayer.energy === 6 &&
      childPlayer.powerCards.length === 0 && currentId(child) === 'p1' && String(child.phase) === 'awaiting_roll',
    'It Has a Child must cancel pending effects from the Keep cards it discards',
  );

  const rayFallback = initKingOfTokyoGame('RAY-FALLBACK', players(2), seededRandom(65), 'p0');
  giveKeepCard(rayFallback, 'p0', 'healing_ray');
  rayFallback.players.get('p0')!.health = 8;
  rayFallback.players.get('p1')!.health = 1;
  rayFallback.players.get('p1')!.energy = 1;
  rayFallback.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(rayFallback, ['heart', 'smash', 1, 2, 3, 'energy']);
  prepareAndResolve(rayFallback, plan({
    resolutionOrder: ['smash', 'hearts', 'points', 'energy'],
  }));
  assert(
    rayFallback.players.get('p1')!.eliminated && rayFallback.players.get('p0')!.health === 9,
    'a Heart whose potential Ray target dies earlier must remain available for self-healing',
  );

  const absent = initKingOfTokyoGame('ABSENT', players(2), seededRandom(63), 'p0');
  accept(absent, 'absent actor rolls', () =>
    resolveAbsentDecision(absent, 'p0', absent.revision, seededRandom(64)));
  accept(absent, 'absent actor finalises dice', () =>
    resolveAbsentDecision(absent, 'p0', absent.revision, seededRandom(65)));
  if (String(absent.phase) === 'awaiting_psychic_probe') {
    const responder = absent.pendingPsychicProbes[0].playerId;
    accept(absent, 'absent Probe owner passes', () =>
      resolveAbsentDecision(absent, responder, absent.revision, seededRandom(66)));
  }
  assert(String(absent.phase) === 'awaiting_dice_resolution', 'absence must reach dice-resolution choice');
  accept(absent, 'absent actor resolves dice', () =>
    resolveAbsentDecision(absent, 'p0', absent.revision, seededRandom(67)));
  while (String(absent.phase) === 'awaiting_tokyo_decision') {
    const occupant = absent.pendingTokyoDecisions[0];
    accept(absent, 'absent Tokyo occupant stays', () =>
      resolveAbsentDecision(absent, occupant, absent.revision, seededRandom(68)));
  }
  assert(String(absent.phase) === 'buying_cards', 'absence recovery must reach the buy step');
  accept(absent, 'absent actor ends buy step', () =>
    resolveAbsentDecision(absent, 'p0', absent.revision, seededRandom(69)));
  assert(currentId(absent) === 'p1' && String(absent.phase) === 'awaiting_roll', 'absence recovery must advance turn');

  const forfeiture = initKingOfTokyoGame('FORFEIT', players(3), seededRandom(70), 'p0');
  giveKeepCard(forfeiture, 'p1', 'wings');
  forfeiture.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(forfeiture, ['smash', 1, 2, 3, 'energy', 'heart']);
  prepareAndResolve(forfeiture);
  assert(String(forfeiture.phase) === 'awaiting_tokyo_decision', 'forfeit fixture must await occupant');
  accept(forfeiture, 'pending Tokyo occupant forfeits', () =>
    forfeitPlayer(forfeiture, 'p1', forfeiture.revision, seededRandom(71)));
  assert(
    !forfeiture.pendingTokyoDecisions.includes('p1') && !forfeiture.pendingTokyoDamage.has('p1') &&
      forfeiture.players.get('p1')!.powerCards.length === 0,
    'forfeit must remove every pending reference and discard owned powers',
  );
}

function invalidInputScenarios(): void {
  const state = initKingOfTokyoGame('INVALID', players(3), seededRandom(72), 'p0');
  rejectUnchanged(state, 'stale roll revision', () =>
    rollDice(state, 'p0', seededRandom(73), state.revision + 1));
  rejectUnchanged(state, 'unknown actor', () =>
    rollDice(state, 'intruder', seededRandom(74), state.revision));
  rejectUnchanged(state, 'invalid revision type', () =>
    rollDice(state, 'p0', seededRandom(75), Number.NaN));
  accept(state, 'valid roll before adversarial dice inputs', () =>
    rollDice(state, 'p0', seededRandom(76), state.revision));
  rejectUnchanged(state, 'duplicate kept indexes', () =>
    setKeptDice(state, 'p0', [0, 0], state.revision));
  rejectUnchanged(state, 'out-of-range kept index', () =>
    setKeptDice(state, 'p0', [state.dice.length], state.revision));
  rejectUnchanged(state, 'non-array kept indexes', () =>
    setKeptDice(state, 'p0', null as never, state.revision));
  accept(state, 'prepare adversarial resolution', () =>
    prepareDiceResolution(state, 'p0', state.revision));
  while (String(state.phase) === 'awaiting_psychic_probe') {
    const responder = state.pendingPsychicProbes[0].playerId;
    accept(state, 'pass adversarial Probe window', () =>
      decidePsychicProbe(state, responder, null, seededRandom(77), state.revision));
  }
  rejectUnchanged(state, 'duplicate resolution category', () =>
    resolveDiceResults(state, 'p0', plan({
      resolutionOrder: ['points', 'points', 'hearts', 'smash'],
    }), state.revision));
  rejectUnchanged(state, 'extraneous resolution field', () =>
    resolveDiceResults(state, 'p0', {
      ...plan(),
      staleTargetPlayerId: 'p1',
    } as KingOfTokyoDiceResolutionPlan, state.revision));
  const duplicateRay = initKingOfTokyoGame('DUPLICATE-RAY', players(2), seededRandom(78), 'p0');
  giveKeepCard(duplicateRay, 'p0', 'healing_ray');
  duplicateRay.players.get('p1')!.health = 9;
  duplicateRay.players.get('p0')!.poisonTokens = 1;
  duplicateRay.players.get('p0')!.shrinkTokens = 1;
  setFaces(duplicateRay, ['heart', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(duplicateRay);
  rejectUnchanged(duplicateRay, 'fractional Heart token count', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({ poisonTokensToRemove: 0.5 }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'duplicate Healing Ray die assignment', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [
        { dieIndex: 0, targetPlayerId: 'p1' },
        { dieIndex: 0, targetPlayerId: 'p1' },
      ],
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'non-Heart Healing Ray die assignment', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 2, targetPlayerId: 'p1' }],
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'unknown Healing Ray target', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'missing' }],
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'self Healing Ray target', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p0' }],
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'Healing Ray exceeds missing target health', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [
        { dieIndex: 0, targetPlayerId: 'p1' },
        { dieIndex: 1, targetPlayerId: 'p1' },
      ],
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'Heart allocation exceeds remaining Hearts', () =>
    decideHeartAllocation(duplicateRay, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
      poisonTokensToRemove: 1,
      shrinkTokensToRemove: 1,
    }), duplicateRay.revision));
  rejectUnchanged(duplicateRay, 'extraneous Heart allocation field', () =>
    decideHeartAllocation(duplicateRay, 'p0', {
      ...heartAllocation(),
      stale: true,
    } as KingOfTokyoHeartAllocation, duplicateRay.revision));
  allocateHearts(duplicateRay, heartAllocation(), 'finish adversarial Heart allocation');

  const noRay = initKingOfTokyoGame('NO-RAY', players(2), seededRandom(781), 'p0');
  noRay.players.get('p0')!.poisonTokens = 1;
  noRay.players.get('p1')!.health = 9;
  setFaces(noRay, ['heart', 1, 2, 3, 'energy', 1]);
  prepareAndResolve(noRay);
  rejectUnchanged(noRay, 'Healing Ray allocation without entitlement', () =>
    decideHeartAllocation(noRay, 'p0', heartAllocation({
      healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }],
    }), noRay.revision));
  allocateHearts(noRay, heartAllocation({ poisonTokensToRemove: 1 }), 'finish no-Ray Heart allocation');

  const preferences = initKingOfTokyoGame('BAD-PREFS', players(2), seededRandom(79), 'p0');
  rejectUnchanged(preferences, 'empty preferences', () =>
    updatePreferences(preferences, 'p0', {}, preferences.revision));
  rejectUnchanged(preferences, 'extraneous preference field', () =>
    updatePreferences(preferences, 'p0', { target: 'p1' } as never, preferences.revision));
  rejectUnchanged(preferences, 'invalid defense preference', () =>
    updatePreferences(preferences, 'p0', { defenseMode: 'sometimes' } as never, preferences.revision));
  rejectUnchanged(preferences, 'undefined preference value', () =>
    updatePreferences(preferences, 'p0', { defenseMode: undefined }, preferences.revision));
  const changedPreferenceRevision = preferences.revision;
  const changedPreference = updatePreferences(
    preferences,
    'p0',
    { tokenPreference: 'shrink' },
    preferences.revision,
  );
  assert(
    changedPreference.ok && preferences.revision === changedPreferenceRevision + 1 &&
      preferences.players.get('p0')!.tokenPreference === 'shrink',
    'a private preference change must version the viewer-specific projection',
  );
  const unchangedPreferenceRevision = preferences.revision;
  const unchangedPreference = updatePreferences(
    preferences,
    'p0',
    { tokenPreference: 'shrink' },
    preferences.revision,
  );
  assert(unchangedPreference.ok && preferences.revision === unchangedPreferenceRevision,
    'an identical preference retry must be an idempotent no-op without a revision bump');

  const invalidYield = initKingOfTokyoGame('BAD-YIELD', players(2), seededRandom(80), 'p0');
  invalidYield.phase = 'awaiting_tokyo_decision';
  invalidYield.pendingTokyoDecisions = ['p1'];
  rejectUnchanged(invalidYield, 'non-boolean Tokyo decision', () =>
    decideTokyoYield(invalidYield, 'p1', 'yes' as never, invalidYield.revision));

  const invalidOpportunity = initKingOfTokyoGame('BAD-OPPORTUNITY', players(2), seededRandom(81), 'p0');
  invalidOpportunity.phase = 'awaiting_opportunist';
  invalidOpportunity.pendingOpportunist = {
    cardInstanceId: invalidOpportunity.market[0]!.instanceId,
    playerIds: ['p1'],
  };
  rejectUnchanged(invalidOpportunity, 'non-boolean Opportunist decision', () =>
    decideOpportunist(invalidOpportunity, 'p1', 'buy' as never, invalidOpportunity.revision));

  const options = initKingOfTokyoGame('BAD-OPTIONS', players(2), seededRandom(82), 'p0');
  const background = giveKeepCard(options, 'p0', 'background_dweller');
  setFaces(options, [3, 1, 2, 'energy', 'heart', 'smash']);
  rejectUnchanged(options, 'Power-card extraneous option', () =>
    usePowerCard(options, 'p0', background.instanceId, {
      dieIndex: 0,
      targetPlayerId: 'p1',
    }, options.revision, seededRandom(81)));
}

function desiredKeeps(state: KingOfTokyoServerState): number[] {
  const actor = state.players.get(currentId(state))!;
  const numberCounts = new Map<1 | 2 | 3, number>([
    [1, state.dice.filter((die) => die.face === 1).length],
    [2, state.dice.filter((die) => die.face === 2).length],
    [3, state.dice.filter((die) => die.face === 3).length],
  ]);
  const numberFaces: (1 | 2 | 3)[] = [1, 2, 3];
  const preferredNumber = numberFaces
    .sort((left, right) => numberCounts.get(right)! - numberCounts.get(left)! || right - left)[0];
  return state.dice.flatMap((die, index) => {
    if (die.face === 'smash' || die.face === 'energy') return [index];
    if (die.face === 'heart' && !actor.tokyoZone && actor.health < actor.maxHealth) return [index];
    if (die.face === preferredNumber && numberCounts.get(preferredNumber)! >= 2) return [index];
    return [];
  });
}

function shuffledResolutionOrder(rng: RandomSource): KingOfTokyoDiceResolutionCategory[] {
  const categories: KingOfTokyoDiceResolutionCategory[] = ['points', 'energy', 'hearts', 'smash'];
  for (let index = categories.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [categories[index], categories[swap]] = [categories[swap], categories[index]];
  }
  return categories;
}

function simulationPlan(state: KingOfTokyoServerState, rng: RandomSource): KingOfTokyoDiceResolutionPlan {
  return plan({
    resolutionOrder: shuffledResolutionOrder(rng),
  });
}

function simulationHeartAllocation(state: KingOfTokyoServerState, rng: RandomSource): KingOfTokyoHeartAllocation {
  const pending = state.pendingHeartAllocation!;
  const actor = state.players.get(pending.playerId)!;
  let availableIndexes = [...pending.heartIndexes];
  const healingRayUses: KingOfTokyoHeartAllocation['healingRayUses'] = [];
  if (pending.healingRayAvailable && availableIndexes.length) {
    for (const targetId of state.turnOrder) {
      if (!availableIndexes.length) break;
      const target = state.players.get(targetId)!;
      if (targetId === actor.playerId || target.eliminated || target.health >= target.maxHealth) continue;
      const allocations = Math.min(
        target.maxHealth - target.health,
        availableIndexes.length,
        rng() < 0.4 ? availableIndexes.length : 0,
      );
      for (let index = 0; index < allocations; index += 1) {
        healingRayUses.push({ dieIndex: availableIndexes.shift()!, targetPlayerId: targetId });
      }
    }
  }
  let poisonTokensToRemove = 0;
  let shrinkTokensToRemove = 0;
  if (!actor.tokyoZone) {
    poisonTokensToRemove = Math.min(actor.poisonTokens, availableIndexes.length);
    availableIndexes = availableIndexes.slice(poisonTokensToRemove);
    shrinkTokensToRemove = Math.min(actor.shrinkTokens, availableIndexes.length);
  }
  return { healingRayUses, poisonTokensToRemove, shrinkTokensToRemove };
}

function resolvePendingInitialMimic(state: KingOfTokyoServerState, rng: RandomSource): boolean {
  const key = [...state.usedThisTurn].find((candidate) => candidate.startsWith('mimic_initial:'));
  if (!key) return false;
  const instanceId = key.slice('mimic_initial:'.length);
  const ownerId = state.turnOrder.find((playerId) =>
    state.players.get(playerId)!.powerCards.some((card) => card.instanceId === instanceId));
  assert(Boolean(ownerId), 'pending initial Mimic must have a living owner');
  const target = state.turnOrder
    .filter((id) => !state.players.get(id)!.eliminated)
    .flatMap((id) => state.players.get(id)!.powerCards)
    .find((card) => card.cardId !== 'mimic');
  assert(Boolean(target), 'pending initial Mimic must have a legal Keep target');
  accept(state, 'simulation assigns initial Mimic', () =>
    usePowerCard(state, ownerId!, instanceId, {
      targetCardInstanceId: target!.instanceId,
    }, state.revision, rng));
  return true;
}

function simulationStep(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (resolvePendingInitialMimic(state, rng)) return;
  switch (state.phase) {
    case 'determining_first_player': {
      const roller = state.startingRollContenders.find((id) => state.startRolls.get(id) === null);
      assert(Boolean(roller), 'roll-off must expose a pending contender');
      accept(state, 'simulation roll-off', () =>
        rollForFirstPlayer(state, roller!, rng, state.revision, state.rollOffRound));
      return;
    }
    case 'awaiting_roll':
      accept(state, 'simulation roll', () => rollDice(state, currentId(state), rng, state.revision));
      return;
    case 'choosing_dice': {
      if (state.rollCount < state.maxRolls) {
        const keeps = desiredKeeps(state);
        const existing = state.dice.flatMap((die, index) => die.kept ? [index] : []);
        const allKept = keeps.length === state.dice.length;
        if (!allKept && keeps.join(',') !== existing.join(',')) {
          accept(state, 'simulation selects keeps', () =>
            setKeptDice(state, currentId(state), keeps, state.revision));
          return;
        }
        if (!allKept) {
          accept(state, 'simulation reroll', () => rollDice(state, currentId(state), rng, state.revision));
          return;
        }
      }
      accept(state, 'simulation prepares results', () =>
        prepareDiceResolution(state, currentId(state), state.revision));
      return;
    }
    case 'awaiting_psychic_probe':
      accept(state, 'simulation passes Probe', () =>
        decidePsychicProbe(state, state.pendingPsychicProbes[0].playerId, null, rng, state.revision));
      return;
    case 'awaiting_dice_resolution':
      accept(state, 'simulation resolves results', () =>
        resolveDiceResults(state, currentId(state), simulationPlan(state, rng), state.revision, rng));
      return;
    case 'awaiting_heart_allocation':
      accept(state, 'simulation allocates Hearts', () =>
        decideHeartAllocation(
          state,
          state.pendingHeartAllocation!.playerId,
          simulationHeartAllocation(state, rng),
          state.revision,
          rng,
        ));
      return;
    case 'awaiting_defense_decision': {
      const pending = state.pendingDefenseDecision!;
      const decision = pending.kind === 'camouflage'
        ? { kind: 'camouflage' as const, changes: [] }
        : pending.kind === 'wings'
          ? { kind: 'wings' as const, use: rng() < 0.5 }
          : { kind: 'rapid_healing' as const, activations: 0 };
      accept(state, 'simulation resolves defence', () =>
        decideDefense(state, pending.playerId, decision, state.revision, rng));
      return;
    }
    case 'awaiting_freeze_time':
      accept(state, 'simulation decides Freeze Time', () =>
        decideFreezeTime(state, state.pendingFreezeTimeDecisions[0].playerId, rng() < 0.5, state.revision, rng));
      return;
    case 'awaiting_tokyo_decision': {
      const occupantId = state.pendingTokyoDecisions[0];
      const occupant = state.players.get(occupantId)!;
      const pending = state.pendingTokyoDamage.get(occupantId)?.amount ?? 0;
      const yieldTokyo = occupant.health <= pending + 2 || rng() < 0.25;
      accept(state, 'simulation Tokyo decision', () =>
        decideTokyoYield(state, occupantId, yieldTokyo, state.revision, rng));
      return;
    }
    case 'awaiting_death_from_above': {
      const pending = state.pendingDeathFromAbove!;
      accept(state, 'simulation Death from Above choice', () =>
        chooseDeathFromAboveTarget(state, pending.playerId, pending.targetPlayerIds[0], state.revision, rng));
      return;
    }
    case 'awaiting_opportunist':
      accept(state, 'simulation passes Opportunist', () =>
        decideOpportunist(state, state.pendingOpportunist!.playerIds[0], false, state.revision, rng));
      return;
    case 'buying_cards': {
      const actor = state.players.get(currentId(state))!;
      const affordable = state.market
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => card && KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost <= actor.energy);
      if (state.purchasesThisTurn === 0 && affordable.length && rng() < 0.35) {
        const choice = affordable[Math.floor(rng() * affordable.length)];
        accept(state, 'simulation market purchase', () =>
          buyPowerCard(state, actor.playerId, choice.index, state.revision, rng));
      } else {
        accept(state, 'simulation end turn', () =>
          endTurn(state, actor.playerId, state.revision, rng));
      }
      return;
    }
    case 'selling_cards':
      accept(state, 'simulation ends sale step', () =>
        endTurn(state, currentId(state), state.revision, rng));
      return;
    case 'resolving_end_turn':
      accept(state, 'simulation resolves end effect', () =>
        resolveEndTurnEffect(
          state,
          currentId(state),
          state.pendingEndTurnEffects[0].effectId,
          state.revision,
          rng,
        ));
      return;
    case 'game_over':
      return;
  }
}

function simulateGame(playerCount: number, seed: number): KingOfTokyoServerState {
  const rng = seededRandom(seed);
  const state = initKingOfTokyoGame(`SIM-${playerCount}-${seed}`, players(playerCount), rng);
  const mutationLimit = 5_000;
  let mutations = 0;
  while (state.status === 'playing' && mutations < mutationLimit) {
    try { simulationStep(state, rng); }
    catch (error) {
      throw new Error(`${state.roomCode} mutation ${mutations}, phase ${state.phase}, actor ${currentId(state)}: ${String(error)}; Burrowing ${JSON.stringify(state.pendingBurrowingYields)}; Tokyo ${JSON.stringify([...state.pendingTokyoDamage])}; chooser ${state.pendingTokyoDecisions.join(',')}; workflow ${JSON.stringify(state.pendingSmashResolution)}`, { cause: error });
    }
    mutations += 1;
  }
  assert(state.status === 'game_over', `${playerCount}-player game ${seed} must terminate within ${mutationLimit} mutations`);
  assert(
    state.victoryType === 'mutual_destruction'
      ? state.winnerId === null
      : Boolean(state.winnerId && !state.players.get(state.winnerId)!.eliminated),
    'winner and victory type must agree',
  );
  validateKingOfTokyoState(state);
  return state;
}

function currentRegenerationScenarios(): void {
  for (const cardId of ['heal', 'nuclear_power_plant'] as const) {
    for (const health of [5, 9, 10]) {
      const state = initKingOfTokyoGame('REGEN-CARD', players(3), seededRandom(8850), 'p0');
      giveKeepCard(state, 'p0', 'regeneration');
      state.players.get('p0')!.health = health;
      state.players.get('p0')!.energy = 20;
      state.phase = 'buying_cards';
      exposeCard(state, cardId);
      accept(state, `${cardId} with Regeneration at ${health} health`, () =>
        buyPowerCard(state, 'p0', 0, state.revision, seededRandom(8851)));
      assert(state.players.get('p0')!.health === Math.min(10, health + (cardId === 'heal' ? 3 : 4)),
        'each positive card-healing event receives one capped Regeneration bonus');
    }
  }
  const ray = initKingOfTokyoGame('REGEN-RAY', players(3), seededRandom(8852), 'p0');
  giveKeepCard(ray, 'p0', 'healing_ray');
  giveKeepCard(ray, 'p1', 'regeneration');
  ray.players.get('p1')!.health = 5;
  ray.players.get('p1')!.energy = 8;
  setFaces(ray, ['heart', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(ray);
  allocateHearts(ray, heartAllocation({ healingRayUses: [
    { dieIndex: 0, targetPlayerId: 'p1' }, { dieIndex: 1, targetPlayerId: 'p1' },
  ] }));
  assert(ray.players.get('p1')!.health === 8 && ray.players.get('p1')!.energy === 4,
    'Healing Ray groups two dice into one recipient healing event and charges only for assigned dice');

  const rapid = initKingOfTokyoGame('REGEN-RAPID', players(3), seededRandom(8853), 'p0');
  giveKeepCard(rapid, 'p1', 'regeneration');
  giveKeepCard(rapid, 'p1', 'rapid_healing');
  rapid.players.get('p1')!.health = 1;
  rapid.players.get('p1')!.energy = 4;
  rapid.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(rapid, ['smash', 'smash', 'smash', 1, 2, 3]);
  prepareAndResolve(rapid);
  accept(rapid, 'two separate Rapid Healing activations before damage', () =>
    decideDefense(rapid, 'p1', { kind: 'rapid_healing', activations: 2 }, rapid.revision));
  assert(rapid.players.get('p1')!.health === 2 && rapid.players.get('p1')!.energy === 0 && !rapid.players.get('p1')!.eliminated,
    'each paid Rapid Healing activation receives its own bonus before incoming damage');

  const copied = initKingOfTokyoGame('REGEN-MIMIC', players(3), seededRandom(8854), 'p0');
  const regen = giveKeepCard(copied, 'p1', 'regeneration');
  giveKeepCard(copied, 'p0', 'mimic').mimicTargetInstanceId = regen.instanceId;
  const rapidCard = giveKeepCard(copied, 'p0', 'rapid_healing');
  copied.players.get('p0')!.health = 7;
  copied.players.get('p0')!.energy = 8;
  for (const expected of [9, 10]) {
    accept(copied, 'standalone Rapid Healing with copied Regeneration', () =>
      usePowerCard(copied, 'p0', rapidCard.instanceId, {}, copied.revision));
    assert(copied.players.get('p0')!.health === expected, 'copied Regeneration applies and obeys maximum health');
  }
  rejectUnchanged(copied, 'full-health Rapid Healing cannot trigger Regeneration', () =>
    usePowerCard(copied, 'p0', rapidCard.instanceId, {}, copied.revision));

  const noHealing = initKingOfTokyoGame('REGEN-NO-HEALING', players(3), seededRandom(8855), 'p0');
  giveKeepCard(noHealing, 'p0', 'regeneration');
  noHealing.players.get('p0')!.health = 5;
  noHealing.players.get('p0')!.poisonTokens = 1;
  setFaces(noHealing, ['heart', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(noHealing);
  allocateHearts(noHealing, heartAllocation({ poisonTokensToRemove: 1 }));
  assert(noHealing.players.get('p0')!.health === 5, 'token removal is not healing and cannot trigger Regeneration');
  setFaces(noHealing, ['heart', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(noHealing);
  assert(noHealing.players.get('p0')!.health === 5,
    'rolled Hearts cannot trigger Regeneration while the actor is in Tokyo');

  const healer = initKingOfTokyoGame('REGEN-HEALER-ONLY', players(3), seededRandom(8856), 'p0');
  giveKeepCard(healer, 'p0', 'healing_ray');
  giveKeepCard(healer, 'p0', 'regeneration');
  healer.players.get('p1')!.health = 5;
  setFaces(healer, ['heart', 1, 2, 3, 'energy', 'energy']);
  prepareAndResolve(healer);
  allocateHearts(healer, heartAllocation({ healingRayUses: [{ dieIndex: 0, targetPlayerId: 'p1' }] }));
  assert(healer.players.get('p1')!.health === 6,
    'the healer owning Regeneration does not boost another monster without that power');

  const stacked = initKingOfTokyoGame('REGEN-STACKED', players(3), seededRandom(8857), 'p0');
  const ownRegen = giveKeepCard(stacked, 'p0', 'regeneration');
  giveKeepCard(stacked, 'p0', 'mimic').mimicTargetInstanceId = ownRegen.instanceId;
  stacked.players.get('p0')!.health = 5;
  stacked.players.get('p0')!.energy = 20;
  stacked.phase = 'buying_cards';
  exposeCard(stacked, 'heal');
  accept(stacked, 'physical and copied Regeneration stack on Heal', () =>
    buyPowerCard(stacked, 'p0', 0, stacked.revision, seededRandom(8858)));
  assert(stacked.players.get('p0')!.health === 9, 'each effective Regeneration copy adds one health to the event');

  const changing = initKingOfTokyoGame('REGEN-PENDING-SOURCE-LEAVES', players(3), seededRandom(8859), 'p0');
  const remoteRegen = giveKeepCard(changing, 'p2', 'regeneration');
  giveKeepCard(changing, 'p1', 'mimic').mimicTargetInstanceId = remoteRegen.instanceId;
  giveKeepCard(changing, 'p1', 'rapid_healing');
  changing.players.get('p1')!.health = 7;
  changing.players.get('p1')!.energy = 8;
  changing.players.get('p1')!.tokyoZone = 'tokyo_city';
  setFaces(changing, ['smash', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(changing);
  const beforeSourceLeaves = toKingOfTokyoPublicState(changing, 'p1').pendingDefenseDecision!;
  assert(beforeSourceLeaves.healingPerActivation === 2 && beforeSourceLeaves.maxActivations === 2,
    'Rapid Healing projection caps activations by actual healing per activation');
  accept(changing, 'copied Regeneration source leaves during Rapid Healing choice', () =>
    forfeitPlayer(changing, 'p2', changing.revision));
  const afterSourceLeaves = toKingOfTokyoPublicState(changing, 'p1').pendingDefenseDecision!;
  assert(afterSourceLeaves.healingPerActivation === 1 && afterSourceLeaves.maxActivations === 3,
    'pending Rapid Healing preview recomputes current Regeneration rather than using stale captured ownership');
  accept(changing, 'Rapid Healing uses current copied-power topology', () =>
    decideDefense(changing, 'p1', { kind: 'rapid_healing', activations: 1 }, changing.revision));
  assert(changing.players.get('p1')!.health === 7,
    'lost Regeneration source no longer boosts the later healing activation');
}

function freshBatchAndIdentityScenarios(): void {
  const novaJets = initKingOfTokyoGame('NOVA-JETS-DEFENCE', players(3), seededRandom(8897), 'p0');
  giveKeepCard(novaJets, 'p0', 'nova_breath');
  giveKeepCard(novaJets, 'p1', 'jets');
  giveKeepCard(novaJets, 'p2', 'wings');
  novaJets.players.get('p1')!.tokyoZone = 'tokyo_city';
  novaJets.players.get('p2')!.energy = 2;
  novaJets.players.get('p2')!.defenseMode = 'always';
  setFaces(novaJets, ['smash', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(novaJets);
  assert(novaJets.pendingDefenseDecision?.playerId === 'p2' && novaJets.pendingTokyoDamage.has('p1'),
    'Nova may capture deferred Jets while another target still owns a defence decision');
  accept(novaJets, 'outside Nova target resolves Wings', () =>
    decideDefense(novaJets, 'p2', { kind: 'wings', use: false }, novaJets.revision));
  assert(toKingOfTokyoPublicState(novaJets, 'p1').hasDeferredSmashDamage,
    'deferred Jets projection must become visible when its Tokyo choice opens');
  accept(novaJets, 'Jets target yields after outside Nova defence', () =>
    decideTokyoYield(novaJets, 'p1', true, novaJets.revision));
  assert(novaJets.players.get('p1')!.health === 10 && novaJets.players.get('p2')!.health === 9,
    'Nova defence and deferred Jets each settle once');
  const orderedBurrowing = initKingOfTokyoGame('BURROWING-BEFORE-HEARTS', players(3), seededRandom(8898), 'p0');
  giveKeepCard(orderedBurrowing, 'p1', 'burrowing');
  orderedBurrowing.players.get('p1')!.tokyoZone = 'tokyo_city';
  orderedBurrowing.players.get('p0')!.poisonTokens = 1;
  setFaces(orderedBurrowing, ['smash', 'heart', 1, 2, 3, 'energy']);
  prepareAndResolve(orderedBurrowing, plan({ resolutionOrder: ['smash', 'hearts', 'energy', 'points'] }));
  accept(orderedBurrowing, 'Burrowing occupant yields before remaining Hearts', () =>
    decideTokyoYield(orderedBurrowing, 'p1', true, orderedBurrowing.revision));
  assert(orderedBurrowing.phase === 'awaiting_heart_allocation' && orderedBurrowing.pendingBurrowingYields.length === 1,
    'Burrowing retaliation waits through unresolved Hearts until actual Tokyo entry');
  allocateHearts(orderedBurrowing, heartAllocation({ poisonTokensToRemove: 1 }));
  assert(orderedBurrowing.players.get('p0')!.health === 9 && orderedBurrowing.players.get('p0')!.tokyoZone === 'tokyo_city' &&
    Number(orderedBurrowing.pendingBurrowingYields.length) === 0, 'entry resolves the pending Burrowing loss exactly once');
  const emptyLab = initKingOfTokyoGame('EMPTY-LAB', players(3), seededRandom(8900), 'p0');
  giveKeepCard(emptyLab, 'p0', 'made_in_a_lab');
  emptyLab.discardPile.push(...emptyLab.deck.splice(0));
  emptyLab.phase = 'buying_cards';
  emptyLab.labOffersRemaining = 1;
  rejectUnchanged(emptyLab, 'unseen exhausted Lab purchase', () =>
    buyLabCard(emptyLab, 'p0', emptyLab.revision, seededRandom(8901)));
  setFaces(emptyLab, [1, 2, 3, 'energy', 'energy', 'heart']);
  prepareAndResolve(emptyLab);
  const inspectedLab = toKingOfTokyoPublicState(emptyLab, 'p0').labCard;
  assert(Boolean(inspectedLab) && emptyLab.discardPile.length === 0,
    'entering Buy must prepare an exhausted Lab deck before projecting its inspected offer');
  assert(toKingOfTokyoPublicState(emptyLab, 'p1').labCard === null &&
    toKingOfTokyoPublicState(emptyLab).labCard === null,
    'only the current Lab owner can inspect the recycled deck top');
  emptyLab.players.get('p0')!.energy = 0;
  rejectUnchanged(emptyLab, 'visible unaffordable Lab purchase', () =>
    buyLabCard(emptyLab, 'p0', emptyLab.revision, seededRandom(8902)));

  const insideDfa = initKingOfTokyoGame('DFA-INSIDE-BAY', players(5), seededRandom(8903), 'p0');
  insideDfa.players.get('p0')!.tokyoZone = 'tokyo_bay';
  insideDfa.players.get('p1')!.tokyoZone = 'tokyo_city';
  insideDfa.players.get('p0')!.energy = 10;
  insideDfa.phase = 'buying_cards';
  exposeCard(insideDfa, 'drop_from_high_altitude');
  accept(insideDfa, 'inside buyer clears the other Tokyo occupant', () =>
    buyPowerCard(insideDfa, 'p0', 0, insideDfa.revision, seededRandom(8904)));
  assert(insideDfa.players.get('p0')!.tokyoZone === 'tokyo_bay' &&
    insideDfa.players.get('p0')!.victoryPoints === 2 && insideDfa.players.get('p1')!.tokyoZone === null,
    'DFA leaves its already-inside buyer in place and only other occupants yield');

  for (let count = 2; count <= 6; count += 1) {
    for (const phase of ['determining_first_player', 'awaiting_roll', 'buying_cards'] as const) {
      for (let mask = 1; mask < 2 ** count; mask += 1) {
        const state = initKingOfTokyoGame('BATCH', players(count), seededRandom(9000 + mask),
          phase === 'determining_first_player' ? undefined : 'p0');
        state.phase = phase;
        giveKeepCard(state, 'p0', 'it_has_a_child');
        const departing = state.turnOrder.filter((_, index) => mask & (1 << index));
        accept(state, `${count}p ${phase} batch ${mask}`, () =>
          forfeitPlayers(state, [...departing, departing[0]], state.revision));
        const survivors = state.turnOrder.filter((id) => !departing.includes(id));
        for (const id of departing) {
          const player = state.players.get(id)!;
          assert(player.forfeited && player.eliminated && player.health === 0 && player.powerCards.length === 0,
            'every batch member must forfeit once without Child resurrection');
        }
        if (survivors.length <= 1) {
          assert(state.status === 'game_over' && state.winnerId === (survivors[0] ?? null),
            'batch settlement cannot crown a departing player');
          assert(state.terminationReason === (survivors.length ? null : 'no_players_remaining'),
            'all-forfeit abandonment must be distinct from natural mutual destruction');
        } else {
          const before = snapshot(state);
          assert(forfeitPlayers(state, departing, state.revision).ok && snapshot(state) === before,
            'repeated forfeiture must be idempotent');
          rejectUnchanged(state, 'unknown batch member rejects complete batch', () =>
            forfeitPlayers(state, [survivors[0], 'unknown'], state.revision));
        }
        for (const id of state.turnOrder) {
          const view = toKingOfTokyoPublicState(state, id);
          assert(view.viewerPlayerId === id && view.roomCode === 'BATCH' && view.revision === state.revision,
            'single projection binds viewer, room and revision');
          assert(view.players.every((player) => !('defenseMode' in player) && !('tokenPreference' in player)),
            'other players cannot expose private preferences');
        }
      }
    }
  }
  const rematch = initKingOfTokyoGame('FLOOR', players(3), seededRandom(999));
  rematch.startingRevision = rematch.revision = 80;
  rejectUnchanged(rematch, 'old-match concurrent first roll', () =>
    rollForFirstPlayer(rematch, 'p0', () => 0, 0, 1));
  accept(rematch, 'first roll at rematch floor', () => rollForFirstPlayer(rematch, 'p0', () => 0, 80, 1));
  accept(rematch, 'concurrent same-match first roll', () => rollForFirstPlayer(rematch, 'p1', () => 0, 80, 1));

  for (const survivorHealth of [1, 10]) {
    const state = initKingOfTokyoGame('COMMITTED-BATCH', players(3), seededRandom(901), 'p0');
    giveKeepCard(state, 'p0', 'fire_breathing');
    giveKeepCard(state, 'p1', 'camouflage');
    giveKeepCard(state, 'p1', 'stretchy');
    giveKeepCard(state, 'p0', 'it_has_a_child');
    state.players.get('p1')!.energy = 2;
    state.players.get('p2')!.health = survivorHealth;
    setFaces(state, ['smash', 1, 2, 3, 'energy', 'heart']);
    prepareAndResolve(state, plan(), () => 0);
    assert(state.pendingDefenseDecision?.playerId === 'p1', 'canonical Fire packet must pause at first defender');
    accept(state, 'actor and pending defender depart together', () =>
      forfeitPlayers(state, ['p0', 'p1'], state.revision, () => 0));
    assert(state.players.get('p2')!.health === survivorHealth - 1,
      'sole remaining body must still receive committed neighbour damage');
    assert(state.status === 'game_over' && state.winnerId === (survivorHealth === 1 ? null : 'p2') &&
      state.terminationReason === null &&
      state.victoryType === (survivorHealth === 1 ? 'mutual_destruction' : 'last_monster_standing'),
      'committed lethal damage after departures is natural mutual destruction, not abandonment');
  }

  for (const health of [2, 8]) {
    const state = initKingOfTokyoGame('BATCH-BIGGER', players(3), seededRandom(902), 'p0');
    const bigger = giveKeepCard(state, 'p1', 'even_bigger');
    const mimic = giveKeepCard(state, 'p2', 'mimic');
    mimic.mimicTargetInstanceId = bigger.instanceId;
    state.players.get('p2')!.maxHealth = 12;
    state.players.get('p2')!.health = health;
    accept(state, 'actor and copied Even Bigger source depart', () =>
      forfeitPlayers(state, ['p0', 'p1'], state.revision, () => 0));
    assert(state.players.get('p2')!.health === health && state.players.get('p2')!.maxHealth === 10,
      'copied maximum loss must not damage the surviving body');
    assert(state.status === 'game_over' && state.winnerId === 'p2',
      'a living final survivor wins after copied maximum reconciliation');
  }
}

function main(): void {
  logGrammarScenarios();
  setupAndDiceScenarios();
  resolutionOrderAndPrivacyScenarios();
  heartAllocationTimingScenarios();
  tokyoAndDefenseScenarios();
  powerCardScenarios();
  committedForfeitScenarios();
  victoryAndRecoveryScenarios();
  invalidInputScenarios();
  freshBatchAndIdentityScenarios();
  currentRegenerationScenarios();

  const gamesPerPlayerCount = Number(process.env.KOT_GAMES_PER_COUNT ?? 250);
  const seedOffset = Number(process.env.KOT_SEED_OFFSET ?? 0);
  const results: string[] = [];
  for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
    if (process.env.KOT_ONLY_PLAYER_COUNT && playerCount !== Number(process.env.KOT_ONLY_PLAYER_COUNT)) continue;
    const victoryTypes = new Map<string, number>();
    for (let game = 0; game < gamesPerPlayerCount; game += 1) {
      const state = simulateGame(playerCount, seedOffset + playerCount * 100_000 + game + 1);
      const key = state.victoryType!;
      victoryTypes.set(key, (victoryTypes.get(key) ?? 0) + 1);
    }
    results.push(
      `${playerCount}p=${gamesPerPlayerCount} (${[...victoryTypes]
        .map(([type, count]) => `${type}:${count}`)
        .join(', ')})`,
    );
  }
  console.log(`King of Tokyo simulation passed: ${results.join('; ')}; ${assertions.toLocaleString()} assertions.`);
}

main();
