<template>
  <div
    class="col column q-pa-md rounded-borders chat-container"
    style="min-height: 0; overflow-y: auto; flex: 1"
    ref="messagesEl"
  >
    <template v-if="messages.length === 0">
      <div class="text-grey-7">
        Start a conversation below. Ask anything about Japanese learning.
      </div>
    </template>
    <div v-else class="column q-gutter-sm">
      <q-chat-message
        v-for="m in messages"
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

    <div v-if="isTyping" class="row items-center q-mt-sm">
      <q-spinner size="20px" class="q-mr-sm" />
      <span>AI is typing…</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import type { ChatMessage } from '../../../stores/chat';
import { renderChatMarkdown } from '../utils/markdown';

defineProps<{
  messages: ChatMessage[];
  isTyping: boolean;
}>();

const messagesEl = ref<HTMLElement | null>(null);

const formatTime = (d: Date) =>
  new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const renderMarkdown = renderChatMarkdown;

const scrollToBottom = async () => {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
};

defineExpose({ scrollToBottom });
</script>

<style scoped lang="scss">
.rounded-borders {
  border-radius: var(--border-radius-lg);
}

.chat-container {
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  border-radius: var(--border-radius-lg);
}

.message-content {
  white-space: pre-wrap;
}

.message-content.markdown-content {
  white-space: normal;
}

// User message with solid primary color
:deep(.user-message .q-message-text) {
  background: var(--color-primary) !important;
  box-shadow: var(--shadow-chat-user);
}

// AI message with chat color (using Quasar 'chat' palette)
:deep(.ai-message .q-message-text) {
  box-shadow: var(--shadow-chat-ai);
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
