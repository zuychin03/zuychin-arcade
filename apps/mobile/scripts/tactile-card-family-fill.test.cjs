const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
function load(file, platform = 'web', fontScale = 1) {
  const palette = { bg: '#000', surface: '#111', panel: '#222', gold: '#fc0', text: '#fff' };
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Platform: { OS: platform }, useWindowDimensions: () => ({ width: 375, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../constants/theme': { BANG: palette, NOT_ALONE: palette, CITADELS: palette, SKULL_KING: palette },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    '../ui/CardSurface': { CardSurface: 'Surface' },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: () => ({ textScale: fontScale, textRef: { current: null }, onTextLayout() {} }) },
    './CardArtwork': { BangCardArtwork: 'Artwork', BANG_CARD_EMBLEM: { beer: 'beer' } },
    './PlaceArtwork': { PlaceArtwork: 'Artwork' },
    './CitadelsDistrictArtwork': { CitadelsDistrictArtwork: 'Artwork', citadelsDistrictIcons: { unique: 'castle' } },
    './SkullKingCardArtwork': { SkullKingCardArtwork: 'Artwork' },
    '@zuychin-arcade/types': {
      NOT_ALONE_PLACE_BY_ID: { 1: { name: 'The Lair', summary: 'Complete Place rules.', accent: '#abc' } },
      CITADELS_ROLE_BY_ID: { king: { name: 'King', rank: 4, summary: 'Complete role rules.' } },
    },
  };
  const exports = {};
  const result = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(result.outputText, { exports, require(name) { assert(name in modules, name); return modules[name]; } });
  return exports;
}

const families = [
  ['bang/Card.tsx', 'BangCardView', { card: { id: 'beer-1', name: 'beer', rank: 'Q', suit: 'hearts' }, fluid: true }],
  ['not-alone/PlaceCard.tsx', 'NotAlonePlaceCard', { placeId: 1, fluid: true }],
  ['not-alone/CardChip.tsx', 'CardChip', { cardId: 'hunt-1', title: 'Hunt', body: 'Complete hunt rules.', color: '#abc', disabled: false, needsOptions: true }],
  ['citadels/CitadelsCard.tsx', 'CitadelsDistrictView', { card: { id: 'district-1', name: 'Library', cost: 6, color: 'unique', effectText: 'Complete district rules.' } }],
  ['citadels/CitadelsCard.tsx', 'CitadelsRoleCard', { role: 'king' }],
  ['skull-king/SkullKingCard.tsx', 'SkullKingCardView', { card: { id: 'king-1', kind: 'skull_king' } }],
];

for (const [file, name, props] of families) test(`${name} fills the real face through every interactive wrapper without changing the action`, () => {
  for (const platform of ['web', 'ios', 'android']) for (const scale of [1, 2]) {
    const component = load(`components/${file}`, platform, scale)[name];
    let calls = 0;
    const action = () => calls++;
    const tree = component({ ...props, onPress: action, selected: true });
    const all = nodes(tree), surface = all.find(node => node.type === 'Surface');
    assert.equal(surface.props.fill, true);
    const button = all.find(node => node.type === 'Button');
    assert.equal(button.props.onPress, action);
    assert.equal(all.filter(node => node.type === 'Button').length, 1);
    const isDirectRailButton = file.startsWith('citadels/') || file.startsWith('skull-king/');
    if (isDirectRailButton) assert.equal(button.props.children.props.style.flexGrow, 1);
    else assert.equal(button.props.style.flexGrow, 1);
    assert(!all.some(node => node.props.numberOfLines !== undefined));
    assert(!all.some(node => node.props.style?.height !== undefined));
    assert.equal(calls, 0);
    button.props.onPress(); assert.equal(calls, 1);
  }
});

test('passive row cards keep their widths and do not grow along the horizontal axis', () => {
  for (const [file, name, props] of families.filter(([file]) => file !== 'not-alone/CardChip.tsx')) {
    const tree = load(`components/${file}`)[name]({ ...props, fluid: false });
    const surface = nodes(tree).find(node => node.type === 'Surface');
    assert.equal(surface.props.fill, true);
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 0);
    if (file !== 'bang/Card.tsx') assert.equal(tree.props.style.flexGrow, undefined);
    if (file.startsWith('citadels/')) assert.equal(tree.props.style.alignSelf, 'stretch');
  }
});

test('rail parents stretch while preserving their independent browse and selection callbacks', () => {
  for (const file of ['components/bang/Hand.tsx', 'components/not-alone/PlaceChoiceRow.tsx']) {
    const source = read(file);
    assert.match(source, /alignItems: 'stretch'/);
    assert.match(source, /flexShrink: 0/);
    assert.match(source, /onFocus/);
    assert.match(source, /animated: false/);
    assert.doesNotMatch(source, /alignItems: 'flex-start'/);
  }
  assert.match(read('app/not-alone/game.tsx'), /setHandViewportWidth[\s\S]*?contentContainerStyle=\{\{[^}]*alignItems: 'stretch'/);
});

test('district and role sizing retains compact widths and selection lift', () => {
  const cards = load('components/citadels/CitadelsCard.tsx');
  assert.equal(cards.citadelsCardWidth('district', true), 176);
  assert.equal(cards.citadelsCardWidth('district', false), 208);
  assert.equal(cards.citadelsCardWidth('role', true), 180);
  const tree = cards.CitadelsRoleCard({ role: 'king', selected: true, onPress() {} });
  assert.equal(tree.props.children.props.style.transform[0].translateY, -4);
  const skull = load('components/skull-king/SkullKingCard.tsx');
  assert.equal(skull.skullKingCardWidth(true), 120);
  assert.equal(skull.skullKingCardWidth(false), 148);
});

function heightHarness() {
  const cells = [];
  let cursor = 0;
  const react = {
    useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }]; },
  };
  const exports = {};
  const code = ts.transpileModule(read('hooks/useIntrinsicCardHeight.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { assert.equal(name, 'react'); return react; } });
  return (ids, key = '375:1') => { cursor = 0; return exports.useIntrinsicCardHeight(ids, key); };
}

test('intrinsic face group grows and shrinks when natural text becomes longer or shorter', () => {
  const render = heightHarness();
  let group = render(['a', 'b']);
  group.forCard('a').onMeasure(180); group.forCard('b').onMeasure(260);
  group = render(['a', 'b']);
  assert.equal(group.forCard('a').minimumHeight, 260);
  group.forCard('a').onMeasure(340);
  assert.equal(render(['a', 'b']).forCard('b').minimumHeight, 340);
  group.forCard('a').onMeasure(140); group.forCard('b').onMeasure(160);
  assert.equal(render(['a', 'b']).forCard('a').minimumHeight, 160);
});

test('reordering preserves keyed measurements while removal and replacement cannot retain a departed maximum', () => {
  const render = heightHarness();
  let group = render(['a', 'b']);
  group.forCard('a').onMeasure(500); group.forCard('b').onMeasure(180);
  const oldKey = group.forCard('a').measurementKey;
  group = render(['b', 'a']);
  assert.equal(group.forCard('b').minimumHeight, 500);
  assert.equal(group.forCard('b').measurementKey, oldKey);
  const retired = group.forCard('a');
  group = render(['b']);
  assert.equal(group.forCard('b').minimumHeight, 0);
  retired.onMeasure(700);
  group.forCard('b').onMeasure(180);
  assert.equal(render(['b']).forCard('b').minimumHeight, 180);
  group = render(['c']);
  assert.equal(group.forCard('c').minimumHeight, 0);
  group.forCard('c').onMeasure(120);
  assert.equal(render(['c']).forCard('c').minimumHeight, 120);
});

test('width and text-scale epochs ignore stale callbacks and shrink from fresh natural measurements', () => {
  const render = heightHarness();
  const old = render(['a', 'b'], '320:2');
  old.forCard('a').onMeasure(650); old.forCard('b').onMeasure(590);
  const fresh = render(['a', 'b'], '1280:1');
  assert.equal(fresh.forCard('a').minimumHeight, 0);
  assert.notEqual(fresh.forCard('a').measurementKey, old.forCard('a').measurementKey);
  fresh.forCard('a').onMeasure(220); old.forCard('b').onMeasure(900); fresh.forCard('b').onMeasure(200);
  assert.equal(render(['a', 'b'], '1280:1').forCard('a').minimumHeight, 220);
  for (const height of [NaN, Infinity, -1, 0]) fresh.forCard('a').onMeasure(height);
  fresh.forCard('absent').onMeasure(1000);
  assert.equal(render(['a', 'b'], '1280:1').forCard('a').minimumHeight, 220);
});

test('map and trick measurements come from un-stretched content, never the allocated face or pressable', () => {
  for (const [file, name, props] of families.filter(([file]) => file === 'not-alone/PlaceCard.tsx' || file === 'skull-king/SkullKingCard.tsx')) {
    const reported = [];
    const action = () => {};
    const faceSizing = { minimumHeight: 700, measurementKey: 'new-width', onMeasure: height => reported.push(height) };
    const tree = load(`components/${file}`)[name]({ ...props, faceSizing, onPress: action });
    const all = nodes(tree), measure = all.find(node => node.type === 'View' && node.props.onLayout);
    assert.equal(all.filter(node => node.type === 'View' && node.props.onLayout).length, 1);
    assert.equal(all.filter(node => node.type === 'Text' && node.props.onLayout).length, 1);
    assert.equal(measure.key, 'new-width');
    assert.equal(measure.props.style.flexGrow, undefined);
    assert.equal(measure.props.style.flexShrink, 0);
    assert.notEqual(measure.props.style.minHeight, 700);
    assert.equal(all.find(node => node.type === 'Button').key, undefined);
    assert.equal(all.find(node => node.type === 'Button').props.onPress, action);
    measure.props.onLayout({ nativeEvent: { layout: { height: 180 } } });
    assert.deepEqual(reported, [180]);
    assert(all.some(node => node.props.style?.minHeight === (file.startsWith('not-alone/') ? 703 : 700)));
  }
});

test('public routes keep each real card before its caption and measure only the face family', () => {
  const map = read('app/not-alone/game.tsx'), trick = read('app/skull-king/game.tsx');
  assert.match(map, /faceSizing=\{mapFaces\.forCard\(String\(place\)\)\}[\s\S]*?tokens\.length/);
  assert.match(map, /onLayout=\{event => setMapWidth\(event\.nativeEvent\.layout\.width\)\}/);
  assert.match(trick, /faceSizing=\{trickFaces\.forCard\(card\.id\)\}[\s\S]*?skull-trick-owner-/);
  assert.match(trick, /onLayout=\{event => setTrickWidth\(event\.nativeEvent\.layout\.width\)\}/);
  assert.doesNotMatch(map + trick, /key=\{(?:mapFaces|trickFaces)/);
});
