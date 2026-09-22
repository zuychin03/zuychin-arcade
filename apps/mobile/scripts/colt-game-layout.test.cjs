const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/colt-express/game.tsx'), 'utf8');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['Section', 'ProgramCards', 'scopedActionMessage'].includes(node.name?.text));
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const screenExports = {};
const code = ts.transpileModule(declarations.map(node => 'export ' + node.getText(ast)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(code, { exports: screenExports, require: () => ({ jsx, jsxs: jsx }), View: 'View', Text: 'Text', CardSurface: 'CardSurface', ActionArtwork: 'ActionArtwork', MaterialCommunityIcons: 'Icon', Platform: { OS: 'web' },
  useWindowDimensions: () => ({ fontScale: 1 }), useState: initial => [initial, () => {}],
  useIntrinsicCardHeight: () => ({ forCard: () => ({ minimumHeight: 0, measurementKey: 'layout', onMeasure: () => {} }) }),
  CardGrid: props => jsx('Grid', { ...props, children: props.items.map((item, index) => props.renderItem(item, 300, index)) }),
  C: { text: '#fff', gold: '#ffd', panel: '#222', border: '#666', ember: '#f84', cyan: '#6de' }, body: { fontSize: 15 }, secondary: { fontSize: 14 }, COLT_CHARACTERS: { ghost: { name: 'Ghost' }, doc: { name: 'Doc' } }, coltActionIcons: { shoot: 'pistol', move: 'arrow-left-right' },
});
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const content = node => Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props?.children) : node == null || node === false ? '' : String(node);
const players = [{ playerId: 'one', displayName: 'First player', characters: ['ghost', 'doc'] }, { playerId: 'two', displayName: 'Second player', characters: ['doc'] }];
const game = (program, more = {}) => ({ program, players, executionIndex: 0, phase: 'programming', status: 'playing', ...more });
const faceDown = (playerId = 'one') => ({ playerId, action: null, ownerBandit: null, faceUp: false, cover: false });

test('concealed program faces are identical and never derive the unknown action or bandit', () => {
  const tree = screenExports.ProgramCards({ game: game([faceDown(), faceDown('two')]) });
  const faces = nodes(tree).filter(node => node.type === 'CardSurface');
  assert.equal(faces.length, 2);
  assert.equal(JSON.stringify(faces[0]), JSON.stringify(faces[1]));
  assert.equal(content(faces[0]), 'FACE DOWN');
  assert.doesNotMatch(JSON.stringify(faces), /Ghost|Doc|pistol|arrow-left-right/);
  assert.equal(nodes(tree).filter(node => node.type === 'ActionArtwork').length, 0);
  assert.match(content(tree), /First player.*Second player/);
  for (const frame of [{ ...faceDown(), ownerBandit: 0 }, { ...faceDown(), action: 'shoot', ownerBandit: 0 }]) {
    const rendered = screenExports.ProgramCards({ game: game([frame]) });
    assert.doesNotMatch(JSON.stringify(rendered), /Ghost|pistol|SHOOT/);
  }
});

test('revealed program retains ordered actions, public owner, Cover and noncolour execution status', () => {
  const program = [{ playerId: 'one', action: 'shoot', ownerBandit: 1, faceUp: true, cover: true }, { playerId: 'two', action: 'move', ownerBandit: 0, faceUp: true, cover: false }, faceDown()];
  const tree = screenExports.ProgramCards({ game: game(program, { phase: 'pending_choice', executionIndex: 1 }) });
  assert.match(content(tree), /1\. RESOLVED.*SHOOT.*Doc.*First player · COVER.*2\. RESOLVING NOW.*MOVE.*Doc.*3\. QUEUED.*FACE DOWN/);
  const faces = nodes(tree).filter(node => node.type === 'CardSurface');
  assert.equal(faces[0].props.selected, false);
  assert.equal(faces[1].props.selected, true);
  assert.equal(nodes(tree).filter(node => node.props.onPress).length, 0);
  const terminal = screenExports.ProgramCards({ game: game(program, { phase: 'game_over', status: 'game_over', executionIndex: 1 }) });
  assert.doesNotMatch(content(terminal), /RESOLVING NOW/);
});

test('program names and status use expanding live text without an extra section frame', () => {
  const tree = screenExports.ProgramCards({ game: game([{ ...faceDown(), playerId: 'long' }], { players: [{ playerId: 'long', displayName: 'A long display name that wraps', characters: [] }] }) });
  assert.equal(tree.props.style.borderWidth, undefined);
  assert(content(tree).includes('A long display name that wraps'));
  for (const node of nodes(tree)) {
    assert.equal(node.props.style?.height, undefined);
    assert.equal(node.props.style?.maxHeight, undefined);
    if (node.type === 'Text') assert.equal(node.props.numberOfLines, undefined);
  }
  const iconContainer = nodes(tree).find(node => node.props.accessibilityElementsHidden);
  assert.equal(iconContainer.props.pointerEvents, 'none');
});

test('desktop columns are selected using measured available width and font scale', () => {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'sideBySide') expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert(expression);
  const wide = (contentWidth, fontScale, cards = 3) => vm.runInNewContext(expression, { contentWidth, fontScale, mine: { hand: Array(cards) } });
  for (const width of [0, 292, 347, 386, 740]) assert.equal(wide(width, 1), false);
  assert.equal(wide(1072, 1), true);
  assert.equal(wide(1072, 1, 0), false);
  assert.equal(wide(1072, 2), false);
  assert.equal(wide(1072, 1.5), false);
  assert.match(source, /Math\.min\(1100, event\.nativeEvent\.layout\.width\) - 28/);
});

test('train precedes hand and keeps its direct scroll-content measurement and return control', () => {
  const screen = source.slice(source.indexOf('export default function'));
  assert(screen.indexOf('id="colt-train"') < screen.indexOf('title="YOUR PRIVATE HAND"'));
  assert.match(screen, /<View onLayout=\{event => \{ trainY\.current = event\.nativeEvent\.layout\.y; \}\}><Section title="THE TRAIN" id="colt-train"/);
  assert.match(screen, /label="RETURN TO DECISION"[^>]*onPress=\{focusDecision\}/);
  assert.match(screen, /scroll\.current\?\.scrollTo\(\{ y: trainY\.current, animated: false \}\)/);
  assert.match(screen, /flexDirection: sideBySide \? 'row' : 'column'/);
});

test('card destinations retain web focus and parent-relative native measurements', () => {
  for (const id of ['colt-hand', 'colt-reserve', 'colt-program']) assert(source.includes(`id="${id}"`));
  for (const label of ['CHOOSE FROM YOUR HAND', 'CHOOSE RESERVE CARD', 'VIEW SHARED PROGRAM']) assert(source.includes(`label="${label}"`));
  assert.match(source, /cardsY\.current \+ \(section === 'hand' \? handY\.current : programY\.current\)/);
  assert.match(source, /findNodeHandle\(target\.current\)/);
  assert.match(source, /if \(Platform\.OS !== 'web'\) \{ jumpToCards\('hand'\); return; \}/);
  assert.match(source, /minCardWidth=\{240\} maxCardWidth=\{320\}/);
});

test('action feedback cannot cross a session, phase or subsequent revision', () => {
  const scope = { token: 'seat', roomCode: 'ROOM', phase: '1:playing:programming', revision: 5 };
  const read = current => screenExports.scopedActionMessage('Program action accepted.', scope, current);
  assert.equal(read({ ...scope, revision: 6 }), 'Program action accepted.');
  for (const changed of [{ token: 'other' }, { roomCode: 'OTHER' }, { phase: '1:game_over:game_over' }, { revision: 7 }, { revision: 4 }]) assert.equal(read({ ...scope, ...changed }), null);
  assert.equal(screenExports.scopedActionMessage('Program action accepted.', null, scope), null);
  assert.equal(screenExports.scopedActionMessage('Action not accepted: stale. Refreshing the table.', null, scope), 'Action not accepted: stale. Refreshing the table.');
});

function measuredProgramHarness() {
  let cursor = 0, fontScale = 1;
  const cells = [];
  const react = {
    useCallback: callback => callback,
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
  };
  const modules = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', Platform: { OS: 'web' } } };
  function load(file) {
    const exports = {};
    const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    assert.deepEqual(result.diagnostics, []);
    vm.runInNewContext(result.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
    return exports;
  }
  modules['../../hooks/useMeasuredLayoutWidth'] = load('hooks/useMeasuredLayoutWidth.ts');
  const hook = load('hooks/useIntrinsicCardHeight.ts'), grid = load('components/ui/CardGrid.tsx'), result = {};
  vm.runInNewContext(code, {
    exports: result, require: () => ({ jsx, jsxs: jsx }), ...react, ...hook, ...grid,
    useWindowDimensions: () => ({ fontScale }), View: 'View', Text: 'Text', CardSurface: 'CardSurface', ActionArtwork: 'ActionArtwork', MaterialCommunityIcons: 'Icon', Platform: { OS: 'web' },
    C: { text: '#fff', gold: '#ffd', panel: '#222', border: '#666', ember: '#f84', cyan: '#6de' }, body: { fontSize: 15 }, secondary: { fontSize: 14 }, COLT_CHARACTERS: { ghost: { name: 'Ghost' }, doc: { name: 'Doc' } },
  });
  return { render(state, scale = 1) { cursor = 0; fontScale = scale; return result.ProgramCards({ game: state }); } };
}
const layoutEvent = (width, height = 0) => ({ nativeEvent: { layout: { width, height } } });
const entries = tree => nodes(tree).filter(node => node.props.nativeID?.startsWith('colt-program-card-'));
const gridIn = tree => nodes(tree).find(node => node.props.style?.flexDirection === 'row' && node.props.onLayout);

test('programme tracks stay equal for partial rows, scale and resize without relying on caption heights', () => {
  const h = measuredProgramHarness();
  for (const count of [0, 1, 2, 3, 4, 7]) {
    const state = game(Array.from({ length: count }, () => faceDown()));
    let tree = h.render(state); gridIn(tree).props.onLayout(layoutEvent(633)); tree = h.render(state);
    const grid = gridIn(tree);
    assert.equal(grid.props.children.length, count);
    assert(grid.props.children.every(wrapper => wrapper.props.style.width === 310.5));
    assert(grid.props.children.every(wrapper => wrapper.props.style.flexGrow === undefined));
    assert.equal(grid.props.style.alignItems, 'stretch');
    assert.deepEqual(Array.from(grid.props.children, wrapper => wrapper.key), Array.from({ length: count }, (_, index) => String(index)));
    tree = h.render(state, 2); assert(gridIn(tree).props.children.every(wrapper => wrapper.props.style.width === 633));
    tree = h.render(state); gridIn(tree).props.onLayout(layoutEvent(264)); tree = h.render(state);
    assert(gridIn(tree).props.children.every(wrapper => wrapper.props.style.width === 264));
    assert.equal(nodes(tree).filter(node => node.props.onPress).length, 0);
  }
});

test('programme faces and statuses measure unstretched content independently of long owner captions', () => {
  const h = measuredProgramHarness();
  const state = game([{ playerId: 'one', action: 'shoot', ownerBandit: 1, faceUp: true, cover: true }, faceDown('two')], { players: [{ ...players[0], displayName: 'LongPlayerNameXXXXXXX' }, players[1]], phase: 'pending_choice' });
  let tree = h.render(state); gridIn(tree).props.onLayout(layoutEvent(633)); tree = h.render(state);
  entries(tree)[0].props.onLayout(layoutEvent(310.5)); tree = h.render(state);
  const firstEntries = entries(tree);
  firstEntries.forEach((entry, index) => {
    const [status, face, caption] = entry.props.children;
    status.props.children.props.onLayout(layoutEvent(310.5, index ? 22 : 44));
    face.props.children.props.children.props.onLayout(layoutEvent(310.5, index ? 202 : 231));
    assert.equal(caption.props.onLayout, undefined);
    assert.equal(face.props.children.props.fill, true);
    assert.equal(face.props.children.props.children.props.style.flexGrow, undefined);
    assert.equal(face.props.children.props.children.props.style.minHeight, undefined);
  });
  tree = h.render(state);
  for (const entry of entries(tree)) {
    assert.equal(entry.props.children[0].props.style.minHeight, 44);
    assert.equal(entry.props.children[1].props.style.minHeight, 231);
    assert.equal(entry.props.style.flexGrow, undefined);
  }
  assert.match(content(tree), /SHOOT.*Doc.*LongPlayerNameXXXXXXX · COVER.*FACE DOWN.*Second player/);
  const before = entries(tree)[0].props.children[1].props.children.props.children;
  gridIn(tree).props.onLayout(layoutEvent(280)); tree = h.render(state);
  entries(tree)[0].props.onLayout(layoutEvent(280)); tree = h.render(state);
  assert.equal(entries(tree)[0].props.children[1].props.style.minHeight, 0);
  before.props.onLayout(layoutEvent(310.5, 999)); tree = h.render(state);
  assert.equal(entries(tree)[0].props.children[1].props.style.minHeight, 0);
  entries(tree).forEach((entry, index) => entry.props.children[1].props.children.props.children.props.onLayout(layoutEvent(280, index ? 250 : 300)));
  tree = h.render(state); assert(entries(tree).every(entry => entry.props.children[1].props.style.minHeight === 300));
  entries(tree).forEach(entry => entry.props.children[1].props.children.props.children.props.onLayout(layoutEvent(280, 180)));
  tree = h.render(state); assert(entries(tree).every(entry => entry.props.children[1].props.style.minHeight === 180));
  assert.equal(nodes(tree).filter(node => node.props.onPress).length, 0);
});

test('hand and reserve use bounded fluid tracks with exact identities and existing submission callbacks', () => {
  const grids = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'CardGrid') grids.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(grids.length, 3);
  for (const grid of grids) {
    const text = grid.getText(ast);
    assert.match(text, /minCardWidth=\{240\} maxCardWidth=\{320\} gap=\{12\} textScale=\{fontScale\}/);
  }
  const reserve = grids.find(node => node.getText(ast).includes('items={mine.reserveOptions}')).getText(ast);
  const hand = grids.find(node => node.getText(ast).includes('items={mine.hand}')).getText(ast);
  for (const grid of [reserve, hand]) { assert.match(grid, /keyExtractor=\{card => card.id\}/); assert.match(grid, /<ActionCard fluid/); }
  assert.match(reserve, /sendAction\('reserve', \{ cardId: card.id \}, 'Reserve card', game.revision\)/);
  assert.match(hand, /id=\{'colt-hand-' \+ card.id\}/);
  assert.match(hand, /disabled=\{locked \|\| !mine.canProgram \|\| card.action === 'bullet'\}/);
  assert.match(hand, /setCoverShoot\(card.id\); else play\(card.id\)/);
});
