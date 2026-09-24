import type { TelestrationsState, TelestrationsPublicState, TelestrationsPrivateState } from '../../../../../packages/types/src/telestrations.js';
import { telestrationsAssignedBook, telestrationsSeatToken } from './engine.js';
export function getTelestrationsPublicState(s: TelestrationsState): TelestrationsPublicState {
    const book = s.books[s.revealBook];
    const showing = (s.phase === 'reveal' || s.phase === 'scoring') && book;
    return structuredClone({ gameId: s.gameId, roomCode: s.roomCode, revision: s.revision, phase: s.phase, players: s.players, seats: s.seats, scoringMode: s.scoringMode, category: s.category, direction: s.direction, completedRounds: s.completedRounds, step: s.step, readyIds: s.seats.filter(id => s.drafts[id]?.submitted), revealBook: s.revealBook, revealPage: s.revealPage, revealOwnerId: showing ? book.ownerId : null, revealed: showing ? (s.revealPage === -1 ? { kind: 'prompt' as const, content: book.prompt } : book.pages[s.revealPage]) : null, scoringPages: s.phase === 'scoring' && book ? book.pages.map((p, index) => ({ index, kind: p.kind, authorId: p.authorId })) : [], pendingScores: s.pendingScores, winnerIds: s.winnerIds, endReason: s.endReason, cancelledRounds: s.cancelledRounds });
}
export function getTelestrationsPrivateState(s: TelestrationsState, id: string): TelestrationsPrivateState | null {
    if (!s.seats.includes(id))
        return null;
    const active = ['prompt', 'draw', 'guess'].includes(s.phase);
    const book = active && s.phase !== 'prompt' ? s.books[telestrationsAssignedBook(s, id)] : null;
    return structuredClone({ gameId: s.gameId, roomCode: s.roomCode, playerId: id, revision: s.revision, windowId: active ? s.windowId : null, seatToken: active ? telestrationsSeatToken(s, id) : null, choices: s.phase === 'prompt' ? s.choices[id] : [], draft: active ? s.drafts[id] : null, predecessor: book ? (s.step === 0 ? { kind: 'prompt' as const, content: book.prompt } : book.pages[s.step - 1]) : null });
}
