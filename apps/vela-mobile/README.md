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
# From repo root — installs web app workspace deps
bun install

# Capacitor native deps live in a separate package (src-capacitor/)
# and are NOT covered by the workspace install. Required for iOS dev/build:
cd apps/vela-mobile/src-capacitor && bun install
```

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

From `apps/vela-mobile/src-capacitor/`:

```bash
bunx cap sync ios    # Sync web assets + native plugins
bunx cap open ios    # Open Xcode
```

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

This syncs web assets and opens the project in **Xcode**. Press the Run button (or `Cmd+B`) to build.

To drive `xcodebuild` headlessly from the CLI instead of the IDE, use Capacitor's CLI directly:

```bash
cd apps/vela-mobile/src-capacitor
bunx cap build ios
```

## Physical Device

1. Open Xcode: `cd apps/vela-mobile/src-capacitor && bunx cap open ios`
2. Select your development team under Signing & Capabilities
3. Connect your iPhone
4. Select the device in Xcode's device dropdown
5. Press Run

## Testing

```bash
cd apps/vela-mobile
bun run test:unit    # Unit tests (Vitest)
bun run typecheck    # Type checking (vue-tsc)
bun run lint         # ESLint
```

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
