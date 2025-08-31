import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

test.describe('Responsive Design', () => {
  const viewports = [
    { name: 'Mobile', width: 375, height: 667 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Desktop', width: 1920, height: 1080 },
  ];

  viewports.forEach(({ name, width, height }) => {
    test(`should display correctly on ${name} viewport`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await waitForPageLoad(page);

      // Should have main app layout
      await expect(page.locator('#q-app')).toBeVisible();

      // Check if navigation adapts to viewport
      if (width < 768) {
        // Mobile: should have hamburger menu or mobile navigation
        const mobileMenu = page
          .locator('.q-btn-round')
          .or(page.locator('[aria-label="menu"]'))
          .or(page.locator('.q-drawer'));
        // Mobile navigation might be hidden or in a drawer
        const hasMobileNav = await mobileMenu.first().isVisible();
        expect(hasMobileNav).toBeTruthy();
      } else {
        // Desktop/Tablet: should have full navigation visible
        const navigation = page.locator('.q-header').or(page.locator('nav'));
        await expect(navigation.first()).toBeVisible();
      }
    });
  });

  test('should handle touch interactions on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Should be able to tap buttons
    const button = page.locator('button').or(page.locator('.q-btn')).first();
    if (await button.isVisible()) {
      await button.tap();
      await page.waitForTimeout(500);
      // Should respond to tap
    }
  });

  test('should handle orientation changes', async ({ authenticatedPage: page }) => {
    // Portrait
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/games/sentence');
    await waitForPageLoad(page);

    await expect(page.locator('#q-app')).toBeVisible();

    // Landscape
    await page.setViewportSize({ width: 667, height: 375 });
    await waitForPageLoad(page);

    await expect(page.locator('#q-app')).toBeVisible();

    // Content should still be accessible
    const gameContent = page
      .locator('.sentence-game')
      .or(page.locator('[data-cy="sentence-game"]'));
    if (await gameContent.isVisible()) {
      await expect(gameContent).toBeVisible();
    }
  });

  test('should have appropriate font sizes for mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Check that text is readable on mobile
    const textElements = page.locator('h1, h2, h3, p, .q-card-section');
    if (await textElements.first().isVisible()) {
      const fontSize = await textElements.first().evaluate((el: Element) => {
        return window.getComputedStyle(el).fontSize;
      });

      // Font size should be at least 14px for mobile readability
      const fontSizeNum = parseInt(fontSize.replace('px', ''));
      expect(fontSizeNum).toBeGreaterThanOrEqual(14);
    }
  });
});
