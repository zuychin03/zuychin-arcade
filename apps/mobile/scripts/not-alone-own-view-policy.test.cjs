const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ownViewPolicy, assertOwnViewMode, OWN_VIEW_METHOD } = require('./not-alone-own-view-policy.cjs');
const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8').replace(/\r\n/g, '\n');
const policySource = fs.readFileSync(path.join(__dirname, 'not-alone-own-view-policy.cjs'), 'utf8');

function frames(role = 'hunted') {
  const mine = {
    gameId: 'not_alone', roomCode: 'ROOM-TEST', revision: 12, playerId: 'me', role,
    placeHand: role === 'hunted' ? [1, 2, 3, 4, 5] : [], selectedPlaces: [], requiredSelectionCount: 1,
    playableHuntCardIds: [], survivalChoiceCards: [], resolutionOptions: null, cardChoice: null,
    revealedHuntedHands: {}, canSelect: role === 'hunted', canGiveUp: true,
  };
  const state = {
    gameId: 'not_alone', roomCode: 'ROOM-TEST', revision: 12, viewerPlayerId: 'me', roundNumber: 2,
    selectionBlockedPlaces: [], disabledPlaces: [], huntTokens: { creature: [], target: [], artemia: [] },
    players: [{ playerId: 'me', role, handCount: mine.placeHand.length, discard: [], revealedPlaces: [], forfeited: false },
      { playerId: 'other', role: 'hunted', handCount: 3, discard: [1, 2], revealedPlaces: [], forfeited: false }],
  };
  return { state, mine };
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('own-view mode rejects all seeded and focus-only combinations before browser launch', () => {
  assertOwnViewMode({ ownView: true });
  for (const mode of ['focusOnly', 'focusStabilityOnly', 'fixtureRun']) {
    assert.throws(() => assertOwnViewMode({ ownView: true, [mode]: true }));
    assertOwnViewMode({ ownView: false, [mode]: true });
  }
  assert.match(driver, /NOT_ALONE_UI_OWN_VIEW === 'true'/);
  assert(driver.indexOf('assertOwnViewMode({ ownView: OWN_VIEW') < driver.indexOf('browser = await puppeteer.launch'));
  assert.match(driver, /strategy !== 'own-view' \|\| !onProgress/);
});

test('policy rejects another viewer, room, revision or role rather than accepting a convenient frame', () => {
  const { state, mine } = frames();
  for (const mismatch of [{ viewerPlayerId: 'other' }, { roomCode: 'OTHER' }, { revision: 13 }, { gameId: 'bang' }]) assert.throws(() => ownViewPolicy({ ...state, ...mismatch }, mine));
  assert.throws(() => ownViewPolicy(state, { ...mine, role: 'creature' }));
  assert.throws(() => ownViewPolicy(state, { ...mine, playerId: 'other' }));
});

test('all policy decisions are invariant to unrelated opponent private hands and submitted destinations', () => {
  for (const role of ['creature', 'hunted']) {
    const { state, mine } = frames(role);
    mine.playableHuntCardIds = ['phobia', 'tracking'];
    mine.cardChoice = { count: 1, placeOptions: [2, 3], placeIndexes: [1, 0] };
    mine.survivalChoiceCards = ['dodge', 'gate']; mine.selectedPlaces = [3, 4];
    const baseline = ownViewPolicy(state, mine);
    const unrelated = { hand: [1, 5], selectedPlaces: [1], huntHand: ['despair'] };
    state.players[1].privateState = unrelated;
    assert.deepEqual(ownViewPolicy(state, mine), baseline);
    unrelated.hand = [7, 8, 10]; unrelated.selectedPlaces = [10]; unrelated.huntHand = ['virus'];
    assert.deepEqual(ownViewPolicy(state, mine), baseline);
    Object.defineProperty(state.players[1], 'privateState', { get() { throw Error('Opponent private access'); } });
    for (const key of ['placeHand', 'selectedPlaces', 'survivalHand']) Object.defineProperty(state.players[1], key, { get() { throw Error('Opponent ' + key + ' accessed'); } });
    assert.deepEqual(ownViewPolicy(state, mine), baseline);
  }
  assert.equal(ownViewPolicy.length, 2);
  assert.doesNotMatch(policySource, /latestPrivate|livePlayers|coverage\.|plans\.|process\.env|Date\.|Math\.random/);
});

test('own selection is distinct, legal and nonmutating, with Give Up only when privately permitted', () => {
  const { state, mine } = frames();
  state.selectionBlockedPlaces = [4]; mine.requiredSelectionCount = 2;
  const before = JSON.stringify({ state, mine });
  const result = ownViewPolicy(freeze(state), freeze(mine));
  assert.equal(result.explorationPlaces.length, 2);
  assert.equal(new Set(result.explorationPlaces).size, 2);
  assert(result.explorationPlaces.every(place => mine.placeHand.includes(place) && place !== 4));
  assert.equal(JSON.stringify({ state, mine }), before);
  assert(!result.giveUp);
  assert(ownViewPolicy(state, { ...mine, placeHand: [] }).giveUp);
  assert(!ownViewPolicy(state, { ...mine, placeHand: [], canGiveUp: false }).giveUp);
});

test('Creature uses projected public discards or legally disclosed Phobia information only', () => {
  const { state, mine } = frames('creature');
  state.players[1].discard = [1, 2, 3, 4];
  assert.equal(ownViewPolicy(state, mine).creatureDestination, 5);
  mine.revealedHuntedHands = { other: [8] };
  assert.equal(ownViewPolicy(state, mine).creatureDestination, 8);
  state.selectionBlockedPlaces = [8];
  assert.notEqual(ownViewPolicy(state, mine).creatureDestination, 8);
  mine.revealedHuntedHands = {};
  state.players[1].discard = []; state.players[1].discardCount = 4;
  assert([1, 2, 3, 4, 5].includes(ownViewPolicy(state, mine).creatureDestination), 'A Smokescreen count must not become fabricated card identities');
});

test('mandatory choices, River safety and Hunt selection are determined solely by owned legal options', () => {
  const { state, mine } = frames('creature');
  mine.playableHuntCardIds = ['flashback', 'stasis'];
  mine.cardChoice = { count: 2, placeOptions: [2, 4, 5], placeIndexes: [1, 0] };
  mine.survivalChoiceCards = ['gate', 'dodge']; mine.selectedPlaces = [2, 4];
  state.huntTokens.creature = [2];
  const plan = ownViewPolicy(state, mine);
  assert.equal(plan.huntCardId, 'stasis');
  assert.deepEqual(plan.cardChoicePlaces, [2, 4]); assert.deepEqual(plan.cardChoiceIndexes, [1, 0]);
  assert.equal(plan.survivalChoiceCardId, 'gate'); assert.equal(plan.riverChoice, 4);
  assert(plan.passSurvival);
  assert.equal(ownViewPolicy(state, { ...mine, playableHuntCardIds: ['flashback'] }).huntCardId, 'flashback');
  assert.equal(ownViewPolicy(state, { ...mine, playableHuntCardIds: [] }).huntCardId, null);
});

test('Place power and Rover choices do not depend on prior Shelter coverage or a coordinated escape route', () => {
  const { state, mine } = frames();
  mine.resolutionOptions = { canUsePlacePower: true, canRecoverPlace: true, effectivePlaceId: 5, roverPlaceIds: [6, 7, 8, 9, 10], powerRecoveryCount: 0 };
  assert.deepEqual(ownViewPolicy(state, mine).resolution, { usePower: true, rover: 8 });
  mine.resolutionOptions.roverPlaceIds = [7];
  assert.equal(ownViewPolicy(state, mine).resolution.rover, 7);
  mine.resolutionOptions.canUsePlacePower = false;
  assert(!ownViewPolicy(state, mine).resolution.usePower);
  mine.resolutionOptions = { ...mine.resolutionOptions, effectivePlaceId: 2, canUsePlacePower: true, powerRecoveryCount: 0, canReturnPlayedPlace: false };
  assert(!ownViewPolicy(state, mine).resolution.usePower);
  mine.resolutionOptions.mustUsePlacePower = true;
  assert(ownViewPolicy(state, mine).resolution.usePower);
});

test('legacy direct-peek and coverage-biased strategy helpers remain byte-for-byte unchanged', () => {
  const hashes = [
    ['function commonAvailablePlaces', 'function requiredTokenPlaceCount', '2fa51f688536674bbf51a14f9dfefe16384a9886e6d4f6eae42a5efdc396a178'],
    ['function chooseHuntCard', 'async function playHuntCard', '24ef70e632062e1d10f0481169ab2eb0b6fdbe64b798d20a967637d3b4145469'],
  ];
  for (const [start, end, expected] of hashes) assert.equal(crypto.createHash('sha256').update(driver.slice(driver.indexOf(start), driver.indexOf(end))).digest('hex'), expected);
  assert.match(driver, /ownPlan \? ownPlan.explorationPlaces : desiredExplorationPlaces\(player, players, strategy, plans\)/);
  assert.match(driver, /ownPlan \? ownPlan.creatureDestination : creatureDestination\(players, strategy\)/);
  assert.match(driver, /ownPlan \? ownPlan.huntCardId : rehearsingEarlyRoute \? null : chooseHuntCard/);
  assert.match(driver, /ownPlan \? ownPlan.resolution.usePower : strategy === 'escape'/);
  assert.match(driver, /ownPlan \? ownPlan.resolution.rover : !coverage.has\('shelter_choice_reload'\)/);
});

test('strict Shelter reload and double-submit checks, full two-track journeys and normal cleanup remain', () => {
  assert.match(driver, /Reload lost the mandatory Shelter keep-one decision/);
  assert.match(driver, /sentAfter - sentBefore === 1/);
  assert.match(driver, /acceptedAfter - acceptedBefore === 1/);
  for (const match of [1, 2]) assert(driver.includes(`OWN_VIEW ? await driveFullMatch(players, ${match}, 'own-view')`));
  assert.match(driver, /firstTerminal.players.every\(player => !player.forfeited\)/);
  assert.match(driver, /secondTerminal.players.every\(player => !player.forfeited\)/);
  assert.match(driver, /firstTerminal.endReason === 'track'/);
  assert.match(driver, /secondTerminal.endReason === 'track'/);
  assert.match(driver, /completedNaturalGames.push\(\{ match: 1/);
  assert.match(driver, /completedNaturalGames.push\(\{ match: 2/);
  assert.match(driver, /finished seat auth cleared/);
  assert.match(driver, /host auth cleared/);
  assert.match(driver, /normalUI: false, fallback: true/);
  assert.match(OWN_VIEW_METHOD, /Central scheduling, privacy assertions and focus instrumentation/);
  assert.match(OWN_VIEW_METHOD, /Survival reactions are passed/);
});
