const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { bundleFence, guardNetwork, local, validateFonts, installTextGeometry, redact, enlarge, restore, settle, measureContainment, classifyContainment, calibrateContainment } = require('./skull-ui-evidence.cjs');

const MATRIX = [[320, 780], [375, 844], [414, 896], [768, 900], [1280, 900], [844, 390]];
const CATEGORIES = ['noble', 'religious', 'trade', 'military', 'unique'];
const LAYOUT_IDS = ['citadels-toolbar', 'citadels-play-area', 'citadels-decision-area', 'citadels-decision-heading', 'citadels-hand', 'citadels-draft', 'citadels-income', 'citadels-cities', 'citadels-roster', 'citadels-completion-banner', 'citadels-result-summary', 'citadels-result-actions', 'citadels-result-roster', 'citadels-game-over'];
const CITADELS_CONTAINMENT = { game: 'citadels', cardSelector: '[data-testid^="citadels-district-card-"],[data-testid^="citadels-role-card-"]', decisionId: 'citadels-decision-area', headingId: 'citadels-decision-heading', siblingIds: ['citadels-cities', 'citadels-roster'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fontSamples = () => (window.__skullText ?? []).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));

function publicPrivacy(state) {
  const forbidden = ['hand', 'chosenRole', 'availableRoles', 'drawnCards', 'legalBuildCardIds', 'effectiveBuildCosts', 'role'];
  return [state, ...(state?.players ?? [])].flatMap((object, index) => forbidden.filter(key => object && Object.hasOwn(object, key)).map(key => ({ scope: index ? 'public-player' : 'public-state', key })));
}

function measureFrame({ selector, expectedText }) {
  const node = document.querySelector(selector);
  if (!node) return { selector, missing: true };
  const rect = n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const bounds = rect(node), visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight }, ancestors = [];
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), box = rect(parent);
    if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { visible.left = Math.max(visible.left, box.left); visible.right = Math.min(visible.right, box.right); }
    if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { visible.top = Math.max(visible.top, box.top); visible.bottom = Math.min(visible.bottom, box.bottom); }
    if (parent.scrollHeight > parent.clientHeight) ancestors.push({ id: parent.id, scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight });
  }
  const css = getComputedStyle(node);
  return { selector, text: node.textContent, expectedText, bounds, visible, ancestors,
    matches: node.textContent.includes(expectedText),
    fullyFramed: css.visibility === 'visible' && Number(css.opacity) > 0 && bounds.right > bounds.left && bounds.bottom > bounds.top && bounds.left >= visible.left - 1 && bounds.right <= visible.right + 1 && bounds.top >= visible.top - 1 && bounds.bottom <= visible.bottom + 1 };
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
      let printedCategory = null;
      for (let owner = n; owner && !printedCategory; owner = owner.parentElement) printedCategory = owner.getAttribute('aria-label')?.match(/, (noble|religious|trade|military|unique) district\./)?.[1] ?? null;
      return { source: /^(https?:)/.test(n.currentSrc || n.src) ? new URL(n.currentSrc || n.src).pathname : 'inline', complete: n.complete, naturalWidth: n.naturalWidth, printedCategory, ...rect(n) };
    }) };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const actors = new Map(), secrets = new Set(), assetCache = new Map();
  const evidence = { method: 'Four automated own-view legal browser policies. Not independent manual choices, native fontScale or physical-device evidence.', captures: [], attempts: [], findings: [], rawRangeDiagnostics: [], blockedRequests: [], cleanup: [], gaps: [], browserClosed: false };
  const persist = () => { fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(path.join(outputDir, 'receipt.json'), redact(evidence, [...secrets]) + '\n'); };
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, allowTransient = false) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (/\/citadels\/(game|lobby)$/.test(new URL(page.url()).pathname)) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      if (auth?.token) { secrets.add(auth.token); actor.auth = auth; }
      if (!allowTransient) {
        assert(auth?.token && auth.playerId && auth.roomCode, 'Own room authentication required');
        await page.waitForFunction(() => !/Reconnecting|Refreshing|Retry connection/i.test(document.body.innerText), { timeout: 10000 });
        const until = Date.now() + 10000;
        const paired = () => page.url().endsWith('/game')
          ? actor.private?.playerId === auth.playerId && actor.private?.roomCode === auth.roomCode && actor.public?.roomCode === auth.roomCode && actor.public?.revision === actor.private?.revision
          : actor.room?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft);
        while (!paired() && Date.now() < until) await pause(50);
        assert(paired(), 'Capture requires owned paired game or connected lobby state');
        assert.deepEqual(publicPrivacy(actor.public), [], 'Public projection contains private card or role fields');
        if (page.url().endsWith('/game')) await page.waitForFunction(() => Boolean(document.getElementById('citadels-decision-heading') || document.getElementById('citadels-game-over')), { timeout: 10000 });
      }
    }
    await settle(page);
  }
  async function assets(images) {
    const root = path.resolve(process.env.QA_STATIC_ROOT), sources = path.resolve(__dirname, '../assets/game-art');
    const names = ['citadels-cover', 'citadels-hero', ...CATEGORIES.map(c => `citadels-district-${c}`)];
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
      if (image.printedCategory && image.artwork?.startsWith('citadels-district-')) assert.equal(image.artwork, `citadels-district-${image.printedCategory}`, 'Category artwork must follow printed district colour');
    }
    evidence.assets = [...assetCache.values()];
    evidence.artworkNotObserved = names.filter(n => !evidence.assets.some(a => a.artwork === n));
  }
  async function capture(page, name, { scale = false, frame = null, align = 'center', allowTransient = false, expectedText = null } = {}) {
    assert(evidence.attempts.length < 125, 'Bounded capture budget exceeded');
    const file = `${String(evidence.attempts.length + 1).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name, revision: actor?.public?.revision, scale: scale ? 200 : 100, viewport: page.viewport(), allowTransient };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, allowTransient);
      if (scale) { assert(!allowTransient, 'Transient evidence cannot be a font baseline'); attempt.baseline = await enlarge(page); persist(); }
      if (frame) await page.$eval(frame, (n, block) => n.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), align);
      await settle(page); attempt.preCaptureFonts = await page.evaluate(fontSamples); persist();
      await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
      await page.evaluate(installTextGeometry);
      const post = await page.evaluate(geometry, LAYOUT_IDS); post.fonts = await page.evaluate(fontSamples);
      if (expectedText !== null) post.requiredFrame = await page.evaluate(measureFrame, { selector: frame, expectedText });
      post.containment = await page.evaluate(measureContainment, CITADELS_CONTAINMENT);
      post.containmentFindings = classifyContainment(post.containment);
      const png = fs.readFileSync(path.join(outputDir, file)), viewport = page.viewport();
      const record = { ...attempt, metrics: post, viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      if (post.requiredFrame) assert(post.requiredFrame.matches && post.requiredFrame.fullyFramed, 'Required exact text must be fully framed after capture');
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
      await calibrateContainment(page, CITADELS_CONTAINMENT, outputDir, evidence, persist);
      evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { evidence, actors, secrets, origins, persist, register, ready, capture, calibrate };
}

module.exports = { createEvidence, MATRIX, CATEGORIES, LAYOUT_IDS, bundleFence, guardNetwork, local, redact, validateFonts, publicPrivacy, CITADELS_CONTAINMENT, measureFrame };
