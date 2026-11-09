import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  ExpectedPreferencesVersionSchema,
  normalizePreferences,
  PreferencesReadSchema,
  PreferencesSchema,
  preserveStoredLlm,
} from '../../../vela-api/src/profile-preferences';
import type { BrowserContext, Page, Route } from '@playwright/test';
import {
  SYNTHETIC_COGNITO_ENV,
  SYNTHETIC_USER_A,
  SYNTHETIC_USER_B,
  type SyntheticUser,
} from './syntheticEnv';

const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider';
const SESSION_BOOTSTRAP_KEY = 'e2e.syntheticSessionEntries';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const makeSyntheticJwt = (payload: Record<string, unknown>): string =>
  `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.e2esyntheticsig`;

const clientIdCandidates = (): string[] => {
  const ids = [
    SYNTHETIC_COGNITO_ENV.VITE_COGNITO_USER_POOL_CLIENT_ID,
    process.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
    process.env.VITE_COGNITO_TEST_CLIENT_ID,
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
};

export interface SyntheticTokens {
  accessToken: string;
  idToken: string;
}

export const makeSyntheticTokens = (user: SyntheticUser): SyntheticTokens => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60;
  const idToken = makeSyntheticJwt({
    sub: user.userId,
    'cognito:username': user.username,
    email: user.email,
    preferred_username: user.username,
    token_use: 'id',
    iat: now,
    exp,
  });
  const accessToken = makeSyntheticJwt({
    sub: user.userId,
    'cognito:username': user.username,
    token_use: 'access',
    scope: 'email openid profile',
    iat: now,
    exp,
  });
  return { accessToken, idToken };
};

export const buildSessionEntries = (
  user: SyntheticUser,
  tokens: SyntheticTokens = makeSyntheticTokens(user),
): Array<[string, string]> => {
  const entries: Array<[string, string]> = [];
  for (const clientId of clientIdCandidates()) {
    const keyPrefix = `${AUTH_KEY_PREFIX}.${clientId}`;
    entries.push(
      [`${keyPrefix}.${user.username}.accessToken`, tokens.accessToken],
      [`${keyPrefix}.${user.username}.idToken`, tokens.idToken],
      [`${keyPrefix}.${user.username}.clockDrift`, '0'],
      [`${keyPrefix}.LastAuthUser`, user.username],
    );
  }
  return entries;
};

export const stageSessionFor = async (
  page: Page,
  user: SyntheticUser,
  tokens: SyntheticTokens = makeSyntheticTokens(user),
): Promise<void> => {
  const entries = buildSessionEntries(user, tokens);
  await page.evaluate(
    ({ key, items }) => {
      window.localStorage.setItem(key, JSON.stringify(items));
    },
    { key: SESSION_BOOTSTRAP_KEY, items: entries },
  );
};

export interface MockProfile {
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  native_language: string;
  current_level: number;
  total_experience: number;
  learning_streak: number;
  preferences: Record<string, unknown>;
  preferences_version?: string;
  created_at: string;
  updated_at: string;
}

export interface MockDictionaryEntry {
  user_id: string;
  sentence_id: string;
  sentence: string;
  source_url?: string;
  context?: string;
  created_at: number;
  updated_at: number;
}

export interface MockLlmPreferences {
  keys?: Record<string, string>;
  thinking?: Record<string, string>;
  defaultModel?: { provider: string; model: string };
}

export interface MockChatThread {
  ThreadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: { provider: string; model: string };
}

export interface MockChatMessage {
  ThreadId: string;
  Timestamp: number;
  UserId: string;
  message: string;
  is_user: boolean;
}

export interface MockApi {
  profiles: Map<string, MockProfile>;
  serverKeyProviders: string[] | null;
  expectedAuthorization: string | null;
  authHeaders: Array<{ method: string; path: string; authorization: string | null }>;
  profilePuts: Array<Record<string, unknown>>;
  chatBodies: Array<Record<string, unknown>>;
  analyzeBodies: Array<Record<string, unknown>>;
  chatHistorySaves: Array<Record<string, unknown>>;
  chatThreads: Map<string, Map<string, MockChatThread>>;
  chatMessages: Map<string, Map<string, MockChatMessage[]>>;
  patchThreadBodies: Array<Record<string, unknown>>;
  deletedThreadIds: Array<{ userId: string; threadId: string }>;
  dictionaryEntries: MockDictionaryEntry[];
  chatReply: string;
  ttsSettings: {
    provider: string;
    voiceId: string | null;
    model: string | null;
    hasApiKey: boolean;
  };
  seedProfile(_user: SyntheticUser, _preferences?: Record<string, unknown>): MockProfile;
  seedThread(
    _user: SyntheticUser,
    _thread: Partial<MockChatThread> & { ThreadId: string },
  ): MockChatThread;
  seedMessage(
    _user: SyntheticUser,
    _threadId: string,
    _message: string,
    _isUser: boolean,
    _timestamp?: number,
  ): MockChatMessage;
  threadsFor(_user: SyntheticUser): MockChatThread[];
  lastPut(): Record<string, unknown> | undefined;
}

const defaultPreferences = (): Record<string, unknown> => ({
  dailyGoal: 30,
  dailyLessonGoal: 5,
  lessonDurationMinutes: 6,
  todayStudyTime: 0,
});

const makeProfile = (user: SyntheticUser, preferences?: Record<string, unknown>): MockProfile => ({
  user_id: user.userId,
  email: user.email,
  username: user.username,
  avatar_url: null,
  native_language: 'en',
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  preferences: { ...defaultPreferences(), ...(preferences ?? {}) },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const createMockApi = (): MockApi => {
  const state: MockApi = {
    profiles: new Map(),
    serverKeyProviders: ['google', 'openrouter'],
    expectedAuthorization: null,
    authHeaders: [],
    profilePuts: [],
    chatBodies: [],
    analyzeBodies: [],
    chatHistorySaves: [],
    chatThreads: new Map(),
    chatMessages: new Map(),
    patchThreadBodies: [],
    deletedThreadIds: [],
    dictionaryEntries: [],
    chatReply: 'Mock AI reply (synthetic)',
    ttsSettings: { provider: 'elevenlabs', voiceId: null, model: null, hasApiKey: false },
    seedProfile(user, preferences) {
      const profile = makeProfile(user, preferences);
      state.profiles.set(user.userId, profile);
      return profile;
    },
    seedThread(user, thread) {
      const now = Date.now();
      const row: MockChatThread = {
        title: 'Mock conversation',
        createdAt: now,
        updatedAt: now,
        ...thread,
      };
      let userThreads = state.chatThreads.get(user.userId);
      if (!userThreads) {
        userThreads = new Map();
        state.chatThreads.set(user.userId, userThreads);
      }
      userThreads.set(row.ThreadId, row);
      return row;
    },
    seedMessage(user, threadId, message, isUser, timestamp = Date.now()) {
      const row: MockChatMessage = {
        ThreadId: threadId,
        Timestamp: timestamp,
        UserId: user.userId,
        message,
        is_user: isUser,
      };
      let userMessages = state.chatMessages.get(user.userId);
      if (!userMessages) {
        userMessages = new Map();
        state.chatMessages.set(user.userId, userMessages);
      }
      const list = userMessages.get(threadId) ?? [];
      list.push(row);
      userMessages.set(threadId, list);
      return row;
    },
    threadsFor(user) {
      return [...(state.chatThreads.get(user.userId)?.values() ?? [])].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.ThreadId.localeCompare(b.ThreadId),
      );
    },
    lastPut() {
      return state.profilePuts[state.profilePuts.length - 1];
    },
  };
  return state;
};

const normalizePreferencesForRead = (preferences: Record<string, unknown>) =>
  PreferencesReadSchema.parse(normalizePreferences(preferences));

const jsonResponse = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const readJsonBody = (route: Route): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(route.request().postData() ?? 'null');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const analyzeSseBody = (body: Record<string, unknown>): string => {
  const frames = [
    {
      type: 'metadata',
      provider: typeof body.provider === 'string' ? body.provider : 'google',
      model: typeof body.model === 'string' ? body.model : 'gemini-3.8-flash',
      sentence: typeof body.sentence === 'string' ? body.sentence : '',
    },
    { type: 'chunk', text: 'Mock streamed analysis of the sentence.' },
    { type: 'done' },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
};

const KNOWN_USERS = [SYNTHETIC_USER_A, SYNTHETIC_USER_B];

const authenticateRequest = (authorization: string | null): SyntheticUser | null => {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (payload.token_use !== 'id' || typeof payload.sub !== 'string') return null;
    return (
      KNOWN_USERS.find(
        (user) => user.userId === payload.sub && user.username === payload['cognito:username'],
      ) ?? null
    );
  } catch {
    return null;
  }
};

const handleApiRoute = async (state: MockApi, route: Route): Promise<void> => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  const authorization = request.headers()['authorization'] ?? null;
  state.authHeaders.push({ method, path, authorization });
  const authUser = authenticateRequest(authorization);
  if (!authUser) {
    return jsonResponse(route, { error: 'Unauthorized' }, 401);
  }

  const getOrCreateProfile = (userId: string): MockProfile => {
    let profile = state.profiles.get(userId);
    if (!profile) {
      profile = makeProfile({ userId, username: userId, email: `${userId}@example.invalid` });
      state.profiles.set(userId, profile);
    }
    return profile;
  };

  if (path === '/api/profiles/create' && method === 'POST') {
    const body = readJsonBody(route);
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!userId) return jsonResponse(route, { error: 'user_id is required' }, 400);
    if (userId !== authUser.userId) {
      return jsonResponse(
        route,
        { error: 'Forbidden: Cannot create profile for another user' },
        403,
      );
    }
    const exists = state.profiles.has(userId);
    if (!exists) {
      state.profiles.set(userId, makeProfile({ userId, username: userId, email: null }));
    }
    return jsonResponse(
      route,
      exists ? { success: true, message: 'Profile already exists' } : { success: true },
    );
  }

  if (path === '/api/profiles' && method === 'GET') {
    const userId = url.searchParams.get('user_id') ?? '';
    if (!userId) return jsonResponse(route, { error: 'user_id is required' }, 400);
    if (userId !== authUser.userId) {
      return jsonResponse(route, { error: "Forbidden: Cannot access another user's profile" }, 403);
    }
    const profile = getOrCreateProfile(userId);
    return jsonResponse(route, {
      profile: { ...profile, preferences: normalizePreferencesForRead(profile.preferences) },
    });
  }

  if (path === '/api/profiles/update' && method === 'PUT') {
    const body = readJsonBody(route);
    state.profilePuts.push(body);
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!userId) return jsonResponse(route, { error: 'user_id is required' }, 400);
    if (userId !== authUser.userId) {
      return jsonResponse(route, { error: "Forbidden: Cannot update another user's profile" }, 403);
    }
    const profile = getOrCreateProfile(userId);
    // Mirror UpdateProfileSchema: an invalid version is rejected before the
    // handler logic, regardless of whether preferences are being updated.
    if (!ExpectedPreferencesVersionSchema.safeParse(body.expected_preferences_version).success) {
      return jsonResponse(route, { error: 'Invalid preferences data' }, 400);
    }
    if (body.preferences !== undefined) {
      const parsed = PreferencesSchema.safeParse(body.preferences);
      if (!parsed.success) return jsonResponse(route, { error: 'Invalid preferences' }, 400);
      if (body.expected_preferences_version === undefined)
        return jsonResponse(route, { error: 'Reload your profile' }, 428);
      if (body.expected_preferences_version !== (profile.preferences_version ?? null))
        return jsonResponse(route, { error: 'Preferences changed elsewhere' }, 409);
      const next: Record<string, unknown> = normalizePreferences(parsed.data);
      preserveStoredLlm(next, profile.preferences);
      profile.preferences = next;
      profile.preferences_version = randomUUID();
    }
    if (body.username !== undefined) profile.username = body.username as string | null;
    if (body.avatar_url !== undefined) profile.avatar_url = body.avatar_url as string | null;
    if (body.native_language !== undefined) profile.native_language = String(body.native_language);
    profile.updated_at = new Date().toISOString();
    return jsonResponse(route, {
      success: true,
      profile: { ...profile, preferences: normalizePreferencesForRead(profile.preferences) },
    });
  }

  if (path === '/api/llm-chat/capabilities' && method === 'GET') {
    if (state.serverKeyProviders === null) {
      return jsonResponse(route, { error: 'Capabilities unavailable' }, 500);
    }
    return jsonResponse(route, { serverKeyProviders: [...state.serverKeyProviders] });
  }

  if (path === '/api/llm-chat' && method === 'POST') {
    const body = readJsonBody(route);
    state.chatBodies.push(body);
    return jsonResponse(route, {
      text: state.chatReply,
      usage: { inputTokens: 5, outputTokens: 7, cachedInputTokens: 0, cacheWriteTokens: 0 },
    });
  }

  if (path === '/api/chat-history/save' && method === 'POST') {
    const body = readJsonBody(route);
    state.chatHistorySaves.push(body);
    const threadId = typeof body.ThreadId === 'string' ? body.ThreadId : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (!threadId) return jsonResponse(route, { error: 'ThreadId is required' }, 400);
    if (!message) return jsonResponse(route, { error: 'Message is required' }, 400);
    if (typeof body.is_user !== 'boolean') {
      return jsonResponse(route, { error: 'is_user is required' }, 400);
    }
    const now = Date.now();
    if (body.is_user) {
      let userThreads = state.chatThreads.get(authUser.userId);
      if (!userThreads) {
        userThreads = new Map();
        state.chatThreads.set(authUser.userId, userThreads);
      }
      const existing = userThreads.get(threadId);
      const initialTitle = message.trim().slice(0, 60) || 'New conversation';
      userThreads.set(threadId, {
        ThreadId: threadId,
        title: existing?.title ?? initialTitle,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(existing?.model ? { model: existing.model } : {}),
      });
    }
    let userMessages = state.chatMessages.get(authUser.userId);
    if (!userMessages) {
      userMessages = new Map();
      state.chatMessages.set(authUser.userId, userMessages);
    }
    const list = userMessages.get(threadId) ?? [];
    list.push({
      ThreadId: threadId,
      Timestamp: now,
      UserId: authUser.userId,
      message,
      is_user: body.is_user,
    });
    userMessages.set(threadId, list);
    return jsonResponse(route, { ok: true });
  }

  if (path === '/api/chat-history/threads' && method === 'GET') {
    return jsonResponse(route, { threads: state.threadsFor(authUser) });
  }

  if (path === '/api/chat-history/messages' && method === 'GET') {
    const threadId = url.searchParams.get('thread_id') ?? '';
    if (!threadId) return jsonResponse(route, { error: 'thread_id is required' }, 400);
    const thread = state.chatThreads.get(authUser.userId)?.get(threadId);
    if (!thread) return jsonResponse(route, { error: 'Thread not found' }, 404);
    const items = [...(state.chatMessages.get(authUser.userId)?.get(threadId) ?? [])].sort(
      (a, b) => a.Timestamp - b.Timestamp,
    );
    return jsonResponse(route, { items });
  }

  const threadPathMatch = /^\/api\/chat-history\/thread\/([^/]+)$/.exec(path);
  if (threadPathMatch && method === 'PATCH') {
    const threadId = decodeURIComponent(threadPathMatch[1] ?? '');
    const body = readJsonBody(route);
    state.patchThreadBodies.push(body);
    const patch: { title?: string; model?: { provider: string; model: string } } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return jsonResponse(route, { error: 'title is required' }, 400);
      }
      const trimmed = body.title.trim();
      if (trimmed.length > 60) {
        return jsonResponse(route, { error: 'title must be 60 characters or fewer' }, 400);
      }
      patch.title = trimmed;
    }
    if (body.model !== undefined) {
      const model = body.model as { provider?: unknown; model?: unknown };
      if (
        typeof model?.provider !== 'string' ||
        model.provider.length === 0 ||
        typeof model?.model !== 'string' ||
        model.model.length === 0
      ) {
        return jsonResponse(route, { error: 'Invalid model' }, 400);
      }
      patch.model = { provider: model.provider, model: model.model };
    }
    if (patch.title === undefined && patch.model === undefined) {
      return jsonResponse(route, { error: 'At least one of title or model is required' }, 400);
    }
    const existing = state.chatThreads.get(authUser.userId)?.get(threadId);
    if (!existing) return jsonResponse(route, { error: 'Thread not found' }, 404);
    const updated: MockChatThread = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      updatedAt: Date.now(),
    };
    state.chatThreads.get(authUser.userId)?.set(threadId, updated);
    return jsonResponse(route, { thread: updated });
  }

  if (threadPathMatch && method === 'DELETE') {
    const threadId = decodeURIComponent(threadPathMatch[1] ?? '');
    const userThreads = state.chatThreads.get(authUser.userId);
    const existing = userThreads?.get(threadId);
    if (!existing) return jsonResponse(route, { error: 'Thread not found' }, 404);
    userThreads?.delete(threadId);
    state.chatMessages.get(authUser.userId)?.delete(threadId);
    state.deletedThreadIds.push({ userId: authUser.userId, threadId });
    return jsonResponse(route, { ok: true });
  }

  if (path === '/api/my-dictionaries' && method === 'GET') {
    return jsonResponse(route, { success: true, data: state.dictionaryEntries });
  }

  if (path === '/api/my-dictionaries/analyze' && method === 'POST') {
    const body = readJsonBody(route);
    state.analyzeBodies.push(body);
    if (typeof body.apiKey !== 'string' || body.apiKey.length === 0) {
      const provider = typeof body.provider === 'string' ? body.provider : 'google';
      const label = PROVIDER_LABELS[provider] ?? provider;
      return jsonResponse(route, { error: `Missing API key for ${label} provider` }, 400);
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: analyzeSseBody(body),
    });
  }

  if (path === '/api/tts/settings' && method === 'GET') {
    return jsonResponse(route, { ...state.ttsSettings });
  }

  if (path === '/api/tts/settings' && method === 'POST') {
    const body = readJsonBody(route);
    state.ttsSettings = {
      provider: typeof body.provider === 'string' ? body.provider : 'elevenlabs',
      voiceId: typeof body.voiceId === 'string' ? body.voiceId : null,
      model: typeof body.model === 'string' ? body.model : null,
      hasApiKey: typeof body.apiKey === 'string' && body.apiKey.length > 0,
    };
    return jsonResponse(route, { success: true });
  }

  if (path === '/api/dictionary/lookup' && method === 'GET') {
    return jsonResponse(route, { error: 'Not found' }, 404);
  }

  return jsonResponse(route, { error: `unmocked API request: ${method} ${path}` }, 500);
};

const installNetworkGuard = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const scheme = url.split(':', 1)[0];
    if (scheme === 'data' || scheme === 'blob' || scheme === 'about') {
      return route.continue();
    }
    try {
      if (LOOPBACK_HOSTS.has(new URL(url).hostname)) {
        return route.continue();
      }
    } catch {
      return route.abort('blockedbyclient');
    }
    return route.abort('blockedbyclient');
  });
};

const installMocks = async (context: BrowserContext, state: MockApi): Promise<void> => {
  await installNetworkGuard(context);
  await context.route('**/api/**', (route) => handleApiRoute(state, route));
};

export interface SyntheticAuthFixtures {
  apiMock: MockApi;
  authedPage: Page;
}

export const test = base.extend<SyntheticAuthFixtures>({
  apiMock: async ({ playwright: _playwright }, use) => {
    await use(createMockApi());
  },
  authedPage: async ({ context, page, apiMock }, use) => {
    const tokens = makeSyntheticTokens(SYNTHETIC_USER_A);
    apiMock.expectedAuthorization = `Bearer ${tokens.idToken}`;
    await context.addInitScript(
      ({ bootstrapKey, authKeyPrefix, entries }) => {
        try {
          const staged = window.localStorage.getItem(bootstrapKey);
          const sessionEntries = staged ? (JSON.parse(staged) as Array<[string, string]>) : entries;
          const staleKeys: string[] = [];
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(authKeyPrefix)) staleKeys.push(key);
          }
          for (const key of staleKeys) {
            window.localStorage.removeItem(key);
          }
          for (const [key, value] of sessionEntries) {
            window.localStorage.setItem(key, value);
          }
        } catch {
          return;
        }
      },
      {
        bootstrapKey: SESSION_BOOTSTRAP_KEY,
        authKeyPrefix: AUTH_KEY_PREFIX,
        entries: buildSessionEntries(SYNTHETIC_USER_A, tokens),
      },
    );
    await installMocks(context, apiMock);
    await use(page);
  },
});

export { expect, SYNTHETIC_USER_A };
