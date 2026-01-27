# Vela App

The main Vela Japanese Learning Application built with Quasar Framework (Vue 3 + TypeScript).

## Features

- Japanese vocabulary learning games
- Sentence anagram games
- User progress tracking with DynamoDB
- Authentication with AWS Cognito

## Development

```bash
# Start development server
bun run dev

# Build for production
bun run build

# Lint code
bun run lint

# Format code
bun run format
```

## Tech Stack

- **Framework**: Quasar Framework (Vue 3 + TypeScript)
- **State Management**: Pinia
- **Backend**: AWS Lambda API with DynamoDB
- **Authentication**: AWS Cognito
- **Build Tool**: Vite

## Configuration

The app uses various configuration files:

- `quasar.config.ts` - Quasar framework configuration
- `tsconfig.json` - TypeScript configuration
- `eslint.config.js` - ESLint configuration
- `postcss.config.js` - PostCSS configuration
