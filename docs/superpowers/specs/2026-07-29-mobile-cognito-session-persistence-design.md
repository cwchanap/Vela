# HPA-206: Secure Mobile Cognito Session Persistence and Relaunch Restoration

**Date:** 2026-07-29

**Linear:** [HPA-206](https://linear.app/cwchanap/issue/HPA-206/mobile-mvpm1-add-secure-cognito-session-persistence-and-relaunch)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Keep an authenticated Vela Mobile user signed in across iOS process termination
and relaunch without placing Cognito credentials in browser storage or Capacitor
Preferences.

The app must restore the session before protected content mounts, refresh tokens
when required, and return safely to a signed-out surface when a stored credential
is missing or no longer usable.

## Current State

HPA-205 established the mobile Google OAuth authorization-code flow, PKCE
transaction persistence, callback handling, Cognito token validation, API session
verification, and the `MobileAuthGate`.

The mobile auth coordinator currently owns the authenticated token bundle only in
process memory. This is intentionally insufficient for HPA-206:

- terminating the iOS process loses the session;
- no refresh grant is performed;
- no mobile sign-out operation clears a durable credential; and
- the only persisted auth data is the short-lived, token-free PKCE transaction in
  Capacitor Preferences.

This design extends that coordinator rather than introducing a second auth owner.

## Approved Decisions

| Area | Decision |
| --- | --- |
| Durable credential | Persist only the Cognito refresh token |
| Access and ID tokens | Keep in process memory only |
| Native storage | Pin `@aparajita/capacitor-secure-storage@7.1.6` behind a Vela-owned interface |
| Keychain accessibility | `afterFirstUnlockThisDeviceOnly` |
| iCloud synchronization | Explicitly disabled with `sync: false` |
| Platform scope | Native iOS only; never invoke the plugin's web fallback |
| Refresh timing | About one minute before access-token expiry and again on foreground resume |
| Refresh concurrency | One refresh grant may be queued or in flight; timer, resume, and manual triggers coalesce |
| Soft-failure retry | One automatic retry after five seconds when the old token has enough lifetime remaining |
| Suspension behavior | No background refresh polling while the app is inactive |
| Candidate promotion | Persist any rotation and pass `/api/auth/session` before replacing the active bundle |
| Gate state | Orthogonal `operation`, `sessionUsable`, `retryAction`, and `notice`; phase alone never controls protected content |
| Browser and Android bootstrap | Explicit unsupported adapter; no runtime in-memory store and no sign-in |
| Reinstall hygiene | A non-secret, environment-scoped Preferences marker forces Keychain cleanup before the first restore decision of an installation |
| Refresh-token lifetime | Current Cognito default: 30 days from refresh-token issuance, not a sliding inactivity window |
| Sign-out UI | Add a visible Sign out action to the mobile More page |
| Remote revocation | Out of scope; HPA-206 performs reliable local credential disposal |

## Scope

HPA-206 includes:

- a mobile-only durable session-storage interface;
- an iOS Keychain adapter;
- secure refresh-token persistence after successful OAuth;
- first-install cleanup of a Keychain credential retained across uninstall;
- cold-launch restoration through Cognito's refresh-token grant;
- proactive and resume-triggered refresh;
- refresh-token rotation handling;
- local sign-out and cleanup;
- explicit restoration, terminal-session, and cleanup states in the auth UI;
- tests for storage, restoration, refresh, sign-out, and secret leakage; and
- native iOS wiring and an interactive relaunch acceptance pass.

## Non-goals

- biometric or passcode-gated access;
- multiple accounts on one installation;
- Android Keystore support;
- general offline application-data persistence;
- changes to web authentication or the browser extension;
- a general authenticated mobile API client or public token accessor; HPA-206
  uses the ID token internally only for `/api/auth/session`, and authenticated
  feature requests begin with HPA-207;
- Cognito global sign-out or token revocation; and
- background execution solely to refresh a session while iOS has suspended Vela.

## Architecture

### One mobile session owner

`apps/vela-mobile/src/services/mobile-auth.ts` remains the sole owner of the
mobile Cognito lifecycle. It continues to serialize auth mutations so callback
completion, restoration, refresh, and sign-out cannot race.

The coordinator gains four responsibilities:

1. restore a durable refresh token during initialization;
2. refresh the Cognito token bundle;
3. schedule and re-evaluate proactive refresh; and
4. clear all session material during sign-out.

The web app's Amplify auth store is unchanged and is not imported into the
mobile app.

### Coordinator surface

HPA-206 makes the coordinator's new public surface explicit. The existing
session-verification retry is generalized so the gate does not need a separate
method for every internal recovery step:

```ts
type MobileAuthRetryAction =
  | 'restore'
  | 'refresh'
  | 'persist'
  | 'verify'
  | 'cleanup';

type MobileAuthOperation =
  | 'idle'
  | 'restoring'
  | 'refreshing'
  | 'persisting'
  | 'verifying'
  | 'signingOut'
  | 'cleaningUp';

type MobileAuthNotice = 'session_unusable' | 'cleanup_incomplete' | null;

type MobileAuthState = {
  phase: MobileAuthPhase;
  operation: MobileAuthOperation;
  sessionUsable: boolean;
  errorCode: MobileAuthErrorCode | null;
  retryAction: MobileAuthRetryAction | null;
  notice: MobileAuthNotice;
  user: MobileAuthUser | null;
};

type MobileAuthCoordinator = {
  state: Readonly<MobileAuthState>;
  initialize(): Promise<void>;
  startSignIn(): Promise<void>;
  completeCallback(url: string): Promise<void>;
  retryCurrentOperation(): Promise<void>;
  signOut(): Promise<void>;
  dispose(): Promise<void>;
};
```

The existing `MobileAuthErrorCode` union gains these stable codes:

```ts
type MobileSessionErrorCode =
  | 'session_restore_failed'
  | 'session_refresh_failed'
  | 'session_persistence_failed'
  | 'session_cleanup_failed'
  | 'unsupported_platform';
```

`sessionUsable` is the protected-content capability. It becomes `true` only
after local token validation and `/api/auth/session` verification succeed, and
only while the active access token is unexpired. The coordinator sets it to
`false` immediately when sign-out starts, when the access token reaches its
expiry without a verified replacement, and on every terminal credential
failure. Components never infer usability from `phase`, `operation`, or
`errorCode`.

`operation` describes work that can occur without replacing the identity
phase. `phase` remains the HPA-205 OAuth lifecycle cursor; it is neither a pure
identity axis nor a gate-view discriminator. Existing interactive OAuth phases
and `phase: error` remain in the union so HPA-205 callback recovery keeps its
current semantics. New session-operation failures do not force
`phase: error`.

The phase for each HPA-206 context is fixed:

| Context | `phase` |
| --- | --- |
| Cold initialization, installation reset, and durable restore | `initializing` until an authenticated or signed-out outcome |
| Existing interactive OAuth flow | Existing HPA-205 phase, including `error` for interactive or configuration failures |
| Proactive refresh, candidate persistence, or candidate verification from an active identity | `authenticated` while the operation runs |
| Retryable in-session failure, before or after old-token expiry | `authenticated` |
| `signingOut` or `cleaningUp` work | Retain the originating `initializing`, `authenticated`, or cleanup-retry `signedOut` phase until the operation resolves; `operation` selects the blocking progress view |
| Successful Sign out, completed terminal-session cleanup, or incomplete-cleanup outcome | `signedOut` |
| Unsupported runtime detected during initialization | `error` with `unsupported_platform` |

If the previously verified access token expires during a retryable failure,
`phase` remains `authenticated` but `sessionUsable` becomes `false`; this
preserves identity and retry context without granting protected-content access.
Only successful or terminal cleanup transitions an identity-owning flow to
`signedOut`. `notice` carries stable user-facing context independently from an
operation failure:
`session_unusable` accompanies a terminal return to signed out, while
`cleanup_incomplete` warns that durable credential deletion did not finish.

The implementation retires the current general-purpose `setPhase()` and
`setError()` mutators. They currently clear `errorCode` and `user` as implicit
side effects, which cannot represent orthogonal session work safely. HPA-206
uses atomic transition helpers that write the complete public tuple and validate
these invariants:

1. `sessionUsable: true` requires `phase: authenticated`, a non-null `user`,
   `notice: null`, and an unexpired verified active bundle.
2. `phase: error` requires a non-null `errorCode`, but a non-null session
   `errorCode` does not require `phase: error`.
3. A non-null `retryAction` requires `operation: idle` and a non-null
   `errorCode`; starting its retry clears both fields before work begins.
4. `notice: session_unusable` requires `phase: signedOut`,
   `sessionUsable: false`, `user: null`, and no retry action.
5. `notice: cleanup_incomplete` requires `phase: signedOut`,
   `sessionUsable: false`, `user: null`,
   `errorCode: session_cleanup_failed`, and `retryAction: cleanup`.
6. Changing `operation` never implicitly clears the current user, candidate, or
   notice; each named transition states explicitly what it retains or erases.

For example, a soft foreground-refresh failure is
`phase: authenticated`, `operation: idle`,
`errorCode: session_refresh_failed`, and `retryAction: refresh`.
`sessionUsable` stays true only until the prior active bundle expires. A
startup restore failure instead keeps `phase: initializing`, `user: null`, and
`sessionUsable: false` with `retryAction: restore`.

`retryCurrentOperation()` replaces the narrow
`retrySessionVerification()` entry point and dispatches only to the retry action
recorded in state. The method never infers recovery from user-facing copy.

| Method | Preconditions and effect |
| --- | --- |
| `initialize()` | Runs at most once before disposal; installs listeners and resolves callback, transaction, then durable-session state |
| `startSignIn()` | Uses a positive coordinator-owned allowlist: idle ordinary signed out, idle `session_unusable`, or an explicitly restartable HPA-205 interactive error; requires supported native iOS and valid configuration |
| `completeCallback(url)` | Consumes only a matching callback during `initializing`, `openingBrowser`, `awaitingCallback`, or the existing `error` + `interrupted` recovery state, preserving the HPA-205 transaction guards |
| `retryCurrentOperation()` | Runs only while the coordinator exposes a non-null retry action for a retryable failure |
| `signOut()` | Runs from an authenticated identity or a blocking `restore`, `refresh`, `persist`, or `verify` failure so the user can discard local session material and start over |
| `dispose()` | Idempotent teardown from any phase; queues behind earlier operations and rejects or ignores new work once disposal begins |

The coordinator guard—not the presence or absence of a gate button—rejects
`startSignIn()` from `unsupported_platform`, `configuration_error`,
`cleanup_incomplete`, every retryable session failure, and any operation in
progress. This positive allowlist fails closed when future states are added.
The restartable HPA-205 error-code allowlist is exactly
`browser_launch_failed`, `cancelled`, `interrupted`, `transaction_expired`,
`malformed_callback`, `provider_error`, `code_exchange_failed`,
`token_validation_failed`, and `session_unauthorized`.

The `MobileAuthGate` uses an exhaustive view selector over `phase`, `operation`,
`sessionUsable`, `errorCode`, `retryAction`, and `notice`. It does not
reconstruct coordinator internals from translated copy. The More page and the
blocking recovery surface call only `signOut()`.

### Vela-owned storage boundary

The coordinator depends on a narrow interface rather than the Keychain plugin:

```ts
interface MobileSessionStore {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}
```

Tests use an in-memory fake. The native iOS runtime uses an adapter backed by
`@aparajita/capacitor-secure-storage`.

The adapter owns:

- the versioned, environment-specific Keychain key;
- non-empty string validation;
- plugin option selection;
- normalization of a missing item to `null`;
- normalization of plugin failures to Vela-owned `corrupt` or `unavailable`
  storage failures; and
- rejection of unsupported platforms before any plugin call.

The adapter must not expose plugin-specific types to the coordinator.

For pinned plugin version 7.1.6, `get()` returns `null` for a missing item and
can also collapse an iOS Keychain read failure to `null`; its native read path
does not expose the underlying `OSStatus`. The adapter therefore cannot promise
a distinct "device has not been unlocked yet" result. It applies this contract:

- `null` means missing;
- `invalidData` means corrupt and terminal;
- a rejected Capacitor bridge call, a thrown plugin/runtime exception, or
  future dependency behavior means unavailable and retryable.

The pinned native `getData()` implementation itself does not throw
`osError` or `unknownError`; ordinary Keychain lookup statuses collapse to
`null`. The `unavailable` branch is a defensive Vela adapter boundary for
bridge/runtime failures and dependency regressions, not a way to distinguish a
pre-first-unlock Keychain status. Its production use is expected to be rare;
most `retryAction: restore` states originate from the subsequent Cognito or API
transport.

HPA-206 does not perform pre-first-unlock background restoration. Its supported
path is a user-launched foreground app after the device has been unlocked. A
future requirement to distinguish a pre-unlock read from a missing item would
require a different plugin or Vela-owned native Keychain code.

### Runtime store selection

`apps/vela-mobile/src/boot/mobile-auth.ts` selects the session-store
implementation before constructing the coordinator:

| Runtime | Injected session store | Mobile sign-in |
| --- | --- | --- |
| Native iOS | Keychain-backed `MobileSessionStore` | Allowed |
| Native Android | Explicit unsupported-platform adapter | Disabled |
| Browser development or production | Explicit unsupported-platform adapter | Disabled, except that the existing development-only diagnostics bypass remains available |
| Unit and component tests | Injected in-memory fake | Test-controlled |

The runtime never injects the in-memory fake. The unsupported adapter returns
the stable, non-retryable `unsupported_platform` failure without invoking the
secure-storage plugin. The Keychain adapter independently repeats the native-iOS
guard so incorrect boot wiring still fails closed before a plugin call. Browser
development therefore does not claim to complete the custom-scheme OAuth flow
and never reaches the plugin's `localStorage` fallback.

### Keychain record

The Keychain value is the refresh-token string and nothing else. The key is
versioned and scoped to the configured Cognito user pool and mobile app client,
for example:

```text
vela:mobile:cognito:<user-pool-id>:<client-id>:refresh:v1
```

The adapter leaves the plugin's default `capacitor-storage_` key prefix
unchanged and passes the complete logical key above to `get`, `set`, and
`remove`. The effective native key is therefore:

```text
capacitor-storage_vela:mobile:cognito:<user-pool-id>:<client-id>:refresh:v1
```

The plugin has no public Keychain-service option. The adapter does not call the
global `setKeyPrefix()` mutator.

This prevents a development or staging build from restoring a production
credential and allows a future schema migration without guessing the stored
format.

Every operation overrides synchronization explicitly:

```ts
secureStorage.get(logicalKey, false, false);
secureStorage.set(
  logicalKey,
  refreshToken,
  false,
  false,
  KeychainAccess.afterFirstUnlockThisDeviceOnly,
);
secureStorage.remove(logicalKey, false);
```

The adapter must use the paired typed `get()` and `set()` methods, not the raw
`getItem()` and `setItem()` methods. `set()` JSON-encodes the string and `get()`
decodes it; mixing the two method families would surface valid stored data as
corrupt. Passing `convertDate: false` on both typed calls is required rather
than incidental so an opaque refresh-token string can never be converted to a
`Date`.

`afterFirstUnlockThisDeviceOnly` makes the item available after the user first
unlocks the device following a restart and prevents it from migrating to a new
device. Disabling synchronization prevents the credential from being stored in
iCloud Keychain.

The adapter checks that Capacitor is running natively on iOS before calling the
plugin. Browser, Android, and unknown platforms fail closed. This guard is
required because the selected plugin uses `localStorage` as its web fallback.
An unsupported Android build shows the non-retryable
`unsupported_platform` message and does not offer sign-in. That is intentional
until Android Keystore support enters scope.

### Installation marker and uninstall reset

iOS currently preserves an app's Keychain items when the app is uninstalled,
while the app sandbox and Capacitor Preferences are removed. Apple documents
Keychain preservation as current behavior rather than a permanent API
guarantee, so HPA-206 must behave safely whether a retained item exists or not.

The coordinator receives a second narrow, non-secret dependency:

```ts
interface MobileInstallationStore {
  isCurrentInstallationMarked(): Promise<boolean>;
  markCurrentInstallation(): Promise<void>;
}
```

The Preferences key is versioned and scoped to the same user pool and mobile
client as the Keychain record, for example:

```text
vela:mobile:cognito:<user-pool-id>:<client-id>:installation:v1
```

It stores only a Boolean/string sentinel—never a token, subject, email, or other
credential. Before any Keychain load or OAuth callback acceptance on native
iOS, initialization follows this order:

1. read the installation marker;
2. if it is absent, remove the environment-matched Keychain refresh token;
3. write the marker only after Keychain removal succeeds; and
4. then continue to callback, transaction, or durable-session handling.

The clear-before-mark ordering is crash safe: termination between the two steps
causes another harmless clear on the next launch. Marker read failure, Keychain
clear failure, or marker write failure fails closed with
`session_cleanup_failed`, `notice: cleanup_incomplete`, and
`retryAction: cleanup`; the coordinator must not restore or begin sign-in until
that reset succeeds. A marker that already exists permits normal restoration.
Browser and Android unsupported adapters do not run the installation-marker
flow.

### In-memory token bundle

HPA-206 splits the current optional-refresh-token shape into flow-specific
types:

```ts
type OAuthTokenBundleBase = {
  accessToken: string;
  idToken: string;
  expiresAt: number;
};

type AuthorizationCodeTokenBundle = OAuthTokenBundleBase & {
  refreshToken: string;
};

type RefreshedTokenBundle = OAuthTokenBundleBase & {
  refreshToken?: string;
};
```

The two response parsers are named and have separate contracts:

- `parseAuthorizationCodeTokenResponse()` requires a non-empty refresh token.
  A successful HTTP response that omits it or otherwise violates the response
  schema maps to the existing terminal `token_validation_failed` callback
  failure and requires a new sign-in.
- `parseRefreshTokenResponse()` permits an omitted refresh token when rotation
  is disabled. A successful HTTP response with an invalid schema produces a
  sanitized parse failure; the coordinator preserves the durable token and maps
  it to `session_restore_failed` plus `retryAction: restore` during startup, or
  `session_refresh_failed` plus `retryAction: refresh` in an existing session.

Both shapes remain process-local and contain:

- access token;
- ID token;
- expiry; and
- the active refresh token while the process is running.

Only the refresh token crosses a process boundary. Access and ID tokens are
re-created with a refresh grant after relaunch.

If Cognito returns a rotated refresh token, that token may be held temporarily
in memory while its Keychain write is retried. It is not accepted as the
durable session until the write succeeds.

### Lifecycle event ownership

The injectable `MobileAppAdapter` gains an `appStateChange` listener alongside
its existing `appUrlOpen` listener:

```ts
addListener(
  eventName: 'appStateChange',
  listener: (event: { isActive: boolean }) => void,
): Promise<{ remove(): Promise<void> }>;
```

The auth coordinator registers and removes this listener. `isActive: false`
cancels the foreground refresh timer; `isActive: true` recomputes token lifetime
and schedules or immediately queues refresh.

Serialization and refresh coalescing are separate guarantees. The coordinator
keeps one refresh-grant promise/flag that is set synchronously before work is
appended to the serialized queue. Timer, `appStateChange`, and manual
refresh-retry triggers join that promise or become a no-op while it is queued or
running. At the head of the queue, the refresh re-checks that the coordinator is
not disposed or signing out, the app is active, the same active bundle still
owns the schedule, and a refresh is still due. The flag is cleared in `finally`.
Candidate `persist` and `verify` retries reuse their retained candidate and
never issue a second grant.

`apps/vela-mobile/src/boot/capacitor-lifecycle.ts` keeps its existing `resume`
listener because that listener only records interaction-diagnostics metadata.
It does not drive auth recovery, and its best-effort failure semantics remain
independent from the auth coordinator.

### Auth state and protected-content gate

The existing `MobileAuthGate` remains the only boundary that decides whether
protected application content can mount.

The coordinator must distinguish these user-visible situations:

- initial loading/restoring;
- authenticated;
- ordinary signed out;
- signed out because a previous durable session became unusable;
- retryable restoration or refresh failure; and
- incomplete secure cleanup.

The orthogonal state model above is required; implementations must not replace
it with additional ad hoc authentication phases. The gate's slot-visibility
predicate is:

```ts
diagnosticBypass || (state.sessionUsable && authenticatedLandingReady)
```

`authenticatedLandingReady` retains HPA-205's requirement that navigation to
the authenticated home route succeeds before protected content mounts.

The remaining UI is selected through one total, side-effect-free
`selectMobileAuthGateView(state, landingState)` function. Its result is a
discriminated gate-view union covering content, content with a retry banner,
blocking progress, landing failure, blocking session failure, signed out,
terminal-session notice, cleanup failure, unsupported runtime, existing
HPA-205 error presentation, and `invalid_state`. The final `invalid_state`
result is mandatory: it keeps protected content unmounted and renders a stable
non-retryable configuration message while emitting only a sanitized diagnostic
code. The template does not chain independent checks directly against `phase`
and therefore cannot render an empty gate for an unrecognized tuple.

| Coordinator state | `sessionUsable` | Protected slot | Gate surface and actions |
| --- | --- | --- | --- |
| Initializing or `operation: restoring` | `false` | Unmounted | Blocking “Restoring your Vela session…” status |
| OAuth callback, initial persistence, or initial verification | `false` | Unmounted | Existing blocking sign-in progress; persistence uses “Securing your Vela session…” |
| Retryable startup restore, initial persistence, or initial verification failure | `false` | Unmounted | Blocking failure; Retry plus secondary “Sign out and start over” |
| Authenticated and idle | `true` | Mounted after home navigation | Application content |
| Authenticated while proactively refreshing, persisting, or verifying a candidate | `true` while the old token is unexpired | Mounted | Successful background work is silent; a retryable failure adds a non-blocking retry banner |
| Authenticated retry path after the old token expires | `false` | Unmounted | Blocking “Refreshing your Vela session…” failure; Retry plus secondary “Sign out and start over” |
| Ordinary signed out | `false` | Unmounted | Continue with Google |
| Signed out with `notice: session_unusable` | `false` | Unmounted | Clear non-secret session notice plus Continue with Google |
| `operation: signingOut` or `cleaningUp` | `false` | Unmounted | “Signing out…” or “Finishing secure sign-out…” status |
| `notice: cleanup_incomplete` | `false` | Unmounted | Cleanup warning plus `retryAction: cleanup` |
| `errorCode: unsupported_platform` | `false` | Unmounted | Non-retryable unsupported-platform message; no sign-in action |

The secondary start-over action is present on every blocking
`restore`, `refresh`, `persist`, or `verify` failure. It calls `signOut()`; the
gate never deletes credentials or candidates directly. It is unnecessary on a
soft failure while content remains mounted because the More-page Sign out
action is reachable. Cleanup failures expose only cleanup retry because the
coordinator has already discarded the active identity.

The development diagnostics bypass is extended deliberately for the new boot
state. It remains gated by development mode and the existing route metadata,
and is allowed only while `operation: idle` in ordinary `signedOut`,
`configuration_error`, or `unsupported_platform`. This makes browser
diagnostics reachable without enabling browser OAuth. It does not weaken the
coordinator's native-platform guard or make `startSignIn()` legal from
`unsupported_platform`.

The non-blocking retry banner never contains raw Cognito, HTTP, or plugin
details. Successful proactive refresh is not announced through `aria-live`, so
routine refreshes do not repeatedly interrupt assistive-technology users.
Blocking restoration and refresh copy uses `role="status"` with
`aria-live="polite"`; failure surfaces use `role="alert"`.

This concrete model preserves these invariants:

1. protected content never mounts before restoration and API verification
   succeed;
2. a terminal credential failure ends on the sign-in surface with a clear,
   non-secret notice;
3. a retryable startup failure keeps protected content unmounted and offers a
   retry;
4. a background refresh does not flash a signed-out screen while the current
   access token is still valid; and
5. once no valid access token remains, protected content is hidden until refresh
   succeeds.

After a soft refresh failure, the coordinator schedules an access-expiry
deadline from the active bundle's absolute `expiresAt`. When that deadline
fires, it re-evaluates with the injected `now()` and sets `sessionUsable` to
`false` unless a verified replacement has already been promoted. This deadline
is required because reading `now()` from a computed property alone would not
trigger a reactive gate update.

It also schedules at most one automatic retry of the recorded `refresh`,
`persist`, or `verify` action after
`MOBILE_AUTH_SOFT_RETRY_DELAY_MS = 5_000`. The retry is scheduled only while the
app is active and
`expiresAt - now() > MOBILE_AUTH_SOFT_RETRY_DELAY_MS +
MOBILE_AUTH_NETWORK_TIMEOUT_MS`, leaving enough time for the bounded network
path before expiry. A second retryable failure does not schedule another
automatic attempt; the banner remains available for manual retry. A manual
retry cancels a pending automatic timer and uses the same single-flight guard.
Successful candidate promotion resets the allowance for the new bundle.
Backgrounding, sign-out, disposal, terminal failure, and old-token expiry
cancel the timer. Startup restoration failures never auto-loop.

The HPA-205 home-first navigation invariant remains intact: restoration must
verify the API session and establish the intended authenticated route before
the gate mounts protected content.

### Sign-out entry point

The mobile More page gains an accessible Sign out button. Blocking session
recovery surfaces gain a secondary “Sign out and start over” button. Both invoke
the coordinator; neither UI owner manipulates Keychain, Preferences, candidates,
or tokens directly.

The action exposes progress and prevents duplicate submission. A failure to
remove the Keychain credential is presented as incomplete sign-out, not as
successful sign-out.

## Data Flows

### 1. Initial OAuth sign-in

The HPA-205 callback flow remains responsible for exchanging the authorization
code and validating the returned Cognito token bundle.

After validation:

1. require a non-empty refresh token;
2. save the refresh token to the Keychain;
3. hold the access and ID tokens as an unaccepted in-memory candidate;
4. verify the candidate ID token with `/api/auth/session`;
5. promote the candidate as the active bundle and set `sessionUsable: true`;
6. establish the authenticated home route; and
7. allow the gate to mount protected content.

The durable write occurs before authentication is reported as complete. A
Keychain write failure therefore cannot produce an authenticated UI that will
silently disappear after relaunch.

The validated candidate bundle can remain in memory to support an explicit
retry. Tokens and raw transport responses must never be placed in an error
message or log.

A 401 or 403 from `/api/auth/session` is terminal even though the refresh token
was already persisted. The coordinator clears that durable token before
returning to the signed-out `session_unusable` notice; a deletion failure enters
`cleanup_incomplete`.

### 2. Cold launch

Initialization keeps HPA-205's matching-callback precedence without allowing
residual token-free PKCE state to block a durable session:

1. attach native callback and lifecycle listeners;
2. complete the native-iOS installation-marker reset before reading any
   Keychain credential or accepting an OAuth callback;
3. inspect the cold-launch URL;
4. consume it only when it matches an active, exact-schema, unexpired OAuth
   transaction;
5. when no callback is consumed, inspect both the transaction result and the
   durable refresh token; and
6. choose exactly one terminal initialization path from the decision table
   below.

An active transaction is one whose exact schema and TTL are valid and whose
coordinator state can still accept a callback. A matching warm `appUrlOpen`
event may still complete it while the interrupted/recovery surface is visible.
An expired or corrupt result is residual; the transaction store attempts to
remove it, and the coordinator must continue to the durable-session decision
instead of returning early.

| Cold-launch evidence after callback handling | Initialization outcome |
| --- | --- |
| Installation marker or required first-install cleanup is unavailable | Keep the gate closed with `session_cleanup_failed`, `notice: cleanup_incomplete`, and `retryAction: cleanup`; do not inspect or accept credentials |
| Matching callback and active transaction | Consume the callback; do not run a parallel restore |
| No consumed callback and a durable refresh token exists | The durable credential wins; clear any transaction best-effort and restore |
| No durable token and an active, unexpired transaction exists | Preserve the transaction and show the existing interrupted/callback-recovery surface |
| No durable token and the transaction is expired or corrupt | Clear it and show the existing expired/interrupted restart surface |
| No durable token and no transaction exists | Ordinary signed out |
| Keychain load is operationally unavailable | Keep the gate closed with `session_restore_failed` and `retryAction: restore` |
| A required callback/transaction dependency is unavailable and no durable credential can be restored | Non-retryable configuration error |

`startSignIn()` cannot run from an authenticated session, so a durable refresh
token and an unconsumed transaction cannot represent two legitimate concurrent
owners. In that coexistence case, the transaction is residual from best-effort
callback cleanup and must never outrank the durable credential. A failure to
clear that residual transaction is sanitized and does not prevent restoration.

Restoration then:

1. loads the refresh token from the Keychain;
2. treats a missing item as ordinary signed out;
3. sends the refresh-token grant to Cognito;
4. validates the refreshed token bundle;
5. persists a rotated refresh token, if returned;
6. verifies the refreshed ID token with `/api/auth/session`;
7. establishes the authenticated home route; and
8. opens the protected-content gate.

The Google sign-in browser is never opened automatically during restoration.

### 3. Cognito refresh grant

The refresh transport posts form-encoded data to the configured Cognito
`/oauth2/token` endpoint:

```text
grant_type=refresh_token
client_id=<public-mobile-client-id>
refresh_token=<durable-refresh-token>
```

No client secret is used or bundled in the app.

`packages/cdk/lib/auth-stack.ts` does not override
`refreshTokenValidity` for `vela-mobile-client`, so the current effective
Cognito/CDK default is 30 days from refresh-token issuance. This is a fixed
lifetime, not a sliding 30-day inactivity window: successful uses of the current
non-rotating refresh token do not extend its expiry. HPA-206 therefore promises
restoration only while that credential remains valid. After expiry, Cognito's
terminal refresh response follows the `session_unusable` cleanup path and
requires a new Google sign-in.

Every refresh request uses the same
`MOBILE_AUTH_NETWORK_TIMEOUT_MS` bound as authorization-code exchange and
`/api/auth/session` verification. The token transport receives that timeout for
both its connection and response-read bounds. Because auth work is serialized,
this bound is mandatory: a hung refresh must not hold later sign-out work
indefinitely.

The current nonce-coupled validator is split into two public entry points backed
by one private base validator:

- `validateAuthorizationCodeIdTokenClaims()` requires the exact nonce from the
  active OAuth transaction; and
- `validateRefreshedIdTokenClaims()` has no transaction or nonce parameter,
  requires a non-empty subject, and accepts an optional expected subject for
  continuity checks.

The shared base performs issuer, audience, token-use, expiry, temporal, and
non-empty-subject validation. During an in-process refresh, the refreshed
subject must match the current authenticated subject. On cold restoration,
there is no prior in-memory subject to compare.

Separate entry points prevent a refresh-specific nonce exemption from silently
weakening callback validation.

The Vela API remains the signature-verification boundary. A refreshed candidate
does not become the active session until `/api/auth/session` succeeds.

Cold restoration and in-session refresh use the same candidate sequence:

1. request and parse a refreshed candidate bundle;
2. validate its issuer, audience, token use, temporal claims, and subject;
3. during an in-session refresh, require the candidate subject to match the
   current authenticated subject;
4. if the response rotates the refresh token, save the rotated value to the
   Keychain before accepting it; otherwise retain the existing durable refresh
   token;
5. call `/api/auth/session` with the candidate ID token while the prior active
   bundle, if any, remains unchanged;
6. only after API verification succeeds, atomically promote the candidate,
   update the authenticated user, set `sessionUsable: true`, and schedule from
   the candidate access-token expiry.

A retryable API-verification failure retains the validated candidate separately
for `retryAction: verify`; it does not repeat the Cognito grant. During an
in-session refresh, the prior active bundle continues to control
`sessionUsable` until its own `expiresAt`. If that bundle expires before
candidate verification succeeds, the gate closes while the pending candidate
remains available for retry. A cold restoration has no prior usable bundle, so
its gate remains closed throughout.

An API 401 or 403 for the candidate is terminal. The coordinator discards the
candidate and active bundle, sets `sessionUsable: false`, and clears the durable
refresh token. If that deletion fails, it enters the same
`cleanup_incomplete` state as failed sign-out.

The current CDK mobile client does not enable refresh-token rotation, so this
branch is forward-compatible rather than active production behavior. If
rotation is enabled later and the process terminates after Cognito issues a new
refresh token but before its Keychain write succeeds, the in-memory candidate
is lost. The prior token may work only for any configured rotation grace period;
afterward, the next relaunch reaches the terminal-session notice and requires
sign-in. This is an accepted security-biased edge case. The implementation must
not "fix" it by accepting a rotated token before durable persistence succeeds.

### 4. Proactive refresh and resume

While the app is active and authenticated, calculate the next refresh delay as:

```ts
Math.max(0, expiresAt - now() - 60_000);
```

A zero delay queues refresh immediately rather than creating a negative timer.
All expiry, delay, and claim-validation calculations use the coordinator's
injected `now()` dependency; the refresh path must not introduce a direct
`Date.now()` call.

When the app becomes inactive, cancel the foreground timer. Do not poll in the
background. When the app becomes active again:

1. recompute the remaining lifetime from the token's absolute expiry;
2. refresh immediately if the token is expired or inside the one-minute window;
3. otherwise schedule a new foreground timer; and
4. preserve serialized ordering with callback completion and sign-out.

The coordinator also owns the access-expiry deadline described by the gate
contract. A successful refresh replaces both deadlines. A soft refresh failure
keeps or creates the exact-expiry deadline so protected content cannot remain
mounted after the old token expires.

Disposing the coordinator cancels all timers and native listeners.

### 5. Local sign-out

Sign-out is serialized with every other auth operation. The same flow serves
the More-page action and the blocking recovery surface's start-over action; it
does not require a current `user` when the state carries `retryAction: restore`,
`refresh`, `persist`, or `verify`:

1. set `operation: signingOut` and `sessionUsable: false` immediately so
   protected content unmounts before any asynchronous cleanup;
2. suppress new refresh work and cancel every refresh, automatic-retry, and
   expiry timer;
3. remove the durable refresh token from the Keychain;
4. clear any token-free PKCE transaction from Preferences;
5. erase access, ID, refresh, pending-candidate, and pending-rotation material
   from process memory;
6. atomically enter ordinary `phase: signedOut` with no error, retry, notice, or
   user;
7. navigate to the signed-out surface; and
8. report sign-out success only after durable deletion succeeds.

Process memory and the PKCE transaction should still be cleared when Keychain
deletion fails, and protected content must be hidden. The UI then offers a
cleanup retry because the durable credential could otherwise restore on a
future relaunch. That failure atomically enters `phase: signedOut`,
`sessionUsable: false`, `errorCode: session_cleanup_failed`,
`retryAction: cleanup`, and `notice: cleanup_incomplete`.

Local Sign out retains the non-secret installation marker. Removing it would
only force a redundant first-install Keychain clear on the next launch.

The incomplete-cleanup copy states that Vela could not finish secure sign-out
and that the session may return if the app is closed and reopened before cleanup
succeeds. This state is not signed-out success. If the user force-terminates the
app, the next launch is expected to restore the still-present durable token.
HPA-206 does not persist a separate cleanup-pending marker; that decision is
independent of the non-secret installation marker. After relaunch the restored
session behaves normally and the user may invoke sign-out again.

Interactive acceptance steps that force-terminate after Sign out count only
after the UI reports durable cleanup success. A cleanup error followed by a
relaunch and restored session is the documented failure behavior, not an
acceptance failure masquerading as successful sign-out.

`signOut()` is the user action described above. `dispose()` remains
teardown-only: it cancels timers, removes native listeners, and destroys
process-memory candidates, but it never removes the Keychain credential or the
PKCE transaction. Both methods use the same serialized operation queue. A
`dispose()` call queued after `signOut()` waits for sign-out cleanup before
teardown; once disposal begins, later public auth actions are ignored.

Remote Cognito revocation and global sign-out are deliberately separate work.
HPA-206 guarantees local disposal on this installation.

## Failure Model

Failures are classified by whether retrying later with the same durable
credential is safe.

| Condition | Classification | Durable credential | User experience |
| --- | --- | --- | --- |
| First-install marker read/write or required Keychain reset fails | Retryable cleanup | Treat any retained credential as unsafe and do not inspect it | Keep gate closed; expose only cleanup retry |
| Keychain read returns `null` | Normal signed out | Unknown to the adapter; plugin reports missing | Show sign-in |
| Empty or malformed Keychain value | Terminal local data | Clear it | Show sign-in with a clear session notice |
| Keychain load rejects through the bridge/runtime boundary | Retryable storage, defensive and rare with pinned v7.1.6 | Preserve it | Keep gate closed; expose Retry plus Sign out and start over |
| Cognito `invalid_grant`, revoked, expired, or otherwise non-refreshable token | Terminal remote session | Clear it | Show sign-in with a clear session notice |
| API session verification returns 401 or 403 | Terminal session | Clear it | Show sign-in with a clear session notice |
| Network loss, timeout, 429, or server-side 5xx | Retryable | Preserve it | Keep gate closed at startup with Retry plus Start over; in-session soft failures get one bounded automatic retry |
| Initial or rotated-token Keychain write fails | Retryable persistence | Do not accept candidate as durable | Keep gate closed when no old token is usable; offer Retry plus Start over |
| Keychain deletion fails | Retryable cleanup | May remain present | Hide protected content; show incomplete sign-out and retry |
| Unsupported platform reaches production adapter | Non-retryable unsupported runtime | Do not access browser storage | Fail closed, disable sign-in, and explain the unsupported platform |

Retryable failures map to public retry actions without making UI components
reconstruct coordinator internals:

| Failure context | `retryAction` |
| --- | --- |
| Keychain load or startup refresh transport | `restore` |
| Foreground refresh transport | `refresh` |
| Initial or rotated refresh-token write | `persist` |
| Transient `/api/auth/session` verification | `verify` |
| First-install reset, Keychain deletion during sign-out, or terminal cleanup | `cleanup` |

The public gate mapping is fixed:

| Failure context | `errorCode` | `notice` | Primary action | Secondary action while blocking |
| --- | --- | --- | --- | --- |
| Keychain load or startup refresh transport | `session_restore_failed` | `null` | Retry current operation (`restore`) | Sign out and start over |
| Foreground refresh transport or malformed refresh response | `session_refresh_failed` | `null` | Retry current operation (`refresh`) | Sign out and start over |
| Initial or rotated-token Keychain write | `session_persistence_failed` | `null` | Retry current operation (`persist`) | Sign out and start over |
| Transient API verification | Existing `session_verification_failed` | `null` | Retry current operation (`verify`) | Sign out and start over |
| First-install reset, Keychain deletion, or terminal cleanup | `session_cleanup_failed` | `cleanup_incomplete` | Retry secure cleanup (`cleanup`) | None |
| Revoked, expired, corrupt, non-refreshable, or API-rejected durable session after successful cleanup | `null` | `session_unusable` | Continue with Google | None |
| Unsupported runtime | `unsupported_platform` | `null` | None | None |

These codes are stable coordinator output, not direct Cognito, HTTP, or plugin
payloads. The gate's presentation table remains exhaustive over the public
codes and notices.

If clearing a terminal credential also fails, the app enters the same incomplete
secure-cleanup state as failed sign-out. It must not repeatedly attempt refresh
with the known-bad value or claim that cleanup succeeded.

At startup, every retryable failure keeps protected content unmounted. During an
authenticated session, a retryable refresh failure may leave content mounted
only while the current access token remains valid. The gate shows its
non-blocking retry banner during that interval. Once the expiry deadline
re-evaluates the token as unusable, the gate closes and the same retry action
moves to the blocking failure surface until refresh and API verification
succeed.

User-facing notices contain stable, translated copy rather than Cognito payloads,
Keychain errors, tokens, claims, or raw HTTP bodies.

## Security and Privacy Guarantees

- Cognito access, ID, and refresh tokens never enter `localStorage`,
  `sessionStorage`, IndexedDB, or Capacitor Preferences.
- The secure-storage plugin's web fallback is unreachable through the production
  adapter.
- Capacitor Preferences contains only token-free PKCE data and the non-secret
  installation marker; the marker is cleared by uninstall and is never treated
  as proof of authentication.
- Only one non-empty refresh-token string is durable.
- The Keychain item is device-bound and non-synchronizing.
- First-install cleanup completes before any retained Keychain credential can be
  inspected or accepted.
- Refresh and sign-out operations are serialized, and refresh grants are
  single-flight, to avoid credential resurrection, stale writes, or duplicate
  rotation attempts.
- Logs and diagnostics emit stable event/error codes and high-level outcomes
  only.
- Errors, request objects, response objects, decoded claims, authorization URLs,
  and Keychain values are never logged wholesale.
- Existing diagnostics must not expose token values before or after this change.

## Testing Strategy

### Secure-storage adapter

Unit tests cover:

- deterministic environment and version namespacing;
- leaving the plugin's default prefix unchanged while passing the complete
  logical key;
- `afterFirstUnlockThisDeviceOnly`;
- exact `get`, `set`, and `remove` arguments, including
  `convertDate: false` and per-operation `sync: false`;
- use of the paired `get`/`set` methods rather than
  `getItem`/`setItem`;
- `null`-to-missing normalization and the documented inability to distinguish
  an iOS read failure collapsed to `null`;
- normalization of `invalidData` to corrupt and rejected bridge/runtime
  failures to unavailable;
- rejection of empty values;
- save, load, and clear error propagation;
- native-iOS platform gating; and
- proof that browser and Android paths never invoke the plugin.

### Installation marker

Unit tests cover:

- environment- and schema-specific marker namespacing;
- an existing marker proceeding without deleting the current credential;
- an absent marker clearing the matching Keychain item before callback,
  transaction, or restore handling;
- clear-before-mark ordering;
- termination after clear but before mark being safe to repeat;
- marker read, Keychain clear, and marker write failures entering
  `cleanup_incomplete` without loading a credential or permitting sign-in;
- successful cleanup retry resuming initialization; and
- proof that marker values and keys contain no credential or user data.

Boot tests prove that native iOS selects the Keychain adapter, Android and
browser select the unsupported adapter, runtime code never selects the
in-memory fake, and the development-only diagnostics bypass remains reachable
from browser `unsupported_platform` without enabling browser OAuth.

### Refresh protocol

Unit tests cover:

- the form-encoded public-client request with
  `MOBILE_AUTH_NETWORK_TIMEOUT_MS`;
- `parseAuthorizationCodeTokenResponse()` requiring a refresh token and mapping
  an omission to `token_validation_failed`;
- `parseRefreshTokenResponse()` permitting refresh-token omission and mapping
  malformed success responses to the startup or in-session error code and retry
  action for that context;
- nonce-mandatory callback validation;
- nonce-free refresh validation with a mandatory subject;
- no-rotation and rotation responses;
- persistence-before-acceptance for a rotated token;
- refreshed subject continuity during an active session;
- Cognito terminal versus retryable error classification; and
- sanitized errors with no token or raw-body leakage.

### Coordinator

Unit tests cover:

- missing-token startup;
- a residual active transaction alongside a durable token, where durable
  restoration wins;
- expired and corrupt residual transactions falling through to durable
  restoration instead of returning early;
- active transaction recovery when no durable token exists;
- successful relaunch restoration;
- retryable restoration failure and retry;
- revoked, expired, corrupt, and API-rejected sessions;
- restoration before protected-content mounting;
- non-negative proactive timer calculation;
- exclusive use of injected `now()` for delay, expiry, and claim calculations;
- `appStateChange` inactive timer cancellation and active re-evaluation;
- rapid resume/timer/manual triggers coalescing into one refresh grant while
  queued and while in flight;
- queue-head refresh revalidation after sign-out, disposal, bundle replacement,
  backgrounding, or a no-longer-due expiry;
- independence from the diagnostics-only `resume` listener;
- exact-expiry gate closure after a soft refresh failure;
- one five-second automatic soft-failure retry when the old-token lifetime
  budget permits it;
- no automatic retry when inactive, too close to expiry, during startup, or
  after the one automatic attempt fails;
- manual retry cancellation of a pending automatic retry;
- operation serialization;
- atomic full-state transitions and every published state invariant;
- callback eligibility retaining the HPA-205 interrupted flow while session
  error codes coexist with non-error phases;
- the positive `startSignIn()` allowlist, including coordinator rejection from
  `unsupported_platform`;
- retry-action preconditions and dispatch;
- pending rotated-token save retry;
- persistence and API verification before candidate promotion;
- retryable candidate verification while the old token is respectively valid
  and expired;
- terminal candidate verification cleanup;
- accepted process-loss behavior for an unpersisted rotated token;
- listener and timer disposal; and
- preservation of callback-first and home-first behavior.

### Sign-out and UI

Unit and component tests cover:

- the More-page Sign out action and accessible label;
- the blocking “Sign out and start over” action for `restore`, `refresh`,
  `persist`, and `verify` failures;
- start-over cleanup from startup without an authenticated `user`;
- duplicate-submission prevention and progress state;
- timer cancellation;
- process-memory cleanup;
- PKCE transaction cleanup;
- Keychain cleanup;
- cleanup retry after deletion failure;
- `dispose()` waiting behind queued sign-out while never deleting durable
  credentials on its own;
- signed-out persistence after a simulated relaunch;
- terminal-session notice copy;
- cleanup copy warning that a session may restore after force-termination;
- the complete state-to-gate visibility matrix;
- `phase: authenticated` plus an expired soft failure selecting a blocking
  refresh view instead of a blank gate;
- unmatched tuples selecting the safe `invalid_state` fallback;
- blocking “Restoring your Vela session…” and “Refreshing your Vela session…”
  `aria-live` copy;
- silent successful proactive refresh and a non-blocking soft-failure retry
  banner; and
- loading/restoring states with no protected-content flash.

### Secret-leak regression tests

Sentinel token values are injected through success and failure paths. Tests
assert that they do not appear in:

- captured logs;
- rendered error or diagnostics text;
- `localStorage`;
- `sessionStorage`; or
- mocked Capacitor Preferences writes.

### Automated verification

Before HPA-206 is considered implementation-complete:

- mobile unit/component coverage remains at or above the package's 95% threshold;
- mobile typecheck passes;
- the mobile production build passes with its required environment injection;
- relevant root regressions pass;
- `@aparajita/capacitor-secure-storage` is pinned exactly to `7.1.6` in
  `apps/vela-mobile/src-capacitor/package.json`;
- `apps/vela-mobile/src-capacitor/bun.lock` is updated;
- `bunx cap sync ios` is run from `apps/vela-mobile/src-capacitor`;
- the generated CocoaPods changes and
  `apps/vela-mobile/src-capacitor/ios/App/Podfile.lock` are reviewed; and
- `apps/vela-mobile/src-capacitor/ios/App/PrivacyInfo.xcprivacy` and the
  plugin's native source are checked for privacy-manifest impact. The current
  project uses CocoaPods, not Swift Package Manager, so no SPM update is
  expected.

### Interactive iOS acceptance

The closure pass uses a configured iOS build and real Cognito environment:

1. sign in through Google once;
2. force-terminate Vela and relaunch it;
3. confirm the authenticated home screen restores without another Google prompt;
4. uninstall Vela without signing out, reinstall the same configured build, and
   relaunch it;
5. confirm the first-install reset leaves Vela signed out and does not restore
   the former user's retained Keychain session;
6. sign in through Google again;
7. set `VELA_ACCEPTANCE_USER_POOL_ID` from the deployed
   `CognitoUserPoolId` output and `VELA_ACCEPTANCE_COGNITO_USERNAME` to the
   test user's Cognito `Username`, then invalidate that user's sessions with
   administrative AWS credentials:

   ```sh
   aws cognito-idp admin-user-global-sign-out \
     --user-pool-id "$VELA_ACCEPTANCE_USER_POOL_ID" \
     --username "$VELA_ACCEPTANCE_COGNITO_USERNAME"
   ```

   This administrative command is acceptance-test setup only; it does not add
   remote revocation to Vela's local Sign out behavior.

8. force-terminate Vela and relaunch it;
9. confirm the sign-in screen shows a clear session-expired notice;
10. sign in again, use Sign out on More, wait for the UI to report successful
   secure cleanup, then force-terminate and relaunch;
11. confirm Vela remains signed out; and
12. inspect device logs and WebView storage to confirm no credential leakage.

The iOS Simulator is sufficient to exercise Keychain persistence and process
relaunch. If the Google/Cognito environment or native signing prevents the real
provider pass, that limitation must be reported as an explicit closure gate
rather than replaced by a mock-only claim.

## Acceptance Mapping

| HPA-206 acceptance criterion | Design coverage |
| --- | --- |
| Relaunch restores without Google prompt | Keychain refresh token + cold-launch refresh flow |
| Reinstall does not silently restore the prior user | Preferences installation marker + clear-before-mark Keychain reset |
| Revoked/non-refreshable credential returns to sign-in with clear message | Terminal failure classification, cleanup, and signed-out notice |
| Sign out survives relaunch | Serialized Keychain deletion before success |
| No credentials in browser storage or Preferences | Refresh-only Keychain record, native guard, leak tests |
| Explicit loading with no protected-content flash | `MobileAuthGate` restoration invariants |
| Web behavior unchanged | Mobile-owned coordinator and storage boundary |

## Alternatives Considered

### Persist the complete token bundle

Rejected. Access and ID tokens are short-lived and can be recreated. Persisting
them increases secret surface, migration complexity, and stale-token behavior
without improving relaunch restoration.

### Use Capacitor Preferences

Rejected for credentials. Preferences is appropriate for the short-lived,
token-free PKCE transaction and the non-secret installation marker, but it is
not a Keychain-backed credential store.

### Use the secure-storage plugin directly throughout auth code

Rejected. A Vela-owned interface keeps plugin behavior, platform guards,
namespacing, and future replacement localized and makes failure paths testable.

### Rely on the plugin's web implementation during development

Rejected. Its web fallback uses `localStorage`, which would violate the storage
contract and could hide native-only integration errors.

### Refresh only after an API request fails

Rejected. Proactive and resume-triggered refresh gives the gate an explicit token
lifetime and avoids making unrelated API calls responsible for session recovery.

### Revoke remotely during Sign out

Deferred. Local secure disposal is the HPA-206 acceptance boundary. Remote
revocation introduces a separate network-failure contract and is not required to
prevent relaunch restoration on the same installation.

## References

- [Apple: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)
- [Apple Developer Forums: Keychain behavior after uninstall](https://developer.apple.com/forums/thread/36442)
- [`@aparajita/capacitor-secure-storage` v7.1.6](https://github.com/aparajita/capacitor-secure-storage/tree/v7.1.6)
- [Secure-storage v7.1.6 public API and error types](https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/src/definitions.ts)
- [Secure-storage v7.1.6 iOS Keychain implementation](https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/ios/Plugin/Plugin.swift)
- [Amazon Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [Amazon Cognito refresh-token lifetime](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- [Amazon Cognito refresh-token rotation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html#amazon-cognito-user-pools-refresh-token-rotation)
- [AWS CLI: `admin-user-global-sign-out`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-user-global-sign-out.html)
