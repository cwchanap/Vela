import { mount, type VueWrapper } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent, nextTick, reactive, ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator } from 'src/auth/mobile-auth-contract';
import type { MobileFeatureSessionStatus } from 'src/auth/mobile-feature-session-status';
import type {
  PronunciationDiagnosticController,
  PronunciationDiagnosticCounters,
  PronunciationDiagnosticState,
} from 'src/composables/usePronunciationDiagnostic';
import { DIAGNOSTIC_WORD } from 'src/diagnostics/tts-pronunciation-contract';
import { MOBILE_AUTH_KEY } from 'src/services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from 'src/services/mobile-services';
import type { MobileTtsService, PreparedPronunciation } from 'src/services/mobile-tts';
import TtsPronunciationDiagnosticsPage from './TtsPronunciationDiagnosticsPage.vue';

const composableMocks = vi.hoisted(() => ({
  usePronunciationDiagnostic: vi.fn(),
}));

vi.mock('src/composables/usePronunciationDiagnostic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/composables/usePronunciationDiagnostic')>()),
  usePronunciationDiagnostic: composableMocks.usePronunciationDiagnostic,
}));

const PageHost = defineComponent({
  components: { QLayout, QPageContainer, TtsPronunciationDiagnosticsPage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><tts-pronunciation-diagnostics-page /></q-page-container></q-layout>',
});

const SIGNED_URL =
  'https://audio.example.test/tts/sentinel-user-id/sentinel-vocabulary-id/01234567abcdef89?X-Amz-Credential=provider-secret&X-Amz-Signature=signed-secret';

const PREPARED: PreparedPronunciation = {
  audioUrl: SIGNED_URL,
  source: 'generated',
  expiresAt: 20_000,
  timings: { settingsMs: 12, generateMs: 345 },
};

type MutableController = Omit<PronunciationDiagnosticController, 'state' | 'sessionStatus'> & {
  state: Ref<PronunciationDiagnosticState>;
  sessionStatus: Ref<MobileFeatureSessionStatus>;
  playOrRetry: ReturnType<typeof vi.fn<PronunciationDiagnosticController['playOrRetry']>>;
  invalidatePronunciation: ReturnType<
    typeof vi.fn<PronunciationDiagnosticController['invalidatePronunciation']>
  >;
  simulateInvalidUrl: ReturnType<
    typeof vi.fn<PronunciationDiagnosticController['simulateInvalidUrl']>
  >;
  clearCounters: ReturnType<typeof vi.fn<PronunciationDiagnosticController['clearCounters']>>;
  dispose: ReturnType<typeof vi.fn<PronunciationDiagnosticController['dispose']>>;
};

type MutableCounters = {
  [Key in keyof PronunciationDiagnosticCounters]: Ref<
    PronunciationDiagnosticCounters[Key]['value']
  >;
};

function counterFixture(overrides: Partial<{ [Key in keyof MutableCounters]: unknown }> = {}) {
  return {
    preparations: ref(overrides.preparations ?? 0),
    playbackAttempts: ref(overrides.playbackAttempts ?? 0),
    completedPlays: ref(overrides.completedPlays ?? 0),
    gestureRejections: ref(overrides.gestureRejections ?? 0),
    interruptions: ref(overrides.interruptions ?? 0),
    urlRefreshes: ref(overrides.urlRefreshes ?? 0),
    tapToPlayAttemptMs: ref(overrides.tapToPlayAttemptMs ?? null),
    lastError: ref(overrides.lastError ?? null),
  } as MutableCounters;
}

function controllerFixture(
  state: PronunciationDiagnosticState = { kind: 'idle' },
  options: {
    counters?: MutableCounters;
    sessionStatus?: MobileFeatureSessionStatus;
  } = {},
): MutableController {
  return {
    state: ref(state),
    sessionStatus: ref(options.sessionStatus ?? { kind: 'usable', userId: 'user-1' }),
    counters: options.counters ?? counterFixture(),
    playOrRetry: vi.fn().mockResolvedValue(undefined),
    invalidatePronunciation: vi.fn(),
    simulateInvalidUrl: vi.fn(),
    clearCounters: vi.fn(),
    dispose: vi.fn(),
  };
}

function authCoordinatorFixture(): MobileAuthCoordinator {
  return {
    state: reactive({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: { userId: 'user-1', email: null },
    }),
  } as MobileAuthCoordinator;
}

function ttsServiceFixture(): MobileTtsService {
  return {
    preparePronunciation: vi.fn(),
    invalidatePronunciation: vi.fn(),
    clearUser: vi.fn(),
    clearAll: vi.fn(),
  };
}

function mountPageWithController(
  controller: MutableController,
  dependencies: {
    coordinator?: MobileAuthCoordinator;
    ttsService?: MobileTtsService;
  } = {},
): VueWrapper {
  const coordinator = dependencies.coordinator ?? authCoordinatorFixture();
  const ttsService = dependencies.ttsService ?? ttsServiceFixture();
  composableMocks.usePronunciationDiagnostic.mockReturnValue(controller);

  return mount(PageHost, {
    global: {
      plugins: [Quasar],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
        [MOBILE_TTS_SERVICE_KEY as symbol]: ttsService,
      },
    },
  });
}

function statusRegion(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="tts-state-message"]');
}

beforeEach(() => {
  composableMocks.usePronunciationDiagnostic.mockReset();
});

describe('TtsPronunciationDiagnosticsPage', () => {
  it('renders the fixed pronunciation and wires only the injected controller dependencies', () => {
    const controller = controllerFixture();
    const coordinator = authCoordinatorFixture();
    const ttsService = ttsServiceFixture();
    const wrapper = mountPageWithController(controller, { coordinator, ttsService });

    expect(wrapper.get('h1').text()).toBe(DIAGNOSTIC_WORD.text);
    expect(wrapper.get('[data-testid="tts-reading"]').text()).toContain(DIAGNOSTIC_WORD.reading);
    expect(wrapper.get('[data-testid="tts-translation"]').text()).toContain(
      DIAGNOSTIC_WORD.translation,
    );
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Prepare and play pronunciation',
    );
    expect(statusRegion(wrapper).attributes()).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    expect(composableMocks.usePronunciationDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { vocabularyId: '水:ミズ', text: '水' },
        authState: coordinator.state,
        ttsService,
        audioPlayer: expect.objectContaining({
          play: expect.any(Function),
          interruptActive: expect.any(Function),
          dispose: expect.any(Function),
        }),
      }),
    );
  });

  it('renders ordinary and session-recovery preparation accessibly and disables every action', async () => {
    const controller = controllerFixture();
    const wrapper = mountPageWithController(controller);

    controller.state.value = { kind: 'preparing', attempt: 1, recoveringSession: false };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('Preparing pronunciation');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('disabled')).toBeDefined();

    controller.state.value = { kind: 'preparing', attempt: 2, recoveringSession: true };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('Recovering your session');
    for (const selector of [
      '[data-testid="tts-play-button"]',
      '[data-testid="tts-invalidate-button"]',
      '[data-testid="tts-invalid-url-button"]',
      '[data-testid="tts-clear-counters-button"]',
    ]) {
      expect(wrapper.get(selector).attributes('disabled')).toBeDefined();
    }
  });

  it('renders playing and prepared states with accurate restart and play labels', async () => {
    const controller = controllerFixture({ kind: 'playing', pronunciation: PREPARED });
    const wrapper = mountPageWithController(controller);

    expect(statusRegion(wrapper).text()).toContain('Playing pronunciation');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Restart pronunciation',
    );

    controller.state.value = { kind: 'ready', pronunciation: PREPARED, notice: null };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('prepared and ready to play');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Play pronunciation',
    );
  });

  it('keeps ready-state wording neutral when cumulative counters are cleared', async () => {
    const counters = counterFixture({ completedPlays: 4 });
    const controller = controllerFixture(
      { kind: 'ready', pronunciation: PREPARED, notice: null },
      { counters },
    );
    const wrapper = mountPageWithController(controller);

    expect(statusRegion(wrapper).text()).toContain('prepared and ready to play');
    expect(statusRegion(wrapper).text()).not.toContain('completed');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Play pronunciation',
    );

    counters.completedPlays.value = 0;
    await nextTick();

    expect(statusRegion(wrapper).text()).toContain('prepared and ready to play');
    expect(statusRegion(wrapper).text()).not.toContain('completed');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Play pronunciation',
    );
  });

  it('does not claim completion after a previous completion is followed by prepare without play', async () => {
    const counters = counterFixture({ completedPlays: 1 });
    const controller = controllerFixture(
      { kind: 'ready', pronunciation: PREPARED, notice: null },
      { counters },
    );
    const wrapper = mountPageWithController(controller);

    controller.state.value = { kind: 'preparing', attempt: 2, recoveringSession: false };
    await nextTick();
    controller.state.value = { kind: 'ready', pronunciation: PREPARED, notice: null };
    await nextTick();

    expect(statusRegion(wrapper).text()).toContain('prepared and ready to play');
    expect(statusRegion(wrapper).text()).not.toContain('completed');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Play pronunciation',
    );
  });

  it('renders gesture-required, interrupted, and refreshed-audio states with safe recovery labels', async () => {
    const controller = controllerFixture({
      kind: 'ready',
      pronunciation: PREPARED,
      notice: 'gesture_required',
    });
    const wrapper = mountPageWithController(controller);

    expect(statusRegion(wrapper).text()).toContain('direct tap');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Tap to play pronunciation',
    );

    controller.state.value = {
      kind: 'interrupted',
      pronunciation: PREPARED,
      reason: 'background',
    };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('app moved to the background');
    expect(statusRegion(wrapper).text()).toContain('replay from the beginning');
    expect(statusRegion(wrapper).text().toLowerCase()).not.toContain('resume');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Replay pronunciation',
    );
    expect(wrapper.get('[data-testid="tts-play-button"]').text()).toContain('Replay');

    controller.state.value = {
      kind: 'interrupted',
      pronunciation: PREPARED,
      reason: 'external',
    };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('another audio source');
    expect(statusRegion(wrapper).text()).toContain('replay from the beginning');
    expect(statusRegion(wrapper).text().toLowerCase()).not.toContain('resume');

    controller.state.value = {
      kind: 'ready',
      pronunciation: PREPARED,
      notice: 'audio_refreshed',
    };
    await nextTick();
    expect(statusRegion(wrapper).text()).toContain('audio link was refreshed');
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Play refreshed pronunciation',
    );
  });

  it.each([
    ['invalid_input', 'fixed pronunciation request is invalid'],
    ['network', 'network or request deadline'],
    ['generation_timeout', 'pronunciation provider timed out'],
    ['service_unavailable', 'pronunciation service is temporarily unavailable'],
    ['generation_failed', 'pronunciation provider could not generate audio'],
    ['playback_failed', 'pronunciation playback failed'],
  ] as const)('renders %s as an assertive, stable retry state', (error, message) => {
    const controller = controllerFixture({ kind: 'error', error, pronunciation: null });
    const wrapper = mountPageWithController(controller);

    expect(statusRegion(wrapper).attributes()).toMatchObject({
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
    });
    expect(statusRegion(wrapper).text().toLowerCase()).toContain(message);
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
      'Retry pronunciation',
    );
  });

  it('renders safe counters, source, timings, and only a redacted audio host and hash suffix', () => {
    const controller = controllerFixture(
      { kind: 'ready', pronunciation: PREPARED, notice: 'audio_refreshed' },
      {
        counters: counterFixture({
          preparations: 2,
          playbackAttempts: 3,
          completedPlays: 1,
          gestureRejections: 1,
          interruptions: 2,
          urlRefreshes: 1,
          tapToPlayAttemptMs: 48,
          lastError: 'media_unavailable',
        }),
      },
    );
    const wrapper = mountPageWithController(controller);

    expect(wrapper.get('[data-testid="tts-source"]').text()).toContain('Generated');
    expect(wrapper.get('[data-testid="tts-settings-timing"]').text()).toContain('12 ms');
    expect(wrapper.get('[data-testid="tts-generation-timing"]').text()).toContain('345 ms');
    expect(wrapper.get('[data-testid="tts-audio-location"]').text()).toContain(
      'audio.example.test/…/abcdef89',
    );
    expect(wrapper.get('[data-testid="tts-tap-timing"]').text()).toContain('48 ms');
    expect(wrapper.get('[data-testid="tts-last-error"]').text()).toContain(
      'Prepared audio unavailable',
    );
    expect(wrapper.text()).toContain('Preparations 2');
    expect(wrapper.text()).toContain('Playback attempts 3');
    expect(wrapper.text()).toContain('Completed plays 1');
    expect(wrapper.text()).toContain('Gesture rejections 1');
    expect(wrapper.text()).toContain('Interruptions 2');
    expect(wrapper.text()).toContain('URL refreshes 1');
    expect(wrapper.get('[data-testid="tts-audio-location"]').text()).not.toContain('?');
    expect(wrapper.text()).not.toContain('X-Amz-Credential');
    expect(wrapper.text()).not.toContain('X-Amz-Signature');
    expect(wrapper.text()).not.toContain('provider-secret');
    expect(wrapper.text()).not.toContain('signed-secret');
    expect(wrapper.text()).not.toContain('sentinel-user-id');
    expect(wrapper.text()).not.toContain('sentinel-vocabulary-id');
  });

  it('never renders raw failure details, credentials, tokens, payloads, or signed query strings', () => {
    const unsafeState = {
      kind: 'error',
      error: 'generation_failed',
      pronunciation: PREPARED,
      serverMessage: 'provider credential rejected',
      providerCredential: 'provider-key-secret',
      token: 'cognito-token-secret',
      requestPayload: { vocabularyId: 'secret-request-payload' },
    } as PronunciationDiagnosticState;
    const controller = controllerFixture(unsafeState);
    const wrapper = mountPageWithController(controller);

    expect(wrapper.text()).toContain('audio.example.test/…/abcdef89');
    for (const forbidden of [
      'provider credential rejected',
      'provider-key-secret',
      'cognito-token-secret',
      'secret-request-payload',
      'X-Amz-Credential',
      'X-Amz-Signature',
      'provider-secret',
      'signed-secret',
      'sentinel-user-id',
      'sentinel-vocabulary-id',
    ]) {
      expect(wrapper.text()).not.toContain(forbidden);
      expect(wrapper.html()).not.toContain(forbidden);
    }
  });

  it('directs not-configured users to Vela web settings', () => {
    const controller = controllerFixture({
      kind: 'error',
      error: 'not_configured',
      pronunciation: null,
    });
    const wrapper = mountPageWithController(controller);

    expect(statusRegion(wrapper).text()).toContain('Configure TTS in Vela web settings');
  });

  it('wires replay and development actions to the controller with mobile touch targets', async () => {
    const controller = controllerFixture({ kind: 'ready', pronunciation: PREPARED, notice: null });
    const wrapper = mountPageWithController(controller);

    const actions = [
      ['[data-testid="tts-play-button"]', controller.playOrRetry],
      ['[data-testid="tts-invalidate-button"]', controller.invalidatePronunciation],
      ['[data-testid="tts-invalid-url-button"]', controller.simulateInvalidUrl],
      ['[data-testid="tts-clear-counters-button"]', controller.clearCounters],
    ] as const;

    for (const [selector, action] of actions) {
      const button = wrapper.get(selector);
      expect(button.classes()).toContain('mobile-touch-target');
      await button.trigger('click');
      expect(action).toHaveBeenCalledTimes(1);
    }
  });

  it('disables playback when the authenticated feature session is not usable', async () => {
    const controller = controllerFixture(
      { kind: 'idle' },
      { sessionStatus: { kind: 'recovering', userId: 'user-1', sessionUsable: false } },
    );
    const wrapper = mountPageWithController(controller);

    expect(wrapper.get('[data-testid="tts-session-status"]').text()).toContain(
      'Session recovering',
    );
    expect(wrapper.get('[data-testid="tts-play-button"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="tts-play-button"]').trigger('click');
    expect(controller.playOrRetry).not.toHaveBeenCalled();

    controller.sessionStatus.value = { kind: 'unavailable' };
    await nextTick();
    expect(wrapper.get('[data-testid="tts-session-status"]').text()).toContain(
      'Session unavailable',
    );
  });

  it('disposes the controller when the diagnostic page unmounts', () => {
    const controller = controllerFixture();
    const wrapper = mountPageWithController(controller);

    wrapper.unmount();

    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });
});
