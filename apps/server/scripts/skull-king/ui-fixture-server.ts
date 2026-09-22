import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { toSkullKingPrivateState, toSkullKingPublicState } from '../../src/game/skull-king/publicState.js';
import { createSkullKingUiFixture, SKULL_UI_FIXTURE_SCENARIOS, type SkullUiFixtureScenario } from './ui-fixtures.js';

assert.equal(process.env.SKULL_KING_UI_FIXTURES, 'true');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true');
assert.equal(supabase, null, 'UI fixtures refuse hosted persistence');
const names = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth',
  'Fixture Fifth', 'Fixture Sixth', 'Fixture Seventh', 'Fixture Eighth'];
const origins = ['http://127.0.0.1:8081', 'http://localhost:8081'];
const app = Fastify({ logger: false });
await app.register(cors, { origin: origins });
const io = new Server(app.server, { cors: { origin: origins } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);

app.get('/', async () => ({ status: 'ok', service: 'skull-king-local-ui-fixtures' }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/skull-king-fixture', async (request, reply) => {
  const { roomCode, scenario } = request.body ?? {};
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  const expectedNames = names.slice(0, scenario === 'eight_final_tie' ? 8 : 4);
  if (!room || room.game?.id !== 'skull_king' || room.players.size !== expectedNames.length
    || !expectedNames.every(name => [...room.players.values()].some(player =>
      player.displayName === name && player.isConnected && !player.hasLeft))
    || !SKULL_UI_FIXTURE_SCENARIOS.includes(scenario as SkullUiFixtureScenario)) {
    return reply.code(400).send({ error: 'Exact connected synthetic room and named scenario required' });
  }
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const players = expectedNames.map(name => [...room.players.values()].find(player => player.displayName === name)!);
  const state = createSkullKingUiFixture(room.roomCode, players, scenario as SkullUiFixtureScenario, room.game.state.revision + 10);
  room.game = { id: 'skull_king', state };
  room.status = 'in_game';
  io.to(room.roomCode).emit('game_state', toSkullKingPublicState(state));
  for (const player of players) {
    if (player.socketId) io.to(player.socketId).emit('private_state', toSkullKingPrivateState(state, player.playerId));
  }
  return { scenario, revision: state.revision, canonicalCards: 70 };
});
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('Skull King supplementary fixture API on loopback 3213; hosted persistence disabled');
