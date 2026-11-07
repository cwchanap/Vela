import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authService, type ProfileData } from '../services/authService';
import type { UserPreferences, Profile } from '../types/shared';
import type { AppSession } from '../services/authService';
import { queryClient, QUERY_STALE_TIME } from '../boot/query';
import { authKeys } from '@vela/common';
import { clearAudioUrlCache } from '../services/ttsService';

export interface User {
  id: string;
  email: string;
  username?: string | undefined;
  avatar_url?: string | undefined;
  current_level: number;
  total_experience: number;
  learning_streak: number;
  native_language: string;
  preferences: UserPreferences;
  last_activity?: string | undefined;
  created_at: string;
  updated_at: string;
}

const AUTH_REDIRECT_STORAGE_KEY = 'vela.auth.redirectTo';

const getSafeAuthRedirect = (redirectTo: unknown): string => {
  if (typeof redirectTo !== 'string') {
    return '/';
  }

  const trimmedRedirect = redirectTo.trim();
  if (!trimmedRedirect.startsWith('/') || trimmedRedirect.startsWith('//')) {
    return '/';
  }

  return trimmedRedirect;
};

const getSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const savePendingAuthRedirect = (redirectTo: unknown) => {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(AUTH_REDIRECT_STORAGE_KEY, getSafeAuthRedirect(redirectTo));
  } catch {
    // Ignore storage failures; the callback will fall back to '/'.
  }
};

const clearPendingAuthRedirect = () => {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref<User | null>(null);
  const session = ref<AppSession | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitialized = ref(false);
  // Increments whenever the session user identity changes (sign-in, sign-out,
  // account switch); same-user session updates keep it stable. Async work
  // captures it to reject completions that land in a different session.
  const sessionGeneration = ref(0);

  // Getters
  const isAuthenticated = computed(() => !!user.value && !!session.value);
  const userLevel = computed(() => user.value?.current_level ?? 1);
  const userExperience = computed(() => user.value?.total_experience ?? 0);
  const userStreak = computed(() => user.value?.learning_streak ?? 0);
  const userName = computed(
    () => user.value?.username || user.value?.email?.split('@')[0] || 'User',
  );

  // Actions
  const setUser = (userData: User | null) => {
    user.value = userData;
    if (userData) {
      error.value = null;
    }
  };

  const setSession = (sessionData: AppSession | null) => {
    const previousUserId = session.value?.user?.id ?? null;
    const nextUserId = sessionData?.user?.id ?? null;
    if (previousUserId !== nextUserId) {
      sessionGeneration.value += 1;
      if (previousUserId) {
        queryClient.invalidateQueries({ queryKey: authKeys.profile(previousUserId) });
      }
      if (nextUserId) {
        queryClient.invalidateQueries({ queryKey: authKeys.profile(nextUserId) });
      }
    }
    session.value = sessionData;
  };

  const setLoading = (loading: boolean) => {
    isLoading.value = loading;
  };

  const setError = (errorMessage: string | null) => {
    error.value = errorMessage;
  };

  const setInitialized = (initialized: boolean) => {
    isInitialized.value = initialized;
  };

  const clearAuth = () => {
    const previousUserId = session.value?.user?.id ?? null;
    if (previousUserId) {
      sessionGeneration.value += 1;
      queryClient.invalidateQueries({ queryKey: authKeys.profile(previousUserId) });
    }
    user.value = null;
    session.value = null;
    error.value = null;
    isLoading.value = false;
    lastAcknowledgedProfile = null;
  };

  const userFromProfile = (profile: Profile): User => ({
    id: profile.id,
    email: profile.email || '',
    username: profile.username || undefined,
    avatar_url: profile.avatar_url || undefined,
    current_level: profile.current_level,
    total_experience: profile.total_experience,
    learning_streak: profile.learning_streak,
    native_language: profile.native_language,
    preferences: profile.preferences as unknown as UserPreferences,
    last_activity: profile.last_activity || undefined,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  });

  const profileFromUser = (source: User): Profile => ({
    id: source.id,
    username: source.username ?? null,
    email: source.email || null,
    avatar_url: source.avatar_url ?? null,
    native_language: source.native_language,
    current_level: source.current_level,
    total_experience: source.total_experience,
    learning_streak: source.learning_streak,
    last_activity: source.last_activity ?? null,
    preferences: source.preferences,
    created_at: source.created_at,
    updated_at: source.updated_at,
  });

  const applyProfileData = (base: Profile, data: ProfileData): Profile => ({
    ...base,
    username: data.username ?? base.username,
    avatar_url: data.avatar_url ?? base.avatar_url,
    native_language: data.native_language ?? base.native_language,
    preferences: (data.preferences ?? base.preferences) as unknown as Profile['preferences'],
  });

  let lastAcknowledgedProfile: { profile: Profile; generation: number } | null = null;

  /**
   * Initialize authentication state
   */
  const initialize = async () => {
    if (isInitialized.value) return;

    setLoading(true);

    try {
      // Get current session
      const currentSession = await authService.getCurrentSession();

      if (currentSession?.user) {
        setSession(currentSession);
        await loadUserProfile(currentSession.user.id);
      }

      // Listen for auth state changes
      authService.onAuthStateChange((event, session) => {
        void (async () => {
          if (event === 'OAUTH_FAILURE') {
            console.error('OAuth sign-in failed');
            setError('Sign-in failed. Please try again.');
            return;
          }

          if (event === 'TOKEN_REFRESH_FAILURE') {
            console.error('Token refresh failed');
            return;
          }

          if (session?.user) {
            setSession(session);
            await loadUserProfile(session.user.id);
          } else {
            clearAuth();
          }
        })();
      });

      setInitialized(true);
    } catch (err) {
      console.error('Error initializing auth:', err);
      setError('Failed to initialize authentication');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load user profile from database
   */
  const loadUserProfile = async (userId: string) => {
    const generation = sessionGeneration.value;
    try {
      const queryKey = authKeys.profile(userId);
      const queryState = queryClient.getQueryState(queryKey);

      // Check if cached data is fresh (not invalidated AND not stale)
      // staleTime is 5 minutes (from @vela/query)
      const isInvalidated = queryState?.isInvalidated ?? true;
      const dataAge = queryState?.dataUpdatedAt ? Date.now() - queryState.dataUpdatedAt : Infinity;
      const isStale = dataAge > QUERY_STALE_TIME;

      // Only use cached data if it's fresh (not invalidated AND not stale)
      const isFresh = !isInvalidated && !isStale && queryState?.data;
      const cachedProfile = isFresh ? queryClient.getQueryData<Profile>(queryKey) : null;

      const profile = cachedProfile || (await authService.getUserProfile(userId));

      if (profile && session.value?.user?.id === userId && sessionGeneration.value === generation) {
        const acknowledged = lastAcknowledgedProfile;
        const superseded =
          acknowledged !== null &&
          acknowledged.generation === generation &&
          acknowledged.profile.id === userId &&
          profile.updated_at <= acknowledged.profile.updated_at;
        const effectiveProfile = superseded ? acknowledged.profile : profile;
        if (!superseded) {
          lastAcknowledgedProfile = { profile, generation };
        }

        // Update query cache with fresh data
        queryClient.setQueryData(queryKey, effectiveProfile);

        setUser(userFromProfile(effectiveProfile));
      }
    } catch (err) {
      console.error('Error loading user profile:', err);
      setError('Failed to load user profile');
    }
  };

  /**
   * Start Google sign-in through Cognito Hosted UI.
   */
  const signInWithGoogle = async (redirectTo: unknown = '/') => {
    setLoading(true);
    setError(null);

    try {
      savePendingAuthRedirect(redirectTo);
      await authService.signInWithGoogle();
      return true;
    } catch (err) {
      clearPendingAuthRedirect();
      console.error('Google sign-in error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during sign in');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const consumePendingAuthRedirect = (fallbackRedirect: unknown = '/') => {
    const fallback = getSafeAuthRedirect(fallbackRedirect);
    const storage = getSessionStorage();
    if (!storage) return fallback;

    try {
      const storedRedirect = storage.getItem(AUTH_REDIRECT_STORAGE_KEY);
      storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
      return storedRedirect ? getSafeAuthRedirect(storedRedirect) : fallback;
    } catch {
      return fallback;
    }
  };

  /**
   * Sign out the current user
   */
  const signOut = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.signOut();

      if (!response.success) {
        setError(response.error || 'Sign out failed');
        return false;
      }

      // Clear all cached queries on sign out
      queryClient.clear();
      clearAudioUrlCache();

      clearAuth();
      return true;
    } catch (err) {
      console.error('Sign out error:', err);
      setError('An unexpected error occurred during sign out');
      return false;
    } finally {
      setLoading(false);
    }
  };

  let preferenceMutationQueue: Promise<void> = Promise.resolve();
  let pendingPreferenceMutations = 0;

  const enqueuePreferenceMutation = <T>(task: () => Promise<T>): Promise<T> => {
    pendingPreferenceMutations += 1;
    const runTask = () =>
      task().finally(() => {
        pendingPreferenceMutations -= 1;
      });
    const run =
      pendingPreferenceMutations === 1 ? runTask() : preferenceMutationQueue.then(runTask);
    preferenceMutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /**
   * Update user profile
   */
  const updateProfile = async (profileData: ProfileData) => {
    const initiator = user.value;
    if (!initiator) {
      setError('No user logged in');
      return false;
    }
    const userId = initiator.id;
    const generation = sessionGeneration.value;

    return enqueuePreferenceMutation(async () => {
      const current = user.value;
      if (!current || current.id !== userId || sessionGeneration.value !== generation) {
        return false;
      }

      const mergedProfileData: ProfileData =
        profileData.preferences === undefined
          ? profileData
          : {
              ...profileData,
              preferences: {
                ...(current.preferences as Record<string, unknown>),
                ...profileData.preferences,
              },
            };

      setLoading(true);
      setError(null);

      try {
        const response = await authService.updateUserProfile(userId, mergedProfileData);

        if (!response.success) {
          setError(response.error || 'Profile update failed');
          return false;
        }

        // Invalidate profile query to refetch fresh data
        queryClient.invalidateQueries({ queryKey: authKeys.profile(userId) });

        // Reload user profile to get updated data
        if (sessionGeneration.value === generation && user.value?.id === userId) {
          const acknowledged: Profile =
            response.profile ?? applyProfileData(profileFromUser(current), mergedProfileData);
          lastAcknowledgedProfile = { profile: acknowledged, generation };

          await loadUserProfile(userId);

          const latest = user.value;
          if (latest && latest.id === userId && sessionGeneration.value === generation) {
            const effective: Profile =
              latest.updated_at > acknowledged.updated_at
                ? applyProfileData(
                    profileFromUser(latest),
                    response.profile ? {} : mergedProfileData,
                  )
                : acknowledged;
            lastAcknowledgedProfile = { profile: effective, generation };
            queryClient.setQueryData(authKeys.profile(userId), effective);
            setUser(userFromProfile(effective));
          }
        }
        return sessionGeneration.value === generation && user.value?.id === userId;
      } catch (err) {
        console.error('Profile update error:', err);
        setError('An unexpected error occurred during profile update');
        return false;
      } finally {
        setLoading(false);
      }
    });
  };

  /**
   * Update user experience and level
   */
  const updateExperience = async (experienceGained: number) => {
    const initiator = user.value;
    if (!initiator) return false;
    const generation = sessionGeneration.value;

    const newExperience = initiator.total_experience + experienceGained;
    const newLevel = Math.floor(newExperience / 1000) + 1; // Simple level calculation

    try {
      const success = await updateProfile({
        preferences: {
          last_experience_gain: experienceGained,
        },
      });

      const stillCurrent =
        user.value?.id === initiator.id && sessionGeneration.value === generation;
      if (success && stillCurrent && user.value) {
        // Update local state immediately for better UX
        user.value.total_experience = newExperience;
        user.value.current_level = newLevel;
      }

      return success && stillCurrent;
    } catch (err) {
      console.error('Experience update error:', err);
      return false;
    }
  };

  /**
   * Update learning streak
   */
  const updateStreak = async (increment: boolean = true) => {
    const initiator = user.value;
    if (!initiator) return false;
    const generation = sessionGeneration.value;

    const newStreak = increment ? initiator.learning_streak + 1 : 0;

    try {
      const success = await updateProfile({
        preferences: {
          last_activity_date: new Date().toISOString().split('T')[0],
        },
      });

      const stillCurrent =
        user.value?.id === initiator.id && sessionGeneration.value === generation;
      if (success && stillCurrent && user.value) {
        user.value.learning_streak = newStreak;
      }

      return success && stillCurrent;
    } catch (err) {
      console.error('Streak update error:', err);
      return false;
    }
  };

  /**
   * Update user preferences
   */
  const updatePreferences = async (preferences: Partial<UserPreferences>) => {
    const initiator = user.value;
    if (!initiator) return false;
    const generation = sessionGeneration.value;

    try {
      const success = await updateProfile({
        preferences: { ...preferences },
      });

      const stillCurrent =
        user.value?.id === initiator.id && sessionGeneration.value === generation;
      if (success && stillCurrent && user.value) {
        // Update local state immediately
        user.value.preferences = {
          ...(user.value.preferences as UserPreferences),
          ...preferences,
        };
      }

      return success && stillCurrent;
    } catch (err) {
      console.error('Preferences update error:', err);
      return false;
    }
  };

  return {
    // State
    user,
    session,
    isLoading,
    error,
    isInitialized,
    sessionGeneration,
    // Getters
    isAuthenticated,
    userLevel,
    userExperience,
    userStreak,
    userName,
    // Actions
    setUser,
    setSession,
    setLoading,
    setError,
    setInitialized,
    clearAuth,
    initialize,
    loadUserProfile,
    signInWithGoogle,
    consumePendingAuthRedirect,
    getSafeAuthRedirect,
    signOut,
    updateProfile,
    updateExperience,
    updateStreak,
    updatePreferences,
  };
});
