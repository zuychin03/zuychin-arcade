import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // The types package ships TS source, so bundle it into the server build
  noExternal: ['@zuychin-arcade/types'],
});
