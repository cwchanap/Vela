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
});
