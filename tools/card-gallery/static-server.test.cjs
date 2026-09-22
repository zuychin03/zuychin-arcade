const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const h = require('./static-server.cjs');
const request = (url = '/', method = 'GET', host = '127.0.0.1:8083') => ({ url, method, headers: { host } });

function memoryFiles({ symlink = false, escaped = false, missing = false } = {}) {
  const bytes = Buffer.from('<html>QA-only</html>');
  return {
    lstat: async file => { if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isSymbolicLink: () => symlink && file !== h.ROOT, isDirectory: () => file === h.ROOT || !path.extname(file), isFile: () => Boolean(path.extname(file)) }; },
    realpath: async file => escaped && file !== h.ROOT ? path.resolve(h.ROOT, '../secret.html') : file,
    readFile: async () => bytes,
  };
}

test('server target and bind are fixed to gallery dist and loopback8083', () => {
  assert.equal(h.HOST, '127.0.0.1'); assert.equal(h.PORT, 8083); assert.equal(h.ROOT, path.resolve(__dirname, 'dist'));
  assert.deepEqual(h.requestPath(request('/?family=libertalia')), { relative: 'index.html', status: 200 });
  assert.equal(h.requestPath(request('/assets/font.ttf')).status, 200);
  assert.equal(h.requestPath(request('/', 'HEAD', 'localhost:8083')).status, 200);
});

test('rejects foreign hosts origins and every mutation method', () => {
  for (const host of ['example.com:8083', '127.0.0.1:8081', '127.0.0.1:8083.evil.test', undefined]) { const r = request(); r.headers.host = host; assert.equal(h.requestPath(r).status, 421); }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT']) assert.equal(h.requestPath(request('/', method)).status, 405);
  const r = request(); r.headers.origin = 'https://example.com'; assert.equal(h.requestPath(r).status, 403);
});

test('rejects raw encoded and double-encoded traversal plus Windows aliases and alternate streams', () => {
  for (const url of ['/../secret.html', '/%2e%2e/secret.html', '/%252e%252e/secret.html', '/a/./b.js', '/a\\b.js', '/a%5cb.js', '/C:/secret.html', '/file.js:secret', '/.env', '/file.js.', '/file.js%20', '/con.js', '/x/%00.js', '/%ZZ.js', '//example.com/x.js', 'http://127.0.0.1:8083/x.js']) assert.notEqual(h.requestPath(request(url)).status, 200, url);
  assert.equal(h.requestPath(request('/folder/')).status, 404); assert.equal(h.requestPath(request('/secret.txt')).status, 404);
});

test('safe reads reject symlinks realpath escapes and sibling-prefix traversal', async () => {
  assert.match(String(await h.readFileSafely('index.html', memoryFiles())), /QA-only/);
  await assert.rejects(h.readFileSafely('index.html', memoryFiles({ symlink: true })), /symlinks/);
  await assert.rejects(h.readFileSafely('index.html', memoryFiles({ escaped: true })), /escaped/);
  await assert.rejects(h.readFileSafely('../dist-other/index.html', memoryFiles()), /inside/);
});

test('GET and HEAD preserve bytes and MIME without directory listing or caching', async () => {
  const run = async (r, io = memoryFiles()) => { const output = {}; await h.createHandler(io)(r, { writeHead(status, headers) { Object.assign(output, { status, headers }); }, end(body) { output.body = body; } }); return output; };
  const get = await run(request()); assert.equal(get.status, 200); assert.match(String(get.body), /QA-only/); assert.equal(get.headers['Cache-Control'], 'no-store'); assert.equal(get.headers['Content-Type'], 'text/html; charset=utf-8');
  const head = await run(request('/', 'HEAD')); assert.equal(head.status, 200); assert.equal(head.body, undefined); assert.equal(head.headers['Content-Length'], get.body.length);
  assert.equal((await run(request(), memoryFiles({ missing: true }))).status, 404);
  assert.equal((await run(request(), memoryFiles({ symlink: true }))).status, 403);
  assert.equal((await run(request('/', 'POST'))).headers.Allow, 'GET, HEAD');
});

test('shutdown owns only its server, is idempotent and bounds keepalive closure', () => {
  const owner = new EventEmitter(); let closed = 0, idle = 0, all = 0, expiry;
  const close = h.ownShutdown({ close() { closed++; }, closeIdleConnections() { idle++; }, closeAllConnections() { all++; } }, owner, (fn, milliseconds) => { assert.equal(milliseconds, 2000); expiry = fn; return { unref() {} }; });
  owner.emit('SIGTERM'); close(); assert.equal(closed, 1); assert.equal(idle, 1); assert.equal(all, 0); expiry(); assert.equal(all, 1); assert.equal(owner.listenerCount('SIGINT'), 0); assert.equal(owner.listenerCount('SIGTERM'), 0);
});
