<template>
  <div class="audio-player text-center">
    <q-btn
      round
      :icon="isPlaying ? 'volume_up' : hasPlayed ? 'replay' : 'play_circle_filled'"
      color="teal"
      size="xl"
      :loading="props.isLoading || isPlaying"
      :disable="!props.audioUrl && !props.isLoading"
      @click="handleClick"
      :aria-label="hasPlayed ? 'Replay audio' : 'Play audio'"
    />
    <div class="text-caption text-grey q-mt-sm">
      <span v-if="props.isLoading">Loading audio...</span>
      <span v-else-if="isPlaying">Playing...</span>
      <span v-else-if="hasPlayed">Click to replay</span>
      <span v-else>Click to play</span>
    </div>
    <div
      v-if="hasError"
      class="text-negative text-caption q-mt-sm row items-center justify-center q-gutter-xs"
    >
      <span>Audio playback failed. Try again.</span>
      <q-btn
        flat
        dense
        round
        size="sm"
        icon="close"
        aria-label="Dismiss audio playback error"
        @click="hasError = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from 'vue';
import { playAudio, type AudioPlaybackHandle } from 'src/services/ttsService';

const props = withDefaults(
  defineProps<{
    audioUrl: string | null;
    isLoading: boolean;
    /** Auto-play when audioUrl becomes available. Defaults to true. */
    autoPlay?: boolean;
  }>(),
  { autoPlay: true },
);

const emit = defineEmits<{
  played: [];
}>();

const isPlaying = ref(false);
const hasPlayed = ref(false);
const hasError = ref(false);
const currentPlayback = shallowRef<AudioPlaybackHandle | null>(null);

function stopPlayback({ resetPlayed = false, clearError = false } = {}) {
  const playback = currentPlayback.value;
  currentPlayback.value = null;

  if (playback) {
    playback.stop();
  }

  isPlaying.value = false;

  if (resetPlayed) {
    hasPlayed.value = false;
  }

  if (clearError) {
    hasError.value = false;
  }
}

watch(
  () => props.audioUrl,
  (url, oldUrl) => {
    if (url === oldUrl) return;

    if (!url) {
      stopPlayback({ resetPlayed: true, clearError: true });
      return;
    }

    stopPlayback({ resetPlayed: true, clearError: true });

    if (url && props.autoPlay) {
      void play(url);
    }
  },
);

async function play(url = props.audioUrl) {
  if (!url || isPlaying.value) return;

  hasError.value = false;
  isPlaying.value = true;
  const playback = playAudio(url);
  currentPlayback.value = playback;

  try {
    await playback.finished;
    if (currentPlayback.value !== playback) return;

    if (!hasPlayed.value) {
      hasPlayed.value = true;
      emit('played');
    }
  } catch (e) {
    if (currentPlayback.value !== playback) return;

    hasError.value = true;
    console.error('Audio playback error:', e);
  } finally {
    if (currentPlayback.value === playback) {
      currentPlayback.value = null;
      isPlaying.value = false;
    }
  }
}

function handleClick() {
  void play();
}

onUnmounted(() => {
  stopPlayback({ resetPlayed: true, clearError: true });
});
</script>
