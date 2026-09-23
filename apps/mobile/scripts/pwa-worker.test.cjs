const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Buffer } = require('node:buffer');
const { createHash, webcrypto } = require('node:crypto');
const test = require('node:test');
const { buildWorker, PRECACHE } = require('./build-pwa.cjs');

const origin = 'https://arcade.example';
const asset = '/assets/public.0123456789abcdef0123456789abcdef.webp';
const hash = value => createHash('sha256').update(value).digest('hex');
const template = fs.readFileSync(path.join(__dirname, '../pwa/service-worker.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const contents = { '/offline.html': '<h1>Reconnect to play</h1>', [asset]: 'public pixels', ...options.contents };
  const config = { version: 'test', assets: Object.fromEntries(Object.entries(contents).map(([key, value]) => [key, { bytes: Buffer.byteLength(value), sha256: hash(value) }])), precache: ['/offline.html'], maxEntries: 400, maxBytes: 20 * 1024 * 1024, ...options.config };
  const listeners = {}, stores = new Map(), timers = new Map(), messages = [], fetched = [];
  let timerId = 0, skipped = 0, claimed = 0, now = 1000;
  let clients = ['a', 'b'].map(id => ({ id, postMessage: message => messages.push({ client: id, ...message }) }));
  let network = request => Promise.resolve(new Response(contents[new URL(typeof request === 'string' ? request : request.url).pathname] ?? 'online route'));
  let storageFails = false, putFails = false, clientLookup = null;
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
    return {
      keys: async () => [...entries.keys()].map(url => ({ url })),
      match: async request => entries.get(key(request))?.clone(),
      put: async (request, response) => { if (putFails) throw new Error('QuotaExceededError'); entries.set(key(request), response.clone()); },
      delete: async request => entries.delete(key(request)),
    };
  }
  const self = { location: { origin }, crypto: webcrypto, addEventListener: (type, callback) => { listeners[type] = callback; }, skipWaiting: async () => { skipped++; }, clients: { matchAll: async options => { assert.equal(options.includeUncontrolled, true); return clientLookup ? clientLookup() : clients; }, claim: async () => { claimed++; } } };
  const context = { self, URL, Request, Response, Uint8Array, Promise, Set, Date: { now: () => now }, setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), fetch: request => { fetched.push(request); return network(request); }, caches: { open: async name => { if (storageFails) throw new Error('storage denied'); return store(name); }, keys: async () => [...stores.keys()], delete: async name => stores.delete(name) } };
  vm.runInNewContext(template.replace('null /* PWA_CONFIG */', JSON.stringify(config)), context);
  function lifecycle(type) { const pending = []; listeners[type]({ waitUntil: promise => pending.push(promise) }); return Promise.all(pending); }
  async function fetchEvent(url, extras = {}) {
    const pending = []; let response;
    listeners.fetch({ request: { url: new URL(url, origin).href, method: 'GET', mode: 'cors', ...extras }, respondWith: promise => { response = Promise.resolve(promise); }, waitUntil: promise => pending.push(promise) });
    const resolved = await response;
    await Promise.all(pending);
    return resolved;
  }
  function message(data, id = 'a') {
    const pending = [];
    const source = clients.find(client => client.id === id) || { id, postMessage: message => messages.push({ client: id, ...message }) };
    listeners.message({ data, source, waitUntil: promise => pending.push(promise) });
    return Promise.all(pending);
  }
  return { config, stores, messages, fetched, store, lifecycle, fetchEvent, message, get skipped() { return skipped; }, get claimed() { return claimed; }, setNetwork(fn) { network = fn; }, failStorage() { storageFails = true; }, failPut() { putFails = true; }, setClients(ids) { clients = ids.map(id => ({ id, postMessage: message => messages.push({ client: id, ...message }) })); }, setLookup(fn) { clientLookup = fn; }, advance(ms) { now += ms; }, timeout() { for (const callback of [...timers.values()]) callback(); } };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-pwa-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  function write(file, content = 'fixture') { const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  for (const file of PRECACHE) write(file);
  return { directory, write };
}

test('build selects only hashed public static files and exact precache paths', t => {
  const f = fixture(t);
  for (const file of ['assets/font.0123456789abcdef.ttf', '_expo/static/js/web/index-0123456789abcdef.js', 'assets/card.0123456789abcdef.webp']) f.write(file);
  for (const file of ['index.html', 'coup/game.html', 'api/private.0123456789abcdef.js', 'assets/private.0123456789abcdef.json', 'assets/plain.js', 'manifest.webmanifest', 'service-worker.js', 'assets/map.0123456789abcdef.js.map']) f.write(file);
  const result = buildWorker(f.directory);
  assert.equal(Object.keys(result.config.assets).length, 8);
  assert.deepEqual(result.config.precache, PRECACHE);
  assert.equal(result.config.maxEntries, 400); assert.equal(result.config.maxBytes, 20 * 1024 * 1024);
  new vm.Script(result.source);
});

test('version is deterministic and content-sensitive, never affected by route HTML or previous worker output', t => {
  const f = fixture(t); f.write(asset, 'one');
  const first = buildWorker(f.directory);
  assert.equal(buildWorker(f.directory).source, first.source);
  f.write('index.html', 'private route'); f.write('service-worker.js', first.source);
  assert.equal(buildWorker(f.directory).version, first.version);
  f.write(asset, 'two'); assert.notEqual(buildWorker(f.directory).version, first.version);
});

test('build traverses directories even when enumeration loses directory metadata', t => {
  const f = fixture(t); f.write('assets/nested/card.0123456789abcdef.webp', 'pixels');
  const expected = buildWorker(f.directory);
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (...args) => readDirectory(...args).map(entry => ({ name: entry.name, isDirectory: () => false, isSymbolicLink: () => false })));
  assert.equal(buildWorker(f.directory).source, expected.source);
});

test('build rejects symlinks based on filesystem metadata', t => {
  const f = fixture(t); f.write('assets/linked.0123456789abcdef.webp');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (file, ...args) => file.endsWith('linked.0123456789abcdef.webp') ? { isSymbolicLink: () => true } : lstat(file, ...args));
  assert.throws(() => buildWorker(f.directory), /must not contain symlinks/);
});

test('build fails closed when offline page or icons are missing', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.directory, 'offline.html'));
  assert.throws(() => buildWorker(f.directory), /Missing PWA public file/);
});

test('installation caches only small precache set without forcing activation', async () => {
  const h = harness(); await h.lifecycle('install');
  assert.equal(h.fetched.length, 1); assert.equal(h.fetched[0].credentials, 'omit');
  assert.equal(h.skipped, 0);
  assert.equal((await h.store('zuychin-public-test').keys()).length, 1);
});

test('navigation is always network-first and never caches successful room HTML', async () => {
  const h = harness(); await h.lifecycle('install');
  const response = await h.fetchEvent('/coup/game', { mode: 'navigate' });
  assert.equal(await response.text(), 'online route');
  assert.deepEqual((await h.store('zuychin-public-test').keys()).map(key => new URL(key.url).pathname), ['/offline.html']);
  h.setNetwork(() => Promise.reject(new Error('offline')));
  assert.equal(await (await h.fetchEvent('/coup/game', { mode: 'navigate' })).text(), '<h1>Reconnect to play</h1>');
});

test('navigation returns safe plain fallback when cache storage is unavailable', async () => {
  const h = harness(); h.failStorage(); h.setNetwork(() => Promise.reject(new Error('offline')));
  const response = await h.fetchEvent('/bang/game', { mode: 'navigate' });
  assert.equal(response.status, 503); assert.match(await response.text(), /Reconnect/);
});

test('query, foreign, private, JSON and non-GET requests are not intercepted', async () => {
  const h = harness();
  for (const [url, extras] of [[asset + '?token=secret', {}], ['https://other.example' + asset, {}], ['/api/profile', {}], ['/session.json', {}], [asset, { method: 'POST' }], ['/coup/game?room=private', { mode: 'navigate' }]]) assert.equal(await h.fetchEvent(url, extras), undefined);
  assert.equal(h.fetched.length, 0);
});

test('public assets cache lazily only when exact bytes and digest match', async () => {
  const h = harness(); await h.fetchEvent(asset); await h.fetchEvent(asset);
  assert.equal(h.fetched.length, 1);
  const bad = harness(); bad.setNetwork(() => Promise.resolve(new Response('wrong pixels!')));
  await bad.fetchEvent(asset); assert.equal((await bad.store('zuychin-public-test').keys()).length, 0);
});

test('error and redirect responses are not cached', async () => {
  for (const response of [new Response('public pixels', { status: 500 }), Response.redirect(origin + '/login')]) {
    const h = harness(); h.setNetwork(() => Promise.resolve(response)); await h.fetchEvent(asset);
    assert.equal((await h.store('zuychin-public-test').keys()).length, 0);
  }
});

test('serialized cache writes enforce entry and byte bounds while protecting offline fallback', async () => {
  const second = '/assets/second.0123456789abcdef.webp', third = '/assets/third.0123456789abcdef.webp';
  const h = harness({ contents: { [second]: 'second', [third]: 'third' }, config: { maxEntries: 2, maxBytes: 40 } });
  await h.lifecycle('install'); await Promise.all([h.fetchEvent(asset), h.fetchEvent(second), h.fetchEvent(third)]);
  const keys = (await h.store('zuychin-public-test').keys()).map(key => new URL(key.url).pathname);
  assert(keys.includes('/offline.html')); assert(keys.length <= 2);
  assert(keys.reduce((sum, key) => sum + h.config.assets[key].bytes, 0) <= 40);
});

test('quota failure preserves online response and existing offline page', async () => {
  const h = harness(); await h.lifecycle('install'); h.failPut();
  assert.equal(await (await h.fetchEvent(asset)).text(), 'public pixels');
  assert(await h.store('zuychin-public-test').match('/offline.html'));
});

test('activation deletes only retired app caches', async () => {
  const h = harness(); h.store('zuychin-public-old'); h.store('unrelated-cache');
  await h.lifecycle('activate'); assert(!h.stores.has('zuychin-public-old')); assert(h.stores.has('unrelated-cache')); assert.equal(h.claimed, 1);
});

async function start(h, requestId = 'request-123') { const pending = h.message({ type: 'REQUEST_UPDATE', requestId }); await tick(); return { pending, requestId }; }
const safe = (h, requestId, id, value = true) => h.message({ type: 'UPDATE_SAFETY', requestId, safe: value }, id);

test('only all current window clients approving activates and broadcasts approval', async () => {
  const h = harness(), attempt = await start(h);
  assert.equal(h.messages.filter(item => item.type === 'CHECK_UPDATE_SAFETY').length, 2);
  await safe(h, attempt.requestId, 'a'); assert.equal(h.skipped, 0);
  await safe(h, attempt.requestId, 'b'); await attempt.pending;
  assert.equal(h.skipped, 1); assert.equal(h.messages.filter(item => item.type === 'UPDATE_APPROVED').length, 2);
});

test('unsafe or timed-out clients broadcast blocked to every captured window', async () => {
  for (const timeout of [false, true]) {
    const h = harness(), attempt = await start(h);
    await safe(h, attempt.requestId, 'a');
    if (timeout) h.timeout(); else await safe(h, attempt.requestId, 'b', false);
    await attempt.pending; assert.equal(h.skipped, 0); assert.equal(h.messages.filter(item => item.type === 'UPDATE_BLOCKED').length, 2);
  }
});

test('forged clients, wrong nonces and raw skip messages cannot authorise activation', async () => {
  const h = harness(), attempt = await start(h);
  await safe(h, attempt.requestId, 'forged'); await safe(h, 'wrong-nonce', 'b');
  await h.message({ type: 'SKIP_WAITING', requestId: attempt.requestId }); await safe(h, attempt.requestId, 'a');
  assert.equal(h.skipped, 0); h.timeout(); await attempt.pending;
});

test('fresh client-set check blocks new or closed tabs', async () => {
  for (const ids of [['a', 'b', 'c'], ['a']]) {
    const h = harness(), attempt = await start(h); await safe(h, attempt.requestId, 'a');
    h.setLookup(async () => ids.map(id => ({ id })));
    await safe(h, attempt.requestId, 'b'); await attempt.pending; assert.equal(h.skipped, 0);
    assert(h.messages.some(item => item.reason === 'client-set-changed'));
  }
});

test('deadline is checked after delayed final lookup before activation', async () => {
  const h = harness(), attempt = await start(h); await safe(h, attempt.requestId, 'a');
  h.setLookup(async () => { h.advance(8001); return [{ id: 'a' }, { id: 'b' }]; });
  await safe(h, attempt.requestId, 'b'); await attempt.pending;
  assert.equal(h.skipped, 0); assert(h.messages.some(item => item.reason === 'safety-timeout'));
});

test('overlapping and reused update requests cannot consume stale approvals', async () => {
  const h = harness(), attempt = await start(h);
  await h.message({ type: 'REQUEST_UPDATE', requestId: 'request-456' });
  assert(h.messages.some(item => item.reason === 'update-in-progress'));
  h.timeout(); await attempt.pending;
  await h.message({ type: 'REQUEST_UPDATE', requestId: attempt.requestId });
  await safe(h, attempt.requestId, 'a'); await safe(h, attempt.requestId, 'b');
  assert.equal(h.skipped, 0); assert(h.messages.some(item => item.reason === 'request-reused'));
});

test('unknown requester is rejected without starting a safety handshake', async () => {
  const h = harness(); await h.message({ type: 'REQUEST_UPDATE', requestId: 'request-123' }, 'forged');
  assert.equal(h.skipped, 0); assert(!h.messages.some(item => item.type === 'CHECK_UPDATE_SAFETY'));
});
