const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function harness(os = 'web', browser = true) {
  const source = fs.readFileSync(path.join(__dirname, '../hooks/useMeasuredTextScale.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  let scale = 1, fontSize = '18px', reads = 0;
  const ref = { current: null }, exports = {};
  const modules = {
    react: { useRef: () => ref, useState: () => [scale, value => { scale = value; }] },
    'react-native': { Platform: { OS: os } },
  };
  const context = { exports, require: name => { assert(name in modules, name); return modules[name]; } };
  if (browser) context.window = { getComputedStyle: node => { assert.equal(node, ref.current); reads++; return { fontSize }; } };
  vm.runInNewContext(compiled.outputText, context);
  return { render: exports.useMeasuredTextScale, ref, setFont: value => { fontSize = value; }, reads: () => reads };
}

test('real heading measurement grows and restores without changing the text itself', () => {
  const h = harness(); h.ref.current = {};
  for (const base of [16, 18]) {
    for (const scale of [1, 2, 3, 1.5, 1]) {
      h.setFont(`${base * scale}px`);
      const hook = h.render(base); assert.equal(hook.textRef, h.ref); hook.onTextLayout();
      assert.equal(h.render(base).textScale, scale);
    }
  }
  assert.equal(h.reads(), 10);
});

test('native uses the actual font scale and never reads browser layout', () => {
  for (const os of ['ios', 'android']) {
    const h = harness(os); h.ref.current = {}; h.setFont('200px');
    for (const scale of [1, 1.5, 2, 1, 0, NaN, Infinity]) {
      const hook = h.render(18, scale); hook.onTextLayout();
      assert.equal(hook.textScale, Number.isFinite(scale) ? Math.max(1, scale) : 1);
    }
    assert.equal(h.reads(), 0);
  }
});

test('missing DOM and invalid observations retain safe finite geometry', () => {
  for (const browser of [false, true]) {
    const h = harness('web', browser);
    h.render(18).onTextLayout(); assert.equal(h.reads(), 0);
    h.ref.current = {};
    for (const base of [0, -1, NaN, Infinity]) h.render(base).onTextLayout();
    assert.equal(h.reads(), 0);
    if (!browser) { h.render(18).onTextLayout(); assert.equal(h.reads(), 0); continue; }
    h.setFont('36px'); h.render(18).onTextLayout();
    for (const font of ['', 'auto', 'NaN', 'Infinity', '0px', '-18px']) {
      h.setFont(font); h.render(18).onTextLayout(); assert.equal(h.render(18).textScale, 2);
    }
    h.setFont('9px'); h.render(18).onTextLayout(); assert.equal(h.render(18).textScale, 1);
  }
});
