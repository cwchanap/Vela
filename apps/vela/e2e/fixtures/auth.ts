import { test as base, expect, Page } from '@playwright/test';

const requireTestEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name} for Playwright tests. Set it in your environment or .env file.`,
    );
  }
  return value;
};

// Test user credentials: required via environment for flexibility
export const TEST_USER = {
  email: requireTestEnv('TEST_EMAIL'),
  password: requireTestEnv('TEST_PASSWORD'),
};

// Extend base test with authentication fixture
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to the app first so Amplify is configured
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Programmatically sign in via Amplify's signIn (SRP)
    // This bypasses the Google-only UI while still using real Cognito auth
    await page.evaluate(
      async ({ email, password }) => {
        const { signIn } = await import('aws-amplify/auth');
        await signIn({ username: email, password });
      },
      { email: TEST_USER.email, password: TEST_USER.password },
    );

    // Wait for successful login and redirect to home page (/)
    await expect(page).toHaveURL(/\/(home|dashboard)?$/, { timeout: 20000 });

    await use(page);
  },
});

export { expect };
