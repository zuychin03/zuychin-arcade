const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { imageSize } = require('image-size');
const { catalogue, queuedAssets, queuedGames, assetStatus, requireProduced, checkFamilyBudget } = require('./generate-game-art.cjs');
const { notAlonePlaceNames, notAlonePlaceMaxTotalBytes, bangCardNames, bangCardMaxTotalBytes, libertaliaLootNames, libertaliaLootMaxTotalBytes } = require('./generate-game-art.cjs');
const { libertaliaPhaseNames, libertaliaPhaseMaxTotalBytes } = require('./generate-game-art.cjs');
const { coltActionNames, coltActionMaxTotalBytes, coupCharacterNames, coupCharacterMaxTotalBytes, tokyoPowerNames, tokyoPowerMaxTotalBytes, skullSpecialNames, skullSpecialMaxTotalBytes, citadelsDistrictNames, citadelsDistrictMaxTotalBytes, dimensions, encoding, games, hash, maxTotalBytes, outputDirectory, parseArguments, repoRoot, sourceFile, specs } = require('./generate-game-art.cjs');

const directory = path.join(repoRoot, outputDirectory);
const source = fs.readFileSync(path.join(repoRoot, sourceFile));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));

test('manifest identifies the untouched approved PNG by content and dimensions', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.file, sourceFile);
  assert.equal(manifest.source.sha256, hash(source));
  assert.equal(manifest.source.bytes, source.length);
  const actual = imageSize(source);
  assert.equal(actual.type, 'png');
  assert.equal(manifest.source.width, actual.width);
  assert.equal(manifest.source.height, actual.height);
  assert.deepEqual([actual.width, actual.height], [1536, 1024]);
});

test('width-only sizes preserve the source aspect to the nearest pixel', () => {
  assert.deepEqual(dimensions(640, 1536, 1024), { width: 640, height: 427 });
  assert.deepEqual(dimensions(1280, 1536, 1024), { width: 1280, height: 853 });
  for (const values of [[0, 1536, 1024], [640, NaN, 1024], [640, 320, 200], [1.5, 10, 10]]) {
    assert.throws(() => dimensions(...values));
  }
});

for (const spec of specs) {
  test(`${spec.file} has a valid WebP header with matching hash, dimensions and budget`, () => {
    const bytes = fs.readFileSync(path.join(directory, spec.file));
    const record = manifest.outputs.find(output => output.file === spec.file);
    const actual = imageSize(bytes);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(actual.type, 'webp');
    assert.deepEqual({ width: actual.width, height: actual.height }, dimensions(spec.width, manifest.source.width, manifest.source.height));
    assert.equal(record.width, actual.width);
    assert.equal(record.height, actual.height);
    assert.equal(record.sha256, hash(bytes));
    assert.equal(record.bytes, bytes.length);
    assert.equal(record.maxBytes, spec.maxBytes);
    assert(bytes.length > 0 && bytes.length <= spec.maxBytes);
  });
}

test('manifest records reproducible encoding and combined loading budget', () => {
  assert.deepEqual(manifest.outputs.map(output => output.file), specs.map(spec => spec.file));
  for (const [key, value] of Object.entries(encoding)) assert.equal(manifest.encoding[key], value);
  assert.equal(manifest.encoding.format, 'webp');
  for (const key of ['sharp', 'vips', 'webp']) assert.match(manifest.encoding[key], /^\d+\.\d+/);
  assert.equal(manifest.totalBytes, manifest.outputs.reduce((sum, output) => sum + output.bytes, 0));
  assert.equal(manifest.maxTotalBytes, maxTotalBytes);
  assert(manifest.totalBytes <= maxTotalBytes);
  assert(!('generatedAt' in manifest));
});

test('CLI requires an explicit local Sharp module and rejects ambiguous arguments', () => {
  assert.deepEqual(parseArguments(['--check', '--sharp-module', '.']), { check: true, sharpModule: path.resolve('.'), game: 'saboteur' });
  assert.equal(parseArguments(['--game', 'colt', '--sharp-module', '.']).game, 'colt');
  for (const gameArgs of [['--game'], ['--game', '../unknown'], ['--game', 'colt', '--game', 'saboteur']]) assert.throws(() => parseArguments(['--sharp-module', '.', ...gameArgs]));
  for (const args of [[], ['--sharp-module'], ['--sharp-module', '--check'], ['--sharp-module', '.', '--check', '--check'], ['--sharp-module', '.', '--unknown']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('each additional game has independently bounded, content-addressed full-composition assets', () => {
  for (const [game, config] of Object.entries(games)) {
    if (game === 'saboteur') continue;
    if (Object.hasOwn(queuedGames, game) && !fs.existsSync(path.join(directory, config.manifestFile))) {
      for (const spec of config.specs) assert(!fs.existsSync(path.join(directory, spec.file)), `Unmanifested output: ${spec.file}`);
      continue;
    }
    const png = fs.readFileSync(path.join(repoRoot, config.sourceFile));
    const record = JSON.parse(fs.readFileSync(path.join(directory, config.manifestFile), 'utf8'));
    const actual = imageSize(png);
    assert.equal(record.source.file, config.sourceFile);
    assert.equal(record.source.sha256, hash(png));
    assert.deepEqual([record.source.width, record.source.height], [actual.width, actual.height]);
    assert.equal(record.source.bytes, png.length);
    assert.equal(actual.type, 'png');
    assert.equal(record.transform, manifest.transform);
    assert.deepEqual(record.encoding, { ...manifest.encoding, ...config.encoding });
    assert.deepEqual(record.outputs.map(output => output.file), config.specs.map(spec => spec.file));
    let total = 0;
    for (const spec of config.specs) {
      const bytes = fs.readFileSync(path.join(directory, spec.file));
      const output = record.outputs.find(item => item.file === spec.file);
      const size = imageSize(bytes);
      assert.equal(size.type, 'webp');
      assert.deepEqual({ width: size.width, height: size.height }, dimensions(spec.width, actual.width, actual.height));
      assert.equal(output.sha256, hash(bytes));
      assert.equal(output.bytes, bytes.length);
      assert.equal(output.maxBytes, spec.maxBytes);
      assert(bytes.length > 0 && bytes.length <= spec.maxBytes);
      total += bytes.length;
    }
    assert.equal(record.totalBytes, total);
    assert.equal(record.maxTotalBytes, maxTotalBytes);
    assert(total <= maxTotalBytes);
    if (config.square) assert.deepEqual([actual.width, actual.height], [actual.width, actual.width]);
  }
});

test('the explicit 252-asset sweep queue preserves all 77 original outputs without collisions', () => {
  assert.equal(queuedAssets.length, 252);
  assert.equal(new Set(queuedAssets.map(asset => asset.id)).size, 252);
  const expansionAsset = id => /^(dixit-dream-\d{2}|dixit-odyssey|cartographers-heroes|telestrations|feed-the-kraken)$/.test(id) || /^kraken-course-(blue|red|yellow)$/.test(id);
  assert.equal(Object.entries(games).filter(([id]) => !Object.hasOwn(queuedGames, id) && !expansionAsset(id)).flatMap(([, config]) => config.specs).length, 77);
  const outputNames = Object.values(games).flatMap(config => config.specs.map(spec => spec.file));
  assert.equal(new Set(outputNames).size, outputNames.length);
  for (const asset of queuedAssets) {
    assert.match(asset.id, /^[a-z0-9_-]+$/);
    assert.equal(asset.source, `docs/design/game-art/${asset.id}.png`);
    assert.equal(asset.output, `${outputDirectory}/${asset.id}.webp`);
    assert.equal(asset.manifest, `${outputDirectory}/${asset.id}-manifest.json`);
    assert.equal(parseArguments(['--game', asset.id, '--sharp-module', '.']).game, asset.id);
  }
});

test('requested missing artwork fails explicitly while pending registration is allowed', () => {
  const absentRoot = path.join(repoRoot, '__nonexistent_artwork_test_root__');
  assert(!fs.existsSync(absentRoot));
  assert.equal(assetStatus('libertalia-crew-01', absentRoot), 'pending');
  assert.throws(() => requireProduced('libertalia-crew-01', absentRoot), /Requested artwork is missing or incomplete/);
  assert.throws(() => assetStatus('unregistered-art'), /Unknown game artwork/);
  for (const asset of queuedAssets) {
    if (assetStatus(asset.id) === 'produced') assert.doesNotThrow(() => requireProduced(asset.id));
  }
});

test('all 252 approved artwork identities have complete sources, outputs and manifests', () => {
  assert.equal(queuedAssets.length, 252);
  for (const asset of queuedAssets) {
    assert.equal(assetStatus(asset.id), 'produced', `Incomplete approved artwork: ${asset.id}`);
    assert.doesNotThrow(() => requireProduced(asset.id));
  }
});

test('identity artwork inventory matches authoritative card and character definitions', () => {
  const read = file => fs.readFileSync(path.join(repoRoot, 'packages/types/src', file), 'utf8');
  const identities = family => catalogue.families.find(item => item.family === family).assets.map(asset => asset.identity);
  const matches = (text, pattern) => [...text.matchAll(pattern)].map(match => match[1]);
  const union = (file, name) => matches(read(file).match(new RegExp(`export type ${name} =([\\s\\S]*?);`))[1], /'([^']+)'/g);
  assert.deepEqual(identities('tokyo-power'), matches(read('king-of-tokyo-cards.ts'), /id: '([^']+)'/g));
  assert.deepEqual(identities('citadels-role'), matches(read('citadels-constants.ts'), /role: '([^']+)'/g));
  assert.deepEqual(identities('citadels-district'), matches(read('citadels-constants.ts'), /(?:standard|unique)\('([^']+)'/g));
  assert.deepEqual(identities('bang-character'), union('bang.ts', 'BangCharacterId'));
  assert.deepEqual(identities('bang-card'), union('bang.ts', 'BangCardName'));
  assert.deepEqual(identities('colt-character'), union('colt-express.ts', 'ColtCharacter'));
  assert.deepEqual(identities('not-alone-survival'), union('not-alone.ts', 'NotAloneSurvivalCardId'));
  assert.deepEqual(identities('not-alone-hunt'), union('not-alone.ts', 'NotAloneHuntCardId'));
});

test('produced queue families obey distinct-content and manifest byte budgets', () => {
  for (const family of catalogue.families) {
    const digests = new Set();
    let total = 0;
    for (const asset of family.assets) {
      if (!fs.existsSync(path.join(repoRoot, asset.manifest))) continue;
      requireProduced(asset.id);
      const record = JSON.parse(fs.readFileSync(path.join(repoRoot, asset.manifest), 'utf8'));
      const bytes = fs.readFileSync(path.join(repoRoot, asset.output));
      assert(!digests.has(hash(bytes)), `Repeated artwork within ${family.family}`);
      digests.add(hash(bytes));
      const config = games[asset.id];
      assert.equal(imageSize(bytes).width, config.specs[0].width);
      if (config.square) assert.equal(imageSize(bytes).height, config.specs[0].width);
      total += record.totalBytes;
      checkFamilyBudget(asset.id, record);
    }
    assert(total <= family.maxTotalBytes);
    assert.throws(() => checkFamilyBudget(family.assets[0].id, { totalBytes: family.maxTotalBytes + 1 }), /family byte budget/);
  }
});

test('all seven Colt action vignettes are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(coltActionNames, ['move', 'floor', 'rob', 'shoot', 'punch', 'marshal', 'bullet']);
  const digests = new Set();
  let total = 0;
  for (const action of coltActionNames) {
    const game = `colt-action-${action}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, coltActionNames.length);
  assert(total <= coltActionMaxTotalBytes, `Action collection exceeds ${coltActionMaxTotalBytes} bytes`);
});

test('all six Coup role vignettes are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(coupCharacterNames, ['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'inquisitor']);
  const digests = new Set();
  let total = 0;
  for (const character of coupCharacterNames) {
    const game = `coup-character-${character}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, coupCharacterNames.length);
  assert(total <= coupCharacterMaxTotalBytes, `Role collection exceeds ${coupCharacterMaxTotalBytes} bytes`);
});

test('all eight Tokyo category vignettes are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(tokyoPowerNames, ['attack', 'defense', 'dice', 'energy', 'healing', 'market', 'victory', 'wild']);
  const digests = new Set();
  let total = 0;
  for (const category of tokyoPowerNames) {
    const game = `tokyo-power-${category}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, tokyoPowerNames.length);
  assert(total <= tokyoPowerMaxTotalBytes, `Power collection exceeds ${tokyoPowerMaxTotalBytes} bytes`);
});

test('all five Skull King special vignettes are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(skullSpecialNames, ['pirate', 'tigress', 'skull_king', 'mermaid', 'escape']);
  const digests = new Set();
  let total = 0;
  for (const kind of skullSpecialNames) {
    const game = `skull-special-${kind}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, skullSpecialNames.length);
  assert(total <= skullSpecialMaxTotalBytes, `Special collection exceeds ${skullSpecialMaxTotalBytes} bytes`);
});

test('all ten Not Alone places are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(notAlonePlaceNames, ['lair', 'jungle', 'river', 'beach', 'rover', 'swamp', 'shelter', 'wreck', 'source', 'artefact']);
  const digests = new Set();
  let total = 0;
  for (const place of notAlonePlaceNames) {
    const game = `not-alone-place-${place}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, notAlonePlaceNames.length);
  assert(total <= notAlonePlaceMaxTotalBytes, `Place collection exceeds ${notAlonePlaceMaxTotalBytes} bytes`);
});

test('all seven BANG card families are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(bangCardNames, ['attack', 'response', 'recovery', 'supply', 'interference', 'equipment', 'weapon']);
  const digests = new Set();
  let total = 0;
  for (const family of bangCardNames) {
    const game = `bang-card-${family}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, bangCardNames.length);
  assert(total <= bangCardMaxTotalBytes, `Card family collection exceeds ${bangCardMaxTotalBytes} bytes`);
});

test('all five Citadels district categories are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(citadelsDistrictNames, ['noble', 'religious', 'trade', 'military', 'unique']);
  const digests = new Set();
  let total = 0;
  for (const color of citadelsDistrictNames) {
    const game = `citadels-district-${color}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.specs.length, 1);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, citadelsDistrictNames.length);
  assert(total <= citadelsDistrictMaxTotalBytes, `District collection exceeds ${citadelsDistrictMaxTotalBytes} bytes`);
});

test('all seven Libertalia loot kinds are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(libertaliaLootNames, ['map', 'barrel', 'amulet', 'chest', 'hook', 'saber', 'relic']);
  assert.equal(libertaliaLootMaxTotalBytes, 224 * 1024);
  const digests = new Set();
  let total = 0;
  for (const kind of libertaliaLootNames) {
    const game = `libertalia-loot-${kind}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.sourceFile, `docs/design/game-art/${game}.png`);
    assert.equal(config.manifestFile, `${game}-manifest.json`);
    assert.deepEqual(config.specs, [{ file: `${game}.webp`, width: 320, maxBytes: 48 * 1024 }]);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    assert(bytes.length <= config.specs[0].maxBytes);
    digests.add(hash(bytes));
    total += bytes.length;
  }
  assert.equal(digests.size, libertaliaLootNames.length);
  assert(total <= libertaliaLootMaxTotalBytes, `Loot collection exceeds ${libertaliaLootMaxTotalBytes} bytes`);
});

test('all four Libertalia phase stages are distinct square assets within one mobile loading budget', () => {
  assert.deepEqual(libertaliaPhaseNames, ['daytime', 'dusk', 'night', 'anchor']);
  assert.equal(libertaliaPhaseMaxTotalBytes, 160 * 1024);
  const digests = new Set();
  let total = 0;
  for (const phase of libertaliaPhaseNames) {
    const game = `libertalia-phase-${phase}`;
    assert.equal(parseArguments(['--game', game, '--sharp-module', '.']).game, game);
    const config = games[game];
    assert.equal(config.sourceFile, `docs/design/game-art/${game}.png`);
    assert.equal(config.manifestFile, `${game}-manifest.json`);
    assert.deepEqual(config.specs, [{ file: `${game}.webp`, width: 320, maxBytes: 48 * 1024 }]);
    const bytes = fs.readFileSync(path.join(directory, config.specs[0].file));
    const size = imageSize(bytes);
    assert.deepEqual([size.width, size.height], [320, 320]);
    assert(bytes.length <= config.specs[0].maxBytes);
    digests.add(hash(bytes)); total += bytes.length;
  }
  assert.equal(digests.size, libertaliaPhaseNames.length);
  assert(total <= libertaliaPhaseMaxTotalBytes, `Phase collection exceeds ${libertaliaPhaseMaxTotalBytes} bytes`);
});
