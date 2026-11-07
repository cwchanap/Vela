import type { Page } from '@playwright/test';
import {
  test,
  expect,
  buildSessionEntries,
  makeSyntheticTokens,
  stageSessionFor,
} from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A, SYNTHETIC_USER_B } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

/**
 * E2E tests for registry-backed provider selection, per-provider API keys,
 * and the explicit provider/model/key snapshot sent on every chat request.
 */

const GOOGLE_KEY = 'e2e-google-key-0001';
const OPENAI_KEY = 'e2e-openai-key-0001';
const ANTHROPIC_KEY = 'e2e-anthropic-key-0001';
const OPENROUTER_KEY = 'e2e-openrouter-key-0001';

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

const dictionaryEntry = (userId: string) => ({
  user_id: userId,
  sentence_id: 'e2e-sentence-1',
  sentence: '猫が好きです。',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
});

test.describe('LLM Settings - Provider cards', () => {
  test('should render all four provider cards', async ({ authedPage: page }) => {
    await gotoSettings(page);

    for (const provider of ['google', 'openai', 'anthropic', 'openrouter']) {
      await expect(page.getByTestId(`llm-card-${provider}`)).toBeVisible();
    }
    await openCard(page, 'openrouter');
    await expect(page.getByText('Free-form model IDs; no thinking controls.')).toBeVisible();
  });

  test('should isolate saved keys and unsaved drafts between provider cards', async ({
    authedPage: page,
    apiMock,
  }) => {
    // The auth fixture uses a real shared account whose profile may carry
    // provider/key preferences from earlier runs. Explicitly establish the
    // starting state: active provider Google, no OpenAI key.
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoSettings(page);

    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);

    // Switching to OpenAI must not show or reuse the Google key
    await openCard(page, 'openai');
    await expect(keyInput(page, 'openai')).toHaveValue('');
    await openCard(page, 'anthropic');
    await expect(keyInput(page, 'anthropic')).toHaveValue('');

    await keyInput(page, 'anthropic').fill('e2e-unsaved-anthropic-draft');

    // Switching back restores the Google key
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);
    await openCard(page, 'anthropic');
    await expect(keyInput(page, 'anthropic')).toHaveValue('e2e-unsaved-anthropic-draft');

    await openCard(page, 'openai');
    await keyInput(page, 'openai').fill(OPENAI_KEY);
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-openai').click();
    await putResponse;

    const keys = llmOf(apiMock.lastPut()).keys ?? {};
    expect(keys.openai).toBe(OPENAI_KEY);
    expect(keys.google).toBe(GOOGLE_KEY);
    expect('anthropic' in keys).toBe(false);
    await openCard(page, 'anthropic');
    await expect(keyInput(page, 'anthropic')).toHaveValue('e2e-unsaved-anthropic-draft');
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

    const llm = llmOf(apiMock.lastPut());
    expect(llm.keys?.google).toBe(GOOGLE_KEY);
    const prefs = apiMock.lastPut()?.preferences as Record<string, unknown>;
    expect(prefs.dailyGoal).toBe(45);
    expect(prefs.darkMode).toBe(true);

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

    await page.getByTestId('llm-effort-gpt-6.1-sol').click();
    await page.getByRole('option', { name: 'high', exact: true }).click();
    let putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-openai').click();
    await putResponse;

    let thinking = llmOf(apiMock.lastPut()).thinking ?? {};
    expect(thinking['gpt-6.1-sol']).toBe('high');

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

    await openCard(page, 'google');
    await keyInput(page, 'google').fill('');
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    await putResponse;

    const llm = llmOf(apiMock.lastPut());
    expect('google' in (llm.keys ?? {})).toBe(false);
    await expect(page.getByText('Active: Google • gemini-4-argon')).toBeVisible();
    await expect(page.getByText('No API key saved for Google')).toBeVisible();

    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Google • gemini-4-argon')).toBeVisible();
    await expect(page.getByText('No API key saved for Google')).toBeVisible();
  });
});

test.describe('LLM Settings - Default model pair', () => {
  test('should persist a selected default pair and send it on chat and dictionary', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    apiMock.dictionaryEntries = [dictionaryEntry(SYNTHETIC_USER_A.userId)];
    await gotoSettings(page);

    // Select Anthropic, fill its key, and save
    await openCard(page, 'anthropic');
    await keyInput(page, 'anthropic').fill(ANTHROPIC_KEY);
    let putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-anthropic').click();
    await putResponse;
    expect(llmOf(apiMock.lastPut()).keys?.anthropic).toBe(ANTHROPIC_KEY);

    await page.getByTestId('llm-default-model-select').click();
    await page.getByRole('option', { name: 'Anthropic — claude-opus-5-5', exact: true }).click();
    // Wait for the profile PUT so the /chat reload below cannot read a stale
    // server-side profile without the Anthropic key.
    putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-default-save').click();
    await putResponse;
    expect(llmOf(apiMock.lastPut()).defaultModel).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    await expect(page.getByText('Active: Anthropic • claude-opus-5-5')).toBeVisible();

    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Anthropic • claude-opus-5-5')).toBeVisible();

    // Navigate to Chat and send a message
    await page.goto('/chat');
    await waitForPageLoad(page);
    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello from default pair test');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('anthropic');
    expect(chatBody.model).toBe('claude-opus-5-5');
    expect(chatBody.apiKey).toBe(ANTHROPIC_KEY);
    expect(chatBody).not.toHaveProperty('thinking');

    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const analyzeBody = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    expect(analyzeBody.provider).toBe('anthropic');
    expect(analyzeBody.model).toBe('claude-opus-5-5');
    expect(analyzeBody.apiKey).toBe(ANTHROPIC_KEY);
    await expect(page.getByText('Mock streamed analysis of the sentence.')).toBeVisible();
  });

  test('should resolve an OpenRouter custom model ID without provider ambiguity', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { openai: OPENAI_KEY, openrouter: OPENROUTER_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    apiMock.dictionaryEntries = [dictionaryEntry(SYNTHETIC_USER_A.userId)];
    await gotoSettings(page);

    await page.getByTestId('llm-default-model-select').click();
    await page.getByRole('option', { name: 'OpenRouter (custom ID)', exact: true }).click();
    await page.getByTestId('llm-default-model-input').fill('gpt-6.1-sol');
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-default-save').click();
    await putResponse;
    expect(llmOf(apiMock.lastPut()).defaultModel).toEqual({
      provider: 'openrouter',
      model: 'gpt-6.1-sol',
    });
    await expect(page.getByText('Active: OpenRouter • gpt-6.1-sol')).toBeVisible();

    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: OpenRouter • gpt-6.1-sol')).toBeVisible();

    await page.goto('/chat');
    await waitForPageLoad(page);
    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello from OpenRouter test');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('openrouter');
    expect(chatBody.model).toBe('gpt-6.1-sol');
    expect(chatBody.apiKey).toBe(OPENROUTER_KEY);

    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const analyzeBody = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    expect(analyzeBody.provider).toBe('openrouter');
    expect(analyzeBody.model).toBe('gpt-6.1-sol');
    expect(analyzeBody.apiKey).toBe(OPENROUTER_KEY);
    await expect(page.getByText('Mock streamed analysis of the sentence.')).toBeVisible();
  });
});

test.describe('LLM Settings - Server-key capabilities', () => {
  test('should advertise authenticated server-key providers for chat defaults', async ({
    authedPage: page,
    apiMock,
  }) => {
    await gotoSettings(page);

    await expect(
      page.getByText('Server key available for chat: Google, OpenRouter.'),
    ).toBeVisible();
    await expect(
      page.getByText('Chat uses the server key; My Dictionaries requires your own Google API key'),
    ).toBeVisible();

    await page.getByTestId('llm-default-model-select').click();
    await expect(
      page.getByRole('option', { name: 'Google — gemini-3.8-flash (server key)' }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'OpenRouter (custom ID, server key)' }),
    ).toBeVisible();

    const capabilityCalls = apiMock.authHeaders.filter(
      (h) => h.method === 'GET' && h.path === '/api/llm-chat/capabilities',
    );
    expect(capabilityCalls.length).toBeGreaterThan(0);
    for (const call of capabilityCalls) {
      expect(call.authorization).toBe(apiMock.expectedAuthorization);
    }
  });

  test('should offer no server-key fallback when the capabilities lookup fails', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.serverKeyProviders = null;
    await gotoSettings(page);

    await expect(page.getByText('Server key available for chat:')).toBeHidden();

    await page.getByTestId('llm-default-model-select').click();
    await expect(page.getByRole('option', { name: /\(server key\)/ })).toHaveCount(0);
    await expect(
      page.getByRole('option', { name: 'Google — gemini-3.8-flash', exact: true }),
    ).toBeVisible();
  });

  test('should reject API requests without a valid synthetic bearer token', async ({
    authedPage: page,
  }) => {
    await gotoSettings(page);

    const statuses = await page.evaluate(async () => {
      const anonymous = await fetch('/api/llm-chat/capabilities');
      const wrongToken = await fetch('/api/llm-chat/capabilities', {
        headers: { Authorization: 'Bearer e2e-bogus-token' },
      });
      return [anonymous.status, wrongToken.status];
    });
    expect(statuses).toEqual([401, 401]);
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
    // temperature is no longer part of the request contract
    expect(body).not.toHaveProperty('temperature');

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
    // The browser never selects thinking in HPA-754
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
    apiMock.dictionaryEntries = [dictionaryEntry(SYNTHETIC_USER_A.userId)];
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
    apiMock.dictionaryEntries = [dictionaryEntry(SYNTHETIC_USER_A.userId)];
    await page.goto('/my-dictionaries');
    await waitForPageLoad(page);
    await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();

    const analyzeRequest = page.waitForRequest(
      (r) => r.url().includes('/api/my-dictionaries/analyze') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask AI' }).click();

    const body = (await analyzeRequest).postDataJSON() as Record<string, unknown>;
    expect(body).not.toHaveProperty('thinking');
    expect(body.provider).toBe('google');
  });

  test('should send no key to dictionary analysis on a server-key-only default', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {});
    apiMock.dictionaryEntries = [dictionaryEntry(SYNTHETIC_USER_A.userId)];

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

    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');
  });

  test('should reset LLM state for a new user after sign-out', async ({
    authedPage: page,
    apiMock,
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

    await page.locator('.avatar-btn').click();
    await page.locator('.account-menu').getByText('Logout', { exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login/);

    const signedOut = await page.evaluate(() => {
      const app = (
        document.getElementById('q-app') as unknown as {
          __vue_app__?: { _context?: { provides?: Record<symbol, unknown> } };
        }
      ).__vue_app__;
      const provides = app?._context?.provides ?? {};
      const pinia = Object.getOwnPropertySymbols(provides)
        .map((key) => provides[key])
        .find(
          (value): value is { state: { value: Record<string, unknown> } } =>
            !!value && typeof value === 'object' && '_s' in value && 'state' in value,
        );
      const state = pinia?.state.value ?? {};
      return {
        piniaFound: !!pinia,
        user: (state.auth as { user?: unknown } | undefined)?.user ?? null,
        session: (state.auth as { session?: unknown } | undefined)?.session ?? null,
        llm: (state.llmSettings as { llm?: unknown } | undefined)?.llm ?? null,
      };
    });
    expect(signedOut.piniaFound).toBe(true);
    expect(signedOut.user).toBeNull();
    expect(signedOut.session).toBeNull();
    expect(signedOut.llm).toEqual({
      keys: {},
      thinking: {},
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    });

    await page.evaluate(() => {
      (window as unknown as { __e2eRuntimeSentinel?: string }).__e2eRuntimeSentinel =
        'same-runtime';
    });

    const tokensB = makeSyntheticTokens(SYNTHETIC_USER_B);
    const transition = await page.evaluate(
      (entries) => {
        for (const [key, value] of entries) {
          window.localStorage.setItem(key, value);
        }
        const app = (
          document.getElementById('q-app') as unknown as {
            __vue_app__?: {
              _context?: {
                provides?: Record<symbol, unknown>;
                config?: { globalProperties?: Record<string, unknown> };
              };
            };
          }
        ).__vue_app__;
        const provides = app?._context?.provides ?? {};
        const pinia = Object.getOwnPropertySymbols(provides)
          .map((key) => provides[key])
          .find(
            (
              value,
            ): value is {
              _s: Map<string, unknown>;
              state: { value: Record<string, unknown> };
            } => !!value && typeof value === 'object' && '_s' in value && 'state' in value,
          );
        if (!pinia) throw new Error('Pinia instance not found on the live app');
        const store = pinia._s.get('auth') as
          | {
              isInitialized: boolean;
              user: { id: string } | null;
              session: unknown;
              initialize: () => Promise<void>;
            }
          | undefined;
        if (!store) throw new Error('Auth store not found on the live app');
        const router = app?._context?.config?.globalProperties?.['$router'] as
          | {
              push: (_location: string) => Promise<unknown>;
              currentRoute: { value: { path: string } };
            }
          | undefined;
        if (!router) throw new Error('Vue Router instance not found on the live app');
        const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
        store.user = { id: 'e2e-watcher-probe' };
        store.session = { e2e: true };
        return flush()
          .then(() => {
            store.user = null;
            store.session = null;
            store.isInitialized = false;
            return store.initialize();
          })
          .then(() => router.push('/settings'))
          .then(
            () => ({
              path: router.currentRoute.value.path,
              userId: store.user?.id ?? null,
              hasSession: !!store.session,
              isInitialized: store.isInitialized,
            }),
            () => 'transition rejected',
          );
      },
      buildSessionEntries(SYNTHETIC_USER_B, tokensB),
    );
    expect(transition).toEqual({
      path: '/settings',
      userId: SYNTHETIC_USER_B.userId,
      hasSession: true,
      isInitialized: true,
    });

    const sentinel = await page.evaluate(
      () => (window as unknown as { __e2eRuntimeSentinel?: string }).__e2eRuntimeSentinel,
    );
    expect(sentinel).toBe('same-runtime');

    await waitForPageLoad(page);
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');

    const bAuthCalls = apiMock.authHeaders.filter(
      (h) => h.path === '/api/profiles/create' || h.path === '/api/profiles',
    );
    expect(bAuthCalls.some((h) => h.authorization === `Bearer ${tokensB.idToken}`)).toBe(true);
    expect(apiMock.profiles.get(SYNTHETIC_USER_B.userId)).toBeTruthy();

    const callCountBeforeReload = apiMock.authHeaders.length;
    await stageSessionFor(page, SYNTHETIC_USER_B, tokensB);
    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');
    await expect(page.getByTestId('llm-card-google').getByText('No key saved')).toBeVisible();

    const reloadedCalls = apiMock.authHeaders.slice(callCountBeforeReload);
    expect(reloadedCalls.length).toBeGreaterThan(0);
    for (const call of reloadedCalls) {
      expect(call.authorization).toBe(`Bearer ${tokensB.idToken}`);
    }
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
