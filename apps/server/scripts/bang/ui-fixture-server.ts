import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { BANG_CHARACTERS, type BangCard, type BangCardName, type BangCharacterId, type BangRole } from '@zuychin-arcade/types';
import { registerRoomRoutes } from '../../src/routes/room.js';
import { registerSocketHandlers } from '../../src/socket/handlers.js';
import { roomStore } from '../../src/store/RoomStore.js';
import { supabase } from '../../src/lib/supabase.js';
import { createBangDeck } from '../../src/game/bang/deck.js';
import { validateBangState, type BangServerState } from '../../src/game/bang/engine.js';
import { toBangPrivateState, toBangPublicState } from '../../src/game/bang/publicState.js';

assert.equal(process.env.BANG_UI_FIXTURES, 'true', 'This fixture server requires explicit BANG_UI_FIXTURES=true');
assert.equal(supabase, null, 'Fixture server refuses hosted persistence');
assert.equal(process.env.ARCADE_INSECURE_LOCAL_DEV, 'true', 'Fixture server requires explicit local mode');
const app = Fastify({ logger: false });
await app.register(cors, { origin: ['http://127.0.0.1:8081', 'http://localhost:8081'] });
const io = new Server(app.server, { cors: { origin: ['http://127.0.0.1:8081', 'http://localhost:8081'] } });
registerRoomRoutes(app, io);
registerSocketHandlers(io);
const names = ['Astra Host', 'Lyra', 'Noor', 'Echo'];
const scenarios = ['lucky_check', 'sid_rescue', 'sid_two_alive', 'beer_rescue', 'discard_order', 'kit_draw', 'jesse_draw', 'pedro_draw', 'calamity_play', 'self_zones', 'barrel_choice'] as const;
type Scenario = typeof scenarios[number];

function prepare(state: BangServerState, scenario: Scenario) {
  state.deck = createBangDeck(() => 0.5);
  state.discard = [];
  state.pending = null;
  state.pendingDraw = null;
  state.pendingCheck = null;
  state.pendingRescue = null;
  state.pendingDiscardOrder = null;
  state.damageContext = null;
  state.status = 'playing';
  state.phase = 'play';
  state.winner = null;
  state.abandoned = false;
  state.activeIndex = 0;
  state.turnNumber = 1;
  state.turnOrder = names.map(name => [...state.players.values()].find(player => player.displayName === name)!.playerId);
  const characters: BangCharacterId[] = ['bart_cassidy', 'sid_ketchum', 'lucky_duke', 'calamity_janet'];
  const roles: BangRole[] = ['sheriff', 'outlaw', 'renegade', 'outlaw'];
  const players = state.turnOrder.map(id => state.players.get(id)!);
  players.forEach((player, index) => {
    player.character = characters[index]!;
    player.role = roles[index]!;
    player.maxHealth = BANG_CHARACTERS[player.character].health + (index === 0 ? 1 : 0);
    player.health = player.maxHealth;
    player.alive = true;
    player.forfeited = false;
    player.hand = [];
    player.equipment = [];
    player.bangsPlayed = 0;
  });
  const take = (name?: BangCardName, predicate?: (card: BangCard) => boolean) => {
    const index = state.deck.findIndex(card => (!name || card.name === name) && (!predicate || predicate(card)));
    assert(index >= 0, `Canonical card unavailable: ${name}`);
    return state.deck.splice(index, 1)[0]!;
  };
  const attack = (index: number) => {
    state.pending = { kind: 'bang', sourcePlayerId: players[0]!.playerId, targetPlayerId: players[index]!.playerId,
      queue: [], response: 'missed', missesRequired: 1, missesPlayed: 0, barrelsUsed: [] };
    state.discard.push(take('bang'));
  };
  if (scenario === 'lucky_check') {
    attack(2);
    players[2]!.equipment.push(take('barrel'));
    state.pending!.barrelsUsed = ['barrel'];
    state.pendingCheck = { playerId: players[2]!.playerId, kind: 'barrel', cards: [take(undefined, card => card.suit !== 'hearts'), take(undefined, card => card.suit === 'hearts')] };
    state.phase = 'draw_check';
  } else if (scenario === 'sid_rescue' || scenario === 'sid_two_alive' || scenario === 'beer_rescue') {
    const sid = scenario !== 'beer_rescue';
    const index = sid ? 1 : 2;
    const player = players[index]!;
    attack(index);
    player.health = sid ? 0 : -1;
    player.hand.push(...(sid ? [take('bang'), take('missed')] : [take('beer'), take('beer')]));
    state.damageContext = { playerId: player.playerId, amount: 1 - player.health, sourcePlayerId: players[0]!.playerId, cause: 'bang' };
    state.pendingRescue = { playerId: player.playerId, livesNeeded: 1 - player.health, sourcePlayerId: players[0]!.playerId, cause: 'bang' };
    state.phase = 'rescue';
    if (scenario === 'sid_two_alive') for (const eliminated of players.slice(2)) { eliminated.health = 0; eliminated.alive = false; }
    if (!sid) {
      state.activeIndex = 2;
      state.pending = null;
      state.discard.push(take('dynamite'));
      state.damageContext = { playerId: player.playerId, amount: 3, cause: 'dynamite' };
      state.pendingRescue = { playerId: player.playerId, livesNeeded: 2, sourcePlayerId: null, cause: 'dynamite' };
    }
  } else if (scenario === 'discard_order') {
    attack(2);
    players[2]!.health = 0;
    players[2]!.alive = false;
    state.damageContext = { playerId: players[2]!.playerId, amount: 1, sourcePlayerId: players[0]!.playerId, cause: 'bang' };
    state.pendingDiscardOrder = { playerId: players[2]!.playerId, reason: 'elimination', cards: [take('beer'), take('barrel')] };
    state.phase = 'discard_order';
  } else if (scenario === 'kit_draw' || scenario === 'jesse_draw' || scenario === 'pedro_draw') {
    state.activeIndex = 3;
    const kind = scenario === 'kit_draw' ? 'kit_carlson' : scenario === 'jesse_draw' ? 'jesse_jones' : 'pedro_ramirez';
    players[3]!.character = kind;
    state.pendingDraw = { playerId: players[3]!.playerId, kind, ...(kind === 'kit_carlson' ? { options: [take('bang'), take('beer'), take('missed')] } : {}) };
    if (kind === 'jesse_jones') players[0]!.hand.push(take('bang'));
    if (kind === 'pedro_ramirez') state.discard.push(take('beer'));
    state.phase = 'draw_choice';
  } else if (scenario === 'calamity_play') {
    state.activeIndex = 3;
    players[3]!.hand.push(take('missed'));
  } else if (scenario === 'self_zones') {
    state.activeIndex = 3;
    players[3]!.hand.push(take('panic'), take('cat_balou'));
    players[3]!.equipment.push(take('mustang'), take('scope'));
  } else if (scenario === 'barrel_choice') {
    attack(3);
    players[3]!.character = 'jourdonnais';
    players[3]!.equipment.push(take('barrel'));
    players[3]!.hand.push(take('missed'));
    const top = take(undefined, card => card.suit !== 'hearts');
    state.deck.push(top);
    state.phase = 'response';
  }
  state.revision += 10;
  state.log.push({ id: ++state.logSeq, text: `Local QA fixture: ${scenario}. All 80 canonical cards conserved.` });
  validateBangState(state);
}

app.get('/', async () => ({ status: 'ok', service: 'bang-local-ui-fixtures' }));
app.post<{ Body: { roomCode?: string; scenario?: string } }>('/__qa/bang-fixture', async (request, reply) => {
  const { roomCode, scenario } = request.body;
  const room = typeof roomCode === 'string' ? roomStore.get(roomCode) : undefined;
  if (!room || room.game?.id !== 'bang' || room.players.size !== 4
    || !names.every(name => [...room.players.values()].some(player => player.displayName === name))
    || !scenarios.includes(scenario as Scenario)) return reply.code(400).send({ error: 'Only an exact four-seat synthetic QA room and a named fixture are supported' });
  prepare(room.game.state, scenario as Scenario);
  room.status = 'in_game';
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit('game_state', toBangPublicState(room.game.state, player.playerId));
    io.to(player.socketId).emit('private_state', toBangPrivateState(room.game.state, player.playerId));
  }
  return { scenario, revision: room.game.state.revision, canonicalCards: 80 };
});
await app.listen({ host: '127.0.0.1', port: 3213 });
console.log('BANG local-only UI fixture API listening on 127.0.0.1:3213, persistence disabled');
