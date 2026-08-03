# iOS Foundation Architecture

## Tested Revision and Evidence Linkage

`testedBehaviorCommit`:
`de276f372c7973e2fb49c81e9a78e50df95266c0`

The selected [automated](evidence/hpa-210/de276f372c7973e2fb49c81e9a78e50df95266c0/20260803T071503Z-automated/manifest.json)
and [iOS Simulator](evidence/hpa-210/de276f372c7973e2fb49c81e9a78e50df95266c0/20260803T071701Z-automated-ios-simulator/manifest.json)
machine manifests passed on that revision. The Simulator manifest records
sanitized Xcode, Bun, Quasar, and key Capacitor dependency versions without
retaining raw command output or a device identifier.

The [physical preflight](evidence/hpa-210/f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65/20260803T042801Z-physical-preflight/manifest.json)
under `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` remains historical
`prerequisite_missing` evidence. Physical-device testing was explicitly
deferred, so it is not evidence for `de276f372c7973e2fb49c81e9a78e50df95266c0`
and these machine results establish neither physical readiness nor any
human-observed native outcome. See [M1 iOS Foundation Verification](m1-ios-foundation-verification.md)
for the `NO-GO` decision and deferred physical rows.

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
team. Automated and Simulator machine evidence passed on the current selected
revision, while the `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` physical
preflight is historical and cannot establish physical status for that revision.
Physical testing remains deferred. Physical behavior, signing readiness, and
the audio decision remain evidence-gated and must be recorded by actual
physical runs.

## Change Policy

Update this architecture record when an implementation contract changes, with
the associated source and automated coverage changed first. Append results to
the verification record only from a committed HPA-210 manifest or a linked
manual observation; use the full tested-behavior SHA and retain the
build/config class. Do not create placeholder pass or failure rows. A
user-directed deferred physical row may identify its unrun state without a
manifest or observation; all other result rows require their actual evidence.
