# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a **Turborepo monorepo** containing:

- `apps/vela` - Main Vela Japanese learning app (Quasar/Vue.js)
- `apps/vela-api` - API backend (Hono framework, runs on port 9005)
- `apps/vela-ext` - Browser extension for saving Japanese sentences (WXT/Vue.js)
- `apps/vela-mobile` - iOS-first mobile app (Quasar + Capacitor)
- `packages/cdk` - AWS CDK infrastructure (5 stacks: Auth, Database, Storage, Api, StaticWeb)
- `packages/common` - Shared TanStack Query config and query key factories

## Commands

### Monorepo (from root)

```bash
bun run dev          # Start all dev servers in parallel
bun run build        # Build all packages
bun run test         # Run all unit tests
bun run lint         # Lint all packages
bun run lint:fix     # Lint and fix
bun run format       # Format all packages
bun run typecheck    # Typecheck packages that define a typecheck script (currently @vela/mobile only)
bun run clean        # Clean packages that define a clean script (@vela/mobile, @vela/common)
bun run dev:mobile   # Start mobile web dev server
bun run build:mobile # Build mobile web assets
```

Turbo skips workspaces that lack the requested script. Sibling apps use `compile` (api/ext) or rely on build-time typechecking instead of a root-level `typecheck` script.

### Mobile build env injection (ordering requirement)

`apps/vela-mobile/.env.production` is gitignored and must be generated before a production mobile build. It is written by `packages/cdk/scripts/inject-env.ts`, which derives the web app's env from `cdk-outputs.json` and writes an absolute `VITE_MOBILE_API_URL` for the Capacitor app (the web app's relative `/api/` path is unusable in a native WebView). The mobile URL and the web app's Cognito redirect URLs are derived from the `WebsiteOrigin` / `MobileApiURL` CloudFormation outputs (emitted by `StaticWebStack`), so a non-production deployment (different `VELA_DOMAIN_NAME`) routes mobile traffic to its own backend instead of production. `VELA_DOMAIN_NAME` also drives the CloudFront custom domain, CORS defaults (`ApiStack` / `StorageStack`), and Cognito redirect URIs (`AuthStack`).

**Required ordering for any production mobile build (local or CI):**

1. `cdk:deploy` (or `cdk synth` + export outputs) so `cdk-outputs.json` exists in `packages/cdk/`.
2. `bun scripts/inject-env.ts` (from `packages/cdk/`) → writes `apps/vela-mobile/.env.production`.
3. `bun run build:mobile` (or `bun run build` filtered to `@vela/mobile`).

The `validate-mobile-api-url` Vite plugin (extracted to `apps/vela-mobile/build/validate-mobile-api-url.ts`, registered from `quasar.config.ts`) enforces this at build time: in production mode it throws if `.env.production` is missing or `VITE_MOBILE_API_URL` is absent/invalid. The check is **on by default**. CI pipelines that run `inject-env.ts` (or otherwise guarantee `.env.production`) before the build may set `MOBILE_SKIP_ENV_VALIDATION=true` to bypass it; the previous blanket `CI === 'true'` skip was removed because it silently disabled the only build-time guard, leaving a launch-time `validateConfig` throw as the sole (late) failure mode. The PR CI workflow (`build-lint.yml`) sets `VITE_MOBILE_API_URL=https://example.invalid/api/` instead of bypassing, so the normal validation path executes on every PR. If `.env.production` is missing, the app crashes at boot via `src/config/index.ts` `validateConfig`.

### Vela App (from apps/vela/)

```bash
bun run dev                                      # Quasar dev server (port 9000)
bun run test:unit                                # Run Vitest unit tests
bun run test:unit -- --coverage                  # Run with coverage (v8 provider)
bun vitest run src/components/auth/AuthForm.test.ts  # Run single test file
bun run test:e2e                                 # Run Playwright e2e tests
bun run test:e2e tests/auth.spec.ts              # Run single e2e test file
bun run test:headed                              # Playwright in headed mode
bun run test:ui                                  # Playwright UI mode
bun run build                                    # Production build
```

### Vela API (from apps/vela-api/)

```bash
bun run dev           # Bun watch mode (NODE_ENV=development bun --watch src/index.ts)
bun run test:unit     # Run tests with Bun's built-in test runner
bun run test:coverage # Run with coverage
bun test test/routes/profiles.test.ts  # Run single test file
bun run build         # Bundle for Lambda deployment
```

### Vela Extension (from apps/vela-ext/)

```bash
bun run dev           # WXT dev server for Chrome
bun run dev:firefox   # WXT dev server for Firefox
bun run build         # Build for Chrome
bun run zip           # Create distribution zip
bun run compile       # Type-check via vue-tsc
```

WXT uses an `entrypoints/` directory: `popup/` (Vue SPA), `background.ts` (service worker), `content.ts` (content script). Shared utilities live in `entrypoints/utils/`.

### CDK (from packages/cdk/)

```bash
bun cdk:synth    # Synthesize CloudFormation template
bun cdk:diff     # Diff deployed vs local
bun cdk:deploy   # Deploy to AWS
bun lambda:build # Build Lambda bundle via esbuild
```

`CDK_SPA_DIST_PATH` env var overrides the SPA dist path that `StaticWebStack`
deploys. `Source.asset` stats the directory at synth time, so a fresh checkout
without a built SPA (`bun run build` in `apps/vela`) fails before any test
runs. The CDK unit tests set `CDK_SPA_DIST_PATH` to a temp directory to break
that dependency; set it explicitly when running `cdk:synth` against a non-default
build output.

## Architecture

### Key cross-package pattern

`@vela/common` provides shared TanStack Query config (`packages/common/src/config.ts`) and query key factories (`packages/common/src/keys.ts`). Both `apps/vela` and `apps/vela-ext` depend on it. If those packages appear broken after pulling, build `@vela/common` first:

```bash
bun run build --filter=@vela/common
```

### Vela App

- **Boot**: `src/boot/query.ts` initializes TanStack Query (stale: 5m, gc: 10m); `src/boot/main.ts` is minimal
- **State**: Pinia stores in `src/stores/` — `auth.ts` manages the full Cognito session lifecycle via AWS Amplify (`aws-amplify/auth`)
- **Layer order**: components → composables (`src/composables/queries/`) → services (`src/services/`) → API. Composables expose TanStack Query hooks; services contain the raw HTTP/Amplify calls.
- **Config**: `src/config/index.ts` validates all env vars at startup — misconfigured env fails fast
- **Routing**: Protected routes use `requiresAuth: true` meta; guest-only use `requiresGuest: true`

### Vela API

Key files:

- `src/index.ts` — Hono app entry point; handles both Lambda and local Bun runtime
- `src/dynamodb.ts` — DynamoDB client and typed operations
- `src/dsql.ts` — Aurora DSQL client (PostgreSQL via `@aws/aurora-dsql-node-postgres-connector`)
- `src/middleware/auth.ts` — JWT verification via `aws-jwt-verify`
- `src/validation.ts` — Zod schemas for request validation

Routes: `auth`, `profiles`, `games`, `progress`, `chat-history`, `llm-chat`, `my-dictionaries`, `tts`, `srs`, `dsql-health`

**Dev vs production**: In development, env vars are loaded from `apps/vela-api/.env` or root `.env`. The Hono app detects Bun runtime automatically and skips the Lambda handler wrapper.

### Development proxy

In development, `quasar.config.ts` proxies all `/api/*` requests from port 9000 → port 9005. No CORS configuration is needed locally. In production, CloudFront routes `/api/*` → API Gateway and `/*` → S3.

### Database

- **DynamoDB**: 8 tables for all current application data (profiles, vocabulary, sentences, game sessions, daily progress, chat history, saved sentences, TTS settings)
- **Aurora DSQL**: PostgreSQL-compatible serverless cluster in private VPC subnet — the target relational DB for future SQL workloads (migration in progress)

### Infrastructure stacks (packages/cdk/)

```
AuthStack → (no deps)          # Cognito User Pool
DatabaseStack → (no deps)      # DynamoDB + Aurora DSQL + VPC
StorageStack → (no deps)       # S3 for TTS audio
ApiStack → [auth, db, storage] # Lambda + API Gateway
StaticWebStack → [all above]   # CloudFront + S3 static hosting
```

## Authentication

Vela uses **Google-only OAuth** via Cognito Hosted UI. There is no password-based login.

- **Local dev**: Requires a valid Cognito session. Run `bun run dev` and sign in through the Google OAuth flow on `http://localhost:9000/auth/login`. You need the Cognito Google IdP configured and your Google account allow-listed in the user pool.
- **E2E tests**: Use the seeded-token fixture (`e2e/fixtures/auth.ts`) which calls `AdminInitiateAuth` via the AWS SDK to bypass Google's UI. This requires AWS credentials (`aws sso login` or env-injected) and the `VITE_COGNITO_TEST_CLIENT_ID` env var (see `.env.example`).
- **Extension**: Imports tokens from the web app's localStorage via a content script restricted to Vela origins.

### Mobile client (iOS)

Vela Mobile authenticates against the same Cognito user pool as the web app, through a dedicated **public** app client (`vela-mobile-client`). The client is configured for authorization-code grant with no client secret bundled in the app binary. PKCE, `state`, and `nonce` validation are implemented client-side in M2 (see below) before mobile sign-in is enabled; the M1 client is PKCE-_compatible_ (public, auth-code grant) but does not yet perform the PKCE flow.

The iOS callback uses a custom URL scheme registered in `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`:

| URI                                       | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `dev.cwchanap.vela.oauth:/oauth/callback` | Receives the authorization code after Google sign-in |
| `dev.cwchanap.vela.oauth:/oauth/logout`   | Receives the redirect after Cognito sign-out         |

The scheme is the reverse-DNS of the project-controlled `vela.cwchanap.dev` domain with an `.oauth` suffix (i.e. `dev.cwchanap.vela.oauth`), rather than the bundle id, because `vela.app` is not a controlled namespace and custom URL schemes are an unowned namespace on iOS. The URIs use the RFC 8252 §7.1 private-use URI form (single slash, no authority component) — `scheme:/path`, not `scheme://host/path` — because there is no naming authority for custom URL schemes.

`AppDelegate.application(_:open:options:)` already forwards opens to Capacitor's `ApplicationDelegateProxy`. This is only relevant if the M2 client-side flow uses `@capacitor/browser` + `@capacitor/app` — if M2 uses `ASWebAuthenticationSession` instead, the callback arrives through the session's completion handler and `AppDelegate` is bypassed entirely.

CDK env vars (defaults shown):

```dotenv
COGNITO_MOBILE_CALLBACK_URLS=dev.cwchanap.vela.oauth:/oauth/callback
COGNITO_MOBILE_LOGOUT_URLS=dev.cwchanap.vela.oauth:/oauth/logout
```

Both accept comma-separated lists for dev/QA overrides. **Override URIs must use the `dev.cwchanap.vela.oauth:/` scheme** (RFC 8252 §7.1 private-use form, single slash) and an allowed path (`/oauth/callback` or `/oauth/staging-callback` for callbacks; `/oauth/logout` or `/oauth/staging-logout` for logouts) — CDK validates both at synth time and throws otherwise, because iOS only registers that one scheme and the app's router only handles known paths. Vary the path within the allowlist, not the scheme or URI form. The mobile client ID is published as the `CognitoMobileUserPoolClientId` CloudFormation output.

The following M2 work is required before the mobile OAuth flow can complete end-to-end (out of scope for HPA-203):

1. Widen the API JWT verifier to accept both web and mobile client audiences (`aws-jwt-verify` `clientId: [webId, mobileId]`).
2. Wire the mobile client ID into the Capacitor build.
3. ~~If API calls go through WKWebView, add `capacitor://localhost` to the API CORS allow-list.~~ **Done in M1 (HPA-204).** The CORS allowlist is not a security boundary for native clients — `capacitor://localhost` is shared across all Capacitor apps and the middleware passes requests with no `Origin` header. JWT verification (item #1 above) is the actual auth boundary.
4. Implement PKCE + `state` + `nonce` in the client-side OAuth flow.
5. Route the authorization request with `identity_provider=Google` (the web app's established pattern via `signInWithRedirect({ provider: 'Google' })`) so the Cognito `/oauth2/authorize` endpoint redirects straight to Google and never renders the Cognito login selection page. Neither the web nor the mobile app pool client has a `CfnManagedLoginBranding` or `CfnUserPoolUICustomizationAttachment` resource — the Cognito Hosted UI / managed-login page is intentionally unused. If M2 instead opens the interactive Cognito page (e.g. without the `identity_provider` parameter), add a branding resource for the mobile client first, or add an authorization-endpoint smoke test that proves the direct-provider redirect.

## Testing

- **E2E tests** require `TEST_EMAIL`, `TEST_PASSWORD`, and `VITE_COGNITO_TEST_CLIENT_ID` env vars (see `.env.example`). Also requires AWS credentials for `AdminInitiateAuth`.
- **Vitest** uses jsdom environment with globals enabled; setup file at `src/test/setup.ts`
- **Vitest aliases**: `@vela/common` is aliased directly to the source (`packages/common/src/index.ts`) — no build step needed for unit tests
- **API tests** use Bun's built-in test runner (no Vitest)
- **Composable testing**: use `withQueryClient` from `src/test-utils/withQueryClient.ts` to mount composables inside a Vue component with a fresh isolated QueryClient (retry and gcTime set to 0)

### iOS interaction diagnostics — pending physical-device validation (HPA-209)

The iOS interaction diagnostics page (`apps/vela-mobile/src/pages/diagnostics/IosInteractionDiagnosticsPage.vue`) and the `JapaneseInputProbe` were validated only on the iOS Simulator. Two behaviors are **not** confirmed on a physical iPhone and must be verified before HPA-209 closes:

1. **IME composition flow** — `compositionstart` / `compositionend` / `input` listeners on the native `<input>` (see `JapaneseInputProbe.vue`) and the `isComposing` guard against premature Enter submission. The simulator's software keyboard does not exercise the real iOS Kana IME candidate-selection path.
2. **Native edge-swipe back gesture** — `mobile-navigation.ts` depth tracking and the back-navigation outcome surfacing. The simulator's swipe was a no-op, so the depth-decrement path was not exercised on-device.

Code is merge-safe (unit tests cover the logic); the device run is a closure gate, not a merge gate. Remove this section once a physical-device run confirms both behaviors.

## Environment Variables

- **Vela App**: `VITE_*` prefix, Cognito config required — validated at startup via `src/config/index.ts`
- **Vela API**: Standard `process.env`; dev mode falls back between `apps/vela-api/.env` and root `.env`
- **Vela Extension**: WXT built-in env handling

## Code Quality

ESLint uses flat config format (v9+). Pre-commit hooks (Husky + lint-staged) run lint and format automatically. TypeScript strict mode is on across all packages with Vue SFC type checking via `vite-plugin-checker` in the Vela app.
