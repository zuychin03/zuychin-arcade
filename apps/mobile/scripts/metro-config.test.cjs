const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '../..');
const configPath = path.join(projectRoot, 'metro.config.js');
const source = fs.readFileSync(configPath, 'utf8');
const projectRequire = createRequire(configPath);
const { getDefaultConfig } = projectRequire('expo/metro-config');
const defaultConfig = getDefaultConfig(projectRoot);

function loadConfig(defaults = defaultConfig) {
  let nativeWindInput;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    __dirname: projectRoot,
    module,
    require(name) {
      if (name === 'path') return path;
      if (name === 'expo/metro-config') return {
        getDefaultConfig(root) {
          assert.equal(root, projectRoot);
          return { ...defaults, resolver: { ...defaults.resolver } };
        },
      };
      if (name === 'nativewind/metro') return {
        // Keep this config test free of NativeWind's generated CSS-cache writes.
        withNativeWind(config, options) {
          nativeWindInput = { config, options };
          const innerResolver = config.resolver.resolveRequest;
          return {
            ...config,
            resolver: {
              ...config.resolver,
              resolveRequest(context, moduleName, platform) {
                return (innerResolver ?? context.resolveRequest)(context, moduleName, platform);
              },
            },
          };
        },
      };
      throw new Error(`Unexpected config dependency: ${name}`);
    },
  }, { filename: configPath });
  return { config: module.exports, nativeWindInput };
}

test('retains the installed Expo exclusions and composes through NativeWind', () => {
  const { config, nativeWindInput } = loadConfig();
  const defaults = Array.isArray(defaultConfig.resolver.blockList)
    ? defaultConfig.resolver.blockList : [defaultConfig.resolver.blockList].filter(Boolean);
  assert(defaults.length > 0, 'Installed Expo did not supply its expected blocklist');
  assert.equal(config.resolver.blockList.length, defaults.length + 1);
  defaults.forEach((pattern, index) => assert.equal(config.resolver.blockList[index], pattern));
  assert.equal(nativeWindInput.options.input, './global.css');
  assert.deepEqual(Array.from(config.watchFolders), [workspaceRoot]);
  assert.deepEqual(Array.from(config.resolver.nodeModulesPaths), [
    path.join(projectRoot, 'node_modules'), path.join(workspaceRoot, 'node_modules'),
  ]);
});

test('handles a single default exclusion or no default exclusion without replacing it', () => {
  const sentinel = /excluded-default/;
  for (const blockList of [sentinel, undefined]) {
    const { config } = loadConfig({ ...defaultConfig, resolver: { ...defaultConfig.resolver, blockList } });
    assert.equal(config.resolver.blockList.length, blockList ? 2 : 1);
    if (blockList) assert.equal(config.resolver.blockList[0], sentinel);
  }
});

test('excludes temporary evidence and backup trees while preserving source and dependencies', () => {
  const { config } = loadConfig();
  const isBlocked = (filePath) => config.resolver.blockList.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(filePath);
  });
  for (const separator of ['/', '\\']) {
    for (const relative of ['.tmp-qa/evidence.json', '.tmp-node-modules/node_modules/react/index.js', 'apps/mobile/.tmp-export/index.js']) {
      assert(isBlocked(path.join(workspaceRoot, relative).replaceAll(path.sep, separator)), relative);
    }
    for (const relative of ['apps/mobile/app/not-alone/game.tsx', 'packages/types/src/not-alone.ts', 'node_modules/expo-router/entry.js', 'apps/mobile/components/tmp-preview.tsx']) {
      assert.equal(isBlocked(path.join(workspaceRoot, relative).replaceAll(path.sep, separator)), false, relative);
    }
  }
});

test('preserves the existing resolver before NativeWind composition', () => {
  const originalResolver = () => ({ type: 'empty' });
  const { nativeWindInput } = loadConfig({ ...defaultConfig, resolver: { ...defaultConfig.resolver, resolveRequest: originalResolver } });
  assert.equal(nativeWindInput.config.resolver.resolveRequest, originalResolver);
});
