import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FlashcardSummary from './FlashcardSummary.vue';
import type { SessionStats } from 'src/stores/flashcards';

describe('FlashcardSummary', () => {
  const mockStats: SessionStats = {
    cardsReviewed: 10,
    correctCount: 7,
    incorrectCount: 3,
    againCount: 2,
    hardCount: 1,
    goodCount: 4,
    easyCount: 3,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T10:05:30Z'),
  };
  // Note: againCount + hardCount + goodCount + easyCount = 10 (matches cardsReviewed)
  // correctCount = goodCount + easyCount = 7, incorrectCount = againCount + hardCount = 3

  const mountComponent = (props = {}) => {
    return mount(FlashcardSummary, {
      props: {
        stats: mockStats,
        accuracy: 70,
        duration: 330, // 5 minutes 30 seconds
        ...props,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  it('should render session complete message', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Session Complete');
  });

  it('should display cards reviewed count', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('10');
    expect(wrapper.text()).toContain('Cards Reviewed');
  });

  it('should display accuracy percentage', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('70%');
    expect(wrapper.text()).toContain('Accuracy');
  });

  it('should display formatted duration', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('5m 30s');
    expect(wrapper.text()).toContain('Time Spent');
  });

  it('should display rating breakdown', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Again');
    expect(wrapper.text()).toContain('Hard');
    expect(wrapper.text()).toContain('Good');
    expect(wrapper.text()).toContain('Easy');
    expect(wrapper.find('[data-testid="again-count"]').text()).toBe('2');
    expect(wrapper.find('[data-testid="hard-count"]').text()).toBe('1');
    expect(wrapper.find('[data-testid="good-count"]').text()).toBe('4');
    expect(wrapper.find('[data-testid="easy-count"]').text()).toBe('3');
  });

  it('should display correct and incorrect counts', () => {
    const wrapper = mountComponent();

    expect(wrapper.find('[data-testid="correct-count"]').text()).toBe('7 Correct');
    expect(wrapper.find('[data-testid="incorrect-count"]').text()).toBe('3 Incorrect');
  });

  it('should emit restart event when Study Again clicked', async () => {
    const wrapper = mountComponent();

    const restartBtn = wrapper.find('[data-testid="btn-study-again"]');
    await restartBtn.trigger('click');

    expect(wrapper.emitted('restart')).toBeTruthy();
  });

  it('should emit setup event when Change Settings clicked', async () => {
    const wrapper = mountComponent();

    const setupBtn = wrapper.find('[data-testid="btn-change-settings"]');
    await setupBtn.trigger('click');

    expect(wrapper.emitted('setup')).toBeTruthy();
  });

  describe('encouragement messages', () => {
    it('should show excellent message for 90%+ accuracy', () => {
      const wrapper = mountComponent({ accuracy: 95 });

      expect(wrapper.text()).toContain('Excellent work');
    });

    it('should show great job message for 70-89% accuracy', () => {
      const wrapper = mountComponent({ accuracy: 75 });

      expect(wrapper.text()).toContain('Great job');
    });

    it('should show good effort message for 50-69% accuracy', () => {
      const wrapper = mountComponent({ accuracy: 55 });

      expect(wrapper.text()).toContain('Good effort');
    });

    it('should show keep practicing message for below 50%', () => {
      const wrapper = mountComponent({ accuracy: 30 });

      expect(wrapper.text()).toContain('Keep practicing');
    });
  });

  describe('accuracy color', () => {
    it('should use positive color for 80%+ accuracy', () => {
      const wrapper = mountComponent({ accuracy: 85 });

      const accuracyText = wrapper.find('.text-positive');
      expect(accuracyText.exists()).toBe(true);
    });

    it('should use warning color for 60-79% accuracy', () => {
      const wrapper = mountComponent({ accuracy: 65 });

      const accuracyText = wrapper.find('.text-warning');
      expect(accuracyText.exists()).toBe(true);
    });

    it('should use negative color for below 60%', () => {
      const wrapper = mountComponent({ accuracy: 45 });

      const accuracyText = wrapper.find('.text-negative');
      expect(accuracyText.exists()).toBe(true);
    });
  });

  describe('duration formatting', () => {
    it('should format seconds only when under a minute', () => {
      const wrapper = mountComponent({ duration: 45 });

      expect(wrapper.text()).toContain('45s');
    });

    it('should format minutes and seconds', () => {
      const wrapper = mountComponent({ duration: 125 });

      expect(wrapper.text()).toContain('2m 5s');
    });
  });

  describe('trophy icon', () => {
    it('should show trophy icon for 70%+ accuracy', () => {
      const wrapper = mountComponent({ accuracy: 75 });

      const icon = wrapper.findComponent({ name: 'QIcon' });
      expect(icon.props('name')).toBe('emoji_events');
    });

    it('should show school icon for below 70% accuracy', () => {
      const wrapper = mountComponent({ accuracy: 60 });

      const icon = wrapper.findComponent({ name: 'QIcon' });
      expect(icon.props('name')).toBe('school');
    });
  });

  describe('progress bars', () => {
    it('should render progress bars for rating breakdown', () => {
      const wrapper = mountComponent();

      const progressBars = wrapper.findAllComponents({ name: 'QLinearProgress' });
      expect(progressBars.length).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('should handle zero cards reviewed', () => {
      const zeroStats: SessionStats = {
        ...mockStats,
        cardsReviewed: 0,
        correctCount: 0,
        incorrectCount: 0,
        againCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
      };

      const wrapper = mountComponent({
        stats: zeroStats,
        accuracy: 0,
        duration: 0,
      });

      expect(wrapper.text()).toContain('0');
      expect(wrapper.text()).toContain('0%');
    });

    it('should handle perfect score', () => {
      const perfectStats: SessionStats = {
        ...mockStats,
        correctCount: 10,
        incorrectCount: 0,
        againCount: 0,
        hardCount: 0,
        goodCount: 5,
        easyCount: 5,
      };

      const wrapper = mountComponent({
        stats: perfectStats,
        accuracy: 100,
      });

      expect(wrapper.text()).toContain('100%');
      expect(wrapper.text()).toContain('10 Correct');
      expect(wrapper.text()).toContain('0 Incorrect');
    });
  });
});
