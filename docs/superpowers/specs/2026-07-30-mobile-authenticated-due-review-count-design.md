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

The web application owns an equivalent interface and a web-specific SRS service. `@vela/common` already owns `srsKeys`, but its stats key is not scoped by authenticated user. The mobile app does not yet install TanStack Query, and Home still renders the M1 scaffold.

## Approved Decisions

| Area | Decision |
| --- | --- |
| Product scope | Display only the authenticated due-review count and required states |
| Backend | Reuse `GET /api/srs/stats` unchanged |
| Shared contract | Move the complete `SRSStats` response contract into `@vela/common` |
| Contract validation | Parse the complete payload at the mobile service boundary before caching |
| Token ownership | ID tokens remain private to the mobile auth coordinator |
| Feature request surface | Add a coordinator-owned authenticated request operation; do not add `getIdToken()` |
| URL safety | Permit only paths beneath the configured Vela API base URL |
| Unauthorized response | A current-session 401 enters auth recovery or terminal cleanup; Home never renders an unauthorized-data state |
| Expiry race | If the request token expires in flight, refresh and retry once before declaring the session unusable |
| Stale request race | A response from an older auth generation cannot invalidate a replacement session |
| Server state | Install TanStack Query in Vela Mobile |
| Query key | Include authenticated user ID in the stats key |
| Foreground refresh | Bridge native app active state to TanStack Query focus state |
| Home re-entry | Refetch whenever Home mounts, even if cached data is still fresh |
| Cache isolation | Disable immediately when auth is unusable, user-scope keys, and clear mobile query state on sign-out or identity loss |
| Cached refetch failure | Keep the last verified count visible with a non-blocking retry message |
| Review navigation | Do not add a Start Review action in HPA-207 |
| Platform | Native iOS remains the authenticated runtime for this milestone |

## Scope

HPA-207 includes:

- a shared SRS statistics contract and parser;
- a user-scoped stats query key;
- a coordinator-owned authenticated request capability;
- a mobile JSON API client with normalized failures;
- a mobile SRS stats service;
- TanStack Query bootstrap;
- native foreground-to-query-focus integration;
- auth-driven query lifecycle and cache cleanup;
- a minimal Home due-count presentation;
- unit/component tests for services, query behavior, auth isolation, and view states; and
- Simulator and physical-device verification evidence.

## Non-goals

- starting, resuming, or completing a review session;
- fetching individual due cards;
- dashboard parity with the web application;
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
Coordinator attaches current in-memory Cognito ID token
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

### One token owner

`apps/vela-mobile/src/services/mobile-auth.ts` remains the only owner of active Cognito token material.

The coordinator contract gains a request operation instead of a token accessor:

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

Feature code never receives an ID token. The coordinator constructs the request, owns `Authorization`, and performs the fetch through its injected transport.

The method rejects without network activity unless the coordinator is initialized, not disposing, authenticated, session-usable, and backed by an active verified bundle and user.

Callers cannot override `Authorization`.

### URL containment

The mobile API base URL ends at the API prefix, for example `https://vela.example/api/`.

`requestAuthenticatedApi()` accepts a relative path such as `srs/stats`. It rejects:

- absolute URLs;
- scheme-relative URLs;
- root-relative paths that could escape `/api/`;
- `.` or `..` path segments; and
- any result whose origin or base-path prefix differs from `config.api.url`.

This prevents a future feature service from sending an ID token to an unrelated host or non-API route.

### Auth generation and 401 handling

Every request captures the active session owner and `activeBundleGeneration` before dispatch.

When the response arrives:

1. Disposal or caller abort terminates the request without auth mutation.
2. If the active owner or generation changed, reject as a stale-session request without mutating current auth state.
3. Return every non-401 response to the feature client.
4. For a current-generation 401, recheck the captured token expiry.
5. If the token expired in flight, queue the existing refresh path and retry the feature request once after verified promotion.
6. If the token was still valid when rejected, or the one retry also returns 401, perform terminal session cleanup.
7. If refresh fails transiently, retain the existing HPA-206 retry state. Protected content remains usable only while the prior verified token remains valid.
8. If refresh proves the durable credential unusable, use the existing terminal cleanup path.

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

The parser requires all count fields to be non-negative integers, `average_ease_factor` to be finite and non-negative, `accuracy_rate` to be finite and between 0 and 100, and every nested field to exist. Unknown additional fields are ignored.

The web SRS service imports and re-exports `SRSStats`, preserving its public service type while removing the duplicate contract.

### User-scoped query key

Change the shared key to:

```ts
srsKeys.stats(userId: string | null, jlpt?: number[])
```

It produces:

```ts
['srs', 'stats', userId, jlpt]
```

HPA-207 supplies `MobileAuthUser.userId` and no JLPT filter. User identity in the key is the correctness boundary; cache clearing is defense-in-depth cleanup.

### Mobile API client

Create `apps/vela-mobile/src/services/mobile-api-client.ts`.

It:

- accepts a relative path and request options;
- delegates authenticated transport to the coordinator;
- sends `Accept: application/json`;
- parses successful JSON;
- preserves the TanStack Query abort signal;
- classifies failures without UI copy; and
- never logs authorization headers, token-bearing objects, or raw identity responses.

Use this stable error union:

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

| Outcome | Classification |
| --- | --- |
| Caller abort | Preserve abort semantics; no visible error |
| No usable session before dispatch | `session_unavailable` |
| Session generation changes | `session_changed` |
| Final 401 after coordinator recovery | `unauthorized` |
| 403 | `forbidden` |
| Fetch rejection without caller abort | `network` |
| Non-2xx other than 401/403 | `server` |
| Invalid JSON or stats shape | `invalid_response` |

`unauthorized` exists for tests and control flow, but Home does not render it because the coordinator disables authenticated content.

### Mobile SRS service and provisioning

Create `apps/vela-mobile/src/services/mobile-srs.ts`:

```ts
export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};
```

`getStats()` calls `srs/stats`, forwards the abort signal, and runs `parseSrsStats()` before returning.

Create `apps/vela-mobile/src/services/mobile-services.ts` with typed injection keys and a provider function that accepts the already-created auth coordinator. The existing `mobile-auth` boot creates the coordinator, provides it, calls the mobile-services provider, and only then starts initialization. This avoids exposing a coordinator singleton or relying on cross-boot injection lookup.

Tests can provide deterministic fake services without mocking global fetch.

### TanStack Query bootstrap

Add workspace dependencies on `@vela/common` and `@tanstack/vue-query` to `@vela/mobile`.

Create `apps/vela-mobile/src/boot/query.ts` to create a QueryClient through `createQueryClient()`, install `VueQueryPlugin`, and export the mobile query client for lifecycle and auth-isolation wiring.

The boot order becomes:

```text
main
query
mobile-auth
capacitor-lifecycle (Capacitor only)
diagnostic-cold-entry (development only)
```

All boot files finish before `App.vue` mounts. The due-count query overrides only slice-specific behavior:

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

The shared stale and garbage-collection defaults remain. `always` is required because Home activation and foreground resume must refresh even while data is nominally fresh.

Automatic retries apply only to network and server failures, up to the shared retry limit. They do not apply to cancellation, session-unavailable, session-changed, unauthorized, forbidden, or invalid-response errors. A user may still manually retry visible `forbidden` or `invalid_response` failures; the distinction is that they are not repeated automatically.

### Native foreground integration

Extend the existing Capacitor lifecycle boot to subscribe to `appStateChange` and call:

```ts
focusManager.setFocused(event.isActive);
```

Keep existing resume diagnostics behavior. Tests cover inactive and active transitions. No polling or background task is added.

### Auth and cache isolation

Create `apps/vela-mobile/src/services/mobile-query-auth-isolation.ts` and install it once from `App.vue` after the QueryClient and coordinator have been provided.

It watches `sessionUsable`, `user?.userId`, `operation`, and `phase`.

Rules:

1. Queries are enabled only with a usable session and user ID.
2. A usable-to-unusable transition immediately stops Home from selecting authenticated data.
3. Sign-out start, terminal cleanup start, or identity change cancels in-flight queries and clears the mobile QueryClient.
4. Failed durable sign-out cleanup still leaves query data cleared.
5. A soft in-session refresh failure does not clear while `sessionUsable` remains true.
6. Ordinary backgrounding does not clear.

Clearing the complete QueryClient is acceptable in M1 because all current mobile server state is authenticated and user-specific.

### Due-count composable

Create `apps/vela-mobile/src/composables/useDueReviewCount.ts`.

It injects the auth coordinator and SRS service, derives user ID, owns the query configuration, and returns query state plus an explicit `retry()` action. It contains no display copy and performs no navigation.

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
- background fetch keeps zero/positive content with `refreshing: true`;
- visible failure without data produces `blocking_error`;
- visible refetch failure with cached data produces `cached_error`;
- every non-auth visible failure offers manual Retry;
- cancellation and session-change outcomes produce no visible failure; and
- unauthorized is never a Home view because auth state removes the content surface.

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

- Keep the last verified count visible.
- Non-blocking alert: “This count may be out of date.”
- Retry button.

#### Retrying

- Disable Retry.
- Loading state and accessible label: “Retrying review count.”

#### Unauthorized

- No Home-specific message.
- The coordinator makes the session unusable and `MobileAuthGate` returns to authentication.

The page no longer displays app version, environment, or scaffold labels. Development diagnostics remain under More.

## Error Handling

### Network and server failures

They do not mutate authentication state. They remain query errors and support manual retry. Cached verified data remains visible during a failed refetch.

### Invalid API shape

Invalid stats are never cached. The client returns `invalid_response`, Home shows safe generic copy, and raw response content is not logged.

### Unauthorized session

A final current-generation 401 is an auth concern. The coordinator owns recovery/cleanup, the query disables, the cache clears, and the gate removes protected content.

### Sign-out during request

Sign-out increments auth generation, marks the session unusable before cleanup, cancels query work, and clears cache. A late prior-generation response cannot repopulate data or invalidate the current session.

### Identity replacement

A later sign-in receives a different user-scoped key and cannot select previous-user data even if asynchronous cleanup has not completed.

## Testing Strategy

### Shared package

- Parse a complete production-shaped response.
- Reject missing, negative, fractional, or non-finite required values.
- Reject accuracy outside 0–100.
- Ignore unknown additional fields.
- Produce distinct stats keys for distinct users and JLPT filters.

### Auth coordinator

- Attach the current ID token to an allowed path.
- Prevent Authorization override.
- Reject absolute, scheme-relative, root-relative, traversal, and outside-prefix paths.
- Reject without a usable session.
- Preserve caller abort behavior.
- Return non-401 responses without auth mutation.
- Refresh and retry once when the token expires in flight.
- Terminally clean up after a still-valid current token or refreshed retry is rejected.
- Ignore an old-generation 401 for auth mutation.
- Keep 403 feature-scoped.
- Handle sign-out racing an in-flight request.
- Keep token/header values out of logs and rendered errors.

### Mobile API and SRS services

- Successful JSON parsing and full stats validation.
- Network, 403, non-2xx, and invalid-response classification.
- Cancellation and signal forwarding.
- Exact `srs/stats` path.
- Typed service provisioning from the coordinator.

### Query bootstrap and lifecycle

- QueryClient installation and boot ordering.
- `focusManager` inactive/active updates.
- Foreground refetch for an enabled query.
- No foreground fetch while signed out.
- Existing lifecycle diagnostics remain intact.

### Cache isolation

- No query during restoration.
- One initial query after restored authentication becomes usable.
- User ID appears in the key.
- Sign-out and terminal cleanup cancel and clear.
- Soft refresh failure with a usable session retains cache.
- Identity change cannot select previous-user data.
- Failed durable cleanup still hides and clears due-count data.

### Home component

- Accessible loading state.
- Zero, singular, and plural states.
- Blocking network failure and manual retry.
- Disabled/loading retry state.
- Background refresh with cached count.
- Cached refresh failure with alert and Retry.
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
| Expired/rejected token cannot expose another user’s data | Generation-aware recovery, user-scoped key, query disable, and cache cleanup |
| Loading, empty, failure, and retry states are accessible | Exhaustive presentation union and required semantics |
| Signing out clears user data | Auth-isolation service cancels and clears QueryClient |
| Count agrees with web/API | Required manual verification matrix |
| Tests cover states and auth/cache isolation | Shared, auth, service, query, cache, and component suites |
| Simulator and physical iPhone verification | Required matrix rows for both device classes |

## Risks and Mitigations

### Token leakage through an overly generic client

Keep token application inside the coordinator, validate path containment, prohibit Authorization overrides, and extend secret-leak tests.

### Late 401 signs out a refreshed session

Capture and verify active owner plus auth generation before any 401-driven mutation.

### In-flight expiry destroys a valid refresh credential

Recheck expiry on 401, refresh through the existing durable credential path, and retry once before terminal cleanup.

### Previous-user cache flashes after sign-in

Include user ID in the key and disable whenever no usable identity exists. Cache clearing remains defense in depth.

### Shared query defaults prevent required refresh

Set due-count `refetchOnMount` and `refetchOnWindowFocus` to `always` while retaining shared stale/GC timing.

### Native lifecycle does not produce browser focus events

Drive TanStack Query `focusManager` explicitly from Capacitor app state.

### Scope grows into review execution

Home presents count and status only. Review navigation and due-card retrieval remain in the next milestone.

## Implementation Sequence

The implementation plan should preserve test-driven, independently reviewable boundaries in this order:

1. shared SRS contract and user-scoped query key;
2. coordinator-owned authenticated request capability and race handling;
3. mobile API/SRS services and provisioning;
4. TanStack Query boot and native focus bridge;
5. auth-driven cache isolation;
6. due-count composable and pure view selector;
7. Home presentation and accessibility states; and
8. Simulator and physical-device milestone evidence.

Each stage must leave existing web authentication, web SRS behavior, mobile OAuth restoration, and sign-out behavior unchanged except for the explicitly shared contract and query-key signature.