import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { LlmProvider } from '@vela/common';
import ChatCacheReminder from './ChatCacheReminder.vue';

const START = 1_700_000_000_000;

const mountReminder = (
  provider: LlmProvider | null,
  cacheStartedAt: number | null,
): VueWrapper<any> => mount(ChatCacheReminder, { props: { provider, cacheStartedAt } });

describe('ChatCacheReminder', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing without cache evidence', () => {
    vi.useFakeTimers();
    const wrapper = mountReminder('anthropic', null);
    expect(wrapper.find('[data-testid="chat-cache-reminder"]').exists()).toBe(false);
  });

  it('keeps the live region mounted but empty while hidden', () => {
    vi.useFakeTimers();
    const wrapper = mountReminder('anthropic', null);
    // The region must exist before any text lands: a live region inserted
    // already holding its message is not reliably announced.
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toBe('');
  });

  it('renders nothing for a provider without a prompt-cache TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 1000);
    const wrapper = mountReminder('google', START);
    expect(wrapper.find('[data-testid="chat-cache-reminder"]').exists()).toBe(false);
  });

  it('renders the warm copy with the bounded remaining window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    const chip = wrapper.find('[data-testid="chat-cache-reminder"]');
    expect(chip.exists()).toBe(true);
    expect(chip.find('[role="timer"]').text()).toBe('Cache likely warm · 5:00 left');
    expect(chip.attributes('data-state')).toBe('warm');
  });

  it('ticks the remaining window once per second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    // Advancing the timers also advances the fake clock by the same amount.
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('[data-testid="chat-cache-reminder"] [role="timer"]').text()).toBe(
      'Cache likely warm · 4:59 left',
    );
  });

  it('announces a state that becomes active after mount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', null);
    await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('');

    await wrapper.setProps({ cacheStartedAt: START });
    await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('Prompt cache likely warm');
  });

  it('writes a state already active at mount as a post-mount update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    // Mounted empty, then filled: the announcement must arrive as a text
    // change to the existing region, not as initial insertion content.
    expect(wrapper.find('[role="status"]').text()).toBe('');
    await nextTick();
    expect(wrapper.find('[role="status"]').text()).toBe('Prompt cache likely warm');
  });

  it('keeps the ticking countdown out of the live region but announces each state once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    await nextTick();
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toBe('Prompt cache likely warm');
    await vi.advanceTimersByTimeAsync(1000);
    // A countdown tick changes the timer but not the announcement.
    expect(status.text()).toBe('Prompt cache likely warm');
    await vi.advanceTimersByTimeAsync(299 * 1000);
    expect(wrapper.find('[role="status"]').text()).toBe(
      'Cache window elapsed · next message may miss cache',
    );
  });

  it('switches to the elapsed copy at zero remaining', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    await vi.advanceTimersByTimeAsync(300 * 1000);
    const chip = wrapper.find('[data-testid="chat-cache-reminder"]');
    expect(chip.find('[role="timer"]').text()).toBe(
      'Cache window elapsed · next message may miss cache',
    );
    expect(chip.attributes('data-state')).toBe('elapsed');
  });

  it('hides again after the elapsed grace window is exceeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    await vi.advanceTimersByTimeAsync(601 * 1000);
    expect(wrapper.find('[data-testid="chat-cache-reminder"]').exists()).toBe(false);
  });

  it('runs one interval and removes it on unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const wrapper = mountReminder('anthropic', START);
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
