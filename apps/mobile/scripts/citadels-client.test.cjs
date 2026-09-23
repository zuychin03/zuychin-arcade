const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');


function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/citadels/', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function actionHarness() {
  const hooks = [], effects = [], calls = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, dirty = false, timerId = 0, result;
  const store = { token: 'synthetic-session', playerId: 'p1', roomCode: '7KPM-R4TX', citadelsPublic: null, citadelsPrivate: null, citadelsSyncing: true };
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
  useGameStore.getState = () => ({ ...store, setCitadelsSyncing(value) { store.citadelsSyncing = value; dirty = true; } });
  const { useCitadelsActions: renderHook } = load('useCitadelsActions.ts', {
    react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const render = () => { cursor = 0; dirty = false; result = renderHook(); while (effects.length) effects.shift()(); };
  const flush = () => { for (let i = 0; i < 20; i++) { render(); if (!dirty) return; } assert.fail('Unsettled hook'); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); flush(); };
  const snapshot = (revision, privateFrame = false) => ({ gameId: 'citadels', revision, roomCode: store.roomCode, ...(privateFrame ? { playerId: store.playerId } : {}) });
  const pair = (revision) => { store.citadelsPublic = snapshot(revision); store.citadelsPrivate = snapshot(revision, true); store.citadelsSyncing = false; event('game_state', store.citadelsPublic); event('private_state', store.citadelsPrivate); };
  flush();
  return { store, socket, calls, timers, listeners, event, pair, snapshot, flush, unmount() { hooks.forEach((hook) => hook.cleanup?.()); }, get actions() { return result; }, expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } flush(); } };
}

test('malformed server events cannot throw, change pending state or trigger refreshes', () => {
  const h = actionHarness(); h.pair(1);
  assert.equal(h.actions.send('choose_income', {}, 'Decision', 1), true);
  h.flush();
  const pending = h.actions.pending;
  const calls = h.calls.length;
  for (const event of ['game_state', 'private_state', 'citadels:action_accepted', 'action_rejected']) {
    for (const value of [null, undefined, [], 1, 'invalid', {}, { reason: 42 }]) {
      assert.doesNotThrow(() => h.event(event, value), event);
      assert.equal(h.actions.pending, pending);
      assert.equal(h.calls.length, calls);
    }
  }
  h.event('citadels:action_accepted', { action: 'choose_income', revision: 2 });
  h.pair(2);
  assert.equal(Boolean(h.actions.pending), false);
});

test('requires a fresh adopted public/private pair before sending', () => {
  const h = actionHarness();
  assert.equal(h.actions.send('choose_income', {}, 'Take income', 1), false);
  h.pair(1);
  assert.equal(h.actions.send('choose_income', {}, 'Take income', 1), true);
  assert.equal(h.calls.at(-1)[1].expectedRevision, 1);
});

test('fences duplicate input before React renders', () => {
  const h = actionHarness(); h.pair(1);
  const send = h.actions.send;
  assert.equal(send('build', { cardId: 'x' }, 'Build district', 1), true);
  assert.equal(send('build', { cardId: 'x' }, 'Build district', 1), false);
  assert.equal(h.calls.filter(([name]) => name === 'citadels:build').length, 1);
});

test('unrelated ack and snapshot do not confirm a command', () => {
  const h = actionHarness(); h.pair(1);
  h.actions.send('build', {}, 'Build district', 1); h.flush();
  h.event('citadels:action_accepted', { action: 'choose_income', revision: 2 }); h.pair(2);
  assert.equal(h.actions.pending, true);
});

test('matching ack waits for the adopted matching pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('build', { cardIndex: 1 }, 'Build district', 1);
  h.event('citadels:action_accepted', { action: 'build', revision: 2 });
  assert.equal(h.actions.pending, true);
  h.event('game_state', h.snapshot(2));
  assert.equal(h.actions.pending, true);
  h.pair(2);
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.message, 'Build district accepted.');
  h.expire(2500); assert.equal(h.actions.message, null);
});

test('partial pair blocks synchronously without immediately disabling focused controls', () => {
  const h = actionHarness(); h.pair(3);
  h.store.citadelsSyncing = true; h.event('game_state', h.snapshot(4));
  assert.equal(h.actions.busy, false);
  assert.equal(h.actions.send('choose_income', {}, 'Take income', 3), false);
  h.expire(150); assert.equal(h.actions.busy, true);
  h.pair(4); assert.equal(h.actions.busy, false);
});

test('stale revision, wrong identity and replacement session are rejected', () => {
  const h = actionHarness(); h.pair(3);
  assert.equal(h.actions.send('choose_income', {}, 'Take income', 2), false);
  const oldSend = h.actions.send;
  h.store.token = 'new-synthetic-session';
  assert.equal(oldSend('choose_income', {}, 'Take income', 3), false);
  h.store.token = 'synthetic-session'; h.store.citadelsPrivate.playerId = 'other';
  assert.equal(oldSend('choose_income', {}, 'Take income', 3), false);
});

test('rejection keeps controls fenced until refreshed', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('build', {}, 'Action', 1);
  h.event('action_rejected', { reason: 'Changed turn' });
  assert.equal(h.actions.pending, false);
  assert.equal(h.actions.send('build', {}, 'Action', 1), false);
  h.pair(2); assert.equal(h.actions.send('choose_income', {}, 'Take income', 2), true);
});

test('old async callbacks and timeout cannot mutate a replacement session', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose_income', {}, 'Take income', 1);
  const oldCallbacks = ['action_rejected', 'disconnect', 'connect'].map((name) => [...h.listeners.get(name)][0]);
  const oldRefresh = h.actions.refresh;
  const oldTimeout = [...h.timers.values()].find((timer) => timer.ms === 12000).fn;
  h.store.token = 'replacement'; h.flush(); h.pair(20);
  const before = h.calls.length;
  oldCallbacks[0]({ reason: 'late error' }); oldCallbacks[1](); oldCallbacks[2](); oldTimeout(); oldRefresh(); h.flush();
  assert.equal(h.calls.length, before);
  assert.equal(h.store.citadelsSyncing, false);
  assert.equal(h.actions.connected, true);
  assert.equal(h.actions.synced, true);
  assert(!h.actions.message?.includes('late error'));
});

test('timeout requests state and permits retry only after a fresh pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('build', { cardIndex: 0 }, 'Build district', 1);
  h.expire(12000);
  assert.match(h.actions.message, /No confirmation/);
  assert.equal(h.actions.send('build', { cardIndex: 0 }, 'Build district', 1), false);
  h.pair(1); assert.equal(h.actions.send('build', { cardIndex: 0 }, 'Build district', 1), true);
});

test('disconnect clears pending but cannot send using the old pair', () => {
  const h = actionHarness(); h.pair(1); h.actions.send('choose_income', {}, 'Take income', 1);
  h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, false);
  h.socket.connected = true; h.event('connect');
  assert.equal(h.actions.send('choose_income', {}, 'Take income', 1), false);
  h.pair(2); assert.equal(h.actions.send('choose_income', {}, 'Take income', 2), true);
});

test('rematch uses strict empty payload and requires a newer revision ack', () => {
  const h = actionHarness(); h.pair(100); h.actions.send('start', {}, 'Start', 100); h.flush();
  assert.equal(h.calls.at(-1).length, 1);
  h.event('citadels:action_accepted', { action: 'start', revision: 1 }); assert.equal(h.actions.pending, true);
  h.event('citadels:action_accepted', { action: 'start', revision: 101 }); h.pair(101); assert.equal(h.actions.pending, false);
});



test('private room mismatch is rejected synchronously', () => {
  const h = actionHarness(); h.pair(0);
  h.store.citadelsPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send('build', { action: 'income' }, 'Income', 0), false);
});

test('retired send closure cannot emit after unmount with the same live session', () => {
  const h = actionHarness(); h.pair(4); const send = h.actions.send;
  h.unmount(); const calls = h.calls.length;
  assert.equal(send('build', { action: 'income' }, 'Income', 4), false);
  assert.equal(h.calls.length, calls);
});

test('initial revision zero sends the namespaced protocol event', () => {
  const h = actionHarness(); h.pair(0);
  assert.equal(h.actions.send('build', { action: 'income' }, 'Income', 0), true);
  assert.equal(h.calls.at(-1)[0], 'citadels:build');
  assert.equal(h.calls.at(-1)[1].expectedRevision, 0);
});

test('local command tracking ignores reordered and invalid revision metadata', () => {
  const h = actionHarness(); h.pair(3);
  h.store.citadelsSyncing = true;
  h.event('game_state', h.snapshot(5));
  for (const revision of [4, -1, NaN, Infinity, 5.5]) h.event('game_state', h.snapshot(revision));
  h.store.citadelsPublic = h.snapshot(5); h.store.citadelsPrivate = h.snapshot(5, true); h.store.citadelsSyncing = false;
  h.event('private_state', h.snapshot(5, true));
  assert.equal(h.actions.synced, true);
  assert.equal(h.actions.send('build', { action: 'income' }, 'Income', 5), true);
});

test('server settlement can advance the pair beyond my accepted command', () => {
  const h = actionHarness(); h.pair(0);
  h.actions.send('choose_income', { choice: 'gold' }, 'Take gold', 0); h.flush();
  h.pair(1); assert.equal(h.actions.pending, true);
  h.event('citadels:action_accepted', { action: 'choose_income', revision: 2 });
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
  const { useCitadelsDecisionAttention: renderAttention } = load('useCitadelsDecisionAttention.ts', { react }, {
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


test('completed-court Leave callback cannot forfeit a rematch before or after effect cleanup', () => {
  const { isCitadelsLeavePromptCurrent: current } = load('decision.ts', {});
  const captured = { status: 'game_over', revision: 195 };
  assert.equal(current(captured, captured, 1, 1), true);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 1), false);
  assert.equal(current(captured, { status: 'playing', revision: 196 }, 1, 2), false);
  assert.equal(current(captured, { status: 'game_over', revision: 390 }, 1, 1), false);
  assert.equal(current(captured, null, 1, 1), false);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'playing', revision: 11 }, 1, 1), true);
  assert.equal(current({ status: 'playing', revision: 10 }, { status: 'game_over', revision: 11 }, 1, 1), false);
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  assert.match(source, /leaveEpochRef.current \+= 1/);
  assert.match(source, /\[game\?\.status, room\?\.roomCode, token\]/);
  assert.match(source, /if \(!isCitadelsLeavePromptCurrent\(captured/);
});

test('actual retained Leave callback reads the changed store before React effects run', () => {
  const { isCitadelsLeavePromptCurrent } = load('decision.ts', {});
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  const body = source.match(/text: 'LEAVE', style: 'destructive', onPress: \(\) => \{([\s\S]*?)\n        \}/)?.[1];
  assert(body);
  let current = { status: 'game_over', revision: 195 }, leaves = 0;
  const leaveEpochRef = { current: 1 };
  const callback = vm.runInNewContext('(() => {' + body + '})', {
    captured: { ...current }, epoch: 1, leaveEpochRef, leavePromptOpenRef: { current: true },
    useGameStore: { getState: () => ({ citadelsPublic: current }) },
    isCitadelsLeavePromptCurrent, ownsPrompt: () => true, leave: () => { leaves++; },
  });
  current = { status: 'playing', revision: 196 };
  callback(); assert.equal(leaves, 0);
  leaveEpochRef.current = 2;
  callback(); assert.equal(leaves, 0);
});

test('shared room safety preserves Citadels identity and exact protocol start', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '../app/citadels', name), 'utf8');
  assert.match(read('index.tsx'), /RemainingLanding/);
  assert.match(read('index.tsx'), /presentation="illustrated"/);
  assert.match(read('index.tsx'), /GameCover nativeID="citadels-entrance-art"/);
  assert.match(read('index.tsx'), /citadels-hero\.webp/);
  assert.match(read('index.tsx'), /fallback=\{<CitadelsMark/);
  assert.match(read('join.tsx'), /RemainingJoin/); assert.match(read('lobby.tsx'), /RemainingLobby/);
  assert.match(read('game.tsx'), /await clearAuthIfMatches\(token\)/);
});


test('hyphenated gameplay events retain underscore semantic acknowledgement kinds', () => {
  for (const action of ['choose_character', 'choose_income', 'keep_district', 'district_power', 'end_turn']) {
    const h = actionHarness(); h.pair(0);
    assert.equal(h.actions.send(action, {}, 'Decision', 0), true);
    assert.equal(h.calls.at(-1)[0], 'citadels:' + action.replaceAll('_', '-'));
    h.event('citadels:action_accepted', { action, revision: 1 }); h.pair(1);
    assert.equal(h.actions.pending, false);
  }
});

const jsx = (type, props) => ({ type, props });
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

test('unique district explanations and names remain complete at large text sizes', () => {
  const { CitadelsDistrictView } = load('CitadelsCard.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 375, fontScale: 2 }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': { CITADELS_ROLE_BY_ID: {} },
    '../ui/ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { CITADELS: {} },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, './CitadelsDistrictArtwork': { CitadelsDistrictArtwork: 'Artwork', citadelsDistrictIcons: { unique: 'star-four-points-outline' } },
    './CitadelsRoleArtwork': { CitadelsRoleArtwork: 'RoleArtwork' },
  });
  const text = 'A complete long unique district explanation that must not be truncated.';
  const tree = CitadelsDistrictView({ card: { id: 'u', name: 'Imperial Treasury', cost: 5, color: 'unique', effectText: text }, compact: true, onPress() {} });
  assert.match(tree.props.accessibilityLabel, /Imperial Treasury/);
  assert(tree.props.accessibilityLabel.includes(text));
  assert(nodes(tree).filter((node) => node.type === 'Text').every((node) => node.props.numberOfLines === undefined));
  assert.equal(tree.props.children.props.style.height, undefined);
});

test('narrow ability description is not duplicated alongside a fixed-width role card', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  const ability = source.slice(source.indexOf('{canUseAbilities && myRole'), source.indexOf("{mode === 'assassinate'"));
  assert(!ability.includes('<CitadelsRoleCard'));
  assert.equal((ability.match(/myRole.summary/g) ?? []).length, 1);
  assert.match(source, /flexBasis: compact \? '100%' : 210 \* textScale/);
  assert.doesNotMatch(source, /numberOfLines=\{1\}/);
});

test('web decision attention scrolls the actual heading before focus instead of cached native layout', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  const body = source.match(/const focusDecision = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[mode, reduceMotion\]\)/)?.[1];
  assert(body);
  const calls = [];
  const heading = {
    setAttribute() {},
    scrollIntoView(options) { calls.push({ action: 'scroll', block: options.block, inline: options.inline }); },
    focus(options) { calls.push({ action: 'focus', preventScroll: options.preventScroll }); },
  };
  const focus = vm.runInNewContext('(() => {' + body + '})', {
    restoringModeFocusRef: { current: false }, decisionHeadingRef: { current: {} },
    mainScrollRef: { current: { scrollTo() { assert.fail('Web must not use cached native Y'); } } },
    decisionZoneYRef: { current: 99999 }, Platform: { OS: 'web' }, mode: null, reduceMotion: true,
    document: { getElementById: () => heading },
  });
  assert.equal(focus(), true);
  assert.deepEqual(calls, [
    { action: 'scroll', block: 'start', inline: 'nearest' },
    { action: 'focus', preventScroll: true },
  ]);
});

test('skipped-turn explanation uses only the owned paired role and public mark', () => {
  const { isOwnCitadelsCharacterKilled } = load('decision.ts', {});
  const game = { roomCode: 'COURT', revision: 12, status: 'playing', phase: 'choose_income', killedRole: 'merchant' };
  const mine = { roomCode: 'COURT', revision: 12, playerId: 'mine', chosenRole: 'merchant' };
  assert.equal(isOwnCitadelsCharacterKilled(game, mine, 'mine'), true);
  assert.equal(isOwnCitadelsCharacterKilled(game, { ...mine, chosenRole: 'king' }, 'mine'), false);
  assert.equal(isOwnCitadelsCharacterKilled({ ...game, killedRole: null }, mine, 'mine'), false);
  for (const privateState of [null, { ...mine, playerId: 'other' }, { ...mine, roomCode: 'OTHER' }, { ...mine, revision: 11 }, { ...mine, chosenRole: null }]) {
    assert.equal(isOwnCitadelsCharacterKilled(game, privateState, 'mine'), false);
  }
  assert.equal(isOwnCitadelsCharacterKilled(null, mine, 'mine'), false);
  assert.equal(isOwnCitadelsCharacterKilled(game, mine, null), false);
});

test('skipped-turn explanation clears at draft and terminal and survives unrelated revisions', () => {
  const { isOwnCitadelsCharacterKilled } = load('decision.ts', {});
  const game = { roomCode: 'COURT', revision: 12, status: 'playing', phase: 'action', killedRole: 'merchant' };
  const mine = { roomCode: 'COURT', revision: 12, playerId: 'mine', chosenRole: 'merchant' };
  assert.equal(isOwnCitadelsCharacterKilled({ ...game, phase: 'drafting' }, mine, 'mine'), false);
  assert.equal(isOwnCitadelsCharacterKilled({ ...game, status: 'game_over', phase: 'game_over' }, mine, 'mine'), false);
  assert.equal(isOwnCitadelsCharacterKilled({ ...game, revision: 13 }, { ...mine, revision: 13 }, 'mine'), true);
});

test('final-round skipped copy promises scoring rather than a nonexistent next draft', () => {
  const { citadelsSkippedTurnMessage } = load('decision.ts', {});
  assert.match(citadelsSkippedTurnMessage('Merchant', false), /Choose a new character next round/);
  const final = citadelsSkippedTurnMessage('Merchant', true);
  assert.match(final, /Your city still counts in final scoring/);
  assert.doesNotMatch(final, /next round/);
});

test('private skipped notice is visible and announced without changing decision attention', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  assert.match(source, /if \(skippedTurnMessage\) return skippedTurnMessage/);
  assert.match(source, /skippedTurnMessage \? 'YOUR TURN IS SKIPPED'/);
  assert.match(source, /\{skippedTurnMessage\}<\/Text>/);
  const attention = source.slice(source.indexOf('const localDecisionKey'), source.indexOf('const meForAnnouncement'));
  assert(!attention.includes('skippedTurnMessage'));
  assert.match(source, /\{canUseAbilities && myRole/);
});

test('forfeited seats distinguish current-round autopilot from archived history', () => {
  const { citadelsForfeitLabel } = load('decision.ts', {});
  const game = { status: 'playing', turnOrder: ['mine', 'ghost'] };
  assert.equal(citadelsForfeitLabel(game, 'ghost'), 'FORFEITED · FINISHING THIS ROUND');
  assert.equal(citadelsForfeitLabel({ ...game, turnOrder: ['mine'] }, 'ghost'), 'FORFEITED · REMOVED FROM PLAY');
  assert.equal(citadelsForfeitLabel({ ...game, status: 'game_over' }, 'ghost'), 'FORFEITED · INELIGIBLE');
});

test('below-four cancellation explains no scoring without inventing universal forfeits', () => {
  const { citadelsNoWinnerMessage } = load('decision.ts', {});
  assert.match(citadelsNoWinnerMessage('not_enough_players'), /Fewer than four eligible builders/);
  assert.match(citadelsNoWinnerMessage('not_enough_players'), /without final scoring or a competitive result/);
  assert.equal(citadelsNoWinnerMessage(null), 'The court ended without an eligible winner.');
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  assert.match(source, /unscored \? '' : `\$\{index \+ 1\}\. `/);
  assert.match(source, /unscored \? forfeited \? 'FORFEITED' : 'NOT SCORED'/);
  assert.match(source, /!unscored && score/);
  assert.doesNotMatch(source, /Every builder forfeited this court/);
});

test('Magician and Warlord retain current-round ghosts but exclude archived targets', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  assert.match(source, /player\.playerId !== playerId && game\.turnOrder\.includes\(player\.playerId\)/);
  assert.match(source, /player\.city\.length > 0 && game\.turnOrder\.includes\(player\.playerId\)/);
  assert.match(source, /citadelsForfeitLabel\(game, player\.playerId\)/);
});

test('forfeited roster and result information retains full text contrast', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
  const rows = source.split('\n').filter(line => line.includes('<View key={player.playerId} accessible accessibilityLabel='));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.doesNotMatch(row, /opacity:/);
    assert.match(row, /borderColor: forfeited \? CITADELS.crimson/);
  }
});
