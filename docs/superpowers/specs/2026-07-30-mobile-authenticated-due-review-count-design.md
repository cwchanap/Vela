# HPA-207: Authenticated Mobile Due-Review Count Vertical Slice

**Date:** 2026-07-30

**Linear:** [HPA-207](https://linear.app/cwchanap/issue/HPA-207/mobile-mvpm1-deliver-the-authenticated-due-review-count-vertical-slice)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Deliver the smallest production-shaped Vela Mobile product flow: a returning iOS user restores a secure Cognito session, reaches Home, and sees the current authenticated `due_today` value returned by `GET /api/srs/stats`.

This slice establishes reusable mobile boundaries for authenticated feature requests and user-scoped server-state caching without importing the web Home page or exposing Cognito tokens to feature components.

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
| Coordinator failures | Use stable typed failures for invalid path, invalid Authorization header, unavailable session, and stale session |
| URL safety | Use one trailing-slash-preserving API URL builder for `/auth/session` and feature paths; require relative paths contained beneath the configured API prefix |
| Header ownership | Reject caller-supplied `Authorization` headers case-insensitively before applying the coordinator-owned bearer token |
| Unauthorized response | A current-session 401 enters auth recovery or terminal cleanup; Home never renders an unauthorized-data state |
| Expiry race | If the request token expires in flight, refresh and retry once before declaring the session unusable |
| Stale request race | A response from an older auth generation cannot invalidate a replacement session |
| Server state | Install TanStack Query in Vela Mobile |
| Automatic retry | Use an explicit `(failureCount, error) => boolean` predicate; retry only `network` and `server` errors, at most twice |
| Foreground refresh | Bridge native app active state to TanStack Query focus state |
| Home re-entry | Refetch whenever Home mounts, even if cached data is still fresh |
| Manual retry | Track manual retry separately from background fetching so `retrying` and `refreshing` are never inferred from the same flag |
| Cache isolation | Disable immediately when auth is unusable, user-scope keys, and clear mobile query state on sign-out or identity loss |
| Cached zero | A cached zero keeps the stale-data warning because time or another client can make reviews due |
| Review navigation | Do not add a Start Review action in HPA-207 |
| Platform | Native iOS remains the authenticated runtime for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract and parser;
- a user-scoped stats query key;
- a coordinator-owned authenticated request capability with an explicit failure contract;
- a shared, boundary-safe mobile API URL builder;
- a mobile JSON API client with normalized failures;
- a mobile SRS stats service;
- TanStack Query bootstrap;
- native foreground-to-query-focus integration;
- auth-driven query lifecycle and cache cleanup;
- a minimal Home due-count presentation;
- unit/component tests for services, retry policy, query behavior, auth isolation, and view states; and
- Simulator and physical-device verification evidence.

## Non-goals

- starting, resuming, or completing a review session;
- fetching individual due cards;
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
Mobile API client delegates authenticated transport
                    |
                    v
Coordinator applies current in-memory Cognito ID token
                    |
                    v
GET {VITE_MOBILE_API_URL}srs/stats
```

The auth-failure path is:

```text
Current authenticated request returns 401
                    |
                    v
Coordinator checks request generation and token expiry
                    |
          +---------+---------+
          |                   |
  Token expired in flight   Still-valid token rejected
          |                   |
Refresh and retry once      Terminal session cleanup
          |                   |
          +---------+---------+
                    |
                    v
sessionUsable becomes false if recovery cannot continue
                    |
                    v
MobileAuthGate hides Home and query state is cleared
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
  | 'session_changed';

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

The request operation has these observable outcomes:

| Outcome | Coordinator result |
| --- | --- |
| Path violates the mobile API containment contract | Throw `MobileAuthenticatedApiRequestError('invalid_request_path')` before network activity |
| Caller supplies any case variant of `Authorization` | Throw `MobileAuthenticatedApiRequestError('invalid_request_headers')` before network activity |
| No usable current session before dispatch | Throw `MobileAuthenticatedApiRequestError('session_unavailable')` before network activity |
| Caller aborts | Preserve the platform `AbortError`; do not mutate auth state |
| Fetch rejects for another reason | Propagate the transport error; the mobile API client classifies it as `network` |
| Active owner or generation changes before response handling | Throw `MobileAuthenticatedApiRequestError('session_changed')`; do not mutate the replacement session |
| Non-401 HTTP response | Return the `Response` unchanged |
| Final current-generation 401 after recovery rules | Complete the required auth transition, then return the final 401 `Response` for client classification |

Feature code never receives an ID token. The coordinator constructs the request, owns `Authorization`, and performs the fetch through its injected transport.

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

For example:

```text
https://vela.example/api     -> https://vela.example/api/
https://vela.example/api///  -> https://vela.example/api/
```

`resolveMobileApiUrl()` accepts a non-empty relative path such as `auth/session` or `srs/stats`. It rejects:

- absolute URLs;
- scheme-relative URLs;
- every root-relative path, including `/api/srs/stats`;
- backslash-prefixed or backslash-separated escape attempts;
- raw or percent-encoded traversal that normalizes outside the API base pathname;
- a resolved origin different from the configured API origin;
- a resolved pathname that does not begin with the normalized trailing-slash API pathname; and
- URL fragments.

The implementation compares parsed URL origin and pathname boundaries rather than using a base string with its trailing slash removed. With a base pathname of `/api/`, `/api-evil/secret` is outside the boundary and must fail.

The existing `/auth/session` request becomes:

```ts
resolveMobileApiUrl(apiBaseUrl, 'auth/session');
```

The due-count request becomes:

```ts
resolveMobileApiUrl(apiBaseUrl, 'srs/stats');
```

This avoids two normalization conventions inside the coordinator and prevents accidental bearer-token delivery to another host or same-origin non-API route.

### Case-insensitive Authorization ownership

HTTP header names are case-insensitive. The coordinator converts caller headers through the platform `Headers` implementation before inspection:

```ts
const headers = new Headers(request.init?.headers);
if (headers.has('authorization')) {
  throw new MobileAuthenticatedApiRequestError('invalid_request_headers');
}
headers.set('Authorization', `Bearer ${idToken}`);
```

Tests cover `Authorization`, `authorization`, `AUTHORIZATION`, and at least one mixed-case spelling.

### Auth generation and 401 handling

Every request captures the active session owner, ID-token expiry, and `activeBundleGeneration` before dispatch.

When the response arrives:

1. Caller abort terminates without auth mutation.
2. If the active owner or generation changed, throw `session_changed` without mutating current auth state.
3. Return every non-401 response to the feature client.
4. For a current-generation 401, recheck the captured token expiry.
5. If the token expired in flight, queue the existing refresh path and retry the feature request once after verified promotion.
6. The retried request captures the promoted owner and generation and may not recursively retry again.
7. If the token was still valid when rejected, or the one retry also returns 401, perform terminal session cleanup.
8. After cleanup begins or completes, return the final 401 response so the API client can classify `unauthorized` while the gate removes protected content.
9. If refresh fails transiently, retain the existing HPA-206 retry state. Protected content remains usable only while the prior verified token remains valid.
10. If refresh proves the durable credential unusable, use the existing terminal cleanup path.

A 403 is not proof that the Cognito credential is invalid and remains a feature-level API error.

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

The parser requires:

- all count fields to be non-negative integers;
- `average_ease_factor` to be finite and non-negative;
- `accuracy_rate` to be finite and between 0 and 100; and
- every required nested field to exist.

Unknown additional fields are ignored so the API can add backward-compatible metadata later.

The web SRS service imports and re-exports `SRSStats`, preserving its public service type while removing the duplicate contract. The web card continues its current direct-service loading behavior.

Update the top-level comment in `packages/common/src/index.ts` so the package describes shared query configuration, query keys, domain contracts, and lightweight utilities rather than identifying itself as `@vela/query` only.

### User-scoped stats key

Change the shared factory to:

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
```

It produces:

```ts
['srs', 'stats', userId, jlpt]
```

HPA-207 supplies `MobileAuthUser.userId` and no JLPT filter.

The user ID is the cache correctness boundary. Explicit cache clearing remains defense-in-depth cleanup. This signature change does not imply that the web app now caches SRS stats; mobile is the first production caller.

### Mobile API client

Create `apps/vela-mobile/src/services/mobile-api-client.ts`.

Use a stable feature-facing error type:

```ts
export type MobileApiErrorCode =
  | 'session_unavailable'
  | 'session_changed'
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

The client:

- accepts a relative path and request options;
- delegates authenticated transport to the coordinator;
- sends `Accept: application/json`;
- parses successful JSON;
- preserves the TanStack Query abort signal;
- classifies failures without UI copy; and
- never logs authorization headers, token-bearing objects, or raw identity responses.

| Coordinator/HTTP outcome | Client classification |
| --- | --- |
| Caller abort | Preserve abort semantics; no visible error |
| `session_unavailable` coordinator error | `MobileApiError('session_unavailable')` |
| `session_changed` coordinator error | `MobileApiError('session_changed')` |
| `invalid_request_path` or `invalid_request_headers` coordinator error | `MobileApiError('invalid_response')`; these are programmer/configuration defects and must be covered by tests |
| Final 401 after coordinator recovery | `MobileApiError('unauthorized')` |
| 403 | `MobileApiError('forbidden')` |
| Fetch rejection without caller abort | `MobileApiError('network')` |
| Non-2xx other than 401/403 | `MobileApiError('server')` |
| Invalid JSON or stats shape | `MobileApiError('invalid_response')` |

`unauthorized` exists for tests and control flow, but Home does not render it because the coordinator disables authenticated content.

### Mobile SRS service and provisioning

Create `apps/vela-mobile/src/services/mobile-srs.ts`:

```ts
export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};
```

`getStats()` calls `srs/stats`, forwards the abort signal, and runs `parseSrsStats()` before returning.

Create `apps/vela-mobile/src/services/mobile-services.ts` with typed injection keys and a provider function:

```ts
export function provideMobileServices(
  app: App,
  coordinator: MobileAuthCoordinator,
): void;
```

The existing `mobile-auth` boot:

1. creates the coordinator;
2. provides `MOBILE_AUTH_KEY`;
3. calls `provideMobileServices(app, coordinator)` with the coordinator directly; and
4. starts coordinator initialization.

`mobile-services.ts` does not use `inject()` and does not import the QueryClient. Tests can provide deterministic fake services without mocking global fetch.

### QueryClient bootstrap and wiring

Add workspace dependencies on `@vela/common` and `@tanstack/vue-query` to `@vela/mobile`.

Create `apps/vela-mobile/src/boot/query.ts`:

```ts
export const mobileQueryClient = createQueryClient();

export default defineBoot(({ app }) => {
  app.use(VueQueryPlugin, { queryClient: mobileQueryClient });
});
```

The boot order becomes:

```text
main
query
mobile-auth
capacitor-lifecycle (Capacitor only)
diagnostic-cold-entry (development only)
```

The wiring mechanisms are intentionally distinct:

- `mobileQueryClient` is a module singleton imported by auth-isolation infrastructure.
- `VueQueryPlugin` provides that same instance to TanStack Query composables.
- `capacitor-lifecycle` imports TanStack Query's `focusManager` directly and does not import the QueryClient singleton.
- `MobileAuthCoordinator` and `MobileSrsService` use typed Vue application injection.
- `mobile-auth` boot passes the coordinator directly to `provideMobileServices()`; no boot file tries to recover another boot file's provided value through component injection.
- `App.vue` injects the coordinator and imports `mobileQueryClient` to install auth/cache isolation once.

### Due-count query and exact automatic retry policy

Create `apps/vela-mobile/src/composables/useDueReviewCount.ts`.

The query configuration is:

```ts
const DUE_COUNT_RETRY_LIMIT = 2;

export function retryDueCountQuery(failureCount: number, error: unknown): boolean {
  return (
    error instanceof MobileApiError &&
    (error.code === 'network' || error.code === 'server') &&
    failureCount < DUE_COUNT_RETRY_LIMIT
  );
}

useQuery({
  queryKey: computed(() => srsKeys.stats(userId.value)),
  enabled: computed(() => sessionUsable.value && userId.value !== null),
  queryFn: ({ signal }) => srsService.getStats({ signal }),
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: retryDueCountQuery,
});
```

TanStack Query invokes the retry predicate as `(failureCount, error)`. `failureCount < 2` permits two retries, matching the existing shared numeric default while preventing retries for auth, authorization, validation, cancellation, or stale-session failures.

Tests verify the predicate directly for every `MobileApiErrorCode`, including that a final 401-derived `unauthorized` error receives zero automatic retries.

The shared stale and garbage-collection defaults remain. `refetchOnMount: 'always'` and `refetchOnWindowFocus: 'always'` are required because Home activation and foreground resume must refresh even while data is nominally fresh.

### Native foreground integration

Extend the existing Capacitor lifecycle boot to subscribe to `appStateChange` and call:

```ts
focusManager.setFocused(event.isActive);
```

Keep existing resume diagnostics behavior. Tests cover inactive and active transitions. No polling or background task is added.

### Auth and cache isolation

Create `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts` and install it once from `App.vue`.

`App.vue`:

- injects `MOBILE_AUTH_KEY`;
- imports the `mobileQueryClient` module singleton; and
- calls the installer with both explicit dependencies.

The isolation rules are:

1. Queries are enabled only with a usable session and user ID.
2. A usable-to-unusable transition immediately stops Home from selecting authenticated data.
3. Sign-out start, terminal cleanup start, or identity change cancels in-flight queries and clears the mobile QueryClient.
4. Failed durable sign-out cleanup still leaves query data cleared.
5. A soft in-session refresh failure does not clear while `sessionUsable` remains true.
6. Ordinary backgrounding does not clear.
7. Cancellation completes before cache removal so an older response cannot repopulate the cache afterward.

Clearing the complete QueryClient is acceptable in M1 because all current mobile server state is authenticated and user-specific.

### Manual retry versus background refresh

The composable owns a local `manualRetryPending` ref in addition to TanStack Query state.

Its `retry()` operation:

1. returns immediately when a manual retry is already pending;
2. records the current visible error presentation;
3. sets `manualRetryPending = true`;
4. awaits `query.refetch()`; and
5. clears `manualRetryPending` in `finally`.

The presentation inputs derive as follows:

```ts
retrying = manualRetryPending;
refreshing = query.isFetching && query.data !== undefined && !manualRetryPending;
```

While a manual retry is pending, the previous blocking or cached error surface remains rendered with its Retry button disabled/loading. An automatic mount/focus refetch with cached data renders the normal count plus the subtle refreshing status.

The selector does not derive both `retrying` and `refreshing` from `isFetching` alone.

### Home view selector

Create `apps/vela-mobile/src/components/home/due-review-view.ts`:

```ts
type DueReviewView =
  | { kind: 'loading' }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | { kind: 'blocking_error'; message: string; retrying: boolean }
  | { kind: 'cached_error'; count: number; message: string; retrying: boolean };
```

Rules:

- no data plus initial fetch produces `loading`;
- `due_today === 0` produces `zero`;
- `due_today > 0` produces `positive`;
- automatic background fetch keeps zero/positive content with `refreshing: true`;
- visible failure without data produces `blocking_error`;
- visible refetch failure with cached data, including cached `0`, produces `cached_error`;
- every non-auth visible failure offers manual Retry;
- manual retry preserves the corresponding error kind with `retrying: true`;
- cancellation and session-change outcomes produce no visible failure; and
- unauthorized is never a Home view because auth state removes the content surface.

A cached zero retains the stale-data notice after a failed refetch. Zero can become stale as review timestamps pass or progress changes through the web app or another client.

### Home presentation

Replace the M1 scaffold in `HomePage.vue` with a focused “Today’s review” surface.

#### Initial loading

- Spinner or skeleton.
- `role="status"` and `aria-live="polite"`.
- Copy: “Loading your review count…”

#### Zero due

- Prominent `0`.
- Copy: “You’re caught up for now.”
- No disabled or misleading review action.

#### Positive due

- Prominent integer.
- Singular/plural copy: “1 word is due for review” or “12 words are due for review.”

#### Background refresh

- Keep the last verified count visible.
- Add `role="status"`: “Refreshing review count…”
- Do not replace verified content with a blocking spinner.

#### Blocking failure

- `role="alert"`.
- Network copy: “Vela couldn’t load your review count. Check your connection and try again.”
- Other safe copy: “Vela couldn’t load your review count. Please try again.”
- Retry button.

#### Cached refresh failure

- Keep the last verified count visible, including `0`.
- Non-blocking alert: “This count may be out of date.”
- Retry button.

#### Manual retry in progress

- Keep the existing blocking or cached error surface visible.
- Disable Retry.
- Use loading state and accessible label: “Retrying review count.”

#### Unauthorized

- No Home-specific message.
- The coordinator makes the session unusable and `MobileAuthGate` returns to authentication.

The page no longer displays app version, environment, or scaffold labels. Development diagnostics remain under More.

## Error Handling

### Network and server failures

They do not mutate authentication state. They remain query errors and support automatic and manual retry according to the explicit predicate. Cached verified data remains visible during a failed refetch.

### Invalid API shape

Invalid stats are never cached. The client returns `invalid_response`, Home shows safe generic copy, and raw response content is not logged.

### Unauthorized session

A final current-generation 401 is an auth concern. The coordinator owns recovery/cleanup, returns the final response for client classification, the query disables, the cache clears, and the gate removes protected content.

### Sign-out during request

Sign-out increments auth generation, marks the session unusable before cleanup, cancels query work, and clears cache. A late prior-generation response throws `session_changed` and cannot repopulate data or invalidate the current session.

### Identity replacement

A later sign-in receives a different user-scoped key and cannot select previous-user data even if asynchronous cleanup has not completed.

## Testing Strategy

### Shared package

- Parse a complete production-shaped response.
- Reject missing, negative, fractional, or non-finite required values.
- Reject accuracy outside 0–100.
- Ignore unknown additional fields.
- Produce distinct stats keys for distinct users and JLPT filters.
- Confirm the package header covers contracts as well as query utilities.

### Auth coordinator

- Attach the current ID token to an allowed relative path.
- Use the same URL builder for `auth/session` and `srs/stats`.
- Reject absolute, scheme-relative, root-relative, backslash, traversal, and outside-prefix paths.
- Reject `/api-evil/secret` when the configured base pathname is `/api/`.
- Preserve the normalized trailing `/` in containment checks.
- Reject `Authorization`, `authorization`, `AUTHORIZATION`, and mixed-case variants with `invalid_request_headers` before network activity.
- Reject without a usable session using `session_unavailable`.
- Preserve caller abort behavior.
- Propagate transport rejection for client classification.
- Return non-401 responses without auth mutation.
- Refresh and retry once when the token expires in flight.
- Terminally clean up after a still-valid current token or refreshed retry is rejected.
- Return the final 401 response after the auth transition.
- Throw `session_changed` for an old-generation response without auth mutation.
- Keep 403 feature-scoped.
- Handle sign-out racing an in-flight request.
- Keep token/header values out of logs and rendered errors.

### Mobile API and SRS services

- Map each typed coordinator failure to the documented `MobileApiErrorCode`.
- Successful JSON parsing and full stats validation.
- Network, 401, 403, non-2xx, and invalid-response classification.
- Cancellation and signal forwarding.
- Exact `srs/stats` path.
- Typed service provisioning from the coordinator without cross-boot `inject()`.

### Query bootstrap and retry policy

- QueryClient singleton creation and Vue plugin installation.
- Boot ordering.
- `retryDueCountQuery(0, network)` and `retryDueCountQuery(1, server)` return true.
- `retryDueCountQuery(2, network)` returns false.
- Unauthorized, forbidden, invalid-response, session-unavailable, and session-changed return false at every failure count.
- Unknown/non-`MobileApiError` values return false.

### Native lifecycle

- `focusManager` receives inactive and active updates.
- Foreground refetch occurs for an enabled query.
- No foreground fetch occurs while signed out.
- Existing lifecycle diagnostics remain intact.

### Cache isolation

- No query during restoration.
- One initial query after restored authentication becomes usable.
- User ID appears in the key.
- Sign-out and terminal cleanup cancel and clear.
- Cancellation precedes removal.
- Soft refresh failure with a usable session retains cache.
- Identity change cannot select previous-user data.
- Failed durable cleanup still hides and clears due-count data.

### Composable and Home component

- Background fetch with cached data sets `refreshing` and not `retrying`.
- Manual retry sets `retrying` and not `refreshing`.
- The previous error surface remains visible while manual retry is pending.
- Accessible loading state.
- Zero, singular, and plural states.
- Blocking network failure and manual retry.
- Disabled/loading retry state.
- Background refresh with cached count.
- Cached positive and cached-zero refresh failures show the stale-data alert and Retry.
- No Start Review action.
- No scaffold version/environment content.

## Manual Verification Matrix

Record account, build/environment, device, timestamp, comparison value, and result for every row.

| Scenario | Expected result |
| --- | --- |
| Fresh sign-in | Google sign-in opens Home and fetches the authenticated count |
| Relaunch restoration | Force-close/reopen restores without another Google prompt and loads Home |
| Positive due count | Mobile matches web/API for the same account at the recorded time |
| Zero due count | Home displays `0` and the caught-up message |
| Network failure | Home remains authenticated and shows a retryable failure |
| Retry | Restoring connectivity and tapping Retry loads the count |
| Background/resume | Returning Vela to active state refetches the count |
| Rejected token | Protected Home disappears and authentication is shown |
| Sign-out | Home data is removed immediately; relaunch remains signed out |
| Account isolation | A later sign-in never displays the prior account’s count |
| iOS Simulator | Complete flow passes in a configured Simulator build |
| Physical development iPhone | Complete flow passes on a configured device |

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
| Returning user reaches Home through restored auth | Existing HPA-206 gate plus enabled query after `sessionUsable` |
| Home displays `/api/srs/stats` due count | Mobile SRS service and Home selector |
| Expired/rejected token cannot expose another user’s data | Generation-aware recovery, typed stale-session rejection, user-scoped key, query disable, and cache cleanup |
| Loading, empty, failure, and retry states are accessible | Exhaustive presentation union, explicit manual-retry state, and required semantics |
| Signing out clears user data | Auth-isolation service cancels then clears QueryClient |
| Count agrees with web/API | Required manual verification matrix |
| Tests cover states and auth/cache isolation | Shared, auth, service, retry, query, cache, and component suites |
| Simulator and physical iPhone verification | Required matrix rows for both device classes |

## Risks and Mitigations

### Token leakage through an overly generic client

Keep token application inside the coordinator, validate path containment, reject Authorization overrides case-insensitively, and extend secret-leak tests.

### API-prefix boundary bypass

Normalize the base pathname with a trailing `/`, resolve through parsed URLs, compare origin and pathname boundaries, and test `/api/` versus `/api-evil/` explicitly.

### Late 401 signs out a refreshed session

Capture and verify active owner plus auth generation before any 401-driven mutation.

### In-flight expiry destroys a valid refresh credential

Recheck expiry on 401, refresh through the existing durable credential path, and retry once before terminal cleanup.

### Default retry repeats auth failures

Use the explicit retry predicate and direct tests for all error codes rather than inheriting the shared numeric default.

### Previous-user cache flashes after sign-in

Include user ID in the key and disable whenever no usable identity exists. Cache clearing remains defense in depth.

### Manual retry looks like background refresh

Track `manualRetryPending` independently and retain the preceding error surface until the manual request settles.

### Wiring relies on an unavailable cross-boot injection

Pass the coordinator directly into service provisioning, import the QueryClient singleton only where auth-isolation needs it, drive native focus through `focusManager`, and reserve Vue injection for component/composable consumers.

### Native lifecycle does not produce browser focus events

Drive TanStack Query `focusManager` explicitly from Capacitor app state.

### Scope grows into review execution

Home presents count and status only. Review navigation and due-card retrieval remain in the next milestone.

## Implementation Sequence

The implementation plan should preserve test-driven, independently reviewable boundaries in this order:

1. shared SRS contract, package description, and user-scoped query key;
2. shared API URL normalization and case-insensitive header ownership;
3. coordinator authenticated-request failure contract and generation-aware 401 handling;
4. mobile API/SRS services and direct coordinator provisioning;
5. QueryClient boot, exact retry predicate, and native focus bridge;
6. auth-driven cache isolation with explicit singleton/injection wiring;
7. due-count composable with separate manual-retry state and pure view selector;
8. Home presentation and accessibility states; and
9. Simulator and physical-device milestone evidence.

Each stage must leave existing web authentication, web SRS loading behavior, mobile OAuth restoration, and sign-out behavior unchanged except for the explicitly shared contract, package description, and query-key signature.
