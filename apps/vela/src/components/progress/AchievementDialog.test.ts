import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { Quasar } from 'quasar';
import AchievementDialog from './AchievementDialog.vue';
import type { Achievement } from 'src/services/progressService';

describe('AchievementDialog', () => {
  let wrapper: VueWrapper;

  const mockAchievement: Achievement = {
    id: '1',
    name: 'First Steps',
    description: 'Complete your first vocabulary game',
    icon: 'school',
    category: 'vocabulary',
    requirement_type: 'games_completed',
    requirement_value: 1,
    experience_reward: 100,
    earned_at: '2024-01-15T10:30:00Z',
  };

  const mockMultipleAchievements: Achievement[] = [
    mockAchievement,
    {
      id: '2',
      name: 'Grammar Guru',
      description: 'Master 10 grammar points',
      icon: 'auto_stories',
      category: 'grammar',
      requirement_type: 'grammar_points',
      requirement_value: 10,
      experience_reward: 200,
      earned_at: '2024-01-16T14:20:00Z',
    },
    {
      id: '3',
      name: 'Week Warrior',
      description: 'Maintain a 7-day streak',
      icon: 'local_fire_department',
      category: 'streak',
      requirement_type: 'streak_days',
      requirement_value: 7,
      experience_reward: 150,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mountComponent = (props = {}) => {
    return mount(AchievementDialog, {
      global: {
        plugins: [Quasar],
      },
      props: {
        modelValue: false,
        achievements: [mockAchievement],
        ...props,
      },
    });
  };

  describe('Initial Rendering', () => {
    it('should render dialog component', () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.exists()).toBe(true);
    });

    it('should pass correct modelValue prop to dialog', () => {
      wrapper = mountComponent({ modelValue: true });
      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.props('modelValue')).toBe(true);
    });

    it('should have persistent dialog', () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.props('persistent')).toBe(true);
    });

    it('should have scale transitions', () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.props('transitionShow')).toBe('scale');
      expect(dialog.props('transitionHide')).toBe('scale');
    });
  });

  describe('Props', () => {
    it('should accept modelValue prop', () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.props('modelValue')).toBe(true);
    });

    it('should accept achievements prop', () => {
      wrapper = mountComponent({ achievements: mockMultipleAchievements });
      expect(wrapper.props('achievements')).toEqual(mockMultipleAchievements);
    });

    it('should handle empty achievements array', () => {
      wrapper = mountComponent({ achievements: [] });
      expect(wrapper.props('achievements')).toEqual([]);
    });
  });

  describe('Computed Properties', () => {
    it('should calculate total experience correctly', () => {
      wrapper = mountComponent({ achievements: mockMultipleAchievements });
      const vm = wrapper.vm as any;
      // 100 + 200 + 150 = 450
      expect(vm.totalExperience).toBe(450);
    });

    it('should return 0 for empty achievements', () => {
      wrapper = mountComponent({ achievements: [] });
      const vm = wrapper.vm as any;
      expect(vm.totalExperience).toBe(0);
    });

    it('should return correct total for single achievement', () => {
      wrapper = mountComponent({ achievements: [mockAchievement] });
      const vm = wrapper.vm as any;
      expect(vm.totalExperience).toBe(100);
    });
  });

  describe('Category Colors', () => {
    const categoryColorMap = [
      { category: 'vocabulary', color: 'primary' },
      { category: 'grammar', color: 'secondary' },
      { category: 'streak', color: 'orange' },
      { category: 'level', color: 'purple' },
      { category: 'special', color: 'pink' },
      { category: 'unknown', color: 'grey' },
    ];

    categoryColorMap.forEach(({ category, color }) => {
      it(`should return ${color} for ${category} category`, () => {
        wrapper = mountComponent();
        const vm = wrapper.vm as any;
        expect(vm.getCategoryColor(category)).toBe(color);
      });
    });
  });

  describe('Event Emissions', () => {
    it('should emit update:modelValue with false when closeDialog is called', async () => {
      wrapper = mountComponent({ modelValue: true });
      const vm = wrapper.vm as any;

      vm.closeDialog();
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
    });

    it('should emit close event when closeDialog is called', async () => {
      wrapper = mountComponent({ modelValue: true });
      const vm = wrapper.vm as any;

      vm.closeDialog();
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('should emit both events when closeDialog is called', async () => {
      wrapper = mountComponent({ modelValue: true });
      const vm = wrapper.vm as any;

      vm.closeDialog();
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('Auto-close Timer', () => {
    it('should auto-close dialog after 10 seconds', async () => {
      wrapper = mountComponent({ modelValue: false });

      // Open the dialog
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      // Fast-forward time by 10 seconds
      vi.advanceTimersByTime(10000);
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('should not auto-close before 10 seconds', async () => {
      wrapper = mountComponent({ modelValue: false });

      // Open the dialog to start the timer
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      // Fast-forward time by 9 seconds
      vi.advanceTimersByTime(9000);
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
      expect(wrapper.emitted('close')).toBeFalsy();
    });

    it('should restart timer when dialog is reopened', async () => {
      wrapper = mountComponent({ modelValue: false });

      // Open dialog
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      // Fast-forward 5 seconds
      vi.advanceTimersByTime(5000);

      // Close dialog (clearing the timer)
      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      // Reopen dialog (starting a new timer)
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      // Fast-forward 9 seconds from reopen - should NOT auto-close yet
      vi.advanceTimersByTime(9000);
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
      expect(wrapper.emitted('close')).toBeFalsy();

      // Fast-forward 1 more second (10 total from reopen) - should auto-close now
      vi.advanceTimersByTime(1000);
      await flushPromises();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('should clear timer when dialog is closed manually', async () => {
      wrapper = mountComponent({ modelValue: false });

      // Open the dialog to start the timer
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      const vm = wrapper.vm as any;

      // Manually close
      vm.closeDialog();
      await flushPromises();

      // Update prop to reflect the close (simulating parent component response)
      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      const emitCount = wrapper.emitted('close')?.length || 0;

      // Fast-forward time to check if auto-close still triggers
      vi.advanceTimersByTime(10000);
      await flushPromises();

      // Should only have the manual close emit
      expect(wrapper.emitted('close')?.length).toBe(emitCount);
    });
  });

  describe('Achievement Data Handling', () => {
    it('should handle single achievement', () => {
      wrapper = mountComponent({ achievements: [mockAchievement] });
      expect(wrapper.props('achievements')).toHaveLength(1);
    });

    it('should handle multiple achievements', () => {
      wrapper = mountComponent({ achievements: mockMultipleAchievements });
      expect(wrapper.props('achievements')).toHaveLength(3);
    });

    it('should handle achievements with no experience reward', () => {
      const noXpAchievement: Achievement = {
        ...mockAchievement,
        experience_reward: 0,
      };
      wrapper = mountComponent({ achievements: [noXpAchievement] });
      const vm = wrapper.vm as any;
      expect(vm.totalExperience).toBe(0);
    });

    it('should handle achievements with different categories', () => {
      const achievements: Achievement[] = [
        { ...mockAchievement, category: 'vocabulary' },
        { ...mockAchievement, id: '2', category: 'grammar' },
        { ...mockAchievement, id: '3', category: 'streak' },
      ];
      wrapper = mountComponent({ achievements });
      expect(wrapper.props('achievements')).toHaveLength(3);
    });
  });

  describe('Reactivity', () => {
    it('should update when achievements prop changes', async () => {
      wrapper = mountComponent({ achievements: [mockAchievement] });
      expect(wrapper.props('achievements')).toHaveLength(1);

      await wrapper.setProps({ achievements: mockMultipleAchievements });
      expect(wrapper.props('achievements')).toHaveLength(3);
    });

    it('should update when modelValue prop changes', async () => {
      wrapper = mountComponent({ modelValue: false });
      expect(wrapper.props('modelValue')).toBe(false);

      await wrapper.setProps({ modelValue: true });
      expect(wrapper.props('modelValue')).toBe(true);
    });

    it('should recalculate total experience when achievements change', async () => {
      wrapper = mountComponent({ achievements: [mockAchievement] });
      const vm = wrapper.vm as any;
      expect(vm.totalExperience).toBe(100);

      await wrapper.setProps({ achievements: mockMultipleAchievements });
      expect(vm.totalExperience).toBe(450);
    });
  });
});
