import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDistrict, chooseIncome, endCitadelsTurn, keepDistrict, useCharacterPower, useDistrictPower,
  validateCitadelsState,
} from '../../src/game/citadels/engine.js';
import { toCitadelsPrivateState, toCitadelsPublicState } from '../../src/game/citadels/publicState.js';
import { CITADELS_UI_FIXTURE_SCENARIOS, createCitadelsUiFixture } from './ui-fixtures.js';

const players = Array.from({ length: 4 }, (_, index) => ({ playerId: `p${index}`, displayName: `Fixture ${index}` }));

test('Citadels canonical UI checkpoints require explicit fixture mode', () => {
  const previous = process.env.CITADELS_UI_FIXTURES;
  delete process.env.CITADELS_UI_FIXTURES;
  try {
    assert.throws(() => createCitadelsUiFixture('FIXTURE', players, 'magician_redraw', 100), /Explicit isolated/);
  } finally {
    if (previous === undefined) delete process.env.CITADELS_UI_FIXTURES;
    else process.env.CITADELS_UI_FIXTURES = previous;
  }
});

for (const scenario of CITADELS_UI_FIXTURE_SCENARIOS) {
  test(`Citadels canonical ${scenario} checkpoint supports normal actions`, () => {
    const previous = process.env.CITADELS_UI_FIXTURES;
    process.env.CITADELS_UI_FIXTURES = 'true';
    try {
      const state = createCitadelsUiFixture('FIXTURE', players, scenario, 100);
      const host = state.players.get('p0')!;
      assert.equal(state.revision, 100);
      assert.equal(state.activePlayerId, 'p0');
      if (scenario === 'killed_merchant') {
        const merchantGold = state.players.get('p1')!.gold;
        assert(useCharacterPower(state, 'p0', { action: 'assassinate', targetRole: 'merchant' }, state.revision).ok);
        assert.equal(toCitadelsPrivateState(state, 'p1').chosenRole, 'merchant');
        assert.equal(toCitadelsPublicState(state).players.find(player => player.playerId === 'p1')!.revealedRole, null);
        for (const id of ['p0', 'p2', 'p3']) {
          assert.equal(state.activePlayerId, id);
          assert(chooseIncome(state, id, 'gold', state.revision).ok);
          assert(endCitadelsTurn(state, id, state.revision).ok);
        }
        assert.equal(state.roundNumber, 2);
        assert.equal(state.phase, 'drafting');
        assert.equal(state.killedRole, null);
        assert.equal(toCitadelsPrivateState(state, 'p1').chosenRole, null);
        assert.equal(state.players.get('p1')!.gold, merchantGold);
      } else if (scenario === 'magician_redraw') {
        const count = host.hand.length;
        assert(useCharacterPower(state, 'p0', { action: 'redraw_hand', cardIds: host.hand.slice(0, 2).map(card => card.id) }, state.revision).ok);
        assert.equal(host.hand.length, count);
        assert.equal(host.specialUsed, true);
      } else if (scenario === 'warlord_targets') {
        for (const [id, template] of [['p1', 'temple'], ['p2', 'keep'], ['p3', 'tavern']]) {
          const district = state.players.get(id!)!.city.find(card => card.templateId === template)!;
          assert.equal(useCharacterPower(state, 'p0', { action: 'destroy', targetPlayerId: id, districtId: district.id }, state.revision).ok, false);
        }
        const gold = host.gold;
        const castle = state.players.get('p2')!.city.find(card => card.templateId === 'castle')!;
        assert(useCharacterPower(state, 'p0', { action: 'destroy', targetPlayerId: 'p2', districtId: castle.id }, state.revision).ok);
        assert.equal(host.gold, gold - 4);
      } else if (scenario === 'district_abilities') {
        const laboratory = host.city.find(card => card.effect === 'laboratory')!;
        const smithy = host.city.find(card => card.effect === 'smithy')!;
        const count = host.hand.length;
        const gold = host.gold;
        assert(useDistrictPower(state, 'p0', laboratory.id, host.hand[0]!.id, state.revision).ok);
        assert(useDistrictPower(state, 'p0', smithy.id, undefined, state.revision).ok);
        assert.equal(host.hand.length, count + 2);
        assert.equal(host.gold, gold);
      } else if (scenario === 'observatory_draw') {
        const privateState = toCitadelsPrivateState(state, 'p0');
        assert.equal(privateState.drawnCards.length, 3);
        assert.equal(toCitadelsPrivateState(state, 'p1').drawnCards.length, 0);
        assert(keepDistrict(state, 'p0', privateState.drawnCards[0]!.id, state.revision).ok);
        assert.equal(state.pendingDraw.length, 0);
      } else if (scenario === 'library_draw') {
        const count = host.hand.length;
        assert(chooseIncome(state, 'p0', 'cards', state.revision).ok);
        assert.equal(host.hand.length, count + 3);
        assert.equal(state.phase, 'action');
      } else {
        const mapRoom = host.hand.find(card => card.effect === 'map_room')!;
        assert(buildDistrict(state, 'p0', mapRoom.id, state.revision).ok);
        assert.equal(state.status, 'playing');
        assert(endCitadelsTurn(state, 'p0', state.revision).ok);
        assert.equal(state.status, 'game_over');
        assert.deepEqual(state.winnerIds, ['p0']);
        assert.equal(state.scoreBreakdowns.p0!.diversityBonus, 3);
        assert.equal(state.scoreBreakdowns.p0!.completionBonus, 4);
      }
      validateCitadelsState(state);
    } finally {
      if (previous === undefined) delete process.env.CITADELS_UI_FIXTURES;
      else process.env.CITADELS_UI_FIXTURES = previous;
    }
  });
}
