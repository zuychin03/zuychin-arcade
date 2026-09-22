const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { permitted, local, validateFonts, installTextGeometry, matchArenaLabel, classifyCardLayout } = require('./tokyo-ui-evidence.cjs');
const source = fs.readFileSync(path.join(__dirname, 'tokyo-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'king-of-tokyo-ui-smoke.cjs'), 'utf8');

test('network guard permits only exact local origins and rejects credentials and lookalikes', () => {
  const origins = new Set(['http://127.0.0.1:8081', 'https://localhost:3214']);
  assert(permitted('wss://localhost:3214/socket.io/', origins));
  assert(!permitted('https://localhost.evil.test:3214/', origins));
  assert(!permitted('https://localhost:4000/', origins));
  assert(!permitted('https://user:secret@localhost:3214/', origins));
  assert.throws(() => local('https://example.com'));
});

test('font proof rejects disconnected, reset size and replacement font instead of skipping nodes', () => {
  const good = { connected: true, before: 16, after: 32, family: 'Outfit', afterFamily: 'Outfit' };
  validateFonts([good]);
  for (const change of [{ connected: false }, { after: 16 }, { afterFamily: 'serif' }]) assert.throws(() => validateFonts([{ ...good, ...change }]));
  assert.throws(() => validateFonts([]));
});

test('arena label matches the authoritative projection with closed, occupied and empty Bay', () => {
  const state = { tokyoCapacity: 1, players: [{ displayName: 'Alice, A', tokyoZone: 'tokyo_city' }] };
  assert.equal(matchArenaLabel('Tokyo arena, capacity 1. City occupied by Alice, A, Bay closed', state)?.city, 'Alice, A');
  assert.equal(matchArenaLabel('Tokyo arena, capacity 1. City occupied by Other, Bay closed', state), null);
  state.tokyoCapacity = 2;
  assert.equal(matchArenaLabel('Tokyo arena, capacity 2. City occupied by Alice, A, Bay occupied by nobody', state)?.bay, 'nobody');
  state.players.push({ displayName: 'Bob, Bay occupied by C', tokyoZone: 'tokyo_bay' });
  assert.equal(matchArenaLabel('Tokyo arena, capacity 2. City occupied by Alice, A, Bay occupied by Bob, Bay occupied by C', state)?.bay, 'Bob, Bay occupied by C');
  assert.equal(matchArenaLabel('Tokyo arena, capacity 2. City occupied by Alice, A, Bay closed', state), null);
  assert.equal(matchArenaLabel('Tokyo arena, capacity 2. City occupied by nobody, Bay occupied by nobody', { tokyoCapacity: 2, players: [] })?.city, 'nobody');
});

test('raw geometry exemption requires exact whitespace identity and retains visible glyph failure', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const r = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const g = { rawRects: [r], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [r] }] };
  const proof = () => context.window.__coupQAOverflowProof([g], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  g.glyphRects = [{ ...r, character: 'A' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  g.glyphRects = []; g.characters[0].rects = [{ ...r, left: 8 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
});

test('Tokyo detector is byte-equivalent to the live-calibrated Coup geometry function', () => {
  const coup = fs.readFileSync(path.join(__dirname, 'coup-ui-smoke.cjs'), 'utf8');
  const expected = coup.slice(coup.indexOf('function installTextGeometry()'), coup.indexOf('async function calibrateTextGeometry')).trim().replace(/\r\n/g, '\n');
  assert.equal(installTextGeometry.toString().replace(/\r\n/g, '\n'), expected);
});

test('screenshots retain preassert evidence, postcapture font proof and strict48 measurements', () => {
  assert(source.indexOf('attempt.preCaptureFonts') < source.indexOf('await page.screenshot({ path: path.join(outputDir, file)'));
  assert(source.indexOf('evidence.captures.push(record); persist()') < source.indexOf('if (scale) validateFonts(metrics.fonts)'));
  assert.match(source, /width < 48 \|\| c.height < 48/);
  assert.match(source, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
  assert.match(source, /white-space:pre-wrap/);
  assert.match(source, /rawRangeDiagnostics.push/);
});

test('natural run fences fixture API, drives full rematch and requires owned normal cleanup', () => {
  assert.match(driver, /fixtureProbe.status === 404/);
  assert.match(driver, /finishWithoutRematch: true/);
  assert.match(driver, /fullRematch: rematch/);
  assert.match(driver, /r.normalUI && r.status === 200 && r.authCleared/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.doesNotMatch(driver, /fullPage: true/);
  assert.doesNotMatch(driver, /Math.floor\(original.width \/ 2\)/);
});

test('five and six-seat fixtures stay separate from natural driver and use exact source scenarios', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'king-of-tokyo-fixture-ui.cjs'), 'utf8');
  assert.match(fixture, /const supplement = targeted \? createSupplement\(h.qa, 64\) : null/);
  assert.match(fixture, /await runRoom\(browser, 5, supplement\); await runRoom\(browser, 6, supplement\)/);
  assert.match(fixture, /assert.equal\(health.service, 'king-of-tokyo-local-ui-fixtures'/);
  assert.match(fixture, /canonicalCards, 66/);
  assert.match(fixture, /seats.slice\(1\).every\(s => s.state.labCard === null\)/);
  assert.match(fixture, /Longest`\.slice\(0, 20\)/);
  assert.match(fixture, /frame: '#tokyo-table-state', publicTable: true/);
  assert.match(source, /actor\?\.state\?\.viewerPlayerId === auth.playerId && actor.state.roomCode === auth.roomCode/);
  assert.match(fixture, /'lab', 'opportunist', 'hearts'/);
  assert.match(fixture, /host.state.pendingOpportunistCardInstanceId/);
  assert.match(fixture, /#king-current-decision \[data-testid=/);
  assert.match(fixture, /cardId === 'complete_destruction' && card.instanceId === instanceId/);
  assert.match(fixture, /card-bottom-normal.png/);
});

function cardMeasurement() {
  return { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{
    id: 'heal', bounds: { left: 26, right: 349, top: 0, bottom: 180 },
    content: [{ kind: 'control', label: 'BUY PRIVATE TOP CARD', bounds: { left: 36, right: 339, top: 363, bottom: 457 } }],
    siblings: [{ id: 'owned-card', bounds: { left: 26, right: 349, top: 373, bottom: 866 } }],
  }] };
}

test('captured Lab geometry fails containment and sibling overlap despite overflow-visible', () => {
  const findings = classifyCardLayout(cardMeasurement());
  assert.deepEqual(findings.map(f => f.kind), ['content-outside-card', 'content-overlaps-sibling']);
  assert.equal(findings[1].sibling, 'owned-card');
  assert.deepEqual(findings[1].overlap, { left: 36, right: 339, top: 373, bottom: 457 });
});

test('intrinsic card growth and following sibling position remove the actual overlap', () => {
  const measurement = cardMeasurement();
  measurement.cards[0].bounds.bottom = 467;
  measurement.cards[0].siblings[0].bounds.top = 480;
  assert.deepEqual(classifyCardLayout(measurement), []);
});

test('offscreen card overflow stays in measurements without claiming it is captured', () => {
  const measurement = cardMeasurement();
  measurement.viewport.bottom = 300;
  assert.deepEqual(classifyCardLayout(measurement), []);
  assert.equal(measurement.cards[0].content[0].bounds.bottom, 457);
});

test('live calibration uses the same card measurement and classifier before recording pass', () => {
  assert.match(source, /const cardLayout = await page.evaluate\(measureCardLayout\), findings = classifyCardLayout\(cardLayout\)/);
  assert.match(source, /kind === 'content-overlaps-sibling'/);
  assert.match(source, /!findings.some\(f => f.card === 'tokyo-power-card-good'\)/);
  assert.match(source, /metrics.cardLayoutFindings = classifyCardLayout\(metrics.cardLayout\)/);
  assert.match(source, /kind: 'card-content-layout', entries: metrics.cardLayoutFindings/);
});

test('recorded desktop defence alternatives fail the decision-column and table boundary', () => {
  for (const [label, left, right, top, bottom] of [
    ['KEEP CAMOUFLAGE ROLL', 563.78125, 970.734375, 585.390625, 646.390625],
    ['TAKE DAMAGE WITHOUT HEALING', 360.828125, 898.671875, 493, 554],
  ]) {
    const measurement = { viewport: { left: 0, top: 0, right: 1280, bottom: 844 }, cards: [{
      id: 'king-current-decision', bounds: { left: 40, right: 700.875, top: 20, bottom: 824 },
      content: [{ kind: 'control', label, bounds: { left, right, top, bottom } }],
      siblings: [{ id: 'tokyo-table-state', bounds: { left: 720.875, right: 1240, top: 20, bottom: 1163 } }],
    }] };
    assert.deepEqual(classifyCardLayout(measurement).map(f => f.kind), ['content-outside-card', 'content-overlaps-sibling']);
    measurement.cards[0].content[0].bounds = { left: 54, right: 686, top, bottom };
    assert.deepEqual(classifyCardLayout(measurement), []);
  }
});

test('live decision calibration and preferences framing do not rely on offscreen size alone', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'king-of-tokyo-fixture-ui.cjs'), 'utf8');
  assert.match(source, /decisionControls = await page.evaluate\(measureDecisionControls\), decisionFindings = classifyCardLayout\(decisionControls\)/);
  assert.match(source, /!decisionFindings.some\(f => f.content.label === 'CONTAINED ALTERNATIVE'\)/);
  assert.match(source, /metrics.decisionControls = await page.evaluate\(measureDecisionControls\)/);
  assert.match(source, /kind: 'decision-control-layout', entries: metrics.decisionControlFindings/);
  assert.match(fixture, /#tokyo-preferences \[aria-label="OFF"\]/);
  assert.match(fixture, /rapid-preferences-text200.png`, \{ scale: true, frame: off \}/);
  assert.match(source, /metrics.frame.hit, 'Framed control clipped or occluded'/);
});
