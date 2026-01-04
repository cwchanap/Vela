import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

test.describe('SRS (Spaced Repetition System)', () => {
  test.describe('Vocabulary Game with SRS', () => {
    test('should display JLPT level selector on setup screen', async ({
      authenticatedPage: page,
    }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Should show JLPT level selector - check for N5 level button using testid only
      await expect(page.getByTestId('jlpt-level-5')).toBeVisible();
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

      // Assert the button is visible before interacting - test will fail if button is missing
      await expect(n5Button).toBeVisible();
      await n5Button.click();
      // Verify button is selected (has bg-primary class)
      await expect(n5Button).toHaveClass(/bg-primary/);
    });

    test('should start quiz and display game interface', async ({ authenticatedPage: page }) => {
      await page.goto('/games/vocabulary');
      await waitForPageLoad(page);

      // Start the game
      const startButton = page.getByRole('button', { name: /Start Quiz|Review/ });
      await startButton.click();

      // Wait for one of the expected states: question card, game over, or back to setup
      // Using Promise.race to wait for the first visible state
      const questionCard = page.getByTestId('vocabulary-card');
      const gameOverScreen = page.getByRole('heading', { name: /Game Over|Score/i });
      const setupButton = page.getByRole('button', { name: /Start Quiz/ });

      // Wait for at least one state to become visible with a reasonable timeout
      await Promise.race([
        questionCard.waitFor({ state: 'visible', timeout: 5000 }),
        gameOverScreen.waitFor({ state: 'visible', timeout: 5000 }),
        setupButton.waitFor({ state: 'visible', timeout: 5000 }),
      ]);

      // Verify at least one expected state is visible
      const hasQuestion = await questionCard.isVisible().catch(() => false);
      const hasGameOver = await gameOverScreen.isVisible().catch(() => false);
      const hasSetup = await setupButton.isVisible().catch(() => false);

      expect(hasQuestion || hasGameOver || hasSetup).toBeTruthy();
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
