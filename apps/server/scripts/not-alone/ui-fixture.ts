import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { getCurrentSocketSession } from '../../src/socket/roomLifecycle.js';
import { getRoomPublicState } from '../../src/store/RoomStore.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from '../../src/game/not-alone/publicState.js';
import { supabase } from '../../src/lib/supabase.js';
import { createNotAloneUiFixture, NOT_ALONE_UI_FIXTURE_SCENARIOS, type NotAloneUiFixtureScenario } from './ui-fixtures.js';
import { createNotAloneTactileFixture, TACTILE_NOT_ALONE_SCENARIOS, type NotAloneTactileScenario } from './ui-tactile-fixtures.js';

assert.equal(process.env.NOT_ALONE_UI_FIXTURES, 'true', 'Explicit Not Alone fixture opt-in is required');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true', 'Fixtures require isolated local development');
assert.equal(supabase, null, 'UI fixtures refuse hosted persistence');
process.env.JWT_SECRET ??= 'not-alone-ui-fixture-only-secret-32-bytes';

const requestedPort = Number(process.env.NOT_ALONE_FIXTURE_PORT ?? 3213);
assert(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535, 'Invalid fixture port');
const scenario = (process.env.NOT_ALONE_FIXTURE_SCENARIO ?? 'sacrifice-rebase') as NotAloneUiFixtureScenario | NotAloneTactileScenario;
const isTactileScenario = (value: string): value is NotAloneTactileScenario => TACTILE_NOT_ALONE_SCENARIOS.includes(value as NotAloneTactileScenario);
assert(isTactileScenario(scenario) || NOT_ALONE_UI_FIXTURE_SCENARIOS.includes(scenario), 'Unknown Not Alone fixture scenario');
const expectedSeats = scenario === 'seven-final' ? 7 : 3;
const allowedOrigins = new Set([
  'http://127.0.0.1:8081', 'http://localhost:8081',
  'http://127.0.0.1:8082', 'http://localhost:8082',
]);
const originAllowed = (origin: string | undefined) => origin === undefined || allowedOrigins.has(origin);
const app = Fastify({ logger: false });
await app.register(cors, { origin: (origin, callback) => callback(null, originAllowed(origin)) });
app.get('/', async () => ({ status: 'ok', service: 'not-alone-ui-fixture', scenario, expectedSeats }));
const io = new Server(app.server, {
  cors: { origin: [...allowedOrigins] },
  allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin)),
});
registerRoomRoutes(app, io);
registerSocketHandlers(io);

// Prepare only fresh starts; subsequent actions use the real handlers.
io.on('connection', (socket) => {
  socket.use(([event], next) => {
    const current = getCurrentSocketSession(socket);
    if (event === 'start_game' && current?.room.gameId === 'not_alone') {
      const seats = [...current.room.players.values()].filter(player => !player.hasLeft).length;
      if (seats !== expectedSeats) {
        socket.emit('action_rejected', { reason: `This fixture requires exactly ${expectedSeats} seats` });
        return;
      }
    }
    next();
  });
  socket.on('start_game', () => {
    const session = getCurrentSocketSession(socket);
    const room = session?.room;
    const initial = room?.game?.id === 'not_alone' ? room.game.state : null;
    if (!session || !room || !initial || room.hostPlayerId !== session.auth.playerId
      || initial.revision !== 0 || initial.phase !== 'hunted_planning') return;
    const players = initial.turnOrder.map((id) => initial.players.get(id)!);
    if (players.length !== expectedSeats) {
      socket.emit('action_rejected', { reason: `This fixture requires exactly ${expectedSeats} seats` });
      return;
    }
    const state = isTactileScenario(scenario)
      ? createNotAloneTactileFixture(room.roomCode, players, scenario, initial.revision, initial.boardFace)
      : createNotAloneUiFixture(room.roomCode, players, scenario, initial.revision, initial.boardFace);
    room.game = { id: 'not_alone', state };
    for (const player of room.players.values()) {
      if (!player.socketId || !player.isConnected || player.hasLeft) continue;
      io.to(player.socketId).emit('game_state', toNotAlonePublicState(state, player.playerId));
      io.to(player.socketId).emit('private_state', toNotAlonePrivateState(state, player.playerId));
    }
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    console.log(JSON.stringify({ event: 'fixture_ready', scenario, expectedSeats, roomCode: room.roomCode, revision: state.revision }));
  });
});

await app.listen({ host: '127.0.0.1', port: requestedPort });
const { port } = app.server.address() as AddressInfo;
console.log(JSON.stringify({ event: 'fixture_listening', url: `http://127.0.0.1:${port}`, scenario }));

async function close(): Promise<void> {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  if (app.server.listening) await app.close();
  process.exit(0);
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
