'use strict';

// Minimal Jest transformer so tests can load the project's TypeScript config
// files (config/*.ts). Type-checking is left to `tsc`; this only transpiles.
const ts = require('typescript');

module.exports = {
  process(src, filename) {
    const out = ts.transpileModule(src, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    return { code: out.outputText };
  },
};
