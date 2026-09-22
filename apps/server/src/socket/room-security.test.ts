import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { JoinRoomResponse } from '@zuychin-arcade/types';
import { formatRoomCodeInput } from '../../../mobile/lib/roomCode.js';
import {
  MAX_CONCURRENT_PASSWORD_OPERATIONS,
  registerRoomRoutes,
  REST_RATE_LIMITS,
} from '../routes/room.js';
import {
  ALLOWED_PLAYER_REACTIONS,
  registerSocketHandlers,
  SOCKET_RATE_LIMITS,
} from './handlers.js';
import {
  isChooseGoldPayload,
  isPassTurnPayload,
  isPlaceCardPayload,
  isPlayActionPayload,
  recoverDisconnectedSaboteurPlayers,
} from '../game/saboteur/socketHandlers.js';
import { initGame } from '../game/saboteur/engine.js';
import { initGoldDistribution } from '../game/saboteur/goldDistribution.js';
import { supabase } from '../lib/supabase.js';
import { getRoomPublicState, roomStore } from '../store/RoomStore.js';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  resolveJwtSecret,
  verifyToken,
} from '../utils/jwt.js';
import { generateRoomCode, ROOM_CODE_PATTERN } from '../utils/roomCode.js';
import { configuredCorsOrigins, createCorsOriginValidator } from '../utils/cors.js';
import { FixedWindowRateLimiter } from '../utils/rateLimit.js';
import {
  markPlayerDisconnected,
  prepareRoomForStart,
  scheduleLobbyReservationExpiry,
} from './roomLifecycle.js';
import {
  AUTH_TOKEN_LIMIT_CHARS,
  configuredTrustProxy,
  REST_BODY_LIMIT_BYTES,
  serverListenHost,
  SOCKET_PAYLOAD_LIMIT_BYTES,
} from '../utils/securityConfig.js';

const TEST_JWT_SECRET = 'room-security-test-secret-with-32-bytes';
const TEST_ALLOWED_ORIGIN = 'https://arcade.test';
process.env.JWT_SECRET = TEST_JWT_SECRET;
delete process.env.ARCADE_INSECURE_LOCAL_DEV;

interface Harness {
  app: FastifyInstance;
  io: Server;
  url: string;
  clients: ClientSocket[];
  roomCodes: Set<string>;
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    };
    socket.once(event, onEvent);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createHarness(
  corsEnv: NodeJS.ProcessEnv = { ARCADE_ALLOWED_ORIGINS: TEST_ALLOWED_ORIGIN },
): Promise<Harness> {
  assert.equal(supabase, null, 'Run security tests with Supabase credentials unset');
  const isCorsOriginAllowed = createCorsOriginValidator(corsEnv);
  const app = Fastify({ bodyLimit: REST_BODY_LIMIT_BYTES, logger: false });
  await app.register(cors, {
    origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
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
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, io, url: `http://127.0.0.1:${port}`, clients: [], roomCodes: new Set() };
}

async function closeHarness(harness: Harness): Promise<void> {
  for (const client of harness.clients) client.disconnect();
  for (const roomCode of harness.roomCodes) roomStore.delete(roomCode);
  await new Promise<void>((resolve) => harness.io.close(() => resolve()));
  if (harness.app.server.listening) await harness.app.close();
}

async function createRoom(harness: Harness, displayName: string, gameId = 'saboteur'): Promise<JoinRoomResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/rooms/create',
    payload: { displayName, gameId },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  const joined = response.json<JoinRoomResponse>();
  harness.roomCodes.add(joined.roomCode);
  return joined;
}

async function joinRoom(harness: Harness, roomCode: string, displayName: string): Promise<JoinRoomResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/rooms/join',
    payload: { roomCode, displayName },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  return response.json<JoinRoomResponse>();
}

function createSocketClient(harness: Harness, token: string, origin?: string): ClientSocket {
  const socket = createClient(harness.url, {
    auth: { token },
    ...(origin ? { extraHeaders: { Origin: origin } } : {}),
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  harness.clients.push(socket);
  return socket;
}

async function connect(harness: Harness, token: string, origin?: string): Promise<ClientSocket> {
  const socket = createSocketClient(harness, token, origin);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 2_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

async function expectConnectionError(
  harness: Harness,
  token: string,
  origin?: string,
): Promise<Error> {
  const socket = createSocketClient(harness, token, origin);
  return await new Promise<Error>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for connection error')), 2_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      reject(new Error('Socket unexpectedly connected'));
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      resolve(error);
    });
  });
}

test('JWT configuration fails closed except for explicit loopback-only development', () => {
  assert.throws(
    () => resolveJwtSecret({}),
    /JWT_SECRET is required/,
  );
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'development', JWT_SECRET: '   ' }),
    /JWT_SECRET is required/,
  );
  assert.equal(
    resolveJwtSecret({ ARCADE_INSECURE_LOCAL_DEV: 'true' }),
    'dev-secret-do-not-use-in-prod',
  );
  assert.throws(
    () => resolveJwtSecret({ JWT_SECRET: 'configured' }),
    /at least 32 bytes/,
  );
  assert.equal(resolveJwtSecret({ JWT_SECRET: TEST_JWT_SECRET }), TEST_JWT_SECRET);
  assert.equal(serverListenHost({ ARCADE_INSECURE_LOCAL_DEV: 'true', HOST: '0.0.0.0' }), '127.0.0.1');
  assert.equal(serverListenHost({ JWT_SECRET: 'configured' }), '0.0.0.0');
  assert.equal(serverListenHost({ JWT_SECRET: 'configured', HOST: '10.0.0.5' }), '10.0.0.5');
  assert.equal(configuredTrustProxy({}), false);
  assert.deepEqual(configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: '192.0.2.0/24' }), ['192.0.2.0/24']);
  assert.throws(() => configuredTrustProxy({ ARCADE_TRUST_PROXY_HOPS: '1' }), /ARCADE_TRUST_PROXY_CIDRS/);
  assert.throws(() => configuredTrustProxy({ ARCADE_TRUST_PROXY_HOPS: 'true' }));
  assert.throws(() => configuredTrustProxy({ ARCADE_TRUST_PROXY_HOPS: '11' }));
});

test('JWT verification enforces HS256, issuer and audience', () => {
  const claims = {
    playerId: 'alice',
    roomCode: 'ABCD-EFGH',
    displayName: 'Alice',
    isHost: true,
  };
  const wrongIssuer = jwt.sign(claims, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    issuer: 'other-service',
  });
  const wrongAudience = jwt.sign(claims, TEST_JWT_SECRET, {
    algorithm: 'HS256',
    audience: 'other-client',
    expiresIn: '1h',
    issuer: JWT_ISSUER,
  });
  const wrongAlgorithm = jwt.sign(claims, TEST_JWT_SECRET, {
    algorithm: 'HS384',
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    issuer: JWT_ISSUER,
  });

  assert.throws(() => verifyToken(wrongIssuer));
  assert.throws(() => verifyToken(wrongAudience));
  assert.throws(() => verifyToken(wrongAlgorithm));
});

test('CORS configuration fails closed and normalises explicit HTTP origins', () => {
  assert.throws(
    () => configuredCorsOrigins({ NODE_ENV: 'development' }),
    /ARCADE_ALLOWED_ORIGINS is required/,
  );
  const validate = createCorsOriginValidator({
    ARCADE_ALLOWED_ORIGINS: 'https://arcade.example.com, https://play.example.com/',
  });
  assert.equal(validate(undefined), true);
  assert.equal(validate('https://arcade.example.com'), true);
  assert.equal(validate('https://play.example.com/'), true);
  assert.equal(validate('https://evil.example.com'), false);
  assert.throws(
    () => configuredCorsOrigins({ ARCADE_ALLOWED_ORIGINS: 'https://arcade.example.com/path' }),
    /without paths/,
  );

  const insecure = createCorsOriginValidator({ ARCADE_INSECURE_LOCAL_DEV: 'TRUE' });
  assert.equal(insecure(undefined), true);
  assert.equal(insecure('http://localhost:8081'), true);
  assert.equal(insecure('http://127.0.0.1:19006'), true);
  assert.equal(insecure('http://[::1]:8081'), true);
  assert.equal(insecure('https://evil.example.com'), false);
});

test('invalid CORS configuration does not expose credentials or query values', () => {
  for (const value of [
    'https://synthetic-user:synthetic-password@arcade.example.com',
    'https://arcade.example.com?token=synthetic-token',
    'not-an-origin-synthetic-token',
  ]) {
    assert.throws(
      () => configuredCorsOrigins({ ARCADE_ALLOWED_ORIGINS: value }),
      (error: unknown) => error instanceof Error
        && error.message.includes('ARCADE_ALLOWED_ORIGINS')
        && !error.message.includes('synthetic-'),
    );
  }
});

test('Fastify preflight and Socket.IO handshakes enforce configured and local origins', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const allowedPreflight = await harness.app.inject({
      method: 'OPTIONS',
      url: '/rooms/create',
      headers: {
        origin: TEST_ALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    assert.equal(allowedPreflight.statusCode, 204);
    assert.equal(allowedPreflight.headers['access-control-allow-origin'], TEST_ALLOWED_ORIGIN);

    const deniedPreflight = await harness.app.inject({
      method: 'OPTIONS',
      url: '/rooms/create',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    assert.equal(deniedPreflight.headers['access-control-allow-origin'], undefined);

    const allowedSocket = await connect(harness, alice.token, TEST_ALLOWED_ORIGIN);
    assert.equal(allowedSocket.connected, true);
    const deniedSocketError = await expectConnectionError(
      harness,
      alice.token,
      'https://evil.example.com',
    );
    assert.ok(deniedSocketError.message.length > 0);
    const oversizedTokenError = await expectConnectionError(
      harness,
      'x'.repeat(AUTH_TOKEN_LIMIT_CHARS + 1),
      TEST_ALLOWED_ORIGIN,
    );
    assert.match(oversizedTokenError.message, /INVALID_TOKEN/);
  } finally {
    await closeHarness(harness);
  }

  const localHarness = await createHarness({ ARCADE_INSECURE_LOCAL_DEV: 'true' });
  try {
    const alice = await createRoom(localHarness, 'Local Alice');
    const localPreflight = await localHarness.app.inject({
      method: 'OPTIONS',
      url: '/rooms/create',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'POST',
      },
    });
    assert.equal(localPreflight.statusCode, 204);
    assert.equal(localPreflight.headers['access-control-allow-origin'], 'http://localhost:8081');
    await connect(localHarness, alice.token, 'http://127.0.0.1:8081');
    await expectConnectionError(localHarness, alice.token, 'https://evil.example.com');
  } finally {
    await closeHarness(localHarness);
  }
});

test('room codes use the unambiguous 40-bit format', () => {
  const generated = new Set(Array.from({ length: 128 }, () => generateRoomCode()));
  assert.equal(generated.size, 128);
  for (const code of generated) {
    assert.match(code, ROOM_CODE_PATTERN);
    assert.doesNotMatch(code, /[IO01]/);
  }
});

test('client room-code input keeps only the actual ASCII room alphabet', () => {
  assert.equal(formatRoomCodeInput('io01-abcz23456789'), 'ABCZ-2345');
  assert.equal(formatRoomCodeInput('äßſa-b2'), 'AB2');
});

test('the fixed-window limiter remains bounded and recovers after expiry', () => {
  const limiter = new FixedWindowRateLimiter(1, 1_000, 2);
  assert.equal(limiter.consume('first', 1).allowed, true);
  assert.equal(limiter.consume('second', 1).allowed, true);
  assert.equal(limiter.consume('third', 1).allowed, false);
  assert.equal(limiter.consume('first', 2).allowed, false);
  assert.equal(limiter.consume('third', 1_002).allowed, true);
});

test('room state lookup requires a token belonging to that room', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const mallory = await createRoom(harness, 'Mallory');

    const unauthenticated = await harness.app.inject({
      method: 'GET',
      url: `/rooms/${alice.roomCode}`,
    });
    assert.equal(unauthenticated.statusCode, 401);

    const crossRoom = await harness.app.inject({
      method: 'GET',
      url: `/rooms/${alice.roomCode}`,
      headers: { authorization: `Bearer ${mallory.token}` },
    });
    assert.equal(crossRoom.statusCode, 403);

    const authorised = await harness.app.inject({
      method: 'GET',
      url: `/rooms/${alice.roomCode}`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    assert.equal(authorised.statusCode, 200);
    assert.equal(authorised.headers['cache-control'], 'no-store');
    assert.equal(authorised.json<{ roomCode: string }>().roomCode, alice.roomCode);

    const malformedJoin = await harness.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: 'GOLD-42', displayName: 'Eve' },
    });
    assert.equal(malformedJoin.statusCode, 404);
  } finally {
    await closeHarness(harness);
  }
});

test('room identity inputs support international names and bound passwords', async () => {
  const harness = await createHarness();
  try {
    const unicodeName = await createRoom(harness, 'Duy Nguyễn');
    assert.equal(unicodeName.room.players[0]?.displayName, 'Duy Nguyễn');

    const controlName = await harness.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: { displayName: 'Alice\nBob' },
    });
    assert.equal(controlName.statusCode, 400);

    for (const separator of ['\u2028', '\u2029']) {
      const separatorName = await harness.app.inject({
        method: 'POST',
        url: '/rooms/create',
        payload: { displayName: `Alice${separator}Bob` },
      });
      assert.equal(separatorName.statusCode, 400);
    }

    const oversizedCreatePassword = await harness.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: { displayName: 'Alice', password: 'x'.repeat(65) },
    });
    assert.equal(oversizedCreatePassword.statusCode, 400);

    const oversizedJoinPassword = await harness.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: unicodeName.roomCode, displayName: 'Bob', password: 'x'.repeat(65) },
    });
    assert.equal(oversizedJoinPassword.statusCode, 400);
  } finally {
    await closeHarness(harness);
  }
});

test('REST payloads and bounded create/join quotas reject abusive requests', async () => {
  const payloadHarness = await createHarness();
  try {
    const oversized = await payloadHarness.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: { displayName: 'Alice', password: 'x'.repeat(REST_BODY_LIMIT_BYTES) },
    });
    assert.equal(oversized.statusCode, 413);
  } finally {
    await closeHarness(payloadHarness);
  }

  const createHarnessUnderTest = await createHarness();
  try {
    for (let attempt = 0; attempt < REST_RATE_LIMITS.createPerIp.limit; attempt += 1) {
      const invalid = await createHarnessUnderTest.app.inject({
        method: 'POST',
        url: '/rooms/create',
        payload: {},
      });
      assert.equal(invalid.statusCode, 400);
    }
    const limited = await createHarnessUnderTest.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: {},
    });
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers['retry-after']) >= 1);
  } finally {
    await closeHarness(createHarnessUnderTest);
  }

  const joinHarnessUnderTest = await createHarness();
  try {
    const alice = await createRoom(joinHarnessUnderTest, 'Alice');
    for (let attempt = 0; attempt < REST_RATE_LIMITS.joinPerRoom.limit; attempt += 1) {
      const duplicate = await joinHarnessUnderTest.app.inject({
        method: 'POST',
        url: '/rooms/join',
        payload: { roomCode: alice.roomCode, displayName: 'Alice' },
      });
      assert.equal(duplicate.statusCode, 409);
    }
    const limited = await joinHarnessUnderTest.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: alice.roomCode, displayName: 'Alice' },
    });
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers['retry-after']) >= 1);
  } finally {
    await closeHarness(joinHarnessUnderTest);
  }
});

test('join-IP and general REST quotas are independently enforced', async () => {
  const joinHarnessUnderTest = await createHarness();
  try {
    for (let attempt = 0; attempt < REST_RATE_LIMITS.joinPerIp.limit; attempt += 1) {
      const missing = await joinHarnessUnderTest.app.inject({
        method: 'POST',
        url: '/rooms/join',
        payload: { roomCode: 'ABCD-EFGH', displayName: 'Alice' },
      });
      assert.equal(missing.statusCode, 404);
    }
    const limited = await joinHarnessUnderTest.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: 'ABCD-EFGH', displayName: 'Alice' },
    });
    assert.equal(limited.statusCode, 429);
  } finally {
    await closeHarness(joinHarnessUnderTest);
  }

  const generalHarnessUnderTest = await createHarness();
  try {
    for (let attempt = 0; attempt < REST_RATE_LIMITS.generalPerIp.limit; attempt += 1) {
      const unauthorised = await generalHarnessUnderTest.app.inject({
        method: 'GET',
        url: '/rooms/ABCD-EFGH',
      });
      assert.equal(unauthorised.statusCode, 401);
    }
    const limited = await generalHarnessUnderTest.app.inject({
      method: 'GET',
      url: '/rooms/ABCD-EFGH',
    });
    assert.equal(limited.statusCode, 429);
  } finally {
    await closeHarness(generalHarnessUnderTest);
  }
});

test('room passwords are salted at rest and still enforce exact joins', async () => {
  const harness = await createHarness();
  try {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: { displayName: 'Alice', password: 'correct horse battery staple' },
    });
    assert.equal(response.statusCode, 201);
    const alice = response.json<JoinRoomResponse>();
    harness.roomCodes.add(alice.roomCode);

    const stored = roomStore.get(alice.roomCode)?.passwordHash;
    assert.ok(stored?.startsWith('scrypt-v1:'));
    assert.equal(stored!.includes('correct horse battery staple'), false);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: alice.roomCode, displayName: 'Bob', password: 'wrong' },
    });
    assert.equal(wrong.statusCode, 403);

    const concurrentWrong = await Promise.all(Array.from(
      { length: MAX_CONCURRENT_PASSWORD_OPERATIONS + 1 },
      (_, index) => harness.app.inject({
        method: 'POST',
        url: '/rooms/join',
        payload: {
          roomCode: alice.roomCode,
          displayName: `Wrong ${index}`,
          password: 'wrong',
        },
      }),
    ));
    assert.deepEqual(
      concurrentWrong.map(({ statusCode }) => statusCode).sort((a, b) => a - b),
      [403, 403, 403, 403, 429],
    );

    const correct = await harness.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: alice.roomCode, displayName: 'Bob', password: 'correct horse battery staple' },
    });
    assert.equal(correct.statusCode, 200);
  } finally {
    await closeHarness(harness);
  }
});

test('a password check cannot admit a player after its room is deleted', async () => {
  const harness = await createHarness();
  try {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/rooms/create',
      payload: { displayName: 'Alice', password: 'race-proof' },
    });
    assert.equal(response.statusCode, 201);
    const alice = response.json<JoinRoomResponse>();
    harness.roomCodes.add(alice.roomCode);

    const pendingJoin = harness.app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { roomCode: alice.roomCode, displayName: 'Bob', password: 'race-proof' },
    });
    setTimeout(() => roomStore.delete(alice.roomCode), 1);
    const joined = await pendingJoin;
    assert.equal(joined.statusCode, 404);
    assert.equal(roomStore.get(alice.roomCode), undefined);
  } finally {
    await closeHarness(harness);
  }
});

test('Saboteur payload validation rejects coercion, malformed shapes and out-of-cap coordinates', () => {
  assert.equal(isPassTurnPayload({}), false);
  assert.equal(isChooseGoldPayload({ cardIndex: 0 }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: 1, col: 4 }, rotated: false }), true);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: '1', col: 4 }, rotated: false }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: 1.5, col: 4 }, rotated: false }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: 9, col: 4 }, rotated: false }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'action-1', position: { row: 1, col: 4 }, rotated: false }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: 1, col: 4 }, rotated: 'false' }), false);
  assert.equal(isPlaceCardPayload({ expectedRevision: 1, cardId: 'path-1', position: { row: 1, col: 4 }, rotated: false, extra: true }), false);

  assert.equal(isPlayActionPayload({ expectedRevision: 1, cardId: 'action-1', chosenTool: 'cart' }), true);
  assert.equal(isPlayActionPayload({ expectedRevision: 1, cardId: 'path-1', chosenTool: 'cart' }), false);
  assert.equal(isPlayActionPayload({ expectedRevision: 1, cardId: 'action-1', chosenTool: 'rope' }), false);
  assert.equal(isPlayActionPayload({ expectedRevision: 1, cardId: 'action-1', targetPosition: [1, 4] }), false);
  assert.equal(isPlayActionPayload({ expectedRevision: 1, cardId: 'action-1', targetPlayerId: 42 }), false);

  assert.equal(isPassTurnPayload({ expectedRevision: 1 }), true);
  assert.equal(isPassTurnPayload({ expectedRevision: 1, discardCardId: 'path-2' }), true);
  assert.equal(isPassTurnPayload({ expectedRevision: 1, discardCardId: 2 }), false);
  assert.equal(isPassTurnPayload(null), false);

  assert.equal(isChooseGoldPayload({ expectedRevision: 1, cardIndex: 0 }), true);
  assert.equal(isChooseGoldPayload({ expectedRevision: 1, cardIndex: '0' }), false);
  assert.equal(isChooseGoldPayload({ expectedRevision: 1, cardIndex: 0.5 }), false);
  assert.equal(isChooseGoldPayload({ expectedRevision: 1, cardIndex: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(isChooseGoldPayload({ expectedRevision: 1, cardIndex: 0, extra: true }), false);
});

test('a REST-only lobby reservation expires and removes an empty room', async () => {
  const room = roomStore.create('ghost', null, 'saboteur', {});
  const player = roomStore.addPlayer(
    room,
    { playerId: 'ghost', displayName: 'Ghost', isHost: true },
    Date.now() + 10,
  );
  const fakeIo = { to: () => ({ emit: () => undefined }) } as unknown as Server;
  scheduleLobbyReservationExpiry(fakeIo, room, player);
  await waitUntil(() => !roomStore.get(room.roomCode));
});

test('socket event, reaction and payload limits reject abusive clients', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    const carolSocket = await connect(harness, carol.token);

    const actionLimited = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    for (let attempt = 0; attempt <= SOCKET_RATE_LIMITS.events.limit; attempt += 1) {
      aliceSocket.emit('security_test_noop', {});
    }
    assert.match((await actionLimited).reason, /Too many actions/);

    let reactionRejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('player_reaction', { reaction: 'Custom unbounded reaction' });
    assert.equal((await reactionRejected).reason, 'Invalid reaction');

    for (let attempt = 1; attempt < SOCKET_RATE_LIMITS.reactions.limit; attempt += 1) {
      const received = waitForEvent<{ playerId: string; reaction: string }>(
        bobSocket,
        'reaction_received',
      );
      bobSocket.emit('player_reaction', { reaction: ALLOWED_PLAYER_REACTIONS[0] });
      assert.deepEqual(await received, {
        playerId: bob.playerId,
        reaction: ALLOWED_PLAYER_REACTIONS[0],
      });
    }
    reactionRejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('player_reaction', { reaction: ALLOWED_PLAYER_REACTIONS[0] });
    assert.match((await reactionRejected).reason, /Too many reactions/);

    const oversizedDisconnected = waitForEvent(carolSocket, 'disconnect');
    carolSocket.emit('security_test_oversized', 'x'.repeat(SOCKET_PAYLOAD_LIMIT_BYTES + 1));
    await oversizedDisconnected;
    assert.equal(carolSocket.connected, false);
  } finally {
    await closeHarness(harness);
  }
});

test('a newer socket supersedes the old socket and every event rechecks socket ownership', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const first = await connect(harness, alice.token);
    const replaced = waitForEvent(first, 'session_replaced');
    const firstDisconnected = waitForEvent(first, 'disconnect');
    const second = await connect(harness, alice.token);

    await replaced;
    await firstDisconnected;
    assert.equal(first.connected, false);
    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.players.get(alice.playerId)?.socketId, second.id);

    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    roomStore.removePlayer(room, bob.playerId);
    const missingMember = waitForEvent<{ message: string }>(bobSocket, 'server_error');
    bobSocket.emit('request_state');
    assert.match((await missingMember).message, /no longer owns/);
    await waitUntil(() => !bobSocket.connected);

    room.players.get(alice.playerId)!.socketId = 'not-the-current-socket';
    const rejected = waitForEvent<{ message: string }>(second, 'server_error');
    second.emit('request_state');
    assert.match((await rejected).message, /no longer owns/);
    await waitUntil(() => !second.connected);
  } finally {
    await closeHarness(harness);
  }
});

test('an in-game host expiry transfers control and cannot deadlock the later rematch', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'coup');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    aliceSocket.disconnect();
    const room = roomStore.get(alice.roomCode)!;
    await waitUntil(() => room.players.get(alice.playerId)?.isConnected === false);
    assert.equal(room.hostPlayerId, alice.playerId);
    assert.equal(room.players.get(alice.playerId)?.isHost, true);
    assert.equal(room.players.get(bob.playerId)?.isHost, false);

    await connect(harness, alice.token);
    assert.equal(room.hostPlayerId, alice.playerId);
    assert.equal(room.players.get(alice.playerId)?.isHost, true);

    const currentSocketId = room.players.get(alice.playerId)?.socketId;
    assert.ok(currentSocketId);
    assert.equal(
      markPlayerDisconnected(harness.io, room, alice.playerId, currentSocketId, 10),
      true,
    );
    await waitUntil(() => room.hostPlayerId === bob.playerId);
    assert.equal(room.players.get(bob.playerId)?.isHost, true);
    assert.equal(room.players.has(alice.playerId), true);
    assert.equal(room.players.get(alice.playerId)?.hasLeft, true);

    room.status = 'finished';
    bobSocket.emit('start_game', {});
    await waitUntil(() => room.status === 'in_game');
    assert.equal(room.status, 'in_game');
    assert.equal(room.game?.id, 'coup');
    assert.equal(room.game?.id === 'coup' ? room.game.state.players.size : 0, 2);
  } finally {
    await closeHarness(harness);
  }
});

test('a non-host leave cannot steal authority from a host still inside reconnect grace', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'coup');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    aliceSocket.disconnect();
    const room = roomStore.get(alice.roomCode)!;
    await waitUntil(() => room.players.get(alice.playerId)?.isConnected === false);
    assert.equal(room.hostPlayerId, alice.playerId);

    const left = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/leave`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    assert.equal(left.statusCode, 200);
    assert.equal(room.players.get(bob.playerId)?.hasLeft, true);
    assert.equal(room.hostPlayerId, alice.playerId);

    await connect(harness, alice.token);
    assert.equal(room.hostPlayerId, alice.playerId);
    assert.equal(room.players.get(alice.playerId)?.isHost, true);
    assert.equal(room.players.get(carol.playerId)?.isHost, false);
  } finally {
    await closeHarness(harness);
  }
});

test('a delayed expiry callback cannot let an overdue in-game seat reconnect', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'coup');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);
    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;

    bobSocket.disconnect();
    const room = roomStore.get(alice.roomCode)!;
    await waitUntil(() => room.players.get(bob.playerId)?.isConnected === false);
    room.players.get(bob.playerId)!.reconnectDeadlineAt = Date.now() - 1;

    const replacement = createSocketClient(harness, bob.token);
    const rejected = waitForEvent<{ message: string }>(replacement, 'server_error');
    const disconnected = waitForEvent(replacement, 'disconnect');
    assert.match((await rejected).message, /no longer available/);
    await disconnected;

    assert.equal(room.players.get(bob.playerId)?.hasLeft, true);
    assert.equal(room.players.get(bob.playerId)?.presenceTimer, null);
    assert.equal(room.game?.id === 'coup' ? room.game.state.players.get(bob.playerId)?.eliminated : false, true);
  } finally {
    await closeHarness(harness);
  }
});

test('a non-host cannot steal an unconnected host reservation by starting the game', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'coup');
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);

    const rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('start_game');
    assert.match((await rejected).reason, /Only the host/);

    const room = roomStore.get(alice.roomCode)!;
    assert.equal(room.status, 'lobby');
    assert.equal(room.game, null);
    assert.equal(room.hostPlayerId, alice.playerId);
    assert.equal(room.players.get(alice.playerId)?.isHost, true);
    assert.equal(room.players.get(alice.playerId)?.isConnected, false);
    assert.equal(getRoomPublicState(room).players.find((player) => player.playerId === alice.playerId)?.hasLeft, false);
    assert.equal(room.players.size, 3);
  } finally {
    await closeHarness(harness);
  }
});

for (const gameId of ['saboteur', 'bang', 'coup', 'king_of_tokyo']) {
  test(`${gameId} malformed host start cannot prune an overdue reserved seat`, async () => {
    const harness = await createHarness();
    try {
      const host = await createRoom(harness, 'Host', gameId);
      const hostSocket = await connect(harness, host.token);
      const minimum = gameId === 'bang' ? 4 : ['coup', 'king_of_tokyo'].includes(gameId) ? 2 : 3;
      for (let index = 1; index < minimum; index++) {
        const joined = await joinRoom(harness, host.roomCode, `Player ${index}`);
        await connect(harness, joined.token);
      }
      const reserved = await joinRoom(harness, host.roomCode, 'Reserved');
      const room = roomStore.get(host.roomCode)!;
      const seat = room.players.get(reserved.playerId)!;
      roomStore.clearPresenceTimer(seat);
      seat.reconnectDeadlineAt = Date.now() - 1;
      const before = JSON.stringify(getRoomPublicState(room));
      const rejected = waitForEvent<{ reason: string }>(hostSocket, 'action_rejected');
      hostSocket.emit('start_game', { forged: true });
      assert.equal((await rejected).reason, 'Invalid payload');
      assert.equal(JSON.stringify(getRoomPublicState(room)), before);
      assert.equal(room.players.get(reserved.playerId), seat);
      assert.equal(room.game, null);
      assert.equal(room.status, 'lobby');
    } finally { await closeHarness(harness); }
  });
}

test('the shared start guard prevents non-host starts and mid-game state replacement', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'colt_express');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);

    let rejected = waitForEvent<{ reason: string }>(bobSocket, 'action_rejected');
    bobSocket.emit('start_game');
    assert.match((await rejected).reason, /Only the host/);

    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game');
    await started;
    const room = roomStore.get(alice.roomCode)!;
    const originalGame = room.game;
    const originalRevision = room.game?.id === 'colt_express' ? room.game.state.revision : null;

    rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game');
    assert.match((await rejected).reason, /already in progress/i);
    assert.equal(room.game, originalGame);
    assert.equal(room.game?.id === 'colt_express' ? room.game.state.revision : null, originalRevision);
  } finally {
    await closeHarness(harness);
  }
});

test('start_game preserves in-grace connecting seats and blocks active-game kicks', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    const carolSocket = await connect(harness, carol.token);
    carolSocket.disconnect();
    await waitUntil(() => roomStore.get(alice.roomCode)?.players.get(carol.playerId)?.isConnected === false);
    const ghost = await joinRoom(harness, alice.roomCode, 'Ghost');

    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game');
    assert.match((await rejected).reason, /2 players are connecting or reconnecting/);
    assert.equal(roomStore.get(alice.roomCode)?.players.has(ghost.playerId), true);
    assert.equal(roomStore.get(alice.roomCode)?.players.has(carol.playerId), true);

    const removeGhost = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/kick`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { targetPlayerId: ghost.playerId },
    });
    assert.equal(removeGhost.statusCode, 200);

    await connect(harness, carol.token);
    const started = waitForEvent<{ players: unknown[] }>(aliceSocket, 'game_state');
    aliceSocket.emit('start_game');
    assert.equal((await started).players.length, 3);

    const malformed = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('place_card', {
      cardId: 'path-1',
      position: { row: 1, col: 4 },
      rotated: 'false',
    });
    assert.equal((await malformed).reason, 'Invalid payload');

    const kick = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/kick`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { targetPlayerId: bob.playerId },
    });
    assert.equal(kick.statusCode, 409);
    assert.equal(roomStore.get(alice.roomCode)?.players.has(bob.playerId), true);
  } finally {
    await closeHarness(harness);
  }
});

test('a finished game preserves a reconnecting rematch seat until grace expires', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice', 'king_of_tokyo');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    const room = roomStore.get(alice.roomCode)!;
    room.status = 'finished';

    bobSocket.disconnect();
    await waitUntil(() => room.players.get(bob.playerId)?.isConnected === false);
    const rejected = waitForEvent<{ reason: string }>(aliceSocket, 'action_rejected');
    aliceSocket.emit('start_game', {});
    assert.match((await rejected).reason, /1 player is connecting or reconnecting/);
    assert.equal(room.players.has(bob.playerId), true);

    await connect(harness, bob.token);
    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game', {});
    await started;
    assert.equal(room.status, 'in_game');
    assert.equal(room.game?.id, 'king_of_tokyo');
  } finally {
    await closeHarness(harness);
  }
});

test('a finished-room reconnect expiry marks the seat left and transfers rematch control', async () => {
  const room = roomStore.create('alice', null, 'coup', {});
  try {
    roomStore.addPlayer(
      room,
      { playerId: 'alice', displayName: 'Alice', isHost: true },
      Date.now() + 1_000,
    );
    roomStore.addPlayer(
      room,
      { playerId: 'bob', displayName: 'Bob', isHost: false },
      Date.now() + 1_000,
    );
    roomStore.addPlayer(
      room,
      { playerId: 'carol', displayName: 'Carol', isHost: false },
      Date.now() + 1_000,
    );
    roomStore.markConnected(room, 'alice', 'alice-socket');
    roomStore.markConnected(room, 'bob', 'bob-socket');
    roomStore.markConnected(room, 'carol', 'carol-socket');
    room.status = 'finished';

    const emitted: { event: string; payload: unknown }[] = [];
    const fakeIo = {
      to: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
    } as unknown as Server;
    assert.equal(markPlayerDisconnected(fakeIo, room, 'alice', 'alice-socket', 10), true);
    assert.equal(room.hostPlayerId, 'alice');
    await waitUntil(() => room.players.get('alice')?.hasLeft === true);

    assert.equal(room.players.get('alice')?.socketId, null);
    assert.equal(room.hostPlayerId, 'bob');
    assert.equal(room.players.get('bob')?.isHost, true);
    assert.ok(emitted.some(({ event }) => event === 'room_updated'));

    const rejections: unknown[] = [];
    const fakeSocket = {
      emit: (_event: string, payload: unknown) => rejections.push(payload),
    } as unknown as Socket;
    assert.equal(prepareRoomForStart(fakeIo, fakeSocket, room), true);
    assert.deepEqual(rejections, []);
  } finally {
    roomStore.delete(room.roomCode);
  }
});

test('kick is room-bound, removes the lobby member and forcibly disconnects its socket', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    const bobSocket = await connect(harness, bob.token);
    assert.equal(roomStore.get(alice.roomCode)?.hostPlayerId, alice.playerId);
    await connect(harness, alice.token);
    const mallory = await createRoom(harness, 'Mallory');

    const crossRoomKick = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/kick`,
      headers: { authorization: `Bearer ${mallory.token}` },
      payload: { targetPlayerId: bob.playerId },
    });
    assert.equal(crossRoomKick.statusCode, 403);

    const kicked = waitForEvent(bobSocket, 'player_kicked');
    const disconnected = waitForEvent(bobSocket, 'disconnect');
    const response = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/kick`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { targetPlayerId: bob.playerId },
    });
    assert.equal(response.statusCode, 200);
    await kicked;
    await disconnected;
    assert.equal(roomStore.get(alice.roomCode)?.players.has(bob.playerId), false);
  } finally {
    await closeHarness(harness);
  }
});

test('active leave transfers host, invalidates reconnection and forfeits without an automatic turn', async () => {
  const harness = await createHarness();
  try {
    const alice = await createRoom(harness, 'Alice');
    const aliceSocket = await connect(harness, alice.token);
    const bob = await joinRoom(harness, alice.roomCode, 'Bob');
    await connect(harness, bob.token);
    const carol = await joinRoom(harness, alice.roomCode, 'Carol');
    await connect(harness, carol.token);

    const started = waitForEvent(aliceSocket, 'game_state');
    aliceSocket.emit('start_game');
    await started;
    const playerLeft = waitForEvent(aliceSocket, 'player_left');
    const disconnected = waitForEvent(aliceSocket, 'disconnect');
    const response = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/leave`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ retainedForGameRecovery: boolean }>().retainedForGameRecovery, true);
    await playerLeft;
    await disconnected;

    const room = roomStore.get(alice.roomCode)!;
    await waitUntil(() => room.game?.id === 'saboteur' && room.game.state.status === 'game_over');
    assert.equal(room.hostPlayerId, bob.playerId);
    assert.equal(room.players.get(bob.playerId)?.isHost, true);
    assert.equal(room.players.get(alice.playerId)?.hasLeft, true);
    const publicPlayers = getRoomPublicState(room).players;
    assert.equal(publicPlayers.find((player) => player.playerId === alice.playerId)?.hasLeft, true);
    assert.equal(publicPlayers.find((player) => player.playerId === bob.playerId)?.hasLeft, false);
    assert.equal(room.game?.id, 'saboteur');
    if (room.game?.id !== 'saboteur') throw new Error('Wrong game');
    assert.equal(room.game.state.discard.length, 6);
    assert.equal(room.game.state.players.get(alice.playerId)!.hand.length, 0);
    assert.equal(room.game.state.players.get(alice.playerId)!.forfeited, true);
    assert.equal(room.game.state.lastActorId, null);
    assert.equal(room.game.state.terminationReason, 'not_enough_players');
    assert.deepEqual(room.game.state.winnerIds, []);
    assert.equal(room.status, 'finished');

    const secondLeave = await harness.app.inject({
      method: 'POST',
      url: `/rooms/${alice.roomCode}/leave`,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    assert.equal(secondLeave.statusCode, 403);
  } finally {
    await closeHarness(harness);
  }
});

test('expired gold pickers are removed without receiving a reward or exposing values publicly', () => {
  const room = roomStore.create('alice', null, 'saboteur', {});
  try {
    const alice = roomStore.addPlayer(room, { playerId: 'alice', displayName: 'Alice', isHost: true }, Date.now() + 1_000);
    for (const playerId of ['bob', 'carol', 'dan']) {
      roomStore.addPlayer(room, { playerId, displayName: playerId, isHost: false }, Date.now() + 1_000);
      roomStore.markConnected(room, playerId, `${playerId}-socket`);
    }
    alice.reconnectDeadlineAt = Date.now() - 1;
    room.status = 'in_game';
    const state = initGame(room.roomCode, [
      { playerId: 'alice', displayName: 'Alice' },
      { playerId: 'bob', displayName: 'Bob' },
      { playerId: 'carol', displayName: 'Carol' },
      { playerId: 'dan', displayName: 'Dan' },
    ]);
    for (const player of state.players.values()) player.role = ['alice', 'bob'].includes(player.playerId) ? 'miner' : 'saboteur';
    state.status = 'round_end';
    state.roundWinner = 'miners';
    state.goldDistribution = initGoldDistribution(state.players, state.turnOrder, 'alice', state.goldDeck);
    room.game = { id: 'saboteur', state };

    const emitted: { event: string; payload: unknown }[] = [];
    const fakeIo = {
      to: () => ({ emit: (event: string, payload: unknown) => emitted.push({ event, payload }) }),
    } as unknown as Server;
    assert.equal(recoverDisconnectedSaboteurPlayers(fakeIo, room), true);
    assert.equal(state.goldDistribution.currentIndex, 0);
    assert.deepEqual(state.goldDistribution.order, ['bob']);
    assert.equal(state.goldDistribution.assignments.has('alice'), false);
    assert.equal(state.players.get('alice')!.goldCollected, 0);
    assert.equal(state.players.get('alice')!.forfeited, true);
    assert.equal(state.goldDistribution.availableCards.length, 1);
    assert.ok(emitted.some(({ event }) => event === 'game_state'));
    const publicState = emitted.find(({ event }) => event === 'game_state')!.payload;
    assert(!JSON.stringify(publicState).includes('availableCards'));
  } finally {
    roomStore.delete(room.roomCode);
  }
});
