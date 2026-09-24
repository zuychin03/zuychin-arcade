const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

test('mobile typechecking includes source but excludes compiled web and native exports', () => {
  const root = path.resolve(__dirname, '..');
  const configPath = path.join(root, 'tsconfig.json');
  const source = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(source.error, undefined);
  const config = ts.parseJsonConfigFileContent(source.config, ts.sys, root);
  assert.equal(config.errors.length, 0);
  const files = config.fileNames.map(file => path.relative(root, file).replaceAll('\\', '/'));
  for (const file of ['app/feed-the-kraken/game.tsx', 'app/cartographers-heroes/game.tsx', 'components/ui/CardSurface.tsx']) {
    assert(files.includes(file), `${file} must remain typechecked`);
  }
  assert(files.every(file => !/^(dist|\.expo-export-[^/]+)\//.test(file)));
  assert(source.config.exclude.includes('dist'));
  assert(source.config.exclude.includes('.expo-export-*/**'));
});
