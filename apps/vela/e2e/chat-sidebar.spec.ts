import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

const GREETING_SNIPPET = '日本語学習をお手伝いします';
// Mirrors AIChatPage's GREETING_MESSAGE: thread restore prepends it when the
// stored transcript does not already start with it.
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 667 };

const gotoChat = async (page: Page) => {
  const threadsResponse = page.waitForResponse(
    (r) => r.url().includes('/api/chat-history/threads') && r.request().method() === 'GET',
  );
  await page.goto('/chat');
  await threadsResponse;
  await waitForPageLoad(page);
  await expect(page.getByTestId('ai-chat-page')).toBeVisible();
};

const openSidebar = async (page: Page, mobile: boolean): Promise<Locator> => {
  if (!mobile) {
    const pane = page.getByTestId('chat-sidebar-pane');
    await expect(pane).toBeVisible();
    return pane;
  }
  await page.getByTestId('llm-chat-history').click();
  const dialogSidebar = page.locator('.q-dialog .chat-sidebar-mobile');
  await expect(dialogSidebar).toBeVisible();
  return dialogSidebar;
};

const expectGlobalNav = async (page: Page, mobile: boolean) => {
  if (!mobile) {
    await expect(page.getByTestId('left-drawer')).toBeVisible();
    return;
  }
  await expect(page.getByTestId('btn-open-nav')).toBeVisible();
};

const sendAndWaitForThread = async (page: Page, text: string) => {
  const threadsRefresh = page.waitForResponse(
    (r) => r.url().includes('/api/chat-history/threads') && r.request().method() === 'GET',
  );
  await page.getByTestId('llm-chat-input').fill(text);
  await page.getByTestId('llm-chat-send').click();
  await threadsRefresh;
};

const runConversationLifecycle = async (page: Page, apiMock: MockApi, mobile: boolean) => {
  apiMock.seedProfile(SYNTHETIC_USER_A);
  await gotoChat(page);

  await expectGlobalNav(page, mobile);
  await expect(page.locator('.chat-container')).toContainText(GREETING_SNIPPET);

  await sendAndWaitForThread(page, 'Hello sidebar thread');
  await expect(page.locator('.chat-container')).toContainText('Mock AI reply');

  const sidebar = await openSidebar(page, mobile);
  const rows = sidebar.getByTestId('llm-chat-thread-item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Hello sidebar thread');

  const patchResponse = page.waitForResponse(
    (r) => r.url().includes('/api/chat-history/thread/') && r.request().method() === 'PATCH',
  );
  await rows.first().getByTestId('chat-thread-menu').click();
  await page.getByTestId('chat-thread-rename').click();
  await page.getByTestId('chat-thread-rename-input').fill('Renamed sidebar chat');
  await page.getByTestId('chat-thread-rename-input').press('Enter');
  await patchResponse;
  await expect(rows.first()).toContainText('Renamed sidebar chat');

  await page.reload();
  await waitForPageLoad(page);
  const sidebarAfterReload = await openSidebar(page, mobile);
  const rowsAfterReload = sidebarAfterReload.getByTestId('llm-chat-thread-item');
  await expect(rowsAfterReload).toHaveCount(1);
  await expect(rowsAfterReload.first()).toContainText('Renamed sidebar chat');

  await rowsAfterReload.first().click();
  await expect(page.locator('.chat-container')).toContainText('Hello sidebar thread');
  await expect(page.locator('.chat-container')).toContainText('Mock AI reply');
  if (mobile) {
    await expect(page.locator('.q-dialog .chat-sidebar-mobile')).toBeHidden();
  }

  const sidebarForDelete = await openSidebar(page, mobile);
  const deleteResponse = page.waitForResponse(
    (r) => r.url().includes('/api/chat-history/thread/') && r.request().method() === 'DELETE',
  );
  await sidebarForDelete.getByTestId('chat-thread-menu').first().click();
  await page.getByTestId('llm-chat-delete-thread').click();
  await expect(page.getByTestId('llm-chat-confirm-delete')).toBeVisible();
  await page.getByTestId('llm-chat-confirm-delete').click();
  await deleteResponse;
  await expect(page.locator('.chat-container')).toContainText(GREETING_SNIPPET);
  await expect(page.locator('.chat-container')).not.toContainText('Hello sidebar thread');
};

const runBoundedScrollCheck = async (page: Page, apiMock: MockApi, mobile: boolean) => {
  apiMock.seedProfile(SYNTHETIC_USER_A);
  const now = Date.now();
  for (let i = 1; i <= 30; i += 1) {
    apiMock.seedThread(SYNTHETIC_USER_A, {
      ThreadId: `seeded-${i}`,
      title: `Seeded conversation ${i}`,
      createdAt: now - i * 120_000,
      updatedAt: now - i * 60_000,
    });
  }
  apiMock.seedThread(SYNTHETIC_USER_A, {
    ThreadId: 'long-thread',
    title: 'Long conversation',
    createdAt: now - 2_000,
    updatedAt: now,
  });
  for (let i = 0; i < 40; i += 1) {
    apiMock.seedMessage(
      SYNTHETIC_USER_A,
      'long-thread',
      `Seeded message ${i} with a reasonably long body of text`,
      i % 2 === 0,
      now - 40_000 + i * 1_000,
    );
  }

  await gotoChat(page);
  const sidebar = await openSidebar(page, mobile);
  await expect(sidebar.getByTestId('llm-chat-thread-item')).toHaveCount(31);

  const sidebarList = sidebar.locator('.chat-sidebar__list');
  const sidebarMetrics = await sidebarList.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(sidebarMetrics.scrollHeight).toBeGreaterThan(sidebarMetrics.clientHeight);
  await sidebarList.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await sidebarList.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await sidebar.getByTestId('llm-chat-thread-item').first().click();
  if (mobile) {
    await expect(page.locator('.q-dialog .chat-sidebar-mobile')).toBeHidden();
  }

  const chatList = page.locator('.chat-container');
  await expect(chatList.getByText('Seeded message 39')).toBeInViewport();
  await expect(chatList.getByText('Seeded message 0')).not.toBeInViewport();

  let parkedSidebarScroll: number | null = null;
  if (!mobile) {
    await sidebarList.evaluate((el) => {
      el.scrollTop = 400;
    });
    parkedSidebarScroll = await sidebarList.evaluate((el) => el.scrollTop);
    expect(parkedSidebarScroll).toBe(400);
  }

  const chatMetrics = await chatList.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(chatMetrics.scrollHeight).toBeGreaterThan(chatMetrics.clientHeight);

  const composer = page.getByTestId('llm-chat-input');
  const composerBoxBefore = await composer.boundingBox();
  const headerBoxBefore = await page.locator('.chat-title').boundingBox();
  const columnBoxBefore = await page.locator('.chat-column').boundingBox();
  const sidebarPaneBoxBefore = mobile
    ? null
    : await page.getByTestId('chat-sidebar-pane').boundingBox();
  expect(composerBoxBefore).not.toBeNull();

  await chatList.evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await chatList.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(chatList.getByText('Seeded message 0')).toBeInViewport();
  await expect(chatList.getByText('Seeded message 39')).not.toBeInViewport();

  expect(await composer.boundingBox()).toEqual(composerBoxBefore);
  expect(await page.locator('.chat-title').boundingBox()).toEqual(headerBoxBefore);
  expect(await page.locator('.chat-column').boundingBox()).toEqual(columnBoxBefore);
  if (sidebarPaneBoxBefore) {
    expect(await page.getByTestId('chat-sidebar-pane').boundingBox()).toEqual(sidebarPaneBoxBefore);
    expect(await sidebarList.evaluate((el) => el.scrollTop)).toBe(parkedSidebarScroll);
  }

  const bounds = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    docHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
  }));
  expect(bounds.docHeight).toBeLessThanOrEqual(bounds.innerHeight);
  expect(bounds.scrollY).toBe(0);

  if (mobile) {
    const dialogSidebar = await openSidebar(page, true);
    const dialogList = dialogSidebar.locator('.chat-sidebar__list');
    await dialogList.evaluate((el) => {
      el.scrollTop = 40;
    });
    await chatList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await chatList.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await dialogList.evaluate((el) => el.scrollTop)).toBe(40);
    await expect(chatList.getByText('Seeded message 39')).toBeInViewport();
    await expect(chatList.getByText('Seeded message 0')).not.toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.locator('.q-dialog .chat-sidebar-mobile')).toBeHidden();
  } else {
    await chatList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(chatList.getByText('Seeded message 39')).toBeInViewport();
    expect(await sidebarList.evaluate((el) => el.scrollTop)).toBe(parkedSidebarScroll);
    expect(await composer.boundingBox()).toEqual(composerBoxBefore);
  }
};

test.describe('Chat sidebar - desktop (1280px)', () => {
  test.use({ viewport: DESKTOP });

  test('renders a persistent sidebar beside the global navigation', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A);
    await gotoChat(page);
    await expect(page.getByTestId('chat-sidebar-pane')).toBeVisible();
    await expect(page.getByTestId('llm-chat-history')).toBeHidden();
    await expect(page.getByTestId('left-drawer')).toBeVisible();
    await expect(page.getByTestId('chat-sidebar-pane').getByTestId('llm-chat-new')).toBeVisible();
  });

  test('supports the full send/rename/reload/delete lifecycle', async ({
    authedPage: page,
    apiMock,
  }) => {
    await runConversationLifecycle(page, apiMock, false);
  });

  test('keeps page bounded with independent sidebar and message scrolling', async ({
    authedPage: page,
    apiMock,
  }) => {
    await runBoundedScrollCheck(page, apiMock, false);
  });
});

const GOOGLE_KEY = 'e2e-google-key-0001';
const ANTHROPIC_KEY = 'e2e-anthropic-key-0001';
const OPENROUTER_KEY = 'e2e-openrouter-key-0001';

const chooseModel = async (page: Page, label: string) => {
  await page.getByTestId('chat-model-select').click();
  await page.getByRole('option', { name: label, exact: true }).click();
};

const cacheChip = (page: Page) => page.getByTestId('chat-cache-reminder');

// Message bubble texts in DOM order (markdown bubbles keep their plain text).
const transcriptTexts = (page: Page) =>
  page
    .locator('.chat-container .q-message .message-content')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));

const llmPreferences = (defaultModel: { provider: string; model: string }) => ({
  llm: {
    keys: { google: GOOGLE_KEY, anthropic: ANTHROPIC_KEY, openrouter: OPENROUTER_KEY },
    thinking: {},
    defaultModel,
  },
});

test.describe('Chat model picker and cache reminder - desktop (1280px)', () => {
  test.use({ viewport: DESKTOP });

  test('carries a fresh-chat selection on the first user save without a model PATCH', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'google', model: 'gemini-3.8-flash' }),
    );
    await gotoChat(page);

    await expect(page.getByTestId('chat-model-select')).toHaveValue('Google — gemini-3.8-flash');
    await chooseModel(page, 'Anthropic — claude-opus-5-5');
    await expect(page.getByTestId('chat-model-select')).toHaveValue('Anthropic — claude-opus-5-5');

    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello new model');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('anthropic');
    expect(chatBody.model).toBe('claude-opus-5-5');
    expect(chatBody.apiKey).toBe(ANTHROPIC_KEY);

    await expect(page.locator('.chat-container')).toContainText('Mock AI reply');
    // A fresh chat has no thread row yet: the first user save pins the model.
    expect(apiMock.patchThreadBodies).toEqual([]);
    const userSave = apiMock.chatHistorySaves.find((b) => b.is_user === true);
    expect(userSave?.model).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });

  test('switches models mid-chat on a saved thread, PATCHes once and keeps history after reload', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'google', model: 'gemini-3.8-flash' }),
    );
    const now = Date.now();
    apiMock.seedThread(SYNTHETIC_USER_A, {
      ThreadId: 'legacy-thread',
      title: 'Legacy conversation',
      createdAt: now - 10_000,
      updatedAt: now - 5_000,
    });
    apiMock.seedMessage(SYNTHETIC_USER_A, 'legacy-thread', 'Persisted hello', true, now - 4_000);
    apiMock.seedMessage(SYNTHETIC_USER_A, 'legacy-thread', 'Persisted reply', false, now - 3_000);

    await gotoChat(page);
    const rows = page.getByTestId('chat-sidebar-pane').getByTestId('llm-chat-thread-item');
    await rows.first().click();
    await expect(page.locator('.chat-container')).toContainText('Persisted hello');
    // A legacy row without a stored model shows the Settings default.
    await expect(page.getByTestId('chat-model-select')).toHaveValue('Google — gemini-3.8-flash');

    const patchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/chat-history/thread/') && r.request().method() === 'PATCH',
    );
    await chooseModel(page, 'Anthropic — claude-opus-5-5');
    const patch = await patchResponse;
    // No timestamp fields ride a model PATCH.
    expect(patch.request().postDataJSON()).toEqual({
      model: { provider: 'anthropic', model: 'claude-opus-5-5' },
    });
    await expect(page.getByTestId('chat-model-select')).toHaveValue('Anthropic — claude-opus-5-5');

    // The complete ordered transcript (restored greeting included) survives
    // the switch.
    await expect(page.locator('.chat-container .q-message')).toHaveCount(3);
    expect(await transcriptTexts(page)).toEqual([
      GREETING_MESSAGE,
      'Persisted hello',
      'Persisted reply',
    ]);

    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    const assistantSave = page.waitForRequest(
      (r) =>
        r.url().includes('/api/chat-history/save') &&
        r.method() === 'POST' &&
        (r.postDataJSON() as Record<string, unknown> | null)?.is_user === false,
    );
    await page.getByTestId('llm-chat-input').fill('After switching');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('anthropic');
    expect(chatBody.model).toBe('claude-opus-5-5');
    expect(chatBody.apiKey).toBe(ANTHROPIC_KEY);
    // The request carries the full ordered history, not just the latest turn.
    expect(chatBody.messages).toEqual([
      { role: 'assistant', content: GREETING_MESSAGE },
      { role: 'user', content: 'Persisted hello' },
      { role: 'assistant', content: 'Persisted reply' },
      { role: 'user', content: 'After switching' },
    ]);
    // Wait for the new assistant save so the reload sees a complete thread.
    const assistantSaveBody = (await assistantSave).postDataJSON() as Record<string, unknown>;
    expect(assistantSaveBody.message).toBe('Mock AI reply (synthetic)');

    // The persisted choice survives a reload and is restored on selection.
    await page.reload();
    await waitForPageLoad(page);
    const rowsAfterReload = page
      .getByTestId('chat-sidebar-pane')
      .getByTestId('llm-chat-thread-item');
    await expect(rowsAfterReload.first()).toBeVisible();
    await rowsAfterReload.first().click();
    await expect(page.locator('.chat-container .q-message')).toHaveCount(5);
    expect(await transcriptTexts(page)).toEqual([
      GREETING_MESSAGE,
      'Persisted hello',
      'Persisted reply',
      'After switching',
      'Mock AI reply (synthetic)',
    ]);
    await expect(page.getByTestId('chat-model-select')).toHaveValue('Anthropic — claude-opus-5-5');
  });

  test('restores cache-chip states from stored evidence: warm, near-expiry, elapsed and hidden', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'anthropic', model: 'claude-opus-5-5' }),
    );
    const now = Date.now();
    const seedCacheThread = (
      threadId: string,
      title: string,
      model: { provider: string; model: string } | undefined,
      ageMs: number,
    ) =>
      apiMock.seedThread(SYNTHETIC_USER_A, {
        ThreadId: threadId,
        title,
        createdAt: now - 600_000,
        updatedAt: now - 500_000,
        ...(model ? { model } : {}),
        ...(ageMs >= 0 ? { lastLlmAt: now - ageMs } : {}),
      });
    // Anthropic TTL is 300 s; the display grace period ends at 600 s.
    seedCacheThread(
      'warm-thread',
      'Warm cache thread',
      { provider: 'anthropic', model: 'claude-opus-5-5' },
      60_000,
    );
    seedCacheThread(
      'near-thread',
      'Near-expiry thread',
      { provider: 'anthropic', model: 'claude-opus-5-5' },
      245_000,
    );
    seedCacheThread(
      'elapsed-thread',
      'Elapsed thread',
      { provider: 'anthropic', model: 'claude-opus-5-5' },
      310_000,
    );
    seedCacheThread(
      'grace-thread',
      'Expired-grace thread',
      { provider: 'anthropic', model: 'claude-opus-5-5' },
      700_000,
    );
    // Google has no cache TTL: even fresh evidence shows no chip.
    seedCacheThread(
      'google-thread',
      'Google no-ttl thread',
      { provider: 'google', model: 'gemini-3.8-flash' },
      60_000,
    );

    await gotoChat(page);
    const rows = page.getByTestId('chat-sidebar-pane').getByTestId('llm-chat-thread-item');

    await rows.filter({ hasText: 'Warm cache thread' }).click();
    await expect(cacheChip(page)).toContainText(/Cache likely warm · [3-5]:[0-9]{2} left/);

    await rows.filter({ hasText: 'Near-expiry thread' }).click();
    await expect(cacheChip(page)).toContainText(/Cache window · 0:[0-9]{2} left/);

    await rows.filter({ hasText: 'Elapsed thread' }).click();
    await expect(cacheChip(page)).toHaveText('Cache window elapsed · next message may miss cache');

    await rows.filter({ hasText: 'Google no-ttl thread' }).click();
    await expect(cacheChip(page)).toHaveCount(0);

    await rows.filter({ hasText: 'Expired-grace thread' }).click();
    await expect(cacheChip(page)).toHaveCount(0);
  });

  test('persists cache evidence on the assistant save, and a zero-cache response or model switch clears it', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'anthropic', model: 'claude-opus-5-5' }),
    );
    apiMock.chatUsage = {
      inputTokens: 10,
      outputTokens: 6,
      cachedInputTokens: 512,
      cacheWriteTokens: 0,
    };
    await gotoChat(page);

    const assistantSaveRequest = page.waitForRequest(
      (r) =>
        r.url().includes('/api/chat-history/save') &&
        r.method() === 'POST' &&
        (r.postDataJSON() as Record<string, unknown> | null)?.is_user === false,
    );
    await page.getByTestId('llm-chat-input').fill('Warm this thread');
    await page.getByTestId('llm-chat-send').click();
    await expect(page.locator('.chat-container')).toContainText('Mock AI reply');

    // Positive usage rode the existing assistant save (no extra HTTP call).
    const firstAssistantSave = (await assistantSaveRequest).postDataJSON() as Record<
      string,
      unknown
    >;
    expect(typeof firstAssistantSave.lastLlmAt).toBe('number');
    const warmRow = apiMock
      .threadsFor(SYNTHETIC_USER_A)
      .find((t) => t.title === 'Warm this thread');
    expect(typeof warmRow?.lastLlmAt).toBe('number');
    await expect(cacheChip(page)).toContainText(/Cache likely warm · [3-5]:[0-9]{2} left/);

    // A persisted-thread model switch PATCHes model only and drops evidence.
    const patchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/chat-history/thread/') && r.request().method() === 'PATCH',
    );
    await chooseModel(page, 'Anthropic — claude-sonnet-5-5');
    const patch = await patchResponse;
    expect(patch.request().postDataJSON()).toEqual({
      model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    });
    await expect(cacheChip(page)).toHaveCount(0);

    // A zero-cache response omits lastLlmAt so the same transaction REMOVEs it.
    apiMock.chatUsage = {
      inputTokens: 5,
      outputTokens: 7,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    };
    const zeroEvidenceSave = page.waitForRequest(
      (r) =>
        r.url().includes('/api/chat-history/save') &&
        r.method() === 'POST' &&
        (r.postDataJSON() as Record<string, unknown> | null)?.is_user === false,
    );
    await page.getByTestId('llm-chat-input').fill('No cache now');
    await page.getByTestId('llm-chat-send').click();
    const zeroSaveBody = (await zeroEvidenceSave).postDataJSON() as Record<string, unknown>;
    expect(zeroSaveBody).not.toHaveProperty('lastLlmAt');
    const clearedRow = apiMock
      .threadsFor(SYNTHETIC_USER_A)
      .find((t) => t.title === 'Warm this thread');
    expect(clearedRow?.lastLlmAt).toBeUndefined();
    await expect(cacheChip(page)).toHaveCount(0);
  });

  test('activates a custom OpenRouter model ID and sends it with the OpenRouter key', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'google', model: 'gemini-3.8-flash' }),
    );
    await gotoChat(page);

    await chooseModel(page, 'OpenRouter (custom ID)');
    const customInput = page.getByTestId('chat-custom-model-input');
    await expect(customInput).toBeVisible();
    await customInput.fill('vendor-x/custom-y');
    await page.getByTestId('chat-custom-model-apply').click();
    // Free-form OpenRouter has no thinking controls and no cache TTL.
    await expect(page.getByTestId('chat-thinking-select')).toHaveCount(0);

    const chatRequest = page.waitForRequest(
      (r) => r.url().includes('/api/llm-chat') && r.method() === 'POST',
    );
    await page.getByTestId('llm-chat-input').fill('Hello custom router');
    await page.getByTestId('llm-chat-send').click();
    const chatBody = (await chatRequest).postDataJSON() as Record<string, unknown>;
    expect(chatBody.provider).toBe('openrouter');
    expect(chatBody.model).toBe('vendor-x/custom-y');
    expect(chatBody.apiKey).toBe(OPENROUTER_KEY);
    expect(chatBody).not.toHaveProperty('thinking');

    await expect(page.locator('.chat-container')).toContainText('Mock AI reply');
    const userSave = apiMock.chatHistorySaves.find((b) => b.is_user === true);
    expect(userSave?.model).toEqual({ provider: 'openrouter', model: 'vendor-x/custom-y' });
  });

  test('keeps only user-key options when the capability lookup fails', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.serverKeyProviders = null;
    // Google and Anthropic have user keys; OpenRouter is server-key-only here.
    apiMock.seedProfile(SYNTHETIC_USER_A, {
      llm: {
        keys: { google: GOOGLE_KEY, anthropic: ANTHROPIC_KEY },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    });
    await gotoChat(page);

    await page.getByTestId('chat-model-select').click();
    await expect(page.getByRole('option', { name: /\(server key\)/ })).toHaveCount(0);
    await expect(
      page.getByRole('option', { name: 'OpenRouter (custom ID)', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('option', { name: 'Google — gemini-3.8-flash', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('Chat header responsive layout', () => {
  test('stacks title/nav above the selectors at 375x812 with no horizontal overflow, one row on desktop', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(
      SYNTHETIC_USER_A,
      llmPreferences({ provider: 'google', model: 'gemini-3.8-flash' }),
    );
    await gotoChat(page);

    // Desktop: the persistent sidebar replaces the conversation button and the
    // title shares one header row with the model/effort controls.
    await expect(page.getByTestId('chat-sidebar-pane')).toBeVisible();
    await expect(page.getByTestId('llm-chat-history')).toBeHidden();
    const desktopTitle = await page.locator('.chat-title').boundingBox();
    const desktopModel = await page.getByTestId('chat-model-select').boundingBox();
    const desktopEffort = await page.getByTestId('chat-thinking-select').boundingBox();
    expect(desktopTitle).not.toBeNull();
    expect(desktopModel).not.toBeNull();
    expect(desktopEffort).not.toBeNull();
    expect(desktopModel!.y).toBeLessThan(desktopTitle!.y + desktopTitle!.height);
    expect(desktopEffort!.y).toBeLessThan(desktopTitle!.y + desktopTitle!.height);

    // The mocked Playwright config only defines a Desktop Chrome project, so
    // the mobile viewport is exercised explicitly here.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('.chat-header--stacked')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // Row 1: conversation navigation and the title share the same vertical
    // band (mutual bounds overlap rules out nav wrapping onto its own row).
    await expect(page.getByTestId('llm-chat-history')).toBeVisible();
    await expect(page.locator('.chat-title')).toBeVisible();
    const navBox = await page.getByTestId('llm-chat-history').boundingBox();
    const titleBox = await page.locator('.chat-title').boundingBox();
    expect(navBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(navBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
    expect(titleBox!.y).toBeLessThan(navBox!.y + navBox!.height);

    // Row 2: the model and effort selectors share a second band below row 1
    // (mutual overlap rules out a third selector row).
    const modelBox = await page.getByTestId('chat-model-select').boundingBox();
    const effortBox = await page.getByTestId('chat-thinking-select').boundingBox();
    expect(modelBox).not.toBeNull();
    expect(effortBox).not.toBeNull();
    const rowOneBottom = Math.max(titleBox!.y + titleBox!.height, navBox!.y + navBox!.height);
    expect(modelBox!.y).toBeGreaterThanOrEqual(rowOneBottom);
    expect(effortBox!.y).toBeGreaterThanOrEqual(rowOneBottom);
    expect(effortBox!.y).toBeLessThan(modelBox!.y + modelBox!.height);
    expect(modelBox!.y).toBeLessThan(effortBox!.y + effortBox!.height);

    // Both selectors remain usable at 375px: pick a model, then an effort.
    await chooseModel(page, 'Anthropic — claude-opus-5-5');
    await expect(page.getByTestId('chat-model-select')).toHaveValue('Anthropic — claude-opus-5-5');
    await page.getByTestId('chat-thinking-select').click();
    await page.getByRole('option', { name: 'high', exact: true }).click();
    await expect(page.getByTestId('chat-thinking-select')).toHaveValue('high');

    // The composer stays visible inside the viewport.
    const composerBox = await page.getByTestId('llm-chat-input').boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(812);
    await expect(page.getByTestId('llm-chat-input')).toBeVisible();
  });
});

test.describe('Chat sidebar - mobile (375px)', () => {
  test.use({ viewport: MOBILE });

  test('exposes the sidebar through a left dialog alongside global nav', async ({
    authedPage: page,
    apiMock,
  }) => {
    apiMock.seedProfile(SYNTHETIC_USER_A);
    await gotoChat(page);
    await expect(page.getByTestId('chat-sidebar-pane')).toHaveCount(0);
    await expect(page.getByTestId('llm-chat-history')).toBeVisible();

    await expectGlobalNav(page, true);
    await page.getByTestId('btn-open-nav').click();
    await expect(page.getByTestId('left-drawer')).toBeVisible();
    await page.getByTestId('btn-open-nav').click();
    await expect(page.getByTestId('left-drawer')).toBeHidden();

    const sidebar = await openSidebar(page, true);
    await expect(sidebar.getByTestId('llm-chat-new')).toBeVisible();

    await sidebar.getByTestId('llm-chat-new').click();
    await expect(page.locator('.q-dialog .chat-sidebar-mobile')).toBeHidden();
    await expect(page.locator('.chat-container')).toContainText(GREETING_SNIPPET);
  });

  test('supports the full send/rename/reload/delete lifecycle', async ({
    authedPage: page,
    apiMock,
  }) => {
    await runConversationLifecycle(page, apiMock, true);
  });

  test('keeps page bounded with independent sidebar and message scrolling', async ({
    authedPage: page,
    apiMock,
  }) => {
    await runBoundedScrollCheck(page, apiMock, true);
  });
});
