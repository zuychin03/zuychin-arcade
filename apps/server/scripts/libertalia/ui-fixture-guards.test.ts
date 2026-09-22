import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ServerRoom } from '../../src/store/RoomStore.js';
import { assertLibertaliaFixtureEnvironment, assertLibertaliaFixtureRoom, fixtureNames, LIBERTALIA_UI_FIXTURE_SCENARIOS } from './ui-fixtures.js';

const environment = { LIBERTALIA_UI_FIXTURES: 'true', ARCADE_INSECURE_LOCAL_DEV: 'true' };
test('fixture startup requires both exact opt-ins and refuses every persistence value', () => {
  assert.doesNotThrow(() => assertLibertaliaFixtureEnvironment(environment));
  for (const key of Object.keys(environment)) for (const value of [undefined, '', 'false', 'TRUE', '1']) assert.throws(() => assertLibertaliaFixtureEnvironment({ ...environment, [key]: value }));
  for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'DATABASE_URL']) {
    assert.throws(() => assertLibertaliaFixtureEnvironment({ ...environment, [key]: 'fixture-rejection-sentinel' }));
    assert.doesNotThrow(() => assertLibertaliaFixtureEnvironment({ ...environment, [key]: '' }));
  }
});

test('every declared case admits only the exact connected started synthetic roster', () => {
  for (const scenario of LIBERTALIA_UI_FIXTURE_SCENARIOS) {
    const players = fixtureNames(scenario).map((displayName, i) => ({ playerId: `p${i}`, displayName, isConnected: true, hasLeft: false, socketId: `socket${i}` }));
    const room = { gameId: 'libertalia', hostPlayerId: 'p0', game: { id: 'libertalia' }, players: new Map(players.map(p => [p.playerId, p])) } as unknown as ServerRoom;
    assert.doesNotThrow(() => assertLibertaliaFixtureRoom(room, scenario));
    assert.throws(() => assertLibertaliaFixtureRoom(room, 'undeclared'));
    assert.throws(() => assertLibertaliaFixtureRoom(undefined, scenario));
    for (const property of ['displayName', 'isConnected', 'hasLeft', 'socketId'] as const) {
      const before = players[0]![property];
      Object.assign(players[0]!, { [property]: property === 'displayName' ? 'Real Player' : property === 'isConnected' ? false : property === 'hasLeft' ? true : null });
      assert.throws(() => assertLibertaliaFixtureRoom(room, scenario)); Object.assign(players[0]!, { [property]: before });
    }
    assert.throws(() => assertLibertaliaFixtureRoom({ ...room, hostPlayerId: 'p1' }, scenario));
    assert.throws(() => assertLibertaliaFixtureRoom({ ...room, game: null }, scenario));
    room.players.delete('p0'); assert.throws(() => assertLibertaliaFixtureRoom(room, scenario));
  }
});

test('server guards before importing application services, binds loopback and closes owned timers', () => {
  const source = readFileSync(new URL('./ui-fixture-server.ts', import.meta.url), 'utf8');
  assert(source.indexOf('assertLibertaliaFixtureEnvironment(process.env)') < source.indexOf("import('../../src/routes/room.js')"));
  assert.match(source, /assert\.equal\(supabase, null/);
  assert.match(source, /host: '127\.0\.0\.1', port: 3213/);
  assert.match(source, /assertLibertaliaFixtureRoom\(room, scenario\)/);
  assert.match(source, /clearTimeout\(room.timer\)/); assert.match(source, /clearTimeout\(player.presenceTimer\)/);
  assert.match(source, /io.close/); assert.match(source, /app.close/);
  assert.doesNotMatch(source, /pendingChoice\s*=|\.resolve\s*=|\.queue\s*=/);
});
