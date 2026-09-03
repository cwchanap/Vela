<template>
  <div class="mystery-choice-composer column q-gutter-sm" data-testid="mystery-choice-composer">
    <q-btn
      v-for="option in scene.options"
      :key="option.id"
      class="mobile-touch-target full-width"
      outline
      lang="ja"
      :data-testid="`mystery-option-${option.id}`"
      :label="option.label"
      :disable="disabled"
      @click="choose(option.id)"
    />

    <p
      v-if="showHint"
      data-testid="mystery-choice-hint-copy"
      class="q-my-none text-caption"
      role="note"
    >
      {{ scene.hint }}
    </p>
    <q-btn
      class="mobile-touch-target full-width"
      flat
      label="Hint"
      data-testid="mystery-choice-hint"
      :disable="disabled"
      @click="toggleHint"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { MysteryChoiceScene } from '../model';

defineProps<{ scene: MysteryChoiceScene; disabled: boolean }>();
const emit = defineEmits<{ choose: [optionId: string, hintUsed: boolean] }>();

const showHint = ref(false);
const hintRevealed = ref(false);

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value) hintRevealed.value = true;
}

function choose(optionId: string): void {
  emit('choose', optionId, hintRevealed.value);
}
</script>
