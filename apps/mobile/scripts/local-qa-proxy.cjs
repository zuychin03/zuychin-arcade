const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const forge = require('node-forge');
const mime = require('mime-types');

const workspaceRoot = path.resolve(__dirname, '../../..');
const exportRoot = path.join(workspaceRoot, 'apps/mobile/.expo-export-qa-web');
const certificateRoot = path.join(workspaceRoot, '.tmp-qa-evidence/local-tls');
const certificatePath = path.join(certificateRoot, 'localhost-cert.pem');
const keyPath = path.join(certificateRoot, 'localhost-key.pem');
const apiPort = 3213;
const proxyPort = 3214;
const staticPort = 8081;

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function prepareCertificate() {
  const realWorkspace = fs.realpathSync(workspaceRoot);
  for (const directory of [path.dirname(certificateRoot), certificateRoot]) {
    if (fs.existsSync(directory) && !within(realWorkspace, fs.realpathSync(directory))) {
      throw new Error('Certificate directory must remain inside this workspace');
    }
  }
  fs.mkdirSync(certificateRoot, { recursive: true, mode: 0o700 });
  if (!within(realWorkspace, fs.realpathSync(certificateRoot))) {
    throw new Error('Certificate directory must remain inside this workspace');
  }
  for (const filename of [certificatePath, keyPath]) {
    if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Certificate files must not be symbolic links');
  }
  let key;
  let cert;
  if (fs.existsSync(certificatePath) && fs.existsSync(keyPath)) {
    key = fs.readFileSync(keyPath);
    cert = fs.readFileSync(certificatePath);
    const existing = new crypto.X509Certificate(cert);
    const expected = existing.publicKey.export({ type: 'spki', format: 'der' });
    const actual = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
    if (!expected.equals(actual) || !existing.checkHost('localhost') || !existing.checkIP('127.0.0.1')) {
      throw new Error('Existing local QA certificate and key do not match the expected loopback identity');
    }
    if (Date.parse(existing.validTo) <= Date.now() + 3_600_000) { key = null; cert = null; }
  } else if (fs.existsSync(certificatePath) || fs.existsSync(keyPath)) {
    throw new Error('The local QA certificate pair is incomplete');
  }
  if (!key || !cert) {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
    certificate.serialNumber = `01${crypto.randomBytes(15).toString('hex')}`;
    certificate.validity.notBefore = new Date(Date.now() - 60_000);
    certificate.validity.notAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const subject = [{ name: 'commonName', value: 'localhost' }];
    certificate.setSubject(subject);
    certificate.setIssuer(subject);
    certificate.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
    ]);
    certificate.sign(forge.pki.privateKeyFromPem(pair.privateKey), forge.md.sha256.create());
    key = pair.privateKey;
    cert = forge.pki.certificateToPem(certificate);
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    fs.writeFileSync(certificatePath, cert, { mode: 0o600 });
  }
  const certificate = new crypto.X509Certificate(cert);
  const spki = crypto.createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  return { key, cert, spki, validTo: certificate.validTo };
}

function localRequest(req) {
  try {
    const hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
    return (hostname === 'localhost' || hostname === '127.0.0.1') && req.url?.startsWith('/');
  } catch { return false; }
}

function sendError(res, status, text) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function createStaticServer() {
  const realRoot = fs.realpathSync(exportRoot);
  if (!within(fs.realpathSync(workspaceRoot), realRoot) || !fs.statSync(path.join(realRoot, 'index.html')).isFile()) {
    throw new Error('The expected QA web export is unavailable');
  }
  return http.createServer((req, res) => {
    if (!localRequest(req)) return sendError(res, 403, 'Loopback host required');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Read-only static server');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return sendError(res, 400, 'Invalid path'); }
    if (/[\\:\0]/.test(pathname) || pathname.split('/').includes('..')) return sendError(res, 403, 'Invalid path');
    const relative = pathname.replace(/^\/+|\/+$/g, '');
    const requested = path.resolve(realRoot, relative);
    if (!within(realRoot, requested)) return sendError(res, 403, 'Invalid path');
    const candidates = relative === '' ? [path.join(realRoot, 'index.html')]
      : path.extname(relative) ? [requested] : [`${requested}.html`, path.join(requested, 'index.html'), requested];
    const findFile = (files) => {
      for (const filename of files) {
        try {
          const realFile = fs.realpathSync(filename);
          if (within(realRoot, realFile) && fs.statSync(realFile).isFile()) return realFile;
        } catch { /* Missing export routes continue to the next candidate. */ }
      }
      return null;
    };
    let filename = findFile(candidates);
    const status = filename ? 200 : 404;
    if (!filename && !path.extname(relative)) filename = findFile([path.join(realRoot, '+not-found.html')]);
    if (!filename) return sendError(res, 404, 'Not found');
    res.writeHead(status, {
      'content-type': mime.contentType(path.extname(filename)) || 'application/octet-stream',
      'content-length': fs.statSync(filename).size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filename);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

function createApiProxy(credentials) {
  const requestOptions = (req) => ({
    hostname: '127.0.0.1', port: apiPort, method: req.method, path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${apiPort}`, 'x-forwarded-proto': 'https' },
  });
  const server = https.createServer({ key: credentials.key, cert: credentials.cert }, (req, res) => {
    if (!localRequest(req)) return sendError(res, 403, 'Loopback host required');
    const upstream = http.request(requestOptions(req), (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('error', () => sendError(res, 502, 'Local QA API is unavailable'));
    upstream.setTimeout(60_000, () => upstream.destroy());
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, client, head) => {
    if (!localRequest(req)) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = http.request(requestOptions(req));
    upstream.setTimeout(10_000, () => upstream.destroy());
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      upstream.setTimeout(0);
      const headers = response.rawHeaders.reduce((lines, value, index, all) => index % 2 === 0 ? `${lines}${value}: ${all[index + 1]}\r\n` : lines, '');
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      client.on('error', () => socket.destroy());
      socket.on('error', () => client.destroy());
      client.on('close', () => socket.destroy());
      socket.on('close', () => client.destroy());
      client.pipe(socket).pipe(client);
    });
    upstream.on('response', (response) => {
      client.end(`HTTP/1.1 ${response.statusCode ?? 502} ${http.STATUS_CODES[response.statusCode] ?? 'Bad Gateway'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      response.resume();
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.end();
  });
  return server;
}

async function main() {
  if (process.argv.slice(2).some((arg) => !['--prepare', '--help'].includes(arg))) throw new Error('Only --prepare or --help are supported');
  if (process.argv.includes('--help')) {
    console.log('node apps/mobile/scripts/local-qa-proxy.cjs [--prepare]\nServes the fixed QA export on loopback8081 and forwards HTTPS3214 to HTTP3213. --prepare only creates or validates the local certificate.');
    return;
  }
  const credentials = prepareCertificate();
  const metadata = {
    staticUrl: `http://127.0.0.1:${staticPort}`, apiUrl: `https://localhost:${proxyPort}`,
    exportRoot, spki: credentials.spki, validTo: credentials.validTo,
    chromeArgument: `--ignore-certificate-errors-spki-list=${credentials.spki}`,
  };
  if (process.argv.includes('--prepare')) { console.log(JSON.stringify({ event: 'local_qa_prepared', ...metadata })); return; }
  const servers = [createStaticServer(), createApiProxy(credentials)];
  const sockets = new Set();
  for (const server of servers) server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const close = () => { for (const socket of sockets) socket.destroy(); for (const server of servers) server.close(); };
  try {
    for (const [index, port] of [staticPort, proxyPort].entries()) {
      await new Promise((resolve, reject) => { servers[index].once('error', reject); servers[index].listen({ host: '127.0.0.1', port }, resolve); });
    }
  } catch (error) { close(); throw error; }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  console.log(JSON.stringify({ event: 'local_qa_listening', ...metadata }));
}

module.exports = { prepareCertificate, createStaticServer, createApiProxy };
if (require.main === module) main().catch((error) => { console.error(`Local QA helper failed: ${error.message}`); process.exitCode = 1; });
