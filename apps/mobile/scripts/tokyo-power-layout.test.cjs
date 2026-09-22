const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const definitions = require('../../../packages/types/src/king-of-tokyo-cards.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = (source, fileName) => {
  const result = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(result.diagnostics, []); return result.outputText;
};
const jsx = (type, props, key) => ({ type, props, key });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const collectionSource = compile(read('components/king-of-tokyo/PowerCardCollection.tsx'), 'PowerCardCollection.tsx');
const cardSource = compile(read('components/king-of-tokyo/PowerCard.tsx'), 'PowerCard.tsx');
function evaluate(source, modules, globals = {}) {
  const exports = {};
  vm.runInNewContext(source, { exports, ...globals, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
function collectionHarness(fontScale = 1) {
  const cells = []; let cursor = 0;
  const ref = { current: null };
  const modules = {
    react: { useRef: () => ref, useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { cells[i] = value; }]; }, useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', Platform: { OS: 'web' }, useWindowDimensions: () => ({ fontScale }) },
  };
  modules['../../hooks/useMeasuredLayoutWidth'] = evaluate(compile(read('hooks/useMeasuredLayoutWidth.ts'), 'useMeasuredLayoutWidth.ts'), modules, { window: {} });
  const result = evaluate(collectionSource, modules, { window: {} });
  return { ...result, render(count = 3, compact = false) {
    cursor = 0;
    return result.PowerCardCollection({ compact, children: layout => Array.from({ length: count }, (_, index) => jsx('Card', { ...layout, instanceId: index }, index)) });
  } };
}

test('fractional market width packs two complete tracks without rounded-event overflow', () => {
  const h = collectionHarness();
  let tree = h.render(), actual = 632.875;
  tree.props.ref.current = { getBoundingClientRect: () => ({ width: actual }) };
  for (const [width, rounded, expected, columns] of [[632.875, 633, 311.937, 2], [488.875, 489, 488.875, 1], [489, 489, 240, 2], [489.125, 489, 240.062, 2], [488.875, 489, 488.875, 1]]) {
    actual = width;
    tree.props.onLayout({ nativeEvent: { layout: { width: rounded } } });
    tree = h.render();
    assert(tree.props.children.every(card => card.props.columnWidth === expected));
    assert(columns * expected + (columns - 1) * 9 <= actual);
    assert.deepEqual(tree.props.children.map(card => card.key), [0, 1, 2]);
  }
  actual = 632.875;
  tree.props.onLayout({ nativeEvent: { layout: { width: 633 } } });
  tree.props.children[0].props.onTextScale(2);
  tree = h.render();
  assert(tree.props.children.every(card => card.props.columnWidth === 632.875));
  tree.props.children[0].props.onTextScale(1);
  assert(h.render().props.children.every(card => card.props.columnWidth === 311.937));
});

test('collection columns use their measured width, not item count or leftover-row growth', () => {
  const { tokyoPowerColumns } = collectionHarness();
  for (const width of [1, 264, 319, 375, 414, 489, 633, 768, 1200]) for (const compact of [false, true]) for (const scale of [1, 1.5, 2, 3]) {
    const { columns, columnWidth } = tokyoPowerColumns(width, compact, scale);
    assert(Number.isInteger(columns) && columns >= 1);
    assert(columnWidth > 0 && columnWidth <= width);
    assert(columns * columnWidth + (columns - 1) * 9 <= width);
    if (columns > 1) assert(columnWidth >= (compact ? 180 : 240) * scale - 0.001);
    assert((columns + 1) * (compact ? 180 : 240) * scale + columns * 9 > width);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(tokyoPowerColumns(633))), { columns: 2, columnWidth: 312 });
  assert.equal(tokyoPowerColumns(633, false, 2).columns, 1);
  for (const width of [0, -1, NaN, Infinity]) assert.equal(tokyoPowerColumns(width).columnWidth, '100%');
  assert.equal(tokyoPowerColumns(633, false, NaN).columns, 2);
});

test('partial rows, resize and CSS text enlargement retain stable card identities and restore equal columns', () => {
  const h = collectionHarness();
  let tree = h.render();
  assert(tree.props.children.every(card => card.props.columnWidth === '100%'));
  tree.props.onLayout({ nativeEvent: { layout: { width: 633 } } }); tree = h.render();
  for (const count of [0, 1, 2, 3, 4, 7]) {
    tree = h.render(count);
    assert.equal(tree.props.children.length, count);
    assert(tree.props.children.every(card => card.props.columnWidth === 312));
    assert.equal(tree.props.style.alignItems, 'stretch'); assert.equal(tree.props.style.flexWrap, 'wrap');
    assert.equal(tree.props.style.height, undefined); assert.equal(tree.props.style.maxHeight, undefined);
  }
  tree = h.render(); const keys = tree.props.children.map(card => card.key);
  tree.props.children[0].props.onTextScale(2); tree = h.render();
  assert(tree.props.children.every(card => card.props.columnWidth === 633));
  assert.deepEqual(tree.props.children.map(card => card.key), keys);
  tree.props.children[0].props.onTextScale(1); tree = h.render();
  assert(tree.props.children.every(card => card.props.columnWidth === 312));
  tree.props.onLayout({ nativeEvent: { layout: { width: 264 } } }); tree = h.render();
  assert(tree.props.children.every(card => card.props.columnWidth === 264));
  for (const width of [0, NaN, Infinity]) tree.props.onLayout({ nativeEvent: { layout: { width } } });
  for (const value of [NaN, Infinity, 0.5]) tree.props.children[0].props.onTextScale(value);
  assert(h.render().props.children.every(card => card.props.columnWidth === 264));
  const native = collectionHarness(2); tree = native.render(); tree.props.onLayout({ nativeEvent: { layout: { width: 633 } } });
  assert(native.render().props.children.every(card => card.props.columnWidth === 633));
});

test('power cards report actual live heading scale and keep exact collection sizing, rules and actions', () => {
  for (const platform of ['web', 'ios', 'android']) for (const compact of [false, true]) {
    const reported = []; let computedSize = compact ? 30 : 34, calls = 0;
    const { PowerCard } = evaluate(cardSource, {
      react: { useRef: value => ({ current: value }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { Text: 'Text', View: 'View', Platform: { OS: platform }, useWindowDimensions: () => ({ fontScale: platform === 'web' ? 1 : 2 }) },
      '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': definitions,
      '../ui/ScalePressable': { ScalePressable: 'Button' }, '../ui/CardSurface': { CardSurface: 'Surface' }, './TokyoPowerArtwork': { TokyoPowerArtwork: 'Artwork' }, '../../constants/theme': { TOKYO: {} },
    }, { window: { getComputedStyle: () => ({ fontSize: String(computedSize) }) } });
    const definition = definitions.KING_OF_TOKYO_POWER_CARD_BY_ID.drop_from_high_altitude;
    const props = { card: { cardId: definition.id, instanceId: 'retained-card' }, compact, columnWidth: 312, onTextScale: value => reported.push(value), actionLabel: 'BUY', onAction: () => calls++ };
    const tree = PowerCard(props), heading = nodes(tree).find(node => node.props.accessibilityRole === 'header');
    heading.props.ref.current = {}; heading.props.onLayout(); assert.deepEqual(reported, [2]);
    if (platform === 'web') { computedSize /= 2; heading.props.onLayout(); assert.deepEqual(reported, [2, 1]); }
    assert.equal(tree.props.style.width, 312); assert.equal(tree.props.style.flexBasis, 'auto');
    assert.equal(tree.props.style.flexGrow, 0); assert.equal(tree.props.style.flexShrink, 0);
    assert.equal(tree.props.style.height, undefined); assert.equal(tree.props.style.maxHeight, undefined);
    assert(nodes(tree).some(node => node.props.children === definition.effect));
    assert.equal(calls, 0); nodes(tree).find(node => node.type === 'Button').props.onPress(); assert.equal(calls, 1);
    const standalone = PowerCard({ ...props, standalone: true });
    assert.equal(standalone.props.style.width, '100%'); assert.equal(standalone.props.style.flexGrow, 0);
    assert.equal(nodes(standalone).find(node => node.type === 'Surface').props.fill, false);
  }
});

test('all three real card collections share the measured layout and standalone offers stay separate', () => {
  const source = read('app/king-of-tokyo/game.tsx');
  const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const collections = [], cards = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'PowerCardCollection') collections.push(node);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'PowerCard') cards.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(collections.length, 3); assert.equal(cards.length, 5);
  for (const card of cards) {
    const standalone = card.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.text === 'standalone');
    assert.equal(card.attributes.properties.some(attr => ts.isJsxSpreadAttribute(attr) && attr.expression.getText(ast) === 'layout'), !standalone);
  }
  assert.match(collections[0].getText(ast), /width: layout.columnWidth/);
  assert.match(collections[0].getText(ast), /marketIndex: index/);
  assert.match(collections[1].getText(ast), /startCardAction\(card\)/);
  assert.match(collections[2].getText(ast), /ownerPlayerId: owner.playerId, cardInstanceId: card.instanceId/);
});
