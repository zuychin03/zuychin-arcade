import { io as connect, type Socket } from 'socket.io-client';
import type {
  JoinRoomResponse,
  KingOfTokyoDiceResolutionCategory,
  KingOfTokyoPublicState,
  RoomPublicState,
} from '@zuychin-arcade/types';

import Fastify from 'fastify';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'king-of-tokyo-isolated-smoke-only-secret';
assert.equal(supabase, null, 'Smoke refuses hosted persistence; unset Supabase credentials');
let BASE = '';
const allClients: Socket[] = [];
const ownRooms = new Set<string>();
const TIMEOUT_MS = 10_000;
const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;
const DEFAULT_ORDER: KingOfTokyoDiceResolutionCategory[] = ['points', 'energy', 'hearts', 'smash'];

function fail(message: string): never {
  throw new Error(`KING OF TOKYO SMOKE FAIL: ${message}`);
}

async function request(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, body);
  if (!response.ok) fail(`${path} -> ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  state: KingOfTokyoPublicState | null;
  rejections: string[];
  errors: string[];
  receipts: { action: string; revision: number }[];
}

function connectClient(auth: JoinRoomResponse): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(BASE, {
      auth: { token: auth.token },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    const client: Client = { auth, socket, room: null, state: null, rejections: [], errors: [], receipts: [] };
    allClients.push(socket);
    socket.on('king_of_tokyo:action_accepted', value => client.receipts.push(value));
    socket.on('room_updated', (room: RoomPublicState) => (client.room = room));
    socket.on('game_state', (state: KingOfTokyoPublicState) => (client.state = state));
    socket.on('action_rejected', ({ reason }: { reason: string }) => client.rejections.push(reason));
    socket.on('server_error', ({ message }: { message: string }) => client.errors.push(message));
    socket.on('connect_error', reject);
    socket.on('connect', () => {
      socket.emit('request_state');
      resolve(client);
    });
    setTimeout(() => reject(new Error('connect timeout')), TIMEOUT_MS).unref();
  });
}

function until(check: () => boolean, label: string, timeoutMs = TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 10);
  });
}

function clientFor(clients: Client[], playerId: string | null): Client {
  const client = clients.find((candidate) => candidate.auth.playerId === playerId);
  if (!client) fail(`no client owns decision for ${playerId ?? 'null'}`);
  return client;
}

async function synchronise(clients: Client[]): Promise<KingOfTokyoPublicState> {
  await until(() => clients.every((client) => client.state !== null), 'all game states');
  await until(() => {
    const revision = clients[0].state!.revision;
    return clients.every((client) => client.state?.revision === revision);
  }, 'matching revisions');
  return clients[0].state!;
}

async function emitMutation(
  clients: Client[],
  client: Client,
  event: string,
  fields: Record<string, unknown> = {},
): Promise<KingOfTokyoPublicState> {
  await synchronise(clients);
  const before = client.state!;
  const counts = clients.map(seat => seat.receipts.length);
  const rejectionCount = client.rejections.length;
  client.socket.emit(event, { ...fields, expectedRevision: before.revision });
  await until(
    () => client.rejections.length > rejectionCount || (client.state?.revision ?? -1) > before.revision,
    `${event} acknowledgement`,
  );
  if (client.rejections.length > rejectionCount) {
    fail(`${event} rejected: ${client.rejections.at(-1)}`);
  }
  if (client.state!.revision !== before.revision + 1) {
    fail(`${event} revision jumped ${before.revision} -> ${client.state!.revision}`);
  }
  const after = await synchronise(clients);
  clients.forEach((seat, index) => {
    assert.equal(seat.receipts.length, counts[index]! + Number(seat === client), 'sender-only acknowledgement');
    assert.equal(seat.state!.roomCode, seat.auth.roomCode);
    assert.equal(seat.state!.viewerPlayerId, seat.auth.playerId);
    assert.equal(seat.state!.players.some(player => 'defenseMode' in player || 'rapidHealingMode' in player || 'tokenPreference' in player), false);
  });
  assert.deepEqual(client.receipts.at(-1), { action: event.split(':')[1], revision: after.revision });
  return after;
}

function keptIndexes(state: KingOfTokyoPublicState): number[] {
  const smash = state.dice.flatMap((die, index) => die.face === 'smash' ? [index] : []);
  if (smash.length) return smash;
  const numberCounts = ([1, 2, 3] as const).map((face) => ({
    face,
    indexes: state.dice.flatMap((die, index) => die.face === face ? [index] : []),
  }));
  numberCounts.sort((a, b) => b.indexes.length - a.indexes.length || b.face - a.face);
  return numberCounts[0].indexes;
}

function tokenAllocation(client: Client): { poisonTokensToRemove: number; shrinkTokensToRemove: number } {
  const state = client.state!;
  const actor = state.players.find((player) => player.playerId === state.currentPlayerId)!;
  if (actor.tokyoZone) return { poisonTokensToRemove: 0, shrinkTokensToRemove: 0 };
  let hearts = state.pendingHeartAllocation?.heartIndexes.length ?? 0;
  let poisonTokensToRemove = 0;
  let shrinkTokensToRemove = 0;
  if (client.state?.viewerPreferences?.tokenPreference === 'shrink') {
    shrinkTokensToRemove = Math.min(actor.shrinkTokens, hearts);
    hearts -= shrinkTokensToRemove;
    poisonTokensToRemove = Math.min(actor.poisonTokens, hearts);
  } else {
    poisonTokensToRemove = Math.min(actor.poisonTokens, hearts);
    hearts -= poisonTokensToRemove;
    shrinkTokensToRemove = Math.min(actor.shrinkTokens, hearts);
  }
  return { poisonTokensToRemove, shrinkTokensToRemove };
}

interface DriveEvidence {
  actions: number;
  sawForcedCity: boolean;
  sawBay: boolean;
  sawYield: boolean;
}

async function driveToGameOver(clients: Client[]): Promise<DriveEvidence> {
  let actions = 0;
  let sawForcedCity = false;
  let sawBay = false;
  let sawYield = false;
  let firstResolvedTurn = true;

  while ((await synchronise(clients)).status === 'playing') {
    if (actions > 8_000) fail('game did not finish within 8,000 mutations');
    const state = await synchronise(clients);
    let next: KingOfTokyoPublicState;

    switch (state.phase) {
      case 'determining_first_player': {
        const pendingId = state.startingRollContenders.find((id) => state.startRolls[id] === null);
        if (!pendingId) fail('first-player roll-off has no eligible roller');
        next = await emitMutation(clients, clientFor(clients, pendingId), 'king_of_tokyo:roll_for_first', {
          rollOffRound: state.rollOffRound,
        });
        actions += 1;
        break;
      }
      case 'awaiting_roll':
        next = await emitMutation(clients, clientFor(clients, state.currentPlayerId), 'king_of_tokyo:roll');
        actions += 1;
        break;
      case 'choosing_dice': {
        const actor = clientFor(clients, state.currentPlayerId);
        if (state.rollCount < state.maxRolls) {
          const kept = keptIndexes(state);
          if (kept.length < state.dice.length) {
            await emitMutation(clients, actor, 'king_of_tokyo:set_kept', { keptIndexes: kept });
            actions += 1;
            next = await emitMutation(clients, actor, 'king_of_tokyo:roll');
            actions += 1;
            break;
          }
        }
        next = await emitMutation(clients, actor, 'king_of_tokyo:resolve_dice');
        actions += 1;
        break;
      }
      case 'awaiting_psychic_probe':
        next = await emitMutation(
          clients,
          clientFor(clients, state.pendingPsychicProbePlayerId),
          'king_of_tokyo:psychic_probe',
          { dieIndex: null },
        );
        actions += 1;
        break;
      case 'awaiting_dice_resolution': {
        const actor = clientFor(clients, state.currentPlayerId);
        next = await emitMutation(clients, actor, 'king_of_tokyo:resolve_dice_results', {
          resolutionOrder: DEFAULT_ORDER,
        });
        actions += 1;
        const resolvedActor = next.players.find((player) => player.playerId === state.currentPlayerId);
        if (firstResolvedTurn && resolvedActor?.tokyoZone === 'tokyo_city') sawForcedCity = true;
        firstResolvedTurn = false;
        break;
      }
      case 'awaiting_heart_allocation': {
        const ownerId = state.pendingHeartAllocation?.playerId;
        if (!ownerId) fail('Heart allocation has no owner');
        const actor = clientFor(clients, ownerId);
        next = await emitMutation(clients, actor, 'king_of_tokyo:allocate_hearts', {
          healingRayUses: [],
          ...tokenAllocation(actor),
        });
        actions += 1;
        break;
      }
      case 'awaiting_defense_decision': {
        const decision = state.pendingDefenseDecision;
        if (!decision) fail('Defence choice has no owner');
        const payload = decision.kind === 'camouflage'
          ? { kind: 'camouflage', changes: [] }
          : decision.kind === 'wings'
            ? { kind: 'wings', use: false }
            : { kind: 'rapid_healing', activations: 0 };
        next = await emitMutation(
          clients,
          clientFor(clients, decision.playerId),
          'king_of_tokyo:defense',
          payload,
        );
        actions += 1;
        break;
      }
      case 'awaiting_freeze_time':
        if (!state.pendingFreezeTimePlayerId) fail('Freeze Time choice has no owner');
        next = await emitMutation(
          clients,
          clientFor(clients, state.pendingFreezeTimePlayerId),
          'king_of_tokyo:freeze_time',
          { accept: false },
        );
        actions += 1;
        break;
      case 'awaiting_tokyo_decision': {
        const decider = clientFor(clients, state.pendingTokyoDecisionPlayerId);
        const player = state.players.find((candidate) => candidate.playerId === state.pendingTokyoDecisionPlayerId)!;
        const yieldTokyo = sawBay && player.health <= 5;
        next = await emitMutation(clients, decider, 'king_of_tokyo:yield_tokyo', { yieldTokyo });
        sawYield ||= yieldTokyo;
        actions += 1;
        break;
      }
      case 'awaiting_death_from_above': {
        const targetPlayerId = state.pendingDeathFromAboveTargetPlayerIds[0];
        if (!state.pendingDeathFromAbovePlayerId || !targetPlayerId) fail('Death from Above choice has no legal target');
        next = await emitMutation(
          clients,
          clientFor(clients, state.pendingDeathFromAbovePlayerId),
          'king_of_tokyo:choose_death_from_above_target',
          { targetPlayerId },
        );
        actions += 1;
        break;
      }
      case 'awaiting_opportunist':
        next = await emitMutation(
          clients,
          clientFor(clients, state.pendingOpportunistPlayerId),
          'king_of_tokyo:opportunist',
          { buy: false },
        );
        actions += 1;
        break;
      case 'buying_cards':
      case 'selling_cards':
        next = await emitMutation(clients, clientFor(clients, state.currentPlayerId), 'king_of_tokyo:end_turn');
        actions += 1;
        break;
      case 'resolving_end_turn': {
        const actor = clientFor(clients, state.currentPlayerId);
        const effect = actor.state!.pendingEndTurnEffects[0];
        if (!effect) fail('active player cannot see pending end-turn effect');
        next = await emitMutation(clients, actor, 'king_of_tokyo:resolve_end_turn_effect', { effectId: effect.effectId });
        actions += 1;
        break;
      }
      case 'game_over':
        return { actions, sawForcedCity, sawBay, sawYield };
    }
    if (next.players.some((player) => player.tokyoZone === 'tokyo_bay')) sawBay = true;
    const livingCount = next.players.filter((player) => !player.eliminated).length;
    const expectedCapacity = livingCount >= 5 ? 2 : 1;
    if (next.tokyoCapacity !== expectedCapacity && next.status === 'playing') {
      fail(`unexpected Tokyo capacity ${next.tokyoCapacity}; expected ${expectedCapacity} for ${livingCount} living`);
    }
  }
  return { actions, sawForcedCity, sawBay, sawYield };
}

async function createMatch(count: number): Promise<{ clients: Client[]; host: JoinRoomResponse }> {
  const host = await api<JoinRoomResponse>('/rooms/create', {
    displayName: `Tokyo Host ${count}`,
    gameId: 'king_of_tokyo',
  });
  ownRooms.add(host.roomCode);
  if (host.room.gameId !== 'king_of_tokyo') fail('room was not created for King of Tokyo');

  const duplicate = await request('/rooms/join', {
    roomCode: host.roomCode,
    displayName: `tokyo host ${count}`,
  });
  if (duplicate.status !== 409) fail(`duplicate display name returned ${duplicate.status}`);

  const auth = [host];
  for (let index = 1; index < count; index += 1) {
    auth.push(await api<JoinRoomResponse>('/rooms/join', {
      roomCode: host.roomCode,
      displayName: `Tokyo Guest ${count} ${index}`,
    }));
  }
  const clients = await Promise.all(auth.map(connectClient));
  await until(
    () => clients.every((client) => client.room?.players.length === count && client.room.status === 'lobby'),
    `${count}-player lobby synchronisation`,
  );
  return { clients, host };
}

async function verifyInitialBoundary(clients: Client[]): Promise<void> {
  const host = clients[0];
  const guest = clients[1];
  const nonHostRejections = guest.rejections.length;
  guest.socket.emit('start_game', {});
  await until(() => guest.rejections.length === nonHostRejections + 1, 'non-host start rejection');
  if (!/host/i.test(guest.rejections.at(-1)!)) fail('non-host start returned wrong rejection');
  if (host.room?.status !== 'lobby') fail('non-host start changed room state');

  host.socket.emit('start_game');
  await until(
    () => clients.every((client) => client.state?.phase === 'determining_first_player'),
    'host start',
  );
  if (clients.some((client) => !client.state?.viewerPreferences)) fail('viewer preferences missing for owner');
  if (clients.some((client) => client.state!.players.some((player) => (
    'defenseMode' in player || 'rapidHealingMode' in player || 'tokenPreference' in player
  )))) fail('strategic preferences leaked in public player rows');

  const preferenceRevision = (await synchronise(clients)).revision;
  const preferenceRejections = guest.rejections.length;
  guest.socket.emit('king_of_tokyo:preferences', {
    tokenPreference: 'shrink',
    expectedRevision: preferenceRevision,
  });
  await until(
    () => guest.rejections.length > preferenceRejections ||
      guest.state?.viewerPreferences?.tokenPreference === 'shrink',
    'private preference acknowledgement',
  );
  if (guest.rejections.length > preferenceRejections) {
    fail(`king_of_tokyo:preferences rejected: ${guest.rejections.at(-1)}`);
  }
  if ((await synchronise(clients)).revision !== preferenceRevision + 1) {
    fail('changed preference mutation did not advance revision');
  }
  if (guest.state?.viewerPreferences?.tokenPreference !== 'shrink') {
    fail('preference mutation was not returned to its owner');
  }
  if (host.state?.viewerPreferences?.tokenPreference !== 'poison') {
    fail('another player received the mutated private preference');
  }

  const state = await synchronise(clients);
  const pendingId = state.startingRollContenders.find((id) => state.startRolls[id] === null)!;
  const roller = clientFor(clients, pendingId);
  const rejectedBefore = roller.rejections.length;
  roller.socket.emit('king_of_tokyo:roll_for_first', {});
  await until(() => roller.rejections.length === rejectedBefore + 1, 'missing revision rejection');
  if (roller.rejections.at(-1) !== 'Invalid payload') fail('missing revision was not a payload error');
  if ((await synchronise(clients)).revision !== state.revision) fail('invalid mutation changed revision');

  const afterRoll = await emitMutation(clients, roller, 'king_of_tokyo:roll_for_first', {
    rollOffRound: state.rollOffRound,
  });
  const replayRejections = roller.rejections.length;
  roller.socket.emit('king_of_tokyo:roll_for_first', {
    expectedRevision: state.revision,
    rollOffRound: state.rollOffRound,
  });
  await until(() => roller.rejections.length === replayRejections + 1, 'replay rejection');
  if (!/already rolled/i.test(roller.rejections.at(-1)!)) fail('replayed same-round mutation was not rejected');
  if ((await synchronise(clients)).revision !== afterRoll.revision) fail('replayed mutation changed revision');

  const beforeCrossGame = afterRoll.revision;
  roller.socket.emit('coup:action', { action: 'income', expectedRevision: beforeCrossGame });
  await new Promise((resolve) => setTimeout(resolve, 50));
  if ((await synchronise(clients)).revision !== beforeCrossGame) fail('cross-game event mutated King of Tokyo');
}

async function verifyReload(clients: Client[]): Promise<void> {
  const original = clients[0];
  const playerId = original.auth.playerId;
  original.socket.disconnect();
  await until(
    () => clients.slice(1).every((client) => client.room?.players.find((player) => player.playerId === playerId)?.isConnected === false),
    'host disconnect presence',
  );
  if (clients[1].room?.players.find((player) => player.isHost)?.playerId !== playerId) {
    fail('temporary reload stripped host control');
  }

  const restored = await connectClient(original.auth);
  clients[0] = restored;
  await synchronise(clients);
  await until(() => restored.room !== null, 'restored room state');
  if (restored.room?.players.find((player) => player.isHost)?.playerId !== playerId) {
    fail('reloaded host did not retain host control');
  }
  if (restored.room?.players.find((player) => player.playerId === playerId)?.hasLeft) fail('reload became explicit Leave');
}

async function playMatch(count: number): Promise<void> {
  const { clients } = await createMatch(count);
  try {
    await verifyInitialBoundary(clients);
    if (count === 2) await verifyReload(clients);
    const evidence = await driveToGameOver(clients);
    evidence.actions += 2; // Boundary checks also accept one preference update and one roll-off.
    const finished = await synchronise(clients);
    await until(() => clients.every((client) => client.room?.status === 'finished'), 'finished room state');
    if (!finished.winnerId) fail(`${count}-player ordinary match ended without winner`);
    const winner = finished.players.find((player) => player.playerId === finished.winnerId);
    if (!winner || winner.eliminated || winner.health <= 0) fail(`${count}-player winner did not survive`);
    if (!evidence.sawForcedCity) fail(`${count}-player match did not force the first monster into Tokyo City`);
    if (count >= 5 && !evidence.sawBay) fail(`${count}-player match never filled Tokyo Bay`);
    const lateJoin = await request('/rooms/join', { roomCode: clients[0].auth.roomCode, displayName: 'Late arrival' });
    assert.equal(lateJoin.status, 409, 'finished rooms reject new seats');
    const terminalRejections = clients[0].rejections.length;
    clients[0].socket.emit('king_of_tokyo:roll', { expectedRevision: finished.revision });
    await until(() => clients[0].rejections.length === terminalRejections + 1, 'finished action rejected');
    assert.equal((await synchronise(clients)).revision, finished.revision);

    const winnerId = finished.winnerId;
    clients[0].socket.emit('start_game');
    await until(
      () => clients.every((client) => client.state?.status === 'playing'
        && client.state.phase === 'awaiting_roll'
        && client.state.currentPlayerId === winnerId),
      'winner-first rematch',
    );
    const rematch = await synchronise(clients);
    if (rematch.turnOrder[0] !== winnerId) fail('rematch did not rotate winner to first seat');
    assert.equal(rematch.revision, finished.revision + 1, 'monotonic rematch');
    const staleCount = clients[0].rejections.length;
    clients[0].socket.emit('king_of_tokyo:roll', { expectedRevision: 0 });
    await until(() => clients[0].rejections.length === staleCount + 1, 'prior-match command rejected');
    assert.equal((await synchronise(clients)).revision, rematch.revision);
    const replayEvidence = await driveToGameOver(clients);
    assert.equal((await synchronise(clients)).status, 'game_over');

    console.log(
      `KING OF TOKYO ${count}P PASS: ${evidence.actions} mutations, winner ${winner!.displayName}, `
      + `forced City ${evidence.sawForcedCity}, Bay ${evidence.sawBay}, yield ${evidence.sawYield}; rematch ${replayEvidence.actions} mutations.`,
    );
  } finally {
    for (const client of clients) client.socket.disconnect();
  }
}

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  const io = new Server(app.server);
  registerRoomRoutes(app, io);
  registerSocketHandlers(io);
  BASE = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    for (const count of PLAYER_COUNTS) await playMatch(count);
    console.log('KING OF TOKYO SMOKE PASS: ten full projection-only games, initial and rematch at each 2-6 player count.');
  } finally {
    for (const socket of allClients) socket.disconnect();
    for (const code of ownRooms) roomStore.delete(code);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
