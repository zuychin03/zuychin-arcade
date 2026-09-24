import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { FeedTheKrakenAction, FeedTheKrakenJourney, FeedTheKrakenPrivateState, FeedTheKrakenPublicState, JoinRoomResponse, RoomPublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { roomStore } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { buildFeedTheKrakenResult, isFeedTheKrakenActionPayload, isFeedTheKrakenStartPayload, recoverDisconnectedFeedTheKrakenPlayers } from './socketHandlers.js';
import { forfeitFeedTheKrakenPlayers, initFeedTheKrakenGame, type FeedTheKrakenServerState } from './engine.js';

process.env.JWT_SECRET ??= 'kraken-local-test-only-secret-32-bytes';
interface Client { auth: JoinRoomResponse; socket: Socket; room: RoomPublicState | null; game: FeedTheKrakenPublicState | null; mine: FeedTheKrakenPrivateState | null }
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Kraken socket condition timed out');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out: ${event}`)); }, 5000);
    function receive(value: T) { clearTimeout(timer); resolve(value); }
    socket.once(event, receive);
  });
}
async function harness(count: number, journey: FeedTheKrakenJourney = 'quick') {
  assert.equal(supabase, null, 'Tests refuse hosted persistence');
  const app = Fastify({ logger: false }); const io = new Server(app.server);
  registerRoomRoutes(app, io); registerSocketHandlers(io);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: Client[] = []; let roomCode = '';
  const post = (path: string, body: unknown, token?: string) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  async function attach(auth: JoinRoomResponse) {
    const socket = connect(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    const client: Client = { auth, socket, room: null, game: null, mine: null };
    socket.on('room_updated', value => { client.room = value; }); socket.on('game_state', value => { client.game = value; }); socket.on('private_state', value => { client.mine = value; });
    const connected = once(socket, 'connect'); socket.connect(); await connected;
    socket.emit('request_state'); await until(() => client.room !== null); clients.push(client); return client;
  }
  for (let i = 0; i < count; i++) {
    const response = await post(i === 0 ? '/rooms/create' : '/rooms/join', {
      displayName: `Sailor ${i + 1}`, ...(i === 0 ? { gameId: 'feed_the_kraken', config: { krakenJourney: journey } } : { roomCode }),
    });
    assert.equal(response.status, i === 0 ? 201 : 200);
    const auth = await response.json() as JoinRoomResponse; roomCode = auth.roomCode; await attach(auth);
  }
  assert.equal(roomStore.get(roomCode)!.config.krakenJourney, journey);
  const sync = async (revision: number) => until(() => clients.filter(c => c.socket.connected).every(c => c.game?.revision === revision && c.mine?.revision === revision));
  async function start() {
    const host = clients.find(c => c.socket.connected && c.room?.players.find(p => p.playerId === c.auth.playerId)?.isHost)!;
    const accepted = once<{ revision: number }>(host.socket, 'kraken:action_accepted'); host.socket.emit('start_game', {});
    const ack = await accepted; await sync(ack.revision);
  }
  async function act(client: Client, action: FeedTheKrakenAction) {
    const accepted = once<{ revision: number }>(client.socket, 'kraken:action_accepted');
    client.socket.emit('kraken:action', { expectedRevision: client.game!.revision, windowId: client.game!.windowId, action });
    const ack = await accepted; await sync(ack.revision);
  }
  async function reject(client: Client, event: string, payload: unknown) {
    const rejected = once<{ reason: string }>(client.socket, 'action_rejected'); client.socket.emit(event, payload); return (await rejected).reason;
  }
  async function close() {
    for (const client of clients) client.socket.disconnect(); roomStore.delete(roomCode);
    await new Promise<void>(resolve => io.close(() => resolve())); if (app.server.listening) await app.close();
  }
  return { clients, roomCode, io, url, post, attach, sync, start, act, reject, close };
}

function moveFromFrames(clients: Client[]): { client: Client; action: FeedTheKrakenAction } {
  const client = clients.find(c => c.socket.connected && c.mine?.canAct)!;
  assert.ok(client, 'A connected owner must have an action');
  const game = client.game!; const mine = client.mine!; const target = mine.legalTargetIds[0]!;
  switch (game.phase) {
    case 'priority': return { client, action: { type: 'pass' } };
    case 'appointment': { const lieutenantId = game.effects.forcedLieutenantId ?? target; return { client, action: { type: 'appoint', lieutenantId, navigatorId: mine.legalTargetIds.find(id => id !== lieutenantId)! } }; }
    case 'mutiny': return { client, action: { type: 'bid', guns: mine.minimumBid } };
    case 'tie_veto': return { client, action: { type: 'veto', playerId: game.tieCandidates[0]! } };
    case 'navigation': return { client, action: { type: 'submit_navigation', cardId: mine.navigationCards[0]!.id } };
    case 'navigator': return { client, action: { type: 'navigate', cardId: mine.navigationCards[0]!.id } };
    case 'emergency': return { client, action: { type: 'emergency', playerId: target } };
    case 'map_action': case 'effect_target': return { client, action: { type: 'target', playerId: target } };
    case 'telescope': return { client, action: { type: 'telescope', discard: false } };
    case 'instigator': return { client, action: { type: 'instigator', accept: true } };
    case 'ritual': return { client, action: mine.ritual === 'conversion' ? { type: 'ritual', playerId: target }
      : mine.ritual === 'stash' ? { type: 'ritual', allocations: { [client.auth.playerId]: mine.ritualGunCount } } : { type: 'ritual' } };
    default: throw new Error(`Unexpected ${game.phase}`);
  }
}

test('strict wire shapes reject forged identity, extra keys, invalid choices and bounds', () => {
  assert.equal(isFeedTheKrakenStartPayload(undefined), true); assert.equal(isFeedTheKrakenStartPayload({}), true);
  for (const value of [null, [], { journey: 'long' }]) assert.equal(isFeedTheKrakenStartPayload(value), false);
  const base = { expectedRevision: 2, windowId: 1, action: { type: 'bid', guns: 0 } };
  assert.equal(isFeedTheKrakenActionPayload(base), true);
  for (const value of [null, [], { ...base, actorId: 'other' }, { ...base, expectedRevision: -1 }, { ...base, windowId: Infinity },
    { ...base, action: { type: 'bid', guns: 41 } }, { ...base, action: { type: 'pass', extra: true } },
    { ...base, action: { type: 'character', targets: ['a', 'b', 'c', 'd'] } }, { ...base, action: { type: 'telescope', discard: 'yes' } },
    { ...base, action: { type: 'navigate', cardId: 'card', refuse: true } }, { ...base, action: { type: 'ritual', allocations: { p: 4 } } },
    { ...base, action: { type: 'target', playerId: '__proto__'.repeat(20) } }, { expectedRevision: 2, action: base.action }]) {
    assert.equal(isFeedTheKrakenActionPayload(value), false, JSON.stringify(value));
  }
});

for (const [count, journey] of [[5, 'quick'], [7, 'quick'], [7, 'long'], [11, 'quick'], [11, 'long']] as const) {
  test(`${count}/${journey}: complete HTTP/socket voyage, private authority and rematch`, async () => {
    const h = await harness(count, journey);
    try {
      assert.match(await h.reject(h.clients[1]!, 'start_game', {}), /host/);
      assert.match(await h.reject(h.clients[0]!, 'start_game', { journey }), /Invalid/);
      if (count === 11) assert.equal((await h.post('/rooms/join', { roomCode: h.roomCode, displayName: 'Extra' })).status, 409);
      await h.start();
      assert.equal(h.clients[0]!.game!.journey, journey);
      assert.equal((await h.post('/rooms/join', { roomCode: h.roomCode, displayName: 'Late' })).status, 409);
      let commands = 0;
      while (h.clients[0]!.game!.status === 'playing') {
        assert.ok(commands++ < 1500, 'Voyage must terminate'); const game = h.clients[0]!.game!;
        for (const client of h.clients) {
          assert.equal(client.mine!.viewerPlayerId, client.auth.playerId); assert.equal(client.mine!.roomCode, h.roomCode);
          assert.ok(game.players.every(p => p.faction === null));
          for (const card of client.mine!.navigationCards) assert.ok(!JSON.stringify(game).includes(`"${card.id}"`));
          for (const key of ['draw', 'discard', 'hands', 'submissions', 'rituals', 'originalFaction', 'observations']) assert.equal(key in game, false);
        }
        const move = moveFromFrames(h.clients); await h.act(move.client, move.action);
      }
      const final = h.clients[0]!.game!; assert.ok(final.winner); assert.equal(h.clients[0]!.room!.status, 'finished');
      const state = roomStore.get(h.roomCode)!.game!.state as FeedTheKrakenServerState;
      assert.deepEqual(buildFeedTheKrakenResult(state)!.players.filter(p => p.won).map(p => p.playerId), final.winnerIds);
      await h.start(); const rematch = h.clients[0]!.game!;
      const reset = roomStore.get(h.roomCode)!.game!.state as FeedTheKrakenServerState;
      assert.deepEqual(reset.ritualPendingIds, []); assert.equal(reset.ritualDecision, null); assert.equal(reset.ritualGunCount, 0);
      assert.equal(rematch.revision, final.revision + 1); assert.ok(rematch.windowId > final.windowId);
      assert.match(await h.reject(h.clients[0]!, 'kraken:action', { expectedRevision: final.revision, windowId: final.windowId, action: { type: 'pass' } }), /Stale/);
      assert.equal(h.clients[0]!.game!.revision, rematch.revision);
    } finally { await h.close(); }
  });
}

test('owned reconnect/reload, stale socket and immediate normal leave', async () => {
  const h = await harness(5);
  try {
    await h.start(); const original = h.clients[1]!; const owned = structuredClone(original.mine);
    const replacement = await h.attach(original.auth); await until(() => replacement.mine !== null);
    assert.deepEqual(replacement.mine, owned); await until(() => !original.socket.connected);
    replacement.socket.disconnect(); await until(() => !roomStore.get(h.roomCode)!.players.get(original.auth.playerId)!.isConnected);
    const resumed = await h.attach(original.auth); await until(() => resumed.mine !== null); assert.deepEqual(resumed.mine, owned);
    assert.match(await h.reject(resumed, 'request_state', { playerId: h.clients[0]!.auth.playerId }), /Invalid/);
    assert.equal((await h.post(`/rooms/${h.roomCode}/leave`, {}, resumed.auth.token)).status, 200);
    await until(() => h.clients[0]!.game!.players.find(p => p.playerId === original.auth.playerId)!.forfeited);
    assert.equal(h.clients[0]!.game!.players.find(p => p.playerId === original.auth.playerId)!.departureReason, 'forfeit');
    assert.equal((await h.post(`/rooms/${h.roomCode}/leave`, {}, resumed.auth.token)).status, 403);
  } finally { await h.close(); }
});

test('sealed simultaneous bids accept one window and reject duplicates, spoofing and stale windows', async () => {
  const h = await harness(5);
  try {
    await h.start();
    const initial = h.clients[0]!.game!;
    const outOfTurn = h.clients.find(c => c.auth.playerId !== initial.pendingPlayerId)!;
    assert.ok(await h.reject(outOfTurn, 'kraken:action', { expectedRevision: initial.revision, windowId: initial.windowId, action: { type: 'pass' } }));
    assert.equal((roomStore.get(h.roomCode)!.game!.state as FeedTheKrakenServerState).revision, initial.revision);
    while (h.clients[0]!.game!.phase !== 'mutiny') { const move = moveFromFrames(h.clients); await h.act(move.client, move.action); }
    const game = h.clients[0]!.game!; const bidders = h.clients.filter(c => c.mine!.canAct);
    const payload = { expectedRevision: game.revision, windowId: game.windowId, action: { type: 'bid', guns: 0 } };
    assert.match(await h.reject(bidders[0]!, 'kraken:action', { ...payload, actorId: bidders[1]!.auth.playerId }), /Invalid/);
    assert.match(await h.reject(bidders[0]!, 'kraken:action', { ...payload, windowId: game.windowId - 1 }), /Stale/);
    const acks = bidders.map(c => once<{ revision: number }>(c.socket, 'kraken:action_accepted'));
    for (const c of bidders) c.socket.emit('kraken:action', payload);
    const accepted = await Promise.all(acks); await h.sync(Math.max(...accepted.map(a => a.revision)));
    assert.match(await h.reject(bidders[0]!, 'kraken:action', payload), /Stale/);
  } finally { await h.close(); }
});

test('all overdue seats are forfeited in one revision before any winner is evaluated', async () => {
  const h = await harness(5);
  try {
    await h.start(); const room = roomStore.get(h.roomCode)!; const state = room.game!.state as FeedTheKrakenServerState; const revision = state.revision;
    for (const player of room.players.values()) { player.isConnected = false; player.reconnectDeadlineAt = Date.now() - 1; }
    assert.equal(recoverDisconnectedFeedTheKrakenPlayers(h.io, room), true);
    assert.equal(state.revision, revision + 1); assert.equal(state.status, 'game_over'); assert.equal(state.endReason, 'no_participants');
    assert.deepEqual(state.winnerIds, []); assert.ok(state.order.every(id => state.players[id]!.forfeited)); assert.equal(buildFeedTheKrakenResult(state), null);
  } finally { await h.close(); }
});

test('natural destination with no eligible winning faction never invents a winner', () => {
  const state = initFeedTheKrakenGame(Array.from({ length: 5 }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })), 'RESULT');
  state.status = 'game_over'; state.phase = 'game_over'; state.endReason = 'destination'; state.winner = 'sailor'; state.winnerIds = [];
  const result = buildFeedTheKrakenResult(state)!; assert.equal(result.players.length, 5); assert.ok(result.players.every(p => !p.won && p.score === 0));
});

test('recovery cannot crown an expired faction when the first departure advances navigation', async () => {
  const h = await harness(5);
  try {
    await h.start(); const room = roomStore.get(h.roomCode)!; const state = room.game!.state as FeedTheKrakenServerState;
    const [captain, pending, lieutenant, leader, navigator] = state.order as [string, string, string, string, string];
    for (const id of state.order) state.players[id]!.faction = id === pending || id === navigator ? 'pirate' : id === leader ? 'cult_leader' : 'sailor';
    state.captainId = captain; state.navigationCaptainId = captain; state.lieutenantId = lieutenant; state.navigatorId = navigator;
    state.nodeId = '0,8'; state.phase = 'priority'; state.window = 'during_navigation'; state.navigationResumePhase = 'navigator';
    state.priorityOrder = [pending]; state.priorityIndex = 0; state.pendingPlayerId = pending;
    const red = state.draw.findIndex(card => card.colour === 'red'); state.offered = [state.draw.splice(red, 1)[0]!, state.draw.shift()!];
    for (const id of [pending, navigator]) { const player = room.players.get(id)!; player.isConnected = false; player.reconnectDeadlineAt = Date.now() - 1; }
    assert.equal(recoverDisconnectedFeedTheKrakenPlayers(h.io, room), true);
    assert.equal(state.endReason, 'destination'); assert.equal(state.winner, 'pirate'); assert.deepEqual(state.winnerIds, []);
    assert.ok(state.players[pending]!.forfeited && state.players[navigator]!.forfeited);
    const result = buildFeedTheKrakenResult(state)!; assert.equal(result.players.length, 3); assert.ok(result.players.every(player => !player.won));
  } finally { await h.close(); }
});

test('long journey cannot start with five players and default configuration stays quick', async () => {
  const h = await harness(5, 'long');
  try {
    assert.match(await h.reject(h.clients[0]!, 'start_game', {}), /7.*11/);
    assert.equal(roomStore.get(h.roomCode)!.game, null);
    const response = await h.post('/rooms/create', { gameId: 'feed_the_kraken', displayName: 'Default host' });
    assert.equal(response.status, 201); const auth = await response.json() as JoinRoomResponse;
    assert.equal(roomStore.get(auth.roomCode)!.config.krakenJourney, 'quick'); roomStore.delete(auth.roomCode);
  } finally { await h.close(); }
});

test('batched forfeit rejects an invalid seat without partial mutation', () => {
  const state = initFeedTheKrakenGame(Array.from({ length: 5 }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })), 'BATCH');
  const before = JSON.stringify(state); assert.equal(forfeitFeedTheKrakenPlayers(state, ['p0', 'missing']).ok, false); assert.equal(JSON.stringify(state), before);
});
