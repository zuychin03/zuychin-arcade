const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}, globals = {}) {
  const filename = path.join(__dirname, '../components/kraken', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: name => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}
function hooks() {
  const cells = [], effects = []; let cursor = 0, dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!cells[i]) cells[i] = { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { const next = typeof value === 'function' ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; cells[i] ??= { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) cells[i] = { value: fn, deps }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn) { let output; for (let i = 0; i < 30; i++) { cursor = 0; dirty = false; output = fn(); while (effects.length) effects.shift()(); if (!dirty) return output; } assert.fail('Hook did not settle'); }, cleanup() { cells.forEach(c => c.cleanup?.()); } };
}

function harness() {
 const h = hooks(), calls = [], listeners = new Map(), timers = new Map(); let result, timerId = 0;
 const state = { token:'fixture', playerId:'p1', roomCode:'ROOM', krakenPublic:null, krakenPrivate:null, krakenSyncing:true };
 const socket = { connected:true, on(e,f){ if(!listeners.has(e)) listeners.set(e,new Set()); listeners.get(e).add(f); }, off(e,f){listeners.get(e)?.delete(f);}, emit(...a){calls.push(a);},connect(){} };
 const useGameStore = f => f(state); useGameStore.getState = () => ({...state,setKrakenSyncing:v=>{state.krakenSyncing=v;}});
 const {useKrakenActions} = load('useKrakenActions.ts',{react:h.react,'../../hooks/useSocket':{getSocket:()=>socket},'../../store/useGameStore':{useGameStore}}, {setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
 const render=()=>{result=h.render(useKrakenActions);return result;};
 const pair=(revision=1,windowId=1,phase='priority')=>{state.krakenPublic={gameId:'feed_the_kraken',roomCode:'ROOM',revision,windowId,round:1,phase};state.krakenPrivate={gameId:'feed_the_kraken',roomCode:'ROOM',revision,playerId:'p1',viewerPlayerId:'p1'};state.krakenSyncing=false;render();};
 const event=(e,v)=>{for(const f of listeners.get(e)??[])f(v);render();};
 render(); return {state,socket,calls,pair,event,render,listeners,timers,cleanup:h.cleanup,get actions(){return result;}};
}
test('owned pair and synchronous duplicate fence',()=>{const h=harness();assert.equal(h.actions.send({type:'pass'}),false);h.pair();assert.equal(h.actions.send({type:'pass'}),true);assert.equal(h.actions.send({type:'pass'}),false);assert.equal(h.calls.at(-1)[1].windowId,1);assert.equal(h.calls.at(-1)[1].expectedRevision,1);h.cleanup();});
test('acknowledgement and paired state settle in either arrival order',()=>{for(const first of [true,false]){const h=harness();h.pair();h.actions.send({type:'pass'});h.render();const ack=()=>h.event('kraken:action_accepted',{action:'pass',revision:2});if(first)ack();else h.pair(2);assert.equal(h.actions.pending,true);if(first)h.pair(2);else ack();assert.equal(h.actions.pending,false);h.cleanup();}});
test('captured controls reject new window, phase, revision and session',()=>{const h=harness();h.pair();const send=h.actions.send;h.pair(2);assert.equal(send({type:'pass'}),false);h.pair(2,2);assert.equal(send({type:'bid',guns:0}),false);h.state.token='replacement';assert.equal(h.actions.send({type:'pass'}),false);h.cleanup();});
test('simultaneous bids tolerate revision advance only within same window',()=>{const h=harness();h.pair(1,1,'mutiny');const send=h.actions.send;h.pair(2,1,'mutiny');assert.equal(send({type:'bid',guns:0}),true);assert.equal(h.calls.at(-1)[1].expectedRevision,2);h.cleanup();});

test('private ritual replies tolerate other acknowledgements but not a new window',()=>{
 const h=harness();h.pair(1,4,'ritual');const send=h.actions.send;h.pair(3,4,'ritual');
 assert.equal(send({type:'ritual'}),true);assert.equal(h.calls.at(-1)[1].expectedRevision,3);h.cleanup();
 const next=harness();next.pair(1,4,'ritual');const stale=next.actions.send;next.pair(4,5,'ritual');
 assert.equal(stale({type:'ritual'}),false);next.cleanup();
});
test('private ownership mismatch blocks command',()=>{const h=harness();h.pair();h.state.krakenPrivate.playerId='other';assert.equal(h.actions.send({type:'pass'}),false);h.state.krakenPrivate.playerId='p1';h.state.krakenPrivate.roomCode='OTHER';assert.equal(h.actions.send({type:'pass'}),false);h.cleanup();});
test('timeouts refresh without replay; malformed and unrelated acknowledgements do not release',()=>{const h=harness();h.pair();h.actions.send({type:'pass'});h.render();for(const ack of [null,{}, {action:'bid',revision:2},{action:'pass',revision:1}]){h.event('kraken:action_accepted',ack);assert.equal(h.actions.pending,true);}for(const {f,ms}of h.timers.values())if(ms===12000)f();h.render();assert.equal(h.state.krakenSyncing,true);assert.equal(h.calls.filter(c=>c[0]==='kraken:action').length,1);h.cleanup();assert.equal([...h.listeners.values()].every(v=>v.size===0),true);});
const model=load('decisions.ts');
function leaveHarness(overrides = {}) {
  const h = hooks(), calls = []; let dialog = null, result, back;
  const state = { token: 'leave-fixture', roomCode: '7KPM-R4TX', krakenPublic: { status: 'playing' }, clearAll() { calls.push(['clear']); state.token = null; state.roomCode = null; } };
  const store = selector => selector(state); store.getState = () => state;
  const { useKrakenLeave } = load('useKrakenLeave.ts', {
    react: h.react, 'react-native': { Platform: { OS: 'android' }, BackHandler: { addEventListener(name, fn) { back = fn; return { remove() { back = null; } }; } } },
    'expo-router': { router: { replace(path) { calls.push(['route', path]); } } }, '../../store/useGameStore': { useGameStore: store },
    '../../hooks/useNativeLeaveGuard': { useNativeLeaveGuard: () => (fn, allowed) => { if (allowed()) fn(); } },
    '../../hooks/useWebBackGuard': { useWebBackGuard() {} }, '../../hooks/useSocket': { getSocket: () => ({ disconnect() { calls.push(['disconnect']); } }) },
    '../../lib/api': { leaveRoom: async (...args) => { calls.push(['leave', ...args]); return overrides.leave?.(...args); } },
    '../../lib/storage': { clearAuthIfMatches: async (...args) => { calls.push(['storage', ...args]); return overrides.storage?.(...args); } },
    '../../lib/dialog': { showDialog(title, message, buttons) { dialog = { title, message, buttons }; }, useDialogStore: { getState: () => ({ dialog, hide() { dialog = null; } }) } },
  });
  const render = () => { result = h.render(() => useKrakenLeave(() => overrides.dismiss?.() ?? false)); return result; }; render();
  return { state, calls, render, cleanup: h.cleanup, get actions() { return result; }, get dialog() { return dialog; }, back: () => back(), confirm() { dialog.buttons.find(b => b.text === 'LEAVE').onPress(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('leave is confirmation-only, names forfeiture policy and fences duplicates', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); const h = leaveHarness({ leave: () => wait });
  h.back(); assert.match(h.dialog.message, /not a feeding sacrifice/); assert.equal(h.calls.length, 0);
  const confirm = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress; confirm(); confirm();
  assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); release(); await tick(); h.render();
  assert(h.calls.some(c => c[0] === 'storage')); assert(h.calls.some(c => c[0] === 'route')); h.cleanup();
});
test('Back dismisses the current confirmation before requesting a leave', () => {
  const h = leaveHarness(); h.back(); assert(h.dialog); h.back(); assert.equal(h.dialog, null); assert.equal(h.calls.length, 0); h.cleanup();
});
test('failed storage retries cleanup without forfeiting twice', async () => {
  let attempts = 0; const h = leaveHarness({ storage: () => { if (attempts++ === 0) throw new Error('fixture storage failure'); } });
  h.actions.requestLeave(); h.confirm(); await tick(); h.render(); assert.match(h.actions.error, /saved details/);
  h.actions.requestLeave(); await tick(); h.render(); assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); assert.equal(h.calls.filter(c => c[0] === 'storage').length, 2); h.cleanup();
});
test('old leave confirmation and pending storage cannot clear a replacement seat', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); const h = leaveHarness({ storage: () => wait });
  h.actions.requestLeave(); const oldConfirm = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress; oldConfirm(); await tick();
  h.state.token = 'replacement-fixture'; h.state.roomCode = 'NEXT-ROOM'; h.render(); oldConfirm(); release(); await tick();
  assert.equal(h.calls.filter(c => c[0] === 'clear').length, 0); assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); h.cleanup();
});
const jsx=(type,props)=>({type,props});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
function panel(phase, extra={}) {
 const h=hooks(), calls=[];
 const props={game:{phase,window:'before_appointment',captainId:'p1',lieutenantId:'p2',navigatorId:'p3',players:['p1','p2','p3'].map(playerId=>({playerId,displayName:playerId,aboard:true,forfeited:false,offDuty:false})),effects:{forcedLieutenantId:null},mutinyThreshold:3,supplyGuns:4},mine:{playerId:'p1',canAct:true,character:'gunslinger',canUseCharacter:true,minimumBid:0,maximumBid:3,ownGuns:3,ritualGunCount:3,legalTargetIds:['p2','p3'],navigationCards:[{id:'card',colour:'blue',effect:'drunk'}],...extra},busy:false,send:a=>{calls.push(a);return true;}};
 const panelJsx=(type,props)=>type==='Grid'?jsx('View',{children:props.items.map(props.renderItem)}):type==='NavigationCard'?jsx('Button',{label:`Select ${props.card.colour} / ${props.card.effect}`,disabled:props.disabled,onPress:props.onSelect}):jsx(type,props);
 const {DecisionPanel}=load('DecisionPanel.tsx',{react:h.react,'react/jsx-runtime':{jsx:panelJsx,jsxs:panelJsx},'react-native':{Text:'Text',View:'View',useWindowDimensions:()=>({fontScale:1})},'@zuychin-arcade/types':{FEED_THE_KRAKEN_CHARACTER_NAMES:{gunslinger:'Gunslinger'},FEED_THE_KRAKEN_CHARACTER_SUMMARIES:{gunslinger:'Take guns'}},'./Controls':{HelmButton:'Button',typography:{}},'./decisions':model,'../ui/CardGrid':{CardGrid:'Grid'},'./NavigationCard':{NavigationCard:'NavigationCard'}});
 const render=()=>h.render(()=>DecisionPanel(props));
 const click=label=>{const button=nodes(render()).find(n=>n.type==='Button'&&n.props.label===label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);button.props.onPress();};
 return {props,calls,render,click};
}
test('every ordered decision emits its concrete command, with explicit destructive confirmation',()=>{
 let p=panel('priority');p.click('Pass this window');assert.equal(p.calls[0].type,'pass');p.click('Reveal and use character');assert.equal(p.calls[1].type,'character');
 p=panel('mutiny');p.click('More guns');p.click('Seal bid: 1 guns');assert.equal(p.calls[0].guns,1);
 p=panel('navigation');p.click('Select blue / drunk');p.click('Send this card');assert.equal(p.calls[0].type,'submit_navigation');
 p=panel('navigator');p.click('Refuse to navigate');assert.equal(p.calls.length,0);p.click('Confirm refusal and go overboard');assert.equal(p.calls[0].refuse,true);
 p=panel('telescope');p.click('Keep it on top');assert.equal(p.calls[0].discard,false);
 p=panel('instigator');p.click('Decline');assert.equal(p.calls[0].accept,false);
 for(const [phase,type]of [['tie_veto','veto'],['emergency','emergency'],['effect_target','target'],['ritual','ritual']]){p=panel(phase);p.click('p2');p.click('Confirm choice');assert.equal(p.calls[0].type,type);assert.equal(p.calls[0].playerId,'p2');}
 p=panel('map_action');p.props.game.mapAction='feeding';p.click('p2');p.click('Review feeding');assert.equal(p.calls.length,0);p.click('Confirm sacrifice');assert.equal(p.calls[0].type,'target');
});
test('appointment keeps forced lieutenant and distinct navigator; stash requires exact allocation',()=>{
 const p=panel('appointment');p.props.game.effects.forcedLieutenantId='p2';p.click('p3');p.click('Confirm navigation team');assert.equal(p.calls[0].lieutenantId,'p2');assert.equal(p.calls[0].navigatorId,'p3');
 const s=panel('ritual',{ritual:'stash'});assert.ok(nodes(s.render()).find(n=>n.type==='Button'&&n.props.label==='Confirm distribution').props.disabled);
 const three=nodes(s.render()).find(n=>n.type==='Button'&&n.props.label==='3');three.props.onPress();s.click('Confirm distribution');assert.equal(s.calls[0].allocations.p2,3);
});
test('non-actor and busy panels never expose enabled commands',()=>{
 const p=panel('ritual',{canAct:false});assert.equal(nodes(p.render()).filter(n=>n.type==='Button').length,0);
 const q=panel('priority');q.props.busy=true;assert.ok(nodes(q.render()).filter(n=>n.type==='Button').every(n=>n.props.disabled));
});
test('all character target arities and role-specific filters',()=>{
 const players=['a','b','c','d'].map(playerId=>({playerId,aboard:true,forfeited:false,offDuty:playerId==='b',characterRevealed:playerId==='c'}));
 const game={players,captainId:'a',lieutenantId:'b',navigatorId:'c'};
 assert.equal(model.targetSlots('spiritualist').length,3);assert.equal(model.targetSlots('herbalist').length,2);assert.equal(model.targetSlots('gunslinger').length,0);
 const ids=(character,slot=0,selected=[])=>Array.from(model.characterTargets(game,character,'a',slot,selected),p=>p.playerId);
 assert.deepEqual(ids('mentor'),['c']);assert.deepEqual(ids('herbalist'),['b']);assert.deepEqual(ids('smuggler'),['a','b']);assert.deepEqual(ids('instigator'),['b','c','d']);assert.deepEqual(ids('adviser'),['c','d']);assert.deepEqual(ids('spiritualist',1,['b']),['a','c','d']);assert.ok(ids('spiritualist',2,['b','c']).includes('b'));
});

test('stale rematch controls cannot start a later match', () => {
 const h=harness();h.pair(10,8,'game_over');const stale=h.actions.send;
 h.pair(40,20,'game_over');assert.equal(stale('start'),false);
 assert.equal(h.actions.send('start'),true);h.cleanup();
});
test('navigation requires a fresh paired frame after the other officer submits', () => {
 const h=harness();h.pair(10,8,'navigation');const stale=h.actions.send;
 h.pair(11,8,'navigation');assert.equal(stale({type:'submit_navigation',cardId:'card'}),false);
 assert.equal(h.actions.send({type:'submit_navigation',cardId:'card'}),true);
 assert.equal(h.calls.at(-1)[1].expectedRevision,11);h.cleanup();
});
test('disconnect and rejection pause commands until private state is restored', () => {
 const h=harness();h.pair();h.actions.send({type:'pass'});h.event('disconnect');
 assert.equal(h.actions.busy,true);h.event('connect');assert.equal(h.state.krakenSyncing,true);
 assert.equal(h.actions.send({type:'pass'}),false);h.pair(2);assert.equal(h.actions.send({type:'pass'}),true);
 h.event('action_rejected',{reason:'Stale revision'});assert.equal(h.actions.message,'Stale revision');
 assert.equal(h.state.krakenSyncing,true);assert.equal(h.actions.pending,false);h.cleanup();
});
test('stash emits legal zero allocation when supply is empty and drops departed targets', () => {
 const empty=panel('ritual',{ritual:'stash',ritualGunCount:0});empty.props.game.supplyGuns=0;empty.click('Confirm distribution');
 assert.deepEqual(JSON.parse(JSON.stringify(empty.calls[0])),{type:'ritual',allocations:{p2:0,p3:0}});
 const p=panel('ritual',{ritual:'stash'});
 nodes(p.render()).find(n=>n.type==='Button'&&n.props.label==='3').props.onPress();
 p.props.mine.legalTargetIds=['p3'];
 assert.equal(nodes(p.render()).find(n=>n.props?.label==='Confirm distribution').props.disabled,true);
 nodes(p.render()).find(n=>n.type==='Button'&&n.props.label==='3').props.onPress();p.click('Confirm distribution');
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].allocations)),{p3:3});
});

test('ordinary crew complete the same private ritual phase without a target or allocation', () => {
 const p=panel('ritual',{ritual:null});p.click('Complete private ritual');
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls)),[{type:'ritual'}]);
 const waiting=panel('ritual',{ritual:null,canAct:false});
 assert.equal(nodes(waiting.render()).filter(n=>n.type==='Button').length,0);
});

test('stash honours the private opening supply even if a forfeited crew member returns guns', () => {
 const p=panel('ritual',{ritual:'stash',ritualGunCount:0});p.props.game.supplyGuns=4;
 p.click('Confirm distribution');
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].allocations)),{p2:0,p3:0});
});
test('appointment cannot submit a selected officer who forfeited', () => {
 const p=panel('appointment');p.click('p2');
 nodes(p.render()).filter(n=>n.type==='Button'&&n.props.label==='p3').at(-1).props.onPress();
 assert.equal(nodes(p.render()).find(n=>n.props?.label==='Confirm navigation team').props.disabled,false);
 p.props.mine.legalTargetIds=['p3'];
 assert.equal(nodes(p.render()).find(n=>n.props?.label==='Confirm navigation team').props.disabled,true);
});

const constants=load('../../../../packages/types/src/feed-the-kraken-constants.ts');
const engine=load('../../../../apps/server/src/game/feed-the-kraken/engine.ts',{
 '../../../../../packages/types/src/feed-the-kraken-constants.js':constants,
},{structuredClone});
const projection=load('../../../../apps/server/src/game/feed-the-kraken/publicState.ts',{'./engine.js':engine},{structuredClone});
test('all 21 character panels emit target commands accepted by the authoritative engine', () => {
 const windows={troublemaker:'after_bids',peacemaker:'after_bids',minstrel:'after_appointment',boatswain:'before_draw',herbalist:'before_appointment',master_strategist:'after_bids',smuggler:'before_draw',agitator:'after_appointment',adviser:'before_appointment',chief_cook:'before_appointment',rabble_rouser:'after_bids',archivist:'before_draw',spiritualist:'yellow',debt_collector:'after_appointment',negotiator:'after_appointment',instigator:'after_bids'};
 assert.equal(constants.FEED_THE_KRAKEN_CHARACTERS.length,21);
 for(const character of constants.FEED_THE_KRAKEN_CHARACTERS){
  const s=engine.initFeedTheKrakenGame(Array.from({length:7},(_,i)=>({playerId:`p${i}`,displayName:`Crew ${i}`})),'ROOM','long');
  const actor=s.captainId, others=s.order.filter(id=>id!==actor);
  s.players[actor].character=character;s.phase='priority';s.window=windows[character]??'before_appointment';s.pendingPlayerId=actor;
  s.priorityOrder=[actor,...others];s.priorityIndex=0;s.lieutenantId=others[0];s.navigatorId=others[1];
  s.bids=Object.fromEntries(others.map(id=>[id,1]));s.bidsRevealed=true;
  if(character==='herbalist')s.offDuty=[others[0]];
  if(character==='mentor')s.players[others[0]].characterRevealed=true;
  const p=panel('priority');p.props.game=projection.toFeedTheKrakenPublicState(s);p.props.mine=projection.toFeedTheKrakenPrivateState(s,actor);
  assert.equal(p.props.mine.canUseCharacter,true,character);
  const chosen=[];
  for(const [slot,label] of model.targetSlots(character).entries()){
   const target=model.characterTargets(p.props.game,character,actor,slot,chosen)[0];assert.ok(target,character);
   const group=nodes(p.render()).find(n=>n.type==='View'&&nodes(n).some(t=>t.type==='Text'&&t.props.children===label)&&n.props.children?.[0]?.props?.children===label);
   const button=nodes(group).find(n=>n.type==='Button'&&n.props.label===target.displayName);assert.ok(button,`${character}/${label}`);
   button.props.onPress();chosen[slot]=target.playerId;
  }
  p.click('Reveal and use character');const result=engine.submitFeedTheKrakenAction(s,actor,p.calls[0],s.revision,s.windowId);
  assert.equal(result.ok,true,`${character}: ${result.reason??''}`);
 }
});
