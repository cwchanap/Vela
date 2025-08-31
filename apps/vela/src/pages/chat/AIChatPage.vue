<template>
  <q-page class="column q-pa-md" data-testid="ai-chat-page">
    <div class="row items-center q-mb-md">
      <div class="text-h5">AI Chat</div>
      <q-space />
      <q-btn
        flat
        dense
        icon="add_comment"
        label="New Chat"
        @click="onNewChat"
        data-testid="llm-chat-new"
        class="q-mr-sm"
      />
      <q-btn
        flat
        dense
        icon="history"
        label="History"
        @click="openHistory"
        data-testid="llm-chat-history"
      />
    </div>

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

    <!-- History Dialog -->
    <q-dialog v-model="showHistory">
      <q-card style="min-width: 500px; max-width: 90vw">
        <q-card-section class="row items-center">
          <div class="text-h6">Chat History</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div v-if="threadsLoading" class="row items-center">
            <q-spinner class="q-mr-sm" />
            <span>Loading threads…</span>
          </div>
          <div v-else-if="threads.length === 0" class="text-grey-7">
            No previous conversations found.
          </div>
          <q-list v-else bordered separator>
            <q-item
              v-for="t in threads"
              :key="t.chat_id"
              clickable
              v-ripple
              @click="selectThread(t)"
              data-testid="llm-chat-thread-item"
            >
              <q-item-section>
                <q-item-label>{{ t.title }}</q-item-label>
                <q-item-label caption>
                  {{ new Date(t.lastDate).toLocaleString() }} • {{ t.messageCount }} messages
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import { chatHistoryClient, type ChatThreadSummaryDTO } from '../../services/chatHistoryClient';
import { llmService, type ChatMessage as LLMChatMessage } from '../../services/llm';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const auth = useAuthStore();
const { provider, currentModel } = storeToRefs(llmSettings);

// Greeting message constant
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

const input = ref('');
const messagesEl = ref<HTMLElement | null>(null);

// History dialog state
const showHistory = ref(false);
const threadsLoading = ref(false);
const threads = ref<ChatThreadSummaryDTO[]>([]);

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

const getUserId = () => auth.user?.id || 'anonymous';

const ensureChatId = () => {
  if (!chat.chatId) {
    chat.startNewChat();
  }
  return chat.chatId!;
};

const saveToHistory = async (chat_id: string, message: string, is_user: boolean) => {
  try {
    await chatHistoryClient.saveMessage({
      chat_id,
      user_id: getUserId(),
      message,
      is_user,
    });
  } catch (e) {
    console.error('Failed to save chat message', e);
    $q.notify({ type: 'warning', message: 'Failed to save chat history (local dev)' });
  }
};

const openHistory = async () => {
  threadsLoading.value = true;
  showHistory.value = true;
  try {
    const uid = getUserId();
    threads.value = await chatHistoryClient.listThreads(uid);
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to load chat history' });
  } finally {
    threadsLoading.value = false;
  }
};

const selectThread = async (t: ChatThreadSummaryDTO) => {
  try {
    const items = await chatHistoryClient.getMessages(t.chat_id);
    chat.setChatId(t.chat_id);

    // Convert the messages to the correct type format
    const restoredMessages = items.map((it) => ({
      id: crypto.randomUUID(),
      type: it.is_user ? ('user' as const) : ('ai' as const),
      content: it.message,
      timestamp: new Date(it.date),
    }));

    // Check if the first message is the introductory AI greeting
    const hasGreeting =
      restoredMessages.length > 0 &&
      restoredMessages[0] &&
      restoredMessages[0].type === 'ai' &&
      restoredMessages[0].content === GREETING_MESSAGE;

    // If no greeting message exists, prepend it
    if (!hasGreeting) {
      const greetingMsg = {
        id: crypto.randomUUID(),
        type: 'ai' as const,
        content: GREETING_MESSAGE,
        timestamp:
          restoredMessages.length > 0 && restoredMessages[0]
            ? new Date(restoredMessages[0].timestamp.getTime() - 1000)
            : new Date(),
      };
      restoredMessages.unshift(greetingMsg);
    }

    chat.setMessages(restoredMessages);
    showHistory.value = false;
    await scrollToBottom();
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to load conversation' });
  }
};

const onSend = async () => {
  const content = input.value.trim();
  if (!content || chat.isLoading) return;

  chat.clearError();

  // Ensure we have a chat/thread id and persist the user message
  const cid = ensureChatId();
  chat.addMessage({ type: 'user', content });
  void saveToHistory(cid, content, true);

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
    void saveToHistory(cid, resp.text, false);
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

const onNewChat = () => {
  chat.startNewChat();
  // Add a fresh greeting for the new chat
  chat.addMessage({
    type: 'ai',
    content: GREETING_MESSAGE,
  });
  void scrollToBottom();
};

onMounted(() => {
  // Warm greeting if empty
  if (chat.messages.length === 0) {
    chat.addMessage({
      type: 'ai',
      content: GREETING_MESSAGE,
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
