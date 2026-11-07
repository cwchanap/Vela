import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTHETIC_COGNITO_ENV } from './e2e/fixtures/syntheticEnv';

// Surface the synthetic Cognito values to test code that reads process.env
// (the syntheticAuth fixture seeds token keys for every plausible client id).
Object.assign(process.env, SYNTHETIC_COGNITO_ENV);

/**
 * Fully-mocked E2E harness for llm-settings.spec.ts. It starts only the
 * Quasar dev server with synthetic Cognito env — never the real API, real
 * Cognito, or real provider keys. All /api/* traffic is intercepted in the
 * browser by the syntheticAuth fixture; non-loopback requests are aborted.
 *
 * reuseExistingServer: false — never attach to a user-run server, and fail
 * loudly if port 9000 is already taken rather than silently proxying real
 * services.
 */

// Fresh per-run artifact directory under the repo-root .artifacts/ tree
// (gitignored), deliberately OUTSIDE test-results/ — the ordinary suite
// owns that directory and may delete it on any run. This path is created
// new every time and nothing existing is ever removed.
const runId = `${Date.now().toString(36)}-${process.pid}`;
const configDir = fileURLToPath(new URL('.', import.meta.url));
const runDir = join(configDir, '..', '..', '.artifacts', `pw-mocked-${runId}`);
const artifactsDir = join(runDir, 'results');
mkdirSync(artifactsDir, { recursive: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: 'llm-settings.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  outputDir: artifactsDir,
  reporter: [
    ['list'],
    ['html', { outputFolder: join(runDir, 'html-report'), open: 'never' }],
    ['json', { outputFile: join(runDir, 'results.json') }],
  ],
  use: {
    baseURL: 'http://localhost:9000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:9000',
    env: {
      ...SYNTHETIC_COGNITO_ENV,
      VITE_DEV_MODE: 'false',
    },
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
