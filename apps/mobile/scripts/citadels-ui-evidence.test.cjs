const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MATRIX, CATEGORIES, LAYOUT_IDS, bundleFence, local, redact, validateFonts, publicPrivacy, CITADELS_CONTAINMENT } = require('./citadels-ui-evidence.cjs');
const { installTextGeometry, classifyContainment } = require('./skull-ui-evidence.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'citadels-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'citadels-ui-smoke.cjs'), 'utf8');

test('Citadels bundle guard rejects missing exact local configuration before network', async () => {
  assert.throws(() => local('https://localhost.example.com'));
  assert.throws(() => local('http://user:password@127.0.0.1'));
  await assert.rejects(bundleFence('https://example.com', '.', 'a'.repeat(64)));
  await assert.rejects(bundleFence('http://localhost:8081', '.', 'invalid'));
  await assert.rejects(bundleFence('http://localhost:8081', '', 'a'.repeat(64)));
  assert.match(driver, /CITADELS_UI_EXCLUSIVE_WINDOW === 'granted'/);
  assert.match(driver, /service === 'zuychin-arcade-server'/);
  assert.match(driver, /fixture.status === 404/);
});

test('receipts retain diagnostics but never known passwords or tokens', () => {
  const result = redact({ revision: 42, token: 'seat-secret', message: 'room-pass Bearer unsafe eyJheader.payload.signature' }, ['seat-secret', 'room-pass']);
  assert.match(result, /42/);
  for (const secret of ['seat-secret', 'room-pass', 'unsafe', 'eyJheader.payload.signature']) assert(!result.includes(secret));
  assert.match(driver, /writeReceipt\('failure.txt'/);
  assert.match(driver, /Choose a new output directory/);
});

test('public privacy guard never needs another seat private projection', () => {
  assert.deepEqual(publicPrivacy({ phase: 'drafting', players: [{ playerId: 'a', revealedRole: null, handCount: 4, city: [] }] }), []);
  assert.deepEqual(publicPrivacy({ players: [{ chosenRole: 'merchant', hand: ['secret'] }] }), [{ scope: 'public-player', key: 'hand' }, { scope: 'public-player', key: 'chosenRole' }]);
  assert.deepEqual(publicPrivacy({ availableRoles: ['assassin'] }), [{ scope: 'public-state', key: 'availableRoles' }]);
  assert.match(helper, /actor.private\?\.playerId === auth.playerId/);
  assert.match(driver, /exactly one private drafter/);
});

test('font observations reject disconnected nodes, reset size and replacement fonts', () => {
  const sample = { before: 14, after: 28, family: 'Outfit', afterFamily: 'Outfit', connected: true };
  validateFonts([sample]);
  for (const change of [{ connected: false }, { after: 14 }, { afterFamily: 'fallback' }]) assert.throws(() => validateFonts([{ ...sample, ...change }]));
  assert.throws(() => validateFonts([]));
  assert(helper.indexOf('await ready(page, allowTransient)') < helper.indexOf('attempt.baseline = await enlarge(page)'));
  assert.match(helper, /Transient evidence cannot be a font baseline/);
  assert.match(helper, /failureFonts = await page.evaluate\(fontSamples\)/);
});

test('geometry calibration distinguishes real glyph overflow from matching whitespace bounds', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const rect = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const measured = { rawRects: [rect], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [rect] }] };
  const proof = () => context.window.__coupQAOverflowProof([measured], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  measured.glyphRects = [{ ...rect, character: 'A' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  measured.glyphRects = []; measured.characters[0].rects = [{ ...rect, left: 10 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
  assert.match(helper, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
});

test('capture observations occur after screenshot and before strict assertions', () => {
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('const post = await page.evaluate(geometry'));
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('if (scale) validateFonts(post.fonts)'));
  assert.match(helper, /png.readUInt32BE\(16\)/);
  assert.match(helper, /c.width < 48 \|\| c.height < 48/);
  assert.doesNotMatch(driver + helper, /fullPage: true|deviceScaleFactor: 2/);
});

test('matrix preserves fixed touch/pointer contexts and covers genuine CSS200', () => {
  assert.deepEqual(MATRIX.map(([width]) => width), [320, 375, 414, 768, 1280, 844]);
  assert(MATRIX.some(([, height]) => height === 390));
  assert.match(driver, /setViewport\(\{ \.\.\.page.viewport\(\), width, height/);
  assert.match(driver, /hasTouch\) await button.tap\(\)/);
  assert.match(driver, /for \(const width of \[375, 1280\]\)/);
  for (const phase of ['entrance', 'lobby', 'decision', 'results']) assert(driver.includes(`captureMatrix(${phase === 'decision' ? 'player' : 'host'}, '${phase}'`));
  assert(LAYOUT_IDS.includes('citadels-cities'));
});

test('integrated art maps by immutable file hash and printed category, not effective cost', () => {
  assert.deepEqual(CATEGORIES, ['noble', 'religious', 'trade', 'military', 'unique']);
  assert.match(helper, /assert.equal\(servedHash, diskHash/);
  assert.match(helper, /artwork: known.get\(servedHash\)/);
  assert.match(helper, /citadels-district-\$\{image.printedCategory\}/);
  assert.match(helper, /evidence.artworkNotObserved/);
});

test('natural legal policy, bounded lifetime, cleanup and rare gaps remain explicit', () => {
  assert.match(driver, /const build = labels.find\(\(label\) => \/\^BUILD/);
  assert.match(driver, /const keep = labels.find\(\(label\) => \/\^KEEP THIS PLAN/);
  assert.match(driver, /18 \* 60_000/);
  assert.match(driver, /25 \* 60_000/);
  assert.match(driver, /normalUI: !player.fallbackCleanup/);
  assert.match(driver, /r.normalUI && r.status === 200 && r.authCleared/);
  assert.match(driver, /fallback: true/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.match(driver, /natural-branch-not-encountered/);
  assert.match(driver, /seven-seat layout/);
});

test('Citadels card and decision containment share the calibrated detector with explicit court bounds', () => {
  assert.equal(CITADELS_CONTAINMENT.decisionId, 'citadels-decision-area');
  assert.equal(CITADELS_CONTAINMENT.headingId, 'citadels-decision-heading');
  assert.deepEqual(CITADELS_CONTAINMENT.siblingIds, ['citadels-cities', 'citadels-roster']);
  assert.match(CITADELS_CONTAINMENT.cardSelector, /citadels-district-card-/);
  assert.match(CITADELS_CONTAINMENT.cardSelector, /citadels-role-card-/);
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('post.containment = await page.evaluate'));
  assert.match(helper, /post.containmentFindings = classifyContainment\(post.containment\)/);
  assert.match(helper, /kind: 'card-control-containment'/);
  assert(helper.indexOf('await calibrateContainment(page, CITADELS_CONTAINMENT') < helper.indexOf('evidence.calibration.passed = true'));
});

test('a partially visible horizontally scrolled district card cannot manufacture column escape', () => {
  const measurement = { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{ id: 'district-choice', kind: 'decision', bounds: { left: 16, right: 359, top: 100, bottom: 500 }, content: [{ kind: 'control', label: 'BUILD', bounds: { left: 310, right: 490, top: 120, bottom: 400 }, visibleBounds: { left: 28, right: 347, top: 110, bottom: 450 } }], siblings: [{ id: 'city', bounds: { left: 365, right: 600, top: 100, bottom: 500 } }] }] };
  assert.deepEqual(classifyContainment(measurement), []);
  delete measurement.cards[0].content[0].visibleBounds;
  assert.deepEqual(classifyContainment(measurement).map(f => f.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
});

test('ordinary journey completes both scored matches before optional separately labelled shortage', () => {
  const rematch = driver.slice(driver.indexOf('const secondMatchActions = await driveFullMatch(players, 2)'), driver.indexOf('const requiredCoverage ='));
  assert.match(rematch, /const rematchTerminal = await naturalTerminal\(players\)/);
  assert.match(rematch, /writeReceipt\('rematch-terminal.json', rematchTerminal\)/);
  assert(rematch.indexOf('await naturalTerminal(players)') < rematch.indexOf('if (SHORTAGE_FOLLOWUP)'));
  assert.match(rematch, /separateFromNaturalMatches: true/);
  assert.match(driver, /CITADELS_UI_SHORTAGE_FOLLOWUP === 'true'/);
  assert.match(driver, /qa.evidence.finalBundle = await bundleFence/);
  assert.doesNotMatch(driver, /const secondMatchActions = 0/);
});

test('actual normal cleanup scopes results and live Back, owns confirmation, awaits routing and auth clear', async () => {
  const source = driver.slice(driver.indexOf('async function leavePlayerUI('), driver.indexOf('async function naturalTerminal('));
  for (const results of [true, false]) {
    let auth = true, dialog = false;
    const calls = [], page = { evaluate: async fn => vm.runInNewContext(`(${fn.toString()})()`, {
      document: { getElementById: id => id === 'citadels-game-over' ? results : id === 'citadels-toolbar' ? !results : id === 'arcade-dialog' ? dialog : null },
      sessionStorage: { getItem: () => auth ? '{}' : null },
    }) };
    const context = {
      clickButton: async (target, pattern, timeout, scope) => { calls.push({ pattern: pattern.source, scope }); if (pattern.source === '^LEAVE$') auth = false; else dialog = true; },
      hasButton: async () => false,
      waitUntil: async condition => assert(await condition()),
      waitForPath: async (target, pathname) => { assert.equal(pathname, '/'); assert.equal(auth, false); },
    };
    vm.createContext(context); vm.runInContext(source + ';this.leave = leavePlayerUI;', context);
    await context.leave({ page });
    assert.equal(calls[0].scope, results ? '#citadels-game-over' : '#citadels-toolbar');
    assert.equal(calls[0].pattern, results ? '^BACK TO ARCADE$' : '^Back to arcade$');
    assert.equal(calls[1].scope, '#arcade-dialog');
  }
  assert.match(driver, /fallback: true, normalUI: false, status: response\.status \}/);
});

test('actual terminal gate rejects abandonment, forfeits and inconsistent public projections', async () => {
  const { naturalTerminal } = require('./citadels-ui-smoke.cjs');
  const state = { roomCode: 'COUR-T123', revision: 20, status: 'game_over', terminationReason: null, winnerIds: ['own'], players: [{ playerId: 'own', forfeited: false }] };
  const seat = value => ({ auth: { roomCode: value.roomCode, playerId: 'own' }, private: { roomCode: value.roomCode, playerId: 'own', revision: value.revision }, public: value });
  assert.deepEqual(await naturalTerminal([seat(state)]), state);
  await assert.rejects(naturalTerminal([seat({ ...state, winnerIds: [], terminationReason: 'not_enough_players' })]));
  await assert.rejects(naturalTerminal([seat({ ...state, players: [{ playerId: 'own', forfeited: true }] })]));
  await assert.rejects(naturalTerminal([seat(state), seat({ ...state, winnerIds: ['different'] })]));
});

test('long-name matrix keeps real phone and desktop modes and frames exact post-capture text', () => {
  assert.match(driver, /const LONG_NAME = 'ABCDEFGHIJKLMNOPQRST'/);
  assert.equal('ABCDEFGHIJKLMNOPQRST'.length, 20);
  assert.match(driver, /openPlayer\(browser, LONG_NAME/);
  assert.match(driver, /\['phone', players.find\(p => p.page.viewport\(\).hasTouch\), \[320, 375\]\]/);
  assert.match(driver, /\['desktop', players.find\(p => !p.page.viewport\(\).hasTouch\), \[1280\]\]/);
  for (const prefix of ['citadels-roster-name-', 'citadels-city-name-', 'citadels-completion-banner']) assert(driver.includes(prefix));
  assert.match(driver, /branch: '20-character player first-completion banner'/);
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('post.requiredFrame = await page.evaluate'));
});

test('required-name framing rejects ancestor clipping and missing exact name', () => {
  const { measureFrame } = require('./citadels-ui-evidence.cjs');
  let bottom = 140, content = 'ABCDEFGHIJKLMNOPQRST';
  const parent = { id: 'scroll', getBoundingClientRect: () => ({ left: 0, right: 320, top: 0, bottom: 120 }), parentElement: null, scrollHeight: 400, clientHeight: 120, scrollTop: 100 };
  const node = { get textContent() { return content; }, getBoundingClientRect: () => ({ left: 20, right: 300, top: 80, bottom }), parentElement: parent };
  const context = { document: { querySelector: () => node }, innerWidth: 320, innerHeight: 844, getComputedStyle: () => ({ overflowX: 'hidden', overflowY: 'auto', visibility: 'visible', opacity: '1' }) };
  const sample = () => vm.runInNewContext(`(${measureFrame.toString()})({selector:'#name',expectedText:'ABCDEFGHIJKLMNOPQRST'})`, context);
  assert.equal(sample().fullyFramed, false);
  bottom = 110;
  assert.equal(sample().fullyFramed, true);
  assert.equal(sample().matches, true);
  content = 'ABCDEFGHIJKLMNOPQRS';
  assert.equal(sample().matches, false);
});
