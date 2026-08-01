# HPA-208: Authenticated TTS Pronunciation Playback on iOS

**Date:** 2026-07-31

**Linear:** [HPA-208](https://linear.app/cwchanap/issue/HPA-208/mobile-mvpm1-validate-authenticated-tts-pronunciation-playback-on-ios)

**Parent:** HPA-194 — Mobile MVP M1

## Goal

Prove that a restored, signed-in Vela user can request and repeatedly play one Japanese pronunciation inside the Capacitor iOS application using the existing authenticated TTS backend and presigned S3 audio flow.

The implementation must answer one explicit architecture question:

> Is an `HTMLAudioElement` adapter reliable enough for the iOS MVP, or must the next mobile milestone introduce a native Capacitor audio adapter?

This is a production-shaped validation slice, not the final pronunciation experience. It establishes stable boundaries for authenticated TTS requests, expiring audio URLs, playback ownership, user-visible state, and future native replacement without importing the web TTS settings page or exposing Cognito tokens to feature code.

## Current state

HPA-204 established the absolute native API URL and approved `capacitor://localhost` for the Vela API CORS policy.

HPA-206 established the mobile Cognito session owner. ID and access tokens remain private to `MobileAuthCoordinator`; feature code calls `requestAuthenticatedApi()` instead of reading tokens.

HPA-207 established:

- a coordinator-owned authenticated feature-request boundary;
- bounded request execution and current-generation 401 recovery;
- `MobileApiClient.getJson()`;
- a mobile service registry;
- user-scoped feature state and sign-out isolation patterns; and
- an authenticated Home vertical slice.

The existing web TTS service currently combines six responsibilities:

1. Amplify session access;
2. TTS settings retrieval;
3. authenticated TTS generation and existing-audio lookup;
4. a 14-minute in-memory presigned-URL cache;
5. same-key in-flight request deduplication; and
6. direct `HTMLAudioElement` playback.

Its useful cache and concurrency semantics should be preserved, but the module itself must not be imported into mobile because it owns web authentication and mixes transport with playback.

The backend already provides:

- `GET /api/tts/settings`;
- `POST /api/tts/generate`; and
- `GET /api/tts/audio/:vocabularyId`.

`POST /api/tts/generate` checks the user-scoped S3 cache before invoking the configured provider, stores generated audio privately, and returns a presigned URL valid for 900 seconds. The backend derives the provider credential from the authenticated user's server-side TTS settings. No provider API key is returned to or bundled in the mobile application.

The Capacitor application does not currently install a native audio plugin.

## Approved decisions

| Area | Decision |
| --- | --- |
| Product scope | One authenticated known-word pronunciation diagnostic |
| Test word | Seeded vocabulary item `水` / `みず` / `water`, deterministic ID `水:ミズ` |
| API flow | Check settings, then call `POST tts/generate`; do not require `GET tts/audio/:id` first |
| Shared code | Share validated request/response/settings/error contracts, not the web service or page |
| Auth ownership | All TTS requests use the existing coordinator-owned mobile API client |
| API client | Add authenticated JSON POST and structured HTTP error details without changing due-count behavior |
| Playback seam | `MobileAudioPlayer` interface with an initial `HtmlAudioPlayer` implementation |
| Native plugin | Do not install one unless device evidence fails the HTML-audio decision gate |
| Concurrency | One preparation request and one active playback per controller; same-key service requests share work |
| URL cache | User/settings/vocabulary-scoped in-memory cache, 14-minute TTL, bounded size |
| Replay | Reuse the prepared URL and restart from the beginning; never overlap playback |
| First-tap gesture | Attempt playback after async preparation and record whether iOS permits it |
| Gesture fallback | If rejected, retain the prepared URL and require a second direct tap |
| Expired URL | Invalidate, refresh, and require another tap; do not autoplay after async recovery |
| Background behavior | Stop active audio and classify it as interrupted; background audio remains unsupported |
| Diagnostic exposure | Development-only route under More, but still behind `MobileAuthGate` |
| Provider configuration | Test account is configured on the web; mobile only reports configuration status |
| Device evidence | Simulator checks are merge gates; a physical iPhone is the closure and architecture-decision gate |
| Infrastructure | Do not broaden S3 CORS preemptively; change it only if device evidence proves it necessary |
| Web behavior | Preserve existing web TTS request, cache, playback, and settings behavior |

## Scope

HPA-208 includes:

- shared runtime-validated TTS contracts;
- stable TTS backend error codes while preserving existing `error` messages;
- authenticated JSON POST support in the mobile API client;
- structured HTTP status and server-detail preservation for feature services;
- a mobile TTS service with settings validation, URL caching, and same-key single-flight preparation;
- a replaceable mobile audio interface;
- an `HTMLAudioElement` implementation owning one active playback;
- a pronunciation controller with explicit state transitions and concurrency rules;
- an authenticated development-only diagnostic page for one known word;
- lifecycle and interruption observation;
- unit/component/infrastructure coverage;
- Simulator and physical-iPhone verification; and
- a written HTML-audio versus native-adapter conclusion.

## Non-goals

- final Review, Learn, Words, or settings integration;
- allowing provider keys to be entered on mobile;
- changing provider selection, voice selection, or model selection;
- speech-to-text or microphone capture;
- AI buddy conversation audio;
- free-form TTS text entry;
- offline audio downloads or persistent audio storage;
- background playback;
- lock-screen controls, Now Playing integration, or remote transport controls;
- Bluetooth route selection or advanced `AVAudioSession` policy;
- Android validation;
- proactively adopting a native audio plugin; and
- redesigning the backend's invariant that one vocabulary ID represents one canonical pronunciation text.

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
MobileApiClient GET tts/settings
        |
        v
MobileAuthCoordinator adds current Cognito ID token
        |
        v
MobileApiClient POST tts/generate
        |
        v
Backend checks user TTS settings and S3 object cache
        |
        v
Provider generation when needed -> private S3 object
        |
        v
Validated { audioUrl, cached } response
        |
        v
Controller attempts MobileAudioPlayer.play(audioUrl)
        |
        v
HtmlAudioPlayer owns exactly one HTMLAudioElement
```

### Responsibility boundaries

#### Shared contracts

`packages/common/src/contracts/tts.ts` owns platform-neutral data contracts and parsers. It has no fetch, auth, Vue, browser-audio, or provider implementation dependencies.

#### Mobile API client

`apps/vela-mobile/src/services/mobile-api-client.ts` owns authenticated JSON transport, execution deadlines, response-body consumption, and stable transport/HTTP error normalization. It does not understand TTS domain states.

#### Mobile TTS service

`apps/vela-mobile/src/services/mobile-tts.ts` owns TTS settings interpretation, generate-request construction, response parsing, URL-cache semantics, and TTS-specific error normalization. It does not create or control audio elements.

#### Mobile audio player

`apps/vela-mobile/src/audio/mobile-audio-contract.ts` defines the replaceable playback boundary. `apps/vela-mobile/src/audio/html-audio-player.ts` is the first implementation. No learning component or diagnostic page constructs `Audio` directly.

#### Pronunciation controller

`apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts` or an equivalent focused controller owns user intent, preparation/playback sequencing, state transitions, retry policy, lifecycle reactions, and teardown. It does not parse HTTP responses or own Cognito state.

#### Diagnostic view

The Vue page renders the controller state and exposes accessible controls. It contains no request, cache, or playback implementation logic.

## Shared TTS contracts

Create and export the following from `@vela/common`:

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
- unknown response fields are ignored; and
- invalid success bodies become `MobileApiError('invalid_response')` at the mobile service boundary.

The web service imports and re-exports the shared types and parsers while preserving its public API and behavior.

### Backend error compatibility

TTS routes add stable `code` fields to their existing JSON error responses. The existing human-readable `error` strings remain unchanged so current web behavior and tests remain valid.

Mobile maps by stable code first. During mixed-version deployment or local development, it falls back to status plus the existing error string for the two configuration messages. This fallback is compatibility behavior, not the primary long-term contract.

## Mobile API client extension

### Public contract

Extend the client without exposing a generic arbitrary-header escape hatch:

```ts
export type MobileApiClient = {
  getJson(path: string, options?: MobileApiRequestOptions): Promise<unknown>;
  postJson(
    path: string,
    body: unknown,
    options?: MobileApiRequestOptions,
  ): Promise<unknown>;
};

type MobileApiRequestOptions = {
  signal?: AbortSignal;
};
```

Both methods use one private `requestJson()` implementation.

`postJson()` sets `Content-Type: application/json` and serializes the supplied body. Authorization remains exclusively owned by `MobileAuthCoordinator`; callers cannot supply or override it.

### Error contract

Extend `MobileApiError` with optional HTTP detail while preserving all existing codes and behavior:

```ts
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

export class MobileApiError extends Error {
  constructor(
    readonly code: MobileApiErrorCode,
    readonly details: {
      status?: number;
      serverBody?: unknown;
      serverMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(code, { cause: details.cause });
  }
}
```

Response mapping:

| Result | Mobile API result |
| --- | --- |
| 2xx with valid JSON | Return parsed value |
| 2xx with invalid/empty required JSON | `invalid_response` |
| 400–499 except 401/403 | `client`, retaining status and parsed body/text |
| 401 | Existing `unauthorized` behavior after coordinator recovery rules |
| 403 | Existing `forbidden` behavior |
| 500–599 | `server`, retaining status and parsed body/text |
| Transport rejection/deadline | Existing `network` or session-recovery behavior |
| Caller abort | Preserve `AbortError` |

The due-count query continues retrying only `network` and `server`; the new `client` code is deterministic and is not retried.

Error-body consumption is bounded by the existing request deadline. JSON is preferred when the response content type or body supports it; otherwise retain a bounded text message. Malformed error bodies do not replace the correct HTTP classification.

## Mobile TTS service

### Public contract

```ts
export type MobilePronunciationInput = {
  userId: string;
  vocabularyId: string;
  text: string;
};

export type PreparedPronunciation = {
  audioUrl: string;
  source: 'memory-cache' | 'server-cache' | 'generated';
  expiresAt: number;
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

### Preparation algorithm

For one logical preparation:

1. Validate non-empty `userId`, `vocabularyId`, and `text`.
2. Join an existing pending preparation for the same user, vocabulary ID, and text when present.
3. Fetch and validate `GET tts/settings` through `MobileApiClient`.
4. If `hasApiKey` is false, throw `MobileTtsError('not_configured')` without calling generation.
5. Construct the final cache key from user ID, vocabulary ID, provider, voice, and model.
6. Return a live URL from the in-memory cache when present.
7. Call `POST tts/generate` with exactly `{ vocabularyId, text }`.
8. Validate the response.
9. Cache the URL for 14 minutes from receipt.
10. Return source `server-cache` when the backend says `cached: true`; otherwise return `generated`.
11. Remove the pending record in `finally` if it still owns the key.

The test word follows the backend's current invariant: `vocabularyId` identifies immutable canonical pronunciation text. HPA-208 does not support sending alternate text for the same vocabulary ID.

### URL cache

Use the established web semantics:

- TTL: 14 minutes, one minute shorter than the backend presigned URL;
- maximum entries: 300;
- LRU-style refresh on access;
- periodic expired-entry sweep plus per-key expiration check;
- key components encoded before joining;
- user and TTS-setting isolation; and
- no persistent storage.

Cache key:

```text
userId | vocabularyId | provider | voiceId | model
```

The cache never stores provider API keys, bearer tokens, or complete settings records.

### Same-key pending work and cancellation

The service shares the underlying preparation promise for identical logical requests. A caller abort detaches that caller but does not cancel work still useful to another caller.

The service maintains a per-user invalidation generation:

- `clearUser(userId)` increments that user's generation and removes their cache entries;
- pending work captures the generation at start;
- a result may populate the cache only if the captured generation still matches; and
- stale completion after sign-out or identity replacement is returned only to a still-live original caller and is never retained.

`clearAll()` is reserved for application disposal and tests. Normal auth cleanup is user-scoped.

### TTS error normalization

| Source | Mobile TTS error |
| --- | --- |
| Settings says `hasApiKey: false` | `not_configured` |
| Backend code `tts_not_configured` | `not_configured` |
| Invalid provider configuration | `generation_failed` with actionable diagnostic detail |
| HTTP/network deadline | `network` unless API client identifies session recovery |
| 503/audio service unavailable | `service_unavailable` |
| 504/provider timeout | `generation_timeout` |
| Other generation/storage/signing failure | `generation_failed` |
| Invalid success body | `invalid_response` |
| Auth/session control errors | Preserve equivalent mobile TTS code |

Provider names and non-secret settings may be shown in the development diagnostic. Provider keys, tokens, signed URL query parameters, and raw server bodies are not logged.

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

It must not set `crossOrigin` unless device evidence demonstrates a need and the bucket policy is changed accordingly.

## Pronunciation controller

### State model

```ts
export type PronunciationDiagnosticState =
  | { kind: 'idle' }
  | { kind: 'preparing'; attempt: number }
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

The controller keeps the prepared URL while it is valid, including after a gesture-required failure, interruption, or explicit stop.

### Tap behavior

#### Tap from `idle`

1. Transition to `preparing`.
2. Prepare pronunciation.
3. Save the returned pronunciation.
4. Immediately call `audioPlayer.play()` in the continuation of the original tap.
5. Record whether iOS accepts or rejects playback after the asynchronous request chain.

#### Tap from `ready` or `interrupted`

Call `audioPlayer.play()` synchronously using the prepared URL. This is the direct-user-gesture control path.

#### Tap during `preparing`

Ignore the tap and keep the control disabled. The service additionally protects against duplicate preparation requests.

#### Tap during `playing`

Stop the active handle with reason `restart`, seek to the beginning through the adapter, and start one replacement playback. Audio never overlaps.

### Playback results

| Result | Controller behavior |
| --- | --- |
| Ended | Return to `ready`; increment completed-play count |
| Restart/user stop | Return to `ready` unless a replacement already owns the state |
| Background interruption | Enter `interrupted`; retain URL |
| External interruption | Enter `interrupted`; retain URL |
| Gesture required | Enter `ready` with “Audio is prepared. Tap again to play.” |
| Media unavailable | Invalidate URL and enter recoverable expired/media state |
| Other playback failure | Enter recoverable error retaining URL only when safe |

### Expired or invalid URL recovery

`HTMLMediaElement` does not reliably expose the HTTP status causing a load failure. A media failure is therefore treated as a possibly expired or invalid URL:

1. Stop and discard the failed element.
2. Invalidate the user/vocabulary URL cache entry.
3. Refresh the pronunciation through `MobileTtsService` once.
4. Enter `ready` with “Audio was refreshed. Tap to play again.”
5. Do not autoplay after refresh, because the asynchronous recovery may no longer carry user activation.

If refresh fails, show the mapped TTS error. The controller performs at most one automatic URL refresh per tap; further attempts require explicit user retry.

### Lifecycle behavior

Extend the existing mobile lifecycle state with current active/inactive status and transition timestamps while preserving the current resume counter.

When the app becomes inactive:

- call `audioPlayer.interruptActive('background')`;
- do not attempt background playback; and
- preserve the prepared URL when still within its local TTL.

When the app becomes active:

- do not auto-resume;
- display the interrupted state; and
- allow an explicit replay tap.

Component unmount stops active playback with reason `dispose` and aborts/detaches preparation owned by the component.

## Diagnostic surface

### Route placement

Add a development-only route such as:

```text
/more/diagnostics/tts-pronunciation
```

The route is a sibling to the existing iOS interaction diagnostics, but it must **not** set `meta.bypassMobileAuth`. It is rendered only inside the authenticated mobile shell.

The More page includes a development-only lazy entry:

```text
Pronunciation diagnostics
Authenticated TTS, expiring URLs, and iOS playback
```

Production builds must contain neither the route nor the entry. Extend the production-diagnostics verification script and route tests to prove their absence.

### Known word

Use the deterministic seeded item:

```ts
const DIAGNOSTIC_WORD = {
  vocabularyId: '水:ミズ',
  text: '水',
  reading: 'みず',
  translation: 'water',
} as const;
```

The page does not query vocabulary APIs and does not allow arbitrary text, keeping the spike deterministic and free of unrelated dependencies.

### Presentation

Minimum visible content:

```text
Pronunciation diagnostics

水
みず · water

[Play pronunciation]

State: Ready
Source: memory cache / server cache / generated
Playback adapter: HTML audio
Last outcome: Completed
```

Expose accessible states through `role="status"`, `aria-live="polite"`, and `role="alert"` where appropriate. The control label reflects state:

- Prepare and play pronunciation;
- Preparing pronunciation;
- Replay pronunciation;
- Restart pronunciation; or
- Retry pronunciation.

### Development controls and counters

A collapsed development section may provide:

- invalidate the current in-memory URL;
- simulate one invalid URL by replacing only the current diagnostic copy with a known-unreachable HTTPS URL;
- clear diagnostic counters;
- show preparation count, backend source, playback attempts, completed plays, gesture rejections, interruptions, URL refreshes, and last classified error; and
- show current app active state.

Never render the complete presigned URL because its query string contains temporary credentials. Display only the URL host and a redacted path suffix when needed for debugging.

The invalid-URL control provides deterministic expired-URL recovery evidence without waiting 15 minutes or mutating server storage.

## User-facing states

| Condition | Message/action |
| --- | --- |
| Initial | “Tap to prepare and play 水.” |
| Preparing | “Preparing pronunciation…” |
| Playing | “Playing 水…” |
| Completed | “Pronunciation completed.” Replay available |
| Gesture rejected | “Audio is prepared. Tap again to play.” |
| Interrupted | “Playback was interrupted. Tap to replay.” |
| TTS not configured | “Pronunciation is not configured for this account. Configure TTS in Vela web settings.” |
| Session unavailable | Allow auth gate/coordinator recovery; no raw token error |
| Network failure | “Vela couldn’t load pronunciation. Check your connection and try again.” |
| Provider timeout | “Pronunciation generation timed out. Try again.” |
| Service unavailable | “Pronunciation is temporarily unavailable. Try again.” |
| URL refreshed | “Audio was refreshed. Tap to play again.” |
| Playback failure | “Vela couldn’t play this pronunciation. Try again.” |

The diagnostic may mention that configuration is managed on the web. It does not deep-link to or embed the web settings page in this milestone.

## Authentication and user isolation

The page is enabled only while the feature-session selector reports a usable authenticated session.

The controller passes the current authenticated user ID to `MobileTtsService` solely for client-side cache partitioning. The user ID is never sent in the request body; the backend derives identity from the verified Cognito token.

Install a focused TTS auth-isolation watcher or equivalent service hook:

- identity replacement clears only the previous user’s TTS cache and stops current audio;
- sign-out clears only the previous user’s TTS cache and stops current audio;
- unusable session recovery detaches/aborts the current diagnostic operation without globally clearing successor state; and
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

A required bucket-policy correction remains within HPA-208 because it is necessary for the existing presigned-audio architecture to function. A native plugin adopted solely to bypass a correctable bucket CORS policy is not the preferred outcome.

## Testing

### Shared-contract tests

Cover:

- all supported providers;
- null voice/model;
- missing and invalid fields;
- HTTPS URL validation;
- cached true/false;
- existing error-only responses;
- coded error responses; and
- unknown-field tolerance.

### API-client tests

Cover:

- POST method and JSON body;
- coordinator-owned Authorization;
- rejection of caller Authorization remains intact;
- caller abort;
- total deadline across transport and body consumption;
- session recovery mappings;
- 2xx JSON success;
- 4xx `client` classification with parsed JSON and text detail;
- 5xx `server` classification with detail;
- malformed success JSON; and
- unchanged due-count retry behavior.

### Mobile TTS service tests

Cover:

- exact settings and generate paths;
- exact generation request body;
- user ID absent from the request body;
- not-configured settings short-circuit;
- coded and compatibility-fallback errors;
- response validation;
- 14-minute cache TTL;
- per-user, provider, voice, model, and vocabulary isolation;
- same-key pending request sharing;
- distinct-key independence;
- failed pending-request cleanup;
- bounded LRU eviction;
- targeted invalidation;
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
- listener cleanup;
- exactly-once settlement; and
- one active element invariant.

### Controller tests

Cover:

- idle to preparing to playing to ready;
- asynchronous first-tap playback attempt;
- gesture fallback retaining URL;
- direct second-tap playback;
- rapid taps during preparation;
- rapid taps during playback causing restart without overlap;
- cached replay without another prepare request;
- background interruption and explicit replay;
- external interruption;
- media failure, one URL refresh, and no autoplay;
- refresh failure;
- not-configured state;
- network and server retries;
- session change;
- identity change and sign-out;
- component teardown; and
- stale asynchronous completion unable to overwrite successor state.

### Component and route tests

Cover:

- every visible state and message;
- accessible control labels and live regions;
- counters and redaction;
- authenticated route behavior;
- no auth bypass metadata;
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

Run the matrix on at least one current iOS Simulator and one physical development iPhone.

| Scenario | Simulator | Physical iPhone | Required evidence |
| --- | --- | --- | --- |
| Restored authenticated session | Required | Required | User reaches diagnostic without sign-in prompt while session valid |
| Account has configured TTS | Required | Required | Settings reports configured; no key shown |
| First server-cache or generation request | Required | Required | Source and timing recorded |
| One-tap async prepare-and-play | Required | Required | Accepted or gesture-rejected result recorded |
| Prepared direct-tap playback | Required | Required | Audible Japanese pronunciation |
| Ten consecutive replays | Required | Required | Success/failure count |
| Rapid taps while preparing | Required | Required | One preparation request |
| Rapid taps while playing | Required | Required | No overlap; deterministic restart |
| Network disabled before prepare | Required | Required | Actionable error and successful retry |
| Invalid/expired URL simulation | Required | Required | Refresh then explicit replay succeeds |
| Background during preparation | Required | Required | No stuck state |
| Background during playback | Required | Required | Interrupted, no background continuation, replay succeeds |
| External/system audio interruption | Best effort | Required | Outcome and limitation recorded |
| Sign-out while ready | Required | Required | User cache cleared; route inaccessible |
| Sign-out while playing | Required | Required | Playback stops and state clears |
| Relaunch and replay | Required | Required | Auth restoration plus new successful playback |
| Silent mode and volume behavior | Record | Record | Expected iOS media behavior documented |

Use a test account already configured through the web application. Record provider and non-secret voice/model identifiers, but never record the provider key, bearer token, or complete signed URL.

## HTML audio acceptance gate

HTML audio is acceptable for the MVP when physical-device evidence shows all of the following:

1. A prepared direct tap reliably produces audible Japanese pronunciation.
2. Ten consecutive replays succeed without intermittent stuck or silent states.
3. Rapid taps never create overlapping audio.
4. Rapid taps never create duplicate generation requests.
5. Invalid/expired URLs recover through refresh and an explicit replay tap.
6. Backgrounding and foregrounding leave the controller in a recoverable state.
7. A normal external interruption leaves the controller replayable.
8. Sign-out and teardown stop playback and clear user-scoped cached URLs.
9. No provider key or Cognito token is present in the bundle, logs, or diagnostic UI.
10. Any one-tap gesture limitation is acceptable to product flows through prefetch or a documented prepare-then-play interaction.

A native Capacitor audio follow-up is required when physical evidence shows one or more of:

- prepared direct-tap playback remains intermittent;
- valid presigned URLs cannot be loaded reliably after correct CORS configuration;
- interruption leaves the HTML element permanently unusable;
- repeated playback leaks or accumulates active media elements;
- required MVP behavior needs audio-session category, route, or interruption controls unavailable through HTML audio; or
- the product cannot tolerate the demonstrated user-gesture interaction.

The follow-up issue must identify the failed criterion and preserve the `MobileAudioPlayer` interface. HPA-208 does not select a plugin without that evidence.

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
- first-tap gesture result;
- URL-expiration and interruption observations;
- any required CORS correction;
- known limitations;
- final `HTML audio accepted` or `native adapter required` decision; and
- links to any follow-up Linear issues.

HPA-210 consumes this record during the Milestone 1 architecture review.

## Acceptance-criteria mapping

| HPA-208 criterion | Design evidence |
| --- | --- |
| Signed-in user hears one Japanese pronunciation on physical iPhone | Authenticated diagnostic, known `水` item, physical matrix |
| Repeated playback has no duplicate request or accidental overlap | Service single-flight, controller tap rules, one-active-element adapter |
| Auth, generation, expiration, and playback failures are actionable | Structured API/TTS/audio errors and explicit view states |
| No provider key bundled | Server-side settings only; secret scan and redacted diagnostics |
| Web TTS unchanged | Shared contract re-export and additive backend error codes only |
| HTML versus native conclusion recorded | Objective physical-device decision gate and verification record |

## Risks and mitigations

### Asynchronous user activation

A network request may consume the original tap's user-activation window. The controller deliberately attempts one-tap playback, records the result, and supports a prepared second tap without repeating generation.

### Presigned URL expiry

The local TTL expires one minute before the server URL. Media failures also invalidate and refresh once because device sleep or clock behavior can outlive the local assumption.

### Ambiguous media errors

HTML media errors do not reliably identify HTTP status. Recovery treats the first media error as possibly stale, refreshes once, then surfaces a playback error rather than looping.

### Cross-user leakage

All cache keys include user ID, auth transitions clear only the previous user, stale completions are generation-guarded, and diagnostic state is destroyed on auth loss.

### S3 CORS uncertainty

The implementation measures first and changes only the exact bucket origin policy if evidence requires it.

### Scope expansion into final settings or review UX

The route is development-only and uses a fixed word. Final product integration remains a later milestone that consumes the service and audio interfaces.

## Implementation shape

The implementation plan should sequence work approximately as follows:

1. Shared TTS contracts and additive backend error codes.
2. Mobile API POST and structured HTTP errors.
3. Mobile TTS service, cache, concurrency, and auth isolation.
4. Audio contract and HTML adapter.
5. Controller state machine and lifecycle integration.
6. Authenticated development diagnostic and production exclusion checks.
7. Automated verification.
8. Simulator matrix.
9. Physical-iPhone matrix and architecture record.
10. CORS correction or native-audio follow-up only when evidence requires it.

No implementation begins until this design is reviewed and approved.