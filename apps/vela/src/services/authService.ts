// AWS Cognito authentication using Amplify
import { Amplify } from 'aws-amplify';
import {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  confirmSignUp,
  resendSignUpCode,
  fetchAuthSession,
  fetchUserAttributes,
  resetPassword,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import type { Profile, ProfileInsert } from '../types/shared';
import { config } from '../config';
import { httpJsonAuth } from 'src/utils/httpClient';

// Configure Amplify with Cognito
const configureAmplify = () => {
  const { userPoolId, userPoolClientId, region } = config.cognito;
  if (!userPoolId || !userPoolClientId || !region) {
    console.warn('⚠️ Missing Cognito configuration. Authentication will be disabled.');
    return false;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
      },
    },
  });

  if (config.app?.isDev) {
    console.debug('✅ Amplify configured with Cognito', {
      userPoolId,
      userPoolClientId,
    });
  } else {
    console.log('✅ Amplify configured with Cognito');
  }
  return true;
};

const cognitoEnabled = configureAmplify();

// Listen to auth events
if (cognitoEnabled) {
  Hub.listen('auth', (data) => {
    const { event } = data.payload;
    if (event === 'signedIn') {
      console.log('✅ User signed in to Cognito');
    } else if (event === 'signedOut') {
      console.log('✅ User signed out from Cognito');
    } else if (event === 'tokenRefresh') {
      console.log('✅ Cognito token refreshed successfully');
    }
  });
}

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
  provider?: 'cognito';
}

class AuthService {
  /**
   * Sign up a new user with email and password
   */
  async signUp({ email, password, username }: SignUpData): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled. Please check Cognito configuration.',
      };
    }

    try {
      const result = await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            // Store the provided username as a Cognito attribute for later retrieval
            ...(username ? { preferred_username: username } : {}),
          },
          // Auto-confirm user since email verification is disabled
          autoSignIn: false, // Disable auto-signin to avoid verification issues
        },
      });

      if (result.userId) {
        // Automatically confirm the user to bypass email verification
        try {
          await this.autoConfirmUser(email);
        } catch (confirmError) {
          console.warn('Auto-confirmation failed, but signup was successful:', confirmError);
          // Don't fail the signup if auto-confirmation fails
        }
      }

      return {
        success: true,
        user: { id: result.userId || '', email },
        session: null,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn({ email, password }: SignInData): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled. Please check Cognito configuration.',
      };
    }

    const performSignIn = async (): Promise<any> => {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        return result;
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        // Auto-confirm user
        await this.autoConfirmUser(email);
        // Retry sign in
        return await performSignIn();
      } else {
        throw new Error('Sign in failed');
      }
    };

    try {
      await performSignIn();
      // Get current user to get the userId
      const currentUser = await getCurrentUser();

      // Fetch user attributes to get the stored username
      let username: string | null = null;
      try {
        const attributes = await fetchUserAttributes();
        username = attributes.preferred_username || null;
      } catch {
        // Ignore attribute fetch errors
      }

      // Ensure profile exists with username
      await this.ensureProfileForCurrentUser(currentUser.userId, email, username);

      return {
        success: true,
        user: { id: currentUser.userId, email },
        session: {
          user: { id: currentUser.userId, email },
          provider: 'cognito',
        },
      };
    } catch (error) {
      // Handle specific Cognito errors
      if (error instanceof Error) {
        if (
          error.name === 'UserNotConfirmedException' ||
          error.message.includes('User is not confirmed') ||
          error.message.includes('UserNotConfirmedException')
        ) {
          try {
            // Auto-confirm user
            await this.autoConfirmUser(email);
            // Retry sign in
            await performSignIn();
            const currentUser = await getCurrentUser();

            // Fetch user attributes to get the stored username
            let username: string | null = null;
            try {
              const attributes = await fetchUserAttributes();
              username = attributes.preferred_username || null;
            } catch {
              // Ignore attribute fetch errors
            }

            await this.ensureProfileForCurrentUser(currentUser.userId, email, username);
            return {
              success: true,
              user: { id: currentUser.userId, email },
              session: {
                user: { id: currentUser.userId, email },
                provider: 'cognito',
              },
            };
          } catch {
            return {
              success: false,
              error: 'Sign in failed after auto-confirmation',
            };
          }
        }
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return { success: true }; // Already "signed out" if auth is disabled
    }

    try {
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
    if (!cognitoEnabled) {
      return null;
    }

    try {
      const session = await fetchAuthSession();
      if (session.tokens?.accessToken) {
        const user = await getCurrentUser();
        return {
          user: { id: user.userId, email: user.signInDetails?.loginId || null },
          provider: 'cognito',
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Get the current user
   */
  async getCurrentUser(): Promise<{ id: string; email?: string | null } | null> {
    if (!cognitoEnabled) {
      return null;
    }

    try {
      const user = await getCurrentUser();
      return { id: user.userId, email: user.signInDetails?.loginId || null };
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Automatically confirm user after signup (bypasses email verification)
   */
  private async autoConfirmUser(email: string): Promise<void> {
    try {
      // Call our API endpoint to auto-confirm the user
      const response = await fetch(`${config.api.url}auth/auto-confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to auto-confirm user');
      }

      console.log('✅ User auto-confirmed successfully');
    } catch (error) {
      console.warn('Auto-confirmation failed:', error);
      throw error;
    }
  }

  /**
   * Confirm user signup with verification code
   */
  async confirmSignUp(email: string, code: string): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled.',
      };
    }

    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to confirm sign up',
      };
    }
  }

  /**
   * Resend verification code for signup
   */
  async resendSignUpCode(email: string): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled.',
      };
    }

    try {
      await resendSignUpCode({ username: email });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resend verification code',
      };
    }
  }

  /**
   * Reset password with email
   */
  async resetPassword(email: string): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled.',
      };
    }

    try {
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
   * Update user password (requires old password for Cognito)
   */
  async updatePassword(_newPassword: string): Promise<AuthResponse> {
    if (!cognitoEnabled) {
      return {
        success: false,
        error: 'Authentication is currently disabled.',
      };
    }

    // Cognito requires old password for update, recommend reset flow instead
    return {
      success: false,
      error: 'Password update requires current password with Cognito. Use reset password flow.',
    };
  }

  /**
   * Create user profile via API
   */
  private async createUserProfile(
    userId: string,
    profileData: Partial<ProfileInsert>,
  ): Promise<void> {
    try {
      await httpJsonAuth<{ success: boolean }>(`${config.api.url}profiles/create`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          email: profileData.email,
          username: profileData.username,
        }),
      });
    } catch (error) {
      console.error('Error creating user profile:', error);
    }
  }

  /**
   * Get user profile from API
   */
  async getUserProfile(userId: string): Promise<Profile | null> {
    try {
      const data = await httpJsonAuth<{ profile: Profile }>(
        `${config.api.url}profiles?user_id=${encodeURIComponent(userId)}`,
      );
      return data.profile;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  /**
   * Update user profile via API
   */
  async updateUserProfile(userId: string, profileData: ProfileData): Promise<AuthResponse> {
    try {
      await httpJsonAuth<{ success: boolean }>(`${config.api.url}profiles/update`, {
        method: 'PUT',
        body: JSON.stringify({
          user_id: userId,
          ...profileData,
        }),
      });

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
    if (!cognitoEnabled) {
      console.warn('⚠️ Cognito authentication is disabled');
      return {
        unsubscribe: () => {
          /* noop */
        },
      };
    }

    const unsubscribe = Hub.listen('auth', async (data) => {
      const { event } = data.payload;

      if (event === 'signedIn') {
        try {
          const user = await getCurrentUser();
          const session = await fetchAuthSession();

          if (session.tokens?.accessToken) {
            // Fetch user attributes to get the stored username
            let username: string | null = null;
            try {
              const attributes = await fetchUserAttributes();
              username = attributes.preferred_username || null;
            } catch {
              // Ignore attribute fetch errors
            }

            // Ensure profile exists when user signs in
            await this.ensureProfileForCurrentUser(
              user.userId,
              user.signInDetails?.loginId,
              username,
            );

            callback('SIGNED_IN', {
              user: { id: user.userId, email: user.signInDetails?.loginId || null },
              provider: 'cognito',
            });
          }
        } catch (error) {
          console.error('Error handling sign in:', error);
        }
      } else if (event === 'signedOut') {
        callback('SIGNED_OUT', null);
      }
    });

    return {
      unsubscribe: () => unsubscribe(),
    };
  }

  /**
   * Ensure a user profile exists; create it if missing
   * Uses upsert pattern to avoid race condition where GET auto-creates without username
   */
  private async ensureProfileForCurrentUser(
    userId: string,
    email?: string | null,
    username?: string | null,
  ): Promise<void> {
    try {
      // Always attempt to create the profile with username first
      // The backend will handle duplicates gracefully
      await this.createUserProfile(userId, { email: email || null, username: username || null });
    } catch (error) {
      // If create fails (e.g., profile already exists), that's fine
      // The profile was created either by us or by a concurrent request
      console.log('Profile creation completed (may already exist):', error);
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
