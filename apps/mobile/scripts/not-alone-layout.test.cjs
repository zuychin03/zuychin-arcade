const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('app/not-alone/game.tsx');
const rowSource = read('components/not-alone/PlaceChoiceRow.tsx');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function descendants(node, predicate) {
  const result = [];
  function visit(item) { if (predicate(item)) result.push(item); ts.forEachChild(item, visit); }
  visit(node); return result;
}
const attribute = (node, name) => (node.openingElement ?? node).attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === name)?.initializer;
function element(id) {
  const matches = descendants(ast, node => ts.isJsxElement(node) && attribute(node, 'nativeID')?.text === id);
  assert.equal(matches.length, 1, id); return matches[0];
}
const compiledExpressions = new Map();
function evaluate(expression, globals = {}) {
  const context = { ...globals };
  if (!compiledExpressions.has(expression)) compiledExpressions.set(expression, new vm.Script(ts.transpileModule(`globalThis.result = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText));
  compiledExpressions.get(expression).runInNewContext(context);
  return context.result;
}
const variable = name => descendants(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)[0].initializer.getText(ast);
const style = (node, globals) => evaluate(attribute(node, 'style').expression.getText(ast), globals);
const layout = (node, globals) => evaluate(attribute(node, 'onLayout').expression.getText(ast), globals);
function parentElement(node) {
  let parent = node.parent;
  while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
  return parent;
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

function rowHarness({ width = 375, fontScale = 1, platform = 'web', reduceMotion = false } = {}) {
  const cells = [], effects = [], moves = [], toggles = [];
  let cursor = 0, pending = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }]; },
      useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
      useEffect(fn, dependencies) { const index = cursor++; if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) { effects[index] = dependencies; pending.push(fn); } },
    },
    'react-native': { Platform: { OS: platform }, Pressable: 'Button', ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({ width, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { NOT_ALONE_PLACE_BY_ID: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { name: `Place${i + 1}` }])) },
    '../../constants/theme': { NOT_ALONE: { surface: 'surface', panel: 'panel' } },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduceMotion },
    './PlaceCard': { NotAlonePlaceCard: 'PlaceCard' },
  };
  const exports = {};
  const compiled = ts.transpileModule(rowSource, { fileName: 'PlaceChoiceRow.tsx', reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return { ...exports, moves, toggles, render(props) {
    cursor = 0; pending = [];
    const tree = exports.PlaceChoiceGrid({ onToggle: place => toggles.push(place), ...props });
    for (const node of nodes(tree)) if (node.type === 'ScrollView') node.props.ref.current = { scrollTo: move => moves.push(move) };
    for (const effect of pending) effect();
    return tree;
  } };
}

test('choice widths use actual available space and bound native enlargement', () => {
  const { placeChoiceWidth } = rowHarness();
  for (const available of [1, 180, 259, 260, 280, 311, 500, 1200]) for (const scale of [1, 1.5, 2, 3]) {
    for (const web of [true, false]) {
      const actual = placeChoiceWidth(available, scale, web);
      assert(actual > 0 && actual <= available);
      assert.equal(actual, available < 260 ? available : Math.min(300 * (web ? 1 : scale), available - 20));
    }
  }
  for (const invalid of [NaN, Infinity, 0, -10]) assert.equal(placeChoiceWidth(invalid, NaN, false), 260);
});

test('browse offsets reach both rail ends without mutating anchors or escaping bounds', () => {
  const { placeBrowseOffset } = rowHarness();
  const anchors = [0, 292, 584, 876, 292, NaN, Infinity];
  for (const maximum of [0, 20, 500, 876]) for (const offset of [-20, 0, 1, 291, 292, 900]) for (const direction of [-1, 1]) {
    const next = placeBrowseOffset(offset, maximum, anchors, direction);
    assert(Number.isFinite(next) && next >= 0 && next <= maximum);
  }
  assert.equal(placeBrowseOffset(0, 700, anchors, 1), 292);
  assert.equal(placeBrowseOffset(584, 700, anchors, 1), 700);
  assert.equal(placeBrowseOffset(700, 700, anchors, -1), 584);
  assert.equal(placeBrowseOffset(0, 700, [], -1), 0);
  assert.deepEqual(anchors, [0, 292, 584, 876, 292, NaN, Infinity]);
});

test('focus offsets fully reveal first, middle, last and reverse cards without moving visible cards', () => {
  const { placeFocusOffset } = rowHarness();
  const viewport = 661.828, maximum = 1552 - viewport;
  assert.equal(placeFocusOffset(0, maximum, 0, 300, viewport), 0);
  assert.equal(placeFocusOffset(0, maximum, 312, 300, viewport), 0);
  const middle = placeFocusOffset(0, maximum, 624, 300, viewport);
  assert(Math.abs(middle - 266.172) < 0.001);
  assert(626 >= middle && 926 <= middle + viewport);
  assert.equal(placeFocusOffset(middle, maximum, 624, 300, viewport), middle);
  assert.equal(placeFocusOffset(middle, maximum, 1248, 300, viewport), maximum);
  assert.equal(placeFocusOffset(maximum, maximum, 936, 300, viewport), maximum);
  assert.equal(placeFocusOffset(maximum, maximum, 624, 300, viewport), 624);
  assert.equal(placeFocusOffset(624, maximum, 0, 300, viewport), 0);
  assert.equal(placeFocusOffset(2, 100, 0, 300, 300), 2);
});

test('focus offsets clamp overscroll, short content and oversized cards and ignore unmeasured geometry', () => {
  const { placeFocusOffset } = rowHarness();
  assert.equal(placeFocusOffset(-10, 700, 0, 300, 400), 0);
  assert.equal(placeFocusOffset(900, 700, 0, 300, 400), 0);
  assert.equal(placeFocusOffset(0, 0, 0, 300, 500), 0);
  assert.equal(placeFocusOffset(200, 1000, 100, 600, 300), 100);
  assert.equal(placeFocusOffset(100, 1000, 100, 600, 300), 100);
  assert.equal(placeFocusOffset(0, 700, 990, 300, 300), 700);
  for (const geometry of [[NaN, 300, 400], [-1, 300, 400], [0, Infinity, 400], [0, 0, 400], [0, 300, NaN], [0, 300, 0]]) {
    assert.equal(placeFocusOffset(20, 700, ...geometry), 20);
  }
  assert.equal(placeFocusOffset(NaN, Infinity, 0, 300, 400), 0);
});

test('horizontal focus uses its measured scroll owner immediately, without selection, animation or vertical navigation', () => {
  for (const platform of ['web', 'ios', 'android']) for (const reduceMotion of [false, true]) {
    const harness = rowHarness({ platform, reduceMotion });
    const props = { places: [1, 2, 3, 4, 5], selected: [2] };
    let tree = harness.render(props);
    const rail = nodes(tree).find(node => node.type === 'ScrollView');
    const viewport = 661.828, maximum = 1552 - viewport;
    rail.props.onLayout({ nativeEvent: { layout: { width: viewport } } });
    rail.props.onContentSizeChange(1552);
    nodes(tree).filter(node => node.type === 'View' && node.props.onLayout).forEach((node, i) => node.props.onLayout({ nativeEvent: { layout: { x: 2 + i * 312 } } }));
    tree = harness.render(props);
    const cards = nodes(tree).filter(node => node.type === 'PlaceCard');
    harness.moves.length = 0;
    cards[0].props.onFocus(); cards[1].props.onFocus(); assert.equal(harness.moves.length, 0);
    cards[2].props.onFocus(); assert(Math.abs(harness.moves.at(-1).x - 266.172) < 0.001);
    cards[3].props.onFocus();
    const moves = harness.moves.length;
    cards[2].props.onFocus(); assert.equal(harness.moves.length, moves, 'Rapid focus must use the latest commanded offset before rerender');
    cards[4].props.onFocus(); assert.equal(harness.moves.at(-1).x, maximum);
    cards[2].props.onFocus(); assert.equal(harness.moves.at(-1).x, 624);
    cards[0].props.onFocus(); assert.equal(harness.moves.at(-1).x, 0);
    rail.props.onScroll({ nativeEvent: { contentOffset: { x: 500 } } });
    const afterManualScroll = harness.moves.length;
    cards[2].props.onFocus(); assert.equal(harness.moves.length, afterManualScroll);
    assert.deepEqual(harness.toggles, []); assert.deepEqual(props.selected, [2]);
    for (const move of harness.moves) { assert.equal(move.animated, false); assert.equal(move.y, undefined); assert(move.x >= 0 && move.x <= maximum); }
    assert.deepEqual(cards.filter(card => card.props.selected).map(card => card.props.placeId), [2]);
    cards[2].props.onPress(); assert.deepEqual(harness.toggles, [3]);
  }
  assert.doesNotMatch(rowSource, /scrollIntoView|\.focus\(/);
});

test('unmeasured horizontal cards and wrapped one/two-card choices do not request focus scrolling', () => {
  const harness = rowHarness();
  const tree = harness.render({ places: [1, 2, 3], selected: [] });
  harness.moves.length = 0;
  nodes(tree).find(node => node.type === 'PlaceCard').props.onFocus();
  assert.deepEqual(harness.moves, []); assert.deepEqual(harness.toggles, []);
  for (const places of [[1], [1, 2]]) {
    const wrapped = rowHarness().render({ places, selected: [] });
    assert(nodes(wrapped).filter(node => node.type === 'PlaceCard').every(card => card.props.onFocus === undefined));
  }
});

test('three-plus choices use one rail; one and two retain natural-height fluid wrapping', () => {
  for (const count of [0, 1, 2, 3, 5, 10]) {
    const harness = rowHarness();
    const places = Array.from({ length: count }, (_, i) => i + 1);
    const tree = harness.render({ places, selected: [2], selectionBlockedPlaces: [3] });
    const all = nodes(tree), cards = all.filter(node => node.type === 'PlaceCard');
    assert.equal(cards.length, count);
    assert.equal(all.filter(node => node.type === 'ScrollView').length, count >= 3 ? 1 : 0);
    assert.equal(all.filter(node => node.type === 'Button').length, count >= 3 ? 2 : 0);
    cards.forEach((card, index) => {
      assert.equal(card.props.placeId, places[index]); assert.equal(card.props.fluid, true);
      assert.equal(card.props.selected, places[index] === 2);
      assert.equal(card.props.selectionBlocked, places[index] === 3);
      card.props.onPress();
    });
    assert.deepEqual(harness.toggles, places);
    for (const node of all) { assert.equal(node.props?.style?.height, undefined); assert.equal(node.props?.style?.maxHeight, undefined); }
    if (count === 1 || count === 2) {
      const wrap = all.find(node => node.props?.style?.flexWrap === 'wrap');
      assert(wrap); assert.equal(wrap.props.style.flexDirection, 'row');
    }
  }
});

test('browse controls scroll only, preserve selection across renders and honour reduced motion', () => {
  for (const reduceMotion of [false, true]) {
    const harness = rowHarness({ reduceMotion });
    const props = { places: [1, 2, 3], selected: [2] };
    let tree = harness.render(props);
    const rail = nodes(tree).find(node => node.type === 'ScrollView');
    rail.props.onLayout({ nativeEvent: { layout: { width: 300 } } }); rail.props.onContentSizeChange(900);
    nodes(tree).filter(node => node.props?.onLayout && node.type === 'View').forEach((node, i) => node.props.onLayout({ nativeEvent: { layout: { x: 2 + i * 300 } } }));
    tree = harness.render(props);
    const buttons = nodes(tree).filter(node => node.type === 'Button');
    assert.equal(buttons[1].props.disabled, false); buttons[1].props.onPress();
    assert.equal(harness.moves.at(-1).x, 300); assert.equal(harness.moves.at(-1).animated, !reduceMotion);
    tree = harness.render({ ...props, places: [...props.places] });
    assert.equal(nodes(tree).filter(node => node.type === 'PlaceCard' && node.props.selected).length, 1);
    assert.equal(nodes(tree).find(node => node.type === 'PlaceCard' && node.props.selected).props.placeId, 2);
    assert.equal(harness.moves.at(-1).x, 300);
    nodes(tree).find(node => node.type === 'Button').props.onPress(); assert.equal(harness.moves.at(-1).x, 0);
    harness.render({ places: [2, 3, 4], selected: [2] }); assert.equal(harness.moves.at(-1).animated, false);
    assert.deepEqual(harness.toggles, []); assert.deepEqual(props.selected, [2]);
    for (const button of buttons) {
      const base = button.props.style({ pressed: false });
      assert(base.minWidth >= 48 && base.minHeight >= 48);
    }
  }
});

test('browse controls preserve their hit area and semantics during press feedback on every platform', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const harness = rowHarness({ platform });
    const props = { places: [1, 2, 3], selected: [] };
    let tree = harness.render(props);
    const rail = nodes(tree).find(node => node.type === 'ScrollView');
    rail.props.onLayout({ nativeEvent: { layout: { width: 300 } } });
    rail.props.onContentSizeChange(900);
    tree = harness.render(props);
    for (const button of nodes(tree).filter(node => node.type === 'Button')) {
      const rest = button.props.style({ pressed: false }), pressed = button.props.style({ pressed: true });
      assert.equal(button.props.accessibilityRole, 'button');
      assert.match(button.props.accessibilityLabel, /^(Previous|Next) Place cards$/);
      assert.equal(button.props.accessibilityState.disabled, button.props.disabled);
      assert.equal(rest.minWidth, 48); assert.equal(rest.minHeight, 48);
      assert.equal(rest.backgroundColor, 'surface');
      assert.equal(pressed.backgroundColor, button.props.disabled ? 'surface' : 'panel');
      assert.deepEqual({ ...pressed, backgroundColor: rest.backgroundColor }, { ...rest });
      assert.equal(pressed.transform, undefined); assert.equal(pressed.opacity, undefined);
    }
  }
});

test('parent confirms projected exploration exactly once and choice row cannot submit', () => {
  assert.doesNotMatch(rowSource, /sendAction|actions\.send|setChoicePlaces|useGameStore/);
  const lock = descendants(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'NeonButton' && attribute(node, 'label')?.getText(ast).includes('LOCK ${mine.requiredSelectionCount} SECRET'));
  assert.equal(lock.length, 1);
  const calls = [], selection = [6, 10];
  evaluate(attribute(lock[0], 'onPress').expression.getText(ast), { explorationSelection: selection, sendAction: (...args) => calls.push(args) })();
  assert.equal(calls.length, 1); assert.equal(calls[0][1], 'select'); assert.equal(calls[0][3].placeIds, selection);
  for (const busy of [true, false]) for (const count of [0, 1, 2]) assert.equal(evaluate(attribute(lock[0], 'disabled').expression.getText(ast), { busy, explorationSelection: Array(count), mine: { requiredSelectionCount: 2 } }), busy || count !== 2);
  assert.match(source, /places=\{mine.placeHand\} selected=\{explorationSelection\} selectionBlockedPlaces=\{game.selectionBlockedPlaces\} onToggle=\{toggleExploration\}/);
});

test('decision, private-hand and trail anchors compose same-scroll-owner offsets in every callback order', () => {
  const area = element('not-alone-play-area'), decision = element('not-alone-decision-area'), hand = element('not-alone-private-hand').parent, trail = element('not-alone-public-trails').parent, publicTable = element('not-alone-public-table');
  assert.equal(area.parent.openingElement.tagName.getText(ast), 'ScrollView');
  assert(decision.parent.parent === area); assert(parentElement(hand) === decision.parent); assert(publicTable.parent === area); assert(trail.parent === publicTable);
  const privateStyle = style(decision.parent, { decisionBesideTable: false });
  assert.equal(privateStyle.padding, undefined); assert.equal(privateStyle.marginTop, undefined);
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
  const globals = Object.fromEntries(['decisionZoneYRef', 'handZoneYRef', 'trailZoneYRef', 'playAreaYRef', 'decisionInnerYRef', 'handInnerYRef', 'publicColumnYRef', 'trailInnerYRef'].map(name => [name, { current: 0 }]));
  globals.setPlayAreaWidth = () => {}; globals.updateSectionOffsets = evaluate(variable('updateSectionOffsets'), globals);
  const handlers = { area: layout(area, globals), decision: layout(decision, globals), hand: layout(hand, globals), public: layout(publicTable, globals), trail: layout(trail, globals) };
  for (const order of permutations(['area', 'decision', 'hand', 'public', 'trail'])) {
    for (const value of Object.values(globals)) if (typeof value === 'object') value.current = 0;
    const y = { area: 200, decision: 0, hand: 650, public: 1200, trail: 900 };
    for (const name of order) handlers[name]({ nativeEvent: { layout: { y: y[name], width: 375 } } });
    assert.equal(globals.decisionZoneYRef.current, 200); assert.equal(globals.handZoneYRef.current, 850); assert.equal(globals.trailZoneYRef.current, 2300);
    handlers.public({ nativeEvent: { layout: { y: 0 } } }); assert.equal(globals.trailZoneYRef.current, 1100);
  }
});

test('measured play columns and results stack below their enlarged-text thresholds', () => {
  for (const scale of [1, 1.5, 2]) for (const width of [320, 375, 844, 979, 980, 1240, 1960]) {
    const wide = width >= 980 * scale;
    assert.equal(evaluate(variable('decisionBesideTable'), { playAreaWidth: width, textScale: scale }), wide);
    assert.equal(evaluate(variable('resultsWide'), { width, textScale: scale }), wide);
    for (const node of [element('not-alone-decision-area').parent, element('not-alone-public-table')]) {
      const sizing = style(node, { decisionBesideTable: wide });
      assert.equal(sizing.minWidth, 0); assert.equal(sizing.maxWidth, '100%'); assert.equal(sizing.height, undefined);
      assert.equal(wide ? sizing.flexShrink : sizing.width, wide ? 1 : '100%');
    }
  }
  const summary = element('not-alone-result-summary'), roster = element('not-alone-result-roster');
  assert.equal(summary.parent, roster.parent); assert.equal(element('not-alone-result-actions').parent, summary);
  assert.equal(summary.parent.parent.openingElement.tagName.getText(ast), 'ScrollView');
  assert.match(roster.getText(ast), /game.players.map/); assert.match(roster.getText(ast), /player.forfeited \? 'FORFEITED' : player.role === game.winner \? 'WINNER'/);
  assert.doesNotMatch(roster.getText(ast), /room\.players|numberOfLines|opacity:/);
  assert.match(summary.getText(ast), /no eligible winner remains/); assert.match(summary.getText(ast), /onPress=\{sendRematch\}/); assert.match(summary.getText(ast), /onPress=\{requestLeave\}/);
});

test('meter clamps only the visual marker while labels and values retain public authority', () => {
  for (const [value, goal, expected] of [[0, 10, 0], [5, 10, 50], [12, 10, 100], [-1, 10, 0], [0, 0, 0]]) assert.equal(evaluate(variable('progress'), { value, goal }), expected);
  const meters = descendants(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'Meter');
  assert.equal(meters.length, 2);
  assert.deepEqual(meters.map(node => attribute(node, 'value').expression.getText(ast)), ['game.rescueProgress', 'game.assimilationProgress']);
  assert.deepEqual(meters.map(node => attribute(node, 'goal').expression.getText(ast)), ['game.rescueGoal', 'game.assimilationGoal']);
  const meter = descendants(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'Meter')[0].getText(ast);
  assert.match(meter, /\$\{value\} of \$\{goal\}/); assert.match(meter, /\{value\}\/\{goal\}/); assert.doesNotMatch(meter, /sendAction|onPress|setState/);
});

test('public tokens, revealed routes and discard trails consume only public projections', () => {
  const table = element('not-alone-public-table').getText(ast);
  assert.doesNotMatch(table, /mine\.|choicePlaces|hazardPlaces|selectedPlaces|revealedHuntedHands/);
  assert.match(table, /game.huntTokens\[huntToken\].includes\(place\)/);
  assert.match(table, /selectionBlocked=\{game.selectionBlockedPlaces.includes\(place\)\}/);
  assert.match(table, /powerDisabled=\{game.disabledPlaces.includes\(place\)\}/);
  assert.match(table, /player.revealedPlaces/); assert.match(table, /player.originalRevealedPlaces/);
  assert.match(table, /player.discard.map/); assert.match(table, /Hidden by Smokescreen this round/);
  assert.match(source, /isCreature && Object.keys\(mine.revealedHuntedHands\).length/);
  assert.match(source, /!isCreature && mine.playedPlaces.length/);
});
