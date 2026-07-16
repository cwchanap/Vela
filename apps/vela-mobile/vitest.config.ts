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
    exclude: ['node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'node_modules/**',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/models.ts',
        'src/**/constants.ts',
        'src/test/**',
      ],
      // Scaffold coverage is below the monorepo 95% target (apps/vela).
      // Floor tracks current scaffold coverage; raise toward 95% as features land.
      thresholds: {
        lines: 50,
      },
    },
  },
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
      layouts: resolve(__dirname, './src/layouts'),
      pages: resolve(__dirname, './src/pages'),
      boot: resolve(__dirname, './src/boot'),
      '#q-app/wrappers': resolve(__dirname, './src/test/mocks/q-app-wrappers.ts'),
      'quasar/wrappers': resolve(__dirname, './src/test/mocks/quasar-wrappers.ts'),
    },
  },
});
