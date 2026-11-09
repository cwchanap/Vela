<template>
  <q-page class="chat-page" data-testid="ai-chat-page">
    <div class="chat-wrapper">
      <div class="chat-header">
        <h1 class="chat-title">AI Chat</h1>
        <div class="chat-actions">
          <q-btn
            flat
            dense
            icon="add_comment"
            label="New Chat"
            color="primary"
            @click="onNewChat"
            data-testid="llm-chat-new"
            class="q-mr-sm"
          />
          <q-btn
            flat
            dense
            icon="history"
            label="History"
            color="primary"
            @click="openHistory"
            data-testid="llm-chat-history"
          />
        </div>
      </div>

      <ChatMessageList ref="messageListRef" :messages="chat.messages" :is-typing="chat.isTyping" />

      <ChatComposer v-model="input" :loading="chat.isLoading" @send="onSend" />

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
                :key="t.ThreadId"
                clickable
                v-ripple
                @click="selectThread(t)"
                data-testid="llm-chat-thread-item"
              >
                <q-item-section>
                  <q-item-label>{{ t.title }}</q-item-label>
                  <q-item-label caption>
                    {{ new Date(t.lastTimestamp).toLocaleString() }} • {{ t.messageCount }} messages
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    flat
                    dense
                    round
                    icon="delete"
                    color="negative"
                    @click.stop="confirmDelete(t)"
                    data-testid="llm-chat-delete-thread"
                  >
                    <q-tooltip>Delete conversation</q-tooltip>
                  </q-btn>
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

      <!-- Delete Confirmation Dialog -->
      <q-dialog v-model="showDeleteConfirm">
        <q-card style="min-width: 350px">
          <q-card-section>
            <div class="text-h6">Delete Conversation?</div>
          </q-card-section>

          <q-card-section>
            <div class="text-body2">
              Are you sure you want to delete this conversation?
              <div class="q-mt-sm text-caption text-grey-7">"{{ threadToDelete?.title }}"</div>
              <div class="q-mt-sm text-negative text-weight-medium">
                This action cannot be undone.
              </div>
            </div>
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="Cancel" v-close-popup :disable="isDeleting" />
            <q-btn
              flat
              label="Delete"
              color="negative"
              @click="deleteThread"
              :loading="isDeleting"
              data-testid="llm-chat-confirm-delete"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatComposer from './components/ChatComposer.vue';
import { getApiUrl } from '../../utils/api';
import { httpJsonAuth } from '../../utils/httpClient';
// Chat history types for API calls
interface ChatHistoryItemDTO {
  ThreadId: string;
  Timestamp: number;
  UserId: string;
  message: string;
  is_user: boolean;
}

interface ChatThreadSummaryDTO {
  ThreadId: string;
  lastTimestamp: number;
  title: string;
  messageCount: number;
}
import { llmClient, describeLlmError } from '../../services/llm';
import type { LlmMessage } from '@vela/common';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const auth = useAuthStore();
const { selection } = storeToRefs(llmSettings);

// Greeting message constant
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

const input = ref('');
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);

// History dialog state
const showHistory = ref(false);
const threadsLoading = ref(false);
const threads = ref<ChatThreadSummaryDTO[]>([]);

// Delete confirmation dialog state
const showDeleteConfirm = ref(false);
const threadToDelete = ref<ChatThreadSummaryDTO | null>(null);
const isDeleting = ref(false);

const scrollToBottom = () => messageListRef.value?.scrollToBottom();

const getUserId = () => auth.user?.id || auth.session?.user?.id || 'anonymous';

const ensureChatId = () => {
  if (!chat.chatId) {
    chat.startNewChat();
  }
  return chat.chatId!;
};

const saveToHistory = async (chat_id: string, message: string, is_user: boolean) => {
  try {
    await httpJsonAuth<{ ok: boolean }>(getApiUrl('chat-history/save'), {
      method: 'POST',
      body: JSON.stringify({
        ThreadId: chat_id,
        Timestamp: Date.now(),
        UserId: getUserId(),
        message,
        is_user,
      }),
    });
  } catch (e) {
    console.error('Failed to save chat message', e);
    $q.notify({ type: 'warning', message: 'Failed to save chat history' });
  }
};

const openHistory = async () => {
  threadsLoading.value = true;
  showHistory.value = true;
  try {
    const uid = getUserId();
    const data = await httpJsonAuth<{ threads?: ChatThreadSummaryDTO[] }>(
      getApiUrl(`chat-history/threads?user_id=${encodeURIComponent(uid)}`),
    );
    threads.value = data.threads || [];
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to load chat history' });
  } finally {
    threadsLoading.value = false;
  }
};

const selectThread = async (t: ChatThreadSummaryDTO) => {
  try {
    const data = await httpJsonAuth<{ items?: ChatHistoryItemDTO[] }>(
      getApiUrl(`chat-history/messages?thread_id=${encodeURIComponent(t.ThreadId)}`),
    );
    const items: ChatHistoryItemDTO[] = data.items || [];

    chat.setChatId(t.ThreadId);

    // Convert the messages to the correct type format
    const restoredMessages = items.map((it: ChatHistoryItemDTO) => ({
      id: crypto.randomUUID(),
      type: it.is_user ? ('user' as const) : ('ai' as const),
      content: it.message,
      timestamp: new Date(it.Timestamp),
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

const onSend = async (draft: string) => {
  const content = draft.trim();
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

    const systemPrompt =
      'You are a helpful Japanese learning assistant. Keep responses concise and friendly. When relevant, include romaji for Japanese text.';

    const history: LlmMessage[] = chat.messages.map((m) => ({
      role: m.type === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Explicit per-request snapshot of the active provider/model/key; there is
    // no global service state to keep in sync.
    const resp = await llmClient.generate({
      provider: selection.value.provider,
      model: selection.value.model,
      apiKey: selection.value.apiKey,
      ...(selection.value.thinking ? { thinking: selection.value.thinking } : {}),
      system: systemPrompt,
      messages: history,
    });

    // A successful-but-empty reply must not be stored: an empty assistant
    // turn would make the next request fail content min(1) validation.
    if (!resp.text.trim()) {
      throw new Error('The AI returned an empty response. Please try again.');
    }

    chat.addMessage({ type: 'ai', content: resp.text });
    void saveToHistory(cid, resp.text, false);
  } catch (e: unknown) {
    console.error(e);
    const message = describeLlmError(e, 'Failed to get AI response');
    chat.setError(message);
    $q.notify({ type: 'negative', message });
  } finally {
    chat.setTyping(false);
    chat.setLoading(false);
    await scrollToBottom();
  }
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

const confirmDelete = (t: ChatThreadSummaryDTO) => {
  threadToDelete.value = t;
  showDeleteConfirm.value = true;
};

const deleteThread = async () => {
  if (!threadToDelete.value) return;

  isDeleting.value = true;
  try {
    await httpJsonAuth<{ ok: boolean }>(
      getApiUrl(
        `chat-history/thread?thread_id=${encodeURIComponent(threadToDelete.value.ThreadId)}`,
      ),
      {
        method: 'DELETE',
      },
    );

    // Remove from local list
    threads.value = threads.value.filter((t) => t.ThreadId !== threadToDelete.value!.ThreadId);

    // If the deleted thread is the current chat, start a new chat
    if (chat.chatId === threadToDelete.value.ThreadId) {
      chat.startNewChat();
      chat.addMessage({
        type: 'ai',
        content: GREETING_MESSAGE,
      });
    }

    $q.notify({ type: 'positive', message: 'Conversation deleted successfully' });
    showDeleteConfirm.value = false;
    threadToDelete.value = null;
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to delete conversation' });
  } finally {
    isDeleting.value = false;
  }
};

onMounted(() => {
  // Warm greeting if empty
  if (chat.messages.length === 0) {
    chat.addMessage({
      type: 'ai',
      content: GREETING_MESSAGE,
    });
  }
  void scrollToBottom();
});
</script>

<style scoped lang="scss">
.chat-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--bg-page);
  display: flex;
  flex-direction: column;
}

.chat-wrapper {
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.chat-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.chat-actions {
  display: flex;
  gap: 8px;
}
</style>
