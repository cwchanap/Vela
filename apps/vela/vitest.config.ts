import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['e2e/**'],
  },
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
      components: resolve(__dirname, './src/components'),
      layouts: resolve(__dirname, './src/layouts'),
      pages: resolve(__dirname, './src/pages'),
      assets: resolve(__dirname, './src/assets'),
      boot: resolve(__dirname, './src/boot'),
      stores: resolve(__dirname, './src/stores'),
    },
  },
});
