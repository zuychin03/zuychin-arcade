import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import type {
  JoinRoomResponse,
  RoomPublicState,
  SkullKingActionAccepted,
  SkullKingPrivateState,
  SkullKingPublicState,
} from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { supabase } from '../../lib/supabase.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  forfeitPlayer,
  forfeitPlayers,
  initSkullKingGame,
  playCard,
  submitBid,
  type EngineResult,
  type SkullKingServerState,
} from './engine.js';
import { toSkullKingPublicState } from './publicState.js';
import { legalCardIds } from './resolver.js';
import {
  isSkullKingBidPayload,
  isSkullKingPlayPayload,
  isSkullKingStartPayload,
  recoverDisconnectedSkullKingPlayers,
  buildSkullKingResult,
} from './socketHandlers.js';

process.env.JWT_SECRET ??= 'skull-king-test-only-secret-32-bytes';
assert.equal(supabase, null, 'Skull King protocol tests refuse hosted persistence');

interface Harness {
  app: FastifyInstance;
  io: Server;
  url: string;
  clients: ClientSocket[];
  roomCodes: Set<string>;
}

interface TrackedClient {
  auth: JoinRoomResponse;
  socket: ClientSocket;
  room: RoomPublicState | null;
  game: SkullKingPublicState | null;
  mine: SkullKingPrivateState | null;
}

const DIRECT_PLAYERS = [
  { playerId: 'alice', displayName: 'Alice' },
  { playerId: 'bob', displayName: 'Bob' },
  { playerId: 'carol', displayName: 'Carol' },
  { playerId: 'dave', displayName: 'Dave' },
];

async function post(harness: Harness, path: string, payload: unknown, token?: string): Promise<Response> {
  return fetch(harness.url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(payload),
  });
}

async function rejectCommand(client: TrackedClient, event: string, payload: unknown): Promise<string> {
  const rejected = waitForEvent<{ reason: string }>(client.socket, 'action_rejected');
  client.socket.emit(event, payload);
  return (await rejected).reason;
}

async function submitOpeningBids(clients: TrackedClient[]): Promise<void> {
  const revision = clients[0]!.game!.revision;
  for (const client of clients) {
    const ack = waitForEvent<SkullKingActionAccepted>(client.socket, 'skull_king:action_accepted');
    client.socket.emit('skull_king:bid', { bid: 0, expectedRevision: revision });
    await ack;
  }
  await waitUntil(() => clients.every(client => client.game?.phase === 'trick_play'
    && client.mine?.revision === client.game.revision));
}

function expectOk(result: EngineResult): void {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 3_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error('Timed out waiting for ' + event));
    }, timeoutMs);
    const onEvent = (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    };
    socket.once(event, onEvent);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createHarness(): Promise<Harness> {
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    io,
    url: 'http://127.0.0.1:' + port,
    clients: [],
    roomCodes: new Set(),
  };
}

async function closeHarness(harness: Harness): Promise<void> {
  for (const client of harness.clients) client.disconnect();
  for (const roomCode of harness.roomCodes) roomStore.delete(roomCode);
  await new Promise<void>((resolve) => harness.io.close(() => resolve()));
  if (harness.app.server.listening) await harness.app.close();
}

async function createRoom(harness: Harness, displayName: string): Promise<JoinRoomResponse> {
  const response = await fetch(harness.url + '/rooms/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, gameId: 'skull_king' }),
  });
  assert.equal(response.status, 201);
  const joined = await response.json() as JoinRoomResponse;
  harness.roomCodes.add(joined.roomCode);
  return joined;
}

async function joinRoom(
  harness: Harness,
  roomCode: string,
  displayName: string,
): Promise<JoinRoomResponse> {
  const response = await fetch(harness.url + '/rooms/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomCode, displayName }),
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<JoinRoomResponse>;
}

async function connect(harness: Harness, token: string): Promise<ClientSocket> {
  const socket = createClient(harness.url, {
    auth: { token },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  harness.clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 3_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

async function connectTracked(
  harness: Harness,
  auth: JoinRoomResponse,
): Promise<TrackedClient> {
  const socket = await connect(harness, auth.token);
  const client: TrackedClient = { auth, socket, room: null, game: null, mine: null };
  socket.on('room_updated', (room: RoomPublicState) => { client.room = room; });
  socket.on('game_state', (game: SkullKingPublicState) => { client.game = game; });
  socket.on('private_state', (mine: SkullKingPrivateState) => { client.mine = mine; });
  socket.emit('request_state');
  await waitUntil(() => client.room !== null);
  return client;
}

function serverState(roomCode: string): SkullKingServerState {
  const game = roomStore.get(roomCode)?.game;
  assert.equal(game?.id, 'skull_king');
  return game.state;
}

async function createTrackedRoom(
  harness: Harness,
  count: number,
): Promise<TrackedClient[]> {
  const auths = [await createRoom(harness, 'Captain 1')];
  for (let index = 1; index < count; index += 1) {
    auths.push(await joinRoom(harness, auths[0]!.roomCode, 'Captain ' + (index + 1)));
  }
  const clients: TrackedClient[] = [];
  for (const auth of auths) clients.push(await connectTracked(harness, auth));
  return clients;
}

async function startGame(clients: TrackedClient[]): Promise<SkullKingPublicState> {
  const accepted = waitForEvent<SkullKingActionAccepted>(
    clients[0]!.socket,
    'skull_king:action_accepted',
  );
  const started = waitForEvent<SkullKingPublicState>(clients[0]!.socket, 'game_state');
  clients[0]!.socket.emit('start_game', {});
  const [ack, game] = await Promise.all([accepted, started]);
  assert.deepEqual(ack, { action: 'start', revision: 0 });
  await waitUntil(() => clients.every((client) => client.game !== null && client.mine !== null));
  return game;
}

async function playCompleteSocketMatch(
  clients: TrackedClient[],
  stop?: (state: SkullKingPublicState) => boolean,
): Promise<number> {
  const byId = new Map(clients.map((client) => [client.auth.playerId, client]));
  let commands = 0;
  while (clients[0]!.game!.status === 'playing' && !stop?.(clients[0]!.game!) && commands < 5_000) {
    const state = clients[0]!.game!;
    await waitUntil(() => clients.every(client => (
      client.game?.revision === state.revision && client.mine?.revision === state.revision
    )));
    for (const client of clients) {
      assert.equal(client.mine!.roomCode, client.auth.roomCode);
      assert.equal(client.mine!.playerId, client.auth.playerId);
      assert.equal(client.game!.roomCode, client.auth.roomCode);
      assert.equal(client.game!.players.some(player => 'hand' in player || 'pendingBonus' in player), false);
      assert.equal('rng' in client.game! || 'deck' in client.game!, false);
      const otherHeldCards = clients.filter(other => other !== client).flatMap(other => other.mine!.hand.map(card => card.id));
      assert.equal(client.mine!.hand.some(card => otherHeldCards.includes(card.id)), false);
      if (!client.game!.bidsRevealed) assert.ok(client.game!.players.every(player => player.bid === null));
    }
    if (state.phase === 'bidding') {
      const sharedRevision = state.revision;
      const bidders = state.players
        .filter(player => !player.forfeited && !player.bidSubmitted).map(player => player.playerId);
      const acknowledgements = bidders.map((id) => (
        waitForEvent<SkullKingActionAccepted>(
          byId.get(id)!.socket,
          'skull_king:action_accepted',
        )
      ));
      bidders.forEach((id, index) => {
        const bid = (state.roundNumber + index * 2) % (state.cardsPerPlayer + 1);
        byId.get(id)!.socket.emit('skull_king:bid', {
          bid,
          expectedRevision: sharedRevision,
        });
      });
      const accepted = await Promise.all(acknowledgements);
      assert.ok(accepted.every((ack) => ack.action === 'bid'));
      await waitUntil(() => clients.every(client => (
        client.game?.revision === Math.max(...accepted.map(ack => ack.revision))
        && client.mine?.revision === client.game.revision
      )));
      commands += bidders.length;
      continue;
    }
    assert.equal(state.phase, 'trick_play');
    const actorId = state.currentPlayerId!;
    const actor = byId.get(actorId)!.mine!;
    assert.equal(actor.playerId, actorId);
    const legal = actor.legalCardIds;
    const cardId = legal[(commands + state.roundNumber) % legal.length]!;
    const selected = actor.hand.find((card) => card.id === cardId)!;
    const accepted = waitForEvent<SkullKingActionAccepted>(
      byId.get(actorId)!.socket,
      'skull_king:action_accepted',
    );
    byId.get(actorId)!.socket.emit('skull_king:play', {
      cardId,
      ...(selected.kind === 'tigress' ? { tigressMode: commands % 2 ? 'pirate' : 'escape' } : {}),
      expectedRevision: state.revision,
    });
    const ack = await accepted;
    assert.equal(ack.action, 'play');
    assert.equal(ack.revision, state.revision + 1);
    await waitUntil(() => clients.every(client => (
      client.game?.revision === ack.revision && client.mine?.revision === ack.revision
    )));
    commands += 1;
  }
  assert.ok(commands < 5_000, 'socket game exceeded command limit');
  if (stop?.(clients[0]!.game!)) return commands;
  assert.equal(clients[0]!.game!.status, 'game_over');
  assert.ok(clients[0]!.game!.winnerIds.length >= 1);
  await waitUntil(() => clients.every(client => client.room?.status === 'finished'));
  return commands;
}

function createDirectRoom(count = 3): {
  room: ServerRoom;
  state: SkullKingServerState;
  io: Server;
} {
  const players = DIRECT_PLAYERS.slice(0, count);
  const room = roomStore.create(players[0]!.playerId, null, 'skull_king', {});
  for (const player of players) {
    roomStore.addPlayer(
      room,
      { ...player, isHost: player.playerId === players[0]!.playerId },
      Date.now() + 60_000,
    );
    roomStore.markConnected(room, player.playerId, player.playerId + '-socket');
  }
  const state = initSkullKingGame(room.roomCode, players, () => 0.25);
  room.status = 'in_game';
  room.game = { id: 'skull_king', state };
  const io = { to: () => ({ emit: () => undefined }) } as unknown as Server;
  return { room, state, io };
}

test('Skull King payload validators accept only exact revisioned shapes', () => {
  assert.equal(isSkullKingStartPayload(undefined), true);
  assert.equal(isSkullKingStartPayload({}), true);
  assert.equal(isSkullKingStartPayload(null), false);
  assert.equal(isSkullKingStartPayload([]), false);
  assert.equal(isSkullKingStartPayload({ expectedRevision: 0 }), false);

  assert.equal(isSkullKingBidPayload({ bid: 0, expectedRevision: 0 }), true);
  assert.equal(isSkullKingBidPayload({ bid: 10, expectedRevision: 2 }), true);
  assert.equal(isSkullKingBidPayload({ bid: 0 }), false);
  assert.equal(isSkullKingBidPayload({ bid: -1, expectedRevision: 0 }), false);
  assert.equal(isSkullKingBidPayload({ bid: 1.5, expectedRevision: 0 }), false);
  assert.equal(isSkullKingBidPayload({ bid: 11, expectedRevision: 0 }), false);
  assert.equal(isSkullKingBidPayload({ bid: 1, expectedRevision: -1 }), false);
  assert.equal(isSkullKingBidPayload({ bid: 1, expectedRevision: 0, extra: true }), false);

  assert.equal(isSkullKingPlayPayload({ cardId: 'green-14', expectedRevision: 3 }), true);
  assert.equal(isSkullKingPlayPayload({
    cardId: 'tigress', tigressMode: 'pirate', expectedRevision: 3,
  }), true);
  assert.equal(isSkullKingPlayPayload({ cardId: '', expectedRevision: 3 }), false);
  assert.equal(isSkullKingPlayPayload({ cardId: 'green-14' }), false);
  assert.equal(isSkullKingPlayPayload({
    cardId: 'tigress', tigressMode: 'queen', expectedRevision: 3,
  }), false);
  assert.equal(isSkullKingPlayPayload({
    cardId: 'green-14', expectedRevision: 3, extra: true,
  }), false);
});

test('Skull King scoring, special capture and stale bid fencing cross round boundaries', () => {
  const state = initSkullKingGame('DIRECT', DIRECT_PLAYERS.slice(0, 3), () => 0.25);
  const leaderIndex = state.turnOrder.indexOf(state.leaderId!);
  const order = Array.from({ length: 3 }, (_, offset) => (
    state.turnOrder[(leaderIndex + offset) % 3]!
  ));
  state.players.get(order[0]!)!.hand = [{ id: 'pirate-1', kind: 'pirate', copy: 1 }];
  state.players.get(order[1]!)!.hand = [{ id: 'skull-king', kind: 'skull_king' }];
  state.players.get(order[2]!)!.hand = [{ id: 'mermaid-1', kind: 'mermaid', copy: 1 }];

  expectOk(submitBid(state, order[0]!, 0, 0));
  expectOk(submitBid(state, order[1]!, 0, 0));
  expectOk(submitBid(state, order[2]!, 1, 0));
  assert.equal(state.revision, 3);
  expectOk(playCard(state, order[0]!, 'pirate-1', undefined, 3));
  expectOk(playCard(state, order[1]!, 'skull-king', undefined, 4));
  expectOk(playCard(state, order[2]!, 'mermaid-1', undefined, 5));

  assert.equal(state.roundNumber, 2);
  assert.equal(state.biddingRevision, state.revision);
  assert.equal(state.players.get(order[2]!)!.roundScore, 60);
  assert.equal(state.players.get(order[0]!)!.roundScore, 10);
  assert.equal(state.players.get(order[1]!)!.roundScore, 10);
  assert.equal(state.lastTrick?.roundNumber, 1);
  assert.equal(state.lastTrick?.winnerId, order[2]);
  const before = JSON.stringify(toSkullKingPublicState(state));
  const stale = submitBid(state, order[0]!, 0, 0);
  assert.equal(stale.ok, false);
  assert.equal(JSON.stringify(toSkullKingPublicState(state)), before);
});

test('Skull King current-round ghost preserves history, scores zero and receives no next hand', () => {
  const state = initSkullKingGame('AUTOPILOT', DIRECT_PLAYERS, () => 0.25);
  const departedId = state.leaderId!;
  expectOk(forfeitPlayer(state, departedId, state.revision));
  assert.equal(state.players.get(departedId)!.bid, 0);
  const hiddenForfeitBid = toSkullKingPublicState(state);
  const publicDeparted = hiddenForfeitBid.players.find((player) => player.playerId === departedId)!;
  assert.equal(publicDeparted.bid, null);
  assert.equal(publicDeparted.bidSubmitted, false);
  assert.equal(hiddenForfeitBid.log.some((entry) => /bid of 0|assigned.*0/i.test(entry.text)), false);
  const sharedRevision = state.biddingRevision;
  for (const id of state.turnOrder) {
    const player = state.players.get(id)!;
    if (!player.forfeited) expectOk(submitBid(state, id, 0, sharedRevision));
  }
  assert.equal(state.phase, 'trick_play');
  assert.notEqual(state.currentPlayerId, departedId);
  assert.equal(state.currentTrick.some((card) => card.playerId === departedId), true);

  let actions = 0;
  while (state.roundNumber === 1 && actions < 20) {
    const actor = state.players.get(state.currentPlayerId!)!;
    assert.equal(actor.forfeited, false);
    const cardId = legalCardIds(actor.hand, state.currentTrick)[0]!;
    const selected = actor.hand.find((card) => card.id === cardId)!;
    expectOk(playCard(
      state,
      actor.playerId,
      cardId,
      selected.kind === 'tigress' ? 'escape' : undefined,
      state.revision,
    ));
    actions += 1;
  }
  assert.equal(state.roundNumber, 2);
  assert.equal(state.players.get(departedId)!.roundScore, 0);
  assert.equal(state.players.get(departedId)!.totalScore, 0);
  assert.deepEqual(state.players.get(departedId)!.hand, []);
  assert.equal(state.players.get(departedId)!.bid, null);
  assert.equal(state.turnOrder.includes(departedId), false);
  assert.equal(state.lastTrick?.roundNumber, 1);
  const publicState = toSkullKingPublicState(state);
  assert.equal(publicState.players.find((player) => player.playerId === departedId)?.forfeited, true);
  assert.equal(
    publicState.modeDescription,
    'Digital Base Voyage · 3–8 players · No Graybeard, advanced cards or pirate powers. Departed seats forfeit immediately, finish only the current round automatically, then leave the rotation. Below three eligible captains ends without a winner.',
  );
});

test('Skull King atomically forfeits an abandoned table without inventing a winner', () => {
  const state = initSkullKingGame('ABANDONED', DIRECT_PLAYERS.slice(0, 3), () => 0.25);
  expectOk(forfeitPlayers(state, state.turnOrder, state.revision));
  assert.equal(state.status, 'game_over');
  assert.deepEqual(state.winnerIds, []);
  assert.ok([...state.players.values()].every((player) => player.forfeited));
});

test('Astra: recovery batches already-overdue seats before the scheduler callback', () => {
  const { room, state, io } = createDirectRoom();
  try {
    for (const player of room.players.values()) {
      player.isConnected = false;
      player.socketId = null;
      player.reconnectDeadlineAt = Date.now() - 1;
    }
    assert.equal(recoverDisconnectedSkullKingPlayers(io, room), true);
    assert.equal(state.status, 'game_over');
    assert.deepEqual(state.winnerIds, []);
    assert.ok([...state.players.values()].every(player => player.forfeited));
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('Skull King start is exact, host-only, connected-only and cannot reset an active game', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Host');
    const hostSocket = await connect(harness, host.token);
    const second = await joinRoom(harness, host.roomCode, 'Second');
    const secondSocket = await connect(harness, second.token);
    const reserved = await joinRoom(harness, host.roomCode, 'Reserved');

    let rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', { extra: true });
    assert.equal((await rejected).reason, 'Invalid payload');

    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('skull_king:bid', { bid: 0, expectedRevision: 0 });
    assert.match((await rejected).reason, /has not started/i);

    rejected = waitForEvent<{ reason: string }>(secondSocket, 'action_rejected');
    secondSocket.emit('start_game', {});
    assert.match((await rejected).reason, /Only the host/);

    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejected).reason, /connecting or reconnecting/i);
    assert.equal(roomStore.get(host.roomCode)?.status, 'lobby');

    await connect(harness, reserved.token);
    const accepted = waitForEvent<SkullKingActionAccepted>(
      hostSocket,
      'skull_king:action_accepted',
    );
    const started = waitForEvent<SkullKingPublicState>(hostSocket, 'game_state');
    hostSocket.emit('start_game', {});
    assert.deepEqual(await accepted, { action: 'start', revision: 0 });
    assert.equal((await started).players.length, 3);

    const original = roomStore.get(host.roomCode)?.game;
    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejected).reason, /already in progress/i);
    assert.equal(roomStore.get(host.roomCode)?.game, original);
  } finally {
    await closeHarness(harness);
  }
});

test('Skull King simultaneous bids remain hidden and receive sender-only semantic acknowledgements', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    const initial = await startGame(clients);
    const sharedRevision = initial.revision;
    let observerAcks = 0;
    clients[2]!.socket.on('skull_king:action_accepted', () => { observerAcks += 1; });

    const firstAck = waitForEvent<SkullKingActionAccepted>(
      clients[0]!.socket,
      'skull_king:action_accepted',
    );
    const secondAck = waitForEvent<SkullKingActionAccepted>(
      clients[1]!.socket,
      'skull_king:action_accepted',
    );
    clients[0]!.socket.emit('skull_king:bid', { bid: 0, expectedRevision: sharedRevision });
    clients[1]!.socket.emit('skull_king:bid', { bid: 1, expectedRevision: sharedRevision });
    const [first, second] = await Promise.all([firstAck, secondAck]);
    assert.equal(first.action, 'bid');
    assert.equal(second.action, 'bid');
    assert.notEqual(first.revision, second.revision);
    await waitUntil(() => clients.every((client) => client.game?.revision === 2));
    assert.equal(observerAcks, 0);

    for (const client of clients) {
      assert.equal(client.game!.bidsRevealed, false);
      assert.ok(client.game!.players.every((player) => player.bid === null));
      const publicJson = JSON.stringify(client.game);
      for (const card of client.mine!.hand) assert.equal(publicJson.includes(card.id), false);
    }
    assert.equal(clients[0]!.mine!.submittedBid, 0);
    assert.equal(clients[1]!.mine!.submittedBid, 1);
    assert.equal(clients[2]!.mine!.submittedBid, null);

    const finalAck = waitForEvent<SkullKingActionAccepted>(
      clients[2]!.socket,
      'skull_king:action_accepted',
    );
    clients[2]!.socket.emit('skull_king:bid', { bid: 0, expectedRevision: sharedRevision });
    assert.equal((await finalAck).revision, 3);
    await waitUntil(() => clients.every((client) => client.game?.phase === 'trick_play'));
    assert.ok(clients.every((client) => client.game!.bidsRevealed));
  } finally {
    await closeHarness(harness);
  }
});

test('Skull King malformed, out-of-turn and stale actions do not mutate state', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    let before = serverState(roomCode).revision;
    let rejected = waitForEvent<{ reason: string }>(clients[0]!.socket, 'action_rejected');
    clients[0]!.socket.emit('skull_king:bid', { bid: 0 });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(serverState(roomCode).revision, before);

    const sharedRevision = before;
    for (const client of clients) {
      const accepted = waitForEvent<SkullKingActionAccepted>(
        client.socket,
        'skull_king:action_accepted',
      );
      client.socket.emit('skull_king:bid', { bid: 0, expectedRevision: sharedRevision });
      await accepted;
    }
    const state = serverState(roomCode);
    const actorId = state.currentPlayerId!;
    const nonActor = clients.find((client) => client.auth.playerId !== actorId)!;
    before = state.revision;
    rejected = waitForEvent<{ reason: string }>(nonActor.socket, 'action_rejected');
    nonActor.socket.emit('skull_king:play', {
      cardId: state.players.get(nonActor.auth.playerId)!.hand[0]!.id,
      expectedRevision: before,
    });
    assert.match((await rejected).reason, /not your turn/i);
    assert.equal(serverState(roomCode).revision, before);

    const actor = clients.find((client) => client.auth.playerId === actorId)!;
    rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
    actor.socket.emit('skull_king:play', {
      cardId: state.players.get(actorId)!.hand[0]!.id,
      expectedRevision: before - 1,
    });
    assert.match((await rejected).reason, /state changed/i);
    assert.equal(serverState(roomCode).revision, before);

    rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
    actor.socket.emit('skull_king:play', {
      cardId: state.players.get(actorId)!.hand[0]!.id,
      tigressMode: 'pirate',
      expectedRevision: before,
      extra: true,
    });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(serverState(roomCode).revision, before);
  } finally {
    await closeHarness(harness);
  }
});

test('Skull King replaced sockets cannot act and reconnect restores only owner private state', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const oldSocket = clients[0]!.socket;
    const replaced = waitForEvent(oldSocket, 'session_replaced');
    const replacement = await connectTracked(harness, clients[0]!.auth);
    await replaced;
    await waitUntil(() => !oldSocket.connected);
    assert.equal(replacement.mine?.playerId, clients[0]!.auth.playerId);
    assert.equal(replacement.mine?.hand.length, 1);
    assert.equal(
      roomStore.get(clients[0]!.auth.roomCode)?.players.get(clients[0]!.auth.playerId)?.socketId,
      replacement.socket.id,
    );
    const before = serverState(clients[0]!.auth.roomCode).revision;
    oldSocket.emit('skull_king:bid', { bid: 0, expectedRevision: before });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(serverState(clients[0]!.auth.roomCode).revision, before);
  } finally {
    await closeHarness(harness);
  }
});

test('Skull King explicit leave transfers host, rejects token reuse and excludes forfeits from winning', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    serverState(roomCode).players.get(clients[0]!.auth.playerId)!.totalScore = 10_000;
    const firstLeave = await harness.app.inject({
      method: 'POST',
      url: '/rooms/' + roomCode + '/leave',
      headers: { authorization: 'Bearer ' + clients[0]!.auth.token },
    });
    assert.equal(firstLeave.statusCode, 200, firstLeave.body);
    await waitUntil(() => serverState(roomCode).players.get(clients[0]!.auth.playerId)!.forfeited);
    assert.equal(roomStore.get(roomCode)?.hostPlayerId, clients[1]!.auth.playerId);
    assert.equal(serverState(roomCode).status, 'playing');

    const staleSocket = createClient(harness.url, {
      auth: { token: clients[0]!.auth.token },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    harness.clients.push(staleSocket);
    const error = await waitForEvent<{ message: string }>(staleSocket, 'server_error');
    assert.match(error.message, /no longer exists/i);
    await waitUntil(() => !staleSocket.connected);

    const secondLeave = await harness.app.inject({
      method: 'POST',
      url: '/rooms/' + roomCode + '/leave',
      headers: { authorization: 'Bearer ' + clients[1]!.auth.token },
    });
    assert.equal(secondLeave.statusCode, 200, secondLeave.body);
    await waitUntil(() => serverState(roomCode).status === 'game_over');
    const state = serverState(roomCode);
    assert.deepEqual(state.winnerIds, []);
    assert.equal(buildSkullKingResult(state), null);
    assert.equal(state.players.get(clients[0]!.auth.playerId)!.totalScore, 10_000);
    assert.equal(state.players.get(clients[0]!.auth.playerId)!.forfeited, true);
    assert.equal(state.players.get(clients[1]!.auth.playerId)!.forfeited, true);
    assert.equal(roomStore.get(roomCode)?.hostPlayerId, clients[2]!.auth.playerId);
    assert.equal(roomStore.get(roomCode)?.status, 'finished');

    const rejected = waitForEvent<{ reason: string }>(clients[2]!.socket, 'action_rejected');
    clients[2]!.socket.emit('start_game', {});
    assert.match((await rejected).reason, /at least 3 connected players/i);
  } finally {
    await closeHarness(harness);
  }
});

test('Skull King reconnect grace preserves a seat, then expiry forfeits it once', async () => {
  const { room, state, io } = createDirectRoom();
  try {
    const host = room.players.get('alice')!;
    assert.equal(markPlayerDisconnected(io, room, 'alice', host.socketId, 50), true);
    assert.equal(state.players.get('alice')!.forfeited, false);
    assert.equal(room.hostPlayerId, 'alice');
    assert.ok(roomStore.markConnected(room, 'alice', 'alice-reconnected'));
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(state.players.get('alice')!.forfeited, false);
    assert.equal(room.hostPlayerId, 'alice');

    assert.equal(markPlayerDisconnected(io, room, 'alice', 'alice-reconnected', 0), true);
    await waitUntil(() => state.players.get('alice')!.forfeited);
    assert.equal(state.status, 'game_over');
    assert.deepEqual(state.winnerIds, []);
    assert.equal(buildSkullKingResult(state), null);
    const revision = state.revision;
    assert.equal(room.players.get('alice')!.hasLeft, true);
    assert.equal(room.hostPlayerId, 'bob');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(state.revision, revision);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

const ghostDepartureCases = (['rest', 'expiry'] as const).flatMap(method =>
  (['bidding', 'locked_bid', 'partial_trick', 'last_card'] as const).map(stage => ({ method, stage })));
for (const { method, stage } of ghostDepartureCases) {
  test(`Astra: ${method} ${stage} departure ghosts only the current round and archives before redeal`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      let departed = clients[0]!;
      if (stage === 'locked_bid') {
        const ack = waitForEvent(departed.socket, 'skull_king:action_accepted');
        departed.socket.emit('skull_king:bid', { bid: 1, expectedRevision: 0 });
        await ack;
        await waitUntil(() => departed.mine?.submittedBid === 1);
      } else if (stage === 'partial_trick' || stage === 'last_card') {
        await playCompleteSocketMatch(clients, state => state.phase === 'trick_play'
          && state.currentTrick.length === (stage === 'partial_trick' ? 1 : 3));
        const departedId = stage === 'partial_trick'
          ? clients[0]!.game!.currentTrick[0]!.playerId : clients[0]!.game!.currentPlayerId;
        departed = clients.find(client => client.auth.playerId === departedId)!;
      }
      const room = roomStore.get(departed.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const beforeRevision = state.revision;
      const beforeScore = state.players.get(departed.auth.playerId)!.totalScore;
      const beforeBid = state.players.get(departed.auth.playerId)!.bid;
      const survivors = clients.filter(client => client !== departed);
      if (method === 'rest') {
        assert.equal((await post(harness, '/rooms/' + room.roomCode + '/leave', {}, departed.auth.token)).status, 200);
      } else {
        assert.equal(markPlayerDisconnected(harness.io, room, departed.auth.playerId, departed.socket.id ?? null, 0), true);
        departed.socket.disconnect();
      }
      await waitUntil(() => survivors.every(client => client.game?.revision === beforeRevision + 1
        && client.mine?.revision === beforeRevision + 1));
      assert.equal(state.status, 'playing');
      assert.equal(state.players.get(departed.auth.playerId)!.forfeited, true);
      assert.equal(state.players.get(departed.auth.playerId)!.totalScore, beforeScore);
      if (state.roundNumber === 1) {
        assert.ok(state.turnOrder.includes(departed.auth.playerId));
        assert.equal(state.players.get(departed.auth.playerId)!.bid, beforeBid ?? 0);
      }
      await playCompleteSocketMatch(survivors, value => value.roundNumber === 3);
      assert.equal(state.turnOrder.length, 3);
      assert.equal(state.turnOrder.includes(departed.auth.playerId), false);
      assert.deepEqual(state.players.get(departed.auth.playerId)!.hand, []);
      assert.equal(state.players.get(departed.auth.playerId)!.bid, null);
      assert.equal(state.players.get(departed.auth.playerId)!.totalScore, beforeScore);
      const archived = survivors[0]!.game!.players.find(player => player.playerId === departed.auth.playerId)!;
      assert.equal(archived.forfeited, true);
      assert.equal(archived.cardCount, 0);
      assert.equal(archived.totalScore, beforeScore);
      const ghostRound = state.scoreHistory.find(round => round.roundNumber === 1)!;
      const ghostScore = ghostRound.players.find(player => player.playerId === departed.auth.playerId)!;
      assert.equal(ghostScore.forfeited, true);
      assert.equal(ghostScore.roundScore, 0);
      assert.equal(state.scoreHistory[1]!.players.some(player => player.playerId === departed.auth.playerId), false);
      assert.match(await rejectCommand(survivors[0]!, 'skull_king:bid', { bid: 0, expectedRevision: beforeRevision }), /state changed/i);
      assert.equal(recoverDisconnectedSkullKingPlayers(harness.io, room), false);
      if (method === 'rest' && stage === 'bidding') {
        await playCompleteSocketMatch(survivors);
        const result = buildSkullKingResult(state)!;
        assert.equal(result.players.length, 3);
        assert.equal(result.players.some(player => player.playerId === departed.auth.playerId), false);
        assert.equal(state.players.get(departed.auth.playerId)!.totalScore, beforeScore);
        assert.ok(state.scoreHistory.slice(1).every(round => round.players.every(player => player.playerId !== departed.auth.playerId)));
      }
    } finally { await closeHarness(harness); }
  });
}

for (const method of ['rest', 'expiry'] as const) {
  for (const stage of ['bidding', 'partial_trick', 'last_card'] as const) {
    test(`Astra: ${method} ${stage} departure below three ends without scoring or competitive result`, async () => {
      const harness = await createHarness();
      try {
        const clients = await createTrackedRoom(harness, 3);
        await startGame(clients);
        if (stage === 'bidding') {
          const ack = waitForEvent(clients[1]!.socket, 'skull_king:action_accepted');
          clients[1]!.socket.emit('skull_king:bid', { bid: 1, expectedRevision: 0 });
          await ack;
          await waitUntil(() => clients[1]!.mine?.submittedBid === 1);
        }
        if (stage !== 'bidding') await playCompleteSocketMatch(clients, state => state.phase === 'trick_play'
          && state.currentTrick.length === (stage === 'partial_trick' ? 1 : 2));
        const room = roomStore.get(clients[0]!.auth.roomCode)!;
        const state = serverState(room.roomCode);
        const departed = stage === 'last_card'
          ? clients.find(client => client.auth.playerId === state.currentPlayerId)! : clients[0]!;
        const beforeRevision = state.revision;
        const beforeHistory = JSON.stringify(state.scoreHistory);
        const beforeScores = [...state.players.values()].map(player => [player.playerId, player.totalScore]);
        if (method === 'rest') {
          assert.equal((await post(harness, '/rooms/' + room.roomCode + '/leave', {}, departed.auth.token)).status, 200);
        } else {
          assert.equal(markPlayerDisconnected(harness.io, room, departed.auth.playerId, departed.socket.id ?? null, 0), true);
          departed.socket.disconnect();
        }
        const survivors = clients.filter(client => client !== departed);
        await waitUntil(() => survivors.every(client => client.game?.status === 'game_over'
          && client.mine?.revision === client.game.revision));
        assert.equal(state.revision, beforeRevision + 1);
        assert.equal(room.status, 'finished');
        assert.deepEqual(state.winnerIds, []);
        assert.equal(state.terminationReason, 'not_enough_players');
        assert.equal(buildSkullKingResult(state), null);
        assert.equal(JSON.stringify(state.scoreHistory), beforeHistory);
        assert.deepEqual([...state.players.values()].map(player => [player.playerId, player.totalScore]), beforeScores);
        assert.equal(state.currentPlayerId, null);
        assert.deepEqual(state.currentTrick, []);
        if (stage === 'bidding') {
          assert.equal(survivors[0]!.game!.bidsRevealed, false);
          assert.ok(survivors.every(client => client.game!.players.every(player => player.bid === null)));
          assert.equal(clients[1]!.mine!.submittedBid, 1);
          assert.equal(clients[2]!.mine!.submittedBid, null);
        }
        assert.equal(recoverDisconnectedSkullKingPlayers(harness.io, room), false);
        const terminal = JSON.stringify(toSkullKingPublicState(state));
        assert.match(await rejectCommand(survivors[0]!, 'skull_king:bid', { bid: 0, expectedRevision: state.revision }), /closed/i);
        assert.equal(JSON.stringify(toSkullKingPublicState(state)), terminal);
        assert.equal((await post(harness, '/rooms/' + room.roomCode + '/leave', {}, survivors[0]!.auth.token)).status, 200);
        assert.equal(state.players.get(survivors[0]!.auth.playerId)!.forfeited, false);
        assert.equal(JSON.stringify(toSkullKingPublicState(state)), terminal);
      } finally { await closeHarness(harness); }
    });
  }
}

test('Astra: delayed five-seat recovery forfeits the full overdue batch once before terminal adjudication', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 5);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = serverState(room.roomCode);
    for (const client of clients.slice(2)) {
      const presence = room.players.get(client.auth.playerId)!;
      presence.isConnected = false;
      presence.socketId = null;
      presence.reconnectDeadlineAt = Date.now() - 1;
    }
    clients[0]!.socket.emit('request_state', {});
    await waitUntil(() => clients[0]!.game?.status === 'game_over');
    assert.equal(state.revision, 1);
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.deepEqual([...state.players.values()].filter(player => player.forfeited).map(player => player.playerId),
      clients.slice(2).map(client => client.auth.playerId));
    assert.deepEqual(state.winnerIds, []);
    assert.deepEqual(state.scoreHistory, []);
    assert.equal(buildSkullKingResult(state), null);
    assert.equal(recoverDisconnectedSkullKingPlayers(harness.io, room), false);
    assert.equal(state.revision, 1);
  } finally { await closeHarness(harness); }
});

for (const count of [3, 4]) {
  test(`Astra: natural round-ten last-card REST departure at ${count} seats respects eligibility and settlement`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, count);
      await startGame(clients);
      await playCompleteSocketMatch(clients, state => state.roundNumber === 10
        && state.trickNumber === state.cardsPerPlayer && state.currentTrick.length === count - 1);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const departed = clients.find(client => client.auth.playerId === state.currentPlayerId)!;
      const survivors = clients.filter(client => client !== departed);
      const beforeScore = state.players.get(departed.auth.playerId)!.totalScore;
      const beforeHistory = JSON.stringify(state.scoreHistory);
      const beforeRevision = state.revision;
      assert.equal((await post(harness, '/rooms/' + room.roomCode + '/leave', {}, departed.auth.token)).status, 200);
      await waitUntil(() => survivors.every(client => client.game?.revision === beforeRevision + 1
        && client.mine?.revision === beforeRevision + 1));
      assert.equal(state.players.get(departed.auth.playerId)!.totalScore, beforeScore);
      if (count === 3) {
        assert.equal(state.status, 'game_over');
        assert.equal(state.terminationReason, 'not_enough_players');
        assert.deepEqual(state.winnerIds, []);
        assert.equal(JSON.stringify(state.scoreHistory), beforeHistory);
        assert.equal(buildSkullKingResult(state), null);
      } else {
        if (state.status === 'playing') await playCompleteSocketMatch(survivors);
        assert.equal(state.terminationReason, null);
        assert.equal(state.scoreHistory.find(round => round.roundNumber === 10)!.players
          .find(player => player.playerId === departed.auth.playerId)!.roundScore, 0);
        const result = buildSkullKingResult(state)!;
        assert.equal(result.players.length, 3);
        assert.equal(result.players.some(player => player.playerId === departed.auth.playerId), false);
        assert.ok(state.winnerIds.every(id => id !== departed.auth.playerId));
      }
      assert.equal(room.status, 'finished');
    } finally { await closeHarness(harness); }
  });
}

test('Skull King commits simultaneous grace-zero expiries before finalising', async () => {
  const { room, state, io } = createDirectRoom();
  try {
    for (const player of room.players.values()) {
      assert.equal(
        markPlayerDisconnected(io, room, player.playerId, player.socketId, 0),
        true,
      );
    }
    await waitUntil(() => state.status === 'game_over');
    assert.ok([...room.players.values()].every((player) => player.hasLeft));
    assert.ok([...state.players.values()].every((player) => player.forfeited));
    assert.deepEqual(state.winnerIds, []);
    assert.equal(room.status, 'finished');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('Skull King Socket.IO lifecycle batches all grace-zero seats without a phantom winner', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    for (const client of clients) {
      assert.equal(
        markPlayerDisconnected(
          harness.io,
          room,
          client.auth.playerId,
          client.socket.id ?? null,
          0,
        ),
        true,
      );
    }
    await waitUntil(() => serverState(room.roomCode).status === 'game_over');
    assert.ok([...room.players.values()].every((player) => player.hasLeft));
    assert.ok([...serverState(room.roomCode).players.values()].every((player) => player.forfeited));
    assert.deepEqual(serverState(room.roomCode).winnerIds, []);
    assert.equal(room.status, 'finished');
  } finally {
    await closeHarness(harness);
  }
});

test('Astra: real HTTP exact passwords, reserved capacity and token boundaries', async () => {
  const harness = await createHarness();
  try {
    const response = await post(harness, '/rooms/create', { displayName: 'Host', gameId: 'skull_king', password: ' exact pass ' });
    assert.equal(response.status, 201);
    const host = await response.json() as JoinRoomResponse;
    harness.roomCodes.add(host.roomCode);
    for (const password of [undefined, 'exact pass', 'wrong']) {
      assert.equal((await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: 'Wrong', password })).status, 403);
    }
    for (let index = 1; index < 8; index += 1) {
      const joined = await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: 'Reserved ' + index, password: ' exact pass ' });
      assert.equal(joined.status, 200);
    }
    assert.equal((await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: 'Ninth', password: ' exact pass ' })).status, 409);
    const other = await createRoom(harness, 'Other');
    assert.equal((await post(harness, '/rooms/' + host.roomCode + '/leave', {}, other.token)).status, 403);
    assert.equal((await post(harness, '/rooms/' + host.roomCode + '/leave', {})).status, 401);
    assert.equal(roomStore.get(host.roomCode)!.players.size, 8);
  } finally { await closeHarness(harness); }
});

test('Astra: malformed host start cannot prune an overdue reservation', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    const reserved = await joinRoom(harness, clients[0]!.auth.roomCode, 'Overdue');
    const room = roomStore.get(reserved.roomCode)!;
    const seat = room.players.get(reserved.playerId)!;
    roomStore.clearPresenceTimer(seat);
    seat.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(await rejectCommand(clients[0]!, 'start_game', { unexpected: true }), 'Invalid payload');
    assert.equal(room.players.get(reserved.playerId), seat);
    assert.equal(room.status, 'lobby');
    assert.equal(room.game, null);
  } finally { await closeHarness(harness); }
});

test('Astra: actual HTTP lobby kick is host-only and revokes the removed seat', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    const [host, member, victim] = clients as [TrackedClient, TrackedClient, TrackedClient, TrackedClient];
    const path = '/rooms/' + host.auth.roomCode + '/kick';
    assert.equal((await post(harness, path, { targetPlayerId: victim.auth.playerId }, member.auth.token)).status, 403);
    const kicked = waitForEvent(victim.socket, 'player_kicked');
    assert.equal((await post(harness, path, { targetPlayerId: victim.auth.playerId }, host.auth.token)).status, 200);
    await kicked;
    await waitUntil(() => !victim.socket.connected);
    assert.equal(roomStore.get(host.auth.roomCode)!.players.has(victim.auth.playerId), false);
    await startGame(clients.filter(client => client !== victim));
    assert.equal((await post(harness, path, { targetPlayerId: member.auth.playerId }, host.auth.token)).status, 409);
  } finally { await closeHarness(harness); }
});

test('Astra: current bidder reconnects with the same private hand and locked bid', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const owner = clients[1]!;
    const ack = waitForEvent(owner.socket, 'skull_king:action_accepted');
    owner.socket.emit('skull_king:bid', { bid: 1, expectedRevision: 0 });
    await ack;
    await waitUntil(() => owner.mine?.revision === 1);
    const mine = owner.mine!;
    owner.socket.disconnect();
    const restored = await connectTracked(harness, owner.auth);
    await waitUntil(() => restored.mine?.revision === 1 && restored.game?.revision === 1);
    assert.deepEqual(restored.mine, mine);
    assert.equal(restored.mine!.roomCode, owner.auth.roomCode);
    assert.ok(restored.game!.players.every(player => player.bid === null));
    assert.match(await rejectCommand(restored, 'skull_king:bid', { bid: 0, expectedRevision: 1 }), /already locked/i);
    assert.equal(await rejectCommand(restored, 'request_state', { playerId: clients[0]!.auth.playerId }), 'Invalid payload');
    assert.equal(serverState(owner.auth.roomCode).revision, 1);
  } finally { await closeHarness(harness); }
});

test('Astra: result construction excludes abandoned and forfeited participants without erasing history', () => {
  const state = initSkullKingGame('RESULT', DIRECT_PLAYERS, () => 0.25);
  assert.equal(buildSkullKingResult(state), null);
  state.status = 'game_over';
  state.phase = 'game_over';
  state.winnerIds = [];
  assert.equal(buildSkullKingResult(state), null);
  state.players.get('alice')!.forfeited = true;
  state.players.get('alice')!.totalScore = 999;
  state.players.get('bob')!.totalScore = 100;
  state.players.get('carol')!.totalScore = 100;
  state.winnerIds = ['bob', 'carol'];
  const result = buildSkullKingResult(state)!;
  assert.deepEqual(result.players.map(player => player.playerId), ['bob', 'carol', 'dave']);
  assert.deepEqual(result.players.filter(player => player.won).map(player => player.playerId), ['bob', 'carol']);
  assert.equal(state.players.get('alice')!.totalScore, 999);
  assert.equal(toSkullKingPublicState(state).players.find(player => player.playerId === 'alice')!.totalScore, 999);
});

test('Astra: untrusted socket tokens cannot obtain any room or private projection', async () => {
  const harness = await createHarness();
  try {
    const socket = createClient(harness.url, { auth: { token: 'invalid-token' }, transports: ['websocket'], reconnection: false });
    harness.clients.push(socket);
    let frames = 0;
    for (const event of ['game_state', 'private_state', 'room_updated']) socket.on(event, () => { frames += 1; });
    const error = await waitForEvent<{ message: string }>(socket, 'connect_error');
    assert.match(error.message, /token|auth/i);
    assert.equal(frames, 0);
    assert.equal(socket.connected, false);
  } finally { await closeHarness(harness); }
});

test('Astra: duplicate bids and card races have exactly one sender receipt and one mutation', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const sender = clients[0]!;
    let acknowledgements = 0;
    let peerAcknowledgements = 0;
    sender.socket.on('skull_king:action_accepted', () => { acknowledgements += 1; });
    clients[1]!.socket.on('skull_king:action_accepted', () => { peerAcknowledgements += 1; });
    const accepted = waitForEvent<SkullKingActionAccepted>(sender.socket, 'skull_king:action_accepted');
    const rejected = waitForEvent<{ reason: string }>(sender.socket, 'action_rejected');
    sender.socket.emit('skull_king:bid', { bid: 0, expectedRevision: 0 });
    sender.socket.emit('skull_king:bid', { bid: 1, expectedRevision: 0 });
    assert.equal((await accepted).revision, 1);
    assert.match((await rejected).reason, /already locked/i);
    assert.equal(acknowledgements, 1);
    assert.equal(peerAcknowledgements, 0);
    for (const client of clients.slice(1)) {
      const ack = waitForEvent(client.socket, 'skull_king:action_accepted');
      client.socket.emit('skull_king:bid', { bid: 0, expectedRevision: 0 });
      await ack;
    }
    await waitUntil(() => clients.every(client => client.game?.revision === 3 && client.mine?.revision === 3));
    const actor = clients.find(client => client.auth.playerId === sender.game!.currentPlayerId)!;
    const card = actor.mine!.hand.find(value => actor.mine!.legalCardIds.includes(value.id))!;
    const payload = { cardId: card.id, ...(card.kind === 'tigress' ? { tigressMode: 'escape' } : {}), expectedRevision: 3 };
    const played = waitForEvent<SkullKingActionAccepted>(actor.socket, 'skull_king:action_accepted');
    const replayed = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
    actor.socket.emit('skull_king:play', payload);
    actor.socket.emit('skull_king:play', payload);
    assert.equal((await played).revision, 4);
    assert.match((await replayed).reason, /state changed/i);
    assert.equal(serverState(sender.auth.roomCode).revision, 4);
  } finally { await closeHarness(harness); }
});

for (const event of ['skull_king:bid', 'skull_king:play', 'request_state'] as const) {
  test(`Astra: ${event} recovers an overdue peer before action settlement`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      if (event === 'skull_king:play') await submitOpeningBids(clients);
      const actor = event === 'skull_king:play'
        ? clients.find(client => client.auth.playerId === clients[0]!.game!.currentPlayerId)!
        : clients[0]!;
      const departed = clients.find(client => client !== actor)!;
      const room = roomStore.get(actor.auth.roomCode)!;
      const presence = room.players.get(departed.auth.playerId)!;
      presence.isConnected = false;
      presence.socketId = null;
      presence.reconnectDeadlineAt = Date.now() - 1;
      const before = actor.game!.revision;
      const selected = actor.mine!.hand.find(card => actor.mine!.legalCardIds.includes(card.id));
      const payload = event === 'skull_king:bid' ? { bid: 0, expectedRevision: before }
        : event === 'skull_king:play' ? { cardId: selected!.id, ...(selected!.kind === 'tigress' ? { tigressMode: 'escape' } : {}), expectedRevision: before }
          : {};
      if (event === 'request_state') {
        actor.socket.emit(event, payload);
        await waitUntil(() => actor.game!.revision > before);
      } else {
        assert.match(await rejectCommand(actor, event, payload), /state changed/i);
      }
      assert.equal(serverState(room.roomCode).players.get(departed.auth.playerId)!.forfeited, true);
      assert.equal(serverState(room.roomCode).revision, before + 1);
      assert.equal(presence.hasLeft, true);
      const settled = serverState(room.roomCode).revision;
      assert.equal(recoverDisconnectedSkullKingPlayers(harness.io, room), false);
      assert.equal(serverState(room.roomCode).revision, settled);
    } finally { await closeHarness(harness); }
  });
}

test('Astra: invalid wire shapes never mutate current state or emit acknowledgements', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    let receipts = 0;
    clients[0]!.socket.on('skull_king:action_accepted', () => { receipts += 1; });
    for (const payload of [null, [], false, 0, 'bid', { bid: 0 }, { bid: 0, expectedRevision: -1 }, { bid: 0, expectedRevision: 0.5 }, { bid: 0, expectedRevision: 0, playerId: clients[1]!.auth.playerId }, { bid: 0, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.equal(await rejectCommand(clients[0]!, 'skull_king:bid', payload), 'Invalid payload');
      assert.equal(serverState(clients[0]!.auth.roomCode).revision, 0);
    }
    assert.equal(receipts, 0);
  } finally { await closeHarness(harness); }
});

test('Astra: full projection-only matches and full rematches at every supported count fence prior commands', async () => {
  const harness = await createHarness();
  let totalCommands = 0;
  try {
    for (let count = 3; count <= 8; count += 1) {
      const clients = await createTrackedRoom(harness, count);
      await startGame(clients);
      const firstCommands = await playCompleteSocketMatch(clients);
      totalCommands += firstCommands;
      const oldState = serverState(clients[0]!.auth.roomCode);
      const priorTerminalRevision = clients[0]!.game!.revision;
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      room.timer = setTimeout(() => undefined, 60_000);
      room.timer.unref();
      const accepted = waitForEvent<SkullKingActionAccepted>(
        clients[0]!.socket,
        'skull_king:action_accepted',
      );
      clients[0]!.socket.emit('start_game', {});
      const ack = await accepted;
      assert.deepEqual(ack, { action: 'start', revision: priorTerminalRevision + 1 });
      await waitUntil(() => (
        clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision)
        && clients[0]!.game?.roundNumber === 1
        && clients[0]!.game?.phase === 'bidding'
      ));
      const next = clients[0]!.game!;
      assert.equal(room.timer, null);
      assert.notEqual(serverState(clients[0]!.auth.roomCode), oldState);
      assert.equal(next.roundNumber, 1);
      assert.equal(next.phase, 'bidding');
      assert.equal(next.players.length, count);
      assert.equal(serverState(room.roomCode).biddingRevision, ack.revision);
      const rejected = waitForEvent<{ reason: string }>(clients[0]!.socket, 'action_rejected');
      clients[0]!.socket.emit('skull_king:bid', { bid: 0, expectedRevision: 0 });
      assert.match((await rejected).reason, /state changed/i);
      assert.equal(serverState(room.roomCode).revision, ack.revision);
      for (let index = 0; index < clients.length; index += 1) {
        const previous = clients[index]!;
        const hand = previous.mine!.hand;
        previous.socket.disconnect();
        const restored = await connectTracked(harness, previous.auth);
        await waitUntil(() => restored.mine?.revision === ack.revision && restored.game?.revision === ack.revision);
        assert.deepEqual(restored.mine!.hand, hand);
        assert.equal(restored.mine!.playerId, previous.auth.playerId);
        clients[index] = restored;
      }
      const rematchCommands = await playCompleteSocketMatch(clients);
      totalCommands += rematchCommands;
      console.log(`ASTRA SKULL KING ${count}P: ${firstCommands}/${rematchCommands} accepted commands in two complete projection-only games`);
      const final = serverState(room.roomCode);
      const finalResult = buildSkullKingResult(final);
      const finalRevision = final.revision;
      const lateJoin = await post(harness, '/rooms/join', { roomCode: room.roomCode, displayName: 'Late arrival' });
      assert.equal(lateJoin.status, 409);
      assert.equal((await post(harness, '/rooms/' + room.roomCode + '/leave', {}, clients[0]!.auth.token)).status, 200);
      await waitUntil(() => !clients[0]!.socket.connected);
      assert.equal(final.players.get(clients[0]!.auth.playerId)!.forfeited, false);
      assert.equal(final.revision, finalRevision);
      assert.deepEqual(buildSkullKingResult(final), finalResult);
      for (const client of clients) client.socket.disconnect();
      roomStore.delete(clients[0]!.auth.roomCode);
    }
    assert.ok(totalCommands > 1_000);
    console.log(
      'ASTRA SKULL KING SOCKET MATCHES: 6 full matches + 6 full rematches, '
        + totalCommands
        + ' accepted gameplay commands.',
    );
  } finally {
    await closeHarness(harness);
  }
});
