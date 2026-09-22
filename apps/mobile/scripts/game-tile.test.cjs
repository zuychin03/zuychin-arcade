const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function render({ reduced = false, ...props } = {}) {
  const jsx = (type, values) => ({ type, props: values });
  const animation = { delay: () => animation, springify: () => animation, damping: () => animation };
  const modules = {
    react: { useState: (value) => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' } },
    'react-native-reanimated': { default: { View: 'Animated.View' }, FadeInUp: animation },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    './ScalePressable': { ScalePressable: 'ScalePressable' },
    './GameCover': { GameCover: 'GameCover' },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduced },
    '../../constants/theme': { ARCADE: {}, neonBox: () => ({}), neonText: () => ({}) },
  };
  const filename = path.join(__dirname, '../components/ui/GameTile.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert(name in modules); return modules[name]; } });
  return exports.GameTile({ title: 'KING OF TOKYO', subtitle: '2–6 players · roll and fight', icon: 'city', accent: '#fff', index: 2, ...props });
}

test('game tiles expose clear names and preserve the action and disabled state', () => {
  let pressed = false;
  const button = render({ onPress: () => { pressed = true; } }).props.children;
  assert.equal(button.props.accessibilityLabel, 'KING OF TOKYO. 2–6 players · roll and fight');
  button.props.onPress();
  assert(pressed);
  assert.equal(render({ locked: true }).props.children.props.disabled, true);
});

test('game descriptions use a separate full-width row without text clamping', () => {
  const button = render().props.children;
  assert.equal(button.props.style({ pressed: false }).flexDirection, 'column');
  const content = button.props.children[1];
  const description = content.props.children.find(child => child?.type === 'Text' && child.props.children === '2–6 players · roll and fight');
  assert(description);
  assert.equal(description.props.numberOfLines, undefined);
  assert.equal(description.props.style.fontSize, 16);
  assert.equal(description.props.style.lineHeight, 24);
});

test('game tiles accept measured grid width without fixing text or card height', () => {
  const tile = render({ width: 317 });
  assert.equal(tile.props.style.width, 317);
  assert.equal(tile.props.style.height, undefined);
  assert.equal(tile.props.children.props.style({ pressed: false }).height, undefined);
});

test('game tiles are visible immediately without entrance motion in either preference', () => {
  assert.equal(render({ reduced: true }).props.entering, undefined);
  assert.equal(render({ reduced: false }).props.entering, undefined);
});

test('navigation chevron shares metadata rather than taking width from the game title', () => {
  const content = render({ players: '3–10 players' }).props.children.props.children[1];
  const [heading, metadata] = content.props.children;
  assert(!heading.props.children.some(child => child?.props?.name === 'chevron-right'));
  assert.equal(metadata.props.children[0].props.children, '3–10 players');
  assert.equal(metadata.props.children[0].props.style.minWidth, 0);
  assert.equal(metadata.props.children[1].props.name, 'chevron-right');
  const locked = render({ players: '3–10 players', locked: true }).props.children.props.children[1];
  assert.equal(locked.props.children[1].props.children[1], false);
});

test('narrow tiles reclaim padding without shrinking or clamping game titles', () => {
  for (const [width, padding] of [[280, 12], [299, 12], [300, 16], [335, 16]]) {
    const content = render({ width }).props.children.props.children[1];
    assert.equal(content.props.style.padding, padding);
    const title = content.props.children[0].props.children[1];
    assert.equal(title.props.style.fontSize, 22);
    assert.equal(title.props.allowFontScaling, undefined);
    assert.equal(title.props.numberOfLines, undefined);
  }
});
