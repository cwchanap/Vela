# iOS Foundation Architecture

## Tested Revision

`testedBehaviorCommit`: see [M1 iOS Foundation Verification](m1-ios-foundation-verification.md)
for the exact tested SHA

The automated phase passed on the tested behavior commit: the eight gates
(install, lint, typecheck, compile, build, test, production-diagnostics,
mobile-secret-scan) ran in order on a tracked-clean checkout of that
revision. The receipt is a local artifact under `.artifacts/hpa-210/` and is
not committed.

The iOS Simulator build/install/launch row passed on the same tested SHA in
the simulator class (XcodeBuildMCP build + install + launch; iPhone 16
simulator class, iOS 26.5, Xcode 26.6). It is simulator-class evidence only
and establishes no physical-device or human-observed native outcome.

The physical rows are waived by operator decision (2026-09-09
simulator-class closure), not passed: no physical production-smoke,
diagnostic, or acceptance observation was made on this revision, and the
recorded physical preflight remains historical. See
[M1 iOS Foundation Verification](m1-ios-foundation-verification.md) for the
operator-amended `GO` decision and the waived physical rows.

## Authentication and OAuth Callback

On native iOS, [the mobile-auth boot module](../src/boot/mobile-auth.ts) wires
Capacitor App, Browser, Preferences, Capacitor HTTP, and the iOS session store
into one mobile-auth coordinator. A sign-in request uses Cognito
authorization-code flow with PKCE S256, `state`, `nonce`, and
`identity_provider=Google`; the registered callback is
`dev.cwchanap.vela.oauth:/oauth/callback`.

The coordinator receives both launch URLs and `appUrlOpen` events. It accepts
only the private-use callback URI, rejects malformed or unrelated URLs before
code exchange, validates ID-token claims, and keeps OAuth progress serialized
through the coordinator. This is a source-level contract, not evidence that a
native callback run has completed.

## OAuth Transaction Storage

The transient OAuth transaction contains `state`, `codeVerifier`, `nonce`, and
`createdAt`. It is serialized as one JSON value through
`@capacitor/preferences`, backed by iOS UserDefaults, with a 10-minute TTL.
It contains no access, ID, or refresh token. The coordinator clears it after
consumption, cancellation, OAuth errors, restoration cleanup, and terminal
cleanup. UserDefaults is plaintext and may participate in device backup; M1
accepts this for short-lived, single-use correlation and verifier material,
not as an authenticated session store.

## Session Storage and Restoration

The refresh token is the only durable authenticated credential. [The native
iOS session store](../src/auth/mobile-session-store.ts) uses
`@aparajita/capacitor-secure-storage` in the Keychain with
`afterFirstUnlockThisDeviceOnly` accessibility, keyed by the Cognito user pool
and mobile client. Access and ID tokens remain in the coordinator's active
session state rather than the OAuth transaction store.

Initialization loads the refresh token, refreshes it when present, validates
the resulting ID token, and verifies the session with the API before exposing
an authenticated user. Persistence, restoration, refresh, verification, and
cleanup failures have explicit retry/terminal states; sign-out and terminal
cleanup clear the durable refresh token. The verification record must capture
any observed device behavior rather than infer it from this implementation.

## API Origin and Authenticated Transport

The mobile build supplies an absolute API origin through the validated mobile
configuration. [The authenticated transport](../src/services/mobile-auth.ts)
accepts a relative, non-escaping API path; the coordinator resolves it below
that origin and centrally supplies the standard bearer authorization header
carrying the ID token. Callers cannot override that header.

HTTPS is required for authenticated transport, except for a development-only
loopback HTTP origin. A request is rejected when its path, headers, timeout, or
session state is invalid, or when the session changes or recovery is pending.

## User-Scoped Due-Review Query Isolation

The M1 due-review count is keyed by user identity. [The isolation watcher](../src/services/mobile-query-auth-isolation.ts)
cancels and removes only the prior user's `srsKeys.stats(userId)` entry on an
identity change or terminal sign-out, rather than globally clearing the query
client. During recovery with an unusable session it cancels only that user's
in-flight query without clearing the cache. This protects a successor session
from stale cleanup work.

## Shared App Lifecycle

[The Capacitor lifecycle boot](../src/boot/capacitor-lifecycle.ts) registers
`resume` and `appStateChange` listeners once. It records diagnostic lifecycle
state and mirrors active/inactive state to TanStack Query's focus manager. The
auth coordinator separately receives Capacitor application-state, OAuth
callback, and browser-finished events, so lifecycle and authentication state
remain explicit inputs rather than page-local behavior.

## Safe Areas, Keyboard, and Navigation

The source policy is native `contentInset: "never"` with CSS ownership of the
headerless top inset. Quasar owns fixed top/bottom CSS behavior, while pages,
toolbars, and footer tabs own horizontal safe-area insets. [The keyboard
viewport composable](../src/composables/useKeyboardViewport.ts) tracks native
show/hide events and scrolls the focused block after layout.

[The mobile navigation helper](../src/router/mobile-navigation.ts) records an
app-owned `mobileDepth`: ordinary pushes and allowed in-session entry share
chronological history, a fresh cold entry replaces at depth zero, and back
falls back safely when no matching history entry settles. The historical
HPA-209 evidence remains the record for its selected layout policy; this
document does not reinterpret it as HPA-210 physical evidence.

## Audio Adapter Decision

Pending physical HPA-210 evidence

The current diagnostic implementation uses the `MobileAudioPlayer` contract
with `HtmlAudioPlayer`, including explicit stop, interruption, and disposal
outcomes. That implementation is not an adapter selection conclusion; the
decision remains deferred until the required physical evidence is recorded.

## Development Diagnostics and Production Exclusion

Interaction and pronunciation diagnostic routes are compiled only when
`import.meta.env.DEV` is true. Production verification builds Capacitor assets
and scans `src-capacitor/www/` for diagnostic markers, so a production smoke
record must not rely on a development-only route.

## Accepted Constraints

M1 accepts UserDefaults only for the short-lived, single-use OAuth transaction
described above; it does not accept it as a session store. Local signing is
tester-controlled: the iOS project intentionally has no committed development
team. The automated phase and the simulator-class build/install/launch row
passed on the tested behavior commit recorded in
[M1 iOS Foundation Verification](m1-ios-foundation-verification.md); the
physical rows were waived by operator decision, not passed, and the recorded
physical preflight remains historical and cannot establish physical status.
Physical behavior, signing readiness, and the audio decision remain
evidence-gated: the waived physical rows may be executed later under their
own evidence class, and the audio decision stays pending until the required
physical audio evidence is recorded.

## Change Policy

Update this architecture record when an implementation contract changes, with
the associated source and automated coverage changed first. Append results to
the verification record only from a local HPA-210 run receipt under
`.artifacts/hpa-210/` or a recorded manual observation; use the full
tested-behavior SHA and retain the build/config class. Do not create
placeholder pass or failure rows. A user-directed waived or deferred
physical row may identify its unrun state without a receipt or observation;
all other result rows require their actual evidence.
