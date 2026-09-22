const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadNavigation(component, platform, pathname = '/') {
  const source = fs.readFileSync(path.join(__dirname, `../components/navigation/${component}.tsx`), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const subscriptions = [];
  const modalCalls = [];
  const pushedRoutes = [];
  let effectDependencies;
  let cleanup;
  let closed = 0;
  const onClose = () => { closed += 1; };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const modules = {
    react: { useEffect: (effect, dependencies) => {
      if (effectDependencies && dependencies.every((value, index) => Object.is(value, effectDependencies[index]))) return;
      cleanup?.();
      cleanup = effect();
      effectDependencies = dependencies;
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Platform: { OS: platform }, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: value => value, absoluteFill: {} },
      BackHandler: { addEventListener: (event, callback) => {
        const subscription = { event, callback, removed: false, remove() { this.removed = true; } };
        subscriptions.push(subscription);
        return subscription;
      } },
    },
    'expo-router': { useRouter: () => ({ push: route => pushedRoutes.push(route) }), usePathname: () => pathname },
    'expo-blur': { BlurView: 'BlurView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView', Text: 'AnimatedText' },
      useAnimatedStyle: factory => factory(),
    },
    '../../constants/theme': { ARCADE: {} },
    './ZuychinLogo': { __esModule: true, default: 'Logo' },
    '../../hooks/useWebModalFocus': { useWebModalFocus: (...args) => modalCalls.push(args) },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    assert(name in modules, `Unexpected module: ${name}`);
    return modules[name];
  } });
  return {
    render: (isOpen = true) => exports.default({ isOpen, onClose }),
    unmount: () => { cleanup?.(); cleanup = undefined; },
    subscriptions, modalCalls, pushedRoutes, onClose,
    closeCount: () => closed,
  };
}

function navigationLinks(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(navigationLinks);
  return [
    ...(node.props?.accessibilityRole === 'link' ? [node] : []),
    ...navigationLinks(node.props?.children),
  ];
}

function allNodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(allNodes);
  return [node, ...allNodes(node.props?.children)];
}

for (const platform of ['web', 'ios', 'android']) {
  test(`${platform} drawer keeps all links in a bounded scroll surface and reserves close space`, () => {
    const navigation = loadNavigation('MobileDrawer', platform);
    const nodes = allNodes(navigation.render());
    assert.equal(nodes.find(node => node.props?.nativeID === 'arcade-mobile-navigation').props.accessibilityLabel, 'Arcade navigation');
    const scroll = nodes.find(node => node.type === 'ScrollView');
    assert(scroll, 'Drawer content must remain scrollable on short screens');
    assert.equal(scroll.props.style.flex, 1);
    assert.equal(scroll.props.style.minHeight, 0);
    assert.equal(navigationLinks(scroll).length, 5);
    for (const link of navigationLinks(scroll)) {
      const label = allNodes(link).find(node => node.type === 'Text');
      assert.equal(label.props.style[0].flex, 1);
      assert.equal(label.props.style[0].minWidth, 0);
    }
    const close = allNodes(scroll).find(node => node.props?.accessibilityLabel === 'Close navigation menu');
    assert(close.props.style.minWidth >= 48);
    assert(close.props.style.minHeight >= 48);
    assert.equal(close.props.style.flexShrink, 0);
    const header = scroll.props.children[0];
    const controls = header.props.children[0];
    const words = header.props.children[1];
    assert.equal(header.props.style.flexDirection, undefined);
    assert.equal(controls.props.style.flexDirection, 'row');
    assert.equal(controls.props.style.justifyContent, 'space-between');
    assert.equal(allNodes(controls).filter(node => node.type === 'Text').length, 0);
    assert.equal(words.props.style.minWidth, 0);
    assert.equal(words.props.style.flexShrink, 0);
    assert.deepEqual(allNodes(words).filter(node => node.type === 'Text').map(node => node.props.children), ['ZUYCHIN', 'ARCADE']);
    for (const label of allNodes(words).filter(node => node.type === 'Text')) {
      assert.equal(label.props.numberOfLines, undefined);
      assert.notEqual(label.props.allowFontScaling, false);
    }
    close.props.onPress();
    assert.equal(navigation.closeCount(), 1);
    navigation.unmount();
  });
}

test('web drawer skips native BackHandler and retains the web modal hook', () => {
  const drawer = loadNavigation('MobileDrawer', 'web');
  assert(drawer.render());
  assert.equal(drawer.subscriptions.length, 0);
  assert.equal(drawer.modalCalls[0][0], true);
  assert.equal(drawer.modalCalls[0][1], 'arcade-mobile-navigation');
  assert.equal(drawer.modalCalls[0][2], drawer.onClose);
  assert.equal(drawer.render(false), null);
  drawer.unmount();
  assert.equal(drawer.subscriptions.length, 0);
});

test('native drawer handles back and cleans subscriptions on close and unmount', () => {
  for (const platform of ['ios', 'android']) {
    const drawer = loadNavigation('MobileDrawer', platform);
    drawer.render();
    drawer.render();
    assert.equal(drawer.subscriptions.length, 1);
    const first = drawer.subscriptions[0];
    assert.equal(first.event, 'hardwareBackPress');
    assert.equal(first.callback(), true);
    assert.equal(drawer.closeCount(), 1);
    assert.equal(drawer.render(false), null);
    assert.equal(first.removed, true);
    drawer.render();
    assert.equal(drawer.subscriptions.length, 2);
    assert.equal(drawer.subscriptions[1].removed, false);
    drawer.unmount();
    assert.equal(drawer.subscriptions[1].removed, true);
  }
});

test('closed native drawers do not register hardware-back handlers', () => {
  for (const platform of ['ios', 'android']) {
    const drawer = loadNavigation('MobileDrawer', platform);
    assert.equal(drawer.render(false), null);
    assert.equal(drawer.subscriptions.length, 0);
    drawer.unmount();
  }
});

for (const component of ['MobileDrawer', 'Sidebar']) {
  test(`${component} marks only the active web link as the current page`, () => {
    const routes = ['/', '/leaderboard', '/profile', '/about', '/privacy'];
    for (const [activeIndex, route] of routes.entries()) {
      const navigation = loadNavigation(component, 'web', route);
      const links = navigationLinks(navigation.render());
      assert.equal(links.length, routes.length);
      for (const [index, link] of links.entries()) {
        assert.equal(link.props['aria-current'], index === activeIndex ? 'page' : undefined);
        assert.equal(link.props['aria-selected'], undefined);
        assert.equal(link.props['aria-pressed'], undefined);
      }
      links[activeIndex].props.onPress();
      assert.deepEqual(navigation.pushedRoutes, [route]);
      if (component === 'MobileDrawer') assert.equal(navigation.closeCount(), 1);
      navigation.unmount();
    }
  });
}

test('native navigation preserves selection without adding web current-page props', () => {
  for (const component of ['MobileDrawer', 'Sidebar']) {
    for (const platform of ['ios', 'android']) {
      const navigation = loadNavigation(component, platform, '/leaderboard');
      const links = navigationLinks(navigation.render());
      assert.equal(links.length, 5);
      for (const [index, link] of links.entries()) {
        assert.equal(link.props.accessibilityState.selected, index === 1);
        assert.equal(link.props['aria-current'], undefined);
      }
      navigation.unmount();
    }
  }
});
