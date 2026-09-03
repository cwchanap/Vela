<template>
  <q-page padding class="mystery-messenger-page">
    <main class="column q-gutter-md">
      <h1 lang="ja" class="text-h5 q-my-none">{{ chapter.title }}</h1>

      <p
        v-if="sessionStatusCopy"
        data-testid="mystery-session-status"
        class="q-my-none"
        role="status"
      >
        {{ sessionStatusCopy }}
      </p>

      <p
        v-if="messenger.persistenceWarning.value"
        data-testid="mystery-save-warning"
        class="q-my-none"
        role="status"
      >
        Your progress can't be saved on this device right now.
      </p>

      <MysteryTranscript :items="transcript" @replay="handleReplay" />

      <p v-if="audioStatusCopy" data-testid="mystery-audio-status" class="q-my-none" role="status">
        {{ audioStatusCopy }}
      </p>

      <p v-if="audioErrorCopy" data-testid="mystery-audio-error" class="q-my-none" role="alert">
        {{ audioErrorCopy }}
      </p>

      <q-btn
        v-if="currentMessage"
        data-testid="mystery-continue"
        class="mobile-touch-target full-width"
        color="primary"
        label="Continue"
        :disable="transitionsDisabled"
        @click="handleContinue"
      />

      <MysteryChoiceComposer
        v-else-if="currentChoice"
        :key="currentChoice.id"
        :scene="currentChoice"
        :disabled="transitionsDisabled"
        @choose="handleChoose"
      />

      <MysteryResponseBuildComposer
        v-else-if="currentResponseBuild"
        :key="currentResponseBuild.id"
        :scene="currentResponseBuild"
        :disabled="transitionsDisabled"
        @submit="handleResponseSubmit"
      />

      <q-btn
        v-else-if="currentEnding"
        data-testid="mystery-restart"
        class="mobile-touch-target full-width"
        outline
        label="Restart"
        :disable="transitionsDisabled"
        @click="handleRestart"
      />
    </main>
  </q-page>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue';
import { HtmlAudioPlayer } from 'src/audio/html-audio-player';
import { MOBILE_AUTH_KEY } from 'src/services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from 'src/services/mobile-services';
import MysteryChoiceComposer from './components/MysteryChoiceComposer.vue';
import MysteryResponseBuildComposer from './components/MysteryResponseBuildComposer.vue';
import MysteryTranscript from './components/MysteryTranscript.vue';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER } from './content';
import { getMysteryScene } from './model';
import { createBrowserMysteryProgressStorage } from './storage';
import { useMysteryAudio } from './useMysteryAudio';
import { useMysteryMessenger } from './useMysteryMessenger';

const coordinator = inject(MOBILE_AUTH_KEY);
const ttsService = inject(MOBILE_TTS_SERVICE_KEY);
if (!coordinator || !ttsService) {
  throw new Error('mystery_messenger_dependencies_unavailable');
}

const chapter = MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER;
const messenger = useMysteryMessenger({
  authState: coordinator.state,
  storage: createBrowserMysteryProgressStorage(window.localStorage),
  chapter,
});
const audio = useMysteryAudio({
  authState: coordinator.state,
  ttsService,
  audioPlayer: new HtmlAudioPlayer(),
});

const RAPID_TRANSITION_GUARD_MS = 500;
const transitionLocked = ref(false);
let transitionUnlockTimer: ReturnType<typeof setTimeout> | null = null;

function lockTransition(): boolean {
  if (transitionLocked.value) return false;
  transitionLocked.value = true;
  transitionUnlockTimer = setTimeout(() => {
    transitionLocked.value = false;
    transitionUnlockTimer = null;
  }, RAPID_TRANSITION_GUARD_MS);
  return true;
}

const currentScene = computed(() => messenger.currentScene.value);
const currentMessage = computed(() =>
  currentScene.value?.kind === 'message' ? currentScene.value : null,
);
const currentChoice = computed(() =>
  currentScene.value?.kind === 'choice' ? currentScene.value : null,
);
const currentResponseBuild = computed(() =>
  currentScene.value?.kind === 'response-build' ? currentScene.value : null,
);
const currentEnding = computed(() =>
  currentScene.value?.kind === 'ending' ? currentScene.value : null,
);
const transcript = computed(() => messenger.transcript.value);

const sessionStatusCopy = computed(() => {
  switch (messenger.sessionStatus.value.kind) {
    case 'recovering':
      return 'Your session is recovering. Progress changes are temporarily disabled.';
    case 'unavailable':
      return 'Your session is unavailable. Sign in again to continue.';
    case 'usable':
      return '';
  }
});

const transitionsDisabled = computed(
  () => transitionLocked.value || messenger.sessionStatus.value.kind !== 'usable',
);

const audioStatusCopy = computed(() => {
  switch (audio.state.value.kind) {
    case 'preparing':
      return 'Preparing audio…';
    case 'ready':
      return 'Tap play again';
    case 'playing':
      return 'Playing audio…';
    default:
      return '';
  }
});

const audioErrorCopy = computed(() => {
  const state = audio.state.value;
  return state.kind === 'error' ? `Audio playback failed: ${state.message}` : '';
});

function handleContinue(): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'message') return;
  messenger.continueMessage(scene.id);
}

function handleChoose(optionId: string, hintUsed: boolean): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice') return;
  messenger.chooseOption(scene.id, optionId, hintUsed);
}

function handleResponseSubmit(selectedTokenIds: readonly string[], hintUsed: boolean): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds, hintUsed);
}

function handleRestart(): void {
  if (!lockTransition()) return;
  messenger.restart();
}

function handleReplay(sceneId: string): void {
  const scene = getMysteryScene(chapter, sceneId);
  void audio.play(scene);
}

onBeforeUnmount(() => {
  if (transitionUnlockTimer !== null) {
    clearTimeout(transitionUnlockTimer);
    transitionUnlockTimer = null;
  }
  audio.dispose();
});
</script>

<style scoped>
.mystery-messenger-page {
  max-width: 680px;
  margin: 0 auto;
}
</style>
