# Test Coverage 95% Design

**Date**: 2026-05-24
**Scope**: All packages (apps/vela, apps/vela-api, apps/vela-ext, packages/common, packages/cdk)
**Target**: 95% line coverage (80% for CDK)
**Enforcement**: Configured thresholds, no CI gate

## Current Coverage

| Package         | Current Lines Coverage | Test Framework                           |
| --------------- | ---------------------- | ---------------------------------------- |
| apps/vela       | ~97%                   | Vitest (jsdom, v8 provider)              |
| apps/vela-api   | 96.48%                 | Bun test runner (built-in coverage)      |
| apps/vela-ext   | 82.48%                 | Vitest (happy-dom, v8 provider)          |
| packages/common | ~20%                   | Vitest (no coverage configured)          |
| packages/cdk    | ~30%                   | Bun test runner (no coverage configured) |

## Approach

Exclude type/enum/constant files from coverage, set per-package thresholds, write targeted tests for uncovered files.

## Coverage Exclusions

Files excluded from coverage calculation (no business logic):

| Pattern                            | Reason                 | Packages                 |
| ---------------------------------- | ---------------------- | ------------------------ |
| `**/*.d.ts`                        | Type declarations      | All                      |
| `**/types.ts`, `**/types/*.ts`     | Pure interfaces/types  | vela, vela-api, vela-ext |
| `**/constants.ts`                  | Static constant values | vela, common             |
| `**/models.ts`                     | Plain interfaces       | vela                     |
| `src/env.d.ts`                     | Vite env types         | vela                     |
| `entrypoints/popup/main.ts`        | App bootstrap (mount)  | vela-ext                 |
| `components/HelloWorld.vue`        | Trivial placeholder    | vela-ext                 |
| `tts/types.ts`                     | Pure interfaces        | vela-api                 |
| `services/llm/types.ts`            | Pure interfaces        | vela                     |
| `src/index.ts` (barrel re-exports) | No logic               | common                   |

Implementation: Add to `coverage.exclude` in each `vitest.config.ts` / `bunfig.toml`.

## Coverage Thresholds

| Package         | Target    | Config File                             |
| --------------- | --------- | --------------------------------------- |
| apps/vela       | 95% lines | `vitest.config.ts`                      |
| apps/vela-api   | 95% lines | `bunfig.toml` + post-test check script  |
| apps/vela-ext   | 95% lines | `vitest.config.ts`                      |
| packages/common | 95% lines | `vitest.config.ts` (add coverage block) |
| packages/cdk    | 80% lines | `bunfig.toml` (add coverage config)     |

## Gap Analysis (Priority Order)

### Priority 1: apps/vela-ext (82% → 95%)

| File                                    | Current | What to Test                                    |
| --------------------------------------- | ------- | ----------------------------------------------- |
| `entrypoints/utils/idb.ts`              | 0%      | IndexedDB CRUD operations for pending sentences |
| `entrypoints/utils/pendingQueue.ts`     | 0%      | Queue add/flush/retry logic                     |
| `entrypoints/utils/storage.ts`          | 55%     | Auth token management, settings getters/setters |
| `entrypoints/background.ts`             | 76%     | Message handler branches, offline queue flush   |
| `entrypoints/webapp-session.content.ts` | 77%     | Token extraction edge cases                     |

### Priority 2: apps/vela-api (96.48% → 95%)

| File                            | Current Lines | What to Test                                        |
| ------------------------------- | ------------- | --------------------------------------------------- |
| `src/dynamodb.ts`               | 90.75%        | Error paths in batch operations, conditional writes |
| `src/routes/my-dictionaries.ts` | 88.89%        | Error handling, pagination edge cases               |
| `src/routes/llm-chat.ts`        | 91.28%        | Stream error handling, abort scenarios              |
| `src/routes/profiles.ts`        | 91.54%        | Update validation, error paths                      |
| `src/routes/srs.ts`             | 93.92%        | Bulk update error paths, edge cases                 |
| `src/routes/tts.ts`             | 92.28%        | Provider fallback, cache miss paths                 |
| `src/routes/auth.ts`            | 93.18%        | Error edge cases                                    |
| `src/routes/vocabulary.ts`      | 94.37%        | Query parameter validation                          |
| `src/routes/chat-history.ts`    | 97.66%        | Error handling branches                             |
| `src/middleware/auth.ts`        | 95.45%        | Token expiry edge case                              |

### Priority 3: packages/common (~20% → 95%)

| File        | What to Test                                                          |
| ----------- | --------------------------------------------------------------------- |
| `config.ts` | `createQueryClient()` returns configured client with correct defaults |
| `keys.ts`   | Query key factories return correct tuple structures                   |

### Priority 4: packages/cdk (~30% → 80%)

| File             | What to Test                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| Remaining stacks | Snapshot tests for DatabaseStack, StorageStack, ApiStack, StaticWebStack |

### Priority 5: apps/vela (~97% → maintain 95%)

Minor branch gaps:

- `FlashcardReview.vue` (79%) — error states, loading edge cases
- `authService.ts` (96%) — minor error handling branches
- `httpClient.ts` (96%) — error interceptor branches

## Testing Patterns

Each new test follows existing package conventions:

| Package  | Pattern                | Mocking                                                        |
| -------- | ---------------------- | -------------------------------------------------------------- |
| vela     | Co-located `*.test.ts` | `vi.mock()` for services/API, `@vue/test-utils` for components |
| vela-api | `test/` directory      | `mockFetch` for AWS SDK, test via `app.request()`              |
| vela-ext | `tests/` directory     | WXT browser API mocks, `vi.mock()` for utils                   |
| common   | Co-located `*.test.ts` | Pure functions, minimal mocking                                |
| cdk      | `test/` directory      | CDK `Template.fromStack()` snapshot assertions                 |

No new test infrastructure needed.

## Estimated Effort

~25-30 new test cases across all packages. Largest work in vela-ext (5 files) and vela-api (10 files with small gaps).
