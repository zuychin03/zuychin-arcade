const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function target() {
  const handlers = new Map();
  return { handlers, addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); }, removeEventListener(name, fn) { handlers.get(name)?.delete(fn); }, emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event); } };
}
function harness({ pathname = '/', state = {}, secure = true, dev = false } = {}) {
  const effects = [], cells = [], refs = [], timers = new Set(), subscriptions = new Set();
  let cursor = 0, refCursor = 0, mounted = false, reloads = 0;
  const root = { inert: false };
  const worker = { messages: [], postMessage(message) { this.messages.push(message); } };
  const reg = { ...target(), waiting: worker, installing: null, updates: 0, async update() { this.updates++; } };
  const sw = { ...target(), registrations: [], async register(...args) { this.registrations.push(args); return reg; } };
  const media = { ...target(), matches: false };
  const window = { ...target(), isSecureContext: secure, matchMedia: () => media, location: { pathname, reload: () => reloads++ } };
  const document = { ...target(), getElementById: () => root, visibilityState: 'visible' };
  const store = selector => selector(state);
  store.getState = () => state;
  store.subscribe = fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useEffect(fn) { if (!mounted) effects.push(fn); }, useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; }, useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Button', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { usePathname: () => window.location.pathname },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '../../constants/theme': { ARCADE: {} }, '../../store/useGameStore': { useGameStore: store },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../components/pwa/PwaControls.web.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; }, window, document, navigator: { serviceWorker: sw, userAgent: 'test', platform: 'test', maxTouchPoints: 0 }, crypto: { randomUUID: () => 'test-request-id' }, __DEV__: dev, setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) });
  const render = () => { cursor = 0; refCursor = 0; return exports.default(); };
  render(); mounted = true;
  const cleanups = effects.map(fn => fn());
  return { ...exports, root, worker, sw, reg, window, document, timers, subscriptions, render, reloads: () => reloads, state, cleanup: () => cleanups.forEach(fn => fn?.()), change(next) { Object.assign(state, next); subscriptions.forEach(fn => fn()); } };
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('installed update shows readiness before registration waiting is populated', async () => {
  const h = harness();
  h.reg.waiting = null;
  h.sw.controller = {};
  const installing = { ...target(), state: 'installing' };
  h.reg.installing = installing;
  await settle();
  assert(!nodes(h.render()).some(node => node.props?.children === 'Update Arcade'));
  installing.state = 'installed';
  installing.emit('statechange');
  assert(nodes(h.render()).some(node => node.props?.children === 'Update Arcade'));
  h.cleanup();
  assert.equal(installing.handlers.get('statechange').size, 0);
});

test('update safety requires exact library path and no token, room code or room', () => {
  const h = harness();
  for (const pathname of ['/auth', '/room/ABC', '/king-of-tokyo/game', '/?x=1']) assert.equal(h.isUpdateSafe(pathname, {}), false);
  assert.equal(h.isUpdateSafe('/', {}), true);
  for (const state of [{ token: 'fixture' }, { roomCode: 'FIXTURE' }, { room: {} }]) assert.equal(h.isUpdateSafe('/', state), false);
  h.cleanup();
});

test('production registration remains active on initial auth route and cleans all listeners', async () => {
  const h = harness({ pathname: '/auth' }); await settle();
  assert.equal(h.render(), null);
  assert.equal(h.sw.registrations.length, 1);
  assert.equal(h.sw.registrations[0][0], '/service-worker.js');
  assert.equal(h.sw.registrations[0][1].updateViaCache, 'none');
  h.cleanup();
  assert.equal(h.subscriptions.size, 0);
  for (const source of [h.window, h.document, h.sw, h.reg]) for (const listeners of source.handlers.values()) assert.equal(listeners.size, 0);
});

test('development and insecure contexts never register a worker', async () => {
  for (const options of [{ dev: true }, { secure: false }]) { const h = harness(options); await settle(); assert.equal(h.sw.registrations.length, 0); h.cleanup(); }
});

test('only known waiting worker can lock, and approval alone never reloads', async () => {
  const h = harness(); await settle();
  const message = (type, requestId = 'request-one', source = h.worker) => h.sw.emit('message', { data: { type, requestId }, source });
  message('CHECK_UPDATE_SAFETY', 'request-one', { postMessage() { throw new Error('untrusted'); } });
  assert.equal(h.root.inert, false);
  h.sw.emit('controllerchange'); assert.equal(h.reloads(), 0);
  message('CHECK_UPDATE_SAFETY'); assert.equal(h.root.inert, true);
  assert.equal(h.worker.messages.at(-1).safe, true);
  message('UPDATE_APPROVED', 'wrong-request'); h.sw.emit('controllerchange'); assert.equal(h.reloads(), 0);
  message('CHECK_UPDATE_SAFETY'); message('UPDATE_APPROVED'); assert.equal(h.reloads(), 0);
  h.sw.emit('controllerchange'); assert.equal(h.reloads(), 1);
  h.cleanup(); assert.equal(h.root.inert, false);
});

test('busy session, session changes and blocked updates fail closed', async () => {
  const h = harness({ state: { token: 'fixture-only' } }); await settle();
  const send = type => h.sw.emit('message', { data: { type, requestId: 'request-two' }, source: h.worker });
  send('CHECK_UPDATE_SAFETY'); assert.equal(h.worker.messages.at(-1).safe, false); assert.equal(h.root.inert, false);
  h.change({ token: null }); send('CHECK_UPDATE_SAFETY'); assert.equal(h.root.inert, true);
  h.change({ roomCode: 'FIXTURE' }); assert.equal(h.worker.messages.at(-1).safe, false); assert.equal(h.root.inert, false);
  h.change({ roomCode: null }); send('CHECK_UPDATE_SAFETY'); send('UPDATE_BLOCKED'); assert.equal(h.root.inert, false);
  assert(nodes(h.render()).some(node => String(node.props?.children).includes('Finish or leave')));
  h.cleanup();
});

test('update request requires user action and timeout restores interaction', async () => {
  const h = harness(); await settle();
  assert.equal(h.worker.messages.length, 0);
  const button = nodes(h.render()).find(node => node.type === 'Button' && nodes(node).some(child => child.props?.children === 'Update Arcade'));
  assert(button); button.props.onPress(); assert.equal(h.worker.messages.at(-1).type, 'REQUEST_UPDATE');
  h.sw.emit('message', { data: { type: 'CHECK_UPDATE_SAFETY', requestId: 'timeout-request' }, source: h.worker });
  for (const fn of [...h.timers]) fn();
  assert.equal(h.root.inert, false); assert.equal(h.worker.messages.at(-1).safe, false); assert.equal(h.reloads(), 0);
  h.cleanup();
});
