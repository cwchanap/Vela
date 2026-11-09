import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export const useChatStore = defineStore('chat', () => {
  // State
  const messages = ref<ChatMessage[]>([]);
  const isTyping = ref(false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const chatId = ref<string | null>(null); // current conversation/thread id
  const ownerId = ref<string | null>(null);
  const ownerSessionGen = ref<number | null>(null);
  const generation = ref(0);

  const nextGeneration = () => ++generation.value;
  const isStale = (gen: number) => gen !== generation.value;

  // Actions
  const addMessage = (message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    messages.value.push(newMessage);
  };

  const setMessages = (list: ChatMessage[]) => {
    messages.value = [...list];
  };

  const setTyping = (typing: boolean) => {
    isTyping.value = typing;
  };

  const setLoading = (loading: boolean) => {
    isLoading.value = loading;
  };

  const setError = (errorMessage: string | null) => {
    error.value = errorMessage;
  };

  const setChatId = (id: string | null) => {
    chatId.value = id;
  };

  const startNewChat = () => {
    generation.value += 1;
    chatId.value = crypto.randomUUID();
    messages.value = [];
    error.value = null;
    isTyping.value = false;
    isLoading.value = false;
  };

  const resetForUser = (uid: string | null, sessionGen: number | null) => {
    startNewChat();
    ownerId.value = uid;
    ownerSessionGen.value = sessionGen;
  };

  const bindOwner = (uid: string | null, sessionGen: number | null) => {
    ownerId.value = uid;
    ownerSessionGen.value = sessionGen;
  };

  const clearMessages = () => {
    messages.value = [];
    // keep chatId as-is so subsequent sends continue the same thread unless caller resets
  };

  const clearError = () => {
    error.value = null;
  };

  return {
    // State
    messages,
    isTyping,
    isLoading,
    error,
    chatId,
    ownerId,
    ownerSessionGen,
    generation,
    // Actions
    nextGeneration,
    isStale,
    addMessage,
    setMessages,
    setTyping,
    setLoading,
    setError,
    setChatId,
    startNewChat,
    resetForUser,
    bindOwner,
    clearMessages,
    clearError,
  };
});
