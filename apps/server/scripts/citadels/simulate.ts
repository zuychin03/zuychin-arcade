import {
  CITADELS_CITY_SIZE,
  CITADELS_DISTRICT_MANIFEST,
  CITADELS_DISTRICT_PRESET,
  CITADELS_MODE_DESCRIPTION,
  CITADELS_ROLE_BY_ID,
  CITADELS_ROLE_ORDER,
  citadelsFaceUpDiscardCount,
  type CitadelsDistrictCard,
  type CitadelsRole,
} from '@zuychin-arcade/types';
import {
  buildDistrict,
  chooseCharacter,
  chooseIncome,
  citadelsBuildCost,
  endCitadelsTurn,
  forfeitCitadelsPlayers,
  initCitadelsGame,
  keepDistrict,
  settleCitadelsAutopilot,
  useCharacterPower,
  useDistrictPower,
  validateCitadelsState,
  type CitadelsEngineResult,
  type CitadelsServerPlayer,
  type CitadelsServerState,
} from '../../src/game/citadels/engine.js';
import { toCitadelsPrivateState, toCitadelsPublicState } from '../../src/game/citadels/publicState.js';

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function expectOk(result: CitadelsEngineResult, context: string): void {
  assert(result.ok, `${context}: ${result.ok ? '' : result.reason}`);
}

function playerList(count: number): Array<{ playerId: string; displayName: string }> {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index}`,
    displayName: `Player ${index}`,
  }));
}

function fixture(role: CitadelsRole = 'assassin', phase: 'choose_income' | 'action' = 'action', count = 4): CitadelsServerState {
  const state = initCitadelsGame('CANONICAL', playerList(count), seeded(12031));
  for (const player of state.players.values()) {
    state.districtDeck.push(...player.hand);
    player.hand = [];
  }
  setRoles(state, ['p0', role]);
  state.phase = phase;
  return state;
}

function setRoles(state: CitadelsServerState, ...assignments: Array<[string, CitadelsRole]>): void {
  const chosen = new Map(assignments);
  const remaining = CITADELS_ROLE_ORDER.filter(role => !assignments.some(([, assigned]) => assigned === role));
  for (const id of state.turnOrder) if (!chosen.has(id)) chosen.set(id, remaining.shift()!);
  state.roleOwners.clear();
  for (const [id, role] of chosen) {
    const player = state.players.get(id)!;
    player.role = role;
    player.revealedRole = null;
    player.lastRoleRank = 0;
    player.specialUsed = false;
    player.taxUsed = false;
    player.builtThisTurn = 0;
    player.usedDistrictIds.clear();
    state.roleOwners.set(role, id);
  }
  state.availableRoles = [];
  state.faceUpDiscard = [];
  state.faceDownDiscard = CITADELS_ROLE_ORDER.filter(role => !state.roleOwners.has(role));
  state.draftIndex = state.draftOrder.length;
  state.draftPlayerId = null;
  activate(state, assignments[0]![0]);
}

function activate(state: CitadelsServerState, id: string, phase: 'choose_income' | 'action' = 'action'): void {
  const player = state.players.get(id)!;
  state.activePlayerId = id;
  state.activeRole = player.role;
  state.callIndex = CITADELS_ROLE_BY_ID[player.role!].rank;
  state.calledRoles = CITADELS_ROLE_ORDER.slice(0, state.callIndex);
  for (const other of state.turnOrder.map(playerId => state.players.get(playerId)!)) {
    if (CITADELS_ROLE_BY_ID[other.role!].rank <= state.callIndex && other.role !== state.killedRole) {
      other.revealedRole = other.role;
      other.lastRoleRank = CITADELS_ROLE_BY_ID[other.role!].rank;
    } else {
      other.revealedRole = null;
      other.lastRoleRank = 0;
    }
  }
  state.phase = phase;
}

function take(state: CitadelsServerState, templateId: string): CitadelsDistrictCard {
  const index = state.districtDeck.findIndex(card => card.templateId === templateId);
  assert(index >= 0, `Canonical card unavailable: ${templateId}`);
  return state.districtDeck.splice(index, 1)[0]!;
}

function give(state: CitadelsServerState, id: string, zone: 'city' | 'hand', ...templates: string[]): CitadelsDistrictCard[] {
  const cards = templates.map(template => take(state, template));
  state.players.get(id)![zone].push(...cards);
  return cards;
}

const smallCity = ['temple', 'tavern', 'watchtower', 'church', 'market', 'trading_post', 'prison'];

function completeCity(state: CitadelsServerState, id: string): void {
  give(state, id, 'city', ...smallCity);
  state.completionOrder.push(id);
  state.firstCompletedPlayerId ??= id;
}

function finishForScoring(state: CitadelsServerState): void {
  if (!state.firstCompletedPlayerId) completeCity(state, 'p3');
  const round = state.roundNumber;
  let steps = 0;
  while (state.status === 'playing' && state.roundNumber === round && steps++ < 24) {
    if (state.phase === 'choose_income') expectOk(chooseIncome(state, state.activePlayerId!, 'gold', state.revision), 'prepared remaining income');
    else expectOk(endCitadelsTurn(state, state.activePlayerId!, state.revision), 'prepared remaining turn');
  }
  assert(state.status === 'game_over', 'Prepared final round must finish');
  validateCitadelsState(state);
}

function expectRejected(state: CitadelsServerState, command: () => CitadelsEngineResult, label: string): void {
  const before = JSON.stringify({ ...state, players: [...state.players], roleOwners: [...state.roleOwners] });
  assert(!command().ok, `${label} must reject`);
  assert(JSON.stringify({ ...state, players: [...state.players], roleOwners: [...state.roleOwners] }) === before, `${label} must not mutate`);
}

function expectInvalid(change: (state: CitadelsServerState) => void, label: string): void {
  const state = initCitadelsGame('INVALID', playerList(4), seeded(98));
  change(state);
  let rejected = false;
  try { validateCitadelsState(state); } catch { rejected = true; }
  assert(rejected, `${label} must fail validation`);
}

function verifyManifestAndDraft(): void {
  assert(CITADELS_DISTRICT_MANIFEST.reduce((sum, card) => sum + card.count, 0) === 68, 'Canonical manifest contains 68 cards');
  assert(CITADELS_DISTRICT_MANIFEST.filter(card => card.color === 'unique').length === 14, 'Curated manifest contains 14 unique cards');
  assert(CITADELS_DISTRICT_PRESET === 'curated-custom-14-v1', 'Preset is disclosed');
  assert(CITADELS_MODE_DESCRIPTION.includes('curated custom set'), 'Custom subset is disclosed');
  for (let count = 4; count <= 7; count++) {
    for (let seed = 1; seed <= 100; seed++) {
      const state = initCitadelsGame('DRAFT', playerList(count), seeded(53107 + seed * 97 + count));
      assert(state.faceUpDiscard.length === citadelsFaceUpDiscardCount(count), 'Face-up role discard count');
      assert(!state.faceUpDiscard.includes('king'), 'King never discarded face up');
      assert(state.faceDownDiscard.length === 1, 'One initial face-down role');
      assert(new Set([...state.availableRoles, ...state.faceDownDiscard, ...state.faceUpDiscard]).size === 8, 'Eight-role partition');
      for (let pick = 0; pick < count; pick++) {
        const actor = state.draftPlayerId!;
        if (count === 7 && pick === 6) assert(state.availableRoles.length === 2 && Number(state.faceDownDiscard.length) === 0, 'Last seven-player drafter recovers the hidden role');
        expectOk(chooseCharacter(state, actor, state.availableRoles[0]!, state.revision), 'Canonical draft');
        validateCitadelsState(state);
      }
      assert(state.roleOwners.size === count, 'Each seat receives one distinct role');
      assert(state.availableRoles.length === 0 && state.faceDownDiscard.length >= 1, 'Unused final roles remain hidden');
    }
  }
}

function verifyAbilities(): void {
  const assassin = fixture('assassin', 'choose_income');
  expectOk(useCharacterPower(assassin, 'p0', { action: 'assassinate', targetRole: 'king' }, assassin.revision), 'Assassination before income');
  assert(assassin.phase === 'choose_income', 'Ability does not replace resources');
  expectRejected(assassin, () => useCharacterPower(assassin, 'p0', { action: 'assassinate', targetRole: 'bishop' }, assassin.revision), 'Repeated assassination');

  const thief = fixture('thief');
  expectRejected(thief, () => useCharacterPower(thief, 'p0', { action: 'rob', targetRole: 'invalid' as CitadelsRole }, thief.revision), 'Unknown role');
  thief.killedRole = 'bishop';
  for (const targetRole of ['assassin', 'thief', 'bishop'] as CitadelsRole[]) expectRejected(thief, () => useCharacterPower(thief, 'p0', { action: 'rob', targetRole }, thief.revision), 'Illegal robbery target');
  setRoles(thief, ['p0', 'thief'], ['p1', 'merchant'], ['p2', 'king'], ['p3', 'assassin']);
  thief.players.get('p1')!.gold = 7;
  expectOk(useCharacterPower(thief, 'p0', { action: 'rob', targetRole: 'merchant' }, thief.revision), 'Merchant robbery');
  expectOk(endCitadelsTurn(thief, 'p0', thief.revision), 'Call King');
  expectOk(chooseIncome(thief, 'p2', 'gold', thief.revision), 'King income');
  expectOk(endCitadelsTurn(thief, 'p2', thief.revision), 'Call robbed Merchant');
  assert(thief.players.get('p0')!.gold === 9 && thief.players.get('p1')!.gold === 1, 'Theft precedes Merchant extra gold and resources');

  for (const phase of ['choose_income', 'action'] as const) {
    const architect = fixture('architect', phase);
    expectOk(useCharacterPower(architect, 'p0', { action: 'architect_draw' }, architect.revision), 'Optional Architect draw');
    assert(architect.players.get('p0')!.hand.length === 2 && architect.phase === phase, 'Architect draws two without replacing income');
    expectRejected(architect, () => useCharacterPower(architect, 'p0', { action: 'architect_draw' }, architect.revision), 'Repeated Architect draw');
  }

  const magician = fixture('magician');
  give(magician, 'p1', 'hand', 'palace', 'keep');
  expectOk(useCharacterPower(magician, 'p0', { action: 'swap_hand', targetPlayerId: 'p1' }, magician.revision), 'Empty-hand swap');
  assert(magician.players.get('p0')!.hand.length === 2 && magician.players.get('p1')!.hand.length === 0, 'Empty hand is a legal swap');
  const redraw = fixture('magician');
  const discarded = give(redraw, 'p0', 'hand', 'castle', 'temple');
  const incoming = redraw.districtDeck.slice(0, 2).map(card => card.id);
  expectOk(useCharacterPower(redraw, 'p0', { action: 'redraw_hand', cardIds: discarded.map(card => card.id) }, redraw.revision), 'Magician redraw');
  assert(redraw.players.get('p0')!.hand.every((card, i) => card.id === incoming[i]), 'Replacement comes from top');
  assert(redraw.districtDeck.slice(-2).every((card, i) => card.id === discarded[i]!.id), 'Discard goes to bottom');

  for (const [role, districtId] of [['king', 'manor'], ['bishop', 'temple'], ['merchant', 'market'], ['warlord', 'prison']] as const) {
    const tax = fixture(role, 'choose_income');
    give(tax, 'p0', 'city', districtId, 'school_of_magic');
    expectOk(useCharacterPower(tax, 'p0', { action: 'tax' }, tax.revision), 'Tax before resources');
    assert(tax.players.get('p0')!.gold === 4, 'School adds one tax of the active colour');
    expectRejected(tax, () => useCharacterPower(tax, 'p0', { action: 'tax' }, tax.revision), 'Repeated tax');
  }
}

function verifyUniqueDistricts(): void {
  for (const observatory of [false, true]) for (const library of [false, true]) {
    const state = fixture('magician', 'choose_income');
    if (observatory) give(state, 'p0', 'city', 'observatory');
    if (library) give(state, 'p0', 'city', 'library');
    const draw = observatory ? 3 : 2;
    expectOk(chooseIncome(state, 'p0', 'cards', state.revision), 'Card income');
    if (library) assert(state.players.get('p0')!.hand.length === draw && state.phase === 'action', 'Library keeps all, including Observatory third card');
    else {
      assert(state.pendingDraw.length === draw, 'Correct card choice count');
      const bottom = state.pendingDraw.slice(1).map(card => card.id);
      expectOk(keepDistrict(state, 'p0', state.pendingDraw[0]!.id, state.revision), 'Keep income card');
      assert(state.districtDeck.slice(-bottom.length).every((card, i) => card.id === bottom[i]), 'Unchosen income cards return to bottom');
    }
    validateCitadelsState(state);
  }
  const mine = fixture('magician', 'choose_income');
  give(mine, 'p0', 'city', 'gold_mine');
  expectOk(chooseIncome(mine, 'p0', 'gold', mine.revision), 'Gold Mine');
  assert(mine.players.get('p0')!.gold === 5, 'Gold Mine gives three total');

  const factory = fixture('architect');
  give(factory, 'p0', 'city', 'factory');
  const cards = give(factory, 'p0', 'hand', 'wishing_well', 'temple', 'market', 'tavern');
  factory.players.get('p0')!.gold = 20;
  assert(toCitadelsPrivateState(factory, 'p0').effectiveBuildCosts[cards[0]!.id] === 4, 'Factory discount is projected');
  for (const card of cards.slice(0, 3)) expectOk(buildDistrict(factory, 'p0', card.id, factory.revision), 'Architect build');
  assert(factory.players.get('p0')!.gold === 13, 'Factory only discounts unique districts');
  expectRejected(factory, () => buildDistrict(factory, 'p0', cards[3]!.id, factory.revision), 'Fourth Architect build');

  const powers = fixture('magician', 'choose_income');
  const [lab, smithy] = give(powers, 'p0', 'city', 'laboratory', 'smithy');
  const [discard] = give(powers, 'p0', 'hand', 'palace');
  expectOk(useDistrictPower(powers, 'p0', lab!.id, discard!.id, powers.revision), 'Laboratory');
  assert(powers.players.get('p0')!.gold === 4 && powers.districtDeck.at(-1)?.id === discard!.id, 'Laboratory gives two and returns card to bottom');
  expectRejected(powers, () => useDistrictPower(powers, 'p0', lab!.id, undefined, powers.revision), 'Repeated Laboratory');
  expectOk(useDistrictPower(powers, 'p0', smithy!.id, undefined, powers.revision), 'Smithy');
  assert(powers.players.get('p0')!.gold === 2 && powers.players.get('p0')!.hand.length === 3, 'Smithy pays two to gain three');
  expectRejected(powers, () => useDistrictPower(powers, 'p0', smithy!.id, undefined, powers.revision), 'Repeated Smithy');

  for (const emptyCount of [0, 1]) {
    const exhausted = fixture('architect', 'choose_income');
    exhausted.players.get('p1')!.hand.push(...exhausted.districtDeck.splice(emptyCount));
    expectOk(chooseIncome(exhausted, 'p0', 'cards', exhausted.revision), 'Exhausted income');
    assert(exhausted.phase === 'action' && exhausted.players.get('p0')!.hand.length === emptyCount, 'Zero/one available card settles without a stuck choice');
    expectOk(useCharacterPower(exhausted, 'p0', { action: 'architect_draw' }, exhausted.revision), 'Exhausted Architect');
    validateCitadelsState(exhausted);
  }
}

function verifyWarlord(): void {
  for (const own of [false, true]) {
    const state = fixture('warlord');
    const target = own ? 'p0' : 'p1';
    const [wall, temple, keep] = give(state, target, 'city', 'great_wall', 'temple', 'keep');
    state.players.get('p0')!.gold = 10;
    expectRejected(state, () => useCharacterPower(state, 'p0', { action: 'destroy', targetPlayerId: target, districtId: keep!.id }, state.revision), 'Keep protection');
    expectOk(useCharacterPower(state, 'p0', { action: 'destroy', targetPlayerId: target, districtId: temple!.id }, state.revision), 'Warlord own/rival destruction');
    assert(state.players.get('p0')!.gold === 9 && state.districtDeck.at(-1)?.id === temple!.id, 'Great Wall adds one to other district, destroyed card returns');
    state.players.get('p0')!.specialUsed = false;
    expectOk(useCharacterPower(state, 'p0', { action: 'destroy', targetPlayerId: target, districtId: wall!.id }, state.revision), 'Destroy Great Wall');
    assert(state.players.get('p0')!.gold === 4, 'Great Wall does not protect itself');
  }
  const bishop = fixture('warlord');
  setRoles(bishop, ['p0', 'warlord'], ['p1', 'bishop']);
  const [temple] = give(bishop, 'p1', 'city', 'temple');
  expectRejected(bishop, () => useCharacterPower(bishop, 'p0', { action: 'destroy', targetPlayerId: 'p1', districtId: temple!.id }, bishop.revision), 'Living Bishop immunity');
  bishop.killedRole = 'bishop';
  bishop.players.get('p1')!.revealedRole = null;
  bishop.players.get('p1')!.lastRoleRank = 0;
  expectOk(useCharacterPower(bishop, 'p0', { action: 'destroy', targetPlayerId: 'p1', districtId: temple!.id }, bishop.revision), 'Killed Bishop loses immunity');
  const complete = fixture('warlord');
  completeCity(complete, 'p1');
  expectRejected(complete, () => useCharacterPower(complete, 'p0', { action: 'destroy', targetPlayerId: 'p1', districtId: complete.players.get('p1')!.city[0]!.id }, complete.revision), 'Completed city immunity');
}

function verifyScoring(): void {
  for (const substitute of [false, true]) {
    const state = fixture('warlord');
    give(state, 'p0', 'city', 'manor', 'temple', 'market', 'haunted_quarter', 'wishing_well');
    if (!substitute) give(state, 'p0', 'city', 'barracks');
    finishForScoring(state);
    assert(state.scoreBreakdowns.p0!.diversityBonus === 3, 'Haunted colour choice maximises diversity');
    assert(state.scoreBreakdowns.p0!.uniqueBonus === (substitute ? 1 : 2), 'Substituted Haunted ceases to be unique for Wishing Well');
  }
  const bonuses = fixture('warlord');
  give(bonuses, 'p0', 'city', 'dragon_gate', 'imperial_treasury', 'map_room');
  give(bonuses, 'p0', 'hand', 'castle', 'palace');
  bonuses.players.get('p0')!.gold = 7;
  finishForScoring(bonuses);
  assert(bonuses.scoreBreakdowns.p0!.districtPoints === 16 && bonuses.scoreBreakdowns.p0!.uniqueBonus === 11, 'Printed costs plus Dragon, Treasury and Map bonuses');
  const publicState = toCitadelsPublicState(bonuses);
  publicState.scoreBreakdowns.p0!.total = 999;
  assert(bonuses.scoreBreakdowns.p0!.total !== 999, 'Nested score projection never aliases engine');

  for (const killedRole of ['warlord', 'king'] as const) {
    const state = fixture('architect');
    setRoles(state, ['p0', killedRole], ['p1', killedRole === 'king' ? 'thief' : 'king'], ['p3', 'architect']);
    state.killedRole = killedRole;
    activate(state, 'p3');
    for (const id of ['p0', 'p1']) give(state, id, 'city', 'palace', 'cathedral', 'town_hall', 'fortress');
    completeCity(state, 'p3');
    finishForScoring(state);
    assert(state.winnerIds[0] === (killedRole === 'king' ? 'p0' : 'p1'), 'Highest revealed rank breaks tied totals, killed King reveals at round end');
    assert(state.players.get('p0')!.revealedRole === (killedRole === 'king' ? 'king' : null), 'Killed non-King stays secret');
    if (killedRole === 'king') assert(state.crownPlayerId === 'p0', 'Killed King receives crown');
  }
}

function verifyPrivacyAndValidation(): void {
  const state = initCitadelsGame('PRIVACY', playerList(4), seeded(731));
  const text = JSON.stringify(toCitadelsPublicState(state));
  assert(!text.includes('availableRoles') && !text.includes('faceDownDiscard'), 'No secret draft zones in public state');
  for (const player of state.players.values()) {
    const mine = toCitadelsPrivateState(state, player.playerId);
    assert(mine.roomCode === state.roomCode && mine.playerId === player.playerId && mine.revision === state.revision, 'Atomic private identity');
    assert(mine.availableRoles.length > 0 === (state.draftPlayerId === player.playerId), 'Only drafter sees choices');
    for (const card of player.hand) assert(!text.includes(card.id), 'No private hand identity in public state');
    mine.hand[0]!.cost = 999;
    assert(player.hand[0]!.cost !== 999, 'Private hand detached');
  }
  expectInvalid(s => { s.districtDeck.pop(); }, 'Missing physical card');
  expectInvalid(s => { s.districtDeck.push(s.districtDeck[0]!); }, 'Duplicated physical card');
  expectInvalid(s => { s.districtDeck[0] = { ...s.districtDeck[0]!, cost: 999 }; }, 'Forged card face');
  expectInvalid(s => { s.players.get('p0')!.gold = NaN; }, 'NaN gold');
  expectInvalid(s => { s.players.get('p0')!.gold = 0.5; }, 'Fractional gold');
  expectInvalid(s => { s.revision = Infinity; }, 'Infinite revision');

  const pending = fixture('assassin', 'choose_income');
  expectOk(chooseIncome(pending, 'p0', 'cards', pending.revision), 'Pending abandonment draw');
  const selectedIds = pending.pendingDraw.map(card => card.id);
  for (const id of ['p1', 'p2', 'p3']) assert(toCitadelsPrivateState(pending, id).drawnCards.length === 0, 'Drawn cards private to actor');
  expectOk(forfeitCitadelsPlayers(pending, pending.turnOrder, pending.revision), 'Batch abandonment');
  assert(pending.winnerIds.length === 0 && pending.status === 'game_over', 'All-left batch has no phantom winner');
  assert(selectedIds.every(id => pending.districtDeck.some(card => card.id === id)), 'Abandoned pending cards conserved');
  validateCitadelsState(pending);
}

function roleTarget(state: CitadelsServerState, role: CitadelsRole): CitadelsRole | null {
  return CITADELS_ROLE_ORDER.find((candidate) => {
    if (role === 'assassin') return candidate !== 'assassin';
    return !['assassin', 'thief'].includes(candidate) && candidate !== state.killedRole;
  }) ?? null;
}

function useBotAbilities(state: CitadelsServerState, player: CitadelsServerPlayer): boolean {
  const role = player.role!;
  if (!player.specialUsed && role === 'architect') {
    expectOk(useCharacterPower(state, player.playerId, { action: 'architect_draw' }, state.revision), 'bot Architect');
    return true;
  }
  if (!player.specialUsed && role === 'assassin') {
    expectOk(useCharacterPower(state, player.playerId, { action: 'assassinate', targetRole: roleTarget(state, role)! }, state.revision), 'bot Assassin');
    return true;
  }
  if (!player.specialUsed && role === 'thief') {
    expectOk(useCharacterPower(state, player.playerId, { action: 'rob', targetRole: roleTarget(state, role)! }, state.revision), 'bot Thief');
    return true;
  }
  if (!player.specialUsed && role === 'magician' && player.hand.length > 4) {
    expectOk(useCharacterPower(state, player.playerId, { action: 'redraw_hand', cardIds: [player.hand[0]!.id] }, state.revision), 'bot Magician');
    return true;
  }
  if (!player.taxUsed && ['king', 'bishop', 'merchant', 'warlord'].includes(role)) {
    expectOk(useCharacterPower(state, player.playerId, { action: 'tax' }, state.revision), 'bot tax');
    return true;
  }
  const laboratory = player.city.find((card) => card.effect === 'laboratory' && !player.usedDistrictIds.has(card.id));
  if (laboratory && player.hand.length > 0) {
    expectOk(useDistrictPower(state, player.playerId, laboratory.id, player.hand[0]!.id, state.revision), 'bot Laboratory');
    return true;
  }
  const smithy = player.city.find((card) => card.effect === 'smithy' && !player.usedDistrictIds.has(card.id));
  if (smithy && player.gold >= 4) {
    expectOk(useDistrictPower(state, player.playerId, smithy.id, undefined, state.revision), 'bot Smithy');
    return true;
  }
  if (!player.specialUsed && role === 'warlord') {
    const target = [...state.players.values()].find((candidate) => (
      candidate.playerId !== player.playerId
      && state.turnOrder.includes(candidate.playerId)
      && candidate.city.length > 0
      && candidate.city.length < CITADELS_CITY_SIZE
      && !(candidate.role === 'bishop' && state.killedRole !== 'bishop')
    ));
    const targetDistrict = target?.city.find((card) => (
      card.effect !== 'keep'
      && player.gold >= Math.max(0, card.cost - 1) + (card.effect !== 'great_wall' && target.city.some((built) => built.effect === 'great_wall') ? 1 : 0)
    ));
    if (target && targetDistrict) {
      expectOk(useCharacterPower(state, player.playerId, {
        action: 'destroy', targetPlayerId: target.playerId, districtId: targetDistrict.id,
      }, state.revision), 'bot Warlord');
      return true;
    }
  }
  return false;
}

function performLiveCommand(state: CitadelsServerState): void {
  settleCitadelsAutopilot(state);
  if (state.status === 'game_over') return;
  if (state.phase === 'drafting') {
    const actor = state.players.get(state.draftPlayerId!)!;
    assert(!actor.forfeited, 'settled draft must stop at a live seat');
    const privateState = toCitadelsPrivateState(state, actor.playerId);
    const role = privateState.availableRoles[Math.floor(state.rng() * privateState.availableRoles.length)]!;
    expectOk(chooseCharacter(state, actor.playerId, role, state.revision), 'live draft');
    settleCitadelsAutopilot(state);
    return;
  }
  const actor = state.players.get(state.activePlayerId!)!;
  assert(!actor.forfeited, 'settled role turn must stop at a live seat');
  if (state.phase === 'choose_income') {
    if (useBotAbilities(state, actor)) {
      settleCitadelsAutopilot(state);
      return;
    }
    const choice = actor.hand.length < 2 ? 'cards' : 'gold';
    expectOk(chooseIncome(state, actor.playerId, choice, state.revision), 'live income');
    settleCitadelsAutopilot(state);
    return;
  }
  if (state.phase === 'choose_cards') {
    const card = [...state.pendingDraw].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0]!;
    expectOk(keepDistrict(state, actor.playerId, card.id, state.revision), 'live income card');
    settleCitadelsAutopilot(state);
    return;
  }
  assert(state.phase === 'action', 'live command needs a supported phase');
  if (useBotAbilities(state, actor)) {
    settleCitadelsAutopilot(state);
    return;
  }
  const limit = actor.role === 'architect' ? 3 : 1;
  const legal = [...actor.hand]
    .filter((card) => !actor.city.some((built) => built.name === card.name))
    .filter((card) => citadelsBuildCost(actor, card) <= actor.gold)
    .sort((a, b) => citadelsBuildCost(actor, a) - citadelsBuildCost(actor, b) || a.id.localeCompare(b.id))[0];
  if (legal && actor.builtThisTurn < limit) {
    expectOk(buildDistrict(state, actor.playerId, legal.id, state.revision), 'live build');
  } else {
    expectOk(endCitadelsTurn(state, actor.playerId, state.revision), 'live end turn');
  }
  settleCitadelsAutopilot(state);
}

function runGame(playerCount: number, seed: number, forfeit = false): number {
  const state = initCitadelsGame(`SIM-${playerCount}-${seed}`, playerList(playerCount), seeded(seed));
  let forfeited = false;
  const archiveSnapshots = new Map<string, string>();
  let commands = 0;
  let highestRound = state.roundNumber;
  while (state.status !== 'game_over' && commands < 4_000) {
    if (forfeit && !forfeited && commands >= seed % 31) {
      const departed = state.turnOrder.slice(0, Math.max(1, playerCount - 4));
      expectOk(forfeitCitadelsPlayers(state, departed, state.revision), 'seeded mid-game forfeit');
      forfeited = true;
      if (state.terminationReason) break;
    }
    validateCitadelsState(state);
    for (const player of state.players.values()) {
      if (state.turnOrder.includes(player.playerId)) continue;
      const snapshot = JSON.stringify(player);
      const previous = archiveSnapshots.get(player.playerId);
      if (previous) assert(snapshot === previous, 'Retired player immutable throughout later rounds');
      else archiveSnapshots.set(player.playerId, snapshot);
    }
    const publicState = toCitadelsPublicState(state);
    assert(publicState.rulesVersion === state.rulesVersion, 'public rules version drifted');
    assert(!JSON.stringify(publicState).includes('availableRoles'), 'public projection leaked draft choices');
    performLiveCommand(state);
    highestRound = Math.max(highestRound, state.roundNumber);
    commands += 1;
  }
  assert(state.status === 'game_over', `${playerCount}p game ${seed} stalled after ${commands} live commands`);
  if (forfeit) assert(forfeited, 'Departure campaign must exercise a departure');
  if (forfeit && playerCount === 4) {
    assert(state.winnerIds.length === 0 && state.terminationReason === 'not_enough_players', 'Four-seat departure ends without winner');
    assert(Object.keys(state.scoreBreakdowns).length === 0, 'Abandonment has no competitive scoring');
    validateCitadelsState(state);
    return commands;
  }
  assert(state.winnerIds.length === 1 && state.terminationReason === null, 'completed game needs one eligible winner');
  assert(!state.players.get(state.winnerIds[0]!)!.forfeited, 'forfeited seat cannot win');
  assert(Object.keys(state.scoreBreakdowns).length === playerCount, 'every seat needs a score breakdown');
  for (const player of state.players.values()) {
    if (player.forfeited) {
      assert(player.score === 0, 'forfeited seat must score zero');
      assert(player.city.length < CITADELS_CITY_SIZE, 'forfeiture autopilot must stay below city completion');
    }
  }
  assert(highestRound >= 2, 'full game must cross a round boundary');
  return commands;
}

function verifyRetiredSeatRecovery(): void {
  const state = initCitadelsGame('RETIRED-SEAT', playerList(5), seeded(401));
  const departedId = state.turnOrder[0]!;
  expectOk(forfeitCitadelsPlayers(state, [departedId], state.revision), 'initial round-only forfeit');
  let commands = 0;
  let observedRounds = state.roundNumber;
  while (state.status === 'playing' && commands < 4_000) {
    settleCitadelsAutopilot(state);
    if (state.phase === 'drafting') assert(state.draftPlayerId !== departedId, 'recurring forfeited drafter must settle automatically');
    else assert(state.activePlayerId !== departedId, 'recurring forfeited character turn must settle automatically');
    performLiveCommand(state);
    if (state.roundNumber > 1) {
      assert(!state.turnOrder.includes(departedId), 'Departed seat removed before every future draft');
      assert(state.players.get(departedId)!.hand.length === 0 && state.players.get(departedId)!.role === null, 'Archived hand and role cleared');
    }
    observedRounds = Math.max(observedRounds, state.roundNumber);
    commands += 1;
  }
  assert(state.status === 'game_over', 'recurring forfeiture recovery must reach game over');
  assert(observedRounds >= 3, 'recurring forfeiture test must cross multiple drafts and role turns');
  assert(state.players.get(departedId)!.score === 0, 'recurring forfeited seat must score zero');
}

function completeCurrentRoundWithoutBuilding(state: CitadelsServerState): void {
  const round = state.roundNumber;
  let steps = 0;
  while (state.status === 'playing' && state.roundNumber === round && steps++ < 100) {
    settleCitadelsAutopilot(state);
    if (state.status !== 'playing' || state.roundNumber !== round) break;
    if (state.phase === 'drafting') expectOk(chooseCharacter(state, state.draftPlayerId!, state.availableRoles[0]!, state.revision), 'round draft');
    else if (state.phase === 'choose_income') expectOk(chooseIncome(state, state.activePlayerId!, 'gold', state.revision), 'round income');
    else if (state.phase === 'choose_cards') expectOk(keepDistrict(state, state.activePlayerId!, state.pendingDraw[0]!.id, state.revision), 'round selection');
    else expectOk(endCitadelsTurn(state, state.activePlayerId!, state.revision), 'round end');
    validateCitadelsState(state);
  }
  assert(state.status === 'game_over' || state.roundNumber === round + 1, 'Bounded round completes');
}

function verifyRoundOnlyForfeits(): void {
  for (let count = 4; count <= 7; count += 1) {
    for (const phase of ['before_draft', 'after_draft', 'choose_income', 'choose_cards', 'action'] as const) {
      const state = phase === 'before_draft' || phase === 'after_draft'
        ? initCitadelsGame('POLICY-PHASE', playerList(count), seeded(440 + count))
        : fixture('assassin', 'choose_income', count);
      const departed = state.draftPlayerId ?? state.activePlayerId!;
      if (phase === 'after_draft') expectOk(chooseCharacter(state, departed, state.availableRoles[0]!, state.revision), 'Departed seat drafted');
      if (phase === 'choose_cards' || phase === 'action') expectOk(chooseIncome(state, departed, phase === 'choose_cards' ? 'cards' : 'gold', state.revision), 'Prepare phase');
      const pendingIds = state.pendingDraw.map(card => card.id);
      expectOk(forfeitCitadelsPlayers(state, [departed], state.revision), 'Phase forfeit');
      const mine = toCitadelsPrivateState(state, departed);
      assert(!mine.canAct && !mine.canUseAbilities && !mine.canBuild && mine.availableRoles.length === 0 && mine.drawnCards.length === 0, 'Forfeited private controls disabled');
      assert(state.players.get(departed)!.score === 0, 'Forfeit immediately scores zero');
      if (count === 4) {
        assert(state.status === 'game_over' && state.terminationReason === 'not_enough_players' && state.winnerIds.length === 0, 'Below minimum aborts every phase');
        assert(Object.keys(state.scoreBreakdowns).length === 0, 'No truncated competitive result');
        assert(pendingIds.every(id => state.districtDeck.some(card => card.id === id)), 'Abandonment returns pending draw');
        const ended = JSON.stringify(toCitadelsPublicState(state));
        expectRejected(state, () => forfeitCitadelsPlayers(state, state.turnOrder, state.revision), 'Terminal forfeit immutable');
        assert(JSON.stringify(toCitadelsPublicState(state)) === ended, 'Abandoned public snapshot immutable');
      } else {
        assert(state.status === 'playing' && state.turnOrder.includes(departed), 'Current round retains ghost');
        completeCurrentRoundWithoutBuilding(state);
        assert(state.turnOrder.length === count - 1 && !state.turnOrder.includes(departed), 'Next draft excludes retired seat');
        assert(state.faceUpDiscard.length === citadelsFaceUpDiscardCount(count - 1), 'Next draft uses surviving count');
        assert(state.players.size === count && toCitadelsPublicState(state).players.length === count, 'Historical seat retained publicly');
        assert(state.players.get(departed)!.hand.length === 0 && state.players.get(departed)!.role === null, 'Archive has no live hand/role');
        const frozen = JSON.stringify(state.players.get(departed));
        completeCurrentRoundWithoutBuilding(state);
        assert(JSON.stringify(state.players.get(departed)) === frozen, 'Archive never gains future cards, gold or roles');
      }
      validateCitadelsState(state);
    }
  }

  for (let count = 4; count <= 7; count += 1) {
    const state = initCitadelsGame('BATCH', playerList(count), seeded(510 + count));
    const previousRevision = state.revision;
    expectRejected(state, () => forfeitCitadelsPlayers(state, ['p0', 'missing'], state.revision), 'Invalid batch atomic');
    expectRejected(state, () => forfeitCitadelsPlayers(state, ['p0'], state.revision + 1), 'Stale batch atomic');
    expectOk(forfeitCitadelsPlayers(state, state.turnOrder.slice(0, count - 3), state.revision), 'Simultaneous minimum breach');
    assert(state.revision === previousRevision + 1 && state.winnerIds.length === 0 && state.terminationReason === 'not_enough_players', 'Whole batch aborts before autopilot');
  }

  const crown = initCitadelsGame('CROWN', playerList(7), seeded(773));
  const oldOrder = [...crown.turnOrder];
  const crownIndex = oldOrder.indexOf(crown.crownPlayerId);
  const departed = [crown.crownPlayerId, oldOrder[(crownIndex + 1) % 7]!];
  const nextCrown = oldOrder[(crownIndex + 2) % 7]!;
  expectOk(forfeitCitadelsPlayers(crown, departed, crown.revision), 'Crown and clockwise neighbour depart');
  assert(crown.crownPlayerId === nextCrown, 'Crown skips whole forfeited batch clockwise');
  completeCurrentRoundWithoutBuilding(crown);
  assert(!crown.players.get(crown.crownPlayerId)!.forfeited && crown.draftOrder[0] === crown.crownPlayerId, 'Eligible crown opens reduced draft');

  for (const killed of [false, true]) {
    const state = fixture('assassin', 'action', 5);
    setRoles(state, ['p0', 'assassin'], ['p1', 'king'], ['p2', 'bishop'], ['p3', 'merchant'], ['p4', 'warlord']);
    state.crownPlayerId = 'p1';
    if (killed) expectOk(useCharacterPower(state, 'p0', { action: 'assassinate', targetRole: 'king' }, state.revision), 'Kill departed King');
    expectOk(forfeitCitadelsPlayers(state, ['p1'], state.revision), 'King departure');
    assert(state.crownPlayerId === 'p2', 'Departed crown moves before King call');
    completeCurrentRoundWithoutBuilding(state);
    assert(state.crownPlayerId === 'p2' && state.draftOrder[0] === 'p2', 'Live or killed ghost King cannot reclaim crown');
  }

  const target = fixture('assassin', 'action', 5);
  give(target, 'p4', 'city', 'market');
  const returned = give(target, 'p4', 'hand', 'library')[0]!;
  expectOk(forfeitCitadelsPlayers(target, ['p4'], target.revision), 'Target departs');
  completeCurrentRoundWithoutBuilding(target);
  assert(target.districtDeck.some(card => card.id === returned.id), 'Unbuilt archived card returned to deck');
  setRoles(target, ['p0', 'magician']);
  expectRejected(target, () => useCharacterPower(target, 'p0', { action: 'swap_hand', targetPlayerId: 'p4' }, target.revision), 'Archived Magician target');
  setRoles(target, ['p0', 'warlord']);
  expectRejected(target, () => useCharacterPower(target, 'p0', { action: 'destroy', targetPlayerId: 'p4', districtId: target.players.get('p4')!.city[0]!.id }, target.revision), 'Archived Warlord target');

  for (const count of [4, 5, 6]) {
    const state = fixture('warlord', 'action', count);
    completeCity(state, 'p1');
    expectOk(forfeitCitadelsPlayers(state, ['p1'], state.revision), 'Completed builder forfeits before round end');
    assert(state.firstCompletedPlayerId === null, 'Forfeited first completion is no longer eligible');
    if (count === 4) {
      assert(state.terminationReason === 'not_enough_players' && Object.keys(state.scoreBreakdowns).length === 0, 'Minimum takes priority over built seventh district');
    } else {
      expectOk(endCitadelsTurn(state, 'p0', state.revision), 'Final role boundary');
      assert(state.status === 'playing' && state.roundNumber === 2, 'Only forfeited completed city cannot end game');
      assert(!state.turnOrder.includes('p1'), 'Completed departed city archived');
      validateCitadelsState(state);
    }
  }
  const final = fixture('warlord', 'action', 6);
  completeCity(final, 'p1');
  completeCity(final, 'p2');
  expectOk(forfeitCitadelsPlayers(final, ['p1'], final.revision), 'First finisher departs with sufficient players');
  expectOk(endCitadelsTurn(final, 'p0', final.revision), 'Natural survivor scoring');
  assert(final.status === 'game_over' && final.terminationReason === null && final.players.get('p1')!.score === 0, 'Eligible completed city still ends round naturally');
  assert(final.scoreBreakdowns.p2!.completionBonus === 4 && final.firstCompletedPlayerId === 'p2', 'First eligible finisher receives completion bonus');
  expectRejected(final, () => forfeitCitadelsPlayers(final, ['p2'], final.revision), 'Completed natural result immutable');

  for (const count of [4, 5]) {
    const state = fixture('warlord', 'action', count);
    completeCity(state, 'p1');
    expectOk(forfeitCitadelsPlayers(state, ['p0'], state.revision), 'Last actor leaves a completed-city round');
    assert(state.status === 'game_over', 'Last actor forfeit settles terminal boundary');
    assert(count === 4
      ? state.terminationReason === 'not_enough_players' && state.winnerIds.length === 0 && Object.keys(state.scoreBreakdowns).length === 0
      : state.terminationReason === null && state.winnerIds.length === 1 && state.scoreBreakdowns.p0!.total === 0,
    'Minimum check precedes last-actor autopilot and competitive scoring');
  }

  const ghostTarget = fixture('magician', 'action', 5);
  setRoles(ghostTarget, ['p0', 'magician'], ['p4', 'merchant']);
  give(ghostTarget, 'p4', 'hand', 'library');
  give(ghostTarget, 'p4', 'city', 'market');
  expectOk(forfeitCitadelsPlayers(ghostTarget, ['p4'], ghostTarget.revision), 'Future ghost target');
  expectOk(useCharacterPower(ghostTarget, 'p0', { action: 'swap_hand', targetPlayerId: 'p4' }, ghostTarget.revision), 'Current-round ghost remains swappable');
  setRoles(ghostTarget, ['p0', 'warlord'], ['p4', 'merchant']);
  expectOk(useCharacterPower(ghostTarget, 'p0', { action: 'destroy', targetPlayerId: 'p4', districtId: ghostTarget.players.get('p4')!.city[0]!.id }, ghostTarget.revision), 'Current-round ghost remains attackable');
  const detached = toCitadelsPublicState(ghostTarget);
  detached.turnOrder.pop();
  detached.players.find(player => player.playerId === 'p0')!.gold = 1000;
  assert(ghostTarget.turnOrder.length === 5 && ghostTarget.players.get('p0')!.gold !== 1000, 'Public archive/order projections detached');

  const ghostLimit = fixture('warlord', 'action', 5);
  give(ghostLimit, 'p0', 'city', ...smallCity.slice(0, 6));
  give(ghostLimit, 'p0', 'hand', smallCity[6]!);
  ghostLimit.players.get('p0')!.gold = 10;
  expectOk(forfeitCitadelsPlayers(ghostLimit, ['p0'], ghostLimit.revision), 'Last ghost cannot trigger completion');
  assert(ghostLimit.roundNumber === 2 && ghostLimit.players.get('p0')!.city.length === 6 && !ghostLimit.turnOrder.includes('p0'), 'Ghost stops below completion and retires');

  const heldCrown = fixture('king', 'action', 5);
  heldCrown.crownPlayerId = 'p0';
  expectOk(forfeitCitadelsPlayers(heldCrown, ['p0'], heldCrown.revision), 'Active King leaves after receiving crown');
  assert(heldCrown.crownPlayerId === 'p1', 'Active departed King passes crown clockwise');
  completeCurrentRoundWithoutBuilding(heldCrown);
  assert(heldCrown.crownPlayerId === 'p1' && !heldCrown.turnOrder.includes('p0'), 'Retired King stays crownless');
}

verifyManifestAndDraft();
verifyAbilities();
verifyUniqueDistricts();
verifyWarlord();
verifyScoring();
verifyPrivacyAndValidation();
verifyRetiredSeatRecovery();
verifyRoundOnlyForfeits();

let games = 0;
let forfeitGames = 0;
let commands = 0;
let maxCommands = 0;
for (let players = 4; players <= 7; players += 1) {
  for (let seed = 1; seed <= Number(process.env.CITADELS_GAMES ?? 50); seed += 1) {
    const used = runGame(players, Number(process.env.CITADELS_SEED_OFFSET ?? 8_600_000) + players * 100_000 + seed);
    commands += used;
    maxCommands = Math.max(maxCommands, used);
    games += 1;
  }
  for (let seed = 1; seed <= Number(process.env.CITADELS_FORFEIT_GAMES ?? 20); seed += 1) {
    const used = runGame(players, Number(process.env.CITADELS_SEED_OFFSET ?? 8_600_000) + players * 1_000_000 + seed, true);
    commands += used;
    maxCommands = Math.max(maxCommands, used);
    forfeitGames += 1;
  }
}

console.log(
  `CITADELS SIM PASS: ${games} full games + ${forfeitGames} departure games (4-player aborts; 5-7-player survivor completions), `
  + `${commands} live commands, ${assertions} assertions, max ${maxCommands} commands.`,
);
