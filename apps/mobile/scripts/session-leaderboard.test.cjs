const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, modules, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, ...globals, require: (name) => {
    assert(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  } }, { filename });
  return exports;
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
class ApiError extends Error { constructor(status, code) { super(`HTTP ${status}`); this.status = status; this.code = code; } }
const auth = { token: 'synthetic-token', playerId: 'player', roomCode: 'TEST-ROOM', displayName: 'Player' };
const liveRoom = { players: [{ playerId: auth.playerId, hasLeft: false }], gameId: 'not_alone', status: 'in_game' };

function harness(relative, overrides = {}) {
  const hooks = [];
  const effects = [];
  const calls = [];
  const store = { ...auth, room: null };
  let cursor = 0;
  let dirty = false;
  let mounted = true;
  let tree;
  let lateWrites = 0;
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
    useCallback(fn, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps };
      return hooks[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (same(hooks[index]?.deps, deps)) return;
      effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    },
  };
  function useGameStore(selector) { return selector(store); }
  useGameStore.getState = () => ({
    ...store,
    setRoom: (room) => { calls.push('setRoom'); store.room = room; dirty = true; },
    clearAll: () => { calls.push('clearAll'); Object.assign(store, { token: null, playerId: null, roomCode: null, room: null }); dirty = true; },
  });
  const animation = { duration: () => animation, delay: () => animation, springify: () => animation, damping: () => animation };
  const modules = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { ...Object.fromEntries(['FlatList', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'View'].map((name) => [name, name])), Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 1280, fontScale: 1 }) },
    'react-native-reanimated': { default: { View: 'Animated.View' }, FadeIn: animation, FadeInDown: animation, FadeInUp: animation },
    'expo-router': { router: { push: () => {} } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../store/useGameStore': { useGameStore },
    '../../lib/gameRoutes': load('lib/gameRoutes.ts', {}),
    '../../lib/api': {
      ApiError,
      getRoom: async (...args) => { calls.push('getRoom'); return overrides.getRoom ? overrides.getRoom(...args) : liveRoom; },
      getLeaderboard: async (...args) => { calls.push('getLeaderboard'); return overrides.getLeaderboard ? overrides.getLeaderboard(...args) : []; },
    },
    '../../lib/tokenUtils': { isTokenExpired: () => overrides.expired ?? false },
    '../../lib/storage': {
      clearAuth: async () => { calls.push('clearAuth'); await overrides.clearAuth?.(); },
      clearAuthIfMatches: async (token) => { assert.equal(token, auth.token); calls.push('clearAuth'); await overrides.clearAuth?.(); },
    },
    '../../components/ui/GameTile': { GameTile: 'GameTile' },
    ...Object.fromEntries(['saboteur', 'coup', 'tokyo', 'skull', 'citadels', 'not-alone', 'bang', 'libertalia', 'colt', 'feed-the-kraken', 'telestrations', 'cartographers-heroes', 'dixit-odyssey'].map((game, index) => [`../../assets/game-art/${game}-cover.webp`, index + 1])),
    '../../components/ui/ScalePressable': { ScalePressable: 'ScalePressable' },
    '../../components/ui/NeonButton': { NeonButton: 'NeonButton' },
    '../../components/king-of-tokyo/TokyoArtwork': {},
    '../../components/skull-king/SkullKingArtwork': {},
    '../../components/citadels/CitadelsArtwork': {},
    '../../components/not-alone/NotAloneArtwork': {},
    '../../components/remaining/RemainingArtwork': {},
    '../../constants/theme': Object.fromEntries(['ARCADE', 'BANG', 'CARTOGRAPHERS', 'CITADELS', 'COLT', 'COUP', 'DIXIT', 'KRAKEN', 'LIBERTALIA', 'MINE', 'NOT_ALONE', 'SKULL_KING', 'TELESTRATIONS', 'TOKYO'].map((key) => [key, {}]).concat([['neonText', () => ({})]])),
  };
  const Component = load(relative, modules).default;
  const render = () => {
    cursor = 0;
    dirty = false;
    tree = Component();
    while (effects.length) effects.shift()();
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      await settle();
      if (!dirty) return;
      render();
    }
    assert.fail('Hook harness did not settle');
  };
  const nodes = (node = tree) => {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children, node.props?.ListEmptyComponent].flat(Infinity)
      .filter((child) => child && typeof child === 'object').flatMap((child) => nodes(child))];
  };
  render();
  return {
    calls, store, render, flush,
    button: (label) => nodes().find((node) => node.props?.label === label),
    alert: () => nodes().find((node) => node.props?.accessibilityRole === 'alert'),
    list: () => nodes().find((node) => node.type === 'FlatList'),
    tabs: () => nodes().filter((node) => node.type === 'Pressable'),
    library: () => nodes().find((node) => node.props?.nativeID === 'arcade-game-library'),
    gameTiles: () => nodes().filter((node) => node.type === 'GameTile'),
    text: () => nodes().filter((node) => node.type === 'Text').map((node) => node.props.children).flat(Infinity).join(' '),
    chooseTab: (index) => nodes().filter((node) => node.type === 'Pressable')[index].props.onPress(),
    unmount: () => { mounted = false; hooks.forEach((hook) => hook?.cleanup?.()); },
    lateWrites: () => lateWrites,
  };
}

const hub = 'app/(arcade)/index.tsx';
const leaderboard = 'app/(arcade)/leaderboard.tsx';

test('actual ended-session cleanup cannot delete a replacement queued into real auth storage', async () => {
  const filename = path.join(__dirname, '..', hub);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'discardEndedSession') callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(callback);
  for (const platform of ['web', 'ios', 'android']) {
    const writing = deferred();
    let persisted = JSON.stringify({ token: 'synthetic-old' });
    let memoryToken = 'synthetic-old';
    let writesStarted = 0;
    let clearAllCalls = 0;
    const storage = load('lib/storage.ts', {
      '@react-native-async-storage/async-storage': {},
      'expo-secure-store': {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
        getItemAsync: async () => persisted,
        setItemAsync: async (_key, value) => { writesStarted++; await writing.promise; persisted = value; },
        deleteItemAsync: async () => { persisted = null; },
      },
      'react-native': { Platform: { OS: platform } },
      '@zuychin-arcade/types': { ROOM_CODE_PATTERN: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/ },
    }, { sessionStorage: {
      getItem: () => persisted,
      setItem: (_key, value) => { writesStarted++; persisted = value; },
      removeItem: () => { persisted = null; },
    } });
    const cleanup = vm.runInNewContext(`(${callback})`, {
      token: 'synthetic-old', isCurrent: () => memoryToken === 'synthetic-old',
      clearAuth: storage.clearAuth, clearAuthIfMatches: storage.clearAuthIfMatches,
      setRestoreError() {}, setRestoring() {},
      useGameStore: { getState: () => ({ clearAll() { clearAllCalls++; memoryToken = null; } }) },
    });
    const saving = storage.saveAuth({ token: 'synthetic-new', playerId: 'new-player', roomCode: 'NEXT-ROOM', displayName: 'New' });
    await Promise.resolve();
    assert.equal(writesStarted, 1);
    const cleaning = cleanup();
    writing.resolve();
    await saving;
    memoryToken = 'synthetic-new';
    await cleaning;
    assert.equal(memoryToken, 'synthetic-new');
    assert.equal(JSON.parse(persisted ?? 'null')?.token, 'synthetic-new', `${platform}: replacement persisted auth must survive`);
    assert.equal(clearAllCalls, 0);
  }
});

test('hub library uses its available width for one, two or three unclamped columns', async () => {
  const ui = harness(hub);
  await ui.flush();
  assert(ui.library());
  const titles = ui.gameTiles().map(tile => tile.props.title);
  assert.deepEqual(titles, ['SABOTEUR', 'COUP', 'KING OF TOKYO', 'SKULL KING', 'CITADELS', 'NOT ALONE', 'BANG!', 'LIBERTALIA', 'COLT EXPRESS', 'FEED THE KRAKEN', 'TELESTRATIONS', 'CARTOGRAPHERS HEROES', 'DIXIT ODYSSEY']);
  for (const [width, columns] of [[280, 1], [728, 2], [980, 3], [280, 1]]) {
    ui.library().props.onLayout({ nativeEvent: { layout: { width } } });
    await ui.flush();
    const expectedWidth = Math.floor((width - 14 * (columns - 1)) / columns);
    assert(ui.gameTiles().every(tile => Math.abs(tile.props.width - expectedWidth) < 0.01));
    assert.deepEqual(ui.gameTiles().map(tile => tile.props.title), titles);
  }
  assert.equal(ui.calls.filter(call => call === 'getRoom').length, 1);
  ui.unmount();
});

test('hub preserves credentials on network, rate-limit and server failures, then permits retry', async () => {
  for (const failure of [new Error('Offline'), new ApiError(429), new ApiError(500), new ApiError(503)]) {
    let unavailable = true;
    const ui = harness(hub, { getRoom: async () => { if (unavailable) throw failure; return liveRoom; } });
    await ui.flush();
    assert.deepEqual(ui.calls, ['getRoom']);
    assert.equal(ui.store.token, auth.token);
    assert.match(ui.alert().props.children, /saved seat is still/);
    unavailable = false;
    ui.button('RETRY SESSION').props.onPress();
    await ui.flush();
    assert.deepEqual(ui.calls, ['getRoom', 'getRoom', 'setRoom']);
    assert.equal(ui.alert(), undefined);
    ui.unmount();
  }
});

test('hub clears only confirmed unauthorised, missing, expired or absent-player sessions', async () => {
  const scenarios = [
    ...[401, 403, 404].map((status) => ({ getRoom: async () => { throw new ApiError(status); } })),
    { expired: true },
    { getRoom: async () => ({ ...liveRoom, players: [] }) },
    { getRoom: async () => ({ ...liveRoom, players: [{ playerId: auth.playerId, hasLeft: true }] }) },
  ];
  for (const scenario of scenarios) {
    const ui = harness(hub, scenario);
    await ui.flush();
    assert.deepEqual(ui.calls.slice(-2), ['clearAuth', 'clearAll']);
    assert.equal(ui.store.token, null);
    ui.unmount();
  }
});

test('hub awaits native deletion and exposes a retry after deletion failure', async () => {
  const deletion = deferred();
  let attempts = 0;
  const ui = harness(hub, { expired: true, clearAuth: () => ++attempts === 1 ? deletion.promise : Promise.resolve() });
  await ui.flush();
  assert.deepEqual(ui.calls, ['clearAuth']);
  assert.equal(ui.store.token, auth.token);
  deletion.reject(new Error('SecureStore unavailable'));
  await ui.flush();
  assert.match(ui.alert().props.children, /could not be cleared/);
  ui.button('RETRY SESSION').props.onPress();
  ui.button('RETRY SESSION').props.onPress();
  await ui.flush();
  assert.deepEqual(ui.calls, ['clearAuth', 'clearAuth', 'clearAll']);
  ui.unmount();
});

test('hub ignores late failure after unmount or replacement by a newer session', async () => {
  for (const unmount of [true, false]) {
    const lookup = deferred();
    let signal;
    const ui = harness(hub, { getRoom: (...args) => { signal = args[2]; return lookup.promise; } });
    if (unmount) { ui.unmount(); assert(signal.aborted); }
    else ui.store.token = 'newer-session-token';
    lookup.reject(new ApiError(404));
    await settle();
    assert.deepEqual(ui.calls, ['getRoom']);
    assert.equal(ui.lateWrites(), 0);
    if (!unmount) ui.unmount();
  }
});

test('leaderboard distinguishes an unavailable service from an empty successful board', async () => {
  let unavailable = true;
  const ui = harness(leaderboard, { getLeaderboard: async () => { if (unavailable) throw new ApiError(503); return []; } });
  assert.match(ui.text(), /Loading scores/);
  await ui.flush();
  assert.match(ui.alert().props.children, /Scores are unavailable/);
  assert(!ui.text().includes('No games recorded'));
  unavailable = false;
  ui.button('RETRY SCORES').props.onPress();
  await ui.flush();
  assert.equal(ui.alert(), undefined);
  assert.match(ui.text(), /No games recorded/);
  ui.unmount();
});

test('disabled rankings show only the public administrator notice and recover when enabled', async () => {
  let configured = false;
  const ui = harness(leaderboard, { getLeaderboard: async () => {
    if (!configured) throw new ApiError(503, 'RANKINGS_DISABLED');
    return [];
  } });
  await ui.flush();
  assert.match(ui.text(), /Rankings disabled/);
  assert.match(ui.text(), /Rankings are currently disabled by the administrator\./);
  assert.match(ui.text(), /still create rooms and play/);
  assert(!/No games recorded|Check your connection|database|storage|configur|supabase/i.test(ui.text()));
  assert.equal(ui.alert(), undefined);
  configured = true;
  ui.button('CHECK STATUS').props.onPress();
  await ui.flush();
  assert.match(ui.text(), /No games recorded/);
  assert(!ui.text().includes('disabled by the administrator'));
  ui.unmount();
});

test('leaderboard aborts old tab requests and ignores out-of-order completions', async () => {
  const first = deferred();
  const second = deferred();
  const signals = [];
  const ui = harness(leaderboard, { getLeaderboard: (game, signal) => { signals.push(signal); return game === 'saboteur' ? first.promise : second.promise; } });
  ui.chooseTab(1);
  ui.render();
  assert(signals[0].aborted);
  second.resolve([{ display_name: 'Coup player', games_played: 1, total_nuggets: 0, wins: 1 }]);
  await ui.flush();
  first.resolve([{ display_name: 'Old Saboteur player', games_played: 1, total_nuggets: 8, wins: 0 }]);
  await ui.flush();
  assert.equal(ui.list().props.data[0].display_name, 'Coup player');
  ui.unmount();
});

test('leaderboard refresh cannot duplicate requests or leave updates after unmount', async () => {
  const refresh = deferred();
  let attempts = 0;
  let signal;
  const ui = harness(leaderboard, { getLeaderboard: (_game, nextSignal) => { signal = nextSignal; return ++attempts === 1 ? Promise.resolve([]) : refresh.promise; } });
  await ui.flush();
  const retry = ui.button('REFRESH SCORES').props.onPress;
  retry(); retry();
  assert.equal(attempts, 2);
  ui.unmount();
  assert(signal.aborted);
  refresh.resolve([]);
  await settle();
  assert.equal(ui.lateWrites(), 0);
});

test('all thirteen leaderboard games request their exact IDs and expose the correct selected metric', async () => {
  const requested = [];
  const ui = harness(leaderboard, { getLeaderboard: async game => { requested.push(game); return []; } });
  const expectedIds = ['saboteur', 'coup', 'king_of_tokyo', 'skull_king', 'citadels', 'not_alone', 'bang', 'libertalia', 'colt_express', 'feed_the_kraken', 'telestrations', 'cartographers_heroes', 'dixit_odyssey'];
  const expectedMetrics = ['nuggets', 'wins', 'wins', 'points', 'points', 'wins', 'wins', 'points', 'loot', 'wins', 'points', 'points', 'points'];
  assert.equal(ui.tabs().length, expectedIds.length);
  for (let index = 0; index < expectedMetrics.length; index++) {
    await ui.flush();
    ui.chooseTab(index);
    ui.render();
    await ui.flush();
    const tab = ui.tabs()[index];
    assert.equal(tab.props['aria-pressed'], true);
    assert.equal(ui.tabs().filter((button) => button.props['aria-pressed']).length, 1);
    assert(ui.text().includes(`all-time  ${tab.props.accessibilityLabel}   ${expectedMetrics[index]}`));
    assert.equal(tab.props.style.minHeight, 44);
    assert.equal(requested.at(-1), expectedIds[index]);
  }
  assert.deepEqual(requested, expectedIds);
  ui.unmount();
});

function api(fetch, timerOverrides = {}) {
  return load('lib/api.ts', { '../constants/config': { SERVER_URL: 'https://api.example.test' } }, { fetch, setTimeout, clearTimeout, ...timerOverrides });
}

test('API retains HTTP status separately from messages and propagates successful bodies', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    const client = api(async () => ({ ok: false, status, json: async () => ({ message: 'Request unavailable' }) }));
    await assert.rejects(client.getRoom('TEST-ROOM', 'synthetic-token'), (error) => error instanceof client.ApiError && error.status === status && error.message === 'Request unavailable');
  }
  const client = api(async () => ({ ok: true, json: async () => liveRoom }));
  assert.equal(await client.getRoom('TEST-ROOM', 'synthetic-token'), liveRoom);
});

test('API carries the public disabled status without treating all failures as disabled', async () => {
  const client = api(async () => ({ ok: false, status: 503, json: async () => ({ code: 'RANKINGS_DISABLED', message: 'Rankings are currently disabled by the administrator.' }) }));
  await assert.rejects(client.getLeaderboard('coup'), error => error instanceof client.ApiError && error.code === 'RANKINGS_DISABLED' && error.status === 503);
  const malformed = api(async () => ({ ok: false, status: 503, json: async () => ({ code: { private: true } }) }));
  await assert.rejects(malformed.getLeaderboard('coup'), error => error.code === undefined);
});

test('API keeps network errors non-authoritative and forwards caller cancellation', async () => {
  const networkError = new Error('Offline');
  const offline = api(async () => { throw networkError; });
  await assert.rejects(offline.getRoom('TEST-ROOM', 'synthetic-token'), (error) => error === networkError);
  const controller = new AbortController();
  let downstream;
  const client = api((_url, { signal }) => new Promise((_resolve, reject) => {
    downstream = signal;
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  const pending = client.getLeaderboard('coup', controller.signal);
  controller.abort();
  assert(downstream.aborted);
  await assert.rejects(pending, /Aborted/);
});

test('API request timeout remains readable without masquerading as an invalid session', async () => {
  let timeout;
  const client = api((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }), { setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout: () => {} });
  const pending = client.getRoom('TEST-ROOM', 'synthetic-token');
  timeout();
  await assert.rejects(pending, (error) => !(error instanceof client.ApiError) && /too long to respond/.test(error.message));
});
