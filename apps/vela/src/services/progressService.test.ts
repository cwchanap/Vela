import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { progressService } from './progressService';
import type {
  ProgressAnalytics,
  Achievement,
  DailyProgress,
  SkillCategory,
  LearningStreak,
} from './progressService';

// Mock auth store
const mockAuthStore = {
  user: { id: 'user-123', email: 'test@example.com' },
};

vi.mock('src/stores/auth', () => ({
  useAuthStore: vi.fn(() => mockAuthStore),
}));

// Mock API utility
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('progressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockAuthStore.user = { id: 'user-123', email: 'test@example.com' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getProgressAnalytics', () => {
    const mockLearningStreak: LearningStreak = {
      current_streak: 5,
      longest_streak: 10,
      start_date: '2024-01-01T00:00:00Z',
      is_active: true,
    };

    const mockAchievements: Achievement[] = [
      {
        id: 'achievement-1',
        name: 'First Steps',
        description: 'Complete your first lesson',
        icon: 'trophy',
        category: 'learning',
        requirement_type: 'lessons_completed',
        requirement_value: 1,
        experience_reward: 100,
        earned_at: '2024-01-01T00:00:00Z',
      },
    ];

    const mockDailyProgress: DailyProgress[] = [
      {
        date: '2024-01-01',
        vocabulary_studied: 10,
        sentences_completed: 5,
        time_spent_minutes: 30,
        experience_gained: 150,
        games_played: 3,
        accuracy_percentage: 85,
      },
    ];

    const mockSkillCategories: SkillCategory[] = [
      {
        id: 'vocab',
        name: 'Vocabulary',
        description: 'Master Japanese vocabulary',
        icon: 'book',
        color: '#4CAF50',
        level: 5,
        experience: 450,
        experience_to_next_level: 550,
      },
    ];

    const mockProgressAnalytics: ProgressAnalytics = {
      totalExperience: 1500,
      experienceToNextLevel: 500,
      userStats: {
        wordsLearned: 50,
        sentencesCompleted: 25,
        averageAccuracy: 85,
        currentLevel: 5,
        totalExperience: 1500,
        learningStreak: mockLearningStreak,
        achievements: mockAchievements,
      },
      skillCategories: mockSkillCategories,
      dailyProgress: mockDailyProgress,
      weeklyProgress: [],
      monthlyProgress: [],
      currentLevel: 5,
      wordsLearned: 50,
      sentencesCompleted: 25,
      averageAccuracy: 85,
      totalTimeSpent: 300,
      learningStreak: mockLearningStreak,
      achievements: mockAchievements,
    };

    it('should fetch progress analytics successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProgressAnalytics),
      });

      const result = await progressService.getProgressAnalytics();

      expect(mockFetch).toHaveBeenCalledWith('/api/progress/analytics?user_id=user-123', {
        headers: {
          'content-type': 'application/json',
        },
      });
      expect(result).toEqual(mockProgressAnalytics);
    });

    it('should return default analytics when user is not logged in', async () => {
      mockAuthStore.user = null as any;

      const result = await progressService.getProgressAnalytics();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.totalExperience).toBe(0);
      expect(result.currentLevel).toBe(1);
      expect(result.experienceToNextLevel).toBe(100);
      expect(result.userStats.wordsLearned).toBe(0);
      expect(result.skillCategories).toEqual([]);
      expect(result.dailyProgress).toEqual([]);
    });

    it('should return default analytics when user ID is missing', async () => {
      mockAuthStore.user = { id: '', email: 'test@example.com' } as any;

      const result = await progressService.getProgressAnalytics();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.totalExperience).toBe(0);
      expect(result.currentLevel).toBe(1);
    });

    it('should return default analytics on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await progressService.getProgressAnalytics();

      expect(result.totalExperience).toBe(0);
      expect(result.currentLevel).toBe(1);
      expect(result.experienceToNextLevel).toBe(100);
    });

    it('should return default analytics when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      });

      const result = await progressService.getProgressAnalytics();

      expect(result.totalExperience).toBe(0);
      expect(result.currentLevel).toBe(1);
    });

    it('should include user_id in query parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProgressAnalytics),
      });

      await progressService.getProgressAnalytics();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user_id=user-123'),
        expect.any(Object),
      );
    });

    it('should return default learning streak when not logged in', async () => {
      mockAuthStore.user = null as any;

      const result = await progressService.getProgressAnalytics();

      expect(result.learningStreak.current_streak).toBe(0);
      expect(result.learningStreak.longest_streak).toBe(0);
      expect(result.learningStreak.is_active).toBe(false);
      expect(result.learningStreak.start_date).toBeDefined();
    });

    it('should return empty achievements array when not logged in', async () => {
      mockAuthStore.user = null as any;

      const result = await progressService.getProgressAnalytics();

      expect(result.achievements).toEqual([]);
      expect(result.userStats.achievements).toEqual([]);
    });

    it('should handle API error without JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      });

      const result = await progressService.getProgressAnalytics();

      expect(result.totalExperience).toBe(0);
      expect(result.currentLevel).toBe(1);
    });
  });

  describe('recordGameSession', () => {
    const gameSessionData = {
      gameType: 'vocabulary',
      score: 85,
      durationSeconds: 120,
      questionsAnswered: 10,
      correctAnswers: 8,
      experienceGained: 150,
    };

    it('should record game session successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(mockFetch).toHaveBeenCalledWith('/api/progress/game-session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 'user-123',
          game_type: 'vocabulary',
          score: 85,
          duration_seconds: 120,
          questions_answered: 10,
          correct_answers: 8,
          experience_gained: 150,
        }),
      });
    });

    it('should not record game session when user is not logged in', async () => {
      mockAuthStore.user = null as any;

      await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not record game session when user ID is missing', async () => {
      mockAuthStore.user = { id: '', email: 'test@example.com' } as any;

      await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(
        progressService.recordGameSession(
          gameSessionData.gameType,
          gameSessionData.score,
          gameSessionData.durationSeconds,
          gameSessionData.questionsAnswered,
          gameSessionData.correctAnswers,
          gameSessionData.experienceGained,
        ),
      ).resolves.toBeUndefined();
    });

    it('should handle API error status gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid data' }),
      });

      // Should not throw
      await expect(
        progressService.recordGameSession(
          gameSessionData.gameType,
          gameSessionData.score,
          gameSessionData.durationSeconds,
          gameSessionData.questionsAnswered,
          gameSessionData.correctAnswers,
          gameSessionData.experienceGained,
        ),
      ).resolves.toBeUndefined();
    });

    it('should use POST method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should include content-type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        }),
      );
    });

    it('should record sentence game session', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession('sentence', 90, 180, 5, 5, 200);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/progress/game-session',
        expect.objectContaining({
          body: expect.stringContaining('"game_type":"sentence"'),
        }),
      );
    });

    it('should handle zero score', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession('vocabulary', 0, 60, 10, 0, 0);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/progress/game-session',
        expect.objectContaining({
          body: expect.stringContaining('"score":0'),
        }),
      );
    });

    it('should handle perfect score', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession('vocabulary', 100, 90, 10, 10, 300);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/progress/game-session',
        expect.objectContaining({
          body: expect.stringContaining('"score":100'),
        }),
      );
    });

    it('should not return any value', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      const result = await progressService.recordGameSession(
        gameSessionData.gameType,
        gameSessionData.score,
        gameSessionData.durationSeconds,
        gameSessionData.questionsAnswered,
        gameSessionData.correctAnswers,
        gameSessionData.experienceGained,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('httpJson utility', () => {
    it('should include content-type header in requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: {} }),
      });

      await progressService.getProgressAnalytics();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        }),
      );
    });

    it('should merge additional headers with content-type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await progressService.recordGameSession('vocabulary', 85, 120, 10, 8, 150);

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall?.[1]?.headers;

      expect(headers).toMatchObject({
        'content-type': 'application/json',
      });
    });
  });
});
