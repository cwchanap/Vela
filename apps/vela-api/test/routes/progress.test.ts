import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';
import type { Context, Next } from 'hono';

const mockProfilesDB = {
  get: vi.fn(),
  update: vi.fn(),
};

const mockGameSessionsDB = {
  create: vi.fn(),
};

const mockDailyProgressDB = {
  getByUserAndDate: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  profiles: mockProfilesDB,
  gameSessions: mockGameSessionsDB,
  dailyProgress: mockDailyProgressDB,
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: Context, next: Next) => {
    _c.set('userId', 'test-user');
    _c.set('userEmail', 'user@example.com');
    await next();
  },
  AuthContext: {},
}));

// Import AFTER mocks are declared
const { progress } = await import('../../src/routes/progress');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', progress);
  return app;
}

describe('Progress Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /analytics', () => {
    test('returns analytics for authenticated user', async () => {
      mockProfilesDB.get.mockResolvedValueOnce({
        user_id: 'test-user',
        total_experience: 500,
        current_level: 3,
        learning_streak: 7,
        last_activity: '2026-01-01T00:00:00.000Z',
      });

      const app = createTestApp();
      const res = await app.request('/analytics?user_id=test-user');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalExperience: number;
        currentLevel: number;
        learningStreak: { current_streak: number };
      };
      expect(body.totalExperience).toBe(500);
      expect(body.currentLevel).toBe(3);
      expect(body.learningStreak.current_streak).toBe(7);
    });

    test('returns 403 when user_id does not match authenticated user', async () => {
      const app = createTestApp();
      const res = await app.request('/analytics?user_id=other-user');
      expect(res.status).toBe(403);
    });

    test('returns 404 when profile not found', async () => {
      mockProfilesDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/analytics?user_id=test-user');
      expect(res.status).toBe(404);
    });

    test('returns 500 on database error', async () => {
      mockProfilesDB.get.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/analytics?user_id=test-user');
      expect(res.status).toBe(500);
    });

    test('returns default values when profile fields are missing', async () => {
      mockProfilesDB.get.mockResolvedValueOnce({
        user_id: 'test-user',
      });

      const app = createTestApp();
      const res = await app.request('/analytics?user_id=test-user');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totalExperience: number; currentLevel: number };
      expect(body.totalExperience).toBe(0);
      expect(body.currentLevel).toBe(1);
    });
  });

  describe('POST /game-session', () => {
    const validSession = {
      user_id: 'test-user',
      game_type: 'vocabulary',
      score: 80,
      duration_seconds: 120,
      questions_answered: 10,
      correct_answers: 8,
      experience_gained: 50,
    };

    test('records game session and returns success', async () => {
      mockGameSessionsDB.create.mockResolvedValueOnce(undefined);
      mockDailyProgressDB.getByUserAndDate.mockResolvedValueOnce(null);
      mockDailyProgressDB.create.mockResolvedValueOnce(undefined);
      mockProfilesDB.get.mockResolvedValueOnce({
        user_id: 'test-user',
        total_experience: 100,
      });
      mockProfilesDB.update.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSession),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockGameSessionsDB.create).toHaveBeenCalledTimes(1);
    });

    test('returns 403 when user_id does not match authenticated user', async () => {
      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validSession, user_id: 'other-user' }),
      });
      expect(res.status).toBe(403);
    });

    test('updates existing daily progress', async () => {
      mockGameSessionsDB.create.mockResolvedValueOnce(undefined);
      mockDailyProgressDB.getByUserAndDate.mockResolvedValueOnce({
        user_id: 'test-user',
        date: '2026-01-01',
        vocabulary_studied: 5,
        sentences_completed: 0,
        time_spent_minutes: 10,
        experience_gained: 30,
        games_played: 2,
        accuracy_percentage: 70,
      });
      mockDailyProgressDB.update.mockResolvedValueOnce(undefined);
      mockProfilesDB.get.mockResolvedValueOnce({
        user_id: 'test-user',
        total_experience: 100,
      });
      mockProfilesDB.update.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSession),
      });
      expect(res.status).toBe(200);
      expect(mockDailyProgressDB.update).toHaveBeenCalledTimes(1);
      expect(mockDailyProgressDB.create).not.toHaveBeenCalled();
    });

    test('creates new daily progress when none exists', async () => {
      mockGameSessionsDB.create.mockResolvedValueOnce(undefined);
      mockDailyProgressDB.getByUserAndDate.mockResolvedValueOnce(null);
      mockDailyProgressDB.create.mockResolvedValueOnce(undefined);
      mockProfilesDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSession),
      });
      expect(res.status).toBe(200);
      expect(mockDailyProgressDB.create).toHaveBeenCalledTimes(1);
    });

    test('handles sentence game type for daily progress', async () => {
      mockGameSessionsDB.create.mockResolvedValueOnce(undefined);
      mockDailyProgressDB.getByUserAndDate.mockResolvedValueOnce(null);
      mockDailyProgressDB.create.mockResolvedValueOnce(undefined);
      mockProfilesDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validSession, game_type: 'sentence' }),
      });
      expect(res.status).toBe(200);
      const createCall = mockDailyProgressDB.create.mock.calls[0][0];
      expect(createCall.sentences_completed).toBe(10);
      expect(createCall.vocabulary_studied).toBe(0);
    });

    test('returns 400 for missing required fields', async () => {
      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'test-user' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 500 on database error', async () => {
      mockGameSessionsDB.create.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/game-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSession),
      });
      expect(res.status).toBe(500);
    });
  });
});
