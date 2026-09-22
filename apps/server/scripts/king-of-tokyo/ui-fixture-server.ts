import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { toKingOfTokyoPublicState } from '../../src/game/king-of-tokyo/publicState.js';
import { createKingOfTokyoUiFixture, KOT_UI_FIXTURE_SCENARIOS, type KotUiFixtureScenario } from './ui-fixtures.js';

assert.equal(process.env.KING_OF_TOKYO_UI_FIXTURES, 'true');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true');
assert.equal(supabase, null, 'UI fixtures refuse hosted persistence');
const allNames = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth', 'Fixture Fifth', 'Fixture Sixth'];
const origins = ['http://127.0.0.1:8081', 'http://localhost:8081'];
const app = Fastify({ logger: false });
await app.register(cors, { origin: origins });
const io = new Server(app.server, { cors: { origin: origins } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);

app.get('/', async () => ({ status: 'ok', service: 'king-of-tokyo-local-ui-fixtures' }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/king-of-tokyo-fixture', async (request, reply) => {
  const { roomCode, scenario } = request.body;
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  const longNames = allNames.map(name => `${name} Longest`.slice(0, 20));
  const names = ([...(room?.players.values() ?? [])].some(p => p.displayName === longNames[0]) ? longNames : allNames).slice(0, room?.players.size ?? 0);
  if (!room || room.game?.id !== 'king_of_tokyo' || ![5, 6].includes(room.players.size)
    || !names.every(name => [...room.players.values()].some(player => player.displayName === name && player.isConnected && !player.hasLeft))
    || !KOT_UI_FIXTURE_SCENARIOS.includes(scenario as KotUiFixtureScenario)) {
    return reply.code(400).send({ error: 'Exact connected synthetic room and named scenario required' });
  }
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const players = names.map(name => [...room.players.values()].find(player => player.displayName === name)!);
  const state = createKingOfTokyoUiFixture(room.roomCode, players, scenario as KotUiFixtureScenario, room.game.state.revision + 10);
  room.game = { id: 'king_of_tokyo', state };
  room.status = 'in_game';
  for (const player of players) {
    if (player.socketId) io.to(player.socketId).emit('game_state', toKingOfTokyoPublicState(state, player.playerId));
  }
  return { scenario, revision: state.revision, canonicalCards: 66 };
});
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('King of Tokyo supplementary fixture API on loopback3213; hosted persistence disabled');
