const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Buffer } = require('node:buffer');
const { setImmediate: tick } = require('node:timers/promises');
const { parse: parseSelector } = require('css-what');
const h = require('./libertalia-fixture-ui.cjs');
const { LIBERTALIA_CREW } = require('../../../packages/types/src/libertalia-constants.ts');
const source = fs.readFileSync(path.join(__dirname, 'libertalia-fixture-ui.cjs'), 'utf8');
const valid = () => ({ LIBERTALIA_FIXTURE_UI_RUN: 'true', LIBERTALIA_UI_EXCLUSIVE_WINDOW: 'granted', LIBERTALIA_FIXTURE_CASE: 'scout-hand', LIBERTALIA_FIXTURE_OUTPUT: path.resolve('fixture-test-unused-output'), QA_STATIC_ROOT: path.resolve('fixture-test-unused-export'), QA_EXPECTED_WEB_SHA256: 'a'.repeat(64), QA_BROWSER_CERT_SPKI: 'a'.repeat(43) + '=' });
function actor(id = 'host') {
  return { name: id, auth: { playerId: id, roomCode: 'ABCD-EFGH' }, sent: [], accepted: [], inputProfile: { width: 375, height: 844, hasTouch: true, pointer: 'coarse' }, pass: 0,
    latestPrivate: { gameId: 'libertalia', playerId: id, roomCode: 'ABCD-EFGH', revision: 10, selectedRank: null, hand: [6], graveyard: [], pendingChoice: null },
    latestPublic: { gameId: 'libertalia', roomCode: 'ABCD-EFGH', revision: 10, phase: 'selection', voyage: 1, day: 2, currentLoot: [], players: [{ playerId: 'host', displayName: 'Fixture Host', ship: [], loot: [], reputation: 0, doubloons: 5, forfeited: false }, { playerId: 'second', displayName: 'Fixture Second', ship: [], loot: [] }] } };
}
test('explicit case, browser authority and frozen inputs are required before execution', () => {
  assert.equal(h.configFromEnv(valid()).scenario, 'scout-hand');
  for (const key of ['LIBERTALIA_FIXTURE_UI_RUN', 'LIBERTALIA_UI_EXCLUSIVE_WINDOW', 'LIBERTALIA_FIXTURE_CASE', 'QA_EXPECTED_WEB_SHA256', 'QA_BROWSER_CERT_SPKI', 'QA_STATIC_ROOT', 'LIBERTALIA_FIXTURE_OUTPUT']) {
    const env = valid(); delete env[key]; assert.throws(() => h.configFromEnv(env), key);
  }
  for (const patch of [{ LIBERTALIA_FIXTURE_CASE: 'all' }, { LIBERTALIA_FIXTURE_SEAT: '0' }, { LIBERTALIA_UI_FIXTURE_BATCH: 'all' }, { LIBERTALIA_API_URL: 'https://example.com' }, { LIBERTALIA_API_URL: 'http://127.0.0.1:3213/unsafe' }, { LIBERTALIA_API_URL: 'http://127.0.0.1:8081' }, { QA_EXPECTED_WEB_SHA256: 'latest' }]) assert.throws(() => h.configFromEnv({ ...valid(), ...patch }));
});
test('twelve finite cases stay below178 independently of the natural budget and swap true profiles', () => {
  assert.equal(h.SCENARIOS.length, 12);
  for (const scenario of h.SCENARIOS) { const plan = h.planFor(scenario, null); assert(plan.ceiling < 178); assert.equal(plan.passes, scenario.startsWith('six-') ? 1 : 2); assert.deepEqual(plan.scales, [100, 200]); }
  assert.equal(h.planFor('six-fleet', null).ceiling, 144); assert.equal(h.planFor('six-results', null).ceiling, 84);
  assert.throws(() => h.planFor('six-fleet', 2)); assert.throws(() => h.planFor('made-up', null));
});
test('rosters and manifest never fabricate unsupported choice producers', () => {
  assert.equal(new Set(h.SIX_NAMES).size, 6); assert(h.SIX_NAMES.every(name => name.length === 20 && !name.includes(' ')));
  assert.equal(h.namesFor('empty-hand').length, 2); assert.equal(h.namesFor('midshipman-two').length, 2); assert.equal(h.namesFor('six-results').length, 6);
  const manifest = { scenarios: h.SCENARIOS.map(scenario => ({ scenario, names: h.namesFor(scenario), players: h.namesFor(scenario).length, ownerIndex: 0, observerIndex: 1 })), reachability: { unsupported: h.GAPS.map(item => ({ case: item })) } };
  assert.equal(h.validateManifest(manifest, 'scout-hand').players, 3);
  manifest.reachability.unsupported.pop(); assert.throws(() => h.validateManifest(manifest, 'scout-hand'));
});
test('ordinary API is rejected and request payloads retain exact owned authentication', () => {
  h.validateService({ status: 'ok', service: 'libertalia-local-ui-fixtures' });
  assert.throws(() => h.validateService({ status: 'ok', service: 'zuychin-arcade-server' }));
  const value = h.postOptions({ roomCode: 'ABCD-EFGH', scenario: 'scout-hand' }, 'synthetic-test-only', 'http://127.0.0.1:8081');
  assert.equal(value.headers.Origin, 'http://127.0.0.1:8081'); assert.equal(value.headers.Authorization, 'Bearer synthetic-test-only');
  assert.deepEqual(JSON.parse(value.body), { roomCode: 'ABCD-EFGH', scenario: 'scout-hand' }); assert.equal(value.redirect, 'error');
});
test('pair ownership and privacy checks reject mismatched revisions and leaked fields', () => {
  const a = actor(); assert(h.hasPair(a)); h.snapshot(a);
  a.latestPrivate.playerId = 'other'; assert(!h.hasPair(a)); a.latestPrivate.playerId = 'host'; a.latestPublic.revision++; assert.throws(() => h.snapshot(a));
  a.latestPublic.revision--; a.latestPublic.players[0].hand = [6]; assert.throws(() => h.snapshot(a));
  assert.deepEqual(h.packet('42["game_state",{}]'), ['game_state', {}]); assert.equal(h.packet('42invalid'), null); assert.equal(h.packet('2'), null);
});
test('option labels preserve full owned crew prose and exact loot-token help without parsing swaps', () => {
  const a = actor(); const crew = LIBERTALIA_CREW[6];
  const label = h.optionLabel({ label: '#7 Preacher', playerId: 'second', rank: 7 }, a, 'ship_character');
  assert(label.includes('Fixture Second')); assert(label.includes(crew.summary)); assert(label.includes(crew.phases.join(', ')));
  a.latestPublic.currentLoot = [{ id: 19, kind: 'amulet' }];
  assert.match(h.optionLabel({ label: 'AMULET', lootId: 19 }, a, 'loot_current'), /Calm-side effect: Gain 3/);
  assert.equal(h.optionLabel({ label: 'Today: map → tomorrow; tomorrow: amulet → today', lootId: 19 }, a, 'loot_swap'), 'Today: map → tomorrow; tomorrow: amulet → today');
});
test('station endpoint proof intersects authoritative header/footer visibility', () => {
  const record = { metrics: { frame: { left: 10, top: 0 }, frameVisibleBounds: { left: 0, right: 375, top: 60, bottom: 780 } } };
  h.assertSegmentVisible({ left: 0, right: 300, top: 60, bottom: 200 }, record);
  assert.throws(() => h.assertSegmentVisible({ left: 0, right: 300, top: 0, bottom: 200 }, record));
  assert.throws(() => h.assertSegmentVisible({ left: 0, right: 300, top: 700, bottom: 820 }, record));
  assert.throws(() => h.assertSegmentVisible({ left: 0, right: 390, top: 60, bottom: 200 }, record));
});
test('canonical postconditions reject visually similar but incorrect outcomes', () => {
  const host = actor(), second = actor('second'); host.latestPrivate.graveyard = [1]; host.latestPrivate.hand = [];
  h.assertPostcondition('scout-hand', [host, second], { revision: 9 }); host.latestPrivate.hand = [6]; assert.throws(() => h.assertPostcondition('scout-hand', [host, second], { revision: 9 }));
  host.latestPrivate.hand = [1, 2, 3, 4, 5, 6]; host.latestPublic.voyage = 2;
  h.assertPostcondition('empty-hand', [host, second], { revision: 9 }); host.latestPublic.players[0].forfeited = true; assert.throws(() => h.assertPostcondition('empty-hand', [host, second], { revision: 9 }));
});
function loadWithCapture(capture) {
  const module = { exports: {} };
  const realmAssert = Object.assign((...args) => assert(...args), assert, { deepEqual: (a, b, message) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message) });
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === 'node:assert/strict' ? realmAssert : name === './libertalia-ui-natural.cjs' ? { ...require(name), captureFrame: capture } : require(name), __dirname, process, console, setTimeout, clearTimeout, AbortSignal, URL }, { filename: 'fixture-ui-runtime.cjs' });
  return module.exports;
}
test('framing runtime preserves revision, scales, budget and records attributable inventory', async () => {
  const a = actor(); a.page = { viewport: () => ({ width: 375 }) }; let calls = 0;
  const runtime = loadWithCapture(async () => { calls++; return [{ scale: 100 }, { scale: 200 }]; });
  const qa = { evidence: { captures: [], capturePlan: { ceiling: 8 }, inventory: [] }, persist() {} };
  await runtime.framed(a, 'proof', '#choice', qa); assert.equal(calls, 1); assert.equal(qa.evidence.inventory[0].playerId, 'host');
  qa.evidence.capturePlan.ceiling = 3; await assert.rejects(runtime.framed(a, 'proof', '#choice', qa), /budget/); assert.equal(calls, 1);
  qa.evidence.capturePlan.ceiling = 8;
  const mutating = loadWithCapture(async () => { a.latestPrivate.revision++; return []; });
  await assert.rejects(mutating.framed(a, 'proof', '#choice', qa), /paired/);
});

test('neutral Midshipman uses its exact colon-containing opaque ID for art checks and both framing scales', async () => {
  assert(parseSelector('#libertalia-island-midshipman:1:1')[0].some(part => part.type === 'pseudo'), 'The old selector treated opaque ID segments as pseudo-classes');
  for (const id of ['midshipman:1:1', 'midshipman:2:6', 'opaque"\\piece']) {
    const a = actor(), captured = [], queried = [];
    a.latestPublic.island = [{ id, neutral: true, rank: 20.5, name: 'Midshipman', playerId: null }];
    let artCount = 0;
    a.page = { viewport: () => ({ width: 375 }), $eval: async (selector, callback) => {
      queried.push(selector);
      const parsed = parseSelector(selector);
      assert.equal(parsed.length, 1); assert.equal(parsed[0].length, 1);
      assert.equal(parsed[0][0].type, 'attribute'); assert.equal(parsed[0][0].name, 'id'); assert.equal(parsed[0][0].action, 'equals');
      assert.equal(parsed[0][0].value, 'libertalia-island-' + id);
      return callback({ querySelectorAll: artSelector => {
        assert.equal(artSelector, 'img,[data-testid^="libertalia-crew-card-"]'); return Array(artCount);
      } });
    } };
    const qa = { evidence: { captures: [], capturePlan: { ceiling: 16 }, inventory: [] }, persist() {} };
    const runtime = loadWithCapture(async (_actor, _name, selector) => { captured.push(selector); return [{ scale: 100 }, { scale: 200 }]; });
    const before = h.snapshot(a);
    await runtime.neutralFrames(a, qa);
    assert.deepEqual(captured, [queried[0], '#libertalia-reputation']);
    assert.equal(qa.evidence.inventory[0].key, 'neutral-midshipman'); assert.equal(qa.evidence.inventory[1].key, 'inactive-reputation');
    assert.deepEqual(h.snapshot(a), before); assert.equal(a.sent.length, 0);
    artCount = 1;
    await assert.rejects(runtime.neutralFrames(a, qa), /no Freed Prisoner art/);
    assert.equal(captured.length, 2, 'Art privacy failure cannot proceed to another frame');
    a.latestPublic.island[0].rank = 20;
    await assert.rejects(runtime.neutralFrames(a, qa));
  }
});
test('missing option proof, missing scale and impossible frame coverage cannot complete', () => {
  const plan = h.planFor('scout-hand', null);
  const evidence = { passes: [0, 1].map(pass => ({ pass, natural: false, ownerProfiles: [{ inputProfile: { pointer: 'coarse' } }, { inputProfile: { pointer: 'fine' } }] })), postconditions: [{}, {}], stages: [0, 1].map(pass => ({ pass, stage: 'initial', optionIds: ['a'] })), inventory: [], captures: [] };
  const proof = [{ scale: 100, covered: 10, height: 10, files: ['a'] }, { scale: 200, covered: 10, height: 10, files: ['b'] }];
  for (let pass = 0; pass < 2; pass++) for (const key of ['initial-prompt', 'initial-option0']) evidence.inventory.push({ pass, key, proofs: proof });
  assert.equal(h.assertInventory(evidence, plan), true);
  evidence.inventory.pop(); assert.throws(() => h.assertInventory(evidence, plan));
  evidence.inventory.push({ pass: 1, key: 'initial-option0', proofs: [{ scale: 100, covered: 5, height: 10, files: ['a'] }] }); assert.throws(() => h.assertInventory(evidence, plan));
});
test('completion requires normal UI200/authclear, socket200, contexts and immutable evidence', () => {
  const evidence = { browserClosed: true, scenarioComplete: true, freezeVerified: true, findings: [], blockedRequests: [], socketIssues: [], consoleIssues: [], captures: [], capturePlan: { ceiling: 72 }, contextsClosed: ['a'], cleanup: [{ playerId: 'a', normalUI: true, status: 200, authCleared: true }, { playerId: 'b', mode: 'socket-rest', status: 200 }] };
  const seats = [{ playerId: 'a', browserOwner: true }, { playerId: 'b', browserOwner: false }];
  assert(h.completionStatus(evidence, seats).passed); evidence.cleanup[0].authCleared = false; assert(!h.completionStatus(evidence, seats).passed);
  evidence.cleanup[0].authCleared = true; evidence.cleanup.push({ fallback: true }); assert(!h.completionStatus(evidence, seats).passed);
  evidence.cleanup.pop(); evidence.freezeVerified = false; assert(!h.completionStatus(evidence, seats).passed);
});
test('source fence includes this runner, tests, canonical service and product shared dependencies', () => {
  for (const suffix of ['libertalia-fixture-ui.cjs', 'libertalia-fixture-ui.test.cjs', 'ui-fixtures.ts', 'ui-fixture-server.ts', 'ui-fixtures.test.ts', 'libertalia/Hand.tsx', 'libertalia/CrewCard.tsx', 'ui/CardGrid.tsx', 'hooks/useMeasuredLayoutWidth.ts', 'card-grid.test.cjs', 'card-surface.test.cjs', 'libertalia-ui-primitives.cjs']) assert(h.SOURCE_FILES.some(file => file.endsWith(suffix)), suffix);
  const hashes = h.sourceHashes(file => Buffer.from(file)); assert.equal(Object.keys(hashes).length, h.SOURCE_FILES.length); assert(Object.values(hashes).every(hash => /^[a-f0-9]{64}$/.test(hash)));
});
test('all sixty fleet copies retain scoped complete text and glyph width even outside the viewport', () => {
  const ranks = [8, 10, 15, 20, 22, 24, 28, 32, 34, 35], nodes = new Map(); let clipped = false;
  const bounds = { left: 10, right: 310, top: 10000, bottom: 10600, width: 300, height: 600 };
  const players = h.SIX_NAMES.map((displayName, i) => ({ playerId: 'p' + i, displayName, ship: ranks }));
  for (const player of players) {
    const cards = ranks.map(rank => ({ dataset: { testid: 'libertalia-crew-card-' + rank }, textContent: LIBERTALIA_CREW[rank - 1].name + ' ' + LIBERTALIA_CREW[rank - 1].summary, clientWidth: 300, scrollWidth: 300, getBoundingClientRect: () => bounds }));
    nodes.set('libertalia-seat-' + player.playerId, { textContent: player.displayName });
    nodes.set('libertalia-ship-' + player.playerId, { querySelectorAll: () => cards, getBoundingClientRect: () => bounds });
  }
  const context = { NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: () => ({ fontFamily: 'Outfit' }), window: { __coupQATextGeometry: () => ({ glyphRects: [{ left: 12, right: clipped ? 320 : 300 }] }) }, document: {
    getElementById: id => nodes.get(id), createTreeWalker: card => { let done = false; return { currentNode: { textContent: card.textContent, parentElement: { closest: () => null } }, nextNode() { if (done) return false; done = true; return true; } }; },
  } };
  const inspect = vm.runInNewContext('(' + h.inspectFleet.toString() + ')', context);
  const rows = inspect({ players, definitions: LIBERTALIA_CREW }); assert.equal(rows.flatMap(row => row.cards).length, 60); assert(rows.flatMap(row => row.cards).every(card => card.offscreenAllowed && card.fullText));
  clipped = true; assert.throws(() => inspect({ players, definitions: LIBERTALIA_CREW }), /glyph horizontally clipped/); clipped = false;
  nodes.get('libertalia-ship-p4').querySelectorAll()[3].textContent = 'Truncated'; assert.throws(() => inspect({ players, definitions: LIBERTALIA_CREW }), /Full fleet crew text/);
});
test('activation samples reject disabled, occluded, missing and undersized controls', () => {
  let disabled = false, covered = false, count = 1, width = 80;
  const node = { isConnected: true, closest: () => null, getAttribute: () => disabled ? 'true' : null, contains: target => target === node, getBoundingClientRect: () => ({ left: 10, top: 20, width, height: 52 }) };
  const sample = vm.runInNewContext('(' + h.activationSample.toString() + ')', { document: { querySelectorAll: () => Array.from({ length: count }, () => node), elementFromPoint: () => covered ? {} : node }, getComputedStyle: () => ({ visibility: 'visible', opacity: '1', pointerEvents: 'auto' }) });
  assert(sample('#button')); disabled = true; assert.equal(sample('#button'), null); disabled = false;
  covered = true; assert.equal(sample('#button'), null); covered = false; width = 47; assert.equal(sample('#button'), null); width = 80;
  count = 0; assert.equal(sample('#button'), null); count = 2; assert.equal(sample('#button'), null);
  assert(!h.stableSample(null, { left: 0 })); assert(!h.stableSample({ left: 0, top: 0, width: 80, height: 52 }, { left: 2, top: 0, width: 80, height: 52 }));
});
test('activation waits through mount and disabled animation samples then dispatches exactly once', async () => {
  let taps = 0, mounts = 0, measures = 0, disposed = 0;
  const actor = { inputProfile: { hasTouch: true }, page: {
    evaluate: async fn => {
      if (fn.name === 'mark') { if (++mounts === 1) throw Error('not mounted'); return '#button'; }
      if (fn.name === 'activationSample') { measures++; return measures < 3 ? null : { left: 10, top: 20, width: 80, height: 52 }; }
      return null;
    },
    $: async () => ({ evaluate: async () => {}, tap: async () => { taps++; }, dispose: async () => { disposed++; } }),
  } };
  await h.activate(actor, 'LEAVE', '#arcade-dialog'); assert.equal(taps, 1); assert.equal(disposed, 1); assert.equal(mounts, 2); assert(measures >= 6);
});
test('station endpoints honour the frozen zero-argument prepare callback contract', async () => {
  const a = actor(); let prepares = 0, evaluations = 0;
  const { raw, spec } = lootSample({ compact: true, count: 2 });
  a.page = {
    viewport: () => ({ width: 375, height: 844 }),
    screenshot: async () => {},
    evaluate: async fn => { evaluations++; return fn.name === 'readLootGrid' ? raw : []; },
    $eval: async (selector, callback, edge) => { assert.equal(selector, '#libertalia-seat-host'); assert(['start', 'end'].includes(edge)); return [{ left: 0, right: 300, top: 60, bottom: 200 }]; },
  };
  const qa = { evidence: { captures: [], capturePlan: { ceiling: 4 }, fleetChecks: [], stationEndpoints: [] }, persist() {},
    capture: async (page, name, options) => {
      assert.equal(page, a.page); assert.equal(options.prepare.length, 0);
      await options.prepare(); prepares++;
      await page.screenshot({ path: name });
      const record = { file: name, metrics: { frame: { left: 10, top: 0 }, frameVisibleBounds: { left: 0, right: 375, top: 60, bottom: 780 } } };
      qa.evidence.captures.push(record); return record;
    },
  };
  await h.stationEndpoints(a, { playerId: 'host', loot: spec.tokens }, qa);
  assert.equal(prepares, 4); assert.equal(evaluations, 20); assert.equal(qa.evidence.fleetChecks.length, 4); assert.equal(qa.evidence.stationEndpoints.length, 4);
  assert.equal(qa.evidence.lootChecks.length, 4); assert(qa.evidence.lootChecks.every(row => row.validated && row.compact));
  assert.deepEqual(qa.evidence.lootChecks.map(row => row.file), qa.evidence.stationEndpoints.map(row => row.file));
  assert.deepEqual(qa.evidence.stationEndpoints.map(row => [row.scale, row.align]), [[100, 'start'], [100, 'end'], [200, 'start'], [200, 'end']]);
});
test('any capture privacy or selector gap fails completion and is aggregated in its receipt', () => {
  const evidence = { browserClosed: true, scenarioComplete: true, freezeVerified: true, findings: [], blockedRequests: [], socketIssues: [], consoleIssues: [], captures: [{ metrics: { privacyGaps: [], selectorGaps: [] } }, { metrics: { privacyGaps: [], selectorGaps: [] } }], capturePlan: { ceiling: 72 }, contextsClosed: ['a'], cleanup: [{ playerId: 'a', normalUI: true, status: 200, authCleared: true }] };
  const seats = [{ playerId: 'a', browserOwner: true }];
  assert(h.completionStatus(evidence, seats).passed);
  evidence.captures[1].metrics.privacyGaps.push('second-capture-private-face');
  let status = h.completionStatus(evidence, seats); assert.equal(status.passed, false); assert.deepEqual(status.privacyGaps, ['second-capture-private-face']);
  evidence.captures[0].metrics.privacyGaps.push('first-capture-private-face');
  status = h.completionStatus(evidence, seats); assert.deepEqual(status.privacyGaps, ['first-capture-private-face', 'second-capture-private-face']);
  evidence.captures.forEach(record => { record.metrics.privacyGaps = []; });
  evidence.captures[1].metrics.selectorGaps.push('second-capture-missing-hand');
  status = h.completionStatus(evidence, seats); assert.equal(status.passed, false); assert.deepEqual(status.selectorGaps, ['second-capture-missing-hand']);
  evidence.captures[0].metrics.selectorGaps.push('first-capture-missing-fleet');
  assert.deepEqual(h.completionStatus(evidence, seats).selectorGaps, ['first-capture-missing-fleet', 'second-capture-missing-hand']);
});
test('socket continuation waits for the acknowledged revision when acknowledgement precedes both projection frames', async () => {
  const a = actor(); a.latestPrivate.pendingChoice = { id: 7, options: [{ id: 'chosen' }] };
  const sent = [], qa = { evidence: { commands: [] }, persist() {} }; let completed = false;
  a.socket = { emit: (event, payload) => { sent.push({ event, payload }); a.accepted.push({ action: 'choice', revision: 11 }); } };
  const continuation = h.socketChoice(a, qa).then(() => { completed = true; });
  await tick(); assert.equal(completed, false, 'Old revision10 pair cannot satisfy revision11 acknowledgement'); assert.equal(qa.evidence.commands.length, 0);
  a.latestPrivate.revision = 11; await tick(); assert.equal(completed, false, 'One updated projection cannot satisfy the pair');
  a.latestPublic.revision = 11; await continuation;
  assert.equal(completed, true); assert.equal(sent.length, 1); assert.equal(qa.evidence.commands.length, 1); assert.equal(qa.evidence.commands[0].accepted.revision, 11);
  assert.deepEqual(sent[0], { event: 'libertalia:choice', payload: { expectedRevision: 10, choiceId: 7, optionIds: ['chosen'] } });
});

test('duplicate-label fixture options receive separate exact-ID full-frame proofs', async () => {
  const a = actor(), ids = ['ship:second:21', 'ship:second:24'], selectors = [];
  a.latestPublic.players[1].loot = [{ id: 21, kind: 'amulet' }, { id: 24, kind: 'amulet' }];
  a.latestPrivate.pendingChoice = { id: 45, playerId: 'host', kind: 'loot_ship', prompt: 'Choose an amulet', min: 1, max: 1, optional: false,
    options: ids.map((id, i) => ({ id, label: 'AMULET', playerId: 'second', lootId: [21, 24][i] })) };
  a.page = { viewport: () => ({ width: 375 }), evaluate: async (fn, args) => fn.name === 'mark' ? '#prompt' : { nodeId: 1, width: 300, height: 200, text: args.label },
    $eval: async () => 'AMULET Calm-side effect: Gain 3 doubloons at anchor.' };
  const qa = { evidence: { captures: [], capturePlan: { ceiling: 20 }, inventory: [], stages: [] }, persist() {} };
  const runtime = loadWithCapture(async (_actor, _name, selector, _qa, options) => { if (options.prepare) await options.prepare(); selectors.push(selector); return [{ scale: 100 }, { scale: 200 }]; });
  await runtime.choiceFrames(a, 'initial', qa);
  assert.deepEqual(selectors, ['#prompt', ...ids.map(id => '#libertalia-decision-area [data-testid="libertalia-choice-45-' + encodeURIComponent(id) + '"]')]);
  assert.deepEqual(qa.evidence.stages[0].optionIds, ids); assert.equal(qa.evidence.inventory.length, 3);
  assert.equal(a.sent.length, 0); assert.equal(a.accepted.length, 0);
});

function lootSample({ compact = false, count = 3, width = 820, scale = 1 } = {}) {
  const box = (left, top, w, height) => ({ left, right: left + w, top, bottom: top + height, width: w, height });
  const columns = Math.max(1, Math.floor((width + 8) / ((compact ? 120 : 260) * scale + 8)));
  const track = Math.min((compact ? 180 : 420) * scale, (width - 8 * (columns - 1)) / columns);
  const tokens = Array.from({ length: count }, (_, index) => ({ id: index + 1, kind: ['amulet', 'hook', 'relic'][index % 3] }));
  return { spec: { selector: '#loot', compact, tokens }, raw: { matches: 1, grid: box(10, 100, width, 800), title: box(10, 0, 240, 24 * scale), cards: tokens.map((token, index) => {
    const wrapper = box(10 + index % columns * (track + 8), 104 + Math.floor(index / columns) * 228, track, 220);
    const face = box(wrapper.left, wrapper.top, track, 216);
    return { matches: 1, id: 'libertalia-loot-token-' + token.id, label: `${token.kind}. ${h.LOOT_HELP[token.kind]}`, text: token.kind.toUpperCase() + (compact ? '' : h.LOOT_HELP[token.kind]), wrapper, root: { ...wrapper }, face, faceOverflow: 'hidden', glyphs: [{ left: face.left + 10, right: face.right - 10, top: face.top + 10, bottom: face.top + 30 }] };
  }) } };
}

test('loot tracks depend on exact available width and scale, never count or last-row occupancy', () => {
  for (const compact of [false, true]) for (const width of [311, 347, 632.875, 1240]) for (const scale of [1, 2]) {
    const widths = [];
    for (const count of [1, 2, 3, 6, 7]) {
      const { raw, spec } = lootSample({ compact, count, width, scale });
      widths.push(h.assertLootGrid(raw, spec).width); h.assertStableLoot(raw, structuredClone(raw), spec);
    }
    assert.equal(new Set(widths).size, 1);
  }
  assert.equal(h.planFor('empty-hand', null).ceiling, 128); assert.equal(h.planFor('six-fleet', null).ceiling, 144);
});

test('loot checks reject unequal painted peers, unfilled surfaces, underpacked rows and incomplete live copy', () => {
  for (const mutate of [
    raw => { raw.cards[0].face.height -= 50; raw.cards[0].face.bottom -= 50; },
    raw => { raw.cards[2].face.width += 20; },
    raw => { raw.cards[1].wrapper.top += 228; },
    raw => { raw.cards[0].text = 'AMULET'; },
    raw => { raw.cards[0].id = 'libertalia-loot-token-wrong'; },
    raw => { raw.cards[0].label = 'AMULET'; },
    raw => { raw.cards[0].glyphs[0].bottom = 9999; },
    raw => { raw.cards[0].faceOverflow = 'visible'; },
    raw => { raw.matches = 2; },
  ]) { const { raw, spec } = lootSample(); mutate(raw); assert.throws(() => h.assertLootGrid(raw, spec)); }
  const { raw, spec } = lootSample();
  for (const key of ['wrapper', 'root', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    const changed = structuredClone(raw); changed.cards[0][key][axis] += 3; assert.throws(() => h.assertStableLoot(raw, changed, spec), key + '.' + axis);
  }
  const swapped = structuredClone(raw); swapped.cards.reverse(); assert.throws(() => h.assertStableLoot(raw, swapped, spec));
});

test('loot DOM reader retains actual painted face, raw glyphs and parent-scoped identity even when invalid', () => {
  const { raw } = lootSample(), title = { textContent: 'VOYAGE 1 OF 3', children: [], getBoundingClientRect: () => raw.title };
  const wrappers = raw.cards.map(card => {
    const face = { getBoundingClientRect: () => card.face };
    const token = { textContent: card.text, firstElementChild: { children: [{}, face] }, getAttribute: name => name === 'aria-label' ? card.label : card.id, getBoundingClientRect: () => card.root };
    return { querySelectorAll: () => [token], getBoundingClientRect: () => card.wrapper };
  });
  const grid = { children: wrappers, getBoundingClientRect: () => raw.grid };
  let missing = false;
  const read = vm.runInNewContext('(' + h.readLootGrid.toString() + ')', { NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: () => ({ overflow: 'hidden', fontFamily: 'Outfit' }), window: { __coupQATextGeometry: () => ({ glyphRects: raw.cards[0].glyphs }) }, document: {
    querySelectorAll: selector => { assert.equal(selector, '#scoped-grid'); return missing ? [] : [grid]; },
    getElementById: () => ({ querySelectorAll: () => [title] }),
    createTreeWalker: token => { let once = false; return { currentNode: { textContent: token.textContent, parentElement: { closest: () => null } }, nextNode() { if (once) return false; once = true; return true; } }; },
  } });
  const sample = read({ selector: '#scoped-grid' });
  assert.equal(sample.cards[1].id, 'libertalia-loot-token-2'); assert.equal(sample.cards[1].face.height, 216); assert.equal(sample.cards[0].glyphs.length, 1);
  missing = true; const absent = read({ selector: '#scoped-grid' }); assert.equal(absent.matches, 0); assert.equal(absent.grid, null); assert.equal(absent.cards.length, 0);
});

test('loot capture persists raw data on both sides of the actual screenshot before validation and restores method', async () => {
  for (const broken of [false, true]) {
    const { raw, spec } = lootSample(); if (broken) raw.cards[0].face.height = 100;
    const events = [], a = actor();
    const screenshot = async () => { events.push('screenshot'); return 'PNG'; };
    a.page = { screenshot, viewport: () => ({ width: 375 }), evaluate: async fn => { if (fn.name === 'readLootGrid') { events.push('read'); return structuredClone(raw); } } };
    const qa = { evidence: {}, persist() { const last = this.evidence.lootChecks?.at(-1); events.push(last?.validated ? 'persist-valid' : last?.after ? 'persist-after' : last?.before ? 'persist-before' : 'persist-attempt'); }, capture: async page => page.screenshot({ path: '001-loot.png' }) };
    const capture = h.lootRecorder(qa, a, spec).capture(a.page, 'loot.png', { scale: true });
    if (broken) await assert.rejects(capture); else assert.equal(await capture, 'PNG');
    assert.deepEqual(events.slice(0, 6), ['persist-attempt', 'read', 'persist-before', 'screenshot', 'read', 'persist-after']);
    assert.equal(qa.evidence.lootChecks[0].validated, !broken); assert(qa.evidence.lootChecks[0].before && qa.evidence.lootChecks[0].after);
    assert.equal(a.page.screenshot, screenshot);
  }
});

test('loot failure screenshot remains available without replacing the original exception', async () => {
  const { spec } = lootSample(), a = actor(); let shots = 0;
  const screenshot = async () => { shots++; };
  a.page = { screenshot, evaluate: async () => {} };
  const original = Error('original capture failure');
  const qa = { evidence: {}, persist() {}, capture: async page => { await page.screenshot({ path: 'failure-001-loot.png' }); throw original; } };
  await assert.rejects(h.lootRecorder(qa, a, spec).capture(a.page, 'loot', {}), error => error === original);
  assert.equal(shots, 1); assert.equal(a.page.screenshot, screenshot); assert.equal(qa.evidence.lootChecks, undefined);
});

test('empty-hand adds only two grid frames, opens/closes the real outlook once, and preserves state on failure', async () => {
  for (const fail of [false, true]) {
    const a = actor(), calls = [], clicks = []; let open = false, label;
    a.latestPublic.currentLoot = [{ id: 21, kind: 'amulet' }, { id: 29, kind: 'hook' }, { id: 41, kind: 'relic' }];
    a.latestPublic.lootDays = [[], [], [], a.latestPublic.currentLoot];
    a.page = { viewport: () => ({ width: 375 }),
      evaluate: async (fn, args) => {
        if (fn.name === 'mark') { label = args.value; return '#toggle'; }
        if (fn.name === 'activationSample') return { left: 10, top: 20, width: 300, height: 52 };
      },
      $$eval: async (selector, fn) => { assert.equal(selector, '[data-testid="libertalia-voyage-loot-grid-4"]'); return fn(open ? [{}] : []); },
      $: async () => ({ evaluate: async () => {}, tap: async () => { clicks.push(label); open = !open; }, dispose: async () => {} }),
    };
    const qa = { evidence: { captures: [], capturePlan: h.planFor('empty-hand', null), inventory: [], findings: [] }, persist() {} };
    const failure = Error('grid clipping'), runtime = loadWithCapture(async (_actor, name, selector) => {
      calls.push({ name, selector }); if (fail && name.includes('voyage')) throw failure;
      return [{ scale: 100 }, { scale: 200 }];
    });
    const before = h.snapshot(a), result = runtime.emptyHandLoot(a, qa);
    if (fail) await assert.rejects(result, error => error === failure); else await result;
    assert.equal(calls.length, 2); assert.deepEqual(clicks, ['VIEW ALL VOYAGE LOOT', 'HIDE VOYAGE LOOT']); assert.equal(open, false);
    assert.deepEqual(h.snapshot(a), before); assert.equal(qa.evidence.capturePlan.ceiling, 128);
    assert.deepEqual(calls.map(row => row.selector), ['[data-testid="libertalia-current-loot-grid"]', '[data-testid="libertalia-voyage-loot-grid-4"]']);
  }
});

test('empty-hand completion cannot omit a loot grid or its screenshot-tied validated geometry', () => {
  const plan = h.planFor('empty-hand', null);
  const evidence = { passes: [0, 1].map(pass => ({ pass, natural: false, ownerProfiles: [{ inputProfile: { pointer: 'coarse' } }, { inputProfile: { pointer: 'fine' } }] })), postconditions: [{}, {}], stages: [], inventory: [], captures: [], lootChecks: [] };
  for (let pass = 0; pass < 2; pass++) for (const key of ['empty-hand-decision', 'empty-hand-private', 'current-loot-grid', 'voyage-loot-grid', 'candidate-card', 'candidate-confirm', 'replenished-crew']) {
    const proofs = [100, 200].map(scale => ({ scale, height: 10, covered: 10, files: [`${pass}-${key}-${scale}.png`] }));
    evidence.inventory.push({ pass, key, proofs });
    if (key.endsWith('loot-grid')) for (const proof of proofs) evidence.lootChecks.push({ file: proof.files[0], validated: true });
  }
  assert(h.assertInventory(evidence, plan)); evidence.lootChecks[0].validated = false; assert.throws(() => h.assertInventory(evidence, plan));
  evidence.lootChecks[0].validated = true; evidence.inventory.splice(2, 1); assert.throws(() => h.assertInventory(evidence, plan));
});
