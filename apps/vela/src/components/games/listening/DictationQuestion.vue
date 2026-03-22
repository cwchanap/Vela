<template>
  <div class="q-mt-md">
    <div class="text-subtitle2 text-center text-grey q-mb-md">Type what you heard:</div>
    <q-input
      v-model="userInput"
      outlined
      placeholder="Type in Japanese (hiragana, katakana, kanji) or romaji"
      autofocus
      :disable="submitted"
      @keyup="handleKeyup"
      class="q-mb-sm"
    />
    <div class="text-center">
      <q-btn
        label="Submit"
        color="teal"
        :disable="!userInput.trim() || submitted"
        @click="submit"
        unelevated
        rounded
        size="md"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  answer: [typed: string];
}>();

const userInput = ref('');
const submitted = ref(false);

function handleKeyup(e: KeyboardEvent) {
  // Skip Enter key presses that are part of IME composition
  if (e.key === 'Enter' && !e.isComposing) {
    submit();
  }
}

function submit() {
  if (!userInput.value.trim() || submitted.value) return;
  submitted.value = true;
  emit('answer', userInput.value);
}
</script>
