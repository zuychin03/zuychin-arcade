const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

for (const label of ['Leave game', 'Open rulebook', 'Reveal my secret role', 'Scroll hand left', 'Scroll hand right', 'Retry connection']) {
  test(`${label} declares at least a 48 by 48 touch target`, () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/saboteur/game.tsx'), 'utf8');
    const file = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let control;
    const visit = node => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'Pressable'
        && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
          && attribute.name.getText(file) === 'accessibilityLabel'
          && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === label)) control = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert(control, `Missing ${label}`);
    const style = control.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'style');
    assert(style?.initializer && ts.isJsxExpression(style.initializer) && ts.isObjectLiteralExpression(style.initializer.expression));
    const sizes = Object.fromEntries(style.initializer.expression.properties.filter(ts.isPropertyAssignment)
      .filter(property => ts.isNumericLiteral(property.initializer))
      .map(property => [property.name.getText(file), Number(property.initializer.text)]));
    assert((sizes.minWidth ?? sizes.width) >= 48, `${label} width is below 48`);
    assert((sizes.minHeight ?? sizes.height) >= 48, `${label} height is below 48`);
  });
}

test('accepted move copy does not falsely require waiting when the same player retains the turn', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/saboteur/game.tsx'), 'utf8');
  assert.equal(source.match(/'Move accepted\.'/g)?.length, 2);
  assert(!source.includes('Move accepted. Waiting for the next turn.'));
});

test('turn context wraps as a readable group instead of shrinking beside hand actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/saboteur/game.tsx'), 'utf8');
  const file = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let turn;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'nativeID' && node.initializer && ts.isStringLiteral(node.initializer) && node.initializer.text === 'saboteur-turn') turn = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(turn);
  const turnElement = turn.parent.parent.parent;
  const container = turnElement.parent;
  const style = container.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'style');
  const value = vm.runInNewContext('(' + style.initializer.expression.getText(file) + ')');
  assert.equal(value.flexGrow, 1);
  assert.equal(value.flexBasis, 240);
  assert.equal(value.minWidth, 0);
  assert.equal(value.flex, undefined);
});

function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/saboteur/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', publicState: null, privateState: null, saboteurSyncing: true };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value, (value) => { const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }]; },
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const socket = {
    connected: true,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    emit(...args) { calls.push(args); },
  };
  const useGameStore = (selector) => selector(store);
  useGameStore.getState = () => ({ ...store, setSaboteurSyncing(value) { store.saboteurSyncing = value; dirty = true; } });
  const { useSaboteurActions: renderHook } = load('useSaboteurActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'saboteur', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.publicState = snapshot(revision); store.privateState = snapshot(revision, true); store.saboteurSyncing = false; event('game_state', store.publicState); event('private_state', store.privateState); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { for (const hook of hooks) hook?.cleanup?.(); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('pass_turn', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'saboteur:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('saboteur:action_accepted', { action: 'pass_turn', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('retired command closures cannot send after their hook unmounts', () => {
  const h = actionHarness(); h.pair(3);
  const send = h.actions.send;
  h.unmount();
  assert.equal(send('pass_turn', {}, 'Pass', 3), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('stale and malformed partial frames cannot regress local decision trackers', () => {
  const h = actionHarness(); h.pair(3);
  h.store.saboteurSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, 0, NaN, Infinity, 5.5, Number.MAX_SAFE_INTEGER + 1]) {
    h.event('game_state', h.snapshot(revision));
    h.event('private_state', h.snapshot(revision, true));
  }
  h.store.publicState = h.snapshot(5);
  h.store.privateState = h.snapshot(5, true);
  h.store.saboteurSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  h.expire(150);
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 5), true);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('place_card', { cardId: 'x' }, 'Place', 1), true);
  assert.equal(send('place_card', { cardId: 'x' }, 'Place', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'place_card').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('place_card', {}, 'Place', 1); h.flush();
  h.event('saboteur:action_accepted', { action: 'choose_gold', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose_gold', { cardIndex: 1 }, 'Gold', 1);
  h.event('saboteur:action_accepted', { action: 'choose_gold', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Gold confirmed.');
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.saboteurSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('pass_turn', {}, 'Pass', 3), false);
  h.store.token = 'synthetic-session'; h.store.privateState.playerId = 'other';
  assert.equal(oldSend('pass_turn', {}, 'Pass', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('play_action', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('play_action', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('pass_turn', {}, 'Pass', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('pass_turn', {}, 'Pass', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.saboteurSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose_gold', { cardIndex: 0 }, 'Gold', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('choose_gold', { cardIndex: 0 }, 'Gold', 1), false);
  h.pair(1); assert.equal(h.actions.send('choose_gold', { cardIndex: 0 }, 'Gold', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('pass_turn', {}, 'Pass', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('pass_turn', {}, 'Pass', 1), false);
  h.pair(2); assert.equal(h.actions.send('pass_turn', {}, 'Pass', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start_game', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('saboteur:action_accepted', { action: 'start_game', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('saboteur:action_accepted', { action: 'start_game', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});

const jsx = (type, props) => ({ type, props });
const modules = {
  'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' },
  '../../ui/ScalePressable': { ScalePressable: 'Button' }, '../../ui/NeonButton': { NeonButton: 'Button' },
  '../../../constants/theme': { ARCADE: {}, MINE: {} }, './OverlayFrame': { OverlayFrame: 'Frame' },
};
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => [node?.props?.children].flat(Infinity).map((child) => typeof child === 'object' ? text(child) : child ?? '').join(' ');

test('gold picker shows private values and reflects authoritative busy state', () => {
  const { GoldPickOverlay } = load('overlays/GoldPickOverlay.tsx', modules);
  const tree = GoldPickOverlay({ values: [3, 1], busy: true });
  const cards = nodes(tree).filter((node) => node.props.accessibilityLabel?.startsWith('Choose gold card'));
  assert.equal(cards.length, 2); assert.match(cards[0].props.accessibilityLabel, /worth 3 gold/);
  assert.equal(cards[0].props.disabled, true);
  assert(!text(tree).includes('face-down'));
});

test('early ending has no celebration or winner even with highest historical gold', () => {
  const { GameOverOverlay } = load('overlays/GameOverOverlay.tsx', modules);
  const tree = GameOverOverlay({ state: { terminationReason: 'not_enough_players', winnerIds: [], players: [{ playerId: 'p', displayName: 'Left player', goldCollected: 9, forfeited: true }] }, isHost: true, canRematch: false, busy: false, connectedCount: 2 });
  assert.match(text(tree), /Match ended early/); assert.match(text(tree), /no competitive result is recorded/);
  assert(!nodes(tree).some((node) => node.props.children === 'WINNER'));
  assert.equal(nodes(tree).find((node) => node.props.label === 'PLAY AGAIN').props.disabled, true);
});

const boardModules = {
  'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Pressable: 'Cell', View: 'View' },
  '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../cards/PathCardView': { PathCardView: 'Path' },
  '../cards/CardBack': { CardBack: 'Back' }, '../../ui/GlowPulse': { GlowPulse: 'Glow' }, '../../../constants/theme': { ARCADE: {} },
};
test('board uses server-oriented effective goal edges without a second rotation', () => {
  const { BoardCell } = load('board/BoardCell.tsx', boardModules);
  const card = { subtype: 'goal_stone', edges: { top: 'closed', right: 'open', bottom: 'open', left: 'closed', center: true } };
  const tree = BoardCell({ placed: { card }, row: 8, col: 2, width: 48, height: 69 });
  assert.match(tree.props.accessibilityLabel, /Openings: right, bottom/);
  const rendered = nodes(tree).find((node) => node.type === 'Path');
  assert.equal(rendered.props.card, card); assert.equal(rendered.props.rotated, undefined);
  assert.equal(tree.props.accessibilityRole, 'image');
});
test('unmapped hidden goals reveal no private value and legal placements have non-colour cue', () => {
  const { BoardCell } = load('board/BoardCell.tsx', boardModules);
  const hidden = BoardCell({ goal: { revealed: false }, row: 8, col: 4, width: 48, height: 69 });
  assert.match(hidden.props.accessibilityLabel, /hidden goal/); assert(!hidden.props.accessibilityLabel.includes('gold'));
  const legal = BoardCell({ row: 1, col: 4, width: 48, height: 69, isInteractive: true, isValidTarget: true });
  assert.equal(legal.props.accessibilityRole, 'button'); assert(nodes(legal).some((node) => node.type === 'Icon' && node.props.name === 'plus'));
});

test('revealed goals use public paths without obsolete private Map strips or cell hints', () => {
  const { GameBoard } = load('board/GameBoard.tsx', {
    ...modules,
    react: { useMemo: (fn) => fn(), useRef: () => ({ current: null }), useEffect: () => {} },
    'react-native': { Text: 'Text', View: 'View', ScrollView: 'Scroll', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 390 }) },
    '@zuychin-arcade/types': { BOARD: { playableBounds: { minRow: 0, maxRow: 8, minCol: 2, maxCol: 6 } } },
    './BoardCell': { BoardCell: 'Cell' },
    '../../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
  });
  const peek = { position: { row: 8, col: 4 }, isGold: false, edges: { top: 'open', right: 'closed', bottom: 'closed', left: 'open', center: true } };
  const base = { board: [], goals: [{ position: peek.position, revealed: false }], peekedGoals: [peek], validTargets: new Set(), actionTargets: new Set(), round: 1, interactionActive: false };
  const hidden = GameBoard(base);
  assert(nodes(hidden).some((node) => node.props.accessibilityLabel?.includes('Private map knowledge: CENTRE goal is stone. Openings top, left')));
  const publicCard = { edges: { top: 'closed', right: 'open', bottom: 'open', left: 'closed', center: true }, subtype: 'goal_stone' };
  const revealed = GameBoard({ ...base, board: [{ position: peek.position, card: publicCard }], goals: [{ position: peek.position, revealed: true }] });
  assert(!nodes(revealed).some((node) => node.props.accessibilityLabel?.startsWith('Private map knowledge:')));
  const goalCell = nodes(revealed).find((node) => node.type === 'Cell' && node.props.row === 8 && node.props.col === 4);
  assert.equal(goalCell.props.placed.card, publicCard); assert.equal(goalCell.props.peekedGoal, null);
  assert.equal(base.peekedGoals.length, 1); assert.equal(base.peekedGoals[0], peek);
});

function mapNoticeHarness(initial = []) {
  const hooks = [], timers = new Map();
  let index = 0, timerId = 0, effect, currentPeeks = initial, currentRound = 1, result;
  const react = {
    useState(value) { const slot = index++; hooks[slot] ??= { value }; return [hooks[slot].value, (next) => { hooks[slot].value = next; }]; },
    useRef(value) { const slot = index++; hooks[slot] ??= { current: value }; return hooks[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!hooks[slot]?.deps.every((value, key) => Object.is(value, deps[key]))) effect = () => { hooks[slot]?.cleanup?.(); hooks[slot] = { deps, cleanup: fn() }; }; },
  };
  const { usePrivateMapNotice: renderHook } = load('usePrivateMapNotice.ts', { react }, { setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = (peeks = currentPeeks, round = currentRound) => { currentPeeks = peeks; currentRound = round; index = 0; effect = null; result = renderHook(peeks, round); if (effect) { effect(); index = 0; effect = null; result = renderHook(peeks, round); } };
  render();
  return { render, timers, get message() { return result[0]; }, dismiss() { result[1](); render(); }, expire() { for (const [id, fn] of timers) { timers.delete(id); fn(); } render(); } };
}
test('Map notice expires despite unrelated projections cloning private peeks', () => {
  const h = mapNoticeHarness(); h.render([{ isGold: false }]);
  assert.match(h.message, /stone/); assert.equal(h.timers.size, 1);
  h.render([{ isGold: false }]); h.render([{ isGold: false }]);
  assert.equal(h.timers.size, 1); h.expire(); assert.equal(h.message, null);
});
test('Map history does not replay on hydration and a new round clears the notice', () => {
  const h = mapNoticeHarness([{ isGold: true }]); assert.equal(h.message, null);
  h.render([{ isGold: true }, { isGold: false }]); assert.match(h.message, /stone/);
  h.render([], 2); assert.equal(h.message, null); assert.equal(h.timers.size, 0);
});
