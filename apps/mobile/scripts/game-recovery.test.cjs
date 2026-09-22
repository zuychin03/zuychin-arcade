const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../components/ui/GameRecovery.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(clearAuth) {
  const calls = [];
  const hooks = [];
  const effects = [];
  let hookIndex = 0;
  let onSessionCleared;
  const store = { token: 'original', clearAll() { calls.push('clearAll'); store.token = null; } };
  const useGameStore = (selector) => selector(store);
  useGameStore.getState = () => store;
  const socket = {
    connected: false,
    disconnect: () => calls.push('disconnect'),
    connect: () => calls.push('connect'),
    emit: (event) => calls.push(event),
  };
  const modules = {
    react: {
      useRef: (value) => hooks[hookIndex++] ?? (hooks[hookIndex - 1] = { current: value }),
      useState: (value) => {
        const index = hookIndex++;
        const state = hooks[index] ?? (hooks[index] = { value });
        return [state.value, (next) => { state.value = next; }];
      },
      useLayoutEffect(fn, deps) {
        const index = hookIndex++;
        if (!hooks[index]?.deps || deps.some((value, i) => value !== hooks[index].deps[i])) {
          effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
        }
      },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Text: 'Text', View: 'View' },
    'expo-router': { router: { replace: (route) => calls.push(`replace:${route}`), dismissAll: () => calls.push('dismissAll') } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../hooks/useSocket': { getSocket: () => socket },
    '../../lib/storage': {
      clearAuth: () => { calls.push('clearAuth'); return clearAuth(calls); },
      clearAuthIfMatches: (token) => { calls.push('clearAuth'); assert.equal(token, store.token); return clearAuth(calls); },
    },
    '../../store/useGameStore': { useGameStore },
    './NeonButton': { NeonButton: 'NeonButton' },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  } });
  const render = () => {
    hookIndex = 0;
    const tree = exports.GameRecovery({ message: 'Restoring the saved seat.', background: '#000', surface: '#111', border: '#333', accent: '#fff', muted: '#ccc', onSessionCleared });
    while (effects.length) effects.shift()();
    return tree;
  };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return null;
  };
  return { calls, render, socket, store, setOnSessionCleared(fn) { onSessionCleared = fn; }, unmount() { hooks.forEach(hook => hook.cleanup?.()); }, button: (label) => find(render(), (node) => node.type === 'NeonButton' && node.props.label === label), alert: () => find(render(), (node) => node.props.accessibilityRole === 'alert') };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('awaits asynchronous native-style deletion and blocks repeated exits before replacing the route', async () => {
  let resolveClear;
  const pending = new Promise((resolve) => { resolveClear = resolve; });
  const ui = harness(() => pending);
  const exit = ui.button('BACK TO ARCADE').props.onPress;
  exit();
  exit();
  ui.button('RETRY CONNECTION').props.onPress();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth']);
  assert.equal(ui.button('LEAVING…').props.disabled, true);
  assert.equal(ui.button('RETRY CONNECTION').props.disabled, true);
  resolveClear();
  await settle();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth', 'clearAll', 'replace:/']);
  assert(!ui.calls.includes('dismissAll'));
});

test('retains the recovery screen on deletion failure and permits a successful retry', async () => {
  let attempts = 0;
  const ui = harness(async () => {
    if (++attempts === 1) throw new Error('Secure storage unavailable');
  });
  ui.button('BACK TO ARCADE').props.onPress();
  await settle();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth']);
  assert.match(ui.alert().props.children, /saved session could not be cleared/);
  assert.equal(ui.button('BACK TO ARCADE').props.disabled, false);
  ui.button('BACK TO ARCADE').props.onPress();
  await settle();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth', 'disconnect', 'clearAuth', 'clearAll', 'replace:/']);
  assert.equal(ui.alert(), null);
});

test('retry reconnects an offline socket or refreshes an already connected one', () => {
  const ui = harness(async () => {});
  ui.button('RETRY CONNECTION').props.onPress();
  ui.socket.connected = true;
  ui.button('RETRY CONNECTION').props.onPress();
  assert.deepEqual(ui.calls, ['connect', 'request_state']);
});

for (const reject of [false, true]) test(`retired ${reject ? 'failed' : 'successful'} recovery cleanup cannot change a replacement session`, async () => {
  let finish, fail;
  const pending = new Promise((resolve, rejection) => { finish = resolve; fail = rejection; });
  let attempts = 0;
  const ui = harness(() => ++attempts === 1 ? pending : Promise.resolve());
  const oldExit = ui.button('BACK TO ARCADE').props.onPress;
  const oldRetry = ui.button('RETRY CONNECTION').props.onPress;
  oldExit();
  ui.store.token = 'replacement'; ui.render();
  const before = [...ui.calls];
  if (reject) fail(new Error('Old storage unavailable')); else finish();
  await settle();
  oldExit(); oldRetry(); await settle();
  assert.equal(ui.store.token, 'replacement');
  assert.deepEqual(ui.calls, before);
  assert.equal(ui.alert(), null);
  assert.equal(ui.button('BACK TO ARCADE').props.disabled, false);
  ui.button('BACK TO ARCADE').props.onPress(); await settle();
  assert.equal(ui.store.token, null);
  assert.equal(ui.calls.filter(value => value === 'replace:/').length, 1);
});

test('unmounted recovery callbacks and pending deletion cannot navigate or mutate the store', async () => {
  let finish;
  const ui = harness(() => new Promise(resolve => { finish = resolve; }));
  const exit = ui.button('BACK TO ARCADE').props.onPress;
  const retry = ui.button('RETRY CONNECTION').props.onPress;
  exit(); ui.unmount(); finish(); await settle(); exit(); retry();
  assert.equal(ui.store.token, 'original');
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth']);
});

test('recovery delegates its cleared session to the parent guard without a competing replacement', async () => {
  const ui = harness(async () => {});
  ui.setOnSessionCleared(() => { assert.equal(ui.store.token, null); ui.calls.push('parentApproval'); });
  ui.button('BACK TO ARCADE').props.onPress(); await settle();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAuth', 'clearAll', 'parentApproval']);
});

test('a missing in-memory identity cannot erase an unrelated persisted session', async () => {
  const ui = harness(async () => {});
  ui.store.token = null;
  ui.button('BACK TO ARCADE').props.onPress(); await settle();
  assert.deepEqual(ui.calls, ['disconnect', 'clearAll', 'replace:/']);
});
