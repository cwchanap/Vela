# HPA-207: Authenticated Mobile Due-Review Count Vertical Slice

**Date:** 2026-07-30

**Linear:** [HPA-207](https://linear.app/cwchanap/issue/HPA-207/mobile-mvpm1-deliver-the-authenticated-due-review-count-vertical-slice)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Deliver the smallest production-shaped Vela Mobile product flow: a returning iOS user restores a secure Cognito session, reaches Home, and sees the current authenticated `due_today` value returned by `GET /api/srs/stats`.

This slice establishes reusable mobile boundaries for authenticated feature requests and user-scoped server-state caching without importing the web Home page or exposing Cognito tokens to feature components.

`due_today` is the API field name. Its current semantics are “due as of request time” (`next_review_date <= now`), not “scheduled within the current calendar day.” Home copy therefore says “caught up for now.”

## Current State

HPA-204 established the absolute mobile API base URL and approved Capacitor CORS behavior.

HPA-206 established the single mobile Cognito session owner. The mobile auth coordinator now:

- restores a Keychain-backed refresh credential during initialization;
- keeps ID and access tokens in process memory only;
- refreshes the active token bundle proactively and on app resume;
- verifies candidate sessions through `/api/auth/session` before exposing protected content;
- marks protected content usable only while a verified active bundle remains valid; and
- clears local session material during sign-out or terminal credential failure.

HPA-206 intentionally did not expose a general token accessor or authenticated feature client. HPA-207 introduces that feature-request boundary.

The API already exposes `GET /api/srs/stats`. It applies Cognito ID-token middleware and returns:

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

The web application owns an equivalent interface and a web-specific SRS service. `@vela/common` already owns the `srsKeys` factory, but `srsKeys.stats()` has no production callers and is not user-scoped. HPA-207 makes mobile the first production consumer of that key; it does not migrate the web stats card to TanStack Query.

The mobile app does not yet install TanStack Query, and Home still renders the M1 scaffold.

## Approved Decisions

| Area | Decision |
| --- | --- |
| Product scope | Display only the authenticated due-review count and required states |
| Backend | Reuse `GET /api/srs/stats` unchanged |
| Shared contract | Move the complete `SRSStats` response contract into `@vela/common` |
| Shared package scope | Update the `@vela/common` module header to cover query utilities and domain contracts |
| Query key | Include authenticated user ID in `srsKeys.stats()`; mobile is its first production consumer |
| Token ownership | ID tokens remain private to the mobile auth coordinator |
| Feature request surface | Add coordinator-owned authenticated requests; do not add `getIdToken()` |
| URL/header safety | Share a trailing-slash-preserving API URL builder and reject Authorization overrides case-insensitively |
| Response ordering | Return every non-401 response despite concurrent auth promotion; generation checks guard only 401-driven auth mutation |
| Stale 401 | A 401 from a superseded generation becomes `session_changed` and cannot mutate the replacement session |
| Current 401 | Share one refresh-or-cleanup decision per owner/generation across concurrent requests |
| Refresh failure | A transient shared refresh failure settles callers as `session_recovery_pending`; it never deletes a potentially valid durable credential or hangs the feature request |
| Timeout | Bound each feature transport attempt and final response-body read to 15 seconds; timeout is a retryable network failure |
| Server state | Install TanStack Query in Vela Mobile |
| Automatic retry | Retry only `network` and `server`, at most twice |
| Control-flow recovery | Silently retry one same-user `session_changed`/recoverable `session_unavailable` race; wait for auth recovery when already pending |
| Foreground/Home refresh | Refetch on native foreground and every Home mount, even when cached data is fresh |
| Manual retry | Track manual retry separately from background fetching |
| Cache isolation | Disable without usable identity, user-scope keys, and cancel then clear on sign-out/identity loss |
| Cached zero | Keep the stale-data warning because time or another client can make reviews due |
| Review navigation | Do not add Start Review |
| Device verification | Simulator/automated checks are merge gates; physical-iPhone evidence is an HPA-207 closure gate |
| Platform | Native iOS only for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract and parser;
- a user-scoped stats query key;
- a coordinator-owned authenticated request capability with typed failures;
- boundary-safe URL/header handling;
- generation-safe, single-flight 401 recovery;
- bounded feature transport and body consumption;
- a mobile JSON API client and SRS service;
- TanStack Query bootstrap and native focus integration;
- auth-driven query lifecycle and cache cleanup;
- a minimal Home due-count presentation;
- unit/component coverage for concurrency, timeout, retry, isolation, and view states; and
- Simulator and physical-device verification evidence.

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
Mobile API client manages cancellation/body timeout
                    |
                    v
Coordinator sends bounded request with current ID token
                    |
                    v
GET {VITE_MOBILE_API_URL}srs/stats
```

### One token owner and request contract

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

Observable non-HTTP outcomes:

| Outcome | Coordinator result |
| --- | --- |
| Invalid path | `invalid_request_path` before network activity |
| Caller supplies any Authorization case variant | `invalid_request_headers` before network activity |
| No usable session before dispatch | `session_unavailable` before network activity |
| One feature transport attempt exceeds 15 seconds | `request_timeout`; no auth mutation caused by the timeout itself |
| Caller aborts | Preserve caller cancellation |
| Other transport rejection | Propagate transport failure; no generation-based auth mutation |
| Stale-generation 401 | `session_changed`; replacement session untouched |
| Shared refresh attempt fails transiently | `session_recovery_pending`; HPA-206 retry state retained |

### Shared API URL normalization and Authorization ownership

Replace `sessionUrl()` with one coordinator-local boundary:

```ts
function normalizeMobileApiBaseUrl(apiUrl: string): URL;
function resolveMobileApiUrl(baseUrl: URL, relativePath: string): URL;
```

The normalized base removes search/hash and has exactly one trailing pathname `/`. `resolveMobileApiUrl()` accepts non-empty relative paths such as `auth/session` and `srs/stats` and rejects:

- absolute, scheme-relative, and every root-relative URL;
- backslash-prefixed/separated escape attempts;
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

### Feature transport timeout

Each actual feature fetch attempt receives the same 15-second network bound as existing auth network calls.

The coordinator merges the caller signal with an attempt-local controller:

- caller abort remains caller cancellation;
- attempt timer abort becomes `request_timeout`;
- timer/listener cleanup runs in `finally`;
- the timer covers dispatch through response headers; and
- retry after auth refresh gets a fresh attempt timer.

The timeout does not wrap the whole refresh-and-verify sequence. Existing Cognito refresh and `/auth/session` verification already have their own bounded operations. A feature caller waiting on shared recovery races that wait with its caller signal, but one caller abort never cancels recovery needed by peers.

### Response-arrival ordering

Generation is an auth-mutation guard, not a general response-freshness rule. A normal proactive/resume refresh promotes a bundle and increments generation; that must not discard valid data or feature errors returned by the prior verified token.

After transport settles:

1. If caller-aborted, preserve cancellation.
2. If transport rejected/timed out, propagate the corresponding failure without a generation-driven auth mutation.
3. If status is not 401, return `Response` unchanged regardless of generation.
4. Only for 401, compare captured owner/generation with current active session.
5. Stale 401 returns `session_changed` without mutation.
6. Current-generation 401 enters shared recovery.

| Response | Generation matches | Result |
| --- | --- | --- |
| 2xx | Yes or no | Return response |
| 4xx except 401 | Yes or no | Return response |
| 5xx | Yes or no | Return response |
| Transport failure | Yes or no | Propagate; no auth mutation |
| 401 | No | `session_changed`; no auth mutation |
| 401 | Yes | Shared refresh-or-cleanup decision |

Sign-out/data freshness is enforced by caller abort, TanStack cancellation, user-scoped keys, and cancel-then-clear isolation—not by discarding every old-generation HTTP response.

### Single-flight current-generation 401 recovery

Concurrent 401s for one active owner/generation share one decision:

```ts
type FeatureUnauthorizedRecoveryResult =
  | { kind: 'refreshed' }
  | { kind: 'terminal' }
  | { kind: 'retryable_failure' };

type FeatureUnauthorizedRecovery = {
  owner: ActiveSession;
  generation: number;
  promise: Promise<FeatureUnauthorizedRecoveryResult>;
};
```

Rules:

1. First current-generation 401 creates the recovery record.
2. Peers for the same owner/generation await it.
3. Caller abort detaches only that caller.
4. Existing `refreshPromise`/serialization remains the refresh single-flight mechanism.
5. At most one terminal cleanup runs for the generation.
6. The guarded record clears only after settlement.
7. After `refreshed`, each caller retries its own feature request once.
8. The feature retry captures the promoted generation and cannot recursively retry again.

Decision:

- join a refresh already in flight for the captured generation;
- otherwise refresh when the captured token expired in flight;
- otherwise treat rejection of a still-valid current token as terminal and clean up once.

| Shared result | Per-request result |
| --- | --- |
| `refreshed` | Retry own feature request once |
| `terminal` | Return own original/final 401 after cleanup |
| `retryable_failure` | Settle as `session_recovery_pending`; preserve credential and coordinator retry state |

### Soft refresh failure interaction

A feature waiter waits only for the current shared refresh attempt, never a later five-second automatic retry or user retry.

On transient refresh failure:

- HPA-206 retains `session_refresh_failed` and `retryAction: 'refresh'`;
- waiter settles as `session_recovery_pending`;
- no terminal cleanup or credential deletion occurs;
- if the prior session remains usable, content/cache remains and the existing auth-retry banner is visible;
- if unusable, the gate replaces Home with blocking auth recovery; and
- later successful auth retry triggers one due-count refetch.

### Shared SRS contract

Create `packages/common/src/contracts/srs.ts` with `SRSStats` and `parseSrsStats(value)`.

The parser requires non-negative integer count fields, a finite non-negative ease factor, accuracy from 0 through 100, and all required nested fields. Unknown fields are ignored.

The web SRS service imports/re-exports `SRSStats`, preserving its public type and direct loading behavior. Update `packages/common/src/index.ts` so its header describes query configuration, keys, domain contracts, and lightweight utilities.

### User-scoped stats key

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
// ['srs', 'stats', userId, jlpt]
```

The user ID is the cache correctness boundary; clearing is defense in depth. This slice changes only `stats`. Other SRS keys remain unscoped and must be revisited before mobile review uses them.

### Mobile API client and body timeout

Create `mobile-api-client.ts`:

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

export const MOBILE_FEATURE_BODY_TIMEOUT_MS = MOBILE_AUTH_NETWORK_TIMEOUT_MS; // 15_000
```

The client creates a caller-linked controller before invoking the coordinator. After the coordinator returns the final `Response`, it starts a fresh 15-second body-read timer and keeps it active until JSON consumption completes. Aborting that controller cancels a stalled/truncated body stream.

Classification:

| Outcome | Client code |
| --- | --- |
| Caller abort | Preserve cancellation |
| Coordinator `request_timeout` or body timeout | `network` |
| Invalid path/header | `invalid_request`; stable development diagnostic only, no path/header/token dump |
| Session codes | Preserve `session_unavailable`, `session_changed`, or `session_recovery_pending` |
| Final 401 | `unauthorized` |
| 403 | `forbidden` |
| Other non-2xx | `server` |
| Invalid JSON/stats | `invalid_response` |

Body timeout/caller cleanup removes timer and listeners. It does not cancel coordinator recovery already shared by peers.

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

`mobile-auth` boot creates/provides the coordinator, passes it directly to `provideMobileServices()`, then initializes. No cross-boot `inject()` and no QueryClient import in service provisioning.

### QueryClient bootstrap and wiring

Add `@vela/common` and `@tanstack/vue-query` to mobile.

```ts
export const mobileQueryClient = createQueryClient();

export default defineBoot(({ app }) => {
  app.use(VueQueryPlugin, { queryClient: mobileQueryClient });
});
```

Boot order:

```text
main
query
mobile-auth
capacitor-lifecycle (Capacitor only)
diagnostic-cold-entry (development only)
```

- auth isolation imports `mobileQueryClient`;
- Vue Query composables receive that instance through the plugin;
- lifecycle imports only `focusManager`;
- coordinator/SRS service use typed Vue injection for consumers; and
- service provisioning receives the coordinator directly.

### Due-count query and automatic retry

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
useQuery({
  queryKey: computed(() => srsKeys.stats(userId.value)),
  enabled: computed(() => sessionUsable.value && userId.value !== null),
  queryFn: ({ signal }) => fetchStatsWithSessionRaceRecovery(signal),
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: retryDueCountQuery,
});
```

Only network/server receive two automatic retries. Auth/control-flow, cancellation, authorization, invalid request, and invalid response do not.

### Session-race and pending-recovery query behavior

`fetchStatsWithSessionRaceRecovery()` captures user ID.

For `session_changed` or `session_unavailable`:

- if not aborted, same user remains authenticated, and session is usable, silently retry once;
- otherwise rethrow for gate/query enablement; and
- never exceed one silent control-flow retry per query execution.

If that retry also fails while Home remains usable, show generic blocking/cached failure with manual Retry. Never leave an empty, settled, invisible-error state.

For `session_recovery_pending`:

- do not immediately retry;
- with cache, select normal zero/positive content without a Home-specific error—the auth gate’s retry banner owns the recovery message;
- without cache, show accessible session-recovery loading;
- watch `sessionUsable`, user ID, `retryAction`, `operation`, and `errorCode`;
- after successful recovery for the same user (usable, idle, no retry/error), refetch once; and
- if auth becomes unusable, let the gate replace Home.

### Native foreground integration

Extend `capacitor-lifecycle`:

```ts
focusManager.setFocused(event.isActive);
```

Keep resume diagnostics. No polling/background task.

### Auth and cache isolation

Install once from `App.vue` with injected coordinator and imported `mobileQueryClient`.

1. Enable queries only with usable auth/user ID.
2. Usable-to-unusable stops data selection immediately.
3. Sign-out, terminal cleanup, or identity change cancels queries.
4. Remove cache only after cancellation settles.
5. Failed durable cleanup still leaves cache cleared.
6. Soft refresh failure retains cache while prior session is usable.
7. Backgrounding does not clear.

A non-401 may return after generation change; cancellation and canceled-query semantics prevent repopulation after identity loss.

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
- no data plus pending auth recovery -> recovery loading;
- pending auth recovery with cache -> zero/positive, no Home error;
- zero/positive remains during background fetch;
- retryable failure without/with cache -> blocking/cached error;
- `invalid_request` -> generic non-retryable defect;
- `invalid_response` -> generic manually retryable failure;
- repeated control-race failure while still usable -> generic manually retryable failure;
- cancellation -> no visible error;
- unauthorized -> gate removes Home.

Home copy/semantics:

- loading: “Loading your review count…” (`role=status`, polite live region);
- auth recovery: “Refreshing your session…”;
- zero: prominent `0`, “You’re caught up for now.”;
- positive: prominent count with singular/plural copy;
- background refresh: keep count, “Refreshing review count…”;
- blocking network failure: alert + Retry;
- cached failure, including cached `0`: keep count, “This count may be out of date.” + Retry;
- manual retry: preserve error surface and disable/loading Retry;
- invalid request defect: generic alert without misleading Retry;
- unauthorized: no Home message;
- no Start Review or scaffold version/environment content.

## Error Handling Summary

- **Non-401 during promotion:** return normally.
- **Stale 401:** `session_changed`, no cleanup; silent same-user retry once.
- **Concurrent current 401s:** one recovery decision; each request retries once or returns own final 401.
- **Transient refresh failure:** `session_recovery_pending`; preserve credential and retry state; settle promptly.
- **Transport/body timeout:** `network`; caller abort remains cancellation.
- **Invalid request:** dedicated feature code, stable dev diagnostic, non-retryable UI.
- **Invalid API payload:** `invalid_response`, not cached, safe generic copy.
- **Sign-out race:** cancel then clear; late non-401 cannot mutate auth, late 401 cannot clean replacement session.

## Testing Strategy

### Shared package

- Parse complete production response and reject invalid fields.
- Ignore unknown fields.
- Distinguish users/JLPT filters in stats key.
- Confirm package header covers contracts.
- Document that non-stats SRS keys remain unscoped.

### Auth coordinator

- Apply ID token to allowed path.
- Share URL builder across session/stats.
- Reject all path escape classes and `/api-evil/` boundary bypass.
- Reject every Authorization case variant.
- Reject without usable session.
- Caller abort versus attempt timeout are distinguishable.
- Transport failure does not trigger generation mutation.
- **In-flight 200 survives soft-refresh promotion.**
- **In-flight 500 survives soft-refresh promotion.**
- **In-flight 401 after promotion returns `session_changed` and does not clean new session.**
- Join an already-running refresh.
- Concurrent expired-token 401s start one refresh and each retry at most once.
- Concurrent valid-token 401s perform one cleanup.
- One caller abort does not cancel peer recovery.
- Transient shared refresh failure settles all waiters as `session_recovery_pending` without cleanup.
- Terminal result returns each final 401.
- Keep 403 feature-scoped and secrets out of errors/logs.

### Mobile API/SRS services

- Map every coordinator code, including `invalid_request` and timeout.
- Transport stall -> network.
- Body stall -> network.
- Caller abort -> cancellation.
- Timer/listener cleanup.
- Body timeout does not cancel peer auth recovery.
- Parse/validate JSON and classify HTTP/errors.
- Forward exact path/signal.
- Provision without cross-boot injection.

### Query/recovery/retry

- QueryClient singleton/plugin identity and boot order.
- Exact two-retry network/server predicate; all other codes false.
- First same-user `session_changed` silently retries once.
- Repeated control race produces visible manual recovery, never blank UI.
- Recoverable `session_unavailable` retries once.
- Pending recovery with cache retains count and uses auth banner.
- Pending recovery without cache shows recovery loading.
- Successful later auth retry refetches once.
- Unusable auth removes Home.

### Lifecycle/cache/UI

- Native focus updates and enabled-only refetch.
- Sign-out/terminal cleanup cancel before clear.
- Soft refresh failure retains usable cache.
- Identity change cannot select previous data.
- Manual/background flags are distinct.
- All loading, zero, positive, error, retry, stale, recovery, and defect states are accessible.
- Cached positive and zero both show stale warning after failed refetch.
- No Start Review/scaffold content.

## Manual Verification Matrix and Gates

| Scenario | Expected result |
| --- | --- |
| Fresh sign-in | Home fetches authenticated count |
| Relaunch restoration | Restores without another Google prompt |
| Positive/zero | Mobile agrees with web/API and renders correct copy |
| Network failure/retry | Safe retryable failure then successful Retry |
| Background/resume | Active transition refetches |
| Soft auth-refresh failure | Cached count remains if session usable; auth recovery can refetch |
| Rejected token | Home disappears and authentication is shown |
| Sign-out/account isolation | Data clears immediately; later account never sees it |
| iOS Simulator | Complete flow passes before implementation PR merge |
| Physical iPhone | Complete flow passes before HPA-207 closes |

Automated checks and Simulator flow are merge gates. Physical-device evidence is a closure gate: implementation may merge after merge gates pass, but HPA-207 remains open until device verification is recorded.

## Expected File Boundaries

### Shared

- Create: `packages/common/src/contracts/srs.ts`
- Create: `packages/common/src/contracts/srs.test.ts`
- Modify: `packages/common/src/keys.ts`
- Modify: `packages/common/src/keys.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/srsService.ts`
- Modify: `apps/vela/src/services/srsService.test.ts`

### Mobile boot/dependencies

- Modify: `apps/vela-mobile/package.json`
- Modify: `bun.lock`
- Create: `apps/vela-mobile/src/boot/query.ts`
- Create: `apps/vela-mobile/src/boot/query.test.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.ts`
- Modify: `apps/vela-mobile/src/boot/boot-files.test.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.test.ts`

### Auth/services

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.ts`
- Create: `apps/vela-mobile/src/services/mobile-services.test.ts`

### Query/presentation

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
| Restored user reaches Home | HPA-206 gate + enabled query |
| Home displays stats count | Mobile SRS service + selector |
| Rejected/expired token cannot leak another user’s data | 401-only generation guard, shared recovery, user key, cancellation, cache clear |
| Accessible loading/empty/failure/retry | Exhaustive view including auth recovery and manual retry |
| Sign-out clears user data | Cancel then clear |
| Count agrees with web/API | Manual matrix |
| Tests cover states/isolation | Concurrency, timeout, service, query, cache, UI suites |
| Simulator/device verification | Merge gate + closure gate |

## Risks and Mitigations

- **Successful response discarded during refresh:** return non-401 before generation comparison.
- **Duplicate refresh/cleanup:** one recovery promise per owner/generation.
- **Hanging feature request/body:** bounded transport attempts, bounded body read, bounded existing auth operations.
- **Transient refresh deletes credential:** settle as pending recovery; retain HPA-206 state/credential.
- **Previous-user cache flash:** user key, disable, cancel then clear.
- **Token/path leakage:** coordinator-owned bearer, header rejection, parsed path boundaries, secret-leak tests.
- **Scope expansion:** count/status only; review execution later.

## Implementation Sequence

1. Shared contract, package description, and user-scoped stats key.
2. URL/header boundary and bounded feature transport.
3. Non-401 ordering plus single-flight current-401 recovery.
4. API body timeout/error normalization and SRS service provisioning.
5. QueryClient boot, retry predicate, and native focus bridge.
6. Cache isolation and pending-auth-recovery refetch.
7. Composable control-race/manual-retry behavior and pure selector.
8. Home presentation/accessibility.
9. Simulator merge-gate and physical-device closure evidence.

Each stage must leave existing web authentication, web SRS loading, mobile OAuth restoration, and sign-out behavior unchanged except for the shared contract, package description, and stats-key signature.
