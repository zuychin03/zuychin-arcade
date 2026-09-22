const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const h = require('./shared-shell-ui.cjs');
const source = fs.readFileSync(path.join(__dirname, 'shared-shell-ui.cjs'), 'utf8');

function config() {
  return { SHARED_SHELL_UI_RUN: 'true', SHARED_SHELL_UI_EXCLUSIVE_WINDOW: 'granted', SHARED_SHELL_UI_OUTPUT: path.resolve('shell-test-unused'),
    QA_STATIC_ROOT: path.resolve('shell-export-unused'), QA_EXPECTED_WEB_SHA256: 'a'.repeat(64), QA_BROWSER_CERT_SPKI: 'a'.repeat(43) + '=' };
}

test('shell confirmation requires explicit authority fresh output and frozen loopback inputs', () => {
  assert.equal(h.configFromEnv(config()).base, 'http://127.0.0.1:8081');
  for (const key of ['SHARED_SHELL_UI_RUN', 'SHARED_SHELL_UI_EXCLUSIVE_WINDOW', 'SHARED_SHELL_UI_OUTPUT', 'QA_STATIC_ROOT', 'QA_EXPECTED_WEB_SHA256', 'QA_BROWSER_CERT_SPKI']) {
    const env = config(); delete env[key]; assert.throws(() => h.configFromEnv(env));
  }
  for (const url of ['https://example.com', 'http://localhost:8081/libertalia', 'http://localhost:8081/?x=1']) assert.throws(() => h.configFromEnv({ ...config(), SHARED_SHELL_WEB_URL: url }));
});

test('finite checklist covers exactly nine routes two real profiles and 84 maximum application images', () => {
  assert.equal(h.GAMES.length, 9); assert.equal(new Set(h.GAMES.map(game => game.route)).size, 9);
  assert.equal(h.CAPTURE_LIMIT, 84); assert.equal(Object.values(h.CAPTURE_PLAN).reduce((a, b) => a + b, 0), 84);
  assert.deepEqual(h.DRAWERS, [[375, 844, true], [320, 844, false], [320, 844, true], [375, 390, true]]);
  assert.deepEqual(h.HUB_WIDTHS, [320, 375, 414, 767, 768, 1280]); assert.deepEqual(h.FORM_WIDTHS, [320, 375, 768, 1280]);
  assert.deepEqual(h.COVER_PROFILES, { phone: { width: 320, scale: 200 }, desktop: { width: 1280, scale: 100 } });
  assert.match(source, /\['phone', 375, true\], \['desktop', 1280, false\]/);
  assert.match(source, /domOnly: true/); assert.doesNotMatch(source, /sessionStorage\.setItem|reset_game|rooms\/create|rooms\/join/);
});

test('no-room no-auth network guard blocks every mutation and every room route before sending', async () => {
  const origins = new Set(['http://127.0.0.1:8081', 'https://localhost:3214']);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(h.requestAllowed('https://localhost:3214/rooms/create', method, origins), false);
  assert.equal(h.requestAllowed('https://localhost:3214/rooms/ABCD-EFGH', 'GET', origins), false);
  assert.equal(h.requestAllowed('https://elsewhere.test/x', 'GET', origins), false);
  assert(h.requestAllowed('http://127.0.0.1:8081/assets/art.webp', 'GET', origins)); assert(h.requestAllowed('data:image/png,a', 'GET', origins));
  let callback, aborted = 0, continued = 0;
  const page = { setRequestInterception: async enabled => assert.equal(enabled, true), on: (event, listener) => { assert.equal(event, 'request'); callback = listener; } };
  const qa = { origins, evidence: { blockedRequests: [] }, persist() {} }; await h.installReadOnlyGuard(page, qa);
  callback({ url: () => 'https://localhost:3214/rooms/create?password=never-record', method: () => 'POST', abort: async () => { aborted++; }, continue: async () => { continued++; } });
  assert.equal(aborted, 1); assert.equal(continued, 0); assert.equal(qa.evidence.blockedRequests.length, 1); assert(!JSON.stringify(qa.evidence).includes('never-record'));
});

test('calibration borrows only a page and never allocates or closes a third context', async () => {
  let opened = 0, closed = 0;
  const page = { close: async () => { closed++; } }, context = { newPage: async () => { opened++; return page; } };
  const qa = { evidence: {}, persist() {}, calibrate: async browser => { const scope = await browser.createBrowserContext(); assert.equal(await scope.newPage(), page); await scope.close(); } };
  await h.calibrateWithinContext(qa, context); assert.equal(opened, 1); assert.equal(closed, 1); assert.match(qa.evidence.calibrationContext, /no third/);
});

function surface() {
  const nodes = [], inputs = {}, controls = [];
  const parent = { id: 'clipping-parent', tagName: 'DIV', parentElement: null, overflowX: 'hidden', getBoundingClientRect: () => ({ left: 0, right: 768 }) };
  const leaf = text => {
    const node = { textContent: text, isConnected: true, parentElement: parent, closest: () => null, getBoundingClientRect: () => ({ left: 20, right: 700, top: 20, bottom: 70, width: 680, height: 50 }) };
    const child = { nodeType: 3, textContent: text, parentElement: node }; node.childNodes = [child];
    node.glyphs = [...text].map((character, i) => ({ character, start: i, end: i + 1, left: 20 + i * 8, right: 28 + i * 8, top: 20, bottom: 40 })).filter(glyph => glyph.character.trim());
    nodes.push(node); return node;
  };
  const words = [leaf('ZUYCHIN'), leaf('ARCADE')], title = leaf('LIBERTALIA'), helper = leaf('Leave blank for an open room'); leaf('ROOM PASSWORD · OPTIONAL');
  inputs['Your name'] = { ...leaf(''), maxLength: 20, placeholder: 'Player name', type: 'text', value: '', disabled: false };
  inputs['Room password, optional'] = { ...leaf(''), maxLength: 64, placeholder: 'Password', type: 'password', value: '', disabled: false };
  for (const label of ['CREATE ROOM', 'JOIN WITH CODE', 'HOW TO PLAY']) controls.push({ ...leaf(label), getAttribute: () => label });
  const document = { querySelectorAll: selector => selector === 'body *' ? nodes : selector === '[role="button"],button' ? controls : Object.entries(inputs).filter(([label]) => selector.includes('"' + label + '"')).map(([, input]) => input) };
  let authenticated = false;
  const run = args => vm.runInNewContext('(' + h.inspectSurface.toString() + ')(args)', { args, document, Node: { TEXT_NODE: 3 }, innerWidth: 768, innerHeight: 844,
    getComputedStyle: node => ({ visibility: 'visible', overflowX: node.overflowX ?? 'visible' }), location: { pathname: '/libertalia' },
    sessionStorage: { getItem: () => authenticated ? 'unexpected-auth' : null }, window: { __coupQATextGeometry: child => ({ glyphRects: child.parentElement.glyphs }) } });
  return { run, words, title, helper, parent, inputs, nodes, auth: () => { authenticated = true; } };
}

test('brand proof rejects midword wraps and ancestor clipping at the 768 breakpoint', () => {
  const s = surface(); assert.equal(s.run({ kind: 'brand' }).words.length, 2);
  s.words[0].glyphs[6].top = 50; assert.throws(() => s.run({ kind: 'brand' }), /wraps/); s.words[0].glyphs[6].top = 20;
  s.parent.getBoundingClientRect = () => ({ left: 0, right: 50 }); assert.throws(() => s.run({ kind: 'brand' }), /clipped/);
});

test('all-route DOM contract requires persistent helper secure optional field and mounted route identity', () => {
  const s = surface(), args = { kind: 'entrance', title: 'LIBERTALIA', route: 'libertalia' };
  assert.equal(s.run(args).securePassword, true); assert.equal(s.run(args).passwordEmpty, true);
  s.inputs['Room password, optional'].value = 'never-save-input'; const typed = s.run(args); assert.equal(typed.passwordEmpty, false); assert(!JSON.stringify(typed).includes('never-save-input'));
  s.inputs['Room password, optional'].placeholder = 'Leave blank for an open room'; assert.throws(() => s.run(args), /contract changed/);
  s.inputs['Room password, optional'].placeholder = 'Password'; s.inputs['Room password, optional'].type = 'text'; assert.throws(() => s.run(args), /contract changed/);
  s.inputs['Room password, optional'].type = 'password'; assert.throws(() => s.run({ ...args, route: 'bang' }), /route/);
  s.auth(); assert.throws(() => s.run(args), /never authenticate/);
});

test('persistent helper fails for ancestor-clipped prose even when the input purpose remains visible', () => {
  const s = surface(); s.helper.glyphs.at(-1).right = 800;
  assert.throws(() => s.run({ kind: 'entrance', title: 'LIBERTALIA', route: 'libertalia' }), /helper clips/);
});

test('entrance heading rejects midword fragmentation without rejecting ordinary word boundaries', () => {
  const s = surface(), args = { kind: 'entrance', title: 'LIBERTALIA', route: 'libertalia' };
  s.title.glyphs.at(-1).top = 50;
  assert.throws(() => s.run(args), /title clips or splits/);
  s.title.textContent = s.title.childNodes[0].textContent = 'KING OF TOKYO';
  s.title.glyphs = [...s.title.textContent].map((character, i) => ({ character, start: i, end: i + 1, left: 20 + i * 8, right: 28 + i * 8, top: i >= 8 ? 50 : 20, bottom: i >= 8 ? 70 : 40 })).filter(glyph => glyph.character.trim());
  const result = s.run({ ...args, title: 'KING OF TOKYO' });
  assert.equal(result.titleMeasurements[0].lines, 2);
  assert.equal(result.titleMeasurements[0].wordBreaks.length, 0);
});

test('an intact navigation title cannot mask a broken larger entrance heading', () => {
  const s = surface();
  const hero = { ...s.title, glyphs: s.title.glyphs.map(glyph => ({ ...glyph })) };
  hero.childNodes = [{ nodeType: 3, textContent: 'LIBERTALIA', parentElement: hero }];
  hero.glyphs.at(-1).top = 80;
  s.nodes.push(hero);
  assert.throws(() => s.run({ kind: 'entrance', title: 'LIBERTALIA', route: 'libertalia' }), /title clips or splits/);
});

test('title-case navigation and uppercase artwork heading are both required and checked', () => {
  const s = surface(), args = { kind: 'entrance', title: 'LIBERTALIA', navigationTitle: 'Libertalia', route: 'libertalia' };
  assert.throws(() => s.run(args), /navigation title/);
  const navigation = { ...s.title, textContent: 'Libertalia', glyphs: s.title.glyphs.map(glyph => ({ ...glyph })) };
  navigation.childNodes = [{ nodeType: 3, textContent: 'Libertalia', parentElement: navigation }];
  s.nodes.push(navigation);
  assert.equal(s.run(args).titleMeasurements.length, 2);
  navigation.glyphs.at(-1).right = 850;
  assert.throws(() => s.run(args), /title clips or splits/);
});

test('frame budget preserves one complete edge and adds a second only for actual coverage', async () => {
  const actor = { name: 'phone', inputProfile: { hasTouch: true }, page: { viewport: () => ({ width: 375 }) } };
  const qa = { evidence: { attempts: [], shellFrames: [] }, persist() {} };
  let calls = 0;
  qa.capture = async (_page, name) => { calls++; qa.evidence.attempts.push(name); return { file: name, metrics: { frame: { left: 20, right: 320, top: 40, bottom: 140, width: 300, height: 100 }, frameVisibleBounds: { left: 0, right: 375, top: 0, bottom: 844 } } }; };
  await h.frame(actor, 'cover', '#tile', qa, [false]); assert.equal(calls, 1);
  qa.evidence.attempts = Array(83).fill('existing'); await assert.rejects(h.frame(actor, 'over-budget', '#tile', qa, [false]), /budget/); assert.equal(calls, 1);
});

function evidence() {
  return { captures: [], browserClosed: true, scenarioComplete: true, freezeVerified: true, blockedRequests: [], findings: [], consoleIssues: [],
    cleanup: [{ actor: 'phone', contextClosed: true, authClear: true }, { actor: 'desktop', contextClosed: true, authClear: true }] };
}

test('completion requires both clean unauthenticated contexts and frozen issue-free evidence', () => {
  assert(h.completionStatus(evidence()).passed);
  for (const mutate of [e => { e.cleanup.pop(); }, e => { e.cleanup[0].authClear = false; }, e => { e.cleanup[0].contextClosed = false; }, e => { e.freezeVerified = false; }, e => { e.browserClosed = false; }, e => { e.blockedRequests.push({ method: 'POST' }); }, e => { e.findings.push({}); }, e => { e.captures = Array(85).fill({}); }, e => { e.failure = 'failed'; }]) {
    const e = evidence(); mutate(e); assert.equal(h.completionStatus(e).passed, false);
  }
});

test('inventory rejects duplicate routes and missing short drawer proofs', () => {
  const make = () => ({ coverRoutes: ['phone', 'desktop'].flatMap(actor => h.GAMES.map(game => ({ actor, route: game.route, actualNavigation: true, coverHashMatches: true, ...h.COVER_PROFILES[actor] }))),
    entranceContracts: ['phone', 'desktop'].flatMap(actor => h.GAMES.map(game => ({ actor, route: game.route, scale: 200, domOnly: true }))),
    hubChecks: Array(14).fill({}), validation: Array(2).fill({ focusReturned: true, noRequest: true }), helpers: [{ passwordEmpty: true }, { passwordEmpty: false }],
    drawers: h.DRAWERS.map(([width, height, scale]) => ({ width, height, scale: scale ? 200 : 100, escapeRestored: true, closeRestored: true, links: Array(5).fill({}), close: { hitTest: true, noOverlap: true } })), calibration: { passed: true } });
  h.assertInventory(make());
  const duplicate = make(); duplicate.coverRoutes[1] = duplicate.coverRoutes[0]; assert.throws(() => h.assertInventory(duplicate));
  const missing = make(); missing.drawers.pop(); assert.throws(() => h.assertInventory(missing));
  const wrongScale = make(); wrongScale.coverRoutes[0].scale = 100; assert.throws(() => h.assertInventory(wrongScale));
});

test('library consistency rejects stretched trailing tiles as well as height and image drift', () => {
  const rects = [{ left: 0, top: 0, width: 300, height: 400 }, { left: 314, top: 0, width: 300, height: 400 }, { left: 0, top: 414, width: 300, height: 500 }];
  const images = rects.map(() => ({ complete: true, naturalWidth: 900, src: 'http://localhost/art.webp', getBoundingClientRect: () => ({ width: 298, height: 198.67 }) }));
  for (const image of images) image.parentElement = { querySelectorAll: () => [image] };
  const nodes = rects.map((r, index) => ({ isConnected: true, closest: () => null, querySelector: () => images[index], getBoundingClientRect: () => r }));
  const run = () => vm.runInNewContext('(' + h.inspectLibrary.toString() + ')(routes)', { routes: ['one', 'two', 'three'], document: { querySelectorAll: selector => [nodes[['one', 'two', 'three'].indexOf(selector.replace('#game-tile-', ''))]] }, getComputedStyle: () => ({ backgroundImage: 'url("http://localhost/art.webp")', backgroundSize: 'contain' }) });
  assert.equal(run().rows.length, 2);
  assert.equal(run().equalWidths, true);
  rects[2].width = 620; assert.throws(run, /tile widths differ/); rects[2].width = 300;
  rects[1].height = 450; assert.throws(run, /outer heights differ/); rects[1].height = 400;
  images[2].getBoundingClientRect = () => ({ width: 298, height: 220 }); assert.throws(run, /image footprints differ/);
});

test('brand vertical containment rejects clipped glyphs as well as horizontal word breaks', () => {
  const s = surface(); s.words[0].glyphs[0].bottom = 90; assert.throws(() => s.run({ kind: 'brand' }), /clipped/);
});

test('source fence contains every route and artwork plus touched shared components and tests', () => {
  const hashes = h.sourceHashes(); assert.equal(Object.keys(hashes).length, h.SOURCE_FILES.length);
  for (const game of h.GAMES) {
    assert(h.SOURCE_FILES.includes('apps/mobile/app/' + game.route + '/index.tsx'));
    assert(h.SOURCE_FILES.includes('apps/mobile/app/' + game.route + '/_layout.tsx'));
    assert(h.SOURCE_FILES.includes('apps/mobile/assets/game-art/' + game.art + '-cover.webp'));
  }
  for (const name of ['shared-shell-ui.cjs', 'shared-shell-ui.test.cjs', 'navigation-brand-layout.test.cjs', 'scale-pressable.test.cjs', 'Sidebar.tsx', 'MobileDrawer.tsx', 'RemainingLanding.tsx', 'theme.ts']) assert(h.SOURCE_FILES.some(file => file.endsWith(name)), name);
  assert.match(source, /finalSourceHashes = sourceHashes/); assert.match(source, /finalBundle = await bundleFence/);
  assert.match(source, /validateLibertaliaFontState\(fonts\)/); assert.match(source, /restoreLibertaliaText\(actor.page\)/);
});
