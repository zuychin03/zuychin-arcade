const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

for (const platform of ['web', 'ios', 'android']) {
  test(platform + ' rulebook exposes a keyboard scroll region only on web', () => {
    const filename = path.join(__dirname, '../components/ui/RulesReferenceSheet.tsx');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const jsx = (type, props) => ({ type, props });
    const focusCalls = [];
    let expanded = false;
    const modules = {
      react: { useState: () => [expanded, update => { expanded = typeof update === 'function' ? update(expanded) : update; }] },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: platform }, useWindowDimensions: () => ({ width: 320, fontScale: 2 }) },
      'react-native-reanimated': { default: { View: 'Animated.View' } },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
      '../../constants/theme': { neonText: () => ({}) },
      '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
      '../../hooks/useWebModalFocus': { useWebModalFocus: (...args) => focusCalls.push(args) },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
    const onClose = () => {};
    const guide = { type: 'AuthoredGuide', props: { children: 'A game-specific example' } };
    const tree = exports.RulesReferenceSheet({ visible: true, gameTitle: 'BANG!', subtitle: 'Base rules', icon: 'pistol', palette: {}, sections: [{ title: 'Exact rules', icon: 'cards', entries: [{ title: 'An exception', body: 'Complete retained rule text' }] }], children: guide, onClose });
    const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)];
    const scroll = nodes(tree).find((node) => node.type === 'ScrollView').props;
    const close = nodes(tree).find(node => node.props.accessibilityLabel === 'Close rules');
    const heading = nodes(tree).find(node => node.props.children === 'Rulebook');
    assert.equal(close.props.style.flexShrink, 0);
    assert.equal(close.props.style.width, 48);
    assert.equal(heading.props.style.textShadowRadius, undefined);
    assert(nodes(tree).some(node => node.props.style?.flexWrap === 'wrap'));
    assert(nodes(tree).some(node => node.props.style?.minWidth === (platform === 'web' ? 'min-content' : 180)));
    assert.equal(scroll.tabIndex, platform === 'web' ? 0 : undefined);
    assert.equal(scroll.role, platform === 'web' ? 'region' : undefined);
    assert.equal(scroll.accessibilityLabel, 'BANG! rules and card reference');
    assert.equal(scroll.showsVerticalScrollIndicator, platform === 'web');
    assert.equal(focusCalls[0][0], true);
    assert.equal(focusCalls[0][2], onClose);
    assert.equal(scroll.children[1], guide);
    const chapter = nodes(tree).find(node => typeof node.type === 'function');
    let rendered = chapter.type(chapter.props);
    let toggle = nodes(rendered).find(node => node.type === 'Pressable');
    assert.equal(toggle.props.accessibilityState.expanded, false);
    assert.equal(toggle.props['aria-expanded'], platform === 'web' ? false : undefined);
    assert.equal(toggle.props.style.minHeight, 48);
    toggle.props.onPress();
    rendered = chapter.type(chapter.props);
    toggle = nodes(rendered).find(node => node.type === 'Pressable');
    assert.equal(toggle.props.accessibilityState.expanded, true);
    assert.equal(toggle.props['aria-expanded'], platform === 'web' ? true : undefined);
    const retainedRule = nodes(rendered).find(node => node.props.children === 'Complete retained rule text');
    assert.equal(retainedRule.props.style.fontSize, 16);
    toggle.props.onPress();
    assert.equal(nodes(chapter.type(chapter.props)).some(node => node.props.children === 'Complete retained rule text'), false);
  });
}
