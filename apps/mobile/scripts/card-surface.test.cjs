const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, extra = {}) {
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'react-native': { View: 'View', StyleSheet: { absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } } },
    ...extra,
  };
  const filename = path.join(__dirname, '../components/ui', name + '.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  return exports;
}

const { CardSurface } = load('CardSurface');
function render(props = {}) { return CardSurface({ children: { type: 'Text', props: { children: 'Readable face' } }, ...props }); }
function face(tree) { return tree.props.children[1]; }

test('surface preserves explicit face footprint and adds depth only outside layout', () => {
  const tree = render({ width: 84, height: 134 });
  assert.equal(tree.props.style.width, 84);
  assert.equal(tree.props.style.height, 134);
  assert.equal(tree.props.style.padding, undefined);
  const edge = tree.props.children[0];
  assert.equal(edge.props.style.position, 'absolute');
  assert.equal(edge.props.style.top, 3);
  assert.equal(edge.props.style.bottom, -3);
  assert.equal(edge.props.style.borderRadius, 8);
  assert.equal(face(tree).props.style.transform, undefined);
});

test('intrinsic content remains unclamped and only the face clips', () => {
  const tree = render();
  assert.equal(tree.props.style.width, undefined);
  assert.equal(tree.props.style.height, undefined);
  assert.equal(tree.props.style.overflow, undefined);
  assert.equal(face(tree).props.style.overflow, 'hidden');
  assert.equal(face(tree).props.children[0].props.children, 'Readable face');
  assert.equal(face(tree).props.accessibilityElementsHidden, undefined);
});

test('opt-in fill carries allocated row height through the face without a fixed content height', () => {
  for (const props of [{}, { selected: true }, { disabled: true }, { width: 84, height: 134 }]) {
    const ordinary = render(props), filled = render({ ...props, fill: true });
    assert.equal(ordinary.props.style.flexGrow, undefined);
    assert.equal(filled.props.style.flexGrow, 1);
    assert.equal(face(filled).props.style.flexGrow, 1);
    for (const key of ['width', 'height', 'minHeight', 'maxHeight', 'flexBasis', 'flexShrink', 'opacity']) {
      assert.equal(filled.props.style[key], ordinary.props.style[key]);
    }
    assert.equal(filled.props.pointerEvents, ordinary.props.pointerEvents);
    assert.equal(face(filled).props.children[0].props.children, 'Readable face');
    assert.deepEqual(face(filled).props.style, face(ordinary).props.style);
    assert.deepEqual(render({ ...props, fill: false }).props.style, ordinary.props.style);
  }
});

test('decoration cannot intercept input or duplicate accessible content', () => {
  const tree = render();
  assert.equal(tree.props.pointerEvents, 'box-none');
  assert.equal(tree.props.accessible, false);
  assert.equal(face(tree).props.pointerEvents, 'box-none');
  for (const layer of [tree.props.children[0], face(tree).props.children[1]]) {
    assert.equal(layer.props.pointerEvents, 'none');
    assert.equal(layer.props.accessible, false);
    assert.equal(layer.props.accessibilityElementsHidden, true);
    assert.equal(layer.props.importantForAccessibility, 'no-hide-descendants');
  }
  assert.equal(tree.props.onPress, undefined);
});

test('material colours and radius are caller owned with offset soft contact shadow', () => {
  const tree = render({ faceColor: '#112233', edgeColor: '#223344', highlightColor: '#334455', radius: 5 });
  assert.equal(face(tree).props.style.backgroundColor, '#112233');
  assert.equal(face(tree).props.style.borderRadius, 5);
  assert.equal(tree.props.children[0].props.style.backgroundColor, '#223344');
  assert.equal(tree.props.children[0].props.style.boxShadow, '0 5px 10px rgba(0,0,0,0.38)');
  assert.match(face(tree).props.style.boxShadow, /inset/);
  const bevel = face(tree).props.children[1].props.style[1];
  assert.equal(bevel.borderTopColor, '#334455');
  assert.equal(bevel.borderLeftColor, '#334455');
  assert.equal(bevel.borderWidth, 1);
});

test('neon material layers stay decorative and never change intrinsic face sizing', () => {
  for (const selected of [false, true]) {
    const tree = render({ selected, highlightColor: '#7395FF' });
    const overlay = face(tree).props.children[1];
    assert.equal(overlay.props.pointerEvents, 'none');
    assert.equal(overlay.props.children[0].type, 'Gradient');
    assert.equal(overlay.props.children[1].props.style.position, 'absolute');
    assert.equal(face(tree).props.style.height, undefined);
    assert.equal(face(tree).props.children[0].props.children, 'Readable face');
    if (selected) assert.match(tree.props.children[0].props.style.boxShadow, /#7395FF/);
  }
});

test('selection and disabled visuals do not change face geometry or disable children', () => {
  const tree = render({ selected: true, disabled: true });
  assert.equal(tree.props.style.opacity, 0.65);
  assert.equal(tree.props.disabled, undefined);
  assert.equal(face(tree).props.style.padding, undefined);
  assert.equal(face(tree).props.children[1].props.style[1].opacity, 1);
  assert.equal(face(tree).props.children[1].props.style[1].borderColor, 'rgba(255,255,255,0.28)');
});

test('depth supports zero and fractional dense-cell values within the bounded range', () => {
  for (const [input, expected] of [[0, 0], [0.5, 0.5], [1, 1], [4, 4], [-1, 0], [50, 4], [NaN, 3]]) {
    const edge = render({ depth: input }).props.children[0];
    assert.equal(edge.props.style.top, expected);
    assert.equal(edge.props.style.bottom, -expected);
  }
});

function glowHarness() {
  let reduced = false;
  let effect;
  let cleanup;
  const pulse = { value: 0 };
  const calls = { cancel: 0, repeat: 0 };
  const { GlowPulse } = load('GlowPulse', {
    react: { useEffect: callback => { effect = callback; } },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduced },
    'react-native-reanimated': {
      default: { View: 'Animated.View' },
      Easing: { quad: 'quad', inOut: value => value },
      useSharedValue: () => pulse,
      useAnimatedStyle: callback => callback(),
      cancelAnimation: value => { assert.equal(value, pulse); calls.cancel++; },
      withTiming: value => value,
      withRepeat: () => { calls.repeat++; return 'running'; },
    },
  });
  return {
    calls, pulse,
    render(value) {
      cleanup?.();
      reduced = value;
      const tree = GlowPulse({ color: '#abcdef' });
      cleanup = effect();
      return tree;
    },
    unmount() { cleanup?.(); cleanup = undefined; },
  };
}

test('reduced-motion pulse is static and still visibly identifies the target', () => {
  const h = glowHarness();
  const tree = h.render(true);
  assert.equal(h.calls.repeat, 0);
  assert.equal(h.pulse.value, 1);
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.accessibilityElementsHidden, true);
  h.unmount();
  assert.equal(h.calls.cancel, 2);
});

test('live reduced-motion changes cancel the loop and resume only when permitted', () => {
  const h = glowHarness();
  h.render(false);
  assert.equal(h.calls.repeat, 1);
  h.render(true);
  assert.equal(h.calls.repeat, 1);
  assert.equal(h.pulse.value, 1);
  assert.equal(h.calls.cancel, 3);
  h.render(false);
  assert.equal(h.calls.repeat, 2);
  h.unmount();
  assert.equal(h.calls.cancel, 6);
});
