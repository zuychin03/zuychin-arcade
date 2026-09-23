const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');


function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/skull-king/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', skullKingPublic: null, skullKingPrivate: null, skullKingSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setSkullKingSyncing(value) { store.skullKingSyncing = value; dirty = true; } });
  const { useSkullKingActions: renderHook } = load('useSkullKingActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'skull_king', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.skullKingPublic = snapshot(revision); store.skullKingPrivate = snapshot(revision, true); store.skullKingSyncing = false; event('game_state', store.skullKingPublic); event('private_state', store.skullKingPrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('bid', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'skull_king:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('skull_king:action_accepted', { action: 'bid', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('bid', {}, 'Pass', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('bid', {}, 'Pass', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('play', { cardId: 'x' }, 'Place', 1), true);
  assert.equal(send('play', { cardId: 'x' }, 'Place', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'skull_king:play').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('play', {}, 'Place', 1); h.flush();
  h.event('skull_king:action_accepted', { action: 'bid', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('play', { cardIndex: 1 }, 'Gold', 1);
  h.event('skull_king:action_accepted', { action: 'play', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Gold accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.skullKingSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('bid', {}, 'Pass', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('bid', {}, 'Pass', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('bid', {}, 'Pass', 3), false);
  h.store.token = 'synthetic-session'; h.store.skullKingPrivate.playerId = 'other';
  assert.equal(oldSend('bid', {}, 'Pass', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('play', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('play', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('bid', {}, 'Pass', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('bid', {}, 'Pass', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.skullKingSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('play', { cardIndex: 0 }, 'Gold', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('play', { cardIndex: 0 }, 'Gold', 1), false);
  h.pair(1); assert.equal(h.actions.send('play', { cardIndex: 0 }, 'Gold', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('bid', {}, 'Pass', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('bid', {}, 'Pass', 1), false);
  h.pair(2); assert.equal(h.actions.send('bid', {}, 'Pass', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('skull_king:action_accepted', { action: 'start', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('skull_king:action_accepted', { action: 'start', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});



test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.skullKingPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('play', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('play', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('play', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'skull_king:play');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.skullKingSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.skullKingPublic = h.snapshot(5); h.store.skullKingPrivate = h.snapshot(5, true); h.store.skullKingSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('play', { action: 'income' }, 'Income', 5), true);
});

test('another simultaneous bid can advance the pair before my own ack', () => {
  const h = actionHarness(); h.pair(0);
  h.actions.send('bid', { bid: 1 }, 'Bid 1', 0); h.flush();
  h.pair(1); assert.equal(h.actions.pending, true);
  h.event('skull_king:action_accepted', { action: 'bid', revision: 2 });
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
  const { useSkullDecisionAttention: renderAttention } = load('useSkullDecisionAttention.ts', { react }, {
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


test('lead instruction uses only public trick and own hand', () => {
  const { skullKingPlayInstruction: hint } = load('decision.ts', {});
  const green = { kind: 'number', suit: 'green', rank: 5 };
  assert.match(hint([], []), /You lead/);
  assert.match(hint([{ kind: 'tigress', tigressMode: 'escape' }, green], [green]), /Follow green/);
  assert.match(hint([green], []), /no green/);
  assert.match(hint([{ kind: 'pirate' }, green], [green]), /no numbered lead/);
});

test('completed-voyage Leave callback cannot forfeit a rematch before or after effect cleanup', () => {
  const { isSkullLeavePromptCurrent: current } = load('decision.ts', {});
  const captured = { status: 'game_over', revision: 195 };
  assert.equal(current(captured, captured, 1, 1), true);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 1), false);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 2), false);
  assert.equal(current(captured, { status: 'game_over', revision: 390 }, 1, 1), false);
  assert.equal(current(captured, null, 1, 1), false);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'playing', revision: 11 }, 1, 1), true);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'game_over', revision: 11 }, 1, 1), false);
  const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
  assert.match(source, /leaveEpochRef.current \+= 1/);
  assert.match(source, /\[game\?\.status, room\?\.roomCode, token\]/);
  assert.match(source, /if \(!isSkullLeavePromptCurrent\(captured/);
});

test('actual retained Leave callback reads the changed store before React effects run', () => {
  const { isSkullLeavePromptCurrent } = load('decision.ts', {});
  const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
  const body = source.match(/text: 'LEAVE', style: 'destructive', onPress: \(\) => \{([\s\S]*?)\n        \}/)?.[1];
  assert(body);
  let current = { status: 'game_over', revision: 195 }, leaves = 0;
  const leaveEpochRef = { current: 1 };
  const callback = vm.runInNewContext('(() => {' + body + '})', {
    captured: { ...current }, epoch: 1, leaveEpochRef, leavePromptOpenRef: { current: true },
    useGameStore: { getState: () => ({ skullKingPublic: current }) },
    isSkullLeavePromptCurrent, ownsPrompt: () => true, leave: () => { leaves++; },
  });
  current = { status: 'playing', revision: 196 };
  callback(); assert.equal(leaves, 0);
  leaveEpochRef.current = 2;
  callback(); assert.equal(leaves, 0);
});

test('shared room safety preserves Skull identity and exact protocol start', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '../app/skull-king', name), 'utf8');
  assert.match(read('index.tsx'), /RemainingLanding/);
  assert.match(read('index.tsx'), /presentation="illustrated"/);
  assert.match(read('index.tsx'), /GameCover nativeID="skull-entrance-art"/);
  assert.match(read('index.tsx'), /skull-hero\.webp/);
  assert.match(read('index.tsx'), /fallback=\{<SkullKingMark/);
  assert.match(read('join.tsx'), /RemainingJoin/); assert.match(read('lobby.tsx'), /RemainingLobby/);
  assert.match(read('game.tsx'), /await clearAuthIfMatches\(token\)/);
});

const jsx = (type, props) => ({ type, props });

test('empty winner list is never announced as a captain victory', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
  assert.match(source, /return winner \? `\$\{winner.displayName\} wins/);
  assert.match(source, /noWinnerCopy.summary/);
  assert.doesNotMatch(source, /winner\?\.displayName \?\? 'A captain'/);
});

test('forfeit status distinguishes current-round automatic play from removed history', () => {
  const { skullKingForfeitStatus: status } = load('decision.ts', {});
  const player = { playerId: 'departed', forfeited: true };
  const game = { status: 'playing', turnOrder: ['p1', 'departed', 'p2', 'p3'] };
  assert.match(status(game, player).label, /FINISHING ROUND/);
  assert.match(status(game, player).detail, /this round only/);
  assert.match(status({ ...game, turnOrder: ['p1', 'p2', 'p3'] }, player).label, /REMOVED/);
  assert.doesNotMatch(status({ ...game, status: 'game_over' }, player).detail, /automatically/);
  assert.equal(status(game, { ...player, forfeited: false }), null);
});

test('below-three cancellation clearly preserves prior scores without scoring the unfinished round', () => {
  const { skullKingNoWinnerCopy: copy, SKULL_LEAVE_MESSAGE: leave } = load('decision.ts', {});
  const ended = copy('not_enough_players');
  assert.equal(ended.title, 'NO WINNER');
  assert.equal(ended.summary, 'No winner, fewer than three captains remain.');
  assert.match(ended.detail, /unfinished round was not scored/);
  assert.match(ended.detail, /Completed-round scores remain available/);
  assert.match(ended.detail, /No competitive result/);
  assert.equal(copy(null).summary, 'The voyage ended without an eligible winner.');
  assert.match(leave, /forfeit immediately/);
  assert.match(leave, /only until this round ends, then is removed/);
  assert.match(leave, /fewer than three eligible captains/);
  const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
  assert.match(source, /skullKingNoWinnerCopy\(game\?\.terminationReason/);
  assert.match(source, /skullKingForfeitStatus\(game, player\)/);
  assert.match(source, /history=\{game.scoreHistory \?\? \[\]\}/);
});

test('rules distinguish recoverable grace, current-round continuity and cancellation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/skull-king/ReferenceSheet.tsx'), 'utf8');
  assert.match(source, /temporary disconnection keeps your seat during reconnect grace/);
  assert.match(source, /only through the current round, then is removed before the next deal/);
  assert.match(source, /unfinished round is not scored/);
});

test('trick size and roster counts exclude removed historical seats', () => {
  const { skullKingRosterSummary: summary } = load('decision.ts', {});
  const players = ['a', 'b', 'c', 'gone'].map((playerId) => ({ playerId }));
  assert.equal(summary({ players, turnOrder: ['a', 'b', 'c', 'gone'] }), '4 captains');
  assert.equal(summary({ players, turnOrder: ['a', 'b', 'c'] }), '3 this round · 1 historical');
  const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
  assert.match(source, /game.currentTrick.length\}\/\$\{game.turnOrder.length/);
  assert.match(source, /detail=\{skullKingRosterSummary\(game\)\}/);
  assert.match(source, /player.forfeited \? 'No further scoring. Previous completed rounds remain in the scorecard.'/);
  assert.doesNotMatch(source, /game.players.length/);
});
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const treeText = (node) => [node?.props?.children].flat(Infinity).map((child) => typeof child === 'object' ? treeText(child) : child ?? '').join(' ');

test('completed scorecard reconciles immutable history and never needs the current bid', () => {
  let cursor = 0;
  const { SkullKingScorecard } = load('Scorecard.tsx', {
    react: { useState: () => [cursor++ === 0 ? true : null, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' },
    '../ui/ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { SKULL_KING: {} },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
  });
  const tree = SkullKingScorecard({ history: [{ roundNumber: 3, cardsPerPlayer: 3, players: [{ playerId: 'gone', displayName: 'Historical Captain', bid: 2, tricksWon: 2, baseScore: 40, bonus: 30, roundScore: 70, totalScore: 90, forfeited: false }] }] });
  const row = nodes(tree).find((node) => node.props.accessibilityLabel?.startsWith('Historical Captain'));
  assert.match(row.props.accessibilityLabel, /Bid 2, won 2. Base 40, bonus 30, round 70, total 90/);
  assert.match(treeText(tree), /Round score = base \+ awarded bonus/);
  for (const button of nodes(tree).filter((node) => node.type === 'Button')) assert(button.props.style.minHeight >= 48);
});

test('empty scorecard explains that current secret bids stay hidden', () => {
  let cursor = 0;
  const { SkullKingScorecard } = load('Scorecard.tsx', {
    react: { useState: () => [cursor++ === 0 ? true : null, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' },
    '../ui/ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { SKULL_KING: {} },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
  });
  assert.match(treeText(SkullKingScorecard({ history: [] })), /Current secret bids are never shown/);
});

test('special cards can grow with text and retain complete accessible names', () => {
  const { SkullKingCardView } = load('SkullKingCard.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 375, fontScale: 1 }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../ui/ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { SKULL_KING: {} },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, './SkullKingCardArtwork': { SkullKingCardArtwork: 'Artwork', SkullKingSuitArtwork: 'SuitArtwork', SkullKingDeckArtwork: 'DeckArtwork' },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: () => ({ textScale: 1, textRef: { current: null }, onTextLayout() {} }) },
  });
  const tree = SkullKingCardView({ card: { id: 'sk', kind: 'skull_king' }, compact: true, onPress() {} });
  assert.equal(tree.props.accessibilityLabel, 'Play Skull King');
  const face = tree.props.children;
  assert.equal(face.props.style.height, undefined);
  assert.equal(face.props.style.width, 120);
  assert.equal(face.props.style.minWidth, 0);
  assert(nodes(face).some((node) => node.props.style?.minHeight === 170));
  assert(nodes(face).filter((node) => node.type === 'Text').every((node) => node.props.numberOfLines === undefined));
});
