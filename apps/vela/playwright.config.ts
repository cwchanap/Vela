import { defineConfig, devices } from '@playwright/test';

export function buildE2EWebServerEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const testClientId = env.VITE_COGNITO_TEST_CLIENT_ID;
  if (!testClientId) {
    return {};
  }

  return {
    VITE_COGNITO_USER_POOL_CLIENT_ID: testClientId,
    COGNITO_CLIENT_ID: testClientId,
  };
}

/**
 * Whether Playwright can reuse an already-running server.
 * Disabled when a test client override is required, because the reused
 * server process won't have the overridden env vars applied.
 */
export function shouldReuseServer(env: Record<string, string | undefined> = process.env): boolean {
  return !env.CI && !env.VITE_COGNITO_TEST_CLIENT_ID;
}

const e2eWebServerEnv = buildE2EWebServerEnv();

/**
 * Whether Playwright can reuse an already-running server.
 * Disabled when a test client override is required, because the reused
 * server process won't have the overridden env vars applied.
 */
const shouldReuseExistingServer = shouldReuseServer();

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 2,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:9000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'bun run dev',
      url: 'http://localhost:9000',
      env: e2eWebServerEnv,
      reuseExistingServer: shouldReuseExistingServer,
      timeout: 120 * 1000,
    },
    {
      command:
        "bun --eval \"process.env.NODE_ENV = 'development'; await import('./src/index.ts'); await new Promise(() => {})\"",
      cwd: '../vela-api',
      url: 'http://localhost:9005',
      env: e2eWebServerEnv,
      reuseExistingServer: shouldReuseExistingServer,
      timeout: 60 * 1000,
    },
  ],
});
