import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_THE_KRAKEN_CHARACTERS, FEED_THE_KRAKEN_MAPS, feedTheKrakenDeck } from '../../../../../packages/types/src/feed-the-kraken-constants.js';
import type { FeedTheKrakenAction, FeedTheKrakenCharacter, FeedTheKrakenWindow } from '../../../../../packages/types/src/feed-the-kraken.js';
import { forfeitFeedTheKrakenPlayer, initFeedTheKrakenGame, submitFeedTheKrakenAction, validateFeedTheKrakenState, type FeedTheKrakenServerState } from './engine.js';
import { toFeedTheKrakenPrivateState, toFeedTheKrakenPublicState } from './publicState.js';
import { nextFeedTheKrakenSimulationAction, runFeedTheKrakenSimulation, seededFeedTheKrakenRng } from '../../../scripts/feed-the-kraken/simulate.js';

function setup(n = 7, seed = 42) { return initFeedTheKrakenGame(Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, displayName: `Seat ${i}` })), 'TEST', n >= 7 ? 'long' : 'quick', seededFeedTheKrakenRng(seed)); }
function act(s: FeedTheKrakenServerState, id: string, action: FeedTheKrakenAction) { assert.deepEqual(submitFeedTheKrakenAction(s, id, action, s.revision, s.windowId), { ok: true }, `${s.phase}/${id}/${JSON.stringify(action)}`); }
function step(s: FeedTheKrakenServerState) { const move = nextFeedTheKrakenSimulationAction(s); act(s, move.actor, move.action); }
function until(s: FeedTheKrakenServerState, condition: () => boolean) { for (let i = 0; i < 1000 && !condition(); i++) { assert.equal(s.status, 'playing'); step(s); } assert.ok(condition()); }
function snapshot(s: FeedTheKrakenServerState) { const { rng: _rng, ...data } = s; return structuredClone(data); }

test('all player counts, journeys and seeded full voyages', () => {
  for (let n = 5; n <= 11; n++) for (let seed = 1; seed <= 20; seed++) {
    runFeedTheKrakenSimulation(n, 'quick', seed); if (n >= 7) runFeedTheKrakenSimulation(n, 'long', seed);
  }
});

test('setup faction counts, gun conservation and initial cult privacy', () => {
  const expected = [[3, 2, 1, 0], [4, 2, 1, 0], [4, 3, 1, 0], [5, 3, 1, 0], [5, 4, 1, 0], [5, 4, 1, 1]];
  for (let n = 6; n <= 11; n++) {
    const s = setup(n); assert.deepEqual(['sailor', 'pirate', 'cult_leader', 'cultist'].map((f) => s.order.filter((id) => s.players[id]!.faction === f).length), expected[n - 6]);
    for (const id of s.order) { const p = s.players[id]!; assert.equal(p.knownLeaderId, null); assert.equal(p.knownPirateIds.length, p.faction === 'pirate' ? expected[n - 6]![1]! - 1 : 0); }
    validateFeedTheKrakenState(s);
  }
  const counts = new Set<number>(); for (let seed = 1; seed <= 500; seed++) counts.add(Object.values(setup(5, seed).players).filter((p) => p.faction === 'pirate').length);
  assert.deepEqual([...counts].sort(), [1, 2]);
  assert.throws(() => initFeedTheKrakenGame([{ playerId: 'a', displayName: 'A' }], 'BAD'));
});

test('independently confirmed charts and at most five ritual arrivals', () => {
  for (const journey of ['quick', 'long'] as const) {
    const map = FEED_THE_KRAKEN_MAPS[journey]; assert.equal(Object.keys(map).length, journey === 'quick' ? 21 : 24);
    const counts = ['cabin', 'flogging', 'tongue', 'feeding'].map((a) => Object.values(map).filter((n) => n.action === a).length);
    assert.deepEqual(counts, journey === 'quick' ? [3, 0, 0, 2] : [4, 2, 1, 3]);
    let maxYellow = 0;
    function walk(id: string, yellow: number) {
      const node = map[id]!; maxYellow = Math.max(maxYellow, yellow);
      for (const [colour, dest] of Object.entries(node.routes)) {
        if (['pirate', 'sailor', 'cult'].includes(dest)) continue;
        assert.ok(map[dest], `${journey}:${id}->${dest}`); assert.ok(map[dest]!.y > node.y);
        walk(dest, yellow + (colour === 'yellow' ? 1 : 0));
      }
    }
    walk('0,0', 0); assert.ok(maxYellow <= 5);
  }
  assert.deepEqual(FEED_THE_KRAKEN_MAPS.quick['0,2']!.routes, { red: '-1,3', blue: '1,3', yellow: '-1,3' });
  assert.deepEqual(FEED_THE_KRAKEN_MAPS.long['-1,1']!.routes, { red: '-1,3', blue: '0,2', yellow: '-1,3' });
  assert.equal(FEED_THE_KRAKEN_MAPS.long['0,6']!.beforeSupply, true);
  assert.equal(FEED_THE_KRAKEN_MAPS.long['-2,6']!.beforeSupply, false);
  assert.equal(FEED_THE_KRAKEN_MAPS.long['-1,7']!.beforeSupply, false);
  assert.equal(feedTheKrakenDeck('quick').length, 19); assert.equal(feedTheKrakenDeck('long').length, 23);
});

test('invalid actions and stale commands are mutation-free', () => {
  const s = setup(); const before = snapshot(s);
  assert.equal(submitFeedTheKrakenAction(s, 'absent', { type: 'pass' }, s.revision).ok, false);
  assert.equal(submitFeedTheKrakenAction(s, s.pendingPlayerId!, { type: 'pass' }, s.revision + 1).ok, false);
  assert.equal(submitFeedTheKrakenAction(s, s.pendingPlayerId!, { type: 'bid', guns: -1 }, s.revision).ok, false);
  assert.deepEqual(snapshot(s), before);
});

test('sealed bids accept concurrent window, hide amounts, reject replay', () => {
  const s = setup(); until(s, () => s.phase === 'mutiny');
  const ids = s.order.filter((id) => id !== s.captainId); const revision = s.revision; const window = s.windowId;
  assert.deepEqual(submitFeedTheKrakenAction(s, ids[0]!, { type: 'bid', guns: 1 }, revision, window), { ok: true });
  const before = snapshot(s);
  assert.equal(submitFeedTheKrakenAction(s, ids[0]!, { type: 'bid', guns: 2 }, revision, window).ok, false); assert.deepEqual(snapshot(s), before);
  assert.deepEqual(submitFeedTheKrakenAction(s, ids[1]!, { type: 'bid', guns: 0 }, revision, window), { ok: true });
  const pub = toFeedTheKrakenPublicState(s); assert.equal(pub.bids, null); assert.ok(pub.players.every((p) => p.guns === null));
  assert.equal(toFeedTheKrakenPrivateState(s, ids[0]!).ownBid, 1); assert.equal(toFeedTheKrakenPrivateState(s, ids[1]!).ownBid, 0);
});

test('mutiny tie veto chain spends only revealed physical guns', () => {
  const s = setup(); until(s, () => s.phase === 'mutiny'); const oldCaptain = s.captainId;
  const ids = s.order.filter((id) => id !== oldCaptain); for (const id of ids) act(s, id, { type: 'bid', guns: ids.indexOf(id) < 3 ? 1 : 0 });
  until(s, () => s.phase === 'tie_veto'); assert.equal(s.pendingPlayerId, oldCaptain);
  act(s, oldCaptain, { type: 'veto', playerId: ids[0]! }); assert.equal(s.pendingPlayerId, ids[0]);
  act(s, ids[0]!, { type: 'veto', playerId: ids[1]! }); assert.equal(s.captainId, ids[2]);
  assert.equal(s.players[ids[0]!]!.guns, 2); assert.equal(s.players[ids[2]!]!.guns, 2); validateFeedTheKrakenState(s);
});

test('navigator sees only offered cards; projections are detached and viewer-owned', () => {
  const s = setup(); until(s, () => s.phase === 'navigator');
  for (const id of s.order) assert.equal(toFeedTheKrakenPrivateState(s, id).navigationCards.length, id === s.navigatorId ? 2 : 0);
  const pub = toFeedTheKrakenPublicState(s); assert.ok(pub.players.every((p) => p.faction === null));
  const json = JSON.stringify(pub); assert.ok(!json.includes('knownPirateIds')); assert.ok(!json.includes('originalFaction'));
  pub.players[0]!.displayName = 'changed'; assert.notEqual(s.players[s.order[0]!]!.displayName, 'changed');
  assert.throws(() => toFeedTheKrakenPrivateState(s, 'stranger'));
});

test('all 21 base ability effects activate only at their priority gates', () => {
  const windows: Partial<Record<FeedTheKrakenCharacter, FeedTheKrakenWindow>> = {
    troublemaker: 'after_bids', peacemaker: 'after_bids', minstrel: 'after_appointment', boatswain: 'before_draw', herbalist: 'before_appointment',
    master_strategist: 'after_bids', smuggler: 'before_draw', agitator: 'after_appointment', adviser: 'before_appointment', chief_cook: 'before_appointment',
    rabble_rouser: 'after_bids', archivist: 'before_draw', spiritualist: 'yellow', debt_collector: 'after_appointment', negotiator: 'after_appointment', instigator: 'after_bids',
  };
  for (const c of FEED_THE_KRAKEN_CHARACTERS) {
    const s = setup(); const id = s.captainId; const others = s.order.filter((t) => t !== id); const [a, b, r] = others as [string, string, string];
    s.players[id]!.character = c; s.phase = 'priority'; s.window = windows[c] ?? 'before_appointment'; s.pendingPlayerId = id;
    s.priorityOrder = [id, ...others]; s.priorityIndex = 0; s.lieutenantId = a; s.navigatorId = b;
    s.bids = Object.fromEntries(others.map((t) => [t, 1])); s.bidsRevealed = true;
    let targets: string[] = [];
    if (['kleptomaniac', 'troublemaker', 'peacemaker', 'smuggler', 'adviser', 'archivist', 'mentor', 'debt_collector', 'instigator'].includes(c)) targets = [a];
    if (['minstrel', 'agitator'].includes(c)) targets = [a, b];
    if (c === 'herbalist') { s.offDuty = [a]; targets = [a, b]; }
    if (c === 'spiritualist') targets = [a, b, r];
    if (c === 'mentor') s.players[a]!.characterRevealed = true;
    act(s, id, { type: 'character', targets }); assert.equal(s.players[id]!.characterRevealed, true, c); validateFeedTheKrakenState(s);
    if (c === 'instigator') { act(s, a, { type: 'instigator', accept: false }); assert.ok(s.effects.instigatorReset.includes(id)); }
    if (c === 'lookout') act(s, id, { type: 'telescope', discard: false });
    if (c === 'mentor') assert.equal(s.players[a]!.characterRevealed, false);
    if (c === 'negotiator') { assert.equal(s.effects.threshold, 1); assert.equal(s.effects.cap, 1); }
    if (c === 'gunslinger') assert.equal(s.players[id]!.guns, 5);
    if (c === 'gunsmith') assert.equal(s.players[id]!.guns, 2);
    if (c === 'peacemaker') assert.equal(s.bids[a], 0);
  }
});

test('leader refusal is not sacrifice victory; normal eliminated faction stays hidden', () => {
  const s = setup(); until(s, () => s.phase === 'navigator'); const id = s.navigatorId!;
  s.players[id]!.faction = 'cult_leader'; act(s, id, { type: 'navigate', refuse: true });
  assert.equal(s.status, 'playing'); assert.equal(s.players[id]!.departureReason, 'refused');
  assert.equal(toFeedTheKrakenPublicState(s).players.find((p) => p.playerId === id)!.faction, null);
});

test('forfeits at every encountered phase settle without deadlock', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 15; seed++) {
    const initial = setup(7, seed);
    for (let i = 0; i < 600 && initial.status === 'playing'; i++) {
      const stage = `${initial.phase}:${initial.window}:${initial.mapAction}:${initial.ritual}`;
      if (!seen.has(stage)) {
        seen.add(stage);
        for (const id of initial.order.filter((t) => initial.players[t]!.aboard)) {
          const clone = { ...snapshot(initial), rng: seededFeedTheKrakenRng(seed + 100) };
          assert.deepEqual(forfeitFeedTheKrakenPlayer(clone, id), { ok: true }, `${initial.phase}/${id}`);
          for (let j = 0; j < 1500 && clone.status === 'playing'; j++) {
            try { step(clone); } catch (error) { throw new Error(`forfeit from ${initial.phase}, departed ${id}, captain ${clone.captainId}, lieutenant ${clone.lieutenantId}, navigator ${clone.navigatorId}, now ${clone.phase}`, { cause: error }); }
          }
          assert.equal(clone.status, 'game_over', initial.phase); assert.ok(!clone.winnerIds.includes(id));
        }
      }
      step(initial);
    }
  }
  assert.ok(['priority', 'navigation', 'navigator', 'map_action'].every((p) => [...seen].some((stage) => stage.startsWith(p + ':'))));
});

test('all departures finish without winner, never award leader sacrifice', () => {
  const s = setup(11); for (const id of s.order) assert.deepEqual(forfeitFeedTheKrakenPlayer(s, id), { ok: true });
  assert.equal(s.status, 'game_over'); assert.equal(s.endReason, 'no_participants'); assert.deepEqual(s.winnerIds, []);
});

function currentCard(s: FeedTheKrakenServerState, effect: string) {
  const index = s.draw.findIndex((c) => c.effect === effect); assert.ok(index >= 0);
  const card = s.draw.splice(index, 1)[0]!; s.currentCard = card; s.players[s.captainId]!.resume.push(card);
  s.navigationCaptainId = s.captainId; const others = s.order.filter((id) => id !== s.captainId);
  s.lieutenantId = others[0]!; s.navigatorId = others[1]!; s.navigationTeam = [s.captainId, s.lieutenantId, s.navigatorId]; return card;
}

function beginRitual(s: FeedTheKrakenServerState, ritual: 'conversion' | 'stash' | 'cult_search') {
  currentCard(s, 'uprising');
  const index = s.rituals.indexOf(ritual); assert.ok(index >= 0);
  [s.rituals[0], s.rituals[index]] = [s.rituals[index]!, s.rituals[0]!];
  s.phase = 'priority'; s.window = 'yellow'; s.priorityOrder = [s.captainId]; s.priorityIndex = 0; s.pendingPlayerId = s.captainId;
  act(s, s.captainId, { type: 'pass' });
  assert.equal(s.phase, 'ritual');
}

test('ritual public transcript cannot distinguish an aboard Leader from a departed Leader', () => {
  for (const ritual of ['conversion', 'cult_search'] as const) {
    const a = setup(); const leader = a.order.find(id => a.players[id]!.faction === 'cult_leader')!;
    const departed = a.order.find(id => id !== leader && id !== a.captainId)!;
    a.players[departed]!.aboard = false; a.players[departed]!.departureReason = 'refused';
    const b = { ...snapshot(a), rng: seededFeedTheKrakenRng(42) };
    [b.players[leader]!.faction, b.players[departed]!.faction] = [b.players[departed]!.faction, b.players[leader]!.faction];
    assert.deepEqual(toFeedTheKrakenPublicState(a), toFeedTheKrakenPublicState(b));
    beginRitual(a, ritual); beginRitual(b, ritual);
    assert.deepEqual(toFeedTheKrakenPublicState(a), toFeedTheKrakenPublicState(b));
    const target = a.order.find(id => id !== leader && id !== departed)!;
    const respondents = [leader, ...a.ritualPendingIds.filter(id => id !== leader)];
    for (const id of respondents) {
      act(a, id, ritual === 'conversion' && id === leader ? { type: 'ritual', playerId: target } : { type: 'ritual' });
      act(b, id, { type: 'ritual' });
      assert.deepEqual(toFeedTheKrakenPublicState(a), toFeedTheKrakenPublicState(b));
      if (a.phase === 'ritual' && ritual === 'conversion') assert.notEqual(a.players[target]!.faction, 'cultist');
    }
    if (ritual === 'conversion') assert.equal(a.players[target]!.faction, 'cultist');
  }
});

test('ritual acknowledgements accept same-window concurrency and reject replay without public readiness', () => {
  const s = setup(); beginRitual(s, 'cult_search');
  const revision = s.revision; const windowId = s.windowId; const [a, b] = s.ritualPendingIds;
  assert.deepEqual(submitFeedTheKrakenAction(s, a!, { type: 'ritual' }, revision, windowId), { ok: true });
  const before = snapshot(s);
  assert.equal(submitFeedTheKrakenAction(s, a!, { type: 'ritual' }, revision, windowId).ok, false);
  assert.equal(submitFeedTheKrakenAction(s, b!, { type: 'ritual' }, revision, windowId - 1).ok, false);
  assert.deepEqual(snapshot(s), before);
  assert.deepEqual(submitFeedTheKrakenAction(s, b!, { type: 'ritual' }, revision, windowId), { ok: true });
  const pub = toFeedTheKrakenPublicState(s);
  assert.equal(pub.pendingPlayerId, null); assert.ok(!JSON.stringify(pub).includes('ritualPending'));
  assert.equal(toFeedTheKrakenPrivateState(s, a!).canAct, false);
  assert.equal(toFeedTheKrakenPrivateState(s, s.ritualPendingIds[0]!).canAct, true);
});

test('ritual stash defers guns and settles forfeited recipients and Leader without deadlock', () => {
  for (const leaveLeader of [false, true]) {
    const s = setup(); beginRitual(s, 'stash');
    const leader = s.pendingPlayerId!; const recipient = s.order.find(id => id !== leader && id !== s.captainId)!;
    const count = s.ritualGunCount; const guns = s.players[recipient]!.guns;
    act(s, leader, { type: 'ritual', allocations: { [recipient]: count } });
    assert.equal(s.players[recipient]!.guns, guns);
    assert.deepEqual(forfeitFeedTheKrakenPlayer(s, leaveLeader ? leader : recipient), { ok: true });
    until(s, () => s.phase !== 'ritual');
    assert.equal(s.players[recipient]!.guns, leaveLeader ? guns : 0);
    assert.deepEqual(s.ritualPendingIds, []); assert.equal(s.ritualDecision, null);
    validateFeedTheKrakenState(s);
  }
  const fresh = setup(); assert.deepEqual(fresh.ritualPendingIds, []); assert.equal(fresh.ritualDecision, null); assert.equal(fresh.ritualWindowRevision, 0);
});

test('no-target rituals still require private responses and stash uses its opening supply', () => {
  const empty = setup(); for (const id of empty.order) empty.players[id]!.conversionImmune = true;
  beginRitual(empty, 'conversion'); assert.equal(empty.pendingPlayerId, null);
  assert.equal(empty.ritualPendingIds.length, empty.order.length);
  for (const id of empty.order) {
    assert.equal(toFeedTheKrakenPrivateState(empty, id).ritual, null); act(empty, id, { type: 'ritual' });
  }
  const s = setup(); const recipient = s.order.find(id => s.players[id]!.faction !== 'cult_leader' && id !== s.captainId)!;
  s.players[recipient]!.guns += s.supplyGuns - 1; s.supplyGuns = 1;
  beginRitual(s, 'stash'); const leader = s.pendingPlayerId!;
  assert.deepEqual(forfeitFeedTheKrakenPlayer(s, recipient), { ok: true });
  assert.equal(toFeedTheKrakenPrivateState(s, leader).ritualGunCount, 1); assert.ok(s.supplyGuns > 1);
  const guns = s.players[leader]!.guns;
  act(s, leader, { type: 'ritual', allocations: { [leader]: 1 } });
  until(s, () => s.phase !== 'ritual'); assert.equal(s.players[leader]!.guns, guns + 1); validateFeedTheKrakenState(s);
});

test('Look-Out projects the actual top card even while its owner holds a navigation hand', () => {
  for (const office of ['captainId', 'lieutenantId'] as const) {
    const s = setup(); until(s, () => s.phase === 'priority' && s.window === 'during_navigation');
    const actor = s[office]!; const hand = [...s.hands[actor]!]; const top = s.draw[0]!;
    s.players[actor]!.character = 'lookout'; s.players[actor]!.characterRevealed = false; s.pendingPlayerId = actor;
    act(s, actor, { type: 'character' });
    assert.deepEqual(toFeedTheKrakenPrivateState(s, actor).navigationCards, [top]);
    act(s, actor, { type: 'telescope', discard: false });
    assert.deepEqual(toFeedTheKrakenPrivateState(s, actor).navigationCards, hand);
  }
});

test('navigator forfeit preserves committed cards identically before and after priority closes', () => {
  const a = setup(); until(a, () => a.phase === 'priority' && a.window === 'during_navigation' && a.navigationResumePhase === 'navigator');
  const b = { ...snapshot(a), rng: seededFeedTheKrakenRng(42) };
  const navigator = a.navigatorId!; const chosen = a.offered[0]!; const discarded = a.offered[1]!;
  const captain = a.navigationCaptainId!;
  assert.deepEqual(forfeitFeedTheKrakenPlayer(a, navigator), { ok: true });
  until(a, () => a.currentCard?.id === chosen.id);
  until(b, () => b.phase === 'navigator');
  assert.deepEqual(forfeitFeedTheKrakenPlayer(b, navigator), { ok: true });
  for (const s of [a, b]) {
    assert.equal(s.currentCard?.id, chosen.id); assert.ok(s.players[captain]!.resume.some(c => c.id === chosen.id));
    assert.ok(s.discard.some(c => c.id === discarded.id)); assert.equal(s.players[navigator]!.departureReason, 'forfeit');
    validateFeedTheKrakenState(s);
    for (let i = 0; i < 1000 && s.status === 'playing'; i++) step(s);
    assert.equal(s.status, 'game_over'); assert.ok(!s.winnerIds.includes(navigator)); validateFeedTheKrakenState(s);
  }
});

test('conversion updates only new member and leader; ritual projection conceals actor', () => {
  const s = setup(11); const leader = s.order.find((id) => s.players[id]!.faction === 'cult_leader')!;
  const target = s.order.find((id) => s.players[id]!.faction === 'pirate')!; const oldPirates = [...s.players[target]!.knownPirateIds];
  s.phase = 'ritual'; s.window = null; s.ritual = 'conversion'; s.pendingPlayerId = leader; s.ritualPendingIds = [leader];
  const observer = s.order.find((id) => id !== leader && id !== target)!;
  assert.equal(toFeedTheKrakenPublicState(s).pendingPlayerId, null); assert.equal(toFeedTheKrakenPrivateState(s, observer).ritual, null);
  act(s, leader, { type: 'ritual', playerId: target }); assert.equal(s.players[target]!.faction, 'cultist');
  assert.equal(s.players[target]!.knownLeaderId, leader); assert.deepEqual(s.players[target]!.knownPirateIds, oldPirates);
  assert.equal(s.players[observer]!.observations.length, 0); assert.equal(s.players[leader]!.observations.at(-1)!.playerId, target);
});

test('cabin records current affiliation, grants immunity, preserves observation revision', () => {
  const s = setup(); currentCard(s, 'armed'); const target = s.lieutenantId!;
  s.players[target]!.faction = 'cultist'; s.phase = 'map_action'; s.window = null; s.mapAction = 'cabin'; s.pendingPlayerId = s.captainId;
  const captain = s.captainId; const revision = s.revision;
  act(s, captain, { type: 'target', playerId: target });
  assert.equal(s.players[target]!.conversionImmune, true); assert.deepEqual(s.players[captain]!.observations[0], { revision: revision + 1, kind: 'cabin', playerId: target, faction: 'cultist' });
  const leader = s.order.find((id) => s.players[id]!.faction === 'cult_leader')!;
  s.phase = 'ritual'; s.ritual = 'conversion'; s.pendingPlayerId = leader; s.ritualPendingIds = [leader];
  const before = snapshot(s); assert.equal(submitFeedTheKrakenAction(s, leader, { type: 'ritual', playerId: target }, s.revision).ok, false); assert.deepEqual(snapshot(s), before);
});

test('cult cabin search observes original chips, not later conversion', () => {
  const s = setup(); currentCard(s, 'uprising'); const leader = s.order.find((id) => s.players[id]!.faction === 'cult_leader')!;
  const target = s.navigationTeam.find((id) => id !== leader)!; const original = s.players[target]!.originalFaction; s.players[target]!.faction = 'cultist';
  const index = s.rituals.indexOf('cult_search'); [s.rituals[0], s.rituals[index]] = [s.rituals[index]!, s.rituals[0]!];
  s.phase = 'priority'; s.window = 'yellow'; s.priorityOrder = [s.captainId]; s.priorityIndex = 0; s.pendingPlayerId = s.captainId;
  act(s, s.captainId, { type: 'pass' });
  until(s, () => s.phase !== 'ritual');
  assert.equal(s.players[leader]!.observations.find((o) => o.playerId === target)!.faction, original);
});

test('feeding leader wins immediately, other feeding preserves secret faction', () => {
  for (const leaderTarget of [true, false]) {
    const s = setup(); currentCard(s, 'armed');
    const target = s.order.find((id) => id !== s.captainId && (s.players[id]!.faction === 'cult_leader') === leaderTarget);
    if (!target) continue;
    s.phase = 'map_action'; s.window = null; s.mapAction = 'feeding'; s.pendingPlayerId = s.captainId;
    act(s, s.captainId, { type: 'target', playerId: target }); assert.equal(s.players[target]!.aboard, false);
    assert.equal(s.players[target]!.forfeited, false);
    if (leaderTarget) { assert.equal(s.endReason, 'leader_fed'); assert.ok(s.winnerIds.includes(target)); }
    else assert.equal(toFeedTheKrakenPublicState(s).players.find((p) => p.playerId === target)!.faction, null);
  }
});

test('Archivist replaces a Smuggler hand with exactly two cards', () => {
  const s = setup(); until(s, () => s.phase === 'priority' && s.window === 'before_draw');
  s.effects.extraDraw = [s.captainId]; s.effects.redraw = [s.captainId];
  until(s, () => s.phase === 'navigation'); assert.equal(s.hands[s.captainId]!.length, 3);
  act(s, s.captainId, { type: 'submit_navigation', cardId: '', redraw: true }); assert.equal(s.hands[s.captainId]!.length, 2);
  assert.ok(!s.effects.redraw.includes(s.captainId)); validateFeedTheKrakenState(s);
});

test('tongueless votes count but cannot elect that voter captain', () => {
  const s = setup(); until(s, () => s.phase === 'mutiny'); const ids = s.order.filter((id) => id !== s.captainId);
  s.players[ids[0]!]!.tongueless = true;
  for (const id of ids) act(s, id, { type: 'bid', guns: id === ids[0] ? 3 : id === ids[1] ? 1 : 0 });
  const previousRound = s.round; until(s, () => s.round > previousRound); assert.equal(s.captainId, ids[1]); assert.equal(s.players[ids[0]!]!.guns, 0);
});

test('supply frontier refills once without reducing larger holdings', () => {
  const s = setup(); until(s, () => s.phase === 'navigator'); s.nodeId = '-2,4';
  const card = s.offered.find((c) => c.colour !== 'blue');
  if (!card) { const index = s.draw.findIndex((c) => c.colour === 'red'); [s.offered[0], s.draw[index]] = [s.draw[index]!, s.offered[0]!]; }
  const chosen = s.offered.find((c) => c.colour !== 'blue')!;
  const low = s.order[0]!; const high = s.order[1]!; s.supplyGuns += s.players[low]!.guns; s.players[low]!.guns = 0;
  s.supplyGuns -= 2; s.players[high]!.guns += 2;
  act(s, s.navigatorId!, { type: 'navigate', cardId: chosen.id });
  assert.equal(s.supplyCrossed, true); assert.equal(s.players[low]!.guns, 3); assert.ok(s.players[high]!.guns >= 4); validateFeedTheKrakenState(s);
});

test('invalid character payloads and obsolete simultaneous window revisions reject safely', () => {
  const s = setup(); const before = snapshot(s);
  assert.equal(submitFeedTheKrakenAction(s, s.pendingPlayerId!, { type: 'character', targets: null } as unknown as FeedTheKrakenAction, s.revision).ok, false);
  assert.equal(submitFeedTheKrakenAction(s, s.pendingPlayerId!, null as unknown as FeedTheKrakenAction, s.revision).ok, false); assert.deepEqual(snapshot(s), before);
  until(s, () => s.phase === 'mutiny'); const voter = s.order.find((id) => id !== s.captainId)!;
  assert.equal(submitFeedTheKrakenAction(s, voter, { type: 'bid', guns: 0 }, 0, s.windowId).ok, false);
});

test('conversion eligibility cannot identify the unknown initial Cultist', () => {
  const s = setup(11); const leader = s.order.find((id) => s.players[id]!.faction === 'cult_leader')!;
  const cultist = s.order.find((id) => s.players[id]!.faction === 'cultist')!;
  const sailor = s.order.find((id) => s.players[id]!.faction === 'sailor')!;
  s.phase = 'ritual'; s.window = null; s.ritual = 'conversion'; s.pendingPlayerId = leader; s.ritualPendingIds = [leader];
  const before = toFeedTheKrakenPrivateState(s, leader).legalTargetIds;
  [s.players[cultist]!.faction, s.players[sailor]!.faction] = [s.players[sailor]!.faction, s.players[cultist]!.faction];
  assert.deepEqual(toFeedTheKrakenPrivateState(s, leader).legalTargetIds, before);
  act(s, leader, { type: 'ritual', playerId: sailor }); assert.equal(s.players[sailor]!.faction, 'cultist'); assert.equal(s.players[sailor]!.knownLeaderId, leader);
});

test('Mentor cannot reset itself and priority cannot be stolen by packet arrival', () => {
  const s = setup(); const id = s.pendingPlayerId!; s.players[id]!.character = 'mentor';
  const before = snapshot(s); assert.equal(submitFeedTheKrakenAction(s, id, { type: 'character', targets: [id] }, s.revision).ok, false); assert.deepEqual(snapshot(s), before);
  const other = s.order.find((t) => t !== id)!; s.players[other]!.character = 'gunslinger';
  const after = snapshot(s); assert.equal(submitFeedTheKrakenAction(s, other, { type: 'character' }, s.revision).ok, false); assert.deepEqual(snapshot(s), after);
});

test('Drunk changes captain rather than re-electing the outgoing minimum', () => {
  const s = setup(); const outgoing = s.captainId; currentCard(s, 'drunk');
  s.phase = 'map_action'; s.window = null; s.mapAction = 'cabin'; s.pendingPlayerId = outgoing;
  const target = s.order.find((id) => id !== outgoing)!;
  act(s, outgoing, { type: 'target', playerId: target }); assert.notEqual(s.captainId, outgoing);
});

test('sole tongueless survivor cannot be assigned forbidden captaincy', () => {
  const s = setup(); const survivor = s.order.find((id) => id !== s.captainId)!; s.players[survivor]!.tongueless = true;
  for (const id of s.order.filter((id) => id !== survivor)) if (s.status === 'playing') forfeitFeedTheKrakenPlayer(s, id);
  assert.equal(s.status, 'game_over'); assert.equal(s.endReason, 'no_participants'); assert.deepEqual(s.winnerIds, []);
});

test('one and two aboard continue with printed random missing-office decisions', () => {
  for (const remaining of [1, 2, 3]) {
    const s = setup(); const keep = [s.captainId, ...s.order.filter((id) => id !== s.captainId)].slice(0, remaining);
    for (const id of s.order.filter((id) => !keep.includes(id))) assert.deepEqual(forfeitFeedTheKrakenPlayer(s, id), { ok: true });
    for (let i = 0; i < 1000 && s.status === 'playing'; i++) step(s);
    assert.equal(s.status, 'game_over'); assert.ok(s.winnerIds.every((id) => keep.includes(id))); validateFeedTheKrakenState(s);
  }
});

test('reserved revealed bids cannot be stolen or spent on an ability', () => {
  const s = setup(); const id = s.captainId; const target = s.order.find((t) => t !== id)!;
  s.players[id]!.character = 'kleptomaniac'; s.window = 'after_bids'; s.bids = { [target]: 3 }; s.bidsRevealed = true;
  act(s, id, { type: 'character', targets: [target] }); assert.equal(s.players[target]!.guns, 3); assert.equal(s.players[id]!.guns, 3);
  s.pendingPlayerId = target; s.players[target]!.character = 'gunsmith';
  assert.equal(submitFeedTheKrakenAction(s, target, { type: 'character' }, s.revision).ok, false);
});

test('Herbalist moves one sign, including onto an already off-duty seat', () => {
  const s = setup(); const actor = s.pendingPlayerId!; const others = s.order.filter((id) => id !== actor);
  s.players[actor]!.character = 'herbalist'; s.offDuty = [others[0]!, others[1]!];
  act(s, actor, { type: 'character', targets: [others[0]!, others[1]!] });
  assert.deepEqual(s.offDuty, [others[1], others[1]]);
});

test('later fatigue can invalidate an Adviser appointment without deadlocking', () => {
  const s = setup(); const target = s.order.find((id) => id !== s.captainId)!;
  s.effects.lieutenant = target; s.offDuty = [target];
  until(s, () => s.phase === 'appointment'); assert.equal(s.effects.lieutenant, null); step(s);
  assert.notEqual(s.lieutenantId, target);
});
