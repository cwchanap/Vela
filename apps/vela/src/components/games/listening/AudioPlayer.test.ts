import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import type { Component } from 'vue';

const mockPlayAudio = vi.fn();
let AudioPlayer: Component;

type PlaybackHandle = {
  audio: HTMLAudioElement;
  finished: Promise<void>;
  stop: ReturnType<typeof vi.fn>;
  resolve: () => void;
  reject: (_error: Error) => void;
};

function createPlaybackHandle(): PlaybackHandle {
  let resolve!: () => void;
  let reject!: (_error: Error) => void;

  return {
    audio: { src: '' } as HTMLAudioElement,
    finished: new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
    stop: vi.fn(() => resolve()),
    resolve: () => resolve(),
    reject: (error: Error) => reject(error),
  };
}

const mountComponent = (props?: {
  audioUrl?: string | null;
  isLoading?: boolean;
  autoPlay?: boolean;
}) =>
  mount(AudioPlayer, {
    props: {
      audioUrl: null,
      isLoading: false,
      ...props,
    },
    global: { plugins: [Quasar] },
  });

describe('AudioPlayer', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('src/services/ttsService', () => ({
      playAudio: mockPlayAudio,
    }));
    AudioPlayer = (await import('./AudioPlayer.vue')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels in-flight playback before auto-playing a new audio URL', async () => {
    const firstPlayback = createPlaybackHandle();
    const secondPlayback = createPlaybackHandle();

    mockPlayAudio.mockReturnValueOnce(firstPlayback).mockReturnValueOnce(secondPlayback);

    const wrapper = mountComponent();

    await wrapper.setProps({ audioUrl: 'https://example.com/one.mp3' });
    await flushPromises();

    await wrapper.setProps({ audioUrl: 'https://example.com/two.mp3' });
    await flushPromises();

    expect(firstPlayback.stop).toHaveBeenCalledTimes(1);
    expect(mockPlayAudio).toHaveBeenNthCalledWith(1, 'https://example.com/one.mp3');
    expect(mockPlayAudio).toHaveBeenNthCalledWith(2, 'https://example.com/two.mp3');
  });

  it('stops the active playback when the component unmounts', async () => {
    const playback = createPlaybackHandle();
    mockPlayAudio.mockReturnValue(playback);

    const wrapper = mountComponent();

    await wrapper.setProps({ audioUrl: 'https://example.com/one.mp3' });
    await flushPromises();

    wrapper.unmount();

    expect(playback.stop).toHaveBeenCalledTimes(1);
  });

  it('shows playback errors and clears them when retrying', async () => {
    const playbackError = new Error('Playback failed');
    const failedPlayback = createPlaybackHandle();
    const retryPlayback = createPlaybackHandle();
    void failedPlayback.finished.catch(() => undefined);

    mockPlayAudio
      .mockImplementationOnce(() => {
        queueMicrotask(() => failedPlayback.reject(playbackError));
        return failedPlayback;
      })
      .mockReturnValueOnce(retryPlayback);

    const wrapper = mountComponent();

    await wrapper.setProps({ audioUrl: 'https://example.com/fail.mp3' });
    await vi.waitFor(() => {
      expect(wrapper.emitted('error')).toHaveLength(1);
      expect(wrapper.text()).toContain('Audio playback failed. Try again.');
    });

    await wrapper.get('[aria-label="Dismiss audio playback error"]').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).not.toContain('Audio playback failed. Try again.');
    });
  });
});
