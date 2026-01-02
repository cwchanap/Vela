---
goal: Implement Spaced Repetition System (SRS) with SM-2 Algorithm and JLPT-Level Vocabulary Filtering
version: 1.1
date_created: 2024-12-30
last_updated: 2024-12-30
owner: Vela Development Team
status: 'In Progress'
tags: ['feature', 'learning', 'srs', 'jlpt', 'vocabulary', 'games']
---

# Introduction

![Status: In Progress](https://img.shields.io/badge/status-In%20Progress-yellow)

This plan implements two interconnected features for the Vela Japanese learning app:

1. **Spaced Repetition System (SRS)** - SM-2 algorithm implementation for optimized vocabulary review scheduling
2. **JLPT-Level Vocabulary Packs** - Filter and organize vocabulary by JLPT levels (N5-N1)

These features work together to enable personalized, efficient learning paths based on proven memory science and standardized Japanese proficiency levels.

## 1. Requirements & Constraints

### Functional Requirements

- **REQ-001**: Implement SM-2 spaced repetition algorithm with ease factor, interval, and repetition tracking
- **REQ-002**: Track per-user, per-vocabulary progress with next review date calculation
- **REQ-003**: Add jlpt_level field to vocabulary schema (N5=5, N4=4, N3=3, N2=2, N1=1)
- **REQ-004**: Filter vocabulary questions by JLPT level in games
- **REQ-005**: Prioritize due vocabulary items in game question selection
- **REQ-006**: Display SRS statistics (items due, mastery level) in progress dashboard
- **REQ-007**: Allow users to select target JLPT level in profile/settings

### Technical Constraints

- **CON-001**: Must use existing DynamoDB infrastructure (no SQL migration required)
- **CON-002**: Maintain backward compatibility with existing vocabulary without JLPT levels
- **CON-003**: SRS calculations must be efficient for real-time game performance
- **CON-004**: API must remain stateless; all SRS state stored in DynamoDB

### Security Requirements

- **SEC-001**: User progress data must be scoped to authenticated user only
- **SEC-002**: Bulk vocabulary import must validate data integrity

### Guidelines & Patterns

- **GUD-001**: Follow TDD approach - write tests before implementation
- **GUD-002**: Use Zod schemas for all new API request/response validation
- **GUD-003**: Use existing test patterns from gameService.test.ts and colocated API route tests in src/
- **PAT-001**: Follow existing DynamoDB operation patterns in dynamodb.ts
- **PAT-002**: Follow existing Hono route patterns in routes/ directory
- **PAT-003**: Use Vitest for unit tests, Playwright for E2E tests

## 2. Implementation Steps

### Implementation Phase 1: SRS Core Algorithm (Backend) ✅ COMPLETED

- GOAL-001: Implement SM-2 algorithm as a pure function module with comprehensive test coverage

| Task     | Description                                                                                                                                                                                                       | Completed | Date       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-001 | Create test file apps/vela-api/src/utils/srs.test.ts with SM-2 algorithm test cases covering: initial state, quality ratings 0-5, ease factor bounds (1.3 min), interval progression, and edge cases              | ✅        | 2024-12-30 |
| TASK-002 | Create apps/vela-api/src/utils/srs.ts implementing SM-2 algorithm with functions: calculateNextReview(quality, easeFactor, interval, repetitions) returning { easeFactor, interval, repetitions, nextReviewDate } | ✅        | 2024-12-30 |
| TASK-003 | Add tests for isDue(nextReviewDate: string) and calculateDueItems(items: SRSItem[]) helper functions                                                                                                              | ✅        | 2024-12-30 |
| TASK-004 | Implement isDue() and calculateDueItems() helper functions in srs.ts                                                                                                                                              | ✅        | 2024-12-30 |
| TASK-005 | Run tests with pnpm --filter vela-api test src/utils/srs.test.ts - all tests must pass                                                                                                                            | ✅        | 2024-12-30 |

### Implementation Phase 2: User Vocabulary Progress Table (Infrastructure + Backend) ✅ COMPLETED

- GOAL-002: Create DynamoDB table and operations for per-user vocabulary SRS progress

| Task     | Description                                                                                                                                                                      | Completed | Date       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-006 | Add test cases in apps/vela-api/src/routes/srs.test.ts for SRS route operations                                                                                                  | ✅        | 2024-12-30 |
| TASK-007 | Update packages/cdk/lib/database-stack.ts: Add vela-user-vocabulary-progress table with partition key user_id (String), sort key vocabulary_id (String), GSI NextReviewDateIndex | ✅        | 2024-12-30 |
| TASK-008 | Add table name to TABLE_NAMES in apps/vela-api/src/dynamodb.ts: USER_VOCABULARY_PROGRESS                                                                                         | ✅        | 2024-12-30 |
| TASK-009 | Implement userVocabularyProgress operations in dynamodb.ts with full schema                                                                                                      | ✅        | 2024-12-30 |
| TASK-010 | Run SRS tests - all 31 tests pass                                                                                                                                                | ✅        | 2024-12-30 |

### Implementation Phase 3: JLPT Level Support (Backend) ✅ COMPLETED

- GOAL-003: Add JLPT level filtering capability to vocabulary operations

| Task     | Description                                                                                                                        | Completed | Date       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-011 | Update apps/vela/src/types/database.ts with JLPTLevel type and jlpt_level field on Vocabulary and Sentence interfaces              | ✅        | 2024-12-30 |
| TASK-012 | Add getByJlptLevel() and getRandom(limit, jlptLevels?) methods to vocabulary and sentences operations in dynamodb.ts               | ✅        | 2024-12-30 |
| TASK-013 | Update VocabularyQuerySchema in apps/vela-api/src/routes/games.ts to accept optional jlpt query parameter (comma-separated levels) | ✅        | 2024-12-30 |
| TASK-014 | Update /games/vocabulary and /games/sentences route handlers to filter by JLPT level                                               | ✅        | 2024-12-30 |

### Implementation Phase 3.5: Legacy Vocabulary Data Migration (Pending)

- GOAL-003.5: Backfill jlpt_level for existing vocabulary items to ensure filtered queries return complete results

| Task        | Description                                                                                                                                                                                                                                                                                                   | Completed | Date |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-014.5  | Audit existing vocabulary data: Query vela-vocabulary table to count items with missing/null jlpt_level, identify patterns (e.g., by word length, character types, source), and generate report with sample items                                                                                             |           |      |
| TASK-014.6  | Choose backfill strategy: Evaluate options (manual tagging for high-frequency words, bulk import from JLPT-structured sources like Tatoeba/JMdict, heuristic mapping based on character complexity and frequency, or explicit NULL handling with fallback to "All" mode) and document decision with rationale |           |      |
| TASK-014.7  | Implement backfill script: Create apps/vela-api/scripts/backfill-jlpt-levels.ts with batch update logic, error handling, and progress logging. Include dry-run mode to preview changes before execution                                                                                                       |           |      |
| TASK-014.8  | Execute backfill: Run script in dry-run mode first, review output, then execute actual updates in batches (e.g., 100 items per batch) to avoid DynamoDB throttling. Monitor CloudWatch metrics for write capacity                                                                                             |           |      |
| TASK-014.9  | Validate migration: Run post-migration audit to verify jlpt_level coverage (target: >95% of vocabulary items tagged), sample random items for accuracy, test filtered queries return expected counts per JLPT level                                                                                           |           |      |
| TASK-014.10 | Document migration results: Record total items processed, items tagged per JLPT level, items remaining uncategorized, and any manual follow-up required. Update ASSUMPTION-001 in plan with actual migration outcome                                                                                          |           |      |

**Migration Constraints & Timeline:**

- **Owner**: Backend Developer (assign TBD)
- **Timeline Estimate**: 1-2 weeks depending on strategy and data volume
- **Completion Requirement**: Must complete before Phase 6 (Game Integration) deployment to ensure JLPT filtering works correctly in production
- **Fallback Behavior**: If migration is delayed, Phase 6 must implement graceful degradation: show warning when JLPT filter selected, default to "All" mode, exclude items with null jlpt_level from filtered queries (as documented in RISK-001 mitigation)
- **Validation Checks**:
  - Pre-migration: Count of items with null jlpt_level
  - Post-migration: Count of items tagged per level (N5-N1), percentage of total vocabulary covered
  - Query validation: `GET /api/games/vocabulary?jlpt_level=5` returns expected N5 count
  - Spot-check: Random sample of 50 items verified for correct JLPT assignment

**Backfill Strategy Options:**

1. **Manual Tagging**: High accuracy for common words, time-intensive for large datasets. Recommended for top 1000 most frequent words.
2. **Bulk Import from External Sources**: Use JLPT-structured datasets (JMdict, Tatoeba, WaniKani API) to map existing vocabulary to levels. Fast but requires data matching logic.
3. **Heuristic Mapping**: Algorithmic assignment based on character complexity (kanji count, joyo grade), word frequency, and difficulty metrics. Lower accuracy but scalable.
4. **Explicit NULL Handling**: Leave uncategorized items as null, exclude from filtered queries, allow users to review and tag manually via admin interface. Lowest effort but reduces feature effectiveness.

**Recommended Approach**: Hybrid strategy - bulk import for high-coverage mapping (target 80-90%), heuristic mapping for remaining items, manual review of edge cases. Document uncategorized items for future curation.

### Implementation Phase 4: SRS Progress API Routes (Backend) ✅ COMPLETED

- GOAL-004: Create API endpoints for SRS progress tracking and retrieval

| Task     | Description                                                                                                                                                   | Completed | Date       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| TASK-015 | Create apps/vela-api/src/routes/srs.ts with routes: GET /due, GET /stats, POST /review, GET /progress/:vocabId, DELETE /progress/:vocabId, POST /batch-review | ✅        | 2024-12-30 |
| TASK-016 | Create apps/vela-api/src/routes/srs.test.ts with comprehensive test coverage (9 tests)                                                                        | ✅        | 2024-12-30 |
| TASK-017 | Mount SRS routes in apps/vela-api/src/index.ts at /api/srs                                                                                                    | ✅        | 2024-12-30 |
| TASK-018 | Update packages/cdk/lib/api-stack.ts with table grants and environment variables                                                                              | ✅        | 2024-12-30 |

### Implementation Phase 5: Frontend Types & Services (Pending)

- GOAL-005: Create frontend services for SRS and JLPT features

| Task     | Description                                                                                                                                                                           | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-019 | Create test file apps/vela/src/services/srsService.test.ts with test cases for: getDueVocabulary(userId, limit, jlptLevel?), recordReview(userId, vocabId, quality), getStats(userId) |           |      |
| TASK-020 | Create apps/vela/src/services/srsService.ts implementing API calls to SRS endpoints                                                                                                   |           |      |
| TASK-021 | Update apps/vela/src/services/gameService.ts: Add jlptLevel parameter to getVocabularyQuestions(count, jlptLevel?)                                                                    |           |      |
| TASK-022 | Add tests to apps/vela/src/services/gameService.test.ts for JLPT level filtering                                                                                                      |           |      |
| TASK-023 | Run frontend service tests - all tests must pass                                                                                                                                      |           |      |

### Implementation Phase 6: Game Integration (Frontend)

- GOAL-006: Integrate SRS into vocabulary game flow with review recording

| Task     | Description                                                                                                                                                         | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-024 | Update apps/vela/src/stores/games.ts: Add jlptLevel: number or null to state, add setJlptLevel(level) action, add srsMode: boolean flag                             |           |      |
| TASK-025 | Create test file apps/vela/src/components/games/JlptLevelSelector.test.ts for JLPT level selection component                                                        |           |      |
| TASK-026 | Create apps/vela/src/components/games/JlptLevelSelector.vue - dropdown/buttons for selecting JLPT level (N5-N1 or All)                                              |           |      |
| TASK-027 | Update apps/vela/src/pages/games/VocabularyGamePage.vue: Add JLPT level selector before game start, pass level to getVocabularyQuestions()                          |           |      |
| TASK-028 | Update game completion flow in VocabularyGamePage.vue: After each answer, call srsService.recordReview() with quality based on correctness (correct=4, incorrect=1) |           |      |
| TASK-029 | Add Review Due mode button that fetches due vocabulary from /api/srs/due instead of random vocabulary                                                               |           |      |
| TASK-030 | Run component tests - all tests must pass                                                                                                                           |           |      |

### Implementation Phase 7: Progress Dashboard Integration (Frontend)

- GOAL-007: Display SRS statistics and due items in progress dashboard

| Task     | Description                                                                                                                                    | Completed | Date |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-031 | Update apps/vela/src/components/progress/ProgressDashboard.test.ts: Add tests for SRS stats display (due today, mastery levels, review streak) |           |      |
| TASK-032 | Create apps/vela/src/components/progress/SRSStatsCard.vue - displays due count, mastery breakdown chart, next review countdown                 |           |      |
| TASK-033 | Update apps/vela/src/pages/ProgressPage.vue: Fetch SRS stats via TanStack Query, display SRSStatsCard component                                |           |      |
| TASK-034 | Add Start Review quick action button that navigates to vocabulary game in SRS mode                                                             |           |      |
| TASK-035 | Run progress component tests - all tests must pass                                                                                             |           |      |

### Implementation Phase 8: Settings & Profile (Frontend)

- GOAL-008: Allow users to configure target JLPT level in settings

| Task     | Description                                                                                                        | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-036 | Update apps/vela-api/src/routes/profiles.ts: Add target_jlpt_level field to profile schema (1-5, default 5 for N5) |           |      |
| TASK-037 | Update apps/vela/src/pages/SettingsPage.vue: Add JLPT level target selector with explanation of levels             |           |      |
| TASK-038 | Update apps/vela/src/stores/auth.ts: Include target_jlpt_level in user profile type                                |           |      |
| TASK-039 | Default JLPT filter in games to user target level from profile                                                     |           |      |

### Implementation Phase 9: E2E Testing

- GOAL-009: Comprehensive end-to-end testing of SRS and JLPT features

| Task     | Description                                                                                                               | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-040 | Create apps/vela/e2e/srs.spec.ts: Test vocabulary game with JLPT selection, verify API calls include jlpt_level parameter |           |      |
| TASK-041 | Add E2E test: Complete vocabulary game, verify SRS review is recorded via API                                             |           |      |
| TASK-042 | Add E2E test: Check progress page displays SRS statistics correctly                                                       |           |      |
| TASK-043 | Add E2E test: Start Review Due mode from progress page, verify due vocabulary is loaded                                   |           |      |
| TASK-044 | Run full E2E test suite with pnpm --filter vela test - all tests must pass                                                |           |      |

### Implementation Phase 10: Documentation & Cleanup

- GOAL-010: Update documentation and deploy infrastructure changes

| Task     | Description                                                                                | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-045 | Update apps/vela-api/README.md: Document new SRS endpoints with request/response examples  |           |      |
| TASK-046 | Update AGENTS.md: Add SRS and JLPT features to database schema section                     |           |      |
| TASK-047 | Deploy CDK changes with pnpm --filter cdk cdk:deploy to create new DynamoDB table and GSIs |           |      |
| TASK-048 | Verify all unit tests pass: pnpm test from root                                            |           |      |
| TASK-049 | Verify all E2E tests pass: pnpm --filter vela test                                         |           |      |

## 3. Alternatives

- **ALT-001**: Use Leitner System instead of SM-2 - Rejected because SM-2 provides more granular ease factor adjustment and is industry standard for language learning apps (Anki, WaniKani)
- **ALT-002**: Store SRS state in frontend localStorage - Rejected because it would not sync across devices and violates data persistence requirements
- **ALT-003**: Use Aurora DSQL for SRS data - Rejected because DynamoDB is sufficient and avoids adding complexity during the DSQL migration planning phase
- **ALT-004**: Implement custom spaced repetition algorithm - Rejected because SM-2 is proven effective and well-documented

## 4. Dependencies

- **DEP-001**: AWS CDK for DynamoDB table creation (packages/cdk)
- **DEP-002**: Existing DynamoDB client and patterns (apps/vela-api/src/dynamodb.ts)
- **DEP-003**: Zod for validation schemas (@hono/zod-validator)
- **DEP-004**: Vitest for unit testing (vitest)
- **DEP-005**: Playwright for E2E testing (@playwright/test)
- **DEP-006**: TanStack Vue Query for frontend data fetching (@tanstack/vue-query)

## 5. Files

### New Files

- **FILE-001**: apps/vela-api/src/utils/srs.ts - SM-2 algorithm implementation
- **FILE-002**: apps/vela-api/src/utils/srs.test.ts - SM-2 algorithm tests
- **FILE-003**: apps/vela-api/src/routes/srs.ts - SRS API routes
- **FILE-004**: apps/vela-api/src/routes/srs.test.ts - SRS route tests
- **FILE-005**: apps/vela/src/services/srsService.ts - Frontend SRS service
- **FILE-006**: apps/vela/src/services/srsService.test.ts - Frontend SRS service tests
- **FILE-007**: apps/vela/src/components/games/JlptLevelSelector.vue - JLPT selection component
- **FILE-008**: apps/vela/src/components/games/JlptLevelSelector.test.ts - JLPT selector tests
- **FILE-009**: apps/vela/src/components/progress/SRSStatsCard.vue - SRS statistics display
- **FILE-010**: apps/vela/e2e/srs.spec.ts - E2E tests for SRS features

### Modified Files

- **FILE-011**: packages/cdk/lib/database-stack.ts - Add user-vocabulary-progress table, vocabulary GSI
- **FILE-012**: apps/vela-api/src/dynamodb.ts - Add userVocabularyProgress operations, vocabulary JLPT methods
- **FILE-013**: apps/vela-api/src/validation.ts - Add SRS Zod schemas
- **FILE-014**: apps/vela-api/src/index.ts - Mount SRS routes
- **FILE-015**: apps/vela-api/src/routes/games.ts - Add JLPT filter to vocabulary endpoint
- **FILE-016**: apps/vela-api/src/routes/profiles.ts - Add target_jlpt_level field
- **FILE-017**: apps/vela-api/src/routes/games.test.ts - Add JLPT filter tests
- **FILE-018**: apps/vela/src/types/database.ts - Add UserVocabularyProgress, update Vocabulary
- **FILE-019**: apps/vela/src/services/gameService.ts - Add JLPT level parameter
- **FILE-020**: apps/vela/src/services/gameService.test.ts - Add JLPT filter tests
- **FILE-021**: apps/vela/src/stores/games.ts - Add jlptLevel and srsMode state
- **FILE-022**: apps/vela/src/stores/auth.ts - Add target_jlpt_level to profile type
- **FILE-023**: apps/vela/src/pages/games/VocabularyGamePage.vue - Integrate JLPT selector and SRS recording
- **FILE-024**: apps/vela/src/pages/ProgressPage.vue - Add SRS stats display
- **FILE-025**: apps/vela/src/pages/SettingsPage.vue - Add JLPT target selector

## 6. Testing

### Unit Tests (Vitest)

- **TEST-001**: SM-2 algorithm calculates correct ease factor for quality 0-5
- **TEST-002**: SM-2 algorithm enforces minimum ease factor of 1.3
- **TEST-003**: SM-2 interval progression: 1 day -> 6 days -> (6 \* EF) days
- **TEST-004**: isDue() returns true for past dates, false for future dates
- **TEST-005**: calculateDueItems() filters and sorts items by due date
- **TEST-006**: userVocabularyProgress.get() retrieves correct item
- **TEST-007**: userVocabularyProgress.upsert() creates new or updates existing
- **TEST-008**: userVocabularyProgress.getDueItems() returns items where next_review_date <= now
- **TEST-009**: vocabulary.getByJlptLevel() returns only matching level items
- **TEST-010**: /api/srs/due returns due vocabulary sorted by overdue priority
- **TEST-011**: /api/srs/review updates progress with SM-2 calculation
- **TEST-012**: /api/srs/stats returns accurate mastery breakdown
- **TEST-013**: /api/games/vocabulary?jlpt_level=5 returns only N5 vocabulary
- **TEST-014**: Frontend srsService.recordReview() calls correct API endpoint
- **TEST-015**: JlptLevelSelector emits correct level on selection

### E2E Tests (Playwright)

- **TEST-016**: User can select JLPT level before starting vocabulary game
- **TEST-017**: Vocabulary game only shows words from selected JLPT level
- **TEST-018**: Completing vocabulary game records SRS progress for each word
- **TEST-019**: Progress page shows accurate count of due vocabulary
- **TEST-020**: Start Review button loads due vocabulary in game
- **TEST-021**: Settings page allows changing target JLPT level
- **TEST-022**: Default JLPT filter matches user target level from profile

## 7. Risks & Assumptions

### Risks

- **RISK-001**: GSI creation on existing vocabulary table may require backfill if existing data lacks jlpt_level - Mitigation: Treat null jlpt_level as uncategorized and exclude from filtered queries
- **RISK-002**: SM-2 quality rating may be too coarse (only correct/incorrect) - Mitigation: Start with binary quality (1=wrong, 4=correct), can enhance later with confidence levels
- **RISK-003**: High volume of SRS updates during gameplay may hit DynamoDB write limits - Mitigation: Batch updates at end of game session rather than per-question

### Assumptions

- **ASSUMPTION-001**: Existing vocabulary data can be retroactively tagged with JLPT levels (manual or via import)
- **ASSUMPTION-002**: Users understand JLPT level system (N5 easiest, N1 hardest)
- **ASSUMPTION-003**: SM-2 default parameters (EF=2.5, interval=1) are suitable for Japanese vocabulary
- **ASSUMPTION-004**: Frontend will have network connectivity for API calls during gameplay

## 8. Related Specifications / Further Reading

- [SM-2 Algorithm Original Paper](https://www.supermemo.com/en/archives1990-2015/english/ol/sm2)
- [JLPT Level Overview](https://www.jlpt.jp/e/about/levelsummary.html)
- [Anki SM-2 Implementation](https://docs.ankiweb.net/faqs.html#what-spaced-repetition-algorithm-does-anki-use)
- [DynamoDB GSI Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [specs/001-aurora-dsql-migration](specs/001-aurora-dsql-migration/) - Future database migration context
