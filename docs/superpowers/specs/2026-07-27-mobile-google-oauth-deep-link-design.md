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
| Browser integration | Add official `@capacitor/browser`; retain `@capacitor/app` | Browser is new HPA-205 work. Together the plugins provide warm `appUrlOpen`, cold `getLaunchUrl()`, and `browserFinished` cancellation without a custom Swift plugin. On iOS this is the OS-provided `SFSafariViewController`, not an embedded credential WebView; its separate cookie jar is an accepted HPA-205 trade-off. |
| OAuth ownership | Mobile-owned coordinator | One completion path handles warm and cold callbacks. Amplify's web completion listener reads `window.location.href`, which is still the Capacitor WebView URL on a custom-scheme callback. |
| OAuth protocol | Cognito authorization-code grant with PKCE S256, state, and nonce | The mobile Cognito client is public and has no secret. PKCE protects code redemption, state binds the callback to the request, and nonce binds the resulting ID token. |
| Provider routing | `identity_provider=Google` | Bypasses Cognito's unbranded provider-selection page and preserves Vela's Google-only contract. |
| Token endpoint transport | One targeted `CapacitorHttp.request()` call from `@capacitor/core` | Cognito does not document CORS support for `capacitor://localhost`. The code exchange therefore uses Capacitor's bundled native HTTP helper and does not depend on WebView CORS. Global fetch/XHR patching remains disabled, no community HTTP plugin is added, and `/api/auth/session` continues to use ordinary `fetch`. |
| Session storage in HPA-205 | Process memory only | Meets the current issue without putting tokens in browser storage or preempting HPA-206's Keychain design. |
| Cold-start transaction storage | One short-lived, namespaced `@capacitor/preferences` entry | State, verifier, and nonce must survive a possible process death before callback delivery. Preferences uses `UserDefaults` on iOS and is a stronger native persistence contract than asynchronously flushed WebView `localStorage`. The entry contains no token and is cleared on every terminal outcome. |
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

The internal in-memory session contains the access token, ID token, optional refresh token,
token expiry metadata, and hydrated user. Tokens remain private to the coordinator; the
session-verification adapter is the only HPA-205 consumer of the ID token. HPA-205 does not
export `getIdToken()`, `authorizedFetch()`, or another public token egress API, and Vue
components never receive or render tokens.

HPA-205 does not schedule a refresh or a mid-session expiry transition. After the initial API
proof, the in-memory shell remains authenticated until process loss. HPA-206 owns token-expiry
recovery, refresh, and future authenticated-request behavior; HPA-205 does not claim generic
per-request 401 handling that has no current consumer.

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
- 32-byte Web Crypto random generation for the PKCE verifier, state, and nonce;
- PKCE verifier and SHA-256 challenge creation;
- authorization URL construction;
- strict callback URL parsing through the WHATWG `URL` API plus explicit component checks;
- decoded JWT-claim shape validation; and
- OAuth transaction expiry.

They do not import Vue or Capacitor and are tested in jsdom/Bun-compatible unit tests.

Base64url-encoding 32 random bytes produces a 43-character PKCE verifier, which is inside the
RFC 7636 43–128 character range. State and nonce each retain the full 32 bytes of entropy.
There is no `Math.random()` or deterministic fallback.

PKCE S256 requires `crypto.subtle`, which is available only in a secure context. Before
creating a transaction, the coordinator requires `globalThis.isSecureContext`,
`crypto.getRandomValues`, and `crypto.subtle.digest`. A missing capability produces
`configuration_error` with safe copy naming the secure-context requirement; the app does not
fall back to a JavaScript SHA-256 implementation.

The bundled Capacitor application origin and loopback development origins are the supported
OAuth development paths. The documented physical-device live-reload origin
`http://<dev-mac-LAN-IP>:9100` is not a secure context and is intentionally unsupported for
OAuth. A physical device can still exercise OAuth from a bundled Debug build; the separate
HPA-209 LAN live-reload diagnostics remain unaffected.

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
`Google` is the Cognito identity-provider name string, not a Google OAuth client ID.

`MOBILE_OAUTH_CALLBACK_URI` is the single source for both authorization and token-exchange
`redirect_uri` values. The callback parser constructs a WHATWG `URL` and then requires the
exact protocol, empty host/authority/credentials/port, exact pathname, and no fragment. It
does not normalize `scheme://host/path` into the accepted RFC 8252 `scheme:/path` form.

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

It is stored through `@capacitor/preferences` under one Vela-owned key, for example
`vela:mobile:oauth-transaction`, with a ten-minute lifetime. The async store serializes the
object as JSON, validates every field and timestamp when loading, and clears corrupt or stale
entries. Starting a new sign-in removes any prior transaction and awaits the replacement
write before opening the browser.

The transaction store never contains an authorization code or token. Preferences is not an
encrypted secret store; its use is limited to the short-lived verifier, state, nonce, and
creation time. It is cleared on cancellation, provider error, malformed callback, state
mismatch, expiry, token validation failure, or code-exchange failure. After a successful code
exchange, it is cleared immediately after the token bundle and nonce are validated, before
the separate API session check. A retryable API failure therefore cannot leave the PKCE
verifier in storage.

A fresh transaction found without a launch URL surfaces `interrupted` but is not cleared.
`appUrlOpen` can still deliver a valid late callback after `getLaunchUrl()` returns empty.
Expiry, a terminal callback outcome, browser cancellation, or the next `startSignIn()` clears
or replaces it.

The Preferences dependency adds an iOS `PrivacyInfo.xcprivacy` declaration for
`NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`.

### Capacitor adapter

The native adapter:

1. registers `App.addListener('appUrlOpen', ...)`;
2. registers `Browser.addListener('browserFinished', ...)`;
3. only after both registrations succeed, calls `App.getLaunchUrl()`;
4. sends warm and cold URLs to the same serialized `completeCallback(url)` function; and
5. opens Cognito through `Browser.open({ url })`.

Registering listeners before reading the launch URL closes the boot-time race between a late warm event and cold URL consumption. Callback processing changes the state away from `awaitingCallback` before best-effort `Browser.close()`, so the resulting `browserFinished` event cannot overwrite a valid callback with cancellation.

The existing diagnostic `resume` listener remains separate. Non-OAuth app URLs are ignored.
Simulator acceptance must prove that custom-scheme navigation from `SFSafariViewController`
reaches `appUrlOpen` or `getLaunchUrl()`, that swipe-down dismissal produces
`browserFinished`, and that browser dismissal cannot overwrite callback progress. An extra
iOS confirmation before opening Vela is follow-up UX debt, not a silent success.

### Token endpoint transport

The token exchange receives an injected transport port. The production adapter calls
`CapacitorHttp.request()` directly with `method: 'POST'`, the exact Cognito token URL,
`Content-Type: application/x-www-form-urlencoded`, and the serialized form body.
CapacitorHttp is bundled by `@capacitor/core`; the global `CapacitorHttp.enabled` fetch/XHR
patch remains absent/false. No `@capacitor-community/http` dependency is added.

Only the Cognito token request uses this native transport. The Vela session endpoint remains
an ordinary WebView `fetch`, because Vela controls its CORS policy and already admits the
Capacitor origin. Tests inject a fake token transport so native response status/data handling
is deterministic and no secret-bearing request is logged.

### Boot order and diagnostic precedence

The boot order is:

```text
main -> mobile-auth -> capacitor-lifecycle -> diagnostic-cold-entry
```

The auth boot provides the coordinator and starts initialization without holding a Quasar
boot promise across browser or network work. The diagnostic cold-entry boot remains
best-effort and may update the router while auth initialization proceeds. The gate reads the
active route metadata itself; navigation succeeding does not imply protected content mounted.

The render contract is:

| Auth state | Development diagnostic route | Core route |
| --- | --- | --- |
| `initializing` | Auth startup progress; do not mount diagnostic content yet | Auth startup progress |
| `signedOut` | Render diagnostic content | Signed-out gate |
| Busy callback/browser phase | Auth progress; an OAuth callback takes precedence | Auth progress |
| `error(configuration_error)` | Render diagnostic content so permanent dev tooling remains usable | Configuration error |
| Any other auth error | Auth error and its prescribed action | Auth error and its prescribed action |
| `authenticated` | Render diagnostic content if still selected | Render mobile shell |

Compile-time `import.meta.env.DEV` route exclusion is the primary production guarantee.
`route.meta.bypassMobileAuth === true` plus the phase predicate above is the secondary gate
guard. A cold OAuth callback always wins over a staged diagnostic entry: callback
progress/errors remain visible, and successful authentication replaces the route with `/`
before protected content is exposed.

### Full-app auth gate

`App.vue` renders a mobile auth gate around the router:

- `initializing` shows a neutral startup progress state;
- `signedOut` shows Vela branding and one **Continue with Google** button;
- browser/exchange/verification phases show specific progress text;
- `error` shows a safe explanation and the action allowed by that error; and
- `authenticated` renders the normal router view.

Development diagnostic routes receive explicit development-only metadata allowing them through the gate. The exception exists only for routes already removed from production builds. Normal `Home | Review | Learn | Words | More` routes require authentication.

The gate uses `role="status"` for progress, an alert region for errors, disables duplicate actions while busy, and keeps focus behavior deterministic when returning from the browser. It does not add onboarding, profile editing, or sign-out.
Because the gate owns the slot around `router-view`, `MobileLayout` and its tab pages do not
mount until the gate permits the current route. Successful authentication always uses
`router.replace('/')`; HPA-205 does not preserve a signed-out core route or add a `returnTo`
contract.

## Data Flow

### Startup

1. Production mobile config validates the API URL and Cognito values and throws at boot for
   missing or malformed build configuration. Development config problems become the
   rendered `configuration_error` state.
2. The auth state starts as `initializing`.
3. Capacitor URL and browser listeners are registered.
4. `getLaunchUrl()` is read.
5. If it is an OAuth callback, the coordinator processes it.
6. If it is absent and a stored transaction exists, validate the transaction and check its age first.
7. A transaction older than ten minutes is cleared and surfaces `transaction_expired`.
8. A still-fresh transaction without a callback is retained and surfaces `interrupted`, so a
   later `appUrlOpen` can still complete it.
9. Otherwise the gate enters `signedOut`.

Core protected routes do not render during these steps.

### Starting sign-in

1. Reject a second start while an attempt is active.
2. Clear any previous error and transaction.
3. Require a secure context plus `crypto.getRandomValues` and `crypto.subtle.digest`; surface
   `configuration_error` without creating a transaction when unavailable.
4. Generate 32-byte state and nonce values plus a 32-byte/43-character PKCE
   verifier/challenge.
5. Await native Preferences persistence before opening the browser.
6. Build the exact Cognito URL with `identity_provider=Google`.
7. Call `Browser.open`.
8. If browser launch fails, clear the transaction and expose `browser_launch_failed`.
9. Otherwise enter `awaitingCallback`.

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
11. Enter `exchangingCode`, best-effort close the browser, and use the targeted
    `CapacitorHttp.request()` adapter to POST to Cognito's token endpoint with
    `Content-Type: application/x-www-form-urlencoded`. The body contains
    `grant_type=authorization_code`, the mobile `client_id`, `code`, the exact
    `MOBILE_OAUTH_CALLBACK_URI` as `redirect_uri`, and `code_verifier`; it contains no client
    secret and does not depend on Cognito WebView CORS.
12. Require an access token and ID token; retain a returned refresh token only in memory.
13. Decode the ID token and require `token_use === 'id'`, a string
    `aud === mobileClientId` (arrays are rejected),
    `iss === https://cognito-idp.${region}.amazonaws.com/${userPoolId}`, exact nonce, and
    `exp * 1000 + 60_000 > now()`. The client does not verify the JWT signature locally.
14. Clear the OAuth transaction; code exchange is complete and it is no longer needed.
15. Enter `verifyingSession` and call the API's `auth/session` path with the ID token as a Bearer token. The API URL helper joins the path without assuming `VITE_MOBILE_API_URL` already has a trailing slash.
16. A 401/403 response clears the in-memory token bundle and surfaces `session_unauthorized`.
17. Any other non-success status, fetch rejection, response-parse failure, or response-shape failure retains the in-memory token bundle and surfaces `session_verification_failed`.
18. Only a successful `{ authenticated: true, user: { userId, email } }` response creates the
    in-memory session and enters `authenticated`. The gate keeps its slot closed while it
    replaces the router location with `/`, then exposes the normal shell.

The API verification step is the mobile client's signature-verification boundary. The client-side claim checks prevent obvious substitution and nonce replay before the request, while `aws-jwt-verify` establishes signature, issuer, token use, expiry, and allowed audience before the app trusts the user.

## Error Model

Errors use stable internal codes and safe user messages:

| Code | Outcome | User action |
| --- | --- | --- |
| `configuration_error` | Development build configuration is invalid, or a required runtime capability/plugin is unavailable. Production build-configuration errors throw before the gate. | No retry action; rebuild/reconfigure |
| `browser_launch_failed` | iOS browser could not open | `startSignIn()` |
| `cancelled` | User closed the browser while awaiting callback, or Cognito returned `access_denied` | `startSignIn()` |
| `interrupted` | A fresh prior transaction exists on a normal launch without a callback; the transaction remains available for a late callback | `startSignIn()` clears/replaces it |
| `transaction_expired` | Transaction is older than ten minutes | `startSignIn()` |
| `malformed_callback` | Callback origin/path/parameters are invalid or incomplete | `startSignIn()` |
| `state_mismatch` | Callback does not belong to the active request | `startSignIn()` |
| `provider_error` | Cognito or Google returned another OAuth error | `startSignIn()` |
| `code_exchange_failed` | Native token request failed, was rejected, or returned invalid fields | `startSignIn()` |
| `token_validation_failed` | ID-token claims do not match the request/configuration | `startSignIn()` |
| `session_unauthorized` | Vela API rejected the ID token with 401/403 | Clear tokens, then `startSignIn()` |
| `session_verification_failed` | A non-401/403 response, fetch failure, parse failure, or invalid response shape prevented the API proof | Retain the in-memory token bundle; `retrySessionVerification()` |

Raw `error_description`, callback query values, token response fields, decoded claims, and thrown request objects are not rendered or logged. Browser-close failures after a callback are ignored because they do not invalidate the authentication result.

A redirect-URI/client mismatch normally leaves Cognito's error page in the browser and
produces no callback error code. Development may log only a stable
`browser_closed_before_callback` category with generic guidance to verify the deployed client
and redirect URI. If an actual callback carries `error`, the parser maps it to an allowlisted
internal code; it never logs the raw query value.

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

`packages/cdk/scripts/inject-env.ts` reads the existing CloudFormation outputs and writes all
five values to `apps/vela-mobile/.env.production`. `CognitoMobileUserPoolClientId` is the new
required output, and its absence fails before writing a partial file. Existing pool-ID
requirements remain unchanged. Region retains the current
`VITE_AWS_REGION -> CognitoRegion -> AWS_REGION -> us-east-1` precedence, and the OAuth domain
retains its current output-or-derived-prefix fallback; resolved region/domain values are
validated after those fallbacks rather than treated as newly required raw outputs.

Mobile config and build validation reject:

- missing values in production;
- a non-absolute or non-HTTPS production API URL;
- an OAuth domain containing a scheme, path, query, fragment, credentials, or port;
- a mobile client ID or pool ID containing whitespace; and
- a pool ID whose region prefix disagrees with `VITE_AWS_REGION`.

The exact callback URI is a source constant shared by mobile OAuth code and its iOS contract tests, not an environment variable.

The new Vite variable is declared in `env.d.ts` and documented in `.env.example`. Only
`VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID` is added to Turbo's build environment allowlist;
the API URL, region, pool ID, and OAuth domain are already present. PR CI supplies exact
non-secret placeholders that satisfy the region/pool/domain validators so the normal
production validation path remains exercised.

### Capacitor dependency

`@capacitor/browser` and `@capacitor/preferences` are added at the same major version as the
existing Capacitor 7 packages in `apps/vela-mobile/src-capacitor/package.json`. Quasar's Vite
alias configuration resolves them from the Capacitor package directory, matching the
existing `@capacitor/app` and `@capacitor/keyboard` pattern. Native package synchronization
updates the lockfile and iOS project dependencies through the normal Quasar/Capacitor
workflow. Tests require Browser and Preferences to resolve and to share the
`@capacitor/core` major. `CapacitorHttp` needs no dependency because it is bundled by
`@capacitor/core`; global HTTP patching is not enabled.

Preferences also adds `ios/App/PrivacyInfo.xcprivacy` to the iOS target with the UserDefaults
accessed-API category and reason described above.

The implementation follows the official Capacitor 7
[`Browser`](https://capacitorjs.com/docs/v7/apis/browser),
[`Preferences`](https://capacitorjs.com/docs/v7/apis/preferences), and
[`CapacitorHttp`](https://capacitorjs.com/docs/v7/apis/http) contracts.

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
Verifier failures log a stable category and, in development only, a sanitized `error.name`;
they never log the message, token, callback, claims, or complete third-party error object.
API middleware tests reject with a secret-bearing sentinel error and prove that neither the
object nor any sentinel field reaches `console`.

No route is added. `GET /api/auth/session` remains the proof endpoint.

## Concurrency and Cleanup Rules

- `startSignIn()` and `completeCallback()` share one operation guard that covers start-vs-completion and completion-vs-completion. The guard does not remain held while the browser is open; the active phase and stored transaction separately reject another start while an attempt is outstanding.
- A callback arriving while `startSignIn()` is finishing is queued behind the guard and then
  processed; it is never dropped because another operation is active.
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
- 32-byte entropy inputs, 43-character verifier shape, and random output non-reuse;
- secure-context capability failure without transaction/browser side effects;
- exact authorization parameters, including `identity_provider=Google`;
- the exact token-endpoint URL, targeted native transport,
  `application/x-www-form-urlencoded` content type, and body fields `grant_type`, `client_id`,
  `code`, `redirect_uri`, and `code_verifier`, with no client secret or global fetch patch;
- the RFC 8252 single-slash callback;
- fixed WHATWG URL vectors covering wrong scheme, double slash/authority, trailing path,
  port, credentials, fragment, query ordering, `+`/`%20`, empty values, and unrelated URLs;
- missing, blank, and duplicate `code`, `state`, and `error`;
- provider cancellation and provider errors;
- corrupt, absent, fresh, stale, and replaced Preferences transactions;
- a fresh interrupted transaction surviving until a late valid callback;
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
- native token-transport status/data/parse failures independent of WebView CORS;
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
- `MobileLayout` and tab pages do not mount behind the gate;
- successful authentication replaces the route with `/`;
- the complete auth-phase × diagnostic-route matrix above;
- development diagnostics can bypass the gate only in development; and
- compile-time production route generation contains no diagnostics, while the runtime gate
  still requires both `DEV` and explicit metadata.

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

Focused pure OAuth, transaction-store, and coordinator tests each maintain at least 95% line
coverage.

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
3. Complete a warm callback and confirm the native `CapacitorHttp` token exchange succeeds
   without depending on Cognito reflecting the WebView origin, then confirm
   `/api/auth/session` returns the mobile user and the app lands on `/`.
4. Repeat with the app terminated before callback delivery and confirm the custom URL cold-launches Vela and completes through `getLaunchUrl()`.
5. Close or swipe down the browser and confirm `browserFinished` returns to an actionable
   signed-out state without racing a successful callback.
6. Deliver a malformed callback and a state mismatch and confirm neither leaves a loading state.
7. Confirm no callback, verifier, code, or token appears in Xcode, Safari Web Inspector, or API logs.

The simulator run is required evidence for HPA-205. Physical-device authentication is useful follow-up evidence but is not added as a new merge gate by this issue.

Third-party Google/Cognito browser chrome, cookie prompts, and an iOS confirmation before
opening Vela are recorded as non-blocking UX observations unless they prevent the callback.
Physical-device OAuth development uses a bundled Debug build, not insecure LAN-IP live
reload.

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
