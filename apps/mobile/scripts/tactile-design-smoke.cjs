const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');

const base = new URL(process.env.QA_WEB_URL ?? 'http://127.0.0.1:8081');
const api = new URL(process.env.QA_API_URL ?? 'https://localhost:3214');
const expected = process.env.QA_EXPECTED_WEB_SHA256;
const exportRoot = path.resolve(process.env.QA_STATIC_ROOT ?? path.join(__dirname, '../.expo-export-qa-web'));
const output = path.resolve(process.env.QA_TACTILE_OUTPUT ?? path.join(__dirname, '../../../.tmp-qa-evidence/2026-09-22/tactile-pilot', new Date().toISOString().replaceAll(/[:.]/g, '-')));
const widths = [320, 375, 414, 768, 1280];
const supplement = process.env.QA_TACTILE_SUPPLEMENT === '1';
const continuation = process.env.QA_TACTILE_CONTINUATION === '1';
const skipHub375 = process.env.QA_TACTILE_SKIP_HUB375 === '1';
const receipt = { method: 'Real compiled web, isolated Chrome context. Hub and Saboteur entrance/form only; not a full game or native-device test.', widths, captures: [], keyboard: [], blockedRequests: [], errors: [], cleanup: [], passed: false };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const loopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const allowedOrigins = new Set([base.origin, api.origin]);
let auth;
const transactions = new Set();

async function verifyBundle() {
  assert(loopback(base) && loopback(api), 'Only loopback app origins are permitted');
  assert(/^[a-f0-9]{64}$/i.test(expected ?? ''), 'QA_EXPECTED_WEB_SHA256 is required');
  const response = await fetch(base, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert(response.ok, 'Served hub HTTP ' + response.status);
  const html = await response.text();
  const entry = html.match(/(?:src=["'])([^"']*\/_expo\/static\/js\/web\/(?:index|entry)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Served compiled entry not found');
  const url = new URL(entry, base);
  assert(url.origin === base.origin, 'Bundle must come from the same export');
  const bundle = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert(bundle.ok, 'Bundle HTTP ' + bundle.status);
  const servedHash = hash(new Uint8Array(await bundle.arrayBuffer()));
  const diskPath = path.join(exportRoot, '_expo/static/js/web', path.basename(url.pathname));
  const diskHash = hash(fs.readFileSync(diskPath));
  receipt.bundle = { entry: url.pathname, servedHash, diskHash, expected };
  assert(servedHash === expected && diskHash === expected, 'Served/disk/expected bundle mismatch');
}

async function button(page, name) {
  for (const handle of await page.$$('[role="button"],button,a')) {
    if (await handle.evaluate((node, label) => {
      const r = node.getBoundingClientRect();
      return (node.getAttribute('aria-label') ?? node.textContent).trim() === label && r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]');
    }, name)) return handle;
    await handle.dispose();
  }
  throw new Error('Missing accessible control: ' + name);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
  });
  await pause(700);
}

async function verifyTouch(page, stage) {
  const sample = async () => ({ ...await page.evaluate(() => ({ maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer: coarse)').matches, viewportWidth: innerWidth })), viewport: page.viewport() });
  const valid = flags => flags.maxTouchPoints > 0 && flags.coarsePointer && flags.viewportWidth === 375 && flags.viewport?.hasTouch === true && flags.viewport?.isMobile === true;
  const probe = { stage, before: await sample(), restorationAttempted: false };
  receipt.touch.probes.push(probe);
  if (!valid(probe.before)) {
    probe.restorationAttempted = true;
    await page.setViewport({ ...page.viewport(), width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await settle(page);
    probe.afterRestoration = await sample();
  }
  probe.passed = valid(probe.afterRestoration ?? probe.before);
  assert(probe.passed, 'Touch/mobile emulation unavailable at ' + stage);
  return probe;
}

async function inspect(page, scope) {
  return page.evaluate(async selector => {
    const root = document.querySelector(selector);
    if (!root) throw new Error('Missing inspection scope: ' + selector);
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const visible = node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !node.closest('[aria-hidden="true"]'); };
    const clipped = [];
    const texts = [];
    for (const node of root.querySelectorAll('*')) {
      if (!visible(node) || /icon|material|fontawesome/i.test(getComputedStyle(node).fontFamily)) continue;
      const direct = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      if (!direct.length) continue;
      const boxes = direct.flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()]; });
      const text = direct.map(child => child.textContent).join('').trim().slice(0, 180);
      texts.push({ text, bounds: rect(node), fontSize: getComputedStyle(node).fontSize });
      let scrollBoundaryY = false;
      for (let ancestor = node; ancestor && root.contains(ancestor); ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
        if (['auto', 'scroll'].includes(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) scrollBoundaryY = true;
        const x = ['hidden', 'clip'].includes(style.overflowX), y = !scrollBoundaryY && ['hidden', 'clip'].includes(style.overflowY);
        if (boxes.some(r => (x && (r.left < bounds.left - 2 || r.right > bounds.right + 2)) || (y && (r.top < bounds.top - 2 || r.bottom > bounds.bottom + 2)))) {
          clipped.push({ text, ancestor: ancestor.id || ancestor.tagName, bounds: rect(ancestor), axis: { x, y } }); break;
        }
      }
    }
    const artSelector = selector === '#arcade-game-library' ? '#game-cover-saboteur' : '#saboteur-entrance-art';
    const artwork = document.querySelector(artSelector);
    const images = [...root.querySelectorAll('img')].filter(image => image.getBoundingClientRect().width > 0).map(image => ({ src: new URL(image.currentSrc || image.src).pathname, loaded: image.complete && image.naturalWidth > 0, naturalWidth: image.naturalWidth, bounds: rect(image), targetArtwork: !!artwork?.contains(image) }));
    const backgrounds = [];
    for (const node of [root, ...root.querySelectorAll('*')]) {
      const background = getComputedStyle(node).backgroundImage;
      for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const url = new URL(match[1], location.href);
        const loaded = await new Promise(resolve => {
          const image = new Image(), timeout = setTimeout(() => resolve(false), 10000);
          const finish = value => { clearTimeout(timeout); resolve(value); };
          image.onload = () => finish(true); image.onerror = () => finish(false); image.src = url.href;
        });
        backgrounds.push({ src: url.protocol === 'data:' ? 'data:image' : url.pathname, loaded, targetArtwork: !!artwork?.contains(node) });
      }
    }
    const controls = [...root.querySelectorAll('button,[role="button"],input,a')].filter(visible).map(node => ({ label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 120), bounds: rect(node) }));
    let form = root.querySelector('input[aria-label="Your name"]')?.parentElement;
    while (form && !form.querySelector('input[aria-label="Room password, optional"]')) form = form.parentElement;
    const formControls = form ? [...form.querySelectorAll('input,button,[role="button"]')].filter(visible).map(node => ({ label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 120), bounds: rect(node) })) : [];
    const animations = document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({ iterations: animation.effect?.getTiming().iterations, duration: animation.effect?.getTiming().duration }));
    const capturedScaling = (globalThis.__qaTextScaleSamples ?? []).map(({ node, size, text }) => ({ text, currentText: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80), before: size, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected }));
    const formBounds = form ? { bounds: rect(form), paddingBottom: getComputedStyle(form).paddingBottom, borderBottomWidth: getComputedStyle(form).borderBottomWidth, borderBottomLeftRadius: getComputedStyle(form).borderBottomLeftRadius } : null;
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, scope: rect(root), targetArtwork: artwork ? { id: artwork.id, bounds: rect(artwork), loadedSources: [...images, ...backgrounds].filter(image => image.targetArtwork && image.loaded).length } : null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, clipped, texts, images, backgrounds, controls, formControls, formBounds, animations, capturedScaling };
  }, scope);
}

async function capture(page, name, width, scope, height = 900, framing = 'top') {
  if (page.viewport()?.width !== width || page.viewport()?.height !== height) await page.setViewport({ ...page.viewport(), width, height, deviceScaleFactor: 1 });
  await settle(page);
  await page.evaluate(({ selector, framing }) => {
    window.scrollTo(0, 0);
    for (const node of document.querySelectorAll('*')) {
      if (node.scrollTop || node.scrollLeft) { node.scrollTop = 0; node.scrollLeft = 0; }
    }
    if (framing === 'library-bottom') {
      const controls = document.querySelector(selector)?.querySelectorAll('[role="button"],button,a');
      controls?.[controls.length - 1]?.scrollIntoView({ block: 'end', inline: 'nearest' });
    }
    if (framing === 'form-start') {
      let form = document.querySelector('input[aria-label="Your name"]')?.parentElement;
      while (form && !form.querySelector('input[aria-label="Room password, optional"]')) form = form.parentElement;
      form?.scrollIntoView({ block: 'start', inline: 'nearest' });
    }
  }, { selector: scope, framing });
  await settle(page);
  const metrics = await inspect(page, scope);
  const filename = name + '-' + width + '.png';
  const touchCapture = name.endsWith('-touch');
  const snapshotMode = 'viewport';
  await page.screenshot({ path: path.join(output, filename), fullPage: false });
  metrics.scalingAfterScreenshot = await page.evaluate(() => (globalThis.__qaTextScaleSamples ?? []).map(({ node, size, text }) => ({ text, currentText: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80), before: size, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected })));
  receipt.captures.push({ filename, framing, snapshotMode, note: 'Current viewport only; all scope descendants are measured separately, with additional explicit scrolled frames where labelled.', metrics });
  if (touchCapture) await verifyTouch(page, 'after capture ' + filename);
  if (name.includes('text200')) assert(metrics.capturedScaling.length > 0 && [...metrics.capturedScaling, ...metrics.scalingAfterScreenshot].every(item => item.connected && item.currentText === item.text && Number.isFinite(item.after) && Math.abs(item.after / item.before - 2) < 0.01), name + ': captured DOM lost 200% enlargement');
  assert(metrics.documentWidth <= width + 1, name + ': horizontal page overflow');
  assert(metrics.clipped.length === 0, name + ': clipped text, see receipt');
  assert(metrics.images.every(image => image.loaded) && metrics.backgrounds.every(image => image.loaded), name + ': unloaded image');
  assert(metrics.targetArtwork?.bounds.width > 0 && metrics.targetArtwork.bounds.height > 0 && metrics.targetArtwork.loadedSources > 0, name + ': expected Saboteur artwork absent or fallback-only');
  const cover = metrics.targetArtwork.bounds;
  assert(metrics.images.filter(image => image.targetArtwork).every(image => image.bounds.width <= cover.width + 1 && image.bounds.height <= cover.height + 1 && image.bounds.x >= cover.x - 1 && image.bounds.y >= cover.y - 1 && image.bounds.x + image.bounds.width <= cover.x + cover.width + 1 && image.bounds.y + image.bounds.height <= cover.y + cover.height + 1), name + ': intrinsic image exceeds artwork container');
  if (scope === '#arcade-game-library') {
    assert(metrics.controls.every(control => control.bounds.width >= 44 && control.bounds.height >= 44), name + ': library control below 44px');
    assert(metrics.images.length + metrics.backgrounds.length > 0, name + ': no rendered cover artwork found');
  } else {
    assert(metrics.formControls.length >= 5, name + ': entrance form controls not found');
    assert(metrics.formControls.every(control => control.bounds.width >= 44 && control.bounds.height >= 44), name + ': entrance form control below 44px');
  }
  assert(metrics.reducedMotion, 'Reduced-motion preference not applied');
  assert(!metrics.animations.some(animation => animation.iterations === Infinity), name + ': infinite animation under reduced motion');
}

async function enlargeText(page) {
  return page.evaluate(async () => {
    const candidates = [...document.querySelectorAll('body *')].filter(node => node.matches('input,textarea') || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()));
    const exclusions = {}, excludedSamples = [], values = [];
    for (const node of candidates) {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect(), size = parseFloat(style.fontSize);
      const reason = node.closest('[aria-hidden="true"]') ? 'aria-hidden-ancestor'
        : style.display === 'none' ? 'display-none'
        : style.visibility === 'hidden' || style.visibility === 'collapse' ? 'visibility-hidden'
        : bounds.width <= 0 || bounds.height <= 0 ? 'non-positive-bounds'
        : !Number.isFinite(size) || size <= 0 ? 'non-positive-or-non-finite-font-size'
        : /icon|material|fontawesome/i.test(style.fontFamily) ? 'icon-glyph' : null;
      const text = node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80);
      if (reason) { exclusions[reason] = (exclusions[reason] ?? 0) + 1; excludedSamples.push({ text, reason, fontSize: style.fontSize, width: bounds.width, height: bounds.height }); continue; }
      values.push({ node, size, line: parseFloat(style.lineHeight), text });
    }
    const sheet = document.createElement('style');
    sheet.id = 'qa-text-enlargement';
    sheet.textContent = values.map(({ node, size, line }, index) => {
      node.dataset.qaTextScaleId = String(index);
      return `[data-qa-text-scale-id="${index}"] { font-size: ${size * 2}px !important; ${Number.isFinite(line) ? `line-height: ${line * 2}px !important;` : ''} }`;
    }).join('\n');
    document.head.appendChild(sheet);
    globalThis.__qaTextScaleSamples = values;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 100));
    return { method: 'Scoped QA stylesheet with important font-size and numeric line-height rules', candidates: candidates.length, excludedCount: excludedSamples.length, exclusions, excludedSamples, samples: values.map(({ node, size, text }) => ({ text, currentText: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80), connected: node.isConnected, before: size, after: parseFloat(getComputedStyle(node).fontSize) })) };
  });
}

async function configurePage(page) {
  page.setDefaultTimeout(10000);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (allowedOrigins.has(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol)) void request.continue();
    else { receipt.blockedRequests.push({ origin: url.origin, type: request.resourceType() }); void request.abort(); }
  });
  page.on('pageerror', error => receipt.errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') receipt.errors.push({ type: 'console', message: message.text() }); });
  page.on('response', response => {
    const url = new URL(response.url());
    if (allowedOrigins.has(url.origin) && response.request().method() === 'POST' && /\/rooms\/(?:create|join)$/.test(url.pathname) && response.ok()) {
      const pending = response.json().then(body => { if (body.token && body.roomCode) auth = { token: body.token, roomCode: body.roomCode }; }).catch(() => { receipt.cleanup.push({ uncertain: true, reason: 'Could not read room response' }); });
      transactions.add(pending); void pending.finally(() => transactions.delete(pending));
    }
  });
}

async function main() {
  assert(!fs.existsSync(path.join(output, 'receipt.json')), 'Use a fresh evidence directory');
  fs.mkdirSync(output, { recursive: true });
  let browser, page;
  try {
    await verifyBundle();
    assert(!continuation || supplement, 'Continuation requires supplemental mode');
    if (supplement) {
      const priorPath = path.resolve(process.env.QA_TACTILE_PRIOR_RECEIPT ?? '.tmp-qa-evidence/2026-09-22/tactile-pilot/candidate02/receipt.json');
      const prior = JSON.parse(fs.readFileSync(priorPath, 'utf8'));
      assert(prior.bundle.servedHash === expected && prior.bundle.diskHash === expected && prior.browserClosed, 'Supplement must use the same candidate with prior browser closed');
      receipt.supplements = { receipt: priorPath, sha256: hash(fs.readFileSync(priorPath)), previousPassed: prior.passed, coverage: continuation ? 'Missing 1280px entrance enlargement, landscape and touch only; previous successful cases retained.' : 'Missing enlarged-text, landscape and touch checks only; normal-width evidence is retained in the prior receipt.', skipPreviouslyVerifiedHub375: skipHub375 };
    }
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--disable-background-networking', '--no-first-run', '--ignore-certificate-errors-spki-list=' + (process.env.QA_BROWSER_CERT_SPKI ?? '3WH+FsQdhq9y2sxr1wApDTL2GeLGFO7B0aVanIXZQW4=')] });
    const context = await browser.createBrowserContext(); page = await context.newPage();
    await configurePage(page);
    if (!supplement) {
    await page.goto(base.href, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#arcade-game-library');
    for (const width of widths) await capture(page, 'hub', width, '#arcade-game-library');
    await capture(page, 'hub-last-row', 375, '#arcade-game-library', 900, 'library-bottom');
    const tile = await page.$('#game-tile-saboteur'); assert(tile, 'Missing stable Saboteur tile ID');
    await tile.focus(); await page.keyboard.press('Tab'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    const tileFocused = await tile.evaluate(node => document.activeElement === node);
    receipt.keyboard.push({ check: 'Saboteur tile Tab return', passed: tileFocused }); assert(tileFocused, 'Tile not reachable through keyboard Tab');
    await page.keyboard.press('Enter'); await tile.dispose();
    await page.waitForFunction(() => location.pathname.replace(/\/$/, '') === '/saboteur');
    await page.waitForSelector('input[aria-label="Your name"]');
    for (const width of widths) await capture(page, 'saboteur-entrance-form', width, 'main, [role="main"], body');
    const name = await page.$('input[aria-label="Your name"]'); await name.focus(); await page.keyboard.press('Enter');
    const passwordFocused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional');
    receipt.keyboard.push({ check: 'Name Enter moves to password', passed: passwordFocused }); assert(passwordFocused, 'Form keyboard chain failed');
    const create = await button(page, 'CREATE ROOM'); await create.click(); await create.dispose();
    await page.waitForSelector('[role="alert"]');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Your name'), 'Empty create must focus name');
    receipt.form = { emptySubmissionRejected: true, roomCreated: false };
    await capture(page, 'saboteur-form-validation', 375, 'main, [role="main"], body');
    }
    if (supplement && skipHub375) {
      await page.setViewport({ width: 768, height: 900, deviceScaleFactor: 1 });
      await page.goto(new URL('/saboteur', base).href, { waitUntil: 'networkidle0' });
      await capture(page, 'saboteur-entrance-form', 768, 'main, [role="main"], body');
    }
    for (const route of continuation ? ['/saboteur'] : ['/', '/saboteur']) for (const width of continuation ? [1280] : [375, 1280]) {
      if (supplement && skipHub375 && route === '/' && width === 375) continue;
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.goto(new URL(route, base).href, { waitUntil: 'networkidle0' }); await settle(page);
      const scaling = await enlargeText(page);
      receipt.captures.push({ kind: 'actual DOM font and numeric line-height enlargement, not browser zoom', route, width, scaling });
      assert(scaling.samples.length > 0 && scaling.samples.every(item => item.connected && item.currentText === item.text && Number.isFinite(item.after) && Math.abs(item.after / item.before - 2) < 0.01), '200% text scaling did not apply to positive visible text, see persisted samples');
      await capture(page, route === '/' ? 'hub-text200' : 'saboteur-text200', width, route === '/' ? '#arcade-game-library' : 'main, [role="main"], body');
      if (route === '/saboteur') await capture(page, 'saboteur-text200-form', width, 'main, [role="main"], body', 900, 'form-start');
    }
    for (const route of ['/', '/saboteur']) {
      await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
      await page.goto(new URL(route, base).href, { waitUntil: 'networkidle0' });
      await capture(page, route === '/' ? 'hub-landscape' : 'saboteur-landscape', 844, route === '/' ? '#arcade-game-library' : 'main, [role="main"], body', 390);
    }
    await Promise.allSettled([...transactions]); assert(!auth, 'Unexpected room before touch-context handoff');
    await context.close();
    const touchContext = await browser.createBrowserContext(); page = await touchContext.newPage();
    await configurePage(page);
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(base.href, { waitUntil: 'networkidle0' }); await page.waitForSelector('#game-tile-saboteur');
    receipt.touch = { ...await page.evaluate(() => ({ maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer: coarse)').matches, viewportWidth: innerWidth, physicalDevice: false })), snapshotMode: 'viewport', probes: [] };
    assert(receipt.touch.maxTouchPoints > 0 && receipt.touch.coarsePointer && receipt.touch.viewportWidth === 375, 'Mobile touch emulation unavailable');
    await capture(page, 'hub-touch', 375, '#arcade-game-library', 812);
    await verifyTouch(page, 'before Saboteur tile tap');
    const touchTile = await page.$('#game-tile-saboteur'); await touchTile.tap(); await touchTile.dispose();
    await page.waitForSelector('input[aria-label="Your name"]');
    await capture(page, 'saboteur-touch', 375, 'main, [role="main"], body', 812);
    receipt.touch.afterCaptures = await page.evaluate(() => ({ maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer: coarse)').matches, viewportWidth: innerWidth }));
    assert(receipt.touch.afterCaptures.maxTouchPoints > 0 && receipt.touch.afterCaptures.coarsePointer && receipt.touch.afterCaptures.viewportWidth === 375, 'Capture reset touch/mobile emulation');
    await verifyTouch(page, 'before blank-create tap');
    const touchCreate = await button(page, 'CREATE ROOM'); await touchCreate.tap(); await touchCreate.dispose();
    await page.waitForSelector('[role="alert"]');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Your name'), 'Touch empty-submit focus failed');
    receipt.touch.emptySubmissionRejected = true;
    assert(receipt.blockedRequests.length === 0, 'External network requested, blocked by allowlist');
    assert(receipt.errors.length === 0, 'Browser errors, see receipt');
    receipt.passed = true;
  } catch (error) {
    receipt.error = error.message; process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => undefined);
  } finally {
    await Promise.allSettled([...transactions]);
    if (auth && page && !page.isClosed()) {
      const status = await page.evaluate(async ({ origin, token, roomCode }) => {
        try { return (await fetch(origin + '/rooms/' + encodeURIComponent(roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) })).status; } catch { return null; }
      }, { origin: api.origin, ...auth }).catch(() => null);
      receipt.cleanup.push({ method: 'REST', status, normalUI: false });
      if (status !== 200) { receipt.passed = false; process.exitCode = 1; }
    } else receipt.cleanup.push({ method: 'none', reason: auth ? 'Room credentials exist but browser unavailable' : 'No room acquired' });
    if (receipt.cleanup.some(item => item.uncertain) || (auth && (!page || page.isClosed()))) { receipt.passed = false; process.exitCode = 1; }
    if (browser) await browser.close().then(() => { receipt.browserClosed = true; }).catch(error => { receipt.browserClosed = false; receipt.closeError = error.message; receipt.passed = false; process.exitCode = 1; });
    receipt.serverStarted = false;
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ passed: receipt.passed, output, captures: receipt.captures.length, browserClosed: receipt.browserClosed }));
  }
}

if (require.main === module) void main();
