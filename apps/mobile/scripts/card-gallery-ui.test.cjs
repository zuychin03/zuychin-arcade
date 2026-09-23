const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const h = require('./card-gallery-ui.cjs');
const repo = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(__dirname, 'card-gallery-ui.cjs'), 'utf8');
function measurement() {
  return { authenticated: false, fontReady: true, images: [], width: 1280, height: 844, targets: [0, 1, 2].map(index => ({ id: 'card-' + index, root: { left: index * 210, right: index * 210 + 200, top: 10, height: 400 }, face: { width: 200, height: 400 }, clipping: [], controls: [{ width: 200, height: 400 }] })) };
}

function walkerFixture(aliases = {}) {
  const root = path.resolve('gallery-walker-fixture');
  const tree = { '': ['assets', 'index.html', 'dist', 'node_modules', '.expo'], assets: ['fonts', 'card.webp'], 'assets/fonts': ['font.ttf'], dist: ['ignored.js'], node_modules: ['ignored.js'], '.expo': ['ignored.json'] };
  const visited = [];
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  const mock = {
    realpathSync(file) { return aliases[relative(file)] || file; },
    statSync(file) { return { isDirectory: () => Object.hasOwn(tree, relative(file)) }; },
    readdirSync(file, options) {
      const key = relative(file); visited.push(key);
      return options?.withFileTypes ? tree[key].map(name => ({ name, isDirectory: () => false })) : tree[key];
    },
  };
  const definition = source.slice(source.indexOf('function filesIn('), source.indexOf('function sourceHashes('));
  const walk = vm.runInNewContext(`(${definition})`, { fs: mock, path, assert, Set });
  return { root, visited, walk };
}

test('gallery walker uses filesystem directory status when OneDrive Dirents misclassify folders', () => {
  const fixture = walkerFixture();
  assert.deepEqual(Array.from(fixture.walk(fixture.root)), ['assets/card.webp', 'assets/fonts/font.ttf', 'index.html'].map(file => path.join(fixture.root, file)).sort());
  assert.deepEqual(fixture.visited, ['', 'assets', 'assets/fonts']);
});

test('gallery walker rejects escaping links and directory cycles without following them', () => {
  const outside = walkerFixture({ assets: path.resolve('outside-gallery') });
  assert.throws(() => outside.walk(outside.root), /outside scan root/);
  assert.deepEqual(outside.visited, ['']);
  const cycleRoot = path.resolve('gallery-walker-fixture');
  const cycle = walkerFixture({ 'assets/fonts': cycleRoot });
  assert.throws(() => cycle.walk(cycle.root), /Cyclic gallery directory/);
  const fileLink = walkerFixture({ 'assets/card.webp': path.resolve('outside.webp') });
  assert.throws(() => fileLink.walk(fileLink.root), /outside scan root/);
});
test('finite gallery plan has nine families and four genuine pointer/text profiles', () => {
  assert.equal(new Set(Object.values(h.BATCHES).flat()).size, 9); assert.equal(h.LIMIT * 3, 216);
  assert.deepEqual(h.PROFILES.map(p => [p.width, p.touch, p.scale]), [[320, true, true], [375, true, true], [1280, false, false], [1280, false, true]]);
  assert.deepEqual(h.DOM_PROFILES.map(p => [p.width, p.touch, p.scale, p.domOnly]), [[414, true, false, true], [414, true, true, true], [768, false, false, true], [768, false, true, true]]);
});
test('painted face checks reject equal-wrapper unequal-face false passes', () => {
  const good = measurement(); h.assertGeometry(good);
  for (const field of ['height', 'width']) { const bad = measurement(); bad.targets[1].face[field] += 5; assert.throws(() => h.assertGeometry(bad), /painted/); }
  const clipping = measurement(); clipping.targets[2].clipping.push({ text: 'lost prose' }); assert.throws(() => h.assertGeometry(clipping), /clips/);
  const tiny = measurement(); tiny.targets[0].controls[0].height = 47; assert.throws(() => h.assertGeometry(tiny), /below48/);
});
test('die and card families compare internally, never to each other', () => {
  const result = measurement(); result.targets.push({ id: 'die-0', root: { top: 500 }, face: { width: 90, height: 150 }, clipping: [], controls: [] }, { id: 'die-1', root: { top: 500 }, face: { width: 90, height: 150 }, clipping: [], controls: [] }); h.assertGeometry(result);
  result.targets[4].face.height++; h.assertGeometry(result); result.targets[4].face.height += 3; assert.throws(() => h.assertGeometry(result), /heights/);
});
test('row framing is permitted only when every actual card fits horizontally', () => {
  assert(h.rowFits(measurement())); const offscreen = measurement(); offscreen.targets[2].root.right = 1290; assert.equal(h.rowFits(offscreen), false);
});
test('configuration requires explicit browser authority and dedicated isolated export', () => {
  const env = { CARD_GALLERY_UI_RUN: 'true', CARD_GALLERY_UI_EXCLUSIVE_WINDOW: 'granted', CARD_GALLERY_BATCH: 'first', CARD_GALLERY_OUTPUT: path.join(repo, '.tmp-qa-evidence/gallery-test'), CARD_GALLERY_STATIC_ROOT: path.join(repo, 'tools/card-gallery/dist'), CARD_GALLERY_SOURCE_MANIFEST: path.join(repo, 'tools/card-gallery/frozen-source.json'), CARD_GALLERY_SHA256: 'a'.repeat(64) };
  assert.equal(h.config(env).batch, 'first');
  for (const key of Object.keys(env)) { const missing = { ...env }; delete missing[key]; assert.throws(() => h.config(missing)); }
  assert.throws(() => h.config({ ...env, CARD_GALLERY_STATIC_ROOT: path.join(repo, 'apps/mobile/dist') }));
  assert.throws(() => h.config({ ...env, CARD_GALLERY_STATIC_ROOT: path.join(repo, '.tmp-qa-tools/card-gallery/dist') }));
  assert.throws(() => h.config({ ...env, CARD_GALLERY_URL: 'https://example.com' }));
});
test('QA entry imports actual components and fonts without production route/store/auth injection', () => {
  const entry = fs.readFileSync(path.join(repo, 'tools/card-gallery/entry.tsx'), 'utf8');
  for (const name of ['CharacterCard', 'PowerCardCollection', 'TokyoDie', 'SkullKingCardView', 'CitadelsDistrictView', 'NotAlonePlaceCard', 'BangHand', 'LibertaliaHand', 'ActionCard', 'HandCard', 'useIntrinsicCardHeight']) assert(entry.includes(name));
  assert.match(entry, /Neutral rail, not game-route layout evidence/); assert.match(entry, /Outfit_800ExtraBold/); assert.match(entry, /SpaceMono_700Bold/);
  assert.doesNotMatch(entry, /useGameStore|socket\.io|sessionStorage|dangerouslySetInnerHTML|expo-router/);
  const metro = fs.readFileSync(path.join(repo, 'tools/card-gallery/metro.config.js'), 'utf8'); assert.match(metro, /disableTypeScriptGeneration: true/);
});
test('source fence resolves real font assets and both runner files before export', () => {
  const hashes = h.sourceHashes();
  assert.equal(Object.keys(hashes).filter(file => file.endsWith('.ttf') && /google-fonts/.test(file)).length, 5);
  for (const name of ['card-gallery-ui.cjs', 'card-gallery-ui.test.cjs', 'entry.tsx', 'CardSurface.tsx', 'PowerCard.tsx', 'pnpm-lock.yaml']) assert(Object.keys(hashes).some(file => file.endsWith(name)), name);
  for (const name of ['entry.tsx', 'app.json', 'babel.config.js', 'metro.config.js', 'tailwind.config.js', 'tsconfig.json', 'eslint.config.js', 'package.json', 'README.md', 'static-server.cjs', 'static-server.test.cjs']) assert(Object.hasOwn(hashes, 'tools/card-gallery/' + name), name);
  assert(!Object.keys(hashes).some(file => file.startsWith('.tmp-qa-tools/')));
  assert.match(source, /pre-export manifest/); assert.match(source, /finalExport = exportHashes/); assert.match(source, /finalBundle = await frozenBundle/); assert.match(source, /Served HTML differs/);
});

test('promoted gallery typecheck includes the production CSS declaration without a new workspace', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'tools/card-gallery/tsconfig.json'), 'utf8'));
  assert(config.include.includes('../../apps/mobile/css.d.ts'));
  assert(config.include.includes('../../apps/mobile/nativewind-env.d.ts'));
  assert.equal(config.extends, '../../apps/mobile/tsconfig.json');
  assert.equal(config.compilerOptions.incremental, false);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'tools/card-gallery/package.json'))).private, true);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'utf8'), /tools/);
});
test('pass requires both contexts, no writes or errors and finite complete proof', () => {
  const good = { complete: true, frozen: true, calibration: { passed: true }, browserClosed: true, cleanup: [{ closed: true, authClear: true }, { closed: true, authClear: true }], blocked: [], errors: [], frames: [], cases: Array(24).fill({}) }; assert(h.passed(good));
  for (const bad of [{ ...good, frames: Array(73).fill({}) }, { ...good, cleanup: [] }, { ...good, failure: 'failed' }, { ...good, errors: ['asset changed'] }, { ...good, frozen: false }]) assert.equal(h.passed(bad), false);
});

test('different wrapped rows may have intrinsic heights without hiding same-row drift', () => {
  const result = measurement(); result.targets[2].root.top = 500; result.targets[2].face.height = 600; h.assertGeometry(result);
  result.targets[1].face.height = 405; assert.throws(() => h.assertGeometry(result), /Same-row/);
});

test('capture must retain exact current inventory and stable painted endpoints', () => {
  const rect = { left: 0, right: 200, top: 0, bottom: 400, width: 200, height: 400 };
  const before = { targets: [{ id: 'card-0', root: rect, face: rect }] }, after = structuredClone(before); h.assertStable(before, after);
  after.targets[0].face.bottom++; assert.throws(() => h.assertStable(before, after), /geometry changed/);
  after.targets[0].id = 'stale'; assert.throws(() => h.assertStable(before, after), /inventory changed/);
});

test('failed geometry retains raw measurements and failed assets retain their exact public path', () => {
  const start = source.indexOf('const measurements = await page.evaluate(geometry);');
  const end = source.indexOf('const selectors =', start);
  const block = source.slice(start, end);
  assert(block.indexOf('evidence.cases.push(caseEvidence); persist();') < block.indexOf('assertGeometry(measurements)'));
  assert.match(source, /Gallery asset failed: ' \+ url.pathname \+ ' HTTP ' \+ response.status\(\)/);
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'tools/card-gallery/app.json'), 'utf8'));
  assert.equal(config.expo.web.favicon, '../../apps/mobile/assets/favicon.png');
  assert(fs.existsSync(path.resolve(repo, 'tools/card-gallery', config.expo.web.favicon)));
  const entry = fs.readFileSync(path.join(repo, 'tools/card-gallery/entry.tsx'), 'utf8');
  assert.match(entry, /saboteurHandCardSize\(fontScale, 12 \* textScale\)/);
  assert.match(entry, /<TokyoDie[^>]+textScale=\{textScale\}/);
});

test('glyph overhang is clipped only by actual hidden or clip boundaries, including its own element', () => {
  function sample({ leafOverflow = 'visible', glyphLeft = 18, glyphRight = 62, glyphTop = 18, glyphBottom = 62, faceX = 'hidden', faceY = 'hidden' } = {}) {
    const css = { display: 'flex', visibility: 'visible', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', fontFamily: 'SpaceMono', borderTopLeftRadius: '0px', backgroundColor: 'rgba(0, 0, 0, 0)' };
    function element(bounds, style = {}) {
      return { isConnected: true, css: { ...css, ...style }, childNodes: [], parentElement: null,
        getBoundingClientRect: () => ({ ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }),
        closest: () => null, matches: () => false, getAttribute: () => 'card-0',
        contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
      };
    }
    const root = element({ left: 0, right: 100, top: 0, bottom: 100 });
    const face = element({ left: 0, right: 100, top: 0, bottom: 100 }, { overflow: 'hidden', overflowX: faceX, overflowY: faceY, borderTopLeftRadius: '14px', backgroundColor: 'rgb(10, 10, 10)' });
    const leaf = element({ left: 20, right: 60, top: 20, bottom: 60 }, { overflowX: leafOverflow, overflowY: leafOverflow });
    face.parentElement = root; leaf.parentElement = face;
    leaf.childNodes = [{ nodeType: 3, textContent: '1' }];
    root.querySelectorAll = selector => selector === '*' ? [face, leaf] : [];
    const context = { document: { querySelectorAll: () => [root], fonts: { status: 'loaded' }, images: [], getElementById: () => null },
      getComputedStyle: node => node.css, Node: { TEXT_NODE: 3 }, innerWidth: 320, innerHeight: 844,
      navigator: { maxTouchPoints: 1 }, matchMedia: () => ({ matches: true }), sessionStorage: { getItem: () => null },
      window: { __coupQATextGeometry: () => ({ glyphRects: [{ character: '1', left: glyphLeft, right: glyphRight, top: glyphTop, bottom: glyphBottom }] }) },
    };
    return vm.runInNewContext(`(${h.geometry.toString()})()`, context).targets[0].clipping;
  }
  assert.equal(sample({ glyphTop: 14, glyphBottom: 66 }).length, 0, 'visible font metrics are not clipping');
  for (const overflow of ['hidden', 'clip']) assert.equal(sample({ leafOverflow: overflow, glyphTop: 14 }).length, 1);
  for (const glyph of [{ glyphLeft: -3 }, { glyphRight: 103 }, { glyphTop: -3 }, { glyphBottom: 103 }]) assert.equal(sample(glyph).length, 1);
  assert.equal(sample({ faceX: 'visible', glyphLeft: -3 }).length, 0);
  assert.equal(sample({ faceY: 'visible', glyphTop: -3 }).length, 0);
});

test('unused blank pages need no forbidden storage read and navigated contexts must prove auth absent', async () => {
  const base = 'http://127.0.0.1:8083';
  let reads = 0;
  const page = (url, clean = true) => ({ url: () => url, evaluate: async () => { reads++; return clean; } });
  assert.deepEqual(await h.authState(undefined, base), { authClear: true, notNavigated: true });
  assert.deepEqual(await h.authState(page('about:blank'), base), { authClear: true, notNavigated: true });
  assert.equal(reads, 0);
  assert.deepEqual(await h.authState(page(base + '/?family=skull'), base), { authClear: true, notNavigated: false });
  assert.deepEqual(await h.authState(page(base, false), base), { authClear: false, notNavigated: false });
  await assert.rejects(h.authState(page('https://example.com'), base), /Unexpected cleanup origin/);
  assert.equal(reads, 2);
});

test('calibration cleanup preserves page-creation errors and closes only an acquired calibration page', async () => {
  const original = new Error('page creation failed');
  const failed = await h.calibrationBrowser({ newPage: async () => { throw original; } }).createBrowserContext();
  await assert.rejects(async () => { try { await failed.newPage(); } finally { await failed.close(); } }, error => error === original);
  let closed = 0;
  const page = { close: async () => { closed++; } };
  const ready = await h.calibrationBrowser({ newPage: async () => page }).createBrowserContext();
  await ready.close(); assert.equal(closed, 0);
  assert.equal(await ready.newPage(), page); await ready.close(); assert.equal(closed, 1);
});
