import { test as base, expect, Page } from '@playwright/test';

// Test user credentials from the project instructions
export const TEST_USER = {
  email: 'testuser.vela@gmail.com',
  password: 'TestPass123!',
};

// Extend base test with authentication fixture
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/auth/login');

    // Fill in login form
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);

    // Submit login form
    await page.click('button[type="submit"]');

    // Wait for successful login and redirect
    await expect(page).toHaveURL(/\/(dashboard|home|\/)$/);

    await use(page);
  },
});

export { expect };
