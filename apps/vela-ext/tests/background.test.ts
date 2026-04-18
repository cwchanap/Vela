import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser global
const mockNotificationsCreate = vi.fn();
const mockTabsSendMessage = vi.fn();
const mockRuntimeGetURL = vi.fn((p: string) => `chrome-extension://abc123${p}`);

global.browser = {
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
    onFocusChanged: { addListener: vi.fn() },
  },
  storage: { local: { get: vi.fn(), set: vi.fn() } },
} as any;

// Import the pure utility functions from background (once implemented)
import { buildPendingSentenceRecord } from '../entrypoints/background';

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
