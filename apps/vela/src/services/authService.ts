import { supabase, type Profile, type ProfileInsert } from './supabase';
// Amplify modular imports (installed via aws-amplify)
// These imports will only be used when authProvider === 'cognito'
// We import functions lazily inside methods to avoid bundling when not used.

export interface AuthResponse {
  success: boolean;
  error?: string;
  user?: { id: string; email?: string | null } | null;
  session?: AppSession | null;
}

export interface SignUpData {
  email: string;
  password: string;
  username?: string | undefined;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface ProfileData {
  username?: string | undefined;
  avatar_url?: string | undefined;
  native_language?: string | undefined;
  preferences?: Record<string, unknown> | undefined;
}

export interface AppUser {
  id: string;
  email?: string | null;
}

export interface AppSession {
  user: AppUser | null;
  // Optionally include raw provider session info for debugging
  provider?: 'cognito';
}

class AuthService {
  /**
   * Sign up a new user with email and password
   */
  async signUp({ email, password, username }: SignUpData): Promise<AuthResponse> {
    try {
      const { signUp } = await import('aws-amplify/auth');
      const result = await signUp({
        username: email,
        password,
        options: {
          userAttributes: { email },
          autoSignIn: true,
        },
      });

      // In many setups, signUp may require confirmation; we still create a profile record for the userId
      const userId = result.userId ?? '';
      if (userId) {
        await this.createUserProfile(userId, { email, username: username || null });
      }
      return { success: true, user: { id: userId, email }, session: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Sign in with email and password - bypass email confirmation
   */
  async signIn({ email, password }: SignInData): Promise<AuthResponse> {
    try {
      const { signIn, getCurrentUser, fetchAuthSession } = await import('aws-amplify/auth');
      await signIn({ username: email, password });

      // Fetch current user details
      const current = await getCurrentUser();
      const session: AppSession = {
        user: { id: current.userId, email },
        provider: 'cognito',
      };

      // Optionally fetch tokens for debug (not used by app directly)
      try {
        const authSession = await fetchAuthSession();
        if (!authSession.tokens) {
          console.warn('No tokens returned from Cognito session fetch');
        }
      } catch (e) {
        console.warn('Failed to fetch Cognito auth session', e);
      }

      // Ensure profile exists
      await this.ensureProfileForCurrentUser(current.userId, email);

      return { success: true, user: { id: current.userId, email }, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Sign in with magic link
   */
  async signInWithMagicLink(_email: string): Promise<AuthResponse> {
    return { success: false, error: 'Magic link sign-in is not supported with Cognito' };
  }

  /**
   * Confirm user signup with verification code (Cognito)
   */
  async confirmSignUp(email: string, code: string): Promise<AuthResponse> {
    try {
      const { confirmSignUp, getCurrentUser } = await import('aws-amplify/auth');
      await confirmSignUp({ username: email, confirmationCode: code });

      // Attempt to fetch current user after confirmation (may require explicit sign-in)
      try {
        const current = await getCurrentUser();
        return {
          success: true,
          user: { id: current.userId, email },
          session: { user: { id: current.userId, email }, provider: 'cognito' },
        };
      } catch {
        // Not signed in yet; return success for confirmation step only
        return { success: true, user: { id: '', email }, session: null };
      }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to confirm sign up' };
    }
  }

  /**
   * Resend verification code for signup (Cognito)
   */
  async resendSignUpCode(email: string): Promise<AuthResponse> {
    try {
      const { resendSignUpCode } = await import('aws-amplify/auth');
      await resendSignUpCode({ username: email });
      return { success: true } as AuthResponse;
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to resend verification code' };
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<AuthResponse> {
    try {
      const { signOut } = await import('aws-amplify/auth');
      await signOut();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Get the current user session
   */
  async getCurrentSession(): Promise<AppSession | null> {
    try {
      const { getCurrentUser } = await import('aws-amplify/auth');
      try {
        const current = await getCurrentUser();
        return { user: { id: current.userId }, provider: 'cognito' };
      } catch {
        return null;
      }
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Get the current user
   */
  async getCurrentUser(): Promise<{ id: string; email?: string | null } | null> {
    try {
      const { getCurrentUser } = await import('aws-amplify/auth');
      try {
        const current = await getCurrentUser();
        return { id: current.userId };
      } catch {
        return null;
      }
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Reset password with email
   */
  async resetPassword(email: string): Promise<AuthResponse> {
    try {
      const { resetPassword } = await import('aws-amplify/auth');
      await resetPassword({ username: email });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Update user password
   */
  async updatePassword(_newPassword: string): Promise<AuthResponse> {
    // Cognito requires oldPassword for updatePassword; recommend reset flow instead
    return {
      success: false,
      error: 'Password update requires current password with Cognito. Use reset password flow.',
    };
  }

  /**
   * Create user profile in the database
   */
  private async createUserProfile(
    userId: string,
    profileData: Partial<ProfileInsert>,
  ): Promise<void> {
    try {
      const { error } = await supabase.from('profiles').insert({
        id: userId,
        email: profileData.email ?? null,
        username: profileData.username ?? null,
        native_language: 'en',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        preferences: {},
      });

      if (error) {
        console.error('Error creating user profile:', error);
      }
    } catch (error) {
      console.error('Error creating user profile:', error);
    }
  }

  /**
   * Get user profile from database
   */
  async getUserProfile(userId: string): Promise<Profile | null> {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();

      if (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  /**
   * Update user profile in database
   */
  async updateUserProfile(userId: string, profileData: ProfileData): Promise<AuthResponse> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          ...profileData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Listen to authentication state changes
   */
  onAuthStateChange(callback: (_event: string, _session: AppSession | null) => void) {
    // Use Amplify Hub to listen to auth events
    // Import lazily to avoid bundling when not used
    import('aws-amplify/utils')
      .then(({ Hub }) => {
        Hub.listen('auth', async (data: any) => {
          const { eventName } = data.payload || {};
          if (eventName === 'signedIn') {
            try {
              const { getCurrentUser } = await import('aws-amplify/auth');
              const current = await getCurrentUser();
              callback('SIGNED_IN', { user: { id: current.userId }, provider: 'cognito' });
            } catch {
              callback('SIGNED_IN', null);
            }
          } else if (eventName === 'signedOut') {
            callback('SIGNED_OUT', null);
          } else if (eventName === 'tokenRefresh') {
            try {
              const { getCurrentUser } = await import('aws-amplify/auth');
              const current = await getCurrentUser();
              callback('TOKEN_REFRESHED', { user: { id: current.userId }, provider: 'cognito' });
            } catch {
              callback('TOKEN_REFRESHED', null);
            }
          }
        });
      })
      .catch((e) => {
        console.warn('Amplify Hub not available:', e);
      });
    // Return a simple unsubscribe interface (no-op)
    return {
      unsubscribe() {
        /* noop */
      },
    } as unknown as { unsubscribe: () => void };
  }

  /**
   * Ensure a user profile exists; create it if missing (used for Cognito users)
   */
  private async ensureProfileForCurrentUser(userId: string, email?: string | null): Promise<void> {
    try {
      const existing = await this.getUserProfile(userId);
      if (!existing) {
        await this.createUserProfile(userId, { email: email || null });
      }
    } catch (error) {
      console.error('Error ensuring user profile:', error);
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
