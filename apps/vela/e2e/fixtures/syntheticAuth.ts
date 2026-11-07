import { test as base, expect } from '@playwright/test';
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
const KNOWN_PROVIDERS = ['google', 'openai', 'anthropic', 'openrouter'] as const;
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

export interface MockApi {
  profiles: Map<string, MockProfile>;
  serverKeyProviders: string[] | null;
  expectedAuthorization: string | null;
  authHeaders: Array<{ method: string; path: string; authorization: string | null }>;
  profilePuts: Array<Record<string, unknown>>;
  chatBodies: Array<Record<string, unknown>>;
  analyzeBodies: Array<Record<string, unknown>>;
  chatHistorySaves: Array<Record<string, unknown>>;
  dictionaryEntries: MockDictionaryEntry[];
  chatReply: string;
  ttsSettings: {
    provider: string;
    voiceId: string | null;
    model: string | null;
    hasApiKey: boolean;
  };
  seedProfile(_user: SyntheticUser, _preferences?: Record<string, unknown>): MockProfile;
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
    dictionaryEntries: [],
    chatReply: 'Mock AI reply (synthetic)',
    ttsSettings: { provider: 'elevenlabs', voiceId: null, model: null, hasApiKey: false },
    seedProfile(user, preferences) {
      const profile = makeProfile(user, preferences);
      state.profiles.set(user.userId, profile);
      return profile;
    },
    lastPut() {
      return state.profilePuts[state.profilePuts.length - 1];
    },
  };
  return state;
};

const normalizePreferencesForRead = (
  preferences: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...defaultPreferences(), ...preferences };
  const llm = out.llm;
  if (llm !== undefined) {
    const candidate = llm as Partial<MockLlmPreferences> | null;
    const dm = candidate?.defaultModel;
    const valid =
      !!candidate &&
      typeof candidate === 'object' &&
      !!candidate.keys &&
      typeof candidate.keys === 'object' &&
      !!candidate.thinking &&
      typeof candidate.thinking === 'object' &&
      !!dm &&
      typeof dm === 'object' &&
      typeof dm.provider === 'string' &&
      (KNOWN_PROVIDERS as readonly string[]).includes(dm.provider) &&
      typeof dm.model === 'string';
    if (!valid) {
      delete out.llm;
    }
  }
  return out;
};

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
  if (!authenticateRequest(authorization)) {
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
    const profile = getOrCreateProfile(userId);
    if (body.username !== undefined) profile.username = body.username as string | null;
    if (body.avatar_url !== undefined) profile.avatar_url = body.avatar_url as string | null;
    if (body.native_language !== undefined) profile.native_language = String(body.native_language);
    if (body.preferences !== undefined)
      profile.preferences = { ...(body.preferences as Record<string, unknown>) };
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
    state.chatHistorySaves.push(readJsonBody(route));
    return jsonResponse(route, { ok: true });
  }

  if (path === '/api/chat-history/threads' && method === 'GET') {
    return jsonResponse(route, { threads: [] });
  }

  if (path === '/api/chat-history/messages' && method === 'GET') {
    return jsonResponse(route, { items: [] });
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
