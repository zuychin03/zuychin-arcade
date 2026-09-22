const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const hermesMagic = Buffer.from('c61fbc03c103191f', 'hex');

function expectedUrl(env) {
  const original = env.EXPO_PUBLIC_SERVER_URL;
  const value = original?.trim();
  if (!value) throw new Error('EXPO_PUBLIC_SERVER_URL is required.');
  let url;
  try { url = new URL(value); }
  catch { throw new Error('EXPO_PUBLIC_SERVER_URL must be a valid absolute HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new Error('EXPO_PUBLIC_SERVER_URL must use HTTPS in production builds.');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('EXPO_PUBLIC_SERVER_URL must be an origin without credentials, a path, query parameters or a fragment.');
  }
  return [...new Set([original, value])];
}

function containsJsLiteral(buffer, expectedValues) {
  const source = buffer.toString('utf8');
  return expectedValues.some((value) => {
    const doubleQuoted = JSON.stringify(value);
    const singleQuoted = `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
    return [doubleQuoted, singleQuoted, doubleQuoted.replaceAll('/', '\\/'), singleQuoted.replaceAll('/', '\\/')]
      .some((literal) => source.includes(literal));
  });
}

function containsHermesBytes(buffer, expectedValues) {
  // HBC strings share binary storage, so this is a byte-presence guard, not a string-table parser.
  return expectedValues.some((value) => buffer.includes(Buffer.from(value, 'utf8')) || buffer.includes(Buffer.from(value, 'utf16le')));
}

function validateExport(outputDirectory, env = process.env) {
  if (!outputDirectory) throw new Error('Usage: node scripts/validate-export-env.cjs <output-directory>');
  const values = expectedUrl(env);
  const outputRoot = path.resolve(outputDirectory);
  if (!fs.existsSync(outputRoot) || !fs.statSync(outputRoot).isDirectory()) throw new Error('Export output directory does not exist.');
  const bundleRoot = path.join(outputRoot, '_expo/static/js');
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) throw new Error('Export has no generated JavaScript or Hermes bundle directory.');
  const realOutput = fs.realpathSync(outputRoot);
  const groups = new Map();
  function visit(directory) {
    const realDirectory = fs.realpathSync(directory);
    const relative = path.relative(realOutput, realDirectory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Generated bundles must remain inside the export directory.');
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error('Generated bundle directories must not contain symbolic links.');
      if (stat.isDirectory()) { visit(filename); continue; }
      if (!stat.isFile() || !/\.(js|hbc)$/i.test(entry.name)) continue;
      const relativeBundle = path.relative(bundleRoot, filename);
      const parts = relativeBundle.split(path.sep);
      const platform = parts.length > 1 ? parts[0] : 'default';
      const buffer = fs.readFileSync(filename);
      const isHermes = buffer.subarray(0, hermesMagic.length).equals(hermesMagic);
      if (/\.hbc$/i.test(entry.name) && !isHermes) throw new Error(`Invalid Hermes bundle signature in ${relativeBundle}.`);
      const matched = isHermes ? containsHermesBytes(buffer, values) : containsJsLiteral(buffer, values);
      const group = groups.get(platform) ?? { platform, files: 0, matchedFiles: [], hermes: false };
      group.files += 1;
      group.hermes ||= isHermes;
      if (matched) group.matchedFiles.push(relativeBundle);
      groups.set(platform, group);
    }
  }
  visit(bundleRoot);
  if (groups.size === 0) throw new Error('Export contains no generated JavaScript or Hermes bundles.');
  const missing = [...groups.values()].filter((group) => group.matchedFiles.length === 0);
  if (missing.length) {
    throw new Error(`Requested EXPO_PUBLIC_SERVER_URL literal is missing from generated bundles for: ${missing.map((group) => group.platform).join(', ')}. Re-export with --clear.`);
  }
  return [...groups.values()];
}

module.exports = { validateExport };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/validate-export-env.cjs <output-directory>');
    const groups = validateExport(process.argv[2]);
    console.log(`Validated EXPO_PUBLIC_SERVER_URL in ${groups.reduce((count, group) => count + group.files, 0)} generated bundles (${groups.map((group) => group.platform).join(', ')}).`);
    if (groups.some((group) => group.hermes)) console.log('Hermes validation checks URL bytes in binary storage; it does not parse string-table boundaries.');
  } catch (error) {
    console.error(`Export environment validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
