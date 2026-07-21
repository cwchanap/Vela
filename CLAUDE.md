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

Vela Mobile authenticates against the same Cognito user pool as the web app, through a dedicated **public** app client (`vela-mobile-client`). The mobile OAuth flow uses authorization-code grant + PKCE; no client secret is bundled in the app binary.

The iOS callback uses a custom URL scheme registered in `apps/vela-mobile/src-capacitor/ios/App/App/Info.plist`:

| URI                                        | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `dev.cwchanap.vela.oauth://oauth/callback` | Receives the authorization code after Google sign-in |
| `dev.cwchanap.vela.oauth://oauth/logout`   | Receives the redirect after Cognito sign-out         |

The scheme is rooted at `cwchanap.dev` (a project-controlled domain) rather than the bundle id, because `vela.app` is not a controlled namespace and custom URL schemes are an unowned namespace on iOS.

`AppDelegate.application(_:open:options:)` already forwards opens to Capacitor's `ApplicationDelegateProxy`. This is only relevant if the M2 client-side flow uses `@capacitor/browser` + `@capacitor/app` — if M2 uses `ASWebAuthenticationSession` instead, the callback arrives through the session's completion handler and `AppDelegate` is bypassed entirely.

CDK env vars (defaults shown):

```dotenv
COGNITO_MOBILE_CALLBACK_URLS=dev.cwchanap.vela.oauth://oauth/callback
COGNITO_MOBILE_LOGOUT_URLS=dev.cwchanap.vela.oauth://oauth/logout
```

Both accept comma-separated lists for dev/QA overrides. **Override URIs must use the `dev.cwchanap.vela.oauth://` scheme** — CDK validates this at synth time and throws otherwise, because iOS only registers that one scheme. Vary the path, not the scheme. The mobile client ID is published as the `CognitoMobileUserPoolClientId` CloudFormation output.

The following M2 work is required before the mobile OAuth flow can complete end-to-end (out of scope for HPA-203):

1. Widen the API JWT verifier to accept both web and mobile client audiences (`aws-jwt-verify` `clientId: [webId, mobileId]`).
2. Wire the mobile client ID into the Capacitor build.
3. If API calls go through WKWebView, add `capacitor://localhost` to the API CORS allow-list.
4. Implement PKCE + `state` + `nonce` in the client-side OAuth flow.

## Testing

- **E2E tests** require `TEST_EMAIL`, `TEST_PASSWORD`, and `VITE_COGNITO_TEST_CLIENT_ID` env vars (see `.env.example`). Also requires AWS credentials for `AdminInitiateAuth`.
- **Vitest** uses jsdom environment with globals enabled; setup file at `src/test/setup.ts`
- **Vitest aliases**: `@vela/common` is aliased directly to the source (`packages/common/src/index.ts`) — no build step needed for unit tests
- **API tests** use Bun's built-in test runner (no Vitest)
- **Composable testing**: use `withQueryClient` from `src/test-utils/withQueryClient.ts` to mount composables inside a Vue component with a fresh isolated QueryClient (retry and gcTime set to 0)

## Environment Variables

- **Vela App**: `VITE_*` prefix, Cognito config required — validated at startup via `src/config/index.ts`
- **Vela API**: Standard `process.env`; dev mode falls back between `apps/vela-api/.env` and root `.env`
- **Vela Extension**: WXT built-in env handling

## Code Quality

ESLint uses flat config format (v9+). Pre-commit hooks (Husky + lint-staged) run lint and format automatically. TypeScript strict mode is on across all packages with Vue SFC type checking via `vite-plugin-checker` in the Vela app.
