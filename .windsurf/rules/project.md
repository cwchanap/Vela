---
trigger: always_on
---

## Project Structure

This is a **Turborepo monorepo** containing:

- `apps/vela` - Main Vela Japanese learning app (Quasar/Vue.js)
- `apps/vela-api` - API backend (Hono framework)
- `apps/vela-ext` - Browser extension for saving Japanese sentences (WXT/Vue.js)
- `packages/cdk` - AWS CDK infrastructure code

## Common Development Commands

### Monorepo Commands (run from root)

- `pnpm dev` - Start all development servers using Turbo
- `pnpm build` - Build all packages using Turbo
- `pnpm lint` - Lint all packages using Turbo
- `pnpm lint:fix` - Lint and fix all packages using Turbo
- `pnpm format` - Format all packages using Turbo
- `pnpm test` - Run tests for all packages using Turbo
- `pnpm clean` - Clean all build artifacts using Turbo
- `pnpm install` - Install dependencies for all packages
- `pnpm prepare` - Set up Husky pre-commit hooks

### Vela App Commands (from apps/vela/)

- `pnpm dev` or `quasar dev` - Start Quasar development server with hot reload
- `pnpm build` or `quasar build` - Build for production
- `pnpm postinstall` - Run after install (runs `quasar prepare`)
- `pnpm test` - Run Playwright end-to-end tests
- `pnpm test:headed` - Run Playwright tests in headed mode
- `pnpm test:ui` - Run Playwright tests with UI mode
- `pnpm test:debug` - Run Playwright tests in debug mode

### Vela API Commands (from apps/vela-api/)

- `pnpm dev` - Start API development server with tsx watch (runs on port 9005)
- `pnpm build` - Bundle API for deployment
- `pnpm test` - Run API tests with Vitest
- `pnpm test:watch` - Run API tests in watch mode
- `pnpm test:coverage` - Run API tests with coverage

### Vela Extension Commands (from apps/vela-ext/)

- `pnpm dev` or `wxt` - Start WXT development server for Chrome
- `pnpm dev:firefox` or `wxt -b firefox` - Start WXT development server for Firefox
- `pnpm build` or `wxt build` - Build extension for Chrome
- `pnpm build:firefox` or `wxt build -b firefox` - Build extension for Firefox
- `pnpm zip` or `wxt zip` - Create distribution zip for Chrome
- `pnpm zip:firefox` or `wxt zip -b firefox` - Create distribution zip for Firefox
- `pnpm compile` - Type check without emitting (vue-tsc)
- `pnpm postinstall` - Prepare WXT (runs after install)

Root-level extension commands:

- `pnpm dev:vela-ext` - Start extension dev server from root
- `pnpm build:vela-ext` - Build extension from root
- `pnpm zip:vela-ext` - Create extension zip from root

### AWS CDK Commands (from packages/cdk/)

- `pnpm cdk:synth` - Synthesize CloudFormation template
- `pnpm cdk:deploy` - Deploy infrastructure to AWS
- `pnpm cdk:diff` - Check differences between deployed and local stacks
- `pnpm cdk:destroy` - Destroy deployed infrastructure

## Project Architecture

### Technology Stack

#### Vela App (Frontend)

- **Framework**: Quasar Framework (Vue 3 + TypeScript)
- **State Management**: Pinia stores
- **Build Tool**: Vite with Quasar CLI
- **Routing**: Vue Router with history mode
- **UI Interactions**: vuedraggable for drag-and-drop functionality
- **Testing**: Playwright for end-to-end tests

#### Vela API (Backend)

- **Framework**: Hono (lightweight web framework)
- **Runtime**: Node.js with TypeScript
- **Build**: esbuild for bundling
- **Database Client**: AWS SDK for DynamoDB
- **Testing**: Vitest
- **Development**: tsx watch for hot reload (port 9005)

#### Vela Extension (Browser Extension)

- **Framework**: WXT (Web Extension Toolkit) with Vue 3
- **Runtime**: Browser extension (Chrome/Firefox)
- **Build**: WXT build system
- **Features**: Context menu for saving Japanese sentences, storage, notifications
- **Permissions**: contextMenus, storage, notifications, host_permissions for vela.cwchanap.dev
- **Structure**: background.ts (service worker), content.ts (content script), popup/ (extension popup UI)

#### Infrastructure

- **Database**: DynamoDB (NoSQL database)
- **Authentication**: AWS Cognito with email/password
- **Cloud**: AWS CDK for infrastructure as code
- **Deployment**: AWS Lambda for serverless functions

#### Development Tools

- **Monorepo**: Turborepo for task orchestration and caching
- **Linting**: ESLint with TypeScript and Vue support (flat config)
- **Formatting**: Prettier
- **Git Hooks**: Husky with lint-staged
- **Package Manager**: pnpm with workspaces

### Core Application Structure (Vela App)

#### Boot System

- `apps/vela/src/boot/main.ts` - Simple boot initialization, minimal setup
- Boot files are configured in `quasar.config.ts` and run during app initialization

#### State Management (Pinia Stores)

- `apps/vela/src/stores/auth.ts` - Authentication state, user profile, session management with comprehensive auth flow
- `apps/vela/src/stores/games.ts` - Game state and progress tracking
- `apps/vela/src/stores/chat.ts` - AI chat functionality with LLM provider integration
- `apps/vela/src/stores/progress.ts` - Learning progress tracking
- `apps/vela/src/stores/llmSettings.ts` - LLM provider settings (Google, OpenRouter)
- `apps/vela/src/stores/index.ts` - Pinia store configuration

#### Services Layer

- `apps/vela/src/services/authService.ts` - Authentication business logic and API calls
- `apps/vela/src/services/gameService.ts` - Game logic for vocabulary and sentence games
- `apps/vela/src/services/progressService.ts` - Learning progress tracking services
- `apps/vela/src/services/chatHistoryClient.ts` - Chat history management
- `apps/vela/src/services/llm/` - LLM provider integrations (Google, OpenRouter)
- Database schema includes: profiles, vocabulary, game_sessions, chat_history, sentences

#### Configuration

- `apps/vela/src/config/index.ts` - Environment variable configuration with validation
- `apps/vela/src/config/navigation.ts` - Navigation menu configuration
- Environment variables: VITE_APP_NAME, VITE_APP_VERSION, VITE_DEV_MODE

#### Routing & Pages

- Authentication routes: `/auth/login`, `/auth/signup`, `/auth/profile`, `/auth/callback`, `/auth/reset-password`
- Protected routes use `requiresAuth: true` meta property
- Guest-only routes use `requiresGuest: true` meta property
- Main layouts: `MainLayout.vue`, `AuthLayout.vue`
- Core pages: `/` (home), `/chat`, `/settings`, `/progress`
- Game pages: `/games`, `/games/vocabulary`, `/games/sentence` with interactive learning components
- Route guards handle authentication state and redirects

### Database Schema (DynamoDB)

The application uses DynamoDB tables for a Japanese learning app:

- **profiles** - User profiles with preferences, level, experience, streak
- **vocabulary** - Japanese vocabulary with hiragana/katakana/romaji/translations
- **sentences** - Japanese sentences for anagram games with translations
- **game_sessions** - Game completion records with scores and experience
- **daily_progress** - Daily learning progress tracking
- **chat_history** - AI chat conversation storage

### Development Patterns

#### Authentication Flow

1. Auth state managed in Pinia store with reactive session tracking
2. AWS Cognito handles session persistence and refresh automatically
3. Router guards check auth requirements using meta properties
4. User profiles are loaded and synced with auth state changes

#### Environment Configuration

- Development uses local DynamoDB tables
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

#### Key Files & Routes

- `apps/vela-api/src/index.ts` - Main API entry point with route mounting
- `apps/vela-api/src/dev.ts` - Development server setup
- `apps/vela-api/src/routes/` - API route handlers organized by feature
  - `llm-chat.ts` - LLM chat endpoints
  - `chat-history.ts` - Chat history storage
  - `games.ts` - Game data and questions
  - `progress.ts` - Learning progress tracking
  - `profiles.ts` - User profile management
  - `auth.ts` - Authentication endpoints
  - `saved-sentences.ts` - Saved Japanese sentences from extension
- Lambda packaging via esbuild with single bundle output
- Development mode loads .env files and mocks Lambda environment
- API routes mounted at `/api/*` prefix

### AWS CDK Infrastructure

#### Infrastructure as Code

- `packages/cdk/` - AWS CDK application in TypeScript
- Lambda function deployment with proper bundling
- DynamoDB integration for serverless data storage
- TypeScript compilation for Lambda functions in `dist/lambda/`

### Code Quality Setup

- **ESLint**: Flat configuration with TypeScript and Vue support for all packages
- **Prettier**: Code formatting across the monorepo
- **Husky**: Pre-commit hooks with lint-staged
- **TypeScript**: Strict mode enabled across all packages
- **Vue Type Checking**: Enabled in development via vite-plugin-checker
- **Turborepo**: Intelligent build caching and task orchestration

## Monorepo Development Workflow

### Turborepo Configuration

- `turbo.json` defines task dependencies and caching strategies
- Tasks like `build`, `lint`, `format` run across all packages
- `dev` task runs persistently without caching for development servers
- Build outputs are cached in `.turbo/` directory for faster subsequent builds

### Working with Multiple Packages

1. **Root Level**: Use `pnpm <script>` to run tasks across all packages
2. **Package Specific**: Navigate to specific package directory for targeted commands or use `pnpm --filter`
3. **Dependencies**: Turborepo handles task dependencies (e.g., `build` depends on `^build`)

### Testing Strategy

- **Vela App**: Playwright for end-to-end testing with multiple test modes (headed, UI, debug)
- **Vela API**: Vitest for unit testing with coverage support
- **Vela Extension**: Type checking via vue-tsc (no runtime tests currently)
- **CDK**: No specific tests configured currently

### Test Account Credentials

For testing authenticated features:

- Email: `test@cwchanap.dev`
- Password: `password123`

### Environment Variables

Each package handles environment variables differently:

- **Vela App**: Uses Vite's `import.meta.env` with AWS Cognito configuration (VITE\_\* prefix)
- **Vela API**: Standard Node.js `process.env`, loads from `.env` file in development
  - Development mode checks both `apps/vela-api/.env` and root `.env`
  - Required: AWS credentials, Cognito config, DynamoDB config, optional LLM API keys
- **Vela Extension**: Uses WXT's built-in environment handling
- **CDK**: Uses AWS CDK's built-in environment handling

### Important Development Notes

- Always run monorepo commands from the root directory when possible
- Individual package commands should be run from their respective directories
- Turborepo caches build outputs - use `pnpm clean` if you encounter cache issues
- The lint configuration uses ESLint flat config format (modern ESLint v9+ style)
- Pre-commit hooks run linting and formatting automatically via Husky

### Development Server Ports

- **Vela App**: Port 9000 (Quasar dev server)
- **Vela API**: Port 9005 (Hono development server)
- **Vela Extension**: No dev server port (runs in browser)

Before starting dev servers, check if they're already running to avoid port conflicts.
