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
        <div class="chat-header" :class="{ 'chat-header--stacked': isNarrowScreen }">
          <div class="chat-header-row">
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
          <div class="chat-controls">
            <ChatModelPicker
              :pair="chat.activeModel"
              :options="modelOptions"
              :thinking="chat.thinkingOverride"
              :disabled="chat.isLoading || modelPatching"
              @update:pair="onModelSelect"
              @update:thinking="onThinkingSelect"
            />
          </div>
        </div>

        <ChatMessageList
          ref="messageListRef"
          :messages="chat.messages"
          :is-typing="chat.isTyping"
        />

        <ChatComposer
          v-model="input"
          :loading="chat.isLoading || modelPatching"
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
import { useQueryClient } from '@tanstack/vue-query';
import { chatKeys, LLM_PROVIDER_REGISTRY, type LlmEffort } from '@vela/common';
import { useChatStore, type ChatModelPair } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatComposer from './components/ChatComposer.vue';
import ChatSidebar from './components/ChatSidebar.vue';
import ChatModelPicker from './components/ChatModelPicker.vue';
import {
  useChatThreads,
  useUpdateThread,
  useDeleteThread,
  useSaveChatMessage,
  useChatMessages,
} from '../../composables/queries';
import { useLlmCapabilitiesQuery } from '../../composables/queries/useLlmCapabilitiesQuery';
import type { ChatThreadSummaryDTO } from '../../services/chatHistoryService';
import { llmClient, describeLlmError } from '../../services/llm';
import { isAccountChangedError } from '../../utils/httpClient';
import {
  buildLlmModelOptions,
  confirmedServerKeyProviders,
  llmPairOption,
  pairToOptionValue,
  type LlmModelOption,
} from '../../utils/llmModelOptions';
import type { LlmMessage } from '@vela/common';

const $q = useQuasar();
const chat = useChatStore();
const llmSettings = useLLMSettingsStore();
const auth = useAuthStore();
const queryClient = useQueryClient();
const capabilitiesQuery = useLlmCapabilitiesQuery();

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
const updateThreadMutation = useUpdateThread();
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
    seedActiveModel();
    chat.addMessage({ type: 'ai', content: GREETING_MESSAGE });
    showDeleteConfirm.value = false;
    threadToDelete.value = null;
    isDeleting.value = false;
    dialogGen.value += 1;
    pendingDeletes.clear();
  },
);

// A fresh chat starts from the Settings default; an existing chat keeps its
// model across remounts and thread switches.
const seedActiveModel = () => {
  if (!chat.activeModel) {
    chat.setActiveModel({ ...llmSettings.llm.defaultModel });
  }
};

// Server-key eligibility comes only from an affirmative capabilities response.
const serverKeyProviders = computed(() =>
  confirmedServerKeyProviders(capabilitiesQuery.data.value, {
    isAuthenticated: auth.isAuthenticated,
    isError: capabilitiesQuery.isError.value,
  }),
);

const modelOptions = computed<LlmModelOption[]>(() => {
  const options = buildLlmModelOptions(llmSettings.llm.keys, serverKeyProviders.value);
  const pair = chat.activeModel;
  if (pair) {
    const value = pairToOptionValue(pair.provider, pair.model);
    if (!options.some((option) => option.value === value)) {
      // Keep an unusable stored/current model visible instead of silently
      // substituting another choice.
      options.push({ ...llmPairOption(pair.provider, pair.model), disabled: true });
    }
  }
  return options;
});

const modelPatching = ref(false);

const onThinkingSelect = (value: LlmEffort | null) => {
  chat.setThinkingOverride(value);
};

const onModelSelect = async (pair: ChatModelPair) => {
  if (chat.isLoading || modelPatching.value) return;
  if (
    chat.activeModel &&
    chat.activeModel.provider === pair.provider &&
    chat.activeModel.model === pair.model
  ) {
    return;
  }
  // A switch always drops the session thinking choice and prior cache evidence.
  const applyLocally = () => {
    chat.setActiveModel(pair);
    chat.setThinkingOverride(null);
    chat.setCacheStartedAt(null);
  };
  if (!chat.isPersistedThread || !chat.chatId) {
    // Fresh chat: the first user save carries the model, so no PATCH here.
    applyLocally();
    return;
  }
  const uid = getUserId();
  const sessionGen = auth.sessionGeneration;
  const threadId = chat.chatId;
  modelPatching.value = true;
  try {
    await updateThreadMutation.mutateAsync({
      threadId,
      patch: { model: pair },
      userId: uid,
    });
    if (auth.sessionGeneration !== sessionGen || chat.chatId !== threadId) return;
    applyLocally();
  } catch (e) {
    if (auth.sessionGeneration === sessionGen && chat.chatId === threadId) {
      // Leave activeModel/cacheStartedAt untouched: no hidden model swap.
      console.error(e);
      $q.notify({ type: 'negative', message: 'Failed to change model' });
    }
  } finally {
    modelPatching.value = false;
  }
};

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
  model?: ChatModelPair,
): Promise<PersistResult> => {
  try {
    await saveChatMessageMutation.mutateAsync({
      threadId: cid,
      userId: uid,
      message,
      isUser,
      ...(isUser && model ? { model: { ...model } } : {}),
    });
    if (isUser && !isStale() && chat.chatId === cid) {
      // The row now exists; a client UUID alone never proved persistence.
      chat.setIsPersistedThread(true);
    }
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
  model?: ChatModelPair,
): Promise<string | null> => {
  const freshId = crypto.randomUUID();
  chat.setChatId(freshId);
  chat.clearMessages();
  // Keep the selected model for the replay, but the replacement thread has no
  // row yet and must not inherit the old thread's cache evidence or the
  // previous chat's session thinking choice.
  chat.setCacheStartedAt(null);
  chat.setThinkingOverride(null);
  chat.setIsPersistedThread(false);
  chat.addMessage({ type: 'ai', content: GREETING_MESSAGE });
  void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
  $q.notify({
    type: 'warning',
    message: 'This conversation was deleted. Started a new chat.',
  });
  for (const turn of turns) {
    // A save that resolves after an account switch must not replay the next
    // turn into the new account's freshly reset transcript. Successful saves
    // bypass persistMessage's stale check, so recheck around each await.
    if (isStale()) return null;
    chat.addMessage({ type: turn.isUser ? 'user' : 'ai', content: turn.message });
    const status = await persistMessage(
      freshId,
      uid,
      turn.message,
      turn.isUser,
      isStale,
      turn.isUser ? model : undefined,
    );
    if (status !== 'saved' || isStale()) return null;
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
    // Restore the thread's own choice: stored model (or the Settings default
    // for legacy rows) and its cache evidence; the session thinking pick is
    // per-chat and never carries across threads.
    chat.setActiveModel(
      t.model
        ? { provider: t.model.provider, model: t.model.model }
        : { ...llmSettings.llm.defaultModel },
    );
    chat.setCacheStartedAt(typeof t.lastLlmAt === 'number' ? t.lastLlmAt : null);
    chat.setThinkingOverride(null);
    chat.setIsPersistedThread(true);

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

  // Per-request snapshot for both persistence and generation; a thread-specific
  // choice must never resolve through the global llmSettings.selection.
  const activePair: ChatModelPair = chat.activeModel ?? { ...llmSettings.llm.defaultModel };
  const activeSelection = llmSettings.selectionFor(activePair);
  if (!activeSelection.apiKey && !serverKeyProviders.value.includes(activeSelection.provider)) {
    $q.notify({
      type: 'warning',
      message: `No API key for ${
        LLM_PROVIDER_REGISTRY[activeSelection.provider].label
      } and no confirmed server key. Add a key in Settings or retry the availability check.`,
    });
    return;
  }

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
    const firstSave = await persistMessage(saveCid, uid, content, true, isStale, activePair);
    let userSaved = firstSave === 'saved';
    if (firstSave === 'gone') {
      const restarted = await restartDeletedChat(uid, turns, isStale, activePair);
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

    // Explicit per-request snapshot of the active provider/model/key and any
    // session thinking override; there is no global service state to sync.
    const thinking = chat.thinkingOverride ?? activeSelection.thinking;
    const resp = await llmClient.generate(
      {
        provider: activeSelection.provider,
        model: activeSelection.model,
        apiKey: activeSelection.apiKey,
        ...(thinking ? { thinking } : {}),
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
        await restartDeletedChat(uid, turns, isStale, activePair);
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
  seedActiveModel();
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
    await updateThreadMutation.mutateAsync({
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
        seedActiveModel();
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
  // Seed only a fresh chat's model; keep any existing model on remount.
  seedActiveModel();
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
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
  min-width: 0;
}

.chat-header-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.chat-controls {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

/* 375px has no room for title + both controls in one 327px row: wrap the
   controls onto a second full-width row while keeping the title visible. */
.chat-header--stacked .chat-controls {
  flex: 1 1 100%;
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
