// AWS Cognito authentication using Amplify
// Side-effect import: registers the OAuth redirect listener so that
// the authorization code exchange completes when the browser returns
// from the Cognito Hosted UI to /auth/callback.
import 'aws-amplify/auth/enable-oauth-listener';
import { Amplify } from 'aws-amplify';
import { signInWithRedirect, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import type { Profile, ProfileInsert } from '../types/shared';
import { config } from '../config';
import { httpJsonAuth } from 'src/utils/httpClient';

// Configure Amplify with Cognito
const configureAmplify = () => {
  const { userPoolId, userPoolClientId, region, oauth } = config.cognito;
  if (!userPoolId || !userPoolClientId || !region || !oauth.domain) {
    console.warn('⚠️ Missing Cognito configuration. Authentication will be disabled.');
    return false;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          oauth: {
            domain: oauth.domain,
            scopes: ['email', 'openid', 'profile'],
            redirectSignIn: oauth.redirectSignIn,
            redirectSignOut: oauth.redirectSignOut,
            responseType: oauth.responseType,
            providers: [...oauth.providers],
          },
        },
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

// Per-user memo to avoid redundant profile-creation POSTs.
// Reset to null on sign-out so a different user can trigger a fresh check.
let profileEnsuredForUserId: string | null = null;

// Listen to auth events
if (cognitoEnabled) {
  Hub.listen('auth', (data) => {
    const { event } = data.payload;
    if (event === 'signedIn') {
      console.log('✅ User signed in to Cognito');
    } else if (event === 'signedOut') {
      profileEnsuredForUserId = null;
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

interface HydratedAuthUser {
  id: string;
  email: string | null;
  username: string | null;
}

class AuthService {
  /**
   * Start Cognito Hosted UI sign-in with Google.
   */
  signInWithGoogle(): ReturnType<typeof signInWithRedirect> {
    if (!cognitoEnabled) {
      return Promise.reject(
        new Error('Authentication is currently disabled. Please check Cognito configuration.'),
      );
    }

    return signInWithRedirect({ provider: 'Google' });
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
      profileEnsuredForUserId = null;
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
        const user = await this.hydrateCurrentUser();
        // Ensure profile exists with correct email/username before any GET
        // auto-creates it with null values (e.g., first-time OAuth callback).
        await this.ensureProfileForCurrentUser(user.id, user.email, user.username);
        return {
          user: { id: user.id, email: user.email },
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
      const user = await this.hydrateCurrentUser();
      return { id: user.id, email: user.email };
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Check whether the current browser has a valid Cognito session.
   * Read-only — does not trigger profile creation or user attribute fetches.
   */
  async isAuthenticated(): Promise<boolean> {
    if (!cognitoEnabled) {
      return false;
    }

    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Create user profile via API.
   * Returns true when the request succeeded (or profile already existed),
   * false when the creation attempt failed and should be retried later.
   */
  private async createUserProfile(
    userId: string,
    profileData: Partial<ProfileInsert>,
  ): Promise<boolean> {
    try {
      await httpJsonAuth<{ success: boolean }>(`${config.api.url}profiles/create`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          email: profileData.email,
          username: profileData.username,
        }),
      });
      return true;
    } catch (error) {
      // Profile already exists — backend returns a conflict/duplicate error.
      // This is not a failure; the profile is present, so we can mark it as ensured.
      const msg = error instanceof Error ? error.message : String(error);
      if (/already exist|conflict|duplicate|409/i.test(msg)) {
        return true;
      }
      console.error('Error creating user profile:', error);
      return false;
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
          const user = await this.hydrateCurrentUser();
          const session = await fetchAuthSession();

          if (session.tokens?.accessToken) {
            // Ensure profile exists when user signs in
            await this.ensureProfileForCurrentUser(user.id, user.email, user.username);

            callback('SIGNED_IN', {
              user: { id: user.id, email: user.email },
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
   * Hydrate the current user by reading claims directly from the ID token.
   *
   * Uses the decoded JWT payload instead of `fetchUserAttributes()` because
   * that method calls the Cognito `GetUser` API, which requires the
   * `aws.cognito.signin.user.admin` scope — a scope the app deliberately
   * omits. The ID token already contains email/name claims from the Google
   * OIDC flow, so we avoid an extra network call and the missing-scope error.
   */
  private async hydrateCurrentUser(): Promise<HydratedAuthUser> {
    const [user, session] = await Promise.all([getCurrentUser(), fetchAuthSession()]);

    let email = user.signInDetails?.loginId || null;
    let username: string | null = null;

    const idToken = session.tokens?.idToken;
    if (idToken) {
      const claims = idToken.payload;
      email = email || (claims.email as string | undefined) || null;
      username =
        (claims.preferred_username as string | undefined) ||
        (claims.name as string | undefined) ||
        null;
    }

    return {
      id: user.userId,
      email,
      username,
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
    if (profileEnsuredForUserId === userId) {
      return;
    }

    // Attempt to create the profile with username first.
    // The backend handles duplicates gracefully.
    const created = await this.createUserProfile(userId, {
      email: email || null,
      username: username || null,
    });

    if (created) {
      profileEnsuredForUserId = userId;
    }
    // If creation failed, leave the guard unset so the next
    // ensureProfileForCurrentUser call retries automatically.
  }
}

// Export singleton instance
export const authService = new AuthService();

/** @internal Reset the per-user profile-ensured guard. For test isolation only. */
export const _resetProfileGuard = () => {
  profileEnsuredForUserId = null;
};
