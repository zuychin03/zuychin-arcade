const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');

const repoRoot = path.resolve(__dirname, '../../..');
const sourceFile = 'docs/design/game-art/saboteur-mine-concept.png';
const outputDirectory = 'apps/mobile/assets/game-art';
const encoding = Object.freeze({ quality: 82, effort: 5, preset: 'picture' });
const specs = Object.freeze([
  { file: 'saboteur-cover.webp', width: 640, maxBytes: 160 * 1024 },
  { file: 'saboteur-hero.webp', width: 1280, maxBytes: 440 * 1024 },
]);
const maxTotalBytes = 600 * 1024;
const coltActionNames = Object.freeze(['move', 'floor', 'rob', 'shoot', 'punch', 'marshal', 'bullet']);
const coltActionMaxTotalBytes = 224 * 1024;
const coupCharacterNames = Object.freeze(['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'inquisitor']);
const coupCharacterMaxTotalBytes = 192 * 1024;
const tokyoPowerNames = Object.freeze(['attack', 'defense', 'dice', 'energy', 'healing', 'market', 'victory', 'wild']);
const tokyoPowerMaxTotalBytes = 256 * 1024;
const skullSpecialNames = Object.freeze(['pirate', 'tigress', 'skull_king', 'mermaid', 'escape']);
const skullSpecialMaxTotalBytes = 192 * 1024;
const citadelsDistrictNames = Object.freeze(['noble', 'religious', 'trade', 'military', 'unique']);
const citadelsDistrictMaxTotalBytes = 192 * 1024;
const notAlonePlaceNames = Object.freeze(['lair', 'jungle', 'river', 'beach', 'rover', 'swamp', 'shelter', 'wreck', 'source', 'artefact']);
const notAlonePlaceMaxTotalBytes = 320 * 1024;
const bangCardNames = Object.freeze(['attack', 'response', 'recovery', 'supply', 'interference', 'equipment', 'weapon']);
const bangCardMaxTotalBytes = 224 * 1024;
const libertaliaLootNames = Object.freeze(['map', 'barrel', 'amulet', 'chest', 'hook', 'saber', 'relic']);
const libertaliaLootMaxTotalBytes = 224 * 1024;
const libertaliaPhaseNames = Object.freeze(['daytime', 'dusk', 'night', 'anchor']);
const libertaliaPhaseMaxTotalBytes = 160 * 1024;
const catalogue = require('../../../docs/design/game-art/custom-artwork-catalogue.json');
const queuedAssets = catalogue.families.flatMap(family => family.assets);
const queuedGames = Object.fromEntries(catalogue.families.flatMap(family => family.assets.map(asset => [asset.id, {
  sourceFile: asset.source,
  specs: [{ file: path.basename(asset.output), width: asset.width ?? family.width ?? 320, maxBytes: asset.maxBytes ?? 48 * 1024 }],
  manifestFile: path.basename(asset.manifest),
  square: (asset.aspect ?? family.aspect ?? 'square') === 'square',
}])));
const games = Object.freeze({
  ...Object.fromEntries(['blue', 'red', 'yellow'].map(colour => [`kraken-course-${colour}`, {
    sourceFile: `docs/design/game-art/kraken-course-${colour}.png`,
    specs: [{ file: `kraken-course-${colour}.webp`, width: 480, maxBytes: 55 * 1024 }],
    manifestFile: `kraken-course-${colour}-manifest.json`,
  }])),
  ...Object.fromEntries(Array.from({ length: 84 }, (_, index) => String(index + 1).padStart(2, '0')).map(number => [`dixit-dream-${number}`, {
    sourceFile: `docs/design/game-art/dixit-dream-${number}.png`,
    specs: [{ file: `dixit-dream-${number}.webp`, width: 512, maxBytes: 100 * 1024 }],
    manifestFile: `dixit-dream-${number}-manifest.json`,
    encoding: { quality: ['47', '64'].includes(number) ? 66 : 72 },
  }])),
  saboteur: { sourceFile, specs, manifestFile: 'manifest.json' },
  colt: {
    sourceFile: 'docs/design/game-art/colt-train-concept.png',
    specs: [
      { file: 'colt-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'colt-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'colt-manifest.json',
  },
  ...Object.fromEntries(coltActionNames.map(action => [`colt-action-${action}`, {
    sourceFile: `docs/design/game-art/colt-action-${action}.png`,
    specs: [{ file: `colt-action-${action}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `colt-action-${action}-manifest.json`,
  }])),
  coup: {
    sourceFile: 'docs/design/game-art/coup-court-concept.png',
    specs: [
      { file: 'coup-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'coup-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'coup-manifest.json',
  },
  ...Object.fromEntries(coupCharacterNames.map(character => [`coup-character-${character}`, {
    sourceFile: `docs/design/game-art/coup-character-${character}.png`,
    specs: [{ file: `coup-character-${character}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `coup-character-${character}-manifest.json`,
  }])),
  tokyo: {
    sourceFile: 'docs/design/game-art/tokyo-city-concept.png',
    specs: [
      { file: 'tokyo-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'tokyo-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'tokyo-manifest.json',
  },
  ...Object.fromEntries(tokyoPowerNames.map(category => [`tokyo-power-${category}`, {
    sourceFile: `docs/design/game-art/tokyo-power-${category}.png`,
    specs: [{ file: `tokyo-power-${category}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `tokyo-power-${category}-manifest.json`,
  }])),
  skull: {
    sourceFile: 'docs/design/game-art/skull-ship-concept.png',
    specs: [
      { file: 'skull-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'skull-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'skull-manifest.json',
  },
  citadels: {
    sourceFile: 'docs/design/game-art/citadels-city-concept.png',
    specs: [
      { file: 'citadels-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'citadels-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'citadels-manifest.json',
  },
  'not-alone': {
    sourceFile: 'docs/design/game-art/not-alone-world-concept.png',
    specs: [
      { file: 'not-alone-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'not-alone-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'not-alone-manifest.json',
  },
  bang: {
    sourceFile: 'docs/design/game-art/bang-frontier-concept.png',
    specs: [
      { file: 'bang-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'bang-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'bang-manifest.json',
  },
  libertalia: {
    sourceFile: 'docs/design/game-art/libertalia-fleet-concept.png',
    specs: [
      { file: 'libertalia-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'libertalia-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'libertalia-manifest.json',
  },
  'feed-the-kraken': {
    sourceFile: 'docs/design/game-art/feed-the-kraken-voyage-concept.png',
    specs: [
      { file: 'feed-the-kraken-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'feed-the-kraken-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'feed-the-kraken-manifest.json',
  },
  telestrations: {
    sourceFile: 'docs/design/game-art/telestrations-sketchbooks-concept.png',
    specs: [
      { file: 'telestrations-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'telestrations-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'telestrations-manifest.json',
  },
  'cartographers-heroes': {
    sourceFile: 'docs/design/game-art/cartographers-heroes-frontier-concept.png',
    specs: [
      { file: 'cartographers-heroes-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'cartographers-heroes-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'cartographers-heroes-manifest.json',
  },
  'dixit-odyssey': {
    sourceFile: 'docs/design/game-art/dixit-odyssey-dream-concept.png',
    specs: [
      { file: 'dixit-odyssey-cover.webp', width: 640, maxBytes: 160 * 1024 },
      { file: 'dixit-odyssey-hero.webp', width: 1280, maxBytes: 440 * 1024 },
    ],
    manifestFile: 'dixit-odyssey-manifest.json',
  },
  ...Object.fromEntries(skullSpecialNames.map(kind => [`skull-special-${kind}`, {
    sourceFile: `docs/design/game-art/skull-special-${kind}.png`,
    specs: [{ file: `skull-special-${kind}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `skull-special-${kind}-manifest.json`,
  }])),
  ...Object.fromEntries(citadelsDistrictNames.map(color => [`citadels-district-${color}`, {
    sourceFile: `docs/design/game-art/citadels-district-${color}.png`,
    specs: [{ file: `citadels-district-${color}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `citadels-district-${color}-manifest.json`,
  }])),
  ...Object.fromEntries(notAlonePlaceNames.map(place => [`not-alone-place-${place}`, {
    sourceFile: `docs/design/game-art/not-alone-place-${place}.png`,
    specs: [{ file: `not-alone-place-${place}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `not-alone-place-${place}-manifest.json`,
  }])),
  ...Object.fromEntries(bangCardNames.map(family => [`bang-card-${family}`, {
    sourceFile: `docs/design/game-art/bang-card-${family}.png`,
    specs: [{ file: `bang-card-${family}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `bang-card-${family}-manifest.json`,
  }])),
  ...Object.fromEntries(libertaliaLootNames.map(kind => [`libertalia-loot-${kind}`, {
    sourceFile: `docs/design/game-art/libertalia-loot-${kind}.png`,
    specs: [{ file: `libertalia-loot-${kind}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `libertalia-loot-${kind}-manifest.json`,
  }])),
  ...Object.fromEntries(libertaliaPhaseNames.map(phase => [`libertalia-phase-${phase}`, {
    sourceFile: `docs/design/game-art/libertalia-phase-${phase}.png`,
    specs: [{ file: `libertalia-phase-${phase}.webp`, width: 320, maxBytes: 48 * 1024 }],
    manifestFile: `libertalia-phase-${phase}-manifest.json`,
  }])),
  ...queuedGames,
});

function assetStatus(game, root = repoRoot) {
  assert(Object.hasOwn(games, game), `Unknown game artwork: ${game}`);
  const config = games[game];
  const files = [config.sourceFile, `${outputDirectory}/${config.manifestFile}`, ...config.specs.map(spec => `${outputDirectory}/${spec.file}`)];
  const present = files.map(file => fs.existsSync(path.join(root, file)));
  return present.every(Boolean) ? 'produced' : present.slice(1).some(Boolean) ? 'incomplete' : present[0] ? 'source-ready' : 'pending';
}

function catalogueStatus() {
  return catalogue.families.map(family => ({
    family: family.family,
    maxTotalBytes: family.maxTotalBytes,
    assets: family.assets.map(asset => ({ id: asset.id, status: assetStatus(asset.id) })),
  }));
}

function requireProduced(game, root = repoRoot) {
  assert.equal(assetStatus(game, root), 'produced', `Requested artwork is missing or incomplete: ${game}`);
}

function checkFamilyBudget(game, manifest, root = repoRoot) {
  const family = catalogue.families.find(item => item.assets.some(asset => asset.id === game));
  if (!family) return;
  const total = family.assets.reduce((sum, asset) => {
    if (asset.id === game) return sum + manifest.totalBytes;
    const file = path.join(root, asset.manifest);
    return sum + (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).totalBytes : 0);
  }, 0);
  assert(total <= family.maxTotalBytes, `${family.family} exceeds its family byte budget`);
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function dimensions(width, sourceWidth, sourceHeight) {
  assert([width, sourceWidth, sourceHeight].every(value => Number.isSafeInteger(value) && value > 0), 'Dimensions must be positive safe integers');
  assert(width <= sourceWidth, 'Upscaling is not permitted');
  return { width, height: Math.round(width * sourceHeight / sourceWidth) };
}

function parseArguments(args) {
  let sharpModule;
  let check = false;
  let game;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check' && !check) check = true;
    else if (args[i] === '--sharp-module' && !sharpModule) {
      sharpModule = args[++i];
      assert(sharpModule && !sharpModule.startsWith('--'), '--sharp-module requires a path');
    } else if (args[i] === '--game' && !game) {
      game = args[++i];
      assert(Object.hasOwn(games, game), '--game must name a configured game');
    } else throw new Error(`Unknown or duplicate argument: ${args[i]}`);
  }
  assert(sharpModule, 'Usage: node generate-game-art.cjs --sharp-module <installed Sharp path> [--check]');
  return { sharpModule: path.resolve(sharpModule), check, game: game ?? 'saboteur' };
}

async function renderArtifacts(sharp, source, game = 'saboteur') {
  assert(Object.hasOwn(games, game), 'Unknown game artwork');
  const config = games[game];
  const gameEncoding = { ...encoding, ...config.encoding };
  const metadata = await sharp(source).metadata();
  assert(metadata.format === 'png' && (metadata.pages ?? 1) === 1, 'Source must be a static PNG');
  assert(!metadata.orientation || metadata.orientation === 1, 'Source must have normal orientation');
  if (config.square) assert.equal(metadata.width, metadata.height, 'Catalogue artwork must be square; cropping is not permitted');
  const artifacts = {};
  const outputs = [];
  for (const spec of config.specs) {
    const expected = dimensions(spec.width, metadata.width, metadata.height);
    // Width-only resizing retains the complete composition without padding or cropping.
    const bytes = await sharp(source).resize({ width: spec.width, withoutEnlargement: true }).webp(gameEncoding).toBuffer();
    const actual = await sharp(bytes).metadata();
    assert.equal(actual.format, 'webp');
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    assert(bytes.length <= spec.maxBytes, `${spec.file} exceeds its byte budget`);
    artifacts[spec.file] = bytes;
    outputs.push({ ...spec, height: actual.height, bytes: bytes.length, sha256: hash(bytes) });
  }
  const totalBytes = outputs.reduce((sum, output) => sum + output.bytes, 0);
  assert(totalBytes <= maxTotalBytes, 'Combined artwork exceeds its byte budget');
  const manifest = {
    schemaVersion: 1,
    source: { file: config.sourceFile, width: metadata.width, height: metadata.height, bytes: source.length, sha256: hash(source) },
    transform: 'width-only resize; full composition; no crop or padding',
    encoding: { format: 'webp', ...gameEncoding, sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp },
    outputs,
    totalBytes,
    maxTotalBytes,
  };
  artifacts[config.manifestFile] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { artifacts, manifest };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--status') {
    console.log(JSON.stringify(catalogueStatus(), null, 2));
    return;
  }
  const { sharpModule, check, game } = parseArguments(args);
  if (check) requireProduced(game);
  assert(fs.existsSync(path.join(repoRoot, games[game].sourceFile)), `Requested artwork source is missing: ${game}`);
  const source = fs.readFileSync(path.join(repoRoot, games[game].sourceFile));
  const { artifacts, manifest } = await renderArtifacts(require(sharpModule), source, game);
  checkFamilyBudget(game, manifest);
  const directory = path.join(repoRoot, outputDirectory);
  if (!check) fs.mkdirSync(directory, { recursive: true });
  for (const [file, bytes] of Object.entries(artifacts)) {
    const destination = path.join(directory, file);
    if (check) {
      assert(fs.existsSync(destination), `Missing generated artifact: ${file}`);
      assert(fs.readFileSync(destination).equals(bytes), `Generated artifact differs: ${file}`);
    } else fs.writeFileSync(destination, bytes);
  }
  console.log(JSON.stringify({ mode: check ? 'check' : 'generate', ...manifest }, null, 2));
}

module.exports = { coltActionNames, coltActionMaxTotalBytes, coupCharacterNames, coupCharacterMaxTotalBytes, tokyoPowerNames, tokyoPowerMaxTotalBytes, skullSpecialNames, skullSpecialMaxTotalBytes, citadelsDistrictNames, citadelsDistrictMaxTotalBytes, notAlonePlaceNames, notAlonePlaceMaxTotalBytes, bangCardNames, bangCardMaxTotalBytes, libertaliaLootNames, libertaliaLootMaxTotalBytes, libertaliaPhaseNames, libertaliaPhaseMaxTotalBytes, dimensions, encoding, games, hash, maxTotalBytes, outputDirectory, parseArguments, renderArtifacts, repoRoot, sourceFile, specs };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
Object.assign(module.exports, { catalogue, queuedAssets, queuedGames, assetStatus, requireProduced, checkFamilyBudget, catalogueStatus });
