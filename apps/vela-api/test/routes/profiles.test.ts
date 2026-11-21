import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import { LLM_PROVIDER_REGISTRY, PREFERENCES_READ_CONTRACT } from '@vela/common/contracts/llm';
import type { Env } from '../../src/types';
import { profiles } from '../../src/routes/profiles';
import { PreferencesReadSchema } from '../../src/profile-preferences';

const mockProfilesDb = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  claimUsername: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  profiles: mockProfilesDb,
}));

// Mock auth middleware to always pass in tests
vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', 'test-user');
    _c.set('userEmail', 'user@example.com');
    await next();
  },
  AuthContext: {},
}));

function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });

  app.route('/', profiles(env));

  return app;
}

describe('Profiles Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET / should not 500 when stored preferences include legacy keys', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: 'user@example.com',
      username: 'u1',
      avatar_url: null,
      native_language: 'en',
      current_level: 1,
      total_experience: 0,
      learning_streak: 0,
      preferences: {
        dailyLessonGoal: 7,
        lessonDurationMinutes: 10,
        legacyFlag: true,
        someOldSetting: 'x',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const app = createTestApp({});
    const req = new Request('http://localhost/?user_id=test-user');
    const res = await app.request(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.profile).toBeTruthy();
    expect(json.profile.preferences).toBeTruthy();

    // Unknown keys should be stripped from the response
    expect(json.profile.preferences.legacyFlag).toBeUndefined();
    expect(json.profile.preferences.someOldSetting).toBeUndefined();

    // Known keys should be present
    expect(json.profile.preferences.dailyLessonGoal).toBe(7);
    expect(json.profile.preferences.lessonDurationMinutes).toBe(10);

    // GET should be idempotent and not write
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('GET / returns 403 when user_id does not match authenticated user', async () => {
    const app = createTestApp();
    const res = await app.request('/?user_id=other-user');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Forbidden');
  });

  test('GET / creates profile when profile does not exist', async () => {
    mockProfilesDb.get.mockResolvedValueOnce(null);
    mockProfilesDb.create.mockResolvedValueOnce(undefined);
    const app = createTestApp();
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { user_id: string } };
    expect(body.profile.user_id).toBe('test-user');
    expect(mockProfilesDb.create).toHaveBeenCalledTimes(1);
  });

  test('GET / returns the existing profile when concurrent creation wins', async () => {
    mockProfilesDb.get.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { darkMode: true },
    });
    mockProfilesDb.create.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }),
    );
    const res = await createTestApp().request('/?user_id=test-user');
    expect(res.status).toBe(200);
    expect((await res.json()).profile.preferences.darkMode).toBe(true);
  });

  test('GET / returns 500 on DynamoDB error', async () => {
    mockProfilesDb.get.mockRejectedValueOnce(new Error('DDB error'));
    const app = createTestApp();
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(500);
  });

  test('PUT /update updates profile successfully', async () => {
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      username: 'new-name',
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('PUT /update returns 403 when user_id does not match', async () => {
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'other-user', username: 'hacker' }),
    });
    expect(res.status).toBe(403);
  });

  test('PUT /update rejects unversioned and conflicting preference writes', async () => {
    const app = createTestApp();
    const request = (body: object) =>
      app.request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await request({ user_id: 'test-user', preferences: {} })).status).toBe(428);
    mockProfilesDb.update.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' }),
    );
    expect(
      (await request({ user_id: 'test-user', preferences: {}, expected_preferences_version: null }))
        .status,
    ).toBe(409);
  });

  test('POST /create creates a new profile', async () => {
    mockProfilesDb.get.mockResolvedValueOnce(null);
    mockProfilesDb.create.mockResolvedValueOnce(undefined);
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', email: 'test@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('POST /create returns success when profile already exists', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', username: 'existing' });
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('already exists');
  });

  test('POST /create updates username when profile exists without username', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', username: null });
    mockProfilesDb.claimUsername.mockResolvedValueOnce({ user_id: 'test-user' });
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-username' }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.claimUsername).toHaveBeenCalledTimes(1);
    expect(mockProfilesDb.claimUsername).toHaveBeenCalledWith('test-user', 'new-username');
  });

  test('POST /create applies the supplied username when a concurrent create wins', async () => {
    mockProfilesDb.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 'test-user', username: null });
    mockProfilesDb.create.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }),
    );
    mockProfilesDb.claimUsername.mockResolvedValueOnce({ user_id: 'test-user' });
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'oauth-name' }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.claimUsername).toHaveBeenCalledWith('test-user', 'oauth-name');
  });

  test('POST /create does not overwrite a username after a create conflict', async () => {
    mockProfilesDb.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 'test-user', username: 'taken-name' });
    mockProfilesDb.create.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }),
    );
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'oauth-name' }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.claimUsername).not.toHaveBeenCalled();
  });

  test('POST /create still succeeds when a concurrent write wins the username claim', async () => {
    mockProfilesDb.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 'test-user', username: null });
    mockProfilesDb.create.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }),
    );
    // The claim loses the interleaving — a username was set after the re-read.
    mockProfilesDb.claimUsername.mockResolvedValueOnce(null);
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'oauth-name' }),
    });
    expect(res.status).toBe(200);
  });

  test('POST /create still succeeds when the username claim loses on an existing profile', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', username: null });
    mockProfilesDb.claimUsername.mockResolvedValueOnce(null);
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'oauth-name' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('already exists');
  });

  test('POST /create returns 403 when user_id does not match', async () => {
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'other-user' }),
    });
    expect(res.status).toBe(403);
  });

  test('GET / normalizes out-of-range preference values to fallback', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: null,
      username: null,
      preferences: {
        dailyGoal: 9999,
        dailyLessonGoal: 0,
        lessonDurationMinutes: 200,
        todayStudyTime: -5,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { preferences: Record<string, number> } };
    expect(body.profile.preferences.dailyGoal).toBe(30);
    expect(body.profile.preferences.dailyLessonGoal).toBe(5);
    expect(body.profile.preferences.lessonDurationMinutes).toBe(6);
    expect(body.profile.preferences.todayStudyTime).toBe(0);
  });

  test('GET / returns 500 when stored preferences fail validation', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: null,
      username: null,
      preferences: { difficulty: 123 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid preferences');
  });

  test('PUT /update normalizes and persists valid preferences', async () => {
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { dailyGoal: 30 },
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { dailyGoal: 30 },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.update).toHaveBeenCalledWith(
      'test-user',
      expect.objectContaining({
        preferences: expect.objectContaining({ dailyGoal: 30 }),
      }),
      null,
    );
  });

  test('PUT /update returns the committed update when stored preferences fail sanitization', async () => {
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      username: 'new-name',
      preferences: { difficulty: 123 },
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      profile: { username: string };
    };
    expect(body.success).toBe(true);
    expect(body.profile.username).toBe('new-name');
  });

  test('PUT /update returns the committed update when stored preferences cannot be normalized', async () => {
    // Number({ toString: 0 }) throws a TypeError — a committed update must
    // still succeed even when a stored preference cannot be coerced.
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      username: 'new-name',
      preferences: { dailyGoal: { toString: 0 } },
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      profile: { username: string; preferences: { dailyGoal: number } };
    };
    expect(body.success).toBe(true);
    expect(body.profile.username).toBe('new-name');
    expect(body.profile.preferences.dailyGoal).toBe(30);
  });

  test('PUT /update returns 500 on DynamoDB update error', async () => {
    mockProfilesDb.update.mockRejectedValueOnce(new Error('DDB update failed'));
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DDB update failed');
  });

  test('POST /create returns 500 on DynamoDB create error', async () => {
    mockProfilesDb.get.mockResolvedValueOnce(null);
    mockProfilesDb.create.mockRejectedValueOnce(new Error('DDB create failed'));
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DDB create failed');
  });

  test('PUT→GET round-trips llm settings, darkMode, and learning preferences', async () => {
    const llm = {
      keys: {
        google: 'google-key',
        openai: 'openai-key',
        anthropic: 'anthropic-key',
        openrouter: 'openrouter-key',
      },
      thinking: { 'gemini-3.8-flash': 'high', 'claude-opus-5-5': 'xhigh' },
      defaultModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    };
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const putRes = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        preferences: { dailyGoal: 45, darkMode: true, llm },
      }),
    });
    expect(putRes.status).toBe(200);
    const persistedPreferences = mockProfilesDb.update.mock.calls[0][1].preferences;
    expect(persistedPreferences).toEqual(
      expect.objectContaining({ dailyGoal: 45, darkMode: true, llm }),
    );

    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: 'user@example.com',
      username: 'u1',
      avatar_url: null,
      native_language: 'en',
      current_level: 1,
      total_experience: 0,
      learning_streak: 0,
      preferences: persistedPreferences,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const getRes = await app.request('/?user_id=test-user');
    expect(getRes.status).toBe(200);
    const json = await getRes.json();
    expect(json.profile.preferences.llm).toEqual(llm);
    expect(json.profile.preferences.darkMode).toBe(true);
    expect(json.profile.preferences.dailyGoal).toBe(45);
    expect(mockProfilesDb.update).toHaveBeenCalledTimes(1);
  });

  test('PUT /update persists a partial provider key map', async () => {
    const llm = {
      keys: { openai: 'only-openai-key' },
      thinking: {},
      defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
    };
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      updated_at: new Date().toISOString(),
    });
    const app = createTestApp();
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        preferences: { llm },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.update).toHaveBeenCalledWith(
      'test-user',
      expect.objectContaining({
        preferences: expect.objectContaining({ llm }),
      }),
      null,
    );
  });

  test('PUT /update rejects malformed llm preferences with 400', async () => {
    const app = createTestApp();
    const invalidPreferences = [
      {
        llm: {
          keys: { google: 'k' },
          thinking: { 'model-x': 'ultra' },
          defaultModel: { provider: 'google', model: 'x' },
        },
      },
      {
        llm: {
          keys: { 'not-a-provider': 'k' },
          thinking: {},
          defaultModel: { provider: 'google', model: 'x' },
        },
      },
      { llm: { keys: {}, thinking: {} } },
      {
        llm: {
          keys: {},
          thinking: {},
          defaultModel: { provider: 'bogus', model: 'x' },
        },
      },
      { llm: 'not-an-object' },
      { darkMode: 'yes' },
    ];
    for (const preferences of invalidPreferences) {
      const res = await app.request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'test-user', preferences }),
      });
      expect(res.status).toBe(400);
    }
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('GET / drops a corrupted non-object llm subtree without failing', async () => {
    const app = createTestApp();
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: null,
      username: null,
      preferences: { dailyLessonGoal: 7, darkMode: true, llm: 'corrupted-llm' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.preferences.llm).toBeUndefined();
    expect(json.profile.preferences.dailyLessonGoal).toBe(7);
    expect(json.profile.preferences.darkMode).toBe(true);
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('GET / preserves valid keys and settings when stored llm contains invalid entries', async () => {
    const app = createTestApp();
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: null,
      username: null,
      preferences: {
        dailyLessonGoal: 7,
        darkMode: true,
        llm: {
          keys: { google: 'k', 'not-a-provider': 'bad' },
          thinking: { 'gemini-3.8-flash': 'high', 'bad-model': 'not-an-effort' },
          defaultModel: { provider: 'anthropic', model: '' },
        },
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.preferences.llm).toBeDefined();
    expect(json.profile.preferences.llm.keys).toEqual({ google: 'k' });
    expect(json.profile.preferences.llm.thinking).toEqual({ 'gemini-3.8-flash': 'high' });
    expect(json.profile.preferences.llm.defaultModel).toEqual({
      provider: 'anthropic',
      model: LLM_PROVIDER_REGISTRY.anthropic.defaultModel,
    });
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('bounds writes and sanitizes stored entries without losing valid keys', async () => {
    const app = createTestApp();
    const valid = {
      keys: { openai: 'valid' },
      thinking: { 'future-model': 'high' },
      defaultModel: { provider: 'openai', model: 'future-model' },
    };
    for (const llm of [
      { ...valid, keys: { openai: '' } },
      { ...valid, keys: { openai: 'x'.repeat(4097) } },
      { ...valid, thinking: { ['x'.repeat(513)]: 'high' } },
      { ...valid, defaultModel: { provider: 'openai', model: '' } },
    ]) {
      const response = await app.request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'test-user',
          expected_preferences_version: null,
          llm_write_contract: PREFERENCES_READ_CONTRACT,
          preferences: { llm },
        }),
      });
      expect(response.status).toBe(400);
    }
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: {
        llm: {
          ...valid,
          keys: { ...valid.keys, google: 'x'.repeat(4097) },
          thinking: { ...valid.thinking, ['x'.repeat(513)]: 'high' },
        },
      },
    });
    const read = await app.request('/?user_id=test-user');
    const cleaned = (await read.json()).profile.preferences.llm;
    expect(cleaned).toEqual(valid);
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const write = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        preferences: { llm: cleaned },
      }),
    });
    expect(write.status).toBe(200);
  });

  test('GET / sanitizes an unknown stored provider and an unrelated save keeps raw llm', async () => {
    const llm = {
      keys: { google: 'google-key', openai: 'keep-me' },
      thinking: { 'gemini-3.8-flash': 'high' },
      defaultModel: { provider: 'unknown', model: 'retired-model' },
    };
    mockProfilesDb.get.mockImplementation(() =>
      Promise.resolve(structuredClone({ user_id: 'test-user', preferences: { llm } })),
    );
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const app = createTestApp();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const read = await app.request('/?user_id=test-user');
      expect((await read.json()).profile.preferences.llm).toEqual({
        ...llm,
        defaultModel: { provider: 'google', model: LLM_PROVIDER_REGISTRY.google.defaultModel },
      });
      expect(mockProfilesDb.update).not.toHaveBeenCalled();
      const warned = warn.mock.calls.flat().join(' ');
      expect(warned).toContain('defaultModel');
      expect(warned).not.toContain('retired-model');
      expect(warned).not.toContain('google-key');
    } finally {
      warn.mockRestore();
    }
    const write = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { darkMode: true },
      }),
    });
    expect(write.status).toBe(200);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual(llm);
  });

  test('GET / substitutes the Google default pair when stored defaultModel is missing', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: {
        llm: {
          keys: { openai: 'openai-key' },
          thinking: { 'gpt-6.1-sol': 'low' },
        },
      },
    });
    const res = await createTestApp().request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const llm = (await res.json()).profile.preferences.llm;
    expect(llm.keys).toEqual({ openai: 'openai-key' });
    expect(llm.thinking).toEqual({ 'gpt-6.1-sol': 'low' });
    expect(llm.defaultModel).toEqual({
      provider: 'google',
      model: LLM_PROVIDER_REGISTRY.google.defaultModel,
    });
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('explicit llm PUT stores the replacement exactly as sent', async () => {
    const stored = {
      keys: { google: 'google-key', openai: 'openai-key' },
      thinking: { 'gemini-3.8-flash': 'high', 'gpt-6.1-sol': 'low' },
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    };
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { llm: stored },
    });
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const replacement = {
      keys: { openai: 'openai-key' },
      thinking: { 'gpt-6.1-sol': 'low' },
      defaultModel: stored.defaultModel,
    };
    const response = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        preferences: { llm: replacement },
      }),
    });
    expect(response.status).toBe(200);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual(replacement);
  });

  test('GET then explicit llm PUT deletes cleared entries without resurrecting stored values', async () => {
    const stored = {
      keys: { google: 'google-key', openai: 'openai-key' },
      thinking: { 'gemini-3.8-flash': 'high', 'gpt-6.1-sol': 'low' },
      defaultModel: { provider: 'retired-provider', model: 'retired-model' },
    };
    mockProfilesDb.get.mockImplementation(() =>
      Promise.resolve(structuredClone({ user_id: 'test-user', preferences: { llm: stored } })),
    );
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const app = createTestApp();
    const readLlm = (await (await app.request('/?user_id=test-user')).json()).profile.preferences
      .llm;
    const replacement = {
      keys: { openai: readLlm.keys.openai },
      thinking: { 'gpt-6.1-sol': readLlm.thinking['gpt-6.1-sol'] },
      defaultModel: readLlm.defaultModel,
    };
    const write = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        preferences: { llm: replacement },
      }),
    });
    expect(write.status).toBe(200);
    const persisted = mockProfilesDb.update.mock.calls[0][1].preferences.llm;
    expect(persisted).toEqual(replacement);
    expect(persisted.keys).toEqual({ openai: 'openai-key' });
    expect(persisted.thinking).toEqual({ 'gpt-6.1-sol': 'low' });
    expect(persisted.defaultModel).toEqual({
      provider: 'google',
      model: LLM_PROVIDER_REGISTRY.google.defaultModel,
    });
  });

  test('GET / advertises the read contract without persisting it', async () => {
    const stored = { dailyGoal: 45, llm: { keys: { google: 'saved' }, thinking: {} } };
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: structuredClone(stored),
    });
    const res = await createTestApp().request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.preferences_read_contract).toBe(PREFERENCES_READ_CONTRACT);
    expect(json.profile.preferences).not.toHaveProperty('preferences_read_contract');
    expect(json.profile.preferences.llm.keys).toEqual({ google: 'saved' });
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('PUT /update advertises the read contract on the sanitized response only', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', preferences: {} });
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { dailyGoal: 30, llm: { keys: { openai: 'k' }, thinking: {} } },
      // A stored response marker must be replaced, never echoed on trust.
      preferences_read_contract: 'stale-stored-marker',
    });
    const res = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        llm_write_contract: PREFERENCES_READ_CONTRACT,
        // A client echoing response metadata must not get it stored.
        preferences_read_contract: PREFERENCES_READ_CONTRACT,
        preferences: {
          preferences_read_contract: PREFERENCES_READ_CONTRACT,
          llm: {
            keys: { openai: 'k' },
            thinking: {},
            defaultModel: {
              provider: 'openai',
              model: 'gpt-6.1-sol',
            },
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.preferences_read_contract).toBe(PREFERENCES_READ_CONTRACT);
    // Neither marker is stored: the update payload only carries preferences.
    expect(mockProfilesDb.update.mock.calls[0][1]).not.toHaveProperty('llm_write_contract');
    expect(mockProfilesDb.update.mock.calls[0][1].preferences).not.toHaveProperty(
      'preferences_read_contract',
    );
    expect(mockProfilesDb.update.mock.calls[0][1].preferences).not.toHaveProperty(
      'llm_write_contract',
    );
  });

  test('PUT /update strips a stored read marker when sanitization fails', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', preferences: {} });
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { darkMode: true },
      preferences_read_contract: PREFERENCES_READ_CONTRACT,
    });
    const parseSpy = vi.spyOn(PreferencesReadSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: new Error('sanitization failed'),
    } as never);
    try {
      const res = await createTestApp().request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'test-user',
          expected_preferences_version: null,
          llm_write_contract: PREFERENCES_READ_CONTRACT,
          preferences: {
            llm: {
              keys: { google: 'k' },
              thinking: {},
              defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
            },
          },
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.profile).not.toHaveProperty('preferences_read_contract');
    } finally {
      parseSpy.mockRestore();
    }
  });

  test('PUT /update normalizes an uninitialized preferences profile and replaces stale read metadata', async () => {
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      username: 'stored-name',
      preferences_read_contract: 'stale-stored-marker',
    });
    const res = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.username).toBe('stored-name');
    expect(json.profile.preferences_read_contract).toBe(PREFERENCES_READ_CONTRACT);
    expect(json.profile.preferences).toEqual({
      dailyGoal: 30,
      dailyLessonGoal: 5,
      lessonDurationMinutes: 6,
      todayStudyTime: 0,
    });
  });

  test('PUT /update strips a stored read marker when sanitization fails', async () => {
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      username: 'stored-name',
      preferences: { difficulty: 123 },
      preferences_read_contract: PREFERENCES_READ_CONTRACT,
    });
    const res = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.username).toBe('stored-name');
    expect(json.profile).not.toHaveProperty('preferences_read_contract');
  });

  test('PUT /update omits the read contract when committed preferences cannot be sanitized', async () => {
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', preferences: {} });
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { llm: { keys: { google: 'k' }, thinking: {} } },
      preferences_read_contract: PREFERENCES_READ_CONTRACT,
    });
    const parseSpy = vi.spyOn(PreferencesReadSchema, 'safeParse').mockImplementationOnce(() => {
      throw new Error('sanitization failed');
    });
    try {
      const res = await createTestApp().request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'test-user',
          expected_preferences_version: null,
          llm_write_contract: PREFERENCES_READ_CONTRACT,
          preferences: {
            llm: {
              keys: { google: 'k' },
              thinking: {},
              defaultModel: {
                provider: 'google',
                model: 'gemini-3.8-flash',
              },
            },
          },
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.profile).not.toHaveProperty('preferences_read_contract');
    } finally {
      parseSpy.mockRestore();
    }
  });

  test('PUT /update refuses a changed llm replacement without the write marker', async () => {
    const app = createTestApp();
    const llm = {
      keys: { google: 'k' },
      thinking: {},
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    };
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: {
        llm: {
          keys: { google: 'old-k' },
          thinking: {},
          defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
        },
      },
    });
    for (const body of [
      // existing version: must not rely on the version CAS when llm changed
      {
        user_id: 'test-user',
        expected_preferences_version: crypto.randomUUID(),
        preferences: { llm },
      },
      // absent version: rejected before any storage read
      { user_id: 'test-user', preferences: { llm } },
    ]) {
      const res = await app.request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(428);
      expect(((await res.json()) as { error: string }).error).toContain('Reload');
    }
    expect(mockProfilesDb.get).toHaveBeenCalledTimes(1);
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('PUT /update ignores unchanged llm without the write marker so pre-deploy tabs can save other preferences', async () => {
    const rawLlm = {
      keys: { google: 'kept', openai: 'also-kept' },
      thinking: { 'gemini-4-argon': 'high' },
      defaultModel: { provider: 'retired-provider', model: 'retired-model' },
    };
    mockProfilesDb.get.mockImplementation(() =>
      Promise.resolve(
        structuredClone({
          user_id: 'test-user',
          preferences: { dailyGoal: 30, llm: rawLlm },
        }),
      ),
    );
    const app = createTestApp();
    const getRes = await app.request('/?user_id=test-user');
    const getLlm = (await getRes.json()).profile.preferences.llm;

    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { dailyGoal: 45, darkMode: true, llm: structuredClone(rawLlm) },
    });
    const res = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { dailyGoal: 45, darkMode: true, llm: getLlm },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.darkMode).toBe(true);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.dailyGoal).toBe(45);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual(rawLlm);
  });

  test('GET / and PUT /update omit the read contract when an unrecognized provider key was dropped', async () => {
    const stored = {
      llm: {
        keys: { google: 'g-key', 'future-provider': 'f-key' },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    };
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: structuredClone(stored),
    });
    const app = createTestApp();
    const getRes = await app.request('/?user_id=test-user');
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.profile.preferences.llm.keys).toEqual({ google: 'g-key' });
    expect(getJson.profile).not.toHaveProperty('preferences_read_contract');

    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: structuredClone(stored),
    });
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { darkMode: true, ...structuredClone(stored) },
    });
    const putRes = await app.request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { darkMode: true },
      }),
    });
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json();
    expect(putJson.profile).not.toHaveProperty('preferences_read_contract');
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual(stored.llm);
  });

  test('PUT /update rejects a malformed or unsupported write marker with 400', async () => {
    const app = createTestApp();
    const llm = {
      keys: {},
      thinking: {},
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    };
    for (const marker of ['complete-llm-v2', '', 1, null, true]) {
      const res = await app.request('/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'test-user',
          expected_preferences_version: null,
          llm_write_contract: marker,
          preferences: { llm },
        }),
      });
      expect(res.status).toBe(400);
    }
    expect(mockProfilesDb.update).not.toHaveBeenCalled();
  });

  test('PUT /update without llm needs no write marker and keeps the raw stored subtree', async () => {
    const rawLlm = {
      keys: { google: 'kept' },
      thinking: { 'gemini-4-argon': 'high' },
      defaultModel: { provider: 'retired-provider', model: 'retired-model' },
    };
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { llm: structuredClone(rawLlm) },
    });
    mockProfilesDb.update.mockResolvedValueOnce({
      user_id: 'test-user',
      preferences: { darkMode: true, llm: structuredClone(rawLlm) },
    });
    const res = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { darkMode: true },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual(rawLlm);
    expect(mockProfilesDb.update.mock.calls[0][1]).not.toHaveProperty('llm_write_contract');
  });

  test('GET / drops invalid darkMode values from stored profiles without 500', async () => {
    const app = createTestApp();
    mockProfilesDb.get.mockResolvedValueOnce({
      user_id: 'test-user',
      email: null,
      username: null,
      preferences: { dailyLessonGoal: 7, darkMode: 'invalid-string' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const res = await app.request('/?user_id=test-user');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.preferences.darkMode).toBeUndefined();
    expect(json.profile.preferences.dailyLessonGoal).toBe(7);
  });
});
