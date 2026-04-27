import { vi } from 'vitest';

// Ensure crypto.randomUUID is available (happy-dom may not provide it)
if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    value: () =>
      `${'00000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))}-${'0000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))}-4${'000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))}-a${'000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))}-${'000000000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))}`,
    writable: true,
    configurable: true,
  });
}

// Stub WXT globals that are injected at runtime but not available in the test environment
vi.stubGlobal('defineContentScript', (config: { matches: string[]; main(): void }) => config);
vi.stubGlobal('defineBackground', (fn: () => void) => fn());
vi.stubGlobal('browser', {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake-id${path}`),
    id: 'fake-extension-id',
  },
  notifications: {
    create: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(async (key?: string | string[]) => {
        if (!key) return {};
        if (Array.isArray(key)) {
          return key.reduce<Record<string, unknown>>((acc, current) => {
            acc[current] = undefined;
            return acc;
          }, {});
        }
        return { [key]: undefined };
      }),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(),
    create: vi.fn(async () => ({ id: 1 })),
    update: vi.fn(async () => ({ id: 1 })),
    remove: vi.fn(async () => undefined),
  },
});
