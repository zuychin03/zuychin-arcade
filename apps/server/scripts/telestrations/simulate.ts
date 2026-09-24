import assert from 'node:assert/strict';
import type { TelestrationsContent } from '../../../../packages/types/src/telestrations.js';
import { initTelestrationsGame, submitTelestrationsPage, telestrationsSeatToken, revealTelestrationsNext, scoreTelestrationsBook, nextTelestrationsRound } from '../../src/game/telestrations/engine.js';
let games = 0;
for (let n = 4; n <= 12; n++)
    for (const scoringMode of ['none', 'friendly', 'competitive'] as const)
        for (const direction of [1, -1] as const) {
            const s = initTelestrationsGame('SIM', Array.from({ length: n }, (_, i) => ({ id: `p${i}`, displayName: `Seat ${i}` })), { scoringMode, direction });
            while (s.phase !== 'game_over') {
                if (['prompt', 'draw', 'guess'].includes(s.phase)) {
                    for (const id of [...s.seats].reverse()) {
                        const content: TelestrationsContent = s.phase === 'prompt' ? s.choices[id][1] : s.phase === 'guess' ? `Interpretation from ${id}` : { strokes: [{ color: 3, width: 1, points: [[100, 100], [3000, 3000]] }] };
                        assert.equal(submitTelestrationsPage(s, id, { windowId: s.windowId, seatToken: telestrationsSeatToken(s, id), draftRevision: s.drafts[id].revision, content }).ok, true);
                    }
                }
                else if (s.phase === 'reveal')
                    assert.equal(revealTelestrationsNext(s, s.books[s.revealBook].ownerId, s.revision).ok, true);
                else if (s.phase === 'scoring')
                    assert.equal(scoreTelestrationsBook(s, s.books[s.revealBook].ownerId, { expectedRevision: s.revision, favouriteDrawing: 0, favouriteGuess: 1, finalMatch: false, matches: s.books[s.revealBook].pages.filter(p => p.kind === 'guess').map((_, i) => i % 2 === 0) }).ok, true);
                else
                    assert.equal(nextTelestrationsRound(s, s.seats[0], s.revision).ok, true);
            }
            assert.equal(s.completedRounds, 3);
            assert.equal(s.endReason, 'completed');
            games++;
        }
console.log(`${games} complete Telestrations simulations passed (4–12 seats, both directions, all scoring modes).`);
