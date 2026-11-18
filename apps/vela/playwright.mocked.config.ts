import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTHETIC_COGNITO_ENV } from './e2e/fixtures/syntheticEnv';

Object.assign(process.env, SYNTHETIC_COGNITO_ENV);

const runId = `${Date.now().toString(36)}-${process.pid}`;
const configDir = fileURLToPath(new URL('.', import.meta.url));
const artifactsRoot = join(configDir, '..', '..', '.artifacts');
if (!existsSync(artifactsRoot)) {
  mkdirSync(artifactsRoot, { recursive: true });
}
const runDir = join(artifactsRoot, `pw-mocked-${runId}`);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['llm-settings.spec.ts', 'chat-sidebar.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  outputDir: join(runDir, 'results'),
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
