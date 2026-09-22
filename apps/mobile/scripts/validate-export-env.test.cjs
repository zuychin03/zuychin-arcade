const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateExport } = require('./validate-export-env.cjs');

const expected = 'https://arcade-api.example.com';
const env = { EXPO_PUBLIC_SERVER_URL: expected };

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-export-env-test-'));
  t.after(() => {
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
    assert(!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(root).startsWith('arcade-export-env-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  return root;
}

test('accepts quoted generated JavaScript literals without requiring the URL in unrelated chunks', (t) => {
  const root = fixture(t, {
    '_expo/static/js/web/entry.js': `const url=${JSON.stringify(expected)};`,
    '_expo/static/js/web/vendor.js': 'const vendor=true;',
  });
  assert.deepEqual(validateExport(root, env).map((group) => [group.platform, group.files]), [['web', 2]]);
});

test('accepts single quotes, escaped slashes and trimmed environment input', (t) => {
  const root = fixture(t, { '_expo/static/js/web/entry.js': `const url='${expected.replaceAll('/', '\\/')}';` });
  assert.equal(validateExport(root, { EXPO_PUBLIC_SERVER_URL: ` ${expected} ` }).length, 1);
});

test('rejects stale origins and JavaScript prefix lookalikes', (t) => {
  for (const actual of ['https://old-api.example.com', `${expected}.invalid`]) {
    const root = fixture(t, { '_expo/static/js/web/entry.js': `const url=${JSON.stringify(actual)};` });
    assert.throws(() => validateExport(root, env), /literal is missing.*web/);
  }
});

test('does not count URLs found only in HTML or source maps', (t) => {
  const root = fixture(t, {
    'index.html': expected,
    '_expo/static/js/web/entry.js.map': JSON.stringify({ sourceContent: [expected] }),
    '_expo/static/js/web/entry.js': 'const url="https://old-api.example.com";',
  });
  assert.throws(() => validateExport(root, env), /literal is missing/);
});

test('checks every exported platform independently', (t) => {
  const root = fixture(t, {
    '_expo/static/js/web/entry.js': `const url=${JSON.stringify(expected)};`,
    '_expo/static/js/android/entry.js': 'const url="https://old-api.example.com";',
  });
  assert.throws(() => validateExport(root, env), /literal is missing.*android/);
});

test('checks Hermes binary storage without treating it as JavaScript text', (t) => {
  const magic = Buffer.from('c61fbc03c103191f', 'hex');
  const root = fixture(t, {
    '_expo/static/js/android/entry.hbc': Buffer.concat([magic, Buffer.from([0, 255]), Buffer.from(expected), Buffer.from([0])]),
    '_expo/static/js/ios/entry.hbc': Buffer.concat([magic, Buffer.from(expected, 'utf16le')]),
  });
  assert(validateExport(root, env).every((group) => group.hermes));
  assert.throws(() => validateExport(root, { EXPO_PUBLIC_SERVER_URL: 'https://localhost:3214' }), /literal is missing.*android.*ios/);
});

test('rejects invalid Hermes signatures, absent output and exports without bundles', (t) => {
  const invalid = fixture(t, { '_expo/static/js/android/entry.hbc': Buffer.from(expected) });
  assert.throws(() => validateExport(invalid, env), /Invalid Hermes bundle signature/);
  const empty = fixture(t, { 'index.html': expected });
  assert.throws(() => validateExport(empty, env), /no generated.*bundle directory/);
  assert.throws(() => validateExport(path.join(empty, 'missing'), env), /does not exist/);
});

test('validates production origin input without exposing credential values', (t) => {
  const root = fixture(t, { '_expo/static/js/web/entry.js': `const url=${JSON.stringify(expected)};` });
  for (const value of [undefined, 'http://localhost:3213', 'https://host.example/path', 'https://secret-user:secret-password@host.example']) {
    assert.throws(() => validateExport(root, { EXPO_PUBLIC_SERVER_URL: value }), (error) => {
      assert(!error.message.includes('secret-password'));
      return /EXPO_PUBLIC_SERVER_URL/.test(error.message);
    });
  }
});
