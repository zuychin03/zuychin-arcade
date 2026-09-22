const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { redact, validateFonts, local, installTextGeometry, bundleFence, classifyContainment, measureContainment, SKULL_CONTAINMENT } = require('./skull-ui-evidence.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'skull-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'skull-king-ui-smoke.cjs'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'skull-king-fixture-ui.cjs'), 'utf8');

test('receipts redact known credentials and bearer/JWT-shaped values without dropping diagnostics', () => {
  const clean = redact({ status: 200, error: 'private-password Bearer secret-value eyJtest.payload.signature', token: 'owned-token' }, ['private-password', 'owned-token']);
  assert.match(clean, /200/);
  for (const forbidden of ['private-password', 'secret-value', 'owned-token', 'eyJtest.payload.signature']) assert(!clean.includes(forbidden));
});

test('bundle and local guards fail before network access without exact local configuration', async () => {
  assert.throws(() => local('https://localhost.evil.test:3213'));
  assert.throws(() => local('http://name:password@127.0.0.1:3213'));
  await assert.rejects(bundleFence('https://example.com', '.', 'a'.repeat(64)));
  await assert.rejects(bundleFence('http://127.0.0.1:8081', '.', 'not-a-hash'));
  await assert.rejects(bundleFence('http://127.0.0.1:8081', '', 'a'.repeat(64)));
  const tokyo = fs.readFileSync(path.join(__dirname, 'tokyo-ui-evidence.cjs'), 'utf8');
  assert.match(tokyo, /assert.equal\(servedHash, expected/);
  assert.match(tokyo, /assert.equal\(diskHash, expected/);
});

test('doubled font proof rejects stale nodes, reset styles, substitutions and empty samples', () => {
  const sample = { before: 14, after: 28, connected: true, family: 'Outfit', afterFamily: 'Outfit' };
  validateFonts([sample]);
  for (const change of [{ connected: false }, { after: 14 }, { afterFamily: 'fallback' }]) assert.throws(() => validateFonts([{ ...sample, ...change }]));
  assert.throws(() => validateFonts([]));
  assert.match(helper, /style.id = 'skull-qa-scale'/);
  assert.match(helper, /transition:none!important;font-size:/);
  assert.match(helper, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(helper, /await pause\(100\)/);
});

test('imported geometry keeps real glyph overflow and exempts only proven collapsed whitespace', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const r = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const geometry = { rawRects: [r], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [r] }] };
  const proof = () => context.window.__coupQAOverflowProof([geometry], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  geometry.glyphRects = [{ ...r, character: 'A' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  geometry.glyphRects = []; geometry.characters[0].rects = [{ ...r, left: 10 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
  assert.match(helper, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
  assert.match(helper, /samples.positive.proof.classification, 'non-whitespace-overflow'/);
});

test('capture writes baseline and postcapture evidence before assertions, with viewport-only dimensions', () => {
  assert(helper.indexOf('attempt.baseline = await enlarge') < helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)'));
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('const post = await page.evaluate(metrics)'));
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('if (scale) validateFonts(post.fonts)'));
  assert.match(helper, /attempt.failureFonts = await page.evaluate\(fonts\)/);
  assert.match(helper, /png.readUInt32BE\(16\)/);
  assert.match(helper, /width < 48 \|\| c.height < 48/);
  assert.doesNotMatch(helper + driver, /fullPage: true|deviceScaleFactor: 2/);
});

test('viewport resizing retains initial input flags and matrix covers phone desktop landscape and CSS200', () => {
  assert.match(driver, /isMobile: before.isMobile, hasTouch: before.hasTouch/);
  assert.match(driver, /if \(page.viewport\(\).hasTouch\) await button.tap\(\)/);
  for (const viewport of ['[320, 800]', '[375, 844]', '[414, 896]', '[768, 1024]', '[1280, 900]', '[844, 390]']) assert(driver.includes(viewport));
  assert.match(driver, /stage.*phone.*text200/);
});

test('natural run retains own legal driver, fences ordinary API, and records rare branch gaps', () => {
  assert.match(driver, /SKULL_UI_EXCLUSIVE_WINDOW === 'granted'/);
  assert.match(driver, /service === 'zuychin-arcade-server'/);
  assert.match(driver, /fixture.status === 404/);
  assert.match(driver, /player.public.currentPlayerId === player.private.playerId/);
  assert.match(driver, /const label = enabled\[0\]/);
  assert.match(driver, /public.players.every\(p => p.bid === null\)/);
  assert.match(driver, /record|gaps.push\('No natural Tigress/);
  assert.match(driver, /evidence.plays >= 165/);
  assert.match(driver, /Date.now\(\) - started < 900_000/);
});

test('normal exits and fallback are separate receipts and browser cleanup survives failures', () => {
  assert.match(driver, /normalUI: !player.fallbackCleanup/);
  assert.match(driver, /r.normalUI && r.status === 200 && r.authCleared/);
  assert.match(driver, /fallback: true/);
  assert.match(driver, /finally \{ qa.evidence.consoleIssues = consoleIssues; qa.persist\(\); \}/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.match(driver, /same-seat-reload-private-hand/);
  assert.match(driver, /Tigress and revision/);
  assert.match(driver, /Previous scored round/);
});

function escapedCard() {
  return { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{ id: 'card', kind: 'card', bounds: { left: 26, right: 349, top: 0, bottom: 180 }, content: [{ kind: 'control', label: 'PLAY', bounds: { left: 36, right: 339, top: 363, bottom: 457 } }], siblings: [{ id: 'next-card', bounds: { left: 26, right: 349, top: 373, bottom: 866 } }] }] };
}

test('overflow-visible child escaping a short card is reported with actual sibling overlap', () => {
  const measurement = escapedCard(), findings = classifyContainment(measurement);
  assert.deepEqual(findings.map(f => f.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
  assert.deepEqual(findings[1].overlap, { left: 36, right: 339, top: 373, bottom: 457 });
  measurement.cards[0].bounds.bottom = 467;
  assert.deepEqual(classifyContainment(measurement), []);
});

test('hidden or offscreen rail overflow retains raw geometry without visible false positives', () => {
  const measurement = escapedCard(), raw = structuredClone(measurement);
  measurement.cards[0].content[0].visibleBounds = { left: 26, right: 349, top: 0, bottom: 180 };
  assert.deepEqual(classifyContainment(measurement), []);
  assert.deepEqual(measurement.cards[0].content[0].bounds, raw.cards[0].content[0].bounds);
  delete measurement.cards[0].content[0].visibleBounds;
  measurement.viewport.bottom = 300;
  assert.deepEqual(classifyContainment(measurement), []);
});

test('visible control crossing decision boundary into sibling column is not missed without clipping', () => {
  const measurement = { viewport: { left: 0, right: 1280, top: 0, bottom: 844 }, cards: [{ id: 'decision', kind: 'decision', bounds: { left: 40, right: 701, top: 20, bottom: 824 }, content: [{ kind: 'control', label: 'LONG CHOICE', bounds: { left: 564, right: 971, top: 585, bottom: 647 } }], siblings: [{ id: 'table', bounds: { left: 721, right: 1240, top: 20, bottom: 1163 } }] }] };
  assert.deepEqual(classifyContainment(measurement).map(f => f.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
  measurement.cards[0].content[0].visibleBounds = { left: 40, right: 701, top: 20, bottom: 824 };
  assert.deepEqual(classifyContainment(measurement), []);
  measurement.cards[0].content[0].bounds.right = 686;
  delete measurement.cards[0].content[0].visibleBounds;
  assert.deepEqual(classifyContainment(measurement), []);
});

test('containment observes clipping ancestors and explicit boundaries after capture, calibration before pass', () => {
  assert.match(measureContainment.toString(), /\['hidden', 'clip', 'auto', 'scroll'\].includes\(s.overflowX\)/);
  assert.equal(SKULL_CONTAINMENT.headingId, 'skull-king-decision-heading');
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('post.containment = await page.evaluate'));
  assert.match(helper, /post.containmentFindings = classifyContainment\(post.containment\)/);
  assert.match(helper, /card-control-containment/);
  assert.match(helper, /ESCAPED CARD/); assert.match(helper, /CONTAINED CARD/);
  assert.match(helper, /ESCAPED CONTROL/); assert.match(helper, /CONTAINED CONTROL/);
  assert.match(helper, /OFFSCREEN RAIL/);
  assert(helper.indexOf('await calibrateContainment(page, SKULL_CONTAINMENT') < helper.indexOf('evidence.calibration.passed = true'));
});

test('normal acceptance completes a second natural voyage without an abandonment shortcut', () => {
  const rematch = driver.slice(driver.indexOf('async function exerciseGameOverAndRematch'), driver.indexOf('function configureEvidence'));
  assert.match(rematch, /playFullVoyage\(players, \{ visuals: false \}\)/);
  assert.match(rematch, /terminal.roundNumber >= 10/);
  assert.match(rematch, /terminal.revision > rematchStart && rematchStart > terminalRevision/);
  assert.match(rematch, /terminal.players.every\(p => !p.forfeited\)/);
  assert.doesNotMatch(rematch, /not_enough_players|exerciseRematchShortageRecovery/);
  assert.match(rematch, /for \(const player of \[\.\.\.players\].reverse\(\)\) await cleanupPlayer/);
  assert.match(driver, /finalBundle = await bundleFence/);
});

test('postcapture framing records ancestor clipping and ScrollView offsets before asserting visibility', () => {
  assert.match(helper, /frameAlign = 'center'/);
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('if (frame) post.frame'));
  assert.match(helper, /scrollAncestors.push\(\{ id: owner.id, bounds: b, scrollTop: owner.scrollTop/);
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('assert(post.frame.intersects'));
});

test('supplementary fixtures require explicit mode, exact service, same bundle and independent normal cleanup', () => {
  assert.match(fixture, /SKULL_UI_FIXTURE_RUN, 'true'/);
  assert.match(fixture, /service, 'skull-king-local-ui-fixtures'/);
  assert.match(fixture, /finalBundle = await bundleFence/);
  assert.match(fixture, /qa.evidence.cleanup.length, targeted \? 4 : 12/);
  assert.match(fixture, /await runRoom\(browser, 4, supplement\); if \(!targeted\) await runRoom\(browser, 8\)/);
  assert.match(fixture, /c.normalUI && c.status === 200 && c.authCleared/);
  assert.match(fixture, /fallback: true, normalUI: false/);
  assert.match(fixture, /finally \{ qa.evidence.consoleIssues = h.consoleIssues; qa.persist\(\); \}/);
  assert.match(fixture, /Not natural voyages or independent manual play/);
  assert.doesNotMatch(fixture, /fullPage: true|deviceScaleFactor: 2|initSkullKingGame/);
});

test('fixture pairing rejects cross-room, stale and wrong-owner frames', () => {
  const { paired, scenarios } = require('./skull-king-fixture-ui.cjs');
  assert.deepEqual([...scenarios].sort(), ['tigress_follow', 'character_lead', 'royal_bonus', 'eight_final_tie', 'royal_terminal'].sort());
  const seat = { auth: { roomCode: 'ABCD-EFGH', playerId: 'own' }, public: { roomCode: 'ABCD-EFGH', revision: 10 }, private: { roomCode: 'ABCD-EFGH', playerId: 'own', revision: 10 } };
  assert(paired(seat, 10));
  for (const change of [{ roomCode: 'OTHER' }, { playerId: 'other' }, { revision: 9 }]) assert(!paired({ ...seat, private: { ...seat.private, ...change } }, 10));
  assert(!paired({ ...seat, public: { ...seat.public, revision: 11 } }, 10));
});

test('fixture results use the owned modal and fetch fallback records the Response status property', () => {
  assert(fixture.includes("h.clickButton(host.page, /^Show completed-round scorecard$/, 45000, '#skull-king-game-over')"));
  assert.match(fixture, /fallback: true, normalUI: false, status: response\.status \}/);
  assert.doesNotMatch(fixture, /response\.status\(\)/);
});

test('rare UI commands assert real adjudication and preserve hidden new-round bids', () => {
  for (const proof of ["/^PLAY AS PIRATE$/", "record.offSuitAfterCharacterLead = true", 'scored.bonus, 50', 'scored.roundScore, 70', 'scored.totalScore, 270', 'host.public.roundNumber, 11', 'host.public.cardsPerPlayer, 8', 'seats.every(s => s.private.hand.length === 8)', 'host.public.players.every(p => p.bid === null)']) assert(fixture.includes(proof), proof);
  assert.match(fixture, /image.source.includes\('skull-special-' \+ kind\)/);
  assert.match(fixture, /Numbered suit\/rank cards must not borrow character artwork/);
});

test('actual cleanup selects the result modal action ahead of the occluded toolbar and owns confirmation', async () => {
  const body = driver.slice(driver.indexOf('async function cleanupPlayer('), driver.indexOf('async function runRematchShortageTarget('));
  for (const finished of [true, false]) {
    let auth = true;
    const calls = [], evidence = { cleanup: [] }, player = { name: 'Owned seat' };
    player.page = { evaluate: async fn => vm.runInNewContext(`(${fn.toString()})()`, {
      sessionStorage: { getItem: () => auth ? '{}' : null },
      document: { getElementById: id => finished && id === 'skull-king-game-over' ? {} : null },
    }) };
    const context = { qa: { evidence, persist() {} },
      clickButton: async (page, pattern, timeout, scope) => {
        calls.push({ pattern: pattern.source, scope });
        if (pattern.source === '^LEAVE$') { auth = false; evidence.cleanup.push({ actor: player.name, normalUI: true, status: 200 }); }
      },
      hasButton: async (page, pattern, enabled, scope) => { assert.equal(scope, '#arcade-dialog'); return true; },
      waitUntil: async predicate => assert(await predicate()), waitForPath: async () => {},
    };
    vm.createContext(context); vm.runInContext(body + ';this.cleanup = cleanupPlayer;', context);
    await context.cleanup(player);
    assert.equal(calls[0].scope, finished ? '#skull-king-game-over' : '#skull-toolbar');
    assert.equal(calls[0].pattern, finished ? '^BACK TO ARCADE$' : '^Back to arcade$');
    assert.equal(calls[1].scope, '#arcade-dialog');
    assert.equal(evidence.cleanup[0].authCleared, true);
  }
});
