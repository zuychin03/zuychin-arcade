const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const h = require('./not-alone-tactile-fixture-ui.cjs');
const source = fs.readFileSync(path.join(__dirname, 'not-alone-tactile-fixture-ui.cjs'), 'utf8');

test('map sizing compares all ten painted faces without mistaking caption or wrapper height for the card', () => {
  const cards = () => Array.from({ length: 10 }, (_, index) => ({ id: index + 1,
    wrapper: { width: 208, height: 700 + index * 10 },
    face: { top: Math.floor(index / 3) * 600, bottom: Math.floor(index / 3) * 600 + 500, width: 208, height: 500 },
  }));
  assert.equal(h.assertMapCardSizes(cards()).length, 10);
  const width = cards(); width[9].face.width = 228; assert.throws(() => h.assertMapCardSizes(width), /widths differ/);
  const height = cards(); height[1].face.height = 540; assert.throws(() => h.assertMapCardSizes(height), /heights differ/);
  const missing = cards().slice(0, 9); assert.throws(() => h.assertMapCardSizes(missing), /ten/);
  const duplicate = cards(); duplicate[9].id = 1; assert.throws(() => h.assertMapCardSizes(duplicate), /ten/);
  const invalid = cards(); invalid[0].face.height = NaN; assert.throws(() => h.assertMapCardSizes(invalid), /Invalid/);
  const trailing = cards(); trailing[9].face.height = 560; trailing[9].face.bottom += 60; h.assertMapCardSizes(trailing);
});

test('map collection reader uses the canonical painted face, not a taller caption-bearing wrapper', () => {
  const bounds = height => ({ left: 12, right: 220, top: 0, bottom: height, width: 208, height });
  const edge = { css: { position: 'absolute' } }, face = { css: { overflow: 'hidden' }, getBoundingClientRect: () => bounds(500) };
  const surface = { children: [edge, face] };
  const node = { firstElementChild: surface, getBoundingClientRect: () => bounds(700), getAttribute: () => 'not-alone-place-card-1', textContent: 'Place 1. The Lair. Full rules.' };
  const context = { nodes: [node], getComputedStyle: element => element.css };
  const result = vm.runInNewContext(`(${h.measureMapCards.toString()})(nodes)`, context);
  assert.equal(result[0].wrapper.height, 700); assert.equal(result[0].face.height, 500);
  assert.equal(result[0].text, node.textContent); assert.equal(result[0].id, 1);
  face.css.overflow = 'visible'; assert.throws(() => vm.runInNewContext(`(${h.measureMapCards.toString()})(nodes)`, context), /face missing/);
});

test('every map-status capture records the full ten-card collection and fences both sizing hooks', () => {
  const branch = source.slice(source.indexOf("} else if (scenario === 'map-status')"), source.indexOf("} else if (scenario === 'hidden-trails')"));
  assert.match(branch, /captureState[\s\S]+measureMapCards[\s\S]+validate: assertStableMapCards/);
  assert.match(source, /qa.capture\([^\n]+\{ frame, align, collection \}/);
  for (const name of ['useMeasuredTextScale.ts', 'useIntrinsicCardHeight.ts', 'not-alone-tactile-fixture-ui.test.cjs']) assert(h.SOURCE_FILES.some(file => file.endsWith(name)));
});

test('map proof rejects stable-sized faces whose positions or identities moved during the screenshot', () => {
  const before = Array.from({ length: 10 }, (_, index) => ({ id: index + 1,
    wrapper: { left: 12, right: 220, top: 10, bottom: 510, width: 208, height: 500 }, face: { left: 12, right: 220, top: 10, bottom: 510, width: 208, height: 500 },
  }));
  h.assertStableMapCards({ before, after: structuredClone(before) });
  for (const part of ['wrapper', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    const after = structuredClone(before); after[9][part][axis] += 1;
    assert.throws(() => h.assertStableMapCards({ before, after }), /geometry changed/);
  }
  assert.throws(() => h.assertStableMapCards({ before, after: [...before].reverse() }), /inventory changed/);
});

test('collection raw geometry survives validation and screenshot failures with exact capture ordering', async () => {
  const { screenshotWithCollection } = require('./not-alone-ui-evidence.cjs');
  const events = [], attempt = {};
  let count = 0;
  const collection = {
    read: async () => { events.push('read'); return [{ width: ++count * 10 }]; },
    validate: sample => { events.push('validate'); assert.equal(sample.before[0].width, 10); assert.equal(sample.after[0].width, 20); throw Error('unequal geometry'); },
  };
  await assert.rejects(screenshotWithCollection({ screenshot: async () => events.push('screenshot') }, {}, attempt, collection, () => events.push('persist')), /unequal geometry/);
  assert.deepEqual(events, ['read', 'persist', 'screenshot', 'read', 'persist', 'validate']);
  assert.deepEqual(attempt.collection, { before: [{ width: 10 }], after: [{ width: 20 }] });
  const failed = {};
  await assert.rejects(screenshotWithCollection({ screenshot: async () => { throw Error('image failed'); } }, {}, failed, collection, () => {}), /image failed/);
  assert.equal(failed.collection.before[0].width, 30); assert.equal(failed.collection.after, undefined);
  let captures = 0;
  await screenshotWithCollection({ screenshot: async () => captures++ }, {}, {}, null, () => { throw Error('unexpected persist'); });
  assert.equal(captures, 1);
});
const env = () => ({ NOT_ALONE_TACTILE_FIXTURE_RUN: 'true', NOT_ALONE_UI_EXCLUSIVE_WINDOW: 'granted',
  NOT_ALONE_TACTILE_SCENARIO: 'seven-final', QA_EXPECTED_WEB_SHA256: 'a'.repeat(64),
  QA_BROWSER_CERT_SPKI: 'A'.repeat(43) + '=', QA_STATIC_ROOT: path.resolve('static'), NOT_ALONE_TACTILE_OUTPUT_DIR: path.resolve('new-evidence') });
function seat() {
  return { name: 'owner', auth: { playerId: 'p1', roomCode: 'ABCD-EFGH' },
    latestPublic: { gameId: 'not_alone', viewerPlayerId: 'p1', roomCode: 'ABCD-EFGH', revision: 3 },
    latestPrivate: { gameId: 'not_alone', playerId: 'p1', roomCode: 'ABCD-EFGH', revision: 3 }, acceptedActions: [], rejections: [] };
}
function result(count = 7) {
  return { browserClosed: true, scenarioComplete: true, findings: [], blockedRequests: [], socketIssues: [], consoleIssues: [],
    cleanup: [{ mode: 'browser-ui', normalUI: true, status: 200, authCleared: true }, { mode: 'browser-ui', normalUI: true, status: 200, authCleared: true },
      ...Array.from({ length: count - 2 }, () => ({ mode: 'socket-owner-rest', status: 200 }))] };
}
const frame = (top, overrides = {}) => ({ text: 'ABCDEFGHIJKLMNOPQRST', bounds: { left: 10, right: 310, top, bottom: top + 900, height: 900 },
  visible: { left: 0, right: 375, top: 0, bottom: 600 }, texts: [], ...overrides });

test('fixture launch requires explicit scope, local URLs, fixed hash/SPKI and absolute outputs', () => {
  assert.equal(h.configFromEnv(env()).count, 7);
  for (const [key, value] of Object.entries({ NOT_ALONE_TACTILE_FIXTURE_RUN: 'false', NOT_ALONE_UI_EXCLUSIVE_WINDOW: '',
    NOT_ALONE_TACTILE_SCENARIO: 'ordinary', NOT_ALONE_API_URL: 'https://example.com', NOT_ALONE_WEB_URL: 'https://example.com',
    QA_EXPECTED_WEB_SHA256: '', QA_BROWSER_CERT_SPKI: '', QA_STATIC_ROOT: 'relative', NOT_ALONE_TACTILE_OUTPUT_DIR: 'relative' })) {
    assert.throws(() => h.configFromEnv({ ...env(), [key]: value }), key);
  }
  for (const scenario of h.SCENARIOS.filter(s => s !== 'seven-final')) assert.equal(h.configFromEnv({ ...env(), NOT_ALONE_TACTILE_SCENARIO: scenario }).count, 3);
});

test('health rejects ordinary service, different scenario, wrong count and non-ok result', () => {
  const config = h.configFromEnv(env()), health = { status: 'ok', service: 'not-alone-ui-fixture', scenario: 'seven-final', expectedSeats: 7 };
  h.validateService(health, config);
  for (const patch of [{ service: 'zuychin-arcade-server' }, { scenario: 'hidden-trails' }, { expectedSeats: 3 }, { status: 'error' }]) assert.throws(() => h.validateService({ ...health, ...patch }, config));
});

test('empty REST leave has only authentication header, never empty JSON content type', () => {
  const options = h.postOptions(undefined, 'test-token');
  assert.deepEqual(options.headers, { Authorization: 'Bearer test-token' }); assert(!Object.hasOwn(options, 'body'));
  assert.equal(h.postOptions({ displayName: 'Test' }).headers['Content-Type'], 'application/json');
  assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
});

function responseRecorder() {
  return { origins: new Set(['http://127.0.0.1:3213']), secrets: new Set(),
    evidence: { cleanup: [], socketIssues: [] }, persisted: 0, persist() { this.persisted += 1; } };
}

function response(pathname, { method = 'POST', status = 200, origin = 'http://127.0.0.1:3213', json } = {}) {
  return { url: () => origin + pathname, request: () => ({ method: () => method }),
    status: () => status, ok: () => status >= 200 && status < 300, json };
}

test('response recorder ignores preflight, GET, unrelated, off-origin and failed auth responses without reading bodies', async () => {
  const actor = seat(), auth = actor.auth, qa = responseRecorder();
  let reads = 0;
  const json = async () => { reads += 1; throw new Error('No JSON body'); };
  for (const [pathname, options] of [
    ['/rooms/join', { method: 'OPTIONS', status: 204 }], ['/rooms/create', { method: 'OPTIONS', status: 204 }],
    ['/rooms/join', { method: 'GET' }], ['/rooms/create', { method: 'GET' }],
    ['/rooms', {}], ['/rooms/join/other', {}], ['/other/rooms/create', {}],
    ['/rooms/join', { origin: 'https://example.com' }], ['/rooms/create', { status: 400 }], ['/rooms/join', { status: 403 }],
    ['/rooms/ABCD-EFGH/leave', { method: 'OPTIONS', status: 204 }],
    ['/rooms/ABCD-EFGH/leave', { method: 'GET' }], ['/rooms/ABCD-EFGH/leave', { origin: 'https://example.com' }],
  ]) await h.recordBrowserResponse(response(pathname, { ...options, json }), actor, qa);
  assert.equal(reads, 0); assert.equal(actor.auth, auth); assert.equal(qa.secrets.size, 0);
  assert.deepEqual(qa.evidence, { cleanup: [], socketIssues: [] }); assert.equal(qa.persisted, 0);
});

test('response recorder captures successful POST create and join authentication', async () => {
  const actor = seat(), qa = responseRecorder();
  for (const [pathname, status, wrapped] of [['/rooms/create', 201, true], ['/rooms/join', 200, false]]) {
    const auth = { playerId: 'p1', roomCode: 'ABCD-EFGH', token: `synthetic-${status}` };
    let reads = 0;
    await h.recordBrowserResponse(response(pathname, { status, json: async () => { reads += 1; return wrapped ? { auth } : auth; } }), actor, qa);
    assert.equal(reads, 1); assert.equal(actor.auth, auth); assert(qa.secrets.has(auth.token));
  }
  assert.deepEqual(qa.evidence, { cleanup: [], socketIssues: [] });
});

test('response recorder retains genuine JSON failures and POST leave evidence', async () => {
  const actor = seat(), qa = responseRecorder();
  for (const pathname of ['/rooms/create', '/rooms/join']) {
    await h.recordBrowserResponse(response(pathname, { json: async () => { throw new Error('Malformed response JSON'); } }), actor, qa);
  }
  assert.deepEqual(qa.evidence.socketIssues, Array.from({ length: 2 }, () => ({ actor: actor.name, event: 'response-observer', message: 'Malformed response JSON' })));
  let reads = 0;
  for (const status of [200, 500]) {
    actor.fallbackCleanup = status !== 200;
    await h.recordBrowserResponse(response('/rooms/ABCD-EFGH/leave', { status, json: async () => { reads += 1; throw new Error('Leave body must not be read'); } }), actor, qa);
  }
  assert.equal(reads, 0); assert.equal(qa.persisted, 4);
  assert.deepEqual(qa.evidence.cleanup, [
    { actor: actor.name, mode: 'browser-ui', normalUI: true, status: 200, authCleared: false },
    { actor: actor.name, mode: 'browser-ui', normalUI: false, status: 500, authCleared: false },
  ]);
});

test('every owned frame validates public viewer, private player, room, game and revision', () => {
  h.assertPair(seat());
  for (const [surface, field, value] of [['latestPublic', 'viewerPlayerId', 'other'], ['latestPrivate', 'playerId', 'other'],
    ['latestPublic', 'roomCode', 'OTHER'], ['latestPrivate', 'roomCode', 'OTHER'], ['latestPrivate', 'revision', 2], ['latestPublic', 'gameId', 'coup']]) {
    const s = seat(); s[surface][field] = value; assert.throws(() => h.assertPair(s));
  }
});

test('accepted command uses actual server hunt_card semantic and exactly one authoritative revision', async () => {
  const handler = fs.readFileSync(path.join(__dirname, '../../server/src/game/not-alone/socketHandlers.ts'), 'utf8');
  assert.match(handler, /apply\(io, socket, value\.room, 'hunt_card', playNotAloneHuntCard/);
  assert.match(source, /accepted\(host, 'hunt_card'/); assert.doesNotMatch(source, /accepted\(host, 'hunt',/);
  const actor = seat(), qa = { evidence: { commands: [] }, persist() {} };
  await h.accepted(actor, 'hunt_card', () => {
    actor.latestPublic.revision = actor.latestPrivate.revision = 4;
    actor.acceptedActions.push({ action: 'hunt_card', revision: 4 });
  }, qa);
  assert.deepEqual(qa.evidence.commands, [{ actor: 'owner', action: 'hunt_card', before: 3, revision: 4 }]);
  for (const mode of ['wrong-kind', 'duplicate', 'rejected']) {
    const s = seat();
    await assert.rejects(h.accepted(s, 'hunt_card', () => {
      s.latestPublic.revision = s.latestPrivate.revision = 4;
      s.acceptedActions.push({ action: mode === 'wrong-kind' ? 'hunt' : 'hunt_card', revision: 4 });
      if (mode === 'duplicate') s.acceptedActions.push({ action: 'hunt_card', revision: 4 });
      if (mode === 'rejected') s.rejections.push({ reason: 'stale' });
    }, qa));
  }
});

test('anonymous sealed progress excludes submitting identity and private destinations', () => {
  const state = { pendingCardChoice: { kind: 'forbidden_zone', playerId: null, count: 1, submittedCount: 1, eligibleCount: 2 } };
  h.assertAnonymousPending(state, 1);
  for (const patch of [{ playerId: 'p1' }, { submittedCount: 2 }, { eligibleCount: 3 }, { secret: [2] }]) assert.throws(() => h.assertAnonymousPending({ pendingCardChoice: { ...state.pendingCardChoice, ...patch } }, 1));
  assert.throws(() => h.assertAnonymousPending({ ...state, selectedPlaces: [2] }, 1));
});

test('Smokescreen requires nonempty true trails and creature redaction, not empty-trail vacuity', () => {
  const creature = { players: ['p1', 'p2'].map(playerId => ({ playerId, role: 'hunted', discardCount: 1, discard: [] })) };
  const hunted = { players: creature.players.map(p => ({ ...p, discard: [3] })) };
  h.assertHiddenTrails(creature, hunted);
  assert.throws(() => h.assertHiddenTrails(hunted, hunted));
  assert.throws(() => h.assertHiddenTrails(creature, creature));
});

test('all seven unique names are legal 20-codepoint unbroken names and capture budget covers every row', () => {
  assert.equal(new Set(h.NAMES).size, 7); assert(h.NAMES.every(n => [...n].length === 20 && !/\s/.test(n)));
  assert.match(source, /for \(const index of NAMES\.keys\(\)\)/);
  const pending = 8, summaries = 12, names = h.NAMES.length * 12, actions = 8;
  assert.equal(pending + summaries + names + actions, 112); assert.equal(h.CAPTURE_LIMIT, 120);
  assert(pending + summaries + names + actions <= h.CAPTURE_LIMIT);
  assert.match(source, /qa\.evidence\.attempts\.length < CAPTURE_LIMIT/);
});

test('full name/card proof rejects missing, horizontally clipped or vertically unframed content', () => {
  h.assertFullFrames([frame(0), frame(-300)], h.NAMES[0]);
  assert.throws(() => h.assertFullFrames([frame(0), frame(-300)], 'TRUNCATED'));
  assert.throws(() => h.assertFullFrames([frame(-20), frame(-300)]), /vertical gap/);
  assert.throws(() => h.assertFullFrames([frame(0), frame(-100)]), /bottom is not captured/);
  assert.throws(() => h.assertFullFrames([frame(0, { visible: { left: 30, right: 375, top: 0, bottom: 600 } }), frame(-300)]), /horizontally clipped/);
  assert.throws(() => h.assertFullFrames([frame(0, { texts: [{ glyphRects: [{ left: 10, right: 350, top: 10, bottom: 30 }] }] }), frame(-300)]), /own bounds/);
});

test('source fence hashes real runner, canonical factory, route, cards, hooks and evidence helpers', () => {
  const hashes = h.sourceHashes(); assert.equal(Object.keys(hashes).length, h.SOURCE_FILES.length);
  assert(Object.values(hashes).every(value => /^[a-f0-9]{64}$/.test(value)));
  for (const suffix of ['ui-fixture.ts', 'ui-fixtures.ts', 'ui-tactile-fixtures.ts', 'PlaceCard.tsx', 'CardChip.tsx', 'PlaceChoiceRow.tsx', 'useNotAloneActions.ts', 'not-alone-tactile-fixture-ui.cjs']) assert(h.SOURCE_FILES.some(f => f.endsWith(suffix)));
  assert(Object.hasOwn(hashes, 'apps/server/scripts/not-alone/ui-tactile-fixtures.ts'));
  assert.match(source, /finalSourceHashes = sourceHashes\(\)/);
  assert.match(source, /assert\.deepEqual\(qa\.evidence\.finalSourceHashes, qa\.evidence\.sourceHashes/);
});

test('cleanup cannot convert REST fallback or missing auth clearance into normal UI pass', () => {
  assert.deepEqual(h.completionStatus(result(), 7), { cleanupComplete: true, passed: true });
  for (const mutate of [r => r.cleanup[0].authCleared = false, r => r.cleanup[2].status = 400,
    r => r.cleanup.push({ fallback: true, status: 200 }), r => r.cleanup.push({ uiError: 'timeout' }), r => r.browserClosed = false]) {
    const r = result(); mutate(r); assert.equal(h.completionStatus(r, 7).passed, false);
  }
  for (const mutate of [r => r.failure = 'failed', r => r.watchdogExpired = true, r => r.findings.push({}),
    r => r.blockedRequests.push({}), r => r.socketIssues.push({}), r => r.consoleIssues.push({}), r => r.scenarioComplete = false]) {
    const r = result(); mutate(r); assert.equal(h.completionStatus(r, 7).passed, false);
  }
});

test('runner is explicitly fixture-only and preserves fixed input modes and modal cleanup scopes', () => {
  assert.match(source, /isMobile: !desktop, hasTouch: !desktop/);
  assert.match(source, /edge320 \? \[\{ \.\.\.original, width: 320 \}\]/);
  assert.match(source, /frameLabel\(seat\.page, 'BACK TO ARCADE', '#not-alone-game-over'\)/);
  assert.match(source, /normal fixture exit clears authentication/);
  assert.match(source, /15 \* 60_000/);
  assert.doesNotMatch(source, /fetch\([^\n]*fixture|state\.players\.set|\.evaluate\([^\n]*window\.__store/);
});
