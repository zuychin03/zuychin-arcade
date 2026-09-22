import assert from 'node:assert/strict';
import { assertLibertaliaFixtureEnvironment, assertLibertaliaFixtureRoom, createLibertaliaUiFixture, fixtureNames, libertaliaFixtureManifest, libertaliaFixtureProof, LIBERTALIA_FIXTURE_REACHABILITY, type LibertaliaUiFixtureScenario } from './ui-fixtures.js';

assertLibertaliaFixtureEnvironment(process.env);
const [{ default: Fastify }, { default: cors }, { Server }, { registerRoomRoutes }, { registerSocketHandlers }, { roomStore }, { supabase }, projections] = await Promise.all([
  import('fastify'), import('@fastify/cors'), import('socket.io'), import('../../src/routes/room.js'),
  import('../../src/socket/handlers.js'), import('../../src/store/RoomStore.js'), import('../../src/lib/supabase.js'),
  import('../../src/game/libertalia/publicState.js'),
]);
assert.equal(supabase, null, 'Fixture service refuses hosted persistence');
const origins = ['http://127.0.0.1:8081', 'http://localhost:8081'];
const app = Fastify({ logger: false });
await app.register(cors, { origin: origins });
const io = new Server(app.server, { cors: { origin: origins } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);
const touched = new Set<string>();

app.get('/', async () => ({ status: 'ok', service: 'libertalia-local-ui-fixtures' }));
app.get('/__qa/libertalia-fixtures', async () => ({ scenarios: libertaliaFixtureManifest(), reachability: LIBERTALIA_FIXTURE_REACHABILITY }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/libertalia-fixture', async (request, reply) => {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ error: 'Loopback only' });
  const { roomCode, scenario } = request.body ?? {};
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  try { assertLibertaliaFixtureRoom(room, scenario); } catch {
    return reply.code(400).send({ error: 'Exact connected synthetic Libertalia roster and declared scenario required' });
  }
  assertLibertaliaFixtureRoom(room, scenario);
  const ordered = fixtureNames(scenario as LibertaliaUiFixtureScenario).map(name => [...room.players.values()].find(p => p.displayName === name)!);
  const state = createLibertaliaUiFixture(room.roomCode, ordered, scenario as LibertaliaUiFixtureScenario, room.game.state.revision + 10);
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.game = { id: 'libertalia', state }; room.status = state.status === 'game_over' ? 'finished' : 'in_game';
  touched.add(room.roomCode);
  io.to(room.roomCode).emit('game_state', projections.toLibertaliaPublicState(state));
  for (const player of ordered) io.to(player.socketId!).emit('private_state', projections.toLibertaliaPrivateState(state, player.playerId));
  return { scenario, checkpoint: libertaliaFixtureProof(state), scope: LIBERTALIA_FIXTURE_REACHABILITY.scope };
});

let closing = false;
async function close(): Promise<void> {
  if (closing) return; closing = true;
  await new Promise<void>(resolve => io.close(() => resolve()));
  for (const code of touched) {
    const room = roomStore.get(code); if (!room) continue;
    if (room.timer) clearTimeout(room.timer);
    for (const player of room.players.values()) if (player.presenceTimer) clearTimeout(player.presenceTimer);
  }
  await app.close();
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('Libertalia canonical fixture API on 127.0.0.1:3213; persistence disabled');
