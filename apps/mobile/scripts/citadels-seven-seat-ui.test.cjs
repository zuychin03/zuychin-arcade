const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SCENARIO, NAMES, PROFILES, checkProjection, checkCardCoverage, post, completionStatus } = require('./citadels-seven-seat-ui.cjs');
const source = fs.readFileSync(path.join(__dirname, 'citadels-seven-seat-ui.cjs'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../../server/scripts/citadels/ui-fixture-server.ts'), 'utf8');
const canonical = fs.readFileSync(path.join(__dirname, '../../server/scripts/citadels/ui-fixtures.ts'), 'utf8');

test('seven-seat case is separate from the default four-seat scenario list', () => {
  assert.equal(SCENARIO, 'seven_seat_layout'); assert.equal(NAMES.length, 7); assert.equal(NAMES[6].length, 20);
  const names = canonical.match(/CITADELS_SEVEN_LAYOUT_NAMES = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.deepEqual(NAMES, names);
  assert(!canonical.match(/CITADELS_UI_FIXTURE_SCENARIOS = \[([\s\S]*?)\] as const/)[1].includes(SCENARIO));
  assert.match(server, /process.env.CITADELS_SEVEN_SEAT_LAYOUT === 'true'/);
  assert.match(server, /requiredNames.every/); assert.match(server, /player.isConnected && !player.hasLeft/);
  assert.match(server, /assert.equal\(supabase, null/); assert.match(server, /host: '127.0.0.1'/);
});

function fixtureSeat() {
  const players = NAMES.map((displayName, i) => ({ playerId: String(i), displayName, revealedRole: i === 0 ? 'magician' : i === 6 ? 'thief' : null, forfeited: false }));
  return { name: NAMES[0], auth: { playerId: '0', roomCode: 'COURT' }, public: { roomCode: 'COURT', revision: 10, players }, private: { playerId: '0', roomCode: 'COURT', revision: 10, hand: Array(6).fill({}), canAct: true } };
}
test('projection gate rejects wrong owner, revision, leaked hand and uncalled role', () => {
  checkProjection(fixtureSeat(), 10);
  for (const mutate of [s => { s.private.playerId = 'other'; }, s => { s.private.revision = 9; }, s => { s.public.players[1].hand = []; }, s => { s.public.players[1].revealedRole = 'king'; }, s => { s.public.players[6].forfeited = true; }]) {
    const seat = fixtureSeat(); mutate(seat); assert.throws(() => checkProjection(seat, 10));
  }
});

function cardRecord(top, bottom, left = 10, right = 210) {
  return { file: `${top}.png`, metrics: { containment: { cards: [{ id: 'citadels-district-card-test', bounds: { left, right, top, bottom }, visibleBounds: { left: 0, right: 320, top: 0, bottom: 900 } }] } } };
}
test('rail coverage requires full horizontal containment and gap-free vertical union', () => {
  const result = checkCardCoverage([cardRecord(0, 1200), cardRecord(-300, 900)], 'test');
  assert.equal(result.slices.length, 2);
  assert.throws(() => checkCardCoverage([cardRecord(0, 1900), cardRecord(-1000, 900)], 'test'), /without a gap/);
  assert.throws(() => checkCardCoverage([cardRecord(0, 1200, -10), cardRecord(-300, 900)], 'test'), /horizontally/);
  assert.throws(() => checkCardCoverage([cardRecord(0, 1200), cardRecord(-400, 900)], 'test'), /stable/);
});

test('runner keeps two browser pages and five ordinary authenticated socket owners', () => {
  assert.equal((source.match(/await browserSeat\(browser,/g) ?? []).length, 2);
  assert.match(source, /for \(const name of NAMES.slice\(2\)\)/);
  assert.match(source, /post\(api, '\/rooms\/join'/);
  assert.match(source, /auth: \{ token: auth.token \}/);
  assert.match(source, /transports: \['websocket'\]/);
  assert.match(source, /seven authenticated connected lobby seats/);
  assert.doesNotMatch(source, /sessionStorage.setItem|citadelsPublic\s*=|citadelsPrivate\s*=|setState\(/);
  assert(source.indexOf('await qa.calibrate(browser)') < source.indexOf('const host = await browserSeat'));
});

test('each viewport has calibrated bounded receipts, framed owners and all actual rail ends', () => {
  assert.deepEqual(PROFILES.map(p => p.width), [320, 375, 1280]);
  assert.match(source, /path.join\(outputDir, String\(profile.width\)\)/);
  assert.match(source, /for \(const scale of \[false, true\]\)/);
  assert.match(source, /expectedText: player.displayName/);
  assert.match(source, /citadels-roster-name-/); assert.match(source, /citadels-city-name-/);
  assert.match(source, /player.city\[0\].*player.city.at\(-1\)/);
  assert.match(source, /actor.private.hand\[0\].*actor.private.hand.at\(-1\)/);
  assert.match(source, /for \(const align of \['start', 'end'\]\)/);
  assert.match(source, /rivalHandNodes, 0/); assert.match(source, /publicRoleNodes, 0/);
  assert.match(source, /observer must not/i);
});

test('launch and cleanup gates distinguish two UI leaves from five owner REST releases', () => {
  for (const flag of ['CITADELS_UI_EXCLUSIVE_WINDOW', 'CITADELS_UI_FIXTURE_RUN', 'CITADELS_SEVEN_SEAT_LAYOUT']) assert(source.includes(`process.env.${flag}`));
  assert.match(source, /service.service, 'citadels-local-ui-fixtures'/); assert.match(source, /service.sevenSeatLayout, true/);
  assert.match(source, /receipt.finalBundle = await bundleFence/); assert.match(source, /local\(base\); local\(api\)/);
  assert.match(source, /await h.leavePlayerUI\(seat\)/);
  assert.match(source, /r.mode === 'browser-ui' && r.normalUI && r.status === 200 && r.authCleared\).length === 2/);
  assert.match(source, /r.mode === 'socket-owner-rest' && r.status === 200\).length === 5/);
  assert.match(source, /seat.cleaning = true/); assert.match(source, /seat.socket\?\.disconnect\(\)/);
  assert.match(source, /20 \* 60_000/); assert.match(source, /redact\(receipt, \[...secrets\]\)/);
  assert.doesNotMatch(source, /fullPage: true|deviceScaleFactor: 2/);
});

test('POST emits JSON content type only for a serialised body, including authenticated empty-body leave', async t => {
  const calls = [], response = { status: 200 };
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return response; });
  assert.equal(await post('http://127.0.0.1:3213', '/rooms/COURT/leave', undefined, 'synthetic-owner-token'), response);
  const [url, empty] = calls[0];
  assert.equal(url, 'http://127.0.0.1:3213/rooms/COURT/leave');
  assert.equal(empty.method, 'POST'); assert.equal(empty.redirect, 'error'); assert(empty.signal instanceof AbortSignal);
  assert.equal(empty.headers.Authorization, 'Bearer synthetic-owner-token');
  assert(!Object.hasOwn(empty.headers, 'Content-Type')); assert(!Object.hasOwn(empty, 'body'));
  await post('http://127.0.0.1:3213', '/rooms/join', { roomCode: 'COURT', displayName: 'Fixture Third' });
  const body = calls[1][1];
  assert.equal(body.headers['Content-Type'], 'application/json'); assert(!Object.hasOwn(body.headers, 'Authorization'));
  assert.deepEqual(JSON.parse(body.body), { roomCode: 'COURT', displayName: 'Fixture Third' });
  await post('http://127.0.0.1:3213', '/rooms/COURT/leave');
  assert.deepEqual(calls[2][1].headers, {}); assert(!Object.hasOwn(calls[2][1], 'body'));
  await assert.rejects(post('https://remote.example', '/rooms/COURT/leave'));
  assert.equal(calls.length, 3, 'Nonlocal requests must not reach mocked fetch');
});

function completedCleanupReceipt() {
  return { cleanupOnly: true, layoutComplete: false, fixtureChecksComplete: true, browserClosed: true, socketIssues: [], consoleIssues: [], cleanup: [
    ...Array.from({ length: 2 }, () => ({ mode: 'browser-ui', normalUI: true, status: 200, authCleared: true })),
    ...Array.from({ length: 5 }, () => ({ mode: 'socket-owner-rest', normalUI: false, status: 200 })),
  ] };
}

test('cleanup-only success requires completed fixture/privacy checks and all ordinary owner releases, never layout acceptance', () => {
  assert.deepEqual(completionStatus(completedCleanupReceipt()), { cleanupComplete: true, passed: true });
  for (const mutation of [
    receipt => { receipt.fixtureChecksComplete = false; }, receipt => { receipt.layoutComplete = true; },
    receipt => { receipt.browserClosed = false; }, receipt => { receipt.failure = 'fixture failed'; },
    receipt => { receipt.cleanup[2].status = 400; }, receipt => { receipt.cleanup[0].authCleared = false; },
    receipt => { receipt.cleanup.push({ mode: 'browser-fallback', status: 200 }); },
    receipt => { receipt.socketIssues.push({ event: 'unexpected-disconnect' }); },
    receipt => { receipt.consoleIssues.push({ error: 'render' }); },
  ]) { const receipt = completedCleanupReceipt(); mutation(receipt); assert.equal(completionStatus(receipt).passed, false); }
  const full = { ...completedCleanupReceipt(), cleanupOnly: false, layoutComplete: true };
  assert(completionStatus(full).passed);
  full.layoutComplete = false; assert(!completionStatus(full).passed, 'Default full run still requires the full visual matrix');
});

test('cleanup-only is explicit opt-in, skips only calibration/captures and labels its unperformed visual scope', () => {
  assert.match(source, /process.env.CITADELS_SEVEN_CLEANUP_ONLY === 'true'/);
  assert.match(source, /if \(!cleanupOnly\) await qa.calibrate\(browser\)/);
  assert.match(source, /else for \(const \[index, profile\] of PROFILES.entries\(\)\) await captureProfile/);
  assert.match(source, /receipt.privacy.push\(await inspectPrivateDOM\(seat, seats\)\)/);
  assert.match(source, /for \(const seat of seats\) checkProjection\(seat, installed.revision\)/);
  assert.match(source, /profiles: cleanupOnly \? \[\] : PROFILES/);
  assert.match(source, /if \(!cleanupOnly\) receipt.layoutComplete = true/);
  assert.match(source, /layoutComplete: false, fixtureChecksComplete: false, cleanupComplete: false/);
  assert.match(source, /CLEANUP CHECK COMPLETE.*no visual acceptance/);
  assert.match(source, /outputDir && !fs.existsSync\(outputDir\)/);
});
