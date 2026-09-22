const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const vm = require('node:vm');
const { persistContainment, MATRIX, LOOT_KINDS, PHASES, CHOICE_KINDS, publicPrivacy, crewAllowed, publicLoot, verifyCrew, verifyLoot, verifyReady, LAYOUT_IDS, bundleFence, local, redact, validateFonts, LIBERTALIA_CONTAINMENT } = require('./libertalia-ui-evidence.cjs');
const { LIBERTALIA_CREW } = require('../../../packages/types/src/libertalia-constants.ts');
const { classifyContainment, installTextGeometry } = require('./skull-ui-evidence.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'libertalia-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'libertalia-ui-smoke.cjs'), 'utf8');
const natural = fs.readFileSync(path.join(__dirname, 'libertalia-ui-natural.cjs'), 'utf8');

test('all canonical printed crew phases and seven loot identities use exact prepared assets', () => {
  assert.equal(LIBERTALIA_CREW.length, 40);
  assert.deepEqual(PHASES, ['daytime', 'dusk', 'night', 'anchor']);
  assert.deepEqual(LOOT_KINDS, ['map', 'barrel', 'amulet', 'chest', 'hook', 'saber', 'relic']);
  for (const name of [...PHASES.map(phase => 'libertalia-phase-' + phase), ...LOOT_KINDS.map(kind => 'libertalia-loot-' + kind)]) assert(fs.existsSync(path.join(__dirname, '../assets/game-art', name + '.webp')));
  for (const crew of LIBERTALIA_CREW) {
    const card = { rank: crew.rank, zone: 'libertalia-hand', text: `${crew.name} ${crew.phases.join(' / ')} ${crew.summary}`, phaseLabels: crew.phases, sources: ['/phase.webp'] };
    const actor = { latestPrivate: { hand: [crew.rank] }, latestPublic: { phase: 'game_over' } };
    verifyCrew(card, actor, [{ source: '/phase.webp', artwork: 'libertalia-phase-' + crew.phases[0] }]);
    assert.throws(() => verifyCrew(card, actor, [{ source: '/phase.webp', artwork: 'libertalia-phase-game_over' }]));
  }
});

test('multi-phase badges remain live and shared timing art is not a character portrait', () => {
  const crew = LIBERTALIA_CREW.find(crew => crew.phases.length > 1);
  const actor = { latestPrivate: { hand: [crew.rank] } };
  const card = { rank: crew.rank, zone: 'libertalia-hand', text: crew.name + ' ' + crew.phases[0] + ' ' + crew.summary, phaseLabels: [crew.phases[0]], sources: [] };
  assert.throws(() => verifyCrew(card, actor, []));
  verifyCrew({ ...card, phaseLabels: crew.phases, text: crew.name + ' ' + crew.phases.join(' ') + ' ' + crew.summary }, actor, []);
  assert.match(helper, /post.artFallbacks/);
  assert.match(helper, /artworkNotObserved/);
  assert.match(helper, /assert.equal\(servedHash, diskHash/);
});

test('loot uses exact public token identity including duplicate kinds and swap targets', () => {
  const state = { currentLoot: [{ id: 1, kind: 'chest' }], lootDays: [[{ id: 1, kind: 'chest' }, { id: 2, kind: 'chest' }]], players: [{ loot: [{ id: 3, kind: 'relic' }] }] };
  assert.deepEqual(publicLoot(state).map(token => token.id), [1, 2, 3]);
  const token = { id: 3, text: 'Relic calm-side effect', sources: ['/relic.webp'] };
  verifyLoot(token, state, [{ source: '/relic.webp', artwork: 'libertalia-loot-relic' }]);
  assert.throws(() => verifyLoot(token, state, [{ source: '/relic.webp', artwork: 'libertalia-loot-chest' }]));
  assert.throws(() => verifyLoot({ ...token, id: 99 }, state, []));
  assert.throws(() => verifyLoot({ ...token, text: 'Chest' }, state, []));
});

test('private crew and graveyard faces require the exact owned scope, not same-new-crew inference', () => {
  const actor = { latestPrivate: { hand: [1], graveyard: [2], pendingChoice: { options: [{ rank: 3 }] } }, latestPublic: { players: [{ playerId: 'other', ship: [4] }] } };
  assert(crewAllowed(1, 'libertalia-hand', actor));
  assert(crewAllowed(2, 'libertalia-graveyard', actor));
  assert(crewAllowed(3, 'libertalia-decision-area', actor));
  assert(crewAllowed(4, 'libertalia-ship-other', actor));
  assert(!crewAllowed(1, 'libertalia-ship-other', actor));
  assert(!crewAllowed(2, 'libertalia-hand', actor));
  assert(!crewAllowed(20, 'libertalia-island', actor), 'Neutral Midshipman cannot be treated as rank20 Freed Prisoner');
  assert(!crewAllowed(1, null, actor));
  assert.deepEqual(publicPrivacy({ players: [{ handCount: 6, graveyardCount: 2, ready: true }] }), []);
  assert.deepEqual(publicPrivacy({ selectedRank: 1, players: [{ hand: [], graveyard: [], selectedRank: null, pendingChoice: null }] }), ['public-player-hand', 'public-player-graveyard', 'public-player-selectedRank', 'public-player-pendingChoice', 'public-state-selectedRank']);
});

test('ready backs reject selected rank, identity labels, images and nested crew faces', () => {
  const marker = { id: 'libertalia-ready-a', text: 'CREW READY', labels: ['Secret selection submitted'], sources: [], crewFaces: 0 };
  const state = { players: [{ playerId: 'a', ready: true }] };
  verifyReady([marker], state);
  for (const change of [{ text: 'Rank 9' }, { labels: ['#12'] }, { labels: ['Secret Witch'] }, { sources: ['/night.webp'] }, { crewFaces: 1 }, { id: 'libertalia-ready-unknown' }]) assert.throws(() => verifyReady([{ ...marker, ...change }], state));
  assert.match(helper, /post.privacyGaps/);
});

test('exact bundle, ordinary API and local network guards precede browser launch', async () => {
  assert.throws(() => local('https://localhost.example.com'));
  assert.throws(() => local('http://user:secret@localhost'));
  await assert.rejects(bundleFence('https://example.com', '.', 'a'.repeat(64)));
  await assert.rejects(bundleFence('http://localhost:8081', '.', 'invalid'));
  await assert.rejects(bundleFence('http://localhost:8081', '', 'a'.repeat(64)));
  assert.match(driver, /LIBERTALIA_UI_EXCLUSIVE_WINDOW, 'granted'/);
  assert.match(driver, /'zuychin-arcade-server', 'Ordinary API only/);
  assert(driver.indexOf('qa.evidence.bundle = await servedHash()') < driver.indexOf('browser = await puppeteer.launch'));
  assert.match(natural, /assert.deepEqual\(recorder.evidence.finalBundle, recorder.evidence.bundle/);
  assert.match(driver, /await guardNetwork\(player.page, qa.origins/);
});

test('redacted immutable run receipts retain failures and credentials only in memory', () => {
  const value = redact({ revision: 12, error: 'fleet Bearer token eyJheader.payload.signature' }, ['fleet']);
  assert.match(value, /12/);
  for (const secret of ['fleet', 'Bearer token', 'eyJheader.payload.signature']) assert(!value.includes(secret));
  assert.match(driver, /Choose a new output directory/);
  assert.match(driver, /if \(ownsOutput\) writeReceipt\('failure.json'/);
  assert.match(driver, /qa.secrets.add\(auth.token\)/);
  assert.match(natural, /\['\/rooms\/create', '\/rooms\/join'\]/);
});

test('CSS200 records same connected nodes and computed fonts after the actual screenshot', () => {
  const sample = { before: 15, after: 30, family: 'Outfit', afterFamily: 'Outfit', connected: true };
  validateFonts([sample]);
  for (const change of [{ connected: false }, { after: 15 }, { afterFamily: 'fallback' }]) assert.throws(() => validateFonts([{ ...sample, ...change }]));
  assert.throws(() => validateFonts([]));
  assert(helper.indexOf('await ready(page, allowTransient)') < helper.indexOf('attempt.baseline = await enlargeLibertaliaText(page)'));
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('const post = await page.evaluate(geometry'));
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('validateLibertaliaFontState(post.textScaleState)'));
  assert.match(helper, /attempt.failureFonts/);
  assert.match(helper, /actor.latestPrivate\?\.playerId === auth.playerId/);
  assert.match(helper, /Reconnecting\|Refreshing\|Retry connection/);
  assert.doesNotMatch(driver, /__qaFontRestore|element.style.fontSize/);
});

test('glyph calibration preserves raw diagnostics and only exempts exactly proven whitespace', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const rect = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const measured = { rawRects: [rect], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [rect] }] };
  const proof = () => context.window.__coupQAOverflowProof([measured], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  measured.glyphRects = [{ ...rect, character: 'X' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  measured.glyphRects = []; measured.characters[0].rects = [{ ...rect, left: 10 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
  assert.match(helper, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
  assert.match(helper, /rawRangeDiagnostics.push/);
});

test('visible card child escape and decision sibling intrusion are detected, not offscreen rail contents', () => {
  const content = { kind: 'control', label: 'CONFIRM CREW', bounds: { left: 100, right: 240, top: 90, bottom: 150 } };
  const measurement = { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{ id: 'crew', kind: 'card', bounds: { left: 16, right: 180, top: 20, bottom: 120 }, content: [content], siblings: [{ id: 'table', bounds: { left: 200, right: 360, top: 20, bottom: 500 } }] }] };
  assert.deepEqual(classifyContainment(measurement).map(item => item.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
  measurement.cards[0].kind = 'decision'; assert.equal(classifyContainment(measurement).length, 2);
  content.visibleBounds = { left: 20, right: 170, top: 20, bottom: 115 }; assert.deepEqual(classifyContainment(measurement), []);
  delete content.visibleBounds; content.bounds = { left: 30, right: 150, top: 30, bottom: 90 }; assert.deepEqual(classifyContainment(measurement), []);
  assert.match(helper, /await calibrateContainment/);
  assert.equal(LIBERTALIA_CONTAINMENT.decisionId, 'libertalia-decision-area');
  assert(LIBERTALIA_CONTAINMENT.cardSelector.includes('libertalia-loot-token-'));
});

test('fixed phone and desktop input contexts preserve flags, viewport captures, rails and result ends', () => {
  assert.deepEqual(MATRIX.map(([width]) => width), [320, 375, 414, 768, 1280, 844]);
  assert(MATRIX.some(([, height]) => height === 390));
  assert.match(driver, /setViewport\(\{ \.\.\.page.viewport\(\), width, height/);
  assert.match(driver, /hasTouch\) await control.tap\(\)/);
  assert.match(driver, /bounds.width >= 48 && bounds.height >= 48/);
  assert.match(helper, /c.width < 48 \|\| c.height < 48/);
  assert.match(driver, /await captureHandFaces\(host\)/);
  assert.match(driver, /await captureResultDetails\(\[host, players\[2\]\]/);
  assert.match(driver, /Hand browsing reaches actual endpoint/);
  assert.match(driver, /\[375, 414, 1280\]\[index\]/);
  assert(LAYOUT_IDS.includes('libertalia-results'));
  assert.match(helper, /png.readUInt32BE\(16\)/);
  assert.doesNotMatch(driver + helper, /fullPage: true|deviceScaleFactor: 2/);
});

test('existing own-option policy, one complete game and scripted forfeit rematch remain distinct', () => {
  assert.equal(CHOICE_KINDS.length, 10);
  assert.match(driver, /choice.options\[\(pub.day \+ index\) % choice.options.length\]/);
  assert.match(driver, /mine.hand\[\(pub.day \+ index\) % mine.hand.length\]/);
  assert.match(driver, /receipt.terminal.voyage, 3/);
  assert.match(driver, /receipt.terminal.endReason, 'score'/);
  assert.match(driver, /host.latestPublic.endReason, 'forfeit'/);
  assert.match(helper, /not a second natural game or independent competitive play/);
  assert.match(driver, /rareBranchGaps/);
  assert.match(driver, /30 \* 60_000/);
  assert.match(helper, /evidence.attempts.length < CAPTURE_LIMIT/);
  assert.match(driver, /Normal exit clears session authentication/);
  assert.match(driver, /normalUI: false, fallback: true/);
  assert.match(driver, /for \(const player of qa.actors.values\(\)\)/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
});

function containmentSandbox(t) {
  const parent = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, 'libertalia-containment-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), parent); assert(!fs.lstatSync(directory).isSymbolicLink());
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      assert.equal(path.dirname(file), directory); assert(fs.lstatSync(file).isFile()); fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  return directory;
}

function rawContainment() {
  const bounds = { left: 0, right: 100, top: 0, bottom: 100 };
  return { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, boundaries: { cardCount: 1 }, cards: [{
    id: 'crew-6', kind: 'card', bounds, visibleBounds: bounds,
    content: [{ kind: 'glyph', label: 'X', bounds: { left: 95, right: 112, top: 20, bottom: 40 }, visibleBounds: { left: 0, right: 375, top: 0, bottom: 844 } }],
    siblings: [{ id: 'crew-7', bounds: { left: 105, right: 205, top: 0, bottom: 100 } }],
  }] };
}

test('atomic containment sidecars retain every raw field, redact secrets and hash exact persisted bytes', t => {
  const directory = containmentSandbox(t), raw = rawContainment();
  raw.cards[0].content[0].label = 'private-marker'; raw.token = 'unregistered-secret';
  let renamed = false;
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (temporary, target) => {
    assert.equal(path.dirname(temporary), directory); assert.equal(path.dirname(target), directory);
    assert(!fs.existsSync(target));
    const data = fs.readFileSync(temporary, 'utf8');
    assert(!data.includes('private-marker')); assert(!data.includes('unregistered-secret'));
    assert.equal(JSON.parse(data).measurements.cards[0].siblings.length, 1);
    renamed = true; return original(temporary, target);
  });
  const descriptor = persistContainment(directory, '001-face.png', raw, ['private-marker']);
  assert(renamed); assert.equal(descriptor.storage, 'json-sidecar');
  const bytes = fs.readFileSync(path.join(directory, descriptor.file));
  assert.equal(descriptor.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(descriptor.bytes, bytes.length);
  assert.deepEqual(JSON.parse(bytes).measurements, JSON.parse(redact(raw, ['private-marker'])));
  assert.deepEqual([descriptor.cardCount, descriptor.contentCount, descriptor.siblingCount], [1, 1, 1]);
  assert(!Object.hasOwn(descriptor, 'cards'));
  assert.deepEqual(fs.readdirSync(directory), ['containment-001.json']);
  assert.throws(() => persistContainment(directory, '001-replacement.png', raw), /overwrite/);
  for (const file of ['../001-face.png', '000-face.png', '219-face.png']) assert.throws(() => persistContainment(directory, file, raw));
  assert.equal(fs.readFileSync(path.join(directory, descriptor.file)).equals(bytes), true);
});

function recorderProbe(directory, measurements, { width = 375, classify = classifyContainment } = {}) {
  const module = { exports: {} }, actual = require('./skull-ui-evidence.cjs');
  vm.runInNewContext(helper, {
    module, __dirname, URL, Buffer, setTimeout,
    process: { env: { ...process.env, QA_STATIC_ROOT: directory }, memoryUsage: () => process.memoryUsage() },
    require: name => name === './skull-ui-evidence.cjs' ? { ...actual, settle: async () => {}, classifyContainment: classify } : require(name),
  }, { filename: 'libertalia-ui-evidence.cjs' });
  const page = {
    url: () => 'http://127.0.0.1:8081/qa', viewport: () => ({ width: 375, height: 844, hasTouch: false }),
    evaluate: async fn => {
      if (fn.name === 'geometry') return { width, height: 844, documentWidth: 375, touchPoints: 0, coarse: false, images: [], cards: [], loot: [], ready: [], clipped: [], controls: [], layout: {} };
      if (fn.name === 'measureContainment') return structuredClone(measurements);
      if (fn.name === 'fontSamples') return [];
    },
    screenshot: async ({ path: target }) => { const png = Buffer.alloc(24); png.writeUInt32BE(375, 16); png.writeUInt32BE(844, 20); fs.writeFileSync(target, png); },
  };
  const qa = module.exports.createEvidence({ outputDir: directory, base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
  qa.register({ page, latestPublic: { players: [] } });
  return { page, qa };
}

test('capture persists raw containment before failing validation and retains the failure link', async t => {
  const directory = containmentSandbox(t), raw = rawContainment();
  const { page, qa } = recorderProbe(directory, raw, { width: 374 });
  await assert.rejects(qa.capture(page, 'invalid-width.png'));
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'visual-receipt.json')));
  const record = receipt.captures[0], descriptor = record.metrics.containment;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, descriptor.file))).measurements, raw);
  assert.equal(record.metrics.containmentFindings.length, 2);
  assert.equal(receipt.attempts[0].containment.sha256, descriptor.sha256);
  assert(receipt.attempts[0].error); assert(receipt.attempts[0].memory.failed.rss > 0);
  assert(!Object.hasOwn(record.metrics.containment, 'cards'));
});

test('capture archives raw geometry before classifier failure, not only after a passing check', async t => {
  const directory = containmentSandbox(t), raw = rawContainment();
  const { page, qa } = recorderProbe(directory, raw, { classify: () => {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'containment-001.json'))).measurements, raw);
    throw Error('deliberate classification failure');
  } });
  await assert.rejects(qa.capture(page, 'classifier.png'), /deliberate classification failure/);
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'visual-receipt.json')));
  assert.equal(receipt.captures.length, 0);
  assert.equal(receipt.attempts[0].containment.file, 'containment-001.json');
  assert.match(receipt.attempts[0].error, /deliberate classification failure/);
});

test('repeated captures release bulk geometry while keeping original containment findings and memory checkpoints', async t => {
  const directory = containmentSandbox(t), raw = rawContainment();
  raw.cards[0].content.push(...Array.from({ length: 1000 }, () => ({ kind: 'glyph', label: 'Y', bounds: { left: 10, right: 20, top: 20, bottom: 40 } })));
  const { page, qa } = recorderProbe(directory, raw);
  for (let index = 0; index < 4; index++) {
    const record = await qa.capture(page, `face-${index}.png`);
    assert.equal(record.metrics.containment.contentCount, 1001);
    assert.equal(record.metrics.containmentFindings.length, 2);
    assert(record.memory.completed.heapUsed > 0); assert(record.memory.measured.rss > 0);
    assert(!Object.hasOwn(record.metrics.containment, 'cards'));
  }
  assert.equal(qa.evidence.findings.length, 4);
  const rawBytes = fs.readdirSync(directory).filter(name => name.startsWith('containment-')).reduce((count, name) => count + fs.statSync(path.join(directory, name)).size, 0);
  assert(rawBytes > fs.statSync(path.join(directory, 'visual-receipt.json')).size * 5);
  assert.equal(JSON.stringify(qa.evidence).includes('"label":"Y"'), false, 'No accumulated raw glyph graphs in attempts, captures or findings');
});
