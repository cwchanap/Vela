import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');

    // Should have the main app container
    await expect(page.locator('#q-app')).toBeVisible();

    // Should have Vela in the title
    await expect(page).toHaveTitle(/Vela/);

    // Should not show any critical errors
    const errorMessages = page.locator('text=Error').or(page.locator('.error'));
    const errorCount = await errorMessages.count();
    expect(errorCount).toBe(0);
  });

  test('should navigate to login page', async ({ page }) => {
    await page.goto('/auth/login');

    // Should show Google-only auth surface
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    // Should not show email/password form controls
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('should handle JavaScript errors gracefully', async ({ page }) => {
    const jsErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        jsErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Filter out known/acceptable errors
    const criticalErrors = jsErrors.filter(
      (error) =>
        !error.includes('favicon') &&
        !error.includes('404') &&
        !error.includes('net::ERR_') &&
        error.includes('TypeError'),
    );

    expect(criticalErrors.length).toBe(0);
  });
});
