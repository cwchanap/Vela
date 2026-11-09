import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

const GREETING_SNIPPET = '日本語学習をお手伝いします';
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
  expect(bounds.docHeight).toBeLessThanOrEqual(bounds.innerHeight + 1);
  expect(bounds.scrollY).toBeLessThanOrEqual(1);

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
