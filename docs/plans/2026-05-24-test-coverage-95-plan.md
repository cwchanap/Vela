# Test Coverage 95% Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reach 95% line coverage across all packages (80% for CDK) by configuring coverage exclusions for type/enum/constant files and writing targeted tests for uncovered business logic.

**Architecture:** Each package keeps its existing test framework and patterns. Coverage is configured via vitest.config.ts (Vitest packages) and bunfig.toml (Bun packages). New tests follow co-located or `test/` directory conventions already established in each package.

**Tech Stack:** Vitest (v8 provider) for vela/vela-ext/common, Bun test runner for vela-api/cdk, @vue/test-utils for Vue components

**Design doc:** `docs/plans/2026-05-24-test-coverage-95-design.md`

---

## Task 1: Configure coverage exclusions in apps/vela

**Files:**

- Modify: `apps/vela/vitest.config.ts:26-32`

**Step 1: Update coverage.exclude to skip type/enum/constant files**

Replace the existing `exclude` array in the coverage section:

```ts
exclude: [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'src/**/*.spec.ts',
  'e2e/**',
  'node_modules/**',
  'src/**/*.d.ts',
  'src/types/**',
  'src/**/types.ts',
  'src/**/models.ts',
  'src/**/constants.ts',
],
```

**Step 2: Add coverage thresholds**

Add `thresholds` inside the `coverage` block (after `exclude`):

```ts
thresholds: {
  lines: 95,
},
```

**Step 3: Run tests to verify**

Run: `cd apps/vela && bun run test:unit -- --coverage`
Expected: All tests pass. Coverage report shows type/enum/constant files excluded. Line coverage at or above 95%.

**Step 4: Commit**

```bash
git add apps/vela/vitest.config.ts
git commit -m "chore(vela): configure coverage exclusions and 95% threshold"
```

---

## Task 2: Configure coverage exclusions in apps/vela-ext

**Files:**

- Modify: `apps/vela-ext/vitest.config.ts:20`

**Step 1: Update coverage.exclude**

Replace the existing `exclude` array:

```ts
exclude: [
  '{components,tests}/**/*.test.ts',
  '{components,tests}/**/*.spec.ts',
  'entrypoints/**/*.d.ts',
  'entrypoints/popup/main.ts',
  'components/HelloWorld.vue',
],
```

**Step 2: Add coverage thresholds**

Add `thresholds` inside the `coverage` block:

```ts
thresholds: {
  lines: 95,
},
```

**Step 3: Run tests to verify config (tests may not hit 95% yet)**

Run: `cd apps/vela-ext && bun run test:unit -- --coverage`
Expected: All tests pass. Exclusions applied. Coverage below 95% (new tests needed).

**Step 4: Commit**

```bash
git add apps/vela-ext/vitest.config.ts
git commit -m "chore(vela-ext): configure coverage exclusions and 95% threshold"
```

---

## Task 3: Configure coverage in packages/common

**Files:**

- Modify: `packages/common/vitest.config.ts`

**Step 1: Add full coverage configuration**

Replace the entire config:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/index.ts', 'src/constants.ts'],
      thresholds: {
        lines: 95,
      },
    },
  },
});
```

**Step 2: Run tests to verify config**

Run: `cd packages/common && bun run test:unit`
Expected: Tests pass. Coverage below 95% (new tests needed).

**Step 3: Commit**

```bash
git add packages/common/vitest.config.ts
git commit -m "chore(common): add coverage config with exclusions and 95% threshold"
```

---

## Task 4: Configure coverage exclusions in apps/vela-api

**Files:**

- Modify: `apps/vela-api/bunfig.toml`

**Step 1: Update bunfig.toml**

Add type/constant files to the ignore patterns:

```toml
[test]
coverage = true
coverageSkipTestFiles = true
coverageThreshold = 0
coverageReporter = ["text", "lcov"]
coveragePathIgnorePatterns = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "src/types.ts",
  "src/tts/types.ts",
]
```

Note: Bun's `coverageThreshold` does not support per-line thresholds natively. We keep it at 0 for now. Coverage will be verified manually after writing new tests.

**Step 2: Run tests to verify**

Run: `cd apps/vela-api && bun run test:coverage`
Expected: All 451 tests pass. Coverage report excludes types.ts and tts/types.ts.

**Step 3: Commit**

```bash
git add apps/vela-api/bunfig.toml
git commit -m "chore(vela-api): add coverage exclusions for type files"
```

---

## Task 5: Write tests for packages/common/src/config.ts

**Files:**

- Create: `packages/common/src/config.test.ts`
- Test: `packages/common/src/config.ts`

**Step 1: Write the test file**

```ts
import { describe, expect, it } from 'vitest';
import { createQueryClient, QUERY_STALE_TIME, QUERY_GC_TIME } from './config';

describe('config', () => {
  describe('constants', () => {
    it('defines QUERY_STALE_TIME as 5 minutes in milliseconds', () => {
      expect(QUERY_STALE_TIME).toBe(5 * 60 * 1000);
    });

    it('defines QUERY_GC_TIME as 10 minutes in milliseconds', () => {
      expect(QUERY_GC_TIME).toBe(10 * 60 * 1000);
    });
  });

  describe('createQueryClient', () => {
    it('returns a QueryClient with correct staleTime', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.staleTime).toBe(QUERY_STALE_TIME);
    });

    it('returns a QueryClient with correct gcTime', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.gcTime).toBe(QUERY_GC_TIME);
    });

    it('configures query retry to 2', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.retry).toBe(2);
    });

    it('configures mutation retry to 1', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().mutations?.retry).toBe(1);
    });

    it('enables refetchOnWindowFocus', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    });

    it('disables refetchOnReconnect', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(false);
    });

    it('enables refetchOnMount', () => {
      const client = createQueryClient();
      expect(client.getDefaultOptions().queries?.refetchOnMount).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/common && bun vitest run src/config.test.ts`
Expected: 8 tests PASS.

**Step 3: Commit**

```bash
git add packages/common/src/config.test.ts
git commit -m "test(common): add tests for createQueryClient and query constants"
```

---

## Task 6: Write tests for packages/common/src/keys.ts

**Files:**

- Create: `packages/common/src/keys.test.ts`
- Test: `packages/common/src/keys.ts`

**Step 1: Write the test file**

```ts
import { describe, expect, it } from 'vitest';
import {
  authKeys,
  gameKeys,
  progressKeys,
  savedSentencesKeys,
  dictionaryKeys,
  srsKeys,
  ttsKeys,
} from './keys';

describe('query key factories', () => {
  describe('authKeys', () => {
    it('returns base key', () => {
      expect(authKeys.all).toEqual(['auth']);
    });

    it('returns session key', () => {
      expect(authKeys.session()).toEqual(['auth', 'session']);
    });

    it('returns user key', () => {
      expect(authKeys.user()).toEqual(['auth', 'user']);
    });

    it('returns profile key with userId', () => {
      expect(authKeys.profile('user-1')).toEqual(['auth', 'profile', 'user-1']);
    });

    it('returns profile key with null userId', () => {
      expect(authKeys.profile(null)).toEqual(['auth', 'profile', null]);
    });
  });

  describe('gameKeys', () => {
    it('returns base key', () => {
      expect(gameKeys.all).toEqual(['games']);
    });

    it('returns vocabulary key with count', () => {
      expect(gameKeys.vocabulary(10)).toEqual(['games', 'vocabulary', 10]);
    });

    it('returns sentences key with count', () => {
      expect(gameKeys.sentences(5)).toEqual(['games', 'sentences', 5]);
    });
  });

  describe('progressKeys', () => {
    it('returns base key', () => {
      expect(progressKeys.all).toEqual(['progress']);
    });

    it('returns analytics key with userId', () => {
      expect(progressKeys.analytics('user-1')).toEqual(['progress', 'analytics', 'user-1']);
    });

    it('returns session key', () => {
      expect(progressKeys.session('sess-1')).toEqual(['progress', 'session', 'sess-1']);
    });
  });

  describe('savedSentencesKeys', () => {
    it('returns base key', () => {
      expect(savedSentencesKeys.all).toEqual(['saved-sentences']);
    });

    it('returns list key without limit', () => {
      expect(savedSentencesKeys.list()).toEqual(['saved-sentences', 'list', undefined]);
    });

    it('returns list key with limit', () => {
      expect(savedSentencesKeys.list(50)).toEqual(['saved-sentences', 'list', 50]);
    });

    it('returns detail key', () => {
      expect(savedSentencesKeys.detail('abc')).toEqual(['saved-sentences', 'detail', 'abc']);
    });
  });

  describe('dictionaryKeys', () => {
    it('returns base key', () => {
      expect(dictionaryKeys.all).toEqual(['dictionary']);
    });

    it('returns lookup key with word', () => {
      expect(dictionaryKeys.lookup('猫')).toEqual(['dictionary', 'lookup', '猫']);
    });
  });

  describe('srsKeys', () => {
    it('returns base key', () => {
      expect(srsKeys.all).toEqual(['srs']);
    });

    it('returns due key with limit only', () => {
      expect(srsKeys.due(20)).toEqual(['srs', 'due', 20, undefined]);
    });

    it('returns due key with limit and jlpt levels', () => {
      expect(srsKeys.due(10, [3, 4])).toEqual(['srs', 'due', 10, [3, 4]]);
    });

    it('returns stats without jlpt', () => {
      expect(srsKeys.stats()).toEqual(['srs', 'stats', undefined]);
    });

    it('returns stats with jlpt levels', () => {
      expect(srsKeys.stats([2, 3])).toEqual(['srs', 'stats', [2, 3]]);
    });

    it('returns progress key', () => {
      expect(srsKeys.progress('vocab-1')).toEqual(['srs', 'progress', 'vocab-1']);
    });

    it('returns allProgress key', () => {
      expect(srsKeys.allProgress()).toEqual(['srs', 'all']);
    });
  });

  describe('ttsKeys', () => {
    it('returns base key', () => {
      expect(ttsKeys.all).toEqual(['tts']);
    });

    it('returns settings key with userId', () => {
      expect(ttsKeys.settings('user-1')).toEqual(['tts', 'settings', 'user-1']);
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/common && bun vitest run src/keys.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/common/src/keys.test.ts
git commit -m "test(common): add tests for query key factories"
```

---

## Task 7: Write tests for apps/vela-ext entrypoints/utils/idb.ts

**Files:**

- Create: `apps/vela-ext/tests/utils/idb.test.ts`
- Test: `apps/vela-ext/entrypoints/utils/idb.ts`

**Step 1: Write the test file**

This file wraps IndexedDB. Use the same `makeSuccessRequest` pattern from `background.test.ts` to mock IDB requests.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeSuccessRequest(result: any): IDBRequest {
  const req = {
    result,
    error: null,
    onsuccess: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    onupgradeneeded: null as ((ev: Event) => void) | null,
  } as any;

  queueMicrotask(() => {
    if (req.onsuccess) req.onsuccess({} as Event);
  });

  return req as IDBRequest;
}

function makeErrorRequest(error: DOMException): IDBRequest {
  const req = {
    result: undefined,
    error,
    onsuccess: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    onupgradeneeded: null as ((ev: Event) => void) | null,
  } as any;

  queueMicrotask(() => {
    if (req.onerror) req.onerror({} as Event);
  });

  return req as IDBRequest;
}

describe('idb utils', () => {
  let mockDB: any;
  let mockObjectStore: any;

  beforeEach(() => {
    mockObjectStore = {
      clear: vi.fn(() => makeSuccessRequest(undefined)),
    };

    mockDB = {
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => mockObjectStore),
      })),
      createObjectStore: vi.fn(() => mockObjectStore),
      objectStoreNames: {
        contains: vi.fn(() => false),
      },
    };

    (globalThis as any).indexedDB = {
      open: vi.fn(() => {
        const req = makeSuccessRequest(mockDB) as any;
        req.result = mockDB;

        queueMicrotask(() => {
          if (req.onupgradeneeded) {
            req.result = mockDB;
            req.onupgradeneeded({} as Event);
          }
          if (req.onsuccess) req.onsuccess({} as Event);
        });

        return req;
      }),
    };
  });

  describe('openDB', () => {
    it('opens a database with the correct name and version', async () => {
      const { openDB } = await import('../../entrypoints/utils/idb');

      const db = await openDB();

      expect(globalThis.indexedDB.open).toHaveBeenCalledWith('vela-offline-queue', 1);
      expect(db).toBe(mockDB);
    });

    it('creates object store on upgrade if it does not exist', async () => {
      const { openDB } = await import('../../entrypoints/utils/idb');

      await openDB();

      expect(mockDB.createObjectStore).toHaveBeenCalledWith('vela-pending-sentences', {
        autoIncrement: true,
        keyPath: 'id',
      });
    });

    it('skips creating object store if it already exists', async () => {
      mockDB.objectStoreNames.contains = vi.fn(() => true);

      const { openDB } = await import('../../entrypoints/utils/idb');

      await openDB();

      expect(mockDB.createObjectStore).not.toHaveBeenCalled();
    });

    it('rejects when indexedDB.open fails', async () => {
      const dbError = new DOMException('Failed to open', 'UnknownError');
      (globalThis as any).indexedDB.open = vi.fn(() => makeErrorRequest(dbError));

      const { openDB } = await import('../../entrypoints/utils/idb');

      await expect(openDB()).rejects.toBe(dbError);
    });
  });

  describe('clearAllPending', () => {
    it('clears the object store', async () => {
      const { clearAllPending } = await import('../../entrypoints/utils/idb');

      await clearAllPending();

      expect(mockDB.transaction).toHaveBeenCalledWith('vela-pending-sentences', 'readwrite');
      expect(mockObjectStore.clear).toHaveBeenCalled();
    });

    it('rejects when clear operation fails', async () => {
      const clearError = new DOMException('Clear failed', 'UnknownError');
      mockObjectStore.clear = vi.fn(() => makeErrorRequest(clearError));

      const { clearAllPending } = await import('../../entrypoints/utils/idb');

      await expect(clearAllPending()).rejects.toBe(clearError);
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd apps/vela-ext && bun vitest run tests/utils/idb.test.ts`
Expected: 6 tests PASS.

**Step 3: Commit**

```bash
git add apps/vela-ext/tests/utils/idb.test.ts
git commit -m "test(vela-ext): add tests for IndexedDB wrapper"
```

---

## Task 8: Write tests for apps/vela-ext entrypoints/utils/pendingQueue.ts

**Files:**

- Create: `apps/vela-ext/tests/utils/pendingQueue.test.ts`
- Test: `apps/vela-ext/entrypoints/utils/pendingQueue.ts`

**Step 1: Write the test file**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpenDB } = vi.hoisted(() => {
  const mockOpenDB = vi.fn();
  return { mockOpenDB };
});

function makeSuccessRequest(result: any): IDBRequest {
  const req = {
    result,
    error: null,
    onsuccess: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
  } as any;

  queueMicrotask(() => {
    if (req.onsuccess) req.onsuccess({} as Event);
  });

  return req as IDBRequest;
}

function makeErrorRequest(error: DOMException): IDBRequest {
  const req = {
    result: undefined,
    error,
    onsuccess: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
  } as any;

  queueMicrotask(() => {
    if (req.onerror) req.onerror({} as Event);
  });

  return req as IDBRequest;
}

vi.mock('../../entrypoints/utils/idb', () => ({
  openDB: mockOpenDB,
  STORE_NAME: 'vela-pending-sentences',
}));

describe('pendingQueue', () => {
  let mockStore: any;
  let mockDB: any;

  beforeEach(() => {
    mockStore = {
      count: vi.fn(() => makeSuccessRequest(5)),
    };

    mockDB = {
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => mockStore),
      })),
    };

    mockOpenDB.mockResolvedValue(mockDB);
  });

  describe('getPendingQueueCount', () => {
    it('returns the count from the object store', async () => {
      const { getPendingQueueCount } = await import('../../entrypoints/utils/pendingQueue');

      const count = await getPendingQueueCount();

      expect(count).toBe(5);
      expect(mockDB.transaction).toHaveBeenCalledWith('vela-pending-sentences', 'readonly');
    });

    it('returns 0 when IndexedDB fails', async () => {
      mockOpenDB.mockRejectedValue(new Error('IndexedDB unavailable'));

      const { getPendingQueueCount } = await import('../../entrypoints/utils/pendingQueue');

      const count = await getPendingQueueCount();

      expect(count).toBe(0);
    });

    it('rejects and returns 0 when count request fails', async () => {
      const dbError = new DOMException('Count failed', 'UnknownError');
      mockStore.count = vi.fn(() => makeErrorRequest(dbError));

      const { getPendingQueueCount } = await import('../../entrypoints/utils/pendingQueue');

      const count = await getPendingQueueCount();

      expect(count).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd apps/vela-ext && bun vitest run tests/utils/pendingQueue.test.ts`
Expected: 3 tests PASS.

**Step 3: Commit**

```bash
git add apps/vela-ext/tests/utils/pendingQueue.test.ts
git commit -m "test(vela-ext): add tests for pendingQueue"
```

---

## Task 9: Expand tests for apps/vela-ext entrypoints/utils/storage.ts

**Files:**

- Modify: `apps/vela-ext/tests/utils/storage.test.ts`

The existing test file covers save/get/clear tokens, access token refresh, and explicit signout. Missing coverage:

- `getValidIdToken()` — success and error cases
- `refreshIdToken()` — success, missing refresh token, refresh API error, missing ID token after refresh
- `isAuthenticated()` — true when tokens exist, false when null
- `getValidAccessToken()` — throws when no tokens
- `refreshAccessToken()` — throws when no refresh token, clears auth on API error

**Step 1: Add missing test cases**

Add the following tests to the existing `describe('storage utils', ...)` block in `apps/vela-ext/tests/utils/storage.test.ts`:

After the existing `it('returns valid access token when available', ...)` test, add:

```ts
it('throws when getValidAccessToken called with no tokens', async () => {
  await expect(getValidAccessToken()).rejects.toThrow('Not authenticated');
});
```

After the existing `it('refreshes access token and persists new credentials', ...)` test, add:

```ts
it('throws when refreshAccessToken called with no refresh token', async () => {
  await saveAuthTokens({ accessToken: 'a', refreshToken: '', idToken: 'id' });

  await expect(refreshAccessToken()).rejects.toThrow('No refresh token available');
});

it('clears auth data when refreshAccessToken fails with API error', async () => {
  await saveAuthTokens(tokens);
  mockRefreshToken.mockRejectedValueOnce(new Error('API error'));

  await expect(refreshAccessToken()).rejects.toThrow('Session expired');
  await expect(getAuthTokens()).resolves.toBeNull();
});
```

After the explicit signout describe block, add:

```ts
describe('isAuthenticated', () => {
  it('returns true when tokens exist with accessToken', async () => {
    const { isAuthenticated } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens(tokens);

    await expect(isAuthenticated()).resolves.toBe(true);
  });

  it('returns false when no tokens stored', async () => {
    const { isAuthenticated } = await import('../../entrypoints/utils/storage');

    await expect(isAuthenticated()).resolves.toBe(false);
  });
});

describe('getValidIdToken', () => {
  it('returns id token when available', async () => {
    const { getValidIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens(tokens);

    await expect(getValidIdToken()).resolves.toBe('id-token');
  });

  it('throws when no tokens stored', async () => {
    const { getValidIdToken } = await import('../../entrypoints/utils/storage');

    await expect(getValidIdToken()).rejects.toThrow('Not authenticated');
  });

  it('throws when idToken is missing', async () => {
    const { getValidIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens({ accessToken: 'a', refreshToken: 'r', idToken: '' });

    await expect(getValidIdToken()).rejects.toThrow('No ID token available');
  });
});

describe('refreshIdToken', () => {
  it('refreshes and returns a new id token', async () => {
    const { refreshIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens(tokens);

    const idToken = await refreshIdToken();

    expect(idToken).toBe('refresh-token-id');
  });

  it('throws when no refresh token available', async () => {
    const { refreshIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens({ accessToken: 'a', refreshToken: '', idToken: 'id' });

    await expect(refreshIdToken()).rejects.toThrow('No refresh token available');
  });

  it('clears auth data when refresh API fails', async () => {
    const { refreshIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens(tokens);
    mockRefreshToken.mockRejectedValueOnce(new Error('API error'));

    await expect(refreshIdToken()).rejects.toThrow('Session expired');
    await expect(getAuthTokens()).resolves.toBeNull();
  });

  it('throws when refreshed tokens have no id token', async () => {
    const { refreshIdToken } = await import('../../entrypoints/utils/storage');
    await saveAuthTokens(tokens);
    mockRefreshToken.mockResolvedValueOnce({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: '',
    });

    await expect(refreshIdToken()).rejects.toThrow('Missing ID token after refresh');
  });
});
```

**Step 2: Run test to verify all tests pass**

Run: `cd apps/vela-ext && bun vitest run tests/utils/storage.test.ts`
Expected: All tests PASS (original + new).

**Step 3: Commit**

```bash
git add apps/vela-ext/tests/utils/storage.test.ts
git commit -m "test(vela-ext): expand storage tests for idToken, isAuthenticated, error paths"
```

---

## Task 10: Write snapshot test for packages/cdk DatabaseStack

**Files:**

- Create: `packages/cdk/test/database-stack.test.ts`
- Test: `packages/cdk/lib/database-stack.ts`

**Step 1: Write the test file**

Follow the same pattern as `auth-stack.test.ts`:

```ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DatabaseStack } from '../lib/database-stack';

describe('DatabaseStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DSQL_DELETION_PROTECTION = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate(): Template {
    const app = new App();
    const stack = new DatabaseStack(app, 'TestDatabaseStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    return Template.fromStack(stack);
  }

  test('creates chat history table with composite key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-chat-history',
      KeySchema: Match.arrayWith([
        { AttributeName: 'ThreadId', KeyType: 'HASH' },
        { AttributeName: 'Timestamp', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates chat history UserIdIndex GSI', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-chat-history',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'UserIdIndex',
          KeySchema: Match.arrayWith([
            { AttributeName: 'UserId', KeyType: 'HASH' },
            { AttributeName: 'Timestamp', KeyType: 'RANGE' },
          ]),
        }),
      ]),
    });
  });

  test('creates profiles table with user_id partition key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-profiles',
      KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
    });
  });

  test('creates vocabulary table with id partition key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-vocabulary',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });

  test('creates sentences table with id partition key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-sentences',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });

  test('creates game sessions table with composite key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-game-sessions',
      KeySchema: Match.arrayWith([
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'session_id', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates daily progress table with composite key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-daily-progress',
      KeySchema: Match.arrayWith([
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates saved sentences table with composite key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-saved-sentences',
      KeySchema: Match.arrayWith([
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'sentence_id', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates TTS settings table with user_id partition key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-tts-settings',
      KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
    });
  });

  test('creates user vocabulary progress table with composite key', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-user-vocabulary-progress',
      KeySchema: Match.arrayWith([
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'vocabulary_id', KeyType: 'RANGE' },
      ]),
    });
  });

  test('creates NextReviewDateIndex GSI on user vocabulary progress table', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-user-vocabulary-progress',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'NextReviewDateIndex',
          KeySchema: Match.arrayWith([
            { AttributeName: 'user_id', KeyType: 'HASH' },
            { AttributeName: 'next_review_date', KeyType: 'RANGE' },
          ]),
        }),
      ]),
    });
  });

  test('creates Aurora DSQL cluster resource', () => {
    const template = synthesizeTemplate();

    template.hasResource('AWS::DSQL::Cluster', {});
  });

  test('all DynamoDB tables use PAY_PER_REQUEST billing', () => {
    const template = synthesizeTemplate();
    const tables = template.findResources('AWS::DynamoDB::Table');

    for (const [, table] of Object.entries(tables)) {
      expect(table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    }
  });

  test('all DynamoDB tables have point-in-time recovery enabled', () => {
    const template = synthesizeTemplate();
    const tables = template.findResources('AWS::DynamoDB::Table');

    for (const [, table] of Object.entries(tables)) {
      expect(table.Properties.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled).toBe(
        true,
      );
    }
  });

  test('exposes table references as public properties', () => {
    const app = new App();
    const stack = new DatabaseStack(app, 'TestDatabaseStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    expect(stack.chatHistoryTable).toBeDefined();
    expect(stack.profilesTable).toBeDefined();
    expect(stack.vocabularyTable).toBeDefined();
    expect(stack.sentencesTable).toBeDefined();
    expect(stack.gameSessionsTable).toBeDefined();
    expect(stack.dailyProgressTable).toBeDefined();
    expect(stack.savedSentencesTable).toBeDefined();
    expect(stack.ttsSettingsTable).toBeDefined();
    expect(stack.userVocabularyProgressTable).toBeDefined();
    expect(stack.dbClusterArn).toBeDefined();
    expect(stack.dbClusterEndpoint).toBeDefined();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/cdk && bun test test/database-stack.test.ts`
Expected: 15 tests PASS.

**Step 3: Commit**

```bash
git add packages/cdk/test/database-stack.test.ts
git commit -m "test(cdk): add DatabaseStack snapshot tests"
```

---

## Task 11: Write snapshot test for packages/cdk StorageStack

**Files:**

- Create: `packages/cdk/test/storage-stack.test.ts`
- Test: `packages/cdk/lib/storage-stack.ts`

**Step 1: Write the test file**

```ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { StorageStack } from '../lib/storage-stack';

describe('StorageStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate(): Template {
    const app = new App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    return Template.fromStack(stack);
  }

  test('creates TTS audio S3 bucket', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('bucket blocks all public access', () => {
    const template = synthesizeTemplate();
    const buckets = template.findResources('AWS::S3::Bucket');

    for (const [, bucket] of Object.entries(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration?.BlockPublicAcls).toBe(true);
      expect(bucket.Properties.PublicAccessBlockConfiguration?.RestrictPublicBuckets).toBe(true);
    }
  });

  test('bucket has CORS configuration with GET and HEAD methods', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['GET', 'HEAD']),
          }),
        ]),
      },
    });
  });

  test('includes localhost in CORS origins in non-production', () => {
    process.env.NODE_ENV = 'development';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: Match.arrayWith(['http://localhost:9000']),
          }),
        ]),
      },
    });
  });

  test('uses production domain when no FRONTEND_ORIGINS set in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_ORIGINS;

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: Match.arrayWith(['https://vela.cwchanap.dev']),
          }),
        ]),
      },
    });
  });

  test('bucket is not versioned', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Suspended' },
    });
  });

  test('exposes ttsAudioBucket as public property', () => {
    const app = new App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    expect(stack.ttsAudioBucket).toBeDefined();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/cdk && bun test test/storage-stack.test.ts`
Expected: 7 tests PASS.

**Step 3: Commit**

```bash
git add packages/cdk/test/storage-stack.test.ts
git commit -m "test(cdk): add StorageStack snapshot tests"
```

---

## Task 12: Add coverage config for packages/cdk

**Files:**

- Create: `packages/cdk/bunfig.toml`

**Step 1: Create bunfig.toml with coverage configuration**

```toml
[test]
coverage = true
coverageSkipTestFiles = true
coverageThreshold = 0
coverageReporter = ["text", "lcov"]
coveragePathIgnorePatterns = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "lib/naming.ts",
]
```

**Step 2: Run tests to verify**

Run: `cd packages/cdk && bun test`
Expected: All tests pass. Coverage report shown.

**Step 3: Commit**

```bash
git add packages/cdk/bunfig.toml
git commit -m "chore(cdk): add coverage configuration with 80% target"
```

---

## Task 13: Add targeted tests for apps/vela-api route gaps

This task covers the highest-impact uncovered lines in the API routes. Each sub-task targets a specific file.

**Files:**

- Modify: `apps/vela-api/test/routes/profiles.test.ts`
- Modify: `apps/vela-api/test/routes/auth.test.ts`
- Modify: `apps/vela-api/test/routes/vocabulary.test.ts`

### Sub-task 13a: profiles.test.ts — error paths

Add tests for uncovered error paths in `src/routes/profiles.ts` (lines 61-62, 152-153, 183, 186-205, 262-264). Read the existing test file first to understand the pattern, then add tests for:

- Missing `userId` in context (unauthorized)
- DynamoDB update with empty body returns null
- Profile creation when DynamoDB throws

### Sub-task 13b: auth.test.ts — error paths

Add tests for uncovered lines in `src/routes/auth.ts` (lines 98-100, 117-119):

- Error when `userId` is missing from auth context during profile sync
- Error response when profile creation fails

### Sub-task 13c: vocabulary.test.ts — query parameter edge cases

Add tests for uncovered lines in `src/routes/vocabulary.ts` (lines 34, 36-38):

- Invalid `limit` parameter (negative, zero, non-numeric)
- Missing query parameters

For each sub-task:

**Step 1:** Read the existing test file and the route source file to understand uncovered lines.

**Step 2:** Add test cases following the existing pattern (mock dynamodb, create test app, call `app.request()`).

**Step 3:** Run: `cd apps/vela-api && bun test test/routes/<file>.test.ts`

**Step 4:** Commit:

```bash
git add apps/vela-api/test/routes/
git commit -m "test(vela-api): add error path tests for profiles, auth, vocabulary routes"
```

---

## Task 14: Add targeted tests for apps/vela-api dynamodb.ts gaps

**Files:**

- Modify: `apps/vela-api/test/dynamodb.test.ts`

The `dynamodb.ts` file has many uncovered lines (90.75%). Focus on the most impactful error paths:

**Step 1:** Read `apps/vela-api/test/dynamodb.test.ts` to find where tests end.

**Step 2:** Add tests for:

- `vocabulary.getByIds()` with empty array returns `{}`
- `vocabulary.getByIds()` retry on UnprocessedKeys
- `vocabulary.getByJlptLevel()` with empty levels array
- `dailyProgress.update()` with empty updates returns null
- `userVocabularyProgress.updateAfterReview()` with ConditionalCheckFailedException returns undefined
- `userVocabularyProgress.initializeProgressIfNotExists()` with ConditionalCheckFailedException re-throws
- `userVocabularyProgress.getStats()` with empty user data

**Step 3:** Run: `cd apps/vela-api && bun test test/dynamodb.test.ts`

**Step 4:** Commit:

```bash
git add apps/vela-api/test/dynamodb.test.ts
git commit -m "test(vela-api): add dynamodb error path tests for batch ops, SRS, progress"
```

---

## Task 15: Add targeted tests for remaining apps/vela-api route gaps

**Files:**

- Modify: `apps/vela-api/test/routes/my-dictionaries.test.ts`
- Modify: `apps/vela-api/test/routes/srs.test.ts`
- Modify: `apps/vela-api/test/routes/tts.test.ts`
- Modify: `apps/vela-api/test/routes/chat-history.test.ts`

Add tests for uncovered error handling branches:

**my-dictionaries.test.ts:** Missing sentence validation, idempotency key handling, SSE analyze endpoint error cases.

**srs.test.ts:** Bulk update error paths, getDueItems edge cases.

**tts.test.ts:** Provider fallback, cache miss, settings validation.

**chat-history.test.ts:** Error handling branches, pagination edge cases.

**Step 1:** Read each test file and corresponding route file to identify exact uncovered lines.

**Step 2:** Add targeted test cases.

**Step 3:** Run: `cd apps/vela-api && bun run test:coverage`

**Step 4:** Commit:

```bash
git add apps/vela-api/test/routes/
git commit -m "test(vela-api): add error path tests for remaining routes"
```

---

## Task 16: Final verification — run all coverage reports

**Step 1: Run coverage for all packages**

```bash
cd apps/vela && bun run test:unit -- --coverage
cd apps/vela-api && bun run test:coverage
cd apps/vela-ext && bun run test:unit -- --coverage
cd packages/common && bun vitest run --coverage
cd packages/cdk && bun test
```

**Step 2: Verify thresholds**

| Package         | Target    | Verify            |
| --------------- | --------- | ----------------- |
| apps/vela       | 95% lines | Check text report |
| apps/vela-api   | 95% lines | Check text report |
| apps/vela-ext   | 95% lines | Check text report |
| packages/common | 95% lines | Check text report |
| packages/cdk    | 80% lines | Check text report |

**Step 3: If any package is below target, add more tests for the specific uncovered files identified in the report.**

**Step 4: Commit any additional test fixes**

```bash
git add -A
git commit -m "test: finalize coverage to 95% across all packages"
```
