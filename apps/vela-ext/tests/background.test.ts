import { describe, it, expect, vi } from 'vitest';

const { mockNotificationsCreate, mockTabsSendMessage, mockRuntimeGetURL } = vi.hoisted(() => {
  const mockNotificationsCreate = vi.fn();
  const mockTabsSendMessage = vi.fn();
  const mockRuntimeGetURL = vi.fn((p: string) => `chrome-extension://abc123${p}`);

  (globalThis as any).browser = {
    runtime: {
      id: 'test-ext-id',
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      getURL: mockRuntimeGetURL,
      sendMessage: vi.fn(),
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    notifications: {
      create: mockNotificationsCreate,
    },
    tabs: {
      sendMessage: mockTabsSendMessage,
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener: vi.fn() },
    },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() } },
  };

  return { mockNotificationsCreate, mockTabsSendMessage, mockRuntimeGetURL };
});

import {
  buildPendingSentenceRecord,
  requestPageScan,
  shouldDiscardPendingRecord,
} from '../entrypoints/background';

describe('buildPendingSentenceRecord', () => {
  it('creates a record with retries: 0 and a timestamp', () => {
    const record = buildPendingSentenceRecord('テスト文', 'https://example.com', 'Example Page');
    expect(record.sentence).toBe('テスト文');
    expect(record.sourceUrl).toBe('https://example.com');
    expect(record.context).toBe('Example Page');
    expect(record.retries).toBe(0);
    expect(typeof record.timestamp).toBe('number');
  });

  it('allows missing sourceUrl and context', () => {
    const record = buildPendingSentenceRecord('テスト');
    expect(record.sourceUrl).toBeUndefined();
    expect(record.context).toBeUndefined();
  });
});

describe('shouldDiscardPendingRecord', () => {
  it('discards when the current failed attempt reaches the retry limit', () => {
    expect(shouldDiscardPendingRecord({ retries: 2 })).toBe(true);
  });

  it('keeps the record when retries remain after the current failed attempt', () => {
    expect(shouldDiscardPendingRecord({ retries: 1 })).toBe(false);
  });
});

describe('requestPageScan', () => {
  it('reports sendMessage failures instead of letting them reject silently', async () => {
    mockTabsSendMessage.mockRejectedValueOnce(new Error('No receiving end'));

    await requestPageScan(123);

    expect(mockTabsSendMessage).toHaveBeenCalledWith(123, { type: 'SCAN_PAGE' });
    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Vela - Error',
      }),
    );
    expect(mockRuntimeGetURL).toHaveBeenCalledWith('/icon/128.png');
  });
});
