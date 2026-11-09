# Vela API

A Hono-based API for the Vela Japanese Learning App, migrated from the original worker code.

## Features

- **LLM Chat API**: Google Gemini, OpenAI, Anthropic, and OpenRouter chat generation (requires authentication)
- **Chat History API**: Save and retrieve chat conversations using DynamoDB
- **AWS Lambda**: Designed to run as AWS Lambda functions
- **CORS Support**: Built-in CORS handling for web applications and approved browser extensions

## Endpoints

### LLM Chat API

**POST /api/llm-chat**

**Requires Authentication**: Valid Cognito ID token in the `Authorization: Bearer <token>` header. Anonymous requests are rejected with 401 before any upstream provider call.

Send chat requests to LLM providers (Google Gemini, OpenAI, Anthropic, or OpenRouter) and receive normalized `{text, usage}` JSON.

```json
{
  "provider": "google" | "openai" | "anthropic" | "openrouter",
  "model": "gemini-3.8-flash",
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"}
  ],
  "thinking": "low",
  "maxTokens": 4096,
  "apiKey": "user-provided key (required for OpenAI/Anthropic)"
}
```

- Provider, model, and thinking values are validated against the shared `@vela/common` registry; unsupported values are rejected with 400 naming the rejected model. OpenRouter accepts any model ID. `temperature` is no longer accepted.
- Leading non-user messages (e.g. the web chat greeting) are stripped and all system instructions are combined server-side.
- `maxTokens` is capped at the chat budget (4096).
- Credentials: the user-provided `apiKey` takes precedence; Google and OpenRouter fall back to the server-side key only for authenticated requests. OpenAI and Anthropic always require a user-provided key.
- Responds with `{ "text": string, "usage": { "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens" } }`. Vendor payloads, thinking traces, and API keys are never echoed.

### Chat History API

**Requires Authentication**: All endpoints require a valid Cognito ID token in the `Authorization: Bearer <token>` header. The authenticated user's ID is derived from the token — the API accepts no user id parameter and ignores any `UserId`/`Timestamp` sent by the client in favour of server-side values.

**POST /api/chat-history/save**

Save a chat message to DynamoDB. A user message (`is_user: true`) first upserts the thread metadata row — the server derives the initial title from the trimmed first message (max 60 characters, falling back to `New conversation`) — then writes the message. An assistant message (`is_user: false`) writes the message only.

```json
{
  "ThreadId": "thread-123",
  "Timestamp": 1693526400000,
  "UserId": "user-456",
  "message": "Hello world",
  "is_user": true
}
```

**GET /api/chat-history/threads**

Get all chat threads for the authenticated user, newest first. Each thread is `{ ThreadId, title, createdAt, updatedAt, model? }`.

**GET /api/chat-history/messages?thread_id=THREAD_ID**

Get all messages in a specific thread. Returns `404 { "error": "Thread not found" }` when the thread does not exist or belongs to another user.

**PATCH /api/chat-history/thread/:id**

Rename a thread and/or store its model selection. Supply a nonempty trimmed `title` (max 60 characters), a `model` object (`{ "provider": "google" | "openai" | "anthropic" | "openrouter", "model": string }`), or both. Returns `{ "thread": <updated row> }`; an empty or invalid body returns 400, and a missing or unowned thread returns `404 { "error": "Thread not found" }`.

```json
{
  "title": "JLPT N5 practice",
  "model": { "provider": "google", "model": "gemini-3.8-flash" }
}
```

**DELETE /api/chat-history/thread/:id**

Delete a chat thread, all its messages, and its metadata row. Returns `404 { "error": "Thread not found" }` when the thread does not exist or belongs to another user.

### Saved Sentences API

**Requires Authentication**: All endpoints require a valid Cognito access token in the `Authorization: Bearer <token>` header. The API validates tokens with AWS Cognito to verify authenticity and prevent forgery.

**GET /api/saved-sentences?limit=50**

Get saved sentences for the authenticated user.

**POST /api/saved-sentences**

Save a new sentence.

```json
{
  "sentence": "これは例文です",
  "sourceUrl": "https://example.com",
  "context": "Example context"
}
```

**DELETE /api/saved-sentences/:sentenceId**

Delete a saved sentence.

## Environment Variables

The following environment variables are required:

### LLM Chat

**Server-side API keys (recommended):**

- `GOOGLE_API_KEY`: Google Gemini API key for all users (optional)
- `OPENROUTER_API_KEY`: OpenRouter API key for all users (optional)

If server-side API keys are configured, they will be used for all requests. Users can optionally provide their own API keys in the request body to override server defaults.

- `APP_NAME`: Application name for OpenRouter headers

### AWS Configuration

**Required for Cognito token validation and DynamoDB access:**

- `AWS_ACCESS_KEY_ID`: AWS access key (required)
- `AWS_SECRET_ACCESS_KEY`: AWS secret key (required)
- `AWS_REGION`: AWS region (default: us-east-1)

**Security Note**: The Saved Sentences API uses `GetUserCommand` from AWS Cognito to validate access tokens and verify their signatures. This prevents token forgery and ensures only authenticated users can access their data.

### DynamoDB Configuration

- `DDB_ENDPOINT`: DynamoDB endpoint (default: https://dynamodb.us-east-1.amazonaws.com)
- `DDB_REGION`: AWS region (default: us-east-1)
- `DDB_TABLE` / `DYNAMODB_TABLE_NAME`: chat history message table (default: vela-chat-history)
- `CHAT_THREADS_TABLE_NAME`: chat thread metadata table (default: vela-chat-threads)

### CORS Configuration

- `CORS_ALLOWED_ORIGINS`: Comma-separated web origins allowed to call the API
- `CORS_ALLOWED_EXTENSION_IDS`: Comma-separated browser extension IDs, without the
  `chrome-extension://` or `moz-extension://` prefix

Local development allows generated browser-extension origins when no extension IDs are configured.
Production deploys must set `CORS_ALLOWED_EXTENSION_IDS` for the published extension.

## Development

```bash
# Install dependencies
npm install

# Build for Lambda
npm run build

# Create deployment package
npm run zip

# Deploy to AWS Lambda
npm run deploy
```

## Migration Notes

This API replaces the original Cloudflare Worker implementation and migrates:

1. **LLM Chat functionality** from `apps/vela/src/api/llm-chat.ts`
2. **Chat History functionality** from `apps/vela/src/api/chat-history.ts`
3. **Worker routing** from `packages/cdk/worker/index.ts`

All endpoints maintain the same interface for backward compatibility with the frontend application.
