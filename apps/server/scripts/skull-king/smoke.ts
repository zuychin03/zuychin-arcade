import { io as connect, type Socket } from 'socket.io-client';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import type {
  JoinRoomResponse,
  RoomPublicState,
  SkullKingActionAccepted,
  SkullKingPrivateState,
  SkullKingPublicState,
} from '@zuychin-arcade/types';

process.env.JWT_SECRET ??= 'skull-king-isolated-smoke-only-secret';
assert.equal(supabase, null, 'Skull King smoke refuses hosted persistence');
let BASE = '';
const ownRooms = new Set<string>();
const sockets: Socket[] = [];
const TIMEOUT = 10_000;

function fail(message: string): never {
  throw new Error('SKULL KING SMOKE FAIL: ' + message);
}

async function api<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(path + ': ' + response.status + ' ' + await response.text());
  return response.json() as Promise<T>;
}

interface Client {
  auth: JoinRoomResponse;
  socket: Socket;
  room: RoomPublicState | null;
  game: SkullKingPublicState | null;
  mine: SkullKingPrivateState | null;
  rejections: string[];
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error('timeout waiting for ' + event));
    }, TIMEOUT);
    const onEvent = (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    };
    socket.once(event, onEvent);
  });
}

function connectClient(auth: JoinRoomResponse): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(BASE, {
      auth: { token: auth.token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const client: Client = {
      auth,
      socket,
      room: null,
      game: null,
      mine: null,
      rejections: [],
    };
    sockets.push(socket);
    socket.on('room_updated', (room: RoomPublicState) => { client.room = room; });
    socket.on('game_state', (game: SkullKingPublicState) => { client.game = game; });
    socket.on('private_state', (mine: SkullKingPrivateState) => { client.mine = mine; });
    socket.on('action_rejected', ({ reason }: { reason: string }) => client.rejections.push(reason));
    const timeout = setTimeout(() => reject(new Error('connect timeout')), TIMEOUT);
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.emit('request_state');
      resolve(client);
    });
  });
}

function until(check: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > TIMEOUT) {
        clearInterval(timer);
        reject(new Error('timeout waiting for ' + label));
      }
    }, 10);
  });
}

function activeClients(clients: Client[]): Client[] {
  return clients.filter((client) => client.socket.connected);
}

function currentView(clients: Client[]): SkullKingPublicState {
  const view = activeClients(clients).find((client) => client.game)?.game;
  if (!view) fail('no connected client has a game projection');
  return view;
}

async function waitForRevision(clients: Client[], revision: number): Promise<void> {
  await until(
    () => activeClients(clients).every((client) => client.game?.revision === revision && client.mine?.revision === revision),
    'revision ' + revision,
  );
}

async function start(clients: Client[]): Promise<void> {
  const initialRevision = clients[0]!.game ? clients[0]!.game!.revision + 1 : 0;
  const host = activeClients(clients).find((client) => (
    client.room?.players.some((player) => player.playerId === client.auth.playerId && player.isHost)
  ));
  if (!host) fail('no connected room host');
  const accepted = waitForEvent<SkullKingActionAccepted>(
    host.socket,
    'skull_king:action_accepted',
  );
  host.socket.emit('start_game', {});
  const ack = await accepted;
  if (ack.action !== 'start' || ack.revision !== initialRevision) fail('start acknowledgement is wrong');
  await until(
    () => activeClients(clients).every((client) => (
      client.game?.phase === 'bidding'
      && client.game.revision === initialRevision
      && client.mine?.revision === initialRevision
      && client.mine.playerId === client.auth.playerId
      && client.mine.roomCode === client.auth.roomCode
    )),
    'opening projections',
  );
}

async function playCompleteMatch(
  clients: Client[],
  staleProbe: { done: boolean },
): Promise<number> {
  let commands = 0;
  while (currentView(clients).status === 'playing' && commands < 5_000) {
    const view = currentView(clients);
    const byId = new Map(activeClients(clients).map((client) => [client.auth.playerId, client]));
    if (view.phase === 'bidding') {
      const sharedRevision = view.revision;
      const bidders = view.players.filter((player) => !player.forfeited && !player.bidSubmitted);
      for (let index = 0; index < bidders.length; index += 1) {
        const bidder = byId.get(bidders[index]!.playerId);
        if (!bidder) fail('eligible bidder has no connected client');
        const accepted = waitForEvent<SkullKingActionAccepted>(
          bidder.socket,
          'skull_king:action_accepted',
        );
        bidder.socket.emit('skull_king:bid', {
          bid: (view.roundNumber + index * 2) % (view.cardsPerPlayer + 1),
          expectedRevision: sharedRevision,
        });
        const ack = await accepted;
        if (ack.action !== 'bid') fail('bid acknowledgement is wrong');
        await waitForRevision(clients, ack.revision);
        if (index < bidders.length - 1) {
          const partial = currentView(clients);
          if (partial.bidsRevealed || partial.players.some((player) => player.bid !== null)) {
            fail('bid leaked before every eligible captain submitted');
          }
        }
        commands += 1;
      }
      if (currentView(clients).phase !== 'trick_play') fail('completed bidding did not reveal');
      continue;
    }

    if (view.phase !== 'trick_play' || !view.currentPlayerId) {
      fail('playing match has no actionable phase');
    }
    const actor = byId.get(view.currentPlayerId);
    if (!actor?.mine || actor.mine.revision !== view.revision) {
      await until(
        () => actor?.mine?.revision === currentView(clients).revision,
        'actor private projection',
      );
    }
    const cardId = actor!.mine!.legalCardIds[
      (commands + view.roundNumber) % actor!.mine!.legalCardIds.length
    ];
    if (!cardId) fail('current actor has no legal card');
    const selected = actor!.mine!.hand.find((card) => card.id === cardId);
    if (!selected) fail('legal card is absent from owner hand');

    if (!staleProbe.done) {
      const rejected = waitForEvent<{ reason: string }>(actor!.socket, 'action_rejected');
      actor!.socket.emit('skull_king:play', {
        cardId,
        ...(selected.kind === 'tigress' ? { tigressMode: 'escape' } : {}),
        expectedRevision: view.revision - 1,
      });
      const rejection = await rejected;
      if (!/state changed/i.test(rejection.reason)) fail('stale play rejection is wrong');
      if (currentView(clients).revision !== view.revision) fail('stale play mutated the match');
      staleProbe.done = true;
    }

    const accepted = waitForEvent<SkullKingActionAccepted>(
      actor!.socket,
      'skull_king:action_accepted',
    );
    actor!.socket.emit('skull_king:play', {
      cardId,
      ...(selected.kind === 'tigress'
        ? { tigressMode: commands % 2 === 0 ? 'escape' : 'pirate' }
        : {}),
      expectedRevision: view.revision,
    });
    const ack = await accepted;
    if (ack.action !== 'play') fail('play acknowledgement is wrong');
    await waitForRevision(clients, ack.revision);
    commands += 1;
  }
  if (commands >= 5_000) fail('match exceeded command limit');
  const finished = currentView(clients);
  if (finished.status !== 'game_over' || finished.winnerIds.length < 1) {
    fail('match did not finish with eligible winners');
  }
  await until(
    () => activeClients(clients).every((client) => client.room?.status === 'finished'),
    'finished room',
  );
  return commands;
}

async function createTable(count: number): Promise<Client[]> {
  const auths: JoinRoomResponse[] = [];
  auths.push(await api<JoinRoomResponse>('/rooms/create', {
    displayName: 'Live Captain 1',
    gameId: 'skull_king',
  }));
  ownRooms.add(auths[0]!.roomCode);
  for (let index = 1; index < count; index += 1) {
    auths.push(await api<JoinRoomResponse>('/rooms/join', {
      roomCode: auths[0]!.roomCode,
      displayName: 'Live Captain ' + (index + 1),
    }));
  }
  const clients: Client[] = [];
  for (const auth of auths) clients.push(await connectClient(auth));
  await until(() => clients.every((client) => client.room !== null), 'lobby roster');
  if (clients[0]!.room?.gameId !== 'skull_king' || clients[0]!.room?.maxPlayers !== 8) {
    fail('Skull King room metadata is wrong');
  }
  return clients;
}

async function main(): Promise<void> {
  const staleProbe = { done: false };
  let totalCommands = 0;
  let matches = 0;
  let rematches = 0;
  for (let count = 3; count <= 8; count += 1) {
    const clients = await createTable(count);
    await start(clients);

    const opening = currentView(clients);
    const openingJson = JSON.stringify(opening);
    for (const client of clients) {
      for (const privateCard of client.mine!.hand) {
        if (openingJson.includes(privateCard.id)) fail('opening hand leaked publicly');
      }
    }

    if (count === 3) {
      const originalHand = JSON.stringify(clients[1]!.mine!.hand);
      const auth = clients[1]!.auth;
      clients[1]!.socket.disconnect();
      const reconnected = await connectClient(auth);
      clients[1] = reconnected;
      await until(
        () => reconnected.game?.revision === opening.revision && reconnected.mine !== null,
        'grace reconnect state',
      );
      if (JSON.stringify(reconnected.mine!.hand) !== originalHand) {
        fail('reconnect did not restore the same private hand');
      }
    }

    const firstCommands = await playCompleteMatch(clients, staleProbe);
    totalCommands += firstCommands;
    matches += 1;
    const finished = currentView(clients);
    if (finished.players.some(player => player.forfeited)) fail('natural game contained a forfeit');

    await start(clients);
    rematches += 1;
    const rematch = currentView(clients);
    if (rematch.players.length !== count || rematch.roundNumber !== 1) {
      fail('rematch roster or round reset is wrong');
    }
    const stale = waitForEvent<{ reason: string }>(clients[0]!.socket, 'action_rejected');
    clients[0]!.socket.emit('skull_king:bid', { bid: 0, expectedRevision: 0 });
    if (!/state changed/i.test((await stale).reason)) fail('old match bid crossed rematch boundary');
    for (let index = 0; index < clients.length; index += 1) {
      const old = clients[index]!;
      const hand = JSON.stringify(old.mine!.hand);
      old.socket.disconnect();
      clients[index] = await connectClient(old.auth);
      await until(() => clients[index]!.mine?.revision === rematch.revision, 'rematch reconnect');
      if (JSON.stringify(clients[index]!.mine!.hand) !== hand) fail('rematch reconnect changed hand');
    }
    await waitForRevision(clients, rematch.revision);
    const secondCommands = await playCompleteMatch(clients, staleProbe);
    totalCommands += secondCommands;
    console.log(`ASTRA SKULL KING ${count}P: ${firstCommands}/${secondCommands} full-game commands`);
    const denied = await fetch(BASE + '/rooms/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomCode: clients[0]!.auth.roomCode, displayName: 'Late arrival' }) });
    if (denied.ok) fail('finished room accepted a late arrival');
    for (const client of clients) client.socket.disconnect();
  }

  if (!staleProbe.done) fail('stale action probe did not run');
  console.log(
    'SKULL KING LIVE SMOKE PASS: '
      + matches
      + ' full matches and '
      + rematches
      + ' full rematches (3-8 players), '
      + totalCommands
      + ' accepted gameplay commands; lobby, hidden bids/hands, reconnect, '
      + 'stale rejection and semantic acknowledgements verified. No fixture state or departures used.',
  );
  process.exitCode = 0;
}

const app = Fastify({ logger: false });
const io = new Server(app.server);
registerRoomRoutes(app, io);
registerSocketHandlers(io);
try {
  BASE = await app.listen({ host: '127.0.0.1', port: 0 });
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.disconnect();
  for (const roomCode of ownRooms) roomStore.delete(roomCode);
  await new Promise<void>(resolve => io.close(() => resolve()));
  if (app.server.listening) await app.close();
}
