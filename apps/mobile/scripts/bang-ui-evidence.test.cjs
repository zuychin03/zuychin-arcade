const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { registerBangText, readBangFontState, validateBangFontState, enlargeBangText, restoreBangText } = require('./bang-ui-evidence.cjs');
const { card, cardActivationTrace, markLifecycleFrame } = require('./bang-ui-smoke.cjs');
const { createEvidence, persistReceipt, MATRIX, CAPTURE_LIMIT, CARD_ART_FAMILY, ART_FAMILIES, publicPrivacy, authorisedCards, verifyCard, verifySeats, LAYOUT_IDS, bundleFence, local, redact, validateFonts, BANG_CONTAINMENT, frameVisibility } = require('./bang-ui-evidence.cjs');
const { classifyContainment, installTextGeometry } = require('./skull-ui-evidence.cjs');
const { chooseTarget, recordBrowserResponse, CAPTURE_PLAN, FIXTURE_CAPTURE_BUDGET, SOURCE_FILES, sourceHashes, verifyFrozenEvidence, completionStatus, assertFrameCoverage, captureFrameEdges, captureLibraryEntry, captureResultDetails, captureLifecycleFrame, assertBrowseUnchanged, proveHandBrowsing, captureHandReadability } = require('./bang-ui-smoke.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'bang-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'bang-ui-smoke.cjs'), 'utf8');

function receiptSandbox(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'bang-receipt-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert(path.basename(directory).startsWith('bang-receipt-test-'));
    assert(!fs.lstatSync(directory).isSymbolicLink());
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      assert.equal(path.dirname(file), directory); assert(fs.lstatSync(file).isFile());
      fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  const receipt = path.join(directory, 'receipt.json'), previous = '{"generation":1}\n';
  fs.writeFileSync(receipt, previous); fs.writeFileSync(path.join(directory, 'existing.png'), 'untouched');
  return { directory, receipt, previous };
}

function isolatedWriter(overrides = {}, runtime = {}, cryptoOverrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(helper, {
    module, __dirname, process: { ...process, platform: runtime.platform ?? process.platform }, URL,
    Atomics: runtime.wait ? { wait: runtime.wait } : Atomics,
    require: name => name === 'node:fs' ? { ...fs, ...overrides }
      : name === 'node:crypto' ? { ...require('node:crypto'), ...cryptoOverrides }
      : name === 'node:perf_hooks' && runtime.now ? { performance: { now: runtime.now } } : require(name),
  }, { filename: 'bang-ui-evidence.cjs' });
  return module.exports.persistReceipt;
}

function assertReceiptUntouched({ directory, receipt, previous }) {
  assert.equal(fs.readFileSync(receipt, 'utf8'), previous);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['existing.png', 'receipt.json']);
  assert.equal(fs.readFileSync(path.join(directory, 'existing.png'), 'utf8'), 'untouched');
}

function retryClock(platform = 'win32') {
  let elapsed = 0;
  const waits = [];
  return { platform, now: () => elapsed, waits, wait(_cell, index, expected, milliseconds) {
    assert.equal(index, 0); assert.equal(expected, 0); assert(milliseconds > 0 && milliseconds <= 25);
    waits.push(milliseconds); elapsed += milliseconds;
  } };
}

test('receipt replacement flushes redacted bytes before atomic rename and uses a fresh exclusive temporary', t => {
  const fixture = receiptSandbox(t), operations = [], temporaries = [];
  let descriptor;
  const writer = isolatedWriter({
    openSync(file, flags, mode) {
      assert.equal(path.dirname(file), fixture.directory); assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      assert.notEqual(file, fixture.receipt); temporaries.push(file); operations.push('open');
      descriptor = fs.openSync(file, flags, mode); return descriptor;
    },
    writeFileSync(fd, bytes, encoding) {
      assert.equal(fd, descriptor); assert(!bytes.includes('private-token')); assert(!bytes.includes('other-secret'));
      operations.push('write'); return fs.writeFileSync(fd, bytes, encoding);
    },
    fsyncSync(fd) { operations.push('flush'); fs.fsyncSync(fd); },
    closeSync(fd) { operations.push('close'); fs.closeSync(fd); },
    renameSync(from, to) {
      assert.equal(fs.readFileSync(to, 'utf8'), fixture.previous);
      assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).generation, 2);
      assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
      operations.push('rename'); fs.renameSync(from, to);
    },
  });
  const value = { generation: 2, diagnostic: 'private-token Bearer other-secret' };
  writer(fixture.directory, 'receipt.json', value, ['private-token']);
  assert.deepEqual(operations, ['open', 'write', 'flush', 'close', 'rename']);
  fixture.previous = fs.readFileSync(fixture.receipt, 'utf8'); assert(fixture.previous.endsWith('\n'));
  writer(fixture.directory, 'receipt.json', value, ['private-token']);
  assert.notEqual(temporaries[0], temporaries[1]); assertReceiptUntouched(fixture);
});

for (const failure of ['writeFileSync', 'fsyncSync', 'closeSync', 'renameSync']) {
  test(`receipt ${failure} failure preserves earlier bytes and removes only its own temporary`, t => {
    const fixture = receiptSandbox(t), expected = new Error(`injected ${failure}`);
    let failed = false;
    const writer = isolatedWriter({ [failure](...args) {
      if (failed) return fs[failure](...args);
      failed = true;
      if (failure === 'writeFileSync') fs.writeSync(args[0], '{"partial":');
      throw expected;
    } });
    assert.throws(() => writer(fixture.directory, 'receipt.json', {}), error => error === expected);
    assertReceiptUntouched(fixture);
  });
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows ${code} rename retries the same flushed temporary`, t => {
    const fixture = receiptSandbox(t), clock = retryClock(), counts = {};
    const overrides = {};
    for (const name of ['openSync', 'writeFileSync', 'fsyncSync', 'closeSync']) overrides[name] = (...args) => {
      counts[name] = (counts[name] ?? 0) + 1; return fs[name](...args);
    };
    let attempts = 0, temporary;
    overrides.renameSync = (from, to) => {
      attempts += 1; assert.equal(fs.readFileSync(to, 'utf8'), fixture.previous);
      if (temporary) assert.equal(from, temporary); else temporary = from;
      if (attempts <= 2) throw Object.assign(new Error('sharing error'), { code });
      fs.renameSync(from, to);
    };
    isolatedWriter(overrides, clock)(fixture.directory, 'receipt.json', { generation: 2 });
    assert.equal(attempts, 3); assert.deepEqual(clock.waits, [25, 25]);
    assert.deepEqual(counts, { openSync: 1, writeFileSync: 1, fsyncSync: 1, closeSync: 1 });
    fixture.previous = '{"generation":2}\n'; assertReceiptUntouched(fixture);
  });
}

test('permanent sharing errors stop at two seconds and preserve the first error', t => {
  const fixture = receiptSandbox(t), clock = retryClock();
  const first = Object.assign(new Error('first'), { code: 'EPERM' });
  let attempts = 0;
  const writer = isolatedWriter({ renameSync() {
    attempts += 1; throw attempts === 1 ? first : Object.assign(new Error('later'), { code: 'EBUSY' });
  } }, clock);
  assert.throws(() => writer(fixture.directory, 'receipt.json', {}), error => error === first);
  assert.equal(clock.now(), 2000); assert.equal(attempts, 80); assertReceiptUntouched(fixture);
});

test('non-sharing rename errors and non-Windows errors are never retried', t => {
  const fixture = receiptSandbox(t);
  for (const [platform, code] of [['win32', 'EIO'], ['win32', 'ENOENT'], ['linux', 'EPERM']]) {
    const clock = retryClock(platform), expected = Object.assign(new Error('fail'), { code });
    let attempts = 0;
    const writer = isolatedWriter({ renameSync() { attempts += 1; throw expected; } }, clock);
    assert.throws(() => writer(fixture.directory, 'receipt.json', {}), error => error === expected);
    assert.equal(attempts, 1); assert.deepEqual(clock.waits, []); assertReceiptUntouched(fixture);
  }
});

test('unsafe paths and target changes during a rename retry fail without touching evidence', t => {
  const fixture = receiptSandbox(t);
  for (const unsafe of [fixture.receipt, fixture.directory, path.dirname(fixture.directory)]) {
    const writer = isolatedWriter({
      lstatSync(file) { return file === unsafe ? { isSymbolicLink: () => true } : fs.lstatSync(file); },
      openSync() { assert.fail('Unsafe output must fail before opening'); },
    });
    assert.throws(() => writer(fixture.directory, 'receipt.json', {}), /Receipt (target|output)/);
  }
  for (const name of ['../escape.json', '/escape.json', 'C:\\escape.json', 'receipt.json:stream', '', '.', 'nested/receipt.json']) {
    assert.throws(() => persistReceipt(fixture.directory, name, {}), /Receipt filename/);
  }
  for (const output of ['', path.parse(fixture.directory).root]) assert.throws(() => persistReceipt(output, 'receipt.json', {}), /Receipt output/);
  const clock = retryClock(); let attempts = 0;
  const writer = isolatedWriter({
    renameSync() { attempts += 1; throw Object.assign(new Error('sharing error'), { code: 'EPERM' }); },
    lstatSync(file) { return file === fixture.receipt && attempts ? { isSymbolicLink: () => true } : fs.lstatSync(file); },
  }, clock);
  assert.throws(() => writer(fixture.directory, 'receipt.json', {}), /Receipt target/);
  assert.equal(attempts, 1); assert.deepEqual(clock.waits, [25]); assertReceiptUntouched(fixture);
});

test('exclusive collision and failed temporary cleanup preserve ownership and the original error', t => {
  const fixture = receiptSandbox(t), id = 'collision';
  const temporary = path.join(fixture.directory, `.receipt-${process.pid}-${id}.tmp`);
  fs.writeFileSync(temporary, 'not owned');
  assert.throws(() => isolatedWriter({}, {}, { randomUUID: () => id })(fixture.directory, 'receipt.json', {}), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'not owned'); fs.unlinkSync(temporary);
  const expected = new Error('flush failed');
  const writer = isolatedWriter({ fsyncSync() { throw expected; }, unlinkSync() { throw new Error('cleanup failed'); } });
  assert.throws(() => writer(fixture.directory, 'receipt.json', {}), error => error === expected);
  const leftovers = fs.readdirSync(fixture.directory).filter(name => name.startsWith('.receipt-'));
  assert.equal(leftovers.length, 1); fs.unlinkSync(path.join(fixture.directory, leftovers[0])); assertReceiptUntouched(fixture);
});

test('main and named smoke receipts use the atomic writer and redact known credentials', t => {
  const fixture = receiptSandbox(t);
  const qa = createEvidence({ outputDir: fixture.directory, base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
  qa.secrets.add('private-token'); qa.evidence.diagnostic = 'private-token'; qa.persist();
  assert(!fs.readFileSync(fixture.receipt, 'utf8').includes('private-token'));
  for (const name of ['summary.json', 'partial-evidence.json', 'cleanup.json', 'failure.txt']) {
    persistReceipt(fixture.directory, name, { diagnostic: 'private-token' }, qa.secrets);
    assert(!fs.readFileSync(path.join(fixture.directory, name), 'utf8').includes('private-token'));
  }
  assert.match(driver, /const writeReceipt = \(name, value\) => persistReceipt\(outputDir, name, value, qa\?\.secrets \?\? \[\]\)/);
});

function browserResponse(pathname, { method = 'POST', status = 200, origin = 'http://127.0.0.1:3213', json } = {}) {
  return { url: () => origin + pathname, request: () => ({ method: () => method }),
    status: () => status, ok: () => status >= 200 && status < 300, json };
}

function responseRecorder() {
  return { origins: new Set(['http://127.0.0.1:3213']), secrets: new Set(), evidence: { cleanup: [] },
    persisted: 0, persist() { this.persisted += 1; } };
}

test('response observer ignores OPTIONS, GET, failed authentication, non-exact paths and off-origin responses', async () => {
  const actor = { name: 'Astra', auth: {} }, auth = actor.auth, qa = responseRecorder(), issues = [];
  let reads = 0;
  const json = async () => { reads += 1; throw new Error('No body'); };
  for (const [pathname, options] of [
    ['/rooms/create', { method: 'OPTIONS', status: 204 }], ['/rooms/join', { method: 'OPTIONS', status: 204 }],
    ['/rooms/create', { method: 'GET' }], ['/rooms/join', { method: 'GET' }],
    ['/rooms/create', { status: 400 }], ['/rooms/join', { status: 403 }],
    ['/other/rooms/create', {}], ['/rooms/join/other', {}], ['/rooms', {}],
    ['/rooms/create', { origin: 'https://example.com' }],
    ['/rooms/ABCD/leave', { method: 'OPTIONS', status: 204 }], ['/rooms/ABCD/leave', { method: 'GET' }],
    ['/rooms/ABCD/leave', { origin: 'https://example.com' }], ['/other/rooms/ABCD/leave', {}],
  ]) await recordBrowserResponse(browserResponse(pathname, { ...options, json }), actor, qa, issues);
  assert.equal(reads, 0); assert.equal(actor.auth, auth); assert.equal(qa.secrets.size, 0);
  assert.deepEqual(qa.evidence.cleanup, []); assert.deepEqual(issues, []); assert.equal(qa.persisted, 0);
});

test('response observer records successful POST credentials and retains redacted JSON errors and POST leave status', async () => {
  const actor = { name: 'Astra' }, qa = responseRecorder(), issues = [];
  for (const [pathname, status, wrapped] of [['/rooms/create', 201, true], ['/rooms/join', 200, false]]) {
    const auth = { token: 'synthetic-secret', playerId: 'p1', roomCode: 'ABCD' };
    await recordBrowserResponse(browserResponse(pathname, { status, json: async () => wrapped ? { auth } : auth }), actor, qa, issues);
    assert.equal(actor.auth, auth); assert(qa.secrets.has(auth.token));
    await recordBrowserResponse(browserResponse(pathname, { json: async () => { throw new Error('Malformed synthetic-secret JSON'); } }), actor, qa, issues);
  }
  assert.equal(issues.length, 2); assert.equal(qa.evidence.responseIssues.length, 2);
  assert(issues.every(issue => issue.type === 'response-observer' && !issue.text.includes('synthetic-secret')));
  for (const status of [200, 500]) {
    actor.fallbackCleanup = status !== 200;
    await recordBrowserResponse(browserResponse('/rooms/ABCD/leave', { status, json: async () => assert.fail('Leave body must not be read') }), actor, qa, issues);
  }
  assert.deepEqual(qa.evidence.cleanup, [{ actor: 'Astra', status: 200, normalUI: true }, { actor: 'Astra', status: 500, normalUI: false }]);
  assert.equal(qa.persisted, 4);
});

test('all 22 printed identities map to the exact seven prepared art families', () => {
  const families = {
    attack: ['bang', 'gatling', 'indians', 'duel'], response: ['missed'], recovery: ['beer', 'saloon'],
    supply: ['stagecoach', 'wells_fargo', 'general_store'], interference: ['panic', 'cat_balou'],
    equipment: ['barrel', 'dynamite', 'scope', 'mustang', 'jail'],
    weapon: ['volcanic', 'schofield', 'remington', 'rev_carabine', 'winchester'],
  };
  assert.deepEqual(ART_FAMILIES, Object.keys(families));
  assert.deepEqual(CARD_ART_FAMILY, Object.fromEntries(Object.entries(families).flatMap(([family, cards]) => cards.map(card => [card, family]))));
  assert.equal(Object.keys(CARD_ART_FAMILY).length, 22);
  for (const family of ART_FAMILIES) assert(fs.existsSync(path.join(__dirname, '../assets/game-art/bang-card-' + family + '.webp')));
});

test('Calamity effective BANG does not change printed Missed artwork, rank or suit', () => {
  const printed = { id: 'card-1', name: 'missed', rank: 'Q', suit: 'hearts', effectiveName: 'bang' };
  const rendered = { label: 'Missed!, Q of hearts. Response.', sources: ['/response.webp'] };
  verifyCard(rendered, printed, [{ source: '/response.webp', artwork: 'bang-card-response' }]);
  assert.throws(() => verifyCard(rendered, printed, [{ source: '/response.webp', artwork: 'bang-card-attack' }]));
  assert.throws(() => verifyCard({ ...rendered, label: 'Missed!, Q of clubs.' }, printed, []));
  assert.match(helper, /assert.equal\(servedHash, diskHash/);
});

test('visible card authority comes only from this actor private frame or public cards', () => {
  const card = id => ({ id, name: 'beer', rank: '6', suit: 'hearts' });
  const actor = { private: { hand: [card('own')], drawChoice: { options: [card('draw')] }, discardOrderCards: [card('order')] }, public: { players: [{ handCount: 9, equipment: [card('equipment')] }], pending: { storeCards: [card('store')] }, drawCheck: { cards: [card('check')] }, discardTop: card('discard') } };
  assert.deepEqual(authorisedCards(actor).map(item => item.id), ['own', 'draw', 'order', 'store', 'check', 'equipment', 'discard']);
  assert.match(helper, /matches.length, 1/);
  assert.doesNotMatch(driver, /initialState: actors.map/);
});

test('hidden living roles and private choices cannot appear in public projections or role metadata', () => {
  const state = { status: 'playing', players: [{ playerId: 'a', alive: true, role: 'sheriff' }, { playerId: 'b', alive: true, role: null }, { playerId: 'c', alive: false, role: 'outlaw' }] };
  assert.deepEqual(publicPrivacy(state), []);
  const seat = { id: 'bang-seat-b', roleText: 'Hidden role', roleLabels: ['Unknown role back'] };
  verifySeats([seat], state);
  assert.throws(() => verifySeats([{ ...seat, roleLabels: ['Hidden outlaw role'] }], state));
  assert.deepEqual(publicPrivacy({ ...state, players: [{ alive: true, role: 'deputy', hand: [] }] }), ['public-hand', 'concealed-role']);
  assert.deepEqual(publicPrivacy({ status: 'game_over', players: [{ alive: true, role: 'deputy' }], drawChoice: { options: [] }, discardOrder: { cards: [] } }), ['private-draw-options', 'private-discard-order']);
  assert.match(helper, /post.rolePrivacyGaps/);
});

test('target policy uses acting role and public information without opponent private reads', () => {
  const actor = { private: { playerId: 'me', role: 'outlaw' }, public: { players: [{ playerId: 's', role: 'sheriff' }, { playerId: 'u', role: null }] } };
  const options = [{ playerId: 'u' }, { playerId: 's' }];
  assert.equal(chooseTarget(actor, options).playerId, 's');
  actor.private.role = 'deputy'; assert.equal(chooseTarget(actor, options).playerId, 'u');
  assert.match(driver, /step % 3 !== 0/);
  assert.match(driver, /Scripted Sheriff-forfeit|scripted Sheriff-forfeit/);
  assert.match(driver, /no natural full match claim in this run/);
});

test('exact bundle, ordinary API and fixture service guards run before browser or fixture mutation', async () => {
  assert.throws(() => local('https://localhost.example.com'));
  assert.throws(() => local('http://user:secret@localhost'));
  await assert.rejects(bundleFence('https://example.com', '.', 'a'.repeat(64)));
  await assert.rejects(bundleFence('http://localhost:8081', '.', 'invalid'));
  await assert.rejects(bundleFence('http://localhost:8081', '', 'a'.repeat(64)));
  assert.match(driver, /BANG_UI_EXCLUSIVE_WINDOW === 'granted'/);
  assert.match(driver, /FIXTURES \? 'bang-local-ui-fixtures' : 'zuychin-arcade-server'/);
  assert.match(driver, /assert\(FIXTURES && qa.evidence.service === 'bang-local-ui-fixtures'/);
  assert(driver.indexOf('qa.evidence.bundle = await bundleFence') < driver.indexOf('browser = await puppeteer.launch'));
  assert.match(driver, /await guardNetwork\(page, qa.origins/);
});

test('redacted receipts preserve diagnostics without overwriting earlier runs', () => {
  const value = redact({ revision: 19, message: 'frontier Bearer secret eyJheader.payload.signature' }, ['frontier']);
  assert.match(value, /19/);
  for (const secret of ['frontier', 'Bearer secret', 'eyJheader.payload.signature']) assert(!value.includes(secret));
  assert.match(driver, /Choose a new output directory/);
  assert.match(driver, /if \(ownsOutput\) writeReceipt\('failure.txt'/);
  assert.match(driver, /qa.secrets.add\(auth.token\)/);
});

test('persistent CSS200 requires same connected nodes and unchanged font families after capture', () => {
  const sample = { before: 14, after: 28, family: 'Outfit', afterFamily: 'Outfit', connected: true };
  validateFonts([sample]);
  for (const change of [{ connected: false }, { after: 14 }, { afterFamily: 'fallback' }]) assert.throws(() => validateFonts([{ ...sample, ...change }]));
  assert.throws(() => validateFonts([]));
  assert(helper.indexOf('await ready(page, allowTransient)') < helper.indexOf('attempt.baseline = await enlargeBangText(page)'));
  assert(helper.indexOf('await page.screenshot({ path: path.join(outputDir, file)') < helper.indexOf('const post = await page.evaluate(geometry'));
  assert(helper.indexOf('evidence.captures.push(record); persist()') < helper.indexOf('validateFonts(post.fonts)'));
  assert.match(helper, /attempt.failureFonts = await page.evaluate\(fontSamples\)/);
  assert.match(helper, /actor.private\?\.playerId === auth.playerId/);
  assert.match(helper, /Synchronising your hand/);
});

test('glyph calibration exempts only proven matching whitespace, not real or unexplained overflow', () => {
  const context = { window: {} }; vm.runInNewContext(`(${installTextGeometry})();`, context);
  const rect = { left: 0, right: 40, top: 0, bottom: 20 }, bounds = { left: 0, right: 20, top: 0, bottom: 20 };
  const measured = { rawRects: [rect], glyphRects: [], characters: [{ whitespace: true, character: ' ', rects: [rect] }] };
  const proof = () => context.window.__coupQAOverflowProof([measured], bounds);
  assert.equal(proof().classification, 'proven-whitespace-only');
  measured.glyphRects = [{ ...rect, character: 'Q' }]; assert.equal(proof().classification, 'non-whitespace-overflow');
  measured.glyphRects = []; measured.characters[0].rects = [{ ...rect, left: 10 }]; assert.equal(proof().classification, 'unexplained-range-overflow');
  assert.match(helper, /evidence.calibration\?\.passed && c.proof.classification === 'proven-whitespace-only'/);
  assert.match(helper, /rawRangeDiagnostics.push/);
});

test('short-card child escape and decision sibling intrusion are detected without misclassifying rails', () => {
  const content = { kind: 'control', label: 'TARGET', bounds: { left: 100, right: 240, top: 90, bottom: 150 } };
  const measurement = { viewport: { left: 0, right: 375, top: 0, bottom: 844 }, cards: [{ id: 'bang-card-hand-a', kind: 'card', bounds: { left: 16, right: 180, top: 20, bottom: 120 }, content: [content], siblings: [{ id: 'table', bounds: { left: 200, right: 360, top: 20, bottom: 500 } }] }] };
  assert.deepEqual(classifyContainment(measurement).map(f => f.kind), ['content-outside-boundary', 'content-overlaps-sibling']);
  measurement.cards[0].kind = 'decision'; assert.equal(classifyContainment(measurement).length, 2);
  content.visibleBounds = { left: 20, right: 170, top: 20, bottom: 115 }; assert.deepEqual(classifyContainment(measurement), []);
  delete content.visibleBounds; content.bounds = { left: 30, right: 150, top: 30, bottom: 90 }; assert.deepEqual(classifyContainment(measurement), []);
  assert.match(helper, /await calibrateContainment/);
  assert.equal(BANG_CONTAINMENT.decisionId, 'bang-decision-area');
  assert.deepEqual(BANG_CONTAINMENT.siblingIds, ['bang-public-table']);
});

test('fixed input contexts capture phone desktop short-landscape rails inline results and actual targets', () => {
  assert.deepEqual(MATRIX.map(([width]) => width), [320, 375, 414, 768, 1280, 844]);
  assert(MATRIX.some(([, height]) => height === 390));
  assert.match(driver, /setViewport\(\{ \.\.\.page.viewport\(\), width, height/);
  assert.match(driver, /hasTouch\) await control.tap\(\)/);
  assert.match(driver, /bounds.width >= 48 && bounds.height >= 48/);
  assert.match(helper, /c.width < 48 \|\| c.height < 48/);
  assert.match(driver, /for \(const width of \[375, 1280\]\)/);
  assert.match(driver, /await railEnds\(active\)/);
  assert.match(driver, /Inline BANG results panel is missing/);
  assert(LAYOUT_IDS.includes('bang-results'));
  assert.match(helper, /png.readUInt32BE\(16\)/);
  assert.doesNotMatch(driver + helper, /fullPage: true|deviceScaleFactor: 2/);
});

test('bounded cleanup records real UI acknowledgement separately from fallback and closes partial contexts', () => {
  assert.match(driver, /30 \* 60_000/);
  assert.match(helper, /evidence.attempts.length < CAPTURE_LIMIT/);
  assert.match(driver, /for \(const actor of actors\) await normalExit\(actor\)/);
  assert.match(driver, /Normal exit requires a successful leave receipt/);
  assert.match(driver, /for \(const actor of qa.actors.values\(\)\)/);
  assert.match(driver, /normalUI: !actor.fallbackCleanup/);
  assert.match(driver, /normalUI: false, fallback: true/);
  assert.match(driver, /normal && authReadSucceeded && !currentAuth/);
  assert.match(driver, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.match(driver, /rareBranchGaps/);
});

test('capture plan reserves complete frames and rejects the 181st attempt before browser work', async () => {
  assert.equal(Object.values(CAPTURE_PLAN).reduce((sum, count) => sum + count, 0), 147);
  assert.equal(FIXTURE_CAPTURE_BUDGET, 25); assert.equal(CAPTURE_LIMIT, 180);
  assert(147 + FIXTURE_CAPTURE_BUDGET <= CAPTURE_LIMIT);
  const qa = createEvidence({ outputDir: 'unused-bang-budget', base: 'http://127.0.0.1:8081', api: 'http://127.0.0.1:3213' });
  qa.evidence.attempts.length = CAPTURE_LIMIT;
  await assert.rejects(qa.capture(null, 'unwritten.png'), /Bounded capture budget/);
  assert.equal(qa.evidence.captures.length, 0); assert.equal(qa.evidence.attempts.length, CAPTURE_LIMIT);
});

test('source fence hashes the exact BANG UI, shared consumers, harness and artwork without credential files', () => {
  const actual = sourceHashes();
  assert.equal(new Set(SOURCE_FILES).size, SOURCE_FILES.length);
  assert.deepEqual(Object.keys(actual), SOURCE_FILES); assert(Object.values(actual).every(hash => /^[a-f0-9]{64}$/.test(hash)));
  for (const file of ['apps/mobile/components/bang/CardArtwork.tsx', 'apps/mobile/components/bang/Hand.tsx', 'apps/mobile/scripts/bang-hand.test.cjs', 'apps/mobile/components/bang/layout.ts', 'apps/mobile/scripts/bang-material.test.cjs', 'apps/mobile/app/(arcade)/index.tsx', 'apps/mobile/components/ui/GameTile.tsx', 'apps/mobile/scripts/bang-ui-smoke.cjs']) assert(SOURCE_FILES.includes(file));
  assert(SOURCE_FILES.every(file => !/\.env|certificate|private-key|receipt\.json/.test(file)));
  const first = sourceHashes(() => 'same'), second = sourceHashes(file => file === SOURCE_FILES[0] ? 'changed' : 'same');
  assert.notEqual(first[SOURCE_FILES[0]], second[SOURCE_FILES[0]]);
  assert.equal(first[SOURCE_FILES[1]], second[SOURCE_FILES[1]]);
});

test('all successful modes verify final source, served bundle and disk identity and retain failed comparisons', async () => {
  const hashes = { file: 'a' }, bundle = { servedHash: 'b', diskHash: 'b' }, build = { entry: 'entry-a.js' };
  const run = async changes => {
    const qa = { evidence: { sourceHashes: hashes, bundle }, persisted: 0, persist() { this.persisted += 1; } };
    const checks = { sourceHashes: () => hashes, bundleFence: async () => bundle, bundleEvidence: () => build, ...changes };
    await verifyFrozenEvidence(qa, build, checks); return qa;
  };
  assert.equal((await run()).evidence.freezeVerified, true);
  await assert.rejects(run({ sourceHashes: () => ({ file: 'changed' }) }), /Source or artwork changed/);
  await assert.rejects(run({ bundleFence: async () => ({ ...bundle, servedHash: 'changed' }) }), /Served or disk bundle changed/);
  await assert.rejects(run({ bundleEvidence: () => ({ entry: 'entry-b.js' }) }), /Bundle changed/);
  const failed = { evidence: { sourceHashes: hashes, bundle }, persist() {} };
  await assert.rejects(verifyFrozenEvidence(failed, build, { sourceHashes: () => ({ file: 'changed' }) }), /Source or artwork changed/);
  assert.deepEqual(failed.evidence.finalSourceHashes, { file: 'changed' }); assert(!failed.evidence.freezeVerified);
  const main = driver.slice(driver.indexOf('async function main()'));
  assert(main.indexOf('qa.evidence.sourceHashes = sourceHashes()') < main.indexOf('const health = await fetch'));
  assert.equal((main.match(/await verifyFrozenEvidence\(qa, exportedBuild\)/g) ?? []).length, 2);
  assert.match(main, /qa.evidence.failure = redact\(error.stack/);
});

function framedRecord({ top = 0, height = 100, left = 0, width = 300, viewportWidth = 375, viewportHeight = 844 } = {}) {
  return { metrics: { width: viewportWidth, height: viewportHeight, frame: { top, bottom: top + height, left, right: left + width, height, width } } };
}

test('framed evidence requires complete readable intervals, stable height and horizontal containment', () => {
  assertFrameCoverage([framedRecord()]);
  assertFrameCoverage([framedRecord({ height: 1000 }), framedRecord({ top: -156, height: 1000 })]);
  assert.throws(() => assertFrameCoverage([framedRecord({ height: 2000 }), framedRecord({ top: -1156, height: 2000 })]), /unreadable content/);
  assert.throws(() => assertFrameCoverage([framedRecord({ top: -20 })]), /unreadable content/);
  assert.throws(() => assertFrameCoverage([framedRecord({ height: 1000 })]), /miss the end/);
  assert.throws(() => assertFrameCoverage([framedRecord({ width: 500 })]), /viewport width/);
  assert.throws(() => assertFrameCoverage([framedRecord(), framedRecord({ height: 110 })]), /changed height/);
  assert.throws(() => assertFrameCoverage([]), /missing/);
});

test('start and end frames retain both CSS100 and CSS200 full-card content', async () => {
  const page = {}, calls = [];
  await captureFrameEdges({ page }, 'card', '#bang-card-hand-own', { capture: async (...args) => { calls.push(args); return framedRecord(); } });
  assert.deepEqual(calls.map(([owner, name, options]) => ({ owner, name, ...options })), [
    { owner: page, name: 'card-text100-start.png', frame: '#bang-card-hand-own', align: 'start', scale: false },
    { owner: page, name: 'card-text100-end.png', frame: '#bang-card-hand-own', align: 'end', scale: false },
    { owner: page, name: 'card-text200-start.png', frame: '#bang-card-hand-own', align: 'start', scale: true },
    { owner: page, name: 'card-text200-end.png', frame: '#bang-card-hand-own', align: 'end', scale: true },
  ]);
  assert.doesNotMatch(driver, /two_card_hand_at320|hand did not fit two cards per row/);
  assert.match(driver, /full_card_readability_at320_text200/);
  assert.match(helper, /viewport: page.viewport\(\), frame, align, allowTransient/);
});

function actorPage(hasTouch) {
  let viewport = { width: hasTouch ? 390 : 1280, height: 844, deviceScaleFactor: 1, isMobile: hasTouch, hasTouch };
  let url = 'http://127.0.0.1:8081/bang';
  const events = [];
  const tile = { evaluate: async () => {}, boundingBox: async () => ({ width: 300, height: 400 }),
    tap: async () => { events.push('tap'); url = 'http://127.0.0.1:8081/bang'; },
    focus: async () => events.push('focus'), dispose: async () => {} };
  const page = { viewport: () => viewport, setViewport: async value => { viewport = value; },
    goto: async value => { events.push('goto'); url = value; }, url: () => url,
    $: async () => tile, keyboard: { press: async value => { events.push(value); url = 'http://127.0.0.1:8081/bang'; } } };
  return { page, events, public: { status: 'game_over', players: Array.from({ length: 4 }, (_, index) => ({ playerId: 'p' + index })) } };
}

test('library captures 375 touch and 1280 fine-pointer CSS200 before tap and keyboard entrance', async () => {
  for (const [touch, width, expected] of [[true, 375, ['goto', 'tap']], [false, 1280, ['goto', 'focus', 'Enter']]]) {
    const actor = actorPage(touch), original = actor.page.viewport(), calls = [];
    await captureLibraryEntry(actor, width, { capture: async (page, name, options) => {
      calls.push({ viewport: page.viewport(), name, ...options }); return framedRecord({ viewportWidth: width });
    } });
    assert.equal(calls.length, 4); assert.equal(calls.filter(call => call.scale).length, 2);
    assert(calls.every(call => call.frame === '#game-tile-bang' && call.viewport.hasTouch === touch && call.viewport.width === width));
    assert.deepEqual(actor.events, expected); assert.equal(actor.page.viewport(), original);
  }
});

test('results capture both summaries and every one of four seat rows at both text sizes and pointer contexts', async () => {
  const actors = [actorPage(true), actorPage(false)], originals = actors.map(actor => actor.page.viewport()), calls = [];
  await captureResultDetails(actors, { capture: async (page, name, options) => {
    calls.push({ page, name, viewport: page.viewport(), ...options }); return framedRecord({ viewportWidth: page.viewport().width });
  } });
  assert.equal(calls.length, 24);
  for (const [index, width] of [375, 1280].entries()) {
    const own = calls.filter(call => call.page === actors[index].page);
    assert.equal(own.length, 12); assert(own.every(call => call.viewport.width === width));
    assert.equal(own.filter(call => call.frame === '#bang-result-summary').length, 4);
    for (const player of actors[index].public.players) assert.deepEqual(own.filter(call => call.frame === `[id="bang-result-row-${player.playerId}"]`).map(call => call.scale), [false, true]);
    assert.equal(actors[index].page.viewport(), originals[index]);
  }
  actors[0].public.players.pop();
  await assert.rejects(captureResultDetails(actors), /all four seats/);
});

test('final acceptance requires clean findings, role metadata, network, frozen source and complete normal cleanup', () => {
  const names = ['host', 'lyra', 'noor', 'echo'];
  const good = { browserClosed: true, freezeVerified: true, captures: [{ metrics: { rolePrivacyGaps: [] } }],
    findings: [], blockedRequests: [], finalIssues: [], responseIssues: [],
    cleanup: names.flatMap(actor => [{ actor, normalUI: true, status: 200, authCleared: true }, { actor, contextClosed: true }]) };
  assert.equal(completionStatus(good, names).passed, true);
  for (const change of [
    { findings: [{ kind: 'visible-text-clipping' }] }, { blockedRequests: [{}] }, { finalIssues: [{}] }, { responseIssues: [{}] },
    { captures: [{ metrics: { rolePrivacyGaps: ['bang-seat-unknown'] } }] }, { freezeVerified: false }, { failure: 'failed' },
    { browserClosed: false }, { watchdogExpired: true }, { cleanup: good.cleanup.slice(1) },
    { cleanup: [...good.cleanup, { actor: 'host', fallback: true }] },
    { cleanup: good.cleanup.map(record => ({ ...record, authCleared: false })) },
  ]) assert.equal(completionStatus({ ...good, ...change }, names).passed, false);
  assert.equal(completionStatus(good, names.slice(1)).passed, false);
});

test('frame coverage rejects sticky-header footer and ancestor clipping hidden by viewport-only maths', () => {
  const record = framedRecord({ top: 0, height: 100 });
  record.metrics.frameVisibleBounds = { left: 0, right: 375, top: 60, bottom: 800 };
  assert.throws(() => assertFrameCoverage([record]), /unreadable content/);
  record.metrics.frame.top = 60; record.metrics.frame.height = 760;
  assert.throws(() => assertFrameCoverage([record]), /miss the end/);
  record.metrics.frame.height = 100; record.metrics.frameVisibleBounds.right = 200;
  assert.throws(() => assertFrameCoverage([record]), /clipping container/);
});

test('frame visibility intersects scroll clips and persistent top/bottom chrome', () => {
  const make = (bounds, css, parentElement = null) => ({ getBoundingClientRect: () => bounds, css, parentElement, contains: () => false });
  const owner = make({ left: 10, right: 360, top: 40, bottom: 830 }, { overflowX: 'hidden', overflowY: 'scroll' });
  const node = make({ left: 20, right: 300, top: 0, bottom: 100 }, {}, owner);
  const top = make({ left: 0, right: 375, top: 0, bottom: 60, height: 60 }, { position: 'sticky', visibility: 'visible' });
  const bottom = make({ left: 0, right: 375, top: 790, bottom: 844, height: 54 }, { position: 'fixed', visibility: 'visible' });
  const context = { node, innerWidth: 375, innerHeight: 844, getComputedStyle: n => n.css, document: { querySelectorAll: () => [top, bottom] } };
  const result = vm.runInNewContext(`(${frameVisibility})(node)`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { left: 10, right: 360, top: 60, bottom: 790 });
  assert.match(helper, /post.frameVisibleBounds = frame/);
  assert.match(helper, /scrollMarginTop = options.top/);
});

function fontDom() {
  let sheet = null, render = () => {};
  const nodes = [], all = [];
  const make = (text, options = {}) => {
    const attributes = new Map(options.previous ? [['data-skull-qa-text', options.previous]] : []);
    const node = { isConnected: true, textContent: text, childNodes: options.input ? [] : [{ nodeType: 3, textContent: text }], base: options.base ?? 16, family: options.family ?? 'Outfit', type: options.input ? 'password' : undefined, value: options.input ? 'secret-never-log' : undefined,
      inherit: options.inherit, getBoundingClientRect: () => ({ width: options.zero ? 0 : 250, height: 50 }), closest: () => options.hidden ? {} : null,
      matches: () => Boolean(options.input), getAttribute: name => name === 'aria-label' && options.input ? 'Room password, optional' : attributes.get(name) ?? null,
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key), attributes };
    nodes.push(node); all.push(node); return node;
  };
  const computed = node => {
    const rule = sheet && !sheet.disabled && node.getAttribute('data-skull-qa-text') !== null
      ? sheet.textContent.match(new RegExp('data-skull-qa-text="' + node.getAttribute('data-skull-qa-text') + '"\\]\\{[^}]*font-size:([0-9.]+)px')) : null;
    return { fontSize: (rule ? Number(rule[1]) : node.inherit ? parseFloat(computed(node.inherit).fontSize) : node.base) + 'px', lineHeight: '24px', fontFamily: node.family, visibility: 'visible' };
  };
  const context = vm.createContext({ window: {}, Node: { TEXT_NODE: 3 }, getComputedStyle: computed, requestAnimationFrame: callback => callback(),
    document: { fonts: { ready: Promise.resolve() }, querySelectorAll: () => nodes.filter(node => node.isConnected), getElementById: () => sheet,
      createElement: () => ({ textContent: '', disabled: false, remove() { sheet = null; } }), head: { appendChild: node => { sheet = node; } } } });
  const page = { evaluate: async (fn, arg) => { context.argument = arg; const result = await vm.runInContext(`(${fn})(argument)`, context); if (fn.toString().includes('requestAnimationFrame')) render(); return result; } };
  return { page, context, make, all, computed, setRender: fn => { render = fn; }, sheet: () => sheet };
}

test('BANG CSS200 converges after grid replacement and new toolbar using authentic unscaled baselines', async () => {
  const dom = fontDom(), stable = dom.make('Stable heading', { base: 18 }), old = dom.make('Old grid card', { previous: 'original' });
  const input = dom.make('', { input: true }); dom.make('hidden', { zero: true }); dom.make('glyph', { family: 'MaterialIcons' });
  let replacement, toolbar;
  dom.setRender(() => {
    if (!replacement && dom.sheet() && dom.computed(old).fontSize === '32px') {
      old.isConnected = false;
      replacement = dom.make('Replacement rail card', { inherit: stable });
      toolbar = dom.make('Card 1 of 4', { base: 14 });
    }
  });
  const baseline = await enlargeBangText(dom.page), state = await dom.page.evaluate(readBangFontState);
  validateBangFontState(state);
  assert.equal(baseline.detachedHistory.length, 1); assert.equal(baseline.detachedHistory[0].text, 'Old grid card');
  assert.equal(baseline.samples.find(sample => sample.text === 'Replacement rail card').before, 18);
  assert.equal(dom.computed(replacement).fontSize, '36px'); assert.equal(dom.computed(toolbar).fontSize, '28px');
  assert.equal(dom.computed(stable).fontSize, '36px'); assert.equal(dom.computed(input).fontSize, '32px');
  assert.equal(state.eligibleCount, 4); assert(!JSON.stringify(baseline).includes(input.value));
  assert.equal(await dom.page.evaluate(registerBangText, 9), 0); assert.equal(dom.computed(stable).fontSize, '36px');
  await restoreBangText(dom.page);
  assert.equal(dom.sheet(), null); assert.equal(dom.context.window.__skullText.length, 0); assert.equal(dom.context.window.__bangFontSnapshot, undefined);
  assert.equal(old.getAttribute('data-skull-qa-text'), 'original');
  assert(dom.all.filter(node => node !== old).every(node => node.getAttribute('data-skull-qa-text') === null));
});

test('post-convergence missing replacement and detached nodes fail rather than being ignored', async () => {
  const dom = fontDom(), old = dom.make('Current card');
  await enlargeBangText(dom.page);
  old.isConnected = false; dom.make('New unscaled card');
  const changed = await dom.page.evaluate(readBangFontState);
  assert.equal(changed.missing.length, 1); assert(changed.changedAfterConvergence > 0);
  assert.throws(() => validateBangFontState(changed), /missing its authentic/);
  await dom.page.evaluate(registerBangText, 10);
  assert.throws(() => validateBangFontState(awaitableState(dom)), /Mounted text changed/);
  await restoreBangText(dom.page);
});

function awaitableState(dom) { return vm.runInContext(`(${readBangFontState})()`, dom.context); }

test('repeated responsive replacements converge but endless remounts stop after eight passes and restore', async () => {
  for (const limit of [2, Infinity]) {
    const dom = fontDom(); let current = dom.make('Card 0'), replacements = 0;
    dom.setRender(() => {
      if (dom.sheet() && current.getAttribute('data-skull-qa-text') !== null && replacements < limit) {
        current.isConnected = false; current = dom.make('Card ' + (++replacements));
      }
    });
    if (limit === 2) { const baseline = await enlargeBangText(dom.page); assert.equal(baseline.detachedHistory.length, 2); validateBangFontState(await dom.page.evaluate(readBangFontState)); }
    else { await assert.rejects(enlargeBangText(dom.page), /eight bounded passes/); assert.equal(replacements, 8); }
    await restoreBangText(dom.page); assert.equal(dom.sheet(), null); assert(dom.all.every(node => node.getAttribute('data-skull-qa-text') === null));
  }
});

test('strict font state validates current coverage count family doubling and mounted identity', () => {
  const good = { fonts: [{ text: 'Card', before: 16, after: 32, family: 'Outfit', afterFamily: 'Outfit', connected: true }], missing: [], eligibleCount: 1, changedAfterConvergence: 0, detachedHistory: [{ text: 'Old card', before: 16, family: 'Outfit' }] };
  validateBangFontState(good);
  for (const change of [{ eligibleCount: 2 }, { changedAfterConvergence: 1 }, { missing: ['new toolbar'] }, { fonts: [{ ...good.fonts[0], after: 16 }] }, { fonts: [{ ...good.fonts[0], afterFamily: 'fallback' }] }, { fonts: [{ ...good.fonts[0], connected: false }] }]) assert.throws(() => validateBangFontState({ ...good, ...change }));
  assert.match(helper, /post.textScaleState = await page.evaluate\(readBangFontState\)/);
  assert.match(helper, /validateBangFontState\(post.textScaleState\)/);
});

test('lifecycle form and action frames keep touch375 and restore their original viewport', async () => {
  const actor = actorPage(true), original = actor.page.viewport(), calls = [];
  actor.page.evaluate = async () => {};
  const recorder = { capture: async (page, name, options) => { calls.push({ width: page.viewport().width, ...options, name }); return framedRecord(); } };
  await captureLifecycleFrame(actor, 'entrance-form', 'CREATE ROOM', true, recorder);
  assert.equal(calls.length, 4); assert.deepEqual(calls.map(call => call.scale), [false, false, true, true]);
  assert(calls.every(call => call.width === 375)); assert.equal(actor.page.viewport(), original);
  calls.length = 0;
  await captureLifecycleFrame(actor, 'lobby-start', 'START GAME', false, recorder);
  assert.equal(calls.length, 2); assert(calls.every(call => call.scale));
  assert.match(driver, /captureSection\(desktop, 'Around the table', '06-all-seats-desktop-pointer-1280.png'\)/);
  assert.doesNotMatch(driver, /captureSection\(active, 'Around the table', '06-all-seats-1280.png'\)/);
});

test('desktop lifecycle frames use the fine-pointer owner and reject resized touch substitutes', async () => {
  const actor = actorPage(false), original = actor.page.viewport(), calls = [];
  actor.page.evaluate = async () => {};
  const recorder = { capture: async (page, name, options) => { calls.push({ viewport: page.viewport(), name, ...options }); return framedRecord({ viewportWidth: 1280 }); } };
  await captureLifecycleFrame(actor, 'entrance-desktop', 'CREATE ROOM', true, recorder, 1280);
  assert.equal(calls.length, 4); assert(calls.every(call => call.viewport.width === 1280 && !call.viewport.hasTouch && call.name.includes('1280')));
  calls.length = 0;
  await captureLifecycleFrame(actor, 'lobby-desktop', 'LEAVE ROOM', false, recorder, 1280);
  assert.equal(calls.length, 2); assert(calls.every(call => call.scale)); assert.equal(actor.page.viewport(), original);
  const touch = actorPage(true); touch.page.evaluate = async () => {};
  await assert.rejects(captureLifecycleFrame(touch, 'wrong-context', 'CREATE ROOM', true, recorder, 1280), /input context/);
  await assert.rejects(captureLifecycleFrame(actor, 'wrong-context', 'CREATE ROOM', true, recorder, 375), /input context/);
  assert.match(driver, /captureLifecycleFrame\(actors\[3\], 'entrance-form-desktop-pointer'/);
  assert.match(driver, /actor === actors\[3\].*captureLifecycleFrame\(actor, 'join-form-desktop-pointer'/);
  assert.match(driver, /captureLifecycleFrame\(actors\[3\], 'lobby-action-desktop-pointer-'/);
});

test('lifecycle matcher rejects retained hidden duplicates, accepts offscreen live control, and fails ambiguity', () => {
  const make = changes => ({ isConnected: true, parentElement: null, css: { display: 'flex', visibility: 'visible', opacity: '1' },
    getBoundingClientRect: () => ({ width: 300, height: 48, top: 2000, bottom: 2048 }), closest: () => null,
    getAttribute: () => 'HOW TO PLAY', setAttribute(key, value) { this.marked = [key, value]; }, ...changes });
  const zero = make({ getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const ariaHidden = make({ closest: () => ({}) });
  const ancestor = make({ css: { display: 'none', visibility: 'visible', opacity: '1' } });
  const hiddenAncestor = make({ parentElement: ancestor }), live = make();
  const nodes = [zero, ariaHidden, hiddenAncestor, live];
  const context = vm.createContext({ document: { body: {}, querySelectorAll: () => nodes }, getComputedStyle: node => node.css });
  const run = () => vm.runInContext(`(${markLifecycleFrame})({label:'HOW TO PLAY',form:false})`, context);
  run(); assert.deepEqual(live.marked, ['data-bang-qa-lifecycle', 'frame']);
  assert(nodes.slice(0, 3).every(node => !node.marked));
  delete live.marked; nodes.push(make());
  assert.throws(run, /found 2/); assert(nodes.every(node => !node.marked));
  nodes.splice(3); assert.throws(run, /found 0/);
  const disconnected = make({ isConnected: false }); nodes.push(disconnected); assert.throws(run, /found 0/);
});

test('browsing invariant detects commands revisions selected state and label changes', () => {
  const actor = { public: { revision: 4 }, private: { revision: 4 }, sent: [], accepted: [] };
  const cards = [{ id: 'a', selected: 'false', label: 'BANG!' }];
  const before = { revision: 4, sent: 0, accepted: 0, selection: JSON.stringify(cards) };
  assertBrowseUnchanged(actor, before, { cards });
  for (const change of [{ sent: [{}] }, { accepted: [{}] }, { public: { revision: 5 } }, { private: { revision: 3 } }]) assert.throws(() => assertBrowseUnchanged({ ...actor, ...change }, before, { cards }));
  for (const change of [{ selected: 'true' }, { label: 'Selected BANG!' }, { id: 'other' }]) assert.throws(() => assertBrowseUnchanged(actor, before, { cards: [{ ...cards[0], ...change }] }));
});

test('real browse controls cover disabled cards and actual Tab covers enabled cards without activation', async () => {
  let index = 0, focus = null;
  const actor = { name: 'Owned', public: { revision: 8 }, private: { revision: 8, hand: ['a', 'b', 'c'].map(id => ({ id })) }, sent: [], accepted: [] };
  const state = () => ({ left: index * 250, maximum: 500, position: `Card ${index + 1} of 3`, cards: ['a', 'b', 'c'].map((id, i) => ({ id: 'bang-card-hand-' + id, selected: 'false', label: id, enabled: i !== 1, visible: i === index, focused: focus === id })) });
  const controls = ['Previous hand card', 'Next hand card'].map(label => ({
    evaluate: async (_fn, expected) => expected ? expected === label && (label.startsWith('Previous') ? index > 0 : index < 2) : undefined,
    boundingBox: async () => ({ width: 48, height: 48 }), dispose: async () => {},
    tap: async () => { index += label.startsWith('Previous') ? -1 : 1; },
  }));
  actor.page = { viewport: () => ({ width: 375, hasTouch: true }), evaluate: async () => state(), $$: async () => controls,
    focus: async () => { focus = 'a'; index = 0; }, keyboard: { press: async key => { assert.equal(key, 'Tab'); focus = 'c'; index = 2; } } };
  const recorder = { evidence: {}, persist() {} };
  await proveHandBrowsing(actor, true, recorder);
  const proof = recorder.evidence.handBrowsing[0];
  assert.equal(proof.commandsEmitted, 0); assert.equal(proof.scale, 200); assert.equal(proof.disabledFocusClaim, false);
  assert.deepEqual(proof.revealed, ['bang-card-hand-a', 'bang-card-hand-b', 'bang-card-hand-c']);
  assert.deepEqual(proof.focused, ['bang-card-hand-a', 'bang-card-hand-c']); assert.equal(index, 0);
});

test('hand edge budget is first and last at320 and375 in both text scales with required natural path', async () => {
  const actor = actorPage(true), original = actor.page.viewport(), calls = [];
  actor.private = { hand: [{ id: 'first' }, { id: 'middle' }, { id: 'last' }] };
  await captureHandReadability(actor, { capture: async (page, name, options) => { calls.push({ width: page.viewport().width, name, ...options }); return framedRecord({ viewportWidth: page.viewport().width }); } });
  assert.equal(calls.length, 16); assert.equal(calls.filter(call => call.prepare).length, 4);
  assert(calls.every(call => !call.frame.includes('middle'))); assert.equal(actor.page.viewport(), original);
  assert.match(driver, /actor.private.canPlay && actor.private.hand.length > 2 && actor.private.playOptions.length >= 2/);
  assert.match(driver, /Natural match did not supply the required owned-hand browse and keyboard path/);
  assert(driver.indexOf('await captureHandReadability(actor)') < driver.indexOf('await driveDecision(actor, step);', driver.indexOf('async function completeMatch')));
});

test('card activation diagnostics capture touch hit tests and rail movement without values or mutations', () => {
  const listeners = new Map();
  const node = { id: 'bang-card-hand-own', parentElement: null, offsetLeft: 284,
    getAttribute: name => ({ 'aria-pressed': 'false', 'aria-disabled': 'false', role: 'button' })[name] ?? null,
    getBoundingClientRect: () => ({ x: 12, y: 80, width: 260, height: 340 }), closest() { return { id: this.id, parentElement: this }; } };
  const rail = { scrollLeft: 0, clientWidth: 280, scrollWidth: 840, getBoundingClientRect: node.getBoundingClientRect };
  const document = { activeElement: node, querySelector: selector => selector.includes('rail') ? rail : selector.includes('position') ? { textContent: 'Card 1 of 3' } : node,
    querySelectorAll: () => [], elementFromPoint: (x, y) => { assert.equal(x, 142); assert.equal(y, 250); return node; },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const context = vm.createContext({ window: {}, document, performance: { now: () => 10 } });
  const run = mode => vm.runInContext(`(${cardActivationTrace})({selector:'card',mode:'${mode}',phase:'${mode}'})`, context);
  assert.equal(run('start').snapshot.wrapperOffsetLeft, 284); assert.equal(listeners.size, 6);
  assert.throws(() => run('start'), /already active/);
  rail.scrollLeft = 284;
  for (let i = 0; i < 20; i++) listeners.get('touchstart')({ type: 'touchstart', target: node, changedTouches: [{ clientX: 142, clientY: 250 }] });
  const result = run('stop');
  assert.equal(result.events.length, 16); assert.equal(result.dropped, 4); assert.equal(result.events[0].rail.left, 284);
  assert.equal(result.events[0].hit[0].id, node.id); assert.equal(result.snapshot.selected, 'false');
  assert.equal(listeners.size, 0); assert.equal(context.window.__bangCardTrace, undefined);
  assert(!JSON.stringify(result).includes('value')); assert.throws(() => run('read'), /missing/);
});

test('card activation records bounded attempts and never retries failed input', async () => {
  let taps = 0, disposed = 0, persisted = 0;
  const element = { evaluate: async () => {}, boundingBox: async () => ({ width: 260, height: 340 }),
    tap: async () => { taps++; throw new Error('tap failed'); }, dispose: async () => { disposed++; } };
  const actor = { name: 'Owned', public: { revision: 2 }, private: { revision: 2, hand: [{ id: 'own', name: 'stagecoach' }] },
    page: { $eval: async () => true, $: async () => element, viewport: () => ({ width: 375, hasTouch: true }), evaluate: async (_fn, arg) => ({ phase: arg.phase }) } };
  const recorder = { evidence: { cardActivations: Array.from({ length: 32 }, () => ({})) }, persist: () => persisted++ };
  await assert.rejects(card(actor, 'own', 'hand', recorder), /tap failed/);
  assert.equal(taps, 1); assert.equal(disposed, 1); assert.equal(persisted, 1);
  assert.equal(recorder.evidence.cardActivations.length, 32); assert.equal(recorder.evidence.cardActivationsDropped, 1);
  const trace = recorder.evidence.cardActivations.at(-1);
  assert.equal(trace.name, 'stagecoach'); assert.equal(trace.revision, 2); assert.equal(trace.afterPrivateRevision, 2);
  assert.deepEqual(trace.stages.map(stage => stage.phase), ['before-scroll', 'before-activation', 'after-activation']);
  assert.equal(trace.error, 'tap failed');
});
