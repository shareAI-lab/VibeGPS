import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['bin/vibegps.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: false,
  outDir: 'dist',
  target: 'node18'
});
