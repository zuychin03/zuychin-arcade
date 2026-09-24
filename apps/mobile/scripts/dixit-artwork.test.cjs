const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { imageSize } = require('image-size');
const { games, hash, repoRoot, outputDirectory } = require('./generate-game-art.cjs');

const ids = Array.from({ length: 84 }, (_, index) => 'dream-' + String(index + 1).padStart(2, '0'));
const artworkFile = path.join(repoRoot, 'apps/mobile/components/dixit/artwork.ts');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(artworkFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, require: name => {
  assert.match(name, /^\.\.\/\.\.\/assets\/game-art\/dixit-dream-\d{2}\.webp$/);
  const absolute = path.resolve(path.dirname(artworkFile), name);
  assert(fs.statSync(absolute).isFile());
  return absolute;
} });
const artwork = exportsObject.DIXIT_ARTWORK;

test('every playable Dixit identity maps to its own original illustrated face', () => {
  assert.deepEqual(Object.keys(artwork).sort(), ids);
  const sources = new Set(), outputs = new Set();
  let total = 0;
  for (const id of ids) {
    const key = 'dixit-' + id, config = games[key];
    assert(config, key);
    assert.equal(path.basename(artwork[id].source), key + '.webp');
    assert.equal(typeof artwork[id].description, 'string');
    assert(artwork[id].description.length >= 40 && artwork[id].description.length <= 360);
    const png = fs.readFileSync(path.join(repoRoot, config.sourceFile));
    const bytes = fs.readFileSync(artwork[id].source);
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, outputDirectory, config.manifestFile), 'utf8'));
    assert.equal(manifest.source.sha256, hash(png));
    assert.equal(manifest.outputs[0].sha256, hash(bytes));
    const size = imageSize(bytes), original = imageSize(png);
    assert.deepEqual([original.width, original.height], [1024, 1536]);
    assert.deepEqual([size.width, size.height], [512, 768]);
    assert.equal(manifest.transform, 'width-only resize; full composition; no crop or padding');
    assert(bytes.length <= 100 * 1024, key + ' exceeds the mobile per-card budget');
    assert(fs.readFileSync(path.join(repoRoot, 'docs/design/game-art/' + key + '-prompt.md'), 'utf8').trim().length > 100);
    sources.add(hash(png)); outputs.add(hash(bytes)); total += bytes.length;
  }
  assert.equal(sources.size, 84, 'Reused source illustration');
  assert.equal(outputs.size, 84, 'Reused runtime illustration');
  assert(total <= 84 * 100 * 1024);
});

test('inspected generation manifests agree with the shipped accessibility descriptions', () => {
  const manifestFiles = ['03-14', '15-38', '39-61', '62-84'];
  const rows = manifestFiles.flatMap(range => JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/design/game-art/dixit-art-' + range + '.json'), 'utf8')));
  assert.deepEqual(rows.map(row => row.cardId).sort(), ids.slice(2));
  for (const row of rows) {
    assert.equal(row.description, artwork[row.cardId].description);
    assert.equal(row.source, games['dixit-' + row.cardId].sourceFile);
    assert.equal(row.promptFile, 'docs/design/game-art/dixit-' + row.cardId + '-prompt.md');
  }
});
