# Contextual Sentence Mining — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SM-1 through SM-8 — word highlighting, definition popover, flashcard creation, batch page import, and offline sync queue.

**Architecture:** Client-side kuromoji tokenization in `@vela/common` (lazy singleton, shared); Jisho.org lookups proxied through a new Hono endpoint; flashcard creation via a new `POST /vocabulary/from-word` endpoint; batch import via a Shadow DOM overlay in the content script; offline-resilient saves via an IndexedDB queue in the MV3 background service worker.

**Tech Stack:** kuromoji.js, Hono + Zod, Quasar `q-menu`, IndexedDB, WXT (browser extension), Vitest (vela + vela-ext tests), Bun test runner (vela-api tests).

---

## File Map

| Action | File                                                        | Responsibility                                          |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| Create | `packages/common/src/tokenizer.ts`                          | kuromoji lazy-singleton wrapper                         |
| Create | `packages/common/src/tokenizer.test.ts`                     | tokenizer unit tests                                    |
| Create | `packages/common/vitest.config.ts`                          | vitest config for packages/common                       |
| Modify | `packages/common/package.json`                              | add kuromoji, @types/kuromoji, vitest, test:unit script |
| Modify | `packages/common/src/index.ts`                              | export tokenize, configureDicPath, Token                |
| Create | `apps/vela-api/src/routes/dictionary.ts`                    | GET /dictionary/lookup Jisho proxy                      |
| Create | `apps/vela-api/test/routes/dictionary.test.ts`              | Jisho proxy tests                                       |
| Modify | `apps/vela-api/src/dynamodb.ts`                             | add vocabulary.findByWord and vocabulary.create         |
| Create | `apps/vela-api/src/routes/vocabulary.ts`                    | POST /vocabulary/from-word flashcard endpoint           |
| Create | `apps/vela-api/test/routes/vocabulary.test.ts`              | flashcard endpoint tests                                |
| Modify | `apps/vela-api/src/index.ts`                                | register /dictionary and /vocabulary routes             |
| Modify | `apps/vela/src/utils/japanese.ts`                           | add computeDifficulty function                          |
| Modify | `apps/vela/src/utils/japanese.test.ts`                      | add computeDifficulty tests                             |
| Modify | `apps/vela/src/boot/main.ts`                                | call configureDicPath('/kuromoji-dict')                 |
| Create | `apps/vela/src/services/vocabularyService.ts`               | Jisho lookup + flashcard API calls                      |
| Create | `apps/vela/src/services/vocabularyService.test.ts`          | vocabularyService tests                                 |
| Modify | `apps/vela/src/pages/dictionary/MyDictionariesPage.vue`     | token spans, popover, difficulty badge                  |
| Modify | `apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts` | test tokenization UI                                    |
| Modify | `apps/vela-ext/entrypoints/content.ts`                      | page scan + Shadow DOM overlay                          |
| Create | `apps/vela-ext/entrypoints/content.test.ts`                 | content script unit tests                               |
| Modify | `apps/vela-ext/entrypoints/background.ts`                   | scan context menu, batch save, IndexedDB queue          |
| Modify | `apps/vela-ext/entrypoints/popup/DashboardPage.vue`         | pending queue badge                                     |

---

## Task 1: Tokenizer (`packages/common`)

**Files:**

- Create: `packages/common/src/tokenizer.ts`
- Create: `packages/common/src/tokenizer.test.ts`
- Create: `packages/common/vitest.config.ts`
- Modify: `packages/common/package.json`
- Modify: `packages/common/src/index.ts`

- [ ] **Step 1: Add dependencies and test setup to packages/common**

```bash
cd packages/common
bun add kuromoji
bun add -d @types/kuromoji vitest
```

Then add `"test:unit": "vitest run"` to `packages/common/package.json` scripts section:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "lint": "eslint \"src/**/*.ts\"",
    "lint:fix": "eslint \"src/**/*.ts\" --fix",
    "format": "prettier --write \"**/*.{js,ts,json,md}\" --ignore-path ../../.gitignore",
    "test": "bun run test:unit",
    "test:unit": "vitest run"
  }
}
```

Create `packages/common/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `packages/common/src/tokenizer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTokenize = vi.fn();

vi.mock('kuromoji', () => ({
  default: {
    builder: vi.fn(() => ({
      build: vi.fn((cb: (err: Error | null, t: any) => void) => {
        cb(null, { tokenize: mockTokenize });
      }),
    })),
  },
}));

// Dynamic import AFTER mock declaration so the mock is in place
const { tokenize } = await import('./tokenizer');

describe('tokenize', () => {
  beforeEach(() => {
    mockTokenize.mockReset();
  });

  it('maps kuromoji IpadicFeatures fields to Token', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '食べる',
        reading: 'タベル',
        basic_form: '食べる',
        pos: '動詞',
        pos_detail_1: '自立',
      },
    ]);

    const result = await tokenize('食べる');

    expect(result).toEqual([
      {
        surface_form: '食べる',
        reading: 'タベル',
        dictionary_form: '食べる',
        pos: '動詞',
        pos_detail_1: '自立',
      },
    ]);
  });

  it('filters out pure-whitespace tokens', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '私',
        reading: 'ワタシ',
        basic_form: '私',
        pos: '名詞',
        pos_detail_1: '代名詞',
      },
      {
        surface_form: ' ',
        reading: ' ',
        basic_form: ' ',
        pos: '記号',
        pos_detail_1: '空白',
      },
      {
        surface_form: 'は',
        reading: 'ハ',
        basic_form: 'は',
        pos: '助詞',
        pos_detail_1: '係助詞',
      },
    ]);

    const result = await tokenize('私 は');
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.surface_form)).toEqual(['私', 'は']);
  });

  it('falls back to surface_form when reading or basic_form is missing', async () => {
    mockTokenize.mockReturnValue([
      {
        surface_form: '笑',
        reading: undefined,
        basic_form: undefined,
        pos: '名詞',
        pos_detail_1: '一般',
      },
    ]);

    const result = await tokenize('笑');
    expect(result[0]?.reading).toBe('笑');
    expect(result[0]?.dictionary_form).toBe('笑');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/common
bun run test:unit
```

Expected: FAIL — `tokenizer` module not found.

- [ ] **Step 4: Implement `packages/common/src/tokenizer.ts`**

```typescript
import kuromoji from 'kuromoji';

export interface Token {
  surface_form: string;
  reading: string;
  dictionary_form: string;
  pos: string;
  pos_detail_1: string;
}

let _dicPath = '/kuromoji-dict';
let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;

/**
 * Set the kuromoji dictionary path before the first tokenize() call.
 * Default: '/kuromoji-dict' (assumes dict files served at that URL path).
 */
export function configureDicPath(dicPath: string): void {
  _dicPath = dicPath;
}

export async function tokenize(text: string): Promise<Token[]> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>(
      (resolve, reject) => {
        kuromoji.builder({ dicPath: _dicPath }).build((err, tokenizer) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
      },
    );
  }
  const tokenizer = await tokenizerPromise;
  return tokenizer
    .tokenize(text)
    .filter((t) => t.surface_form.trim() !== '')
    .map((t) => ({
      surface_form: t.surface_form,
      reading: t.reading ?? t.surface_form,
      dictionary_form: t.basic_form ?? t.surface_form,
      pos: t.pos,
      pos_detail_1: t.pos_detail_1 ?? '',
    }));
}
```

- [ ] **Step 5: Export from `packages/common/src/index.ts`**

Add to the bottom of `packages/common/src/index.ts`:

```typescript
// Export tokenizer
export { tokenize, configureDicPath, type Token } from './tokenizer';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/common
bun run test:unit
```

Expected: PASS — 3 tests pass.

- [ ] **Step 7: Copy kuromoji dict files for the vela app**

Run from the repo root:

```bash
cp -r node_modules/kuromoji/dict apps/vela/public/kuromoji-dict
```

Verify the files landed:

```bash
ls apps/vela/public/kuromoji-dict/
```

Expected output: several `.dat.gz` files (base.dat.gz, cc.dat.gz, tid.dat.gz, etc.).

- [ ] **Step 8: Configure dicPath in `apps/vela/src/boot/main.ts`**

Add the import and call at the top of the boot function:

```typescript
import { boot } from 'quasar/wrappers';
import { configureDicPath } from '@vela/common';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

export default boot(async ({ store }) => {
  // Set kuromoji dictionary path (served from public/kuromoji-dict/)
  configureDicPath('/kuromoji-dict');

  console.log('✅ App boot initialized');

  // Initialize theme
  const themeStore = useThemeStore(store);
  themeStore.initialize();

  // Watch for auth changes and sync theme from user preferences
  const authStore = useAuthStore(store);
  authStore.$subscribe((mutation, state) => {
    if (state.user?.preferences?.darkMode !== undefined) {
      themeStore.syncWithUserPreferences(state.user.preferences.darkMode);
    }
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add packages/common/src/tokenizer.ts \
        packages/common/src/tokenizer.test.ts \
        packages/common/src/index.ts \
        packages/common/vitest.config.ts \
        packages/common/package.json \
        apps/vela/public/kuromoji-dict \
        apps/vela/src/boot/main.ts
git commit -m "feat(common): add kuromoji tokenizer with lazy singleton"
```

---

## Task 2: Jisho Proxy Endpoint (`apps/vela-api`)

**Files:**

- Create: `apps/vela-api/src/routes/dictionary.ts`
- Create: `apps/vela-api/test/routes/dictionary.test.ts`
- Modify: `apps/vela-api/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/vela-api/test/routes/dictionary.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const originalFetch = globalThis.fetch;

const { default: dictionaryRouter } = await import('../../src/routes/dictionary');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dictionaryRouter);
  return app;
}

describe('GET /lookup', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns simplified JishoResult with Cache-Control header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '食べる', reading: 'たべる' }],
            senses: [
              { english_definitions: ['to eat', 'to consume', 'to bite into', 'extra meaning'] },
            ],
            jlpt: ['jlpt-n5'],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=食べる');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body = (await res.json()) as any;
    expect(body).toEqual({
      word: '食べる',
      reading: 'たべる',
      meanings: ['to eat', 'to consume', 'to bite into'],
      jlpt: 'jlpt-n5',
      common: true,
    });
  });

  test('caps meanings at 3 even when Jisho returns more', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '見る', reading: 'みる' }],
            senses: [
              { english_definitions: ['to see', 'to look', 'to watch', 'to observe', 'to check'] },
            ],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=見る');
    const body = (await res.json()) as any;
    expect(body.meanings).toHaveLength(3);
    expect(body.jlpt).toBeUndefined();
  });

  test('returns 404 when Jisho returns empty data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=xyzabc');
    expect(res.status).toBe(404);
  });

  test('returns 400 when word query param is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup');
    expect(res.status).toBe(400);
  });

  test('returns 400 when word is empty string', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup?word=');
    expect(res.status).toBe(400);
  });

  test('returns 502 when Jisho API request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const app = createTestApp();
    const res = await app.request('/lookup?word=test');
    expect(res.status).toBe(502);
  });

  test('URL-encodes the word when calling Jisho', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '東京', reading: 'とうきょう' }],
            senses: [{ english_definitions: ['Tokyo'] }],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    await app.request('/lookup?word=東京');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://jisho.org/api/v1/search/words?keyword=%E6%9D%B1%E4%BA%AC');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/vela-api
bun test test/routes/dictionary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/vela-api/src/routes/dictionary.ts`**

```typescript
import { Hono } from 'hono';
import type { Env } from '../types';

export interface JishoResult {
  word: string;
  reading: string;
  meanings: string[];
  jlpt?: string;
  common: boolean;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/lookup', async (c) => {
  const word = c.req.query('word');

  if (!word || !word.trim()) {
    return c.json({ error: 'word query parameter is required' }, 400);
  }

  const encoded = encodeURIComponent(word.trim());
  const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encoded}`);

  if (!res.ok) {
    return c.json({ error: 'Jisho API request failed' }, 502);
  }

  const data = (await res.json()) as any;
  const items: any[] = data?.data ?? [];

  if (items.length === 0) {
    return c.json({ error: 'No results found' }, 404);
  }

  const first = items[0];
  const japanese = first.japanese?.[0] ?? {};
  const senses = first.senses?.[0] ?? {};

  const result: JishoResult = {
    word: japanese.word ?? word.trim(),
    reading: japanese.reading ?? '',
    meanings: ((senses.english_definitions as string[]) ?? []).slice(0, 3),
    jlpt: Array.isArray(first.jlpt) && first.jlpt.length > 0 ? first.jlpt[0] : undefined,
    common: first.is_common ?? false,
  };

  c.header('Cache-Control', 'public, max-age=86400');
  return c.json(result);
});

export default app;
```

- [ ] **Step 4: Register the route in `apps/vela-api/src/index.ts`**

Add the import after the existing route imports:

```typescript
import dictionaryRouter from './routes/dictionary';
```

Add the route mount after the `myDictionaries` route:

```typescript
// Mount the dictionary (Jisho proxy) routes
app.route('/api/dictionary', dictionaryRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/vela-api
bun test test/routes/dictionary.test.ts
```

Expected: PASS — 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-api/src/routes/dictionary.ts \
        apps/vela-api/test/routes/dictionary.test.ts \
        apps/vela-api/src/index.ts
git commit -m "feat(vela-api): add GET /dictionary/lookup Jisho proxy endpoint"
```

---

## Task 3: Flashcard Creation Endpoint (`apps/vela-api`)

**Files:**

- Modify: `apps/vela-api/src/dynamodb.ts` (add `vocabulary.findByWord` and `vocabulary.create`)
- Create: `apps/vela-api/src/routes/vocabulary.ts`
- Create: `apps/vela-api/test/routes/vocabulary.test.ts`
- Modify: `apps/vela-api/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/vela-api/test/routes/vocabulary.test.ts`:

```typescript
import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mockVocabulary = {
  findByWord: vi.fn(),
  create: vi.fn(),
};

const mockUserVocabularyProgress = {
  get: vi.fn(),
  initializeProgress: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  vocabulary: mockVocabulary,
  userVocabularyProgress: mockUserVocabularyProgress,
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', 'user-123');
    _c.set('userEmail', 'test@example.com');
    await next();
  },
  AuthContext: {},
}));

const { default: vocabularyRouter } = await import('../../src/routes/vocabulary');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    await next();
  });
  app.route('/', vocabularyRouter);
  return app;
}

const validBody = {
  japanese_word: '食べる',
  reading: 'たべる',
  english_translation: 'to eat',
  example_sentence_jp: '私は毎日ご飯を食べる。',
  source_url: 'https://example.com',
  jlpt_level: 5,
};

describe('POST /from-word', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserVocabularyProgress.initializeProgress.mockResolvedValue({});
  });

  test('creates a new vocabulary entry and SRS record when word does not exist', async () => {
    mockVocabulary.findByWord.mockResolvedValue(undefined);
    mockVocabulary.create.mockResolvedValue(undefined);
    mockUserVocabularyProgress.get.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(true);
    expect(body.alreadyInSRS).toBe(false);
    expect(typeof body.vocabulary_id).toBe('string');
    expect(mockVocabulary.create).toHaveBeenCalledTimes(1);
    expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledTimes(1);
  });

  test('reuses existing vocabulary entry when word already exists', async () => {
    mockVocabulary.findByWord.mockResolvedValue({
      id: 'existing-vocab-id',
      japanese_word: '食べる',
    });
    mockUserVocabularyProgress.get.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.vocabulary_id).toBe('existing-vocab-id');
    expect(mockVocabulary.create).not.toHaveBeenCalled();
    expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledTimes(1);
  });

  test('returns alreadyInSRS: true when SRS progress already exists', async () => {
    mockVocabulary.findByWord.mockResolvedValue({ id: 'vocab-id' });
    mockUserVocabularyProgress.get.mockResolvedValue({
      user_id: 'user-123',
      vocabulary_id: 'vocab-id',
      next_review_date: '2026-04-20T00:00:00.000Z',
      ease_factor: 2.5,
      interval: 3,
      repetitions: 2,
      first_learned_at: '2026-04-17T00:00:00.000Z',
      total_reviews: 2,
      correct_count: 2,
    });

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.alreadyInSRS).toBe(true);
    expect(mockUserVocabularyProgress.initializeProgress).not.toHaveBeenCalled();
  });

  test('returns 400 when request body is invalid', async () => {
    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ japanese_word: '食べる' }), // missing english_translation
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/vela-api
bun test test/routes/vocabulary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add `vocabulary.findByWord` and `vocabulary.create` to `apps/vela-api/src/dynamodb.ts`**

Add these two methods to the `vocabulary` object (after `getRandom`):

```typescript
  /**
   * Find a vocabulary item by its Japanese word (full scan with filter).
   * Returns the first matching item, or undefined if not found.
   */
  async findByWord(japaneseWord: string): Promise<Record<string, unknown> | undefined> {
    try {
      const command = new ScanCommand({
        TableName: TABLE_NAMES.VOCABULARY,
        FilterExpression: 'japanese_word = :word',
        ExpressionAttributeValues: { ':word': japaneseWord },
        Limit: 1,
      });
      const response = await docClient.send(command);
      return response.Items?.[0] as Record<string, unknown> | undefined;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  /**
   * Create a new vocabulary entry.
   */
  async create(item: {
    id: string;
    japanese_word: string;
    hiragana?: string;
    english_translation: string;
    example_sentence_jp?: string;
    jlpt_level?: number;
    created_at: string;
  }): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAMES.VOCABULARY,
        Item: item,
      });
      await docClient.send(command);
    } catch (error) {
      handleDynamoError(error);
    }
  },
```

- [ ] **Step 4: Implement `apps/vela-api/src/routes/vocabulary.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { vocabulary, userVocabularyProgress } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const fromWordSchema = z.object({
  japanese_word: z.string().min(1),
  reading: z.string(),
  english_translation: z.string().min(1),
  example_sentence_jp: z.string().optional(),
  source_url: z.string().optional(),
  jlpt_level: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
});

app.post('/from-word', zValidator('json', fromWordSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = c.req.valid('json');

  // Check if word already exists in the shared vocabulary table
  const existing = await vocabulary.findByWord(body.japanese_word);

  let vocabularyId: string;
  let created: boolean;

  if (existing) {
    vocabularyId = existing.id as string;
    created = false;
  } else {
    vocabularyId = crypto.randomUUID();
    await vocabulary.create({
      id: vocabularyId,
      japanese_word: body.japanese_word,
      hiragana: body.reading,
      english_translation: body.english_translation,
      example_sentence_jp: body.example_sentence_jp,
      jlpt_level: body.jlpt_level,
      created_at: new Date().toISOString(),
    });
    created = true;
  }

  // Check if this user already has SRS progress for this word
  const existingProgress = await userVocabularyProgress.get(userId, vocabularyId);
  const alreadyInSRS = !!existingProgress;

  if (!alreadyInSRS) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await userVocabularyProgress.initializeProgress(userId, vocabularyId, tomorrow.toISOString());
  }

  return c.json({ vocabulary_id: vocabularyId, created, alreadyInSRS });
});

export default app;
```

- [ ] **Step 5: Register the route in `apps/vela-api/src/index.ts`**

Add the import:

```typescript
import vocabularyRouter from './routes/vocabulary';
```

Add the route mount after the `dictionaryRouter` line:

```typescript
// Mount the vocabulary routes (flashcard creation)
app.route('/api/vocabulary', vocabularyRouter);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/vela-api
bun test test/routes/vocabulary.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-api/src/dynamodb.ts \
        apps/vela-api/src/routes/vocabulary.ts \
        apps/vela-api/test/routes/vocabulary.test.ts \
        apps/vela-api/src/index.ts
git commit -m "feat(vela-api): add POST /vocabulary/from-word flashcard creation endpoint"
```

---

## Task 4: Word Highlighting, Difficulty Badge, Popover (`apps/vela`)

**Files:**

- Modify: `apps/vela/src/utils/japanese.ts`
- Modify: `apps/vela/src/utils/japanese.test.ts`
- Create: `apps/vela/src/services/vocabularyService.ts`
- Create: `apps/vela/src/services/vocabularyService.test.ts`
- Modify: `apps/vela/src/pages/dictionary/MyDictionariesPage.vue`
- Modify: `apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts`

- [ ] **Step 1: Write failing tests for `computeDifficulty`**

Add these tests to the bottom of `apps/vela/src/utils/japanese.test.ts`:

```typescript
import { computeDifficulty } from './japanese';
import type { Token } from '@vela/common';

describe('computeDifficulty', () => {
  const makeToken = (pos: string, surface: string): Token => ({
    surface_form: surface,
    reading: surface,
    dictionary_form: surface,
    pos,
    pos_detail_1: '一般',
  });

  it('returns N5 when no kanji content words', () => {
    const tokens = [makeToken('名詞', 'これ'), makeToken('助詞', 'は')];
    expect(computeDifficulty(tokens)).toBe('N5');
  });

  it('returns — when there are no content words', () => {
    const tokens = [makeToken('助詞', 'は'), makeToken('記号', '。')];
    expect(computeDifficulty(tokens)).toBe('—');
  });

  it('returns N4 for 1 kanji content word', () => {
    const tokens = [makeToken('名詞', '猫')];
    expect(computeDifficulty(tokens)).toBe('N4');
  });

  it('returns N4 for 2 kanji content words', () => {
    const tokens = [makeToken('名詞', '猫'), makeToken('動詞', '食べる')];
    expect(computeDifficulty(tokens)).toBe('N4');
  });

  it('returns N3 for 3 kanji content words', () => {
    const tokens = [
      makeToken('名詞', '猫'),
      makeToken('動詞', '食べる'),
      makeToken('名詞', '学校'),
    ];
    expect(computeDifficulty(tokens)).toBe('N3');
  });

  it('returns N2 for 5 kanji content words', () => {
    const tokens = Array.from({ length: 5 }, (_, i) => makeToken('名詞', `漢字${i}`));
    expect(computeDifficulty(tokens)).toBe('N2');
  });

  it('returns N1 for 8+ kanji content words', () => {
    const tokens = Array.from({ length: 8 }, (_, i) => makeToken('名詞', `漢字${i}`));
    expect(computeDifficulty(tokens)).toBe('N1');
  });

  it('only counts 名詞/動詞/形容詞, ignores particles and punctuation', () => {
    const tokens = [
      makeToken('名詞', '日本'), // kanji content word — counts
      makeToken('助詞', 'の'), // particle — does NOT count
      makeToken('動詞', '行く'), // content word but no kanji — does NOT count
      makeToken('記号', '。'), // punctuation — does NOT count
    ];
    // Only 1 kanji content word → N4
    expect(computeDifficulty(tokens)).toBe('N4');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/vela
bun run test:unit -- --reporter=verbose src/utils/japanese.test.ts
```

Expected: FAIL — `computeDifficulty` is not exported from `./japanese`.

- [ ] **Step 3: Implement `computeDifficulty` in `apps/vela/src/utils/japanese.ts`**

Add to the bottom of `apps/vela/src/utils/japanese.ts`:

```typescript
import type { Token } from '@vela/common';

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞']);
const KANJI_RE = /[\u4E00-\u9FAF]/;

/**
 * Compute a JLPT-style difficulty label from kuromoji tokens.
 * Counts kanji-containing content words (名詞/動詞/形容詞) and maps:
 *   0       → N5
 *   1–2     → N4
 *   3–4     → N3
 *   5–7     → N2
 *   8+      → N1
 * Returns "—" when the sentence has no content words at all.
 */
export function computeDifficulty(tokens: Token[]): string {
  const contentWords = tokens.filter((t) => CONTENT_POS.has(t.pos));
  if (contentWords.length === 0) return '—';

  const kanjiCount = contentWords.filter((t) => KANJI_RE.test(t.surface_form)).length;

  if (kanjiCount === 0) return 'N5';
  if (kanjiCount <= 2) return 'N4';
  if (kanjiCount <= 4) return 'N3';
  if (kanjiCount <= 7) return 'N2';
  return 'N1';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/vela
bun run test:unit -- src/utils/japanese.test.ts
```

Expected: PASS — all tests including new computeDifficulty tests pass.

- [ ] **Step 5: Write failing tests for `vocabularyService`**

Create `apps/vela/src/services/vocabularyService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock httpClient
vi.mock('src/utils/httpClient', () => ({
  httpJson: vi.fn(),
  httpJsonAuth: vi.fn(),
}));

vi.mock('src/config', () => ({
  config: { api: { url: 'http://localhost:9005/api/' } },
}));

// Mock aws-amplify (required by httpJsonAuth's getAuthHeaders)
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } },
  }),
}));

import { httpJson, httpJsonAuth } from 'src/utils/httpClient';
import {
  lookupWord,
  addFlashcard,
  clearLookupCache,
  type JishoResult,
  type AddFlashcardPayload,
} from './vocabularyService';

describe('lookupWord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLookupCache();
  });

  it('calls the dictionary API with the encoded word', async () => {
    const mockResult: JishoResult = {
      word: '猫',
      reading: 'ねこ',
      meanings: ['cat'],
      jlpt: 'jlpt-n5',
      common: true,
    };
    vi.mocked(httpJson).mockResolvedValue(mockResult);

    const result = await lookupWord('猫');

    expect(vi.mocked(httpJson)).toHaveBeenCalledWith(
      'http://localhost:9005/api/dictionary/lookup?word=%E7%8C%AB',
    );
    expect(result).toEqual(mockResult);
  });

  it('returns null on 404 (word not found)', async () => {
    vi.mocked(httpJson).mockRejectedValue(new Error('Not Found'));
    const result = await lookupWord('zzznotaword');
    expect(result).toBeNull();
  });

  it('caches the result so the API is only called once per word', async () => {
    vi.mocked(httpJson).mockResolvedValue({
      word: '猫',
      reading: 'ねこ',
      meanings: ['cat'],
      common: false,
    });

    await lookupWord('猫');
    await lookupWord('猫');

    expect(vi.mocked(httpJson)).toHaveBeenCalledTimes(1);
  });
});

describe('addFlashcard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the vocabulary API with the correct payload', async () => {
    vi.mocked(httpJsonAuth).mockResolvedValue({
      vocabulary_id: 'vocab-123',
      created: true,
      alreadyInSRS: false,
    });

    const payload: AddFlashcardPayload = {
      japanese_word: '猫',
      reading: 'ねこ',
      english_translation: 'cat',
      example_sentence_jp: '猫が好きです。',
    };

    const result = await addFlashcard(payload);

    expect(vi.mocked(httpJsonAuth)).toHaveBeenCalledWith(
      'http://localhost:9005/api/vocabulary/from-word',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    expect(result).toEqual({ vocabulary_id: 'vocab-123', created: true, alreadyInSRS: false });
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
cd apps/vela
bun run test:unit -- src/services/vocabularyService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `apps/vela/src/services/vocabularyService.ts`**

```typescript
import { config } from 'src/config';
import { httpJson, httpJsonAuth } from 'src/utils/httpClient';

export interface JishoResult {
  word: string;
  reading: string;
  meanings: string[];
  jlpt?: string;
  common: boolean;
}

export interface AddFlashcardPayload {
  japanese_word: string;
  reading: string;
  english_translation: string;
  example_sentence_jp?: string;
  source_url?: string;
  jlpt_level?: 1 | 2 | 3 | 4 | 5;
}

export interface AddFlashcardResult {
  vocabulary_id: string;
  created: boolean;
  alreadyInSRS: boolean;
}

// Session-level cache keyed by dictionary_form to avoid duplicate lookups
const lookupCache = new Map<string, JishoResult>();

/** Exported for tests only — clears the in-memory lookup cache. */
export function clearLookupCache(): void {
  lookupCache.clear();
}

/**
 * Look up a word via the Jisho proxy. Returns null if not found.
 * Results are cached for the lifetime of the page session.
 */
export async function lookupWord(dictionaryForm: string): Promise<JishoResult | null> {
  if (lookupCache.has(dictionaryForm)) {
    return lookupCache.get(dictionaryForm)!;
  }

  try {
    const encoded = encodeURIComponent(dictionaryForm);
    const result = await httpJson<JishoResult>(
      `${config.api.url}dictionary/lookup?word=${encoded}`,
    );
    lookupCache.set(dictionaryForm, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Add a word to the user's SRS flashcard deck.
 * Creates a new vocabulary entry if the word doesn't exist yet.
 */
export async function addFlashcard(payload: AddFlashcardPayload): Promise<AddFlashcardResult> {
  return httpJsonAuth<AddFlashcardResult>(`${config.api.url}vocabulary/from-word`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd apps/vela
bun run test:unit -- src/services/vocabularyService.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 9: Modify `MyDictionariesPage.vue`**

Replace the `<script setup lang="ts">` section with the following (keep the existing imports, add new ones):

In the `<script setup lang="ts">` block, add these imports:

```typescript
import { tokenize, type Token } from '@vela/common';
import { computeDifficulty } from 'src/utils/japanese';
import { lookupWord, addFlashcard, type JishoResult } from 'src/services/vocabularyService';
```

Add these reactive state variables (after the existing `streamingText` ref):

```typescript
// Tokenization state — map from sentence_id to token array
const tokenMap = ref(new Map<string, Token[]>());

// Popover state (single shared popover for all token spans)
const popoverOpen = ref(false);
const popoverTarget = ref<HTMLElement | null>(null);
const activeToken = ref<{ token: Token; sentenceId: string } | null>(null);
const popoverLookup = ref<JishoResult | null | 'loading' | 'notfound'>('notfound');
const flashcardState = ref<'idle' | 'loading' | 'added' | 'exists' | 'error'>('idle');
```

Add a computed for the flashcard button label:

```typescript
const flashcardBtnLabel = computed(() => {
  switch (flashcardState.value) {
    case 'added':
      return 'Added!';
    case 'exists':
      return 'Already in your deck';
    case 'loading':
      return '';
    default:
      return 'Add to flashcards';
  }
});
```

Add a helper to check if a token is a content word:

```typescript
const CONTENT_POS = new Set(['名詞', '動詞', '形容詞']);

function isContentWord(token: Token): boolean {
  return CONTENT_POS.has(token.pos);
}
```

Update `loadEntries` to tokenize sentences after loading:

```typescript
async function loadEntries() {
  loading.value = true;
  error.value = '';

  try {
    entries.value = await getMyDictionaries();

    // Tokenize all sentences in parallel (fire-and-forget — UI degrades gracefully)
    const newMap = new Map<string, Token[]>();
    await Promise.all(
      entries.value.map(async (item) => {
        try {
          const tokens = await tokenize(item.sentence);
          newMap.set(item.sentence_id, tokens);
        } catch {
          // Tokenization failure is non-fatal — entry renders as plain text
        }
      }),
    );
    tokenMap.value = newMap;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dictionary entries';
  } finally {
    loading.value = false;
  }
}
```

Add token click and flashcard handlers:

```typescript
async function handleTokenClick(sentenceId: string, token: Token, event: MouseEvent) {
  popoverTarget.value = event.currentTarget as HTMLElement;
  activeToken.value = { token, sentenceId };
  popoverLookup.value = 'loading';
  flashcardState.value = 'idle';
  popoverOpen.value = true;

  const result = await lookupWord(token.dictionary_form);
  popoverLookup.value = result ?? 'notfound';
}

async function handleAddFlashcard() {
  if (!activeToken.value || typeof popoverLookup.value !== 'object' || popoverLookup.value === null)
    return;

  const lookup = popoverLookup.value as JishoResult;
  const entry = entries.value.find((e) => e.sentence_id === activeToken.value!.sentenceId);

  flashcardState.value = 'loading';
  try {
    const result = await addFlashcard({
      japanese_word: activeToken.value.token.dictionary_form,
      reading: lookup.reading,
      english_translation: lookup.meanings[0] ?? '',
      example_sentence_jp: entry?.sentence,
      source_url: entry?.source_url,
      jlpt_level: lookup.jlpt
        ? (parseInt(lookup.jlpt.replace('jlpt-n', ''), 10) as 1 | 2 | 3 | 4 | 5)
        : undefined,
    });
    flashcardState.value = result.alreadyInSRS ? 'exists' : 'added';
  } catch {
    flashcardState.value = 'error';
    $q.notify({ type: 'negative', message: 'Failed to add flashcard', position: 'top' });
  }
}
```

Update the template entry card section (replace the `<div class="col entry-text">{{ item.sentence }}</div>` line and add difficulty badge and popover):

```html
<!-- Entries List -->
<div v-else class="entries-grid">
  <q-card v-for="item in entries" :key="item.sentence_id" flat bordered class="entry-card">
    <q-card-section>
      <div class="row items-start q-mb-sm">
        <!-- Tokenized sentence text -->
        <div class="col entry-text">
          <template
            v-if="tokenMap.has(item.sentence_id)"
            v-for="token in tokenMap.get(item.sentence_id)"
            :key="token.surface_form + token.pos + token.pos_detail_1"
          >
            <span
              v-if="isContentWord(token)"
              class="clickable-token"
              @click="(e) => handleTokenClick(item.sentence_id, token, e)"
              >{{ token.surface_form }}</span
            >
            <span v-else>{{ token.surface_form }}</span>
          </template>
          <span v-else>{{ item.sentence }}</span>
        </div>

        <!-- Difficulty badge -->
        <q-badge
          v-if="tokenMap.has(item.sentence_id)"
          :color="difficultyColor(computeDifficulty(tokenMap.get(item.sentence_id)!))"
          class="q-ml-sm"
          :label="computeDifficulty(tokenMap.get(item.sentence_id)!)"
          data-testid="difficulty-badge"
        />

        <q-btn
          flat
          round
          dense
          icon="volume_up"
          color="primary"
          size="sm"
          class="q-ml-sm"
          @click="handlePronounce(item)"
          data-testid="btn-pronounce-sentence"
        >
          <q-tooltip>Pronunciation</q-tooltip>
        </q-btn>
      </div>

      <!-- ... existing meta/url/date sections unchanged ... -->
    </q-card-section>
    <!-- ... existing q-card-actions unchanged ... -->
  </q-card>
</div>

<!-- Definition popover (single shared instance) -->
<q-menu
  v-model="popoverOpen"
  :target="popoverTarget ?? undefined"
  anchor="bottom left"
  self="top left"
  :offset="[0, 4]"
>
  <q-card style="min-width: 240px; max-width: 320px" class="q-pa-sm">
    <q-card-section v-if="popoverLookup === 'loading'" class="text-center q-py-md">
      <q-spinner color="primary" size="1.5em" />
    </q-card-section>

    <q-card-section v-else-if="popoverLookup === 'notfound'">
      <div class="text-grey-7 text-sm">No definition found</div>
    </q-card-section>

    <q-card-section v-else>
      <div class="row items-baseline q-mb-xs">
        <span class="text-h6 q-mr-sm">{{ (popoverLookup as JishoResult).word }}</span>
        <span class="text-grey-7 text-caption">{{ (popoverLookup as JishoResult).reading }}</span>
      </div>
      <q-badge
        v-if="(popoverLookup as JishoResult).jlpt"
        color="primary"
        class="q-mb-sm"
        :label="(popoverLookup as JishoResult).jlpt!.toUpperCase()"
      />
      <ol class="q-mt-xs q-pl-md q-mb-sm">
        <li
          v-for="meaning in (popoverLookup as JishoResult).meanings"
          :key="meaning"
          class="text-sm"
        >
          {{ meaning }}
        </li>
      </ol>
      <q-btn
        dense
        flat
        color="primary"
        icon="add"
        :label="flashcardBtnLabel"
        :loading="flashcardState === 'loading'"
        :disable="flashcardState === 'added' || flashcardState === 'exists'"
        size="sm"
        @click="handleAddFlashcard"
        data-testid="btn-add-flashcard"
      />
    </q-card-section>
  </q-card>
</q-menu>
```

Add the `difficultyColor` helper in the script:

```typescript
function difficultyColor(level: string): string {
  const map: Record<string, string> = {
    N5: 'green',
    N4: 'teal',
    N3: 'blue',
    N2: 'orange',
    N1: 'red',
    '—': 'grey',
  };
  return map[level] ?? 'grey';
}
```

Add the `.clickable-token` style in the `<style scoped>` block:

```css
.clickable-token {
  cursor: pointer;
  border-bottom: 1px dotted var(--q-primary, #1976d2);
  transition: background-color 0.15s;
}

.clickable-token:hover {
  background-color: rgba(25, 118, 210, 0.1);
  border-radius: 2px;
}
```

- [ ] **Step 10: Update `MyDictionariesPage.test.ts` for tokenization**

Add these tests to `apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts` (after the existing imports and mock setup, add new mocks and tests):

At the top of the file, add these mocks (alongside the existing vi.mock calls):

```typescript
import type { Token } from '@vela/common';

vi.mock('@vela/common', () => ({
  tokenize: vi.fn().mockResolvedValue([
    {
      surface_form: '日本語',
      reading: 'ニホンゴ',
      dictionary_form: '日本語',
      pos: '名詞',
      pos_detail_1: '一般',
    },
    {
      surface_form: 'を',
      reading: 'ヲ',
      dictionary_form: 'を',
      pos: '助詞',
      pos_detail_1: '格助詞',
    },
    {
      surface_form: '勉強',
      reading: 'ベンキョウ',
      dictionary_form: '勉強',
      pos: '名詞',
      pos_detail_1: 'サ変接続',
    },
  ] as Token[]),
  configureDicPath: vi.fn(),
}));

vi.mock('src/services/vocabularyService', () => ({
  lookupWord: vi.fn().mockResolvedValue(null),
  addFlashcard: vi.fn(),
  clearLookupCache: vi.fn(),
}));
```

Add a test for tokenization rendering:

```typescript
describe('word highlighting', () => {
  it('renders clickable spans for content word tokens after load', async () => {
    vi.mocked(getMyDictionaries).mockResolvedValue([mockEntry]);

    wrapper = mount(MyDictionariesPage, { global: { plugins: [router, createPinia(), Quasar] } });
    await flushPromises();

    const clickableTokens = wrapper.findAll('.clickable-token');
    expect(clickableTokens.length).toBeGreaterThan(0);
  });

  it('renders difficulty badge when tokenization completes', async () => {
    vi.mocked(getMyDictionaries).mockResolvedValue([mockEntry]);

    wrapper = mount(MyDictionariesPage, { global: { plugins: [router, createPinia(), Quasar] } });
    await flushPromises();

    expect(wrapper.find('[data-testid="difficulty-badge"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 11: Run the tests**

```bash
cd apps/vela
bun run test:unit -- src/pages/dictionary/MyDictionariesPage.test.ts
bun run test:unit -- src/utils/japanese.test.ts
bun run test:unit -- src/services/vocabularyService.test.ts
```

Expected: All PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/vela/src/utils/japanese.ts \
        apps/vela/src/utils/japanese.test.ts \
        apps/vela/src/services/vocabularyService.ts \
        apps/vela/src/services/vocabularyService.test.ts \
        apps/vela/src/pages/dictionary/MyDictionariesPage.vue \
        apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts
git commit -m "feat(vela): add word highlighting, difficulty badge, and definition popover to MyDictionariesPage"
```

---

## Task 5: Batch Import Overlay (Content Script)

**Files:**

- Modify: `apps/vela-ext/entrypoints/content.ts`
- Create: `apps/vela-ext/entrypoints/content.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/vela-ext/entrypoints/content.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the pure functions we'll export for testing
import { scanJapaneseSentences } from './content';

describe('scanJapaneseSentences', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects Japanese text nodes matching the regex', () => {
    document.body.innerHTML = `
      <p>日本語を勉強しています。</p>
      <p>Hello world</p>
      <p>東京は大きな都市です。</p>
    `;

    const result = scanJapaneseSentences();
    expect(result).toContain('日本語を勉強しています。');
    expect(result).toContain('東京は大きな都市です。');
    expect(result).not.toContain('Hello world');
  });

  it('deduplicates repeated sentences', () => {
    document.body.innerHTML = `
      <p>日本語を勉強しています。</p>
      <p>日本語を勉強しています。</p>
    `;

    const result = scanJapaneseSentences();
    expect(result.filter((s) => s === '日本語を勉強しています。')).toHaveLength(1);
  });

  it('filters out sentences shorter than 5 characters', () => {
    document.body.innerHTML = `<p>あ</p><p>日本語を学んでいます。</p>`;

    const result = scanJapaneseSentences();
    expect(result).not.toContain('あ');
    expect(result).toContain('日本語を学んでいます。');
  });

  it('filters out sentences longer than 200 characters', () => {
    const longText = 'あ'.repeat(201);
    document.body.innerHTML = `<p>${longText}</p><p>正常な長さのテキストです。</p>`;

    const result = scanJapaneseSentences();
    expect(result).not.toContain(longText);
    expect(result).toContain('正常な長さのテキストです。');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/vela-ext
bun run test:unit -- entrypoints/content.test.ts
```

Expected: FAIL — `scanJapaneseSentences` is not exported.

- [ ] **Step 3: Implement `apps/vela-ext/entrypoints/content.ts`**

```typescript
// Export for unit testing
export function scanJapaneseSentences(): string[] {
  const japaneseRe = /[\u3040-\u9FAF]/;
  const seen = new Set<string>();
  const result: string[] = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').trim();
    if (text.length >= 5 && text.length <= 200 && japaneseRe.test(text) && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }

  return result;
}

function buildOverlay(sentences: string[]): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'vela-ext-overlay-host';
  host.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const checked = new Set<number>(sentences.map((_, i) => i));

  const style = document.createElement('style');
  style.textContent = `
    .vela-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 16px;
      min-width: 340px;
      max-width: 480px;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      pointer-events: all;
      font-family: system-ui, sans-serif;
      color: #1a1a1a;
    }
    .vela-header { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
    .vela-list { overflow-y: auto; flex: 1; margin-bottom: 12px; }
    .vela-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
    .vela-item input { margin-top: 3px; cursor: pointer; }
    .vela-item label { font-size: 14px; line-height: 1.4; cursor: pointer; }
    .vela-footer { display: flex; gap: 8px; justify-content: flex-end; }
    .vela-btn-save { background: #1976d2; color: #fff; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-size: 13px; }
    .vela-btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
    .vela-btn-close { background: #f5f5f5; color: #333; border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 13px; }
    .vela-done { text-align: center; padding: 24px; font-size: 14px; color: #555; }
  `;

  const overlay = document.createElement('div');
  overlay.className = 'vela-overlay';

  const header = document.createElement('div');
  header.className = 'vela-header';
  header.textContent = `Found ${sentences.length} Japanese sentence${sentences.length !== 1 ? 's' : ''}`;
  overlay.appendChild(header);

  const list = document.createElement('div');
  list.className = 'vela-list';

  sentences.forEach((sentence, i) => {
    const item = document.createElement('div');
    item.className = 'vela-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `vela-sent-${i}`;
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        checked.add(i);
      } else {
        checked.delete(i);
      }
      saveBtn.textContent = `Save selected (${checked.size})`;
      saveBtn.disabled = checked.size === 0;
    });

    const label = document.createElement('label');
    label.htmlFor = `vela-sent-${i}`;
    label.textContent = sentence;

    item.appendChild(checkbox);
    item.appendChild(label);
    list.appendChild(item);
  });

  const footer = document.createElement('div');
  footer.className = 'vela-footer';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'vela-btn-save';
  saveBtn.textContent = `Save selected (${sentences.length})`;
  saveBtn.addEventListener('click', () => {
    const selected = sentences.filter((_, i) => checked.has(i));
    browser.runtime.sendMessage({
      type: 'SAVE_SENTENCES',
      sentences: selected,
      sourceUrl: window.location.href,
      context: document.title,
    });

    overlay.innerHTML = '';
    const done = document.createElement('div');
    done.className = 'vela-done';
    done.textContent = `Saved ${selected.length} sentence${selected.length !== 1 ? 's' : ''}`;
    overlay.appendChild(done);

    setTimeout(() => host.remove(), 2000);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'vela-btn-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => host.remove());

  footer.appendChild(saveBtn);
  footer.appendChild(closeBtn);
  overlay.appendChild(list);
  overlay.appendChild(footer);

  shadow.appendChild(style);
  shadow.appendChild(overlay);
  return shadow;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message: any) => {
      if (message.type !== 'SCAN_PAGE') return;

      // Remove any existing overlay before creating a new one
      document.getElementById('vela-ext-overlay-host')?.remove();

      const sentences = scanJapaneseSentences();
      if (sentences.length === 0) {
        browser.notifications?.create?.({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — No sentences found',
          message: 'No Japanese sentences were detected on this page.',
        });
        return;
      }

      buildOverlay(sentences);
    });
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/vela-ext
bun run test:unit -- entrypoints/content.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vela-ext/entrypoints/content.ts \
        apps/vela-ext/entrypoints/content.test.ts
git commit -m "feat(vela-ext): add batch import overlay via Shadow DOM content script"
```

---

## Task 6: Offline Queue + Scan Context Menu (Background Script)

**Files:**

- Modify: `apps/vela-ext/entrypoints/background.ts`
- Modify: `apps/vela-ext/entrypoints/popup/DashboardPage.vue`

- [ ] **Step 1: Write the failing tests for background script additions**

Add a new test file `apps/vela-ext/entrypoints/background.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser global
const mockNotificationsCreate = vi.fn();
const mockTabsSendMessage = vi.fn();
const mockRuntimeGetURL = vi.fn((p: string) => `chrome-extension://abc123${p}`);

global.browser = {
  runtime: {
    id: 'test-ext-id',
    onInstalled: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getURL: mockRuntimeGetURL,
    sendMessage: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
  notifications: {
    create: mockNotificationsCreate,
  },
  tabs: {
    sendMessage: mockTabsSendMessage,
  },
  windows: {
    onFocusChanged: { addListener: vi.fn() },
  },
  storage: { local: { get: vi.fn(), set: vi.fn() } },
} as any;

// Minimal IndexedDB mock using a Map
class MockIDBObjectStore {
  private data = new Map<number, any>();
  private nextKey = 1;

  add(value: any) {
    const key = this.nextKey++;
    const item = { ...value, id: key };
    this.data.set(key, item);
    return { onsuccess: null, result: key };
  }

  getAll() {
    const result = Array.from(this.data.values());
    const req: any = {};
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess({ target: { result } });
    }, 0);
    return req;
  }

  delete(key: number) {
    this.data.delete(key);
    return { onsuccess: null };
  }
}

// Import the pure utility functions from background (once implemented)
import { buildPendingSentenceRecord } from './background';

describe('buildPendingSentenceRecord', () => {
  it('creates a record with retries: 0 and a timestamp', () => {
    const record = buildPendingSentenceRecord('テスト文', 'https://example.com', 'Example Page');
    expect(record.sentence).toBe('テスト文');
    expect(record.sourceUrl).toBe('https://example.com');
    expect(record.context).toBe('Example Page');
    expect(record.retries).toBe(0);
    expect(typeof record.timestamp).toBe('number');
  });

  it('allows missing sourceUrl and context', () => {
    const record = buildPendingSentenceRecord('テスト');
    expect(record.sourceUrl).toBeUndefined();
    expect(record.context).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/vela-ext
bun run test:unit -- entrypoints/background.test.ts
```

Expected: FAIL — `buildPendingSentenceRecord` is not exported.

- [ ] **Step 3: Rewrite `apps/vela-ext/entrypoints/background.ts`**

```typescript
import { getValidIdToken, refreshIdToken } from './utils/storage';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

// ── IndexedDB queue ──────────────────────────────────────────────────────────

const DB_NAME = 'vela-offline-queue';
const STORE_NAME = 'vela-pending-sentences';
const DB_VERSION = 1;

export interface PendingSentenceRecord {
  id?: number;
  sentence: string;
  sourceUrl?: string;
  context?: string;
  timestamp: number;
  retries: number;
}

/** Pure factory — exported for unit tests. */
export function buildPendingSentenceRecord(
  sentence: string,
  sourceUrl?: string,
  context?: string,
): Omit<PendingSentenceRecord, 'id'> {
  return { sentence, sourceUrl, context, timestamp: Date.now(), retries: 0 };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { autoIncrement: true, keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(record: Omit<PendingSentenceRecord, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllPending(): Promise<PendingSentenceRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as PendingSentenceRecord[]);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function incrementRetry(record: PendingSentenceRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const updated = { ...record, retries: record.retries + 1 };
    const req = store.put(updated);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── API save (offline-aware) ─────────────────────────────────────────────────

async function saveSentenceToAPI(
  sentence: string,
  sourceUrl?: string,
  context?: string,
): Promise<void> {
  let idToken: string;
  try {
    idToken = await getValidIdToken();
  } catch {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
    return;
  }

  let response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ sentence, sourceUrl, context }),
  });

  if (response.status === 401) {
    try {
      idToken = await refreshIdToken();
    } catch {
      await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
      return;
    }
    response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ sentence, sourceUrl, context }),
    });
  }

  if (!response.ok) {
    await enqueue(buildPendingSentenceRecord(sentence, sourceUrl, context));
  }
}

// ── Flush queue ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

async function flushQueue(): Promise<void> {
  const pending = await getAllPending();
  if (pending.length === 0) return;

  for (const record of pending) {
    try {
      let idToken: string;
      try {
        idToken = await getValidIdToken();
      } catch {
        // Still not authenticated — skip this flush cycle
        return;
      }

      let response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          sentence: record.sentence,
          sourceUrl: record.sourceUrl,
          context: record.context,
        }),
      });

      if (response.status === 401) {
        try {
          idToken = await refreshIdToken();
        } catch {
          return;
        }
        response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            sentence: record.sentence,
            sourceUrl: record.sourceUrl,
            context: record.context,
          }),
        });
      }

      if (response.ok) {
        await deletePending(record.id!);
      } else if (record.retries >= MAX_RETRIES - 1) {
        await deletePending(record.id!);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela — Sync failed',
          message: '1 saved sentence could not be synced and was discarded.',
        });
      } else {
        await incrementRetry(record);
      }
    } catch {
      if (record.retries >= MAX_RETRIES - 1) {
        await deletePending(record.id!);
      } else {
        await incrementRetry(record);
      }
    }
  }
}

// ── Extension entry point ────────────────────────────────────────────────────

export default defineBackground(() => {
  console.log('Vela extension background script loaded', { id: browser.runtime.id });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-vela',
      title: 'Save to My Dictionaries',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: 'scan-page-vela',
      title: 'Scan page for Japanese',
      contexts: ['page'],
    });
    console.log('Context menus created');
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'scan-page-vela' && tab?.id) {
      browser.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' });
      return;
    }

    if (info.menuItemId === 'save-to-vela' && info.selectionText) {
      const selectedText = info.selectionText.trim();
      if (!selectedText) return;

      try {
        await saveSentenceToAPI(selectedText, tab?.url, tab?.title);
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Entry Saved',
          message: `Saved: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`,
        });
      } catch (error) {
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Error',
          message: error instanceof Error ? error.message : 'Failed to save dictionary entry',
        });
      }
    }
  });

  // Handle batch save from content script
  browser.runtime.onMessage.addListener(async (message: any) => {
    if (message.type !== 'SAVE_SENTENCES') return;
    const { sentences, sourceUrl, context } = message as {
      sentences: string[];
      sourceUrl: string;
      context: string;
    };
    await Promise.all(sentences.map((sentence) => saveSentenceToAPI(sentence, sourceUrl, context)));
  });

  // Flush on startup and when browser regains focus
  browser.runtime.onStartup.addListener(() => flushQueue());
  browser.windows.onFocusChanged.addListener(() => flushQueue());
  self.addEventListener('online', () => flushQueue());
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/vela-ext
bun run test:unit -- entrypoints/background.test.ts
```

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Update `DashboardPage.vue` to show the pending queue badge**

In `apps/vela-ext/entrypoints/popup/DashboardPage.vue`, add a `pendingCount` ref and badge in the template.

In the `<script setup lang="ts">` block, add:

```typescript
import { getPendingQueueCount } from '../utils/pendingQueue';

const pendingCount = ref(0);
```

Update `onMounted` to load the count:

```typescript
onMounted(async () => {
  const email = await getUserEmail();
  if (email) {
    userEmail.value = email;
  }

  const savedTheme = await browser.storage.local.get('theme_preference');
  isDarkMode.value = savedTheme.theme_preference === 'dark';

  // Load pending queue count
  pendingCount.value = await getPendingQueueCount();

  await loadEntries();
});
```

In the `<template>`, add the badge next to the "Your Dictionary Entries" heading in the `.section-header`:

```html
<div class="section-header">
  <h3>
    Your Dictionary Entries
    <span
      v-if="pendingCount > 0"
      class="pending-badge"
      :title="`${pendingCount} sentence(s) waiting to sync`"
    >
      {{ pendingCount }}
    </span>
  </h3>
  <button @click="loadEntries" :disabled="loading" class="refresh-button">
    {{ loading ? 'Loading...' : 'Refresh' }}
  </button>
</div>
```

Add style in `<style scoped>`:

```css
.pending-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: #e55;
  color: #fff;
  border-radius: 10px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 600;
  min-width: 18px;
  height: 18px;
  margin-left: 6px;
  vertical-align: middle;
}
```

- [ ] **Step 6: Create `apps/vela-ext/entrypoints/utils/pendingQueue.ts`**

```typescript
const DB_NAME = 'vela-offline-queue';
const STORE_NAME = 'vela-pending-sentences';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { autoIncrement: true, keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingQueueCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
```

- [ ] **Step 7: Run full test suite for the extension**

```bash
cd apps/vela-ext
bun run test:unit
```

Expected: All PASS (background, content, DashboardPage, LoginPage tests).

- [ ] **Step 8: Commit**

```bash
git add apps/vela-ext/entrypoints/background.ts \
        apps/vela-ext/entrypoints/background.test.ts \
        apps/vela-ext/entrypoints/content.ts \
        apps/vela-ext/entrypoints/content.test.ts \
        apps/vela-ext/entrypoints/popup/DashboardPage.vue \
        apps/vela-ext/entrypoints/utils/pendingQueue.ts
git commit -m "feat(vela-ext): add IndexedDB offline queue, scan-page context menu, and pending badge"
```

---

## Self-Review

**Spec coverage check:**

| ID   | Story                                  | Covered by                                    |
| ---- | -------------------------------------- | --------------------------------------------- |
| SM-1 | Word highlighting on saved sentences   | Task 4 — token `<span>` rendering             |
| SM-2 | Tap word → dictionary definition       | Task 4 — popover + lookupWord                 |
| SM-3 | One-click flashcard from word          | Task 4 — handleAddFlashcard + Task 3 endpoint |
| SM-4 | Source sentence preserved on flashcard | Task 4 — example_sentence_jp in payload       |
| SM-5 | Source URL preserved                   | Pre-existing save flow (unchanged)            |
| SM-6 | Difficulty rating on saved sentences   | Task 4 — computeDifficulty badge              |
| SM-7 | Batch import from page                 | Task 5 — content script overlay               |
| SM-8 | Offline sync queue                     | Task 6 — IndexedDB queue in background.ts     |

**No placeholders found.**

**Type consistency:**

- `Token` defined in `packages/common/src/tokenizer.ts`, imported as `type Token` wherever used
- `JishoResult` defined in both `apps/vela-api/src/routes/dictionary.ts` (server) and `apps/vela/src/services/vocabularyService.ts` (client) — shapes match exactly
- `AddFlashcardPayload` / `AddFlashcardResult` in `vocabularyService.ts` match request/response of `POST /vocabulary/from-word`
- `PendingSentenceRecord` in `background.ts` matches the IndexedDB store schema

**buildPendingSentenceRecord** is exported for unit tests in Task 6 Step 1, and called internally in Task 6 Step 3 — names match.

**computeDifficulty** is added to `apps/vela/src/utils/japanese.ts` in Task 4 Step 3, tested in Task 4 Step 1, imported in `MyDictionariesPage.vue` in Task 4 Step 9 — names match.
