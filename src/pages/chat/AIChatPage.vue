<template>
  <q-page class="column q-pa-md" data-testid="ai-chat-page">
    <div class="text-h5 q-mb-md">AI Chat</div>

    <div
      class="col column bg-grey-2 q-pa-md rounded-borders"
      style="min-height: 300px; max-height: 60vh; overflow: auto"
      ref="messagesEl"
    >
      <template v-if="chat.messages.length === 0">
        <div class="text-grey-7">
          Start a conversation below. Ask anything about Japanese learning.
        </div>
      </template>
      <div v-else class="column q-gutter-sm">
        <q-chat-message
          v-for="m in chat.messages"
          :key="m.id"
          :sent="m.type === 'user'"
          :bg-color="m.type === 'user' ? 'primary' : 'grey-3'"
          :text-color="m.type === 'user' ? 'white' : 'dark'"
          :name="m.type === 'user' ? 'You' : 'AI'"
          :stamp="formatTime(m.timestamp)"
        >
          <div class="message-content" v-text="m.content" />
        </q-chat-message>
      </div>

      <div v-if="chat.isTyping" class="row items-center q-mt-sm">
        <q-spinner size="20px" class="q-mr-sm" />
        <span>AI is typing…</span>
      </div>
    </div>

    <div class="row items-center q-gutter-sm q-mt-md">
      <q-input
        class="col"
        outlined
        dense
        v-model="input"
        :disable="chat.isLoading"
        placeholder="Type your message..."
        data-testid="llm-chat-input"
        @keyup.enter="onSend"
      >
        <template #append>
          <q-btn
            color="primary"
            :loading="chat.isLoading"
            round
            dense
            icon="send"
            @click="onSend"
            data-testid="llm-chat-send"
          />
        </template>
      </q-input>
      <q-btn
        flat
        dense
        icon="clear_all"
        label="Clear"
        @click="onClear"
        :disable="chat.isLoading"
        data-testid="llm-chat-clear"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { llmService, type ChatMessage as LLMChatMessage } from '../../services/llm';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const { provider, currentModel } = storeToRefs(llmSettings);

const input = ref('');
const messagesEl = ref<HTMLElement | null>(null);

const formatTime = (d: Date) =>
  new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const scrollToBottom = async () => {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
};

const syncLLMFromSettings = () => {
  // Ensure llmService matches current settings (store also sets this when settings change)
  llmService.setProvider(provider.value, currentModel.value);
  llmService.setModel(currentModel.value);
};

const onSend = async () => {
  const content = input.value.trim();
  if (!content || chat.isLoading) return;

  chat.clearError();
  chat.addMessage({ type: 'user', content });
  input.value = '';
  await scrollToBottom();

  try {
    chat.setLoading(true);
    chat.setTyping(true);

    // Keep service in sync with settings
    syncLLMFromSettings();

    const systemPrompt =
      'You are a helpful Japanese learning assistant. Keep responses concise and friendly. When relevant, include romaji for Japanese text.';

    const history: LLMChatMessage[] = chat.messages.map((m) => ({
      role: m.type === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    const resp = await llmService.generate({
      system: systemPrompt,
      messages: history,
      temperature: 0.7,
    });

    chat.addMessage({ type: 'ai', content: resp.text });
  } catch (e: unknown) {
    console.error(e);
    const message = e instanceof Error ? e.message : 'Failed to get AI response';
    chat.setError(message);
    $q.notify({ type: 'negative', message });
  } finally {
    chat.setTyping(false);
    chat.setLoading(false);
    await scrollToBottom();
  }
};

const onClear = () => {
  chat.clearMessages();
};

onMounted(() => {
  // Warm greeting if empty
  if (chat.messages.length === 0) {
    chat.addMessage({
      type: 'ai',
      content: 'こんにちは！日本語学習をお手伝いします。What would you like to practice today?',
    });
  }
  syncLLMFromSettings();
  void scrollToBottom();
});
</script>

<style scoped>
.rounded-borders {
  border-radius: 8px;
}
.message-content {
  white-space: pre-wrap;
}
</style>
