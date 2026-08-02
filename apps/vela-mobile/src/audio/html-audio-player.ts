import {
  MobileAudioError,
  type MobileAudioInterruptionReason,
  type MobileAudioPlaybackHandle,
  type MobileAudioPlaybackOutcome,
  type MobileAudioPlayer,
  type MobileAudioStopReason,
} from './mobile-audio-contract';

type AudioEvent = 'ended' | 'error' | 'pause';
type AudioListener = () => void;

type HtmlAudioElement = {
  src: string;
  preload: string;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: AudioEvent, listener: AudioListener): void;
  removeEventListener(type: AudioEvent, listener: AudioListener): void;
};

type ActivePlayback = {
  audio: HtmlAudioElement | null;
  settled: boolean;
  resolve: (outcome: MobileAudioPlaybackOutcome) => void;
  reject: (error: MobileAudioError) => void;
  listeners: Record<AudioEvent, AudioListener>;
};

type HtmlAudioElementFactory = (url: string) => HtmlAudioElement;

const defaultAudioElementFactory: HtmlAudioElementFactory = (url) => new Audio(url);

export class HtmlAudioPlayer implements MobileAudioPlayer {
  private active: ActivePlayback | null = null;

  constructor(private readonly createAudio: HtmlAudioElementFactory = defaultAudioElementFactory) {}

  play(url: string): MobileAudioPlaybackHandle {
    this.stopActive('restart');

    const audio = this.createAudio(url);
    audio.preload = 'auto';

    let resolveFinished!: (outcome: MobileAudioPlaybackOutcome) => void;
    let rejectFinished!: (error: MobileAudioError) => void;
    const finished = new Promise<MobileAudioPlaybackOutcome>((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });

    const playback: ActivePlayback = {
      audio,
      settled: false,
      resolve: resolveFinished,
      reject: rejectFinished,
      listeners: {
        ended: () => this.resolve(playback, { kind: 'ended' }),
        error: () => this.reject(playback, new MobileAudioError('media_unavailable')),
        pause: () => this.resolve(playback, { kind: 'interrupted', reason: 'external' }),
      },
    };

    this.attachListeners(playback);
    this.active = playback;

    try {
      void Promise.resolve(audio.play()).catch((cause: unknown) => {
        this.reject(playback, this.playError(cause));
      });
    } catch (cause) {
      this.reject(playback, this.playError(cause));
    }

    return {
      finished,
      stop: (reason = 'user') => this.stop(playback, reason),
    };
  }

  interruptActive(reason: MobileAudioInterruptionReason): void {
    const playback = this.active;
    if (!playback) {
      return;
    }

    this.resolveAndRelease(playback, { kind: 'interrupted', reason });
  }

  dispose(): void {
    this.stopActive('dispose');
  }

  private stopActive(reason: MobileAudioStopReason): void {
    const playback = this.active;
    if (playback) {
      this.stop(playback, reason);
    }
  }

  private stop(playback: ActivePlayback, reason: MobileAudioStopReason): void {
    this.resolveAndRelease(playback, { kind: 'stopped', reason });
  }

  private resolveAndRelease(playback: ActivePlayback, outcome: MobileAudioPlaybackOutcome): void {
    const audio = this.resolve(playback, outcome);
    if (audio) {
      this.resetAndRelease(audio);
    }
  }

  private resolve(
    playback: ActivePlayback,
    outcome: MobileAudioPlaybackOutcome,
  ): HtmlAudioElement | null {
    const audio = this.settle(playback);
    if (audio) {
      playback.resolve(outcome);
    }
    return audio;
  }

  private reject(playback: ActivePlayback, error: MobileAudioError): void {
    const audio = this.settle(playback);
    if (audio) {
      playback.reject(error);
      this.resetAndRelease(audio);
    }
  }

  private settle(playback: ActivePlayback): HtmlAudioElement | null {
    if (playback.settled) {
      return null;
    }

    playback.settled = true;
    const audio = playback.audio;
    if (!audio) {
      return null;
    }

    this.detachListeners(audio, playback.listeners);
    if (this.active === playback) {
      this.active = null;
    }
    playback.audio = null;
    return audio;
  }

  private attachListeners(playback: ActivePlayback): void {
    const audio = playback.audio;
    if (!audio) {
      return;
    }

    audio.addEventListener('ended', playback.listeners.ended);
    audio.addEventListener('error', playback.listeners.error);
    audio.addEventListener('pause', playback.listeners.pause);
  }

  private detachListeners(
    audio: HtmlAudioElement,
    listeners: Record<AudioEvent, AudioListener>,
  ): void {
    audio.removeEventListener('ended', listeners.ended);
    audio.removeEventListener('error', listeners.error);
    audio.removeEventListener('pause', listeners.pause);
  }

  private resetAndRelease(audio: HtmlAudioElement): void {
    try {
      audio.pause();
    } catch {
      // The outcome is already settled; continue releasing the media resource.
    }

    try {
      audio.currentTime = 0;
    } catch {
      // Some media elements reject seeking before metadata is available.
    }

    try {
      audio.src = '';
    } catch {
      // Release is best effort after the public handle has settled.
    }
  }

  private playError(cause: unknown): MobileAudioError {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'name' in cause &&
      cause.name === 'NotAllowedError'
    ) {
      return new MobileAudioError('gesture_required', { cause });
    }

    return new MobileAudioError('playback_failed', { cause });
  }
}
