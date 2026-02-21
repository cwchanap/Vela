# Unit Test Coverage Improvement Design

**Date**: 2026-02-21
**Goal**: Reach 85% line coverage across vela-api and apps/vela
**Approach**: Priority-ordered by gap size (Option A)

## Current State

| Package                 | Line Coverage |
| ----------------------- | ------------- |
| apps/vela (frontend)    | 52.7%         |
| apps/vela-api (backend) | 56.4%         |

## Target Modules (in priority order)

### API (vela-api)

1. **`src/middleware/auth.ts`** — 7.8% → target 90%+
   - Test JWT verification success/failure paths
   - Test missing Authorization header
   - Test malformed/expired tokens
   - Mock `aws-jwt-verify` with `mock.module`

2. **`src/routes/srs.ts`** — 14.5% → target 85%+
   - Test all SRS CRUD endpoints via `app.request()`
   - GET due items, POST record review, GET stats, PUT upsert
   - Cover error branches (missing params, DynamoDB failures)

3. **`src/routes/profiles.ts`** — 51.6% → target 85%+
   - Test create profile, update profile edge cases
   - Test error branches (not found, validation failures)

4. **`src/validation.ts`** — 61.6% → target 90%+
   - Test Zod schema validation for all request shapes
   - Valid and invalid inputs for each schema

### Frontend (apps/vela)

5. **`src/stores/auth.ts`** — 24.7% → target 80%+
   - Test login/logout/session refresh flows
   - Mock AWS Amplify/Cognito
   - Test error handling (wrong password, network failure)

6. **`src/stores/games.ts`** — 55.7% → target 90%+
   - Test game state transitions (start, answer, complete)
   - Test scoring and level selection

7. **`src/composables/queries/`** — 0% → target 85%+
   - `useAuthQueries.ts`, `useGameQueries.ts`, `useMyDictionariesQueries.ts`, `useProgressQueries.ts`
   - Wrap with QueryClient + Pinia in test setup
   - Mock underlying service calls

8. **`src/utils/japanese.ts`** — 0% → target 100%
   - Pure functions: `isHiragana`, `isKatakana`, `isKanji`, `analyzeText`, `assessDifficulty`
   - No mocking needed

## Testing Conventions

- **API**: Bun test runner, `app.request()` for route tests, `mock.module()` for AWS SDK mocks
- **Frontend**: Vitest + `@vue/test-utils`, `QueryClient` wrapper, `createTestingPinia`
- Follow existing test file patterns (colocated `*.test.ts` for API utils/routes, same directory for frontend)

## Exclusions

- Page components (`*.vue` pages) — covered by Playwright E2E
- `src/dynamodb.ts` — integration layer, low ROI for unit tests
- `src/router/`, `src/stores/index.ts` — boilerplate/config
