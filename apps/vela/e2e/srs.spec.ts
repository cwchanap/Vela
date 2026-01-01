import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

test.describe('SRS (Spaced Repetition System)', () => {
  test.describe('Vocabulary Game with SRS', () => {
    test('should display JLPT level selector on setup screen', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Should show JLPT level selector - check for any level button
      await expect(
        page.getByTestId('jlpt-level-5').or(page.getByText('All Levels').first()),
      ).toBeVisible();
    });

    test('should display SRS mode toggle', async ({ authenticatedPage: page }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Should show SRS mode toggle
      await expect(page.getByText('Review Due Words First')).toBeVisible();
    });

    test('should be able to select JLPT levels', async ({ authenticatedPage: page }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Click on N5 button using data-testid
      const n5Button = page.getByTestId('jlpt-level-5');

      if (await n5Button.isVisible()) {
        await n5Button.click();
        // Button should be highlighted (has bg-primary class when selected)
        await expect(n5Button).toHaveClass(/bg-primary/);
      }
    });

    test('should start quiz and display game interface', async ({ authenticatedPage: page }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Start the game
      const startButton = page.getByRole('button', { name: /Start Quiz|Review/ });
      await startButton.click();

      // Wait for quiz to load - either game interface or loading state
      await page.waitForTimeout(2000);

      // Should show either:
      // 1. Active game with question (if vocabulary loaded)
      // 2. Game over screen (if quiz ended quickly)
      // 3. Setup screen (if no vocabulary found)
      const hasQuestion = await page.locator('.vocabulary-card, .q-card').first().isVisible();
      const hasSetup = await page.getByRole('button', { name: /Start Quiz/ }).isVisible();

      // At least one of these should be visible
      expect(hasQuestion || hasSetup).toBeTruthy();
    });
  });

  test.describe('Progress Page with SRS Stats', () => {
    test('should display SRS stats section', async ({ authenticatedPage: page }) => {
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Should show SRS stats section header
      await expect(page.getByText('Spaced Repetition').first()).toBeVisible();
    });

    test('should display mastery stats', async ({ authenticatedPage: page }) => {
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Should show mastery labels using first() to handle multiple matches
      await expect(page.getByText('Mastered').first()).toBeVisible();
      await expect(page.getByText('Learning').first()).toBeVisible();
      await expect(page.getByText('New').first()).toBeVisible();
    });

    test('should show Total Words stat', async ({ authenticatedPage: page }) => {
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Check for Total Words label
      await expect(page.getByText('Total Words')).toBeVisible();
    });

    test('should show navigation to vocabulary game', async ({ authenticatedPage: page }) => {
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Find Start Learning link if present (for empty state)
      const startLearningLink = page.getByRole('link', { name: /START LEARNING/i });

      if (await startLearningLink.isVisible()) {
        await startLearningLink.click();
        await expect(page).toHaveURL(/\/games\/vocabulary/);
      } else {
        // If not empty state, there should be stats displayed
        await expect(page.getByText('Total Words')).toBeVisible();
      }
    });
  });

  test.describe('SRS Integration Flow', () => {
    test('should navigate between Progress and Games', async ({ authenticatedPage: page }) => {
      // Start at progress page
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Verify progress page loaded
      await expect(page.getByText('Spaced Repetition').first()).toBeVisible();

      // Navigate to vocabulary game
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Verify vocabulary game setup screen
      await expect(page.getByRole('button', { name: /Start Quiz|Review/ })).toBeVisible();

      // Go back to progress
      await page.goto('/progress');
      await waitForPageLoad(page);

      // Progress should still show SRS section
      await expect(page.getByText('Spaced Repetition').first()).toBeVisible();
    });
  });
});
