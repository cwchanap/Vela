import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import GamesIndex from './GamesIndex.vue';

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/games', component: { template: '<div />' } },
      { path: '/games/vocabulary', component: { template: '<div />' } },
      { path: '/games/sentence', component: { template: '<div />' } },
    ],
  });

describe('GamesIndex', () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(async () => {
    router = createTestRouter();
    await router.push('/games');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const mountComponent = () =>
    mount(GamesIndex, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-icon': true,
          'q-btn': { template: '<button><slot /></button>' },
        },
      },
    });

  describe('Rendering', () => {
    it('renders the page', () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it('shows vocabulary game card', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Vocabulary');
    });

    it('shows sentences game card', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Sentences');
    });

    it('shows coming soon badges for listening and writing', () => {
      wrapper = mountComponent();
      const text = wrapper.text();
      expect(text).toContain('Listening');
      expect(text).toContain('Writing');
    });

    it('shows daily challenge section', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Daily Challenge');
    });
  });

  describe('challengeProgress computed', () => {
    it('returns 0 initially (no games completed)', () => {
      wrapper = mountComponent();
      // default: gamesCompletedToday=0, dailyChallengeGoal=3
      expect(wrapper.vm.challengeProgress).toBe(0);
    });

    it('returns 0 when dailyChallengeGoal is 0', () => {
      wrapper = mountComponent();
      wrapper.vm.dailyChallengeGoal = 0;
      expect(wrapper.vm.challengeProgress).toBe(0);
    });

    it('caps at 1 when completed exceeds goal', async () => {
      wrapper = mountComponent();
      wrapper.vm.gamesCompletedToday = 5;
      wrapper.vm.dailyChallengeGoal = 3;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.challengeProgress).toBe(1);
    });

    it('returns correct ratio for partial completion', async () => {
      wrapper = mountComponent();
      wrapper.vm.gamesCompletedToday = 1;
      wrapper.vm.dailyChallengeGoal = 3;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.challengeProgress).toBeCloseTo(1 / 3);
    });
    it('returns 0 when ratio is non-finite (e.g. Infinity / goal)', async () => {
      wrapper = mountComponent();
      wrapper.vm.gamesCompletedToday = Infinity;
      wrapper.vm.dailyChallengeGoal = 1;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.challengeProgress).toBe(0);
    });
  });

  describe('challengeText computed', () => {
    it('shows initial 0/3 text', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.challengeText).toBe('0 / 3 completed');
    });

    it('updates text when games completed changes', async () => {
      wrapper = mountComponent();
      wrapper.vm.gamesCompletedToday = 2;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.challengeText).toBe('2 / 3 completed');
    });

    it('shows correct text at goal completion', async () => {
      wrapper = mountComponent();
      wrapper.vm.gamesCompletedToday = 3;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.challengeText).toBe('3 / 3 completed');
    });
  });

  describe('Navigation', () => {
    it('navigates to vocabulary game on click', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const vocabCard = wrapper.find('.game-card--vocab');
      await vocabCard.trigger('click');
      expect(routerPushSpy).toHaveBeenCalledWith('/games/vocabulary');
    });

    it('navigates to sentence game on click', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const sentenceCard = wrapper.find('.game-card--sentence');
      await sentenceCard.trigger('click');
      expect(routerPushSpy).toHaveBeenCalledWith('/games/sentence');
    });

    it('navigates on Enter key', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const vocabCard = wrapper.find('.game-card--vocab');
      await vocabCard.trigger('keydown', { key: 'Enter' });
      expect(routerPushSpy).toHaveBeenCalledWith('/games/vocabulary');
    });

    it('navigates on Space key', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const sentenceCard = wrapper.find('.game-card--sentence');
      await sentenceCard.trigger('keydown', { key: ' ' });
      expect(routerPushSpy).toHaveBeenCalledWith('/games/sentence');
    });

    it('does not navigate on other keys', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const vocabCard = wrapper.find('.game-card--vocab');
      await vocabCard.trigger('keydown', { key: 'Tab' });
      expect(routerPushSpy).not.toHaveBeenCalled();
    });
  });
});
