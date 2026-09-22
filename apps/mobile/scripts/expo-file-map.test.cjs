const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const packageRoot = path.dirname(require.resolve('@expo/metro-file-map/package.json'));
const crawlerPath = path.join(packageRoot, 'build/crawlers/node/index.js');
const fallbackPath = path.join(packageRoot, 'build/crawlers/node/fallback.js');
const crawlerSource = fs.readFileSync(crawlerPath, 'utf8');
const fallbackSource = fs.readFileSync(fallbackPath, 'utf8');
const rootDir = path.resolve(__dirname, 'virtual-file-map-fixture');
const { RootPathUtils } = require(path.join(packageRoot, 'build/lib/RootPathUtils.js'));

function kind(type, name) {
  return {
    name,
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'link',
    mtime: new Date(1234),
    size: 42,
  };
}

function fixtureFs() {
  const directories = new Map([
    [rootDir, [
      kind('link', 'placeholder.js'), kind('file', 'ordinary.js'), kind('link', 'real-link'),
      kind('link', 'vanished.js'), kind('link', 'cloud-dir'), kind('link', '.git'),
      kind('link', 'ignored.js'), kind('link', 'image.bin'),
    ]],
    [path.join(rootDir, 'cloud-dir'), [kind('file', 'inner.js')]],
  ]);
  const stats = new Map([
    ['placeholder.js', 'file'], ['ordinary.js', 'file'], ['real-link', 'link'],
    ['cloud-dir', 'directory'], ['.git', 'directory'], ['ignored.js', 'file'],
    ['image.bin', 'file'], [path.join('cloud-dir', 'inner.js'), 'file'],
  ]);
  const calls = { syncStats: [], asyncStats: [], reads: [] };
  const stat = (filePath) => {
    const type = stats.get(path.relative(rootDir, filePath));
    if (!type) throw Object.assign(new Error('Entry disappeared'), { code: 'ENOENT' });
    return kind(type);
  };
  const read = (directory) => {
    calls.reads.push(directory);
    assert(directories.has(directory), `Unexpected directory traversal: ${directory}`);
    return directories.get(directory);
  };
  return {
    calls,
    fs: {
      readdir: (directory, _options, callback) => setImmediate(() => callback(null, read(directory))),
      readdirSync: (directory) => read(directory),
      lstatSync: (filePath) => { calls.syncStats.push(filePath); return stat(filePath); },
      lstat: (filePath, callback) => {
        calls.asyncStats.push(filePath);
        setImmediate(() => {
          try { callback(null, stat(filePath)); } catch (error) { callback(error); }
        });
      },
      readlinkSync: (filePath) => {
        assert.equal(path.basename(filePath), 'real-link');
        return 'ordinary.js';
      },
    },
  };
}

function installedModule(filename, source, mockedFs) {
  const module = { exports: {} };
  const moduleRequire = createRequire(filename);
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    process: { platform: 'win32' },
    Map,
    Set,
    console,
    require: (name) => name === 'fs' ? mockedFs : moduleRequire(name),
  }, { filename });
  return module.exports;
}

const ignored = (filePath) => path.basename(filePath) === 'ignored.js';

function assertCorrectClassification(files, includeSymlinks) {
  assert.equal(files.get('placeholder.js')?.[4], 0, 'OneDrive file was classified as a symlink');
  assert.equal(files.get('ordinary.js')?.[4], 0);
  assert.equal(files.has('vanished.js'), false);
  assert.equal(files.has('ignored.js'), false);
  assert.equal(files.has('image.bin'), false, 'A corrected regular file bypassed extension filtering');
  assert.equal(files.has('.git'), false);
  assert.equal(files.has('real-link'), includeSymlinks);
  if (includeSymlinks) assert.equal(files.get('real-link')[4], 1, 'A real symlink was flattened');
}

for (const warm of [false, true]) {
  for (const includeSymlinks of [false, true]) {
    test(`Windows ${warm ? 'warm' : 'cold'} crawler classifies placeholders correctly with symlinks ${includeSymlinks ? 'enabled' : 'disabled'}`, async () => {
      const fixture = fixtureFs();
      const crawl = installedModule(crawlerPath, crawlerSource, fixture.fs).default;
      const result = await crawl({
        console,
        roots: [rootDir], rootDir, extensions: ['js'], ignore: ignored, includeSymlinks,
        previousState: {
          fileSystem: {
            getMtimeByNormalPath: () => warm ? 1234 : null,
            getDifference: (files) => ({ changedFiles: files, removedFiles: new Set() }),
          },
        },
      });
      assertCorrectClassification(result.changedFiles, includeSymlinks);
      assert.equal(result.changedFiles.get(path.join('cloud-dir', 'inner.js'))?.[4], 0, 'A placeholder directory was not traversed');
      assert.equal(result.changedFiles.get('placeholder.js')[0], warm ? 1234 : null);
      assert(!fixture.calls.syncStats.includes(path.join(rootDir, 'ordinary.js')), 'Ordinary Dirents should retain the fast path');
      assert(!fixture.calls.syncStats.includes(path.join(rootDir, 'ignored.js')), 'Ignored entries should not require lstat');
      assert.equal(fixture.calls.asyncStats.length > 0, warm);
      assert.equal(result.removedFiles.size, 0);
    });
  }
}

for (const includeSymlinks of [false, true]) {
  test(`Windows fallback readdir corrects placeholders with symlinks ${includeSymlinks ? 'enabled' : 'disabled'}`, () => {
    const fixture = fixtureFs();
    const createFallback = installedModule(fallbackPath, fallbackSource, fixture.fs).default;
    const fallback = createFallback({ rootPathUtils: new RootPathUtils(rootDir), extensions: ['js'], ignore: ignored, includeSymlinks });
    const files = fallback.readdir('', rootDir, null);
    assertCorrectClassification(files, includeSymlinks);
    assert(files.get('cloud-dir') instanceof Map, 'A placeholder directory was cached as a symlink');
    const nested = fallback.readdir('cloud-dir', path.join(rootDir, 'cloud-dir'), files.get('cloud-dir'));
    assert.equal(nested.get('inner.js')?.[4], 0);
    const reads = fixture.calls.reads.length;
    assert.equal(fallback.readdir('', rootDir, files), files);
    assert.equal(fixture.calls.reads.length, reads, 'An already crawled directory was scanned again');
    assert(!fixture.calls.syncStats.includes(path.join(rootDir, 'ordinary.js')));
    assert(!fixture.calls.syncStats.includes(path.join(rootDir, 'ignored.js')));
    assert.equal(fallback.lookup('placeholder.js', path.join(rootDir, 'placeholder.js'), null)[4], 0);
    assert.equal(fallback.lookup('vanished.js', path.join(rootDir, 'vanished.js'), null), null);
    const link = fallback.lookup('real-link', path.join(rootDir, 'real-link'), null);
    if (includeSymlinks) assert.equal(link[4], 'ordinary.js');
    else assert.equal(link, null);
  });
}
