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
  </div>
</template>

<script setup lang="ts">
import type { MysteryChoiceScene } from '../model';

defineProps<{ scene: MysteryChoiceScene; disabled: boolean }>();
const emit = defineEmits<{ choose: [optionId: string] }>();
</script>
