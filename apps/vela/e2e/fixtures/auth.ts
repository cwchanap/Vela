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
    // Navigate to login page
    await page.goto('/auth/login');

    // Wait for the auth form to be visible
    await page.waitForSelector('.auth-form', { timeout: 10000 });

    // Fill in login form - using label selectors for better reliability
    await page.getByLabel('Email').fill(TEST_USER.email);
    await page.getByLabel('Password').fill(TEST_USER.password);

    // Submit login form by clicking the Sign In button
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for successful login and redirect to home page (/)
    // The URL can be / or /home or /dashboard
    await expect(page).toHaveURL(/\/(home|dashboard)?$/, { timeout: 20000 });

    await use(page);
  },
});

export { expect };
