const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function buildWorker(directory) {
  const root = path.resolve(directory);
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(folder, entry.name);
      const info = fs.lstatSync(full);
      if (info.isSymbolicLink()) throw new Error('PWA export must not contain symlinks');
      if (info.isDirectory()) walk(full);
      else if (info.isFile()) files.push('/' + path.relative(root, full).split(path.sep).join('/'));
      else throw new Error('PWA export must contain only regular files and directories');
    }
  }
  walk(root);
  for (const file of PRECACHE) if (!files.includes(file)) throw new Error(`Missing PWA public file: ${file}`);
  const allowed = files.filter(file => PRECACHE.includes(file) || (/^\/(?:assets|_expo\/static)\//.test(file) && /[.-][a-f0-9]{16,64}\.(?:js|css|woff2?|ttf|otf|png|webp|jpe?g|svg|ico)$/i.test(file)));
  const assets = Object.fromEntries(allowed.sort().map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return [file, { bytes: bytes.length, sha256: digest(bytes) }];
  }));
  const template = fs.readFileSync(path.join(__dirname, '../pwa/service-worker.js'), 'utf8');
  const policy = { assets, precache: PRECACHE, maxEntries: 400, maxBytes: 20 * 1024 * 1024 };
  const version = digest(JSON.stringify(policy) + template).slice(0, 24);
  const config = { version, ...policy };
  const faviconVersion = files.includes('/favicon.ico') ? digest(fs.readFileSync(path.join(root, 'favicon.ico'))).slice(0, 16) : null;
  return { version, config, source: template.replace('null /* PWA_CONFIG */', JSON.stringify(config)), faviconVersion, htmlFiles: files.filter(file => file.endsWith('.html')) };
}

function versionFaviconLinks(directory, build) {
  if (!build.faviconVersion) return;
  for (const file of build.htmlFiles) {
    const filename = path.join(directory, file);
    const html = fs.readFileSync(filename, 'utf8');
    const updated = html.replace(/href=(["'])\/favicon\.ico(?:\?[^"']*)?\1/g, `href="/favicon.ico?v=${build.faviconVersion}"`);
    if (updated !== html) fs.writeFileSync(filename, updated);
  }
}

if (require.main === module) {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '../dist'));
  versionFaviconLinks(directory, buildWorker(directory));
  const result = buildWorker(directory);
  fs.writeFileSync(path.join(directory, 'service-worker.js'), result.source);
  console.log(`PWA worker ${result.version}: ${Object.keys(result.config.assets).length} allowlisted assets, ${PRECACHE.length} precached public files`);
}
module.exports = { buildWorker, versionFaviconLinks, PRECACHE };
