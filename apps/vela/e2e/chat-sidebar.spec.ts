import type { Locator, Page } from '@playwright/test';
import { test, expect, type MockApi } from './fixtures/syntheticAuth';
import { SYNTHETIC_USER_A } from './fixtures/syntheticEnv';
import { waitForPageLoad } from './utils/helpers';

/**
 * E2E coverage for the responsive chat-thread sidebar: thread list, rename,
 * delete, persistence across reloads, and bounded viewport scrolling.
 * All traffic is served by the stateful in-memory mock in syntheticAuth.ts.
 */

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

// The global navigation rail is permanent at desktop widths; at mobile widths
// it surfaces through the header hamburger which opens the same drawer.
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

  // The global navigation coexists with the chat navigation at every size.
  await expectGlobalNav(page, mobile);
  await expect(page.locator('.chat-container')).toContainText(GREETING_SNIPPET);

  // Sending a message persists a thread row derived from the message text.
  await sendAndWaitForThread(page, 'Hello sidebar thread');
  await expect(page.locator('.chat-container')).toContainText('Mock AI reply');

  const sidebar = await openSidebar(page, mobile);
  const rows = sidebar.getByTestId('llm-chat-thread-item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Hello sidebar thread');

  // Rename the row inline and wait for the PATCH to land.
  const patchResponse = page.waitForResponse(
    (r) => r.url().includes('/api/chat-history/thread/') && r.request().method() === 'PATCH',
  );
  await rows.first().getByTestId('chat-thread-menu').click();
  await page.getByTestId('chat-thread-rename').click();
  await page.getByTestId('chat-thread-rename-input').fill('Renamed sidebar chat');
  await page.getByTestId('chat-thread-rename-input').press('Enter');
  await patchResponse;
  await expect(rows.first()).toContainText('Renamed sidebar chat');

  // The rename survives a full reload because the mock is stateful per user.
  await page.reload();
  await waitForPageLoad(page);
  const sidebarAfterReload = await openSidebar(page, mobile);
  const rowsAfterReload = sidebarAfterReload.getByTestId('llm-chat-thread-item');
  await expect(rowsAfterReload).toHaveCount(1);
  await expect(rowsAfterReload.first()).toContainText('Renamed sidebar chat');

  // Selecting the thread restores its messages into the message pane.
  await rowsAfterReload.first().click();
  await expect(page.locator('.chat-container')).toContainText('Hello sidebar thread');
  await expect(page.locator('.chat-container')).toContainText('Mock AI reply');
  if (mobile) {
    await expect(page.locator('.q-dialog .chat-sidebar-mobile')).toBeHidden();
  }

  // Deleting the active thread removes the row and resets to the greeting.
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

  // The sidebar list scrolls independently of the page.
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

  // Selecting the newest thread loads a long conversation into the pane.
  await sidebar.getByTestId('llm-chat-thread-item').first().click();
  await expect(page.locator('.chat-container')).toContainText('Seeded message 39');

  const chatList = page.locator('.chat-container');
  const chatMetrics = await chatList.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(chatMetrics.scrollHeight).toBeGreaterThan(chatMetrics.clientHeight);

  // The composer stays fully visible inside the viewport.
  const composer = page.getByTestId('llm-chat-input');
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
    (mobile ? MOBILE : DESKTOP).height,
  );

  // Neither the document nor the window grows beyond the viewport.
  const bounds = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    docHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
  }));
  expect(bounds.docHeight).toBeLessThanOrEqual(bounds.innerHeight + 1);

  // Window scrolling cannot move the composer out of the viewport (at most a
  // sub-pixel rounding slack is allowed on the window itself).
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  const composerAfter = await page.getByTestId('llm-chat-input').boundingBox();
  expect(composerAfter).not.toBeNull();
  expect(composerAfter!.y + composerAfter!.height).toBeLessThanOrEqual(
    (mobile ? MOBILE : DESKTOP).height,
  );
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

    // The global navigation hamburger coexists with the chat navigation and
    // still opens the main drawer over the page content.
    await expectGlobalNav(page, true);
    await page.getByTestId('btn-open-nav').click();
    await expect(page.getByTestId('left-drawer')).toBeVisible();
    await page.getByTestId('btn-open-nav').click();
    await expect(page.getByTestId('left-drawer')).toBeHidden();

    const sidebar = await openSidebar(page, true);
    await expect(sidebar.getByTestId('llm-chat-new')).toBeVisible();

    // New chat from the dialog starts a fresh thread and closes it.
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
