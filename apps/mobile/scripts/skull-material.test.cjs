const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const SKULL_KING = { bg: '#080B12', surface: '#101724', panel: '#172033', border: '#344152', text: '#F7FAFF', muted: '#B2BED0', teal: '#F7FAFF', cyan: '#A9D8FF', gold: '#F4C04E', coral: '#FF6577' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
function load(file, modules) {
  const filename = path.join(__dirname, '..', file), exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
function harness({ platform = 'web', fontScale = 1, width = 375, measuredScale = fontScale } = {}) {
  const measuredCalls = [];
  const textRef = { current: null };
  const onTextLayout = () => {};
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', StyleSheet: { absoluteFill: {} }, Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../constants/theme': { SKULL_KING, ARCADE: SKULL_KING },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    '../ui/GameCover': { GameCover: 'Cover' },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: (base, nativeScale) => {
      measuredCalls.push({ base, nativeScale });
      return { textScale: measuredScale, textRef, onTextLayout };
    } },
  };
  for (const kind of ['pirate', 'tigress', 'skull_king', 'mermaid', 'escape']) modules[`../../assets/game-art/skull-special-${kind}.webp`] = kind;
  modules['../ui/CardSurface'] = load('components/ui/CardSurface.tsx', modules);
  modules['./SkullKingCardArtwork'] = load('components/skull-king/SkullKingCardArtwork.tsx', modules);
  return { ...load('components/skull-king/SkullKingCard.tsx', modules), modules, measuredCalls, textRef, onTextLayout };
}

test('all five special faces use their own prominent original artwork and live names', () => {
  const { SkullKingCardView } = harness();
  for (const [kind, label] of [['pirate', 'Pirate'], ['tigress', 'Tigress'], ['skull_king', 'Skull King'], ['mermaid', 'Mermaid'], ['escape', 'Escape']]) {
    const tree = SkullKingCardView({ card: { id: 'owned-card', kind }, compact: true });
    assert.equal(tree.props.accessibilityLabel, label);
    assert.equal(tree.props.testID, 'skull-card-owned-card');
    assert.equal(nodes(tree).find(n => n.type === 'Cover').props.source, kind);
    assert.equal(nodes(tree).find(n => n.type === 'Cover').props.aspectRatio, 1);
    assert(text(tree).includes(label));
    assert(!text(tree).includes('owned-card'));
    assert(!nodes(tree).some(n => n.props.nativeID));
    assert(nodes(tree).filter(n => n.type === 'Text').every(n => n.props.numberOfLines === undefined && n.props.allowFontScaling !== false));
  }
});

test('numbered cards keep exact ranks and all four suit identities without raster art', () => {
  const { SkullKingCardView } = harness();
  for (const suit of ['green', 'purple', 'yellow', 'black']) for (const rank of [1, 14]) {
    const tree = SkullKingCardView({ card: { id: 'number', kind: 'number', suit, rank } });
    assert.equal(tree.props.accessibilityLabel, `${suit} ${rank}`);
    assert(text(tree).includes(String(rank))); assert(text(tree).includes(suit.toUpperCase()));
    assert(!nodes(tree).some(n => n.type === 'Cover'));
    assert(nodes(tree).some(n => n.type === 'Icon' && n.props.name === (suit === 'black' ? 'cards-spade' : 'water')));
  }
});

test('selected, disabled and Tigress mode retain exact action and accessible semantics', () => {
  const { SkullKingCardView } = harness();
  let actions = 0;
  for (const disabled of [true, false]) {
    const tree = SkullKingCardView({ card: { id: 'special', kind: 'tigress' }, selected: true, disabled, onPress() { actions++; } });
    assert.equal(tree.type, 'Button'); assert.equal(tree.props.accessibilityLabel, 'Play Tigress');
    assert.equal(tree.props.disabled, disabled); assert.equal(tree.props.accessibilityState.disabled, disabled);
    assert.equal(tree.props.accessibilityState.selected, true); assert(tree.props.style.minHeight >= 48);
    assert.equal(tree.props.accessibilityHint, disabled ? 'This card cannot be played now' : 'Plays this card into the current trick');
    assert.equal(nodes(tree).filter(n => n.type === 'Button').length, 1);
    assert(text(tree).includes('SELECTED')); assert(nodes(tree).some(n => n.props.name === 'check-circle'));
    if (!disabled) tree.props.onPress();
  }
  assert.equal(actions, 1);
  for (const mode of ['pirate', 'escape']) {
    const tree = SkullKingCardView({ card: { id: 'resolved', kind: 'tigress', tigressMode: mode }, compact: true });
    assert.equal(tree.props.accessibilityLabel, `Tigress as ${mode}`); assert(text(tree).includes(`AS ${mode.toUpperCase()}`));
    assert.equal(nodes(tree).find(n => n.type === 'Cover').props.source, 'tigress');
  }
});

test('card width and height grow without fixed column flex-basis, truncation or font suppression', () => {
  const web = harness(), native = harness({ platform: 'ios', fontScale: 2, width: 320 });
  assert.equal(web.skullKingCardWidth(true), 120); assert.equal(web.skullKingCardWidth(false), 148);
  for (const compact of [true, false]) {
    const tree = web.SkullKingCardView({ card: { id: 'card', kind: 'mermaid' }, compact });
    assert.equal(tree.props.style.minWidth, 0);
    assert.equal(tree.props.style.height, undefined); assert.equal(tree.props.style.flexBasis, undefined);
    const enlarged = native.SkullKingCardView({ card: { id: 'card', kind: 'mermaid' }, compact });
    assert.equal(enlarged.props.style.width, compact ? 240 : 256);
    assert.equal(enlarged.props.style.minWidth, 0);
    assert.equal(enlarged.props.style.maxWidth, 256);
    assert(nodes(enlarged).filter(n => n.type === 'Text').every(n => n.props.style.height === undefined));
  }
});

test('every kind measures its actual live heading and shares explicit enlarged widths', () => {
  const cards = [
    { id: 'n', kind: 'number', suit: 'black', rank: 14 },
    ...['pirate', 'tigress', 'skull_king', 'mermaid', 'escape'].map(kind => ({ id: kind, kind })),
  ];
  for (const width of [320, 375, 1280]) for (const compact of [true, false]) for (const measuredScale of [1, 2, 1]) {
    const h = harness({ width, measuredScale });
    let presses = 0;
    for (const card of cards) {
      const tree = h.SkullKingCardView({ card, compact, selected: true, onPress: () => presses++ });
      const expected = Math.min(width - 64, (compact ? 120 : 148) * measuredScale);
      const face = nodes(tree).find(n => n.props.testID === `skull-card-${card.id}`);
      for (const node of [tree, face]) {
        assert.equal(node.props.style.width, expected);
        assert.equal(node.props.style.minWidth, 0);
        assert.equal(node.props.style.maxWidth, width - 64);
        assert.equal(node.props.style.flexShrink, 0);
        assert.equal(node.props.style.height, undefined);
      }
      const anchors = nodes(tree).filter(n => n.props.ref === h.textRef);
      assert.equal(anchors.length, 1);
      assert.equal(anchors[0].type, 'Text');
      assert.equal(anchors[0].props.onLayout, h.onTextLayout);
      assert.equal(anchors[0].props.children, card.kind === 'number' ? card.rank : h.skullKingCardLabel(card));
      assert.deepEqual(h.measuredCalls.at(-1), { base: card.kind === 'number' ? 18 : 16, nativeScale: 1 });
      assert.equal(tree.props.accessibilityLabel, `Play ${h.skullKingCardLabel(card)}`);
      assert.equal(face.props.style.transform[0].translateY, -4);
      assert(nodes(tree).filter(n => n.type === 'Text').every(n => n.props.numberOfLines === undefined && n.props.allowFontScaling !== false && n.props.adjustsFontSizeToFit === undefined));
      tree.props.onPress();
    }
    assert.equal(presses, cards.length);
  }
});

test('invalid text scales keep normal constraints and natural face measurement survives', () => {
  for (const measuredScale of [NaN, Infinity, -1, 0]) {
    const h = harness({ measuredScale });
    assert.equal(h.skullKingCardWidth(false, measuredScale, 320), 148);
    assert.equal(h.skullKingCardWidth(true, measuredScale, 320), 120);
    const heights = [];
    const tree = h.SkullKingCardView({ card: { id: 's', kind: 'skull_king' }, faceSizing: { minimumHeight: 310, measurementKey: 'fresh', onMeasure: value => heights.push(value) } });
    assert.equal(tree.props.style.width, 148);
    assert.equal(tree.props.style.minHeight, 310);
    assert.equal(tree.props.style.height, undefined);
    const face = nodes(tree).find(n => n.key === 'fresh');
    assert.equal(face.props.style.minHeight, 198);
    assert.equal(face.props.style.height, undefined);
    face.props.onLayout({ nativeEvent: { layout: { height: 277 } } });
    assert.deepEqual(heights, [277]);
  }
});

test('shared artwork fallback ignores retired source errors and renders only current fallback', () => {
  const { modules } = harness(); let failed = null;
  const ref = { current: null };
  const { GameCover } = load('components/ui/GameCover.tsx', { ...modules, react: { useState: () => [failed, value => { failed = value; }], useRef: () => ref } });
  const first = GameCover({ source: 'pirate', fallback: 'pirate fallback' });
  const firstError = nodes(first).find(n => n.type === 'Image').props.onError;
  const current = GameCover({ source: 'mermaid', fallback: 'mermaid fallback' });
  firstError(); assert.equal(failed, null);
  nodes(current).find(n => n.type === 'Image').props.onError();
  assert.equal(failed, 'mermaid');
  const fallback = GameCover({ source: 'mermaid', fallback: 'mermaid fallback' });
  assert(text(fallback).includes('mermaid fallback')); assert(!nodes(fallback).some(n => n.type === 'Image'));
  assert.equal(fallback.props.accessibilityElementsHidden, true);
});

test('ledger preserves completed history, forfeit copy, negative scores and bounded navigation', () => {
  const { modules } = harness(); const state = [true, null]; let cursor = 0;
  const { SkullKingScorecard } = load('components/skull-king/Scorecard.tsx', { ...modules, react: { useState: () => { const index = cursor++; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } } });
  const history = [{ roundNumber: 1, cardsPerPlayer: 1, players: [{ playerId: 'a', displayName: 'A very long historical captain name', bid: 0, tricksWon: 1, baseScore: -10, bonus: 0, roundScore: -10, totalScore: -10, forfeited: true }] }, { roundNumber: 2, cardsPerPlayer: 2, players: [{ playerId: 'a', displayName: 'Captain', bid: 2, tricksWon: 2, baseScore: 40, bonus: 20, roundScore: 60, totalScore: 50, forfeited: false }] }];
  const original = JSON.stringify(history);
  const render = () => { cursor = 0; return SkullKingScorecard({ history }); };
  let tree = render();
  assert(text(tree).includes('Round 2')); assert(text(tree).includes('Base 40')); assert(text(tree).includes('Bonus 20'));
  let buttons = nodes(tree).filter(n => n.type === 'Button');
  assert.equal(buttons.find(n => n.props.accessibilityLabel === 'Next scored round').props.disabled, true);
  buttons.find(n => n.props.accessibilityLabel === 'Previous scored round').props.onPress();
  tree = render(); buttons = nodes(tree).filter(n => n.type === 'Button');
  assert(text(tree).includes('Round 1')); assert(text(tree).includes('Round -10')); assert(text(tree).includes('FORFEITED'));
  assert(nodes(tree).some(n => n.props.accessibilityLabel?.includes('Forfeited; historical score only.')));
  assert.equal(buttons.find(n => n.props.accessibilityLabel === 'Previous scored round').props.disabled, true);
  assert(buttons.every(n => n.props.style.minHeight >= 48));
  assert(nodes(tree).filter(n => n.type === 'Text').every(n => n.props.numberOfLines === undefined));
  assert.equal(JSON.stringify(history), original);
});
