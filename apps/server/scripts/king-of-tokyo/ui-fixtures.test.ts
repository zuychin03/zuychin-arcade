import assert from 'node:assert/strict';
import test from 'node:test';
import { decideOpportunist, validateKingOfTokyoState } from '../../src/game/king-of-tokyo/engine.js';
import { toKingOfTokyoPublicState } from '../../src/game/king-of-tokyo/publicState.js';
import { createKingOfTokyoUiFixture, KOT_UI_FIXTURE_SCENARIOS } from './ui-fixtures.js';

test('isolated five/six-seat fixtures retain canonical state and private Lab projection', () => {
  const previous = process.env.KING_OF_TOKYO_UI_FIXTURES;
  process.env.KING_OF_TOKYO_UI_FIXTURES = 'true';
  try {
    for (const count of [5, 6]) {
      const players = Array.from({ length: count }, (_, index) => ({ playerId: `fixture-${index}`, displayName: `Fixture captain ${index}` }));
      for (const scenario of KOT_UI_FIXTURE_SCENARIOS) {
        const state = createKingOfTokyoUiFixture('FIXT-TEST', players, scenario, 10);
        validateKingOfTokyoState(state);
        if (scenario === 'lab') {
          assert.equal(toKingOfTokyoPublicState(state, players[0].playerId).labCard?.cardId, 'heal');
          for (const player of players.slice(1)) assert.equal(toKingOfTokyoPublicState(state, player.playerId).labCard, null);
        }
        if (scenario === 'opportunist') {
          const host = players[0].playerId;
          assert.equal(state.pendingOpportunist?.playerIds[0], host);
          assert(decideOpportunist(state, host, true, state.revision, () => 0.42).ok);
          assert(state.players.get(host)!.powerCards.some(card => card.cardId === 'complete_destruction'));
          validateKingOfTokyoState(state);
        }
      }
    }
    delete process.env.KING_OF_TOKYO_UI_FIXTURES;
    assert.throws(() => createKingOfTokyoUiFixture('FIXT-TEST', [], 'lab', 0), /Explicit isolated fixture mode/);
  } finally {
    if (previous === undefined) delete process.env.KING_OF_TOKYO_UI_FIXTURES;
    else process.env.KING_OF_TOKYO_UI_FIXTURES = previous;
  }
});
