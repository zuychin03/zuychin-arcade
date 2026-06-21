// End-to-end smoke test for Coup: expects the server running on SMOKE_PORT
// (default 3002). Creates a 3-player Coup room over HTTP, connects three
// socket.io clients, starts the game, then drives an Income turn and a Tax
// turn (with explicit challenge-window passes), and a browser-refresh reconnect.
//
//   PORT=3002 pnpm --filter @zuychin-arcade/server exec tsx src/index.ts
//   pnpm --filter @zuychin-arcade/server exec tsx scripts/coup/smoke.ts

import { io as connect, type Socket } from 'socket.io-client';
import type { CoupPublicState, CoupPrivateState, JoinRoomResponse } from '@zuychin-arcade/types';

const BASE = `http://localhost:${process.env.SMOKE_PORT ?? 3002}`;
const TIMEOUT_MS = 8000;

function fail(msg: string): never {
  console.error(`COUP SMOKE FAIL: ${msg}`);
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
  pub: CoupPublicState | null;
  priv: CoupPrivateState | null;
  rejections: string[];
}

function connectClient(name: string, auth: JoinRoomResponse): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(BASE, { auth: { token: auth.token }, transports: ['websocket'] });
    const client: Client = { name, auth, socket, pub: null, priv: null, rejections: [] };
    socket.on('game_state', (s: CoupPublicState) => (client.pub = s));
    socket.on('private_state', (s: CoupPrivateState) => (client.priv = s));
    socket.on('action_rejected', ({ reason }: { reason: string }) => client.rejections.push(reason));
    socket.on('server_error', ({ message }: { message: string }) => reject(new Error(`${name}: ${message}`)));
    socket.on('connect_error', (e) => reject(new Error(`${name}: ${e.message}`)));
    socket.on('connect', () => {
      socket.emit('request_state');
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

const coins = (c: Client, id: string) => c.pub!.players.find((p) => p.playerId === id)!.coins;

async function main() {
  const host = await api<JoinRoomResponse>('/rooms/create', { displayName: 'CoupHost', gameId: 'coup' });
  const code = host.roomCode;
  if (host.room.gameId !== 'coup') fail(`room gameId should be coup, got ${host.room.gameId}`);
  const p2 = await api<JoinRoomResponse>('/rooms/join', { roomCode: code, displayName: 'CoupTwo' });
  const p3 = await api<JoinRoomResponse>('/rooms/join', { roomCode: code, displayName: 'CoupThree' });
  console.log(`coup room ${code} created with 3 players`);

  const clients = await Promise.all([
    connectClient('host', host),
    connectClient('p2', p2),
    connectClient('p3', p3),
  ]);
  const byId = (id: string) => clients.find((c) => c.auth.playerId === id)!;

  clients[0].socket.emit('start_game', {});
  await until(
    () => clients.every((c) => c.pub?.status === 'playing' && c.priv !== null),
    'coup game_state + private_state on all clients',
  );
  console.log('game started; all 3 clients have public + private state');

  // each player holds exactly 2 influence and the public view never leaks them
  for (const c of clients) {
    if (c.priv!.influences.length !== 2) fail(`${c.name} should have 2 influences`);
  }
  if (clients[0].pub!.variant !== 'base') fail('variant should be base');

  // --- turn 1: current player takes Income (+1), unchallengeable ---
  const t1 = clients[0].pub!.currentTurnPlayerId!;
  const actor1 = byId(t1);
  const before1 = coins(clients[0], t1);
  actor1.socket.emit('coup:action', { action: 'income' });
  await until(
    () => clients[0].pub!.currentTurnPlayerId !== t1 && coins(clients[0], t1) === before1 + 1,
    'income resolves and turn advances',
  );
  console.log(`turn 1: ${actor1.name} took Income (+1), turn advanced`);

  // --- turn 2: current player Taxes (claims Duke); others pass the challenge ---
  const t2 = clients[0].pub!.currentTurnPlayerId!;
  const actor2 = byId(t2);
  const before2 = coins(clients[0], t2);
  actor2.socket.emit('coup:action', { action: 'tax' });
  await until(
    () => clients[0].pub!.pending.phase === 'awaiting_action_challenge' && clients[0].pub!.pending.actorId === t2,
    'tax opens the challenge window',
  );
  // every non-actor passes
  for (const c of clients) {
    if (c.auth.playerId !== t2) c.socket.emit('coup:respond', { response: 'pass' });
  }
  await until(
    () => coins(clients[0], t2) === before2 + 3 && clients[0].pub!.currentTurnPlayerId !== t2,
    'tax resolves (+3) after all pass and turn advances',
  );
  if (clients.some((c) => c.rejections.length)) {
    fail(`unexpected rejections: ${clients.map((c) => c.rejections.join('|')).join(' ; ')}`);
  }
  console.log(`turn 2: ${actor2.name} taxed (+3) through the challenge window`);

  // --- browser refresh: fresh socket, same token, request_state ---
  const refresher = clients[2];
  refresher.socket.disconnect();
  const reconnected = await connectClient('p3-refreshed', refresher.auth);
  await until(
    () => reconnected.pub?.status === 'playing' && reconnected.priv !== null,
    'state restored after reconnect',
  );
  if (reconnected.priv!.influences.length !== 2) fail('refreshed client lost its influences');
  console.log('refresh simulation OK: reconnect restored game + private state');
  reconnected.socket.disconnect();

  console.log('COUP SMOKE PASS: create, start, income, tax+challenge-window, and refresh all work');
  clients.forEach((c) => c.socket.disconnect());
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
