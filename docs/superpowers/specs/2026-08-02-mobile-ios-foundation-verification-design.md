# Mobile iOS Foundation Verification and Architecture Record Design

**Linear:** HPA-210  
**Parent:** HPA-194  
**Milestone:** Mobile MVP — M1 iOS foundation spike  
**Status:** Approved design

## 1. Purpose

HPA-210 is the acceptance owner for the complete Mobile MVP Milestone 1 foundation. It does not add another product feature. It verifies that the separately implemented foundation pieces work together on a real iOS runtime, records the architecture decisions established by the spike, and issues an explicit `GO` or `NO-GO` decision before Milestone 2 begins.

The milestone exit story is:

> A user installs Vela on an iPhone, signs in with Google, returns through the iOS callback, relaunches into a restored session, sees the authenticated due-review count, hears one Japanese pronunciation, and can recover from expected authentication, network, playback, keyboard, and navigation failures.

Automated tests establish source-level and artifact-level confidence. Simulator and physical-iPhone runs establish native behavior. Neither substitutes for the other.

## 2. Current State and Tracking Ownership

The implementation work is present across HPA-202 through HPA-209. Several implementation pull requests merged while explicitly deferring live native acceptance. Their Linear issues therefore remain `In Review` until HPA-210 records the missing evidence:

- HPA-202 — physical-device installation and launch.
- HPA-205 — live Google OAuth and warm/cold callback behavior.
- HPA-206 — relaunch restoration, refresh, sign-out, and reinstall cleanup.
- HPA-207 — authenticated due-count and identity/cache isolation.
- HPA-208 — Simulator and physical-iPhone pronunciation playback.
- HPA-209 — physical Japanese IME and WKWebView navigation behavior.

HPA-203 and HPA-204 remain complete configuration/infrastructure inputs unless verification exposes a defect in their ownership area.

HPA-210 is the single milestone acceptance owner. The source issues are related evidence sources rather than blockers. This avoids a circular dependency in which HPA-210 must perform evidence required to complete issues that formally block HPA-210.

### Completion semantics

- An implementation pull request may merge before native acceptance when its issue explicitly separates merge and closure gates.
- An M1 source issue may be `Done` only after its required evidence exists or HPA-210 links a consolidated evidence row that satisfies it.
- HPA-210 may be `Done` only after the final `GO` or `NO-GO` record is complete, every deferred risk has a Linear issue, and HPA-194 receives the milestone summary.

## 3. Design Principles

1. **One tested commit.** All final matrices refer to one exact repository commit. Any fix invalidating observed behavior requires rerunning affected rows.
2. **Observation, not inference.** A UI event, media event, automated test, or source review cannot be reported as physical speaker audibility, Japanese IME correctness, or native navigation success.
3. **No secret-bearing evidence.** Logs, screenshots, environment manifests, and build artifacts are inspected and sanitized before commit or attachment.
4. **Automate deterministic checks only.** Source, component, bundle, build, install, launch, and process assertions are automated. Human-dependent behavior remains a controlled manual matrix.
5. **Preserve subsystem ownership.** HPA-210 consumes existing auth, API, query, audio, lifecycle, and navigation interfaces. It does not bypass them with a milestone-only implementation.
6. **Failures produce tracked work.** A failed or deferred criterion has reproduction evidence, severity, owner, target milestone, and a Linear issue.
7. **No milestone pass by partial aggregation.** Strong automated coverage does not compensate for a missing physical exit criterion.

## 4. Repository Artifacts

HPA-210 produces these durable artifacts.

### 4.1 Architecture record

Create `apps/vela-mobile/docs/ios-foundation-architecture.md`.

This document records stable decisions that later mobile features must follow:

- authentication and token-storage ownership;
- OAuth callback strategy and callback lifecycle;
- absolute API-origin and CORS policy;
- authenticated transport and query/cache isolation;
- mobile lifecycle ownership;
- safe-area, keyboard, and navigation policy;
- audio adapter boundary and the HPA-208 playback conclusion;
- development diagnostic isolation from production artifacts;
- known constraints that intentionally survive M1.

It is not a timestamped test report. Subsequent implementation changes must update it when they change a recorded boundary.

### 4.2 Verification record

Create `apps/vela-mobile/docs/m1-ios-foundation-verification.md`.

Use these top-level sections:

```markdown
# M1 iOS Foundation Verification

## Final Decision
## Tested Build and Environment
## Automated Verification
## Simulator Matrix
## Physical iPhone Matrix
## Security and Secret Scan
## Architecture Decisions
## Known Limitations and Follow-up Issues
## Source-Issue Closure Mapping
## Milestone 2 Recommendation
```

The file is initially a complete schema and instruction set, not a pre-filled claim. A result row is added only after that environment and scenario has been run.

### 4.3 Evidence directory

Create `apps/vela-mobile/docs/evidence/hpa-210/` for sanitized, repository-worthy evidence.

Allowed evidence includes:

- screenshots without personal account data or transient OAuth values;
- bounded console excerpts with sensitive values removed;
- generated non-secret environment manifests;
- command output needed to prove build, install, or launch;
- hashes identifying larger local-only artifacts that should not be committed.

Do not commit DerivedData, full Xcode archives, raw device logs, provider API responses, bearer tokens, refresh tokens, authorization codes, PKCE verifiers, presigned query strings, account email addresses, or device identifiers that are unnecessary for reproduction.

### 4.4 Verification harness

Add `apps/vela-mobile/scripts/verify-m1-foundation.mjs` with a package script named `verify:m1-foundation`.

The harness exposes explicit phases rather than silently skipping unsupported checks:

- `--phase automated` — cross-platform source, tests, production assets, diagnostics exclusion, and secret scanning.
- `--phase ios-simulator` — macOS-only native build, install, launch, and process assertion.
- `--phase all` — runs both and fails when native prerequisites are unavailable.

CI may run `--phase automated` on Linux. The milestone closure record must include a successful macOS `--phase ios-simulator` or `--phase all` run against the final tested commit.

The harness returns nonzero on any failed command, missing expected artifact, detected sensitive marker, native launch failure, or incomplete generated manifest. It never converts an unsupported native phase into a passing result.

## 5. Automated Verification Design

### 5.1 Cross-platform phase

The automated phase runs from a clean checkout with a frozen lockfile and executes the established repository gates:

1. dependency installation;
2. repository lint;
3. repository type-checking;
4. repository unit tests and configured coverage thresholds;
5. mobile production asset build through the normal environment-validation path;
6. production diagnostic exclusion scan;
7. secret/token scan over committed mobile files and generated production assets;
8. generation of a non-secret command/result manifest.

The harness reuses existing scripts rather than reimplementing their assertions. It captures command name, exit status, start/end timestamps, tested commit, and relevant artifact paths. It does not capture command environments wholesale.

### 5.2 Secret and token scan

The scan covers:

- tracked source and configuration under `apps/vela-mobile`;
- generated `src-capacitor/www` assets;
- iOS plist, entitlements, project, and resolved package configuration;
- selected Xcode build settings and application bundle resources;
- evidence files staged for HPA-210;
- captured logs selected for attachment.

The scanner looks for both structural and sentinel evidence:

- OAuth authorization codes and PKCE verifier field names in runtime output;
- `Authorization: Bearer` values;
- JWT-shaped values;
- Cognito refresh/access/ID token storage outside the approved secure-storage path;
- provider API-key names paired with non-placeholder values;
- AWS secret values or private keys;
- full presigned TTS URLs containing query credentials;
- known test sentinels used by existing leakage tests;
- development diagnostic route labels or markers in production assets.

Configuration identifiers that are intentionally public—Cognito pool IDs, public client IDs, regions, callback schemes, API origins, and non-secret provider/model identifiers—are not treated as secrets. The scan must distinguish these from credentials.

A finding fails the phase until it is removed or explicitly classified as a verified false positive in the verification record with the matching bounded value class. Raw credential-like values are never copied into that explanation.

### 5.3 Native Simulator launch phase

The macOS phase:

1. records `git rev-parse HEAD`, `xcodebuild -version`, `bun --version`, resolved Quasar/Capacitor/plugin versions, selected Simulator model, and Simulator iOS runtime;
2. builds production WebView assets and synchronizes Capacitor;
3. builds the `App` scheme from `App.xcworkspace` for an explicit Simulator destination;
4. boots the selected Simulator when required;
5. installs the built application bundle;
6. launches the application by bundle identifier;
7. asserts that launch succeeds and the process remains alive for the bounded smoke interval;
8. captures bounded launch output and writes the environment/result manifest;
9. terminates only the test-launched application process.

The native launch check proves project integrity, installation, and startup. It does not claim authenticated OAuth, TTS audibility, Japanese input, or navigation behavior.

### 5.4 CI boundary

M1 does not add a permanent macOS native-test job solely to close HPA-210. The existing Linux mobile test job continues to run automated source and asset checks. A permanent macOS CI lane, native UI automation, signing automation, and TestFlight automation remain release-readiness work under HPA-194 Milestone 5.

## 6. Verification Matrix Design

Every environment table includes:

- exact commit SHA;
- date and local time zone;
- build configuration;
- packaged assets or development server source;
- Simulator/device model;
- iOS version;
- Xcode version;
- app version/build number;
- non-secret account alias;
- scenario precondition;
- observed result;
- `PASS`, `FAIL`, or `BLOCKED` status;
- evidence path or bounded note;
- follow-up issue for every `FAIL` or accepted `BLOCKED` row.

`PARTIAL` is allowed during work but cannot satisfy a closure criterion.

### 6.1 Installation and authentication lifecycle

Run on the final Simulator and physical iPhone where applicable:

1. fresh application installation and first launch;
2. fresh Google sign-in using the system browser;
3. direct-provider redirect and callback return;
4. warm callback while the app process is active;
5. cold-start callback launching the app;
6. cancellation recovery;
7. missing-code, provider-error, malformed-callback, and state-mismatch recovery;
8. late or duplicate callback behavior;
9. force-close and relaunch restoration without another Google prompt;
10. proactive refresh and app-resume refresh;
11. revoked/non-refreshable session recovery;
12. local sign-out;
13. relaunch after sign-out remains signed out;
14. reinstall residue cleanup where Keychain retention would otherwise restore the prior installation.

Successful OAuth evidence records state transitions and outcomes, never codes, verifiers, tokens, or complete callback URLs.

### 6.2 Authenticated API and due-count behavior

Verify:

1. restored authentication reaches Home;
2. positive `due_today` agrees with the web app or a direct authenticated API observation for the same account and time window;
3. zero-due state renders correctly;
4. loading and explicit manual refresh behavior;
5. foreground/resume refresh;
6. disabled-network failure and successful retry;
7. request timeout recovery;
8. server failure and malformed-response handling;
9. rejected/expired token recovery;
10. terminal authentication failure returns to the auth gate;
11. sign-out removes the previous user’s due-count data;
12. signing in as another account cannot show the previous account’s cached data;
13. a pending request cannot block sign-out or lifecycle cleanup.

Where a comparison value may change during testing, record both values and timestamps rather than requiring a stale screenshot to remain numerically equal later.

### 6.3 TTS pronunciation behavior

Use the fixed non-secret diagnostic vocabulary established by HPA-208 and verify:

1. restored authentication and configured TTS settings;
2. first server-cache request;
3. genuinely uncached generation;
4. loading/preparation state;
5. first user-gesture playback attempt;
6. prepared direct-tap playback;
7. correct and audible Japanese pronunciation through the physical iPhone speaker;
8. ten prepared replays without intermittent silence, overlap, or stuck state;
9. rapid taps during preparation and playback;
10. authentication failure;
11. TTS generation failure;
12. disabled-network failure and retry;
13. expired or invalid presigned URL recovery;
14. playback decoding/error recovery;
15. background during preparation and playback;
16. foreground replayability;
17. sign-out while ready and while playing;
18. external/system audio interruption;
19. Ring/Silent off behavior;
20. Ring/Silent on behavior;
21. relaunch and replay.

Human observation is required for audibility and pronunciation correctness. Media events alone are insufficient.

The resulting architecture decision is exactly one of:

- `HTML-only accepted`
- `native audio-session integration required`
- `native player adapter required`

If silent mode is the only failed requirement and HTML decoding/lifecycle are otherwise reliable, create a narrowly scoped native audio-session issue while retaining `HtmlAudioPlayer`. If HTML playback remains unreliable after correct origin and audio-session handling, create a native `MobileAudioPlayer` implementation issue naming each failed criterion.

### 6.4 Japanese input, keyboard, safe area, and navigation

Verify on a physical iPhone:

1. Japanese Kana keyboard composition;
2. draft composition, committed model, native input value after render, and submitted value all equal `日本語`;
3. no validation or submission while composition is active;
4. focused input remains visible in portrait;
5. focused input and primary action remain reachable in landscape;
6. keyboard dismissal restores the viewport and footer without a stale gap;
7. top and bottom safe areas on a notched or Dynamic Island device;
8. left and right landscape sensor-region avoidance;
9. visible back returns to the exact previous app route;
10. native swipe-back and swipe-forward behavior;
11. repeated tab switching does not duplicate, blank, close, or trap the app;
12. validated in-session deep entry;
13. cold deep entry at depth zero;
14. app resume without a new entry event is a navigation no-op;
15. saved scroll restoration on back and forward;
16. portrait functionality and the documented landscape policy.

The expected baseline remains native `ios.contentInset: "never"` with app CSS owning the headerless top safe area, fixed surfaces owning their appropriate insets, and app-owned chronological mobile navigation depth.

### 6.5 Failure-state recovery

For auth, API, playback, and navigation failures, verify that the app has one of these bounded outcomes:

- retry in place;
- return to a stable signed-out gate;
- stop active media and remain replayable;
- return to a valid route;
- explain the unsupported or terminal state without protected-content leakage.

The following are milestone failures:

- indefinite loading without a recovery action;
- protected content briefly shown before auth restoration completes;
- another user’s cached data shown;
- duplicated or overlapping playback caused by ordinary taps;
- a blank frame, app exit, or navigation trap;
- unrecoverable keyboard obstruction;
- credentials or transient OAuth material in visible UI, logs, source, or artifacts.

## 7. Architecture Record

The final architecture document records these established boundaries.

### 7.1 Authentication and storage

- The mobile app uses a dedicated public Cognito client with authorization-code grant and PKCE.
- Google authentication occurs through the system browser.
- The app owns warm, cold, late, malformed, and duplicate callback handling.
- Only the refresh token required for restoration is retained in device-bound, non-synchronizing iOS Keychain storage.
- Access and ID tokens remain memory-only.
- Installation identity prevents stale Keychain material from restoring a previous installation.
- Auth initialization gates protected routing and rendering.
- Sign-out and terminal recovery clear retained credentials and user-scoped feature state.

### 7.2 API origin and transport

- Native builds use an absolute validated API base URL.
- Approved Capacitor origins are exact; wildcard CORS is forbidden.
- Existing web and extension origin behavior remains intact.
- Feature code does not receive raw token-storage ownership.
- The auth coordinator injects one current bearer token, bounds attempts, performs guarded single-flight unauthorized recovery, and prevents stale-generation mutation.
- Feature requests do not block sign-out or coordinator disposal.

### 7.3 Query and user-data isolation

- Shared contracts and query keys may be reused without importing complete web pages.
- User-specific query keys contain the user identity.
- Identity loss and sign-out cancel then remove only the previous user’s scoped data.
- No global query-cache clearing is introduced solely for this milestone.

### 7.4 Lifecycle

- One shared Capacitor lifecycle service owns app active/inactive observation.
- Auth refresh, due-count refresh, and audio interruption consume that shared state rather than registering competing native listeners.
- Resume is not itself a navigation event.

### 7.5 iOS layout and navigation

- Native content inset is `never`.
- CSS owns the headerless top safe area; fixed toolbar/footer and page content each own their defined edges exactly once.
- App-owned chronological route depth drives visible back and native swipe history.
- A fresh cold entry replaces at depth zero; a validated in-session entry participates in ordinary history.

### 7.6 Audio

- Learning features depend on the browser-free `MobileAudioPlayer` contract.
- `HtmlAudioPlayer` is the current implementation candidate.
- The physical verification result determines whether HTML remains sufficient, requires minimal native audio-session configuration, or must be replaced by a native player adapter.
- Provider credentials remain server-side and no provider API key is bundled in the app.

### 7.7 Diagnostics

- Native-only validation may use authenticated development diagnostic routes and pages.
- Production builds compile out diagnostic entries, labels, routes, test IDs, and markers.
- Production artifact scanning is a merge and milestone gate.

## 8. Findings, Severity, and Follow-up Issues

Every unresolved finding contains:

- concise title;
- affected criterion;
- severity;
- exact environment and tested commit;
- reproduction steps;
- observed and expected behavior;
- bounded evidence reference;
- owner;
- target milestone;
- Linear issue.

Severity policy:

- **Critical:** credential exposure, cross-user data leakage, unusable authentication, unrecoverable corruption, or an unresolved architecture ambiguity that prevents safe M2 work. Always blocks `GO`.
- **High:** failure of an M1 exit behavior on the supported physical iPhone, including relaunch restoration, due-count retrieval, acceptable pronunciation playback, Japanese IME, or non-trapping navigation. Blocks `GO` until fixed or until the accepted architecture decision moves the required fix into a specifically linked pre-M2 gate.
- **Medium:** bounded limitation that does not invalidate the exit story and has a clear M2 or release-readiness owner. May accompany `GO` with a linked issue.
- **Low:** polish or observability limitation that is safely deferred. May accompany `GO` with a linked issue.

Prose-only deferral is not allowed.

## 9. GO/NO-GO Decision

The final decision is exactly `GO` or `NO-GO`.

### 9.1 GO requirements

All of the following must be true on the final tested commit:

- automated repository, production asset, diagnostics-exclusion, and secret-scan gates pass;
- native Simulator build, install, and launch pass;
- physical iPhone install and launch pass;
- fresh Google sign-in and warm/cold callback return pass;
- force-close/relaunch restores a valid session;
- authenticated due-count is correct and identity-isolated;
- one acceptable physical Japanese pronunciation path is selected and demonstrated;
- Japanese IME composition/submission passes;
- keyboard, safe-area, visible-back, and native navigation have recorded non-trapping results;
- expected auth, network, and playback failures recover to a stable state;
- no Critical finding remains;
- every deferred Medium or Low risk has a Linear issue and target milestone;
- the architecture record has no unresolved decision required to begin M2.

### 9.2 NO-GO conditions

Report `NO-GO` when any required row is unrun, blocked without an accepted pre-M2 gate, failed, or invalidated by a later code change; when a secret scan fails; or when the audio architecture conclusion is not selected.

`NO-GO` is a useful milestone result. It names the minimum issues that must close before rerunning the decision. HPA-210 remains open until a later run produces a complete decision record.

## 10. Source-Issue and Parent Updates

After final verification:

1. Add a concise evidence comment to HPA-202 and HPA-205 through HPA-209 identifying the tested commit, relevant matrix rows, result, and follow-up issue where applicable.
2. Return a source issue to `Done` only when its acceptance evidence is satisfied.
3. Add the complete result to HPA-210 with links to the architecture record, verification record, evidence directory, implementation pull request, and follow-up issues.
4. Update HPA-194 with:
   - final `GO` or `NO-GO`;
   - tested commit and device summary;
   - concise M1 evidence summary;
   - accepted architecture limitations;
   - recommended first M2 issues.

For a `GO`, the recommended M2 start is the smallest end-to-end core review path: mobile Home/Review navigation, a real ten-card SRS session, rating and pronunciation behavior, then durable outbox and backend idempotency. Exact issue order is confirmed from current M2 ticket readiness at closeout time.

## 11. Non-Goals

HPA-210 does not include:

- the SRS review session itself;
- durable review outbox or backend idempotency implementation;
- Android verification;
- TestFlight or App Store distribution;
- permanent macOS CI or full native UI automation;
- accessibility certification;
- final visual polish;
- AI buddy, microphone, speech-to-text, or background audio;
- unrelated refactoring of the existing mobile foundation.

## 12. Alternatives Considered

### Evidence-only closeout

Rejected because it would leave deterministic verification fragmented across prior implementation plans and make future native closeout difficult to reproduce.

### Full native UI automation in M1

Rejected because OAuth provider interaction, human audio confirmation, Japanese IME observation, and speaker behavior still require controlled manual checks. Building a full native test stack would materially expand the spike and belongs in release readiness.

### Consolidated verification harness and manual native matrix

Selected because it automates repeatable source/build/launch evidence while preserving explicit human observation for behavior automation cannot honestly establish.

## 13. Design Completion Check

- No unresolved implementation decision is required to write the implementation plan.
- No required evidence row is pre-declared as passing.
- Automated and manual evidence have distinct ownership.
- Secret-handling rules cover source, artifacts, logs, and screenshots.
- Source-ticket state semantics and HPA-210 ownership are explicit.
- GO/NO-GO conditions are deterministic.
- Deferred risks require Linear issues.
- Scope remains limited to M1 verification and architecture closeout.
