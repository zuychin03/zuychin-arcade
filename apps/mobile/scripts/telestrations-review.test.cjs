const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules, globals = {}) {
  const filename = path.join(__dirname, '../components/telestrations', file);
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
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const limits = { coordinate: 4095, strokes: 96, points: 1024, pointsPerStroke: 256, drawingBytes: 16384 };
const model = load('drawingModel.ts', { '@zuychin-arcade/types': { TELESTRATIONS_LIMITS: limits } });
function draftHarness(phase, overrides = {}) {
  const h = hooks(), calls = [], timers = new Map(); let id = 0;
  const props = { game: { phase, category: null, seats: ['p1', 'p2', 'p3', 'p4'], readyIds: [] }, mine: { choices: ['A lighthouse', 'A tiny dragon', 'A dancing moon'], windowId: `1:${phase}:0`, seatToken: `1:${phase}:0:0`, draft: { revision: 0, content: null, submitted: false }, predecessor: phase === 'guess' ? { kind: 'draw', content: { strokes: [{ color: 1, width: 1, points: [[20, 20]] }] } } : null }, actions: { busy: false, pending: null, send: (...args) => { calls.push(args); return true; } }, leaving: false, remember() {}, ...overrides };
  const { BookDraft } = load('BookDraft.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', Text: 'Text', TextInput: 'Input' }, './DrawingEditor': { DrawingEditor: 'Editor' }, './Drawing': { Drawing: 'Drawing' }, './drawingModel': model, './Controls': { BookButton: 'Button', typography: {} }, './palette': { TELESTRATIONS: {} } }, { setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: key => timers.delete(key) });
  const render = () => h.render(() => BookDraft(props));
  const button = label => nodes(render()).find(n => n.type === 'Button' && n.props.label === label);
  const edit = value => { const input = nodes(render()).find(n => n.type === 'Input' || n.type === 'Editor'); (input.props.onChangeText ?? input.props.onChange)(value); render(); };
  render(); return { props, calls, timers, render, button, edit, cleanup: h.cleanup, save() { for (const [key, timer] of [...timers]) { timers.delete(key); timer.fn(); } } };
}
test('offered prompt mode has no free-text path and submits only the selected secret', () => {
  const h = draftHarness('prompt'); assert.equal(nodes(h.render()).some(n => n.type === 'Input'), false);
  assert.equal(h.button('Lock in secret').props.disabled, true); h.button('A tiny dragon').props.onPress();
  assert.equal(h.button('Lock in secret').props.disabled, false); h.button('Lock in secret').props.onPress();
  assert.equal(h.calls.at(-1)[1].content, 'A tiny dragon'); h.cleanup();
});
test('category prompts reject blank, question-only, multiline and oversized entries', () => {
  const h = draftHarness('prompt'); h.props.game.category = 'Animals';
  for (const value of ['', '   ', '???', 'cat\ndog', 'a'.repeat(121)]) { h.edit(value); assert.equal(h.button('Lock in secret').props.disabled, true); assert.equal(h.timers.size, 0); }
  h.edit('  flying cat  '); h.button('Lock in secret').props.onPress(); assert.equal(h.calls.at(-1)[1].content, 'flying cat'); h.cleanup();
});
test('guess handoff shows only the predecessor drawing and submits the typed interpretation', () => {
  const h = draftHarness('guess'); assert.equal(nodes(h.render()).filter(n => n.type === 'Drawing').length, 1);
  h.edit('  a lighthouse  '); h.save(); assert.equal(h.calls.at(-1)[0], 'draft');
  h.button('Lock in guess').props.onPress(); assert.equal(h.calls.at(-1)[0], 'submit'); assert.equal(h.calls.at(-1)[1].content, 'a lighthouse');
  assert.equal('predecessor' in h.calls.at(-1)[1], false); h.cleanup();
});
test('drawing handoff permits an empty saved draft but never an empty submitted page', () => {
  const h = draftHarness('draw'); assert.equal(h.button('Lock in drawing').props.disabled, true);
  const drawing = { strokes: [{ color: 1, width: 0, points: [[100, 100]] }] }; h.edit(drawing); h.save();
  h.props.mine.draft = { revision: 1, content: drawing, submitted: false }; h.render();
  h.edit({ strokes: [] }); h.save(); assert.equal(JSON.stringify(h.calls.at(-1)), JSON.stringify(['draft', { content: { strokes: [] }, windowId: '1:draw:0', seatToken: '1:draw:0:0' }]));
  assert.equal(h.button('Lock in drawing').props.disabled, true); h.cleanup();
});
test('unsaved cache survives remount without silently overwriting a conflicting restored guess', () => {
  const h = draftHarness('guess', { cached: { content: 'local guess', baseRevision: 1 } });
  h.props.mine.draft = { revision: 2, content: 'saved guess', submitted: false }; h.render();
  assert(h.button('Keep my unsaved version')); assert.equal(h.button('Lock in guess').props.disabled, true);
  h.button('Keep my unsaved version').props.onPress(); h.render(); h.save(); assert.equal(h.calls.at(-1)[1].content, 'local guess'); h.cleanup();
});
test('unmount cancels draft autosave and a locked page exposes no submit control', () => {
  const h = draftHarness('guess'); h.edit('owl'); assert.equal(h.timers.size, 1); h.cleanup(); assert.equal(h.timers.size, 0);
  const locked = draftHarness('guess'); locked.props.mine.draft = { revision: 0, content: 'owl', submitted: true };
  assert.equal(locked.button('Lock in guess'), undefined); assert.equal(nodes(locked.render()).find(n => n.type === 'Input').props.editable, false); locked.cleanup();
});
function scoringHarness(mode) {
  const h = hooks(), calls = [];
  const props = { game: { scoringMode: mode, revealPage: 3, scoringPages: Array.from({ length: 4 }, (_, index) => ({ index, kind: index % 2 ? 'guess' : 'draw', authorId: `p${index}` })), players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, displayName: `Seat ${i}` })) }, actions: { send: (...args) => calls.push(args) }, disabled: false };
  const { Scoring } = load('Scoring.tsx', { react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Text: 'Text', View: 'View' }, './Controls': { BookButton: 'Button', typography: {} } });
  const render = () => h.render(() => Scoring(props)); const button = label => nodes(render()).find(n => n.type === 'Button' && n.props.label === label);
  const verdict = index => nodes(render()).filter(n => typeof n.type === 'function')[index];
  return { props, calls, render, button, verdict, cleanup: h.cleanup };
}
test('competitive judgement requires every guess and a consistent final-match decision', () => {
  const h = scoringHarness('competitive'); assert.equal(h.button('Confirm these points').props.disabled, true);
  h.verdict(0).props.onChange(false); h.verdict(1).props.onChange(false); h.verdict(2).props.onChange(true);
  assert.equal(h.button('Confirm these points').props.disabled, true);
  h.verdict(1).props.onChange(true); assert.equal(h.button('Confirm these points').props.disabled, false);
  h.button('Confirm these points').props.onPress(); assert.equal(JSON.stringify(h.calls.at(-1)), '["score",{"finalMatch":true,"matches":[false,true]}]'); h.cleanup();
});
test('review navigation retains human judgements and sends a page index, not page contents', () => {
  const h = scoringHarness('competitive'); h.verdict(0).props.onChange(true); h.verdict(1).props.onChange(false); h.verdict(2).props.onChange(false);
  h.button('Review secret').props.onPress(); assert.equal(JSON.stringify(h.calls.at(-1)), '["review",{"pageIndex":-1}]');
  h.props.game = { ...h.props.game, revealPage: -1, revision: 8 }; assert.equal(h.button('Confirm these points').props.disabled, false);
  h.button('Review page 3').props.onPress(); assert.equal(JSON.stringify(h.calls.at(-1)), '["review",{"pageIndex":2}]'); h.cleanup();
});
test('casual scoring closes the book without inventing points or semantic judgements', () => {
  const h = scoringHarness('none'); assert.equal(h.verdict(0), undefined); h.button('Close this book').props.onPress(); assert.equal(JSON.stringify(h.calls), '[["score",{}]]');
  h.props.disabled = true; assert.equal(h.button('Close this book').props.disabled, true); h.cleanup();
});
test('actual stroke appends stay inside every transport limit under sustained drawing', () => {
  let drawing = { strokes: [] };
  for (let i = 0; i < 3000; i++) drawing = model.appendPoint(drawing, [i % 4096, (i * 3) % 4096], i % 8, i % 3, i % 50 === 0);
  assert(drawing.strokes.length <= limits.strokes); assert(model.pointCount(drawing) <= limits.points); assert(drawing.strokes.every(s => s.points.length <= limits.pointsPerStroke)); assert(Buffer.byteLength(JSON.stringify(drawing)) <= limits.drawingBytes);
});
function actionHarness() {
  const h = hooks(), calls = [], listeners = new Map(), timers = new Map(); let id = 0, result;
  const state = { token: 'fixture', playerId: 'p1', roomCode: 'ROOM', telestrationsSyncing: true };
  const socket = { connected: true, emit: (...args) => calls.push(args), on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); }, off(event, fn) { listeners.get(event)?.delete(fn); }, connect() { calls.push(['connect']); } };
  const store = selector => selector(state); store.getState = () => ({ ...state, setTelestrationsSyncing(value) { state.telestrationsSyncing = value; } });
  const { useTelestrationsActions } = load('useTelestrationsActions.ts', { react: h.react, '../../hooks/useSocket': { getSocket: () => socket }, '../../store/useGameStore': { useGameStore: store } }, { setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: key => timers.delete(key) });
  const render = () => { result = h.render(useTelestrationsActions); return result; };
  const pair = (revision = 1, windowId = '1:guess:1', draftRevision = 0) => {
    state.telestrationsPublic = { gameId: 'telestrations', roomCode: 'ROOM', revision, phase: 'guess' };
    state.telestrationsPrivate = { gameId: 'telestrations', roomCode: 'ROOM', playerId: 'p1', revision, windowId, seatToken: `${windowId}:0`, draft: { revision: draftRevision, content: null, submitted: false } }; state.telestrationsSyncing = false; render();
  };
  const event = (name, value) => { for (const fn of listeners.get(name) ?? []) fn(value); render(); };
  render(); return { state, calls, socket, pair, render, event, cleanup: h.cleanup, get actions() { return result; }, payload: () => ({ windowId: state.telestrationsPrivate.windowId, seatToken: state.telestrationsPrivate.seatToken, content: 'owl' }), expire() { for (const [key, timer] of [...timers]) if (timer.ms === 12000) { timers.delete(key); timer.fn(); } render(); } };
}
test('simultaneous peer revisions do not invalidate this assigned page but a new window does', () => {
  const h = actionHarness(); h.pair(); const send = h.actions.send, payload = h.payload(); h.pair(3);
  assert.equal(send('submit', payload), true); assert.equal(h.calls.at(-1)[1].draftRevision, 0); h.cleanup();
  const next = actionHarness(); next.pair(); const old = next.payload(); next.pair(9, '2:guess:1'); assert.equal(next.actions.send('submit', old), false); next.cleanup();
});
test('ordered review and scoring callbacks cannot target a later book revision', () => {
  const h = actionHarness(); h.pair(); const old = h.actions.send; h.pair(3);
  assert.equal(old('review', { pageIndex: 1 }), false); assert.equal(old('score', { finalMatch: false, matches: [false, false] }), false);
  assert.equal(h.calls.some(c => c[0] === 'telestrations:score'), false); h.cleanup();
});
test('disconnect cancels pending work; reconnect restores a pair without replaying the guess', () => {
  const h = actionHarness(); h.pair(); h.actions.send('submit', h.payload()); h.render(); h.socket.connected = false; h.event('disconnect');
  assert.equal(h.actions.pending, null); assert.equal(h.actions.canEdit, false);
  h.socket.connected = true; h.event('connect'); assert.equal(h.actions.busy, true); assert.equal(h.calls.at(-1)[0], 'request_state');
  h.pair(2); assert.equal(h.actions.canEdit, true); assert.equal(h.calls.filter(c => c[0] === 'telestrations:submit').length, 1); h.cleanup();
});
test('timeout demands a paired refresh and stale-session acknowledgements cannot release it', () => {
  const h = actionHarness(); h.pair(); h.actions.send('draft', h.payload()); h.expire();
  assert.equal(h.state.telestrationsSyncing, true); assert.equal(h.actions.send('submit', h.payload()), false);
  h.event('telestrations:action_accepted', { action: 'draft', revision: 2 }); assert.equal(h.actions.busy, true);
  h.state.token = 'replacement'; const count = h.calls.length; h.actions.refresh(); assert.equal(h.calls.length, count); h.cleanup();
});
