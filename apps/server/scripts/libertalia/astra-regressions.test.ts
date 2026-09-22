import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forfeitLibertaliaPlayers, initLibertaliaGame, resolveLibertaliaChoice, selectLibertaliaCrew, settleLibertaliaAutopilot, validateLibertalia } from '../../src/game/libertalia/engine.js';
import { toLibertaliaPrivateState, toLibertaliaPublicState } from '../../src/game/libertalia/publicState.js';

const bases = [{ playerId: 'a', displayName: 'A' }, { playerId: 'b', displayName: 'B' }];
function checkpoint(ranks: number[], voyage: 1 | 2 | 3 = 1, count = 2) {
  const seats = count === 2 ? bases : Array.from({length:count},(_,i)=>({playerId:String.fromCharCode(97+i),displayName:String.fromCharCode(65+i)}));
  const state = initLibertaliaGame('ASTRA', seats, () => 0.42);
  const dealt = [...new Set([...ranks, ...Array.from({ length: 40 }, (_, index) => index + 1)])].slice(0, voyage * 6);
  state.voyage = voyage; state.daysInVoyage = voyage + 3;
  state.undealtCrew = Array.from({ length: 40 }, (_, index) => index + 1).filter((rank) => !dealt.includes(rank));
  for (const player of state.players.values()) { player.hand = [...dealt]; player.dealtRanks = [...dealt]; }
  state.lootBag.push(...state.lootDays.flat());
  state.lootDays = Array.from({ length: state.daysInVoyage }, () => state.lootBag.splice(0, 3));
  state.reputationTrack = count === 2 ? ['inactive:0', 'inactive:1', 'a', 'b', 'inactive:2', 'inactive:3'] : [...seats.map(p=>p.playerId),...Array.from({length:6-count},(_,i)=>`inactive:${i}`)];
  validateLibertalia(state);
  return state;
}
function choose(state: ReturnType<typeof checkpoint>, id: string) {
  const pending = state.pendingChoice!;
  assert(pending.options.some((option) => option.id === id), `Missing ${id}: ${pending.prompt}`);
  const result = resolveLibertaliaChoice(state, pending.playerId, pending.id, [id], state.revision);
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}
function moveLoot(state: ReturnType<typeof checkpoint>, kind: string, destination: typeof state.lootBag) {
  for (const zone of [state.lootBag, ...state.lootDays, ...[...state.players.values()].map(p => p.loot)]) {
    const index = zone.findIndex(t => t.kind === kind);
    if (index >= 0) { destination.push(...zone.splice(index, 1)); return destination.at(-1)!; }
  }
  throw new Error(`No ${kind}`);
}
function step(state: ReturnType<typeof checkpoint>) {
  if (state.phase === 'selection') {
    const p = state.turnOrder.map(id => state.players.get(id)!).find(p => p.selectedRank === null && p.hand.length > 0)!;
    assert(selectLibertaliaCrew(state, p.playerId, p.hand[0]!, state.revision).ok);
  } else { assert(state.pendingChoice); choose(state, state.pendingChoice.options[0]!.id); }
  settleLibertaliaAutopilot(state); validateLibertalia(state);
}

test('Calm hook does not prevent Cook taking the second loot token', () => {
  const state = checkpoint([26, 5]);
  moveLoot(state, 'hook', state.lootDays[0]!);
  assert(selectLibertaliaCrew(state, 'a', 26, state.revision).ok);
  assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  choose(state, state.pendingChoice!.options.find(o => o.label === 'HOOK')!.id);
  assert.equal(state.pendingChoice?.playerId, 'a');
  assert.match(state.pendingChoice!.prompt, /second loot/);
  choose(state, state.pendingChoice!.options[0]!.id);
  assert.equal(state.players.get('a')!.loot.length, 2);
});

test('Stowaway randomly samples the entire current bag, including after known returns', () => {
  const state = checkpoint([9, 5]);
  const first = state.lootBag[0]!;
  const returned = state.lootDays[1]!.pop()!; state.lootBag.push(returned);
  state.rng = () => 0;
  assert(selectLibertaliaCrew(state, 'a', 9, state.revision).ok);
  assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  assert(state.players.get('a')!.loot.some(t => t.id === first.id));
  assert(state.lootBag.some(t => t.id === returned.id));
});

for (const count of [3, 4, 5, 6]) test(`${count} seats: selection retirement preserves surviving commitments and frozen loot`, () => {
  const state = initLibertaliaGame('RETIRE', Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` })), () => 0.42);
  const leaving = `p${count - 1}`;
  const prepared = state.lootDays.slice(1).map(row => row.map(t => ({ ...t })));
  const selected = state.players.get('p0')!.hand[0]!;
  for (const id of state.turnOrder.filter(id => id !== leaving)) assert(selectLibertaliaCrew(state, id, selected, state.revision).ok);
  assert(forfeitLibertaliaPlayers(state, [leaving], state.revision).ok);
  assert.equal(state.voyagePlayerCount, count); assert.equal(state.turnOrder.length, count - 1);
  assert.equal(state.phase, 'effect_choice');
  assert.deepEqual(state.lootDays.slice(1), prepared);
  assert.equal(toLibertaliaPublicState(state).players.length, count);
  assert.equal(toLibertaliaPrivateState(state, leaving).canSelect, false);
  const archived = JSON.stringify(state.players.get(leaving), (_key, value) => value instanceof Set ? [...value] : value);
  for (let guard = 0; state.status === 'playing'; guard += 1) { assert(guard < 1500); step(state); }
  assert.equal(state.endReason, 'score'); assert(!state.winnerPlayerIds.includes(leaving));
  assert.equal(JSON.stringify(state.players.get(leaving), (_key, value) => value instanceof Set ? [...value] : value), archived);
});

test('Batch all-forfeit has no phantom survivor and terminal history stays immutable', () => {
  const state = checkpoint([6]);
  assert(forfeitLibertaliaPlayers(state, ['a', 'b'], state.revision).ok);
  assert.equal(state.endReason, 'forfeit'); assert.deepEqual(state.winnerPlayerIds, []);
  const snapshot = JSON.stringify(toLibertaliaPublicState(state));
  assert(forfeitLibertaliaPlayers(state, ['a'], state.revision).ok);
  assert.equal(JSON.stringify(toLibertaliaPublicState(state)), snapshot);
});

test('Private graveyards remain private and public prepared loot is deeply detached', () => {
  const state = checkpoint([6]);
  const pub = toLibertaliaPublicState(state);
  pub.lootDays[0]![0]!.kind = 'relic'; pub.turnOrder.length = 0;
  assert.equal(state.turnOrder.length, 2); validateLibertalia(state);
  assert.equal(Object.hasOwn(pub.players[0]!, 'graveyard'), false);
  assert.throws(() => { state.lootBag[0]!.kind = state.lootBag[0]!.kind === 'map' ? 'hook' : 'map'; validateLibertalia(state); }, /Canonical loot/);
});

test('Topman night loss floors at zero without charging later Barkeep gains', () => {
  const state = checkpoint([24, 8, 7, 11, 15, 10, 5], 2);
  const owner = state.players.get('a')!;
  owner.ship = [24, 8, 7, 11, 15]; owner.hand = owner.hand.filter((rank) => !owner.ship.includes(rank)); owner.doubloons = 0;
  assert(selectLibertaliaCrew(state, 'a', 10, state.revision).ok);
  assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  for (let steps = 0; !state.pendingChoice?.options.some((option) => option.id === 'night:24'); steps += 1) {
    assert(steps < 10); const option = state.pendingChoice!.options.find((entry) => entry.label !== 'SABER')!; choose(state, option.id);
  }
  owner.doubloons = 0;
  choose(state, 'night:24');
  assert.equal(owner.doubloons, 0);
  choose(state, 'night:8');
  assert.equal(owner.doubloons, 1, 'Night penalties do not create future debt');
});

test('Bandit reputation changes do not reorder already placed tied island cards', () => {
  const state = checkpoint([6]);
  assert(selectLibertaliaCrew(state, 'a', 6, state.revision).ok);
  assert(selectLibertaliaCrew(state, 'b', 6, state.revision).ok);
  assert.match(state.pendingChoice!.prompt, /Midshipman/);
  choose(state, state.pendingChoice!.options[0]!.id);
  assert.equal(state.pendingChoice?.playerId, 'b', 'Original rightmost Bandit chooses loot first');
});

test('Copied Scout inserts the replacement without reordering existing tied characters', () => {
  const state=checkpoint([2,39,1,5,6,7]);
  const a=state.players.get('a')!,b=state.players.get('b')!;
  a.ship=[39];a.hand=a.hand.filter(r=>r!==39);b.ship=[1];b.hand=b.hand.filter(r=>r!==1);
  assert(selectLibertaliaCrew(state,'a',2,state.revision).ok);assert(selectLibertaliaCrew(state,'b',2,state.revision).ok);
  choose(state,'ship:a:39');choose(state,'ship:b:1');choose(state,'hand:b:7');
  assert.deepEqual(state.island.filter(c=>c.rank===2).map(c=>c.playerId),['a','b']);
});

test('Both projections carry room identity and preserve hidden selection', () => {
  const state = checkpoint([6]);
  assert(selectLibertaliaCrew(state, 'a', 6, state.revision).ok);
  const pub = toLibertaliaPublicState(state);
  assert.equal(pub.roomCode, 'ASTRA');
  assert.equal(toLibertaliaPrivateState(state, 'a').roomCode, 'ASTRA');
  assert.equal(toLibertaliaPrivateState(state, 'b').selectedRank, null);
  assert.deepEqual(pub.island, []);
});

for (const [rank, reward] of [[33, 6], [36, -6]] as const) test(`Printed rank ${rank} anchor changes wealth by ${reward}`, () => {
  const state = checkpoint([rank, 5]); state.day = 4;
  state.lootBag.push(...state.lootDays.slice(0, 3).flat()); state.lootDays = [[], [], [], state.lootDays[3]!];
  const owner = state.players.get('a')!; owner.hand = owner.hand.filter(r => r !== rank); owner.ship = [rank]; owner.doubloons = 20;
  assert(selectLibertaliaCrew(state, 'a', 5, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  for (let guard = 0; state.voyage === 1; guard += 1) { assert(guard < 50); step(state); }
  assert.equal(owner.score, 23 + reward);
});

test('Printed Witch checks other night abilities, not other anchor abilities', () => {
  const state = checkpoint([15, 7, 5]); state.day = 4;
  state.lootBag.push(...state.lootDays.slice(0, 3).flat()); state.lootDays = [[], [], [], state.lootDays[3]!];
  const owner = state.players.get('a')!; owner.ship = [15, 7]; owner.hand = owner.hand.filter(r => !owner.ship.includes(r));
  assert(selectLibertaliaCrew(state, 'a', 5, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  for (let guard = 0; state.voyage === 1; guard += 1) { assert(guard < 50); step(state); }
  assert(owner.hand.includes(15)); assert(!owner.graveyard.includes(15));
});

test('Preacher keeps exactly one chosen loot and gains reputation for the discarded remainder', () => {
  const state = checkpoint([7, 5]); const p = state.players.get('a')!;
  moveLoot(state, 'relic', p.loot); moveLoot(state, 'map', p.loot); moveLoot(state, 'barrel', p.loot);
  const keep = p.loot.find(t => t.kind === 'map')!; const before = state.reputationTrack.indexOf('a');
  assert(selectLibertaliaCrew(state, 'a', 7, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  assert.match(state.pendingChoice!.prompt, /Preacher/);
  choose(state, state.pendingChoice!.options.find(o => o.lootId === keep.id)!.id);
  assert.deepEqual(p.loot, [keep]); assert.equal(state.reputationTrack.indexOf('a'), before + 2);
});

test('Gunner pays its own reputation when discarding a rival ship character', () => {
  const state = checkpoint([18, 7, 5]); const q = state.players.get('b')!;
  q.hand = q.hand.filter(r => r !== 7); q.ship = [7]; const before = state.reputationTrack.indexOf('a');
  assert(selectLibertaliaCrew(state, 'a', 18, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  choose(state, 'ship:b:7'); assert(q.graveyard.includes(7));
  assert.equal(state.reputationTrack.indexOf('a'), before - 1);
});

test('Necromancer spends only a relic and resurrects directly into ship', () => {
  const state = checkpoint([19, 7, 5]); const p = state.players.get('a')!;
  p.hand = p.hand.filter(r => r !== 7); p.graveyard = [7]; moveLoot(state, 'map', p.loot); moveLoot(state, 'relic', p.loot);
  assert(selectLibertaliaCrew(state, 'a', 19, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  assert(state.pendingChoice!.options.every(o => o.label === 'RELIC'));
  choose(state, state.pendingChoice!.options[0]!.id); choose(state, 'grave:a:7');
  assert(p.ship.includes(7)); assert(!p.hand.includes(7)); assert(p.loot.some(t => t.kind === 'map'));
});

test('Recruiter adds a character during daytime before any dusk loot', () => {
  const state = checkpoint([25, 18, 7]);
  assert(selectLibertaliaCrew(state, 'a', 25, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 18, state.revision).ok);
  assert.equal(state.pendingChoice?.kind, 'hand_character');
  assert.match(state.pendingChoice!.prompt, /Recruiter/);
  assert.deepEqual(state.players.get('a')!.loot, [], 'Recruiter resolves before any dusk loot');
});

test('Collector awards ten for five different loot types', () => {
  const state = checkpoint([35, 5]); state.day = 4;
  state.lootBag.push(...state.lootDays.slice(0, 3).flat()); state.lootDays = [[], [], [], state.lootDays[3]!];
  const p = state.players.get('a')!; p.ship = [35]; p.hand = p.hand.filter(r => r !== 35); p.doubloons = 0;
  for(const kind of ['map','barrel','amulet','chest','saber'])moveLoot(state,kind,p.loot);
  assert(selectLibertaliaCrew(state, 'a', 5, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  for(let guard=0;!state.pendingChoice?.options.some(o=>o.id==='anchor:crew:35');guard++){assert(guard<10);step(state);}
  const before=p.doubloons;choose(state,'anchor:crew:35');assert.equal(p.doubloons,before+10);
});

test('Canonical Scout and copied Recruiter can exhaust a hand before the final day', () => {
  const state = checkpoint([1, 2, 19, 25, 5, 6]);
  assert(selectLibertaliaCrew(state, 'a', 1, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 5, state.revision).ok);
  choose(state, 'hand:a:25'); choose(state, 'hand:a:5');
  while(state.day===1)choose(state,state.pendingChoice!.options.find(o=>o.label!=='SABER')?.id??state.pendingChoice!.options[0]!.id);
  assert(selectLibertaliaCrew(state, 'a', 2, state.revision).ok); assert(selectLibertaliaCrew(state, 'b', 6, state.revision).ok);
  choose(state,'ship:a:25');choose(state,'hand:a:19');
  while(state.day===2)choose(state,state.pendingChoice!.options.find(o=>o.label!=='SABER')?.id??state.pendingChoice!.options[0]!.id);
  assert.deepEqual(state.players.get('a')!.hand,[6]);
  assert(selectLibertaliaCrew(state,'a',6,state.revision).ok);assert(selectLibertaliaCrew(state,'b',19,state.revision).ok);
  while(state.day===3)choose(state,state.pendingChoice!.options.find(o=>o.label!=='SABER')?.id??state.pendingChoice!.options[0]!.id);
  assert.deepEqual(state.players.get('a')!.hand,[]);
  assert.equal(state.day,4);
  assert.equal(toLibertaliaPrivateState(state,'a').canSelect,false);
  assert(selectLibertaliaCrew(state,'b',state.players.get('b')!.hand[0]!,state.revision).ok);
  for(let guard=0;state.voyage===1;guard++){assert(guard<50);step(state);}
  assert.equal(state.players.get('a')!.hand.length,6);
  assert.equal(state.players.get('a')!.forfeited,false);
});

test('All empty hands skip impossible selections without skipping night or inventing crew', () => {
  const state=checkpoint([25,8,5,6,7,9]);
  for(const p of state.players.values()) {p.graveyard=p.hand.filter(r=>r!==25&&r!==8);p.hand=[25,8];}
  assert(selectLibertaliaCrew(state,'a',25,state.revision).ok);assert(selectLibertaliaCrew(state,'b',25,state.revision).ok);
  choose(state,'hand:a:8');choose(state,'hand:b:8');
  for(let guard=0;state.voyage===1;guard++){assert(guard<100);assert.notEqual(state.phase,'selection');step(state);}
  for(const p of state.players.values()){assert.equal(p.hand.length,6);assert.equal(p.forfeited,false);assert(p.score>=4);}
  validateLibertalia(state);
});

for(const nested of [false,true])test(`Forfeit cancels ${nested?'nested hook':'anchor ordering'} without stalling or scoring departed seat`,()=>{
  const state=checkpoint([7,5],1,3);state.day=4;
  state.lootBag.push(...state.lootDays.slice(0,3).flat());state.lootDays=[[],[],[],state.lootDays[3]!];
  const p=state.players.get('a')!;p.ship=[7];p.hand=p.hand.filter(r=>r!==7);const hook=moveLoot(state,'hook',p.loot);
  for(const id of state.turnOrder)assert(selectLibertaliaCrew(state,id,5,state.revision).ok);
  assert.equal(state.settlementPhase,'anchor');assert.equal(state.pendingChoice?.playerId,'a');
  if(nested){choose(state,`anchor:hook:${hook.id}`);choose(state,'keep');assert.match(state.pendingChoice!.prompt,/character to keep/);}
  const coins=p.doubloons;
  assert(forfeitLibertaliaPlayers(state,['a'],state.revision).ok);
  assert.equal(p.score,0);assert.equal(p.doubloons,coins);assert.notEqual(state.pendingChoice?.playerId,'a');
  for(let guard=0;state.voyage===1;guard++){assert(guard<50);step(state);}
  assert(!state.turnOrder.includes('a'));assert.equal(p.score,0);assert.equal(p.doubloons,coins);
  assert.equal(state.voyagePlayerCount,2);validateLibertalia(state);
});

test('Printed unique Wind Nymph gains two doubloons each night',()=>{
  const state=checkpoint([37,5]);const p=state.players.get('a')!;p.ship=[37];p.hand=p.hand.filter(r=>r!==37);p.doubloons=0;
  assert(selectLibertaliaCrew(state,'a',5,state.revision).ok);assert(selectLibertaliaCrew(state,'b',5,state.revision).ok);
  while(state.day===1)choose(state,state.pendingChoice!.options[0]!.id);
  assert.equal(p.doubloons,5);
});

for(const order of [['a','b','c'],['b','a','c']])test(`Wind Nymph local collision preserves own order with table ${order.join('')}`,()=>{
  const state=checkpoint([37,24,5],1,3);state.turnOrder=[...order];
  for(const id of ['a','b']){const p=state.players.get(id)!;p.ship=[37,24];p.hand=p.hand.filter(r=>!p.ship.includes(r));p.doubloons=10;}
  for(const id of state.turnOrder)assert(selectLibertaliaCrew(state,id,5,state.revision).ok);
  while(state.day===1){const c=state.pendingChoice!;choose(state,c.options.find(o=>o.id==='night:24')?.id??c.options[0]!.id);}
  assert.equal(state.players.get('a')!.doubloons,14);
  assert.equal(state.players.get('b')!.doubloons,11);
  assert(!state.players.get('a')!.ship.includes(37));assert(!state.players.get('b')!.ship.includes(37));
});

for(const [count,reward] of [[1,1],[2,4],[3,9]])test(`Printed Merchant trades ${count} identical loot for ${reward}`,()=>{
  const state=checkpoint([30,5]);const p=state.players.get('a')!;
  for(let i=0;i<count!;i++)moveLoot(state,'map',p.loot);
  assert(selectLibertaliaCrew(state,'a',30,state.revision).ok);assert(selectLibertaliaCrew(state,'b',5,state.revision).ok);
  const before=p.doubloons,option=state.pendingChoice!.options.find(o=>o.id===`merchant:map:${count}`)!;
  assert.match(option.label,new RegExp(`for ${reward} doubloons`));choose(state,option.id);
  assert.equal(p.doubloons,before+reward!);assert.equal(p.loot.length,0);validateLibertalia(state);
});

function reachNight(state:ReturnType<typeof checkpoint>){
  for(const id of state.turnOrder)assert(selectLibertaliaCrew(state,id,5,state.revision).ok);
  for(let guard=0;!state.pendingChoice?.prompt.includes('night ability');guard++){
    assert(guard<30);choose(state,state.pendingChoice!.options.find(o=>o.label!=='SABER')?.id??state.pendingChoice!.options[0]!.id);
  }
}
for(const first of ['native','copy'])test(`Freed Prisoner end-of-night ${first} first preserves committed copy and skips removed native`,()=>{
  const state=checkpoint([15,20,24,28,38,5],1,3),p=state.players.get('a')!;
  p.ship=[15,20,24,28,38];p.hand=p.hand.filter(r=>!p.ship.includes(r));
  reachNight(state);
  assert(!state.pendingChoice!.options.some(o=>o.id==='night:20'),'End-of-night power is not an ordinary night option');
  choose(state,'night:15');choose(state,'ship:a:20');
  while(!state.pendingChoice?.prompt.includes('end-of-night'))choose(state,state.pendingChoice!.options[0]!.id);
  const before=p.doubloons;
  assert(state.pendingChoice!.options.every(o=>o.rank===20));
  choose(state,first==='native'?'end:20':'end:copy:20');
  assert.equal(p.doubloons,before+(first==='native'?6:3));
  assert(p.graveyard.includes(20));assert.equal(state.day,2);validateLibertalia(state);
});

test('Freed Prisoner counts after ordinary Nymph removal, including its committed Witch copy',()=>{
  const state=checkpoint([15,20,24,28,37,5],1,3),p=state.players.get('a')!,q=state.players.get('b')!;
  p.ship=[15,20,24,28,37];p.hand=p.hand.filter(r=>!p.ship.includes(r));q.ship=[37];q.hand=q.hand.filter(r=>r!==37);
  reachNight(state);choose(state,'night:15');choose(state,'ship:a:20');
  while(!state.pendingChoice?.prompt.includes('end-of-night'))choose(state,state.pendingChoice!.options[0]!.id);
  assert(!p.ship.includes(37));assert(!q.ship.includes(37));const before=p.doubloons;
  choose(state,'end:20');assert.equal(p.doubloons,before+4);assert(p.ship.includes(20));validateLibertalia(state);
});

test('Witch cannot copy a Freed Prisoner discarded by a daytime Gunner',()=>{
  const state=checkpoint([15,20,8,18,5],1,3),p=state.players.get('a')!;
  p.ship=[15,20,8];p.hand=p.hand.filter(r=>!p.ship.includes(r));
  assert(selectLibertaliaCrew(state,'a',5,state.revision).ok);assert(selectLibertaliaCrew(state,'b',18,state.revision).ok);assert(selectLibertaliaCrew(state,'c',5,state.revision).ok);
  choose(state,'ship:a:20');
  while(!state.pendingChoice?.options.some(o=>o.id==='night:15'))choose(state,state.pendingChoice!.options.find(o=>o.label!=='SABER')?.id??state.pendingChoice!.options[0]!.id);
  choose(state,'night:15');assert.deepEqual(state.pendingChoice!.options.map(o=>o.rank),[8]);
  const revision=state.revision;assert(!resolveLibertaliaChoice(state,'a',state.pendingChoice!.id,['ship:a:20'],revision).ok);assert.equal(state.revision,revision);
  choose(state,'ship:a:8');validateLibertalia(state);
});

for(const copyFirst of [false,true])test(`Colliding Wind Nymph ${copyFirst?'copied before native':'native before Witch'} keeps the night-start census`,()=>{
  const state=checkpoint([15,37,8,5],1,3),p=state.players.get('a')!,q=state.players.get('b')!;
  p.ship=[15,37,8];p.hand=p.hand.filter(r=>!p.ship.includes(r));q.ship=[37];q.hand=q.hand.filter(r=>r!==37);
  reachNight(state);const before=p.doubloons;
  choose(state,copyFirst?'night:15':'night:37');
  if(copyFirst){choose(state,'ship:a:37');assert(!state.pendingChoice?.options.some(o=>o.id==='night:37'));}
  else {choose(state,'night:15');assert(!state.pendingChoice!.options.some(o=>o.rank===37));choose(state,'ship:a:8');}
  while(state.day===1)choose(state,state.pendingChoice!.options[0]!.id);
  assert.equal(p.doubloons,before+(copyFirst?1:2));assert(!p.ship.includes(37));assert(!q.ship.includes(37));validateLibertalia(state);
});

test('Forfeiting a current-day Wind Nymph owner does not grant the remaining owner a uniqueness reward',()=>{
  const state=checkpoint([37,8,5],1,3),p=state.players.get('a')!,q=state.players.get('b')!;
  for(const owner of [p,q]){owner.ship=[37,8];owner.hand=owner.hand.filter(r=>!owner.ship.includes(r));}
  reachNight(state);const before=q.doubloons;assert.deepEqual(state.nightNymphOwners,['a','b']);
  assert(forfeitLibertaliaPlayers(state,['a'],state.revision).ok);assert.deepEqual(state.nightNymphOwners,['a','b']);
  while(state.day===1)choose(state,state.pendingChoice!.options[0]!.id);
  assert.equal(q.doubloons,before+1);assert(!q.ship.includes(37));assert(!state.turnOrder.includes('a'));validateLibertalia(state);
});

test('Unique Wind Nymph can be copied before or after its native reward',()=>{
  for(const copyFirst of [false,true]){
    const state=checkpoint([15,37,8,5],1,3),p=state.players.get('a')!;
    p.ship=[15,37,8];p.hand=p.hand.filter(r=>!p.ship.includes(r));reachNight(state);const before=p.doubloons;
    choose(state,copyFirst?'night:15':'night:37');
    if(!copyFirst)choose(state,'night:15');choose(state,'ship:a:37');
    while(state.day===1)choose(state,state.pendingChoice!.options[0]!.id);
    assert.equal(p.doubloons,before+5);assert(p.ship.includes(37));validateLibertalia(state);
  }
});

for(const shared of [false,true])for(const first of [false,true])test(`Printed Aristocrat ${shared?'shared loses three':'unique gains five'}, ${first?'first':'after Barkeep'}`,()=>{
  const state=checkpoint([34,8,32,5],1,3),p=state.players.get('a')!,q=state.players.get('b')!;
  state.day=4;state.lootBag.push(...state.lootDays.slice(0,3).flat());state.lootDays=[[],[],[],state.lootDays[3]!];
  p.ship=[34,8,32];q.ship=shared?[34,8]:[8,32];
  for(const owner of [p,q])owner.hand=owner.hand.filter(r=>!owner.ship.includes(r));
  moveLoot(state,'map',p.loot);p.doubloons=20;
  for(const id of state.turnOrder)assert(selectLibertaliaCrew(state,id,5,state.revision).ok);
  assert.equal(state.settlementPhase,'anchor');assert.equal(state.pendingChoice?.playerId,'a');
  if(!first)choose(state,'anchor:crew:8');
  const before=p.doubloons;choose(state,'anchor:crew:34');
  assert.equal(p.doubloons,before+(shared?-3:5));validateLibertalia(state);
});
