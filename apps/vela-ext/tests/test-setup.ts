import { vi } from 'vitest';

// Stub WXT globals that are injected at runtime but not available in the test environment
vi.stubGlobal('defineContentScript', (config: { matches: string[]; main(): void }) => config);
vi.stubGlobal('defineBackground', (fn: () => void) => fn);
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
});
