const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function render(platform, dialog) {
  const filename = path.join(__dirname, '../components/ui/ArcadeDialog.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: platform } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    'react-native-reanimated': { default: { View: 'Animated.View' } },
    '../../lib/dialog': { useDialogStore: selector => selector({ dialog, hide: () => calls.push('hide') }) },
    './ScalePressable': { ScalePressable: 'ScalePressable' },
    '../../constants/theme': { ARCADE: {}, neonText: () => ({}) },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
    '../../hooks/useWebModalFocus': { useWebModalFocus: (...args) => calls.push(['focus', ...args]) },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert(name in modules, name); return modules[name]; } }, { filename });
  return { tree: exports.ArcadeDialogHost(), calls };
}

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)];
const fixture = { title: 'Forfeit this expedition?', message: 'Read the consequence before leaving.', buttons: [{ text: 'STAY', style: 'cancel' }, { text: 'LEAVE', style: 'destructive' }] };

for (const platform of ['web', 'ios', 'android']) {
  test(platform + ' dialog contains scrollable explanation and keeps actions outside it', () => {
    const { tree } = render(platform, fixture);
    const all = nodes(tree);
    assert(all.some(node => node.type === 'SafeAreaProvider'));
    assert(all.some(node => node.type === 'SafeAreaView'));
    const panel = all.find(node => node.props.nativeID === 'arcade-dialog');
    assert.equal(panel.props.style.maxHeight, '100%');
    const content = all.find(node => node.props.nativeID === 'arcade-dialog-content');
    assert.equal(content?.type, 'ScrollView');
    assert.equal(content.props.tabIndex, platform === 'web' ? 0 : undefined);
    assert.equal(content.props.role, platform === 'web' ? 'region' : undefined);
    assert.equal(content.props.accessibilityLabel, 'Forfeit this expedition? details');
    assert.equal(nodes(content).filter(node => node.type === 'ScalePressable').length, 0);
    assert.equal(all.filter(node => node.type === 'ScalePressable').length, 2);
    assert.equal(content.props.style.flexShrink, 1);
    for (const node of all.filter(node => node.type === 'ScalePressable')) assert(node.props.style.minHeight >= 48);
  });
}

test('dialog cancellation hides before invoking the cancel callback', () => {
  let h;
  h = render('ios', { ...fixture, buttons: [{ text: 'STAY', style: 'cancel', onPress: () => h.calls.push('cancel') }] });
  h.tree.props.onRequestClose();
  assert.deepEqual(h.calls.slice(-2), ['hide', 'cancel']);
});

test('dialog action hides before invoking its callback and preserves labels', () => {
  let h;
  h = render('android', { ...fixture, buttons: [{ text: 'LEAVE', style: 'destructive', onPress: () => h.calls.push('leave') }] });
  const action = nodes(h.tree).find(node => node.type === 'ScalePressable');
  assert.equal(action.props.accessibilityLabel, 'LEAVE');
  action.props.onPress();
  assert.deepEqual(h.calls.slice(-2), ['hide', 'leave']);
});

test('empty dialog renders no modal', () => {
  assert.equal(render('web', null).tree, null);
});
