import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../entrypoints/utils/idb', () => ({
  openDB: vi.fn().mockResolvedValue({
    transaction: vi.fn().mockReturnValue({
      objectStore: vi.fn().mockReturnValue({
        add: vi.fn().mockReturnValue({
          get onsuccess() {
            return null;
          },
          set onsuccess(cb: any) {
            cb();
          },
          get onerror() {
            return null;
          },
          set onerror(_: any) {},
        }),
      }),
    }),
  }),
  STORE_NAME: 'pending-sentences',
}));

vi.mock('../entrypoints/utils/storage', () => ({
  getValidIdToken: vi.fn(),
  refreshIdToken: vi.fn(),
}));

import {
  buildPendingSentenceRecord,
  requestPageScan,
  saveSentenceToAPI,
  shouldDiscardPendingRecord,
} from '../entrypoints/background';
import { getValidIdToken, refreshIdToken } from '../entrypoints/utils/storage';

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

describe('saveSentenceToAPI', () => {
  beforeEach(() => {
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(refreshIdToken).mockReset();
    global.fetch = vi.fn();
  });

  it('returns true when auth token is valid and API returns 200', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe(true);
    expect(getValidIdToken).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('returns false when getValidIdToken() throws (offline / no token)', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token available'));

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns false when fetch() throws (network error)', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch'),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe(false);
  });

  it('returns false when response is 401 and refreshIdToken() throws', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    vi.mocked(refreshIdToken).mockRejectedValue(new Error('Refresh failed'));

    const result = await saveSentenceToAPI('テスト文', 'https://example.com');

    expect(result).toBe(false);
    expect(refreshIdToken).toHaveBeenCalledOnce();
  });

  it('returns false when response is non-2xx (e.g. 500)', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe(false);
  });
});
