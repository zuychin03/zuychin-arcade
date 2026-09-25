const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const typography = require('./lib/typography-fixture.cjs');

const games = [
  ['saboteur', 'Saboteur'], ['coup', 'Coup'], ['king-of-tokyo', 'King of Tokyo'],
  ['skull-king', 'Skull King'], ['citadels', 'Citadels'], ['not-alone', 'Not Alone'],
  ['bang', 'BANG!'], ['libertalia', 'Libertalia'], ['colt-express', 'Colt Express'],
  ['feed-the-kraken', 'Feed the Kraken'], ['telestrations', 'Telestrations'],
  ['cartographers-heroes', 'Cartographers Heroes'], ['dixit-odyssey', 'Dixit Odyssey'],
];
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
test('every complete game route group is covered by the navigation theme contract', () => {
  const app = path.join(__dirname, '../app');
  const routes = fs.readdirSync(app).filter(route => ['_layout', 'index', 'join', 'lobby', 'game'].every(screen => fs.existsSync(path.join(app, route, screen + '.tsx'))));
  assert.deepEqual(routes.sort(), games.map(([route]) => route).sort());
});

function layout(route, reduced) {
  const source = fs.readFileSync(path.join(__dirname, '../app', route, '_layout.tsx'), 'utf8');
  const jsx = (type, props) => ({ type, props });
  const palette = new Proxy({}, { get: (_target, key) => 'token:' + key });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { Stack: { Screen: 'Screen' } },
    'react-native': { View: 'View' },
    '../../constants/theme': Object.fromEntries(['MINE', 'COUP', 'TOKYO', 'SKULL_KING', 'CITADELS', 'NOT_ALONE', 'BANG', 'LIBERTALIA', 'COLT', 'DIXIT'].map(name => [name, palette])),
    '../../constants/typography': typography,
    ...Object.fromEntries(['kraken', 'telestrations', 'cartographers'].map(name => [`../../components/${name}/palette`, { [name.toUpperCase()]: palette }])),
    '../../components/ui/ArcadeBackButton': { ArcadeBackButton: 'ArcadeBackButton' },
    '../../components/ui/RouteBackButton': { RouteBackButton: 'RouteBackButton' },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduced },
  };
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports.default();
}

for (const [route, title] of games) {
  test(`${route}: readable navigation title preserves full identity, back control and motion preferences`, () => {
    for (const reduced of [false, true]) {
      const tree = layout(route, reduced);
      const screens = nodes(tree).filter(node => node.type === 'Screen');
      const index = screens.find(node => node.props.name === 'index');
      assert.equal(index.props.options.title, title);
      assert.equal(tree.props.screenOptions.headerTitleStyle, typography.TYPOGRAPHY.navigation);
      assert.equal(tree.props.screenOptions.headerTitleStyle.fontFamily, 'Outfit_800ExtraBold');
      assert.equal(tree.props.screenOptions.headerTitleStyle.fontWeight, 'normal');
      assert.equal(tree.props.screenOptions.headerTitleStyle.fontSize, 18);
      assert.equal(tree.props.screenOptions.animation, reduced ? 'none' : 'slide_from_right');
      assert.equal(nodes(index.props.options.headerLeft()).filter(node => node.type === 'ArcadeBackButton').length, 1);
      assert.equal(screens.find(node => node.props.name === 'lobby').props.options.headerBackVisible, false);
      assert.equal(screens.find(node => node.props.name === 'game').props.options.headerShown, false);
    }
  });
}
