---
trigger: always_on
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a **Turborepo monorepo** containing:

- `apps/vela` - Main Vela Japanese learning app (Quasar/Vue.js)
- `apps/vela-api` - API backend (Hono framework)
- `packages/cdk` - AWS CDK infrastructure code

## Common Development Commands

### Monorepo Commands (run from root)

- `npm run dev` - Start all development servers using Turbo
- `npm run build` - Build all packages using Turbo
- `npm run lint` - Lint all packages using Turbo
- `npm run lint:fix` - Lint and fix all packages using Turbo
- `npm run format` - Format all packages using Turbo
- `npm run test` - Run tests for all packages using Turbo
- `npm run clean` - Clean all build artifacts using Turbo
- `npm install` - Install dependencies for all packages
- `npm run prepare` - Set up Husky pre-commit hooks

### Vela App Commands (from apps/vela/)

- `npm run dev` or `quasar dev` - Start Quasar development server with hot reload
- `npm run build` or `quasar build` - Build for production
- `npm run postinstall` - Run after install (runs `quasar prepare`)
- `npm run test` - Run Playwright end-to-end tests
- `npm run test:headed` - Run Playwright tests in headed mode
- `npm run test:ui` - Run Playwright tests with UI mode
- `npm run test:debug` - Run Playwright tests in debug mode

### Vela API Commands (from apps/vela-api/)

- `npm run dev` - Start API development server with tsx watch
- `npm run build` - Bundle API for deployment
- `npm run test` - Run API tests with Vitest
- `npm run test:watch` - Run API tests in watch mode
- `npm run test:coverage` - Run API tests with coverage

### AWS CDK Commands (from packages/cdk/)

- `npm run cdk:synth` - Synthesize CloudFormation template
- `npm run cdk:deploy` - Deploy infrastructure to AWS
- `npm run cdk:diff` - Check differences between deployed and local stacks
- `npm run cdk:destroy` - Destroy deployed infrastructure

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
- **Development**: tsx watch for hot reload

#### Infrastructure

- **Database**: Supabase (PostgreSQL with real-time subscriptions)
- **Authentication**: Supabase Auth with email/password and magic links
- **Cloud**: AWS CDK for infrastructure as code
- **Deployment**: AWS Lambda for serverless functions

#### Development Tools

- **Monorepo**: Turborepo for task orchestration and caching
- **Linting**: ESLint with TypeScript and Vue support (flat config)
- **Formatting**: Prettier
- **Git Hooks**: Husky with lint-staged
- **Package Manager**: npm with workspaces

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

- `apps/vela/src/services/supabase.ts` - Supabase client configuration with comprehensive TypeScript types for database schema
- `apps/vela/src/services/authService.ts` - Authentication business logic and API calls
- `apps/vela/src/services/gameService.ts` - Game logic for vocabulary and sentence games
- `apps/vela/src/services/progressService.ts` - Learning progress tracking services
- `apps/vela/src/services/chatHistoryClient.ts` - Chat history management
- `apps/vela/src/services/llm/` - LLM provider integrations (Google, OpenRouter)
- Database schema includes: profiles, vocabulary, user_progress, game_sessions, chat_history, sentences

#### Configuration

- `apps/vela/src/config/index.ts` - Environment variable configuration with validation
- `apps/vela/src/config/navigation.ts` - Navigation menu configuration
- Environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_NAME, VITE_APP_VERSION, VITE_DEV_MODE

#### Routing & Pages

- Authentication routes: `/auth/login`, `/auth/signup`, `/auth/profile`, `/auth/callback`, `/auth/reset-password`
- Protected routes use `requiresAuth: true` meta property
- Guest-only routes use `requiresGuest: true` meta property
- Main layouts: `MainLayout.vue`, `AuthLayout.vue`
- Core pages: `/` (home), `/chat`, `/settings`, `/progress`
- Game pages: `/games`, `/games/vocabulary`, `/games/sentence` with interactive learning components
- Route guards handle authentication state and redirects

### Database Schema (Supabase)

The application uses a comprehensive database schema for a Japanese learning app:

- **profiles** - User profiles with preferences, level, experience, streak
- **vocabulary** - Japanese vocabulary with hiragana/katakana/romaji/translations
- **sentences** - Japanese sentences for anagram games with translations
- **user_progress** - Individual word mastery tracking with spaced repetition
- **game_sessions** - Game completion records with scores and experience
- **chat_history** - AI chat conversation storage

### Development Patterns

#### Authentication Flow

1. Auth state managed in Pinia store with reactive session tracking
2. Supabase handles session persistence and refresh automatically
3. Router guards check auth requirements using meta properties
4. User profiles are loaded and synced with auth state changes

#### Environment Configuration

- Development fallbacks to local Supabase instance (127.0.0.1:54321)
- Production requires proper environment variables
- Config validation runs at app startup

#### TypeScript Integration

- Strict TypeScript configuration enabled
- Comprehensive database types generated from Supabase schema
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

#### Key Files

- `apps/vela-api/src/index.ts` - Main API entry point
- `apps/vela-api/src/dev.ts` - Development server setup
- Lambda packaging via esbuild with single bundle output

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

- `src/services/gameService.ts` - Fetches questions from Supabase
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

## Monorepo Development Workflow

### Turborepo Configuration

- `turbo.json` defines task dependencies and caching strategies
- Tasks like `build`, `lint`, `format` run across all packages
- `dev` task runs persistently without caching for development servers
- Build outputs are cached in `.turbo/` directory for faster subsequent builds

### Working with Multiple Packages

1. **Root Level**: Use `npm run <command>` to run tasks across all packages
2. **Package Specific**: Navigate to specific package directory for targeted commands
3. **Dependencies**: Turborepo handles task dependencies (e.g., `build` depends on `^build`)

### Testing Strategy

- **Vela App**: Playwright for end-to-end testing with multiple test modes
- **Vela API**: Vitest for unit testing with coverage support
- **CDK**: No specific tests configured currently

### Environment Variables

Each package handles environment variables differently:

- **Vela App**: Uses Vite's `import.meta.env` with fallbacks for local Supabase
- **Vela API**: Standard Node.js `process.env`
- **CDK**: Uses AWS CDK's built-in environment handling

### Important Development Notes

- Always run monorepo commands from the root directory when possible
- Individual package commands should be run from their respective directories
- Turborepo caches build outputs - use `npm run clean` if you encounter cache issues
- The lint configuration uses ESLint flat config format (modern ESLint v9+ style)
- Pre-commit hooks run linting and formatting automatically via Husky
