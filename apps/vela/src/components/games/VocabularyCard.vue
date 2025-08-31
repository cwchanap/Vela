<template>
  <q-card class="my-card">
    <q-card-section>
      <div class="text-h2 text-center q-mb-md">{{ question.word.japanese_word }}</div>
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
}>();
</script>

<style scoped>
.my-card {
  width: 100%;
  max-width: 400px;
}
</style>
