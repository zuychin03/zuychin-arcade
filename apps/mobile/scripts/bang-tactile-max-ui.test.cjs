const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const h = require('./bang-tactile-max-ui.cjs');

const env = () => ({ BANG_TACTILE_MAX_RUN: 'true', BANG_UI_EXCLUSIVE_WINDOW: 'granted', QA_EXPECTED_WEB_SHA256: 'a'.repeat(64),
  QA_BROWSER_CERT_SPKI: 'A'.repeat(43) + '=', QA_STATIC_ROOT: path.resolve('frozen-export'), BANG_TACTILE_MAX_OUTPUT_DIR: path.resolve('new-max-evidence') });
const seats = () => h.NAMES.map((name, i) => ({ name, auth: { token: 'synthetic-' + i, playerId: 'p' + i, roomCode: 'ABCD-EFGH', displayName: name },
  private: { gameId: 'bang', playerId: 'p' + i, roomCode: 'ABCD-EFGH', revision: 0, hand: [{ id: 'card' + i }] },
  public: { gameId: 'bang', roomCode: 'ABCD-EFGH', revision: 0 } }));
const state = sheriff => ({ status: 'playing', players: h.NAMES.map((displayName, i) => ({ displayName, playerId: 'p' + i, role: i === sheriff ? 'sheriff' : null, alive: true })) });
const frame = (top = 10, height = 500, patch = {}) => ({ text: h.NAMES[0], bounds: { left: 10, right: 310, width: 300, top, bottom: top + height, height },
  visible: { left: 0, right: 375, top: 0, bottom: 600 }, glyphs: [{ left: 20, right: 40, top: top + 10, bottom: top + 26 }], ...patch });

test('explicit launch guards reject missing permission, hosted origins, fixture mode and mutable export identity', () => {
  const c = h.configFromEnv(env()); assert.equal(c.api, 'http://127.0.0.1:3213'); assert.equal(c.browserApi, 'https://localhost:3214');
  for (const [key, value] of Object.entries({ BANG_TACTILE_MAX_RUN: '', BANG_UI_EXCLUSIVE_WINDOW: '', BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURES_ONLY: 'true',
    BANG_API_URL: 'https://example.com', BANG_WEB_URL: 'http://example.com', QA_EXPECTED_WEB_SHA256: '', QA_BROWSER_CERT_SPKI: '', QA_STATIC_ROOT: 'relative', BANG_TACTILE_MAX_OUTPUT_DIR: 'relative' })) {
    assert.throws(() => h.configFromEnv({ ...env(), [key]: value }), key);
  }
  for (const url of ['http://user:pass@localhost:3213', 'ws://localhost:3213', 'http://localhost:3213/fixture', 'http://localhost:3213/?secret=x', 'http://localhost:3213/#fragment']) {
    assert.throws(() => h.configFromEnv({ ...env(), BANG_API_URL: url }));
  }
  assert.throws(() => h.configFromEnv({ ...env(), BANG_API_URL: 'http://127.0.0.1:8081' }));
});

test('health accepts only ordinary Arcade service without fixture metadata', () => {
  h.validateService({ status: 'ok', service: 'zuychin-arcade-server' });
  for (const health of [null, {}, { status: 'error', service: 'zuychin-arcade-server' }, { status: 'ok', service: 'bang-ui-fixture' },
    { status: 'ok', service: 'zuychin-arcade-server', scenario: 'seven-final' }, { status: 'ok', service: 'zuychin-arcade-server', expectedSeats: 7 }]) assert.throws(() => h.validateService(health));
});

test('names are seven distinct unbroken twenty-character names and capture work is bounded', () => {
  assert.equal(h.NAMES.length, 7); assert.equal(new Set(h.NAMES).size, 7);
  assert(h.NAMES.every(name => /^[A-Z]{20}$/.test(name)));
  assert.equal(h.CAPTURE_LIMIT, 120); assert.equal(h.WATCHDOG_MS, 900000);
  const all = seats(), chosen = h.selectOwners(state(0), all, 'p0');
  const plan = h.capturePlan(state(0).players, chosen.owners);
  assert.equal(plan.length, 36);
  for (const owner of chosen.owners) {
    const own = plan.filter(job => job.ownerId === owner.auth.playerId);
    assert.equal(own.filter(job => job.phase === 'playing' && job.name).length, 7);
    assert.equal(own.filter(job => job.phase === 'game_over' && job.name).length, 8);
    assert(own.some(job => job.selector === '#bang-card-hand-' + owner.private.hand[0].id));
    assert(own.some(job => job.selector === '#bang-result-summary'));
    assert(own.some(job => job.phase === 'game_over' && job.selector === '#bang-table-context' && !job.edge320));
    assert(own.some(job => job.phase === 'game_over' && job.selector === '#bang-seat-' + owner.auth.playerId && !job.edge320));
  }
  assert.equal(plan.filter(job => job.edge320).length, 2);
  assert(plan.filter(job => job.edge320).every(job => job.ownerId === chosen.owners[0].auth.playerId));
  const profiles = plan.reduce((count, job) => count + (job.edge320 ? 4 : 2), 0);
  assert.equal(profiles, h.CAPTURE_PLAN.requiredProfiles);
  assert.equal(profiles, 76);
  assert.equal(h.CAPTURE_PLAN.additionalEndpointAllowance, 44);
  assert.equal(profiles * 2, h.CAPTURE_PLAN.naiveDuplicateEndpoints);
  assert.equal(profiles + h.CAPTURE_PLAN.additionalEndpointAllowance, h.CAPTURE_LIMIT);
  chosen.owners[0].private.hand = [];
  assert.throws(() => h.capturePlan(state(0).players, chosen.owners));
});

test('public Sheriff controls owner selection even when the original host is Sheriff', () => {
  for (let sheriff = 0; sheriff < 7; sheriff++) {
    const all = seats(), selected = h.selectOwners(state(sheriff), all, 'p0');
    assert.equal(selected.sheriff, all[sheriff]);
    assert.equal(new Set(selected.owners).size, 2);
    assert(!selected.owners.includes(all[sheriff]));
    assert.equal(selected.owners[0], all[sheriff === 0 ? 1 : 0]);
    assert.equal(selected.owners[1], all[sheriff === 0 || sheriff === 1 ? 2 : 1]);
  }
  const altered = state(0); altered.players[2].role = 'sheriff';
  assert.throws(() => h.selectOwners(altered, seats(), 'p0'));
  altered.players[2].role = 'outlaw';
  assert.throws(() => h.selectOwners(altered, seats(), 'p0'));
  assert.throws(() => h.selectOwners({ ...state(0), status: 'game_over' }, seats(), 'p0'));
});

test('coverage cannot pass with a missing owner, scale, endpoint or complete historical row', () => {
  const owners = h.selectOwners(state(0), seats(), 'p0').owners, plan = h.capturePlan(state(0).players, owners);
  const proofs = plan.flatMap(job => [job.ownerId === owners[0].auth.playerId ? 375 : 1280, ...(job.edge320 ? [320] : [])].flatMap(width => [100, 200].map(scale => ({
    ownerId: job.ownerId, selector: job.selector, viewport: { width }, scale, phase: job.phase, complete: true, endpoints: ['start', 'end'], terminalCopyChecked: job.phase === 'game_over',
  }))));
  h.assertCaptureCoverage(plan, proofs, owners);
  assert.throws(() => h.assertCaptureCoverage(plan, proofs.slice(1), owners));
  for (const patch of [{ ownerId: 'other' }, { phase: 'game_over' }, { scale: 150 }, { viewport: { width: 414 } }, { complete: false }, { endpoints: ['start'] }]) {
    assert.throws(() => h.assertCaptureCoverage(plan, [{ ...proofs[0], ...patch }, ...proofs.slice(1)], owners));
  }
  const terminalOwn = proofs.findIndex(p => p.phase === 'game_over' && p.selector === '#bang-seat-' + owners[0].auth.playerId);
  assert(terminalOwn >= 0);
  for (const patch of [{ phase: 'playing' }, { terminalCopyChecked: false }]) {
    assert.throws(() => h.assertCaptureCoverage(plan, proofs.map((p, i) => i === terminalOwn ? { ...p, ...patch } : p), owners));
  }
});

test('adoption keeps only authenticated own seat fields and validates the actual room identity', () => {
  const original = seats()[0].auth;
  assert.deepEqual(h.ownedAuth({ ...original, room: { private: 'not adopted' } }, h.NAMES[0]), original);
  assert.deepEqual(h.ownedAuth({ auth: original }, h.NAMES[0]), original);
  assert.throws(() => h.ownedAuth({ ...original, roomCode: 'OTHER' }, h.NAMES[0]));
  assert.throws(() => h.ownedAuth(original, 'Unknown owner'));
  const seat = seats()[0]; assert(h.hasPair(seat));
  for (const [surface, key, value] of [['private', 'playerId', 'p1'], ['private', 'revision', 1], ['public', 'revision', -1], ['public', 'roomCode', 'OTHER'], ['private', 'gameId', 'coup']]) {
    const candidate = seats()[0]; candidate[surface][key] = value; assert.equal(h.hasPair(candidate), false);
  }
});

test('all mounted public stations retain complete names and exactly projected role visibility', () => {
  const publicState = state(3);
  const rendered = publicState.players.map(p => ({ id: 'bang-seat-' + p.playerId, text: p.displayName, roleText: p.role ? 'Sheriff' : 'Hidden role', roleLabels: [] }));
  h.assertMountedSeats(rendered, publicState);
  for (const patch of [{ text: h.NAMES[0].slice(0, 19) }, { roleText: null }, { roleText: 'Outlaw' }, { roleLabels: ['secret deputy'] }]) {
    assert.throws(() => h.assertMountedSeats([{ ...rendered[0], ...patch }, ...rendered.slice(1)], publicState));
  }
  assert.throws(() => h.assertMountedSeats(rendered.slice(1), publicState));
  rendered[3].roleText = 'Hidden role'; assert.throws(() => h.assertMountedSeats(rendered, publicState));
});

test('terminal DOM checks inspect actual status nodes without mistaking character ability prose for turn metadata', () => {
  const publicState = { ...state(3), status: 'game_over' };
  const nodes = publicState.players.map(p => ({ id: 'bang-seat-' + p.playerId, children: [
    { textContent: p.displayName }, { textContent: 'Paul RegretOther players see you at distance 1 farther.' }, { textContent: 'Connected' },
  ] }));
  const rendered = publicState.players.map(p => ({ id: 'bang-seat-' + p.playerId, text: p.displayName, roleText: p.role ? 'Sheriff' : 'Hidden role', roleLabels: [] }));
  let caption = 'Final table in clockwise seat order. All roles are revealed.';
  const context = { document: { querySelector: () => ({ textContent: caption }), querySelectorAll: () => nodes } };
  vm.runInNewContext('globalThis.read = ' + h.readTerminalCopy.toString(), context);
  const inspect = () => h.assertTerminalCopy(context.read(), rendered, publicState);
  assert.deepEqual(inspect(), { caption, stationsChecked: 7, noLiveTurnOrNumericDistance: true });
  for (let i = 0; i < 7; i++) for (const text of ['TAKING TURN', 'Active seat', 'Active seat · Connected', 'Distance 99 · Connected', 'Distance 2 · Reconnecting', 'Distance 0']) {
    nodes[i].children.push({ textContent: text });
    assert.throws(inspect, /retained live turn or numeric distance/);
    nodes[i].children.pop();
  }
  caption = 'Clockwise seat order. Distance is from a departed Sheriff.';
  assert.throws(inspect, /caption/);
  caption = 'Final table in clockwise seat order. All roles are revealed.';
  nodes.pop(); assert.throws(inspect);
  assert.throws(() => h.assertMountedSeats(rendered, publicState), /status nodes/);
});

test('ordinary REST payload includes explicit origin; bodyless leave never carries JSON content type', () => {
  const leave = h.postOptions(undefined, 'synthetic-token', 'http://localhost:8081');
  assert.deepEqual(leave.headers, { Origin: 'http://localhost:8081', Authorization: 'Bearer synthetic-token' });
  assert(!Object.hasOwn(leave, 'body')); assert.equal(leave.redirect, 'error'); assert(leave.signal instanceof AbortSignal);
  const create = h.postOptions({ displayName: h.NAMES[0], gameId: 'bang' }, undefined, 'http://localhost:8081');
  assert.equal(create.headers['Content-Type'], 'application/json'); assert.equal(JSON.parse(create.body).gameId, 'bang');
  assert.throws(() => h.postOptions({}, undefined, 'https://example.com'));
});

test('endpoint image is shared only when all frame boundaries and glyphs are visible', () => {
  assert(h.wholeFrameVisible(frame())); h.assertFrameCoverage([frame()], h.NAMES[0]);
  assert.equal(h.wholeFrameVisible(frame(10, 900)), false);
  assert.throws(() => h.assertFrameCoverage([frame(10, 900)], h.NAMES[0]));
  assert.equal(h.wholeFrameVisible(frame(10, 500, { glyphs: [{ left: 360, right: 400, top: 30, bottom: 45 }] })), false);
  assert.throws(() => h.assertFrameCoverage([frame()], h.NAMES[1]));
});

test('two endpoint captures must overlap and cover the whole node without glyph clipping', () => {
  h.assertFrameCoverage([frame(0, 900), frame(-300, 900)], h.NAMES[0]);
  assert.throws(() => h.assertFrameCoverage([frame(0, 1300), frame(-700, 1300)], h.NAMES[0]));
  assert.throws(() => h.assertFrameCoverage([frame(0, 900), frame(-300, 910)], h.NAMES[0]));
  assert.throws(() => h.assertFrameCoverage([frame(0, 900, { glyphs: [{ left: 0, right: 20, top: 30, bottom: 44 }] }), frame(-300, 900)], h.NAMES[0]));
});

test('recorded header and footer occlusion cannot be counted as a complete single frame', () => {
  for (const visible of [{ left: 0, right: 375, top: 64, bottom: 600 }, { left: 0, right: 375, top: 0, bottom: 480 }]) {
    const raw = frame(), recorded = h.recordedFrame(raw, { frame: raw.bounds, frameVisibleBounds: visible });
    assert(h.wholeFrameVisible(raw)); assert.equal(h.wholeFrameVisible(recorded), false);
    assert.throws(() => h.assertFrameCoverage([recorded], h.NAMES[0]));
    assert.deepEqual(raw.visible, { left: 0, right: 375, top: 0, bottom: 600 });
  }
  const raw = frame(80, 350, { visible: { left: 12, right: 320, top: 20, bottom: 580 } });
  const recorded = h.recordedFrame(raw, { frame: raw.bounds, frameVisibleBounds: { left: 0, right: 375, top: 64, bottom: 500 } });
  assert.deepEqual(recorded.visible, { left: 12, right: 320, top: 64, bottom: 500 });
});

test('endpoint coverage uses recorded fixed-chrome bounds and rejects occluded gaps', () => {
  const visible = { left: 0, right: 375, top: 64, bottom: 550 };
  const record = f => h.recordedFrame(f, { frame: f.bounds, frameVisibleBounds: visible });
  const oldPass = [frame(0, 900), frame(-300, 900)];
  h.assertFrameCoverage(oldPass, h.NAMES[0]);
  assert.throws(() => h.assertFrameCoverage(oldPass.map(record), h.NAMES[0]));
  h.assertFrameCoverage([frame(64, 900), frame(-350, 900)].map(record), h.NAMES[0]);
  assert.throws(() => h.assertFrameCoverage([frame(64, 1100), frame(-550, 1100)].map(record), h.NAMES[0]));
});

test('capture visibility fails closed when absent, invalid or stale relative to measured content', () => {
  const raw = frame();
  for (const frameVisibleBounds of [undefined, null, {}, { left: 0, right: Infinity, top: 0, bottom: 600 }, { left: 375, right: 0, top: 0, bottom: 600 }]) {
    assert.throws(() => h.recordedFrame(raw, { frame: raw.bounds, frameVisibleBounds }));
  }
  assert.throws(() => h.recordedFrame(raw, { frameVisibleBounds: raw.visible }));
  assert.throws(() => h.recordedFrame(raw, { frame: { ...raw.bounds, top: raw.bounds.top + 3 }, frameVisibleBounds: raw.visible }));
  assert(h.wholeFrameVisible(h.recordedFrame(raw, { frame: raw.bounds, frameVisibleBounds: raw.visible })));
});

test('partial CSS200 convergence failure restores text and viewport without claiming the missing profile', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'bang-tactile-max-ui.cjs'), 'utf8');
  const captureJob = source.slice(source.indexOf('async function captureJob('), source.indexOf('\nasync function activate('));
  let enlarged = false, restores = 0;
  const original = { width: 375, height: 844, hasTouch: true, isMobile: true };
  const viewports = [];
  const failure = Error('Synthetic non-convergence after partial CSS mutation');
  const context = {
    assert, CAPTURE_LIMIT: h.CAPTURE_LIMIT, assertPair() {}, assertMountedSeats() {}, assertFrameCoverage() {}, stampScale() {},
    recordedFrame: measured => measured, measureFrame() {}, wholeFrameVisible: () => true,
    enlargeBangText: async () => { enlarged = true; throw failure; },
    restoreBangText: async () => { restores++; enlarged = false; },
  };
  vm.runInNewContext(captureJob + '\nglobalThis.capture = captureJob;', context);
  const seat = { auth: { playerId: 'qa-owner' }, name: 'QA', public: { status: 'playing', revision: 1 }, page: {
    viewport: () => original, setViewport: async viewport => { viewports.push(viewport); }, evaluate: async () => ({}),
  } };
  const qa = { evidence: { attempts: [], proofs: [] }, ready: async () => {}, persist() {}, capture: async () => {
    assert.equal(enlarged, false, 'A failed enlargement must not proceed to a screenshot');
    qa.evidence.attempts.push({ file: 'normal.png' }); return { file: 'normal.png', metrics: { seats: [] } };
  } };
  await assert.rejects(context.capture(seat, { phase: 'playing', label: 'station', selector: '#qa' }, qa), error => error === failure);
  assert.equal(restores, 1); assert.equal(enlarged, false); assert.equal(viewports.at(-1), original);
  assert.equal(qa.evidence.attempts.length, 1); assert.equal(qa.evidence.proofs.length, 1);
  assert.equal(qa.evidence.proofs[0].scale, 100, 'Only the completed normal-text profile may be proven');
  assert(!qa.evidence.proofs.some(proof => proof.scale === 200));
});

test('terminal capture records actual absence checks before claiming either text-size proof', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'bang-tactile-max-ui.cjs'), 'utf8');
  const captureJob = source.slice(source.indexOf('async function captureJob('), source.indexOf('\nasync function activate('));
  const publicState = { ...state(3), status: 'game_over', revision: 1 };
  const rendered = publicState.players.map(p => ({ id: 'bang-seat-' + p.playerId, text: p.displayName, roleText: p.role ? 'Sheriff' : 'Hidden role', roleLabels: [] }));
  const copy = { caption: 'Final table in clockwise seat order. All roles are revealed.', stations: rendered.map(p => ({ id: p.id, statusTexts: ['Connected'] })) };
  const context = { assert, CAPTURE_LIMIT: h.CAPTURE_LIMIT, assertPair() {}, stampScale() {},
    assertTerminalCopy: h.assertTerminalCopy, readTerminalCopy: h.readTerminalCopy,
    assertMountedSeats: h.assertMountedSeats, assertFrameCoverage: h.assertFrameCoverage,
    recordedFrame: h.recordedFrame, wholeFrameVisible: h.wholeFrameVisible, measureFrame() {},
    enlargeBangText: async () => [], restoreBangText: async () => {}, validateBangFontState() {}, readBangFontState() {},
  };
  vm.runInNewContext(captureJob + '\nglobalThis.capture = captureJob;', context);
  const original = { width: 375, height: 844, hasTouch: true, isMobile: true };
  const seat = { auth: { playerId: 'p0' }, name: h.NAMES[0], public: publicState, page: {
    viewport: () => original, setViewport: async () => {},
    evaluate: async fn => fn === h.readTerminalCopy ? copy : fn === context.measureFrame ? frame() : {},
  } };
  const qa = { evidence: { attempts: [], proofs: [], terminalCopyAssertions: [] }, ready: async () => {}, persist() {},
    capture: async () => { const file = 'capture-' + qa.evidence.attempts.length; qa.evidence.attempts.push({ file });
      return { file, metrics: { seats: rendered, frame: frame().bounds, frameVisibleBounds: frame().visible } }; },
  };
  const job = { phase: 'game_over', label: 'terminal-own-station', selector: '#bang-seat-p0', name: h.NAMES[0] };
  await context.capture(seat, job, qa);
  assert.equal(qa.evidence.proofs.length, 2);
  assert(qa.evidence.proofs.every(proof => proof.terminalCopyChecked));
  assert.deepEqual(qa.evidence.terminalCopyAssertions.map(check => [check.ownerId, check.revision, check.stationsChecked, check.noLiveTurnOrNumericDistance]), [['p0', 1, 7, true], ['p0', 1, 7, true]]);
  copy.stations[6].statusTexts.push('Distance 99 · Connected');
  await assert.rejects(context.capture(seat, job, qa), /retained live turn or numeric distance/);
  assert.equal(qa.evidence.proofs.length, 2, 'A failing terminal DOM check cannot add a proof');
  assert.equal(qa.evidence.terminalCopyAssertions.length, 2);
});

test('leave observer ignores preflight, off-origin, and another room without parsing authentication', async () => {
  const seat = seats()[0], qa = { origins: new Set(['https://localhost:3214']), secrets: new Set(), evidence: { cleanup: [], consoleIssues: [] }, persist() {} };
  const response = (method, url, status = 200) => ({ request: () => ({ method: () => method }), url: () => url, status: () => status, json() { assert.fail('Leave recorder must not read JSON'); } });
  for (const [method, url] of [['OPTIONS', 'https://localhost:3214/rooms/ABCD-EFGH/leave'], ['POST', 'https://example.com/rooms/ABCD-EFGH/leave'],
    ['POST', 'https://localhost:3214/rooms/OTHER-CODE/leave'], ['POST', 'https://localhost:3214/rooms/create']]) await h.recordResponse(response(method, url), seat, qa);
  assert.equal(qa.evidence.cleanup.length, 0);
  await h.recordResponse(response('POST', 'https://localhost:3214/rooms/ABCD-EFGH/leave'), seat, qa);
  assert.equal(qa.evidence.cleanup.length, 1); assert.equal(qa.evidence.cleanup[0].playerId, seat.auth.playerId);
});

function completed() {
  return { scenarioComplete: true, browserClosed: true, contextsClosed: ['phone', 'desktop'], findings: [], blockedRequests: [], socketIssues: [], consoleIssues: [],
    cleanup: Array.from({ length: 7 }, (_, i) => ({ playerId: 'p' + i, status: 200, mode: i < 2 ? 'browser-ui' : 'socket-owner-rest', normalUI: i < 2, authCleared: i < 2 })) };
}
test('completion needs exactly two normal UI exits, five socket exits, all seven identities and closed contexts', () => {
  assert(h.completionStatus(completed()).passed);
  for (const update of [e => { e.cleanup[0].authCleared = false; }, e => { e.cleanup[1].playerId = 'p0'; }, e => { e.contextsClosed.pop(); },
    e => { e.cleanup.push({ fallback: true }); }, e => { e.watchdogExpired = true; }, e => { e.socketIssues.push('failure'); }, e => { e.scenarioComplete = false; }, e => { e.failure = 'interrupted'; }]) {
    const e = completed(); update(e); assert.equal(h.completionStatus(e).passed, false);
  }
});

test('packet decoder ignores handshake and malformed payloads', () => {
  assert.deepEqual(h.packet('42["game_state",{"gameId":"bang"}]'), ['game_state', { gameId: 'bang' }]);
  for (const raw of [undefined, null, '2', '40', '42oops', '42{}']) assert.equal(h.packet(raw), null);
});

test('source fence includes route, material, native attention and authoritative rules without fetching anything', () => {
  const hashes = h.sourceHashes();
  assert.equal(Object.keys(hashes).length, h.SOURCE_FILES.length);
  assert(Object.values(hashes).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  for (const suffix of ['bang/game.tsx', 'bang/Card.tsx', 'bang/CardArtwork.tsx', 'bang/layout.ts', 'bang-layout.test.cjs', 'bang-ui-evidence.cjs', 'bang-tactile-max-ui.test.cjs', 'roomLifecycle.ts', 'bang/engine.ts']) {
    assert(h.SOURCE_FILES.some(file => file.endsWith(suffix)), suffix);
  }
});
