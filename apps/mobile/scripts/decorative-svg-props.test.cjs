const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const fixture = require('./lib/decorative-svg-fixture.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

for (const platform of ['web', 'ios', 'android']) test(`${platform} drawing and logo emit only valid decorative SVG accessibility props`, () => {
  const hidden = fixture(platform);
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View' },
    'react-native-svg': { __esModule: true, default: 'Svg', SvgXml: 'SvgXml', Circle: 'Circle', Path: 'Path' },
    '@zuychin-arcade/types': { TELESTRATIONS_PALETTE: ['#000000'] },
    './drawingModel': { PEN_WIDTHS: [18] },
    '../../constants/arcadeLogo': { ARCADE_LOGO_ASPECT: 2, ARCADE_LOGO_SVG: '<svg fill="currentColor"/>' },
    '../ui/decorativeSvgProps': hidden,
  };
  function load(file) {
    const source = fs.readFileSync(path.join(__dirname, '../components', file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    const exports = {};
    vm.runInNewContext(compiled.outputText, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
    return exports;
  }
  const drawing = load('telestrations/Drawing.tsx').Drawing({ drawing: { strokes: [{ color: 0, width: 0, points: [[1, 2], [3, 4]] }] } });
  assert.equal(drawing.type, 'View');
  assert.equal(drawing.props.pointerEvents, 'none');
  assert.equal(drawing.props.style.aspectRatio, 1);
  assert(nodes(drawing).some(node => node.type === 'Path'));
  const logo = load('navigation/ZuychinLogo.tsx').default({ height: 20 });
  const svg = nodes(drawing).find(node => node.type === 'Svg');
  for (const item of [svg, logo]) {
    if (platform === 'web') {
      assert.equal(item.props['aria-hidden'], true);
      assert.equal(item.props.focusable, false);
      for (const key of ['accessible', 'accessibilityElementsHidden', 'importantForAccessibility']) assert.equal(Object.hasOwn(item.props, key), false);
    } else {
      assert.equal(item.props.accessible, false);
      assert.equal(item.props.accessibilityElementsHidden, true);
      assert.equal(item.props.importantForAccessibility, 'no-hide-descendants');
      assert.equal(Object.hasOwn(item.props, 'aria-hidden'), false);
      assert.equal(Object.hasOwn(item.props, 'focusable'), false);
    }
  }
});

test('all affected decorative SVG roots use the platform helper rather than native DOM attributes', () => {
  for (const file of ['telestrations/Drawing.tsx', 'navigation/ZuychinLogo.tsx', 'king-of-tokyo/TokyoArena.tsx', 'king-of-tokyo/MonsterAvatar.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, '../components', file), 'utf8');
    const roots = source.match(/<Svg(?:Xml)?\s[^>]+>/g);
    assert(roots?.length, file);
    for (const root of roots) {
      assert(root.includes('{...decorativeSvgProps}'), file);
      assert(!/\b(?:accessible|accessibilityElementsHidden|importantForAccessibility)[=\s]/.test(root), file);
    }
  }
});
