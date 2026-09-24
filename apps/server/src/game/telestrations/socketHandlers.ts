import type { Server, Socket } from 'socket.io';
import type { TelestrationsState, TelestrationsSubmission, TelestrationsScoreVerdict } from '../../../../../packages/types/src/telestrations.js';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { initTelestrationsGame, saveTelestrationsDraft, submitTelestrationsPage, revealTelestrationsNext, reviewTelestrationsPage, scoreTelestrationsBook, nextTelestrationsRound, forfeitTelestrationsPlayers, isTelestrationsDrawing } from './engine.js';
import { getTelestrationsPublicState, getTelestrationsPrivateState } from './publicState.js';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function isTelestrationsStartPayload(v: unknown): boolean { return v === undefined || (record(v) && Object.keys(v).length === 0); }
export function isTelestrationsSubmission(v: unknown): v is TelestrationsSubmission {
    return record(v) && keys(v, ['windowId', 'seatToken', 'draftRevision', 'content'])
        && typeof v.windowId === 'string' && v.windowId.length <= 80 && typeof v.seatToken === 'string' && v.seatToken.length <= 100
        && revision(v.draftRevision) && (typeof v.content === 'string' ? [...v.content].length <= 120 : isTelestrationsDrawing(v.content, true));
}
export function isTelestrationsScoreVerdict(v: unknown): v is TelestrationsScoreVerdict {
    return record(v) && keys(v, ['expectedRevision', 'favouriteDrawing', 'favouriteGuess', 'matches', 'finalMatch']) && revision(v.expectedRevision)
        && (v.favouriteDrawing === undefined || (revision(v.favouriteDrawing) && v.favouriteDrawing < 12))
        && (v.favouriteGuess === undefined || (revision(v.favouriteGuess) && v.favouriteGuess < 12))
        && (v.finalMatch === undefined || typeof v.finalMatch === 'boolean')
        && (v.matches === undefined || (Array.isArray(v.matches) && v.matches.length <= 6 && v.matches.every(m => typeof m === 'boolean')));
}
function stateFor(room: ServerRoom): TelestrationsState | null { return room.game?.id === 'telestrations' ? room.game.state : null; }
function context(socket: Socket) {
    const current = getCurrentSocketSession(socket);
    if (!current || current.room.gameId !== 'telestrations') {
        socket.emit('server_error', { message: 'This connection is not authorised for this sketchbook room' });
        return null;
    }
    return current;
}
const pendingFrames = new WeakSet<ServerRoom>();
function emitState(io: Server, room: ServerRoom): void {
    if (pendingFrames.has(room))
        return;
    pendingFrames.add(room);
    setImmediate(() => {
        pendingFrames.delete(room);
        if (roomStore.get(room.roomCode) === room)
            flushState(io, room);
    });
}
function flushState(io: Server, room: ServerRoom): void {
    const s = stateFor(room);
    if (!s)
        return;
    io.to(room.roomCode).emit('game_state', getTelestrationsPublicState(s));
    for (const player of room.players.values()) {
        if (player.socketId && player.isConnected && !player.hasLeft)
            io.to(player.socketId).emit('private_state', getTelestrationsPrivateState(s, player.playerId));
    }
}
export function buildTelestrationsResult(s: TelestrationsState) {
    if (s.phase !== 'game_over' || s.endReason !== 'completed' || !s.winnerIds.length)
        return null;
    return { gameName: 'telestrations', roomCode: s.roomCode, roundsPlayed: s.completedRounds, players: s.players.filter(p => !p.forfeited).map(p => ({ playerId: p.id, displayName: p.displayName, score: p.score, won: s.winnerIds.includes(p.id) })) };
}
function finish(io: Server, room: ServerRoom): void {
    const s = stateFor(room);
    if (!s || s.phase !== 'game_over' || room.status === 'finished')
        return;
    room.status = 'finished';
    if (room.timer)
        clearTimeout(room.timer);
    room.timer = null;
    const result = buildTelestrationsResult(s);
    if (result)
        void saveGameResult(result);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}
export function recoverDisconnectedTelestrationsPlayers(io: Server, room: ServerRoom): boolean {
    const s = stateFor(room);
    if (!s || s.phase === 'game_over')
        return false;
    const now = Date.now();
    const departing = s.seats.filter(id => { const p = room.players.get(id); return !p || p.hasLeft || (!p.isConnected && p.reconnectDeadlineAt !== null && p.reconnectDeadlineAt <= now); });
    if (!departing.length)
        return false;
    forfeitTelestrationsPlayers(s, departing);
    for (const id of departing) {
        const p = room.players.get(id);
        if (p) {
            roomStore.clearPresenceTimer(p);
            p.hasLeft = true;
        }
    }
    if (departing.includes(room.hostPlayerId))
        roomStore.transferHost(room, true);
    roomStore.touch(room);
    finish(io, room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
    return true;
}
export function registerTelestrationsHandlers(io: Server, socket: Socket): void {
    socket.on('start_game', (payload: unknown) => {
        const c = context(socket);
        if (!c)
            return;
        const { room, auth } = c;
        if (!isTelestrationsStartPayload(payload))
            return socket.emit('action_rejected', { reason: 'Invalid payload' });
        if (room.hostPlayerId !== auth.playerId)
            return socket.emit('action_rejected', { reason: 'Only the host can start' });
        if (room.status === 'in_game')
            return socket.emit('action_rejected', { reason: 'Game already in progress' });
        if (!prepareRoomForStart(io, socket, room))
            return;
        const seats = [...room.players.values()].filter(p => p.isConnected && !p.hasLeft);
        if (seats.length < 4 || seats.length > 12)
            return socket.emit('action_rejected', { reason: 'Need 4–12 connected players' });
        const previous = stateFor(room);
        const s = initTelestrationsGame(room.roomCode, seats.map(p => ({ id: p.playerId, displayName: p.displayName })), { scoringMode: room.config.telestrationsScoringMode, category: room.config.telestrationsCategory, direction: room.config.telestrationsDirection });
        s.revision = (previous?.revision ?? -1) + 1;
        s.epoch = (previous?.epoch ?? 0) + 1;
        s.windowId = `${s.epoch}:prompt:0`;
        if (room.timer)
            clearTimeout(room.timer);
        room.timer = null;
        room.game = { id: 'telestrations', state: s };
        room.status = 'in_game';
        roomStore.touch(room);
        socket.emit('telestrations:action_accepted', { action: 'start', revision: s.revision });
        io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
        emitState(io, room);
    });
    for (const action of ['draft', 'submit', 'reveal', 'review', 'score', 'next_round'] as const)
        socket.on(`telestrations:${action}`, (payload: unknown) => {
            const c = context(socket);
            if (!c)
                return;
            const valid = action === 'draft' || action === 'submit' ? isTelestrationsSubmission(payload) : action === 'score' ? isTelestrationsScoreVerdict(payload) : action === 'review' ? record(payload) && keys(payload, ['expectedRevision', 'pageIndex']) && revision(payload.expectedRevision) && Number.isInteger(payload.pageIndex) && Number(payload.pageIndex) >= -1 && Number(payload.pageIndex) < 12 : record(payload) && keys(payload, ['expectedRevision']) && revision(payload.expectedRevision);
            if (!valid)
                return socket.emit('action_rejected', { reason: 'Invalid payload' });
            recoverDisconnectedTelestrationsPlayers(io, c.room);
            const s = stateFor(c.room);
            if (!s)
                return socket.emit('action_rejected', { reason: 'Sketchbooks have not started' });
            const id = c.auth.playerId;
            const result = action === 'draft' ? saveTelestrationsDraft(s, id, payload as TelestrationsSubmission)
                : action === 'submit' ? submitTelestrationsPage(s, id, payload as TelestrationsSubmission)
                    : action === 'score' ? scoreTelestrationsBook(s, id, payload as TelestrationsScoreVerdict)
                        : action === 'reveal' ? revealTelestrationsNext(s, id, (payload as {
                            expectedRevision: number;
                        }).expectedRevision)
                            : action === 'review' ? reviewTelestrationsPage(s, id, (payload as {
                                expectedRevision: number;
                            }).expectedRevision, (payload as {
                                pageIndex: number;
                            }).pageIndex)
                                : nextTelestrationsRound(s, id, (payload as {
                                    expectedRevision: number;
                                }).expectedRevision);
            if (!result.ok)
                return socket.emit('action_rejected', { reason: result.error });
            roomStore.touch(c.room);
            socket.emit('telestrations:action_accepted', { action, revision: s.revision });
            finish(io, c.room);
            emitState(io, c.room);
        });
    socket.on('request_state', (payload: unknown) => {
        const c = context(socket);
        if (!c)
            return;
        if (!isTelestrationsStartPayload(payload))
            return socket.emit('action_rejected', { reason: 'Invalid payload' });
        recoverDisconnectedTelestrationsPlayers(io, c.room);
        socket.emit('room_updated', getRoomPublicState(c.room));
        const s = stateFor(c.room);
        if (s) {
            socket.emit('game_state', getTelestrationsPublicState(s));
            socket.emit('private_state', getTelestrationsPrivateState(s, c.auth.playerId));
        }
    });
}
