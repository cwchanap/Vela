import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

/**
 * E2E tests for per-user LLM API key behavior and provider switching
 */

test.describe('LLM Settings - Provider Selection', () => {
  test('should show all LLM providers in dropdown', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    // Click the provider dropdown
    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();

    // Verify all providers are visible
    await expect(page.getByRole('option', { name: 'Google (Gemini API)' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'OpenRouter' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Chutes.ai' })).toBeVisible();
  });

  test('should switch to Chutes.ai provider with correct default model', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    // Click the provider dropdown and select Chutes.ai
    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();
    await page.getByRole('option', { name: 'Chutes.ai' }).click();

    // Verify the model input shows the default Chutes model
    const modelInput = page.getByTestId('llm-model-input');
    await expect(modelInput).toHaveValue('openai/gpt-oss-120b');
  });

  test('should use Chutes.ai provider for LLM requests when selected', async ({
    authenticatedPage: page,
  }) => {
    const customKey = `test-chutes-api-key-${Date.now()}`;

    await page.goto('/settings');
    await waitForPageLoad(page);

    // Select Chutes.ai provider
    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();
    await page.getByRole('option', { name: 'Chutes.ai' }).click();

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
        await page.getByTestId('llm-chat-input').fill('Hello from Chutes.ai E2E test');
        await page.getByTestId('llm-chat-send').click();
      })(),
    ]);

    const body = llmRequest.postDataJSON() as Record<string, unknown>;
    expect(body).toBeTruthy();
    expect(body.provider).toBe('chutes');
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.apiKey).toBe(customKey);
  });
});

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
});
