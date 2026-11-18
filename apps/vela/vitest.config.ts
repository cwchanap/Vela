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
      sassVariables: 'src/css/quasar.variables.scss',
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
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'e2e/**',
        'node_modules/**',
        'src/**/*.d.ts',
        'src/types/**',
        'src/**/types.ts',
        'src/**/models.ts',
        'src/**/constants.ts',
      ],
      thresholds: {
        lines: 95,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Transitional: the UI slice still imports `src/...`. Removed with it.
      src: resolve(__dirname, './src'),
      '@vela/common/tokenizer': resolve(__dirname, '../../packages/common/src/tokenizer.ts'),
      '@vela/common': resolve(__dirname, '../../packages/common/src/index.ts'),
      '#q-app': resolve(__dirname, './src/test/mocks/q-app-wrappers.ts'),
    },
  },
});
