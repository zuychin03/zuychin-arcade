const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { coltTargetConfig, CARD_SIZING_LIMITS, CARD_SIZING_SOURCES, sizingSourceHashes, sizingBudget, assertSizingCommand, sizingJournals, assertSizingJournals, recordSizingCommand, classifySizing, assertSizingStable, sizingScreenshot, measureSizing, sizingComplete } = require('./colt-ui-smoke.cjs');
const config = () => ({ COLT_UI_TARGET: 'card-sizing', COLT_UI_PLAYERS: '2', COLT_UI_OUTPUT: path.resolve('unused-test-output'), QA_STATIC_ROOT: path.resolve('unused-test-export'), QA_EXPECTED_WEB_SHA256: 'a'.repeat(64) });
const box = (left, top, width = 260, height = 300) => ({ left, top, width, height, right: left + width, bottom: top + height });
const card = (index, left, top, width = 260, height = 300) => ({ index, root: box(left, top, width, height + 4), face: box(left, top, width, height), edge: box(left, top + 3, width, height), images: [{ complete: true, naturalWidth: 320 }], captions: [] });

test('explicit target preserves ordinary two/three-player defaults and rejects unknown or conflicting modes', () => {
  assert.deepEqual(coltTargetConfig({}), { target: 'full-match', counts: [2, 3] });
  assert.deepEqual(coltTargetConfig({ COLT_UI_PLAYERS: '3' }), { target: 'full-match', counts: [3] });
  assert.deepEqual(coltTargetConfig(config()), { target: 'card-sizing', counts: [2] });
  for (const target of ['', 'sizing', 'fixture', 'CARD-SIZING']) assert.throws(() => coltTargetConfig({ ...config(), COLT_UI_TARGET: target }));
  for (const count of [undefined, '3', '2,3', '02']) assert.throws(() => coltTargetConfig({ ...config(), COLT_UI_PLAYERS: count }));
  for (const key of ['COLT_UI_FIXTURES', 'COLT_UI_CASES', 'COLT_UI_SCENARIO', 'COLT_UI_MAX_COMMANDS', 'COLT_UI_CAPTURE_LIMIT']) assert.throws(() => coltTargetConfig({ ...config(), [key]: 'true' }));
  for (const key of ['COLT_UI_OUTPUT', 'QA_STATIC_ROOT', 'QA_EXPECTED_WEB_SHA256']) assert.throws(() => coltTargetConfig({ ...config(), [key]: '' }));
  for (const url of ['https://example.com', 'http://user:pass@localhost:8081', 'http://localhost:8081/game', 'http://localhost:8081/?fixture=1']) assert.throws(() => coltTargetConfig({ ...config(), COLT_WEB_URL: url }));
});

test('caps reject the next command/capture at their boundary and reserve a failed-capture PNG', () => {
  assert.deepEqual(CARD_SIZING_LIMITS, { commands: 32, milliseconds: 480000, images: 80, calibrations: 2 });
  const receipt = { actions: Array(31), attempts: Array(78) };
  sizingBudget(receipt, 100, 479999, 'command'); sizingBudget(receipt, 100, 479999, 'capture');
  assert.throws(() => sizingBudget({ ...receipt, actions: Array(32) }, 0, 1));
  assert.throws(() => sizingBudget({ ...receipt, attempts: Array(79) }, 0, 1, 'capture'));
  assert.throws(() => sizingBudget(receipt, 0, 480000, 'capture'));
});

test('exact emitted identity and one acknowledgement must match the next canonical revision', () => {
  const proof = { before: 2, after: 3, revision: 2, accepted: { action: 'reserve', revision: 3 }, sent: [{ event: 'colt:reserve', payload: { cardId: 'owner-card-4', expectedRevision: 2 } }], action: 'reserve', payload: { cardId: 'owner-card-4' } };
  assertSizingCommand(proof);
  for (const patch of [{ after: 4 }, { accepted: { action: 'program', revision: 3 } }, { accepted: { action: 'reserve', revision: 4 } }, { sent: [] }, { sent: [...proof.sent, ...proof.sent] }, { payload: { cardId: 'same-label-different-id' } }]) assert.throws(() => assertSizingCommand({ ...proof, ...patch }));
  const start = { before: 0, after: 1, revision: -1, accepted: { action: 'start', revision: 0 }, sent: [{ event: 'start_game', payload: null }], action: 'start', payload: {} };
  assertSizingCommand(start);
  assert.throws(() => assertSizingCommand({ ...start, sent: [{ event: 'colt:start', payload: null }] }));
  assert.throws(() => assertSizingCommand({ ...start, sent: [{ event: 'start_game', payload: { unexpected: true } }] }));
});

test('registered CDP sent callback retains the actual lobby start_game packet and catches late extras', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'colt-ui-smoke.cjs'), 'utf8');
  const handlers = new Map(), receipt = { target: 'card-sizing' };
  const cdp = { send: async () => {}, on: (event, handler) => handlers.set(event, handler) };
  const page = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, setViewport: async () => {}, emulateMediaFeatures: async () => {}, setRequestInterception: async () => {}, on() {}, evaluateOnNewDocument: async () => {}, createCDPSession: async () => cdp };
  const browser = { createBrowserContext: async () => ({ newPage: async () => page }) };
  const open = vm.runInNewContext(source.slice(source.indexOf('async function openPlayer('), source.indexOf('async function servedHash(')) + '\nopenPlayer', {
    ownedPlayers: new Set(), allowedOrigins: new Set(['http://127.0.0.1:8081']), currentReceipt: receipt,
  });
  const player = await open(browser, 'phone');
  let persisted = 0; player.onCommandJournal = () => persisted++;
  handlers.get('Network.webSocketCreated')({ requestId: 'owned-socket' });
  const emit = (data, requestId = 'owned-socket') => handlers.get('Network.webSocketFrameSent')({ requestId, response: { payloadData: data } });
  emit('42["start_game"]', 'stale-socket'); emit('42["request_state"]'); emit('not-json');
  assert.equal(player.sentCommands, undefined);
  emit('42["start_game"]');
  handlers.get('Network.webSocketFrameReceived')({ requestId: 'owned-socket', response: { payloadData: '42["colt:action_accepted",{"action":"start","revision":0}]' } });
  const journals = () => JSON.parse(JSON.stringify(sizingJournals([player])));
  assert.deepEqual(journals().phone.sent, [{ event: 'start_game', payload: null }]);
  assert.equal(persisted, 2);
  const attempts = [{ actor: 'phone', action: 'start', payload: {}, revision: -1, status: 'accepted' }];
  assertSizingJournals(journals(), attempts);
  emit('42["start_game"]');
  assert.throws(() => assertSizingJournals(journals(), attempts), /sent-command journal mismatch/);
  player.sentCommands.pop();
  emit('42["colt:start"]');
  assert.throws(() => assertSizingJournals(journals(), attempts), /sent-command journal mismatch/);
  receipt.target = 'full-match'; const count = player.sentCommands.length;
  emit('42["start_game"]'); assert.equal(player.sentCommands.length, count);
});

function commandHarness() {
  const player = { name: 'Owned seat', sentCommands: [], acceptedActions: [] }, attempts = [], snapshots = [];
  const readJournals = () => sizingJournals([player]);
  const persist = () => snapshots.push(structuredClone({ attempts, journals: readJournals() }));
  const send = (revision = 0, perform) => recordSizingCommand({ actor: player.name, action: 'reserve', payload: { cardId: 'correct-card' }, revision, attempts, readJournals, persist, perform: perform ?? (async () => {
    player.sentCommands.push({ event: 'colt:reserve', payload: { cardId: 'correct-card', expectedRevision: revision } });
    const ack = { action: 'reserve', revision: revision + 1 }; player.acceptedActions.push(ack); return ack;
  }) });
  return { player, attempts, snapshots, readJournals, send };
}

test('late duplicate between sends cannot be absorbed into the next baseline', async () => {
  for (const journal of ['sentCommands', 'acceptedActions']) {
    const h = commandHarness(); await h.send();
    h.player[journal].push(structuredClone(h.player[journal][0]));
    let clicked = false;
    await assert.rejects(h.send(1, async () => { clicked = true; }), /journal mismatch/);
    assert.equal(clicked, false); assert.equal(h.attempts[1].status, 'failed');
    assert.equal(h.attempts[1].beforeJournal[h.player.name][journal === 'sentCommands' ? 'sent' : 'accepted'].length, 2);
    assert(h.snapshots.at(-1).attempts[1].failure);
  }
});

test('late duplicates after the final send fail exact final per-seat reconciliation', async () => {
  for (const journal of ['sentCommands', 'acceptedActions']) {
    const h = commandHarness(); await h.send(); assertSizingJournals(h.readJournals(), h.attempts);
    h.player[journal].push(structuredClone(h.player[journal][0]));
    assert.throws(() => assertSizingJournals(h.readJournals(), h.attempts), /journal mismatch/);
  }
  const h = commandHarness(); await h.send();
  h.player.sentCommands.push({ event: 'colt:unexpected', payload: {} });
  assert.throws(() => assertSizingJournals(h.readJournals(), h.attempts), /journal mismatch/);
});

test('wrong payload and command rejection retain offending raw deltas before failure assertions', async () => {
  for (const rejected of [false, true]) {
    const h = commandHarness();
    await assert.rejects(h.send(0, async () => {
      h.player.sentCommands.push({ event: 'colt:reserve', payload: { cardId: 'wrong-card', expectedRevision: 0 } });
      if (rejected) throw Error('Rejected by server');
      const ack = { action: 'reserve', revision: 1 }; h.player.acceptedActions.push(ack); return ack;
    }), rejected ? /Rejected by server/ : /different identity/);
    const failed = h.attempts[0]; assert.equal(failed.status, 'failed');
    assert.equal(failed.delta.sent[0].payload.cardId, 'wrong-card');
    assert.equal(failed.afterJournal[h.player.name].sent[0].payload.cardId, 'wrong-card');
    assert.equal(failed.delta.accepted.length, rejected ? 0 : 1);
    if (!rejected) assert(h.snapshots.some(snapshot => snapshot.attempts[0].afterJournal && !snapshot.attempts[0].failure));
    assert(h.snapshots.at(-1).attempts[0].failure);
  }
});

test('complete journals preserve per-seat order and cannot share another seat acknowledgement', () => {
  const attempts = [{ actor: 'phone', action: 'start', payload: {}, revision: -1, status: 'accepted' }, { actor: 'desktop', action: 'choose-team', payload: { teamIndex: 1 }, revision: 0, status: 'accepted' }, { actor: 'phone', action: 'choose-team', payload: { teamIndex: 0 }, revision: 1, status: 'accepted' }];
  const journals = { phone: { sent: [{ event: 'start_game', payload: null }, { event: 'colt:choose-team', payload: { teamIndex: 0, expectedRevision: 1 } }], accepted: [{ action: 'start', revision: 0 }, { action: 'choose-team', revision: 2 }] }, desktop: { sent: [{ event: 'colt:choose-team', payload: { teamIndex: 1, expectedRevision: 0 } }], accepted: [{ action: 'choose-team', revision: 1 }] } };
  assertSizingJournals(journals, attempts);
  const swapped = structuredClone(journals); swapped.phone.accepted[1] = journals.desktop.accepted[0];
  assert.throws(() => assertSizingJournals(swapped, attempts), /acknowledgement/);
  assert.throws(() => assertSizingJournals({ phone: journals.phone }, attempts), /missing/);
});

test('painted-face widths include trailing rows; heights compare rows without substituting owner boxes', () => {
  const cards = [card(0, 0, 0), card(1, 272, 0), card(2, 0, 316)];
  assert.deepEqual(classifySizing(cards, 'hand').failures, []);
  const wide = [cards[0], cards[1], card(2, 0, 316, 532)];
  assert(classifySizing(wide, 'hand').failures.some(f => f.kind === 'unequal-face-width'));
  const shortFace = { ...cards[1], face: box(272, 0, 260, 280) };
  assert(classifySizing([cards[0], shortFace, cards[2]], 'hand').failures.some(f => f.kind === 'unequal-same-row-face-height'));
  const newRow = card(2, 0, 316, 260, 330);
  assert.deepEqual(classifySizing([cards[0], cards[1], newRow], 'hand').failures, []);
  assert(classifySizing([cards[0], cards[1], newRow], 'program').failures.some(f => f.kind === 'unequal-program-face-height'));
  assert.throws(() => classifySizing([], 'hand')); assert.throws(() => classifySizing([cards[0]], 'hand'));
});

test('programme captions do not inflate face geometry; missing art and escaped edges fail', () => {
  const first = card(0, 0, 0), last = card(1, 0, 450);
  last.root.height = 500; last.root.bottom = 950; last.captions = [{ text: 'A long owner caption', bounds: box(0, 755, 260, 190) }];
  assert.deepEqual(classifySizing([first, last], 'program').failures, []);
  assert(classifySizing([first, { ...last, images: [{ complete: false, naturalWidth: 0 }] }], 'program').failures.some(f => f.kind === 'unloaded-art'));
  assert(classifySizing([first, { ...last, edge: box(0, 800, 260, 160) }], 'program').failures.some(f => f.kind === 'face-or-edge-outside-owner'));
});

test('screenshot stability rejects same-sized shifted faces and every changed geometry axis', () => {
  const before = [card(0, 0, 0), card(1, 272, 0)];
  assertSizingStable(before, structuredClone(before));
  for (const part of ['root', 'edge', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    const after = structuredClone(before); after[1][part][axis] += 2;
    assert.throws(() => assertSizingStable(before, after), new RegExp(part + '\\.' + axis));
  }
  const moved = structuredClone(before); moved[0].face.left += 2; moved[0].face.right += 2;
  assert.throws(() => assertSizingStable(before, moved));
  const renamed = structuredClone(before); renamed[0].id = 'different';
  assert.throws(() => assertSizingStable(before, renamed), /identity/);
});

test('raw collection samples are persisted before capture, before assertions and after failure', async () => {
  const before = [card(0, 0, 0), card(1, 272, 0)], after = structuredClone(before);
  after[1].face.left += 4; after[1].face.right += 4;
  const raw = {}, snapshots = []; let measured = 0, shot = false;
  await assert.rejects(sizingScreenshot({ raw, role: 'hand', measure: async () => measured++ ? after : before,
    shoot: async () => { assert.deepEqual(snapshots[0].before, before); shot = true; return 'png'; },
    persist: () => snapshots.push(structuredClone(raw)) }), /moved/);
  assert(shot); assert.deepEqual(raw.before, before); assert.deepEqual(raw.after, after); assert(raw.failure);
  assert.deepEqual(snapshots[1].after, after); assert.equal(snapshots[1].failure, undefined);
  assert(snapshots.at(-1).failure);
  const failedShot = {}, failedSnapshots = [];
  await assert.rejects(sizingScreenshot({ raw: failedShot, role: 'hand', measure: async () => before,
    shoot: async () => { throw Error('PNG failed'); }, persist: () => failedSnapshots.push(structuredClone(failedShot)) }), /PNG failed/);
  assert.deepEqual(failedSnapshots[0].before, before); assert.equal(failedShot.failure, 'PNG failed');
});

test('DOM adapter locates the actual CardSurface, not the outer caption wrapper', () => {
  const element = (style, bounds, children = [], textContent = '') => ({ style, children, childNodes: textContent ? [{ nodeType: 3, textContent }] : children, textContent, id: '', closest: () => null, getBoundingClientRect: () => bounds, querySelectorAll: selector => selector === 'img' ? [] : children.flatMap(child => [child, ...child.querySelectorAll('*')]), querySelector: () => null, getAttribute: () => null, setAttribute() {}, contains(node) { return node === this || children.some(child => child.contains(node)); } });
  const edge = element({ position: 'absolute', bottom: '-3px' }, box(0, 30, 260, 303));
  const face = element({ overflow: 'hidden' }, box(0, 30, 260, 300), [], 'MOVE');
  const surface = element({}, box(0, 30, 260, 300), [edge, face]);
  const caption = element({}, box(0, 0, 260, 22), [], '1. QUEUED');
  const owner = element({}, box(0, 340, 260, 80), [], 'Conductor Alexandria');
  const root = element({}, box(0, 0, 260, 424), [caption, surface, owner]); root.id = 'colt-program-card-0';
  const result = vm.runInNewContext(`(${measureSizing})('program')`, { document: { querySelectorAll: () => [root] }, getComputedStyle: node => node.style, Node: { TEXT_NODE: 3 } });
  assert.equal(result[0].face.height, 300); assert.equal(result[0].root.height, 424);
  assert.equal(result[0].text, 'MOVE');
  assert.deepEqual(Array.from(result[0].captions, c => c.text), ['1. QUEUED', 'Conductor Alexandria']);
});

test('success requires two normal auth-cleared UI exits, context/browser closure and no fallback', () => {
  const pass = { scenarioComplete: true, freezeVerified: true, browserClosed: true, commandJournalVerified: true, calibration: { passed: true }, actions: [], captures: [], cleanup: [{ status: 200, normalUI: true, authClear: true }, { status: 200, normalUI: true, authClear: true }], contextsClosed: [{ closed: true }, { closed: true }], findings: [], visualFindings: [], consoleIssues: [], blockedRequests: [], rejections: [] };
  assert.equal(sizingComplete(pass), true);
  for (const key of ['scenarioComplete', 'freezeVerified', 'browserClosed', 'commandJournalVerified']) assert.equal(sizingComplete({ ...pass, [key]: false }), false);
  for (const key of ['findings', 'visualFindings', 'consoleIssues', 'blockedRequests', 'rejections']) assert.equal(sizingComplete({ ...pass, [key]: ['failure'] }), false);
  for (const patch of [{ fallback: true }, { status: 400 }, { authClear: false }, { normalUI: false }]) assert.equal(sizingComplete({ ...pass, cleanup: [pass.cleanup[0], { ...pass.cleanup[1], ...patch }] }), false);
  assert.equal(sizingComplete({ ...pass, contextsClosed: [{ closed: true }] }), false);
  assert.equal(sizingComplete({ ...pass, failure: 'Hard deadline' }), false);
});

test('source fence covers the real route, face, grid, evidence helpers and action art', () => {
  const hashes = sizingSourceHashes(); assert.equal(Object.keys(hashes).length, CARD_SIZING_SOURCES.length);
  assert(CARD_SIZING_SOURCES.includes('apps/mobile/hooks/useMeasuredLayoutWidth.ts'));
  for (const suffix of ['app/colt-express/game.tsx', 'components/ui/CardSurface.tsx', 'components/ui/CardGrid.tsx', 'hooks/useIntrinsicCardHeight.ts', 'scripts/colt-ui-smoke.cjs', 'scripts/colt-card-sizing-ui.test.cjs', 'scripts/libertalia-ui-primitives.cjs', 'assets/game-art/colt-action-move.webp']) assert(CARD_SIZING_SOURCES.some(file => file.endsWith(suffix)));
  assert(Object.values(hashes).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  const source = fs.readFileSync(path.join(__dirname, 'colt-ui-smoke.cjs'), 'utf8');
  assert(source.indexOf('coltTargetConfig(process.env)') < source.indexOf('const base = path.resolve(outputBase)'));
  assert.match(source, /currentReceipt = receipt; ownedPlayers.clear\(\); screenshotSequence = 0/);
  assert.match(source, /game\.availableTeams\.findIndex\(team => team\.includes\('ghost'\)\)/);
  assert.match(source, /card\.action === 'move'/);
  assert.match(source, /assert\.equal\(host.latestPublic.endReason, 'forfeit'\)/);
  assert.match(source, /runCardSizing\(\) : runMatch\(count\)/);
  assert.match(source, /reconcileJournals\('after-capture:' \+ record.file\)/);
  assert.match(source, /reconcileJournals\('after-normal-ui-cleanup'\)/);
  assert.match(source, /reconcileJournals\('after-context-and-browser-closure'\)/);
});
