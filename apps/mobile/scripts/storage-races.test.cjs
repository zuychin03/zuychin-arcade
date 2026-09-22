const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const auth = (token) => ({ token, playerId: 'p0', roomCode: '7KPM-R4TX', displayName: 'Tester' });

function storage(platform, overrides = {}) {
  const values = new Map();
  const calls = [];
  const memory = {
    getItem: (key) => { calls.push('read'); return values.get(key) ?? null; },
    setItem: (key, value) => { calls.push('write'); values.set(key, value); },
    removeItem: (key) => { calls.push('remove'); values.delete(key); },
  };
  const secure = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    getItemAsync: async (key) => { const value = memory.getItem(key); await overrides.read?.(); return value; },
    setItemAsync: async (key, value, options) => {
      assert.equal(options.keychainAccessible, 'device-only');
      await overrides.write?.(value);
      memory.setItem(key, value);
    },
    deleteItemAsync: async (key) => { await overrides.remove?.(); memory.removeItem(key); },
  };
  const modules = {
    '@react-native-async-storage/async-storage': { default: { getItem: async (key) => memory.getItem(key), setItem: async (key, value) => memory.setItem(key, value) } },
    'expo-secure-store': secure,
    'react-native': { Platform: { OS: platform } },
    '@zuychin-arcade/types': { ROOM_CODE_PATTERN: /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/ },
  };
  const filename = path.join(__dirname, '../lib/storage.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, sessionStorage: memory, require: (name) => { assert(name in modules, name); return modules[name]; } }, { filename });
  return { ...exports, calls, values, key: platform === 'web' ? 'za:auth' : 'za.auth' };
}

for (const platform of ['web', 'ios', 'android']) {
  test(platform + ' saves and clears credentials, but skips cancelled writes', async () => {
    const s = storage(platform);
    assert.equal(await s.saveAuthIfCurrent(auth('cancelled'), () => false), false);
    assert.equal(s.calls.length, 0);
    await s.saveAuth(auth('current'));
    assert.equal((await s.loadAuth()).token, 'current');
    await s.clearAuthIfMatches('old-token');
    assert.equal((await s.loadAuth()).token, 'current');
    await s.clearAuthIfMatches('current');
    assert.equal(await s.loadAuth(), null);
  });

  test(platform + ' queues credential deletion after pending saves', async () => {
    const s = storage(platform);
    const saved = s.saveAuth(auth('before-leave'));
    const cleared = s.clearAuth();
    await Promise.all([saved, cleared]);
    assert.equal(await s.loadAuth(), null);
    assert.deepEqual(s.calls.slice(0, 2), ['write', 'remove']);
  });
}

test('cancelled SecureStore write cannot delete a newer queued session', async () => {
  const pending = deferred();
  let current = true;
  const s = storage('ios', { write: async (value) => { if (JSON.parse(value).token === 'old') await pending.promise; } });
  const oldSave = s.saveAuthIfCurrent(auth('old'), () => current);
  await tick();
  current = false;
  const newSave = s.saveAuth(auth('new'));
  pending.resolve();
  assert.equal(await oldSave, false);
  await newSave;
  await s.clearAuthIfMatches('old');
  assert.equal((await s.loadAuth()).token, 'new');
  assert.deepEqual(s.calls.slice(0, 3), ['write', 'remove', 'write']);
});

test('load waits for a pending native save instead of returning stale credentials', async () => {
  const pending = deferred();
  const s = storage('android', { write: () => pending.promise });
  const saving = s.saveAuth(auth('new'));
  let loaded = false;
  const loading = s.loadAuth().then((value) => { loaded = true; return value; });
  await tick();
  assert.equal(loaded, false);
  pending.resolve();
  await saving;
  assert.equal((await loading).token, 'new');
});

test('a failed native write does not poison subsequent credential operations', async () => {
  let attempts = 0;
  const s = storage('ios', { write: async () => { if (++attempts === 1) throw new Error('Write denied'); } });
  await assert.rejects(s.saveAuth(auth('old')), /Write denied/);
  await s.saveAuth(auth('new'));
  assert.equal((await s.loadAuth()).token, 'new');
  await s.clearAuth();
  assert.equal(await s.loadAuth(), null);
});

test('failed cancellation cleanup stays observable and does not block a later save', async () => {
  let current = true;
  let removals = 0;
  const s = storage('ios', { write: async () => { current = false; }, remove: async () => { if (++removals === 1) throw new Error('Delete denied'); } });
  await assert.rejects(s.saveAuthIfCurrent(auth('old'), () => current), /Delete denied/);
  await s.saveAuth(auth('new'));
  await s.clearAuthIfMatches('old');
  assert.equal((await s.loadAuth()).token, 'new');
});

test('invalid stored credentials are removed without deadlocking the mutation queue', async () => {
  const s = storage('web');
  s.values.set(s.key, '{invalid json');
  assert.equal(await s.loadAuth(), null);
  s.values.set(s.key, JSON.stringify({ token: 'incomplete' }));
  assert.equal(await s.loadAuth(), null);
  await s.saveAuth(auth('valid'));
  assert.equal((await s.loadAuth()).token, 'valid');
});

test('a delayed invalid native read cannot erase a newer queued session', async () => {
  const pending = deferred();
  const s = storage('ios', { read: () => pending.promise });
  s.values.set(s.key, '{invalid');
  const loading = s.loadAuth();
  await tick();
  const saving = s.saveAuth(auth('new'));
  await tick();
  assert.equal(s.calls.includes('write'), false);
  pending.resolve();
  assert.equal(await loading, null);
  await saving;
  assert.equal((await s.loadAuth()).token, 'new');
  assert.deepEqual(s.calls.slice(0, 3), ['read', 'remove', 'write']);
});
