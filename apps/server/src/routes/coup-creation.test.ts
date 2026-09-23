import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import type { JoinRoomResponse, RoomPublicState } from '@zuychin-arcade/types';
import { registerRoomRoutes } from './room.js';
import { roomStore } from '../store/RoomStore.js';
import { supabase } from '../lib/supabase.js';

process.env.JWT_SECRET ??= 'test-only-reformation-secret-not-for-production-use';
assert.equal(supabase, null, 'Room tests refuse hosted persistence');

async function fixture() {
  const app = Fastify();
  const io = new Server(app.server);
  const created = new Set<string>();
  let requestId = 0;
  registerRoomRoutes(app, io, null);
  return {
    app,
    post: async (url: string, payload: Record<string, unknown>) => {
      const result = await app.inject({ method: 'POST', url, payload, remoteAddress: `127.0.0.${++requestId}` });
      if (url === '/rooms/create' && result.statusCode === 201) created.add(result.json<JoinRoomResponse>().roomCode);
      return result;
    },
    close: async () => {
      for (const roomCode of created) roomStore.delete(roomCode);
      io.close();
      await app.close();
    },
  };
}

test('Coup creation defaults to Base and preserves explicit Reformation configuration', async () => {
  const harness = await fixture();
  try {
    const cases: [Record<string, unknown>, 'base' | 'reformation'][] = [
      [{}, 'base'],
      [{ config: {} }, 'base'],
      [{ config: { coupVariant: 'base' } }, 'base'],
      [{ config: { coupVariant: 'reformation' } }, 'reformation'],
      [{ coupVariant: 'reformation' }, 'reformation'],
      [{ coupVariant: 'base' }, 'base'],
      [{ coupVariant: 'reformation', config: { coupVariant: 'reformation' } }, 'reformation'],
    ];
    for (const [options, variant] of cases) {
      const response = await harness.post('/rooms/create', { displayName: 'Host', gameId: 'coup', ...options });
      assert.equal(response.statusCode, 201);
      assert.equal(response.headers['cache-control'], 'no-store');
      const result = response.json<JoinRoomResponse>();
      assert.deepEqual(result.room.config, { coupVariant: variant });
      assert.equal(result.room.maxPlayers, variant === 'base' ? 6 : 10);
      assert.equal(roomStore.get(result.roomCode)!.config.coupVariant, variant);
      const resumed = await harness.app.inject({ method: 'GET', url: `/rooms/${result.roomCode}`, headers: { authorization: `Bearer ${result.token}` } });
      assert.equal(resumed.statusCode, 200);
      assert.deepEqual(resumed.json<RoomPublicState>().config, result.room.config);
    }
  } finally { await harness.close(); }
});

test('Coup rejects malformed, unknown and conflicting explicit versions', async () => {
  const harness = await fixture();
  try {
    const invalid: Record<string, unknown>[] = [
      ...[null, true, 4, 'reformation', [], ['reformation']].map(config => ({ config })),
      ...[null, true, 4, '', 'Reformation', 'unknown', '__proto__', 'constructor', {}, []].flatMap(coupVariant => [
        { config: { coupVariant } }, { coupVariant },
      ]),
      { config: { variant: 'reformation' } },
      { config: { coupVariant: 'reformation', unexpected: true } },
      { config: { coupVariant: 'base' }, coupVariant: 'reformation' },
      { config: { coupVariant: 'reformation' }, coupVariant: 'base' },
    ];
    for (const options of invalid) {
      const response = await harness.post('/rooms/create', { displayName: 'Host', gameId: 'coup', ...options });
      assert.equal(response.statusCode, 400, JSON.stringify(options));
      assert.match(response.json<{ message: string }>().message, /Coup/);
      assert.equal('token' in response.json(), false);
    }
  } finally { await harness.close(); }
});

test('Coup version enforces room capacity and is retained for joining players', async () => {
  const harness = await fixture();
  try {
    for (const [variant, capacity] of [['base', 6], ['reformation', 10]] as const) {
      const created = await harness.post('/rooms/create', { displayName: 'Host', gameId: 'coup', config: { coupVariant: variant } });
      assert.equal(created.statusCode, 201);
      const { roomCode } = created.json<JoinRoomResponse>();
      for (let index = 1; index < capacity; index++) {
        const joined = await harness.post('/rooms/join', { roomCode, displayName: `Guest ${index}` });
        assert.equal(joined.statusCode, 200);
        assert.equal(joined.json<JoinRoomResponse>().room.config.coupVariant, variant);
      }
      const rejected = await harness.post('/rooms/join', { roomCode, displayName: 'Over capacity' });
      assert.equal(rejected.statusCode, 409);
      assert.equal(roomStore.get(roomCode)!.players.size, capacity);
    }
  } finally { await harness.close(); }
});

test('other games keep their existing creation configuration', async () => {
  const harness = await fixture();
  try {
    for (const gameId of ['saboteur', 'king_of_tokyo', 'skull_king', 'citadels', 'not_alone', 'bang', 'libertalia', 'colt_express']) {
      const response = await harness.post('/rooms/create', { displayName: 'Host', gameId });
      assert.equal(response.statusCode, 201);
      assert.equal(response.json<JoinRoomResponse>().room.gameId, gameId);
      assert.deepEqual(response.json<JoinRoomResponse>().room.config, {});
    }
  } finally { await harness.close(); }
});
