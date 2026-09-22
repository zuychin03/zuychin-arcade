const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function callbacks(game) {
  const source = read(`app/${game}/game.tsx`);
  const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback') {
      result[node.name.text] = node.initializer.arguments[0].getText(ast);
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const text = node.arguments[0].getText(ast);
      if (text.includes('const previous = lifecycleIdentity.current')) result.reset = text;
      if (text.includes('if (token !== null') && text.includes('approveNavigation')) result.recover = text;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { source, ...result };
}

function harness(game, platform = 'ios', options = {}) {
  const parts = callbacks(game), hooks = [], effects = [], calls = [], refs = {};
  let cursor = 0, dirty = false, approved, prevented = false, attempt, renderedToken = 'first', live = true;
  const store = { token: 'first', room: { roomCode: 'LOCAL' }, roomCode: 'LOCAL', clearAll() { calls.push(['clearAll']); store.token = null; store.room = null; store.roomCode = null; } };
  const dialog = { dialog: null, hide() { calls.push(['hide']); dialog.dialog = null; } };
  for (const name of ['leavingRef', 'leaveNotifiedRef', 'leavePromptRef', 'leavePromptOpenRef']) refs[name] = { current: false };
  refs.mountedRef = { current: true }; refs.ownDialogRef = { current: null }; refs.lifecycleIdentity = { current: 'first' };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, value => { hooks[i].value = value; dirty = true; }]; },
    useRef(value) { const i = cursor++; hooks[i] ??= { current: value }; return hooks[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(hooks[i]?.deps, deps)) hooks[i] = { value: fn, deps }; return hooks[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(hooks[i]?.deps, deps)) effects.push(() => { hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
  };
  const modules = { react, 'react-native': { Platform: { OS: platform } }, 'expo-router/react-navigation': {
    usePreventRemove(value, callback) { attempt = callback; react.useEffect(() => { prevented = value; }, [value]); },
  } };
  const exports = {};
  vm.runInNewContext(compile(read('hooks/useNativeLeaveGuard.ts')), { exports, require: name => { assert(name in modules); return modules[name]; } });
  const record = name => value => calls.push([name, value]);
  function context() {
    return {
      ...refs, token: store.token, room: store.room, approveNavigation: approved,
      useGameStore: { getState: () => store }, useDialogStore: { getState: () => dialog },
      getSocket: () => ({ disconnect: () => calls.push(['disconnect', store.token]) }),
      leaveRoom: async (room, token) => { calls.push(['leaveRoom', token]); await options.leave?.(token); },
      clearAuthIfMatches: async token => { calls.push(['clearAuth', token]); await options.clear?.(token); },
      setLeaving: record('leaving'), setIsLeaving: record('leaving'), setCleanupPending: record('cleanup'),
      setActionMessage: record('message'), setShowInfluences: record('influences'), showDialog: record('dialog'),
      router: { replace: destination => calls.push(['replace', destination, prevented]) },
    };
  }
  function bind(expression, globals = context()) {
    assert(expression, 'Expected callback in the actual screen source');
    return vm.runInNewContext(compile(`globalThis.bound = ${expression};`), globals), globals.bound;
  }
  function render() {
    cursor = 0; dirty = false;
    approved = exports.useNativeLeaveGuard(store.token, () => calls.push(['attempt']));
    while (effects.length) effects.shift()();
    if (renderedToken !== store.token) {
      renderedToken = store.token;
      bind(parts.reset)(); bind(parts.recover)();
    }
  }
  function flush() { assert(live); for (let i = 0; i < 10; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); }
  flush();
  return {
    calls, store, refs, dialog, parts, flush, bind, context,
    leave: () => bind(parts[game === 'coup' ? 'onLeave' : 'leave']),
    replace(token) { store.token = token; store.room = token === null ? null : { roomCode: 'LOCAL' }; store.roomCode = token === null ? null : 'LOCAL'; flush(); },
    recover: () => bind(parts.recover),
    attempt() { if (prevented) attempt(); },
    get prevented() { return prevented; },
    unmount() { live = false; refs.mountedRef.current = false; hooks.forEach(hook => hook.cleanup?.()); },
  };
}

const count = (h, kind) => h.calls.filter(call => call[0] === kind).length;
for (const game of ['coup', 'king-of-tokyo']) {
  for (const platform of ['ios', 'android']) test(`${game}/${platform}: actual leave blocks through REST and storage, then approves once`, async () => {
    const rest = deferred(), storage = deferred();
    const h = harness(game, platform, { leave: () => rest.promise, clear: () => storage.promise });
    const leave = h.leave(), work = leave();
    await leave(); h.attempt();
    assert.equal(count(h, 'leaveRoom'), 1); assert.equal(count(h, 'clearAuth'), 0); assert.equal(h.prevented, true);
    rest.resolve(); await tick(); h.flush();
    assert.equal(count(h, 'clearAuth'), 1); assert.equal(h.prevented, true); assert.equal(count(h, 'replace'), 0);
    storage.resolve(); await work;
    assert.equal(count(h, 'replace'), 0); h.flush(); h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'replace'), [['replace', '/', false]]);
    assert(h.calls.findIndex(call => call[0] === 'clearAuth') < h.calls.findIndex(call => call[0] === 'clearAll'));
  });

  test(`${game}: storage failure stays protected and retries without repeating REST`, async () => {
    let attempts = 0;
    const h = harness(game, 'ios', { clear: async () => { if (++attempts === 1) throw Error('Storage locked'); } });
    await h.leave()(); h.flush();
    assert.equal(h.prevented, true); assert.equal(count(h, 'replace'), 0);
    assert.equal(h.refs.leavingRef.current, false);
    assert(h.calls.some(call => call[0] === 'cleanup' && call[1]));
    await h.leave()(); h.flush();
    assert.equal(count(h, 'leaveRoom'), 1); assert.equal(count(h, 'clearAuth'), 2); assert.equal(count(h, 'replace'), 1);
  });

  test(`${game}: REST failure retains existing local-cleanup behaviour`, async () => {
    const h = harness(game, 'ios', { leave: async () => { throw Error('Offline'); } });
    await h.leave()(); h.flush();
    assert.equal(count(h, 'clearAuth'), 1); assert.equal(count(h, 'clearAll'), 1); assert.equal(count(h, 'replace'), 1);
  });

  for (const stage of ['leave', 'clear']) test(`${game}: replacement during ${stage} rejects all old continuation writes`, async () => {
    const old = deferred(), replacement = deferred();
    const h = harness(game, 'ios', { [stage]: token => token === 'first' ? old.promise : replacement.promise });
    const oldLeave = h.leave(), oldWork = oldLeave(); await tick();
    h.replace('second');
    assert.equal(h.refs.leavingRef.current, false); assert.equal(h.refs.leaveNotifiedRef.current, false); assert.equal(h.prevented, true);
    const newWork = h.leave()(); await tick();
    assert.equal(h.refs.leavingRef.current, true);
    const checkpoint = h.calls.length;
    old.reject(Error('Old request failed')); await oldWork;
    assert.equal(h.calls.length, checkpoint); assert.equal(h.refs.leavingRef.current, true);
    await oldLeave(); assert.equal(h.calls.length, checkpoint);
    replacement.resolve(); await newWork; h.flush();
    assert.equal(count(h, 'replace'), 1); assert.equal(count(h, 'clearAll'), 1);
  });

  test(`${game}: replacement before queued approval cancels exit and re-arms consumer`, async () => {
    const h = harness(game); await h.leave()();
    h.replace('second');
    assert.equal(count(h, 'replace'), 0); assert.equal(h.prevented, true);
    assert.equal(h.refs.leavingRef.current, false); assert.equal(h.refs.leaveNotifiedRef.current, false);
    await h.leave()(); h.flush(); assert.equal(count(h, 'replace'), 1);
  });

  test(`${game}: token-null recovery is approved once and cannot retire replacement credentials`, () => {
    const h = harness(game);
    h.replace(null); h.flush(); assert.equal(count(h, 'replace'), 1);
    const staleRecovery = h.recover();
    h.replace('second'); staleRecovery(); h.flush();
    assert.equal(h.prevented, true); assert.equal(count(h, 'replace'), 1);
    assert.equal(h.refs.leavingRef.current, false);
  });

  test(`${game}: unmount during cleanup cannot clear or navigate`, async () => {
    const storage = deferred(); const h = harness(game, 'ios', { clear: () => storage.promise });
    const work = h.leave()(); await tick(); h.unmount(); storage.resolve(); await work;
    assert.equal(count(h, 'clearAll'), 0); assert.equal(count(h, 'replace'), 0);
  });

  test(`${game}: actual recovery callback approves the cleared identity without a competing redirect`, () => {
    const h = harness(game), callback = h.bind(h.parts.onSessionCleared);
    h.store.clearAll(); callback();
    assert.equal(h.refs.leavingRef.current, true); assert.equal(count(h, 'replace'), 0);
    h.flush(); h.flush();
    assert.deepEqual(h.calls.filter(call => call[0] === 'replace'), [['replace', '/', false]]);
    assert.match(h.parts.source, /<GameRecovery[^>]+onSessionCleared=\{onSessionCleared\}/);
  });

  test(`${game}: recovery callback after replacement cannot mark leaving or navigate`, () => {
    const h = harness(game), callback = h.bind(h.parts.onSessionCleared);
    h.replace('second'); callback(); h.flush();
    assert.equal(h.refs.leavingRef.current, false); assert.equal(count(h, 'replace'), 0); assert.equal(h.prevented, true);
  });

  test(`${game}: replacement reset closes only its owned dialog`, () => {
    const h = harness(game), owned = {}, unrelated = {};
    h.refs.ownDialogRef.current = owned; h.dialog.dialog = unrelated;
    h.refs.leavePromptRef.current = h.refs.leavePromptOpenRef.current = true;
    h.replace('second');
    assert.equal(h.dialog.dialog, unrelated); assert.equal(count(h, 'hide'), 0);
    assert.equal(h.refs.leavePromptRef.current || h.refs.leavePromptOpenRef.current, true);
    assert.equal(game === 'coup' ? h.refs.leavePromptRef.current : h.refs.leavePromptOpenRef.current, false);
    h.refs.ownDialogRef.current = owned; h.dialog.dialog = owned; h.replace('third');
    assert.equal(h.dialog.dialog, null); assert.equal(count(h, 'hide'), 1);
  });

  test(`${game}: web cleanup stays immediate without native prevention`, async () => {
    const h = harness(game, 'web'); await h.leave()();
    assert.equal(h.prevented, false); assert.deepEqual(h.calls.at(-1), ['replace', '/', false]);
    h.flush(); assert.equal(count(h, 'replace'), 1);
  });

  test(`${game}: uses public guard and retains hardware/web Back wiring`, () => {
    const source = callbacks(game).source;
    assert.doesNotMatch(source, /useNavigation|addListener\('beforeRemove'/);
    assert.match(source, /useNativeLeaveGuard\(token/);
    assert.match(source, /useLayoutEffect\(\(\) => \{ nativeBack.current = handleBack;/);
    assert.match(source, /useWebBackGuard/);
    assert.match(source, /BackHandler.addEventListener\('hardwareBackPress'/);
  });
}

test('Coup Back closes rules, then private influences, then requests leave', () => {
  const h = harness('coup'), calls = [];
  const ctx = { showRef: true, showInfluences: true, setShowRef: () => calls.push('rules'), setShowInfluences: () => calls.push('influences'), onRequestLeave: () => calls.push('leave') };
  h.bind(h.parts.handleBack, ctx)(); ctx.showRef = false;
  h.bind(h.parts.handleBack, ctx)(); ctx.showInfluences = false;
  h.bind(h.parts.handleBack, ctx)(); assert.deepEqual(calls, ['rules', 'influences', 'leave']);
});

test('Tokyo finished Back cleans up immediately; live Back closes rules before prompting', async () => {
  const h = harness('king-of-tokyo'), calls = [], work = [];
  const ctx = { ...h.context(), game: { status: 'game_over', revision: 100 }, showRules: true, setShowRules: () => calls.push('rules'), requestLeave: () => calls.push('prompt'), leave: () => { const pending = h.leave()(); work.push(pending); return pending; } };
  h.store.kingOfTokyoPublic = ctx.game;
  ctx.closeFinishedGame = h.bind(h.parts.closeFinishedGame, ctx);
  h.bind(h.parts.handleBack, ctx)(); await Promise.all(work); h.flush();
  assert.equal(count(h, 'replace'), 1); assert.deepEqual(calls, []);
  ctx.game = { status: 'playing' }; h.bind(h.parts.handleBack, ctx)(); ctx.showRules = false;
  h.bind(h.parts.handleBack, ctx)(); assert.deepEqual(calls, ['rules', 'prompt']);
});

test('Tokyo retained finished close cannot leave a rematch before effects run', async () => {
  const h = harness('king-of-tokyo'), game = { status: 'game_over', revision: 100 }, work = [];
  h.store.kingOfTokyoPublic = game;
  const ctx = { ...h.context(), game, leave: () => { const pending = h.leave()(); work.push(pending); return pending; } };
  const close = h.bind(h.parts.closeFinishedGame, ctx);
  h.store.kingOfTokyoPublic = { status: 'playing', revision: 101 };
  close(); await Promise.all(work);
  assert.equal(count(h, 'leaveRoom'), 0);
});

for (const game of ['coup', 'king-of-tokyo']) test(`${game}: retained results confirmation cannot leave a rematch before effects run`, async () => {
  const h = harness(game), captured = { status: 'game_over', revision: 100 }, work = [];
  const stateKey = game === 'coup' ? 'coupPublic' : 'kingOfTokyoPublic';
  h.store[stateKey] = captured;
  let buttons;
  const leave = () => { const pending = h.leave()(); work.push(pending); return pending; };
  const ctx = { ...h.context(), pub: captured, game: captured, cleanupPending: false, leave, onLeave: leave,
    showDialog: (_title, _message, actions) => { buttons = actions; }, leaveEpochRef: { current: 0 } };
  h.bind(h.parts[game === 'coup' ? 'onRequestLeave' : 'requestLeave'], ctx)();
  assert(buttons);
  h.store[stateKey] = { status: 'playing', revision: 101 };
  buttons.find(button => button.text === 'LEAVE').onPress(); await Promise.all(work);
  assert.equal(count(h, 'leaveRoom'), 0);
});

for (const game of ['coup', 'king-of-tokyo']) {
  for (const mutation of ['none', 'terminal_revision', 'epoch', 'token', 'cancel']) test(`${game}: results confirmation ownership fence ${mutation}`, async () => {
    const h = harness(game), captured = { status: 'game_over', revision: 100 }, work = [];
    const stateKey = game === 'coup' ? 'coupPublic' : 'kingOfTokyoPublic';
    h.store[stateKey] = captured;
    let buttons;
    const leave = () => { const pending = h.leave()(); work.push(pending); return pending; };
    const ctx = { ...h.context(), cleanupPending: false, leave, onLeave: leave,
      showDialog: (_title, _message, actions) => { buttons = actions; }, leaveEpochRef: { current: 0 } };
    h.bind(h.parts[game === 'coup' ? 'onRequestLeave' : 'requestLeave'], ctx)();
    if (mutation === 'terminal_revision') h.store[stateKey] = { status: 'game_over', revision: 150 };
    if (mutation === 'epoch') ctx.leaveEpochRef.current++;
    if (mutation === 'token') h.replace('second');
    if (mutation === 'cancel') buttons.find(button => button.text === 'STAY').onPress();
    buttons.find(button => button.text === 'LEAVE').onPress(); await Promise.all(work);
    assert.equal(count(h, 'leaveRoom'), mutation === 'none' ? 1 : 0);
  });
}
