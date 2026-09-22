const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rootRequire = createRequire(path.join(root, 'package.json'));
const metro = rootRequire('metro/private/Assets');
const query = rootRequire('query-string');
const icon = path.join(root, 'apps/mobile/assets/icon.png');

function packageVersion(name, from = rootRequire) {
  let directory = path.dirname(from.resolve(name));
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`No package manifest found for ${name}`);
}

test('Metro consumes patched image-size 2.0.3', () => {
  const fromMetro = createRequire(rootRequire.resolve('metro/private/Assets'));
  assert.equal(packageVersion('image-size', fromMetro), '2.0.3');
  assert.equal(typeof fromMetro('image-size').default, 'function');
});

test('Metro Buffer dimensions and validation remain intact', () => {
  assert.deepEqual(metro.getAssetSize('png', fs.readFileSync(icon), icon), { width: 1024, height: 1024 });
  assert.equal(metro.getAssetSize('txt', Buffer.from('text'), 'text.txt'), null);
  assert.throws(() => metro.getAssetSize('png', Buffer.alloc(0), 'empty.png'), /cannot be an empty file/);
  assert.throws(() => metro.getAssetSize('png', Buffer.from('not an image'), 'bad.png'));
});

test('Metro filesystem asset dimensions work through the actual export path', async () => {
  const result = await metro.getAssetData(icon, 'icon.png', [], 'web', '/assets');
  assert.equal(result.width, 1024);
  assert.equal(result.height, 1024);
  assert.equal(result.type, 'png');
  assert.deepEqual(result.files, [icon]);
  await assert.rejects(metro.getAssetData(path.join(root, 'absent-dependency-compat.png'), 'absent.png', [], 'web', '/assets'));
});

test('query-string consumes decode-uri-component 0.5.0', () => {
  const fromQuery = createRequire(rootRequire.resolve('query-string'));
  assert.equal(packageVersion('decode-uri-component', fromQuery), '0.5.0');
  assert.equal(typeof fromQuery('decode-uri-component').default, 'function');
});

test('upstream decoder needs only standard ECMAScript globals', () => {
  const fromQuery = createRequire(rootRequire.resolve('query-string'));
  assert.equal(packageVersion('decode-uri-component', fromQuery), '0.5.0');
  const source = fs.readFileSync(fromQuery.resolve('decode-uri-component'), 'utf8');
  assert.doesNotMatch(source, /\b(?:TextDecoder|TextEncoder|Buffer|require|import)\b/);
  const context = vm.createContext({ TextDecoder: undefined, TextEncoder: undefined, Buffer: undefined });
  vm.runInContext(source.replace('export default function decodeUriComponent', 'function decodeUriComponent'), context);
  assert.equal(vm.runInContext('decodeUriComponent("%E2%9C%93")', context), '✓');
  assert.equal(vm.runInContext('decodeUriComponent("a+b")', context), 'a+b');
  assert.equal(vm.runInContext('decodeUriComponent("%E0%A4%A")', context), '%E0%A4%A');
  assert.throws(() => vm.runInContext('decodeUriComponent(42)', context), /encodedURI.*string/);
});

test('query-string preserves Unicode, plus, repeated keys and URL semantics', () => {
  assert.equal(query.parse('q=hello+world').q, 'hello world');
  assert.equal(query.parse('q=%2B').q, '+');
  assert.equal(query.parse('q=%E2%9C%93').q, '✓');
  assert.deepEqual(query.parse('x=1&x=2').x, ['1', '2']);
  const result = query.parseUrl('https://example.test/path?q=a%2Bb#anchor', { parseFragmentIdentifier: true });
  assert.equal(result.url, 'https://example.test/path');
  assert.equal(result.query.q, 'a+b');
  assert.equal(result.fragmentIdentifier, 'anchor');
});

test('query-string tolerates malformed escapes without changing literal plus policy', () => {
  for (const input of ['%', '%E0%A4%A', '%FF', '%C0%AF']) {
    assert.equal(typeof query.parse(`q=${input}`).q, 'string');
  }
  assert.equal(query.parse('q=%').q, '%');
  assert.equal(query.parse('q=%E0%A4%A').q, '%E0%A4%A');
  assert.equal(query.parse('q=a+b', { decode: false }).q, 'a+b');
});

test('xcode uses uuid 11.1.1 and produces its required unique 24-character keys', () => {
  const file = rootRequire.resolve('xcode/lib/pbxProject');
  assert.equal(packageVersion('uuid', createRequire(file)), '11.1.1');
  const Project = rootRequire(file);
  const project = new Project('memory-only.xcodeproj');
  project.hash = { project: { objects: {} } };
  const ids = Array.from({ length: 1000 }, () => project.generateUuid());
  assert.equal(new Set(ids).size, 1000);
  assert.ok(ids.every(id => /^[A-F0-9]{24}$/.test(id)));
});

for (const owner of ['tsup', 'tsx']) {
  test(`${owner} esbuild JavaScript/native pair is 0.28.1 and transforms TypeScript`, () => {
    const fromOwner = createRequire(rootRequire.resolve(`${owner}/package.json`));
    const esbuild = fromOwner('esbuild');
    assert.equal(esbuild.version, '0.28.1');
    const result = esbuild.transformSync('export const value: number = 1;', { loader: 'ts', format: 'cjs' });
    assert.match(result.code, /value = 1/);
    assert.throws(() => esbuild.transformSync('const = ;', { loader: 'ts' }), /Transform failed/);
  });
}
