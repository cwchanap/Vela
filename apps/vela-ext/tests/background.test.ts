import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockContextMenusCreate,
  mockContextMenusRemoveAll,
  mockNotificationsCreate,
  mockTabsSendMessage,
  mockRuntimeGetURL,
  mockIdbStore,
  idbState,
} = vi.hoisted(() => {
  const mockContextMenusCreate = vi.fn().mockResolvedValue(undefined);
  const mockContextMenusRemoveAll = vi.fn().mockResolvedValue(undefined);
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
      create: mockContextMenusCreate,
      removeAll: mockContextMenusRemoveAll,
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
    mockContextMenusCreate,
    mockContextMenusRemoveAll,
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
  clearAllPending: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../entrypoints/utils/storage', () => ({
  getValidIdToken: vi.fn(),
  refreshIdToken: vi.fn(),
  getUserEmail: vi.fn().mockResolvedValue(null),
}));

import {
  buildPendingSentenceRecord,
  flushQueue,
  registerContextMenus,
  requestPageScan,
  saveSentenceToAPI,
  shouldDiscardPendingRecord,
} from '../entrypoints/background';
import { getValidIdToken, refreshIdToken, getUserEmail } from '../entrypoints/utils/storage';

describe('registerContextMenus', () => {
  beforeEach(() => {
    mockContextMenusCreate.mockClear();
    mockContextMenusRemoveAll.mockClear();
  });

  it('recreates context menus when the background script starts', async () => {
    await registerContextMenus();

    expect(mockContextMenusRemoveAll).toHaveBeenCalledOnce();
    expect(mockContextMenusCreate).toHaveBeenCalledWith({
      id: 'add-vocab-to-vela',
      title: 'Add vocab to Vela',
      contexts: ['selection'],
    });
    expect(mockContextMenusCreate).toHaveBeenCalledWith({
      id: 'scan-page-vela',
      title: 'Scan page for Japanese',
      contexts: ['page'],
    });
  });

  it('deduplicates concurrent calls — removeAll called only once', async () => {
    await Promise.all([registerContextMenus(), registerContextMenus()]);

    expect(mockContextMenusRemoveAll).toHaveBeenCalledOnce();
    expect(mockContextMenusCreate).toHaveBeenCalledTimes(2);
  });
});

describe('buildPendingSentenceRecord', () => {
  it('creates a record with retries: 0, a timestamp, and an idempotencyKey', () => {
    const record = buildPendingSentenceRecord(
      'テスト文',
      'https://example.com',
      'Example Page',
      'user@test.com',
    );
    expect(record.sentence).toBe('テスト文');
    expect(record.sourceUrl).toBe('https://example.com');
    expect(record.context).toBe('Example Page');
    expect(record.userEmail).toBe('user@test.com');
    expect(record.retries).toBe(0);
    expect(typeof record.timestamp).toBe('number');
    expect(record.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('allows missing sourceUrl, context, and userEmail', () => {
    const record = buildPendingSentenceRecord('テスト');
    expect(record.sourceUrl).toBeUndefined();
    expect(record.context).toBeUndefined();
    expect(record.userEmail).toBeUndefined();
    expect(record.idempotencyKey).toBeDefined();
  });
});

describe('shouldDiscardPendingRecord', () => {
  it('discards when at max retries AND the failure is a permanent client error (4xx)', () => {
    expect(shouldDiscardPendingRecord({ retries: 2 }, 400)).toBe(true);
    expect(shouldDiscardPendingRecord({ retries: 2 }, 404)).toBe(true);
    expect(shouldDiscardPendingRecord({ retries: 2 }, 422)).toBe(true);
  });

  it('keeps the record when retries remain even on permanent client errors', () => {
    expect(shouldDiscardPendingRecord({ retries: 1 }, 400)).toBe(false);
    expect(shouldDiscardPendingRecord({ retries: 0 }, 404)).toBe(false);
  });

  it('never discards on transient server errors (5xx)', () => {
    expect(shouldDiscardPendingRecord({ retries: 2 }, 500)).toBe(false);
    expect(shouldDiscardPendingRecord({ retries: 2 }, 502)).toBe(false);
    expect(shouldDiscardPendingRecord({ retries: 2 }, 503)).toBe(false);
    expect(shouldDiscardPendingRecord({ retries: 100 }, 500)).toBe(false);
  });

  it('never discards on network errors (no status)', () => {
    expect(shouldDiscardPendingRecord({ retries: 2 })).toBe(false);
    expect(shouldDiscardPendingRecord({ retries: 100 })).toBe(false);
  });

  it('never discards on 429 (rate-limit, transient)', () => {
    expect(shouldDiscardPendingRecord({ retries: 2 }, 429)).toBe(false);
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
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    mockIdbStore.add.mockClear();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('returns "saved" when auth token is valid and API returns 200', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe('saved');
    expect(getValidIdToken).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('returns "queued" when getValidIdToken() throws (offline / no token)', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token available'));

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe('queued');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns "dropped" without queuing when getValidIdToken() throws and no user email', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token available'));
    vi.mocked(getUserEmail).mockResolvedValue(null);

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe('dropped');
    expect(global.fetch).not.toHaveBeenCalled();
    // Should NOT have queued — no user identity available
    expect(mockIdbStore.add).not.toHaveBeenCalled();
  });

  it('queues with userEmail when getValidIdToken() throws but email is known', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token available'));
    vi.mocked(getUserEmail).mockResolvedValue('known@test.com');

    const result = await saveSentenceToAPI('テスト文', 'https://example.com', 'Test Page');

    expect(result).toBe('queued');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockIdbStore.add).toHaveBeenCalled();
  });

  it('returns "queued" when fetch() throws (network error)', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch'),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe('queued');
  });

  it('returns "dropped" when fetch() throws and no user email', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(getUserEmail).mockResolvedValue(null);
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch'),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe('dropped');
    expect(mockIdbStore.add).not.toHaveBeenCalled();
  });

  it('returns "queued" when response is 401 and refreshIdToken() throws', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    vi.mocked(refreshIdToken).mockRejectedValue(new Error('Refresh failed'));

    const result = await saveSentenceToAPI('テスト文', 'https://example.com');

    expect(result).toBe('queued');
    expect(refreshIdToken).toHaveBeenCalledOnce();
  });

  it('returns "dropped" when 401, refreshIdToken() throws, and no user email', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(getUserEmail).mockResolvedValue(null);
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    vi.mocked(refreshIdToken).mockRejectedValue(new Error('Refresh failed'));

    const result = await saveSentenceToAPI('テスト文', 'https://example.com');

    expect(result).toBe('dropped');
    expect(mockIdbStore.add).not.toHaveBeenCalled();
  });

  it('returns "queued" when response is non-2xx (e.g. 500)', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe('queued');
  });

  it('returns "dropped" when response is non-2xx and no user email', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(getUserEmail).mockResolvedValue(null);
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const result = await saveSentenceToAPI('テスト文');

    expect(result).toBe('dropped');
    expect(mockIdbStore.add).not.toHaveBeenCalled();
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
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('does nothing when queue is empty', async () => {
    idbState.getAllResult = [];

    await flushQueue();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('deletes record on successful API call', async () => {
    idbState.getAllResult = [
      { id: 1, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-1' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('increments retry on 5xx (transient) even at max retries — never auto-discards', async () => {
    idbState.getAllResult = [
      { id: 2, sentence: 'テスト', retries: 2, timestamp: Date.now(), idempotencyKey: 'key-2' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await flushQueue();

    // Transient 5xx should NOT discard — increment retry instead
    expect(mockIdbStore.delete).not.toHaveBeenCalled();
    expect(mockIdbStore.put).toHaveBeenCalled();
  });

  it('discards and notifies on permanent client error (4xx) at max retries', async () => {
    idbState.getAllResult = [
      { id: 3, sentence: 'テスト', retries: 2, timestamp: Date.now(), idempotencyKey: 'key-3' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    await flushQueue();

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vela — Sync failed' }),
    );
    expect(mockIdbStore.delete).toHaveBeenCalledWith(3);
  });

  it('increments retry on 4xx when retries remain', async () => {
    idbState.getAllResult = [
      { id: 4, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-4' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    await flushQueue();

    expect(mockIdbStore.delete).not.toHaveBeenCalled();
    expect(mockIdbStore.put).toHaveBeenCalled();
  });

  it('increments retry on network error (fetch throws) without discarding', async () => {
    idbState.getAllResult = [
      { id: 5, sentence: 'テスト', retries: 2, timestamp: Date.now(), idempotencyKey: 'key-5' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch'),
    );

    await flushQueue();

    // Network errors are transient — never auto-discard
    expect(mockIdbStore.delete).not.toHaveBeenCalled();
    expect(mockIdbStore.put).toHaveBeenCalled();
  });

  it('skips re-entrant flush calls while a flush is already in progress', async () => {
    let resolveFetch: (() => void) | undefined;
    idbState.getAllResult = [
      { id: 1, sentence: 'テスト1', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-3' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response(null, { status: 200 }));
        }),
    );

    // Start first flush (will hang at fetch until we resolve it)
    const firstFlush = flushQueue();
    // Give microtasks a chance to run so first flush enters the for-loop
    await new Promise((r) => setTimeout(r, 0));

    // Second flush should return immediately without calling fetch again
    await flushQueue();

    // Resolve the hanging fetch so the first flush can complete
    resolveFetch?.();
    await firstFlush;

    // fetch was called only once — the re-entrant call was skipped
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('deletes and skips records queued by a different user', async () => {
    idbState.getAllResult = [
      {
        id: 1,
        sentence: 'テスト',
        retries: 0,
        timestamp: Date.now(),
        userEmail: 'other@test.com',
        idempotencyKey: 'key-4',
      },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(getUserEmail).mockResolvedValue('current@test.com');

    await flushQueue();

    // Should NOT attempt to POST — record is discarded instead
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('processes records with no userEmail (backward compat)', async () => {
    idbState.getAllResult = [
      { id: 1, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-5' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('processes records when userEmail matches current user', async () => {
    idbState.getAllResult = [
      {
        id: 1,
        sentence: 'テスト',
        retries: 0,
        timestamp: Date.now(),
        userEmail: 'user@test.com',
        idempotencyKey: 'key-6',
      },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(getUserEmail).mockResolvedValue('user@test.com');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('refreshes token and retries on 401, then deletes on success', async () => {
    idbState.getAllResult = [
      { id: 10, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-r1' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(refreshIdToken).mockResolvedValue('refreshed-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await flushQueue();

    expect(refreshIdToken).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockIdbStore.delete).toHaveBeenCalledWith(10);
  });

  it('refreshes token and retries on 401, then increments retry on second failure', async () => {
    idbState.getAllResult = [
      { id: 11, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-r2' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(refreshIdToken).mockResolvedValue('refreshed-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await flushQueue();

    expect(refreshIdToken).toHaveBeenCalledOnce();
    expect(mockIdbStore.put).toHaveBeenCalled();
    expect(mockIdbStore.delete).not.toHaveBeenCalled();
  });

  it('returns early when getValidIdToken throws in flushQueue', async () => {
    idbState.getAllResult = [
      { id: 12, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-r3' },
    ];
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token'));

    await flushQueue();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockIdbStore.delete).not.toHaveBeenCalled();
    expect(mockIdbStore.put).not.toHaveBeenCalled();
  });

  it('returns early when refreshIdToken throws on 401 in flushQueue', async () => {
    idbState.getAllResult = [
      { id: 13, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-r4' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('expired-token');
    vi.mocked(refreshIdToken).mockRejectedValue(new Error('Refresh failed'));
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await flushQueue();

    expect(refreshIdToken).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).not.toHaveBeenCalled();
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
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    global.fetch = vi.fn() as unknown as typeof fetch;
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
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const handler = getSaveSentencesHandler();
    const result = handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('resolves with { saved, dropped, total } when all saves succeed', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 2, dropped: 0, total: 2 });
  });

  it('resolves with partial results when some saves fail', async () => {
    vi.mocked(getValidIdToken).mockResolvedValueOnce('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 1, dropped: 0, total: 2 });
  });

  it('resolves with { saved: 0, dropped: 0, total } when all saves are queued (offline)', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token'));

    const handler = getSaveSentencesHandler();
    const result = await handler({ type: 'SAVE_SENTENCES', sentences: ['テスト1', 'テスト2'] });

    expect(result).toEqual({ saved: 0, dropped: 0, total: 2 });
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

describe('LOGIN_SUCCESS message handler', () => {
  function getOnMessageHandler(): (_message: unknown) => Promise<void> | undefined {
    const calls = vi.mocked(browser.runtime.onMessage.addListener).mock.calls;
    if (calls.length === 0) throw new Error('No onMessage listener was registered');
    return calls[0][0] as (_message: unknown) => Promise<void> | undefined;
  }

  beforeEach(() => {
    mockNotificationsCreate.mockClear();
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
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('triggers flushQueue when LOGIN_SUCCESS is received', async () => {
    idbState.getAllResult = [
      { id: 1, sentence: 'テスト', retries: 0, timestamp: Date.now(), idempotencyKey: 'key-1' },
    ];
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const handler = getOnMessageHandler();
    const result = handler({ type: 'LOGIN_SUCCESS' });

    // LOGIN_SUCCESS is fire-and-forget — handler returns undefined
    expect(result).toBeUndefined();

    // Wait for the async flushQueue to complete
    await new Promise((r) => setTimeout(r, 10));

    // flushQueue should have processed the pending record
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(mockIdbStore.delete).toHaveBeenCalledWith(1);
  });

  it('does nothing when queue is empty and LOGIN_SUCCESS is received', async () => {
    idbState.getAllResult = [];

    const handler = getOnMessageHandler();
    const result = handler({ type: 'LOGIN_SUCCESS' });

    expect(result).toBeUndefined();
    await new Promise((r) => setTimeout(r, 10));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('context menu onClicked handler', () => {
  function getOnClickedListener(): (_info: any, _tab: any) => Promise<void> {
    const calls = vi.mocked(browser.contextMenus.onClicked.addListener).mock.calls;
    if (calls.length === 0) throw new Error('No onClicked listener registered');
    return calls[0][0] as (_info: any, _tab: any) => Promise<void>;
  }

  beforeEach(() => {
    mockNotificationsCreate.mockClear();
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(refreshIdToken).mockReset();
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('shows "Entry Saved" notification on successful save', async () => {
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const listener = getOnClickedListener();
    await listener(
      { menuItemId: 'add-vocab-to-vela', selectionText: '日本語を勉強します。' },
      { id: 1, url: 'https://example.com', title: 'Example' },
    );

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vela - Entry Saved' }),
    );
  });

  it('shows "Entry Queued" notification when save is queued', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token'));

    const listener = getOnClickedListener();
    await listener(
      { menuItemId: 'add-vocab-to-vela', selectionText: '日本語を勉強します。' },
      { id: 1, url: 'https://example.com', title: 'Example' },
    );

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vela - Entry Queued' }),
    );
  });

  it('shows "Save Failed" notification when save is dropped', async () => {
    vi.mocked(getValidIdToken).mockRejectedValue(new Error('No token'));
    vi.mocked(getUserEmail).mockResolvedValue(null);

    const listener = getOnClickedListener();
    await listener(
      { menuItemId: 'add-vocab-to-vela', selectionText: '日本語を勉強します。' },
      { id: 1, url: 'https://example.com', title: 'Example' },
    );

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Vela - Save Failed' }),
    );
  });

  it('truncates long sentences in notification messages', async () => {
    const longText = 'あ'.repeat(60);
    vi.mocked(getValidIdToken).mockResolvedValue('valid-token');
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const listener = getOnClickedListener();
    await listener(
      { menuItemId: 'add-vocab-to-vela', selectionText: longText },
      { id: 1, url: 'https://example.com', title: 'Example' },
    );

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('...'),
      }),
    );
  });

  it('does nothing when selection is empty after trimming', async () => {
    const listener = getOnClickedListener();
    await listener(
      { menuItemId: 'add-vocab-to-vela', selectionText: '   ' },
      { id: 1, url: 'https://example.com', title: 'Example' },
    );

    expect(mockNotificationsCreate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('startup and focus listeners', () => {
  beforeEach(() => {
    idbState.getAllResult = [];
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
    vi.mocked(getValidIdToken).mockReset();
    vi.mocked(getUserEmail).mockReset().mockResolvedValue('user@test.com');
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('registers onStartup listener that calls flushQueue', () => {
    const calls = vi.mocked(browser.runtime.onStartup.addListener).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(typeof calls[0][0]).toBe('function');
  });

  it('onStartup listener invokes flushQueue', async () => {
    idbState.getAllResult = [];
    const calls = vi.mocked(browser.runtime.onStartup.addListener).mock.calls;
    const onStartup = calls[0][0] as () => void;
    onStartup();
    await new Promise((r) => setTimeout(r, 10));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('onFocusChanged listener invokes flushQueue when windowId is not WINDOW_ID_NONE', async () => {
    idbState.getAllResult = [];
    const calls = vi.mocked(browser.windows.onFocusChanged.addListener).mock.calls;
    const onFocusChanged = calls[0][0] as (_windowId: number) => void;
    onFocusChanged(1);
    await new Promise((r) => setTimeout(r, 10));
  });

  it('onFocusChanged listener skips flushQueue when windowId is WINDOW_ID_NONE', async () => {
    const calls = vi.mocked(browser.windows.onFocusChanged.addListener).mock.calls;
    const onFocusChanged = calls[0][0] as (_windowId: number) => void;
    onFocusChanged(-1);
    await new Promise((r) => setTimeout(r, 10));
  });

  it('online event listener invokes flushQueue', async () => {
    idbState.getAllResult = [];
    const onlineListeners = (self as any).__onlineListeners as Array<() => void>;
    if (onlineListeners && onlineListeners.length > 0) {
      onlineListeners[0]();
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});
