import { io as connect, type Socket } from 'socket.io-client';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import type {
  CitadelsActionAccepted,
  CitadelsPrivateState,
  CitadelsPublicState,
  JoinRoomResponse,
  RoomPublicState,
} from '@zuychin-arcade/types';

process.env.JWT_SECRET ??= 'citadels-smoke-only-secret-32-bytes';
let BASE = '';
const TIMEOUT = 8_000;
const sockets: Socket[] = [];
const roomCodes: string[] = [];

function fail(message: string): never {
  throw new Error(`CITADELS SMOKE FAIL: ${message}`);
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(`${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: CitadelsPublicState | null;
  mine: CitadelsPrivateState | null;
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, TIMEOUT);
    const handler = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(event, handler);
  });
}

function connectClient(auth: JoinRoomResponse): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(BASE, {
      auth: { token: auth.token },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    const client: Client = { auth, socket, room: null, game: null, mine: null };
    sockets.push(socket);
    socket.on('room_updated', (room: RoomPublicState) => { client.room = room; });
    socket.on('game_state', (game: CitadelsPublicState) => { client.game = game; });
    socket.on('private_state', (mine: CitadelsPrivateState) => { client.mine = mine; });
    const timer = setTimeout(() => reject(new Error('connect timeout')), TIMEOUT);
    socket.on('connect_error', reject);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.emit('request_state');
      resolve(client);
    });
  });
}

function until(check: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > TIMEOUT) {
        clearInterval(timer);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 10);
  });
}

async function rejected(client: Client, event: string, payload: unknown): Promise<string> {
  const response = once<{ reason: string }>(client.socket, 'action_rejected');
  client.socket.emit(event, payload);
  return (await response).reason;
}

async function accepted(
  clients: Client[],
  actor: Client,
  event: string,
  payload: unknown,
  action: CitadelsActionAccepted['action'],
): Promise<CitadelsActionAccepted> {
  const response = once<CitadelsActionAccepted>(actor.socket, 'citadels:action_accepted');
  actor.socket.emit(event, payload);
  const ack = await response;
  if (ack.action !== action) fail(`${event} acknowledged as ${ack.action}`);
  await until(
    () => clients.every((client) => client.game?.revision === ack.revision && client.mine?.revision === ack.revision),
    `${action} revision ${ack.revision}`,
  );
  return ack;
}

async function startGame(clients: Client[]): Promise<void> {
  const expectedRevision = clients[0]!.game ? clients[0]!.game!.revision + 1 : 0;
  const ackPromise = once<CitadelsActionAccepted>(clients[0]!.socket, 'citadels:action_accepted');
  clients[0]!.socket.emit('start_game', {});
  const ack = await ackPromise;
  if (ack.action !== 'start' || ack.revision !== expectedRevision) fail('start acknowledgement is wrong');
  await until(
    () => clients.every((client) => client.game?.phase === 'drafting' && client.mine?.hand.length === 4
      && client.game.revision === expectedRevision && client.mine.revision === expectedRevision),
    'opening draft and private hands',
  );
}

async function playFullMatch(clients: Client[]): Promise<number> {
  const byId = new Map(clients.map((client) => [client.auth.playerId, client]));
  let commands = 0;
  let highestRound = 1;
  while (clients[0]!.game?.status === 'playing' && commands < 4_000) {
    const game = clients[0]!.game!;
    for (const client of clients) {
      if (client.game?.roomCode !== client.auth.roomCode || client.mine?.roomCode !== client.auth.roomCode
        || client.mine.playerId !== client.auth.playerId || client.mine.revision !== game.revision
        || client.game.revision !== game.revision) fail('decision is not based on an owned paired projection');
    }
    if (game.turnOrder.length !== clients.length || game.players.some(player => player.forfeited)) {
      fail('ordinary full-game roster changed');
    }
    highestRound = Math.max(highestRound, game.roundNumber);
    const actorId = game.phase === 'drafting' ? game.draftPlayerId : game.activePlayerId;
    const actor = actorId ? byId.get(actorId) : null;
    if (!actor?.mine) fail(`missing active client in ${game.phase}`);
    const revision = game.revision;
    if (game.phase === 'drafting') {
      const role = actor.mine.availableRoles[commands % actor.mine.availableRoles.length];
      if (!role) fail('active drafter has no private role choices');
      await accepted(clients, actor, 'citadels:choose-character', {
        role,
        expectedRevision: revision,
      }, 'choose_character');
    } else if (game.phase === 'choose_income') {
      const publicPlayer = game.players.find((player) => player.playerId === actorId)!;
      const hasNewName = actor.mine.hand.some((card) => !publicPlayer.city.some((built) => built.name === card.name));
      await accepted(clients, actor, 'citadels:choose-income', {
        choice: hasNewName ? 'gold' : 'cards',
        expectedRevision: revision,
      }, 'choose_income');
    } else if (game.phase === 'choose_cards') {
      const card = [...actor.mine.drawnCards].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
      if (!card) fail('income chooser has no drawn cards');
      await accepted(clients, actor, 'citadels:keep-district', {
        cardId: card.id,
        expectedRevision: revision,
      }, 'keep_district');
    } else if (game.phase === 'action') {
      const legal = actor.mine.legalBuildCardIds
        .map((cardId) => actor.mine!.hand.find((card) => card.id === cardId)!)
        .sort((a, b) => actor.mine!.effectiveBuildCosts[a.id]! - actor.mine!.effectiveBuildCosts[b.id]! || a.id.localeCompare(b.id))[0];
      if (legal) {
        await accepted(clients, actor, 'citadels:build', {
          cardId: legal.id,
          expectedRevision: revision,
        }, 'build');
      } else {
        await accepted(clients, actor, 'citadels:end-turn', {
          expectedRevision: revision,
        }, 'end_turn');
      }
    } else fail(`unexpected phase ${game.phase}`);
    commands += 1;
  }
  if (commands >= 4_000) fail('full match exceeded command limit');
  await until(
    () => clients.every((client) => client.game?.status === 'game_over' && client.room?.status === 'finished'),
    'game over and finished room',
  );
  const game = clients[0]!.game!;
  if (game.winnerIds.length !== 1 || highestRound < 2 || game.terminationReason !== null) fail('completed match has invalid result');
  return commands;
}

async function runCount(count: number): Promise<number> {
  const host = await api<JoinRoomResponse>('/rooms/create', {
    displayName: 'Ada', gameId: 'citadels', password: 'crown',
  });
  roomCodes.push(host.roomCode);
  const joins: JoinRoomResponse[] = [];
  for (let seat = 1; seat < count; seat++) {
    joins.push(await api<JoinRoomResponse>('/rooms/join', {
      roomCode: host.roomCode, displayName: `Builder ${seat}`, password: 'crown',
    }));
  }
  if (host.room.gameId !== 'citadels' || host.room.maxPlayers !== 7 || !host.room.hasPassword) {
    fail('Citadels room metadata is wrong');
  }
  const clients = await Promise.all([host, ...joins].map(connectClient));
  await until(() => clients.every((client) => client.room?.players.length === count), `${count}-seat lobby`);

  if (!/Only the host/i.test(await rejected(clients[1]!, 'start_game', {}))) fail('non-host start was not rejected');
  if (await rejected(clients[0]!, 'start_game', { extra: true }) !== 'Invalid payload') fail('malformed start was not rejected');
  await startGame(clients);

  const publicJson = JSON.stringify(clients[0]!.game);
  if (publicJson.includes('availableRoles') || publicJson.includes('faceDownDiscard')) fail('public state leaked draft internals');
  for (const client of clients) {
    for (const card of client.mine!.hand) if (publicJson.includes(card.id)) fail('public state leaked a private hand');
  }
  if (clients[0]!.game!.districtPreset !== 'curated-custom-14-v1') fail('custom district preset identifier is wrong');

  const openingRevision = clients[0]!.game!.revision;
  if (await rejected(clients[0]!, 'citadels:power', {
    action: 'redraw_hand', cardIds: {}, expectedRevision: openingRevision,
  }) !== 'Invalid payload') fail('non-array redraw payload was not rejected');
  if (await rejected(clients[0]!, 'citadels:choose-character', {
    role: 'king',
  }) !== 'Invalid payload') fail('missing expectedRevision was not rejected');
  const drafterId = clients[0]!.game!.draftPlayerId!;
  const drafter = clients.find((client) => client.auth.playerId === drafterId)!;
  const staleReason = await rejected(drafter, 'citadels:choose-character', {
    role: drafter.mine!.availableRoles[0], expectedRevision: openingRevision + 1,
  });
  if (!/changed/i.test(staleReason) || clients[0]!.game!.revision !== openingRevision) fail('stale draft mutated state');

  let commands = await playFullMatch(clients);
  await startGame(clients);
  commands += await playFullMatch(clients);

  const reconnectTarget = clients[2]!;
  reconnectTarget.socket.disconnect();
  const restored = await connectClient(reconnectTarget.auth);
  await until(
    () => restored.game?.revision === clients[0]!.game!.revision && restored.mine?.playerId === reconnectTarget.auth.playerId,
    'finished-game reconnect projection',
  );
  restored.socket.disconnect();
  clients.forEach((client) => client.socket.disconnect());
  console.log(`CITADELS ${count}P: full match + full rematch, ${commands} accepted commands.`);
  return commands;
}

async function main(): Promise<void> {
  assert.equal(supabase, null, 'Smoke refuses hosted persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io);
  await app.listen({ host: '127.0.0.1', port: 0 });
  BASE = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let totalCommands = 0;
  try {
    for (let count = 4; count <= 7; count++) totalCommands += await runCount(count);
    console.log(
      `CITADELS SMOKE PASS: password lobby, host/start fencing, privacy, malformed/stale rejection, `
      + `eight full projection-only games at 4–7 seats, rematches and reconnect (${totalCommands} accepted gameplay commands).`,
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    for (const roomCode of roomCodes) roomStore.delete(roomCode);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
