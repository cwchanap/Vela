<template>
  <div class="chat-sidebar" data-testid="chat-sidebar">
    <div class="chat-sidebar__header">
      <div class="chat-sidebar__title">Conversations</div>
      <q-btn
        flat
        dense
        icon="add_comment"
        label="New chat"
        color="primary"
        :disable="disabled"
        @click="emit('new')"
        data-testid="llm-chat-new"
      />
    </div>
    <q-separator />
    <div class="chat-sidebar__list">
      <div v-if="loading" class="chat-sidebar__state row items-center">
        <q-spinner class="q-mr-sm" />
        <span>Loading threads…</span>
      </div>
      <div v-else-if="error" class="chat-sidebar__state">
        <div class="text-negative">Failed to load conversations</div>
        <q-btn
          flat
          dense
          label="Retry"
          color="primary"
          class="q-mt-xs"
          @click="emit('retry')"
          data-testid="chat-sidebar-retry"
        />
      </div>
      <div v-else-if="threads.length === 0" class="chat-sidebar__state text-grey-7">
        No conversations yet.
      </div>
      <q-list v-else separator>
        <q-item
          v-for="t in threads"
          :key="t.ThreadId"
          :clickable="!disabled && renamingId !== t.ThreadId"
          v-ripple
          @click="onThreadClick(t)"
          :class="{ 'chat-sidebar__thread--active': t.ThreadId === activeThreadId }"
          :aria-current="t.ThreadId === activeThreadId ? 'true' : undefined"
          data-testid="llm-chat-thread-item"
        >
          <template v-if="renamingId === t.ThreadId">
            <q-item-section>
              <q-input
                dense
                outlined
                autofocus
                v-model="renameDraft"
                @keyup.enter="commitRename"
                @keyup.escape="cancelRename"
                @click.stop
                data-testid="chat-thread-rename-input"
              />
              <div class="row q-gutter-xs q-mt-xs">
                <q-btn
                  flat
                  dense
                  round
                  icon="check"
                  color="primary"
                  size="sm"
                  aria-label="Save name"
                  @click.stop="commitRename"
                  data-testid="chat-thread-rename-save"
                />
                <q-btn
                  flat
                  dense
                  round
                  icon="close"
                  size="sm"
                  aria-label="Cancel rename"
                  @click.stop="cancelRename"
                  data-testid="chat-thread-rename-cancel"
                />
              </div>
            </q-item-section>
          </template>
          <template v-else>
            <q-item-section>
              <q-item-label lines="1">{{ t.title }}</q-item-label>
              <q-item-label caption>{{ formatRelativeTime(t.updatedAt) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat
                dense
                round
                icon="more_vert"
                size="sm"
                :disable="disabled"
                aria-label="Thread actions"
                @click.stop
                data-testid="chat-thread-menu"
              >
                <q-menu>
                  <q-list dense>
                    <q-item
                      clickable
                      v-close-popup
                      @click="startRename(t)"
                      data-testid="chat-thread-rename"
                    >
                      <q-item-section avatar>
                        <q-icon name="edit" size="xs" />
                      </q-item-section>
                      <q-item-section>Rename</q-item-section>
                    </q-item>
                    <q-item
                      clickable
                      v-close-popup
                      @click="emit('delete', t)"
                      data-testid="llm-chat-delete-thread"
                    >
                      <q-item-section avatar>
                        <q-icon name="delete" size="xs" color="negative" />
                      </q-item-section>
                      <q-item-section class="text-negative">Delete</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </q-item-section>
          </template>
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { formatRelativeTime } from '../utils/formatTime';
import type { ChatThreadSummaryDTO } from '../../../services/chatHistoryService';

const props = defineProps<{
  threads: ChatThreadSummaryDTO[];
  activeThreadId: string | null;
  loading: boolean;
  error: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  select: [thread: ChatThreadSummaryDTO];
  new: [];
  rename: [payload: { threadId: string; title: string }];
  delete: [thread: ChatThreadSummaryDTO];
  retry: [];
}>();

const renamingId = ref<string | null>(null);
const renameDraft = ref('');

const onThreadClick = (t: ChatThreadSummaryDTO) => {
  if (props.disabled || renamingId.value === t.ThreadId) return;
  emit('select', t);
};

const startRename = (t: ChatThreadSummaryDTO) => {
  if (props.disabled) return;
  renamingId.value = t.ThreadId;
  renameDraft.value = t.title;
};

const commitRename = () => {
  const threadId = renamingId.value;
  const title = renameDraft.value.trim();
  if (!threadId) return;
  if (!title) {
    cancelRename();
    return;
  }
  renamingId.value = null;
  renameDraft.value = '';
  emit('rename', { threadId, title });
};

const cancelRename = () => {
  renamingId.value = null;
  renameDraft.value = '';
};
</script>

<style scoped lang="scss">
.chat-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  background: var(--bg-card);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-card);
}

.chat-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  flex-shrink: 0;
}

.chat-sidebar__title {
  font-weight: 600;
  color: var(--text-primary);
}

.chat-sidebar__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chat-sidebar__state {
  padding: 16px;
  color: var(--text-secondary);
}

.chat-sidebar__thread--active {
  background: var(--nav-item-active-bg);
}
</style>
