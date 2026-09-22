const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { bundleFence, guardNetwork, local, validateFonts, installTextGeometry, redact, enlarge, restore, settle, measureContainment, classifyContainment, calibrateContainment } = require('./skull-ui-evidence.cjs');

const MATRIX = [[320, 780], [375, 844], [414, 896], [768, 900], [1280, 900], [844, 390]];
// Reserve 30 row/results frames without consuming existing natural-branch coverage.
const CAPTURE_LIMIT = 160;
const PLACE_ART_BY_ID = Object.freeze({
  1: 'not-alone-place-lair', 2: 'not-alone-place-jungle', 3: 'not-alone-place-river',
  4: 'not-alone-place-beach', 5: 'not-alone-place-rover', 6: 'not-alone-place-swamp',
  7: 'not-alone-place-shelter', 8: 'not-alone-place-wreck', 9: 'not-alone-place-source',
  10: 'not-alone-place-artefact',
});
const LAYOUT_IDS = ['not-alone-toolbar', 'not-alone-play-area', 'not-alone-decision-area', 'not-alone-private-hand', 'not-alone-public-trails', 'not-alone-public-table', 'not-alone-meter-rescue', 'not-alone-meter-assimilation', 'not-alone-game-over'];
const NOT_ALONE_CONTAINMENT = { game: 'not-alone', cardSelector: '[data-testid^="not-alone-place-card-"],[data-testid^="not-alone-card-chip-"]', decisionId: 'not-alone-decision-area', headingId: 'not-alone-decision-heading', siblingIds: ['not-alone-public-table', 'not-alone-public-trails'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fontSamples = () => (window.__skullText ?? []).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));

function checkReceiptDirectory(directory) {
  assert.notEqual(directory, path.parse(directory).root, 'Receipt output must not be a filesystem root');
  for (let current = directory; ; current = path.dirname(current)) {
    try {
      const entry = fs.lstatSync(current);
      assert(!entry.isSymbolicLink() && entry.isDirectory(), 'Receipt output must use real directories');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

function checkReceiptTarget(receipt) {
  try {
    const entry = fs.lstatSync(receipt);
    assert(!entry.isSymbolicLink() && entry.isFile(), 'Receipt target must be a regular file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function renameReceipt(temporary, receipt, directory) {
  const started = performance.now(), waitCell = new Int32Array(new SharedArrayBuffer(4));
  let firstError;
  for (;;) {
    if (firstError && performance.now() - started >= 2000) throw firstError;
    checkReceiptDirectory(directory); checkReceiptTarget(receipt);
    try { fs.renameSync(temporary, receipt); return; } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      firstError ??= error;
      const remaining = 2000 - (performance.now() - started);
      if (remaining <= 0) throw firstError;
      Atomics.wait(waitCell, 0, 0, Math.min(25, remaining));
    }
  }
}

function persistReceipt(outputDir, serialised) {
  assert(typeof outputDir === 'string' && outputDir.trim(), 'Receipt output directory required');
  const directory = path.resolve(outputDir), receipt = path.join(directory, 'receipt.json');
  checkReceiptDirectory(directory);
  fs.mkdirSync(directory, { recursive: true });
  checkReceiptDirectory(directory); checkReceiptTarget(receipt);
  const temporary = path.join(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let descriptor, ownedTemporary = false;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600); ownedTemporary = true;
    fs.writeFileSync(descriptor, serialised, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    renameReceipt(temporary, receipt, directory); ownedTemporary = false;
  } catch (error) {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
    if (ownedTemporary) {
      try { checkReceiptDirectory(directory); fs.unlinkSync(temporary); } catch {}
    }
    throw error;
  }
}

function hasOwnedNotAlonePair(auth, publicState, privateState) {
  return Boolean(auth?.playerId && auth?.roomCode
    && privateState?.playerId === auth.playerId
    && publicState?.viewerPlayerId === auth.playerId
    && privateState.roomCode === auth.roomCode
    && publicState.roomCode === auth.roomCode
    && Number.isSafeInteger(publicState.revision) && publicState.revision >= 0
    && publicState.revision === privateState.revision);
}

function geometry(ids) {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const clipped = [], controls = [], rails = [];
  for (const node of document.querySelectorAll('body *')) {
    const css = getComputedStyle(node), box = rect(node);
    if (!box.width || !box.height || css.visibility !== 'visible' || node.closest('[aria-hidden="true"]')) continue;
    let visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    for (let owner = node.parentElement; owner; owner = owner.parentElement) {
      const style = getComputedStyle(owner), b = rect(owner);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) { visible.left = Math.max(visible.left, b.left); visible.right = Math.min(visible.right, b.right); }
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) { visible.top = Math.max(visible.top, b.top); visible.bottom = Math.min(visible.bottom, b.bottom); }
    }
    const onScreen = box.right > visible.left && box.left < visible.right && box.bottom > visible.top && box.top < visible.bottom && visible.right > visible.left && visible.bottom > visible.top;
    if (node.matches('[role="button"],button') && onScreen) controls.push({ label: node.getAttribute('aria-label') ?? node.textContent.trim(), ...box });
    if (['auto', 'scroll'].includes(css.overflowX) && node.scrollWidth > node.clientWidth + 1) rails.push({ id: node.id, ...box, scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
    if (/icon|material|fontawesome/i.test(css.fontFamily)) continue;
    const texts = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    if (!texts.length) continue;
    const measured = texts.map(window.__coupQATextGeometry);
    let scrollX = false, scrollY = false;
    for (let owner = node; owner; owner = owner.parentElement) {
      const s = getComputedStyle(owner), b = rect(owner);
      scrollX ||= ['auto', 'scroll'].includes(s.overflowX) && owner.scrollWidth > owner.clientWidth;
      scrollY ||= ['auto', 'scroll'].includes(s.overflowY) && owner.scrollHeight > owner.clientHeight;
      const proof = window.__coupQAOverflowProof(measured, b, !scrollX && ['hidden', 'clip'].includes(s.overflowX), !scrollY && ['hidden', 'clip'].includes(s.overflowY), 2);
      if (proof.raw.length || proof.glyphs.length) {
        clipped.push({ text: texts.map(child => child.textContent).join(''), geometry: measured, proof, ancestor: owner.id || owner.tagName,
          visible: onScreen && measured.some(g => g.glyphRects.some(r => r.right > visible.left && r.left < visible.right && r.bottom > visible.top && r.top < visible.bottom)) });
        break;
      }
    }
  }
  return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, clipped, controls, rails,
    layout: Object.fromEntries(ids.map(id => { const n = document.getElementById(id); return [id, n ? rect(n) : null]; })),
    images: [...document.querySelectorAll('img')].map(n => {
      const placeId = n.closest('[data-testid^="not-alone-place-card-"]')?.getAttribute('data-testid')?.match(/^not-alone-place-card-(\d+)$/)?.[1] ?? null;
      return { source: /^(https?:)/.test(n.currentSrc || n.src) ? new URL(n.currentSrc || n.src).pathname : 'inline', placeId, complete: n.complete, naturalWidth: n.naturalWidth, ...rect(n) };
    }) };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const actors = new Map(), secrets = new Set(), assetCache = new Map();
  const evidence = { method: "Coordinated ordinary-server functional policy reads synthetic seats' private projections to arrange catches/misses. Not own-view-only competitive play, manual, native fontScale or physical-device evidence.", captureBudget: CAPTURE_LIMIT, captures: [], attempts: [], findings: [], rawRangeDiagnostics: [], blockedRequests: [], cleanup: [], gaps: [], browserClosed: false };
  const persist = () => persistReceipt(outputDir, redact(evidence, [...secrets]) + '\n');
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, allowTransient = false) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (/\/not-alone\/(game|lobby)$/.test(new URL(page.url()).pathname)) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      if (auth?.token) { secrets.add(auth.token); actor.auth = auth; }
      if (!allowTransient) {
        assert(auth?.token && auth.playerId && auth.roomCode, 'Own room authentication required');
        await page.waitForFunction(() => !/Reconnecting|Refreshing|Retry connection|Updating the table/i.test(document.body.innerText), { timeout: 10000 });
        const until = Date.now() + 10000;
        const paired = () => page.url().endsWith('/game')
          ? hasOwnedNotAlonePair(auth, actor.latestPublic, actor.latestPrivate)
          : actor.room?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft);
        while (!paired() && Date.now() < until) await pause(50);
        assert(paired(), 'Capture requires owned paired game or connected lobby state');
        if (page.url().endsWith('/game')) await page.waitForFunction(() => Boolean(document.getElementById('not-alone-decision-heading') || document.getElementById('not-alone-game-over')), { timeout: 10000 });
      }
    }
    await settle(page);
  }
  async function assets(images) {
    const root = path.resolve(process.env.QA_STATIC_ROOT), sources = path.resolve(__dirname, '../assets/game-art');
    const names = ['not-alone-cover', 'not-alone-hero', ...Object.values(PLACE_ART_BY_ID)];
    const known = new Map(names.filter(n => fs.existsSync(path.join(sources, n + '.webp'))).map(n => [hash(fs.readFileSync(path.join(sources, n + '.webp'))), n]));
    for (const image of images.filter(i => i.source !== 'inline')) {
      if (!assetCache.has(image.source)) {
        const url = new URL(image.source, base), disk = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert.equal(url.origin, new URL(base).origin); assert(disk.startsWith(root + path.sep));
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        const servedHash = hash(new Uint8Array(await response.arrayBuffer())), diskHash = hash(fs.readFileSync(disk));
        assert.equal(servedHash, diskHash, 'Captured asset differs from frozen disk');
        assetCache.set(image.source, { source: image.source, servedHash, diskHash, artwork: known.get(servedHash) ?? null });
      }
      image.artwork = assetCache.get(image.source).artwork;
      if (image.placeId !== null) {
        assert(Object.hasOwn(PLACE_ART_BY_ID, image.placeId), 'Captured Place ID must be canonical');
        assert.equal(image.artwork, PLACE_ART_BY_ID[image.placeId], 'Place artwork hash must match its live Place ID');
      }
    }
    evidence.assets = [...assetCache.values()];
    evidence.artworkNotObserved = names.filter(n => !evidence.assets.some(a => a.artwork === n));
  }
  async function capture(page, name, { scale = false, frame = null, align = 'center', allowTransient = false, collection = null } = {}) {
    assert(evidence.attempts.length < CAPTURE_LIMIT, 'Bounded capture budget exceeded');
    const file = `${String(evidence.attempts.length + 1).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name, revision: actor?.latestPublic?.revision, scale: scale ? 200 : 100, viewport: page.viewport(), frame, align, allowTransient };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, allowTransient);
      if (scale) { assert(!allowTransient, 'Transient evidence cannot be a font baseline'); attempt.baseline = await enlarge(page); persist(); }
      if (frame) await page.$eval(frame, (n, block) => n.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), align);
      await settle(page); attempt.preCaptureFonts = await page.evaluate(fontSamples); persist();
      await screenshotWithCollection(page, { path: path.join(outputDir, file), fullPage: false }, attempt, collection, persist);
      await page.evaluate(installTextGeometry);
      const post = await page.evaluate(geometry, LAYOUT_IDS); post.fonts = await page.evaluate(fontSamples);
      post.containment = await page.evaluate(measureContainment, NOT_ALONE_CONTAINMENT);
      post.containmentFindings = classifyContainment(post.containment);
      const png = fs.readFileSync(path.join(outputDir, file)), viewport = page.viewport();
      const record = { ...attempt, metrics: post, viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      assert.equal(post.width, viewport.width); assert.equal(post.height, viewport.height);
      assert.equal(record.png.width, viewport.width); assert.equal(record.png.height, viewport.height);
      assert.equal(post.touchPoints > 0, Boolean(viewport.hasTouch)); assert.equal(post.coarse, Boolean(viewport.hasTouch));
      if (scale) validateFonts(post.fonts);
      assert(post.images.every(i => i.complete && i.naturalWidth > 0), 'Captured images must be loaded');
      await assets(post.images);
      const raw = post.clipped.filter(c => c.proof.raw.length);
      if (raw.length) evidence.rawRangeDiagnostics.push({ file, entries: raw });
      const clipped = post.clipped.filter(c => c.visible && !(evidence.calibration?.passed && c.proof.classification === 'proven-whitespace-only'));
      if (clipped.length) evidence.findings.push({ file, kind: 'visible-text-clipping', entries: clipped });
      if (post.containmentFindings.length) evidence.findings.push({ file, kind: 'card-control-containment', entries: post.containmentFindings });
      if (post.documentWidth > post.width + 1) evidence.findings.push({ file, kind: 'page-horizontal-overflow' });
      const small = post.controls.filter(c => c.width < 48 || c.height < 48);
      if (small.length) evidence.findings.push({ file, kind: 'below48-target', controls: small });
      persist(); return record;
    } catch (error) {
      attempt.error = redact(error.message, [...secrets]);
      try { attempt.failureFonts = await page.evaluate(fontSamples); await page.screenshot({ path: path.join(outputDir, 'failure-' + file), fullPage: false }); } catch {}
      persist(); throw error;
    } finally { if (scale) await restore(page); }
  }
  async function calibrate(browser) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(); await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await guardNetwork(page, new Set(), evidence.blockedRequests);
      await page.setContent('<style>body{font:16px Arial}.sample{font:20px/26px monospace;overflow:hidden;margin:20px 0}#positive{width:80px;white-space:nowrap}#wrapped{width:2ch;white-space:pre-wrap}#clear{width:300px}</style><div id="positive" class="sample">Assassinate</div><div id="wrapped" class="sample">AB CD</div><div id="clear" class="sample">Assassinate</div>');
      await settle(page); await page.evaluate(installTextGeometry);
      await page.screenshot({ path: path.join(outputDir, 'geometry-calibration.png'), fullPage: false });
      const samples = await page.evaluate(() => Object.fromEntries(['positive', 'wrapped', 'clear'].map(id => { const n = document.getElementById(id), measured = window.__coupQATextGeometry(n.firstChild); return [id, { geometry: measured, proof: window.__coupQAOverflowProof([measured], n.getBoundingClientRect()) }]; })));
      evidence.calibration = { samples, passed: false }; persist();
      assert.equal(samples.positive.proof.classification, 'non-whitespace-overflow');
      assert.equal(samples.wrapped.proof.classification, 'proven-whitespace-only');
      assert.equal(samples.clear.proof.classification, 'no-overflow');
      await calibrateContainment(page, { ...NOT_ALONE_CONTAINMENT, cardSelector: '[data-testid^="citadels-district-card-"]' }, outputDir, evidence, persist);
      evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { outputDir, evidence, actors, secrets, origins, persist, register, ready, capture, calibrate };
}

async function screenshotWithCollection(page, options, attempt, collection, persist) {
  if (collection) { attempt.collection = { before: await collection.read(page) }; persist(); }
  await page.screenshot(options);
  if (collection) {
    attempt.collection.after = await collection.read(page); persist();
    collection.validate(attempt.collection);
  }
}

module.exports = { createEvidence, MATRIX, CAPTURE_LIMIT, PLACE_ART_BY_ID, LAYOUT_IDS, bundleFence, guardNetwork, local, redact, validateFonts, NOT_ALONE_CONTAINMENT, hasOwnedNotAlonePair, screenshotWithCollection };
