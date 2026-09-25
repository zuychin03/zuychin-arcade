const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { TYPOGRAPHY } = require('./lib/typography-fixture.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = ['saboteur', 'coup', 'king-of-tokyo', 'skull-king', 'citadels', 'not-alone', 'bang', 'libertalia', 'colt-express', 'dixit-odyssey', 'cartographers-heroes', 'feed-the-kraken', 'telestrations'];

test('every game uses the same entrance, join and lobby typography authority', () => {
  for (const route of routes) for (const [file, component] of [['index', 'RemainingLanding'], ['join', 'RemainingJoin'], ['lobby', 'RemainingLobby']]) {
    assert.match(read(`app/${route}/${file}.tsx`), new RegExp(`<${component}\\b`), `${route}/${file}`);
  }
  const layout = read('app/_layout.tsx');
  for (const role of Object.values(TYPOGRAPHY)) assert.match(layout, new RegExp(`\\b${role.fontFamily}\\b`));
});

test('equivalent setup headings resolve the same role regardless of game palette or age', () => {
  const cases = [['coup/index', 'Game version'], ['cartographers-heroes/index', 'Choose the shared map'], ['feed-the-kraken/index', 'Choose the voyage'], ['telestrations/index', 'Your table'], ['not-alone/lobby', 'BOARD FACE · CREATURE CHOOSES']];
  for (const [file, label] of cases) {
    const source = ts.createSourceFile(file, read(`app/${file}.tsx`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression;
    const visit = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Text' && node.children.some(child => ts.isJsxText(child) && child.text.trim() === label)) {
        expression = node.openingElement.attributes.properties.find(prop => prop.name?.text === 'style')?.initializer?.expression?.getText(source);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert(expression, file);
    const colour = { text: '#123456', amber: '#654321' };
    const style = vm.runInNewContext(`(${expression})`, { TYPOGRAPHY, C: colour, COUP_PALETTE: colour, NOT_ALONE: colour });
    for (const [property, value] of Object.entries(TYPOGRAPHY.heading)) assert.equal(style[property], value, `${file}: ${property}`);
  }
});

test('shared control role permits long labels and keeps native scaling and targets', () => {
  const jsx = (type, props) => ({ type, props });
  const modules = { react: { useId: () => 'hint' }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Platform: { OS: 'web' }, Text: 'Text', View: 'View' }, './ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { ARCADE: { bg: '#000', surface: '#111', pink: '#fff' }, neonBox: () => ({}) }, '../../constants/typography': { TYPOGRAPHY } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('components/ui/NeonButton.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { assert(name in modules); return modules[name]; } });
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  for (const disabled of [false, true]) {
    const tree = exports.NeonButton({ label: 'WAITING FOR RECONNECTION', disabled, onPress() {} });
    const text = nodes(tree).find(node => node.type === 'Text');
    for (const [property, value] of Object.entries(TYPOGRAPHY.control)) assert.equal(text.props.style[property], value);
    assert.equal(text.props.style.flexShrink, 1);
    assert.equal(text.props.style.minWidth, 0);
    assert.equal(text.props.numberOfLines, undefined);
    assert.equal(text.props.allowFontScaling, undefined);
    assert.equal(tree.props.style[0].minHeight, 48);
    assert.equal(tree.props.disabled, disabled);
  }
});
