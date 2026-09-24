import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { JoinRoomResponse, RoomPublicState } from '@zuychin-arcade/types';
import type { TelestrationsContent, TelestrationsPrivateState, TelestrationsPublicState } from '../../../../../packages/types/src/telestrations.js';
import { registerRoomRoutes } from '../../routes/room.js';
import { registerSocketHandlers } from '../../socket/handlers.js';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { roomStore } from '../../store/RoomStore.js';
import { supabase } from '../../lib/supabase.js';
import { SOCKET_PAYLOAD_LIMIT_BYTES } from '../../utils/securityConfig.js';
import { isTelestrationsStartPayload, isTelestrationsSubmission, isTelestrationsScoreVerdict, recoverDisconnectedTelestrationsPlayers } from './socketHandlers.js';
process.env.JWT_SECRET ??= 'telestrations-local-test-only-secret-32-bytes';
interface Client {
    auth: JoinRoomResponse;
    socket: Socket;
    room: RoomPublicState | null;
    game: TelestrationsPublicState | null;
    mine: TelestrationsPrivateState | null;
}
async function until(predicate: () => boolean) { const end = Date.now() + 5000; while (!predicate()) {
    if (Date.now() > end)
        throw new Error('Telestrations socket condition timed out');
    await new Promise(r => setTimeout(r, 2));
} }
function once<T>(socket: Socket, event: string): Promise<T> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out ${event}`)); }, 5000); function receive(v: T) { clearTimeout(timer); resolve(v); } socket.once(event, receive); }); }
async function harness(count: number, direction: 1 | -1 = 1) {
    assert.equal(supabase, null, 'Tests refuse hosted persistence');
    const app = Fastify({ logger: false });
    const io = new Server(app.server, { maxHttpBufferSize: SOCKET_PAYLOAD_LIMIT_BYTES });
    registerRoomRoutes(app, io);
    registerSocketHandlers(io);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const clients: Client[] = [];
    let roomCode = '';
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    async function attach(auth: JoinRoomResponse) {
        const socket = connect(url, { auth: { token: auth.token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
        const c: Client = { auth, socket, room: null, game: null, mine: null };
        socket.on('room_updated', v => { c.room = v; });
        socket.on('game_state', v => { c.game = v; });
        socket.on('private_state', v => { c.mine = v; });
        const ready = once(socket, 'connect');
        socket.connect();
        await ready;
        socket.emit('request_state');
        await until(() => !!c.room);
        clients.push(c);
        return c;
    }
    for (let i = 0; i < count; i++) {
        const response = await post(i === 0 ? '/rooms/create' : '/rooms/join', { displayName: `Sketcher ${i}`, ...(i === 0 ? { gameId: 'telestrations', config: { telestrationsScoringMode: count === 11 ? 'competitive' : count === 12 ? 'none' : 'friendly', telestrationsDirection: direction } } : { roomCode }) });
        assert.equal(response.status, i === 0 ? 201 : 200);
        const auth = await response.json() as JoinRoomResponse;
        roomCode = auth.roomCode;
        await attach(auth);
    }
    const sync = async (revision: number) => until(() => clients.filter(c => c.socket.connected && !c.room?.players.find(p => p.playerId === c.auth.playerId)?.hasLeft).every(c => c.game?.revision === revision && c.mine?.revision === revision));
    async function act(c: Client, event: string, payload: unknown) { const ack = once<{
        revision: number;
    }>(c.socket, 'telestrations:action_accepted'); c.socket.emit(event, payload); const accepted = await ack; await sync(accepted.revision); return accepted; }
    async function reject(c: Client, event: string, payload: unknown) { const ack = once<{
        reason: string;
    }>(c.socket, 'action_rejected'); c.socket.emit(event, payload); return (await ack).reason; }
    const submit = (c: Client, content: TelestrationsContent) => ({ windowId: c.mine!.windowId, seatToken: c.mine!.seatToken, draftRevision: c.mine!.draft!.revision, content });
    async function close() { for (const c of clients)
        c.socket.disconnect(); roomStore.delete(roomCode); await new Promise<void>(r => io.close(() => r())); if (app.server.listening)
        await app.close(); }
    return { clients, io, roomCode, post, attach, sync, act, reject, submit, close };
}
test('strict wire validators bound payloads and reject forged identity', () => {
    assert.equal(isTelestrationsStartPayload({}), true);
    for (const v of [null, [], { scoringMode: 'none' }])
        assert.equal(isTelestrationsStartPayload(v), false);
    const valid = { windowId: '1:draw:0', seatToken: '1:draw:0:0', draftRevision: 0, content: 'A drawing' };
    assert.equal(isTelestrationsSubmission(valid), true);
    for (const v of [null, { ...valid, playerId: 'victim' }, { ...valid, draftRevision: -1 }, { ...valid, content: 'x'.repeat(121) }, { ...valid, content: { strokes: [], svg: '<svg/>' } }])
        assert.equal(isTelestrationsSubmission(v), false);
    assert.equal(isTelestrationsScoreVerdict({ expectedRevision: 0, matches: Array(7).fill(true) }), false);
});
for (const count of [4, 11, 12])
    for (const direction of [1, -1] as const)
        test(`${count} players direction ${direction}: complete HTTP/socket game, privacy and rematch`, async () => {
            const h = await harness(count, direction);
            try {
                assert.match(await h.reject(h.clients[1], 'start_game', {}), /host/);
                await h.act(h.clients[0], 'start_game', {});
                assert.equal(h.clients[0].game!.direction, direction);
                assert.equal(h.clients[0].game!.scoringMode, count === 11 ? 'competitive' : count === 12 ? 'none' : 'friendly');
                if (count === 12)
                    assert.equal((await h.post('/rooms/join', { roomCode: h.roomCode, displayName: 'Overflow' })).status, 409);
                const previousMatchCommand = h.submit(h.clients[0], h.clients[0].mine!.choices[0]);
                let commands = 0;
                while (h.clients[0].game!.phase !== 'game_over') {
                    assert.ok(commands++ < 1500);
                    const game = h.clients[0].game!;
                    for (const c of h.clients) {
                        assert.equal(c.mine!.playerId, c.auth.playerId);
                        assert.equal(c.mine!.roomCode, h.roomCode);
                        assert.equal(c.mine!.gameId, 'telestrations');
                        assert.ok(Buffer.byteLength(JSON.stringify(c.mine)) < SOCKET_PAYLOAD_LIMIT_BYTES);
                    }
                    if (['prompt', 'draw', 'guess'].includes(game.phase)) {
                        const actor = h.clients.find(c => !game.readyIds.includes(c.auth.playerId))!;
                        const content = game.phase === 'prompt' ? actor.mine!.choices[0] : game.phase === 'guess' ? 'A human interpretation' : { strokes: [{ color: 1, width: 0, points: [[1, 1], [3000, 2000]] as [
                                        number,
                                        number
                                    ][] }] };
                        if (game.phase === 'prompt')
                            assert.equal(JSON.stringify(game).includes(content as string), false);
                        await h.act(actor, 'telestrations:submit', h.submit(actor, content));
                    }
                    else if (game.phase === 'reveal') {
                        await h.act(h.clients.find(c => c.auth.playerId === game.revealOwnerId)!, 'telestrations:reveal', { expectedRevision: game.revision });
                    }
                    else if (game.phase === 'scoring') {
                        if (game.completedRounds === 0 && game.revealBook === 0) {
                            const owner = h.clients.find(c => c.auth.playerId === game.revealOwnerId)!;
                            await h.act(owner, 'telestrations:review', { expectedRevision: game.revision, pageIndex: -1 });
                            assert.equal(owner.game!.revealed!.kind, 'prompt');
                            game.revision = owner.game!.revision;
                        }
                        await h.act(h.clients.find(c => c.auth.playerId === game.revealOwnerId)!, 'telestrations:score', { expectedRevision: game.revision, favouriteDrawing: 0, favouriteGuess: 1, finalMatch: false, matches: game.scoringPages.filter(p => p.kind === 'guess').map(() => false) });
                    }
                    else
                        await h.act(h.clients.find(c => c.auth.playerId === game.seats[0])!, 'telestrations:next_round', { expectedRevision: game.revision });
                }
                assert.equal(h.clients[0].game!.completedRounds, 3);
                assert.equal(h.clients[0].room!.status, 'finished');
                await h.act(h.clients[0], 'start_game', {});
                assert.equal(h.clients[0].game!.completedRounds, 0);
                assert.match(await h.reject(h.clients[0], 'telestrations:submit', previousMatchCommand), /Stale/);
            }
            finally {
                await h.close();
            }
        });
test('explicit departure finishes an undersized game without a winner or private book', async () => {
    const h = await harness(4);
    try {
        await h.act(h.clients[0], 'start_game', {});
        const room = roomStore.get(h.roomCode)!;
        const departing = h.clients[3];
        markPlayerDisconnected(h.io, room, departing.auth.playerId, departing.socket.id!, 0, true);
        await until(() => h.clients[0].game?.phase === 'game_over');
        assert.equal(h.clients[0].game!.endReason, 'insufficient_players');
        assert.deepEqual(h.clients[0].game!.winnerIds, []);
        assert.equal(h.clients[0].game!.revealed, null);
        assert.equal(h.clients[0].room!.status, 'finished');
    }
    finally {
        await h.close();
    }
});
test('owned draft reconnect, stale windows and batched grace forfeiture', async () => {
    const h = await harness(6);
    try {
        await h.act(h.clients[0], 'start_game', {});
        for (const client of h.clients) await h.act(client, 'telestrations:submit', h.submit(client, client.mine!.choices[0]));
        const c = h.clients[2];
        const content = { strokes: Array.from({ length: 4 }, () => ({ color: 2, width: 1, points: Array.from({ length: 256 }, (_, i) => [i * 15, 4095 - i * 15] as [number, number]) })) };
        await h.act(c, 'telestrations:draft', h.submit(c, content));
        const old = h.submit(c, content);
        assert.ok(Buffer.byteLength(JSON.stringify(c.mine)) < SOCKET_PAYLOAD_LIMIT_BYTES);
        assert.match(await h.reject(c, 'telestrations:submit', { ...old, playerId: h.clients[1].auth.playerId }), /Invalid payload/);
        assert.equal(h.clients[1].mine!.draft!.content, null);
        c.socket.disconnect();
        await until(() => !roomStore.get(h.roomCode)!.players.get(c.auth.playerId)!.isConnected);
        const replacement = await h.attach(c.auth);
        await until(() => replacement.mine?.draft?.revision === 1);
        assert.deepEqual(replacement.mine!.draft!.content, content);
        assert.equal(replacement.mine!.draft!.revision, 1);
        const room = roomStore.get(h.roomCode)!;
        for (const departing of h.clients.slice(0, 2)) {
            const p = room.players.get(departing.auth.playerId)!;
            markPlayerDisconnected(h.io, room, p.playerId, p.socketId, 60000);
            p.reconnectDeadlineAt = Date.now() - 1;
            departing.socket.disconnect();
        }
        assert.equal(recoverDisconnectedTelestrationsPlayers(h.io, room), true);
        const state = room.game!.id === 'telestrations' ? room.game.state : null;
        assert.ok(state);
        await h.sync(state.revision);
        assert.equal(state.seats.length, 4);
        assert.equal(state.cancelledRounds.length, 1);
        assert.match(await h.reject(replacement, 'telestrations:submit', old), /Stale/);
        assert.equal(replacement.mine!.draft!.content, null);
        assert.equal(state.completedRounds, 0);
    }
    finally {
        await h.close();
    }
});
