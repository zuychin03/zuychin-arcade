import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameResultWriter } from './saveGameResult.js';

const result = {
  gameName: 'not_alone', roomCode: 'TESTROOM', roundsPlayed: 4,
  players: [{ playerId: 'player-one', displayName: 'Explorer', score: 7, won: true }],
};

test('unconfigured persistence is explicit and does not schedule retries', async () => {
  const write = createGameResultWriter(null, async () => assert.fail('No retry expected'));
  assert.equal(await write(result), 'disabled');
});

test('writes one atomic result payload and gives rematches distinct IDs', async () => {
  const calls: Record<string, unknown>[] = [];
  const write = createGameResultWriter({ rpc: async (name, args) => {
    assert.equal(name, 'record_game_result'); calls.push(args);
    return { data: args.p_result_id, error: null, status: 200 };
  } });
  assert.equal(await write(result), 'saved');
  assert.equal(await write(result), 'saved');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0]!.p_result_id, calls[1]!.p_result_id);
  assert.equal(calls[0]!.p_rounds_played, 4);
  assert.deepEqual(calls[0]!.p_players, [{ player_id: 'player-one', display_name: 'Explorer', score: 7, won: true }]);
});

test('ambiguous transport and temporary HTTP failures reuse one result ID', async () => {
  const calls: Record<string, unknown>[] = [];
  const waits: number[] = [];
  const write = createGameResultWriter({ rpc: async (_name, args) => {
    calls.push(args);
    if (calls.length === 1) throw new Error('Response lost after commit');
    if (calls.length === 2) return { data: null, error: {}, status: 503 };
    return { data: args.p_result_id, error: null, status: 200 };
  } }, async (ms) => { waits.push(ms); });
  assert.equal(await write(result), 'saved');
  assert.equal(new Set(calls.map((call) => call.p_result_id)).size, 1);
  assert.deepEqual(waits, [250, 500]);
});

test('permanent schema or privilege failures stop without unsafe fallback inserts', async () => {
  let calls = 0;
  const failures: string[] = [];
  const write = createGameResultWriter({ rpc: async () => {
    calls += 1; return { data: null, error: { code: '42501' }, status: 403 };
  } }, async () => assert.fail('No retry expected'), (id) => { failures.push(id); });
  assert.equal(await write(result), 'failed');
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
});

test('retry exhaustion reports failure once and never claims a saved result', async () => {
  let calls = 0;
  let failures = 0;
  const write = createGameResultWriter({ rpc: async () => {
    calls += 1; return { data: null, error: {}, status: 429 };
  } }, async () => {}, () => { failures += 1; });
  assert.equal(await write(result), 'failed');
  assert.equal(calls, 3);
  assert.equal(failures, 1);
});

test('a malformed success response cannot be reported as persisted', async () => {
  let failures = 0;
  const write = createGameResultWriter({ rpc: async () => ({ data: null, error: null, status: 200 }) }, async () => {}, () => { failures += 1; });
  assert.equal(await write(result), 'failed');
  assert.equal(failures, 1);
});

test('the production RPC builder receives a request deadline signal', async () => {
  let signal: AbortSignal | undefined;
  const write = createGameResultWriter({ rpc: (_name, args) => Object.assign(
    Promise.resolve({ data: args.p_result_id, error: null, status: 200 }),
    { abortSignal: (value: AbortSignal) => {
      signal = value;
      return Promise.resolve({ data: args.p_result_id, error: null, status: 200 });
    } },
  ) });
  assert.equal(await write(result), 'saved');
  assert(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});
