const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');


function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/not-alone/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', notAlonePublic: null, notAlonePrivate: null, notAloneSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setNotAloneSyncing(value) { store.notAloneSyncing = value; dirty = true; } });
  const { useNotAloneActions: renderHook } = load('useNotAloneActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'not_alone', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : { viewerPlayerId: store.playerId }) });
  const pair = (revision) => { store.notAlonePublic = snapshot(revision); store.notAlonePrivate = snapshot(revision, true); store.notAloneSyncing = false; event('game_state', store.notAlonePublic); event('private_state', store.notAlonePrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('select', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'notalone:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('notalone:action_accepted', { action: 'select', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('select', {}, 'Select destination', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('select', {}, 'Select destination', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('resolve', { cardId: 'x' }, 'Resolve place', 1), true);
  assert.equal(send('resolve', { cardId: 'x' }, 'Resolve place', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'notalone:resolve').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('resolve', {}, 'Resolve place', 1); h.flush();
  h.event('notalone:action_accepted', { action: 'select', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('resolve', { placeIndex: 1 }, 'Resolve place', 1);
  h.event('notalone:action_accepted', { action: 'resolve', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Resolve place accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.notAloneSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('select', {}, 'Select destination', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('select', {}, 'Select destination', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('select', {}, 'Select destination', 3), false);
  h.store.token = 'synthetic-session'; h.store.notAlonePrivate.playerId = 'other';
  assert.equal(oldSend('select', {}, 'Select destination', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('resolve', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('resolve', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('select', {}, 'Select destination', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('select', {}, 'Select destination', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.notAloneSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('resolve', { placeIndex: 0 }, 'Resolve place', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('resolve', { placeIndex: 0 }, 'Resolve place', 1), false);
  h.pair(1); assert.equal(h.actions.send('resolve', { placeIndex: 0 }, 'Resolve place', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('select', {}, 'Select destination', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('select', {}, 'Select destination', 1), false);
  h.pair(2); assert.equal(h.actions.send('select', {}, 'Select destination', 2), true);
});

test('rematch preserves the selected board face and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start', { boardFace: 'alternating' }, 'Start', 100); h.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['start_game', { boardFace: 'alternating' }]);
  h.event('notalone:action_accepted', { action: 'start', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('notalone:action_accepted', { action: 'start', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});



test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.notAlonePrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('resolve', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('resolve', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('resolve', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'notalone:resolve');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.notAloneSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.notAlonePublic = h.snapshot(5); h.store.notAlonePrivate = h.snapshot(5, true); h.store.notAloneSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('resolve', { action: 'income' }, 'Income', 5), true);
});

test('server settlement can advance the pair beyond my accepted command', () => {
  const h = actionHarness(); h.pair(0);
  h.actions.send('select', { choice: 'gold' }, 'Take gold', 0); h.flush();
  h.pair(1); assert.equal(h.actions.pending, true);
  h.event('notalone:action_accepted', { action: 'select', revision: 2 });
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
  const { useNotAloneDecisionAttention: renderAttention } = load('useNotAloneDecisionAttention.ts', { react }, {
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


test('completed-expedition Leave callback cannot forfeit a rematch before or after effect cleanup', () => {
  const { isNotAloneLeavePromptCurrent: current } = load('decision.ts', {});
  const captured = { status: 'game_over', revision: 195 };
  assert.equal(current(captured, captured, 1, 1), true);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 1), false);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 2), false);
  assert.equal(current(captured, { status: 'game_over', revision: 390 }, 1, 1), false);
  assert.equal(current(captured, null, 1, 1), false);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'playing', revision: 11 }, 1, 1), true);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'game_over', revision: 11 }, 1, 1), false);
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  assert.match(source, /leaveEpochRef.current \+= 1/);
  assert.match(source, /\[game\?\.status, room\?\.roomCode, token\]/);
  assert.match(source, /if \(!isNotAloneLeavePromptCurrent\(captured/);
});

test('actual retained Leave callback reads the changed store before React effects run', () => {
  const { isNotAloneLeavePromptCurrent } = load('decision.ts', {});
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const body = source.match(/text: 'LEAVE', style: 'destructive', onPress: \(\) => \{([\s\S]*?)\n        \}/)?.[1];
  assert(body);
  let current = { status: 'game_over', revision: 195 }, leaves = 0;
  const leaveEpochRef = { current: 1 };
  const callback = vm.runInNewContext('(() => {' + body + '})', {
    captured: { ...current }, epoch: 1, leaveEpochRef, leavePromptOpenRef: { current: true },
    useGameStore: { getState: () => ({ notAlonePublic: current }) },
    isNotAloneLeavePromptCurrent, leave: () => { leaves++; },
  });
  current = { status: 'playing', revision: 196 };
  callback(); assert.equal(leaves, 0);
  leaveEpochRef.current = 2;
  callback(); assert.equal(leaves, 0);
});


test('viewer-specific frames and mismatched public viewer cannot unlock commands', () => {
  const h = actionHarness();
  h.store.notAlonePublic = h.snapshot(1); h.store.notAlonePrivate = h.snapshot(1, true); h.store.notAloneSyncing = false;
  h.event('game_state', { ...h.snapshot(1), viewerPlayerId: 'other' }); h.event('private_state', h.snapshot(1, true));
  assert.equal(h.actions.send('select', {}, 'Select destination', 1), false);
  h.pair(1); h.store.notAlonePublic.viewerPlayerId = 'other';
  assert.equal(h.actions.send('select', {}, 'Select destination', 1), false);
});

test('all gameplay suffixes retain semantic acknowledgement action kinds', () => {
  const actions = ['select', 'river_choice', 'survival_choice', 'card_choice', 'resist', 'give_up', 'survival', 'hunt_card', 'place_token', 'pass', 'begin_hunt', 'lock_hunt', 'reveal', 'begin_reckoning', 'resolve', 'end_turn'];
  for (const action of actions) {
    const h = actionHarness(); h.pair(1);
    assert.equal(h.actions.send(action, {}, 'Decision', 1), true);
    assert.equal(h.calls.at(-1)[0], 'notalone:' + action.replaceAll('_', '-'));
    h.event('notalone:action_accepted', { action, revision: 2 }); h.pair(2);
    assert.equal(h.actions.pending, false);
  }
});

test('Shelter choice reload waits for its own pair and duplicate submit emits once', () => {
  const h = actionHarness();
  h.event('game_state', h.snapshot(7));
  assert.equal(h.actions.send('survival_choice', { cardIndex: 0 }, 'Keep Survival card', 7), false);
  h.pair(7);
  const send = h.actions.send;
  assert.equal(send('survival_choice', { cardIndex: 0 }, 'Keep Survival card', 7), true);
  assert.equal(send('survival_choice', { cardIndex: 1 }, 'Keep Survival card', 7), false);
  assert.equal(h.calls.filter(([event]) => event === 'notalone:survival-choice').length, 1);
});

test('shared routes preserve role and board identity with paired lobby readiness', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../app/not-alone/', file), 'utf8');
  assert.match(read('index.tsx'), /RemainingLanding/);
  assert.match(read('index.tsx'), /GameCover/);
  assert.match(read('index.tsx'), /hero=\{<GameCover\b[^>]*source=\{require\('\.\.\/\.\.\/assets\/game-art\/not-alone-hero\.webp'\)\}/);
  assert.match(read('index.tsx'), /presentation="illustrated"/);
  assert.match(read('index.tsx'), /fallback=\{<NotAloneMark/);
  assert.match(read('index.tsx'), /Create as the Creature; join as one of the Hunted/);
  assert.match(read('join.tsx'), /RemainingJoin/);
  const lobby = read('lobby.tsx');
  assert.match(lobby, /notAlonePublic && state.notAlonePrivate && !state.notAloneSyncing/);
  assert.match(lobby, /startPayload=\{\{ boardFace \}\}/);
  assert.match(lobby, /seatRoleLabel/);
});

test('informational card and historical roster text is not opacity-dimmed', () => {
  const place = fs.readFileSync(path.join(__dirname, '../components/not-alone/PlaceCard.tsx'), 'utf8');
  assert.doesNotMatch(place, /opacity:/);
  assert.match(place, /width: fluid \? '100%'/);
  assert.match(place, /fontFamily: 'Outfit_400Regular',[^\n]*fontSize: 14, lineHeight: 20/);
  assert.doesNotMatch(place, /<CardSurface[^>]*\bdisabled[=\s>]/);
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const chip = fs.readFileSync(path.join(__dirname, '../components/not-alone/CardChip.tsx'), 'utf8');
  assert.doesNotMatch(chip, /opacity:/);
  assert.doesNotMatch(chip, /<CardSurface[^>]*\bdisabled[=\s>]/);
  assert.doesNotMatch(game, /opacity: player.forfeited/);
  assert.match(game, /import \{ PlaceChoiceGrid \} from '\.\.\/\.\.\/components\/not-alone\/PlaceChoiceRow'/);
  const choices = fs.readFileSync(path.join(__dirname, '../components/not-alone/PlaceChoiceRow.tsx'), 'utf8');
  assert.match(choices, /const horizontal = places.length >= 3/);
  assert.match(choices, /setViewport\(event.nativeEvent.layout.width\)/);
  assert.match(choices, /width: cardWidth, flexShrink: 0/);
  assert.match(choices, /flexBasis: 240, flexGrow: 1, flexShrink: 1/);
  assert.equal((choices.match(/<NotAlonePlaceCard placeId=\{place\} fluid selected=\{selected.includes\(place\)\} selectionBlocked=\{selectionBlockedPlaces.includes\(place\)\} onPress=\{\(\) => onToggle\(place\)\}/g) || []).length, 2);
});

test('web attention uses rendered heading bounds and explicit Cancel restores its opener', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  assert.match(game, /heading\?\.scrollIntoView\(\{ block: 'start', inline: 'nearest' \}\)/);
  assert.match(game, /onPress=\{cancelChoice\}/);
  assert.match(game, /element.getAttribute\('aria-label'\) === opener/);
  assert.match(game, /current.token !== token/);
  assert.match(game, /restoringModeFocusRef.current && !mode/);
});

test('Lair copy commits only its advertised source and resets for the authoritative nested choice', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  assert.match(game, /'Choose Lair copy', \{ mode: 'copy', targetPlaceId: choicePlaces\[0\] \}/);
  assert.match(game, /mine\?\.resolutionOptions\?\.effectivePlaceId, resetChoice/);
  assert.match(game, /mine.resolutionOptions\?\.effectivePlaceId \?\? 0/);
  assert.match(game, /resolution.mustUsePlacePower/);
  assert.match(game, /LAIR COPY COMMITTED/);
  assert.match(game, /resolution.roverPlaceIds/);
  assert.match(game, /resolution.sourceChoices/);
});

test('retained Give up confirmation revalidates legality and sends only the current owned revision', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const confirm = game.slice(game.indexOf('const confirmGiveUp'), game.indexOf('const resistOption'));
  assert.match(confirm, /current.token !== token/);
  assert.match(confirm, /!current.notAlonePrivate\?\.canGiveUp/);
  assert.match(confirm, /current.notAlonePublic\?\.phase !== game.phase/);
  assert.match(confirm, /actions.send\('give_up', \{\}, 'Give up', current.notAlonePublic.revision\)/);
  assert.match(game, /giveUpDialogRef.current && useDialogStore.getState\(\).dialog === giveUpDialogRef.current/);
});

test('browser driver distinguishes lobby start from the Creature begin-Hunt command', () => {
  const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8');
  const branch = driver.slice(driver.indexOf('if (mine.canBeginHunt)'), driver.indexOf('if (mine.canLockHunt)'));
  assert.match(branch, /BEGIN THE HUNT/);
  assert.doesNotMatch(branch, /START GAME/);
});

test('private cards use measured narrow viewport width and keep compact desktop sizing', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  assert.match(game, /setHandViewportWidth\(event.nativeEvent.layout.width\)/);
  const widths = [...game.matchAll(/<CardChip width=\{([^}]+)\} cardId=\{cardId\}/g)].map(match => match[1]);
  assert.equal(widths.length, 2);
  for (const expression of widths) {
    assert.equal(expression, 'compact ? Math.max(1, handViewportWidth - 4) : Math.max(1, Math.min(handViewportWidth - 4, 244 * textScale))');
    for (const handViewportWidth of [0, 3, 220, 280, 414, 768]) for (const textScale of [1, 2]) for (const compact of [false, true]) {
      const actual = vm.runInNewContext(expression, { compact, handViewportWidth, textScale });
      assert.equal(actual, Math.max(1, compact ? handViewportWidth - 4 : Math.min(handViewportWidth - 4, 244 * textScale)));
      assert(actual >= 1 && actual <= Math.max(1, handViewportWidth - 4));
    }
  }
  assert.match(game, /compact && privateHandCount > 1/);
  assert.match(game, /cards · swipe or scroll to browse/);
});

test('only ready Hunted seats advertise a locked destination, preserving connection priority', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const declaration = game.match(/const connectionLabel = (.*);/)[1];
  const { notAloneForfeitLabel } = load('decision.ts', {});
  const label = (player, roomSeat) => vm.runInNewContext(declaration, { player, roomSeat, game: { status: 'playing', huntedOrder: [] }, notAloneForfeitLabel });
  assert.equal(label({ role: 'creature', isReady: true }, { isConnected: true }), '');
  assert.equal(label({ role: 'hunted', isReady: true }, { isConnected: true }), 'DESTINATION LOCKED');
  assert.equal(label({ role: 'hunted', isReady: true, reactionPassed: true }, { isConnected: true }), 'REACTION PASSED');
  assert.match(label({ role: 'hunted', isReady: true }, { isConnected: false }), /RECONNECTING/);
  assert.match(label({ role: 'hunted', forfeited: true, isReady: true }, { isConnected: false }), /FORFEITED/);
});

test('card action classification matches immediate play, configured choices and Flashback effects', () => {
  const { notAloneHuntNeedsOptions, notAloneSurvivalNeedsOptions } = load('decision.ts', {});
  for (const card of ['mirage', 'virus', 'persecution', 'clone']) assert.equal(notAloneHuntNeedsOptions(card, null), false);
  for (const card of ['anticipation', 'ascendancy', 'phobia', 'detour', 'cataclysm', 'force_field']) {
    assert.equal(notAloneHuntNeedsOptions(card, null), true);
    assert.equal(notAloneHuntNeedsOptions('flashback', card), true);
  }
  assert.equal(notAloneHuntNeedsOptions('flashback', 'mirage'), false);
  assert.equal(notAloneHuntNeedsOptions('flashback', null), false);
  for (const card of ['sacrifice', 'sixth_sense', 'vortex', 'double_back', 'gate', 'hologram', 'wrong_track']) assert.equal(notAloneSurvivalNeedsOptions(card), true);
  for (const card of ['smokescreen', 'strike_back']) assert.equal(notAloneSurvivalNeedsOptions(card), false);
});

test('card copy and actual handlers share option classification and preserve disabled readability', () => {
  const game = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const chip = fs.readFileSync(path.join(__dirname, '../components/not-alone/CardChip.tsx'), 'utf8');
  assert.match(game, /import \{ CardChip \} from '\.\.\/\.\.\/components\/not-alone\/CardChip'/);
  assert.match(chip, /CHOOSE OPTIONS/);
  assert.match(chip, /PLAY CARD NOW/);
  assert.match(chip, /accessibilityLabel=\{`\$\{title\}\. \$\{body\} \$\{actionLabel\}`\}/);
  assert.match(chip, /Plays this card immediately/);
  assert.match(chip, /Choose options before playing this card/);
  assert.match(chip, /NOT AVAILABLE NOW/);
  assert.doesNotMatch(chip, /opacity:/);
  assert.equal((game.match(/notAloneHuntNeedsOptions\(cardId, mine.lastDiscardedHuntCard\)/g) || []).length, 2);
  assert.equal((game.match(/notAloneSurvivalNeedsOptions\(cardId\)/g) || []).length, 2);
  const jsx = (type, props) => ({ type, props });
  const { CardChip } = load('CardChip.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'icon' },
    '../ui/ScalePressable': { ScalePressable: 'button' },
    '../ui/CardSurface': { CardSurface: 'card-surface' },
    '../../constants/theme': { NOT_ALONE: { surface: '#17102a', muted: '#aba0c3', text: '#f8f3ff', bg: '#0d0818', panel: '#24163b' } },
  });
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const onPress = () => {};
  for (const needsOptions of [false, true]) {
    const rendered = CardChip({ cardId: 'private-owned-card', title: 'Card', body: 'Effect.', color: '#ff508d', disabled: false, needsOptions, onPress });
    assert.equal(rendered.props.testID, 'not-alone-card-chip-private-owned-card');
    const buttons = nodes(rendered).filter(node => node.type === 'button'); assert.equal(buttons.length, 1);
    const button = buttons[0], actionLabel = needsOptions ? 'CHOOSE OPTIONS' : 'PLAY CARD NOW';
    assert.equal(button.props.accessibilityLabel, `Card. Effect. ${actionLabel}`);
    assert.equal(button.props.accessibilityHint, needsOptions ? 'Choose options before playing this card' : 'Plays this card immediately');
    assert.equal(nodes(rendered).filter(node => node.type === 'text' && node.props.children === actionLabel).length, 1);
    assert.equal(button.props.onPress, onPress);
    assert.equal(button.props.disabled, false); assert.equal(button.props.accessibilityState.disabled, false);
  }
  const disabled = CardChip({ cardId: 'private-owned-card', title: 'Card', body: 'Effect.', color: '#ff508d', disabled: true, needsOptions: false, onPress });
  const button = nodes(disabled).find(node => node.type === 'button');
  assert.equal(button.props.accessibilityLabel, 'Card. Effect. NOT AVAILABLE NOW');
  assert.equal(button.props.accessibilityHint, 'This card is unavailable during the current decision');
  assert.equal(button.props.disabled, true); assert.equal(button.props.accessibilityState.disabled, true); assert.equal(button.props.onPress, onPress);
  assert.equal(nodes(disabled).filter(node => node.type === 'text' && node.props.children === 'NOT AVAILABLE NOW').length, 1);
  assert(nodes(disabled).every(node => node.props.style?.opacity === undefined));
  assert.equal(nodes(disabled).find(node => node.type === 'card-surface').props.disabled, undefined);
});

test('Creature planning has active instructions and a stable semantic attention key', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const expression = name => source.slice(source.indexOf(`const ${name} = `) + `const ${name} = `.length).split(';\n')[0];
  const context = {
    game: { roundNumber: 10, phase: 'creature_planning', revision: 124, pendingPlaceIndex: 0, pendingEncounterStage: null },
    mine: { canHunt: true }, playerId: 'self', localPlayer: {}, me: {}, mode: null,
    playerForfeited: () => false, cardChoice: null, forbiddenChoicePending: false, pendingPlayer: null,
  };
  const key = () => vm.runInNewContext(expression('localDecisionKey'), context);
  const title = () => vm.runInNewContext(expression('decisionTitle'), context);
  const original = key(); assert(original);
  assert.equal(title(), 'PLAN YOUR HUNT');
  context.game.revision++; assert.equal(key(), original);
  context.mine.canLockHunt = true;
  assert.equal(title(), 'LOCK HUNT POSITIONS'); assert.notEqual(key(), original);
  assert.match(source, /if \(mine.canHunt\) return 'Place your Hunt tokens/);
});

test('leave copy names the Creature forfeit result instead of promising autopilot', () => {
  const { notAloneLeaveMessage } = load('decision.ts', {});
  const game = { status: 'playing', players: [{ playerId: 'c', role: 'creature', forfeited: false }, { playerId: 'h', role: 'hunted', forfeited: false }] };
  const message = notAloneLeaveMessage(game, 'c');
  assert.match(message, /forfeit immediately/);
  assert.match(message, /expedition ends and the remaining Hunted win/);
  assert.doesNotMatch(message, /autopilot|automatically/);
  assert.match(notAloneLeaveMessage(game, 'h'), /last Hunted/);
  assert.match(notAloneLeaveMessage(game, 'h'), /Creature victory/);
});

test('Hunted leave copy distinguishes active teammates from forfeited seats', () => {
  const { notAloneLeaveMessage } = load('decision.ts', {});
  const game = { status: 'playing', players: [{ playerId: 'c', role: 'creature', forfeited: false }, { playerId: 'h', role: 'hunted', forfeited: false }, { playerId: 'other', role: 'hunted', forfeited: false }] };
  assert.match(notAloneLeaveMessage(game, 'h'), /cannot win/);
  assert.match(notAloneLeaveMessage(game, 'h'), /only the current round/);
  assert.match(notAloneLeaveMessage(game, 'h'), /then your seat is removed/);
  assert.match(notAloneLeaveMessage(game, 'h'), /targets stay unchanged/);
  assert.match(notAloneLeaveMessage(game, 'h'), /If no Hunted remain eligible, the Creature wins/);
  game.players[2].forfeited = true;
  assert.match(notAloneLeaveMessage(game, 'h'), /last Hunted/);
  assert.match(notAloneLeaveMessage(game, 'other'), /already forfeited/);
  assert.doesNotMatch(notAloneLeaveMessage(game, 'other'), /Creature victory|remaining Hunted win/);
});

test('Hunted forfeit copy distinguishes current-round finishing, retired history and completed results', () => {
  const { notAloneForfeitLabel, notAloneForfeitMessage } = load('decision.ts', {});
  const game = { status: 'playing', huntedOrder: ['h'] };
  const player = { playerId: 'h', role: 'hunted', forfeited: true };
  assert.equal(notAloneForfeitLabel(game, player), 'FORFEITED · FINISHING THIS ROUND');
  assert.match(notAloneForfeitMessage(game, player), /this round only/);
  assert.match(notAloneForfeitMessage(game, player), /removed before the next round/);
  game.huntedOrder = [];
  assert.equal(notAloneForfeitLabel(game, player), 'FORFEITED · REMOVED FROM PLAY');
  assert.match(notAloneForfeitMessage(game, player), /no longer in active play/);
  assert.doesNotMatch(notAloneForfeitMessage(game, player), /Automatic play|autopilot/);
  game.status = 'game_over'; game.huntedOrder = ['h'];
  assert.equal(notAloneForfeitLabel(game, player), 'FORFEITED');
  assert.doesNotMatch(notAloneForfeitMessage(game, player), /finishes|next round/);
  player.forfeited = false;
  assert.equal(notAloneForfeitLabel(game, player), '');
});

test('policy disclosure and rendered status wiring do not promise indefinite automatic play', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const reference = fs.readFileSync(path.join(__dirname, '../components/not-alone/ReferenceSheet.tsx'), 'utf8');
  assert.match(source, /notAloneForfeitMessage\(game, localPlayer\)/);
  assert.match(source, /notAloneForfeitLabel\(game, me\)/);
  assert.match(source, /notAloneForfeitLabel\(game, player\)/);
  assert.doesNotMatch(source, /remain marked as autopilot|YOUR SEAT IS FINISHING BY AUTOPILOT|deterministic autopilot/);
  assert.match(source, /Forfeited seats remain in expedition history and cannot win\./);
  assert.match(reference, /reconnect grace expires/);
  assert.match(reference, /current round only/);
  assert.match(reference, /before the next round/);
  assert.match(reference, /original Rescue and Assimilation targets/);
  assert.match(reference, /completed result does not change/);
});

test('finished or missing seats do not claim a new result, and the prompt uses current role copy', () => {
  const { notAloneLeaveMessage } = load('decision.ts', {});
  const game = { status: 'game_over', players: [{ playerId: 'c', role: 'creature', forfeited: false }] };
  assert.equal(notAloneLeaveMessage(game, 'c'), 'This closes your seat and returns to the arcade.');
  game.status = 'playing';
  assert.match(notAloneLeaveMessage(game, null), /Any active seat you own will forfeit/);
  const source = fs.readFileSync(path.join(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const prompt = source.slice(source.indexOf('const requestLeave'), source.indexOf('const cancelChoice'));
  assert.match(prompt, /notAloneLeaveMessage\(captured, playerId\)/);
  assert.match(prompt, /\[cleanupPending, leave, playerId\]/);
});
