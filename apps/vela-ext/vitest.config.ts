import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue() as unknown as any],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['{components,entrypoints}/**/*.{test,spec}.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': rootDir,
      '@utils': resolve(rootDir, 'entrypoints/utils'),
    },
  },
});
