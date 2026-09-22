const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const colours = { text: '#F8F6EE', cyan: '#62D6E8', gold: '#F4C458', ember: '#FF8A48', red: '#FF5E68', bg: '#0C0D12', border: '#424B61', muted: '#9CA6B8' };
const characters = Object.fromEntries(['ghost', 'doc', 'tuco', 'django', 'cheyenne', 'belle'].map(name => [name, { name: name[0].toUpperCase() + name.slice(1) }]));
const filename = path.join(__dirname, '../components/colt/TrainBoard.tsx');
const source = fs.readFileSync(filename, 'utf8');

function harness(game) {
  let cursor = 0;
  const states = [], scrolls = [], exports = {};
  const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
  const modules = {
    react: { useRef: () => ({ current: { scrollTo: value => scrolls.push(value) } }), useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
    '@zuychin-arcade/types': { COLT_CHARACTERS: characters },
    '../ui/NeonButton': { NeonButton: 'Button' },
    '../../constants/theme': { COLT: colours },
    './decision': { coltCarName: (car, count) => car === 0 ? 'Caboose' : car === count - 1 ? 'Locomotive' : `Car ${car + 1}` },
  };
  const result = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics, []);
  vm.runInNewContext(result.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return { scrolls, render() { cursor = 0; return exports.TrainBoard({ game, playerId: 'me' }); } };
}

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const content = node => Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props?.children) : node == null || node === false ? '' : String(node);
const player = (playerId, character, carIndex, level, more = {}) => ({ playerId, displayName: playerId, setupComplete: true, characters: [character], positions: [{ carIndex, level }], lootCounts: [2], ...more });
const base = (more = {}) => ({ trainCars: 3, marshalCar: 2, players: [], turnOrder: [], lootBySpace: {}, ...more });
const scrollNode = tree => nodes(tree).find(node => node.type === 'ScrollView');
const cars = tree => scrollNode(tree).props.children;
const levelNode = (car, level) => nodes(car).find(node => node.type === 'View' && Array.isArray(node.props.children) && node.props.children.some(child => child?.type === 'Text' && content(child) === level));

test('pieces and loot stay in their authoritative car and level', () => {
  const game = base({ players: [player('me', 'ghost', 0, 'roof'), player('Second bandit', 'doc', 1, 'inside')], turnOrder: ['me', 'Second bandit'], lootBySpace: { '0:roof': [{ id: 'p', type: 'purse', value: null }], '1:inside': [{ id: 'j', type: 'jewel', value: 500 }] } });
  const train = cars(harness(game).render());
  assert.match(content(levelNode(train[0], 'ROOF')), /You · Ghost · 2 loot/);
  assert.doesNotMatch(content(levelNode(train[0], 'INSIDE')), /Ghost/);
  assert.match(content(levelNode(train[1], 'INSIDE')), /Second bandit · Doc.*jewel × 1 · \$500 each/);
  assert.match(content(levelNode(train[2], 'INSIDE')), /MARSHAL INSIDE/);
  assert.doesNotMatch(content(levelNode(train[2], 'ROOF')), /MARSHAL/);
});

test('unknown purse artwork and labels are independent of IDs and private player values', () => {
  const game = base({ players: [player('other', 'ghost', 0, 'inside', { lootValue: 9999, hand: ['secret-action'] })], turnOrder: ['other'], lootBySpace: { '0:inside': [{ id: 'secret-purse-250', type: 'purse', value: null }, { id: 'secret-purse-500', type: 'purse', value: null }] } });
  const original = harness(game).render();
  const changed = harness({ ...game, players: [{ ...game.players[0], lootValue: 7777 }], lootBySpace: { '0:inside': game.lootBySpace['0:inside'].map(loot => ({ ...loot, id: 'different-id' })) } }).render();
  assert.equal(JSON.stringify(original), JSON.stringify(changed));
  assert.match(content(original), /purse × 2 · hidden value/);
  assert.doesNotMatch(JSON.stringify(original), /secret-purse|secret-action|9999|7777/);
});

test('unplaced, invalid and removed bandits remain absent, committed-round forfeits remain present', () => {
  const players = [player('Still here', 'doc', 0, 'inside', { forfeited: true }), player('Unplaced', 'ghost', 0, 'inside', { setupComplete: false }), player('Removed', 'ghost', 0, 'inside'), player('Invalid', 'ghost', -1, 'roof'), player('Unknown', 'missing', 0, 'roof')];
  const tree = harness(base({ players, turnOrder: players.filter(p => p.playerId !== 'Removed').map(p => p.playerId) })).render();
  assert.match(content(tree), /Still here · Doc/);
  assert.doesNotMatch(content(tree), /Unplaced|Removed|Invalid|Unknown/);
});

test('car navigation uses measured carriage width, clamps to the train and retains scroll gestures', () => {
  const h = harness(base());
  let tree = h.render();
  const scroll = scrollNode(tree);
  assert.equal(scroll.props.horizontal, true);
  assert.equal(scroll.props.showsHorizontalScrollIndicator, true);
  scroll.props.onLayout({ nativeEvent: { layout: { width: 264 } } });
  scroll.props.onContentSizeChange(808);
  tree = h.render();
  assert.equal(cars(tree)[0].props.style.width, 252);
  assert.equal(nodes(tree).find(n => n.props?.label === 'PREVIOUS CAR').props.disabled, true);
  nodes(tree).find(n => n.props?.label === 'NEXT CAR').props.onPress();
  assert.equal(h.scrolls.at(-1).x, 272);
  tree = h.render();
  nodes(tree).find(n => n.props?.label === 'NEXT CAR').props.onPress();
  assert.equal(h.scrolls.at(-1).x, 544);
  tree = h.render();
  assert.equal(nodes(tree).find(n => n.props?.label === 'NEXT CAR').props.disabled, true);
  scrollNode(tree).props.onScroll({ nativeEvent: { contentOffset: { x: 100 } } });
  tree = h.render();
  nodes(tree).find(n => n.props?.label === 'PREVIOUS CAR').props.onPress();
  assert.equal(h.scrolls.at(-1).x, 0);
  assert(h.scrolls.every(call => call.animated === false));
});

test('long names retain wrapping and all artwork is excluded from input and accessibility', () => {
  const name = 'A very long player name';
  const tree = harness(base({ players: [player(name, 'ghost', 0, 'roof')], turnOrder: [name] })).render();
  const label = nodes(tree).find(n => n.type === 'Text' && content(n).includes(name));
  assert.equal(label.props.numberOfLines, undefined);
  assert.equal(label.props.style.minWidth, 0);
  assert.equal(label.props.style.flex, 1);
  for (const car of cars(tree)) for (const level of ['ROOF', 'INSIDE']) {
    const style = levelNode(car, level).props.style;
    assert.equal(style.height, undefined);
    assert.equal(style.maxHeight, undefined);
    assert.equal(style.overflow, undefined);
  }
  const decorations = nodes(tree).filter(n => n.props?.accessibilityElementsHidden);
  assert(decorations.length > 8);
  for (const node of decorations) {
    assert.equal(node.props.pointerEvents, 'none');
    assert.equal(node.props.importantForAccessibility, 'no-hide-descendants');
    assert(!nodes(node).some(child => child.props?.onPress));
  }
  assert.equal(nodes(tree).filter(n => n.type === 'Button').length, 2);
});
