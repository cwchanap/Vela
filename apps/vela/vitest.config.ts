import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    quasar({
      sassVariables: 'src/quasar-variables.sass',
    }) as unknown as any,
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'e2e/**',
        'node_modules/**',
      ],
    },
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
