import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIXIT_CARD_IDS } from '@zuychin-arcade/types';
import {
  applyDixitAction, forfeitDixitPlayers, initDixitGame, type DixitServerState,
} from './engine.js';
import { toDixitPrivateState, toDixitPublicState } from './publicState.js';

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function game(count = 4, seed = 42): DixitServerState {
  return initDixitGame('TEST-GAME', Array.from({ length: count }, (_, index) => ({
    playerId: `p${index}`, displayName: `Player ${index}`,
  })), random(seed));
}

function act(state: DixitServerState, playerId: string, action: Parameters<typeof applyDixitAction>[2]): void {
  assert.deepEqual(applyDixitAction(state, playerId, action, state.revision), { ok: true });
}

function prepareVote(state: DixitServerState, storytellerId = state.storytellerId ?? 'p0'): void {
  act(state, storytellerId, {
    type: 'clue', cardId: state.players.get(storytellerId)!.hand[0]!, clue: 'Beyond the familiar',
  });
  for (const id of state.roundPlayers.filter(id => id !== storytellerId)) {
    const count = state.roundPlayers.length === 3 ? 2 : 1;
    act(state, id, { type: 'submit', cardIds: state.players.get(id)!.hand.slice(0, count) });
  }
  assert.equal(state.phase, 'vote');
}

function slotFor(state: DixitServerState, playerId: string, card = 0): number {
  return state.table.indexOf(state.submissions.get(playerId)![card]!) + 1;
}

function conserve(state: DixitServerState): void {
  const cards = [
    ...state.drawPile, ...state.discardPile, ...[...state.players.values()].flatMap(player => player.hand),
    ...[...state.submissions.values()].flat(),
  ];
  assert.equal(cards.length, 84);
  assert.deepEqual(cards.slice().sort(), [...DIXIT_CARD_IDS].sort());
  assert.equal(new Set(cards).size, cards.length);
}

test('2024 setup deals 6 cards, or 7 to each of three players', () => {
  for (let count = 3; count <= 12; count++) {
    const state = game(count);
    assert.equal(state.storytellerId, null);
    for (const player of state.players.values()) assert.equal(player.hand.length, count === 3 ? 7 : 6);
    conserve(state);
  }
  assert.throws(() => game(2));
  assert.throws(() => game(13));
  assert.throws(() => initDixitGame('TEST', [1, 2, 3].map(() => ({ playerId: 'same', displayName: 'same' }))));
});

test('first player with a clue becomes storyteller and later storytellers follow seat order', () => {
  const state = game();
  prepareVote(state, 'p2');
  for (const id of ['p0', 'p1', 'p3']) act(state, id, { type: 'vote', slots: [slotFor(state, 'p2'), slotFor(state, 'p2')] });
  for (const id of state.roundPlayers) act(state, id, { type: 'ready' });
  assert.equal(state.storytellerId, 'p3');
  assert.equal(state.roundNumber, 2);
  conserve(state);
});

test('all voting dials correct scores 4 per voter, not legacy edition 2', () => {
  const state = game();
  prepareVote(state);
  for (const id of ['p1', 'p2', 'p3']) act(state, id, { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.equal(state.result!.outcome, 'all');
  assert.deepEqual([...state.players.values()].map(p => p.score), [0, 4, 4, 4]);
});

test('no correct dial awards 2 to each voter plus uncapped decoy points', () => {
  const state = game();
  prepareVote(state);
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p2'), slotFor(state, 'p2')] });
  act(state, 'p2', { type: 'vote', slots: [slotFor(state, 'p1'), slotFor(state, 'p1')] });
  act(state, 'p3', { type: 'vote', slots: [slotFor(state, 'p1'), slotFor(state, 'p1')] });
  assert.equal(state.result!.outcome, 'none');
  assert.deepEqual([...state.players.values()].map(p => p.score), [0, 6, 4, 2]);
});

test('mixed votes award 3 per correct dial plus one per decoy dial', () => {
  const state = game();
  prepareVote(state);
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  act(state, 'p2', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p1')] });
  act(state, 'p3', { type: 'vote', slots: [slotFor(state, 'p1'), slotFor(state, 'p2')] });
  assert.equal(state.result!.outcome, 'some');
  assert.deepEqual([...state.players.values()].map(p => p.score), [3, 8, 4, 0]);
});

test('all players guessing at least once does not mean all dials are correct', () => {
  const state = game();
  prepareVote(state);
  for (const [id, decoy] of [['p1', 'p2'], ['p2', 'p3'], ['p3', 'p1']] as const) {
    act(state, id, { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, decoy)] });
  }
  assert.equal(state.result!.outcome, 'some');
  assert.equal(state.players.get('p0')!.score, 3);
});

test('three-player round exposes five cards and forbids both owned decoys as vote targets', () => {
  const state = game(3);
  prepareVote(state);
  assert.equal(state.table.length, 5);
  for (const card of [0, 1]) {
    assert.equal(applyDixitAction(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p1', card), slotFor(state, 'p0')] }, state.revision).ok, false);
  }
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p2', 0), slotFor(state, 'p2', 1)] });
  act(state, 'p2', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.equal(state.players.get('p2')!.score, 8);
  for (const id of state.roundPlayers) act(state, id, { type: 'ready' });
  for (const player of state.players.values()) assert.equal(player.hand.length, 7);
  conserve(state);
});

test('projections hide submissions, ownership and votes until each legal reveal', () => {
  const state = game();
  const secret = state.players.get('p0')!.hand[0]!;
  const peerHand = [...state.players.get('p1')!.hand];
  act(state, 'p0', { type: 'clue', cardId: secret, clue: 'A familiar dream' });
  let publicJson = JSON.stringify(toDixitPublicState(state));
  assert.ok(!publicJson.includes(secret));
  for (const card of peerHand) assert.ok(!publicJson.includes(card));
  assert.deepEqual(toDixitPrivateState(state, 'absent').hand, []);
  for (const id of ['p1', 'p2', 'p3']) act(state, id, { type: 'submit', cardIds: [state.players.get(id)!.hand[0]!] });
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  const frame = toDixitPublicState(state);
  assert.equal(frame.result, null);
  assert.ok(frame.table.every(card => !('playerId' in card)));
  assert.equal(toDixitPrivateState(state, 'p2').votes, null);
  assert.deepEqual(toDixitPrivateState(state, 'p1').votes, [slotFor(state, 'p0'), slotFor(state, 'p0')]);
  publicJson = JSON.stringify(frame);
  assert.ok(!publicJson.includes('storytellerCardId'));
  for (const id of ['p2', 'p3']) act(state, id, { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.equal(toDixitPublicState(state).result!.storytellerCardId, secret);
  const resultCopy = toDixitPublicState(state).result!;
  resultCopy.scores[0]!.total = 999;
  assert.notEqual(state.result!.scores[0]!.total, 999);
});

test('invalid and stale commands do not mutate state', () => {
  const state = game();
  const snapshot = () => JSON.stringify({ ...state, rng: undefined, players: [...state.players] });
  const before = snapshot();
  const cardId = state.players.get('p0')!.hand[0]!;
  assert.equal(applyDixitAction(state, 'p0', { type: 'clue', cardId, clue: 'late' }, 999).ok, false);
  assert.equal(applyDixitAction(state, 'absent', { type: 'clue', cardId, clue: 'wrong' }, 0).ok, false);
  for (const clue of ['', '  ', 'x'.repeat(241), 'hi\u0000there']) {
    assert.equal(applyDixitAction(state, 'p0', { type: 'clue', cardId, clue }, 0).ok, false);
  }
  assert.equal(applyDixitAction(state, 'p0', { type: 'clue', cardId: 'dream-wrong', clue: 'wrong' }, 0).ok, false);
  assert.equal(snapshot(), before);
  prepareVote(state);
  const revision = state.revision;
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.equal(applyDixitAction(state, 'p1', { type: 'vote', slots: [1, 1] }, revision).ok, false);
  assert.equal(applyDixitAction(state, 'p1', { type: 'vote', slots: [1, 1] }, state.revision).ok, false);
  assert.equal(applyDixitAction(state, 'p2', { type: 'vote', slots: [NaN, Infinity] }, state.revision).ok, false);
  conserve(state);
});

test('30-point ending selects every tied highest scorer, not only the triggering player', () => {
  const state = game();
  prepareVote(state);
  state.players.get('p1')!.score = 26;
  state.players.get('p2')!.score = 26;
  for (const id of ['p1', 'p2', 'p3']) act(state, id, { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.equal(state.status, 'game_over');
  assert.deepEqual(state.winnerIds, ['p1', 'p2']);
  assert.equal(applyDixitAction(state, 'p1', { type: 'ready' }, state.revision).ok, false);
  conserve(state);
});

test('forfeit cancels unfinished round, revokes private hand and adapts 4 players to 3', () => {
  const state = game();
  prepareVote(state);
  act(state, 'p1', { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.deepEqual(forfeitDixitPlayers(state, ['p0'], state.revision), { ok: true });
  assert.equal(state.phase, 'clue');
  assert.equal(state.storytellerId, 'p1');
  assert.equal(state.result, null);
  assert.deepEqual(toDixitPrivateState(state, 'p0').hand, []);
  assert.ok([...state.players.values()].every(p => p.score === 0));
  for (const id of ['p1', 'p2', 'p3']) assert.equal(state.players.get(id)!.hand.length, 7);
  assert.equal(state.players.get('p0')!.hand.length, 0);
  conserve(state);
});

test('forfeit after reveal preserves settled scores and continues without duplicated cards', () => {
  const state = game();
  prepareVote(state);
  for (const id of ['p1', 'p2', 'p3']) act(state, id, { type: 'vote', slots: [slotFor(state, 'p0'), slotFor(state, 'p0')] });
  assert.deepEqual(forfeitDixitPlayers(state, ['p2'], state.revision), { ok: true });
  assert.equal(state.players.get('p1')!.score, 4);
  assert.equal(state.players.get('p2')!.score, 4);
  assert.equal(state.players.get('p2')!.forfeited, true);
  conserve(state);
});

test('batched departures below three terminate without winner and preserve conservation', () => {
  const state = game();
  prepareVote(state);
  assert.deepEqual(forfeitDixitPlayers(state, ['p1', 'p2', 'p2'], state.revision), { ok: true });
  assert.equal(state.status, 'game_over');
  assert.equal(state.terminationReason, 'not_enough_players');
  assert.deepEqual(state.winnerIds, []);
  conserve(state);
});

test('200 seeded complete games cover every supported player count with conservation at every action', () => {
  for (let count = 3; count <= 12; count++) {
    for (let seed = 1; seed <= 20; seed++) {
      const state = game(count, seed);
      const voteRandom = random(seed * 53);
      let actions = 0;
      while (state.status !== 'game_over') {
        assert.ok(actions < 3000, `${count} players, seed ${seed} stalled`);
        if (state.phase === 'clue') {
          const id = state.storytellerId ?? state.roundPlayers[Math.floor(voteRandom() * count)]!;
          act(state, id, { type: 'clue', cardId: state.players.get(id)!.hand[0]!, clue: `Dream ${state.roundNumber}` });
        } else if (state.phase === 'submit') {
          const id = state.roundPlayers.find(id => !state.submissions.has(id))!;
          const amount = state.roundPlayers.length === 3 ? 2 : 1;
          act(state, id, { type: 'submit', cardIds: state.players.get(id)!.hand.slice(0, amount) });
        } else if (state.phase === 'vote') {
          const id = state.roundPlayers.find(id => id !== state.storytellerId && !state.votes.has(id))!;
          const legal = state.table.flatMap((card, index) => state.submissions.get(id)!.includes(card) ? [] : [index + 1]);
          act(state, id, { type: 'vote', slots: [legal[Math.floor(voteRandom() * legal.length)]!, legal[Math.floor(voteRandom() * legal.length)]!] });
        } else if (state.phase === 'reveal') {
          act(state, state.roundPlayers.find(id => !state.ready.has(id))!, { type: 'ready' });
        }
        actions++;
        conserve(state);
      }
      assert.ok(state.winnerIds.length > 0);
      assert.ok(state.winnerIds.every(id => state.players.get(id)!.score >= 30));
      assert.equal(state.terminationReason, null);
      assert.ok(state.log.length <= 60);
    }
  }
});

test('full games after departures never rank forfeited seats as winners', () => {
  const state = game(5);
  state.players.get('p4')!.score = 100;
  assert.deepEqual(forfeitDixitPlayers(state, ['p4'], state.revision), { ok: true });
  while (state.status !== 'game_over') {
    prepareVote(state);
    for (const id of state.roundPlayers.filter(id => id !== state.storytellerId)) {
      const correct = slotFor(state, state.storytellerId!);
      act(state, id, { type: 'vote', slots: [correct, correct] });
    }
    if (state.phase === 'reveal') for (const id of state.roundPlayers) act(state, id, { type: 'ready' });
    conserve(state);
  }
  assert.ok(!state.winnerIds.includes('p4'));
});

test('simultaneous voters may use one frame but replay and previous-round intents cannot cross rounds', () => {
  const state = game(12);
  prepareVote(state);
  const revision = state.revision;
  const roundNumber = state.roundNumber;
  const correct = slotFor(state, 'p0');
  for (const id of state.roundPlayers.filter(id => id !== 'p0')) {
    assert.deepEqual(applyDixitAction(state, id, { type: 'vote', slots: [correct, correct] }, revision, roundNumber), { ok: true });
  }
  const readyRevision = state.revision;
  for (const id of state.roundPlayers) {
    assert.deepEqual(applyDixitAction(state, id, { type: 'ready' }, readyRevision, roundNumber), { ok: true });
  }
  prepareVote(state);
  assert.equal(applyDixitAction(state, 'p2', { type: 'vote', slots: [1, 1] }, revision, roundNumber).ok, false);
  assert.equal(applyDixitAction(state, 'p2', { type: 'vote', slots: [1, 1] }, revision, state.roundNumber).ok, false);
});
