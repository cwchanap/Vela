import type { Page } from '@playwright/test';
import { test, expect, seedSessionFor } from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A, SYNTHETIC_USER_B } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

/**
 * HPA-755 acceptance E2E: per-provider cards, isolated keys/drafts,
 * explicit-vs-default thinking, default model persistence, capabilities,
 * and the request contract for chat + dictionary analysis.
 *
 * Runs against the fully-mocked syntheticAuth fixture — synthetic Amplify
 * session, in-memory per-test API mocks, no real Cognito/AWS/provider
 * traffic (non-loopback requests are aborted by the fixture).
 */

const GOOGLE_KEY = 'e2e-google-key-0001';
const OPENAI_KEY = 'e2e-openai-key-0001';

const cardHeader = (page: Page, provider: string) =>
  page.getByTestId(`llm-card-${provider}`).locator('.q-expansion-item__container > .q-item');

const keyInput = (page: Page, provider: string) => page.getByTestId(`llm-key-input-${provider}`);

const openCard = async (page: Page, provider: string) => {
  if (await keyInput(page, provider).isHidden()) {
    await cardHeader(page, provider).click();
  }
  await expect(keyInput(page, provider)).toBeVisible();
};

const gotoSettings = async (page: Page) => {
  await page.goto('/settings');
  await waitForPageLoad(page);
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('llm-card-google')).toBeVisible();
};

const waitForProfilePut = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/api/profiles/update') && r.request().method() === 'PUT',
  );

const llmOf = (body: Record<string, unknown> | undefined) => {
  const prefs = (body?.preferences ?? {}) as Record<string, unknown>;
  return (prefs.llm ?? {}) as {
    keys?: Record<string, string>;
    thinking?: Record<string, string>;
    defaultModel?: { provider: string; model: string };
  };
};

test.describe('LLM Settings - Provider cards', () => {
  test('should render all four provider cards', async ({ authedPage: page }) => {
    await gotoSettings(page);

    for (const provider of ['google', 'openai', 'anthropic', 'openrouter']) {
      await expect(page.getByTestId(`llm-card-${provider}`)).toBeVisible();
    }
    // OpenRouter card is free-form: no thinking controls
    await openCard(page, 'openrouter');
    await expect(page.getByText('Free-form model IDs; no thinking controls.')).toBeVisible();
  });

  test('should isolate saved keys and unsaved drafts between provider cards', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoSettings(page);

    // Google card shows its saved key; other cards never see it
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);

    await openCard(page, 'openai');
    await expect(keyInput(page, 'openai')).toHaveValue('');
    await openCard(page, 'anthropic');
    await expect(keyInput(page, 'anthropic')).toHaveValue('');

    // An unsaved draft belongs to its own card only
    await keyInput(page, 'anthropic').fill('e2e-unsaved-anthropic-draft');
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);
    await openCard(page, 'anthropic');
    await expect(keyInput(page, 'anthropic')).toHaveValue('e2e-unsaved-anthropic-draft');

    // Nothing was persisted — no PUT carried the draft
    expect(apiMock.profilePuts).toHaveLength(0);
  });

  test('should save a provider key through profile PUT and survive reload', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, { darkMode: true, dailyGoal: 45 });
    await gotoSettings(page);

    await openCard(page, 'google');
    await keyInput(page, 'google').fill(GOOGLE_KEY);
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    await putResponse;

    // PUT round-trip: llm written, unrelated preferences untouched
    const llm = llmOf(apiMock.lastPut());
    expect(llm.keys?.google).toBe(GOOGLE_KEY);
    const prefs = apiMock.lastPut()?.preferences as Record<string, unknown>;
    expect(prefs.dailyGoal).toBe(45);
    expect(prefs.darkMode).toBe(true);

    // After reload the saved key is read back from the profile
    await page.reload();
    await waitForPageLoad(page);
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);
    await expect(page.getByTestId('llm-card-google').getByText('Key saved')).toBeVisible();
  });

  test('should remove a model thinking override when Default is chosen', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { openai: OPENAI_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoSettings(page);

    await openCard(page, 'openai');

    // Set an explicit override for one model and save
    await page.getByTestId('llm-effort-gpt-6.1-sol').click();
    await page.getByRole('option', { name: 'high', exact: true }).click();
    let putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-openai').click();
    await putResponse;

    let thinking = llmOf(apiMock.lastPut()).thinking ?? {};
    expect(thinking['gpt-6.1-sol']).toBe('high');

    // Re-select Default and save again — the override is deleted, not blanked
    await page.getByTestId('llm-effort-gpt-6.1-sol').click();
    await page.getByRole('option', { name: 'Default', exact: true }).click();
    putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-openai').click();
    await putResponse;

    thinking = llmOf(apiMock.lastPut()).thinking ?? {};
    expect('gpt-6.1-sol' in thinking).toBe(false);
  });

  test('should keep the default model pair after its provider key is removed', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.serverKeyProviders = [];
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-4-argon' },
      },
    });
    await gotoSettings(page);

    await expect(page.getByText('Active: Google • gemini-4-argon')).toBeVisible();

    // Remove the saved key
    await openCard(page, 'google');
    await keyInput(page, 'google').fill('');
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    await putResponse;

    // Default stays put — no silent re-selection — with truthful missing-key state
    const llm = llmOf(apiMock.lastPut());
    expect('google' in (llm.keys ?? {})).toBe(false);
    await expect(page.getByText('Active: Google • gemini-4-argon')).toBeVisible();
    await expect(page.getByText('No API key saved for Google')).toBeVisible();

    // And it stays that way after a reload
    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Google • gemini-4-argon')).toBeVisible();
    await expect(page.getByText('No API key saved for Google')).toBeVisible();
  });
});

test.describe('LLM Settings - Server-key capabilities', () => {
  test('should advertise authenticated server-key providers for chat defaults', async ({
    authedPage: page,
  }) => {
    // Default profile (no llm preferences) + default capabilities mock
    // (['google', 'openrouter']) — the user saved no keys at all.
    await gotoSettings(page);

    await expect(
      page.getByText('Server key available for chat: Google, OpenRouter.'),
    ).toBeVisible();
    // No user key for the active Google default → chat-only fallback note
    await expect(
      page.getByText('Chat uses the server key; My Dictionaries requires your own Google API key'),
    ).toBeVisible();

    // The default selector lists server-key options with the suffix
    await page.getByTestId('llm-default-model-select').click();
    await expect(
      page.getByRole('option', { name: 'Google — gemini-3.8-flash (server key)' }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'OpenRouter (custom ID, server key)' }),
    ).toBeVisible();
  });

  test('should offer no server-key fallback when the capabilities lookup fails', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.serverKeyProviders = null; // simulate a failed authenticated lookup
    await gotoSettings(page);

    await expect(page.getByText('Server key available for chat:')).toBeHidden();

    // Only the current pair remains selectable — no stale advertised fallback
    await page.getByTestId('llm-default-model-select').click();
    await expect(page.getByRole('option', { name: /\(server key\)/ })).toHaveCount(0);
    await expect(
      page.getByRole('option', { name: 'Google — gemini-3.8-flash', exact: true }),
    ).toBeVisible();
  });
});

test.describe('LLM Settings - Request contract', () => {
  test('should send explicit provider/model/key/thinking on chat POST', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: { 'gemini-4-argon': 'high' },
        defaultModel: { provider: 'google', model: 'gemini-4-argon' },
      },
    });
    await page.goto('/chat');
    await waitForPageLoad(page);
    await expect(page.getByTestId('llm-chat-input')).toBeVisible();

    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello from mocked E2E');
    await page.getByTestId('llm-chat-send').click();

    const body = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(body.provider).toBe('google');
    expect(body.model).toBe('gemini-4-argon');
    expect(body.apiKey).toBe(GOOGLE_KEY);
    expect(body.thinking).toBe('high');
    expect(body).not.toHaveProperty('temperature');

    // The mocked reply renders in the chat
    await expect(page.getByText('Mock AI reply (synthetic)')).toBeVisible();
  });

  test('should omit thinking on chat POST when no override is saved', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await page.goto('/chat');
    await waitForPageLoad(page);
    await expect(page.getByTestId('llm-chat-input')).toBeVisible();

    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello again');
    await page.getByTestId('llm-chat-send').click();

    const body = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(body.provider).toBe('google');
    expect(body.model).toBe('gemini-3.8-flash');
    expect(body.apiKey).toBe(GOOGLE_KEY);
    // Explicit-vs-omitted: absent override means the key is not sent at all
    expect(body).not.toHaveProperty('thinking');
  });

  test('should send the thinking override on dictionary analyze POST', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: { 'gemini-3.8-flash': 'high' },
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    apiMock.dictionaryEntries = [
      {
        user_id: SYNTHETIC_USER_A.userId,
        sentence_id: 'e2e-sentence-1',
        sentence: '猫が好きです。',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      },
    ];
    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();

    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();

    const body = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    expect(body.provider).toBe('google');
    expect(body.model).toBe('gemini-3.8-flash');
    expect(body.apiKey).toBe(GOOGLE_KEY);
    expect(body.thinking).toBe('high');
    expect(body.sentence).toBe('猫が好きです。');

    // The mocked SSE stream renders into the dialog
    await expect(page.getByText('Mock streamed analysis of the sentence.')).toBeVisible();
  });

  test('should omit thinking on dictionary analyze POST without an override', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    apiMock.dictionaryEntries = [
      {
        user_id: SYNTHETIC_USER_A.userId,
        sentence_id: 'e2e-sentence-1',
        sentence: '猫が好きです。',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      },
    ];
    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();

    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();

    const body = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    // No override → the request omits thinking so the backend applies its
    // latency-safe low default
    expect(body).not.toHaveProperty('thinking');
    expect(body.provider).toBe('google');
  });

  test('should send no key to dictionary analysis on a server-key-only default', async ({
    authedPage: page,
    apiMock,
  }) => {
    // Google is advertised as a server-key provider but the user saved no key:
    // chat may fall back server-side, dictionary analysis must not.
    apiMock.seedProfile(SYNTHETIC_USER_A, {});
    apiMock.dictionaryEntries = [
      {
        user_id: SYNTHETIC_USER_A.userId,
        sentence_id: 'e2e-sentence-1',
        sentence: '猫が好きです。',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      },
    ];

    // Chat still works without a user key (request carries none)
    await page.goto('/chat');
    await waitForPageLoad(page);
    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('google');
    expect(chatBody).not.toHaveProperty('apiKey');
    await expect(page.getByText('Mock AI reply (synthetic)')).toBeVisible();

    // Dictionary sends no key either and surfaces the truthful error
    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const analyzeBody = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    expect(analyzeBody.provider).toBe('google');
    expect(analyzeBody).not.toHaveProperty('apiKey');
    await expect(
      page.locator('.q-dialog').getByText('Missing API key for Google provider'),
    ).toBeVisible();
  });
});

test.describe('LLM Settings - Session and profile integrity', () => {
  test('should render defaults when the profile llm subtree is malformed', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, { llm: 'corrupted-non-object' });
    await gotoSettings(page);

    // Lenient read: profile loads, defaults apply, settings is usable
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');
  });

  test('should reset LLM state for a new user after sign-out', async ({
    authedPage: page,
    apiMock,
    context,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-4-argon' },
      },
    });
    await gotoSettings(page);
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);

    // Sign out via the account menu; the synthetic session has no refresh
    // token and no OAuth metadata, so sign-out is purely local.
    await page.locator('.avatar-btn').click();
    await page.locator('.account-menu').getByText('Logout', { exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login/);

    // A different user with no llm preferences gets clean defaults
    await seedSessionFor(context, SYNTHETIC_USER_B);
    await page.goto('/settings');
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');
    await expect(page.getByTestId('llm-card-google').getByText('No key saved')).toBeVisible();
  });
});

test.describe('LLM Settings - Theme and TTS regression', () => {
  test('should toggle dark mode and persist it through profile PUT', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoSettings(page);

    await page.getByTestId('dark-mode-toggle').click();
    await expect(page.locator('body.body--dark')).toBeAttached();

    const putResponse = waitForProfilePut(page);
    await page.getByRole('button', { name: 'Save to profile' }).click();
    await putResponse;

    const prefs = apiMock.lastPut()?.preferences as Record<string, unknown>;
    expect(prefs.darkMode).toBe(true);
    // LLM preferences ride along untouched in the same write
    expect(llmOf(apiMock.lastPut()).keys?.google).toBe(GOOGLE_KEY);
  });

  test('should keep TTS save disabled without a key and accept a saved key', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {});
    await gotoSettings(page);

    await expect(page.getByTestId('tts-provider-select')).toBeVisible();
    await expect(page.getByTestId('tts-save')).toBeDisabled();
    await expect(page.getByText('Not configured')).toBeVisible();

    await page.getByTestId('tts-api-key-input').fill('e2e-tts-key-0001');
    await expect(page.getByTestId('tts-save')).toBeEnabled();

    const ttsPost = page.waitForResponse(
      (r) => r.url().includes('/api/tts/settings') && r.request().method() === 'POST',
    );
    await page.getByTestId('tts-save').click();
    await ttsPost;
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  });
});
