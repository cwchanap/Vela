import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import { LLM_PROVIDER_REGISTRY } from '@vela/common/contracts/llm';
import type { Env } from '../../src/types';
import { profiles } from '../../src/routes/profiles';

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
        preferences: { llm: cleaned },
      }),
    });
    expect(write.status).toBe(200);
  });

  test('preserves an unreadable llm subtree during an unrelated preference save', async () => {
    const llm = {
      keys: { openai: 'keep-me' },
      thinking: {},
      defaultModel: { provider: 'unknown', model: 'x' },
    };
    mockProfilesDb.get.mockImplementation(() =>
      Promise.resolve(structuredClone({ user_id: 'test-user', preferences: { llm } })),
    );
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const app = createTestApp();
    const read = await app.request('/?user_id=test-user');
    expect((await read.json()).profile.preferences.llm).toBeUndefined();
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

  test('retains valid saved keys when a new default repairs an unreadable llm subtree', async () => {
    const llm = {
      keys: { openai: 'keep-me' },
      thinking: { 'gpt-6.1-sol': 'high' },
      defaultModel: { provider: 'unknown', model: 'x' },
    };
    mockProfilesDb.get.mockResolvedValueOnce({ user_id: 'test-user', preferences: { llm } });
    mockProfilesDb.update.mockResolvedValueOnce({ user_id: 'test-user' });
    const replacement = {
      keys: {},
      thinking: {},
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    };
    const response = await createTestApp().request('/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'test-user',
        expected_preferences_version: null,
        preferences: { llm: replacement },
      }),
    });
    expect(response.status).toBe(200);
    expect(mockProfilesDb.update.mock.calls[0][1].preferences.llm).toEqual({
      ...replacement,
      keys: { openai: 'keep-me' },
      thinking: { 'gpt-6.1-sol': 'high' },
    });
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
