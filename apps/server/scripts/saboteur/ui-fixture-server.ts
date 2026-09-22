import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import type { GameCard, PathCard } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { initGame, playAction, type SaboteurServerState } from '../../src/game/saboteur/engine.js';
import { buildFullDeck, makeGoalCard } from '../../src/game/saboteur/deck.js';
import { emitGameState } from '../../src/game/saboteur/socketHandlers.js';
import { rotateEdges } from '../../src/game/saboteur/boardValidator.js';

assert.equal(process.env.SABOTEUR_UI_FIXTURES, 'true');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true');
assert.equal(supabase, null, 'UI fixtures refuse hosted persistence');
const names = ['Fixture Host', 'Fixture Second', 'Fixture Third'];
const app = Fastify({ logger: false });
const origins = ['http://127.0.0.1:8081', 'http://localhost:8081'];
await app.register(cors, { origin: origins });
const io = new Server(app.server, { cors: { origin: origins } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);

function take(state: SaboteurServerState, predicate: (card: GameCard) => boolean) {
  const index = state.deck.findIndex(predicate);
  assert(index >= 0, 'Canonical fixture card exists');
  return state.deck.splice(index, 1)[0]!;
}
function conserve(state: SaboteurServerState) {
  const players = [...state.players.values()];
  const cards = [...state.deck, ...state.discard, ...players.flatMap((player) => player.hand), ...state.board.filter((placed) => placed.card.subtype === 'tunnel').map((placed) => placed.card)];
  assert.equal(cards.length, 67);
  assert.equal(new Set(cards.map((card) => card.id)).size, 67);
  assert.equal(cards.filter((card) => card.type === 'path').length, 40);
  assert.equal(cards.filter((card) => card.type === 'action').length, 27);
  assert.equal(state.goldDeck.reduce((sum, value) => sum + value, 0) + players.reduce((sum, player) => sum + player.goldCollected, 0) + (state.goldDistribution?.availableCards.reduce((sum, value) => sum + value, 0) ?? 0), 44);
  assert.equal(state.goals.filter((goal) => goal.isGold).length, 1);
}

app.get('/', async () => ({ status: 'ok', service: 'saboteur-local-ui-fixtures' }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/saboteur-fixture', async (request, reply) => {
  const { roomCode, scenario } = request.body;
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  if (!room || room.game?.id !== 'saboteur' || room.players.size !== 3 || !names.every((name) => [...room.players.values()].some((player) => player.displayName === name))
    || !['gold', 'stone', 'dual_repair'].includes(scenario ?? '')) return reply.code(400).send({ error: 'Exact synthetic room and named scenario required' });
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const players = names.map((name) => [...room.players.values()].find((player) => player.displayName === name)!);
  const state = initGame(room.roomCode, players);
  state.revision = room.game.state.revision + 10;
  state.deck = buildFullDeck();
  for (const [index, player] of [...state.players.values()].entries()) { player.hand = []; player.role = index === 2 ? 'saboteur' : 'miner'; }
  const host = state.players.get(players[0]!.playerId)!;
  if (scenario === 'dual_repair') {
    const attacker = state.players.get(players[2]!.playerId)!;
    for (const tool of ['lantern', 'cart']) {
      const card = take(state, (candidate) => candidate.type === 'action' && candidate.subtype === 'sabotage_' + tool);
      attacker.hand.push(card); state.currentTurnIndex = 2;
      assert.equal(playAction(state, attacker.playerId, card.id, host.playerId).ok, true);
    }
    host.hand.push(take(state, (card) => card.type === 'action' && card.subtype === 'repair_lantern_cart'));
  } else {
    state.goals.forEach((goal, index) => {
      goal.isGold = index === (scenario === 'gold' ? 1 : 0);
      goal.card = makeGoalCard(goal.isGold, index, index === 2 ? 'right' : 'left');
    });
    const vertical = (card: GameCard): card is PathCard => card.type === 'path' && card.edges.center && card.edges.top === 'open' && card.edges.bottom === 'open';
    for (let row = 1; row <= 6; row++) state.board.push({ card: take(state, vertical) as PathCard, position: { row, col: 4 }, placedBy: host.playerId });
    if (scenario === 'stone') {
      const bottomLeft = (card: GameCard): card is PathCard => card.type === 'path' && card.edges.center && card.edges.top === 'closed' && card.edges.right === 'closed' && card.edges.bottom === 'open' && card.edges.left === 'open';
      const turn = take(state, bottomLeft) as PathCard;
      state.board.push({ card: { ...turn, edges: rotateEdges(turn.edges, true) }, position: { row: 7, col: 4 }, placedBy: host.playerId });
      state.board.push({ card: take(state, bottomLeft) as PathCard, position: { row: 7, col: 5 }, placedBy: host.playerId });
      host.hand.push(take(state, (card) => card.type === 'path' && card.edges.center && card.edges.top === 'closed' && card.edges.left === 'closed' && card.edges.right === 'open' && card.edges.bottom === 'open'));
      for (let count = 0; count < 2; count++) host.hand.push(take(state, (card) => card.type === 'action' && card.subtype === 'map'));
    } else host.hand.push(take(state, vertical));
    if (scenario === 'gold') {
      const high = state.goldDeck.splice(state.goldDeck.indexOf(3), 1)[0]!;
      const low = state.goldDeck.splice(state.goldDeck.indexOf(1), 1)[0]!;
      state.goldDeck.unshift(low, high);
    }
  }
  state.currentTurnIndex = 0;
  conserve(state);
  room.game = { id: 'saboteur', state };
  room.status = 'in_game';
  emitGameState(io, room);
  return { scenario, revision: state.revision, canonicalCards: 67, goldNuggets: 44 };
});
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('Saboteur supplementary UI fixture API listening on 127.0.0.1:3213; hosted persistence disabled');
