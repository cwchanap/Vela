import { test, expect } from './fixtures/auth';
import { waitForPageLoad } from './utils/helpers';

/**
 * E2E tests for registry-backed provider selection, per-provider API keys,
 * and the explicit provider/model/key snapshot sent on every chat request.
 */

test.describe('LLM Settings - Provider Selection', () => {
  test('should show all supported providers in dropdown', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();

    await expect(page.getByRole('option', { name: 'Google (Gemini API)' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'OpenAI' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Anthropic' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'OpenRouter' })).toBeVisible();
  });

  test('should switch to Anthropic with the registry default model', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();
    await page.getByRole('option', { name: 'Anthropic' }).click();

    await expect(page.getByTestId('llm-model-input')).toHaveValue('claude-opus-5-5');
  });

  test('should offer registry model choices for OpenAI', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();
    await page.getByRole('option', { name: 'OpenAI' }).click();

    await page.getByTestId('llm-model-input').click();
    await expect(page.getByRole('option', { name: 'gpt-6.1-sol' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'gpt-6-luna' })).toBeVisible();
  });
});

test.describe('LLM Settings - API Keys', () => {
  test('should keep per-provider keys isolated when switching providers', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);

    const providerSelect = page.getByTestId('llm-provider-select');
    const apiKeyInput = page.getByTestId('llm-api-key-input');

    // The auth fixture uses a real shared account whose profile may carry
    // provider/key preferences from earlier runs. Explicitly establish the
    // starting state: active provider Google, no OpenAI key.
    await providerSelect.click();
    await page.getByRole('option', { name: 'OpenAI' }).click();
    await apiKeyInput.fill('');
    await page.getByTestId('llm-save').click();

    await providerSelect.click();
    await page.getByRole('option', { name: 'Google (Gemini API)' }).click();
    await apiKeyInput.fill('google-only-key');
    await page.getByTestId('llm-save').click();

    // Switching to OpenAI must not show or reuse the Google key
    await providerSelect.click();
    await page.getByRole('option', { name: 'OpenAI' }).click();
    await expect(apiKeyInput).toHaveValue('');

    // Switching back restores the Google key
    await providerSelect.click();
    await page.getByRole('option', { name: 'Google (Gemini API)' }).click();
    await expect(apiKeyInput).toHaveValue('google-only-key');
  });

  test('should send the current provider/model/key snapshot on every chat request', async ({
    authenticatedPage: page,
  }) => {
    const customKey = `test-anthropic-api-key-${Date.now()}`;

    await page.goto('/settings');
    await waitForPageLoad(page);

    // Select Anthropic, fill its key, and save
    const providerSelect = page.getByTestId('llm-provider-select');
    await providerSelect.click();
    await page.getByRole('option', { name: 'Anthropic' }).click();

    const apiKeyInput = page.getByTestId('llm-api-key-input');
    await apiKeyInput.click();
    await apiKeyInput.fill(customKey);
    // Wait for the profile PUT so the /chat reload below cannot read a stale
    // server-side profile without the Anthropic key.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/profiles/update') && r.request().method() === 'PUT',
      ),
      page.getByTestId('llm-save').click(),
    ]);

    // Navigate to Chat and send a message
    const [llmRequest] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/llm-chat') && r.method() === 'POST'),
      (async () => {
        await page.goto('/chat');
        await waitForPageLoad(page);
        await page.getByTestId('llm-chat-input').fill('Hello from LLM settings E2E test');
        await page.getByTestId('llm-chat-send').click();
      })(),
    ]);

    const body = llmRequest.postDataJSON() as Record<string, unknown>;
    expect(body).toBeTruthy();
    expect(body.provider).toBe('anthropic');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.apiKey).toBe(customKey);
    // The browser never selects thinking in HPA-754
    expect(body.thinking).toBeUndefined();
    // temperature is no longer part of the request contract
    expect(body.temperature).toBeUndefined();
  });
});
