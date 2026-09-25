const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { CARD_ART_FAMILY } = require('./bang-ui-evidence.cjs');

const jsx = (type, props) => ({ type, props });
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function load(file, modules) {
  const filename = path.resolve(__dirname, '..', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { assert(Object.hasOwn(modules, name), name); return modules[name]; } }, { filename });
  return exports;
}
const palette = load('constants/theme.ts', { 'react-native': { Platform: { OS: 'web' } } }).BANG;
const common = { 'react/jsx-runtime': { jsx, jsxs: jsx }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../../constants/theme': { BANG: palette } };
function cardModule(platform = 'web', fontScale = 1, width = 375) {
  return load('components/bang/Card.tsx', {
    ...common, 'react-native': { View: 'View', Text: 'Text', Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }) },
    '../ui/ScalePressable': { ScalePressable: 'Pressable' }, '../ui/CardSurface': { CardSurface: 'CardSurface' },
    './CardArtwork': { BangCardArtwork: 'Artwork', BANG_CARD_EMBLEM: Object.fromEntries(Object.keys(CARD_ART_FAMILY).map(name => [name, name])) },
  });
}
const card = { id: 'test-17', name: 'missed', rank: 'Q', suit: 'hearts' };

test('all 16 public character portraits are decorative, bounded and have a vector fallback', () => {
  const constants = load('../../packages/types/src/bang-constants.ts', {});
  const ids = Object.keys(constants.BANG_CHARACTERS);
  const assets = Object.fromEntries(ids.map(id => [`../../assets/game-art/bang-character-${id}.webp`, id]));
  const { BangCharacterArtwork } = load('components/bang/CharacterArtwork.tsx', {
    ...common, ...assets, 'react-native': { View: 'View' }, '../ui/GameCover': { GameCover: 'GameCover' }, '../ui/CardIllustration': { CardIllustration: 'Illustration' },
  });
  assert.equal(ids.length, 16);
  for (const character of ids) {
    const fluid = BangCharacterArtwork({ character, fluid: true });
    assert.equal(fluid.type, 'Illustration');
    assert.equal(fluid.props.source, character);
    assert.equal(fluid.props.rimColor, undefined);
  }
  for (const character of ids) for (const size of [72, 96]) {
    const tree = BangCharacterArtwork({ character, size });
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.accessibilityElementsHidden, true);
    assert.equal(tree.props.style.width, size);
    assert.equal(tree.props.style.maxWidth, '100%');
    const cover = nodes(tree).find(node => node.type === 'GameCover');
    assert.equal(cover.props.source, character);
    assert.equal(cover.props.aspectRatio, 1);
    assert.equal(cover.props.rimColor, palette.gold);
    assert(nodes(cover.props.fallback).some(node => node.type === 'Icon'));
  }
  const route = fs.readFileSync(path.resolve(__dirname, '../app/bang/game.tsx'), 'utf8');
  assert(route.includes('<BangCharacterArtwork character={mine.character} />'));
  assert(route.includes('<BangCharacterArtwork character={player.character} size={72} />'));
  assert(!route.includes('character={player.role}'));
});


test('all 22 printed cards retain complete live prose, exact identity and suits on tactile faces', () => {
  const { BangCardView, BANG_CARD_DETAILS } = cardModule();
  assert.deepEqual(Object.keys(BANG_CARD_DETAILS).sort(), Object.keys(CARD_ART_FAMILY).sort());
  for (const name of Object.keys(CARD_ART_FAMILY)) for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) for (const rank of ['2', '10', 'J', 'Q', 'K', 'A']) {
    const tree = BangCardView({ card: { ...card, name, suit, rank }, idPrefix: 'check' });
    const all = nodes(tree), texts = all.filter(node => node.type === 'Text');
    assert.equal(tree.props.nativeID, 'bang-card-check-test-17');
    assert.equal(all.filter(node => node.type === 'CardSurface').length, 1);
    assert.equal(all.find(node => node.type === 'Artwork').props.name, name);
    assert(texts.some(node => node.props.children === BANG_CARD_DETAILS[name].effect));
    assert(texts.some(node => node.props.children === BANG_CARD_DETAILS[name].name));
    assert(texts.some(node => node.props.children === rank));
    assert(texts.some(node => node.props.children === suit));
    assert(all.some(node => node.props.accessibilityLabel?.includes(`, ${rank} of ${suit}.`)));
    assert(!all.some(node => node.props.numberOfLines !== undefined || node.props.style?.height !== undefined));
    assert(!all.some(node => node.type === 'Pressable'));
  }
});

test('one whole-card action retains disabled, selected and discard-order semantics', () => {
  let calls = 0;
  const tree = cardModule().BangCardView({ card, selected: true, disabled: true, selectionOrder: 2, status: 'Discard next', onPress: () => calls++ });
  const all = nodes(tree), buttons = all.filter(node => node.type === 'Pressable');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.disabled, true);
  assert.equal(buttons[0].props.accessibilityState.selected, true);
  assert.equal(buttons[0].props.accessibilityState.disabled, true);
  assert.match(buttons[0].props.accessibilityLabel, /Selection 2/);
  assert.equal(buttons[0].props.style.minHeight, 48);
  assert(all.some(node => node.type === 'Text' && node.props.children === '2. SELECTED'));
  assert(all.some(node => node.type === 'Icon' && node.props.name === 'check-circle'));
  assert.equal(all.find(node => node.type === 'CardSurface').props.selected, true);
  assert.equal(calls, 0);
  const enabled = cardModule().BangCardView({ card, onPress: () => calls++ });
  nodes(enabled).find(node => node.type === 'Pressable').props.onPress();
  assert.equal(calls, 1);
});

test('native card dimensions grow with text and remain phone bounded, web permits intrinsic text width', () => {
  for (const platform of ['ios', 'android']) for (const width of [320, 375, 1280]) for (const fontScale of [1, 1.5, 2, NaN]) {
    const tree = cardModule(platform, fontScale, width).BangCardView({ card });
    const style = tree.props.style;
    assert(Number.isFinite(style.flexBasis));
    assert(style.maxWidth <= width - 48);
    assert(style.minWidth <= style.maxWidth);
    assert.equal(style.paddingBottom, 4);
  }
  assert.equal(cardModule().BangCardView({ card }).props.style.minWidth, 'min-content');
});

test('card text colours meet the body contrast floor on normal and selected faces', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const colour of ['text', 'sand', 'muted', 'gold', 'red']) for (const face of ['panel', 'surface']) {
    const ratio = (luminance(palette[colour]) + 0.05) / (luminance(palette[face]) + 0.05);
    assert(ratio >= 4.5, `${colour} on ${face}: ${ratio.toFixed(2)}`);
  }
});

test('every card text face is actually loaded by the app', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
  for (const node of nodes(cardModule().BangCardView({ card, selected: true, status: 'Selected' }))) {
    const family = node.props?.style?.fontFamily;
    if (family) assert(shell.includes(family), `Missing bundled font: ${family}`);
  }
});

test('exact card art fills its card without an inset rim and keeps both fallbacks', () => {
  const assets = Object.fromEntries([...new Set([...Object.values(CARD_ART_FAMILY), ...Object.keys(CARD_ART_FAMILY)])].map(family => [`../../assets/game-art/bang-card-${family}.webp`, family]));
  const { BangCardArtwork, BANG_CARD_ART_FAMILY, BANG_CARD_EMBLEM } = load('components/bang/CardArtwork.tsx', {
    ...common, ...assets, 'react-native': { View: 'View' }, '../ui/CardIllustration': { CardIllustration: 'Illustration' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(BANG_CARD_ART_FAMILY)), CARD_ART_FAMILY);
  for (const [name, family] of Object.entries(CARD_ART_FAMILY)) {
    const tree = BangCardArtwork({ name });
    assert.equal(tree.props.testID, `bang-card-art-${name}`);
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.accessibilityElementsHidden, true);
    assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
    const cover = nodes(tree).find(node => node.type === 'Illustration');
    assert.equal(cover.props.source, name);
    assert.equal(cover.props.rimColor, undefined);
    assert.equal(cover.props.aspectRatio, undefined);
    assert.equal(tree.props.style.width, '100%');
    assert.equal(tree.props.style.maxWidth, undefined);
    assert.equal(cover.props.backgroundColor, palette.panel);
    assert.equal(cover.props.fallback.props.source, family);
    assert.equal(nodes(cover.props.fallback.props.fallback).find(node => node.type === 'Icon').props.name, BANG_CARD_EMBLEM[name]);
  }
});

test('fluid rail cards preserve their caller width and forward focus without selecting', () => {
  let focused = 0, pressed = 0;
  const tree = cardModule().BangCardView({ card, fluid: true, onFocus: () => focused++, onPress: () => pressed++ });
  assert.equal(tree.props.style.width, '100%');
  assert.equal(tree.props.style.minWidth, 0);
  assert.equal(tree.props.style.flexBasis, undefined);
  const button = nodes(tree).find(node => node.type === 'Pressable');
  button.props.onFocus(); assert.equal(focused, 1); assert.equal(pressed, 0);
  const disabled = cardModule().BangCardView({ card, disabled: true, fluid: true, onFocus: () => focused++, onPress: () => pressed++ });
  assert.equal(nodes(disabled).find(node => node.type === 'Pressable').props.onFocus, undefined);
});

test('shared artwork surface supports brown letterboxing without changing other games or failure semantics', () => {
  let failed = null;
  const ref = { current: null }, fallback = { type: 'Fallback' };
  const { GameCover } = load('components/ui/GameCover.tsx', {
    ...common, 'expo-linear-gradient': { LinearGradient: 'Gradient' }, react: { useRef: () => ref, useState: () => [failed, next => { failed = next; }] },
    'react-native': { View: 'View', Image: 'Image', StyleSheet: { absoluteFill: {} } },
    '../../constants/theme': { ARCADE: { surface: '#161028' } },
  });
  const normal = GameCover({ source: 10, fallback });
  assert.equal(normal.props.style.backgroundColor, '#161028');
  let themed = GameCover({ source: 11, backgroundColor: palette.panel, fallback });
  assert.equal(themed.props.style.backgroundColor, palette.panel);
  const image = nodes(themed).find(node => node.type === 'Image');
  assert.equal(image.props.resizeMode, 'contain');
  image.props.onError();
  themed = GameCover({ source: 11, backgroundColor: palette.panel, fallback });
  assert(nodes(themed).includes(fallback));
  assert.equal(themed.props.style.backgroundColor, palette.panel);
  assert(nodes(GameCover({ source: 12, fallback })).some(node => node.type === 'Image'));
});

test('illustrated entrance keeps actual create/join and rule ownership with approved cover fallback', () => {
  const { default: Landing } = load('app/bang/index.tsx', {
    ...common, '../../components/remaining/RemainingLanding': { RemainingLanding: 'Landing' },
    '../../components/remaining/RemainingArtwork': { BangMark: 'Mark' }, '../../components/bang/ReferenceSheet': { BangReferenceSheet: 'Rules' },
    '../../components/ui/GameCover': { GameCover: 'Cover' }, '../../assets/game-art/bang-hero.webp': 42,
  });
  const tree = Landing();
  assert.equal(tree.props.gameId, 'bang'); assert.equal(tree.props.base, '/bang');
  assert.equal(tree.props.presentation, 'illustrated');
  assert.equal(tree.props.hero.props.source, 42);
  assert.equal(tree.props.hero.props.nativeID, 'bang-entrance-art');
  assert.equal(tree.props.hero.props.fallback.type, 'Mark');
  const close = () => {}; const rules = tree.props.renderRules(true, close);
  assert.equal(rules.props.visible, true); assert.equal(rules.props.onClose, close);
});
