const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { MATRIX, CAPTURE_LIMIT, createEvidence, PLACE_ART_BY_ID, LAYOUT_IDS, bundleFence, local, redact, validateFonts, NOT_ALONE_CONTAINMENT, hasOwnedNotAlonePair } = require('./not-alone-ui-evidence.cjs');
const { installTextGeometry, classifyContainment } = require('./skull-ui-evidence.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'not-alone-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8');

function receiptSandbox(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'not-alone-receipt-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert(path.basename(directory).startsWith('not-alone-receipt-test-'));
    assert(!fs.lstatSync(directory).isSymbolicLink());
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      assert.equal(path.dirname(file), directory);
      assert(fs.lstatSync(file).isFile());
      fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  const receipt = path.join(directory, 'receipt.json'), previous = '{"generation":1}\n';
  fs.writeFileSync(receipt, previous);
  fs.writeFileSync(path.join(directory, 'existing-evidence.png'), 'untouched');
  return { directory, receipt, previous };
}

function receiptWriter(directory, overrides = {}, cryptoOverrides = {}, runtime = {}) {
  const module = { exports: {} };
  vm.runInNewContext(helper, {
    module, __dirname, process: { ...process, platform: runtime.platform ?? process.platform }, URL,
    Atomics: runtime.wait ? { wait: runtime.wait } : Atomics,
    require: name => name === 'node:fs' ? { ...fs, ...overrides }
      : name === 'node:crypto' ? { ...require('node:crypto'), ...cryptoOverrides }
      : name === 'node:perf_hooks' && runtime.now ? { performance: { now: runtime.now } } : require(name),
  }, { filename: 'not-alone-ui-evidence.cjs' });
  return module.exports.createEvidence({ outputDir: directory, base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
}

function assertReceiptUntouched({ directory, receipt, previous }) {
  assert.equal(fs.readFileSync(receipt, 'utf8'), previous);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['existing-evidence.png', 'receipt.json']);
  assert.equal(fs.readFileSync(path.join(directory, 'existing-evidence.png'), 'utf8'), 'untouched');
}

function retryClock(platform = 'win32') {
  let elapsed = 0;
  const waits = [];
  return { platform, now: () => elapsed, waits, wait(_cell, index, expected, milliseconds) {
    assert.equal(index, 0); assert.equal(expected, 0);
    assert(milliseconds > 0 && milliseconds <= 25);
    waits.push(milliseconds); elapsed += milliseconds;
  } };
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows ${code} rename retries reuse flushed bytes and leave the previous receipt intact until success`, t => {
    const fixture = receiptSandbox(t), clock = retryClock(), counts = {};
    const overrides = {};
    for (const name of ['openSync', 'writeFileSync', 'fsyncSync', 'closeSync']) {
      overrides[name] = (...args) => { counts[name] = (counts[name] ?? 0) + 1; return fs[name](...args); };
    }
    let attempts = 0, temporary;
    overrides.renameSync = (from, to) => {
      attempts += 1;
      assert.equal(fs.readFileSync(to, 'utf8'), fixture.previous);
      assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).generation, 2);
      if (temporary) assert.equal(from, temporary); else temporary = from;
      if (attempts <= 2) throw Object.assign(new Error('temporary sharing error'), { code });
      fs.renameSync(from, to);
    };
    const qa = receiptWriter(fixture.directory, overrides, {}, clock);
    qa.evidence.generation = 2; qa.persist();
    assert.equal(attempts, 3); assert.deepEqual(clock.waits, [25, 25]);
    assert.deepEqual(counts, { openSync: 1, writeFileSync: 1, fsyncSync: 1, closeSync: 1 });
    assert.equal(JSON.parse(fs.readFileSync(fixture.receipt, 'utf8')).generation, 2);
    assert.deepEqual(fs.readdirSync(fixture.directory).sort(), ['existing-evidence.png', 'receipt.json']);
  });
}

test('permanent Windows sharing errors stop at two seconds and preserve the first rename error', t => {
  const fixture = receiptSandbox(t), clock = retryClock();
  const first = Object.assign(new Error('first rename error'), { code: 'EPERM' });
  let attempts = 0;
  const qa = receiptWriter(fixture.directory, { renameSync() {
    attempts += 1;
    assert.equal(fs.readFileSync(fixture.receipt, 'utf8'), fixture.previous);
    throw attempts === 1 ? first : Object.assign(new Error('later rename error'), { code: 'EBUSY' });
  } }, {}, clock);
  assert.throws(() => qa.persist(), error => error === first);
  assert.equal(clock.now(), 2000); assert.equal(attempts, 80);
  assert.equal(clock.waits.length, 80); assertReceiptUntouched(fixture);
});

test('real synchronous waiting recovers from one injected Windows sharing error', t => {
  const fixture = receiptSandbox(t);
  let attempts = 0;
  const qa = receiptWriter(fixture.directory, { renameSync(from, to) {
    attempts += 1;
    assert.equal(fs.readFileSync(to, 'utf8'), fixture.previous);
    if (attempts === 1) throw Object.assign(new Error('sharing error'), { code: 'EPERM' });
    fs.renameSync(from, to);
  } }, {}, { platform: 'win32' });
  qa.persist();
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(fs.readFileSync(fixture.receipt, 'utf8')).captureBudget, CAPTURE_LIMIT);
  assert.deepEqual(fs.readdirSync(fixture.directory).sort(), ['existing-evidence.png', 'receipt.json']);
});

test('other rename errors and non-Windows sharing errors fail immediately without waiting', t => {
  const fixture = receiptSandbox(t);
  for (const [platform, code] of [['win32', 'EIO'], ['win32', 'ENOENT'], ['linux', 'EPERM']]) {
    const clock = retryClock(platform), expected = Object.assign(new Error('no retry'), { code });
    let attempts = 0;
    const qa = receiptWriter(fixture.directory, { renameSync() { attempts += 1; throw expected; } }, {}, clock);
    assert.throws(() => qa.persist(), error => error === expected);
    assert.equal(attempts, 1); assert.deepEqual(clock.waits, []); assertReceiptUntouched(fixture);
  }
});

test('sharing codes from other I/O are never retried', t => {
  const fixture = receiptSandbox(t), clock = retryClock();
  let attempts = 0;
  const expected = Object.assign(new Error('flush failure'), { code: 'EPERM' });
  const qa = receiptWriter(fixture.directory, {
    fsyncSync() { attempts += 1; throw expected; },
    renameSync() { assert.fail('Flush failure must not reach rename'); },
  }, {}, clock);
  assert.throws(() => qa.persist(), error => error === expected);
  assert.equal(attempts, 1); assert.deepEqual(clock.waits, []); assertReceiptUntouched(fixture);
});

test('retry rechecks receipt safety and stops if the target becomes a symlink', t => {
  const fixture = receiptSandbox(t), clock = retryClock();
  let attempts = 0;
  const qa = receiptWriter(fixture.directory, {
    renameSync() { attempts += 1; throw Object.assign(new Error('sharing error'), { code: 'EPERM' }); },
    lstatSync(file) { return file === fixture.receipt && attempts > 0 ? { isSymbolicLink: () => true } : fs.lstatSync(file); },
  }, {}, clock);
  assert.throws(() => qa.persist(), /Receipt target must be a regular file/);
  assert.equal(attempts, 1); assert.deepEqual(clock.waits, [25]); assertReceiptUntouched(fixture);
});

test('receipt replacement exclusively writes and flushes redacted bytes before closing and renaming', t => {
  const fixture = receiptSandbox(t), operations = [], temporaryPaths = [];
  let descriptor;
  const qa = receiptWriter(fixture.directory, {
    openSync(file, flags, mode) {
      assert.equal(path.dirname(file), fixture.directory);
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      assert.notEqual(file, fixture.receipt); temporaryPaths.push(file);
      operations.push('open'); descriptor = fs.openSync(file, flags, mode); return descriptor;
    },
    writeFileSync(fd, bytes, encoding) {
      assert.equal(fd, descriptor); assert.equal(encoding, 'utf8');
      assert(!bytes.includes('private-token-value')); assert(!bytes.includes('another-secret'));
      operations.push('write'); return fs.writeFileSync(fd, bytes, encoding);
    },
    fsyncSync(fd) { assert.equal(fd, descriptor); operations.push('flush'); fs.fsyncSync(fd); },
    closeSync(fd) { assert.equal(fd, descriptor); operations.push('close'); fs.closeSync(fd); },
    renameSync(from, to) {
      assert.equal(to, fixture.receipt);
      assert.equal(fs.readFileSync(to, 'utf8'), fixture.previous);
      assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).generation, 2);
      assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
      operations.push('rename'); fs.renameSync(from, to);
    },
  });
  qa.secrets.add('private-token-value');
  qa.evidence.generation = 2;
  qa.evidence.failure = 'private-token-value Bearer another-secret';
  qa.persist();
  assert.deepEqual(operations, ['open', 'write', 'flush', 'close', 'rename']);
  const saved = fs.readFileSync(fixture.receipt, 'utf8');
  assert.equal(JSON.parse(saved).generation, 2);
  assert(!saved.includes('private-token-value')); assert(!saved.includes('another-secret'));
  assert(saved.endsWith('\n'));
  assert.deepEqual(fs.readdirSync(fixture.directory).sort(), ['existing-evidence.png', 'receipt.json']);
  fixture.previous = saved; operations.length = 0;
  qa.persist();
  assert.notEqual(temporaryPaths[0], temporaryPaths[1]);
});

for (const failure of ['writeFileSync', 'fsyncSync', 'closeSync', 'renameSync']) {
  test(`receipt ${failure} failure retains the previous bytes and removes only its temporary file`, t => {
    const fixture = receiptSandbox(t), expected = new Error(`injected ${failure} failure`);
    let failed = false;
    const qa = receiptWriter(fixture.directory, {
      [failure](...args) {
        if (failed) return fs[failure](...args);
        failed = true;
        if (failure === 'writeFileSync') fs.writeSync(args[0], '{"partial":');
        throw expected;
      },
    });
    assert.throws(() => qa.persist(), error => error === expected);
    assertReceiptUntouched(fixture);
  });
}

test('exclusive creation collision leaves the pre-existing temporary file untouched', t => {
  const fixture = receiptSandbox(t), id = 'existing-file';
  const temporary = path.join(fixture.directory, `.receipt-${process.pid}-${id}.tmp`);
  fs.writeFileSync(temporary, 'not owned by this write');
  const qa = receiptWriter(fixture.directory, {}, { randomUUID: () => id });
  assert.throws(() => qa.persist(), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'not owned by this write');
  assert.equal(fs.readFileSync(fixture.receipt, 'utf8'), fixture.previous);
  fs.unlinkSync(temporary); assertReceiptUntouched(fixture);
});

test('first receipt creation retains the public API and leaves no temporary file', t => {
  const fixture = receiptSandbox(t);
  fs.unlinkSync(fixture.receipt);
  const qa = createEvidence({ outputDir: fixture.directory, base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
  assert.equal(qa.outputDir, fixture.directory);
  qa.persist();
  assert.equal(JSON.parse(fs.readFileSync(fixture.receipt, 'utf8')).captureBudget, CAPTURE_LIMIT);
  assert.deepEqual(fs.readdirSync(fixture.directory).sort(), ['existing-evidence.png', 'receipt.json']);
});

test('cleanup failure never replaces the original persistence error', t => {
  const fixture = receiptSandbox(t), expected = new Error('primary flush failure');
  const qa = receiptWriter(fixture.directory, {
    fsyncSync() { throw expected; },
    unlinkSync() { throw new Error('secondary cleanup failure'); },
  });
  assert.throws(() => qa.persist(), error => error === expected);
  assert.equal(fs.readFileSync(fixture.receipt, 'utf8'), fixture.previous);
  const remaining = fs.readdirSync(fixture.directory).filter(name => name.startsWith('.receipt-'));
  assert.equal(remaining.length, 1);
  fs.unlinkSync(path.join(fixture.directory, remaining[0]));
  assertReceiptUntouched(fixture);
});

test('unsafe receipt or output symlinks are rejected without opening a temporary file', t => {
  const fixture = receiptSandbox(t);
  for (const unsafe of [fixture.receipt, fixture.directory, path.dirname(fixture.directory)]) {
    const qa = receiptWriter(fixture.directory, {
      lstatSync(file) { return file === unsafe ? { isSymbolicLink: () => true } : fs.lstatSync(file); },
      openSync() { assert.fail('Unsafe paths must fail before exclusive creation'); },
    });
    assert.throws(() => qa.persist(), /Receipt (target|output)/);
    assertReceiptUntouched(fixture);
  }
  for (const output of ['', path.parse(fixture.directory).root]) {
    assert.throws(() => receiptWriter(output).persist(), /Receipt output/);
  }
});

test('rare-branch receipt credits the actual sealed reload key without hiding unperformed Shelter checks', () => {
  const expression = driver.match(/qa\.evidence\.rareBranchGaps = ([^\n]+);/)?.[1];
  assert(expression);
  const recorded = driver.match(/coverage\.add\('(forbidden:sealed-reload)'\)/)?.[1];
  assert.equal(recorded, 'forbidden:sealed-reload');
  const gaps = keys => Array.from(vm.runInNewContext(expression, { coverage: new Set(keys) }));
  assert.deepEqual(gaps([]), ['shelter_choice_reload', 'shelter_double_submit_fence', recorded]);
  assert.deepEqual(gaps([recorded]), ['shelter_choice_reload', 'shelter_double_submit_fence']);
  assert.deepEqual(gaps(['shelter_choice_reload', 'shelter_double_submit_fence']), [recorded]);
  assert.deepEqual(gaps(['shelter_choice_reload', 'shelter_double_submit_fence', recorded]), []);
  assert.deepEqual(gaps(['forbidden_zone_reload']), gaps([]));
});

test('160-frame hard cap includes row coverage and rejects before browser or disk work', async () => {
  assert.equal(CAPTURE_LIMIT, 160);
  const qa = createEvidence({ outputDir: 'unused-cap-test', base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
  assert.equal(qa.outputDir, 'unused-cap-test');
  assert.equal(qa.evidence.captureBudget, 160);
  qa.evidence.attempts.length = 160;
  await assert.rejects(qa.capture(null, 'never-written.png'), /Bounded capture budget exceeded/);
  assert.equal(qa.evidence.attempts.length, 160);
  assert.equal(qa.evidence.captures.length, 0);
});

test('Place IDs 1–10 retain exact canonical artwork names and hash association', () => {
  const names = ['lair', 'jungle', 'river', 'beach', 'rover', 'swamp', 'shelter', 'wreck', 'source', 'artefact'];
  assert.deepEqual(PLACE_ART_BY_ID, Object.fromEntries(names.map((name, index) => [index + 1, 'not-alone-place-' + name])));
  assert(Object.isFrozen(PLACE_ART_BY_ID));
  for (const artwork of Object.values(PLACE_ART_BY_ID)) assert(fs.existsSync(path.join(__dirname, '../assets/game-art', artwork + '.webp')));
  assert.match(helper, /assert.equal\(image.artwork, PLACE_ART_BY_ID\[image.placeId\]/);
  assert.match(helper, /assert.equal\(servedHash, diskHash/);
  assert.doesNotMatch(helper + driver, /not-alone-place-\$\{c\}/);
});

test('exact local bundle and explicit ordinary versus fixture gates precede browser launch', async () => {
  assert.throws(() => local('https://localhost.example.com'));
  assert.throws(() => local('http://user:secret@localhost'));
  await assert.rejects(bundleFence('https://example.com', '.', 'a'.repeat(64)));
  await assert.rejects(bundleFence('http://localhost:8081', '.', 'invalid'));
  await assert.rejects(bundleFence('http://localhost:8081', '', 'a'.repeat(64)));
  assert.match(driver, /NOT_ALONE_UI_EXCLUSIVE_WINDOW === 'granted'/);
  assert.match(driver, /fixtureMode \? 'not-alone-ui-fixture' : 'zuychin-arcade-server'/);
  assert(driver.indexOf('const bundle = await bundleFence') < driver.indexOf('browser = await puppeteer.launch'));
});

test('credentials stay redacted and failed prelaunch never overwrites an existing directory', () => {
  const text = redact({ revision: 17, token: 'known-secret', error: 'Bearer unknown-secret eyJheader.payload.signature' }, ['known-secret']);
  assert.match(text, /17/);
  for (const secret of ['known-secret', 'unknown-secret', 'eyJheader.payload.signature']) assert(!text.includes(secret));
  assert.match(driver, /Choose a new output directory/);
  assert.match(driver, /if \(ownsOutput\) writeReceipt\('failure.txt'/);
  assert.match(driver, /qa.secrets.add\(auth.token\)/);
});

test('capture readiness accepts the actual owned projection identity without private viewerPlayerId', () => {
  const auth = { playerId: 'owner', roomCode: 'ROOM-1234' };
  const publicState = { viewerPlayerId: 'owner', roomCode: auth.roomCode, revision: 12 };
  const privateState = { playerId: 'owner', roomCode: auth.roomCode, revision: 12 };
  assert.equal(Object.hasOwn(privateState, 'viewerPlayerId'), false);
  assert.equal(hasOwnedNotAlonePair(auth, publicState, privateState), true);
  assert.equal(hasOwnedNotAlonePair(auth, { ...publicState, revision: 0 }, { ...privateState, revision: 0 }), true);
  for (const change of [{ playerId: 'other' }, { playerId: undefined, viewerPlayerId: 'owner' }, { roomCode: 'OTHER' }, { roomCode: undefined }, { revision: 13 }]) {
    assert.equal(hasOwnedNotAlonePair(auth, publicState, { ...privateState, ...change }), false);
  }
  for (const change of [{ viewerPlayerId: 'other' }, { viewerPlayerId: undefined }, { roomCode: 'OTHER' }, { roomCode: undefined }, { revision: 11 }]) {
    assert.equal(hasOwnedNotAlonePair(auth, { ...publicState, ...change }, privateState), false);
  }
  for (const revision of [undefined, null, -1, NaN, 0.5]) {
    assert.equal(hasOwnedNotAlonePair(auth, { ...publicState, revision }, { ...privateState, revision }), false);
  }
  for (const args of [[null, publicState, privateState], [auth, null, privateState], [auth, publicState, null], [{}, {}, {}]]) {
    assert.equal(hasOwnedNotAlonePair(...args), false);
  }
  assert.match(helper, /\? hasOwnedNotAlonePair\(auth, actor.latestPublic, actor.latestPrivate\)/);
});

test('CSS200 validates persistent identity, computed size and font after screenshots', () => {
  const sample = { before: 14, after: 28, family: 'Outfit', afterFamily: 'Outfit', connected: true };
  validateFonts([sample]);
  for (const change of [{ connected: false }, { after: 14 }, { afterFamily: 'fallback' }]) assert.throws(() => validateFonts([{ ...sample, ...change }]));
  assert.throws(() => validateFonts([]));
  assert(helper.indexOf('await ready(page, allowTransient)') < helper.indexOf('attempt.baseline = await enlarge(page)'));
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('const post = await page.evaluate(geometry'));
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('if (scale) validateFonts(post.fonts)'));
  assert.match(helper, /attempt.failureFonts = await page.evaluate\(fontSamples\)/);
  assert.match(helper, /Updating the table/);
  assert.doesNotMatch(driver, /deviceScaleFactor: 2|fontSize\) \* 1.5/);
});

test('glyph calibration separates real overflow, whitespace and unexplained raw bounds', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const rect = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const measured = { rawRects: [rect], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [rect] }] };
  const proof = () => context.window.__coupQAOverflowProof([measured], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  measured.glyphRects = [{ ...rect, character: 'A' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  measured.glyphRects = []; measured.characters[0].rects = [{ ...rect, left: 10 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
  assert.match(helper, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
  assert.match(helper, /rawRangeDiagnostics.push/);
});

test('standalone card height escape and decision sibling intrusion are detected, rail ends are not', () => {
  const bounds = { left: 16, right: 180, top: 20, bottom: 120 };
  const content = { kind: 'control', label: 'CHOOSE', bounds: { left: 100, right: 240, top: 90, bottom: 150 } };
  const measurement = { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{ id: 'place', kind: 'card', bounds, content: [content], siblings: [{ id: 'table', bounds: { left: 200, right: 360, top: 20, bottom: 500 } }] }] };
  assert.deepEqual(classifyContainment(measurement).map(f => f.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
  measurement.cards[0].kind = 'decision'; assert.equal(classifyContainment(measurement).length, 2);
  content.visibleBounds = { left: 20, right: 170, top: 20, bottom: 115 }; assert.deepEqual(classifyContainment(measurement), []);
  delete content.visibleBounds; content.bounds = { left: 30, right: 150, top: 30, bottom: 90 }; assert.deepEqual(classifyContainment(measurement), []);
  assert.match(helper, /await calibrateContainment/);
  assert.equal(NOT_ALONE_CONTAINMENT.decisionId, 'not-alone-decision-area');
  assert.match(NOT_ALONE_CONTAINMENT.cardSelector, /not-alone-place-card-/);
});

test('phone desktop landscape input flags remain fixed and viewport-only output is measured', () => {
  assert.deepEqual(MATRIX.map(([width]) => width), [320, 375, 414, 768, 1280, 844]);
  assert(MATRIX.some(([, height]) => height === 390));
  assert.match(driver, /setViewport\(\{ \.\.\.page.viewport\(\), width, height/);
  assert.match(driver, /hasTouch\) await button.tap\(\)/);
  assert.match(driver, /for \(const width of \[375, 1280\]\)/);
  assert.match(helper, /png.readUInt32BE\(16\)/);
  assert.match(helper, /c.width < 48 \|\| c.height < 48/);
  assert.match(driver, /captureRailEnds\(player, id\)/);
  assert.match(driver, /coverage.has\('gameplay-evidence:' \+ matchNumber\)/);
  assert(LAYOUT_IDS.includes('not-alone-public-table'));
  for (const phase of ['entrance', 'lobby', 'results']) assert(driver.includes(`captureMatrix(host, '${phase}'`));
});

test('legacy coordination, Shelter assertions and later independent owner-view gate stay explicit', () => {
  assert.match(driver, /not fair competitive or own-view-only play/);
  assert.match(driver, /Separate owner-view natural gate required/);
  assert.match(driver, /flatMap\(\(player\) => player.latestPrivate.selectedPlaces/);
  assert.match(driver, /sentAfter - sentBefore === 1/);
  assert.match(driver, /acceptedAfter - acceptedBefore === 1/);
  assert.match(driver, /Reload lost the mandatory Shelter keep-one decision/);
  assert.match(driver, /rareBranchGaps/);
  assert.match(driver, /driveFullMatch\(players, 1, 'catch'\)/);
  assert.match(driver, /driveFullMatch\(players, 2, 'escape'\)/);
});

test('cleanup retains normal UI versus fallback and closes even partially opened contexts', () => {
  assert.match(driver, /30 \* 60_000/);
  assert.match(driver, /for \(const player of qa.actors.values\(\)\)/);
  assert.match(driver, /normalUI: !player.fallbackCleanup/);
  assert.match(driver, /normalUI: false, fallback: true/);
  assert.match(driver, /record.authCleared = authCleared/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.match(helper, /assert.equal\(servedHash, diskHash/);
  assert.match(helper, /artworkNotObserved/);
});

test('ordinary receipt retains initial identity and a redacted failure before cleanup', () => {
  const main = driver.slice(driver.indexOf('async function main()'));
  const initialHashes = main.indexOf('qa.evidence.sourceHashes = sourceHashes');
  const initialBuild = main.indexOf('qa.evidence.exportedBuild = exportedBuild; qa.persist()');
  assert(initialHashes > 0 && initialBuild > initialHashes);
  assert(initialBuild < main.indexOf('const health = await fetch(API_URL'));
  assert.match(main, /catch \(error\) \{\s+qa\.evidence\.failure = redact\(error\.stack \?\? error\.message \?\? String\(error\), \[\.\.\.qa\.secrets\]\);\s+qa\.persist\(\);\s+throw error;\s+\} finally \{/);
});

test('trail and configurable-power screenshots frame the live target after readiness, before commitment', () => {
  assert.match(driver, /async function screenshot\(page, name, frame = null\)/);
  assert.match(driver, /allowTransient: \/reconnecting\/\.test\(name\), frame, align: frame \? 'start' : 'center'/);
  assert.match(driver, /`11-public-discard-trails-\$\{width\}\.png`, '#not-alone-public-trails'/);
  const resolution = driver.slice(driver.indexOf('async function chooseResolution'), driver.indexOf('async function performOneAction'));
  const powerCapture = resolution.indexOf('`14-match-${matchNumber}-place-${place}-power-${player.width}.png`');
  const confirmation = resolution.indexOf('`resolve Place ${place} power`');
  assert(powerCapture > 0 && powerCapture < confirmation);
  assert.match(resolution, /power-\$\{player.width\}\.png`, '#not-alone-decision-area'/);
  assert(helper.indexOf('await ready(page, allowTransient)') < helper.indexOf('if (frame) await page.$eval(frame'));
  assert.match(helper, /viewport: page.viewport\(\), frame, align, allowTransient/);
});

test('ordinary screenshot calls pass only an explicit selector or null, never a legacy boolean', async () => {
  assert.doesNotMatch(driver, /screenshot\([^\n]+,\s*(true|false)\)/);
  const calls = [];
  const source = driver.slice(driver.indexOf('async function screenshot('), driver.indexOf('async function captureMatrix('));
  const screenshot = vm.runInNewContext(`(${source})`, {
    assert, screenshots: new Set(), qa: { capture: (...args) => calls.push(args) },
  });
  const page = {};
  await screenshot(page, 'plain.png');
  await screenshot(page, 'framed.png', '#not-alone-decision-area');
  await screenshot(page, 'reconnecting.png');
  assert.deepEqual(calls.map(([owner, name, options]) => ({ owner, name, ...options })), [
    { owner: page, name: 'plain.png', allowTransient: false, frame: null, align: 'center' },
    { owner: page, name: 'framed.png', allowTransient: false, frame: '#not-alone-decision-area', align: 'start' },
    { owner: page, name: 'reconnecting.png', allowTransient: true, frame: null, align: 'center' },
  ]);
  for (const frame of [true, false, '', {}, 1]) {
    await assert.rejects(screenshot(page, 'invalid.png', frame), /Screenshot frame must be a selector or null/);
  }
  assert.equal(calls.length, 3);
});
