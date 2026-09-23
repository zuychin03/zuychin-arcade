const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const bangConstants = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../../packages/types/src/bang-constants.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: bangConstants });

const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const colours = { bg: '#111', panel: '#222', surface: '#333', text: '#fff', border: '#555', gold: '#ffc', red: '#f99', sand: '#ffd', muted: '#ccc', sky: '#cff', violet: '#ddf', ember: '#fc9' };

function render(game, name, fontScale, measuredScale = fontScale) {
  const filename = path.join(__dirname, `../components/${game}/RulesGuide.tsx`);
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 320, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { BANG_CHARACTERS: bangConstants.BANG_CHARACTERS },
    './CharacterArtwork': { BangCharacterArtwork: 'CharacterArtwork' },
    '../../constants/theme': { BANG: colours, LIBERTALIA: colours, COLT: colours },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: (baseFontSize, nativeScale) => {
      assert.equal(baseFontSize, 16);
      assert.equal(nativeScale, fontScale);
      return { textRef: { current: null }, onTextLayout() {}, textScale: measuredScale };
    } },
    './Card': { BangCardView: 'BangCardView', BANG_ROLE_GUIDE: { outlaw: { name: 'Outlaw', goal: 'Eliminate the Sheriff.' }, renegade: { name: 'Renegade', goal: 'Be the only survivor.' } } },
    './CrewCard': { CrewCard: 'CrewCard' },
    './LibertaliaArtwork': { LibertaliaLootArtwork: 'LootArtwork' },
    './ActionArtwork': { ActionArtwork: 'ActionArtwork' },
    './TrainBoard': { BanditPiece: 'BanditPiece' },
    './decision': { COLT_ACTION_HELP: { move: 'Move at execution.', rob: 'Rob at execution.', shoot: 'Shoot at execution.' } },
    '../ui/CardSurface': { CardSurface: 'CardSurface' },
    '../ui/CardGrid': { CardGrid: props => jsx('Grid', { ...props, children: props.items.map((item, i) => props.renderItem(item, 208, i)) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  return exports[name]();
}

for (const scale of [1, 2]) {
  for (const [game, name] of [['bang', 'BangRulesGuide'], ['libertalia', 'LibertaliaRulesGuide'], ['colt', 'ColtRulesGuide']]) {
    test(`${game}: guide is labelled, read-only and passes ${scale}x text scale to its card layout`, () => {
      const tree = render(game, name, scale), all = nodes(tree);
      assert.equal(tree.props.nativeID, `${game}-rules-guide`);
      assert.match(text(tree), /[Ee]xample|Illustrative/);
      assert(all.every(node => !node.props?.onPress && !node.props?.onSubmitEditing));
      assert(all.filter(node => node.type === 'Grid').every(node => node.props.textScale === scale));
      assert(all.filter(node => node.type === 'Text').every(node => node.props.style.fontSize >= 16));
      assert(all.filter(node => node.type === 'Text').every(node => !node.props.numberOfLines));
    });
  }
}

test('BANG explains teams, life-linked hand limit and distance with actual static cards', () => {
  const tree = render('bang', 'BangRulesGuide', 1);
  assert.match(text(tree), /Sheriff \+ Deputies/);
  assert.match(text(tree), /at most three cards/);
  assert.match(text(tree), /Panic! still requires distance 1/);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'BangCardView').map(node => node.props.card.name), ['bang', 'mustang']);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'CharacterArtwork').map(node => node.props.character).sort(), Object.keys(bangConstants.BANG_CHARACTERS).sort());
});

test('Libertalia distinguishes rank direction, night persistence and three voyages', () => {
  const tree = render('libertalia', 'LibertaliaRulesGuide', 1);
  assert.match(text(tree), /Day: low rank to high/);
  assert.match(text(tree), /Dusk: high rank to low/);
  assert.match(text(tree), /crew from previous days/);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'CrewCard').map(node => node.props.rank), [8, 12]);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'LootArtwork').map(node => node.props.kind), ['chest', 'barrel']);
});

test('Colt separates commitment from execution and represents both train levels', () => {
  const tree = render('colt', 'ColtRulesGuide', 1);
  assert.match(text(tree), /Nobody moves yet/);
  assert.match(text(tree), /roof and interior is a separate space/);
  assert.match(text(tree), /Received bullets are useless cards/);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'ActionArtwork').map(node => node.props.action), ['move', 'rob', 'shoot', 'bullet']);
  assert(nodes(tree).some(node => node.type === 'BanditPiece' && node.props.marshal));
});

test('Colt measures its 16px body anchor and grows the card layout for CSS text enlargement', () => {
  const tree = render('colt', 'ColtRulesGuide', 1, 2), all = nodes(tree);
  const anchor = all.find(node => node.type === 'Text' && typeof node.props.onLayout === 'function');
  assert(anchor);
  assert.equal(anchor.props.style.fontSize, 16);
  assert.match(text(anchor), /Nobody moves yet/);
  assert(all.filter(node => node.type === 'Grid').every(node => node.props.textScale === 2));
});
