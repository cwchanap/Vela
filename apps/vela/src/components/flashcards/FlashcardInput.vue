<template>
  <div class="flashcard-input">
    <q-input
      v-model="answer"
      :label="label"
      :hint="hint"
      outlined
      class="answer-input"
      :readonly="submitted"
      :class="{
        'input-correct': submitted && isCorrect,
        'input-incorrect': submitted && !isCorrect,
      }"
      @keyup.enter="handleSubmit"
      data-testid="input-answer"
    >
      <template v-slot:append>
        <q-btn
          v-if="!submitted"
          @click="handleSubmit"
          :disable="!answer.trim()"
          icon="check"
          color="primary"
          flat
          round
          dense
          data-testid="btn-submit-answer"
        >
          <q-tooltip>Check answer</q-tooltip>
        </q-btn>
        <q-icon
          v-else
          :name="isCorrect ? 'check_circle' : 'cancel'"
          :color="isCorrect ? 'positive' : 'negative'"
          size="24px"
        />
      </template>
    </q-input>

    <!-- Feedback after submission -->
    <div v-if="submitted" class="feedback q-mt-sm">
      <div v-if="isCorrect" class="text-positive text-weight-medium">Correct!</div>
      <div v-else class="text-negative">
        <div class="text-weight-medium">Incorrect</div>
        <div class="correct-answer q-mt-xs">
          Correct answer: <span class="text-weight-bold">{{ correctAnswer }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  correctAnswer: string;
  alternateAnswers?: string[];
  label?: string;
  hint?: string;
}>();

const emit = defineEmits<{
  (_e: 'submit', _answer: string, _isCorrect: boolean): void;
}>();

const answer = ref('');
const submitted = ref(false);
const isCorrect = ref(false);

const label = computed(() => props.label || 'Type your answer');
const hint = computed(
  () => props.hint || 'Enter in Japanese (hiragana, katakana, kanji, or romaji)',
);

function handleSubmit() {
  if (!answer.value.trim() || submitted.value) return;

  const normalizedAnswer = answer.value.trim().toLowerCase();

  // Build list of valid answers
  const validAnswers = [props.correctAnswer, ...(props.alternateAnswers || [])]
    .filter(Boolean)
    .map((a) => a.toLowerCase().trim());

  isCorrect.value = validAnswers.includes(normalizedAnswer);
  submitted.value = true;

  emit('submit', answer.value, isCorrect.value);
}

// Expose reset function for parent component
function reset() {
  answer.value = '';
  submitted.value = false;
  isCorrect.value = false;
}

defineExpose({ reset });
</script>

<style scoped>
.flashcard-input {
  width: 100%;
  max-width: 400px;
}

.answer-input {
  font-size: 1.1rem;
}

.answer-input.input-correct :deep(.q-field__control) {
  border-color: var(--q-positive) !important;
  background-color: rgba(88, 204, 2, 0.05);
}

.answer-input.input-incorrect :deep(.q-field__control) {
  border-color: var(--q-negative) !important;
  background-color: rgba(255, 75, 75, 0.05);
}

.feedback {
  text-align: center;
}

.correct-answer {
  font-size: 1rem;
}
</style>
