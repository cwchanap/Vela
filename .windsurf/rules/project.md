---
trigger: always_on
---

## Common Development Commands

### Development and Build

- `npm run dev` or `quasar dev` - Start development server with hot reload
- `npm run build` or `quasar build` - Build for production
- `npm install` - Install dependencies
- `npm run postinstall` - Run after install (runs `quasar prepare`)

### Code Quality

- `npm run lint` - Lint TypeScript/Vue files with ESLint
- `npm run format` - Format code with Prettier
- `npm run prepare` - Set up Husky pre-commit hooks

### Testing

- `npm test` - Currently no tests configured (exits with 0)

## Project Architecture

### Technology Stack

- **Framework**: Quasar Framework (Vue 3 + TypeScript)
- **State Management**: Pinia stores
- **Database**: Supabase (PostgreSQL with real-time subscriptions)
- **Authentication**: Supabase Auth with email/password and magic links
- **Build Tool**: Vite
- **Routing**: Vue Router with history mode

### Core Application Structure

#### Boot System

- `src/boot/main.ts` - Initializes Pinia and Supabase, runs before app mounts
- Boot files are configured in `quasar.config.ts` and run during app initialization

#### State Management (Pinia Stores)

- `src/stores/auth.ts` - Authentication state, user profile, session management
- `src/stores/games.ts` - Game state and progress (placeholder for future implementation)
- `src/stores/chat.ts` - AI chat functionality (placeholder for future implementation)
- `src/stores/progress.ts` - Learning progress tracking (placeholder for future implementation)

#### Services Layer

- `src/services/supabase.ts` - Supabase client configuration with comprehensive TypeScript types for database schema
- `src/services/authService.ts` - Authentication business logic and API calls
- Database schema includes: profiles, vocabulary, user_progress, game_sessions, chat_history

#### Configuration

- `src/config/index.ts` - Environment variable configuration with validation
- Environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_OPENAI_API_KEY, VITE_APP_NAME, VITE_APP_VERSION, VITE_DEV_MODE

#### Routing & Pages

- Authentication routes: `/auth/login`, `/auth/signup`, `/auth/profile`, `/auth/callback`, `/auth/reset-password`
- Protected routes use `requiresAuth: true` meta property
- Guest-only routes use `requiresGuest: true` meta property
- Main layouts: `MainLayout.vue`, `AuthLayout.vue`

### Database Schema (Supabase)

The application uses a comprehensive database schema for a Japanese learning app:

- **profiles** - User profiles with preferences, level, experience, streak
- **vocabulary** - Japanese vocabulary with hiragana/katakana/romaji/translations
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
- ESLint integration during build process
- Environment variable injection at build time
- Minification and optimization enabled for production

### Code Quality Setup

- ESLint with TypeScript and Vue support
- Prettier for code formatting
- Husky pre-commit hooks with lint-staged
- Vue TypeScript checking enabled in development
