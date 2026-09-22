import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket } from 'socket.io-client';
import type { JoinRoomResponse, RoomPublicState, SaboteurPrivateState, SaboteurPublicState, Tool } from '@zuychin-arcade/types';
import { BOARD, getHandSize } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { supabase } from '../../lib/supabase.js';
import { roomStore } from '../../store/RoomStore.js';
import { validPlacements } from '../../../../mobile/lib/placement.js';
import { emitGameState, isChooseGoldPayload, isPassTurnPayload, isPlaceCardPayload, isPlayActionPayload, isSaboteurStartPayload, recoverDisconnectedSaboteurPlayers } from './socketHandlers.js';
import { initGoldDistribution } from './goldDistribution.js';

process.env.JWT_SECRET ??= 'saboteur-test-only-secret-32-bytes-local';

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: SaboteurPublicState | null;
  mine: SaboteurPrivateState | null;
}

async function waitUntil(predicate: () => boolean, description: string, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function harness() {
  assert.equal(supabase, null, 'Run Saboteur integration tests with Supabase credentials unset');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io, { events: { limit: 20_000, windowMs: 10_000 }, reactions: { limit: 100, windowMs: 5_000 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  const rooms = new Set<string>();
  async function post(route: string, payload: unknown, token?: string) {
    return fetch(`${url}${route}`, { method: 'POST', headers: {
      'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify(payload) });
  }
  async function connect(auth: JoinRoomResponse): Promise<Client> {
    const socket = createClient(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const client: Client = { auth, socket, room: null, game: null, mine: null };
    clients.push(client);
    socket.on('room_updated', room => { client.room = room; });
    socket.on('game_state', game => { client.game = game; });
    socket.on('private_state', mine => { client.mine = mine; });
    await waitUntil(() => socket.connected, 'socket connection');
    socket.emit('request_state');
    await waitUntil(() => client.room !== null, 'room projection');
    return client;
  }
  async function room(count = 3, password?: string): Promise<Client[]> {
    const response = await post('/rooms/create', { displayName: 'Miner 1', gameId: 'saboteur', password });
    assert.equal(response.status, 201);
    const auth = await response.json() as JoinRoomResponse;
    rooms.add(auth.roomCode);
    const seats = [await connect(auth)];
    for (let index = 1; index < count; index++) {
      const joined = await post('/rooms/join', { roomCode: auth.roomCode, displayName: `Miner ${index + 1}`, password });
      assert.equal(joined.status, 200);
      seats.push(await connect(await joined.json() as JoinRoomResponse));
    }
    return seats;
  }
  return { app, io, url, clients, rooms, post, connect, room, close: async () => {
    clients.forEach(client => client.socket.disconnect());
    rooms.forEach(roomCode => roomStore.delete(roomCode));
    await new Promise<void>(resolve => io.close(() => resolve()));
    await app.close();
  } };
}

async function outcome(client: Client, event: string, payload?: unknown): Promise<{ kind: string; reason?: string }> {
  const result = new Promise<{ kind: string; reason?: string }>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('action_rejected', rejected);
      client.socket.off('game_state', changed);
    };
    const rejected = (value: { reason: string }) => { cleanup(); resolve({ kind: 'rejected', reason: value.reason }); };
    const changed = () => { cleanup(); resolve({ kind: 'changed' }); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No outcome for ${event}`)); }, 5_000);
    client.socket.once('action_rejected', rejected);
    client.socket.once('game_state', changed);
  });
  client.socket.emit(event, payload);
  return result;
}

async function accepted(client: Client, event: string, payload: unknown): Promise<number> {
  const result = new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('saboteur:action_accepted', onAccepted);
      client.socket.off('action_rejected', onRejected);
    };
    const onAccepted = (value: { action: string; revision: number }) => {
      cleanup();
      if (value.action !== event) reject(new Error(`Expected ${event}, received ${value.action}`));
      else resolve(value.revision);
    };
    const onRejected = (value: { reason: string }) => { cleanup(); reject(new Error(`${event}: ${value.reason}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No acknowledgement for ${event}`)); }, 5_000);
    client.socket.once('saboteur:action_accepted', onAccepted);
    client.socket.once('action_rejected', onRejected);
  });
  client.socket.emit(event, payload);
  return result;
}

async function paired(clients: Client[], revision: number): Promise<void> {
  await waitUntil(() => clients.every(client => client.game?.revision === revision && client.mine?.revision === revision), 'paired revision');
}

async function start(clients: Client[]): Promise<number> {
  const revision = await accepted(clients[0]!, 'start_game', {});
  await paired(clients, revision);
  return revision;
}

function snapshot(client: Client): string {
  const state = roomStore.get(client.auth.roomCode)?.game;
  return JSON.stringify(state, (_key, value: unknown) => value instanceof Map ? [...value.entries()] : value);
}

function stateOf(client: Client) {
  const game = roomStore.get(client.auth.roomCode)?.game;
  assert.equal(game?.id, 'saboteur');
  return game.state;
}

test('Saboteur payload validators require plain bounded revisioned records', () => {
  assert(isSaboteurStartPayload(undefined));
  assert(isSaboteurStartPayload({}));
  for (const value of [null, [], false, new Date(), { forged: true }]) assert(!isSaboteurStartPayload(value));
  const cases: [(value: unknown) => boolean, Record<string, unknown>][] = [
    [isPlaceCardPayload, { cardId: 'path-1', position: { row: 1, col: 4 }, rotated: false }],
    [isPlayActionPayload, { cardId: 'action-1' }],
    [isPassTurnPayload, {}],
    [isChooseGoldPayload, { cardIndex: 0 }],
  ];
  for (const [validate, payload] of cases) {
    assert(validate({ ...payload, expectedRevision: 1 }));
    for (const revision of [undefined, null, -1, 1.2, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert(!validate({ ...payload, expectedRevision: revision }));
    for (const value of [undefined, null, [], true, new Date(), Object.create({ ...payload, expectedRevision: 1 })]) assert(!validate(value));
    assert(!validate({ ...payload, expectedRevision: 1, forged: true }));
  }
  for (const position of [{ row: -1, col: 4 }, { row: 9, col: 4 }, { row: 1, col: 1 }, { row: 1, col: 7 }, { row: 1.5, col: 4 }]) {
    assert(!isPlaceCardPayload({ cardId: 'path-1', position, rotated: false, expectedRevision: 1 }));
  }
  assert(!isChooseGoldPayload({ cardIndex: 10, expectedRevision: 1 }));
  assert(!isPassTurnPayload({ discardCardId: 'x'.repeat(500), expectedRevision: 1 }));
});

test('Saboteur malformed start is rejected without creating a game', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    assert.equal((await outcome(clients[0]!, 'start_game', { forged: true })).kind, 'rejected');
    assert.equal(roomStore.get(clients[0]!.auth.roomCode)!.game, null);
  } finally { await h.close(); }
});

test('Saboteur lobby commands receive an explicit rejection instead of hanging', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    for (const event of ['place_card', 'play_action', 'pass_turn', 'choose_gold']) {
      assert.match((await outcome(clients[0]!, event, { expectedRevision: 0 })).reason ?? '', /not started/i);
    }
    assert.equal(roomStore.get(clients[0]!.auth.roomCode)!.game, null);
  } finally { await h.close(); }
});

test('Saboteur missing revision cannot mutate a hand or advance the turn', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await outcome(clients[0]!, 'start_game', {});
    await waitUntil(() => clients.every(client => client.game !== null && client.mine !== null), 'game views');
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const hand = JSON.stringify(actor.mine!.hand);
    assert.equal((await outcome(actor, 'pass_turn', { discardCardId: actor.mine!.hand[0]!.id })).kind, 'rejected');
    assert.equal(JSON.stringify(actor.mine!.hand), hand);
  } finally { await h.close(); }
});

test('Saboteur password lobby enforces host, capacity, reservations and in-game fencing', async () => {
  const h = await harness();
  try {
    const clients = await h.room(10, 'mining');
    const host = clients[0]!;
    assert.equal(host.room!.maxPlayers, 10);
    assert.equal(host.room!.hasPassword, true);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Extra', password: 'bad' })).status, 403);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Extra', password: 'mining' })).status, 409);
    assert.match((await outcome(clients[1]!, 'start_game', {})).reason ?? '', /host/i);
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, clients[1]!.auth.token)).status, 403);
    await start(clients);
    assert.equal(host.game!.players.length, 10);
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /progress/i);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Extra', password: 'mining' })).status, 409);
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, host.auth.token)).status, 409);
  } finally { await h.close(); }
});

test('Saboteur start waits for reserved seats and respects host transfer', async () => {
  const h = await harness();
  try {
    const clients = await h.room(2);
    const host = clients[0]!;
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /3 connected/i);
    const joined = await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Reserved' });
    assert.equal(joined.status, 200);
    const reservation = await joined.json() as JoinRoomResponse;
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /connecting/i);
    clients.push(await h.connect(reservation));
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/leave`, {}, host.auth.token)).status, 200);
    await waitUntil(() => clients[1]!.room!.players.some(player => player.isHost && player.playerId !== host.auth.playerId), 'host transfer');
    const newHostId = clients[1]!.room!.players.find(player => player.isHost)!.playerId;
    const newHost = clients.find(client => client.auth.playerId === newHostId)!;
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: reservation.playerId }, host.auth.token)).status, 403);
    const replacement = await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Replacement' });
    clients.push(await h.connect(await replacement.json() as JoinRoomResponse));
    const active = clients.filter(client => client !== host);
    await paired(active, await accepted(newHost, 'start_game', {}));
    assert(!newHost.game!.players.some(player => player.playerId === host.auth.playerId));
  } finally { await h.close(); }
});

test('Saboteur rejects malformed and out-of-turn commands without mutations', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const before = snapshot(actor);
    for (const event of ['place_card', 'play_action', 'pass_turn', 'choose_gold']) {
      for (const payload of [null, [], false, 'payload', { expectedRevision: actor.game!.revision, forged: true }]) {
        assert.equal((await outcome(actor, event, payload)).kind, 'rejected');
        assert.equal(snapshot(actor), before);
      }
    }
    const other = clients.find(client => client !== actor)!;
    assert.equal((await outcome(other, 'pass_turn', { discardCardId: other.mine!.hand[0]!.id, expectedRevision: actor.game!.revision })).kind, 'rejected');
    assert.equal(snapshot(actor), before);
    assert.equal((await fetch(`${h.url}/health`)).status, 200);
  } finally { await h.close(); }
});

test('Saboteur duplicate and stale commands commit once and acknowledge only the actor', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const payload = { discardCardId: actor.mine!.hand[0]!.id, expectedRevision: actor.game!.revision };
    const before = snapshot(actor);
    assert.match((await outcome(actor, 'pass_turn', { ...payload, expectedRevision: payload.expectedRevision + 1 })).reason ?? '', /state changed/i);
    assert.equal(snapshot(actor), before);
    const acks: unknown[] = [];
    clients.filter(client => client !== actor).forEach(client => client.socket.on('saboteur:action_accepted', ack => acks.push(ack)));
    const revision = await accepted(actor, 'pass_turn', payload);
    await paired(clients, revision);
    assert.equal(revision, payload.expectedRevision + 1);
    const after = snapshot(actor);
    assert.match((await outcome(actor, 'pass_turn', payload)).reason ?? '', /state changed/i);
    assert.equal(snapshot(actor), after);
    assert.deepEqual(acks, []);
  } finally { await h.close(); }
});

function assertPrivacy(client: Client): void {
  const game = client.game!;
  const mine = client.mine!;
  assert.equal(game.revision, mine.revision);
  assert.equal(mine.playerId, client.auth.playerId);
  assert.equal(game.roomCode, client.auth.roomCode);
  assert.equal(mine.roomCode, client.auth.roomCode);
  assert.equal(game.gameId, 'saboteur');
  assert.equal(mine.gameId, 'saboteur');
  for (const player of game.players) {
    assert(!('hand' in player));
    assert(!('role' in player));
    assert(!('peekedGoals' in player));
    if (game.status !== 'game_over') assert.equal(player.goldCollected, null);
  }
  for (const goal of game.goals) if (!goal.revealed) assert.equal(goal.isGold, null);
  if (game.status === 'playing') assert.equal(game.revealedRoles, null);
  if (game.goldDistribution?.currentPickerId !== mine.playerId) assert.equal(mine.availableGoldCards, null);
  else assert.equal(mine.availableGoldCards?.length, game.goldDistribution.availableCardCount);
  assert(!JSON.stringify(game).includes('availableGoldCards'));
  assert.equal(game.deckSize + game.discardSize + game.players.reduce((sum, player) => sum + player.handSize, 0)
    + game.board.filter(placed => placed.card.subtype === 'tunnel').length, 67, 'all playable cards remain accounted for');
}

function seedDraft(clients: Client[], io: Server): void {
  const state = stateOf(clients[0]!);
  [...state.players.values()].forEach((player, index) => { player.role = index === clients.length - 1 ? 'saboteur' : 'miner'; });
  state.status = 'round_end';
  state.roundWinner = 'miners';
  state.lastPlacerId = clients[0]!.auth.playerId;
  state.goldDistribution = initGoldDistribution(state.players, state.turnOrder, state.lastPlacerId, state.goldDeck);
  state.revision++;
  emitGameState(io, roomStore.get(clients[0]!.auth.roomCode)!);
}

for (const method of ['leave', 'expiry'] as const) {
  for (const phase of ['playing', 'gold_picker', 'gold_waiter', 'round_pause'] as const) {
    test(`Saboteur ${method} removes a seat immediately during ${phase}, without automatic play or gold`, async () => {
      const h = await harness();
      try {
        const clients = await h.room(5);
        await start(clients);
        const state = stateOf(clients[0]!);
        if (phase !== 'playing') {
          seedDraft(clients, h.io);
          await paired(clients, state.revision);
        }
        if (phase === 'round_pause') {
          while (clients[0]!.game!.goldDistribution?.currentPickerId) {
            const picker = clients.find(client => client.auth.playerId === clients[0]!.game!.goldDistribution!.currentPickerId)!;
            await paired(clients, await accepted(picker, 'choose_gold', { cardIndex: 0, expectedRevision: picker.game!.revision }));
          }
          assert(roomStore.get(clients[0]!.auth.roomCode)!.timer);
        }
        const departedId = phase === 'playing'
          ? clients[0]!.game!.currentTurnPlayerId!
          : phase === 'gold_picker' ? clients[0]!.game!.goldDistribution!.currentPickerId!
            : phase === 'gold_waiter' ? state.goldDistribution!.order[1]!
              : clients[0]!.auth.playerId;
        const departed = clients.find(client => client.auth.playerId === departedId)!;
        const survivors = clients.filter(client => client !== departed);
        const room = roomStore.get(departed.auth.roomCode)!;
        const revision = state.revision;
        const goldBefore = state.players.get(departedId)!.goldCollected;
        const deckBefore = state.deck.length;
        const actorBefore = state.lastActorId;
        if (method === 'leave') {
          assert.equal((await h.post(`/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 200);
        } else {
          assert(markPlayerDisconnected(h.io, room, departedId, departed.socket.id!, 0));
        }
        await waitUntil(() => survivors.every(client => client.game!.revision > revision && client.game!.revision === client.mine!.revision), 'forfeit projection');
        assert.equal(state.players.get(departedId)!.forfeited, true);
        assert.equal(state.players.get(departedId)!.hand.length, 0);
        assert.equal(state.players.get(departedId)!.goldCollected, goldBefore, 'departure grants no new gold');
        assert.equal(state.deck.length, deckBefore, 'departure never draws a turn card');
        assert.equal(state.lastActorId, actorBefore, 'departure is not an automatic card play');
        assert.notEqual(survivors[0]!.game!.currentTurnPlayerId, departedId);
        assert.notEqual(survivors[0]!.game!.goldDistribution?.currentPickerId, departedId);
        survivors.forEach(assertPrivacy);
        const before = snapshot(survivors[0]!);
        const player = room.players.get(departedId)!;
        assert.equal(markPlayerDisconnected(h.io, room, departedId, 'obsolete-socket', 0), false);
        assert.equal(snapshot(survivors[0]!), before);
        assert.equal(player.hasLeft, true);
        assert.equal((await h.post(`/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 403);
      } finally { await h.close(); }
    });
  }
}

for (const method of ['leave', 'expiry'] as const) {
  for (const phase of ['playing', 'gold_picker', 'round_pause', 'final_draft'] as const) {
    test(`Saboteur ${method} below three abandons immediately during ${phase} with no winner or timer`, async () => {
      const h = await harness();
      try {
        const clients = await h.room(3);
        await start(clients);
        const state = stateOf(clients[0]!);
        if (phase !== 'playing') {
          seedDraft(clients, h.io);
          if (phase === 'final_draft') state.round = 3;
          emitGameState(h.io, roomStore.get(clients[0]!.auth.roomCode)!);
          await paired(clients, state.revision);
        }
        if (phase === 'round_pause') {
          while (clients[0]!.game!.goldDistribution?.currentPickerId) {
            const picker = clients.find(client => client.auth.playerId === clients[0]!.game!.goldDistribution!.currentPickerId)!;
            await paired(clients, await accepted(picker, 'choose_gold', { cardIndex: 0, expectedRevision: picker.game!.revision }));
          }
        }
        const departed = clients[0]!;
        const room = roomStore.get(departed.auth.roomCode)!;
        const beforeRevision = state.revision;
        const scores = [...state.players.values()].map(player => player.goldCollected);
        if (method === 'leave') assert.equal((await h.post(`/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 200);
        else assert(markPlayerDisconnected(h.io, room, departed.auth.playerId, departed.socket.id!, 0));
        await waitUntil(() => clients[1]!.game!.status === 'game_over', 'abandoned public state');
        await paired(clients.slice(1), state.revision);
        assert.equal(state.revision, beforeRevision + 1);
        assert.equal(state.status, 'game_over');
        assert.equal(state.terminationReason, 'not_enough_players');
        assert.deepEqual(state.winnerIds, []);
        assert.equal(room.status, 'finished');
        assert.equal(room.timer, null);
        assert.equal(state.goldDistribution, null);
        assert.deepEqual([...state.players.values()].map(player => player.goldCollected), scores);
        assert.equal(recoverDisconnectedSaboteurPlayers(h.io, room), false);
        clients.slice(1).forEach(assertPrivacy);
        const newHost = clients.slice(1).find(client => client.auth.playerId === room.hostPlayerId)!;
        assert.match((await outcome(newHost, 'start_game', {})).reason ?? '', /3 connected/i);
      } finally { await h.close(); }
    });
  }
}

test('Saboteur simultaneous expiry forfeits every overdue seat once before abandonment', async () => {
  const h = await harness();
  try {
    const clients = await h.room(5);
    await start(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = stateOf(clients[0]!);
    const revision = state.revision;
    for (const client of clients) assert(markPlayerDisconnected(h.io, room, client.auth.playerId, client.socket.id!, 0));
    await waitUntil(() => state.status === 'game_over', 'batch expiry');
    assert([...state.players.values()].every(player => player.forfeited && player.hand.length === 0));
    assert.deepEqual(state.winnerIds, []);
    assert.equal(state.revision, revision + 1, 'expiry batch commits once');
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.equal(room.timer, null);
    assert.equal(recoverDisconnectedSaboteurPlayers(h.io, room), false);
  } finally { await h.close(); }
});

test('Saboteur final round timer settles overdue presence before declaring any winner', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const state = stateOf(clients[0]!);
    seedDraft(clients, h.io);
    state.round = 3;
    emitGameState(h.io, roomStore.get(clients[0]!.auth.roomCode)!);
    await paired(clients, state.revision);
    while (clients[0]!.game!.goldDistribution?.currentPickerId) {
      const picker = clients.find(client => client.auth.playerId === clients[0]!.game!.goldDistribution!.currentPickerId)!;
      await paired(clients, await accepted(picker, 'choose_gold', { cardIndex: 0, expectedRevision: picker.game!.revision }));
    }
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    // Model the round timer running before an already-due presence timer.
    const departed = room.players.get(clients[0]!.auth.playerId)!;
    departed.isConnected = false;
    departed.reconnectDeadlineAt = Date.now() - 1;
    await waitUntil(() => state.status === 'game_over', 'real final round timer', 15_000);
    assert.equal(state.players.get(departed.playerId)!.forfeited, true);
    assert(!state.winnerIds!.includes(departed.playerId));
    assert.equal(room.status, 'finished');
  } finally { await h.close(); }
});

test('Saboteur a final-card command cannot award round gold to an already-overdue seat', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const state = stateOf(clients[0]!);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const departed = clients.find(client => client !== actor)!;
    const lastCard = state.players.get(actor.auth.playerId)!.hand.pop()!;
    state.discard.push(...state.deck.splice(0));
    for (const player of state.players.values()) {
      state.discard.push(...player.hand.splice(0));
      player.role = player.playerId === departed.auth.playerId ? 'saboteur' : 'miner';
    }
    state.players.get(actor.auth.playerId)!.hand.push(lastCard);
    state.revision++;
    const room = roomStore.get(actor.auth.roomCode)!;
    emitGameState(h.io, room);
    await paired(clients, state.revision);
    const expired = room.players.get(departed.auth.playerId)!;
    expired.isConnected = false;
    expired.reconnectDeadlineAt = Date.now() - 1;
    await assert.rejects(accepted(actor, 'pass_turn', { discardCardId: lastCard.id, expectedRevision: actor.game!.revision }), /state changed/i);
    await waitUntil(() => state.players.get(departed.auth.playerId)!.forfeited, 'overdue forfeit');
    assert.equal(state.players.get(departed.auth.playerId)!.goldCollected, 0);
    assert.equal(state.players.get(actor.auth.playerId)!.hand[0]!.id, lastCard.id);
  } finally { await h.close(); }
});

test('Saboteur survivors finish all rounds without departed rewards, then start a pruned rematch', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const departed = clients[3]!;
    const room = roomStore.get(departed.auth.roomCode)!;
    const state = stateOf(departed);
    const revision = state.revision;
    assert.equal((await h.post(`/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    const survivors = clients.slice(0, 3);
    await waitUntil(() => survivors.every(client => client.game!.revision > revision), 'departure committed');
    await paired(survivors, state.revision);
    const result = await fullMatch(survivors);
    assert.equal(state.players.get(departed.auth.playerId)!.goldCollected, 0);
    assert(!state.winnerIds!.includes(departed.auth.playerId));
    await start(survivors);
    assert.equal(survivors[0]!.game!.players.length, 3);
    assert(!survivors[0]!.game!.players.some(player => player.playerId === departed.auth.playerId));
    console.log(`Saboteur survivor match: ${result.actions} accepted decisions, three rounds, departed seat excluded from rematch`);
  } finally { await h.close(); }
});

test('Saboteur private views survive replacement and reconnect without leaking to other seats', async () => {
  const h = await harness();
  try {
    const clients = await h.room(3);
    await start(clients);
    clients.forEach(assertPrivacy);
    clients.forEach(client => assert.equal(client.mine!.hand.length, getHandSize(3)));
    const original = clients[1]!;
    const saved = original.mine;
    let replaced = false;
    original.socket.once('session_replaced', () => { replaced = true; });
    const restored = await h.connect(original.auth);
    await waitUntil(() => replaced && !original.socket.connected && restored.mine !== null, 'replacement');
    assert.deepEqual(restored.mine, saved);
    restored.socket.disconnect();
    await waitUntil(() => !roomStore.get(original.auth.roomCode)!.players.get(original.auth.playerId)!.isConnected, 'presence');
    const reconnected = await h.connect(original.auth);
    await waitUntil(() => reconnected.mine !== null, 'private recovery');
    assert.deepEqual(reconnected.mine, saved);
    assertPrivacy(reconnected);
  } finally { await h.close(); }
});

test('Saboteur temporary active-player disconnect preserves turn, hand and revision until reconnect', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const saved = actor.mine;
    const before = snapshot(actor);
    actor.socket.disconnect();
    const room = roomStore.get(actor.auth.roomCode)!;
    await waitUntil(() => !room.players.get(actor.auth.playerId)!.isConnected, 'active seat disconnected');
    assert.equal(recoverDisconnectedSaboteurPlayers(h.io, room), false);
    assert.equal(snapshot(actor), before);
    const other = clients.find(client => client !== actor)!;
    assert.match((await outcome(other, 'pass_turn', { discardCardId: other.mine!.hand[0]!.id, expectedRevision: other.game!.revision })).reason ?? '', /not your turn/i);
    const restored = await h.connect(actor.auth);
    await waitUntil(() => restored.mine !== null, 'active seat restored');
    assert.deepEqual(restored.mine, saved);
    assert.equal(restored.game!.currentTurnPlayerId, actor.auth.playerId);
    assert.equal(room.players.get(actor.auth.playerId)!.hasLeft, false);
  } finally { await h.close(); }
});

test('Saboteur explicitly departed credentials cannot reconnect to a forfeited seat', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const departed = clients[3]!;
    assert.equal((await h.post(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    const socket = createClient(h.url, { auth: { token: departed.auth.token }, transports: ['websocket'], forceNew: true, reconnection: false });
    try {
      let denied = false;
      let privateEvents = 0;
      socket.on('server_error', () => { denied = true; });
      socket.on('private_state', () => { privateEvents++; });
      await waitUntil(() => denied && !socket.connected, 'departed token rejected');
      assert.equal(privateEvents, 0);
    } finally { socket.disconnect(); }
  } finally { await h.close(); }
});

test('Saboteur invalid tokens, foreign-room authority and non-Saboteur events stay isolated', async () => {
  const h = await harness();
  try {
    for (const token of ['', 'invalid.jwt.value']) {
      const socket = createClient(h.url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
      try {
        const message = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Missing invalid-token error')), 3_000);
          socket.once('connect_error', error => { clearTimeout(timer); resolve(error.message); });
        });
        assert.equal(message, 'INVALID_TOKEN');
        assert.equal(socket.connected, false);
      } finally { socket.disconnect(); }
    }
    const clients = await h.room();
    const foreign = await h.room();
    assert.equal((await h.post(`/rooms/${clients[0]!.auth.roomCode}/kick`, { targetPlayerId: clients[1]!.auth.playerId }, foreign[0]!.auth.token)).status, 403);
    await start(clients);
    const before = snapshot(clients[0]!);
    clients[0]!.socket.emit('bang:end-turn', { expectedRevision: clients[0]!.game!.revision });
    clients[0]!.socket.emit('coup:action', { type: 'income' });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(snapshot(clients[0]!), before);
    assert.equal(roomStore.get(clients[0]!.auth.roomCode)!.game!.id, 'saboteur');
  } finally { await h.close(); }
});

test('Saboteur capped-board wire commands reject every outside boundary without consuming cards', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const before = snapshot(actor);
    for (const position of [{ row: -1, col: 4 }, { row: 9, col: 4 }, { row: 1, col: 1 }, { row: 1, col: 7 }]) {
      assert.equal((await outcome(actor, 'place_card', { cardId: 'path-0', position, rotated: false, expectedRevision: actor.game!.revision })).kind, 'rejected');
      assert.equal(snapshot(actor), before);
    }
  } finally { await h.close(); }
});

test('Saboteur canonical Map fixture reveals goal identity and paths only to its owner, including reconnect', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const state = stateOf(actor);
    const actorHand = state.players.get(actor.auth.playerId)!.hand;
    const pools = [state.deck, ...[...state.players.values()].map(player => player.hand)];
    const source = pools.find(cards => cards.some(card => card.type === 'action' && card.subtype === 'map'))!;
    const sourceIndex = source.findIndex(card => card.type === 'action' && card.subtype === 'map');
    const card = source[sourceIndex]!;
    if (source !== actorHand) [source[sourceIndex], actorHand[0]] = [actorHand[0]!, card];
    state.revision++;
    emitGameState(h.io, roomStore.get(actor.auth.roomCode)!);
    await paired(clients, state.revision);
    const otherBefore = clients.filter(client => client !== actor).map(client => client.mine!.peekedGoals);
    await paired(clients, await accepted(actor, 'play_action', { cardId: card.id, targetPosition: actor.game!.goals[0]!.position, expectedRevision: actor.game!.revision }));
    assert.equal(actor.mine!.peekedGoals.length, 1);
    assert.deepEqual(actor.mine!.peekedGoals[0]!.edges, state.goals[0]!.card.edges);
    assert.equal(actor.game!.goals[0]!.isGold, null);
    assert(!actor.game!.board.some(placed => placed.card.id === state.goals[0]!.card.id));
    assert.deepEqual(clients.filter(client => client !== actor).map(client => client.mine!.peekedGoals), otherBefore);
    const restored = await h.connect(actor.auth);
    await waitUntil(() => restored.mine !== null, 'map reconnect');
    assert.deepEqual(restored.mine!.peekedGoals, actor.mine!.peekedGoals);
    assertPrivacy(restored);
  } finally { await h.close(); }
});

test('Saboteur second Map on the same hidden goal consumes a turn without duplicating or leaking knowledge', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
    const state = stateOf(actor);
    const actorHand = state.players.get(actor.auth.playerId)!.hand;
    const pools = [state.deck, ...[...state.players.values()].map(player => player.hand)];
    const maps = pools.flat().filter(card => card.type === 'action' && card.subtype === 'map').slice(0, 2);
    assert.equal(maps.length, 2);
    maps.forEach((card, index) => {
      const source = pools.find(cards => cards.some(candidate => candidate.id === card.id))!;
      const sourceIndex = source.findIndex(candidate => candidate.id === card.id);
      [source[sourceIndex], actorHand[index]] = [actorHand[index]!, source[sourceIndex]!];
    });
    state.revision++;
    emitGameState(h.io, roomStore.get(actor.auth.roomCode)!);
    await paired(clients, state.revision);
    const goal = actor.game!.goals[0]!.position;
    const otherBefore = clients.filter(client => client !== actor).map(client => client.mine!.peekedGoals);
    const firstRevision = actor.game!.revision;
    const firstAck = await accepted(actor, 'play_action', { cardId: maps[0]!.id, targetPosition: goal, expectedRevision: firstRevision });
    assert.equal(firstAck, firstRevision + 1);
    await paired(clients, firstAck);
    const knowledge = structuredClone(actor.mine!.peekedGoals);
    assert.equal(knowledge.length, 1);
    while (actor.game!.currentTurnPlayerId !== actor.auth.playerId) {
      const next = clients.find(client => client.auth.playerId === actor.game!.currentTurnPlayerId)!;
      await paired(clients, await accepted(next, 'pass_turn', { discardCardId: next.mine!.hand[0]!.id, expectedRevision: next.game!.revision }));
    }
    const before = actor.game!;
    assert.equal(before.revision, firstAck + clients.length - 1);
    assert(actor.mine!.hand.some(card => card.id === maps[1]!.id));
    const handSize = actor.mine!.hand.length;
    const nextPlayer = before.players[(before.players.findIndex(player => player.playerId === actor.auth.playerId) + 1) % clients.length]!.playerId;
    const payload = { cardId: maps[1]!.id, targetPosition: goal, expectedRevision: before.revision };
    const secondAck = await accepted(actor, 'play_action', payload);
    assert.equal(secondAck, before.revision + 1);
    await paired(clients, secondAck);
    assert.equal(actor.game!.currentTurnPlayerId, nextPlayer);
    assert.equal(actor.game!.deckSize, before.deckSize - 1);
    assert.equal(actor.game!.discardSize, before.discardSize + 1);
    assert.equal(actor.mine!.hand.length, handSize);
    assert(!actor.mine!.hand.some(card => card.id === maps[1]!.id));
    assert(state.discard.some(card => card.id === maps[1]!.id));
    assert.deepEqual(actor.mine!.peekedGoals, knowledge);
    assert.deepEqual(clients.filter(client => client !== actor).map(client => client.mine!.peekedGoals), otherBefore);
    assert.equal(actor.game!.goals[0]!.revealed, false);
    assert.equal(actor.game!.goals[0]!.isGold, null);
    clients.forEach(assertPrivacy);
    const terminalSnapshot = snapshot(actor);
    assert.match((await outcome(actor, 'play_action', payload)).reason ?? '', /state changed/i);
    assert.equal(snapshot(actor), terminalSnapshot);
  } finally { await h.close(); }
});

test('Saboteur canonical gold draft fixture exposes values only to current picker and fences duplicate choices', async () => {
  const h = await harness();
  try {
    const clients = await h.room(4);
    await start(clients);
    const state = stateOf(clients[0]!);
    [...state.players.values()].forEach((player, index) => { player.role = index === 3 ? 'saboteur' : 'miner'; });
    state.status = 'round_end';
    state.roundWinner = 'miners';
    state.lastPlacerId = clients[0]!.auth.playerId;
    state.goldDistribution = initGoldDistribution(state.players, state.turnOrder, state.lastPlacerId, state.goldDeck);
    state.revision++;
    emitGameState(h.io, roomStore.get(clients[0]!.auth.roomCode)!);
    await paired(clients, state.revision);
    clients.forEach(assertPrivacy);
    const picker = clients.find(client => client.auth.playerId === client.game!.goldDistribution!.currentPickerId)!;
    const outsider = clients.find(client => client !== picker)!;
    const before = snapshot(picker);
    assert.equal((await outcome(outsider, 'choose_gold', { cardIndex: 0, expectedRevision: outsider.game!.revision })).kind, 'rejected');
    assert.equal(snapshot(picker), before);
    const saved = picker.mine;
    const restored = await h.connect(picker.auth);
    await waitUntil(() => restored.mine !== null, 'picker reconnect');
    assert.deepEqual(restored.mine, saved);
    clients[clients.indexOf(picker)] = restored;
    const payload = { cardIndex: 0, expectedRevision: restored.game!.revision };
    const chosen = restored.mine!.availableGoldCards![0]!;
    const goldBefore = restored.mine!.goldCollected;
    await paired(clients, await accepted(restored, 'choose_gold', payload));
    assert.equal(restored.mine!.goldCollected, goldBefore + chosen);
    assert.equal(restored.mine!.availableGoldCards, null);
    clients.forEach(assertPrivacy);
    const after = snapshot(restored);
    assert.match((await outcome(restored, 'choose_gold', payload)).reason ?? '', /state changed/i);
    assert.equal(snapshot(restored), after);
    assert.equal(state.goldDeck.reduce((a, b) => a + b, 0) + state.goldDistribution!.availableCards.reduce((a, b) => a + b, 0) + [...state.players.values()].reduce((sum, player) => sum + player.goldCollected, 0), 44);
  } finally { await h.close(); }
});

function projectedDecision(game: SaboteurPublicState, mine: SaboteurPrivateState): { event: string; payload: Record<string, unknown> } {
  const revision = { expectedRevision: game.revision };
  if (game.status === 'round_end') {
    assert.equal(game.goldDistribution?.currentPickerId, mine.playerId);
    assert(mine.availableGoldCards?.length);
    const cardIndex = mine.availableGoldCards.indexOf(Math.max(...mine.availableGoldCards));
    return { event: 'choose_gold', payload: { ...revision, cardIndex } };
  }
  assert.equal(game.currentTurnPlayerId, mine.playerId);
  const self = game.players.find(player => player.playerId === mine.playerId)!;
  const repair = mine.hand.find(card => card.type === 'action' && card.subtype.startsWith('repair_')
    && self.brokenTools.some(tool => card.subtype.includes(tool)));
  if (repair?.type === 'action') {
    const chosenTool = self.brokenTools.find(tool => repair.subtype.includes(tool))!;
    return { event: 'play_action', payload: { ...revision, cardId: repair.id, targetPlayerId: mine.playerId, chosenTool } };
  }
  const map = mine.hand.find(card => card.type === 'action' && card.subtype === 'map');
  const unseen = game.goals.find(goal => !goal.revealed && !mine.peekedGoals.some(peek => peek.position.row === goal.position.row && peek.position.col === goal.position.col));
  if (map && unseen) return { event: 'play_action', payload: { ...revision, cardId: map.id, targetPosition: unseen.position } };
  const candidates: { cardId: string; position: { row: number; col: number }; rotated: boolean; score: number }[] = [];
  if (self.brokenTools.length === 0) for (const card of mine.hand) {
    if (card.type !== 'path' || card.isDeadEnd) continue;
    for (const rotated of [false, true]) for (const key of validPlacements(game.board, BOARD.goalPositions, card, rotated)) {
      const [row, col] = key.split(',').map(Number) as [number, number];
      const knownGold = mine.peekedGoals.find(goal => goal.isGold);
      const targetCol = knownGold?.position.col ?? 4;
      const score = row * 10 - Math.abs(col - targetCol);
      candidates.push({ cardId: card.id, position: { row, col }, rotated, score });
    }
  }
  if (candidates.length > 0 && mine.role === 'miner') {
    candidates.sort((a, b) => b.score - a.score);
    const { cardId, position, rotated } = candidates[0]!;
    return { event: 'place_card', payload: { ...revision, cardId, position, rotated } };
  }
  if (mine.role === 'saboteur') {
    const sabotage = mine.hand.find(card => card.type === 'action' && card.subtype.startsWith('sabotage_'));
    if (sabotage?.type === 'action') {
      const tool = sabotage.subtype.slice('sabotage_'.length) as Tool;
      const target = game.players.find(player => player.playerId !== mine.playerId && !player.brokenTools.includes(tool));
      if (target) return { event: 'play_action', payload: { ...revision, cardId: sabotage.id, targetPlayerId: target.playerId } };
    }
  }
  return { event: 'pass_turn', payload: { ...revision, ...(mine.hand[0] ? { discardCardId: mine.hand[0].id } : {}) } };
}

async function fullMatch(clients: Client[]): Promise<{ actions: number; rounds: number[] }> {
  let actions = 0;
  const rounds = new Set<number>();
  while (clients[0]!.game!.status !== 'game_over') {
    const game = clients[0]!.game!;
    rounds.add(game.round);
    clients.forEach(assertPrivacy);
    if (game.status === 'round_end' && !game.goldDistribution?.currentPickerId) {
      await waitUntil(() => clients.every(client => client.game!.revision > game.revision && client.game!.revision === client.mine!.revision), 'real 12-second round transition', 15_000);
      continue;
    }
    assert(actions < 500, 'Full match must terminate within a bounded number of decisions');
    const actorId = game.status === 'round_end' ? game.goldDistribution!.currentPickerId : game.currentTurnPlayerId;
    const actor = clients.find(client => client.auth.playerId === actorId)!;
    const choice = projectedDecision(actor.game!, actor.mine!);
    const revision = await accepted(actor, choice.event, choice.payload);
    await paired(clients, revision);
    actions++;
  }
  clients.forEach(assertPrivacy);
  assert.deepEqual([...rounds], [1, 2, 3]);
  assert(clients[0]!.game!.winnerIds!.length > 0);
  await waitUntil(() => clients.every(client => client.room!.status === 'finished'), 'finished room');
  return { actions, rounds: [...rounds] };
}

test('Saboteur complete three-round projection-only games and rematches at every supported count', { concurrency: 8 }, async t => {
  await Promise.all(Array.from({ length: 8 }, (_, index) => index + 3).map(count => t.test(`${count} players: full match, results and full rematch`, async () => {
    const h = await harness();
    try {
      const clients = await h.room(count);
      await start(clients);
      const initialRevision = clients[0]!.game!.revision;
      const initialActor = clients.find(client => client.auth.playerId === client.game!.currentTurnPlayerId)!;
      const stalePayload = { expectedRevision: initialRevision, discardCardId: initialActor.mine!.hand[0]!.id };
      const first = await fullMatch(clients);
      const terminalRevision = clients[0]!.game!.revision;
      const restored = await h.connect(clients[1]!.auth);
      await waitUntil(() => restored.game?.status === 'game_over' && restored.mine !== null, 'finished reconnect');
      assert.deepEqual(restored.game, clients[0]!.game);
      clients[1] = restored;
      assert.equal(await start(clients), terminalRevision + 1);
      const before = snapshot(clients[0]!);
      assert.match((await outcome(clients[0]!, 'pass_turn', stalePayload)).reason ?? '', /state changed/i);
      assert.equal(snapshot(clients[0]!), before);
      const second = await fullMatch(clients);
      console.log(`Saboteur ${count} players: ${first.actions}+${second.actions} acknowledged decisions, six rounds, finished reconnect, monotonic rematch`);
    } finally { await h.close(); }
  })));
});
