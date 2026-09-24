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
function harness({ pathname = '/', state = {}, secure = true, dev = false, sidebar = true, standalone = false, iosStandalone = false, promptSupported = false, installed = false, storageFails = false } = {}) {
  const effects = [], cells = [], refs = [], timers = new Set(), subscriptions = new Set();
  let cursor = 0, refCursor = 0, effectCursor = 0, dirty = false, reloads = 0;
  const root = { inert: false };
  let sidebarTarget = sidebar ? { id: 'pwa-sidebar-controls' } : null;
  const observers = new Set();
  const worker = { messages: [], postMessage(message) { this.messages.push(message); } };
  const reg = { ...target(), waiting: worker, installing: null, updates: 0, async update() { this.updates++; } };
  const sw = { ...target(), registrations: [], async register(...args) { this.registrations.push(args); return reg; } };
  const media = { ...target(), matches: standalone };
  const storage = new Map(installed ? [['arcade:pwa-installed', '1']] : []);
  const localStorage = { getItem(key) { if (storageFails) throw new Error('denied'); return storage.get(key) ?? null; }, setItem(key, value) { if (storageFails) throw new Error('denied'); storage.set(key, value); }, removeItem(key) { if (storageFails) throw new Error('denied'); storage.delete(key); } };
  const window = { ...target(), isSecureContext: secure, localStorage, matchMedia: () => media, location: { pathname, reload: () => reloads++ }, ...(promptSupported ? { onbeforeinstallprompt: null } : {}) };
  const document = { ...target(), body: {}, getElementById: id => id === 'root' ? root : sidebarTarget, visibilityState: 'visible' };
  const store = selector => selector(state);
  store.getState = () => state;
  store.subscribe = fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useEffect(fn, deps) { const i = effectCursor++; const prior = effects[i]; if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) effects[i] = { fn, deps, pending: true, cleanup: prior?.cleanup }; },
      useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { const next = typeof value === 'function' ? value(cells[i]) : value; if (!Object.is(cells[i], next)) { cells[i] = next; dirty = true; } }]; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-dom': { createPortal: (child, target) => ({ type: 'Portal', props: { children: child, target } }) },
    'react-native': { Pressable: 'Button', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { usePathname: () => window.location.pathname },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '../../constants/theme': { ARCADE: {} }, '../../store/useGameStore': { useGameStore: store },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../components/pwa/PwaControls.web.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; }, window, document,
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observers.add(this.fn); } disconnect() { observers.delete(this.fn); } },
    navigator: { serviceWorker: sw, standalone: iosStandalone, userAgent: 'test', platform: 'test', maxTouchPoints: 0 }, crypto: { randomUUID: () => 'test-request-id' }, __DEV__: dev, setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) });
  const render = () => {
    let result, renders = 0;
    do {
      assert(++renders < 20, 'Effects must settle');
      cursor = 0; refCursor = 0; effectCursor = 0; dirty = false;
      result = exports.default();
      for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.fn(); }
    } while (dirty);
    return result;
  };
  render();
  return { ...exports, root, worker, sw, reg, window, document, timers, subscriptions, observers, storage, media, render, reloads: () => reloads, state,
    sidebar(open) { sidebarTarget = open ? { id: 'pwa-sidebar-controls' } : null; observers.forEach(fn => fn()); },
    cleanup: () => effects.forEach(effect => effect.cleanup?.()), change(next) { Object.assign(state, next); subscriptions.forEach(fn => fn()); render(); } };
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const settle = () => new Promise(resolve => setImmediate(resolve));
const installButton = h => nodes(h.render()).find(node => node.type === 'Button' && nodes(node).some(child => /^(Install Arcade|Add Arcade to your device)$/.test(child.props?.children)));

test('standalone, iOS standalone and remembered installations hide install controls but retain updates', async () => {
  for (const options of [{ standalone: true }, { iosStandalone: true }, { installed: true }]) {
    const h = harness(options); await settle();
    assert.equal(installButton(h), undefined);
    assert(nodes(h.render()).some(node => node.props?.children === 'Update Arcade'));
    h.cleanup();
  }
});

test('prompt-capable browsers only advertise installation when the browser offers it', async () => {
  const h = harness({ promptSupported: true, installed: true }); await settle();
  assert.equal(installButton(h), undefined);
  h.window.emit('beforeinstallprompt', { preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert(installButton(h)); assert.equal(h.storage.has('arcade:pwa-installed'), false);
  installButton(h).props.onPress(); await settle();
  assert.equal(installButton(h), undefined); assert.equal(h.storage.get('arcade:pwa-installed'), '1');
  h.cleanup();
});

test('installation events hide help and persist across visits and other tabs', async () => {
  const h = harness(); await settle();
  installButton(h).props.onPress(); assert(nodes(h.render()).some(node => String(node.props?.children).includes('Open your browser')));
  h.window.emit('appinstalled'); assert.equal(installButton(h), undefined);
  assert(!nodes(h.render()).some(node => String(node.props?.children).includes('Open your browser')));
  h.media.emit('change'); assert.equal(installButton(h), undefined);
  assert.equal(h.storage.get('arcade:pwa-installed'), '1'); h.cleanup();
  const other = harness(); await settle();
  other.storage.set('arcade:pwa-installed', '1'); other.window.emit('storage', { key: 'arcade:pwa-installed' });
  assert.equal(installButton(other), undefined); other.cleanup();
});

test('failed prompts retain browser guidance, while dismissal does not mark installed', async () => {
  for (const failed of [true, false]) {
    const h = harness({ promptSupported: true }); await settle();
    h.window.emit('beforeinstallprompt', { preventDefault() {}, prompt: async () => { if (failed) throw new Error('unavailable'); }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    installButton(h).props.onPress(); await settle();
    assert.equal(h.storage.has('arcade:pwa-installed'), false);
    assert.equal(Boolean(installButton(h)), failed);
    assert.equal(nodes(h.render()).some(node => String(node.props?.children).includes('Open your browser')), failed);
    h.cleanup();
  }
});

test('storage failures do not break standalone or installation-event detection', async () => {
  for (const standalone of [true, false]) {
    const h = harness({ standalone, storageFails: true }); await settle();
    if (!standalone) { assert(installButton(h)); h.window.emit('appinstalled'); }
    assert.equal(installButton(h), undefined); h.cleanup();
  }
});

test('controls render only in the sidebar and survive drawer remounts without re-registering', async () => {
  const h = harness({ sidebar: false }); await settle();
  assert.equal(h.render(), null);
  assert.equal(h.sw.registrations.length, 1);
  h.sidebar(true);
  assert.equal(h.render().type, 'Portal');
  assert.equal(h.render().props.target.id, 'pwa-sidebar-controls');
  h.sidebar(false); assert.equal(h.render(), null);
  h.sidebar(true); assert.equal(h.render().type, 'Portal');
  assert.equal(h.sw.registrations.length, 1);
  h.cleanup(); assert.equal(h.observers.size, 0);
});

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
