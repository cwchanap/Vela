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
| Suspension behavior | No background refresh polling while the app is inactive |
| Sign-out UI | Add a visible Sign out action to the mobile More page |
| Remote revocation | Out of scope; HPA-206 performs reliable local credential disposal |

## Scope

HPA-206 includes:

- a mobile-only durable session-storage interface;
- an iOS Keychain adapter;
- secure refresh-token persistence after successful OAuth;
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

type MobileAuthCoordinator = {
  state: Readonly<MobileAuthState & { retryAction: MobileAuthRetryAction | null }>;
  initialize(): Promise<void>;
  startSignIn(): Promise<void>;
  completeCallback(url: string): Promise<void>;
  retryCurrentOperation(): Promise<void>;
  signOut(): Promise<void>;
  dispose(): Promise<void>;
};
```

`retryCurrentOperation()` replaces the narrow
`retrySessionVerification()` entry point and dispatches only to the retry action
recorded in state. The method never infers recovery from user-facing copy.

| Method | Preconditions and effect |
| --- | --- |
| `initialize()` | Runs at most once before disposal; installs listeners and resolves callback, transaction, then durable-session state |
| `startSignIn()` | Runs only from ordinary signed out or a terminal-session notice that permits a new sign-in |
| `completeCallback(url)` | Consumes only a matching callback in an active callback phase, preserving the HPA-205 transaction guards |
| `retryCurrentOperation()` | Runs only while the coordinator exposes a non-null retry action for a retryable failure |
| `signOut()` | Runs from authenticated state, including while a background refresh status leaves the current access token valid |
| `dispose()` | Idempotent teardown from any phase; queues behind earlier operations and rejects or ignores new work once disposal begins |

The `MobileAuthGate` uses `retryAction` to choose whether to offer a retry.
The More page calls only `signOut()`.

### Vela-owned storage boundary

The coordinator depends on a narrow interface rather than the Keychain plugin:

```ts
interface MobileSessionStore {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}
```

Tests use an in-memory fake. Production uses an iOS adapter backed by
`@aparajita/capacitor-secure-storage`.

The adapter owns:

- the versioned, environment-specific Keychain key;
- non-empty string validation;
- plugin option selection;
- normalization of a missing item to `null`; and
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
- a thrown `osError`, `unknownError`, or other operational failure means
  unavailable and retryable.

HPA-206 does not perform pre-first-unlock background restoration. Its supported
path is a user-launched foreground app after the device has been unlocked. A
future requirement to distinguish a pre-unlock read from a missing item would
require a different plugin or Vela-owned native Keychain code.

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

`afterFirstUnlockThisDeviceOnly` makes the item available after the user first
unlocks the device following a restart and prevents it from migrating to a new
device. Disabling synchronization prevents the credential from being stored in
iCloud Keychain.

The adapter checks that Capacitor is running natively on iOS before calling the
plugin. Browser, Android, and unknown platforms fail closed. This guard is
required because the selected plugin uses `localStorage` as its web fallback.
An unsupported Android build shows a non-retryable configuration message and
does not offer sign-in. That is intentional until Android Keystore support
enters scope.

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

The authorization-code parser requires a non-empty refresh token at the type
boundary. A refresh response may omit it when rotation is disabled. Both shapes
remain process-local and contain:

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

The implementation may extend the phase union or add an orthogonal operation
status, but it must preserve these invariants:

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

The HPA-205 home-first navigation invariant remains intact: restoration must
verify the API session and establish the intended authenticated route before
the gate mounts protected content.

### Sign-out entry point

The mobile More page gains an accessible Sign out button. It invokes the
coordinator; the page does not manipulate Keychain, Preferences, or tokens
directly.

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
3. keep the access and ID tokens in process memory;
4. verify the ID token with `/api/auth/session`;
5. establish the authenticated home route; and
6. allow the gate to mount protected content.

The durable write occurs before authentication is reported as complete. A
Keychain write failure therefore cannot produce an authenticated UI that will
silently disappear after relaunch.

The validated candidate bundle can remain in memory to support an explicit
retry. Tokens and raw transport responses must never be placed in an error
message or log.

### 2. Cold launch

Initialization keeps HPA-205's callback and PKCE-transaction precedence:

1. attach native callback and lifecycle listeners;
2. inspect the cold-launch URL;
3. resume a valid in-flight OAuth transaction when applicable; and
4. only when no callback transaction is active, attempt durable-session
   restoration.

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

The Vela API remains the signature-verification boundary. A refreshed session
does not become authenticated until `/api/auth/session` succeeds.

If Cognito returns a new refresh token:

1. validate the complete candidate response;
2. save the new refresh token to the Keychain;
3. only after the save succeeds, replace the active in-memory bundle; and
4. schedule from the new access-token expiry.

If no refresh token is returned, retain the existing durable refresh token.

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
Math.max(0, expiresAt - now - 60_000);
```

A zero delay queues refresh immediately rather than creating a negative timer.

When the app becomes inactive, cancel the foreground timer. Do not poll in the
background. When the app becomes active again:

1. recompute the remaining lifetime from the token's absolute expiry;
2. refresh immediately if the token is expired or inside the one-minute window;
3. otherwise schedule a new foreground timer; and
4. preserve serialized ordering with callback completion and sign-out.

Disposing the coordinator cancels all timers and native listeners.

### 5. Local sign-out

Sign-out is serialized with every other auth operation:

1. prevent new refresh work and cancel the active timer;
2. remove the durable refresh token from the Keychain;
3. clear any token-free PKCE transaction from Preferences;
4. erase access, ID, refresh, and pending-rotation material from process memory;
5. navigate to the signed-out surface; and
6. report sign-out success only after durable deletion succeeds.

Process memory and the PKCE transaction should still be cleared when Keychain
deletion fails, and protected content must be hidden. The UI then offers a
cleanup retry because the durable credential could otherwise restore on a
future relaunch.

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
| Keychain read returns `null` | Normal signed out | Unknown to the adapter; plugin reports missing | Show sign-in |
| Empty or malformed Keychain value | Terminal local data | Clear it | Show sign-in with a clear session notice |
| Keychain load throws an operational error | Retryable storage | Preserve it | Keep gate closed; expose the `restore` retry action |
| Cognito `invalid_grant`, revoked, expired, or otherwise non-refreshable token | Terminal remote session | Clear it | Show sign-in with a clear session notice |
| API session verification returns 401 or 403 | Terminal session | Clear it | Show sign-in with a clear session notice |
| Network loss, timeout, 429, or server-side 5xx | Retryable | Preserve it | Keep gate closed at startup; offer retry |
| Initial or rotated-token Keychain write fails | Retryable persistence | Do not accept candidate as durable | Keep gate closed; retry secure save |
| Keychain deletion fails | Retryable cleanup | May remain present | Hide protected content; show incomplete sign-out and retry |
| Unsupported platform reaches production adapter | Non-retryable configuration error | Do not access browser storage | Fail closed, disable sign-in, and explain the unsupported platform |

Retryable failures map to public retry actions without making UI components
reconstruct coordinator internals:

| Failure context | `retryAction` |
| --- | --- |
| Keychain load or startup refresh transport | `restore` |
| Foreground refresh transport | `refresh` |
| Initial or rotated refresh-token write | `persist` |
| Transient `/api/auth/session` verification | `verify` |
| Keychain deletion during sign-out or terminal cleanup | `cleanup` |

If clearing a terminal credential also fails, the app enters the same incomplete
secure-cleanup state as failed sign-out. It must not repeatedly attempt refresh
with the known-bad value or claim that cleanup succeeded.

At startup, every retryable failure keeps protected content unmounted. During an
authenticated session, a retryable refresh failure may leave content mounted
only while the current access token remains valid. Once it expires, the gate
closes until refresh and API verification succeed.

User-facing notices contain stable, translated copy rather than Cognito payloads,
Keychain errors, tokens, claims, or raw HTTP bodies.

## Security and Privacy Guarantees

- Cognito access, ID, and refresh tokens never enter `localStorage`,
  `sessionStorage`, IndexedDB, or Capacitor Preferences.
- The secure-storage plugin's web fallback is unreachable through the production
  adapter.
- Only one non-empty refresh-token string is durable.
- The Keychain item is device-bound and non-synchronizing.
- Refresh and sign-out operations are serialized to avoid credential resurrection
  or stale writes.
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
- exact `get`, `set`, and `remove` arguments, including per-operation
  `sync: false`;
- `null`-to-missing normalization and the documented inability to distinguish
  an iOS read failure collapsed to `null`;
- normalization of `invalidData` to corrupt and thrown operational failures to
  unavailable;
- rejection of empty values;
- save, load, and clear error propagation;
- native-iOS platform gating; and
- proof that browser and Android paths never invoke the plugin.

### Refresh protocol

Unit tests cover:

- the form-encoded public-client request;
- an authorization-code response that requires a refresh token and a refresh
  response that permits its omission;
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
- successful relaunch restoration;
- retryable restoration failure and retry;
- revoked, expired, corrupt, and API-rejected sessions;
- restoration before protected-content mounting;
- non-negative proactive timer calculation;
- `appStateChange` inactive timer cancellation and active re-evaluation;
- independence from the diagnostics-only `resume` listener;
- expired-token gate closure;
- operation serialization;
- retry-action preconditions and dispatch;
- pending rotated-token save retry;
- accepted process-loss behavior for an unpersisted rotated token;
- listener and timer disposal; and
- preservation of callback-first and home-first behavior.

### Sign-out and UI

Unit and component tests cover:

- the More-page Sign out action and accessible label;
- duplicate-submission prevention and progress state;
- timer cancellation;
- process-memory cleanup;
- PKCE transaction cleanup;
- Keychain cleanup;
- cleanup retry after deletion failure;
- `dispose()` waiting behind queued sign-out while never deleting durable
  credentials on its own;
- signed-out persistence after a simulated relaunch;
- terminal-session notice copy; and
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
- relevant root regressions pass; and
- native dependency installation and Capacitor iOS synchronization are verified.

### Interactive iOS acceptance

The closure pass uses a configured iOS build and real Cognito environment:

1. sign in through Google once;
2. force-terminate Vela and relaunch it;
3. confirm the authenticated home screen restores without another Google prompt;
4. set `VELA_ACCEPTANCE_USER_POOL_ID` from the deployed
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

5. force-terminate Vela and relaunch it;
6. confirm the sign-in screen shows a clear session-expired notice;
7. sign in again, use Sign out on More, force-terminate, and relaunch;
8. confirm Vela remains signed out; and
9. inspect device logs and WebView storage to confirm no credential leakage.

The iOS Simulator is sufficient to exercise Keychain persistence and process
relaunch. If the Google/Cognito environment or native signing prevents the real
provider pass, that limitation must be reported as an explicit closure gate
rather than replaced by a mock-only claim.

## Acceptance Mapping

| HPA-206 acceptance criterion | Design coverage |
| --- | --- |
| Relaunch restores without Google prompt | Keychain refresh token + cold-launch refresh flow |
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

Rejected. Preferences is appropriate for the short-lived, token-free PKCE
transaction but is not a Keychain-backed credential store.

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
- [`@aparajita/capacitor-secure-storage` v7.1.6](https://github.com/aparajita/capacitor-secure-storage/tree/v7.1.6)
- [Secure-storage v7.1.6 public API and error types](https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/src/definitions.ts)
- [Secure-storage v7.1.6 iOS Keychain implementation](https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/ios/Plugin/Plugin.swift)
- [Amazon Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [Amazon Cognito refresh-token rotation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html#amazon-cognito-user-pools-refresh-token-rotation)
- [AWS CLI: `admin-user-global-sign-out`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-user-global-sign-out.html)
