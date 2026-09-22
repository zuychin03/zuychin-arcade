import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { toCitadelsPrivateState, toCitadelsPublicState } from '../../src/game/citadels/publicState.js';
import { CITADELS_UI_FIXTURE_SCENARIOS, CITADELS_SEVEN_LAYOUT_NAMES, CITADELS_SEVEN_LAYOUT_SCENARIO, createCitadelsSevenSeatLayout, createCitadelsUiFixture, type CitadelsUiFixtureScenario } from './ui-fixtures.js';

assert.equal(process.env.CITADELS_UI_FIXTURES, 'true');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true');
assert.equal(supabase, null, 'UI fixtures refuse hosted persistence');
const names = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth'];
const origins = ['http://127.0.0.1:8081', 'http://localhost:8081'];
const app = Fastify({ logger: false });
await app.register(cors, { origin: origins });
const io = new Server(app.server, { cors: { origin: origins } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);

app.get('/', async () => ({ status: 'ok', service: 'citadels-local-ui-fixtures', sevenSeatLayout: process.env.CITADELS_SEVEN_SEAT_LAYOUT === 'true' }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/citadels-fixture', async (request, reply) => {
  const { roomCode, scenario } = request.body ?? {};
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  const sevenSeat = scenario === CITADELS_SEVEN_LAYOUT_SCENARIO && process.env.CITADELS_SEVEN_SEAT_LAYOUT === 'true';
  const requiredNames = sevenSeat ? CITADELS_SEVEN_LAYOUT_NAMES : names;
  if (!room || room.game?.id !== 'citadels' || room.players.size !== requiredNames.length
    || !requiredNames.every(name => [...room.players.values()].some(player =>
      player.displayName === name && player.isConnected && !player.hasLeft))
    || !(sevenSeat || CITADELS_UI_FIXTURE_SCENARIOS.includes(scenario as CitadelsUiFixtureScenario))) {
    return reply.code(400).send({ error: 'Exact connected synthetic room and named scenario required' });
  }
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const players = requiredNames.map(name => [...room.players.values()].find(player => player.displayName === name)!);
  const state = sevenSeat
    ? createCitadelsSevenSeatLayout(room.roomCode, players, room.game.state.revision + 10)
    : createCitadelsUiFixture(room.roomCode, players, scenario as CitadelsUiFixtureScenario, room.game.state.revision + 10);
  room.game = { id: 'citadels', state };
  room.status = 'in_game';
  io.to(room.roomCode).emit('game_state', toCitadelsPublicState(state));
  for (const player of players) {
    if (player.socketId) io.to(player.socketId).emit('private_state', toCitadelsPrivateState(state, player.playerId));
  }
  return { scenario, revision: state.revision, canonicalDistricts: 68 };
});
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('Citadels supplementary fixture API on loopback 3213; hosted persistence disabled');
