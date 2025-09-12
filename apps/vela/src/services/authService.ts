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
  resetPassword,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import type { Profile, ProfileInsert } from '../types/shared';
import { config } from '../config';

// Configure Amplify with Cognito
const configureAmplify = () => {
  if (config.authProvider !== 'cognito') {
    console.warn('⚠️ Auth provider is not set to cognito');
    return false;
  }

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

  console.log('✅ Amplify configured with Cognito');
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

        // Create user profile
        await this.createUserProfile(result.userId, {
          email,
          username: username || email.split('@')[0] || null,
        });
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

    try {
      const result = await signIn({ username: email, password });

      if (result.isSignedIn) {
        // Get current user to get the userId
        const currentUser = await getCurrentUser();

        // Ensure profile exists
        await this.ensureProfileForCurrentUser(currentUser.userId, email);

        return {
          success: true,
          user: { id: currentUser.userId, email },
          session: {
            user: { id: currentUser.userId, email },
            provider: 'cognito',
          },
        };
      }

      // Handle email verification requirement
      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        return {
          success: false,
          error:
            'Your account requires email verification. Please check your email for a verification code and try signing up again.',
          user: { id: '', email },
        };
      }

      return {
        success: false,
        error: 'Sign in failed',
      };
    } catch (error) {
      // Handle specific Cognito errors
      if (error instanceof Error) {
        if (
          error.name === 'UserNotConfirmedException' ||
          error.message.includes('User is not confirmed') ||
          error.message.includes('UserNotConfirmedException')
        ) {
          return {
            success: false,
            error:
              'Your account requires email verification. Please check your email for a verification code and complete the signup process.',
            user: { id: '', email: email },
          };
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
      const response = await fetch('/api/auth/auto-confirm', {
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
      await fetch('/api/profiles/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
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
      const response = await fetch(`/api/profiles?user_id=${userId}`);
      if (!response.ok) {
        console.error('Error fetching user profile:', response.statusText);
        return null;
      }

      const data = await response.json();
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
      const response = await fetch('/api/profiles/update', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          ...profileData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return { success: false, error: errorData.error || 'Failed to update profile' };
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
            // Ensure profile exists when user signs in
            await this.ensureProfileForCurrentUser(user.userId, user.signInDetails?.loginId);

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
