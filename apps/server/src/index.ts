import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { registerRoomRoutes } from './routes/room.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { createCorsOriginValidator } from './utils/cors.js';
import { resolveJwtSecret } from './utils/jwt.js';
import {
  configuredTrustProxy,
  isInsecureLocalDev,
  REST_BODY_LIMIT_BYTES,
  serverListenHost,
  SOCKET_PAYLOAD_LIMIT_BYTES,
} from './utils/securityConfig.js';

resolveJwtSecret();
const isCorsOriginAllowed = createCorsOriginValidator();
const insecureLocalDev = isInsecureLocalDev();
if (insecureLocalDev) {
  console.warn('[security] ARCADE_INSECURE_LOCAL_DEV=true: loopback-only mode is active; a missing JWT_SECRET uses a public fallback');
}

const app = Fastify({
  bodyLimit: REST_BODY_LIMIT_BYTES,
  logger: true,
  routerOptions: { ignoreDuplicateSlashes: true },
  trustProxy: configuredTrustProxy(),
});
await app.register(cors, {
  origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
});

// Health check endpoint for Render / UptimeRobot
app.get('/', async () => {
  return { status: 'ok', service: 'zuychin-arcade-server' };
});

const io = new Server(app.server, {
  allowRequest: (request, callback) => {
    const rawOrigin = request.headers.origin;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    callback(null, isCorsOriginAllowed(origin));
  },
  cors: {
    origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: SOCKET_PAYLOAD_LIMIT_BYTES,
});

registerRoomRoutes(app, io);
registerSocketHandlers(io);

const PORT = Number(process.env.PORT) || 3001;
const HOST = serverListenHost();
await app.listen({ port: PORT, host: HOST });
console.log(`zuychin-arcade server running on ${HOST}:${PORT}`);
