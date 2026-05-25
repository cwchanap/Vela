import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  clearAllPending,
  openDB,
} from '../../entrypoints/utils/idb';

function makeSuccessRequest(result: any = undefined) {
  return {
    result,
    error: null,
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

describe('idb', () => {
  let mockObjectStoreNames: Set<string>;
  let mockCreateObjectStore: ReturnType<typeof vi.fn>;
  let mockStoreClear: ReturnType<typeof vi.fn>;
  let mockOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockObjectStoreNames = new Set();
    mockCreateObjectStore = vi.fn();
    mockStoreClear = vi.fn();
    mockOpen = vi.fn();

    const mockDB = {
      objectStoreNames: {
        contains: (name: string) => mockObjectStoreNames.has(name),
      },
      createObjectStore: mockCreateObjectStore,
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          clear: mockStoreClear,
        }),
      }),
    };

    mockOpen.mockImplementation((name: string, version: number) => {
      expect(name).toBe(DB_NAME);
      expect(version).toBe(DB_VERSION);

      const req = makeSuccessRequest(mockDB);

      const originalOnsuccess = req.onsuccess;
      Object.defineProperty(req, 'onupgradeneeded', {
        get() {
          return null;
        },
        set(cb: any) {
          queueMicrotask(() => {
            cb();
            originalOnsuccess;
          });
        },
        configurable: true,
      });

      return req;
    });

    (globalThis as any).indexedDB = { open: mockOpen };
  });

  describe('openDB', () => {
    it('opens database with correct name and version', async () => {
      await openDB();

      expect(mockOpen).toHaveBeenCalledWith(DB_NAME, DB_VERSION);
    });

    it('creates object store on upgrade when store does not exist', async () => {
      const mockDB: any = {
        objectStoreNames: {
          contains: (name: string) => mockObjectStoreNames.has(name),
        },
        createObjectStore: mockCreateObjectStore,
        transaction: vi.fn(),
      };

      mockOpen.mockImplementationOnce(() => {
        const req: any = {
          result: mockDB,
          error: null,
          onupgradeneeded: null as any,
          onsuccess: null as any,
          onerror: null as any,
        };

        Object.defineProperty(req, 'onupgradeneeded', {
          get() {
            return null;
          },
          set(cb: any) {
            queueMicrotask(() => cb());
          },
          configurable: true,
        });
        Object.defineProperty(req, 'onsuccess', {
          get() {
            return null;
          },
          set(cb: any) {
            queueMicrotask(() => cb());
          },
          configurable: true,
        });
        Object.defineProperty(req, 'onerror', {
          get() {
            return null;
          },
          set() {},
          configurable: true,
        });

        return req;
      });

      await openDB();

      expect(mockCreateObjectStore).toHaveBeenCalledWith(STORE_NAME, {
        autoIncrement: true,
        keyPath: 'id',
      });
    });

    it('skips creating object store when it already exists', async () => {
      mockObjectStoreNames.add(STORE_NAME);

      const mockDB: any = {
        objectStoreNames: {
          contains: (name: string) => mockObjectStoreNames.has(name),
        },
        createObjectStore: mockCreateObjectStore,
        transaction: vi.fn(),
      };

      mockOpen.mockImplementationOnce(() => {
        const req: any = {
          result: mockDB,
          error: null,
          onupgradeneeded: null as any,
          onsuccess: null as any,
          onerror: null as any,
        };

        Object.defineProperty(req, 'onupgradeneeded', {
          get() {
            return null;
          },
          set(cb: any) {
            queueMicrotask(() => cb());
          },
          configurable: true,
        });
        Object.defineProperty(req, 'onsuccess', {
          get() {
            return null;
          },
          set(cb: any) {
            queueMicrotask(() => cb());
          },
          configurable: true,
        });
        Object.defineProperty(req, 'onerror', {
          get() {
            return null;
          },
          set() {},
          configurable: true,
        });

        return req;
      });

      await openDB();

      expect(mockCreateObjectStore).not.toHaveBeenCalled();
    });

    it('rejects when indexedDB.open fails', async () => {
      const error = new Error('IndexedDB blocked');
      mockOpen.mockImplementationOnce(() => makeErrorRequest(error));

      await expect(openDB()).rejects.toThrow('IndexedDB blocked');
    });
  });

  describe('clearAllPending', () => {
    it('clears the object store', async () => {
      mockStoreClear.mockReturnValueOnce(makeSuccessRequest());

      await clearAllPending();

      expect(mockStoreClear).toHaveBeenCalledOnce();
    });

    it('rejects when clear request fails', async () => {
      const error = new Error('Clear failed');
      mockStoreClear.mockReturnValueOnce(makeErrorRequest(error));

      await expect(clearAllPending()).rejects.toThrow('Clear failed');
    });
  });
});
