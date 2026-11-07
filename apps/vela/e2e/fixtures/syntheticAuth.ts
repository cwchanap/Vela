import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { SYNTHETIC_COGNITO_ENV, SYNTHETIC_USER_A, type SyntheticUser } from './syntheticEnv';

/**
 * Fully self-contained Playwright fixture for the LLM-settings acceptance
 * suite. Unlike e2e/fixtures/auth.ts it never touches real Cognito, AWS, or
 * provider APIs:
 *
 *  - A synthetic, unsigned-but-unexpired JWT pair is seeded into localStorage
 *    in Amplify v6's storage layout, so fetchAuthSession/getCurrentUser take
 *    their pure-localStorage path and report a valid session.
 *  - Every /api/* request is intercepted in the browser and answered by an
 *    in-memory per-test mock that mirrors the real route contracts
 *    (profile auto-create, strict PUT + lenient llm read, capabilities,
 *    chat, SSE dictionary analysis, TTS settings).
 *  - Every non-loopback request (fonts, Cognito endpoints, provider APIs,
 *    CDN images) is aborted, so nothing can leak off-machine.
 *  - /api paths with no registered mock return a 500 so unmocked surfaces
 *    fail closed instead of silently hitting a dead proxy.
 */

const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider';
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

/** Unsigned JWT carrying only the claims Amplify decodes client-side. */
const makeSyntheticJwt = (payload: Record<string, unknown>): string =>
  `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.e2esyntheticsig`;

/**
 * Amplify keys its token storage by the configured user-pool client id.
 * Seed every plausible id — the synthetic one from the mocked config plus
 * any real env ids — so this spec stays hermetic under either config.
 */
const clientIdCandidates = (): string[] => {
  const ids = [
    SYNTHETIC_COGNITO_ENV.VITE_COGNITO_USER_POOL_CLIENT_ID,
    process.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
    process.env.VITE_COGNITO_TEST_CLIENT_ID,
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
};

/** localStorage entries equivalent to a real Cognito session (no refresh token → refresh is impossible → zero Cognito network). */
export const buildSessionEntries = (user: SyntheticUser): Array<[string, string]> => {
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

  const entries: Array<[string, string]> = [];
  for (const clientId of clientIdCandidates()) {
    const keyPrefix = `${AUTH_KEY_PREFIX}.${clientId}`;
    entries.push(
      [`${keyPrefix}.${user.username}.accessToken`, accessToken],
      [`${keyPrefix}.${user.username}.idToken`, idToken],
      [`${keyPrefix}.${user.username}.clockDrift`, '0'],
      [`${keyPrefix}.LastAuthUser`, user.username],
    );
  }
  return entries;
};

/**
 * Register an additional session-seeding init script for a different user.
 * Runs after the fixture's own script on the next navigation, so its
 * LastAuthUser entry wins — this is how a mid-test account switch works.
 */
export const seedSessionFor = async (
  context: BrowserContext,
  user: SyntheticUser,
): Promise<void> => {
  const entries = buildSessionEntries(user);
  await context.addInitScript(
    ({ items }) => {
      try {
        for (const [key, value] of items) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        // Retry-safe: later navigations re-run this init script.
      }
    },
    { items: entries },
  );
};

export interface MockProfile {
  id: string;
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  native_language: string;
  current_level: number;
  total_experience: number;
  learning_streak: number;
  last_activity: string | null;
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

/** Per-test mutable state backing every route mock. */
export interface MockApi {
  profiles: Map<string, MockProfile>;
  /** null = the capabilities endpoint answers 500 (failed lookup). */
  serverKeyProviders: string[] | null;
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
  id: user.userId,
  user_id: user.userId,
  email: user.email,
  username: user.username,
  avatar_url: null,
  native_language: 'en',
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  last_activity: null,
  preferences: { ...defaultPreferences(), ...(preferences ?? {}) },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const createMockApi = (): MockApi => {
  const state: MockApi = {
    profiles: new Map(),
    serverKeyProviders: ['google', 'openrouter'],
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

/**
 * Mirrors the API's lenient read path (PreferencesReadSchema): unknown keys
 * are stripped and a malformed `llm` subtree drops to undefined instead of
 * failing the whole profile GET.
 */
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

const handleApiRoute = async (state: MockApi, route: Route): Promise<void> => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();

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

  // Fail closed: anything not explicitly mocked must not silently succeed.
  return jsonResponse(route, { error: `unmocked API request: ${method} ${path}` }, 500);
};

const installNetworkGuard = async (page: Page): Promise<void> => {
  await page.route('**/*', async (route) => {
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
      // Unparseable URL — abort below.
    }
    return route.abort('blockedbyclient');
  });
};

const installMocks = async (page: Page, state: MockApi): Promise<void> => {
  // Registered first so the API mocks (below) take precedence for /api paths.
  await installNetworkGuard(page);
  await page.route('**/api/**', (route) => handleApiRoute(state, route));
};

export interface SyntheticAuthFixtures {
  apiMock: MockApi;
  /** Page with a synthetic Amplify session + fully mocked API installed. */
  authedPage: Page;
}

export const test = base.extend<SyntheticAuthFixtures>({
  apiMock: async ({ playwright: _playwright }, use) => {
    await use(createMockApi());
  },
  authedPage: async ({ context, page, apiMock }, use) => {
    await context.addInitScript(
      ({ entries }) => {
        try {
          for (const [key, value] of entries) {
            window.localStorage.setItem(key, value);
          }
        } catch {
          // Retry-safe: later navigations re-run this init script.
        }
      },
      { entries: buildSessionEntries(SYNTHETIC_USER_A) },
    );
    await installMocks(page, apiMock);
    await use(page);
  },
});

export { expect, SYNTHETIC_USER_A };
