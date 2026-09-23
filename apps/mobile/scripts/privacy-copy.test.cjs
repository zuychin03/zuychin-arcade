const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('privacy is player-facing with the approved contact and no release checklist', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/(arcade)/privacy.tsx'), 'utf8');
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { Link: 'Link' },
    '../../constants/theme': { ARCADE: {}, neonText: () => ({}) },
  };
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const rendered = nodes(exports.default());
  const copy = rendered.filter(node => node.type === 'Text').map(node => node.props.children).join(' ');
  assert(!/release requirement|engineering summary|publisher must|before public release/i.test(copy));
  assert.match(copy, /does not delete a result already saved/);
  assert.match(copy, /Periodic cleanup/);
  assert.match(copy, /Never send a room password or session token/);
  const contact = rendered.find(node => node.type === 'Link');
  assert.equal(contact.props.href, 'mailto:k.duy1202@gmail.com');
  assert.equal(contact.props.style.minHeight, 48);
  assert(rendered.filter(node => node.props.style?.lineHeight === 25).every(node => node.props.style.fontSize === 16));
});
