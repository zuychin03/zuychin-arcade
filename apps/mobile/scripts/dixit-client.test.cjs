const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '..', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require(name) { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}
function hooks() {
  const cells = [], effects = []; let cursor = 0, dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { const next = typeof value === 'function' ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; cells[i] ??= { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) cells[i] = { value: fn, deps }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn) { for (let i = 0; i < 30; i++) { cursor = 0; dirty = false; const output = fn(); while (effects.length) effects.shift()(); if (!dirty) return output; } assert.fail('Hook did not settle'); }, cleanup() { cells.forEach(c => c.cleanup?.()); } };
}
function actionHarness() {
  const h = hooks(), calls = [], listeners = new Map(), timers = new Map(); let timerId = 0, result;
  const state = { token: 'fixture-token', playerId: 'p1', roomCode: '7KPM-R4TX', dixitPublic: null, dixitPrivate: null, dixitSyncing: true };
  const socket = { connected: true, on(e, fn) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); }, off(e, fn) { listeners.get(e)?.delete(fn); }, emit(...args) { calls.push(args); }, connect() { calls.push(['connect']); } };
  const useGameStore = selector => selector(state); useGameStore.getState = () => ({ ...state, setDixitSyncing: value => { state.dixitSyncing = value; } });
  const { useDixitActions } = load('components/dixit/useDixitActions.ts', { react: h.react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore } }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) });
  const render = () => { result = h.render(useDixitActions); return result; };
  const pair = (revision = 1, roundNumber = 1) => { state.dixitPublic = { roomCode: state.roomCode, revision, roundNumber, phase: 'vote' }; state.dixitPrivate = { roomCode: state.roomCode, revision, playerId: state.playerId }; state.dixitSyncing = false; render(); };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); render(); };
  render();
  return { state, socket, calls, pair, render, event, cleanup: h.cleanup, get actions() { return result; }, expire() { for (const [id, timer] of [...timers]) if (timer.ms === 12000) { timers.delete(id); timer.fn(); } render(); } };
}
test('Dixit requires an adopted pair and fences repeated clicks synchronously', () => {
  const h = actionHarness(); assert.equal(h.actions.send({ type: 'ready' }), false); h.pair(4, 2);
  assert.equal(h.actions.send({ type: 'vote', slots: [2, 2] }), true); assert.equal(h.actions.send({ type: 'vote', slots: [2, 3] }), false);
  assert.equal(JSON.stringify(h.calls.at(-1)), JSON.stringify(['dixit:action', { action: { type: 'vote', slots: [2, 2] }, expectedRevision: 4, roundNumber: 2 }])); h.cleanup();
});
test('acknowledgement and paired state are both required in either arrival order', () => {
  for (const ackFirst of [true, false]) {
    const h = actionHarness(); h.pair(); h.actions.send({ type: 'ready' }); h.render();
    const ack = () => h.event('dixit:action_accepted', { action: 'ready', revision: 2 });
    if (ackFirst) ack(); else h.pair(2); assert.equal(h.actions.pending, true);
    if (ackFirst) h.pair(2); else ack(); assert.equal(h.actions.pending, false); h.cleanup();
  }
});
test('malformed and unrelated acknowledgements cannot unlock a pending action', () => {
  const h = actionHarness(); h.pair(); h.actions.send({ type: 'ready' }); h.render();
  for (const ack of [null, {}, 3, [], { action: 'vote', revision: 2 }, { action: 'ready', revision: 1 }, { action: 'ready', revision: Infinity }]) {
    assert.doesNotThrow(() => h.event('dixit:action_accepted', ack)); assert.equal(h.actions.pending, true);
  } h.cleanup();
});
test('timeout refreshes without replay and reconnection waits for a new pair', () => {
  const h = actionHarness(); h.pair(); h.actions.send({ type: 'vote', slots: [2, 3] }); h.expire();
  assert.equal(h.state.dixitSyncing, true); assert.equal(h.calls.at(-1)[0], 'request_state'); assert.equal(h.calls.filter(c => c[0] === 'dixit:action').length, 1);
  h.socket.connected = false; h.event('disconnect'); assert.equal(h.actions.busy, true);
  h.socket.connected = true; h.event('connect'); assert.equal(h.actions.busy, true); h.pair(2); assert.equal(h.actions.busy, false); h.cleanup();
});
test('old session callbacks and another player private state fail closed', () => {
  const h = actionHarness(); h.pair(); h.state.dixitPrivate.playerId = 'p2'; assert.equal(h.actions.send({ type: 'ready' }), false);
  h.pair(); const send = h.actions.send; h.state.token = 'replacement'; assert.equal(send({ type: 'ready' }), false); h.cleanup();
});
test('captured controls cannot stamp an old decision into a later round', () => {
  const h = actionHarness(); h.pair(); const send = h.actions.send; h.pair(8, 2);
  assert.equal(send({ type: 'vote', slots: [2, 3] }), false); h.cleanup();
});
test('a private projection from another room cannot authorise a command', () => {
  const h = actionHarness(); h.pair(); h.state.dixitPrivate.roomCode = 'OTHER';
  assert.equal(h.actions.send({ type: 'ready' }), false); h.cleanup();
});
test('stale clue and start callbacks cannot cross a revision even when round and phase repeat', () => {
  for (const action of ['start', { type: 'clue', cardId: 'dream-01', clue: 'Moon' }]) {
    const h = actionHarness(); h.pair(); const old = h.actions.send; h.pair(12);
    assert.equal(old(action), false); assert.equal(h.calls.some(c => c[0] === 'start_game' || c[0] === 'dixit:action'), false); h.cleanup();
  }
});
test('simultaneous votes and submissions preserve their captured revision for server window checks', () => {
  for (const action of [{ type: 'vote', slots: [2, 3] }, { type: 'submit', cardIds: ['dream-01'] }]) {
    const h = actionHarness(); h.pair(4); const old = h.actions.send; h.pair(7);
    assert.equal(old(action), true); assert.equal(h.calls.at(-1)[1].expectedRevision, 4); assert.equal(h.calls.at(-1)[1].roundNumber, 1); h.cleanup();
  }
});

const jsx = (type, props) => type === 'CardGrid' ? { type, props: { children: props.items.map(item => props.renderItem(item, 160)) } } : { type, props };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function gameHarness(phase = 'vote') {
  const h = hooks(), calls = [];
  const players = ['p1', 'p2', 'p3'].map(playerId => ({ playerId, displayName: playerId, score: 0, forfeited: false, submitted: false, voted: false, ready: false }));
  const state = { token: 'fixture', playerId: 'p1', room: { roomCode: 'ROOM', players: players.map(p => ({ ...p, isHost: p.playerId === 'p1', isConnected: true })) }, dixitPublic: { roomCode: 'ROOM', roundNumber: 1, phase, status: 'playing', players, storytellerId: 'p2', clue: 'Dream', winnerIds: [], table: [1, 2, 3, 4, 5].map(slot => ({ slot, cardId: `dixit_${String(slot).padStart(2, '0')}` })), result: null }, dixitPrivate: { playerId: 'p1', hand: ['dixit_06', 'dixit_07', 'dixit_08'], submittedCardIds: ['dixit_01', 'dixit_02'], votes: null, submissionCount: 2 } };
  const modules = { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Modal: 'Modal', Platform: { OS: 'web' }, ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 320, height: 568, fontScale: 1 }) }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': { DIXIT_CLUE_MAX_LENGTH: 240 }, '../../constants/theme': { DIXIT: {} }, '../../store/useGameStore': { useGameStore: selector => selector(state) }, '../../hooks/useWebModalFocus': { useWebModalFocus() {} }, '../../components/dixit/useDixitActions': { useDixitActions: () => ({ busy: false, pending: false, send: action => calls.push(action) }) }, '../../components/dixit/useDixitLeave': { useDixitLeave: () => ({ leaving: false, requestLeave() {} }) } };
  for (const [folder, name] of [['ui', 'CardGrid'], ['ui', 'NeonButton'], ['ui', 'ScalePressable'], ['ui', 'GameRecovery'], ['dixit', 'DreamCard'], ['dixit', 'ReferenceSheet']]) modules[`../../components/${folder}/${name}`] = { [name === 'ReferenceSheet' ? 'DixitReferenceSheet' : name]: name };
  const Game = load('app/dixit-odyssey/game.tsx', modules).default;
  const render = () => h.render(Game);
  const find = label => nodes(render()).find(n => n.props?.label === label || n.props?.accessibilityLabel === label);
  render(); return { state, calls, render, find, cleanup: h.cleanup };
}
test('two voting dials support both together and split, excluding both own images', () => {
  for (const slots of [[3, 3], [3, 4]]) {
    const h = gameHarness();
    for (const slot of [1, 2]) for (const dial of [1, 2]) assert.equal(h.find(`Place vote ${dial} on image ${slot}, your own image cannot be chosen`).props.disabled, true);
    slots.forEach((slot, i) => h.find(`Place vote ${i + 1} on image ${slot}`).props.onPress());
    const button = nodes(h.render()).find(n => n.type === 'NeonButton' && /LOCK/i.test(n.props.label));
    assert(button); assert.equal(button.props.disabled, false); button.props.onPress(); assert.equal(JSON.stringify(h.calls.at(-1)), JSON.stringify({ type: 'vote', slots })); h.cleanup();
  }
});
test('three-player submissions require exactly two distinct choices and reset next round', () => {
  const h = gameHarness('submit'); h.find('CHOOSE 06').props.onPress(); h.find('CHOOSE 07').props.onPress(); h.find('CHOOSE 08').props.onPress();
  const button = h.find('LOCK IN BOTH IMAGES');
  assert(button); assert.equal(button.props.disabled, false); button.props.onPress(); assert.equal(JSON.stringify(h.calls.at(-1)), JSON.stringify({ type: 'submit', cardIds: ['dixit_06', 'dixit_07'] }));
  h.state.dixitPublic.roundNumber = 2; assert(h.find('CHOOSE 06')); h.cleanup();
});
test('clues use single-line input and cannot send server-rejected control characters', () => {
  const h = gameHarness('clue'); h.state.dixitPublic.storytellerId = 'p1'; h.find('CHOOSE 06').props.onPress();
  const input = () => nodes(h.render()).find(n => n.type === 'TextInput'); assert.notEqual(input().props.multiline, true);
  for (const clue of ['Moon\nriver', 'Moon\triver', 'Moon\u0000river', 'x'.repeat(241), '   ']) {
    input().props.onChangeText(clue); assert.equal(h.find('SHARE CLUE AND IMAGE').props.disabled, true);
    h.find('SHARE CLUE AND IMAGE').props.onPress(); assert.equal(h.calls.length, 0);
  }
  input().props.onChangeText('  Moon river  '); assert.equal(h.find('SHARE CLUE AND IMAGE').props.disabled, false);
  h.find('SHARE CLUE AND IMAGE').props.onPress(); assert.equal(h.calls.at(-1).clue, 'Moon river'); h.cleanup();
});
test('a failed illustration cannot poison the next card or a late image error', () => {
  const h = hooks(); const art = { 'dream-01': { source: 1 }, 'dream-02': { source: 2 } };
  const { DreamCard } = load('components/dixit/DreamCard.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Image: 'Image', Text: 'Text', View: 'View' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../../constants/theme': { DIXIT: {} }, '../ui/CardSurface': { CardSurface: 'CardSurface' }, '../ui/ScalePressable': { ScalePressable: 'ScalePressable' }, './artwork': { DIXIT_ARTWORK: art } });
  const render = cardId => h.render(() => DreamCard({ cardId, width: 160 })); const image = cardId => nodes(render(cardId)).find(n => n.type === 'Image');
  const oldError = image('dream-01').props.onError; oldError(); assert.equal(image('dream-01'), undefined);
  assert.equal(image('dream-02').props.source, 2); oldError(); assert.equal(image('dream-02').props.source, 2); h.cleanup();
});
test('rematch is host-only and requires three connected retained seats', () => {
  const h = gameHarness('game_over'); h.state.dixitPublic.status = 'game_over';
  assert.equal(h.find('PLAY AGAIN').props.disabled, false); h.find('PLAY AGAIN').props.onPress(); assert.equal(h.calls.at(-1), 'start');
  h.state.room.players[1].isConnected = false; assert.equal(h.find('PLAY AGAIN').props.disabled, true);
  h.state.room.players[0].isHost = false; assert.equal(h.find('PLAY AGAIN'), undefined); h.cleanup();
});
test('unrevealed table does not render other authors or vote attribution', () => {
  const h = gameHarness(); const text = nodes(h.render()).filter(n => n.type === 'Text').map(n => JSON.stringify(n.props.children)).join(' ');
  assert.equal(text.includes('From '), false); assert.equal(text.includes('Votes:'), false); h.cleanup();
});
function leaveHarness(overrides = {}) {
  const h = hooks(), calls = []; let dialog = null, result;
  const state = { token: 'fixture', roomCode: 'ROOM', dixitPublic: { status: 'playing' }, clearAll() { calls.push('clear'); state.token = null; } };
  const store = selector => selector(state); store.getState = () => state;
  const { useDixitLeave } = load('components/dixit/useDixitLeave.ts', {
    react: h.react, 'react-native': { Platform: { OS: 'web' }, BackHandler: {} }, 'expo-router': { router: { replace() { calls.push('route'); } } }, '../../store/useGameStore': { useGameStore: store },
    '../../hooks/useNativeLeaveGuard': { useNativeLeaveGuard: () => (fn, allowed) => { if (allowed()) fn(); } }, '../../hooks/useWebBackGuard': { useWebBackGuard() {} },
    '../../hooks/useSocket': { getSocket: () => ({ disconnect() { calls.push('disconnect'); } }) }, '../../lib/api': { leaveRoom: async () => { calls.push('leave'); await overrides.leave?.(); } },
    '../../lib/storage': { clearAuthIfMatches: async () => { calls.push('storage'); await overrides.storage?.(); } },
    '../../lib/dialog': { showDialog(title, message, buttons) { dialog = { title, message, buttons }; }, useDialogStore: { getState: () => ({ dialog, hide() { dialog = null; } }) } },
  });
  const render = () => { result = h.render(() => useDixitLeave(() => false)); return result; }; render();
  return { state, calls, render, cleanup: h.cleanup, get actions() { return result; }, get dialog() { return dialog; }, confirm: () => dialog.buttons.find(b => b.text === 'LEAVE').onPress() };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('leave requires confirmation and storage failure retries without a second forfeit', async () => {
  let attempts = 0; const h = leaveHarness({ storage() { if (attempts++ === 0) throw new Error('fixture'); } });
  h.actions.requestLeave(); assert.match(h.dialog.message, /fewer than three/); assert.equal(h.calls.length, 0);
  h.confirm(); await tick(); h.render(); assert.match(h.actions.error, /saved details/);
  h.actions.requestLeave(); await tick(); h.render(); assert.equal(h.calls.filter(c => c === 'leave').length, 1); assert.equal(h.calls.filter(c => c === 'storage').length, 2); assert(h.calls.includes('clear')); h.cleanup();
});
test('a pending old-seat leave cannot disconnect or clear its replacement', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); const h = leaveHarness({ leave: () => wait });
  h.actions.requestLeave(); h.confirm(); h.state.token = 'replacement'; release(); await tick();
  assert.equal(JSON.stringify(h.calls), '["leave"]'); h.cleanup();
});
test('a confirmation from before game over cannot forfeit the completed game', () => {
  const h = leaveHarness(); h.actions.requestLeave(); const confirm = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress;
  h.state.dixitPublic = { status: 'game_over' }; h.render(); confirm(); assert.equal(h.calls.length, 0); h.cleanup();
});
