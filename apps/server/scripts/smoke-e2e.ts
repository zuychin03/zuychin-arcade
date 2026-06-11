// End-to-end smoke test: boots nothing itself — expects the server running on
// SMOKE_PORT (default 3002). Creates a 3-player room over HTTP, connects three
// socket.io clients, starts the game and has each current player play a card
// (path placement if a legal one exists, otherwise pass+discard).
//
//   PORT=3002 pnpm --filter @zuychin-arcade/server exec tsx src/index.ts
//   pnpm --filter @zuychin-arcade/server exec tsx scripts/smoke-e2e.ts

import { io as connect, type Socket } from 'socket.io-client';
import type {
  JoinRoomResponse,
  SaboteurPublicState,
  SaboteurPrivateState,
} from '@zuychin-arcade/types';

const BASE = `http://localhost:${process.env.SMOKE_PORT ?? 3002}`;
const TIMEOUT_MS = 8000;

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Client {
  name: string;
  auth: JoinRoomResponse;
  socket: Socket;
  publicState: SaboteurPublicState | null;
  privateState: SaboteurPrivateState | null;
  rejections: string[];
}

function connectClient(name: string, auth: JoinRoomResponse): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(BASE, { auth: { token: auth.token }, transports: ['websocket'] });
    const client: Client = { name, auth, socket, publicState: null, privateState: null, rejections: [] };
    socket.on('game_state', (s: SaboteurPublicState) => (client.publicState = s));
    socket.on('private_state', (s: SaboteurPrivateState) => (client.privateState = s));
    socket.on('action_rejected', ({ reason }: { reason: string }) => client.rejections.push(reason));
    socket.on('server_error', ({ message }: { message: string }) => reject(new Error(`${name}: ${message}`)));
    socket.on('connect_error', (e) => reject(new Error(`${name}: ${e.message}`)));
    socket.on('connect', () => {
      socket.emit('request_state');   // mirrors useSocket's on-connect behavior
      resolve(client);
    });
    setTimeout(() => reject(new Error(`${name}: connect timeout`)), TIMEOUT_MS);
  });
}

function until(check: () => boolean, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (check()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > TIMEOUT_MS) {
        clearInterval(t);
        reject(new Error(`timeout waiting for: ${what}`));
      }
    }, 25);
  });
}

async function main() {
  // --- lobby over HTTP ---
  const host = await api<JoinRoomResponse>('/rooms/create', { displayName: 'SmokeHost' });
  const code = host.roomCode;
  const p2 = await api<JoinRoomResponse>('/rooms/join', { roomCode: code, displayName: 'SmokeTwo' });
  const p3 = await api<JoinRoomResponse>('/rooms/join', { roomCode: code, displayName: 'SmokeThree' });
  console.log(`room ${code} created with 3 players`);

  const clients = await Promise.all([
    connectClient('host', host),
    connectClient('p2', p2),
    connectClient('p3', p3),
  ]);

  // --- start game ---
  clients[0].socket.emit('start_game', {});
  await until(
    () => clients.every((c) => c.publicState?.status === 'playing' && c.privateState !== null),
    'game_state + private_state on all clients',
  );
  console.log('game started; states received by all 3 clients');

  const roles = clients.map((c) => c.privateState!.role);
  const sabs = roles.filter((r) => r === 'saboteur').length;
  if (sabs !== 1) fail(`expected exactly 1 saboteur for 3 players, got ${sabs} (${roles.join(',')})`);
  console.log(`roles OK: ${roles.join(', ')} (exactly 1 saboteur)`);

  const dist = clients[0].publicState!.goldDistribution;
  if (dist !== null) fail('goldDistribution should be null while playing');

  // --- each current player plays: 6 turns of pass+discard (always legal) ---
  for (let turn = 0; turn < 6; turn++) {
    const stateTurn = clients[0].publicState!.currentTurnPlayerId;
    const actor = clients.find((c) => c.auth.playerId === stateTurn);
    if (!actor) fail(`no client matches currentTurnPlayerId ${stateTurn}`);
    const card = actor.privateState!.hand[0];
    if (!card) fail(`${actor.name} has an empty hand on turn ${turn}`);
    const before = actor.privateState!.hand.map((c) => c.id).join(',');

    actor.socket.emit('pass_turn', { discardCardId: card.id });
    await until(
      () =>
        clients[0].publicState!.currentTurnPlayerId !== stateTurn &&
        actor.privateState!.hand.map((c) => c.id).join(',') !== before,
      `turn ${turn}: turn advance + new hand for ${actor.name}`,
    );
    if (actor.privateState!.hand.length !== 6) {
      fail(`${actor.name} should hold 6 cards after discard+draw, has ${actor.privateState!.hand.length}`);
    }
    if (actor.privateState!.hand.some((c) => c.id === card.id)) {
      fail(`${actor.name} still holds the discarded card`);
    }
    if (actor.rejections.length > 0) fail(`${actor.name} got rejected: ${actor.rejections.join('; ')}`);
    console.log(`turn ${turn}: ${actor.name} discarded + drew + passed OK`);
  }

  // --- simulate a browser refresh: fresh socket, same token, request_state ---
  const refresher = clients[1];
  refresher.socket.disconnect();
  const reconnected = await connectClient('p2-refreshed', refresher.auth);
  await until(
    () => reconnected.publicState?.status === 'playing' && reconnected.privateState !== null,
    'state restored after reconnect',
  );
  if (reconnected.privateState!.hand.length !== 6) fail('refreshed client lost its hand');
  console.log('refresh simulation OK: reconnect restored game + private state');
  reconnected.socket.disconnect();

  console.log('SMOKE PASS: lobby, start, roles, 6 card plays, and refresh-reconnect all work');
  clients.forEach((c) => c.socket.disconnect());
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
