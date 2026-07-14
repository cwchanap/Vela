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
