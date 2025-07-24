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

  // Actions
  const addMessage = (message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    messages.value.push(newMessage);
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

  const clearMessages = () => {
    messages.value = [];
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
    // Actions
    addMessage,
    setTyping,
    setLoading,
    setError,
    clearMessages,
    clearError,
  };
});
