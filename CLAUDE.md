# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a **Turborepo monorepo** containing:

- `apps/vela` - Main Vela Japanese learning app (Quasar/Vue.js)
- `apps/vela-api` - API backend (Hono framework)
- `apps/vela-ext` - Browser extension for saving Japanese sentences (WXT/Vue.js)
- `packages/cdk` - AWS CDK infrastructure code
- `packages/common` - Shared utilities (TanStack Query configuration and query keys)

## Common Development Commands

### Monorepo Commands (run from root)

- `bun dev` - Start all development servers using Turbo
- `bun build` - Build all packages using Turbo
- `bun lint` - Lint all packages using Turbo
- `bun lint:fix` - Lint and fix all packages using Turbo
- `bun format` - Format all packages using Turbo
- `bun test` - Run tests for all packages using Turbo
- `bun clean` - Clean all build artifacts using Turbo
- `bun install` - Install dependencies for all packages
- `bun prepare` - Set up Husky pre-commit hooks

### Vela App Commands (from apps/vela/)

- `bun dev` or `quasar dev` - Start Quasar development server with hot reload
- `bun build` or `quasar build` - Build for production
- `bun postinstall` - Run after install (runs `quasar prepare`)
- `vitest run` - Run frontend unit tests (Vitest)
- `bun run test:e2e` - Run Playwright end-to-end tests
- `bun run test:headed` - Run Playwright tests in headed mode
- `bun run test:ui` - Run Playwright tests with UI mode
- `bun run test:debug` - Run Playwright tests in debug mode
- `bun run test:report` - Show Playwright test report

To run a single Playwright test file:

```bash
bun run test:e2e tests/auth.spec.ts
```

To run a single Vitest test file:

```bash
vitest run src/components/auth/AuthForm.test.ts
```

### Vela API Commands (from apps/vela-api/)

- `bun dev` - Start API development server with tsx watch (runs on port 9005)
- `bun build` - Bundle API for deployment
- `bun test` - Run API tests with Bun's built-in test runner
- `bun test:watch` - Run API tests in watch mode
- `bun test:coverage` - Run API tests with coverage

To run a single Vitest test file:

```bash
bun test src/routes/auth.test.ts
```

### Vela Extension Commands (from apps/vela-ext/)

- `bun dev` or `wxt` - Start WXT development server for Chrome
- `bun dev:firefox` or `wxt -b firefox` - Start WXT development server for Firefox
- `bun build` or `wxt build` - Build extension for Chrome
- `bun build:firefox` or `wxt build -b firefox` - Build extension for Firefox
- `bun zip` or `wxt zip` - Create distribution zip for Chrome
- `bun zip:firefox` or `wxt zip -b firefox` - Create distribution zip for Firefox
- `bun compile` - Type check without emitting (vue-tsc)
- `bun postinstall` - Prepare WXT (runs after install)

Root-level extension commands:

- `bun dev:vela-ext` - Start extension dev server from root
- `bun build:vela-ext` - Build extension from root
- `bun zip:vela-ext` - Create extension zip from root

### AWS CDK Commands (from packages/cdk/)

- `bun cdk:synth` - Synthesize CloudFormation template
- `bun cdk:deploy` - Deploy infrastructure to AWS
- `bun cdk:diff` - Check differences between deployed and local stacks
- `bun cdk:destroy` - Destroy deployed infrastructure
- `bun lambda:build` - Build Lambda function bundle via esbuild
- `bun build:frontend` - Inject environment variables and build frontend

## Project Architecture

### Technology Stack

#### Vela App (Frontend)

- **Framework**: Quasar Framework (Vue 3 + TypeScript)
- **State Management**: Pinia stores
- **Data Fetching**: TanStack Vue Query v5 with shared configuration from `@vela/common`
- **Build Tool**: Vite with Quasar CLI
- **Routing**: Vue Router with history mode
- **UI Interactions**: vuedraggable for drag-and-drop functionality
- **Testing**: Playwright for end-to-end tests, Vitest for unit tests

#### Vela API (Backend)

- **Framework**: Hono (lightweight web framework)
- **Runtime**: Node.js 20 with TypeScript
- **Build**: esbuild for bundling
- **Database Client**: AWS SDK v3 for DynamoDB, S3, Cognito
- **Validation**: Zod with @hono/zod-validator
- **Auth**: aws-jwt-verify for Cognito JWT validation
- **Testing**: Vitest
- **Development**: tsx watch for hot reload (port 9005)

#### Vela Extension (Browser Extension)

- **Framework**: WXT (Web Extension Toolkit) with Vue 3
- **Runtime**: Browser extension (Chrome/Firefox)
- **Data Fetching**: TanStack Vue Query v5 with shared configuration from `@vela/common`
- **Build**: WXT build system
- **Features**: Context menu for saving Japanese sentences, storage, notifications
- **Permissions**: contextMenus, storage, notifications, host_permissions for vela.cwchanap.dev
- **Structure**: background.ts (service worker), content.ts (content script), popup/ (extension popup UI)

#### Infrastructure

- **Database**: DynamoDB (NoSQL database, 8 tables)
- **Relational DB**: Aurora Serverless v2 (PostgreSQL 16.4, VPC private subnet)
- **Authentication**: AWS Cognito with email/password
- **Cloud**: AWS CDK for infrastructure as code
- **Compute**: AWS Lambda for serverless functions
- **Storage**: S3 (static website hosting, TTS audio storage)
- **CDN**: CloudFront for content delivery and API proxy
- **Network**: VPC with public/private subnets, NAT Gateway

#### Development Tools

- **Monorepo**: Turborepo for task orchestration and caching
- **Linting**: ESLint with TypeScript and Vue support (flat config)
- **Formatting**: Prettier
- **Git Hooks**: Husky with lint-staged
- **Package Manager**: Bun with workspaces

### Core Application Structure (Vela App)

#### Boot System

- `apps/vela/src/boot/main.ts` - Simple boot initialization, minimal setup
- `apps/vela/src/boot/query.ts` - TanStack Query client initialization (uses shared config from `@vela/common`)
- Boot files are configured in `quasar.config.ts` and run during app initialization

#### State Management (Pinia Stores)

- `apps/vela/src/stores/auth.ts` - Authentication state, user profile, session management with comprehensive auth flow
- `apps/vela/src/stores/games.ts` - Game state and progress tracking
- `apps/vela/src/stores/chat.ts` - AI chat functionality with LLM provider integration
- `apps/vela/src/stores/progress.ts` - Learning progress tracking
- `apps/vela/src/stores/llmSettings.ts` - LLM provider settings (Google, OpenRouter)
- `apps/vela/src/stores/theme.ts` - Theme and dark mode preferences
- `apps/vela/src/stores/index.ts` - Pinia store configuration

#### Services Layer

- `apps/vela/src/services/authService.ts` - Authentication business logic and API calls
- `apps/vela/src/services/gameService.ts` - Game logic for vocabulary and sentence games
- `apps/vela/src/services/progressService.ts` - Learning progress tracking services
- `apps/vela/src/services/chatHistoryClient.ts` - Chat history management
- `apps/vela/src/services/myDictionariesService.ts` - Saved sentences management
- `apps/vela/src/services/ttsService.ts` - Text-to-speech audio generation and playback
- `apps/vela/src/services/llm/` - LLM provider integrations (Google, OpenRouter)

#### Configuration

- `apps/vela/src/config/index.ts` - Environment variable configuration with validation
- `apps/vela/src/config/navigation.ts` - Navigation menu configuration
- Environment variables: VITE_APP_NAME, VITE_APP_VERSION, VITE_DEV_MODE, AWS Cognito config, API keys

#### Routing & Pages

- Authentication routes: `/auth/login`, `/auth/signup`, `/auth/profile`, `/auth/callback`, `/auth/reset-password`
- Protected routes use `requiresAuth: true` meta property
- Guest-only routes use `requiresGuest: true` meta property
- Main layouts: `MainLayout.vue`, `AuthLayout.vue`
- Core pages: `/` (home), `/chat`, `/settings`, `/progress`, `/my-dictionaries`
- Game pages: `/games`, `/games/vocabulary`, `/games/sentence` with interactive learning components
- Route guards handle authentication state and redirects

#### Data Fetching Patterns

The application uses TanStack Vue Query for data fetching with shared configuration:

- Query client configuration in `packages/common/src/config.ts`
- Query key factories in `packages/common/src/keys.ts`
- Stale time: 5 minutes
- Garbage collection time: 10 minutes
- Consistent query patterns across web app and browser extension

### Database Schema (DynamoDB)

The application uses 8 DynamoDB tables:

- **vela-profiles** - User profiles with preferences, level, experience, streak
- **vela-vocabulary** - Japanese vocabulary with hiragana/katakana/romaji/translations
- **vela-sentences** - Japanese sentences for anagram games with translations
- **vela-game-sessions** - Game completion records with scores and experience
- **vela-daily-progress** - Daily learning progress tracking
- **vela-chat-history** - AI chat conversation storage (GSI: UserIdIndex)
- **vela-saved-sentences** - User-saved sentences from browser extension or app (My Dictionaries)
- **vela-tts-settings** - Text-to-speech preferences per user

### Development Patterns

#### Authentication Flow

1. Auth state managed in Pinia store with reactive session tracking
2. AWS Cognito handles session persistence and refresh automatically via AWS Amplify
3. Router guards check auth requirements using meta properties
4. User profiles are loaded and synced with auth state changes
5. JWT tokens validated on backend via aws-jwt-verify middleware

#### Environment Configuration

- Development uses local API endpoint (proxied via Quasar dev server)
- Frontend proxies `/api/*` requests to `http://localhost:9005` in development
- API development mode loads `.env` files (checks both `apps/vela-api/.env` and root `.env`)
- Production requires proper environment variables
- Config validation runs at app startup

#### TypeScript Integration

- Strict TypeScript configuration enabled
- Comprehensive database types for DynamoDB schema
- Vue SFC type checking enabled via vite-plugin-checker

#### Build Configuration

- Manual chunk splitting for vendor libraries (Vue, Quasar) and app code
- ESLint integration during build process with vite-plugin-checker
- Environment variable injection at build time via `quasar.config.ts`
- TypeScript strict mode enabled with Vue SFC type checking
- Minification and optimization enabled for production
- History mode routing with proper fallback handling

### Vela API Structure

#### Framework & Architecture

- **Hono Framework**: Lightweight, fast web framework for serverless environments
- **TypeScript**: Full type safety with strict configuration
- **esbuild**: Fast bundling for AWS Lambda deployment
- **Development**: tsx watch for hot reload during development
- **Validation**: Zod schemas for request/response validation

#### Key Files & Routes

- `apps/vela-api/src/index.ts` - Main API entry point with route mounting
- `apps/vela-api/src/dev.ts` - Development server setup
- `apps/vela-api/src/dynamodb.ts` - DynamoDB client and operations
- `apps/vela-api/src/middleware/auth.ts` - JWT verification middleware
- `apps/vela-api/src/types.ts` - Environment type definitions
- `apps/vela-api/src/validation.ts` - Zod validation schemas
- API routes mounted at `/api/*` prefix

#### API Endpoints

**Authentication** (`routes/auth.ts`):

- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Sign out

**Profiles** (`routes/profiles.ts`):

- `GET /api/profiles/:userId` - Get user profile
- `POST /api/profiles` - Create new profile
- `PUT /api/profiles/:userId` - Update profile

**Games** (`routes/games.ts`):

- `GET /api/games/vocabulary/questions` - Get vocabulary questions
- `GET /api/games/sentence/questions` - Get sentence questions

**Progress** (`routes/progress.ts`):

- `GET /api/progress/daily/:userId` - Get daily progress
- `POST /api/progress/session` - Record game session
- `POST /api/progress/daily` - Update daily progress

**Chat** (`routes/chat-history.ts`, `routes/llm-chat.ts`):

- `GET /api/chat-history/:threadId` - Get chat thread
- `POST /api/chat-history` - Save chat message
- `GET /api/chat-history/user/:userId/threads` - List user threads
- `POST /api/llm-chat` - Stream LLM responses

**My Dictionaries** (`routes/saved-sentences.ts`):

- `GET /api/my-dictionaries` - List user's saved sentences (requires auth)
- `POST /api/my-dictionaries` - Save new sentence (requires auth)
- `PUT /api/my-dictionaries/:sentenceId` - Update sentence (requires auth)
- `DELETE /api/my-dictionaries/:sentenceId` - Delete sentence (requires auth)

**Text-to-Speech** (`routes/tts.ts`):

- `POST /api/tts/generate` - Generate TTS audio (ElevenLabs API)
- `GET /api/tts/settings` - Get user's TTS settings
- `PUT /api/tts/settings` - Update TTS settings

#### Development vs Production

**Development Mode** (`NODE_ENV=development`):

- Loads `.env` files (app-specific or root)
- Mock environment injected into Hono context
- Local DynamoDB support via `DDB_ENDPOINT`
- Serves on port 9005 with hot reload (tsx watch)
- CORS configured for localhost origins

**Production Mode** (AWS Lambda):

- Uses Lambda environment variables
- Deployed via CDK to API Gateway + Lambda
- Single bundled file (`dist/index.js`)
- CloudFront handles CORS and caching

### AWS CDK Infrastructure

#### Infrastructure as Code

- `packages/cdk/` - AWS CDK application in TypeScript
- `packages/cdk/app.ts` - CDK app with 5 separate stacks
- Lambda function deployment with esbuild bundling
- DynamoDB tables with pay-per-request billing
- Aurora Serverless v2 (PostgreSQL) in VPC private subnet
- S3 buckets for static website hosting and TTS audio storage
- CloudFront distribution with custom domain (vela.cwchanap.dev)
- VPC with public/private subnets, NAT Gateway for Lambda internet access
- ACM certificate for HTTPS
- Security groups for Aurora access

#### Stack Architecture

The CDK application uses a multi-stack architecture for better separation of concerns:

1. **AuthStack** (`lib/auth-stack.ts`) - Cognito User Pool and Client
2. **DatabaseStack** (`lib/database-stack.ts`) - DynamoDB tables, Aurora Serverless v2, VPC
3. **StorageStack** (`lib/storage-stack.ts`) - S3 bucket for TTS audio storage
4. **ApiStack** (`lib/api-stack.ts`) - Lambda function, API Gateway
5. **StaticWebStack** (`lib/static-web-stack.ts`) - CloudFront distribution, S3 deployment

**Stack Dependencies:**

```
AuthStack → (no deps)
DatabaseStack → (no deps)
StorageStack → (no deps)
ApiStack → depends on [auth, database, storage]
StaticWebStack → depends on [auth, database, storage, api]
```

#### Key Infrastructure Resources

1. **Cognito User Pool** - Email/password authentication
2. **DynamoDB Tables** - 8 tables for application data
3. **Aurora Serverless v2** - PostgreSQL database (future use)
4. **Lambda Function** - API backend (Node.js 20, 1024 MB, 60s timeout)
5. **API Gateway** - REST API with `/api/*` proxy to Lambda
6. **S3 Buckets** - Static website hosting (`vela-web-*`), TTS audio storage (`vela-tts-audio-*`)
7. **CloudFront** - CDN for static assets and API proxy
8. **VPC** - Private networking for Lambda and Aurora
9. **NAT Gateway** - Internet access for Lambda (for external API calls)

### Code Quality Setup

- **ESLint**: Flat configuration with TypeScript and Vue support for all packages
- **Prettier**: Code formatting across the monorepo
- **Husky**: Pre-commit hooks with lint-staged
- **TypeScript**: Strict mode enabled across all packages
- **Vue Type Checking**: Enabled in development via vite-plugin-checker
- **Turborepo**: Intelligent build caching and task orchestration

### Game System

#### Implemented Games

1. **Vocabulary Game** (`/games/vocabulary`)
   - Multiple choice format with 4 options
   - Fetches random vocabulary from database
   - Real-time scoring and timer
   - Components: `VocabularyCard`, `GameTimer`, `ScoreDisplay`

2. **Sentence Anagram Game** (`/games/sentence`)
   - Drag-and-drop interface using vuedraggable
   - Scrambled Japanese sentence reconstruction
   - Component: `SentenceBuilder`

#### Game Components

- `src/components/games/GameTimer.vue` - Timer display
- `src/components/games/ScoreDisplay.vue` - Score tracking
- `src/components/games/VocabularyCard.vue` - Multiple choice questions
- `src/components/games/SentenceBuilder.vue` - Drag-and-drop sentence building

#### Game Service

- `src/services/gameService.ts` - Fetches questions from DynamoDB via API
- Vocabulary questions with multiple choice options
- Sentence questions with scrambled word arrays

### Japanese Language Utilities

#### Character Detection (`src/utils/japanese.ts`)

- `isHiragana()`, `isKatakana()`, `isKanji()` - Character type detection
- `analyzeText()` - Text composition analysis
- `assessDifficulty()` - Automatic difficulty scoring based on character types and length

#### Text Processing

- `hiraganaToRomaji()` - Basic romanization mapping
- `parseFurigana()` - Furigana segment parsing (simplified implementation)
- Text analysis for learning progression

### Text-to-Speech (TTS) System

#### Implementation

- **Provider**: ElevenLabs API
- **Storage**: S3 bucket (`vela-tts-audio-*`) with presigned URLs
- **Settings**: Per-user voice preferences in DynamoDB (`vela-tts-settings`)
- **Service**: `src/services/ttsService.ts` handles audio generation and playback
- **API Routes**: `/api/tts/generate`, `/api/tts/settings`

#### Flow

1. User requests pronunciation for Japanese text
2. Frontend calls `/api/tts/generate` with text and user settings
3. Backend generates audio via ElevenLabs API
4. Audio file uploaded to S3 bucket
5. Presigned URL returned to frontend (15-minute expiry)
6. Frontend plays audio using HTML5 audio element

### Browser Extension

#### Features

- **Context Menu**: Right-click selected text → "Save to My Dictionaries"
- **Authentication**: Stores access/refresh tokens in browser local storage
- **Token Refresh**: Automatically refreshes expired tokens before API calls
- **Notifications**: Success/error browser notifications

#### Architecture

- **Background Script** (`entrypoints/background.ts`): Service worker handling context menu, API calls, token refresh
- **Content Script** (`entrypoints/content.ts`): Minimal content script
- **Popup** (`entrypoints/popup/`): Extension popup UI (Vue 3)
- **Shared Config**: Uses `@vela/common` for TanStack Query configuration

## Monorepo Development Workflow

### Turborepo Configuration

- `turbo.json` defines task dependencies and caching strategies
- Tasks like `build`, `lint`, `format` run across all packages
- `dev` task runs persistently without caching for development servers
- Build outputs are cached in `.turbo/` directory for faster subsequent builds

### Working with Multiple Packages

1. **Root Level**: Use `bun <script>` to run tasks across all packages
2. **Package Specific**: Navigate to specific package directory for targeted commands or use `bun --filter`
3. **Dependencies**: Turborepo handles task dependencies (e.g., `build` depends on `^build`)

### Testing Strategy

- **Vela App**: Playwright for end-to-end testing with multiple test modes (headed, UI, debug), Vitest for unit tests
- **Vela API**: Vitest for unit testing with coverage support
- **Vela Extension**: Type checking via vue-tsc (no runtime tests currently)
- **CDK**: No specific tests configured currently

### Test Account Credentials

For testing authenticated features, test credentials must be provided via environment variables (configured in `.env` or `.env.local`):

- `TEST_EMAIL` - Email for test account
- `TEST_PASSWORD` - Password for test account

These environment variables are required by Playwright end-to-end tests and are defined in `.env.example`. The tests will fail with a clear error message if these variables are not set.

### Environment Variables

Each package handles environment variables differently:

- **Vela App**: Uses Vite's `import.meta.env` with AWS Cognito configuration (VITE\_\* prefix)
- **Vela API**: Standard Node.js `process.env`, loads from `.env` file in development
  - Development mode checks both `apps/vela-api/.env` and root `.env`
  - Required: AWS credentials, Cognito config, DynamoDB config, S3 config, ElevenLabs API key (optional)
  - Optional: LLM API keys for chat functionality
- **Vela Extension**: Uses WXT's built-in environment handling
- **CDK**: Uses AWS CDK's built-in environment handling

### Important Development Notes

- Always run monorepo commands from the root directory when possible
- Individual package commands should be run from their respective directories
- Turborepo caches build outputs - use `bun clean` if you encounter cache issues
- The lint configuration uses ESLint flat config format (modern ESLint v9+ style)
- Pre-commit hooks run linting and formatting automatically via Husky
- Before starting dev servers, check if they're already running to avoid port conflicts

### Development Server Ports

- **Vela App**: Port 9000 (Quasar dev server)
- **Vela API**: Port 9005 (Hono development server)
- **Vela Extension**: No dev server port (runs in browser)

### CORS and API Proxying

In development:

- Frontend dev server (port 9000) proxies `/api/*` to backend (port 9005)
- Configured in `quasar.config.ts` under `devServer.proxy`
- This avoids CORS issues during local development

In production:

- CloudFront handles routing: `/api/*` → API Gateway, `/*` → S3 static website
- CORS configured on API Gateway for allowed origins

## Active Technologies

- TypeScript (Node.js 20 for Lambda, CDK v2 TypeScript for infrastructure) + AWS CDK v2 (`aws-cdk-lib`, `constructs`), AWS SDK v3 (DynamoDB), Hono (API framework), AWS RDS Data API client for executing SQL against Aurora / DSQL (001-aurora-dsql-migration)
- DynamoDB tables for application data; Aurora DSQL cluster as the single relational database for current and future SQL workloads; S3 for TTS audio and static assets (001-aurora-dsql-migration)

## Recent Changes

- 001-aurora-dsql-migration: Added TypeScript (Node.js 20 for Lambda, CDK v2 TypeScript for infrastructure) + AWS CDK v2 (`aws-cdk-lib`, `constructs`), AWS SDK v3 (DynamoDB), Hono (API framework), AWS RDS Data API client for executing SQL against Aurora / DSQL
