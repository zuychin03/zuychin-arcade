const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const categories = ['attack', 'defense', 'dice', 'energy', 'healing', 'market', 'victory', 'wild'];
const TOKYO = { bg: '#07130F', surface: '#10251D', panel: '#173328', border: '#365544', text: '#F4FFF8', muted: '#A7BDB2', lime: '#8BFF52', cyan: '#2EE6FF', energy: '#F4C04E', danger: '#FF6577' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
function load(file, modules) {
  const filename = path.join(__dirname, '..', file), exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
function harness() {
  const definitions = load('../../packages/types/src/king-of-tokyo-cards.ts', {});
  const modules = {
    react: { useRef: value => ({ current: value }), useState: value => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 375, fontScale: 1 }), StyleSheet: { absoluteFill: {} } },
    'react-native-svg': { default: 'Svg', Svg: 'Svg', Circle: 'Circle', Defs: 'Defs', LinearGradient: 'SvgGradient', Line: 'Line', Path: 'Path', Rect: 'Rect', Stop: 'Stop' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': definitions,
    '../../constants/theme': { TOKYO, ARCADE: TOKYO },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    './MonsterAvatar': { MonsterAvatar: 'MonsterAvatar' },
    '../../assets/game-art/tokyo-arena-backdrop.webp': 'arena.webp',
  };
  modules['../ui/CardSurface'] = load('components/ui/CardSurface.tsx', modules);
  modules['./TokyoPowerArtwork'] = load('components/king-of-tokyo/TokyoPowerArtwork.tsx', {
    ...modules, '../ui/CardIllustration': { CardIllustration: 'CardIllustration' },
    ...Object.fromEntries(categories.map(category => [`../../assets/game-art/tokyo-power-${category}.webp`, category + '.webp'])),
    ...Object.fromEntries(definitions.KING_OF_TOKYO_POWER_CARDS.map(card => [`../../assets/game-art/tokyo-power-${card.id}.webp`, card.id + '.webp'])),
  });
  return { modules, definitions, ...modules['./TokyoPowerArtwork'],
    ...load('components/king-of-tokyo/TokyoDie.tsx', modules),
    ...load('components/king-of-tokyo/PowerCard.tsx', modules),
    ...load('components/king-of-tokyo/TokyoArena.tsx', modules),
    ...load('components/king-of-tokyo/TokyoArtwork.tsx', modules),
  };
}

test('every power definition retains exact live text and selects its named artwork', () => {
  const { PowerCard, definitions } = harness();
  for (const definition of definitions.KING_OF_TOKYO_POWER_CARDS) {
    const tree = PowerCard({ card: { cardId: definition.id, instanceId: 'owned-instance', counters: 2 }, compact: true });
    assert.equal(nodes(tree).find(node => node.type === 'CardIllustration').props.source, definition.id + '.webp');
    for (const copy of [definition.name, definition.effect, definition.kind.toUpperCase(), definition.category.toUpperCase(), '2 COUNTERS']) assert(text(tree).includes(copy), copy);
    const prose = nodes(tree).find(node => node.type === 'Text' && node.props.children === definition.effect);
    assert.equal(prose.props.style.fontFamily, 'Outfit_400Regular');
    assert.equal(prose.props.style.fontSize, 14);
    assert.equal(prose.props.numberOfLines, undefined);
    assert.equal(tree.props.style.maxWidth, '100%');
    assert.equal(tree.props.style.flexShrink, 1);
    assert.equal(tree.props.style.height, undefined);
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 0);
    assert.equal(tree.props.testID, 'tokyo-power-card-owned-instance');
    assert(nodes(tree).some(node => node.props.testID === 'tokyo-power-art-owned-instance'));
    assert(!nodes(tree).some(node => node.props.testID === 'tokyo-power-selection-owned-instance'));
    assert(!text(tree).includes('owned-instance'));
    assert(!nodes(tree).some(node => [node.props.accessibilityLabel, node.props.accessibilityHint].some(value => String(value ?? '').includes('owned-instance'))));
    assert(!nodes(tree).some(node => node.props.nativeID));
  }
});

test('standalone power offers size from complete content, not the row-grid basis', () => {
  const { PowerCard } = harness();
  for (const compact of [false, true]) {
    const card = { cardId: 'mimic', instanceId: 'standalone-offer', counters: 1 };
    const tree = PowerCard({ card, compact, standalone: true, actionLabel: 'BUY PRIVATE TOP CARD', onAction() {} });
    assert.equal(tree.props.style.width, '100%');
    assert.equal(tree.props.style.flexBasis, 'auto');
    assert.equal(tree.props.style.flexGrow, 0);
    assert.equal(tree.props.style.flexShrink, 0);
    assert.equal(tree.props.style.height, undefined);
    assert.equal(tree.props.style.maxHeight, undefined);
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 1);
    const grid = PowerCard({ card, compact });
    assert.equal(grid.props.style.flexBasis, compact ? 180 : 240);
    assert.equal(grid.props.style.flexGrow, 1);
  }
  const source = ts.createSourceFile('game.tsx', fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offers = new Map();
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'PowerCard') {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const card = attrs.find(attr => attr.name.getText(source) === 'card')?.initializer?.expression?.getText(source);
      if (card === 'game.labCard' || card === 'opportunistCard') offers.set(card, attrs.some(attr => attr.name.getText(source) === 'standalone' && !attr.initializer));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual([...offers], [['game.labCard', true], ['opportunistCard', true]]);
});

test('power actions preserve selected custom instructions, counters, disabled state and one 48px target', () => {
  const { PowerCard } = harness();
  let calls = 0;
  for (const disabled of [false, true]) {
    const tree = PowerCard({ card: { cardId: 'mimic', instanceId: 'mimic:1', counters: 1 }, selected: true, actionDisabled: disabled,
      selectedAccessibilityLabel: 'Mimic selected. Choose a Keep card.', selectedInstruction: 'CHOOSE A KEEP CARD',
      selectedActionLabel: 'CANCEL MIMIC SELECTION', selectedActionHint: 'Cancel without changing the copied card',
      actionLabel: 'ACTIVATE MIMIC', onAction() { calls++; } });
    const buttons = nodes(tree).filter(node => node.type === 'Button');
    assert.equal(tree.props.testID, 'tokyo-power-card-mimic:1');
    assert(nodes(tree).some(node => node.props.testID === 'tokyo-power-art-mimic:1'));
    assert(nodes(tree).some(node => node.props.testID === 'tokyo-power-selection-mimic:1'));
    assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.props.style.minHeight, 48);
    assert.equal(button.props.disabled, disabled);
    assert.equal(button.props.accessibilityState.selected, true);
    assert.equal(button.props.accessibilityLabel, 'CANCEL MIMIC SELECTION: Mimic');
    assert.equal(button.props.accessibilityHint, 'Cancel without changing the copied card');
    assert.match(text(tree), /CHOOSE A KEEP CARD/);
    assert.doesNotMatch(text(tree), /CHOOSE A DIE/);
    if (!disabled) button.props.onPress();
  }
  assert.equal(calls, 1);
});

test('market and owned power faces fill their row while standalone offers retain intrinsic height', () => {
  const { PowerCard, definitions } = harness();
  for (const definition of definitions.KING_OF_TOKYO_POWER_CARDS) for (const compact of [false, true]) for (const standalone of [false, true]) for (const selected of [false, true]) {
    let calls = 0;
    const onAction = () => { calls++; }, disabled = selected;
    const tree = PowerCard({ card: { cardId: definition.id, instanceId: 'row-card', counters: selected ? 2 : 0 }, compact, standalone, selected, actionLabel: 'ACTIVATE', actionDisabled: disabled, onAction });
    const surface = tree.props.children, face = surface.props.children[1];
    assert.equal(surface.props.style.flexGrow, standalone ? undefined : 1);
    assert.equal(face.props.style.flexGrow, 1);
    assert.equal(tree.props.style.flexGrow, standalone ? 0 : 1);
    assert.equal(tree.props.style.flexBasis, standalone ? 'auto' : compact ? 180 : 240);
    assert.equal(tree.props.style.width, standalone ? '100%' : undefined);
    for (const node of [tree, surface, face]) {
      assert.equal(node.props.style.height, undefined); assert.equal(node.props.style.maxHeight, undefined);
    }
    assert(text(tree).includes(definition.name)); assert(text(tree).includes(definition.effect));
    assert(nodes(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined));
    const controls = nodes(tree).filter(node => node.type === 'Button'); assert.equal(controls.length, 1);
    assert.equal(controls[0].props.onPress, onAction); assert.equal(controls[0].props.disabled, disabled);
    assert.equal(controls[0].props.accessibilityState.selected, selected);
    assert.equal(calls, 0); if (!disabled) { controls[0].props.onPress(); assert.equal(calls, 1); }
  }
});

test('category-art failure uses the existing source fence and recovers on category replacement', () => {
  const { modules, TokyoPowerArtwork } = harness();
  let failed = null;
  const ref = { current: null };
  const { CardIllustration } = load('components/ui/CardIllustration.tsx', { ...modules, react: { useRef: () => ref, useState: () => [failed, value => { failed = value; }] } });
  const first = TokyoPowerArtwork({ category: 'attack', icon: 'fire', color: TOKYO.danger }).props;
  const next = TokyoPowerArtwork({ category: 'defense', icon: 'shield-star-outline', color: TOKYO.cyan }).props;
  const staleError = nodes(CardIllustration(first)).find(node => node.type === 'Image').props.onError;
  CardIllustration(next); staleError(); assert.equal(failed, null);
  nodes(CardIllustration(next)).find(node => node.type === 'Image').props.onError();
  assert(!nodes(CardIllustration(next)).some(node => node.type === 'Image'));
  assert(nodes(CardIllustration(next)).some(node => node.type === 'Icon' && node.props.name === 'shield-star-outline'));
  assert(nodes(CardIllustration(first)).some(node => node.type === 'Image'));
});

test('dice preserve exact faces, indices and four distinct states without fixed-height text or disabled scaling', () => {
  const { TokyoDie, modules } = harness();
  let calls = 0;
  const paths = [];
  for (const face of [null, 1, 2, 3, 'heart', 'energy', 'smash']) {
    for (const selectionState of [undefined, 'kept', 'targeted', 'changed', 'armed']) {
      const tree = TokyoDie({ face, index: 3, selectionState, interactive: true, size: 72, accessibilityHint: 'Choose this exact die', onPress() { calls++; } });
      assert.equal(tree.type, 'Button');
      assert.equal(tree.props.accessibilityHint, 'Choose this exact die');
      assert.match(tree.props.accessibilityLabel, new RegExp(`^Die 4: ${face === null ? 'not rolled' : face === 'heart' ? 'heal' : face}`));
      assert.equal(tree.props.accessibilityState.selected, Boolean(selectionState));
      assert.equal(tree.props.style.height, undefined);
      assert.equal(tree.props.style.width, 80);
      assert.equal(tree.props.style.minWidth, 0);
      assert.equal(tree.props.style.minHeight, 80);
      const surface = tree.props.children;
      assert.equal(surface.props.style.flexGrow, 1);
      assert.equal(surface.props.children[1].props.style.flexGrow, 1);
      assert.equal(nodes(tree).find(node => node.type === 'Gradient').props.style.flexGrow, 1);
      if (selectionState) assert(text(tree).includes(selectionState.toUpperCase()));
      for (const node of nodes(tree)) {
        assert.notEqual(node.props.allowFontScaling, false);
        if (node.type === 'Text') { assert.equal(node.props.style.height, undefined); assert.equal(node.props.numberOfLines, undefined); }
      }
      if (typeof face === 'number' && !selectionState) paths.push(nodes(tree).find(node => node.type === 'Path').props.d);
      tree.props.onPress();
    }
  }
  assert.equal(new Set(paths).size, 3);
  assert.equal(calls, 35);
  const passive = TokyoDie({ face: 2, index: 0, interactive: false, size: 60, onPress() { throw new Error('passive die'); } });
  assert.equal(passive.type, 'View');
  assert.equal(passive.props.accessibilityRole, 'text');
  assert.equal(nodes(passive).filter(node => node.type === 'Button').length, 0);
  const native = load('components/king-of-tokyo/TokyoDie.tsx', { ...modules, 'react-native': { ...modules['react-native'], Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 320, fontScale: 2 }) } }).TokyoDie;
  assert.equal(native({ face: 'energy', index: 0, selectionState: 'targeted', interactive: false, size: 72, onPress() {} }).props.style.width, 160);
});

test('all die faces and selection states share text-aware widths without changing actions or glyph sizing', () => {
  const { TokyoDie } = harness();
  for (const scale of [1, 1.5, 2, 3, NaN, Infinity, -2]) {
    const expected = Math.min(Math.max(90, 80 * (Number.isFinite(scale) ? Math.max(1, scale) : 1)), 327);
    for (const face of [null, 1, 2, 3, 'heart', 'energy', 'smash']) for (const selectionState of [undefined, 'kept', 'targeted', 'changed', 'armed']) for (const interactive of [false, true]) {
      let presses = 0;
      const tree = TokyoDie({ face, index: 2, selectionState, interactive, size: 90, textScale: scale, onPress() { presses++; } });
      assert.equal(tree.props.style.width, expected);
      assert.equal(tree.props.style.minHeight, expected);
      assert.equal(tree.props.style.maxWidth, '100%');
      assert.equal(tree.props.style.minWidth, 0);
      assert.equal(nodes(tree).find(node => node.type === 'Gradient').props.style.minHeight, expected);
      for (const node of nodes(tree).filter(node => node.type === 'Text')) {
        assert.equal(node.props.style.fontSize, 11);
        assert.notEqual(node.props.allowFontScaling, false);
      }
      if (interactive) { tree.props.onPress(); assert.equal(presses, 1); } else assert.equal(tree.props.onPress, undefined);
    }
  }
  const props = { face: 'energy', index: 0, interactive: false, size: 90, onPress() {} };
  assert.equal(TokyoDie({ ...props, textScale: 2 }).props.style.width, 160);
  assert.equal(TokyoDie({ ...props, textScale: 1 }).props.style.width, 90);
});

test('arena uses authoritative zones/capacity, stable profile indices and flexible live names', () => {
  const { TokyoArena } = harness();
  const players = [
    { playerId: 'outside', displayName: 'Outside', tokyoZone: null },
    { playerId: 'bay', displayName: 'An unusually long Bay monster name', tokyoZone: 'tokyo_bay' },
    { playerId: 'city', displayName: 'An unusually long City monster name', tokyoZone: 'tokyo_city' },
  ];
  const open = TokyoArena({ players, currentPlayerId: 'city', capacity: 2, compact: true });
  assert.deepEqual(nodes(open).filter(node => node.type === 'MonsterAvatar').map(node => [node.props.seed, node.props.profileIndex]), [['city', 2], ['bay', 1]]);
  assert.match(text(open), /CURRENT TURN/);
  assert.equal(open.props.style[0].height, undefined);
  for (const player of players.slice(1)) {
    const name = nodes(open).find(node => node.type === 'Text' && node.props.children === player.displayName);
    assert(name); assert.equal(name.props.numberOfLines, undefined);
  }
  const closed = TokyoArena({ players, currentPlayerId: null, capacity: 1 });
  assert.match(text(closed), /BAY CLOSED/);
  assert.equal(nodes(closed).filter(node => node.type === 'MonsterAvatar').length, 1);
  assert.doesNotMatch(text(closed), /An unusually long Bay/);
  const empty = TokyoArena({ players: [], currentPlayerId: null, capacity: 2 });
  assert.equal(text(empty).match(/Empty/g).length, 2);
  assert.equal(nodes(empty).filter(node => node.type === 'Button').length, 0);
});

test('resource pieces retain exact values and full resource labels with wrapping', () => {
  const { ResourceBadge } = harness();
  for (const [kind, label] of [['health', 'health'], ['victory', 'victory points'], ['energy', 'energy']]) {
    const tree = ResourceBadge({ kind, value: 123, compact: true });
    assert.equal(tree.props.accessibilityLabel, `123 ${label}`);
    assert.equal(tree.props.accessible, true);
    assert.equal(tree.props.style.flexWrap, 'wrap');
    assert.equal(text(tree), '123');
    assert.equal(nodes(tree).find(node => node.type === 'Text').props.numberOfLines, undefined);
  }
});
