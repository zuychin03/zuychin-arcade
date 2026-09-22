const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const READY = '__zuychinArcadeBackGuardReady';
const MARKER = '__zuychinArcadeBackGuard';
function load(relative, globals = {}, modules = {}) {
  const filename = path.join(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, URL, ...globals,
    require(name) { assert(name in modules, name); return modules[name]; },
  }, { filename });
  return exports;
}

function setup(platform = 'web') {
  const listeners = [], entries = [], frames = new Map();
  let nextFrame = 1;
  const browser = {
    location: { origin: 'https://arcade.test', pathname: '/saboteur' },
    history: {
      state: { id: 'landing' },
      pushState(state, _title, url) {
        this.state = state;
        browser.location.pathname = new URL(url, browser.location.origin).pathname;
        entries.push({ state, url });
      },
    },
    addEventListener(type, handler) { assert.equal(type, 'popstate'); listeners.push(handler); },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const dispatcher = load('../lib/webBackGuardDispatcher.ts', { window: browser });
  let routerEvents = 0;
  browser.addEventListener('popstate', () => { routerEvents++; });
  const cleanups = [];
  function mount(pathname, onBack, enabled = true) {
    let effect;
    const hook = load('../hooks/useWebBackGuard.ts', { window: browser }, {
      react: { useRef: (current) => ({ current }), useLayoutEffect: (callback) => { effect = callback; } },
      'react-native': { Platform: { OS: platform } },
      '../lib/webBackGuardDispatcher': dispatcher,
    });
    hook.useWebBackGuard(pathname, onBack, enabled);
    const cleanup = effect();
    cleanups.push(cleanup);
    return cleanup;
  }
  function frame() {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((callback) => callback());
  }
  function pop(state = { id: 'landing' }) {
    browser.history.state = state;
    browser.location.pathname = '/saboteur';
    let stopped = false;
    const event = { state, stopImmediatePropagation() { stopped = true; } };
    for (const listener of listeners) { listener(event); if (stopped) break; }
  }
  function commit() {
    browser.location.pathname = '/saboteur/lobby';
    browser.history.state = { id: 'lobby', opaque: 'keep' };
  }
  return { browser, dispatcher, entries, frames, frame, pop, mount, commit, listeners, cleanups, routerEvents: () => routerEvents };
}

test('custom entry installs the dispatcher before Expo Router', () => {
  const app = path.join(__dirname, '..');
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).main, 'index.js');
  const imports = [...fs.readFileSync(path.join(app, 'index.js'), 'utf8').matchAll(/import '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(imports, ['./lib/webBackGuardDispatcher', 'expo-router/entry']);
});

test('early dispatcher pre-empts an older screen-level router listener regardless of capture ordering', () => {
  const h = setup(); let backs = 0;
  h.mount('/saboteur/lobby', () => backs++);
  h.commit(); h.frame(); h.pop();
  assert.equal(backs, 1);
  assert.equal(h.routerEvents(), 0);
  assert.equal(h.browser.history.state.id, 'lobby');
  assert.equal(h.browser.history.state.opaque, 'keep');
  assert.equal(h.browser.location.pathname, '/saboteur/lobby');
});

test('arming waits for the router commit without overwriting the preceding landing entry', () => {
  const h = setup(); h.mount('/saboteur/lobby', () => {});
  h.frame();
  assert.equal(h.entries.length, 0);
  assert.equal(h.browser[READY], undefined);
  assert.equal(h.browser.history.state.id, 'landing');
  h.commit(); h.frame();
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].state.id, 'lobby');
  assert.equal(h.browser[READY], 'https://arcade.test/saboteur/lobby');
});

test('repeated Back attempts preserve the protected route and invoke its current confirmation', () => {
  const h = setup(); let backs = 0;
  h.mount('/saboteur/lobby', () => backs++); h.commit(); h.frame();
  h.pop(); h.pop(); h.pop();
  assert.equal(backs, 3);
  assert.equal(h.routerEvents(), 0);
  assert.equal(h.browser.history.state.id, 'lobby');
});

test('existing guarded entry is not duplicated when remounting', () => {
  const h = setup(); h.commit();
  h.browser.history.state[MARKER] = 'https://arcade.test/saboteur/lobby';
  h.mount('/saboteur/lobby', () => {}); h.frame();
  assert.equal(h.entries.length, 0);
});

test('cleanup releases ordinary browser navigation and cancels unarmed work', () => {
  const h = setup(); let backs = 0;
  const cleanup = h.mount('/saboteur/lobby', () => backs++);
  cleanup(); h.commit(); h.frame(); h.pop();
  assert.equal(h.entries.length, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.browser[READY], undefined);
  assert.equal(backs, 0);
  assert.equal(h.routerEvents(), 1);
});

test('an old cleanup cannot remove a replacement route guard', () => {
  const h = setup(); const backs = [];
  const oldCleanup = h.mount('/saboteur/lobby', () => backs.push('old'));
  h.commit(); h.frame();
  h.mount('/saboteur/lobby', () => backs.push('new')); h.frame();
  oldCleanup(); h.pop();
  assert.deepEqual(backs, ['new']);
  assert.equal(h.browser[READY], 'https://arcade.test/saboteur/lobby');
});

test('dispatcher module reload does not register competing global listeners', () => {
  const h = setup();
  load('../lib/webBackGuardDispatcher.ts', { window: h.browser });
  assert.equal(h.listeners.length, 2);
});

test('native, disabled and server-rendered contexts do not intercept navigation', () => {
  for (const platform of ['ios', 'android', 'web']) {
    const h = setup(platform);
    h.mount('/saboteur/lobby', () => assert.fail('Unexpected guard'), platform !== 'web');
    h.commit(); h.frame(); h.pop();
    assert.equal(h.routerEvents(), 1);
    assert.equal(h.frames.size, 0);
  }
  const server = load('../lib/webBackGuardDispatcher.ts');
  assert.equal(server.registerWebBackGuard(() => {})(), false);
  const native = load('../lib/webBackGuardDispatcher.ts', { window: {} });
  assert.equal(native.registerWebBackGuard(() => {})(), false);
});
