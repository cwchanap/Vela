import { flushPromises, mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import type { Component } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTTSSettings = vi.fn();
let ListeningSetup: Component;

const mountComponent = (props?: { isStarting?: boolean }) =>
  mount(ListeningSetup, {
    props: {
      isStarting: false,
      ...props,
    },
    global: {
      plugins: [Quasar],
      stubs: {
        JlptLevelSelector: {
          template: '<div class="jlpt-level-selector-stub" />',
          props: ['modelValue'],
          emits: ['update:modelValue'],
        },
        QSpinnerDots: { template: '<div class="spinner-stub" />' },
      },
    },
  });

describe('ListeningSetup', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('src/services/ttsService', () => ({
      getTTSSettings: mockGetTTSSettings,
    }));
    ListeningSetup = (await import('./ListeningSetup.vue')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('shows loading spinner before TTS settings are fetched', async () => {
      // Never resolves during this test
      mockGetTTSSettings.mockReturnValue(new Promise(() => {}));
      const wrapper = mountComponent();
      expect(wrapper.find('.spinner-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('does not show the game config while loading', async () => {
      mockGetTTSSettings.mockReturnValue(new Promise(() => {}));
      const wrapper = mountComponent();
      expect(wrapper.text()).not.toContain('Question Mode');
      expect(wrapper.text()).not.toContain('Start Listening');
      wrapper.unmount();
    });
  });

  describe('ready state (TTS configured)', () => {
    beforeEach(() => {
      mockGetTTSSettings.mockResolvedValue({ hasApiKey: true });
    });

    it('shows mode selection after TTS is confirmed ready', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Question Mode');
      wrapper.unmount();
    });

    it('shows audio source selection', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Audio Source');
      wrapper.unmount();
    });

    it('renders the JLPT level selector', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('.jlpt-level-selector-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows the Start Listening button', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Start Listening');
      wrapper.unmount();
    });

    it('does not show warning or error banners', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Text-to-speech is required');
      expect(wrapper.text()).not.toContain('Could not check text-to-speech');
      wrapper.unmount();
    });

    it('emits start event with default config when Start Listening is clicked', async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const startBtn = wrapper.findAll('button').find((b) => b.text().includes('Start Listening'));
      expect(startBtn).toBeDefined();
      await startBtn!.trigger('click');

      expect(wrapper.emitted('start')).toHaveLength(1);
      expect(wrapper.emitted('start')![0]).toEqual([
        {
          mode: 'multiple-choice',
          source: 'vocabulary',
          jlptLevels: [],
        },
      ]);
      wrapper.unmount();
    });

    it('shows loading indicator on the Start button when isStarting=true', async () => {
      const wrapper = mountComponent({ isStarting: true });
      await flushPromises();
      // Quasar hides the button content and shows a spinner when loading prop is true
      expect(wrapper.html()).toContain('q-btn__content--hidden');
      wrapper.unmount();
    });
  });

  describe('missing state (TTS not configured)', () => {
    beforeEach(() => {
      mockGetTTSSettings.mockResolvedValue({ hasApiKey: false });
    });

    it('shows the missing TTS warning banner', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Text-to-speech is required');
      wrapper.unmount();
    });

    it('shows a Go to Settings action in the banner', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Go to Settings');
      wrapper.unmount();
    });

    it('does not show the Start Listening button', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Start Listening');
      wrapper.unmount();
    });

    it('does not show the game config UI', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Question Mode');
      wrapper.unmount();
    });
  });

  describe('error state (TTS fetch failed)', () => {
    beforeEach(() => {
      mockGetTTSSettings.mockRejectedValue(new Error('Network error'));
    });

    it('shows the error banner when TTS settings fetch fails', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Could not check text-to-speech');
      wrapper.unmount();
    });

    it('shows a Retry action in the error banner', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Retry');
      wrapper.unmount();
    });

    it('does not show the Start Listening button in error state', async () => {
      const wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Start Listening');
      wrapper.unmount();
    });
  });

  describe('recheckTtsStatus (Retry button)', () => {
    it('re-fetches TTS settings and transitions to ready on retry success', async () => {
      mockGetTTSSettings
        .mockRejectedValueOnce(new Error('first failure'))
        .mockResolvedValueOnce({ hasApiKey: true });

      const wrapper = mountComponent();
      await flushPromises();

      // Should be in error state
      expect(wrapper.text()).toContain('Could not check text-to-speech');

      // Click Retry
      const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'));
      expect(retryBtn).toBeDefined();
      await retryBtn!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Start Listening');
      expect(wrapper.text()).not.toContain('Could not check text-to-speech');
      wrapper.unmount();
    });

    it('transitions back to loading while rechecking', async () => {
      let resolveRetry!: () => void;
      mockGetTTSSettings.mockRejectedValueOnce(new Error('first failure')).mockReturnValueOnce(
        new Promise<{ hasApiKey: boolean }>((res) => {
          resolveRetry = () => res({ hasApiKey: true });
        }),
      );

      const wrapper = mountComponent();
      await flushPromises();

      const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'));
      expect(retryBtn).toBeDefined();
      await retryBtn!.trigger('click');
      // Still loading - spinner should appear
      expect(wrapper.find('.spinner-stub').exists()).toBe(true);

      resolveRetry();
      await flushPromises();
      expect(wrapper.text()).toContain('Start Listening');
      wrapper.unmount();
    });

    it('stays in error state when retry also fails', async () => {
      mockGetTTSSettings
        .mockRejectedValueOnce(new Error('first failure'))
        .mockRejectedValueOnce(new Error('second failure'));

      const wrapper = mountComponent();
      await flushPromises();

      const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'));
      expect(retryBtn).toBeDefined();
      await retryBtn!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Could not check text-to-speech');
      wrapper.unmount();
    });

    it('transitions to missing state when retry reveals TTS is not configured', async () => {
      mockGetTTSSettings
        .mockRejectedValueOnce(new Error('first failure'))
        .mockResolvedValueOnce({ hasApiKey: false });

      const wrapper = mountComponent();
      await flushPromises();

      const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'));
      expect(retryBtn).toBeDefined();
      await retryBtn!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Text-to-speech is required');
      wrapper.unmount();
    });

    it('calls getTTSSettings exactly twice (mount + retry)', async () => {
      mockGetTTSSettings
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ hasApiKey: true });

      const wrapper = mountComponent();
      await flushPromises();

      const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('Retry'));
      expect(retryBtn).toBeDefined();
      await retryBtn!.trigger('click');
      await flushPromises();

      expect(mockGetTTSSettings).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    });
  });
});
