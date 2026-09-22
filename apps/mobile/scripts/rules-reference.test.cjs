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
    const modules = {
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: platform } },
      'react-native-reanimated': { default: { View: 'Animated.View' } },
      '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
      '../../constants/theme': { neonText: () => ({}) },
      '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
      '../../hooks/useWebModalFocus': { useWebModalFocus: (...args) => focusCalls.push(args) },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
    const onClose = () => {};
    const tree = exports.RulesReferenceSheet({ visible: true, gameTitle: 'BANG!', subtitle: 'Base rules', icon: 'pistol', palette: {}, sections: [], onClose });
    const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)];
    const scroll = nodes(tree).find((node) => node.type === 'ScrollView').props;
    assert.equal(scroll.tabIndex, platform === 'web' ? 0 : undefined);
    assert.equal(scroll.role, platform === 'web' ? 'region' : undefined);
    assert.equal(scroll.accessibilityLabel, 'BANG! rules and card reference');
    assert.equal(scroll.showsVerticalScrollIndicator, platform === 'web');
    assert.equal(focusCalls[0][0], true);
    assert.equal(focusCalls[0][2], onClose);
  });
}
