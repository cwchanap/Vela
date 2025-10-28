---
applyTo: '**'
---

## Common Development Commands

### Development and Build

- `pnpm dev` or `quasar dev` - Start development server with hot reload
- `pnpm build` or `quasar build` - Build for production
- `pnpm install` - Install dependencies
- `pnpm postinstall` - Run after install (runs `quasar prepare`)

### Code Quality

- `pnpm lint` - Lint TypeScript/Vue files with ESLint
- `pnpm format` - Format code with Prettier
- `pnpm prepare` - Set up Husky pre-commit hooks

### Testing

- `pnpm test` - Currently no tests configured (exits with 0)
- For future testing setup: Consider Vitest for unit tests, @vue/test-utils for component testing

## Project Architecture

### Technology Stack

- **Framework**: Quasar Framework (Vue 3 + TypeScript)
- **State Management**: Pinia stores
- **Database**: DynamoDB (via API)
- **Authentication**: AWS Cognito (email/password)
- **Build Tool**: Vite
- **Routing**: Vue Router with history mode
- **UI Interactions**: vuedraggable for drag-and-drop functionality

### Core Application Structure

#### Boot System

- `src/boot/main.ts` - Simple boot initialization (Pinia), runs before app mounts
- Boot files are configured in `quasar.config.ts` and run during app initialization

#### State Management (Pinia Stores)

- `src/stores/auth.ts` - Authentication state, user profile, session management
- `src/stores/games.ts` - Game state and progress (placeholder for future implementation)
- `src/stores/chat.ts` - AI chat functionality (placeholder for future implementation)
- `src/stores/progress.ts` - Learning progress tracking (placeholder for future implementation)

#### Services Layer

- `src/services/authService.ts` - Authentication business logic and API calls (Cognito)
- `src/services/gameService.ts` - Game logic for vocabulary and sentence games (via API)
- Database schema includes: profiles, vocabulary, user_progress, game_sessions, chat_history, sentences

#### Configuration

- `src/config/index.ts` - Environment variable configuration with validation
- Environment variables: VITE_OPENAI_API_KEY, VITE_APP_NAME, VITE_APP_VERSION, VITE_DEV_MODE

#### Routing & Pages

- Authentication routes: `/auth/login`, `/auth/signup`, `/auth/profile`, `/auth/callback`, `/auth/reset-password`
- Protected routes use `requiresAuth: true` meta property
- Guest-only routes use `requiresGuest: true` meta property
- Main layouts: `MainLayout.vue`, `AuthLayout.vue`
- Game pages: `/games/vocabulary`, `/games/sentence` with interactive learning components

### Database Schema (DynamoDB)

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
2. AWS Cognito handles session persistence and refresh automatically
3. Router guards check auth requirements using meta properties
4. User profiles are loaded and synced with auth state changes

#### Environment Configuration

- Development uses local API and optional local DynamoDB if needed
- Production requires proper environment variables (Cognito, API URL)
- Config validation runs at app startup

#### TypeScript Integration

- Strict TypeScript configuration enabled
- Comprehensive database types for application data models
- Vue SFC type checking enabled via vite-plugin-checker

#### Build Configuration

- Manual chunk splitting for vendor libraries (Vue, Quasar) and app code
- ESLint integration during build process
- Environment variable injection at build time
- Minification and optimization enabled for production

### Code Quality Setup

- ESLint with TypeScript and Vue support
- Prettier for code formatting
- Husky pre-commit hooks with lint-staged
- Vue TypeScript checking enabled in development

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

- `src/services/gameService.ts` - Fetches questions from API
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

# IMPORTANT!!

Use Playwright MCP to interact with browser for testing. DON't USE windsurf built browser! Also don't run `npm run dev` to start the server as it may already started, check if it is running first: http://localhost:9000/

# Test account:

Email: test@cwchanap.dev
Password: password123
