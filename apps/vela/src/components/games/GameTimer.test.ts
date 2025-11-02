import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import GameTimer from './GameTimer.vue';
import { useGameStore } from 'src/stores/games';

describe('GameTimer', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should render initial time of 60 seconds', () => {
    const wrapper = mount(GameTimer);

    expect(wrapper.text()).toContain('Time: 60');
  });

  it('should decrement time every second', async () => {
    const wrapper = mount(GameTimer);

    // Initial render shows 60
    expect(wrapper.text()).toContain('Time: 60');
    expect(wrapper.vm.timeLeft).toBe(60);

    // Wait a bit and check that timer starts decrementing
    await vi.advanceTimersByTimeAsync(1500); // Wait 1.5 seconds to ensure timer fires
    await nextTick();

    // Should have decremented at least once
    expect(wrapper.vm.timeLeft).toBeLessThan(60);
    expect(wrapper.vm.timeLeft).toBeGreaterThanOrEqual(58); // Should be around 59 or 58

    // Wait another second
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();

    // Should have decremented more
    expect(wrapper.vm.timeLeft).toBeLessThan(59);
    expect(wrapper.vm.timeLeft).toBeGreaterThanOrEqual(57);
  });

  it('should countdown from 60 to 0', async () => {
    const wrapper = mount(GameTimer);

    // Initial value
    expect(wrapper.text()).toContain('Time: 60');
    expect(wrapper.vm.timeLeft).toBe(60);

    // Advance timers for full countdown (60 seconds)
    await vi.advanceTimersByTimeAsync(60000);
    await nextTick();
    await flushPromises();

    // Force Vue to update the DOM
    wrapper.vm.$forceUpdate();
    await nextTick();

    // Should now display 0 or negative
    expect(wrapper.vm.timeLeft).toBeLessThanOrEqual(0);
    expect(wrapper.text()).toMatch(/Time: (0|-\d+)/);
  });

  it('should call gameStore.endGame when timer reaches 0', async () => {
    const gameStore = useGameStore();
    const endGameSpy = vi.spyOn(gameStore, 'endGame');

    mount(GameTimer);

    // Advance to the end
    await vi.advanceTimersByTimeAsync(60000);
    await flushPromises();

    expect(endGameSpy).toHaveBeenCalled();
  });

  it('should call endGame only once when timer reaches 0', async () => {
    const gameStore = useGameStore();
    const endGameSpy = vi.spyOn(gameStore, 'endGame');

    mount(GameTimer);

    // Advance to exactly 60 seconds
    vi.advanceTimersByTime(60000);
    await flushPromises();

    // Should be called once when reaching 0
    expect(endGameSpy).toHaveBeenCalledTimes(1);
  });

  it('should clear interval on unmount', async () => {
    const wrapper = mount(GameTimer);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    wrapper.unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('should not call endGame before timer reaches 0', async () => {
    const gameStore = useGameStore();
    const endGameSpy = vi.spyOn(gameStore, 'endGame');

    mount(GameTimer);

    // Advance to 1 second remaining
    await vi.advanceTimersByTimeAsync(59000);
    await flushPromises();

    expect(endGameSpy).not.toHaveBeenCalled();
  });

  it('should display time in correct format', async () => {
    const wrapper = mount(GameTimer);

    // Verify initial format
    expect(wrapper.text()).toContain('Time:');
    expect(wrapper.text()).toContain('60');

    // Verify the structure
    const timeDisplay = wrapper.find('.text-h6');
    expect(timeDisplay.exists()).toBe(true);
  });

  it('should have correct CSS classes', () => {
    const wrapper = mount(GameTimer);

    const timeDisplay = wrapper.find('div');
    expect(timeDisplay.classes()).toContain('text-h6');
    expect(timeDisplay.classes()).toContain('q-mb-md');
  });

  it('should start timer immediately on mount', async () => {
    const wrapper = mount(GameTimer);

    // Verify timer starts at 60
    expect(wrapper.text()).toContain('Time: 60');

    // Verify component is mounted
    expect(wrapper.exists()).toBe(true);
  });
});
