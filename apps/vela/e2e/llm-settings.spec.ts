import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

/**
 * E2E tests for per-user LLM API key behavior
 */

test.describe('LLM Settings - API Keys', () => {
  test('should use user-provided API key for LLM requests', async ({ authenticatedPage: page }) => {
    const customKey = `test-user-api-key-${Date.now()}`;

    // Go to Settings
    await page.goto('/settings');
    await waitForPageLoad(page);

    // Fill API key and save
    const apiKeyInput = page.getByTestId('llm-api-key-input');
    await apiKeyInput.click();
    await apiKeyInput.fill(customKey);
    await page.getByTestId('llm-save').click();

    // Navigate to Chat and send a message
    const [llmRequest] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/llm-chat') && r.method() === 'POST'),
      (async () => {
        await page.goto('/chat');
        await waitForPageLoad(page);
        await page.getByTestId('llm-chat-input').fill('Hello from E2E test');
        await page.getByTestId('llm-chat-send').click();
      })(),
    ]);

    const body = llmRequest.postDataJSON() as any;
    expect(body).toBeTruthy();
    expect(body.provider).toBeDefined();
    expect(body.apiKey).toBe(customKey);
  });

  test('should revert to server key when API key is cleared', async ({
    authenticatedPage: page,
  }) => {
    // Go to Settings
    await page.goto('/settings');
    await waitForPageLoad(page);

    // Click "Use server key" and save
    await page.getByRole('button', { name: 'Use server key' }).click();
    await page.getByTestId('llm-save').click();

    // Navigate to Chat and send a message
    const [llmRequest] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/llm-chat') && r.method() === 'POST'),
      (async () => {
        await page.goto('/chat');
        await waitForPageLoad(page);
        await page.getByTestId('llm-chat-input').fill('Hello again');
        await page.getByTestId('llm-chat-send').click();
      })(),
    ]);

    const body = llmRequest.postDataJSON() as any;
    expect(body).toBeTruthy();
    expect(body.provider).toBeDefined();
    // When using server key, frontend should not send apiKey field
    expect('apiKey' in body).toBeFalsy();
  });
});
