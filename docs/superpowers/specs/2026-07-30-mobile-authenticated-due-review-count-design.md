# HPA-207: Authenticated Mobile Due-Review Count Vertical Slice

**Date:** 2026-07-30

**Linear:** [HPA-207](https://linear.app/cwchanap/issue/HPA-207/mobile-mvpm1-deliver-the-authenticated-due-review-count-vertical-slice)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Deliver the smallest production-shaped Vela Mobile product flow: a returning iOS user restores a secure Cognito session, reaches Home, and sees the current authenticated `due_today` value returned by `GET /api/srs/stats`.

This slice establishes the reusable mobile boundaries for authenticated feature requests and user-scoped server-state caching without importing the web Home page or exposing Cognito tokens to feature components.

## Current State

HPA-204 established the native API environment contract, absolute mobile API base URL, and approved Capacitor CORS behavior.

HPA-206 established the single mobile Cognito session owner. The mobile auth coordinator now:

- restores a Keychain-backed refresh credential during app initialization;
- keeps ID and access tokens in process memory only;
- refreshes the active token bundle proactively and when the app resumes;
- verifies candidate sessions through `/api/auth/session` before exposing protected content;
- marks protected content usable only while a verified active bundle remains valid; and
- clears local session material during sign-out or terminal credential failure.

HPA-206 intentionally did not expose a general token accessor or authenticated feature client. Its only authenticated API call is the coordinator-owned `/api/auth/session` verification request. HPA-207 introduces that feature-request boundary.

The API already exposes `GET /api/srs/stats`. It applies the shared Cognito ID-token middleware and returns:

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

The web application owns an equivalent TypeScript interface and a web-specific SRS service. `@vela/common` already owns the shared `srsKeys` query-key factory, but its stats key is not currently scoped by authenticated user.

The mobile Home route currently renders only the M1 scaffold identity and version. The mobile app does not yet install TanStack Query.

## Approved Decisions

| Area | Decision |
| --- | --- |
| Product scope | Display only the authenticated due-review count and its required states |
| Backend | Reuse the existing `GET /api/srs/stats` endpoint unchanged |
| Shared contract | Move the complete `SRSStats` response contract into `@vela/common` |
| Contract validation | Parse the complete stats payload at the mobile service boundary before caching it |
| Token ownership | ID tokens remain private to the mobile auth coordinator |
| Feature request surface | Add a coordinator-owned authenticated API request operation; do not add `getIdToken()` |
| URL safety | Authenticated requests accept only paths beneath the configured Vela API base URL |
| Unauthorized response | A current-session 401 enters auth recovery or terminal cleanup; Home never renders an unauthorized data error |
| Expiry race | If the request token expires in flight, refresh and retry once before treating the session as unusable |
| Stale request race | A response from an older auth generation cannot invalidate a replacement session |
| Server state | Install TanStack Query in the mobile application |
| Query key | Include the authenticated user ID in the stats key |
| Foreground refresh | Bridge native app active state to TanStack Query focus state |
| Home re-entry refresh | Refetch whenever Home mounts, even if cached data is still fresh |
| Cache isolation | Disable queries immediately when the session is unusable, user-scope every key, and clear mobile query state on sign-out or identity loss |
| Cached refetch failure | Keep the last verified count visible with a non-blocking retry message |
| Review navigation | Do not add a Start Review action in HPA-207 |
| Platform | Native iOS remains the supported authenticated runtime for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract;
- a user-scoped SRS stats query key;
- a coordinator-owned authenticated mobile request capability;
- a mobile JSON API client with normalized failures;
- a mobile SRS stats service;
- TanStack Query bootstrap for Vela Mobile;
- native foreground-to-query-focus integration;
- authenticated query lifecycle and cache cleanup;
- a minimal mobile Home due-count presentation;
- unit and component coverage for service, query, auth isolation, and view states; and
- Simulator and physical-device verification evidence.

## Non-goals

- starting, resuming, or completing a review session;
- fetching individual due cards;
- dashboard parity with the web application;
- daily goals, streaks, mastery summaries, or learning shortcuts;
- persistent offline query storage;
- offline due-deck generation;
- connectivity monitoring through a new native plugin;
- background polling;
- Android support;
- remote Cognito global sign-out;
- refactoring the web page into a shared presentation component; and
- final mobile navigation or visual polish.

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
Mobile API client asks coordinator to send authenticated request
                    |
                    v
Coordinator attaches current in-memory Cognito ID token
                    |
                    v
GET {VITE_MOBILE_API_URL}srs/stats
```

The reverse auth-failure path is:

```text
Current authenticated request returns 401
                    |
                    v
Coordinator validates request generation and token expiry
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
MobileAuthGate hides Home and query cache is cleared
```

### One token owner

`apps/vela-mobile/src/services/mobile-auth.ts` remains the only owner of active Cognito token material.

The public coordinator contract gains a request operation rather than a token accessor:

```ts
export type MobileAuthenticatedApiRequest = {
  path: string;
  init?: Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  };
};

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

Feature code never receives an ID token. The coordinator constructs the final request, applies `Authorization: Bearer <id-token>`, and performs the fetch through its injected transport.

The request method rejects without network activity unless all of these are true:

- the coordinator is initialized and not disposing;
- `state.phase === 'authenticated'`;
- `state.sessionUsable === true`;
- an active verified bundle exists;
- an authenticated user exists; and
- the request path resolves beneath the configured API base URL.

Callers cannot override `Authorization`. The coordinator owns that header even when other headers are supplied.

### URL containment

The mobile API base URL is expected to end at the Vela API prefix, for example `https://vela.example/api/`.

`requestAuthenticatedApi()` accepts a relative feature path such as `srs/stats`. It rejects:

- absolute URLs;
- scheme-relative URLs;
- paths beginning with `/` that could escape the configured `/api/` prefix;
- `.` or `..` path segments; and
- any URL whose resolved origin or base-path prefix differs from `config.api.url`.

This validation prevents a future feature service from accidentally sending an ID token to an unrelated host or to a non-API route on the same host.

### Auth generation and 401 handling

Every request captures the active session owner and `activeBundleGeneration` before dispatch.

When the response arrives:

1. If the coordinator has been disposed, the request is treated as cancelled.
2. If the active owner or generation changed, the response belongs to a stale session. It is rejected without mutating current auth state.
3. Any non-401 response is returned to the feature client.
4. For a current-generation 401, the coordinator rechecks token expiry.
5. If the captured ID token expired while the request was in flight, the coordinator queues the existing refresh path and retries the feature request once after successful verified promotion.
6. If the token was still valid when rejected, or the single retry also returns 401, the coordinator performs terminal session cleanup.
7. If refresh fails transiently, existing HPA-206 retry state is retained; protected content remains available only while an older verified token is still usable.
8. If refresh proves the durable credential unusable, the existing terminal cleanup path returns the user to authentication.

The request method does not treat 403 as proof that the Cognito credential is invalid. A 403 remains an API authorization failure handled by the mobile API client.

### Shared SRS contract

Create `packages/common/src/contracts/srs.ts` and export:

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

The parser enforces:

- all count fields are non-negative integers;
- `average_ease_factor` is a finite non-negative number;
- `accuracy_rate` is a finite number from 0 through 100; and
- no required nested field is missing.

Unknown additional fields are ignored so the API can add backward-compatible metadata later.

The web SRS service imports and re-exports `SRSStats` from `@vela/common`, preserving the current service API while removing its duplicate contract.

### User-scoped query key

Change the shared stats key to:

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
```

It produces:

```ts
['srs', 'stats', userId, jlpt]
```

HPA-207 calls it with the authenticated `MobileAuthUser.userId` and no JLPT filter.

The explicit user ID ensures that cached data for one identity cannot be selected by a component rendering another identity. This remains required even though sign-out also clears the cache: key isolation is the correctness boundary, while clearing is memory and defense-in-depth cleanup.

### Mobile API client

Create a Vela-owned client in `apps/vela-mobile/src/services/mobile-api-client.ts`.

Its responsibilities are:

- accept a relative API path and request options;
- delegate authenticated transport to the coordinator;
- request JSON through an explicit `Accept: application/json` header;
- parse successful JSON bodies;
- preserve the TanStack Query abort signal;
- classify failures without UI copy; and
- avoid logging request headers, token-bearing objects, or raw identity responses.

Use a stable error union:

```ts
export type MobileApiErrorCode =
  | 'session_unavailable'
  | 'session_changed'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'invalid_response';
```

`unauthorized` is observable for unit tests and non-visual control flow, but Home does not render it. The coordinator auth transition disables the query and the gate replaces Home.

HTTP behavior:

| Outcome | Client classification |
| --- | --- |
| Request aborted | Preserve abort semantics; do not show an error |
| No usable session before dispatch | `session_unavailable` |
| Session generation changes during request | `session_changed` |
| Final 401 after coordinator recovery rules | `unauthorized` |
| 403 | `forbidden` |
| Fetch rejects without caller abort | `network` |
| 5xx | `server` |
| Other non-2xx | `server` for this read-only slice |
| Invalid JSON or invalid stats shape | `invalid_response` |

### Mobile SRS service

Create `apps/vela-mobile/src/services/mobile-srs.ts`:

```ts
export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};
```

`getStats()` calls `srs/stats`, forwards the abort signal, and runs `parseSrsStats()` before returning. No page component builds URLs, headers, or response shapes.

The service is created from the authenticated API client during mobile boot and provided through a typed Vue injection key. Tests can provide a deterministic fake service without mocking global fetch.

### TanStack Query bootstrap

Add workspace dependencies on `@vela/common` and `@tanstack/vue-query` to `@vela/mobile`.

Create `apps/vela-mobile/src/boot/query.ts` to:

- create a mobile QueryClient through the existing `createQueryClient()` factory;
- install `VueQueryPlugin`; and
- export the mobile query client for lifecycle and auth-isolation wiring.

Add `query` before `mobile-auth` in `getMobileBootFiles()` so application components and later boot files can rely on the plugin.

The due-count query overrides only the behavior specific to this product slice:

```ts
useQuery({
  queryKey: computed(() => srsKeys.stats(userId.value)),
  enabled: computed(() => sessionUsable.value && userId.value !== null),
  queryFn: ({ signal }) => srsService.getStats({ signal }),
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: retryDueCountQuery,
});
```

The shared five-minute stale and ten-minute garbage-collection defaults remain. `always` is intentional: the issue requires refresh on Home activation and foreground resume, even when the last result is younger than the shared stale window.

`retryDueCountQuery` retries network and server failures up to the shared query retry limit. It does not retry:

- `session_unavailable`;
- `session_changed`;
- `unauthorized`;
- `forbidden`;
- `invalid_response`; or
- caller cancellation.

### Native foreground integration

The existing Capacitor lifecycle boot remains the single product-level bridge for native application activation.

Extend it to subscribe to `appStateChange` and call:

```ts
focusManager.setFocused(event.isActive);
```

The existing resume diagnostics behavior remains available. The lifecycle adapter and tests cover both inactive and active transitions.

TanStack Query then refetches the active due-count query when iOS returns Vela to the foreground. No polling or background task is added.

### Auth and cache isolation

Create `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts` and install it once from `App.vue` after both the auth coordinator and QueryClient are available.

It watches the public auth tuple, especially:

- `state.sessionUsable`;
- `state.user?.userId`;
- `state.operation`; and
- `state.phase`.

Its rules are:

1. Queries are enabled only while a usable session and user ID are present.
2. A transition from usable to unusable immediately makes Home stop selecting authenticated query data.
3. When sign-out starts, terminal cleanup starts, or identity changes, cancel all in-flight mobile queries.
4. Clear the mobile QueryClient after cancellation.
5. Never retain previous-user data for a later sign-in, including when durable sign-out cleanup fails.
6. Do not clear the cache during a soft in-session refresh failure while `sessionUsable` remains true.
7. Do not clear on ordinary backgrounding.

Clearing the complete mobile QueryClient is acceptable in M1 because every current mobile server-state query is authenticated and user-specific. Later public or durable server-state slices can narrow the cleanup filters if necessary.

### Due-count composable

Create `apps/vela-mobile/src/composables/useDueReviewCount.ts`.

It injects the coordinator and mobile SRS service, derives the current user ID, and owns the TanStack query configuration. It returns query state and an explicit `retry()` action to the page.

The composable does not contain display copy and does not navigate. Unauthorized navigation remains the responsibility of `MobileAuthGate` through coordinator state.

### Home view model

Create a pure selector in `apps/vela-mobile/src/components/home/due-review-view.ts`.

It converts query state into an exhaustive presentation union:

```ts
type DueReviewView =
  | { kind: 'loading' }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | { kind: 'blocking_error'; message: string; retrying: boolean }
  | { kind: 'cached_error'; count: number; message: string; retrying: boolean };
```

The selector never receives or returns `unauthorized`; those states remove the authenticated content surface.

View rules:

- no data plus pending fetch produces `loading`;
- `due_today === 0` produces `zero`;
- `due_today > 0` produces `positive`;
- a background refetch retains zero or positive content with `refreshing: true`;
- a retryable failure with no data produces `blocking_error`;
- a retryable refetch failure with cached data produces `cached_error`;
- invalid-response and forbidden failures use a generic safe failure message and remain manually retryable only when the query policy permits a manual request; and
- abort and session-change outcomes do not produce visible failures.

### Home presentation

Replace the M1 scaffold content in `HomePage.vue` with a focused “Today’s review” surface.

Required states:

#### Initial loading

- Show a spinner or skeleton.
- Use `role="status"` and `aria-live="polite"`.
- Copy: “Loading your review count…”

#### Zero due

- Display `0` prominently.
- Copy: “You’re caught up for now.”
- Do not show a disabled or misleading review action.

#### Positive due

- Display the integer prominently.
- Use singular copy for one item and plural copy for all other counts.
- Example: “1 word is due for review” / “12 words are due for review.”

#### Background refresh

- Keep the last verified count visible.
- Add a subtle `role="status"` indication: “Refreshing review count…”
- Do not replace verified content with a blocking spinner.

#### Blocking failure

- Use `role="alert"` for the message.
- Network copy: “Vela couldn’t load your review count. Check your connection and try again.”
- Other safe copy: “Vela couldn’t load your review count. Please try again.”
- Show a Retry button.

#### Cached refresh failure

- Keep the last verified count visible.
- Show a non-blocking alert: “This count may be out of date.”
- Show Retry.

#### Retrying

- Disable the Retry button.
- Set its loading state and accessible label to “Retrying review count.”

#### Unauthorized

- Render no Home-specific unauthorized message.
- The coordinator makes the session unusable and `MobileAuthGate` returns the user to authentication.

The page does not expose app version, environment, or scaffold labels after this change. Development diagnostics remain accessible from More.

## Error Handling

### Network and server failures

Network and 5xx failures do not mutate authentication state. They remain query errors and support manual retry. A cached value remains visible during a failed refetch.

### Invalid API shape

An invalid stats payload is never cached. It becomes `invalid_response`, shows safe generic copy, and emits no raw response body to logs.

### Unauthorized session

A final current-generation 401 is an auth concern, not a Home concern. The coordinator owns recovery and cleanup, the query becomes disabled, the cache is cleared, and the gate removes protected content.

### Sign-out during request

Sign-out increments the auth generation, marks the session unusable before cleanup, cancels query work, and clears cache state. A late response from the prior generation cannot repopulate or invalidate the current session.

### Identity replacement

Although multi-account switching is outside the MVP, a later sign-in after sign-out receives a different user-scoped key. It cannot select previous-user data even if asynchronous cache cleanup has not completed.

## Testing Strategy

### Shared package tests

Cover:

- parsing a complete production-shaped stats response;
- rejecting missing `due_today`;
- rejecting negative and fractional count fields;
- rejecting non-finite metrics;
- rejecting accuracy outside 0–100;
- ignoring unknown additional fields;
- producing distinct stats keys for distinct users; and
- preserving JLPT filter identity in the key.

### Auth coordinator tests

Cover:

- adding the current ID token to an allowed relative API request;
- preventing callers from overriding `Authorization`;
- rejecting absolute, scheme-relative, root-relative, traversal, and outside-prefix paths;
- rejecting requests without a usable session;
- preserving caller abort behavior;
- returning non-401 responses without auth mutation;
- refreshing and retrying once when a request token expires in flight;
- terminal cleanup after a still-valid current token is rejected;
- terminal cleanup after a refreshed retry is rejected;
- retaining current auth state when an old-generation request returns 401;
- not treating 403 as terminal Cognito failure;
- sign-out racing an in-flight request; and
- token and header values not appearing in logs or rendered errors.

### Mobile API and SRS service tests

Cover:

- successful JSON parsing;
- full stats contract validation;
- network classification;
- 403, 5xx, and invalid-response classification;
- caller cancellation;
- signal forwarding; and
- exact request path `srs/stats`.

### Query bootstrap and lifecycle tests

Cover:

- mobile QueryClient installation;
- boot-file ordering;
- `focusManager` receiving inactive and active native states;
- active transition refetching an enabled due-count query;
- no foreground refetch when signed out; and
- existing lifecycle diagnostics remaining intact.

### Cache isolation tests

Cover:

- no query while authentication is restoring;
- one initial query after restored authentication becomes usable;
- query key includes the restored user ID;
- sign-out cancels in-flight work and clears cached stats;
- terminal auth cleanup clears cached stats;
- soft refresh failure with a still-usable session retains cache;
- identity change cannot select previous-user data; and
- failed durable sign-out cleanup still hides and clears due-count data.

### Home component tests

Cover:

- loading copy and live-region semantics;
- zero-due state;
- singular positive copy;
- plural positive copy;
- blocking network failure;
- manual retry;
- disabled/loading retry state;
- background refreshing with visible cached count;
- failed background refresh with visible cached count and alert;
- no Start Review action; and
- no scaffold version/environment content.

## Manual Verification Matrix

Record the account, build/environment, device, timestamp, API or web comparison value, and result for every row.

| Scenario | Expected result |
| --- | --- |
| Fresh sign-in | Successful Google sign-in opens Home and fetches the authenticated count |
| Relaunch restoration | Force-close and reopen restores the user without another Google prompt and loads Home |
| Positive due count | Mobile count matches web/API for the same account at the recorded verification time |
| Zero due count | Home displays `0` and the caught-up message |
| Network failure | Home remains authenticated and shows a retryable failure without exposing stale foreign data |
| Retry | Restoring connectivity and tapping Retry loads the count |
| Background and resume | Returning Vela to active state refetches the count |
| Rejected token | Protected Home content disappears and the user returns safely to authentication |
| Sign-out | Home data is removed immediately; relaunch remains signed out |
| Account isolation | A later sign-in cannot display the prior account’s cached count |
| iOS Simulator | Complete product flow passes in a configured Simulator build |
| Physical development iPhone | Complete product flow passes on a configured development device |

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

### Authenticated request boundary

- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`

### Mobile server-state services

- Create: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Create: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.ts`
- Create: `apps/vela-mobile/src/services/mobile-srs.test.ts`
- Create: `apps/vela-mobile/src/boot/mobile-services.ts`
- Create: `apps/vela-mobile/src/boot/mobile-services.test.ts`

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
| Returning user reaches Home through restored authentication | Existing HPA-206 gate plus enabled query after `sessionUsable` |
| Home displays `/api/srs/stats` due count | Mobile SRS service and Home view model |
| Expired or rejected token cannot expose another user’s data | Generation-aware auth recovery, user-scoped key, disabled query, and cache cleanup |
| Loading, empty, failure, and retry states are understandable and accessible | Exhaustive Home presentation union and accessibility requirements |
| Signing out clears user-specific due-count data | Auth-isolation service cancels and clears QueryClient state |
| Count agrees with web/API | Required manual verification matrix |
| Tests cover primary states and auth/cache isolation | Shared, auth, service, query, cache, and component test sections |
| Simulator and physical iPhone verification | Required matrix rows for both device classes |

## Risks and Mitigations

### Token leakage through an overly generic client

Mitigation: keep token application inside the coordinator, validate API path containment, prohibit Authorization overrides, and extend secret-leak tests.

### Late 401 signs out a refreshed session

Mitigation: capture and verify active owner plus auth generation before any 401-driven mutation.

### In-flight expiry destroys a valid refresh credential

Mitigation: recheck token expiry on 401, refresh through the existing durable credential path, and retry once before terminal cleanup.

### Previous-user cache flashes after sign-in

Mitigation: include user ID in the query key and disable queries whenever no usable authenticated identity exists. Cache clearing remains defense in depth.

### Shared query defaults prevent required refresh

Mitigation: set due-count `refetchOnMount` and `refetchOnWindowFocus` to `always` while retaining shared stale and garbage-collection timing.

### Mobile lifecycle refetch is not triggered by browser focus semantics

Mitigation: explicitly drive TanStack Query `focusManager` from Capacitor app active state.

### Scope grows into the review flow

Mitigation: Home presents count and status only. Review navigation and due-card retrieval remain in the next milestone.

## Implementation Sequence

The implementation plan should preserve test-driven, independently reviewable boundaries in this order:

1. shared SRS contract and user-scoped query key;
2. coordinator-owned authenticated request capability and race handling;
3. mobile API and SRS services;
4. TanStack Query boot and native focus bridge;
5. auth-driven cache isolation;
6. due-count composable and pure view selector;
7. Home presentation and accessibility states; and
8. Simulator and physical-device milestone evidence.

Each stage must leave existing web authentication, web SRS behavior, mobile OAuth restoration, and sign-out behavior unchanged except for the explicitly shared contract and query-key signature.