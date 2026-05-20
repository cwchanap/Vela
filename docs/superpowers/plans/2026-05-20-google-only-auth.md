# Google-Only Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vela's password signup/login path with Google-only Cognito Hosted UI authentication while preserving Cognito-issued tokens for the API and browser extension.

**Architecture:** Keep Cognito as the identity boundary. The app starts Google OAuth through Amplify `signInWithRedirect`, Cognito issues the same ID-token shape the Hono API already verifies, and the extension continues importing Amplify-managed Cognito tokens from the web app.

**Tech Stack:** Quasar/Vue 3, Pinia, AWS Amplify Auth v6, AWS Cognito, AWS CDK v2, Hono, Bun tests, Vitest.

---

## Scope Check

The approved spec touches frontend auth, Cognito infrastructure, and password-auth cleanup, but all changes serve one auth subsystem and can be implemented as one plan. No account migration is included because there are no active users.

## File Structure

- Modify `apps/vela/src/config/index.ts`: add frontend-safe OAuth config and production validation.
- Modify `apps/vela/src/config/index.test.ts`: cover OAuth config shape and required production variables.
- Modify `apps/vela/src/env.d.ts`: type the new `VITE_COGNITO_*` env keys.
- Modify `apps/vela/quasar.config.ts`: pass OAuth env vars into Quasar/Vite.
- Modify `apps/vela/src/services/authService.ts`: configure Amplify Hosted UI OAuth and add Google redirect sign-in.
- Modify `apps/vela/src/services/authService.test.ts`: replace password-auth tests with Google redirect/session/profile tests.
- Modify `apps/vela/src/stores/auth.ts`: expose `signInWithGoogle` and remove app-facing password/signup actions.
- Modify `apps/vela/src/stores/auth.test.ts`: cover Google redirect loading/error behavior and remove password/signup expectations.
- Modify `apps/vela/src/components/auth/AuthForm.vue`: replace the credential form with a Google-only button.
- Modify `apps/vela/src/components/auth/AuthForm.test.ts`: assert no password/signup controls and assert Google sign-in dispatch.
- Modify `apps/vela/src/pages/auth/LoginPage.vue`: treat login/signup/callback as one Google-only auth entry surface.
- Modify `apps/vela/src/pages/auth/LoginPage.test.ts`: assert `/auth/signup` no longer switches UI mode.
- Modify `packages/cdk/lib/auth-stack.ts`: add Google IdP, hosted domain, OAuth-only app client, and exported OAuth domain.
- Modify `packages/cdk/lib/static-web-stack.ts`: output the Cognito OAuth domain for frontend env injection.
- Modify `packages/cdk/scripts/inject-env.ts`: write `VITE_COGNITO_OAUTH_DOMAIN` and redirect URLs into `.env.production`.
- Modify `packages/cdk/package.json`: add a CDK unit test script.
- Create `packages/cdk/test/auth-stack.test.ts`: assert the synthesized Cognito resources are Google-only.
- Modify `apps/vela-api/src/routes/auth.ts`: remove password sign-in and auto-confirm routes, keeping refresh/session/signout.
- Modify `apps/vela-api/test/routes/auth.test.ts`: assert removed password routes return `404` and keep refresh/session/signout coverage.
- Modify `apps/vela-ext/tests/utils/webappSession.test.ts`: add an OAuth-style Cognito storage key case so extension token import remains guarded.
- Modify `/.env.example`: document OAuth domain and redirect env vars.
- Optional deploy-time env vars: `COGNITO_DOMAIN_PREFIX`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET_NAME`.

---

### Task 1: Frontend OAuth Configuration

**Files:**

- Modify: `apps/vela/src/config/index.test.ts`
- Modify: `apps/vela/src/config/index.ts`
- Modify: `apps/vela/src/env.d.ts`
- Modify: `apps/vela/quasar.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing config tests**

Add these tests inside `describe('config object', ...)` in `apps/vela/src/config/index.test.ts`:

```ts
it('has Cognito OAuth configuration', async () => {
  const { config } = await import('./index');

  expect(config.cognito.oauth).toBeDefined();
  expect(typeof config.cognito.oauth.domain).toBe('string');
  expect(Array.isArray(config.cognito.oauth.redirectSignIn)).toBe(true);
  expect(Array.isArray(config.cognito.oauth.redirectSignOut)).toBe(true);
  expect(config.cognito.oauth.responseType).toBe('code');
  expect(config.cognito.oauth.providers).toEqual(['Google']);
});
```

Add this test inside `describe('validateConfig', ...)`:

```ts
it('requires OAuth domain in production', async () => {
  const { validateConfig } = await import('./index');
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const env = {
    PROD: true,
    VITE_COGNITO_USER_POOL_ID: 'pool-id',
    VITE_COGNITO_USER_POOL_CLIENT_ID: 'client-id',
    VITE_AWS_REGION: 'us-east-1',
    VITE_COGNITO_OAUTH_DOMAIN: '',
  };

  expect(() => validateConfig(env)).toThrow(
    'Missing required environment variables: VITE_COGNITO_OAUTH_DOMAIN',
  );
  expect(consoleErrorSpy).toHaveBeenCalledWith('Missing required environment variables:', [
    'VITE_COGNITO_OAUTH_DOMAIN',
  ]);
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
bun run test:unit -- src/config/index.test.ts
```

Expected: FAIL because `config.cognito.oauth` does not exist and production validation does not include `VITE_COGNITO_OAUTH_DOMAIN`.

- [ ] **Step 3: Add OAuth config helpers**

In `apps/vela/src/config/index.ts`, replace the current Cognito config block with this structure and add the helper functions above `export const config`:

```ts
type ConfigEnv = Record<string, unknown> | null | undefined;

const getCurrentOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:9000';
};

const parseCsvEnv = (value: unknown, fallback: string[]): string[] => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : fallback;
};

const defaultRedirectSignIn = [`${getCurrentOrigin()}/auth/callback`];
const defaultRedirectSignOut = [`${getCurrentOrigin()}/auth/login`];
```

Then update `config.cognito`:

```ts
cognito: {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '',
  region: import.meta.env.VITE_AWS_REGION || '',
  oauth: {
    domain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN || '',
    redirectSignIn: parseCsvEnv(
      import.meta.env.VITE_COGNITO_REDIRECT_SIGN_IN,
      defaultRedirectSignIn,
    ),
    redirectSignOut: parseCsvEnv(
      import.meta.env.VITE_COGNITO_REDIRECT_SIGN_OUT,
      defaultRedirectSignOut,
    ),
    responseType: 'code' as const,
    providers: ['Google'] as const,
  },
},
```

Keep the existing `ai`, `app`, `api`, and `dev` config blocks unchanged.

- [ ] **Step 4: Update production config validation**

In `apps/vela/src/config/index.ts`, keep the existing `validateConfig` function but update the required variables list:

```ts
const requiredVars = [
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_USER_POOL_CLIENT_ID',
  'VITE_AWS_REGION',
  'VITE_COGNITO_OAUTH_DOMAIN',
];
```

If the existing file still declares `type ConfigEnv` below the config object, remove the duplicate type because Step 3 moved it above the config object.

- [ ] **Step 5: Type and expose the new env vars**

Add these fields to `apps/vela/src/env.d.ts`:

```ts
readonly VITE_COGNITO_OAUTH_DOMAIN: string;
readonly VITE_COGNITO_REDIRECT_SIGN_IN?: string;
readonly VITE_COGNITO_REDIRECT_SIGN_OUT?: string;
```

Add these keys to the `env` object in `apps/vela/quasar.config.ts`:

```ts
VITE_COGNITO_OAUTH_DOMAIN: process.env.VITE_COGNITO_OAUTH_DOMAIN,
VITE_COGNITO_REDIRECT_SIGN_IN: process.env.VITE_COGNITO_REDIRECT_SIGN_IN,
VITE_COGNITO_REDIRECT_SIGN_OUT: process.env.VITE_COGNITO_REDIRECT_SIGN_OUT,
```

Add these frontend-safe entries under the Cognito section in `/.env.example`:

```dotenv
VITE_COGNITO_OAUTH_DOMAIN=vela-local-auth.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_SIGN_IN=http://localhost:9000/auth/callback
VITE_COGNITO_REDIRECT_SIGN_OUT=http://localhost:9000/auth/login
```

- [ ] **Step 6: Run config tests to verify they pass**

Run:

```bash
bun run test:unit -- src/config/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit frontend config**

Run:

```bash
git add apps/vela/src/config/index.ts apps/vela/src/config/index.test.ts apps/vela/src/env.d.ts apps/vela/quasar.config.ts .env.example
git commit -m "feat(auth): add cognito oauth frontend config"
```

---

### Task 2: Amplify Google Redirect Auth Service

**Files:**

- Modify: `apps/vela/src/services/authService.test.ts`
- Modify: `apps/vela/src/services/authService.ts`

- [ ] **Step 1: Update auth service mocks and tests**

In `apps/vela/src/services/authService.test.ts`, update the `aws-amplify/auth` mock to remove `signUp`, `signIn`, `confirmSignUp`, `resendSignUpCode`, and `resetPassword`, and add `signInWithRedirect`:

```ts
vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
}));
```

Update the imported auth functions:

```ts
import {
  signInWithRedirect,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
} from 'aws-amplify/auth';
```

Update the config mock:

```ts
config: {
  cognito: {
    userPoolId: 'test-pool-id',
    userPoolClientId: 'test-client-id',
    region: 'us-east-1',
    oauth: {
      domain: 'test-domain.auth.us-east-1.amazoncognito.com',
      redirectSignIn: ['http://localhost:9000/auth/callback'],
      redirectSignOut: ['http://localhost:9000/auth/login'],
      responseType: 'code',
      providers: ['Google'],
    },
  },
  api: {
    url: '/api/',
  },
  app: {
    isDev: false,
  },
},
```

Replace the `describe('signIn', ...)` and `describe('signUp', ...)` blocks with:

```ts
describe('signInWithGoogle', () => {
  it('starts Google Hosted UI redirect', async () => {
    vi.mocked(signInWithRedirect).mockResolvedValue(undefined);

    const result = await authService.signInWithGoogle();

    expect(result.success).toBe(true);
    expect(signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
  });

  it('returns error when redirect initiation fails', async () => {
    vi.mocked(signInWithRedirect).mockRejectedValue(new Error('OAuth configuration missing'));

    const result = await authService.signInWithGoogle();

    expect(result.success).toBe(false);
    expect(result.error).toBe('OAuth configuration missing');
  });
});
```

Remove the `describe('confirmSignUp', ...)`, `describe('resendSignUpCode', ...)`, `describe('resetPassword', ...)`, and `describe('updatePassword', ...)` blocks.

Add this test in `describe('getCurrentSession', ...)`:

```ts
it('uses user attributes as email fallback for OAuth users', async () => {
  const mockUser = {
    userId: 'user-456',
    signInDetails: {},
  } as any;
  const mockSession = { tokens: { accessToken: 'valid-token' as any } } as any;

  vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
  vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
  vi.mocked(fetchUserAttributes).mockResolvedValue({ email: 'google@example.com' } as any);

  const result = await authService.getCurrentSession();

  expect(result?.user?.id).toBe('user-456');
  expect(result?.user?.email).toBe('google@example.com');
});
```

Add this test in `describe('onAuthStateChange', ...)`:

```ts
it('handles signInWithRedirect Hub event as a signed-in session', async () => {
  const mockUser = {
    userId: 'google-user-123',
    signInDetails: {},
  } as any;
  const mockSession = { tokens: { accessToken: 'token' as any } } as any;

  vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
  vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
  vi.mocked(fetchUserAttributes).mockResolvedValue({
    email: 'google@example.com',
    name: 'Google User',
  } as any);

  const callback = vi.fn();
  let capturedListener: ((_data: any) => void) | null = null;

  vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
    capturedListener = listener;
    return vi.fn() as any;
  });

  mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ success: true }) });

  authService.onAuthStateChange(callback);
  capturedListener!({ payload: { event: 'signInWithRedirect' } });

  await vi.waitFor(() => expect(callback).toHaveBeenCalled());

  expect(mockFetch).toHaveBeenCalledWith('/api/profiles/create', expect.any(Object));
  expect(callback).toHaveBeenCalledWith(
    'SIGNED_IN',
    expect.objectContaining({
      user: { id: 'google-user-123', email: 'google@example.com' },
      provider: 'cognito',
    }),
  );
});
```

In the disabled-auth block, replace password method tests with:

```ts
it('signInWithGoogle returns disabled error', async () => {
  const result = await disabledAuthService.signInWithGoogle();
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/disabled/i);
});
```

- [ ] **Step 2: Run auth service tests to verify they fail**

Run:

```bash
bun run test:unit -- src/services/authService.test.ts
```

Expected: FAIL because `signInWithGoogle` and OAuth config handling are not implemented.

- [ ] **Step 3: Update AuthService imports and Amplify configuration**

In `apps/vela/src/services/authService.ts`, replace the auth imports with:

```ts
import 'aws-amplify/auth/enable-oauth-listener';
import { Amplify } from 'aws-amplify';
import {
  signInWithRedirect,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
} from 'aws-amplify/auth';
```

Remove imports for `signUp`, `signIn`, `confirmSignUp`, `resendSignUpCode`, and `resetPassword`.

Update `configureAmplify()`:

```ts
const configureAmplify = () => {
  const { userPoolId, userPoolClientId, region, oauth } = config.cognito;
  const missingConfig = [
    !userPoolId ? 'userPoolId' : null,
    !userPoolClientId ? 'userPoolClientId' : null,
    !region ? 'region' : null,
    !oauth.domain ? 'oauth.domain' : null,
  ].filter(Boolean);

  if (missingConfig.length > 0) {
    console.warn(
      `Missing Cognito configuration (${missingConfig.join(', ')}). Authentication will be disabled.`,
    );
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
            scopes: ['openid', 'email', 'profile'],
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
    console.debug('Amplify configured with Cognito Hosted UI', {
      userPoolId,
      userPoolClientId,
      oauthDomain: oauth.domain,
    });
  } else {
    console.log('Amplify configured with Cognito Hosted UI');
  }
  return true;
};
```

- [ ] **Step 4: Replace password methods with Google redirect**

Remove `SignUpData` and `SignInData` exports. Keep `ProfileData`, `AppUser`, and `AppSession`.

Add this method to `AuthService`:

```ts
async signInWithGoogle(): Promise<AuthResponse> {
  if (!cognitoEnabled) {
    return {
      success: false,
      error: 'Authentication is currently disabled. Please check Cognito OAuth configuration.',
    };
  }

  try {
    await signInWithRedirect({ provider: 'Google' });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start Google sign-in',
    };
  }
}
```

Remove these methods from `AuthService`:

```ts
signUp;
signIn;
autoConfirmUser;
confirmSignUp;
resendSignUpCode;
resetPassword;
updatePassword;
```

- [ ] **Step 5: Add an OAuth-safe current-user helper**

Add this private helper inside `AuthService`:

```ts
private async getCurrentAuthIdentity(): Promise<{
  userId: string;
  email: string | null;
  username: string | null;
}> {
  const currentUser = await getCurrentUser();

  let attributes: Awaited<ReturnType<typeof fetchUserAttributes>> = {};
  try {
    attributes = await fetchUserAttributes();
  } catch {
    attributes = {};
  }

  const email =
    typeof attributes.email === 'string'
      ? attributes.email
      : currentUser.signInDetails?.loginId || null;
  const username =
    typeof attributes.preferred_username === 'string'
      ? attributes.preferred_username
      : typeof attributes.name === 'string'
        ? attributes.name
        : null;

  return {
    userId: currentUser.userId,
    email,
    username,
  };
}
```

Update `getCurrentSession()`:

```ts
async getCurrentSession(): Promise<AppSession | null> {
  if (!cognitoEnabled) {
    return null;
  }

  try {
    const session = await fetchAuthSession();
    if (session.tokens?.accessToken) {
      const identity = await this.getCurrentAuthIdentity();
      return {
        user: { id: identity.userId, email: identity.email },
        provider: 'cognito',
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}
```

Update `getCurrentUser()`:

```ts
async getCurrentUser(): Promise<{ id: string; email?: string | null } | null> {
  if (!cognitoEnabled) {
    return null;
  }

  try {
    const identity = await this.getCurrentAuthIdentity();
    return { id: identity.userId, email: identity.email };
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}
```

Update `onAuthStateChange()` so both `signedIn` and `signInWithRedirect` hydrate the session:

```ts
if (event === 'signedIn' || event === 'signInWithRedirect') {
  try {
    const session = await fetchAuthSession();

    if (session.tokens?.accessToken) {
      const identity = await this.getCurrentAuthIdentity();

      await this.ensureProfileForCurrentUser(identity.userId, identity.email, identity.username);

      callback('SIGNED_IN', {
        user: { id: identity.userId, email: identity.email },
        provider: 'cognito',
      });
    }
  } catch (error) {
    console.error('Error handling sign in:', error);
  }
} else if (event === 'signedOut') {
  callback('SIGNED_OUT', null);
} else if (event === 'signInWithRedirect_failure') {
  console.error('Google sign-in redirect failed:', data.payload.data?.error);
}
```

Keep `createUserProfile`, `getUserProfile`, `updateUserProfile`, and `ensureProfileForCurrentUser`.

- [ ] **Step 6: Run auth service tests to verify they pass**

Run:

```bash
bun run test:unit -- src/services/authService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit auth service**

Run:

```bash
git add apps/vela/src/services/authService.ts apps/vela/src/services/authService.test.ts
git commit -m "feat(auth): use google hosted ui redirect"
```

---

### Task 3: Google-Only Store And Login UI

**Files:**

- Modify: `apps/vela/src/stores/auth.test.ts`
- Modify: `apps/vela/src/stores/auth.ts`
- Modify: `apps/vela/src/components/auth/AuthForm.test.ts`
- Modify: `apps/vela/src/components/auth/AuthForm.vue`
- Modify: `apps/vela/src/pages/auth/LoginPage.test.ts`
- Modify: `apps/vela/src/pages/auth/LoginPage.vue`

- [ ] **Step 1: Update auth store tests**

In `apps/vela/src/stores/auth.test.ts`, replace the mock service shape's password methods:

```ts
const mockAuthService = {
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getUserProfile: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
};
```

Replace `describe('signIn', ...)`, `describe('signUp', ...)`, `describe('resetPassword', ...)`, `describe('confirmSignUp', ...)`, `describe('resendSignUpCode', ...)`, and `describe('updatePassword', ...)` with:

```ts
describe('signInWithGoogle', () => {
  it('returns true and clears errors when redirect starts', async () => {
    mockAuthService.signInWithGoogle.mockResolvedValueOnce({ success: true });
    const { useAuthStore } = await import('./auth');
    const store = useAuthStore();

    const result = await store.signInWithGoogle();

    expect(result).toBe(true);
    expect(store.error).toBeNull();
    expect(store.isLoading).toBe(false);
  });

  it('returns false and sets service error when redirect fails', async () => {
    mockAuthService.signInWithGoogle.mockResolvedValueOnce({
      success: false,
      error: 'OAuth configuration missing',
    });
    const { useAuthStore } = await import('./auth');
    const store = useAuthStore();

    const result = await store.signInWithGoogle();

    expect(result).toBe(false);
    expect(store.error).toBe('OAuth configuration missing');
    expect(store.isLoading).toBe(false);
  });

  it('returns false and sets generic error on exception', async () => {
    mockAuthService.signInWithGoogle.mockRejectedValueOnce(new Error('network'));
    const { useAuthStore } = await import('./auth');
    const store = useAuthStore();

    const result = await store.signInWithGoogle();

    expect(result).toBe(false);
    expect(store.error).toContain('unexpected error');
    expect(store.isLoading).toBe(false);
  });
});
```

Remove assertions that `pendingVerificationEmail` exists.

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```bash
bun run test:unit -- src/stores/auth.test.ts
```

Expected: FAIL because the store still exposes password/signup actions and not `signInWithGoogle`.

- [ ] **Step 3: Update the auth store**

In `apps/vela/src/stores/auth.ts`, change the service import:

```ts
import { authService, type ProfileData } from '../services/authService';
```

Remove:

```ts
pendingVerificationEmail;
signUp;
signIn;
confirmSignUp;
resendSignUpCode;
resetPassword;
updatePassword;
```

Add:

```ts
const signInWithGoogle = async () => {
  setLoading(true);
  setError(null);

  try {
    const response = await authService.signInWithGoogle();

    if (!response.success) {
      setError(response.error || 'Google sign-in failed');
      return false;
    }

    return true;
  } catch (err) {
    console.error('Google sign-in error:', err);
    setError('An unexpected error occurred during Google sign-in');
    return false;
  } finally {
    setLoading(false);
  }
};
```

Expose `signInWithGoogle` from the returned object. Keep `initialize`, `loadUserProfile`, `signOut`, and profile/progress update actions.

- [ ] **Step 4: Run store tests to verify they pass**

Run:

```bash
bun run test:unit -- src/stores/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update AuthForm tests**

In `apps/vela/src/components/auth/AuthForm.test.ts`, replace form-field and password/signup tests with Google-only tests:

```ts
describe('Google-only rendering', () => {
  it('renders a Google sign-in title and subtitle', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Welcome to Vela');
    expect(wrapper.text()).toContain('Continue with Google to start learning Japanese');
  });

  it('shows only the Google sign-in button as the auth action', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Continue with Google');
    expect(wrapper.text()).not.toContain('Password');
    expect(wrapper.text()).not.toContain('Create Account');
    expect(wrapper.text()).not.toContain('Forgot Password?');
    expect(wrapper.text()).not.toContain('Username');
  });

  it('does not render credential inputs', () => {
    const wrapper = mountComponent();

    const inputs = wrapper.findAllComponents({ name: 'QInput' });
    expect(inputs).toHaveLength(0);
  });
});
```

Replace the submit behavior block with:

```ts
describe('Google Sign-In Behavior', () => {
  it('calls signInWithGoogle when the Google button is clicked', async () => {
    const wrapper = mountComponent();
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'signInWithGoogle').mockResolvedValue(true);

    const googleButton = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((btn) => btn.text().includes('Continue with Google'));

    await googleButton?.trigger('click');

    expect(authStore.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('emits error when Google sign-in fails with store error', async () => {
    const wrapper = mountComponent();
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'signInWithGoogle').mockImplementation(async () => {
      authStore.setError('Google sign-in failed');
      return false;
    });

    const googleButton = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((btn) => btn.text().includes('Continue with Google'));

    await googleButton?.trigger('click');

    expect(wrapper.emitted('error')?.[0]).toEqual(['Google sign-in failed']);
  });
});
```

Keep error banner and loading-state tests, but update them to assert the single Google button's `loading` and `disable` props.

- [ ] **Step 6: Run AuthForm tests to verify they fail**

Run:

```bash
bun run test:unit -- src/components/auth/AuthForm.test.ts
```

Expected: FAIL because the component still renders credential inputs and calls password methods.

- [ ] **Step 7: Replace AuthForm with Google-only UI**

Replace the template in `apps/vela/src/components/auth/AuthForm.vue` with:

```vue
<template>
  <div class="auth-form">
    <div class="auth-header text-center q-mb-lg">
      <div class="text-h5 q-mb-sm auth-title">Welcome to Vela</div>
      <div class="text-subtitle2 auth-subtitle">
        Continue with Google to start learning Japanese
      </div>
    </div>

    <div class="google-auth-actions">
      <q-banner v-if="authStore.error" class="text-white bg-negative" rounded>
        <template v-slot:avatar>
          <q-icon name="error" />
        </template>
        {{ authStore.error }}
      </q-banner>

      <q-btn
        color="primary"
        size="lg"
        class="full-width google-auth-button"
        :loading="authStore.isLoading"
        :disable="authStore.isLoading"
        @click="handleGoogleSignIn"
      >
        <q-icon name="login" class="q-mr-sm" />
        <span>Continue with Google</span>
      </q-btn>
    </div>
  </div>
</template>
```

Replace the script with:

```ts
<script setup lang="ts">
import { useAuthStore } from '../../stores/auth';

interface Props {
  mode?: 'signin' | 'signup';
  redirectTo?: string;
}

withDefaults(defineProps<Props>(), {
  mode: 'signin',
  redirectTo: '/',
});

const emit = defineEmits<{
  success: [type: 'signin'];
  error: [message: string];
}>();

const authStore = useAuthStore();

const handleGoogleSignIn = async () => {
  const success = await authStore.signInWithGoogle();

  if (!success && authStore.error) {
    emit('error', authStore.error);
  }
};
</script>
```

In the style block, remove input/toggle specific rules and keep:

```scss
.auth-form {
  width: 100%;
}

.auth-header {
  margin-bottom: 1.5rem;
}

.auth-title {
  color: #1a1a1a;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.auth-subtitle {
  color: #5a5a5a;
  font-weight: 400;
}

.google-auth-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

:deep(.q-btn.google-auth-button) {
  height: 56px !important;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

:deep(.q-banner) {
  border-radius: 8px;
}

@media (max-width: 480px) {
  .auth-form {
    padding: 0;
  }

  .auth-header {
    margin-bottom: 1rem;
  }

  :deep(.q-btn.google-auth-button) {
    height: 52px !important;
  }
}
```

- [ ] **Step 8: Update LoginPage tests and component**

In `apps/vela/src/pages/auth/LoginPage.test.ts`, replace the signup-mode test with:

```ts
it('keeps signin mode when route includes signup for legacy compatibility', async () => {
  await router.push('/auth/signup');
  wrapper = mountComponent();
  await flushPromises();
  expect(wrapper.vm.authMode).toBe('signin');
});
```

Update `handleAuthSuccess` tests so only `signin` redirect is expected. Remove the signup-success test.

In `apps/vela/src/pages/auth/LoginPage.vue`, update `handleAuthSuccess`:

```ts
const handleAuthSuccess = async (_type: 'signin') => {
  $q.notify({
    type: 'positive',
    message: 'Welcome back!',
    timeout: 3000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await router.push(redirectTo.value);
};
```

Remove the route-path signup mode branch from `onMounted()`:

```ts
// Delete this block:
if (route.path.includes('signup')) {
  authMode.value = 'signup';
}
```

Keep passing `:mode="authMode"` into `AuthForm` so the route component API stays stable.

- [ ] **Step 9: Run UI and store tests**

Run:

```bash
bun run test:unit -- src/stores/auth.test.ts src/components/auth/AuthForm.test.ts src/pages/auth/LoginPage.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit store and UI**

Run:

```bash
git add apps/vela/src/stores/auth.ts apps/vela/src/stores/auth.test.ts apps/vela/src/components/auth/AuthForm.vue apps/vela/src/components/auth/AuthForm.test.ts apps/vela/src/pages/auth/LoginPage.vue apps/vela/src/pages/auth/LoginPage.test.ts
git commit -m "feat(auth): replace credential form with google sign-in"
```

---

### Task 4: Cognito Google Hosted UI Infrastructure

**Files:**

- Create: `packages/cdk/test/auth-stack.test.ts`
- Modify: `packages/cdk/package.json`
- Modify: `packages/cdk/lib/auth-stack.ts`
- Modify: `packages/cdk/lib/static-web-stack.ts`
- Modify: `packages/cdk/scripts/inject-env.ts`

- [ ] **Step 1: Add CDK auth stack tests**

Create `packages/cdk/test/auth-stack.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    COGNITO_DOMAIN_PREFIX: 'vela-test-auth',
    GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
  };
});

function synthAuthTemplate(): Template {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'AuthStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });

  return Template.fromStack(stack);
}

describe('AuthStack Google OAuth', () => {
  test('configures Google as the user pool identity provider', () => {
    const template = synthAuthTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'Google',
      ProviderType: 'Google',
      AttributeMapping: Match.objectLike({
        email: 'email',
        email_verified: 'email_verified',
        name: 'name',
        picture: 'picture',
      }),
      ProviderDetails: Match.objectLike({
        client_id: 'test-google-client-id.apps.googleusercontent.com',
        authorize_scopes: 'profile email openid',
      }),
    });
  });

  test('configures the app client as Google-only OAuth code flow', () => {
    const template = synthAuthTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      SupportedIdentityProviders: ['Google'],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayWith(['openid', 'email', 'profile']),
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      CallbackURLs: Match.arrayWith([
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
        'https://vela.cwchanap.dev/auth/callback',
      ]),
      LogoutURLs: Match.arrayWith([
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
        'https://vela.cwchanap.dev/auth/login',
      ]),
    });
  });

  test('creates a Cognito hosted domain', () => {
    const template = synthAuthTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'vela-test-auth',
    });
  });
});
```

Add this script to `packages/cdk/package.json`:

```json
"test:unit": "bun test test/**/*.test.ts",
```

- [ ] **Step 2: Run CDK tests to verify they fail**

Run:

```bash
bun run test:unit
```

from `packages/cdk`.

Expected: FAIL because the auth stack has no Google identity provider, hosted domain, or OAuth-only client.

- [ ] **Step 3: Implement Google Cognito resources**

In `packages/cdk/lib/auth-stack.ts`, update imports:

```ts
import { Stack, StackProps, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import {
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  AccountRecovery,
  OAuthScope,
  ProviderAttribute,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderGoogle,
} from 'aws-cdk-lib/aws-cognito';
```

Add public fields:

```ts
public readonly userPool: UserPool;
public readonly userPoolClient: UserPoolClient;
public readonly userPoolDomain: UserPoolDomain;
public readonly oauthDomain: string;
```

Add constants near the top of the constructor:

```ts
const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || 'vela-local-auth';
const googleClientId =
  process.env.GOOGLE_OAUTH_CLIENT_ID || 'local-synth-only.apps.googleusercontent.com';
const googleClientSecretValue = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  ? SecretValue.unsafePlainText(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  : SecretValue.secretsManager(
      process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME || 'vela/google-oauth-client-secret',
    );
```

In the `UserPool` props, set:

```ts
selfSignUpEnabled: false,
```

Add the hosted domain and Google provider before creating the client:

```ts
const userPoolDomain = userPool.addDomain('VelaUserPoolDomain', {
  cognitoDomain: {
    domainPrefix,
  },
});

const googleProvider = new UserPoolIdentityProviderGoogle(this, 'VelaGoogleProvider', {
  userPool,
  clientId: googleClientId,
  clientSecretValue: googleClientSecretValue,
  scopes: ['profile', 'email', 'openid'],
  attributeMapping: {
    email: ProviderAttribute.GOOGLE_EMAIL,
    emailVerified: ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
    fullname: ProviderAttribute.GOOGLE_NAME,
    profilePicture: ProviderAttribute.GOOGLE_PICTURE,
  },
});
```

Replace `new UserPoolClient(...)` props with:

```ts
const userPoolClient = new UserPoolClient(this, 'VelaUserPoolClient', {
  userPool,
  userPoolClientName: 'vela-web-client',
  authFlows: {
    adminUserPassword: false,
    custom: false,
    userPassword: false,
    userSrp: false,
  },
  preventUserExistenceErrors: true,
  supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
  oAuth: {
    flows: {
      authorizationCodeGrant: true,
      implicitCodeGrant: false,
    },
    scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
    callbackUrls: [
      'http://localhost:9000/auth/callback',
      'http://127.0.0.1:9000/auth/callback',
      'https://vela.cwchanap.dev/auth/callback',
    ],
    logoutUrls: [
      'http://localhost:9000/auth/login',
      'http://127.0.0.1:9000/auth/login',
      'https://vela.cwchanap.dev/auth/login',
    ],
  },
});

userPoolClient.node.addDependency(googleProvider);
```

Set class fields:

```ts
this.userPool = userPool;
this.userPoolClient = userPoolClient;
this.userPoolDomain = userPoolDomain;
this.oauthDomain = `${domainPrefix}.auth.${Stack.of(this).region}.amazoncognito.com`;
```

- [ ] **Step 4: Output and inject OAuth domain**

In `packages/cdk/lib/static-web-stack.ts`, add an output next to the existing Cognito outputs:

```ts
new CfnOutput(this, 'CognitoOAuthDomain', {
  value: auth.oauthDomain,
  description: 'Cognito Hosted UI OAuth domain',
});
```

In `packages/cdk/scripts/inject-env.ts`, add these env vars:

```ts
VITE_COGNITO_OAUTH_DOMAIN: outputs.CognitoOAuthDomain,
VITE_COGNITO_REDIRECT_SIGN_IN:
  process.env.VITE_COGNITO_REDIRECT_SIGN_IN || 'https://vela.cwchanap.dev/auth/callback',
VITE_COGNITO_REDIRECT_SIGN_OUT:
  process.env.VITE_COGNITO_REDIRECT_SIGN_OUT || 'https://vela.cwchanap.dev/auth/login',
```

Add a validation guard:

```ts
if (!envVars.VITE_COGNITO_OAUTH_DOMAIN) {
  throw new Error('Missing CognitoOAuthDomain in CloudFormation outputs');
}
```

- [ ] **Step 5: Run CDK tests and synth**

From `packages/cdk`, run:

```bash
bun run test:unit
bun cdk:synth
```

Expected: both pass. If `bun cdk:synth` tries to deploy or access AWS, stop and use `bunx aws-cdk synth` from the same directory; expected output includes synthesized CloudFormation and no deployment.

- [ ] **Step 6: Commit infrastructure**

Run:

```bash
git add packages/cdk/lib/auth-stack.ts packages/cdk/lib/static-web-stack.ts packages/cdk/scripts/inject-env.ts packages/cdk/package.json packages/cdk/test/auth-stack.test.ts
git commit -m "feat(auth): configure google hosted ui"
```

---

### Task 5: Remove Password Auth API Surface And Guard Extension Token Import

**Files:**

- Modify: `apps/vela-api/test/routes/auth.test.ts`
- Modify: `apps/vela-api/src/routes/auth.ts`
- Modify: `apps/vela-ext/tests/utils/webappSession.test.ts`

- [ ] **Step 1: Update API tests for removed password routes**

In `apps/vela-api/test/routes/auth.test.ts`, remove these test blocks:

```ts
describe('POST /signin', ...)
describe('POST /auto-confirm', ...)
```

Add:

```ts
describe('removed password auth routes', () => {
  test('POST /signin is not exposed', async () => {
    const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
    const res = await app.request('/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST /auto-confirm is not exposed', async () => {
    const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
    const res = await app.request('/auto-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run API auth route tests to verify they fail**

Run:

```bash
bun test test/routes/auth.test.ts
```

from `apps/vela-api`.

Expected: FAIL because `/signin` and `/auto-confirm` are still exposed.

- [ ] **Step 3: Remove password routes from the API**

In `apps/vela-api/src/routes/auth.ts`, remove these imports:

```ts
AdminConfirmSignUpCommand,
ListUsersCommand,
```

Remove the entire `app.post('/auto-confirm', ...)` route.

Remove the entire `app.post('/signin', ...)` route.

Keep:

```ts
app.post('/refresh', ...)
app.post('/signout', ...)
app.get('/session', requireAuth, ...)
```

Keep `InitiateAuthCommand` and `InitiateAuthCommandOutput` because `/refresh` still uses Cognito `REFRESH_TOKEN_AUTH` for extension sessions.

- [ ] **Step 4: Add extension OAuth storage-key coverage**

Add this test to `apps/vela-ext/tests/utils/webappSession.test.ts` inside `describe('readCognitoSessionFromStorage', ...)`:

```ts
it('extracts email from the ID token when the Cognito OAuth username is not an email', () => {
  const idToken = jwtWithPayload({ email: 'google-user@example.com' });
  const storage = makeStorage({
    'CognitoIdentityServiceProvider.client-id.LastAuthUser': 'Google_1234567890',
    'CognitoIdentityServiceProvider.client-id.Google_1234567890.accessToken': 'access-token',
    'CognitoIdentityServiceProvider.client-id.Google_1234567890.refreshToken': 'refresh-token',
    'CognitoIdentityServiceProvider.client-id.Google_1234567890.idToken': idToken,
  });

  expect(readCognitoSessionFromStorage(storage)).toEqual({
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken,
    },
    email: 'google-user@example.com',
  });
});
```

- [ ] **Step 5: Run API and extension focused tests**

Run:

```bash
bun test test/routes/auth.test.ts
```

from `apps/vela-api`.

Then run:

```bash
bun run test:unit -- tests/utils/webappSession.test.ts
```

from `apps/vela-ext`.

Expected: both pass.

- [ ] **Step 6: Commit API and extension cleanup**

Run:

```bash
git add apps/vela-api/src/routes/auth.ts apps/vela-api/test/routes/auth.test.ts apps/vela-ext/tests/utils/webappSession.test.ts
git commit -m "refactor(auth): remove password auth endpoints"
```

---

### Task 6: Full Verification And Runtime Smoke

**Files:**

- No planned file edits.

- [ ] **Step 1: Run Vela app unit tests**

Run:

```bash
bun run test:unit
```

from `apps/vela`.

Expected: PASS.

- [ ] **Step 2: Run Vela app build**

Run:

```bash
bun run build
```

from `apps/vela`.

Expected: PASS.

- [ ] **Step 3: Run API unit tests**

Run:

```bash
bun run test:unit
```

from `apps/vela-api`.

Expected: PASS.

- [ ] **Step 4: Run extension unit tests for auth import**

Run:

```bash
bun run test:unit -- tests/utils/webappSession.test.ts
```

from `apps/vela-ext`.

Expected: PASS.

- [ ] **Step 5: Run CDK tests and synth**

Run:

```bash
bun run test:unit
bun cdk:synth
```

from `packages/cdk`.

Expected: PASS.

- [ ] **Step 6: Browser smoke the auth page**

Start the app:

```bash
bun run dev
```

from `apps/vela`.

Open `http://localhost:9000/auth/login` in the browser and verify:

- The page shows `Continue with Google`.
- The page does not show `Email`, `Password`, `Create Account`, `Sign Up`, or `Forgot Password`.
- Opening `http://localhost:9000/progress` while signed out redirects to `/auth/login?redirect=/progress`.

Do not complete a real Google OAuth round trip unless deployed Cognito and Google OAuth credentials are configured for the local callback URL.

- [ ] **Step 7: Confirm no verification-only changes remain**

Run:

```bash
git status -sb
```

Expected: clean worktree except commits intentionally created by prior tasks. If this shows auth-related edits from verification, return to the task that owns those files, add a concrete test for the observed issue, and commit through that task's commit step.

---

## Deployment Notes

- Configure a Google OAuth web client with Cognito's hosted-domain callback URL before deploying.
- Set `COGNITO_DOMAIN_PREFIX` to a globally unique Cognito domain prefix for the AWS account and region.
- Set `GOOGLE_OAUTH_CLIENT_ID` for CDK deployment.
- Prefer `GOOGLE_OAUTH_CLIENT_SECRET_NAME` pointing to Secrets Manager for the Google client secret. `GOOGLE_OAUTH_CLIENT_SECRET` is acceptable for local synth only and should not be committed.
- Production frontend env injection should receive `VITE_COGNITO_OAUTH_DOMAIN` from CloudFormation output `CognitoOAuthDomain`.

## Self-Review Checklist

- Spec goal "Google-only" maps to Tasks 2, 3, 4, and 5.
- Cognito remains the API token issuer through Tasks 2 and 4.
- Extension token import remains guarded in Task 5.
- Password signup/login UI is removed in Task 3.
- Password API routes are removed in Task 5 while refresh/session/signout remain.
- Tests and build verification are covered in Task 6.
