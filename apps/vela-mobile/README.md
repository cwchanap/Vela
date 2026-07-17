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
bunx quasar build -m capacitor -T ios --ide
# or
cd apps/vela-mobile/src-capacitor && bunx cap open ios
```

## Physical Device

`cap open ios` only launches Xcode — it does not build web assets, install
Pods, or copy generated config. On a fresh checkout those are all absent
(see `.gitignore`), so the workspace cannot build until you build and sync
first.

1. Build web assets and sync Capacitor:
   ```bash
   cd apps/vela-mobile
   bun run build              # fills src-capacitor/www/
   cd src-capacitor
   bunx cap sync ios          # copies www/ into iOS project + pod install
   bunx cap open ios          # open Xcode
   ```
   (Equivalent one-liner: `bunx quasar build -m capacitor -T ios --ide`
   builds, syncs, and opens Xcode in one step.)
2. Select your development team under Signing & Capabilities
3. Connect your iPhone
4. Select the device in Xcode's device dropdown
5. Press Run

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
src-capacitor/        # Capacitor native project
  capacitor.config.json
  ios/                # Xcode project (committed)
```
