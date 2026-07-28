# HPA-205: Mobile Google OAuth Sign-In and Deep-Link Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-out Vela iOS user complete Google OAuth through Cognito, return through the registered custom URL scheme on warm or cold app delivery, and render the mobile shell only after the existing API session endpoint verifies the mobile ID token.

**Architecture:** Add a mobile-owned OAuth protocol layer and serialized auth coordinator. The
coordinator uses Capacitor App and Browser adapters, persists only the short-lived PKCE
transaction through Capacitor Preferences, performs the Cognito token exchange through one
targeted `CapacitorHttp.request()` call, keeps tokens only in process memory, and hydrates its
user through `GET /api/auth/session`. A Vue auth gate protects the entire normal router tree
while retaining the existing development-only diagnostic bypass. CDK injects mobile Cognito
configuration, and the API verifier accepts distinct web and mobile audiences while the web
refresh route continues to use only the web client ID.

**Tech Stack:** Vue 3, Quasar, Capacitor 7 (`@capacitor/app`, `@capacitor/browser`,
`@capacitor/preferences`, `CapacitorHttp` from `@capacitor/core`), Web Crypto, Vitest, Hono,
`aws-jwt-verify`, AWS CDK, Bun

**Spec:** `docs/superpowers/specs/2026-07-27-mobile-google-oauth-deep-link-design.md`

## Global Constraints

- Preserve the web OAuth flow and its `COGNITO_CLIENT_ID` semantics.
- The mobile client is public: never add or send a client secret.
- Use the exact RFC 8252 callback `dev.cwchanap.vela.oauth:/oauth/callback`.
- Route Cognito directly to Google with `identity_provider=Google`.
- Generate a 32-byte PKCE verifier, state, and nonce with Web Crypto; never use a deterministic
  or JavaScript-hash fallback.
- Fail with `configuration_error` before transaction creation when the origin is not a secure
  context or Web Crypto S256 is unavailable. LAN-IP HTTP live reload is not an OAuth-supported
  physical-device setup; a bundled Debug build remains supported.
- Keep the OAuth transaction in one namespaced Capacitor Preferences entry for at most ten
  minutes; never store tokens there.
- Use targeted `CapacitorHttp.request()` only for the Cognito token exchange. Do not enable
  global fetch/XHR patching or add a community HTTP plugin; keep `/api/auth/session` on fetch.
- Keep access, ID, and optional refresh tokens in process memory only. HPA-206 owns Keychain persistence, refresh, restore, and sign-out.
- Do not expose a public token getter or authenticated-request helper in HPA-205.
- Treat `GET /api/auth/session` as the signature-verification and authenticated-user boundary.
- Never log or render authorization URLs, callbacks, codes, verifiers, challenges, state, nonce, tokens, decoded claims, or third-party verifier error objects.
- Keep the existing `capacitor-lifecycle` diagnostic listener separate.
- Treat compile-time diagnostic route exclusion as the primary production guarantee. The gate
  additionally requires `import.meta.env.DEV`, explicit bypass metadata, and an allowed stable
  auth phase.
- Preserve HPA-204's production fail-fast behavior for malformed mobile build configuration.
- Production build-config errors throw before the gate. Development config errors and
  runtime capability/plugin failures use the rendered `configuration_error` state.
- After successful verification, replace the route with `/`; do not implement signed-out
  return-to/deep-link restoration.
- Do not add proactive token refresh or a mid-session expiry timer; HPA-206 owns that behavior.
- Keep mobile Vitest line coverage at or above the existing 95% gate.
- Run every repository command through `rtk`.

## File and Responsibility Map

### New files

- `apps/vela-mobile/src/auth/mobile-auth-contract.ts` — callback/storage constants and auth/OAuth types.
- `apps/vela-mobile/src/auth/mobile-oauth.ts` — pure PKCE, URL, callback, token-request, and ID-claim helpers.
- `apps/vela-mobile/src/auth/mobile-oauth.test.ts` — protocol and claim-validation matrix.
- `apps/vela-mobile/src/auth/oauth-transaction-store.ts` — validated ten-minute transaction storage.
- `apps/vela-mobile/src/auth/oauth-transaction-store.test.ts` — missing/corrupt/fresh/stale/replaced storage tests.
- `apps/vela-mobile/src/services/mobile-auth.ts` — serialized coordinator, in-memory token session, and dependency ports.
- `apps/vela-mobile/src/services/mobile-auth.test.ts` — warm/cold, race, cleanup, verification, and secret-log tests.
- `apps/vela-mobile/src/boot/mobile-auth.ts` — production App/Browser/Preferences/CapacitorHttp/Web Crypto/fetch adapters and Vue injection.
- `apps/vela-mobile/src/boot/mobile-auth.test.ts` — adapter wiring and asynchronous initialization tests.
- `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue` — full-app gate UI.
- `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts` — phase, action, accessibility, and bypass tests.
- `apps/vela-mobile/src-capacitor/ios/App/PrivacyInfo.xcprivacy` — required UserDefaults
  accessed-API declaration for Capacitor Preferences.
- `apps/vela-mobile/src/ios/privacy-manifest.test.ts` — privacy category/reason and Xcode-target
  contract.

### Modified files

- `apps/vela-mobile/src/config/index.ts`, `index.test.ts`, `env.d.ts` — mobile Cognito config and runtime validation.
- `apps/vela-mobile/build/validate-mobile-api-url.ts`, `.test.ts` — production build validation for all five mobile values while retaining the existing plugin entry point.
- `apps/vela-mobile/.env.example`, `turbo.json`, `.github/workflows/build-lint.yml` — documentation and build env allowlists/placeholders.
- `packages/cdk/scripts/inject-env.ts`, `packages/cdk/test/inject-env.test.ts` — production mobile env generation.
- `apps/vela-api/src/types.ts`, `env.ts`, `index.ts`, `middleware/auth.ts` — separate optional mobile audience.
- `apps/vela-api/test/env.test.ts`, `middleware/auth.test.ts`, `routes/auth.test.ts` — audience, safe logging, and web-refresh regression tests.
- `apps/vela-api/.env.example` — local mobile audience documentation.
- `packages/cdk/lib/api-stack.ts`, `packages/cdk/test/api-stack.test.ts` — Lambda mobile client ID.
- `apps/vela-mobile/src-capacitor/package.json`, `bun.lock`, `ios/App/Podfile`,
  `ios/App/Podfile.lock`, and `ios/App/App.xcodeproj/project.pbxproj` — Browser/Preferences
  dependency, native sync, and privacy-manifest target outputs.
- `apps/vela-mobile/quasar.config.ts`, `apps/vela-mobile/vitest.config.ts` — Browser and
  Preferences plugin resolution; global Capacitor HTTP patching stays disabled.
- `apps/vela-mobile/src/boot/boot-files.ts`, `.test.ts` — auth boot ordering.
- `apps/vela-mobile/src/ios/capacitor-plugins.test.ts`, `info-plist.test.ts` — native dependency and shared callback contract.
- `apps/vela-mobile/src/App.vue`, `App.test.ts` — gate around `router-view`.
- `apps/vela-mobile/src/router/diagnostic-routes.ts`, `.test.ts`, `mobile-route-meta.d.ts` — explicit development-only bypass metadata.

---

### Task 1: Define and validate the mobile Cognito build contract

**Files:**

- Create: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/config/index.ts`
- Modify: `apps/vela-mobile/src/config/index.test.ts`
- Modify: `apps/vela-mobile/src/env.d.ts`
- Modify: `apps/vela-mobile/build/validate-mobile-api-url.ts`
- Modify: `apps/vela-mobile/build/validate-mobile-api-url.test.ts`
- Modify: `apps/vela-mobile/.env.example`

**Interfaces:**

```ts
export const MOBILE_OAUTH_CALLBACK_URI = 'dev.cwchanap.vela.oauth:/oauth/callback';
export const MOBILE_OAUTH_SCHEME = 'dev.cwchanap.vela.oauth:';
export const MOBILE_OAUTH_TRANSACTION_KEY = 'vela:mobile:oauth-transaction';
export const MOBILE_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export type MobileOAuthConfig = {
  apiUrl: string;
  userPoolId: string;
  mobileClientId: string;
  oauthDomain: string;
  region: string;
  callbackUri: typeof MOBILE_OAUTH_CALLBACK_URI;
};
```

`config.auth` produces those values. The existing `validate-mobile-api-url` plugin remains the Quasar entry point but validates the complete production contract.

- [ ] **Step 1: Add failing runtime-config tests**

Extend `src/config/index.test.ts` with table-driven cases that prove:

- `config.auth` reads `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID`, `VITE_COGNITO_OAUTH_DOMAIN`, and `VITE_AWS_REGION`;
- `callbackUri` is the source constant, not an env value;
- every missing production value throws;
- equivalent development omissions warn without throwing so the coordinator can surface
  `configuration_error`;
- production API URLs must be absolute HTTPS;
- OAuth domains reject a scheme, path, query, fragment, credentials, and port;
- pool/client IDs reject whitespace; and
- the user-pool prefix must equal the configured region.

Use one valid baseline and override one field per case:

```ts
const validProductionEnv = {
  PROD: true,
  VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_example',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'mobileclient123',
  VITE_COGNITO_OAUTH_DOMAIN: 'vela.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};
```

- [ ] **Step 2: Add failing build-validator tests**

In `build/validate-mobile-api-url.test.ts`, retain all HPA-204 cases and add the same Cognito matrix. Also prove the plugin loads mode-specific `.env` values and lets explicit `process.env` values win for each new key.

- [ ] **Step 3: Run the focused tests and confirm the new cases fail**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/config/index.test.ts build/validate-mobile-api-url.test.ts
```

Expected: FAIL because `config.auth` and complete mobile build validation do not exist.

- [ ] **Step 4: Add constants, types, and Vite declarations**

Create `mobile-auth-contract.ts` with the interfaces above. Add these declarations to `src/env.d.ts`:

```ts
readonly VITE_COGNITO_USER_POOL_ID: string;
readonly VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: string;
readonly VITE_COGNITO_OAUTH_DOMAIN: string;
readonly VITE_AWS_REGION: string;
```

- [ ] **Step 5: Extend runtime config without weakening HPA-204**

Add:

```ts
auth: {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  mobileClientId: import.meta.env.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID || '',
  oauthDomain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN || '',
  region: import.meta.env.VITE_AWS_REGION || '',
  callbackUri: MOBILE_OAUTH_CALLBACK_URI,
},
```

Refactor validation into small pure predicates. Production validation must throw; development may warn and continue. Validate a host-only domain by parsing `https://${value}` and requiring empty username/password/port/search/hash, pathname `/`, and a hostname equal to the input case-insensitively. Split the pool ID at the first `_` and require the prefix to equal `VITE_AWS_REGION`.

- [ ] **Step 6: Extend the existing build plugin**

Keep the filename, plugin export, and `MOBILE_SKIP_ENV_VALIDATION` behavior. Add a `loadMobileBuildEnv(mode, root, processEnv)` helper that loads all five keys and a `validateMobileBuildEnv(env)` helper that applies the production rules. The plugin's `configResolved` hook must call the complete validator in production.

- [ ] **Step 7: Document all values**

Add non-secret examples to `apps/vela-mobile/.env.example`, explicitly noting that the callback URI is a source constant and that `.env.production` is generated by CDK.

- [ ] **Step 8: Run focused tests and coverage**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/config/index.test.ts build/validate-mobile-api-url.test.ts --coverage
```

Expected: PASS; changed config/build files meet the 95% line gate.

- [ ] **Step 9: Commit**

```bash
rtk git add apps/vela-mobile/src/auth/mobile-auth-contract.ts apps/vela-mobile/src/config apps/vela-mobile/src/env.d.ts apps/vela-mobile/build apps/vela-mobile/.env.example
rtk git commit -m "feat(mobile): validate Cognito OAuth config"
```

---

### Task 2: Inject and allowlist mobile Cognito build values

**Files:**

- Modify: `packages/cdk/scripts/inject-env.ts`
- Modify: `packages/cdk/test/inject-env.test.ts`
- Modify: `turbo.json`
- Modify: `.github/workflows/build-lint.yml`

**Interfaces:**

`inject-env.ts` writes exactly these mobile lines:

```dotenv
VITE_MOBILE_API_URL=<MobileApiURL>
VITE_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=<CognitoMobileUserPoolClientId>
VITE_COGNITO_OAUTH_DOMAIN=<resolved Cognito OAuth domain>
VITE_AWS_REGION=<resolved Cognito region>
```

Use the current output keys and existing domain/environment precedence; do not derive or substitute the web client ID.

- [ ] **Step 1: Add failing env-generation tests**

Add `CognitoMobileUserPoolClientId` to `BASE_OUTPUTS`, assert all five generated mobile lines,
and add a case that removes only the mobile output and expects a generation error before
either env file is written. Retain the current website-domain/API precedence cases unchanged.
Add explicit cases for the existing region precedence
`VITE_AWS_REGION -> CognitoRegion -> AWS_REGION -> us-east-1` and the existing
output-or-derived OAuth-domain fallback.

- [ ] **Step 2: Run the focused CDK script tests and confirm failure**

Run:

```bash
cd packages/cdk
rtk bun test test/inject-env.test.ts
```

Expected: FAIL because the generated mobile env contains only `VITE_MOBILE_API_URL`.

- [ ] **Step 3: Extend mobile env generation**

Require the new `CognitoMobileUserPoolClientId` output and reuse the existing pool-ID
requirement. Resolve region and OAuth domain through their existing fallbacks, then validate
the resolved values. Do not turn `CognitoRegion` or `CognitoOAuthDomain` into newly required
raw outputs. Keep the web `.env.production` output byte-for-byte compatible apart from
unrelated timestamp/temp paths in tests.

- [ ] **Step 4: Update Turbo and PR CI**

Add only `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID` to the root `build.env` allowlist; the API
URL, region, pool ID, and OAuth domain are already present. In the mobile production-build
workflow step, supply:

```yaml
VITE_MOBILE_API_URL: https://example.invalid/api/
VITE_COGNITO_USER_POOL_ID: us-east-1_ciPlaceholder
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: ci-mobile-client-id
VITE_COGNITO_OAUTH_DOMAIN: ci-placeholder.auth.us-east-1.amazoncognito.com
VITE_AWS_REGION: us-east-1
```

Do not set `MOBILE_SKIP_ENV_VALIDATION`; CI must exercise the real validation path.

- [ ] **Step 5: Run focused tests and a validated production build**

Run:

```bash
cd packages/cdk
rtk bun test test/inject-env.test.ts

cd ../../apps/vela-mobile
VITE_MOBILE_API_URL=https://example.invalid/api/ \
VITE_COGNITO_USER_POOL_ID=us-east-1_ciPlaceholder \
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=ci-mobile-client-id \
VITE_COGNITO_OAUTH_DOMAIN=ci-placeholder.auth.us-east-1.amazoncognito.com \
VITE_AWS_REGION=us-east-1 \
rtk bun run build
```

Expected: PASS; build validation is not bypassed.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/cdk/scripts/inject-env.ts packages/cdk/test/inject-env.test.ts turbo.json .github/workflows/build-lint.yml
rtk git commit -m "build(mobile): inject OAuth environment"
```

---

### Task 3: Accept the mobile audience without changing web refresh

**Files:**

- Modify: `apps/vela-api/src/types.ts`
- Modify: `apps/vela-api/src/env.ts`
- Modify: `apps/vela-api/src/index.ts`
- Modify: `apps/vela-api/src/middleware/auth.ts`
- Modify: `apps/vela-api/test/env.test.ts`
- Modify: `apps/vela-api/test/middleware/auth.test.ts`
- Modify: `apps/vela-api/test/routes/auth.test.ts`
- Modify: `apps/vela-api/.env.example`
- Modify: `packages/cdk/lib/api-stack.ts`
- Modify: `packages/cdk/test/api-stack.test.ts`

**Interfaces:**

```ts
initializeAuthVerifier(
  userPoolId: string,
  webClientId: string,
  mobileClientId?: string,
): void;
```

The verifier receives:

```ts
clientId: mobileClientId ? [webClientId, mobileClientId] : webClientId;
```

The refresh route continues to read one `COGNITO_CLIENT_ID`.

- [ ] **Step 1: Add failing API env/audience tests**

Add tests that:

- `buildEnv()` returns `COGNITO_MOBILE_CLIENT_ID`;
- the verifier factory receives `[webClientId, mobileClientId]` when both exist;
- the verifier factory receives the web string and emits one safe warning when mobile is absent;
- a protected request can be verified after either audience config path; and
- `index.ts` passes the optional mobile value as a distinct third initializer argument.

For the last contract, extract a small exported `initializeAuthFromEnv(env)` helper if importing `index.ts` would start the Bun/Lambda entry point; call that helper from `index.ts` and test it directly.

- [ ] **Step 2: Add the secret-bearing verifier regression test**

Reject `verify()` with an object containing sentinel values in its name, message, `rawJwt`,
and nested claims. Spy on `console.error` and prove the complete object, message, and every
secret sentinel are absent from all arguments. Production logs only the stable category.
Development may additionally log a bounded/sanitized error name, otherwise
`UnknownVerificationError`:

```ts
console.error('Token verification failed');

// Development only:
console.error('Token verification failed', safeVerificationErrorName(error));
```

- [ ] **Step 3: Add the web-refresh regression test**

Set different `COGNITO_CLIENT_ID` and `COGNITO_MOBILE_CLIENT_ID` values in `routes/auth.test.ts`; invoke refresh and assert `InitiateAuthCommand` still receives only the web value as `ClientId`.

- [ ] **Step 4: Add failing CDK Lambda-env tests**

Assert the synthesized Lambda environment contains separate `COGNITO_CLIENT_ID` and `COGNITO_MOBILE_CLIENT_ID` references and does not concatenate them.

- [ ] **Step 5: Run focused tests and confirm failure**

Run:

```bash
cd apps/vela-api
rtk bun test test/env.test.ts test/middleware/auth.test.ts test/routes/auth.test.ts

cd ../../packages/cdk
rtk bun test test/api-stack.test.ts
```

Expected: FAIL on the missing mobile env/audience wiring and unsafe verifier log.

- [ ] **Step 6: Implement API wiring**

Add `COGNITO_MOBILE_CLIENT_ID?: string` to `Env`, populate it in `buildEnv()`, pass it
separately from `index.ts`, widen the verifier client type to `string | string[]`, and sanitize
the catch log exactly as tested. `safeVerificationErrorName()` must never return an arbitrary
message/value from the error object. Keep missing mobile configuration non-fatal in local
development.

- [ ] **Step 7: Implement CDK wiring and documentation**

Add:

```ts
COGNITO_MOBILE_CLIENT_ID: auth.mobileUserPoolClient.userPoolClientId,
```

to the Lambda environment and document the optional local value in `apps/vela-api/.env.example`.

- [ ] **Step 8: Run focused tests and compile**

Run:

```bash
cd apps/vela-api
rtk bun test test/env.test.ts test/middleware/auth.test.ts test/routes/auth.test.ts
rtk bun run compile

cd ../../packages/cdk
rtk bun test test/api-stack.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add apps/vela-api/src apps/vela-api/test apps/vela-api/.env.example packages/cdk/lib/api-stack.ts packages/cdk/test/api-stack.test.ts
rtk git commit -m "feat(api): accept mobile Cognito audience"
```

---

### Task 4: Implement pure OAuth and token-validation primitives

**Files:**

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Create: `apps/vela-mobile/src/auth/mobile-oauth.ts`
- Create: `apps/vela-mobile/src/auth/mobile-oauth.test.ts`

**Interfaces:**

```ts
export type OAuthTransaction = {
  state: string;
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};

export type OAuthTokenBundle = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type ParsedOAuthCallback =
  | { kind: 'unrelated' }
  | { kind: 'success'; code: string; state: string }
  | { kind: 'providerError'; error: 'access_denied' | 'other'; state: string }
  | { kind: 'malformed' };

export type MobileTokenRequest = {
  url: string;
  method: 'POST';
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' };
  data: string;
};

export function hasOAuthCryptoCapabilities(
  crypto: Crypto | undefined,
  isSecureContext: boolean,
): crypto is Crypto;
export function createOAuthTransaction(crypto: Crypto, now: number): OAuthTransaction;
export function createPkceChallenge(verifier: string, crypto: Crypto): Promise<string>;
export function buildAuthorizationUrl(
  config: MobileOAuthConfig,
  transaction: OAuthTransaction,
  challenge: string,
): string;
export function parseOAuthCallback(rawUrl: string): ParsedOAuthCallback;
export function buildTokenRequest(
  config: MobileOAuthConfig,
  transaction: OAuthTransaction,
  code: string,
): MobileTokenRequest;
export function parseTokenResponse(value: unknown, now: number): OAuthTokenBundle;
export function validateIdTokenClaims(
  idToken: string,
  expected: { config: MobileOAuthConfig; transaction: OAuthTransaction; now: number },
): void;
```

- [ ] **Step 1: Write PKCE and randomness tests**

Use the RFC 7636 verifier/challenge vector. Assert 32 random bytes produce 43-character
unpadded base64url state, nonce, and verifier values, all use URL-safe characters, and
consecutive transactions differ. Prove missing `isSecureContext`, `getRandomValues`, or
`subtle.digest` fails the capability check; do not add `Math.random()` or JavaScript SHA-256
fallbacks.

- [ ] **Step 2: Write exact authorization/token-request tests**

Parse the returned URLs/body rather than comparing query ordering. Assert authorization has exactly:

```text
client_id, response_type=code, redirect_uri, scope=openid email profile,
identity_provider=Google, state, code_challenge, code_challenge_method=S256, nonce
```

Assert the token request targets `https://<domain>/oauth2/token`, produces the targeted
native-transport shape above, uses `POST` and `application/x-www-form-urlencoded`, and
contains only:

```text
grant_type=authorization_code
client_id
code
redirect_uri
code_verifier
```

Explicitly assert `client_secret` is absent.
Assert the same `MOBILE_OAUTH_CALLBACK_URI` constant supplies `redirect_uri` in authorization
and token requests, and `identity_provider` is the Cognito provider name string `Google`.

- [ ] **Step 3: Write the callback parser matrix**

Use the WHATWG `URL` API and a fixed vector table. Cover the exact single-slash callback;
double-slash/authority, trailing-path, port, credentials, and fragment violations; query-order
independence; `+` and `%20`; missing, blank, and duplicate `code`, `state`, and `error`; both
`code` and `error`; `access_denied`; other provider errors; and unrelated HTTP/other-scheme
URLs. Require the exact protocol, empty host/authority/credentials/port, and exact pathname;
never normalize a rejected form into the accepted callback. Only exact same-scheme
`/oauth/callback` URLs are candidates; unrelated URLs return `kind: 'unrelated'`.

- [ ] **Step 4: Write token and ID-claim tests**

Create unsigned test JWT strings only for client-side claim parsing. Cover malformed JWT/JSON,
missing token fields, `token_use !== 'id'`, non-string/array/wrong audience, wrong issuer,
missing/non-finite expiry, expiry outside and inside the 60-second skew window, wrong nonce,
and valid optional refresh token. Require `aud` to be the exact mobile client-ID string;
arrays are rejected. Expected issuer:

```ts
`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
```

Accept expiry only when `exp * 1000 + 60_000 > now`. Test the exact boundary. Do not treat
these client checks as signature verification and do not add `jose`; the API remains the trust
boundary.

- [ ] **Step 5: Run tests and confirm failure**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth/mobile-oauth.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 6: Implement the pure helpers**

Use `crypto.getRandomValues`, `crypto.subtle.digest('SHA-256', encodedVerifier)`, `URL`,
`URLSearchParams`, and strict record/field guards. Build the token body as a serialized string
accepted by native `CapacitorHttp.request()`, not a `RequestInit`. Return stable result kinds;
never attach raw callback/token/claim values to thrown errors.

- [ ] **Step 7: Run tests and coverage**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth/mobile-oauth.test.ts --coverage
```

Expected: PASS with at least 95% line coverage for the new files.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/vela-mobile/src/auth/mobile-auth-contract.ts apps/vela-mobile/src/auth/mobile-oauth.ts apps/vela-mobile/src/auth/mobile-oauth.test.ts
rtk git commit -m "feat(mobile): add OAuth PKCE primitives"
```

---

### Task 5: Implement the transient OAuth transaction store

**Files:**

- Create: `apps/vela-mobile/src/auth/oauth-transaction-store.ts`
- Create: `apps/vela-mobile/src/auth/oauth-transaction-store.test.ts`

**Interfaces:**

```ts
export type LoadedOAuthTransaction =
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'expired' }
  | { kind: 'active'; transaction: OAuthTransaction };

export type OAuthTransactionStore = {
  replace(transaction: OAuthTransaction): Promise<void>;
  load(): Promise<LoadedOAuthTransaction>;
  clear(): Promise<void>;
};

export type OAuthTransactionPreferences = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

export function createOAuthTransactionStore(
  preferences: OAuthTransactionPreferences,
  now: () => number,
): OAuthTransactionStore;
```

- [ ] **Step 1: Write storage tests**

Use a fake async Preferences adapter. Prove missing, corrupt JSON, wrong field types,
non-finite/future timestamps, exactly-at-TTL expiry, fresh load, awaited
remove-before-replacement, and clear behavior. Corrupt/stale entries must be removed.
`replace()` must await removal of the prior entry before setting the new JSON. Assert the
serialized entry contains only state, verifier, nonce, and timestamp—never code or tokens.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth/oauth-transaction-store.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Call `Preferences.get/set/remove` only through the injected adapter, validate all four fields,
and calculate age with `MOBILE_OAUTH_TRANSACTION_TTL_MS`. Never store a code or token. Return
`expired` before any caller can collapse it into a generic interrupted result. Do not use
Quasar `LocalStorage` or `window.localStorage`.

- [ ] **Step 4: Run tests and coverage**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth/oauth-transaction-store.test.ts --coverage
```

Expected: PASS with at least 95% line coverage.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/vela-mobile/src/auth/oauth-transaction-store.ts apps/vela-mobile/src/auth/oauth-transaction-store.test.ts
rtk git commit -m "feat(mobile): store transient OAuth transaction"
```

---

### Task 6: Implement the serialized mobile auth coordinator

**Files:**

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Create: `apps/vela-mobile/src/services/mobile-auth.ts`
- Create: `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**

```ts
export type MobileAuthPhase =
  | 'initializing'
  | 'signedOut'
  | 'openingBrowser'
  | 'awaitingCallback'
  | 'exchangingCode'
  | 'verifyingSession'
  | 'authenticated'
  | 'error';

export type MobileAuthErrorCode =
  | 'configuration_error'
  | 'browser_launch_failed'
  | 'cancelled'
  | 'interrupted'
  | 'transaction_expired'
  | 'malformed_callback'
  | 'state_mismatch'
  | 'provider_error'
  | 'code_exchange_failed'
  | 'token_validation_failed'
  | 'session_unauthorized'
  | 'session_verification_failed';

export type MobileAppAdapter = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  getLaunchUrl(): Promise<{ url: string } | undefined>;
};

export type MobileBrowserAdapter = {
  addListener(
    eventName: 'browserFinished',
    listener: () => void,
  ): Promise<{ remove(): Promise<void> }>;
  open(options: { url: string }): Promise<void>;
  close(): Promise<void>;
};

export type MobileTokenTransportAdapter = {
  request(options: MobileTokenRequest): Promise<{ status: number; data: unknown }>;
};

export type MobileAuthCoordinator = {
  state: Readonly<MobileAuthState>;
  initialize(): Promise<void>;
  startSignIn(): Promise<void>;
  completeCallback(url: string): Promise<void>;
  retrySessionVerification(): Promise<void>;
  dispose(): Promise<void>;
};
```

Dependencies include the app/browser adapters, async transaction store, targeted token
transport, `Crypto`, `isSecureContext`, session `fetch`, `now`, and `MobileOAuthConfig`.
Tokens remain private to the coordinator; the interface above is the complete public surface.
Export an `InjectionKey<MobileAuthCoordinator>` for the boot/UI boundary.

- [ ] **Step 1: Build the deterministic test harness**

Create fake listener registries, controllable promises, an async Preferences-backed
transaction store, deterministic clock/crypto, native token-transport responses, and session
fetch responses. Add a state snapshot helper that never serializes internal token fields.

- [ ] **Step 2: Write startup/listener tests**

Cover:

- app URL listener registered first;
- browser-finished listener registered second;
- only then `getLaunchUrl()`;
- no transaction -> `signedOut`;
- expired transaction -> clear and `transaction_expired`;
- corrupt transaction -> clear and `interrupted`;
- fresh transaction without callback -> `interrupted` without clearing it;
- a late `appUrlOpen` after that interrupted state can still complete the retained transaction;
- cold callback calls the same completion path as a warm event;
- unexpected warm URL is ignored; and
- listener registration/get-launch failure exits `initializing` through a safe error; and
- production-invalid config is assumed to have thrown before coordinator creation, while
  development-invalid config and runtime plugin/capability failures become
  `configuration_error`.

- [ ] **Step 3: Write start/cancellation/race tests**

Cover:

- missing secure context or `crypto.subtle` produces `configuration_error` without
  persistence or browser launch;
- await Preferences persistence before `Browser.open`;
- exact authorization URL is passed but never logged;
- duplicate starts are rejected by phase after serialization;
- browser launch failure clears the transaction;
- browser dismissal only cancels while `awaitingCallback` and clears the transaction;
- a development dismissal before callback emits only the stable
  `browser_closed_before_callback` category and no URL/config values;
- callback changes phase before best-effort `Browser.close`;
- close-triggered `browserFinished` cannot overwrite callback progress; and
- a callback arriving while start is finishing is queued, not dropped.

- [ ] **Step 4: Write completion/cleanup tests**

Cover malformed callback, missing/corrupt/expired transaction, state mismatch before
provider/error handling, provider cancellation, provider failure, targeted native
token-transport rejection/status/data/parse/shape failures, claim failures, and success.
Every terminal pre-session outcome clears the transaction except the intentionally
non-terminal fresh `interrupted` startup state. Prove the token request uses the injected
native port, not session `fetch`, and that the Vela session endpoint still uses fetch. A
duplicate callback after authentication is ignored.

- [ ] **Step 5: Write session-verification tests**

Assert:

- the URL join produces `/api/auth/session` whether the API base has a trailing slash or not;
- the ID token sentinel is sent as `Authorization: Bearer test-id-token`;
- only `{ authenticated: true, user: { userId, email } }` authenticates;
- 401/403 clears the in-memory bundle and offers restart;
- other HTTP failures, fetch rejection, parse failure, and invalid response shape retain the bundle and offer verification retry; and
- retry verification does not call the token endpoint again.

- [ ] **Step 6: Write concurrency, reset, and no-secret tests**

Use delayed promises to prove start-vs-completion and completion-vs-completion serialization.
`dispose()` removes both listeners and clears in-memory coordinator/token state, but does not
erase a valid persisted transaction that exists specifically to survive process loss.
Test-reset code clears the fake store separately. Spy on all console methods with sentinel
callback/code/verifier/token/claim values and assert no sentinel appears.

- [ ] **Step 7: Run tests and confirm failure**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/services/mobile-auth.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 8: Implement a queue-based operation guard**

Use a promise tail, not a drop-on-busy boolean:

```ts
let operationTail = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
```

Run initialization itself through this guard. Listener callbacks call the public serialized methods; cold-launch handling inside initialization calls a private unlocked completion method to avoid self-deadlock. The guard ends after `Browser.open()` returns and never stays held while the browser is awaiting user action.

- [ ] **Step 9: Implement state/error and cleanup rules**

Store the token bundle only in a closure. Set a loading phase before browser-close/network
awaits. Clear the transaction immediately after a validated token bundle/nonce and before
session verification. Retain a fresh transaction on interrupted startup. Map only stable error
codes into public state; never pass raw errors or response bodies through state. Do not add an
expiry timer, token getter, or authorized-fetch method.

- [ ] **Step 10: Run tests and coverage**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth src/services/mobile-auth.test.ts --coverage
```

Expected: PASS with at least 95% line coverage.

- [ ] **Step 11: Commit**

```bash
rtk git add apps/vela-mobile/src/auth/mobile-auth-contract.ts apps/vela-mobile/src/services/mobile-auth.ts apps/vela-mobile/src/services/mobile-auth.test.ts
rtk git commit -m "feat(mobile): coordinate OAuth callback session"
```

---

### Task 7: Wire Capacitor Browser, Preferences, native HTTP, and warm/cold delivery

**Files:**

- Modify: `apps/vela-mobile/src-capacitor/package.json`
- Modify: `apps/vela-mobile/src-capacitor/bun.lock`
- Modify if changed by sync: `apps/vela-mobile/src-capacitor/ios/App/Podfile`
- Modify if changed by sync: `apps/vela-mobile/src-capacitor/ios/App/Podfile.lock`
- Modify if changed by sync: `apps/vela-mobile/src-capacitor/ios/App/App.xcodeproj/project.pbxproj`
- Create: `apps/vela-mobile/src-capacitor/ios/App/PrivacyInfo.xcprivacy`
- Modify: `apps/vela-mobile/quasar.config.ts`
- Modify: `apps/vela-mobile/vitest.config.ts`
- Create: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Create: `apps/vela-mobile/src/boot/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.test.ts`
- Modify: `apps/vela-mobile/src/ios/capacitor-plugins.test.ts`
- Modify: `apps/vela-mobile/src/ios/info-plist.test.ts`
- Create: `apps/vela-mobile/src/ios/privacy-manifest.test.ts`

**Interfaces:**

The boot file creates the coordinator with real adapters, provides it through `MOBILE_AUTH_KEY`, and starts initialization without blocking Vue mount:

```ts
const coordinator = createMobileAuthCoordinator({
  app: CapacitorApp,
  browser: Browser,
  transactionStore: createOAuthTransactionStore(Preferences, Date.now),
  tokenTransport: {
    request: (options) => CapacitorHttp.request(options),
  },
  crypto: window.crypto,
  isSecureContext: window.isSecureContext,
  fetch: window.fetch.bind(window),
  now: Date.now,
  config: {
    apiUrl: config.api.url,
    userPoolId: config.auth.userPoolId,
    mobileClientId: config.auth.mobileClientId,
    oauthDomain: config.auth.oauthDomain,
    region: config.auth.region,
    callbackUri: config.auth.callbackUri,
  },
});

app.provide(MOBILE_AUTH_KEY, coordinator);
void coordinator.initialize();
```

Import `CapacitorHttp` from the already aliased `@capacitor/core`; do not enable its global
fetch/XHR patch in `capacitor.config.json`.

- [ ] **Step 1: Add Browser and Preferences dependencies and synchronize iOS**

Run:

```bash
cd apps/vela-mobile/src-capacitor
rtk bun add @capacitor/browser@^7.0.0 @capacitor/preferences@^7.0.0
rtk bunx cap sync ios
```

Expected: package/lock/native plugin metadata updates with Capacitor major 7.

- [ ] **Step 2: Add failing plugin/boot/native-contract tests**

Prove:

- `@capacitor/browser` and `@capacitor/preferences` resolve from
  `src-capacitor/node_modules`;
- both plugin majors match `@capacitor/core`;
- `CapacitorHttp.request` is imported from `@capacitor/core`, and
  `capacitor.config.json` does not enable the global fetch/XHR patch;
- `getMobileBootFiles()` puts `mobile-auth` immediately after `main` in every mode;
- the complete development Capacitor order is
  `main -> mobile-auth -> capacitor-lifecycle -> diagnostic-cold-entry`;
- the boot provides a coordinator and invokes initialization without awaiting it;
- the boot maps real App/Browser/Preferences/CapacitorHttp/Web Crypto/fetch/config
  dependencies;
- `Info.plist` registers the scheme used by `MOBILE_OAUTH_CALLBACK_URI`; and
- `PrivacyInfo.xcprivacy` is included in the iOS target and declares
  `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/boot/boot-files.test.ts src/boot/mobile-auth.test.ts src/ios/capacitor-plugins.test.ts src/ios/info-plist.test.ts src/ios/privacy-manifest.test.ts
```

Expected: FAIL on missing Browser/Preferences aliases, native contracts, and boot integration.

- [ ] **Step 4: Add Quasar and Vitest aliases**

Mirror the existing `@capacitor/app` alias:

```ts
'@capacitor/browser': resolveFromCapacitorPackage('@capacitor/browser'),
'@capacitor/preferences': resolveFromCapacitorPackage('@capacitor/preferences'),
```

Do not change the existing App/Core/Keyboard aliases.

- [ ] **Step 5: Add and order the auth boot**

Insert `mobile-auth` after `main` and before `capacitor-lifecycle`; keep
`diagnostic-cold-entry` last. Keep auth boot enabled in browser development so the full-app
gate always receives a coordinator. Production config failures have already thrown;
development config failures and missing runtime capabilities become the safe
`configuration_error` state. Initialization is fire-and-observe from the boot file so Vue can
mount its progress UI, but the gate does not render diagnostic content during
`initializing` or active OAuth callback phases.

- [ ] **Step 6: Run focused tests and native sync verification**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/boot/boot-files.test.ts src/boot/mobile-auth.test.ts src/ios/capacitor-plugins.test.ts src/ios/info-plist.test.ts src/ios/privacy-manifest.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Stage only the dependency, native sync/privacy manifest, alias, boot, and contract-test
outputs:

```bash
rtk git add apps/vela-mobile/src-capacitor apps/vela-mobile/quasar.config.ts apps/vela-mobile/vitest.config.ts apps/vela-mobile/src/boot apps/vela-mobile/src/ios/capacitor-plugins.test.ts apps/vela-mobile/src/ios/info-plist.test.ts apps/vela-mobile/src/ios/privacy-manifest.test.ts
rtk git commit -m "feat(mobile): wire OAuth browser callbacks"
```

---

### Task 8: Protect the normal mobile shell with the auth gate

**Files:**

- Create: `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue`
- Create: `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`
- Modify: `apps/vela-mobile/src/App.vue`
- Rewrite: `apps/vela-mobile/src/App.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.test.ts`
- Modify: `apps/vela-mobile/src/router/mobile-route-meta.d.ts`

**Interfaces:**

```ts
declare module 'vue-router' {
  interface RouteMeta {
    bypassMobileAuth?: boolean;
  }
}
```

Authenticated content and the narrow development bypass use:

```ts
const diagnosticBypass =
  import.meta.env.DEV &&
  route.meta.bypassMobileAuth === true &&
  (state.phase === 'signedOut' ||
    (state.phase === 'error' && state.errorCode === 'configuration_error'));

const contentVisible = authenticatedLandingReady || diagnosticBypass;
```

- [ ] **Step 1: Add failing gate tests**

Provide fake coordinators through `MOBILE_AUTH_KEY`. Prove:

- `initializing` has `role="status"` and hides the slot;
- `signedOut` shows one **Continue with Google** button and hides the slot;
- opening, awaiting, exchanging, and verification states have distinct progress text;
- errors render an alert and only their allowed action;
- `session_verification_failed` calls `retrySessionVerification`;
- restartable errors call `startSignIn`;
- `configuration_error` has no retry loop;
- successful authentication calls `router.replace('/')` and does not expose the slot until
  that landing navigation settles;
- authenticated state then renders the slot at `/`;
- duplicate clicks while busy invoke no second action; and
- focus returns to the primary action/error heading after browser completion.

Add the complete diagnostic matrix:

- `initializing` and OAuth busy phases show auth progress, not diagnostics;
- signed-out diagnostics render;
- diagnostics remain usable for `configuration_error`;
- other auth errors remain visible instead of being hidden by diagnostic metadata;
- authenticated content renders normally; and
- the predicate still requires both `DEV` and explicit metadata.

- [ ] **Step 2: Rewrite the App test**

Replace the unconditional router-render assertion. Mount `App.vue` with a provided fake
coordinator and router; use a child mount sentinel to prove `MobileLayout`/tab content is not
merely CSS-hidden but genuinely unmounted until authentication and home replacement settle.
Do not preserve the signed-out route as a return target.

- [ ] **Step 3: Add failing router-bypass tests**

Extend the existing diagnostic-route tests rather than creating a duplicate suite. Assert
every development diagnostic route has `bypassMobileAuth: true`, core routes never do, and
production route generation contains no diagnostic routes or bypass metadata. This
compile-time exclusion is the primary guarantee; the gate predicate is the secondary guard.

- [ ] **Step 4: Run focused tests and confirm failure**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/components/mobile/MobileAuthGate.test.ts src/App.test.ts src/router/diagnostic-routes.test.ts src/router/routes.test.ts
```

Expected: FAIL because App still renders its router unconditionally.

- [ ] **Step 5: Implement the gate**

Use a single slot for protected content and derive the exact diagnostic predicate above from
`useRoute()`. Keep safe user copy in a code-to-message map; never render `Error.message`.
Disable actions whenever phase is not `signedOut`/the expected error state. Use
`role="status"` with `aria-live="polite"` for progress and `role="alert"` for errors. Watch
the first successful auth transition, keep the slot closed while
`router.replace('/')` settles, then expose content.

- [ ] **Step 6: Wrap App and add explicit bypass metadata**

`App.vue` becomes:

```vue
<template>
  <MobileAuthGate>
    <router-view />
  </MobileAuthGate>
</template>
```

Set `bypassMobileAuth: true` only on the development diagnostic records already conditionally
removed in production. Do not alter diagnostic staging/localStorage; OAuth Preferences uses a
separate key and storage adapter.

- [ ] **Step 7: Run focused tests, full mobile tests, lint, and typecheck**

Run:

```bash
cd apps/vela-mobile
rtk bun vitest run src/components/mobile/MobileAuthGate.test.ts src/App.test.ts src/router src/boot/diagnostic-cold-entry.test.ts
rtk bun run test:unit
rtk bun run lint
rtk bun run typecheck
```

Expected: PASS; no existing diagnostic/navigation behavior regresses.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/vela-mobile/src/components/mobile/MobileAuthGate.vue apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts apps/vela-mobile/src/App.vue apps/vela-mobile/src/App.test.ts apps/vela-mobile/src/router
rtk git commit -m "feat(mobile): gate shell on verified session"
```

---

### Task 9: Complete repository and iOS Simulator verification

**Files:**

- Modify only files required by a concrete failing check.
- Do not add token/callback screenshots or logs to the repository.

**Interfaces:**

This task proves the completed feature against the design and live HPA-205 acceptance criteria; it must not expand into HPA-206 persistence/refresh/sign-out.

- [ ] **Step 1: Run all focused mobile auth tests with coverage**

```bash
cd apps/vela-mobile
rtk bun vitest run src/auth src/services/mobile-auth.test.ts src/boot/mobile-auth.test.ts src/components/mobile/MobileAuthGate.test.ts src/App.test.ts src/router src/ios/capacitor-plugins.test.ts src/ios/privacy-manifest.test.ts src/config/index.test.ts build/validate-mobile-api-url.test.ts --coverage
```

Expected: PASS and the existing 95% line coverage thresholds hold.

- [ ] **Step 2: Run complete mobile checks**

```bash
cd apps/vela-mobile
rtk bun run test:unit
rtk bun run lint
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run API and CDK checks**

```bash
cd apps/vela-api
rtk bun run test:unit
rtk bun run compile

cd ../../packages/cdk
rtk bun run test:unit
rtk bun run lint
```

Expected: PASS.

- [ ] **Step 4: Run validated mobile and web production builds**

Generate the real mobile `.env.production` from deployed CDK outputs when available. For repository-only verification, use the same syntactically valid non-secret placeholders as PR CI and do not bypass validation:

```bash
cd apps/vela-mobile
VITE_MOBILE_API_URL=https://example.invalid/api/ \
VITE_COGNITO_USER_POOL_ID=us-east-1_ciPlaceholder \
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=ci-mobile-client-id \
VITE_COGNITO_OAUTH_DOMAIN=ci-placeholder.auth.us-east-1.amazoncognito.com \
VITE_AWS_REGION=us-east-1 \
rtk bun run build

cd ../vela
rtk bun vitest run src/services/authService.test.ts src/stores/auth.test.ts src/components/auth/AuthForm.test.ts
rtk bun run build
```

Expected: both builds PASS; web auth remains unchanged.

- [ ] **Step 5: Run production-diagnostic and secret-log scans**

```bash
cd apps/vela-mobile
VITE_MOBILE_API_URL=https://example.invalid/api/ \
VITE_COGNITO_USER_POOL_ID=us-east-1_ciPlaceholder \
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=ci-mobile-client-id \
VITE_COGNITO_OAUTH_DOMAIN=ci-placeholder.auth.us-east-1.amazoncognito.com \
VITE_AWS_REGION=us-east-1 \
rtk bun run verify:production-diagnostics

rtk rg -n "console\\.(log|warn|error).*?(authorization|callback|codeVerifier|code_verifier|challenge|state|nonce|token|claims)" src/auth src/services/mobile-auth.ts src/boot/mobile-auth.ts
```

Expected: production diagnostic verification PASS; the console scan reports no secret-bearing auth calls.

- [ ] **Step 6: Perform deployed iOS Simulator acceptance**

Using deployed Cognito/API values:

1. Launch signed out; core Home/Review/Learn/Words/More content is absent.
2. Tap **Continue with Google**; Browser opens and Cognito redirects directly to Google without a provider-selection page.
3. Complete a warm callback; confirm the targeted native `CapacitorHttp` token request
   succeeds without relying on Cognito reflecting `capacitor://localhost`, the ordinary-fetch
   API session request succeeds, the route is replaced with `/`, and the mobile shell renders.
4. Start again, terminate Vela before callback delivery, then finish Google; confirm custom-scheme cold launch and `getLaunchUrl()` completion.
5. Exercise the late-delivery race: make `getLaunchUrl()` return empty with a fresh
   transaction, then deliver `appUrlOpen`; confirm the retained verifier completes the
   callback.
6. Close and swipe down Browser; confirm `browserFinished` yields an actionable cancelled
   state and cannot overwrite callback progress.
7. Deliver a same-scheme malformed callback and a state mismatch; confirm neither remains
   loading and neither reaches the token endpoint.
8. Inspect Xcode, Safari Web Inspector, and API logs; confirm no callback, code, verifier,
   state, nonce, token, decoded claims, or native request body appears.

Record only pass/fail evidence and non-secret timestamps/run identifiers. The direct-provider
redirect is deployed acceptance evidence, not a default PR-CI network test. Google/Cognito
cookie prompts, third-party browser chrome, and an extra iOS “Open Vela” confirmation are
non-blocking observations unless they prevent callback delivery.

Physical-device proof is useful follow-up but not an HPA-205 merge gate. OAuth on a physical
device must use a bundled Debug build (or another secure origin), not the documented
`http://<dev-mac-LAN-IP>:9100` live-reload origin. HPA-209 may continue using LAN live reload
for its unrelated IME/navigation diagnostics.

- [ ] **Step 7: Review scope and commit any verification-only correction**

Run:

```bash
rtk git diff --check
rtk git status --short
```

If verification exposed a defect, make the smallest root-cause fix, rerun its focused and affected full checks, and commit it separately. Otherwise do not create an empty commit.

---

## Final Self-Review Checklist

- [ ] Every Linear acceptance criterion maps to a passing automated or deployed-simulator check.
- [ ] Warm and cold URLs feed one serialized completion implementation.
- [ ] Listener registration precedes `getLaunchUrl()`.
- [ ] Expired startup transactions are cleared; fresh interrupted transactions are retained
      for late `appUrlOpen` delivery.
- [ ] State is checked before provider errors and token exchange.
- [ ] PKCE/state/nonce use 32 bytes; insecure-context startup fails before persistence/browser
      launch.
- [ ] The token form body contains no client secret and uses targeted `CapacitorHttp`, with no
      global fetch/XHR patch.
- [ ] ID claims require string mobile `aud`, exact issuer/nonce/token use, and the documented
      60-second expiry skew; the API verifies the signed token.
- [ ] 401/403 clears tokens; retryable session failures retain them and do not repeat code exchange.
- [ ] Tokens have no public egress API, proactive refresh, or HPA-205 mid-session expiry timer.
- [ ] Web refresh still receives only `COGNITO_CLIENT_ID`.
- [ ] Successful authentication replaces the route with `/`; no signed-out return target is
      restored.
- [ ] Development diagnostics obey the phase matrix, retain their explicit dev-only bypass,
      and remain compile-time absent from production.
- [ ] Browser and Preferences match Capacitor core major 7; the UserDefaults privacy manifest
      is present and valid.
- [ ] Mobile env generation requires the new mobile client output while preserving existing
      region/domain fallbacks; Turbo adds only the mobile client variable.
- [ ] No unfinished placeholder markers remain in implementation or tests.
- [ ] No secret-bearing value reaches console, UI, snapshots, or artifacts.
- [ ] TypeScript types agree across config, coordinator, boot, component, API env, and CDK.
- [ ] HPA-206 persistence/refresh/sign-out work remains out of scope.
