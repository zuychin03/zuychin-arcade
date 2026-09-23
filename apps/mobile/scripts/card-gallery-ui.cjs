const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { bundleFence, local, settle, installTextGeometry } = require('./skull-ui-evidence.cjs');
const { createEvidence } = require('./libertalia-ui-evidence.cjs');
const { persistReceipt, redact, enlargeLibertaliaText, restoreLibertaliaText, readLibertaliaFontState, validateLibertaliaFontState, frameVisibility, assertFrameCoverage } = require('./libertalia-ui-primitives.cjs');
const { readChoiceTarget, stableChoiceSample } = require('./libertalia-ui-choice.cjs');
const REPO = path.resolve(__dirname, '../../..');
const GALLERY = path.join(REPO, 'tools/card-gallery');
const BATCHES = Object.freeze({ first: ['saboteur', 'coup', 'tokyo'], second: ['skull', 'citadels', 'not-alone'], third: ['bang', 'libertalia', 'colt'] });
const PROFILES = Object.freeze([{ name: '320-touch-200', width: 320, touch: true, scale: true }, { name: '375-touch-200', width: 375, touch: true, scale: true }, { name: '1280-fine-100', width: 1280, touch: false, scale: false }, { name: '1280-fine-200', width: 1280, touch: false, scale: true }]);
const DOM_PROFILES = Object.freeze([414, 768].flatMap(width => [false, true].map(scale => ({ name: width + '-dom-' + (scale ? 200 : 100), width, touch: width < 768, scale, domOnly: true }))));
const LIMIT = 72;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function filesIn(root) {
  const boundary = fs.realpathSync(root), active = new Set();
  function walk(directory) {
    const real = fs.realpathSync(directory);
    assert(!active.has(real), 'Cyclic gallery directory');
    active.add(real);
    const files = fs.readdirSync(directory).flatMap(name => {
      const file = path.join(directory, name), directoryEntry = fs.statSync(file).isDirectory();
      if (directoryEntry && ['dist', 'node_modules', '.expo'].includes(name)) return [];
      const relative = path.relative(boundary, fs.realpathSync(file));
      assert(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Gallery file resolves outside scan root');
      return directoryEntry ? walk(file) : [file];
    });
    active.delete(real);
    return files;
  }
  return walk(root).sort();
}
function sourceHashes() {
  const roots = ['apps/mobile/components', 'apps/mobile/hooks', 'apps/mobile/constants', 'apps/mobile/lib', 'apps/mobile/assets', 'packages/types/src', 'apps/mobile/scripts'];
  const files = [...roots.flatMap(root => filesIn(path.join(REPO, root))), ...filesIn(GALLERY), ...['apps/mobile/global.css', 'apps/mobile/babel.config.js', 'apps/mobile/tailwind.config.js', 'apps/mobile/package.json', 'pnpm-lock.yaml'].map(file => path.join(REPO, file))];
  for (const [name, weight] of [['outfit', '400Regular'], ['outfit', '700Bold'], ['outfit', '800ExtraBold'], ['space-mono', '400Regular'], ['space-mono', '700Bold']]) {
    const face = name === 'outfit' ? 'Outfit' : 'SpaceMono'; files.push(require.resolve('@expo-google-fonts/' + name + '/' + weight + '/' + face + '_' + weight + '.ttf'));
  }
  return Object.fromEntries([...new Set(files)].filter(file => !file.endsWith('frozen-source.json')).sort().map(file => [path.relative(REPO, file).replaceAll('\\', '/'), sha(fs.readFileSync(file))]));
}
function exportHashes(root) { return Object.fromEntries(filesIn(root).map(file => [path.relative(root, file).replaceAll('\\', '/'), sha(fs.readFileSync(file))])); }
function config(env) {
  assert.equal(env.CARD_GALLERY_UI_RUN, 'true'); assert.equal(env.CARD_GALLERY_UI_EXCLUSIVE_WINDOW, 'granted');
  assert(Object.hasOwn(BATCHES, env.CARD_GALLERY_BATCH));
  const base = local(env.CARD_GALLERY_URL ?? 'http://127.0.0.1:8083'); assert.equal(base.pathname, '/'); assert(!base.search && !base.hash && !base.username);
  for (const key of ['CARD_GALLERY_OUTPUT', 'CARD_GALLERY_STATIC_ROOT', 'CARD_GALLERY_SOURCE_MANIFEST']) assert(env[key] && path.isAbsolute(env[key]), key + ' must be absolute');
  assert(/^[a-f0-9]{64}$/.test(env.CARD_GALLERY_SHA256 ?? ''));
  const staticRoot = path.resolve(env.CARD_GALLERY_STATIC_ROOT); assert(staticRoot.startsWith(GALLERY + path.sep), 'Only isolated gallery export allowed');
  if (env.CARD_GALLERY_BATCH !== 'first') assert(env.CARD_GALLERY_CALIBRATION_RECEIPT && path.isAbsolute(env.CARD_GALLERY_CALIBRATION_RECEIPT), 'Passed first batch calibration receipt required');
  return { base: base.origin, output: env.CARD_GALLERY_OUTPUT, staticRoot, manifest: env.CARD_GALLERY_SOURCE_MANIFEST, expected: env.CARD_GALLERY_SHA256, calibrationReceipt: env.CARD_GALLERY_CALIBRATION_RECEIPT, batch: env.CARD_GALLERY_BATCH, browser: env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
}
function markTargets() {
  for (const marker of document.querySelectorAll('[id^="gallery-card-marker-"],[id^="gallery-die-marker-"]')) {
    const child = marker.firstElementChild; if (!child?.isConnected) throw Error('Actual component root missing');
    child.setAttribute('data-gallery-target', marker.id.replace('gallery-', '').replace('-marker', ''));
  }
}
function geometry() {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const shown = node => { const css = getComputedStyle(node), r = rect(node); return node.isConnected && css.display !== 'none' && css.visibility === 'visible' && r.width > 0 && r.height > 0; };
  const targets = [...document.querySelectorAll('[data-gallery-target]')].map(node => {
    const faces = [node, ...node.querySelectorAll('*')].filter(child => { const css = getComputedStyle(child); return shown(child) && css.overflow === 'hidden' && parseFloat(css.borderTopLeftRadius) > 0 && css.backgroundColor !== 'rgba(0, 0, 0, 0)' && !child.closest('[aria-hidden="true"]'); }).sort((a, b) => rect(b).width * rect(b).height - rect(a).width * rect(a).height);
    if (!faces.length) throw Error('Real painted component face missing: ' + node.getAttribute('data-gallery-target'));
    const face = faces[0], clipping = [], text = [];
    for (const leaf of [node, ...node.querySelectorAll('*')]) {
      if (!shown(leaf) || /icon|material|fontawesome/i.test(getComputedStyle(leaf).fontFamily)) continue;
      for (const child of leaf.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
        for (let parent = leaf; parent && node.contains(parent); parent = parent.parentElement) {
          const css = getComputedStyle(parent), r = rect(parent);
          if (['hidden', 'clip'].includes(css.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
          if (['hidden', 'clip'].includes(css.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
        }
        const glyphs = window.__coupQATextGeometry(child).glyphRects.filter(glyph => glyph.character.trim());
        const outside = glyphs.filter(glyph => glyph.left < left - 2 || glyph.right > right + 2 || glyph.top < top - 2 || glyph.bottom > bottom + 2);
        text.push(child.textContent.trim()); if (outside.length) clipping.push({ text: child.textContent.trim(), glyphs: outside });
      }
    }
    const controls = [node, ...node.querySelectorAll('[role="button"],button')].filter(item => item.matches('[role="button"],button')).map(item => ({ ...rect(item), disabled: item.disabled || item.getAttribute('aria-disabled') === 'true', label: item.getAttribute('aria-label') }));
    return { id: node.getAttribute('data-gallery-target'), root: rect(node), face: rect(face), text, clipping, controls };
  });
  return { targets, width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints > 0, coarse: matchMedia('(pointer: coarse)').matches, fontReady: document.fonts.status === 'loaded', images: [...document.images].map(image => ({ source: image.currentSrc || image.src, loaded: image.complete && image.naturalWidth > 0 })), actions: document.getElementById('gallery-actions')?.textContent, authenticated: sessionStorage.getItem('za:auth') !== null };
}
function assertGeometry(result) {
  assert(!result.authenticated && result.fontReady); assert(result.images.every(image => image.loaded));
  assert.equal(result.targets.filter(target => target.id.startsWith('card-')).length, 3);
  for (const target of result.targets) { assert.equal(target.clipping.length, 0, 'Text clips: ' + target.id); assert(target.controls.every(control => control.width >= 48 && control.height >= 48), 'Control below48'); }
  for (const kind of ['card-', 'die-']) {
    const group = result.targets.filter(target => target.id.startsWith(kind));
    for (const target of group) {
      assert(Math.abs(target.face.width - group[0].face.width) <= 2, 'Same-role painted widths differ');
      for (const other of group) if (Math.abs(target.root.top - other.root.top) <= 8) assert(Math.abs(target.face.height - other.face.height) <= 2, 'Same-row painted heights differ');
    }
  }
}
function assertStable(before, after) {
  assert.deepEqual(before.targets.map(item => item.id), after.targets.map(item => item.id), 'Mounted card inventory changed during capture');
  for (let index = 0; index < before.targets.length; index++) for (const kind of ['root', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    assert(Math.abs(before.targets[index][kind][axis] - after.targets[index][kind][axis]) <= 0.5, 'Painted geometry changed during capture');
  }
}
function rowFits(result) {
  const cards = result.targets.filter(target => target.id.startsWith('card-'));
  return cards.every(target => target.root.left >= -2 && target.root.right <= result.width + 2 && Math.abs(target.root.top - cards[0].root.top) <= 8 && target.root.height <= result.height * 2 - 24);
}
async function authState(page, base) {
  if (!page || page.url() === 'about:blank') return { authClear: true, notNavigated: true };
  assert.equal(new URL(page.url()).origin, base, 'Unexpected cleanup origin');
  return { authClear: await page.evaluate(() => sessionStorage.getItem('za:auth') === null), notNavigated: false };
}
function calibrationBrowser(context) {
  let page;
  return { createBrowserContext: async () => ({
    newPage: async () => { page = await context.newPage(); return page; },
    close: async () => { if (page) await page.close(); },
  }) };
}
async function activate(page, selector, touch, disabled) {
  await page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); await settle(page);
  const handle = await page.$(selector); assert(handle);
  try {
    if (disabled) {
      const box = await handle.boundingBox(); assert(box);
      assert(await handle.evaluate(node => node.disabled || node.getAttribute('aria-disabled') === 'true'));
      if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      const label = await handle.evaluate(node => node.getAttribute('aria-label')); let previous, stable = 0;
      for (let count = 0; count < 100; count++) { const current = await page.evaluate(readChoiceTarget, { selector, label }); stable = stableChoiceSample(previous, current) ? stable + 1 : 0; previous = current; if (stable >= 3) break; await pause(60); }
      assert(stable >= 3, 'Stable enabled actual control required');
      assert(await handle.evaluate((node, target) => node === document.querySelector(target) && node.isConnected, selector));
      assert(stableChoiceSample(previous, await page.evaluate(readChoiceTarget, { selector, label })));
      if (touch) await handle.tap(); else await handle.click();
    }
  } finally { await handle.dispose(); }
}
function passed(evidence) { return Boolean(evidence.complete && evidence.frozen && evidence.calibration?.passed && evidence.browserClosed && evidence.cleanup.length === 2 && evidence.cleanup.every(item => item.closed && item.authClear && !item.error) && !evidence.failure && !evidence.blocked.length && !evidence.errors.length && evidence.frames.length <= LIMIT && evidence.cases.length === 24); }
async function frozenBundle(c) {
  const bundle = await bundleFence(c.base, c.staticRoot, c.expected);
  const response = await fetch(c.base, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200);
  const htmlHash = sha(await response.text()); assert.equal(htmlHash, sha(fs.readFileSync(path.join(c.staticRoot, 'index.html'))), 'Served HTML differs from gallery export');
  return { ...bundle, htmlHash };
}

async function main() {
  if (process.argv.includes('--freeze')) {
    const file = path.join(GALLERY, 'frozen-source.json'); assert(!fs.existsSync(file), 'Preserve prior source manifest; archive it explicitly before a new build');
    persistReceipt(GALLERY, 'frozen-source.json', { sourceHashes: sourceHashes(), createdAt: new Date().toISOString(), method: 'QA-only component export input fence' }, new Set()); return;
  }
  const c = config(process.env); assert(!fs.existsSync(c.output), 'Preserve failed and completed evidence'); fs.mkdirSync(c.output, { recursive: true });
  const evidence = { scope: 'Real production components; neutral rails are not route-parent evidence. No authentication, sockets or room operations. CSS200 is not native fontScale or physical-device evidence.', batch: c.batch, limit: LIMIT, cases: [], frames: [], blocked: [], errors: [], cleanup: [], assets: [], browserClosed: false };
  const persist = () => persistReceipt(c.output, 'receipt.json', evidence, new Set());
  const actors = [], pendingAssets = new Set(); let browser, watchdog;
  try {
    evidence.source = sourceHashes(); assert.deepEqual(evidence.source, JSON.parse(fs.readFileSync(c.manifest, 'utf8')).sourceHashes, 'Gallery source differs from pre-export manifest');
    evidence.export = exportHashes(c.staticRoot); evidence.bundle = await frozenBundle(c);
    if (c.calibrationReceipt) { const receipt = fs.readFileSync(c.calibrationReceipt), earlier = JSON.parse(receipt); assert(earlier.passed && earlier.batch === 'first' && earlier.calibration?.passed); assert.deepEqual(earlier.source, evidence.source); assert.deepEqual(earlier.bundle, evidence.bundle); evidence.calibration = { passed: true, sourceReceipt: c.calibrationReceipt, sha256: sha(receipt), reusedFirstBatchControls: true }; }
    persist();
    browser = await puppeteer.launch({ executablePath: c.browser, headless: true, args: ['--disable-dev-shm-usage'] });
    watchdog = setTimeout(() => { evidence.failure ??= 'Bounded20minute watchdog'; persist(); void browser.close(); }, 20 * 60_000);
    for (const touch of [true, false]) {
      const context = await browser.createBrowserContext(), actor = { context, touch }; actors.push(actor);
      if (touch && c.batch === 'first') {
        const qa = createEvidence({ outputDir: c.output, base: c.base, api: c.base });
        await qa.calibrate(calibrationBrowser(context)); evidence.calibration = qa.evidence.calibration;
      }
      actor.page = await context.newPage();
      await actor.page.setViewport({ width: touch ? 375 : 1280, height: 844, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
      await actor.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await actor.page.setRequestInterception(true);
      actor.page.on('request', request => {
        const url = new URL(request.url()); const allowed = ['GET', 'HEAD'].includes(request.method()) && (url.origin === c.base || ['data:', 'blob:', 'about:'].includes(url.protocol)) && !/rooms|socket\.io/.test(url.pathname);
        if (allowed) void request.continue().catch(() => {}); else { evidence.blocked.push({ origin: url.origin, path: url.pathname, method: request.method() }); void request.abort().catch(() => {}); }
      });
      actor.page.on('response', response => {
        const job = (async () => {
          const url = new URL(response.url()); if (url.origin !== c.base || response.request().resourceType() === 'document') return;
          assert(response.ok(), 'Gallery asset failed: ' + url.pathname + ' HTTP ' + response.status()); const disk = path.resolve(c.staticRoot, '.' + decodeURIComponent(url.pathname)); assert(disk.startsWith(c.staticRoot + path.sep));
          const servedHash = sha(await response.buffer()), diskHash = sha(fs.readFileSync(disk)); assert.equal(servedHash, diskHash);
          if (!evidence.assets.some(asset => asset.path === url.pathname)) evidence.assets.push({ path: url.pathname, servedHash, diskHash });
        })().catch(error => { evidence.errors.push(redact(error.message)); }).finally(() => pendingAssets.delete(job)); pendingAssets.add(job);
      });
      actor.page.on('pageerror', error => evidence.errors.push(redact(error.message)));
      actor.page.on('console', message => { if (['error', 'warning'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) evidence.errors.push(redact(message.text())); });
    }
    for (const family of BATCHES[c.batch]) for (const profile of [...PROFILES, ...DOM_PROFILES]) {
      const actor = actors.find(actor => actor.touch === profile.touch), page = actor.page;
      await page.setViewport({ ...page.viewport(), width: profile.width }); await page.goto(c.base + '/?family=' + family, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected => document.getElementById('gallery-ready')?.textContent === expected && document.fonts.status === 'loaded', {}, family); await settle(page); await page.evaluate(installTextGeometry); await page.evaluate(markTargets);
      try {
        if (profile.scale) await enlargeLibertaliaText(page); await settle(page); await page.evaluate(markTargets);
        const measurements = await page.evaluate(geometry);
        const caseEvidence = { family, profile, scope: ['bang', 'libertalia', 'tokyo', 'coup', 'colt'].includes(family) ? 'Production collection in QA scene, not authenticated route' : 'Neutral component rail only', measurements, proofs: [], actions: [] }; evidence.cases.push(caseEvidence); persist();
        assertGeometry(measurements); assert.equal(measurements.touch, profile.touch); assert.equal(measurements.coarse, profile.touch);
        assert.equal(measurements.targets.filter(target => target.id.startsWith('die-')).length, family === 'tokyo' ? 3 : 0, 'Exact additional die inventory required');
        const selectors = profile.domOnly ? [] : rowFits(measurements) ? ['#gallery-collection'] : [0, 1, 2].map(index => '[data-gallery-target="card-' + index + '"]');
        if (family === 'tokyo' && !profile.domOnly) selectors.push(...[0, 1, 2].map(index => '[data-gallery-target="die-' + index + '"]'));
        for (const selector of selectors) {
          const records = [];
          for (const align of ['start', 'end']) {
            assert(evidence.frames.length < LIMIT, 'Finite gallery batch capture ceiling');
            await page.$eval(selector, (node, block) => node.scrollIntoView({ block, inline: 'center', behavior: 'instant' }), align); await settle(page);
            const current = await page.evaluate(geometry); assertGeometry(current); if (profile.scale) validateLibertaliaFontState(await page.evaluate(readLibertaliaFontState));
            const metrics = { frame: await page.$eval(selector, node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }), frameVisibleBounds: await page.$eval(selector, frameVisibility) };
            const file = String(evidence.frames.length + 1).padStart(3, '0') + '-' + family + '-' + profile.name + '.png';
            await page.screenshot({ path: path.join(c.output, file), fullPage: false }); const png = fs.readFileSync(path.join(c.output, file)); assert.equal(png.readUInt32BE(16), profile.width); assert.equal(png.readUInt32BE(20), 844);
            const post = await page.evaluate(geometry); assertGeometry(post); assertStable(current, post);
            const fonts = profile.scale ? await page.evaluate(readLibertaliaFontState) : null; if (fonts) validateLibertaliaFontState(fonts);
            const record = { file, selector, align, metrics, current, post, fonts }; records.push(record); evidence.frames.push(record); persist();
            try { caseEvidence.proofs.push(assertFrameCoverage(records)); break; } catch (error) { if (align === 'end') throw error; }
          }
        }
        for (const index of [0, 1, 2]) {
          const selector = '[data-gallery-target="card-' + index + '"]';
          await page.$eval(selector, node => { const control = node.matches('[role="button"],button') ? node : node.querySelector('[role="button"],button'); if (!control) throw Error('Actual local action missing'); control.setAttribute('data-gallery-action', 'current'); });
          const before = await page.$eval('#gallery-actions', node => node.textContent); await activate(page, '[data-gallery-action="current"]', profile.touch, index === 2); await settle(page);
          const after = await page.$eval('#gallery-actions', node => node.textContent); assert.deepEqual(JSON.parse(after), index === 2 ? JSON.parse(before) : [...JSON.parse(before), index]);
          await page.$eval('[data-gallery-action="current"]', node => node.removeAttribute('data-gallery-action')); caseEvidence.actions.push({ index, disabled: index === 2, before: JSON.parse(before), after: JSON.parse(after), oneRealInput: true });
        }
        if (profile.scale) validateLibertaliaFontState(await page.evaluate(readLibertaliaFontState)); persist();
      } finally { if (profile.scale) await restoreLibertaliaText(page); }
    }
    assert.equal(evidence.cases.length, 24); assert(evidence.cases.every(row => (row.profile.domOnly || row.proofs.length) && row.actions.length === 3)); evidence.complete = true;
  } catch (error) { evidence.failure = redact(error.stack ?? error.message); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    await Promise.allSettled([...pendingAssets]);
    for (const actor of actors) { const row = { touch: actor.touch, authClear: false, closed: false }; try { Object.assign(row, await authState(actor.page, c.base)); } catch (error) { row.error = redact(error.message); } try { await actor.context.close(); row.closed = true; } catch (error) { row.error = redact(error.message); } evidence.cleanup.push(row); }
    try { if (browser) { await browser.close(); evidence.browserClosed = true; } } catch (error) { evidence.failure ??= redact(error.message); }
    try { evidence.finalSource = sourceHashes(); assert.deepEqual(evidence.finalSource, evidence.source); evidence.finalExport = exportHashes(c.staticRoot); assert.deepEqual(evidence.finalExport, evidence.export); evidence.finalBundle = await frozenBundle(c); assert.deepEqual(evidence.finalBundle, evidence.bundle); evidence.frozen = true; } catch (error) { evidence.failure ??= redact(error.message); }
    evidence.passed = passed(evidence); persist();
  }
  console.log(JSON.stringify({ passed: evidence.passed, frames: evidence.frames.length, output: c.output })); if (!evidence.passed) process.exitCode = 1;
}
module.exports = { BATCHES, PROFILES, DOM_PROFILES, LIMIT, config, sourceHashes, exportHashes, assertGeometry, assertStable, rowFits, passed, geometry, markTargets, authState, calibrationBrowser };
if (require.main === module) main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
