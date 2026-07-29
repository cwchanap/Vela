# Secure Mobile Cognito Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist only the Cognito refresh token in the iOS Keychain, restore
and verify the mobile session before protected content mounts, refresh it safely
while the app is active, and make local sign-out survive relaunch.

**Architecture:** Extend the existing HPA-205 mobile auth coordinator as the
single lifecycle owner. Isolate native storage and non-secret installation
metadata behind narrow adapters, keep token parsing/validation pure, model
session work with orthogonal public state, and derive the gate UI through one
total selector. The web app, browser extension, and API authentication contract
remain unchanged.

**Tech Stack:** TypeScript 5.6, Vue 3, Quasar 2, Capacitor 7,
`@aparajita/capacitor-secure-storage` 7.1.6, Vitest 3, Vue Test Utils, Bun.

## Global Constraints

- Work on branch `codex/hpa-206-mobile-session-persistence` in
  `/Users/chanwaichan/workspace/Vela`.
- Treat
  `docs/superpowers/specs/2026-07-29-mobile-cognito-session-persistence-design.md`
  as the accepted behavioral contract.
- Keep `apps/vela-mobile/src/services/mobile-auth.ts` as the sole mobile
  Cognito lifecycle owner.
- Persist exactly one non-empty refresh-token string. Access and ID tokens stay
  in process memory.
- Pin `@aparajita/capacitor-secure-storage` exactly to `7.1.6`.
- Call the typed plugin methods as
  `SecureStorage.get(key, false, false)`,
  `SecureStorage.set(key, token, false, false,
KeychainAccess.afterFirstUnlockThisDeviceOnly)`, and
  `SecureStorage.remove(key, false)`.
- Never call the secure-storage plugin outside native iOS. Its browser
  `localStorage` fallback must remain unreachable.
- Store only the token-free OAuth transaction and the non-secret installation
  marker in Capacitor Preferences.
- Preserve HPA-205 PKCE, `state`, nonce, exact callback-schema, callback-first,
  and home-first navigation behavior.
- Protected content may mount only when `sessionUsable` is true and navigation
  to the authenticated home route has succeeded.
- Keep the existing 15-second auth network timeout, use only the injected
  `now()` clock, refresh 60 seconds before access-token expiry, and allow one
  five-second soft-failure retry when the remaining lifetime exceeds 20
  seconds.
- Coalesce all timer, resume, and manual refresh-grant triggers into one queued
  or in-flight grant.
- Do not add remote revocation, global sign-out, background polling, Android
  Keystore support, or a public access-token API.
- Do not log tokens, authorization URLs, callback codes, verifier values,
  decoded claims, raw responses, request objects, or native/plugin exceptions.
- Maintain at least the package's configured 95% line coverage.
- The current mobile Cognito refresh-token lifetime is 30 days from issuance,
  not a sliding inactivity window; no CDK change is required.

## File Structure

### New files

- `apps/vela-mobile/src/auth/mobile-session-store.ts` — Vela-owned refresh-token
  storage interface, Keychain adapter, error normalization, and unsupported
  adapter.
- `apps/vela-mobile/src/auth/mobile-session-store.test.ts` — exact plugin-call,
  namespacing, platform-gate, and error-normalization tests.
- `apps/vela-mobile/src/auth/mobile-installation-store.ts` — non-secret,
  environment-scoped first-install marker over Capacitor Preferences.
- `apps/vela-mobile/src/auth/mobile-installation-store.test.ts` — marker
  namespacing and exact Preferences-call tests.
- `apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.ts` — total
  state-to-view selector with an `invalid_state` fallback.
- `apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.test.ts` —
  selector matrix and invalid-tuple tests.
- `apps/vela-mobile/src/pages/MorePage.test.ts` — mobile Sign out action tests.

### Existing files to modify

- `apps/vela-mobile/src/auth/mobile-auth-contract.ts` — flow-specific token
  bundles, orthogonal auth state, lifecycle listener overload, and coordinator
  methods.
- `apps/vela-mobile/src/auth/mobile-oauth.ts` — authorization-code and refresh
  request builders, response parsers, and nonce-specific validators.
- `apps/vela-mobile/src/auth/mobile-oauth.test.ts` — protocol and claim tests.
- `apps/vela-mobile/src/services/mobile-auth.ts` — atomic state transitions,
  candidate promotion, restore/refresh/retry/sign-out/disposal orchestration.
- `apps/vela-mobile/src/services/mobile-auth.test.ts` — coordinator state,
  ordering, timers, cleanup, and secret-regression coverage.
- `apps/vela-mobile/src/boot/mobile-auth.ts` — runtime adapter selection and
  dependency injection.
- `apps/vela-mobile/src/boot/mobile-auth.test.ts` — native iOS versus
  unsupported-runtime wiring.
- `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue` — exhaustive gate
  rendering, retry/start-over actions, notices, and diagnostics bypass.
- `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts` — component
  visibility, copy, focus, bypass, and action tests.
- `apps/vela-mobile/src/pages/MorePage.vue` — accessible Sign out button and
  progress state.
- `apps/vela-mobile/src/App.test.ts` — expanded auth-state fixture and
  protected-content invariant.
- `apps/vela-mobile/quasar.config.ts` — secure-storage package alias.
- `apps/vela-mobile/vitest.config.ts` — secure-storage test alias.
- `apps/vela-mobile/src-capacitor/package.json` — exact native dependency.
- `apps/vela-mobile/src-capacitor/bun.lock` — resolved package lock.
- `apps/vela-mobile/src-capacitor/ios/App/Podfile.lock` — synchronized native
  pod resolution.

### Files to inspect but not change unless generated sync requires it

- `apps/vela-mobile/src-capacitor/ios/App/PrivacyInfo.xcprivacy` — verify the
  plugin introduces no missing required-reason declaration.
- `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist` — preserve the HPA-205
  callback scheme unchanged.
- `packages/cdk/lib/auth-stack.ts` — confirm the existing mobile client and
  30-day default; do not add a CDK change.
- `apps/vela-api/src/middleware/auth.ts` — confirm it continues accepting web
  and mobile client IDs; do not modify it.

## Execution Preflight

- [ ] Confirm the accepted documents are the only uncommitted files:

```bash
cd /Users/chanwaichan/workspace/Vela
rtk git status --short
```

Expected before this plan is committed:

```text
 M docs/superpowers/specs/2026-07-29-mobile-cognito-session-persistence-design.md
?? docs/superpowers/plans/2026-07-29-mobile-cognito-session-persistence.md
```

- [ ] Commit the accepted design and implementation plan:

```bash
rtk git add \
  docs/superpowers/specs/2026-07-29-mobile-cognito-session-persistence-design.md \
  docs/superpowers/plans/2026-07-29-mobile-cognito-session-persistence.md
rtk git commit -m "docs: approve mobile session persistence design"
```

---

### Task 1: Pin the Native Dependency and Add the Keychain Adapter

**Files:**

- Create:
  `apps/vela-mobile/src/auth/mobile-session-store.ts`
- Create:
  `apps/vela-mobile/src/auth/mobile-session-store.test.ts`
- Modify:
  `apps/vela-mobile/src-capacitor/package.json`
- Modify:
  `apps/vela-mobile/src-capacitor/bun.lock`
- Modify:
  `apps/vela-mobile/src-capacitor/ios/App/Podfile.lock`
- Modify:
  `apps/vela-mobile/quasar.config.ts`
- Modify:
  `apps/vela-mobile/vitest.config.ts`

**Interfaces:**

- Produces:

```ts
export type MobileSessionStore = {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
};

export type MobileSessionStoreErrorCode = 'corrupt' | 'unavailable' | 'unsupported_platform';

export class MobileSessionStoreError extends Error {
  readonly code: MobileSessionStoreErrorCode;
}

export function createMobileSessionKey(config: {
  userPoolId: string;
  mobileClientId: string;
}): string;

export type MobileRuntimeAdapter = {
  isNativePlatform(): boolean;
  getPlatform(): string;
};

export function createIosKeychainSessionStore(options: {
  secureStorage: Pick<SecureStoragePlugin, 'get' | 'set' | 'remove'>;
  runtime: MobileRuntimeAdapter;
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>;
}): MobileSessionStore;

export function createUnsupportedMobileSessionStore(): MobileSessionStore;
```

- Consumed by Tasks 5–8 through `MobileAuthCoordinatorDependencies`.

- [ ] **Step 1: Pin and synchronize the plugin**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile/src-capacitor
rtk bun add --exact @aparajita/capacitor-secure-storage@7.1.6
rtk bunx cap sync ios
```

Expected:

- `package.json` contains
  `"@aparajita/capacitor-secure-storage": "7.1.6"`;
- `bun.lock` resolves version `7.1.6`;
- `Podfile.lock` includes the secure-storage pod;
- the command completes without changing the registered OAuth URL scheme.

- [ ] **Step 2: Add the failing adapter tests**

```ts
import {
  KeychainAccess,
  StorageError,
  StorageErrorType,
} from '@aparajita/capacitor-secure-storage';
import { describe, expect, it, vi } from 'vitest';
import {
  MobileSessionStoreError,
  createIosKeychainSessionStore,
  createMobileSessionKey,
} from './mobile-session-store';

const config = {
  userPoolId: 'ca-central-1_pool',
  mobileClientId: 'mobile-client',
};

it('uses the exact environment key and non-synchronizing typed calls', async () => {
  const secureStorage = {
    get: vi.fn().mockResolvedValue('refresh-token'),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
  };
  const store = createIosKeychainSessionStore({
    secureStorage,
    runtime: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    },
    config,
  });
  const key = 'vela:mobile:cognito:ca-central-1_pool:mobile-client:refresh:v1';

  await expect(store.loadRefreshToken()).resolves.toBe('refresh-token');
  await store.saveRefreshToken('rotated-token');
  await store.clearRefreshToken();

  expect(createMobileSessionKey(config)).toBe(key);
  expect(secureStorage.get).toHaveBeenCalledWith(key, false, false);
  expect(secureStorage.set).toHaveBeenCalledWith(
    key,
    'rotated-token',
    false,
    false,
    KeychainAccess.afterFirstUnlockThisDeviceOnly,
  );
  expect(secureStorage.remove).toHaveBeenCalledWith(key, false);
});

it.each([
  [new StorageError('bad json', StorageErrorType.invalidData), 'corrupt'],
  [new StorageError('native failure', StorageErrorType.osError), 'unavailable'],
  [new Error('bridge failure'), 'unavailable'],
] as const)('normalizes %p without exposing its message', async (failure, code) => {
  const store = createIosKeychainSessionStore({
    secureStorage: {
      get: vi.fn().mockRejectedValue(failure),
      set: vi.fn(),
      remove: vi.fn(),
    },
    runtime: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    },
    config,
  });

  await expect(store.loadRefreshToken()).rejects.toMatchObject({
    name: 'MobileSessionStoreError',
    code,
    message: code,
  } satisfies Partial<MobileSessionStoreError>);
});
```

Add cases for `null`, empty/whitespace/non-string values, save and remove
failures, browser, Android, and unknown platforms. Assert unsupported platforms
make zero plugin calls.

- [ ] **Step 3: Run the focused test to verify it fails**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/auth/mobile-session-store.test.ts
```

Expected: FAIL because `./mobile-session-store` does not exist.

- [ ] **Step 4: Implement the adapter**

```ts
import {
  KeychainAccess,
  StorageError,
  StorageErrorType,
  type SecureStoragePlugin,
} from '@aparajita/capacitor-secure-storage';
import type { MobileOAuthConfig } from './mobile-auth-contract';

export type MobileSessionStore = {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
};

export type MobileSessionStoreErrorCode = 'corrupt' | 'unavailable' | 'unsupported_platform';

export class MobileSessionStoreError extends Error {
  constructor(readonly code: MobileSessionStoreErrorCode) {
    super(code);
    this.name = 'MobileSessionStoreError';
  }
}

export function createMobileSessionKey(
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): string {
  return `vela:mobile:cognito:${config.userPoolId}:${config.mobileClientId}:refresh:v1`;
}

function normalizeFailure(error: unknown): MobileSessionStoreError {
  if (error instanceof MobileSessionStoreError) return error;
  if (error instanceof StorageError && error.code === StorageErrorType.invalidData) {
    return new MobileSessionStoreError('corrupt');
  }
  return new MobileSessionStoreError('unavailable');
}

function assertNativeIos(runtime: { isNativePlatform(): boolean; getPlatform(): string }): void {
  if (!runtime.isNativePlatform() || runtime.getPlatform() !== 'ios') {
    throw new MobileSessionStoreError('unsupported_platform');
  }
}
```

Implement the three methods with `assertNativeIos()` before every plugin call,
the exact typed arguments from the global constraints, and sanitized failure
normalization. `loadRefreshToken()` returns `null` only for a plugin `null`
result; it maps non-string or blank values to `corrupt`.

- [ ] **Step 5: Add module aliases**

Add this alias to both `quasar.config.ts` and `vitest.config.ts`:

```ts
'@aparajita/capacitor-secure-storage': resolve(
  __dirname,
  'src-capacitor/node_modules/@aparajita/capacitor-secure-storage',
),
```

- [ ] **Step 6: Verify the adapter and native metadata**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/auth/mobile-session-store.test.ts
rtk bun run typecheck
rtk git diff -- src-capacitor/ios/App/PrivacyInfo.xcprivacy
```

Expected: focused tests and typecheck PASS; the privacy-manifest diff is empty.

- [ ] **Step 7: Commit**

```bash
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-session-store.ts \
  apps/vela-mobile/src/auth/mobile-session-store.test.ts \
  apps/vela-mobile/src-capacitor/package.json \
  apps/vela-mobile/src-capacitor/bun.lock \
  apps/vela-mobile/src-capacitor/ios/App/Podfile.lock \
  apps/vela-mobile/quasar.config.ts \
  apps/vela-mobile/vitest.config.ts
rtk git commit -m "feat(mobile): add secure session storage adapter"
```

---

### Task 2: Add the Non-Secret Installation Marker

**Files:**

- Create:
  `apps/vela-mobile/src/auth/mobile-installation-store.ts`
- Create:
  `apps/vela-mobile/src/auth/mobile-installation-store.test.ts`

**Interfaces:**

- Produces:

```ts
export type MobileInstallationStore = {
  isCurrentInstallationMarked(): Promise<boolean>;
  markCurrentInstallation(): Promise<void>;
};

export function createMobileInstallationKey(config: {
  userPoolId: string;
  mobileClientId: string;
}): string;

export function createMobileInstallationStore(
  preferences: Pick<OAuthTransactionPreferences, 'get' | 'set'>,
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): MobileInstallationStore;
```

- Consumed by Task 5 initialization.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createMobileInstallationKey,
  createMobileInstallationStore,
} from './mobile-installation-store';

const config = {
  userPoolId: 'ca-central-1_pool',
  mobileClientId: 'mobile-client',
};

it('uses an environment-scoped non-secret marker', async () => {
  const preferences = {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const store = createMobileInstallationStore(preferences, config);
  const key = 'vela:mobile:cognito:ca-central-1_pool:mobile-client:installation:v1';

  await expect(store.isCurrentInstallationMarked()).resolves.toBe(false);
  await store.markCurrentInstallation();

  expect(createMobileInstallationKey(config)).toBe(key);
  expect(preferences.get).toHaveBeenCalledWith({ key });
  expect(preferences.set).toHaveBeenCalledWith({ key, value: '1' });
});

it.each([null, '', '0', 'unexpected'])('treats %p as unmarked', async (value) => {
  const store = createMobileInstallationStore(
    {
      get: vi.fn().mockResolvedValue({ value }),
      set: vi.fn(),
    },
    config,
  );
  await expect(store.isCurrentInstallationMarked()).resolves.toBe(false);
});
```

Add a `'1'` marked case and exact propagation tests for Preferences read/write
rejections.

- [ ] **Step 2: Run the focused test to verify it fails**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/auth/mobile-installation-store.test.ts
```

Expected: FAIL because `./mobile-installation-store` does not exist.

- [ ] **Step 3: Implement the marker adapter**

```ts
import type { MobileOAuthConfig } from './mobile-auth-contract';
import type { OAuthTransactionPreferences } from './oauth-transaction-store';

export type MobileInstallationStore = {
  isCurrentInstallationMarked(): Promise<boolean>;
  markCurrentInstallation(): Promise<void>;
};

export function createMobileInstallationKey(
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): string {
  return `vela:mobile:cognito:${config.userPoolId}:${config.mobileClientId}:installation:v1`;
}

export function createMobileInstallationStore(
  preferences: Pick<OAuthTransactionPreferences, 'get' | 'set'>,
  config: Pick<MobileOAuthConfig, 'userPoolId' | 'mobileClientId'>,
): MobileInstallationStore {
  const key = createMobileInstallationKey(config);
  return {
    async isCurrentInstallationMarked() {
      return (await preferences.get({ key })).value === '1';
    },
    async markCurrentInstallation() {
      await preferences.set({ key, value: '1' });
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/auth/mobile-installation-store.test.ts \
  src/auth/oauth-transaction-store.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-installation-store.ts \
  apps/vela-mobile/src/auth/mobile-installation-store.test.ts
rtk git commit -m "feat(mobile): add installation reset marker"
```

Expected: both Preferences-backed store suites PASS.

---

### Task 3: Split Authorization-Code and Refresh Protocol Primitives

**Files:**

- Modify:
  `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify:
  `apps/vela-mobile/src/auth/mobile-oauth.ts`
- Modify:
  `apps/vela-mobile/src/auth/mobile-oauth.test.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**

- Produces:

```ts
export type OAuthTokenBundleBase = {
  accessToken: string;
  idToken: string;
  expiresAt: number;
};

export type AuthorizationCodeTokenBundle = OAuthTokenBundleBase & {
  refreshToken: string;
};

export type RefreshedTokenBundle = OAuthTokenBundleBase & {
  refreshToken?: string;
};

export function buildAuthorizationCodeTokenRequest(
  config: MobileOAuthConfig,
  transaction: OAuthTransaction,
  code: string,
  options?: { timeoutMs?: number },
): MobileTokenRequest;

export function buildRefreshTokenRequest(
  config: MobileOAuthConfig,
  refreshToken: string,
  options?: { timeoutMs?: number },
): MobileTokenRequest;

export function parseAuthorizationCodeTokenResponse(
  value: unknown,
  now: number,
): AuthorizationCodeTokenBundle;

export function parseRefreshTokenResponse(value: unknown, now: number): RefreshedTokenBundle;

export function validateAuthorizationCodeIdTokenClaims(
  idToken: string,
  expected: {
    config: MobileOAuthConfig;
    transaction: OAuthTransaction;
    now: number;
  },
): void;

export function validateRefreshedIdTokenClaims(
  idToken: string,
  expected: {
    config: MobileOAuthConfig;
    now: number;
    expectedSubject?: string;
  },
): string;
```

- Task 3 updates the existing callback caller to the renamed authorization-code
  functions so the branch stays green.
- Tasks 6 and 7 consume the refresh functions.

- [ ] **Step 1: Add failing request and parser tests**

```ts
it('builds the exact refresh-token public-client request', () => {
  const request = buildRefreshTokenRequest(config, 'refresh-token', {
    timeoutMs: 15_000,
  });
  expect(request).toEqual({
    url: `https://${config.oauthDomain}/oauth2/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.mobileClientId,
      refresh_token: 'refresh-token',
    }).toString(),
    timeoutMs: 15_000,
  });
  expect(request.data).not.toContain('client_secret');
});

it('requires a refresh token from authorization-code success', () => {
  expect(() =>
    parseAuthorizationCodeTokenResponse(
      { access_token: 'access', id_token: 'id', expires_in: 3600 },
      1_000,
    ),
  ).toThrow('Invalid token response');
});

it('permits refresh-token omission from refresh success', () => {
  expect(
    parseRefreshTokenResponse({ access_token: 'access', id_token: 'id', expires_in: 3600 }, 1_000),
  ).toEqual({
    accessToken: 'access',
    idToken: 'id',
    expiresAt: 3_601_000,
  });
});
```

In `src/services/mobile-auth.test.ts`, add the coordinator classification
regression:

```ts
it('maps a successful callback response without a refresh token to token validation failure', async () => {
  const harness = makeHarness();
  await harness.coordinator.initialize();
  await harness.coordinator.startSignIn();
  const transaction = harness.preferences.transaction();
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'access',
      id_token: idToken(transaction),
      expires_in: 3_600,
    },
  };

  harness.app.emit(callback(transaction));
  await harness.flush();
  expect(harness.coordinator.state.errorCode).toBe('token_validation_failed');
});
```

- [ ] **Step 2: Add failing nonce and subject tests**

```ts
it('validates a refreshed ID token without nonce and returns its subject', () => {
  const idToken = makeIdToken({
    token_use: 'id',
    aud: config.mobileClientId,
    iss: expectedIssuer,
    sub: 'user-1',
    exp: 3_600,
  });
  expect(
    validateRefreshedIdTokenClaims(idToken, {
      config,
      now: 1_000,
      expectedSubject: 'user-1',
    }),
  ).toBe('user-1');
});

it.each([
  ['missing subject', undefined, undefined],
  ['empty subject', '', undefined],
  ['subject mismatch', 'user-2', 'user-1'],
] as const)('rejects %s', (_label, subject, expectedSubject) => {
  const idToken = makeIdToken({
    token_use: 'id',
    aud: config.mobileClientId,
    iss: expectedIssuer,
    sub: subject,
    exp: 3_600,
  });
  expect(() =>
    validateRefreshedIdTokenClaims(idToken, {
      config,
      now: 1_000,
      ...(expectedSubject ? { expectedSubject } : {}),
    }),
  ).toThrow('Invalid ID token');
});
```

- [ ] **Step 3: Run the focused test to verify it fails**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/auth/mobile-oauth.test.ts \
  src/services/mobile-auth.test.ts
```

Expected: FAIL because the refresh-specific exports do not exist and the
coordinator still classifies the missing refresh token as code exchange.

- [ ] **Step 4: Implement one shared base parser and validator**

Keep one private parser that accepts `requireRefreshToken: boolean`, and one
private claim validator that accepts `expectedNonce?: string` and
`expectedSubject?: string`. The public wrappers must be:

```ts
export function parseAuthorizationCodeTokenResponse(
  value: unknown,
  now: number,
): AuthorizationCodeTokenBundle {
  const parsed = parseTokenResponseBase(value, now, true);
  if (!parsed.refreshToken) return invalidTokenResponse();
  return { ...parsed, refreshToken: parsed.refreshToken };
}

export function parseRefreshTokenResponse(value: unknown, now: number): RefreshedTokenBundle {
  return parseTokenResponseBase(value, now, false);
}

export function validateAuthorizationCodeIdTokenClaims(
  idToken: string,
  expected: AuthorizationCodeClaimExpectation,
): void {
  validateIdTokenClaimsBase(idToken, {
    config: expected.config,
    now: expected.now,
    expectedNonce: expected.transaction.nonce,
  });
}

export function validateRefreshedIdTokenClaims(
  idToken: string,
  expected: RefreshedClaimExpectation,
): string {
  return validateIdTokenClaimsBase(idToken, expected);
}
```

The base validator requires a non-empty `sub` in both flows. Only the
authorization-code wrapper supplies a nonce. Add `sub: 'user-123'` to the
default JWT claims produced by the existing `idToken()` helper in
`mobile-auth.test.ts` so all preserved callback fixtures satisfy the stronger
shared contract.

- [ ] **Step 5: Rename the existing callback call sites**

In `mobile-auth.ts`, replace:

```ts
buildTokenRequest;
parseTokenResponse;
validateIdTokenClaims;
```

with:

```ts
buildAuthorizationCodeTokenRequest;
parseAuthorizationCodeTokenResponse;
validateAuthorizationCodeIdTokenClaims;
```

Replace the removed `OAuthTokenBundle` import and coordinator variable with:

```ts
import type { AuthorizationCodeTokenBundle } from '../auth/mobile-auth-contract';

let tokenBundle: AuthorizationCodeTokenBundle | undefined;
```

Split the callback transport and validation stages so the stable mapping is:

- request rejection or non-2xx response → `code_exchange_failed`;
- successful 2xx response with an invalid schema, including a missing refresh
  token → `token_validation_failed`;
- ID-token claim failure → `token_validation_failed`.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/auth/mobile-oauth.test.ts src/services/mobile-auth.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/auth/mobile-oauth.ts \
  apps/vela-mobile/src/auth/mobile-oauth.test.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts
rtk git commit -m "feat(mobile): add Cognito refresh protocol primitives"
```

Expected: protocol and existing coordinator suites PASS; typecheck PASS.

---

### Task 4: Introduce Orthogonal Auth State and Atomic Transitions

**Files:**

- Modify:
  `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify:
  `apps/vela-mobile/src/App.test.ts`

**Interfaces:**

- Produces the accepted `MobileAuthOperation`, `MobileAuthRetryAction`,
  `MobileAuthNotice`, expanded `MobileAuthErrorCode`, and expanded
  `MobileAuthState`.
- Produces
  `assertMobileAuthState(state: MobileAuthState, context: MobileAuthStateAssertionContext): void`,
  which validates the approved state invariant table and throws
  `Error('invalid_mobile_auth_state')` before an invalid tuple is published.
- Preserves the existing `retrySessionVerification()` contract through Task 4;
  Task 6 replaces it atomically with `retryCurrentOperation()` alongside the
  generalized retry behavior.

- [ ] **Step 1: Add the expanded public types**

```ts
export type MobileAuthRetryAction = 'restore' | 'refresh' | 'persist' | 'verify' | 'cleanup';

export type MobileAuthOperation =
  | 'idle'
  | 'restoring'
  | 'refreshing'
  | 'persisting'
  | 'verifying'
  | 'signingOut'
  | 'cleaningUp';

export type MobileAuthNotice = 'session_unusable' | 'cleanup_incomplete' | null;

export type MobileAuthState = {
  phase: MobileAuthPhase;
  operation: MobileAuthOperation;
  sessionUsable: boolean;
  errorCode: MobileAuthErrorCode | null;
  retryAction: MobileAuthRetryAction | null;
  notice: MobileAuthNotice;
  user: MobileAuthUser | null;
};

export type MobileAuthStateAssertionContext = {
  activeBundle: OAuthTokenBundleBase | null;
  now: number;
};
```

Append these error codes:

```ts
| 'session_restore_failed'
| 'session_refresh_failed'
| 'session_persistence_failed'
| 'session_cleanup_failed'
| 'unsupported_platform'
```

Add the `appStateChange` overload to `MobileAppAdapter` without changing the
existing `appUrlOpen` signature.

- [ ] **Step 2: Add failing invariant tests**

```ts
it('publishes the complete authenticated tuple after verification', async () => {
  const coordinator = createCoordinator();
  await authenticate(coordinator);

  expect(coordinator.state).toEqual({
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId: 'user-1', email: null },
  });
});

it('rejects invalid published state tuples with a stable internal error', () => {
  expect(() =>
    assertMobileAuthState(
      {
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: true,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      },
      {
        activeBundle: null,
        now,
      },
    ),
  ).toThrow('invalid_mobile_auth_state');
});
```

Export `assertMobileAuthState()` from `mobile-auth-contract.ts` so the invalid
tuple test exercises the production validator directly. Task 7 adds the real
refresh-failure assertion that proves `phase`, `errorCode`, and
`sessionUsable` remain orthogonal.

- [ ] **Step 3: Run the coordinator and component suites to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/services/mobile-auth.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/App.test.ts
```

Expected: FAIL because state fixtures and coordinator transitions lack the new
fields.

- [ ] **Step 4: Replace implicit mutators with full-state transitions**

Initialize every field:

```ts
const state = reactive<MobileAuthState>({
  phase: 'initializing',
  operation: 'idle',
  sessionUsable: false,
  errorCode: null,
  retryAction: null,
  notice: null,
  user: null,
});
```

Replace `setPhase()` and `setError()` with:

```ts
function applyState(next: MobileAuthState): void {
  assertMobileAuthState(next, {
    activeBundle: tokenBundle ?? null,
    now: dependencies.now(),
  });
  Object.assign(state, next);
}

function enterOAuthProgress(phase: MobileAuthPhase): void {
  applyState({
    phase,
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  });
}

function enterOAuthError(errorCode: MobileAuthErrorCode): void {
  applyState({
    phase: 'error',
    operation: 'idle',
    sessionUsable: false,
    errorCode,
    retryAction: null,
    notice: null,
    user: null,
  });
}

function enterAuthenticated(user: MobileAuthUser): void {
  applyState({
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user,
  });
}
```

Implement `assertMobileAuthState()` as one fail-closed predicate covering the
six approved invariants: usable sessions require an authenticated phase,
non-null user, null notice, and an unexpired active bundle; error phase requires
an error code; retry requires idle plus an error code; both notice shapes require
their exact signed-out tuples. Operation transitions remain named full-state
constructors so they never implicitly erase user, candidate, or notice state.

Add full-state constructors for signed out, session failure, operation
progress, terminal notice, and cleanup failure. Do not accept
`Partial<MobileAuthState>` in a production transition helper.

- [ ] **Step 5: Update every fixture and fail the gate closed**

Every `MobileAuthState` literal in `MobileAuthGate.test.ts` and `App.test.ts`
must include:

```ts
operation: 'idle',
sessionUsable: false,
retryAction: null,
notice: null,
```

Authenticated fixtures set `sessionUsable: true`.

In `MobileAuthGate.vue`, make protected-content visibility capability-based
immediately:

```ts
const contentVisible = computed(
  () => diagnosticBypass.value || (state.sessionUsable && authenticatedLandingReady.value),
);
```

Until Task 9 installs the total selector, type the existing presentation table
as `Partial<Record<MobileAuthErrorCode, ErrorPresentation>>` and use this exact
fail-closed fallback for codes that the HPA-205 table does not own:

```ts
const SESSION_STATE_FALLBACK: ErrorPresentation = {
  heading: 'Vela cannot use this session',
  message: 'Vela could not safely continue with the current session.',
  action: null,
};
```

Add a component test proving `phase: authenticated` with
`sessionUsable: false` never mounts the protected slot.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/services/mobile-auth.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/App.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.vue \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts \
  apps/vela-mobile/src/App.test.ts
rtk git commit -m "refactor(mobile): model auth session state explicitly"
```

Expected: focused suites and typecheck PASS with all HPA-205 behavior preserved.

---

### Task 5: Wire Native Stores and Make OAuth Completion Durable

**Files:**

- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/boot/mobile-auth.test.ts`

**Interfaces:**

- `MobileAuthCoordinatorDependencies` gains:

```ts
sessionStore: MobileSessionStore;
installationStore: MobileInstallationStore;
isNativeIos: boolean;
```

- Produces the retained candidate shape used by persistence and verification:

```ts
type PendingCandidate = {
  bundle: OAuthTokenBundleBase;
  durableRefreshToken: string;
  returnedRefreshToken?: string;
  context: 'authorizationCode' | 'restore' | 'refresh';
};

type CleanupContext = { kind: 'terminalSession' } | { kind: 'installationReset' };
```

- Consumes Task 1's Keychain/unsupported stores and Task 2's installation store.
- Produces persistence-before-verification for new OAuth callbacks and a
  fail-closed unsupported runtime.

- [ ] **Step 1: Add failing boot-selection tests**

Mock `Capacitor`, `SecureStorage`, and both factories. Add:

```ts
it('injects Keychain storage only on native iOS', () => {
  mocks.isNativePlatform.mockReturnValue(true);
  mocks.getPlatform.mockReturnValue('ios');
  runBoot({ app: { provide: vi.fn() } });

  expect(mocks.createIosStore).toHaveBeenCalledWith({
    secureStorage: mocks.secureStorage,
    runtime: mocks.capacitor,
    config: {
      userPoolId: config.auth.userPoolId,
      mobileClientId: config.auth.mobileClientId,
    },
  });
  expect(mocks.createUnsupportedStore).not.toHaveBeenCalled();
});

it.each([
  [false, 'web'],
  [true, 'android'],
] as const)('injects the unsupported store for native=%s platform=%s', (isNative, platform) => {
  mocks.isNativePlatform.mockReturnValue(isNative);
  mocks.getPlatform.mockReturnValue(platform);
  runBoot({ app: { provide: vi.fn() } });

  expect(mocks.createUnsupportedStore).toHaveBeenCalledOnce();
  expect(mocks.createIosStore).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add failing installation-reset and callback-persistence tests**

```ts
it('clears retained Keychain state before writing a missing install marker', async () => {
  installationStore.isCurrentInstallationMarked.mockResolvedValue(false);
  await coordinator.initialize();

  expect(order).toContainSequence([
    'installation:isMarked',
    'session:clear',
    'installation:mark',
    'app:getLaunchUrl',
  ]);
});

it('fails closed when first-install cleanup cannot complete', async () => {
  installationStore.isCurrentInstallationMarked.mockResolvedValue(false);
  sessionStore.clearRefreshToken.mockRejectedValue(new Error('SECRET-keychain'));
  await coordinator.initialize();

  expect(coordinator.state).toMatchObject({
    phase: 'signedOut',
    operation: 'idle',
    sessionUsable: false,
    errorCode: 'session_cleanup_failed',
    retryAction: 'cleanup',
    notice: 'cleanup_incomplete',
  });
  expect(app.getLaunchUrl).not.toHaveBeenCalled();
});

it('persists the callback refresh token before API verification', async () => {
  await completeSuccessfulCallback();
  expect(order).toContainSequence([
    'session:save:refresh-token',
    'fetch:/auth/session',
    'state:authenticated',
  ]);
});
```

Add marker read/write failures, crash-safe clear-before-mark retry, missing
callback refresh token, persistence failure retaining the candidate, API
401/403 cleanup, and secret-sentinel assertions.

- [ ] **Step 3: Run focused tests to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/boot/mobile-auth.test.ts \
  src/services/mobile-auth.test.ts
```

Expected: FAIL because boot does not select stores and the coordinator does not
persist callback refresh tokens.

- [ ] **Step 4: Wire the runtime adapters**

In `boot/mobile-auth.ts`, import:

```ts
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createMobileInstallationStore } from '../auth/mobile-installation-store';
import {
  createIosKeychainSessionStore,
  createUnsupportedMobileSessionStore,
} from '../auth/mobile-session-store';
```

Use:

```ts
const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const sessionStore = isNativeIos
  ? createIosKeychainSessionStore({
      secureStorage: SecureStorage,
      runtime: Capacitor,
      config: {
        userPoolId: config.auth.userPoolId,
        mobileClientId: config.auth.mobileClientId,
      },
    })
  : createUnsupportedMobileSessionStore();
const installationStore = createMobileInstallationStore(Preferences, {
  userPoolId: config.auth.userPoolId,
  mobileClientId: config.auth.mobileClientId,
});
```

Inject `sessionStore`, `installationStore`, and `isNativeIos`. Keychain
accessibility remains owned entirely by the session-store adapter.

- [ ] **Step 5: Enforce platform and installation preconditions**

At initialization:

1. validate config;
2. if `isNativeIos` is false, publish `unsupported_platform` and stop before
   Preferences or plugin calls;
3. register native listeners;
4. read the installation marker;
5. if absent, clear the session store and then mark the installation;
6. on any reset failure, enter `cleanup_incomplete` and stop before launch URL,
   transaction, or credential inspection.

The coordinator's `startSignIn()` guard must use the accepted positive allowlist
and check `isNativeIos`:

```ts
const RESTARTABLE_OAUTH_ERRORS = new Set<MobileAuthErrorCode>([
  'browser_launch_failed',
  'cancelled',
  'interrupted',
  'transaction_expired',
  'malformed_callback',
  'provider_error',
  'code_exchange_failed',
  'token_validation_failed',
  'session_unauthorized',
]);

const canStartSignIn =
  dependencies.isNativeIos &&
  state.operation === 'idle' &&
  ((state.phase === 'signedOut' &&
    state.retryAction === null &&
    (state.notice === null || state.notice === 'session_unusable')) ||
    (state.phase === 'error' &&
      state.errorCode !== null &&
      RESTARTABLE_OAUTH_ERRORS.has(state.errorCode)));
```

All other tuples reject sign-in without touching Preferences, Keychain, or the
browser.

Retain `{ kind: 'installationReset' }` for marker/reset failure and
`{ kind: 'terminalSession' }` for failed deletion of an API-rejected callback
credential.

- [ ] **Step 6: Persist callback candidates before verification**

After authorization-code response validation:

```ts
const { refreshToken, ...candidateBundle } = bundle;
pendingCandidate = {
  bundle: candidateBundle,
  durableRefreshToken: refreshToken,
  context: 'authorizationCode',
};
enterOperation('persisting');
await dependencies.sessionStore.saveRefreshToken(refreshToken);
enterOperation('verifying');
await verifyCandidateSessionUnlocked();
```

On save failure, keep the candidate in memory and publish
`session_persistence_failed` with `retryAction: persist`. On API success,
promote the candidate atomically by assigning the process-local `tokenBundle`
with its durable refresh token, clearing `pendingCandidate`, and only then
entering authenticated state. On API 401/403, clear the saved refresh token
before publishing `session_unusable`; deletion failure publishes
`cleanup_incomplete`.

- [ ] **Step 7: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/boot/mobile-auth.test.ts \
  src/services/mobile-auth.test.ts \
  src/auth/mobile-session-store.test.ts \
  src/auth/mobile-installation-store.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/boot/mobile-auth.ts \
  apps/vela-mobile/src/boot/mobile-auth.test.ts
rtk git commit -m "feat(mobile): persist verified OAuth sessions"
```

Expected: focused suites and typecheck PASS.

---

### Task 6: Restore Durable Sessions and Generalize Retry

**Files:**

- Modify:
  `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify:
  `apps/vela-mobile/src/App.test.ts`

**Interfaces:**

- Replaces:

```ts
retrySessionVerification(): Promise<void>;
```

with:

```ts
retryCurrentOperation(): Promise<void>;
```

Task 8 adds `signOut()` to the interface and implements it in the same task, so
the public contract is introduced only with working behavior.

- Produces cold restore, candidate retry, terminal cleanup, all five retry
  dispatch branches, and durable-token precedence.

- [ ] **Step 1: Add failing cold-launch precedence tests**

```ts
function refreshedIdToken(overrides: Record<string, unknown> = {}): string {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    token_use: 'id',
    aud: config.mobileClientId,
    iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    sub: 'user-123',
    exp: 2_000,
    ...overrides,
  })}.unsigned`;
}

function prepareSuccessfulRefresh(
  harness: ReturnType<typeof makeHarness>,
  options: { subject?: string; rotatedRefreshToken?: string } = {},
): void {
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'SECRET-refreshed-access-token',
      id_token: refreshedIdToken({ sub: options.subject ?? 'user-123' }),
      expires_in: 3_600,
      ...(options.rotatedRefreshToken ? { refresh_token: options.rotatedRefreshToken } : {}),
    },
  };
}

it('lets a matching callback win without starting a parallel restore', async () => {
  app.launchUrl = { url: matchingCallbackUrl };
  sessionStore.loadRefreshToken.mockResolvedValue('durable-token');
  await coordinator.initialize();

  expect(tokenTransport.requests).toHaveLength(1);
  expect(tokenTransport.requests[0]?.data).toContain('grant_type=authorization_code');
  expect(tokenTransport.requests[0]?.data).not.toContain('grant_type=refresh_token');
});

it('lets a durable token outrank a residual transaction', async () => {
  transactionStore.load.mockResolvedValue({
    kind: 'active',
    transaction,
  });
  sessionStore.loadRefreshToken.mockResolvedValue('durable-token');
  await coordinator.initialize();

  expect(transactionStore.clear).toHaveBeenCalled();
  expect(tokenTransport.requests[0]?.data).toContain('grant_type=refresh_token');
});

it('restores and verifies before publishing a usable session', async () => {
  sessionStore.loadRefreshToken.mockResolvedValue('durable-token');
  await coordinator.initialize();

  expect(order).toContainSequence([
    'session:load',
    'token:refresh',
    'candidate:validate',
    'fetch:/auth/session',
    'state:authenticated',
  ]);
  expect(coordinator.state.sessionUsable).toBe(true);
});
```

Add missing token, active transaction without token, expired/corrupt residual
transaction fallthrough, rare load rejection, rotated-token persistence,
subject mismatch, and API verification cases. Include a transaction-store read
rejection with a valid durable token and assert restoration still proceeds.

- [ ] **Step 2: Add failing terminal-versus-retryable tests**

```ts
import { MobileSessionStoreError } from '../auth/mobile-session-store';

it.each([
  [400, { error: 'invalid_grant' }],
  [401, { error: 'unauthorized' }],
  [403, { error: 'forbidden' }],
] as const)('clears terminal refresh failures with status %s', async (status, data) => {
  tokenTransport.respond({ status, data });
  await coordinator.initialize();
  expect(sessionStore.clearRefreshToken).toHaveBeenCalledOnce();
  expect(coordinator.state.notice).toBe('session_unusable');
});

it.each([429, 500, 503])('preserves the durable token for retryable status %s', async (status) => {
  tokenTransport.respond({ status, data: {} });
  await coordinator.initialize();
  expect(sessionStore.clearRefreshToken).not.toHaveBeenCalled();
  expect(coordinator.state).toMatchObject({
    errorCode: 'session_restore_failed',
    retryAction: 'restore',
  });
});

it('clears a corrupt local token before showing the terminal notice', async () => {
  sessionStore.loadRefreshToken.mockRejectedValue(new MobileSessionStoreError('corrupt'));
  await coordinator.initialize();

  expect(sessionStore.clearRefreshToken).toHaveBeenCalledOnce();
  expect(coordinator.state).toMatchObject({
    phase: 'signedOut',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: 'session_unusable',
  });
});
```

Also cover network/timeout failures, malformed 2xx responses, API 401/403, API
429/5xx, corrupt-token deletion failure entering `cleanup_incomplete`, and
sanitized messages.

- [ ] **Step 3: Add failing retry-dispatch tests**

```ts
it.each([
  ['restore', 'token:refresh'],
  ['persist', 'session:save'],
  ['verify', 'fetch:/auth/session'],
  ['cleanup', 'session:clear'],
] as const)(
  'dispatches %s without repeating completed work',
  async (retryAction, expectedOperation) => {
    arrangeRetryableState(retryAction);
    await coordinator.retryCurrentOperation();
    expect(order).toContain(expectedOperation);
  },
);
```

For `persist`, assert no token request is made. For `verify`, assert neither
token request nor Keychain save is repeated. For `cleanup`, assert no token or
API request is made.

- [ ] **Step 4: Run the coordinator suite to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/services/mobile-auth.test.ts
```

Expected: FAIL because durable restore and generalized retry are absent.

- [ ] **Step 5: Implement cold restore and candidate promotion**

Retain Task 5's `PendingCandidate` and represent verified ownership explicitly:

```ts
type ActiveSession = {
  bundle: OAuthTokenBundleBase & { refreshToken: string };
  user: MobileAuthUser;
};
```

Replace the Task 4 `tokenBundle` owner with
`let active: ActiveSession | undefined`, update `applyState()` to pass
`active?.bundle ?? null` to the invariant validator, and assign `active` before
publishing the authenticated tuple. Candidates remain separate until that
promotion point.

The restore path must:

1. load the durable token, mapping missing to ordinary signed out, corrupt to
   terminal cleanup, and unavailable to retryable restore;
2. build the refresh request with the 15-second timeout;
3. classify terminal versus retryable transport outcomes;
4. parse and validate the refreshed claims;
5. persist a returned rotation before verification;
6. verify `/api/auth/session`;
7. promote one complete `ActiveSession`.

No public state may expose `sessionUsable: true` before step 7.

Task 6 consumes Task 5's `CleanupContext`: installation-reset cleanup clears
Keychain, writes the marker, and resumes initialization; terminal-session
cleanup clears Keychain and publishes `notice: session_unusable`.

- [ ] **Step 6: Implement exact cold-launch precedence**

After installation reset:

1. consume only a matching launch callback with an active transaction;
2. otherwise capture transaction state and load the durable token independently;
3. if a token exists, clear any residual transaction best-effort and restore;
4. without a token, keep the existing active/expired/corrupt transaction
   recovery semantics;
5. without either, enter ordinary signed out.

Do not return on a transaction-store read failure before attempting the
Keychain load. A durable token may still restore; only a transaction dependency
failure with no restorable durable credential becomes
`configuration_error`. A Keychain operational failure remains
`session_restore_failed` even when residual transaction state exists.

- [ ] **Step 7: Implement generalized retry and update fixtures**

`retryCurrentOperation()` reads only `state.retryAction` and retained internal
state. Capture the action before the named retry transition clears public
error/retry fields:

```ts
const retryAction = state.retryAction;
if (retryAction === null || state.operation !== 'idle') return;

switch (retryAction) {
  case 'restore':
    enterRetryOperation('restore');
    await restoreSessionUnlocked();
    return;
  case 'refresh':
    enterRetryOperation('refresh');
    await refreshActiveSessionUnlocked();
    return;
  case 'persist':
    enterRetryOperation('persist');
    await persistCandidateUnlocked();
    return;
  case 'verify':
    enterRetryOperation('verify');
    await verifyCandidateSessionUnlocked();
    return;
  case 'cleanup':
    enterRetryOperation('cleanup');
    await retryCleanupUnlocked();
    return;
}
```

`refreshActiveSessionUnlocked()` uses the same candidate pipeline without
timers or coalescing; Task 7 puts this branch behind the single-flight
scheduler. Update all coordinator fixtures from `retrySessionVerification` to
`retryCurrentOperation`. In `MobileAuthGate.vue`, replace the narrow retry
handler's coordinator call with `retryCurrentOperation()` while retaining the
existing HPA-205 presentation; Task 9 replaces that presentation with the
total selector.

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/services/mobile-auth.test.ts \
  src/auth/mobile-oauth.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/App.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.vue \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts \
  apps/vela-mobile/src/App.test.ts
rtk git commit -m "feat(mobile): restore durable Cognito sessions"
```

Expected: focused suites and typecheck PASS.

---

### Task 7: Add Proactive Refresh, Resume Recovery, and Expiry Closure

**Files:**

- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**

- Consumes the Task 6 active-session and candidate pipeline.
- Routes proactive, resume, automatic, and manual triggers through the Task 6
  refresh branch.
- Adds:

```ts
export const MOBILE_AUTH_REFRESH_LEAD_MS = 60_000;
export const MOBILE_AUTH_SOFT_RETRY_DELAY_MS = 5_000;
```

- [ ] **Step 1: Extend the fake app for `appStateChange`**

```ts
class FakeApp implements MobileAppAdapter {
  urlListener?: (event: { url: string }) => void;
  stateListener?: (event: { isActive: boolean }) => void;

  async addListener(
    eventName: 'appUrlOpen' | 'appStateChange',
    listener: ((event: { url: string }) => void) | ((event: { isActive: boolean }) => void),
  ): Promise<ListenerHandle> {
    if (eventName === 'appUrlOpen') {
      this.urlListener = listener as (event: { url: string }) => void;
    } else {
      this.stateListener = listener as (event: { isActive: boolean }) => void;
    }
    return { remove: vi.fn().mockResolvedValue(undefined) };
  }
}
```

Extend `HarnessOptions` with `now?: () => number` and inject
`options.now ?? (() => NOW)` into the coordinator. Every fake-timer test sets
`vi.setSystemTime(NOW)` and passes `now: () => Date.now()`; production code
continues to read only `dependencies.now()`.

- [ ] **Step 2: Add failing timer and resume tests**

```ts
it('refreshes exactly 60 seconds before access expiry', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await authenticateWithExpiry(NOW + 3_600_000);
  await vi.advanceTimersByTimeAsync(3_539_999);
  expect(refreshRequests()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(refreshRequests()).toHaveLength(1);
});

it('coalesces resume, automatic timer, and manual retry into one grant', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await authenticateWithExpiry(NOW + 120_000);
  failNextRefreshWithNetworkError();
  await vi.advanceTimersByTimeAsync(60_000);

  holdNextRefreshResponse();
  const manualRetry = coordinator.retryCurrentOperation();
  app.emitState(true);
  await vi.advanceTimersByTimeAsync(5_000);

  expect(refreshRequests()).toHaveLength(2);
  releaseRefreshResponse();
  await manualRetry;
});

it('rechecks ownership at the serialized queue head', async () => {
  blockEarlierOperation();
  app.emitState(true);
  app.emitState(false);
  releaseEarlierOperation();
  await flushPromises();
  expect(refreshRequests()).toHaveLength(0);
});
```

- [ ] **Step 3: Add failing soft-failure and expiry tests**

```ts
it('retries one soft failure after five seconds with enough lifetime', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await authenticateWithExpiry(NOW + 61_000);
  failNextTwoRefreshesWithNetworkError();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(coordinator.state.sessionUsable).toBe(true);

  await vi.advanceTimersByTimeAsync(4_999);
  expect(refreshRequests()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refreshRequests()).toHaveLength(2);

  await vi.advanceTimersByTimeAsync(5_000);
  expect(refreshRequests()).toHaveLength(2);
});

it('closes the gate at exact old-token expiry after a soft failure', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await authenticateWithExpiry(NOW + 61_000);
  failNextTwoRefreshesWithNetworkError();
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(5_000);

  await vi.advanceTimersByTimeAsync(54_999);
  expect(coordinator.state.sessionUsable).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(coordinator.state).toMatchObject({
    phase: 'authenticated',
    sessionUsable: false,
    errorCode: 'session_refresh_failed',
    retryAction: 'refresh',
  });
});
```

Add inactive cancellation, active rescheduling, too-little-lifetime,
manual-cancels-auto, candidate persistence/verification retry, successful
deadline replacement, and injected-clock-only cases.

- [ ] **Step 4: Run the coordinator suite to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/services/mobile-auth.test.ts
```

Expected: FAIL because lifecycle timers and coalescing do not exist.

- [ ] **Step 5: Implement refresh scheduling and single flight**

Use separate handles for:

```ts
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let accessExpiryTimer: ReturnType<typeof setTimeout> | undefined;
let automaticRetryTimer: ReturnType<typeof setTimeout> | undefined;
let refreshPromise: Promise<void> | undefined;
let activeBundleGeneration = 0;
let appIsActive = true;
```

Schedule the foreground timer with:

```ts
const delay = Math.max(
  0,
  active.bundle.expiresAt - dependencies.now() - MOBILE_AUTH_REFRESH_LEAD_MS,
);
```

A zero delay queues immediately. Resume recomputes the same delay, refreshing
only when expired or within the lead window and otherwise installing a new
timer.

`queueRefresh()` sets `refreshPromise` before calling `serialize()`, captures the
bundle generation, re-checks app activity/session ownership/due time at queue
head, and clears the promise in `finally`.

- [ ] **Step 6: Implement the bounded automatic retry**

After a retryable in-session `refresh`, `persist`, or `verify` failure:

```ts
const enoughLifetime =
  active.bundle.expiresAt - dependencies.now() >
  MOBILE_AUTH_SOFT_RETRY_DELAY_MS + MOBILE_AUTH_NETWORK_TIMEOUT_MS;
```

Schedule exactly one automatic retry when active and `enoughLifetime` is true.
Cancel it on manual retry, backgrounding, promotion, expiry, terminal cleanup,
sign-out, or disposal.

- [ ] **Step 7: Register and remove the lifecycle listener**

Register `appStateChange` beside `appUrlOpen`. `isActive: false` cancels the
foreground refresh/automatic-retry timers. `isActive: true` synchronously
re-evaluates old-token expiry, then queues or schedules refresh. Keep
`capacitor-lifecycle.ts` unchanged because its `resume` listener remains
diagnostics-only.

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/services/mobile-auth.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts
rtk git commit -m "feat(mobile): refresh active Cognito sessions"
```

Expected: coordinator suite and typecheck PASS.

---

### Task 8: Implement Local Sign-Out, Start Over, and Cleanup Retry

**Files:**

- Modify:
  `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify:
  `apps/vela-mobile/src/App.test.ts`

**Interfaces:**

- Adds and implements `MobileAuthCoordinator.signOut(): Promise<void>`.
- Extends cleanup retry ownership to failed Sign out.
- `dispose()` remains teardown-only and never calls session or Preferences
  cleanup.

- [ ] **Step 1: Add failing sign-out tests**

```ts
it('hides content before asynchronous durable cleanup', async () => {
  await authenticate();
  sessionStore.clearRefreshToken.mockReturnValue(clearGate.promise);
  const result = coordinator.signOut();

  expect(coordinator.state).toMatchObject({
    operation: 'signingOut',
    sessionUsable: false,
  });
  expect(clearGate.settled).toBe(false);

  clearGate.resolve();
  await result;
});

it.each(['restore', 'refresh', 'persist', 'verify'] as const)(
  'allows start-over cleanup from blocking %s recovery',
  async (retryAction) => {
    arrangeBlockingRetry(retryAction);
    await coordinator.signOut();
    expect(sessionStore.clearRefreshToken).toHaveBeenCalledOnce();
    expect(transactionStore.clear).toHaveBeenCalledOnce();
    expect(coordinator.state).toMatchObject({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
  },
);
```

- [ ] **Step 2: Add failing cleanup and disposal tests**

```ts
it('reports incomplete cleanup without claiming sign-out success', async () => {
  await authenticate();
  sessionStore.clearRefreshToken.mockRejectedValue(new Error('SECRET-delete-failure'));
  await coordinator.signOut();

  expect(coordinator.state).toMatchObject({
    phase: 'signedOut',
    operation: 'idle',
    sessionUsable: false,
    errorCode: 'session_cleanup_failed',
    retryAction: 'cleanup',
    notice: 'cleanup_incomplete',
    user: null,
  });
  expect(JSON.stringify(coordinator.state)).not.toContain('SECRET');
});

it('dispose waits behind sign-out but never deletes durable state itself', async () => {
  const signOut = coordinator.signOut();
  const dispose = coordinator.dispose();
  await signOut;
  await dispose;
  expect(sessionStore.clearRefreshToken).toHaveBeenCalledOnce();
});
```

Add cleanup retry success/failure, duplicate sign-out suppression, timer
cancellation, pending candidate erasure, installation-marker retention, and
post-disposal no-op cases. Add a resolved `signOut` mock to the typed
coordinator fixtures in `MobileAuthGate.test.ts` and `App.test.ts`. Assert local
Sign out makes no Cognito token/logout request and does not open the browser.

- [ ] **Step 3: Run the coordinator suite to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/services/mobile-auth.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/App.test.ts
```

Expected: FAIL because `signOut()` and cleanup retry are incomplete.

- [ ] **Step 4: Implement sign-out eligibility and cleanup**

Use a positive predicate:

```ts
let signOutPromise: Promise<void> | undefined;

function canSignOutOrStartOver(): boolean {
  if (disposed) return false;
  return (
    state.phase === 'authenticated' ||
    (state.operation === 'idle' &&
      state.sessionUsable === false &&
      state.retryAction !== null &&
      ['restore', 'refresh', 'persist', 'verify'].includes(state.retryAction))
  );
}
```

At the public call, return `signOutPromise` immediately when one already
exists. Otherwise validate the predicate, synchronously suppress new refresh
work and close the gate, assign the serialized cleanup promise before returning
it, and clear the single-flight field in `finally`.

Add `disposalRequested` beside `disposed`. The public `dispose()` sets it before
joining the serialized queue; every other public entry point and every queue-head
ownership check treats either flag as unavailable. The queued disposer removes
listeners and timers and clears process memory, but never calls either durable
store.

Inside the serialized cleanup:

1. cancel all three timer classes and invalidate bundle generation;
2. clear Keychain and PKCE transaction;
3. erase active and pending token material;
4. enter ordinary signed out only after Keychain deletion succeeds;
5. otherwise enter `cleanup_incomplete`.

Do not remove the installation marker.

- [ ] **Step 5: Implement cleanup retry**

Extend the retained cleanup context:

```ts
type CleanupContext =
  | { kind: 'signOut' }
  | { kind: 'terminalSession' }
  | { kind: 'installationReset' };
```

Installation-reset retry must clear Keychain, mark the installation, and resume
initialization. Sign-out retry clears Keychain and finishes ordinary signed
out. Terminal-session retry clears Keychain and finishes signed out with
`notice: session_unusable`.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/services/mobile-auth.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/App.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts \
  apps/vela-mobile/src/App.test.ts
rtk git commit -m "feat(mobile): add durable local sign-out"
```

Expected: coordinator suite and typecheck PASS.

---

### Task 9: Render the Exhaustive Gate and Add Sign-Out UI

**Files:**

- Create:
  `apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.ts`
- Create:
  `apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.test.ts`
- Create:
  `apps/vela-mobile/src/pages/MorePage.test.ts`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify:
  `apps/vela-mobile/src/pages/MorePage.vue`
- Modify:
  `apps/vela-mobile/src/App.test.ts`

**Interfaces:**

- Produces:

```ts
export type AuthenticatedLandingState = 'pending' | 'ready' | 'failed';

export type MobileAuthGateView =
  | {
      kind: 'content';
      retry: {
        errorCode: MobileAuthErrorCode;
        action: Exclude<MobileAuthRetryAction, 'cleanup'>;
      } | null;
    }
  | { kind: 'progress'; operation: MobileAuthOperation; phase: MobileAuthPhase }
  | { kind: 'landing_failure' }
  | {
      kind: 'blocking_session_failure';
      errorCode: MobileAuthErrorCode;
      retryAction: Exclude<MobileAuthRetryAction, 'cleanup'>;
      allowStartOver: true;
    }
  | { kind: 'signed_out'; notice: 'session_unusable' | null }
  | { kind: 'cleanup_failure' }
  | { kind: 'unsupported' }
  | { kind: 'oauth_error'; errorCode: MobileAuthErrorCode }
  | { kind: 'invalid_state' };

export function selectMobileAuthGateView(
  state: Readonly<MobileAuthState>,
  landingState: AuthenticatedLandingState,
): MobileAuthGateView;
```

- `MobileAuthGate.vue` consumes only this selector plus the development
  diagnostics bypass.

- [ ] **Step 1: Write the failing selector matrix**

```ts
it.each([
  [
    {
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      notice: null,
      user,
    },
    {
      kind: 'blocking_session_failure',
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      allowStartOver: true,
    },
  ],
  [
    {
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: 'session_unusable',
      user: null,
    },
    { kind: 'signed_out', notice: 'session_unusable' },
  ],
] as const)('maps state to an explicit gate view', (state, expected) => {
  expect(selectMobileAuthGateView(state, 'ready')).toEqual(expected);
});

it('fails closed for an unmatched tuple', () => {
  expect(
    selectMobileAuthGateView(
      {
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: true,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      },
      'ready',
    ),
  ).toEqual({ kind: 'invalid_state' });
});
```

Cover every operation, soft banner, landing pending/failure, cleanup,
unsupported, ordinary signed out, terminal notice, all restartable HPA-205
errors, and configuration error.

- [ ] **Step 2: Run the selector test to verify failure**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run src/components/mobile/mobile-auth-gate-view.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement the total selector**

Use explicit precedence:

1. reject invariant-breaking tuples as `invalid_state`;
2. return `unsupported` and `cleanup_failure`;
3. return blocking progress when `sessionUsable` is false and either
   `operation` is non-idle or the error-free phase is an HPA-205 OAuth progress
   phase;
4. return content/content-banner when usable and landing is ready;
5. return landing pending/failure while authenticated;
6. return blocking session retry when unusable;
7. return ordinary/terminal signed out;
8. return existing HPA-205 error;
9. return `invalid_state`.

Never return `undefined` and never select from translated copy.

- [ ] **Step 4: Add failing component action and bypass tests**

```ts
it('renders retry and start-over for an expired refresh failure', async () => {
  const { wrapper, coordinator } = await mountGate({
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: false,
    errorCode: 'session_refresh_failed',
    retryAction: 'refresh',
    notice: null,
    user,
  });
  expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
    'Retry',
    'Sign out and start over',
  ]);
  await wrapper.findAll('button')[1]?.trigger('click');
  expect(coordinator.signOut).toHaveBeenCalledOnce();
});

it('allows marked development diagnostics for unsupported browser boot', async () => {
  const { wrapper } = await mountGate(
    {
      phase: 'error',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'unsupported_platform',
      retryAction: null,
      notice: null,
      user: null,
    },
    { path: '/diagnostics' },
  );
  expect(wrapper.get('[data-testid="protected-slot"]').exists()).toBe(true);
});
```

Add non-blocking banner, cleanup-only retry, terminal notice, progress
`aria-live`, invalid-state, action deduplication, and focus-return tests.

- [ ] **Step 5: Rewrite `MobileAuthGate.vue` around the selector**

Keep:

```ts
const contentVisible = computed(() => diagnosticBypass.value || gateView.value.kind === 'content');
```

Use one template branch per `gateView.kind`. The
`blocking_session_failure` branch calls `retryCurrentOperation()` and
`signOut()`. `cleanup_failure` calls only `retryCurrentOperation()`.
`unsupported` and `invalid_state` have no action.

Watch entry into `invalid_state` and emit exactly
`console.error('mobile_auth_invalid_state')` once per entry. Never serialize the
state tuple into that diagnostic.

Use these exact HPA-206 strings:

```ts
const OPERATION_COPY: Partial<Record<MobileAuthOperation, string>> = {
  restoring: 'Restoring your Vela session…',
  refreshing: 'Refreshing your Vela session…',
  persisting: 'Securing your Vela session…',
  verifying: 'Verifying your Vela session…',
  signingOut: 'Signing out…',
  cleaningUp: 'Finishing secure sign-out…',
};

const SESSION_UNUSABLE_COPY =
  'Your Vela session is no longer usable. Continue with Google to sign in again.';
const CLEANUP_INCOMPLETE_COPY =
  'Vela could not finish secure sign-out. Your session may return if you close and reopen the app before cleanup succeeds.';
```

Progress uses `role="status"` and `aria-live="polite"`; failures and notices use
`role="alert"`. A successful background refresh produces no live-region
announcement.

Update `shouldBypassMobileAuth()` to require development mode, route metadata,
`operation: idle`, and one of:

```ts
const ordinarySignedOut =
  state.phase === 'signedOut' &&
  state.operation === 'idle' &&
  state.sessionUsable === false &&
  state.errorCode === null &&
  state.retryAction === null &&
  state.notice === null &&
  state.user === null;

const bypassableBootError =
  state.phase === 'error' &&
  state.operation === 'idle' &&
  state.sessionUsable === false &&
  (state.errorCode === 'configuration_error' || state.errorCode === 'unsupported_platform') &&
  state.retryAction === null &&
  state.notice === null &&
  state.user === null;

ordinarySignedOut || bypassableBootError;
```

- [ ] **Step 6: Add the More-page Sign out test**

```ts
function createCoordinatorStub(
  overrides: Partial<MobileAuthCoordinator> = {},
): MobileAuthCoordinator {
  return {
    state: authenticatedState,
    initialize: vi.fn().mockResolvedValue(undefined),
    startSignIn: vi.fn().mockResolvedValue(undefined),
    completeCallback: vi.fn().mockResolvedValue(undefined),
    retryCurrentOperation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

it('calls the mobile coordinator once and exposes progress', async () => {
  const signOut = deferred<void>();
  const coordinator = createCoordinatorStub({
    state: authenticatedState,
    signOut: vi.fn(() => signOut.promise),
  });
  const wrapper = mount(MorePage, {
    global: {
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
      },
      stubs: {
        DevelopmentDiagnosticsEntry: true,
      },
    },
  });

  const button = wrapper.get('[aria-label="Sign out of Vela"]');
  await button.trigger('click');
  expect(button.attributes('disabled')).toBeDefined();
  expect(coordinator.signOut).toHaveBeenCalledOnce();
  signOut.resolve();
  await flushPromises();
});
```

- [ ] **Step 7: Implement the More-page button**

Inject `MOBILE_AUTH_KEY`, require it as `MobileAuthGate` does, and add:

```vue
<q-btn
  aria-label="Sign out of Vela"
  color="negative"
  outline
  :loading="signOutPending"
  :disable="signOutPending"
  label="Sign out"
  @click="handleSignOut"
/>
```

Use a local duplicate-click guard:

```ts
async function handleSignOut(): Promise<void> {
  if (signOutPending.value) return;
  signOutPending.value = true;
  try {
    await coordinator.signOut();
  } finally {
    signOutPending.value = false;
  }
}
```

The handler calls only `coordinator.signOut()`. The gate owns all post-sign-out
routing and surface behavior.

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bunx vitest run \
  src/components/mobile/mobile-auth-gate-view.test.ts \
  src/components/mobile/MobileAuthGate.test.ts \
  src/pages/MorePage.test.ts \
  src/App.test.ts
rtk bun run typecheck
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.ts \
  apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.vue \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts \
  apps/vela-mobile/src/pages/MorePage.vue \
  apps/vela-mobile/src/pages/MorePage.test.ts \
  apps/vela-mobile/src/App.test.ts
rtk git commit -m "feat(mobile): add session recovery and sign-out UI"
```

Expected: selector, component, page, and App suites PASS; typecheck PASS.

---

### Task 10: Close Security Regressions and Run the Full Verification Ladder

**Files:**

- Modify:
  `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/boot/mobile-auth.test.ts`
- Modify:
  `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify only if generated sync requires it:
  `apps/vela-mobile/src-capacitor/ios/App/Podfile.lock`

**Interfaces:**

- No new production interface.
- Produces whole-feature leakage, relaunch, uninstall-reset, and regression
  evidence.

- [ ] **Step 1: Add the cross-boundary sentinel test**

```ts
const SECRET_SENTINELS = [
  'SECRET-access-token',
  'SECRET-id-token',
  'SECRET-refresh-token',
  'SECRET-rotated-refresh-token',
] as const;

const LOG_AND_DOM_SENTINELS = [
  ...SECRET_SENTINELS,
  'SECRET-authorization-url',
  'SECRET-callback-code',
  'SECRET-code-verifier',
  'SECRET-nonce',
  'SECRET-claim-email',
] as const;

function searchable(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function storageSnapshot(storage: Storage): string {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? '';
    return `${key}=${storage.getItem(key) ?? ''}`;
  }).join('\n');
}

function expectNoSecretLeak(input: {
  consoleCalls: unknown[][];
  preferenceCalls: unknown[][];
  renderedText?: string;
}): void {
  const logsAndDom = [
    searchable(input.consoleCalls),
    input.renderedText ?? document.body.textContent ?? '',
  ].join('\n');
  const browserAndPreferenceStorage = [
    searchable(input.preferenceCalls),
    storageSnapshot(window.localStorage),
    storageSnapshot(window.sessionStorage),
  ].join('\n');

  for (const secret of LOG_AND_DOM_SENTINELS) {
    expect(logsAndDom).not.toContain(secret);
  }
  for (const secret of SECRET_SENTINELS) {
    expect(browserAndPreferenceStorage).not.toContain(secret);
  }
}
```

Use the sentinel values in separate callback success/failure, cold restore,
soft refresh, rotated-token save failure, API rejection, start over, cleanup
failure, and disposal tests. After each scenario, call `expectNoSecretLeak()`
with the captured `console.debug/info/warn/error` calls, the Preferences
`set()` calls, and the mounted gate text when that scenario renders UI. Keep
the scenarios separate so a failure identifies the leaking boundary. The PKCE
verifier and nonce remain allowed only inside the token-free Preferences
transaction, never in logs or DOM.

- [ ] **Step 2: Add simulated relaunch and reinstall tests**

```ts
class FakeSessionStore implements MobileSessionStore {
  clearFailure: unknown;

  constructor(public value: string | null) {}

  readonly loadRefreshToken = vi.fn(async () => this.value);
  readonly saveRefreshToken = vi.fn(async (value: string) => {
    this.value = value;
  });
  readonly clearRefreshToken = vi.fn(async () => {
    if (this.clearFailure) throw this.clearFailure;
    this.value = null;
  });
}

class FakeInstallationStore implements MobileInstallationStore {
  constructor(public marked: boolean) {}

  readonly isCurrentInstallationMarked = vi.fn(async () => this.marked);
  readonly markCurrentInstallation = vi.fn(async () => {
    this.marked = true;
  });
}

it('restores after process relaunch but clears on a new installation marker', async () => {
  const durableStore = new FakeSessionStore('refresh-token');
  const firstRelaunch = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(true),
  });
  prepareSuccessfulRefresh(firstRelaunch, { subject: 'user-123' });
  await firstRelaunch.coordinator.initialize();
  expect(firstRelaunch.coordinator.state.sessionUsable).toBe(true);

  const reinstalled = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(false),
  });
  await reinstalled.coordinator.initialize();
  expect(durableStore.clearRefreshToken).toHaveBeenCalled();
  expect(reinstalled.coordinator.state.phase).toBe('signedOut');
  expect(reinstalled.coordinator.state.sessionUsable).toBe(false);
});

it('keeps successful local sign-out durable across relaunch', async () => {
  const durableStore = new FakeSessionStore('refresh-token');
  const first = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(true),
  });
  prepareSuccessfulRefresh(first);
  await first.coordinator.initialize();
  await first.coordinator.signOut();

  const relaunched = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(true),
  });
  await relaunched.coordinator.initialize();
  expect(relaunched.coordinator.state.phase).toBe('signedOut');
  expect(relaunched.tokenTransport.requests).toHaveLength(0);
});

it('restores after relaunch when secure sign-out cleanup was incomplete', async () => {
  const durableStore = new FakeSessionStore('refresh-token');
  const first = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(true),
  });
  prepareSuccessfulRefresh(first);
  await first.coordinator.initialize();
  durableStore.clearFailure = new Error('SECRET-delete-failure');
  await first.coordinator.signOut();
  expect(first.coordinator.state.notice).toBe('cleanup_incomplete');

  durableStore.clearFailure = undefined;
  const relaunched = makeHarness({
    sessionStore: durableStore,
    installationStore: new FakeInstallationStore(true),
  });
  prepareSuccessfulRefresh(relaunched);
  await relaunched.coordinator.initialize();
  expect(relaunched.coordinator.state.sessionUsable).toBe(true);
});
```

These three cases are the simulated process-lifecycle contract; do not replace
the shared store between coordinator instances.

- [ ] **Step 3: Run the complete mobile unit suite**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bun run test:unit
```

Expected: all mobile unit and component tests PASS.

- [ ] **Step 4: Run coverage, typecheck, lint, and production build**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile
rtk bun run test:coverage
rtk bun run typecheck
rtk bun run lint
VITE_MOBILE_API_URL=https://example.invalid/api/ rtk bun run build
```

Expected:

- coverage command passes the configured 95% line threshold;
- typecheck and lint exit zero;
- the production build completes with mobile API URL validation active.

- [ ] **Step 5: Re-run native synchronization and inspect generated files**

```bash
cd /Users/chanwaichan/workspace/Vela/apps/vela-mobile/src-capacitor
rtk bunx cap sync ios
cd /Users/chanwaichan/workspace/Vela
rtk git diff --check
rtk git diff -- \
  apps/vela-mobile/src-capacitor/ios/App/Podfile.lock \
  apps/vela-mobile/src-capacitor/ios/App/PrivacyInfo.xcprivacy \
  apps/vela-mobile/src-capacitor/ios/App/App/Info.plist
```

Expected:

- sync exits zero;
- the Podfile lock contains the pinned plugin;
- `PrivacyInfo.xcprivacy` has no unreviewed required-reason change;
- the custom OAuth scheme in `Info.plist` is unchanged;
- `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Run relevant root regressions**

```bash
cd /Users/chanwaichan/workspace/Vela
rtk bun run test --filter=@vela/mobile
rtk bun run typecheck --filter=@vela/mobile
```

Expected: both filtered Turbo commands PASS.

- [ ] **Step 7: Commit the verification additions**

```bash
cd /Users/chanwaichan/workspace/Vela
rtk git add \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/boot/mobile-auth.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts \
  apps/vela-mobile/src-capacitor/ios/App/Podfile.lock
rtk git commit -m "test(mobile): verify secure session persistence"
```

If `Podfile.lock` has no final sync delta, omit it from `git add`.

- [ ] **Step 8: Record the interactive iOS closure gate**

Run the accepted design's Interactive iOS Acceptance sequence on the iOS
Simulator with a configured Cognito environment:

1. sign in and prove force-terminate/relaunch restoration;
2. uninstall without signing out, reinstall, and prove the former user does
   not restore;
3. invalidate the Cognito session with `admin-user-global-sign-out` and prove
   the terminal notice;
4. sign in again, use More → Sign out, relaunch, and prove signed-out
   persistence;
5. inspect device logs and WebView storage for credential leakage.

Record any missing Google/Cognito credentials or signing limitation as an open
closure gate. Do not replace the live-provider result with a mock-only claim.

## Final Whole-Branch Review

- [ ] Re-read every accepted decision and failure row in the design and map it
      to a task/test above.
- [ ] Run:

```bash
cd /Users/chanwaichan/workspace/Vela
rtk git diff main...HEAD --check
rtk git status --short
```

- [ ] Review `main...HEAD` for unrelated changes, secret-bearing fixtures,
      direct plugin calls outside `mobile-session-store.ts`, tokens written to
      Preferences/browser storage, and direct `Date.now()` calls in refresh logic.
- [ ] Run the full verification ladder from Task 10 once more after any review
      fix.
- [ ] Keep the branch and worktree available for the outstanding native
      interactive gate; do not merge automatically.
