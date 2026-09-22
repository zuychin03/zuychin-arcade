/**
 * Engine smoke test: plays full 3-round games with random legal moves for
 * every player count (3–10) and asserts core invariants. Run with:
 *   pnpm --filter @zuychin-arcade/server simulate:saboteur
 */
import type { ActionCard, BoardPosition, GameCard, PathCard, Tool } from '@zuychin-arcade/types';
import { ROLE_TABLE, SABOTEUR_PLAYABLE_BOUNDS, getHandSize } from '@zuychin-arcade/types';
import {
  advanceRound,
  chooseGold,
  forfeitSaboteurPlayers,
  initGame,
  isGoldDistributionComplete,
  passTurn,
  placeCard,
  playAction,
  type SaboteurServerState,
} from '../../src/game/saboteur/engine.js';
import { boardMap, isGoalReached, orientReachedGoal, rotateEdges, traversableSet, validatePlacement } from '../../src/game/saboteur/boardValidator.js';
import { buildActionDeck, buildFullDeck, buildGoldDeck, buildPathDeck, makeGoalCard } from '../../src/game/saboteur/deck.js';
import { applySaboteurRewards } from '../../src/game/saboteur/goldDistribution.js';
import { toPrivateState, toPublicState } from '../../src/game/saboteur/publicState.js';
import { validPlacements } from '../../../mobile/lib/placement.js';

let assertions = 0;
function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const TEST_PLAYERS = Array.from({ length: 3 }, (_, i) => ({
  playerId: `p${i}`,
  displayName: `Player${i}`,
}));

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
}

function canonicalScenario(): SaboteurServerState {
  const state = initGame('CANONICAL', TEST_PLAYERS);
  state.deck = buildFullDeck();
  for (const player of state.players.values()) player.hand = [];
  return state;
}

function takeCard(state: SaboteurServerState, predicate: (card: GameCard) => boolean): GameCard {
  const index = state.deck.findIndex(predicate);
  assert(index >= 0, 'fixture card exists in the canonical deck');
  return state.deck.splice(index, 1)[0];
}

function dealAction(state: SaboteurServerState, subtype: ActionCard['subtype'], playerId = 'p0'): ActionCard {
  const card = takeCard(state, (candidate) => candidate.type === 'action' && candidate.subtype === subtype) as ActionCard;
  state.players.get(playerId)!.hand.push(card);
  state.currentTurnIndex = state.turnOrder.indexOf(playerId);
  return card;
}

function addTunnel(state: SaboteurServerState, position: BoardPosition, predicate: (card: PathCard) => boolean): PathCard {
  const card = takeCard(state, (candidate) => candidate.type === 'path' && predicate(candidate)) as PathCard;
  state.board.push({ card, position, placedBy: 'p0' });
  return card;
}

function straightToGoal(state: SaboteurServerState): PathCard {
  for (let row = 1; row <= 6; row++) {
    addTunnel(state, { row, col: 4 }, (card) => card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open');
  }
  const last = takeCard(state, (card) => card.type === 'path' && card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open') as PathCard;
  state.players.get('p0')!.hand.push(last);
  return last;
}

function assertStateInvariants(state: SaboteurServerState): void {
  const players = [...state.players.values()];
  const cards = [...state.deck, ...state.discard, ...players.flatMap((player) => player.hand), ...state.board.filter((placed) => placed.card.subtype === 'tunnel').map((placed) => placed.card)];
  assert(cards.length === 67 && new Set(cards.map((card) => card.id)).size === 67, 'all 67 canonical cards remain in exactly one zone');
  assert(cards.filter((card) => card.type === 'path').length === 40, 'all 40 tunnel cards are conserved');
  assert(cards.filter((card) => card.type === 'action').length === 27, 'all 27 action cards are conserved');
  assert(new Set(state.board.map((placed) => `${placed.position.row},${placed.position.col}`)).size === state.board.length, 'board positions are unique');
  assert(state.board.every(({ position: { row, col } }) => row >= 0 && row <= 8 && col >= 2 && col <= 6), 'every board card stays within the authorised 5x9 cap');
  assert(state.board.filter((placed) => placed.card.subtype === 'start').length === 1, 'exactly one start card survives');
  assert(state.goals.filter((goal) => goal.isGold).length === 1, 'exactly one gold goal survives');
  const outstandingGold = state.goldDistribution?.availableCards.reduce((sum, card) => sum + card, 0) ?? 0;
  assert(state.goldDeck.reduce((sum, card) => sum + card, 0) + outstandingGold + players.reduce((sum, player) => sum + player.goldCollected, 0) === 44, 'all 44 gold nuggets are conserved');
  assert(players.every((player) => new Set(player.brokenTools).size === player.brokenTools.length), 'broken tools never stack');
  assert(Number.isSafeInteger(state.revision) && state.revision > 0, 'revision remains a positive safe integer');
  const pub = toPublicState(state);
  assert(pub.revision === state.revision, 'public revision matches authoritative state');
  assert(!('deck' in pub) && !('goldDeck' in pub) && !('discard' in pub), 'public projection hides card piles');
  assert(pub.players.every((player) => !('hand' in player) && !('role' in player) && !('peekedGoals' in player)), 'public players expose no hand, role or peeks');
  assert(pub.goldDistribution === null || !('availableCards' in pub.goldDistribution), 'public draft hides values');
  assert(pub.goals.every((goal) => goal.revealed || goal.isGold === null), 'face-down goals hide contents');
  assert(pub.players.every((player) => state.status === 'game_over' || player.goldCollected === null), 'running gold totals remain private');
  if (state.status === 'playing') {
    assert(pub.revealedRoles === null, 'live round hides roles');
    assert(state.players.get(state.turnOrder[state.currentTurnIndex])!.hand.length > 0, 'turn points to a player who can act');
  }
  for (const player of players) {
    const priv = toPrivateState(state, player.playerId)!;
    assert(priv.revision === pub.revision && priv.playerId === player.playerId, 'private projection is paired with its owner and revision');
    const isPicker = state.status === 'round_end' && state.goldDistribution?.order[state.goldDistribution.currentIndex] === player.playerId;
    assert(isPicker ? JSON.stringify(priv.availableGoldCards) === JSON.stringify(state.goldDistribution!.availableCards) : priv.availableGoldCards === null, 'only the current picker receives available gold values');
  }
}

function testCanonicalActionsAndTopology(): void {
  const paths = buildPathDeck();
  assert(paths.length === 40 && paths.filter((card) => card.isDeadEnd).length === 9, 'canonical tunnel manifest has 31 connecting and 9 dead-end cards');
  const shapeCount = (top: string, right: string, bottom: string, left: string) => paths.filter((card) => card.edges.center && card.edges.top === top && card.edges.right === right && card.edges.bottom === bottom && card.edges.left === left).length;
  assert(shapeCount('closed', 'closed', 'open', 'open') === 5, 'base deck contains five bottom-left connecting curves');
  assert(shapeCount('closed', 'open', 'open', 'closed') === 4, 'base deck contains four bottom-right connecting curves');
  assert(shapeCount('open', 'closed', 'open', 'closed') === 4 && shapeCount('closed', 'open', 'closed', 'open') === 3, 'base deck has four vertical and three horizontal straights');
  assert(shapeCount('open', 'open', 'open', 'open') === 5 && shapeCount('open', 'closed', 'open', 'open') === 5 && shapeCount('closed', 'open', 'open', 'open') === 5, 'base deck has five crosses and five of each T shape');
  assert(buildActionDeck().length === 27 && buildGoldDeck().length === 28, 'canonical action and gold deck sizes');
  for (const card of paths) {
    const restored = rotateEdges(rotateEdges(card.edges, true), true);
    assert((['top', 'right', 'bottom', 'left', 'center'] as const).every((side) => restored[side] === card.edges[side]), 'two half-turns restore every path shape');
    assert(card.isDeadEnd === !card.edges.center, 'canonical dead-end flag matches topology');
  }
  for (const tool of ['lantern', 'cart', 'pickaxe'] as const) {
    const state = canonicalScenario();
    const sabotage = dealAction(state, `sabotage_${tool}`);
    const before = JSON.stringify(toPrivateState(state, 'p0'));
    assert(!playAction(state, 'p0', sabotage.id, 'p0').ok, 'self-sabotage is rejected');
    assert(JSON.stringify(toPrivateState(state, 'p0')) === before, 'rejection preserves private state and revision');
    assert(playAction(state, 'p0', sabotage.id, 'p1').ok, 'sabotage succeeds on another player');
    const duplicate = dealAction(state, `sabotage_${tool}`);
    assert(!playAction(state, 'p0', duplicate.id, 'p1').ok, 'duplicate broken tool is rejected');
    const repair = dealAction(state, `repair_${tool}`, 'p1');
    assert(playAction(state, 'p1', repair.id, 'p1').ok, 'player can repair their own tool');
    assert(!state.players.get('p1')!.brokenTools.includes(tool), 'single repair clears the broken tool');
    assertStateInvariants(state);
  }
  for (const subtype of ['repair_lantern_cart', 'repair_lantern_pickaxe', 'repair_cart_pickaxe'] as const) {
    const tools = subtype.slice(7).split('_') as Tool[];
    const state = canonicalScenario();
    state.players.get('p1')!.brokenTools = [...tools];
    const repair = dealAction(state, subtype);
    assert(!playAction(state, 'p0', repair.id, 'p1').ok, 'dual repair requires an explicit tool');
    assert(playAction(state, 'p0', repair.id, 'p1', undefined, tools[0]).ok, 'dual repair accepts a depicted broken tool');
    assert(JSON.stringify(state.players.get('p1')!.brokenTools) === JSON.stringify([tools[1]]), 'dual repair repairs exactly one tool');
    assertStateInvariants(state);
  }
  const state = canonicalScenario();
  const map = dealAction(state, 'map');
  assert(playAction(state, 'p0', map.id, undefined, state.goals[0].position).ok, 'map succeeds');
  assert(toPrivateState(state, 'p0')!.peekedGoals.length === 1 && toPrivateState(state, 'p1')!.peekedGoals.length === 0, 'map information belongs only to its player');
  addTunnel(state, { row: 1, col: 4 }, (card) => card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open');
  addTunnel(state, { row: 2, col: 4 }, (card) => card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open');
  const rockfall = dealAction(state, 'rockfall');
  assert(!playAction(state, 'p0', rockfall.id, undefined, state.board[0].position).ok, 'rockfall cannot remove start');
  assert(playAction(state, 'p0', rockfall.id, undefined, { row: 1, col: 4 }).ok, 'rockfall removes a canonical path');
  assert(!traversableSet(state.board).has('2,4'), 'rockfall leaves the detached island unreachable');
  assert(!validatePlacement(state.board, paths.find((card) => card.edges.center && card.edges.top === 'open')!, { row: 3, col: 4 }, []).valid, 'a detached island cannot authorise extensions');
  assertStateInvariants(state);
  const dead = canonicalScenario();
  addTunnel(dead, { row: 1, col: 4 }, (card) => !card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open');
  assert(!isGoalReached(dead.board, { row: 2, col: 4 }), 'dead ends cannot reveal an adjacent goal');
  assert(!traversableSet(dead.board).has('1,4'), 'a dead end never becomes traversable');
  for (const position of [{ row: -1, col: 4 }, { row: 9, col: 4 }, { row: 1, col: 1 }, { row: 1, col: 7 }]) {
    assert(!validatePlacement(dead.board, paths[0], position, []).valid, 'each edge of the mobile cap is enforced');
  }
}

function testCanonicalGoalAndScoring(): void {
  const state = canonicalScenario();
  state.players.get('p0')!.role = 'saboteur';
  state.players.get('p1')!.role = 'miner';
  state.players.get('p2')!.role = 'miner';
  state.players.get('p1')!.brokenTools = ['cart'];
  state.goals.forEach((goal) => { goal.isGold = goal.index === 1; goal.card = makeGoalCard(goal.isGold, goal.index, goal.index === 0 ? 'left' : 'right'); });
  const last = straightToGoal(state);
  assert(placeCard(state, 'p0', last.id, { row: 7, col: 4 }, false).ok, 'saboteur can complete a canonical gold path');
  assert(state.roundWinner === 'miners' && state.status === 'round_end', 'gold ends the round for miners regardless of placer role');
  assert(JSON.stringify(state.goldDistribution!.order) === JSON.stringify(['p2', 'p1']), 'draft starts counterclockwise from saboteur and includes a miner with a broken tool');
  assert(state.goldDistribution!.availableCards.length === 2, 'draw exactly one card per miner');
  const revision = state.revision;
  advanceRound(state);
  assert(state.round === 1 && state.revision === revision, 'unfinished gold draft cannot be skipped');
  assert(!chooseGold(state, 'p1', 0).ok && !chooseGold(state, 'p2', -1).ok && !chooseGold(state, 'p2', 0.5).ok, 'wrong picker and malformed indices are rejected');
  assert(state.revision === revision, 'rejected choices preserve revision');
  assertStateInvariants(state);
  while (!isGoldDistributionComplete(state)) {
    const picker = state.goldDistribution!.order[state.goldDistribution!.currentIndex];
    const offer = toPrivateState(state, picker)!.availableGoldCards!;
    assert(chooseGold(state, picker, offer.indexOf(Math.max(...offer))).ok, 'miner chooses a privately inspected gold card');
    assertStateInvariants(state);
  }
  advanceRound(state);
  assert(state.currentTurnIndex === 1 && state.round === 2, 'the next seat after the winning actor starts');
  assertStateInvariants(state);
  const stone = canonicalScenario();
  stone.goals.forEach((goal) => { goal.isGold = goal.index === 0; goal.card = makeGoalCard(goal.isGold, goal.index, goal.index === 1 ? 'left' : 'right'); });
  const stoneLast = straightToGoal(stone);
  assert(placeCard(stone, 'p0', stoneLast.id, { row: 7, col: 4 }, false).ok, 'stone path succeeds');
  assert(stone.goals[1].revealed && stone.status === 'playing', 'stone goal reveals without ending round');
  const rockfall = dealAction(stone, 'rockfall');
  assert(!playAction(stone, 'p0', rockfall.id, undefined, stone.goals[1].position).ok, 'rockfall cannot remove a revealed goal');
  assertStateInvariants(stone);
  for (const shape of ['left', 'right'] as const) {
    for (const [dr, dc, face] of [[-1, 0, 'top'], [1, 0, 'bottom'], [0, -1, 'left'], [0, 1, 'right']] as const) {
      const goal = makeGoalCard(false, 0, shape);
      const start = { card: { ...buildPathDeck()[0], subtype: 'start' as const }, position: { row: 4 + dr, col: 4 + dc }, placedBy: '' };
      const oriented = orientReachedGoal([start], goal, { row: 4, col: 4 }, start.position);
      assert(oriented.edges[face] === 'open', 'each mirrored stone goal connects from every approach via a half-turn');
      assert(['top', 'right', 'bottom', 'left'].filter((side) => oriented.edges[side as 'top'] === 'open').length === 2, 'revealed stones retain exactly two printed openings');
      const withGoal = [start, { card: oriented, position: { row: 4, col: 4 }, placedBy: '' }];
      assert(traversableSet(withGoal).has('4,4'), 'oriented stone is reachable through a real matching opening');
    }
  }
  const surrounded = canonicalScenario();
  surrounded.board[0].position = { row: 3, col: 4 };
  for (const position of [{ row: 4, col: 3 }, { row: 4, col: 5 }, { row: 5, col: 4 }]) {
    addTunnel(surrounded, position, (card) => Object.values(card.edges).filter((value) => value === 'open').length === 4 && card.edges.center);
  }
  const exception = orientReachedGoal(surrounded.board, makeGoalCard(false, 0), { row: 4, col: 4 }, { row: 3, col: 4 });
  assert(exception.edges.top === 'open' && exception.edges.bottom === 'closed', 'revealing a goal preserves its incoming connection despite unavoidable side mismatches');
  surrounded.board.push({ card: exception, position: { row: 4, col: 4 }, placedBy: '' });
  assert(!traversableSet(surrounded.board).has('5,4'), 'a revealed-goal mismatch never creates a phantom connection');
  for (const card of buildPathDeck()) {
    for (const rotated of [false, true]) {
      const client = validPlacements(surrounded.board, [], card, rotated);
      for (let row = 0; row <= 8; row++) for (let col = 2; col <= 6; col++) {
        assert(client.has(`${row},${col}`) === validatePlacement(surrounded.board, { ...card, edges: rotateEdges(card.edges, rotated) }, { row, col }, []).valid, 'client and authority agree around revealed-goal edge exceptions');
      }
    }
  }
  for (let saboteurs = 1; saboteurs <= 4; saboteurs++) {
    const rewardState = initGame('REWARDS', Array.from({ length: Math.max(3, saboteurs + 1) }, (_, index) => ({ playerId: `reward-${index}`, displayName: `Reward ${index}` })));
    [...rewardState.players.values()].forEach((player, index) => { player.role = index < saboteurs ? 'saboteur' : 'miner'; });
    const reward = saboteurs === 1 ? 4 : saboteurs === 4 ? 2 : 3;
    for (let round = 1; round <= 3; round++) {
      applySaboteurRewards(rewardState.players, rewardState.goldDeck);
      assert([...rewardState.players.values()].every((player) => player.goldCollected === (player.role === 'saboteur' ? round * reward : 0)), 'every supported saboteur count receives the exact reward across three rounds');
      assertStateInvariants(rewardState);
    }
  }
}

function testForfeits(): void {
  const census = initGame('ROUND-CENSUS', Array.from({ length: 5 }, (_, index) => ({ playerId: `c${index}`, displayName: `Census ${index}` })));
  [...census.players.values()].forEach((player, index) => { player.role = index < 2 ? 'saboteur' : 'miner'; });
  assert(forfeitSaboteurPlayers(census, ['c0']), 'one of two dealt saboteurs forfeits');
  for (let round = 1; round <= 2; round++) {
    const survivingSaboteur = [...census.players.values()].find((player) => player.role === 'saboteur' && !player.forfeited)!;
    const priorGold = survivingSaboteur.goldCollected;
    while (census.status === 'playing') {
      const current = census.turnOrder[census.currentTurnIndex];
      assert(passTurn(census, current, census.players.get(current)!.hand[0]?.id).ok, 'census round discards complete');
    }
    assert(survivingSaboteur.goldCollected - priorGold === (round === 1 ? 3 : 4), 'reward census uses dealt roles this round and excludes stale forfeited roles next round');
    assertStateInvariants(census);
    advanceRound(census);
  }
  for (let count = 4; count <= 10; count++) {
    const state = initGame('FORFEIT', Array.from({ length: count }, (_, index) => ({ playerId: `leave-${index}`, displayName: `Leave ${index}` })));
    const departed = state.turnOrder[0];
    const handIds = state.players.get(departed)!.hand.map((card) => card.id);
    const revision = state.revision;
    assert(forfeitSaboteurPlayers(state, [departed, departed]), 'current seat forfeits immediately');
    assert(state.revision === revision + 1 && !forfeitSaboteurPlayers(state, [departed]), 'batch duplicate and repeated forfeit are idempotent');
    assert(state.players.get(departed)!.hand.length === 0 && handIds.every((id) => state.discard.some((card) => card.id === id)), 'departed hand moves directly to discard');
    assert(state.currentTurnIndex === 1, 'forfeit advances the current turn');
    assert(!passTurn(state, departed, handIds[0]).ok, 'departed seat cannot act');
    assertStateInvariants(state);
    while (state.status === 'playing') {
      const current = state.turnOrder[state.currentTurnIndex];
      assert(passTurn(state, current, state.players.get(current)!.hand[0]?.id).ok, 'survivors complete the round without departed turns');
      assertStateInvariants(state);
    }
    assert(state.players.get(departed)!.goldCollected === 0, 'forfeited seat receives no later round reward');
    advanceRound(state);
    assert(state.roundPlayerIds.length === count - 1 && !state.roundPlayerIds.includes(departed), 'next round role pool excludes the forfeited seat');
    assert([...state.players.values()].filter((player) => !player.forfeited).every((player) => player.hand.length === getHandSize(count - 1)), 'survivors receive hands for their new supported count');
    assertStateInvariants(state);
  }
  const draft = initGame('DRAFT-FORFEIT', Array.from({ length: 5 }, (_, index) => ({ playerId: `p${index}`, displayName: `Player ${index}` })));
  draft.deck = buildFullDeck();
  [...draft.players.values()].forEach((player, index) => { player.hand = []; player.role = index === 0 ? 'saboteur' : 'miner'; });
  draft.goals.forEach((goal) => { goal.isGold = goal.index === 1; goal.card = makeGoalCard(goal.isGold, goal.index); });
  const last = straightToGoal(draft);
  assert(placeCard(draft, 'p0', last.id, { row: 7, col: 4 }, false).ok, 'draft departure scenario reaches gold');
  assert(forfeitSaboteurPlayers(draft, ['p4', 'p3']), 'simultaneous pending pickers can forfeit');
  assert(JSON.stringify(draft.goldDistribution!.order) === JSON.stringify(['p2', 'p1']) && draft.goldDistribution!.availableCards.length === 2, 'pending picks and surplus cards settle as one batch');
  assertStateInvariants(draft);
  while (!isGoldDistributionComplete(draft)) {
    assert(chooseGold(draft, draft.goldDistribution!.order[draft.goldDistribution!.currentIndex], 0).ok, 'surviving miners finish the draft');
    assertStateInvariants(draft);
  }
  draft.round = 3;
  draft.players.get('p4')!.goldCollected = 100;
  advanceRound(draft);
  assert(!draft.winnerIds!.includes('p4'), 'forfeited highest scorer cannot win');
  for (const phase of ['playing', 'draft'] as const) {
    const abandoned = canonicalScenario();
    if (phase === 'draft') {
      abandoned.players.get('p0')!.role = 'saboteur';
      abandoned.players.get('p1')!.role = 'miner';
      abandoned.players.get('p2')!.role = 'miner';
      abandoned.goals.forEach((goal) => { goal.isGold = goal.index === 1; goal.card = makeGoalCard(goal.isGold, goal.index); });
      const endingPath = straightToGoal(abandoned);
      assert(placeCard(abandoned, 'p0', endingPath.id, { row: 7, col: 4 }, false).ok, 'abandonment scenario reaches draft');
      abandoned.round = 3;
    }
    const priorScores = [...abandoned.players.values()].map((player) => player.goldCollected);
    assert(forfeitSaboteurPlayers(abandoned, ['p2']), 'departure below three active seats is accepted');
    assert(abandoned.status === 'game_over' && abandoned.terminationReason === 'not_enough_players' && abandoned.winnerIds?.length === 0, 'insufficient survivors terminate without a winner');
    assert(abandoned.goldDistribution === null && abandoned.roundWinner === null, 'abandonment clears pending rewards and round winner');
    assert(JSON.stringify([...abandoned.players.values()].map((player) => player.goldCollected)) === JSON.stringify(priorScores), 'abandonment awards no additional gold');
    assertStateInvariants(abandoned);
    const revision = abandoned.revision;
    assert(!forfeitSaboteurPlayers(abandoned, ['p1']), 'ended match ignores later departures');
    advanceRound(abandoned);
    assert(abandoned.revision === revision, 'ended match cannot advance or change winner');
  }
}

function testGoldBankExhaustively(): void {
  let banks = new Map<string, number[]>([['16,8,4', buildGoldDeck().sort()]]);
  let transitions = 0;
  for (let round = 1; round <= 3; round++) {
    const next = new Map<string, number[]>();
    const keep = (deck: number[]) => next.set([1, 2, 3].map((value) => deck.filter((card) => card === value).length).join(','), deck);
    for (const bank of banks.values()) {
      for (let saboteurs = 1; saboteurs <= 4; saboteurs++) {
        for (let active = 0; active <= saboteurs; active++) {
          const recipients = new Map(Array.from({ length: saboteurs }, (_, index) => [`bank-${index}`, {
            playerId: `bank-${index}`, displayName: 'Bank', role: 'saboteur' as const, forfeited: index >= active,
            hand: [], brokenTools: [], goldCollected: 0, peekedGoals: [],
          }]));
          const remaining = [...bank];
          applySaboteurRewards(recipients, remaining);
          assert(remaining.reduce((sum, value) => sum + value, 0) + [...recipients.values()].reduce((sum, player) => sum + player.goldCollected, 0) === bank.reduce((sum, value) => sum + value, 0), 'every reachable bank pays exact saboteur rewards');
          keep(remaining);
          transitions++;
        }
      }
      const counts = [1, 2, 3].map((value) => bank.filter((card) => card === value).length);
      for (let ones = 0; ones <= Math.min(7, counts[0]); ones++) {
        for (let twos = 0; twos <= Math.min(7 - ones, counts[1]); twos++) {
          for (let threes = 0; threes <= Math.min(7 - ones - twos, counts[2]); threes++) {
            const drawn = ones + twos + threes;
            if (drawn < 1) continue;
            keep([...Array<number>(counts[0] - ones).fill(1), ...Array<number>(counts[1] - twos).fill(2), ...Array<number>(counts[2] - threes).fill(3)]);
            transitions++;
          }
        }
      }
    }
    banks = next;
  }
  console.log(`gold bank: ${transitions} denomination transitions checked across three rounds`);
}

function verticalPath(id: string): PathCard {
  return {
    id,
    type: 'path',
    subtype: 'tunnel',
    edges: { top: 'open', right: 'closed', bottom: 'open', left: 'closed', center: true },
    isDeadEnd: false,
  };
}

function mapCard(id: string): ActionCard {
  return { id, type: 'action', subtype: 'map' };
}

function testRoleDealing(): void {
  const originalRandom = Math.random;
  let seed = 0x5ab07e;
  Math.random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };

  try {
    for (let playerCount = 3; playerCount <= 10; playerCount++) {
      const ratio = ROLE_TABLE[playerCount];
      const minimum = Math.max(1, ratio.saboteurs - 1);
      const observed = new Set<number>();
      for (let deal = 0; deal < 64; deal++) {
        const players = Array.from({ length: playerCount }, (_, index) => ({
          playerId: `role-${playerCount}-${deal}-${index}`,
          displayName: `Player${index}`,
        }));
        const state = initGame('ROLE-DEAL', players);
        const saboteurs = [...state.players.values()].filter((player) => player.role === 'saboteur').length;
        observed.add(saboteurs);
        assert(saboteurs > 0, `${playerCount}-player deal always includes opposition`);
        assert(
          saboteurs >= minimum && saboteurs <= ratio.saboteurs,
          `${playerCount}-player saboteur count stays in the official set-aside range`,
        );
      }
      assert(observed.has(ratio.saboteurs), `${playerCount}-player deals can retain every saboteur card`);
      if (minimum < ratio.saboteurs) {
        assert(observed.has(minimum), `${playerCount}-player deals can set aside one saboteur card`);
      }
    }
  } finally {
    Math.random = originalRandom;
  }
}

function testPlacementGuards(): void {
  assert(
    JSON.stringify(SABOTEUR_PLAYABLE_BOUNDS) === JSON.stringify({ minRow: 0, maxRow: 8, minCol: 2, maxCol: 6 }),
    'intentional 5x9 playable bounds remain stable',
  );

  const state = initGame('PLACEMENT-GUARDS', TEST_PLAYERS);
  const card = verticalPath('guard-path');
  assert(validatePlacement(state.board, card, { row: 1, col: 4 }, []).valid, 'start-connected path is legal');

  const malformed = validatePlacement(
    state.board,
    card,
    { row: true, col: 4 } as unknown as BoardPosition,
    [],
  );
  assert(!malformed.valid && malformed.reason?.includes('safe integers') === true, 'boolean coordinate is rejected');
  assert(!validatePlacement(state.board, card, { row: 1.5, col: 4 }, []).valid, 'fractional coordinate is rejected');
  assert(
    !validatePlacement(state.board, card, { row: Number.MAX_SAFE_INTEGER + 1, col: 4 }, []).valid,
    'unsafe integer coordinate is rejected',
  );

  const detachedGoalBoard = [
    state.board[0],
    {
      card: makeGoalCard(false, 1),
      position: { row: 8, col: 4 },
      placedBy: '',
    },
  ];
  const goalAdjacent = validatePlacement(detachedGoalBoard, card, { row: 7, col: 4 }, []);
  assert(
    !goalAdjacent.valid && goalAdjacent.reason === 'No connection back to the start card',
    'detached goal cannot authorise a path placement',
  );
}

function testLastActorTracking(): void {
  const pathState = initGame('PATH-ACTOR', TEST_PLAYERS);
  pathState.players.get('p0')!.hand = [verticalPath('actor-path')];
  assert(placeCard(pathState, 'p0', 'actor-path', { row: 1, col: 4 }, false).ok, 'actor path play succeeds');
  assert(pathState.lastActorId === 'p0', 'path play records last actor');
  assert(pathState.lastPlacerId === 'p0', 'path play still records last placer');

  const actionState = initGame('ACTION-ACTOR', TEST_PLAYERS);
  actionState.players.get('p0')!.hand = [mapCard('actor-map')];
  assert(
    playAction(actionState, 'p0', 'actor-map', undefined, actionState.goals[0].position).ok,
    'actor action play succeeds',
  );
  assert(actionState.lastActorId === 'p0', 'action play records last actor');
  assert(actionState.lastPlacerId === null, 'action play does not change last placer');

  const passState = initGame('PASS-ACTOR', TEST_PLAYERS);
  passState.players.get('p0')!.hand = [mapCard('actor-pass')];
  assert(passTurn(passState, 'p0', 'actor-pass').ok, 'actor pass succeeds');
  assert(passState.lastActorId === 'p0', 'discard pass records last actor');
  assert(passState.lastPlacerId === null, 'discard pass does not change last placer');

  const starterState = initGame('NEXT-STARTER', TEST_PLAYERS);
  starterState.deck = [];
  for (const player of starterState.players.values()) player.hand = [];
  starterState.players.get('p2')!.hand = [mapCard('final-discard')];
  starterState.currentTurnIndex = 2;
  starterState.lastPlacerId = 'p0';
  assert(passTurn(starterState, 'p2', 'final-discard').ok, 'final discard ends the round');
  assert(starterState.status === 'round_end', 'exhausted round reaches round end');
  assert(starterState.lastActorId === 'p2', 'final discard actor is retained through round end');
  advanceRound(starterState);
  assert(starterState.round === 2, 'next round starts');
  assert(starterState.turnOrder[starterState.currentTurnIndex] === 'p0', 'player left of final actor starts');
  assert(starterState.lastActorId === null, 'new round clears last actor');
}

function testGoldProjectionPrivacy(): void {
  const state = initGame('GOLD-PRIVACY', TEST_PLAYERS);
  state.status = 'round_end';
  state.players.get('p0')!.goldCollected = 5;
  state.players.get('p1')!.goldCollected = 2;
  state.goldDistribution = {
    order: ['p0', 'p1'],
    currentIndex: 1,
    availableCards: [2],
    assignments: new Map([['p0', 3]]),
  };

  const publicRound = toPublicState(state);
  assert(publicRound.players.every((player) => player.goldCollected === null), 'round totals stay private');
  assert(publicRound.goldDistribution?.steps[0].hasChosen === true, 'public state shows completed pick');
  assert(publicRound.goldDistribution?.steps[1].hasChosen === false, 'public state shows pending pick');
  assert(
    !('chosenCard' in (publicRound.goldDistribution?.steps[0] ?? {})),
    'public gold step contains no chosen value',
  );

  const p0Private = toPrivateState(state, 'p0');
  const p1Private = toPrivateState(state, 'p1');
  assert(p0Private?.goldCollected === 5, 'owner receives own running total');
  assert(p0Private?.chosenGoldCard === 3, 'owner receives own chosen gold card');
  assert(p1Private?.goldCollected === 2, 'other owner receives only their own total');
  assert(p1Private?.chosenGoldCard === null, 'player without a pick receives no chosen value');

  state.status = 'game_over';
  const publicGameOver = toPublicState(state);
  assert(publicGameOver.players.find((player) => player.playerId === 'p0')?.goldCollected === 5, 'final total is public at game over');
  assert(publicGameOver.players.find((player) => player.playerId === 'p1')?.goldCollected === 2, 'all final totals are public at game over');
}

function runFocusedRegressionChecks(): void {
  testRoleDealing();
  testPlacementGuards();
  testLastActorTracking();
  testGoldProjectionPrivacy();
  testCanonicalActionsAndTopology();
  testCanonicalGoalAndScoring();
  testForfeits();
  testGoldBankExhaustively();
  console.log('focused regression checks: OK');
}

function candidatePositions(state: SaboteurServerState): BoardPosition[] {
  const cells = boardMap(state.board);
  const out: BoardPosition[] = [];
  const seen = new Set<string>();
  for (const pc of state.board) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const pos = { row: pc.position.row + dr, col: pc.position.col + dc };
      const k = `${pos.row},${pos.col}`;
      if (seen.has(k) || cells.has(k)) continue;
      seen.add(k);
      out.push(pos);
    }
  }
  return out;
}

function tryRandomMove(state: SaboteurServerState, playerId: string): void {
  const player = state.players.get(playerId)!;
  const blocked = state.goals.filter((g) => !g.revealed).map((g) => g.position);

  // 1. try a path card placement
  if (player.brokenTools.length === 0) {
    const pathCards = player.hand.filter((c): c is PathCard => c.type === 'path');
    const legal: { cardId: string; pos: BoardPosition; rotated: boolean }[] = [];
    for (const card of pathCards) {
      for (const pos of candidatePositions(state)) {
        for (const rotated of [false, true]) {
          const oriented = { ...card, edges: rotateEdges(card.edges, rotated) };
          if (validatePlacement(state.board, oriented, pos, blocked).valid) {
            legal.push({ cardId: card.id, pos, rotated });
          }
        }
      }
    }
    if (legal.length > 0 && Math.random() < 0.85) {
      const m = rand(legal);
      const r = placeCard(state, playerId, m.cardId, m.pos, m.rotated);
      assert(r.ok, `legal placement rejected: ${(r as { reason?: string }).reason}`);
      return;
    }
  }

  // 2. try an action card
  const actions = player.hand.filter((c) => c.type === 'action');
  for (const card of actions.sort(() => Math.random() - 0.5)) {
    if (card.type !== 'action') continue;
    if (card.subtype.startsWith('sabotage_')) {
      const tool = card.subtype.slice('sabotage_'.length) as Tool;
      const targets = [...state.players.values()].filter(
        (p) => !p.forfeited && p.playerId !== playerId && !p.brokenTools.includes(tool),
      );
      if (targets.length > 0) {
        const r = playAction(state, playerId, card.id, rand(targets).playerId);
        assert(r.ok, 'legal sabotage rejected');
        return;
      }
    } else if (card.subtype.startsWith('repair_')) {
      const tools = card.subtype.slice('repair_'.length).split('_') as Tool[];
      for (const tool of tools) {
        const targets = [...state.players.values()].filter((p) => !p.forfeited && p.brokenTools.includes(tool));
        if (targets.length > 0) {
          const r = playAction(state, playerId, card.id, rand(targets).playerId, undefined, tools.length > 1 ? tool : undefined);
          assert(r.ok, 'legal repair rejected');
          return;
        }
      }
    } else if (card.subtype === 'map') {
      const unrevealed = state.goals.filter((g) => !g.revealed);
      if (unrevealed.length > 0) {
        const r = playAction(state, playerId, card.id, undefined, rand(unrevealed).position);
        assert(r.ok, 'legal map rejected');
        return;
      }
    } else if (card.subtype === 'rockfall') {
      const tunnels = state.board.filter((p) => p.card.subtype === 'tunnel');
      if (tunnels.length > 0 && Math.random() < 0.3) {
        const r = playAction(state, playerId, card.id, undefined, rand(tunnels).position);
        assert(r.ok, 'legal rockfall rejected');
        return;
      }
    }
  }

  // 3. pass, discarding a random card
  const r = passTurn(state, playerId, rand(player.hand).id);
  assert(r.ok, `pass rejected: ${(r as { reason?: string }).reason}`);
}

function playGame(playerCount: number, departureBatch = 0): SaboteurServerState {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    playerId: `p${i}`,
    displayName: `Player${i}`,
  }));
  const state = initGame('TEST-99', players);

  // setup invariants
  assert(state.deck.length === 67 - playerCount * getHandSize(playerCount), 'deck size after deal');
  const ratio = ROLE_TABLE[playerCount];
  const sabs = [...state.players.values()].filter((p) => p.role === 'saboteur').length;
  const minimumSaboteurs = Math.max(1, ratio.saboteurs - 1);
  assert(
    sabs >= minimumSaboteurs && sabs <= ratio.saboteurs,
    `saboteur count ${sabs} is in official set-aside range ${minimumSaboteurs}-${ratio.saboteurs}`,
  );
  assert(state.board.length === 1 && state.board[0].card.subtype === 'start', 'start card placed');
  assert(state.goals.filter((g) => g.isGold).length === 1, 'exactly one gold goal');
  for (const p of state.players.values()) {
    assert(p.hand.length === getHandSize(playerCount), 'hand size');
  }

  let guard = 0;
  assertStateInvariants(state);
  while (state.status !== 'game_over') {
    if (++guard > 5000) throw new Error('game did not terminate');
    const revision = state.revision;
    if (guard === 8 && departureBatch > 0) {
      const leaving = Array.from({ length: departureBatch }, (_, offset) => state.turnOrder[(state.currentTurnIndex + offset) % state.turnOrder.length]);
      assert(forfeitSaboteurPlayers(state, leaving), 'scheduled forfeit batch is accepted');
    } else if (state.status === 'playing') {
      tryRandomMove(state, state.turnOrder[state.currentTurnIndex]);
    } else if (state.status === 'round_end') {
      if (!isGoldDistributionComplete(state)) {
        const dist = state.goldDistribution!;
        const picker = dist.order[dist.currentIndex];
        const r = chooseGold(state, picker, Math.floor(Math.random() * dist.availableCards.length));
        assert(r.ok, 'legal gold pick rejected');
      } else {
        if (state.roundWinner) results[state.roundWinner]++;
        advanceRound(state);   // handler does this after a pause in production
      }
    }
    assert(state.revision === revision + 1, 'every accepted mutation advances exactly one revision');
    assertStateInvariants(state);
  }

  if (state.terminationReason) {
    assert((state.winnerIds?.length ?? -1) === 0 && state.round < 3, 'abandoned simulation has no winner or fabricated rounds');
    return state;
  }
  assert(state.round === 3, 'game lasted 3 rounds');
  assert((state.winnerIds?.length ?? 0) >= 1, 'has winners');
  const maxGold = Math.max(...[...state.players.values()].filter((player) => !player.forfeited).map((p) => p.goldCollected));
  for (const id of state.winnerIds!) {
    assert(state.players.get(id)!.goldCollected === maxGold, 'winners have max gold');
  }
  return state;
}

const GAMES_PER_COUNT = 60;
const results: Record<string, number> = { miners: 0, saboteurs: 0 };
const originalRandom = Math.random;
Math.random = seededRandom(0x5ab07e);
runFocusedRegressionChecks();
for (let n = 3; n <= 10; n++) {
  for (let g = 0; g < GAMES_PER_COUNT; g++) {
    Math.random = seededRandom(0x5ab000 + n * 1000 + g);
    playGame(n);
  }
  console.log(`player count ${n}: ${GAMES_PER_COUNT} games OK`);
}
for (let count = 3; count <= 10; count++) {
  for (let batch = 1; batch <= 2; batch++) for (let game = 0; game < 10; game++) {
    Math.random = seededRandom(0xf0f000 + count * 1000 + batch * 100 + game);
    playGame(count, batch);
  }
}
console.log('160 seeded departure games: OK');
Math.random = originalRandom;
assert(results.miners > 0 && results.saboteurs > 0, 'full simulations reach both round outcomes');
console.log(`\nAll simulations passed. ${assertions} assertions.`);
console.log(`All-round outcomes: miners ${results.miners}, saboteurs ${results.saboteurs}`);
