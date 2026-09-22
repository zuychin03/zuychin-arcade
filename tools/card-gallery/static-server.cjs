const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 8083;
const ROOT = path.resolve(__dirname, 'dist');
const HOSTS = new Set([HOST + ':' + PORT, 'localhost:' + PORT]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function requestPath(request) {
  if (!HOSTS.has(request.headers.host)) return { status: 421 };
  if (!['GET', 'HEAD'].includes(request.method)) return { status: 405 };
  if (request.headers.origin && ![...HOSTS].map(host => 'http://' + host).includes(request.headers.origin)) return { status: 403 };
  const raw = request.url;
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) return { status: 400 };
  let decoded;
  try { decoded = decodeURIComponent(raw.split('?')[0]); } catch { return { status: 400 }; }
  if (/[\\\x00-\x1f\x7f:%]/.test(decoded) || decoded.startsWith('//')) return { status: 400 };
  const parts = decoded.split('/');
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.') || part.endsWith('.') || part.endsWith(' ') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return { status: 403 };
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  if (!relative || relative.endsWith('/') || !MIME[path.extname(relative).toLowerCase()]) return { status: 404 };
  return { relative, status: 200 };
}

async function readFileSafely(relative, io = fs) {
  const file = path.resolve(ROOT, relative);
  assert(file.startsWith(ROOT + path.sep), 'Target must stay inside the dedicated gallery export');
  const rootInfo = await io.lstat(ROOT);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Gallery export must be a real directory');
  const actualRoot = await io.realpath(ROOT);
  const pieces = path.relative(ROOT, file).split(path.sep); let current = ROOT;
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece); const info = await io.lstat(current);
    assert(!info.isSymbolicLink(), 'Export symlinks are not served');
    assert(index === pieces.length - 1 ? info.isFile() : info.isDirectory(), 'Only real static files are served');
  }
  const actual = await io.realpath(file);
  assert(actual.startsWith(actualRoot + path.sep), 'Resolved asset escaped gallery export');
  return io.readFile(file);
}

function createHandler(io = fs) {
  return async (request, response) => {
    const result = requestPath(request);
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (result.status !== 200) { if (result.status === 405) headers.Allow = 'GET, HEAD'; response.writeHead(result.status, headers); response.end(); return; }
    try {
      const bytes = await readFileSafely(result.relative, io);
      response.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(result.relative).toLowerCase()], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 403, headers); response.end();
    }
  };
}

function ownShutdown(server, owner = process, timer = setTimeout) {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(); server.closeIdleConnections?.();
    timer(() => server.closeAllConnections?.(), 2000).unref?.();
    owner.removeListener('SIGINT', close); owner.removeListener('SIGTERM', close);
  };
  owner.once('SIGINT', close); owner.once('SIGTERM', close);
  return close;
}

async function main() {
  assert.equal(process.argv.length, 2, 'No target, host or port overrides are accepted');
  await readFileSafely('index.html');
  const server = http.createServer(createHandler());
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  ownShutdown(server);
  server.once('error', error => { console.error(JSON.stringify({ role: 'card-gallery-static', error: error.code ?? 'server-error' })); process.exitCode = 1; });
  server.listen(PORT, HOST, () => console.log(JSON.stringify({ role: 'card-gallery-static', pid: process.pid, origin: 'http://' + HOST + ':' + PORT, root: ROOT })));
}

module.exports = { ROOT, HOST, PORT, requestPath, readFileSafely, createHandler, ownShutdown };
if (require.main === module) main().catch(() => { console.error('Dedicated gallery export is unavailable or invalid'); process.exitCode = 1; });
