import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import SkillCategoryCard from './SkillCategoryCard.vue';
import type { SkillCategory } from 'src/services/progressService';

const mockSkill: SkillCategory = {
  id: 'vocabulary',
  name: 'Vocabulary',
  description: 'Learn Japanese vocabulary words',
  icon: 'translate',
  color: 'primary',
  level: 5,
  experience: 400,
  experience_to_next_level: 500,
};

describe('SkillCategoryCard', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  const mountComponent = (props = {}) => {
    return mount(SkillCategoryCard, {
      global: { plugins: [Quasar] },
      props: { skill: mockSkill, ...props },
    });
  };

  describe('Rendering', () => {
    it('renders skill name', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Vocabulary');
    });

    it('renders skill description', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Learn Japanese vocabulary words');
    });

    it('renders skill level', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Level 5');
    });

    it('renders experience values', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('400');
      expect(wrapper.text()).toContain('500');
    });
  });

  describe('progressPercentage computed', () => {
    it('calculates correct progress percentage', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.progressPercentage).toBe(80); // 400/500 * 100 = 80
    });

    it('returns 100 when experience_to_next_level is 0', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 100, experience_to_next_level: 0 },
      });
      expect(wrapper.vm.progressPercentage).toBe(100);
    });

    it('rounds to nearest integer', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 1, experience_to_next_level: 3 },
      });
      // 1/3 * 100 = 33.33 → rounds to 33
      expect(wrapper.vm.progressPercentage).toBe(33);
    });

    it('handles zero experience', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 0 },
      });
      expect(wrapper.vm.progressPercentage).toBe(0);
    });

    it('handles full experience (100%)', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 500, experience_to_next_level: 500 },
      });
      expect(wrapper.vm.progressPercentage).toBe(100);
    });
  });

  describe('experienceNeeded computed', () => {
    it('calculates correct experience needed', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.experienceNeeded).toBe(100); // 500 - 400 = 100
    });

    it('shows 0 when experience equals experience_to_next_level', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 500, experience_to_next_level: 500 },
      });
      expect(wrapper.vm.experienceNeeded).toBe(0);
    });

    it('shows correct value for large gaps', () => {
      wrapper = mountComponent({
        skill: { ...mockSkill, experience: 50, experience_to_next_level: 1000 },
      });
      expect(wrapper.vm.experienceNeeded).toBe(950);
    });
  });

  describe('showActions prop', () => {
    it('hides actions by default', () => {
      wrapper = mountComponent();
      const actions = wrapper.findComponent({ name: 'QCardActions' });
      expect(actions.exists()).toBe(false);
    });

    it('shows actions when showActions is true', () => {
      wrapper = mountComponent({ showActions: true });
      const actions = wrapper.findComponent({ name: 'QCardActions' });
      expect(actions.exists()).toBe(true);
    });

    it('emits practice event when Practice button clicked', async () => {
      wrapper = mountComponent({ showActions: true });
      const buttons = wrapper.findAllComponents({ name: 'QBtn' });
      const practiceBtn = buttons.find((b) => b.text() === 'Practice');
      expect(practiceBtn).toBeDefined();
      await practiceBtn!.trigger('click');
      expect(wrapper.emitted('practice')).toBeTruthy();
    });

    it('emits details event when Details button clicked', async () => {
      wrapper = mountComponent({ showActions: true });
      const buttons = wrapper.findAllComponents({ name: 'QBtn' });
      const detailsBtn = buttons.find((b) => b.text() === 'Details');
      expect(detailsBtn).toBeDefined();
      await detailsBtn!.trigger('click');
      expect(wrapper.emitted('details')).toBeTruthy();
    });
  });

  describe('Progress bar', () => {
    it('renders a linear progress component', () => {
      wrapper = mountComponent();
      const progress = wrapper.findComponent({ name: 'QLinearProgress' });
      expect(progress.exists()).toBe(true);
    });

    it('passes correct value to progress bar', () => {
      wrapper = mountComponent();
      const progress = wrapper.findComponent({ name: 'QLinearProgress' });
      // progressPercentage / 100 = 80 / 100 = 0.8
      expect(progress.props('value')).toBeCloseTo(0.8);
    });
  });
});
