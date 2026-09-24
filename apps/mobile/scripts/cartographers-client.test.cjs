const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../components/cartographers', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: name => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}
function hooks() {
  const cells = [], effects = []; let cursor = 0, dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { const next = typeof value === 'function' ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; cells[i] ??= { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) cells[i] = { value: fn, deps }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn) { let result; for (let n = 0; n < 30; n++) { cursor = 0; dirty = false; result = fn(); while (effects.length) effects.shift()(); if (!dirty) return result; } assert.fail('Hook did not settle'); }, cleanup() { cells.forEach(cell => cell.cleanup?.()); } };
}
function harness() {
  const h = hooks(), calls = [], listeners = new Map(), timers = new Map(); let result, timerId = 0;
  const state = { token: 'fixture', playerId: 'p1', roomCode: 'ROOM', cartographersPublic: null, cartographersPrivate: null, cartographersSyncing: true };
  const socket = { connected: true, on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); }, off(event, fn) { listeners.get(event)?.delete(fn); }, emit(...args) { calls.push(args); }, connect() {} };
  const useGameStore = fn => fn(state); useGameStore.getState = () => ({ ...state, setCartographersSyncing(value) { state.cartographersSyncing = value; } });
  const { useCartographersActions } = load('useCartographersActions.ts', { react: h.react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore } }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) });
  const render = () => { result = h.render(useCartographersActions); return result; };
  const pair = (revision = 1, turnRevision = 1, phase = 'drawing') => {
    state.cartographersPublic = { gameId: 'cartographers_heroes', roomCode: 'ROOM', revision, turnRevision, turnId: 1, phase, status: phase === 'game_over' ? 'game_over' : 'playing' };
    state.cartographersPrivate = { gameId: 'cartographers_heroes', roomCode: 'ROOM', revision, playerId: 'p1', resultMaps: [], assignments: [{ targetPlayerId: 'p1', submissionToken: '1:p1' }] };
    state.cartographersSyncing = false; render();
  };
  const event = (name, payload) => { for (const fn of listeners.get(name) ?? []) fn(payload); render(); };
  render(); return { state, socket, calls, pair, event, render, timers, cleanup: h.cleanup, get actions() { return result; } };
}
const choice = { anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false, optionIndex: 0, terrain: 'forest' };
test('old match assignment token reuse cannot submit old geometry to a rematch', () => {
  const h = harness(); h.pair(); const stale = h.actions.send, assignment = h.state.cartographersPrivate.assignments[0];
  h.pair(200, 200); assert.equal(assignment.submissionToken, h.state.cartographersPrivate.assignments[0].submissionToken);
  assert.equal(stale('place', choice, assignment), false); assert.equal(h.calls.filter(c => c[0] === 'cartographers:place').length, 0); h.cleanup();
});
test('same-turn simultaneous submissions use current revision and fence duplicate presses', () => {
  const h = harness(); h.pair(); const captured = h.actions.send, assignment = h.state.cartographersPrivate.assignments[0];
  h.pair(2, 1); assert.equal(captured('place', choice, assignment), true); assert.equal(captured('place', choice, assignment), false);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 2); assert.equal(h.calls.at(-1)[1].submissionToken, '1:p1'); h.cleanup();
});
test('phase changes, departed assignments and mismatched private room cannot submit', () => {
  for (const change of ['phase', 'assignment', 'room', 'revision']) {
    const h = harness(); h.pair(); const stale = h.actions.send, assignment = h.state.cartographersPrivate.assignments[0];
    if (change === 'phase') h.pair(2, 1, 'season_effect');
    if (change === 'assignment') h.state.cartographersPrivate.assignments = [];
    if (change === 'room') h.state.cartographersPrivate.roomCode = 'OTHER';
    if (change === 'revision') h.state.cartographersPrivate.revision++;
    assert.equal(stale('place', choice, assignment), false, change); h.cleanup();
  }
});
test('captured rematch and inspect controls cannot act on another finished match', () => {
  for (const action of ['start', 'inspect_map']) {
    const h = harness(); h.pair(100, 90, 'game_over'); const stale = h.actions.send;
    h.pair(300, 290, 'game_over'); assert.equal(stale(action, 'p2'), false, action); h.cleanup();
  }
});
test('accepted place waits for paired state in either arrival order', () => {
  for (const ackFirst of [true, false]) {
    const h = harness(); h.pair(); h.actions.send('place', choice, h.state.cartographersPrivate.assignments[0]); h.render();
    const ack = () => h.event('cartographers:action_accepted', { action: 'place', revision: 2 });
    if (ackFirst) ack(); else h.pair(2); assert.equal(h.actions.pending, true);
    if (ackFirst) h.pair(2); else ack(); assert.equal(h.actions.pending, false); h.cleanup();
  }
});
test('inspection waits for the requested result map at the same revision', () => {
  const h = harness(); h.pair(100, 90, 'game_over'); assert.equal(h.actions.send('inspect_map', 'p2'), true);
  h.event('cartographers:action_accepted', { action: 'inspect_map', revision: 100 }); assert.equal(h.actions.pending, true);
  h.state.cartographersPrivate = { ...h.state.cartographersPrivate, resultMaps: [{ playerId: 'p3' }] }; h.render(); assert.equal(h.actions.pending, true);
  h.state.cartographersPrivate = { ...h.state.cartographersPrivate, resultMaps: [{ playerId: 'p2' }] }; h.render(); assert.equal(h.actions.pending, false); h.cleanup();
});
test('reconnect and timeout refresh without replaying placements', () => {
  const h = harness(); h.pair(); h.actions.send('place', choice, h.state.cartographersPrivate.assignments[0]);
  h.event('disconnect'); h.event('connect'); assert.equal(h.state.cartographersSyncing, true);
  assert.equal(h.actions.send('place', choice, h.state.cartographersPrivate.assignments[0]), false);
  h.pair(2); h.actions.send('place', choice, h.state.cartographersPrivate.assignments[0]);
  for (const { fn, ms } of h.timers.values()) if (ms === 12000) fn();
  h.render(); assert.equal(h.state.cartographersSyncing, true); assert.equal(h.calls.filter(c => c[0] === 'cartographers:place').length, 2); h.cleanup();
});

const constants = load('../../../../packages/types/src/cartographers-heroes-constants.ts');
const geometry = load('geometry.ts', { '@zuychin-arcade/types': constants });
const engine = load('../../../../apps/server/src/game/cartographers-heroes/engine.ts', { '@zuychin-arcade/types': constants });
test('all 19 cards, both maps and eight transforms match authoritative geometry', () => {
  assert.equal(constants.CARTOGRAPHERS_CARDS.length, 19);
  for (const side of ['C', 'D']) for (const card of constants.CARTOGRAPHERS_CARDS) {
    const map = geometry.emptyChart(side);
    const assignment = { targetPlayerId: 'p1', displayName: 'P1', submissionToken: '1:p1', map, fallback: false, fixedPlacement: null };
    for (const rotation of [0, 90, 180, 270]) for (const mirrored of [false, true]) for (const [optionIndex, shape] of geometry.shapeOptions(card, false).entries()) {
      const transform = { anchor: { x: 4, y: 4 }, rotation, mirrored };
      const preview = geometry.placementPreview(assignment, card, optionIndex, geometry.terrainOptions(card, false)[0], transform);
      assert.deepEqual(JSON.parse(JSON.stringify(preview.cells)), JSON.parse(JSON.stringify(engine.transformCartographersShape(shape, transform))), `${side}/${card.id}/${rotation}/${mirrored}`);
      if (card.kind === 'hero') assert.deepEqual(JSON.parse(JSON.stringify(preview.attack)), Array.from(engine.transformCartographersShape(card.attack, transform, false).filter(geometry.insideMap), geometry.cellIndex));
      if (card.id === 'gorgon' && preview.valid) assert.deepEqual(Array.from(preview.targets).sort((a,b)=>a-b), Array.from(engine.cartographersGorgonTargets(preview.map), geometry.cellIndex).sort((a,b)=>a-b));
    }
  }
});

const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function editor(cardId, overrides = {}) {
  const h = hooks(), calls = [];
  const card = constants.CARTOGRAPHERS_CARD_BY_ID[cardId];
  const props = { assignment: { targetPlayerId: 'p1', displayName: 'P1', submissionToken: '1:p1', map: geometry.emptyChart('C'), fallback: false, fixedPlacement: null }, card, side: 'C', destruction: false, busy: false, onPlace: value => calls.push(['place', value]), onDestroy: value => calls.push(['destroy', value]), ...overrides };
  const { PlacementEditor } = load('PlacementEditor.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 375, fontScale: 1 }) },
    '../ui/NeonButton': { NeonButton: 'Button' }, '../ui/ScalePressable': { ScalePressable: 'Button' },
    './MapBoard': { MapBoard: 'MapBoard', ShapeDiagram: 'Shape', TERRAIN: Object.fromEntries(['forest','village','farm','water','hero','monster'].map(t => [t, {label:t}])) },
    './ExploreCard': { ExploreCard: 'Explore' }, './geometry': geometry, './palette': { CARTOGRAPHERS: {} },
  });
  const render = () => h.render(() => PlacementEditor(props));
  const click = label => { const node = nodes(render()).find(n => n.type === 'Button' && (n.props.label === label || n.props.accessibilityLabel === label)); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label); node.props.onPress(); };
  const cell = point => nodes(render()).find(n => n.type === 'MapBoard').props.onCell(point);
  return { props, calls, render, click, cell };
}
test('placement editor emits rotation, mirror, shape and terrain choices', () => {
  const p = editor('lagoon'); p.cell({ x: 4, y: 4 }); p.click('ROTATE · 0°'); p.click('MIRROR SHAPE');
  p.click('CONFIRM ON P1’S MAP');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0])), ['place', { anchor: { x: 4, y: 4 }, rotation: 90, mirrored: true, optionIndex: 0, terrain: 'water' }]);
});
test('Troll choice accepts only a marked empty neighbour', () => {
  const p = editor('troll', { destruction: true }); p.props.assignment.map.cells[0] = { terrain: 'monster', monster: 'troll', destroyed: false, wasteland: false };
  p.cell({ x: 4, y: 4 }); assert.equal(nodes(p.render()).find(n => n.props?.label === 'CONFIRM DESTRUCTION').props.disabled, true);
  p.cell({ x: 1, y: 0 }); p.click('CONFIRM DESTRUCTION');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0])), ['destroy', { x: 1, y: 0 }]);
});
test('Gorgon requires explicit target and moving its shape invalidates that choice', () => {
  const p = editor('gorgon'); p.cell({ x: 4, y: 0 });
  assert.equal(nodes(p.render()).find(n => n.props?.label === 'CONFIRM ON P1’S MAP').props.disabled, true);
  p.click('CHOOSE GORGON DESTRUCTION'); const board = nodes(p.render()).find(n => n.type === 'MapBoard');
  assert.ok(board.props.targets.length); const target = board.props.targets[0]; p.cell({ x: target % 11, y: Math.floor(target / 11) });
  p.click('CONFIRM ON P1’S MAP'); assert.ok(p.calls[0][1].destroyTarget);
  p.click('Move anchor Right'); assert.equal(nodes(p.render()).find(n => n.props?.label === 'CONFIRM ON P1’S MAP').props.disabled, true);
});
test('solo fixed ambush cannot be moved, rotated or mirrored', () => {
  const p = editor('zombie'); p.props.assignment.fixedPlacement = { anchor: { x: 0, y: 0 }, rotation: 0, mirrored: false };
  p.cell({ x: 4, y: 4 }); p.click('CONFIRM ON P1’S MAP');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0][1].anchor)), { x: 0, y: 0 });
  assert.equal(nodes(p.render()).filter(n => n.props?.label?.startsWith('ROTATE') || n.props?.label === 'MIRROR SHAPE').length, 0);
});
test('busy placement editor disables confirmation and ignores grid presses', () => {
  const p = editor('lagoon', { busy: true }); p.cell({ x: 4, y: 4 });
  assert.equal(nodes(p.render()).find(n => n.props?.label === 'CONFIRMING…').props.disabled, true); assert.equal(p.calls.length, 0);
});
test('Back dismisses the Cartographers leave dialog before requesting another action', () => {
  const h = hooks(); let dialog = null, back; const calls = [];
  const state = { token: 'fixture', roomCode: 'ROOM', cartographersPublic: { status: 'playing' } };
  const useGameStore = fn => fn(state); useGameStore.getState = () => state;
  const { useCartographersLeave } = load('useCartographersLeave.ts', {
    react: h.react, 'react-native': { Platform: { OS: 'android' }, BackHandler: { addEventListener(event, fn) { back = fn; return { remove() {} }; } } },
    'expo-router': { router: { replace() {} } }, '../../store/useGameStore': { useGameStore },
    '../../hooks/useNativeLeaveGuard': { useNativeLeaveGuard: () => () => {} }, '../../hooks/useWebBackGuard': { useWebBackGuard() {} },
    '../../hooks/useSocket': { getSocket: () => null }, '../../lib/api': { leaveRoom: () => calls.push('leave') }, '../../lib/storage': { clearAuthIfMatches() {} },
    '../../lib/dialog': { showDialog(title, message, buttons) { dialog = { title, message, buttons }; }, useDialogStore: { getState: () => ({ dialog, hide() { dialog = null; } }) } },
  });
  h.render(() => useCartographersLeave(() => false)); back(); assert.ok(dialog); back(); assert.equal(dialog, null); assert.equal(calls.length, 0); h.cleanup();
});

function gameScreen(count = 100) {
  const h = hooks(), players = Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `Cartographer ${i}`, totalScore: i, coins: 0, scores: [], submitted: true, forfeited: false }));
  const state = { token: 'fixture', playerId: 'p0', room: { roomCode: 'ROOM', players: players.map(p => ({ ...p, isConnected: true, isHost: p.playerId === 'p0', hasLeft: false })) },
    cartographersPublic: { roomCode: 'ROOM', revision: 10, status: 'game_over', phase: 'game_over', season: 3, endReason: 'natural', players, mapSide: 'C', winnerIds: ['p99'], objectiveIds: [], revealedCardIds: [] },
    cartographersPrivate: { roomCode: 'ROOM', revision: 10, playerId: 'p0', map: geometry.emptyChart('C'), assignments: [], resultMaps: [] } };
  const modules = { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': constants,
    '../../store/useGameStore': { useGameStore: fn => fn(state) }, '../../components/cartographers/palette': { CARTOGRAPHERS: {} },
    '../../components/cartographers/useCartographersActions': { useCartographersActions: () => ({ busy: false, pending: false, send() {} }) },
    '../../components/cartographers/useCartographersLeave': { useCartographersLeave: () => ({ leaving: false, requestLeave() {} }) } };
  for (const [folder, names] of [['ui', ['GameRecovery','ScalePressable','NeonButton','CardGrid']], ['cartographers', ['PlacementEditor','MapBoard','ObjectiveCard','ExploreCard']]]) {
    for (const name of names) modules[`../../components/${folder}/${name}`] = { [name]: name };
  }
  modules['../../components/cartographers/ReferenceSheet'] = { CartographersReferenceSheet: 'Reference' };
  const { default: Game } = load('../../app/cartographers-heroes/game.tsx', modules);
  return { state, render: () => h.render(Game) };
}
test('100-seat results initially render ten inspection controls and expand explicitly', () => {
  const p = gameScreen(); const initial = nodes(p.render());
  assert.equal(initial.filter(n => n.props?.label === 'INSPECT MAP').length, 10);
  initial.find(n => n.props?.label === 'SHOW ALL 100 CARTOGRAPHERS').props.onPress();
  assert.equal(nodes(p.render()).filter(n => n.props?.label === 'INSPECT MAP').length, 100);
});
test('game screen hides an unmatched revision or private room behind recovery', () => {
  for (const field of ['revision', 'roomCode', 'playerId']) {
    const p = gameScreen(); p.state.cartographersPrivate[field] = field === 'revision' ? 9 : 'OTHER';
    assert.equal(p.render().type, 'GameRecovery', field);
  }
});
