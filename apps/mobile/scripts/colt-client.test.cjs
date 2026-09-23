const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');


function load(file, modules, globals = {}) {
  modules = { '@zuychin-arcade/types': {}, ...modules };
  const filename = path.join(__dirname, '../components/colt/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', coltPublic: null, coltPrivate: null, coltSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setColtSyncing(value) { store.coltSyncing = value; dirty = true; } });
  const { useColtActions: renderHook } = load('useColtActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'colt_express', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.coltPublic = snapshot(revision); store.coltPrivate = snapshot(revision, true); store.coltSyncing = false; event('game_state', store.coltPublic); event('private_state', store.coltPrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('choose', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'colt:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('colt:action_accepted', { action: 'choose', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('choose', {}, 'Resolve choice', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('choose', {}, 'Resolve choice', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('program', { cardId: 'x' }, 'Program card', 1), true);
  assert.equal(send('program', { cardId: 'x' }, 'Program card', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'colt:program').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('program', {}, 'Program card', 1); h.flush();
  h.event('colt:action_accepted', { action: 'choose', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('program', { cardIndex: 1 }, 'Program card', 1);
  h.event('colt:action_accepted', { action: 'program', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Program card accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.coltSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('choose', {}, 'Resolve choice', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('choose', {}, 'Resolve choice', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('choose', {}, 'Resolve choice', 3), false);
  h.store.token = 'synthetic-session'; h.store.coltPrivate.playerId = 'other';
  assert.equal(oldSend('choose', {}, 'Resolve choice', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('program', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('program', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('choose', {}, 'Resolve choice', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose', {}, 'Resolve choice', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.coltSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('program', { cardIndex: 0 }, 'Program card', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('program', { cardIndex: 0 }, 'Program card', 1), false);
  h.pair(1); assert.equal(h.actions.send('program', { cardIndex: 0 }, 'Program card', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose', {}, 'Resolve choice', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('choose', {}, 'Resolve choice', 1), false);
  h.pair(2); assert.equal(h.actions.send('choose', {}, 'Resolve choice', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('colt:action_accepted', { action: 'start', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('colt:action_accepted', { action: 'start', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});



test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.coltPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('program', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('program', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('program', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'colt:program');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.coltSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.coltPublic = h.snapshot(5); h.store.coltPrivate = h.snapshot(5, true); h.store.coltSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('program', { action: 'income' }, 'Income', 5), true);
});

test('server settlement can advance the pair beyond my accepted command', () => {
  const h = actionHarness(); h.pair(0);
  h.actions.send('choose', { choice: 'gold' }, 'Take gold', 0); h.flush();
  h.pair(1); assert.equal(h.actions.pending, true);
  h.event('colt:action_accepted', { action: 'choose', revision: 2 });
  h.pair(3); assert.equal(h.actions.pending, false);
});

function attentionHarness() {
  const hooks = [], frames = new Map();
  let cursor = 0, frameId = 0, calls = 0, ready = true;
  const focus = () => { calls++; return ready; };
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (hooks[index]?.deps.every((value, at) => Object.is(value, deps[at]))) return;
      hooks[index]?.cleanup?.();
      hooks[index] = { deps, cleanup: fn() };
    },
  };
  const { useColtDecisionAttention: renderAttention } = load('useColtDecisionAttention.ts', { react }, {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const screenCalls = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8').split(/\r?\n/).filter(line => line.trim().startsWith('useColtDecisionAttention(')).join('\n');
  const screen = { useColtDecisionAttention: renderAttention, focusDecision: focus };
  vm.runInNewContext(`globalThis.render = (decisionKey, coverShoot, blocked) => { const actions = { busy: blocked }; const rules = false, dialogOpen = false, leaving = false; ${screenCalls} };`, screen);
  return {
    render(key, blocked = false) { cursor = 0; renderAttention(key, blocked, focus); },
    renderScreen(key, coverShoot, blocked = false) { cursor = 0; screen.render(key, coverShoot, blocked); },
    flush() { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } },
    setReady(value) { ready = value; },
    get calls() { return calls; },
  };
}

test('rulebook close and unrelated revision do not refocus a serviced decision', () => {
  const h = attentionHarness();
  h.render('bid:1'); h.flush(); assert.equal(h.calls, 1);
  h.render('bid:1', true); h.render('bid:1'); h.flush();
  h.render('bid:1'); h.flush(); assert.equal(h.calls, 1);
});

test('new mandatory decision waits for enabled controls and focuses once', () => {
  const h = attentionHarness();
  h.render('bid:2'); h.flush();
  h.render('play:2:1', true); h.flush(); assert.equal(h.calls, 1);
  h.render('play:2:1'); h.flush(); assert.equal(h.calls, 2);
  h.render('play:2:1', true); h.render('play:2:1'); h.flush(); assert.equal(h.calls, 2);
  h.render(null); h.render('play:2:1'); h.flush(); assert.equal(h.calls, 3);
});

test('actual screen attention preserves the program decision across local Cover Cancel', () => {
  const h = attentionHarness();
  h.renderScreen('program:1', null); h.flush(); assert.equal(h.calls, 1);
  h.renderScreen('program:1', 'shoot-card'); h.flush(); assert.equal(h.calls, 2);
  h.renderScreen('program:1', null); h.flush();
  assert.equal(h.calls, 2, 'Cancel opener restoration must not compete with a new heading-focus frame');
  h.renderScreen('program:2', null); h.flush(); assert.equal(h.calls, 3, 'A genuine next programming action still gains focus');
});


const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function leaveHarness(platform = 'ios', overrides = {}) {
  const hooks = [], effects = [], layouts = [], calls = [], frames = [];
  let cursor = 0, dirty = false, prevented = false, nativeAttempt, androidBack, webBack, result, dialog = null;
  const store = { token: 'first', room: { roomCode: 'LOCAL', players: [] }, playerId: 'p1', coltPublic: { status: 'playing', revision: 1 }, coltPrivate: null };
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const effect = (queue, fn, deps) => {
    const index = cursor++;
    if (!same(hooks[index]?.deps, deps)) queue.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, value => {
        const next = typeof value === 'function' ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useMemo(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn(), deps }; return hooks[index].value; },
    useEffect(fn, deps) { effect(effects, fn, deps); },
    useLayoutEffect(fn, deps) { effect(layouts, fn, deps); },
  };
  const useGameStore = selector => selector(store);
  useGameStore.getState = () => ({ ...store, clearAll() { calls.push(['clearAll']); store.token = null; store.room = null; dirty = true; } });
  const socket = { disconnect: () => calls.push(['disconnect']) };
  const globals = {
    ...react, Platform: { OS: platform }, useGameStore, findNodeHandle: node => node?.handle, AccessibilityInfo: { setAccessibilityFocus: node => calls.push(['native-focus', node]) },
    useColtActions: () => ({}), useColtDecisionAttention() {}, useWebModalFocus() {}, coltDecisionKey: (game, mine) => overrides.decisionKey?.(game, mine) ?? null, coltLeaveMessage: () => 'Forfeit', isColtLeavePromptCurrent: load('decision.ts', {}).isColtLeavePromptCurrent,
    useWindowDimensions: () => ({ height: 800 }), usePrivateMapNotice: () => [store.peekMessage, () => { calls.push(['dismissPeek']); store.peekMessage = null; }],
    getSocket: () => socket, useNavigation: () => ({ addListener: (_, fn) => { nativeAttempt = () => fn({ preventDefault() {} }); return () => {}; } }),
    useWebBackGuard: (_, callback) => { webBack = callback; },
    BackHandler: { addEventListener: (_, callback) => { androidBack = callback; return { remove() {} }; } },
    useDialogStore: Object.assign(selector => selector({ dialog }), { getState: () => ({ dialog, hide() { calls.push(['hide']); dialog = null; } }) }),
    showDialog: (...args) => { calls.push(['dialog', ...args]); dialog = { title: args[0], buttons: args[2] }; },
    leaveRoom: async (...args) => { calls.push(['leave', ...args]); return overrides.leave?.(...args); },
    clearAuthIfMatches: async (...args) => { calls.push(['storage', ...args]); return overrides.storage?.(...args); },
    router: { replace: route => calls.push(['replace', route, prevented]) },
    setTimeout, clearTimeout, requestAnimationFrame: fn => frames.push(fn),
    document: { getElementById: id => ({ scrollIntoView() { calls.push(['scroll', id]); }, focus() { calls.push(['focus', id]); }, querySelector: () => ({ scrollIntoView() { calls.push(['scroll', id]); }, focus() { calls.push(['focus', id]); } }) }) },
  };
  const modules = { react, 'react-native': { Platform: globals.Platform }, 'expo-router/react-navigation': {
    usePreventRemove(value, callback) { nativeAttempt = callback; react.useEffect(() => { prevented = value; }, [value]); },
  } };
  const guard = fs.readFileSync(path.join(__dirname, '../hooks/useNativeLeaveGuard.ts'), 'utf8');
  const guardExports = {};
  vm.runInNewContext(ts.transpileModule(guard, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: guardExports, require: name => modules[name] });
  globals.useNativeLeaveGuard = guardExports.useNativeLeaveGuard;
  const source = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
  const start = source.indexOf('{', source.indexOf('export default function')) + 1;
  const stop = source.indexOf('  if (!game || !mine)');
  assert(stop > start);
  const expose = 'leave, back: handleBack, setRules, setCoverShoot, cancelCover, leavingRef, requestLeave, sessionCleared, startNewRoom, jumpToCards, scroll, reserveY, cardsY, handY, programY, reserveHeading, handHeading, programHeading';
  const code = `globalThis.render = function() { ${source.slice(start, stop)} return { ${expose} }; }`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
  const commit = () => {
    while (layouts.length) layouts.shift()();
    while (effects.length) effects.shift()();
  };
  const render = (commitEffects = true) => {
    cursor = 0; dirty = false; result = globals.render();
    if (commitEffects) commit();
  };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled component'); };
  flush();
  return { calls, store, flush, renderOnce: render, commit, get api() { return result; }, get prevented() { return prevented; },
    flushFrames() { while (frames.length) frames.shift()(); },
    get leaving() { return result.leavingRef.current; },
    back() { if (platform === 'web') webBack(); else if (platform === 'android') androidBack(); else nativeAttempt(); },
    setDialog(value) { dialog = value; }, get dialog() { return dialog; },
    replace() { store.token = 'second'; store.room = { roomCode: 'NEXT', players: [] }; flush(); },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
  };
}

test('actual Cover Cancel restores its rendered card only in the same owned programming decision', () => {
  const h = leaveHarness('web', { decisionKey: (game, mine) => `${game.roomCode}:${mine?.playerId}:${game.programmingActionNumber}` });
  h.store.coltPrivate = { canProgram: true, playerId: 'p1', hand: [] }; h.store.coltPublic.programmingActionNumber = 1; h.store.coltPublic.roomCode = 'LOCAL'; h.flush();
  h.api.setCoverShoot('shot'); h.flush(); h.api.cancelCover(); h.store.coltPublic = { ...h.store.coltPublic, revision: 2 }; h.flush(); h.flushFrames();
  assert.deepEqual(h.calls.filter(c => c[0] === 'focus'), [['focus', 'colt-hand-shot']]);
  h.api.setCoverShoot('shot'); h.flush(); h.api.cancelCover();
  h.store.coltPublic = { ...h.store.coltPublic, programmingActionNumber: 2 }; h.flush(); h.flushFrames();
  assert.equal(h.calls.filter(c => c[0] === 'focus').length, 1, 'A later programming action must not receive stale opener focus');
  h.api.setCoverShoot('shot'); h.flush(); h.api.cancelCover(); h.store.coltPrivate = { ...h.store.coltPrivate, playerId: 'replacement' }; h.flush(); h.flushFrames();
  assert.equal(h.calls.filter(c => c[0] === 'focus').length, 1, 'A replacement private identity must not receive old focus');
  h.api.setCoverShoot('shot'); h.flush(); h.api.cancelCover(); h.replace(); h.flushFrames();
  assert.equal(h.calls.filter(c => c[0] === 'focus').length, 1, 'A replacement session must not receive old focus');
});

test('actual card shortcuts scroll and focus only the owned web or native destination', () => {
  const web = leaveHarness('web');
  web.api.jumpToCards('hand');
  assert.deepEqual(web.calls.filter(c => c[0] === 'focus'), [['focus', 'colt-hand']]);
  const retired = web.api.jumpToCards; web.replace(); retired('program');
  assert.equal(web.calls.filter(c => c[0] === 'focus').length, 1);
  const native = leaveHarness('ios');
  native.api.scroll.current = { scrollTo: options => native.calls.push(['native-scroll', options.y]) };
  native.api.reserveY.current = 500; native.api.cardsY.current = 900;
  native.api.handY.current = 0; native.api.programY.current = 320;
  native.api.reserveHeading.current = { handle: 10 }; native.api.handHeading.current = { handle: 11 }; native.api.programHeading.current = { handle: 12 };
  for (const section of ['reserve', 'hand', 'program']) native.api.jumpToCards(section);
  assert.deepEqual(native.calls.filter(c => c[0] === 'native-scroll'), [['native-scroll', 500], ['native-scroll', 900], ['native-scroll', 1220]]);
  assert.deepEqual(native.calls.filter(c => c[0] === 'native-focus'), [['native-focus', 10], ['native-focus', 11], ['native-focus', 12]]);
});

test('actual leave holds native prevention across REST/storage and rejects duplicates', async () => {
  const rest = deferred(), storage = deferred();
  const h = leaveHarness('ios', { leave: () => rest.promise, storage: () => storage.promise });
  const first = h.api.leave(); await h.api.leave();
  assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1);
  assert.equal(h.prevented, true);
  rest.resolve(); await tick(); assert.equal(h.calls.filter(c => c[0] === 'storage').length, 1);
  assert.equal(h.calls.some(c => c[0] === 'replace'), false);
  storage.resolve(); await first; h.flush();
  assert.deepEqual(h.calls.filter(c => c[0] === 'replace'), [['replace', '/', false]]);
});

test('REST failure retries notification and storage failure retries only owned cleanup', async () => {
  let failures = 1, storageFailures = 1;
  const h = leaveHarness('ios', { leave: async () => { if (failures--) throw Error('network'); }, storage: async () => { if (storageFailures--) throw Error('storage'); } });
  await h.api.leave(); h.flush(); assert.equal(h.leaving, false);
  await h.api.leave(); h.flush(); assert.equal(h.leaving, false);
  await h.api.leave(); h.flush();
  assert.equal(h.calls.filter(c => c[0] === 'leave').length, 2);
  assert.equal(h.calls.filter(c => c[0] === 'storage').length, 2);
  assert.equal(h.calls.filter(c => c[0] === 'replace').length, 1);
});

test('old async cleanup and recovery callbacks cannot navigate a replacement identity', async () => {
  const storage = deferred(); const h = leaveHarness('ios', { storage: () => storage.promise });
  const recovery = h.api.sessionCleared;
  const task = h.api.leave('/colt-express'); await tick(); h.replace(); storage.resolve(); await task; h.flush();
  recovery(); h.flush();
  assert.equal(h.store.token, 'second'); assert.equal(h.leaving, false);
  assert.equal(h.calls.some(c => c[0] === 'replace' || c[0] === 'clearAll'), false);
});

test('retired REST success cannot suppress the replacement seat leave notification', async () => {
  const rest = deferred(); const h = leaveHarness('ios', { leave: (room) => room === 'LOCAL' ? rest.promise : undefined });
  const old = h.api.leave(); h.replace(); rest.resolve(); await old; h.flush();
  assert.equal(h.store.token, 'second');
  await h.api.leave(); h.flush();
  assert.deepEqual(h.calls.filter(c => c[0] === 'leave').map(c => c.slice(1)), [['LOCAL', 'first'], ['NEXT', 'second']]);
});

test('actual terminal Leave callback cannot leave a newly started rematch before effects flush', () => {
  const h = leaveHarness('web'); h.store.coltPublic = { status: 'game_over', revision: 100 }; h.flush();
  h.api.requestLeave(); const retained = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress;
  h.store.coltPublic = { status: 'playing', revision: 101 };
  retained(); assert.equal(h.calls.some(c => c[0] === 'leave'), false);
  h.flush(); assert.equal(h.dialog, null); retained();
  assert.equal(h.calls.some(c => c[0] === 'leave'), false);
});

test('live Leave remains valid across unrelated revisions and owned recovery approves home', async () => {
  const h = leaveHarness('ios'); h.api.requestLeave();
  const retained = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress;
  h.store.coltPublic = { status: 'playing', revision: 2 }; h.flush(); retained(); await tick(); h.flush();
  assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1);
  const recovery = leaveHarness('ios'); recovery.store.token = null; recovery.api.sessionCleared(); recovery.flush();
  assert.deepEqual(recovery.calls.filter(c => c[0] === 'replace'), [['replace', '/', false]]);
});

test('cancelled Leave callbacks cannot act later, even after another prompt opens', () => {
  const h = leaveHarness('web'); h.api.requestLeave();
  const old = h.dialog;
  old.buttons.find(b => b.text === 'STAY').onPress();
  old.buttons.find(b => b.text === 'LEAVE').onPress();
  assert.equal(h.calls.some(c => c[0] === 'leave'), false);
  h.api.requestLeave();
  old.buttons.find(b => b.text === 'LEAVE').onPress();
  assert.equal(h.calls.some(c => c[0] === 'leave'), false);
});

test('retained start-new-room result control cannot forfeit a rematch', () => {
  const h = leaveHarness('web'); h.store.coltPublic = { status: 'game_over', revision: 100 }; h.flush();
  const old = h.api.startNewRoom;
  h.store.coltPublic = { status: 'playing', revision: 101 };
  old(); assert.equal(h.calls.some(c => c[0] === 'leave'), false);
});
function component(file, props) {
  const jsx = (type, props) => ({ type, props });
const mod = load(file, { 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../ui/ScalePressable': { ScalePressable: 'Button' }, '../ui/CardSurface': { CardSurface: 'CardSurface' }, './ActionArtwork': { ActionArtwork: 'ActionArtwork', coltActionIcons: {} }, './TrainBoard': { BanditPiece: 'BanditPiece' }, './ColtCharacterArtwork': { ColtCharacterArtwork: 'Portrait' }, '../../constants/theme': { COLT: {} }, './decision': load('decision.ts', {}) });
  return Object.values(mod).find(value => typeof value === 'function')(props);
}
const descendants = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(5).flatMap(descendants)];
function renderResultCopy(game, roster = false) {
  const source = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
  const declarations = source.slice(source.indexOf('  const winnerNames ='), source.indexOf('  const inspectTrain ='));
  const start = source.indexOf(roster ? '<Section title="BANDIT ROSTER">' : '<Modal visible=');
  const closing = roster ? '</Section>' : '</Modal>';
  const element = source.slice(start, source.indexOf(closing, start) + closing.length);
  const code = ts.transpileModule(`export function render(game) { ${declarations} return (${element}); }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props }), exports = {};
  vm.runInNewContext(code, { exports, require: () => ({ jsx, jsxs: jsx }), Modal: 'Modal', View: 'View', Text: 'Text', ScrollView: 'Scroll', Section: 'Section', NeonButton: 'Button',
    gameOver: true, rules: false, dialogOpen: false, requestLeave() {}, C: {}, Platform: { OS: 'web' }, body: {}, secondary: {}, actions: {}, controllerMessage: null, error: '', isHost: false,
    rematchBlocked: null, locked: false, leaving: false, startNewRoom() {}, cleanupPending: false, playerId: 'one', room: { players: [] },
  });
  return exports.render(game);
}
const nodeText = node => Array.isArray(node) ? node.map(nodeText).join('') : node && typeof node === 'object' ? nodeText(node.props?.children) : node == null ? '' : String(node);
const resultCopyGame = { endReason: 'score', turnOrder: ['one', 'two'], players: [
  { playerId: 'one', displayName: 'First', finalScore: 500, lootValue: 500, receivedBullets: 1, bulletsFired: 1, lootCount: 1, forfeited: false },
  { playerId: 'two', displayName: 'Second', finalScore: 500, lootValue: 500, receivedBullets: 0, bulletsFired: 0, lootCount: 1, forfeited: false },
] };
test('actual results heading agrees with sole, shared and absent winners', () => {
  for (const [winnerPlayerIds, expected] of [[['one'], 'First wins'], [['one', 'two'], 'First, Second win'], [[], 'No winner']]) {
    const heading = descendants(renderResultCopy({ ...resultCopyGame, winnerPlayerIds })).find(n => n.props.accessibilityRole === 'header');
    assert.equal(nodeText(heading), expected);
  }
});
test('actual result and roster text use singular bullet only for one', () => {
  const game = { ...resultCopyGame, winnerPlayerIds: ['one'] };
  for (const roster of [false, true]) {
    const text = nodeText(renderResultCopy(game, roster));
    assert.match(text, /1 bullet received/); assert.match(text, /0 bullets received/);
    assert.doesNotMatch(text, /1 bullets received/);
    const multiple = nodeText(renderResultCopy({ ...game, players: game.players.map(p => ({ ...p, receivedBullets: 2 })) }, roster));
    assert.match(multiple, /2 bullets received/);
  }
});
function trainBoard(game) {
  return trainBoardHarness().render(game);
}
function trainBoardHarness() {
  const jsx = (type, props) => ({ type, props });
  const hooks = []; let cursor = 0, fontScale = 1;
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useState(value) { const index = cursor++; hooks[index] ??= { value }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
  };
  const { TrainBoard } = load('TrainBoard.tsx', {
    react,
    '../../hooks/useIntrinsicCardHeight': load('../../hooks/useIntrinsicCardHeight.ts', { react }),
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', ScrollView: 'Scroll', useWindowDimensions: () => ({ fontScale }) },
    '@zuychin-arcade/types': { COLT_CHARACTERS: { ghost: { name: 'Ghost' }, doc: { name: 'Doc' } } },
    '../ui/NeonButton': { NeonButton: 'Button' }, './TrainArtwork': { TrainArtwork: 'TrainArtwork' }, '../../constants/theme': { COLT: {} }, './decision': load('decision.ts', {}),
  });
  return { render(game, scale = 1) { cursor = 0; fontScale = scale; return TrainBoard({ game, playerId: 'one' }); } };
}
const unplacedTrain = players => ({ status: 'game_over', phase: 'game_over', trainCars: 3, marshalCar: 2, turnOrder: players.map(p => p.playerId), players, lootBySpace: {} });
test('train roof dividers share intrinsic heights, shrink, and reject stale width, scale and content measurements', () => {
  const h = trainBoardHarness(); let game = unplacedTrain([]);
  const roofs = tree => descendants(tree).filter(node => /colt-space-\d+-roof/.test(node.props.testID));
  const measure = (roof, height) => roof.props.children.props.onLayout({ nativeEvent: { layout: { height } } });
  let tree = h.render(game);
  const stale = roofs(tree)[0];
  measure(stale, 240); tree = h.render(game);
  assert(roofs(tree).every(node => node.props.style.minHeight === 245));
  measure(roofs(tree)[0], 140); tree = h.render(game);
  assert(roofs(tree).every(node => node.props.style.minHeight === 145));
  for (const change of ['width', 'scale', 'content']) {
    const old = roofs(tree)[0];
    if (change === 'width') descendants(tree).find(node => node.type === 'Scroll').props.onLayout({ nativeEvent: { layout: { width: 320 } } });
    if (change === 'content') game = { ...game, lootBySpace: { '1:roof': [{ type: 'purse', value: null }] } };
    tree = h.render(game, change === 'scale' ? 2 : 1);
    assert(roofs(tree).every(node => node.props.style.minHeight === 132));
    measure(old, 999);
    tree = h.render(game, change === 'scale' ? 2 : 1);
    assert(roofs(tree).every(node => node.props.style.minHeight === 132));
    for (const roof of roofs(tree)) {
      assert.equal(roof.props.style.height, undefined);
      assert.equal(roof.props.children.props.style.minHeight, undefined);
      assert.equal(roof.props.children.props.style.flexGrow, undefined);
    }
  }
  assert.match(JSON.stringify(tree), /hidden value/);
});
for (const winner of [true, false]) test(`train renders ${winner ? 'one-survivor' : 'no-winner'} setup terminal without inventing unchosen bandits`, () => {
  const players = ['one', 'two', 'three'].map((playerId, i) => ({ playerId, displayName: `Seat ${i}`, characters: [], characterChosen: false, setupComplete: false, positions: [{ carIndex: 0, level: 'inside' }], lootCounts: [1], forfeited: !winner || i !== 0 }));
  let tree;
  assert.doesNotThrow(() => { tree = trainBoard({ ...unplacedTrain(players), winnerPlayerIds: winner ? ['one'] : [] }); });
  const rendered = JSON.stringify(tree);
  assert.doesNotMatch(rendered, /Seat [012]|Ghost|Doc/);
});
test('train excludes selected but unplaced and malformed bodies while keeping placed round ghosts', () => {
  const player = { playerId: 'other', displayName: 'Visible ghost', characters: ['ghost'], characterChosen: true, setupComplete: true, positions: [{ carIndex: 0, level: 'inside' }], lootCounts: [1], forfeited: true };
  const players = [player, { ...player, playerId: 'unplaced', displayName: 'Hidden formation', setupComplete: false }, { ...player, playerId: 'unknown', displayName: 'Invalid character', characters: ['invalid'] }, { ...player, playerId: 'bad-position', displayName: 'Invalid position', positions: [null] }];
  const rendered = JSON.stringify(trainBoard(unplacedTrain(players)));
  assert.match(rendered, /Visible ghost/); assert.match(rendered, /Ghost/);
  assert.doesNotMatch(rendered, /Hidden formation|Invalid character|Invalid position/);
});
test('action cards expose action, bandit, timing and immediate versus configured submission', () => {
  const program = component('ActionCard.tsx', { action: 'move', owner: 'Ghost', disabled: false, onPress() {} });
  const button = descendants(program).find(node => node.type === 'Button');
  assert.match(button.props.accessibilityLabel, /Program move for Ghost.*At execution/);
  assert.match(button.props.accessibilityHint, /Submits this action now/);
  assert.equal(button.props.style.minHeight, 48); assert.equal(button.props.style.opacity, 1);
  const cover = descendants(component('ActionCard.tsx', { action: 'shoot', owner: 'Doc', configure: true, disabled: false, onPress() {} })).find(node => node.type === 'Button');
  assert.match(cover.props.accessibilityLabel, /Configure optional Cover for shoot for Doc/);
  assert.match(cover.props.accessibilityHint, /Nothing is submitted yet/);
  const bullet = descendants(component('ActionCard.tsx', { action: 'bullet', owner: 'Doc', disabled: true, onPress() {} })).find(node => node.type === 'Button');
  assert.equal(bullet.props.disabled, true); assert.match(bullet.props.accessibilityLabel, /cannot be programmed/);
});
test('reserve options are exactly authoritative, including a received bullet if offered', () => {
  const reserve = descendants(component('ActionCard.tsx', { action: 'bullet', owner: 'Ghost', mode: 'reserve', disabled: false, onPress() {} })).find(node => node.type === 'Button');
  assert.equal(reserve.props.disabled, false); assert.match(reserve.props.accessibilityHint, /private reserve/);
  const source = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
  assert.match(source, /<CardGrid items=\{mine.reserveOptions\} keyExtractor=\{card => card.id\}/); assert.match(source, /mode="reserve" disabled=\{locked\}/);
});
test('decision identity ignores unrelated public revision but recognises mandatory choice changes', () => {
  const { coltDecisionKey } = load('decision.ts', {});
  const game = { roomCode: 'R', status: 'playing', round: 1, slot: 1, revision: 1, executionIndex: 2 };
  const mine = { playerId: 'p', canProgram: true, programmedCardIds: [], hand: [{ id: 'a' }] };
  const key = coltDecisionKey(game, mine);
  assert.equal(coltDecisionKey({ ...game, revision: 5 }, mine), key);
  assert.notEqual(coltDecisionKey({ ...game, slot: 2 }, mine), key);
  const choice = { ...mine, canProgram: false, canChoose: true };
  assert.notEqual(coltDecisionKey({ ...game, pending: { action: 'punch', options: [{ id: 'target' }] } }, choice), coltDecisionKey({ ...game, pending: { action: 'punch', options: [{ id: 'direction' }] } }, choice));
  assert.equal(coltDecisionKey({ ...game, status: 'game_over' }, mine), null);
});
test('rules and turn helpers explain timing and approved committed-round departure', () => {
  const helpers = load('decision.ts', {});
  assert.equal(Object.keys(helpers.COLT_ACTION_HELP).length, 7);
  assert.equal(Object.keys(helpers.COLT_EVENT_HELP).length, 9);
  assert.match(helpers.COLT_TURN_HELP.speeding, /two consecutive/);
  assert.match(helpers.coltLeaveMessage(), /No new actions are programmed/);
  assert.match(helpers.coltLeaveMessage(), /already-programmed actions/);
  assert.match(helpers.coltLeaveMessage(), /before the next round/);
  const reference = fs.readFileSync(path.join(__dirname, '../components/colt/ReferenceSheet.tsx'), 'utf8');
  assert.match(reference, /digital rule/); assert.match(reference, /COLT_CHARACTERS/);
  assert.match(reference, /nobody in that group receives a bullet/);
  assert.match(helpers.COLT_EVENT_HELP.hostage_conductor, /inside or on the roof/);
});
test('train preserves public loot composition and hidden purse values with explicit browsing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/colt/TrainBoard.tsx'), 'utf8');
  assert.match(source, /PREVIOUS CAR/); assert.match(source, /NEXT CAR/);
  assert.match(source, /caboose to locomotive/); assert.match(source, /hidden value/);
  assert.match(source, /loot\.type/); assert.doesNotMatch(source, /fontSize: [789][, }]/);
});
test('lobby waits for atomic private/public readiness and header targets meet48 floor', () => {
  const lobby = fs.readFileSync(path.join(__dirname, '../app/colt-express/lobby.tsx'), 'utf8');
  assert.match(lobby, /s\.coltPublic&&!!s\.coltPrivate&&!s\.coltSyncing/);
  const game = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
  assert.match(game, /YOUR TURN TO PROGRAM/);
  assert.match(game, /Back to arcade[\s\S]*?minWidth: 48, minHeight: 48/);
  assert.match(game, /Open rulebook[\s\S]*?minWidth: 48, minHeight: 48/);
  assert.match(game, /SafeAreaView/);
  assert.doesNotMatch(game, /getSocket\(\)\?\.emit/);
});
test('Ghost optional concealment is explicit and cannot conceal a Cover pair', () => {
  const { coltProgramPayload } = load('decision.ts', {});
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(coltProgramPayload('shot', undefined, true, false)), { cardId: 'shot', faceDown: false });
  assert.deepEqual(plain(coltProgramPayload('shot', undefined, true, true)), { cardId: 'shot', faceDown: true });
  assert.deepEqual(plain(coltProgramPayload('shot', 'cover', true, true)), { cardId: 'shot', coverCardId: 'cover', faceDown: false });
  assert.deepEqual(plain(coltProgramPayload('shot', undefined, false, true)), { cardId: 'shot' });
});
test('speed-up second action gains a new attention identity even if drawing an empty deck', () => {
  const { coltDecisionKey } = load('decision.ts', {});
  const game = { roomCode: 'R', status: 'playing', round: 1, slot: 2, programmingActionNumber: 1 };
  const mine = { playerId: 'p', canProgram: true, programmedCardIds: [], hand: [] };
  assert.notEqual(coltDecisionKey(game, mine), coltDecisionKey({ ...game, programmingActionNumber: 2 }, mine));
});

test('character selection has its own stable attention key and leaves the team flow unchanged', () => {
  const { coltDecisionKey } = load('decision.ts', {});
  const game = { roomCode: 'R', status: 'playing', round: 1, phase: 'character_selection', revision: 1 };
  const mine = { playerId: 'p', canChooseCharacter: true };
  assert.match(coltDecisionKey(game, mine), /:character$/);
  assert.equal(coltDecisionKey({ ...game, revision: 2 }, mine), coltDecisionKey(game, mine));
  assert.match(coltDecisionKey(game, { playerId: 'p', canChooseTeam: true }), /:team$/);
});

test('character controls expose name, complete power and immediate choice at48px', () => {
  let called = 0;
  const button = descendants(component('CharacterChoice.tsx', { character: { name: 'Ghost', summary: 'May hide the first action.' }, disabled: false, onPress() { called++; } })).find(n => n.type === 'Button');
  assert.equal(button.props.accessibilityLabel, 'Choose Ghost. May hide the first action.');
  assert.match(button.props.accessibilityHint, /Confirms/);
  assert.equal(button.props.style.minHeight, 48); assert.equal(button.props.disabled, false);
  button.props.onPress(); assert.equal(called, 1);
  const disabled = descendants(component('CharacterChoice.tsx', { character: { name: 'Doc', summary: 'Draw seven cards.' }, disabled: true, onPress() {} })).find(n => n.type === 'Button');
  assert.equal(disabled.props.disabled, true); assert.equal(disabled.props.accessibilityState.disabled, true);
});

test('character setup distinguishes own choice from waiting after a public claim', () => {
  const { coltCharacterSetupMessage } = load('decision.ts', {});
  const game = { players: [{ displayName: 'You', characterChosen: true, forfeited: false }, { displayName: 'Other', characterChosen: false, forfeited: false }, { displayName: 'Departed', characterChosen: false, forfeited: true }] };
  assert.match(coltCharacterSetupMessage(game, { canChooseCharacter: true }), /Choose an available character/);
  assert.equal(coltCharacterSetupMessage(game, { canChooseCharacter: false }), 'Your character is confirmed. Waiting for Other to choose.');
  const source = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
  assert.match(source, /availableCharacters\.map/); assert.match(source, /sendAction\('choose-character', \{ character \}/);
  assert.match(source, /CHARACTER CLAIMS/); assert.match(source, /player\.characterChosen && player\.character/);
  const reference = fs.readFileSync(path.join(__dirname, '../components/colt/ReferenceSheet.tsx'), 'utf8');
  assert.doesNotMatch(reference, /assigns characters randomly/);
});

test('stale character selection refreshes without automatically resending the lost choice', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('choose-character', { character: 'ghost' }, 'Character choice', 0), true);
  assert.equal(h.calls.at(-1)[0], 'colt:choose-character');
  h.event('action_rejected', { reason: 'Game state changed. Please try again.' });
  assert.equal(h.actions.send('choose-character', { character: 'ghost' }, 'Character choice', 0), false);
  h.pair(1);
  assert.equal(h.calls.filter(c => c[0] === 'colt:choose-character').length, 1);
  assert.equal(h.actions.send('choose-character', { character: 'doc' }, 'Character choice', 1), true);
  h.event('colt:action_accepted', { action: 'choose-character', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, false);
});
