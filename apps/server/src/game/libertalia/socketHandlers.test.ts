import assert from 'node:assert/strict';
import test from 'node:test';
import { accepted, assertPrivacy, complete, harness, paired, rejected, start, step, until } from '../../../scripts/libertalia/protocolHarness.js';
import { roomStore } from '../../store/RoomStore.js';
import { io } from 'socket.io-client';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { validateLibertalia } from './engine.js';
import { toLibertaliaPrivateState } from './publicState.js';
import { isLibertaliaChoicePayload, isLibertaliaLootPayload, isLibertaliaSelectPayload, isLibertaliaStartPayload, buildLibertaliaResult } from './socketHandlers.js';

test('malformed start cannot initialise a game', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    clients[0]!.socket.emit('start_game', { unexpected: true });
    await until(() => clients[0]!.game !== null || clients[0]!.rejections.length > 0);
    assert.equal(clients[0]!.game, null, 'Malformed start mutated the room');
    assert.match(clients[0]!.rejections[0]!, /invalid/i);
  } finally { await h.close(); }
});

test('exact schemas reject missing, unsafe, duplicate and unknown fields', () => {
  for (const value of [null, [], true, '', 0, { x: 1 }]) assert.equal(isLibertaliaStartPayload(value), false);
  assert.ok(isLibertaliaStartPayload(undefined));
  assert.ok(isLibertaliaStartPayload({}));
  for (const revision of [undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
    assert.equal(isLibertaliaSelectPayload({ rank: 1, expectedRevision: revision }), false);
    assert.equal(isLibertaliaChoicePayload({ choiceId: 1, optionIds: [], expectedRevision: revision }), false);
    assert.equal(isLibertaliaLootPayload({ lootIndex: 0, expectedRevision: revision }), false);
  }
  assert.ok(isLibertaliaSelectPayload({ rank: 40, expectedRevision: 0 }));
  assert.ok(isLibertaliaChoicePayload({ choiceId: 1, optionIds: [], expectedRevision: 0 }));
  assert.equal(isLibertaliaChoicePayload({ choiceId: 1, optionIds: ['a', 'a'], expectedRevision: 0 }), false);
  assert.equal(isLibertaliaSelectPayload({ rank: 1, expectedRevision: 0, playerId: 'other' }), false);
  assert.equal(isLibertaliaLootPayload({ lootIndex: 0, expectedRevision: 0, x: 1 }), false);
});

test('malformed start does not prune an overdue reserved seat', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    const reservation = await h.join(clients[0]!.auth.roomCode, 'Reserved');
    const room = roomStore.get(reservation.roomCode)!;
    const seat = room.players.get(reservation.playerId)!;
    roomStore.clearPresenceTimer(seat);
    seat.reconnectDeadlineAt = Date.now() - 1;
    assert.match(await rejected(clients[0]!, 'start_game', { bad: true }), /invalid/i);
    assert.equal(room.players.has(reservation.playerId), true);
    assert.equal(room.game, null);
    assert.equal(room.status, 'lobby');
  } finally { await h.close(); }
});

test('password is exact, room is capped at six, and host authority is enforced', async () => {
  const h = await harness();
  try {
    const clients = await h.group(6, ' gale ');
    const host = clients[0]!;
    assert.equal(host.room!.maxPlayers, 6);
    assert.equal(host.room!.hasPassword, true);
    assert.equal((await h.request('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Wrong', password: 'gale' })).status, 403);
    assert.equal((await h.request('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Overflow', password: ' gale ' })).status, 409);
    assert.match(await rejected(clients[1]!, 'start_game', {}), /host/i);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, clients[1]!.auth.token)).status, 403);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[5]!.auth.playerId }, host.auth.token)).status, 200);
    await until(() => !clients[5]!.socket.connected);
    const remaining = clients.slice(0, 5);
    await start(remaining);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, host.auth.token)).status, 409);
    assert.match(await rejected(host, 'start_game', {}), /progress/i);
  } finally { await h.close(); }
});

test('unconnected reservations and solo host cannot start', async () => {
  const h = await harness();
  try {
    const host = await h.connect(await h.create());
    assert.match(await rejected(host, 'start_game', {}), /at least 2/i);
    await h.join(host.auth.roomCode, 'Reserved');
    assert.match(await rejected(host, 'start_game', {}), /connecting/i);
    assert.equal(host.game, null);
  } finally { await h.close(); }
});

test('invalid socket tokens and foreign-room REST authority are rejected', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    const stranger = await h.create('Stranger');
    assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, stranger.token)).status, 403);
    assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {})).status, 401);
    const socket = io(h.url, { transports: ['websocket'], auth: { token: 'invalid' }, reconnection: false, autoConnect: false });
    try {
      const error = new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      socket.connect();
      assert.match((await error).message, /INVALID_TOKEN/);
    } finally { socket.disconnect(); }
    assert.equal(clients[0]!.game, null);
  } finally { await h.close(); }
});

test('lobby host departure transfers start authority to a connected guest', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    const host = clients.shift()!;
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/leave`, {}, host.auth.token)).status, 200);
    await until(() => clients[0]!.room!.players.some((player) => player.playerId === clients[0]!.auth.playerId && player.isHost));
    await start(clients);
    assert.equal(clients[0]!.game!.players.length, 2);
  } finally { await h.close(); }
});

test('malformed choices and legacy loot cannot mutate or crash an active match', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    await start(clients);
    while (!clients.some((client) => client.mine!.pendingChoice)) assert.ok(await step(clients));
    const owner = clients.find((client) => client.mine!.pendingChoice)!;
    const before = owner.game!.revision;
    for (const payload of [null, [], {}, { choiceId: 1, optionIds: [] }, { choiceId: 1, optionIds: 'bad', expectedRevision: before }, { choiceId: 1, optionIds: ['a', 'a'], expectedRevision: before }]) {
      assert.match(await rejected(owner, 'libertalia:choice', payload), /invalid/i);
    }
    for (const payload of [null, {}, { lootIndex: -1, expectedRevision: before }, { lootIndex: 0 }, { lootIndex: 0, expectedRevision: before, extra: true }]) {
      assert.match(await rejected(owner, 'libertalia:loot', payload), /invalid/i);
    }
    assert.equal(owner.game!.revision, before);
    assert.ok(await step(clients));
  } finally { await h.close(); }
});

test('legacy loot endpoint remains owned, exact-revision and acknowledged', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    await start(clients);
    let steps = 0;
    while (!clients.some((client) => client.mine!.pendingChoice?.kind === 'loot_current')) {
      assert.ok(steps++ < 500);
      assert.ok(await step(clients));
    }
    const owner = clients.find((client) => client.mine!.pendingChoice?.kind === 'loot_current')!;
    const other = clients.find((client) => client !== owner)!;
    const payload = { lootIndex: 0, expectedRevision: owner.game!.revision };
    assert.match(await rejected(other, 'libertalia:loot', payload), /choice|available/i);
    const ack = await accepted(owner, 'libertalia:loot', payload, 'loot');
    await paired(clients, ack.revision);
    assert.match(await rejected(owner, 'libertalia:loot', payload), /changed|refresh|choice|available/i);
  } finally { await h.close(); }
});

test('secret selection, stale/duplicate commands and sender-only acknowledgements', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const actor = clients[0]!;
    const payload = { rank: actor.mine!.hand[0]!, expectedRevision: 0 };
    const ack = await accepted(actor, 'libertalia:select', payload, 'select');
    await paired(clients, ack.revision);
    assert.equal(ack.revision, 1);
    assert.equal(actor.mine!.selectedRank, payload.rank);
    for (const peer of clients.slice(1)) {
      assert.equal(peer.mine!.selectedRank, null);
      assert.equal(peer.acks.length, 0);
      assert.equal(peer.game!.island.length, 0);
      assertPrivacy(peer);
    }
    assert.match(await rejected(actor, 'libertalia:select', payload), /changed|refresh/i);
    assert.match(await rejected(clients[1]!, 'libertalia:select', { rank: clients[1]!.mine!.hand[0], expectedRevision: 0 }), /changed|refresh/i);
    assert.equal(actor.game!.revision, 1);
    for (const malformed of [null, [], {}, { rank: 1 }, { rank: 41, expectedRevision: 1 }, { rank: 1, expectedRevision: 1, rogue: true }]) {
      assert.match(await rejected(actor, 'libertalia:select', malformed), /invalid/i);
    }
    assert.equal(actor.game!.revision, 1);
  } finally { await h.close(); }
});

test('concurrent exact-revision selections accept one and safely reject the stale peer', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    await start(clients);
    clients.forEach((client) => client.socket.emit('libertalia:select', { rank: client.mine!.hand[0], expectedRevision: 0 }));
    await until(() => clients.reduce((n, client) => n + client.rejections.length, 0) === 1);
    await paired(clients, 1);
    assert.equal(clients.reduce((n, client) => n + client.acks.filter((ack) => ack.action === 'select').length, 0), 1);
    const retry = clients.find((client) => client.mine!.selectedRank === null)!;
    const ack = await accepted(retry, 'libertalia:select', { rank: retry.mine!.hand[0], expectedRevision: 1 }, 'select');
    await paired(clients, ack.revision);
  } finally { await h.close(); }
});

test('private choice survives session replacement and reconnect, foreign/replayed choices reject', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    while (!clients.some((client) => client.mine!.pendingChoice)) assert.ok(await step(clients));
    const old = clients.find((client) => client.mine!.pendingChoice)!;
    const index = clients.indexOf(old);
    const snapshot = JSON.parse(JSON.stringify(old.mine));
    const next = await h.connect(old.auth);
    clients[index] = next;
    await until(() => !old.socket.connected && next.mine !== null);
    assert.deepEqual(next.mine, snapshot);
    const choice = next.mine!.pendingChoice!;
    const foreign = clients.find((client) => client !== next)!;
    assert.equal(foreign.mine!.pendingChoice, null);
    const payload = { choiceId: choice.id, optionIds: choice.options.slice(0, Math.max(choice.min, 1)).map((option) => option.id), expectedRevision: next.game!.revision };
    assert.match(await rejected(foreign, 'libertalia:choice', payload), /choice|available/i);
    assert.match(await rejected(next, 'libertalia:choice', { ...payload, optionIds: ['invented'] }), /illegal/i);
    const ack = await accepted(next, 'libertalia:choice', payload, 'choice');
    await paired(clients, ack.revision);
    assert.match(await rejected(next, 'libertalia:choice', payload), /changed|refresh|available/i);
    next.socket.disconnect();
    const restored = await h.connect(next.auth);
    clients[index] = restored;
    await paired(clients, ack.revision);
    assertPrivacy(restored);
    assert.deepEqual(restored.mine, next.mine);
  } finally { await h.close(); }
});

for (const count of [2, 3, 4, 5, 6]) {
  test(`${count} seats: all three voyages plus full rematch from each seat's projections only`, async (t) => {
    const h = await harness();
    try {
      const clients = await h.group(count);
      await start(clients);
      const first = await complete(clients);
      assert.equal(clients[0]!.game!.voyage, 3);
      const finalRevision = clients[0]!.game!.revision;
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      assert.equal(room.game!.id, 'libertalia');
      if (room.game!.id !== 'libertalia') throw new Error('Wrong game');
      assert.equal(buildLibertaliaResult(room.game!.state)!.players.length, count);
      await start(clients);
      assert.equal(clients[0]!.game!.revision, finalRevision + 1);
      assert.match(await rejected(clients[0]!, 'libertalia:select', { rank: clients[0]!.mine!.hand[0], expectedRevision: 0 }), /changed|refresh/i);
      const second = await complete(clients);
      assert.equal(clients[0]!.game!.voyage, 3);
      const terminal = JSON.parse(JSON.stringify(clients[1]!.game));
      assert.match(await rejected(clients[0]!, 'libertalia:select', {
        rank: clients[0]!.mine!.hand[0] ?? 1, expectedRevision: terminal.revision,
      }), /crew|phase|over|selection/i);
      assert.deepEqual(clients[1]!.game, terminal);
      assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, clients[0]!.auth.token)).status, 200);
      clients[1]!.socket.emit('request_state');
      await until(() => clients[1]!.room!.players.length === count - 1);
      assert.deepEqual(clients[1]!.game, terminal, 'Completed participation changed on leave');
      t.diagnostic(`${count} seats: ${first}+${second} accepted gameplay commands`);
    } finally { await h.close(); }
  });
}

test('missing revision cannot commit a secret selection', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    const actor = clients[0]!;
    actor.socket.emit('start_game', {});
    await until(() => actor.game !== null && actor.mine !== null);
    const before = actor.game!.revision;
    actor.socket.emit('libertalia:select', { rank: actor.mine!.hand[0] });
    await until(() => actor.game!.revision !== before || actor.rejections.length > 0);
    assert.equal(actor.game!.revision, before, 'Missing revision mutated authoritative state');
    assert.match(actor.rejections[0]!, /invalid/i);
  } finally { await h.close(); }
});

function stateOf(roomCode: string) {
  const game = roomStore.get(roomCode)!.game;
  assert.equal(game?.id, 'libertalia');
  if (game?.id !== 'libertalia') throw new Error('Missing Libertalia game');
  return game.state;
}

test('selection REST forfeit retires without choosing fresh crew and preserves other locks', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await start(clients);
    const first = clients[0]!;
    const ack = await accepted(first, 'libertalia:select', { rank: first.mine!.hand[0], expectedRevision: 0 }, 'select');
    await paired(clients, ack.revision);
    const departed = clients.pop()!;
    const lock = first.mine!.selectedRank;
    assert.equal((await h.request(`/rooms/${first.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => first.game!.players.find((player) => player.playerId === departed.auth.playerId)!.forfeited);
    await paired(clients, first.game!.revision);
    assert.equal(first.mine!.selectedRank, lock);
    assert.equal(first.game!.phase, 'selection');
    assert.ok(!first.game!.turnOrder.includes(departed.auth.playerId));
    assert.equal(first.game!.players.length, 4);
    assert.equal(stateOf(first.auth.roomCode).players.get(departed.auth.playerId)!.selectedRank, null);
    const commands = await complete(clients);
    assert.ok(commands > 0);
    const result = buildLibertaliaResult(stateOf(first.auth.roomCode))!;
    assert.equal(result.players.length, 3);
    assert.ok(result.players.every((player) => player.playerId !== departed.auth.playerId));
    await start(clients);
    assert.equal(first.game!.players.length, 3, 'Rematch retained a departed seat');
  } finally { await h.close(); }
});

test('last unselected seat leaving reveals the already committed survivors without a ghost card', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const departed = clients[2]!;
    const hand = [...departed.mine!.hand];
    for (const client of clients.slice(0, 2)) {
      const ack = await accepted(client, 'libertalia:select', { rank: client.mine!.hand[0], expectedRevision: client.game!.revision }, 'select');
      await paired(clients, ack.revision);
    }
    assert.equal(clients[0]!.game!.phase, 'selection');
    assert.equal((await h.request(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => clients[0]!.game!.phase !== 'selection');
    await paired(clients.slice(0, 2), clients[0]!.game!.revision);
    const state = stateOf(departed.auth.roomCode);
    assert.equal(state.players.get(departed.auth.playerId)!.selectedRank, null);
    assert.deepEqual(state.players.get(departed.auth.playerId)!.hand, hand);
    assert.ok(state.island.every((card) => card.playerId !== departed.auth.playerId));
    assert.ok(state.island.every((card) => !card.neutral), 'Three-seat prepared voyage gained a midshipman early');
    assert.equal(state.turnOrder.length, 2);
  } finally { await h.close(); }
});

for (const cause of ['REST leave', 'short scheduled grace'] as const) {
  test(`revealed-day ${cause}: private choice settles, ghost retires before next day, 3-to-2 continues`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(3);
      await start(clients);
      while (!clients.some((client) => client.mine!.pendingChoice)) assert.ok(await step(clients));
      const departed = clients.find((client) => client.mine!.pendingChoice)!;
      const survivors = clients.filter((client) => client !== departed);
      const day = departed.game!.day;
      const revision = departed.game!.revision;
      const room = roomStore.get(departed.auth.roomCode)!;
      if (cause === 'REST leave') {
        assert.equal((await h.request(`/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 200);
      } else {
        markPlayerDisconnected(h.server, room, departed.auth.playerId, departed.socket.id!, 25);
        departed.socket.disconnect();
      }
      await until(() => survivors[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!.forfeited);
      await paired(survivors, survivors[0]!.game!.revision);
      assert.ok(survivors[0]!.game!.revision > revision);
      let commands = 0;
      while (survivors[0]!.game!.day === day) {
        assert.ok(commands++ < 100);
        assert.ok(await step(survivors));
      }
      const current = survivors[0]!.game!;
      assert.equal(current.status, 'playing');
      assert.equal(current.players.length, 3);
      assert.equal(current.voyagePlayerCount, 3, 'Prepared voyage mode changed mid-voyage');
      assert.ok(!current.turnOrder.includes(departed.auth.playerId));
      assert.equal(current.pendingPlayerId === departed.auth.playerId, false);
      for (const survivor of survivors) assertPrivacy(survivor);
      const remaining = await complete(survivors);
      assert.ok(remaining > 0);
      assert.equal(survivors[0]!.game!.voyagePlayerCount, 2);
      const result = buildLibertaliaResult(stateOf(room.roomCode))!;
      assert.equal(result.players.length, 2);
    } finally { await h.close(); }
  });
}

for (const trigger of ['command', 'request_state'] as const) {
  test(`delayed overdue seats are batched before ${trigger}`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(4);
      await start(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const departed = clients.slice(2);
      for (const client of departed) {
        const player = room.players.get(client.auth.playerId)!;
        roomStore.clearPresenceTimer(player);
        player.isConnected = false;
        player.reconnectDeadlineAt = Date.now() - 1;
      }
      if (trigger === 'command') {
        assert.match(await rejected(clients[0]!, 'libertalia:select', { rank: clients[0]!.mine!.hand[0], expectedRevision: 0 }), /changed|refresh/i);
      } else clients[0]!.socket.emit('request_state');
      const survivors = clients.slice(0, 2);
      await until(() => survivors[0]!.game!.players.filter((player) => player.forfeited).length === 2);
      await paired(survivors, survivors[0]!.game!.revision);
      assert.equal(survivors[0]!.mine!.selectedRank, null);
      assert.equal(survivors[0]!.game!.status, 'playing');
      assert.equal(survivors[0]!.game!.turnOrder.length, 2);
      for (const client of departed) assert.equal(room.players.get(client.auth.playerId)!.hasLeft, true);
    } finally { await h.close(); }
  });
}

test('one survivor wins once; finished REST leave cannot rewrite result eligibility', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    await start(clients);
    const host = clients[0]!;
    const survivor = clients[1]!;
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/leave`, {}, host.auth.token)).status, 200);
    await until(() => survivor.game!.status === 'game_over');
    const state = stateOf(host.auth.roomCode);
    assert.deepEqual(state.winnerPlayerIds, [survivor.auth.playerId]);
    assert.equal(state.endReason, 'forfeit');
    const result = buildLibertaliaResult(state);
    assert.equal(result!.players.length, 1);
    const revision = state.revision;
    assert.equal((await h.request(`/rooms/${survivor.auth.roomCode}/leave`, {}, survivor.auth.token)).status, 200);
    assert.deepEqual(buildLibertaliaResult(state), result);
    assert.equal(state.revision, revision);
    assert.equal(state.players.get(survivor.auth.playerId)!.forfeited, false);
  } finally { await h.close(); }
});

test('simultaneous scheduled overdue batch abandons without phantom winner or result', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    for (const client of clients) {
      const player = room.players.get(client.auth.playerId)!;
      roomStore.clearPresenceTimer(player);
      player.isConnected = false;
      player.reconnectDeadlineAt = Date.now() - 1;
    }
    const first = room.players.get(clients[0]!.auth.playerId)!;
    first.isConnected = true;
    markPlayerDisconnected(h.server, room, first.playerId, first.socketId, 0);
    await until(() => stateOf(room.roomCode).status === 'game_over');
    const state = stateOf(room.roomCode);
    assert.deepEqual(state.winnerPlayerIds, []);
    assert.ok([...state.players.values()].every((player) => player.forfeited));
    assert.equal(state.pendingChoice, null);
    assert.equal(room.status, 'finished');
    assert.equal(buildLibertaliaResult(state), null);
  } finally { await h.close(); }
});

test('actual default 30-second disconnect grace retains eligibility then forfeits without manual deadline changes', async (t) => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const departed = clients.pop()!;
    const room = roomStore.get(departed.auth.roomCode)!;
    const startAt = Date.now();
    departed.socket.disconnect();
    await until(() => !room.players.get(departed.auth.playerId)!.isConnected);
    const deadline = room.players.get(departed.auth.playerId)!.reconnectDeadlineAt!;
    assert.ok(deadline - startAt >= 29_900 && deadline - startAt <= 30_500);
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    assert.equal(stateOf(room.roomCode).players.get(departed.auth.playerId)!.forfeited, false);
    assert.ok(clients[0]!.game!.turnOrder.includes(departed.auth.playerId));
    await until(() => stateOf(room.roomCode).players.get(departed.auth.playerId)!.forfeited, 'normal reconnect expiry', 8_000);
    await until(() => clients[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!.forfeited);
    assert.ok(Date.now() >= deadline);
    assert.ok(!clients[0]!.game!.turnOrder.includes(departed.auth.playerId));
    assert.equal(clients[0]!.game!.players.length, 3);
    assert.equal(clients[0]!.game!.status, 'playing');
    t.diagnostic(`Default grace: 25-second eligible check, expiry observed at ${Date.now() - startAt}ms`);
  } finally { await h.close(); }
});

test('canonical archived ship cannot penalise a surviving sole rank34 owner at anchor', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const state = stateOf(clients[0]!.auth.roomCode);
    const deal = [7, 8, 10, 11, 12, 34];
    state.undealtCrew = Array.from({ length: 40 }, (_, index) => index + 1).filter((rank) => !deal.includes(rank));
    for (const player of state.players.values()) {
      player.hand = [...deal];
      player.dealtRanks = [...deal];
    }
    const owner = state.players.get(clients[0]!.auth.playerId)!;
    owner.ship = [7, 8, 34]; owner.hand = owner.hand.filter((rank) => !owner.ship.includes(rank));
    const archived = state.players.get(clients[2]!.auth.playerId)!;
    archived.ship = [34]; archived.hand = archived.hand.filter((rank) => rank !== 34);
    state.day = 4;
    validateLibertalia(state);
    const departed = clients.pop()!;
    assert.equal((await h.request(`/rooms/${state.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => clients[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!.forfeited);
    await paired(clients, clients[0]!.game!.revision);
    for (const client of clients) {
      const ack = await accepted(client, 'libertalia:select', { rank: 12, expectedRevision: client.game!.revision }, 'select');
      await paired(clients, ack.revision);
    }
    let actions = 0;
    while (!clients[0]!.mine!.pendingChoice?.options.some((option) => option.id === 'anchor:crew:34')) {
      assert.ok(actions++ < 80);
      assert.ok(await step(clients));
    }
    const pending = clients[0]!.mine!.pendingChoice!;
    const before = clients[0]!.game!.players.find((player) => player.playerId === owner.playerId)!.doubloons;
    const ack = await accepted(clients[0]!, 'libertalia:choice', { choiceId: pending.id, optionIds: ['anchor:crew:34'], expectedRevision: clients[0]!.game!.revision }, 'choice');
    await paired(clients, ack.revision);
    assert.equal(clients[0]!.game!.players.find((player) => player.playerId === owner.playerId)!.doubloons, before + 5);
    assert.ok(state.players.get(archived.playerId)!.ship.includes(34), 'Historical ship should remain visible');
    assert.ok(!state.turnOrder.includes(archived.playerId));
  } finally { await h.close(); }
});

for (const finish of ['reconnect and choose', 'forfeit nested choice'] as const) {
  test(`canonical Apprentice copies Scout: ${finish}, obsolete choice cannot resolve new slot`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(3);
      await start(clients);
      const state = stateOf(clients[0]!.auth.roomCode);
      const deal = [1, 2, 3, 4, 5, 6];
      state.undealtCrew = Array.from({ length: 40 }, (_, index) => index + 1).filter((rank) => !deal.includes(rank));
      for (const player of state.players.values()) { player.hand = [...deal]; player.dealtRanks = [...deal]; }
      const owner = state.players.get(clients[0]!.auth.playerId)!;
      owner.ship = [1]; owner.hand = owner.hand.filter((rank) => rank !== 1);
      validateLibertalia(state);
      for (const [index, client] of clients.entries()) {
        const ack = await accepted(client, 'libertalia:select', { rank: index === 0 ? 2 : 5, expectedRevision: client.game!.revision }, 'select');
        await paired(clients, ack.revision);
      }
      const actor = clients[0]!;
      const oldChoice = actor.mine!.pendingChoice!;
      assert.equal(oldChoice.kind, 'ship_character');
      const scout = oldChoice.options.find((option) => option.rank === 1)!;
      const payload = { choiceId: oldChoice.id, optionIds: [scout.id], expectedRevision: actor.game!.revision };
      const ack = await accepted(actor, 'libertalia:choice', payload, 'choice');
      await paired(clients, ack.revision);
      const nextChoice = actor.mine!.pendingChoice!;
      assert.equal(nextChoice.kind, 'hand_character');
      assert.notEqual(nextChoice.id, oldChoice.id);
      assert.ok(actor.mine!.graveyard.includes(1));
      clients.forEach(assertPrivacy);
      assert.match(await rejected(actor, 'libertalia:choice', payload), /changed|refresh/i);
      assert.match(await rejected(actor, 'libertalia:choice', { ...payload, expectedRevision: ack.revision }), /available/i);
      assert.equal(actor.game!.revision, ack.revision);
      if (finish === 'reconnect and choose') {
        actor.socket.disconnect();
        clients[0] = await h.connect(actor.auth);
        await paired(clients, ack.revision);
        assert.deepEqual(clients[0]!.mine!.pendingChoice, nextChoice);
        const choiceAck = await accepted(clients[0]!, 'libertalia:choice', {
          choiceId: nextChoice.id, optionIds: [nextChoice.options[0]!.id], expectedRevision: ack.revision,
        }, 'choice');
        await paired(clients, choiceAck.revision);
        assert.equal(clients[0]!.mine!.pendingChoice?.id === nextChoice.id, false);
      } else {
        assert.equal((await h.request(`/rooms/${state.roomCode}/leave`, {}, actor.auth.token)).status, 200);
        const survivors = clients.slice(1);
        await until(() => survivors[0]!.game!.players.find((player) => player.playerId === actor.auth.playerId)!.forfeited);
        await paired(survivors, survivors[0]!.game!.revision);
        let commands = 0;
        while (survivors[0]!.game!.day === 1) {
          assert.ok(commands++ < 100);
          assert.ok(await step(survivors));
        }
        assert.ok(!survivors[0]!.game!.turnOrder.includes(actor.auth.playerId));
        assert.equal(survivors[0]!.game!.pendingPlayerId === actor.auth.playerId, false);
        assert.equal(state.status, 'playing');
        validateLibertalia(state);
      }
    } finally { await h.close(); }
  });
}

test('canonical retired ship remains historical but is not a legal Gunner target or private actor', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    const state = stateOf(clients[0]!.auth.roomCode);
    const deal = [5, 7, 8, 10, 18, 21];
    state.undealtCrew = Array.from({ length: 40 }, (_, index) => index + 1).filter((rank) => !deal.includes(rank));
    for (const player of state.players.values()) { player.hand = [...deal]; player.dealtRanks = [...deal]; }
    const actor = state.players.get(clients[0]!.auth.playerId)!;
    actor.ship = [8]; actor.hand = actor.hand.filter((rank) => rank !== 8);
    const archived = state.players.get(clients[2]!.auth.playerId)!;
    archived.ship = [21]; archived.hand = archived.hand.filter((rank) => rank !== 21);
    validateLibertalia(state);
    const departed = clients.pop()!;
    assert.equal((await h.request(`/rooms/${state.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => clients[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!.forfeited);
    await paired(clients, clients[0]!.game!.revision);
    const privateArchive = toLibertaliaPrivateState(state, archived.playerId);
    assert.equal(privateArchive.canSelect, false);
    assert.equal(privateArchive.pendingChoice, null);
    for (const [index, client] of clients.entries()) {
      const ack = await accepted(client, 'libertalia:select', { rank: index === 0 ? 18 : 5, expectedRevision: client.game!.revision }, 'select');
      await paired(clients, ack.revision);
    }
    const pending = clients[0]!.mine!.pendingChoice!;
    assert.equal(pending.kind, 'ship_character');
    assert.ok(pending.options.length > 0);
    assert.ok(pending.options.every((option) => option.playerId !== archived.playerId));
    assert.deepEqual(clients[0]!.game!.players.find((player) => player.playerId === archived.playerId)!.ship, [21]);
    const before = clients[0]!.game!.revision;
    assert.match(await rejected(clients[0]!, 'libertalia:choice', {
      choiceId: pending.id, optionIds: [`ship:${archived.playerId}:21`], expectedRevision: before,
    }), /illegal/i);
    assert.equal(clients[0]!.game!.revision, before);
    assert.deepEqual(archived.ship, [21]);
  } finally { await h.close(); }
});
