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
| Shared package scope | Update the `@vela/common` module header so it describes shared query utilities and contracts rather than `@vela/query` only |
| Query key | Change `srsKeys.stats()` to include authenticated user ID; mobile is its first production consumer |
| Token ownership | ID tokens remain private to the mobile auth coordinator |
| Feature request surface | Add a coordinator-owned authenticated request operation; do not add `getIdToken()` |
| Coordinator failures | Use stable typed failures for invalid path, invalid Authorization header, unavailable session, changed session, and pending session recovery |
| URL safety | Use one trailing-slash-preserving API URL builder for `/auth/session` and feature paths |
| Header ownership | Reject caller-supplied `Authorization` headers case-insensitively |
| Response ordering | Return every non-401 response regardless of a concurrent auth-generation change; generation checks guard only 401-driven auth mutation |
| Stale 401 | A 401 from a superseded generation returns `session_changed` and cannot mutate the replacement session |
| Current 401 | Share one refresh-or-cleanup decision per auth generation across concurrent requests |
| Expiry race | If the request token expires in flight, refresh and retry that feature request once |
| Refresh failure | A transient shared refresh failure returns promptly as `session_recovery_pending`; it never deletes a potentially valid durable credential or leaves callers hanging |
| Feature timeout | Apply a 15-second timeout to the complete JSON request, including body consumption; timeout is a retryable network failure |
| Server state | Install TanStack Query in Vela Mobile |
| Automatic retry | Retry only `network` and `server` errors, at most twice |
| Control-flow recovery | Silently retry one `session_changed`/recoverable `session_unavailable` race for the same usable user; wait for auth recovery when it is already pending |
| Foreground refresh | Bridge native app active state to TanStack Query focus state |
| Home re-entry | Refetch whenever Home mounts, even if cached data is still fresh |
| Manual retry | Track manual retry separately from background fetching |
| Cache isolation | Disable immediately when auth is unusable, user-scope keys, and clear query state on sign-out or identity loss |
| Cached zero | A cached zero keeps the stale-data warning because time or another client can make reviews due |
| Review navigation | Do not add a Start Review action in HPA-207 |
| Device verification | Simulator/automated checks are merge gates; physical-iPhone verification is an HPA-207 closure gate before the Linear issue moves to Done |
| Platform | Native iOS remains the authenticated runtime for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract and parser;
- a user-scoped stats query key;
- a coordinator-owned authenticated request capability with an explicit failure contract;
- a boundary-safe mobile API URL builder;
- generation-safe, single-flight 401 recovery;
- a mobile JSON API client with full-request timeout and normalized failures;
- a mobile SRS stats service;
- TanStack Query bootstrap;
- native foreground-to-query-focus integration;
- auth-driven query lifecycle and cache cleanup;
- a minimal Home due-count presentation;
- unit/component tests for services, concurrency, timeout, retry policy, query behavior, auth isolation, and view states; and
- Simulator and physical-device verification evidence.

## Non-goals

- starting, resuming, or completing a review session;
- fetching individual due cards;
- user-scoping `srsKeys.due()`, `srsKeys.progress()`, or `srsKeys.allProgress()` in this slice;
- dashboard parity with the web application;
- migrating the web SRS stats card to TanStack Query;
- daily goals, streaks, mastery summaries, or learning shortcuts;
- persistent offline query storage or offline due-deck generation;
- a new connectivity plugin, background polling, or background tasks;
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
Mobile API client applies full-request timeout
                    |
                    v
Coordinator sends request with current in-memory ID token
                    |
                    v
GET {VITE_MOBILE_API_URL}srs/stats
```

### One token owner and explicit request failures

`apps/vela-mobile/src/services/mobile-auth.ts` remains the only owner of active Cognito token material.

The coordinator contract gains a request operation instead of a token accessor:

```ts
export type MobileAuthenticatedApiRequest = {
  path: string;
  init?: Omit<RequestInit, 'headers'> & {
    headers?: HeadersInit;
  };
};

export type MobileAuthenticatedApiRequestErrorCode =
  | 'invalid_request_path'
  | 'invalid_request_headers'
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

Feature code never receives an ID token. The coordinator constructs the request, owns `Authorization`, and performs the fetch through its injected transport.

The request operation has these observable non-HTTP outcomes:

| Outcome | Coordinator result |
| --- | --- |
| Invalid API path | Throw `invalid_request_path` before network activity |
| Caller supplies any case variant of `Authorization` | Throw `invalid_request_headers` before network activity |
| No usable current session before dispatch | Throw `session_unavailable` before network activity |
| Caller aborts | Preserve platform abort semantics; do not mutate auth state |
| Transport rejects | Propagate the transport failure; do not perform generation-based auth mutation |
| A stale-generation 401 arrives | Throw `session_changed`; do not mutate the replacement session |
| Shared auth refresh fails transiently | Throw `session_recovery_pending` after the refresh attempt settles; do not wait for later automatic/manual auth retry |

### Shared API URL normalization and containment

Replace the narrow `sessionUrl()` string helper with one coordinator-local URL boundary used by both session verification and feature requests:

```ts
function normalizeMobileApiBaseUrl(apiUrl: string): URL;
function resolveMobileApiUrl(baseUrl: URL, relativePath: string): URL;
```

`normalizeMobileApiBaseUrl()`:

- parses the configured absolute API URL;
- removes search and hash components;
- normalizes the API pathname to exactly one trailing `/`; and
- preserves that trailing separator for boundary comparisons.

`resolveMobileApiUrl()` accepts a non-empty relative path such as `auth/session` or `srs/stats`. It rejects:

- absolute URLs;
- scheme-relative URLs;
- every root-relative path, including `/api/srs/stats`;
- backslash-prefixed or backslash-separated escape attempts;
- raw or percent-encoded traversal outside the API base pathname;
- a different resolved origin;
- a pathname outside the normalized trailing-slash API pathname; and
- URL fragments.

The comparison is parsed-origin and pathname-boundary aware. With base `/api/`, `/api-evil/secret` must fail.

Both requests use the same helper:

```ts
resolveMobileApiUrl(apiBaseUrl, 'auth/session');
resolveMobileApiUrl(apiBaseUrl, 'srs/stats');
```

### Case-insensitive Authorization ownership

HTTP header names are case-insensitive. The coordinator normalizes caller headers through `Headers` before inspection:

```ts
const headers = new Headers(request.init?.headers);
if (headers.has('authorization')) {
  throw new MobileAuthenticatedApiRequestError('invalid_request_headers');
}
headers.set('Authorization', `Bearer ${idToken}`);
```

Tests cover lower-, upper-, canonical-, and mixed-case variants.

### Response-arrival ordering

Generation is an auth-mutation guard, not a general response-freshness rule. A proactive or resume refresh normally promotes a new bundle and increments `activeBundleGeneration`; that must not discard a valid response produced by the prior verified token.

After the feature transport settles:

1. If the caller signal is aborted, preserve abort semantics and stop.
2. If the transport rejected, propagate the rejection without inspecting generation or mutating auth.
3. If the HTTP status is not 401, return the `Response` unchanged, even when owner/generation changed while it was in flight.
4. Only for HTTP 401, compare captured owner/generation with the current active session.
5. If the 401 belongs to a superseded owner/generation, throw `session_changed` without auth mutation.
6. If the 401 belongs to the current generation, enter the single-flight recovery contract below.

Decision table:

| Response | Generation matches | Result |
| --- | --- | --- |
| 2xx | Yes or no | Return response |
| 4xx other than 401 | Yes or no | Return response |
| 5xx | Yes or no | Return response |
| Transport rejection | Yes or no | Propagate; no auth mutation |
| 401 | No | Throw `session_changed`; no auth mutation |
| 401 | Yes | Shared refresh-or-cleanup decision |

Data freshness after sign-out or identity loss is enforced by caller abort, TanStack cancellation, user-scoped keys, and cancel-then-clear cache isolation—not by discarding every old-generation HTTP response.

### Single-flight current-generation 401 recovery

Concurrent requests can receive 401 from the same generation. They must share one auth decision.

The coordinator keeps one in-flight recovery record keyed by active session owner and generation:

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

1. The first current-generation 401 creates the recovery promise.
2. Peer 401s for the same owner/generation await that promise.
3. A caller abort detaches only that caller; it does not cancel the shared auth refresh/cleanup needed by peers.
4. At most one refresh grant starts for the generation. The existing `refreshPromise`/serialized refresh path remains the refresh single-flight mechanism.
5. At most one terminal cleanup starts for the generation.
6. The recovery entry is cleared only when its guarded promise settles.
7. Every caller retries its own feature HTTP request at most once after a `refreshed` result.
8. A feature retry captures the promoted owner/generation and cannot recursively initiate another feature retry.

The recovery decision is:

- If a refresh for the captured generation is already in flight, join it even if the captured token had not yet crossed local expiry.
- Otherwise, if the captured ID token expired in flight, start/join the existing refresh path.
- Otherwise, a still-valid current token was rejected without an active refresh explanation; perform terminal cleanup once.

Recovery outcomes:

| Shared result | Per-request behavior |
| --- | --- |
| `refreshed` | Retry that feature request once with the promoted verified session |
| `terminal` | Return that request’s original/final 401 after cleanup for `unauthorized` classification |
| `retryable_failure` | Throw `session_recovery_pending` promptly; preserve the coordinator’s HPA-206 retry state and durable credential |

### Interaction with soft refresh failure

A feature request waits only for the current shared refresh attempt to settle. It never remains pending until a later five-second automatic retry or user-triggered auth retry.

When the shared refresh fails transiently:

- HPA-206 retains `session_refresh_failed` and `retryAction: 'refresh'`;
- the feature waiter throws `session_recovery_pending`;
- no terminal cleanup runs;
- no refresh token is deleted;
- if the prior verified token remains usable, `MobileAuthGate` keeps content visible with its existing auth-retry banner;
- if the prior token is no longer usable, the gate replaces Home with blocking auth recovery; and
- a later successful auth retry causes the due-count composable to refetch once.

This preserves HPA-206’s fail-safe credential semantics while guaranteeing the feature request settles.

### Shared SRS contract

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

export function parseSrsStats(value: unknown): SRSStats;
```

The parser requires non-negative integer count fields, a finite non-negative ease factor, accuracy from 0 through 100, and every required nested field. Unknown fields are ignored.

The web SRS service imports and re-exports `SRSStats`, preserving its public type while removing the duplicate contract. The web card continues direct-service loading.

Update the `packages/common/src/index.ts` header so it describes query configuration, query keys, domain contracts, and lightweight utilities rather than `@vela/query` only.

### User-scoped stats key

Change the shared factory to:

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
```

It produces:

```ts
['srs', 'stats', userId, jlpt]
```

HPA-207 supplies the authenticated `MobileAuthUser.userId` and no JLPT filter. User identity in the key is the cache correctness boundary; cache clearing is defense in depth.

This slice scopes only `stats`. `srsKeys.due()`, `srsKeys.progress()`, and `srsKeys.allProgress()` remain unchanged and must be revisited before the mobile review flow uses them.

### Mobile API client and full-request timeout

Create `apps/vela-mobile/src/services/mobile-api-client.ts`.

```ts
export type MobileApiErrorCode =
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

export const MOBILE_FEATURE_REQUEST_TIMEOUT_MS = MOBILE_AUTH_NETWORK_TIMEOUT_MS; // 15_000
```

The client owns the timeout because it also consumes the JSON body. A coordinator timer cleared when headers arrive would not protect against a stalled or truncated response body.

For each JSON request, the client:

1. creates an internal `AbortController`;
2. forwards caller abort to it;
3. starts the 15-second timeout;
4. delegates transport to the coordinator with the internal signal;
5. reads the complete response body;
6. parses/validates the result; and
7. clears the timer and abort listener in `finally`.

Classification:

| Outcome | Client classification |
| --- | --- |
| Caller abort | Preserve cancellation; no visible error |
| Timeout during transport or body read | `network` |
| `session_unavailable` | Same code |
| `session_changed` | Same code |
| `session_recovery_pending` | Same code |
| Invalid path/header | `invalid_response`; in development log only a stable defect code, never headers/tokens/raw response |
| Final 401 | `unauthorized` |
| 403 | `forbidden` |
| Other non-2xx | `server` |
| Invalid JSON/stats shape | `invalid_response` |

Timeout abort must not cancel a shared coordinator auth-recovery promise; it only stops that feature caller from waiting and prevents its feature retry/body read.

### Mobile SRS service and provisioning

Create `apps/vela-mobile/src/services/mobile-srs.ts`:

```ts
export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};
```

`getStats()` calls `srs/stats`, forwards the signal, and runs `parseSrsStats()`.

Create `mobile-services.ts` with typed injection keys and:

```ts
export function provideMobileServices(
  app: App,
  coordinator: MobileAuthCoordinator,
): void;
```

The existing `mobile-auth` boot creates/provides the coordinator, calls `provideMobileServices(app, coordinator)` directly, then starts initialization. `mobile-services.ts` does not use `inject()` and does not import the QueryClient.

### QueryClient bootstrap and wiring

Add `@vela/common` and `@tanstack/vue-query` to `@vela/mobile`.

Create `src/boot/query.ts`:

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

Wiring is explicit:

- auth isolation imports the `mobileQueryClient` singleton;
- Vue Query composables receive the same instance through `VueQueryPlugin`;
- native lifecycle imports only `focusManager`;
- coordinator and SRS service use typed Vue injection for components/composables; and
- service provisioning receives the coordinator directly rather than attempting cross-boot `inject()`.

### Due-count query and automatic retry policy

Create `useDueReviewCount.ts`.

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

The query uses:

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

Only network/server failures receive up to two TanStack retries. Auth/control-flow, authorization, cancellation, and validation failures do not.

### Session-race and pending-recovery query behavior

`fetchStatsWithSessionRaceRecovery(signal)` captures the current user ID and performs one service call.

For `session_changed` or `session_unavailable`:

- if the caller is not aborted, the same user is still authenticated, and `sessionUsable` is true, silently retry once;
- otherwise rethrow and allow the auth gate/query enablement to remove the content path; and
- never perform more than one silent control-flow retry per query execution.

If the one silent retry also returns a control-flow error while Home remains usable, it escapes to the selector as a safe generic blocking/cached failure with manual Retry. The view must never settle into an empty, non-fetching, non-error state.

For `session_recovery_pending`:

- do not immediately retry the feature request;
- retain cached count data if present;
- with no cached data, remain in an accessible loading/recovery state;
- watch the coordinator’s retry tuple (`sessionUsable`, user ID, `retryAction`, `operation`, and `errorCode`);
- when auth recovery later succeeds for the same user (`sessionUsable`, idle operation, no retry action/error), refetch once; and
- if auth becomes unusable, let `MobileAuthGate` replace Home.

This distinguishes a settled feature request from an auth recovery that continues independently.

### Native foreground integration

Extend `capacitor-lifecycle` to subscribe to `appStateChange`:

```ts
focusManager.setFocused(event.isActive);
```

Keep existing resume diagnostics. No polling or background task is added.

### Auth and cache isolation

Install `mobile-query-auth-isolation.ts` once from `App.vue` with the injected coordinator and imported `mobileQueryClient`.

Rules:

1. Queries enable only with usable auth and user ID.
2. Usable-to-unusable immediately stops authenticated data selection.
3. Sign-out start, terminal cleanup start, or identity change cancels in-flight queries.
4. Cache removal runs after cancellation settles.
5. Failed durable cleanup still leaves query data cleared.
6. Soft refresh failure does not clear while the prior verified session remains usable.
7. Ordinary backgrounding does not clear.

A non-401 response may legally return after a generation change; cancellation, abort propagation, and TanStack’s canceled-query semantics prevent it from repopulating removed cache state.

### Manual retry versus background refresh

The composable owns `manualRetryPending`.

`retry()` prevents concurrent manual retries, preserves the current error surface, sets `manualRetryPending`, awaits `query.refetch()`, and clears the flag in `finally`.

```ts
retrying = manualRetryPending;
refreshing = query.isFetching && query.data !== undefined && !manualRetryPending;
```

Automatic mount/focus refetch keeps cached content visible with a subtle refresh status. Manual retry keeps the prior error surface visible with a disabled/loading Retry button.

### Home view selector

Create a pure exhaustive selector:

```ts
type DueReviewView =
  | { kind: 'loading'; recoveringSession: boolean }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | { kind: 'blocking_error'; message: string; retrying: boolean; canRetry: boolean }
  | { kind: 'cached_error'; count: number; message: string; retrying: boolean; canRetry: boolean };
```

Rules:

- no data plus initial fetch produces `loading`;
- no data plus `session_recovery_pending` produces `loading` with `recoveringSession: true`;
- zero/positive data remain visible during background fetch;
- network/server/control-race failure with no data produces `blocking_error`;
- failed refetch with cached data, including `0`, produces `cached_error`;
- invalid request defects are generic and non-retryable;
- manual retry preserves the corresponding error kind with `retrying: true`;
- caller cancellation produces no visible error; and
- unauthorized is never a Home view because the gate removes authenticated content.

A cached zero retains the stale-data warning because due state changes with time and cross-client progress.

### Home presentation

Replace the scaffold with a focused “Today’s review” surface.

- **Loading:** “Loading your review count…” with `role="status"` and `aria-live="polite"`.
- **Session recovery without data:** “Refreshing your session…” with the same status semantics.
- **Zero:** prominent `0`; “You’re caught up for now.”
- **Positive:** prominent count with singular/plural copy.
- **Background refresh:** keep count visible; “Refreshing review count…” status.
- **Blocking network failure:** alert, connection-aware copy, Retry.
- **Cached failure:** keep count visible; “This count may be out of date.”; Retry.
- **Manual retry:** preserve error surface; disable/loading Retry; accessible label “Retrying review count.”
- **Non-retryable defect:** generic safe alert without a misleading Retry action.
- **Unauthorized:** no Home-specific message; auth gate replaces Home.

Do not add Start Review.

## Error Handling

### Non-401 response during refresh promotion

Return it normally. A generation change alone does not invalidate a successful or feature-level error response.

### Stale-generation 401

Return `session_changed` without cleanup. The composable silently retries once for the same usable user; if the race repeats, it presents a recoverable generic state rather than going blank.

### Concurrent current-generation 401

Share one refresh/cleanup decision. Peer requests wait on it, then each retries once after refresh or returns its own final 401 after terminal cleanup.

### Transient refresh failure

Return `session_recovery_pending` when the current refresh attempt settles. Preserve durable credentials and the coordinator retry state. Do not wait indefinitely for a later auth retry.

### Network timeout

The mobile API client aborts after 15 seconds across transport and body reading and classifies the timeout as `network`. Caller abort remains cancellation.

### Invalid request or API shape

Invalid caller path/header is a programmer defect: preserve a dedicated coordinator code, emit only a stable development diagnostic, show generic non-retryable copy, and never log token-bearing data. Invalid server JSON/stats is `invalid_response` and may be manually retried.

### Sign-out during request

Sign-out makes auth unusable, cancels query work, then clears cache. A late non-401 response does not mutate auth; cancellation prevents it from repopulating the canceled query. A late 401 cannot clean up a replacement generation.

## Testing Strategy

### Shared package

- Parse complete production response.
- Reject missing, negative, fractional, and non-finite required fields.
- Reject accuracy outside 0–100.
- Ignore unknown fields.
- Produce distinct stats keys for users/JLPT filters.
- Confirm package header includes contracts.
- Document that non-stats SRS keys remain unscoped.

### Auth coordinator

- Apply ID token to allowed relative path.
- Share URL builder between `auth/session` and `srs/stats`.
- Reject absolute, scheme-relative, root-relative, backslash, traversal, outside-prefix, and `/api-evil/` paths.
- Reject every case variant of Authorization before network activity.
- Reject dispatch without usable session.
- Preserve caller abort.
- Propagate transport rejection without generation mutation.
- **Return an in-flight 200 after concurrent soft-refresh promotion.**
- **Return an in-flight 500 after concurrent soft-refresh promotion.**
- **Return `session_changed` for an in-flight 401 after promotion without cleaning the new session.**
- Join an already-running refresh before deciding a current 401 is terminal.
- Concurrent expired-token 401s start one refresh and each feature request retries at most once.
- Concurrent still-valid-token 401s perform one terminal cleanup.
- One caller abort does not cancel shared recovery for peers.
- A transient shared refresh failure settles all waiters as `session_recovery_pending` without cleanup.
- A terminal shared result returns each request’s final 401.
- Keep 403 feature-scoped.
- Keep secrets out of logs/errors.

### Mobile API and SRS services

- Map every coordinator code.
- Transport stall times out as network.
- Response-body stall times out as network.
- Caller abort before timeout remains cancellation.
- Timeout/caller cleanup removes timer and signal listeners.
- Timeout of one caller does not cancel shared auth recovery.
- Parse successful JSON and validate full stats.
- Classify 401, 403, other non-2xx, invalid JSON, and invalid stats.
- Forward exact `srs/stats` path and signal.
- Provision services without cross-boot injection.

### Query, auth recovery, and retry policy

- QueryClient singleton and plugin use the same instance.
- Boot order is `main`, `query`, `mobile-auth`, then conditional boots.
- Retry predicate permits exactly two network/server retries and rejects all other codes.
- First `session_changed` for same usable user silently retries once.
- Repeated `session_changed` never leaves a blank state.
- Recoverable `session_unavailable` silently retries once after the same user becomes usable.
- `session_recovery_pending` with cache retains data and waits for auth recovery.
- `session_recovery_pending` without cache renders accessible recovery loading.
- Successful later auth retry triggers one due-count refetch.
- Auth becoming unusable removes Home instead of surfacing a feature error.

### Lifecycle, cache, and UI

- `focusManager` receives inactive/active transitions.
- Foreground refetch occurs only for enabled query.
- Sign-out/terminal cleanup cancel before clear.
- Failed durable cleanup still clears data.
- Soft refresh failure with usable session retains cache.
- Identity change cannot select previous-user data.
- Manual retry and background refresh use distinct flags.
- Loading, recovery loading, zero, singular, plural, blocking error, cached error, retrying, and non-retryable defect states are accessible.
- Cached positive and cached zero show stale warning after failed refetch.
- No Start Review or scaffold content.

## Manual Verification Matrix

Record account, build/environment, device, timestamp, comparison value, and result.

| Scenario | Expected result |
| --- | --- |
| Fresh sign-in | Google sign-in opens Home and fetches authenticated count |
| Relaunch restoration | Force-close/reopen restores without another Google prompt |
| Positive due count | Mobile matches web/API for same account and timestamp |
| Zero due count | Home shows `0` and caught-up copy |
| Network failure | Auth remains safe; retryable Home failure appears |
| Retry | Connectivity restoration plus Retry loads count |
| Background/resume | Returning active refetches count |
| Soft auth-refresh failure | Existing count remains when prior session is usable; auth retry can recover |
| Rejected token | Protected Home disappears and authentication is shown |
| Sign-out | Home data is removed immediately; relaunch remains signed out |
| Account isolation | Later sign-in never displays prior account count |
| iOS Simulator | Complete flow passes before implementation PR merge |
| Physical development iPhone | Complete flow passes before HPA-207 is closed |

Automated checks and the configured Simulator flow are merge gates. The physical-iPhone run is a closure gate: implementation may merge after the merge gates pass, but HPA-207 must remain open until device evidence is recorded.

## Expected File Boundaries

### Shared contract and key

- Create: `packages/common/src/contracts/srs.ts`
- Create: `packages/common/src/contracts/srs.test.ts`
- Modify: `packages/common/src/keys.ts`
- Modify: `packages/common/src/keys.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/srsService.ts`
- Modify: `apps/vela/src/services/srsService.test.ts`

### Mobile dependencies and boot

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

### Authenticated request boundary

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`

### Mobile services

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

## Acceptance-Criteria Mapping

| Acceptance criterion | Design coverage |
| --- | --- |
| Returning user reaches Home through restored auth | HPA-206 gate plus enabled query after usable session |
| Home displays `/api/srs/stats` due count | Mobile SRS service and Home selector |
| Expired/rejected token cannot expose another user’s data | 401-only generation guards, shared recovery, user-scoped key, cancellation, and cache cleanup |
| Loading, empty, failure, and retry states are accessible | Exhaustive view union including auth-recovery loading and manual retry |
| Signing out clears user data | Cancel then clear QueryClient |
| Count agrees with web/API | Manual matrix |
| Tests cover primary states and auth/cache isolation | Shared, concurrency, timeout, query, cache, and component suites |
| Simulator and physical iPhone verification | Simulator merge gate plus device closure gate |

## Risks and Mitigations

### Successful response discarded by soft refresh

Return non-401 responses before generation comparison. Generation guards only auth-mutating 401 paths.

### Concurrent 401s duplicate cleanup or refresh

Use one recovery promise per owner/generation, reuse `refreshPromise`, and permit one terminal cleanup.

### Feature request hangs

Keep the client timeout active through body consumption. Shared auth-recovery waiters settle on the current attempt rather than waiting for later retries.

### Transient refresh failure destroys credential

Return `session_recovery_pending`, preserve HPA-206 retry state, and never terminally clean up due solely to transport/server refresh failure.

### Previous-user cache flashes after sign-in

User-scope the key, disable without usable identity, and cancel then clear on identity loss.

### Token leakage or API-prefix escape

Keep bearer application inside the coordinator, reject Authorization overrides case-insensitively, use parsed pathname boundaries, and extend secret-leak tests.

### Scope grows into review execution

Home presents count/status only. Due-card retrieval and review navigation remain later work.

## Implementation Sequence

1. Shared SRS contract, package description, and user-scoped stats key.
2. Shared API URL normalization and case-insensitive header ownership.
3. Coordinator request contract, non-401 ordering, and single-flight 401 recovery.
4. Mobile API timeout/error normalization and SRS service provisioning.
5. QueryClient boot, exact retry predicate, and native focus bridge.
6. Auth-driven cache isolation and pending-recovery refetch behavior.
7. Due-count composable with silent race recovery and separate manual-retry state.
8. Home selector/presentation and accessibility states.
9. Simulator merge-gate evidence and physical-device closure evidence.

Each stage must leave existing web authentication, web SRS loading behavior, mobile OAuth restoration, and sign-out behavior unchanged except for the explicitly shared contract, package description, and stats-key signature.
