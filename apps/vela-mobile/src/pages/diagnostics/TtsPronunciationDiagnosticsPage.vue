<template>
  <q-page
    padding
    class="tts-pronunciation-page"
    :data-testid="TTS_PRONUNCIATION_DIAGNOSTICS_MARKER"
  >
    <main class="column q-gutter-lg" aria-labelledby="tts-diagnostic-word">
      <section class="pronunciation-card column items-center q-gutter-xs text-center">
        <h1 id="tts-diagnostic-word" class="text-h2 q-my-none" lang="ja">
          {{ DIAGNOSTIC_WORD.text }}
        </h1>
        <p data-testid="tts-reading" class="text-h6 q-my-none" lang="ja">
          Reading: {{ DIAGNOSTIC_WORD.reading }}
        </p>
        <p data-testid="tts-translation" class="text-body1 text-grey-7 q-my-none">
          Translation: {{ DIAGNOSTIC_WORD.translation }}
        </p>
      </section>

      <section class="column q-gutter-sm" aria-labelledby="tts-playback-heading">
        <h2 id="tts-playback-heading" class="text-h6 q-my-none">Playback</h2>
        <p data-testid="tts-session-status" class="text-caption q-my-none">
          {{ sessionStatusLabel }}
        </p>
        <p
          data-testid="tts-state-message"
          class="state-message q-my-none"
          :role="stateMessageRole"
          :aria-live="stateMessageLive"
          aria-atomic="true"
        >
          {{ stateMessage }}
        </p>
        <q-btn
          data-testid="tts-play-button"
          class="mobile-touch-target full-width"
          color="primary"
          :label="playButtonLabel"
          :aria-label="playButtonAriaLabel"
          :loading="state.kind === 'preparing'"
          :disable="playbackDisabled"
          @click="playOrRetry"
        />
      </section>

      <section v-if="pronunciation" class="column q-gutter-xs" aria-labelledby="tts-audio-heading">
        <h2 id="tts-audio-heading" class="text-h6 q-my-none">Prepared audio</h2>
        <p data-testid="tts-source" class="q-my-none">Source: {{ sourceLabel }}</p>
        <p data-testid="tts-settings-timing" class="q-my-none">
          Settings: {{ formatMilliseconds(pronunciation.timings.settingsMs) }}
        </p>
        <p data-testid="tts-generation-timing" class="q-my-none">
          Generation: {{ formatMilliseconds(pronunciation.timings.generateMs) }}
        </p>
        <p v-if="safeAudioLocation" data-testid="tts-audio-location" class="q-my-none">
          Audio location: {{ safeAudioLocation }}
        </p>
      </section>

      <section class="column q-gutter-xs" aria-labelledby="tts-counters-heading">
        <h2 id="tts-counters-heading" class="text-h6 q-my-none">Diagnostic counters</h2>
        <p class="q-my-none">
          Preparations {{ formatCount(controller.counters.preparations.value) }}
        </p>
        <p class="q-my-none">
          Playback attempts {{ formatCount(controller.counters.playbackAttempts.value) }}
        </p>
        <p class="q-my-none">
          Completed plays {{ formatCount(controller.counters.completedPlays.value) }}
        </p>
        <p class="q-my-none">
          Gesture rejections {{ formatCount(controller.counters.gestureRejections.value) }}
        </p>
        <p class="q-my-none">
          Interruptions {{ formatCount(controller.counters.interruptions.value) }}
        </p>
        <p class="q-my-none">
          URL refreshes {{ formatCount(controller.counters.urlRefreshes.value) }}
        </p>
        <p data-testid="tts-tap-timing" class="q-my-none">
          Tap to playback attempt:
          {{ formatOptionalMilliseconds(controller.counters.tapToPlayAttemptMs.value) }}
        </p>
        <p data-testid="tts-last-error" class="q-my-none">Last error: {{ lastErrorLabel }}</p>
      </section>

      <section class="column q-gutter-sm" aria-labelledby="tts-actions-heading">
        <h2 id="tts-actions-heading" class="text-h6 q-my-none">Development actions</h2>
        <q-btn
          data-testid="tts-invalidate-button"
          class="mobile-touch-target full-width"
          outline
          label="Invalidate cached pronunciation"
          aria-label="Invalidate cached pronunciation"
          :disable="diagnosticActionsDisabled"
          @click="controller.invalidatePronunciation"
        />
        <q-btn
          data-testid="tts-invalid-url-button"
          class="mobile-touch-target full-width"
          outline
          label="Simulate invalid audio URL"
          aria-label="Simulate invalid audio URL"
          :disable="diagnosticActionsDisabled || !canSimulateInvalidUrl"
          @click="controller.simulateInvalidUrl"
        />
        <q-btn
          data-testid="tts-clear-counters-button"
          class="mobile-touch-target full-width"
          flat
          label="Clear diagnostic counters"
          aria-label="Clear diagnostic counters"
          :disable="diagnosticActionsDisabled"
          @click="controller.clearCounters"
        />
      </section>
    </main>
  </q-page>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from 'vue';
import { HtmlAudioPlayer } from 'src/audio/html-audio-player';
import {
  usePronunciationDiagnostic,
  type PronunciationDiagnosticError,
  type PronunciationDiagnosticState,
} from 'src/composables/usePronunciationDiagnostic';
import {
  DIAGNOSTIC_WORD,
  TTS_PRONUNCIATION_DIAGNOSTICS_MARKER,
} from 'src/diagnostics/tts-pronunciation-contract';
import { MOBILE_AUTH_KEY } from 'src/services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from 'src/services/mobile-services';
import type { PreparedPronunciation } from 'src/services/mobile-tts';

const providedCoordinator = inject(MOBILE_AUTH_KEY);
if (!providedCoordinator) {
  throw new Error('Mobile auth coordinator was not provided');
}

const providedTtsService = inject(MOBILE_TTS_SERVICE_KEY);
if (!providedTtsService) {
  throw new Error('Mobile TTS service was not provided');
}

const controller = usePronunciationDiagnostic({
  input: {
    vocabularyId: DIAGNOSTIC_WORD.vocabularyId,
    text: DIAGNOSTIC_WORD.text,
  },
  authState: providedCoordinator.state,
  ttsService: providedTtsService,
  audioPlayer: new HtmlAudioPlayer(),
});

const state = computed(() => controller.state.value);

const pronunciation = computed<PreparedPronunciation | null>(() => {
  switch (state.value.kind) {
    case 'ready':
    case 'playing':
    case 'interrupted':
      return state.value.pronunciation;
    case 'error':
      return state.value.pronunciation;
    case 'idle':
    case 'preparing':
      return null;
  }
});

const sourceLabels: Record<PreparedPronunciation['source'], string> = {
  'memory-cache': 'Memory cache',
  'server-cache': 'Server cache',
  generated: 'Generated',
};

const errorMessages: Record<PronunciationDiagnosticError, string> = {
  invalid_input: 'The fixed pronunciation request is invalid.',
  not_configured: 'Text-to-speech is not configured.',
  session_unavailable: 'Your session is unavailable. Sign in again before retrying.',
  session_changed: 'Your session changed. Try the pronunciation again.',
  session_recovery_pending: 'Your session is still recovering. Try again shortly.',
  unauthorized: 'Your session cannot use pronunciation playback.',
  forbidden: 'Your session cannot use pronunciation playback.',
  network:
    'The pronunciation request failed because of the network or request deadline. Try again.',
  service_unavailable: 'The pronunciation service is temporarily unavailable. Try again later.',
  generation_timeout: 'The pronunciation provider timed out. Try again.',
  generation_failed: 'The pronunciation provider could not generate audio. Try again.',
  invalid_response: 'The pronunciation service returned an invalid response. Try again.',
  gesture_required: 'Playback needs another direct tap.',
  media_unavailable: 'The prepared audio is unavailable. Try again.',
  playback_failed: 'Pronunciation playback failed. Try again.',
};

const errorLabels: Record<PronunciationDiagnosticError, string> = {
  invalid_input: 'Invalid fixed request',
  not_configured: 'TTS not configured',
  session_unavailable: 'Session unavailable',
  session_changed: 'Session changed',
  session_recovery_pending: 'Session recovery pending',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  network: 'Network or request deadline',
  service_unavailable: 'Service unavailable',
  generation_timeout: 'Provider timeout',
  generation_failed: 'Generation failed',
  invalid_response: 'Invalid response',
  gesture_required: 'Playback gesture required',
  media_unavailable: 'Prepared audio unavailable',
  playback_failed: 'Playback failed',
};

function messageForState(current: PronunciationDiagnosticState): string {
  switch (current.kind) {
    case 'idle':
      return 'Ready to prepare the fixed pronunciation.';
    case 'preparing':
      return current.recoveringSession
        ? `Recovering your session before preparing pronunciation (attempt ${current.attempt}).`
        : `Preparing pronunciation (attempt ${current.attempt}).`;
    case 'playing':
      return 'Playing pronunciation.';
    case 'ready':
      if (current.notice === 'gesture_required') {
        return 'Playback needs another direct tap.';
      }
      if (current.notice === 'audio_refreshed') {
        return 'The audio link was refreshed. Tap to play the refreshed pronunciation.';
      }
      return controller.counters.completedPlays.value > 0
        ? 'Playback completed. Ready to play again.'
        : 'Pronunciation is prepared and ready to play.';
    case 'interrupted':
      return current.reason === 'background'
        ? 'Playback was interrupted when the app moved to the background. Tap to resume.'
        : 'Playback was interrupted by another audio source. Tap to resume.';
    case 'error':
      return errorMessages[current.error];
  }
}

const stateMessage = computed(() => messageForState(state.value));
const stateMessageRole = computed(() => (state.value.kind === 'error' ? 'alert' : 'status'));
const stateMessageLive = computed(() =>
  state.value.kind === 'error' ? ('assertive' as const) : ('polite' as const),
);

const sessionStatusLabel = computed(() => {
  switch (controller.sessionStatus.value.kind) {
    case 'usable':
      return 'Session ready';
    case 'recovering':
      return 'Session recovering';
    case 'unavailable':
      return 'Session unavailable';
  }
});

const playbackDisabled = computed(
  () => state.value.kind === 'preparing' || controller.sessionStatus.value.kind !== 'usable',
);
const diagnosticActionsDisabled = computed(() => state.value.kind === 'preparing');
const canSimulateInvalidUrl = computed(
  () =>
    state.value.kind === 'ready' ||
    state.value.kind === 'interrupted' ||
    (state.value.kind === 'error' && state.value.pronunciation !== null),
);

const playButtonAriaLabel = computed(() => {
  switch (state.value.kind) {
    case 'idle':
      return 'Prepare and play pronunciation';
    case 'preparing':
      return 'Preparing pronunciation';
    case 'playing':
      return 'Restart pronunciation';
    case 'ready':
      if (state.value.notice === 'gesture_required') return 'Tap to play pronunciation';
      if (state.value.notice === 'audio_refreshed') return 'Play refreshed pronunciation';
      return controller.counters.completedPlays.value > 0
        ? 'Play pronunciation again'
        : 'Play pronunciation';
    case 'interrupted':
      return 'Resume pronunciation';
    case 'error':
      return state.value.pronunciation ? 'Retry playback' : 'Retry pronunciation';
  }
});

const playButtonLabel = computed(() => {
  switch (state.value.kind) {
    case 'idle':
      return 'Prepare and play';
    case 'preparing':
      return 'Preparing';
    case 'playing':
      return 'Restart';
    case 'ready':
      return state.value.notice === 'gesture_required' ? 'Tap to play' : 'Play';
    case 'interrupted':
      return 'Resume';
    case 'error':
      return state.value.pronunciation ? 'Retry playback' : 'Retry';
  }
});

const sourceLabel = computed(() =>
  pronunciation.value ? sourceLabels[pronunciation.value.source] : '',
);

const safeAudioLocation = computed(() => {
  if (!pronunciation.value) return null;
  try {
    const parsed = new URL(pronunciation.value.audioUrl);
    if (parsed.protocol !== 'https:' || !parsed.host) return null;
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
});

const lastErrorLabel = computed(() => {
  const lastError = controller.counters.lastError.value;
  return lastError ? errorLabels[lastError] : 'None';
});

function formatCount(value: number): string {
  return Number.isFinite(value) && value >= 0 ? String(Math.floor(value)) : '0';
}

function formatMilliseconds(value: number): string {
  return Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : 'Not recorded';
}

function formatOptionalMilliseconds(value: number | null): string {
  return value === null ? 'Not recorded' : formatMilliseconds(value);
}

function playOrRetry(): void {
  void controller.playOrRetry();
}

onBeforeUnmount(() => {
  controller.dispose();
});
</script>

<style scoped>
.tts-pronunciation-page {
  max-width: 680px;
  margin: 0 auto;
}

.pronunciation-card,
.state-message {
  border-radius: 12px;
}

.pronunciation-card {
  padding: 20px;
  background: rgb(255 255 255 / 72%);
}

.state-message {
  padding: 12px;
  background: rgb(103 80 164 / 10%);
}

body.body--dark .pronunciation-card {
  background: rgb(255 255 255 / 8%);
}
</style>
