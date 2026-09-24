const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const constants = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../../packages/types/src/feed-the-kraken-constants.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: constants });
const maps = constants.FEED_THE_KRAKEN_MAPS;
const source = fs.readFileSync(path.join(__dirname, '../components/kraken/VoyageMap.tsx'), 'utf8');
const output = {};
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const mocks = {
  react: { useCallback: fn => fn, useEffect: () => {}, useRef: () => ({ current: null }), useState: initial => [initial, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': { ScrollView: 'ScrollView', Text: 'Text', View: 'View' },
  'react-native-svg': { default: 'Svg', Circle: 'Circle', G: 'G', Line: 'Line', Path: 'Path', Text: 'SvgText', __esModule: true },
  '@zuychin-arcade/types': { FEED_THE_KRAKEN_MAPS: maps },
  './Controls': { HelmButton: 'HelmButton', typography: {} },
  './palette': { KRAKEN: {} },
  './NavigationCard': { COURSE_COLOURS: { red: 'red', blue: 'blue', yellow: 'yellow' } },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: output, require: id => { assert(id in mocks, id); return mocks[id]; } });
function flatten(value) {
  if (value == null || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return [value, ...flatten(value.props?.children)];
}
for (const journey of ['quick', 'long']) {
  test(`${journey}: readable labels and unchanged routes at every ship position`, () => {
    const nodes = maps[journey], before = JSON.stringify(nodes), top = journey === 'quick' ? 9 : 11;
    const point = id => nodes[id] ? [240 + nodes[id].x * 60, 50 + (top - nodes[id].y) * 52] : [id === 'pirate' ? 45 : id === 'sailor' ? 435 : 240, 30];
    for (const nodeId of [...Object.keys(nodes), 'pirate', 'cult', 'sailor']) {
      const tree = flatten(output.VoyageMap({ journey, nodeId }));
      const text = tree.filter(item => typeof item === 'string').join(' ');
      assert.doesNotMatch(text, /-?\d+,-?\d+/);
      for (const name of ['Departure', 'Crimson Cove', 'Bluewater Bay', 'Kraken']) assert(text.includes(name), name);
      assert(tree.some(item => item.props?.accessibilityLabel === `${journey} voyage chart; ship at ${nodeId}`));
      assert.equal(tree.filter(item => item.type === 'Circle' && item.props.r === 14).length, nodes[nodeId] ? 1 : 0);
      assert.equal(tree.filter(item => item.type === 'Path').length, nodes[nodeId] ? 3 : 0);
      const routes = tree.filter(item => item.type === 'Line' && item.props.x2 !== undefined && item.props.opacity !== undefined);
      const expected = Object.values(nodes).flatMap(node => Object.entries(node.routes).map(([colour, id]) => ({ node, colour, id })));
      assert.equal(routes.length, expected.length);
      routes.forEach((line, i) => {
        const { node, colour, id } = expected[i], a = point(node.id), b = point(id);
        assert.deepEqual([line.props.x1, line.props.y1, line.props.x2, line.props.y2], [...a, ...b]);
        assert.equal(line.props.stroke, colour);
        assert.equal(line.props.strokeWidth, node.id === nodeId ? 5 : 1.5);
      });
      const focus = tree.find(item => item.props?.label === 'Find ship');
      assert.equal(typeof focus.props.onPress, 'function');
      assert.doesNotThrow(focus.props.onPress);
    }
    assert.equal(JSON.stringify(nodes), before);
  });
}
test('ship focus retains both scroll axes and zoom bounds', () => {
  assert.match(source, /vertical\.current\?\.scrollTo/);
  assert.match(source, /horizontal\.current\?\.scrollTo/);
  assert.match(source, /useEffect\(centreShip, \[centreShip\]\)/);
  assert.match(source, /Math\.min\(1\.6, zoom \+ \.2\)/);
  assert.match(source, /Math\.max\(\.6, zoom - \.2\)/);
});
