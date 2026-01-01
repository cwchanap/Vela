import { test as base, expect, Page } from '@playwright/test';

// Test user credentials: override via environment for flexibility
// Default to test account from project.instructions.md
export const TEST_USER = {
  email: process.env.TEST_EMAIL || 'test@cwchanap.dev',
  password: process.env.TEST_PASSWORD || 'password123',
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

    // Fill in login form - using role selectors for better precision
    await page.getByRole('textbox', { name: 'Email' }).fill(TEST_USER.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);

    // Submit login form by clicking the Sign In button
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for successful login and redirect to home page (/)
    // The URL can be / or /home or /dashboard
    await expect(page).toHaveURL(/\/(home|dashboard)?$/, { timeout: 20000 });

    await use(page);
  },
});

export { expect };
