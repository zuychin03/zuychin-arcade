const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const bangLayoutHelpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/bang/layout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: bangLayoutHelpers });
const saboteurCardHelpers = {};
const saboteurCardModules = {
  'react-native': {}, 'react/jsx-runtime': {}, '@expo/vector-icons': {}, 'expo-linear-gradient': {},
  '../../../constants/theme': { ARCADE: {} }, '../../ui/CardSurface': {},
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/saboteur/cards/ActionCardView.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: saboteurCardHelpers, require: name => { assert(name in saboteurCardModules, name); return saboteurCardModules[name]; } });

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(game, platform = 'ios', overrides = {}) {
  const hooks = [], effects = [], layouts = [], calls = [];
  let cursor = 0, dirty = false, prevented = false, nativeAttempt, androidBack, webBack, result, dialog = null;
  const store = { token: 'first', room: { roomCode: 'LOCAL', players: [] }, playerId: 'p1', selectedCardId: null };
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
    ...react, ...bangLayoutHelpers, saboteurHandCardSize: saboteurCardHelpers.saboteurHandCardSize, Platform: { OS: platform }, useGameStore,
    useBangActions: () => ({}), useSaboteurActions: () => ({}), useReducedMotionPreference: () => false,
    useWindowDimensions: () => ({ width: 375, height: 800, fontScale: 1 }), usePrivateMapNotice: () => [store.peekMessage, () => { calls.push(['dismissPeek']); store.peekMessage = null; }],
    getSocket: () => socket, useNavigation: () => ({ addListener: (_, fn) => { nativeAttempt = () => fn({ preventDefault() {} }); return () => {}; } }),
    useWebBackGuard: (_, callback) => { webBack = callback; },
    BackHandler: { addEventListener: (_, callback) => { androidBack = callback; return { remove() {} }; } },
    useDialogStore: { getState: () => ({ dialog, hide() { calls.push(['hide']); dialog = null; } }) },
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
  const source = fs.readFileSync(path.join(__dirname, `../app/${game}/game.tsx`), 'utf8');
  const start = source.indexOf('{', source.indexOf('export default function')) + 1;
  const stop = source.indexOf(game === 'bang' ? '  const mine = game?.players' : '  const roleStatus =');
  assert(stop > start);
  const expose = game === 'bang'
    ? 'leave, back, setRules, setSelectedId, setSidMode, leaveRef, ownedPrompt, promptRef, departedRef'
    : 'leave: onLeave, back: handleBack, setRules: setShowRules, setShowRole, leavingRef, ownDialogRef, decisionDialogRef, leavePromptOpenRef, leaveNotifiedRef, lastRoundRef, lastGoldPickRef, roleKeyToAcknowledgeRef, clearedRoleHistoryRef, roleHistoryClearPromiseRef';
  const code = `globalThis.render = function() { ${source.slice(start, stop)} return { ${expose}, onRecoveryCleared }; }`;
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
    get leaving() { return (result.leaveRef ?? result.leavingRef).current; },
    back() { if (platform === 'web') webBack(); else if (platform === 'android') androidBack(); else nativeAttempt(); },
    setDialog(value) { dialog = value; }, get dialog() { return dialog; },
    replace() { store.token = 'second'; store.room = { roomCode: 'NEXT', players: [] }; flush(); },
    unmount() { hooks.forEach(hook => hook.cleanup?.()); },
  };
}

for (const game of ['bang', 'saboteur']) {
  test(`${game}: native prevention remains armed through REST and storage, then approved exit runs once`, async () => {
    const rest = deferred(), storage = deferred();
    const h = harness(game, 'ios', { leave: () => rest.promise, storage: () => storage.promise });
    assert.equal(h.prevented, true);
    const leaving = h.api.leave(); await h.api.leave();
    h.back(); h.back();
    assert.equal(h.calls.filter(([kind]) => kind === 'leave').length, 1);
    assert.equal(h.calls.some(([kind]) => kind === 'dialog'), false);
    assert.equal(h.prevented, true); assert.equal(h.calls.some(([kind]) => kind === 'storage'), false);
    rest.resolve(); await tick();
    assert.equal(h.prevented, true); assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    storage.resolve(); await leaving;
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  test(`${game}: storage failure retains protection and retries without another server departure`, async () => {
    let attempts = 0;
    const h = harness(game, 'android', { storage: async () => { if (++attempts === 1) throw new Error('storage'); } });
    await h.api.leave(); h.flush();
    assert.equal(h.prevented, true); assert.equal(h.leaving, false);
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    await h.api.leave(); h.flush();
    assert.equal(h.calls.filter(([kind]) => kind === 'leave').length, 1);
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  test(`${game}: old failed cleanup cannot write or release a replacement leave`, async () => {
    const oldStorage = deferred(), newStorage = deferred();
    const h = harness(game, 'ios', { storage: token => token === 'first' ? oldStorage.promise : newStorage.promise });
    const oldLeave = h.api.leave(); await tick(); h.replace();
    assert.equal(h.leaving, false); assert.equal(h.prevented, true);
    const newLeave = h.api.leave(); await tick();
    const count = h.calls.length;
    oldStorage.reject(new Error('retired')); await oldLeave;
    assert.equal(h.calls.length, count); assert.equal(h.leaving, true);
    newStorage.resolve(); await newLeave; h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'storage').map(([, token]) => token), ['first', 'second']);
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  test(`${game}: queued exit is cancelled by replacement or unmount`, async () => {
    const h = harness(game); await h.api.leave(); h.replace();
    assert.equal(h.prevented, true); assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    await h.api.leave(); h.flush();
    assert.equal(h.calls.filter(([kind]) => kind === 'replace').length, 1);
    const closed = harness(game); await closed.api.leave(); closed.unmount();
    assert.equal(closed.calls.some(([kind]) => kind === 'replace'), false);
  });

  test(`${game}: token-null recovery approves arcade without notifying an absent seat`, () => {
    const h = harness(game); h.store.token = null; h.store.room = null; h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
  });

  test(`${game}: recovery cleanup callback uses parent approval once and refuses a replacement session`, () => {
    const h = harness(game);
    h.store.token = null; h.store.room = null;
    h.api.onRecoveryCleared();
    assert.equal(h.leaving, true);
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
    const replaced = harness(game); const stale = replaced.api.onRecoveryCleared;
    replaced.replace(); stale(); replaced.flush();
    assert.equal(replaced.leaving, false); assert.equal(replaced.prevented, true);
    assert.equal(replaced.calls.some(([kind]) => kind === 'replace'), false);
    const source = fs.readFileSync(path.join(__dirname, `../app/${game}/game.tsx`), 'utf8');
    assert.match(source, /<GameRecovery onSessionCleared=\{onRecoveryCleared\}/);
  });

  test(`${game}: pending REST and retired leave callback cannot affect replacement credentials`, async () => {
    const rest = deferred();
    const h = harness(game, 'ios', { leave: (_, token) => token === 'first' ? rest.promise : undefined });
    const retired = h.api.leave;
    const oldLeave = retired(); h.replace();
    const count = h.calls.length;
    rest.resolve(); await oldLeave; await retired(); h.flush();
    assert.equal(h.calls.length, count);
    assert.equal(h.prevented, true); assert.equal(h.leaving, false);
    await h.api.leave(); h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'storage'), [['storage', 'second']]);
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  test(`${game}: replacing auth after token-null recovery queues an exit cannot navigate the new seat`, () => {
    const h = harness(game);
    h.store.token = null; h.store.room = null;
    // Render the null identity but replace it before the approval effect executes.
    h.renderOnce();
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    h.replace();
    assert.equal(h.prevented, true);
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
  });

  test(`${game}: retained token-null recovery effect cannot mark replacement credentials as leaving`, () => {
    const h = harness(game);
    h.store.token = null; h.store.room = null; h.renderOnce(false);
    h.store.token = 'second'; h.store.room = { roomCode: 'NEXT', players: [] };
    h.commit();
    assert.equal(h.leaving, false);
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    h.flush(); assert.equal(h.prevented, true);
  });

  test(`${game}: web owned cleanup still navigates once after storage`, async () => {
    const storage = deferred();
    const h = harness(game, 'web', { storage: () => storage.promise });
    const leaving = h.api.leave(); await tick();
    assert.equal(h.calls.some(([kind]) => kind === 'replace'), false);
    storage.resolve(); await leaving; h.flush();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  test(`${game}: replacement clears only its owned prompt and unmount cannot hide another dialog`, () => {
    const h = harness(game); h.back();
    const owned = h.dialog; assert(owned);
    h.replace(); assert.equal(h.dialog, null);
    h.back(); const other = { title: 'another owner' }; h.setDialog(other);
    h.unmount(); assert.equal(h.dialog, other);
  });

  test(`${game}: retained results Leave cannot forfeit a rematch before or after effect cleanup`, async () => {
    const h = harness(game);
    const field = game === 'bang' ? 'bangPublic' : 'publicState';
    h.store[field] = { status: 'game_over', revision: 20, players: [] }; h.flush(); h.back();
    const leave = h.dialog.buttons.at(-1).onPress;
    h.store[field] = { status: 'playing', revision: 21, players: [] };
    leave(); await tick();
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
    h.flush(); assert.equal(h.dialog, null);
    leave(); await tick();
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
    h.back(); assert(h.dialog);
  });

  test(`${game}: later terminal and replacement credentials invalidate retained results confirmation`, async () => {
    const h = harness(game);
    const field = game === 'bang' ? 'bangPublic' : 'publicState';
    h.store[field] = { status: 'game_over', revision: 20, players: [] }; h.flush(); h.back();
    const leave = h.dialog.buttons.at(-1).onPress;
    h.store[field] = { status: 'game_over', revision: 40, players: [] }; leave(); await tick();
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
    h.replace(); leave(); await tick();
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
  });

  test(`${game}: unrelated live revisions preserve the owned leave prompt and its valid action`, async () => {
    const h = harness(game);
    const field = game === 'bang' ? 'bangPublic' : 'publicState';
    h.store[field] = { status: 'playing', revision: 20, players: [] }; h.flush(); h.back();
    const prompt = h.dialog;
    h.store[field] = { status: 'playing', revision: 21, players: [] }; h.flush();
    assert.equal(h.dialog, prompt);
    prompt.buttons.at(-1).onPress(); await tick(); h.flush();
    assert.equal(h.calls.filter(([kind]) => kind === 'leave').length, 1);
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
  });

  for (const platform of ['ios', 'android', 'web']) test(`${game}: ${platform} Back preserves overlay priority`, () => {
    const h = harness(game, platform);
    h.api.setRules(true); h.flush(); h.back(); h.flush();
    assert.equal(h.calls.some(([kind]) => kind === 'dialog'), false);
    if (game === 'bang') {
      h.store.bangPrivate = { canPlay: true, canUseSid: true, playOptions: [{ cardId: 'card', targets: [] }] };
      h.api.setSelectedId('card'); h.api.setSidMode(true);
    }
    else h.api.setShowRole(true);
    h.flush(); h.back(); h.flush();
    assert.equal(h.calls.some(([kind]) => kind === 'dialog'), false);
    if (game === 'saboteur') {
      h.store.peekMessage = 'private map'; h.flush(); h.back(); h.flush();
      assert.equal(h.calls.filter(([kind]) => kind === 'dismissPeek').length, 1);
      assert.equal(h.calls.some(([kind]) => kind === 'dialog'), false);
    }
    h.back(); h.flush();
    assert.equal(h.calls.filter(([kind]) => kind === 'dialog').length, 1);
    assert.equal(h.calls.some(([kind]) => kind === 'leave'), false);
  });
}

test('BANG REST failure stops cleanup and a retry really retries REST', async () => {
  let attempts = 0;
  const h = harness('bang', 'ios', { leave: async () => { if (++attempts === 1) throw new Error('offline'); } });
  await h.api.leave(); h.flush();
  assert.equal(h.api.departedRef.current, false); assert.equal(h.leaving, false); assert.equal(h.prevented, true);
  assert.equal(h.calls.some(([kind]) => kind === 'storage' || kind === 'disconnect'), false);
  await h.api.leave(); h.flush();
  assert.equal(attempts, 2); assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
});

test('Saboteur REST failure still completes token-matched local cleanup once', async () => {
  const h = harness('saboteur', 'ios', { leave: async () => { throw new Error('offline'); } });
  await h.api.leave(); h.flush();
  assert.equal(h.calls.filter(([kind]) => kind === 'leave').length, 1);
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'storage'), [['storage', 'first']]);
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'replace'), [['replace', '/', false]]);
});

test('Saboteur replacement resets private role-history acknowledgement without writing old history', () => {
  const h = harness('saboteur');
  h.api.lastRoundRef.current = 2;
  h.api.lastGoldPickRef.current = 3;
  h.api.roleKeyToAcknowledgeRef.current = 'old-seat-role-key';
  h.api.clearedRoleHistoryRef.current = true;
  h.api.roleHistoryClearPromiseRef.current = Promise.resolve();
  h.replace();
  assert.equal(h.api.lastRoundRef.current, 0);
  assert.equal(h.api.lastGoldPickRef.current, undefined);
  assert.equal(h.api.roleKeyToAcknowledgeRef.current, null);
  assert.equal(h.api.clearedRoleHistoryRef.current, false);
  assert.equal(h.api.roleHistoryClearPromiseRef.current, null);
  assert.equal(h.calls.some(([kind]) => kind === 'storage' || kind === 'leave'), false);
});
