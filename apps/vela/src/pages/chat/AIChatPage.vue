<template>
  <q-page class="chat-page" data-testid="ai-chat-page">
    <div class="chat-body">
      <aside v-if="!isNarrowScreen" class="chat-sidebar-pane" data-testid="chat-sidebar-pane">
        <ChatSidebar
          :threads="threads"
          :active-thread-id="chat.chatId"
          :loading="threadsLoading"
          :error="threadsError"
          :disabled="chat.isLoading"
          @select="selectThread"
          @new="onNewChat"
          @rename="onRenameThread"
          @delete="confirmDelete"
          @retry="retryThreads"
        />
      </aside>

      <div class="chat-column">
        <div class="chat-header">
          <q-btn
            v-if="isNarrowScreen"
            flat
            dense
            round
            icon="history"
            color="primary"
            aria-label="Open conversations"
            @click="mobileSidebarOpen = true"
            data-testid="llm-chat-history"
            class="q-mr-sm"
          />
          <h1 class="chat-title">AI Chat</h1>
        </div>

        <ChatMessageList
          ref="messageListRef"
          :messages="chat.messages"
          :is-typing="chat.isTyping"
        />

        <ChatComposer
          v-model="input"
          :loading="chat.isLoading"
          @send="onSend"
          class="chat-composer"
        />
      </div>
    </div>

    <q-dialog v-model="mobileSidebarOpen" position="left">
      <div class="chat-sidebar-mobile">
        <ChatSidebar
          :threads="threads"
          :active-thread-id="chat.chatId"
          :loading="threadsLoading"
          :error="threadsError"
          :disabled="chat.isLoading"
          @select="selectThread"
          @new="onNewChat"
          @rename="onRenameThread"
          @delete="confirmDelete"
          @retry="retryThreads"
        />
      </div>
    </q-dialog>

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="showDeleteConfirm" :persistent="isDeleting">
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
          <q-btn flat label="Cancel" :disable="isDeleting" @click="showDeleteConfirm = false" />
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
import { ref, computed, watch, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { storeToRefs } from 'pinia';
import { useQueryClient } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatComposer from './components/ChatComposer.vue';
import ChatSidebar from './components/ChatSidebar.vue';
import {
  useChatThreads,
  useRenameThread,
  useDeleteThread,
  useSaveChatMessage,
  useChatMessages,
} from '../../composables/queries';
import type { ChatThreadSummaryDTO } from '../../services/chatHistoryService';
import { llmClient, describeLlmError } from '../../services/llm';
import { isAccountChangedError } from '../../utils/httpClient';
import type { LlmMessage } from '@vela/common';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const auth = useAuthStore();
const { selection } = storeToRefs(llmSettings);
const queryClient = useQueryClient();

// Greeting message constant
const GREETING_MESSAGE =
  'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

const input = ref('');
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);

const isNarrowScreen = computed(() => $q.screen?.lt?.md === true);
const mobileSidebarOpen = ref(false);

const threadsQuery = useChatThreads();
const threads = computed<ChatThreadSummaryDTO[]>(() => threadsQuery.data.value ?? []);
const threadsLoading = computed(() => threadsQuery.isLoading.value);
const threadsError = computed(() => threadsQuery.isError.value);
const renameThreadMutation = useRenameThread();
const deleteThreadMutation = useDeleteThread();
const saveChatMessageMutation = useSaveChatMessage();
const chatMessagesHelper = useChatMessages();

// Delete confirmation dialog state
const showDeleteConfirm = ref(false);
const threadToDelete = ref<ChatThreadSummaryDTO | null>(null);
const isDeleting = ref(false);
const dialogGen = ref(0);
const pendingDeletes = new Map<string, symbol>();
const deleteKey = (sessionGen: number, uid: string, threadId: string) =>
  `${sessionGen}\n${uid}\n${threadId}`;

watch(isNarrowScreen, (narrow) => {
  if (!narrow) mobileSidebarOpen.value = false;
});

const scrollToBottom = () => messageListRef.value?.scrollToBottom();

const getUserId = () => auth.user?.id || auth.session?.user?.id || 'anonymous';

const isStaleOperation = (opGen: number, sessionGen: number) =>
  chat.isStale(opGen) || auth.sessionGeneration !== sessionGen;

watch(
  () => [getUserId(), auth.sessionGeneration] as const,
  ([nextUid, nextGen], [prevUid, prevGen]) => {
    if (nextUid === prevUid && nextGen === prevGen) return;
    chat.resetForUser(nextUid, nextGen);
    chat.addMessage({ type: 'ai', content: GREETING_MESSAGE });
    showDeleteConfirm.value = false;
    threadToDelete.value = null;
    isDeleting.value = false;
    dialogGen.value += 1;
    pendingDeletes.clear();
  },
);

const isDeletePending = (threadId: string) =>
  pendingDeletes.has(deleteKey(auth.sessionGeneration, getUserId(), threadId));

// A deleted row leaves the list only after its DELETE resolves, so an
// in-flight selection for it must not install the thread once its response
// lands. The same check covers threads deleted from another device.
const isThreadUnavailable = (threadId: string) =>
  isDeletePending(threadId) || !threads.value.some((t) => t.ThreadId === threadId);

const ensureChatId = () => {
  if (!chat.chatId) {
    chat.setChatId(crypto.randomUUID());
  }
  return chat.chatId!;
};

const isNotFoundStatus = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (('status' in e && (e as { status: unknown }).status === 404) ||
    ('statusCode' in e && (e as { statusCode: unknown }).statusCode === 404) ||
    ('message' in e &&
      typeof (e as { message: unknown }).message === 'string' &&
      (e as { message: string }).message.includes('Thread not found')));

type PersistResult = 'saved' | 'failed' | 'gone';

const persistMessage = async (
  cid: string,
  uid: string,
  message: string,
  isUser: boolean,
  isStale: () => boolean,
): Promise<PersistResult> => {
  try {
    await saveChatMessageMutation.mutateAsync({
      threadId: cid,
      userId: uid,
      message,
      isUser,
    });
    return 'saved';
  } catch (e) {
    if (isStale()) return 'failed';
    if (isAccountChangedError(e)) throw e;
    console.error('Failed to save chat message', e);
    if (isNotFoundStatus(e) && chat.chatId === cid) {
      // The open thread was deleted (e.g. in another tab). The caller restarts
      // the chat so the visible transcript and stored history stay in lockstep.
      return 'gone';
    }
    $q.notify({ type: 'warning', message: 'Failed to save chat history' });
    return 'failed';
  }
};

// A save that 404s means the open thread was deleted elsewhere. Make the
// "Started a new chat" transition real: drop the dead transcript, then
// re-show and re-save the in-flight turns under a fresh thread id so the
// visible transcript and persisted history match on reload.
const restartDeletedChat = async (
  uid: string,
  turns: Array<{ message: string; isUser: boolean }>,
  isStale: () => boolean,
): Promise<string | null> => {
  const freshId = crypto.randomUUID();
  chat.setChatId(freshId);
  chat.clearMessages();
  chat.addMessage({ type: 'ai', content: GREETING_MESSAGE });
  void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
  $q.notify({
    type: 'warning',
    message: 'This conversation was deleted. Started a new chat.',
  });
  for (const turn of turns) {
    chat.addMessage({ type: turn.isUser ? 'user' : 'ai', content: turn.message });
    const status = await persistMessage(freshId, uid, turn.message, turn.isUser, isStale);
    if (status !== 'saved') return null;
  }
  return freshId;
};

const retryThreads = () => {
  void threadsQuery.refetch();
};

const selectThread = async (t: ChatThreadSummaryDTO) => {
  if (chat.isLoading || isDeletePending(t.ThreadId)) return;
  const uid = getUserId();
  const opGen = chat.nextGeneration();
  const sessionGen = auth.sessionGeneration;
  try {
    const items = await chatMessagesHelper.getMessages(t.ThreadId, uid);
    if (isStaleOperation(opGen, sessionGen) || isThreadUnavailable(t.ThreadId)) return;

    chat.setChatId(t.ThreadId);

    // Convert the messages to the correct type format
    const restoredMessages = items.map((it) => ({
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
    mobileSidebarOpen.value = false;
    await scrollToBottom();
  } catch (e) {
    if (isStaleOperation(opGen, sessionGen) || isThreadUnavailable(t.ThreadId)) return;
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to load conversation' });
  }
};

const onSend = async (draft: string) => {
  const content = draft.trim();
  if (!content || chat.isLoading) return;

  chat.clearError();

  const uid = getUserId();
  const cid = ensureChatId();
  if (isDeletePending(cid)) return;
  const opGen = chat.nextGeneration();
  const sessionGen = auth.sessionGeneration;
  const isStale = () => isStaleOperation(opGen, sessionGen);
  chat.addMessage({ type: 'user', content });
  input.value = '';
  chat.setLoading(true);
  chat.setTyping(true);
  await scrollToBottom();

  try {
    const turns: Array<{ message: string; isUser: boolean }> = [{ message: content, isUser: true }];
    let saveCid = cid;
    const firstSave = await persistMessage(saveCid, uid, content, true, isStale);
    let userSaved = firstSave === 'saved';
    if (firstSave === 'gone') {
      const restarted = await restartDeletedChat(uid, turns, isStale);
      userSaved = restarted !== null;
      if (restarted !== null) saveCid = restarted;
    }
    if (userSaved) {
      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
    }
    if (isStale()) return;

    const systemPrompt =
      'You are a helpful Japanese learning assistant. Keep responses concise and friendly. When relevant, include romaji for Japanese text.';

    const history: LlmMessage[] = chat.messages.map((m) => ({
      role: m.type === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Explicit per-request snapshot of the active provider/model/key; there is
    // no global service state to keep in sync.
    const resp = await llmClient.generate(
      {
        provider: selection.value.provider,
        model: selection.value.model,
        apiKey: selection.value.apiKey,
        ...(selection.value.thinking ? { thinking: selection.value.thinking } : {}),
        system: systemPrompt,
        messages: history,
      },
      uid,
    );
    if (isStale()) return;

    // A successful-but-empty reply must not be stored: an empty assistant
    // turn would make the next request fail content min(1) validation.
    if (!resp.text.trim()) {
      throw new Error('The AI returned an empty response. Please try again.');
    }

    chat.addMessage({ type: 'ai', content: resp.text });
    turns.push({ message: resp.text, isUser: false });
    // Skip the assistant save when the user save failed: the message would be
    // written without a companion user turn or surviving thread metadata.
    if (userSaved) {
      const assistantSave = await persistMessage(saveCid, uid, resp.text, false, isStale);
      if (assistantSave === 'gone') {
        await restartDeletedChat(uid, turns, isStale);
      }
    }
  } catch (e: unknown) {
    if (isStale()) return;
    console.error(e);
    const message = describeLlmError(e, 'Failed to get AI response');
    chat.setError(message);
    $q.notify({ type: 'negative', message });
  } finally {
    if (!isStale()) {
      chat.setTyping(false);
      chat.setLoading(false);
      await scrollToBottom();
    }
  }
};

const onNewChat = () => {
  if (chat.isLoading) return;
  chat.startNewChat();
  // Add a fresh greeting for the new chat
  chat.addMessage({
    type: 'ai',
    content: GREETING_MESSAGE,
  });
  mobileSidebarOpen.value = false;
  void scrollToBottom();
};

const onRenameThread = async ({ threadId, title }: { threadId: string; title: string }) => {
  if (chat.isLoading) return;
  const sessionGen = auth.sessionGeneration;
  try {
    await renameThreadMutation.mutateAsync({
      threadId,
      patch: { title },
      userId: getUserId(),
    });
  } catch (e) {
    if (auth.sessionGeneration !== sessionGen) return;
    console.error(e);
    $q.notify({ type: 'negative', message: 'Failed to rename conversation' });
  }
};

const confirmDelete = (t: ChatThreadSummaryDTO) => {
  if (chat.isLoading || isDeletePending(t.ThreadId)) return;
  threadToDelete.value = t;
  showDeleteConfirm.value = true;
  dialogGen.value += 1;
};

const deleteThread = async () => {
  const thread = threadToDelete.value;
  if (!thread || chat.isLoading) return;

  isDeleting.value = true;
  const uid = getUserId();
  const isActiveThread = chat.chatId === thread.ThreadId;
  const opGen = isActiveThread ? chat.nextGeneration() : chat.generation;
  const sessionGen = auth.sessionGeneration;
  const dialogToken = dialogGen.value;
  const key = deleteKey(sessionGen, uid, thread.ThreadId);
  const token = Symbol(thread.ThreadId);
  pendingDeletes.set(key, token);
  try {
    await deleteThreadMutation.mutateAsync({
      threadId: thread.ThreadId,
      userId: uid,
    });

    if (auth.sessionGeneration === sessionGen) {
      // Recheck the current chat rather than trusting the pre-await snapshot:
      // the user may have selected or started another conversation while the
      // DELETE was in flight, and only the still-active thread may be reset.
      if (chat.chatId === thread.ThreadId) {
        chat.startNewChat();
        chat.addMessage({
          type: 'ai',
          content: GREETING_MESSAGE,
        });
      }

      $q.notify({ type: 'positive', message: 'Conversation deleted successfully' });
    }
  } catch (e) {
    if (!isStaleOperation(opGen, sessionGen)) {
      console.error(e);
      $q.notify({ type: 'negative', message: 'Failed to delete conversation' });
    }
  } finally {
    if (pendingDeletes.get(key) === token) {
      pendingDeletes.delete(key);
    }
    if (dialogToken === dialogGen.value) {
      isDeleting.value = false;
      showDeleteConfirm.value = false;
      threadToDelete.value = null;
    }
  }
};

onMounted(() => {
  const uid = getUserId();
  const sessionGen = auth.sessionGeneration;
  if (chat.ownerId === null) {
    chat.bindOwner(uid, sessionGen);
  } else if (chat.ownerId !== uid || chat.ownerSessionGen !== sessionGen) {
    chat.resetForUser(uid, sessionGen);
  }
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
  height: calc(100dvh - 61px);
  box-sizing: border-box;
  overflow: hidden;
  padding: 24px;
  background: var(--bg-page);
  display: flex;
  flex-direction: column;
}

.chat-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
}

.chat-sidebar-pane {
  flex: 0 0 280px;
  min-height: 0;
  display: flex;
}

.chat-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-width: 900px;
  margin: 0 auto;
}

.chat-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.chat-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.chat-composer {
  flex-shrink: 0;
}

.chat-sidebar-mobile {
  width: 300px;
  max-width: 85vw;
  height: 100%;
  background: var(--bg-page);
  display: flex;
  flex-direction: column;
}
</style>
