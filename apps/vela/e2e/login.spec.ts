import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('should display Google-only auth form', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page).toHaveTitle(/Vela/);

    // Should show the Google sign-in button
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    // Should not show email/password form controls
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  });
});
