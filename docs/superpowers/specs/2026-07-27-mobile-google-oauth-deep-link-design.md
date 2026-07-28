# HPA-205: Mobile Google OAuth Sign-In and iOS Deep-Link Callback

**Linear issue:** [HPA-205](https://linear.app/cwchanap/issue/HPA-205/mobile-mvpm1-implement-google-oauth-sign-in-and-deep-link-callback-on)

**Parent epic:** [HPA-194](https://linear.app/cwchanap/issue/HPA-194/mobile-mvp-build-an-ios-first-vela-learning-app-from-existing-features)

**Date:** 2026-07-27

## Goal

Implement the first interactive authentication session for `apps/vela-mobile`: a signed-out iOS user starts Google sign-in, completes Cognito's authorization-code flow in the iOS browser, returns through the registered custom URL scheme, and enters the mobile shell only after the resulting ID token succeeds against Vela's existing authenticated session endpoint.

The same mobile-owned callback pipeline must handle both a running application and a callback that launches the application. Web authentication remains unchanged.

## Context

HPA-203 already provisioned:

- the public `vela-mobile-client` Cognito app client;
- the `CognitoMobileUserPoolClientId` CloudFormation output;
- the `dev.cwchanap.vela.oauth` iOS URL scheme;
- the callback `dev.cwchanap.vela.oauth:/oauth/callback`;
- the logout URI `dev.cwchanap.vela.oauth:/oauth/logout`; and
- `AppDelegate` forwarding URL opens to Capacitor's `ApplicationDelegateProxy`.

HPA-204 already added:

- the absolute `VITE_MOBILE_API_URL`;
- production build-time validation for that URL; and
- `capacitor://localhost` CORS support.

The current mobile application has no authentication state. Its only Capacitor lifecycle listener records `resume` events for development diagnostics. The API's JWT verifier currently accepts only the web Cognito client audience, although `/api/auth/session` already provides the authenticated proof HPA-205 needs.

HPA-206 owns long-term, Keychain-backed token persistence, refresh after relaunch, corrupt/revoked-session recovery, and sign-out cleanup. HPA-205 therefore keeps tokens in memory and creates a clean session boundary that HPA-206 can extend without replacing the OAuth callback or UI state machine.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Browser integration | Official `@capacitor/browser` plus `@capacitor/app` | It maps directly to the required warm `appUrlOpen`, cold `getLaunchUrl()`, and `browserFinished` cancellation paths without adding a custom Swift plugin. On iOS this is the OS-provided `SFSafariViewController`, not an embedded credential WebView; its separate cookie jar is an accepted HPA-205 trade-off. |
| OAuth ownership | Mobile-owned coordinator | One completion path handles warm and cold callbacks. Amplify's web completion listener reads `window.location.href`, which is still the Capacitor WebView URL on a custom-scheme callback. |
| OAuth protocol | Cognito authorization-code grant with PKCE S256, state, and nonce | The mobile Cognito client is public and has no secret. PKCE protects code redemption, state binds the callback to the request, and nonce binds the resulting ID token. |
| Provider routing | `identity_provider=Google` | Bypasses Cognito's unbranded provider-selection page and preserves Vela's Google-only contract. |
| Session storage in HPA-205 | Process memory only | Meets the current issue without putting tokens in browser storage or preempting HPA-206's Keychain design. |
| Cold-start transaction storage | One short-lived, namespaced `localStorage` entry | State, verifier, and nonce must survive a possible process death before callback delivery. The entry contains no token and is cleared on every terminal outcome. |
| Authentication success gate | Existing `GET /api/auth/session` | The API verifies the ID-token signature and allowed Cognito audience, and its response supplies the canonical `{ userId, email }` mobile user. |
| Route protection | Full-app auth gate | Normal mobile routes never render while signed out or while a callback is being processed. Development-only iOS diagnostics retain an explicit development bypass. |
| API audience configuration | Add `COGNITO_MOBILE_CLIENT_ID`; retain `COGNITO_CLIENT_ID` for web refresh | The verifier can accept both audiences without turning a single-client Cognito refresh request into an invalid comma-separated client ID. |

`ASWebAuthenticationSession` is Apple's authentication-specific API: it routes the callback
to the initiating session and can request an ephemeral/private browser session (off by
default). HPA-205 intentionally uses Capacitor Browser's `SFSafariViewController` integration
and `appUrlOpen` callback delivery instead, accepting its separate cookie jar to avoid adding
a custom Swift plugin. This is still the secure in-app browser-tab pattern described by
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html); RFC 8252 section 7.3 concerns
loopback redirect URIs, not the choice between Apple browser APIs. See Apple's
[`ASWebAuthenticationSession`](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)
and
[`SFSafariViewController`](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller/)
documentation for the API distinction.

## Scope

### In scope

- Mobile Cognito configuration and production environment injection.
- Google authorization request construction.
- Cryptographically random PKCE verifier/challenge, state, and nonce.
- Browser launch and browser-dismissal handling.
- Warm `appUrlOpen` and cold `getLaunchUrl()` callback delivery.
- Exact callback parsing and validation.
- Cognito authorization-code exchange.
- In-memory token session and authenticated user state.
- Server-backed session verification through `/api/auth/session`.
- A minimal full-app authentication gate and actionable error states.
- API support for web and mobile ID-token audiences.
- Unit, component, API, infrastructure, build, and iOS Simulator verification.

### Non-goals

- Keychain-backed token persistence or restoration after a later normal relaunch.
- Refreshing expired tokens.
- Sign-out UI or server-side logout.
- Android authentication.
- Universal Links.
- Password, Cognito-native, or non-Google login.
- Final onboarding or profile-setup UI.
- Reusing or changing the web route callback.
- General external-link routing.

## Architecture

### Mobile auth state

The mobile auth service owns readonly reactive state:

```ts
type MobileAuthPhase =
  | 'initializing'
  | 'signedOut'
  | 'openingBrowser'
  | 'awaitingCallback'
  | 'exchangingCode'
  | 'verifyingSession'
  | 'authenticated'
  | 'error';

type MobileAuthUser = {
  userId: string;
  email: string | null;
};
```

The internal in-memory session contains the access token, ID token, optional refresh token, token expiry metadata, and hydrated user. Raw tokens are exposed only through a narrow authenticated-request function; Vue components never receive or render them.

The state machine is:

```text
initializing
  -> signedOut
  -> openingBrowser
  -> awaitingCallback
  -> exchangingCode
  -> verifyingSession
  -> authenticated
```

Every exceptional branch leaves a loading phase and enters either `signedOut` with a safe notice or a recoverable `error`.

### OAuth primitives

Pure helpers own:

- base64url encoding without padding;
- random byte generation through Web Crypto;
- PKCE verifier and SHA-256 challenge creation;
- authorization URL construction;
- callback URL parsing;
- decoded JWT-claim shape validation; and
- OAuth transaction expiry.

They do not import Vue or Capacitor and are tested in jsdom/Bun-compatible unit tests.

The authorization URL is:

```text
https://<cognito-domain>/oauth2/authorize
  ?client_id=<mobile-client-id>
  &response_type=code
  &redirect_uri=dev.cwchanap.vela.oauth:/oauth/callback
  &scope=openid%20email%20profile
  &identity_provider=Google
  &state=<random-state>
  &code_challenge=<s256-challenge>
  &code_challenge_method=S256
  &nonce=<random-nonce>
```

No authorization URL is logged because it contains state, challenge, and nonce values.

### Transient OAuth transaction

One transaction is active at a time:

```ts
type OAuthTransaction = {
  state: string;
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};
```

It is stored under one Vela-owned key, for example `vela:mobile:oauth-transaction`, with a ten-minute lifetime. Starting a new sign-in removes any prior transaction. Loading validates the JSON shape and timestamp; corrupt or stale entries are cleared.

The transaction store never contains an authorization code or token. It is cleared on cancellation, provider error, malformed callback, state mismatch, expiry, token validation failure, code-exchange failure, or an ordinary cold launch that has no OAuth callback. After a successful code exchange, it is cleared immediately after the token bundle and nonce are validated, before the separate API session check. A retryable API failure therefore cannot leave the PKCE verifier in storage.

### Capacitor adapter

The native adapter:

1. registers `App.addListener('appUrlOpen', ...)`;
2. registers `Browser.addListener('browserFinished', ...)`;
3. only after both registrations succeed, calls `App.getLaunchUrl()`;
4. sends warm and cold URLs to the same serialized `completeCallback(url)` function; and
5. opens Cognito through `Browser.open({ url })`.

Registering listeners before reading the launch URL closes the boot-time race between a late warm event and cold URL consumption. Callback processing changes the state away from `awaitingCallback` before best-effort `Browser.close()`, so the resulting `browserFinished` event cannot overwrite a valid callback with cancellation.

The existing diagnostic `resume` listener remains separate. Non-OAuth app URLs are ignored.

### Full-app auth gate

`App.vue` renders a mobile auth gate around the router:

- `initializing` shows a neutral startup progress state;
- `signedOut` shows Vela branding and one **Continue with Google** button;
- browser/exchange/verification phases show specific progress text;
- `error` shows a safe explanation and the action allowed by that error; and
- `authenticated` renders the normal router view.

Development diagnostic routes receive explicit development-only metadata allowing them through the gate. The exception exists only for routes already removed from production builds. Normal `Home | Review | Learn | Words | More` routes require authentication.

The gate uses `role="status"` for progress, an alert region for errors, disables duplicate actions while busy, and keeps focus behavior deterministic when returning from the browser. It does not add onboarding, profile editing, or sign-out.

## Data Flow

### Startup

1. Mobile config validates the API URL and Cognito values.
2. The auth state starts as `initializing`.
3. Capacitor URL and browser listeners are registered.
4. `getLaunchUrl()` is read.
5. If it is an OAuth callback, the coordinator processes it.
6. If it is absent and a stored transaction exists, validate the transaction and check its age first.
7. A transaction older than ten minutes is cleared and surfaces `transaction_expired`.
8. A still-fresh transaction without a callback is cleared and surfaces `interrupted`.
9. Otherwise the gate enters `signedOut`.

Core protected routes do not render during these steps.

### Starting sign-in

1. Reject a second start while an attempt is active.
2. Clear any previous error and transaction.
3. Generate state, nonce, and a PKCE verifier/challenge.
4. Persist the transaction before opening the browser.
5. Build the exact Cognito URL with `identity_provider=Google`.
6. Call `Browser.open`.
7. If browser launch fails, clear the transaction and expose `browser_launch_failed`.
8. Otherwise enter `awaitingCallback`.

### Completing a callback

1. Serialize callback processing so warm/cold duplicates cannot race.
2. Require protocol `dev.cwchanap.vela.oauth:`.
3. Require no authority, username, password, port, or fragment.
4. Require pathname `/oauth/callback`.
5. Reject duplicate `code`, `state`, or `error` parameters and reject a response containing both `code` and `error`.
6. Require exactly one non-empty `state` for both success and error callbacks.
7. Load and validate the active transaction.
8. Compare state exactly before honoring an error or making any token request.
9. If Cognito returned `error`, map it to a safe provider outcome and clear the transaction.
10. Otherwise require exactly one non-empty `code`.
11. Enter `exchangingCode`, best-effort close the browser, and POST to Cognito's token endpoint with `Content-Type: application/x-www-form-urlencoded`. The body contains `grant_type=authorization_code`, the mobile `client_id`, `code`, the exact callback URI as `redirect_uri`, and `code_verifier`; it contains no client secret.
12. Require an access token and ID token; retain a returned refresh token only in memory.
13. Decode the ID token and validate `token_use=id`, exact mobile `aud`, exact Cognito issuer, future `exp`, and exact nonce.
14. Clear the OAuth transaction; code exchange is complete and it is no longer needed.
15. Enter `verifyingSession` and call the API's `auth/session` path with the ID token as a Bearer token. The API URL helper joins the path without assuming `VITE_MOBILE_API_URL` already has a trailing slash.
16. A 401/403 response clears the in-memory token bundle and surfaces `session_unauthorized`.
17. Any other non-success status, fetch rejection, response-parse failure, or response-shape failure retains the in-memory token bundle and surfaces `session_verification_failed`.
18. Only a successful `{ authenticated: true, user: { userId, email } }` response creates the in-memory session and enters `authenticated`.

The API verification step is the mobile client's signature-verification boundary. The client-side claim checks prevent obvious substitution and nonce replay before the request, while `aws-jwt-verify` establishes signature, issuer, token use, expiry, and allowed audience before the app trusts the user.

## Error Model

Errors use stable internal codes and safe user messages:

| Code | Outcome | User action |
| --- | --- | --- |
| `configuration_error` | Required API/Cognito configuration is absent or invalid | Rebuild/reconfigure; no sign-in retry loop |
| `browser_launch_failed` | iOS browser could not open | Try again |
| `cancelled` | User closed the browser while awaiting callback, or Cognito returned `access_denied` | Start again |
| `interrupted` | A prior transaction exists on a normal launch without a callback | Start again |
| `transaction_expired` | Transaction is older than ten minutes | Start again |
| `malformed_callback` | Callback origin/path/parameters are invalid or incomplete | Start again |
| `state_mismatch` | Callback does not belong to the active request | Start again |
| `provider_error` | Cognito or Google returned another OAuth error | Start again |
| `code_exchange_failed` | Token endpoint rejected the request or returned invalid fields | Start again |
| `token_validation_failed` | ID-token claims do not match the request/configuration | Start again |
| `session_unauthorized` | Vela API rejected the ID token with 401/403 | Clear tokens and start again |
| `session_verification_failed` | A non-401/403 response, fetch failure, parse failure, or invalid response shape prevented the API proof | Retain the in-memory token bundle and retry verification |

Raw `error_description`, callback query values, token response fields, decoded claims, and thrown request objects are not rendered or logged. Browser-close failures after a callback are ignored because they do not invalidate the authentication result.

## API and Infrastructure Changes

### Mobile build configuration

The mobile app receives:

```dotenv
VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/
VITE_COGNITO_USER_POOL_ID=<user-pool-id>
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=<mobile-client-id>
VITE_COGNITO_OAUTH_DOMAIN=<domain>.auth.<region>.amazoncognito.com
VITE_AWS_REGION=<region>
```

`packages/cdk/scripts/inject-env.ts` reads the existing CloudFormation outputs and writes all five values to `apps/vela-mobile/.env.production`. Its existing environment/domain precedence rules stay unchanged. Missing `CognitoMobileUserPoolClientId`, pool ID, OAuth domain, or region is a generation error.

Mobile config and build validation reject:

- missing values in production;
- a non-absolute or non-HTTPS production API URL;
- an OAuth domain containing a scheme, path, query, fragment, credentials, or port;
- a mobile client ID or pool ID containing whitespace; and
- a pool ID whose region prefix disagrees with `VITE_AWS_REGION`.

The exact callback URI is a source constant shared by mobile OAuth code and its iOS contract tests, not an environment variable.

The new Vite variables are declared in `env.d.ts`, documented in `.env.example`, and included in Turbo's environment allowlist. PR CI supplies syntactically valid non-secret placeholders so the normal production validation path remains exercised.

### Capacitor dependency

`@capacitor/browser` is added at the same major version as the existing Capacitor 7 packages in `apps/vela-mobile/src-capacitor/package.json`. Quasar's Vite alias configuration resolves it from the Capacitor package directory, matching the existing `@capacitor/app` and `@capacitor/keyboard` pattern. Native package synchronization updates the lockfile and iOS project dependencies through the normal Quasar/Capacitor workflow.

### API audience widening

The Lambda receives:

```text
COGNITO_CLIENT_ID=<web-client-id>
COGNITO_MOBILE_CLIENT_ID=<mobile-client-id>
```

`COGNITO_CLIENT_ID` keeps its current meaning and remains the single client passed to the existing web refresh route. It is not converted to a comma-separated value.

`Env` and `buildEnv()` read the new `COGNITO_MOBILE_CLIENT_ID`. The existing
`initializeAuthVerifier(userPoolId, clientId)` contract changes to
`initializeAuthVerifier(userPoolId, webClientId, mobileClientId?)`, and `index.ts` passes the
web and optional mobile values separately. The initializer creates one ID-token verifier
with:

```ts
clientId: mobileClientId ? [webClientId, mobileClientId] : webClientId
```

Development remains compatible with a missing mobile client ID by creating a web-only verifier and warning that mobile authenticated calls cannot succeed until configured. CDK production always provides both.

The existing verifier catch no longer logs the complete `aws-jwt-verify` error object.
Verifier failures log only a stable category/name, not the token, callback, claims, or
complete third-party error object. API middleware tests reject with a secret-bearing sentinel
error and prove that neither the object nor any sentinel field reaches `console`.

No route is added. `GET /api/auth/session` remains the proof endpoint.

## Concurrency and Cleanup Rules

- `startSignIn()` and `completeCallback()` share one operation guard that covers start-vs-completion and completion-vs-completion. The guard does not remain held while the browser is open; the active phase and stored transaction separately reject another start while an attempt is outstanding.
- The coordinator sets the callback phase before awaiting browser close or network I/O.
- A callback received after cancellation finds no active transaction and cannot exchange a code.
- A duplicate callback after success is ignored and cannot clear an authenticated session.
- A session-verification retry reuses only the in-memory token bundle; it never retries code exchange.
- A 401/403 verification response clears the in-memory token bundle immediately.
- A generic network/server verification failure does not mark the user authenticated.
- All test-reset helpers clear module state, listeners, transaction storage, and in-memory tokens.

## Logging and Secret Handling

The following values must never be sent to `console`, rendered, attached to an error object exposed to UI, or included in generated diagnostic artifacts:

- authorization URLs;
- callback URLs;
- authorization codes;
- PKCE verifiers or challenges;
- state or nonce values;
- access, ID, or refresh tokens; and
- decoded token claims.

Safe logs, when needed in development, contain only an event label and stable error code. Production does not log successful auth transitions.

## Testing

### Pure OAuth tests

Table-driven tests cover:

- base64url and PKCE S256 known vectors;
- random output shape and non-reuse;
- exact authorization parameters, including `identity_provider=Google`;
- the exact token-endpoint URL, `application/x-www-form-urlencoded` content type, and body fields `grant_type`, `client_id`, `code`, `redirect_uri`, and `code_verifier`, with no client secret;
- the RFC 8252 single-slash callback;
- wrong scheme, authority, path, port, credentials, fragment, and unrelated URLs;
- missing, blank, and duplicate `code`, `state`, and `error`;
- provider cancellation and provider errors;
- corrupt, absent, fresh, stale, and replaced transactions;
- state match/mismatch before token exchange; and
- ID-token token use, audience, issuer, expiry, and nonce.

### Coordinator tests

Adapters for browser, app URL delivery, clock, crypto, storage, token exchange, and session verification make the coordinator deterministic. Tests cover:

- successful warm and cold callbacks through the same function;
- listener registration before launch URL retrieval;
- duplicate warm/cold callback serialization;
- browser cancellation before callback;
- the callback/browser-close race;
- browser launch failure;
- every terminal callback and exchange error;
- transaction cleanup for every terminal outcome;
- session-verification retry without repeating OAuth;
- 401/403 token clearing;
- non-401/403 HTTP, fetch, parse, and response-shape failures retaining the token bundle;
- start-vs-completion and completion-vs-completion serialization;
- unexpected non-OAuth URLs; and
- absence of secret-bearing console calls.

### Component and router tests

Tests prove:

- protected router content does not render during initialization or signed-out states;
- the existing `src/App.test.ts` is rewritten to inject auth state instead of asserting unconditional router rendering;
- the sign-in action cannot be triggered twice;
- every progress and error state has the correct accessible semantics;
- only authenticated state renders the core mobile shell;
- development diagnostics can bypass the gate only in development; and
- production route generation contains no diagnostic bypass.

### API and infrastructure tests

Tests pin:

- `CognitoJwtVerifier.create` receives both client IDs when configured;
- web-only development configuration remains supported;
- `Env`, `buildEnv()`, `index.ts`, and `initializeAuthVerifier()` pass web and mobile client IDs without changing the web client's meaning;
- both web and mobile ID-token audiences reach protected routes;
- verifier-failure logs contain only a stable category/name and exclude the error object, raw JWT, claims, and secret sentinels;
- the web refresh route still receives only `COGNITO_CLIENT_ID`;
- Lambda configuration includes a separate mobile client ID;
- production mobile env generation uses `CognitoMobileUserPoolClientId`;
- domain/environment precedence remains unchanged;
- mobile config/build validation rejects malformed or missing OAuth values; and
- existing web Cognito outputs and environment generation remain unchanged.

### Repository verification

Run:

- focused mobile OAuth, gate, boot, config, and router unit tests;
- focused API middleware/auth tests;
- focused CDK inject-env and stack tests;
- the complete mobile unit suite;
- mobile lint and typecheck;
- API unit tests;
- CDK unit tests;
- a production mobile build with normal validation;
- the existing web auth unit tests and web production build; and
- generated-asset/static scans for auth secrets and forbidden development-diagnostic tokens.

### iOS Simulator acceptance

With deployed Cognito configuration:

1. Launch signed out and confirm the core shell is not visible.
2. Start Google sign-in and confirm the Capacitor browser redirects directly to Google's provider flow without rendering Cognito's provider-selection page.
3. Complete a warm callback and confirm `/api/auth/session` returns the mobile user.
4. Repeat with the app terminated before callback delivery and confirm the custom URL cold-launches Vela and completes through `getLaunchUrl()`.
5. Close the browser and confirm cancellation returns to an actionable signed-out state.
6. Deliver a malformed callback and a state mismatch and confirm neither leaves a loading state.
7. Confirm no callback, verifier, code, or token appears in Xcode, Safari Web Inspector, or API logs.

The simulator run is required evidence for HPA-205. Physical-device authentication is useful follow-up evidence but is not added as a new merge gate by this issue.

The direct-provider redirect check is deployed acceptance evidence. Repository unit tests and
default PR CI do not make live requests to Cognito or Google.

## Acceptance-Criteria Mapping

| Linear acceptance criterion | Design proof |
| --- | --- |
| Signed-out user can start Google sign-in | Full-app gate with one Google action |
| System browser, not embedded credentials | `@capacitor/browser` native browser surface |
| Successful callback produces valid Cognito session | Code exchange, claim validation, and in-memory token session |
| Warm and cold app delivery | One callback function fed by `appUrlOpen` and `getLaunchUrl()` |
| State mismatch, missing code, cancellation, provider failure never stick | Explicit terminal state transitions and cleanup |
| Valid session calls diagnostic authenticated endpoint | `/api/auth/session` is the required success gate |
| No code, verifier, or token logged | Safe logging contract plus regression tests/scans |

## Follow-Up Boundary

HPA-206 will replace/extend the in-memory session boundary with Keychain-backed persistence, restore it before protected navigation, refresh expired sessions, and add sign-out cleanup. It must not replace the OAuth transaction, callback parser, browser adapter, or API audience work delivered here.
