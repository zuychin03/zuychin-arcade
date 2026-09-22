const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { URL } = require('node:url');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'validate-env.cjs'), 'utf8');

function validate(env = {}, args = []) {
  const messages = [];
  vm.runInNewContext(source, {
    URL,
    process: { env: { ...env }, argv: ['node', 'validate-env.cjs', ...args] },
    console: { log: (message) => messages.push(message) },
  }, { filename: 'validate-env.cjs' });
  return messages;
}

for (const [label, value, expected] of [
  ['missing', undefined, /is required/],
  ['blank', ' \t ', /is required/],
  ['relative', '/api', /absolute HTTP\(S\) URL/],
  ['malformed', 'https://', /absolute HTTP\(S\) URL/],
  ['non-HTTP', 'ftp://api.example.com', /use HTTP or HTTPS/],
  ['credentials', 'https://test-user:test-password@api.example.com', /credentials/],
  ['query', 'https://api.example.com?access=test-value', /query parameters/],
  ['fragment', 'https://api.example.com#test-value', /fragment/],
  ['path', 'https://api.example.com/api', /origin without a path/],
]) {
  test(`rejects ${label} API configuration without echoing its value`, () => {
    assert.throws(() => validate({ EXPO_PUBLIC_SERVER_URL: value }, ['--production']), (error) => {
      assert.match(error.message, expected);
      for (const marker of ['test-user', 'test-password', 'test-value']) {
        assert(!error.message.includes(marker));
      }
      return true;
    });
  });
}

test('accepts and normalises a valid production HTTPS origin', () => {
  assert.deepEqual(validate({ EXPO_PUBLIC_SERVER_URL: ' https://API.example.com:443/ ' }, ['--production']), [
    'Validated EXPO_PUBLIC_SERVER_URL (https://api.example.com).',
  ]);
});

test('permits local HTTP only outside production validation', () => {
  const env = { EXPO_PUBLIC_SERVER_URL: 'http://127.0.0.1:3213' };
  assert.equal(validate(env).length, 1);
  assert.throws(() => validate(env, ['--production']), /HTTPS in production/);
  assert.throws(() => validate({ ...env, NODE_ENV: 'production' }), /HTTPS in production/);
});

test('explicit production validation applies even under a development NODE_ENV', () => {
  assert.throws(() => validate({
    EXPO_PUBLIC_SERVER_URL: 'http://api.example.com', NODE_ENV: 'development',
  }, ['--production']), /HTTPS in production/);
});

test('checks native EAS builds before dependencies are installed', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['eas-build-pre-install'], 'node scripts/validate-env.cjs --production');
  assert.equal(manifest.scripts['validate:env:production'], manifest.scripts['eas-build-pre-install']);
  const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eas.json'), 'utf8')).build;
  for (const profile of Object.values(profiles)) assert.equal(profile.config, undefined);
});
