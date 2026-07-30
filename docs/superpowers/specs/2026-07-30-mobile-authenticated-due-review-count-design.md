# HPA-207: Authenticated Mobile Due-Review Count Vertical Slice

**Date:** 2026-07-30

**Linear:** [HPA-207](https://linear.app/cwchanap/issue/HPA-207/mobile-mvpm1-deliver-the-authenticated-due-review-count-vertical-slice)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Deliver the smallest production-shaped Vela Mobile product flow: a returning iOS user restores a secure Cognito session, reaches Home, and sees the authenticated `due_today` value returned by `GET /api/srs/stats`.

This slice establishes reusable mobile boundaries for authenticated feature requests and user-scoped server-state caching without importing the web Home page or exposing Cognito tokens to feature components.

`due_today` is the API field name. Its current semantics are “due as of request time” (`next_review_date <= now`), not “scheduled within the current calendar day.” Home therefore says “caught up for now.”

## Current State

HPA-204 established the absolute mobile API base URL and Capacitor CORS behavior.

HPA-206 established the single mobile Cognito session owner. The coordinator:

- restores a Keychain-backed refresh credential;
- keeps ID and access tokens in process memory only;
- refreshes proactively and on app resume;
- verifies candidates through `/api/auth/session` before exposing protected content;
- marks protected content usable only while a verified bundle remains valid; and
- clears local session material during sign-out or terminal credential failure.

HPA-206 intentionally did not expose a token accessor or general authenticated feature client. HPA-207 introduces that boundary.

The API already exposes `GET /api/srs/stats` through Cognito ID-token middleware and returns:

```ts
interface SRSStats {
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
```

The web app owns an equivalent interface and web-specific service. `@vela/common` owns `srsKeys`, but `srsKeys.stats()` has no production callers and is not user-scoped. Mobile becomes its first production consumer; this does not migrate the web stats card to TanStack Query.

The API verifier already accepts both web and mobile Cognito client audiences. `CLAUDE.md` still lists that prerequisite as outstanding; the implementation change set updates that stale documentation.

The mobile app does not install TanStack Query, does not alias `@vela/common` to source, and Home still renders the M1 scaffold.

## Approved Decisions

| Area | Decision |
| --- | --- |
| Product scope | Display only the authenticated due-review count and required states |
| Backend | Reuse `GET /api/srs/stats` unchanged |
| Shared contract | Move the complete `SRSStats` contract into `@vela/common` |
| Query key | Include authenticated user ID in `srsKeys.stats()`; mobile is its first production consumer |
| Token ownership | ID tokens remain private to `MobileAuthCoordinator` |
| Concurrency | Feature I/O runs outside `serialize()`/`operationTail`; only auth mutations enter the queue |
| Refresh observation | Never infer promotion from `queueRefresh(): Promise<void>` settlement; inspect explicit postconditions |
| Response ordering | Return every non-401 response despite concurrent session promotion |
| Stale 401 | A superseded-generation 401 cannot mutate the replacement session |
| Current 401 | Concurrent requests share one refresh-or-cleanup decision per owner/generation |
| Refresh failure | Transient/no-op refresh settles as pending recovery without deleting credentials or hanging callers |
| Timeout | One due-count query execution has an eight-second feature deadline |
| Retry | Retry only `network` and `server`, at most twice |
| Auth abstraction | Feature code consumes a stable session-capability selector, not raw auth operation/error fields |
| Module resolution | Mobile Quasar and Vitest alias `@vela/common` to source while retaining the workspace dependency |
| Cache isolation | User-scope keys; disable without a usable session; cancel then clear on sign-out/identity loss |
| Foreground/Home refresh | Refetch on native foreground and every Home mount |
| Manual retry | Track manual retry independently from background fetch |
| Cached zero | Keep stale-data warning because time or another client can make reviews due |
| Device verification | Automated/Simulator checks are merge gates; physical iPhone evidence is a closure gate |
| Review navigation | Do not add Start Review |
| Platform | Native iOS only for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract and parser;
- a user-scoped stats query key;
- a coordinator-owned authenticated request capability with typed failures;
- boundary-safe URL and header handling;
- feature I/O outside the auth mutation queue;
- explicit refresh observation and single-flight 401 recovery;
- bounded feature request and body consumption;
- a mobile JSON API client and SRS service;
- mobile source aliases for `@vela/common`;
- TanStack Query bootstrap and native focus integration;
- auth-driven query lifecycle and cache cleanup;
- a minimal accessible Home due-count presentation;
- tests for concurrency, timeouts, retries, isolation, and view states; and
- Simulator and physical-device evidence.

## Non-goals

- starting, resuming, or completing a review session;
- fetching individual due cards;
- user-scoping `srsKeys.due()`, `srsKeys.progress()`, or `srsKeys.allProgress()` in this slice;
- dashboard parity or web stats-card query migration;
- daily goals, streaks, mastery summaries, or learning shortcuts;
- persistent offline query storage, offline due-deck generation, connectivity plugins, polling, or background tasks;
- Android support;
- remote Cognito global sign-out;
- sharing the web Home presentation; and
- final navigation or visual polish.

## Architecture

### End-to-end flow

```text
MobileAuthCoordinator restores and verifies session
                    |
                    v
MobileAuthGate exposes authenticated routes
                    |
                    v
HomePage mounts useDueReviewCount()
                    |
                    v
TanStack Query uses srsKeys.stats(userId)
                    |
                    v
Mobile SRS service requests "srs/stats"
                    |
                    v
Mobile API client applies the feature deadline and consumes JSON
                    |
                    v
Coordinator sends a bounded request with the current ID token
                    |
                    v
GET {VITE_MOBILE_API_URL}srs/stats
```

### One token owner and public request contract

`apps/vela-mobile/src/services/mobile-auth.ts` remains the only owner of active Cognito token material.

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
  constructor(
    readonly code: MobileAuthenticatedApiRequestErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileAuthenticatedApiRequestError';
  }
}

export type MobileAuthCoordinator = {
  state: Readonly<MobileAuthState>;
  initialize(): Promise<void>;
  startSignIn(): Promise<void>;
  completeCallback(url: string): Promise<void>;
  retryCurrentOperation(): Promise<void>;
  requestAuthenticatedApi(request: MobileAuthenticatedApiRequest): Promise<Response>;
  signOut(): Promise<void>;
  dispose(): Promise<void>;
};
```

Feature code never receives an ID token. The coordinator constructs the request, owns `Authorization`, and performs transport through its injected fetch.

### Concurrency boundary: feature I/O is outside `operationTail`

`requestAuthenticatedApi()` is a public coordinator operation, but unlike `initialize()`, `startSignIn()`, callback completion, retry, sign-out, and disposal, it is **not** wrapped in `serialize()`.

The method:

1. synchronously validates the request and snapshots the active owner, generation, token, expiry, and user;
2. starts feature transport outside `operationTail`;
3. returns non-401 responses outside the auth queue; and
4. enters `serialize()` only through existing refresh or cleanup helpers when a current-generation 401 requires an auth mutation.

This prevents a slow feature request from head-of-line blocking auth operations. It also prevents the self-deadlock that would occur if a serialized feature request awaited `queueRefresh()`, whose work is itself chained onto `operationTail`.

Tests prove that a pending feature fetch does not block proactive refresh, sign-out, retry, or disposal, and that 401 recovery does not wait behind its own request.

### Shared API URL normalization and Authorization ownership

Replace `sessionUrl()` with one coordinator-local boundary:

```ts
function normalizeMobileApiBaseUrl(apiUrl: string): URL;
function resolveMobileApiUrl(baseUrl: URL, relativePath: string): URL;
```

The normalized base removes search/hash and has exactly one trailing pathname `/`. `resolveMobileApiUrl()` accepts non-empty relative paths such as `auth/session` and `srs/stats` and rejects:

- absolute, scheme-relative, and every root-relative URL;
- backslash-prefixed or backslash-separated escapes;
- raw or encoded traversal outside the base;
- different origins;
- pathnames outside the trailing-slash base boundary; and
- fragments.

With base `/api/`, `/api-evil/secret` is outside the boundary.

```ts
resolveMobileApiUrl(apiBaseUrl, 'auth/session');
resolveMobileApiUrl(apiBaseUrl, 'srs/stats');
```

Caller headers are normalized through `Headers`:

```ts
const headers = new Headers(request.init?.headers);
if (headers.has('authorization')) {
  throw new MobileAuthenticatedApiRequestError('invalid_request_headers');
}
headers.set('Authorization', `Bearer ${idToken}`);
```

Tests cover `Authorization`, lowercase, uppercase, and mixed-case variants.

### Feature transport and overall latency budget

The coordinator retains a 15-second safety cap for each physical feature fetch, matching existing auth network calls. The mobile API client additionally applies:

```ts
export const MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS = 8_000;
```

This deadline spans one complete query-function execution:

- initial feature transport;
- waiting for the current shared 401 recovery decision;
- the one permitted feature retry after verified promotion; and
- final response-body consumption.

The deadline is caller-local. If it expires while shared auth recovery is running, the feature caller detaches without cancelling recovery needed by peers and settles as `session_recovery_pending`. Otherwise expiry is `network`.

Each TanStack automatic retry receives a fresh eight-second execution budget. With two retries and the shared one-second then two-second retry delays, initial loading on a persistently dead network is bounded to approximately 27 seconds before the blocking error appears. This is the accepted user-facing bound for M1.

Caller cancellation remains cancellation, not timeout. Timer and abort-listener cleanup runs in `finally`.

### Response-arrival ordering

Generation is an auth-mutation guard, not a general response-freshness rule. A proactive or resume refresh promotes a new bundle and increments generation; that must not discard valid feature responses returned by the prior verified token.

After transport settles:

1. Preserve caller cancellation.
2. Propagate raw transport rejection or timeout without generation-driven auth mutation.
3. If status is not 401, return the `Response` regardless of generation.
4. Only for 401, compare the captured owner/generation with the current active session.
5. A stale 401 returns `session_changed` without mutation.
6. A current-generation 401 enters shared recovery.

| Response | Generation matches | Result |
| --- | --- | --- |
| 2xx | Yes or no | Return response |
| 4xx except 401 | Yes or no | Return response |
| 5xx | Yes or no | Return response |
| Transport rejection | Yes or no | Propagate; no auth mutation |
| 401 | No | `session_changed`; no auth mutation |
| 401 | Yes | Shared recovery decision |

Sign-out and data freshness are enforced by caller cancellation, TanStack cancellation, user-scoped keys, and cancel-then-clear—not by discarding every old-generation response.

### Explicit refresh observation

The existing `queueRefresh()` returns `Promise<void>` and may resolve without starting or completing a promotion. Its settlement is never interpreted as refresh success.

Feature 401 recovery uses a feature-specific observer:

```ts
type FeatureRefreshObservation =
  | { kind: 'promoted'; owner: ActiveSession; generation: number }
  | { kind: 'terminal' }
  | { kind: 'retryable_failure' }
  | { kind: 'superseded' };

async function observeFeatureRefresh(
  owner: ActiveSession,
  generation: number,
): Promise<FeatureRefreshObservation>;
```

`observeFeatureRefresh()` calls or joins `queueRefresh({ requireDue: false, owner, generation })`, then derives outcome from coordinator postconditions—not from promise fulfillment:

- `promoted`: a usable active session for the same user exists and `activeBundleGeneration > generation`;
- `superseded`: owner/generation changed without a verified same-user promotion, including sign-out, disposal, or identity replacement;
- `terminal`: terminal credential cleanup completed or entered its terminal cleanup-failure surface; and
- `retryable_failure`: generation did not advance and no terminal result exists, including app inactive, pending candidate, no-op guard, transient refresh/persist/verify failure, or retryable auth state.

This explicitly covers every silent `queueRefresh()` no-op path. A `superseded` outcome maps to `session_changed`; `retryable_failure` maps to `session_recovery_pending`.

### Single-flight current-generation 401 recovery

Concurrent 401s for one active owner/generation share one decision:

```ts
type FeatureUnauthorizedRecoveryResult =
  | { kind: 'refreshed' }
  | { kind: 'terminal' }
  | { kind: 'retryable_failure' }
  | { kind: 'superseded' };

type FeatureUnauthorizedRecovery = {
  owner: ActiveSession;
  generation: number;
  promise: Promise<FeatureUnauthorizedRecoveryResult>;
};
```

Rules:

1. The first current-generation 401 creates the guarded record outside `operationTail`.
2. Peers for the same owner/generation await the same promise.
3. Caller abort detaches only that caller.
4. Refresh work still uses `refreshPromise` and `serialize()` internally.
5. Terminal cleanup is enqueued once through `serialize()`.
6. The recovery record clears only after settlement.
7. After `refreshed`, each caller retries its own feature request once.
8. A feature retry captures the promoted generation and cannot recursively recover again.

Decision:

- join a refresh already in flight for the captured owner/generation;
- otherwise use `observeFeatureRefresh()` when the captured token expired in flight;
- otherwise treat rejection of a still-valid current token as terminal and enqueue one cleanup.

| Shared result | Per-request result |
| --- | --- |
| `refreshed` | Retry own feature request once |
| `terminal` | Return own original/final 401 after cleanup |
| `retryable_failure` | `session_recovery_pending`; preserve credentials and retry state |
| `superseded` | `session_changed`; do not mutate replacement state |

A feature waiter waits only for the current shared attempt, never a later automatic or user-initiated auth retry.

### Shared SRS contract and keys

Create `packages/common/src/contracts/srs.ts` with `SRSStats` and:

```ts
export function parseSrsStats(value: unknown): SRSStats;
```

The parser requires non-negative integer count fields, a finite non-negative ease factor, accuracy from 0 through 100, and all required nested fields. Unknown fields are ignored.

The web service imports and re-exports `SRSStats`, preserving its public type and direct loading behavior. Update the `@vela/common` header so the package describes query configuration, keys, domain contracts, and lightweight utilities.

Change only the stats key:

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
// ['srs', 'stats', userId, jlpt]
```

Add a comment immediately above `srsKeys.due`, `progress`, and `allProgress` stating that these keys remain identity-unscoped and must not be used for mobile user data until their identity/cache-isolation contract is redesigned. This makes the hazard visible at future call sites rather than only in tests.

### Mobile package resolution

Add `@vela/common` and `@tanstack/vue-query` as workspace dependencies of `@vela/mobile`.

Also modify both mobile configuration files:

```ts
// apps/vela-mobile/quasar.config.ts
'@vela/common': resolve(__dirname, '../../packages/common/src/index.ts')

// apps/vela-mobile/vitest.config.ts
'@vela/common': resolve(__dirname, '../../packages/common/src/index.ts')
```

The aliases ensure local `cd apps/vela-mobile && bun run test:unit`, Quasar development/build, and contract edits use current source instead of stale `packages/common/dist`. The workspace dependency remains authoritative for package ownership and Turbo dependency ordering.

### Mobile API client classification

Create `apps/vela-mobile/src/services/mobile-api-client.ts`:

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
  constructor(
    readonly code: MobileApiErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileApiError';
  }
}
```

| Outcome | Client code |
| --- | --- |
| Caller abort | Preserve cancellation |
| `request_timeout` or feature deadline | `network`, unless shared auth recovery is pending |
| Raw non-abort fetch rejection, including `TypeError` | `network` |
| Invalid path/header | `invalid_request`; stable development diagnostic without request/token data |
| Session coordinator codes | Preserve `session_unavailable`, `session_changed`, or `session_recovery_pending` |
| Final 401 | `unauthorized` |
| 403 | `forbidden` |
| Other non-2xx | `server` |
| Invalid JSON/stats payload | `invalid_response` |

The client forwards one caller signal, enforces the eight-second execution deadline, reads JSON within the remaining deadline, and removes timers/listeners in `finally`.

### Mobile SRS service and provisioning

Create `mobile-srs.ts`:

```ts
export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};
```

`getStats()` calls `srs/stats`, forwards the signal, and validates with `parseSrsStats()`.

Create `mobile-services.ts` with typed injection keys and:

```ts
export function provideMobileServices(
  app: App,
  coordinator: MobileAuthCoordinator,
): void;
```

`mobile-auth` boot creates/provides the coordinator, passes it directly to `provideMobileServices()`, then initializes. Service provisioning does not use cross-boot `inject()` and does not import the QueryClient.

### QueryClient bootstrap and boot order

Create:

```ts
export const mobileQueryClient = createQueryClient();

export default defineBoot(({ app }) => {
  app.use(VueQueryPlugin, { queryClient: mobileQueryClient });
});
```

Boot order becomes:

```text
main
query
mobile-auth
capacitor-lifecycle (Capacitor only)
diagnostic-cold-entry (development only)
```

- auth isolation imports `mobileQueryClient`;
- Vue Query composables receive the same instance through the plugin;
- lifecycle imports only `focusManager`;
- coordinator and SRS service use typed Vue injection for consumers; and
- service provisioning receives the coordinator directly.

### Stable feature-session selector

Feature code does not inspect raw `operation`, `retryAction`, or `errorCode` fields.

Create an auth-owned pure selector:

```ts
export type MobileFeatureSessionStatus =
  | { kind: 'usable'; userId: string }
  | { kind: 'recovering'; userId: string; sessionUsable: boolean }
  | { kind: 'unavailable' };

export function selectMobileFeatureSessionStatus(
  state: Readonly<MobileAuthState>,
): MobileFeatureSessionStatus;
```

The selector alone understands the auth state machine:

- ordinary verified idle state -> `usable`;
- refresh/persist/verify operation or retry state for an authenticated user -> `recovering`, preserving whether the prior verified session remains usable;
- restoration, sign-out, cleanup, terminal state, or missing user -> `unavailable`.

`useDueReviewCount()` watches this semantic status. A transition from same-user `recovering` to `usable` triggers one refetch. This keeps the dependency one-directional without introducing a feature-specific event API into the coordinator.

### Due-count query and recovery behavior

```ts
const DUE_COUNT_RETRY_LIMIT = 2;

export function retryDueCountQuery(failureCount: number, error: unknown): boolean {
  return (
    error instanceof MobileApiError &&
    (error.code === 'network' || error.code === 'server') &&
    failureCount < DUE_COUNT_RETRY_LIMIT
  );
}
```

```ts
const queryEnabled = computed(
  () =>
    sessionStatus.value.kind === 'usable' ||
    (sessionStatus.value.kind === 'recovering' && sessionStatus.value.sessionUsable),
);

useQuery({
  queryKey: computed(() =>
    srsKeys.stats(sessionStatus.value.kind === 'unavailable' ? null : sessionStatus.value.userId),
  ),
  enabled: queryEnabled,
  queryFn: ({ signal }) => fetchStatsWithSessionRaceRecovery(signal),
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: retryDueCountQuery,
});
```

`fetchStatsWithSessionRaceRecovery()` captures user ID.

For `session_changed` or a dispatch-time `session_unavailable` race:

- if not aborted, the selector still reports the same user as usable, silently retry once;
- otherwise rethrow and let query enablement/the gate resolve the state; and
- never exceed one silent control-flow retry per query execution.

If the silent retry repeats while Home remains usable, show a generic manual-recovery error. Never leave an empty, settled, invisible-error state.

For `session_recovery_pending` while the prior session is still usable:

- do not immediately retry;
- with cache, keep normal zero/positive content and let the auth gate/banner own recovery messaging;
- without cache, show accessible session-recovery loading;
- watch only `MobileFeatureSessionStatus`;
- after same-user `recovering -> usable`, refetch once; and
- if the selector becomes unavailable or recovering-but-unusable, disable the query and let the gate replace Home.

### Native foreground integration and cache isolation

Extend `capacitor-lifecycle`:

```ts
focusManager.setFocused(event.isActive);
```

Keep existing resume diagnostics. Add no polling or background task.

Install auth/cache isolation once from `App.vue` using the injected coordinator and imported `mobileQueryClient`:

1. Enable authenticated queries only for `usable` or `recovering` with `sessionUsable: true`.
2. Sign-out, terminal cleanup, unusable recovery, or identity change cancels in-flight queries.
3. Await cancellation before cache removal for sign-out, terminal cleanup, or identity change.
4. Failed durable cleanup still leaves cache cleared.
5. Soft refresh failure retains cached data only while the prior session remains usable.
6. Backgrounding does not clear.

A non-401 may return after generation promotion; canceled-query semantics and user-scoped keys prevent repopulation after identity loss.

### Manual retry, view selector, and Home

The composable owns `manualRetryPending`:

```ts
retrying = manualRetryPending;
refreshing = query.isFetching && query.data !== undefined && !manualRetryPending;
```

```ts
type DueReviewView =
  | { kind: 'loading'; recoveringSession: boolean }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | { kind: 'blocking_error'; message: string; retrying: boolean; canRetry: boolean }
  | { kind: 'cached_error'; count: number; message: string; retrying: boolean; canRetry: boolean };
```

Rules:

- initial no-data fetch -> loading;
- no data plus usable pending auth recovery -> recovery loading;
- usable pending recovery with cache -> zero/positive, no Home-specific error;
- zero/positive remains during background fetch;
- retryable failure without/with cache -> blocking/cached error;
- `invalid_request` -> generic non-retryable defect;
- `invalid_response` -> generic manually retryable failure;
- repeated control race while usable -> generic manually retryable failure;
- caller cancellation -> no visible error; and
- unauthorized/unusable auth -> gate removes Home.

Home copy and semantics:

- loading: “Loading your review count…” with `role="status"` and polite live region;
- auth recovery: “Refreshing your session…”;
- zero: prominent `0`, “You’re caught up for now.”;
- positive: prominent count with singular/plural copy;
- background refresh: keep count, “Refreshing review count…”;
- blocking network failure: alert plus Retry;
- cached failure, including cached `0`: keep count, “This count may be out of date.” plus Retry;
- manual retry: preserve the error surface and disable/load Retry;
- invalid request defect: generic alert without misleading Retry;
- unauthorized: no Home-specific message; and
- no Start Review or scaffold version/environment content.

## Testing Strategy

### Shared package and configuration

- Parse complete production response and reject invalid fields.
- Ignore unknown fields.
- Distinguish users and JLPT filters in the stats key.
- Add and review the source warning immediately beside the identity-unscoped sibling SRS keys; do not add a brittle test that asserts comment text.
- Confirm `@vela/common` source aliases in mobile Quasar and Vitest config.
- Run mobile tests from `apps/vela-mobile` without a prebuilt `packages/common/dist`.
- Confirm the common package header covers domain contracts.

### Auth coordinator and concurrency

- Apply ID token to allowed path.
- Share URL builder across session and stats.
- Reject all escape classes and `/api-evil/` boundary bypass.
- Reject every Authorization case variant.
- Reject without usable session.
- Caller abort and timeout are distinguishable.
- Raw transport rejection does not trigger generation mutation.
- In-flight 200 survives soft-refresh promotion.
- In-flight 500 survives soft-refresh promotion.
- In-flight 401 after promotion returns `session_changed` without cleaning the new session.
- `queueRefresh()` no-op while app inactive yields `retryable_failure`, not `refreshed`.
- Pending-candidate no-op yields `retryable_failure`.
- Verified same-user generation advance yields `promoted`.
- Sign-out or identity replacement while waiting yields `superseded`.
- Invalid grant/terminal cleanup yields `terminal`.
- Join an already-running refresh.
- Concurrent expired-token 401s start one refresh and each retry at most once.
- Concurrent valid-token 401s perform one cleanup.
- One caller abort does not cancel peer recovery.
- A pending feature fetch does not block auth operations through `operationTail`.
- 401 recovery cannot self-deadlock behind the feature request.
- Keep 403 feature-scoped and secrets out of logs/errors.

### API/SRS service and latency

- Map every coordinator code.
- Raw fetch `TypeError` -> `network`.
- Feature deadline without auth recovery -> `network`.
- Feature deadline during shared auth recovery -> `session_recovery_pending`.
- Caller abort -> cancellation.
- Timer/listener cleanup.
- Deadline does not cancel peer auth recovery.
- Parse/validate JSON and classify HTTP errors.
- Forward exact path and signal.
- Verify three failed network attempts plus retry delays remain within the documented approximately 27-second bound under fake timers.
- Provision without cross-boot injection.

### Query, lifecycle, cache, and UI

- QueryClient singleton/plugin identity and boot order.
- Exact two-retry network/server predicate; all other codes false.
- Query is disabled for `unavailable` and `recovering` with `sessionUsable: false`.
- First same-user session race silently retries once.
- Repeated race produces visible manual recovery, never blank UI.
- Usable pending recovery with cache retains count.
- Usable pending recovery without cache shows recovery loading.
- Same-user `recovering -> usable` refetches once.
- Composable does not inspect raw auth operation/retry/error fields.
- Native focus updates and enabled-only refetch.
- Sign-out/terminal cleanup cancel before clear.
- Soft refresh failure retains cache only while session remains usable.
- Identity change cannot select previous data.
- Manual/background flags are distinct.
- All loading, zero, positive, error, retry, stale, recovery, and defect states are accessible.
- Cached positive and zero both show stale warning after failed refetch.
- No Start Review or scaffold content.

## Manual Verification Matrix and Gates

| Scenario | Expected result |
| --- | --- |
| Fresh sign-in | Home fetches authenticated count |
| Relaunch restoration | Restores without another Google prompt |
| Positive/zero | Mobile agrees with web/API and renders correct copy |
| Network failure/retry | Blocking failure appears within the documented bound; Retry succeeds after restoration |
| Background/resume | Active transition refetches |
| Soft auth-refresh failure | Cached count remains if usable; later auth recovery refetches |
| Rejected token | Home disappears and authentication is shown |
| Sign-out/account isolation | Data clears immediately; a later account never sees it |
| iOS Simulator | Complete flow passes before implementation PR merge |
| Physical iPhone | Complete flow passes before HPA-207 closes |

Automated checks and Simulator flow are merge gates. Physical-device evidence is a closure gate: implementation may merge after merge gates pass, but HPA-207 remains open until device verification is recorded.

## Expected File Boundaries

### Shared and repository documentation

- Create: `packages/common/src/contracts/srs.ts`
- Create: `packages/common/src/contracts/srs.test.ts`
- Modify: `packages/common/src/keys.ts`
- Modify: `packages/common/src/keys.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/srsService.ts`
- Modify: `apps/vela/src/services/srsService.test.ts`
- Modify: `CLAUDE.md`

### Mobile dependencies, configuration, and boot

- Modify: `apps/vela-mobile/package.json`
- Modify: `bun.lock`
- Modify: `apps/vela-mobile/quasar.config.ts`
- Modify: `apps/vela-mobile/vitest.config.ts`
- Create: `apps/vela-mobile/src/boot/query.ts`
- Create: `apps/vela-mobile/src/boot/query.test.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.test.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.test.ts`

### Auth and services

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Create: `apps/vela-mobile/src/auth/mobile-feature-session-status.ts`
- Create: `apps/vela-mobile/src/auth/mobile-feature-session-status.test.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.test.ts`

### Query and presentation

- Create: `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts`
- Create: `apps/vela-mobile/src/services/mobile-query-auth-isolation.test.ts`
- Modify: `apps/vela-mobile/src/App.vue`
- Modify: `apps/vela-mobile/src/App.test.ts`
- Create: `apps/vela-mobile/src/composables/useDueReviewCount.ts`
- Create: `apps/vela-mobile/src/composables/useDueReviewCount.test.ts`
- Create: `apps/vela-mobile/src/components/home/due-review-view.ts`
- Create: `apps/vela-mobile/src/components/home/due-review-view.test.ts`
- Modify: `apps/vela-mobile/src/pages/HomePage.vue`
- Modify: `apps/vela-mobile/src/pages/HomePage.test.ts`

## Acceptance Mapping

| Criterion | Coverage |
| --- | --- |
| Restored user reaches Home | HPA-206 gate plus enabled query |
| Home displays stats count | Mobile SRS service plus selector |
| Rejected/expired token cannot leak another user’s data | 401-only generation guard, explicit recovery outcome, user key, cancellation, cache clear |
| Accessible loading/empty/failure/retry | Exhaustive view including auth recovery and manual retry |
| Signing out clears user data | Cancel then clear |
| Count agrees with web/API | Manual matrix |
| Tests cover states/isolation | Concurrency, no-op refresh, timeout, service, query, cache, and UI suites |
| Simulator/device verification | Merge gate plus closure gate |

## Risks and Mitigations

- **Refresh promise resolves without promotion:** derive the result from owner/generation/state postconditions.
- **Feature request blocks or deadlocks auth:** keep feature I/O outside `operationTail`; serialize mutations only.
- **Successful response discarded during refresh:** return non-401 before generation comparison.
- **Duplicate refresh/cleanup:** one recovery record per owner/generation.
- **Long invisible loading:** eight-second execution budgets and an approximately 27-second total retry bound.
- **Transient refresh deletes credential:** settle as pending recovery and retain HPA-206 state.
- **Stale common build in per-app workflow:** alias mobile build/tests to current common source.
- **Auth state machine leaks into feature code:** expose a stable auth-owned session-capability selector.
- **Previous-user cache flash:** user key, disable, cancel then clear.
- **Token/path leakage:** coordinator-owned bearer, header rejection, parsed path boundaries, secret-leak tests.
- **Scope expansion:** count and status only; review execution later.

## Implementation Sequence

1. Shared contract, package description, stats key, sibling-key warning, and stale repository documentation.
2. Mobile common-source aliases and QueryClient dependency/bootstrap.
3. URL/header boundary and feature transport outside `operationTail`.
4. Explicit refresh observation, non-401 ordering, and single-flight current-401 recovery.
5. API execution deadline, raw transport classification, body parsing, and SRS provisioning.
6. Stable feature-session selector, retry policy, native focus, and cache isolation.
7. Composable control-race, pending-recovery, and manual-retry behavior.
8. Pure view selector and Home accessibility states.
9. Simulator merge-gate and physical-device closure evidence.

Each stage must leave existing web authentication, web SRS loading, mobile OAuth restoration, and sign-out behavior unchanged except for the shared contract, package description, stats-key signature, and corrected repository documentation.