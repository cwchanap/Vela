<template>
  <div class="q-mt-md">
    <div class="text-subtitle2 text-center text-grey q-mb-md">Select the meaning:</div>
    <div class="row q-col-gutter-sm">
      <div v-for="option in shuffledOptions" :key="option" class="col-6">
        <q-btn
          class="full-width"
          :color="selectedOption === option ? 'primary' : 'white'"
          :text-color="selectedOption === option ? 'white' : 'dark'"
          :outline="selectedOption !== option"
          :disable="selectedOption !== null"
          @click="select(option)"
          no-caps
          unelevated
          style="min-height: 64px; white-space: normal; word-break: break-word"
        >
          {{ option }}
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { shuffleArray } from 'src/utils/array';

const props = defineProps<{
  correctAnswer: string;
  distractors: string[];
}>();

const emit = defineEmits<{
  answer: [selected: string];
}>();

const selectedOption = ref<string | null>(null);

// Shuffled once at component creation. The component is keyed on question id
// in the parent, so it remounts per question — no need for a computed here.
const shuffledOptions = shuffleArray([props.correctAnswer, ...props.distractors.slice(0, 3)]);

function select(option: string) {
  if (selectedOption.value !== null) return;
  selectedOption.value = option;
  emit('answer', option);
}
</script>
