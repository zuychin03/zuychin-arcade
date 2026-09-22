import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket } from 'socket.io-client';
import type { BangPrivateState, BangPublicState, JoinRoomResponse, RoomPublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { supabase } from '../../lib/supabase.js';
import { roomStore } from '../../store/RoomStore.js';
import { toBangPrivateState, toBangPublicState } from './publicState.js';
import { validateBangState, type BangServerState } from './engine.js';
import {
  isBangDiscardPayload, isBangDrawPayload, isBangPlayPayload, isBangRespondPayload,
  isBangRevisionPayload, isBangSidPayload, isBangStartPayload, isBangStorePayload, isBangWinningRole,
  isBangBarrelPayload, recoverDisconnectedBangPlayers,
} from './socketHandlers.js';

process.env.JWT_SECRET ??= 'bang-test-only-secret-32-bytes-local';

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: BangPublicState | null;
  mine: BangPrivateState | null;
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function harness() {
  assert.equal(supabase, null, 'Run BANG integration tests with Supabase credentials unset');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io, {
    events: { limit: 20_000, windowMs: 10_000 },
    reactions: { limit: 100, windowMs: 5_000 },
  });
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
  async function room(count = 4, password?: string): Promise<Client[]> {
    const response = await post('/rooms/create', { displayName: 'Tester 1', gameId: 'bang', password });
    assert.equal(response.status, 201);
    const auth = await response.json() as JoinRoomResponse;
    rooms.add(auth.roomCode);
    const seats = [await connect(auth)];
    for (let index = 1; index < count; index++) {
      const joined = await post('/rooms/join', { roomCode: auth.roomCode, displayName: `Tester ${index + 1}`, password });
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

async function start(clients: Client[]): Promise<void> {
  const revision = await accepted(clients[0]!, 'start_game', {}, 'start');
  await paired(clients, revision);
}

function stateOf(client: Client) {
  const game = roomStore.get(client.auth.roomCode)?.game;
  assert.equal(game?.id, 'bang');
  return game.state;
}

function snapshot(client: Client): string {
  return JSON.stringify(stateOf(client), (_key, value: unknown) => value instanceof Map ? [...value.entries()] : value);
}

async function accepted(client: Client, event: string, payload: unknown, action: string): Promise<number> {
  const result = new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('bang:action_accepted', onAccepted);
      client.socket.off('action_rejected', onRejected);
    };
    const onAccepted = (value: { action: string; revision: number }) => {
      cleanup();
      if (value.action !== action) reject(new Error(`Expected ${action}, received ${value.action}`));
      else resolve(value.revision);
    };
    const onRejected = (value: { reason: string }) => { cleanup(); reject(new Error(`${event}: ${value.reason}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No acknowledgement for ${event}`)); }, 5_000);
    client.socket.once('bang:action_accepted', onAccepted);
    client.socket.once('action_rejected', onRejected);
  });
  client.socket.emit(event, payload);
  return result;
}

async function paired(clients: Client[], revision: number): Promise<void> {
  await waitUntil(() => clients.every(client => client.game?.revision === revision && client.mine?.revision === revision), 'paired revision');
  for (const client of clients) {
    assert.equal(client.game!.gameId, 'bang');
    assert.equal(client.mine!.gameId, 'bang');
    assert.equal(client.game!.roomCode, client.auth.roomCode);
    assert.equal(client.mine!.roomCode, client.auth.roomCode);
    assert.equal(client.mine!.playerId, client.auth.playerId);
  }
}

test('BANG payload validators reject malformed, inherited, duplicate and unbounded values', () => {
  assert(isBangStartPayload(undefined));
  assert(isBangStartPayload({}));
  for (const value of [null, [], false, 'start', { unexpected: true }, new Date()]) assert(!isBangStartPayload(value));
  const fixtures: [(value: unknown) => boolean, Record<string, unknown>][] = [
    [isBangRevisionPayload, {}],
    [isBangPlayPayload, { cardId: 'bang-1' }],
    [isBangRespondPayload, {}],
    [isBangStorePayload, { cardId: 'beer-1' }],
    [isBangDrawPayload, { useAbility: false }],
    [isBangDiscardPayload, { cardIds: ['bang-1'] }],
    [isBangSidPayload, { cardIds: ['bang-1', 'beer-1'] }],
    [isBangBarrelPayload, { source: 'barrel' }],
  ];
  for (const [validate, payload] of fixtures) {
    assert(validate({ ...payload, expectedRevision: 0 }));
    for (const revision of [undefined, null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert(!validate({ ...payload, expectedRevision: revision }));
    }
    for (const malformed of [undefined, null, [], false, 1, 'payload', Object.create({ ...payload, expectedRevision: 0 })]) assert(!validate(malformed));
    assert(!validate({ ...payload, expectedRevision: 0, forged: true }));
  }
  assert(!isBangPlayPayload({ cardId: 'bang-1', targetPlayerId: 'p1', targetZone: 'hand', targetCardId: 'hidden-1', expectedRevision: 0 }));
  assert(!isBangPlayPayload({ cardId: 'panic-1', targetPlayerId: 'p1', targetZone: 'equipment', expectedRevision: 0 }));
  assert(isBangPlayPayload({ cardId: 'panic-1', targetPlayerId: 'p1', targetZone: 'equipment', targetCardId: 'barrel-1', expectedRevision: 0 }));
  assert(!isBangRespondPayload({ cardId: '', expectedRevision: 0 }));
  assert(!isBangRespondPayload({ cardId: 'x'.repeat(129), expectedRevision: 0 }));
  assert(!isBangDiscardPayload({ cardIds: ['bang-1', 'bang-1'], expectedRevision: 0 }));
  assert(!isBangDiscardPayload({ cardIds: Array.from({ length: 81 }, (_, index) => `card-${index}`), expectedRevision: 0 }));
  assert(!isBangSidPayload({ cardIds: ['bang-1'], expectedRevision: 0 }));
  assert(!isBangDrawPayload({ useAbility: 'false', expectedRevision: 0 }));
  assert(!isBangDrawPayload({ useAbility: false, targetPlayerId: 'p1', expectedRevision: 0 }));
  assert(!isBangDrawPayload({ useAbility: true, cardIds: ['bang-1', 'beer-1'], expectedRevision: 0 }));
  assert(!isBangBarrelPayload({ source: 'forged', expectedRevision: 0 }));
});

test('BANG winning roles correctly include Outlaws and both law roles', () => {
  for (const role of ['sheriff', 'deputy', 'outlaw', 'renegade'] as const) {
    assert.equal(isBangWinningRole(role, 'law'), role === 'sheriff' || role === 'deputy');
    assert.equal(isBangWinningRole(role, 'outlaws'), role === 'outlaw');
    assert.equal(isBangWinningRole(role, 'renegade'), role === 'renegade');
    assert.equal(isBangWinningRole(role, null), false);
  }
});

test('BANG rejects malformed start payload before creating a game', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    const result = await outcome(clients[0]!, 'start_game', { unexpected: true });
    assert.equal(result.kind, 'rejected');
    assert.equal(roomStore.get(clients[0]!.auth.roomCode)!.game, null);
  } finally { await h.close(); }
});

test('BANG mutations require a revision rather than silently accepting stale clients', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === clients[0]!.game!.activePlayerId)!;
    const revision = actor.game!.revision;
    const event = actor.game!.phase === 'draw_choice' ? 'bang:choose-draw' : 'bang:end-turn';
    const payload = actor.mine!.drawChoice?.kind === 'kit_carlson'
      ? { cardIds: actor.mine!.drawChoice.options!.slice(0, 2).map(card => card.id) }
      : {};
    const result = await outcome(actor, event, payload);
    assert.equal(result.kind, 'rejected');
    assert.equal(actor.game!.revision, revision);
  } finally { await h.close(); }
});

test('BANG password lobby enforces capacity, host authority and the committed roster', async () => {
  const h = await harness();
  try {
    const clients = await h.room(7, 'frontier');
    const host = clients[0]!;
    assert.equal(host.auth.room.gameId, 'bang');
    assert.equal(host.auth.room.maxPlayers, 7);
    assert.equal(host.auth.room.hasPassword, true);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Late', password: 'wrong' })).status, 403);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Late', password: 'frontier' })).status, 409);
    assert.match((await outcome(clients[1]!, 'start_game', {})).reason ?? '', /host/i);
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, clients[1]!.auth.token)).status, 403);
    await start(clients);
    assert.equal(stateOf(host).players.size, 7);
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /progress/i);
    assert.equal((await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Late', password: 'frontier' })).status, 409);
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, host.auth.token)).status, 409);
  } finally { await h.close(); }
});

test('BANG start waits for connected seats and lobby host transfer uses current authority', async () => {
  const h = await harness();
  try {
    const clients = await h.room(3);
    const host = clients[0]!;
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /4 connected/i);
    const reserved = await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Reserved' });
    assert.equal(reserved.status, 200);
    const reservation = await reserved.json() as JoinRoomResponse;
    assert.match((await outcome(host, 'start_game', {})).reason ?? '', /connecting/i);
    const reservedClient = await h.connect(reservation);
    clients.push(reservedClient);
    const left = await h.post(`/rooms/${host.auth.roomCode}/leave`, {}, host.auth.token);
    assert.equal(left.status, 200);
    const room = roomStore.get(host.auth.roomCode)!;
    assert.notEqual(room.hostPlayerId, host.auth.playerId);
    const newHost = clients.find(client => client.auth.playerId === room.hostPlayerId)!;
    assert.equal((await h.post(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: reservedClient.auth.playerId }, host.auth.token)).status, 403);
    assert.match((await outcome(newHost, 'start_game', {})).reason ?? '', /4 connected/i);
    const replacement = await h.post('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Replacement' });
    clients.push(await h.connect(await replacement.json() as JoinRoomResponse));
    const revision = await accepted(newHost, 'start_game', {}, 'start');
    await paired(clients.filter(client => client !== host), revision);
    assert.equal(stateOf(newHost).players.has(host.auth.playerId), false);
  } finally { await h.close(); }
});

test('BANG rejects adversarial event payloads without state changes or process failure', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === clients[0]!.game!.activePlayerId)!;
    const before = snapshot(actor);
    const events = ['bang:play', 'bang:respond', 'bang:choose-store', 'bang:choose-draw', 'bang:sid-heal', 'bang:end-turn', 'bang:discard', 'bang:use-barrel', 'bang:choose-check', 'bang:rescue', 'bang:choose-discard-order'];
    for (const event of events) {
      for (const payload of [null, [], 1, false, 'payload', { expectedRevision: actor.game!.revision, cardIds: { length: 2 } }]) {
        const result = await outcome(actor, event, payload);
        assert.equal(result.kind, 'rejected', event);
        assert.match(result.reason ?? '', /invalid payload/i);
        assert.equal(snapshot(actor), before, event);
      }
    }
    assert.equal((await fetch(`${h.url}/health`)).status, 200);
  } finally { await h.close(); }
});

test('BANG sends isolated, revision-paired public and private projections and preserves them on session replacement', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const state = stateOf(clients[0]!);
    for (const client of clients) {
      // Socket.IO omits undefined optional fields.
      assert.deepEqual(client.game, JSON.parse(JSON.stringify(toBangPublicState(state, client.auth.playerId))));
      assert.deepEqual(client.mine, JSON.parse(JSON.stringify(toBangPrivateState(state, client.auth.playerId))));
      assert.equal(client.mine!.playerId, client.auth.playerId);
      for (const player of client.game!.players) assert.equal(player.role, player.role === 'sheriff' ? 'sheriff' : null);
      for (const player of state.players.values()) {
        for (const card of player.hand) assert(!JSON.stringify(client.game).includes(`"${card.id}"`), 'hidden hand card leaked in public state');
      }
    }
    const original = clients[1]!;
    const savedPrivate = original.mine;
    let replaced = false;
    original.socket.once('session_replaced', () => { replaced = true; });
    const restored = await h.connect(original.auth);
    await waitUntil(() => replaced && !original.socket.connected && restored.mine !== null, 'session replacement');
    assert.deepEqual(restored.mine, savedPrivate);
    assert.equal(roomStore.get(original.auth.roomCode)!.players.get(original.auth.playerId)!.socketId, restored.socket.id);
    restored.socket.disconnect();
    await waitUntil(() => !roomStore.get(original.auth.roomCode)!.players.get(original.auth.playerId)!.isConnected, 'disconnect presence');
    const reconnected = await h.connect(original.auth);
    await waitUntil(() => reconnected.mine !== null, 'reconnect private state');
    assert.deepEqual(reconnected.mine, savedPrivate);
    assert.equal(state.revision, 0, 'short disconnect does not mutate the game');
  } finally { await h.close(); }
});

test('BANG stale and duplicate actions commit once and acknowledge only the acting seat', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const actor = clients.find(client => client.auth.playerId === clients[0]!.game!.activePlayerId)!;
    const nonActor = clients.find(client => client !== actor)!;
    const before = snapshot(actor);
    assert.equal((await outcome(nonActor, 'bang:end-turn', { expectedRevision: actor.game!.revision })).kind, 'rejected');
    assert.equal(snapshot(actor), before);
    assert.match((await outcome(actor, 'bang:end-turn', { expectedRevision: actor.game!.revision + 1 })).reason ?? '', /state changed/i);
    assert.equal(snapshot(actor), before);
    let otherAcks = 0;
    nonActor.socket.on('bang:action_accepted', () => { otherAcks++; });
    const current = actor.game!.revision;
    const event = actor.game!.phase === 'draw_choice' ? 'bang:choose-draw' : 'bang:end-turn';
    const payload = actor.mine!.drawChoice?.kind === 'kit_carlson'
      ? { cardIds: actor.mine!.drawChoice.options!.slice(0, 2).map(card => card.id), expectedRevision: current }
      : { expectedRevision: current };
    const revision = await accepted(actor, event, payload, event === 'bang:choose-draw' ? 'choose_draw' : 'end_turn');
    await paired(clients, revision);
    assert.equal(revision, current + 1);
    const after = snapshot(actor);
    assert.match((await outcome(actor, event, payload)).reason ?? '', /state changed/i);
    assert.equal(snapshot(actor), after);
    assert.equal(otherAcks, 0);
  } finally { await h.close(); }
});

interface ProjectedAction { event: string; action: string; payload: Record<string, unknown>; }

function chooseProjectedAction(client: Client): ProjectedAction | null {
  const game = client.game!, mine = client.mine!;
  const select = (event: string, action: string, payload: Record<string, unknown> = {}): ProjectedAction => ({
    event: `bang:${event}`, action, payload: { ...payload, expectedRevision: game.revision },
  });
  if (mine.canChooseCheck) return select('choose-check', 'choose_check', { cardId: game.drawCheck!.cards.find(card => card.suit === 'hearts')?.id ?? game.drawCheck!.cards[0]!.id });
  if (mine.canChooseDiscardOrder) return select('choose-discard-order', 'discard_order', { cardIds: mine.discardOrderCards.map(card => card.id) });
  if (mine.canRescue) {
    if (mine.rescueBeerCardIds.length) return select('rescue', 'rescue', { cardId: mine.rescueBeerCardIds[0] });
    if (mine.canUseSid) return select('sid-heal', 'sid_ketchum', { cardIds: mine.hand.slice(0, 2).map(card => card.id) });
    return select('rescue', 'rescue');
  }
  if (mine.canRespond) {
    if (mine.barrelOptions.length) return select('use-barrel', 'use_barrel', { source: mine.barrelOptions[0] });
    return select('respond', 'respond', mine.responseCardIds.length ? { cardId: mine.responseCardIds[0] } : {});
  }
  if (mine.canChooseStore) return select('choose-store', 'choose_store', { cardId: game.pending!.storeCards![0]!.id });
  if (mine.canChooseDraw) {
    if (mine.drawChoice!.kind === 'kit_carlson') return select('choose-draw', 'choose_draw', { cardIds: mine.drawChoice!.options!.slice(0, 2).map(card => card.id) });
    const target = game.players.find(player => player.alive && player.playerId !== mine.playerId && player.handCount > 0);
    const useAbility = mine.drawChoice!.kind === 'jesse_jones' ? !!target : !!game.discardTop;
    return select('choose-draw', 'choose_draw', { useAbility, ...(useAbility && mine.drawChoice!.kind === 'jesse_jones' ? { targetPlayerId: target!.playerId } : {}) });
  }
  if (mine.canDiscard) {
    const health = game.players.find(player => player.playerId === mine.playerId)!.health;
    return select('discard', 'discard', { cardIds: mine.hand.slice(0, mine.hand.length - health).map(card => card.id) });
  }
  if (!mine.canPlay) return null;
  if (mine.canUseSid) return select('sid-heal', 'sid_ketchum', { cardIds: mine.hand.slice(0, 2).map(card => card.id) });
  const priorities = ['bang', 'gatling', 'indians', 'duel', 'stagecoach', 'wells_fargo', 'general_store'];
  const option = [...mine.playOptions].sort((a, b) => {
    const aPriority = priorities.indexOf(a.effectiveName), bPriority = priorities.indexOf(b.effectiveName);
    return (aPriority < 0 ? 99 : aPriority) - (bPriority < 0 ? 99 : bPriority);
  })[0];
  if (!option) return select('end-turn', 'end_turn');
  const sheriff = game.players.find(player => player.role === 'sheriff')!;
  const target = option.targets.find(candidate => mine.role === 'outlaw'
    ? candidate.playerId === sheriff.playerId
    : candidate.playerId !== sheriff.playerId) ?? option.targets[0];
  return select('play', 'play', {
    cardId: option.cardId,
    ...(target ? { targetPlayerId: target.playerId } : {}),
    ...(target && ['panic', 'cat_balou'].includes(option.effectiveName)
      ? target.hand ? { targetZone: 'hand' } : { targetZone: 'equipment', targetCardId: target.equipmentCardIds[0] }
      : {}),
  });
}

async function playProjectedGame(clients: Client[]): Promise<number> {
  let actions = 0;
  while (clients[0]!.game!.status === 'playing') {
    assert(actions < 5_000, `Projection-only game stalled at ${clients[0]!.game!.phase}`);
    let acted = false;
    for (const client of clients) {
      const choice = chooseProjectedAction(client);
      if (!choice) continue;
      const revision = await accepted(client, choice.event, choice.payload, choice.action);
      await paired(clients, revision);
      actions++;
      acted = true;
      break;
    }
    assert(acted, `No projected legal action in ${clients[0]!.game!.phase}`);
  }
  assert(clients.every(client => client.room?.status === 'finished'));
  assert(clients.every(client => client.game!.winner !== null && !client.game!.abandoned));
  assert(clients.every(client => client.game!.players.every(player => player.role !== null)));
  return actions;
}

for (const count of [4, 5, 6, 7]) {
  test(`BANG ${count} clients complete a legal game and rematch using only their projections`, async t => {
    const h = await harness();
    try {
      const clients = await h.room(count);
      await start(clients);
      assert.equal(clients[0]!.game!.revision, 0);
      const firstActions = await playProjectedGame(clients);
      const previousTerminalRevision = clients[0]!.game!.revision;
      await start(clients);
      assert.equal(clients[0]!.game!.revision, previousTerminalRevision + 1);
      assert.equal(clients[0]!.game!.turnNumber, 1);
      assert(clients.every(client => client.game!.players.every(player => player.alive && !player.forfeited)));
      const nextActor = clients.find(client => chooseProjectedAction(client) !== null)!;
      const choice = chooseProjectedAction(nextActor)!;
      const before = snapshot(nextActor);
      for (const priorRevision of [0, previousTerminalRevision]) {
        const result = await outcome(nextActor, choice.event, { ...choice.payload, expectedRevision: priorRevision });
        assert.equal(result.kind, 'rejected');
        assert.match(result.reason ?? '', /state changed/i);
        assert.equal(snapshot(nextActor), before, 'prior-game command cannot mutate the rematch');
      }
      const secondActions = await playProjectedGame(clients);
      t.diagnostic(`${count} seats: full game ${firstActions} accepted actions, rematch ${secondActions} accepted actions`);
    } finally { await h.close(); }
  });
}

test('BANG explicit leave forfeits immediately; short disconnect recovers; expired sessions cannot resume', async () => {
  const h = await harness();
  try {
    const clients = await h.room(6);
    await start(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const sheriff = clients[0]!.game!.players.find(player => player.role === 'sheriff')!.playerId;
    const temporary = clients.find(client => client.auth.playerId !== sheriff)!;
    const revision = temporary.game!.revision;
    temporary.socket.disconnect();
    await waitUntil(() => !room.players.get(temporary.auth.playerId)!.isConnected, 'temporary absence');
    assert.equal(stateOf(clients[0]!).revision, revision);
    const recovered = await h.connect(temporary.auth);
    await waitUntil(() => recovered.mine !== null, 'recovered hand');
    assert.deepEqual(recovered.mine, temporary.mine);
    const response = await h.post(`/rooms/${room.roomCode}/leave`, {}, recovered.auth.token);
    assert.equal(response.status, 200);
    await waitUntil(() => stateOf(clients[0]!).players.get(recovered.auth.playerId)!.forfeited, 'explicit forfeit');
    const forfeited = stateOf(clients[0]!).players.get(recovered.auth.playerId)!;
    assert.equal(forfeited.alive, false);
    assert.equal(forfeited.health, 0);
    assert.equal(recoverDisconnectedBangPlayers(h.io, room), false);
    const late = createClient(h.url, { auth: { token: recovered.auth.token }, transports: ['websocket'], reconnection: false });
    h.clients.push({ ...recovered, socket: late });
    let lateError = '';
    late.on('connect_error', error => { lateError = error.message; });
    late.on('server_error', error => { lateError = error.message; });
    await waitUntil(() => !!lateError && !late.connected, 'left token refused');
    assert(!late.connected);
    if (stateOf(clients[0]!).status === 'playing') {
      const expiry = clients.find(client => client !== temporary && client.auth.playerId !== sheriff)!;
      markPlayerDisconnected(h.io, room, expiry.auth.playerId, expiry.socket.id!, 0);
      await waitUntil(() => stateOf(clients[0]!).players.get(expiry.auth.playerId)!.forfeited, 'grace expiry forfeit');
      assert.equal(recoverDisconnectedBangPlayers(h.io, room), false);
      const survivors = clients.filter(client => room.players.get(client.auth.playerId)!.isConnected);
      survivors.sort((a, b) => Number(b.auth.playerId === room.hostPlayerId) - Number(a.auth.playerId === room.hostPlayerId));
      await paired(survivors, stateOf(clients[0]!).revision);
      await playProjectedGame(survivors);
      await start(survivors);
      assert.equal(survivors[0]!.game!.players.length, 4);
      assert(!room.players.has(recovered.auth.playerId));
      assert(!room.players.has(expiry.auth.playerId));
      assert(survivors[0]!.game!.players.every(player => !player.forfeited));
    }
  } finally { await h.close(); }
});

test('BANG simultaneous all-seat expiry abandons without a winner and is idempotent', async () => {
  const h = await harness();
  try {
    const clients = await h.room();
    await start(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    for (const client of clients) markPlayerDisconnected(h.io, room, client.auth.playerId, client.socket.id!, 0);
    await waitUntil(() => room.status === 'finished', 'all-seat abandonment');
    const state = stateOf(clients[0]!);
    assert.equal(state.abandoned, true);
    assert.equal(state.winner, null);
    assert([...state.players.values()].every(player => player.forfeited && !player.alive));
    const before = snapshot(clients[0]!);
    assert.equal(recoverDisconnectedBangPlayers(h.io, room), false);
    assert.equal(snapshot(clients[0]!), before);
  } finally { await h.close(); }
});

function prepareDepartureFixture(state: BangServerState, phase: 'response' | 'draw_check' | 'general_store' | 'rescue' | 'discard_order') {
  const cards = [...state.deck, ...state.discard, ...(state.pendingDraw?.options ?? []), ...[...state.players.values()].flatMap(player => [...player.hand, ...player.equipment])];
  // Reserve the unique weapon before allocating temporary card pools.
  const reservedWeapon = cards.findIndex(card => card.name === 'winchester');
  assert(reservedWeapon >= 0);
  cards.unshift(...cards.splice(reservedWeapon, 1));
  state.deck = cards;
  state.discard = [];
  state.pendingDraw = null;
  state.activeIndex = 1;
  const characters = ['bart_cassidy', 'black_jack', 'lucky_duke', 'rose_doolan', 'paul_regret', 'willy_the_kid'] as const;
  const roles = ['sheriff', 'outlaw', 'renegade', 'outlaw', 'outlaw', 'deputy'] as const;
  state.turnOrder.forEach((id, index) => {
    const player = state.players.get(id)!;
    player.character = characters[index]!;
    player.role = roles[index]!;
    player.hand = [];
    player.equipment = [];
  });
  const source = state.turnOrder[1]!, target = state.turnOrder[2]!;
  state.pending = { kind: phase === 'general_store' ? 'general_store' : 'bang', sourcePlayerId: source, targetPlayerId: target, queue: [], response: phase === 'general_store' ? null : 'missed', missesRequired: 1, missesPlayed: 0, barrelsUsed: [] };
  state.phase = phase;
  if (phase === 'general_store') {
    state.pending.storeCards = state.deck.splice(-6);
    state.pending.queue = [state.turnOrder[3]!, state.turnOrder[4]!, state.turnOrder[5]!, state.turnOrder[0]!];
  }
  if (phase === 'draw_check') {
    const barrelIndex = state.deck.findIndex(card => card.name === 'barrel');
    state.players.get(target)!.equipment.push(...state.deck.splice(barrelIndex, 1));
    state.pendingCheck = { playerId: target, kind: 'barrel', cards: state.deck.splice(-2) };
  }
  if (phase === 'rescue' || phase === 'discard_order') {
    const player = state.players.get(target)!;
    player.health = 0;
    state.damageContext = { playerId: target, amount: 1, sourcePlayerId: source, cause: 'bang' };
    if (phase === 'rescue') {
      state.pendingRescue = { playerId: target, livesNeeded: 1, sourcePlayerId: source, cause: 'bang' };
      const beerIndex = state.deck.findIndex(card => card.name === 'beer');
      player.hand.push(...state.deck.splice(beerIndex, 1));
    } else {
      player.alive = false;
      state.pendingDiscardOrder = { playerId: target, cards: state.deck.splice(-2), reason: 'elimination' };
    }
  }
  state.revision++;
  validateBangState(state);
}

for (const phase of ['response', 'draw_check', 'general_store', 'rescue', 'discard_order'] as const) {
  test(`BANG seeded ${phase} fixture: Sheriff REST leave immediately finalises an unrelated pending choice`, async () => {
    const h = await harness();
    try {
      const clients = await h.room(6);
      await start(clients);
      const state = stateOf(clients[0]!);
      prepareDepartureFixture(state, phase);
      const response = await h.post(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, clients[0]!.auth.token);
      assert.equal(response.status, 200);
      await waitUntil(() => state.players.get(clients[0]!.auth.playerId)!.forfeited, 'Sheriff departure');
      assert.equal(state.status, 'game_over', 'The departed Sheriff must end the game before another player acts');
      assert.equal(state.winner, 'outlaws');
      assert.equal(state.pending, null);
      assert.equal(state.pendingCheck, null);
      assert.equal(state.pendingRescue, null);
      assert.equal(state.pendingDiscardOrder, null);
      validateBangState(state);
    } finally { await h.close(); }
  });
  test(`BANG seeded ${phase} fixture: pending actor REST leave settles choices and conserves the deck`, async () => {
    const h = await harness();
    try {
      const clients = await h.room(6);
      await start(clients);
      const state = stateOf(clients[0]!);
      prepareDepartureFixture(state, phase);
      const sourceHand = [...state.players.get(clients[1]!.auth.playerId)!.hand];
      const response = await h.post(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, clients[2]!.auth.token);
      assert.equal(response.status, 200);
      await waitUntil(() => state.players.get(clients[2]!.auth.playerId)!.forfeited, 'pending actor departure');
      assert.equal(state.status, 'playing');
      assert.deepEqual(state.players.get(clients[1]!.auth.playerId)!.hand, sourceHand, 'Forfeit cannot pay a killer bounty');
      assert.equal(state.pendingCheck, null);
      assert.equal(state.pendingRescue, null);
      assert.equal(state.pendingDiscardOrder, null);
      if (phase === 'general_store') {
        assert.equal(state.phase, 'general_store');
        assert.equal(state.pending!.targetPlayerId, clients[3]!.auth.playerId);
        assert.equal(state.pending!.storeCards!.length, 6, 'Departure cannot take a Store card');
      } else assert.equal(state.phase, 'play');
      validateBangState(state);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      assert.equal(recoverDisconnectedBangPlayers(h.io, room), false);
    } finally { await h.close(); }
  });
}

for (const role of ['outlaw', 'deputy'] as const) {
  for (const phase of ['rescue', 'discard_order'] as const) {
    test(`BANG seeded ${role} ${phase} fixture: departure neither pays Sheriff bounty nor removes Sheriff's cards`, async () => {
      const h = await harness();
      try {
        const clients = await h.room(6);
        await start(clients);
        const state = stateOf(clients[0]!);
        prepareDepartureFixture(state, phase);
        state.activeIndex = 0;
        state.pending!.sourcePlayerId = clients[0]!.auth.playerId;
        state.damageContext!.sourcePlayerId = clients[0]!.auth.playerId;
        if (state.pendingRescue) state.pendingRescue.sourcePlayerId = clients[0]!.auth.playerId;
        const sheriff = state.players.get(clients[0]!.auth.playerId)!;
        const departed = state.players.get(clients[2]!.auth.playerId)!;
        departed.role = role;
        const fixtureWeapon = state.deck.findIndex(card => card.name === 'winchester');
        assert(fixtureWeapon >= 0);
        // Keep the reserved weapon inside the next draw to catch fixture-order regressions.
        state.deck.push(...state.deck.splice(fixtureWeapon, 1));
        const weapon = state.deck.findIndex(card => card.name === 'winchester');
        assert(weapon >= 0);
        sheriff.equipment.push(...state.deck.splice(weapon, 1));
        sheriff.hand.push(...state.deck.splice(-3));
        const before = { hand: [...sheriff.hand], equipment: [...sheriff.equipment] };
        validateBangState(state);
        assert.equal((await h.post(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, clients[2]!.auth.token)).status, 200);
        await waitUntil(() => departed.forfeited, 'victim departure');
        assert.deepEqual({ hand: sheriff.hand, equipment: sheriff.equipment }, before);
        assert.equal(state.pendingDiscardOrder, null);
        validateBangState(state);
      } finally { await h.close(); }
    });
  }
}
