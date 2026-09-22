import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import type {
  JoinRoomResponse,
  KingOfTokyoOwnedPowerCard,
  KingOfTokyoPowerCardId,
  KingOfTokyoPublicState,
} from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { supabase } from '../../lib/supabase.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  availableOncePerTurnPowerCardInstanceIds,
  buyPowerCard,
  decideOpportunist,
  forfeitPlayer,
  initKingOfTokyoGame,
  prepareDiceResolution,
  resolveDiceResults,
  rollDice,
  rollForFirstPlayer,
  type EngineResult,
  type KingOfTokyoServerState,
  usePowerCard,
  validateKingOfTokyoState,
} from './engine.js';
import {
  isKingOfTokyoActionPayload,
  isKingOfTokyoBuyCardPayload,
  isKingOfTokyoBuyOwnedCardPayload,
  isKingOfTokyoCardInstancePayload,
  isKingOfTokyoDeathFromAbovePayload,
  isKingOfTokyoDefensePayload,
  isKingOfTokyoEndTurnEffectPayload,
  isKingOfTokyoFreezeTimePayload,
  isKingOfTokyoFirstRollPayload,
  isKingOfTokyoHeartAllocationPayload,
  isKingOfTokyoOpportunistPayload,
  isKingOfTokyoPreferencePayload,
  isKingOfTokyoPsychicProbePayload,
  isKingOfTokyoResolveDiceResultsPayload,
  isKingOfTokyoSetKeptPayload,
  isKingOfTokyoStartPayload,
  isKingOfTokyoUseCardPayload,
  isKingOfTokyoYieldPayload,
  recoverDisconnectedKingOfTokyoPlayers,
  buildKingOfTokyoResult,
} from './socketHandlers.js';
import { toKingOfTokyoPublicState } from './publicState.js';

process.env.JWT_SECRET ??= 'king-of-tokyo-test-only-secret-32-bytes';

interface Harness {
  app: FastifyInstance;
  io: Server;
  url: string;
  clients: ClientSocket[];
  roomCodes: Set<string>;
}

assert.equal(supabase, null, 'King of Tokyo tests refuse hosted persistence; unset Supabase credentials');

test('Astra: simultaneous explicit departures cannot crown an absent player', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state);
    for (const id of state.turnOrder) expirePlayer(room, id, true);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.status, 'game_over');
    assert.equal(state.winnerId, null);
    assert.equal([...state.players.values()].every(player => player.eliminated), true);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

const DIRECT_PLAYERS = [
  { playerId: 'alice', displayName: 'Alice' },
  { playerId: 'bob', displayName: 'Bob' },
  { playerId: 'carol', displayName: 'Carol' },
  { playerId: 'dave', displayName: 'Dave' },
  { playerId: 'erin', displayName: 'Erin' },
];

function expectOk(result: EngineResult): void {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
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
  const response = await harness.app.inject({
    method: 'POST',
    url: '/rooms/create',
    payload: { displayName, gameId: 'king_of_tokyo' },
  });
  assert.equal(response.statusCode, 201, response.body);
  const joined = response.json<JoinRoomResponse>();
  harness.roomCodes.add(joined.roomCode);
  return joined;
}

async function joinRoom(harness: Harness, roomCode: string, displayName: string): Promise<JoinRoomResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/rooms/join',
    payload: { roomCode, displayName },
  });
  assert.equal(response.statusCode, 200);
  return response.json<JoinRoomResponse>();
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

function serverState(roomCode: string): KingOfTokyoServerState {
  const game = roomStore.get(roomCode)?.game;
  assert.equal(game?.id, 'king_of_tokyo');
  return game.state;
}

function createDirectRoom(count = 3): { room: ServerRoom; state: KingOfTokyoServerState; io: Server } {
  const players = DIRECT_PLAYERS.slice(0, count);
  const room = roomStore.create(players[0].playerId, null, 'king_of_tokyo', {});
  for (const player of players) {
    roomStore.addPlayer(room, { ...player, isHost: player.playerId === players[0].playerId }, Date.now() + 60_000);
    roomStore.markConnected(room, player.playerId, `${player.playerId}-socket`);
  }
  const state = initKingOfTokyoGame(room.roomCode, players, () => 0.25);
  room.status = 'in_game';
  room.game = { id: 'king_of_tokyo', state };
  const io = { to: () => ({ emit: () => undefined }) } as unknown as Server;
  return { room, state, io };
}

function chooseFirstPlayer(state: KingOfTokyoServerState, winnerId = state.turnOrder[0]): void {
  for (const playerId of state.turnOrder) {
    const rng = playerId === winnerId ? () => 0.75 : () => 0;
    expectOk(rollForFirstPlayer(state, playerId, rng, state.revision, state.rollOffRound));
  }
  assert.equal(state.phase, 'awaiting_roll');
  assert.equal(state.turnOrder[state.currentTurnIndex], winnerId);
}

function expirePlayer(room: ServerRoom, playerId: string, hasLeft = false): void {
  const player = roomStore.markDisconnected(room, playerId, null, Date.now() - 1);
  assert.ok(player);
  player.hasLeft = hasLeft;
}

function giveKeepCard(
  state: KingOfTokyoServerState,
  playerId: string,
  cardId: KingOfTokyoPowerCardId,
): KingOfTokyoOwnedPowerCard {
  let card: KingOfTokyoServerState['market'][number] = null;
  const marketIndex = state.market.findIndex((candidate) => candidate?.cardId === cardId);
  if (marketIndex >= 0) {
    card = state.market[marketIndex];
    state.market[marketIndex] = null;
  } else {
    const deckIndex = state.deck.findIndex((candidate) => candidate.cardId === cardId);
    if (deckIndex >= 0) [card] = state.deck.splice(deckIndex, 1);
    else {
      const discardIndex = state.discardPile.findIndex((candidate) => candidate.cardId === cardId);
      if (discardIndex >= 0) [card] = state.discardPile.splice(discardIndex, 1);
    }
  }
  assert.ok(card, `missing ${cardId} fixture card`);
  const owned = { ...card, counters: 0, mimicTargetInstanceId: null };
  state.players.get(playerId)!.powerCards.push(owned);
  return owned;
}

test('King of Tokyo projects viewer-only Herd Culler and Mimic once-per-turn availability', () => {
  const herdFixture = createDirectRoom();
  try {
    chooseFirstPlayer(herdFixture.state, 'alice');
    const herdCuller = giveKeepCard(herdFixture.state, 'alice', 'herd_culler');
    expectOk(rollDice(herdFixture.state, 'alice', () => 0.25, herdFixture.state.revision));

    assert.deepEqual(
      availableOncePerTurnPowerCardInstanceIds(herdFixture.state, 'alice'),
      [herdCuller.instanceId],
    );
    assert.deepEqual(
      toKingOfTokyoPublicState(herdFixture.state, 'alice').viewerAvailableOncePerTurnCardInstanceIds,
      [herdCuller.instanceId],
    );
    assert.deepEqual(
      toKingOfTokyoPublicState(herdFixture.state, 'bob').viewerAvailableOncePerTurnCardInstanceIds,
      [],
    );

    expectOk(usePowerCard(
      herdFixture.state,
      'alice',
      herdCuller.instanceId,
      { dieIndex: 0 },
      herdFixture.state.revision,
    ));
    assert.deepEqual(availableOncePerTurnPowerCardInstanceIds(herdFixture.state, 'alice'), []);
    assert.deepEqual(
      toKingOfTokyoPublicState(herdFixture.state, 'alice').viewerAvailableOncePerTurnCardInstanceIds,
      [],
    );

    const repeatedHerdCuller = usePowerCard(
      herdFixture.state,
      'alice',
      herdCuller.instanceId,
      { dieIndex: 1 },
      herdFixture.state.revision,
    );
    assert.equal(repeatedHerdCuller.ok, false);
    if (!repeatedHerdCuller.ok) assert.match(repeatedHerdCuller.reason, /already used this turn/i);
  } finally {
    roomStore.delete(herdFixture.room.roomCode);
  }

  const mimicFixture = createDirectRoom();
  try {
    chooseFirstPlayer(mimicFixture.state, 'alice');
    const mimic = giveKeepCard(mimicFixture.state, 'alice', 'mimic');
    const firstTarget = giveKeepCard(mimicFixture.state, 'bob', 'acid_attack');
    const herdTarget = giveKeepCard(mimicFixture.state, 'carol', 'herd_culler');
    mimic.mimicTargetInstanceId = firstTarget.instanceId;
    mimicFixture.state.players.get('alice')!.energy = 2;

    assert.deepEqual(
      availableOncePerTurnPowerCardInstanceIds(mimicFixture.state, 'alice'),
      [mimic.instanceId],
    );
    assert.deepEqual(
      toKingOfTokyoPublicState(mimicFixture.state, 'alice').viewerAvailableOncePerTurnCardInstanceIds,
      [mimic.instanceId],
    );
    assert.deepEqual(
      toKingOfTokyoPublicState(mimicFixture.state, 'bob').viewerAvailableOncePerTurnCardInstanceIds,
      [],
    );

    expectOk(usePowerCard(
      mimicFixture.state,
      'alice',
      mimic.instanceId,
      { targetCardInstanceId: herdTarget.instanceId },
      mimicFixture.state.revision,
    ));
    assert.deepEqual(availableOncePerTurnPowerCardInstanceIds(mimicFixture.state, 'alice'), []);
    assert.deepEqual(
      toKingOfTokyoPublicState(mimicFixture.state, 'alice').viewerAvailableOncePerTurnCardInstanceIds,
      [],
    );

    const repeatedMimic = usePowerCard(
      mimicFixture.state,
      'alice',
      mimic.instanceId,
      { targetCardInstanceId: firstTarget.instanceId },
      mimicFixture.state.revision,
    );
    assert.equal(repeatedMimic.ok, false);
    if (!repeatedMimic.ok) assert.match(repeatedMimic.reason, /retargeted once/i);

    expectOk(rollDice(mimicFixture.state, 'alice', () => 0.25, mimicFixture.state.revision));
    assert.deepEqual(
      availableOncePerTurnPowerCardInstanceIds(mimicFixture.state, 'alice'),
      [mimic.instanceId],
      'retargeting Mimic must not consume the copied Herd Culler activation',
    );
    expectOk(usePowerCard(
      mimicFixture.state,
      'alice',
      mimic.instanceId,
      { dieIndex: 0 },
      mimicFixture.state.revision,
    ));
    assert.deepEqual(availableOncePerTurnPowerCardInstanceIds(mimicFixture.state, 'alice'), []);
  } finally {
    roomStore.delete(mimicFixture.room.roomCode);
  }
});

test('King of Tokyo projects the current Psychic Probe card identity for consecutive decisions', () => {
  const state = initKingOfTokyoGame('PSYCHIC-IDENTITY', DIRECT_PLAYERS.slice(0, 3), () => 0);
  state.phase = 'awaiting_psychic_probe';
  state.pendingPsychicProbes = [
    { playerId: 'bob', cardInstanceId: 'psychic_probe:first' },
    { playerId: 'bob', cardInstanceId: 'psychic_probe:second' },
  ];

  assert.equal(toKingOfTokyoPublicState(state, 'bob').pendingPsychicProbeCardInstanceId, 'psychic_probe:first');
  state.pendingPsychicProbes.shift();
  assert.equal(toKingOfTokyoPublicState(state, 'bob').pendingPsychicProbeCardInstanceId, 'psychic_probe:second');
});

test('King of Tokyo socket payload validators accept only exact revisioned shapes', () => {
  assert.equal(isKingOfTokyoStartPayload(undefined), true);
  assert.equal(isKingOfTokyoStartPayload({}), true);
  assert.equal(isKingOfTokyoStartPayload(null), false);
  assert.equal(isKingOfTokyoStartPayload([]), false);
  assert.equal(isKingOfTokyoStartPayload({ expectedRevision: 0 }), false);

  assert.equal(isKingOfTokyoActionPayload({ expectedRevision: 0 }), true);
  assert.equal(isKingOfTokyoActionPayload({}), false);
  assert.equal(isKingOfTokyoActionPayload({ expectedRevision: -1 }), false);
  assert.equal(isKingOfTokyoActionPayload({ expectedRevision: 0.5 }), false);
  assert.equal(isKingOfTokyoActionPayload({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(isKingOfTokyoActionPayload({ expectedRevision: 0, extra: true }), false);
  assert.equal(isKingOfTokyoFirstRollPayload({ expectedRevision: 0, rollOffRound: 1 }), true);
  assert.equal(isKingOfTokyoFirstRollPayload({ expectedRevision: 0 }), false);
  assert.equal(isKingOfTokyoFirstRollPayload({ expectedRevision: 0, rollOffRound: 0 }), false);
  assert.equal(isKingOfTokyoFirstRollPayload({ expectedRevision: 0, rollOffRound: 1, extra: true }), false);

  assert.equal(isKingOfTokyoSetKeptPayload({ keptIndexes: [], expectedRevision: 1 }), true);
  assert.equal(isKingOfTokyoSetKeptPayload({ keptIndexes: [0, 5], expectedRevision: 1 }), true);
  assert.equal(isKingOfTokyoSetKeptPayload({ keptIndexes: [0, 0], expectedRevision: 1 }), false);
  assert.equal(isKingOfTokyoSetKeptPayload({ keptIndexes: [-1], expectedRevision: 1 }), false);
  assert.equal(isKingOfTokyoSetKeptPayload({ keptIndexes: [0] }), false);

  assert.equal(isKingOfTokyoPsychicProbePayload({ dieIndex: null, expectedRevision: 2 }), true);
  assert.equal(isKingOfTokyoPsychicProbePayload({ dieIndex: 4, expectedRevision: 2 }), true);
  assert.equal(isKingOfTokyoPsychicProbePayload({ dieIndex: '4', expectedRevision: 2 }), false);
  const resolutionPlan = {
    resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    expectedRevision: 2,
  };
  assert.equal(isKingOfTokyoResolveDiceResultsPayload(resolutionPlan), true);
  assert.equal(isKingOfTokyoResolveDiceResultsPayload({ ...resolutionPlan, resolutionOrder: ['points', 'points', 'hearts', 'smash'] }), false);
  assert.equal(isKingOfTokyoResolveDiceResultsPayload({ ...resolutionPlan, healingRayUses: [] }), false);
  const heartAllocation = {
    healingRayUses: [{ dieIndex: 0, targetPlayerId: 'bob' }],
    poisonTokensToRemove: 0,
    shrinkTokensToRemove: 0,
    expectedRevision: 2,
  };
  assert.equal(isKingOfTokyoHeartAllocationPayload(heartAllocation), true);
  assert.equal(isKingOfTokyoHeartAllocationPayload({ ...heartAllocation, healingRayUses: [{ dieIndex: 0, targetPlayerId: 'bob', extra: true }] }), false);
  assert.equal(isKingOfTokyoHeartAllocationPayload({ ...heartAllocation, healingRayUses: [{ dieIndex: 0, targetPlayerId: 'bob' }, { dieIndex: 0, targetPlayerId: 'carol' }] }), false);
  assert.equal(isKingOfTokyoHeartAllocationPayload({ ...heartAllocation, poisonTokensToRemove: -1 }), false);
  assert.equal(isKingOfTokyoYieldPayload({ yieldTokyo: true, expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoYieldPayload({ yieldTokyo: 1, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoFreezeTimePayload({ accept: true, expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoFreezeTimePayload({ accept: 'yes', expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoFreezeTimePayload({ accept: false, expectedRevision: 3, extra: true }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'camouflage', changes: [], expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoDefensePayload({
    kind: 'camouflage', changes: [{ dieIndex: 0, face: 'heart' }], expectedRevision: 3,
  }), true);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'wings', use: true, expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'rapid_healing', activations: 2, expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'camouflage', changes: [] }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'camouflage', changes: [], expectedRevision: 3, extra: true }), false);
  assert.equal(isKingOfTokyoDefensePayload({
    kind: 'camouflage',
    changes: [{ dieIndex: 0, face: 'heart' }, { dieIndex: 0, face: 'smash' }],
    expectedRevision: 3,
  }), false);
  assert.equal(isKingOfTokyoDefensePayload({
    kind: 'camouflage', changes: [{ dieIndex: -1, face: 'heart' }], expectedRevision: 3,
  }), false);
  assert.equal(isKingOfTokyoDefensePayload({
    kind: 'camouflage', changes: [{ dieIndex: 0, face: 'invalid' }], expectedRevision: 3,
  }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'wings', use: 1, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'wings', use: false, activations: 0, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'rapid_healing', activations: -1, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'rapid_healing', activations: 1.5, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDefensePayload({ kind: 'rapid_healing', activations: 128, expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDeathFromAbovePayload({ targetPlayerId: 'bob', expectedRevision: 3 }), true);
  assert.equal(isKingOfTokyoDeathFromAbovePayload({ targetPlayerId: '', expectedRevision: 3 }), false);
  assert.equal(isKingOfTokyoDeathFromAbovePayload({ targetPlayerId: 'bob', expectedRevision: 3, extra: true }), false);
  assert.equal(isKingOfTokyoBuyCardPayload({ marketIndex: 2, expectedRevision: 4 }), true);
  assert.equal(isKingOfTokyoBuyCardPayload({ marketIndex: 3, expectedRevision: 4 }), false);
  assert.equal(isKingOfTokyoOpportunistPayload({ buy: false, expectedRevision: 5 }), true);
  assert.equal(isKingOfTokyoOpportunistPayload({ buy: 'no', expectedRevision: 5 }), false);

  assert.equal(isKingOfTokyoCardInstancePayload({ cardInstanceId: 'kot-card:1', expectedRevision: 6 }), true);
  assert.equal(isKingOfTokyoCardInstancePayload({ cardInstanceId: '', expectedRevision: 6 }), false);
  assert.equal(isKingOfTokyoBuyOwnedCardPayload({ ownerPlayerId: 'bob', cardInstanceId: 'kot-card:1', expectedRevision: 7 }), true);
  assert.equal(isKingOfTokyoBuyOwnedCardPayload({ ownerPlayerId: 'bob', cardInstanceId: 'kot-card:1', expectedRevision: 7, extra: true }), false);
  assert.equal(isKingOfTokyoPreferencePayload({ defenseMode: 'always', expectedRevision: 8 }), true);
  assert.equal(isKingOfTokyoPreferencePayload({ rapidHealingMode: 'lethal', expectedRevision: 8 }), true);
  assert.equal(isKingOfTokyoPreferencePayload({ tokenPreference: 'shrink', expectedRevision: 8 }), true);
  assert.equal(isKingOfTokyoPreferencePayload({ expectedRevision: 8 }), false);
  assert.equal(isKingOfTokyoPreferencePayload({ defenseMode: 'sometimes', expectedRevision: 8 }), false);

  assert.equal(isKingOfTokyoUseCardPayload({ cardInstanceId: 'kot-card:1', expectedRevision: 9 }), true);
  assert.equal(isKingOfTokyoUseCardPayload({ cardInstanceId: 'kot-card:1', face: 'smash', dieIndex: 2, expectedRevision: 9 }), true);
  assert.equal(isKingOfTokyoUseCardPayload({ cardInstanceId: 'kot-card:1', face: 4, expectedRevision: 9 }), false);
  assert.equal(isKingOfTokyoUseCardPayload({ cardInstanceId: 'kot-card:1', targetPlayerId: '', expectedRevision: 9 }), false);
  assert.equal(isKingOfTokyoEndTurnEffectPayload({ effectId: 'poison', expectedRevision: 10 }), true);
  assert.equal(isKingOfTokyoEndTurnEffectPayload({ effectId: 'metamorph', expectedRevision: 10 }), true);
  assert.equal(isKingOfTokyoEndTurnEffectPayload({ effectId: 'unknown', expectedRevision: 10 }), false);
});

test('King of Tokyo start is exact, host-only, connected-only and cannot reset an active game', async () => {
  const harness = await createHarness();
  let ghostSocket: ClientSocket | null = null;
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const ghost = await joinRoom(harness, alice.roomCode, 'Ghost');

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', { extra: true });
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(roomStore.get(alice.roomCode)?.players.has(ghost.playerId), true);

    rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('start_game', {});
    assert.match((await rejected).reason, /Only the host/);
    assert.equal(roomStore.get(alice.roomCode)?.status, 'lobby');

    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', {});
    assert.match((await rejected).reason, /connecting or reconnecting/i);
    assert.equal(roomStore.get(alice.roomCode)?.status, 'lobby');
    assert.equal(roomStore.get(alice.roomCode)?.players.has(ghost.playerId), true);

    ghostSocket = await connect(harness, ghost.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    assert.equal((await started).phase, 'determining_first_player');
    assert.deepEqual(
      serverState(alice.roomCode).turnOrder.sort(),
      [alice.playerId, bob.playerId, ghost.playerId].sort(),
    );

    const original = roomStore.get(alice.roomCode)?.game;
    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', {});
    assert.match((await rejected).reason, /already in progress/i);
    assert.equal(roomStore.get(alice.roomCode)?.game, original);
  } finally {
    ghostSocket?.disconnect();
    await closeHarness(harness);
  }
});

test('King of Tokyo rejects a start with fewer than two connected players', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    await joinRoom(harness, alice.roomCode, 'Reserved Bob');
    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', {});
    assert.match((await rejected).reason, /connecting or reconnecting/i);
    assert.equal(roomStore.get(alice.roomCode)?.status, 'lobby');
    assert.equal(roomStore.get(alice.roomCode)?.players.size, 2);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo roll-off accepts one submission per player and round from a shared revision', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    const initial = await started;

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:roll_for_first', {});
    assert.equal((await rejected).reason, 'Invalid payload');
    assert.equal(serverState(alice.roomCode).revision, initial.revision);

    let bobAcceptedAliceAction = false;
    const recordUnexpectedAck = () => { bobAcceptedAliceAction = true; };
    bobSocket.on('king_of_tokyo:action_accepted', recordUnexpectedAck);
    const accepted = waitForEvent<void>(aliceSocket, 'king_of_tokyo:action_accepted');
    const update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('king_of_tokyo:roll_for_first', {
      expectedRevision: initial.revision,
      rollOffRound: initial.rollOffRound,
    });
    const [, aliceUpdate] = await Promise.all([accepted, update]);
    assert.equal(aliceUpdate.revision, initial.revision + 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    bobSocket.off('king_of_tokyo:action_accepted', recordUnexpectedAck);
    assert.equal(bobAcceptedAliceAction, false, 'Action acceptance leaked to another player');

    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:roll_for_first', {
      expectedRevision: initial.revision,
      rollOffRound: initial.rollOffRound,
    });
    assert.match((await rejected).reason, /already rolled/i);
    assert.equal(serverState(alice.roomCode).revision, initial.revision + 1);

    const bobAccepted = waitForEvent<void>(bobSocket, 'king_of_tokyo:action_accepted');
    const bobUpdate = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    bobSocket.emit('king_of_tokyo:roll_for_first', {
      expectedRevision: initial.revision,
      rollOffRound: initial.rollOffRound,
    });
    const [, finalUpdate] = await Promise.all([bobAccepted, bobUpdate]);
    assert.equal(finalUpdate.revision, initial.revision + 2);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo actions forfeit overdue seats before revision validation', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    const started = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    const initial = await started;

    const room = roomStore.get(alice.roomCode)!;
    const aliceSocketId = aliceSocket.id;
    assert.ok(aliceSocketId);
    const overdue = roomStore.markDisconnected(room, alice.playerId, aliceSocketId, Date.now() - 1);
    assert.ok(overdue);
    const bobUpdate = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    const rejectedAfterRecovery = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('king_of_tokyo:roll_for_first', {
      expectedRevision: initial.revision,
      rollOffRound: initial.rollOffRound,
    });
    await bobUpdate;
    assert.match((await rejectedAfterRecovery).reason, /stale/i);

    const state = serverState(alice.roomCode);
    assert.equal(state.startRolls.get(alice.playerId), null);
    assert.equal(state.startRolls.get(bob.playerId), null);
    assert.equal(state.players.get(alice.playerId)?.eliminated, true);
    assert.equal(state.players.get(alice.playerId)?.forfeited, true);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo strips transport fields from preference and Power-card engine options', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const state = serverState(alice.roomCode);
    let revision = state.revision;
    let update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    let preferenceAck = waitForEvent<void>(aliceSocket, 'king_of_tokyo:preferences_updated');
    aliceSocket.emit('king_of_tokyo:preferences', {
      defenseMode: 'always',
      expectedRevision: revision,
    });
    assert.equal((await update).revision, revision + 1);
    await preferenceAck;
    assert.equal(state.players.get(alice.playerId)?.defenseMode, 'always');
    revision = state.revision;

    update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    preferenceAck = waitForEvent<void>(aliceSocket, 'king_of_tokyo:preferences_updated');
    aliceSocket.emit('king_of_tokyo:preferences', { defenseMode: 'always', expectedRevision: revision });
    assert.equal((await update).revision, revision);
    await preferenceAck;

    for (const defenseMode of ['always', 'off', 'lethal', 'always'] as const) {
      update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
      const bobAck = waitForEvent<void>(bobSocket, 'king_of_tokyo:preferences_updated');
      bobSocket.emit('king_of_tokyo:preferences', { defenseMode, expectedRevision: revision });
      assert.equal((await update).revision, revision + 1);
      await bobAck;
      revision = state.revision;
    }
    assert.equal(state.players.get(alice.playerId)?.defenseMode, 'always', 'other-seat preferences remain private and unchanged');

    const alicePlayer = state.players.get(alice.playerId)!;
    alicePlayer.health = 9;
    alicePlayer.energy = 2;
    let rapidHealing = state.deck.find((card) => card.cardId === 'rapid_healing');
    if (rapidHealing) {
      state.deck.splice(state.deck.indexOf(rapidHealing), 1);
    } else {
      const marketIndex = state.market.findIndex((card) => card?.cardId === 'rapid_healing');
      assert.notEqual(marketIndex, -1);
      rapidHealing = state.market[marketIndex]!;
      state.market[marketIndex] = state.deck.pop()!;
    }
    alicePlayer.powerCards.push({
      ...rapidHealing,
      counters: 0,
      mimicTargetInstanceId: null,
    });
    revision = state.revision;
    update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('king_of_tokyo:use_card', {
      cardInstanceId: rapidHealing.instanceId,
      expectedRevision: revision,
    });
    assert.equal((await update).revision, revision + 1);
    assert.equal(alicePlayer.health, 10);
    assert.equal(alicePlayer.energy, 0);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo socket broadcasts viewer-only once-per-turn card availability', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const state = serverState(alice.roomCode);
    chooseFirstPlayer(state, alice.playerId);
    const herdCuller = giveKeepCard(state, alice.playerId, 'herd_culler');
    expectOk(rollDice(state, alice.playerId, () => 0.25, state.revision));

    const aliceProjection = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    const bobProjection = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    aliceSocket.emit('request_state');
    bobSocket.emit('request_state');
    const [aliceBefore, bobBefore] = await Promise.all([aliceProjection, bobProjection]);
    assert.deepEqual(aliceBefore.viewerAvailableOncePerTurnCardInstanceIds, [herdCuller.instanceId]);
    assert.deepEqual(bobBefore.viewerAvailableOncePerTurnCardInstanceIds, []);

    const aliceUpdate = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    const bobUpdate = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    aliceSocket.emit('king_of_tokyo:use_card', {
      cardInstanceId: herdCuller.instanceId,
      dieIndex: 0,
      expectedRevision: state.revision,
    });
    const [aliceAfter, bobAfter] = await Promise.all([aliceUpdate, bobUpdate]);
    assert.deepEqual(aliceAfter.viewerAvailableOncePerTurnCardInstanceIds, []);
    assert.deepEqual(bobAfter.viewerAvailableOncePerTurnCardInstanceIds, []);
    assert.equal(state.usedThisTurn.has(herdCuller.instanceId), true);

    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:use_card', {
      cardInstanceId: herdCuller.instanceId,
      dieIndex: 1,
      expectedRevision: state.revision,
    });
    assert.match((await rejected).reason, /already used this turn/i);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo ignores cross-game events and replaced sockets cannot mutate', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const oldAliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(oldAliceSocket, 'game_state');
    oldAliceSocket.emit('start_game', {});
    await started;
    const beforeCrossGame = serverState(alice.roomCode).revision;
    oldAliceSocket.emit('coup:action', { action: 'income', expectedRevision: beforeCrossGame });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(serverState(alice.roomCode).revision, beforeCrossGame);

    const replaced = waitForEvent(oldAliceSocket, 'session_replaced');
    const currentAliceSocket = await connect(harness, alice.token);
    await replaced;
    await waitUntil(() => !oldAliceSocket.connected);
    assert.equal(roomStore.get(alice.roomCode)?.players.get(alice.playerId)?.socketId, currentAliceSocket.id);
    assert.equal(roomStore.get(alice.roomCode)?.players.get(alice.playerId)?.presenceTimer, null);

    oldAliceSocket.emit('king_of_tokyo:roll_for_first', { expectedRevision: beforeCrossGame, rollOffRound: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(serverState(alice.roomCode).revision, beforeCrossGame);

    const update = waitForEvent<KingOfTokyoPublicState>(currentAliceSocket, 'game_state');
    currentAliceSocket.emit('king_of_tokyo:roll_for_first', { expectedRevision: beforeCrossGame, rollOffRound: 1 });
    assert.equal((await update).revision, beforeCrossGame + 1);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo request_state keeps Lab offer and end-effect ordering private', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const state = serverState(alice.roomCode);
    state.currentTurnIndex = state.turnOrder.indexOf(alice.playerId);
    Object.assign(state.players.get(alice.playerId)!, {
      defenseMode: 'always', rapidHealingMode: 'off', tokenPreference: 'shrink',
    });
    Object.assign(state.players.get(bob.playerId)!, {
      defenseMode: 'off', rapidHealingMode: 'always', tokenPreference: 'poison',
    });
    state.phase = 'buying_cards';
    state.labOffersRemaining = 1;
    state.pendingEndTurnEffects = [];

    let aliceState = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('request_state');
    let aliceView = await aliceState;
    let bobState = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    bobSocket.emit('request_state');
    let bobView = await bobState;

    assert.deepEqual(aliceView.labCard, state.deck[0]);
    assert.equal(bobView.labCard, null);
    assert.deepEqual(aliceView.viewerPreferences, {
      defenseMode: 'always', rapidHealingMode: 'off', tokenPreference: 'shrink',
    });
    assert.deepEqual(bobView.viewerPreferences, {
      defenseMode: 'off', rapidHealingMode: 'always', tokenPreference: 'poison',
    });
    for (const view of [aliceView, bobView]) {
      assert.equal(view.players.some((player) => 'defenseMode' in player), false);
      assert.equal(view.players.some((player) => 'rapidHealingMode' in player), false);
      assert.equal(view.players.some((player) => 'tokenPreference' in player), false);
      assert.equal('deck' in view, false);
    }

    state.phase = 'resolving_end_turn';
    state.labOffersRemaining = 0;
    state.pendingEndTurnEffects = [
      { effectId: 'poison', kind: 'poison', copies: 1 },
      { effectId: 'solar_powered', kind: 'solar_powered', copies: 1 },
    ];

    aliceState = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('request_state');
    aliceView = await aliceState;
    bobState = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    bobSocket.emit('request_state');
    bobView = await bobState;

    assert.deepEqual(aliceView.pendingEndTurnEffects, state.pendingEndTurnEffects);
    assert.deepEqual(bobView.pendingEndTurnEffects, []);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo rematch clears old timer and previous connected winner starts without roll-off', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const room = roomStore.get(alice.roomCode)!;
    const oldState = serverState(alice.roomCode);
    oldState.status = 'game_over';
    oldState.phase = 'game_over';
    oldState.winnerId = bob.playerId;
    oldState.victoryType = 'victory_points';
    room.status = 'finished';
    room.timer = setTimeout(() => undefined, 60_000);
    room.timer.unref();

    const rematchAccepted = waitForEvent<void>(aliceSocket, 'king_of_tokyo:action_accepted');
    const rematched = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    const [, next] = await Promise.all([rematchAccepted, rematched]);
    assert.equal(room.timer, null);
    assert.notEqual(room.game?.state, oldState);
    assert.equal(next.phase, 'awaiting_roll');
    assert.equal(next.currentPlayerId, bob.playerId);
    assert.equal(next.turnOrder[0], bob.playerId);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo 20-point winner must survive and a lethal victory card cannot win', async () => {
  const harness = await createHarness();
  try {
    const winnerRoom = await createRoom(harness, 'Winner Alice');
    const winnerSocket = await connect(harness, winnerRoom.token);
    const winnerBob = await joinRoom(harness, winnerRoom.roomCode, 'Winner Bob');
    await connect(harness, winnerBob.token);
    const winnerCarol = await joinRoom(harness, winnerRoom.roomCode, 'Winner Carol');
    await connect(harness, winnerCarol.token);
    winnerSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(winnerRoom.roomCode)?.status === 'in_game');
    const winningState = serverState(winnerRoom.roomCode);
    winningState.currentTurnIndex = winningState.turnOrder.indexOf(winnerRoom.playerId);
    winningState.phase = 'buying_cards';
    Object.assign(winningState.players.get(winnerRoom.playerId)!, {
      health: 2, victoryPoints: 20, poisonTokens: 1,
    });
    const winningRevision = winningState.revision;
    winnerSocket.emit('king_of_tokyo:end_turn', { expectedRevision: winningRevision });
    await waitUntil(() => winningState.revision === winningRevision + 1);
    assert.equal(winningState.status, 'game_over');
    assert.equal(winningState.winnerId, winnerRoom.playerId);
    assert.equal(winningState.players.get(winnerRoom.playerId)?.health, 1);
    assert.equal(roomStore.get(winnerRoom.roomCode)?.status, 'finished');

    const loserRoom = await createRoom(harness, 'Loser Alice');
    const loserSocket = await connect(harness, loserRoom.token);
    const loserBob = await joinRoom(harness, loserRoom.roomCode, 'Loser Bob');
    await connect(harness, loserBob.token);
    const loserCarol = await joinRoom(harness, loserRoom.roomCode, 'Loser Carol');
    await connect(harness, loserCarol.token);
    loserSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(loserRoom.roomCode)?.status === 'in_game');
    const losingState = serverState(loserRoom.roomCode);
    losingState.currentTurnIndex = losingState.turnOrder.indexOf(loserRoom.playerId);
    losingState.phase = 'buying_cards';
    Object.assign(losingState.players.get(loserRoom.playerId)!, {
      health: 2, victoryPoints: 18, energy: 20,
    });
    let nationalGuardIndex = losingState.market.findIndex((card) => card?.cardId === 'national_guard');
    if (nationalGuardIndex < 0) {
      const deckIndex = losingState.deck.findIndex((card) => card.cardId === 'national_guard');
      assert.notEqual(deckIndex, -1);
      [losingState.market[0], losingState.deck[deckIndex]] = [
        losingState.deck[deckIndex],
        losingState.market[0]!,
      ];
      nationalGuardIndex = 0;
    }
    const losingRevision = losingState.revision;
    loserSocket.emit('king_of_tokyo:buy_card', {
      marketIndex: nationalGuardIndex,
      expectedRevision: losingRevision,
    });
    await waitUntil(() => losingState.revision === losingRevision + 1);
    assert.equal(losingState.players.get(loserRoom.playerId)?.victoryPoints, 20);
    assert.equal(losingState.players.get(loserRoom.playerId)?.health, 0);
    assert.equal(losingState.players.get(loserRoom.playerId)?.eliminated, true);
    assert.notEqual(losingState.winnerId, loserRoom.playerId);
    assert.equal(losingState.status, 'playing');
    assert.equal(roomStore.get(loserRoom.roomCode)?.status, 'in_game');
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo simultaneous elimination finishes with no winner and rematches via roll-off', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    aliceSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(alice.roomCode)?.status === 'in_game');
    const state = serverState(alice.roomCode);
    state.currentTurnIndex = state.turnOrder.indexOf(alice.playerId);
    state.phase = 'buying_cards';
    for (const player of state.players.values()) player.health = 3;
    state.players.get(alice.playerId)!.energy = 20;
    const deckIndex = state.deck.findIndex((card) => card.cardId === 'high_altitude_bombing');
    const marketIndex = state.market.findIndex((card) => card?.cardId === 'high_altitude_bombing');
    if (deckIndex >= 0) {
      [state.market[0], state.deck[deckIndex]] = [state.deck[deckIndex], state.market[0]!];
    } else if (marketIndex > 0) {
      [state.market[0], state.market[marketIndex]] = [state.market[marketIndex], state.market[0]];
    }
    assert.equal(state.market[0]?.cardId, 'high_altitude_bombing');

    const revision = state.revision;
    aliceSocket.emit('king_of_tokyo:buy_card', { marketIndex: 0, expectedRevision: revision });
    await waitUntil(() => state.revision === revision + 1);
    assert.equal(state.status, 'game_over');
    assert.equal(state.winnerId, null);
    assert.equal(state.victoryType, 'mutual_destruction');
    assert.equal([...state.players.values()].every((player) => player.eliminated), true);
    assert.equal(roomStore.get(alice.roomCode)?.status, 'finished');

    aliceSocket.emit('start_game', {});
    await waitUntil(() => serverState(alice.roomCode) !== state);
    const rematch = serverState(alice.roomCode);
    assert.equal(rematch.phase, 'determining_first_player');
    assert.equal(rematch.winnerId, null);
    assert.equal(rematch.revision, state.revision + 1);
    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:roll_for_first', { expectedRevision: 0, rollOffRound: 1 });
    assert.match((await rejected).reason, /stale/i);
    assert.equal(rematch.startRolls.get(alice.playerId), null);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo socket flow forces no-Smash entry into City then Bay with five players', async () => {
  const harness = await createHarness();
  try {
    const auth = [await createRoom(harness, 'Alice')];
    for (const name of ['Bob', 'Carol', 'Dave', 'Erin']) {
      auth.push(await joinRoom(harness, auth[0].roomCode, name));
    }
    const sockets = await Promise.all(auth.map((joined) => connect(harness, joined.token)));
    const started = waitForEvent<KingOfTokyoPublicState>(sockets[0], 'game_state');
    sockets[0].emit('start_game', {});
    await started;
    const state = serverState(auth[0].roomCode);
    chooseFirstPlayer(state, auth[0].playerId);
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = Array.from({ length: 6 }, () => ({ face: 1 as const, kept: true }));

    let beforeRevision = state.revision;
    sockets[0].emit('king_of_tokyo:resolve_dice', { expectedRevision: state.revision });
    await waitUntil(() => state.revision === beforeRevision + 1);
    assert.equal(state.phase, 'awaiting_dice_resolution');
    beforeRevision = state.revision;
    sockets[0].emit('king_of_tokyo:resolve_dice_results', {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
      expectedRevision: state.revision,
    });
    await waitUntil(() => state.revision === beforeRevision + 1);
    assert.equal(state.players.get(auth[0].playerId)?.tokyoZone, 'tokyo_city');

    state.currentTurnIndex = state.turnOrder.indexOf(auth[1].playerId);
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = Array.from({ length: 6 }, () => ({ face: 'heart' as const, kept: true }));
    state.pendingDiceResolution = null;
    state.pendingPsychicProbes = [];
    state.pendingTokyoDecisions = [];
    state.pendingTokyoDamage.clear();
    state.mustEnterTokyo = false;

    beforeRevision = state.revision;
    sockets[1].emit('king_of_tokyo:resolve_dice', { expectedRevision: state.revision });
    await waitUntil(() => state.revision === beforeRevision + 1);
    assert.equal(state.phase, 'awaiting_dice_resolution');
    beforeRevision = state.revision;
    sockets[1].emit('king_of_tokyo:resolve_dice_results', {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
      expectedRevision: state.revision,
    });
    await waitUntil(() => state.revision === beforeRevision + 1);
    assert.equal(state.players.get(auth[0].playerId)?.tokyoZone, 'tokyo_city');
    assert.equal(state.players.get(auth[1].playerId)?.tokyoZone, 'tokyo_bay');
  } finally {
    await closeHarness(harness);
  }
});

for (const alreadyInside of [false, true]) {
  test(`Astra publisher: Death from Above resolves all Tokyo yields immediately (buyer inside=${alreadyInside})`, async () => {
    const harness = await createHarness();
    try {
      const auth = [await createRoom(harness, 'Alice')];
      for (const name of ['Bob', 'Carol', 'Dave', 'Erin']) auth.push(await joinRoom(harness, auth[0].roomCode, name));
      const sockets = await Promise.all(auth.map(joined => connect(harness, joined.token)));
      const started = waitForEvent<KingOfTokyoPublicState>(sockets[0], 'game_state');
      sockets[0].emit('start_game', {});
      await started;
      const state = serverState(auth[0].roomCode);
      chooseFirstPlayer(state, auth[0].playerId);
      state.phase = 'buying_cards';
      state.players.get(auth[0].playerId)!.energy = 20;
      state.players.get(auth[alreadyInside ? 0 : 1].playerId)!.tokyoZone = 'tokyo_city';
      state.players.get(auth[2].playerId)!.tokyoZone = 'tokyo_bay';
      placeMarketCard(state, 'drop_from_high_altitude');
      const before = state.revision;
      const update = waitForEvent<KingOfTokyoPublicState>(sockets[0], 'game_state');
      const ack = waitForEvent<{ action: string; revision: number }>(sockets[0], 'king_of_tokyo:action_accepted');
      sockets[0].emit('king_of_tokyo:buy_card', { marketIndex: 0, expectedRevision: before });
      const view = await update;
      assert.deepEqual(await ack, { action: 'buy_card', revision: before + 1 });
      assert.equal(view.phase, 'buying_cards');
      assert.equal(view.pendingDeathFromAbovePlayerId, null);
      assert.equal(state.players.get(auth[0].playerId)!.victoryPoints, alreadyInside ? 2 : 3);
      assert.equal(state.players.get(auth[0].playerId)!.tokyoZone, 'tokyo_city');
      assert.equal(state.players.get(auth[1].playerId)!.tokyoZone, null);
      assert.equal(state.players.get(auth[2].playerId)!.tokyoZone, null);
      const rejected = waitForEvent<{ reason: string }>(sockets[0], 'action_rejected');
      sockets[0].emit('king_of_tokyo:choose_death_from_above_target', { targetPlayerId: auth[2].playerId, expectedRevision: view.revision });
      assert.match((await rejected).reason, /No Death from Above choice/i);
      assert.equal(state.revision, view.revision);
    } finally {
      await closeHarness(harness);
    }
  });
}

function placeMarketCard(state: KingOfTokyoServerState, cardId: KingOfTokyoPowerCardId): void {
  const marketIndex = state.market.findIndex(card => card?.cardId === cardId);
  if (marketIndex >= 0) {
    [state.market[0], state.market[marketIndex]] = [state.market[marketIndex], state.market[0]];
    return;
  }
  const deckIndex = state.deck.findIndex(card => card.cardId === cardId);
  assert.notEqual(deckIndex, -1, `Missing canonical ${cardId}`);
  const card = state.deck.splice(deckIndex, 1)[0]!;
  if (state.market[0]) state.deck.push(state.market[0]);
  state.market[0] = card;
}

test('Astra publisher: initial Mimic copies own Keep card once, with owner-only command and reconnect', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Alice');
    const socket = await connect(harness, host.token);
    const guest = await joinRoom(harness, host.roomCode, 'Bob');
    const other = await connect(harness, guest.token);
    const started = waitForEvent<KingOfTokyoPublicState>(socket, 'game_state');
    socket.emit('start_game', {});
    await started;
    const state = serverState(host.roomCode);
    chooseFirstPlayer(state, host.playerId);
    state.phase = 'buying_cards';
    state.players.get(host.playerId)!.energy = 20;
    const target = giveKeepCard(state, host.playerId, 'acid_attack');
    placeMarketCard(state, 'mimic');
    const bought = waitForEvent<KingOfTokyoPublicState>(socket, 'game_state');
    socket.emit('king_of_tokyo:buy_card', { marketIndex: 0, expectedRevision: state.revision });
    const pending = await bought;
    assert.equal(pending.pendingMimicTargetPlayerId, host.playerId);
    assert.ok(pending.pendingMimicTargetCardInstanceId);
    const rejected = waitForEvent<{ reason: string }>(other, 'action_rejected');
    other.emit('king_of_tokyo:use_card', {
      cardInstanceId: pending.pendingMimicTargetCardInstanceId,
      targetCardInstanceId: target.instanceId, expectedRevision: pending.revision,
    });
    await rejected;
    const recovered = await connect(harness, host.token);
    const fresh = waitForEvent<KingOfTokyoPublicState>(recovered, 'game_state');
    recovered.emit('request_state');
    assert.equal((await fresh).pendingMimicTargetCardInstanceId, pending.pendingMimicTargetCardInstanceId);
    const ack = waitForEvent<{ action: string; revision: number }>(recovered, 'king_of_tokyo:action_accepted');
    recovered.emit('king_of_tokyo:use_card', {
      cardInstanceId: pending.pendingMimicTargetCardInstanceId,
      targetCardInstanceId: target.instanceId, expectedRevision: pending.revision,
    });
    assert.deepEqual(await ack, { action: 'use_card', revision: pending.revision + 1 });
    const mimic = state.players.get(host.playerId)!.powerCards.find(card => card.cardId === 'mimic')!;
    assert.equal(mimic.mimicTargetInstanceId, target.instanceId);
    const duplicate = waitForEvent<{ reason: string }>(recovered, 'action_rejected');
    recovered.emit('king_of_tokyo:use_card', {
      cardInstanceId: mimic.instanceId, targetCardInstanceId: target.instanceId, expectedRevision: pending.revision,
    });
    assert.match((await duplicate).reason, /stale/i);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo socket accepts only the Freeze Time owner\'s exact boolean choice', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    aliceSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(alice.roomCode)?.status === 'in_game');
    const state = serverState(alice.roomCode);
    chooseFirstPlayer(state, alice.playerId);
    giveKeepCard(state, alice.playerId, 'freeze_time');
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = [1, 1, 1, 2, 'energy', 'heart'].map((face) => ({
      face: face as 1 | 2 | 'energy' | 'heart', kept: true,
    }));
    expectOk(prepareDiceResolution(state, alice.playerId, state.revision));
    expectOk(resolveDiceResults(state, alice.playerId, {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision));
    assert.equal(state.phase, 'awaiting_freeze_time');

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:freeze_time', {
      accept: false,
      expectedRevision: state.revision,
      extra: true,
    });
    assert.equal((await rejected).reason, 'Invalid payload');

    rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('king_of_tokyo:freeze_time', { accept: true, expectedRevision: state.revision });
    assert.match((await rejected).reason, /No Freeze Time decision/);

    const update = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('king_of_tokyo:freeze_time', { accept: false, expectedRevision: state.revision });
    const publicState = await update;
    assert.equal(state.phase, 'buying_cards');
    assert.equal(state.queuedExtraTurns.length, 0);
    assert.equal(publicState.pendingFreezeTimePlayerId, null);
    assert.equal(publicState.pendingFreezeTimeChoicesRemaining, 0);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo socket projects snapshotted Stretchy through copied source loss', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    const carolSocket = await connect(harness, carol.token);
    aliceSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(alice.roomCode)?.status === 'in_game');

    const state = serverState(alice.roomCode);
    chooseFirstPlayer(state, alice.playerId);
    const stretchySource = giveKeepCard(state, bob.playerId, 'stretchy');
    giveKeepCard(state, carol.playerId, 'camouflage');
    giveKeepCard(state, carol.playerId, 'mimic').mimicTargetInstanceId = stretchySource.instanceId;
    state.players.get(alice.playerId)!.tokyoZone = 'tokyo_city';
    state.players.get(carol.playerId)!.energy = 2;
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = ['smash', 1, 2, 3, 'energy', 'heart'].map((face) => ({
      face: face as 'smash' | 1 | 2 | 3 | 'energy' | 'heart', kept: true,
    }));
    expectOk(prepareDiceResolution(state, alice.playerId, state.revision));
    expectOk(resolveDiceResults(state, alice.playerId, {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision, () => 0));
    assert.equal(state.pendingDefenseDecision?.kind, 'camouflage');
    assert.equal(state.pendingDefenseDecision.playerId, carol.playerId);

    const initialProjectionPromise = waitForEvent<KingOfTokyoPublicState>(carolSocket, 'game_state');
    carolSocket.emit('request_state');
    const initialProjection = await initialProjectionPromise;
    assert.equal(initialProjection.pendingDefenseDecision?.stretchyAvailable, true);
    assert.equal('entitlements' in initialProjection.pendingDefenseDecision!, false);

    expectOk(forfeitPlayer(state, bob.playerId, state.revision, () => 0));
    assert.equal(
      state.players.get(carol.playerId)!.powerCards.find((card) => card.cardId === 'mimic')?.mimicTargetInstanceId,
      null,
    );
    assert.equal(state.pendingDefenseDecision?.kind, 'camouflage');

    const ownerProjectionPromise = waitForEvent<KingOfTokyoPublicState>(carolSocket, 'game_state');
    const observerProjectionPromise = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    carolSocket.emit('request_state');
    aliceSocket.emit('request_state');
    const [ownerProjection, observerProjection] = await Promise.all([
      ownerProjectionPromise,
      observerProjectionPromise,
    ]);
    assert.equal(ownerProjection.pendingDefenseDecision?.stretchyAvailable, true);
    assert.equal(observerProjection.pendingDefenseDecision?.stretchyAvailable, true);
    assert.equal('entitlements' in ownerProjection.pendingDefenseDecision!, false);

    const resolvedPromise = waitForEvent<KingOfTokyoPublicState>(carolSocket, 'game_state');
    carolSocket.emit('king_of_tokyo:defense', {
      kind: 'camouflage',
      changes: [{ dieIndex: 0, face: 'heart' }],
      expectedRevision: state.revision,
    });
    const resolved = await resolvedPromise;
    assert.equal(resolved.pendingDefenseDecision, null);
    assert.equal(state.players.get(carol.playerId)!.health, 10);
    assert.equal(state.players.get(carol.playerId)!.energy, 0);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo defence decision is owner-only, reconnectable and revision-safe', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    aliceSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(alice.roomCode)?.status === 'in_game');
    const state = serverState(alice.roomCode);
    chooseFirstPlayer(state, alice.playerId);
    giveKeepCard(state, bob.playerId, 'wings');
    state.players.get(alice.playerId)!.tokyoZone = 'tokyo_city';
    state.players.get(bob.playerId)!.energy = 2;
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = ['smash', 1, 2, 3, 'energy', 'heart'].map((face) => ({
      face: face as 'smash' | 1 | 2 | 3 | 'energy' | 'heart', kept: true,
    }));
    expectOk(prepareDiceResolution(state, alice.playerId, state.revision));
    expectOk(resolveDiceResults(state, alice.playerId, {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision));
    assert.equal(state.pendingDefenseDecision?.kind, 'wings');
    assert.equal(state.pendingDefenseDecision?.playerId, bob.playerId);
    const decisionRevision = state.revision;

    let rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('king_of_tokyo:defense', {
      kind: 'wings', use: false, expectedRevision: decisionRevision,
    });
    assert.match((await rejected).reason, /No defence decision/);
    assert.equal(state.revision, decisionRevision);

    const originalProjection = waitForEvent<KingOfTokyoPublicState>(bobSocket, 'game_state');
    bobSocket.emit('request_state');
    const projected = await originalProjection;
    assert.deepEqual(projected.pendingDefenseDecision, {
      kind: 'wings',
      playerId: bob.playerId,
      incomingDamage: 1,
      remainingDamage: 1,
      camouflageCopy: null,
      camouflageCopies: null,
      dice: [],
      stretchyAvailable: false,
      maxActivations: 0,
      healingPerActivation: 1,
    });

    bobSocket.disconnect();
    await waitUntil(() => roomStore.get(alice.roomCode)?.players.get(bob.playerId)?.isConnected === false);
    const replacementBobSocket = await connect(harness, bob.token);
    const reconnectedProjection = waitForEvent<KingOfTokyoPublicState>(replacementBobSocket, 'game_state');
    replacementBobSocket.emit('request_state');
    assert.deepEqual((await reconnectedProjection).pendingDefenseDecision, projected.pendingDefenseDecision);

    const update = waitForEvent<KingOfTokyoPublicState>(replacementBobSocket, 'game_state');
    replacementBobSocket.emit('king_of_tokyo:defense', {
      kind: 'wings', use: true, expectedRevision: decisionRevision,
    });
    const resolved = await update;
    assert.equal(state.revision, decisionRevision + 1);
    assert.equal(state.players.get(bob.playerId)!.health, 10);
    assert.equal(state.players.get(bob.playerId)!.energy, 0);
    assert.equal(resolved.pendingDefenseDecision, null);

    rejected = waitForEvent<{ reason: string }>(replacementBobSocket, 'action_rejected');
    replacementBobSocket.emit('king_of_tokyo:defense', {
      kind: 'wings', use: true, expectedRevision: decisionRevision,
    });
    assert.match((await rejected).reason, /stale/i);
    assert.equal(state.revision, decisionRevision + 1);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo Heart allocation is projected, reconnectable, owner-only and race-safe', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    aliceSocket.emit('start_game', {});
    await waitUntil(() => roomStore.get(alice.roomCode)?.status === 'in_game');
    const state = serverState(alice.roomCode);
    chooseFirstPlayer(state, alice.playerId);
    giveKeepCard(state, alice.playerId, 'healing_ray');
    const rapid = giveKeepCard(state, bob.playerId, 'rapid_healing');
    Object.assign(state.players.get(bob.playerId)!, { health: 9, energy: 3 });
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = ['heart', 1, 2, 3, 'energy', 'smash'].map((face) => ({
      face: face as 'heart' | 1 | 2 | 3 | 'energy' | 'smash', kept: true,
    }));
    expectOk(prepareDiceResolution(state, alice.playerId, state.revision));
    expectOk(resolveDiceResults(state, alice.playerId, {
      resolutionOrder: ['hearts', 'points', 'energy', 'smash'],
    }, state.revision));
    assert.equal(state.phase, 'awaiting_heart_allocation');
    const decisionRevision = state.revision;

    const projectionPromise = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('request_state');
    const projection = await projectionPromise;
    assert.deepEqual(projection.pendingHeartAllocation, {
      playerId: alice.playerId,
      heartIndexes: [0],
      healingRayAvailable: true,
      healingRayTargetPlayerIds: [bob.playerId],
    });

    let rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('king_of_tokyo:allocate_hearts', {
      healingRayUses: [], poisonTokensToRemove: 0, shrinkTokensToRemove: 0,
      expectedRevision: decisionRevision,
    });
    assert.match((await rejected).reason, /No Heart allocation/);
    assert.equal(state.revision, decisionRevision);

    aliceSocket.disconnect();
    await waitUntil(() => roomStore.get(alice.roomCode)?.players.get(alice.playerId)?.isConnected === false);
    const reconnectedAlice = await connect(harness, alice.token);
    const reconnectedProjection = waitForEvent<KingOfTokyoPublicState>(reconnectedAlice, 'game_state');
    reconnectedAlice.emit('request_state');
    assert.deepEqual((await reconnectedProjection).pendingHeartAllocation, projection.pendingHeartAllocation);

    const raceUpdate = waitForEvent<KingOfTokyoPublicState>(reconnectedAlice, 'game_state');
    bobSocket.emit('king_of_tokyo:use_card', {
      cardInstanceId: rapid.instanceId,
      expectedRevision: decisionRevision,
    });
    const afterRapid = await raceUpdate;
    assert.equal(afterRapid.revision, decisionRevision + 1);
    assert.equal(state.players.get(bob.playerId)!.health, 10);
    assert.deepEqual(afterRapid.pendingHeartAllocation?.healingRayTargetPlayerIds, []);

    rejected = waitForEvent<{ reason: string }>(reconnectedAlice, 'action_rejected');
    reconnectedAlice.emit('king_of_tokyo:allocate_hearts', {
      healingRayUses: [{ dieIndex: 0, targetPlayerId: bob.playerId }],
      poisonTokensToRemove: 0,
      shrinkTokensToRemove: 0,
      expectedRevision: decisionRevision,
    });
    assert.match((await rejected).reason, /stale/i);
    assert.equal(state.revision, decisionRevision + 1);

    const resolvedUpdate = waitForEvent<KingOfTokyoPublicState>(reconnectedAlice, 'game_state');
    reconnectedAlice.emit('king_of_tokyo:allocate_hearts', {
      healingRayUses: [], poisonTokensToRemove: 0, shrinkTokensToRemove: 0,
      expectedRevision: state.revision,
    });
    const resolved = await resolvedUpdate;
    assert.equal(resolved.pendingHeartAllocation, null);
    assert.equal(state.revision, decisionRevision + 2);

    rejected = waitForEvent<{ reason: string }>(reconnectedAlice, 'action_rejected');
    reconnectedAlice.emit('king_of_tokyo:allocate_hearts', {
      healingRayUses: [], poisonTokensToRemove: 0, shrinkTokensToRemove: 0,
      expectedRevision: decisionRevision + 1,
    });
    assert.match((await rejected).reason, /stale/i);
    assert.equal(state.revision, decisionRevision + 2);
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo recovery respects reconnect grace and forfeits an expired mandatory roller', () => {
  const { room, state, io } = createDirectRoom();
  try {
    expirePlayer(room, 'alice');
    const reconnectDeadline = room.players.get('alice')!.reconnectDeadlineAt!;
    room.players.get('alice')!.reconnectDeadlineAt = Date.now() + 10_000;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
    assert.equal(state.startRolls.get('alice'), null);

    room.players.get('alice')!.reconnectDeadlineAt = reconnectDeadline;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.startRolls.get('alice'), null);
    assert.equal(state.players.get('alice')!.forfeited, true);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo reconnect recovery preserves then forfeits a Heart allocation', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    Object.assign(state.players.get('alice')!, {
      poisonTokens: 1,
      shrinkTokens: 1,
      tokenPreference: 'shrink' as const,
    });
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = ['heart', 'heart', 1, 2, 3, 'energy'].map((face) => ({
      face: face as 'heart' | 1 | 2 | 3 | 'energy', kept: true,
    }));
    expectOk(prepareDiceResolution(state, 'alice', state.revision));
    expectOk(resolveDiceResults(state, 'alice', {
      resolutionOrder: ['hearts', 'points', 'energy', 'smash'],
    }, state.revision));
    assert.equal(state.phase, 'awaiting_heart_allocation');

    const roomPlayer = roomStore.markDisconnected(room, 'alice', 'alice-socket', Date.now() + 10_000);
    assert.ok(roomPlayer);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
    assert.equal(state.phase, 'awaiting_heart_allocation');
    assert.deepEqual([state.players.get('alice')!.poisonTokens, state.players.get('alice')!.shrinkTokens], [1, 1]);

    roomPlayer.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.players.get('alice')!.forfeited, true);
    assert.equal(state.pendingHeartAllocation, null);
    assert.notEqual(state.turnOrder[state.currentTurnIndex], 'alice');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo reconnect recovery waits through grace then forfeits the Freeze Time owner', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    giveKeepCard(state, 'alice', 'freeze_time');
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = [1, 1, 1, 2, 'energy', 'heart'].map((face) => ({
      face: face as 1 | 2 | 'energy' | 'heart', kept: true,
    }));
    expectOk(prepareDiceResolution(state, 'alice', state.revision));
    expectOk(resolveDiceResults(state, 'alice', {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision));
    assert.equal(state.phase, 'awaiting_freeze_time');
    const roomPlayer = roomStore.markDisconnected(room, 'alice', 'alice-socket', Date.now() + 10_000);
    assert.ok(roomPlayer);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
    assert.equal(state.phase, 'awaiting_freeze_time');

    roomPlayer.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.pendingFreezeTimeDecisions.length, 0);
    assert.equal(state.queuedExtraTurns.length, 0);
    assert.notEqual(state.turnOrder[state.currentTurnIndex], 'alice');
    assert.equal(state.phase, 'awaiting_roll');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo reconnect recovery preserves then forfeits an off-turn defence', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    giveKeepCard(state, 'bob', 'wings');
    state.players.get('alice')!.tokyoZone = 'tokyo_city';
    Object.assign(state.players.get('bob')!, { health: 1, energy: 2, defenseMode: 'lethal' as const });
    state.phase = 'choosing_dice';
    state.rollCount = 1;
    state.dice = ['smash', 1, 2, 3, 'energy', 'heart'].map((face) => ({
      face: face as 'smash' | 1 | 2 | 3 | 'energy' | 'heart', kept: true,
    }));
    expectOk(prepareDiceResolution(state, 'alice', state.revision));
    expectOk(resolveDiceResults(state, 'alice', {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision));
    assert.equal(state.pendingDefenseDecision?.playerId, 'bob');

    const roomPlayer = roomStore.markDisconnected(room, 'bob', 'bob-socket', Date.now() + 10_000);
    assert.ok(roomPlayer);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
    assert.equal(state.pendingDefenseDecision?.playerId, 'bob');

    roomPlayer.reconnectDeadlineAt = Date.now() - 1;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.pendingDefenseDecision, null);
    assert.equal(state.players.get('bob')!.health, 0);
    assert.equal(state.players.get('bob')!.forfeited, true);
    assert.equal(state.players.get('bob')!.energy, 0);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo expiry forfeits during roll, reroll, buy and end-effect decisions', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    expirePlayer(room, 'alice');
    const originalRevision = state.revision;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.ok(state.revision > originalRevision);
    assert.notEqual(state.turnOrder[state.currentTurnIndex], 'alice');
    assert.equal(state.phase, 'awaiting_roll');

    const nextId = state.turnOrder[state.currentTurnIndex];
    const nextRoomPlayer = room.players.get(nextId)!;
    roomStore.markDisconnected(room, nextId, nextRoomPlayer.socketId, Date.now() - 1);
    state.phase = 'resolving_end_turn';
    state.pendingEndTurnEffects = [
      { effectId: 'poison', kind: 'poison', copies: 1 },
      { effectId: 'solar_powered', kind: 'solar_powered', copies: 1 },
    ];
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.status, 'game_over');
    assert.notEqual(state.winnerId, nextId);
    assert.equal(state.pendingEndTurnEffects.length, 0);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo expiry forfeits during a zero-dice Shrink turn', () => {
  const { room, state, io } = createDirectRoom();
  try {
    state.players.get('alice')!.shrinkTokens = 6;
    chooseFirstPlayer(state, 'alice');
    assert.equal(state.dice.length, 0);
    expirePlayer(room, 'alice');
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.phase, 'awaiting_roll');
    assert.notEqual(state.turnOrder[state.currentTurnIndex], 'alice');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo expiry forfeits Psychic Probe and Opportunist responders', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    expirePlayer(room, 'bob');
    state.phase = 'awaiting_psychic_probe';
    state.pendingPsychicProbes = [{ playerId: 'bob', cardInstanceId: 'psychic_probe:0' }];
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.pendingPsychicProbes.length, 0);
    assert.equal(state.phase, 'awaiting_dice_resolution');

    const offered = state.market[0];
    assert.ok(offered);
    state.phase = 'awaiting_opportunist';
    state.pendingOpportunist = { cardInstanceId: offered.instanceId, playerIds: ['carol'] };
    expirePlayer(room, 'carol');
    state.opportunistRevealQueue = [];
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.pendingOpportunist, null);
    assert.equal(state.status, 'game_over');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo expiry discards an off-turn Opportunist Mimic without choosing a target', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    const supply = [...state.market.filter((card) => card !== null), ...state.deck];
    state.market = [null, null, null];
    state.deck = [];
    const take = (cardId: string) => {
      const index = supply.findIndex((card) => card.cardId === cardId);
      assert.notEqual(index, -1, `missing ${cardId} fixture card`);
      return supply.splice(index, 1)[0];
    };
    const opportunist = take('opportunist');
    const mimicTarget = take('acid_attack');
    state.players.get('bob')!.powerCards.push({ ...opportunist, counters: 0, mimicTargetInstanceId: null });
    state.players.get('carol')!.powerCards.push({ ...mimicTarget, counters: 0, mimicTargetInstanceId: null });
    state.market = [take('corner_store'), supply.shift()!, supply.shift()!];
    state.deck = [take('mimic'), ...supply];
    Object.assign(state.players.get('alice')!, { energy: 20 });
    Object.assign(state.players.get('bob')!, { energy: 8 });
    state.phase = 'buying_cards';

    expectOk(buyPowerCard(state, 'alice', 0, state.revision, () => 0.25));
    assert.equal(state.phase, 'awaiting_opportunist');
    assert.deepEqual(state.pendingOpportunist?.playerIds, ['bob']);
    expectOk(decideOpportunist(state, 'bob', true, state.revision, () => 0.25));
    assert.equal(state.phase, 'awaiting_opportunist');
    assert.equal(state.pendingOpportunist, null);
    assert.equal(state.players.get('bob')!.energy, 0);
    const boughtMimic = state.players.get('bob')!.powerCards.find((card) => card.cardId === 'mimic');
    assert.ok(boughtMimic);
    assert.equal(state.usedThisTurn.has(`mimic_initial:${boughtMimic.instanceId}`), true);

    expirePlayer(room, 'bob');
    const revisionBeforeRecovery = state.revision;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.revision, revisionBeforeRecovery + 1);
    assert.equal(state.phase, 'buying_cards');
    assert.equal(state.turnOrder[state.currentTurnIndex], 'alice');
    assert.equal(state.players.get('bob')!.forfeited, true);
    assert.equal(boughtMimic.mimicTargetInstanceId, null);
    assert.equal(state.usedThisTurn.has(`mimic_initial:${boughtMimic.instanceId}`), false);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo Death from Above expiry forfeits its owner without taking Tokyo', () => {
  const { room, state, io } = createDirectRoom(5);
  try {
    chooseFirstPlayer(state, 'alice');
    state.players.get('bob')!.tokyoZone = 'tokyo_city';
    state.players.get('carol')!.tokyoZone = 'tokyo_bay';
    state.phase = 'awaiting_death_from_above';
    state.pendingDeathFromAbove = {
      playerId: 'dave',
      targetPlayerIds: ['bob', 'carol'],
    };
    const ownerView = toKingOfTokyoPublicState(state, 'dave');
    const observerView = toKingOfTokyoPublicState(state, 'erin');
    assert.equal(ownerView.pendingDeathFromAbovePlayerId, 'dave');
    assert.deepEqual(ownerView.pendingDeathFromAboveTargetPlayerIds, ['bob', 'carol']);
    assert.equal(observerView.pendingDeathFromAbovePlayerId, 'dave');
    assert.deepEqual(observerView.pendingDeathFromAboveTargetPlayerIds, ['bob', 'carol']);

    expirePlayer(room, 'dave');
    const revision = state.revision;
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.pendingDeathFromAbove, null);
    assert.equal(state.players.get('bob')!.tokyoZone, 'tokyo_city');
    assert.equal(state.players.get('carol')!.tokyoZone, null);
    assert.equal(state.players.get('dave')!.tokyoZone, null);
    assert.equal(state.players.get('dave')!.forfeited, true);
    assert.equal(state.phase, 'buying_cards');
    assert.equal(state.turnOrder[state.currentTurnIndex], 'alice');
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo disconnected Tokyo occupants remain targets until grace then forfeit without deadlock', () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'alice');
    state.players.get('bob')!.tokyoZone = 'tokyo_city';
    expectOk(rollDice(state, 'alice', () => 0.75, state.revision));
    expirePlayer(room, 'bob');
    const healthBefore = state.players.get('bob')!.health;
    expectOk(prepareDiceResolution(state, 'alice', state.revision));
    expectOk(resolveDiceResults(state, 'alice', {
      resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
    }, state.revision, () => 0.75));
    assert.ok(state.players.get('bob')!.health < healthBefore);
    assert.equal(state.phase, 'awaiting_tokyo_decision');
    assert.equal(state.pendingTokyoDecisions[0], 'bob');
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
    assert.equal(state.phase, 'buying_cards');
    assert.equal(state.players.get('alice')!.tokyoZone, 'tokyo_city');
    assert.equal(state.players.get('bob')!.tokyoZone, null);
    assert.equal(state.players.get('bob')!.forfeited, true);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('King of Tokyo five-player forfeit collapses Bay into an empty City or out of occupied Tokyo', () => {
  const moveToCity = createDirectRoom(5);
  try {
    moveToCity.state.players.get('alice')!.tokyoZone = 'tokyo_city';
    moveToCity.state.players.get('bob')!.tokyoZone = 'tokyo_bay';
    expirePlayer(moveToCity.room, 'alice', true);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(moveToCity.io, moveToCity.room), true);
    assert.equal(moveToCity.state.players.get('alice')!.eliminated, true);
    assert.equal(moveToCity.state.players.get('bob')!.tokyoZone, 'tokyo_city');
  } finally {
    roomStore.delete(moveToCity.room.roomCode);
  }

  const leaveOccupiedCity = createDirectRoom(5);
  try {
    leaveOccupiedCity.state.players.get('alice')!.tokyoZone = 'tokyo_city';
    leaveOccupiedCity.state.players.get('bob')!.tokyoZone = 'tokyo_bay';
    expirePlayer(leaveOccupiedCity.room, 'carol', true);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(leaveOccupiedCity.io, leaveOccupiedCity.room), true);
    assert.equal(leaveOccupiedCity.state.players.get('carol')!.eliminated, true);
    assert.equal(leaveOccupiedCity.state.players.get('alice')!.tokyoZone, 'tokyo_city');
    assert.equal(leaveOccupiedCity.state.players.get('bob')!.tokyoZone, null);
  } finally {
    roomStore.delete(leaveOccupiedCity.room.roomCode);
  }
});

test('King of Tokyo explicit leave forfeits, transfers host and finalises the last survivor', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const started = waitForEvent<KingOfTokyoPublicState>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/leave`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    assert.equal(response.statusCode, 200);
    await waitUntil(() => serverState(alice.roomCode).status === 'game_over');
    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.players.get(alice.playerId)?.hasLeft, true);
    assert.equal(room.hostPlayerId, bob.playerId);
    assert.equal(serverState(alice.roomCode).players.get(alice.playerId)?.eliminated, true);
    assert.equal(serverState(alice.roomCode).winnerId, bob.playerId);
    assert.equal(room.status, 'finished');
  } finally {
    await closeHarness(harness);
  }
});

test('King of Tokyo host remains during reconnect grace and an expired host permanently leaves once', async () => {
  const { room, state, io } = createDirectRoom();
  try {
    chooseFirstPlayer(state, 'bob');
    const host = room.players.get('alice')!;
    assert.equal(markPlayerDisconnected(io, room, 'alice', host.socketId, 10_000), true);
    assert.equal(room.hostPlayerId, 'alice');
    assert.equal(roomStore.markConnected(room, 'alice', 'alice-reconnected')?.isConnected, true);
    assert.equal(room.hostPlayerId, 'alice');
    assert.equal(room.players.get('alice')?.presenceTimer, null);

    assert.equal(markPlayerDisconnected(io, room, 'alice', 'alice-reconnected', 0), true);
    await waitUntil(() => room.hostPlayerId === 'bob');
    assert.equal(room.players.get('alice')?.hasLeft, true);
    assert.equal(state.players.get('alice')?.eliminated, true);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('Astra: real HTTP password, capacity, reservation and token boundaries', async () => {
  const harness = await createHarness();
  const post = (path: string, payload: unknown, token?: string) => fetch(`${harness.url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  try {
    const created = await post('/rooms/create', { displayName: 'Astra Host', gameId: 'king_of_tokyo', password: ' exact password ' });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    const host = await created.json() as JoinRoomResponse;
    harness.roomCodes.add(host.roomCode);
    const hostSocket = await connect(harness, host.token);
    for (const password of [undefined, 'exact password', 'wrong']) {
      assert.equal((await post('/rooms/join', { roomCode: host.roomCode, displayName: 'Blocked', password })).status, 403);
    }
    for (let index = 1; index < 6; index++) {
      assert.equal((await post('/rooms/join', { roomCode: host.roomCode, displayName: `Reserved ${index}`, password: ' exact password ' })).status, 200);
    }
    assert.equal((await post('/rooms/join', { roomCode: host.roomCode, displayName: 'Overflow', password: ' exact password ' })).status, 409);
    assert.equal((await post(`/rooms/${host.roomCode}/leave`, {})).status, 401);
    const foreign = await createRoom(harness, 'Other room');
    assert.equal((await post(`/rooms/${host.roomCode}/leave`, {}, foreign.token)).status, 403);
    const rejection = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('start_game', {});
    assert.match((await rejection).reason, /connecting/i);
    assert.equal(roomStore.get(host.roomCode)!.game, null);
  } finally {
    await closeHarness(harness);
  }
});

test('Astra: semantic sender-only acknowledgements, viewer identity, malformed commands and duplicate rolls', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Astra Host');
    const hostSocket = await connect(harness, host.token);
    const guest = await joinRoom(harness, host.roomCode, 'Astra Guest');
    const guestSocket = await connect(harness, guest.token);
    const guestReceipts: unknown[] = [];
    guestSocket.on('king_of_tokyo:action_accepted', receipt => guestReceipts.push(receipt));
    const ack = waitForEvent<{ action: string; revision: number }>(hostSocket, 'king_of_tokyo:action_accepted');
    const initialFrame = waitForEvent<KingOfTokyoPublicState>(hostSocket, 'game_state');
    hostSocket.emit('start_game', {});
    assert.deepEqual(await ack, { action: 'start_game', revision: 0 });
    const initial = await initialFrame;
    assert.equal(initial.viewerPlayerId, host.playerId);
    assert.equal(initial.roomCode, host.roomCode);
    const events = ['roll', 'set_kept', 'resolve_dice', 'resolve_dice_results', 'allocate_hearts', 'psychic_probe',
      'yield_tokyo', 'freeze_time', 'defense', 'choose_death_from_above_target', 'buy_card', 'sweep_market',
      'opportunist', 'buy_lab_card', 'use_card', 'sell_card', 'buy_owned_card', 'preferences', 'end_turn', 'resolve_end_turn_effect'];
    for (const action of events) {
      const rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
      hostSocket.emit(`king_of_tokyo:${action}`, { expectedRevision: 0, unrecognisedField: true });
      assert.equal((await rejected).reason, 'Invalid payload');
      assert.equal(serverState(host.roomCode).revision, 0);
    }
    const rollAck = waitForEvent<{ action: string; revision: number }>(hostSocket, 'king_of_tokyo:action_accepted');
    hostSocket.emit('king_of_tokyo:roll_for_first', { expectedRevision: 0, rollOffRound: 1 });
    assert.deepEqual(await rollAck, { action: 'roll_for_first', revision: 1 });
    const duplicate = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('king_of_tokyo:roll_for_first', { expectedRevision: 0, rollOffRound: 1 });
    assert.match((await duplicate).reason, /already rolled/i);
    assert.equal(serverState(host.roomCode).revision, 1);
    assert.deepEqual(guestReceipts, []);
  } finally {
    await closeHarness(harness);
  }
});

for (const mode of ['explicit', 'expired', 'missing'] as const) {
  for (const count of [1, 2, 3]) {
    test(`Astra: ${mode} batch of ${count} active seats settles once without phantom winners`, () => {
      const { room, state, io } = createDirectRoom();
      try {
        chooseFirstPlayer(state);
        const revision = state.revision;
        for (const id of state.turnOrder.slice(0, count)) {
          if (mode === 'missing') room.players.delete(id);
          else expirePlayer(room, id, mode === 'explicit');
        }
        assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), true);
        assert.equal(state.revision, revision + 1);
        assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
        assert.equal(state.revision, revision + 1);
        const forfeited = [...state.players.values()].filter(player => player.forfeited);
        assert.equal(forfeited.length, count);
        assert(forfeited.every(player => player.eliminated && player.health === 0));
        if (count === 3) {
          assert.equal(state.status, 'game_over');
          assert.equal(state.winnerId, null);
          assert.equal(state.terminationReason, 'no_players_remaining');
          assert.equal(buildKingOfTokyoResult(state), null);
        } else if (count === 2) {
          assert.equal(state.winnerId, 'carol');
          assert.deepEqual(buildKingOfTokyoResult(state)?.players.map(player => player.playerId), ['carol']);
        } else assert.equal(state.status, 'playing');
      } finally {
        roomStore.delete(room.roomCode);
      }
    });
  }
}

test('Astra: simultaneous real lifecycle expiries abandon, while temporary disconnect remains recoverable', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Astra Host');
    const hostSocket = await connect(harness, host.token);
    const guest = await joinRoom(harness, host.roomCode, 'Astra Guest');
    await connect(harness, guest.token);
    const started = waitForEvent<KingOfTokyoPublicState>(hostSocket, 'game_state');
    hostSocket.emit('start_game', {});
    await started;
    const room = roomStore.get(host.roomCode)!;
    const before = serverState(host.roomCode).revision;
    assert.equal(markPlayerDisconnected(harness.io, room, host.playerId, room.players.get(host.playerId)!.socketId, 10_000), true);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(harness.io, room), false);
    await connect(harness, host.token);
    assert.equal(serverState(host.roomCode).revision, before);
    for (const player of room.players.values()) markPlayerDisconnected(harness.io, room, player.playerId, player.socketId, 0);
    await waitUntil(() => room.status === 'finished');
    const state = serverState(host.roomCode);
    assert.equal(state.winnerId, null);
    assert.equal(state.terminationReason, 'no_players_remaining');
    assert.equal(state.revision, before + 1);
  } finally {
    await closeHarness(harness);
  }
});

test('Astra: results distinguish natural mutual destruction, spectator departure and active forfeit', () => {
  const { room, state, io } = createDirectRoom();
  try {
    const alice = state.players.get('alice')!;
    alice.health = 0;
    alice.eliminated = true;
    expirePlayer(room, 'alice', true);
    assert.equal(recoverDisconnectedKingOfTokyoPlayers(io, room), false);
    assert.equal(alice.forfeited, false);
    state.status = 'game_over';
    state.phase = 'game_over';
    state.victoryType = 'mutual_destruction';
    state.winnerId = null;
    assert.equal(buildKingOfTokyoResult(state)?.players.length, 3);
    assert(buildKingOfTokyoResult(state)?.players.every(player => !player.won));
    state.terminationReason = 'no_players_remaining';
    assert.equal(buildKingOfTokyoResult(state), null);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

for (const health of [9, 12]) {
  test(`Astra Even Bigger: REST source forfeit clamps ${health} HP without damage or defence`, async () => {
    const harness = await createHarness();
    try {
      const owner = await createRoom(harness, 'Astra Copy');
      const ownerSocket = await connect(harness, owner.token);
      const source = await joinRoom(harness, owner.roomCode, 'Astra Source');
      const sourceSocket = await connect(harness, source.token);
      const observer = await joinRoom(harness, owner.roomCode, 'Astra Observer');
      const observerSocket = await connect(harness, observer.token);
      const initialFrames = [ownerSocket, sourceSocket, observerSocket].map(socket =>
        waitForEvent<KingOfTokyoPublicState>(socket, 'game_state'));
      ownerSocket.emit('start_game', {});
      await Promise.all(initialFrames);
      const state = serverState(owner.roomCode);
      chooseFirstPlayer(state, owner.playerId);
      const evenBigger = giveKeepCard(state, source.playerId, 'even_bigger');
      const mimic = giveKeepCard(state, owner.playerId, 'mimic');
      mimic.mimicTargetInstanceId = evenBigger.instanceId;
      giveKeepCard(state, owner.playerId, 'wings');
      Object.assign(state.players.get(source.playerId)!, { maxHealth: 12 });
      Object.assign(state.players.get(owner.playerId)!, {
        health, maxHealth: 12, energy: 2, defenseMode: 'always',
      });
      validateKingOfTokyoState(state);
      const oldRevision = state.revision;
      const beforeFrame = waitForEvent<KingOfTokyoPublicState>(ownerSocket, 'game_state');
      ownerSocket.emit('request_state');
      assert.equal((await beforeFrame).players.find(player => player.playerId === owner.playerId)!.maxHealth, 12);
      const ownerUpdate = waitForEvent<KingOfTokyoPublicState>(ownerSocket, 'game_state');
      const observerUpdate = waitForEvent<KingOfTokyoPublicState>(observerSocket, 'game_state');
      const response = await fetch(`${harness.url}/rooms/${owner.roomCode}/leave`, {
        method: 'POST', headers: { authorization: `Bearer ${source.token}` },
      });
      assert.equal(response.status, 200);
      for (const frame of await Promise.all([ownerUpdate, observerUpdate])) {
        assert.equal(frame.revision, oldRevision + 1);
        assert.equal(frame.phase, 'awaiting_roll');
        assert.equal(frame.pendingDefenseDecision, null);
        const player = frame.players.find(candidate => candidate.playerId === owner.playerId)!;
        assert.equal(player.maxHealth, 10);
        assert.equal(player.health, Math.min(health, 10));
        assert.equal(player.energy, 2);
        assert.equal(player.powerCards.find(card => card.cardId === 'mimic')!.mimicTargetInstanceId, null);
        assert.equal(frame.players.find(candidate => candidate.playerId === source.playerId)!.forfeited, true);
      }
      assert.equal(state.status, 'playing');
      assert.equal(state.pendingDamageWorkflow, null);
      validateKingOfTokyoState(state);
      for (const expectedRevision of [oldRevision, oldRevision, state.revision]) {
        const rejected = waitForEvent<{ reason: string }>(ownerSocket, 'action_rejected');
        ownerSocket.emit('king_of_tokyo:defense', { kind: 'wings', use: true, expectedRevision });
        assert.match((await rejected).reason, expectedRevision === oldRevision ? /stale/i : /No defence decision/i);
        assert.equal(state.revision, oldRevision + 1);
        assert.equal(state.players.get(owner.playerId)!.health, Math.min(health, 10));
        assert.equal(state.players.get(owner.playerId)!.energy, 2);
      }
      validateKingOfTokyoState(state);
    } finally {
      await closeHarness(harness);
    }
  });
}

test('Astra Regeneration: public healing preview, owner-only activation, reconnect and replay safety', async () => {
  const harness = await createHarness();
  try {
    const host = await createRoom(harness, 'Alice');
    const hostSocket = await connect(harness, host.token);
    const guest = await joinRoom(harness, host.roomCode, 'Bob');
    const guestSocket = await connect(harness, guest.token);
    const started = waitForEvent<KingOfTokyoPublicState>(hostSocket, 'game_state');
    const guestStarted = waitForEvent<KingOfTokyoPublicState>(guestSocket, 'game_state');
    hostSocket.emit('start_game', {});
    await Promise.all([started, guestStarted]);
    const state = serverState(host.roomCode);
    chooseFirstPlayer(state, host.playerId);
    giveKeepCard(state, guest.playerId, 'rapid_healing');
    giveKeepCard(state, guest.playerId, 'regeneration');
    state.players.get(host.playerId)!.tokyoZone = 'tokyo_city';
    Object.assign(state.players.get(guest.playerId)!, { health: 3, energy: 4, rapidHealingMode: 'lethal' });
    expectOk(rollDice(state, host.playerId, () => 0.55, state.revision));
    for (let index = 0; index < 3; index++) state.dice[index]!.face = 'smash';
    expectOk(prepareDiceResolution(state, host.playerId, state.revision));
    expectOk(resolveDiceResults(state, host.playerId, { resolutionOrder: ['points', 'energy', 'hearts', 'smash'] }, state.revision));
    assert.equal(state.pendingDefenseDecision?.kind, 'rapid_healing');
    const revision = state.revision;
    const ownerFrame = waitForEvent<KingOfTokyoPublicState>(guestSocket, 'game_state');
    guestSocket.emit('request_state');
    const original = await ownerFrame;
    assert.equal(original.pendingDefenseDecision!.healingPerActivation, 2);
    assert.equal(original.pendingDefenseDecision!.maxActivations, 2);
    const observerFrame = waitForEvent<KingOfTokyoPublicState>(hostSocket, 'game_state');
    hostSocket.emit('request_state');
    assert.deepEqual((await observerFrame).pendingDefenseDecision, original.pendingDefenseDecision);
    const wrongOwner = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
    hostSocket.emit('king_of_tokyo:defense', { kind: 'rapid_healing', activations: 1, expectedRevision: revision });
    assert.match((await wrongOwner).reason, /No defence decision/i);
    assert.equal(state.revision, revision);
    guestSocket.disconnect();
    await waitUntil(() => !roomStore.get(host.roomCode)!.players.get(guest.playerId)!.isConnected);
    const recovered = await connect(harness, guest.token);
    const recoveryFrame = waitForEvent<KingOfTokyoPublicState>(recovered, 'game_state');
    recovered.emit('request_state');
    const refreshed = await recoveryFrame;
    assert.equal(refreshed.viewerPlayerId, guest.playerId);
    assert.equal(refreshed.revision, revision);
    assert.deepEqual(refreshed.pendingDefenseDecision, original.pendingDefenseDecision);
    const accepted = waitForEvent<{ action: string; revision: number }>(recovered, 'king_of_tokyo:action_accepted');
    recovered.emit('king_of_tokyo:defense', { kind: 'rapid_healing', activations: 1, expectedRevision: revision });
    assert.deepEqual(await accepted, { action: 'defense', revision: revision + 1 });
    assert.equal(state.players.get(guest.playerId)!.health, 2, '3 initial + 2 healed - 3 damage');
    assert.equal(state.players.get(guest.playerId)!.energy, 2);
    const duplicate = waitForEvent<{ reason: string }>(recovered, 'action_rejected');
    recovered.emit('king_of_tokyo:defense', { kind: 'rapid_healing', activations: 1, expectedRevision: revision });
    assert.match((await duplicate).reason, /stale/i);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.players.get(guest.playerId)!.energy, 2);
  } finally {
    await closeHarness(harness);
  }
});

for (const phase of ['determining_first_player', 'awaiting_roll', 'choosing_dice', 'awaiting_dice_resolution',
  'awaiting_heart_allocation', 'awaiting_tokyo_decision', 'awaiting_defense_decision', 'awaiting_freeze_time',
  'awaiting_opportunist', 'buying_cards'] as const) {
  for (const mode of ['REST leave', 'zero-grace lifecycle'] as const) {
    test(`Astra canonical: ${mode} removes the owner during ${phase}`, async () => {
      const harness = await createHarness();
      try {
        const host = await createRoom(harness, 'Astra Host');
        const hostSocket = await connect(harness, host.token);
        const guest = await joinRoom(harness, host.roomCode, 'Astra Guest');
        await connect(harness, guest.token);
        const third = await joinRoom(harness, host.roomCode, 'Astra Third');
        const observer = await connect(harness, third.token);
        const started = waitForEvent<KingOfTokyoPublicState>(observer, 'game_state');
        hostSocket.emit('start_game', {});
        await started;
        const room = roomStore.get(host.roomCode)!;
        const state = serverState(host.roomCode);
        let departing = host;
        if (phase !== 'determining_first_player') chooseFirstPlayer(state, host.playerId);
        if (!['determining_first_player', 'awaiting_roll'].includes(phase)) {
          expectOk(rollDice(state, host.playerId, () => 0.55, state.revision));
          if (phase === 'awaiting_heart_allocation') {
            state.players.get(host.playerId)!.poisonTokens = 1;
            state.dice[0]!.face = 'heart';
          } else if (phase === 'awaiting_tokyo_decision') {
            state.players.get(guest.playerId)!.tokyoZone = 'tokyo_city';
            state.dice[0]!.face = 'smash';
            departing = guest;
          } else if (phase === 'awaiting_defense_decision') {
            state.players.get(host.playerId)!.tokyoZone = 'tokyo_city';
            Object.assign(state.players.get(guest.playerId)!, { health: 1, energy: 2, defenseMode: 'lethal' });
            giveKeepCard(state, guest.playerId, 'wings');
            state.dice[0]!.face = 'smash';
            departing = guest;
          } else if (phase === 'awaiting_freeze_time') {
            giveKeepCard(state, host.playerId, 'freeze_time');
            for (let index = 0; index < 3; index++) state.dice[index]!.face = 1;
          }
          if (phase !== 'choosing_dice') {
            expectOk(prepareDiceResolution(state, host.playerId, state.revision));
            if (phase !== 'awaiting_dice_resolution') {
              expectOk(resolveDiceResults(state, host.playerId, {
                resolutionOrder: ['points', 'energy', 'hearts', 'smash'],
              }, state.revision));
            }
          }
          if (phase === 'awaiting_opportunist') {
            giveKeepCard(state, guest.playerId, 'opportunist');
            state.phase = phase;
            state.pendingOpportunist = { cardInstanceId: state.market[0]!.instanceId, playerIds: [guest.playerId] };
            departing = guest;
          }
        }
        assert.equal(state.phase, phase);
        const before = state.revision;
        if (mode === 'REST leave') {
          const response = await fetch(`${harness.url}/rooms/${host.roomCode}/leave`, {
            method: 'POST', headers: { authorization: `Bearer ${departing.token}` },
          });
          assert.equal(response.status, 200);
        } else {
          const player = room.players.get(departing.playerId)!;
          assert.equal(markPlayerDisconnected(harness.io, room, player.playerId, player.socketId, 0), true);
        }
        await waitUntil(() => state.players.get(departing.playerId)!.forfeited);
        assert.equal(state.revision, before + 1);
        assert.equal(state.players.get(departing.playerId)!.health, 0);
        assert.equal(recoverDisconnectedKingOfTokyoPlayers(harness.io, room), false);
        const view = toKingOfTokyoPublicState(state, third.playerId);
        assert.notEqual(view.pendingTokyoDecisionPlayerId, departing.playerId);
        assert.notEqual(view.pendingDefenseDecision?.playerId, departing.playerId);
        assert.notEqual(view.pendingFreezeTimePlayerId, departing.playerId);
        assert.notEqual(view.pendingHeartAllocation?.playerId, departing.playerId);
        assert.notEqual(view.pendingOpportunistPlayerId, departing.playerId);
        assert.notEqual(view.currentPlayerId, departing.playerId);
      } finally {
        await closeHarness(harness);
      }
    });
  }
}
