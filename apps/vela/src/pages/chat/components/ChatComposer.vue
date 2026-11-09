<template>
  <q-input
    outlined
    dense
    v-model="draft"
    :disable="loading"
    placeholder="Type your message..."
    data-testid="llm-chat-input"
    @keyup.enter="onSend"
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
  send: [];
}>();

const draft = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const onSend = () => {
  emit('send');
};
</script>
