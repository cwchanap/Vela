import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface User {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;
  current_level: number;
  total_experience: number;
  learning_streak: number;
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref<User | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const isAuthenticated = computed(() => !!user.value);
  const userLevel = computed(() => user.value?.current_level ?? 1);
  const userExperience = computed(() => user.value?.total_experience ?? 0);

  // Actions
  const setUser = (userData: User | null) => {
    user.value = userData;
    error.value = null;
  };

  const setLoading = (loading: boolean) => {
    isLoading.value = loading;
  };

  const setError = (errorMessage: string | null) => {
    error.value = errorMessage;
  };

  const clearAuth = () => {
    user.value = null;
    error.value = null;
    isLoading.value = false;
  };

  return {
    // State
    user,
    isLoading,
    error,
    // Getters
    isAuthenticated,
    userLevel,
    userExperience,
    // Actions
    setUser,
    setLoading,
    setError,
    clearAuth,
  };
});
