export type MobileAudioStopReason = 'restart' | 'user' | 'dispose';
export type MobileAudioInterruptionReason = 'background' | 'external';

export type MobileAudioPlaybackOutcome =
  | { kind: 'ended' }
  | { kind: 'stopped'; reason: MobileAudioStopReason }
  | { kind: 'interrupted'; reason: MobileAudioInterruptionReason };

export type MobileAudioErrorCode = 'gesture_required' | 'media_unavailable' | 'playback_failed';

export class MobileAudioError extends Error {
  constructor(
    readonly code: MobileAudioErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    Object.defineProperty(this, 'name', {
      value: 'MobileAudioError',
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

export type MobileAudioPlaybackHandle = {
  finished: Promise<MobileAudioPlaybackOutcome>;
  stop(reason?: MobileAudioStopReason): void;
};

export type MobileAudioPlayer = {
  play(url: string): MobileAudioPlaybackHandle;
  interruptActive(reason: MobileAudioInterruptionReason): void;
  dispose(): void;
};
