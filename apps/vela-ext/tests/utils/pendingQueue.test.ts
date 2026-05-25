import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpenDB } = vi.hoisted(() => {
  const mockOpenDB = vi.fn();
  return { mockOpenDB };
});

vi.mock('../../entrypoints/utils/idb', () => ({
  openDB: mockOpenDB,
  STORE_NAME: 'vela-pending-sentences',
  DB_NAME: 'vela-offline-queue',
  DB_VERSION: 1,
}));

import { getPendingQueueCount } from '../../entrypoints/utils/pendingQueue';

function makeSuccessRequest(result: any = undefined) {
  return {
    result,
    get onsuccess() {
      return null;
    },
    set onsuccess(cb: any) {
      queueMicrotask(() => cb());
    },
    get onerror() {
      return null;
    },
    set onerror(_: any) {},
  };
}

function makeErrorRequest(error: Error) {
  return {
    result: undefined,
    error,
    get onsuccess() {
      return null;
    },
    set onsuccess(_: any) {},
    get onerror() {
      return null;
    },
    set onerror(cb: any) {
      queueMicrotask(() => cb());
    },
  };
}

describe('getPendingQueueCount', () => {
  let mockStoreCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStoreCount = vi.fn();
    mockOpenDB.mockResolvedValue({
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          count: mockStoreCount,
        }),
      }),
    });
  });

  it('returns count from store', async () => {
    mockStoreCount.mockReturnValueOnce(makeSuccessRequest(42));

    const count = await getPendingQueueCount();

    expect(count).toBe(42);
  });

  it('returns 0 when IndexedDB fails (openDB throws)', async () => {
    mockOpenDB.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    const count = await getPendingQueueCount();

    expect(count).toBe(0);
  });

  it('returns 0 when count request fails', async () => {
    mockStoreCount.mockReturnValueOnce(makeErrorRequest(new Error('Count failed')));

    const count = await getPendingQueueCount();

    expect(count).toBe(0);
  });
});
