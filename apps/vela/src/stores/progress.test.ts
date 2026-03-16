import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockProgressService = {
  getProgressAnalytics: vi.fn(),
  recordGameSession: vi.fn(),
};

vi.mock('../services/progressService', () => ({
  progressService: mockProgressService,
}));

const mockQueryClient = {
  getQueryState: vi.fn(() => null),
  getQueryData: vi.fn(() => null),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
};

vi.mock('../boot/query', () => ({
  queryClient: mockQueryClient,
  QUERY_STALE_TIME: 300000,
}));

vi.mock('@vela/common', () => ({
  progressKeys: {
    analytics: (id: string | null) => ['progress', 'analytics', id],
    all: ['progress'],
  },
}));

const mockAuthStore = {
  user: null as null | { id: string; preferences?: Record<string, unknown> },
};

vi.mock('./auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

const mockAnalytics = {
  wordsLearned: 50,
  currentLevel: 3,
  totalExperience: 250,
  experienceToNextLevel: 300,
  learningStreak: { current_streak: 5 },
  achievements: [
    {
      id: 'a1',
      name: 'First Steps',
      description: 'Learn your first word',
      icon: '🌱',
      category: 'beginner',
      requirement_type: 'words',
      requirement_value: 1,
      experience_reward: 10,
      earned_at: '2024-01-01',
    },
  ],
  skillCategories: [
    {
      id: 'sc1',
      name: 'Vocabulary',
      description: 'Word knowledge',
      icon: '📚',
      color: 'blue',
      level: 2,
      experience: 150,
      experience_to_next_level: 200,
    },
  ],
  dailyProgress: [
    {
      date: '2024-01-07',
      vocabulary_studied: 5,
      sentences_completed: 3,
      time_spent_minutes: 10,
      experience_gained: 50,
      games_played: 2,
      accuracy_percentage: 80,
    },
    {
      date: '2024-01-06',
      vocabulary_studied: 3,
      sentences_completed: 2,
      time_spent_minutes: 8,
      experience_gained: 30,
      games_played: 1,
      accuracy_percentage: 70,
    },
  ],
  weeklyProgress: [
    {
      date: '2024-01-07',
      vocabulary_studied: 35,
      sentences_completed: 20,
      time_spent_minutes: 70,
      experience_gained: 350,
      games_played: 14,
      accuracy_percentage: 75,
    },
  ],
  monthlyProgress: [
    {
      date: '2024-01',
      vocabulary_studied: 120,
      sentences_completed: 80,
      time_spent_minutes: 240,
      experience_gained: 1200,
      games_played: 48,
      accuracy_percentage: 78,
    },
  ],
};

describe('useProgressStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAuthStore.user = null;
    mockQueryClient.getQueryState.mockReturnValue(null);
    mockQueryClient.getQueryData.mockReturnValue(null);
  });

  describe('initial state', () => {
    it('has correct defaults', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.userProgress).toEqual([]);
      expect(store.learningStats.totalWordsLearned).toBe(0);
      expect(store.learningStats.currentStreak).toBe(0);
      expect(store.learningStats.level).toBe(1);
      expect(store.analytics).toBeNull();
      expect(store.achievements).toEqual([]);
      expect(store.skillCategories).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.newAchievements).toEqual([]);
    });
  });

  describe('computed: masteredWords', () => {
    it('counts words with mastery_level >= 5', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setUserProgress([
        {
          vocabulary_id: 'v1',
          mastery_level: 5,
          correct_attempts: 10,
          total_attempts: 10,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
        {
          vocabulary_id: 'v2',
          mastery_level: 3,
          correct_attempts: 6,
          total_attempts: 8,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
        {
          vocabulary_id: 'v3',
          mastery_level: 5,
          correct_attempts: 9,
          total_attempts: 10,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
      ]);
      expect(store.masteredWords).toBe(2);
    });

    it('returns 0 when no progress', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.masteredWords).toBe(0);
    });
  });

  describe('computed: wordsInProgress', () => {
    it('counts words with mastery_level between 1 and 4', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setUserProgress([
        {
          vocabulary_id: 'v1',
          mastery_level: 0,
          correct_attempts: 0,
          total_attempts: 1,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
        {
          vocabulary_id: 'v2',
          mastery_level: 2,
          correct_attempts: 4,
          total_attempts: 6,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
        {
          vocabulary_id: 'v3',
          mastery_level: 5,
          correct_attempts: 9,
          total_attempts: 10,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
      ]);
      expect(store.wordsInProgress).toBe(1);
    });
  });

  describe('computed: averageAccuracy', () => {
    it('returns 0 when no progress', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.averageAccuracy).toBe(0);
    });

    it('calculates average correctly', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setUserProgress([
        {
          vocabulary_id: 'v1',
          mastery_level: 3,
          correct_attempts: 8,
          total_attempts: 10,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
        {
          vocabulary_id: 'v2',
          mastery_level: 2,
          correct_attempts: 6,
          total_attempts: 10,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
      ]);
      // (80% + 60%) / 2 = 70%
      expect(store.averageAccuracy).toBe(70);
    });

    it('handles words with no attempts', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setUserProgress([
        {
          vocabulary_id: 'v1',
          mastery_level: 0,
          correct_attempts: 0,
          total_attempts: 0,
          last_reviewed: new Date(),
          next_review: new Date(),
        },
      ]);
      expect(store.averageAccuracy).toBe(0);
    });
  });

  describe('computed: weeklyGoalProgress', () => {
    it('calculates percentage of weekly goal', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setLearningStats({ weeklyProgress: 25, weeklyGoal: 50 });
      expect(store.weeklyGoalProgress).toBe(50);
    });

    it('caps at 100%', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setLearningStats({ weeklyProgress: 100, weeklyGoal: 50 });
      expect(store.weeklyGoalProgress).toBe(100);
    });
  });

  describe('computed: currentLevelProgress', () => {
    it('returns 0 when no analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.currentLevelProgress).toBe(0);
    });

    it('calculates level progress correctly', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      // Set analytics directly
      store.analytics = {
        ...mockAnalytics,
        currentLevel: 2,
        totalExperience: 150,
      } as any;
      // level 2: (150 - 100) / (200 - 100) * 100 = 50%
      expect(store.currentLevelProgress).toBe(50);
    });
  });

  describe('computed: dailyProgressChart', () => {
    it('returns empty array when no analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.dailyProgressChart).toEqual([]);
    });

    it('returns up to 7 days reversed', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.analytics = mockAnalytics as any;
      const chart = store.dailyProgressChart;
      expect(chart.length).toBe(2);
      expect(chart[0]).toHaveProperty('experience');
      expect(chart[0]).toHaveProperty('vocabulary');
      expect(chart[0]).toHaveProperty('sentences');
      expect(chart[0]).toHaveProperty('accuracy');
    });
  });

  describe('computed: weeklyProgressChart', () => {
    it('returns empty array when no analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.weeklyProgressChart).toEqual([]);
    });

    it('maps weekly progress data correctly', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.analytics = mockAnalytics as any;
      const chart = store.weeklyProgressChart;
      expect(chart.length).toBe(1);
      expect(chart[0]).toHaveProperty('experience', 350);
    });
  });

  describe('computed: monthlyProgressChart', () => {
    it('returns empty array when no analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.monthlyProgressChart).toEqual([]);
    });

    it('maps monthly progress data correctly', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.analytics = mockAnalytics as any;
      const chart = store.monthlyProgressChart;
      expect(chart.length).toBe(1);
      expect(chart[0]).toHaveProperty('experience', 1200);
    });
  });

  describe('computed: recentAchievements', () => {
    it('returns empty when no achievements', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.recentAchievements).toEqual([]);
    });

    it('returns only earned achievements sorted by date', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.achievements = [
        {
          id: 'a1',
          name: 'First',
          description: '',
          icon: '',
          category: '',
          requirement_type: '',
          requirement_value: 0,
          experience_reward: 10,
          earned_at: '2024-01-01',
        },
        {
          id: 'a2',
          name: 'Second',
          description: '',
          icon: '',
          category: '',
          requirement_type: '',
          requirement_value: 0,
          experience_reward: 20,
        },
        {
          id: 'a3',
          name: 'Third',
          description: '',
          icon: '',
          category: '',
          requirement_type: '',
          requirement_value: 0,
          experience_reward: 30,
          earned_at: '2024-01-03',
        },
      ] as any;
      const recent = store.recentAchievements;
      expect(recent.length).toBe(2);
      // Most recent first
      expect(recent[0].id).toBe('a3');
      expect(recent[1].id).toBe('a1');
    });
  });

  describe('updateProgress', () => {
    it('creates new progress entry for new vocabulary', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateProgress('vocab-1', true);
      expect(store.userProgress).toHaveLength(1);
      expect(store.userProgress[0].vocabulary_id).toBe('vocab-1');
      expect(store.userProgress[0].mastery_level).toBe(1);
      expect(store.userProgress[0].correct_attempts).toBe(1);
      expect(store.userProgress[0].total_attempts).toBe(1);
    });

    it('creates new entry with mastery_level 0 for wrong answer', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateProgress('vocab-1', false);
      expect(store.userProgress[0].mastery_level).toBe(0);
      expect(store.userProgress[0].correct_attempts).toBe(0);
    });

    it('updates existing progress entry on correct answer', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateProgress('vocab-1', true);
      store.updateProgress('vocab-1', true);
      expect(store.userProgress).toHaveLength(1);
      expect(store.userProgress[0].mastery_level).toBe(2);
      expect(store.userProgress[0].correct_attempts).toBe(2);
      expect(store.userProgress[0].total_attempts).toBe(2);
    });

    it('decrements mastery on wrong answer', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateProgress('vocab-1', true);
      store.updateProgress('vocab-1', true); // mastery = 2
      store.updateProgress('vocab-1', false); // mastery = 1
      expect(store.userProgress[0].mastery_level).toBe(1);
      expect(store.userProgress[0].total_attempts).toBe(3);
      expect(store.userProgress[0].correct_attempts).toBe(2);
    });

    it('caps mastery_level at 5', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      for (let i = 0; i < 10; i++) {
        store.updateProgress('vocab-1', true);
      }
      expect(store.userProgress[0].mastery_level).toBe(5);
    });

    it('does not go below 0 mastery', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateProgress('vocab-1', false);
      store.updateProgress('vocab-1', false);
      expect(store.userProgress[0].mastery_level).toBe(0);
    });
  });

  describe('addExperience', () => {
    it('adds experience points', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.addExperience(50);
      expect(store.learningStats.experience).toBe(50);
    });

    it('levels up when experience reaches threshold', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.addExperience(100); // Level 1 threshold = 100
      expect(store.learningStats.level).toBe(2);
      expect(store.learningStats.experience).toBe(0);
      expect(store.learningStats.experienceToNextLevel).toBe(200);
    });

    it('handles multiple level ups', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.addExperience(300); // Level 1 (100) + Level 2 (200) = 300
      expect(store.learningStats.level).toBe(3);
    });
  });

  describe('updateWeeklyProgress', () => {
    it('increments by 1 by default', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateWeeklyProgress();
      expect(store.learningStats.weeklyProgress).toBe(1);
    });

    it('increments by given amount', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.updateWeeklyProgress(5);
      expect(store.learningStats.weeklyProgress).toBe(5);
    });
  });

  describe('setLearningStats', () => {
    it('merges stats', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.setLearningStats({ currentStreak: 7, level: 5 });
      expect(store.learningStats.currentStreak).toBe(7);
      expect(store.learningStats.level).toBe(5);
      expect(store.learningStats.weeklyGoal).toBe(50); // unchanged
    });
  });

  describe('calculateExperienceGained', () => {
    it('calculates base exp from correct answers', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      const exp = store.calculateExperienceGained(80, 8, 10);
      expect(exp).toBe(8 * 10 + Math.floor((8 / 10) * 50)); // 80 + 40 = 120
    });

    it('adds perfect bonus when all correct', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      const exp = store.calculateExperienceGained(100, 10, 10);
      expect(exp).toBe(10 * 10 + 50 + 25); // 100 + 50 + 25 = 175
    });

    it('returns 0 for 0 correct answers', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      const exp = store.calculateExperienceGained(0, 0, 10);
      expect(exp).toBe(0);
    });

    it('handles zero totalQuestions without error', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      const exp = store.calculateExperienceGained(0, 0, 0);
      expect(exp).toBe(0);
    });
  });

  describe('dismissNewAchievements', () => {
    it('clears new achievements', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.newAchievements = [{ id: 'a1' }] as any;
      store.dismissNewAchievements();
      expect(store.newAchievements).toEqual([]);
    });
  });

  describe('getSkillCategoryProgress', () => {
    it('returns null when no skill categories', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.getSkillCategoryProgress('Vocabulary')).toBeNull();
    });

    it('returns matching skill category', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.skillCategories = mockAnalytics.skillCategories as any;
      const result = store.getSkillCategoryProgress('Vocabulary');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('sc1');
    });

    it('returns null for unknown category', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.skillCategories = mockAnalytics.skillCategories as any;
      expect(store.getSkillCategoryProgress('Grammar')).toBeNull();
    });
  });

  describe('getTodayProgress', () => {
    it('returns null when no analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      expect(store.getTodayProgress()).toBeNull();
    });

    it('returns today entry if present', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      const today = new Date().toISOString().split('T')[0]!;
      store.analytics = {
        ...mockAnalytics,
        dailyProgress: [
          {
            date: today,
            vocabulary_studied: 5,
            sentences_completed: 3,
            time_spent_minutes: 10,
            experience_gained: 50,
            games_played: 2,
            accuracy_percentage: 80,
          },
        ],
      } as any;
      const result = store.getTodayProgress();
      expect(result).not.toBeNull();
      expect(result?.date).toBe(today);
    });

    it('returns null if today is not in daily progress', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      store.analytics = mockAnalytics as any;
      expect(store.getTodayProgress()).toBeNull();
    });
  });

  describe('loadProgressAnalytics', () => {
    it('loads analytics and updates state', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockProgressService.getProgressAnalytics.mockResolvedValue(mockAnalytics);

      await store.loadProgressAnalytics('user-1');

      expect(store.analytics).toEqual(mockAnalytics);
      expect(store.achievements).toHaveLength(1);
      expect(store.skillCategories).toHaveLength(1);
      expect(store.learningStats.totalWordsLearned).toBe(50);
      expect(store.learningStats.currentStreak).toBe(5);
      expect(store.learningStats.level).toBe(3);
      expect(store.isLoading).toBe(false);
    });

    it('uses auth store user if no userId provided', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockAuthStore.user = { id: 'auth-user-1' };
      mockProgressService.getProgressAnalytics.mockResolvedValue(mockAnalytics);

      await store.loadProgressAnalytics(null);

      expect(mockProgressService.getProgressAnalytics).toHaveBeenCalled();
      expect(store.analytics).toEqual(mockAnalytics);
    });

    it('uses cached data when fresh', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockQueryClient.getQueryState.mockReturnValue({
        isInvalidated: false,
        dataUpdatedAt: Date.now(),
        data: mockAnalytics,
      });
      mockQueryClient.getQueryData.mockReturnValue(mockAnalytics);

      await store.loadProgressAnalytics('user-1');

      expect(mockProgressService.getProgressAnalytics).not.toHaveBeenCalled();
      expect(store.analytics).toEqual(mockAnalytics);
    });

    it('handles service error gracefully', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockProgressService.getProgressAnalytics.mockRejectedValue(new Error('Network error'));

      await store.loadProgressAnalytics('user-1');

      expect(store.analytics).toBeNull();
      expect(store.isLoading).toBe(false);
    });
  });

  describe('recordGameSession', () => {
    it('records session and reloads analytics', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockProgressService.recordGameSession.mockResolvedValue({});
      mockProgressService.getProgressAnalytics.mockResolvedValue(mockAnalytics);

      await store.recordGameSession('vocabulary', 80, 120, 10, 8, 'user-1');

      expect(mockProgressService.recordGameSession).toHaveBeenCalledWith(
        'vocabulary',
        80,
        120,
        10,
        8,
        expect.any(Number),
      );
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
    });

    it('handles error gracefully', async () => {
      const { useProgressStore } = await import('./progress');
      const store = useProgressStore();
      mockProgressService.recordGameSession.mockRejectedValue(new Error('API error'));

      await expect(store.recordGameSession('vocabulary', 80, 120, 10, 8)).resolves.not.toThrow();
    });
  });
});
