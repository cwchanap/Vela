import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import ProgressPage from './ProgressPage.vue';
import { useProgressStore } from 'src/stores/progress';
import type { Achievement } from 'src/services/progressService';

// Stub child components to avoid their own dependencies
vi.mock('src/components/progress/ProgressDashboard.vue', () => ({
  default: { name: 'ProgressDashboard', template: '<div data-testid="progress-dashboard" />' },
}));
vi.mock('src/components/progress/ProgressChart.vue', () => ({
  default: {
    name: 'ProgressChart',
    template: '<div data-testid="progress-chart" />',
    props: ['data', 'type', 'height', 'dataKey', 'color'],
  },
}));
vi.mock('src/components/progress/SkillCategoryCard.vue', () => ({
  default: {
    name: 'SkillCategoryCard',
    template: '<div data-testid="skill-card" />',
    props: ['skill', 'showActions'],
  },
}));
vi.mock('src/components/progress/AchievementItem.vue', () => ({
  default: {
    name: 'AchievementItem',
    template: '<div data-testid="achievement-item" />',
    props: ['achievement'],
  },
}));
vi.mock('src/components/progress/AchievementDialog.vue', () => ({
  default: {
    name: 'AchievementDialog',
    template: '<div data-testid="achievement-dialog" />',
    props: ['modelValue', 'achievements'],
  },
}));

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });

describe('ProgressPage', () => {
  let wrapper: VueWrapper;
  let progressStore: ReturnType<typeof useProgressStore>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    const router = createTestRouter();
    await router.push('/');

    progressStore = useProgressStore();

    // Mock the loadProgressAnalytics method
    vi.spyOn(progressStore, 'loadProgressAnalytics').mockResolvedValue(undefined);

    wrapper = mount(ProgressPage, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
        },
      },
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('Rendering', () => {
    it('renders without errors', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('shows page title', () => {
      expect(wrapper.text()).toContain('Learning Progress');
    });

    it('shows page subtitle', () => {
      expect(wrapper.text()).toContain('Track your Japanese learning journey');
    });

    it('shows progress over time section', () => {
      expect(wrapper.text()).toContain('Progress Over Time');
    });

    it('shows skill categories section', () => {
      expect(wrapper.text()).toContain('Skill Categories');
    });

    it('shows recent achievements section', () => {
      expect(wrapper.text()).toContain('Recent Achievements');
    });
  });

  describe('chartData computed', () => {
    it('returns empty array when analytics is null', () => {
      (progressStore as any).analytics = null;
      expect(wrapper.vm.chartData).toEqual([]);
    });

    it('returns processed chart data when analytics is available', () => {
      // dailyProgressChart is computed from analytics.dailyProgress
      (progressStore as any).analytics = {
        dailyProgress: [
          {
            date: '2024-01-01',
            experience_gained: 100,
            vocabulary_studied: 10,
            sentences_completed: 5,
            accuracy_percentage: 80,
          },
        ],
        currentLevel: 1,
        totalExperience: 0,
        weeklyProgress: [],
        monthlyProgress: [],
      };
      // chartData is derived from dailyProgressChart computed
      expect(wrapper.vm.chartData.length).toBeGreaterThan(0);
    });
  });

  describe('Achievement dialog', () => {
    it('achievementDialogOpen starts as false', () => {
      expect(wrapper.vm.achievementDialogOpen).toBe(false);
    });

    it('selectedAchievements starts empty', () => {
      expect(wrapper.vm.selectedAchievements).toEqual([]);
    });

    it('showAchievementDialog opens dialog and sets selected achievement', () => {
      const mockAchievement: Achievement = {
        id: 'ach-1',
        name: 'First Steps',
        description: 'Complete first game',
        icon: 'school',
        category: 'vocabulary',
        requirement_type: 'games_completed',
        requirement_value: 1,
        experience_reward: 100,
      };

      wrapper.vm.showAchievementDialog(mockAchievement);

      expect(wrapper.vm.achievementDialogOpen).toBe(true);
      expect(wrapper.vm.selectedAchievements).toEqual([mockAchievement]);
    });

    it('showAchievementDialog replaces previous selection', () => {
      const achievement1: Achievement = {
        id: 'ach-1',
        name: 'A',
        description: '',
        icon: 'a',
        category: 'vocabulary',
        requirement_type: 'x',
        requirement_value: 1,
        experience_reward: 50,
      };
      const achievement2: Achievement = {
        id: 'ach-2',
        name: 'B',
        description: '',
        icon: 'b',
        category: 'streak',
        requirement_type: 'y',
        requirement_value: 5,
        experience_reward: 200,
      };

      wrapper.vm.showAchievementDialog(achievement1);
      wrapper.vm.showAchievementDialog(achievement2);

      expect(wrapper.vm.selectedAchievements).toEqual([achievement2]);
    });
  });

  describe('Shows empty achievements message', () => {
    it('shows no achievements message when recentAchievements is empty', async () => {
      (progressStore as any).recentAchievements = [];
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('No achievements yet');
    });
  });
});
