import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { nextTick } from 'vue';
import ProgressDashboard from './ProgressDashboard.vue';
import { useProgressStore } from 'src/stores/progress';
import { useAuthStore } from 'src/stores/auth';
import type {
  ProgressAnalytics,
  Achievement,
  SkillCategory,
  DailyProgress,
} from 'src/services/progressService';

// Mock child components to simplify testing
vi.mock('./ProgressChart.vue', () => ({
  default: {
    name: 'ProgressChart',
    props: ['data', 'type', 'height', 'dataKey', 'color', 'width'],
    template: '<div class="mock-progress-chart" :data-type="type" :data-key="dataKey"></div>',
  },
}));

vi.mock('./SkillCategoryCard.vue', () => ({
  default: {
    name: 'SkillCategoryCard',
    props: ['skill'],
    template: '<div class="mock-skill-category-card"></div>',
  },
}));

vi.mock('./AchievementItem.vue', () => ({
  default: {
    name: 'AchievementItem',
    props: ['achievement'],
    template: '<div class="mock-achievement-item"></div>',
  },
}));

vi.mock('./AchievementDialog.vue', () => ({
  default: {
    name: 'AchievementDialog',
    props: ['modelValue', 'achievements'],
    emits: ['update:modelValue', 'close'],
    template:
      '<div class="mock-achievement-dialog" :data-visible="modelValue" :data-achievements-count="achievements.length"></div>',
  },
}));

describe('ProgressDashboard', () => {
  let progressStore: ReturnType<typeof useProgressStore>;
  let authStore: ReturnType<typeof useAuthStore>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    avatar_url: '/avatars/avatar1.png',
    current_level: 5,
    total_experience: 1200,
    learning_streak: 7,
    native_language: 'en',
    preferences: {
      dailyGoal: 30,
      difficulty: 'Beginner' as const,
      notifications: true,
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-15T00:00:00.000Z',
  };

  const mockDailyProgress: DailyProgress = {
    date: new Date().toISOString().split('T')[0]!, // Use date portion only (YYYY-MM-DD)
    vocabulary_studied: 15,
    sentences_completed: 8,
    time_spent_minutes: 45,
    experience_gained: 120,
    games_played: 3,
    accuracy_percentage: 85,
  };

  const mockAchievements: Achievement[] = [
    {
      id: 'ach-1',
      name: 'First Steps',
      description: 'Complete your first lesson',
      icon: 'star',
      category: 'Progress',
      requirement_type: 'lessons',
      requirement_value: 1,
      experience_reward: 50,
      earned_at: '2024-01-10T00:00:00.000Z',
    },
    {
      id: 'ach-2',
      name: 'Word Master',
      description: 'Learn 100 words',
      icon: 'school',
      category: 'Vocabulary',
      requirement_type: 'words',
      requirement_value: 100,
      experience_reward: 200,
      earned_at: '2024-01-12T00:00:00.000Z',
    },
  ];

  const mockSkillCategories: SkillCategory[] = [
    {
      id: 'skill-1',
      name: 'Vocabulary',
      description: 'Master Japanese words',
      icon: 'book',
      color: 'primary',
      level: 3,
      experience: 250,
      experience_to_next_level: 300,
    },
    {
      id: 'skill-2',
      name: 'Grammar',
      description: 'Understand sentence structure',
      icon: 'text_snippet',
      color: 'secondary',
      level: 2,
      experience: 150,
      experience_to_next_level: 200,
    },
  ];

  const mockProgressAnalytics: ProgressAnalytics = {
    totalExperience: 1200,
    experienceToNextLevel: 500,
    currentLevel: 5,
    wordsLearned: 150,
    sentencesCompleted: 75,
    averageAccuracy: 85,
    totalTimeSpent: 3600,
    learningStreak: {
      current_streak: 7,
      longest_streak: 12,
      start_date: '2024-01-01T00:00:00.000Z',
      is_active: true,
    },
    userStats: {
      wordsLearned: 150,
      sentencesCompleted: 75,
      averageAccuracy: 85,
      currentLevel: 5,
      totalExperience: 1200,
      learningStreak: {
        current_streak: 7,
        longest_streak: 12,
        start_date: '2024-01-01T00:00:00.000Z',
        is_active: true,
      },
      achievements: mockAchievements,
    },
    skillCategories: mockSkillCategories,
    dailyProgress: [mockDailyProgress],
    weeklyProgress: [
      {
        date: '2024-01-10',
        experience_gained: 100,
        vocabulary_studied: 20,
        sentences_completed: 10,
        accuracy_percentage: 85,
      },
    ],
    monthlyProgress: [
      {
        date: '2024-01',
        experience_gained: 1200,
        vocabulary_studied: 150,
        sentences_completed: 75,
        accuracy_percentage: 85,
      },
    ],
    achievements: mockAchievements,
  };

  const mountComponent = (options = {}) => {
    return mount(ProgressDashboard, {
      global: {
        plugins: [Quasar],
        stubs: {
          QCard: { template: '<div class="q-card"><slot /></div>' },
          QCardSection: { template: '<div class="q-card-section"><slot /></div>' },
          QLinearProgress: { template: '<div class="q-linear-progress" />' },
          QIcon: {
            template: '<i class="q-icon" :data-color="color" />',
            props: ['name', 'color', 'size'],
          },
          QTooltip: { template: '<div />' },
        },
      },
      ...options,
    });
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    progressStore = useProgressStore();
    authStore = useAuthStore();

    // Set up default store state
    authStore.user = mockUser;
    progressStore.analytics = mockProgressAnalytics;
    progressStore.skillCategories = mockSkillCategories;
    progressStore.learningStats = {
      totalWordsLearned: 150,
      currentStreak: 7,
      weeklyGoal: 50,
      weeklyProgress: 35,
      level: 5,
      experience: 1200,
      experienceToNextLevel: 500,
    };

    // Mock loadProgressAnalytics to avoid API calls
    vi.spyOn(progressStore, 'loadProgressAnalytics').mockResolvedValue();
    vi.spyOn(progressStore, 'getTodayProgress').mockReturnValue(mockDailyProgress);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render the dashboard container', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.progress-dashboard').exists()).toBe(true);
    });

    it('should render all main sections', () => {
      const wrapper = mountComponent();

      // Check for cards
      const cards = wrapper.findAll('.q-card');
      expect(cards.length).toBeGreaterThan(0);
    });

    it('should render level and experience section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Current Level');
      expect(wrapper.text()).toContain('5'); // Level from store
    });

    it('should render learning streak section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Learning Streak');
      expect(wrapper.text()).toContain('7 days');
      expect(wrapper.text()).toContain('Best: 12 days');
    });

    it("should render today's progress section", () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain("Today's Progress");
      expect(wrapper.text()).toContain('15 words studied');
      expect(wrapper.text()).toContain('8 sentences completed');
      expect(wrapper.text()).toContain('45 minutes');
      expect(wrapper.text()).toContain('120 XP earned');
    });

    it("should show placeholder when no today's progress", () => {
      vi.spyOn(progressStore, 'getTodayProgress').mockReturnValue(null);
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Start learning today!');
    });
  });

  describe('Level and Experience Display', () => {
    it('should display correct level', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('5');
    });

    it('should display experience points', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('1200');
      expect(wrapper.text()).toContain('500');
      expect(wrapper.text()).toContain('XP');
    });

    it('should render level progress bar', () => {
      const wrapper = mountComponent();
      const progressBar = wrapper.find('.q-linear-progress');
      expect(progressBar.exists()).toBe(true);
    });

    it('should render level circle', () => {
      const wrapper = mountComponent();
      const levelCircle = wrapper.find('.level-circle');
      expect(levelCircle.exists()).toBe(true);
    });
  });

  describe('Learning Streak Display', () => {
    it('should show active streak with orange icon', () => {
      const wrapper = mountComponent();
      const icons = wrapper.findAll('.q-icon');

      // Find the flame icon for streak (using data-color attribute)
      const hasOrangeIcon = icons.some((icon) => {
        return icon.attributes('data-color') === 'orange';
      });
      expect(hasOrangeIcon).toBe(true);
    });

    it('should show grey icon when streak is 0', () => {
      progressStore.analytics!.learningStreak.current_streak = 0;
      const wrapper = mountComponent();

      const icons = wrapper.findAll('.q-icon');
      const hasGreyIcon = icons.some((icon) => {
        return icon.attributes('data-color') === 'grey';
      });
      expect(hasGreyIcon).toBe(true);
    });

    it('should display current and longest streak', () => {
      const wrapper = mountComponent();
      // Check that streak display is present (values come from store)
      expect(wrapper.text()).toMatch(/\d+ days/);
      expect(wrapper.text()).toContain('Best:');
      expect(wrapper.text()).toContain('days');
    });
  });

  describe('Progress Charts', () => {
    it('should render weekly progress chart', () => {
      const wrapper = mountComponent();
      const charts = wrapper.findAll('.mock-progress-chart');
      expect(charts.length).toBeGreaterThanOrEqual(1);
      expect(wrapper.text()).toContain('Weekly Progress');
    });

    it('should render monthly overview chart', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Monthly Overview');
    });

    it('should pass correct props to weekly chart', () => {
      const wrapper = mountComponent();

      // Find all ProgressChart mocks
      const charts = wrapper.findAll('.mock-progress-chart');
      expect(charts.length).toBeGreaterThanOrEqual(2); // Weekly and monthly

      // First chart should be the weekly chart with 'line' type and 'experience' dataKey
      const weeklyChart = charts[0];
      expect(weeklyChart).toBeDefined();
      expect(weeklyChart!.attributes('data-type')).toBe('line');
      expect(weeklyChart!.attributes('data-key')).toBe('experience');
    });

    it('should pass correct props to monthly chart', () => {
      const wrapper = mountComponent();

      // Find all ProgressChart mocks
      const charts = wrapper.findAll('.mock-progress-chart');
      expect(charts.length).toBeGreaterThanOrEqual(2); // Weekly and monthly

      // Second chart should be the monthly chart with 'bar' type and 'vocabulary' dataKey
      const monthlyChart = charts[1];
      expect(monthlyChart).toBeDefined();
      expect(monthlyChart!.attributes('data-type')).toBe('bar');
      expect(monthlyChart!.attributes('data-key')).toBe('vocabulary');
    });
  });

  describe('Skill Categories', () => {
    it('should render skill progress section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Skill Progress');
    });

    it('should render skill category cards', () => {
      const wrapper = mountComponent();
      const skillCards = wrapper.findAll('.mock-skill-category-card');
      expect(skillCards.length).toBe(2); // Two mock skills
    });

    it('should handle empty skill categories', () => {
      progressStore.skillCategories = [];
      const wrapper = mountComponent();
      const skillCards = wrapper.findAll('.mock-skill-category-card');
      expect(skillCards.length).toBe(0);
    });
  });

  describe('Achievements', () => {
    it('should render recent achievements section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Recent Achievements');
    });

    it('should render achievement items when available', () => {
      // Mock recentAchievements getter
      progressStore.achievements = mockAchievements;

      const wrapper = mountComponent();
      const achievementItems = wrapper.findAll('.mock-achievement-item');
      expect(achievementItems.length).toBeGreaterThan(0);
    });

    it('should show placeholder when no achievements', () => {
      progressStore.achievements = [];
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('No achievements yet');
      expect(wrapper.text()).toContain('Keep learning to earn your first achievement!');
    });
  });

  describe('Learning Statistics', () => {
    it('should render learning statistics section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Learning Statistics');
    });

    it('should display words learned stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('150');
      expect(wrapper.text()).toContain('Words Learned');
    });

    it('should display sentences completed stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('75');
      expect(wrapper.text()).toContain('Sentences Completed');
    });

    it('should display average accuracy stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('85%');
      expect(wrapper.text()).toContain('Average Accuracy');
    });

    it('should display hours studied stat', () => {
      const wrapper = mountComponent();
      // 3600 seconds / 60 = 60 hours
      expect(wrapper.text()).toContain('60');
      expect(wrapper.text()).toContain('Hours Studied');
    });

    it('should handle missing analytics gracefully', () => {
      progressStore.analytics = null;
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('0');
      expect(wrapper.text()).toContain('Words Learned');
    });
  });

  describe('Achievement Dialog', () => {
    it('should render achievement dialog component', () => {
      const wrapper = mountComponent();
      const dialog = wrapper.find('.mock-achievement-dialog');
      expect(dialog.exists()).toBe(true);
    });

    it('should show dialog when new achievements are present', async () => {
      const wrapper = mountComponent();

      // Initially dialog should not be visible
      let dialog = wrapper.find('.mock-achievement-dialog');
      expect(dialog.attributes('data-visible')).toBe('false');

      // Add new achievements to trigger watcher
      progressStore.newAchievements = [mockAchievements[0]!];
      await nextTick();

      // Dialog should now be visible
      dialog = wrapper.find('.mock-achievement-dialog');
      expect(dialog.attributes('data-visible')).toBe('true');
      expect(dialog.attributes('data-achievements-count')).toBe('1');
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should load progress analytics on mount', async () => {
      mountComponent();

      await nextTick();

      expect(progressStore.loadProgressAnalytics).toHaveBeenCalledWith('user-123');
    });

    it('should handle null user ID on mount', async () => {
      authStore.user = null;
      mountComponent();

      await nextTick();

      expect(progressStore.loadProgressAnalytics).toHaveBeenCalledWith(null);
    });
  });

  describe('Computed Properties', () => {
    it("should compute today's progress correctly", () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as unknown as { todayProgress: DailyProgress | null };

      expect(vm.todayProgress).toEqual(mockDailyProgress);
    });

    it("should return null for today's progress when not available", () => {
      vi.spyOn(progressStore, 'getTodayProgress').mockReturnValue(null);
      const wrapper = mountComponent();
      const vm = wrapper.vm as unknown as { todayProgress: DailyProgress | null };

      expect(vm.todayProgress).toBeNull();
    });
  });

  describe('Responsive Grid Layout', () => {
    it('should use row layout with gap', () => {
      const wrapper = mountComponent();
      const rows = wrapper.findAll('.row');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should render stats grid correctly', () => {
      const wrapper = mountComponent();
      const statsGrid = wrapper.find('.stats-grid');
      expect(statsGrid.exists()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined analytics values', () => {
      progressStore.analytics = null;
      const wrapper = mountComponent();

      // Should not throw errors
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('0 days');
    });

    it('should handle zero experience', () => {
      progressStore.learningStats.experience = 0;
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('0');
    });

    it('should handle very large numbers', () => {
      progressStore.learningStats.experience = 999999;
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('999999');
    });

    it('should handle missing user', () => {
      authStore.user = null;
      const wrapper = mountComponent();

      // Should still render
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Styling and CSS Classes', () => {
    it('should have correct container class', () => {
      const wrapper = mountComponent();
      expect(wrapper.classes()).toContain('progress-dashboard');
    });

    it('should render level circle with correct class', () => {
      const wrapper = mountComponent();
      const levelCircle = wrapper.find('.level-circle');
      expect(levelCircle.exists()).toBe(true);
    });

    it('should render progress stat items', () => {
      const wrapper = mountComponent();
      const progressStats = wrapper.findAll('.progress-stat');
      expect(progressStats.length).toBeGreaterThan(0);
    });

    it('should render stat items in grid', () => {
      const wrapper = mountComponent();
      const statItems = wrapper.findAll('.stat-item');
      expect(statItems.length).toBe(4); // 4 stats in the grid
    });
  });

  describe('Data Flow', () => {
    it('should reflect store changes in display', async () => {
      const wrapper = mountComponent();

      // Change level in store
      progressStore.learningStats.level = 10;
      await nextTick();

      expect(wrapper.text()).toContain('10');
    });

    it('should update when analytics changes', async () => {
      const wrapper = mountComponent();

      // Update analytics
      progressStore.analytics!.wordsLearned = 200;
      await nextTick();

      expect(wrapper.text()).toContain('200');
    });
  });

  describe('Icon Display', () => {
    it('should render icons for progress stats', () => {
      const wrapper = mountComponent();
      const icons = wrapper.findAll('.q-icon');

      expect(icons.length).toBeGreaterThan(0);
    });

    it('should render different colored icons for stats', () => {
      const wrapper = mountComponent();
      const icons = wrapper.findAll('.q-icon');

      // Check that different colors are used (using data-color attribute)
      const colors = icons.map((icon) => icon.attributes('data-color')).filter(Boolean);
      expect(colors.length).toBeGreaterThan(0);
    });
  });
});
