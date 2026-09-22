const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function setup(platform = 'web', visible = true) {
  const filename = path.join(__dirname, '../hooks/useWebModalFocus.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const listeners = new Map(), timers = new Map(), frames = new Map();
  const observers = [];
  let panelAvailable = true, focusReady = true, frameId = 0;
  const document = { activeElement: null };
  class Element {
    focus() { if (this !== first || focusReady) { document.activeElement = this; listeners.get('focusin')?.(); } }
  }
  const outside = new Element(), first = new Element(), last = new Element();
  document.body = new Element();
  let controls = [first, last];
  document.activeElement = outside;
  const panel = {
    querySelector: () => controls[0],
    querySelectorAll: () => Object.assign({ length: controls.length }, controls),
    contains: (element) => controls.includes(element),
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe(target, options) { assert.equal(target, panel); assert.equal(options.childList, true); this.connected = true; }
    disconnect() { this.connected = false; }
  }
  Object.assign(document, {
    getElementById: () => panelAvailable ? panel : null,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  });
  let effect, escaped = 0;
  const modules = {
    react: { useRef: (current) => ({ current }), useEffect: (callback) => { effect = callback; } },
    'react-native': { Platform: { OS: platform } },
  };
  const exports = {};
  const globals = platform === 'web' ? {
    document, HTMLElement: Element, MutationObserver,
    window: {
      setTimeout: (callback) => { timers.set(1, callback); return 1; },
      clearTimeout: (id) => timers.delete(id),
      requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame: id => frames.delete(id),
    },
  } : {};
  vm.runInNewContext(compiled, {
    exports, ...globals,
    require: (name) => { assert(name in modules, name); return modules[name]; },
  }, { filename });
  exports.useWebModalFocus(visible, 'test-panel', () => escaped++);
  const cleanup = effect();
  const key = (value, shiftKey = false) => {
    let prevented = false;
    listeners.get('keydown')?.({ key: value, shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { document, outside, first, last, timers, frames, listeners, observers, cleanup, key, escaped: () => escaped,
    setPanelAvailable(value) { panelAvailable = value; }, setFocusReady(value) { focusReady = value; },
    frame() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); },
    replaceControl(removed) {
      const replacement = new Element();
      controls = controls.map(control => control === removed ? replacement : control);
      if (document.activeElement === removed) document.activeElement = document.body;
      return replacement;
    },
    mutate() { for (const observer of observers) if (observer.connected) observer.callback(); },
  };
}

test('modal focus traps an array-like DOM collection and restores the invoking control', () => {
  const h = setup();
  h.timers.get(1)();
  assert.equal(h.document.activeElement, h.first);
  assert.equal(h.key('Tab', true), true);
  assert.equal(h.document.activeElement, h.last);
  assert.equal(h.key('Tab'), true);
  assert.equal(h.document.activeElement, h.first);
  h.outside.focus();
  assert.equal(h.key('Tab'), true);
  assert.equal(h.document.activeElement, h.first);
  assert.equal(h.key('Escape'), true);
  assert.equal(h.escaped(), 1);
  h.cleanup();
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test('hidden modal leaves browser focus and listeners untouched', () => {
  const h = setup('web', false);
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.cleanup, undefined);
});

for (const platform of ['ios', 'android']) {
  test(`${platform} modal focus does not access browser globals`, () => {
    const h = setup(platform);
    assert.equal(h.cleanup, undefined);
    assert.equal(h.listeners.size, 0);
  });
}

test('modal focus retries after its first control is no longer hidden by portal setup', () => {
  const h = setup(); h.setFocusReady(false);
  h.timers.get(1)();
  assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.frames.size, 1);
  h.setFocusReady(true); h.frame();
  assert.equal(h.document.activeElement, h.first);
  assert.equal(h.frames.size, 0);
  h.cleanup();
});

test('modal focus waits for a delayed panel without losing its opener', () => {
  const h = setup(); h.setPanelAvailable(false);
  h.timers.get(1)(); assert.equal(h.frames.size, 1);
  h.setPanelAvailable(true); h.frame();
  assert.equal(h.document.activeElement, h.first);
  h.cleanup(); assert.equal(h.document.activeElement, h.outside);
});

test('closing a not-yet-focusable modal cancels the pending retry', () => {
  const h = setup(); h.setFocusReady(false);
  h.timers.get(1)(); assert.equal(h.frames.size, 1);
  const retiredFrame = h.frames.values().next().value;
  h.cleanup();
  h.setFocusReady(true); retiredFrame();
  assert.equal(h.frames.size, 0);
  assert.equal(h.document.activeElement, h.outside);
});

test('a focus retry does not steal a user-selected control inside the modal', () => {
  const h = setup(); h.setFocusReady(false);
  h.timers.get(1)(); assert.equal(h.frames.size, 1);
  h.last.focus(); h.setFocusReady(true); h.frame();
  assert.equal(h.document.activeElement, h.last);
  assert.equal(h.frames.size, 0);
  h.cleanup();
});

test('removing the focused rematch control restores focus inside the still-open modal', () => {
  const h = setup(); h.timers.get(1)();
  const replacement = h.replaceControl(h.first);
  assert.equal(h.document.activeElement, h.document.body);
  h.mutate();
  assert.equal(h.frames.size, 1);
  h.frame();
  assert.equal(h.document.activeElement, replacement);
  h.cleanup();
});

test('removing a user-focused modal control also recovers, without stealing valid focus', () => {
  const h = setup(); h.timers.get(1)(); h.last.focus();
  h.mutate(); assert.equal(h.document.activeElement, h.last); assert.equal(h.frames.size, 0);
  h.replaceControl(h.last); h.mutate(); assert.equal(h.frames.size, 1);
  h.first.focus(); h.frame();
  assert.equal(h.document.activeElement, h.first);
  h.cleanup();
});

test('unrelated mutations or intentional external focus do not refocus the modal', () => {
  const h = setup(); h.timers.get(1)();
  h.mutate(); assert.equal(h.frames.size, 0);
  h.outside.focus(); h.replaceControl(h.first); h.mutate();
  assert.equal(h.frames.size, 0); assert.equal(h.document.activeElement, h.outside);
  h.cleanup();
});

test('closing cancels removal recovery and disconnects its observer', () => {
  const h = setup(); h.timers.get(1)(); h.replaceControl(h.first); h.mutate();
  assert.equal(h.frames.size, 1);
  const retiredFrame = h.frames.values().next().value;
  const retiredObserver = h.observers[0].callback;
  h.cleanup(); retiredFrame(); retiredObserver();
  assert.equal(h.frames.size, 0); assert.equal(h.document.activeElement, h.outside);
  assert(h.observers.every(observer => !observer.connected));
});

test('queued removal recovery rechecks intentional focus and coalesces mutations', () => {
  const h = setup(); h.timers.get(1)(); h.replaceControl(h.first);
  h.mutate(); h.mutate(); assert.equal(h.frames.size, 1);
  h.outside.focus(); h.frame();
  assert.equal(h.document.activeElement, h.outside); assert.equal(h.frames.size, 0);
  h.cleanup();
});

test('a retained control is not refocused just because the body has focus during unrelated changes', () => {
  const h = setup(); h.timers.get(1)();
  h.document.activeElement = h.document.body; h.mutate();
  assert.equal(h.frames.size, 0); assert.equal(h.document.activeElement, h.document.body);
  h.cleanup();
});
