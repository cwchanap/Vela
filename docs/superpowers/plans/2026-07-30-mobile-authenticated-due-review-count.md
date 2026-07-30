# Authenticated Mobile Due-Review Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the HPA-207 vertical slice in which a restored, authenticated iOS user reaches Home and sees the current `due_today` value from `GET /api/srs/stats`, with bounded latency, generation-safe authentication recovery, user-scoped cache isolation, and accessible loading/error/retry states.

**Architecture:** Keep `MobileAuthCoordinator` as the sole owner of Cognito token material. Add an authenticated feature-request operation that performs ordinary feature I/O outside the coordinator mutation queue, enters serialized auth work only for current-generation 401 recovery, and reports stable typed outcomes. Layer a mobile JSON client and SRS service over that boundary, manage server state with a mobile TanStack Query client keyed by user identity, and map query/auth state through pure selectors before rendering Home.

**Tech Stack:** TypeScript 5.6, Vue 3, Quasar 2, Capacitor 7, TanStack Vue Query 5.90.x, Vitest 3, Vue Test Utils, Bun 1.3.1, `@vela/common`.

## Global Constraints

- `$REPO_ROOT` is the repository root containing `apps/`, `packages/`, and `docs/`.
- Author this plan on `agent/hpa-207-due-review-count-design-draft`. Implement the runtime work in a fresh worktree/branch based on the latest `main` that contains PR #52, using branch `codex/hpa-207-mobile-due-review-count`.
- Treat `docs/superpowers/specs/2026-07-30-mobile-authenticated-due-review-count-design.md` as the accepted behavioral contract.
- Keep `apps/vela-mobile/src/services/mobile-auth.ts` as the only owner of active Cognito ID/access/refresh token material. Do not add `getIdToken()` or expose bearer headers outside the coordinator.
- `requestAuthenticatedApi()` must execute feature transport outside `serialize()` / `operationTail`. Only refresh, verification, and cleanup mutations enter the serialized auth queue.
- Return every non-401 HTTP response even when auth generation changed while the request was in flight. Generation checks guard only 401-driven auth mutation.
- A stale-generation 401 must never refresh, clean up, or otherwise mutate the replacement session.
- Concurrent current-generation 401s for one owner/generation share one recovery decision. Each feature request retries its own request at most once after verified promotion.
- Never infer refresh success from `queueRefresh(): Promise<void>` settlement. Derive `promoted`, recovery-owned `terminal`, `superseded`, or `retryable_failure` from explicit postconditions in that order.
- Keep the coordinator's physical fetch safety cap at `MOBILE_AUTH_NETWORK_TIMEOUT_MS` (15 seconds). Apply `MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS = 8_000` to one full due-count query execution, including one recovery wait, one feature retry, and JSON body consumption.
- TanStack automatic retries apply only to `MobileApiError('network')` and `MobileApiError('server')`, with `failureCount < 2`.
- Use `srsKeys.stats(userId, jlpt)` for user-specific stats. Do not change `srsKeys.due`, `progress`, or `allProgress` beyond adding the identity-scope warning required by the design.
- Add `@vela/common` source aliases to both mobile Quasar and Vitest configuration so per-app commands never consume stale `packages/common/dist`.
- Do not migrate the web SRS card to TanStack Query. The web service only imports/re-exports the shared contract.
- Do not add review-session navigation, due-card retrieval, offline persistence, connectivity plugins, polling, background tasks, Android support, or backend route changes.
- Do not log tokens, Authorization headers, request objects, raw auth/API payloads, path values rejected by the safety boundary, decoded claims, or native/plugin exceptions.
- Maintain the mobile package's configured 95% line-coverage threshold.
- Automated tests, typecheck, lint, production mobile build, and iOS Simulator flow are merge gates. Physical-development-iPhone evidence is an HPA-207 closure gate, not an implementation-PR merge gate.

---

## File Structure

### New files

- `packages/common/src/contracts/srs.ts` — shared `SRSStats` type and strict runtime parser.
- `packages/common/src/contracts/srs.test.ts` — parser acceptance/rejection matrix.
- `apps/vela-mobile/src/boot/query.ts` — mobile `QueryClient` singleton and `VueQueryPlugin` boot.
- `apps/vela-mobile/src/boot/query.test.ts` — singleton/plugin wiring tests.
- `apps/vela-mobile/src/auth/mobile-feature-session-status.ts` — auth-owned semantic selector for feature consumers.
- `apps/vela-mobile/src/auth/mobile-feature-session-status.test.ts` — selector state matrix.
- `apps/vela-mobile/src/services/mobile-api-client.ts` — bounded JSON client and feature-facing error normalization.
- `apps/vela-mobile/src/services/mobile-api-client.test.ts` — deadline, cancellation, raw rejection, HTTP, and body-read tests.
- `apps/vela-mobile/src/services/mobile-srs.ts` — `srs/stats` service over the mobile JSON client.
- `apps/vela-mobile/src/services/mobile-srs.test.ts` — exact path/signal/parser tests.
- `apps/vela-mobile/src/services/mobile-services.ts` — typed injection keys and direct service provisioning.
- `apps/vela-mobile/src/services/mobile-services.test.ts` — provider construction tests.
- `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts` — cancel/clear lifecycle tied to auth identity.
- `apps/vela-mobile/src/services/mobile-query-auth-isolation.test.ts` — cancellation, clear, retention, and identity tests.
- `apps/vela-mobile/src/composables/useDueReviewCount.ts` — due-count query, control-race retry, recovery refetch, and manual retry state.
- `apps/vela-mobile/src/composables/useDueReviewCount.test.ts` — query/recovery/retry behavior.
- `apps/vela-mobile/src/components/home/due-review-view.ts` — pure query/auth-state-to-presentation selector.
- `apps/vela-mobile/src/components/home/due-review-view.test.ts` — exhaustive presentation matrix.

### Existing files to modify

- `packages/common/src/keys.ts`
- `packages/common/src/keys.test.ts`
- `packages/common/src/index.ts`
- `apps/vela/src/services/srsService.ts`
- `apps/vela/src/services/srsService.test.ts`
- `CLAUDE.md`
- `apps/vela-mobile/package.json`
- `bun.lock`
- `apps/vela-mobile/quasar.config.ts`
- `apps/vela-mobile/vitest.config.ts`
- `apps/vela-mobile/src/boot/boot-files.ts`
- `apps/vela-mobile/src/boot/boot-files.test.ts`
- `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`
- `apps/vela-mobile/src/boot/mobile-auth.ts`
- `apps/vela-mobile/src/boot/mobile-auth.test.ts`
- `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- `apps/vela-mobile/src/services/mobile-auth.ts`
- `apps/vela-mobile/src/services/mobile-auth.test.ts`
- `apps/vela-mobile/src/test/secret-leak-helpers.ts`
- `apps/vela-mobile/src/App.vue`
- `apps/vela-mobile/src/App.test.ts`
- `apps/vela-mobile/src/pages/HomePage.vue`
- `apps/vela-mobile/src/pages/HomePage.test.ts`
- Coordinator fixture files that construct a `MobileAuthCoordinator` literal:
  - `apps/vela-mobile/src/pages/MorePage.test.ts`
  - `apps/vela-mobile/src/pages/StubPages.test.ts`
  - `apps/vela-mobile/src/components/mobile/MobileAuthGate.navigation.test.ts`
  - `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`

### Files to inspect but not modify unless a test proves drift

- `apps/vela-api/src/routes/srs.ts` — source of the production stats shape.
- `apps/vela-api/src/middleware/auth.ts` — already accepts both web and mobile client IDs.
- `packages/cdk/lib/api-stack.ts` — already injects `COGNITO_MOBILE_CLIENT_ID`.
- `apps/vela-mobile/src/components/mobile/MobileAuthGate.vue` — remains the owner of blocking auth recovery UI.
- `apps/vela-mobile/src/components/mobile/mobile-auth-gate-view.ts` — protected-content gating remains based on `sessionUsable`.

## Execution Preflight

- [ ] **Step 1: Create an isolated implementation worktree**

```bash
cd $REPO_ROOT
git fetch origin main
git worktree add ../Vela-hpa-207 -b codex/hpa-207-mobile-due-review-count origin/main
cd ../Vela-hpa-207
```

Expected: the new worktree is on `codex/hpa-207-mobile-due-review-count` with a clean working tree.

- [ ] **Step 2: Confirm the accepted design is present**

```bash
test -f docs/superpowers/specs/2026-07-30-mobile-authenticated-due-review-count-design.md
git status --short
```

Expected: the design file exists and `git status --short` is empty.

- [ ] **Step 3: Install the pinned workspace dependencies**

```bash
bun install --frozen-lockfile
```

Expected: exit 0 with no lockfile changes before Task 2.

---

### Task 1: Share the SRS Stats Contract and User-Scope the Stats Key

**Files:**

- Create: `packages/common/src/contracts/srs.ts`
- Create: `packages/common/src/contracts/srs.test.ts`
- Modify: `packages/common/src/keys.ts`
- Modify: `packages/common/src/keys.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/srsService.ts`
- Modify: `apps/vela/src/services/srsService.test.ts`
- Modify: `CLAUDE.md`

**Interfaces:**

- Produces:

```ts
export interface SRSStats {
  total_items: number;
  due_today: number;
  mastery_breakdown: {
    new: number;
    learning: number;
    reviewing: number;
    mastered: number;
  };
  average_ease_factor: number;
  total_reviews: number;
  accuracy_rate: number;
}

export function parseSrsStats(value: unknown): SRSStats;

export const srsKeys: {
  all: readonly ['srs'];
  stats(userId: string | null, jlpt?: number[]): readonly [
    'srs',
    'stats',
    string | null,
    number[] | undefined,
  ];
};
```

- Consumed by Tasks 6–9 through `MobileSrsService`, `useDueReviewCount()`, and the Home presentation selector.

- [ ] **Step 1: Write the failing parser tests**

Create `packages/common/src/contracts/srs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSrsStats, type SRSStats } from './srs';

const validStats: SRSStats = {
  total_items: 12,
  due_today: 3,
  mastery_breakdown: {
    new: 2,
    learning: 4,
    reviewing: 3,
    mastered: 3,
  },
  average_ease_factor: 2.47,
  total_reviews: 31,
  accuracy_rate: 87,
};

describe('parseSrsStats', () => {
  it('parses the complete production response and ignores additive fields', () => {
    expect(parseSrsStats({ ...validStats, generated_at: '2026-07-30T00:00:00Z' })).toEqual(
      validStats,
    );
  });

  it.each([
    ['total_items', { ...validStats, total_items: -1 }],
    ['due_today', { ...validStats, due_today: 1.5 }],
    [
      'mastery_breakdown.new',
      {
        ...validStats,
        mastery_breakdown: { ...validStats.mastery_breakdown, new: Number.NaN },
      },
    ],
    ['average_ease_factor', { ...validStats, average_ease_factor: Number.POSITIVE_INFINITY }],
    ['accuracy_rate', { ...validStats, accuracy_rate: 101 }],
  ])('rejects invalid %s', (field, value) => {
    expect(() => parseSrsStats(value)).toThrow(`invalid_srs_stats:${field}`);
  });

  it('rejects a missing nested field', () => {
    const { mastered: _mastered, ...mastery_breakdown } = validStats.mastery_breakdown;
    expect(() => parseSrsStats({ ...validStats, mastery_breakdown })).toThrow(
      'invalid_srs_stats:mastery_breakdown.mastered',
    );
  });
});
```

- [ ] **Step 2: Update the stats-key tests first**

Replace the existing `stats` cases in `packages/common/src/keys.test.ts` with:

```ts
it('stats scopes the tuple by user and jlpt', () => {
  expect(srsKeys.stats('user-1', [2, 3])).toEqual(['srs', 'stats', 'user-1', [2, 3]]);
});

it('stats preserves null user and undefined jlpt', () => {
  expect(srsKeys.stats(null)).toEqual(['srs', 'stats', null, undefined]);
});

it('stats produces distinct keys for distinct users', () => {
  expect(srsKeys.stats('user-1')).not.toEqual(srsKeys.stats('user-2'));
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

```bash
cd $REPO_ROOT/packages/common
bun run test:unit -- src/contracts/srs.test.ts src/keys.test.ts
```

Expected: FAIL because `contracts/srs.ts` does not exist and `srsKeys.stats` still accepts only JLPT levels.

- [ ] **Step 4: Implement the shared parser**

Create `packages/common/src/contracts/srs.ts`:

```ts
export interface SRSStats {
  total_items: number;
  due_today: number;
  mastery_breakdown: {
    new: number;
    learning: number;
    reviewing: number;
    mastered: number;
  };
  average_ease_factor: number;
  total_reviews: number;
  accuracy_rate: number;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value as number;
}

function finiteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value;
}

export function parseSrsStats(value: unknown): SRSStats {
  const root = record(value, 'root');
  const mastery = record(root.mastery_breakdown, 'mastery_breakdown');
  const accuracyRate = finiteNonNegative(root.accuracy_rate, 'accuracy_rate');

  if (accuracyRate > 100) {
    throw new TypeError('invalid_srs_stats:accuracy_rate');
  }

  return {
    total_items: nonNegativeInteger(root.total_items, 'total_items'),
    due_today: nonNegativeInteger(root.due_today, 'due_today'),
    mastery_breakdown: {
      new: nonNegativeInteger(mastery.new, 'mastery_breakdown.new'),
      learning: nonNegativeInteger(mastery.learning, 'mastery_breakdown.learning'),
      reviewing: nonNegativeInteger(mastery.reviewing, 'mastery_breakdown.reviewing'),
      mastered: nonNegativeInteger(mastery.mastered, 'mastery_breakdown.mastered'),
    },
    average_ease_factor: finiteNonNegative(
      root.average_ease_factor,
      'average_ease_factor',
    ),
    total_reviews: nonNegativeInteger(root.total_reviews, 'total_reviews'),
    accuracy_rate: accuracyRate,
  };
}
```

- [ ] **Step 5: Export the contract and change the stats key**

Update `packages/common/src/index.ts` so its header names `@vela/common`, mentions domain contracts, and add:

```ts
export { parseSrsStats, type SRSStats } from './contracts/srs';
```

Update `packages/common/src/keys.ts`:

```ts
export const srsKeys = {
  all: ['srs'] as const,
  // Identity-unscoped legacy keys. Do not use these for mobile user data until
  // their identity and cache-isolation contract is redesigned.
  due: (limit?: number, jlpt?: number[]) => [...srsKeys.all, 'due', limit, jlpt] as const,
  stats: (userId: string | null, jlpt?: number[]) =>
    [...srsKeys.all, 'stats', userId, jlpt] as const,
  progress: (vocabularyId: string) => [...srsKeys.all, 'progress', vocabularyId] as const,
  allProgress: () => [...srsKeys.all, 'all'] as const,
};
```

- [ ] **Step 6: Remove the web duplicate without changing web behavior**

At the top of `apps/vela/src/services/srsService.ts`, add:

```ts
import type { SRSStats } from '@vela/common';
export type { SRSStats } from '@vela/common';
```

Delete the local `SRSStats` interface and leave `getStats()` and every HTTP call unchanged.

In `apps/vela/src/services/srsService.test.ts`, type the existing successful stats fixture through the service re-export:

```ts
import { srsService, type SRSStats } from './srsService';

const statsResponse: SRSStats = {
  total_items: 1,
  due_today: 1,
  mastery_breakdown: { new: 0, learning: 1, reviewing: 0, mastered: 0 },
  average_ease_factor: 2.5,
  total_reviews: 2,
  accuracy_rate: 50,
};
```

Use `statsResponse` in the existing `getStats` test so the re-export is compile-checked.

- [ ] **Step 7: Correct the stale repository guidance**

In `CLAUDE.md`, mark the mobile-audience verifier prerequisite as completed and state that `initializeAuthVerifier()` already accepts `[webClientId, mobileClientId]`. Do not change the remaining mobile-authentication guidance.

- [ ] **Step 8: Run shared and web service tests**

```bash
cd $REPO_ROOT/packages/common
bun run test:unit -- src/contracts/srs.test.ts src/keys.test.ts

cd $REPO_ROOT/apps/vela
bun vitest run src/services/srsService.test.ts
```

Expected: both commands PASS.

- [ ] **Step 9: Commit**

```bash
cd $REPO_ROOT
git add \
  packages/common/src/contracts/srs.ts \
  packages/common/src/contracts/srs.test.ts \
  packages/common/src/keys.ts \
  packages/common/src/keys.test.ts \
  packages/common/src/index.ts \
  apps/vela/src/services/srsService.ts \
  apps/vela/src/services/srsService.test.ts \
  CLAUDE.md
git commit -m "feat(common): share SRS stats contract"
```

---

### Task 2: Add Mobile Query Dependencies, Source Aliases, and Query Boot

**Files:**

- Modify: `apps/vela-mobile/package.json`
- Modify: `bun.lock`
- Modify: `apps/vela-mobile/quasar.config.ts`
- Modify: `apps/vela-mobile/vitest.config.ts`
- Create: `apps/vela-mobile/src/boot/query.ts`
- Create: `apps/vela-mobile/src/boot/query.test.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.test.ts`

**Interfaces:**

- Produces:

```ts
export const mobileQueryClient: QueryClient;
```

- Boot order:

```text
main
query
mobile-auth
capacitor-lifecycle
diagnostic-cold-entry
```

- Consumed by Tasks 7–9.

- [ ] **Step 1: Write the failing boot tests**

Create `apps/vela-mobile/src/boot/query.test.ts`:

```ts
import { VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import queryBoot, { mobileQueryClient } from './query';

describe('mobile query boot', () => {
  it('installs the exported singleton into Vue Query', () => {
    const app = { use: vi.fn() };

    queryBoot({ app } as never);

    expect(app.use).toHaveBeenCalledWith(VueQueryPlugin, {
      queryClient: mobileQueryClient,
    });
  });
});
```

Update every expected array in `apps/vela-mobile/src/boot/boot-files.test.ts` to insert `'query'` immediately after `'main'`.

- [ ] **Step 2: Run the boot tests and verify they fail**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/boot/query.test.ts src/boot/boot-files.test.ts
```

Expected: FAIL because `query.ts` does not exist and boot ordering has not changed.

- [ ] **Step 3: Add exact workspace dependencies**

Update `apps/vela-mobile/package.json` dependencies:

```json
{
  "@tanstack/vue-query": "^5.90.5",
  "@vela/common": "workspace:*",
  "@quasar/extras": "^1.16.4",
  "quasar": "^2.16.0",
  "vue": "^3.4.18",
  "vue-router": "^4.3.0"
}
```

Then refresh the root lockfile:

```bash
cd $REPO_ROOT
bun install
```

Expected: `bun.lock` changes and resolves the workspace package plus TanStack Vue Query.

- [ ] **Step 4: Add source aliases to both mobile toolchains**

In `apps/vela-mobile/quasar.config.ts`, add to `build.alias`:

```ts
'@vela/common': resolve(__dirname, '../../packages/common/src/index.ts'),
```

In `apps/vela-mobile/vitest.config.ts`, add to `resolve.alias`:

```ts
'@vela/common': resolve(__dirname, '../../packages/common/src/index.ts'),
```

- [ ] **Step 5: Implement the query boot and ordering**

Create `apps/vela-mobile/src/boot/query.ts`:

```ts
import { createQueryClient } from '@vela/common';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { defineBoot } from '#q-app/wrappers';

export const mobileQueryClient = createQueryClient();

export default defineBoot(({ app }) => {
  app.use(VueQueryPlugin, { queryClient: mobileQueryClient });
});
```

Update `getMobileBootFiles()`:

```ts
return [
  'main',
  'query',
  'mobile-auth',
  ...(flags.isCapacitor ? ['capacitor-lifecycle'] : []),
  ...(flags.isDevelopment ? ['diagnostic-cold-entry'] : []),
];
```

- [ ] **Step 6: Prove per-app tests use source instead of stale `dist`**

```bash
cd $REPO_ROOT
rm -rf packages/common/dist

cd apps/vela-mobile
bun run test:unit -- src/boot/query.test.ts src/boot/boot-files.test.ts
bun run typecheck
```

Expected: both commands PASS even though `packages/common/dist` is absent.

- [ ] **Step 7: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/package.json \
  bun.lock \
  apps/vela-mobile/quasar.config.ts \
  apps/vela-mobile/vitest.config.ts \
  apps/vela-mobile/src/boot/query.ts \
  apps/vela-mobile/src/boot/query.test.ts \
  apps/vela-mobile/src/boot/boot-files.ts \
  apps/vela-mobile/src/boot/boot-files.test.ts
git commit -m "feat(mobile): bootstrap query state"
```

---

### Task 3: Define the Authenticated Request Contract and Feature Session Selector

**Files:**

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Create: `apps/vela-mobile/src/auth/mobile-feature-session-status.ts`
- Create: `apps/vela-mobile/src/auth/mobile-feature-session-status.test.ts`

**Interfaces:**

- Produces:

```ts
export type MobileAuthenticatedApiRequest = {
  path: string;
  init?: Omit<RequestInit, 'headers'> & { headers?: HeadersInit };
};

export type MobileAuthenticatedApiRequestErrorCode =
  | 'invalid_request_path'
  | 'invalid_request_headers'
  | 'request_timeout'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending';

export class MobileAuthenticatedApiRequestError extends Error {
  readonly code: MobileAuthenticatedApiRequestErrorCode;
}

export type MobileFeatureSessionStatus =
  | { kind: 'usable'; userId: string }
  | { kind: 'recovering'; userId: string; sessionUsable: boolean }
  | { kind: 'unavailable' };

export function selectMobileFeatureSessionStatus(
  state: Readonly<MobileAuthState>,
): MobileFeatureSessionStatus;
```

- Task 4 adds `requestAuthenticatedApi()` to `MobileAuthCoordinator` together with the real implementation.
- Consumed by Tasks 4–9.

- [ ] **Step 1: Write the selector matrix first**

Create `apps/vela-mobile/src/auth/mobile-feature-session-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MobileAuthState } from './mobile-auth-contract';
import { selectMobileFeatureSessionStatus } from './mobile-feature-session-status';

const authenticated: MobileAuthState = {
  phase: 'authenticated',
  operation: 'idle',
  sessionUsable: true,
  errorCode: null,
  retryAction: null,
  notice: null,
  user: { userId: 'user-1', email: null },
};

describe('selectMobileFeatureSessionStatus', () => {
  it('returns usable for a verified idle session', () => {
    expect(selectMobileFeatureSessionStatus(authenticated)).toEqual({
      kind: 'usable',
      userId: 'user-1',
    });
  });

  it.each([
    [{ ...authenticated, operation: 'refreshing' as const }, true],
    [
      {
        ...authenticated,
        sessionUsable: false,
        errorCode: 'session_refresh_failed' as const,
        retryAction: 'refresh' as const,
      },
      false,
    ],
  ])('returns recovering and preserves capability', (state, sessionUsable) => {
    expect(selectMobileFeatureSessionStatus(state)).toEqual({
      kind: 'recovering',
      userId: 'user-1',
      sessionUsable,
    });
  });

  it.each([
    { ...authenticated, phase: 'signedOut' as const, sessionUsable: false, user: null },
    { ...authenticated, operation: 'signingOut' as const, sessionUsable: false },
    { ...authenticated, operation: 'cleaningUp' as const, sessionUsable: false },
  ])('returns unavailable for blocking auth state', (state) => {
    expect(selectMobileFeatureSessionStatus(state)).toEqual({ kind: 'unavailable' });
  });
});
```

- [ ] **Step 2: Run the selector test and verify it fails**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/auth/mobile-feature-session-status.test.ts
```

Expected: FAIL because the selector file and new request contract do not exist.

- [ ] **Step 3: Add the public request types**

Append the request/error types to `mobile-auth-contract.ts`, implement the error class exactly as:

```ts
export class MobileAuthenticatedApiRequestError extends Error {
  constructor(
    readonly code: MobileAuthenticatedApiRequestErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileAuthenticatedApiRequestError';
  }
}
```


- [ ] **Step 4: Implement the auth-owned selector**

Create `apps/vela-mobile/src/auth/mobile-feature-session-status.ts`:

```ts
import type { MobileAuthState } from './mobile-auth-contract';

export type MobileFeatureSessionStatus =
  | { kind: 'usable'; userId: string }
  | { kind: 'recovering'; userId: string; sessionUsable: boolean }
  | { kind: 'unavailable' };

export function selectMobileFeatureSessionStatus(
  state: Readonly<MobileAuthState>,
): MobileFeatureSessionStatus {
  const userId = state.user?.userId;
  if (state.phase !== 'authenticated' || !userId) {
    return { kind: 'unavailable' };
  }

  const recovering =
    state.operation === 'refreshing' ||
    state.operation === 'persisting' ||
    state.operation === 'verifying' ||
    state.retryAction === 'refresh' ||
    state.retryAction === 'persist' ||
    state.retryAction === 'verify';

  if (recovering) {
    return { kind: 'recovering', userId, sessionUsable: state.sessionUsable };
  }

  if (
    state.operation === 'idle' &&
    state.sessionUsable &&
    state.errorCode === null &&
    state.retryAction === null &&
    state.notice === null
  ) {
    return { kind: 'usable', userId };
  }

  return { kind: 'unavailable' };
}
```

- [ ] **Step 5: Run selector and contract tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/auth/mobile-feature-session-status.test.ts
bun run typecheck
```

Expected: PASS. `MobileAuthCoordinator` has not changed yet, so existing coordinator fixtures remain valid.

- [ ] **Step 6: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/auth/mobile-feature-session-status.ts \
  apps/vela-mobile/src/auth/mobile-feature-session-status.test.ts
git commit -m "feat(mobile): define feature auth contracts"
```

---

### Task 4: Implement Safe Feature Transport Outside the Auth Mutation Queue

**Files:**

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`
- Modify typed coordinator fixtures:
  - `apps/vela-mobile/src/App.test.ts`
  - `apps/vela-mobile/src/pages/MorePage.test.ts`
  - `apps/vela-mobile/src/pages/StubPages.test.ts`
  - `apps/vela-mobile/src/components/mobile/MobileAuthGate.navigation.test.ts`
  - `apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts`

**Interfaces:**

- Produces internal helpers:

```ts
function normalizeMobileApiBaseUrl(apiUrl: string): URL;
function resolveMobileApiUrl(baseUrl: URL, relativePath: string): URL;

type AuthenticatedFeatureSnapshot = {
  owner: ActiveSession;
  generation: number;
  idToken: string;
  expiresAt: number;
  userId: string;
};

async function dispatchAuthenticatedFeatureAttempt(
  request: MobileAuthenticatedApiRequest,
  snapshot: AuthenticatedFeatureSnapshot,
): Promise<Response>;
```

- `MobileAuthCoordinator` gains:

```ts
requestAuthenticatedApi(request: MobileAuthenticatedApiRequest): Promise<Response>;
```

- Public `requestAuthenticatedApi()` handles validation, one physical fetch, timeout, cancellation, non-401 response ordering, and stale-401 rejection. Task 5 adds current-generation 401 recovery.

- [ ] **Step 1: Add failing transport-boundary tests**

Extend `mobile-auth.test.ts` with cases that prove:

```ts
it('rejects path escapes before network activity', async () => {
  const harness = makeHarness();
  await authenticate(harness);
  const before = harness.sessionFetch.mock.calls.length;

  for (const path of [
    'https://evil.example/steal',
    '//evil.example/steal',
    '/api/srs/stats',
    '../secret',
    '%2e%2e/secret',
    String.raw`..\secret`,
    'srs/stats#fragment',
  ]) {
    await expect(
      harness.coordinator.requestAuthenticatedApi({ path }),
    ).rejects.toMatchObject({ code: 'invalid_request_path' });
  }

  expect(harness.sessionFetch).toHaveBeenCalledTimes(before);
});

it.each(['Authorization', 'authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN'])(
  'rejects caller-owned %s',
  async (header) => {
    const harness = makeHarness();
    await authenticate(harness);

    await expect(
      harness.coordinator.requestAuthenticatedApi({
        path: 'srs/stats',
        init: { headers: { [header]: 'Bearer attacker' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request_headers' });
  },
);
```

Add tests for:

- base `https://vela.example/api` and `https://vela.example/api///` both resolve to `/api/srs/stats`;
- `/api-evil/secret` is rejected for base `/api/`;
- the coordinator supplies exactly one `Authorization: Bearer <current-id-token>`;
- caller abort stays an `AbortError`;
- 15-second attempt timeout becomes `request_timeout`;
- raw fetch rejection propagates without auth-state mutation;
- a 200 and a 500 both return after concurrent successful refresh promotion;
- a stale-generation 401 becomes `session_changed` without cleanup;
- a pending feature fetch does not block `signOut()`, `retryCurrentOperation()`, or `dispose()`.

- [ ] **Step 2: Run the focused coordinator tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/services/mobile-auth.test.ts
```

Expected: FAIL because the public method and safety boundary are not implemented.

- [ ] **Step 3: Implement URL normalization and path containment**

Add these coordinator-local helpers in `mobile-auth.ts`:

```ts
function normalizeMobileApiBaseUrl(apiUrl: string): URL {
  const base = new URL(apiUrl);
  base.search = '';
  base.hash = '';
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`;
  return base;
}

function resolveMobileApiUrl(base: URL, relativePath: string): URL {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    relativePath.includes('\\') ||
    relativePath.includes('#') ||
    /^[a-z][a-z\d+.-]*:/iu.test(relativePath) ||
    relativePath.startsWith('//')
  ) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }

  const resolved = new URL(relativePath, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }

  return resolved;
}
```

Before resolving, decode each path segment once:

```ts
for (const segment of relativePath.split('/')) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }
  if (decoded === '.' || decoded === '..' || decoded.includes('\\')) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }
}
```

Keep the parsed-origin and trailing-pathname check as the final boundary.

Replace `sessionUrl()` with:

```ts
const apiBaseUrl = normalizeMobileApiBaseUrl(dependencies.config.apiUrl);
resolveMobileApiUrl(apiBaseUrl, 'auth/session');
```

- [ ] **Step 4: Implement case-insensitive header ownership**

Create caller headers through `new Headers(request.init?.headers)`, reject `headers.has('authorization')`, then set:

```ts
headers.set('Accept', headers.get('Accept') ?? 'application/json');
headers.set('Authorization', `Bearer ${snapshot.idToken}`);
```

Never include header contents in thrown errors or logs.

- [ ] **Step 5: Implement one bounded feature fetch outside `serialize()`**

Add `dispatchAuthenticatedFeatureAttempt()` with:

```ts
const controller = new AbortController();
let timeoutExpired = false;

const onCallerAbort = () => controller.abort();
request.init?.signal?.addEventListener('abort', onCallerAbort, { once: true });

const timeout = setTimeout(() => {
  timeoutExpired = true;
  controller.abort();
}, MOBILE_AUTH_NETWORK_TIMEOUT_MS);

try {
  return await dependencies.fetch(target, {
    ...request.init,
    headers,
    signal: controller.signal,
  });
} catch (error) {
  if (request.init?.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  if (timeoutExpired) {
    throw new MobileAuthenticatedApiRequestError('request_timeout', { cause: error });
  }
  throw error;
} finally {
  clearTimeout(timeout);
  request.init?.signal?.removeEventListener('abort', onCallerAbort);
}
```

`requestAuthenticatedApi()` must synchronously snapshot `active`, `activeBundleGeneration`, ID token, expiry, and user before starting this helper. Do not call `serialize()` around the feature fetch.

After the response:

```ts
if (response.status !== 401) return response;
if (active !== snapshot.owner || activeBundleGeneration !== snapshot.generation) {
  throw new MobileAuthenticatedApiRequestError('session_changed');
}
return response; // Task 5 replaces this current-generation branch with shared recovery.
```

- [ ] **Step 6: Add the method to the coordinator interface and typed fixtures**

Add `requestAuthenticatedApi()` to `MobileAuthCoordinator` in `mobile-auth-contract.ts`.

Add this fail-closed member to every typed coordinator fixture listed in this task:

```ts
requestAuthenticatedApi: vi
  .fn()
  .mockRejectedValue(new MobileAuthenticatedApiRequestError('session_unavailable')),
```

The real coordinator returned by `createMobileAuthCoordinator()` uses the implementation from Step 5.

- [ ] **Step 7: Extend secret-leak assertions**

Add sentinel Authorization header and rejected-path values to the existing secret-leak helper input, then assert they do not appear in console calls, error messages, rendered state, or JSON snapshots.

- [ ] **Step 8: Run coordinator and secret tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/services/mobile-auth.test.ts src/services/mobile-auth-disposal.test.ts
```

Expected: PASS, including non-blocking auth operation tests and non-401 ordering.

- [ ] **Step 9: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts \
  apps/vela-mobile/src/test/secret-leak-helpers.ts \
  apps/vela-mobile/src/App.test.ts \
  apps/vela-mobile/src/pages/MorePage.test.ts \
  apps/vela-mobile/src/pages/StubPages.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.navigation.test.ts \
  apps/vela-mobile/src/components/mobile/MobileAuthGate.test.ts
git commit -m "feat(mobile): add safe authenticated transport"
```

---

### Task 5: Add Explicit, Single-Flight 401 Recovery

**Files:**

- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**

- Produces internal types:

```ts
type FeatureRefreshObservation =
  | { kind: 'promoted'; owner: ActiveSession; generation: number }
  | { kind: 'terminal' }
  | { kind: 'superseded' }
  | { kind: 'retryable_failure' };

type FeatureUnauthorizedRecoveryResult =
  | { kind: 'refreshed' }
  | { kind: 'terminal' }
  | { kind: 'superseded' }
  | { kind: 'retryable_failure' };
```

- Finalizes `requestAuthenticatedApi()` behavior for current-generation 401.

- [ ] **Step 1: Add failing refresh-observation tests**

Add coordinator tests for these exact outcomes:

```text
app inactive queueRefresh no-op              -> retryable_failure
pending candidate queueRefresh no-op          -> retryable_failure
verified same-user generation promotion      -> promoted
recovery-owned invalid-grant cleanup          -> terminal
ordinary sign-out while waiting               -> superseded
identity replacement while waiting            -> superseded
```

Also add concurrent tests proving:

- two expired-token 401s start one refresh and each retry once;
- two still-valid-token 401s enqueue one terminal cleanup;
- one caller abort detaches without cancelling the peer recovery;
- an already-running proactive refresh is joined;
- a retry 401 performs terminal cleanup but never performs another refresh;
- recovery never waits behind its own feature request.

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/services/mobile-auth.test.ts
```

Expected: FAIL because current-generation 401 is still returned directly.

- [ ] **Step 3: Add the guarded recovery record**

Inside `createMobileAuthCoordinator()` add:

```ts
type FeatureUnauthorizedRecovery = {
  owner: ActiveSession;
  generation: number;
  terminalCleanupStarted: boolean;
  promise: Promise<FeatureUnauthorizedRecoveryResult>;
};

let featureUnauthorizedRecovery: FeatureUnauthorizedRecovery | undefined;
```

Immediately before `terminalSessionCleanupUnlocked()` clears the active session, mark `terminalCleanupStarted = true` only when the recovery record still matches the current owner/generation. Sign-out and disposal use different cleanup paths and must not set this flag.

- [ ] **Step 4: Implement explicit refresh observation**

Implement:

```ts
async function observeFeatureRefresh(
  owner: ActiveSession,
  generation: number,
): Promise<FeatureRefreshObservation> {
  await queueRefresh({ requireDue: false, owner, generation });

  if (
    active !== undefined &&
    active.user.userId === owner.user.userId &&
    activeBundleGeneration > generation &&
    activeSessionIsUsable()
  ) {
    return {
      kind: 'promoted',
      owner: active,
      generation: activeBundleGeneration,
    };
  }

  if (featureUnauthorizedRecovery?.terminalCleanupStarted === true) {
    return { kind: 'terminal' };
  }

  if (
    unavailable() ||
    active !== owner ||
    activeBundleGeneration !== generation
  ) {
    return { kind: 'superseded' };
  }

  return { kind: 'retryable_failure' };
}
```

Keep this normative precedence: promoted, recovery-owned terminal, superseded, retryable failure.

- [ ] **Step 5: Implement one recovery promise per owner/generation**

Create `getOrCreateFeatureUnauthorizedRecovery(snapshot)`:

- reuse the existing record only when both owner and generation match;
- if the captured token expired, call `observeFeatureRefresh()`;
- if the captured token was still valid, enqueue exactly one guarded `terminalSessionCleanupUnlocked()` through `serialize()`;
- clear the record in `finally` only if it is still the active record;
- map `promoted` to `refreshed`, preserving the other outcomes.

Do not wrap the feature caller itself in `serialize()`.

- [ ] **Step 6: Finalize request retry behavior**

Refactor the public method through an internal helper:

```ts
async function requestAuthenticatedApiInternal(
  request: MobileAuthenticatedApiRequest,
  allowRefreshRetry: boolean,
): Promise<Response>;
```

For a current-generation 401:

```ts
const recovery = await waitForFeatureRecoveryOrCallerAbort(snapshot, request.init?.signal);

switch (recovery.kind) {
  case 'refreshed':
    if (!allowRefreshRetry) return response;
    return requestAuthenticatedApiInternal(request, false);
  case 'terminal':
    return response;
  case 'superseded':
    throw new MobileAuthenticatedApiRequestError('session_changed');
  case 'retryable_failure':
    throw new MobileAuthenticatedApiRequestError('session_recovery_pending');
}
```

If the supplied signal aborts while recovery remains in flight, detach that caller and preserve `AbortError`; do not cancel the shared recovery. Task 6 owns the eight-second feature deadline and maps a deadline-triggered abort to `session_recovery_pending` only when the auth-owned session selector reports active recovery. Direct user/TanStack cancellation remains `AbortError`.

- [ ] **Step 7: Run the coordinator suite**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/services/mobile-auth.test.ts src/services/mobile-auth-disposal.test.ts
```

Expected: PASS with one refresh/cleanup per generation, no self-deadlock, and no credential deletion on retryable/no-op refresh.

- [ ] **Step 8: Commit**

```bash
cd $REPO_ROOT
git add apps/vela-mobile/src/services/mobile-auth.ts apps/vela-mobile/src/services/mobile-auth.test.ts
git commit -m "feat(mobile): recover authenticated 401 requests"
```

---

### Task 6: Add the Bounded JSON Client, SRS Service, and Service Provisioning

**Files:**

- Create: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.test.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.test.ts`

**Interfaces:**

- Produces:

```ts
export type MobileApiErrorCode =
  | 'invalid_request'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'invalid_response';

export class MobileApiError extends Error {
  readonly code: MobileApiErrorCode;
}

export const MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS = 8_000;

export type MobileApiClient = {
  getJson(path: string, options?: { signal?: AbortSignal }): Promise<unknown>;
};

export function createMobileApiClient(
  coordinator: MobileAuthCoordinator,
  timeoutMs?: number,
): MobileApiClient;

export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};

export const MOBILE_API_CLIENT_KEY: InjectionKey<MobileApiClient>;
export const MOBILE_SRS_SERVICE_KEY: InjectionKey<MobileSrsService>;

export function provideMobileServices(
  app: App,
  coordinator: MobileAuthCoordinator,
): void;
```

- Consumed by Tasks 8–9.

- [ ] **Step 1: Write failing API client tests**

Create tests covering:

- 200 JSON response;
- final 401 -> `unauthorized`;
- 403 -> `forbidden`;
- 404/409/500 -> `server`;
- invalid path/header coordinator errors -> `invalid_request`;
- `session_unavailable`, `session_changed`, `session_recovery_pending` preserve their codes;
- raw `TypeError` -> `network`;
- coordinator `request_timeout` -> `network`;
- execution deadline outside auth recovery -> `network`;
- execution deadline while coordinator reports pending recovery -> `session_recovery_pending`;
- caller abort remains `AbortError`;
- stalled `response.json()` -> `network`;
- timers and listeners are cleared in every branch.

Use fake timers:

```ts
vi.useFakeTimers();
const promise = client.getJson('srs/stats');
await vi.advanceTimersByTimeAsync(MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS);
await expect(promise).rejects.toMatchObject({ code: 'network' });
vi.useRealTimers();
```

- [ ] **Step 2: Write failing SRS and provisioning tests**

`mobile-srs.test.ts` must assert exact path and signal:

```ts
expect(apiClient.getJson).toHaveBeenCalledWith('srs/stats', { signal });
```

It must also prove malformed stats become `invalid_response`.

`mobile-services.test.ts` must assert `app.provide()` receives a service whose `getStats()` delegates through the supplied coordinator; it must not call Vue `inject()`.

- [ ] **Step 3: Run tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- \
  src/services/mobile-api-client.test.ts \
  src/services/mobile-srs.test.ts \
  src/services/mobile-services.test.ts
```

Expected: FAIL because the service files do not exist.

- [ ] **Step 4: Implement the feature-facing error and deadline client**

In `mobile-api-client.ts`, create one caller-linked `AbortController` and one deadline timer before invoking the coordinator. Keep the same signal alive through `response.json()`.

Track `callerAborted` and `deadlineExpired` separately. Map errors exactly:

```ts
function mapCoordinatorError(
  error: unknown,
  context: {
    callerAborted: boolean;
    deadlineExpired: boolean;
    coordinator: MobileAuthCoordinator;
  },
): never {
  const { callerAborted, deadlineExpired, coordinator } = context;

  if (error instanceof MobileAuthenticatedApiRequestError) {
    if (error.code === 'invalid_request_path' || error.code === 'invalid_request_headers') {
      throw new MobileApiError('invalid_request', { cause: error });
    }
    if (error.code === 'request_timeout') {
      throw new MobileApiError('network', { cause: error });
    }
    throw new MobileApiError(error.code, { cause: error });
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    if (callerAborted) throw error;
    if (
      deadlineExpired &&
      selectMobileFeatureSessionStatus(coordinator.state).kind === 'recovering'
    ) {
      throw new MobileApiError('session_recovery_pending', { cause: error });
    }
    throw new MobileApiError('network', { cause: error });
  }

  throw new MobileApiError('network', { cause: error });
}
```

The deadline controller must abort with a local flag; it must not encode deadline semantics into the public coordinator request contract.

After the response:

```ts
if (response.status === 401) throw new MobileApiError('unauthorized');
if (response.status === 403) throw new MobileApiError('forbidden');
if (!response.ok) throw new MobileApiError('server');
```

Read JSON before clearing the deadline. If the deadline controller fired, classify the body failure as `network`. Never log raw content.

- [ ] **Step 5: Implement the SRS service**

Create `mobile-srs.ts`:

```ts
import { parseSrsStats, type SRSStats } from '@vela/common';
import { MobileApiError, type MobileApiClient } from './mobile-api-client';

export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};

export function createMobileSrsService(apiClient: MobileApiClient): MobileSrsService {
  return {
    async getStats(options = {}) {
      const value = await apiClient.getJson('srs/stats', options);
      try {
        return parseSrsStats(value);
      } catch (error) {
        throw new MobileApiError('invalid_response', { cause: error });
      }
    },
  };
}
```

- [ ] **Step 6: Implement direct service provisioning**

Create `MOBILE_API_CLIENT_KEY` and `MOBILE_SRS_SERVICE_KEY` in `mobile-services.ts`, construct the API client and SRS service from the coordinator, and call `app.provide()` for both.

Update `boot/mobile-auth.ts` ordering:

```ts
app.provide(MOBILE_AUTH_KEY, coordinator);
provideMobileServices(app, coordinator);
void coordinator.initialize();
```

Update `mobile-auth.test.ts` to assert provisioning receives the same coordinator instance and occurs before `initialize()`.

- [ ] **Step 7: Run the service and boot tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- \
  src/services/mobile-api-client.test.ts \
  src/services/mobile-srs.test.ts \
  src/services/mobile-services.test.ts \
  src/boot/mobile-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/services/mobile-api-client.ts \
  apps/vela-mobile/src/services/mobile-api-client.test.ts \
  apps/vela-mobile/src/services/mobile-srs.ts \
  apps/vela-mobile/src/services/mobile-srs.test.ts \
  apps/vela-mobile/src/services/mobile-services.ts \
  apps/vela-mobile/src/services/mobile-services.test.ts \
  apps/vela-mobile/src/boot/mobile-auth.ts \
  apps/vela-mobile/src/boot/mobile-auth.test.ts
git commit -m "feat(mobile): add due-count API services"
```

---

### Task 7: Bridge Native Focus and Enforce Auth-Driven Query Isolation

**Files:**

- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts`
- Create: `apps/vela-mobile/src/services/mobile-query-auth-isolation.test.ts`
- Modify: `apps/vela-mobile/src/App.vue`
- Modify: `apps/vela-mobile/src/App.test.ts`

**Interfaces:**

- Produces:

```ts
export function installMobileQueryAuthIsolation(options: {
  state: Readonly<MobileAuthState>;
  queryClient: QueryClient;
}): WatchStopHandle;
```

- Native lifecycle updates `focusManager.setFocused(isActive)`.

- Consumed by Task 8.

- [ ] **Step 1: Update lifecycle tests first**

Extend the fake adapter to support both `'resume'` and `'appStateChange'`. Assert:

```ts
expect(addListener).toHaveBeenCalledWith('resume', expect.any(Function));
expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
expect(setFocused).toHaveBeenNthCalledWith(1, false);
expect(setFocused).toHaveBeenNthCalledWith(2, true);
```

Mock `focusManager.setFocused` through `vi.spyOn(focusManager, 'setFocused')`.

- [ ] **Step 2: Write failing auth-isolation tests**

Use a real `QueryClient` with a seeded `srsKeys.stats('user-1')` value. Cover:

- soft refresh with `sessionUsable: true` retains cache;
- recovering with `sessionUsable: false` cancels active queries but does not remove same-user cache;
- sign-out start cancels, then clears;
- terminal cleanup and cleanup failure clear;
- identity change from user-1 to user-2 clears;
- ordinary backgrounding causes no cache action;
- cancellation resolves before `queryClient.clear()` is called.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- \
  src/boot/capacitor-lifecycle.test.ts \
  src/services/mobile-query-auth-isolation.test.ts \
  src/App.test.ts
```

Expected: FAIL because lifecycle focus and the isolation installer do not exist.

- [ ] **Step 4: Implement native focus integration**

Change the lifecycle adapter overloads to register both listeners. Keep `recordAppResume()` on `'resume'`; on `'appStateChange'` call:

```ts
focusManager.setFocused(event.isActive);
```

Retain the existing single-registration promise and retry-after-registration-failure behavior. If either listener registration fails, remove any handle already created and reject so a later call can retry cleanly.

- [ ] **Step 5: Implement cancel-then-clear isolation**

In `mobile-query-auth-isolation.ts`, watch a compact snapshot:

```ts
type AuthQuerySnapshot = {
  phase: MobileAuthState['phase'];
  operation: MobileAuthState['operation'];
  userId: string | null;
  featureStatus: MobileFeatureSessionStatus;
};
```

Serialize cleanup work through a local promise tail. Compute:

```ts
const identityChanged = previous.userId !== next.userId;
const clearRequired =
  identityChanged ||
  next.phase === 'signedOut' ||
  next.operation === 'signingOut' ||
  next.operation === 'cleaningUp';

const cancelOnly =
  next.featureStatus.kind === 'recovering' &&
  !next.featureStatus.sessionUsable;
```

For `clearRequired`, await `queryClient.cancelQueries()` and then call `queryClient.clear()`. For `cancelOnly`, await cancellation without clearing. Do nothing for usable soft recovery and backgrounding.

- [ ] **Step 6: Install isolation once from App**

Update `App.vue`:

```ts
<script setup lang="ts">
import { inject, onUnmounted } from 'vue';
import { mobileQueryClient } from './boot/query';
import MobileAuthGate from './components/mobile/MobileAuthGate.vue';
import { MOBILE_AUTH_KEY } from './services/mobile-auth';
import { installMobileQueryAuthIsolation } from './services/mobile-query-auth-isolation';

const coordinator = inject(MOBILE_AUTH_KEY);
if (!coordinator) throw new Error('Mobile auth coordinator was not provided');

const stopIsolation = installMobileQueryAuthIsolation({
  state: coordinator.state,
  queryClient: mobileQueryClient,
});
onUnmounted(stopIsolation);
</script>
```

Update `App.test.ts` to install a fresh test QueryClient by mocking `mobileQueryClient`, add the new coordinator method, and assert sign-out removes seeded due-count data before protected Home can remount.

- [ ] **Step 7: Run lifecycle/isolation/App tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- \
  src/boot/capacitor-lifecycle.test.ts \
  src/services/mobile-query-auth-isolation.test.ts \
  src/App.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/boot/capacitor-lifecycle.ts \
  apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts \
  apps/vela-mobile/src/services/mobile-query-auth-isolation.ts \
  apps/vela-mobile/src/services/mobile-query-auth-isolation.test.ts \
  apps/vela-mobile/src/App.vue \
  apps/vela-mobile/src/App.test.ts
git commit -m "feat(mobile): isolate authenticated query state"
```

---

### Task 8: Implement the Due-Count Query and Recovery Semantics

**Files:**

- Create: `apps/vela-mobile/src/composables/useDueReviewCount.ts`
- Create: `apps/vela-mobile/src/composables/useDueReviewCount.test.ts`

**Interfaces:**

- Produces:

```ts
export type UseDueReviewCountResult = {
  stats: ComputedRef<SRSStats | undefined>;
  error: ComputedRef<MobileApiError | null>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  isInitialPending: ComputedRef<boolean>;
  isFetching: ComputedRef<boolean>;
  sessionRecoveryPending: ComputedRef<boolean>;
  manualRetryPending: Readonly<Ref<boolean>>;
  retry(): Promise<void>;
};

export function retryDueCountQuery(failureCount: number, error: unknown): boolean;
export function useDueReviewCount(): UseDueReviewCountResult;
```

- Consumed by Task 9.

- [ ] **Step 1: Build a composable test host**

In `useDueReviewCount.test.ts`, mount a minimal component with:

- a fresh `QueryClient` installed through `VueQueryPlugin`;
- reactive `MobileAuthState` provided through `MOBILE_AUTH_KEY`;
- a fake `MobileSrsService` provided through `MOBILE_SRS_SERVICE_KEY`;
- `retry: false` on the test client unless the case explicitly tests the predicate.

Capture the composable return from `setup()` so tests can drive state and await `flushPromises()`.

- [ ] **Step 2: Write failing behavior tests**

Cover:

- no request during restoration;
- exactly one initial request when restored auth becomes usable;
- query key contains the current user ID;
- first same-user `session_changed` silently retries once;
- first dispatch-time `session_unavailable` silently retries once when the same user remains usable;
- repeated control race becomes a visible manually retryable error;
- `session_recovery_pending` with cached data keeps the cached count;
- `session_recovery_pending` without cache exposes recovery loading;
- same-user `recovering -> usable` refetches once;
- recovering-but-unusable disables the query;
- user change selects a different key;
- manual retry preserves the prior error surface and is distinct from background fetching;
- `retryDueCountQuery` returns true only for network/server at failure counts 0 and 1.

- [ ] **Step 3: Run the composable tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/composables/useDueReviewCount.test.ts
```

Expected: FAIL because the composable does not exist.

- [ ] **Step 4: Implement exact retry policy and query enablement**

```ts
export const DUE_COUNT_RETRY_LIMIT = 2;

export function retryDueCountQuery(failureCount: number, error: unknown): boolean {
  return (
    error instanceof MobileApiError &&
    (error.code === 'network' || error.code === 'server') &&
    failureCount < DUE_COUNT_RETRY_LIMIT
  );
}
```

Compute enablement:

```ts
const sessionStatus = computed(() =>
  selectMobileFeatureSessionStatus(coordinator.state),
);

const queryEnabled = computed(
  () =>
    sessionStatus.value.kind === 'usable' ||
    (sessionStatus.value.kind === 'recovering' &&
      sessionStatus.value.sessionUsable),
);
```

Use:

```ts
useQuery({
  queryKey: computed(() =>
    srsKeys.stats(
      sessionStatus.value.kind === 'unavailable'
        ? null
        : sessionStatus.value.userId,
    ),
  ),
  enabled: queryEnabled,
  queryFn: ({ signal }) => fetchStatsWithSessionRaceRecovery(signal),
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: retryDueCountQuery,
});
```

- [ ] **Step 5: Implement one silent control-flow retry**

`fetchStatsWithSessionRaceRecovery()` captures the starting user ID. When the service throws `session_changed` or `session_unavailable`, retry once only when:

- the query signal is not aborted;
- `selectMobileFeatureSessionStatus()` still reports the same user;
- the status remains usable or recovering with `sessionUsable: true`.

After one retry, rethrow any repeated failure so the UI has a manual recovery path.

- [ ] **Step 6: Implement pending-recovery refetch and manual retry state**

Derive `sessionRecoveryPending` from the query error code. Watch only `MobileFeatureSessionStatus`; when the same user transitions from `recovering` to `usable` after a pending recovery error, call `query.refetch()` once.

Normalize presentation errors before returning the composable result:

```ts
const sessionRecoveryPending = computed(
  () =>
    query.error.value instanceof MobileApiError &&
    query.error.value.code === 'session_recovery_pending',
);

const visibleError = computed<MobileApiError | null>(() => {
  const error = retainedManualError.value ?? query.error.value;
  if (!(error instanceof MobileApiError)) return null;
  if (error.code === 'session_recovery_pending' || error.code === 'unauthorized') {
    return null;
  }
  return error;
});
```

Return `visibleError` as the public `error` field. This prevents pending auth recovery from being rendered as a Home error and lets the auth gate own unauthorized presentation.

For manual retry:

```ts
const manualRetryPending = ref(false);
const retainedManualError = ref<MobileApiError | null>(null);

async function retry(): Promise<void> {
  if (manualRetryPending.value) return;
  retainedManualError.value =
    query.error.value instanceof MobileApiError ? query.error.value : null;
  manualRetryPending.value = true;
  try {
    await query.refetch();
  } finally {
    manualRetryPending.value = false;
    retainedManualError.value = null;
  }
}
```

Expose the retained error while manual retry is pending so the existing failure surface does not disappear.

- [ ] **Step 7: Run composable tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/composables/useDueReviewCount.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/composables/useDueReviewCount.ts \
  apps/vela-mobile/src/composables/useDueReviewCount.test.ts
git commit -m "feat(mobile): query due-review count"
```

---

### Task 9: Add the Pure View Selector and Accessible Home Surface

**Files:**

- Create: `apps/vela-mobile/src/components/home/due-review-view.ts`
- Create: `apps/vela-mobile/src/components/home/due-review-view.test.ts`
- Modify: `apps/vela-mobile/src/pages/HomePage.vue`
- Modify: `apps/vela-mobile/src/pages/HomePage.test.ts`

**Interfaces:**

- Produces:

```ts
export type DueReviewView =
  | { kind: 'loading'; recoveringSession: boolean }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | {
      kind: 'blocking_error';
      message: string;
      retrying: boolean;
      canRetry: boolean;
    }
  | {
      kind: 'cached_error';
      count: number;
      message: string;
      retrying: boolean;
      canRetry: boolean;
    };

export function selectDueReviewView(input: DueReviewViewInput): DueReviewView;
```

- [ ] **Step 1: Write the exhaustive selector tests**

Create a table covering:

- initial loading;
- session-recovery loading;
- zero and positive values;
- zero/positive background refresh;
- blocking network error;
- cached positive and cached-zero stale error;
- manual retry retaining blocking/cached kind;
- `invalid_request` with `canRetry: false`;
- `invalid_response` with `canRetry: true`;
- repeated session control race mapped to generic manual recovery;
- cancellation ignored;
- unauthorized omitted because Home is gated away.

Use exact copy constants in the selector tests so the page and accessibility tests share one source of truth.

- [ ] **Step 2: Run selector tests and verify failure**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- src/components/home/due-review-view.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement the pure selector**

Define:

```ts
export type DueReviewViewInput = {
  stats: SRSStats | undefined;
  error: MobileApiError | null;
  isInitialPending: boolean;
  isFetching: boolean;
  sessionRecoveryPending: boolean;
  manualRetryPending: boolean;
};

const NETWORK_MESSAGE =
  'Vela couldn’t load your review count. Check your connection and try again.';
const GENERIC_MESSAGE = 'Vela couldn’t load your review count. Please try again.';
const STALE_MESSAGE = 'This count may be out of date.';
```

Implement:

```ts
export function selectDueReviewView(input: DueReviewViewInput): DueReviewView {
  const refreshing =
    input.isFetching &&
    input.stats !== undefined &&
    !input.manualRetryPending;

  if (input.sessionRecoveryPending) {
    if (input.stats === undefined) {
      return { kind: 'loading', recoveringSession: true };
    }
    if (input.stats.due_today === 0) {
      return { kind: 'zero', refreshing: false };
    }
    return {
      kind: 'positive',
      count: input.stats.due_today,
      refreshing: false,
    };
  }

  if (input.error && input.stats !== undefined) {
    return {
      kind: 'cached_error',
      count: input.stats.due_today,
      message: STALE_MESSAGE,
      retrying: input.manualRetryPending,
      canRetry: input.error.code !== 'invalid_request',
    };
  }

  if (input.error) {
    return {
      kind: 'blocking_error',
      message: input.error.code === 'network' ? NETWORK_MESSAGE : GENERIC_MESSAGE,
      retrying: input.manualRetryPending,
      canRetry: input.error.code !== 'invalid_request',
    };
  }

  if (input.stats?.due_today === 0) {
    return { kind: 'zero', refreshing };
  }

  if (input.stats && input.stats.due_today > 0) {
    return { kind: 'positive', count: input.stats.due_today, refreshing };
  }

  if (input.isInitialPending) {
    return { kind: 'loading', recoveringSession: false };
  }

  return {
    kind: 'blocking_error',
    message: GENERIC_MESSAGE,
    retrying: false,
    canRetry: true,
  };
}
```

Cancellation and unauthorized errors must be removed by the composable/gate before calling this selector.

- [ ] **Step 4: Replace the scaffold Home page**

Implement a focused surface:

```vue
<template>
  <q-page class="q-pa-lg">
    <section class="due-review" aria-labelledby="due-review-heading">
      <h1 id="due-review-heading" class="text-h5 text-weight-bold">
        Today’s review
      </h1>

      <div
        v-if="view.kind === 'loading'"
        role="status"
        aria-live="polite"
        class="text-center q-py-xl"
      >
        <q-spinner size="40px" color="primary" />
        <p class="q-mt-md">
          {{ view.recoveringSession ? 'Refreshing your session…' : 'Loading your review count…' }}
        </p>
      </div>

      <template v-else-if="view.kind === 'zero' || view.kind === 'positive'">
        <p class="due-review__count" aria-live="polite">
          {{ view.kind === 'zero' ? 0 : view.count }}
        </p>
        <p>
          {{
            view.kind === 'zero'
              ? 'You’re caught up for now.'
              : view.count === 1
                ? '1 word is due for review.'
                : `${view.count} words are due for review.`
          }}
        </p>
        <p v-if="view.refreshing" role="status" aria-live="polite">
          Refreshing review count…
        </p>
      </template>

      <div v-else role="alert">
        <template v-if="view.kind === 'cached_error'">
          <p class="due-review__count">{{ view.count }}</p>
        </template>
        <p>{{ view.message }}</p>
        <q-btn
          v-if="view.canRetry"
          color="primary"
          label="Retry"
          :loading="view.retrying"
          :disable="view.retrying"
          :aria-label="view.retrying ? 'Retrying review count' : 'Retry review count'"
          @click="retry"
        />
      </div>
    </section>
  </q-page>
</template>
```

Do not render app version, environment chip, M1 label, or Start Review.

- [ ] **Step 5: Replace Home component tests**

Keep the existing `QLayout`/`QPageContainer` host pattern. Mock `useDueReviewCount()` with reactive refs and cover:

- accessible loading and recovery loading;
- zero;
- singular and plural positive;
- background refresh retains count;
- blocking network error and Retry click;
- cached positive and zero errors retain count and stale warning;
- manual retry disables/loads button with correct aria label;
- invalid request has no Retry;
- no scaffold/version/environment/Start Review copy.

- [ ] **Step 6: Run selector and Home tests**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:unit -- \
  src/components/home/due-review-view.test.ts \
  src/pages/HomePage.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd $REPO_ROOT
git add \
  apps/vela-mobile/src/components/home/due-review-view.ts \
  apps/vela-mobile/src/components/home/due-review-view.test.ts \
  apps/vela-mobile/src/pages/HomePage.vue \
  apps/vela-mobile/src/pages/HomePage.test.ts
git commit -m "feat(mobile): show authenticated due count"
```

---

### Task 10: Run Merge Gates and Record the Closure Matrix

**Files:**

- Modify only if evidence requires it:
  - `docs/superpowers/plans/2026-07-30-mobile-authenticated-due-review-count.md` — check off completed steps during execution.
  - HPA-207 Linear issue — attach or comment the verification matrix.
  - Implementation PR body — summarize automated and Simulator evidence.

**Interfaces:**

- Produces no runtime interface.
- Produces merge-gate evidence and a clearly separated physical-device closure gate.

- [ ] **Step 1: Run focused package tests**

```bash
cd $REPO_ROOT/packages/common
bun run test:unit

cd $REPO_ROOT/apps/vela
bun vitest run src/services/srsService.test.ts

cd $REPO_ROOT/apps/vela-mobile
bun run test:unit
```

Expected: all PASS.

- [ ] **Step 2: Run mobile coverage**

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run test:coverage
```

Expected: PASS with line coverage at or above 95%.

- [ ] **Step 3: Run typecheck and lint**

```bash
cd $REPO_ROOT
bun run typecheck --filter=@vela/mobile
bun run lint --filter=@vela/common --filter=@vela/mobile --filter=@vela/app
```

Expected: both commands exit 0.

- [ ] **Step 4: Run a production mobile build**

```bash
cd $REPO_ROOT
VITE_MOBILE_API_URL=https://example.invalid/api/ \
VITE_COGNITO_USER_POOL_ID=us-east-1_example \
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=mobile-client \
VITE_COGNITO_OAUTH_DOMAIN=example.auth.us-east-1.amazoncognito.com \
VITE_AWS_REGION=us-east-1 \
bun run build:mobile
```

Expected: production Quasar build exits 0 and resolves `@vela/common` from source.

- [ ] **Step 5: Run repository hygiene checks**

```bash
cd $REPO_ROOT
bunx prettier --check \
  packages/common/src/contracts/srs.ts \
  packages/common/src/contracts/srs.test.ts \
  packages/common/src/keys.ts \
  packages/common/src/keys.test.ts \
  packages/common/src/index.ts \
  apps/vela/src/services/srsService.ts \
  apps/vela-mobile/src \
  apps/vela-mobile/quasar.config.ts \
  apps/vela-mobile/vitest.config.ts \
  CLAUDE.md
git diff --check
git status --short
```

Expected: Prettier and `git diff --check` pass; status contains only intentional implementation changes before the final commit.

- [ ] **Step 6: Verify the approximately 27-second bound under fake timers**

Run the dedicated latency test:

```bash
cd $REPO_ROOT/apps/vela-mobile
bun vitest run src/composables/useDueReviewCount.test.ts -t "bounds persistent network failure"
```

Expected: PASS, showing three eight-second attempts plus one-second and two-second retry delays settle within 27 seconds.

- [ ] **Step 7: Complete the iOS Simulator merge gate**

Use a configured development environment:

```bash
cd $REPO_ROOT/apps/vela-mobile
bun run dev:ios
```

Record:

```text
Scenario                 Result
Fresh sign-in            Home loads authenticated count
Relaunch restoration     No Google prompt; Home count loads
Positive due count       Matches web/API at recorded time
Zero due count           Shows 0 and "caught up for now"
Network failure          Blocking failure appears within documented bound
Retry                    Loads after connectivity restoration
Foreground resume        Refetch occurs
Rejected token           Home disappears; auth recovery appears
Sign-out                 Count disappears immediately
Account isolation        Later account never sees prior count
```

- [ ] **Step 8: Commit plan bookkeeping only**

Mark the completed checkboxes in this plan, then commit only the plan file:

```bash
cd $REPO_ROOT
git add docs/superpowers/plans/2026-07-30-mobile-authenticated-due-review-count.md
git commit -m "docs: record HPA-207 verification"
```

Do not stage generated Xcode files, environment files, build output, coverage HTML, or unrelated changes.

- [ ] **Step 9: Create the implementation PR body and open the draft PR**

```bash
cat > /tmp/hpa-207-pr-body.md <<'EOF'
## Summary

- add a shared validated SRS stats contract and user-scoped stats query key
- add generation-safe authenticated mobile feature requests with single-flight 401 recovery
- add bounded mobile API/SRS services and TanStack Query cache isolation
- replace the mobile Home scaffold with accessible due-count loading, success, failure, and retry states

## Validation

- `packages/common`: unit tests passed
- `apps/vela`: `srsService` tests passed
- `apps/vela-mobile`: unit suite and 95% coverage gate passed
- mobile typecheck and targeted lint passed
- production mobile build passed
- iOS Simulator verification matrix completed

## Closure gate

Physical-development-iPhone verification remains required before HPA-207 closes. It is not a merge gate for this implementation PR.

## Tracking

- Linear: HPA-207
- Design: PR #52
EOF

git push -u origin codex/hpa-207-mobile-due-review-count
gh pr create \
  --draft \
  --base main \
  --head codex/hpa-207-mobile-due-review-count \
  --title "feat(mobile): show authenticated due-review count" \
  --body-file /tmp/hpa-207-pr-body.md
```

- [ ] **Step 10: Complete the physical-iPhone closure gate after merge readiness**

On a configured development iPhone, repeat fresh sign-in, relaunch restoration, positive/zero count, network failure, retry, foreground resume, rejected token, and sign-out. Record device model, iOS version, build SHA, account, timestamp, API/web comparison value, and result on HPA-207.

Do not close HPA-207 until this evidence is attached, even if the implementation PR has merged.
