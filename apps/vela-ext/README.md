# Vela Japanese Dictionary Extension

Browser extension for saving Japanese sentences to your Vela dictionary.

## Features

- **Authentication**: Imports an active Vela web-app session
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

3. Start manual extension development:

   ```bash
   bun dev              # Chrome
   bun dev:firefox      # Firefox
   ```

4. Start the low-friction local test loop from the monorepo root:

   ```bash
   bun run dev:extension-test
   ```

   This starts the Vela app, Vela API, and WXT extension runner together. WXT opens Chrome with the extension installed, a persistent `.wxt/chrome-data` profile, the Vela login page, and `/extension-test.html` for right-click testing.

5. Build for production:
   ```bash
   bun build            # Chrome
   bun build:firefox    # Firefox
   ```

## Usage

1. **Login**: Open the Vela web app and sign in there, then click the extension icon and refresh/import the web-app session
2. **Save Sentences**:
   - Select any text on a webpage
   - Right-click and choose "Add vocab to Vela"
   - You'll see a notification confirming the save
3. **View Saved Sentences**: Click the extension icon to view your saved sentences

## Development

- Built with [WXT](https://wxt.dev/) - Next-gen Web Extension Framework
- Vue 3 for UI components
- TypeScript for type safety

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar).
