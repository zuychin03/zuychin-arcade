import type { TelestrationsState as State, TelestrationsContent as Content, TelestrationsSubmission as Submission, TelestrationsResult as Result, TelestrationsOptions, TelestrationsScoreVerdict } from '../../../../../packages/types/src/telestrations.js';
import { TELESTRATIONS_LIMITS as L, TELESTRATIONS_PROMPTS, TELESTRATIONS_CATEGORIES } from '../../../../../packages/types/src/telestrations-constants.js';
const ok = (): Result => ({ ok: true });
const fail = (error: string): Result => ({ ok: false, error });
const copy = <T>(value: T): T => structuredClone(value);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
interface PromptState extends State { promptBag: string[]; promptSeed: number }
function nextPrompt(state: State): string {
    const s = state as PromptState;
    if (!s.promptBag.length) {
        s.promptBag = [...TELESTRATIONS_PROMPTS];
        for (let i = s.promptBag.length - 1; i > 0; i--) {
            s.promptSeed = (Math.imul(s.promptSeed, 1664525) + 1013904223) >>> 0;
            const j = Math.floor(s.promptSeed / 0x100000000 * (i + 1));
            [s.promptBag[i], s.promptBag[j]] = [s.promptBag[j], s.promptBag[i]];
        }
    }
    return s.promptBag.pop()!;
}
function textValid(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0 && [...v].length <= L.textCharacters && !/[\u0000-\u001f\u007f]/u.test(v) && !/^\s*\?+\s*$/u.test(v);
}
export function isTelestrationsDrawing(value: unknown, allowEmpty = false): boolean {
    if (!record(value) || !keys(value, ['strokes']) || !Array.isArray(value.strokes) || value.strokes.length > L.strokes || (!allowEmpty && !value.strokes.length))
        return false;
    let total = 0;
    for (const stroke of value.strokes) {
        if (!record(stroke) || !keys(stroke, ['color', 'width', 'points']) || !Number.isInteger(stroke.color) || Number(stroke.color) < 0 || Number(stroke.color) > 7 || !Number.isInteger(stroke.width) || Number(stroke.width) < 0 || Number(stroke.width) > 2 || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > L.pointsPerStroke)
            return false;
        for (const point of stroke.points) {
            if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isInteger(n) || n < 0 || n > L.coordinate))
                return false;
        }
        total += stroke.points.length;
        if (total > L.points)
            return false;
    }
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= L.drawingBytes;
}
export const telestrationsSeatToken = (s: State, id: string): string => `${s.windowId}:${s.seats.indexOf(id)}`;
function window(s: State): void {
    s.windowId = `${s.epoch}:${s.phase}:${s.step}`;
    s.drafts = Object.fromEntries(s.seats.map(id => [id, { revision: 0, content: null, submitted: false }]));
}
function start(s: State): void {
    s.epoch++;
    s.phase = 'prompt';
    s.step = 0;
    s.books = s.seats.map(ownerId => ({ ownerId, prompt: '', pages: [] }));
    s.choices = Object.fromEntries(s.seats.map(id => [id, s.category ? [] : Array.from({ length: 3 }, () => nextPrompt(s))]));
    s.pendingScores = Object.fromEntries(s.seats.map(id => [id, 0]));
    s.revealBook = 0;
    s.revealPage = -1;
    window(s);
}
export function initTelestrationsGame(roomCode: string, seats: {
    id: string;
    displayName: string;
}[], options: TelestrationsOptions = {}, random: () => number = Math.random): State {
    if (seats.length < 4 || seats.length > 12 || new Set(seats.map(p => p.id)).size !== seats.length || seats.some(p => !p.id || !p.displayName))
        throw new Error('Telestrations requires 4–12 distinct seats');
    if (options.scoringMode && !['none', 'friendly', 'competitive'].includes(options.scoringMode))
        throw new Error('Invalid scoring mode');
    if (options.category && !(TELESTRATIONS_CATEGORIES as readonly string[]).includes(options.category))
        throw new Error('Invalid category');
    if (options.direction !== undefined && options.direction !== 1 && options.direction !== -1)
        throw new Error('Invalid direction');
    const s: State = { gameId: 'telestrations', roomCode, revision: 0, epoch: 0, windowId: '', phase: 'prompt', players: seats.map(p => ({ ...p, score: 0, forfeited: false })), seats: seats.map(p => p.id), scoringMode: options.scoringMode ?? 'friendly', category: options.category ?? null, direction: options.direction ?? 1, completedRounds: 0, step: 0, books: [], choices: {}, drafts: {}, revealBook: 0, revealPage: -1, pendingScores: {}, winnerIds: [], endReason: null, cancelledRounds: [] };
    Object.assign(s, { promptBag: [], promptSeed: Math.floor(random() * 0x100000000) >>> 0 });
    start(s);
    return s;
}
export function telestrationsAssignedBook(s: State, id: string): number {
    const offset = s.seats.length % 2 + s.step;
    return (s.seats.indexOf(id) - s.direction * offset + s.seats.length * 20) % s.seats.length;
}
function validate(s: State, id: string, input: Submission, draft: boolean): string | null {
    if (!s.seats.includes(id) || !['prompt', 'draw', 'guess'].includes(s.phase))
        return 'No active assignment';
    if (!record(input) || !keys(input, ['windowId', 'seatToken', 'draftRevision', 'content']) || input.windowId !== s.windowId || input.seatToken !== telestrationsSeatToken(s, id))
        return 'Stale assignment';
    const current = s.drafts[id];
    if (current.submitted || input.draftRevision !== current.revision)
        return 'Stale or submitted draft';
    if (s.phase === 'draw')
        return isTelestrationsDrawing(input.content, draft) ? null : 'Invalid drawing';
    if (!textValid(input.content))
        return 'Invalid text';
    if (s.phase === 'prompt' && !s.category && !s.choices[id].includes(input.content.trim()))
        return 'Choose an offered prompt';
    return null;
}
export function saveTelestrationsDraft(s: State, id: string, input: Submission): Result {
    const error = validate(s, id, input, true);
    if (error)
        return fail(error);
    s.drafts[id].content = copy(input.content);
    s.drafts[id].revision++;
    s.revision++;
    return ok();
}
export function submitTelestrationsPage(s: State, id: string, input: Submission): Result {
    const error = validate(s, id, input, false);
    if (error)
        return fail(error);
    s.drafts[id].content = typeof input.content === 'string' ? input.content.trim() : copy(input.content);
    s.drafts[id].submitted = true;
    s.drafts[id].revision++;
    s.revision++;
    if (!s.seats.every(p => s.drafts[p].submitted))
        return ok();
    if (s.phase === 'prompt') {
        s.books.forEach(b => { b.prompt = s.drafts[b.ownerId].content as string; });
        s.choices = {};
        s.phase = 'draw';
        window(s);
        return ok();
    }
    for (const authorId of s.seats)
        s.books[telestrationsAssignedBook(s, authorId)].pages.push({ kind: s.phase as 'draw' | 'guess', authorId, content: copy(s.drafts[authorId].content as Content) });
    s.step++;
    if (s.step === s.seats.length - s.seats.length % 2) {
        s.phase = 'reveal';
        s.drafts = {};
        s.revealPage = -1;
    }
    else {
        s.phase = s.step % 2 ? 'guess' : 'draw';
        window(s);
    }
    return ok();
}
function authorisedReveal(s: State, id: string, revision: number): boolean {
    return Number.isSafeInteger(revision) && revision === s.revision && s.books[s.revealBook]?.ownerId === id;
}
export function revealTelestrationsNext(s: State, id: string, revision: number): Result {
    if (s.phase !== 'reveal' || !authorisedReveal(s, id, revision))
        return fail('Not the current reveal owner or revision');
    s.revealPage++;
    s.revision++;
    if (s.revealPage === s.books[s.revealBook].pages.length - 1)
        s.phase = 'scoring';
    return ok();
}
export function reviewTelestrationsPage(s: State, id: string, revision: number, pageIndex: number): Result {
    if (s.phase !== 'scoring' || !authorisedReveal(s, id, revision) || !Number.isInteger(pageIndex) || pageIndex < -1 || pageIndex >= s.books[s.revealBook].pages.length)
        return fail('Only the owner may review the fully revealed book');
    s.revealPage = pageIndex;
    s.revision++;
    return ok();
}
export function scoreTelestrationsBook(s: State, id: string, verdict: TelestrationsScoreVerdict): Result {
    if (!record(verdict) || !keys(verdict, ['expectedRevision', 'favouriteDrawing', 'favouriteGuess', 'matches', 'finalMatch']) || s.phase !== 'scoring' || !authorisedReveal(s, id, verdict.expectedRevision))
        return fail('Not ready to score');
    const book = s.books[s.revealBook];
    const awards: Record<string, number> = {};
    const award = (player: string) => { awards[player] = (awards[player] ?? 0) + 1; };
    if (s.scoringMode !== 'none' && typeof verdict.finalMatch !== 'boolean')
        return fail('Human final-match judgement required');
    if (s.scoringMode === 'friendly') {
        const d = verdict.favouriteDrawing;
        const g = verdict.favouriteGuess;
        if (!Number.isInteger(d) || !Number.isInteger(g) || book.pages[d!]?.kind !== 'draw' || book.pages[g!]?.kind !== 'guess')
            return fail('Choose a drawing and a guess');
        award(book.pages[d!].authorId);
        award(book.pages[g!].authorId);
    }
    if (s.scoringMode === 'competitive') {
        const guesses = book.pages.filter(p => p.kind === 'guess');
        if (!Array.isArray(verdict.matches) || verdict.matches.length !== guesses.length || verdict.matches.some(v => typeof v !== 'boolean') || (verdict.finalMatch && !verdict.matches.at(-1)))
            return fail('Judge every guess in order');
        verdict.matches.forEach((match, i) => { if (match) {
            award(book.pages[i * 2].authorId);
            award(book.pages[i * 2 + 1].authorId);
        } });
    }
    if (s.scoringMode !== 'none' && verdict.finalMatch)
        award(id);
    for (const [player, amount] of Object.entries(awards))
        s.pendingScores[player] += amount;
    s.revision++;
    s.revealBook++;
    s.revealPage = -1;
    if (s.revealBook < s.books.length) {
        s.phase = 'reveal';
        return ok();
    }
    for (const player of s.players)
        player.score += s.pendingScores[player.id] ?? 0;
    s.pendingScores = {};
    s.completedRounds++;
    if (s.completedRounds === L.rounds) {
        s.phase = 'game_over';
        s.endReason = 'completed';
        const highest = Math.max(...s.players.filter(p => !p.forfeited).map(p => p.score));
        s.winnerIds = s.scoringMode === 'none' ? [] : s.players.filter(p => !p.forfeited && p.score === highest).map(p => p.id);
    }
    else
        s.phase = 'round_end';
    return ok();
}
export function nextTelestrationsRound(s: State, id: string, revision: number): Result {
    if (s.phase !== 'round_end' || id !== s.seats[0] || revision !== s.revision)
        return fail('Not ready for next round');
    s.revision++;
    start(s);
    return ok();
}
export function forfeitTelestrationsPlayers(s: State, ids: string[]): Result {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
        return fail('Invalid forfeiture');
    const removed = s.seats.filter(id => ids.includes(id));
    if (!removed.length)
        return ok();
    for (const p of s.players)
        if (removed.includes(p.id))
            p.forfeited = true;
    s.seats = s.seats.filter(id => !removed.includes(id));
    s.winnerIds = s.winnerIds.filter(id => !removed.includes(id));
    s.revision++;
    if (s.phase === 'game_over')
        return ok();
    if (s.phase !== 'round_end')
        s.cancelledRounds.push({ epoch: s.epoch, forfeitedIds: removed });
    s.books = [];
    s.drafts = {};
    s.choices = {};
    s.pendingScores = {};
    if (s.seats.length < 4) {
        s.epoch++;
        s.windowId = `${s.epoch}:ended`;
        s.phase = 'game_over';
        s.endReason = 'insufficient_players';
        s.winnerIds = [];
    }
    else if (s.phase !== 'round_end')
        start(s);
    return ok();
}
