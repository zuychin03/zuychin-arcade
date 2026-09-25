const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function harness(width = 320, reduced = false) {
  const cache = new Map();
  const effects = [];
  const jsx = (type, props) => ({ type, props });
  const surface = 'CardSurface';
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: { useEffect: fn => effects.push(fn), useMemo: fn => fn(), useRef: () => ({ current: null }) },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width }) },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path' },
    'react-native-reanimated': { default: { View: 'Animated.View' }, useSharedValue: value => ({ value }), useAnimatedStyle: fn => fn(), withSpring: value => value },
    '@zuychin-arcade/types': { BOARD: { playableBounds: { minRow: 0, maxRow: 8, minCol: 2, maxCol: 6 } } },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, require(id) {
      if (id in modules) return modules[id];
      if (id.endsWith('/CardSurface')) return { CardSurface: surface };
      if (id.endsWith('/GameCover')) return { GameCover: 'GameCover' };
      if (id.endsWith('/CardIllustration')) return { CardIllustration: 'Illustration' };
      if (id.endsWith('/OverlayFrame')) return { OverlayFrame: 'OverlayFrame' };
      if (id.endsWith('.webp')) {
        const asset = path.resolve(path.dirname(filename), id);
        assert(fs.existsSync(asset), asset);
        return asset;
      }
      if (id.endsWith('/GlowPulse')) return { GlowPulse: 'GlowPulse' };
      if (id.endsWith('/NeonButton')) return { NeonButton: 'NeonButton' };
      if (id.endsWith('/useReducedMotionPreference')) return { useReducedMotionPreference: () => reduced };
      if (id.endsWith('/placement')) return { rotateEdges: (e, rotate) => rotate ? { top: e.bottom, right: e.left, bottom: e.top, left: e.right, center: e.center } : e };
      if (id.endsWith('/theme')) return { ARCADE: { cyan: '#2EE6FF', red: '#FF3355', pink: '#FF2E88', text: '#EDEAFB', muted: '#8E86B3', border: '#2E2452', bg: '#0B0716' }, MINE: { bg: '#130E1F', gold: '#F5C518', stone: '#6B7280' }, neonBox: colour => ({ boxShadow: colour }) };
      return load(path.resolve(path.dirname(filename), id + '.tsx'));
    } });
    cache.set(filename, exports);
    return exports;
  }
  return { load: name => load(path.resolve(__dirname, '../components/saboteur', name + '.tsx')), effects };
}
function nodes(tree, expand = false) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, expand));
  if (expand && typeof tree.type === 'function') return nodes(tree.type(tree.props), true);
  return [tree, ...nodes(tree.props?.children, expand)];
}
const edges = { top: 'open', right: 'blocked', bottom: 'blocked', left: 'open', center: true };
const card = { id: 'path-one', type: 'path', subtype: 'tunnel', edges };
const baseCell = { placed: null, goal: null, peekedGoal: null, isValidTarget: false, isActionTarget: false, isInteractive: false, row: 1, col: 3, width: 56, height: 81, onPress() {} };

test('path face uses physical material without changing its aperture footprint or rotation', () => {
  const { PathCardView } = harness().load('cards/PathCardView');
  for (const rotated of [false, true]) {
    const tree = PathCardView({ card, rotated, width: 54, height: 79, depth: 1 });
    assert.equal(tree.type, 'CardSurface');
    assert.equal(tree.props.width, 54);
    assert.equal(tree.props.height, 79);
    assert.equal(tree.props.depth, 1);
    const arms = nodes(tree).find(n => typeof n.type === 'function');
    assert.deepEqual(JSON.parse(JSON.stringify(arms.props.edges)), rotated ? { top: 'blocked', right: 'open', bottom: 'open', left: 'blocked', center: true } : edges);
    const paths = nodes(arms, true).filter(n => n.type === 'Path');
    assert.equal(paths.length, 6);
    assert.equal(arms.props.width, 54);
    assert.equal(arms.props.height, 79);
  }
});

test('board tile and concealed goal depth fit the unchanged two-pixel cell gutter', () => {
  const { BoardCell } = harness().load('board/BoardCell');
  for (const props of [{ placed: { card } }, { goal: { revealed: false } }]) {
    const tree = BoardCell({ ...baseCell, ...props });
    assert.equal(tree.props.nativeID, 'saboteur-cell-1-3');
    assert.equal(tree.props.style.width, 56);
    assert.equal(tree.props.style.height, 81);
    assert.equal(tree.props.style.padding, 1);
    const material = nodes(tree, true).find(n => n.type === 'CardSurface');
    assert.equal(material.props.depth, 1);
    assert.equal(material.props.width, 54);
    assert.equal(material.props.height, 79);
  }
});

test('hand paths fill their intrinsic row without retaining a measured height', () => {
  const { PathCardView } = harness().load('cards/PathCardView');
  for (const rotated of [false, true]) {
    const tree = PathCardView({ card, rotated, width: 76, height: 114, fill: true });
    assert.equal(tree.type, 'View');
    assert.equal(tree.props.style.minHeight, 114);
    assert.equal(tree.props.style.flexGrow, 1);
    assert.equal(tree.props.style.height, undefined);
    assert.equal(tree.props.onLayout, undefined);
    const surface = tree.props.children;
    assert.equal(surface.props.fill, true);
    assert.equal(surface.props.height, undefined);
    const arms = nodes(surface).find(n => typeof n.type === 'function');
    assert.equal(arms.props.fill, true);
    assert.deepEqual(JSON.parse(JSON.stringify(arms.props.edges)), rotated ? { top: 'blocked', right: 'open', bottom: 'open', left: 'blocked', center: true } : edges);
    const svg = nodes(arms, true).find(n => n.type === 'Svg');
    assert.equal(svg.props.width, '100%');
    assert.equal(svg.props.height, '100%');
    assert.equal(svg.props.viewBox, '0 0 76 114');
    assert.equal(svg.props.preserveAspectRatio, 'none');
  }
});

test('hand action faces stretch with full labels and no imposed text height', () => {
  const { ActionCardView } = harness().load('cards/ActionCardView');
  const tree = ActionCardView({ card: { subtype: 'repair_lantern_pickaxe' }, width: 76, height: 114, fill: true });
  assert.equal(tree.props.fill, true);
  assert.equal(tree.props.height, undefined);
  const gradient = tree.props.children;
  assert.equal(gradient.props.style.flexGrow, 1);
  assert.equal(gradient.props.style.minHeight, 114);
  assert.equal(gradient.props.style.height, undefined);
  assert(nodes(tree).some(n => n.type === 'Text' && n.props.children === 'Lamp/Pick'));
  assert(nodes(tree).filter(n => n.type === 'Text').every(n => n.props.numberOfLines === undefined));
});

test('the live mixed hand opts into equal row heights without altering board tiles', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../app/saboteur/game.tsx'), 'utf8');
  assert.match(route, /contentContainerStyle=\{\{ gap: 6, paddingHorizontal: 3, alignItems: 'stretch' \}\}/);
  assert.match(route, /<PathCardView card=\{card\} rotated=\{selected && rotated\} \{\.\.\.handCardSize\} fill \/>/);
  assert.match(route, /<ActionCardView card=\{card\} \{\.\.\.handCardSize\} fill \/>/);
  assert.match(route, /saboteurHandCardSize\(fontScale, handHeadingFontSize\)/);
  const board = fs.readFileSync(path.resolve(__dirname, '../components/saboteur/board/BoardCell.tsx'), 'utf8');
  assert.doesNotMatch(board, /\bfill[=\s/>]/);
});

test('mixed hand dimensions follow genuine text scale once and restore to the base footprint', () => {
  const { saboteurHandCardSize, ActionCardView } = harness().load('cards/ActionCardView');
  const { PathCardView } = harness().load('cards/PathCardView');
  for (const [native, measured, scale] of [[1, 12, 1], [1, 24, 2], [2, 12, 2], [2, 24, 2], [1.5, 24, 2], [3, 36, 3], [1, 12, 1], [NaN, Infinity, 1], [-1, -24, 1]]) {
    const size = saboteurHandCardSize(native, measured);
    assert.equal(size.width, 76 * scale);
    assert.equal(size.height, 114 * scale);
    const pathFace = PathCardView({ card, ...size, fill: true });
    for (const subtype of ['sabotage_lantern', 'sabotage_cart', 'sabotage_pickaxe', 'repair_lantern', 'repair_cart', 'repair_pickaxe', 'repair_lantern_cart', 'repair_lantern_pickaxe', 'repair_cart_pickaxe', 'map', 'rockfall']) {
      const action = ActionCardView({ card: { subtype }, ...size, fill: true });
      assert.equal(action.props.width, pathFace.props.style.width);
      assert.equal(action.props.children.props.style.minHeight, pathFace.props.style.minHeight);
      const texts = nodes(action).filter(n => n.type === 'Text');
      assert.equal(texts[0].props.style.fontSize, 76 * .15);
      assert.equal(texts[1].props.style.fontSize, 76 * .16);
      for (const text of texts) {
        assert.equal(text.props.style.fontFamily, 'Outfit_800ExtraBold');
        assert.equal(text.props.numberOfLines, undefined);
        assert.equal(text.props.adjustsFontSizeToFit, undefined);
        assert.equal(text.props.allowFontScaling, undefined);
        assert.equal(text.props.style.height, undefined);
        assert.equal(text.props.style.flexShrink, 0);
      }
    }
  }
  const defaultFace = ActionCardView({ card: { subtype: 'map' } });
  assert.equal(defaultFace.props.width, 56);
  assert.equal(defaultFace.props.children.props.style.minHeight, 84);
  assert.deepEqual(nodes(defaultFace).filter(n => n.type === 'Text').map(n => n.props.style.fontSize), [11, 12]);
});

test('hand heading measures actual web text and accepts restoration without native DOM access', () => {
  const filename = path.resolve(__dirname, '../app/saboteur/game.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(p => p.name?.text === 'nativeID' && p.initializer?.text === 'saboteur-hand-heading')) {
      callback = node.attributes.properties.find(p => p.name?.text === 'onLayout').initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(callback);
  const code = ts.transpileModule(`(${callback})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let actual = '24px';
  const updates = [];
  const element = {};
  const context = { Platform: { OS: 'web' }, handHeadingRef: { current: element }, setHandHeadingFontSize: size => updates.push(size), window: { getComputedStyle: node => {
    assert.equal(node, element);
    return { fontSize: actual };
  } } };
  for (actual of ['24px', '12px', '18px', 'invalid', '0px']) vm.runInNewContext(code, context);
  assert.deepEqual(updates, [24, 12, 18]);
  vm.runInNewContext(code, { ...context, Platform: { OS: 'ios' }, window: { getComputedStyle() { throw Error('native accessed DOM'); } } });
  vm.runInNewContext(code, { ...context, handHeadingRef: { current: null } });
  assert.deepEqual(updates, [24, 12, 18]);
});

test('hidden goal face never receives private identity, while its own accessible map survives', () => {
  const { BoardCell } = harness().load('board/BoardCell');
  const tree = BoardCell({ ...baseCell, goal: { revealed: false }, peekedGoal: { isGold: true } });
  assert.match(tree.props.accessibilityLabel, /Your private map says gold/);
  const back = nodes(tree).find(n => n.type?.name === 'CardBack');
  assert.equal(back.props.icon, 'help');
  assert.equal(back.props.isGold, undefined);
  const unpeeked = BoardCell({ ...baseCell, goal: { revealed: false } });
  assert.doesNotMatch(unpeeked.props.accessibilityLabel, /private map/);
});

test('recessed slot preserves legal targeting and is distinct from a raised card', () => {
  const { BoardCell } = harness().load('board/BoardCell');
  let pressed = 0;
  const tree = BoardCell({ ...baseCell, isInteractive: true, isValidTarget: true, onPress: () => pressed++ });
  assert.equal(tree.props.accessibilityRole, 'button');
  assert.equal(tree.props.disabled, false);
  assert.match(tree.props.accessibilityLabel, /Legal target/);
  tree.props.onPress();
  assert.equal(pressed, 1);
  const slot = tree.props.children;
  assert.notEqual(slot.props.style.borderTopColor, slot.props.style.borderBottomColor);
  assert.equal(nodes(tree).filter(n => n.type === 'CardSurface').length, 0);
  assert.equal(nodes(tree).find(n => n.type === 'Icon').props.name, 'plus');
});

test('all action faces keep their labels and distinct tool affordances on the material shell', () => {
  const { ActionCardView } = harness().load('cards/ActionCardView');
  for (const [subtype, label] of [['sabotage_lantern', 'Break Lamp'], ['repair_cart', 'Fix Cart'], ['repair_lantern_pickaxe', 'Lamp/Pick'], ['map', 'Map Goal'], ['rockfall', 'Rockfall']]) {
    const tree = ActionCardView({ card: { subtype }, width: 76, height: 114 });
    assert.equal(tree.type, 'CardSurface');
    assert.equal(tree.props.depth, 3);
    assert.equal(tree.props.width, 76);
    assert.equal(tree.props.height, undefined);
    assert.equal(tree.props.children.props.style.minHeight, 114);
    assert.equal(tree.props.children.props.style.height, undefined);
    for (const labelNode of nodes(tree).filter(n => n.type === 'Text')) {
      assert.equal(labelNode.props.style.alignSelf, 'stretch');
      assert.equal(labelNode.props.style.flexShrink, 0);
      assert.equal(labelNode.props.numberOfLines, undefined);
    }
    assert(nodes(tree).some(n => n.type === 'Text' && n.props.children === label));
    const art = nodes(tree, true).filter(n => n.type === 'Illustration');
    assert(art.length > 0);
    assert(art.every(n => nodes(n.props.fallback).some(fallback => fallback.type === 'Icon')));
  }
});

test('mine back preserves its concealed icon without tiny decorative branding', () => {
  const { CardBack } = harness().load('cards/CardBack');
  const tree = CardBack({ width: 54, height: 79, depth: 1, icon: 'help' });
  assert.equal(tree.type, 'CardSurface');
  assert.equal(tree.props.depth, 1);
  const art = nodes(tree).find(n => n.type === 'Illustration');
  assert.equal(path.basename(art.props.source), 'saboteur-deck-back.webp');
  assert(nodes(art.props.fallback).some(n => n.type === 'Icon' && n.props.name === 'help'));
  assert(!nodes(tree).some(n => n.type === 'Text'));
  for (const n of nodes(tree).filter(n => n.props.accessibilityElementsHidden)) assert.equal(n.props.pointerEvents, 'none');
});

test('eleven action subtypes fill the card width and keep exact tool states and dual repairs', () => {
  const { ActionCardView } = harness().load('cards/ActionCardView');
  const expected = {
    sabotage_lantern: ['tool-lantern-broken'], sabotage_cart: ['tool-cart-broken'], sabotage_pickaxe: ['tool-pickaxe-broken'],
    repair_lantern: ['tool-lantern-intact'], repair_cart: ['tool-cart-intact'], repair_pickaxe: ['tool-pickaxe-intact'],
    repair_lantern_cart: ['tool-lantern-intact', 'tool-cart-intact'],
    repair_lantern_pickaxe: ['tool-lantern-intact', 'tool-pickaxe-intact'],
    repair_cart_pickaxe: ['tool-cart-intact', 'tool-pickaxe-intact'],
    map: ['action-map'], rockfall: ['action-rockfall'],
  };
  for (const width of [56, 76, 96, 152]) for (const [subtype, files] of Object.entries(expected)) {
    const tree = ActionCardView({ card: { subtype }, width, height: width * 1.5 });
    const artNode = nodes(tree).find(n => n.type?.name === 'ActionArtwork');
    assert.equal(artNode.props.size, width);
    const art = artNode.type(artNode.props);
    assert.equal(art.props.style.width, width);
    assert.equal(art.props.style.height, width);
    assert.equal(art.props.accessibilityElementsHidden, true);
    assert.equal(art.props.pointerEvents, 'none');
    const covers = nodes(art).filter(n => n.type === 'Illustration');
    assert.deepEqual(covers.map(n => path.basename(n.props.source)), files.map(file => `saboteur-${file}.webp`));
    assert(covers.every(n => n.props.aspectRatio === 1));
    const badge = nodes(tree).find(n => n.type === 'Icon');
    if (subtype.startsWith('sabotage_')) assert.equal(badge.props.name, 'alert-circle');
    if (subtype.startsWith('repair_')) assert.equal(badge.props.name, 'wrench');
  }
});

test('action illustrations and backs use one card shell without padded or bordered inner frames', () => {
  const h = harness();
  const { ActionCardView } = h.load('cards/ActionCardView');
  const { CardBack } = h.load('cards/CardBack');
  for (const subtype of ['map', 'repair_lantern_cart', 'sabotage_pickaxe']) {
    const tree = ActionCardView({ card: { subtype }, width: 76, height: 114, fill: true });
    const face = tree.props.children;
    for (const field of ['padding', 'borderWidth', 'borderRadius']) assert.equal(face.props.style[field], undefined);
    assert.equal(nodes(tree, true).filter(node => node.type === 'CardSurface').length, 1);
    const illustrations = nodes(tree, true).filter(node => node.type === 'Illustration');
    assert(illustrations.length > 0);
    assert(illustrations.every(node => node.props.aspectRatio === 1 && node.props.rimColor === undefined));
  }
  for (const [width, height] of [[44, 66], [54, 79]]) {
    const tree = CardBack({ width, height, icon: 'help' });
    assert.equal(tree.props.width, width);
    assert.equal(tree.props.height, height);
    assert.equal(tree.props.children.type, 'Illustration');
    assert.equal(tree.props.children.props.aspectRatio, width / height);
    assert.equal(tree.props.children.props.rimColor, undefined);
  }
});

test('all concealed backs share one image and private role portraits retain the private reveal and dismiss action', () => {
  const h = harness();
  const { CardBack } = h.load('cards/CardBack');
  for (const icon of ['pickaxe', 'help']) {
    const cover = nodes(CardBack({ icon })).find(n => n.type === 'Illustration');
    assert.equal(path.basename(cover.props.source), 'saboteur-deck-back.webp');
  }
  const { RoleRevealOverlay } = h.load('overlays/RoleRevealOverlay');
  for (const role of ['miner', 'saboteur']) {
    let dismissed = 0;
    const tree = RoleRevealOverlay({ role, round: 2, onDismiss: () => dismissed++ });
    assert.equal(tree.props.id, 'saboteur-secret-role');
    assert.equal(tree.props.label, 'Your secret role');
    const cover = nodes(tree).find(n => n.type === 'GameCover');
    assert.equal(path.basename(cover.props.source), `saboteur-role-${role}.webp`);
    const portrait = nodes(tree).find(n => n.type === 'View');
    assert.equal(portrait.props.style.width, 76);
    assert.equal(portrait.props.style.height, 76);
    nodes(tree).find(n => n.type === 'NeonButton').props.onPress();
    assert.equal(dismissed, 1);
    assert(nodes(tree).some(n => n.type === 'Text' && n.props.children === role.toUpperCase()));
  }
  const rules = fs.readFileSync(path.resolve(__dirname, '../components/saboteur/RulesGuide.tsx'), 'utf8');
  assert.match(rules, /import \{ ActionCardView \} from '\.\/cards\/ActionCardView'/);
  assert.doesNotMatch(rules, /saboteur-role-|roleArtwork/);
});

test('hand selection remains owned by existing pressable and honours reduced motion', () => {
  const h = harness(320, true);
  const { HandCard } = h.load('cards/HandCard');
  const tree = HandCard({ nativeID: 'owned-card', selected: true, disabled: false, accessibilityLabel: 'Tunnel north west', onPress() {}, children: 'face' });
  h.effects.forEach(fn => fn());
  assert.equal(tree.props.nativeID, 'owned-card');
  assert.equal(tree.props.accessibilityState.selected, true);
  assert.equal(tree.props.accessibilityLabel, 'Tunnel north west');
  assert.equal(tree.props.style.minWidth, 84);
  assert.equal(tree.props.style.minHeight, 134);
  assert.equal(tree.props.style.alignSelf, 'stretch');
  assert.equal(tree.props.children.props.style[0].flexGrow, 1);
  assert.equal(Math.abs(tree.props.children.props.style[1].transform[0].translateY), 0);
  assert.equal(tree.props.children.props.style[1].transform[1].scale, 1);
  assert(tree.props.children.props.style[0].paddingBottom >= 3);
});

test('board keeps exactly five columns and nine rows at narrow and desktop widths', () => {
  for (const width of [320, 390, 1280]) {
    const { GameBoard } = harness(width).load('board/GameBoard');
    const picked = [];
    const tree = GameBoard({ board: [], goals: [], validTargets: new Set(['0,2']), actionTargets: new Set(), peekedGoals: [], round: 1, interactionActive: true, onCellPress: p => picked.push(p) });
    const cells = nodes(tree).filter(n => n.type?.name === 'BoardCell');
    assert.equal(cells.length, 45);
    assert.equal(new Set(cells.map(n => n.props.row)).size, 9);
    assert.equal(new Set(cells.map(n => n.props.col)).size, 5);
    assert(cells.every(n => n.props.width >= 48));
    assert.equal(tree.props.nativeID, 'saboteur-board');
    cells[0].props.onPress();
    assert.equal(picked[0].row, 0);
    assert.equal(picked[0].col, 2);
  }
});
