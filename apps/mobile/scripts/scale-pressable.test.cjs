const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../components/ui/ScalePressable.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function render(platform, props = {}) {
  const jsx = (type, values) => ({ type, props: values });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: platform }, Pressable: 'Pressable' },
    'react-native-reanimated': {
      __esModule: true,
      default: { createAnimatedComponent: () => 'AnimatedPressable' },
      useAnimatedStyle: (factory) => factory(),
      useSharedValue: (value) => ({ value }),
      withSpring: (value) => value,
    },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  } });
  return exports.ScalePressable({ children: 'Choice', ...props }).props;
}

test('web choices expose toggle-button pressed state and never aria-selected', () => {
  for (const selected of [true, false]) {
    const props = render('web', { accessibilityState: { selected } });
    assert.equal(props.accessibilityRole, 'button');
    assert.equal(props['aria-pressed'], selected);
    assert.equal(props['aria-selected'], undefined);
  }
  assert.equal(render('web')['aria-pressed'], undefined);
});

test('web busy and expanded states are explicit without implying a selected choice', () => {
  const props = render('web', { accessibilityState: { busy: true, expanded: false } });
  assert.equal(props['aria-busy'], true);
  assert.equal(props['aria-expanded'], false);
  assert.equal(props['aria-pressed'], undefined);
});

test('either disabled input disables the actual control and its exposed state', () => {
  for (const input of [{ disabled: true }, { accessibilityState: { disabled: true } }, { disabled: false, accessibilityState: { disabled: true } }]) {
    const props = render('web', input);
    assert.equal(props.disabled, true);
    assert.equal(props.accessibilityState.disabled, true);
    assert.equal(props['aria-disabled'], true);
  }
  assert.equal(render('web').disabled, false);
  assert.equal(render('web')['aria-disabled'], false);
});

test('native platforms retain native accessibility state without web ARIA props', () => {
  for (const platform of ['ios', 'android']) {
    const props = render(platform, { accessibilityState: { selected: true, busy: true, expanded: true, disabled: true } });
    assert.equal(props.accessibilityState.selected, true);
    assert.equal(props.accessibilityState.busy, true);
    assert.equal(props.accessibilityState.expanded, true);
    assert.equal(props.accessibilityState.disabled, true);
    assert.equal(props.disabled, true);
    assert.equal(props['aria-pressed'], undefined);
    assert.equal(props['aria-busy'], undefined);
    assert.equal(props['aria-expanded'], undefined);
  }
});

test('optional focus handler forwards the original event without pressing or mutating state', () => {
  for (const platform of ['web', 'ios', 'android']) {
    let focused = null, pressed = 0;
    const event = Object.freeze({ nativeEvent: Object.freeze({ target: 'owned-control' }) });
    const onFocus = value => { focused = value; }, onPress = () => { pressed++; };
    const props = render(platform, { onFocus, onPress, accessibilityState: { selected: true } });
    assert.equal(props.onFocus, onFocus); assert.equal(props.onPress, onPress);
    props.onFocus(event);
    assert.equal(focused, event); assert.equal(pressed, 0);
    assert.equal(props.accessibilityState.selected, true); assert.equal(props.disabled, false);
    assert.equal(render(platform).onFocus, undefined);
  }
});

test('optional test identity reaches the actual button without changing its action or accessible name', () => {
  for (const platform of ['web', 'ios', 'android']) {
    let pressed = 0;
    const onPress = () => pressed++;
    const props = render(platform, { testID: 'libertalia-choice-45-ship%3Aa%3A24', accessibilityLabel: 'AMULET', onPress });
    assert.equal(props.testID, 'libertalia-choice-45-ship%3Aa%3A24');
    assert.equal(props.accessibilityRole, 'button'); assert.equal(props.accessibilityLabel, 'AMULET');
    assert.equal(props.onPress, onPress); assert.equal(pressed, 0);
    props.onPress(); assert.equal(pressed, 1);
    assert.equal(render(platform).testID, undefined);
  }
});
