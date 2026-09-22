const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { createEvidence, bundleFence, local } = require('./libertalia-ui-evidence.cjs');
const { SOURCE_FILES: BASE_SOURCES, captureFrame, markLifecycleFrame } = require('./libertalia-ui-natural.cjs');
const { enlargeLibertaliaText, restoreLibertaliaText, readLibertaliaFontState, validateLibertaliaFontState, redact } = require('./libertalia-ui-primitives.cjs');
const { readChoiceTarget, stableChoiceSample } = require('./libertalia-ui-choice.cjs');
const { settle, installTextGeometry } = require('./skull-ui-evidence.cjs');

const GAMES = Object.freeze([
  ['saboteur', 'saboteur', 'SABOTEUR', 'Saboteur'], ['coup', 'coup', 'COUP', 'Coup'], ['king-of-tokyo', 'tokyo', 'KING OF TOKYO', 'King of Tokyo'],
  ['skull-king', 'skull', 'SKULL KING', 'Skull King'], ['citadels', 'citadels', 'CITADELS', 'Citadels'], ['not-alone', 'not-alone', 'NOT ALONE', 'Not Alone'],
  ['bang', 'bang', 'BANG!', 'BANG!'], ['libertalia', 'libertalia', 'LIBERTALIA', 'Libertalia'], ['colt-express', 'colt', 'COLT EXPRESS', 'Colt Express'],
].map(([route, art, title, navigationTitle]) => Object.freeze({ route, art, title, navigationTitle })));
const HUB_WIDTHS = Object.freeze([320, 375, 414, 767, 768, 1280]);
const FORM_WIDTHS = Object.freeze([320, 375, 768, 1280]);
const COVER_PROFILES = Object.freeze({ phone: { width: 320, scale: 200 }, desktop: { width: 1280, scale: 100 } });
const DRAWERS = Object.freeze([[375, 844, true], [320, 844, false], [320, 844, true], [375, 390, true]]);
const CAPTURE_PLAN = Object.freeze({ hub: 12, landscape: 2, drawer: 8, representativeForms: 16, passwordHelpers: 4, validationForms: 4, covers: 36, reserve: 2 });
const CAPTURE_LIMIT = Object.values(CAPTURE_PLAN).reduce((sum, count) => sum + count, 0);
const SOURCE_FILES = Object.freeze([...new Set([...BASE_SOURCES,
  'apps/mobile/scripts/shared-shell-ui.cjs', 'apps/mobile/scripts/shared-shell-ui.test.cjs',
  'apps/mobile/app/(arcade)/_layout.tsx',
  ...['Sidebar', 'MobileHeader', 'MobileDrawer', 'ZuychinLogo'].map(name => 'apps/mobile/components/navigation/' + name + '.tsx'),
  ...['AnimatedBackground', 'GameCover'].map(name => 'apps/mobile/components/ui/' + name + '.tsx'),
  ...['navigation-brand-layout', 'game-navigation-titles', 'mobile-navigation', 'game-library-design', 'game-tile', 'game-art-assets', 'remaining-journey', 'saboteur-entrance', 'session-leaderboard', 'brand-assets', 'scale-pressable', 'web-modal-focus'].map(name => 'apps/mobile/scripts/' + name + '.test.cjs'),
  'apps/mobile/scripts/generate-game-art.cjs', 'apps/mobile/hooks/useReducedMotionPreference.ts',
  ...GAMES.flatMap(game => ['apps/mobile/app/' + game.route + '/index.tsx', 'apps/mobile/app/' + game.route + '/_layout.tsx',
    ...['cover', 'hero'].map(kind => 'apps/mobile/assets/game-art/' + game.art + '-' + kind + '.webp'),
    'apps/mobile/assets/game-art/' + (game.art === 'saboteur' ? 'manifest' : game.art + '-manifest') + '.json']),
])]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = (read = file => fs.readFileSync(path.resolve(__dirname, '../../..', file))) => Object.fromEntries(SOURCE_FILES.map(file => [file, sha(read(file))]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function configFromEnv(env) {
  assert.equal(env.SHARED_SHELL_UI_RUN, 'true', 'Explicit shell run authority required');
  assert.equal(env.SHARED_SHELL_UI_EXCLUSIVE_WINDOW, 'granted', 'Exclusive browser window required');
  const base = env.SHARED_SHELL_WEB_URL ?? 'http://127.0.0.1:8081';
  const url = local(base); assert(url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password);
  assert(/^[a-f0-9]{64}$/.test(env.QA_EXPECTED_WEB_SHA256 ?? ''), 'Frozen expected bundle hash required');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(env.QA_BROWSER_CERT_SPKI ?? ''), 'Exact local TLS proxy SPKI required');
  for (const key of ['SHARED_SHELL_UI_OUTPUT', 'QA_STATIC_ROOT']) assert(env[key] && path.isAbsolute(env[key]), 'Absolute ' + key + ' required');
  assert.notEqual(path.resolve(env.SHARED_SHELL_UI_OUTPUT), path.parse(env.SHARED_SHELL_UI_OUTPUT).root);
  return { base: url.origin, api: 'http://127.0.0.1:3213', output: env.SHARED_SHELL_UI_OUTPUT, staticRoot: env.QA_STATIC_ROOT,
    expected: env.QA_EXPECTED_WEB_SHA256, spki: env.QA_BROWSER_CERT_SPKI, browserPath: env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
}

function requestAllowed(url, method, origins) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (/^(data:|blob:|about:)/.test(url)) return true;
  const parsed = new URL(url);
  return origins.has(parsed.origin) && !/^\/rooms(?:\/|$)/.test(parsed.pathname);
}

async function installReadOnlyGuard(page, qa) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (requestAllowed(request.url(), request.method(), qa.origins)) void request.continue().catch(() => undefined);
    else {
      const url = new URL(request.url()); qa.evidence.blockedRequests.push({ origin: url.origin, path: url.pathname, method: request.method() }); qa.persist();
      void request.abort('blockedbyclient').catch(() => undefined);
    }
  });
}

function inspectSurface({ kind, title, navigationTitle, route, scope }) {
  const rendered = node => { const r = node.getBoundingClientRect(); return node.isConnected && r.width > 0 && r.height > 0 && getComputedStyle(node).visibility === 'visible' && !node.closest('[hidden],[inert],[aria-hidden="true"]'); };
  const root = scope ? document.querySelector(scope) : document; if (!root) throw Error('Missing mounted surface');
  const leaves = text => [...root.querySelectorAll(scope ? '*' : 'body *')].filter(node => rendered(node) && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === text));
  const measure = (node, vertical = false) => {
    const r = node.getBoundingClientRect(), rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), b = parent.getBoundingClientRect();
      if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); ancestors.push({ tag: parent.id || parent.tagName, left: b.left, right: b.right, overflow: css.overflowX }); }
      if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    const textGeometry = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => ({ value: child.textContent, ...window.__coupQATextGeometry(child) }));
    const allGlyphs = textGeometry.flatMap(text => text.glyphRects);
    const wordBreaks = textGeometry.flatMap(text => [...text.value.matchAll(/\S+/g)].filter(word => {
      const glyphs = text.glyphRects.filter(glyph => glyph.start >= word.index && glyph.start < word.index + word[0].length);
      return new Set(glyphs.map(glyph => Math.round(glyph.top))).size > 1;
    }).map(word => word[0]));
    const glyphs = allGlyphs.filter(glyph => glyph.character?.trim());
    const overflow = glyphs.filter(glyph => glyph.left < Math.max(0, left) - 2 || glyph.right > Math.min(innerWidth, right) + 2 || (vertical && (glyph.top < Math.max(0, top) - 2 || glyph.bottom > Math.min(innerHeight, bottom) + 2)));
    return { text: node.textContent.trim(), rect, ancestors, glyphCount: glyphs.length, lines: [...new Set(glyphs.map(glyph => Math.round(glyph.top)))].length, wordBreaks, overflow: overflow.length };
  };
  if (sessionStorage.getItem('za:auth') !== null) throw Error('Shell-only run must never authenticate');
  if (kind === 'brand') {
    const words = ['ZUYCHIN', 'ARCADE'].map(text => { const matches = leaves(text); if (matches.length !== 1) throw Error('One visible mounted brand word required: ' + text); return measure(matches[0], true); });
    if (words.some(word => word.glyphCount === 0 || word.lines !== 1 || word.overflow)) throw Error('Brand word wraps or is clipped by an ancestor');
    return { kind, words, width: innerWidth, height: innerHeight, authenticated: false };
  }
  if (location.pathname !== '/' + route) throw Error('Wrong rendered entrance route');
  const headings = leaves(title); if (!headings.length) throw Error('Expected mounted game identity');
  const navigationHeadings = navigationTitle ? leaves(navigationTitle) : [];
  if (navigationTitle && !navigationHeadings.length) throw Error('Expected mounted navigation title');
  const titleMeasurements = [...new Set([...headings, ...navigationHeadings])].map(node => measure(node));
  if (titleMeasurements.some(heading => !heading.glyphCount || heading.overflow || heading.wordBreaks.length)) throw Error('Entrance title clips or splits a word: ' + JSON.stringify(titleMeasurements));
  const names = [...document.querySelectorAll('input[aria-label="Your name"]')].filter(rendered);
  const passwords = [...document.querySelectorAll('input[aria-label="Room password, optional"]')].filter(rendered);
  if (names.length !== 1 || passwords.length !== 1) throw Error('Unique visible shared form inputs required');
  const name = names[0], password = passwords[0], helper = leaves('Leave blank for an open room');
  if (name.maxLength !== 20 || name.placeholder !== 'Player name' || name.disabled || name.type === 'password') throw Error('Name contract changed');
  if (password.type !== 'password' || password.maxLength !== 64 || password.placeholder !== 'Password' || password.disabled) throw Error('Secure optional-password contract changed');
  if (helper.length !== 1 || leaves('ROOM PASSWORD · OPTIONAL').length !== 1) throw Error('Persistent optional-password meaning missing');
  const helperMeasure = measure(helper[0]); if (!helperMeasure.glyphCount || helperMeasure.overflow) throw Error('Persistent helper clips in its ancestors');
  const controls = ['CREATE ROOM', 'JOIN WITH CODE', 'HOW TO PLAY'].map(label => {
    const matches = [...document.querySelectorAll('[role="button"],button')].filter(node => rendered(node) && (node.getAttribute('aria-label') ?? node.textContent).trim() === label);
    if (matches.length !== 1) throw Error('Unique mounted entrance action required: ' + label);
    const r = matches[0].getBoundingClientRect(); if (r.width < 48 || r.height < 48) throw Error('Entrance action below48');
    return { label, width: r.width, height: r.height };
  });
  return { kind, route, title, titleMeasurements, securePassword: true, passwordEmpty: password.value.length === 0, nameEmpty: name.value.length === 0, helper: helperMeasure, controls, authenticated: false };
}

function markDrawer() {
  const dialog = document.getElementById('arcade-mobile-navigation'); if (!dialog) throw Error('Missing actual drawer');
  const close = dialog.querySelector('[aria-label="Close navigation menu"]'); if (!close) throw Error('Missing drawer Close');
  let content = close;
  while (content && content !== dialog && content.querySelectorAll('[role="link"]').length !== 5) content = content.parentElement;
  if (!content || content === dialog) throw Error('Missing complete bounded drawer contents');
  content.setAttribute('data-shared-shell-drawer', 'true');
  const labels = [...content.querySelectorAll('[role="link"]')].map((node, index) => { node.setAttribute('data-shared-shell-link', String(index)); return node.textContent.trim(); });
  if (labels.length !== 5 || !['Hub', 'Ranks', 'Profile', 'About', 'Privacy'].every((label, index) => labels[index].endsWith(label))) throw Error('Drawer link inventory changed');
  return labels;
}

function inspectDrawerClose(words) {
  const node = document.querySelector('#arcade-mobile-navigation [aria-label="Close navigation menu"]');
  const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (r.width < 48 || r.height < 48 || !(hit === node || node.contains(hit))) throw Error('Drawer Close must be48 and hit-test reachable');
  if (words.some(word => word.rect.left < r.right && word.rect.right > r.left && word.rect.top < r.bottom && word.rect.bottom > r.top)) throw Error('Drawer Close overlaps live wordmark');
  return { width: r.width, height: r.height, hitTest: true, noOverlap: true };
}

function inspectLibrary(routes) {
  const rows = [];
  const cards = routes.map(route => {
    const nodes = document.querySelectorAll('#game-tile-' + route); if (nodes.length !== 1) throw Error('Unique current library tile required');
    const node = nodes[0], image = node.querySelector('img'), r = node.getBoundingClientRect();
    if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]') || r.width <= 0 || r.height <= 0 || !image?.complete || !image.naturalWidth) throw Error('Mounted loaded library tile required');
    const painted = [...image.parentElement.querySelectorAll('*')].filter(child => { const css = getComputedStyle(child); return css.backgroundImage?.includes(image.currentSrc || image.src) && css.backgroundSize === 'contain'; });
    if (painted.length !== 1) throw Error('One actual contained RNW image paint required');
    const i = painted[0].getBoundingClientRect(); if (i.width <= 0 || i.height <= 0) throw Error('Complete contained library image required');
    return { route, left: r.left, top: r.top, width: r.width, height: r.height, imageWidth: i.width, imageHeight: i.height };
  });
  if (cards.some(card => Math.abs(card.width - cards[0].width) > 2)) throw Error('Library tile widths differ');
  for (const card of cards) { let row = rows.find(row => Math.abs(row[0].top - card.top) <= 2); if (!row) { row = []; rows.push(row); } row.push(card); }
  for (const row of rows) if (row.some(card => Math.abs(card.height - row[0].height) > 2)) throw Error('Same-row library tile outer heights differ');
  for (const card of cards) for (const other of cards) if (Math.abs(card.width - other.width) <= 2 && (Math.abs(card.imageWidth - other.imageWidth) > 2 || Math.abs(card.imageHeight - other.imageHeight) > 2)) throw Error('Comparable library image footprints differ');
  return { domOnly: true, cards, rows: rows.map(row => row.map(card => card.route)), equalWidths: true, sameRowHeights: true, comparableImageFootprints: true };
}

function inspectReachableLink(selector) {
  const nodes = document.querySelectorAll(selector); if (nodes.length !== 1) throw Error('Unique mounted drawer link required');
  const node = nodes[0], r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!node.isConnected || !node.matches('[role="link"]') || node.tabIndex < 0 || r.width < 48 || r.height < 48 || r.top < -2 || r.bottom > innerHeight + 2 || !(hit === node || node.contains(hit))) throw Error('Full drawer link must remain keyboard and pointer reachable');
  return { text: node.textContent.trim(), width: r.width, height: r.height, hitTest: true, keyboardFocusable: true };
}

function markHelper() {
  const nodes = [...document.querySelectorAll('body *')].filter(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === 'Leave blank for an open room'));
  if (nodes.length !== 1) throw Error('One persistent password helper required');
  nodes[0].setAttribute('data-shared-shell-helper', 'true');
}

async function ready(actor, config, route) {
  assert.equal(new URL(actor.page.url()).origin, config.base);
  if (route !== undefined) assert.equal(new URL(actor.page.url()).pathname, route);
  await actor.page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await settle(actor.page); await actor.page.evaluate(installTextGeometry);
  assert.equal(await actor.page.evaluate(() => sessionStorage.getItem('za:auth')), null);
}

async function press(actor, selector, keyboard = false) {
  let handle;
  try {
    const label = await actor.page.$eval(selector, node => node.getAttribute('aria-label'));
    await actor.page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    let previous = null, stable = 0;
    for (let count = 0; count < 100; count++) {
      const sample = await actor.page.evaluate(readChoiceTarget, { selector, label });
      stable = stableChoiceSample(previous, sample) ? stable + 1 : 0; previous = sample;
      if (stable >= 3) break;
      await delay(60);
    }
    assert(stable >= 3, 'Stable enabled hit-tested shell control required');
    handle = await actor.page.$(selector); assert(handle);
    if (keyboard) { await handle.focus(); await actor.page.keyboard.press('Enter'); }
    else if (actor.inputProfile.hasTouch) await handle.tap(); else await handle.click();
  } finally { await handle?.dispose(); }
}

async function calibrateWithinContext(qa, context) {
  let page;
  await qa.calibrate({ createBrowserContext: async () => ({ newPage: async () => { page = await context.newPage(); return page; }, close: async () => { await page?.close(); } }) });
  qa.evidence.calibrationContext = 'Temporary page in first owned context; no third browser context'; qa.persist();
}

async function frame(actor, name, selector, qa, scales = [false, true], prepare = null) {
  const before = qa.evidence.attempts.length;
  assert(before + scales.length * 2 <= CAPTURE_LIMIT, 'Conservative shell edge budget exceeded');
  const proofs = await captureFrame(actor, name, selector, qa, { scales, prepare });
  qa.evidence.shellFrames.push({ name, actor: actor.name, selector, proofs }); qa.persist(); return proofs;
}

async function form(actor, name, qa, scales = [false, true]) {
  await actor.page.evaluate(markLifecycleFrame, { label: 'CREATE ROOM', form: true });
  try { return await frame(actor, name, '[data-libertalia-qa-lifecycle="frame"]', qa, scales); }
  finally { await actor.page.evaluate(() => document.querySelector('[data-libertalia-qa-lifecycle]')?.removeAttribute('data-libertalia-qa-lifecycle')); }
}

function completionStatus(evidence) {
  const cleanupComplete = evidence.browserClosed && evidence.cleanup.length === 2 && evidence.cleanup.every(row => row.contextClosed && row.authClear && !row.error);
  return { cleanupComplete, passed: Boolean(cleanupComplete && evidence.scenarioComplete && evidence.freezeVerified && !evidence.failure && !evidence.watchdogExpired
    && evidence.captures.length <= CAPTURE_LIMIT && evidence.blockedRequests.length === 0 && evidence.findings.length === 0 && evidence.consoleIssues.length === 0) };
}

function assertInventory(evidence) {
  assert.equal(evidence.coverRoutes.length, 18); assert.equal(evidence.entranceContracts.length, 18); assert.equal(evidence.hubChecks.length, 14);
  for (const actor of ['phone', 'desktop']) for (const game of GAMES) {
    assert.equal(evidence.coverRoutes.filter(row => row.actor === actor && row.route === game.route && row.actualNavigation && row.coverHashMatches && row.width === COVER_PROFILES[actor].width && row.scale === COVER_PROFILES[actor].scale).length, 1);
    assert.equal(evidence.entranceContracts.filter(row => row.actor === actor && row.route === game.route && row.scale === 200 && row.domOnly).length, 1);
  }
  assert.equal(evidence.validation.length, 2); assert(evidence.validation.every(row => row.focusReturned && row.noRequest));
  assert.equal(evidence.helpers.length, 2); assert.deepEqual(evidence.helpers.map(row => row.passwordEmpty), [true, false]);
  assert.equal(evidence.drawers.length, DRAWERS.length);
  for (const [width, height, scale] of DRAWERS) assert.equal(evidence.drawers.filter(row => row.width === width && row.height === height && row.scale === (scale ? 200 : 100) && row.escapeRestored && row.closeRestored && row.links.length === 5 && row.close.hitTest && row.close.noOverlap).length, 1);
  assert(evidence.calibration?.passed);
}

async function main() {
  const config = configFromEnv(process.env); assert(!fs.existsSync(config.output), 'Preserve previous evidence'); fs.mkdirSync(config.output, { recursive: true });
  const qa = createEvidence({ outputDir: config.output, base: config.base, api: config.api });
  Object.assign(qa.evidence, { method: 'Read-only shared-shell confirmation; no room creation, authentication or game replay. CSS200 and emulated input are not native/device evidence.', capturePlan: CAPTURE_PLAN, captureLimit: CAPTURE_LIMIT,
    sourceFiles: SOURCE_FILES, consoleIssues: [], shellFrames: [], coverRoutes: [], entranceContracts: [], hubChecks: [], validation: [], helpers: [], drawers: [], artworkScope: 'All nine library covers; unrelated Libertalia artworkNotObserved entries are not a shell inventory.' });
  const actors = []; let browser, watchdog;
  try {
    qa.evidence.sourceHashes = sourceHashes(); qa.evidence.bundle = await bundleFence(config.base, config.staticRoot, config.expected); qa.persist();
    browser = await puppeteer.launch({ executablePath: config.browserPath, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + config.spki] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 20 * 60_000);
    for (const [name, width, hasTouch] of [['phone', 375, true], ['desktop', 1280, false]]) {
      const actor = { name, inputProfile: { width, height: 844, hasTouch, isMobile: hasTouch, pointer: hasTouch ? 'coarse' : 'fine' } };
      actor.context = await browser.createBrowserContext(); actors.push(actor);
      if (name === 'phone') await calibrateWithinContext(qa, actor.context);
      actor.page = await actor.context.newPage(); qa.register(actor);
      await actor.page.setViewport({ width, height: 844, hasTouch, isMobile: hasTouch, deviceScaleFactor: 1 });
      await actor.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await installReadOnlyGuard(actor.page, qa);
      actor.page.on('pageerror', error => { qa.evidence.consoleIssues.push({ actor: name, message: redact(error.message, [...qa.secrets]) }); qa.persist(); });
      actor.page.on('console', message => { if (['error', 'warning'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) { qa.evidence.consoleIssues.push({ actor: name, message: redact(message.text(), [...qa.secrets]) }); qa.persist(); } });
    }
    const resize = (actor, width, height = 844) => actor.page.setViewport({ ...actor.page.viewport(), width, height });
    const go = async (actor, route = '/') => { await actor.page.goto(config.base + route, { waitUntil: 'domcontentloaded' }); await ready(actor, config, route); };
    for (const [width, height] of [...HUB_WIDTHS.map(width => [width, 844]), [844, 390]]) {
      const actor = actors[width < 768 ? 0 : 1]; await resize(actor, width, height); await go(actor);
      for (const scale of [false, true]) {
        assert(qa.evidence.attempts.length < CAPTURE_LIMIT);
        let check;
        await qa.capture(actor.page, 'hub-' + width + '-' + height + '-' + (scale ? 200 : 100) + '.png', { scale, prepare: async () => { check = await actor.page.evaluate(inspectSurface, { kind: 'brand' }); check.library = await actor.page.evaluate(inspectLibrary, GAMES.map(game => game.route)); } });
        qa.evidence.hubChecks.push({ ...check, scale: scale ? 200 : 100, actor: actor.name, inputProfile: actor.inputProfile }); qa.persist();
      }
    }
    const phone = actors[0], menu = '[aria-label="Open navigation menu"]';
    for (const [width, height, scale] of DRAWERS) {
      await resize(phone, width, height); await go(phone); await phone.page.$eval(menu, node => node.focus()); await press(phone, menu);
      await phone.page.waitForSelector('#arcade-mobile-navigation'); await phone.page.evaluate(markDrawer);
      let brand, close;
      await frame(phone, 'drawer-' + width + '-' + height, '[data-shared-shell-drawer="true"]', qa, [scale], async () => {
        brand = await phone.page.evaluate(inspectSurface, { kind: 'brand', scope: '#arcade-mobile-navigation' }); close = await phone.page.evaluate(inspectDrawerClose, brand.words);
      });
      const links = [];
      try {
        if (scale) await enlargeLibertaliaText(phone.page);
        for (let index = 0; index < 5; index++) {
          const selector = '[data-shared-shell-link="' + index + '"]';
          await phone.page.$eval(selector, node => node.scrollIntoView({ block: 'center', behavior: 'instant' })); await settle(phone.page);
          links.push(await phone.page.evaluate(inspectReachableLink, selector));
        }
        if (scale) validateLibertaliaFontState(await phone.page.evaluate(readLibertaliaFontState));
      } finally { if (scale) await restoreLibertaliaText(phone.page); }
      await phone.page.keyboard.press('Escape'); await phone.page.waitForFunction(() => !document.getElementById('arcade-mobile-navigation'));
      const escapeRestored = await phone.page.$eval(menu, node => document.activeElement === node);
      await press(phone, menu); await phone.page.waitForSelector('#arcade-mobile-navigation');
      try { if (scale) await enlargeLibertaliaText(phone.page); await press(phone, '#arcade-mobile-navigation [aria-label="Close navigation menu"]'); }
      finally { if (scale) await restoreLibertaliaText(phone.page); }
      await phone.page.waitForFunction(() => !document.getElementById('arcade-mobile-navigation'));
      const closeRestored = await phone.page.$eval(menu, node => document.activeElement === node);
      qa.evidence.drawers.push({ width, height, scale: scale ? 200 : 100, brand, close, links, escapeRestored, closeRestored, inputProfile: phone.inputProfile }); qa.persist();
    }
    for (const actor of actors) {
      const profile = COVER_PROFILES[actor.name];
      await resize(actor, profile.width);
      for (const game of GAMES) {
        await go(actor); const selector = '#game-tile-' + game.route;
        await frame(actor, 'cover-' + game.route + '-' + actor.name, selector, qa, [profile.scale === 200]);
        const source = await actor.page.$eval(selector, node => { const image = node.querySelector('img'); if (!image || !image.complete || !image.naturalWidth) throw Error('Real loaded tile cover required'); return new URL(image.currentSrc || image.src).pathname; });
        const asset = qa.evidence.assets.find(asset => asset.source === source), expected = sha(fs.readFileSync(path.resolve(__dirname, '../assets/game-art/' + game.art + '-cover.webp')));
        assert.equal(asset?.servedHash, expected, 'Exact title cover artwork required');
        await press(actor, selector); await actor.page.waitForFunction(route => location.pathname === '/' + route, {}, game.route); await ready(actor, config, '/' + game.route);
        qa.evidence.coverRoutes.push({ actor: actor.name, route: game.route, source, coverHashMatches: true, actualNavigation: true, ...profile, inputProfile: { ...actor.inputProfile, width: profile.width } });
        try {
          await enlargeLibertaliaText(actor.page); const check = await actor.page.evaluate(inspectSurface, { kind: 'entrance', ...game });
          const fonts = await actor.page.evaluate(readLibertaliaFontState); validateLibertaliaFontState(fonts);
          qa.evidence.entranceContracts.push({ ...check, actor: actor.name, scale: 200, domOnly: true, fonts, inputProfile: actor.inputProfile }); qa.persist();
        } finally { await restoreLibertaliaText(actor.page); }
      }
    }
    for (const width of FORM_WIDTHS) {
      const actor = actors[width < 768 ? 0 : 1]; await resize(actor, width); await go(actor, '/libertalia'); await form(actor, 'libertalia-form-' + width, qa);
    }
    await resize(phone, 375); await go(phone, '/libertalia');
    const passwordSelector = 'input[aria-label="Room password, optional"]';
    for (const typed of [false, true]) {
      if (typed) { const secret = 'Shell-test-only'; qa.secrets.add(secret); await phone.page.type(passwordSelector, secret); }
      await phone.page.evaluate(markHelper); let check;
      await frame(phone, typed ? 'helper-typed' : 'helper-empty', '[data-shared-shell-helper="true"]', qa, [true], async () => { check = await phone.page.evaluate(inspectSurface, { kind: 'entrance', ...GAMES[7] }); });
      qa.evidence.helpers.push({ passwordEmpty: check.passwordEmpty, securePassword: check.securePassword, helper: check.helper }); qa.persist();
    }
    for (const actor of actors) {
      await resize(actor, actor.inputProfile.width); await go(actor, '/libertalia');
      await actor.page.evaluate(markLifecycleFrame, { label: 'CREATE ROOM', form: false });
      const requests = qa.evidence.blockedRequests.length;
      await press(actor, '[data-libertalia-qa-lifecycle="frame"]', true);
      await actor.page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent === 'Enter the name other players will see.');
      const focusReturned = await actor.page.$eval('input[aria-label="Your name"]', node => document.activeElement === node);
      await form(actor, 'blank-validation-' + actor.name, qa, [true]);
      qa.evidence.validation.push({ actor: actor.name, focusReturned, noRequest: requests === qa.evidence.blockedRequests.length }); qa.persist();
    }
    assertInventory(qa.evidence); qa.evidence.scenarioComplete = true;
  } catch (error) { qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    for (const actor of actors) {
      const row = { actor: actor.name, authClear: false, contextClosed: false };
      try { row.authClear = actor.page ? await actor.page.evaluate(() => sessionStorage.getItem('za:auth') === null) : true; } catch (error) { row.error = redact(error.message, [...qa.secrets]); }
      try { await actor.context.close(); row.contextClosed = true; } catch (error) { row.error ??= redact(error.message, [...qa.secrets]); }
      qa.evidence.cleanup.push(row);
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } } catch (error) { qa.evidence.failure ??= redact(error.message, [...qa.secrets]); }
    try { qa.evidence.finalSourceHashes = sourceHashes(); assert.deepEqual(qa.evidence.finalSourceHashes, qa.evidence.sourceHashes); qa.evidence.finalBundle = await bundleFence(config.base, config.staticRoot, config.expected); assert.deepEqual(qa.evidence.finalBundle, qa.evidence.bundle); qa.evidence.freezeVerified = true; } catch (error) { qa.evidence.failure ??= redact(error.message, [...qa.secrets]); }
    Object.assign(qa.evidence, completionStatus(qa.evidence)); qa.persist();
  }
  console.log(JSON.stringify({ passed: qa.evidence.passed, captures: qa.evidence.captures.length, browserClosed: qa.evidence.browserClosed, output: config.output }));
  if (!qa.evidence.passed) process.exitCode = 1;
}

module.exports = { GAMES, HUB_WIDTHS, FORM_WIDTHS, COVER_PROFILES, DRAWERS, CAPTURE_PLAN, CAPTURE_LIMIT, SOURCE_FILES, sourceHashes, configFromEnv, requestAllowed, installReadOnlyGuard, inspectSurface, inspectLibrary, inspectReachableLink, markHelper, calibrateWithinContext, frame, completionStatus, assertInventory };
if (require.main === module) main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
