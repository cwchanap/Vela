# Vela API Testing

This project uses [Vitest](https://vitest.dev/) for unit testing.

## Test Structure

### Test Files

- `test/types.test.ts` - Tests for TypeScript types and interfaces
- `test/llm-chat.test.ts` - Tests for the LLM chat route functionality
- `test/chat-history.test.ts` - Tests for the chat history route functionality
- `test/index.test.ts` - Tests for the main app structure and routing

### Test Configuration

- **Configuration**: `vitest.config.ts`
- **Environment**: Node.js
- **Coverage Provider**: v8
- **Globals**: Enabled for describe, it, expect functions

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Features

### Mocking

- **AWS SDK**: Mocked for DynamoDB operations
- **Fetch API**: Mocked for external API calls (Google Gemini, OpenRouter)
- **Environment Variables**: Injected through test app helpers

### Test Coverage

The tests cover:

- **Route-level testing**: CORS, input validation, error handling
- **Provider testing**: Google Gemini and OpenRouter API integrations
- **Database operations**: DynamoDB save/retrieve operations
- **Type validation**: TypeScript interface compliance
- **Error scenarios**: Missing credentials, API failures, invalid input

### Key Testing Patterns

#### Hono App Testing

```typescript
// Create test app with environment variables
function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });

  app.route('/', routeToTest);
  return app;
}

// Test the route
const app = createTestApp({ API_KEY: 'test-key' });
const req = new Request('http://localhost/endpoint', { method: 'POST' });
const res = await app.request(req);
```

#### API Mocking

```typescript
// Mock external API calls
global.fetch = vi.fn();

(global.fetch as any).mockResolvedValueOnce({
  ok: true,
  text: () => Promise.resolve(JSON.stringify(mockResponse)),
});
```

#### AWS SDK Mocking

```typescript
// Mock AWS SDK modules
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({ send: mockSend }),
  },
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
}));
```

## Coverage Reports

Coverage reports are generated in the `coverage/` directory with:

- Text output in terminal
- JSON report for CI/CD integration
- HTML report for detailed browsing

## Best Practices

1. **Mock external dependencies** to ensure tests run independently
2. **Test error scenarios** as well as happy paths
3. **Use descriptive test names** that explain the expected behavior
4. **Group related tests** using describe blocks
5. **Clean up mocks** between tests using `beforeEach(() => vi.clearAllMocks())`
6. **Test at the route level** rather than individual functions for better integration coverage
