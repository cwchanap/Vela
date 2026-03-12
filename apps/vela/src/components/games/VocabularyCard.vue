<template>
  <q-card class="my-card">
    <q-card-section>
      <div class="row items-center justify-center q-mb-xs">
        <div class="text-h4 text-center text-weight-medium">
          {{ question.word.english_translation }}
        </div>
      </div>
      <div class="text-caption text-center text-grey-5">Select the correct Japanese word</div>
    </q-card-section>

    <q-separator />

    <q-card-section class="row q-col-gutter-sm">
      <div v-for="option in question.options" :key="option.id" class="col-6">
        <q-btn
          @click="$emit('answer', option.id)"
          flat
          outline
          class="full-width option-btn"
          data-testid="answer-button"
        >
          <furi-kana
            :text="option.text"
            v-bind="option.reading !== undefined ? { reading: option.reading } : {}"
            class="text-h6"
          />
        </q-btn>
      </div>
    </q-card-section>

    <q-separator />

    <q-card-actions align="right">
      <q-btn
        flat
        round
        dense
        icon="volume_up"
        color="primary"
        aria-label="Play pronunciation"
        @click="$emit('pronounce', question.word)"
        data-testid="btn-pronounce"
      >
        <q-tooltip>Pronunciation</q-tooltip>
      </q-btn>
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import type { Question } from 'src/stores/games';
import FuriKana from './FuriKana.vue';

defineProps<{
  question: Question;
}>();

defineEmits<{
  (_e: 'answer', _vocabularyId: string): void;
  (_e: 'pronounce', _word: Question['word']): void;
}>();
</script>

<style scoped>
.my-card {
  width: 100%;
  max-width: 420px;
}

.option-btn {
  min-height: 64px;
}
</style>
