import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue() as unknown as any],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/test-setup.ts'],
    include: ['{components,tests}/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['{components,entrypoints}/**/*.{ts,vue}'],
      exclude: ['{components,tests}/**/*.test.ts', '{components,tests}/**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@': rootDir,
      '@utils': resolve(rootDir, 'entrypoints/utils'),
    },
  },
});
