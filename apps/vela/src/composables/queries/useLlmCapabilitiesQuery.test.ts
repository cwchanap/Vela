import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockCapabilities = vi.fn();

vi.mock('src/services/llm', () => ({
  llmClient: {
    capabilities: mockCapabilities,
  },
}));

const mockUser = ref<{ id: string } | null>(null);

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => ({
    user: mockUser,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => {
      return { user: store.user };
    },
  };
});

describe('useLlmCapabilitiesQuery', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = null;
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = undefined;
    }
  });

  it('is disabled and does not fetch when user is null', async () => {
    mockUser.value = null;
    const { useLlmCapabilitiesQuery } = await import('./useLlmCapabilitiesQuery');
    const { result, cleanup: qcCleanup } = withQueryClient(() => useLlmCapabilitiesQuery());
    cleanup = qcCleanup;
    await flushPromises();
    expect(result).toBeDefined();
    expect(mockCapabilities).not.toHaveBeenCalled();
  });

  it('fetches capabilities when user is set', async () => {
    mockUser.value = { id: 'user-123' };
    mockCapabilities.mockResolvedValue({ serverKeyProviders: ['google', 'openrouter'] });
    const { useLlmCapabilitiesQuery } = await import('./useLlmCapabilitiesQuery');
    const { result, cleanup: qcCleanup } = withQueryClient(() => useLlmCapabilitiesQuery());
    cleanup = qcCleanup;
    await flushPromises();
    expect(mockCapabilities).toHaveBeenCalled();
    expect(result.data.value).toEqual({ serverKeyProviders: ['google', 'openrouter'] });
  });

  it('leaves data undefined when the fetch fails instead of assuming availability', async () => {
    mockUser.value = { id: 'user-123' };
    mockCapabilities.mockRejectedValue(new Error('Unauthorized'));
    const { useLlmCapabilitiesQuery } = await import('./useLlmCapabilitiesQuery');
    const { result, cleanup: qcCleanup } = withQueryClient(() => useLlmCapabilitiesQuery());
    cleanup = qcCleanup;
    await flushPromises();
    expect(result.isError.value).toBe(true);
    expect(result.data.value).toBeUndefined();
  });
});
