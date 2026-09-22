const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'coup-ui-smoke.cjs'), 'utf8');
const helper = source.slice(source.indexOf('function installTextGeometry()'), source.indexOf('async function capture('));

function measure(value, positions) {
  const calls = [], raw = { x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 20 };
  let start = 0, end = value.length, whole = true;
  const node = { textContent: value, ownerDocument: { createRange: () => ({
    selectNodeContents: () => { whole = true; },
    setStart: (_, offset) => { start = offset; whole = false; },
    setEnd: (_, offset) => { end = offset; },
    getClientRects: () => {
      if (whole) return [raw];
      calls.push([start, end]);
      const [left, right] = positions[start];
      return [{ x: left, y: 0, left, top: 0, right, bottom: 20 }];
    },
  }) } };
  const context = { window: {} };
  vm.runInNewContext(helper + '\ninstallTextGeometry();', context);
  const measured = JSON.parse(JSON.stringify(context.window.__coupQATextGeometry(node)));
  return { measured, calls, proof: (bounds) => JSON.parse(JSON.stringify(context.window.__coupQAOverflowProof([measured], bounds))) };
}

test('keeps raw trailing-space overflow while separately measuring every visible character', () => {
  const { measured, calls } = measure('A B ', { 0: [0, 8], 1: [8, 12], 2: [12, 20], 3: [20, 40] });
  assert.equal(measured.rawRects[0].right, 40);
  assert.deepEqual(calls, [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(measured.characters.length, 4);
  assert.deepEqual(measured.glyphRects.map(r => r.character), ['A', 'B']);
  assert.equal(measured.glyphRects.some(r => r.right > 20), false);
});

test('never excludes overflowing letters, punctuation, combining marks or surrogate pairs', () => {
  const { measured, calls } = measure('A\u0301😀!', { 0: [0, 8], 1: [7, 24], 2: [24, 40], 4: [40, 45] });
  assert.deepEqual(calls, [[0, 1], [1, 2], [2, 4], [4, 5]]);
  assert.deepEqual(measured.glyphRects.filter(r => r.right > 20).map(r => r.character), ['\u0301', '😀', '!']);
  assert.equal(measured.characters.some(c => c.whitespace), false);
});

test('whitespace is exempt only when every raw overflow rectangle exactly matches a measured space', () => {
  const sample = measure('A ', { 0: [0, 8], 1: [8, 40] });
  const bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  assert.equal(sample.proof(bounds).classification, 'unexplained-range-overflow');
  sample.measured.rawRects = sample.measured.characters[1].rects;
  assert.equal(sample.proof(bounds).classification, 'proven-whitespace-only');
  assert.equal(sample.proof(bounds).glyphs.length, 0);
});

test('visible glyph overflow remains a failure even with overlapping whitespace rectangles', () => {
  const sample = measure('A ', { 0: [0, 40], 1: [0, 40] });
  assert.equal(sample.proof({ left: 0, right: 20, top: 0, bottom: 20 }).classification, 'non-whitespace-overflow');
});

test('gating requires browser calibration, keeps raw diagnostics and rejects unexplained ranges', () => {
  assert.match(source, /target\.horizontalLoss\?\.length && !whitespaceProven/);
  assert.match(source, /target\.glyphHorizontalLoss\?\.length/);
  assert.match(source, /!evidence\.detectorCalibration\?\.passed \|\| item\.classification !== 'proven-whitespace-only'/);
  assert.match(source, /metrics\.document > width \+ 1 \|\| actualClipping\.length/);
  assert.match(source, /glyphHorizontalLoss: glyphLoss\(texts, bounds\)/);
  assert.match(source, /await calibrateTextGeometry\(browser\)/);
  assert.match(source, /rawRangeDiagnostics\.push/);
});
