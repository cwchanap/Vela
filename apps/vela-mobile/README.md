# Vela Mobile

iOS-first Vela Japanese learning app, built with Quasar + Capacitor.

## Prerequisites

| Requirement | Version                       | Install                                     |
| ----------- | ----------------------------- | ------------------------------------------- |
| Xcode       | 16+ (Capacitor 7 requirement) | Mac App Store                               |
| CocoaPods   | latest                        | `brew install cocoapods`                    |
| Bun         | >= 1.3.1                      | `curl -fsSL https://bun.sh/install \| bash` |

Verify:

```bash
xcodebuild -version   # Must show 16+
pod --version         # Must be installed
bun --version         # Must be >= 1.3.1
```

## Setup

```bash
# From repo root — installs workspace deps, then apps/vela-mobile postinstall
# runs `bun install --cwd src-capacitor` for Capacitor native packages.
bun install
```

Capacitor packages (`@capacitor/*`) live in `src-capacitor/package.json` (Quasar layout).
The Podfile resolves them from `src-capacitor/node_modules/`, not the monorepo root.
If you skip install at the monorepo root, install them manually:

```bash
cd apps/vela-mobile/src-capacitor && bun install
```

> **Frozen lockfile:** The `postinstall` script runs
> `bun install --cwd src-capacitor --frozen-lockfile`, so a root `bun install` fails if
> `src-capacitor/bun.lock` is out of sync with `src-capacitor/package.json`. After editing
> `src-capacitor/package.json`, regenerate its lockfile first:
>
> ```bash
> cd apps/vela-mobile/src-capacitor && bun install
> ```
>
> Then commit the updated `src-capacitor/bun.lock` before running `bun install` at the
> monorepo root.

## Development

### Browser (fast UI iteration)

```bash
cd apps/vela-mobile
bun run dev
```

### iOS Simulator

```bash
cd apps/vela-mobile
bun run dev:ios
```

This starts the Vite dev server, syncs Capacitor, and opens **Xcode**. Press the Run button in Xcode to launch in the simulator with live reload.

> Do not close the terminal — it hosts the dev server.

### Manual Capacitor commands

`cap sync` copies the built web assets from `src-capacitor/www/` (the configured
`webDir`) into the iOS project and runs `pod install`. That directory is
gitignored and only populated by a Quasar Capacitor build, so build **before**
syncing. `cap open ios` only launches Xcode — it does not sync or install Pods.

```bash
cd apps/vela-mobile
bun run build:ios    # quasar build -m capacitor -T ios → fills src-capacitor/www/
cd src-capacitor
bunx cap sync ios    # Copy www/ into iOS project + pod install
bunx cap open ios    # Open Xcode
```

If you only changed native config (no web changes), `bunx cap sync ios` alone is
enough — but it still requires a prior build to have populated `www/` at least
once on this checkout.

## Build

### Web build

```bash
cd apps/vela-mobile
bun run build
```

### iOS build

```bash
cd apps/vela-mobile
bun run build:ios
```

This runs `quasar build -m capacitor -T ios`: builds the web assets, syncs Capacitor, then
invokes `xcodebuild` headlessly (via Quasar's Capacitor builder).

> **Signing prerequisite:** `build:ios` produces a signed `iphoneos` release build and
> requires a configured development team. The Xcode target uses automatic signing
> (`CODE_SIGN_STYLE = Automatic`) with no `DEVELOPMENT_TEAM` committed, so a headless
> build fails with `Signing for "App" requires a development team` until one is set.
> To configure it, open Xcode (`bunx cap open ios`), select your team under
> **Signing & Capabilities**, then re-run `bun run build:ios` — or use the Xcode-based
> flow described under [Physical Device](#physical-device) instead.

To open **Xcode** instead of a terminal-only build:

```bash
cd apps/vela-mobile
bun run build:ios:ide   # syncs version, builds web assets, syncs Capacitor, opens Xcode
# or
cd apps/vela-mobile/src-capacitor && bunx cap open ios
```

`build:ios:ide` runs `sync:ios-version` first so `MARKETING_VERSION` stays
aligned with the Home page version before Xcode archives the bundle.

## M1 Foundation Verification

### Deployed configuration preparation

Before running production verification, prepare the deployed configuration in
this exact order:

1. Deploy or synthesize and export the CDK outputs so
   `packages/cdk/cdk-outputs.json` exists:
   ```bash
   cd packages/cdk
   bun cdk:deploy          # or: bun cdk synth && export outputs
   ```
2. Run the environment injection script using those outputs to write
   `apps/vela-mobile/.env.production`:
   ```bash
   cd packages/cdk
   bun scripts/inject-env.ts
   ```
3. Build `@vela/mobile` before running production verification:
   ```bash
   cd apps/vela-mobile
   bun run build:ios:assets
   ```

This ordering prevents stale `.env.production` usage: the injection script
derives `VITE_MOBILE_API_URL` and the public Cognito identifiers from the
current CDK outputs, so a build that skips step 2 would ship a stale or
placeholder configuration. The pre-merge `verify:production-diagnostics` gate
may bypass this prerequisite with an explicit placeholder
(`VITE_MOBILE_API_URL=https://example.invalid/api/`) because it only checks
diagnostic exclusion, not deployed-config consistency.

### Automated gates

Run the eight automated gates from `apps/vela-mobile`:

```bash
bun run verify:m1-foundation [-- --evidence-dir <path>]
```

The runner resolves the current Git HEAD as the tested behavior commit and
executes the gates in order (install, lint, typecheck, compile, build, test,
production-diagnostics, mobile-secret-scan) on a clean detached worktree. It
writes a local manifest receipt under `.artifacts/hpa-210/` by default, or
under `<evidence-dir>` when given. Receipts are local and ephemeral
(gitignored); the committed record is
[docs/m1-ios-foundation-verification.md](docs/m1-ios-foundation-verification.md).

The record distinguishes two build classes. A **diagnostic observation** uses
a Debug development build and development-only diagnostic routes for an
interactive observation. A **production smoke** uses both packaged production
Capacitor assets and a Release/production native configuration, where the
diagnostics are excluded and scanned from
`src-capacitor/www/`. Do not treat a diagnostic observation as production
smoke evidence or vice versa.

### Deployed-config consistency (closure criterion)

The closure requirement that the mobile build env's public Cognito identifiers
match the deployed CDK outputs is checked by the standalone verifier (run
from `apps/vela-mobile`):

```bash
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

`--cdk-outputs` is resolved from the process cwd, hence the `../../` prefix
when invoked from `apps/vela-mobile`. The verifier loads `.env.production`
directly and compares the five public mobile identifiers against the CDK
outputs, rejecting any mismatch; `MOBILE_SKIP_ENV_VALIDATION=true` does not
bypass it. Without `--cdk-outputs`, it validates env presence only, so a
closure check must pass the flag.

There is intentionally no committed `DEVELOPMENT_TEAM`; physical-device
signing remains a tester-controlled prerequisite.

See [iOS Foundation Architecture](docs/ios-foundation-architecture.md) for the
source contract and [M1 iOS Foundation Verification](docs/m1-ios-foundation-verification.md)
for the committed verification record.

## Physical Device

`cap open ios` only launches Xcode — it does not build web assets, install
Pods, or copy generated config. On a fresh checkout those are all absent
(see `.gitignore`), so the workspace cannot build until you build and sync
first.

1. Build web assets, sync Capacitor, and open Xcode:

   ```bash
   cd apps/vela-mobile
   bun run build:ios:ide
   ```

   This syncs the iOS version, fills `src-capacitor/www/`, syncs it into the
   iOS project, runs `pod install`, and opens Xcode. The `--ide` flag skips
   the headless `xcodebuild` step, which would fail without a configured
   signing team.

   > `bun run build` is the web-only SPA build (`dist/spa`) and does **not**
   > fill `src-capacitor/www/` — do not use it before `cap sync`.

2. Select your development team under Signing & Capabilities
3. Connect your iPhone
4. Select the device in Xcode's device dropdown
5. Press Run

## iOS Interaction Baseline

The development build exposes the diagnostic route
`/diagnostics/ios-interactions`. Open **More → iOS Interaction Diagnostics**;
the More entry and both diagnostic routes are compiled only in development.
They cover Japanese composition, keyboard viewport behavior, safe areas,
chronological navigation, resume, and one-shot cold entry.

On an iPhone, add the Japanese Kana keyboard before running the IME scenario:

1. Open **Settings → General → Keyboard → Keyboards**.
2. Choose **Add New Keyboard → Japanese → Kana**.
3. In the diagnostics field, enter `にほんご`, choose `日本語`, and verify
   composition does not submit early.
4. Complete composition, submit, and confirm the draft, committed value,
   bound model, post-render native input, and submitted value are all exactly
   `日本語`.

Use the asset-only build when preparing a Capacitor artifact without a
headless signed device build:

```bash
cd apps/vela-mobile
VITE_MOBILE_API_URL=https://example.invalid/api/ bun run build:ios:assets
VITE_MOBILE_API_URL=https://example.invalid/api/ bun run verify:production-diagnostics
```

`verify:production-diagnostics` is a local macOS pre-merge gate. It performs a
real production Capacitor asset build, runs `cap sync ios`, and scans the
resulting `src-capacitor/www/` artifact to ensure the development diagnostics
marker is absent. Run a final `bunx cap sync ios` from `src-capacitor/` after
the artifact gate.

Mobile navigation follows one chronological M1 history across links, footer
tabs, and native back/forward gestures. In-session validated entry creates one
unique push, so back returns to the exact prior route and forward restores the
entry; repeated delivery on the current route is a depth-preserving no-op.
Only a fresh cold entry replaces the depth-zero route and uses the declared
header fallback. Resume preserves the current route unless a newly validated
entry event is present. Bounded history or tab-specific stacks are an explicit
M2 revisit point after physical-device evidence for the current policy.

The selected iOS policy is native `contentInset: "never"` with CSS ownership
of the headerless top inset. Quasar owns fixed top/bottom CSS behavior, while
pages, toolbars, and footer tabs own horizontal safe-area insets. Do not add a
second native or CSS owner for the same edge.

See [docs/ios-interaction-baseline.md](docs/ios-interaction-baseline.md) for
the measured policy, exact environment matrix, reusable rules, and current
blockers. Completion requires real-iPhone Debug development evidence for both
Japanese IME submission and WKWebView native swipe history; simulator and
source-level tests do not replace those physical scenarios.

## Testing

```bash
cd apps/vela-mobile
bun run test:unit                # Unit tests (Vitest)
bun run test:unit -- --coverage  # Unit tests with coverage
bun run typecheck                # Type checking (vue-tsc)
bun run lint                     # ESLint
```

From monorepo root, `bun run typecheck` / `bun run clean` only run in packages that define those scripts (mobile defines both; most sibling apps do not yet).

## Project Structure

```text
src/                  # Vue application source
  config/             # Environment config
  boot/               # Quasar boot files
  router/             # Vue Router config
  layouts/            # Page layouts (MobileLayout)
  pages/              # Route page components
  css/                # Global styles
  test/               # Test setup and mocks
scripts/              # Build/dev helper scripts (sync-ios-version.mjs)
src-capacitor/        # Capacitor native project
  capacitor.config.json
  ios/                # Xcode project (committed)
```
