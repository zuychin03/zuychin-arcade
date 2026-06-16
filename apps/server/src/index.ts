import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from './routes/room.js';
import { registerSocketHandlers } from './socket/handlers.js';

const app = Fastify({ logger: true, ignoreDuplicateSlashes: true });
await app.register(cors, { origin: '*' });

// Health check endpoint for Render / UptimeRobot
app.get('/', async () => {
  return { status: 'ok', service: 'zuychin-arcade-server' };
});

const io = new Server(app.server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

registerRoomRoutes(app, io);
registerSocketHandlers(io);

const PORT = Number(process.env.PORT) || 3001;
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`zuychin-arcade server running on port ${PORT}`);
