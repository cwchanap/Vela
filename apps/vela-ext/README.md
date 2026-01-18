# Vela Japanese Dictionary Extension

Browser extension for saving Japanese sentences to your Vela dictionary.

## Features

- **Authentication**: Login with your Vela account credentials
- **Context Menu Integration**: Right-click on selected text to save sentences
- **Instant Saving**: Sentences are saved with source URL and context
- **Dashboard**: View all your saved sentences in the extension popup

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Configure environment variables (optional):

   ```bash
   cp .env.example .env
   ```

   Edit `.env` to set your API URL (defaults to production: `https://vela.cwchanap.dev/api`)

3. Start development:

   ```bash
   bun dev              # Chrome
   bun dev:firefox      # Firefox
   ```

4. Build for production:
   ```bash
   bun build            # Chrome
   bun build:firefox    # Firefox
   ```

## Usage

1. **Login**: Click the extension icon and log in with your Vela account
2. **Save Sentences**:
   - Select any text on a webpage
   - Right-click and choose "Save to Vela Dictionary"
   - You'll see a notification confirming the save
3. **View Saved Sentences**: Click the extension icon to view your saved sentences

## Development

- Built with [WXT](https://wxt.dev/) - Next-gen Web Extension Framework
- Vue 3 for UI components
- TypeScript for type safety

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar).
