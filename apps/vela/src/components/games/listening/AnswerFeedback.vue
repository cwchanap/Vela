<template>
  <q-card class="q-pa-lg text-center answer-feedback" style="max-width: 420px; width: 100%">
    <q-card-section>
      <div class="text-h3 q-mb-md">{{ isCorrect ? '✓' : '✗' }}</div>
      <div class="text-h5 q-mb-md" :class="isCorrect ? 'text-positive' : 'text-negative'">
        {{ isCorrect ? 'Correct!' : 'Incorrect' }}
      </div>

      <!-- Japanese text reveal -->
      <div class="text-h4 q-mb-xs japanese-text">{{ japaneseText }}</div>
      <div v-if="reading" class="text-subtitle1 text-grey q-mb-xs">{{ reading }}</div>
      <div class="text-body1 text-grey q-mb-md">{{ englishTranslation }}</div>

      <!-- Show user's typed input when dictation was wrong -->
      <div
        v-if="showUserInput && userInput && !isCorrect"
        class="text-caption text-negative q-mb-md"
      >
        You typed: "{{ userInput }}"
      </div>

      <!-- Replay audio -->
      <audio-player :audio-url="audioUrl" :is-loading="false" :auto-play="false" />
    </q-card-section>

    <q-card-actions align="center">
      <q-btn
        :label="isLast ? 'Finish' : 'Next Question'"
        color="teal"
        size="lg"
        unelevated
        rounded
        @click="$emit('next')"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import AudioPlayer from './AudioPlayer.vue';

defineProps<{
  isCorrect: boolean;
  japaneseText: string;
  reading?: string | undefined;
  englishTranslation: string;
  audioUrl: string | null;
  userInput?: string | undefined;
  showUserInput?: boolean | undefined;
  isLast: boolean;
}>();

defineEmits<{
  next: [];
}>();
</script>

<style scoped>
.japanese-text {
  font-family: 'Noto Serif JP', serif;
  font-weight: 600;
}
</style>
