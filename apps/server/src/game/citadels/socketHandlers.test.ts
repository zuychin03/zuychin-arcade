import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import type {
  CitadelsActionAccepted,
  CitadelsDistrictCard,
  CitadelsPrivateState,
  CitadelsPublicState,
  CitadelsRole,
  JoinRoomResponse,
  RoomPublicState,
} from '@zuychin-arcade/types';
import { CITADELS_CITY_SIZE, CITADELS_DISTRICT_MANIFEST, CITADELS_ROLE_ORDER } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import {
  buildDistrict,
  endCitadelsTurn,
  forfeitCitadelsPlayers,
  initCitadelsGame,
  useCharacterPower,
  type CitadelsEngineResult,
  type CitadelsServerState,
} from './engine.js';
import {
  isCitadelsChooseIncomePayload,
  isCitadelsChooseRolePayload,
  isCitadelsDistrictPowerPayload,
  isCitadelsEndTurnPayload,
  isCitadelsPowerPayload,
  isCitadelsStartPayload,
  buildCitadelsResult,
  recoverDisconnectedCitadelsPlayers,
} from './socketHandlers.js';

process.env.JWT_SECRET ??= 'citadels-test-only-secret-32-bytes';

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
  game: CitadelsPublicState | null;
  mine: CitadelsPrivateState | null;
}

const DIRECT_PLAYERS = [
  { playerId: 'alice', displayName: 'Alice' },
  { playerId: 'bob', displayName: 'Bob' },
  { playerId: 'carol', displayName: 'Carol' },
  { playerId: 'dave', displayName: 'Dave' },
];

function expectOk(result: CitadelsEngineResult): void {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 4_000): Promise<T> {
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

async function waitUntil(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createHarness(): Promise<Harness> {
  assert.equal(supabase, null, 'Protocol tests refuse hosted persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io);
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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, gameId: 'citadels' }),
  });
  assert.equal(response.status, 201);
  const joined = await response.json() as JoinRoomResponse;
  harness.roomCodes.add(joined.roomCode);
  return joined;
}

async function joinRoom(harness: Harness, roomCode: string, displayName: string): Promise<JoinRoomResponse> {
  const response = await fetch(`${harness.url}/rooms/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomCode, displayName }),
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<JoinRoomResponse>;
}

async function post(harness: Harness, path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
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
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 4_000);
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

async function connectTracked(harness: Harness, auth: JoinRoomResponse): Promise<TrackedClient> {
  const socket = await connect(harness, auth.token);
  const client: TrackedClient = { auth, socket, room: null, game: null, mine: null };
  socket.on('room_updated', (room: RoomPublicState) => { client.room = room; });
  socket.on('game_state', (game: CitadelsPublicState) => { client.game = game; });
  socket.on('private_state', (mine: CitadelsPrivateState) => { client.mine = mine; });
  socket.emit('request_state');
  await waitUntil(() => client.room !== null);
  return client;
}

async function createTrackedRoom(harness: Harness, count: number): Promise<TrackedClient[]> {
  const auths = [await createRoom(harness, 'Builder 1')];
  for (let index = 1; index < count; index += 1) {
    auths.push(await joinRoom(harness, auths[0]!.roomCode, `Builder ${index + 1}`));
  }
  const clients: TrackedClient[] = [];
  for (const auth of auths) clients.push(await connectTracked(harness, auth));
  return clients;
}

function serverState(roomCode: string): CitadelsServerState {
  const game = roomStore.get(roomCode)?.game;
  assert.equal(game?.id, 'citadels');
  return game.state;
}

async function startGame(clients: TrackedClient[]): Promise<CitadelsPublicState> {
  const accepted = waitForEvent<CitadelsActionAccepted>(clients[0]!.socket, 'citadels:action_accepted');
  const started = waitForEvent<CitadelsPublicState>(clients[0]!.socket, 'game_state');
  clients[0]!.socket.emit('start_game', {});
  const [ack, game] = await Promise.all([accepted, started]);
  assert.deepEqual(ack, { action: 'start', revision: 0 });
  await waitUntil(() => clients.every((client) => client.game !== null && client.mine !== null));
  return game;
}

async function emitAccepted(
  client: TrackedClient,
  event: string,
  payload: unknown,
  action: CitadelsActionAccepted['action'],
): Promise<CitadelsActionAccepted> {
  const accepted = waitForEvent<CitadelsActionAccepted>(client.socket, 'citadels:action_accepted');
  client.socket.emit(event, payload);
  const ack = await accepted;
  assert.equal(ack.action, action);
  return ack;
}

interface SocketMatchMetrics {
  autopilotBursts: number;
  autopilotCommands: number;
  onState?: (state: CitadelsPublicState) => void;
}

function recordAutopilotSettlement(
  metrics: SocketMatchMetrics | undefined,
  beforeRevision: number,
  acknowledgedRevision: number,
): void {
  if (!metrics) return;
  const automatedCommands = acknowledgedRevision - beforeRevision - 1;
  if (automatedCommands <= 0) return;
  metrics.autopilotBursts += 1;
  metrics.autopilotCommands += automatedCommands;
}

async function playCompleteSocketMatch(
  clients: TrackedClient[],
  metrics?: SocketMatchMetrics,
): Promise<number> {
  const byId = new Map(clients.map((client) => [client.auth.playerId, client]));
  let commands = 0;
  let highestRound = 1;
  while (commands < 4_000) {
    await waitUntil(() => clients.every(client => client.game && client.mine
      && client.game.revision === clients[0]!.game?.revision
      && client.mine.revision === client.game.revision));
    const state = clients[0]!.game!;
    metrics?.onState?.(state);
    if (state.status === 'game_over') break;
    highestRound = Math.max(highestRound, state.roundNumber);
    if (state.phase === 'drafting') {
      const actorId = state.draftPlayerId!;
      const actor = byId.get(actorId);
      assert.ok(actor, 'forfeited drafter was not settled before the next socket command');
      assert.equal(state.players.find(player => player.playerId === actorId)!.forfeited, false);
      const role = actor.mine!.availableRoles[commands % actor.mine!.availableRoles.length]!;
      const beforeRevision = state.revision;
      const ack = await emitAccepted(actor, 'citadels:choose-character', {
        role,
        expectedRevision: beforeRevision,
      }, 'choose_character');
      recordAutopilotSettlement(metrics, beforeRevision, ack.revision);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
      commands += 1;
      continue;
    }
    const actorId = state.activePlayerId!;
    const actor = byId.get(actorId);
    assert.ok(actor, 'forfeited role turn was not settled before the next socket command');
    assert.equal(state.players.find(player => player.playerId === actorId)!.forfeited, false);
    const player = state.players.find(player => player.playerId === actorId)!;
    const mine = actor.mine!;
    if (state.phase === 'choose_income') {
      const hasNewName = mine.hand.some((card) => !player.city.some((built) => built.name === card.name));
      const beforeRevision = state.revision;
      const ack = await emitAccepted(actor, 'citadels:choose-income', {
        choice: hasNewName ? 'gold' : 'cards',
        expectedRevision: beforeRevision,
      }, 'choose_income');
      recordAutopilotSettlement(metrics, beforeRevision, ack.revision);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
      commands += 1;
      continue;
    }
    if (state.phase === 'choose_cards') {
      const card = [...mine.drawnCards].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0]!;
      const beforeRevision = state.revision;
      const ack = await emitAccepted(actor, 'citadels:keep-district', {
        cardId: card.id,
        expectedRevision: beforeRevision,
      }, 'keep_district');
      recordAutopilotSettlement(metrics, beforeRevision, ack.revision);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
      commands += 1;
      continue;
    }
    assert.equal(state.phase, 'action');
    const legal = [...mine.legalBuildCardIds].sort((a, b) =>
      mine.effectiveBuildCosts[a]! - mine.effectiveBuildCosts[b]! || a.localeCompare(b))[0];
    if (legal && mine.canBuild) {
      const beforeRevision = state.revision;
      const ack = await emitAccepted(actor, 'citadels:build', {
        cardId: legal,
        expectedRevision: beforeRevision,
      }, 'build');
      recordAutopilotSettlement(metrics, beforeRevision, ack.revision);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
    } else {
      const beforeRevision = state.revision;
      const ack = await emitAccepted(actor, 'citadels:end-turn', {
        expectedRevision: beforeRevision,
      }, 'end_turn');
      recordAutopilotSettlement(metrics, beforeRevision, ack.revision);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
    }
    commands += 1;
  }
  assert.ok(commands < 4_000, 'socket match exceeded command limit');
  const finished = clients[0]!.game!;
  assert.equal(finished.status, 'game_over');
  assert.equal(finished.winnerIds.length, 1);
  assert.equal(finished.players.find(player => player.playerId === finished.winnerIds[0])!.forfeited, false);
  assert.ok(highestRound >= 2, 'socket match did not cross a round boundary');
  await waitUntil(() => clients.every(client => client.room?.status === 'finished'));
  return commands;
}

function createDirectRoom(): { room: ServerRoom; state: CitadelsServerState; io: Server } {
  const room = roomStore.create(DIRECT_PLAYERS[0]!.playerId, null, 'citadels', {});
  for (const player of DIRECT_PLAYERS) {
    roomStore.addPlayer(
      room,
      { ...player, isHost: player.playerId === DIRECT_PLAYERS[0]!.playerId },
      Date.now() + 60_000,
    );
    roomStore.markConnected(room, player.playerId, `${player.playerId}-socket`);
  }
  const state = initCitadelsGame(room.roomCode, DIRECT_PLAYERS, () => 0.25);
  room.status = 'in_game';
  room.game = { id: 'citadels', state };
  const io = { to: () => ({ emit: () => undefined }) } as unknown as Server;
  return { room, state, io };
}

function takeFixtureCard(state: CitadelsServerState, templateId: string): CitadelsDistrictCard {
  const piles = [state.districtDeck, state.pendingDraw,
    ...[...state.players.values()].flatMap(player => [player.hand, player.city])];
  for (const pile of piles) {
    const index = pile.findIndex(card => card.templateId === templateId);
    if (index >= 0) return pile.splice(index, 1)[0]!;
  }
  throw new Error(`Canonical fixture card unavailable: ${templateId}`);
}

test('Citadels payload validators accept only exact revisioned shapes', () => {
  assert.equal(isCitadelsStartPayload(undefined), true);
  assert.equal(isCitadelsStartPayload({}), true);
  assert.equal(isCitadelsStartPayload(null), false);
  assert.equal(isCitadelsStartPayload([]), false);
  assert.equal(isCitadelsStartPayload({ expectedRevision: 0 }), false);

  assert.equal(isCitadelsChooseRolePayload({ role: 'king', expectedRevision: 0 }), true);
  assert.equal(isCitadelsChooseRolePayload({ role: 'king' }), false);
  assert.equal(isCitadelsChooseRolePayload({ role: 'emperor', expectedRevision: 0 }), false);
  assert.equal(isCitadelsChooseRolePayload({ role: 'king', expectedRevision: -1 }), false);
  assert.equal(isCitadelsChooseRolePayload({ role: 'king', expectedRevision: 0, extra: true }), false);

  assert.equal(isCitadelsChooseIncomePayload({ choice: 'gold', expectedRevision: 2 }), true);
  assert.equal(isCitadelsChooseIncomePayload({ choice: 'cards', expectedRevision: 2 }), true);
  assert.equal(isCitadelsChooseIncomePayload({ choice: 'gold' }), false);
  assert.equal(isCitadelsChooseIncomePayload({ choice: 'coins', expectedRevision: 2 }), false);

  assert.equal(isCitadelsPowerPayload({ action: 'tax', expectedRevision: 1 }), true);
  assert.equal(isCitadelsPowerPayload({ action: 'architect_draw', expectedRevision: 1 }), true);
  assert.equal(isCitadelsPowerPayload({ action: 'redraw_hand', cardIds: ['market-1'], expectedRevision: 1 }), true);
  assert.equal(isCitadelsPowerPayload({ action: 'redraw_hand', cardIds: {}, expectedRevision: 1 }), false);
  assert.equal(isCitadelsPowerPayload({ action: 'redraw_hand', cardIds: ['market-1', 'market-1'], expectedRevision: 1 }), false);
  assert.equal(isCitadelsPowerPayload({ action: 'redraw_hand', cardIds: [], expectedRevision: 1 }), false);
  assert.equal(isCitadelsPowerPayload({ action: 'redraw_hand', cardIds: ['market-1'] }), false);
  assert.equal(isCitadelsPowerPayload({ action: 'destroy', targetPlayerId: 'p1', districtId: 'keep-1', expectedRevision: 1 }), true);
  assert.equal(isCitadelsPowerPayload({ action: 'tax', expectedRevision: 1, targetRole: 'king' }), false);

  assert.equal(isCitadelsDistrictPowerPayload({ districtId: 'smithy-1', expectedRevision: 3 }), true);
  assert.equal(isCitadelsDistrictPowerPayload({ districtId: 'lab-1', cardId: 'market-1', expectedRevision: 3 }), true);
  assert.equal(isCitadelsDistrictPowerPayload({ districtId: 'lab-1', cardId: {}, expectedRevision: 3 }), false);
  assert.equal(isCitadelsDistrictPowerPayload({ districtId: 'lab-1' }), false);
  assert.equal(isCitadelsEndTurnPayload({ expectedRevision: 3 }), true);
  assert.equal(isCitadelsEndTurnPayload({}), false);
  assert.equal(isCitadelsEndTurnPayload({ expectedRevision: 3, extra: true }), false);
});

test('Citadels forfeited completion cannot reserve or dilute a live completion bonus', () => {
  const state = initCitadelsGame('FAIRNESS', [...DIRECT_PLAYERS, { playerId: 'eve', displayName: 'Eve' }], () => 0.25);
  const departed = state.players.get('alice')!;
  departed.city = CITADELS_DISTRICT_MANIFEST.slice(0, 7).map(card => takeFixtureCard(state, card.templateId));
  state.completionOrder = [departed.playerId];
  state.firstCompletedPlayerId = departed.playerId;

  const live = state.players.get('bob')!;
  live.city = CITADELS_DISTRICT_MANIFEST.slice(7, 13).map(card => takeFixtureCard(state, card.templateId));
  state.districtDeck.push(...live.hand.splice(0));
  live.hand = [takeFixtureCard(state, CITADELS_DISTRICT_MANIFEST[13]!.templateId)];
  live.gold = live.hand[0]!.cost;
  live.role = 'bishop';
  live.revealedRole = 'bishop';
  live.lastRoleRank = 5;
  state.activePlayerId = live.playerId;
  state.activeRole = 'bishop';
  state.phase = 'action';
  state.draftPlayerId = null;
  state.availableRoles = [];
  state.roleOwners.set('bishop', live.playerId);
  state.callIndex = CITADELS_ROLE_ORDER.length;

  expectOk(forfeitCitadelsPlayers(state, [departed.playerId], state.revision));
  assert.equal(state.firstCompletedPlayerId, null);
  expectOk(buildDistrict(state, live.playerId, live.hand[0]!.id, state.revision));
  assert.equal(state.firstCompletedPlayerId, live.playerId);
  expectOk(endCitadelsTurn(state, live.playerId, state.revision));
  assert.equal(state.scoreBreakdowns[departed.playerId]!.completionBonus, 0);
  assert.equal(state.scoreBreakdowns[live.playerId]!.completionBonus, 4);
  assert.equal(departed.score, 0);
});

test('Citadels automatic Merchant gold resolves after theft and stays strictly beneficial in the curated set', () => {
  const state = initCitadelsGame('MERCHANT', DIRECT_PLAYERS, () => 0.25);
  const previous = state.players.get('alice')!;
  previous.role = 'bishop';
  previous.revealedRole = 'bishop';
  state.activePlayerId = previous.playerId;
  state.activeRole = 'bishop';
  state.phase = 'action';
  state.callIndex = CITADELS_ROLE_ORDER.indexOf('merchant');

  const merchant = state.players.get('bob')!;
  merchant.role = 'merchant';
  merchant.gold = 4;
  merchant.city = [takeFixtureCard(state, 'market')];
  state.roleOwners.set('merchant', merchant.playerId);
  const thief = state.players.get('carol')!;
  thief.gold = 1;
  state.robbedRole = 'merchant';
  state.thiefPlayerId = thief.playerId;

  expectOk(endCitadelsTurn(state, previous.playerId, state.revision));
  assert.equal(state.activePlayerId, merchant.playerId);
  assert.equal(state.phase, 'choose_income');
  assert.equal(thief.gold, 5, 'Thief must receive the Merchant’s pre-turn gold first');
  assert.equal(merchant.gold, 1, 'Merchant must then receive exactly one automatic gold');
  assert.equal(merchant.specialUsed, true);
  assert.equal(merchant.taxUsed, false, 'automatic gold must remain separate from district income');
  expectOk(useCharacterPower(state, merchant.playerId, { action: 'tax' }, state.revision));
  assert.equal(merchant.gold, 2, 'Merchant must still be able to collect trade income');
  assert.equal(state.phase, 'choose_income', 'automatic and district gold must not replace resource gathering');

  const includedEffects = new Set(CITADELS_DISTRICT_MANIFEST.map((card) => card.effect).filter(Boolean));
  assert.deepEqual([...includedEffects].sort(), [
    'dragon_gate', 'factory', 'gold_mine', 'great_wall', 'haunted_city', 'imperial_treasury',
    'keep', 'laboratory', 'library', 'map_room', 'observatory', 'school_of_magic', 'smithy',
    'wishing_well',
  ]);
  assert.ok(merchant.gold >= 0, 'the curated engine has no gold cap or penalty triggered by holding this gold');
});

test('Citadels start is exact, host-only and waits for every reserved lobby seat', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Host');
    const second = await joinRoom(harness, host.roomCode, 'Second');
    const third = await joinRoom(harness, host.roomCode, 'Third');
    const fourth = await joinRoom(harness, host.roomCode, 'Fourth');
    const hostSocket = await connect(harness, host.token);
    const secondSocket = await connect(harness, second.token);

    let rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', { extra: true });
    assert.equal((await rejected).reason, 'Invalid payload');

    rejected = waitForEvent<{ reason: string }>(secondSocket, 'action_rejected');
    secondSocket.emit('start_game', {});
    assert.match((await rejected).reason, /Only the host/);

    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejected).reason, /connecting or reconnecting/i);
    assert.equal(roomStore.get(host.roomCode)?.status, 'lobby');

    await connect(harness, third.token);
    await connect(harness, fourth.token);
    const accepted = waitForEvent<CitadelsActionAccepted>(hostSocket, 'citadels:action_accepted');
    hostSocket.emit('start_game', {});
    assert.deepEqual(await accepted, { action: 'start', revision: 0 });
    assert.equal(serverState(host.roomCode).players.size, 4);

    const original = roomStore.get(host.roomCode)?.game;
    rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejected).reason, /already in progress/i);
    assert.equal(roomStore.get(host.roomCode)?.game, original);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels rejects malformed, missing-revision and stale socket actions without mutation', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const state = serverState(clients[0]!.auth.roomCode);
    const initialRevision = state.revision;
    const initialPublic = JSON.stringify(clients[0]!.game);

    let rejected = waitForEvent<{ reason: string }>(clients[0]!.socket, 'action_rejected');
    clients[0]!.socket.emit('citadels:power', {
      action: 'redraw_hand', cardIds: {}, expectedRevision: initialRevision,
    });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(state.revision, initialRevision);

    rejected = waitForEvent<{ reason: string }>(clients[0]!.socket, 'action_rejected');
    clients[0]!.socket.emit('citadels:choose-character', { role: 'king' });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(state.revision, initialRevision);

    const actorId = state.draftPlayerId!;
    const actor = clients.find((client) => client.auth.playerId === actorId)!;
    rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
    actor.socket.emit('citadels:choose-character', {
      role: state.availableRoles[0],
      expectedRevision: initialRevision + 1,
    });
    assert.match((await rejected).reason, /changed/i);
    assert.equal(state.revision, initialRevision);
    assert.equal(JSON.stringify(clients[0]!.game), initialPublic);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels draft and hand privacy hold, and acknowledgements are sender-only', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const state = serverState(clients[0]!.auth.roomCode);
    await waitUntil(() => clients.every((client) => client.game?.revision === state.revision));
    for (const client of clients) {
      const publicJson = JSON.stringify(client.game);
      assert.equal(publicJson.includes('availableRoles'), false);
      assert.equal(publicJson.includes('faceDownDiscard'), false);
      for (const privateClient of clients) {
        for (const card of privateClient.mine!.hand) assert.equal(publicJson.includes(card.id), false);
      }
    }
    const actorId = state.draftPlayerId!;
    const actor = clients.find((client) => client.auth.playerId === actorId)!;
    assert.ok(actor.mine!.availableRoles.length > 0);
    assert.ok(clients.filter((client) => client !== actor).every((client) => client.mine!.availableRoles.length === 0));

    const acknowledgementCounts = new Map(clients.map((client) => [client.auth.playerId, 0]));
    for (const client of clients) {
      client.socket.on('citadels:action_accepted', () => {
        acknowledgementCounts.set(client.auth.playerId, acknowledgementCounts.get(client.auth.playerId)! + 1);
      });
    }
    await emitAccepted(actor, 'citadels:choose-character', {
      role: actor.mine!.availableRoles[0],
      expectedRevision: state.revision,
    }, 'choose_character');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(acknowledgementCounts.get(actorId), 1);
    for (const client of clients.filter((candidate) => candidate !== actor)) {
      assert.equal(acknowledgementCounts.get(client.auth.playerId), 0);
    }
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels replaced socket cannot mutate through the superseded session', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const oldClient = clients[1]!;
    const replaced = waitForEvent<{ message: string }>(oldClient.socket, 'session_replaced');
    const replacement = await connectTracked(harness, oldClient.auth);
    assert.match((await replaced).message, /another connection/i);
    await waitUntil(() => oldClient.socket.disconnected);
    const room = roomStore.get(oldClient.auth.roomCode)!;
    assert.equal(room.players.get(oldClient.auth.playerId)!.socketId, replacement.socket.id);
    assert.equal(room.players.get(oldClient.auth.playerId)!.isConnected, true);
    const revision = serverState(oldClient.auth.roomCode).revision;
    oldClient.socket.emit('citadels:choose-character', {
      role: 'king', expectedRevision: revision,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(serverState(oldClient.auth.roomCode).revision, revision);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels room lifecycle batches simultaneous expiries without a phantom winner', async () => {
  const { room, state, io } = createDirectRoom();
  try {
    for (const player of room.players.values()) {
      assert.equal(markPlayerDisconnected(io, room, player.playerId, player.socketId, 0), true);
    }
    await waitUntil(() => state.status === 'game_over');
    assert.ok([...room.players.values()].every((player) => player.hasLeft));
    assert.ok([...state.players.values()].every((player) => player.forfeited));
    assert.deepEqual(state.winnerIds, []);
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.equal(buildCitadelsResult(state), null);
    assert.equal(state.revision, 1);
    assert.equal(room.status, 'finished');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('Citadels delayed recovery batches overdue seats before scheduler callbacks', () => {
  const { room, state, io } = createDirectRoom();
  try {
    for (const player of room.players.values()) {
      player.isConnected = false;
      player.socketId = null;
      player.reconnectDeadlineAt = Date.now() - 1;
    }
    assert.equal(recoverDisconnectedCitadelsPlayers(io, room), true);
    assert.equal(state.status, 'game_over');
    assert.deepEqual(state.winnerIds, []);
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.equal(buildCitadelsResult(state), null);
    assert.ok([...state.players.values()].every(player => player.forfeited));
    assert.equal(recoverDisconnectedCitadelsPlayers(io, room), false);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

const VALID_COMMANDS = [
  ['citadels:choose-character', { role: 'king' }],
  ['citadels:choose-income', { choice: 'gold' }],
  ['citadels:keep-district', { cardId: 'market-1' }],
  ['citadels:build', { cardId: 'market-1' }],
  ['citadels:power', { action: 'tax' }],
  ['citadels:district-power', { districtId: 'smithy-1' }],
  ['citadels:end-turn', {}],
] as const;

for (const [event, payload] of VALID_COMMANDS) {
  test(`Citadels ${event} recovers overdue batch before validating gameplay revision`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 6);
      await startGame(clients);
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const before = clients[2]!.game!.revision;
      for (const client of clients.slice(0, 2)) {
        client.socket.disconnect();
        await waitUntil(() => !room.players.get(client.auth.playerId)!.isConnected);
        const player = room.players.get(client.auth.playerId)!;
        roomStore.clearPresenceTimer(player);
        player.reconnectDeadlineAt = Date.now() - 1;
      }
      const rejected = waitForEvent<{ reason: string }>(clients[2]!.socket, 'action_rejected');
      clients[2]!.socket.emit(event, { ...payload, expectedRevision: before });
      assert.match((await rejected).reason, /changed/i);
      await waitUntil(() => clients[2]!.game!.revision > before);
      assert.ok(clients[2]!.game!.players.filter(player => clients.slice(0, 2)
        .some(client => client.auth.playerId === player.playerId)).every(player => player.forfeited));
      assert.notEqual(room.hostPlayerId, clients[0]!.auth.playerId);
      assert.ok(clients.slice(0, 2).every(client => room.players.get(client.auth.playerId)!.hasLeft));
    } finally {
      await closeHarness(harness);
    }
  });

  test(`Citadels ${event} rejects null, arrays, extra fields and unsafe revisions`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      const actor = clients[0]!;
      for (const malformed of [null, [], {}, { ...payload, expectedRevision: 0, extra: true },
        { ...payload, expectedRevision: -1 }, { ...payload, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
        const rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
        actor.socket.emit(event, malformed);
        assert.equal((await rejected).reason, 'Invalid payload');
        assert.equal(serverState(actor.auth.roomCode).revision, 0);
      }
    } finally {
      await closeHarness(harness);
    }
  });
}

test('Citadels request_state recovers overdue seats and returns owned paired identity', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 5);
    await startGame(clients);
    const departed = clients[0]!;
    const room = roomStore.get(departed.auth.roomCode)!;
    departed.socket.disconnect();
    await waitUntil(() => !room.players.get(departed.auth.playerId)!.isConnected);
    const player = room.players.get(departed.auth.playerId)!;
    roomStore.clearPresenceTimer(player);
    player.reconnectDeadlineAt = Date.now() - 1;
    const survivor = clients[1]!;
    survivor.socket.emit('request_state');
    await waitUntil(() => survivor.game!.revision > 0 && survivor.mine?.revision === survivor.game?.revision);
    assert.equal(survivor.mine!.playerId, survivor.auth.playerId);
    assert.equal(survivor.mine!.roomCode, survivor.auth.roomCode);
    assert.equal(survivor.game!.players.find(seat => seat.playerId === departed.auth.playerId)!.forfeited, true);
    assert.equal(room.hostPlayerId, survivor.auth.playerId);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels real HTTP password, capacity, kick and foreign-room authority', async () => {
  const harness = await createHarness();
  try {
    const response = await post(harness, '/rooms/create', { displayName: 'Host', gameId: 'citadels', password: ' crown ' });
    assert.equal(response.status, 201);
    const host = await response.json() as JoinRoomResponse;
    harness.roomCodes.add(host.roomCode);
    assert.equal(host.room.maxPlayers, 7);
    assert.equal(host.room.hasPassword, true);
    assert.equal((await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: 'Wrong', password: 'crown' })).status, 403);
    const auths = [host];
    for (let index = 1; index < 7; index++) {
      const joined = await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: `Seat ${index}`, password: ' crown ' });
      assert.equal(joined.status, 200);
      auths.push(await joined.json() as JoinRoomResponse);
    }
    assert.equal((await post(harness, '/rooms/join', { roomCode: host.roomCode, displayName: 'Overflow', password: ' crown ' })).status, 409);
    const clients: TrackedClient[] = [];
    for (const auth of auths) clients.push(await connectTracked(harness, auth));
    const foreign = await createRoom(harness, 'Foreign');
    const targetPlayerId = auths[6]!.playerId;
    assert.equal((await post(harness, `/rooms/${host.roomCode}/kick`, { targetPlayerId })).status, 401);
    assert.equal((await post(harness, `/rooms/${host.roomCode}/kick`, { targetPlayerId }, foreign.token)).status, 403);
    assert.equal((await post(harness, `/rooms/${host.roomCode}/kick`, { targetPlayerId }, auths[1]!.token)).status, 403);
    const kicked = waitForEvent(clients[6]!.socket, 'player_kicked');
    assert.equal((await post(harness, `/rooms/${host.roomCode}/kick`, { targetPlayerId }, host.token)).status, 200);
    await kicked;
    await waitUntil(() => clients[6]!.socket.disconnected);
    assert.equal(roomStore.get(host.roomCode)!.players.has(targetPlayerId), false);
    await startGame(clients.slice(0, 6));
    assert.equal((await post(harness, `/rooms/${host.roomCode}/kick`, { targetPlayerId: auths[1]!.playerId }, host.token)).status, 409);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels duplicate draft packets accept once and cannot select another seat role', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const actor = clients.find(client => client.auth.playerId === clients[0]!.game!.draftPlayerId)!;
    let accepted = 0;
    actor.socket.on('citadels:action_accepted', () => accepted++);
    const rejection = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
    const payload = { role: actor.mine!.availableRoles[0], expectedRevision: 0 };
    actor.socket.emit('citadels:choose-character', payload);
    actor.socket.emit('citadels:choose-character', payload);
    assert.match((await rejection).reason, /changed/i);
    assert.equal(accepted, 1);
    await waitUntil(() => actor.game?.revision === 1 && actor.mine?.revision === 1);
    assert.equal(actor.mine!.chosenRole, payload.role);
    assert.notEqual(actor.game!.draftPlayerId, actor.auth.playerId);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels result builder excludes forfeits and never persists an abandoned council', () => {
  const state = initCitadelsGame('RESULTS', DIRECT_PLAYERS, () => 0.25);
  assert.equal(buildCitadelsResult(state), null);
  state.status = 'game_over';
  state.phase = 'game_over';
  state.winnerIds = ['bob'];
  state.players.get('alice')!.forfeited = true;
  const result = buildCitadelsResult(state)!;
  assert.deepEqual(result.players.map(player => player.playerId), ['bob', 'carol', 'dave']);
  assert.equal(result.players.filter(player => player.won).length, 1);
  state.winnerIds = [];
  assert.equal(buildCitadelsResult(state), null);
  state.terminationReason = 'not_enough_players';
  state.winnerIds = ['bob'];
  assert.equal(buildCitadelsResult(state), null, 'termination reason must independently fence competitive persistence');
});

for (const ability of ['tax', 'assassinate', 'rob', 'swap_hand', 'redraw_hand', 'architect_draw', 'destroy', 'laboratory', 'smithy'] as const) {
  test(`Citadels canonical ${ability} wire action is sender-acknowledged, private and replay-safe`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      const actor = clients[0]!;
      const target = clients[1]!;
      const state = serverState(actor.auth.roomCode);
      const role: CitadelsRole = ability === 'assassinate' ? 'assassin' : ability === 'rob' ? 'thief'
        : ['swap_hand', 'redraw_hand'].includes(ability) ? 'magician'
          : ability === 'architect_draw' ? 'architect' : ability === 'destroy' ? 'warlord' : 'king';
      state.phase = 'action';
      state.draftPlayerId = null;
      state.availableRoles = [];
      state.activePlayerId = actor.auth.playerId;
      state.activeRole = role;
      state.roleOwners.clear();
      state.roleOwners.set(role, actor.auth.playerId);
      const player = state.players.get(actor.auth.playerId)!;
      player.role = role;
      player.revealedRole = role;
      player.gold = 10;
      let payload: Record<string, unknown> = { action: ability };
      let event = 'citadels:power';
      let action: CitadelsActionAccepted['action'] = 'power';
      if (ability === 'assassinate' || ability === 'rob') payload.targetRole = 'merchant';
      if (ability === 'swap_hand') payload.targetPlayerId = target.auth.playerId;
      if (ability === 'redraw_hand') payload.cardIds = player.hand.slice(0, 2).map(card => card.id);
      if (ability === 'destroy') {
        const district = takeFixtureCard(state, 'market');
        state.players.get(target.auth.playerId)!.city.push(district);
        payload.targetPlayerId = target.auth.playerId;
        payload.districtId = district.id;
      }
      if (ability === 'laboratory' || ability === 'smithy') {
        const district = takeFixtureCard(state, ability);
        player.city.push(district);
        event = 'citadels:district-power';
        action = 'district_power';
        payload = { districtId: district.id, ...(ability === 'laboratory' ? { cardId: player.hand[0]!.id } : {}) };
      }
      const counts = new Map(clients.map(client => [client.auth.playerId, 0]));
      for (const client of clients) client.socket.on('citadels:action_accepted', () => counts.set(client.auth.playerId, counts.get(client.auth.playerId)! + 1));
      const beforeHand = player.hand.length;
      const beforeGold = player.gold;
      const ack = await emitAccepted(actor, event, { ...payload, expectedRevision: state.revision }, action);
      assert.equal(ack.revision, 1);
      await waitUntil(() => clients.every(client => client.game?.revision === 1 && client.mine?.revision === 1));
      assert.equal(counts.get(actor.auth.playerId), 1);
      assert.ok(clients.slice(1).every(client => counts.get(client.auth.playerId) === 0));
      for (const client of clients) {
        assert.equal(client.mine!.playerId, client.auth.playerId);
        const publicText = JSON.stringify(client.game);
        for (const card of client.mine!.hand) assert.equal(publicText.includes(card.id), false);
      }
      if (ability === 'architect_draw') assert.equal(actor.mine!.hand.length, beforeHand + 2);
      if (ability === 'smithy') {
        assert.equal(actor.mine!.hand.length, beforeHand + 3);
        assert.equal(actor.game!.players[0]!.gold, beforeGold - 2);
      }
      if (ability === 'laboratory') {
        assert.equal(actor.mine!.hand.length, beforeHand - 1);
        assert.equal(actor.game!.players[0]!.gold, beforeGold + 2);
      }
      const rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
      actor.socket.emit(event, { ...payload, expectedRevision: 0 });
      assert.match((await rejected).reason, /changed/i);
      assert.equal(state.revision, 1);
      assert.equal(counts.get(actor.auth.playerId), 1);
    } finally {
      await closeHarness(harness);
    }
  });
}

async function reachChoice(clients: TrackedClient[], phase: CitadelsPublicState['phase']): Promise<TrackedClient> {
  for (let steps = 0; steps < 20; steps++) {
    const game = clients[0]!.game!;
    const actor = clients.find(client => client.auth.playerId ===
      (game.phase === 'drafting' ? game.draftPlayerId : game.activePlayerId))!;
    assert.ok(actor);
    if (game.phase === phase) return actor;
    let ack: CitadelsActionAccepted;
    if (game.phase === 'drafting') {
      ack = await emitAccepted(actor, 'citadels:choose-character', {
        role: actor.mine!.availableRoles[0], expectedRevision: game.revision,
      }, 'choose_character');
    } else if (game.phase === 'choose_income') {
      ack = await emitAccepted(actor, 'citadels:choose-income', {
        choice: phase === 'choose_cards' ? 'cards' : 'gold', expectedRevision: game.revision,
      }, 'choose_income');
    } else throw new Error(`Unexpected phase ${game.phase} before ${phase}`);
    await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
  }
  throw new Error(`Could not reach ${phase}`);
}

function assertCanonicalCards(state: CitadelsServerState): void {
  const cards = [...state.districtDeck, ...state.pendingDraw,
    ...[...state.players.values()].flatMap(player => [...player.hand, ...player.city])];
  assert.equal(cards.length, 68);
  assert.equal(new Set(cards.map(card => card.id)).size, 68);
}

async function depart(harness: Harness, actor: TrackedClient, departure: 'explicit' | 'expired'): Promise<void> {
  const room = roomStore.get(actor.auth.roomCode)!;
  if (departure === 'explicit') {
    assert.equal((await post(harness, `/rooms/${room.roomCode}/leave`, {}, actor.auth.token)).status, 200);
  } else {
    assert.equal(markPlayerDisconnected(harness.io, room, actor.auth.playerId, actor.socket.id!, 0), true);
    actor.socket.disconnect();
  }
}

function finalActorFixture(state: CitadelsServerState, actorId: string, role: CitadelsRole = 'warlord'): void {
  state.phase = 'action';
  state.draftPlayerId = null;
  state.availableRoles = [];
  state.activePlayerId = actorId;
  state.activeRole = role;
  state.roleOwners.clear();
  state.roleOwners.set(role, actorId);
  state.callIndex = CITADELS_ROLE_ORDER.length;
  const actor = state.players.get(actorId)!;
  actor.role = role;
  actor.revealedRole = role;
  actor.lastRoleRank = CITADELS_ROLE_ORDER.indexOf(role) + 1;
}

for (const departure of ['explicit', 'expired'] as const) {
  test(`Citadels canonical final-actor ${departure} forfeiture transfers crown and archives before the next draft`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 5);
      await startGame(clients);
      const actor = clients[0]!;
      const room = roomStore.get(actor.auth.roomCode)!;
      const state = serverState(room.roomCode);
      finalActorFixture(state, actor.auth.playerId);
      state.crownPlayerId = actor.auth.playerId;
      const handIds = state.players.get(actor.auth.playerId)!.hand.map(card => card.id);
      await depart(harness, actor, departure);
      const survivor = clients[1]!;
      await waitUntil(() => survivor.game?.roundNumber === 2 && survivor.mine?.revision === survivor.game.revision);
      assert.equal(survivor.game!.phase, 'drafting');
      assert.equal(survivor.game!.terminationReason, null);
      assert.equal(survivor.game!.players.length, 5);
      assert.equal(survivor.game!.turnOrder.length, 4);
      assert.equal(survivor.game!.crownPlayerId, survivor.auth.playerId);
      assert.equal(survivor.game!.draftPlayerId, survivor.auth.playerId);
      assert.equal(survivor.game!.faceUpDiscard.length, 2);
      assert.equal(survivor.mine!.availableRoles.length, 5);
      assert.equal(room.hostPlayerId, survivor.auth.playerId);
      const archived = state.players.get(actor.auth.playerId)!;
      assert.equal(archived.forfeited, true);
      assert.deepEqual(archived.hand, []);
      assert.equal(archived.role, null);
      assert.equal(archived.revealedRole, null);
      assert.equal(archived.lastRoleRank, 0);
      assert.equal(archived.usedDistrictIds.size, 0);
      assert.ok(handIds.every(id => state.districtDeck.some(card => card.id === id) || archived.city.some(card => card.id === id)));
      assertCanonicalCards(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('Citadels canonical killed departed King cannot reclaim the transferred crown at the boundary', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 5);
    await startGame(clients);
    const departed = clients[0]!;
    const actor = clients[4]!;
    const room = roomStore.get(actor.auth.roomCode)!;
    const state = serverState(room.roomCode);
    finalActorFixture(state, actor.auth.playerId);
    state.crownPlayerId = departed.auth.playerId;
    state.players.get(departed.auth.playerId)!.role = 'king';
    state.roleOwners.set('king', departed.auth.playerId);
    state.killedRole = 'king';
    await depart(harness, departed, 'explicit');
    await waitUntil(() => actor.game!.players.find(player => player.playerId === departed.auth.playerId)!.forfeited
      && actor.game!.revision === state.revision && actor.mine!.revision === state.revision);
    const ack = await emitAccepted(actor, 'citadels:end-turn', { expectedRevision: actor.game!.revision }, 'end_turn');
    await waitUntil(() => actor.game?.revision === ack.revision && actor.mine?.revision === ack.revision);
    assert.equal(actor.game!.roundNumber, 2);
    assert.equal(actor.game!.crownPlayerId, clients[1]!.auth.playerId);
    assert.equal(actor.game!.draftPlayerId, clients[1]!.auth.playerId);
    assert.equal(actor.game!.turnOrder.includes(departed.auth.playerId), false);
    assertCanonicalCards(state);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels canonical 7-to-4 overdue boundary batch skips every departed crown successor and uses four-seat drafting', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 7);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = serverState(room.roomCode);
    finalActorFixture(state, clients[0]!.auth.playerId);
    state.crownPlayerId = clients[0]!.auth.playerId;
    const retired = clients.slice(0, 3);
    for (const client of retired) {
      client.socket.disconnect();
      await waitUntil(() => !room.players.get(client.auth.playerId)!.isConnected);
      const seat = room.players.get(client.auth.playerId)!;
      roomStore.clearPresenceTimer(seat);
      seat.reconnectDeadlineAt = Date.now() - 1;
    }
    const survivor = clients[3]!;
    survivor.socket.emit('request_state');
    await waitUntil(() => survivor.game?.roundNumber === 2 && survivor.mine?.revision === survivor.game.revision);
    assert.equal(survivor.game!.status, 'playing');
    assert.equal(survivor.game!.players.length, 7);
    assert.equal(survivor.game!.crownPlayerId, survivor.auth.playerId);
    assert.equal(survivor.game!.draftPlayerId, survivor.auth.playerId);
    assert.equal(room.hostPlayerId, survivor.auth.playerId);
    assert.deepEqual(survivor.game!.turnOrder, clients.slice(3).map(client => client.auth.playerId));
    assert.equal(survivor.game!.faceUpDiscard.length, 2);
    assert.equal(survivor.mine!.availableRoles.length, 5);
    for (const client of retired) {
      const row = survivor.game!.players.find(player => player.playerId === client.auth.playerId)!;
      assert.equal(row.forfeited, true);
      assert.equal(row.handCount, 0);
      assert.equal(row.isCrowned, false);
    }
    assertCanonicalCards(state);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels request_state batches missing, already-left and overdue seats without leaking private authority', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 6);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const state = serverState(room.roomCode);
    room.players.delete(clients[0]!.auth.playerId);
    room.players.get(clients[1]!.auth.playerId)!.hasLeft = true;
    clients[2]!.socket.disconnect();
    await waitUntil(() => !room.players.get(clients[2]!.auth.playerId)!.isConnected);
    const overdue = room.players.get(clients[2]!.auth.playerId)!;
    roomStore.clearPresenceTimer(overdue);
    overdue.reconnectDeadlineAt = Date.now() - 1;
    const privateCounts = [0, 0];
    clients.slice(0, 2).forEach((client, index) => client.socket.on('private_state', () => privateCounts[index]!++));
    const survivor = clients[3]!;
    survivor.socket.emit('request_state');
    await waitUntil(() => survivor.game?.status === 'game_over' && survivor.mine?.revision === survivor.game.revision);
    assert.equal(state.revision, 1);
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.equal(survivor.game!.players.filter(player => player.forfeited).length, 3);
    assert.deepEqual(privateCounts, [0, 0]);
    assert.equal(buildCitadelsResult(state), null);
    for (const client of clients.slice(0, 2)) {
      const denied = waitForEvent<{ message: string }>(client.socket, 'server_error');
      client.socket.emit('request_state');
      assert.match((await denied).message, /authorised|no longer exists|session/i);
    }
    assert.deepEqual(privateCounts, [0, 0]);
    assert.equal(state.revision, 1);
    assertCanonicalCards(state);
  } finally {
    await closeHarness(harness);
  }
});

for (const ability of ['swap_hand', 'destroy'] as const) {
  test(`Citadels canonical archived seat cannot be targeted by ${ability} or recover private authority`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 5);
      await startGame(clients);
      const target = clients[0]!;
      const actor = clients[1]!;
      const room = roomStore.get(actor.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const district = takeFixtureCard(state, 'market');
      state.players.get(target.auth.playerId)!.city.push(district);
      finalActorFixture(state, target.auth.playerId);
      await depart(harness, target, 'explicit');
      await waitUntil(() => actor.game?.roundNumber === 2);
      finalActorFixture(state, actor.auth.playerId, ability === 'swap_hand' ? 'magician' : 'warlord');
      state.players.get(actor.auth.playerId)!.gold = 10;
      actor.socket.emit('request_state');
      await waitUntil(() => actor.mine?.chosenRole === (ability === 'swap_hand' ? 'magician' : 'warlord'));
      const snapshot = structuredClone({ ...state, rng: null });
      const rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
      actor.socket.emit('citadels:power', {
        action: ability, targetPlayerId: target.auth.playerId,
        ...(ability === 'destroy' ? { districtId: district.id } : {}), expectedRevision: state.revision,
      });
      assert.match((await rejected).reason, /current-round/i);
      assert.deepEqual({ ...state, rng: null }, snapshot);
      const reconnect = createClient(harness.url, { auth: { token: target.auth.token },
        transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
      harness.clients.push(reconnect);
      let privateFrames = 0;
      reconnect.on('private_state', () => privateFrames++);
      const denied = waitForEvent<{ message: string }>(reconnect, 'server_error');
      reconnect.connect();
      assert.equal((await denied).message, 'Room or player no longer exists');
      assert.equal(privateFrames, 0);
      assert.deepEqual({ ...state, rng: null }, snapshot);
      assertCanonicalCards(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('Citadels canonical last-round leave below four cancels even an already completed city without scoring', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 4);
    await startGame(clients);
    const actor = clients[0]!;
    const state = serverState(actor.auth.roomCode);
    finalActorFixture(state, actor.auth.playerId);
    state.roundNumber = 10;
    const completed = state.players.get(clients[1]!.auth.playerId)!;
    completed.city = CITADELS_DISTRICT_MANIFEST.slice(0, 7).map(card => takeFixtureCard(state, card.templateId));
    state.completionOrder = [completed.playerId];
    state.firstCompletedPlayerId = completed.playerId;
    await depart(harness, actor, 'explicit');
    await waitUntil(() => clients[1]!.game?.status === 'game_over');
    assert.equal(state.terminationReason, 'not_enough_players');
    assert.deepEqual(state.scoreBreakdowns, {});
    assert.deepEqual(state.winnerIds, []);
    assert.equal(completed.score, null);
    assert.equal(buildCitadelsResult(state), null);
    assertCanonicalCards(state);
  } finally {
    await closeHarness(harness);
  }
});

for (const phase of ['drafting', 'choose_income', 'choose_cards', 'action'] as const) {
  for (const departure of ['explicit', 'expired'] as const) {
    test(`Citadels 4-to-3 ${phase} ${departure} departure immediately abandons without scoring`, async () => {
      const harness = await createHarness();
      try {
        const clients = await createTrackedRoom(harness, 4);
        await startGame(clients);
        const actor = await reachChoice(clients, phase);
        const survivor = clients.find(client => client !== actor)!;
        const room = roomStore.get(actor.auth.roomCode)!;
        const state = serverState(room.roomCode);
        const before = state.revision;
        const pending = state.pendingDraw.map(card => card.id);
        const gold = new Map([...state.players].map(([id, player]) => [id, player.gold]));
        let accepted = 0;
        survivor.socket.on('citadels:action_accepted', () => accepted++);
        await depart(harness, actor, departure);
        await waitUntil(() => survivor.game?.status === 'game_over' && survivor.mine?.revision === survivor.game.revision);
        assert.equal(state.revision, before + 1, 'below-minimum departure must not autoplay any choice');
        assert.equal(survivor.game!.terminationReason, 'not_enough_players');
        assert.deepEqual(survivor.game!.winnerIds, []);
        assert.deepEqual(survivor.game!.scoreBreakdowns, {});
        assert.equal(survivor.game!.activePlayerId, null);
        assert.equal(survivor.game!.draftPlayerId, null);
        assert.equal(room.status, 'finished');
        assert.equal(room.timer, null);
        assert.equal(buildCitadelsResult(state), null);
        assert.equal(accepted, 0, 'departure is not an accepted command from a survivor');
        assert.equal(state.pendingDraw.length, 0);
        assert.ok(pending.every(id => state.districtDeck.some(card => card.id === id)));
        for (const player of state.players.values()) {
          assert.equal(player.gold, gold.get(player.playerId));
          assert.equal(player.score, player.forfeited ? 0 : null);
        }
        assertCanonicalCards(state);
        const snapshot = structuredClone({ ...state, rng: null });
        const rejected = waitForEvent<{ reason: string }>(survivor.socket, 'action_rejected');
        survivor.socket.emit('citadels:end-turn', { expectedRevision: before });
        await rejected;
        assert.deepEqual({ ...state, rng: null }, snapshot);
        assert.equal(recoverDisconnectedCitadelsPlayers(harness.io, room), false);
        const host = clients.find(client => client.auth.playerId === room.hostPlayerId)!;
        const notEnough = waitForEvent<{ reason: string }>(host.socket, 'action_rejected');
        host.socket.emit('start_game', {});
        assert.match((await notEnough).reason, /at least 4|Need 4/i);
        assert.deepEqual({ ...state, rng: null }, snapshot, 'failed undersized rematch preserves the terminal state');
      } finally {
        await closeHarness(harness);
      }
    });
  }
}

for (const trigger of ['command', 'request_state'] as const) {
  test(`Citadels overdue 5-to-3 batch via ${trigger} cannot settle pending income or create a winner`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 5);
      await startGame(clients);
      const actor = await reachChoice(clients, 'choose_cards');
      const departed = clients.filter(client => client !== actor).slice(0, 2);
      const room = roomStore.get(actor.auth.roomCode)!;
      const state = serverState(room.roomCode);
      const before = state.revision;
      const hand = [...actor.mine!.hand];
      for (const client of departed) {
        client.socket.disconnect();
        await waitUntil(() => !room.players.get(client.auth.playerId)!.isConnected);
        const seat = room.players.get(client.auth.playerId)!;
        roomStore.clearPresenceTimer(seat);
        seat.reconnectDeadlineAt = Date.now() - 1;
      }
      if (trigger === 'command') {
        const rejected = waitForEvent<{ reason: string }>(actor.socket, 'action_rejected');
        actor.socket.emit('citadels:keep-district', { cardId: actor.mine!.drawnCards[0]!.id, expectedRevision: before });
        assert.match((await rejected).reason, /changed/i);
      } else actor.socket.emit('request_state');
      await waitUntil(() => actor.game?.status === 'game_over' && actor.mine?.revision === actor.game.revision);
      assert.equal(state.revision, before + 1);
      assert.deepEqual(actor.mine!.hand, hand);
      assert.deepEqual(actor.mine!.drawnCards, []);
      assert.equal(actor.game!.players.filter(player => player.forfeited).length, 2);
      assert.equal(actor.game!.terminationReason, 'not_enough_players');
      assert.deepEqual(actor.game!.winnerIds, []);
      assert.equal(buildCitadelsResult(state), null);
      assertCanonicalCards(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

for (const phase of ['drafting', 'choose_income', 'choose_cards', 'action'] as const) {
  test(`Citadels ${phase} reconnect preserves its private pending choice within grace`, async () => {
    const harness = await createHarness();
    try {
      const clients = await createTrackedRoom(harness, 4);
      await startGame(clients);
      const actor = await reachChoice(clients, phase);
      const beforePublic = structuredClone(actor.game);
      const beforePrivate = structuredClone(actor.mine);
      actor.socket.disconnect();
      const restored = await connectTracked(harness, actor.auth);
      await waitUntil(() => restored.game !== null && restored.mine !== null);
      assert.deepEqual(restored.game, beforePublic);
      assert.deepEqual(restored.mine, beforePrivate);
      assert.equal(restored.mine!.roomCode, actor.auth.roomCode);
      assert.equal(restored.mine!.playerId, actor.auth.playerId);
      assert.equal(restored.game!.players.find(player => player.playerId === actor.auth.playerId)!.forfeited, false);
      const others = clients.filter(client => client !== actor);
      for (const client of others) {
        assert.deepEqual(client.mine!.drawnCards, []);
        assert.deepEqual(client.mine!.availableRoles, []);
      }
    } finally {
      await closeHarness(harness);
    }
  });

  for (const departure of ['explicit', 'expired'] as const) {
    test(`Citadels ${phase} active choice settles after ${departure} departure`, async () => {
      const harness = await createHarness();
      try {
        const clients = await createTrackedRoom(harness, 5);
        await startGame(clients);
        const actor = await reachChoice(clients, phase);
        const room = roomStore.get(actor.auth.roomCode)!;
        const before = actor.game!.revision;
        if (departure === 'explicit') {
          assert.equal((await post(harness, `/rooms/${room.roomCode}/leave`, {}, actor.auth.token)).status, 200);
        } else {
          assert.equal(markPlayerDisconnected(harness.io, room, actor.auth.playerId, actor.socket.id!, 0), true);
          actor.socket.disconnect();
        }
        const survivor = clients.find(client => client !== actor)!;
        await waitUntil(() => survivor.game!.players.find(player => player.playerId === actor.auth.playerId)!.forfeited
          && survivor.game!.revision === survivor.mine!.revision);
        assert.ok(survivor.game!.revision > before);
        assert.equal(survivor.game!.status, 'playing');
        assert.notEqual(survivor.game!.draftPlayerId, actor.auth.playerId);
        assert.notEqual(survivor.game!.activePlayerId, actor.auth.playerId);
        assert.equal(buildCitadelsResult(serverState(room.roomCode)), null);
        const restored = createClient(harness.url, {
          auth: { token: actor.auth.token }, forceNew: true, reconnection: false,
          transports: ['websocket'], autoConnect: false,
        });
        harness.clients.push(restored);
        let privateFrames = 0;
        restored.on('private_state', () => privateFrames++);
        const ended = waitForEvent<{ message: string }>(restored, 'server_error');
        restored.connect();
        assert.equal((await ended).message, 'Room or player no longer exists');
        assert.equal(privateFrames, 0);
      } finally {
        await closeHarness(harness);
      }
    });
  }
}

test('Citadels 5-to-4 survivor match removes its current-round ghost before every later draft and completes naturally', async () => {
  const harness = await createHarness();
  try {
    const clients = await createTrackedRoom(harness, 5);
    await startGame(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const departed = clients.find(client => client.auth.playerId !== clients[0]!.game!.draftPlayerId)!;
    assert.equal((await post(harness, `/rooms/${room.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await waitUntil(() => serverState(room.roomCode).players.get(departed.auth.playerId)!.forfeited);
    departed.socket.disconnect();
    const survivors = clients.filter(client => client !== departed);
    await waitUntil(() => survivors.every(client =>
      client.game?.players.find(player => player.playerId === departed.auth.playerId)?.forfeited
      && client.mine?.revision === client.game?.revision));
    let archived: { city: CitadelsDistrictCard[]; gold: number } | null = null;
    const metrics: SocketMatchMetrics = {
      autopilotBursts: 0, autopilotCommands: 0,
      onState: game => {
        const ghost = game.players.find(player => player.playerId === departed.auth.playerId)!;
        assert.equal(ghost.forfeited, true);
        assert.notEqual(game.crownPlayerId, ghost.playerId);
        if (game.roundNumber === 1) return;
        assert.equal(game.turnOrder.includes(ghost.playerId), false);
        assert.deepEqual(new Set(game.turnOrder), new Set(survivors.map(client => client.auth.playerId)));
        assert.equal(ghost.handCount, 0);
        assert.equal(ghost.revealedRole, null);
        assert.equal(ghost.score, 0);
        archived ??= structuredClone({ city: ghost.city, gold: ghost.gold });
        assert.deepEqual({ city: ghost.city, gold: ghost.gold }, archived, 'archived seats cannot gain later resources');
      },
    };
    const commands = await playCompleteSocketMatch(survivors, metrics);
    const state = serverState(room.roomCode);
    assert.ok(metrics.autopilotBursts >= 1, 'current-round ghost must settle after a live action');
    assert.ok(metrics.autopilotCommands >= 2, 'current-round ghost draft and turn must settle legally');
    assert.ok(archived, 'survivors must enter a reduced-roster next round');
    assert.equal(state.players.get(departed.auth.playerId)!.score, 0);
    assert.ok(state.players.get(departed.auth.playerId)!.city.length < CITADELS_CITY_SIZE);
    assert.equal(state.terminationReason, null);
    const result = buildCitadelsResult(state)!;
    assert.equal(result.players.length, 4);
    assert.equal(result.players.some(player => player.playerId === departed.auth.playerId), false);
    const host = survivors.find(client => client.auth.playerId === room.hostPlayerId)!;
    const previousRevision = state.revision;
    const ack = await emitAccepted(host, 'start_game', {}, 'start');
    assert.equal(ack.revision, previousRevision + 1);
    await waitUntil(() => survivors.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
    assert.equal(host.game!.players.length, 4);
    assert.equal(room.players.has(departed.auth.playerId), false);
    console.log(`CITADELS SURVIVORS: 5-to-4 natural completion, ${commands} accepted commands; reduced-roster rematch starts at ${ack.revision}.`);
  } finally {
    await closeHarness(harness);
  }
});

test('Citadels completes full matches and rematches for every supported player count', async () => {
  const harness = await createHarness();
  let totalCommands = 0;
  try {
    for (let count = 4; count <= 7; count += 1) {
      const clients = await createTrackedRoom(harness, count);
      await startGame(clients);
      totalCommands += await playCompleteSocketMatch(clients);
      await waitUntil(() => clients.every((client) => client.game?.status === 'game_over'));
      const room = roomStore.get(clients[0]!.auth.roomCode)!;
      const oldState = serverState(room.roomCode);
      room.timer = setTimeout(() => undefined, 60_000);
      room.timer.unref();
      const accepted = waitForEvent<CitadelsActionAccepted>(clients[0]!.socket, 'citadels:action_accepted');
      const started = waitForEvent<CitadelsPublicState>(clients[0]!.socket, 'game_state');
      clients[0]!.socket.emit('start_game', {});
      const [ack, next] = await Promise.all([accepted, started]);
      assert.deepEqual(ack, { action: 'start', revision: oldState.revision + 1 });
      assert.equal(room.timer, null);
      assert.notEqual(serverState(room.roomCode), oldState);
      assert.equal(next.phase, 'drafting');
      assert.equal(next.roundNumber, 1);
      assert.equal(next.players.length, count);
      assert.equal(serverState(room.roomCode).players.size, count);
      await waitUntil(() => clients.every(client => client.game?.revision === ack.revision && client.mine?.revision === ack.revision));
      const drafter = clients.find(client => client.auth.playerId === next.draftPlayerId)!;
      const rejected = waitForEvent<{ reason: string }>(drafter.socket, 'action_rejected');
      drafter.socket.emit('citadels:choose-character', { role: drafter.mine!.availableRoles[0], expectedRevision: 0 });
      assert.match((await rejected).reason, /changed/i);
      assert.equal(drafter.game!.revision, ack.revision);
      totalCommands += await playCompleteSocketMatch(clients);
      await waitUntil(() => clients.every((client) => client.game?.status === 'game_over'));
      const completed = structuredClone(clients[0]!.game);
      const result = buildCitadelsResult(serverState(room.roomCode));
      const departing = clients[count - 1]!;
      assert.equal((await post(harness, `/rooms/${room.roomCode}/leave`, {}, departing.auth.token)).status, 200);
      await waitUntil(() => departing.socket.disconnected);
      assert.deepEqual(clients[0]!.game, completed);
      assert.deepEqual(buildCitadelsResult(serverState(room.roomCode)), result);
      assert.equal(serverState(room.roomCode).players.get(departing.auth.playerId)!.forfeited, false);
      for (const client of clients) client.socket.disconnect();
      roomStore.delete(room.roomCode);
    }
    assert.ok(totalCommands > 500);
    console.log(`CITADELS SOCKET MATCHES: 4 full matches + 4 full rematches, ${totalCommands} accepted gameplay commands.`);
  } finally {
    await closeHarness(harness);
  }
});
