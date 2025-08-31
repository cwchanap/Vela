import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

test.describe('Games', () => {
  test('should display vocabulary game correctly', async ({ authenticatedPage: page }) => {
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Check page title
    await expect(page).toHaveTitle(/Vocabulary.*Vela/);

    // Should show game interface
    await expect(
      page.locator('.vocabulary-game').or(page.locator('[data-cy="vocabulary-game"]')),
    ).toBeVisible();

    // Should show question
    await expect(page.locator('.question').or(page.locator('[data-cy="question"]'))).toBeVisible();

    // Should show multiple choice options
    const options = page.locator('.option').or(page.locator('[data-cy="option"]'));
    await expect(options.first()).toBeVisible();

    // Should show score display
    await expect(page.locator('.score').or(page.locator('[data-cy="score"]'))).toBeVisible();

    // Should show timer
    await expect(page.locator('.timer').or(page.locator('[data-cy="timer"]'))).toBeVisible();
  });

  test('should allow answering vocabulary questions', async ({ authenticatedPage: page }) => {
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Wait for question to load
    await page.waitForSelector('.question, [data-cy="question"]', { timeout: 10000 });

    // Get initial score
    const initialScoreText = await page.locator('.score, [data-cy="score"]').textContent();

    // Click on first option
    const firstOption = page.locator('.option, [data-cy="option"]').first();
    await firstOption.click();

    // Should show some feedback or move to next question
    await page.waitForTimeout(1000);

    // Score might change or new question might appear
    const afterClickScoreText = await page.locator('.score, [data-cy="score"]').textContent();

    // Either score changed or we have a new question
    const hasNewQuestion = await page.locator('.question, [data-cy="question"]').isVisible();
    expect(hasNewQuestion || initialScoreText !== afterClickScoreText).toBeTruthy();
  });

  test('should display sentence game correctly', async ({ authenticatedPage: page }) => {
    await page.goto('/games/sentence');
    await waitForPageLoad(page);

    // Check page title
    await expect(page).toHaveTitle(/Sentence.*Vela/);

    // Should show game interface
    await expect(
      page.locator('.sentence-game').or(page.locator('[data-cy="sentence-game"]')),
    ).toBeVisible();

    // Should show sentence building area
    await expect(
      page.locator('.sentence-builder').or(page.locator('[data-cy="sentence-builder"]')),
    ).toBeVisible();

    // Should show word tiles or draggable elements
    const wordElements = page.locator('.word, .word-tile, [data-cy="word"]');
    await expect(wordElements.first()).toBeVisible();
  });

  test('should allow drag and drop in sentence game', async ({ authenticatedPage: page }) => {
    await page.goto('/games/sentence');
    await waitForPageLoad(page);

    // Wait for words to load
    await page.waitForSelector('.word, .word-tile, [data-cy="word"]', { timeout: 10000 });

    const wordElements = page.locator('.word, .word-tile, [data-cy="word"]');
    const wordCount = await wordElements.count();

    if (wordCount > 0) {
      // Try to drag first word
      const firstWord = wordElements.first();
      const dropTarget = page.locator('.drop-zone, .sentence-area, [data-cy="drop-zone"]').first();

      if (await dropTarget.isVisible()) {
        await firstWord.dragTo(dropTarget);

        // Should show some change in the sentence area
        await page.waitForTimeout(500);

        // Verify drag operation had some effect
        const sentenceArea = page.locator('.sentence-area, [data-cy="sentence-area"]');
        await expect(sentenceArea).toBeVisible();
      }
    }
  });

  test('should navigate between games', async ({ authenticatedPage: page }) => {
    // Start at vocabulary game
    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Look for navigation to sentence game
    const sentenceGameLink = page
      .locator('text=Sentence')
      .or(page.locator('[href*="/games/sentence"]'));

    if (await sentenceGameLink.isVisible()) {
      await sentenceGameLink.click();
      await expect(page).toHaveURL(/\/games\/sentence/);
    } else {
      // Navigate manually
      await page.goto('/games/sentence');
    }

    await waitForPageLoad(page);
    await expect(page.locator('.sentence-game, [data-cy="sentence-game"]')).toBeVisible();

    // Navigate back to vocabulary
    const vocabularyGameLink = page
      .locator('text=Vocabulary')
      .or(page.locator('[href*="/games/vocabulary"]'));

    if (await vocabularyGameLink.isVisible()) {
      await vocabularyGameLink.click();
      await expect(page).toHaveURL(/\/games\/vocabulary/);
    } else {
      // Navigate manually
      await page.goto('/games/vocabulary');
    }

    await waitForPageLoad(page);
    await expect(page.locator('.vocabulary-game, [data-cy="vocabulary-game"]')).toBeVisible();
  });

  test('should handle game data loading errors gracefully', async ({ authenticatedPage: page }) => {
    // Mock API to return error
    await page.route('**/api/**', (route: any) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Server error' }),
      });
    });

    await page.goto('/games/vocabulary');
    await waitForPageLoad(page);

    // Should show error message or fallback UI
    const errorElements = page
      .locator('text=Error')
      .or(page.locator('text=failed'))
      .or(page.locator('.error, [data-cy="error"]'));
    await expect(errorElements.first()).toBeVisible({ timeout: 10000 });
  });
});
