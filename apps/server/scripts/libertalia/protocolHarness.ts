import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import type { JoinRoomResponse, LibertaliaPrivateState, LibertaliaPublicState, RoomPublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { chooseProjectionCommand } from './projectionDriver.js';

process.env.JWT_SECRET ??= 'libertalia-isolated-test-secret-32-bytes';

export interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: LibertaliaPublicState | null;
  mine: LibertaliaPrivateState | null;
  acks: { action: string; revision: number }[];
  rejections: string[];
}

export async function until(check: () => boolean, label = 'condition', timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function harness() {
  assert.equal(supabase, null, 'Isolated tests refuse hosted persistence');
  const app = Fastify({ logger: false });
  const server = new Server(app.server);
  registerRoomRoutes(app, server);
  registerSocketHandlers(server, {
    events: { limit: 100_000, windowMs: 10_000 },
    reactions: { limit: 100_000, windowMs: 10_000 },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  const rooms = new Set<string>();
  async function request(path: string, body: unknown, token?: string) {
    return fetch(`${url}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  }
  async function create(name = 'Astra Host', password?: string) {
    const response = await request('/rooms/create', { gameId: 'libertalia', displayName: name, ...(password === undefined ? {} : { password }) });
    assert.equal(response.status, 201, `Room creation returned ${response.status}`);
    const auth = await response.json() as JoinRoomResponse;
    rooms.add(auth.roomCode);
    return auth;
  }
  async function join(roomCode: string, name: string, password?: string) {
    const response = await request('/rooms/join', { roomCode, displayName: name, ...(password === undefined ? {} : { password }) });
    assert.equal(response.status, 200, `Room join returned ${response.status}`);
    return await response.json() as JoinRoomResponse;
  }
  async function connect(auth: JoinRoomResponse): Promise<Client> {
    const socket = io(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    sockets.push(socket);
    const client: Client = { auth, socket, room: null, game: null, mine: null, acks: [], rejections: [] };
    socket.on('room_updated', (value) => { client.room = value; });
    socket.on('game_state', (value) => { client.game = value; });
    socket.on('private_state', (value) => { client.mine = value; });
    socket.on('libertalia:action_accepted', (value) => { client.acks.push(value); });
    socket.on('action_rejected', (value) => { client.rejections.push(value.reason); });
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timeout')), 5_000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
    socket.connect();
    await connected;
    socket.emit('request_state');
    await until(() => client.room !== null, 'room projection');
    return client;
  }
  async function group(count: number, password?: string) {
    const first = await create('Astra Host', password);
    const clients = [await connect(first)];
    for (let i = 1; i < count; i += 1) clients.push(await connect(await join(first.roomCode, `Astra ${i + 1}`, password)));
    return clients;
  }
  async function close() {
    for (const socket of sockets) socket.disconnect();
    for (const code of rooms) roomStore.delete(code);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
  return { app, server, url, rooms, request, create, join, connect, group, close };
}

export async function accepted(client: Client, event: string, payload: unknown, action: string) {
  const before = client.acks.length;
  const rejects = client.rejections.length;
  client.socket.emit(event, payload);
  await until(() => client.acks.length > before || client.rejections.length > rejects, `${event} acknowledgement`);
  assert.equal(client.rejections.length, rejects, client.rejections.at(-1));
  const ack = client.acks[before]!;
  assert.equal(ack.action, action);
  assert.ok(Number.isSafeInteger(ack.revision));
  return ack;
}

export async function rejected(client: Client, event: string, payload: unknown) {
  const before = client.rejections.length;
  const acks = client.acks.length;
  client.socket.emit(event, payload);
  await until(() => client.rejections.length > before || client.acks.length > acks, `${event} rejection`);
  assert.equal(client.acks.length, acks, 'Rejected action must not acknowledge success');
  return client.rejections[before]!;
}

export async function paired(clients: Client[], revision: number) {
  await until(() => clients.every((client) => client.game?.revision === revision && client.mine?.revision === revision), `paired revision ${revision}`);
}

export async function start(clients: Client[]) {
  const previous = clients[0]!.game?.revision;
  const ack = await accepted(clients[0]!, 'start_game', {}, 'start');
  assert.equal(ack.revision, previous === undefined ? 0 : previous + 1);
  await paired(clients, ack.revision);
  return ack;
}

export function assertPrivacy(client: Client): void {
  const game = client.game!;
  const mine = client.mine!;
  assert.equal(game.roomCode, client.auth.roomCode);
  assert.equal(mine.roomCode, client.auth.roomCode);
  assert.equal(mine.playerId, client.auth.playerId);
  assert.equal(mine.revision, game.revision);
  for (const player of game.players) {
    for (const field of ['hand', 'graveyard', 'selectedRank', 'keptRanks']) assert.ok(!Object.hasOwn(player, field));
  }
  for (const field of ['pendingChoice', 'queue', 'undealtCrew', 'rng']) assert.ok(!Object.hasOwn(game, field));
  if (mine.pendingChoice) assert.equal(mine.pendingChoice.playerId, client.auth.playerId);
  if (game.pendingPlayerId !== client.auth.playerId) assert.equal(mine.pendingChoice, null);
}

export async function step(clients: Client[]): Promise<boolean> {
  const revision = clients[0]!.game!.revision;
  await paired(clients, revision);
  for (const client of clients) {
    assertPrivacy(client);
    const command = chooseProjectionCommand(client.game!, client.mine!);
    if (!command) continue;
    const otherCounts = clients.map((peer) => peer.acks.length);
    const ack = await accepted(client, command.event, command.payload, command.action);
    assert.ok(ack.revision > revision);
    await paired(clients, ack.revision);
    clients.forEach((peer, index) => assert.equal(peer.acks.length, otherCounts[index]! + Number(peer === client), 'Ack leaked to a peer'));
    return true;
  }
  return false;
}

export async function complete(clients: Client[]): Promise<number> {
  let count = 0;
  while (clients[0]!.game!.status === 'playing') {
    assert.ok(count < 3_000, 'Full match command bound');
    assert.ok(await step(clients), `No projected decision at ${clients[0]!.game!.revision}/${clients[0]!.game!.phase}`);
    count += 1;
  }
  assert.equal(clients[0]!.game!.status, 'game_over');
  assert.ok(clients[0]!.game!.winnerPlayerIds.length > 0);
  await until(() => clients.every((client) => client.room?.status === 'finished'), 'finished room');
  return count;
}
