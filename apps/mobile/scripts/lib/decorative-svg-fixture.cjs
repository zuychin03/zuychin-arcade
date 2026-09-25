const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

module.exports = (platform = 'web') => {
  const source = fs.readFileSync(path.join(__dirname, '../../components/ui/decorativeSvgProps.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const result = {};
  vm.runInNewContext(compiled.outputText, { exports: result, require: () => ({ Platform: { OS: platform } }) });
  return result;
};
