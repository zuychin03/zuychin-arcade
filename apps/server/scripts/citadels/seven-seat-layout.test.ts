import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITADELS_SEVEN_LAYOUT_NAMES, CITADELS_UI_FIXTURE_SCENARIOS, createCitadelsSevenSeatLayout, createCitadelsUiFixture } from './ui-fixtures.js';
import { toCitadelsPrivateState, toCitadelsPublicState } from '../../src/game/citadels/publicState.js';
import { validateCitadelsState } from '../../src/game/citadels/engine.js';

const players = CITADELS_SEVEN_LAYOUT_NAMES.map((displayName, index) => ({ playerId: `layout-${index}`, displayName }));
function gated(run: () => void) {
  const keys = ['CITADELS_UI_FIXTURES', 'CITADELS_SEVEN_SEAT_LAYOUT'] as const;
  const before = keys.map(key => process.env[key]);
  try { keys.forEach(key => { process.env[key] = 'true'; }); run(); }
  finally { keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; }); }
}

test('seven-seat layout has a separate opt-in and leaves four-seat defaults unchanged', () => gated(() => {
  assert.equal(CITADELS_UI_FIXTURE_SCENARIOS.length, 7);
  assert(!CITADELS_UI_FIXTURE_SCENARIOS.some(scenario => String(scenario) === 'seven_seat_layout'));
  delete process.env.CITADELS_SEVEN_SEAT_LAYOUT;
  assert.throws(() => createCitadelsSevenSeatLayout('LAYOUT', players, 100), /Separate seven-seat/);
  process.env.CITADELS_SEVEN_SEAT_LAYOUT = 'true';
  delete process.env.CITADELS_UI_FIXTURES;
  assert.throws(() => createCitadelsSevenSeatLayout('LAYOUT', players, 100), /Explicit isolated/);
  process.env.CITADELS_UI_FIXTURES = 'true';
  assert.throws(() => createCitadelsSevenSeatLayout('LAYOUT', players.slice(0, 4), 100), /seven synthetic/);
  assert.throws(() => createCitadelsUiFixture('LAYOUT', players, 'magician_redraw', 100), /four synthetic/);
}));

test('seven-seat canonical table conserves all cards without premature completion', () => gated(() => {
  const state = createCitadelsSevenSeatLayout('LAYOUT', players, 100);
  validateCitadelsState(state);
  assert.equal(state.revision, 100);
  assert.equal(state.status, 'playing');
  assert.equal(state.phase, 'action');
  assert.equal(state.activePlayerId, players[0]!.playerId);
  assert.equal(state.activeRole, 'magician');
  assert.equal(state.players.size, 7);
  assert.equal(state.firstCompletedPlayerId, null);
  assert.deepEqual(state.completionOrder, []);
  assert.deepEqual([...state.players.values()].map(p => p.city.length), [6, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual([...state.players.values()].map(p => p.hand.length), [6, 4, 4, 4, 4, 4, 4]);
  assert.equal(state.districtDeck.length, 20);
  const cards = [...state.districtDeck, ...state.pendingDraw, ...[...state.players.values()].flatMap(p => [...p.hand, ...p.city])];
  assert.equal(cards.length, 68); assert.equal(new Set(cards.map(c => c.id)).size, 68);
  assert.equal(CITADELS_SEVEN_LAYOUT_NAMES[6].length, 20);
}));

test('seven-seat public projections do not disclose uncalled characters or district hands', () => gated(() => {
  const state = createCitadelsSevenSeatLayout('LAYOUT', players, 100);
  const publicState = toCitadelsPublicState(state);
  for (const [index, player] of players.entries()) {
    const own = toCitadelsPrivateState(state, player.playerId);
    const rival = publicState.players.find(p => p.playerId === player.playerId)!;
    assert.equal(own.playerId, player.playerId);
    assert.equal(own.hand.length, index === 0 ? 6 : 4);
    assert.equal(own.revision, publicState.revision);
    assert(own.chosenRole);
    assert.equal(rival.revealedRole, index === 0 ? 'magician' : index === 6 ? 'thief' : null);
    for (const field of ['hand', 'role', 'chosenRole', 'availableRoles', 'drawnCards']) assert(!Object.hasOwn(rival, field));
    assert.equal(own.canAct, index === 0);
  }
}));
