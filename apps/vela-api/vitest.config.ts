import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', 'coverage/', 'test/', 'vitest.config.ts'],
    },
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
    ],
  },
});
