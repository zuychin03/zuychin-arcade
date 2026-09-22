import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { JoinRoomResponse, NotAloneActionAccepted, NotAlonePrivateState, NotAlonePublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { chooseProjectionCommand } from './projectionDriver.js';

process.env.JWT_SECRET ??= 'not-alone-smoke-only-secret-32-bytes';
interface Client { auth: JoinRoomResponse; socket: Socket; game: NotAlonePublicState | null; mine: NotAlonePrivateState | null }
const clients: Client[] = [];
const roomCodes: string[] = [];
let base = '';

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for paired state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function post(path: string, body: unknown): Promise<JoinRoomResponse> {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, path + ': ' + response.status);
  return response.json() as Promise<JoinRoomResponse>;
}
async function attach(auth: JoinRoomResponse): Promise<Client> {
  const socket = connect(base, { auth: { token: auth.token }, forceNew: true, reconnection: false, transports: ['websocket'] });
  const client: Client = { auth, socket, game: null, mine: null };
  clients.push(client);
  socket.on('game_state', (game: NotAlonePublicState) => { client.game = game; });
  socket.on('private_state', (mine: NotAlonePrivateState) => { client.mine = mine; });
  await until(() => socket.connected);
  socket.emit('request_state');
  return client;
}
function command(client: Client, event: string, payload: unknown, action: NotAloneActionAccepted['action']): Promise<number> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('notalone:action_accepted', accepted);
      client.socket.off('action_rejected', rejected);
    };
    const accepted = (ack: NotAloneActionAccepted) => {
      cleanup();
      if (ack.action !== action) reject(new Error('Wrong acknowledgement'));
      else resolve(ack.revision);
    };
    const rejected = (value: { reason: string }) => { cleanup(); reject(new Error(event + ': ' + value.reason)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out: ' + event)); }, 8_000);
    client.socket.on('notalone:action_accepted', accepted);
    client.socket.on('action_rejected', rejected);
    client.socket.emit(event, payload);
  });
}
async function paired(seats: Client[], revision: number): Promise<void> {
  await until(() => seats.every((seat) => seat.game?.revision === revision && seat.mine?.revision === revision));
  for (const seat of seats) {
    assert.equal(seat.game!.viewerPlayerId, seat.auth.playerId);
    assert.equal(seat.game!.roomCode, seat.auth.roomCode);
    assert.equal(seat.mine!.playerId, seat.auth.playerId);
    assert.equal(seat.mine!.roomCode, seat.auth.roomCode);
    if (seat.mine!.role === 'hunted') assert.deepEqual(seat.mine!.huntHand, []);
  }
}
async function fullGame(seats: Client[]): Promise<number> {
  let count = 0;
  while (seats[0]!.game!.status === 'playing') {
    assert.ok(count < 4_000);
    const revision = seats[0]!.game!.revision;
    await paired(seats, revision);
    let acted = false;
    for (const seat of seats) {
      const choice = chooseProjectionCommand(seat.game!, seat.mine!);
      if (!choice) continue;
      const next = await command(seat, choice.event, choice.payload, choice.action);
      assert.ok(next > revision);
      await paired(seats, next);
      count++;
      acted = true;
      break;
    }
    assert.ok(acted, 'No owned legal action: ' + seats[0]!.game!.phase);
  }
  assert.equal(seats[0]!.game!.endReason, 'track');
  assert.notEqual(seats[0]!.game!.winner, null);
  assert.ok(seats[0]!.game!.players.every((player) => !player.forfeited));
  return count;
}
async function runCount(count: number): Promise<number> {
  const host = await post('/rooms/create', { displayName: 'Creature', gameId: 'not_alone', password: ' signal ' });
  roomCodes.push(host.roomCode);
  const seats = [await attach(host)];
  for (let index = 1; index < count; index++) seats.push(await attach(await post('/rooms/join', {
    displayName: 'Hunted ' + index, roomCode: host.roomCode, password: ' signal ',
  })));
  assert.equal(host.room.maxPlayers, 7);
  assert.equal(host.room.hasPassword, true);
  let total = 0;
  for (let game = 0; game < 2; game++) {
    const floor = seats[0]!.game ? seats[0]!.game!.revision + 1 : 0;
    const revision = await command(seats[0]!, 'start_game', { boardFace: count % 2 ? 'alternating' : 'continuous' }, 'start');
    assert.equal(revision, floor);
    await paired(seats, revision);
    assert.equal(seats[0]!.mine!.role, 'creature');
    total += await fullGame(seats);
  }
  const old = seats[1]!;
  const before = structuredClone(old.mine);
  old.socket.disconnect();
  const restored = await attach(old.auth);
  await paired([restored], before!.revision);
  assert.deepEqual(restored.mine, before);
  restored.socket.disconnect();
  seats.forEach((seat) => seat.socket.disconnect());
  console.log('NOT ALONE ' + count + 'P: full match + full rematch, ' + total + ' commands.');
  return total;
}
async function main(): Promise<void> {
  assert.equal(supabase, null, 'Smoke refuses hosted persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server, { cors: { origin: '*' } });
  registerRoomRoutes(app, io);
  registerSocketHandlers(io, { events: { limit: 10_000, windowMs: 10_000 }, reactions: { limit: 10_000, windowMs: 5_000 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port;
  try {
    let total = 0;
    for (let count = 2; count <= 7; count++) total += await runCount(count);
    console.log('NOT ALONE SMOKE PASS: twelve projection-only games at 2–7 seats, both boards, HTTP password lifecycle and reconnect, ' + total + ' commands.');
  } finally {
    clients.forEach((client) => client.socket.disconnect());
    roomCodes.forEach((code) => roomStore.delete(code));
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
