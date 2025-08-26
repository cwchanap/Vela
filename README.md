# Japanese Learning App

A comprehensive Japanese language learning application built with Quasar Framework, Vue 3, TypeScript, and Supabase.

## Features

- **Interactive Vocabulary Games**: Multiple choice questions with Japanese words
- **Sentence Anagram Games**: Drag-and-drop sentence building
- **Progress Tracking**: Individual word mastery with spaced repetition
- **Gamification System**: Achievements, levels, and learning streaks
- **AI Chat Integration**: Conversational practice with AI
- **Chat History (Local DynamoDB)**: Persist and browse chat conversations locally during development
- **Real-time Analytics**: Daily progress tracking and skill development

## Technology Stack

- **Frontend**: Quasar Framework (Vue 3 + TypeScript)
- **Backend**: Supabase (PostgreSQL + Real-time subscriptions)
- **Authentication**: Supabase Auth with email/password
- **State Management**: Pinia stores
- **Build Tool**: Vite
- **Deployment**: Netlify/Supabase + Cloudflare Worker (local dev API bridge)

## Production Database Setup

**Database Schema**:

- `profiles` - User profiles extending auth.users
- `vocabulary` - Japanese vocabulary with translations
- `sentences` - Japanese sentences for anagram games
- `user_progress` - Individual word mastery tracking
- `game_sessions` - Game completion records
- `chat_history` - AI chat conversation storage
- `achievements` - Gamification system
- `daily_progress` - Daily learning analytics
- `skill_categories` - Structured learning categories
- `learning_streaks` - Streak management system

### Test Account

**Email**: `test@example.com`
**Password**: `TestPass123!`
**User ID**: `d8897e62-607d-40da-9791-58823e95c5d9`

## Development Setup

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npm run dev
# or
quasar dev
```

### Local Chat History Setup (DynamoDB Local)

This app can store AI chat history to a local DynamoDB instance for development.

1. Start Docker Desktop (required to run containers)
2. Launch DynamoDB Local:

```bash
npm run ddb:up
```

3. Create the table:

```bash
npm run ddb:init
```

4. Run the dev server with Worker bridge:

```bash
npm run dev:wrangler
```

Notes:

- The Cloudflare Worker exposes REST endpoints:
  - POST `/api/chat-history/save`
  - GET `/api/chat-history/threads?user_id=...`
  - GET `/api/chat-history/messages?chat_id=...`
- Default local config is set in [wrangler.toml](wrangler.toml):
  - `DDB_ENDPOINT=http://127.0.0.1:8000`
  - `DDB_REGION=local`
  - `DDB_TABLE=VelaChatMessages`
- Optional client-env overrides exist in [.env.example](.env.example) for experimentation.

### Using Chat History in the UI

- Open the AI Chat page and use the top-right "History" button to view previous threads.
- Selecting a thread loads all messages into the current chat.
- New messages (user and AI) automatically persist to the current `chat_id`. A new conversation is started automatically on first send if none exists.

### Database Setup

The production database is already configured with:

- Complete schema and migrations applied
- Sample vocabulary and sentences data
- Achievement system with 10 achievements
- Skill categories for structured learning
- Test account created and ready for use

## Available Scripts

### Development and Build

```bash
npm run dev          # Start development server with hot reload
npm run dev:wrangler # Run Worker bridge dev server (API + SPA assets)
npm run build        # Build for production
npm install          # Install dependencies
npm run postinstall  # Run after install (runs quasar prepare)
```

### Local DynamoDB

```bash
npm run ddb:up    # Start DynamoDB Local via docker compose
npm run ddb:init  # Create the VelaChatMessages table and GSI
npm run ddb:down  # Stop containers
```

### Code Quality

```bash
npm run lint         # Lint TypeScript/Vue files with ESLint
npm run format       # Format code with Prettier
npm run prepare      # Set up Husky pre-commit hooks
```

### Testing

```bash
npm test            # Currently no tests configured (exits with 0)
```

## Deployment

### Build for Production

```bash
quasar build
```

### Deploy to Netlify

1. Build the project: `quasar build`
2. Deploy the `dist/spa` folder to Netlify
3. Set environment variables in Netlify dashboard

### Deploy to Supabase

The application is configured for Supabase hosting with:

- Edge Functions ready for deployment
- Database triggers for automatic user management
- Real-time subscriptions for live updates

## Project Structure

```
src/
├── api/           # Worker-handled API routes (LLM bridge, chat-history)
├── boot/          # Application initialization
├── stores/        # Pinia state management
├── services/      # API and business logic
├── components/    # Reusable Vue components
├── pages/         # Application pages
├── layouts/       # Page layouts
├── utils/         # Utility functions
└── config/        # Configuration files
```

Key files:

- Worker Router and API:
  - [worker.fetch()](worker/index.ts:9)
  - [handleChatHistory()](src/api/chat-history.ts:55)
  - [handleLLMChat()](src/api/llm-chat.ts:1)
- Frontend Chat UI and Store:
  - [AIChatPage.vue](src/pages/chat/AIChatPage.vue:1)
  - [useChatStore()](src/stores/chat.ts:12)
  - [chatHistoryClient](src/services/chatHistoryClient.ts:1)

## Customization

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-js) for build configuration options.

## Support

For issues or questions, please check the documentation or create an issue in the project repository.

## Install the dependencies

```bash
yarn
# or
npm install
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)

```bash
quasar dev
```

### Lint the files

```bash
yarn lint
# or
npm run lint
```

### Format the files

```bash
yarn format
# or
npm run format
```

### Build the app for production

```bash
quasar build
```

### Customize the configuration

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-js).
