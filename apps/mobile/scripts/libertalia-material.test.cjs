const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const definitions = require('../../../packages/types/src/libertalia-constants.ts');

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
const palette = load('constants/theme.ts', { 'react-native': { Platform: { OS: 'web' } } }).LIBERTALIA;
const common = { 'react/jsx-runtime': { jsx, jsxs: jsx }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../../constants/theme': { LIBERTALIA: palette } };
const decision = load('components/libertalia/decision.ts', { '@zuychin-arcade/types': definitions });
function cardModule(platform = 'web', fontScale = 1, width = 375) {
  const state = []; let cursor = 0;
  const module = load('components/libertalia/CrewCard.tsx', {
    ...common, '@zuychin-arcade/types': definitions,
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } },
    'react-native': { View: 'View', Text: 'Text', Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }) },
    '../ui/ScalePressable': { ScalePressable: 'Pressable' }, '../ui/CardSurface': { CardSurface: 'CardSurface' },
    './LibertaliaArtwork': { LibertaliaPhaseArtwork: 'PhaseArtwork' },
  });
  return { CrewCard(props) { cursor = 0; return module.CrewCard(props); } };
}
function lootModule(fontScale = 1) {
  return load('components/libertalia/Loot.tsx', {
    ...common, 'react-native': { View: 'View', Text: 'Text', useWindowDimensions: () => ({ fontScale }) },
    '../ui/CardSurface': { CardSurface: 'CardSurface' }, '../ui/CardGrid': { CardGrid: 'CardGrid' }, './LibertaliaArtwork': { LibertaliaLootArtwork: 'LootArtwork' }, './decision': decision,
  });
}
const lootKinds = ['map', 'barrel', 'amulet', 'chest', 'hook', 'saber', 'relic'];
const phases = ['daytime', 'dusk', 'night', 'anchor'];
const texts = tree => nodes(tree).filter(node => node.type === 'Text');

test('all forty crew retain exact live rank, name, full rule and every printed phase', () => {
  const { CrewCard } = cardModule();
  assert.equal(definitions.LIBERTALIA_CREW.length, 40);
  for (const crew of definitions.LIBERTALIA_CREW) {
    const tree = CrewCard({ rank: crew.rank, nativeID: `private-${crew.rank}` });
    const all = nodes(tree), copy = texts(tree);
    assert.equal(tree.props.testID, `libertalia-crew-card-${crew.rank}`);
    assert.equal(tree.props.nativeID, `private-${crew.rank}`);
    assert(copy.some(node => Array.isArray(node.props.children) && node.props.children.join('') === `#${crew.rank}`));
    assert(copy.some(node => node.props.children === crew.name));
    assert(copy.some(node => node.props.children === crew.summary));
    for (const phase of crew.phases) assert(copy.some(node => node.props.children === phase.toUpperCase()));
    assert.equal(all.find(node => node.type === 'PhaseArtwork').props.phase, crew.phases[0]);
    assert.equal(all.filter(node => node.type === 'CardSurface').length, 1);
    assert.equal(all.filter(node => node.type === 'Pressable').length, 0);
    assert(all.some(node => node.props.accessibilityLabel === `${crew.name}, rank ${crew.rank}. Timing: ${crew.phases.join(', ')}. ${crew.summary}`));
    assert(!all.some(node => node.props.numberOfLines !== undefined || node.props.style?.height !== undefined));
  }
  for (const rank of [0, -1, 41, 1.5, NaN]) assert.equal(CrewCard({ rank }), null);
});

test('candidate and submitted cards keep distinct live confirmation copy and one exact action', () => {
  const crew = definitions.LIBERTALIA_CREW[10];
  for (const selection of [undefined, 'candidate', 'submitted']) for (const disabled of [false, true]) {
    let calls = 0;
    const tree = cardModule().CrewCard({ rank: 11, selection, disabled, onPress: () => calls++ });
    const all = nodes(tree), buttons = all.filter(node => node.type === 'Pressable');
    assert.equal(buttons.length, 1);
    const button = buttons[0], suffix = selection === 'candidate' ? ' Proposed choice, not submitted.' : selection === 'submitted' ? ' Current secret choice.' : '';
    assert.equal(button.props.accessibilityLabel, `Choose ${crew.name}, rank 11. Timing: daytime, anchor. ${crew.summary}${suffix}`);
    assert.equal(button.props.accessibilityHint, 'Selects this crew locally, without sending it yet');
    assert.equal(button.props.disabled, disabled);
    assert.equal(button.props.accessibilityState.disabled, disabled);
    assert.equal(button.props.accessibilityState.selected, Boolean(selection));
    assert.equal(button.props.style.minHeight, 48);
    const footer = selection === 'candidate' ? 'PROPOSED · CONFIRM TO SUBMIT' : selection === 'submitted' ? 'CURRENT SECRET CHOICE' : disabled ? 'NOT SELECTABLE NOW' : 'CHOOSE THIS CREW';
    assert(texts(tree).some(node => node.props.children === footer));
    const surface = all.find(node => node.type === 'CardSurface');
    assert.equal(surface.props.selected, Boolean(selection));
    assert.equal(surface.props.disabled, undefined);
    assert(!all.some(node => node.props.style?.opacity !== undefined));
    assert.equal(calls, 0);
    if (!disabled) { button.props.onPress(); assert.equal(calls, 1); }
  }
});

test('fluid cards forward focus without selecting and native dimensions remain phone bounded at enlarged text', () => {
  let focused = 0, selected = 0;
  const props = { rank: 40, fluid: true, onFocus: () => focused++, onPress: () => selected++ };
  const tree = cardModule().CrewCard(props);
  assert.equal(tree.props.style.width, '100%');
  assert.equal(tree.props.style.minWidth, 0);
  assert.equal(tree.props.style.flexBasis, undefined);
  nodes(tree).find(node => node.type === 'Pressable').props.onFocus();
  assert.equal(focused, 1); assert.equal(selected, 0);
  assert.equal(nodes(cardModule().CrewCard({ ...props, disabled: true })).find(node => node.type === 'Pressable').props.onFocus, undefined);
  for (const platform of ['ios', 'android']) for (const width of [320, 375, 1280]) for (const fontScale of [1, 1.5, 2, NaN]) {
    const style = cardModule(platform, fontScale, width).CrewCard({ rank: 40 }).props.style;
    assert(Number.isFinite(style.flexBasis));
    assert(style.maxWidth <= width - 56);
    assert(style.minWidth <= style.maxWidth);
    assert.equal(style.paddingBottom, 4);
  }
  assert.equal(cardModule().CrewCard({ rank: 1 }).props.style.minWidth, 'min-content');
});

test('crew faces carry row stretch through static and actionable wrappers without fixing content height', () => {
  const { CardSurface } = load('components/ui/CardSurface.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { absoluteFill: {}, create: value => value } },
  });
  const style = node => Object.assign({}, ...[node.props.style].flat(Infinity));
  for (const platform of ['web', 'ios', 'android']) for (const width of [320, 375, 1280]) for (const fontScale of [1, 2]) {
    for (const rank of [11, 18, 19, 35]) for (const fluid of [false, true]) for (const state of [{}, { onPress() {} }, { selection: 'candidate', onPress() {} }, { selection: 'submitted', disabled: true, onPress() {} }]) {
      const tree = cardModule(platform, fontScale, width).CrewCard({ rank, fluid, ...state });
      const wrapper = tree.props.children, surface = nodes(tree).find(node => node.type === 'CardSurface');
      assert.equal(style(tree).alignSelf, 'stretch'); assert.equal(style(tree).flexGrow, 1);
      assert.equal(style(wrapper).flexGrow, 1); assert.equal(surface.props.fill, true);
      const material = CardSurface(surface.props);
      assert.equal(style(material).flexGrow, 1);
      const face = material.props.children[1]; assert.equal(style(face).flexGrow, 1);
      assert.equal(wrapper.type, state.onPress ? 'Pressable' : 'View');
      if (state.onPress) assert.equal(wrapper.props.onPress, state.onPress);
      else assert.equal(wrapper.props.accessible, true);
      for (const node of [...nodes(tree), ...nodes(material)]) {
        assert.equal(style(node).height, undefined); assert.equal(style(node).maxHeight, undefined);
        assert.equal(node.props.numberOfLines, undefined);
        assert.equal(node.props.adjustsFontSizeToFit, undefined);
      }
      const crew = definitions.LIBERTALIA_CREW[rank - 1];
      assert(texts(tree).some(node => node.props.children === crew.summary));
      for (const phase of crew.phases) assert(texts(tree).some(node => node.props.children === phase.toUpperCase()));
    }
  }
});

test('measured narrow and enlarged crew headers give complete names their own full-width line', () => {
  for (const platform of ['web', 'ios', 'android']) for (const width of [320, 375]) for (const selection of [undefined, 'candidate', 'submitted']) for (const rank of [19, 20, 22, 35]) {
    const { CrewCard } = cardModule(platform, platform === 'web' ? 1 : 2, width);
    let pressed = 0, focused = 0;
    const props = { rank, selection, fluid: true, onPress: () => pressed++, onFocus: () => focused++ };
    let tree = CrewCard(props);
    const header = () => nodes(tree).find(node => node.props.testID === 'libertalia-crew-header');
    header().props.onLayout({ nativeEvent: { layout: { width: width - 80 } } });
    tree = CrewCard(props);
    if (platform !== 'web') assert.equal(header().props.style.flexDirection, 'column', 'Native fontScale works before a rank measurement');
    const rankText = texts(tree).find(node => Array.isArray(node.props.children) && node.props.children.join('') === '#' + rank);
    rankText.props.onLayout({ nativeEvent: { layout: { height: 50 } } });
    tree = CrewCard(props);
    assert.equal(header().props.style.flexDirection, 'column');
    const metadata = nodes(tree).find(node => node.props.testID === 'libertalia-crew-metadata');
    assert.equal(metadata.props.style.width, '100%');
    const name = texts(tree).find(node => node.props.children === definitions.LIBERTALIA_CREW[rank - 1].name);
    assert.equal(name.props.style.width, '100%'); assert.equal(name.props.style.flex, undefined);
    assert.equal(name.props.style.fontSize, 20); assert.equal(name.props.style.lineHeight, 26);
    assert.equal(name.props.numberOfLines, undefined); assert.equal(name.props.adjustsFontSizeToFit, undefined);
    assert(!nodes(metadata).includes(name)); assert.equal(header().props.children[1], name);
    assert.equal(nodes(metadata).filter(node => node.type === 'Icon').length, selection ? 1 : 0);
    if (selection) assert.equal(nodes(metadata).find(node => node.type === 'Icon').props.name, selection === 'submitted' ? 'check-circle' : 'circle-outline');
    assert(texts(tree).some(node => node.props.children === definitions.LIBERTALIA_CREW[rank - 1].summary));
    const button = nodes(tree).find(node => node.type === 'Pressable');
    assert(button.props.accessibilityLabel.startsWith(`Choose ${definitions.LIBERTALIA_CREW[rank - 1].name}, rank ${rank}.`));
    assert.equal(pressed, 0); assert.equal(focused, 0); button.props.onFocus(); assert.equal(focused, 1); assert.equal(pressed, 0); button.props.onPress(); assert.equal(pressed, 1);
  }
});

test('ordinary wide crew headers stay compact and web measurement restores without changing node structure', () => {
  const { CrewCard } = cardModule('web', 1, 1280), props = { rank: 35, selection: 'candidate', onPress() {} };
  let tree = CrewCard(props);
  const header = () => nodes(tree).find(node => node.props.testID === 'libertalia-crew-header');
  const rank = () => texts(tree).find(node => Array.isArray(node.props.children) && node.props.children.join('') === '#35');
  header().props.onLayout({ nativeEvent: { layout: { width: 296 } } }); tree = CrewCard(props);
  assert.equal(header().props.style.flexDirection, 'row');
  const shape = node => ({ type: node.type, children: [node.props?.children].flat(Infinity).filter(child => child && typeof child === 'object').map(shape) });
  const compactShape = JSON.stringify(shape(header()));
  rank().props.onLayout({ nativeEvent: { layout: { height: 50 } } }); tree = CrewCard(props);
  assert.equal(header().props.style.flexDirection, 'column'); assert.equal(JSON.stringify(shape(header())), compactShape);
  rank().props.onLayout({ nativeEvent: { layout: { height: 25 } } }); tree = CrewCard(props);
  assert.equal(header().props.style.flexDirection, 'row'); assert.equal(JSON.stringify(shape(header())), compactShape);
  header().props.onLayout({ nativeEvent: { layout: { width: 200 } } }); tree = CrewCard(props);
  assert.equal(header().props.style.flexDirection, 'column');
  header().props.onLayout({ nativeEvent: { layout: { width: NaN } } }); rank().props.onLayout({ nativeEvent: { layout: { height: Infinity } } }); tree = CrewCard(props);
  assert.equal(header().props.style.flexDirection, 'column');
});

test('all seven physical loot faces preserve exact token identity and complete calm-side effects', () => {
  const { LibertaliaLoot } = lootModule();
  for (const kind of lootKinds) for (const id of [`first-${kind}`, `second-${kind}`]) {
    const tree = LibertaliaLoot({ token: { id, kind } });
    assert.equal(tree.props.testID, `libertalia-loot-token-${id}`);
    assert.equal(tree.props.accessible, true);
    assert.equal(tree.props.accessibilityLabel, `${kind}. ${decision.LIBERTALIA_LOOT_HELP[kind]}`);
    assert(texts(tree).some(node => node.props.children === kind.toUpperCase()));
    assert(texts(tree).some(node => node.props.children === decision.LIBERTALIA_LOOT_HELP[kind]));
    const art = nodes(tree).find(node => node.type === 'LootArtwork');
    assert.equal(art.props.kind, kind); assert.equal(art.props.size, 72);
    assert.equal(nodes(tree).filter(node => node.type === 'CardSurface').length, 1);
    assert(!nodes(tree).some(node => node.type === 'Pressable' || node.props.numberOfLines !== undefined));
  }
  assert.equal(decision.LIBERTALIA_LOOT_HELP.relic, 'Lose 3 doubloons at anchor.');
  const relic = LibertaliaLoot({ token: { id: 'r', kind: 'relic' } });
  assert.equal(texts(relic).find(node => node.props.children === 'RELIC').props.style.color, palette.violet);
});

test('compact loot retains accessible effects and decorative duplicates never add reading or interaction targets', () => {
  for (const kind of lootKinds) for (const compact of [true, false]) for (const decorative of [true, false]) {
    const tree = lootModule(2).LibertaliaLoot({ token: { id: kind, kind }, compact, decorative });
    assert.equal(tree.props.accessible, !decorative);
    assert.equal(tree.props.accessibilityElementsHidden, decorative);
    assert.equal(tree.props.importantForAccessibility, decorative ? 'no-hide-descendants' : 'auto');
    assert.equal(tree.props.pointerEvents, decorative ? 'none' : undefined);
    assert.equal(tree.props.accessibilityLabel, decorative ? undefined : `${kind}. ${decision.LIBERTALIA_LOOT_HELP[kind]}`);
    assert.equal(texts(tree).some(node => node.props.children === decision.LIBERTALIA_LOOT_HELP[kind]), !compact);
    assert.equal(nodes(tree).find(node => node.type === 'LootArtwork').props.size, compact ? 44 : 72);
    assert.equal(tree.props.style.flexBasis, (compact ? 120 : 260) * 2);
    assert.equal(tree.props.style.maxWidth, '100%'); assert.equal(tree.props.style.minWidth, 0);
  }
  assert.equal(lootModule(NaN).LibertaliaLoot({ token: { id: 'map', kind: 'map' } }).props.style.flexBasis, 260);
});

test('loot faces stretch with their row without fixed heights or hidden rule text', () => {
  const { CardSurface } = load('components/ui/CardSurface.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { absoluteFill: {}, create: value => value } },
  });
  const style = node => Object.assign({}, ...[node.props.style].flat(Infinity));
  for (const kind of lootKinds) for (const compact of [false, true]) for (const fluid of [false, true]) for (const fontScale of [1, 2, NaN]) {
    const tree = lootModule(fontScale).LibertaliaLoot({ token: { id: kind, kind }, compact, fluid });
    assert.equal(style(tree).alignSelf, 'stretch'); assert.equal(style(tree).flexGrow, 1);
    assert.equal(style(tree).width, fluid ? '100%' : undefined);
    if (fluid) assert.equal(style(tree).flexBasis, undefined);
    const surface = nodes(tree).find(node => node.type === 'CardSurface');
    assert.equal(surface.props.fill, true);
    const material = CardSurface(surface.props);
    assert.equal(style(material).flexGrow, 1); assert.equal(style(material.props.children[1]).flexGrow, 1);
    for (const node of [...nodes(tree), ...nodes(material)]) {
      assert.equal(style(node).height, undefined); assert.equal(style(node).maxHeight, undefined);
      assert.equal(node.props.numberOfLines, undefined); assert.equal(node.props.adjustsFontSizeToFit, undefined);
    }
    assert.equal(texts(tree).some(node => node.props.children === decision.LIBERTALIA_LOOT_HELP[kind]), !compact);
  }
});

test('loot collections keep count-independent tracks and combine text scaling only once', () => {
  const { cardGridMetrics } = load('components/ui/CardGrid.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View' },
    '../../hooks/useMeasuredLayoutWidth': { useMeasuredLayoutWidth() { throw Error('Metrics test must not mount the grid'); } },
  });
  for (const compact of [false, true]) for (const nativeScale of [1, 2, NaN]) for (const textScale of [1, 2, NaN]) {
    const widths = new Map();
    for (const count of [0, 1, 2, 3, 6, 7]) {
      const tokens = lootKinds.slice(0, count).map((kind, id) => ({ kind, id }));
      const tree = lootModule(nativeScale).LibertaliaLootCollection({ tokens, compact, textScale, testID: 'loot-test' });
      assert.equal(tree.type, 'CardGrid'); assert.equal(tree.props.items, tokens);
      assert.equal(tree.props.testID, 'loot-test'); assert.equal(tree.props.gap, 8);
      assert.equal(tree.props.minCardWidth, compact ? 120 : 260); assert.equal(tree.props.maxCardWidth, compact ? 180 : 420);
      assert.equal(tree.props.textScale, Math.max(1, Number.isFinite(nativeScale) ? nativeScale : 1, Number.isFinite(textScale) ? textScale : 1));
      for (const width of [264, 319, 358, 712, 632.875, 1224]) {
        const metrics = cardGridMetrics(width, tree.props.minCardWidth, tree.props.maxCardWidth, tree.props.gap, tree.props.textScale);
        if (widths.has(width)) assert.equal(metrics.columnWidth, widths.get(width));
        else widths.set(width, metrics.columnWidth);
        assert(metrics.columnWidth <= width);
      }
      for (const token of tokens) {
        assert.equal(tree.props.keyExtractor(token), String(token.id));
        const card = tree.props.renderItem(token);
        assert.equal(card.props.token, token); assert.equal(card.props.compact, compact); assert.equal(card.props.fluid, true);
      }
    }
  }
});

test('original loot and phase artworks have exact static mappings and noninteractive matching fallback symbols', () => {
  const lootIcons = ['map-outline', 'barrel', 'necklace', 'treasure-chest', 'hook', 'sword', 'skull-outline'];
  const phaseIcons = ['white-balance-sunny', 'weather-sunset', 'weather-night', 'anchor'];
  const assets = Object.fromEntries([...lootKinds.map(kind => [`../../assets/game-art/libertalia-loot-${kind}.webp`, `loot-${kind}`]), ...phases.map(phase => [`../../assets/game-art/libertalia-phase-${phase}.webp`, `phase-${phase}`])]);
  const { LibertaliaLootArtwork, LibertaliaPhaseArtwork } = load('components/libertalia/LibertaliaArtwork.tsx', { ...common, ...assets, 'react-native': { View: 'View' }, '../ui/GameCover': { GameCover: 'Cover' } });
  for (const group of [{ values: lootKinds, icons: lootIcons, render: kind => LibertaliaLootArtwork({ kind }), prefix: 'loot', ratio: 1 }, { values: phases, icons: phaseIcons, render: phase => LibertaliaPhaseArtwork({ phase }), prefix: 'phase', ratio: 1.6 }]) {
    for (const [index, value] of group.values.entries()) {
      const tree = group.render(value), cover = nodes(tree).find(node => node.type === 'Cover');
      assert.equal(tree.props.testID, `libertalia-${group.prefix}-art-${value}`);
      assert.equal(tree.props.accessible, false); assert.equal(tree.props.accessibilityElementsHidden, true);
      assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants'); assert.equal(tree.props.pointerEvents, 'none');
      assert.equal(cover.props.source, `${group.prefix}-${value}`);
      assert.equal(cover.props.aspectRatio, group.ratio); assert.equal(cover.props.backgroundColor, palette.panel);
      assert.equal(nodes(cover.props.fallback).find(node => node.type === 'Icon').props.name, group.icons[index]);
    }
  }
  for (const [size, expected] of [[undefined, 72], [NaN, 72], [Infinity, 72], [-10, 32], [32, 32], [64, 64], [100, 96]]) {
    const style = LibertaliaLootArtwork({ kind: 'map', size }).props.style;
    assert.equal(style.width, expected); assert.equal(style.height, expected);
  }
});

test('live crew and loot text use loaded fonts and body colours above 4.5 contrast', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const colour of ['text', 'muted', 'sky', 'violet', 'gold']) for (const face of ['panel', 'surface', 'bg']) {
    const ratio = (luminance(palette[colour]) + 0.05) / (luminance(palette[face]) + 0.05);
    assert(ratio >= 4.5, `${colour} on ${face}: ${ratio.toFixed(2)}`);
  }
  for (const tree of [cardModule().CrewCard({ rank: 11, selection: 'candidate', onPress() {} }), lootModule().LibertaliaLoot({ token: { id: 't', kind: 'map' } })]) {
    for (const node of texts(tree)) assert(shell.includes(node.props.style.fontFamily), `Missing bundled font: ${node.props.style.fontFamily}`);
  }
});

test('illustrated entrance retains actual create/join and full rules ownership with approved hero fallback', () => {
  const { default: Landing } = load('app/libertalia/index.tsx', {
    ...common, '../../components/remaining/RemainingLanding': { RemainingLanding: 'Landing' },
    '../../components/remaining/RemainingArtwork': { LibertaliaMark: 'Mark' }, '../../components/libertalia/ReferenceSheet': { LibertaliaReferenceSheet: 'Rules' },
    '../../components/ui/GameCover': { GameCover: 'Cover' }, '../../assets/game-art/libertalia-hero.webp': 42,
  });
  const tree = Landing();
  assert.equal(tree.props.gameId, 'libertalia'); assert.equal(tree.props.base, '/libertalia');
  assert.equal(tree.props.presentation, 'illustrated');
  assert.equal(tree.props.hero.props.source, 42); assert.equal(tree.props.hero.props.nativeID, 'libertalia-entrance-art');
  assert.equal(tree.props.hero.props.fallback.type, 'Mark');
  const close = () => {}, rules = tree.props.renderRules(true, close);
  assert.equal(rules.props.visible, true); assert.equal(rules.props.onClose, close);
});
