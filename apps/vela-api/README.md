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

## Environment Variables

The following environment variables are required:

### LLM Chat

- `GEMINI_API_KEY`: Google Gemini API key
- `OPENROUTER_API_KEY`: OpenRouter API key
- `APP_NAME`: Application name for OpenRouter headers

### Chat History (DynamoDB)

- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
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
