# Japanese Learning App

A comprehensive Japanese language learning application built with Quasar Framework, Vue 3, TypeScript, and Supabase.

## Features

- **Interactive Vocabulary Games**: Multiple choice questions with Japanese words
- **Sentence Anagram Games**: Drag-and-drop sentence building
- **Progress Tracking**: Individual word mastery with spaced repetition
- **Gamification System**: Achievements, levels, and learning streaks
- **AI Chat Integration**: Conversational practice with AI
- **Real-time Analytics**: Daily progress tracking and skill development

## Technology Stack

- **Frontend**: Quasar Framework (Vue 3 + TypeScript)
- **Backend**: Supabase (PostgreSQL + Real-time subscriptions)
- **Authentication**: Supabase Auth with email/password
- **State Management**: Pinia stores
- **Build Tool**: Vite
- **Deployment**: Netlify/Supabase

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
npm run build        # Build for production
npm install          # Install dependencies
npm run postinstall  # Run after install (runs quasar prepare)
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
├── boot/           # Application initialization
├── stores/         # Pinia state management
├── services/       # API and business logic
├── components/     # Reusable Vue components
├── pages/          # Application pages
├── layouts/        # Page layouts
├── utils/          # Utility functions
└── config/         # Configuration files
```

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
