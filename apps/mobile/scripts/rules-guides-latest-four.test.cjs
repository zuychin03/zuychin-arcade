const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const palette = { bg: '#101020', surface: '#202030', panel: '#303040', border: '#505060', accent: '#eeeeff', secondary: '#ffeedd', text: '#ffffff', muted: '#cccccc' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

function load(game, file, textScale = 2) {
  const filename = path.resolve(__dirname, '../components', game, file);
  const exports = {};
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', useWindowDimensions: () => ({ width: 320, fontScale: 2 }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { FEED_THE_KRAKEN_CHARACTERS: ['captain'], CARTOGRAPHERS_CARDS: [{ id: 'sample' }], CARTOGRAPHERS_OBJECTIVES: [{ id: 'objective' }], CARTOGRAPHERS_SEASONS: [{ name: 'Spring', threshold: 8, edicts: [0, 1] }] },
    '../../constants/theme': { DIXIT: palette },
    './palette': { KRAKEN: palette, TELESTRATIONS: palette, CARTOGRAPHERS: palette },
    './Controls': { typography: { title: {}, heading: {}, body: {}, muted: {} } },
    '../ui/RulesReferenceSheet': { RulesReferenceSheet: 'Rulebook' },
    '../ui/CardSurface': { CardSurface: 'Surface' },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: () => ({ textRef: {}, onTextLayout() {}, textScale }) },
    '../ui/CardGrid': { CardGrid: ({ items, renderItem }) => jsx('Grid', { children: items.map(renderItem) }) },
    './NavigationCard': { NavigationCard: 'NavigationCard' },
    './NavigationFlow': { NavigationFlow: 'NavigationFlow' },
    './CharacterCard': { CharacterCard: 'CharacterCard' },
    './RelayDiagram': { RelayDiagram: 'RelayDiagram' },
    './Drawing': { Drawing: 'Drawing' },
    './DreamCard': { DreamCard: 'DreamCard' },
    './ExploreCard': { ExploreCard: 'ExploreCard' },
    './ObjectiveCard': { ObjectiveCard: 'ObjectiveCard' },
    './MapBoard': { MapBoard: 'MapBoard', TERRAIN: { forest: { icon: 'pine-tree', colour: '#427958', label: 'Forest' } } },
    './geometry': { emptyChart: side => ({ side, cells: [] }) },
  };
  vm.runInNewContext(compiled.outputText, { exports, require: name => {
    if (name === './RulesGuide') return load(game, 'RulesGuide.tsx');
    assert(name in modules, name);
    return modules[name];
  } });
  return exports;
}
const cases = [['kraken', 'KrakenReferenceSheet'], ['telestrations', 'TelestrationsReferenceSheet'], ['cartographers', 'CartographersReferenceSheet'], ['dixit', 'DixitReferenceSheet']];
const preserved = {
  "kraken": [
    "Quick voyage: 5–11 players. Long voyage: 7–11. Sailors want the blue destination, pirates the red destination. The cult wins at the yellow destination or when its leader is fed to the Kraken. Keep faction cards, private observations and navigation hands hidden.",
    "The colour follows the matching route on the chart. Resolve a landing first, then the card’s effect. These three examples use the same faces as your hand.",
    "Red, blue and yellow routes can bend around the coast. Use the displayed outgoing destinations, not a guessed direction. On the long map, crossing the supply boundary replenishes eligible holdings towards three guns, limited by the shared supply.",
    "Everyone starts with three guns. A completed navigation gives off-duty signs to the applicable navigation officers, according to the initial crew size. Previous off-duty signs return. Off duty restricts appointment as lieutenant or navigator, not holding captaincy; restrictions relax when too few eligible officers remain.",
    "Cabin: the captain privately inspects a current faction. Flogging: reveal a faction the target does not belong to. Tongue: the target cannot speak words or become captain, but can still contribute guns. Feeding: the target goes overboard. Feeding the cult leader wins immediately for the cult.",
    "Drunk passes captaincy to an eligible player with the smallest navigation résumé, breaking ties clockwise. Armed gives the navigator one supply gun; disarmed removes one if available. Mermaid privately shows a chosen player the shuffled last three discarded cards. Telescope lets a chosen player inspect the top card and keep or discard it. Yellow uprising resolves a ritual: conversion, a secret stash of guns, or a cult search. Cult searches inspect original allegiance; normal cabin inspection sees current allegiance. A converted player joins the cult and learns its leader.",
    "Use the private panel away from other players’ view. Pirate knowledge, leader knowledge and conversion information appear only when the server permits them. Conversion immunity and negative faction clues are public. Do not infer a leader from a waiting screen.",
    "During a cult ritual, every player aboard completes a private step. Some players may have a secret choice; others simply confirm. Nothing settles until everyone has responded. This digital privacy step keeps a missing or ineligible hidden role from being exposed by the waiting screen.",
    "Priority passes clockwise. Use a character only in its offered window, or pass and preserve it. Revealing normally spends the ability; a mentor can restore another revealed character. The app enforces targets and gun limits.",
    "A navigator may refuse and go overboard; the captain appoints a replacement with a fresh navigation draw and no new mutiny. A fed or refusing player can still win with their faction. Leaving explicitly forfeits immediately; a disconnected seat forfeits after the reconnection grace period. Forfeiture cannot trigger a feeding victory and removes that seat’s right to win. The server settles an interrupted committed action without exposing its secret cards. The voyage may continue with fewer players.",
    "Private local digital prototype. Original code-native chart, no publisher artwork. Clockwise character priority and automated interruption settlement are digital adaptations. Speech restrictions rely on players honouring them outside the app."
  ],
  "telestrations": [
    "4–12 players, three rounds. Draw what you read, guess what you see, and enjoy the unexpected changes. No drawing skill required.",
    "Choose one of your three original prompt offers. With a shared category, invent your own secret within it instead. Do not say it aloud or show other players.",
    "The server assigns the right page. Alternate drawing and guessing until every book returns to its owner with a guess last. The selected passing direction applies to everyone.",
    "Draw only pictures, with no letters or numbers. Do not leave a blank page. Guess the previous drawing, not an earlier word you remember. A guess cannot be empty or just a question mark.",
    "Lock in when ready. Everyone finishes before the books pass together. This 2025 edition has no countdown. Saved drafts return after reconnecting; keep the page open if work has not saved yet.",
    "Each owner reveals their book in order, starting with the secret. Once the last page is visible, the owner can review any page and make the human judgements below.",
    "Points settle only after every book is scored. After three full rounds, the highest total wins. Tied leaders share the win. The app never decides whether two ideas mean the same thing.",
    "Leaving, or missing the reconnect grace period, immediately forfeits your seat. An unfinished round is cancelled, including its provisional points, and starts again with the remaining players. Settled scores stay. Fewer than four players ends the game without a winner.",
    "Private prototype of the 2025 12-player rules. Digital adaptations: 72 original prompts in a shuffled pool, exhausted before reuse; three offers per player, three casual rounds, and the forfeit policy above."
  ],
  "dixit": [
    "3–12 storytellers. Reach 30 points, then finish that round. The highest score wins; tied leaders share the win.",
    "The storyteller chooses one image from their hand and gives a clue. A word, a phrase or a short quotation can work. Aim for a clue that some people understand, but not everyone.",
    "Everyone else secretly chooses one image that could fit the clue. The table shuffles those images with the storyteller’s image. You cannot see who contributed each one yet.",
    "Place both votes on one image, or split them across two. You cannot vote for your own image. The storyteller does not vote. Votes stay secret until everyone has locked theirs in.",
    "In every case, each vote attracted by your own image adds 1 point. There is no cap on these decoy points. “Every vote correct” means both votes from every voter, not just one correct vote each.",
    "Use seven cards each instead of six. Each non-storyteller submits two images, making a five-image table. Both of your images are ineligible for your votes. The same two-vote scoring applies.",
    "The first inspired player volunteers to tell the first story. After each reveal, everyone confirms they are ready. Refill hands, then move the storyteller clockwise. There is no countdown.",
    "Leaving or failing to reconnect before the grace period expires forfeits your seat. An unfinished round is cancelled without points; settled points stay. With fewer than three players, the game ends without a winner.",
    "This private prototype follows the 2024 Odyssey base rules with original illustrations. Older optional voting, Party and Team variants are not part of this edition."
  ]
};

test('all four rulebooks use the shared modal, complete palette, dismissal and disclosure contract', () => {
  for (const [game, name] of cases) {
    const render = load(game, 'ReferenceSheet.tsx')[name];
    const onClose = () => {};
    assert.equal(render({ visible: false, onClose }), null);
    const tree = render({ visible: true, onClose });
    assert.equal(tree.type, 'Rulebook');
    assert.equal(tree.props.onClose, onClose);
    assert.equal(tree.props.visible, true);
    for (const key of ['background', 'surface', 'panel', 'border', 'accent', 'secondary', 'muted', 'text']) assert.equal(typeof tree.props.palette[key], 'string');
    assert(tree.props.sections.length >= 3);
    for (const chapter of tree.props.sections) {
      assert(chapter.title && chapter.icon && chapter.entries.length);
      for (const entry of chapter.entries) assert(entry.title && entry.body);
    }
    assert(nodes(tree).some(node => node.props.testID === game + '-rules-guide'));
    assert(!nodes(tree).some(node => node.type === 'Modal'));
  }
});

test('migration retains every original detailed paragraph in the guide or disclosure chapters', () => {
  for (const [game, name] of cases.filter(([game]) => game in preserved)) {
    const tree = load(game, 'ReferenceSheet.tsx')[name]({ visible: true, onClose() {} });
    const content = JSON.stringify(tree);
    for (const paragraph of preserved[game]) assert(content.includes(paragraph), game + ': missing ' + paragraph);
  }
});

test('each guide retains distinct live game pieces and only public synthetic examples', () => {
  const trees = Object.fromEntries(cases.map(([game, name]) => [game, load(game, 'ReferenceSheet.tsx')[name]({ visible: true, onClose() {} })]));
  assert.equal(nodes(trees.kraken).filter(node => node.type === 'NavigationCard').length, 3);
  assert(nodes(trees.kraken).some(node => node.type === 'NavigationFlow'));
  assert(nodes(trees.kraken).some(node => node.type === 'CharacterCard'));
  const drawing = nodes(trees.telestrations).find(node => node.type === 'Drawing');
  assert.equal(drawing.props.drawing.strokes.length, 3);
  assert(drawing.props.drawing.strokes.every(stroke => stroke.color === 1), 'Examples use dark ink on white paper');
  assert(drawing.props.drawing.strokes.every(stroke => stroke.points.every(point => point.every(value => value >= 0 && value <= 4095))));
  assert(nodes(trees.telestrations).some(node => node.type === 'RelayDiagram'));
  const maps = nodes(trees.cartographers).filter(node => node.type === 'MapBoard');
  assert.deepEqual(maps.map(node => node.props.side), ['C', 'D']);
  assert(maps.every(node => !node.props.interactive && !node.props.onCell));
  assert(nodes(trees.cartographers).some(node => node.type === 'ExploreCard'));
  assert(nodes(trees.cartographers).some(node => node.type === 'ObjectiveCard'));
  const dreams = nodes(trees.dixit).filter(node => node.type === 'DreamCard');
  assert.deepEqual(dreams.map(node => node.props.cardId), ['dream-01', 'dream-02']);
  assert(dreams.every(node => !node.props.onPress && node.props.width <= 160));
});

test('relay steps grow with text instead of clipping inside narrow illustrated panels', () => {
  for (const textScale of [1, 2, 3]) {
    const tree = load('telestrations', 'RelayDiagram.tsx', textScale).RelayDiagram();
    const cells = nodes(tree).filter(node => node.props?.style?.flexBasis);
    assert.equal(cells.length, 3);
    for (const cell of cells) {
      assert.equal(cell.props.style.flexBasis, 80 * textScale + 32);
      assert.equal(cell.props.style.maxWidth, '100%');
      assert.equal(cell.props.style.flexShrink, 1);
    }
    const label = nodes(tree).find(node => node.type === 'Text' && node.props.children === 'Secret prompt');
    assert(label.props.ref); assert.equal(typeof label.props.onLayout, 'function');
    assert.equal(label.props.numberOfLines, undefined);
  }
});
