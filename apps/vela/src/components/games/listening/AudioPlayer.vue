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
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { playAudio } from 'src/services/ttsService';

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

watch(
  () => props.audioUrl,
  (url, oldUrl) => {
    if (!url && oldUrl) {
      // URL cleared — question is resetting
      hasPlayed.value = false;
      isPlaying.value = false;
      return;
    }
    if (url && props.autoPlay) {
      void play(url);
    }
  },
);

async function play(url = props.audioUrl) {
  if (!url || isPlaying.value) return;
  isPlaying.value = true;
  try {
    await playAudio(url);
    if (!hasPlayed.value) {
      hasPlayed.value = true;
      emit('played');
    }
  } catch (e) {
    console.error('Audio playback error:', e);
  } finally {
    isPlaying.value = false;
  }
}

function handleClick() {
  void play();
}
</script>
