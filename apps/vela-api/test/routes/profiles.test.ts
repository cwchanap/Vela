import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';
import { profiles } from '../../src/routes/profiles';

const mockProfilesDb = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
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
    mockProfilesDb.update.mockResolvedValueOnce(undefined);
    const app = createTestApp();
    const res = await app.request('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', username: 'new-username' }),
    });
    expect(res.status).toBe(200);
    expect(mockProfilesDb.update).toHaveBeenCalledTimes(1);
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
});
