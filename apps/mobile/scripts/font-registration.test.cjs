const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const mobile = path.resolve(__dirname, '..');
function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }

test('every named Outfit and Space Mono face used by the app is registered at startup', () => {
  const registered = new Set();
  walk(parse(path.join(mobile, 'app/_layout.tsx')), node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !['useOutfit', 'useSpaceMono'].includes(node.expression.text)) return;
    const fonts = node.arguments[0];
    assert(ts.isObjectLiteralExpression(fonts), 'Font registration must be statically inspectable');
    for (const property of fonts.properties) {
      assert(ts.isShorthandPropertyAssignment(property), 'Register the bundled font by its exact name');
      registered.add(property.name.text);
    }
  });
  assert(registered.has('Outfit_600SemiBold'), 'Cartographers uses this weight for controls and coin labels');
  const used = new Set();
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.tsx?$/.test(entry.name)) walk(parse(file), node => {
        if (!ts.isStringLiteralLike(node) || !/^(?:Outfit|SpaceMono)_\d{3}[A-Za-z]+$/.test(node.text)) return;
        used.add(node.text);
        assert(registered.has(node.text), `${path.relative(mobile, file)} uses unregistered ${node.text}`);
      });
    }
  }
  for (const directory of ['app', 'components', 'constants']) scan(path.join(mobile, directory));
  assert(used.size >= 5, 'The check must inspect actual styled text');
});
