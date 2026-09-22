const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Buffer } = require('node:buffer');
const { persistReceipt, redact, registerLibertaliaText, readLibertaliaFontState, validateLibertaliaFontState, enlargeLibertaliaText, restoreLibertaliaText, assertFrameCoverage } = require('./libertalia-ui-primitives.cjs');
const { CAPTURE_LIMIT } = require('./libertalia-ui-evidence.cjs');
const { choiceSelector, assertOwnedChoice, readChoiceTarget, stableChoiceSample, activateChoice } = require('./libertalia-ui-choice.cjs');
const { choiceOptionFrame } = require('./libertalia-ui-natural.cjs');
const { SOURCE_FILES, CAPTURE_PLAN, PLANNED_CAPTURES, sourceHashes, verifyFrozenEvidence, recordBrowserResponse, commandMetadata, assertCommand, completionStatus, captureFrame, markChoiceFrame } = require('./libertalia-ui-natural.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'libertalia-ui-primitives.cjs'), 'utf8');
const evidenceSource = fs.readFileSync(path.join(__dirname, 'libertalia-ui-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'libertalia-ui-smoke.cjs'), 'utf8');

test('receipt redaction masks nested credential fields even when values were not registered', () => {
  const value = redact({ password: 'unknown-password', nested: { token: 'unknown-token', authorization: 'opaque' }, useful: 'revision 3', diagnostic: 'password=unknown-inline' });
  for (const secret of ['unknown-password', 'unknown-token', 'opaque', 'unknown-inline']) assert(!value.includes(secret));
  assert.equal(JSON.parse(value).useful, 'revision 3');
});

function receiptSandbox(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'libertalia-receipt-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert(path.basename(directory).startsWith('libertalia-receipt-test-'));
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
  }, { filename: 'libertalia-ui-primitives.cjs' });
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

test('Libertalia CSS200 converges after grid replacement and new toolbar using authentic unscaled baselines', async () => {
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
  const baseline = await enlargeLibertaliaText(dom.page), state = await dom.page.evaluate(readLibertaliaFontState);
  validateLibertaliaFontState(state);
  assert.equal(baseline.detachedHistory.length, 1); assert.equal(baseline.detachedHistory[0].text, 'Old grid card');
  assert.equal(baseline.samples.find(sample => sample.text === 'Replacement rail card').before, 18);
  assert.equal(dom.computed(replacement).fontSize, '36px'); assert.equal(dom.computed(toolbar).fontSize, '28px');
  assert.equal(dom.computed(stable).fontSize, '36px'); assert.equal(dom.computed(input).fontSize, '32px');
  assert.equal(state.eligibleCount, 4); assert(!JSON.stringify(baseline).includes(input.value));
  assert.equal(await dom.page.evaluate(registerLibertaliaText, 9), 0); assert.equal(dom.computed(stable).fontSize, '36px');
  await restoreLibertaliaText(dom.page);
  assert.equal(dom.sheet(), null); assert.equal(dom.context.window.__skullText.length, 0); assert.equal(dom.context.window.__libertaliaFontSnapshot, undefined);
  assert.equal(old.getAttribute('data-skull-qa-text'), 'original');
  assert(dom.all.filter(node => node !== old).every(node => node.getAttribute('data-skull-qa-text') === null));
});

test('post-convergence missing replacement and detached nodes fail rather than being ignored', async () => {
  const dom = fontDom(), old = dom.make('Current card');
  await enlargeLibertaliaText(dom.page);
  old.isConnected = false; dom.make('New unscaled card');
  const changed = await dom.page.evaluate(readLibertaliaFontState);
  assert.equal(changed.missing.length, 1); assert(changed.changedAfterConvergence > 0);
  assert.throws(() => validateLibertaliaFontState(changed), /missing its authentic/);
  await dom.page.evaluate(registerLibertaliaText, 10);
  assert.throws(() => validateLibertaliaFontState(awaitableState(dom)), /Mounted text changed/);
  await restoreLibertaliaText(dom.page);
});

function awaitableState(dom) { return vm.runInContext(`(${readLibertaliaFontState})()`, dom.context); }

test('repeated responsive replacements converge but endless remounts stop after eight passes and restore', async () => {
  for (const limit of [2, Infinity]) {
    const dom = fontDom(); let current = dom.make('Card 0'), replacements = 0;
    dom.setRender(() => {
      if (dom.sheet() && current.getAttribute('data-skull-qa-text') !== null && replacements < limit) {
        current.isConnected = false; current = dom.make('Card ' + (++replacements));
      }
    });
    if (limit === 2) { const baseline = await enlargeLibertaliaText(dom.page); assert.equal(baseline.detachedHistory.length, 2); validateLibertaliaFontState(await dom.page.evaluate(readLibertaliaFontState)); }
    else { await assert.rejects(enlargeLibertaliaText(dom.page), /eight bounded passes/); assert.equal(replacements, 8); }
    await restoreLibertaliaText(dom.page); assert.equal(dom.sheet(), null); assert(dom.all.every(node => node.getAttribute('data-skull-qa-text') === null));
  }
});

test('strict font state validates current coverage count family doubling and mounted identity', () => {
  const good = { fonts: [{ text: 'Card', before: 16, after: 32, family: 'Outfit', afterFamily: 'Outfit', connected: true }], missing: [], eligibleCount: 1, changedAfterConvergence: 0, detachedHistory: [{ text: 'Old card', before: 16, family: 'Outfit' }] };
  validateLibertaliaFontState(good);
  for (const change of [{ eligibleCount: 2 }, { changedAfterConvergence: 1 }, { missing: ['new toolbar'] }, { fonts: [{ ...good.fonts[0], after: 16 }] }, { fonts: [{ ...good.fonts[0], afterFamily: 'fallback' }] }, { fonts: [{ ...good.fonts[0], connected: false }] }]) assert.throws(() => validateLibertaliaFontState({ ...good, ...change }));
  assert.match(evidenceSource, /post.textScaleState = await page.evaluate\(readLibertaliaFontState\)/);
  assert.match(evidenceSource, /validateLibertaliaFontState\(post.textScaleState\)/);
});


function recorder() {
  return { origins: new Set(['http://localhost:3213']), secrets: new Set(['private-token']),
    evidence: { captures: [], findings: [], blockedRequests: [], cleanup: [] }, persist() {} };
}
function response({ method = 'POST', status = 200, pathname = '/rooms/create', origin = 'http://localhost:3213', json = async () => ({ auth: { token: 'owned-token', playerId: 'owner', roomCode: 'CODE' } }) } = {}) {
  return { url: () => origin + pathname, request: () => ({ method: () => method }), ok: () => status >= 200 && status < 300, status: () => status, json };
}

test('authentication observer parses only successful exact local POSTs and redacts observer errors', async () => {
  const qa = recorder(), actor = { name: 'owner' }; let parsed = 0;
  for (const changes of [{ method: 'OPTIONS' }, { method: 'GET' }, { status: 401 }, { pathname: '/rooms/create-more' }, { origin: 'http://untrusted.invalid' }]) {
    await recordBrowserResponse(response({ ...changes, json: async () => { parsed++; throw Error('must not parse'); } }), actor, qa);
  }
  assert.equal(parsed, 0); assert.equal(qa.evidence.responseIssues, undefined);
  await recordBrowserResponse(response(), actor, qa);
  assert.equal(actor.auth.playerId, 'owner'); assert(qa.secrets.has('owned-token'));
  await recordBrowserResponse(response({ json: async () => { throw Error('private-token malformed'); } }), actor, qa);
  assert.equal(qa.evidence.responseIssues.length, 1); assert(!JSON.stringify(qa.evidence.responseIssues).includes('private-token'));
});

test('Libertalia outgoing metadata excludes credentials and validates exact owned choice revision', () => {
  const actor = { name: 'owner', latestPrivate: { revision: 7, pendingChoice: { id: 'own-choice' } } };
  const command = commandMetadata(['libertalia:choice', { expectedRevision: 7, choiceId: 'own-choice', optionIds: ['option'], token: 'private-token', password: 'secret' }], actor);
  assert(!JSON.stringify(command).includes('private-token')); assert(!JSON.stringify(command).includes('secret'));
  assertCommand(command, 7, 'own-choice', { action: 'choice', revision: 8 });
  for (const changes of [{ expectedRevision: 6 }, { pairedRevision: 6 }, { choiceId: 'other' }, { event: 'libertalia:select' }]) {
    assert.throws(() => assertCommand({ ...command, ...changes }, 7, 'own-choice', { action: 'choice', revision: 8 }));
  }
  assert.equal(commandMetadata(['notalone:select', {}], actor), null);
  const rematch = commandMetadata(['start_game'], actor);
  assertCommand(rematch, 7, null, { action: 'start', revision: 8 });
});

test('source fence names only real files and final source and bundle drift fail closed', async () => {
  assert.equal(new Set(SOURCE_FILES).size, SOURCE_FILES.length);
  for (const file of SOURCE_FILES) assert(fs.existsSync(path.resolve(__dirname, '../../..', file)), file);
  const hashes = sourceHashes(() => Buffer.from('frozen')); assert.equal(Object.keys(hashes).length, SOURCE_FILES.length);
  const qa = recorder(); qa.evidence.sourceHashes = { file: 'sha' }; qa.evidence.bundle = { sha256: 'bundle' };
  await verifyFrozenEvidence(qa, 'http://localhost:8081', { sourceHashes: () => ({ file: 'sha' }), bundleFence: async () => ({ sha256: 'bundle' }) });
  assert(qa.evidence.freezeVerified);
  delete qa.evidence.freezeVerified;
  await assert.rejects(verifyFrozenEvidence(qa, 'http://localhost:8081', { sourceHashes: () => ({ file: 'changed' }) }), /Source or artwork/);
  assert(!qa.evidence.freezeVerified);
  await assert.rejects(verifyFrozenEvidence(qa, 'http://localhost:8081', { sourceHashes: () => ({ file: 'sha' }), bundleFence: async () => ({ sha256: 'changed' }) }), /Served or disk/);
});

function finished() {
  const names = ['one', 'two', 'three'], qa = recorder();
  Object.assign(qa.evidence, { browserClosed: true, freezeVerified: true,
    cleanup: names.flatMap(actor => [{ actor, normalUI: true, status: 200, authCleared: true }, { actor, contextClosed: true }]) });
  return { names, evidence: qa.evidence };
}
test('pass requires all three normal UI exits auth clearing contexts browser freeze and clean evidence', () => {
  const { names, evidence } = finished(); assert(completionStatus(evidence, names).passed);
  for (const change of [{ browserClosed: false }, { freezeVerified: false }, { failure: true }, { watchdogExpired: true },
    { responseIssues: [{}] }, { finalIssues: [{}] }, { findings: [{}] }, { blockedRequests: ['off-origin'] },
    { captures: [{ metrics: { privacyGaps: ['missing ready'] } }] }, { captures: [{ metrics: { selectorGaps: ['missing hand'] } }] }]) {
    assert(!completionStatus({ ...evidence, ...change }, names).passed);
  }
  for (const change of [{ fallback: true }, { status: 500 }, { authCleared: false }, { normalUI: false }]) {
    const copy = structuredClone(evidence); Object.assign(copy.cleanup[0], change); assert(!completionStatus(copy, names).passed);
  }
  const copy = structuredClone(evidence); copy.cleanup[1].contextClosed = false; assert(!completionStatus(copy, names).passed);
  assert(!completionStatus(evidence, names.slice(1)).passed);
});

function frame(top = 0, height = 100, visibleTop = 0, visibleBottom = 844) {
  return { file: 'frame.png', metrics: { frame: { top, bottom: top + height, left: 16, right: 316, width: 300, height },
    frameVisibleBounds: { top: visibleTop, bottom: visibleBottom, left: 0, right: 375 } } };
}
test('full framing rejects internal gaps clipped widths and unstable frame heights', () => {
  assertFrameCoverage([frame()]);
  assertFrameCoverage([frame(72, 1000, 72), frame(-156, 1000, 72)]);
  assert.throws(() => assertFrameCoverage([frame(72, 2000, 72), frame(-1156, 2000, 72)]), /gap/);
  assert.throws(() => assertFrameCoverage([frame(72, 1000, 72), frame(-156, 990, 72)]), /changed height/);
  const wide = frame(); wide.metrics.frame.right = 500; assert.throws(() => assertFrameCoverage([wide]), /width/);
});

test('frame capture uses actual actor profile and adds only a necessary bounded second edge', async () => {
  const actor = { name: 'touch', inputProfile: { hasTouch: true }, page: { viewport: () => ({ width: 375, height: 844, hasTouch: true }) } };
  const qa = recorder(); let calls = [];
  qa.capture = async (_page, name, options) => { calls.push({ name, ...options }); return frame(); };
  await captureFrame(actor, 'full', '#card', qa);
  assert.equal(calls.length, 2); assert.deepEqual(calls.map(call => call.scale), [false, true]); assert.equal(qa.evidence.frameProofs.length, 2);
  assert(qa.evidence.frameProofs.every(proof => proof.inputProfile.hasTouch));
  calls = []; qa.capture = async (_page, _name, options) => { calls.push(options); return frame(options.align === 'start' ? 72 : -156, 1000, 72); };
  await captureFrame(actor, 'tall', '#card', qa, { scales: [true] });
  assert.deepEqual(calls.map(call => call.align), ['start', 'end']);
});

test('finite natural plan retains full framing and owner policy without rare fixtures', () => {
  assert.equal(PLANNED_CAPTURES, CAPTURE_LIMIT); assert(CAPTURE_LIMIT <= 218);
  assert.equal(Object.values(CAPTURE_PLAN).reduce((a, b) => a + b, 0), PLANNED_CAPTURES);
  assert.match(driver, /choice.options\[\(pub.day \+ index\) % choice.options.length\]/);
  assert.match(driver, /mine.hand\[\(pub.day \+ index\) % mine.hand.length\]/);
  assert.match(driver, /receipt.terminal.endReason, 'score'/); assert.match(driver, /host.latestPublic.endReason, 'forfeit'/);
  assert.match(driver, /captureHandFaces\(players\[2\]\)/); assert.match(driver, /captureResultDetails\(\[host, players\[2\]\]/);
  assert.match(driver, /assertLocalUnchanged\(host, proposalBefore\)/);
  assert.match(driver, /try \{ await verifyFrozenEvidence\(qa, origin\)/);
  assert.doesNotMatch(driver, /__qa\/.*fixture|reset_game|seedState/);
});

test('choice framing marks real instruction and uniquely scoped full option without reshaping DOM', () => {
  const instruction = choiceNode('Full instruction', { 'aria-live': 'polite' });
  const option = choiceNode('Full crew timing and prose', { 'aria-label': 'Chosen option', 'aria-selected': 'true' });
  const heading = { textContent: 'Choose a crew', nextElementSibling: instruction };
  let controls = [option];
  const area = { contains: node => node === heading, querySelectorAll: () => controls };
  const document = { querySelector: () => null, getElementById: id => id === 'libertalia-decision-area' ? area : heading };
  const run = args => vm.runInNewContext('(' + markChoiceFrame.toString() + ')(args)', { document, args });
  assert.equal(run({ part: 'instruction' }).text, 'Full instruction');
  assert.equal(instruction.attributes['data-libertalia-qa-choice'], 'frame');
  const selected = run({ part: 'control', label: 'Chosen option' });
  assert.equal(selected.selected, 'true'); assert.equal(selected.text, 'Full crew timing and prose');
  controls = [option, option]; assert.throws(() => run({ part: 'control', label: 'Chosen option' }), /exactly one/);
  instruction.attributes['aria-live'] = null; assert.throws(() => run({ part: 'instruction' }), /actual decision instruction/);
  assert.doesNotMatch(markChoiceFrame.toString(), /appendChild|cloneNode|innerHTML|\.style\s*=/);
});

function choiceNode(textContent, attributes) {
  return { textContent, attributes, isConnected: true, closest: () => null,
    getAttribute: key => attributes[key] ?? null, setAttribute: (key, value) => { attributes[key] = value; },
    getBoundingClientRect: () => ({ width: 300, height: 400 }) };
}

function choiceHarness({ touch = false, label = 'AMULET · Voyage Admiral. Calm-side effect: Gain 3 doubloons at anchor.', ids = ['ship:admiral:21', 'ship:admiral:24'] } = {}) {
  const records = [], nodes = [], pageWindow = {}, viewport = { width: 1280, height: 844, hasTouch: touch, isMobile: touch };
  let samples = 0, onSample = () => {}, covered = false;
  const makeNode = (id, index) => ({
    id, testid: 'libertalia-choice-45-' + encodeURIComponent(id), label, isConnected: true, disabled: false,
    bounds: { left: 20, top: 100 + index * 150, width: 300, height: 120 },
    getAttribute(key) { return key === 'aria-label' ? this.label : key === 'aria-disabled' ? String(this.disabled) : null; },
    hasAttribute(key) { return key === 'disabled' && this.disabled; },
    matches: () => true, closest: () => null, contains: () => false,
    scrollIntoView() {}, getBoundingClientRect() { return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height }; },
    textContent: label,
  });
  nodes.push(...ids.map(makeNode));
  const select = selector => selector.includes('data-testid=') ? nodes.filter(node => node.isConnected && selector.includes('"' + node.testid + '"')) : nodes.filter(node => node.isConnected);
  const document = { querySelectorAll: select, querySelector: selector => select(selector)[0] ?? null,
    elementFromPoint: (x, y) => covered ? {} : nodes.find(node => node.isConnected && x >= node.bounds.left && x <= node.bounds.left + node.bounds.width && y >= node.bounds.top && y <= node.bounds.top + node.bounds.height) };
  const context = { document, window: pageWindow, WeakMap, getComputedStyle: () => ({ display: 'flex', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }), innerWidth: viewport.width, innerHeight: viewport.height, scrollX: 0, scrollY: 0 };
  const evaluate = (fn, args, element) => vm.runInNewContext('(' + fn.toString() + ')(...args)', { ...context, innerWidth: viewport.width, innerHeight: viewport.height, args: element ? [element, args] : [args] });
  const handle = node => ({ evaluate: async (fn, data) => evaluate(fn, data, node), boundingBox: async () => node.bounds,
    click: async () => { records.push({ mode: 'click', id: node.id }); }, tap: async () => { records.push({ mode: 'tap', id: node.id }); }, dispose: async () => {} });
  const page = { viewport: () => ({ ...viewport }), evaluate: async (fn, data) => { if (fn.name === 'readChoiceTarget') onSample(++samples); return evaluate(fn, data); },
    $eval: async (selector, fn, data) => evaluate(fn, data, select(selector)[0]), $: async selector => select(selector)[0] ? handle(select(selector)[0]) : null,
    $$: async selector => select(selector).map(handle) };
  const actor = { name: 'Voyage Boatswain', auth: { playerId: 'boatswain', roomCode: 'ABCD-EFGH' }, inputProfile: { hasTouch: touch }, page,
    latestPublic: { roomCode: 'ABCD-EFGH', revision: 71 },
    latestPrivate: { roomCode: 'ABCD-EFGH', playerId: 'boatswain', revision: 71, pendingChoice: { id: 45, playerId: 'boatswain', options: ids.map(id => ({ id })) } } };
  const identity = { choiceId: 45, optionId: ids[1], label, revision: 71 }, qa = { evidence: {}, secrets: new Set(), persist() {} };
  return { actor, identity, qa, records, nodes, viewport, makeNode, pageWindow, setSample: fn => { onSample = fn; }, setCovered: value => { covered = value; } };
}

test('unchanged label helper chooses amulet21 while identity activation and framing choose exact amulet24', async () => {
  const { LIBERTALIA_LOOT_COUNTS } = require('../../../packages/types/src/libertalia-constants.ts');
  const kinds = Object.entries(LIBERTALIA_LOOT_COUNTS).flatMap(([kind, count]) => Array(count).fill(kind));
  assert.equal(kinds[20], 'amulet'); assert.equal(kinds[23], 'amulet');
  const scenario = choiceHarness(), { actor, identity, qa, records } = scenario;
  const matcher = new RegExp('^' + identity.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  await require('./not-alone-ui-smoke.cjs').clickButton(actor.page, matcher);
  assert.equal(records[0].id, 'ship:admiral:21');
  await activateChoice(actor, identity, qa, { intervalMs: 1, timeoutMs: 500 });
  assert.deepEqual(records[1], { mode: 'click', id: 'ship:admiral:24' });
  assert.equal(qa.evidence.choiceInputs[0].optionId, 'ship:admiral:24');
  assert(qa.evidence.choiceInputs[0].beforeDispatch.ready); assert(qa.evidence.choiceInputs[0].dispatched);
  qa.capture = async (_page, name, options) => { await options.prepare(); assert.equal(options.frame, choiceSelector(45, identity.optionId)); return { ...frame(), file: name }; };
  const proof = await choiceOptionFrame(actor, 'chosen-token', identity, qa);
  assert.equal(proof.optionId, 'ship:admiral:24'); assert.equal(proof.proofs.length, 1); assert.equal(records.length, 2);
});

test('opaque nested crew identities and equal labels use exact controls with real touch input', async () => {
  const scenario = choiceHarness({ touch: true, ids: ['grave:owner:7', 'ship:owner:7'], label: '#7 Preacher · You. Full printed rule.' });
  await activateChoice(scenario.actor, scenario.identity, scenario.qa, { intervalMs: 1, timeoutMs: 500 });
  assert.deepEqual(scenario.records, [{ mode: 'tap', id: 'ship:owner:7' }]);
  assert(choiceSelector(45, 'a"b:c/[]').includes('a%22b%3Ac%2F%5B%5D'));
  assert.throws(() => choiceSelector(null, 'x')); assert.throws(() => choiceSelector(45, ''));
});

test('stale choice owner revision or option is rejected before any input', async () => {
  for (const mutate of [s => { s.actor.latestPrivate.revision++; }, s => { s.actor.latestPrivate.pendingChoice.id++; }, s => { s.actor.latestPrivate.pendingChoice.playerId = 'other'; }, s => { s.identity.optionId = 'absent'; }, s => { s.actor.auth.roomCode = 'OTHER'; }]) {
    const s = choiceHarness(); mutate(s); await assert.rejects(activateChoice(s.actor, s.identity, s.qa)); assert.equal(s.records.length, 0);
  }
  const s = choiceHarness(); s.setSample(count => { if (count === 3) s.actor.latestPublic.revision++; });
  await assert.rejects(activateChoice(s.actor, s.identity, s.qa, { intervalMs: 1, timeoutMs: 500 }), /revision changed/); assert.equal(s.records.length, 0);
});

test('disabled occluded duplicate and relabelled choices never dispatch or retry', async () => {
  for (const mutate of [s => { s.nodes[1].disabled = true; }, s => s.setCovered(true), s => { s.nodes.push(s.makeNode(s.identity.optionId, 2)); }, s => { s.nodes[1].label = 'wrong label'; }]) {
    const s = choiceHarness(); mutate(s);
    await assert.rejects(activateChoice(s.actor, s.identity, s.qa, { intervalMs: 1, timeoutMs: 25 }));
    assert.equal(s.records.length, 0); assert.equal(s.qa.evidence.choiceInputs[0].dispatched, false);
  }
});

test('pre-input remount and motion restart stability, while viewport change fails closed', async () => {
  const s = choiceHarness();
  s.setSample(count => {
    if (count === 3) { s.nodes[1].isConnected = false; s.nodes[1] = s.makeNode(s.identity.optionId, 1); }
    if (count === 4) s.nodes[1].bounds.top += 20;
  });
  await activateChoice(s.actor, s.identity, s.qa, { intervalMs: 1, timeoutMs: 500 });
  assert.equal(s.records.length, 1); assert(s.qa.evidence.choiceInputs[0].samples.length >= 7);
  assert.equal(new Set(s.qa.evidence.choiceInputs[0].samples.map(sample => sample.nodeId)).size, 2);
  const changed = choiceHarness(); changed.setSample(count => { if (count === 3) changed.viewport.width = 375; });
  await assert.rejects(activateChoice(changed.actor, changed.identity, changed.qa, { intervalMs: 1, timeoutMs: 500 }), /Viewport changed/); assert.equal(changed.records.length, 0);
  const final = choiceHarness(); final.setSample(count => { if (count === 6) { final.nodes[1].isConnected = false; final.nodes[1] = final.makeNode(final.identity.optionId, 1); } });
  await assert.rejects(activateChoice(final.actor, final.identity, final.qa, { intervalMs: 1, timeoutMs: 500 }), /changed before dispatch/); assert.equal(final.records.length, 0);
});

test('a dispatch failure records one attempt and never retries the pointer event', async () => {
  const s = choiceHarness(), get = s.actor.page.$; let attempts = 0;
  s.actor.page.$ = async selector => ({ ...await get(selector), click: async () => { attempts++; s.qa.persist = () => { throw Error('secondary receipt failure'); }; throw Error('synthetic input failure'); }, dispose: async () => { throw Error('secondary handle failure'); } });
  await assert.rejects(activateChoice(s.actor, s.identity, s.qa, { intervalMs: 1, timeoutMs: 500 }), /synthetic input failure/);
  assert.equal(attempts, 1); assert.equal(s.qa.evidence.choiceInputs[0].dispatchAttempted, true); assert.equal(s.qa.evidence.choiceInputs[0].dispatched, false);
  assert.equal(s.qa.evidence.choiceInputs[0].receiptError, 'secondary receipt failure');
});

test('choice selectors are shared by natural and fixture framing and exact command assertions remain', () => {
  assertOwnedChoice(choiceHarness().actor, choiceHarness().identity);
  assert.match(driver, /choiceOptionFrame\(player/); assert.match(driver, /activateChoice\(player, identity, qa\)/);
  const fixture = fs.readFileSync(path.join(__dirname, 'libertalia-fixture-ui.cjs'), 'utf8');
  assert.match(fixture, /choiceIdentity\(actor, identity\)/); assert.match(fixture, /activateChoice\(actor, identity, qa\)/);
  assert.match(fixture, /assert.deepEqual\(actor.sent.at\(-1\).optionIds, \[identity.optionId\]/);
  assert.match(driver, /assert.deepEqual\(player.commandMetadata.at\(-1\).optionIds, \[identity.optionId\]/);
  assert(SOURCE_FILES.some(file => file.endsWith('libertalia-ui-choice.cjs')));
  assert.equal(typeof readChoiceTarget, 'function'); assert.equal(stableChoiceSample(null, {}), false);
});
