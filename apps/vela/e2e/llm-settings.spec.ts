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

const waitForTtsSettingsGet = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/api/tts/settings') && r.request().method() === 'GET',
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
  test('rebases a stale tab save without losing another tab’s provider key', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A);
    const secondTab = await page.context().newPage();
    await gotoSettings(page);
    await gotoSettings(secondTab);

    await openCard(page, 'google');
    await keyInput(page, 'google').fill(GOOGLE_KEY);
    const firstSave = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    expect((await firstSave).status()).toBe(200);

    await openCard(secondTab, 'openai');
    await keyInput(secondTab, 'openai').fill(OPENAI_KEY);
    const conflict = secondTab.waitForResponse(
      (response) => response.url().includes('/api/profiles/update') && response.status() === 409,
    );
    const retried = secondTab.waitForResponse(
      (response) => response.url().includes('/api/profiles/update') && response.status() === 200,
    );
    await secondTab.getByTestId('llm-save-openai').click();
    await conflict;
    await retried;
    expect(llmOf(apiMock.lastPut()).keys).toEqual({ google: GOOGLE_KEY, openai: OPENAI_KEY });
    // The replay carries its complete-snapshot write marker.
    expect(apiMock.lastPut()?.llm_write_contract).toBe('complete-llm-v1');
    await secondTab.close();
  });

  test('should refuse editable LLM forms when the profile read has no contract', async ({
    authedPage: page,
    apiMock,
  }) => {
    // An API deployed before the contract (or any response that was not
    // verified as complete) must not become a blank editable form.
    apiMock.readContract = null;
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await page.goto('/settings');
    await waitForPageLoad(page);

    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('llm-reload-required')).toBeVisible();
    await expect(page.getByTestId('llm-card-google')).toHaveCount(0);
    await expect(page.getByTestId('llm-key-input-google')).toHaveCount(0);
    await expect(page.getByTestId('llm-default-model-select')).toHaveCount(0);
    expect(apiMock.profilePuts).toHaveLength(0);
  });

  test('should reject an old-client LLM write without the marker even after a newer save', async ({
    authedPage: page,
    apiMock,
  }) => {
    const seeded = apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    seeded.preferences_version = crypto.randomUUID();
    await gotoSettings(page);

    // The old tab captured the profile (and its non-null version) before deployment.
    const capturedVersion = await page.evaluate(
      async ([auth, userId]) => {
        const response = await fetch(`/api/profiles?user_id=${encodeURIComponent(userId ?? '')}`, {
          headers: { Authorization: auth ?? '' },
        });
        const body = (await response.json()) as {
          profile?: { preferences_version?: string | null };
        };
        return body.profile?.preferences_version ?? null;
      },
      [apiMock.expectedAuthorization, SYNTHETIC_USER_A.userId] as const,
    );

    // A newer marked save advances the stored version.
    await openCard(page, 'google');
    await keyInput(page, 'google').fill('e2e-newer-google-key');
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    expect((await putResponse).status()).toBe(200);

    const oldClientStatus = await page.evaluate(
      async ([auth, userId, version, currentKey]) => {
        const response = await fetch('/api/profiles/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
          body: JSON.stringify({
            user_id: userId,
            expected_preferences_version: version,
            preferences: {
              llm: {
                keys: { google: currentKey },
                thinking: {},
                defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
              },
            },
          }),
        });
        return response.status;
      },
      [
        apiMock.expectedAuthorization,
        SYNTHETIC_USER_A.userId,
        capturedVersion,
        GOOGLE_KEY,
      ] as const,
    );
    // The read-contract fence runs before the version CAS: the stale captured
    // version is never consulted, so this is 428 rather than 409.
    expect(oldClientStatus).toBe(428);

    const storedLlm = apiMock.profiles.get(SYNTHETIC_USER_A.userId)?.preferences.llm as
      { keys?: Record<string, string> } | undefined;
    expect(storedLlm?.keys?.google).toBe('e2e-newer-google-key');
  });

  test('should reject a markerless LLM write without creating mock profile storage', async ({
    authedPage: page,
    apiMock,
  }) => {
    await page.goto('/settings');
    await waitForPageLoad(page);
    // Simulate a user with no stored profile yet at the rejected request.
    apiMock.profiles.delete(SYNTHETIC_USER_A.userId);

    const status = await page.evaluate(
      async ([auth, userId]) => {
        const response = await fetch('/api/profiles/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
          body: JSON.stringify({
            user_id: userId,
            expected_preferences_version: null,
            preferences: {
              llm: {
                keys: { google: 'stale-key' },
                thinking: {},
                defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
              },
            },
          }),
        });
        return response.status;
      },
      [apiMock.expectedAuthorization, SYNTHETIC_USER_A.userId] as const,
    );

    expect(status).toBe(428);
    // The real route performs no storage access before the contract check.
    expect(apiMock.profiles.has(SYNTHETIC_USER_A.userId)).toBe(false);
  });

  test('should allow pre-deploy markerless unrelated save with unchanged llm while blocking changed llm', async ({
    authedPage: page,
    apiMock,
  }) => {
    const seeded = apiMock.seedProfile(SYNTHETIC_USER_A, {
      darkMode: false,
      llm: {
        keys: { google: GOOGLE_KEY, openai: OPENAI_KEY },
        thinking: { 'gpt-6.1-sol': 'high' },
        defaultModel: { provider: 'retired-provider', model: 'retired-model' },
      },
    });
    seeded.preferences_version = crypto.randomUUID();
    await gotoSettings(page);

    const results = await page.evaluate(
      async ([auth, userId]) => {
        const getRes = await fetch(`/api/profiles?user_id=${encodeURIComponent(userId ?? '')}`, {
          headers: { Authorization: auth ?? '' },
        });
        const profile = (
          (await getRes.json()) as {
            profile: {
              preferences_version: string;
              preferences: { llm: Record<string, unknown> };
            };
          }
        ).profile;
        const unrelated = await fetch('/api/profiles/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
          body: JSON.stringify({
            user_id: userId,
            expected_preferences_version: profile.preferences_version,
            preferences: { darkMode: true, llm: profile.preferences.llm },
          }),
        });
        const changedLlm = await fetch('/api/profiles/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
          body: JSON.stringify({
            user_id: userId,
            expected_preferences_version: profile.preferences_version,
            preferences: {
              llm: {
                keys: { google: 'changed-key' },
                thinking: {},
                defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
              },
            },
          }),
        });
        return { unrelatedStatus: unrelated.status, changedStatus: changedLlm.status };
      },
      [apiMock.expectedAuthorization, SYNTHETIC_USER_A.userId] as const,
    );

    expect(results).toEqual({ unrelatedStatus: 200, changedStatus: 428 });
    const stored = apiMock.profiles.get(SYNTHETIC_USER_A.userId)?.preferences as {
      darkMode?: boolean;
      llm?: { defaultModel?: { provider?: string }; keys?: Record<string, string> };
    };
    expect(stored.darkMode).toBe(true);
    expect(stored.llm?.defaultModel?.provider).toBe('retired-provider');
    expect(stored.llm?.keys).toEqual({ google: GOOGLE_KEY, openai: OPENAI_KEY });
  });

  test('should preserve stored keys when PUT omits profile or returns an unmarked profile', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      darkMode: false,
      llm: {
        keys: { google: GOOGLE_KEY, openai: OPENAI_KEY },
        thinking: { 'gpt-6.1-sol': 'high' },
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoSettings(page);

    // 1. PUT returns an unmarked profile while GET still returns the contract:
    // the post-save GET refresh restores complete-snapshot editing.
    apiMock.putReadContract = null;
    await page.getByTestId('dark-mode-toggle').click();
    const unmarkedPut = waitForProfilePut(page);
    const getAfterUnmarkedPut = page.waitForResponse(
      (r) => r.url().includes('/api/profiles?') && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Save to profile' }).click();
    expect((await unmarkedPut).status()).toBe(200);
    await getAfterUnmarkedPut;
    await expect(page.getByTestId('llm-card-google')).toBeVisible();

    // 2. PUT omits profile altogether and the subsequent GET refresh fails:
    // the fallback profile must keep stored llm keys intact.
    apiMock.putReadContract = 'inherit';
    apiMock.omitPutProfile = true;
    await page.route('**/api/profiles?*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Refresh failed' }),
      }),
    );
    await page.getByTestId('dark-mode-toggle').click();
    const omittedPut = waitForProfilePut(page);
    const failedRefresh = page.waitForResponse(
      (r) =>
        r.url().includes('/api/profiles?') && r.request().method() === 'GET' && r.status() === 500,
    );
    await page.getByRole('button', { name: 'Save to profile' }).click();
    expect((await omittedPut).status()).toBe(200);
    // Unroute only after the refresh is observed failing: a successful refresh
    // would restore the server profile and mask a broken fallback.
    await failedRefresh;

    await page.unroute('**/api/profiles?*');
    apiMock.omitPutProfile = false;
    await openCard(page, 'google');
    await keyInput(page, 'google').fill('e2e-updated-google-key');
    // The failed refresh leaves a stale preferences_version, so this save
    // conflicts and the client refetches and replays it.
    const conflict = page.waitForResponse(
      (r) => r.url().includes('/api/profiles/update') && r.status() === 409,
    );
    const retried = page.waitForResponse(
      (r) => r.url().includes('/api/profiles/update') && r.status() === 200,
    );
    await page.getByTestId('llm-save-google').click();
    await conflict;
    await retried;

    // The conflicted PUT is built from the local fallback profile before the
    // refetch, so its llm is what the fallback preserved — the replay alone
    // would restore untouched keys and thinking from the server snapshot.
    const conflictedLlm = llmOf(apiMock.profilePuts.at(-2));
    expect(conflictedLlm.keys).toEqual({
      google: 'e2e-updated-google-key',
      openai: OPENAI_KEY,
    });
    expect(conflictedLlm.thinking).toEqual({ 'gpt-6.1-sol': 'high' });

    const storedLlm = apiMock.profiles.get(SYNTHETIC_USER_A.userId)?.preferences.llm as {
      keys?: Record<string, string>;
      thinking?: Record<string, string>;
    };
    expect(storedLlm.keys).toEqual({
      google: 'e2e-updated-google-key',
      openai: OPENAI_KEY,
    });
    expect(storedLlm.thinking).toEqual({ 'gpt-6.1-sol': 'high' });
  });

  test('should refuse a conflicted LLM replay when the refetch has no read contract', async ({
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
    const secondTab = await page.context().newPage();
    await gotoSettings(page);
    await gotoSettings(secondTab);

    await openCard(page, 'google');
    await keyInput(page, 'google').fill('e2e-first-tab-key');
    const firstSave = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    expect((await firstSave).status()).toBe(200);

    // The refetch after the conflict is served without the contract.
    apiMock.readContract = null;
    await openCard(secondTab, 'openai');
    await keyInput(secondTab, 'openai').fill(OPENAI_KEY);
    const conflict = secondTab.waitForResponse(
      (response) => response.url().includes('/api/profiles/update') && response.status() === 409,
    );
    await secondTab.getByTestId('llm-save-openai').click();
    expect((await conflict).status()).toBe(409);

    await expect(secondTab.getByTestId('llm-reload-required')).toBeVisible();
    // Only the first tab's save and the second tab's conflicted attempt were sent.
    expect(apiMock.profilePuts).toHaveLength(2);
    const storedLlm = apiMock.profiles.get(SYNTHETIC_USER_A.userId)?.preferences.llm as
      { keys?: Record<string, string> } | undefined;
    expect(storedLlm?.keys?.openai).toBeUndefined();
    await secondTab.close();
  });

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
    // Explicitly seed the synthetic profile starting state: active provider
    // Google with a saved key, no OpenAI key.
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
    // This profile has no saved override, so the request omits thinking.
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

  test('should recover an unknown stored provider and keep explicit clears on save', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY, openai: OPENAI_KEY },
        thinking: { 'gemini-4-argon': 'high', 'gpt-6.1-sol': 'medium' },
        defaultModel: { provider: 'retired-provider', model: 'retired-model' },
      },
    });
    await gotoSettings(page);

    // An unknown stored provider reads back as the Google default without
    // dropping the recoverable keys or thinking overrides.
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();
    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue(GOOGLE_KEY);
    await expect(page.getByTestId('llm-effort-gemini-4-argon')).toHaveValue('high');

    await keyInput(page, 'google').fill('');
    await page.getByTestId('llm-effort-gemini-4-argon').click();
    await page.getByRole('option', { name: 'Default', exact: true }).click();
    const putResponse = waitForProfilePut(page);
    await page.getByTestId('llm-save-google').click();
    expect((await putResponse).status()).toBe(200);

    // An explicit llm replacement is authoritative: the cleared key and effort
    // are gone and no tombstone entries are written.
    expect(llmOf(apiMock.lastPut())).toEqual({
      keys: { openai: OPENAI_KEY },
      thinking: { 'gpt-6.1-sol': 'medium' },
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    });

    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByText('Active: Google • gemini-3.8-flash')).toBeVisible();

    await openCard(page, 'google');
    await expect(keyInput(page, 'google')).toHaveValue('');
    await expect(page.getByTestId('llm-card-google').getByText('No key saved')).toBeVisible();
    await expect(page.getByTestId('llm-effort-gemini-4-argon')).toHaveValue('Default');

    await openCard(page, 'openai');
    await expect(keyInput(page, 'openai')).toHaveValue(OPENAI_KEY);
    await expect(page.getByTestId('llm-effort-gpt-6.1-sol')).toHaveValue('medium');
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

  test('mocked profile save rejects preference versions the API schema rejects', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A);
    await gotoSettings(page);

    const statuses = await page.evaluate(
      async ([auth, userId]) => {
        const put = (version: string | null) =>
          fetch('/api/profiles/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
            body: JSON.stringify({
              user_id: userId,
              preferences: { dailyGoal: 30 },
              expected_preferences_version: version,
            }),
          });
        // UUID-shaped but with invalid RFC 4122 variant bits — the API's Zod
        // schema rejects it even though it looks like a UUID.
        const badVariant = await put('11111111-1111-4111-1111-111111111111');
        // A valid UUID that does not match the stored version must still reach
        // the version check and conflict.
        const mismatch = await put(crypto.randomUUID());
        return [badVariant.status, mismatch.status];
      },
      [apiMock.expectedAuthorization, SYNTHETIC_USER_A.userId] as const,
    );
    expect(statuses).toEqual([400, 409]);
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
    // Unrelated saves omit llm entirely so the API keeps the raw stored subtree.
    expect(prefs.llm).toBeUndefined();
    const storedLlm = apiMock.profiles.get(SYNTHETIC_USER_A.userId)?.preferences.llm as
      { keys?: Record<string, string> } | undefined;
    expect(storedLlm?.keys?.google).toBe(GOOGLE_KEY);
  });

  test('should keep TTS save disabled without a key and accept a saved key', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {});
    const ttsLoaded = waitForTtsSettingsGet(page);
    await gotoSettings(page);
    await ttsLoaded;

    await expect(page.getByTestId('tts-provider-select')).toBeVisible();
    await expect(page.getByTestId('tts-save')).toBeDisabled();
    await expect(page.getByText('Not configured')).toBeVisible();
    await expect(page.getByText('Your ElevenLabs API key')).toBeVisible();

    await page.getByTestId('tts-api-key-input').fill('e2e-tts-key-0001');
    await expect(page.getByTestId('tts-save')).toBeEnabled();

    const ttsPost = page.waitForResponse(
      (r) => r.url().includes('/api/tts/settings') && r.request().method() === 'POST',
    );
    await page.getByTestId('tts-save').click();
    await ttsPost;
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();

    // The saved key belongs to ElevenLabs only: an unsaved provider must not
    // inherit it, and returning restores the retained-key state.
    await page.getByTestId('tts-provider-select').click();
    await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
    await expect(page.getByTestId('tts-save')).toBeDisabled();
    await expect(page.getByText('Not configured')).toBeVisible();
    await expect(page.getByText('Leave blank to keep the saved ElevenLabs key')).toBeHidden();

    await page.getByTestId('tts-provider-select').click();
    await page.getByRole('option', { name: 'ElevenLabs', exact: true }).click();
    await expect(page.getByTestId('tts-save')).toBeEnabled();
    await expect(page.getByText('Leave blank to keep the saved ElevenLabs key')).toBeVisible();
  });

  test('should retain the same-provider key on a model-only save and persist it', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A, {});
    apiMock.ttsSettings = {
      provider: 'elevenlabs',
      voiceId: 'ErXwobaYiN019PkySvjV',
      model: 'eleven_v4',
      hasApiKey: true,
    };
    await gotoSettings(page);

    // Configured: a model-only change needs no key.
    await expect(page.getByTestId('tts-save')).toBeEnabled();
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
    await expect(page.getByText('Leave blank to keep the saved ElevenLabs key')).toBeVisible();

    await page.getByTestId('tts-model-input').click();
    await page.getByRole('option', { name: 'Eleven Multilingual v2', exact: true }).click();
    await expect(page.getByTestId('tts-model-input')).toHaveValue('Eleven Multilingual v2');

    const ttsPost = page.waitForResponse(
      (r) => r.url().includes('/api/tts/settings') && r.request().method() === 'POST',
    );
    const settingsRefetch = waitForTtsSettingsGet(page);
    await page.getByTestId('tts-save').click();
    const postBody = JSON.parse((await (await ttsPost).request().postData()) ?? '{}') as Record<
      string,
      unknown
    >;
    // A blank key is omitted so the API retains the same-provider key.
    expect(postBody).toEqual({
      provider: 'elevenlabs',
      voiceId: 'ErXwobaYiN019PkySvjV',
      model: 'eleven_multilingual_v2',
    });

    // The mutation invalidates the settings query; the refetch must return the
    // saved model and the retained key so the form does not fall back.
    const refetched = (await (await settingsRefetch).json()) as Record<string, unknown>;
    expect(refetched).toEqual({
      provider: 'elevenlabs',
      voiceId: 'ErXwobaYiN019PkySvjV',
      model: 'eleven_multilingual_v2',
      hasApiKey: true,
    });
    await expect(page.getByTestId('tts-model-input')).toHaveValue('Eleven Multilingual v2');
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tts-save')).toBeEnabled();

    // Blank-key retention is same-provider only, mirroring the API route.
    const crossProvider = await page.evaluate(
      async ([auth]) => {
        const response = await fetch('/api/tts/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth ?? '' },
          body: JSON.stringify({ provider: 'openai' }),
        });
        return { status: response.status, body: await response.json() };
      },
      [apiMock.expectedAuthorization] as const,
    );
    expect(crossProvider.status).toBe(400);
    expect(crossProvider.body).toMatchObject({ code: 'tts_not_configured' });

    await page.reload();
    await waitForPageLoad(page);
    await expect(page.getByTestId('tts-model-input')).toHaveValue('Eleven Multilingual v2');
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
    expect(apiMock.ttsSettings).toEqual({
      provider: 'elevenlabs',
      voiceId: 'ErXwobaYiN019PkySvjV',
      model: 'eleven_multilingual_v2',
      hasApiKey: true,
    });
  });
});
