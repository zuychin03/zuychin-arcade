import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import type {
  JoinRoomResponse,
  NotAloneActionAccepted,
  NotAloneBoardFace,
  NotAloneHuntCardId,
  NotAlonePrivateState,
  NotAlonePublicState,
  NotAloneSurvivalCardId,
  RoomPublicState,
} from '@zuychin-arcade/types';
import { NOT_ALONE_CONTENT_SET, NOT_ALONE_RULES_VERSION, NOT_ALONE_SURVIVAL_CARDS } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { chooseProjectionCommand } from '../../../scripts/not-alone/projectionDriver.js';
import { initNotAloneGame, validateNotAloneState, type NotAloneServerState } from './engine.js';
import { toNotAlonePrivateState } from './publicState.js';
import {
  isNotAloneCardChoicePayload,
  isNotAloneHuntCardPayload,
  isNotAlonePlaceTokenPayload,
  isNotAloneResolvePayload,
  isNotAloneResistPayload,
  isNotAloneRevisionPayload,
  isNotAloneSelectPayload,
  isNotAloneStartPayload,
  isNotAloneSurvivalPayload,
  buildNotAloneResult,
  recoverDisconnectedNotAlonePlayers,
} from './socketHandlers.js';

process.env.JWT_SECRET ??= 'not-alone-test-only-secret-32-bytes';

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
  game: NotAlonePublicState | null;
  mine: NotAlonePrivateState | null;
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 10_000): Promise<T> {
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

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createHarness(): Promise<Harness> {
  assert.equal(supabase, null, 'Protocol tests refuse hosted result persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io, {
    events: { limit: 10_000, windowMs: 10_000 },
    reactions: { limit: 10_000, windowMs: 5_000 },
  });
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
  const response = await harness.app.inject({ method: 'POST', url: '/rooms/create', payload: { displayName, gameId: 'not_alone' } });
  assert.equal(response.statusCode, 201, response.body);
  const auth = response.json<JoinRoomResponse>();
  harness.roomCodes.add(auth.roomCode);
  return auth;
}

async function joinRoom(harness: Harness, roomCode: string, displayName: string): Promise<JoinRoomResponse> {
  const response = await harness.app.inject({ method: 'POST', url: '/rooms/join', payload: { roomCode, displayName } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<JoinRoomResponse>();
}

async function connect(harness: Harness, token: string): Promise<ClientSocket> {
  const socket = createClient(harness.url, { auth: { token }, forceNew: true, reconnection: false, transports: ['websocket'] });
  harness.clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 5_000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
  });
  return socket;
}

async function connectTracked(harness: Harness, auth: JoinRoomResponse): Promise<TrackedClient> {
  const socket = await connect(harness, auth.token);
  const tracked: TrackedClient = { auth, socket, room: null, game: null, mine: null };
  socket.on('room_updated', (room: RoomPublicState) => { tracked.room = room; });
  socket.on('game_state', (game: NotAlonePublicState) => { tracked.game = game; });
  socket.on('private_state', (mine: NotAlonePrivateState) => { tracked.mine = mine; });
  socket.emit('request_state');
  await waitUntil(() => tracked.room !== null);
  return tracked;
}

async function createTrackedRoom(harness: Harness, count: number): Promise<TrackedClient[]> {
  const auths = [await createRoom(harness, 'Explorer 1')];
  for (let index = 1; index < count; index += 1) auths.push(await joinRoom(harness, auths[0]!.roomCode, `Explorer ${index + 1}`));
  const clients: TrackedClient[] = [];
  for (const auth of auths) clients.push(await connectTracked(harness, auth));
  return clients;
}

function serverState(roomCode: string): NotAloneServerState {
  const game = roomStore.get(roomCode)?.game;
  assert.equal(game?.id, 'not_alone');
  return game.state;
}

async function emitAccepted(
  client: TrackedClient,
  event: string,
  payload: unknown,
  action: NotAloneActionAccepted['action'],
): Promise<NotAloneActionAccepted> {
  const accepted = new Promise<NotAloneActionAccepted>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      client.socket.off('notalone:action_accepted', onAccepted);
      client.socket.off('action_rejected', onRejected);
    };
    const onAccepted = (value: NotAloneActionAccepted) => { cleanup(); resolve(value); };
    const onRejected = (value: { reason?: string }) => {
      cleanup();
      reject(new Error(`Action rejected: ${value.reason ?? 'unknown reason'}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for notalone:action_accepted'));
    }, 10_000);
    client.socket.once('notalone:action_accepted', onAccepted);
    client.socket.once('action_rejected', onRejected);
  });
  client.socket.emit(event, payload);
  const ack = await accepted.catch((error: unknown) => {
    throw new Error(`${event} from ${client.auth.playerId} timed out: ${error instanceof Error ? error.message : String(error)}`);
  });
  assert.equal(ack.action, action);
  return ack;
}

async function emitRejected(client: TrackedClient, event: string, payload: unknown): Promise<string> {
  const result = new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      client.socket.off('notalone:action_accepted', onAccepted);
      client.socket.off('action_rejected', onRejected);
    };
    const onAccepted = (value: NotAloneActionAccepted) => {
      cleanup();
      reject(new Error(`Unexpected accepted acknowledgement for ${value.action}`));
    };
    const onRejected = (value: { reason?: string }) => { cleanup(); resolve(value.reason ?? ''); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event} rejection`)); }, 5_000);
    client.socket.once('notalone:action_accepted', onAccepted);
    client.socket.once('action_rejected', onRejected);
  });
  client.socket.emit(event, payload);
  return result;
}

function forceHuntCardToHand(state: NotAloneServerState, cardId: NotAloneHuntCardId): void {
  if (state.huntHand.includes(cardId)) return;
  const zones = [state.huntDeck, state.huntDiscard, state.pendingHuntDiscard];
  const source = zones.find((zone) => zone.includes(cardId));
  assert.ok(source, `${cardId} is missing from the Hunt manifest`);
  const sourceIndex = source.indexOf(cardId);
  const displaced = state.huntHand[0]!;
  source[sourceIndex] = displaced;
  state.huntHand[0] = cardId;
  validateNotAloneState(state);
}

async function emitConcurrent(
  actions: { client: TrackedClient; event: string; payload: unknown; action: NotAloneActionAccepted['action'] }[],
): Promise<void> {
  const waits = actions.map(({ client }) => waitForEvent<NotAloneActionAccepted>(client.socket, 'notalone:action_accepted'));
  for (const item of actions) item.client.socket.emit(item.event, item.payload);
  const acknowledgements = await Promise.all(waits);
  acknowledgements.forEach((ack, index) => assert.equal(ack.action, actions[index]!.action));
}

async function startGame(clients: TrackedClient[], face?: NotAloneBoardFace): Promise<void> {
  const expectedRevision = clients[0]!.game ? clients[0]!.game!.revision + 1 : 0;
  const payload = face ? { boardFace: face } : {};
  const ack = await emitAccepted(clients[0]!, 'start_game', payload, 'start');
  assert.equal(ack.revision, expectedRevision);
  await waitUntil(() => clients.every((client) => client.game?.phase === 'hunted_planning'
    && client.game.revision === ack.revision && client.mine?.revision === ack.revision));
  assert.ok(clients.every((client) => client.game?.rulesVersion === NOT_ALONE_RULES_VERSION
    && client.game.contentSet === NOT_ALONE_CONTENT_SET));
}

function assignLowReactionStartingHands(state: NotAloneServerState): void {
  const phaseOne: NotAloneSurvivalCardId[] = ['adrenaline', 'ingenuity', 'sacrifice', 'sixth_sense', 'smokescreen', 'strike_back'];
  for (const playerId of state.huntedOrder) state.players.get(playerId)!.survivalHand = [];
  state.survivalDiscard = [];
  state.pendingSurvivalDiscard = [];
  state.pendingSurvivalChoice = null;
  state.survivalDeck = NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id);
  state.huntedOrder.forEach((playerId, index) => {
    const card = phaseOne[index]!;
    state.players.get(playerId)!.survivalHand = [card];
    state.survivalDeck.splice(state.survivalDeck.indexOf(card), 1);
  });
}

async function passEligible(clientsById: Map<string, TrackedClient>, state: NotAloneServerState): Promise<number> {
  const revision = state.reactionWindowRevision;
  const actions = state.huntedOrder.flatMap((playerId) => {
    const client = clientsById.get(playerId);
    return client && toNotAlonePrivateState(state, playerId).canPass
      ? [{ client, event: 'notalone:pass', payload: { expectedRevision: revision }, action: 'pass' as const }]
      : [];
  });
  if (actions.length) await emitConcurrent(actions);
  return actions.length;
}

async function playCompleteSocketMatch(clients: TrackedClient[]): Promise<number> {
  let commands = 0;
  while (clients[0]!.game!.status === 'playing' && commands < 4_000) {
    const revision = clients[0]!.game!.revision;
    await waitUntil(() => clients.every((client) => client.game?.revision === revision && client.mine?.revision === revision));
    let acted = false;
    for (const client of clients) {
      assert.equal(client.mine!.playerId, client.auth.playerId);
      assert.equal(client.mine!.roomCode, client.auth.roomCode);
      assert.equal(client.game!.viewerPlayerId, client.auth.playerId);
      const decision = chooseProjectionCommand(client.game!, client.mine!);
      if (!decision) continue;
      const ack = await emitAccepted(client, decision.event, decision.payload, decision.action);
      assert.ok(ack.revision > revision);
      await waitUntil(() => clients.every((peer) => peer.game?.revision === ack.revision && peer.mine?.revision === ack.revision));
      commands += 1;
      acted = true;
      break;
    }
    assert.ok(acted, `No projection-legal action at revision ${revision}, phase ${clients[0]!.game!.phase}`);
  }
  assert.ok(commands < 4_000, 'Socket match exceeded the command limit');
  assert.equal(clients[0]!.game!.status, 'game_over');
  assert.notEqual(clients[0]!.game!.winner, null);
  assert.equal(clients[0]!.game!.endReason, 'track');
  await waitUntil(() => clients.every((client) => client.room?.status === 'finished'));
  return commands;
}

async function reconnectClients(harness: Harness, clients: TrackedClient[]): Promise<TrackedClient[]> {
  for (const client of clients) client.socket.disconnect();
  const replacements: TrackedClient[] = [];
  for (const client of clients) replacements.push(await connectTracked(harness, client.auth));
  return replacements;
}

async function playUntilNextRound(clients: TrackedClient[], round: number): Promise<number> {
  let commands = 0;
  while (clients[0]!.game!.roundNumber === round && clients[0]!.game!.status === 'playing') {
    assert.ok(commands < 300, 'Round did not settle from owned wire choices');
    await waitUntil(() => clients.every((client) => client.game?.revision === clients[0]!.game?.revision
      && client.mine?.revision === clients[0]!.game?.revision));
    const revision = clients[0]!.game!.revision;
    const owned = clients.map((client) => ({ client, command: chooseProjectionCommand(client.game!, client.mine!) }))
      .find((candidate) => candidate.command !== null);
    assert.ok(owned?.command, `No projected choice in ${clients[0]!.game!.phase}`);
    const ack = await emitAccepted(owned.client, owned.command.event, owned.command.payload, owned.command.action);
    assert.ok(ack.revision > revision);
    await waitUntil(() => clients.every((client) => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
    commands++;
  }
  return commands;
}

for (const departure of ['REST leave', 'scheduled expiry'] as const) {
  test(`NOT ALONE ${departure} keeps only current-round ghost and archives before new planning`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const departed = clients[3]!;
      const goals = [clients[0]!.game!.rescueGoal, clients[0]!.game!.assimilationGoal];
      const revision = clients[0]!.game!.revision;
      if (departure === 'REST leave') {
        const response = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
          headers: { authorization: `Bearer ${departed.auth.token}` } });
        assert.equal(response.statusCode, 200);
      } else {
        const seat = room.players.get(departed.auth.playerId)!;
        assert.equal(markPlayerDisconnected(harness.io, room, seat.playerId, seat.socketId, 25), true);
      }
      const active = clients.slice(0, 3);
      await waitUntil(() => active.every((client) => client.game?.players.some((seat) => seat.playerId === departed.auth.playerId && seat.forfeited)
        && client.mine?.revision === client.game?.revision));
      assert.ok(state.huntedOrder.includes(departed.auth.playerId), 'Ghost removed before this round could settle');
      assert.equal(toNotAlonePrivateState(state, departed.auth.playerId).canSelect, false);
      assert.equal(toNotAlonePrivateState(state, departed.auth.playerId).cardChoice, null);
      assert.match(await emitRejected(active[1]!, 'notalone:select', { placeIds: [1], expectedRevision: revision }), /changed/i);
      const commands = await playUntilNextRound(active, 1);
      assert.equal(active[0]!.game!.roundNumber, 2);
      assert.equal(active[0]!.game!.status, 'playing');
      assert.equal(state.huntedOrder.includes(departed.auth.playerId), false, 'Ghost retained in the next round');
      assert.equal(state.turnOrder.includes(departed.auth.playerId), false);
      assert.deepEqual(state.players.get(departed.auth.playerId)!.survivalHand, []);
      assert.equal(active[0]!.mine!.huntOptions.targetPlayerIds.includes(departed.auth.playerId), false);
      for (const client of active) {
        assert.equal(client.game!.huntedOrder.includes(departed.auth.playerId), false);
        assert.equal(client.game!.players.length, 4, 'Historical roster was erased');
        const archived = client.game!.players.find((seat) => seat.playerId === departed.auth.playerId)!;
        assert.equal(archived.forfeited, true);
        assert.equal(archived.isReady, false);
        assert.deepEqual(archived.revealedPlaces, []);
        assert.equal('placeHand' in archived, false);
        assert.equal('survivalHand' in archived, false);
        assert.deepEqual([client.game!.rescueGoal, client.game!.assimilationGoal], goals);
      }
      const snapshot = structuredClone(active[1]!.mine);
      const restored = await connectTracked(harness, active[1]!.auth);
      await waitUntil(() => restored.mine?.revision === snapshot!.revision && restored.game?.revision === snapshot!.revision);
      assert.deepEqual(restored.mine, snapshot);
      assert.equal(restored.game!.viewerPlayerId, restored.auth.playerId);
      assert.equal(restored.mine!.roomCode, room.roomCode);
      assert.deepEqual(restored.mine!.huntHand, []);
      const expired = createClient(harness.url, {
        auth: { token: departed.auth.token }, forceNew: true, reconnection: false, transports: ['websocket'], autoConnect: false,
      });
      harness.clients.push(expired);
      let leaked = 0;
      expired.on('private_state', () => { leaked++; });
      const refused = waitForEvent<{ message: string }>(expired, 'server_error');
      expired.connect();
      assert.match((await refused).message, /expired|left|no longer|seat/i);
      await waitUntil(() => expired.disconnected);
      assert.equal(leaked, 0, 'Archived credentials regained a private view');
      const continuation = [active[0]!, restored, active[2]!];
      const archivedBefore = structuredClone(state.players.get(departed.auth.playerId)!);
      await playUntilNextRound(continuation, 2);
      assert.deepEqual(state.players.get(departed.auth.playerId), archivedBefore, 'Archived seat gained another automatic turn/resource');
      validateNotAloneState(state);
      console.log(`NOT ALONE POLICY ${departure}: ${commands} wire decisions to first boundary; second round verified.`);
    } finally {
      await closeHarness(harness);
    }
  });
}

for (const departingRole of ['creature', 'last_hunted'] as const) {
  test(`NOT ALONE explicit ${departingRole} leave ends immediately and completed eligibility stays immutable`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 2);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const departed = clients[departingRole === 'creature' ? 0 : 1]!;
      const survivor = clients[departingRole === 'creature' ? 1 : 0]!;
      const response = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
        headers: { authorization: `Bearer ${departed.auth.token}` } });
      assert.equal(response.statusCode, 200);
      await waitUntil(() => survivor.game?.status === 'game_over' && survivor.room?.status === 'finished');
      const state = serverState(room.roomCode);
      assert.equal(state.endReason, 'forfeit');
      assert.equal(state.winner, departingRole === 'creature' ? 'hunted' : 'creature');
      assert.equal(state.revision, 1);
      assert.equal(state.rescueProgress, 0);
      assert.equal(state.assimilationProgress, 0);
      const result = structuredClone(buildNotAloneResult(state));
      assert.ok(result);
      assert.deepEqual(result.players.map((seat) => ({ playerId: seat.playerId, won: seat.won })), [{ playerId: survivor.auth.playerId, won: true }]);
      const completed = structuredClone({ ...state, rng: undefined });
      const left = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
        headers: { authorization: `Bearer ${survivor.auth.token}` } });
      assert.equal(left.statusCode, 200);
      assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, room), false);
      assert.deepEqual({ ...state, rng: undefined }, completed);
      assert.deepEqual(buildNotAloneResult(state), result);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('NOT ALONE real scheduler batches all overdue seats without awarding a phantom side', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = serverState(room.roomCode);
    for (const client of clients) {
      const player = room.players.get(client.auth.playerId)!;
      assert.equal(markPlayerDisconnected(harness.io, room, player.playerId, player.socketId, 60_000), true);
      roomStore.clearPresenceTimer(player);
      player.reconnectDeadlineAt = Date.now() - 1;
    }
    const trigger = room.players.get(clients[0]!.auth.playerId)!;
    assert.equal(markPlayerDisconnected(harness.io, room, trigger.playerId, null, 0), true);
    await waitUntil(() => state.status === 'game_over');
    assert.equal(state.revision, 1);
    assert.equal(state.winner, null);
    assert.equal(state.endReason, 'forfeit');
    assert.ok([...state.players.values()].every((seat) => seat.forfeited));
    assert.equal(buildNotAloneResult(state), null);
    assert.equal(room.status, 'finished');
    assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, room), false);
  } finally {
    await closeHarness(harness);
  }
});

for (const trigger of ['request_state', 'notalone:select'] as const) {
  test(`NOT ALONE ${trigger} batches delayed partial expiry then removes both ghosts at the boundary`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 5);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const goals = [state.rescueGoal, state.assimilationGoal];
      const ids = clients.slice(3).map((client) => client.auth.playerId);
      for (const id of ids) {
        const seat = room.players.get(id)!;
        assert.equal(markPlayerDisconnected(harness.io, room, id, seat.socketId, 60_000), true);
        roomStore.clearPresenceTimer(seat);
        seat.reconnectDeadlineAt = Date.now() - 1;
      }
      if (trigger === 'request_state') clients[1]!.socket.emit(trigger);
      else assert.match(await emitRejected(clients[1]!, trigger, { placeIds: [1], expectedRevision: 0 }), /changed/i);
      const active = clients.slice(0, 3);
      await waitUntil(() => ids.every((id) => state.players.get(id)!.forfeited)
        && active.every((client) => client.game?.revision === state.revision && client.mine?.revision === state.revision));
      assert.equal(state.status, 'playing');
      assert.ok(ids.every((id) => room.players.get(id)!.hasLeft));
      assert.deepEqual(active[1]!.mine!.selectedPlaces, [], 'Stale command ran after recovery');
      assert.match(await emitRejected(active[1]!, 'notalone:select', { placeIds: [1], expectedRevision: 0 }), /changed/i);
      await playUntilNextRound(active, 1);
      assert.ok(ids.every((id) => !active[0]!.game!.huntedOrder.includes(id)));
      assert.equal(active[0]!.game!.players.length, 5);
      assert.deepEqual([state.rescueGoal, state.assimilationGoal], goals);
      assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, room), false);
      validateNotAloneState(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

for (const departure of ['REST leave', 'scheduled expiry'] as const) {
  test(`NOT ALONE canonical nested Shelter choice settles privately on ${departure} then retires`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 3);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const state = serverState(room.roomCode);
      assignLowReactionStartingHands(state);
      const owner = state.players.get(clients[1]!.auth.playerId)!;
      for (const id of state.huntedOrder) {
        const player = state.players.get(id)!;
        player.selectedPlaces = [1]; player.playedPlaces = [1];
      }
      state.reserve[7] -= 1;
      owner.placeHand.push(7); owner.selectedPlaces = [7]; owner.playedPlaces = [7];
      state.phase = 'reckoning'; state.reckoningStageIndex = 3;
      state.resolutionQueue = [{ playerId: owner.playerId, placeIndex: 0, stage: 'place' }];
      state.pendingCursor = 0; state.pendingPlaceIndex = 0; state.pendingPlayerId = owner.playerId;
      validateNotAloneState(state);
      clients.forEach((client) => client.socket.emit('request_state'));
      await waitUntil(() => clients[1]!.mine?.resolutionOptions?.effectivePlaceId === 7);
      const ack = await emitAccepted(clients[1]!, 'notalone:resolve', { mode: 'power', expectedRevision: state.revision }, 'resolve');
      await waitUntil(() => clients.every((client) => client.mine?.revision === ack.revision));
      assert.equal(clients[1]!.mine!.survivalChoiceCards.length, 2);
      assert.ok(clients[0]!.mine!.survivalChoiceCards.length === 0 && clients[2]!.mine!.survivalChoiceCards.length === 0);
      const restored = await connectTracked(harness, clients[1]!.auth);
      await waitUntil(() => restored.mine?.revision === ack.revision);
      assert.deepEqual(restored.mine!.survivalChoiceCards, clients[1]!.mine!.survivalChoiceCards);
      if (departure === 'REST leave') {
        const left = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
          headers: { authorization: `Bearer ${restored.auth.token}` } });
        assert.equal(left.statusCode, 200);
      } else {
        const seat = room.players.get(owner.playerId)!;
        assert.equal(markPlayerDisconnected(harness.io, room, owner.playerId, seat.socketId, 0), true);
      }
      const active = [clients[0]!, clients[2]!];
      await waitUntil(() => owner.forfeited && state.pendingSurvivalChoice === null
        && active.every((client) => client.game?.revision === state.revision && client.mine?.revision === state.revision));
      assert.equal(state.status, 'playing');
      assert.equal(toNotAlonePrivateState(state, owner.playerId).canChooseSurvivalCard, false);
      assert.deepEqual(toNotAlonePrivateState(state, owner.playerId).survivalChoiceCards, []);
      assert.match(await emitRejected(active[1]!, 'notalone:survival-choice', {
        cardId: restored.mine!.survivalChoiceCards[0], expectedRevision: ack.revision,
      }), /changed/i);
      await playUntilNextRound(active, 1);
      assert.equal(state.huntedOrder.includes(owner.playerId), false);
      assert.equal(active[0]!.game!.players.length, 3);
      assert.equal(toNotAlonePrivateState(state, owner.playerId).resolutionOptions, null);
      validateNotAloneState(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('NOT ALONE payload validators require exact revisioned shapes', () => {
  assert.equal(isNotAloneStartPayload(undefined), true);
  assert.equal(isNotAloneStartPayload({}), true);
  assert.equal(isNotAloneStartPayload({ boardFace: 'continuous' }), true);
  assert.equal(isNotAloneStartPayload({ boardFace: 'invalid' }), false);
  assert.equal(isNotAloneStartPayload({ boardFace: 'continuous', extra: true }), false);
  assert.equal(isNotAloneRevisionPayload({ expectedRevision: 0 }), true);
  assert.equal(isNotAloneRevisionPayload({}), false);
  assert.equal(isNotAloneRevisionPayload({ expectedRevision: 0, extra: true }), false);
  assert.equal(isNotAloneSelectPayload({ placeIds: [1, 2], expectedRevision: 3 }), true);
  assert.equal(isNotAloneSelectPayload({ placeIds: [1, 999], expectedRevision: 3 }), false);
  assert.equal(isNotAloneSelectPayload({ placeIds: {}, expectedRevision: 3 }), false);
  assert.equal(isNotAloneResistPayload({ willCost: 1, placeIds: [1, 2], expectedRevision: 2 }), true);
  assert.equal(isNotAloneResistPayload({ willCost: 1, expectedRevision: 2 }), false);
  assert.equal(isNotAlonePlaceTokenPayload({ token: 'creature', placeIds: [1], expectedRevision: 2 }), true);
  assert.equal(isNotAlonePlaceTokenPayload({ token: 'creature', expectedRevision: 2 }), false);
  assert.equal(isNotAlonePlaceTokenPayload({ token: 'unknown', placeIds: [1], expectedRevision: 2 }), false);
  assert.equal(isNotAloneHuntCardPayload({ cardId: 'detour', targetPlayerId: 'p1', originPlaceId: 2, placeIndex: 1, placeIds: [3], expectedRevision: 2 }), true);
  assert.equal(isNotAloneHuntCardPayload({ cardId: 'detour', placeIds: [3, 999], expectedRevision: 2 }), false);
  assert.equal(isNotAloneSurvivalPayload({ cardId: 'vortex', placeIndex: 0, placeIds: [2], expectedRevision: 2 }), true);
  assert.equal(isNotAloneCardChoicePayload({ placeIndexes: [1, 0], expectedRevision: 2 }), true);
  assert.equal(isNotAloneCardChoicePayload({ placeIds: [1], placeIndexes: [0, 1], expectedRevision: 2 }), false);
  assert.equal(isNotAloneResolvePayload({ mode: 'recover', placeIds: [], expectedRevision: 2 }), true);
  assert.equal(isNotAloneResolvePayload({ mode: 'recover', placeIds: [1, 999], expectedRevision: 2 }), false);
});

test('NOT ALONE real HTTP lobby preserves exact passwords, capacity, kick and host transfer', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.url}/rooms/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Creature', gameId: 'not_alone', password: ' signal ' }),
    });
    assert.equal(response.status, 201);
    const host = await response.json() as JoinRoomResponse;
    harness.roomCodes.add(host.roomCode);
    assert.equal(host.room.maxPlayers, 7);
    assert.equal(host.room.hasPassword, true);
    for (const password of ['signal', ' Signal ', '']) {
      const denied = await harness.app.inject({ method: 'POST', url: '/rooms/join', payload: {
        displayName: 'Denied', roomCode: host.roomCode, password,
      } });
      assert.equal(denied.statusCode, 403);
    }
    const hostClient = await connectTracked(harness, host);
    assert.match(await emitRejected(hostClient, 'start_game', {}), /Need at least 2/);
    const auths: JoinRoomResponse[] = [host];
    for (let index = 1; index < 7; index++) {
      const joined = await harness.app.inject({ method: 'POST', url: '/rooms/join', payload: {
        displayName: `Hunted ${index}`, roomCode: host.roomCode, password: ' signal ',
      } });
      assert.equal(joined.statusCode, 200);
      auths.push(joined.json());
    }
    const full = await harness.app.inject({ method: 'POST', url: '/rooms/join', payload: {
      displayName: 'Overflow', roomCode: host.roomCode, password: ' signal ',
    } });
    assert.equal(full.statusCode, 409);
    const successor = await connectTracked(harness, auths[1]!);
    const target = auths[6]!;
    const unauthorised = await harness.app.inject({ method: 'POST', url: `/rooms/${host.roomCode}/kick`,
      headers: { authorization: `Bearer ${successor.auth.token}` }, payload: { targetPlayerId: target.playerId } });
    assert.equal(unauthorised.statusCode, 403);
    const kicked = await harness.app.inject({ method: 'POST', url: `/rooms/${host.roomCode}/kick`,
      headers: { authorization: `Bearer ${host.token}` }, payload: { targetPlayerId: target.playerId } });
    assert.equal(kicked.statusCode, 200);
    const left = await harness.app.inject({ method: 'POST', url: `/rooms/${host.roomCode}/leave`,
      headers: { authorization: `Bearer ${host.token}` } });
    assert.equal(left.statusCode, 200);
    await waitUntil(() => successor.room?.players.find((player) => player.isHost)?.playerId === successor.auth.playerId);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE competitive results exclude active forfeits and all-seat abandonment', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    assert.equal(buildNotAloneResult(serverState(room.roomCode)), null);
    for (const client of clients.slice(1)) {
      const player = room.players.get(client.auth.playerId)!;
      assert.equal(markPlayerDisconnected(harness.io, room, player.playerId, player.socketId, 60_000), true);
      roomStore.clearPresenceTimer(player);
      player.reconnectDeadlineAt = Date.now() - 1;
    }
    clients[0]!.socket.emit('request_state');
    await waitUntil(() => clients[0]!.game?.status === 'game_over');
    const result = buildNotAloneResult(serverState(room.roomCode));
    assert.ok(result);
    assert.deepEqual(result.players.map((player) => player.playerId), [clients[0]!.auth.playerId]);
    assert.equal(result.players[0]!.won, true);
    assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, room), false);
    const saved = structuredClone(result);
    const left = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
      headers: { authorization: `Bearer ${clients[0]!.auth.token}` } });
    assert.equal(left.statusCode, 200);
    assert.deepEqual(buildNotAloneResult(serverState(room.roomCode)), saved, 'Completed participation changed after leaving');

    const abandonedClients = await createTrackedRoom(harness, 2);
    await startGame(abandonedClients);
    const abandoned = roomStore.get(abandonedClients[0]!.auth.roomCode)!;
    for (const player of abandoned.players.values()) {
      player.hasLeft = true;
    }
    assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, abandoned), true);
    assert.equal(serverState(abandoned.roomCode).winner, null);
    assert.equal(buildNotAloneResult(serverState(abandoned.roomCode)), null);
    assert.equal(abandoned.status, 'finished');
  } finally {
    await closeHarness(harness);
  }
});

for (const trigger of ['request_state', 'notalone:select'] as const) {
  test(`NOT ALONE recovers overdue seats before ${trigger} even when the scheduler is delayed`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 3);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const departed = room.players.get(clients[2]!.auth.playerId)!;
      assert.equal(markPlayerDisconnected(harness.io, room, departed.playerId, departed.socketId, 60_000), true);
      roomStore.clearPresenceTimer(departed);
      departed.reconnectDeadlineAt = Date.now() - 1;
      if (trigger === 'request_state') {
        clients[1]!.socket.emit('request_state');
        await waitUntil(() => clients[1]!.game!.players.some((player) => player.playerId === departed.playerId && player.forfeited));
      } else {
        const reason = await emitRejected(clients[1]!, trigger, { placeIds: [1], expectedRevision: 0 });
        assert.match(reason, /changed|stale/i);
      }
      assert.equal(serverState(room.roomCode).players.get(departed.playerId)!.forfeited, true);
      assert.equal(departed.hasLeft, true);
      assert.deepEqual(serverState(room.roomCode).players.get(clients[1]!.auth.playerId)!.selectedPlaces, []);
      assert.match(await emitRejected(clients[1]!, 'notalone:select', { placeIds: [1], expectedRevision: 0 }), /changed/i);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('NOT ALONE lobby start is host-only and waits for reserved seats', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Host');
    const second = await joinRoom(harness, host.roomCode, 'Second');
    const hostSocket = await connect(harness, host.token);
    let rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', { boardFace: 'wrong' });
    assert.equal((await rejected).reason, 'Invalid payload');
    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', { boardFace: 'alternating' });
    assert.match((await rejected).reason, /connecting or reconnecting/i);
    const secondSocket = await connect(harness, second.token);
    rejected = waitForEvent<{ reason: string }>(secondSocket, 'action_rejected');
    secondSocket.emit('start_game', { boardFace: 'alternating' });
    assert.match((await rejected).reason, /Only the host/i);
    const accepted = waitForEvent<NotAloneActionAccepted>(hostSocket, 'notalone:action_accepted');
    hostSocket.emit('start_game', { boardFace: 'alternating' });
    assert.deepEqual(await accepted, { action: 'start', revision: 0 });
    assert.equal(serverState(host.roomCode).boardFace, 'alternating');
  } finally {
    await closeHarness(harness);
  }
});

const malformedEvents = [
  'select', 'river-choice', 'survival-choice', 'card-choice', 'resist', 'give-up', 'survival', 'hunt-card',
  'place-token', 'pass', 'begin-hunt', 'lock-hunt', 'reveal', 'begin-reckoning', 'resolve', 'end-turn',
];
for (const suffix of malformedEvents) {
  test(`NOT ALONE ${suffix} rejects null, missing revision and unknown fields without mutation`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 2);
      await startGame(clients);
      const state = serverState(clients[0]!.auth.roomCode);
      const before = JSON.stringify(toNotAlonePrivateState(state, clients[1]!.auth.playerId));
      for (const payload of [null, [], {}, { expectedRevision: 0, unexpected: true }, { expectedRevision: -1 }]) {
        assert.equal(await emitRejected(clients[1]!, `notalone:${suffix}`, payload), 'Invalid payload');
      }
      assert.equal(state.revision, 0);
      assert.equal(JSON.stringify(toNotAlonePrivateState(state, clients[1]!.auth.playerId)), before);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('NOT ALONE acknowledgements stay sender-only and duplicate planning cannot lock twice', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const received = clients.map(() => [] as NotAloneActionAccepted[]);
    clients.forEach((client, index) => client.socket.on('notalone:action_accepted', (ack) => received[index]!.push(ack)));
    const choice = { placeIds: [2], expectedRevision: 0 };
    const accepted = await emitAccepted(clients[1]!, 'notalone:select', choice, 'select');
    assert.equal(accepted.revision, 1);
    assert.match(await emitRejected(clients[1]!, 'notalone:select', choice), /already locked/);
    assert.deepEqual(received.map((acks) => acks.length), [0, 1, 0]);
    assert.equal(serverState(clients[0]!.auth.roomCode).revision, 1);
    assert.match(await emitRejected(clients[0]!, 'notalone:select', { placeIds: [1], expectedRevision: 1 }), /Only the Hunted/);
    assert.equal(await emitRejected(clients[1]!, 'request_state', { playerId: clients[0]!.auth.playerId }), 'Invalid payload');
    assert.equal(serverState(clients[0]!.auth.roomCode).revision, 1);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE invalid credentials and expired reconnects cannot adopt a seat', async () => {
  const harness = await createHarness();
  try {
    await assert.rejects(connect(harness, 'not-a-signed-token'), /token|auth|unauthor/i);
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const departed = room.players.get(clients[2]!.auth.playerId)!;
    assert.equal(markPlayerDisconnected(harness.io, room, departed.playerId, departed.socketId, 60_000), true);
    roomStore.clearPresenceTimer(departed);
    departed.reconnectDeadlineAt = Date.now() - 1;
    const expired = createClient(harness.url, {
      auth: { token: clients[2]!.auth.token }, forceNew: true, autoConnect: false,
      reconnection: false, transports: ['websocket'],
    });
    harness.clients.push(expired);
    const terminal = waitForEvent<{ message: string }>(expired, 'server_error');
    let privateFrames = 0;
    expired.on('private_state', () => { privateFrames++; });
    expired.connect();
    assert.match((await terminal).message, /expired|left|no longer|seat/i);
    await waitUntil(() => expired.disconnected);
    assert.equal(privateFrames, 0);
    assert.equal(serverState(room.roomCode).players.get(departed.playerId)!.forfeited, true);
    const mine = toNotAlonePrivateState(serverState(room.roomCode), departed.playerId);
    assert.equal(mine.canSelect, false);
    assert.equal(mine.canResolve, false);
    assert.equal(mine.cardChoice, null);
    assert.equal(mine.canChooseSurvivalCard, false);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE malformed host start cannot prune an overdue lobby reservation', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Host');
    const guest = await joinRoom(harness, host.roomCode, 'Reserved');
    const client = await connectTracked(harness, host);
    const room = roomStore.get(host.roomCode)!;
    const reservation = room.players.get(guest.playerId)!;
    roomStore.clearPresenceTimer(reservation);
    reservation.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(await emitRejected(client, 'start_game', { boardFace: 'continuous', extra: true }), 'Invalid payload');
    assert.equal(room.players.has(guest.playerId), true);
    assert.equal(room.game, null);
    assert.equal(room.status, 'lobby');
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE current host becomes Creature after host transfer and an earlier seat reconnects', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    clients[1]!.socket.disconnect();
    await waitUntil(() => !room.players.get(clients[1]!.auth.playerId)!.isConnected);
    const left = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
      headers: { authorization: `Bearer ${clients[0]!.auth.token}` } });
    assert.equal(left.statusCode, 200);
    assert.equal(room.hostPlayerId, clients[2]!.auth.playerId);
    const earlierSeat = await connectTracked(harness, clients[1]!.auth);
    const playing = [clients[2]!, earlierSeat, clients[3]!];
    await startGame(playing);
    assert.equal(clients[2]!.game!.creaturePlayerId, room.hostPlayerId);
    assert.equal(clients[2]!.mine!.role, 'creature');
    assert.equal(earlierSeat.mine!.role, 'hunted');
    const commands = await playCompleteSocketMatch(playing);
    const previousRevision = clients[2]!.game!.revision;
    earlierSeat.socket.disconnect();
    await waitUntil(() => !room.players.get(earlierSeat.auth.playerId)!.isConnected);
    const hostLeft = await harness.app.inject({ method: 'POST', url: `/rooms/${room.roomCode}/leave`,
      headers: { authorization: `Bearer ${clients[2]!.auth.token}` } });
    assert.equal(hostLeft.statusCode, 200);
    assert.equal(room.hostPlayerId, clients[3]!.auth.playerId);
    const returning = await connectTracked(harness, earlierSeat.auth);
    await startGame([clients[3]!, returning]);
    assert.equal(clients[3]!.game!.revision, previousRevision + 1);
    assert.equal(clients[3]!.mine!.role, 'creature');
    assert.equal(returning.mine!.role, 'hunted');
    console.log(`NOT ALONE HOST TRANSFER: one complete 3P game, ${commands} commands, current-host 2P rematch assignment verified.`);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE batches missing, left and overdue Hunted before the Creature can finish a round', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = serverState(room.roomCode);
    state.phase = 'end_of_turn';
    state.rescueProgress = state.rescueGoal - 1;
    for (const id of state.huntedOrder) {
      const player = state.players.get(id)!;
      player.selectedPlaces = [1]; player.playedPlaces = [1];
      state.reactionPasses.add(id);
    }
    validateNotAloneState(state);
    roomStore.clearPresenceTimer(room.players.get(clients[1]!.auth.playerId)!);
    room.players.delete(clients[1]!.auth.playerId);
    room.players.get(clients[2]!.auth.playerId)!.hasLeft = true;
    const overdue = room.players.get(clients[3]!.auth.playerId)!;
    assert.equal(markPlayerDisconnected(harness.io, room, overdue.playerId, overdue.socketId, 60_000), true);
    roomStore.clearPresenceTimer(overdue);
    overdue.reconnectDeadlineAt = Date.now() - 1;
    assert.match(await emitRejected(clients[0]!, 'notalone:end-turn', { expectedRevision: 0 }), /changed/i);
    assert.equal(state.revision, 1);
    assert.equal(state.endReason, 'forfeit');
    assert.equal(state.winner, 'creature');
    assert.equal(state.rescueProgress, state.rescueGoal - 1, 'Old command completed the rescue before overdue recovery');
    assert.ok(state.huntedOrder.every((id) => state.players.get(id)!.forfeited));
    assert.deepEqual(buildNotAloneResult(state)!.players.map((player) => player.playerId), [clients[0]!.auth.playerId]);
    assert.equal(recoverDisconnectedNotAlonePlayers(harness.io, room), false);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE Smokescreen remains viewer-specific across replacement and reconnect', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const state = serverState(clients[0]!.auth.roomCode);
    const owner = state.players.get(clients[1]!.auth.playerId)!;
    for (const player of state.players.values()) {
      const index = player.survivalHand.indexOf('smokescreen');
      if (index >= 0) player.survivalHand.splice(index, 1);
    }
    for (const zone of [state.survivalDeck, state.survivalDiscard, state.pendingSurvivalDiscard]) {
      const index = zone.indexOf('smokescreen');
      if (index >= 0) zone.splice(index, 1);
    }
    owner.survivalHand.push('smokescreen');
    owner.placeHand.splice(owner.placeHand.indexOf(2), 1);
    owner.discard.push(2);
    validateNotAloneState(state);
    const ack = await emitAccepted(clients[1]!, 'notalone:survival', { cardId: 'smokescreen', expectedRevision: 0 }, 'survival');
    await waitUntil(() => clients.every((client) => client.game?.revision === ack.revision));
    assert.deepEqual(clients[0]!.game!.players.find((player) => player.playerId === owner.playerId)!.discard, []);
    assert.deepEqual(clients[2]!.game!.players.find((player) => player.playerId === owner.playerId)!.discard, [2]);
    for (const client of clients) {
      const replacement = await connectTracked(harness, client.auth);
      await waitUntil(() => replacement.game?.revision === ack.revision && replacement.mine?.revision === ack.revision);
      assert.equal(replacement.game!.viewerPlayerId, client.auth.playerId);
      assert.equal(replacement.mine!.roomCode, client.auth.roomCode);
      assert.deepEqual(replacement.game, client.game);
      assert.deepEqual(replacement.mine, client.mine);
    }
  } finally {
    await closeHarness(harness);
  }
});

for (const completion of ['choose', 'leave'] as const) {
  test(`NOT ALONE canonical Lair copy keeps an owned Rover continuation through ${completion}`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 3);
      await startGame(clients);
      const state = serverState(clients[0]!.auth.roomCode);
      const owner = state.players.get(clients[1]!.auth.playerId)!;
      const other = state.players.get(clients[2]!.auth.playerId)!;
      owner.selectedPlaces = [1]; owner.playedPlaces = [1];
      other.selectedPlaces = [5]; other.playedPlaces = [5];
      state.huntTokens.creature = [5];
      state.phase = 'reckoning'; state.reckoningStageIndex = 3;
      state.resolutionQueue = [{ playerId: owner.playerId, placeIndex: 0, stage: 'place' }];
      state.pendingCursor = 0; state.pendingPlaceIndex = 0; state.pendingPlayerId = owner.playerId;
      validateNotAloneState(state);
      clients.forEach((client) => client.socket.emit('request_state'));
      await waitUntil(() => clients[1]!.mine?.resolutionOptions?.effectivePlaceId === 1);
      assert.ok(clients[1]!.mine!.resolutionOptions!.copyablePlaceIds.includes(5));
      const rejectedBefore = state.revision;
      assert.match(await emitRejected(clients[2]!, 'notalone:resolve', {
        mode: 'copy', targetPlaceId: 5, expectedRevision: rejectedBefore,
      }), /not your place/i);
      assert.equal(state.revision, rejectedBefore);
      const ack = await emitAccepted(clients[1]!, 'notalone:resolve', {
        mode: 'copy', targetPlaceId: 5, expectedRevision: state.revision,
      }, 'resolve');
      assert.equal(ack.revision, rejectedBefore + 1);
      await waitUntil(() => clients.every((client) => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
      assert.equal(clients[1]!.mine!.resolutionOptions!.placeId, 1);
      assert.equal(clients[1]!.mine!.resolutionOptions!.effectivePlaceId, 5);
      assert.equal(clients[1]!.mine!.resolutionOptions!.mustUsePlacePower, true);
      assert.equal(clients[0]!.mine!.resolutionOptions, null);
      assert.equal(clients[2]!.mine!.resolutionOptions, null);
      assert.ok(clients.every((client) => !client.mine!.canPass), 'Copy continuation reopened the reaction window');
      assert.match(await emitRejected(clients[1]!, 'notalone:resolve', {
        mode: 'copy', targetPlaceId: 5, expectedRevision: rejectedBefore,
      }), /changed/i);
      const restored = await connectTracked(harness, clients[1]!.auth);
      await waitUntil(() => restored.mine?.revision === ack.revision);
      assert.deepEqual(restored.mine!.resolutionOptions, clients[1]!.mine!.resolutionOptions);
      assert.match(await emitRejected(restored, 'notalone:resolve', {
        mode: 'recover', placeIds: [], expectedRevision: ack.revision,
      }), /copied Place/i);
      if (completion === 'choose') {
        const targetPlaceId = restored.mine!.resolutionOptions!.roverPlaceIds[0]!;
        const resolved = await emitAccepted(restored, 'notalone:resolve', {
          mode: 'power', targetPlaceId, expectedRevision: ack.revision,
        }, 'resolve');
        assert.equal(resolved.revision, ack.revision + 1);
        await waitUntil(() => restored.mine?.revision === resolved.revision);
        assert.ok(restored.mine!.placeHand.includes(targetPlaceId));
        assert.match(await emitRejected(restored, 'notalone:resolve', {
          mode: 'power', targetPlaceId, expectedRevision: ack.revision,
        }), /changed/i);
      } else {
        const left = await harness.app.inject({ method: 'POST', url: `/rooms/${state.roomCode}/leave`,
          headers: { authorization: `Bearer ${restored.auth.token}` } });
        assert.equal(left.statusCode, 200);
        await waitUntil(() => state.players.get(owner.playerId)!.forfeited && state.pendingPlayerId !== owner.playerId);
        assert.equal(state.status, 'playing');
        assert.equal(state.players.get(owner.playerId)!.copyPower, null);
        const active = [clients[0]!, clients[2]!];
        await waitUntil(() => active.every((client) => client.game?.revision === state.revision && client.mine?.revision === state.revision));
        await playUntilNextRound(active, 1);
        assert.equal(state.huntedOrder.includes(owner.playerId), false);
        assert.equal(active[0]!.game!.players.length, 3);
      }
      validateNotAloneState(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('NOT ALONE socket commands fence malformed, stale, private and replaced sessions', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients, 'continuous');
    const roomCode = clients[0]!.auth.roomCode;
    const state = serverState(roomCode);
    const hunted = clients.slice(1);
    for (const client of clients) {
      assert.ok(client.game!.players.every((player) => player.revealedPlaces.length === 0 && player.originalRevealedPlaces.length === 0));
      assert.equal(client.mine!.playerId, client.auth.playerId);
      if (client.mine!.role === 'hunted') assert.deepEqual(client.mine!.huntHand, []);
    }
    let acknowledgements = 0;
    hunted[0]!.socket.on('notalone:action_accepted', () => { acknowledgements += 1; });
    let rejected = waitForEvent<{ reason: string }>(hunted[0]!.socket, 'action_rejected');
    hunted[0]!.socket.emit('notalone:select', { placeIds: [1] });
    assert.equal((await rejected).reason, 'Invalid payload');
    rejected = waitForEvent<{ reason: string }>(hunted[0]!.socket, 'action_rejected');
    hunted[0]!.socket.emit('notalone:select', { placeIds: [1, 999], expectedRevision: state.revision });
    assert.equal((await rejected).reason, 'Invalid payload');
    rejected = waitForEvent<{ reason: string }>(hunted[0]!.socket, 'action_rejected');
    hunted[0]!.socket.emit('notalone:select', { placeIds: [1], expectedRevision: state.revision + 1 });
    assert.match((await rejected).reason, /changed/i);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(acknowledgements, 0);
    assert.equal(serverState(roomCode).revision, 0);

    const sharedRevision = state.planningWindowRevision;
    await emitConcurrent(hunted.map((client, index) => ({
      client, event: 'notalone:select', payload: { placeIds: [index + 1], expectedRevision: sharedRevision }, action: 'select' as const,
    })));
    assert.equal(serverState(roomCode).phase, 'exploration_reaction');
    await waitUntil(() => clients.every((client) => client.game?.phase === 'exploration_reaction'));
    assert.ok(clients.every((client) => client.game!.players.every((player) => player.revealedPlaces.length === 0 && player.originalRevealedPlaces.length === 0)));

    const old = hunted[0]!;
    const replaced = waitForEvent<{ message: string }>(old.socket, 'session_replaced');
    const replacement = await connectTracked(harness, old.auth);
    assert.match((await replaced).message, /another connection/i);
    await waitUntil(() => old.socket.disconnected);
    const before = serverState(roomCode).revision;
    old.socket.emit('notalone:pass', { expectedRevision: before });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(serverState(roomCode).revision, before);
    assert.equal(roomStore.get(roomCode)!.players.get(old.auth.playerId)!.socketId, replacement.socket.id);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE Despair privately resets locked destinations with a fresh planning epoch', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    const state = serverState(roomCode);
    forceHuntCardToHand(state, 'despair');
    const oldPlanningWindow = state.planningWindowRevision;
    await emitAccepted(clients[1]!, 'notalone:select', { placeIds: [1], expectedRevision: oldPlanningWindow }, 'select');
    await emitAccepted(clients[0]!, 'notalone:hunt-card', {
      cardId: 'despair', expectedRevision: serverState(roomCode).revision,
    }, 'hunt_card');
    await waitUntil(() => clients.every((client) => client.game?.phase === 'hunted_planning'));
    const reset = serverState(roomCode);
    assert.ok(reset.huntedOrder.every((id) => reset.players.get(id)!.selectedPlaces.length === 0
      && reset.players.get(id)!.playedPlaces.length === 0));
    assert.ok(clients.every((client) => client.game!.players.every((entry) => entry.revealedPlaces.length === 0
      && entry.originalRevealedPlaces.length === 0)), 'Despair leaked a reset destination');
    assert.match(await emitRejected(clients[2]!, 'notalone:select', {
      placeIds: [2], expectedRevision: oldPlanningWindow,
    }), /changed/i);
    const freshWindow = reset.planningWindowRevision;
    await emitConcurrent([
      { client: clients[1]!, event: 'notalone:select', payload: { placeIds: [2], expectedRevision: freshWindow }, action: 'select' },
      { client: clients[2]!, event: 'notalone:select', payload: { placeIds: [3], expectedRevision: freshWindow }, action: 'select' },
    ]);
    assert.equal(serverState(roomCode).phase, 'exploration_reaction');
    validateNotAloneState(serverState(roomCode));
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE seals Forbidden Zone choices across concurrency, reconnect and forfeit autopilot', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 5);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    assignLowReactionStartingHands(serverState(roomCode));
    const planningWindow = serverState(roomCode).planningWindowRevision;
    await emitConcurrent(clients.slice(1).map((client) => ({
      client, event: 'notalone:select', payload: { placeIds: [1], expectedRevision: planningWindow }, action: 'select' as const,
    })));
    const byId = new Map(clients.map((client) => [client.auth.playerId, client]));
    await passEligible(byId, serverState(roomCode));
    await emitAccepted(clients[0]!, 'notalone:begin-hunt', { expectedRevision: serverState(roomCode).revision }, 'begin_hunt');
    forceHuntCardToHand(serverState(roomCode), 'forbidden_zone');
    await emitAccepted(clients[0]!, 'notalone:hunt-card', {
      cardId: 'forbidden_zone', expectedRevision: serverState(roomCode).revision,
    }, 'hunt_card');
    await waitUntil(() => clients[0]!.mine?.revision === serverState(roomCode).revision);
    assert.equal(clients[0]!.mine!.canHunt, false);
    assert.equal(clients[0]!.mine!.canLockHunt, false);
    assert.equal(clients[0]!.mine!.canReveal, false);
    assert.equal(clients[0]!.mine!.canBeginHunt, false);
    assert.equal(clients[0]!.mine!.canBeginReckoning, false);
    assert.equal(clients[0]!.mine!.canEndTurn, false);
    assert.deepEqual(clients[0]!.mine!.playableHuntCardIds, []);
    const lockedRevision = serverState(roomCode).revision;
    assert.match(await emitRejected(clients[0]!, 'notalone:place-token', {
      token: 'creature', placeIds: [1], expectedRevision: lockedRevision,
    }), /pending Hunt card choice/i);
    assert.equal(serverState(roomCode).revision, lockedRevision);
    const choiceWindow = serverState(roomCode).pendingCardChoice!.choiceWindowRevision!;
    await emitAccepted(clients[1]!, 'notalone:card-choice', { placeIds: [2], expectedRevision: choiceWindow }, 'card_choice');
    await waitUntil(() => clients[1]!.mine?.cardChoiceSubmitted === true
      && clients.every((client) => client.game?.pendingCardChoice?.submittedCount === 1));
    assert.ok(clients.every((client) => client.game?.pendingCardChoice?.playerId === null));
    assert.equal(clients[0]!.game!.pendingCardChoice!.submittedCount, 1);
    assert.equal(clients[0]!.game!.pendingCardChoice!.eligibleCount, 4);
    assert.ok(serverState(roomCode).huntedOrder.every((id) => !serverState(roomCode).players.get(id)!.discard.includes(2)),
      'A sealed Forbidden Zone choice was applied before all commitments');

    const reconnected = await connectTracked(harness, clients[1]!.auth);
    await waitUntil(() => reconnected.mine?.cardChoiceSubmitted === true);
    assert.equal(reconnected.mine!.cardChoice, null);
    assert.match(await emitRejected(reconnected, 'notalone:card-choice', {
      placeIds: [3], expectedRevision: choiceWindow,
    }), /already locked/i);

    const forfeited = clients[4]!;
    const room = roomStore.get(roomCode)!;
    assert.equal(markPlayerDisconnected(harness.io, room, forfeited.auth.playerId, forfeited.socket.id ?? null, 0), true);
    await waitUntil(() => serverState(roomCode).players.get(forfeited.auth.playerId)!.forfeited
      && serverState(roomCode).pendingCardChoice!.sealedChoices!.has(forfeited.auth.playerId));
    assert.equal(serverState(roomCode).pendingCardChoice!.sealedChoices!.size, 2);
    assert.match(await emitRejected(clients[2]!, 'notalone:card-choice', {
      placeIds: [2], expectedRevision: choiceWindow,
    }), /changed/i);
    const recoveredChoiceWindow = serverState(roomCode).revision;
    await emitConcurrent(clients.slice(2, 4).map((client) => ({
      client, event: 'notalone:card-choice', payload: { placeIds: [2], expectedRevision: recoveredChoiceWindow }, action: 'card_choice' as const,
    })));
    await waitUntil(() => serverState(roomCode).pendingCardChoice === null);
    assert.ok(serverState(roomCode).huntedOrder.every((id) => serverState(roomCode).players.get(id)!.discard.includes(2)));
    const active = [clients[0]!, reconnected, clients[2]!, clients[3]!];
    await waitUntil(() => active.every((client) => client.game?.revision === serverState(roomCode).revision
      && client.mine?.revision === serverState(roomCode).revision));
    await playUntilNextRound(active, 1);
    assert.equal(serverState(roomCode).huntedOrder.includes(forfeited.auth.playerId), false);
    assert.equal(active[0]!.game!.players.length, 5);
    validateNotAloneState(serverState(roomCode));
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE locks every seat during a private Artemia discard without leaking card identity', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    const state = serverState(roomCode);
    const firstId = state.huntedOrder[0]!, secondId = state.huntedOrder[1]!;
    state.survivalDeck = NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id);
    state.survivalDiscard = []; state.pendingSurvivalDiscard = [];
    for (const id of state.huntedOrder) state.players.get(id)!.survivalHand = [];
    for (const [id, card] of [[firstId, 'detector'], [secondId, 'hologram']] as const) {
      state.survivalDeck.splice(state.survivalDeck.indexOf(card), 1);
      state.players.get(id)!.survivalHand = [card];
    }
    state.players.get(firstId)!.selectedPlaces = [1]; state.players.get(firstId)!.playedPlaces = [1];
    state.players.get(secondId)!.selectedPlaces = [2]; state.players.get(secondId)!.playedPlaces = [2];
    state.phase = 'reckoning'; state.reckoningStageIndex = 1; state.huntTokens.artemia = [1];
    state.resolutionQueue = [{ playerId: firstId, placeIndex: 0, stage: 'artemia' }];
    state.pendingCursor = 0; state.pendingPlaceIndex = 0; state.pendingPlayerId = firstId;
    state.pendingCardChoice = { kind: 'artemia_discard', playerId: firstId, count: 1, queue: [] };
    validateNotAloneState(state);
    clients.forEach((client) => client.socket.emit('request_state'));
    await waitUntil(() => clients[1]!.mine?.cardChoice?.kind === 'artemia_discard'
      && clients[2]!.mine?.cardChoice === null
      && clients.slice(1).every((client) => client.mine?.playableSurvivalCardIds.length === 0));
    assert.ok(!JSON.stringify(clients[0]!.game).includes('detector')
      && !JSON.stringify(clients[0]!.game).includes('hologram'), 'Public state leaked a private Survival card identity');
    const lockedRevision = state.revision;
    assert.match(await emitRejected(clients[1]!, 'notalone:survival', {
      cardId: 'detector', expectedRevision: lockedRevision,
    }), /pending Hunt card choice/i);
    assert.match(await emitRejected(clients[2]!, 'notalone:survival', {
      cardId: 'hologram', placeIds: [2], expectedRevision: lockedRevision,
    }), /pending Hunt card choice/i);
    assert.equal(state.revision, lockedRevision);
    assert.deepEqual(state.players.get(firstId)!.survivalHand, ['detector']);
    assert.deepEqual(state.players.get(secondId)!.survivalHand, ['hologram']);
    await emitAccepted(clients[1]!, 'notalone:card-choice', {
      placeIds: [2], expectedRevision: state.revision,
    }, 'card_choice');
    validateNotAloneState(state);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE rejects no-op pass, conjured Toxin discard, unavailable Wrong Track intent and Shelter bypass', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 2);
    await startGame(clients);
    const roomCode = clients[0]!.auth.roomCode;
    const state = serverState(roomCode);
    const hunted = state.players.get(state.huntedOrder[0]!)!;
    state.survivalDeck.push(...hunted.survivalHand); hunted.survivalHand = [];
    hunted.selectedPlaces = [1]; hunted.playedPlaces = [1]; state.phase = 'exploration_reaction';
    state.reactionWindowRevision = state.revision;
    validateNotAloneState(state);
    const beforePass = state.revision;
    assert.match(await emitRejected(clients[1]!, 'notalone:pass', { expectedRevision: state.reactionWindowRevision }), /No reaction/i);
    assert.equal(state.revision, beforePass);

    forceHuntCardToHand(state, 'toxin');
    state.huntHand.splice(state.huntHand.indexOf('toxin'), 1);
    state.activeHuntCards = ['toxin']; state.pendingHuntDiscard.push('toxin'); state.effects.toxin = true;
    state.phase = 'reckoning'; state.huntTokens.target = [1]; state.reckoningStageIndex = 0;
    state.resolutionQueue = [{ playerId: hunted.playerId, placeIndex: 0, stage: 'target' }]; state.pendingPlayerId = hunted.playerId;
    validateNotAloneState(state);
    const beforeToxin = state.revision;
    assert.match(await emitRejected(clients[1]!, 'notalone:resolve', {
      mode: 'recover', huntSurvivalCardId: 'adrenaline', expectedRevision: beforeToxin,
    }), /No Survival card/i);
    assert.equal(state.revision, beforeToxin);
    validateNotAloneState(state);

    state.activeHuntCards = []; state.effects.toxin = false; state.huntTokens.target = [];
    state.pendingPlayerId = null; state.resolutionQueue = []; state.reckoningStageIndex = -1; state.reactionWindowRevision = state.revision;
    const wrongTrackIndex = state.survivalDeck.indexOf('wrong_track');
    assert.ok(wrongTrackIndex >= 0);
    state.survivalDeck.splice(wrongTrackIndex, 1); hunted.survivalHand.push('wrong_track'); hunted.survivalPlayed = false;
    state.huntTokens.creature = [1];
    validateNotAloneState(state);
    assert.match(await emitRejected(clients[1]!, 'notalone:survival', {
      cardId: 'wrong_track', token: 'target', placeIds: [2], expectedRevision: state.reactionWindowRevision,
    }), /only while Clone is active/i);
    assert.deepEqual(state.huntTokens.creature, [1]);
    assert.ok(hunted.survivalHand.includes('wrong_track'));
    validateNotAloneState(state);

    state.reserve[7] -= 1; hunted.placeHand.push(7); hunted.selectedPlaces = [7]; hunted.playedPlaces = [7];
    state.huntTokens = { creature: [], target: [], artemia: [] };
    state.phase = 'reckoning'; state.reckoningStageIndex = 3;
    state.resolutionQueue = [{ playerId: hunted.playerId, placeIndex: 0, stage: 'place' }];
    state.pendingCursor = 0; state.pendingPlaceIndex = 0; state.pendingPlayerId = hunted.playerId;
    state.resolvedEncounterStages.clear(); state.resolvedTargetEffects.clear(); state.resolvedPlaceActions.clear();
    validateNotAloneState(state);
    await emitAccepted(clients[1]!, 'notalone:resolve', {
      mode: 'power', expectedRevision: state.revision,
    }, 'resolve');
    assert.equal(state.pendingSurvivalChoice?.cards.length, 2);
    const pendingCards = [...state.pendingSurvivalChoice!.cards];
    await waitUntil(() => clients[1]!.mine?.canChooseSurvivalCard === true && clients[1]!.mine?.canResolve === false);
    assert.match(await emitRejected(clients[1]!, 'notalone:resolve', {
      mode: 'recover', placeIds: [], expectedRevision: state.revision,
    }), /drawn Survival cards/i);
    assert.deepEqual(state.pendingSurvivalChoice?.cards, pendingCards);
    assert.deepEqual(clients[0]!.mine!.survivalChoiceCards, []);
    assert.match(await emitRejected(clients[0]!, 'notalone:survival-choice', {
      cardId: pendingCards[0], expectedRevision: state.revision,
    }), /not your Survival card choice/i);
    const restored = await connectTracked(harness, clients[1]!.auth);
    await waitUntil(() => restored.mine?.canChooseSurvivalCard === true);
    assert.deepEqual(restored.mine!.survivalChoiceCards, pendingCards);
    assert.equal(restored.game!.revision, restored.mine!.revision);
    const choiceRevision = state.revision;
    const accepted = await emitAccepted(restored, 'notalone:survival-choice', {
      cardId: pendingCards[0], expectedRevision: choiceRevision,
    }, 'survival_choice');
    assert.equal(accepted.revision, choiceRevision + 1);
    assert.match(await emitRejected(restored, 'notalone:survival-choice', {
      cardId: pendingCards[1], expectedRevision: choiceRevision,
    }), /changed/i);
    assert.match(await emitRejected(restored, 'notalone:survival-choice', {
      cardId: pendingCards[1], expectedRevision: state.revision,
    }), /not your Survival card choice/i);
    validateNotAloneState(state);
  } finally {
    await closeHarness(harness);
  }
});

test('NOT ALONE disconnect grace, explicit leave and simultaneous expiry settle safely', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 3);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const reconnecting = clients[2]!;
    assert.equal(markPlayerDisconnected(harness.io, room, reconnecting.auth.playerId, reconnecting.socket.id ?? null, 80), true);
    const restored = await connectTracked(harness, reconnecting.auth);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(serverState(room.roomCode).players.get(reconnecting.auth.playerId)!.forfeited, false);
    assert.equal(room.players.get(reconnecting.auth.playerId)!.socketId, restored.socket.id);

    const leaveResponse = await harness.app.inject({
      method: 'POST', url: `/rooms/${room.roomCode}/leave`,
      headers: { authorization: `Bearer ${restored.auth.token}` },
    });
    assert.equal(leaveResponse.statusCode, 200, leaveResponse.body);
    await waitUntil(() => serverState(room.roomCode).players.get(restored.auth.playerId)!.forfeited);
    assert.equal(serverState(room.roomCode).status, 'playing');

    const active = clients.slice(0, 2);
    const commands = await playCompleteSocketMatch(active);
    console.log(`NOT ALONE SURVIVOR: one complete 3-to-2 current-round-only forfeit game, ${commands} accepted commands.`);
    assert.equal(serverState(room.roomCode).players.get(restored.auth.playerId)!.forfeited, true);
    assert.equal(serverState(room.roomCode).winner, 'hunted');
    const reconnectedActive = await reconnectClients(harness, active);
    await startGame(reconnectedActive);
    assert.equal(serverState(room.roomCode).players.size, 2, 'Rematch resurrected a departed ghost seat');
  } finally {
    await closeHarness(harness);
  }

  const directRoom = roomStore.create('p0', null, 'not_alone', {});
  const directPlayers = Array.from({ length: 3 }, (_, index) => ({ playerId: `p${index}`, displayName: `P${index}` }));
  for (const player of directPlayers) {
    roomStore.addPlayer(directRoom, { ...player, isHost: player.playerId === 'p0' }, Date.now() + 60_000);
    roomStore.markConnected(directRoom, player.playerId, `${player.playerId}-socket`);
  }
  const directState = initNotAloneGame(directRoom.roomCode, directPlayers, () => 0.25);
  directRoom.status = 'in_game'; directRoom.game = { id: 'not_alone', state: directState };
  const silentIo = { to: () => ({ emit: () => undefined }) } as unknown as Server;
  try {
    for (const player of directRoom.players.values()) assert.equal(markPlayerDisconnected(silentIo, directRoom, player.playerId, player.socketId, 0), true);
    await waitUntil(() => directState.status === 'game_over');
    assert.equal(directState.winner, null);
    assert.ok([...directState.players.values()].every((player) => player.forfeited));
    assert.equal(directState.revision, 1, 'Simultaneous forfeits were not batched atomically');
  } finally {
    roomStore.delete(directRoom.roomCode);
  }
});

test('NOT ALONE completes full matches and full rematches for every supported count', async () => {
  const harness = await createHarness();
  let commands = 0;
  try {
    for (let count = 2; count <= 7; count += 1) {
      let clients = await createTrackedRoom(harness, count);
      const face: NotAloneBoardFace = count % 2 === 0 ? 'continuous' : 'alternating';
      await startGame(clients, face);
      commands += await playCompleteSocketMatch(clients);
      await waitUntil(() => clients.every((client) => client.game?.status === 'game_over'));
      const roomCode = clients[0]!.auth.roomCode;
      const first = clients[0]!.game!;
      clients = await reconnectClients(harness, clients);
      await startGame(clients);
      const rematch = clients[0]!.game!;
      assert.notEqual(rematch, first);
      assert.equal(rematch.boardFace, face);
      assert.equal(rematch.players.length, count);
      assert.equal(rematch.revision, first.revision + 1);
      assert.match(await emitRejected(clients[1]!, 'notalone:select', { placeIds: [1], expectedRevision: 0 }), /changed|stale/i);
      assert.equal(rematch.artemiaAvailable, false);
      commands += await playCompleteSocketMatch(clients);
      await waitUntil(() => clients.every((client) => client.game?.status === 'game_over'));
      const completed = structuredClone(buildNotAloneResult(serverState(roomCode)));
      const left = await harness.app.inject({ method: 'POST', url: `/rooms/${roomCode}/leave`,
        headers: { authorization: `Bearer ${clients[1]!.auth.token}` } });
      assert.equal(left.statusCode, 200);
      assert.deepEqual(buildNotAloneResult(serverState(roomCode)), completed, 'A naturally completed participant lost result eligibility on exit');
      for (const client of clients) client.socket.disconnect();
      roomStore.delete(roomCode);
    }
    assert.ok(commands > 500);
    console.log(`NOT ALONE SOCKET MATCHES: 6 full matches + 6 full rematches, ${commands} accepted gameplay commands.`);
  } finally {
    await closeHarness(harness);
  }
});
