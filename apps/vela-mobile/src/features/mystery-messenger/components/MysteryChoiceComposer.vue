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
      @click="emit('choose', option.id)"
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
      @click="showHint = !showHint"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { MysteryChoiceScene } from '../model';

defineProps<{ scene: MysteryChoiceScene; disabled: boolean }>();
const emit = defineEmits<{ choose: [optionId: string] }>();

const showHint = ref(false);
</script>
