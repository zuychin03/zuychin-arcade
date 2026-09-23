const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(file, modules) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  return exports;
}
function hooks() {
  const values = []; let index = 0;
  return {
    reset: () => { index = 0; },
    react: {
      useState: initial => { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = value; }]; },
      useCallback: fn => fn, useEffect: () => {}, useRef: current => ({ current }),
    },
  };
}
const jsx = (type, props) => ({ type, props });
const palette = { bg: '#0B0716', surface: '#161028', panel: '#1F1838', border: '#2E2452', cyan: '#2EE6FF', text: '#EDEAFB', muted: '#8E86B3' };
function tileHarness(extra = {}, platform = 'web') {
  const state = hooks();
  const { GameTile } = load('components/ui/GameTile.tsx', {
    react: state.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Platform: { OS: platform } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    './GameCover': { GameCover: 'GameCover' }, '../../constants/theme': { ARCADE: palette },
  });
  const props = { title: 'SABOTEUR', subtitle: 'hidden roles · dig for gold or sabotage the dig', players: '3–10 players', accent: '#F5C518', icon: 'pickaxe', nativeID: 'game-tile-saboteur', ...extra };
  return { props, render: () => { state.reset(); return GameTile(props); } };
}

test('cover tile uses the approved image, stable IDs and honest mark fallback', () => {
  const h = tileHarness({ coverSource: 17, coverNativeID: 'game-cover-saboteur' });
  const tree = h.render();
  const button = tree.props.children;
  assert.equal(button.props.nativeID, 'game-tile-saboteur');
  const cover = nodes(tree).find(node => node.type === 'GameCover');
  assert.equal(cover.props.source, 17);
  assert.equal(cover.props.nativeID, 'game-cover-saboteur');
  assert.equal(cover.props.fallback.props.pointerEvents, 'none');
  assert.equal(cover.props.fallback.props.accessibilityElementsHidden, true);
  assert.equal(cover.props.fallback.props.children.props.name, 'pickaxe');
  assert.equal(nodes(tree).filter(node => node.type === 'Pressable').length, 1);
});

test('unillustrated games use their original artwork without invented image assets', () => {
  const artwork = { type: 'OriginalMark', props: {} };
  const tree = tileHarness({ artwork }).render();
  assert.equal(nodes(tree).filter(node => node.type === 'OriginalMark').length, 1);
  assert.equal(nodes(tree).filter(node => node.type === 'GameCover').length, 0);
});

test('phone fallback tiles use a small inline mark, not an empty cover panel', () => {
  const tree = tileHarness({ compact: true }).render();
  const mark = nodes(tree).find(node => node.props.accessibilityElementsHidden);
  assert.equal(mark.props.style.width, 48);
  assert.equal(mark.props.style.height, 48);
  assert.equal(mark.props.style.aspectRatio, undefined);
  assert.equal(mark.props.style.flexShrink, 0);
  assert(!nodes(tree).some(node => node.props.style?.aspectRatio));
  assert(nodes(tree).some(node => node.type === 'Text' && node.props.children === '3–10 players'));
  const illustrated = tileHarness({ compact: true, coverSource: 17 }).render();
  assert(nodes(illustrated).some(node => node.type === 'GameCover'));
});

test('player metadata and hook are distinct, unclamped text rows with unchanged accessible summary', () => {
  const h = tileHarness(); const tree = h.render();
  const button = tree.props.children;
  assert.equal(button.props.accessibilityRole, 'button');
  assert.equal(button.props.accessibilityLabel, 'SABOTEUR. 3–10 players · hidden roles · dig for gold or sabotage the dig');
  assert.match(button.props.accessibilityHint, /View rules, create a room or join a game/);
  for (const [copy, size] of [[h.props.players, 14], [h.props.subtitle, 16]]) {
    const text = nodes(tree).find(node => node.type === 'Text' && node.props.children === copy);
    assert(text); assert.equal(text.props.style.fontSize, size);
    assert.equal(text.props.numberOfLines, undefined);
    assert.equal(text.props.style.height, undefined);
  }
  const title = nodes(tree).find(node => node.type === 'Text' && node.props.children === 'SABOTEUR');
  assert.equal(title.props.style.minWidth, 0);
  assert.equal(title.props.style.flex, 1);
  assert.equal(title.props.style.textShadowColor, undefined);
  assert.equal(button.props.style({ pressed: false }).height, undefined);
  assert.equal(button.props.style({ pressed: false }).minHeight, 48);
});

for (const platform of ['web', 'ios', 'android']) {
  test(`${platform}: focus, hover and press feedback preserve dimensions without animation`, () => {
    const h = tileHarness({}, platform);
    let tree = h.render();
    const normal = tree.props.children.props.style({ pressed: false });
    assert.equal(tree.props.entering, undefined);
    assert.equal(normal.opacity, 1);
    assert.equal(normal.transform, undefined);
    assert.equal(normal.boxShadow, undefined);
    tree.props.children.props.onHoverIn(); tree = h.render();
    assert.equal(tree.props.children.props.style({ pressed: false }).borderColor, h.props.accent);
    tree.props.children.props.onHoverOut(); tree.props.children.props.onFocus(); tree = h.render();
    const focused = tree.props.children.props.style({ pressed: false });
    assert.equal(focused.borderWidth, normal.borderWidth);
    assert.equal(focused.outlineWidth, platform === 'web' ? 2 : undefined);
    assert.equal(tree.props.children.props.style({ pressed: true }).backgroundColor, palette.panel);
    tree.props.children.props.onBlur(); tree = h.render();
    assert.equal(tree.props.children.props.style({ pressed: false }).borderColor, palette.border);
  });
}

test('locked state stays disabled and cannot advertise an enabled hover/focus or image', () => {
  const h = tileHarness({ locked: true, coverSource: 17 });
  let tree = h.render();
  const button = tree.props.children;
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  assert.equal(button.props.accessibilityHint, undefined);
  button.props.onHoverIn(); button.props.onFocus(); tree = h.render();
  const style = tree.props.children.props.style({ pressed: true });
  assert.equal(style.borderColor, palette.border);
  assert.equal(style.boxShadow, undefined);
  assert.equal(style.outlineWidth, undefined);
  assert.equal(style.opacity, 0.55);
  assert(!nodes(tree).some(node => node.type === 'GameCover'));
  assert(nodes(tree).some(node => node.type === 'Icon' && node.props.name === 'lock-outline'));
});

function hubHarness(fontScale = 1, viewport = { width: 1280, height: 900 }) {
  const state = hooks(); const routes = [];
  const store = { token: null, playerId: null, roomCode: null, room: null };
  const modules = {
    react: state.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({ ...viewport, fontScale }) },
    'expo-router': { router: { push: route => routes.push(route) } }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../store/useGameStore': { useGameStore: fn => fn(store) }, '../../lib/api': {}, '../../lib/tokenUtils': {}, '../../lib/storage': {},
    '../../components/ui/GameTile': { GameTile: 'GameTile' }, '../../components/ui/ScalePressable': { ScalePressable: 'ScalePressable' }, '../../components/ui/NeonButton': { NeonButton: 'NeonButton' },
    '../../assets/game-art/saboteur-cover.webp': 17,
    '../../assets/game-art/colt-cover.webp': 18,
    '../../assets/game-art/coup-cover.webp': 19,
    '../../assets/game-art/tokyo-cover.webp': 20,
    '../../assets/game-art/skull-cover.webp': 21,
    '../../assets/game-art/citadels-cover.webp': 22,
    '../../assets/game-art/not-alone-cover.webp': 23,
    '../../assets/game-art/bang-cover.webp': 24,
    '../../assets/game-art/libertalia-cover.webp': 25,
    '../../components/king-of-tokyo/TokyoArtwork': {}, '../../components/skull-king/SkullKingArtwork': {}, '../../components/citadels/CitadelsArtwork': {}, '../../components/not-alone/NotAloneArtwork': {}, '../../components/remaining/RemainingArtwork': {},
    '../../constants/theme': Object.fromEntries(['ARCADE', 'BANG', 'CITADELS', 'COLT', 'COUP', 'LIBERTALIA', 'MINE', 'NOT_ALONE', 'SKULL_KING', 'TOKYO'].map(key => [key, palette])),
  };
  const Hub = load('app/(arcade)/index.tsx', modules).default;
  return { routes, render: () => { state.reset(); return Hub(); } };
}
const expected = [
  ['SABOTEUR', '3–10 players', '/saboteur'], ['COUP', '2–10 players', '/coup'], ['KING OF TOKYO', '2–6 players', '/king-of-tokyo'],
  ['SKULL KING', '3–8 players', '/skull-king'], ['CITADELS', '4–7 players', '/citadels'], ['NOT ALONE', '2–7 players', '/not-alone'],
  ['BANG!', '4–7 players', '/bang'], ['LIBERTALIA', '2–6 players', '/libertalia'], ['COLT EXPRESS', '2–6 players', '/colt-express'],
];

test('catalogue keeps all nine titles, player counts and actual route callbacks in order', () => {
  const h = hubHarness(); const tree = h.render();
  const tiles = nodes(tree).filter(node => node.type === 'GameTile');
  assert.equal(tiles.length, 9);
  tiles.forEach((tile, i) => {
    assert.equal(tile.props.title, expected[i][0]);
    assert.equal(tile.props.players, expected[i][1]);
    assert.equal(tile.props.nativeID, `game-tile-${expected[i][2].slice(1)}`);
    tile.props.onPress();
  });
  assert.deepEqual(h.routes, expected.map(row => row[2]));
  assert.equal(tiles[0].props.coverSource, 17);
  assert.equal(tiles[0].props.coverNativeID, 'game-cover-saboteur');
  assert.equal(tiles[1].props.coverSource, 19);
  assert.equal(tiles[1].props.coverNativeID, 'game-cover-coup');
  assert.equal(tiles[2].props.coverSource, 20);
  assert.equal(tiles[2].props.coverNativeID, 'game-cover-tokyo');
  assert.equal(tiles[3].props.coverSource, 21);
  assert.equal(tiles[3].props.coverNativeID, 'game-cover-skull');
  assert.equal(tiles[4].props.coverSource, 22);
  assert.equal(tiles[4].props.coverNativeID, 'game-cover-citadels');
  assert.equal(tiles[5].props.coverSource, 23);
  assert.equal(tiles[5].props.coverNativeID, 'game-cover-not-alone');
  assert.equal(tiles[6].props.coverSource, 24);
  assert.equal(tiles[6].props.coverNativeID, 'game-cover-bang');
  assert.equal(tiles[7].props.coverSource, 25);
  assert.equal(tiles[7].props.coverNativeID, 'game-cover-libertalia');
  assert.equal(tiles.at(-1).props.coverSource, 18);
  assert.equal(tiles.at(-1).props.coverNativeID, 'game-cover-colt');
  assert(nodes(tree).some(node => node.props.style?.maxWidth === 1280));
  assert.equal(nodes(tree).filter(node => node.props.accessibilityRole === 'header').length, 1);
  assert(!nodes(tree).some(node => node.props.entering));
});

test('measured columns adapt to sidebar-constrained widths and 150/200 percent native text', () => {
  for (const [width, fontScale, columns] of [[280, 1, 1], [335, 1, 1], [374, 1, 1], [335, 2, 1], [728, 1, 2], [980, 1, 3], [1280, 1, 3], [980, 1.5, 2], [980, 2, 1], [1280, 2, 2]]) {
    const h = hubHarness(fontScale); let tree = h.render();
    nodes(tree).find(node => node.props.nativeID === 'arcade-game-library').props.onLayout({ nativeEvent: { layout: { width } } });
    tree = h.render();
    const tiles = nodes(tree).filter(node => node.type === 'GameTile');
    assert(tiles.every(tile => tile.props.width === Math.floor((width - 14 * (columns - 1)) / columns)));
    assert(tiles[0].props.width * columns + 14 * (columns - 1) <= width);
    assert(tiles.every(tile => tile.props.compact === (columns === 1)));
  }
});

test('short landscape uses readable horizontal artwork and one measured column only in that context', () => {
  for (const [viewport, libraryWidth, shortLandscape] of [
    [{ width: 844, height: 390 }, 544, true],
    [{ width: 1280, height: 390 }, 980, true],
    [{ width: 1280, height: 900 }, 980, false],
    [{ width: 375, height: 812 }, 335, false],
    [{ width: 320, height: 480 }, 280, false],
    [{ width: 844, height: 500 }, 544, false],
  ]) {
    const h = hubHarness(1, viewport); let tree = h.render();
    nodes(tree).find(node => node.props.nativeID === 'arcade-game-library').props.onLayout({ nativeEvent: { layout: { width: libraryWidth } } });
    tree = h.render();
    const tiles = nodes(tree).filter(node => node.type === 'GameTile');
    assert.equal(tiles[0].props.horizontalCover, shortLandscape);
    assert.equal(tiles[1].props.horizontalCover, shortLandscape);
    assert.equal(tiles[2].props.horizontalCover, shortLandscape);
    assert.equal(tiles[3].props.horizontalCover, shortLandscape);
    assert.equal(tiles[4].props.horizontalCover, shortLandscape);
    assert.equal(tiles.at(-1).props.horizontalCover, shortLandscape);
    if (shortLandscape) assert(tiles.every(tile => tile.props.width === libraryWidth && tile.props.compact));
    if (viewport.width === 1280 && viewport.height === 900) assert.equal(tiles[0].props.width, Math.floor((980 - 28) / 3));
  }
});

test('fractional library measurements leave room for all intended columns', () => {
  const h = hubHarness(); let tree = h.render();
  nodes(tree).find(node => node.props.nativeID === 'arcade-game-library').props.onLayout({ nativeEvent: { layout: { width: 979.828125 } } });
  tree = h.render();
  const widths = nodes(tree).filter(node => node.type === 'GameTile').map(tile => tile.props.width);
  assert(widths.every(width => width === 317));
  assert(widths[0] * 3 + 28 < 979.828125);
});

test('short-landscape cover is bounded while text, focus and action remain fully available', () => {
  let pressed = false;
  const h = tileHarness({ coverSource: 17, width: 544, horizontalCover: true, onPress: () => { pressed = true; } });
  let tree = h.render();
  const button = tree.props.children;
  assert.equal(button.props.style({ pressed: false }).flexDirection, 'row');
  const [art, body] = button.props.children;
  assert.equal(art.props.style.width, '35%');
  assert.equal(art.props.style.maxWidth, 180);
  assert.equal(art.props.style.flexShrink, 0);
  assert.equal(body.props.style.flex, 1);
  assert.equal(body.props.style.minWidth, 0);
  assert(nodes(body).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined && node.props.style.height === undefined));
  button.props.onPress(); assert(pressed);
  button.props.onFocus(); tree = h.render();
  assert.equal(tree.props.children.props.style({ pressed: false }).outlineWidth, 2);
  assert.equal(tree.props.children.props.accessibilityLabel, button.props.accessibilityLabel);
  const portrait = tileHarness({ coverSource: 17, compact: true }).render();
  assert.equal(portrait.props.children.props.style({ pressed: false }).flexDirection, 'column');
  const noCover = tileHarness({ compact: true, horizontalCover: true }).render();
  assert.equal(noCover.props.children.props.style({ pressed: false }).flexDirection, 'column');
  assert.equal(nodes(noCover).find(node => node.props.accessibilityElementsHidden).props.style.width, 48);
});
