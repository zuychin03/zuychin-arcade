const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('components/libertalia/Hand.tsx');
const route = read('app/libertalia/game.tsx');
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const cards = count => Array.from({ length: count }, (_, index) => index + 1);
const find = (tree, id) => nodes(tree).find(node => node.props?.testID === id);
const buttons = tree => nodes(tree).filter(node => node.type === 'Button');
const handCards = tree => nodes(tree).filter(node => node.type === 'Card');
const flattenStyle = style => Object.assign({}, ...[style].flat(Infinity));

function harness({ width = 375, fontScale = 1, platform = 'web', reduceMotion = false } = {}) {
  const cells = [], effects = [], moves = [], actions = [];
  let cursor = 0, pending = [];
  const jsx = (type, props, key) => type === 'CardGrid'
    ? { type: 'View', props: { ...props, style: { flexWrap: 'wrap', alignItems: 'stretch' }, children: props.items.map((item, index) => props.renderItem(item, props.minCardWidth, index)) }, key }
    : { type, props, key };
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }]; },
      useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
      useEffect(fn, dependencies) { const index = cursor++; if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) { effects[index] = dependencies; pending.push(fn); } },
    },
    'react-native': { Platform: { OS: platform }, StyleSheet: { create: value => value }, Pressable: 'Button', ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({ width, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../constants/theme': { LIBERTALIA: { surface: 'surface', panel: 'panel', border: 'border', gold: 'gold', muted: 'muted', text: 'text' } },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduceMotion },
    '../ui/CardGrid': { CardGrid: 'CardGrid' },
  };
  const exports = {};
  vm.runInNewContext(compile(source), { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return { ...exports, moves, actions, render(props) {
    cursor = 0; pending = [];
    const tree = exports.LibertaliaHand({ renderCard: (card, onFocus, fluid) => jsx('Card', { card, onFocus, fluid, selected: card === 2, disabled: card === 3, status: `status-${card}`, onPress: () => actions.push(card) }, card), ...props });
    for (const node of nodes(tree)) if (node.type === 'ScrollView') node.props.ref.current = { scrollTo: move => moves.push(move) };
    for (const effect of pending) effect();
    return tree;
  } };
}

function measure(instance, props, viewport = 311) {
  let tree = instance.render(props);
  find(tree, 'libertalia-hand-ranks').props.onLayout({ nativeEvent: { layout: { width: viewport } } });
  tree = instance.render(props);
  const rail = find(tree, 'libertalia-hand-rail');
  if (!rail) return tree;
  const wrappers = nodes(rail).filter(node => node.type === 'View' && typeof node.props.style?.width === 'number');
  const width = wrappers[0].props.style.width;
  wrappers.forEach((node, index) => node.props.onLayout?.({ nativeEvent: { layout: { x: 4 + index * (width + 12) } } }));
  rail.props.onContentSizeChange(wrappers.length * width + Math.max(0, wrappers.length - 1) * 12 + 8);
  return instance.render(props);
}

test('measured full-card widths fit narrow viewports, peek when space permits and bound native enlargement', () => {
  const { libertaliaHandWidth } = harness();
  for (const viewport of [1, 180, 256, 272, 288, 311, 600, 1200]) for (const scale of [1, 1.5, 2, 3]) for (const web of [true, false]) {
    const available = Math.max(1, viewport - 8);
    assert.equal(libertaliaHandWidth(viewport, scale, web), available < 280 ? available : Math.min(360 * (web ? 1 : scale), available - 20));
  }
  for (const invalid of [NaN, Infinity, 0, -10]) assert.equal(libertaliaHandWidth(invalid, NaN, false), 272);
});

test('browse and focus geometry clamps endpoints and ignores invalid measurements', () => {
  const { libertaliaHandBrowseOffset: browse, libertaliaHandFocusOffset: focus, libertaliaHandPosition: position } = harness();
  const anchors = [0, 295, 590, 885, NaN, Infinity, 295];
  for (const maximum of [0, 20, 600, 885]) for (const offset of [-10, 0, 295, 1000]) for (const direction of [-1, 1]) {
    const next = browse(offset, maximum, anchors, direction); assert(next >= 0 && next <= maximum);
  }
  assert.equal(browse(590, 860, anchors, 1), 860); assert.equal(browse(860, 860, anchors, -1), 590);
  assert.equal(focus(0, 1459, 0, 283, 311), 0);
  assert.equal(focus(0, 1459, 295, 283, 311), 275);
  assert.equal(focus(275, 1459, 295, 283, 311), 275);
  assert.equal(focus(1459, 1459, 295, 283, 311), 295);
  assert.equal(focus(0, 1459, 1475, 283, 311), 1455);
  assert.equal(focus(200, 1000, 100, 600, 300), 100);
  for (const geometry of [[NaN, 300, 400], [-1, 300, 400], [0, Infinity, 400], [0, 0, 400], [0, 300, NaN]]) assert.equal(focus(20, 700, ...geometry), 20);
  assert.equal(position(0, [], 0), 0); assert.equal(position(0, [undefined, undefined], 2), 1);
  assert.equal(position(860, [0, 295, 590, 885], 4), 4);
});

test('hand layout and widths depend on viewport, not remaining card count', () => {
  for (const count of [0, 1, 2, 3, 6]) {
    const instance = harness(), props = { ranks: cards(count) };
    const tree = instance.render(props);
    assert.equal(handCards(tree).length, count);
    assert.equal(nodes(tree).filter(node => node.type === 'ScrollView').length, count ? 1 : 0);
    assert.equal(buttons(tree).length, count > 1 ? 2 : 0);
    if (!count) assert.equal(tree, null);
    if (count === 1 || count === 2) {
      assert(find(tree, 'libertalia-hand-rail'));
      assert(handCards(tree).every(card => typeof card.props.onFocus === 'function' && card.props.fluid === true));
    }
  }
  for (const count of [1, 2, 3, 6]) for (const textScale of [1, 1.5, 2]) for (const viewport of [256, 311, 500, 599, 600, 900, 1200]) {
    const instance = harness({ width: 1280 });
    const tree = measure(instance, { ranks: cards(count), textScale }, viewport);
    assert.equal(Boolean(find(tree, 'libertalia-hand-rail')), viewport < 600 * textScale);
    assert.equal(Boolean(find(tree, 'libertalia-hand-grid')), viewport >= 600 * textScale);
    assert.equal(handCards(tree).length, count);
  }
  assert(find(measure(harness({ width: 1280, fontScale: 2, platform: 'ios' }), { ranks: cards(6) }, 900), 'libertalia-hand-rail'));
});

test('browse controls have fixed 48px hit areas, boundary state and no game-selection side effects', () => {
  for (const platform of ['web', 'ios', 'android']) for (const reduceMotion of [false, true]) {
    const instance = harness({ platform, reduceMotion }), props = { ranks: cards(6) };
    let tree = measure(instance, props);
    instance.moves.length = 0;
    assert.equal(buttons(tree)[0].props.disabled, true); assert.equal(buttons(tree)[1].props.disabled, false);
    for (let index = 0; index < 7; index++) { buttons(tree)[1].props.onPress(); tree = instance.render(props); }
    assert.equal(buttons(tree)[1].props.disabled, true);
    assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 6 of 6 · swipe or browse');
    for (let index = 0; index < 7; index++) { buttons(tree)[0].props.onPress(); tree = instance.render(props); }
    assert.equal(buttons(tree)[0].props.disabled, true); assert.equal(instance.moves.at(-1).x, 0);
    for (const move of instance.moves) { assert.equal(move.y, undefined); assert.equal(move.animated, !reduceMotion); }
    for (const button of buttons(tree)) {
      assert.match(button.props.accessibilityLabel, /^(Previous|Next) hand card$/);
      assert.equal(button.props.accessibilityRole, 'button'); assert.equal(button.props.accessibilityState.disabled, button.props.disabled);
      for (const pressed of [false, true]) { const style = flattenStyle(button.props.style({ pressed })); assert.equal(style.width, 48); assert.equal(style.height, 48); assert.equal(style.transform, undefined); }
    }
    assert.deepEqual(instance.actions, []);
    assert.equal(handCards(tree)[1].props.selected, true); assert.equal(handCards(tree)[2].props.disabled, true);
    assert.equal(handCards(tree)[2].props.status, 'status-3'); assert(handCards(tree).every(card => card.props.fluid));
  }
});

test('hand grids and narrow rails stretch their intrinsic row without fixed or cross-row card heights', () => {
  for (const platform of ['web', 'ios', 'android']) for (const fontScale of [1, 2]) for (const viewport of [256, 311, 600, 1200]) {
    const instance = harness({ platform, fontScale, width: 1280 });
    const tree = measure(instance, { ranks: [11, 18, 19, 35], textScale: fontScale }, viewport);
    const rail = find(tree, 'libertalia-hand-rail'), grid = find(tree, 'libertalia-hand-grid');
    assert.equal(rail ? rail.props.contentContainerStyle.alignItems : grid.props.style.alignItems, 'stretch');
    if (grid) assert.equal(grid.props.style.flexWrap, 'wrap');
    if (rail) {
      assert(handCards(tree).every(card => card.props.fluid));
      const wrappers = nodes(rail).filter(node => node.type === 'View' && typeof node.props.style?.width === 'number');
      assert.equal(wrappers.length, 4);
      assert(wrappers.every(wrapper => wrapper.props.style.alignSelf === undefined));
    }
    for (const node of nodes(tree).filter(node => node.type !== 'Button' && node.type !== 'Icon')) {
      const style = flattenStyle(node.props.style);
      assert.equal(style.height, undefined); assert.equal(style.minHeight, undefined); assert.equal(style.maxHeight, undefined);
    }
    assert.deepEqual(instance.actions, []);
  }
});

test('keyboard focus and swipe reveal cards only within the rail without animation, submission or page navigation', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const instance = harness({ platform }), props = { ranks: cards(6) };
    let tree = instance.render(props);
    instance.moves.length = 0; handCards(tree)[3].props.onFocus(); assert.deepEqual(instance.moves, []);
    tree = measure(instance, props); instance.moves.length = 0;
    const rendered = handCards(tree);
    rendered[0].props.onFocus(); assert.equal(instance.moves.length, 0);
    rendered[3].props.onFocus(); assert.equal(instance.moves.at(-1).x, 865);
    const count = instance.moves.length; rendered[3].props.onFocus(); assert.equal(instance.moves.length, count);
    rendered[5].props.onFocus(); assert.equal(instance.moves.at(-1).x, 1455);
    rendered[0].props.onFocus(); assert.equal(instance.moves.at(-1).x, 0);
    find(tree, 'libertalia-hand-rail').props.onScroll({ nativeEvent: { contentOffset: { x: 590 } } });
    rendered[2].props.onFocus(); assert.equal(instance.moves.at(-1).x, 0, 'Already-visible card after swipe does not scroll');
    tree = instance.render(props); assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 3 of 6 · swipe or browse');
    for (const move of instance.moves) { assert.equal(move.animated, false); assert.equal(move.y, undefined); }
    assert.deepEqual(instance.actions, []);
    rendered[0].props.onPress(); assert.deepEqual(instance.actions, [1]);
  }
  assert.doesNotMatch(source, /scrollIntoView|\.focus\(|sendAction|useGameStore|setSelected|setPicks/);
});

test('unrelated revisions, status and selection renders preserve rail position; hand identity resets it', () => {
  const instance = harness(), props = { ranks: cards(6) };
  let tree = measure(instance, props); buttons(tree)[1].props.onPress();
  instance.moves.length = 0;
  tree = instance.render({ ...props, ranks: props.ranks.slice(), textScale: 1.1, renderCard: (card, onFocus, fluid) => ({ type: 'Card', props: { card, onFocus, fluid, disabled: true, selected: false } }) });
  assert.deepEqual(instance.moves, []); assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 2 of 6 · swipe or browse');
  tree = instance.render({ ...props, ranks: [props.ranks[1], props.ranks[0], ...props.ranks.slice(2)] });
  assert.equal(instance.moves.length, 1); assert.equal(instance.moves[0].x, 0); assert.equal(instance.moves[0].animated, false);
  instance.moves.length = 0;
  instance.render({ ranks: props.ranks.slice(1) }); assert.equal(instance.moves.length, 1); assert.equal(instance.moves[0].x, 0);
});

test('removing the first card reveals the actual requested survivor without new child layout events', () => {
  for (const platform of ['web', 'ios', 'android']) for (const viewport of [256, 311, 480]) {
    const instance = harness({ platform }), original = cards(7);
    measure(instance, { ranks: original }, viewport);
    const props = { ranks: original.slice(1) };
    let tree = instance.render(props);
    const rail = find(tree, 'libertalia-hand-rail');
    const wrappers = nodes(rail).filter(node => node.type === 'View' && typeof node.props.style?.width === 'number');
    const width = wrappers[0].props.style.width, gap = rail.props.contentContainerStyle.gap;
    rail.props.onContentSizeChange(props.ranks.length * width + (props.ranks.length - 1) * gap + 8);
    tree = instance.render(props); instance.moves.length = 0;
    for (const index of [0, 3, 5, 0]) {
      handCards(tree)[index].props.onFocus();
      const offset = instance.moves.at(-1)?.x ?? 0;
      const left = 4 + index * (width + gap) - offset;
      assert(left >= 0 && left + width <= viewport, `${platform}/${viewport}: requested survivor ${index} escaped the actual rail viewport`);
      if (index === 0) assert.equal(offset, 0, 'The new first card must not jump to its former second-card anchor');
      tree = instance.render(props);
      if (index === 0) assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 1 of 6 · swipe or browse');
    }
    assert.deepEqual(instance.actions, []);
    for (const move of instance.moves) { assert.equal(move.animated, false); assert.equal(move.y, undefined); }
    handCards(tree)[0].props.onPress(); assert.deepEqual(instance.actions, [original[1]]);
  }
});

test('same-count replacement and reorder use current ordered geometry without survivor layout callbacks', () => {
  for (const mutate of [list => [list[1], list[0], ...list.slice(2)], list => [...list.slice(1), 41]]) {
    const instance = harness(), original = cards(6);
    measure(instance, { ranks: original });
    const props = { ranks: mutate(original) };
    let tree = instance.render(props); tree = instance.render(props);
    instance.moves.length = 0;
    assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 1 of 6 · swipe or browse');
    for (const index of [0, 2, 5, 0]) {
      handCards(tree)[index].props.onFocus();
      const offset = instance.moves.at(-1)?.x ?? 0, left = 4 + index * 295 - offset;
      assert(left >= 0 && left + 283 <= 311);
      tree = instance.render(props);
    }
    assert.deepEqual(instance.actions, []);
  }
});

test('rail to grid to rail resize resets the new scroll owner and keeps label and boundaries consistent', () => {
  const instance = harness(), props = { ranks: cards(6) };
  let tree = measure(instance, props);
  for (let index = 0; index < 6; index++) { buttons(tree)[1].props.onPress(); tree = instance.render(props); }
  assert.equal(buttons(tree)[1].props.disabled, true);
  tree = measure(instance, props, 800); assert(find(tree, 'libertalia-hand-grid'));
  instance.moves.length = 0;
  tree = measure(instance, props, 311);
  assert.equal(instance.moves.at(-1).x, 0); assert.equal(instance.moves.at(-1).animated, false);
  assert.equal(find(tree, 'libertalia-hand-position').props.children.join(''), 'Crew 1 of 6 · swipe or browse');
  assert.equal(buttons(tree)[0].props.disabled, true); assert.equal(buttons(tree)[1].props.disabled, false);
  assert.deepEqual(instance.actions, []);
});


test('private rank rendering preserves proposal, submitted priority, disabled states and local-only activation', () => {
  const ast = ts.createSourceFile('game.tsx', route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'LibertaliaHand') found.push(node); ts.forEachChild(node, visit); }
  visit(ast); assert.equal(found.length, 1);
  const attrs = found[0].attributes.properties;
  const expr = name => attrs.find(attr => attr.name?.text === name).initializer.expression.getText(ast);
  assert.equal(expr('ranks'), 'mine.hand'); assert.equal(expr('textScale'), 'textScale');
  const jsx = (type, props) => ({ type, props });
  for (const selectedRank of [null, 2]) for (const rank of [null, 2]) for (const canSelect of [true, false]) for (const locked of [true, false]) {
    const calls = [], onFocus = () => {};
    const context = { exports: {}, require: () => ({ jsx, jsxs: jsx }), CrewCard: 'Card', mine: { hand: [2], selectedRank, canSelect }, rank, locked, setRank: value => calls.push(value) };
    vm.runInNewContext(compile('globalThis.renderCard = (' + expr('renderCard') + ');'), context);
    const card = context.renderCard(2, onFocus, true);
    assert.equal(card.props.rank, 2); assert.equal(card.props.nativeID, 'libertalia-hand-card-2');
    assert.equal(card.props.onFocus, onFocus); assert.equal(card.props.fluid, true);
    assert.equal(card.props.selection, selectedRank === 2 ? 'submitted' : rank === 2 ? 'candidate' : undefined);
    assert.equal(card.props.disabled, !canSelect || locked);
    card.props.onPress(); assert.deepEqual(calls, [2]);
  }
  assert.doesNotMatch(expr('renderCard'), /actions|\.send\(/);
});
