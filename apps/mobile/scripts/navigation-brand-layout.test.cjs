const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function render(name, props = {}, platform = 'web') {
  const source = fs.readFileSync(path.join(__dirname, `../components/navigation/${name}.tsx`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform: { OS: platform }, StyleSheet: { create: value => value } },
    'expo-blur': { BlurView: 'BlurView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-router': { useRouter: () => ({ push() {} }), usePathname: () => '/' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView', Text: 'AnimatedText' }, useAnimatedStyle: factory => factory() },
    '../../constants/theme': { ARCADE: { text: '#EDEAFB', cyan: '#2EE6FF', pink: '#FF2E88' } },
    './ZuychinLogo': { __esModule: true, default: 'Logo' },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { assert(name in modules, name); return modules[name]; } });
  return exports.default(props);
}
function children(node) { return [node.props?.children].flat(Infinity).filter(value => value && typeof value === 'object'); }
function all(node) { return [node, ...children(node).flatMap(all)]; }

test('mobile header grows with wrapped branding without borrowing menu space', () => {
  const tree = render('MobileHeader');
  assert.equal(tree.props.style.height, undefined);
  assert(tree.props.style.minHeight >= 60);
  assert.equal(tree.props.style.flexShrink, 0);
  const brand = children(tree).find(node => node.type === 'View');
  assert.equal(brand.props.style.flexWrap, 'wrap');
  assert.equal(brand.props.style.minWidth, 0);
  assert.equal(brand.props.style.paddingRight, undefined);
  for (const label of children(brand).filter(node => node.type === 'Text')) {
    assert.equal(label.props.style.maxWidth, '100%');
    assert.equal(label.props.numberOfLines, undefined);
    assert.equal(label.props.adjustsFontSizeToFit, undefined);
    assert.notEqual(label.props.allowFontScaling, false);
  }
  assert.equal(children(brand).find(node => node.type === 'Logo').props.height, 30);
});

test('mobile menu keeps an independent 48px target and its actual callback', () => {
  let presses = 0;
  const tree = render('MobileHeader', { onMenuPress: () => { presses++; } });
  const menu = all(tree).find(node => node.props.accessibilityLabel === 'Open navigation menu');
  assert(menu.props.style.width >= 48);
  assert(menu.props.style.minHeight >= 48);
  assert.equal(menu.props.style.flexShrink, 0);
  menu.props.onPress(); assert.equal(presses, 1);
});

test('web sidebar keeps complete brand words and wraps the separate artwork', () => {
  const tree = render('Sidebar');
  assert.equal(tree.props.style.minWidth, 'min-content');
  assert.equal(tree.props.style.flexShrink, 0);
  const brand = children(tree)[0];
  assert.equal(brand.props.style.flexWrap, 'wrap');
  assert.equal(brand.props.style.paddingHorizontal, 16);
  const words = children(brand).find(node => node.type === 'View');
  assert.equal(words.props.style.maxWidth, '100%');
  assert.equal(words.props.style.minWidth, 'max-content');
  assert.equal(words.props.style.flexShrink, 0);
  const labels = children(words);
  assert.equal(labels[0].props.style.fontSize, 24);
  assert.equal(labels[1].props.style.fontSize, 12);
  assert.equal(labels[0].props.children, 'ZUYCHIN');
  assert.equal(labels[1].props.children, 'ARCADE');
  for (const label of labels) {
    assert.equal(label.props.numberOfLines, undefined);
    assert.equal(label.props.adjustsFontSizeToFit, undefined);
    assert.notEqual(label.props.allowFontScaling, false);
  }
  assert.equal(children(brand).find(node => node.type === 'Logo').props.height, 44);
});

test('sidebar links remain scrollable on short screens and native sizing stays unchanged', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const tree = render('Sidebar', {}, platform);
    const scroll = children(tree).find(node => node.type === 'ScrollView');
    assert.equal(scroll.props.style.flex, 1);
    assert.equal(scroll.props.style.minHeight, 0);
    assert.equal(children(scroll).length, 5);
    if (platform !== 'web') {
      assert.equal(tree.props.style.width, 260);
      assert.equal(tree.props.style.minWidth, undefined);
      const words = children(children(tree)[0]).find(node => node.type === 'View');
      assert.equal(words.props.style.minWidth, 0);
      assert.equal(words.props.style.flexShrink, 1);
    }
  }
});
