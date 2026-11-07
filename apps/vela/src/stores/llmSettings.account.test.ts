import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { LLM_PROVIDER_REGISTRY, authKeys } from '@vela/common';
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

vi.mock('quasar', () => ({
  Dark: { set: vi.fn() },
  LocalStorage: { set: vi.fn(), has: vi.fn(() => false), get: vi.fn(() => null) },
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

let writeStamp = 0;

const nextWriteStamp = () => {
  writeStamp += 1;
  return new Date(Date.UTC(2030, 0, 1, 0, 0, writeStamp)).toISOString();
};

const applyWrite = (index: number) => {
  const write = pendingWrites[index]!;
  const existing = serverProfiles.get(write.userId);
  if (existing) {
    Object.assign(existing, write.data);
    existing.updated_at = nextWriteStamp();
  }
  write.resolve({
    success: true,
    profile: serverProfiles.get(write.userId),
  } as AuthResponse);
};

const resolveWrite = (index: number, response: AuthResponse) => {
  pendingWrites[index]!.resolve(response);
};

const staleRead = (id: string): Profile => {
  const user = makeUser(id, makeLlm());
  (user.preferences as Record<string, unknown>).dailyGoal = 30;
  return { ...makeProfile(user), updated_at: '2024-01-01T00:00:00.000Z' };
};

const drainWrites = async () => {
  while (pendingWrites.length) {
    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();
  }
};

const writeHas = (write: (typeof pendingWrites)[number], key: string) =>
  Object.prototype.hasOwnProperty.call(
    (write.data.preferences as Record<string, unknown> | undefined) ?? {},
    key,
  );

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

describe('overlapping theme and llm preference writes (real stores)', () => {
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
    const { useThemeStore } = await import('./theme');
    const authStore = useAuthStore();
    const llmStore = useLLMSettingsStore();
    const themeStore = useThemeStore();
    return { authStore, llmStore, themeStore };
  };

  const signInWithBasePrefs = async (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
  ) => {
    const user = makeUser('user-a', makeLlm());
    (user.preferences as Record<string, unknown>).dailyGoal = 30;
    serverProfiles.set('user-a', makeProfile(user));
    authStore.setSession(makeSession('user-a'));
    authStore.setUser(user);
    await flushPromises();
  };

  const expectMergedPreferences = (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
  ) => {
    const serverPrefs = serverProfiles.get('user-a')?.preferences as Record<string, unknown>;
    expect(serverPrefs.darkMode).toBe(true);
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(serverPrefs.dailyGoal).toBe(30);
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.darkMode).toBe(true);
    expect((localPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(localPrefs.dailyGoal).toBe(30);
  };

  it('keeps the theme patch when the llm write resolves first', async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    const llmPrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect(writeHas(pendingWrites[0]!, 'darkMode')).toBe(false);
    expect((llmPrefs.llm as LlmPreferences).keys.google).toBe('g-key');

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    expect(pendingWrites).toHaveLength(1);
    const themePrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect(themePrefs.darkMode).toBe(true);
    expect((themePrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps the llm patch when the theme write resolves first', async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    const themePrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect(themePrefs.darkMode).toBe(true);
    expect((themePrefs.llm as LlmPreferences).keys.google).toBeUndefined();

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    expect(pendingWrites).toHaveLength(1);
    const llmPrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect((llmPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(llmPrefs.darkMode).toBe(true);
    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    await Promise.all([themeSave, llmSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });
});

describe('acknowledged writes survive missing or stale profile reads', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    pendingWrites.length = 0;
    serverProfiles.clear();
    queryCache.clear();
    mockAuthService.getUserProfile.mockImplementation((userId: string) =>
      Promise.resolve(serverProfiles.get(userId) ?? null),
    );
  });

  const stores = async () => {
    const { useAuthStore } = await import('./auth');
    const { useLLMSettingsStore } = await import('./llmSettings');
    const { useThemeStore } = await import('./theme');
    const authStore = useAuthStore();
    const llmStore = useLLMSettingsStore();
    const themeStore = useThemeStore();
    return { authStore, llmStore, themeStore };
  };

  const signInWithBasePrefs = async (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
  ) => {
    const user = makeUser('user-a', makeLlm());
    (user.preferences as Record<string, unknown>).dailyGoal = 30;
    serverProfiles.set('user-a', makeProfile(user));
    authStore.setSession(makeSession('user-a'));
    authStore.setUser(user);
    await flushPromises();
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

  const expectMergedPreferences = (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
  ) => {
    const serverPrefs = serverProfiles.get('user-a')?.preferences as Record<string, unknown>;
    expect(serverPrefs.darkMode).toBe(true);
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(serverPrefs.dailyGoal).toBe(30);
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.darkMode).toBe(true);
    expect((localPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(localPrefs.dailyGoal).toBe(30);
  };

  const llmThenTheme = async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    expect(writeHas(pendingWrites[0]!, 'darkMode')).toBe(false);

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    return { authStore, llmStore, llmSave, themeSave };
  };

  const themeThenLlm = async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    expect(writeHas(pendingWrites[0]!, 'darkMode')).toBe(true);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    return { authStore, llmStore, llmSave, themeSave };
  };

  it('keeps both patches when the first follow-up read returns null (llm -> theme)', async () => {
    mockAuthService.getUserProfile.mockResolvedValue(null);
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the first follow-up read returns null (theme -> llm)', async () => {
    mockAuthService.getUserProfile.mockResolvedValue(null);
    const { authStore, llmStore, llmSave, themeSave } = await themeThenLlm();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the first follow-up read returns stale preferences (llm -> theme)', async () => {
    mockAuthService.getUserProfile.mockResolvedValue(staleRead('user-a'));
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the first follow-up read returns stale preferences (theme -> llm)', async () => {
    mockAuthService.getUserProfile.mockResolvedValue(staleRead('user-a'));
    const { authStore, llmStore, llmSave, themeSave } = await themeThenLlm();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the last follow-up read returns stale preferences (llm -> theme)', async () => {
    mockAuthService.getUserProfile
      .mockImplementationOnce((userId: string) =>
        Promise.resolve(serverProfiles.get(userId) ?? null),
      )
      .mockResolvedValue(staleRead('user-a'));
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the last follow-up read returns stale preferences (theme -> llm)', async () => {
    mockAuthService.getUserProfile
      .mockImplementationOnce((userId: string) =>
        Promise.resolve(serverProfiles.get(userId) ?? null),
      )
      .mockResolvedValue(staleRead('user-a'));
    const { authStore, llmStore, llmSave, themeSave } = await themeThenLlm();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the last follow-up read returns null (llm -> theme)', async () => {
    mockAuthService.getUserProfile
      .mockImplementationOnce((userId: string) =>
        Promise.resolve(serverProfiles.get(userId) ?? null),
      )
      .mockResolvedValue(null);
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps both patches when the last follow-up read returns null (theme -> llm)', async () => {
    mockAuthService.getUserProfile
      .mockImplementationOnce((userId: string) =>
        Promise.resolve(serverProfiles.get(userId) ?? null),
      )
      .mockResolvedValue(null);
    const { authStore, llmStore, llmSave, themeSave } = await themeThenLlm();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('does not let a stale in-flight profile read overwrite an acknowledged save', async () => {
    let resolveRead!: (_v: Profile | null) => void;
    mockAuthService.getUserProfile.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveRead = res;
        }),
    );
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    const read = authStore.loadUserProfile('user-a');
    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);
    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();

    await drainWrites();
    resolveRead(staleRead('user-a'));
    await read;
    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('does not hydrate stale cached preferences over an acknowledged save', async () => {
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    await drainWrites();
    await Promise.all([llmSave, themeSave]);
    await flushPromises();
    expectMergedPreferences(authStore);

    const stale = staleRead('user-a');
    queryCache.set(cacheKey(authKeys.profile('user-a')), {
      data: stale,
      dataUpdatedAt: Date.now(),
      isInvalidated: false,
    });
    mockAuthService.getUserProfile.mockResolvedValue(stale);

    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expectMergedPreferences(authStore);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps a preference patch when an overlapping non-preference write resolves', async () => {
    const { authStore, llmStore } = await stores();
    await signInWithBasePrefs(authStore);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    const nameSave = authStore.updateProfile({ username: 'renamed' });
    await flushPromises();

    await drainWrites();
    const [llmOk, nameOk] = await Promise.all([llmSave, nameSave]);
    await flushPromises();

    expect(llmOk).toBe(true);
    expect(nameOk).toBe(true);
    expect(authStore.user?.username).toBe('renamed');
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect((localPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(localPrefs.dailyGoal).toBe(30);
    const server = serverProfiles.get('user-a');
    expect(server?.username).toBe('renamed');
    const serverPrefs = server?.preferences as Record<string, unknown>;
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(serverPrefs.dailyGoal).toBe(30);
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('still applies the next queued write after a failed write', async () => {
    const { authStore, llmStore, llmSave, themeSave } = await llmThenTheme();

    resolveWrite(0, { success: false, error: 'rejected' });
    pendingWrites.splice(0, 1);
    await flushPromises();
    await drainWrites();
    const [llmOk] = await Promise.all([llmSave, themeSave]);
    await flushPromises();

    expect(llmOk).toBe(false);
    const serverPrefs = serverProfiles.get('user-a')?.preferences as Record<string, unknown>;
    expect(serverPrefs.darkMode).toBe(true);
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBeUndefined();
    expect(serverPrefs.dailyGoal).toBe(30);
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.darkMode).toBe(true);
    expect((localPrefs.llm as LlmPreferences).keys.google).toBeUndefined();
    expect(llmStore.llm.keys.google).toBeUndefined();
  });

  it('does not install an acknowledged profile after the session changes', async () => {
    const { authStore, llmStore } = await stores();
    await signIn(authStore, 'user-a');

    const pending = llmStore.saveProvider('google', 'a-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    await signIn(authStore, 'user-b');
    applyWrite(0);

    const result = await pending;
    await flushPromises();

    expect(result).toBe(false);
    expect(authStore.user?.id).toBe('user-b');
    const bLlm = authStore.user?.preferences.llm as LlmPreferences | undefined;
    expect(bLlm?.keys.google).toBeUndefined();
    expect(llmStore.llm.keys).toEqual({});
  });
});

describe('session-scoped acknowledged writes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    pendingWrites.length = 0;
    serverProfiles.clear();
    queryCache.clear();
    mockAuthService.getUserProfile.mockImplementation((userId: string) =>
      Promise.resolve(serverProfiles.get(userId) ?? null),
    );
  });

  const stores = async () => {
    const { useAuthStore } = await import('./auth');
    const { useLLMSettingsStore } = await import('./llmSettings');
    const { useThemeStore } = await import('./theme');
    const authStore = useAuthStore();
    const llmStore = useLLMSettingsStore();
    const themeStore = useThemeStore();
    return { authStore, llmStore, themeStore };
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

  const signInWithBasePrefs = async (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
  ) => {
    const user = makeUser('user-a', makeLlm());
    (user.preferences as Record<string, unknown>).dailyGoal = 30;
    serverProfiles.set('user-a', makeProfile(user));
    authStore.setSession(makeSession('user-a'));
    authStore.setUser(user);
    await flushPromises();
  };

  const acknowledgeLlmSave = async (key: string) => {
    const { authStore, llmStore } = await stores();
    await signInWithBasePrefs(authStore);
    const save = llmStore.saveProvider('google', key);
    await flushPromises();
    await drainWrites();
    await save;
    await flushPromises();
    return { authStore, llmStore };
  };

  const expectNewSnapshot = (
    authStore: ReturnType<(typeof import('./auth'))['useAuthStore']>,
    llmStore: ReturnType<(typeof import('./llmSettings'))['useLLMSettingsStore']>,
    snapshot: Profile,
  ) => {
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.dailyGoal).toBe(15);
    expect((localPrefs.llm as LlmPreferences).keys.openai).toBe('new-openai-key');
    expect((localPrefs.llm as LlmPreferences).keys.google).toBeUndefined();
    const cached = queryCache.get(cacheKey(authKeys.profile('user-a')))?.data as Profile;
    expect(cached?.preferences).toEqual(snapshot.preferences);
    expect(llmStore.llm.keys.openai).toBe('new-openai-key');
    expect(llmStore.llm.keys.google).toBeUndefined();
  };

  it('does not substitute a previous-session acknowledgment after switching back to the same account', async () => {
    const { authStore, llmStore } = await acknowledgeLlmSave('old-key');
    const acknowledgedStamp = serverProfiles.get('user-a')!.updated_at;

    authStore.setSession(makeSession('user-b'));
    authStore.setUser(makeUser('user-b'));
    await flushPromises();
    authStore.setSession(makeSession('user-a'));
    authStore.setUser(makeUser('user-a'));
    await flushPromises();

    const snapshot: Profile = {
      ...makeProfile(makeUser('user-a')),
      preferences: {
        dailyGoal: 15,
        llm: makeLlm({ keys: { openai: 'new-openai-key' } }),
      } as UserPreferences,
      updated_at: acknowledgedStamp,
    };
    serverProfiles.set('user-a', snapshot);

    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expectNewSnapshot(authStore, llmStore, snapshot);
  });

  it('does not substitute a previous-session acknowledgment after same-account re-authentication', async () => {
    const { authStore, llmStore } = await acknowledgeLlmSave('old-key');
    const acknowledgedStamp = serverProfiles.get('user-a')!.updated_at;

    authStore.setSession(null);
    authStore.setUser(null);
    await flushPromises();
    authStore.setSession(makeSession('user-a'));
    authStore.setUser(makeUser('user-a'));
    await flushPromises();

    const snapshot: Profile = {
      ...makeProfile(makeUser('user-a')),
      preferences: {
        dailyGoal: 15,
        llm: makeLlm({ keys: { openai: 'new-openai-key' } }),
      } as UserPreferences,
      updated_at: acknowledgedStamp,
    };
    serverProfiles.set('user-a', snapshot);

    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expectNewSnapshot(authStore, llmStore, snapshot);
  });

  it('does not let an old same-account cache entry defeat the session reset', async () => {
    const { authStore, llmStore } = await acknowledgeLlmSave('old-key');
    const acknowledgedStamp = serverProfiles.get('user-a')!.updated_at;

    await signIn(authStore, 'user-b');
    await signIn(authStore, 'user-a');

    const snapshot: Profile = {
      ...makeProfile(makeUser('user-a')),
      preferences: {
        dailyGoal: 15,
        llm: makeLlm({ keys: { openai: 'new-openai-key' } }),
      } as UserPreferences,
      updated_at: acknowledgedStamp,
    };
    serverProfiles.set('user-a', snapshot);

    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expectNewSnapshot(authStore, llmStore, snapshot);
  });

  it('trusts a strictly newer read within the same session', async () => {
    const { authStore, llmStore } = await acknowledgeLlmSave('g-key');

    const newer: Profile = {
      ...serverProfiles.get('user-a')!,
      preferences: {
        ...(serverProfiles.get('user-a')!.preferences as Record<string, unknown>),
        dailyGoal: 42,
      } as UserPreferences,
      updated_at: nextWriteStamp(),
    };
    serverProfiles.set('user-a', newer);
    const entry = queryCache.get(cacheKey(authKeys.profile('user-a')));
    if (entry) entry.isInvalidated = true;

    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expect((authStore.user?.preferences as Record<string, unknown>).dailyGoal).toBe(42);
    expect(llmStore.llm.keys.google as string | undefined).toBe('g-key');

    const stale = staleRead('user-a');
    serverProfiles.set('user-a', stale);
    const entry2 = queryCache.get(cacheKey(authKeys.profile('user-a')));
    if (entry2) entry2.isInvalidated = true;
    await authStore.loadUserProfile('user-a');
    await flushPromises();

    expect((authStore.user?.preferences as Record<string, unknown>).dailyGoal).toBe(42);
    expect(llmStore.llm.keys.google as string | undefined).toBe('g-key');
  });

  it('keeps a strictly newer accepted read when reconciling the acknowledged write (llm -> theme)', async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    mockAuthService.getUserProfile.mockImplementationOnce((userId: string) => {
      const server = serverProfiles.get(userId)!;
      return Promise.resolve({
        ...server,
        preferences: {
          ...(server.preferences as Record<string, unknown>),
          dailyGoal: 60,
        } as UserPreferences,
        updated_at: nextWriteStamp(),
      });
    });

    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    expect(pendingWrites).toHaveLength(1);
    const themePrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect(themePrefs.darkMode).toBe(true);
    expect(themePrefs.dailyGoal).toBe(60);
    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    const serverPrefs = serverProfiles.get('user-a')!.preferences as Record<string, unknown>;
    expect(serverPrefs.dailyGoal).toBe(60);
    expect(serverPrefs.darkMode).toBe(true);
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.dailyGoal).toBe(60);
    expect(localPrefs.darkMode).toBe(true);
    expect((localPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(llmStore.llm.keys.google).toBe('g-key');
  });

  it('keeps a strictly newer accepted read when reconciling the acknowledged write (theme -> llm)', async () => {
    const { authStore, llmStore, themeStore } = await stores();
    await signInWithBasePrefs(authStore);

    themeStore.setDarkMode(true);
    const themeSave = themeStore.saveToUserPreferences();
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    const llmSave = llmStore.saveProvider('google', 'g-key');
    await flushPromises();
    expect(pendingWrites).toHaveLength(1);

    mockAuthService.getUserProfile.mockImplementationOnce((userId: string) => {
      const server = serverProfiles.get(userId)!;
      return Promise.resolve({
        ...server,
        preferences: {
          ...(server.preferences as Record<string, unknown>),
          dailyGoal: 60,
        } as UserPreferences,
        updated_at: nextWriteStamp(),
      });
    });

    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    expect(pendingWrites).toHaveLength(1);
    const llmPrefs = pendingWrites[0]!.data.preferences as Record<string, unknown>;
    expect((llmPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(llmPrefs.dailyGoal).toBe(60);
    expect(llmPrefs.darkMode).toBe(true);
    applyWrite(0);
    pendingWrites.splice(0, 1);
    await flushPromises();

    await Promise.all([llmSave, themeSave]);
    await flushPromises();

    const serverPrefs = serverProfiles.get('user-a')!.preferences as Record<string, unknown>;
    expect(serverPrefs.dailyGoal).toBe(60);
    expect(serverPrefs.darkMode).toBe(true);
    expect((serverPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    const localPrefs = authStore.user?.preferences as Record<string, unknown>;
    expect(localPrefs.dailyGoal).toBe(60);
    expect(localPrefs.darkMode).toBe(true);
    expect((localPrefs.llm as LlmPreferences).keys.google).toBe('g-key');
    expect(llmStore.llm.keys.google).toBe('g-key');
  });
});
