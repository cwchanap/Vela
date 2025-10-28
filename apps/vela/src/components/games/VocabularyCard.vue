<template>
  <q-card class="my-card">
    <q-card-section>
      <div class="row items-center justify-center q-mb-md">
        <div class="text-h2 text-center">{{ question.word.japanese_word }}</div>
        <q-btn
          flat
          round
          dense
          icon="volume_up"
          color="primary"
          class="q-ml-sm"
          @click="$emit('pronounce', question.word)"
          data-testid="btn-pronounce"
        >
          <q-tooltip>Pronunciation</q-tooltip>
        </q-btn>
      </div>
      <div class="text-subtitle1 text-center text-grey" v-if="question.word.romaji">
        {{ question.word.romaji }}
      </div>
    </q-card-section>

    <q-separator />

    <q-card-actions vertical>
      <q-btn
        v-for="option in question.options"
        :key="option"
        @click="$emit('answer', option)"
        :label="option"
        flat
        class="full-width q-my-sm text-h6"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import type { Question } from 'src/stores/games';

defineProps<{
  question: Question;
}>();

defineEmits<{
  (_e: 'answer', _answer: string): void;
  (_e: 'pronounce', _word: Question['word']): void;
}>();
</script>

<style scoped>
.my-card {
  width: 100%;
  max-width: 400px;
}
</style>
