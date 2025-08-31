import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

test.describe('Navigation', () => {
  test('should display main navigation correctly', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Check main layout elements
    await expect(page.locator('#q-app')).toBeVisible();

    // Should have navigation menu
    const navMenu = page
      .locator('.q-header')
      .or(page.locator('nav'))
      .or(page.locator('[data-cy="navigation"]'));
    await expect(navMenu.first()).toBeVisible();
  });

  test('should navigate to games section', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Look for games navigation link
    const gamesLink = page
      .locator('text=Games')
      .or(page.locator('[href*="/games"]'))
      .or(page.locator('[data-cy="games-link"]'));

    if (await gamesLink.first().isVisible()) {
      await gamesLink.first().click();
      await expect(page.url()).toMatch(/\/games/);
    } else {
      // Navigate manually if no visible link
      await page.goto('/games');
    }

    await waitForPageLoad(page);

    // Should show games interface
    const gamesContent = page
      .locator('.games')
      .or(page.locator('[data-cy="games"]'))
      .or(page.locator('text=Vocabulary'))
      .or(page.locator('text=Sentence'));
    await expect(gamesContent.first()).toBeVisible();
  });

  test('should handle 404 pages gracefully', async ({ authenticatedPage: page }) => {
    await page.goto('/non-existent-page');
    await waitForPageLoad(page);

    // Should show 404 page or redirect to home
    const is404 =
      page.url().includes('/non-existent-page') &&
      (await page.locator('text=404').or(page.locator('text=Not Found')).isVisible());
    const isRedirected = !page.url().includes('/non-existent-page');

    expect(is404 || isRedirected).toBeTruthy();
  });

  test('should maintain authentication state across navigation', async ({
    authenticatedPage: page,
  }) => {
    // Navigate to different pages and ensure user stays logged in
    const pages = ['/', '/games', '/games/vocabulary', '/games/sentence'];

    for (const pagePath of pages) {
      await page.goto(pagePath);
      await waitForPageLoad(page);

      // Should not be redirected to login
      expect(page.url()).not.toContain('/auth/login');

      // Should have main app layout
      await expect(page.locator('#q-app')).toBeVisible();
    }
  });

  test('should have working breadcrumbs or back navigation', async ({
    authenticatedPage: page,
  }) => {
    // Navigate deep into the app
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Look for back button or breadcrumbs
    const backButton = page
      .locator('.q-btn-flat')
      .or(page.locator('[aria-label="back"]'))
      .or(page.locator('text=Back'));
    const breadcrumbs = page.locator('.q-breadcrumbs').or(page.locator('[data-cy="breadcrumbs"]'));

    if (await backButton.first().isVisible()) {
      await backButton.first().click();
      await waitForPageLoad(page);
      // Should navigate to parent page
      expect(page.url()).not.toContain('/games/vocabulary');
    } else if (await breadcrumbs.first().isVisible()) {
      // Click on a breadcrumb link
      const breadcrumbLink = breadcrumbs.locator('a').first();
      if (await breadcrumbLink.isVisible()) {
        await breadcrumbLink.click();
        await waitForPageLoad(page);
      }
    }

    // Browser back should also work
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);
    await page.goBack();
    await waitForPageLoad(page);
    expect(page.url()).not.toContain('/games/vocabulary');
  });
});
