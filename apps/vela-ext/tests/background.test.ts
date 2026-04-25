import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockNotificationsCreate, mockTabsSendMessage, mockRuntimeGetURL, mockIdbStore, idbState } =
  vi.hoisted(() => {
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

    /** Shared mutable state for the IDB mock — tests configure this per-case. */
    const idbState = {
      getAllResult: [] as any[],
    };

    /** Build a fake IDBRequest-like object that immediately fires onsuccess with a given value. */
    function makeSuccessRequest(result: any = undefined) {
      return {
        result,
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
      };
    }

    const mockIdbStore = {
      add: vi.fn(() => makeSuccessRequest()),
      getAll: vi.fn(() => makeSuccessRequest(idbState.getAllResult)),
      delete: vi.fn(() => makeSuccessRequest()),
      put: vi.fn(() => makeSuccessRequest()),
    };

    return {
      mockNotificationsCreate,
      mockTabsSendMessage,
      mockRuntimeGetURL,
      mockIdbStore,
      idbState,
    };
  });

vi.mock('../entrypoints/utils/idb', () => ({
  openDB: vi.fn().mockResolvedValue({
    transaction: vi.fn().mockReturnValue({
      objectStore: vi.fn().mockReturnValue(mockIdbStore),
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
  flushQueue,
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

describe('flushQueue', () => {
  beforeEach(() => {
    idbState.getAllResult = [];
    // Re-configure mocks to pick up fresh idbState.getAllResult at call time.
    // The initial vi.hoisted setup already does this correctly, but we reset here
    // to clear call counts from previous tests.
    mockIdbStore.getAll.mockReset();
    mockIdbStore.getAll.mockImplementation(function () {
      const result = idbState.getAllResult;
      const req = {
        result,
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
      };
      return req;
    });
    mockIdbStore.delete.mockReset();
    mockIdbStore.delete.mockImplementation(function () {
      const req = {
        result: undefined,
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
      };
      return req;
    });
    mockIdbStore.put.mockReset();
    mockIdbStore.put.mockImplementation(function () {
      const req = {
        result: undefined,
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
      };
      return req;
    });
    mockNotificationsCreate.mockReset();
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(refreshIdToken).mockReset();
    global.fetch = vi.fn();
  });

  it('does nothing when queue is empty', async () => {
    idbState.getAllResult = [];

    await flushQueue();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('deletes record on successful API call', async () => {
    idbState.getAllResult = [{ id: 1, sentence: 'テスト', retries: 0, timestamp: Date.now() }];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('discards record and notifies when at max retries (retries=2) and fetch fails', async () => {
    idbState.getAllResult = [{ id: 2, sentence: 'テスト', retries: 2, timestamp: Date.now() }];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await flushQueue();

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vela — Sync failed' }),
    );
    expect(mockIdbStore.delete).toHaveBeenCalledWith(2);
  });
});

describe('SAVE_SENTENCES message handler', () => {
  // The handler is registered when the module is first imported (defineBackground runs immediately).
  // Capture it from the first call to onMessage.addListener.
  function getSaveSentencesHandler(): (_message: unknown) => Promise<void> | undefined {
    const calls = vi.mocked(browser.runtime.onMessage.addListener).mock.calls;
    if (calls.length === 0) throw new Error('No onMessage listener was registered');
    return calls[0][0] as (_message: unknown) => Promise<void> | undefined;
  }

  beforeEach(() => {
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(refreshIdToken).mockReset();
    global.fetch = vi.fn();
  });

  it('returns undefined for non-matching message types', () => {
    const handler = getSaveSentencesHandler();
    const result = handler({ type: 'OTHER' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when sentences is not an array', () => {
    const handler = getSaveSentencesHandler();
    const result = handler({ type: 'SAVE_SENTENCES', sentences: 'not-array' });
    expect(result).toBeUndefined();
  });

  it('returns a Promise for a valid sentences array', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const handler = getSaveSentencesHandler();
    const result = handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('resolves with { saved, total } when all saves succeed', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 2, total: 2 });
  });

  it('resolves with partial results when some saves fail', async () => {
    vi.mocked(getValidIdToken).mockResolvedValueOnce('valid-token');
    vi.mocked(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 1, total: 2 });
  });

  it('resolves with { saved: 0, total } when all saves are queued (offline)', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token'));

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 0, total: 2 });
  });
});

describe('NO_JAPANESE_FOUND message handler', () => {
  function getOnMessageHandler(): (_message: unknown) => Promise<void> | undefined {
    const calls = vi.mocked(browser.runtime.onMessage.addListener).mock.calls;
    if (calls.length === 0) throw new Error('No onMessage listener was registered');
    return calls[0][0] as (_message: unknown) => Promise<void> | undefined;
  }

  beforeEach(() => {
    mockNotificationsCreate.mockClear();
  });

  it('shows notification when NO_JAPANESE_FOUND is received', () => {
    const handler = getOnMessageHandler();
    handler({ type: 'NO_JAPANESE_FOUND' });

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'basic',
        title: 'Vela — No sentences found',
        message: 'No Japanese sentences were detected on this page.',
      }),
    );
  });

  it('does not show notification for other message types', () => {
    const handler = getOnMessageHandler();
    handler({ type: 'SCAN_PAGE' });

    expect(mockNotificationsCreate).not.toHaveBeenCalled();
  });
});
