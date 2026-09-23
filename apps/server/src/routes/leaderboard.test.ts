import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { registerRoomRoutes } from './room.js';

async function request(
  url: string,
  response?: { data: unknown; error: unknown },
  throws = false,
  onSignal?: (signal: AbortSignal) => Promise<void>,
) {
  const app = Fastify();
  const io = new Server(app.server);
  const calls: unknown[][] = [];
  const query = {
    select: (fields: string) => { calls.push(['select', fields]); return query; },
    eq: (field: string, value: string) => { calls.push(['eq', field, value]); return query; },
    order: (field: string, value: { ascending: boolean }) => { calls.push(['order', field, value]); return query; },
    limit: (value: number) => { calls.push(['limit', value]); return query; },
    abortSignal: async (signal: AbortSignal) => {
      calls.push(['abortSignal', signal]);
      if (onSignal) await onSignal(signal);
      if (throws) throw new Error('Private database details');
      return response;
    },
  };
  const client = response ? { from: (table: string) => { calls.push(['from', table]); return query; } } : null;
  registerRoomRoutes(app, io, client as Parameters<typeof registerRoomRoutes>[2]);
  try {
    const result = await app.inject({ method: 'GET', url });
    return { status: result.statusCode, body: result.json(), cache: result.headers['cache-control'], calls };
  } finally {
    io.close();
    await app.close();
  }
}

test('disabled rankings expose only the public notice rather than setup details or an empty leaderboard', async () => {
  const result = await request('/leaderboard');
  assert.equal(result.status, 503);
  assert.equal(result.cache, 'no-store');
  assert.deepEqual(result.body, { code: 'RANKINGS_DISABLED', message: 'Rankings are currently disabled by the administrator.' });
  assert(!/database|storage|configur|connect|supabase/i.test(JSON.stringify(result.body)));
});

test('invalid or repeated game filters are rejected', async () => {
  for (const url of ['/leaderboard?game=unknown', '/leaderboard?game=', '/leaderboard?game=coup&game=bang']) {
    assert.equal((await request(url)).status, 400);
  }
});

test('successful empty data remains distinct from a failed query', async () => {
  const result = await request('/leaderboard?game=not_alone', { data: [], error: null });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, []);
  assert(result.calls.some((call) => call[0] === 'eq' && call[2] === 'not_alone'));
  assert(result.calls.some((call) => call[0] === 'limit' && call[1] === 50));
});

test('database errors and thrown transport failures return a retryable safe response', async () => {
  for (const throws of [false, true]) {
    const result = await request('/leaderboard', { data: null, error: { message: 'Private database details' } }, throws);
    assert.equal(result.status, 503);
    assert.match(result.body.message, /try again/);
    assert.equal(result.body.code, undefined);
    assert(!JSON.stringify(result.body).includes('Private database'));
  }
});

test('successful rows are returned with explicit stable score ordering', async () => {
  const rows = [{ display_name: 'Explorer', games_played: 2, total_nuggets: 7, wins: 1 }];
  const result = await request('/leaderboard', { data: rows, error: null });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, rows);
  assert.deepEqual(result.calls.filter((call) => call[0] === 'order').map((call) => call[1]), ['total_nuggets', 'wins', 'display_name']);
});

test('each game is ranked by its displayed metric with deterministic ties', async () => {
  const winsGames = new Set(['coup', 'king_of_tokyo', 'not_alone', 'bang']);
  for (const game of ['saboteur', 'coup', 'king_of_tokyo', 'skull_king', 'citadels', 'not_alone', 'bang', 'libertalia', 'colt_express']) {
    const result = await request(`/leaderboard?game=${game}`, { data: [], error: null });
    assert.equal(result.status, 200);
    assert.deepEqual(result.calls.filter((call) => call[0] === 'order').map((call) => call[1]),
      winsGames.has(game) ? ['wins', 'total_nuggets', 'display_name'] : ['total_nuggets', 'wins', 'display_name']);
  }
});

test('null and malformed successful data never masquerade as an empty leaderboard', async () => {
  for (const data of [null, undefined, {}, 'Private database details', 42, [null], [[]]]) {
    const result = await request('/leaderboard', { data, error: null });
    assert.equal(result.status, 503);
    assert.equal(result.cache, 'no-store');
    assert.match(result.body.message, /try again/);
    assert(!JSON.stringify(result.body).includes('Private database'));
  }
});

test('invalid names and unsafe aggregate values reject the complete leaderboard', async () => {
  const valid = { display_name: 'Explorer', games_played: 2, total_nuggets: 7, wins: 1 };
  const invalidFields = [
    { display_name: '' }, { display_name: '  ' }, { display_name: null }, { display_name: 7 },
    { games_played: -1 }, { games_played: 0.5 }, { games_played: '2' }, { games_played: null },
    { games_played: Number.MAX_SAFE_INTEGER + 1 },
    { wins: -1 }, { wins: 0.5 }, { wins: '1' }, { wins: null }, { wins: Infinity },
    { total_nuggets: 0.5 }, { total_nuggets: '7' }, { total_nuggets: undefined },
    { total_nuggets: NaN }, { total_nuggets: Number.MIN_SAFE_INTEGER - 1 },
  ];
  for (const fields of invalidFields) {
    const result = await request('/leaderboard?game=bang', { data: [valid, { ...valid, ...fields }], error: null });
    assert.equal(result.status, 503);
  }
});

test('negative scores and grouped-name wins are valid without exposing extra fields', async () => {
  const row = { display_name: 'Shared name', games_played: 1, total_nuggets: -70, wins: 2 };
  const result = await request('/leaderboard?game=skull_king', {
    data: [{ ...row, private_detail: 'Private database details' }], error: null,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [row]);
  assert(result.calls.some(call => call[0] === 'select' && call[1] === 'display_name,games_played,total_nuggets,wins'));
});

test('every leaderboard query gets a ten-second deadline and aborts fail safely', async (context) => {
  const controller = new AbortController();
  const deadlines: number[] = [];
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds);
    return controller.signal;
  });
  const result = await request('/leaderboard?game=bang', { data: [], error: null }, false, async (signal) => {
    assert.equal(signal, controller.signal);
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('Private transport details')));
    });
  });
  assert.deepEqual(deadlines, [10_000]);
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.status, 503);
  assert.equal(result.cache, 'no-store');
  assert.match(result.body.message, /try again/);
  assert(!JSON.stringify(result.body).includes('Private transport'));
});
