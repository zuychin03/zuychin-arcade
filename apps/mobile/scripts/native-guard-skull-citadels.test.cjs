const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness(game, platform = 'ios') {
  const source = fs.readFileSync(path.join(__dirname, `../app/${game}/game.tsx`), 'utf8');
  const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let newRoomSource;
  function findNewRoom(node) {
    if (ts.isJsxSelfClosingElement(node) && node.getText(ast).includes("'START A NEW ROOM'")) {
      newRoomSource = node.attributes.properties.find(attribute => attribute.name?.getText(ast) === 'onPress')?.initializer?.expression?.getText(ast);
    }
    ts.forEachChild(node, findNewRoom);
  }
  findNewRoom(ast); assert(newRoomSource, 'Actual New Room callback must be located');
  const calls = [], hooks = [], effects = [];
  let cursor = 0, dirty = false, prevented = false, nativeAttempt, context, approval;
  let rest = async () => {}, storage = async () => {};
  const local = { rules: false, tigress: null, mode: null, cleanupPending: false };
  const refs = Object.fromEntries(['mountedRef', 'leavingRef', 'leaveNotifiedRef', 'leavePromptOpenRef', 'ownDialogRef', 'leaveEpochRef', 'latestGameRef', 'lifecycleIdentity', 'modeOpenerRef', 'restoringModeFocusRef'].map(name => [name, { current: null }]));
  Object.assign(refs.mountedRef, { current: true });
  refs.lifecycleIdentity.current = 'first'; refs.leaveEpochRef.current = 0;
  refs.leavingRef.current = refs.leaveNotifiedRef.current = refs.leavePromptOpenRef.current = false;
  const publicKey = game === 'skull-king' ? 'skullKingPublic' : 'citadelsPublic';
  const state = { token: 'first', room: { roomCode: 'LOCAL' }, [publicKey]: { status: 'game_over', roomCode: 'LOCAL', revision: 50 },
    clearAll() { calls.push(['clearAll']); state.token = null; state.room = null; } };
  const dialog = { dialog: null, hide() { calls.push(['hide']); dialog.dialog = null; } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useState(value) { const index = cursor++; hooks[index] ??= { value }; return [hooks[index].value, next => { hooks[index].value = next; dirty = true; }]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const modules = { react, 'react-native': { Platform: { OS: platform } }, 'expo-router/react-navigation': { usePreventRemove(value, callback) {
    nativeAttempt = callback; react.useEffect(() => { prevented = value; }, [value]);
  } } };
  const exported = {};
  vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../hooks/useNativeLeaveGuard.ts'), 'utf8')), {
    exports: exported, require: name => { assert(name in modules); return modules[name]; },
  });
  const callback = (start, end) => source.slice(source.indexOf(start), source.indexOf(end)).replace(/const (leave|requestLeave|handleBack) =/g, 'globalThis.$1 =');
  const leaveSource = callback('  const leave = useCallback', '  const requestLeave = useCallback');
  const requestSource = callback('  const requestLeave = useCallback', '  const handleBack = useCallback');
  const backSource = callback('  const handleBack = useCallback', '  useLayoutEffect(() => { nativeBack.current');
  const effectBody = marker => {
    const start = source.indexOf(marker); assert(start >= 0);
    return source.slice(start, source.indexOf('\n  }, [', start));
  };
  const lifecycle = effectBody('    const previous = lifecycleIdentity.current;');
  const recovery = effectBody('    if (token !== null || leavingRef.current');
  const sessionCleared = effectBody('    if (!mountedRef.current || useGameStore.getState().token !== null) return;');
  const decisionExports = {};
  vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, `../components/${game}/decision.ts`), 'utf8')), { exports: decisionExports });
  function render() {
    cursor = 0; dirty = false;
    const owner = state.token;
    approval = exported.useNativeLeaveGuard(owner, () => { if (state.token === owner) context.handleBack(); });
    refs.latestGameRef.current = state[publicKey];
    context = {
      ...refs, ...local, ...decisionExports, token: owner, room: state.room, game: state[publicKey], useCallback: fn => fn,
      useGameStore: { getState: () => state }, useDialogStore: { getState: () => dialog },
      leaveRoom: async (room, token) => { calls.push(['rest', room, token]); await rest(); },
      clearAuthIfMatches: async token => { calls.push(['storage', token]); await storage(); },
      getSocket: () => ({ disconnect: () => calls.push(['disconnect']) }),
      approveNavigation: approval, router: { replace: destination => calls.push(['navigate', destination, prevented]) },
      showDialog: (...args) => { calls.push(['dialog', args[0]]); dialog.dialog = { args }; },
      setIsLeaving: value => calls.push(['leaving', value]),
      setCleanupPending: value => { local.cleanupPending = value; calls.push(['cleanup', value]); },
      setLocalMessage: value => calls.push(['message', value]), setActionMessage: value => calls.push(['message', value]),
      setRules: value => { local.rules = value; calls.push(['rules', value]); },
      setTigress: value => { local.tigress = value; calls.push(['tigress', value]); },
      setMode: value => { local.mode = value; calls.push(['mode', value]); },
      setSelectedCards: value => calls.push(['selected', value]),
      cancelMode: () => { local.mode = null; calls.push(['cancelMode']); },
    };
    vm.runInNewContext(transpile(`${leaveSource}\n${requestSource}\n${backSource}\nglobalThis.resetIdentity = () => {${lifecycle}};\nglobalThis.recover = () => {${recovery}};\nglobalThis.sessionCleared = () => {${sessionCleared}};\nglobalThis.newRoom = ${newRoomSource};`), context);
    context.resetIdentity(); context.recover();
    while (effects.length) effects.shift()();
  }
  const flush = () => { for (let i = 0; i < 10; i++) { render(); if (!dirty) return; } assert.fail('Unsettled guard'); };
  flush();
  return { calls, state, local, refs, flush, source, get prevented() { return prevented; }, get leave() { return context.leave; },
    get requestLeave() { return context.requestLeave; }, get recover() { return context.recover; }, get handleBack() { return context.handleBack; }, get sessionCleared() { return context.sessionCleared; }, get newRoom() { return context.newRoom; },
    setRest(fn) { rest = fn; }, setStorage(fn) { storage = fn; },
    attempt() { if (prevented) nativeAttempt(); }, back() { context.handleBack(); },
    unmount() { refs.mountedRef.current = false; hooks.forEach(hook => hook.cleanup?.()); },
    replace() { state.token = 'replacement'; state.room = { roomCode: 'NEW' }; },
    confirm() { dialog.dialog.args[2].find(button => button.text === 'LEAVE').onPress(); },
    buttons() { return dialog.dialog.args[2]; },
  };
}

for (const game of ['skull-king', 'citadels']) {
  for (const platform of ['ios', 'android']) for (const destination of ['/', `/${game}`]) test(`${game} ${platform}: deferred REST/storage, duplicate and approved ${destination}`, async () => {
    const h = harness(game, platform), rest = deferred(), storage = deferred();
    h.setRest(() => rest.promise); h.setStorage(() => storage.promise);
    const pending = h.leave(destination); await h.leave(destination); h.attempt();
    assert.equal(h.prevented, true); assert.equal(h.calls.filter(call => call[0] === 'rest').length, 1);
    assert(!h.calls.some(call => ['storage', 'navigate'].includes(call[0])));
    rest.resolve(); await tick(); assert.equal(h.prevented, true);
    assert.deepEqual(h.calls.find(call => call[0] === 'storage'), ['storage', 'first']);
    storage.resolve(); await pending; assert(!h.calls.some(call => call[0] === 'navigate'));
    h.flush(); h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', destination, false]]);
  });
  test(`${game}: failed storage retries once without repeating REST`, async () => {
    const h = harness(game); let attempts = 0;
    h.setStorage(async () => { if (++attempts === 1) throw new Error('Storage failed'); });
    await h.leave(); h.flush(); assert(h.prevented); assert.equal(h.local.cleanupPending, true);
    await h.leave(`/${game}`); h.flush();
    assert.equal(h.calls.filter(call => call[0] === 'rest').length, 1);
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', `/${game}`, false]]);
  });
  test(`${game}: notification failure preserves existing local-cleanup policy`, async () => {
    const h = harness(game); h.setRest(async () => { throw new Error('Offline'); });
    await h.leave(); h.flush();
    assert(h.calls.some(call => call[0] === 'dialog'));
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', '/', false]]);
  });
  for (const outcome of ['resolve', 'reject']) test(`${game}: old storage ${outcome} cannot change replacement refs or navigation`, async () => {
    const h = harness(game), oldStorage = deferred(); h.setStorage(() => oldStorage.promise);
    const oldLeave = h.leave, pending = oldLeave(); await tick();
    h.replace(); h.flush(); h.refs.leavingRef.current = true;
    const count = h.calls.length;
    oldStorage[outcome](outcome === 'reject' ? new Error('Old storage') : undefined); await pending;
    assert.equal(h.calls.length, count); assert.equal(h.refs.leavingRef.current, true); assert(h.prevented);
    h.refs.leavingRef.current = false; await oldLeave(); assert.equal(h.calls.length, count);
    h.setStorage(async () => {}); await h.leave(); h.flush();
    assert(h.calls.some(call => call[0] === 'rest' && call[2] === 'replacement'));
    assert.equal(h.calls.filter(call => call[0] === 'navigate').length, 1);
  });
  test(`${game}: replacement during REST stops before disconnect and auth cleanup`, async () => {
    const h = harness(game), rest = deferred(); h.setRest(() => rest.promise);
    const pending = h.leave(); h.replace(); h.flush(); const count = h.calls.length;
    rest.resolve(); await pending;
    assert.equal(h.calls.length, count); assert(h.prevented);
    assert(!h.calls.some(call => ['disconnect', 'storage', 'navigate'].includes(call[0])));
  });
  for (const stage of ['rest', 'storage']) test(`${game}: unmount during ${stage} cannot continue owned cleanup`, async () => {
    const h = harness(game), pendingWork = deferred();
    if (stage === 'rest') h.setRest(() => pendingWork.promise); else h.setStorage(() => pendingWork.promise);
    const pending = h.leave(); await tick(); h.unmount(); const count = h.calls.length;
    pendingWork.resolve(); await pending;
    assert.equal(h.calls.length, count);
    assert(!h.calls.some(call => ['clearAll', 'navigate'].includes(call[0])));
  });
  for (const interruption of ['replacement', 'unmount']) test(`${game}: ${interruption} cancels queued navigation`, async () => {
    const h = harness(game); await h.leave(`/${game}`);
    if (interruption === 'replacement') { h.replace(); h.flush(); assert(h.prevented); }
    else h.unmount();
    assert(!h.calls.some(call => call[0] === 'navigate'));
  });
  test(`${game}: null-token recovery and pre-effect replacement are owned`, () => {
    const h = harness(game); h.state.token = null; h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', '/', false]]);
    const oldRecover = h.recover; h.replace(); h.refs.leavingRef.current = false;
    oldRecover(); assert.equal(h.refs.leavingRef.current, false); h.flush(); assert(h.prevented);
    assert.equal(h.calls.filter(call => call[0] === 'navigate').length, 1);
  });
  for (const platform of ['ios', 'android', 'web']) test(`${game} ${platform}: rules then local Cancel before leave`, () => {
    const h = harness(game, platform); h.local.rules = true;
    h.local[game === 'skull-king' ? 'tigress' : 'mode'] = 'choice'; h.flush();
    const back = () => platform === 'ios' ? h.attempt() : h.back();
    back(); assert(h.calls.some(call => call[0] === 'rules' && call[1] === false));
    h.flush(); back(); assert(h.calls.some(call => call[0] === (game === 'skull-king' ? 'tigress' : 'cancelMode')));
    assert(!h.calls.some(call => call[0] === 'rest')); h.flush(); back();
    assert(h.calls.some(call => call[0] === 'dialog')); assert(!h.calls.some(call => call[0] === 'rest'));
  });
  test(`${game}: retained completed-result confirmation cannot forfeit a rematch`, () => {
    const h = harness(game); h.requestLeave();
    const key = game === 'skull-king' ? 'skullKingPublic' : 'citadelsPublic';
    h.state[key] = { ...h.state[key], status: 'playing', revision: 51 }; h.confirm();
    assert(!h.calls.some(call => call[0] === 'rest'));
    assert.doesNotMatch(h.source, /addListener\('beforeRemove'/);
    assert.match(h.source, /useNativeLeaveGuard\(token/);
  });
  test(`${game}: stale Back, prompt and Stay/Leave callbacks are inert before replacement effects`, () => {
    const h = harness(game); h.requestLeave();
    const oldBack = h.handleBack, oldRequest = h.requestLeave, buttons = h.buttons();
    h.replace(); const count = h.calls.length;
    oldBack(); oldRequest(); buttons.forEach(button => button.onPress());
    assert.equal(h.calls.length, count);
    assert.equal(h.refs.leavePromptOpenRef.current, true, 'Old callbacks must not clear a replacement prompt ref');
  });
  test(`${game}: recovery callback owns one arcade exit and does not race parent null effect`, () => {
    const h = harness(game), cleared = h.sessionCleared;
    h.state.clearAll(); cleared(); cleared(); h.flush(); h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', '/', false]]);
    assert.equal((h.source.match(/<GameRecovery /g) ?? []).length,
      (h.source.match(/<GameRecovery onSessionCleared=\{handleSessionCleared\}/g) ?? []).length);
  });
  test(`${game}: replacement before recovery callback cannot write leave refs`, () => {
    const h = harness(game), cleared = h.sessionCleared;
    h.replace(); const count = h.calls.length;
    cleared(); assert.equal(h.refs.leavingRef.current, false); assert.equal(h.calls.length, count);
    h.flush(); assert(h.prevented);
  });
  test(`${game}: current New Room callback retains its approved destination`, async () => {
    const h = harness(game); h.newRoom(); await tick(); await tick(); h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'navigate'), [['navigate', `/${game}`, false]]);
  });
}
