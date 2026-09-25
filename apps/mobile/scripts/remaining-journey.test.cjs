const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const player = (index) => ({ playerId: 'p' + index, displayName: 'Player ' + index, isHost: index === 0, isConnected: true, hasLeft: false });
const makeRoom = () => ({ roomCode: '7KPM-R4TX', gameId: 'bang', status: 'lobby', playerCount: 4, maxPlayers: 7, players: [0, 1, 2, 3].map(player) });

function harness(component, overrides = {}) {
  const calls = [];
  const hooks = [];
  const effects = [];
  const listeners = new Map();
  const timers = new Map();
  const dialogs = [];
  const response = { token: 'synthetic-only', playerId: 'p0', roomCode: '7KPM-R4TX', room: makeRoom() };
  const store = { token: component === 'RemainingLobby' ? response.token : null, playerId: 'p0', roomCode: response.roomCode, room: response.room };
  let cursor = 0;
  let dirty = false;
  let mounted = true;
  let lateWrites = 0;
  let tree;
  let timerId = 0;
  let back;
  let blur;
  let dialog = null;
  let nativePrevented = false;
  let nativeAttempt;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (value) => {
        if (!mounted) { lateWrites++; return; }
        const next = typeof value === 'function' ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    },
  };
  react.useLayoutEffect = react.useEffect;
  const emitEvent = (event, payload) => { for (const fn of listeners.get(event) ?? []) fn(payload); };
  const socket = {
    connected: true,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    emit(...args) { calls.push(['emit', ...args]); },
    connect() { socket.connected = true; calls.push(['connect']); emitEvent('connect'); },
    disconnect() { socket.connected = false; calls.push(['disconnect']); emitEvent('disconnect'); },
  };
  function useGameStore(selector) { return selector(store); }
  useGameStore.getState = () => ({ ...store,
    setAuth: (auth) => { calls.push(['setAuth']); Object.assign(store, auth); dirty = true; },
    setRoom: (room) => { calls.push(['setRoom']); store.room = room; dirty = true; },
    clearAll: () => { calls.push(['clearAll']); Object.assign(store, { token: null, room: null }); dirty = true; },
  });
  const api = Object.fromEntries(['createRoom', 'joinRoom', 'leaveRoom', 'kickPlayer'].map((name) => [name, async (...args) => {
    calls.push([name, ...args]);
    return overrides[name] ? overrides[name](...args) : name === 'createRoom' || name === 'joinRoom' ? response : undefined;
  }]));
  const storage = Object.fromEntries(['loadDisplayName', 'saveDisplayName', 'saveAuth', 'clearAuth', 'clearAuthIfMatches'].map((name) => [name, async (...args) => {
    calls.push([name, ...args]);
    return overrides[name]?.(...args);
  }]));
  storage.saveAuthIfCurrent = async (auth, isCurrent) => { if (!isCurrent()) return false; await storage.saveAuth(auth); return isCurrent(); };
  const jsx = (type, props) => {
    if (type === 'TextInput' && props.ref) props.ref.current = { focus: () => calls.push(['focus', props.accessibilityLabel]) };
    return { type, props };
  };
  const animation = { duration: () => animation, delay: () => animation, springify: () => animation, damping: () => animation };
  const navigation = { addListener: (event, fn) => { back = fn; return () => {}; } };
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ...Object.fromEntries(['ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])), Platform: { OS: overrides.platform ?? 'web' }, useWindowDimensions: () => ({ width: 320 }), BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-reanimated': { default: { View: 'Animated.View' }, FadeInDown: animation, FadeInUp: animation },
    'expo-router': { router: { push: (route) => calls.push(['push', route]), replace: (route) => calls.push([nativePrevented ? 'blockedReplace' : 'replace', route]) }, useNavigation: () => navigation, useFocusEffect: (fn) => react.useEffect(() => { blur = fn(); return blur; }, [fn]) },
    'expo-router/react-navigation': { usePreventRemove: (prevented, callback) => {
      nativeAttempt = callback;
      react.useEffect(() => { nativePrevented = prevented; }, [prevented]);
    } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../lib/api': api,
    '../../lib/storage': storage,
    '../../lib/gameRoutes': { gameLobbyRoute: (id) => '/' + id.replaceAll('_', '-') + '/lobby' },
    '../../lib/roomCode': { ROOM_CODE_EXAMPLE: '7KPM-R4TX', ROOM_CODE_PATTERN: /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, formatRoomCodeInput: (value) => value.toUpperCase() },
    '../../lib/dialog': { showDialog: (...args) => { dialogs.push(args); dialog = { title: args[0], message: args[1], buttons: args[2] }; }, useDialogStore: { getState: () => ({ dialog, hide: () => { dialog = null; calls.push(['hideDialog']); } }) } },
    '../../store/useGameStore': { useGameStore },
    '../../hooks/useSocket': { getSocket: () => socket },
    '../../hooks/useWebBackGuard': { useWebBackGuard: () => {} },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
    '../../constants/theme': { neonText: () => ({}) },
    '../lobby/RoomCodeDisplay': { RoomCodeDisplay: 'RoomCodeDisplay' },
    '../ui/NeonButton': { NeonButton: 'NeonButton' },
    '../ui/ScalePressable': { ScalePressable: 'ScalePressable' },
    '../ui/GameRecovery': { GameRecovery: 'GameRecovery' },
  };
  const hookFile = path.join(__dirname, '../hooks/useNativeLeaveGuard.ts');
  if (fs.existsSync(hookFile)) {
    const hookExports = {};
    const hookCode = ts.transpileModule(fs.readFileSync(hookFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(hookCode, { exports: hookExports, require: name => modules[name] });
    modules['../../hooks/useNativeLeaveGuard'] = hookExports;
  }
  const filename = path.join(__dirname, '../components/remaining/' + component + '.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id), require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  const props = { gameId: 'bang', base: '/bang', gameName: 'BANG!', minPlayers: 4, title: 'BANG!', tagline: 'Bluff and draw', tags: ['4–7 players'], createLabel: 'CREATE TABLE', mark: null, hero: null, briefing: 'Test briefing', gameReady: false, palette: Object.fromEntries(['bg', 'surface', 'panel', 'border', 'accent', 'secondary', 'muted', 'text'].map((name) => [name, '#111111'])), renderRules: (visible) => ({ type: 'Rules', props: { visible } }) };
  const render = () => { cursor = 0; dirty = false; tree = exports[component](props); while (effects.length) effects.shift()(); };
  const flush = async () => { for (let i = 0; i < 10; i++) { await settle(); if (!dirty) return; render(); } assert.fail('Unsettled hooks'); };
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter((child) => child != null).flatMap((child) => nodes(child))];
  const find = (label) => { const match = nodes().find((node) => node.props?.accessibilityLabel === label || node.props?.label === label); assert(match, 'Missing control: ' + label); return match.props; };
  render();
  return { calls, store, props, socket, dialogs, response, find, nodes, flush, render, emitEvent,
    count: (name, event) => calls.filter((call) => call[0] === name && (event === undefined || call[1] === event)).length,
    fill: (label, value) => { find(label).onChangeText(value); render(); },
    confirm: (label) => { const dialog = dialogs.at(-1); assert(dialog, 'Expected confirmation'); dialog[2].find((button) => button.text === label).onPress(); },
    expireTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    nativeBack: () => { if (nativePrevented) { nativeAttempt(); return true; } let prevented = false; back?.({ preventDefault() { prevented = true; } }); return prevented; },
    nativePrevented: () => nativePrevented,
    unmount: () => { mounted = false; hooks.forEach((hook) => hook?.cleanup?.()); },
    blur: () => blur?.(),
    lateWrites: () => lateWrites,
    activeDialog: () => dialog,
  };
}

test('shared entrance inputs and readable prose use the same registered roles across creation, joining and lobby', () => {
  const { TYPOGRAPHY } = require('./lib/typography-fixture.cjs');
  for (const component of ['RemainingLanding', 'RemainingJoin', 'RemainingLobby']) {
    const h = harness(component);
    const expectedCopy = component === 'RemainingLanding' ? 'Create a table or join by room code' : component === 'RemainingJoin' ? 'Ask the host for the room code. You can join any game with its code.' : 'Test briefing';
    const prose = h.nodes().find(node => node.props.children === expectedCopy);
    for (const [property, value] of Object.entries(TYPOGRAPHY.body)) assert.equal(prose.props.style[property], value);
    if (component !== 'RemainingLobby') {
      for (const [property, value] of Object.entries(TYPOGRAPHY.body)) assert.equal(h.find('Your name').style[property], value);
      const label = h.nodes().find(node => node.props.children === 'YOUR NAME');
      assert.equal(label.props.style.fontFamily, TYPOGRAPHY.label.fontFamily);
    }
  }
});

test('optional palette foreground and surfaces reach create, join and lobby controls', () => {
  for (const [component, label] of [['RemainingLanding', 'CREATE ROOM'], ['RemainingJoin', 'JOIN GAME'], ['RemainingLobby', 'START GAME']]) {
    const h = harness(component);
    Object.assign(h.props.palette, { onAccent: '#FFF8EE', controlSurface: '#F3E9DE', danger: '#A32035' });
    h.render();
    assert.equal(h.find(label).solidTextColor, '#FFF8EE');
    if (component === 'RemainingLanding') {
      assert.equal(h.find('JOIN WITH CODE').outlineBackgroundColor, '#F3E9DE');
      h.props.presentation = 'illustrated'; h.render();
      const button = h.nodes().find(node => node.props.label === label);
      const rendered = button.type(button.props);
      const text = h.nodes(rendered).find(node => node.type === 'Text');
      assert.equal(text.props.style.color, '#FFF8EE');
    }
    if (component === 'RemainingLobby') {
      assert.equal(h.find('HOW TO PLAY').outlineBackgroundColor, '#F3E9DE');
      assert.equal(h.nodes().find(node => node.props.palette?.errorColor).props.palette.errorColor, '#A32035');
      h.store.room = null; h.render();
      const recovery = h.nodes().find(node => node.props.message?.startsWith('Finding your'));
      assert.equal(recovery.props.solidTextColor, '#FFF8EE');
      assert.equal(recovery.props.outlineBackgroundColor, '#F3E9DE');
    }
  }
});

for (const component of ['RemainingLanding', 'RemainingJoin']) {
  const action = component === 'RemainingLanding' ? 'CREATE ROOM' : 'JOIN GAME';
  const apiMethod = component === 'RemainingLanding' ? 'createRoom' : 'joinRoom';
  const prepare = (h) => { h.fill('Your name', '  Tester  '); if (component === 'RemainingJoin') h.fill('Room code', '7KPM-R4TX'); };

  for (const platform of ['ios', 'android']) {
    test(component + ' handles ' + platform + ' keyboard insets without changing web defaults', () => {
      const h = harness(component, { platform });
      const scroll = h.nodes().find((node) => node.type === 'ScrollView').props;
      assert.equal(scroll.automaticallyAdjustKeyboardInsets, platform === 'ios' ? true : undefined);
      assert.equal(scroll.keyboardDismissMode, platform === 'ios' ? 'interactive' : undefined);
      assert.equal(scroll.keyboardShouldPersistTaps, 'handled');
    });
  }

  test(component + ' fences duplicate submission and preserves exact passwords', async () => {
    const pending = deferred();
    const h = harness(component, { [apiMethod]: () => pending.promise, saveDisplayName: async () => { throw new Error('Optional cache unavailable'); } });
    prepare(h);
    h.fill('Room password, optional', ' secret ');
    h.find(action).onPress();
    h.find('Room password, optional').onSubmitEditing();
    assert.equal(h.count(apiMethod), 1);
    const call = h.calls.find((entry) => entry[0] === apiMethod);
    assert.equal(call[component === 'RemainingLanding' ? 2 : 3], ' secret ');
    pending.resolve(h.response);
    await h.flush();
    assert.equal(h.count('setAuth'), 1);
    assert.equal(h.count(component === 'RemainingLanding' ? 'push' : 'replace'), 1);
    assert.equal(h.count('leaveRoom'), 0);
  });

  test(component + ' does not overwrite edited names or animate with reduced motion', async () => {
    const pending = deferred();
    const h = harness(component, { loadDisplayName: () => pending.promise });
    h.fill('Your name', 'Current name');
    pending.resolve('Old saved name');
    await h.flush();
    assert.equal(h.find('Your name').value, 'Current name');
    for (const node of h.nodes().filter((node) => node.type === 'Animated.View')) assert.equal(node.props.entering, undefined);
  });

  test(component + ' releases unadopted seats when secure storage fails', async () => {
    const h = harness(component, { saveAuth: async () => { throw new Error('Storage denied'); } });
    prepare(h);
    h.find(action).onPress();
    await h.flush();
    assert.equal(h.count('leaveRoom'), 1);
    assert.equal(h.count('setAuth'), 0);
    assert.equal(h.find(action).disabled, false);
    assert(h.nodes().some((node) => node.props?.accessibilityRole === 'alert' && node.props.children === 'Storage denied'));
  });

  test(component + ' ignores late HTTP results after unmount and releases the seat', async () => {
    const pending = deferred();
    const h = harness(component, { [apiMethod]: () => pending.promise });
    prepare(h);
    h.find(action).onPress();
    h.unmount();
    pending.resolve(h.response);
    await h.flush();
    assert.equal(h.count('leaveRoom'), 1);
    assert.equal(h.count('saveAuth'), 0);
    assert.equal(h.count('push') + h.count('replace'), 0);
    assert.equal(h.lateWrites(), 0);
  });

  test(component + ' cancels a native auth write after leaving the route', async () => {
    const pending = deferred();
    const h = harness(component, { saveAuth: () => pending.promise });
    prepare(h);
    h.find(action).onPress();
    await h.flush();
    assert.equal(h.count('saveAuth'), 1);
    h.blur();
    pending.resolve();
    await h.flush();
    assert.equal(h.count('setAuth'), 0);
    assert.equal(h.count('clearAuthIfMatches'), 1);
    assert.equal(h.count('leaveRoom'), 1);
    assert.equal(h.count('push') + h.count('replace'), 0);
    assert.equal(h.lateWrites(), 0);
  });
}

test('landing permits joining without creating a name and keyboard validation focuses the name', async () => {
  const h = harness('RemainingLanding');
  h.find('JOIN WITH CODE').onPress();
  assert.equal(h.count('push', '/bang/join'), 1);
  h.find('CREATE ROOM').onPress();
  await h.flush();
  assert.equal(h.count('focus', 'Your name'), 1);
  h.find('Your name').onSubmitEditing();
  assert.equal(h.count('focus', 'Room password, optional'), 1);
});

test('join validates room codes, supports keyboard order and routes to the actual game', async () => {
  const h = harness('RemainingJoin');
  h.fill('Your name', 'Tester');
  h.find('JOIN GAME').onPress();
  await h.flush();
  assert.equal(h.count('focus', 'Room code'), 1);
  assert.equal(h.count('joinRoom'), 0);
  h.find('Room code').onSubmitEditing();
  assert.equal(h.count('focus', 'Room password, optional'), 1);
  h.fill('Room code', '7KPM-R4TX');
  h.response.room.gameId = 'colt_express';
  h.find('JOIN GAME').onPress();
  await h.flush();
  assert.equal(h.count('replace', '/colt-express/lobby'), 1);
});

async function syncedLobby(overrides) {
  const h = harness('RemainingLobby', overrides);
  h.emitEvent('room_updated', h.store.room);
  await h.flush();
  return h;
}

test('lobby waits for a fresh room snapshot and fences duplicate starts', async () => {
  const h = harness('RemainingLobby');
  h.find('START GAME').onPress();
  assert.equal(h.count('emit', 'start_game'), 0);
  h.emitEvent('room_updated', h.store.room);
  await h.flush();
  const start = h.find('START GAME').onPress;
  start(); start();
  assert.equal(h.count('emit', 'start_game'), 1);
  h.expireTimers();
  await h.flush();
  assert(h.count('emit', 'request_state') >= 2);
  assert.equal(h.find('START GAME').disabled, true);
  h.emitEvent('room_updated', h.store.room);
  await h.flush();
  assert.equal(h.find('START GAME').disabled, false);
});

test('lobby cannot start while a leave confirmation is open', async () => {
  const h = await syncedLobby();
  h.find('LEAVE ROOM').onPress();
  h.find('START GAME').onPress();
  assert.equal(h.count('emit', 'start_game'), 0);
  h.confirm('STAY');
  h.find('START GAME').onPress();
  assert.equal(h.count('emit', 'start_game'), 1);
});

test('lobby preserves the selected game start payload and locks its options while starting', async () => {
  const h = await syncedLobby();
  h.props.startPayload = { boardFace: 'alternating' };
  h.props.renderStartOptions = (disabled) => ({ type: 'BoardPicker', props: { disabled } });
  h.render();
  assert.equal(h.nodes().find((node) => node.type === 'BoardPicker').props.disabled, false);
  h.find('START GAME').onPress();
  await h.flush();
  assert.deepEqual(h.calls.find((call) => call[0] === 'emit' && call[1] === 'start_game'), ['emit', 'start_game', { boardFace: 'alternating' }]);
  assert.equal(h.nodes().find((node) => node.type === 'BoardPicker').props.disabled, true);
});

test('lobby game options are host-only and unavailable without a fresh connection', async () => {
  const h = await syncedLobby();
  h.props.renderStartOptions = (disabled) => ({ type: 'BoardPicker', props: { disabled } });
  h.socket.disconnect();
  await h.flush();
  assert.equal(h.nodes().find((node) => node.type === 'BoardPicker').props.disabled, true);
  h.store.playerId = 'p1';
  h.render();
  assert.equal(h.nodes().some((node) => node.type === 'BoardPicker'), false);
});

test('lobby role labels preserve host and connection information', async () => {
  const h = await syncedLobby();
  h.props.seatRoleLabel = (seat) => seat.isHost ? 'CREATURE' : 'HUNTED';
  h.render();
  const text = h.nodes().filter((node) => node.type === 'Text').map((node) => node.props.children);
  assert(text.includes('CREATURE · HOST · CONNECTED'));
  assert(text.includes('HUNTED · CONNECTED'));
});

test('lobby without game options retains its original empty start command', async () => {
  const h = await syncedLobby();
  h.find('START GAME').onPress();
  assert.deepEqual(h.calls.find((call) => call[0] === 'emit' && call[1] === 'start_game'), ['emit', 'start_game']);
});

test('lobby ignores malformed rejections and room snapshots without losing its start fence', async () => {
  const h = await syncedLobby();
  h.find('START GAME').onPress();
  for (const payload of [null, undefined, [], 'bad', { reason: 12 }, { reason: '' }]) {
    assert.doesNotThrow(() => h.emitEvent('action_rejected', payload));
    assert.doesNotThrow(() => h.emitEvent('room_updated', payload));
  }
  h.find('START GAME').onPress();
  assert.equal(h.count('emit', 'start_game'), 1);
});

test('retired lobby callbacks and controls cannot affect a replacement authenticated seat', async () => {
  const h = await syncedLobby();
  const start = h.find('START GAME').onPress;
  h.store.token = 'new-session';
  h.emitEvent('action_rejected', { reason: 'Old socket failure' });
  start();
  await h.flush();
  assert.equal(h.count('emit', 'start_game'), 0);
  assert.equal(h.nodes().some((node) => node.props?.children === 'Old socket failure'), false);
});

test('an old lobby start timeout cannot refresh a replacement session', async () => {
  const h = await syncedLobby();
  h.find('START GAME').onPress();
  const refreshes = h.count('emit', 'request_state');
  h.store.token = 'new-session';
  h.expireTimers();
  assert.equal(h.count('emit', 'request_state'), refreshes);
});

test('lobby blocks starting while any seat is reconnecting and lets host remove it', async () => {
  const pending = deferred();
  const h = await syncedLobby({ kickPlayer: () => pending.promise });
  h.store.room.players[3].isConnected = false;
  h.render();
  assert.equal(h.find('WAITING FOR RECONNECTION').disabled, true);
  h.find('WAITING FOR RECONNECTION').onPress();
  assert.equal(h.count('emit', 'start_game'), 0);
  h.find('Remove Player 3').onPress();
  h.confirm('REMOVE'); h.confirm('REMOVE');
  assert.equal(h.count('kickPlayer'), 1);
  pending.resolve();
  await h.flush();
});

test('lobby retries failed credential cleanup before clearing state or navigating', async () => {
  let attempts = 0;
  const h = await syncedLobby({ clearAuthIfMatches: async () => { if (++attempts === 1) throw new Error('Storage blocked'); } });
  h.find('LEAVE ROOM').onPress();
  assert.equal(h.count('leaveRoom'), 0);
  h.confirm('LEAVE'); h.confirm('LEAVE');
  await h.flush();
  assert.equal(h.count('leaveRoom'), 1);
  assert.equal(h.count('clearAll'), 0);
  assert.equal(h.count('replace'), 0);
  h.find('RETRY LEAVING').onPress();
  await h.flush();
  assert.equal(h.count('leaveRoom'), 1);
  assert.equal(h.count('clearAll'), 1);
  assert.equal(h.count('replace', '/'), 1);
  assert(h.calls.findIndex((call) => call[0] === 'clearAuthIfMatches') < h.calls.findIndex((call) => call[0] === 'clearAll'));
});

test('native lobby back closes rules first and allows intentional game navigation', async () => {
  const h = await syncedLobby({ platform: 'ios' });
  h.find('HOW TO PLAY').onPress();
  await h.flush();
  assert.equal(h.nativeBack(), true);
  await h.flush();
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.nativeBack(), true);
  assert.equal(h.dialogs.at(-1)[0], 'Leave room?');
  h.confirm('STAY');
  h.store.room.status = 'in_game';
  h.props.gameReady = true;
  h.render();
  await h.flush();
  assert.equal(h.count('replace', '/bang/game'), 1);
  assert.equal(h.nativeBack(), false);
});

test('native lobby registers native-stack prevention and releases it only for approved navigation', async () => {
  const pending = deferred();
  const h = await syncedLobby({ platform: 'ios', clearAuthIfMatches: () => pending.promise });
  assert.equal(h.nativePrevented(), true);
  h.nativeBack(); h.confirm('LEAVE'); await h.flush();
  assert.equal(h.nativePrevented(), true, 'storage cleanup must not release the native screen');
  assert.equal(h.count('replace'), 0);
  pending.resolve(); await h.flush();
  assert.equal(h.nativePrevented(), false);
  assert.equal(h.count('blockedReplace'), 0);
  assert.equal(h.count('replace', '/'), 1);
});

test('native lobby failed cleanup stays guarded and a successful retry navigates once', async () => {
  let fail = true;
  const h = await syncedLobby({ platform: 'android', clearAuthIfMatches: async () => { if (fail) throw new Error('Storage locked'); } });
  h.nativeBack(); h.confirm('LEAVE'); await h.flush();
  assert.equal(h.nativePrevented(), true); assert.equal(h.count('replace'), 0);
  fail = false; h.find('RETRY LEAVING').onPress(); await h.flush();
  assert.equal(h.count('leaveRoom'), 1); assert.equal(h.count('replace', '/'), 1);
  assert.equal(h.count('blockedReplace'), 0);
});

test('native lobby recovers to arcade after session expiry without trapping router replacement', async () => {
  const h = await syncedLobby({ platform: 'ios' });
  h.store.token = null; h.store.room = null; h.render(); await h.flush();
  assert.equal(h.nativePrevented(), false); assert.equal(h.count('replace', '/'), 1);
  assert.equal(h.count('blockedReplace'), 0);
});

test('native queued lobby transition is cancelled when its authenticated identity is replaced', async () => {
  const h = await syncedLobby({ platform: 'ios' });
  h.store.room = { ...h.store.room, status: 'in_game' }; h.props.gameReady = true; h.render();
  h.store.token = 'replacement'; h.props.gameReady = false; h.render(); await h.flush();
  assert.equal(h.nativePrevented(), true); assert.equal(h.count('replace'), 0);
  h.props.gameReady = true; h.render(); await h.flush();
  assert.equal(h.count('replace', '/bang/game'), 1);
});

test('lobby removes its stale leave prompt when another player starts', async () => {
  const h = await syncedLobby();
  h.find('LEAVE ROOM').onPress();
  const staleLeave = h.activeDialog().buttons.find((button) => button.text === 'LEAVE').onPress;
  h.store.room = { ...h.store.room, status: 'in_game' };
  h.props.gameReady = true;
  h.render();
  assert.equal(h.activeDialog(), null);
  staleLeave();
  await h.flush();
  assert.equal(h.count('leaveRoom'), 0);
  assert.equal(h.count('clearAuthIfMatches'), 0);
});

test('an old lobby leave response cannot disconnect or clear a replacement session', async () => {
  const pending = deferred();
  const h = await syncedLobby({ leaveRoom: () => pending.promise });
  h.find('LEAVE ROOM').onPress();
  h.confirm('LEAVE');
  h.store.token = 'replacement-token';
  pending.resolve();
  await h.flush();
  assert.equal(h.count('disconnect'), 0);
  assert.equal(h.count('clearAuthIfMatches'), 0);
  assert.equal(h.count('clearAll'), 0);
  assert.equal(h.count('replace'), 0);
});

test('an old lobby removal failure cannot write into a replacement session', async () => {
  const pending = deferred();
  const h = await syncedLobby({ kickPlayer: () => pending.promise });
  h.find('Remove Player 3').onPress();
  h.confirm('REMOVE');
  h.store.token = 'replacement-token';
  pending.reject(new Error('Old room removal failed'));
  await h.flush();
  assert.equal(h.nodes().some((node) => node.props?.children === 'Old room removal failed'), false);
  assert.equal(h.store.token, 'replacement-token');
});
