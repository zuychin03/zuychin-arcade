const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}, globals = {}) {
  const filename = path.join(__dirname, '../components/telestrations', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require: name => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}
function hooks() {
  const cells = [], effects = []; let cursor = 0, dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!cells[i]) cells[i] = { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { const next = typeof value === 'function' ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; cells[i] ??= { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) cells[i] = { value: fn, deps }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(cells[i]?.deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  return { react, render(fn) { let output; for (let i = 0; i < 30; i++) { cursor = 0; dirty = false; output = fn(); while (effects.length) effects.shift()(); if (!dirty) return output; } assert.fail('Hook did not settle'); }, cleanup() { cells.forEach(c => c.cleanup?.()); } };
}
function actionHarness() {
  const h = hooks(); const calls = [], listeners = new Map(), timers = new Map(); let timerId = 0, result;
  const state = { token: 'fixture-token', playerId: 'p1', roomCode: '7KPM-R4TX', telestrationsPublic: null, telestrationsPrivate: null, telestrationsSyncing: true };
  const socket = { connected: true, on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); }, off(event, fn) { listeners.get(event)?.delete(fn); }, emit(...args) { calls.push(args); }, connect() { calls.push(['connect']); } };
  const useGameStore = selector => selector(state); useGameStore.getState = () => ({ ...state, setTelestrationsSyncing: value => { state.telestrationsSyncing = value; } });
  const { useTelestrationsActions } = load('useTelestrationsActions.ts', { react: h.react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore } }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) });
  const render = () => { result = h.render(useTelestrationsActions); return result; };
  const pair = (revision = 1, windowId = '1:draw:0', draftRevision = 0) => { state.telestrationsPublic = { gameId: 'telestrations', roomCode: state.roomCode, revision, phase: 'draw' }; state.telestrationsPrivate = { gameId: 'telestrations', roomCode: state.roomCode, playerId: state.playerId, revision, windowId, seatToken: `${windowId}:0`, draft: { revision: draftRevision, submitted: false } }; state.telestrationsSyncing = false; render(); };
  const event = (event, value) => { for (const fn of listeners.get(event) ?? []) fn(value); render(); };
  const submission = () => ({ windowId: state.telestrationsPrivate.windowId, seatToken: state.telestrationsPrivate.seatToken, content: { strokes: [] } });
  render();
  return { calls, state, socket, pair, event, render, submission, timers, listeners, cleanup: h.cleanup, get actions() { return result; }, expire() { for (const [id, timer] of [...timers]) if (timer.ms === 12000) { timers.delete(id); timer.fn(); } render(); } };
}
test('commands require an owned adopted pair and synchronously fence double submits', () => {
  const h = actionHarness(); assert.equal(h.actions.send('reveal'), false); h.pair();
  assert.equal(h.actions.send('draft', h.submission()), true); assert.equal(h.actions.send('submit', h.submission()), false);
  assert.equal(h.calls.filter(([name]) => name === 'telestrations:draft').length, 1);
  assert.equal(h.calls.at(-1)[1].draftRevision, 0); assert.equal('expectedRevision' in h.calls.at(-1)[1], false); h.cleanup();
});
test('draft acknowledgement and adopted pair may arrive in either order', () => {
  for (const ackFirst of [true, false]) {
    const h = actionHarness(); h.pair(); h.actions.send('draft', h.submission()); h.render();
    const ack = () => h.event('telestrations:action_accepted', { action: 'draft', revision: 2 });
    if (ackFirst) ack(); else h.pair(2, '1:draw:0', 1);
    assert.equal(h.actions.pending, 'draft');
    if (ackFirst) h.pair(2, '1:draw:0', 1); else ack();
    assert.equal(h.actions.pending, null); assert.equal(h.actions.send('submit', h.submission()), true); assert.equal(h.calls.at(-1)[1].draftRevision, 1); h.cleanup();
  }
});
test('stale assignment, forged private identity and captured ordered controls fail closed', () => {
  const h = actionHarness(); h.pair(); const old = h.submission(); const oldSend = h.actions.send;
  h.pair(3, '2:draw:0'); assert.equal(h.actions.send('submit', old), false); assert.equal(oldSend('reveal'), false);
  h.state.telestrationsPrivate.playerId = 'other'; assert.equal(h.actions.send('submit', h.submission()), false);
  h.state.telestrationsPrivate.playerId = 'p1'; h.state.telestrationsPrivate.roomCode = 'WRONG'; assert.equal(h.actions.send('reveal'), false); h.cleanup();
});
test('unrelated acknowledgements and malformed events cannot release pending work', () => {
  const h = actionHarness(); h.pair(); h.actions.send('draft', h.submission()); h.render();
  for (const value of [null, undefined, [], 1, {}, { action: 'submit', revision: 2 }, { action: 'draft', revision: 1 }, { action: 'draft', revision: Infinity }]) {
    assert.doesNotThrow(() => h.event('telestrations:action_accepted', value)); assert.equal(h.actions.pending, 'draft');
  }
  h.cleanup(); assert.equal([...h.listeners.values()].every(set => set.size === 0), true);
});
test('timeout and disconnect request fresh state without replaying a submission', () => {
  const h = actionHarness(); h.pair(); h.actions.send('submit', h.submission()); h.expire();
  assert.equal(h.actions.pending, null); assert.equal(h.state.telestrationsSyncing, true); assert.equal(h.calls.at(-1)[0], 'request_state');
  assert.equal(h.calls.filter(([event]) => event === 'telestrations:submit').length, 1);
  h.socket.connected = false; h.event('disconnect'); assert.equal(h.actions.busy, true); assert.match(h.actions.message, /Connection lost/); h.cleanup();
});
test('old token closures cannot mutate the replacement session', () => {
  const h = actionHarness(); h.pair(); const send = h.actions.send; h.state.token = 'new-fixture-token';
  assert.equal(send('submit', h.submission()), false); h.cleanup();
});
const model = load('drawingModel.ts', { '@zuychin-arcade/types': { TELESTRATIONS_LIMITS: { coordinate: 4095, strokes: 96, points: 1024, pointsPerStroke: 256, drawingBytes: 16384 } } });
test('drawing coordinates are normalised, bounded and reject invalid layouts', () => {
  assert.equal(JSON.stringify(model.normalisePoint(50, 25, 100, 100)), '[2048,1024]');
  assert.equal(JSON.stringify(model.normalisePoint(-20, 200, 100, 100)), '[0,4095]');
  assert.equal(model.normalisePoint(0, 0, 0, 10), null); assert.equal(model.normalisePoint(NaN, 0, 10, 10), null);
});
test('vector limits prevent oversize drawings and preserve prior versions for undo', () => {
  let drawing = { strokes: [] }; const empty = drawing;
  drawing = model.appendPoint(drawing, [1, 1], 1, 1, true); assert.equal(empty.strokes.length, 0);
  const one = drawing; drawing = model.appendPoint(drawing, [2, 2], 1, 1, false); assert.equal(one.strokes[0].points.length, 1);
  for (let i = 0; i < 2000; i++) drawing = model.appendPoint(drawing, [i % 4096, i % 4096], 1, 1, i % 200 === 0);
  assert.ok(model.pointCount(drawing) <= 1024); assert.ok(drawing.strokes.every(s => s.points.length <= 256)); assert.ok(model.drawingFits(drawing));
  let dots = { strokes: [] }; for (let i = 0; i < 200; i++) dots = model.appendPoint(dots, [i, i], 1, 1, true); assert.equal(dots.strokes.length, 96);
});
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function draftHarness() {
  const h = hooks(); const timers = new Map(), calls = []; let timerId = 0;
  const props = { game: { phase: 'draw', seats: ['p1', 'p2', 'p3', 'p4'], readyIds: [] }, mine: { draft: { revision: 0, content: null, submitted: false }, windowId: '1:draw:0', seatToken: '1:draw:0:0', predecessor: { kind: 'prompt', content: 'Private predecessor, never a submission' } }, actions: { busy: false, pending: null, send(...args) { calls.push(args); return true; } }, remember(value) { props.cached = value; }, leaving: false };
  const { BookDraft } = load('BookDraft.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', TextInput: 'TextInput', View: 'View' },
    './DrawingEditor': { DrawingEditor: 'DrawingEditor' }, './Drawing': { Drawing: 'Drawing' }, './drawingModel': model,
    './Controls': { BookButton: 'Button', typography: {} }, './palette': { TELESTRATIONS: {} },
  }, { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) });
  const render = () => h.render(() => BookDraft(props));
  const button = label => nodes(render()).find(n => n.type === 'Button' && n.props.label === label);
  const edit = content => { nodes(render()).find(n => n.type === 'DrawingEditor').props.onChange(content); render(); };
  return { props, render, button, edit, calls, timers, cleanup: h.cleanup, save() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}
test('editor autosaves its own vectors and never submits the private predecessor', () => {
  const h = draftHarness(); h.render(); assert.equal(h.timers.size, 0);
  const drawing = { strokes: [{ color: 1, width: 1, points: [[1, 1]] }] };
  h.edit(drawing); h.save(); assert.equal(h.calls.at(-1)[0], 'draft'); assert.deepEqual(h.calls.at(-1)[1].content, drawing);
  assert.equal(JSON.stringify(h.calls).includes('Private predecessor'), false);
  h.props.actions.busy = true; assert.equal(h.button('Lock in drawing').props.disabled, true);
  h.props.mine.draft = { revision: 1, content: drawing, submitted: false }; h.props.actions.busy = false;
  assert.equal(h.button('Lock in drawing').props.disabled, false);
  assert.equal(h.button('Use the restored draft'), undefined);
  h.button('Lock in drawing').props.onPress(); assert.equal(h.calls.at(-1)[0], 'submit'); assert.deepEqual(h.calls.at(-1)[1].content, drawing); h.cleanup();
});
test('a newer different restored draft requires a human conflict decision', () => {
  const h = draftHarness(); const local = { strokes: [{ color: 1, width: 1, points: [[1, 1]] }] }; const restored = { strokes: [{ color: 3, width: 0, points: [[200, 200]] }] };
  h.edit(local); h.props.mine.draft = { revision: 2, content: restored, submitted: false }; h.render();
  assert(h.button('Use the restored draft')); assert.equal(h.button('Lock in drawing').props.disabled, true); assert.equal(h.timers.size, 0);
  h.button('Use the restored draft').props.onPress(); h.render();
  assert.equal(h.button('Use the restored draft'), undefined); assert.deepEqual(nodes(h.render()).find(n => n.type === 'DrawingEditor').props.value, restored); h.cleanup();
});
test('editing can continue during a draft save without replay or a false restore conflict', () => {
  const h = draftHarness(); const first = { strokes: [{ color: 1, width: 1, points: [[1, 1]] }] }; const second = { strokes: [{ color: 1, width: 1, points: [[1, 1], [2, 2]] }] };
  h.edit(first); h.save(); h.props.actions.busy = true; h.props.actions.pending = 'draft';
  assert.equal(nodes(h.render()).find(n => n.type === 'DrawingEditor').props.disabled, false);
  h.edit(second); assert.equal(h.timers.size, 0); assert.equal(h.button('Lock in drawing').props.disabled, true);
  h.props.mine.draft = { revision: 1, content: first, submitted: false }; h.props.actions.busy = false; h.props.actions.pending = null;
  h.render(); assert.equal(h.button('Use the restored draft'), undefined); h.save(); assert.deepEqual(h.calls.at(-1)[1].content, second); h.cleanup();
});
test('web drawing consumes only active pointer or explicit drawing keys, and Tab is untouched', () => {
  const h = hooks(), points = [], cursors = []; let ended = 0;
  const { default: Input } = load('DrawingInput.web.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, './drawingModel': model });
  const render = disabled => h.render(() => Input({ disabled, children: null, onPoint: (...args) => points.push(args), onEnd: () => ended++, onCursor: p => cursors.push(p) }));
  let prevented = 0;
  const target = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }), focus() {}, setPointerCapture() {} };
  const pointer = { pointerId: 1, button: 0, clientX: 60, clientY: 70, currentTarget: target, preventDefault() { prevented++; } };
  const node = render(false); node.props.onPointerMove(pointer); assert.equal(points.length, 0);
  node.props.onPointerDown(pointer); assert.equal(JSON.stringify(points[0]), '[[2048,2048],true]');
  node.props.onPointerMove({ ...pointer, pointerId: 2 }); assert.equal(points.length, 1);
  node.props.onPointerUp(pointer); assert.equal(ended, 1);
  const before = prevented; node.props.onKeyDown({ key: 'Tab', preventDefault() { prevented++; } }); assert.equal(prevented, before);
  node.props.onKeyDown({ key: ' ', preventDefault() { prevented++; } }); node.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; } }); assert.equal(cursors.at(-1)[0], 2128);
  const count = points.length; render(true).props.onPointerDown(pointer); assert.equal(points.length, count); h.cleanup();
});
function leaveHarness(overrides = {}) {
  const h = hooks(), calls = []; let dialog = null, result, back;
  const state = { token: 'leave-fixture', roomCode: '7KPM-R4TX', telestrationsPublic: { phase: 'draw' }, clearAll() { calls.push(['clear']); state.token = null; state.roomCode = null; } };
  const store = selector => selector(state); store.getState = () => state;
  const { useTelestrationsLeave } = load('useTelestrationsLeave.ts', {
    react: h.react, 'react-native': { Platform: { OS: 'android' }, BackHandler: { addEventListener(name, fn) { back = fn; return { remove() { back = null; } }; } } },
    'expo-router': { router: { replace(path) { calls.push(['route', path]); } } }, '../../store/useGameStore': { useGameStore: store },
    '../../hooks/useNativeLeaveGuard': { useNativeLeaveGuard: () => (fn, allowed) => { if (allowed()) fn(); } },
    '../../hooks/useWebBackGuard': { useWebBackGuard() {} }, '../../hooks/useSocket': { getSocket: () => ({ disconnect() { calls.push(['disconnect']); } }) },
    '../../lib/api': { leaveRoom: async (...args) => { calls.push(['leave', ...args]); return overrides.leave?.(...args); } },
    '../../lib/storage': { clearAuthIfMatches: async (...args) => { calls.push(['storage', ...args]); return overrides.storage?.(...args); } },
    '../../lib/dialog': { showDialog(title, message, buttons) { dialog = { title, message, buttons }; }, useDialogStore: { getState: () => ({ dialog, hide() { dialog = null; } }) } },
  });
  const render = () => { result = h.render(() => useTelestrationsLeave(() => overrides.dismiss?.() ?? false)); return result; }; render();
  return { state, calls, render, cleanup: h.cleanup, get actions() { return result; }, get dialog() { return dialog; }, back: () => back(), confirm() { dialog.buttons.find(b => b.text === 'LEAVE').onPress(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('leave is confirmation-only, names cancellation policy and fences duplicates', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); const h = leaveHarness({ leave: () => wait });
  h.back(); assert.match(h.dialog.message, /fewer than four/); assert.equal(h.calls.length, 0);
  const confirm = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress; confirm(); confirm();
  assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); release(); await tick(); h.render();
  assert(h.calls.some(c => c[0] === 'storage')); assert(h.calls.some(c => c[0] === 'route')); h.cleanup();
});
test('Back dismisses the current confirmation before requesting a leave', () => {
  const h = leaveHarness(); h.back(); assert(h.dialog); h.back(); assert.equal(h.dialog, null); assert.equal(h.calls.length, 0); h.cleanup();
});
test('failed storage retries cleanup without forfeiting twice', async () => {
  let attempts = 0; const h = leaveHarness({ storage: () => { if (attempts++ === 0) throw new Error('fixture storage failure'); } });
  h.actions.requestLeave(); h.confirm(); await tick(); h.render(); assert.match(h.actions.error, /saved details/);
  h.actions.requestLeave(); await tick(); h.render(); assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); assert.equal(h.calls.filter(c => c[0] === 'storage').length, 2); h.cleanup();
});
test('old leave confirmation and pending storage cannot clear a replacement seat', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); const h = leaveHarness({ storage: () => wait });
  h.actions.requestLeave(); const oldConfirm = h.dialog.buttons.find(b => b.text === 'LEAVE').onPress; oldConfirm(); await tick();
  h.state.token = 'replacement-fixture'; h.state.roomCode = 'NEXT-ROOM'; h.render(); oldConfirm(); release(); await tick();
  assert.equal(h.calls.filter(c => c[0] === 'clear').length, 0); assert.equal(h.calls.filter(c => c[0] === 'leave').length, 1); h.cleanup();
});
test('friendly scoring requires both favourites and an explicit final judgement', () => {
  const h = hooks(), calls = [];
  const { Scoring } = load('Scoring.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' }, './Controls': { BookButton: 'Button', typography: {} } });
  const props = { game: { scoringMode: 'friendly', revealPage: 3, scoringPages: [{ index: 0, kind: 'draw', authorId: 'p1' }, { index: 1, kind: 'guess', authorId: 'p2' }, { index: 2, kind: 'draw', authorId: 'p3' }, { index: 3, kind: 'guess', authorId: 'p4' }], players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, displayName: `Seat ${i + 1}` })) }, actions: { send: (...args) => calls.push(args) }, disabled: false };
  const render = () => h.render(() => Scoring(props));
  const button = label => nodes(render()).find(n => n.type === 'Button' && n.props.label === label);
  assert.equal(button('Confirm these points').props.disabled, true);
  button('Page 1: Seat 1').props.onPress(); button('Page 2: Seat 2').props.onPress();
  assert.equal(button('Confirm these points').props.disabled, true);
  const verdict = nodes(render()).find(n => typeof n.type === 'function' && n.props.label === 'Does the final guess match the original secret?');
  verdict.props.onChange(false); assert.equal(button('Confirm these points').props.disabled, false);
  button('Review page 1').props.onPress(); assert.equal(calls.at(-1)[0], 'review');
  button('Confirm these points').props.onPress(); assert.equal(JSON.stringify(calls.at(-1)), '["score",{"finalMatch":false,"favouriteDrawing":0,"favouriteGuess":1}]'); h.cleanup();
});
