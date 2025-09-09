import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  authService,
  type SignUpData,
  type SignInData,
  type ProfileData,
} from '../services/authService';
import type { UserPreferences } from '../services/supabase';
import type { AppSession } from '../services/authService';

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

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref<User | null>(null);
  const session = ref<AppSession | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitialized = ref(false);
  const pendingVerificationEmail = ref<string | null>(null);

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
    user.value = null;
    session.value = null;
    error.value = null;
    isLoading.value = false;
  };

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

      // Listen for auth state changes - bypass email confirmation checks
      authService.onAuthStateChange((event, session) => {
        void (async () => {
          console.log('Auth state changed:', event, session);

          // Allow login regardless of email confirmation status
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
    try {
      const profile = await authService.getUserProfile(userId);

      if (profile) {
        setUser({
          id: profile.id,
          email: profile.email || '',
          username: profile.username || undefined,
          avatar_url: profile.avatar_url || undefined,
          current_level: profile.current_level,
          total_experience: profile.total_experience,
          learning_streak: profile.learning_streak,
          native_language: profile.native_language,
          preferences: profile.preferences,
          last_activity: profile.last_activity || undefined,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        });
      }
    } catch (err) {
      console.error('Error loading user profile:', err);
      setError('Failed to load user profile');
    }
  };

  /**
   * Sign up a new user
   */
  const signUp = async (signUpData: SignUpData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.signUp(signUpData);

      if (!response.success) {
        setError(response.error || 'Sign up failed');
        return false;
      }

      // Session and user will be set via auth state change listener
      return true;
    } catch (err) {
      console.error('Sign up error:', err);
      setError('An unexpected error occurred during sign up');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign in with email and password
   */
  const signIn = async (signInData: SignInData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.signIn(signInData);

      if (!response.success) {
        // Handle specific error cases
        if (response.error?.includes('verify your account')) {
          setError(`${response.error} A verification code has been sent to your email.`);
          // Store the email for verification
          if (response.user?.email) {
            pendingVerificationEmail.value = response.user.email;
          }
          return false;
        }

        setError(response.error || 'Sign in failed');
        return false;
      }

      // Session and user will be set via auth state change listener
      return true;
    } catch (err) {
      console.error('Sign in error:', err);
      setError('An unexpected error occurred during sign in');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Cognito signup verification: confirm and resend code
  const confirmSignUp = async (email: string, code: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.confirmSignUp(email, code);
      if (!response.success) {
        setError(response.error || 'Verification failed');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Confirm signup error:', err);
      setError('An unexpected error occurred during verification');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const resendSignUpCode = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.resendSignUpCode(email);
      if (!response.success) {
        setError(response.error || 'Resend verification code failed');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Resend code error:', err);
      setError('An unexpected error occurred while resending verification code');
      return false;
    } finally {
      setLoading(false);
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

  /**
   * Reset password
   */
  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.resetPassword(email);

      if (!response.success) {
        setError(response.error || 'Password reset failed');
        return false;
      }

      return true;
    } catch (err) {
      console.error('Password reset error:', err);
      setError('An unexpected error occurred during password reset');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update user password
   */
  const updatePassword = async (newPassword: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.updatePassword(newPassword);

      if (!response.success) {
        setError(response.error || 'Password update failed');
        return false;
      }

      return true;
    } catch (err) {
      console.error('Password update error:', err);
      setError('An unexpected error occurred during password update');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update user profile
   */
  const updateProfile = async (profileData: ProfileData) => {
    if (!user.value) {
      setError('No user logged in');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await authService.updateUserProfile(user.value.id, profileData);

      if (!response.success) {
        setError(response.error || 'Profile update failed');
        return false;
      }

      // Reload user profile to get updated data
      await loadUserProfile(user.value.id);
      return true;
    } catch (err) {
      console.error('Profile update error:', err);
      setError('An unexpected error occurred during profile update');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update user experience and level
   */
  const updateExperience = async (experienceGained: number) => {
    if (!user.value) return false;

    const newExperience = user.value.total_experience + experienceGained;
    const newLevel = Math.floor(newExperience / 1000) + 1; // Simple level calculation

    try {
      const success = await updateProfile({
        preferences: {
          ...(user.value.preferences as UserPreferences),
          last_experience_gain: experienceGained,
        },
      });

      if (success && user.value) {
        // Update local state immediately for better UX
        user.value.total_experience = newExperience;
        user.value.current_level = newLevel;
      }

      return success;
    } catch (err) {
      console.error('Experience update error:', err);
      return false;
    }
  };

  /**
   * Update learning streak
   */
  const updateStreak = async (increment: boolean = true) => {
    if (!user.value) return false;

    const newStreak = increment ? user.value.learning_streak + 1 : 0;

    try {
      const success = await updateProfile({
        preferences: {
          ...(user.value.preferences as UserPreferences),
          last_activity_date: new Date().toISOString().split('T')[0],
        },
      });

      if (success && user.value) {
        user.value.learning_streak = newStreak;
      }

      return success;
    } catch (err) {
      console.error('Streak update error:', err);
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
    pendingVerificationEmail,
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
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    confirmSignUp,
    resendSignUpCode,
    updateProfile,
    updateExperience,
    updateStreak,
  };
});
