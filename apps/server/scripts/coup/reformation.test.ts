import assert from 'node:assert/strict';
import { canTargetCoupPlayer, charactersForVariant, copiesPerCharacter, type CoupCharacter } from '@zuychin-arcade/types';
import { chooseAllegiance, chooseExchange, declareAction, decideExamine, expireWindow, forfeitPlayers, initGame, loseInfluence, resolveChallenge, respond, selectExamine, type CoupServerState, type EngineResult } from '../../src/game/coup/engine.js';
import { toPrivateState, toPublicState } from '../../src/game/coup/publicState.js';
import { isCoupAllegiancePayload, isCoupExaminePayload, isCoupExamineSelectPayload } from '../../src/game/coup/socketHandlers.js';

let checks = 0;
function ok(result: EngineResult) { assert.equal(result.ok, true, JSON.stringify(result)); checks++; }
function fresh(count = 4, choose = true) {
  const state = initGame('REFORM', 'reformation', Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })));
  if (choose) ok(chooseAllegiance(state, 'p0', 'reformist', state.revision));
  return state;
}
function reject(state: CoupServerState, call: () => EngineResult) {
  const snapshot = () => JSON.stringify({ ...state, players: [...state.players], pending: { ...state.pending, passed: [...state.pending.passed] } });
  const before = snapshot();
  assert.equal(call().ok, false);
  assert.equal(snapshot(), before);
  checks++;
}
function conservation(state: CoupServerState) {
  const cards = [...state.deck, ...[...state.players.values()].flatMap(p => p.influences.map(c => c.character))];
  if (state.pending.exchangePool) cards.push(...state.pending.exchangePool.slice(state.pending.exchangeKeep));
  for (const character of charactersForVariant(state.variant)) assert.equal(cards.filter(c => c === character).length, copiesPerCharacter(state.players.size));
  checks++;
}
function rig(state: CoupServerState, id: string, chars: CoupCharacter[]) {
  const player = state.players.get(id)!;
  for (let i = 0; i < chars.length; i++) {
    const card = player.influences[i]!;
    if (card.character === chars[i]) continue;
    const index = state.deck.indexOf(chars[i]!);
    if (index >= 0) {
      state.deck[index] = card.character;
    } else {
      const source = [...state.players.values()].filter(p => p.playerId !== id).flatMap(p => p.influences).find(c => c.character === chars[i]);
      assert.ok(source);
      source.character = card.character;
    }
    card.character = chars[i]!;
  }
}
function action(state: CoupServerState, name: Parameters<typeof declareAction>[2]['action'], targetPlayerId?: string) {
  ok(declareAction(state, state.pending.actorId, { action: name, ...(targetPlayerId ? { targetPlayerId } : {}), expectedRevision: state.revision }));
}
function pass(state: CoupServerState) {
  while (['awaiting_action_challenge', 'awaiting_block', 'awaiting_block_challenge'].includes(state.pending.phase)) {
    const playerId = toPublicState(state).pending.waitingOn[0]!;
    ok(respond(state, playerId, { response: 'pass', expectedRevision: state.revision }));
  }
}

for (let count = 2; count <= 10; count++) {
  const state = fresh(count, false);
  assert.equal(state.pending.phase, 'awaiting_allegiance');
  assert.ok([...state.players.values()].every(p => p.allegiance === null));
  reject(state, () => chooseAllegiance(state, 'p1', 'loyalist', state.revision));
  reject(state, () => chooseAllegiance(state, 'p0', 'loyalist', state.revision + 1));
  reject(state, () => declareAction(state, 'p0', { action: 'income', expectedRevision: state.revision }));
  ok(chooseAllegiance(state, 'p0', 'loyalist', state.revision));
  state.turnOrder.forEach((id, i) => assert.equal(state.players.get(id)!.allegiance, i % 2 ? 'reformist' : 'loyalist'));
  conservation(state);
}
{
  const state = fresh(4, false);
  ok(forfeitPlayers(state, ['p0', 'p1'], state.revision));
  assert.equal(state.pending.phase, 'awaiting_allegiance');
  assert.equal(state.pending.actorId, 'p2');
  ok(expireWindow(state, state.revision));
  assert.equal(state.players.get('p2')!.allegiance, 'reformist');
  assert.equal(state.players.get('p3')!.allegiance, 'loyalist');
  assert.ok(state.log.some(entry => entry.text.includes('timed out')));
}
for (const name of ['coup', 'assassinate', 'steal', 'inquisitor_examine'] as const) {
  const state = fresh();
  state.players.get('p0')!.coins = 7;
  reject(state, () => declareAction(state, 'p0', { action: name, targetPlayerId: 'p2', expectedRevision: state.revision }));
  action(state, name, 'p1');
}
{
  const state = fresh();
  action(state, 'foreign_aid');
  assert.deepEqual(toPublicState(state).pending.waitingOn, ['p1', 'p3']);
  reject(state, () => respond(state, 'p2', { response: 'block', blockCharacter: 'duke', expectedRevision: state.revision }));
  const allSame = fresh();
  for (const p of allSame.players.values()) p.allegiance = 'loyalist';
  assert.equal(canTargetCoupPlayer(allSame.variant, [...allSame.players.values()], 'p0', 'p2'), true);
  action(allSame, 'foreign_aid');
  assert.equal(toPublicState(allSame).pending.waitingOn.length, 3);
}
for (const target of [undefined, 'p0', 'p1', 'p2']) {
  const state = fresh();
  const cost = !target || target === 'p0' ? 1 : 2;
  const targetId = target ?? 'p0';
  const before = state.players.get(targetId)!.allegiance;
  action(state, 'convert', target);
  assert.equal(state.treasuryReserve, cost);
  assert.equal(state.players.get('p0')!.coins, 2 - cost);
  assert.notEqual(state.players.get(targetId)!.allegiance, before);
}
{
  const state = fresh();
  state.players.get('p0')!.coins = 1;
  reject(state, () => declareAction(state, 'p0', { action: 'convert', targetPlayerId: 'p1', expectedRevision: state.revision }));
  state.players.get('p0')!.coins = 10;
  reject(state, () => declareAction(state, 'p0', { action: 'convert', expectedRevision: state.revision }));
  state.players.get('p0')!.coins = 2;
  reject(state, () => declareAction(state, 'p0', { action: 'exchange', expectedRevision: state.revision }));
}
for (const hand of [['duke', 'duke'], ['duke', 'captain'], ['captain', 'contessa']] as CoupCharacter[][]) {
  for (const prove of [false, true]) {
    const state = fresh();
    rig(state, 'p0', hand);
    state.treasuryReserve = 5;
    action(state, 'embezzle');
    ok(respond(state, 'p1', { response: 'challenge', expectedRevision: state.revision }));
    if (prove && hand.includes('duke')) {
      reject(state, () => resolveChallenge(state, 'p0', true, state.revision));
      ok(expireWindow(state, state.revision));
    } else ok(resolveChallenge(state, 'p0', prove, state.revision));
    const loser = state.pending.losingPlayerId!;
    ok(loseInfluence(state, loser, state.players.get(loser)!.influences.find(c => !c.revealed)!.character, state.revision));
    assert.equal(state.treasuryReserve, prove && !hand.includes('duke') ? 0 : 5);
    conservation(state);
  }
}
{
  const state = fresh();
  rig(state, 'p0', ['duke', 'captain']);
  state.players.get('p0')!.influences[0]!.revealed = true;
  state.treasuryReserve = 3;
  action(state, 'embezzle');
  ok(respond(state, 'p1', { response: 'challenge', expectedRevision: state.revision }));
  ok(expireWindow(state, state.revision));
  assert.ok(state.log.some(entry => entry.text.includes('showing Captain')));
  ok(expireWindow(state, state.revision));
  assert.equal(state.treasuryReserve, 0);
  conservation(state);
}
function examine() {
  const state = fresh();
  action(state, 'inquisitor_examine', 'p1');
  pass(state);
  assert.equal(state.pending.phase, 'awaiting_examine_selection');
  return state;
}
for (const forceSwap of [false, true]) {
  const state = examine();
  rig(state, 'p1', ['captain', 'captain']);
  reject(state, () => selectExamine(state, 'p0', 'captain', state.revision));
  reject(state, () => selectExamine(state, 'p1', 'duke', state.revision));
  reject(state, () => selectExamine(state, 'p1', 'captain', state.revision - 1));
  ok(selectExamine(state, 'p1', 'captain', state.revision));
  assert.equal(toPrivateState(state, 'p0')!.examine!.character, 'captain');
  for (const id of ['p1', 'p2', 'p3']) assert.equal(toPrivateState(state, id)!.examine, null);
  assert.equal('examineCharacter' in toPublicState(state).pending, false);
  reject(state, () => decideExamine(state, 'p1', true, state.revision));
  reject(state, () => decideExamine(state, 'p0', true, state.revision - 1));
  const firstDraw = state.deck[0];
  ok(decideExamine(state, 'p0', forceSwap, state.revision));
  assert.equal(state.players.get('p1')!.influences[0]!.character, forceSwap ? firstDraw : 'captain');
  assert.equal(state.players.get('p1')!.influences[1]!.character, 'captain');
  assert.equal(toPrivateState(state, 'p0')!.examine, null);
  conservation(state);
}
{
  const state = examine();
  const before = state.players.get('p1')!.influences.map(c => c.character);
  ok(expireWindow(state, state.revision));
  ok(expireWindow(state, state.revision));
  assert.deepEqual(state.players.get('p1')!.influences.map(c => c.character), before);
}
for (const phase of ['allegiance', 'examine_select', 'examine', 'exchange', 'embezzle_challenge', 'embezzle_loss']) {
  for (let mask = 1; mask < 16; mask++) {
    const state = phase === 'allegiance' ? fresh(4, false) : phase.startsWith('examine') ? examine() : fresh();
    if (phase === 'examine') ok(expireWindow(state, state.revision));
    if (phase === 'exchange') { action(state, 'inquisitor_exchange'); pass(state); }
    if (phase.startsWith('embezzle')) {
      rig(state, 'p0', ['captain', 'contessa']);
      action(state, 'embezzle');
      ok(respond(state, 'p1', { response: 'challenge', expectedRevision: state.revision }));
      if (phase === 'embezzle_loss') ok(resolveChallenge(state, 'p0', true, state.revision));
    }
    const departing = state.turnOrder.filter((_, i) => mask & (1 << i));
    const revision = state.revision;
    ok(forfeitPlayers(state, departing, revision));
    assert.equal(state.revision, revision + 1);
    for (const id of departing) assert.equal(state.players.get(id)!.forfeited, true);
    for (let i = 0; state.status === 'playing' && state.pending.deadline !== null && i < 8; i++) ok(expireWindow(state, state.revision));
    assert.ok(!toPublicState(state).pending.waitingOn.some(id => departing.includes(id)));
    conservation(state);
  }
}
{
  const state = fresh();
  action(state, 'inquisitor_exchange'); pass(state);
  assert.equal(state.pending.exchangePool!.length, 3);
  ok(chooseExchange(state, 'p0', state.pending.exchangePool!.slice(0, 2), state.revision));
  conservation(state);
}
for (const [validator, valid] of [
  [isCoupAllegiancePayload, { allegiance: 'loyalist', expectedRevision: 0 }],
  [isCoupExamineSelectPayload, { character: 'duke', expectedRevision: 0 }],
  [isCoupExaminePayload, { forceSwap: false, expectedRevision: 0 }],
] as const) {
  assert.equal(validator(valid), true);
  for (const malformed of [null, [], {}, { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: '0' }, { ...valid, playerId: 'p0' }]) assert.equal(validator(malformed), false);
}
console.log(`Reformation regressions passed: ${checks} checked operations/invariants.`);

const originalRandom = Math.random;
let seed = 0xc0a72026;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
let games = 0;
try {
  for (let count = 2; count <= 10; count++) {
    for (let game = 0; game < 30; game++) {
      const state = fresh(count);
      for (let steps = 0; state.status === 'playing' && steps < 5000; steps++) {
        const pending = state.pending;
        const before = state.revision;
        if (pending.phase === 'awaiting_action') {
          const actor = state.players.get(pending.actorId)!;
          const targets = [...state.players.values()].filter(p => canTargetCoupPlayer(state.variant, [...state.players.values()], actor.playerId, p.playerId));
          const target = targets[Math.floor(Math.random() * targets.length)]!;
          if (actor.coins >= 7) action(state, 'coup', target.playerId);
          else {
            const options = ['income', 'foreign_aid', 'tax', 'inquisitor_exchange', 'embezzle', 'inquisitor_examine'] as const;
            const selected = options[Math.floor(Math.random() * options.length)]!;
            if (Math.random() < 0.12 && actor.coins >= 1) action(state, 'convert');
            else if (Math.random() < 0.12 && actor.coins >= 3) action(state, 'assassinate', target.playerId);
            else if (Math.random() < 0.12 && target.coins > 0) action(state, 'steal', target.playerId);
            else action(state, selected, selected === 'inquisitor_examine' ? target.playerId : undefined);
          }
        } else if (pending.phase === 'awaiting_action_challenge' || pending.phase === 'awaiting_block_challenge') {
          const responder = toPublicState(state).pending.waitingOn[0]!;
          ok(respond(state, responder, { response: Math.random() < 0.3 ? 'challenge' : 'pass', expectedRevision: state.revision }));
        } else if (pending.phase === 'awaiting_examine') ok(decideExamine(state, pending.actorId, Math.random() < 0.5, state.revision));
        else ok(expireWindow(state, state.revision));
        assert.equal(state.revision, before + 1);
        conservation(state);
        assert.ok([...state.players.values()].every(p => p.coins >= 0));
        assert.ok(!toPublicState(state).pending.waitingOn.some(id => state.players.get(id)!.eliminated));
      }
      assert.equal(state.status, 'game_over', `${count}-player Reformation game must terminate`);
      assert.equal([...state.players.values()].filter(p => !p.eliminated).length, 1);
      games++;
    }
  }
} finally { Math.random = originalRandom; }
console.log(`Reformation simulation passed: ${games} games across 2–10 players; ${checks} total checked operations/invariants.`);
