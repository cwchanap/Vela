# Mobile iOS Foundation Verification and Architecture Record Design

**Linear:** HPA-210  
**Parent:** HPA-194  
**Milestone:** Mobile MVP — M1 iOS foundation spike  
**Status:** Approved in project discussion; repository review in PR #56

## 1. Purpose and acceptance ownership

HPA-210 is the single acceptance owner for the complete Mobile MVP Milestone 1 foundation. It does not add another product feature. It verifies that the separately implemented foundation pieces work together on real iOS runtimes, records the architecture established by the spike, and issues an explicit `GO` or `NO-GO` before Milestone 2 begins.

The milestone exit story is:

> A user installs Vela on an iPhone, signs in with Google, returns through the iOS callback, relaunches into a restored session, sees the authenticated due-review count, hears one Japanese pronunciation, and recovers from expected authentication, network, playback, keyboard, and navigation failures.

HPA-202 and HPA-205 through HPA-209 remain `In Review` until HPA-210 links evidence satisfying their native closure gates. They are related evidence sources, not formal blockers. HPA-203 and HPA-204 remain complete infrastructure inputs unless verification exposes a defect in their ownership area.

An implementation PR may merge before native acceptance when its ticket explicitly separates merge and closure gates. HPA-210 may move to `Done` only after a complete `GO`, every deferred risk has a Linear issue, and HPA-194 receives the milestone summary. A complete `NO-GO` is preserved as useful evidence, but HPA-210 remains open for corrective work and rerun.

## 2. Design principles

1. **One tested behavior commit.** Every executable matrix row and machine-generated manifest pins one exact `testedBehaviorCommit`: the commit containing the app, native project, configuration, dependencies, and verification tooling that produced the observed behavior. A later commit containing only documentation, manifests, or evidence references does not invalidate those rows. Any change to executable source, build/native configuration, dependency locks, generated assets, or verification tooling creates a new behavior commit and reruns affected gates. The resulting documentation/evidence commit is linked from HPA-210 and HPA-194 through normal Git history; it is not self-embedded as a second manifest SHA.
2. **Observation, not inference.** Unit tests, media events, or Simulator behavior cannot be reported as physical speaker audibility, Japanese IME correctness, or native gesture success.
3. **No pass by partial aggregation.** Strong automated coverage does not compensate for a missing physical exit criterion.
4. **Two native build classes.** Production product behavior and development-only diagnostic behavior are verified separately on the same commit and deployed backend.
5. **No secret-bearing evidence.** Source, artifacts, logs, screenshots, and manifests are scanned and sanitized.
6. **One canonical source per fact class.** Stable architecture, final milestone results, and historical HPA-209 measurements link to one another instead of duplicating tables.
7. **Failures produce tracked work.** Every failed or deferred criterion has severity, owner, target milestone, evidence, and a Linear issue.

## 3. Repository artifacts and fact ownership

### 3.1 Stable architecture record

Create `apps/vela-mobile/docs/ios-foundation-architecture.md`.

It records stable boundaries for:

- mobile Cognito OAuth, PKCE, callback, and token-storage ownership;
- absolute API origin, CORS, authenticated transport, and user-data isolation;
- shared lifecycle ownership;
- safe-area, keyboard, and navigation policy;
- `MobileAudioPlayer` and the final HPA-208 audio conclusion;
- development diagnostic exclusion from production;
- known constraints that intentionally survive M1.

The file may be scaffolded early, but its final factual claims are written or reconciled from the exact tested commit. The audio conclusion remains unset until physical verification selects one of:

- `HTML-only accepted`
- `native audio-session integration required`
- `native player adapter required`

`apps/vela-mobile/docs/ios-interaction-baseline.md` remains the canonical detailed HPA-209 measurement and historical evidence record. The architecture record links to it for rationale and extracts only the stable selected policy and reusable rules; it does not copy its numeric tables, screenshots, hashes, or old environment rows.

### 3.2 Final verification record

Create `apps/vela-mobile/docs/m1-ios-foundation-verification.md` with:

```markdown
# M1 iOS Foundation Verification

## Final Decision
## Tested Build and Environment
## Automated Verification
## Production Smoke Matrix
## Diagnostic Observation Matrix
## Physical iPhone Matrix
## Security and Secret Scan
## Architecture Decisions
## Known Limitations and Follow-up Issues
## Source-Issue Closure Mapping
## Milestone 2 Recommendation
```

Rows are added only after they are run. `Architecture Decisions` is a concise tested-revision summary and pointer to `ios-foundation-architecture.md`, not a second copy. Existing HPA-209 Simulator rows remain historical evidence; HPA-210 records fresh load-bearing rows on the final tested commit.

### 3.3 Versioned evidence and manifests

Store append-only evidence under:

```text
apps/vela-mobile/docs/evidence/hpa-210/<full-commit-sha>/<run-id>/
```

`<run-id>` is `<UTC timestamp>-<phase-or-matrix-class>`, such as `20260803T021500Z-production-smoke`. Runs never overwrite one another, and no mutable `latest` symlink is used. The verification record identifies the selected final run IDs while preserving earlier `NO-GO` runs.

Each run directory commits `manifest.json` and small bounded text evidence only. Screenshots, videos, raw logs, archives, and other growth-prone artifacts remain local or are attached to the relevant PR/Linear issue; the manifest records their storage reference, byte size, media type, and SHA-256 hash. A binary artifact is committed only when it is both small and load-bearing for future review. This keeps repeated `NO-GO` runs auditable without unbounded repository growth.

The existing flat `docs/evidence/hpa-209/*.png` layout is preserved as historical HPA-209 evidence and is not reorganized into the HPA-210 run structure.

The manifest records:

- schema version, run ID, `testedBehaviorCommit`, phase, matrix class, timestamps, outcome, and exit code;
- non-secret host, Xcode, iOS, Bun, Quasar, Capacitor, and plugin versions;
- configuration source/class and public origins;
- non-secret device or Simulator alias/model;
- bounded command statuses and elapsed times;
- evidence paths and SHA-256 hashes;
- finding and Linear-issue references.

It never records a device UDID, account email, complete environment, full OAuth callback URL, token, code, verifier, provider response, or presigned query string. Do not commit DerivedData, archives, raw device logs, or credential-bearing responses.

### 3.4 Developer guidance synchronization

HPA-210 updates `CLAUDE.md`:

- replace the stale statement that PKCE, `state`, `nonce`, mobile client wiring, and `identity_provider=Google` are future M2 work;
- point pending HPA-209 physical validation to HPA-210;
- after closeout, link the final architecture and verification records instead of copying their matrices.

Before PR #56 leaves draft review, update this design header to reflect repository approval. It must not claim repository review is pending after merge.

## 4. Verification harness

Add `apps/vela-mobile/scripts/verify-m1-foundation.mjs` and package script `verify:m1-foundation`.

### 4.1 Phases

- `--phase automated` — clean-install, root repository gates, production assets, diagnostic exclusion, secret scan, and manifest.
- `--phase ios-simulator` — macOS Simulator build, install, launch, and process-alive smoke.
- `--phase ios-physical-preflight` — connected-device, trust, Developer Mode, signing, and build-setting readiness; it does not replace human observation.
- `--phase all` — all machine-checkable phases; it requires the configured physical device.

Linux CI may run `automated`. Final closure requires successful `automated`, `ios-simulator`, and `ios-physical-preflight` manifests on the same commit, plus both manual native matrix classes.

### 4.2 Exit and outcome contract

- exit `0`, `passed`
- exit `2`, `usage_error`
- exit `3`, `prerequisite_missing`
- exit `4`, `gate_failed`
- exit `1`, `harness_error`

Missing tools, configuration, Simulator, device, trust, Developer Mode, signing team, or provisioning are prerequisites, not product failures. The harness records the failed preflight without dumping sensitive inputs.

## 5. Automated verification

### 5.1 Final monorepo freeze gates

The implementation adds a root `compile` script (`turbo compile`) and a matching Turbo task so workspaces that expose `compile` participate in the freeze gate. The final automated phase runs:

1. `bun install --frozen-lockfile`
2. `bun run lint`
3. `bun run typecheck`
4. `bun run compile`
5. `bun run build`
6. `bun run test`
7. `bun run --cwd apps/vela-mobile verify:production-diagnostics`
8. HPA-210 secret scanning
9. manifest generation

The root gates are intentional: HPA-210 must not declare the shared frozen commit ready while another workspace is red under its applicable repository contract. `typecheck` covers workspaces that define that task, `compile` covers API/extension-style explicit compiler tasks, and `build` covers build-time checkers and package compilation. `lint` still applies only where a workspace defines lint; the manifest records every actual Turbo task and skipped workspace rather than claiming nonexistent lint coverage. Focused mobile/common/API/CDK commands are encouraged during implementation, but do not replace these fresh freeze gates.

`verify:production-diagnostics` is authoritative for production mobile assets and diagnostic exclusion. It invokes `build:ios:assets` and `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`. The HPA-210 harness calls that package script and never forks its forbidden-token list. HPA-210 widens the existing scanner from JavaScript-only traversal to an explicit text-artifact allowlist covering `.js`, `.mjs`, `.cjs`, `.html`, `.css`, `.json`, `.map`, `.txt`, `.svg`, and `.xml`; binary files remain skipped. Scanner tests place forbidden tokens in each supported artifact class and prove that source maps and top-level HTML are not blind spots.

### 5.2 Secret scan ownership

Create one pure policy module:

`apps/vela-mobile/build/mobile-secret-policy.ts`

It contains sentinel classes, credential-like patterns, public-identifier allowlists, and bounded false-positive classifications without DOM or Vitest dependencies. `build/` is used because the module is build/verification infrastructure shared by Bun scripts and tests rather than browser application code.

Create the executable scanner:

`apps/vela-mobile/scripts/scan-mobile-secrets.mjs`

It exports its scan function for tests and is invoked by `verify-m1-foundation.mjs`. Both the scanner and existing `src/test/secret-leak-helpers.ts` consume the shared policy.

- `secret-leak-helpers.ts` remains the runtime log/DOM/storage assertion adapter.
- `scan-mobile-secrets.mjs` owns tracked-source, generated-artifact, native-resource, captured-log, and evidence-file inspection.
- the mobile lint script is extended to include `scripts/**/*.{mjs,js,ts}` so both GO-gating scripts are linted; the ESLint configuration supplies the required Node globals.
- tests import the same pure policy and cover positive findings, public-identifier allowlists, bounded false positives, and scanner path/type handling.

The scan checks for embedded credentials, unsafe logging/rendering, bearer values, JWT-shaped values outside mock fixtures, provider/AWS keys, private keys, token material outside the approved storage boundary, full presigned URLs, and known leakage sentinels. Public pool/client IDs, regions, callback schemes, API origins, and non-secret provider/model identifiers remain allowed.

A finding fails until removed or classified by bounded value class; raw credential-like values are never copied into the record.

### 5.3 Production mobile configuration prerequisite

Any production asset phase preflights all five build variables using the same precedence and validation contract as `build/validate-mobile-api-url.ts`:

- `VITE_MOBILE_API_URL`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID`
- `VITE_COGNITO_OAUTH_DOMAIN`
- `VITE_AWS_REGION`

They may come from generated `.env.production` or explicit process environment values. Missing or malformed values are `prerequisite_missing` before Quasar runs.

For closure:

- normal validation must execute;
- `MOBILE_SKIP_ENV_VALIDATION=true` is forbidden;
- the values must identify the deployed environment under test;
- `example.invalid`, localhost, placeholders, or a different backend/client cannot satisfy `GO`.

Compile-only CI may use documented placeholders while exercising the normal validator; that run is classified `placeholder`, not closure evidence.

The manifest records config source (`.env.production` or `process_env`), class (`deployed` or `placeholder`), API origin, region, OAuth domain, and public identifier consistency—never the complete environment.

### 5.4 Simulator and physical preflights

The Simulator phase records tool/runtime versions, uses the `iphonesimulator` SDK, and does not require a development team. The implementation plan uses `CODE_SIGNING_ALLOWED=NO` where supported.

The physical path uses a development-team-signed personal iPhone controlled by the tester. The committed project keeps automatic signing and no `DEVELOPMENT_TEAM`.

Physical preflight:

1. resolves a connected device through `xcrun devicectl list devices`;
2. confirms availability, trust, and Developer Mode;
3. runs `xcodebuild -showBuildSettings` for `App.xcworkspace`, scheme `App`, Debug configuration, and the physical destination;
4. requires a resolved non-empty `DEVELOPMENT_TEAM` and usable signing/provisioning;
5. records only a non-secret device alias/model and whether signing resolved.

The team may come from an explicit local input, untracked xcconfig, or Xcode user configuration. The harness never writes it into the committed project. Missing device/signing readiness is exit `3`. Physical build/install/launch may be captured through Xcode or `xcodebuild` plus `devicectl`; Linux CI never claims it.

### 5.5 Verified WebView asset immutability

After `verify:production-diagnostics` produces and scans `src-capacitor/www`, no Quasar build may run before the corresponding production smoke. In particular, `bun run build:ios`, `bun run build:ios:ide`, `bun run build:ios:assets`, and a second `verify:production-diagnostics` invocation are forbidden after the selected artifact hash is recorded because they rebuild or replace `www`.

When an explicit sync is needed, use:

```bash
cd apps/vela-mobile/src-capacitor
bunx cap sync ios
```

Hash `src-capacitor/www` before and after sync and fail if it changes. `cap sync` may copy from the configured `webDir` and run CocoaPods; it must not rebuild or replace the verified artifact.

Permanent macOS CI, native UI automation, signing automation, and TestFlight remain HPA-194 Milestone 5 work.

## 6. Native matrix classes

HPA-210 requires both build classes on the same commit and against the same deployed API, user pool, mobile client, OAuth domain, and region.

| Matrix class | Build | Config | What it proves |
| --- | --- | --- | --- |
| Production smoke | Release/production Capacitor assets that passed `verify:production-diagnostics` | `deployed` | artifact/secret gates; install/launch; product OAuth, restoration, Home/due-count, sign-out, and product-surface recovery |
| Diagnostic observation | Debug development via `bun run dev:ios`, `quasar dev -m capacitor -T ios`, or equivalent packaged Debug-development build | same deployed API/Cognito identity | authenticated TTS diagnostic, Japanese IME, keyboard, safe-area, orientation, and navigation probes |
| Final GO | union of both | same commit and backend identity | complete milestone decision |

Debug diagnostics may call the deployed API and Cognito endpoints. Their config source is recorded. They must not use placeholders, localhost, an unrelated client/backend, or validation bypass for closure. Diagnostics remain absent from the production artifact; the production scan is never relaxed.

### 6.1 Environment ownership

| Scenario | Simulator role | Physical requirement |
| --- | --- | --- |
| Build/install/launch/process alive | required automated smoke | required production-smoke install and launch |
| Fresh Google sign-in; direct-provider, warm, and cold callback | supplemental where interaction works | required for `GO` |
| Relaunch, refresh, due-count, sign-out, auth/network recovery | supplemental | required for `GO` |
| TTS state/error/replay controller | supplemental diagnostic evidence | correct speaker pronunciation, replay reliability, silent mode, and interruption are physical-only |
| Japanese Kana IME, edge swipe, sensor-region safe areas | historical/focused Simulator evidence supports diagnosis | physical observation required |
| Diagnostic exclusion and artifact secret scan | automated artifact gate, no UI claim | the same scanned artifact is used for physical production smoke |

A Simulator-only OAuth, restoration, due-count, TTS, IME, or navigation result never satisfies the physical milestone criterion.

### 6.2 Common fields

Every row records commit, timestamp/time zone, matrix class, build configuration, asset source, model, OS, Xcode, app version/build, non-secret account/device alias, config source/class, precondition, observation, status (`PASS`, `FAIL`, `BLOCKED`, or working-only `PARTIAL`), evidence path, and follow-up issue.

`PARTIAL` cannot satisfy closure.

## 7. Required scenarios

### 7.1 Production installation, auth, and session lifecycle — physical required

- fresh install and first launch;
- fresh Google sign-in in the system browser;
- direct-provider redirect;
- warm and cold-start callbacks;
- cancellation, missing code, provider error, malformed callback, state mismatch, late/duplicate callback;
- force-close and relaunch restoration;
- proactive and resume refresh;
- revoked/non-refreshable session recovery;
- sign-out and signed-out relaunch;
- reinstall residue cleanup.

Evidence records transitions and outcomes, never codes, verifiers, tokens, or full callback URLs.

### 7.2 Authenticated due-count — physical required

- restored auth reaches Home;
- positive and zero `due_today`;
- timestamped comparison with web/API;
- loading and manual refresh;
- foreground refresh;
- disabled network, timeout, server failure, malformed response, and retry;
- rejected/expired-token recovery;
- terminal auth returns to the auth gate;
- sign-out clears prior-user data;
- a second account cannot see prior cached data;
- pending requests do not block sign-out or lifecycle cleanup.

### 7.3 TTS diagnostic and physical audio

Use the fixed HPA-208 diagnostic vocabulary and verify preparation, server cache, uncached generation, loading, first-tap, prepared replay, ten replays, rapid taps, auth/generation/network/expiry/decoding failures, background/foreground, sign-out, interruption, and relaunch.

Physical-only observations include correct built-in-speaker pronunciation, replay reliability, silent mode, and system interruption.

For silent-mode rows:

- keep media volume nonzero;
- record device model and control used;
- use the Ring/Silent switch when present;
- on Action Button devices, use an Action Button configured for Silent Mode or the system Silent Mode control and confirm the system indicator;
- Focus mode alone is not the silent-mode control.

Media events never substitute for human audibility.

### 7.4 Japanese input, keyboard, safe area, and navigation — physical required

Use a development-team-signed personal iPhone controlled by the tester, with a notch or Dynamic Island for safe-area rows. Record aliases, not email or UDID.

Verify:

- Japanese Kana composition;
- draft, committed model, post-render native value, and submitted value all equal `日本語`;
- no validation/submission while composing;
- focused input and primary action remain reachable in portrait and landscape;
- keyboard dismissal restores viewport/footer without stale gap;
- top/bottom and landscape sensor-region safe areas;
- visible back, native swipe back/forward, repeated tabs, deep entry, cold entry, resume no-op, scroll restoration, and no blank frame, exit, or trap.

The expected policy remains `ios.contentInset: "never"` with CSS headerless-top ownership and app-owned chronological route depth. `ios-interaction-baseline.md` remains the detailed historical rationale; HPA-210 records final-commit closure rows.

### 7.5 Failure-state recovery

Expected bounded outcomes are retry in place, stable signed-out gate, stopped/replayable audio, valid route recovery, or an actionable terminal state without protected-content leakage.

Milestone failures include indefinite loading, protected-content flash, cross-user cached data, ordinary-tap audio overlap, blank frame/app exit/navigation trap, unrecoverable keyboard obstruction, or credentials/transient OAuth material in UI, logs, source, or artifacts.

## 8. Architecture boundaries to record from the tested commit

- Dedicated public mobile Cognito client; authorization code plus PKCE; system browser; app-owned warm/cold/late/malformed/duplicate callback handling.
- Only the refresh token needed for restoration is stored in device-bound, non-synchronizing Keychain; access and ID tokens remain memory-only; the installation marker prevents stale reinstall restoration.
- The transient OAuth transaction (`state`, `codeVerifier`, `nonce`, `createdAt`) is stored as one JSON value in `@capacitor/preferences` backed by iOS UserDefaults, not Keychain. It contains no access, ID, or refresh token. The store removes the prior value before replacement, enforces the 10-minute TTL, deletes corrupt/expired records, and the coordinator clears it after consumption, cancellation, or terminal cleanup. Plaintext UserDefaults is accepted for this short-lived single-use correlation/verifier material because compromise does not expose a reusable authenticated session; the architecture record names the backup/plaintext limitation and verification confirms bounded cleanup.
- Auth initialization gates protected rendering; sign-out and terminal recovery clear retained credentials and scoped feature state.
- Absolute validated native API origin; exact Capacitor CORS, no wildcard; auth coordinator owns bearer injection and bounded single-flight unauthorized recovery.
- User-scoped query keys; cancel/remove prior-user data without global cache clearing.
- One shared Capacitor lifecycle service; resume alone is not navigation.
- Native inset `never`; CSS/fixed surfaces own each safe-area edge once; app-owned route depth.
- Learning features depend on `MobileAudioPlayer`; `HtmlAudioPlayer` is the current candidate; physical evidence selects the final audio architecture.
- Development diagnostics are compiled out of production, and `verify-production-diagnostics.mjs` remains the authoritative forbidden-token implementation.

## 9. Findings and severity

Every unresolved finding records criterion, severity, environment/commit, reproduction, expected/observed behavior, bounded evidence, owner, target milestone, and Linear issue.

- **Critical:** credential exposure, cross-user leakage, unusable auth, unrecoverable corruption, or unresolved architecture ambiguity. Always blocks `GO`.
- **High:** failure of a physical M1 exit behavior. Blocks `GO` by default.

The only High reclassification is the explicit audio fork: if correct audible pronunciation, replay, decoding, and lifecycle recovery pass and silent-mode policy is the sole failure, `native audio-session integration required` may become a pre-M2 gate. Its Linear issue must be High and block the first M2 review issue depending on audio.

`native player adapter required`, unaudible core playback, OAuth/session restoration, due-count/data isolation, IME, keyboard obstruction, safe-area failure, and navigation traps remain hard `NO-GO`.

- **Medium:** bounded limitation that does not invalidate the exit story and has an M2 or release-readiness issue.
- **Low:** safely deferred polish or observability issue.

Prose-only deferral is forbidden.

## 10. GO / NO-GO

### 10.1 GO requires

- fresh root monorepo lint, typecheck, compile, build, tests, production assets, diagnostic exclusion, and secret scan;
- deployed production config through the normal validator;
- production-smoke and diagnostic-observation classes on the same commit/backend;
- Simulator build/install/launch;
- physical signing preflight and production install/launch;
- physical fresh Google sign-in, warm/cold callbacks, and relaunch restoration;
- correct identity-isolated due-count;
- an acceptable physical Japanese pronunciation path;
- Japanese IME and non-trapping keyboard/safe-area/navigation results;
- stable recovery for expected auth/network/playback failures;
- no Critical finding;
- every deferred Medium/Low risk tracked;
- any permitted silent-mode High issue blocks the first dependent M2 issue;
- tested-commit architecture record complete;
- `CLAUDE.md` synchronized.

### 10.2 NO-GO

Report `NO-GO` when a required row is unrun, blocked without the narrow silent-mode audio gate, failed, invalidated by later code, uses placeholder/mismatched config, fails a secret scan, or lacks an audio conclusion.

A `NO-GO` names the minimum corrective issues and preserves its evidence. HPA-210 remains open until a later complete `GO`.

## 11. Closeout updates

After verification:

1. Comment on HPA-202 and HPA-205 through HPA-209 with tested commit, relevant rows, result, and follow-up.
2. Return a source issue to `Done` only when its evidence is satisfied.
3. Update HPA-210 with architecture, verification, selected run IDs, evidence, implementation PR, and follow-ups.
4. Update HPA-194 with `GO`/`NO-GO`, commit/device summary, M1 evidence, limitations, and recommended first M2 issues.
5. Synchronize `CLAUDE.md`.
6. Preserve `ios-interaction-baseline.md` as historical evidence and add only a closeout link/result if useful.
7. Preserve earlier evidence run directories and external artifact hashes.
8. Finalize the architecture record from `testedBehaviorCommit` and the selected audio result.
9. Commit the verification/architecture/`CLAUDE.md` closeout as documentation-only changes, link the resulting Git commit from HPA-210 and HPA-194, and state explicitly that it does not invalidate executable rows pinned to `testedBehaviorCommit`.
10. As the final pre-merge checklist action, update this design status to reflect completed repository review.

For `GO`, begin M2 with the smallest end-to-end review path: Home/Review navigation, ten-card SRS, rating/pronunciation, then durable outbox and backend idempotency.

## 12. Non-goals

- SRS review implementation;
- durable outbox or idempotency implementation;
- Android;
- TestFlight/App Store;
- permanent macOS CI or full native UI automation;
- accessibility certification;
- final visual polish;
- AI buddy, microphone, STT, or background audio;
- unrelated foundation refactoring.

## 13. Design completion check

- no required row is pre-declared passing;
- two build classes are required on one commit/backend;
- Simulator evidence cannot replace physical acceptance;
- signing/device readiness has explicit exit-3 preflight;
- final root lint, typecheck, compile, build, and test gates are intentional and their actual workspace coverage is recorded;
- production diagnostic scanning covers all emitted text-artifact classes rather than JavaScript only;
- OAuth transaction storage, TTL, plaintext/UserDefaults rationale, and cleanup ownership are explicit;
- secret policy has one source of truth and GO-gating scripts are linted;
- manifests are append-only and versioned while growth-prone binary evidence is externalized by hash;
- manifests pin `testedBehaviorCommit`, and later documentation/evidence-only commits are explicitly non-invalidating;
- verified `www` assets are hashed across `cap sync ios`;
- HPA-209 measurements remain canonical history;
- production config and placeholder classification are explicit;
- existing production diagnostic scripts are reused;
- High reclassification is limited to the silent-mode audio fork;
- architecture and `CLAUDE.md` are finalized from `testedBehaviorCommit`, and their resulting documentation commit is linked externally;
- scope remains M1 verification and architecture closeout;
- updating the design status from repository review to approved is the final pre-merge checklist item.
