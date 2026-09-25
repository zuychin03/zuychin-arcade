const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../components/lobby/RoomCodeDisplay.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ width = 375, failCopy = false, failShare = false } = {}) {
  let feedback = null, timer = 0, cleanup;
  const timers = new Map(), writes = [], shares = [], ref = { current: null };
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    react: { useState: () => [feedback, value => { feedback = value; }], useRef: () => ref, useEffect: fn => { cleanup = fn(); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', useWindowDimensions: () => ({ width, fontScale: 2 }), Share: { sharedAction: 'shared', share: async value => { shares.push(value); if (failShare) throw new Error('unavailable'); return { action: 'shared' }; } } },
    'expo-clipboard': { setStringAsync: async value => { writes.push(value); if (failCopy) throw new Error('unavailable'); } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    '../../constants/theme': { ARCADE: {}, neonText: color => ({ color }) },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => { assert(id in modules, id); return modules[id]; },
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) });
  const props = { roomCode: 'ABCD-EF23', hasPassword: true, gameName: 'Colt Express' };
  return { render: () => exports.RoomCodeDisplay(props), writes, shares, timers, get feedback() { return feedback; }, unmount: () => cleanup?.() };
}

test('room code remains selectable complete text without one-line clamp or font shrinking', () => {
  for (const width of [320, 375, 414, 1280]) {
    const tree = harness({ width }).render();
    const code = nodes(tree).find(node => node.props.accessibilityLabel === 'Room code ABCD-EF23');
    assert.equal(code.props.children, 'ABCD-EF23');
    assert.equal(code.props.selectable, true);
    for (const key of ['numberOfLines', 'adjustsFontSizeToFit', 'minimumFontScale']) assert.equal(code.props[key], undefined);
    assert.equal(code.props.style.maxWidth, '100%');
    for (const key of ['height', 'maxHeight', 'overflow']) assert.equal(code.props.style[key], undefined);
    assert.equal(tree.props.style.height, undefined);
  }
});

test('copy and share keep48px controls and can wrap on narrow enlarged-text layouts', () => {
  const tree = harness({ width: 320 }).render();
  const row = nodes(tree).find(node => node.props.style?.marginTop === 14);
  assert.equal(row.props.style.flexWrap, 'wrap');
  assert.equal(row.props.style.justifyContent, 'center');
  const buttons = nodes(row).filter(node => node.type === 'Button');
  assert.equal(buttons.length, 2);
  assert(buttons.every(button => button.props.style.minHeight >= 48));
  const { TYPOGRAPHY } = require('./lib/typography-fixture.cjs');
  for (const button of buttons) {
    assert.equal(button.props.style.maxWidth, '100%');
    const label = nodes(button).find(node => node.type === 'Text');
    for (const [property, value] of Object.entries(TYPOGRAPHY.control)) assert.equal(label.props.style[property], value);
    assert.equal(label.props.style.flexShrink, 1);
    assert.equal(label.props.numberOfLines, undefined);
  }
  for (const node of nodes(tree).filter(node => node.props.children === 'password protected' || node.props.accessibilityLiveRegion === 'polite')) {
    for (const [property, value] of Object.entries(TYPOGRAPHY.body)) assert.equal(node.props.style[property], value);
  }
});

test('copy retains the unmodified code and clears its owned feedback timer', async () => {
  const h = harness();
  nodes(h.render()).find(node => node.props.accessibilityLabel === 'Copy room code').props.onPress();
  await settle();
  assert.deepEqual(h.writes, ['ABCD-EF23']);
  assert.equal(h.feedback, 'Room code copied.');
  assert.equal(h.timers.size, 1);
  h.unmount();
  assert.equal(h.timers.size, 0);
});

test('copy and share failures retain recoverable feedback, and sharing retains game identity', async () => {
  for (const failShare of [false, true]) {
    const h = harness({ failCopy: true, failShare });
    const tree = h.render();
    nodes(tree).find(node => node.props.accessibilityLabel === 'Copy room code').props.onPress();
    await settle();
    assert.equal(h.feedback, 'Could not copy. Select the code above instead.');
    nodes(tree).find(node => node.props.accessibilityLabel === 'Share room code').props.onPress();
    await settle();
    assert.equal(h.shares[0].message, 'Join my Colt Express game on Zuychin Arcade! Room code: ABCD-EF23');
    assert.equal(h.feedback, failShare ? 'Sharing is unavailable. Copy the room code instead.' : 'Share sheet opened.');
    assert.equal(h.timers.size, 1);
    h.unmount();
  }
});
