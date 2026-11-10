<template>
  <q-input
    outlined
    dense
    v-model="draft"
    :disable="loading"
    placeholder="Type your message..."
    data-testid="llm-chat-input"
    @keydown="onKeydown"
    @keyup.enter="onKeyupEnter"
    class="q-mt-md"
  >
    <template #append>
      <q-btn
        color="primary"
        :loading="loading"
        round
        dense
        icon="send"
        @click="onSend"
        data-testid="llm-chat-send"
      />
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [content: string];
}>();

const draft = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter') return;
  // Guard IME composition: an Enter pressed to confirm an IME candidate
  // must not submit the message.
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  onSend();
};

const onKeyupEnter = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229) return;
  onSend();
};

const onSend = () => {
  const content = draft.value.trim();
  if (!content || props.loading) return;
  emit('send', content);
};
</script>
