const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

for (const label of ['Open rules', 'Leave game', 'Show table reactions', 'Send reaction:']) {
  test(`${label} declares at least a 48 by 48 touch target`, () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/coup/game.tsx'), 'utf8');
    const file = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const controls = [];
    const visit = node => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'Pressable'
        && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
          && attribute.name.getText(file) === 'accessibilityLabel'
          && attribute.initializer?.getText(file).includes(label))) controls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(controls.length, 1, `Expected one declared ${label} target`);
    const style = controls[0].attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'style');
    assert(style?.initializer && ts.isJsxExpression(style.initializer) && ts.isObjectLiteralExpression(style.initializer.expression));
    const sizes = Object.fromEntries(style.initializer.expression.properties.filter(ts.isPropertyAssignment)
      .filter(property => ts.isNumericLiteral(property.initializer))
      .map(property => [property.name.getText(file), Number(property.initializer.text)]));
    assert((sizes.minWidth ?? sizes.width) >= 48, `${label} width is below 48`);
    assert((sizes.minHeight ?? sizes.height) >= 48, `${label} height is below 48`);
  });
}


function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/coup/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', coupPublic: null, coupPrivate: null, coupSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setCoupSyncing(value) { store.coupSyncing = value; dirty = true; } });
  const { useCoupActions: renderHook } = load('useCoupActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'coup', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.coupPublic = snapshot(revision); store.coupPrivate = snapshot(revision, true); store.coupSyncing = false; event('game_state', store.coupPublic); event('private_state', store.coupPrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('respond', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'coup:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('coup:action_accepted', { action: 'respond', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('respond', {}, 'Pass', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('respond', {}, 'Pass', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('action', { cardId: 'x' }, 'Place', 1), true);
  assert.equal(send('action', { cardId: 'x' }, 'Place', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'coup:action').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('action', {}, 'Place', 1); h.flush();
  h.event('coup:action_accepted', { action: 'exchange', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('exchange', { cardIndex: 1 }, 'Gold', 1);
  h.event('coup:action_accepted', { action: 'exchange', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Gold accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

for (const [action, payload] of [
  ['choose_allegiance', { allegiance: 'reformist' }],
  ['examine_select', { character: 'captain' }],
  ['examine', { forceSwap: true }],
]) {
  test(`Reformation ${action} is revision-fenced and waits for private/public adoption`, () => {
    const h = actionHarness(); h.pair(8);
    assert.equal(h.actions.send(action, payload, action, 7), false);
    assert.equal(h.actions.send(action, payload, action, 8), true);
    assert.equal(h.calls.at(-1)[0], `coup:${action}`);
    assert.equal(h.calls.at(-1)[1].expectedRevision, 8);
    for (const [key, value] of Object.entries(payload)) assert.equal(h.calls.at(-1)[1][key], value);
    assert.equal(h.actions.send(action, payload, action, 8), false);
    h.event('coup:action_accepted', { action, revision: 9 });
    assert.equal(h.actions.pending, true);
    h.pair(9);
    assert.equal(h.actions.pending, false);
  });
}

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.coupSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('respond', {}, 'Pass', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('respond', {}, 'Pass', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('respond', {}, 'Pass', 3), false);
  h.store.token = 'synthetic-session'; h.store.coupPrivate.playerId = 'other';
  assert.equal(oldSend('respond', {}, 'Pass', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('action', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('action', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('respond', {}, 'Pass', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('respond', {}, 'Pass', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.coupSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('exchange', { cardIndex: 0 }, 'Gold', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('exchange', { cardIndex: 0 }, 'Gold', 1), false);
  h.pair(1); assert.equal(h.actions.send('exchange', { cardIndex: 0 }, 'Gold', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('respond', {}, 'Pass', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('respond', {}, 'Pass', 1), false);
  h.pair(2); assert.equal(h.actions.send('respond', {}, 'Pass', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start_game', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('coup:action_accepted', { action: 'start_game', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('coup:action_accepted', { action: 'start_game', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});

const jsx = (type, props) => ({ type, props });
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => [node?.props?.children].flat(Infinity).map((child) => typeof child === 'object' ? text(child) : child ?? '').join(' ');
const cardModules = {
  'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 375, fontScale: 1 }) },
  'expo-linear-gradient': { LinearGradient: 'Gradient' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
  '../ui/ScalePressable': { ScalePressable: 'Button' },
  '../ui/CardSurface': { CardSurface: 'CardSurface' }, './CoupCharacterArtwork': { CoupCharacterArtwork: 'Artwork' },
  '../../constants/theme': { COUP: {}, COUP_CHARACTER_COLOR: { ambassador: '#abcdef' } },
};

test('full Ambassador name and ability stay visible, with a stable disabled button', () => {
  const { CharacterCard } = load('CharacterCard.tsx', cardModules);
  const tree = CharacterCard({ character: 'ambassador', size: 'md', onPress() {}, disabled: true });
  assert.equal(tree.type, 'Button');
  assert.equal(tree.props.disabled, true);
  assert.match(text(tree), /Ambassador/);
  assert.match(text(tree), /Exchange/);
  const name = nodes(tree).find((node) => node.props.children === 'Ambassador');
  assert.equal(name.props.numberOfLines, undefined);
  assert.equal(name.props.adjustsFontSizeToFit, undefined);
});

test('face-down influence does not expose a character or its ability', () => {
  const { CharacterCard } = load('CharacterCard.tsx', cardModules);
  const tree = CharacterCard({ character: 'ambassador', faceDown: true, size: 'md' });
  assert.equal(tree.props.accessibilityLabel, 'Hidden influence');
  assert(!text(tree).includes('AMBASSADOR'));
  assert(!text(tree).includes('Exchange'));
});

test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.coupPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('action', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('action', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('action', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'coup:action');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.coupSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.coupPublic = h.snapshot(5); h.store.coupPrivate = h.snapshot(5, true); h.store.coupSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('action', { action: 'income' }, 'Income', 5), true);
});

test('all exchange decisions are inside the scrollable keyboard region', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/coup/game.tsx'), 'utf8');
  const start = source.indexOf('<ScrollView nativeID="coup-decision-panel"');
  const end = source.indexOf('</ScrollView>', start);
  assert(start >= 0);
  assert(source.slice(start, end).includes('CONFIRM ('));
  assert(source.slice(start, end).includes('tabIndex: 0'));
  assert(!source.includes("sendCommand('coup:examine'"));
});

test('completed results use immutable game forfeits, not later room departures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/coup/game.tsx'), 'utf8');
  const results = source.slice(source.indexOf('nativeID="coup-results"'));
  assert(results.includes('const hasLeft = player.forfeited;'));
  assert(!results.includes('?.hasLeft'));
});

test('live roster distinguishes a departed spectator from an active-seat forfeit', () => {
  const { PlayerSeat } = load('PlayerSeat.tsx', {
    ...cardModules, './CharacterCard': { CharacterCard: 'Card' }, './Coin': { Coin: 'Coin' }, '../ui/GlowPulse': { GlowPulse: 'Glow' },
  });
  const player = { playerId: 'p', displayName: 'Spectator', coins: 0, influenceCount: 0, revealedCharacters: ['duke', 'captain'], eliminated: true, forfeited: false };
  const left = PlayerSeat({ player, isMe: false, presence: { hasLeft: true, isConnected: false } });
  assert.match(left.props.accessibilityLabel, /left/);
  assert(!left.props.accessibilityLabel.includes('forfeited'));
  const forfeited = PlayerSeat({ player: { ...player, forfeited: true }, isMe: false, presence: { hasLeft: true, isConnected: false } });
  assert.match(forfeited.props.accessibilityLabel, /forfeited/);
});

test('Cancel restores the remounted action only while the same decision is owned', () => {
  const focused = [], scrolled = [];
  const control = { getAttribute: () => 'Steal', focus: () => focused.push('Steal'), scrollIntoView: () => scrolled.push('Steal') };
  const { restoreCoupActionFocus } = load('focus.ts', {}, { document: { querySelectorAll: () => [control] } });
  restoreCoupActionFocus('Steal', () => false); assert.equal(focused.length, 0);
  restoreCoupActionFocus('Steal', () => true); assert.deepEqual(focused, ['Steal']); assert.deepEqual(scrolled, ['Steal']);
  restoreCoupActionFocus('Coup', () => true); assert.equal(focused.length, 1);
});

test('Coup uses only registered Outfit font weights and submission-neutral feedback', () => {
  for (const file of ['../app/coup/game.tsx', '../components/coup/CharacterCard.tsx', '../components/coup/PlayerSeat.tsx']) {
    assert(!fs.readFileSync(path.join(__dirname, file), 'utf8').includes('Outfit_600SemiBold'));
  }
  const source = fs.readFileSync(path.join(__dirname, '../components/coup/useCoupActions.ts'), 'utf8');
  assert(!source.includes('confirmed.'));
  assert(source.includes('accepted.'));
});
