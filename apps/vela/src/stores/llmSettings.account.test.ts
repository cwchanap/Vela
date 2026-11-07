import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';
import type { LlmPreferences, Profile, UserPreferences } from '../types/shared';
import type { User } from './auth';
import type { AppSession, AuthResponse, ProfileData } from '../services/authService';

const GOOGLE_DEFAULT = LLM_PROVIDER_REGISTRY.google.defaultModel;

const pendingWrites: {
  userId: string;
  data: ProfileData;
  resolve: (_v: AuthResponse) => void;
  reject: (_e: unknown) => void;
}[] = [];

const serverProfiles = new Map<string, Profile>();

const mockAuthService = {
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getUserProfile: vi.fn((userId: string) => Promise.resolve(serverProfiles.get(userId) ?? null)),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn((userId: string, profileData: ProfileData) => {
    let resolve!: (_v: AuthResponse) => void;
    let reject!: (_e: unknown) => void;
    const promise = new Promise<AuthResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pendingWrites.push({ userId, data: profileData, resolve, reject });
    return promise;
  }),
};

vi.mock('../services/authService', () => ({
  authService: mockAuthService,
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

const makeLlm = (overrides: Partial<LlmPreferences> = {}): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
  ...overrides,
});

const makeUser = (id: string, llm?: LlmPreferences): User => ({
  id,
  email: `${id}@example.com`,
  username: id,
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  native_language: 'en',
  preferences: (llm ? { llm } : {}) as UserPreferences,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
});

const makeSession = (id: string): AppSession => ({
  user: { id, email: `${id}@example.com` },
  provider: 'cognito',
});

const makeProfile = (user: User): Profile => ({
  id: user.id,
  username: user.username ?? null,
  email: user.email ?? null,
  avatar_url: null,
  native_language: user.native_language,
  current_level: user.current_level,
  total_experience: user.total_experience,
  learning_streak: user.learning_streak,
  last_activity: null,
  preferences: user.preferences,
  created_at: user.created_at,
  updated_at: user.updated_at,
});

const applyWrite = (index: number) => {
  const write = pendingWrites[index]!;
  const existing = serverProfiles.get(write.userId);
  if (existing) {
    Object.assign(existing, write.data);
  }
  write.resolve({ success: true });
};

describe('llmSettings + auth account transitions (real stores)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    pendingWrites.length = 0;
    serverProfiles.clear();
    queryCache.clear();
  });

  const stores = async () => {
    const { useAuthStore } = await import('./auth');
    const { useLLMSettingsStore } = await import('./llmSettings');
    const authStore = useAuthStore();
    const llmStore = useLLMSettingsStore();
    return { authStore, llmStore };
  };

  const signIn = async (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
    id: string,
    llm?: LlmPreferences,
  ) => {
    const user = makeUser(id, llm);
    serverProfiles.set(id, makeProfile(user));
    authStore.setSession(makeSession(id));
    authStore.setUser(user);
    await flushPromises();
  };

  it('does not commit an in-flight save to a different account after an account switch', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const pending = llmStore.saveProvider('google', 'a-secret-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    expect(pendingWrites[0]!.userId).toBe('user-a');

    await signIn(authStore, 'user-b');
    applyWrite(0);

    const result = await pending;
    await flushPromises();

    expect(result).toBe(false);
    expect(authStore.user?.id).toBe('user-b');
    const bLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(bLlm?.keys.google).toBeUndefined();
    expect(llmStore.llm.keys.google).toBeUndefined();
    expect(llmStore.llm.keys).toEqual({});
  });

  it('does not commit an in-flight save after sign-out', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const pending = llmStore.saveProvider('google', 'a-secret-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    authStore.setSession(null);
    authStore.setUser(null);
    await flushPromises();

    applyWrite(0);
    const result = await pending;
    await flushPromises();

    expect(result).toBe(false);
    expect(authStore.user).toBeNull();
    expect(authStore.error).toBeNull();
    expect(llmStore.llm.keys).toEqual({});
  });

  it('does not let a save queued under user A write into user B', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const first = llmStore.saveProvider('google', 'a-google-key');
    const second = llmStore.saveProvider('openai', 'a-openai-key');
    await flushPromises();
    expect(pendingWrites.length).toBeGreaterThan(0);

    await signIn(authStore, 'user-b');
    applyWrite(0);
    if (pendingWrites[1]) applyWrite(1);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flushPromises();

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(false);
    expect(authStore.user?.id).toBe('user-b');
    const bLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(bLlm?.keys.google).toBeUndefined();
    expect(bLlm?.keys.openai).toBeUndefined();
    expect(llmStore.llm.keys).toEqual({});
    for (const write of pendingWrites.slice(1)) {
      expect(write.userId).not.toBe('user-b');
    }
  });

  it('merges overlapping provider saves so neither key is lost', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const first = llmStore.saveProvider('google', 'google-key');
    const second = llmStore.saveProvider('openai', 'openai-key');
    await flushPromises();

    while (pendingWrites.length) {
      applyWrite(0);
      pendingWrites.splice(0, 1);
      await flushPromises();
    }
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flushPromises();

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(llmStore.llm.keys).toEqual({ google: 'google-key', openai: 'openai-key' });
    const aLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(aLlm?.keys).toEqual({ google: 'google-key', openai: 'openai-key' });
  });

  it('merges a provider save and a default save so both changes persist', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const first = llmStore.saveProvider('google', 'google-key');
    const second = llmStore.saveDefault({ provider: 'openai', model: 'gpt-6-luna' });
    await flushPromises();

    while (pendingWrites.length) {
      applyWrite(0);
      pendingWrites.splice(0, 1);
      await flushPromises();
    }
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flushPromises();

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(llmStore.llm.keys.google).toBe('google-key');
    expect(llmStore.llm.defaultModel).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
    const aLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(aLlm?.keys.google).toBe('google-key');
    expect(aLlm?.defaultModel).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
  });

  it('still completes a normal save when the account stays the same', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a', makeLlm({ keys: { anthropic: 'keep' } }));

    const pending = llmStore.saveProvider('google', 'google-key', {
      'gemini-3.8-flash': 'high',
    });
    await flushPromises();
    while (pendingWrites.length) {
      applyWrite(0);
      pendingWrites.splice(0, 1);
      await flushPromises();
    }
    const result = await pending;
    await flushPromises();

    expect(result).toBe(true);
    expect(llmStore.llm.keys).toEqual({ anthropic: 'keep', google: 'google-key' });
    expect(llmStore.llm.thinking['gemini-3.8-flash']).toBe('high');
  });

  it('does not commit an in-flight save after sign-out and same-account re-authentication', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const pending = llmStore.saveProvider('google', 'a-secret-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    expect(pendingWrites[0]!.userId).toBe('user-a');

    authStore.setSession(null);
    authStore.setUser(null);
    await flushPromises();
    await signIn(authStore, 'user-a', makeLlm({ keys: { anthropic: 'fresh-key' } }));

    applyWrite(0);
    const result = await pending;
    await flushPromises();

    expect(result).toBe(false);
    expect(authStore.user?.id).toBe('user-a');
    const aLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(aLlm?.keys.google).toBeUndefined();
    expect(llmStore.llm.keys).toEqual({ anthropic: 'fresh-key' });
  });

  it('does not let a save queued under a previous session issue a write after same-account re-authentication', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const first = llmStore.saveProvider('google', 'old-google-key');
    const second = llmStore.saveProvider('openai', 'old-openai-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    authStore.setSession(null);
    authStore.setUser(null);
    await flushPromises();
    await signIn(authStore, 'user-a', makeLlm());

    applyWrite(0);
    await flushPromises();
    if (pendingWrites[1]) applyWrite(1);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flushPromises();

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(false);
    expect(pendingWrites).toHaveLength(1);
    expect(llmStore.llm.keys).toEqual({});
  });

  it('does not hydrate a stale profile response into a new same-account session', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a', makeLlm({ keys: { google: 'stale-key' } }));

    let resolveGet!: (_v: Profile | null) => void;
    mockAuthService.getUserProfile.mockImplementationOnce(
      () =>
        new Promise<Profile | null>((res) => {
          resolveGet = res;
        }),
    );
    const pending = authStore.loadUserProfile('user-a');

    authStore.setSession(null);
    authStore.setUser(null);
    await flushPromises();
    await signIn(authStore, 'user-a', makeLlm({ keys: { openai: 'fresh-key' } }));

    resolveGet(makeProfile(makeUser('user-a', makeLlm({ keys: { google: 'stale-key' } }))));
    await pending;
    await flushPromises();

    const aLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(aLlm?.keys).toEqual({ openai: 'fresh-key' });
    expect(llmStore.llm.keys).toEqual({ openai: 'fresh-key' });
  });

  it('does not repopulate the profile cache from a stale response that later hydrates a new session', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a', makeLlm({ keys: { google: 'stale-key' } }));

    let resolveGet!: (_v: Profile | null) => void;
    mockAuthService.getUserProfile.mockImplementationOnce(
      () =>
        new Promise<Profile | null>((res) => {
          resolveGet = res;
        }),
    );
    const staleRead = authStore.loadUserProfile('user-a');

    mockAuthService.signOut.mockResolvedValueOnce({ success: true });
    await authStore.signOut();
    await flushPromises();
    await signIn(authStore, 'user-a', makeLlm({ keys: { openai: 'fresh-key' } }));

    resolveGet(makeProfile(makeUser('user-a', makeLlm({ keys: { google: 'stale-key' } }))));
    await staleRead;
    await flushPromises();

    mockAuthService.getUserProfile.mockResolvedValueOnce(
      makeProfile(makeUser('user-a', makeLlm({ keys: { openai: 'fresh-key' } }))),
    );
    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expect(mockAuthService.getUserProfile).toHaveBeenCalledTimes(2);
    const aLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(aLlm?.keys).toEqual({ openai: 'fresh-key' });
    expect(llmStore.llm.keys).toEqual({ openai: 'fresh-key' });
  });

  it('returns false when the session changes after the write resolves but before the save completes', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a', makeLlm());

    let resolveGet!: (_v: Profile | null) => void;
    const pendingProfile = new Promise<Profile | null>((res) => {
      resolveGet = res;
    });
    mockAuthService.getUserProfile.mockImplementationOnce(() => pendingProfile);

    const pending = llmStore.saveProvider('google', 'boundary-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    applyWrite(0);
    await flushPromises();

    void pendingProfile.then(() => {
      void Promise.resolve().then(() => {
        void Promise.resolve().then(() => {
          authStore.setSession(null);
          authStore.setUser(null);
        });
      });
    });
    resolveGet(makeProfile(makeUser('user-a', makeLlm({ keys: { google: 'boundary-key' } }))));

    const result = await pending;
    await flushPromises();

    expect(result).toBe(false);
    expect(authStore.user).toBeNull();
    expect(llmStore.llm.keys).toEqual({});
  });
});
