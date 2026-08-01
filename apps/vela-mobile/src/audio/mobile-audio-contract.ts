export type MobileAudioPlaybackOutcome =
  | { kind: 'ended' }
  | { kind: 'stopped'; reason: 'restart' | 'user' | 'dispose' }
  | { kind: 'interrupted'; reason: 'background' | 'external' };

export type MobileAudioErrorCode = 'gesture_required' | 'media_unavailable' | 'playback_failed';

export class MobileAudioError extends Error {
  constructor(
    readonly code: MobileAudioErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileAudioError';
  }
}

export type MobileAudioPlaybackHandle = {
  finished: Promise<MobileAudioPlaybackOutcome>;
  stop(reason?: 'restart' | 'user' | 'dispose'): void;
};

export type MobileAudioPlayer = {
  play(url: string): MobileAudioPlaybackHandle;
  interruptActive(reason: 'background' | 'external'): void;
  dispose(): void;
};
