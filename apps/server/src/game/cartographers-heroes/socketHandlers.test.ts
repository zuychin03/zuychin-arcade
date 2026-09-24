import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import {
  CARTOGRAPHERS_CARD_BY_ID, type CartographersAssignment, type CartographersCard,
  type CartographersHeroesPrivateState, type CartographersHeroesPublicState,
  type CartographersPlacementPayload, type JoinRoomResponse, type RoomPublicState,
} from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { cartographersGorgonTargets, cartographersNeighbours, cartographersOccupied, legalCartographersPlacements, transformCartographersShape } from './engine.js';
import { isCartographersHeroesStartPayload, isCartographersPlacementPayload, isCartographersDestructionPayload } from './socketHandlers.js';

process.env.JWT_SECRET ??= 'cartographers-local-test-secret-32-bytes';
interface Client {
  auth: JoinRoomResponse; socket: Socket; room: RoomPublicState | null;
  game: CartographersHeroesPublicState | null; mine: CartographersHeroesPrivateState | null;
  bytes: number; frames: number;
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Cartographers socket condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out: ${event}`)); }, 15000);
    function receive(value: T) { clearTimeout(timer); resolve(value); }
    socket.once(event, receive);
  });
}
async function harness(count: number) {
  assert.equal(supabase, null, 'Tests refuse hosted persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server);
  registerRoomRoutes(app, io); registerSocketHandlers(io);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  let roomCode = '';
  const post = (path: string, body: unknown, token?: string) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  async function attach(auth: JoinRoomResponse): Promise<Client> {
    const socket = connect(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    const client: Client = { auth, socket, room: null, game: null, mine: null, bytes: 0, frames: 0 };
    socket.on('room_updated', value => { client.room = value; });
    socket.on('game_state', value => { client.game = value; client.bytes += Buffer.byteLength(JSON.stringify(value)); client.frames++; });
    socket.on('private_state', value => { client.mine = value; client.bytes += Buffer.byteLength(JSON.stringify(value)); client.frames++; });
    const connected = once(socket, 'connect'); socket.connect(); await connected;
    socket.emit('request_state'); await until(() => client.room !== null);
    clients.push(client); return client;
  }
  const sync = async (revision: number) => until(() => clients.filter(c => c.socket.connected).every(c =>
    (c.game?.revision ?? -1) >= revision && c.mine?.revision === c.game?.revision));
  async function send(client: Client, event: string, payload: unknown) {
    const accepted = once<{ revision: number }>(client.socket, 'cartographers:action_accepted');
    client.socket.emit(event, payload); return accepted;
  }
  async function start() {
    const host = clients.find(c => c.socket.connected && c.room?.players.find(p => p.playerId === c.auth.playerId)?.isHost)!;
    await sync((await send(host, 'start_game', {})).revision);
  }
  async function reject(client: Client, event: string, payload: unknown) {
    const rejected = once<{ reason: string }>(client.socket, 'action_rejected');
    client.socket.emit(event, payload); return (await rejected).reason;
  }
  async function close() {
    for (const client of clients) client.socket.disconnect();
    roomStore.delete(roomCode);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
  try {
    for (let i = 0; i < count; i++) {
      const response = await post(i === 0 ? '/rooms/create' : '/rooms/join', {
        displayName: `Mapper ${i + 1}`, ...(i === 0 ? { gameId: 'cartographers_heroes', config: { cartographersMapSide: count === 1 ? 'C' : 'D' } } : { roomCode }),
      });
      assert.equal(response.status, i === 0 ? 201 : 200);
      const auth = await response.json() as JoinRoomResponse;
      roomCode = auth.roomCode; await attach(auth);
    }
  } catch (error) { await close(); throw error; }
  return { clients, roomCode, io, post, attach, sync, start, send, reject, close };
}
function move(client: Client, assignment: CartographersAssignment): { event: string; payload: unknown } {
  const game = client.game!;
  const base = { targetPlayerId: assignment.targetPlayerId, turnId: game.turnId, expectedRevision: game.revision, submissionToken: assignment.submissionToken };
  const map = assignment.map;
  if (game.phase === 'season_effect') {
    const index = map.cells.flatMap((cell, i) => cell.terrain === 'monster' && cell.monster === 'troll' ? cartographersNeighbours(i) : []).find(i => !cartographersOccupied(map.cells[i]!));
    assert.notEqual(index, undefined);
    return { event: 'cartographers:destroy', payload: { ...base, position: { x: index! % 11, y: Math.floor(index! / 11) } } };
  }
  const card = CARTOGRAPHERS_CARD_BY_ID[game.currentCardId!]!;
  const fallback: CartographersCard = { id: 'fallback', name: 'Fallback', kind: 'explore', time: 0, terrains: ['forest'], options: [{ cells: [{ x: 0, y: 0 }], coin: false }] };
  const legal = assignment.fixedPlacement ? { ...assignment.fixedPlacement, optionIndex: 0 } : legalCartographersPlacements(map, assignment.fallback ? fallback : card, true)[0];
  assert.ok(legal);
  const terrain = card.kind === 'ambush' ? 'monster' : assignment.fallback ? 'forest' : card.kind === 'hero' ? 'hero' : card.terrains[0]!;
  const payload: CartographersPlacementPayload = { ...base, ...legal, terrain };
  if (card.kind === 'ambush' && card.monster === 'gorgon' && !assignment.fallback) {
    const preview = structuredClone(map);
    for (const point of transformCartographersShape(card.cells, payload)) {
      const index = point.y * 11 + point.x, destroyed = preview.attackCells.includes(index);
      preview.cells[index] = { terrain: destroyed ? null : 'monster', monster: 'gorgon', destroyed, wasteland: false };
    }
    const target = cartographersGorgonTargets(preview)[0];
    if (target) payload.destroyTarget = target;
  }
  return { event: 'cartographers:place', payload };
}
async function round(h: Awaited<ReturnType<typeof harness>>) {
  const commands = h.clients.filter(c => c.socket.connected).flatMap(client => client.mine!.assignments.map(assignment => ({ client, ...move(client, assignment) })));
  assert.ok(commands.length > 0);
  const revisions = await Promise.all(commands.map(async ({ client, event, payload }) => (await h.send(client, event, payload)).revision));
  await h.sync(Math.max(...revisions));
  return commands.length;
}

test('strict wire validators reject identity injection, malformed geometry and start options', () => {
  assert.equal(isCartographersHeroesStartPayload(undefined), true);
  assert.equal(isCartographersHeroesStartPayload({}), true);
  for (const value of [null, [], { mapSide: 'D' }, { playerId: 'other' }]) assert.equal(isCartographersHeroesStartPayload(value), false);
  const base = { turnId: 1, expectedRevision: 0, submissionToken: '1:p', targetPlayerId: 'p', anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false, optionIndex: 0, terrain: 'forest' };
  assert.equal(isCartographersPlacementPayload(base), true);
  for (const value of [null, [], { ...base, playerId: 'other' }, { ...base, turnId: 0 }, { ...base, expectedRevision: Infinity }, { ...base, anchor: { x: 11, y: 0 } }, { ...base, rotation: 45 }, { ...base, mirrored: 1 }, { ...base, optionIndex: 2 }, { ...base, terrain: 'mountain' }, { ...base, destroyTarget: { x: 0, y: 0, extra: true } }]) assert.equal(isCartographersPlacementPayload(value), false);
  const destruction = { turnId: 1, expectedRevision: 0, submissionToken: '1:p', targetPlayerId: 'p', position: { x: 0, y: 0 } };
  assert.equal(isCartographersDestructionPayload(destruction), true);
  assert.equal(isCartographersDestructionPayload({ ...destruction, actorId: 'other' }), false);
});

for (const count of [1, 10, 100]) test(`${count}-player complete HTTP/socket match and rematch from authorised frames`, async t => {
  const h = await harness(count);
  try {
    if (count > 1) assert.match(await h.reject(h.clients[1]!, 'start_game', {}), /host/);
    if (count === 100) assert.equal((await h.post('/rooms/join', { roomCode: h.roomCode, displayName: 'Extra' })).status, 409);
    await h.start();
    assert.equal(h.clients[0]!.game!.mapSide, count === 1 ? 'C' : 'D');
    const oldMove = move(h.clients[0]!, h.clients[0]!.mine!.assignments[0]!);
    assert.match(await h.reject(h.clients[0]!, 'cartographers:inspect_map', { targetPlayerId: h.clients[0]!.auth.playerId, expectedRevision: h.clients[0]!.game!.revision }), /not available/);
    let commands = 0, turns = 0;
    while (h.clients[0]!.game!.status === 'playing') {
      assert.ok(turns++ < 150);
      const game = h.clients[0]!.game!;
      assert.equal('maps' in game, false); assert.equal('deck' in game, false);
      for (const client of h.clients) {
        assert.equal(client.mine!.playerId, client.auth.playerId);
        assert.equal(client.mine!.revision, game.revision);
        assert.deepEqual(client.mine!.resultMaps, []);
        assert.ok(client.mine!.assignments.length <= 1);
      }
      commands += await round(h);
    }
    const final = h.clients[0]!.game!;
    assert.equal(final.endReason, 'natural'); assert.ok(final.winnerIds.length > 0);
    assert.ok(final.players.every(p => p.scores.length === 4));
    assert.equal(h.clients[0]!.room!.status, 'finished');
    const viewer = h.clients[0]!, target = h.clients.at(-1)!;
    assert.match(await h.reject(viewer, 'cartographers:inspect_map', { targetPlayerId: 'unknown-seat', expectedRevision: final.revision }), /not available/);
    assert.match(await h.reject(viewer, 'cartographers:inspect_map', { targetPlayerId: target.auth.playerId, expectedRevision: final.revision, playerId: target.auth.playerId }), /Invalid/);
    await h.send(viewer, 'cartographers:inspect_map', { targetPlayerId: target.auth.playerId, expectedRevision: final.revision });
    await until(() => viewer.mine!.resultMaps.length === 1);
    assert.equal(viewer.mine!.playerId, viewer.auth.playerId);
    assert.equal(viewer.mine!.resultMaps[0]!.playerId, target.auth.playerId);
    assert.deepEqual(viewer.mine!.resultMaps[0]!.map, target.mine!.map);
    if (count > 1) assert.deepEqual(target.mine!.resultMaps, []);
    await h.start();
    assert.equal(viewer.game!.revision, final.revision + 1);
    assert.equal(viewer.game!.season, 0); assert.deepEqual(viewer.mine!.resultMaps, []);
    assert.match(await h.reject(viewer, oldMove.event, oldMove.payload), /revision|stale/i);
    t.diagnostic(JSON.stringify({ players: count, turns, commands, receivedStateFrames: h.clients.reduce((sum, c) => sum + c.frames, 0), receivedStateJsonBytes: h.clients.reduce((sum, c) => sum + c.bytes, 0) }));
  } finally { await h.close(); }
});

test('same-turn concurrency accepts separate seats but blocks duplicates, forged targets and stale tokens', async () => {
  const h = await harness(3);
  try {
    await h.start();
    const actor = h.clients[0]!, other = h.clients[1]!;
    const action = move(actor, actor.mine!.assignments[0]!);
    assert.match(await h.reject(other, action.event, action.payload), /assigned/i);
    assert.match(await h.reject(actor, action.event, { ...(action.payload as object), submissionToken: 'forged-token' }), /stale|assigned/i);
    const rejected = once<{ reason: string }>(actor.socket, 'action_rejected');
    const accepted = h.send(actor, action.event, action.payload);
    actor.socket.emit(action.event, action.payload);
    const ack = await accepted; assert.match((await rejected).reason, /submitted/i);
    await h.sync(ack.revision);
    assert.deepEqual(actor.mine!.assignments, []);
    assert.match(await h.reject(actor, 'request_state', { playerId: other.auth.playerId }), /Invalid/);
    await round(h);
    assert.match(await h.reject(actor, action.event, action.payload), /turn|revision|stale/i);
  } finally { await h.close(); }
});

for (const submitted of [false, true]) test(`departing ambush drawer reroutes work while target's previous assignment submitted=${submitted}`, async () => {
  const h = await harness(4);
  try {
    await h.start();
    let turns = 0;
    while (CARTOGRAPHERS_CARD_BY_ID[h.clients[0]!.game!.currentCardId!]?.kind !== 'ambush') {
      assert.ok(turns++ < 100); await round(h);
    }
    const drawer = h.clients[0]!;
    const targetId = drawer.mine!.assignments[0]!.targetPlayerId;
    const target = h.clients.find(c => c.auth.playerId === targetId)!;
    assert.notEqual(target, drawer);
    const ownTask = target.mine!.assignments[0]!;
    const first = move(target, ownTask);
    if (submitted) {
      await h.sync((await h.send(target, first.event, first.payload)).revision);
      assert.deepEqual(target.mine!.assignments, []);
    }
    assert.equal((await h.post(`/rooms/${h.roomCode}/leave`, {}, drawer.auth.token)).status, 200);
    await until(() => target.mine!.assignments.some(task => task.targetPlayerId === targetId));
    assert.equal(target.mine!.assignments.length, submitted ? 1 : 2);
    const rerouted = move(target, target.mine!.assignments.find(task => task.targetPlayerId === targetId)!);
    await h.sync((await h.send(target, rerouted.event, rerouted.payload)).revision);
    assert.equal(target.game!.players.find(p => p.playerId === drawer.auth.playerId)!.forfeited, true);
    if (!submitted) await h.sync((await h.send(target, first.event, first.payload)).revision);
    assert.match(await h.reject(target, first.event, first.payload), /submitted|stale/i);
  } finally { await h.close(); }
});

test('reconnect restores owned map, replaces old socket, and explicit leave forfeits immediately', async () => {
  const h = await harness(4);
  try {
    await h.start(); await round(h);
    const original = h.clients[1]!, map = structuredClone(original.mine!.map);
    const resumed = await h.attach(original.auth);
    await until(() => resumed.mine !== null && !original.socket.connected);
    assert.deepEqual(resumed.mine!.map, map);
    assert.equal(resumed.mine!.playerId, original.auth.playerId);
    resumed.socket.disconnect();
    await until(() => !roomStore.get(h.roomCode)!.players.get(original.auth.playerId)!.isConnected);
    const recovered = await h.attach(original.auth);
    await until(() => recovered.mine !== null);
    assert.deepEqual(recovered.mine!.map, map);
    const response = await h.post(`/rooms/${h.roomCode}/leave`, {}, recovered.auth.token);
    assert.equal(response.status, 200);
    await until(() => h.clients[0]!.game!.players.find(p => p.playerId === recovered.auth.playerId)!.forfeited);
    assert.equal(h.clients[0]!.game!.status, 'playing');
    assert.equal((await h.post(`/rooms/${h.roomCode}/leave`, {}, recovered.auth.token)).status, 403);
  } finally { await h.close(); }
});

for (const survivors of [0, 1]) test(`batched grace expiry leaves ${survivors} survivor without a phantom winner`, async () => {
  const h = await harness(4);
  try {
    await h.start();
    const room = roomStore.get(h.roomCode)!;
    for (const client of h.clients.slice(survivors)) markPlayerDisconnected(h.io, room, client.auth.playerId, client.socket.id!, 0, true);
    await until(() => room.game?.id === 'cartographers_heroes' && room.game.state.status === 'game_over');
    assert.equal(room.game!.id, 'cartographers_heroes');
    if (room.game!.id !== 'cartographers_heroes') throw new Error('Wrong game');
    assert.deepEqual(room.game!.state.winnerIds, survivors ? [h.clients[0]!.auth.playerId] : []);
    assert.equal(room.game!.state.endReason, survivors ? 'forfeit' : 'abandoned');
    assert.equal(room.status, 'finished');
  } finally { await h.close(); }
});
