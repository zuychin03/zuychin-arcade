const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function harness(platform = 'ios') {
  const hooks = [], effects = [], calls = [];
  let cursor = 0, dirty = false, identity = 'first', result, prevented = false, onAttempt, attempts = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value, value => { hooks[index].value = value; dirty = true; }]; },
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const modules = {
    react, 'react-native': { Platform: { OS: platform } },
    'expo-router/react-navigation': { usePreventRemove(value, callback) {
      onAttempt = callback;
      react.useEffect(() => { prevented = value; calls.push(['nativeFlag', value]); }, [value]);
    } },
  };
  const filename = path.join(__dirname, '../hooks/useNativeLeaveGuard.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert(name in modules); return modules[name]; } });
  const render = () => { cursor = 0; dirty = false; result = exports.useNativeLeaveGuard(identity, () => attempts++); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 10; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  flush();
  return { calls, flush, setIdentity(value) { identity = value; }, get approve() { return result; }, get prevented() { return prevented; }, get attempts() { return attempts; }, attempt() { if (prevented) onAttempt(); }, navigate() { calls.push(['navigate', prevented]); }, unmount() { hooks.forEach(hook => hook.cleanup?.()); } };
}

for (const platform of ['ios', 'android']) test(platform + ' native flag blocks removal until approved callback runs after release', () => {
  const h = harness(platform);
  assert.equal(h.prevented, true); h.attempt(); assert.equal(h.attempts, 1);
  h.approve(() => h.navigate(), () => true);
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  assert.equal(h.prevented, true);
  h.flush();
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
  h.flush(); assert.equal(h.calls.filter(([kind]) => kind === 'navigate').length, 1);
});

test('replaced identity cancels queued navigation and retains native protection', () => {
  const h = harness(); const oldApprove = h.approve;
  h.approve(() => h.navigate(), () => true);
  h.setIdentity('replacement'); h.flush();
  assert.equal(h.prevented, true);
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  oldApprove(() => h.navigate(), () => true); h.flush();
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  h.approve(() => h.navigate(), () => true); h.flush();
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
});

test('callback-time ownership failure cancels without navigating or leaving the guard disabled', () => {
  const h = harness(); let current = true;
  h.approve(() => h.navigate(), () => current); current = false; h.flush();
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  assert.equal(h.prevented, true);
  assert.equal(h.calls.some(([kind, value]) => kind === 'nativeFlag' && value === false), false);
});

test('successful cleanup explicitly authorises the cleared identity, not a replacement seat', () => {
  const h = harness();
  h.approve(() => h.navigate(), () => true, null); h.setIdentity(null); h.flush();
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
  const replaced = harness();
  replaced.approve(() => replaced.navigate(), () => true, null); replaced.setIdentity('other'); replaced.flush();
  assert.equal(replaced.prevented, true);
  assert.equal(replaced.calls.some(([kind]) => kind === 'navigate'), false);
});

test('unmounted callbacks cannot schedule or execute approved navigation', () => {
  const h = harness(); const approve = h.approve;
  approve(() => h.navigate(), () => true); h.unmount();
  approve(() => h.navigate(), () => true);
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
});

test('web does not prevent native removal or defer owned navigation', () => {
  const h = harness('web'); assert.equal(h.prevented, false);
  h.approve(() => h.navigate(), () => true);
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
  h.approve(() => h.navigate(), () => false);
  assert.equal(h.calls.filter(([kind]) => kind === 'navigate').length, 1);
});

function gameLeaveHarness(clearAuth) {
  const h = harness();
  const calls = [];
  const store = { token: 'first', room: { roomCode: 'LOCAL' }, clearAll() { store.token = null; h.setIdentity(null); calls.push('clearAll'); } };
  const globals = {
    useCallback: fn => fn, token: 'first', room: store.room,
    mountedRef: { current: true }, leavingRef: { current: false }, leaveNotifiedRef: { current: false }, navigatingRef: { current: false },
    useGameStore: { getState: () => store }, getSocket: () => ({ disconnect: () => calls.push('disconnect') }),
    leaveRoom: async () => calls.push('leaveRoom'), clearAuthIfMatches: clearAuth,
    setIsLeaving: value => calls.push(['leaving', value]), setCleanupPending: value => calls.push(['cleanup', value]),
    setActionMessage: value => calls.push(['message', value]), showDialog: () => {},
    approveNavigation: h.approve, router: { replace: () => h.navigate() },
  };
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const body = source.slice(source.indexOf('  const leave = useCallback'), source.indexOf('  const requestLeave = useCallback'));
  assert(body.includes('clearAuthIfMatches'));
  const code = ts.transpileModule(body.replace('const leave =', 'globalThis.leave =').replace('const onSessionCleared =', 'globalThis.onSessionCleared ='), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, globals);
  return { h, calls, store, globals, leave: globals.leave, onSessionCleared: globals.onSessionCleared };
}

test('actual Not Alone leave keeps native protection through secure cleanup and bypasses only its approved exit', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { h, calls, leave } = gameLeaveHarness(() => pending);
  const leaving = leave();
  await Promise.resolve();
  assert.equal(h.prevented, true);
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  await leave();
  assert.equal(calls.filter(value => value === 'leaveRoom').length, 1);
  finish(); await leaving;
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  h.flush();
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
});

test('actual Not Alone cleanup failure can retry without repeating server leave or disabling native protection', async () => {
  let attempts = 0;
  const { h, calls, leave } = gameLeaveHarness(async () => { if (++attempts === 1) throw new Error('Storage unavailable'); });
  await leave(); h.flush();
  assert.equal(h.prevented, true);
  assert.equal(h.calls.some(([kind]) => kind === 'navigate'), false);
  assert(calls.some(value => Array.isArray(value) && value[0] === 'cleanup' && value[1]));
  await leave(); h.flush();
  assert.equal(calls.filter(value => value === 'leaveRoom').length, 1);
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
});

test('Not Alone recovery callback approves one cleared-session exit and rejects a replacement', () => {
  const { h, store, globals, onSessionCleared } = gameLeaveHarness(async () => {});
  store.clearAll();
  onSessionCleared(); onSessionCleared();
  h.flush();
  assert.equal(h.calls.filter(([kind]) => kind === 'navigate').length, 1);
  assert.deepEqual(h.calls.at(-1), ['navigate', false]);
  const other = gameLeaveHarness(async () => {});
  other.store.token = 'replacement'; other.h.setIdentity('replacement'); other.h.flush();
  other.onSessionCleared();
  assert.equal(other.globals.leavingRef.current, false);
  assert.equal(other.h.calls.some(([kind]) => kind === 'navigate'), false);
  globals.mountedRef.current = false; globals.leavingRef.current = false;
  onSessionCleared();
  assert.equal(globals.leavingRef.current, false);
});

test('retained Not Alone null-token recovery effect cannot lock a replacement session', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const body = source.match(/useEffect\(\(\) => \{\s+if \(token !== null[\s\S]*?\n  \}, \[token, approveNavigation\]\);/)[0];
  const leavingRef = { current: false };
  let callback, approvals = 0;
  vm.runInNewContext(body, {
    token: null, leavingRef, useGameStore: { getState: () => ({ token: 'replacement' }) },
    useEffect: fn => { callback = fn; }, approveNavigation: () => approvals++, router: { replace: () => {} },
  });
  callback();
  assert.equal(leavingRef.current, false);
  assert.equal(approvals, 0);
});

test('both scoped routes use the supported guard and preserve web and Android handlers', () => {
  for (const file of ['../app/not-alone/game.tsx', '../components/remaining/RemainingLobby.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /addListener\('beforeRemove'/);
    assert.match(source, /useNativeLeaveGuard\(token/);
    assert.match(source, /approveNavigation\(\(\) => router.replace/);
    assert.match(source, /useWebBackGuard/);
    assert.match(source, /BackHandler.addEventListener\('hardwareBackPress'/);
    assert.match(source, /clearAuthIfMatches/);
  }
  const installed = path.join(require.resolve('expo-router/package.json'), '..', 'build/react-navigation/native-stack/views/NativeStackView.native.js');
  const nativeStack = fs.readFileSync(installed, 'utf8');
  assert.match(nativeStack, /usePreventRemoveContext/);
  assert.match(nativeStack, /preventNativeDismiss: isRemovePrevented/);
});
