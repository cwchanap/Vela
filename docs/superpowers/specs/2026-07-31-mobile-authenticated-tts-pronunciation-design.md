# HPA-208: Authenticated TTS Pronunciation Playback on iOS

**Date:** 2026-07-31

**Linear:** [HPA-208](https://linear.app/cwchanap/issue/HPA-208/mobile-mvpm1-validate-authenticated-tts-pronunciation-playback-on-ios)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Prove that a restored, signed-in Vela user can request and repeatedly play one Japanese pronunciation inside the Capacitor iOS application using the existing authenticated TTS backend and presigned S3 audio flow.

The implementation must answer two related architecture questions:

1. Is `HTMLAudioElement` playback reliable enough for the iOS MVP?
2. Which native follow-up, if any, is required: app-level `AVAudioSession` configuration while retaining HTML playback, or replacement of the player with a native Capacitor audio adapter?

This is a production-shaped validation slice, not the final pronunciation experience. It establishes stable boundaries for authenticated TTS requests, long-running generation, expiring audio URLs, playback ownership, user-visible state, audio-session evidence, and future native replacement without importing the web TTS settings page or exposing Cognito tokens to feature code.

## Current state

HPA-204 established the absolute native API URL and approved `capacitor://localhost` for the Vela API CORS policy.

HPA-206 established the mobile Cognito session owner. ID and access tokens remain private to `MobileAuthCoordinator`; feature code calls `requestAuthenticatedApi()` instead of reading tokens.

HPA-207 established:

- a coordinator-owned authenticated feature-request boundary;
- bounded request execution and current-generation 401 recovery;
- `MobileApiClient.getJson()` with an eight-second overall deadline;
- a mobile service registry;
- user-scoped feature state and sign-out isolation patterns; and
- an authenticated Home vertical slice.

The existing web TTS service currently combines six responsibilities:

1. Amplify session access;
2. TTS settings retrieval;
3. authenticated TTS generation and existing-audio lookup;
4. a 14-minute in-memory presigned-URL cache;
5. settings-derived same-key in-flight request deduplication; and
6. direct `HTMLAudioElement` playback.

Its useful cache and concurrency semantics should be preserved, but the module itself must not be imported into mobile because it owns web authentication and mixes transport with playback.

The backend already provides:

- `GET /api/tts/settings`;
- `POST /api/tts/generate`; and
- `GET /api/tts/audio/:vocabularyId`.

`POST /api/tts/generate` checks the user-scoped S3 cache before invoking the configured provider, stores generated audio privately, and returns a presigned URL valid for 900 seconds. The backend derives the provider credential from the authenticated user's server-side TTS settings. No provider API key is returned to or bundled in the mobile application.

All three server-side providers enforce a 30-second provider-request timeout. After provider success, the route may still need to consume the audio body, upload it to S3, and create the signed URL. The API Lambda timeout is 60 seconds.

The mobile API client's current eight-second overall feature deadline and the coordinator's independent 15-second physical-fetch timeout are both too short for a cold TTS generation request. HPA-208 therefore adds bounded per-request timeout overrides without changing the existing defaults globally.

The Capacitor application does not currently install a native audio plugin or configure `AVAudioSession`.

Apple documents that an iOS app's default audio session is silenced by the Ring/Silent switch, while the `.playback` category continues playing with the switch set to silent. `HTMLAudioElement` cannot configure that native category itself. Device evidence therefore treats silent-switch behavior as a product gate, not merely an observation.

The existing development diagnostic route collection contains only authentication-bypass pages, and its tests assert that every route in that collection has `meta.bypassMobileAuth === true`. HPA-208 adds an authenticated diagnostic and must preserve that guard by separating bypass and authenticated diagnostic route collections rather than deleting the assertion.

## Approved decisions

| Area | Decision |
| --- | --- |
| Product scope | One authenticated known-word pronunciation diagnostic |
| Test word | Fixed diagnostic word `水` / `みず` / `water`, using identifier `水:ミズ` |
| Vocabulary dependency | The backend treats `vocabularyId` as an opaque TTS cache partition; the diagnostic does not require a vocabulary-table lookup or seeded database row |
| Text/cache convention | The backend cache key omits `text`; HPA-208 uses one fixed canonical pair as an explicit client precondition, not an enforced backend invariant |
| API flow | Check settings, then call `POST tts/generate`; do not require `GET tts/audio/:id` first |
| Shared code | Share validated request/response/settings/error contracts, not the web service or page |
| Web adoption | Web uses shared parsers for settings and generate success bodies; valid-response and existing error behavior remain unchanged, while malformed success responses intentionally fail validation |
| Auth ownership | All TTS requests use the existing coordinator-owned mobile API client |
| API client | Add authenticated JSON POST, structured bounded HTTP errors, and a bounded per-request timeout option |
| Default deadline | Keep eight seconds for due-count, settings, and other ordinary mobile JSON requests |
| TTS generation deadline | Use a 45-second overall deadline for `POST tts/generate` |
| Coordinator timeout | Add a validated per-request transport timeout so TTS can exceed the current 15-second default without weakening other requests |
| POST replay | `postJson()` serializes once to an immutable string so a coordinator 401 recovery can replay the identical body exactly once |
| Due-count migration | Keep its retry rule (`network`/`server` only), while intentionally stopping retries for 4xx responses that previously collapsed to `server` |
| Validator errors | An uncoded generate HTTP 400, including the Zod validator response shape, maps to `invalid_input` and is not retried |
| Prepare retry | Do not automatically retry network, provider, client, or server failures; expose an explicit Retry control |
| Auth control-race retry | Permit one same-user recovery attempt for narrow session handoff/recovery cases established by HPA-207 |
| Playback seam | `MobileAudioPlayer` interface with an initial `HtmlAudioPlayer` implementation |
| Silent-switch product rule | A prepared direct pronunciation tap must be audible while foregrounded when Ring/Silent is on and media volume is nonzero |
| Native integration | Do not preselect a plugin; if HTML-only playback fails silent-mode or session-control gates, create a native audio-session follow-up before considering full player replacement |
| Concurrency | One preparation operation and one active playback per controller; service generation deduplication uses the full settings-derived cache key |
| URL cache | User/settings/vocabulary-scoped in-memory cache, 14-minute TTL, bounded size |
| Invalidation | Invalidating one user/vocabulary pair affects every provider/voice/model partition and prevents stale pending work from being rejoined or cached |
| Settings reads | Every new preparation reads server-authoritative settings; no settings cache is introduced in HPA-208 |
| Latency evidence | Record settings, generation, and tap-to-play-attempt latency separately so user-activation findings are attributable |
| Replay | Reuse a still-live prepared URL and restart from the beginning; ready replay performs no settings request and never overlaps playback |
| First-tap gesture | Attempt playback after asynchronous preparation and record whether iOS permits it |
| Gesture fallback | If rejected, retain the prepared URL and require a second direct tap |
| Audibility gate | Acceptance may use prepare → Ready → direct second tap; silent-switch acceptance is measured on the prepared direct-tap path, not necessarily one-gesture generation-and-play |
| Proactive expiry | A ready tap checks `expiresAt` before playback; an expired item refreshes instead of intentionally attempting a stale URL |
| Media failure | Still refresh once because sleep, revocation, clock changes, or transport behavior can invalidate a nominally live URL |
| Background behavior | Stop active audio and classify it as interrupted; background audio remains unsupported |
| Diagnostic route | Use `/diagnostics/tts-pronunciation`, following the existing diagnostic route convention |
| Route collections | Preserve the all-bypass invariant on existing routes by separating bypass and authenticated development diagnostic arrays |
| Diagnostic exposure | Development-only entry under More, but the route remains behind `MobileAuthGate` and has no auth-bypass metadata |
| Provider configuration | Test account is configured on the web; mobile only reports configuration status |
| Device evidence | Simulator checks are merge gates; a physical iPhone is the closure and architecture-decision gate |
| Audibility evidence | Human-observed audio on a physical device speaker; audibility is not claimed from unit tests or media events alone |
| Error details | Bounded server details are internal-only, non-enumerable, never rendered, never logged, and never included in diagnostic serialization |
| Lifecycle source | The existing `boot/capacitor-lifecycle.ts` `appStateChange` listener feeds shared lifecycle state; no third listener is added |
| Infrastructure | Do not broaden S3 CORS preemptively; change it only if device evidence proves it necessary |
| Web behavior | Preserve valid web TTS request/cache/playback/settings behavior and existing user-facing errors |

## Scope

HPA-208 includes:

- shared runtime-validated TTS contracts;
- stable TTS backend error codes while preserving existing `error` messages and statuses;
- shared parser adoption for web settings and generation success responses;
- authenticated JSON POST support with replayable serialized bodies;
- bounded per-request overall and coordinator transport timeout overrides;
- bounded, redacted HTTP status and server-detail preservation for feature services;
- the intentional mobile 4xx classification migration and pinned due-count retry behavior;
- a complete ordered API-to-TTS error mapping, including uncoded validator 400s;
- a mobile TTS service with settings validation, URL caching, full-key single-flight generation, and all-partition invalidation;
- separate settings/generation/user-activation timing evidence;
- a replaceable mobile audio interface;
- an `HTMLAudioElement` implementation owning one active playback;
- a pronunciation controller with explicit state transitions, manual retry policy, auth-race recovery, proactive expiry, and concurrency rules;
- a named active/inactive lifecycle API fed by the existing Capacitor lifecycle boot listener;
- separate bypass and authenticated development diagnostic route collections;
- an authenticated development-only diagnostic page for one fixed word;
- lifecycle, interruption, silent-switch, decode, and audibility observation;
- unit/component/backend/infrastructure coverage;
- Simulator and physical-iPhone verification; and
- a written HTML-only, native-session, or native-player conclusion.

## Non-goals

- final Review, Learn, Words, or settings integration;
- allowing provider keys to be entered on mobile;
- changing provider selection, voice selection, or model selection;
- a persistent or long-lived mobile TTS settings cache;
- speech-to-text or microphone capture;
- AI buddy conversation audio;
- free-form TTS text entry;
- alternate pronunciation text for an existing vocabulary ID;
- redesigning the backend TTS cache key to include text or enforcing a canonical vocabulary/text mapping server-side;
- offline audio downloads or persistent audio storage;
- background playback;
- lock-screen controls, Now Playing integration, or remote transport controls;
- Bluetooth route selection, recording policy, or advanced `AVAudioSession` routing/mixing policy;
- implementing native audio-session or player integration before device evidence identifies which layer is necessary;
- Android validation; and
- proactively adopting a native audio plugin.

## Architecture

### End-to-end flow

```text
Authenticated development diagnostic page
                    |
                    v
Pronunciation controller receives direct tap
                    |
                    v
MobileTtsService.preparePronunciation(...)
        |                       |
        |                       +--> 14-minute user/settings URL cache
        v
MobileApiClient GET tts/settings (default 8s)
        |
        v
Settings-derived cache/pending key
        |
        v
MobileApiClient POST tts/generate (45s overall)
        |
        v
MobileAuthCoordinator adds current Cognito ID token,
applies bounded transport timeout, and may replay the
same serialized request once after successful 401 recovery
        |
        v
Backend checks user TTS settings and S3 object cache
        |
        v
Provider generation when needed (30s provider cap)
        |
        v
Private S3 upload and presigned URL
        |
        v
Validated { audioUrl, cached } response
        |
        v
Controller checks local expiresAt
        |
        v
Controller calls MobileAudioPlayer.play(audioUrl)
        |
        v
HtmlAudioPlayer owns exactly one HTMLAudioElement
```

### Responsibility boundaries

#### Shared contracts

`packages/common/src/contracts/tts.ts` owns platform-neutral data contracts and parsers. It has no fetch, auth, Vue, browser-audio, or provider implementation dependencies.

#### Mobile auth coordinator

`MobileAuthCoordinator` remains the only owner of Cognito token material and physical authenticated fetch attempts. It accepts a validated optional transport timeout for a feature request while retaining its existing 15-second default and auth-recovery rules.

It may retry an authenticated request once after successful 401 recovery. This retry reuses the original request object, so feature request bodies must be replayable. HPA-208 satisfies that constraint by permitting only an already-serialized JSON string body through `postJson()`.

#### Mobile API client

`apps/vela-mobile/src/services/mobile-api-client.ts` owns:

- authenticated JSON transport;
- the caller's overall deadline across auth recovery, transport, replay, and body consumption;
- replayable JSON body construction;
- bounded response-body consumption;
- JSON syntax handling; and
- stable transport/HTTP error normalization.

It does not understand TTS domain states.

#### Mobile TTS service

`apps/vela-mobile/src/services/mobile-tts.ts` owns:

- TTS settings interpretation;
- settings and generation timing measurement;
- generate-request construction;
- structural response validation;
- URL-cache semantics;
- full-key pending-work identity;
- all-partition invalidation; and
- TTS-specific error normalization.

It does not create or control audio elements.

#### Mobile audio player

`apps/vela-mobile/src/audio/mobile-audio-contract.ts` defines the replaceable playback boundary. `apps/vela-mobile/src/audio/html-audio-player.ts` is the first implementation. No learning component or diagnostic page constructs `Audio` directly.

Native app-level audio-session configuration, if required, remains outside `MobileAudioPlayer` unless it must coordinate directly with player lifecycle. A later native player can preserve the same learning-feature contract.

#### Pronunciation controller

`apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts` or an equivalent focused controller owns user intent, preparation/playback sequencing, local expiry checks, manual retry, same-user auth-race recovery, state transitions, tap-to-play timing, lifecycle reactions, and teardown. It does not parse HTTP responses or own Cognito state.

#### Diagnostic view

The Vue page renders controller state and exposes accessible controls. It contains no request, cache, or playback implementation logic.

## Shared TTS contracts

Create and export:

```ts
export type TtsProvider = 'elevenlabs' | 'openai' | 'gemini';

export interface TtsSettings {
  provider: TtsProvider;
  voiceId: string | null;
  model: string | null;
  hasApiKey: boolean;
}

export interface GeneratePronunciationRequest {
  vocabularyId: string;
  text: string;
}

export interface GeneratePronunciationResponse {
  audioUrl: string;
  cached: boolean;
}

export type TtsApiErrorCode =
  | 'tts_not_configured'
  | 'tts_invalid_provider_configuration'
  | 'tts_audio_service_unavailable'
  | 'tts_generation_timeout'
  | 'tts_generation_failed'
  | 'tts_audio_storage_failed'
  | 'tts_audio_access_failed';

export interface TtsApiErrorResponse {
  error: string;
  code?: TtsApiErrorCode;
}
```

Add runtime parsers:

```ts
parseTtsSettings(value: unknown): TtsSettings;
parseGeneratePronunciationResponse(value: unknown): GeneratePronunciationResponse;
parseTtsApiErrorResponse(value: unknown): TtsApiErrorResponse | null;
```

Validation requirements:

- provider is one of the supported values;
- `voiceId` and `model` are strings or null;
- `hasApiKey` and `cached` are booleans;
- `audioUrl` is an absolute HTTPS URL;
- request vocabulary ID and text are non-empty after trimming;
- error parsing accepts the existing `{ error: string }` shape;
- unknown response fields are ignored;
- invalid or empty JSON syntax/body is classified by `MobileApiClient` as `MobileApiError('invalid_response')`; and
- a syntactically valid but structurally invalid TTS success body is caught by the shared parser and normalized by `MobileTtsService` to `MobileTtsError('invalid_response')`.

### Web parser adoption

The web service imports and re-exports the shared types. It also uses:

- `parseTtsSettings()` for successful `GET tts/settings` responses; and
- `parseGeneratePronunciationResponse()` for successful `POST tts/generate` responses.

This preserves valid backend responses, request construction, cache behavior, and existing error-body handling. It intentionally changes only malformed 2xx success payloads from loosely accepted data into explicit validation failures. Existing web tests remain, and new parser-regression tests prove valid response behavior is unchanged.

`GET tts/audio/:id` is not used by this mobile slice and remains outside parser migration unless a dedicated shared response parser is added deliberately.

## Backend error compatibility

TTS routes add stable `code` fields to their existing JSON error responses. Existing human-readable `error` strings and HTTP statuses remain unchanged so current web behavior and tests remain valid.

Mobile uses one ordered normalization algorithm:

1. Parse the bounded server body as `TtsApiErrorResponse` when available.
2. Prefer a recognized stable `code`.
3. If no code is present, apply the exact legacy 400-message compatibility table.
4. Preserve API-client auth/session/network classifications.
5. For remaining HTTP errors, use status-based mapping.
6. Treat structural success-parser failure separately as `invalid_response`.

### Stable code mapping

| Backend code | Mobile TTS mapping |
| --- | --- |
| `tts_not_configured` | `not_configured` |
| `tts_invalid_provider_configuration` | `generation_failed` |
| `tts_audio_service_unavailable` | `service_unavailable` |
| `tts_generation_timeout` | `generation_timeout` |
| `tts_generation_failed` | `generation_failed` |
| `tts_audio_storage_failed` | `generation_failed` |
| `tts_audio_access_failed` | `generation_failed` |

### Exact legacy configuration fallback

| HTTP status | Exact legacy message | Mobile mapping |
| --- | --- | --- |
| 400 | `TTS API key not configured. Please configure in Settings.` | `not_configured` |
| 400 | `Invalid TTS provider configuration` | `generation_failed` |

### Status and API-client fallback

| API-client result | Mobile TTS mapping |
| --- | --- |
| `session_unavailable` | `session_unavailable` |
| `session_changed` | `session_changed` |
| `session_recovery_pending` | `session_recovery_pending` |
| `unauthorized` | `unauthorized` |
| `forbidden` | `forbidden` |
| `network` | `network` |
| `client` with status 400 and no recognized TTS code/message | `invalid_input` |
| Other `client` result | `generation_failed` |
| `server` with status 503 | `service_unavailable` |
| `server` with status 504 | `generation_timeout` |
| Other `server` result | `generation_failed` |
| Structurally invalid successful TTS body | `invalid_response` |

Status is sufficient for uncoded 503 and 504 responses; implementation must not require their human-readable strings. Existing uncoded 500 messages, including generation, upload, signing, or missing-bucket failures, map to `generation_failed`.

An uncoded Zod-validator 400 body is intentionally mapped by status to `invalid_input`, even though it is not shaped as `{ error: string }`. Because the mobile service validates the fixed request before dispatch, this state indicates a client/backend contract defect rather than a recoverable provider failure.

## Mobile request deadlines

### Constants

```ts
export const MOBILE_API_DEFAULT_TIMEOUT_MS = 8_000;
export const MOBILE_TTS_GENERATE_TIMEOUT_MS = 45_000;
export const MOBILE_AUTH_NETWORK_TIMEOUT_MS = 15_000;
export const MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS = 50_000;
```

The 45-second TTS budget covers the provider's 30-second cap plus response-body consumption, S3 upload, and URL signing while remaining below the 60-second Lambda timeout. The 50-second coordinator maximum prevents feature callers from disabling bounded transport while leaving a small margin before Lambda termination.

### Public API-client contract

```ts
export type MobileApiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MobileApiClient = {
  getJson(path: string, options?: MobileApiRequestOptions): Promise<unknown>;
  postJson(
    path: string,
    body: unknown,
    options?: MobileApiRequestOptions,
  ): Promise<unknown>;
};
```

Both methods use one private `requestJson()` implementation. `timeoutMs` is an overall caller deadline spanning:

- current-session selection;
- shared 401 recovery;
- the permitted authenticated replay;
- physical fetch;
- error-body consumption; and
- success-body consumption.

Omitting `timeoutMs` retains the existing eight-second default.

`GET tts/settings` uses the default. `POST tts/generate` passes `MOBILE_TTS_GENERATE_TIMEOUT_MS`.

### Replayable `postJson()` invariant

`postJson()` must:

1. Validate and serialize the supplied value with `JSON.stringify()` before dispatch.
2. Require `typeof serialized === 'string'` after `JSON.stringify()` and before coordinator dispatch, rejecting `undefined` and other non-string results (functions, symbols) as `invalid_request`.
3. Store the resulting immutable string in `RequestInit.body`.
4. Use the same serialized string for the initial authenticated attempt and the one permitted post-refresh replay.
5. Set `Content-Type: application/json` identically on both attempts.
6. Reject serialization failure as `invalid_request` before contacting the coordinator.

This client does not expose streaming bodies, `ReadableStream`, `Blob`, or `FormData`. A future API for non-replayable bodies must define its own 401/retry policy rather than silently reusing this contract.

### Coordinator request contract

Extend the coordinator request without placing nonstandard fields in `RequestInit`:

```ts
export type MobileAuthenticatedApiRequest = {
  path: string;
  init?: Omit<RequestInit, 'headers'> & { headers?: HeadersInit };
  transportTimeoutMs?: number;
};
```

The coordinator:

- defaults to `MOBILE_AUTH_NETWORK_TIMEOUT_MS` for callers without an override;
- accepts only a finite positive integer no greater than `MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS`;
- rejects invalid values as `invalid_request_timeout`, mapped by `MobileApiClient` to `invalid_request`;
- applies the timeout independently to each physical fetch attempt;
- replays the same string body once after successful 401 recovery; and
- remains subject to the API client's outer abort signal, so auth recovery and retries cannot exceed the overall deadline.

`MobileApiClient` passes the effective request timeout as `transportTimeoutMs`. If auth recovery consumes part of the overall budget, the outer signal still aborts any later attempt at the original deadline.

Authorization remains exclusively owned by `MobileAuthCoordinator`; callers cannot supply or override it.

### Deadline outcomes

- A backend 504 response is `MobileTtsError('generation_timeout')`.
- A client/coordinator deadline that expires before an HTTP response is `MobileTtsError('network')`, because the client cannot prove the provider timed out.
- Caller cancellation remains `AbortError`, not a timeout or TTS failure.
- No automatic network retry occurs after a 45-second deadline.

## Mobile API error contract

```ts
export const MOBILE_API_MAX_ERROR_BODY_BYTES = 16_384;

export type MobileApiErrorCode =
  | 'invalid_request'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'client'
  | 'network'
  | 'server'
  | 'invalid_response';

export type MobileApiErrorDetails = {
  status?: number;
  serverBody?: unknown;
  serverMessage?: string;
  cause?: unknown;
};

export class MobileApiError extends Error {
  readonly details: MobileApiErrorDetails;

  constructor(code: MobileApiErrorCode, details: MobileApiErrorDetails = {}) {
    super(code, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'MobileApiError';
    Object.defineProperty(this, 'details', {
      value: details,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}
```

The conditional `ErrorOptions` preserves today's behavior: an error created without a cause does not gain an own `cause` property, while existing call sites passing `{ cause }` preserve the chain.

### Error-body bounds and redaction

Every non-2xx body is consumed through one bounded reader before JSON parsing:

- read no more than `MOBILE_API_MAX_ERROR_BODY_BYTES` of UTF-8 payload;
- apply the same byte limit to JSON and text responses;
- parse JSON only from the bounded payload;
- retain a bounded/truncated `serverMessage` when JSON parsing is unavailable;
- preserve HTTP classification even when the body is malformed or exceeds the limit; and
- never retain the unread remainder.

`details.serverBody` and `details.serverMessage` are domain-internal inspection data. They must never be:

- rendered in a component;
- included in telemetry or diagnostics;
- logged directly or through `console.error(error)`;
- spread into another object; or
- serialized as part of the verification record.

Callers log only an explicit safe summary containing the stable error code and HTTP status. Tests prove details are non-enumerable, bounded, and absent from safe diagnostics.

### Response mapping

| Result | Mobile API result |
| --- | --- |
| 2xx with valid JSON | Return parsed value |
| 2xx with invalid/empty required JSON | `invalid_response` |
| 400–499 except 401/403 | `client`, retaining bounded internal detail |
| 401 | Existing `unauthorized` behavior after coordinator recovery rules |
| 403 | Existing `forbidden` behavior |
| 500–599 | `server`, retaining bounded internal detail |
| Transport rejection/deadline | Existing `network` or session-recovery behavior |
| Caller abort | Preserve `AbortError` |

### Intentional due-count behavior migration

Today, every non-2xx response other than 401/403 collapses to `server`, so an unexpected SRS 400 is eligible for the due-count query's existing `network`/`server` retry rule. After this change, the same response becomes deterministic `client` and is not retried.

This is intentional. The retry predicate itself remains unchanged, but its input classification becomes more precise. Tests pin:

- due-count `400` → `client` → no retry;
- due-count `500` → `server` → retry under the existing limit; and
- network failure → `network` → retry under the existing limit.

## Mobile TTS service

### Public contract

```ts
export type MobilePronunciationInput = {
  userId: string;
  vocabularyId: string;
  text: string;
};

export type PreparationTimings = {
  settingsMs: number;
  generateMs: number;
};

export type PreparedPronunciation = {
  audioUrl: string;
  source: 'memory-cache' | 'server-cache' | 'generated';
  expiresAt: number;
  timings: PreparationTimings;
};

export type MobileTtsErrorCode =
  | 'invalid_input'
  | 'not_configured'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'service_unavailable'
  | 'generation_timeout'
  | 'generation_failed'
  | 'invalid_response';

export class MobileTtsError extends Error {
  constructor(
    readonly code: MobileTtsErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileTtsError';
  }
}

export type MobileTtsService = {
  preparePronunciation(
    input: MobilePronunciationInput,
    options?: { signal?: AbortSignal },
  ): Promise<PreparedPronunciation>;
  invalidatePronunciation(userId: string, vocabularyId: string): void;
  clearUser(userId: string): void;
  clearAll(): void;
};
```

`PreparedPronunciation.source` and `timings` are diagnostic metadata only. They must not become final learner-facing product copy or telemetry without UX/privacy review.

### Settings-read decision

Every new logical preparation reads `GET tts/settings` before selecting a settings-partitioned URL or pending generation. HPA-208 deliberately does not add a settings cache because settings are server-authoritative and may change through the web app. A stale settings cache could label or retain generated audio under an obsolete client partition while the backend has already switched provider, voice, or model.

This extra round trip can consume user-activation time. The diagnostic therefore records separately:

- settings request latency;
- generation/cache response latency;
- total tap-to-`audioPlayer.play()` invocation latency; and
- whether WebKit accepted that asynchronous play attempt.

The prepared direct-tap path remains the audibility and HTML-player acceptance gate, so a slow settings request cannot falsely reject the playback adapter itself. HPA-210 can still use the separate timing evidence to decide whether later product screens should prefetch or version TTS settings.

### Preparation algorithm

For one logical preparation:

1. Validate non-empty `userId`, `vocabularyId`, and `text`.
2. Start settings timing.
3. Fetch and validate `GET tts/settings` through `MobileApiClient` using the default eight-second deadline.
4. Record settings timing.
5. If `hasApiKey` is false, throw `MobileTtsError('not_configured')` without calling generation.
6. Construct the full key from user ID, vocabulary ID, provider, voice, and model.
7. Return a live URL from the in-memory cache when present, with `generateMs: 0`.
8. Join an existing pending generation for that full settings-derived key when present.
9. Start generation timing for the owning caller.
10. Call `POST tts/generate` with exactly `{ vocabularyId, text }` and the 45-second deadline.
11. Validate the response and record generation timing.
12. Cache the URL for 14 minutes from receipt when invalidation generations still match.
13. Return source `server-cache` when the backend says `cached: true`; otherwise return `generated`.
14. Remove the pending record in `finally` if it still owns the key.

Concurrent callers may each read settings, but generation is shared only after the provider/voice/model partition is known. A settings change cannot cause a caller to join work for the previous settings key.

### Backend text/cache precondition

The backend does not verify that `vocabularyId` exists in the vocabulary table, and its S3 key includes user, vocabulary ID, and settings hash—but not `text`. Consequently, two requests using the same user/vocabulary/settings tuple with different text can return silently incorrect cached audio.

HPA-208 does not call this a backend invariant. It establishes an explicit client precondition:

- the diagnostic always sends the fixed pair `水:ミズ` → `水`;
- the mobile service's client cache identity mirrors the backend identity and therefore also excludes text;
- no HPA-208 surface accepts arbitrary or alternate text; and
- any future feature that may vary text for one vocabulary ID must first redesign or validate the backend cache identity.

Including text only in the client key would not fix the server collision, so HPA-208 keeps both identities aligned and documents the limitation.

### URL cache

Use the established web semantics:

- TTL: 14 minutes, one minute shorter than the backend presigned URL;
- maximum entries: 300;
- LRU-style refresh on access;
- periodic five-minute expired-entry sweep plus per-key expiration check;
- key components encoded before joining;
- user and TTS-setting isolation; and
- no persistent storage.

Cache key:

```text
userId | vocabularyId | provider | voiceId | model
```

The cache never stores provider API keys, bearer tokens, or complete settings records.

### Same-key pending work and cancellation

The service shares the underlying generation promise for identical full keys. A caller abort detaches that caller but does not cancel work still useful to another caller.

Maintain two invalidation generations:

- a per-user generation for sign-out/identity cleanup; and
- a per-user-and-vocabulary generation for targeted media invalidation.

Pending work captures both generations. A result may populate the cache only if both still match.

### Targeted invalidation semantics

`invalidatePronunciation(userId, vocabularyId)` must:

1. Increment the user/vocabulary invalidation generation.
2. Remove every cached entry for that user and vocabulary across all provider, voice, and model partitions.
3. Remove every matching pending record from the deduplication index so new callers cannot join stale work.
4. Not forcibly abort underlying work still needed by existing callers.
5. Prevent any detached stale completion from repopulating the cache.

`clearUser(userId)` increments the user generation, removes all of that user's cache entries, and removes their pending records from the join index. `clearAll()` is reserved for application disposal and tests. Normal auth cleanup is user-scoped.

## Pronunciation preparation retry policy

Network, provider, uncoded validator, other 4xx, 5xx, and client deadline failures are manual-only. The controller shows an enabled Retry control after the current attempt settles. There is no exponential backoff and no automatic repeat of a potentially expensive or ambiguously completed generation request.

The following auth-control cases are exceptions because they represent coordinator state transitions rather than product transport retries.

### Same-user control race

When preparation receives `session_changed` or `session_unavailable`, retry the complete logical preparation exactly once when all are true:

- the caller signal is not aborted;
- the current feature-session selector is usable;
- the authenticated user ID is unchanged; and
- no control-race retry has already been consumed for this user action.

A second control error becomes visible and requires explicit retry.

### Session recovery pending

When preparation receives `session_recovery_pending`:

- retain the same user/action identity;
- present a recovering/preparing state rather than a hard network error;
- wait for the same user's feature session to become usable; and
- retry the logical preparation once.

Identity replacement, sign-out, component teardown, or a second recovery failure cancels this continuation.

### Separation from URL refresh

The one automatic refresh after `media_unavailable` is an expiring-URL recovery rule, not a prepare transport retry. It has its own maximum of one refresh per tap. A network/provider failure during that refresh is shown immediately and is not automatically retried.

## Mobile audio boundary

### Contract

```ts
export type MobileAudioPlaybackOutcome =
  | { kind: 'ended' }
  | { kind: 'stopped'; reason: 'restart' | 'user' | 'dispose' }
  | { kind: 'interrupted'; reason: 'background' | 'external' };

export type MobileAudioErrorCode =
  | 'gesture_required'
  | 'media_unavailable'
  | 'playback_failed';

export class MobileAudioError extends Error {
  constructor(
    readonly code: MobileAudioErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileAudioError';
  }
}

export type MobileAudioPlaybackHandle = {
  finished: Promise<MobileAudioPlaybackOutcome>;
  stop(reason?: 'restart' | 'user' | 'dispose'): void;
};

export type MobileAudioPlayer = {
  play(url: string): MobileAudioPlaybackHandle;
  interruptActive(reason: 'background' | 'external'): void;
  dispose(): void;
};
```

This interface deliberately excludes browser types. A later native implementation can preserve the same learning-feature contract.

### `HtmlAudioPlayer`

The HTML implementation:

- owns at most one active `HTMLAudioElement`;
- stops and settles the previous playback as `restart` before starting another;
- creates an element with the presigned URL and `preload = 'auto'`;
- invokes `play()` immediately in `play()`;
- maps `NotAllowedError` to `gesture_required`;
- maps media element errors to `media_unavailable`;
- maps other `play()` rejection to `playback_failed`;
- maps `ended` to successful completion;
- treats an unexplained `pause` while active as an external interruption;
- removes all listeners when settled;
- resets `currentTime`, clears `src`, and releases the element during stop/dispose where safe; and
- settles each handle exactly once.

Required ordering invariant for restart, explicit stop, and dispose:

1. Mark the current handle settled with the intended stopped outcome.
2. Remove or disable the `pause` listener and clear active ownership.
3. Only then call `audio.pause()`, reset `currentTime`, or clear `src`.

The synchronous `pause` event caused by the adapter's own cleanup must never be reclassified as an external interruption. Tests exercise synchronous pause dispatch and prove restart/stop/dispose retain their intended outcome.

The adapter must not set `crossOrigin` unless device evidence demonstrates a need and the bucket policy is changed accordingly.

## Pronunciation controller

### State model

```ts
export type PronunciationDiagnosticState =
  | { kind: 'idle' }
  | { kind: 'preparing'; attempt: number; recoveringSession: boolean }
  | { kind: 'ready'; pronunciation: PreparedPronunciation; notice: ReadyNotice | null }
  | { kind: 'playing'; pronunciation: PreparedPronunciation }
  | {
      kind: 'interrupted';
      pronunciation: PreparedPronunciation;
      reason: 'background' | 'external';
    }
  | {
      kind: 'error';
      error: PronunciationDiagnosticError;
      pronunciation: PreparedPronunciation | null;
    };
```

The controller keeps the prepared URL while it is locally live, including after a gesture-required failure, interruption, or explicit stop.

### Tap from `idle`

1. Capture the tap timestamp.
2. Transition to `preparing`.
3. Prepare pronunciation under the retry policy above.
4. Save the returned pronunciation.
5. Before calling `audioPlayer.play()`, check `lifecycle.isActive.value`. If the app became inactive during the asynchronous preparation, skip autoplay and transition to `ready` with the prepared pronunciation instead of playing.
6. When still active, immediately call `audioPlayer.play()` in the continuation of the original tap.
7. Record tap-to-play-attempt latency and whether iOS accepts or rejects playback after the asynchronous request chain.

Failure of this asynchronous first-tap play is not by itself an HTML-audio rejection. The diagnostic may enter `ready` and complete acceptance through a direct second tap. Deactivation during preparation produces the same `ready` state with no autoplay attempt, so a backgrounded first tap never starts playback.

### Tap from `ready` or `interrupted`

1. Compare `Date.now()` with `pronunciation.expiresAt` before creating an audio element.
2. If the URL is still live, call `audioPlayer.play()` synchronously. This is the prepared direct-user-gesture path used for audibility and silent-switch acceptance.
3. If the URL is expired, invalidate all settings partitions for the user/vocabulary pair and prepare a fresh URL instead of intentionally attempting stale playback.
4. After asynchronous refresh, attempt playback once and retain the normal gesture-required second-tap fallback.

Ready replay with a live URL performs no settings or generate request.

### Tap during `preparing`

Ignore the tap and keep the control disabled. The service additionally protects against duplicate generation requests.

### Tap during `playing`

Stop the active handle with reason `restart`, seek to the beginning through the adapter, and start one replacement playback. Audio never overlaps.

### Playback results

| Result | Controller behavior |
| --- | --- |
| Ended | Return to `ready`; increment completed-play count |
| Restart/user stop | Return to `ready` unless a replacement already owns the state |
| Background interruption | Enter `interrupted`; retain locally live URL |
| External interruption | Enter `interrupted`; retain locally live URL |
| Gesture required | Enter `ready` with “Audio is prepared. Tap again to play.” |
| Media unavailable | Invalidate every user/vocabulary settings partition and enter recoverable expired/media state |
| Other playback failure | Enter recoverable error retaining URL only when safe |

### Expired or invalid URL recovery

`HTMLMediaElement` does not reliably expose the HTTP status causing a load failure. A media failure is treated as a possibly expired or invalid URL:

1. Stop and discard the failed element.
2. Invalidate all user/vocabulary URL-cache partitions.
3. Refresh the pronunciation through `MobileTtsService` once.
4. Enter `ready` with “Audio was refreshed. Tap to play again.”
5. Do not autoplay after failure-driven refresh, because the asynchronous recovery may no longer carry user activation.

If refresh fails, show the mapped TTS error. The controller performs at most one automatic URL refresh per tap; further attempts require explicit user retry.

## Lifecycle behavior

Extend `apps/vela-mobile/src/services/mobile-lifecycle.ts` with one canonical state-change API:

```ts
export const mobileLifecycleState = {
  isActive: Readonly<Ref<boolean>>;
  resumeCount: Readonly<Ref<number>>;
  lastResumeAt: Readonly<Ref<number | null>>;
  lastStateChangeAt: Readonly<Ref<number | null>>;
  lastBecameActiveAt: Readonly<Ref<number | null>>;
  lastBecameInactiveAt: Readonly<Ref<number | null>>;
};

export function recordAppStateChange(isActive: boolean, at = Date.now()): void;
export function recordAppResume(at = Date.now()): void;
```

The existing `appStateChange` listener in `apps/vela-mobile/src/boot/capacitor-lifecycle.ts` calls `recordAppStateChange(event.isActive)` and then updates TanStack's `focusManager`. The existing `resume` listener in the same boot file continues calling `recordAppResume()`; state changes do not increment the resume counter, avoiding double counting.

`apps/vela-mobile/src/services/mobile-auth.ts` already owns a separate auth-private `appStateChange` listener for refresh/session behavior. It remains auth-private and does not also write shared lifecycle state. HPA-208 adds no third native lifecycle listener.

The pronunciation controller observes `mobileLifecycleState.isActive`.

When the app becomes inactive:

- call `audioPlayer.interruptActive('background')`;
- do not attempt background playback; and
- preserve the prepared URL only while it remains within its local TTL.

When the app becomes inactive during an asynchronous first-tap preparation (before `audioPlayer.play()` is called), the preparation completes but the controller checks `lifecycle.isActive.value` before invoking playback. If inactive, it transitions to `ready` with the prepared pronunciation and skips autoplay entirely. The resulting state is `ready`, not `playing`, so no background playback is attempted.

When the app becomes active:

- do not auto-resume;
- display the interrupted state; and
- allow an explicit replay tap, applying the proactive expiry check first.

Component unmount stops active playback with reason `dispose` and aborts/detaches preparation owned by the component.

## Silent-switch and native audio-session decision

Pronunciation is core learning content, not incidental UI feedback. The MVP product rule is:

> While the app is foregrounded, a prepared direct pronunciation tap must produce audible output when media volume is nonzero, even when the iPhone Ring/Silent switch is set to silent.

The asynchronous initial tap may prepare audio without producing sound when WebKit no longer considers the continuation user-activated. That is acceptable when the diagnostic reaches `ready` and a direct second tap plays audibly. Silent-switch and normal-audibility gates are measured on that prepared direct-tap path.

The physical-device matrix determines one of three outcomes:

1. **HTML-only accepted:** `HtmlAudioPlayer` meets playback, silent-switch, interruption, and resource gates without native audio-session work.
2. **Native audio-session integration required:** HTML decoding/playback remains reliable, but the app must configure an appropriate `AVAudioSession` category such as `.playback`. The follow-up should preserve `HtmlAudioPlayer` unless evidence shows player replacement is also necessary.
3. **Native player adapter required:** HTML media remains unreliable after correct CORS and audio-session configuration, or required interruption/player controls cannot be implemented while retaining the adapter.

Silent-mode inaudibility automatically rejects the HTML-only outcome. It does not by itself prove that a full native player is required.

## Diagnostic surface

### Route construction and authentication invariants

Use the existing path convention:

```text
/diagnostics/tts-pronunciation
```

The More page provides the entry, but the URL is not nested under `/more`. The route is rendered inside the authenticated mobile shell and must not set `meta.bypassMobileAuth`.

Preserve the current bypass-route safety test by splitting route declarations:

```ts
export const bypassDevelopmentDiagnosticRoutes: RouteRecordRaw[] = [
  // Existing iOS interaction root and detail routes.
  // Every entry explicitly sets meta.bypassMobileAuth = true.
];

export const authenticatedDevelopmentDiagnosticRoutes: RouteRecordRaw[] = [
  // TTS pronunciation route.
  // No entry may set meta.bypassMobileAuth = true.
];

export const developmentDiagnosticRoutes: RouteRecordRaw[] = [
  ...bypassDevelopmentDiagnosticRoutes,
  ...authenticatedDevelopmentDiagnosticRoutes,
];
```

`buildMobileChildRoutes()` still accepts the combined collection. Tests retain a meaningful `every(... === true)` assertion on `bypassDevelopmentDiagnosticRoutes`, add the inverse assertion on `authenticatedDevelopmentDiagnosticRoutes`, and verify the combined development route list contains both groups. The implementation must not simply delete the existing bypass guard.

Production builds contain neither the route nor the More entry. Extend the production-diagnostics scanner and route tests to prove their absence.

### Known word

```ts
const DIAGNOSTIC_WORD = {
  vocabularyId: '水:ミズ',
  text: '水',
  reading: 'みず',
  translation: 'water',
} as const;
```

The identifier follows the standard seed convention, but the TTS backend does not query the vocabulary table. The page does not query vocabulary APIs and does not allow arbitrary text.

### Presentation

Minimum visible content:

```text
Pronunciation diagnostics

水
みず · water

[Play pronunciation]

State: Ready
Source: memory cache / server cache / generated
Settings latency: …
Generation latency: …
Tap-to-play attempt: …
Playback adapter: HTML audio
Last outcome: Completed
```

`Source` and latency fields are diagnostic-only metadata and are not approved learner-facing product copy.

Expose accessible states through `role="status"`, `aria-live="polite"`, and `role="alert"` where appropriate. The control label reflects state:

- Prepare and play pronunciation;
- Preparing pronunciation;
- Replay pronunciation;
- Restart pronunciation; or
- Retry pronunciation.

### Development controls and counters

A collapsed development section may provide:

- invalidate the current user/vocabulary across all settings partitions;
- simulate one invalid URL by replacing only the current diagnostic copy with a known-unreachable HTTPS URL;
- clear diagnostic counters;
- show preparation count, backend source, settings latency, generation latency, tap-to-play latency, playback attempts, completed plays, gesture rejections, interruptions, URL refreshes, and last classified error;
- show current app active state; and
- show the observed native audio-session category when safely available, without making that observation a player dependency.

Never render the complete presigned URL because its query string contains temporary credentials. Display only the URL host and a redacted path suffix when needed for debugging.

Never display or log `MobileApiError.details.serverBody` or `serverMessage`.

## User-facing states

| Condition | Message/action |
| --- | --- |
| Initial | “Tap to prepare and play 水.” |
| Preparing | “Preparing pronunciation…” |
| Recovering session | “Refreshing your session…” |
| Playing | “Playing 水…” |
| Completed | “Pronunciation completed.” Replay available |
| Gesture rejected | “Audio is prepared. Tap again to play.” |
| Locally expired | “Refreshing expired audio…” then normal play or second-tap fallback |
| Interrupted | “Playback was interrupted. Tap to replay.” |
| TTS not configured | “Pronunciation is not configured for this account. Configure TTS in Vela web settings.” |
| Invalid request contract | “Vela couldn’t prepare this pronunciation.” No automatic retry |
| Network/deadline failure | “Vela couldn’t load pronunciation. Check your connection and try again.” Manual Retry |
| Provider timeout response | “Pronunciation generation timed out. Try again.” Manual Retry |
| Service unavailable | “Pronunciation is temporarily unavailable. Try again.” Manual Retry |
| URL refreshed | “Audio was refreshed. Tap to play again.” |
| Playback failure | “Vela couldn’t play this pronunciation. Try again.” |
| Silent-mode failure | Diagnostic records native audio-session integration as required; do not misreport completion as audible success |

## Authentication and user isolation

The page is enabled only while the feature-session selector reports a usable authenticated session.

The controller passes the current authenticated user ID to `MobileTtsService` solely for client-side cache partitioning. The user ID is never sent in the request body; the backend derives identity from the verified Cognito token.

Install a focused TTS auth-isolation watcher or equivalent service hook:

- identity replacement clears only the previous user's TTS cache/pending index and stops current audio;
- sign-out clears only the previous user's TTS cache/pending index and stops current audio;
- unusable session recovery detaches/aborts the current diagnostic operation without globally clearing successor state;
- stale pending completion cannot cache after targeted or user invalidation; and
- a null-to-user transition performs no cleanup.

Do not call `queryClient.clear()` or expose token material to the TTS service.

## S3 and WebKit CORS decision

The Vela API already permits `capacitor://localhost`. The TTS audio bucket currently permits configured web frontend origins and local web development origins, but not necessarily the Capacitor origin.

Ordinary media-element loading may work without an explicit CORS grant because the page does not read media bytes or draw them to a canvas. WKWebView behavior must be measured rather than assumed.

Therefore:

1. Do not modify the bucket CORS policy before device testing.
2. Test a valid presigned URL in Simulator and on a physical iPhone.
3. Record console/native evidence if loading fails.
4. Only when evidence identifies origin/CORS rejection, add the exact approved Capacitor origin to GET/HEAD CORS.
5. Preserve current web origins and infrastructure tests.
6. Never use `*` as the allowed origin.

A required bucket-policy correction remains within HPA-208. A native plugin adopted solely to bypass a correctable bucket CORS policy is not the preferred outcome.

## Testing

### Shared-contract and web-regression tests

Cover:

- all supported providers;
- null voice/model;
- missing and invalid fields;
- HTTPS URL validation;
- cached true/false;
- existing error-only responses;
- coded error responses;
- exact legacy 400 fallback messages and statuses;
- unknown-field tolerance;
- web settings valid-response behavior through the shared parser;
- web generate valid-response/cache behavior through the shared parser; and
- malformed web success responses fail explicitly without changing existing non-2xx error handling.

### API-client and coordinator tests

Cover:

- POST method and JSON body;
- JSON serialization failure before dispatch;
- coordinator-owned Authorization;
- rejection of caller Authorization remains intact;
- default eight-second overall deadline;
- accepted 45-second request override;
- invalid, zero, non-integer, and over-maximum timeout rejection;
- coordinator default 15-second physical timeout retained;
- coordinator per-request transport override;
- outer deadline still caps auth recovery plus retried transport;
- caller abort;
- total deadline across transport and body consumption;
- initial POST returns 401, refresh succeeds, and one replay uses the identical method, content type, and serialized body;
- no empty, consumed, or reserialized body on replay;
- no second replay after the retried request;
- session recovery mappings;
- 2xx JSON success;
- 4xx `client` classification with bounded JSON and text detail;
- 5xx `server` classification with bounded detail;
- JSON and text payloads exceeding the error-body byte limit are truncated/discarded safely;
- details are non-enumerable and absent from safe diagnostic serialization;
- malformed success JSON;
- existing `{ cause }` call sites preserve `Error.cause` and `MobileApiError.name`;
- no own `cause` property when cause is omitted;
- due-count 400 is classified `client` and is not retried;
- due-count 500 remains `server` and is retried under the existing limit; and
- due-count network failure remains retryable under the existing limit.

### Mobile TTS service tests

Cover:

- settings uses the default deadline;
- generate uses the 45-second deadline;
- successful cold generation under the raised budget;
- deadline expiry mid-generate maps to `network`;
- server 504 maps to `generation_timeout`;
- exact settings and generate paths;
- exact generation request body;
- user ID absent from the request body;
- not-configured settings short-circuit;
- ordered stable-code, legacy-message, API-code, and status mapping;
- uncoded Zod-validator-shaped 400 maps to `invalid_input`;
- status-only 503 and 504 mapping without message matching;
- uncoded 500 generation/upload/signing messages map to `generation_failed`;
- JSON-syntax versus structural-response error attribution;
- no raw server detail is rendered or logged;
- settings and generation timings are recorded separately;
- 14-minute cache TTL and five-minute sweep;
- per-user, provider, voice, model, and vocabulary isolation;
- settings fetched before full-key pending lookup;
- same-full-key pending generation sharing;
- settings change creates a distinct pending/cache key;
- ready replay performs no settings request;
- distinct-key independence;
- failed pending-request cleanup;
- bounded LRU eviction;
- targeted invalidation removes all settings partitions;
- targeted invalidation prevents new callers joining stale pending work;
- stale pending completion cannot repopulate after invalidation;
- fixed diagnostic pair is used consistently;
- sign-out generation guard; and
- redaction/no-secret logging.

### Audio-adapter tests

Use an injected audio-element factory rather than replacing global behavior throughout the suite.

Cover:

- successful end;
- `NotAllowedError` gesture rejection;
- media error;
- generic play rejection;
- unexplained pause interruption;
- restart stops the previous element;
- explicit stop and dispose;
- synchronous pause generated by restart/stop/dispose is ignored after settlement;
- external pause before settlement remains an interruption;
- listener cleanup;
- exactly-once settlement; and
- one active element invariant.

### Controller and lifecycle tests

Cover:

- idle to preparing to playing to ready;
- asynchronous first-tap playback attempt;
- separate settings, generate, and tap-to-play timing recording;
- gesture fallback retaining URL;
- direct second-tap playback;
- same-user `session_changed`/`session_unavailable` control race retries once;
- second control race remains visible;
- `session_recovery_pending` retries once when the same user becomes usable;
- identity change cancels pending recovery continuation;
- network/provider/server/invalid-input failure has no automatic retry;
- explicit Retry starts one new preparation;
- ready direct tap with live URL;
- ready replay does not fetch settings;
- ready direct tap with expired URL refreshes before creating an audio element;
- proactive refresh gesture rejection retains the fresh URL for a second tap;
- rapid taps during preparation;
- rapid taps during playback causing restart without overlap;
- background interruption and explicit replay;
- external interruption;
- media failure, one URL refresh, and no autoplay;
- URL refresh is separate from transport retry and does not loop;
- refresh failure;
- not-configured state;
- identity change and sign-out;
- component teardown;
- stale asynchronous completion unable to overwrite successor state;
- `recordAppStateChange()` updates active state and timestamps without incrementing resume count;
- `boot/capacitor-lifecycle.ts` feeds shared lifecycle state exactly once per event; and
- the auth-private listener does not duplicate shared lifecycle updates.

### Component and route tests

Cover:

- every visible state and message;
- accessible control labels and live regions;
- counters and redaction;
- authenticated `/diagnostics/tts-pronunciation` behavior;
- no auth bypass metadata on authenticated diagnostic routes;
- all existing bypass routes remain explicitly marked;
- the all-bypass `every(...)` assertion remains on `bypassDevelopmentDiagnosticRoutes`;
- combined development route construction includes both route groups;
- development-only More entry;
- development-only route registration; and
- production build exclusion.

### Backend and infrastructure tests

Cover stable TTS error codes while preserving existing messages and statuses.

Only if CORS changes are required, add tests proving:

- exact Capacitor origin allowed for TTS GET/HEAD;
- existing web origins remain allowed; and
- arbitrary origins remain rejected.

## Verification matrix

Run the applicable matrix on at least one current iOS Simulator and one physical development iPhone.

| Scenario | Simulator | Physical iPhone | Required evidence |
| --- | --- | --- | --- |
| Restored authenticated session | Required | Required | User reaches diagnostic without sign-in prompt while session valid |
| Account has configured TTS | Required | Required | Settings reports configured; no key shown |
| First server-cache request | Required | Required | Settings latency, generate/cache latency, and source recorded |
| First uncached generation | Required | Required | Separate settings and generation timing; completes inside 45-second budget or produces classified failure |
| One-tap async prepare-and-play | Required | Required | Tap-to-play-attempt latency and accepted/gesture-rejected result recorded; not itself the silent-mode gate |
| Prepared direct-tap playback | Required | Required | Audible expected Japanese pronunciation |
| Normal media volume, Ring/Silent off | Required | Required | `水` decodes and is audibly pronounced as expected without media error |
| Ring/Silent on, media volume nonzero | Not applicable | Required | Prepared direct tap is human-observed as audible/inaudible on device speaker; native-integration conclusion recorded |
| Ten consecutive prepared replays | Required | Required | Success/failure count; no settings requests during live replay |
| Rapid taps while preparing | Required | Required | One settings-derived generation request |
| Rapid taps while playing | Required | Required | No overlap; deterministic restart |
| Locally expired ready item | Required | Required | Refresh occurs before stale audio element creation |
| Network disabled before prepare | Required | Required | Actionable error, no automatic retry, explicit retry succeeds |
| Client deadline during generate | Automated | Best effort | Classified as network; no automatic repeat |
| Backend provider timeout | Automated | Best effort | 504 classified as generation timeout |
| Invalid/expired URL simulation | Required | Required | Failure-driven refresh then explicit replay succeeds |
| Background during preparation | Required | Required | No stuck state |
| Background during playback | Required | Required | Interrupted, no background continuation, replay succeeds |
| External/system audio interruption | Best effort | Required | Outcome and limitation recorded |
| Sign-out while ready | Required | Required | User cache cleared; route inaccessible |
| Sign-out while playing | Required | Required | Playback stops and state clears |
| Relaunch and replay | Required | Required | Auth restoration plus new successful playback |

Audibility is a manual physical observation. Media `play`, `playing`, and `ended` events demonstrate element state but do not prove that a person heard sound. Record whether evidence used the built-in speaker; optional headphone or Bluetooth observations are separate and do not replace the speaker silent-switch test.

Use a test account already configured through the web application. Record provider and non-secret voice/model identifiers, but never record the provider key, bearer token, complete signed URL, or bounded internal server body.

## HTML and native-audio acceptance gates

### HTML-only accepted

HTML-only playback is acceptable for the MVP only when physical-device evidence shows all of the following:

1. A valid backend audio object decodes without media error and audibly produces the expected Japanese pronunciation at normal media volume.
2. A prepared direct tap reliably produces audible Japanese pronunciation.
3. Foreground prepared direct-tap pronunciation remains audible with Ring/Silent on and media volume nonzero.
4. Ten consecutive replays succeed without intermittent stuck or silent states.
5. Rapid taps never create overlapping audio.
6. Rapid taps never create duplicate settings-derived generation requests.
7. Proactively expired and invalid URLs recover without a stale-loop or stuck state.
8. Backgrounding and foregrounding leave the controller in a recoverable state.
9. A normal external interruption leaves the controller replayable.
10. Sign-out and teardown stop playback and clear user-scoped cached URLs.
11. No provider key, Cognito token, signed URL, or raw server error detail is present in the bundle, logs, or diagnostic UI.
12. Any asynchronous first-tap gesture limitation is acceptable through a documented prepare-then-direct-play interaction.

### Native audio-session integration required

A native iOS audio-session follow-up is required when HTML decoding and player lifecycle are otherwise reliable, but one or more of these hold:

- prepared direct-tap playback is inaudible with Ring/Silent on;
- the app needs an audio-session category or interruption policy unavailable to JavaScript; or
- the observed default session behavior conflicts with the foreground pronunciation product rule.

The first follow-up should configure and verify the minimal app-level audio-session behavior while preserving `MobileAudioPlayer` and `HtmlAudioPlayer`. It must not add background modes merely to satisfy foreground silent-switch playback.

### Native player adapter required

A native player follow-up is required when physical evidence shows one or more of:

- prepared direct-tap playback remains intermittent after correct audio-session configuration;
- valid presigned URLs cannot be loaded reliably after correct CORS configuration;
- interruption leaves the HTML element permanently unusable;
- repeated playback leaks or accumulates active media elements;
- required player or route controls cannot be expressed through the current interface and HTML implementation; or
- the product cannot tolerate the demonstrated gesture interaction and native playback demonstrably resolves it.

Every follow-up must identify the failed criterion and preserve the `MobileAudioPlayer` consumer contract unless evidence requires a contract revision. HPA-208 does not select a plugin without that evidence.

## Verification record

Implementation creates or updates:

```text
apps/vela-mobile/docs/tts-pronunciation-ios.md
```

The record contains:

- tested app commit;
- Xcode, iOS, Quasar, Capacitor, and device versions;
- test account configuration status without secrets;
- the completed matrix;
- settings latency;
- server-cache/generation latency;
- total tap-to-play-attempt latency;
- first uncached-generation timing;
- first-tap gesture result;
- prepared direct-tap normal-volume audibility result;
- Ring/Silent-switch prepared direct-tap result;
- human-observation output route;
- URL-expiration and interruption observations;
- any required CORS correction;
- known limitations, including the unenforced vocabulary ID/text cache convention;
- final `HTML-only accepted`, `native audio-session integration required`, or `native player adapter required` decision; and
- links to any follow-up Linear issues.

HPA-210 consumes this record during the Milestone 1 architecture review.

## Acceptance-criteria mapping

| HPA-208 criterion | Design evidence |
| --- | --- |
| Signed-in user hears one Japanese pronunciation on physical iPhone | Authenticated diagnostic, fixed `水` item, prepared direct-tap human audibility matrix |
| Repeated playback has no duplicate request or accidental overlap | Settings-derived service single-flight, controller tap rules, one-active-element adapter |
| Auth, generation, expiration, and playback failures are actionable | Structured API/TTS/audio errors, bounded deadlines/details, manual retry, and explicit view states |
| No provider key bundled | Server-side settings only; secret scan and redacted diagnostics |
| Web TTS remains compatible | Shared parser adoption with valid-response regression tests and unchanged non-2xx messages/statuses |
| HTML versus native conclusion recorded | Physical silent-switch/session/player gates and verification record |

## Risks and mitigations

### Cold generation exceeds ordinary mobile deadlines

All providers may run for 30 seconds before the backend returns 504, and S3 work follows successful generation. The default eight-second client deadline and 15-second coordinator timeout remain for normal requests, while generate explicitly receives a 45-second overall and transport budget. Automated tests prove both layers honor the override.

### Ambiguous client versus provider timeout

A backend 504 proves the provider timed out and maps to `generation_timeout`. A client-side abort before an HTTP response cannot prove provider outcome and maps to `network`; no automatic repeat risks duplicating expensive or ambiguously completed work.

### Replayable POST dependency

The coordinator may replay an authenticated request after 401 recovery. `postJson()` serializes to a stable string before dispatch, making the body replayable. HPA-208 does not generalize this behavior to streams or multipart bodies.

### Validator response shape

Hono/Zod validation failures do not necessarily use the TTS `{ error }` contract. An uncoded generate 400 therefore maps by status to `invalid_input`, and tests use the validator-shaped body rather than assuming a TTS error message.

### Settings latency and user activation

A settings request before generation increases the asynchronous gap after the first tap. HPA-208 keeps settings server-authoritative, records settings and generation latency separately, and uses the prepared direct-tap path to judge playback reliability. A later product slice may add prefetch or versioned settings caching using this evidence.

### Unenforced vocabulary ID/text convention

The backend cache key omits text. HPA-208 is safe only because it sends one fixed identifier/text pair. Future alternate-text use requires a backend cache-contract change; adding text only to the mobile key is insufficient.

### Error-detail leakage

The API client retains only a bounded internal server payload, marks details non-enumerable, and forbids rendering or wholesale error logging. Safe diagnostics contain stable code and status only.

### Silent switch and default audio session

The default iOS audio session is silenced by Ring/Silent. Silent-mode audibility is an explicit product requirement, so HTML-only acceptance is impossible if prepared direct-tap evidence confirms the default behavior. The design distinguishes minimal native session configuration from full native player replacement.

### Asynchronous user activation

A network request may consume the original tap's user-activation window. The controller attempts one-tap playback, records attributable timing, and supports a prepared second tap without repeating generation. Audibility and silent-switch gates use the prepared direct-tap path.

### Presigned URL expiry

The local TTL expires one minute before the server URL. The controller checks `expiresAt` before ready playback. Media failures still invalidate every settings partition and refresh once because device sleep, clock behavior, or external invalidation can outlive the local assumption.

### Ambiguous media errors

HTML media errors do not reliably identify HTTP status. Recovery treats the first media error as possibly stale, refreshes once, then surfaces a playback error rather than looping.

### Self-generated pause events

`pause()` may dispatch synchronously. The adapter settles and detaches interruption listeners before invoking cleanup methods, preventing its own restart/stop/dispose path from being misclassified as an external interruption.

### Diagnostic authentication regression

Existing route tests assert that every route in the bypass collection is explicitly bypassed. HPA-208 preserves that assertion by adding a separate authenticated diagnostic collection and testing both collections independently.

### Lifecycle listener duplication

The existing Capacitor lifecycle boot listener feeds shared state; the auth coordinator keeps its auth-private listener. The pronunciation controller observes shared state and adds no third native listener.

### Mobile API classification migration

Adding `client` intentionally changes unexpected 4xx handling for existing consumers. Due-count regression tests pin 400 as non-retryable while retaining existing 5xx/network retries.

### Cross-user or stale-partition leakage

All cache keys include user ID. Targeted invalidation covers every settings partition, pending records are detached from the join index, auth transitions clear only the previous user, and stale completions are generation-guarded.

### S3 CORS uncertainty

The implementation measures first and changes only the exact bucket origin policy if evidence requires it.

### Scope expansion into final settings or review UX

The route is development-only and uses a fixed word. Final product integration remains a later milestone that consumes the service and audio interfaces.

## Implementation shape

The implementation plan should sequence work approximately as follows:

1. Shared TTS contracts, web parser adoption, additive backend error codes, and validator-400 coverage.
2. Mobile API POST with replayable string bodies, structured bounded HTTP errors, per-request overall/coordinator timeout APIs, and due-count 4xx regression pinning.
3. Mobile TTS service with ordered error mapping, attributable timings, settings-derived cache/concurrency, all-partition invalidation, canonical-text precondition, and auth isolation.
4. Audio contract and HTML adapter with pause-ordering invariants.
5. Controller state machine, manual retry, same-user auth recovery, proactive expiry, attributable tap timing, and lifecycle integration through the existing `boot/capacitor-lifecycle.ts` listener and `recordAppStateChange()`.
6. Split bypass/authenticated diagnostic route collections, add authenticated `/diagnostics/tts-pronunciation`, and extend production exclusion checks.
7. Automated verification, including cold-generation timeout, validator 400, POST 401 replay, body bounds, redaction, route guards, and lifecycle-listener ownership.
8. Simulator matrix.
9. Physical-iPhone normal-volume, prepared direct-tap silent-switch, interruption, and replay matrix with human audibility evidence and separate latency records.
10. CORS correction, native audio-session follow-up, or native-player follow-up only when evidence requires it.

No implementation begins until this revised design is reviewed and approved.
