import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import AchievementItem from './AchievementItem.vue';
import type { Achievement } from 'src/services/progressService';

describe('AchievementItem', () => {
  let wrapper: VueWrapper;

  const mockEarnedAchievement: Achievement = {
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

  const mockUnearnedAchievement: Achievement = {
    id: '2',
    name: 'Grammar Master',
    description: 'Complete 50 grammar exercises',
    icon: 'auto_stories',
    category: 'grammar',
    requirement_type: 'grammar_exercises',
    requirement_value: 50,
    experience_reward: 250,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const mountComponent = (props = {}) => {
    return mount(AchievementItem, {
      global: {
        plugins: [Quasar],
      },
      props: {
        achievement: mockEarnedAchievement,
        ...props,
      },
    });
  };

  describe('Initial Rendering', () => {
    it('should render q-item component', () => {
      wrapper = mountComponent();
      const item = wrapper.findComponent({ name: 'QItem' });
      expect(item.exists()).toBe(true);
    });

    it('should display achievement name', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('First Steps');
    });

    it('should display achievement description', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Complete your first vocabulary game');
    });

    it('should display achievement icon', () => {
      wrapper = mountComponent();
      const icons = wrapper.findAllComponents({ name: 'QIcon' });
      const achievementIcon = icons.find((icon) => icon.props('name') === 'school');
      expect(achievementIcon?.exists()).toBe(true);
    });
  });

  describe('Avatar Display', () => {
    it('should display avatar with correct size', () => {
      wrapper = mountComponent();
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.exists()).toBe(true);
      expect(avatar.props('size')).toBe('48px');
    });

    it('should display icon in avatar with correct size', () => {
      wrapper = mountComponent();
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      const icon = avatar.findComponent({ name: 'QIcon' });
      expect(icon.exists()).toBe(true);
      expect(icon.props('size')).toBe('24px');
    });

    it('should have white text color on avatar', () => {
      wrapper = mountComponent();
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.props('textColor')).toBe('white');
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
      it(`should use ${color} color for ${category} category`, () => {
        const achievement: Achievement = {
          ...mockEarnedAchievement,
          category,
        };
        wrapper = mountComponent({ achievement });
        const avatar = wrapper.findComponent({ name: 'QAvatar' });
        expect(avatar.props('color')).toBe(color);
      });
    });
  });

  describe('Experience Badge', () => {
    it('should display experience badge when experience > 0', () => {
      wrapper = mountComponent();
      const badge = wrapper.findComponent({ name: 'QBadge' });
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('+100 XP');
    });

    it('should display warning color badge', () => {
      wrapper = mountComponent();
      const badge = wrapper.findComponent({ name: 'QBadge' });
      expect(badge.props('color')).toBe('warning');
    });

    it('should not display badge when experience is 0', () => {
      const noXpAchievement: Achievement = {
        ...mockEarnedAchievement,
        experience_reward: 0,
      };
      wrapper = mountComponent({ achievement: noXpAchievement });
      const badge = wrapper.findComponent({ name: 'QBadge' });
      expect(badge.exists()).toBe(false);
    });

    it('should display badge with correct format for large numbers', () => {
      const largeXpAchievement: Achievement = {
        ...mockEarnedAchievement,
        experience_reward: 1000,
      };
      wrapper = mountComponent({ achievement: largeXpAchievement });
      const badge = wrapper.findComponent({ name: 'QBadge' });
      expect(badge.text()).toBe('+1000 XP');
    });
  });

  describe('Earned Status', () => {
    it('should display check icon for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      const checkIcon = wrapper
        .findAllComponents({ name: 'QIcon' })
        .find((icon) => icon.props('name') === 'check_circle');
      expect(checkIcon?.exists()).toBe(true);
      expect(checkIcon?.props('color')).toBe('positive');
      expect(checkIcon?.props('size')).toBe('24px');
    });

    it('should not display check icon for unearned achievements', () => {
      wrapper = mountComponent({ achievement: mockUnearnedAchievement });
      const checkIcon = wrapper
        .findAllComponents({ name: 'QIcon' })
        .find((icon) => icon.props('name') === 'check_circle');
      expect(checkIcon).toBeUndefined();
    });

    it('should display earned date for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      expect(wrapper.text()).toContain('Earned');
    });

    it('should not display earned date for unearned achievements', () => {
      wrapper = mountComponent({ achievement: mockUnearnedAchievement });
      expect(wrapper.text()).not.toContain('Earned');
    });

    it('should add achievement-earned class for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      const item = wrapper.findComponent({ name: 'QItem' });
      expect(item.classes()).toContain('achievement-earned');
    });

    it('should not add achievement-earned class for unearned achievements', () => {
      wrapper = mountComponent({ achievement: mockUnearnedAchievement });
      const item = wrapper.findComponent({ name: 'QItem' });
      expect(item.classes()).not.toContain('achievement-earned');
    });
  });

  describe('Date Formatting', () => {
    beforeEach(() => {
      // Mock current date to ensure consistent test results
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-17T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should display "today" for achievements earned today', () => {
      const todayAchievement: Achievement = {
        ...mockEarnedAchievement,
        earned_at: '2024-01-17T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: todayAchievement });
      expect(wrapper.text()).toContain('Earned today');
    });

    it('should display "yesterday" for achievements earned yesterday', () => {
      const yesterdayAchievement: Achievement = {
        ...mockEarnedAchievement,
        earned_at: '2024-01-16T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: yesterdayAchievement });
      expect(wrapper.text()).toContain('Earned yesterday');
    });

    it('should display days ago for achievements earned within a week', () => {
      const threeDaysAgoAchievement: Achievement = {
        ...mockEarnedAchievement,
        earned_at: '2024-01-14T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: threeDaysAgoAchievement });
      expect(wrapper.text()).toContain('Earned 3 days ago');
    });

    it('should display formatted date for achievements earned over a week ago', () => {
      const oldAchievement: Achievement = {
        ...mockEarnedAchievement,
        earned_at: '2024-01-01T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: oldAchievement });
      expect(wrapper.text()).toContain('Earned');
      expect(wrapper.text()).toContain('Jan');
    });

    it('should include year for achievements earned in previous years', () => {
      const lastYearAchievement: Achievement = {
        ...mockEarnedAchievement,
        earned_at: '2023-12-01T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: lastYearAchievement });
      expect(wrapper.text()).toContain('2023');
    });
  });

  describe('Props', () => {
    it('should accept achievement prop', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      expect(wrapper.props('achievement')).toEqual(mockEarnedAchievement);
    });

    it('should handle different achievement categories', () => {
      const categories = ['vocabulary', 'grammar', 'streak', 'level', 'special'];
      categories.forEach((category) => {
        const achievement: Achievement = {
          ...mockEarnedAchievement,
          category,
        };
        const testWrapper = mountComponent({ achievement });
        expect(testWrapper.exists()).toBe(true);
        testWrapper.unmount();
      });
    });

    it('should handle achievements with no earned_at', () => {
      wrapper = mountComponent({ achievement: mockUnearnedAchievement });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).not.toContain('Earned');
    });
  });

  describe('Layout Structure', () => {
    it('should have avatar section', () => {
      wrapper = mountComponent();
      const sections = wrapper.findAllComponents({ name: 'QItemSection' });
      const avatarSection = sections.find((section) => section.props('avatar') === true);
      expect(avatarSection?.exists()).toBe(true);
    });

    it('should have main content section', () => {
      wrapper = mountComponent();
      const sections = wrapper.findAllComponents({ name: 'QItemSection' });
      const contentSection = sections.find(
        (section) => !section.props('avatar') && !section.props('side'),
      );
      expect(contentSection?.exists()).toBe(true);
    });

    it('should have side section for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      const sections = wrapper.findAllComponents({ name: 'QItemSection' });
      const sideSection = sections.find((section) => section.props('side') === true);
      expect(sideSection?.exists()).toBe(true);
    });

    it('should not have side section for unearned achievements', () => {
      wrapper = mountComponent({ achievement: mockUnearnedAchievement });
      const sections = wrapper.findAllComponents({ name: 'QItemSection' });
      const sideSection = sections.find((section) => section.props('side') === true);
      expect(sideSection).toBeUndefined();
    });
  });

  describe('Item Labels', () => {
    it('should have achievement name in QItemLabel', () => {
      wrapper = mountComponent();
      const labels = wrapper.findAllComponents({ name: 'QItemLabel' });
      const nameLabel = labels.find((label) => !label.props('caption'));
      expect(nameLabel?.text()).toContain('First Steps');
    });

    it('should have achievement description in caption label', () => {
      wrapper = mountComponent();
      const labels = wrapper.findAllComponents({ name: 'QItemLabel' });
      const descriptionLabel = labels.find((label) => {
        return label.props('caption') && label.text().includes('Complete your first');
      });
      expect(descriptionLabel?.exists()).toBe(true);
    });

    it('should have earned date in caption label for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      const labels = wrapper.findAllComponents({ name: 'QItemLabel' });
      const dateLabel = labels.find((label) => {
        return label.props('caption') && label.text().includes('Earned');
      });
      expect(dateLabel?.exists()).toBe(true);
    });
  });

  describe('CSS Classes', () => {
    it('should have achievement-item class', () => {
      wrapper = mountComponent();
      const item = wrapper.findComponent({ name: 'QItem' });
      expect(item.classes()).toContain('achievement-item');
    });

    it('should have achievement-name class on name label', () => {
      wrapper = mountComponent();
      expect(wrapper.find('.achievement-name').exists()).toBe(true);
    });

    it('should have achievement-description class on description label', () => {
      wrapper = mountComponent();
      expect(wrapper.find('.achievement-description').exists()).toBe(true);
    });

    it('should have achievement-date class on date label for earned achievements', () => {
      wrapper = mountComponent({ achievement: mockEarnedAchievement });
      expect(wrapper.find('.achievement-date').exists()).toBe(true);
    });
  });

  describe('Different Achievement Types', () => {
    it('should render vocabulary achievement correctly', () => {
      const vocabAchievement: Achievement = {
        id: 'vocab-1',
        name: 'Word Wizard',
        description: 'Learn 100 vocabulary words',
        icon: 'translate',
        category: 'vocabulary',
        requirement_type: 'words_learned',
        requirement_value: 100,
        experience_reward: 300,
        earned_at: '2024-01-10T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: vocabAchievement });
      expect(wrapper.text()).toContain('Word Wizard');
      expect(wrapper.text()).toContain('Learn 100 vocabulary words');
    });

    it('should render streak achievement correctly', () => {
      const streakAchievement: Achievement = {
        id: 'streak-1',
        name: 'On Fire',
        description: 'Maintain a 30-day learning streak',
        icon: 'local_fire_department',
        category: 'streak',
        requirement_type: 'streak_days',
        requirement_value: 30,
        experience_reward: 500,
      };
      wrapper = mountComponent({ achievement: streakAchievement });
      expect(wrapper.text()).toContain('On Fire');
      expect(wrapper.text()).toContain('Maintain a 30-day learning streak');
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.props('color')).toBe('orange');
    });

    it('should render level achievement correctly', () => {
      const levelAchievement: Achievement = {
        id: 'level-1',
        name: 'Level Up',
        description: 'Reach level 10',
        icon: 'star',
        category: 'level',
        requirement_type: 'level',
        requirement_value: 10,
        experience_reward: 1000,
        earned_at: '2024-01-05T10:00:00Z',
      };
      wrapper = mountComponent({ achievement: levelAchievement });
      expect(wrapper.text()).toContain('Level Up');
      expect(wrapper.text()).toContain('Reach level 10');
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.props('color')).toBe('purple');
    });
  });
});
