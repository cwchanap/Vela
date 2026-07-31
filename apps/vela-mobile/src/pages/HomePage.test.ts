import type { SRSStats } from '@vela/common';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { MobileApiError } from 'src/services/mobile-api-client';
import { NETWORK_MESSAGE, STALE_MESSAGE } from 'src/components/home/due-review-view';
import HomePage from './HomePage.vue';

const dueReview = {
  stats: ref<SRSStats | undefined>(),
  error: ref<MobileApiError | null>(null),
  isInitialPending: ref(false),
  isFetching: ref(false),
  sessionRecoveryPending: ref(false),
  manualRetryPending: ref(false),
  retry: vi.fn<() => Promise<void>>().mockResolvedValue(),
};

vi.mock('src/composables/useDueReviewCount', () => ({
  useDueReviewCount: () => dueReview,
}));

const stats = (dueToday: number): SRSStats => ({
  total_items: dueToday,
  due_today: dueToday,
  mastery_breakdown: { new: 0, learning: 0, reviewing: dueToday, mastered: 0 },
  average_ease_factor: 2.5,
  total_reviews: 0,
  accuracy_rate: 100,
});

const Host = defineComponent({
  components: { QLayout, QPageContainer, HomePage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><home-page/></q-page-container></q-layout>',
});

const mountPage = () => mount(Host, { global: { plugins: [Quasar] } });

function setDueReview(overrides: Partial<typeof dueReview> = {}) {
  dueReview.stats.value = undefined;
  dueReview.error.value = null;
  dueReview.isInitialPending.value = false;
  dueReview.isFetching.value = false;
  dueReview.sessionRecoveryPending.value = false;
  dueReview.manualRetryPending.value = false;
  Object.assign(dueReview, overrides);
}

describe('HomePage', () => {
  afterEach(() => {
    setDueReview();
    dueReview.retry.mockClear();
  });

  it('announces loading accessibly', () => {
    dueReview.isInitialPending.value = true;
    const wrapper = mountPage();

    expect(wrapper.get('h1').text()).toBe('Today’s review');
    expect(wrapper.get('[role="status"]').text()).toContain('Loading your review count…');
    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite');
  });

  it('announces session recovery loading accessibly', () => {
    dueReview.sessionRecoveryPending.value = true;
    const wrapper = mountPage();

    expect(wrapper.get('[role="status"]').text()).toContain('Refreshing your session…');
  });

  it('shows a caught-up zero count', () => {
    dueReview.stats.value = stats(0);
    const wrapper = mountPage();

    expect(wrapper.get('.due-review__count').text()).toBe('0');
    expect(wrapper.text()).toContain('You’re caught up for now.');
  });

  it.each([
    [1, '1 word is due for review.'],
    [3, '3 words are due for review.'],
  ])('uses the correct due-count copy for %i word(s)', (count, copy) => {
    dueReview.stats.value = stats(count);
    const wrapper = mountPage();

    expect(wrapper.get('.due-review__count').text()).toBe(String(count));
    expect(wrapper.text()).toContain(copy);
  });

  it('retains the count while it refreshes in the background', () => {
    dueReview.stats.value = stats(3);
    dueReview.isFetching.value = true;
    const wrapper = mountPage();

    expect(wrapper.get('.due-review__count').text()).toBe('3');
    expect(wrapper.get('[role="status"]').text()).toContain('Refreshing review count…');
  });

  it('shows a blocking network error and retries', async () => {
    dueReview.error.value = new MobileApiError('network');
    const wrapper = mountPage();

    expect(wrapper.get('[role="alert"]').text()).toContain(NETWORK_MESSAGE);
    await wrapper.get('button').trigger('click');
    expect(dueReview.retry).toHaveBeenCalledOnce();
  });

  it.each([0, 3])('keeps the cached %i count with a stale-error warning', (count) => {
    dueReview.stats.value = stats(count);
    dueReview.error.value = new MobileApiError('server');
    const wrapper = mountPage();

    expect(wrapper.get('[role="alert"] .due-review__count').text()).toBe(String(count));
    expect(wrapper.get('[role="alert"]').text()).toContain(STALE_MESSAGE);
  });

  it('disables and relabels retry while a manual retry is pending', () => {
    dueReview.error.value = new MobileApiError('network');
    dueReview.manualRetryPending.value = true;
    const wrapper = mountPage();
    const retry = wrapper.get('button');

    expect(retry.attributes('aria-label')).toBe('Retrying review count');
    expect(retry.attributes('disabled')).toBeDefined();
  });

  it('does not offer retry for an invalid request', () => {
    dueReview.error.value = new MobileApiError('invalid_request');
    const wrapper = mountPage();

    expect(wrapper.get('[role="alert"]').text()).toContain('Please try again.');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('does not render the scaffold, environment, version, or Start Review copy', () => {
    dueReview.stats.value = stats(3);
    const text = mountPage().text();

    expect(text).not.toContain('M1 Scaffold');
    expect(text).not.toContain('Development');
    expect(text).not.toContain('Production');
    expect(text).not.toContain('Version');
    expect(text).not.toContain('Start Review');
  });
});
