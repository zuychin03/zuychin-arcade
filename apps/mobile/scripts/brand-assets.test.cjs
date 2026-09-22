const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const Jimp = require('jimp-compact');
const { parseMaster, microMaster, squareSvg, textArtifacts, parseArgs, rasterSpecs, mobileRoot, masterPath } = require('./generate-brand.cjs');

function master() { return parseMaster(fs.readFileSync(masterPath, 'utf8')); }
function evaluate(source, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
function constants() { return evaluate(fs.readFileSync(path.join(mobileRoot, 'constants/arcadeLogo.ts'), 'utf8')); }

test('generator requires an explicit existing-tool path and rejects unexpected arguments', () => {
  assert.throws(() => parseArgs([]), /sharp-module/);
  assert.throws(() => parseArgs(['--install']), /Usage/);
  assert.throws(() => parseArgs(['--sharp-module', '--check']), /Usage/);
  assert.equal(parseArgs(['--sharp-module', '.', '--check']).check, true);
});

test('master remains self-contained, themeable and has valid finite geometry', () => {
  const value = master();
  assert.equal(value.viewBox, '110 210 1030 555');
  assert.equal(value.aspect, 1030 / 555);
  assert.throws(() => parseMaster('<svg viewBox="0 0 0 0" fill="currentColor"></svg>'), /viewBox/);
  assert.throws(() => parseMaster('<svg viewBox="0 0 1 1"><image href="https://example.test/a"/></svg>'), /self-contained/);
});

test('generated navigation constants, raster hashes and SVG derivatives match the master', () => {
  const value = master();
  const buffers = Object.fromEntries(rasterSpecs.map(({ file }) => [file, fs.readFileSync(path.join(mobileRoot, file))]));
  for (const [file, expected] of Object.entries(textArtifacts(value, buffers))) {
    assert.equal(fs.readFileSync(path.join(mobileRoot, file), 'utf8'), expected, file);
  }
  assert.equal(constants().ARCADE_LOGO_SVG, value.svg);
  assert.equal(constants().ARCADE_LOGO_ASPECT, value.aspect);
  assert(Math.hypot(0.52, 0.52 / value.aspect) <= 66 / 108);
  assert(squareSvg(microMaster(value), rasterSpecs[3]).includes('viewBox="0 0 64 64"'));
});

test('favicon extracts exactly the two tagged Z strokes and uses the tighter micro aspect', () => {
  const value = master();
  const micro = microMaster(value);
  const sourcePaths = value.svg.match(/<path\b[^>]*\/>/g);
  const microPaths = micro.svg.match(/<path\b[^>]*\/>/g);
  assert.equal(microPaths.length, 2);
  for (const [index, id] of ['z-upper', 'z-lower'].entries()) {
    const original = sourcePaths.find(tag => tag.includes(`id="${id}"`));
    assert(original, id);
    assert.equal(microPaths[index].match(/\bd="([^"]+)"/)[1], original.match(/\bd="([^"]+)"/)[1]);
  }
  assert.equal(micro.viewBox, '340 210 570 535');
  assert.equal(micro.aspect, 570 / 535);
  assert.notEqual(micro.aspect, value.aspect);
  const favicon = squareSvg(micro, rasterSpecs[3]);
  assert(favicon.includes(`height="${64 * 0.86 / micro.aspect}"`));
  assert.equal((favicon.match(/<path\b/g) || []).length, 2);
  assert(!/<circle\b/.test(favicon));
  assert.throws(() => microMaster(parseMaster(value.svg.replace('id="z-upper"', 'id="not-upper"'))), /z-upper/);
});

for (const spec of rasterSpecs) {
  test(`${spec.file} has the intended dimensions, colour and alpha bounds`, async () => {
    const image = await Jimp.read(path.join(mobileRoot, spec.file));
    const { width, height, data } = image.bitmap;
    assert.equal(width, spec.size);
    assert.equal(height, spec.size);
    let painted = 0;
    let transparent = 0;
    let solidBrand = 0;
    const rgb = spec.color.slice(1).match(/../g).map(value => parseInt(value, 16));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha === 255 && rgb.every((value, index) => data[offset + index] === value)) solidBrand++;
      if (spec.background) {
        assert.equal(alpha, 255);
        if (data[offset] !== 11 || data[offset + 1] !== 7 || data[offset + 2] !== 22) painted++;
      } else if (alpha) {
        painted++;
        assert(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= width * 33 / 108 + 1, 'Paint outside adaptive safe circle');
        if (spec.color === '#FFFFFF') assert(data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255, 'Monochrome must be a white alpha silhouette');
      } else transparent++;
    }
    assert(painted > width * height * 0.01, 'Artwork must not be empty');
    assert(solidBrand > width * height * 0.005, 'Artwork must use its intended brand colour');
    if (spec.background) assert.equal(image.getPixelColor(0, 0), 0x0B0716FF);
    else assert(transparent > width * height * 0.6, 'Adaptive layer must retain transparent padding');
  });
}

test('adaptive foreground and monochrome use identical geometry and alpha', async () => {
  const foreground = await Jimp.read(path.join(mobileRoot, 'assets/android-icon-foreground.png'));
  const monochrome = await Jimp.read(path.join(mobileRoot, 'assets/android-icon-monochrome.png'));
  assert.equal(foreground.bitmap.data.length, monochrome.bitmap.data.length);
  for (let offset = 3; offset < foreground.bitmap.data.length; offset += 4) {
    assert.equal(foreground.bitmap.data[offset], monochrome.bitmap.data[offset]);
  }
});

test('app configuration points to the generated icon variants', () => {
  const { expo } = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'));
  assert.equal(expo.icon, './assets/icon.png');
  assert.equal(expo.web.favicon, './assets/favicon.png');
  assert.equal(expo.android.adaptiveIcon.foregroundImage, './assets/android-icon-foreground.png');
  assert.equal(expo.android.adaptiveIcon.monochromeImage, './assets/android-icon-monochrome.png');
  assert.equal(expo.android.adaptiveIcon.backgroundColor, '#0B0716');
});

test('navigation component derives its bounds and themeable SVG from generated constants', () => {
  const jsx = (type, props) => ({ type, props });
  const exported = evaluate(fs.readFileSync(path.join(mobileRoot, 'components/navigation/ZuychinLogo.tsx'), 'utf8'), {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native-svg': { SvgXml: 'SvgXml' },
    '../../constants/arcadeLogo': constants(),
  });
  for (const height of [30, 44]) {
    const style = { flexShrink: 0 };
    const tree = exported.default({ color: '#abcdef', height, style });
    assert.equal(tree.type, 'SvgXml');
    assert.equal(tree.props.height, height);
    assert(Math.abs(tree.props.width - height * master().aspect) <= 0.5);
    assert.equal(tree.props.style, style);
    assert(tree.props.color === '#abcdef' || tree.props.xml.includes('#abcdef'), 'Caller theme must reach SVG');
  }
});
