const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('components/ui/CardGrid.tsx');
const jsx = (type, props, key) => ({ type, props, key });
function harness(platform = 'web', browser = true) {
  let availableWidth = 0;
  const ref = { current: null };
  const exports = {};
  const modules = {
    react: { useRef: () => ref, useCallback: fn => fn, useState: () => [availableWidth, value => { availableWidth = value; }] },
    'react-native': { View: 'View', Platform: { OS: platform } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  };
  const compile = input => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const globals = { ...(browser ? { window: {} } : {}), require: name => { assert(name in modules, name); return modules[name]; } };
  const hook = {};
  vm.runInNewContext(compile(read('hooks/useMeasuredLayoutWidth.ts')), { ...globals, exports: hook });
  modules['../../hooks/useMeasuredLayoutWidth'] = hook;
  vm.runInNewContext(compile(source), { ...globals, exports });
  return exports;
}

test('web tracks use precise current widths across rounded boundary and same-integer resizes', () => {
  const grid = harness();
  const props = { items: ['a', 'b', 'c'], keyExtractor: id => id, minCardWidth: 240, renderItem: (id, width) => jsx('Card', { id, width }) };
  let tree = grid.CardGrid(props), actual = 632.875;
  tree.props.ref.current = { getBoundingClientRect: () => ({ width: actual }) };
  for (const [measured, rounded, expected] of [[632.875, 633, 310.4375], [491.875, 492, 491.875], [492, 492, 240], [492.125, 492, 240.0625], [491.875, 492, 491.875]]) {
    actual = measured;
    tree.props.onLayout({ nativeEvent: { layout: { width: rounded } } });
    tree = grid.CardGrid(props);
    assert(tree.props.children.every(child => child.props.style.width === expected));
    assert.equal(tree.props.children[2].key, 'c');
    const metrics = grid.cardGridMetrics(actual, 240);
    assert(metrics.columns * expected + (metrics.columns - 1) * 12 <= actual);
  }
});

test('native and SSR retain event widths without touching DOM; invalid or missing DOM safely falls back', () => {
  const props = { items: ['a'], keyExtractor: id => id, minCardWidth: 240, renderItem: () => null };
  for (const [platform, browser] of [['ios', true], ['android', true], ['web', false]]) {
    const grid = harness(platform, browser), tree = grid.CardGrid(props);
    let reads = 0;
    tree.props.ref.current = { getBoundingClientRect: () => { reads++; return { width: 632.875 }; } };
    tree.props.onLayout({ nativeEvent: { layout: { width: 633 } } });
    assert.equal(grid.CardGrid(props).props.children[0].props.style.width, 310.5);
    assert.equal(reads, 0);
  }
  const grid = harness(), tree = grid.CardGrid(props);
  for (const node of [null, {}, ...[undefined, 0, -1, NaN, Infinity, '632.875'].map(width => ({ getBoundingClientRect: () => ({ width }) })), { getBoundingClientRect: () => { throw Error('detached'); } }]) {
    tree.props.ref.current = node;
    tree.props.onLayout({ nativeEvent: { layout: { width: 633 } } });
    assert.equal(grid.CardGrid(props).props.children[0].props.style.width, 310.5);
  }
  tree.props.ref.current = null;
  for (const width of [0, -1, NaN, Infinity]) tree.props.onLayout({ nativeEvent: { layout: { width } } });
  assert.equal(grid.CardGrid(props).props.children[0].props.style.width, 310.5);
  tree.props.ref.current = { getBoundingClientRect: () => ({ width: 632.875 }) };
  tree.props.onLayout({ nativeEvent: { layout: { width: NaN } } });
  assert.equal(grid.CardGrid(props).props.children[0].props.style.width, 310.4375);
});

test('BANG and Libertalia tracks stay within actual parent width and retain family caps', () => {
  const { cardGridMetrics: metrics } = harness();
  for (const [minimum, maximum] of [[200, 260], [250, 320], [208, 280], [240, 320]]) {
    for (const available of [1, 180, 288, 311, 375, 600, 744, 798, 1256]) for (const scale of [1, 1.5, 2, 3]) {
      const result = metrics(available, minimum, maximum, 12, scale);
      assert(result.columns >= 1);
      assert(result.columnWidth > 0 && result.columnWidth <= maximum * scale);
      assert(result.columnWidth * result.columns + 12 * (result.columns - 1) <= available + 0.0001);
      if (result.columns > 1) assert(result.columnWidth >= minimum * scale);
    }
  }
  assert.equal(metrics(744, 200, 260).columnWidth, 240);
  assert.equal(metrics(600, 250, 320).columnWidth, 294);
  assert.equal(metrics(1256, 250, 320, 12, 2).columns, 2);
});

test('invalid measurements and parameters retain finite positive bounded geometry', () => {
  const { cardGridMetrics: metrics } = harness();
  for (const invalid of [0, -10, NaN, Infinity]) {
    const value = metrics(invalid, 200, 260, NaN, NaN);
    assert.equal(value.columns, 1); assert.equal(value.columnWidth, 200); assert.equal(value.gap, 12);
  }
  assert.equal(metrics(400, 200, 100).columnWidth, 200);
  assert.equal(metrics(400, 200, undefined).columnWidth, 400);
});

test('one, full and incomplete rows keep identical measured widths without growing leftovers', () => {
  const grid = harness();
  for (const count of [0, 1, 2, 3, 4, 7]) {
    const props = { items: Array.from({ length: count }, (_, i) => ({ id: `card-${i}` })), keyExtractor: item => item.id, minCardWidth: 200, maxCardWidth: 260, renderItem: (item, width, index) => jsx('Card', { item, width, index }) };
    grid.CardGrid(props).props.onLayout({ nativeEvent: { layout: { width: 744 } } });
    const tree = grid.CardGrid(props);
    assert.equal(tree.props.style.alignItems, 'stretch');
    assert.equal(tree.props.children.length, count);
    tree.props.children.forEach((wrapper, index) => {
      assert.equal(wrapper.props.style.width, 240);
      assert.equal(wrapper.props.style.flexGrow, undefined);
      assert.equal(wrapper.props.children.props.width, 240);
      assert.equal(wrapper.props.children.props.index, index);
      assert.equal(wrapper.key, `card-${index}`);
    });
  }
});

test('resize and reorder preserve keyed children and do not call card actions', () => {
  const grid = harness();
  let presses = 0;
  const cards = [{ id: 'a', press: () => presses++ }, { id: 'b', press: () => presses++ }];
  const props = { items: cards, keyExtractor: item => item.id, minCardWidth: 250, maxCardWidth: 320, renderItem: item => jsx('Button', { onPress: item.press }) };
  let tree = grid.CardGrid(props);
  tree.props.onLayout({ nativeEvent: { layout: { width: 600 } } });
  tree = grid.CardGrid(props);
  assert.equal(tree.props.children[0].props.style.width, 294);
  tree.props.onLayout({ nativeEvent: { layout: { width: 280 } } });
  const resized = grid.CardGrid({ ...props, items: [...cards].reverse() });
  assert.deepEqual(Array.from(resized.props.children, item => item.key), ['b', 'a']);
  assert.equal(resized.props.children[1].props.children.type, tree.props.children[0].props.children.type);
  assert.equal(resized.props.children[1].props.children.props.onPress, cards[0].press);
  assert.equal(resized.props.children[1].props.style.width, 280);
  assert.equal(presses, 0);
  resized.props.children[1].props.children.props.onPress(); assert.equal(presses, 1);
});

test('duplicate values retain caller indices and stable distinct identities', () => {
  const grid = harness();
  const tree = grid.CardGrid({ items: ['duke', 'duke', 'captain'], minCardWidth: 208, keyExtractor: (role, index) => `${role}-${index}`, renderItem: (role, width, index) => jsx('Choice', { role, width, index }) });
  assert.deepEqual(Array.from(tree.props.children, item => item.key), ['duke-0', 'duke-1', 'captain-2']);
  assert.deepEqual(Array.from(tree.props.children, item => item.props.children.props.index), [0, 1, 2]);
});

test('actual BANG and Libertalia collections use fluid faces within shared tracks, without replacing rails', () => {
  for (const game of ['bang', 'libertalia']) {
    const hand = read(`components/${game}/Hand.tsx`);
    assert.match(hand, /<CardGrid[^>]+testID=/);
    assert.match(hand, /renderItem=\{card => renderCard\(card, undefined, true\)\}/);
    assert.match(hand, /<ScrollView ref=\{rail\}/);
    assert.match(hand, /width: cardWidth, flexShrink: 0/);
  }
  const bang = read('app/bang/game.tsx'), lib = read('app/libertalia/game.tsx');
  for (const prefix of ['check', 'store', 'draw', 'order']) assert.match(bang, new RegExp(`fluid idPrefix="${prefix}"`));
  assert.match(lib, /items=\{p\.ship\}[\s\S]*?renderItem=\{card => <CrewCard rank=\{card\} fluid/);
  assert.match(lib, /items=\{mine\.graveyard\}[\s\S]*?renderItem=\{card => <CrewCard rank=\{card\} fluid/);
  assert.doesNotMatch(source, /numberOfLines|height:/);
});
