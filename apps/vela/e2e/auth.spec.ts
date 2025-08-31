import { test, expect } from '@playwright/test';
import { TEST_USER } from './fixtures/auth';
import { waitForPageLoad, clearBrowserData } from './utils/helpers';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserData(page);
  });

  test('should display login page correctly', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    // Check page title
    await expect(page).toHaveTitle(/Vela/);

    // Check login form elements
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Check for navigation links
    await expect(page.locator('text=Sign up')).toBeVisible();
    await expect(page.locator('text=Forgot password')).toBeVisible();
  });

  test('should show validation errors for invalid login', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation errors
    await expect(
      page.locator('text=Email is required').or(page.locator('.q-field--error')),
    ).toBeVisible();

    // Try with invalid email
    await page.fill('input[type="email"]', 'invalid-email');
    await page.fill('input[type="password"]', 'short');
    await page.click('button[type="submit"]');

    // Should show format error or stay on login page
    await expect(page.url()).toContain('/auth/login');
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    // Fill login form with test credentials
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect after successful login
    await page.waitForURL(/\/(dashboard|home|\/|games)/, { timeout: 10000 });

    // Should be redirected away from login page
    expect(page.url()).not.toContain('/auth/login');

    // Should have main application layout
    await expect(page.locator('#q-app')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/(dashboard|home|\/|games)/, { timeout: 10000 });

    // Look for logout button/menu - might be in a dropdown or profile menu
    const logoutButton = page
      .locator('text=Logout')
      .or(page.locator('text=Sign out'))
      .or(page.locator('[data-cy="logout"]'));

    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    } else {
      // Try to find profile menu or user menu
      const profileMenu = page
        .locator('.q-avatar')
        .or(page.locator('[data-cy="profile-menu"]'))
        .or(page.locator('.q-btn-dropdown'));
      if (await profileMenu.first().isVisible()) {
        await profileMenu.first().click();
        await page.locator('text=Logout').or(page.locator('text=Sign out')).click();
      }
    }

    // Should be redirected to login page
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('should navigate to signup page', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    // Click sign up link
    await page.click('text=Sign up');

    // Should navigate to signup page
    await expect(page).toHaveURL(/\/auth\/signup/);

    // Should show signup form
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.goto('/auth/login');
    await waitForPageLoad(page);

    // Click forgot password link
    await page.click('text=Forgot password');

    // Should navigate to reset password page
    await expect(page).toHaveURL(/\/auth\/reset-password/);

    // Should show reset form
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
