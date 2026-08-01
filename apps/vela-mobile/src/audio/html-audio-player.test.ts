import { beforeEach, describe, expect, it } from 'vitest';
import { MobileAudioError } from './mobile-audio-contract';
import { HtmlAudioPlayer } from './html-audio-player';

type AudioEvent = 'ended' | 'error' | 'pause';
type AudioListener = () => void;

class FakeAudioElement {
  private readonly listeners = new Map<AudioEvent, Set<AudioListener>>();
  private source: string;
  private playbackTime = 12;

  preload = '';
  pauseCalls = 0;
  playCalls = 0;
  crossOriginAssignments = 0;
  readonly operations: string[] = [];

  constructor(
    url: string,
    private readonly playError: unknown,
  ) {
    this.source = url;
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.operations.push(`src:${value}`);
    this.source = value;
  }

  get currentTime(): number {
    return this.playbackTime;
  }

  set currentTime(value: number) {
    this.operations.push(`currentTime:${value}`);
    this.playbackTime = value;
  }

  set crossOrigin(_value: string | null) {
    this.crossOriginAssignments += 1;
  }

  addEventListener(type: AudioEvent, listener: AudioListener): void {
    const listeners = this.listeners.get(type) ?? new Set<AudioListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    this.operations.push(`add:${type}`);
  }

  removeEventListener(type: AudioEvent, listener: AudioListener): void {
    this.listeners.get(type)?.delete(listener);
    this.operations.push(`remove:${type}`);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    if (this.playError !== undefined) {
      return Promise.reject(this.playError);
    }
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.operations.push('pause');
    this.dispatch('pause');
  }

  dispatch(type: AudioEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

class FakeAudioFactory {
  nextPlayError: unknown;
  readonly elements: FakeAudioElement[] = [];

  readonly create = (url: string): FakeAudioElement => {
    const element = new FakeAudioElement(url, this.nextPlayError);
    this.nextPlayError = undefined;
    this.elements.push(element);
    return element;
  };

  elementFor(url: string): FakeAudioElement {
    const element = this.elements.find((candidate) => candidate.src === url);
    if (!element) {
      throw new Error(`No audio element for ${url}`);
    }
    return element;
  }

  activeElements(): FakeAudioElement[] {
    return this.elements.filter((element) => element.src !== '');
  }
}

describe('HtmlAudioPlayer', () => {
  let factory: FakeAudioFactory;
  let player: HtmlAudioPlayer;

  beforeEach(() => {
    factory = new FakeAudioFactory();
    player = new HtmlAudioPlayer(factory.create);
  });

  it('settles restart before synchronous pause can become interruption', async () => {
    const first = player.play('https://audio.example.test/one.mp3');
    const second = player.play('https://audio.example.test/two.mp3');

    await expect(first.finished).resolves.toEqual({ kind: 'stopped', reason: 'restart' });
    expect(factory.activeElements()).toHaveLength(1);

    factory.elementFor('https://audio.example.test/two.mp3').dispatch('ended');
    await expect(second.finished).resolves.toEqual({ kind: 'ended' });
  });

  it('maps a rejected play caused by user activation to gesture_required', async () => {
    factory.nextPlayError = new DOMException('Not allowed', 'NotAllowedError');

    await expect(player.play('https://audio.example.test/mizu.mp3').finished).rejects.toMatchObject(
      {
        name: 'MobileAudioError',
        code: 'gesture_required',
      },
    );
  });

  it('maps a media element error to media_unavailable', async () => {
    const handle = player.play('https://audio.example.test/missing.mp3');
    factory.elementFor('https://audio.example.test/missing.mp3').dispatch('error');

    await expect(handle.finished).rejects.toMatchObject({
      name: 'MobileAudioError',
      code: 'media_unavailable',
    });
  });

  it('maps any other play rejection to playback_failed and preserves the cause', async () => {
    const cause = new Error('decoder rejected playback');
    factory.nextPlayError = cause;

    await expect(player.play('https://audio.example.test/failed.mp3').finished).rejects.toEqual(
      new MobileAudioError('playback_failed', { cause }),
    );
  });

  it('treats an unexplained active pause as an external interruption', async () => {
    const handle = player.play('https://audio.example.test/paused.mp3');
    factory.elementFor('https://audio.example.test/paused.mp3').dispatch('pause');

    await expect(handle.finished).resolves.toEqual({ kind: 'interrupted', reason: 'external' });
  });

  it('stops explicitly as user intent and cleans up in safe order', async () => {
    const handle = player.play('https://audio.example.test/stopped.mp3');
    const element = factory.elementFor('https://audio.example.test/stopped.mp3');

    handle.stop();

    await expect(handle.finished).resolves.toEqual({ kind: 'stopped', reason: 'user' });
    expect(element.pauseCalls).toBe(1);
    expect(element.currentTime).toBe(0);
    expect(element.src).toBe('');
    expect(element.listenerCount()).toBe(0);
    expect(element.operations).toEqual([
      'add:ended',
      'add:error',
      'add:pause',
      'remove:ended',
      'remove:error',
      'remove:pause',
      'pause',
      'currentTime:0',
      'src:',
    ]);
  });

  it('settles a background interruption before pausing and releasing the element', async () => {
    const handle = player.play('https://audio.example.test/background.mp3');
    const element = factory.elementFor('https://audio.example.test/background.mp3');

    player.interruptActive('background');

    await expect(handle.finished).resolves.toEqual({
      kind: 'interrupted',
      reason: 'background',
    });
    expect(element.pauseCalls).toBe(1);
    expect(element.listenerCount()).toBe(0);
    expect(element.src).toBe('');
  });

  it('settles dispose before synchronous pause and makes repeated disposal harmless', async () => {
    const handle = player.play('https://audio.example.test/dispose.mp3');
    const element = factory.elementFor('https://audio.example.test/dispose.mp3');

    player.dispose();
    player.dispose();

    await expect(handle.finished).resolves.toEqual({ kind: 'stopped', reason: 'dispose' });
    expect(element.pauseCalls).toBe(1);
    expect(element.listenerCount()).toBe(0);
    expect(element.src).toBe('');
  });

  it('removes listeners after natural settlement', async () => {
    const handle = player.play('https://audio.example.test/ended.mp3');
    const element = factory.elementFor('https://audio.example.test/ended.mp3');

    element.dispatch('ended');

    await expect(handle.finished).resolves.toEqual({ kind: 'ended' });
    expect(element.listenerCount()).toBe(0);
  });

  it('settles each handle exactly once when later events and stop race with completion', async () => {
    const handle = player.play('https://audio.example.test/race.mp3');
    const element = factory.elementFor('https://audio.example.test/race.mp3');

    element.dispatch('ended');
    element.dispatch('error');
    element.dispatch('pause');
    handle.stop('restart');

    await expect(handle.finished).resolves.toEqual({ kind: 'ended' });
    expect(element.pauseCalls).toBe(0);
  });

  it('preloads automatically, starts immediately, and leaves cross-origin unset', () => {
    player.play('https://audio.example.test/configured.mp3');
    const element = factory.elementFor('https://audio.example.test/configured.mp3');

    expect(element.preload).toBe('auto');
    expect(element.playCalls).toBe(1);
    expect(element.crossOriginAssignments).toBe(0);
  });
});
