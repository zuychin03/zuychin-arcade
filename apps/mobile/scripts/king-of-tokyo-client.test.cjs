const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');


function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/king-of-tokyo/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', kingOfTokyoPublic: null, unusedPrivate: null, kingOfTokyoSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setKingOfTokyoSyncing(value) { store.kingOfTokyoSyncing = value; dirty = true; } });
  const { useTokyoActions: renderHook } = load('useTokyoActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision) => ({ gameId: 'king_of_tokyo', revision, roomCode: store.roomCode, viewerPlayerId: store.playerId });
  const pair = (revision) => { store.kingOfTokyoPublic = snapshot(revision); store.kingOfTokyoSyncing = false; event('game_state', store.kingOfTokyoPublic); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('requires a fresh viewer-owned frame and fences immediate duplicate input', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('roll', {}, 'Roll', 0), false);
  h.pair(0);
  const send = h.actions.send;
  assert.equal(send('roll', {}, 'Roll', 0), true);
  assert.equal(send('roll', {}, 'Roll', 0), false);
  assert.equal(h.calls.filter(([name]) => name === 'king_of_tokyo:roll').length, 1);
});

test('only matching semantic ack plus a fresh adopted frame confirms a command', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('roll', {}, 'Roll', 1);
  h.event('king_of_tokyo:action_accepted', { action: 'preferences', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, 'Roll');
  h.event('king_of_tokyo:action_accepted', { action: 'roll', revision: 2 });
  assert.equal(h.actions.pending, 'Roll');
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, 'Roll');
  h.pair(2); assert.equal(h.actions.pending, null);
  assert.equal(h.actions.message, 'Roll accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('same-revision no-op preferences still require a fresh owned frame after ack', () => {
  const h = actionHarness(); h.pair(4); h.actions.send('preferences', { tokenPreference: 'poison' }, 'Preference', 4);
  h.pair(4); assert.equal(h.actions.pending, 'Preference');
  h.event('king_of_tokyo:action_accepted', { action: 'preferences', revision: 4 });
  assert.equal(h.actions.pending, 'Preference');
  h.pair(4); assert.equal(h.actions.pending, null);
});

test('gameplay cannot be acknowledged by the same or invalid revision', () => {
  const h = actionHarness(); h.pair(4); h.actions.send('roll', {}, 'Roll', 4);
  for (const revision of [4, 3, NaN, Infinity, 4.5]) {
    h.event('king_of_tokyo:action_accepted', { action: 'roll', revision }); h.pair(4);
    assert.equal(h.actions.pending, 'Roll');
  }
});

test('other viewer, wrong room and stale metadata cannot replace observed revision', () => {
  const h = actionHarness(); h.pair(4);
  for (const frame of [{ ...h.snapshot(5), viewerPlayerId: 'other' }, { ...h.snapshot(5), roomCode: 'OTHER' }, ...[3, NaN, Infinity, 4.5].map(h.snapshot)]) h.event('game_state', frame);
  assert.equal(h.actions.send('roll', {}, 'Roll', 4), true);
});

test('stale captured send cannot act after unmount or replacement auth', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.store.token = 'replacement'; assert.equal(send('roll', {}, 'Roll', 4), false);
  h.store.token = 'synthetic-session'; h.unmount(); assert.equal(send('roll', {}, 'Roll', 4), false);
});

test('old callbacks and timeout cannot disturb replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('roll', {}, 'Roll', 1);
  const callbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const timeout = [...h.timers.values()].find(t => t.ms === 12000).fn;
  const refresh = h.actions.refresh;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  callbacks[0]({ reason: 'late' }); callbacks[1](); callbacks[2](); timeout(); refresh(); h.flush();
  assert.equal(h.calls.length, before); assert.equal(h.actions.synced, true); assert.equal(h.store.kingOfTokyoSyncing, false);
});

test('timeout, rejection and reconnect require resync before retry', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('roll', {}, 'Roll', 1); h.expire(12000);
  assert.match(h.actions.message, /No confirmation/); assert.equal(h.actions.send('roll', {}, 'Roll', 1), false);
  h.pair(1); h.actions.send('roll', {}, 'Roll', 1); h.event('action_rejected', { reason: 'Stale' });
  assert.equal(h.actions.send('roll', {}, 'Roll', 1), false);
  h.pair(2); h.socket.connected = false; h.event('disconnect'); h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('roll', {}, 'Roll', 2), false);
  h.pair(3); assert.equal(h.actions.send('roll', {}, 'Roll', 3), true);
});

test('unrelated preference revision refresh remains ready without resetting local decisions', () => {
  const h = actionHarness(); h.pair(5); h.pair(6);
  assert.equal(h.actions.busy, false); assert.equal(h.actions.pending, null);
  assert.equal(h.actions.send('set_kept', { keptIndexes: [1, 2] }, 'Keep', 6), true);
});

test('rematch emits no payload and rejects restarted revision', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start_game', {}, 'Rematch', 100);
  assert.equal(h.calls.at(-1).length, 1);
  h.event('king_of_tokyo:action_accepted', { action: 'start_game', revision: 0 }); assert.equal(h.actions.pending, 'Rematch');
  h.event('king_of_tokyo:action_accepted', { action: 'start_game', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, null);
});

for (const event of ['game_state', 'king_of_tokyo:action_accepted', 'action_rejected']) {
  test(`ignores malformed ${event} without retiring the pending command`, () => {
    const h = actionHarness(); h.pair(1); h.actions.send('roll', {}, 'Roll', 1);
    for (const value of [null, undefined, false, 'bad', {}]) assert.doesNotThrow(() => h.event(event, value));
    assert.equal(h.actions.pending, 'Roll');
  });
}

test('Tokyo routes reuse hardened forms with the original miniature and explicit mark fallback', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo', name), 'utf8');
  assert.match(read('index.tsx'), /RemainingLanding/);
  assert.match(read('index.tsx'), /presentation="illustrated"/);
  assert.match(read('index.tsx'), /nativeID="tokyo-entrance-art"/);
  assert.match(read('index.tsx'), /tokyo-hero.webp/);
  assert.match(read('index.tsx'), /fallback=\{<TokyoMark size=\{100\} \/>\}/);
  assert.match(read('join.tsx'), /RemainingJoin/); assert.match(read('lobby.tsx'), /RemainingLobby/);
});

test('reroll accessibility hint distinguishes one die from zero or several dice', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8');
  const hint = source.match(/accessibilityHint=\{(`[^`]*kept; reroll every unkept die`)\}/)?.[1];
  assert.ok(hint);
  for (const size of [0, 1, 2, 6]) {
    assert.equal(vm.runInNewContext(hint, { selected: { size } }),
      `${size} ${size === 1 ? 'die' : 'dice'} kept; reroll every unkept die`);
  }
});

test('live and completed forfeit labels use game truth, not historical room departure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8');
  assert.match(source, /const presenceLabel = player.forfeited \? 'FORFEITED'/);
  assert.match(source, /const status = player.forfeited \? 'FORFEITED' : player.playerId === game.winnerId/);
  assert.match(source, /All remaining monsters forfeited. No winner or competitive result is recorded./);
  assert.match(source, /ROLL TO CLAIM THE FIRST TURN/);
  assert.match(source, /animated: !reduceMotion/);
  assert.doesNotMatch(source, /numberOfLines=\{1\} style=\{\{ fontFamily: 'Outfit_800ExtraBold', color: inactive/);
});

test('publisher card decisions allow self Mimic and use exact deferred Smash projection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8');
  assert.doesNotMatch(source, /player.playerId !== pendingMimicOwner.playerId/);
  assert.match(source, /Copy any monster’s Keep card, including your own/);
  assert.doesNotMatch(source, /myDeathFromAboveDecision|choose_death_from_above_target/);
  assert.match(source, /game.hasDeferredSmashDamage \? 'Jets defers/);
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
  const { useTokyoDecisionAttention: renderAttention } = load('useTokyoDecisionAttention.ts', { react }, {
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
  h.render('roll-first'); h.flush(); assert.equal(h.calls, 1);
  h.render('roll-first', true); h.render('roll-first'); h.flush();
  h.render('roll-first'); h.flush(); assert.equal(h.calls, 1);
});

test('new mandatory decision waits for enabled controls and focuses once', () => {
  const h = attentionHarness();
  h.render('roll'); h.flush();
  h.render('defence', true); h.flush(); assert.equal(h.calls, 1);
  h.render('defence'); h.flush(); assert.equal(h.calls, 2);
  h.render('defence', true); h.render('defence'); h.flush(); assert.equal(h.calls, 2);
  h.render(null); h.render('defence'); h.flush(); assert.equal(h.calls, 3);
});

test('Rapid Healing preview uses authoritative per-activation healing and caps health', () => {
  const { rapidHealingPreview } = load('healingPreview.ts', {});
  assert.equal(rapidHealingPreview(3, 10, 1, 2, 2).remainingHealth, 3);
  assert.equal(rapidHealingPreview(9, 10, 1, 2, 2).healed, 1);
  assert.equal(rapidHealingPreview(7, 10, 2, 1, 2).remainingHealth, 7);
  const source = fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8');
  assert.match(source, /rapidHealingPreview\(me.health, me.maxHealth, rapidHealingActivations, pendingDefense.healingPerActivation/);
  assert.doesNotMatch(source, /HEAL 1|HEALTH TO BUY BEFORE DAMAGE/);
});
