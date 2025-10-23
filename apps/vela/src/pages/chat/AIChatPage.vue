<template>
  <q-page class="column q-pa-md" style="min-height: calc(100vh - 50px)" data-testid="ai-chat-page">
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
      class="col column q-pa-md rounded-borders chat-container"
      style="min-height: 300px; overflow-y: auto; flex: 1"
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
          :bg-color="m.type === 'user' ? 'primary' : 'secondary'"
          :text-color="'white'"
          :name="m.type === 'user' ? 'You' : 'AI'"
          :stamp="formatTime(m.timestamp)"
          :class="m.type === 'ai' ? 'ai-message' : 'user-message'"
        >
          <div
            v-if="m.type === 'ai'"
            class="message-content markdown-content"
            v-html="renderMarkdown(m.content)"
          />
          <div v-else class="message-content" v-text="m.content" />
        </q-chat-message>
      </div>

      <div v-if="chat.isTyping" class="row items-center q-mt-sm">
        <q-spinner size="20px" class="q-mr-sm" />
        <span>AI is typing…</span>
      </div>
    </div>

    <q-input
      outlined
      dense
      v-model="input"
      :disable="chat.isLoading"
      placeholder="Type your message..."
      data-testid="llm-chat-input"
      @keyup.enter="onSend"
      class="q-mt-md"
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
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import { fetchAuthSession } from 'aws-amplify/auth';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
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
import { llmService, type ChatMessage as LLMChatMessage } from '../../services/llm';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const auth = useAuthStore();
const { provider, currentModel, currentApiKey } = storeToRefs(llmSettings);

// Greeting message constant
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

const input = ref('');
const messagesEl = ref<HTMLElement | null>(null);

// History dialog state
const showHistory = ref(false);
const threadsLoading = ref(false);
const threads = ref<ChatThreadSummaryDTO[]>([]);

// Delete confirmation dialog state
const showDeleteConfirm = ref(false);
const threadToDelete = ref<ChatThreadSummaryDTO | null>(null);
const isDeleting = ref(false);

const formatTime = (d: Date) =>
  new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Configure marked options
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Render markdown with XSS protection
const renderMarkdown = (text: string): string => {
  if (!text) return '';
  const rawHtml = marked.parse(text) as string;
  // Sanitize HTML to prevent XSS attacks from LLM output
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'del',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
};

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
  llmService.setApiKey(currentApiKey.value);
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
    const response = await fetch('/api/chat-history/save', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ThreadId: chat_id,
        Timestamp: Date.now(),
        UserId: getUserId(),
        message,
        is_user,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save message');
    }
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
    const response = await fetch(`/api/chat-history/threads?user_id=${encodeURIComponent(uid)}`);
    if (!response.ok) {
      throw new Error('Failed to load threads');
    }
    const data = await response.json();
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
    const response = await fetch(
      `/api/chat-history/messages?thread_id=${encodeURIComponent(t.ThreadId)}`,
    );
    if (!response.ok) {
      throw new Error('Failed to load messages');
    }
    const data = await response.json();
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
    // Get auth token for authorization
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `/api/chat-history/thread?thread_id=${encodeURIComponent(threadToDelete.value.ThreadId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to delete thread' }));
      throw new Error(errorData.error || 'Failed to delete thread');
    }

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
  syncLLMFromSettings();
  void scrollToBottom();
});
</script>

<style scoped lang="scss">
.rounded-borders {
  border-radius: 8px;
}

.chat-container {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.06);
}

// Dark mode chat container
body.body--dark .chat-container {
  background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
}

.message-content {
  white-space: pre-wrap;
}

.message-content.markdown-content {
  white-space: normal;
}

// AI message with gradient background
:deep(.ai-message .q-message-text) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

// User message with solid primary color
:deep(.user-message .q-message-text) {
  background: #1976d2 !important;
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
}

// Enhance message bubble appearance
:deep(.q-message-text) {
  border-radius: 12px !important;
  padding: 12px 16px !important;
}

// Message name styling
:deep(.q-message-name) {
  font-weight: 600;
  margin-bottom: 4px;
}

// Timestamp styling
:deep(.q-message-stamp) {
  font-size: 11px;
  opacity: 0.7;
}

/* Markdown content styling in chat messages */
:deep(.markdown-content) {
  line-height: 1.6;
  color: white;
}

:deep(.markdown-content h1),
:deep(.markdown-content h2),
:deep(.markdown-content h3),
:deep(.markdown-content h4),
:deep(.markdown-content h5),
:deep(.markdown-content h6) {
  margin-top: 0.8em;
  margin-bottom: 0.3em;
  font-weight: 600;
  color: white;
}

:deep(.markdown-content h1) {
  font-size: 1.5em;
}

:deep(.markdown-content h2) {
  font-size: 1.3em;
}

:deep(.markdown-content h3) {
  font-size: 1.1em;
}

:deep(.markdown-content p) {
  margin: 0 !important;
  display: inline;
}

:deep(.markdown-content p:not(:last-child)::after) {
  content: '\A\A';
  white-space: pre;
}

:deep(.markdown-content ul),
:deep(.markdown-content ol) {
  margin: 0 0 0.5em 0 !important;
  padding-left: 1.5em;
}

:deep(.markdown-content li) {
  margin-bottom: 0.2em;
}

:deep(.markdown-content li p) {
  margin: 0 0 0.2em 0 !important;
}

:deep(.markdown-content code) {
  background-color: rgba(0, 0, 0, 0.2);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: #ffd700;
}

:deep(.markdown-content pre) {
  background-color: rgba(0, 0, 0, 0.3);
  padding: 0.8em;
  border-radius: 6px;
  overflow-x: auto;
  margin-bottom: 0.8em;
}

:deep(.markdown-content pre code) {
  background-color: transparent;
  padding: 0;
  color: #f0f0f0;
}

:deep(.markdown-content blockquote) {
  border-left: 3px solid rgba(255, 255, 255, 0.5);
  padding-left: 0.8em;
  margin-left: 0;
  color: rgba(255, 255, 255, 0.9);
  font-style: italic;
}

:deep(.markdown-content strong) {
  font-weight: 600;
  color: white;
}

:deep(.markdown-content em) {
  font-style: italic;
}

:deep(.markdown-content a) {
  color: #64b5f6;
  text-decoration: underline;
}

:deep(.markdown-content a:hover) {
  color: #90caf9;
}

:deep(.markdown-content hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  margin: 1em 0;
}

:deep(.markdown-content table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 0.8em;
}

:deep(.markdown-content th),
:deep(.markdown-content td) {
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 0.4em;
  text-align: left;
}

:deep(.markdown-content th) {
  background-color: rgba(0, 0, 0, 0.2);
  font-weight: 600;
}
</style>
