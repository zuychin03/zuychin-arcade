import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { NOT_ALONE_UI_FIXTURE_SCENARIOS } from './ui-fixtures.js';
import { TACTILE_NOT_ALONE_SCENARIOS } from './ui-tactile-fixtures.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const blockedNetwork = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("FIXTURE_NETWORK_FORBIDDEN")};';
const cleanEnvironment = {
  ...process.env,
  JWT_SECRET: 'isolated-fixture-guard-test-key-32-bytes',
  NOT_ALONE_UI_FIXTURES: 'true', ARCADE_INSECURE_LOCAL_DEV: 'true', NOT_ALONE_FIXTURE_PORT: '0',
  SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '',
};
for (const [name, override, expected] of [
  ['missing opt-in', { NOT_ALONE_UI_FIXTURES: '' }, 'Explicit Not Alone fixture opt-in is required'],
  ['missing local-development opt-in', { ARCADE_INSECURE_LOCAL_DEV: '' }, 'Fixtures require isolated local development'],
  ['configured persistence', { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SECRET_KEY: 'dummy-not-a-real-service-key' }, 'UI fixtures refuse hosted persistence'],
  ['unknown scenario', { NOT_ALONE_FIXTURE_SCENARIO: 'not-a-fixture' }, 'Unknown Not Alone fixture scenario'],
] as const) {
  test(`fixture refuses ${name} before listening`, () => {
    const result = spawnSync(process.execPath, ['--import', blockedNetwork, 'node_modules/tsx/dist/cli.mjs', 'apps/server/scripts/not-alone/ui-fixture.ts'], {
      cwd: repo, env: { ...cleanEnvironment, ...override }, encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
    assert.equal(result.error, undefined, 'Guard process must exit itself');
    assert.notEqual(result.status, 0, 'A forbidden fixture must fail');
    assert(result.stderr.includes(expected), 'Expected explicit guard rejection');
    assert(!result.stderr.includes('FIXTURE_NETWORK_FORBIDDEN'), 'Guard must not attempt a network request');
    assert(!result.stdout.includes('fixture_listening'), 'Guard must reject before binding');
  });
}

test('source-only fixture configuration recognises the scenario union before any listen', () => {
  const source = readFileSync(new URL('./ui-fixture.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const scenario = '), end = source.indexOf('const allowedOrigins = ');
  const configuration = source.slice(start, end)
    .replace(' as NotAloneUiFixtureScenario | NotAloneTactileScenario', '')
    .replace('(value: string): value is NotAloneTactileScenario', '(value)')
    .replace('value as NotAloneTactileScenario', 'value');
  assert(start > 0 && end > start && end < source.indexOf('const app = Fastify'));
  const configure = (scenario: string | undefined) => vm.runInNewContext(configuration + '\n({ scenario, expectedSeats });', {
    process: { env: { NOT_ALONE_FIXTURE_SCENARIO: scenario } }, assert,
    NOT_ALONE_UI_FIXTURE_SCENARIOS, TACTILE_NOT_ALONE_SCENARIOS,
  });
  for (const scenario of [...NOT_ALONE_UI_FIXTURE_SCENARIOS, ...TACTILE_NOT_ALONE_SCENARIOS]) {
    const actual = configure(scenario);
    assert.equal(actual.scenario, scenario);
    assert.equal(actual.expectedSeats, scenario === 'seven-final' ? 7 : 3);
  }
  assert.equal(configure(undefined).scenario, 'sacrifice-rebase');
  assert.throws(() => configure('not-a-fixture'), /Unknown Not Alone fixture scenario/);
  assert.match(source, /service: 'not-alone-ui-fixture', scenario, expectedSeats/);
  assert.match(source, /host: '127\.0\.0\.1'/);
  assert(source.indexOf('Explicit Not Alone fixture opt-in') < source.indexOf('const app = Fastify'));
  assert(source.indexOf('Fixtures require isolated local development') < source.indexOf('const app = Fastify'));
  assert(source.indexOf('UI fixtures refuse hosted persistence') < source.indexOf('const app = Fastify'));
});

test('source-only fixture middleware rejects wrong active rosters without dispatch or a thrown assertion', () => {
  const source = readFileSync(new URL('./ui-fixture.ts', import.meta.url), 'utf8');
  const body = source.match(/socket\.use\(\(\[event\], next\) => \{([\s\S]*?)\n  \}\);/)?.[1];
  assert(body);
  for (const expectedSeats of [3, 7]) for (const seats of [2, 3, 6, 7]) {
    let dispatched = 0;
    const emitted: { event: string; reason: string }[] = [];
    const players = new Map(Array.from({ length: seats }, (_, index) => [`p${index}`, { hasLeft: false }]));
    players.set('departed', { hasLeft: true });
    assert.doesNotThrow(() => vm.runInNewContext('(() => {' + body + '})()', {
      event: 'start_game', expectedSeats, next: () => { dispatched++; },
      getCurrentSocketSession: () => ({ room: { gameId: 'not_alone', players } }),
      socket: { emit: (event: string, payload: { reason: string }) => emitted.push({ event, reason: payload.reason }) },
    }));
    assert.equal(dispatched, Number(seats === expectedSeats));
    assert.equal(emitted.length, Number(seats !== expectedSeats));
    if (emitted.length) assert.deepEqual(emitted[0], { event: 'action_rejected', reason: `This fixture requires exactly ${expectedSeats} seats` });
  }
  assert.match(source, /if \(players.length !== expectedSeats\)/);
});
