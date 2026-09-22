import { BANG_CHARACTERS, type BangCard, type BangCharacterId, type BangRole } from '@zuychin-arcade/types';
import { bangDistance, chooseBangCheck, chooseBangDiscardOrder, chooseBangDraw, chooseBangStoreCard, discardBangCards, endBangTurn, forfeitBangPlayers, initBangGame, playBangCard, rescueBang, respondBang, useBangBarrel, useSidKetchum, validateBangState, type BangEngineResult, type BangServerState } from '../../src/game/bang/engine.js';
import { toBangPrivateState, toBangPublicState } from '../../src/game/bang/publicState.js';

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition { assertions++; if (!condition) throw new Error(`ASSERT FAILED: ${message}`); }
function ok(result: BangEngineResult, message = 'legal action') { assert(result.ok, `${message}${result.ok ? '' : `: ${result.reason}`}`); }
function seededRandom(seed: number) { let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x1_0000_0000; }; }
function identity(s: BangServerState, id: string, role: BangRole, character: BangCharacterId) { const p = s.players.get(id)!; p.role = role; p.character = character; p.maxHealth = BANG_CHARACTERS[character].health + Number(role === 'sheriff'); p.health = p.maxHealth; }
function fixture(count = 4): BangServerState {
  const s = initBangGame('FIXTURE', Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })), seededRandom(87));
  s.deck.push(...(s.pendingDraw?.options ?? [])); s.pendingDraw = null; s.phase = 'play'; s.activeIndex = 0;
  for (const p of s.players.values()) { s.deck.push(...p.hand, ...p.equipment); p.hand = []; p.equipment = []; }
  identity(s, 'p0', 'sheriff', 'willy_the_kid'); identity(s, 'p1', 'outlaw', 'rose_doolan'); identity(s, 'p2', 'renegade', 'slab_the_killer'); identity(s, 'p3', 'outlaw', 'black_jack');
  if (count === 5) identity(s, 'p4', 'deputy', 'bart_cassidy');
  validateBangState(s); return s;
}
function take(s: BangServerState, name: BangCard['name'], face?: { suit: BangCard['suit']; rank?: string }): BangCard {
  const i = s.deck.findIndex(c => c.name === name && (!face || c.suit === face.suit && (!face.rank || c.rank === face.rank)));
  assert(i >= 0, `fixture contains ${name}`); return s.deck.splice(i, 1)[0]!;
}
function hand(s: BangServerState, id: string, ...names: BangCard['name'][]) { const cards = names.map(name => take(s, name)); s.players.get(id)!.hand.push(...cards); return cards; }
function equip(s: BangServerState, id: string, name: BangCard['name']) { s.players.get(id)!.equipment.push(take(s, name)); }
function top(s: BangServerState, name: BangCard['name'], face?: { suit: BangCard['suit']; rank?: string }) { const c = take(s, name, face); s.deck.push(c); return c; }
function fire(s: BangServerState, from = 'p0', to = 'p1', name: 'bang' | 'duel' | 'gatling' | 'indians' = 'bang') { const c = hand(s, from, name)[0]!; ok(playBangCard(s, from, { cardId: c.id, targetPlayerId: to })); }
function settleOrders(s: BangServerState) { while (s.pendingDiscardOrder) ok(chooseBangDiscardOrder(s, s.pendingDiscardOrder.playerId, s.pendingDiscardOrder.cards.map(c => c.id))); }
function focusedScenarios() {
  for (const [departures, expected] of [
    [['p0'], 'The Outlaws win.'],
    [['p1', 'p2', 'p3'], 'The law wins.'],
    [['p0', 'p1', 'p3'], 'The Renegade wins.'],
  ] as const) {
    const s = fixture(); forfeitBangPlayers(s, [...departures]); validateBangState(s);
    assert(s.log.at(-1)?.text === expected, `winner log: ${expected}`);
  }
  {
    const s = fixture(); const c = hand(s, 'p0', 'missed')[0]!; const before = JSON.stringify(toBangPublicState(s, 'p0'));
    assert(!playBangCard(s, 'p0', { cardId: c.id }).ok, 'Missed cannot become equipment');
    assert(JSON.stringify(toBangPublicState(s, 'p0')) === before, 'rejected action does not mutate state');
    s.players.get('p0')!.character = 'calamity_janet'; ok(playBangCard(s, 'p0', { cardId: c.id, targetPlayerId: 'p1' }));
    assert(s.discard.some(x => x.id === c.id && x.name === 'missed'), 'Calamity preserves physical card identity');
  }
  {
    const s = fixture(); s.players.get('p1')!.health = 1; const beer = hand(s, 'p1', 'beer')[0]!; fire(s); ok(respondBang(s, 'p1', undefined));
    assert(s.phase === 'rescue' && s.players.get('p1')!.hand.some(c => c.id === beer.id), 'lethal Beer is an explicit choice');
    assert(toBangPrivateState(s, 'p1').rescueBeerCardIds.includes(beer.id), 'Beer rescue permission is projected');
    ok(rescueBang(s, 'p1', beer.id)); assert(s.players.get('p1')!.health === 1 && s.players.get('p1')!.alive, 'Beer rescues');
    const t = fixture(); t.players.get('p1')!.health = 1; hand(t, 'p1', 'beer'); fire(t); ok(respondBang(t, 'p1', undefined)); ok(rescueBang(t, 'p1', undefined)); settleOrders(t);
    assert(!t.players.get('p1')!.alive, 'Beer can be declined');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'sid_ketchum'; s.players.get('p1')!.health = 1; const cards = hand(s, 'p1', 'missed', 'cat_balou'); fire(s);
    assert(!useSidKetchum(s, 'p1', cards.map(c => c.id)).ok, 'Sid cannot heal nonlethally in another response');
    ok(respondBang(s, 'p1', undefined)); assert(toBangPrivateState(s, 'p1').canUseSid, 'Sid rescue permission'); ok(useSidKetchum(s, 'p1', cards.map(c => c.id))); assert(s.players.get('p1')!.health === 1, 'Sid lethal rescue works');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'lucky_duke'; equip(s, 'p1', 'dynamite');
    const safe = top(s, 'beer'); top(s, 'missed', { suit: 'spades', rank: '2' }); ok(endBangTurn(s, 'p0'));
    assert(s.phase === 'draw_check' && s.pendingCheck?.cards.length === 2, 'Lucky Duke sees both check cards');
    ok(chooseBangCheck(s, 'p1', safe.id)); assert(s.players.get('p1')!.health === 4 && s.players.get('p2')!.equipment.some(c => c.name === 'dynamite'), 'Lucky Duke can choose safe Dynamite result');
    const t = fixture(); t.players.get('p1')!.character = 'lucky_duke'; equip(t, 'p1', 'dynamite'); top(t, 'beer'); const blast = top(t, 'missed', { suit: 'spades', rank: '3' }); ok(endBangTurn(t, 'p0')); ok(chooseBangCheck(t, 'p1', blast.id)); assert(t.players.get('p1')!.health === 1, 'Lucky Duke may choose explosive result');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'jourdonnais'; equip(s, 'p1', 'barrel'); fire(s, 'p0', 'p1', 'gatling'); const before = s.deck.length; top(s, 'beer');
    assert(s.deck.length === before && toBangPrivateState(s, 'p1').barrelOptions.length === 2, 'Gatling offers both optional checks');
    ok(useBangBarrel(s, 'p1', 'barrel')); assert(s.pending?.targetPlayerId === 'p2', 'one successful check ends ordinary Gatling response');
    assert(!useBangBarrel(s, 'p1', 'jourdonnais').ok, 'unnecessary second check rejected');
    const t = fixture(); t.players.get('p0')!.character = 'slab_the_killer'; t.players.get('p2')!.character = 'willy_the_kid'; t.players.get('p1')!.character = 'jourdonnais'; equip(t, 'p1', 'barrel'); fire(t); top(t, 'beer'); ok(useBangBarrel(t, 'p1', 'barrel')); assert(t.pending?.missesPlayed === 1, 'Slab still needs second defence'); top(t, 'beer'); ok(useBangBarrel(t, 'p1', 'jourdonnais')); assert(!t.pending, 'second separate draw can stop Slab');
  }
  {
    const s = fixture(); identity(s, 'p0', 'outlaw', 'rose_doolan'); identity(s, 'p1', 'sheriff', 'willy_the_kid'); identity(s, 'p2', 'renegade', 'slab_the_killer'); s.activeIndex = 2;
    for (const id of ['p0', 'p1', 'p3']) s.players.get(id)!.health = 1;
    fire(s, 'p2', 'p3', 'gatling'); assert(s.pending?.targetPlayerId === 'p3' && s.pending.queue.join(',') === 'p0,p1', 'mass attacks start clockwise from source');
    for (const id of ['p3', 'p0', 'p1']) { ok(respondBang(s, id, undefined)); settleOrders(s); }
    assert(s.winner === 'renegade' && s.status === 'game_over', 'mass victory waits until complete');
    const t = fixture(); identity(t, 'p0', 'renegade', 'willy_the_kid'); identity(t, 'p1', 'sheriff', 'rose_doolan'); identity(t, 'p2', 'outlaw', 'slab_the_killer');
    for (const id of ['p1', 'p2', 'p3']) t.players.get(id)!.health = 1;
    fire(t, 'p0', 'p1', 'indians'); ok(respondBang(t, 'p1', undefined)); assert(t.status === 'playing' && t.pending?.targetPlayerId === 'p2', 'Sheriff dying first does not truncate Indians');
    ok(respondBang(t, 'p2', undefined)); ok(respondBang(t, 'p3', undefined)); assert(t.winner === 'renegade', 'Renegade wins after Sheriff-first queue');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'suzy_lafayette'; hand(s, 'p1', 'missed'); const c = hand(s, 'p0', 'cat_balou')[0]!; ok(playBangCard(s, 'p0', { cardId: c.id, targetPlayerId: 'p1' })); assert(s.players.get('p1')!.hand.length === 1, 'Suzy draws after theft/discard');
    const t = fixture(); t.players.get('p0')!.character = 'suzy_lafayette'; const store = hand(t, 'p0', 'general_store')[0]!; ok(playBangCard(t, 'p0', { cardId: store.id })); assert(t.players.get('p0')!.hand.length === 0, 'Suzy waits for General Store');
    while (t.pending) ok(chooseBangStoreCard(t, t.pending.targetPlayerId, t.pending.storeCards![0]!.id));
    assert(t.players.get('p0')!.hand.length === 1, 'General Store gives Suzy no extra card');
  }
  {
    const s = fixture(); s.players.get('p0')!.character = 'suzy_lafayette'; s.players.get('p0')!.health = 2; const answer = hand(s, 'p1', 'bang')[0]!; fire(s, 'p0', 'p1', 'duel'); assert(s.players.get('p0')!.hand.length === 0, 'Suzy waits for Duel'); ok(respondBang(s, 'p1', answer.id)); ok(respondBang(s, 'p0', undefined)); assert(s.players.get('p0')!.hand.length === 1 && s.players.get('p0')!.health === 1, 'Suzy draws after Duel');
    const t = fixture(); identity(t, 'p0', 'outlaw', 'el_gringo'); identity(t, 'p1', 'sheriff', 'rose_doolan'); identity(t, 'p2', 'renegade', 'slab_the_killer'); t.players.get('p0')!.health = 1; const reply = hand(t, 'p1', 'bang')[0]!; const keep = hand(t, 'p1', 'missed')[0]!; fire(t, 'p0', 'p1', 'duel'); ok(respondBang(t, 'p1', reply.id)); ok(respondBang(t, 'p0', undefined)); assert(t.players.get('p1')!.hand.length === 3 && t.players.get('p1')!.hand[0]!.id === keep.id && t.turnNumber === 2, 'Duel initiator retains kill attribution; next player receives only normal turn draws');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'black_jack'; s.players.get('p3')!.character = 'rose_doolan'; const reveal = top(s, 'beer'); top(s, 'bang'); ok(endBangTurn(s, 'p0')); assert(s.players.get('p1')!.hand.length === 3 && s.log.some(x => x.text.includes(`${reveal.rank} of ${reveal.suit}`) && x.text.includes('beer')), 'Black Jack publishes second card identity');
    const t = fixture(); equip(t, 'p1', 'jail'); top(t, 'beer'); ok(endBangTurn(t, 'p0')); assert(t.discard.at(-1)?.name === 'jail', 'Jail ends above its check card');
  }
  {
    const s = fixture(); s.players.get('p1')!.health = 1; const cards = hand(s, 'p1', 'missed', 'bang'); fire(s); ok(respondBang(s, 'p1', undefined)); assert(s.phase === 'discard_order', 'eliminated player chooses discard order');
    assert(toBangPrivateState(s, 'p0').discardOrderCards.length === 0 && toBangPublicState(s, 'p0').discardOrder?.count === 2, 'elimination card order stays private');
    ok(chooseBangDiscardOrder(s, 'p1', cards.map(c => c.id).reverse())); assert(s.discard.at(-1)?.id === cards[0]!.id, 'last chosen card is top discard');
  }
  {
    const s = fixture(); equip(s, 'p0', 'barrel'); const panic = hand(s, 'p0', 'panic')[0]!; const barrel = s.players.get('p0')!.equipment[0]!;
    ok(playBangCard(s, 'p0', { cardId: panic.id, targetPlayerId: 'p0', targetZone: 'equipment', targetCardId: barrel.id })); assert(s.players.get('p0')!.hand.some(c => c.id === barrel.id), 'self Panic can recover own equipment');
    const self = hand(s, 'p0', 'cat_balou')[0]!; ok(playBangCard(s, 'p0', { cardId: self.id, targetPlayerId: 'p0', targetZone: 'hand' })); assert(s.players.get('p0')!.hand.length === 0, 'self Cat cannot select itself');
    const t = fixture(); equip(t, 'p0', 'schofield'); const duplicate = hand(t, 'p0', 'schofield')[0]!; assert(!playBangCard(t, 'p0', { cardId: duplicate.id }).ok, 'same weapon cannot replace itself'); const upgrade = hand(t, 'p0', 'winchester')[0]!; ok(playBangCard(t, 'p0', { cardId: upgrade.id })); assert(t.players.get('p0')!.equipment[0]!.name === 'winchester', 'different weapon replaces');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'bart_cassidy'; s.players.get('p1')!.health = 1; top(s, 'beer'); fire(s); ok(respondBang(s, 'p1', undefined)); assert(!s.players.get('p1')!.alive, 'Bart cannot draw a lethal-hit rescue Beer');
    const t = fixture(); t.players.get('p0')!.character = 'suzy_lafayette'; t.players.get('p1')!.character = 'el_gringo'; fire(t); assert(t.players.get('p0')!.hand.length === 1, 'Suzy draws before El Gringo'); ok(respondBang(t, 'p1', undefined)); assert(t.players.get('p0')!.hand.length === 1 && t.players.get('p1')!.hand.length === 1, 'El Gringo steals then Suzy draws again');
  }
  {
    const s = fixture(); equip(s, 'p1', 'dynamite'); s.players.get('p1')!.health = 1; const beers = hand(s, 'p1', 'beer', 'beer', 'beer'); top(s, 'missed', { suit: 'spades', rank: '4' }); ok(endBangTurn(s, 'p0'));
    assert(s.pendingRescue?.livesNeeded === 3, 'Dynamite rescue records multiple lives'); for (const beer of beers) ok(rescueBang(s, 'p1', beer.id)); assert(s.players.get('p1')!.health === 1 && s.phase === 'play', 'three sequential Beers rescue Dynamite');
    const t = fixture(); t.players.get('p1')!.alive = false; t.players.get('p1')!.health = 0; t.players.get('p3')!.alive = false; t.players.get('p3')!.health = 0; t.players.get('p2')!.character = 'sid_ketchum'; t.players.get('p2')!.health = 1; const cards = hand(t, 'p2', 'beer', 'missed'); fire(t, 'p0', 'p2'); ok(respondBang(t, 'p2', undefined)); assert(toBangPrivateState(t, 'p2').rescueBeerCardIds.length === 0, 'Beer cannot rescue at two players'); ok(useSidKetchum(t, 'p2', cards.map(c => c.id))); assert(t.players.get('p2')!.health === 1, 'Sid still heals at two players');
  }
  {
    const s = fixture(5); s.players.get('p0')!.character = 'vulture_sam'; s.players.get('p4')!.health = 1; hand(s, 'p4', 'missed'); hand(s, 'p0', 'beer'); equip(s, 'p0', 'winchester'); fire(s, 'p0', 'p4'); ok(respondBang(s, 'p4', undefined)); assert(s.pendingDiscardOrder?.reason === 'penalty' && s.pendingDiscardOrder.cards.some(c => c.name === 'missed'), 'Vulture Sheriff penalty includes inherited cards'); settleOrders(s); assert(s.players.get('p0')!.hand.length === 0 && s.players.get('p0')!.equipment.length === 0, 'Sheriff loses all cards for Deputy kill');
    const t = fixture(5); hand(t, 'p0', 'beer'); hand(t, 'p4', 'missed'); const before = t.players.get('p0')!.hand.length; assert(forfeitBangPlayers(t, ['p4']), 'Deputy forfeit processed'); assert(t.players.get('p0')!.hand.length === before, 'Deputy forfeit has no Sheriff penalty'); assert(forfeitBangPlayers(t, ['p1']), 'Outlaw forfeit processed'); assert(t.players.get('p0')!.hand.length === before, 'Outlaw forfeit gives no reward');
  }
  {
    const s = fixture(); hand(s, 'p0', 'bang'); const p = toBangPrivateState(s, 'p0'); p.hand[0]!.name = 'beer'; assert(s.players.get('p0')!.hand[0]!.name === 'bang', 'private projection detached');
    const cards = [...s.deck]; s.deck.pop(); assertThrows(() => validateBangState(s), 'missing-card conservation'); s.deck = cards; s.deck.push(s.deck[0]!); assertThrows(() => validateBangState(s), 'duplicate-card conservation');
  }
  {
    const s = fixture(); s.players.get('p0')!.character = 'slab_the_killer'; s.players.get('p2')!.character = 'willy_the_kid'; s.players.get('p1')!.character = 'suzy_lafayette'; const missed = hand(s, 'p1', 'missed')[0]!; fire(s); const next = top(s, 'missed'); ok(respondBang(s, 'p1', missed.id)); assert(s.pending?.missesPlayed === 1 && s.players.get('p1')!.hand[0]!.id === next.id, 'Suzy can draw second Missed during Slab response'); ok(respondBang(s, 'p1', next.id)); assert(s.players.get('p1')!.health === 4 && !s.pending, 'Suzy completes both Slab responses');
    const t = fixture(); t.players.get('p1')!.character = 'jesse_jones'; t.players.get('p2')!.character = 'suzy_lafayette'; const stolen = hand(t, 'p2', 'bang')[0]!; ok(endBangTurn(t, 'p0')); ok(chooseBangDraw(t, 'p1', { useAbility: true, targetPlayerId: 'p2' })); assert(t.players.get('p2')!.hand.length === 1 && t.players.get('p1')!.hand.some(c => c.id === stolen.id), 'Jesse theft triggers Suzy');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'kit_carlson'; ok(endBangTurn(s, 'p0')); const options = s.pendingDraw!.options!;
    assert(toBangPrivateState(s, 'p0').drawChoice === null && !JSON.stringify(toBangPublicState(s, 'p0')).includes(options[0]!.id), 'Kit options never enter public or opponent private state');
    const before = s.revision; assert(!chooseBangDraw(s, 'p1', { cardIds: [options[0]!.id, options[0]!.id] }).ok && s.revision === before, 'Kit rejects duplicates without mutation');
    ok(chooseBangDraw(s, 'p1', { cardIds: [options[0]!.id, options[2]!.id] })); assert(s.deck.at(-1)?.id === options[1]!.id, 'Kit returns unchosen card to top');
    const t = fixture(); t.players.get('p1')!.character = 'pedro_ramirez'; const wanted = take(t, 'beer'); t.discard.push(wanted); ok(endBangTurn(t, 'p0')); t.discard.unshift(...t.deck.splice(0)); ok(chooseBangDraw(t, 'p1', { useAbility: true })); assert(t.players.get('p1')!.hand[0]!.id === wanted.id && t.players.get('p1')!.hand.length === 2 && t.discard.length === 0, 'Pedro takes discard before empty-deck reshuffle');
  }
  {
    const s = fixture(); s.players.get('p0')!.character = 'rose_doolan'; s.players.get('p1')!.character = 'paul_regret'; equip(s, 'p1', 'mustang'); equip(s, 'p0', 'scope');
    assert(bangDistance(s, 'p0', 'p1') === 1 && bangDistance(s, 'p2', 'p1') === 3 && bangDistance(s, 'p1', 'p2') === 1, 'distance modifiers stack asymmetrically');
    const t = fixture(); t.players.get('p0')!.character = 'slab_the_killer'; t.players.get('p2')!.character = 'willy_the_kid'; fire(t); ok(respondBang(t, 'p1', undefined)); const next = hand(t, 'p0', 'bang')[0]!; assert(!playBangCard(t, 'p0', { cardId: next.id, targetPlayerId: 'p1' }).ok, 'ordinary character cannot play second BANG'); const volcanic = hand(t, 'p0', 'volcanic')[0]!; ok(playBangCard(t, 'p0', { cardId: volcanic.id })); ok(playBangCard(t, 'p0', { cardId: next.id, targetPlayerId: 'p1' })); assert(t.players.get('p0')!.bangsPlayed === 2, 'Volcanic permits further BANG cards');
  }
  {
    const s = fixture(); s.players.get('p1')!.character = 'bart_cassidy'; equip(s, 'p1', 'dynamite'); equip(s, 'p1', 'jail'); top(s, 'beer'); top(s, 'beer'); top(s, 'beer'); top(s, 'beer'); top(s, 'missed', { suit: 'spades', rank: '5' }); ok(endBangTurn(s, 'p0'));
    assert(s.players.get('p1')!.health === 1 && s.players.get('p1')!.hand.length === 5 && s.discard.at(-1)?.name === 'jail', 'Dynamite precedes Jail; surviving Bart draws three then normal two');
    const t = fixture(); t.players.get('p0')!.health--; t.players.get('p1')!.health--; t.players.get('p3')!.health = 0; t.players.get('p3')!.alive = false; const saloon = hand(t, 'p0', 'saloon')[0]!; ok(playBangCard(t, 'p0', { cardId: saloon.id })); assert(t.players.get('p0')!.health === t.players.get('p0')!.maxHealth && t.players.get('p1')!.health === t.players.get('p1')!.maxHealth && !t.players.get('p3')!.alive, 'Saloon heals all living players without reviving');
  }
}
function assertThrows(action: () => void, message: string) { let threw = false; try { action(); } catch { threw = true; } assert(threw, message); }

function departureScenarios() {
  const scenarios: [string, () => BangServerState][] = [
    ['play', () => fixture()],
    ['response', () => { const s = fixture(); fire(s); return s; }],
    ['duel', () => { const s = fixture(); fire(s, 'p0', 'p1', 'duel'); return s; }],
    ['mass', () => { const s = fixture(); fire(s, 'p0', 'p1', 'gatling'); return s; }],
    ['store', () => { const s = fixture(); const c = hand(s, 'p0', 'general_store')[0]!; ok(playBangCard(s, 'p0', { cardId: c.id })); return s; }],
    ['draw', () => { const s = fixture(); s.players.get('p1')!.character = 'kit_carlson'; ok(endBangTurn(s, 'p0')); return s; }],
    ['check', () => { const s = fixture(); s.players.get('p1')!.character = 'lucky_duke'; equip(s, 'p1', 'jail'); ok(endBangTurn(s, 'p0')); return s; }],
    ['rescue', () => { const s = fixture(); s.players.get('p1')!.health = 1; hand(s, 'p1', 'beer'); fire(s); ok(respondBang(s, 'p1', undefined)); return s; }],
    ['order', () => { const s = fixture(); s.players.get('p1')!.health = 1; hand(s, 'p1', 'missed', 'bang'); fire(s); ok(respondBang(s, 'p1', undefined)); return s; }],
    ['discard', () => { const s = fixture(); hand(s, 'p0', 'bang', 'bang', 'bang', 'bang', 'bang', 'missed'); ok(endBangTurn(s, 'p0')); return s; }],
  ];
  for (const [name, make] of scenarios) for (const ids of [['p0'], ['p1'], ['p2'], ['p1', 'p2'], ['p0', 'p1', 'p2', 'p3']]) {
    const s = make(); assert(forfeitBangPlayers(s, ids), `${name}: departures change state`); validateBangState(s);
    for (const id of ids) assert(s.players.get(id)!.forfeited && !s.players.get(id)!.alive, `${name}: no passive seat`);
    if (ids.length === 4) assert(s.abandoned && s.winner === null && s.status === 'game_over', `${name}: all left abandons`);
    else if (s.status === 'playing') {
      const actor = s.pendingDiscardOrder?.playerId ?? s.pendingRescue?.playerId ?? s.pendingCheck?.playerId ?? s.pendingDraw?.playerId ?? s.pending?.targetPlayerId ?? s.turnOrder[s.activeIndex]!;
      assert(!s.players.get(actor)!.forfeited, `${name}: continuation belongs to a present player`);
      playToEnd(s, 2000);
    }
  }
}

function playToEnd(s: BangServerState, limit = 12000) {
  let guard = 0;
  while (s.status === 'playing' && guard++ < limit) {
    validateBangState(s); assertions++;
    const publicState = toBangPublicState(s, 'observer');
    const id = publicState.discardOrder?.playerId ?? publicState.rescue?.playerId ?? publicState.drawCheck?.playerId ?? publicState.drawChoice?.playerId ?? publicState.pending?.targetPlayerId ?? publicState.activePlayerId;
    const mine = toBangPrivateState(s, id);
    if (mine.canChooseDiscardOrder) ok(chooseBangDiscardOrder(s, id, mine.discardOrderCards.map(c => c.id), mine.revision));
    else if (mine.canRescue) {
      if (mine.rescueBeerCardIds.length) ok(rescueBang(s, id, mine.rescueBeerCardIds[0], mine.revision));
      else if (mine.canUseSid) ok(useSidKetchum(s, id, mine.hand.slice(0, 2).map(c => c.id), mine.revision));
      else ok(rescueBang(s, id, undefined, mine.revision));
    } else if (mine.canChooseCheck) {
      const check = publicState.drawCheck!;
      const selected = check.cards.find(c => check.kind === 'dynamite' ? !(c.suit === 'spades' && Number(c.rank) >= 2 && Number(c.rank) <= 9) : c.suit === 'hearts') ?? check.cards[0]!;
      ok(chooseBangCheck(s, id, selected.id, mine.revision));
    } else if (mine.canChooseDraw) {
      if (mine.drawChoice!.kind === 'kit_carlson') ok(chooseBangDraw(s, id, { cardIds: mine.drawChoice!.options!.slice(0, 2).map(c => c.id), expectedRevision: mine.revision }));
      else if (mine.drawChoice!.kind === 'jesse_jones') { const target = publicState.players.find(p => p.alive && p.playerId !== id && p.handCount > 0); ok(chooseBangDraw(s, id, { useAbility: Boolean(target), targetPlayerId: target?.playerId, expectedRevision: mine.revision })); }
      else ok(chooseBangDraw(s, id, { useAbility: true, expectedRevision: mine.revision }));
    } else if (mine.canChooseStore) ok(chooseBangStoreCard(s, id, publicState.pending!.storeCards![0]!.id, mine.revision));
    else if (mine.canRespond) {
      if (mine.barrelOptions.length) ok(useBangBarrel(s, id, mine.barrelOptions[0]!, mine.revision));
      else ok(respondBang(s, id, mine.responseCardIds[0], mine.revision));
    } else if (mine.canDiscard) {
      const hp = publicState.players.find(p => p.playerId === id)!.health;
      ok(discardBangCards(s, id, mine.hand.slice(0, mine.hand.length - hp).map(c => c.id), mine.revision));
    } else if (mine.canPlay) {
      // Avoid self-theft cycles while retaining every generated move's public legality.
      const options = mine.playOptions.filter(o => !['panic', 'cat_balou'].includes(o.effectiveName) || o.targets.some(t => t.playerId !== id));
      const priority = ['bang', 'gatling', 'indians', 'duel', 'wells_fargo', 'stagecoach', 'general_store'];
      const option = [...options].sort((a, b) => (priority.indexOf(a.effectiveName) < 0 ? 99 : priority.indexOf(a.effectiveName)) - (priority.indexOf(b.effectiveName) < 0 ? 99 : priority.indexOf(b.effectiveName)))[0];
      if (option) { const target = option.targets.find(t => t.playerId !== id) ?? option.targets[0]; ok(playBangCard(s, id, { cardId: option.cardId, targetPlayerId: target?.playerId, targetZone: target?.hand ? 'hand' : target?.equipmentCardIds.length ? 'equipment' : undefined, targetCardId: target?.equipmentCardIds[0], expectedRevision: mine.revision })); }
      else ok(endBangTurn(s, id, mine.revision));
    } else throw new Error(`No legal actor: ${s.phase} ${id}`);
  }
  assert(s.status === 'game_over', `game completes within ${limit} actions (turn ${s.turnNumber}, phase ${s.phase})`);
  validateBangState(s);
}

focusedScenarios(); departureScenarios();
for (let count = 4; count <= 7; count++) for (let game = 0; game < 60; game++) {
  const s = initBangGame(`SIM-${count}-${game}`, Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })), seededRandom(count * 10000 + game));
  try { playToEnd(s); } catch (error) { throw new Error(`Seed ${count * 10000 + game}: ${String(error)}`); }
  assert(s.winner && !s.abandoned, 'normal match has a winner');
}
console.log(`BANG SIM PASS: 240 complete seeded 4–7 player games, 50 departure interruptions, ${assertions} assertions/invariant checks.`);
