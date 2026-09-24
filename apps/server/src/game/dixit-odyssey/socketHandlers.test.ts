import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { DixitAction, DixitPrivateState, DixitPublicState, JoinRoomResponse, RoomPublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { isDixitActionPayload, isDixitStartPayload } from './socketHandlers.js';

process.env.JWT_SECRET ??= 'dixit-local-test-only-secret-32-bytes';

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: DixitPublicState | null;
  mine: DixitPrivateState | null;
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Dixit socket condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out: ${event}`)); }, 5000);
    function receive(value: T) { clearTimeout(timer); resolve(value); }
    socket.once(event, receive);
  });
}

async function harness(count: number) {
  assert.equal(supabase, null, 'Tests refuse hosted persistence');
  const app = Fastify({ logger: false });
  const io = new Server(app.server);
  registerRoomRoutes(app, io);
  registerSocketHandlers(io);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  let roomCode = '';
  const post = (path: string, body: unknown, token?: string) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  async function attach(auth: JoinRoomResponse): Promise<Client> {
    const socket = connect(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    const client: Client = { auth, socket, room: null, game: null, mine: null };
    socket.on('room_updated', value => { client.room = value; });
    socket.on('game_state', value => { client.game = value; });
    socket.on('private_state', value => { client.mine = value; });
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    socket.emit('request_state');
    await until(() => client.room !== null);
    clients.push(client);
    return client;
  }
  for (let i = 0; i < count; i++) {
    const response = await post(i === 0 ? '/rooms/create' : '/rooms/join', {
      displayName: `Dreamer ${i + 1}`, ...(i === 0 ? { gameId: 'dixit_odyssey' } : { roomCode }),
    });
    assert.equal(response.status, i === 0 ? 201 : 200);
    const auth = await response.json() as JoinRoomResponse;
    roomCode = auth.roomCode;
    await attach(auth);
  }
  const sync = async (revision: number) => until(() => clients.filter(c => c.socket.connected).every(c =>
    c.game?.revision === revision && c.mine?.revision === revision));
  async function start() {
    const host = clients.find(c => c.socket.connected && c.room?.players.find(p => p.playerId === c.auth.playerId)?.isHost)!;
    const accepted = once<{ revision: number }>(host.socket, 'dixit:action_accepted');
    host.socket.emit('start_game', {});
    const ack = await accepted;
    await sync(ack.revision);
  }
  async function act(client: Client, action: DixitAction) {
    const accepted = once<{ revision: number }>(client.socket, 'dixit:action_accepted');
    client.socket.emit('dixit:action', { expectedRevision: client.game!.revision, roundNumber: client.game!.roundNumber, action });
    const ack = await accepted;
    await sync(ack.revision);
  }
  async function reject(client: Client, event: string, payload: unknown) {
    const rejected = once<{ reason: string }>(client.socket, 'action_rejected');
    client.socket.emit(event, payload);
    return (await rejected).reason;
  }
  async function close() {
    for (const client of clients) client.socket.disconnect();
    roomStore.delete(roomCode);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (app.server.listening) await app.close();
  }
  return { clients, roomCode, io, post, attach, sync, start, act, reject, close };
}

test('wire payloads reject forged identity, extra keys and unbounded selections', () => {
  assert.equal(isDixitStartPayload(undefined), true);
  assert.equal(isDixitStartPayload({}), true);
  for (const value of [null, [], { actor: 'other' }]) assert.equal(isDixitStartPayload(value), false);
  const base = { expectedRevision: 1, roundNumber: 1, action: { type: 'vote', slots: [1, 1] } };
  assert.equal(isDixitActionPayload(base), true);
  for (const value of [
    null, [], { ...base, playerId: 'other' }, { ...base, roundNumber: 0 }, { ...base, expectedRevision: Infinity },
    { ...base, action: { type: 'vote', slots: [1, 13] } },
    { ...base, action: { type: 'submit', cardIds: ['dream-01', 'dream-01'] } },
    { ...base, action: { type: 'clue', cardId: 'dream-01', clue: 'x'.repeat(241) } },
    { ...base, action: { type: 'ready', hidden: true } },
  ]) assert.equal(isDixitActionPayload(value), false);
});

for (const count of [3, 10, 12]) test(`${count}-player complete HTTP/socket game and rematch use only authorised frames`, async () => {
  const h = await harness(count);
  try {
    assert.match(await h.reject(h.clients[1]!, 'start_game', {}), /host/);
    if (count === 12) {
      const full = await h.post('/rooms/join', { roomCode: h.roomCode, displayName: 'Extra' });
      assert.equal(full.status, 409);
    }
    await h.start();
    let commands = 0;
    while (h.clients[0]!.game!.status === 'playing') {
      assert.ok(commands++ < 3000, 'full game failed to terminate');
      const game = h.clients[0]!.game!;
      for (const client of h.clients) {
        assert.equal(client.mine!.playerId, client.auth.playerId);
        assert.equal(client.mine!.roomCode, h.roomCode);
        assert.equal(client.mine!.revision, game.revision);
        for (const card of client.mine!.hand) assert.ok(!JSON.stringify(game).includes(`"${card}"`));
      }
      if (game.phase === 'clue') {
        const actor = h.clients.find(c => c.auth.playerId === game.storytellerId) ?? h.clients[0]!;
        await h.act(actor, { type: 'clue', cardId: actor.mine!.hand[0]!, clue: `Shared dream ${game.roundNumber}` });
      } else if (game.phase === 'submit') {
        const actor = h.clients.find(c => !game.players.find(p => p.playerId === c.auth.playerId)!.submitted)!;
        await h.act(actor, { type: 'submit', cardIds: actor.mine!.hand.slice(0, actor.mine!.submissionCount) });
      } else if (game.phase === 'vote') {
        const actor = h.clients.find(c => c.auth.playerId !== game.storytellerId && !game.players.find(p => p.playerId === c.auth.playerId)!.voted)!;
        const legal = game.table.filter(card => !actor.mine!.submittedCardIds.includes(card.cardId));
        const slot = legal[(commands + game.roundNumber) % legal.length]!.slot;
        await h.act(actor, { type: 'vote', slots: [slot, slot] });
      } else {
        const actor = h.clients.find(c => !game.players.find(p => p.playerId === c.auth.playerId)!.ready)!;
        await h.act(actor, { type: 'ready' });
      }
    }
    const final = h.clients[0]!.game!;
    assert.ok(final.winnerIds.length > 0);
    assert.equal(h.clients[0]!.room!.status, 'finished');
    await h.start();
    assert.equal(h.clients[0]!.game!.revision, final.revision + 1);
    assert.equal(h.clients[0]!.game!.roundNumber, 1);
    assert.equal(h.clients[0]!.game!.phase, 'clue');
    assert.ok(h.clients[0]!.game!.players.every(p => p.score === 0));
  } finally { await h.close(); }
});

test('reconnect restores only the owned hand and explicit leave forfeits immediately', async () => {
  const h = await harness(4);
  try {
    await h.start();
    const original = h.clients[1]!;
    const hand = [...original.mine!.hand];
    original.socket.disconnect();
    await until(() => !roomStore.get(h.roomCode)!.players.get(original.auth.playerId)!.isConnected);
    const resumed = await h.attach(original.auth);
    await until(() => resumed.mine !== null);
    assert.deepEqual(resumed.mine!.hand, hand);
    const response = await h.post(`/rooms/${h.roomCode}/leave`, {}, resumed.auth.token);
    assert.equal(response.status, 200);
    await until(() => h.clients[0]!.game!.players.find(p => p.playerId === resumed.auth.playerId)!.forfeited);
    assert.equal(h.clients[0]!.game!.players.find(p => p.playerId === resumed.auth.playerId)!.handCount, 0);
    assert.equal(h.clients[0]!.game!.phase, 'clue');
    assert.equal(h.clients[0]!.mine!.hand.length, 7);
    const denied = await h.post(`/rooms/${h.roomCode}/leave`, {}, resumed.auth.token);
    assert.equal(denied.status, 403);
  } finally { await h.close(); }
});

test('overdue disconnected seats are batched before winner/result handling', async () => {
  const h = await harness(4);
  try {
    await h.start();
    const room = roomStore.get(h.roomCode)!;
    for (const client of h.clients.slice(1, 3)) markPlayerDisconnected(h.io, room, client.auth.playerId, client.socket.id!, 0, true);
    await until(() => h.clients[0]!.game!.status === 'game_over');
    assert.equal(h.clients[0]!.game!.terminationReason, 'not_enough_players');
    assert.deepEqual(h.clients[0]!.game!.winnerIds, []);
    assert.equal(h.clients[0]!.room!.status, 'finished');
  } finally { await h.close(); }
});
