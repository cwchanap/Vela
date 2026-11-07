import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { withQueryClient } from '../test-utils/withQueryClient';

vi.mock('aws-amplify/auth/enable-oauth-listener', () => ({}));
vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
vi.mock('aws-amplify/utils', () => ({
  Hub: { listen: vi.fn() },
}));
vi.mock('aws-amplify', () => ({
  Amplify: { configure: vi.fn() },
}));
vi.mock('../config', () => ({
  config: {
    cognito: {
      userPoolId: 'test-pool-id',
      userPoolClientId: 'test-client-id',
      region: 'us-east-1',
      oauth: {
        domain: 'test-domain.auth.us-east-1.amazoncognito.com',
        redirectSignIn: ['http://localhost:9000/auth/callback'],
        redirectSignOut: ['http://localhost:9000/auth/login'],
        responseType: 'code',
        providers: ['Google'],
      },
    },
    api: { url: '/api/' },
    app: { isDev: false },
  },
}));

const mockHttpJsonAuth = vi.fn();
vi.mock('src/utils/httpClient', () => ({
  httpJsonAuth: mockHttpJsonAuth,
  getAuthHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-id-token',
  })),
  httpJson: vi.fn(),
}));

const queryCache = new Map<
  string,
  { data: unknown; dataUpdatedAt: number; isInvalidated: boolean }
>();
const cacheKey = (key: unknown) => JSON.stringify(key);

const mockQueryClient = {
  getQueryState: vi.fn((key: unknown) => queryCache.get(cacheKey(key)) ?? null),
  getQueryData: vi.fn((key: unknown) => queryCache.get(cacheKey(key))?.data),
  setQueryData: vi.fn((key: unknown, data: unknown) => {
    queryCache.set(cacheKey(key), { data, dataUpdatedAt: Date.now(), isInvalidated: false });
  }),
  invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown }) => {
    const entry = queryCache.get(cacheKey(queryKey));
    if (entry) entry.isInvalidated = true;
  }),
  clear: vi.fn(() => {
    queryCache.clear();
  }),
};

vi.mock('../boot/query', () => ({
  queryClient: mockQueryClient,
  QUERY_STALE_TIME: 300000,
}));

vi.mock('../services/ttsService', () => ({
  clearAudioUrlCache: vi.fn(),
}));

const USER_ID = 'user-route-1';
const USER_EMAIL = 'route@example.com';

let serverPreferences: Record<string, unknown>;

const routeProfile = () => ({
  user_id: USER_ID,
  email: USER_EMAIL,
  username: 'routeuser',
  avatar_url: null,
  native_language: 'en',
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  preferences: { ...serverPreferences },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const installTransport = () => {
  mockHttpJsonAuth.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('profiles/create')) {
      return { success: true };
    }
    if (url.includes('profiles/update')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.user_id !== USER_ID) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      }
      if (body.preferences && typeof body.preferences === 'object') {
        serverPreferences = { ...(body.preferences as Record<string, unknown>) };
      }
      return { success: true };
    }
    if (url.includes('profiles?user_id=')) {
      return { profile: routeProfile() };
    }
    if (url.includes('llm-chat/capabilities')) {
      return { serverKeyProviders: ['google', 'openrouter'] };
    }
    throw new Error(`unmocked request: ${url}`);
  });
};

describe('route-shaped profile hydration (real authService)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    queryCache.clear();
    serverPreferences = { dailyGoal: 30 };
    installTransport();
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: USER_ID,
      signInDetails: { loginId: USER_EMAIL },
    } as never);
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: { toString: () => 'access-token' },
        idToken: { payload: {}, toString: () => 'id-token' },
      },
    } as never);
  });

  it('hydrates the authenticated user id and preferences from a route-shaped profile', async () => {
    const { useAuthStore } = await import('./auth');
    const authStore = useAuthStore();

    await authStore.initialize();
    await flushPromises();

    expect(authStore.isInitialized).toBe(true);
    expect(authStore.user?.id).toBe(USER_ID);
    expect(authStore.user?.email).toBe(USER_EMAIL);
    expect(authStore.user?.preferences?.dailyGoal).toBe(30);
  });

  it('saves LLM settings against the hydrated user after a route-shaped profile load', async () => {
    const { useAuthStore } = await import('./auth');
    const { useLLMSettingsStore } = await import('./llmSettings');
    const authStore = useAuthStore();
    const llmStore = useLLMSettingsStore();

    await authStore.initialize();
    await flushPromises();

    const ok = await llmStore.saveProvider('google', 'route-google-key');
    await flushPromises();

    expect(ok).toBe(true);
    const putCalls = mockHttpJsonAuth.mock.calls.filter(([input]) =>
      String(input).includes('profiles/update'),
    );
    expect(putCalls).toHaveLength(1);
    const body = JSON.parse(String(putCalls[0]![1]?.body)) as {
      user_id: string;
      preferences: { dailyGoal: number; llm: { keys: Record<string, string> } };
    };
    expect(body.user_id).toBe(USER_ID);
    expect(body.preferences.llm.keys.google).toBe('route-google-key');
    expect(body.preferences.dailyGoal).toBe(30);
    expect(llmStore.llm.keys.google).toBe('route-google-key');
  });

  it('enables capability discovery for the hydrated user', async () => {
    const { useAuthStore } = await import('./auth');
    const { useLlmCapabilitiesQuery } =
      await import('../composables/queries/useLlmCapabilitiesQuery');
    const authStore = useAuthStore();

    await authStore.initialize();
    await flushPromises();

    const { result, cleanup } = withQueryClient(() => useLlmCapabilitiesQuery());
    try {
      await vi.waitFor(() => {
        expect(result.data.value?.serverKeyProviders).toEqual(['google', 'openrouter']);
      });
    } finally {
      cleanup();
    }
  });
});
