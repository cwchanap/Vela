# Vela API

A Hono-based API for the Vela Japanese Learning App, migrated from the original worker code.

## Features

- **LLM Chat API**: Supports Google Gemini and OpenRouter providers
- **Chat History API**: Save and retrieve chat conversations using DynamoDB
- **AWS Lambda**: Designed to run as AWS Lambda functions
- **CORS Support**: Built-in CORS handling for web applications

## Endpoints

### LLM Chat API

**POST /api/llm-chat**

Send chat requests to LLM providers (Google Gemini or OpenRouter).

```json
{
  "provider": "google" | "openrouter",
  "model": "gemini-2.5-flash-lite" | "openai/gpt-oss-20b:free",
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"}
  ],
  "temperature": 0.7,
  "maxTokens": 1024
}
```

### Chat History API

**POST /api/chat-history/save**

Save a chat message to DynamoDB.

```json
{
  "ThreadId": "thread-123",
  "Timestamp": 1693526400000,
  "UserId": "user-456",
  "message": "Hello world",
  "is_user": true
}
```

**GET /api/chat-history/threads?user_id=USER_ID**

Get all chat threads for a user.

**GET /api/chat-history/messages?thread_id=THREAD_ID**

Get all messages in a specific thread.

**DELETE /api/chat-history/thread?thread_id=THREAD_ID**

**Requires Authentication**: Delete a chat thread and all its messages. The API validates that the authenticated user owns the thread before deletion. Requires a valid Cognito access token in the `Authorization: Bearer <token>` header.

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

- `GEMINI_API_KEY`: Google Gemini API key
- `OPENROUTER_API_KEY`: OpenRouter API key
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
- `DDB_TABLE`: DynamoDB table name (default: vela)

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
