import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { CoupPrivateState, CoupPublicState, JoinRoomResponse } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import {
  initGame,
  type CoupServerState,
} from './engine.js';
import {
  recoverDisconnectedCoupPlayers,
  buildCoupResult,
  isCoupActionPayload,
  isCoupChallengeDecisionPayload,
  isCoupExchangePayload,
  isCoupLoseInfluencePayload,
  isCoupRespondPayload,
  isCoupStartPayload,
} from './socketHandlers.js';

process.env.JWT_SECRET ??= 'test-only-coup-jwt-secret-64-characters-long-do-not-use-outside-tests';
assert.equal(supabase, null, 'Coup tests refuse hosted persistence; unset Supabase credentials');

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

interface Seat {
  auth: JoinRoomResponse;
  socket: ClientSocket;
  public: CoupPublicState | null;
  private: CoupPrivateState | null;
  receipts: { action: string; revision: number }[];
}

async function seatsFor(harness: Harness, count: number): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let index = 0; index < count; index++) {
    const auth = index === 0
      ? await createRoom(harness, 'Auditor 1')
      : await joinRoom(harness, seats[0]!.auth.roomCode, `Auditor ${index + 1}`);
    const socket = await connect(harness, auth.token);
    const seat: Seat = { auth, socket, public: null, private: null, receipts: [] };
    socket.on('game_state', value => { seat.public = value; });
    socket.on('private_state', value => { seat.private = value; });
    socket.on('coup:action_accepted', value => { seat.receipts.push(value); });
    seats.push(seat);
  }
  return seats;
}

async function accepted(seats: Seat[], seat: Seat, action: string, payload: unknown): Promise<number> {
  const counts = seats.map(client => client.receipts.length);
  const receipt = new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      seat.socket.off('coup:action_accepted', onAccepted);
      seat.socket.off('action_rejected', onRejected);
    };
    const onAccepted = (value: { action: string; revision: number }) => {
      cleanup();
      if (value.action !== action) reject(new Error(`Wrong acknowledgement ${value.action}`));
      else resolve(value.revision);
    };
    const onRejected = (value: { reason: string }) => { cleanup(); reject(new Error(`${action}: ${value.reason}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No receipt for ${action}`)); }, 3_000);
    seat.socket.once('coup:action_accepted', onAccepted);
    seat.socket.once('action_rejected', onRejected);
  });
  seat.socket.emit(action === 'start_game' ? action : `coup:${action}`, payload);
  const revision = await receipt;
  await waitUntil(() => seats.every(client => client.public?.revision === revision && client.private?.revision === revision));
  seats.forEach((client, index) => {
    assert.equal(client.receipts.length, counts[index]! + Number(client === seat), 'acknowledgement is sender-only');
    assert.equal(client.private!.playerId, client.auth.playerId);
    assert.equal(client.public!.players.some(player => 'influences' in player), false);
    assert.equal('exchangePool' in client.public!.pending, false);
    if (client.public!.pending.phase !== 'awaiting_exchange' || client.public!.pending.actorId !== client.auth.playerId) {
      assert.equal(client.private!.exchange, null, 'exchange pool stays with its owner');
    }
  });
  return revision;
}

async function playProjectedMatch(seats: Seat[], match: number): Promise<{ decisions: number; phases: string[] }> {
  const phases = new Set<string>();
  let decisions = 0;
  while (seats[0]!.public!.status === 'playing') {
    assert(decisions < 600, 'projection-only game must finish');
    const publicWindow = seats[0]!.public!.pending;
    const seat = seats.find(client => publicWindow.waitingOn.includes(client.auth.playerId));
    assert(seat, `No actor for ${publicWindow.phase}`);
    const view = seat.public!;
    const mine = seat.private!;
    assert.equal(view.revision, mine.revision);
    const pending = view.pending;
    phases.add(pending.phase);
    const own = view.players.find(player => player.playerId === seat.auth.playerId)!;
    const target = view.players.find(player => player.playerId !== own.playerId && !player.eliminated)!;
    const revision = view.revision;
    let action: string;
    let payload: Record<string, unknown>;
    switch (pending.phase) {
      case 'awaiting_action': {
        action = 'action';
        const claimed = ['exchange', 'tax', 'foreign_aid', 'steal', 'assassinate'][Math.floor(decisions / seats.length) % 5]!;
        const chosen = own.coins >= 7 ? 'coup'
          : decisions > 55 ? 'income'
          : claimed === 'assassinate' && own.coins < 3 ? 'income'
          : claimed === 'steal' && target.coins === 0 ? 'income' : claimed;
        payload = { action: chosen, ...(['coup', 'assassinate', 'steal'].includes(chosen) ? { targetPlayerId: target.playerId } : {}) };
        break;
      }
      case 'awaiting_action_challenge':
      case 'awaiting_block_challenge':
        action = 'respond';
        payload = { response: (decisions + match) % 4 === 0 ? 'challenge' : 'pass' };
        break;
      case 'awaiting_block': {
        action = 'respond';
        const blockers = pending.action === 'foreign_aid' ? ['duke'] : pending.action === 'assassinate' ? ['contessa'] : ['captain', 'ambassador'];
        const character = mine.influences.find(card => !card.revealed && blockers.includes(card.character))?.character;
        payload = character ? { response: 'block', blockCharacter: character } : { response: 'pass' };
        break;
      }
      case 'awaiting_challenge_decision':
        action = 'resolve_challenge';
        payload = { prove: mine.influences.some(card => !card.revealed && card.character === (pending.blockerId === own.playerId ? pending.blockCharacter : pending.claimedCharacter)) };
        break;
      case 'awaiting_lose_influence':
        action = 'lose_influence';
        payload = { character: mine.influences.find(card => !card.revealed)!.character };
        break;
      case 'awaiting_exchange':
        action = 'exchange';
        assert(mine.exchange);
        payload = { keep: mine.exchange.pool.slice(0, mine.exchange.keepCount) };
        break;
      default: throw new Error(`Unsupported phase ${pending.phase}`);
    }
    const nextRevision = await accepted(seats, seat, action, { ...payload, expectedRevision: revision });
    assert.equal(nextRevision, revision + 1);
    decisions++;
  }
  const result = seats[0]!.public!;
  assert.equal(result.players.filter(player => !player.eliminated).length, 1);
  assert.equal(result.winnerId, result.players.find(player => !player.eliminated)!.playerId);
  seats.forEach(seat => assert.deepEqual(seat.public, result));
  return { decisions, phases: [...phases] };
}

for (const count of [2, 3, 4, 5, 6]) {
  test(`Coup projection-only ${count}-seat full match and rematch, sender-only receipts`, async t => {
    const harness = await createHarness();
    try {
      const seats = await seatsFor(harness, count);
      await accepted(seats, seats[0]!, 'start_game', {});
      const first = await playProjectedMatch(seats, 0);
      const final = seats[0]!.public!;
      const refusedJoin = await fetch(`${harness.url}/rooms/join`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomCode: seats[0]!.auth.roomCode, displayName: 'Late arrival' }),
      });
      assert.equal(refusedJoin.status, 409);
      const endedAction = waitForEvent<{ reason: string }>(seats[0]!.socket, 'action_rejected');
      seats[0]!.socket.emit('coup:action', { action: 'income', expectedRevision: final.revision });
      assert.match((await endedAction).reason, /game is over/i);
      const revision = await accepted(seats, seats[0]!, 'start_game', {});
      assert.equal(revision, final.revision + 1);
      assert.equal(seats[0]!.public!.currentTurnPlayerId, final.winnerId);
      const rejected = waitForEvent<{ reason: string }>(seats[0]!.socket, 'action_rejected');
      seats[0]!.socket.emit('coup:action', { action: 'income', expectedRevision: 0 });
      assert.match((await rejected).reason, /state changed/i);
      const second = await playProjectedMatch(seats, 1);
      t.diagnostic(JSON.stringify({ count, first, second }));
    } finally { await closeHarness(harness); }
  });
}

interface Harness {
  app: FastifyInstance;
  io: Server;
  url: string;
  clients: ClientSocket[];
  roomCodes: Set<string>;
}

const PLAYER_SPECS = [
  { playerId: 'alice', displayName: 'Alice' },
  { playerId: 'bob', displayName: 'Bob' },
  { playerId: 'carol', displayName: 'Carol' },
];

function createDirectRoom(): { room: ServerRoom; state: CoupServerState; io: Server } {
  const room = roomStore.create('alice', null, 'coup', {});
  for (const player of PLAYER_SPECS) {
    roomStore.addPlayer(
      room,
      { ...player, isHost: player.playerId === 'alice' },
      Date.now() + 60_000,
    );
    roomStore.markConnected(room, player.playerId, `${player.playerId}-socket`);
  }
  const state = initGame(room.roomCode, 'base', PLAYER_SPECS);
  room.status = 'in_game';
  room.game = { id: 'coup', state };
  const io = {
    to: () => ({ emit: () => undefined }),
  } as unknown as Server;
  return { room, state, io };
}

function expirePlayer(room: ServerRoom, playerId: string, hasLeft = false): void {
  const player = roomStore.markDisconnected(room, playerId, null, Date.now() - 1);
  assert.ok(player);
  player.hasLeft = hasLeft;
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    };
    socket.once(event, onEvent);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
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
  registerSocketHandlers(io, { events: { limit: 20_000, windowMs: 10_000 }, reactions: { limit: 100, windowMs: 5_000 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, io, url: `http://127.0.0.1:${port}`, clients: [], roomCodes: new Set() };
}

async function closeHarness(harness: Harness): Promise<void> {
  for (const client of harness.clients) client.disconnect();
  for (const roomCode of harness.roomCodes) roomStore.delete(roomCode);
  await new Promise<void>((resolve) => harness.io.close(() => resolve()));
  if (harness.app.server.listening) await harness.app.close();
}

async function createRoom(harness: Harness, displayName: string): Promise<JoinRoomResponse> {
  const response = await fetch(`${harness.url}/rooms/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, gameId: 'coup' }),
  });
  assert.equal(response.status, 201);
  const joined = await response.json() as JoinRoomResponse;
  harness.roomCodes.add(joined.roomCode);
  return joined;
}

async function joinRoom(harness: Harness, roomCode: string, displayName: string): Promise<JoinRoomResponse> {
  const response = await fetch(`${harness.url}/rooms/join`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomCode, displayName }),
  });
  assert.equal(response.status, 200);
  return await response.json() as JoinRoomResponse;
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
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 2_000);
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

test('Coup socket payload validators accept only exact versioned shapes', () => {
  assert.equal(isCoupStartPayload(undefined), true);
  assert.equal(isCoupStartPayload({}), true);
  assert.equal(isCoupStartPayload(null), false);
  assert.equal(isCoupStartPayload([]), false);
  assert.equal(isCoupStartPayload({ expectedRevision: 0 }), false);

  assert.equal(isCoupActionPayload({ action: 'income', expectedRevision: 0 }), true);
  assert.equal(isCoupActionPayload({ action: 'coup', targetPlayerId: PLAYER_ID, expectedRevision: 12 }), true);
  assert.equal(isCoupActionPayload({ action: 'income' }), false);
  assert.equal(isCoupActionPayload({ action: 'income', expectedRevision: -1 }), false);
  assert.equal(isCoupActionPayload({ action: 'income', expectedRevision: 0.5 }), false);
  assert.equal(isCoupActionPayload({ action: 'income', expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(isCoupActionPayload({ action: 'Income', expectedRevision: 0 }), false);
  assert.equal(isCoupActionPayload({ action: 'coup', targetPlayerId: '', expectedRevision: 0 }), false);
  assert.equal(isCoupActionPayload({ action: 'income', expectedRevision: 0, extra: true }), false);

  assert.equal(isCoupRespondPayload({ response: 'pass', expectedRevision: 1 }), true);
  assert.equal(isCoupRespondPayload({ response: 'block', blockCharacter: 'captain', expectedRevision: 1 }), true);
  assert.equal(isCoupRespondPayload({ response: 'challenge', blockCharacter: 'duke', expectedRevision: 1 }), false);
  assert.equal(isCoupRespondPayload({ response: 'block', blockCharacter: 'spy', expectedRevision: 1 }), false);
  assert.equal(isCoupRespondPayload({ response: true, expectedRevision: 1 }), false);
  assert.equal(isCoupRespondPayload({ response: 'pass', expectedRevision: '1' }), false);
  assert.equal(isCoupRespondPayload({ response: 'pass', expectedRevision: 1, extra: true }), false);

  assert.equal(isCoupLoseInfluencePayload({ character: 'contessa', expectedRevision: 2 }), true);
  assert.equal(isCoupLoseInfluencePayload({ character: 'contessa' }), false);
  assert.equal(isCoupLoseInfluencePayload({ character: 'unknown', expectedRevision: 2 }), false);
  assert.equal(isCoupLoseInfluencePayload({ character: 'duke', expectedRevision: 2, extra: true }), false);

  assert.equal(isCoupExchangePayload({ keep: ['duke'], expectedRevision: 3 }), true);
  assert.equal(isCoupExchangePayload({ keep: ['duke', 'duke'], expectedRevision: 3 }), true);
  assert.equal(isCoupExchangePayload({ keep: [], expectedRevision: 3 }), false);
  assert.equal(isCoupExchangePayload({ keep: ['duke', 'captain', 'assassin'], expectedRevision: 3 }), false);
  assert.equal(isCoupExchangePayload({ keep: ['duke', 1], expectedRevision: 3 }), false);
  assert.equal(isCoupExchangePayload({ keep: ['duke'], expectedRevision: 3, extra: true }), false);

  assert.equal(isCoupChallengeDecisionPayload({ prove: true, expectedRevision: 4 }), true);
  assert.equal(isCoupChallengeDecisionPayload({ prove: false, expectedRevision: 4 }), true);
  assert.equal(isCoupChallengeDecisionPayload({ prove: 'true', expectedRevision: 4 }), false);
  assert.equal(isCoupChallengeDecisionPayload({ prove: true }), false);
  assert.equal(isCoupChallengeDecisionPayload({ prove: true, expectedRevision: 4, extra: true }), false);
});

test('Coup start is host-only, validates its payload and cannot reset an active game', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', { extra: true });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(roomStore.get(alice.roomCode)?.status, 'lobby');
    assert.equal(roomStore.get(alice.roomCode)?.players.has(carol.playerId), true);

    rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('start_game', {});
    assert.match((await rejected).reason, /Only the host/);
    assert.equal(roomStore.get(alice.roomCode)?.status, 'lobby');

    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    assert.equal((await started).status, 'playing');
    const originalState = roomStore.get(alice.roomCode)?.game;

    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', {});
    assert.match((await rejected).reason, /already in progress/i);
    assert.equal(roomStore.get(alice.roomCode)?.game, originalState);
  } finally {
    await closeHarness(harness);
  }
});

test('Coup rematch starts with the previous winner and clears the old room timer', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);

    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;
    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const previousState = room.game.state;
    previousState.status = 'game_over';
    previousState.winnerId = bob.playerId;
    previousState.pending.phase = 'game_over';
    previousState.pending.deadline = null;
    previousState.revision = 41;
    room.status = 'finished';

    let staleTimerFired = false;
    room.timer = setTimeout(() => {
      staleTimerFired = true;
    }, 20);
    const restarted = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    const rematch = await restarted;
    assert.equal(rematch.currentTurnPlayerId, bob.playerId);
    assert.equal(rematch.revision, 42);
    assert.notEqual(room.game.state, previousState);
    assert.equal(room.timer, null);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(staleTimerFired, false);
    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('coup:action', { action: 'income', expectedRevision: 0 });
    assert.match((await rejected).reason, /state changed/i);
    assert.equal(room.game.state.revision, 42);
  } finally {
    await closeHarness(harness);
  }
});

test('Coup reconnect replaces the old socket and restores only the owner private state', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const firstBobSocket = await connect(harness, bob.token);

    const alicePrivateIds: string[] = [];
    aliceSocket.on('private_state', (state: CoupPrivateState) => alicePrivateIds.push(state.playerId));
    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const replaced = waitForEvent(firstBobSocket, 'session_replaced');
    const disconnected = waitForEvent(firstBobSocket, 'disconnect');
    const secondBobSocket = await connect(harness, bob.token);
    await replaced;
    await disconnected;

    const bobPublic = waitForEvent<CoupPublicState>(secondBobSocket, 'game_state');
    const bobPrivate = waitForEvent<CoupPrivateState>(secondBobSocket, 'private_state');
    secondBobSocket.emit('request_state');
    const [publicState, privateState] = await Promise.all([bobPublic, bobPrivate]);
    assert.equal(privateState.playerId, bob.playerId);
    assert.equal(privateState.influences.length, 2);
    assert.equal(publicState.players.some((player) => 'influences' in player), false);
    assert.deepEqual(new Set(alicePrivateIds), new Set([alice.playerId]));

    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.players.get(bob.playerId)?.socketId, secondBobSocket.id);
    assert.equal(firstBobSocket.connected, false);
  } finally {
    await closeHarness(harness);
  }
});

test('Coup malformed mutations are rejected without changing authoritative state', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    const before = room.game?.id === 'coup' ? JSON.stringify([...room.game.state.players]) : '';

    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('coup:action', { action: 'income', expectedRevision: 0, extra: true });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(room.game?.id === 'coup' ? JSON.stringify([...room.game.state.players]) : '', before);

    aliceSocket.emit('request_state');
    await waitUntil(() => room.game?.id === 'coup' && room.game.state.status === 'playing');
  } finally {
    await closeHarness(harness);
  }
});

test('Coup rejects replayed revisions even after returning to the same actor and phase', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const state = room.game.state;
    const openingRevision = state.revision;
    aliceSocket.emit('coup:action', { action: 'income', expectedRevision: openingRevision });
    await waitUntil(() => state.revision === openingRevision + 1);

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('coup:action', { action: 'income', expectedRevision: openingRevision });
    assert.match((await rejected).reason, /state changed/i);
    assert.equal(state.revision, openingRevision + 1);

    bobSocket.emit('coup:action', { action: 'income', expectedRevision: state.revision });
    await waitUntil(() => state.revision === openingRevision + 2);
    assert.equal(state.pending.phase, 'awaiting_action');
    assert.equal(state.pending.actorId, alice.playerId);

    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('coup:action', { action: 'income', expectedRevision: openingRevision });
    assert.match((await rejected).reason, /state changed/i);
    assert.equal(state.revision, openingRevision + 2);
    assert.equal(state.players.get(alice.playerId)?.coins, 2);
  } finally {
    await closeHarness(harness);
  }
});

test('Coup grace preserves pending choices; expired target forfeits without autopilot', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    const room = roomStore.get(seats[0]!.auth.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const state = room.game.state;
    state.players.get(seats[0]!.auth.playerId)!.coins = 7;
    seats[1]!.socket.disconnect();
    await waitUntil(() => !room.players.get(seats[1]!.auth.playerId)!.isConnected);
    const connected = [seats[0]!, seats[2]!];
    await accepted(connected, seats[0]!, 'action', { action: 'coup', targetPlayerId: seats[1]!.auth.playerId, expectedRevision: state.revision });
    assert.equal(state.pending.phase, 'awaiting_lose_influence');
    assert.equal(recoverDisconnectedCoupPlayers(harness.io, room), false);
    const revision = state.revision;
    room.players.get(seats[1]!.auth.playerId)!.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(recoverDisconnectedCoupPlayers(harness.io, room), true);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.players.get(seats[1]!.auth.playerId)!.forfeited, true);
    assert.equal(state.players.get(seats[1]!.auth.playerId)!.eliminated, true);
    assert.equal(state.pending.actorId, seats[2]!.auth.playerId);
    assert.equal(recoverDisconnectedCoupPlayers(harness.io, room), false);
  } finally { await closeHarness(harness); }
});

for (const kind of ['explicit', 'expired'] as const) {
  for (const count of [1, 2, 3]) {
    test(`Coup ${kind} batch of ${count} removes every departed seat before winner evaluation`, () => {
      const { room, state, io } = createDirectRoom();
      try {
        const revision = state.revision;
        for (const id of state.turnOrder.slice(0, count)) expirePlayer(room, id, kind === 'explicit');
        assert.equal(recoverDisconnectedCoupPlayers(io, room), true);
        assert.equal(state.revision, revision + 1);
        assert.equal([...state.players.values()].filter(player => player.forfeited).length, count);
        assert.equal(state.status, count === 1 ? 'playing' : 'game_over');
        assert.equal(state.winnerId, count === 2 ? 'carol' : null);
        assert.equal(state.terminationReason, count === 3 ? 'no_players_remaining' : null);
        const result = buildCoupResult(state);
        if (count === 2) assert.deepEqual(result?.players.map(player => [player.playerId, player.won]), [['carol', true]]);
        else assert.equal(result, null);
        assert.equal(recoverDisconnectedCoupPlayers(io, room), false);
      } finally { roomStore.delete(room.roomCode); }
    });
  }
}

test('Coup expired non-waiting seat is removed before an incoming action is validated', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    const room = roomStore.get(seats[0]!.auth.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const state = room.game.state;
    seats[2]!.socket.disconnect();
    await waitUntil(() => !room.players.get(seats[2]!.auth.playerId)!.isConnected);
    room.players.get(seats[2]!.auth.playerId)!.reconnectDeadlineAt = Date.now() - 1;
    const before = state.revision;
    const coins = state.players.get(seats[0]!.auth.playerId)!.coins;
    const rejected = waitForEvent<{ reason: string }>(seats[0]!.socket, 'action_rejected');
    seats[0]!.socket.emit('coup:action', { action: 'income', expectedRevision: before });
    assert.match((await rejected).reason, /state changed/i);
    assert.equal(state.revision, before + 1);
    assert.equal(state.players.get(seats[2]!.auth.playerId)!.forfeited, true);
    assert.equal(state.players.get(seats[0]!.auth.playerId)!.coins, coins);
    assert.equal(seats[0]!.receipts.length, 1);
  } finally { await closeHarness(harness); }
});

test('Coup response timer recovers every overdue seat before granting the pending action', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    await accepted(seats, seats[0]!, 'action', { action: 'tax', expectedRevision: seats[0]!.public!.revision });
    const room = roomStore.get(seats[0]!.auth.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const state = room.game.state;
    const revision = state.revision;
    for (const seat of seats) expirePlayer(room, seat.auth.playerId);
    await waitUntil(() => state.status === 'game_over', 35_000);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.winnerId, null);
    assert.equal(state.terminationReason, 'no_players_remaining');
    assert.equal([...state.players.values()].every(player => player.forfeited && player.coins === 0), true);
    assert.equal(room.timer, null);
  } finally { await closeHarness(harness); }
});

test('Coup exchange replacement restores only its owner pool and rejects duplicate choices', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    await accepted(seats, seats[0]!, 'action', { action: 'exchange', expectedRevision: seats[0]!.public!.revision });
    for (const seat of seats.slice(1)) await accepted(seats, seat, 'respond', { response: 'pass', expectedRevision: seat.public!.revision });
    const original = seats[0]!;
    assert(original.private!.exchange);
    const ownPool = original.private!.exchange;
    const replacement = await connect(harness, original.auth.token);
    await waitUntil(() => !original.socket.connected);
    const privateState = waitForEvent<CoupPrivateState>(replacement, 'private_state');
    replacement.emit('request_state');
    const mine = await privateState;
    assert.equal(mine.playerId, original.auth.playerId);
    assert.deepEqual(mine.exchange, ownPool);
    assert(seats.slice(1).every(seat => seat.private!.exchange === null));
    const payload = { keep: mine.exchange!.pool.slice(0, mine.exchange!.keepCount), expectedRevision: mine.revision };
    const ack = waitForEvent<{ action: string; revision: number }>(replacement, 'coup:action_accepted');
    replacement.emit('coup:exchange', payload);
    assert.deepEqual(await ack, { action: 'exchange', revision: mine.revision + 1 });
    const rejected = waitForEvent<{ reason: string }>(replacement, 'action_rejected');
    replacement.emit('coup:exchange', payload);
    assert.match((await rejected).reason, /state changed/i);
  } finally { await closeHarness(harness); }
});

for (const phase of ['awaiting_action', 'awaiting_action_challenge', 'awaiting_block', 'awaiting_block_challenge', 'awaiting_challenge_decision', 'awaiting_lose_influence', 'awaiting_exchange'] as const) {
  for (const departure of ['REST leave', 'zero-grace lifecycle expiry'] as const) {
    test(`Coup ${phase}: ${departure} removes its pending actor and settles the window`, async () => {
      const harness = await createHarness();
      try {
        const seats = await seatsFor(harness, 4);
        await accepted(seats, seats[0]!, 'start_game', {});
        const room = roomStore.get(seats[0]!.auth.roomCode)!;
        assert.equal(room.game?.id, 'coup');
        if (room.game?.id !== 'coup') return;
        const state = room.game.state;
        const send = (index: number, action: string, payload: Record<string, unknown>) => accepted(seats, seats[index]!, action, { ...payload, expectedRevision: seats[index]!.public!.revision });
        let departed = seats[0]!;
        if (phase === 'awaiting_action_challenge' || phase === 'awaiting_challenge_decision') {
          await send(0, 'action', { action: 'tax' });
          if (phase === 'awaiting_challenge_decision') await send(1, 'respond', { response: 'challenge' });
          else departed = seats[1]!;
        } else if (phase === 'awaiting_block' || phase === 'awaiting_block_challenge') {
          await send(0, 'action', { action: 'foreign_aid' });
          departed = seats[1]!;
          if (phase === 'awaiting_block_challenge') await send(1, 'respond', { response: 'block', blockCharacter: 'duke' });
        } else if (phase === 'awaiting_lose_influence') {
          state.players.get(seats[0]!.auth.playerId)!.coins = 7;
          await send(0, 'action', { action: 'coup', targetPlayerId: seats[1]!.auth.playerId });
          departed = seats[1]!;
        } else if (phase === 'awaiting_exchange') {
          await send(0, 'action', { action: 'exchange' });
          for (let index = 1; index < seats.length; index++) await send(index, 'respond', { response: 'pass' });
        }
        assert.equal(state.pending.phase, phase);
        const revision = state.revision;
        if (departure === 'REST leave') {
          const response = await fetch(`${harness.url}/rooms/${room.roomCode}/leave`, {
            method: 'POST', headers: { authorization: `Bearer ${departed.auth.token}` },
          });
          assert.equal(response.status, 200);
        } else {
          assert(markPlayerDisconnected(harness.io, room, departed.auth.playerId, departed.socket.id!, 0));
        }
        await waitUntil(() => state.players.get(departed.auth.playerId)!.forfeited);
        assert.equal(state.revision, revision + 1);
        assert.equal(state.players.get(departed.auth.playerId)!.coins, 0);
        assert.equal(state.status, 'playing');
        const survivor = seats.find(seat => seat !== departed)!;
        await waitUntil(() => survivor.public?.revision === state.revision);
        assert(!survivor.public!.pending.waitingOn.includes(departed.auth.playerId));
        assert(state.deck.length + [...state.players.values()].reduce((total, player) => total + player.influences.length, 0)
          + (state.pending.exchangePool ? state.pending.exchangePool.length - state.pending.exchangeKeep : 0) === 15);
        assert.equal(recoverDisconnectedCoupPlayers(harness.io, room), false);
      } finally { await closeHarness(harness); }
    });
  }
}

test('Coup competing same-revision responses accept one sender and reject the stale peer', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    await accepted(seats, seats[0]!, 'action', { action: 'tax', expectedRevision: 0 });
    const revision = seats[0]!.public!.revision;
    const outcomes = seats.slice(1).map(seat => new Promise<string>(resolve => {
      seat.socket.once('coup:action_accepted', () => resolve('accepted'));
      seat.socket.once('action_rejected', () => resolve('rejected'));
    }));
    seats[1]!.socket.emit('coup:respond', { response: 'challenge', expectedRevision: revision });
    seats[2]!.socket.emit('coup:respond', { response: 'challenge', expectedRevision: revision });
    assert.deepEqual((await Promise.all(outcomes)).sort(), ['accepted', 'rejected']);
    await waitUntil(() => seats.every(seat => seat.public?.revision === revision + 1));
    assert.equal(seats[0]!.public!.pending.phase, 'awaiting_challenge_decision');
    assert.equal(seats[0]!.receipts.length, 2);
  } finally { await closeHarness(harness); }
});

test('Coup every malformed mutation is rejected with no revision, card, coin or acknowledgement change', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 2);
    await accepted(seats, seats[0]!, 'start_game', {});
    const room = roomStore.get(seats[0]!.auth.roomCode)!;
    const snapshot = () => JSON.stringify(room.game, (_key, value) => value instanceof Map || value instanceof Set ? [...value] : value);
    const before = snapshot();
    for (const event of ['action', 'respond', 'lose_influence', 'exchange', 'resolve_challenge']) {
      for (const payload of [null, [], {}, { expectedRevision: -1 }, { expectedRevision: 0, forged: true }]) {
        const rejected = waitForEvent<{ reason: string }>(seats[0]!.socket, 'action_rejected');
        seats[0]!.socket.emit(`coup:${event}`, payload);
        assert.equal((await rejected).reason, 'Invalid payload');
        assert.equal(snapshot(), before);
        assert.equal(seats[0]!.receipts.length, 1);
      }
    }
  } finally { await closeHarness(harness); }
});

test('Coup real HTTP password, reservation, capacity, variant and cross-room authority fences', async () => {
  const harness = await createHarness();
  try {
    const post = (route: string, payload: unknown, token?: string) => fetch(`${harness.url}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload),
    });
    const created = await post('/rooms/create', { displayName: 'Host', gameId: 'coup', password: 'local-only' });
    assert.equal(created.status, 201);
    const host = await created.json() as JoinRoomResponse;
    harness.roomCodes.add(host.roomCode);
    const hostSocket = await connect(harness, host.token);
    const wrong = await post('/rooms/join', { roomCode: host.roomCode, displayName: 'Guest', password: 'wrong' });
    assert.equal(wrong.status, 403);
    const join = await post('/rooms/join', { roomCode: host.roomCode, displayName: 'Guest', password: 'local-only' });
    assert.equal(join.status, 200);
    const guest = await join.json() as JoinRoomResponse;
    const rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejected).reason, /connecting/i);
    assert.equal(roomStore.get(host.roomCode)!.game, null);
    await connect(harness, guest.token);
    for (let index = 2; index < 6; index++) {
      const response = await post('/rooms/join', { roomCode: host.roomCode, displayName: `Guest ${index}`, password: 'local-only' });
      assert.equal(response.status, 200);
      await connect(harness, (await response.json() as JoinRoomResponse).token);
    }
    const overCapacity = await post('/rooms/join', { roomCode: host.roomCode, displayName: 'Seventh', password: 'local-only' });
    assert.equal(overCapacity.status, 409);
    const variant = await post('/rooms/create', { displayName: 'Variant', gameId: 'coup', config: { coupVariant: 'reformation' } });
    assert.equal(variant.status, 201);
    const forcedBase = await variant.json() as JoinRoomResponse;
    harness.roomCodes.add(forcedBase.roomCode);
    assert.equal(forcedBase.room.config.coupVariant, 'base');
    const other = await createRoom(harness, 'Other host');
    const forbidden = await post(`/rooms/${other.roomCode}/leave`, {}, host.token);
    assert.equal(forbidden.status, 403);
    const unauthorised = await post(`/rooms/${host.roomCode}/leave`, {});
    assert.equal(unauthorised.status, 401);
    assert.equal(roomStore.get(host.roomCode)!.players.size, 6);
  } finally { await closeHarness(harness); }
});

test('Coup a completed natural loss remains a result row after its spectator leaves', () => {
  const { room, state, io } = createDirectRoom();
  try {
    const eliminated = state.players.get('alice')!;
    eliminated.influences.forEach(card => { card.revealed = true; });
    eliminated.eliminated = true;
    expirePlayer(room, 'alice', true);
    assert.equal(recoverDisconnectedCoupPlayers(io, room), false);
    assert.equal(eliminated.forfeited, false);
    expirePlayer(room, 'bob', true);
    assert.equal(recoverDisconnectedCoupPlayers(io, room), true);
    assert.deepEqual(buildCoupResult(state)?.players.map(player => [player.playerId, player.won]), [['alice', false], ['carol', true]]);
  } finally { roomStore.delete(room.roomCode); }
});

test('Coup canonical proved claim retains the sole survivor owed loss after both peers REST-leave', async () => {
  const harness = await createHarness();
  try {
    const seats = await seatsFor(harness, 3);
    await accepted(seats, seats[0]!, 'start_game', {});
    const room = roomStore.get(seats[0]!.auth.roomCode)!;
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const state = room.game.state;
    const actorCard = state.players.get(seats[0]!.auth.playerId)!.influences[0]!;
    if (actorCard.character !== 'duke') {
      const deckIndex = state.deck.indexOf('duke');
      if (deckIndex >= 0) {
        state.deck[deckIndex] = actorCard.character;
      } else {
        const donor = [...state.players.values()].flatMap(player => player.influences).find(card => card.character === 'duke');
        assert(donor);
        donor.character = actorCard.character;
      }
      actorCard.character = 'duke';
    }
    await accepted(seats, seats[0]!, 'action', { action: 'tax', expectedRevision: state.revision });
    await accepted(seats, seats[1]!, 'respond', { response: 'challenge', expectedRevision: state.revision });
    await accepted(seats, seats[0]!, 'resolve_challenge', { prove: true, expectedRevision: state.revision });
    assert.equal(state.pending.phase, 'awaiting_lose_influence');
    for (const index of [0, 2]) {
      const response = await fetch(`${harness.url}/rooms/${room.roomCode}/leave`, {
        method: 'POST', headers: { authorization: `Bearer ${seats[index]!.auth.token}` },
      });
      assert.equal(response.status, 200);
      await waitUntil(() => state.players.get(seats[index]!.auth.playerId)!.forfeited);
    }
    assert.equal(state.status, 'playing');
    assert.equal(room.status, 'in_game');
    assert.equal(state.winnerId, null);
    assert.equal(buildCoupResult(state), null);
    assert.equal(state.pending.losingPlayerId, seats[1]!.auth.playerId);
    assert.equal(state.players.get(seats[1]!.auth.playerId)!.influences.filter(card => !card.revealed).length, 2);
    await waitUntil(() => seats[1]!.private?.revision === state.revision);
    await accepted([seats[1]!], seats[1]!, 'lose_influence', {
      character: seats[1]!.private!.influences.find(card => !card.revealed)!.character,
      expectedRevision: state.revision,
    });
    assert.equal(state.status, 'game_over');
    assert.equal(state.winnerId, seats[1]!.auth.playerId);
    assert.equal(state.players.get(seats[1]!.auth.playerId)!.influences.filter(card => !card.revealed).length, 1);
    assert.deepEqual(buildCoupResult(state)?.players.map(player => [player.playerId, player.won]), [[seats[1]!.auth.playerId, true]]);
  } finally { await closeHarness(harness); }
});
test('explicit Coup leave forfeits immediately, transfers host and blocks token reuse', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    const started = waitForEvent<CoupPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const disconnected = waitForEvent(aliceSocket, 'disconnect');
    const response = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/leave`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ retainedForGameRecovery: boolean }>().retainedForGameRecovery, true);
    await disconnected;

    const room = roomStore.get(alice.roomCode)!;
    await waitUntil(
      () => room.game?.id === 'coup' && room.game.state.players.get(alice.playerId)?.eliminated === true,
    );
    assert.equal(room.hostPlayerId, bob.playerId);
    assert.equal(room.players.get(bob.playerId)?.isHost, true);
    assert.equal(room.players.get(alice.playerId)?.hasLeft, true);
    assert.equal(room.game?.id, 'coup');
    if (room.game?.id !== 'coup') return;
    const forfeited = room.game.state.players.get(alice.playerId)!;
    assert.equal(forfeited.coins, 0);
    assert.equal(forfeited.influences.every((influence) => influence.revealed), true);
    assert.equal(room.game.state.pending.actorId, bob.playerId);
    assert.equal(room.status, 'in_game');

    const deniedSocket = createClient(harness.url, {
      auth: { token: alice.token },
      forceNew: true,
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
    });
    harness.clients.push(deniedSocket);
    const denied = waitForEvent<{ message: string }>(deniedSocket, 'server_error');
    deniedSocket.connect();
    assert.match((await denied).message, /no longer exists|no longer available/i);
    await waitUntil(() => !deniedSocket.connected);
  } finally {
    await closeHarness(harness);
  }
});
