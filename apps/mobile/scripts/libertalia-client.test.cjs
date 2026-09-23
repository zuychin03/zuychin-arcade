const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const crewDefinitions = [];
crewDefinitions[23] = { name: 'Topman', rank: 24, phases: ['night'], summary: 'Gain 4, then lose 1 per character in your ship.' };
crewDefinitions[10] = { name: 'Carpenter', rank: 11, phases: ['daytime', 'anchor'], summary: 'Lose half your doubloons, rounded down; gain 10 at anchor.' };


function load(file, modules, globals = {}) {
  modules = { '@zuychin-arcade/types': { LIBERTALIA_CREW: crewDefinitions, LIBERTALIA_MIN_PLAYERS: 2 }, ...modules };
  const filename = path.join(__dirname, '../components/libertalia/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', libertaliaPublic: null, libertaliaPrivate: null, libertaliaSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setLibertaliaSyncing(value) { store.libertaliaSyncing = value; dirty = true; } });
  const { useLibertaliaActions: renderHook } = load('useLibertaliaActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'libertalia', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.libertaliaPublic = snapshot(revision); store.libertaliaPrivate = snapshot(revision, true); store.libertaliaSyncing = false; event('game_state', store.libertaliaPublic); event('private_state', store.libertaliaPrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('choice', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'libertalia:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('libertalia:action_accepted', { action: 'choice', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('choice', {}, 'Resolve choice', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('choice', {}, 'Resolve choice', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('select', { cardId: 'x' }, 'Lock crew', 1), true);
  assert.equal(send('select', { cardId: 'x' }, 'Lock crew', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'libertalia:select').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('select', {}, 'Lock crew', 1); h.flush();
  h.event('libertalia:action_accepted', { action: 'choice', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('select', { cardIndex: 1 }, 'Lock crew', 1);
  h.event('libertalia:action_accepted', { action: 'select', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Lock crew accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.libertaliaSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('choice', {}, 'Resolve choice', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('choice', {}, 'Resolve choice', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('choice', {}, 'Resolve choice', 3), false);
  h.store.token = 'synthetic-session'; h.store.libertaliaPrivate.playerId = 'other';
  assert.equal(oldSend('choice', {}, 'Resolve choice', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('select', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('select', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('choice', {}, 'Resolve choice', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choice', {}, 'Resolve choice', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.libertaliaSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('select', { cardIndex: 0 }, 'Lock crew', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('select', { cardIndex: 0 }, 'Lock crew', 1), false);
  h.pair(1); assert.equal(h.actions.send('select', { cardIndex: 0 }, 'Lock crew', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choice', {}, 'Resolve choice', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('choice', {}, 'Resolve choice', 1), false);
  h.pair(2); assert.equal(h.actions.send('choice', {}, 'Resolve choice', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('libertalia:action_accepted', { action: 'start', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('libertalia:action_accepted', { action: 'start', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});



test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.libertaliaPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('select', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('select', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('select', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'libertalia:select');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.libertaliaSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.libertaliaPublic = h.snapshot(5); h.store.libertaliaPrivate = h.snapshot(5, true); h.store.libertaliaSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('select', { action: 'income' }, 'Income', 5), true);
});

test('server settlement can advance the pair beyond my accepted command', () => {
  const h = actionHarness(); h.pair(0);
  h.actions.send('choice', { choice: 'gold' }, 'Take gold', 0); h.flush();
  h.pair(1); assert.equal(h.actions.pending, true);
  h.event('libertalia:action_accepted', { action: 'choice', revision: 2 });
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
  const { useLibertaliaDecisionAttention: renderAttention } = load('useLibertaliaDecisionAttention.ts', { react }, {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  return {
    render(key, blocked = false) { cursor = 0; renderAttention(key, blocked, focus); },
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


test('completed-voyage Leave callback cannot forfeit a rematch before or after effect cleanup', () => {
  const { isLibertaliaLeavePromptCurrent: current } = load('decision.ts', {});
  const captured = { status: 'game_over', revision: 195 };
  assert.equal(current(captured, captured, 1, 1), true);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 1), false);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 2), false);
  assert.equal(current(captured, { status: 'game_over', revision: 390 }, 1, 1), false);
  assert.equal(current(captured, null, 1, 1), false);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'playing', revision: 11 }, 1, 1), true);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'game_over', revision: 11 }, 1, 1), false);
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  assert.match(source, /epoch.current \+= 1/);
  assert.match(source, /\[game\?\.status, room\?\.roomCode, token, dismissPrompt\]/);
  assert.match(source, /!isLibertaliaLeavePromptCurrent\(captured/);
});

test('semantic decision identity survives other admirals selecting but changes for a new choice', () => {
  const { libertaliaDecisionKey: key } = load('decision.ts', {});
  const game = { status: 'playing', voyage: 1, day: 1, revision: 0 };
  const mine = { canSelect: true, pendingChoice: null };
  assert.equal(key(game, mine), key({ ...game, revision: 1 }, mine));
  assert.notEqual(key(game, mine), key({ ...game, day: 2 }, mine));
  assert.equal(key(game, { canSelect: false, pendingChoice: null }), null);
  assert.notEqual(key(game, { pendingChoice: { id: 1 } }), key(game, { pendingChoice: { id: 2 } }));
  assert.equal(key({ ...game, status: 'game_over' }, mine), null);
});

test('private crew has full readable effects and an explicit local-choice affordance', () => {
  let clicked = false;
  const definitions = [{ name: 'Cabin Boy', phases: ['daytime'], summary: 'A complete crew effect.' }];
  const card = crewCardForTest({ rank: 1, onPress: () => { clicked = true; }, selection: 'candidate' }, definitions);
  assert.equal(card.props.style.flexBasis, 250);
  assert.equal(card.props.style.minWidth, 'min-content');
  const button = crewButton(card);
  assert.equal(button.props.accessibilityState.selected, true);
  assert.match(button.props.accessibilityHint, /without sending/);
  assert.match(button.props.accessibilityLabel, /^Choose Cabin Boy, rank 1\. Timing: daytime\. A complete crew effect\./);
  const summary = crewNodes(card).find(node => node.type === 'Text' && node.props.children === definitions[0].summary);
  assert.equal(summary.props.style.fontSize, 15);
  assert.equal(summary.props.numberOfLines, undefined);
  button.props.onPress(); assert.equal(clicked, true);
  const disabled = crewCardForTest({ rank: 1, disabled: true, onPress() {} }, definitions);
  assert.equal(crewButton(disabled).props.disabled, true);
  assert(crewNodes(disabled).every(node => node.props.style?.opacity === undefined));
});

test('all loot effects and precise digital departure boundaries are disclosed', () => {
  const { LIBERTALIA_LOOT_HELP: loot, libertaliaLeaveMessage: message } = load('decision.ts', {});
  assert.equal(Object.keys(loot).length, 7);
  assert.match(loot.map, /2 score 7.*3 score 12/);
  assert.match(message(), /forfeit immediately.*cannot win/);
  assert.match(message(), /only this day/);
  assert.match(message(), /secret selection.*immediately/);
});

test('lobby requires paired state and the landing states calm-only multiplayer scope', () => {
  const lobby = fs.readFileSync(path.join(__dirname, '../app/libertalia/lobby.tsx'), 'utf8');
  const landing = fs.readFileSync(path.join(__dirname, '../app/libertalia/index.tsx'), 'utf8');
  assert.match(lobby, /s.libertaliaPublic && s.libertaliaPrivate && !s.libertaliaSyncing/);
  assert.match(lobby, /RemainingLobby/);
  assert.match(landing, /calm-side loot, for 2–6 players/);
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function leaveHarness(platform = 'ios', overrides = {}) {
  const hooks = [], effects = [], layouts = [], calls = [];
  let cursor = 0, dirty = false, prevented = false, nativeAttempt, androidBack, webBack, result, dialog = null;
  const store = { token: 'first', room: { roomCode: 'LOCAL', players: [] }, playerId: 'p1', libertaliaPublic: { status: 'playing', revision: 1 }, libertaliaPrivate: null };
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
    ...react, Platform: { OS: platform }, useGameStore,
    useLibertaliaActions: () => ({}), useLibertaliaDecisionAttention() {}, useWebModalFocus() {}, libertaliaDecisionKey: () => null, libertaliaLeaveMessage: () => 'Forfeit', isLibertaliaLeavePromptCurrent: load('decision.ts', {}).isLibertaliaLeavePromptCurrent,
    useWindowDimensions: () => ({ height: 800 }), usePrivateMapNotice: () => [store.peekMessage, () => { calls.push(['dismissPeek']); store.peekMessage = null; }],
    getSocket: () => socket, useNavigation: () => ({ addListener: (_, fn) => { nativeAttempt = () => fn({ preventDefault() {} }); return () => {}; } }),
    useWebBackGuard: (_, callback) => { webBack = callback; },
    BackHandler: { addEventListener: (_, callback) => { androidBack = callback; return { remove() {} }; } },
    useDialogStore: Object.assign(selector => selector({ dialog }), { getState: () => ({ dialog, hide() { calls.push(['hide']); dialog = null; } }) }),
    showDialog: (...args) => { calls.push(['dialog', ...args]); dialog = { title: args[0], buttons: args[2] }; },
    leaveRoom: async (...args) => { calls.push(['leave', ...args]); return overrides.leave?.(...args); },
    clearAuthIfMatches: async (...args) => { calls.push(['storage', ...args]); return overrides.storage?.(...args); },
    router: { replace: route => calls.push(['replace', route, prevented]) },
    setTimeout, clearTimeout,
  };
  const modules = { react, 'react-native': { Platform: globals.Platform }, 'expo-router/react-navigation': {
    usePreventRemove(value, callback) { nativeAttempt = callback; react.useEffect(() => { prevented = value; }, [value]); },
  } };
  const guard = fs.readFileSync(path.join(__dirname, '../hooks/useNativeLeaveGuard.ts'), 'utf8');
  const guardExports = {};
  vm.runInNewContext(ts.transpileModule(guard, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: guardExports, require: name => modules[name] });
  globals.useNativeLeaveGuard = guardExports.useNativeLeaveGuard;
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  const start = source.indexOf('{', source.indexOf('export default function')) + 1;
  const stop = source.indexOf('  if (!game || !mine)');
  assert(stop > start);
  const expose = 'leave, back: handleBack, setRules, setRank, leavingRef, requestLeave, sessionCleared, startNewRoom';
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
    get leaving() { return result.leavingRef.current; },
    back() { if (platform === 'web') webBack(); else if (platform === 'android') androidBack(); else nativeAttempt(); },
    setDialog(value) { dialog = value; }, get dialog() { return dialog; },
    replace() { store.token = 'second'; store.room = { roomCode: 'NEXT', players: [] }; flush(); },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
  };
}

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
  const task = h.api.leave('/libertalia'); await tick(); h.replace(); storage.resolve(); await task; h.flush();
  recovery(); h.flush();
  assert.equal(h.store.token, 'second'); assert.equal(h.leaving, false);
  assert.equal(h.calls.some(c => c[0] === 'replace' || c[0] === 'clearAll'), false);
});

test('actual terminal Leave callback cannot leave a newly started rematch before effects flush', () => {
  const h = leaveHarness('web'); h.store.libertaliaPublic = { status: 'game_over', revision: 100 }; h.flush();
  h.api.requestLeave(); const retained = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress;
  h.store.libertaliaPublic = { status: 'playing', revision: 101 };
  retained(); assert.equal(h.calls.some(c => c[0] === 'leave'), false);
  h.flush(); assert.equal(h.dialog, null); retained();
  assert.equal(h.calls.some(c => c[0] === 'leave'), false);
});

test('live Leave remains valid across unrelated revisions and owned recovery approves home', async () => {
  const h = leaveHarness('ios'); h.api.requestLeave();
  const retained = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress;
  h.store.libertaliaPublic = { status: 'playing', revision: 2 }; h.flush(); retained(); await tick(); h.flush();
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
  const h = leaveHarness('web'); h.store.libertaliaPublic = { status: 'game_over', revision: 100 }; h.flush();
  const old = h.api.startNewRoom;
  h.store.libertaliaPublic = { status: 'playing', revision: 101 };
  old(); assert.equal(h.calls.some(c => c[0] === 'leave'), false);
});

test('identical crew and loot options identify their supplied public owner', () => {
  const { libertaliaOptionLabel: label } = load('decision.ts', {});
  const game = { players: [{ playerId: 'a', displayName: 'Admiral A' }, { playerId: 'b', displayName: 'Admiral B' }] };
  assert.equal(label({ label: 'BARREL', playerId: 'a' }, game, 'b'), 'BARREL · Admiral A');
  assert.equal(label({ label: 'BARREL', playerId: 'b' }, game, 'b'), 'BARREL · You');
  assert.notEqual(label({ label: 'Sailor', playerId: 'a' }, game, 'c'), label({ label: 'Sailor', playerId: 'b' }, game, 'c'));
  assert.equal(label({ label: 'Private option', detail: 'Own detail' }, game, 'b'), 'Private option. Own detail');
});

test('loot choices describe public token effects without guessing labels or swap outcomes', () => {
  const { libertaliaOptionHelp: help, libertaliaOptionLabel: label } = load('decision.ts', {});
  const game = { currentLoot: [{ id: 7, kind: 'relic' }], players: [{ playerId: 'a', displayName: 'Admiral A', loot: [{ id: 8, kind: 'barrel' }] }] };
  const relic = { label: 'Anything', lootId: 7, playerId: 'a' };
  assert.equal(help('loot_current', relic, game), 'Calm-side effect: Lose 3 doubloons at anchor.');
  assert.match(label(relic, game, 'a', 'loot_current'), /Anything · You\. Calm-side effect: Lose 3/);
  assert.match(help('loot_ship', { label: 'Anything', lootId: 8, playerId: 'a' }, game), /Gain 1 reputation at dusk/);
  assert.equal(help('loot_swap', relic, game), null);
  assert.equal(help('loot_current', { label: 'RELIC' }, game), null);
  assert.equal(help('loot_ship', { lootId: 7 }, game), null);
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  assert.match(source, /libertaliaOptionHelp\(pending.kind, option, game\)/);
  assert.doesNotMatch(source, /Your crew or loot/);
});

test('empty eligible hands sit out selection without being labelled ready or forfeited', () => {
  const { libertaliaEmptySelection: empty } = load('decision.ts', {});
  const player = { playerId: 'a', forfeited: false, handCount: 0 };
  const game = { status: 'playing', phase: 'selection', turnOrder: ['a'], players: [player] };
  assert.equal(empty(game, player), true);
  assert.equal(empty(game, { ...player, handCount: 1 }), false);
  assert.equal(empty(game, { ...player, forfeited: true }), false);
  assert.equal(empty({ ...game, turnOrder: [] }, player), false);
  assert.equal(empty({ ...game, phase: 'night' }, player), false);
  assert.equal(empty({ ...game, status: 'game_over' }, player), false);
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  assert.match(source, /NO CREW LEFT IN HAND/);
  assert.match(source, /You sit out island selection; your ship still resolves tonight/);
  assert.match(source, /libertaliaEmptySelection\(game, p\) \? 'SITTING OUT SELECTION'/);
});

test('anchor loss copy cannot suggest avoiding losses through resolution order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/libertalia/ReferenceSheet.tsx'), 'utf8');
  assert.match(source, /Night losses stop at zero/);
  assert.match(source, /Anchor losses offset gains regardless of resolution order/);
});

test('Wind Nymph clash timing is explicitly a digital adaptation preserving own ability order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/libertalia/ReferenceSheet.tsx'), 'utf8');
  assert.match(source, /Wind Nymph clash timing \(digital adaptation\)/);
  assert.match(source, /At the start of night, the table records which ships have Wind Nymph/);
  assert.match(source, /each owner discards their own copy when resolving its ability/);
  assert.match(source, /keep your chosen order for your other night abilities/);
});

test('retained selected crew does not mask another admiral’s later effect choice', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  const copy = source.slice(source.indexOf('  const emptySelection ='), source.indexOf('  const rematchSeats ='));
  const { libertaliaEmptySelection } = load('decision.ts', {});
  const compiled = ts.transpileModule(`${copy}\n({ title, instruction })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const renderCopy = (phase, canSelect = false) => vm.runInNewContext(compiled, {
    game: { status: 'playing', phase, turnOrder: ['a', 'b'] },
    self: { playerId: 'a', forfeited: false, handCount: 2 },
    mine: { canSelect, selectedRank: 1 }, pending: null, waitingName: 'Admiral B',
    LIBERTALIA_CREW: [{ name: 'Scout' }], libertaliaEmptySelection,
  });
  for (const phase of ['effect_choice', 'night', 'anchor', 'dusk']) {
    const result = renderCopy(phase);
    assert.equal(result.title, 'WATCH THE VOYAGE');
    assert.equal(result.instruction, 'Admiral B is resolving a choice.');
  }
  assert.equal(renderCopy('selection').title, 'YOUR CREW IS READY');
  assert.match(renderCopy('selection', true).instruction, /Your secret choice is #1 Scout/);
  assert.match(source, /game\.phase === 'selection' \? 'Crew selections remain hidden until everyone is ready\.' : 'No crew remain on the island\.'/);
});

test('results copy is ranked without mutating seats and keeps forfeits behind eligible winners', () => {
  const { libertaliaResultPlayers: rank } = load('decision.ts', {});
  const players = [
    { playerId: 'low', score: 43, reputation: 4, forfeited: false },
    { playerId: 'gone', score: 99, reputation: 5, forfeited: true },
    { playerId: 'second', score: 45, reputation: 1, forfeited: false },
    { playerId: 'winner', score: 59, reputation: 3, forfeited: false },
    { playerId: 'tie', score: 45, reputation: 2, forfeited: false },
  ];
  const before = JSON.stringify(players);
  assert.deepEqual(Array.from(rank({ players, winnerPlayerIds: ['winner'] }), p => p.playerId), ['winner', 'tie', 'second', 'low', 'gone']);
  assert.equal(JSON.stringify(players), before);
  assert.deepEqual(Array.from(rank({ players, winnerPlayerIds: ['low'], endReason: 'forfeit' }), p => p.playerId), ['low', 'winner', 'tie', 'second', 'gone']);
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  assert.match(source, /libertaliaResultPlayers\(game\)\.map/);
  assert.match(source, /ended by forfeit, not three-voyage scoring/);
});

function crewNodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(crewNodes)]; }
function crewButton(card) { const buttons = crewNodes(card).filter(node => node.type === 'Button'); assert.equal(buttons.length, 1); return buttons[0]; }
function crewCardForTest(props, definitions = crewDefinitions) {
  const jsx = (type, value) => ({ type, props: value });
  return load('CrewCard.tsx', {
    react: { useState: value => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 375, fontScale: 1 }) },
    '@zuychin-arcade/types': { LIBERTALIA_CREW: definitions }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, './LibertaliaCrewArtwork': { LibertaliaCrewArtwork: 'CrewArt' },
    '../../constants/theme': { LIBERTALIA: { gold: 'gold', sky: 'sky', border: 'border' } },
  }).CrewCard({ onPress() {}, ...props });
}

test('crew accessible names include authoritative single and multiple phase timing', () => {
  assert.match(crewButton(crewCardForTest({ rank: 24 })).props.accessibilityLabel, /rank 24\. Timing: night\. Gain 4/);
  assert.match(crewButton(crewCardForTest({ rank: 11 })).props.accessibilityLabel, /Timing: daytime, anchor\. Lose half/);
});

test('submitted and proposed private crew have distinct visible and accessible states', () => {
  const submitted = crewCardForTest({ rank: 24, selection: 'submitted' });
  const candidate = crewCardForTest({ rank: 11, selection: 'candidate' });
  assert.match(crewButton(submitted).props.accessibilityLabel, /Current secret choice/);
  assert.match(crewButton(candidate).props.accessibilityLabel, /Proposed choice, not submitted/);
  assert(crewNodes(submitted).some(node => node.type === 'Text' && node.props.children === 'CURRENT SECRET CHOICE'));
  assert(crewNodes(candidate).some(node => node.type === 'Text' && node.props.children === 'PROPOSED · CONFIRM TO SUBMIT'));
  assert.equal(crewButton(submitted).props.accessibilityState.selected, true);
  assert.equal(crewButton(candidate).props.accessibilityState.selected, true);
  assert.notEqual(crewNodes(submitted).find(node => node.type === 'CardSurface').props.highlightColor, crewNodes(candidate).find(node => node.type === 'CardSurface').props.highlightColor);
  const source = fs.readFileSync(path.join(__dirname, '../app/libertalia/game.tsx'), 'utf8');
  assert.match(source, /rank !== null && rank !== mine.selectedRank && mine.canSelect/);
  assert.match(source, /selection=\{mine.selectedRank === card \? 'submitted' : rank === card \? 'candidate' : undefined\}/);
});

test('ranked option names include timing and effects without losing detail or target ownership', () => {
  const { libertaliaOptionLabel: label } = load('decision.ts', {});
  const game = { players: [{ playerId: 'a', displayName: 'Admiral A' }, { playerId: 'b', displayName: 'Admiral B' }] };
  const option = { label: '#24 Topman', rank: 24, playerId: 'a', detail: 'Copied ability' };
  assert.equal(label(option, game, 'a'), '#24 Topman · You. Copied ability. Timing: night. Gain 4, then lose 1 per character in your ship.');
  assert.match(label({ ...option, playerId: 'b' }, game, 'a'), /^#24 Topman · Admiral B\./);
  assert.equal(label({ label: 'Topman', rank: 999 }, game, 'a'), 'Topman');
  assert.equal(label({ label: '#24 Topman' }, game, 'a'), '#24 Topman');
});

test('rematch copy distinguishes reconnect grace from too few seats and clears on recovery', () => {
  const { libertaliaRematchBlock: blocked, libertaliaRematchMessage: message } = load('decision.ts', {});
  const seats = [{ isConnected: true, hasLeft: false }, { isConnected: true, hasLeft: false }, { isConnected: false, hasLeft: false }];
  assert.equal(blocked(seats), 'reconnecting');
  assert.match(message(seats, true), /Waiting.*reconnect.*grace/i);
  assert.doesNotMatch(message(seats, true), /At least two/);
  assert.match(message(seats, false), /reconnect.*grace/i);
  seats[2].isConnected = true;
  assert.equal(blocked(seats), null);
  seats[2].hasLeft = true;
  assert.equal(blocked(seats), null);
  seats[1].hasLeft = true;
  assert.equal(blocked(seats), 'not_enough_players');
  assert.match(message(seats, true), /At least two connected/);
  const reference = fs.readFileSync(path.join(__dirname, '../components/libertalia/ReferenceSheet.tsx'), 'utf8');
  assert.match(reference, /rematch requires at least two connected seats and no seat awaiting reconnection/);
});

test('Freed Prisoner commitment is disclosed as a digital interpretation, not a publisher FAQ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/libertalia/ReferenceSheet.tsx'), 'utf8');
  assert.match(source, /Freed Prisoner timing \(digital interpretation\)/);
  assert.match(source, /after ordinary night abilities/);
  assert.match(source, /already chosen copy.*source.*removed/);
});
