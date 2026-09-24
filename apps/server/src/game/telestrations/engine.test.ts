import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTelestrationsGame, submitTelestrationsPage, saveTelestrationsDraft, telestrationsSeatToken, revealTelestrationsNext, scoreTelestrationsBook, nextTelestrationsRound, forfeitTelestrationsPlayers, isTelestrationsDrawing } from './engine.js';
import { getTelestrationsPublicState, getTelestrationsPrivateState } from './publicState.js';
import type { TelestrationsState, TelestrationsContent, TelestrationsScoringMode } from '../../../../../packages/types/src/telestrations.js';
import { TELESTRATIONS_PROMPTS } from '../../../../../packages/types/src/telestrations-constants.js';

test('prompt bags reproduce a seed and vary between new game seeds without leaking their pool', () => {
    const seats = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, displayName: `Player ${i}` }));
    const a = initTelestrationsGame('A', seats, {}, () => 0.1);
    const b = initTelestrationsGame('B', seats, {}, () => 0.1);
    const c = initTelestrationsGame('C', seats, {}, () => 0.9);
    assert.deepEqual(a.choices, b.choices);
    assert.notDeepEqual(a.choices, c.choices);
    const unoffered = TELESTRATIONS_PROMPTS.filter(prompt => !Object.values(a.choices).flat().includes(prompt));
    for (const projection of [getTelestrationsPublicState(a), ...seats.map(p => getTelestrationsPrivateState(a, p.id))]) {
        assert(!JSON.stringify(projection).includes('promptBag'));
        assert(!JSON.stringify(projection).includes('promptSeed'));
        assert(unoffered.every(prompt => !JSON.stringify(projection).includes(JSON.stringify(prompt))));
    }
});

test('cancelled rounds consume offers while category mode leaves the bag untouched', () => {
    const seats = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, displayName: `Player ${i}` }));
    const s = initTelestrationsGame('CANCEL', seats, {}, () => 0.25);
    const previous = Object.values(s.choices).flat();
    assert(forfeitTelestrationsPlayers(s, ['p7']).ok);
    assert(Object.values(s.choices).flat().every(prompt => !previous.includes(prompt)));
    const category = initTelestrationsGame('CATEGORY', seats, { category: 'Animals at work' }, () => 0.25);
    assert(Object.values(category.choices).every(choices => choices.length === 0));
    assert.equal(Reflect.get(category, 'promptBag').length, 0);
});

for (const count of [10, 12]) test(`${count} seats exhaust the prompt pool before reuse, including partial round boundaries`, () => {
    const seats = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, displayName: `Player ${i}` }));
    const s = initTelestrationsGame('BAG', seats, {}, () => 0.123);
    const offered: string[] = [];
    for (let round = 0; round < 3; round++) {
        offered.push(...s.seats.flatMap(id => s.choices[id]));
        playTelestrationsRound(s);
        if (round < 2) assert(nextTelestrationsRound(s, s.seats[0], s.revision).ok);
    }
    assert.deepEqual([...offered.slice(0, 72)].sort(), [...TELESTRATIONS_PROMPTS].sort());
    assert.equal(new Set(offered.slice(72)).size, offered.length - 72);
    assert.notDeepEqual(offered.slice(0, count * 3), offered.slice(count * 6));
});
const drawing = { strokes: [{ color: 1, width: 1, points: [[1, 2], [4000, 3000]] as [
                number,
                number
            ][] }] };
const make = (n: number, mode: TelestrationsScoringMode = 'friendly') => initTelestrationsGame('TEST', Array.from({ length: n }, (_, i) => ({ id: `p${i}`, displayName: `Player ${i}` })), { scoringMode: mode });
function input(s: TelestrationsState, id: string, content: TelestrationsContent) { return { windowId: s.windowId, seatToken: telestrationsSeatToken(s, id), draftRevision: s.drafts[id].revision, content }; }
export function playTelestrationsRound(s: TelestrationsState): void {
    while (['prompt', 'draw', 'guess'].includes(s.phase)) {
        for (const id of [...s.seats]) {
            const content = s.phase === 'prompt' ? s.choices[id][0] : s.phase === 'draw' ? drawing : 'A possible interpretation';
            assert.deepEqual(submitTelestrationsPage(s, id, input(s, id, content)), { ok: true });
        }
    }
    for (const book of s.books) {
        assert.equal(book.pages.length, s.seats.length - s.seats.length % 2);
        assert.equal(new Set(book.pages.map(p => p.authorId)).size, book.pages.length);
        assert.equal(book.pages.at(-1)?.kind, 'guess');
    }
    while (s.phase === 'reveal' || s.phase === 'scoring') {
        const owner = s.books[s.revealBook].ownerId;
        if (s.phase === 'reveal')
            assert.equal(revealTelestrationsNext(s, owner, s.revision).ok, true);
        else
            assert.equal(scoreTelestrationsBook(s, owner, { expectedRevision: s.revision, favouriteDrawing: 0, favouriteGuess: 1, matches: s.books[s.revealBook].pages.filter(p => p.kind === 'guess').map(() => true), finalMatch: true }).ok, true);
    }
}
for (let n = 4; n <= 12; n++)
    for (const mode of ['none', 'friendly', 'competitive'] as const)
        test(`${n} seats complete three ${mode} rounds`, () => {
            const s = make(n, mode);
            for (let round = 0; round < 3; round++) {
                playTelestrationsRound(s);
                if (round < 2)
                    assert.equal(nextTelestrationsRound(s, s.seats[0], s.revision).ok, true);
            }
            assert.equal(s.phase, 'game_over');
            assert.equal(s.completedRounds, 3);
            assert.equal(s.endReason, 'completed');
            assert.equal(s.winnerIds.length, mode === 'none' ? 0 : n);
        });
test('draft recovery, detached projections, simultaneous windows and duplicate protection', () => {
    const s = make(4);
    const id = s.seats[0];
    const command = input(s, id, s.choices[id][0]);
    assert.equal(saveTelestrationsDraft(s, id, command).ok, true);
    assert.equal(submitTelestrationsPage(s, id, command).ok, false);
    const privateState = getTelestrationsPrivateState(s, id)!;
    assert.equal(privateState.draft?.content, command.content);
    privateState.draft!.content = 'tampered';
    assert.notEqual(s.drafts[id].content, 'tampered');
    const other = input(s, 'p1', s.choices.p1[0]);
    const current = input(s, id, command.content);
    assert.equal(submitTelestrationsPage(s, id, current).ok, true);
    assert.equal(submitTelestrationsPage(s, id, current).ok, false);
    assert.equal(submitTelestrationsPage(s, 'p1', other).ok, true);
    assert.equal(JSON.stringify(getTelestrationsPublicState(s)).includes(command.content as string), false);
});
test('drawings reject malformed, oversized and hostile payloads', () => {
    for (const value of [null, {}, { strokes: [], url: 'x' }, { strokes: [] }, { strokes: [{ color: 0, width: 0, points: [[NaN, 0]] }] }, { strokes: [{ color: 0, width: 0, points: [[4096, 0]] }] }, { strokes: Array.from({ length: 97 }, () => drawing.strokes[0]) }])
        assert.equal(isTelestrationsDrawing(value), false);
    assert.equal(isTelestrationsDrawing(drawing), true);
    assert.equal(isTelestrationsDrawing({ strokes: [] }, true), true);
});
test('forfeit cancels secrets and provisional points without consuming a round', () => {
    const s = make(6);
    playTelestrationsRound(s);
    nextTelestrationsRound(s, 'p0', s.revision);
    const scores = s.players.map(p => p.score);
    const oldWindow = s.windowId;
    assert.equal(forfeitTelestrationsPlayers(s, ['p0']).ok, true);
    assert.equal(s.completedRounds, 1);
    assert.equal(s.phase, 'prompt');
    assert.equal(s.seats.length, 5);
    assert.deepEqual(s.players.map(p => p.score), scores);
    assert.notEqual(s.windowId, oldWindow);
    assert.equal(getTelestrationsPrivateState(s, 'p0'), null);
    assert.equal(s.cancelledRounds.length, 1);
    assert.ok(s.books.every(b => b.prompt === '' && b.pages.length === 0));
    forfeitTelestrationsPlayers(s, ['p1', 'p2']);
    assert.equal(s.endReason, 'insufficient_players');
    assert.deepEqual(s.winnerIds, []);
});
test('scoring is ordered, human judged and cannot be replayed', () => {
    const s = make(4);
    assert.equal(scoreTelestrationsBook(s, 'p0', { expectedRevision: 0 }).ok, false);
    while (['prompt', 'draw', 'guess'].includes(s.phase))
        for (const id of s.seats)
            submitTelestrationsPage(s, id, input(s, id, s.phase === 'prompt' ? s.choices[id][0] : s.phase === 'draw' ? drawing : 'Different guess'));
    assert.equal(revealTelestrationsNext(s, 'p1', s.revision).ok, false);
    while (s.phase === 'reveal')
        revealTelestrationsNext(s, 'p0', s.revision);
    const verdict = { expectedRevision: s.revision, favouriteDrawing: 0, favouriteGuess: 1, finalMatch: false };
    assert.equal(scoreTelestrationsBook(s, 'p0', verdict).ok, true);
    assert.equal(scoreTelestrationsBook(s, 'p0', verdict).ok, false);
    assert.equal(s.players.every(p => p.score === 0), true);
    forfeitTelestrationsPlayers(s, ['p3']);
    assert.deepEqual(s.pendingScores, {});
});
for (const count of [4, 5, 12])
    test(`private assignments at ${count} seats expose only the authorised predecessor`, () => {
        const s = make(count);
        for (const id of s.seats)
            submitTelestrationsPage(s, id, input(s, id, s.choices[id][0]));
        for (let i = 0; i < count; i++) {
            const view = getTelestrationsPrivateState(s, s.seats[i])!;
            const owner = s.seats[(i - count % 2 + count) % count];
            assert.equal(view.predecessor?.content, s.books.find(b => b.ownerId === owner)?.prompt);
            assert.deepEqual(Object.keys(view).sort(), ['choices', 'draft', 'gameId', 'playerId', 'predecessor', 'revision', 'roomCode', 'seatToken', 'windowId']);
            assert.equal(view.choices.length, 0);
        }
        const oldCommand = input(s, 'p0', drawing);
        for (const id of s.seats)
            submitTelestrationsPage(s, id, input(s, id, drawing));
        assert.equal(submitTelestrationsPage(s, 'p0', oldCommand).ok, false);
        for (const id of s.seats) {
            const view = getTelestrationsPrivateState(s, id)!;
            assert.equal(view.predecessor?.kind, 'draw');
            assert.equal(JSON.stringify(view).includes('prompt'), false);
            assert.ok(Buffer.byteLength(JSON.stringify(view)) < 65536);
        }
        assert.equal(getTelestrationsPrivateState(s, 'spectator'), null);
        assert.equal(getTelestrationsPublicState(s).revealed, null);
    });
test('invalid commands preserve all state and drawing copies cannot mutate accepted pages', () => {
    const s = make(4);
    const original = structuredClone(s);
    const command = input(s, 'p0', 'Not an offered card');
    assert.equal(submitTelestrationsPage(s, 'p0', command).ok, false);
    assert.deepEqual(s, original);
    for (const id of s.seats)
        submitTelestrationsPage(s, id, input(s, id, s.choices[id][0]));
    const mutable = structuredClone(drawing);
    submitTelestrationsPage(s, 'p0', input(s, 'p0', mutable));
    mutable.strokes[0].points[0][0] = 999;
    assert.equal((s.drafts.p0.content as typeof drawing).strokes[0].points[0][0], 1);
    const tooLarge = { strokes: Array.from({ length: 5 }, () => ({ color: 0, width: 0, points: Array.from({ length: 256 }, () => [4095, 4095]) })) };
    assert.equal(isTelestrationsDrawing(tooLarge), false);
});
test('category prompts remain private and forfeiture at round boundary preserves settlement', () => {
    const s = initTelestrationsGame('CAT', make(5).players, { category: 'Animals at work' });
    for (const id of s.seats)
        assert.equal(submitTelestrationsPage(s, id, input(s, id, `A secret invented by ${id}`)).ok, true);
    assert.equal(JSON.stringify(getTelestrationsPublicState(s)).includes('A secret'), false);
    playTelestrationsRound(s);
    const scores = s.players.map(p => p.score);
    forfeitTelestrationsPlayers(s, ['p0']);
    assert.equal(s.phase, 'round_end');
    assert.deepEqual(s.players.map(p => p.score), scores);
    assert.equal(s.cancelledRounds.length, 0);
    assert.equal(nextTelestrationsRound(s, 'p1', s.revision).ok, true);
});
