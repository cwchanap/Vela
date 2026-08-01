# Authenticated iOS TTS Pronunciation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-shaped authenticated pronunciation diagnostic in the Capacitor iOS app, validate HTML audio on Simulator and a physical iPhone, and record whether the MVP can retain HTML playback, needs native audio-session configuration, or needs a native player adapter.

**Architecture:** Add platform-neutral validated TTS contracts in `@vela/common`, preserve server-side secret ownership, and extend the existing coordinator-owned mobile request path with replayable JSON POST bodies and bounded per-request deadlines. Build a mobile TTS service with settings-partitioned URL caching, a replaceable `MobileAudioPlayer`, a controller state machine, and an authenticated development-only diagnostic route. Keep the existing web TTS flow compatible while sharing response validation.

**Tech Stack:** TypeScript 5.6, Bun, Vitest, Vue 3, Quasar 2, TanStack Vue Query 5, Capacitor 7, Hono, Zod, AWS Lambda, DynamoDB, S3 presigned URLs, WebKit `HTMLAudioElement`, iOS/Xcode.

## Global Constraints

- Keep `GET tts/settings`, due-count, and ordinary mobile JSON requests on the existing 8-second overall deadline.
- Use a 45-second overall deadline for `POST tts/generate`.
- Keep the coordinator's 15-second default physical-fetch cap; permit validated per-request overrides no greater than 50 seconds.
- All JSON POST bodies must be serialized once to replayable immutable strings before coordinator dispatch.
- The coordinator remains the only owner of Cognito ID tokens and `Authorization` headers.
- No provider key, Cognito token, complete presigned URL, or raw server error detail may be rendered, logged, or placed in verification records.
- Cap both JSON and text error bodies at 16 KiB before parsing or retention.
- Treat network, provider, validator, 4xx, 5xx, and deadline failures as manual-only retries.
- Permit exactly one same-user continuation for auth-control races or completed session recovery.
- Keep URL/media refresh separate from transport retry and allow at most one automatic URL refresh per tap.
- Mirror the backend cache identity: user ID, vocabulary ID, provider, voice, and model; text is an unenforced fixed-pair client precondition.
- Use fixed diagnostic input `{ vocabularyId: '水:ミズ', text: '水' }`; do not add free-form text.
- The diagnostic route is `/diagnostics/tts-pronunciation`, development-only, inside the authenticated shell, with no `bypassMobileAuth` metadata.
- Preserve existing explicit auth-bypass tests for the iOS interaction diagnostic routes.
- Use the existing `boot/capacitor-lifecycle.ts` native listener to feed shared lifecycle state; add no third listener.
- Background playback, microphone input, STT, AI buddy audio, offline storage, Now Playing controls, and Android are out of scope.
- Do not install a native audio plugin before physical-device evidence selects the required follow-up layer.

---

## File Structure

### Shared contracts

- Create `packages/common/src/contracts/tts.ts` — TTS providers, success/error contracts, request validation, and runtime parsers.
- Create `packages/common/src/contracts/tts.test.ts` — parser and request-validation coverage.
- Modify `packages/common/src/index.ts` — export TTS contracts and parsers.

### Existing web client

- Modify `apps/vela/src/services/ttsService.ts` — import shared types/parsers and validate successful settings/generate responses.
- Modify `apps/vela/src/services/ttsService.test.ts` — valid-response regression and malformed-success tests.

### Backend

- Modify `apps/vela-api/src/routes/tts.ts` — additive stable TTS error codes; preserve messages and statuses.
- Modify `apps/vela-api/test/routes/tts.test.ts` — code/message/status compatibility and validator-shaped 400 coverage.

### Mobile authenticated transport

- Modify `apps/vela-mobile/src/auth/mobile-auth-contract.ts` — `transportTimeoutMs` and `invalid_request_timeout`.
- Modify `apps/vela-mobile/src/services/mobile-auth.ts` — bounded per-dispatch timeout override and identical-body 401 replay.
- Modify `apps/vela-mobile/src/services/mobile-auth.test.ts` — default/override validation and POST replay.
- Modify `apps/vela-mobile/src/services/mobile-api-client.ts` — `postJson`, per-request overall deadlines, bounded body reader, structured non-enumerable errors.
- Modify `apps/vela-mobile/src/services/mobile-api-client.test.ts` — JSON POST, timeout, body bounds, redaction, classification, cause/name regression.
- Modify `apps/vela-mobile/src/composables/useDueReviewCount.test.ts` — pin 400/no retry, 500/retry, and network/retry after `client` classification is added.

### Mobile TTS domain service

- Create `apps/vela-mobile/src/services/mobile-tts.ts` — settings read, generate call, timings, error normalization, URL cache, single-flight generation, invalidation generations.
- Create `apps/vela-mobile/src/services/mobile-tts.test.ts` — service, cache, concurrency, error, timeout, and invalidation coverage.
- Modify `apps/vela-mobile/src/services/mobile-services.ts` — provide `MobileTtsService`.
- Modify `apps/vela-mobile/src/services/mobile-services.test.ts` — registry wiring.
- Create `apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts` — stop audio and clear prior-user TTS state on auth transitions.
- Create `apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts` — previous-user-only cleanup and successor-race coverage.

### Audio and lifecycle

- Create `apps/vela-mobile/src/audio/mobile-audio-contract.ts` — browser-free playback interfaces and errors.
- Create `apps/vela-mobile/src/audio/html-audio-player.ts` — one-active-element HTML adapter.
- Create `apps/vela-mobile/src/audio/html-audio-player.test.ts` — outcome, error, pause-ordering, cleanup, and exactly-once tests.
- Modify `apps/vela-mobile/src/services/mobile-lifecycle.ts` — active state and timestamps.
- Modify `apps/vela-mobile/src/services/mobile-lifecycle.test.ts` — state transition semantics.
- Modify `apps/vela-mobile/src/boot/capacitor-lifecycle.ts` — feed shared state from the existing listener.
- Create or modify `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts` — listener ownership and focus behavior.

### Controller and diagnostic UI

- Create `apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts` — state machine, manual retry, auth continuation, playback, expiry, lifecycle, and teardown.
- Create `apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts` — controller state and race coverage.
- Create `apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts` — route path, fixed word, labels, test IDs, and forbidden production tokens.
- Modify `apps/vela-mobile/src/router/diagnostic-routes.ts` — split bypass/authenticated diagnostic collections and add route.
- Modify `apps/vela-mobile/src/router/diagnostic-routes.test.ts` — preserve bypass invariant and verify authenticated route.
- Create `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.vue` — More-page entry.
- Create `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts` — entry navigation.
- Modify `apps/vela-mobile/src/pages/MorePage.vue` — development-only lazy entry.
- Modify `apps/vela-mobile/src/pages/MorePage.test.ts` — development/production entry behavior.
- Create `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue` — authenticated diagnostic presentation.
- Create `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts` — all view states, controls, redaction, and accessibility.
- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` — scan for TTS diagnostic tokens.
- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs` — production exclusion tests.

### Evidence

- Create `apps/vela-mobile/docs/tts-pronunciation-ios.md` during verification — exact tested versions, timings, matrix, audibility evidence, limitations, and final architecture conclusion.

---

### Task 1: Add Shared TTS Contracts and Adopt Them in Web Success Paths

**Files:**
- Create: `packages/common/src/contracts/tts.ts`
- Create: `packages/common/src/contracts/tts.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/ttsService.ts`
- Modify: `apps/vela/src/services/ttsService.test.ts`

**Interfaces:**
- Produces: `TtsProvider`, `TtsSettings`, `GeneratePronunciationRequest`, `GeneratePronunciationResponse`, `TtsApiErrorCode`, `TtsApiErrorResponse`, `parseTtsSettings()`, `parseGeneratePronunciationRequest()`, `parseGeneratePronunciationResponse()`, and `parseTtsApiErrorResponse()`.
- Consumers: backend route tests, mobile TTS service, and existing web TTS service.

- [ ] **Step 1: Write failing shared-contract tests**

```ts
import {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsSettings,
} from './tts';

it('parses a valid configured TTS settings response', () => {
  expect(
    parseTtsSettings({
      provider: 'openai',
      voiceId: 'alloy',
      model: 'tts-1',
      hasApiKey: true,
      ignored: 'field',
    }),
  ).toEqual({ provider: 'openai', voiceId: 'alloy', model: 'tts-1', hasApiKey: true });
});

it('rejects a non-HTTPS audio URL', () => {
  expect(() =>
    parseGeneratePronunciationResponse({ audioUrl: 'http://example.com/a.mp3', cached: false }),
  ).toThrow('invalid_tts_generate_response:audioUrl');
});

it('trims and validates fixed generation input', () => {
  expect(parseGeneratePronunciationRequest({ vocabularyId: ' 水:ミズ ', text: ' 水 ' })).toEqual({
    vocabularyId: '水:ミズ',
    text: '水',
  });
});

it('accepts uncoded legacy error bodies', () => {
  expect(parseTtsApiErrorResponse({ error: 'Failed to generate TTS audio' })).toEqual({
    error: 'Failed to generate TTS audio',
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
bun run --cwd packages/common test -- src/contracts/tts.test.ts
```

Expected: FAIL because `./tts` and its exports do not exist.

- [ ] **Step 3: Implement the shared parsers**

```ts
export type TtsProvider = 'elevenlabs' | 'openai' | 'gemini';

export type TtsSettings = {
  provider: TtsProvider;
  voiceId: string | null;
  model: string | null;
  hasApiKey: boolean;
};

export type GeneratePronunciationRequest = {
  vocabularyId: string;
  text: string;
};

export type GeneratePronunciationResponse = {
  audioUrl: string;
  cached: boolean;
};

export function parseGeneratePronunciationResponse(value: unknown): GeneratePronunciationResponse {
  const record = requireRecord(value, 'generate_response');
  const audioUrl = requireString(record.audioUrl, 'generate_response:audioUrl');
  const parsedUrl = new URL(audioUrl);
  if (parsedUrl.protocol !== 'https:') throw new TypeError('invalid_tts_generate_response:audioUrl');
  return { audioUrl, cached: requireBoolean(record.cached, 'generate_response:cached') };
}
```

Implement equivalent strict checks for settings, request input, and error response. Ignore unknown fields. Export all values from `packages/common/src/index.ts`.

- [ ] **Step 4: Adopt parsers in the web service**

Replace direct casts on successful settings/generate responses:

```ts
const raw = await response.json();
const result = parseGeneratePronunciationResponse(raw);
setCachedAudioUrl(cacheKey, result.audioUrl);
return result;
```

```ts
return parseTtsSettings(await response.json());
```

Do not alter request bodies, cache keys, non-2xx error parsing, or `playAudio()`.

- [ ] **Step 5: Add web regression tests**

Add cases proving:

```ts
it('keeps valid generate responses unchanged through the shared parser', async () => {
  // Existing settings mock plus { audioUrl: HTTPS_URL, cached: false }.
  await expect(generatePronunciation('水:ミズ', '水', 'user-1')).resolves.toEqual({
    audioUrl: HTTPS_URL,
    cached: false,
  });
});

it('rejects malformed successful generate responses', async () => {
  // Return 200 JSON with audioUrl missing.
  await expect(generatePronunciation('水:ミズ', '水', 'user-1')).rejects.toThrow(
    'invalid_tts_generate_response:audioUrl',
  );
});
```

- [ ] **Step 6: Run focused and package tests**

```bash
bun run --cwd packages/common test -- src/contracts/tts.test.ts
bun run --cwd apps/vela test:unit -- src/services/ttsService.test.ts
```

Expected: PASS with existing web cache, auth, and playback tests unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/common/src/contracts/tts.ts packages/common/src/contracts/tts.test.ts \
  packages/common/src/index.ts apps/vela/src/services/ttsService.ts \
  apps/vela/src/services/ttsService.test.ts
git commit -m "feat: share validated TTS contracts"
```

---

### Task 2: Add Stable Backend TTS Error Codes Without Changing Existing Messages

**Files:**
- Modify: `apps/vela-api/src/routes/tts.ts`
- Modify: `apps/vela-api/test/routes/tts.test.ts`

**Interfaces:**
- Consumes: `TtsApiErrorCode` from `@vela/common` when package boundaries allow; otherwise use a locally type-checked helper whose literals match the shared union.
- Produces: existing `{ error }` responses augmented with stable `code` fields.

- [ ] **Step 1: Add failing route tests for every mapped failure**

```ts
expect(response.status).toBe(400);
expect(await response.json()).toEqual({
  error: 'TTS API key not configured. Please configure in Settings.',
  code: 'tts_not_configured',
});
```

Add equivalent assertions for invalid provider, S3 unavailable, provider timeout, provider failure, upload failure, and signing failure. Preserve exact current messages and statuses.

Add a validator case with malformed input:

```ts
const response = await app.request('/api/tts/generate', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ vocabularyId: '', text: '' }),
});
expect(response.status).toBe(400);
expect(await response.json()).toMatchObject({ success: false });
```

The validator response remains uncoded and Zod-shaped; mobile maps it by status.

- [ ] **Step 2: Run the route test and confirm failure**

```bash
bun test apps/vela-api/test/routes/tts.test.ts
```

Expected: FAIL because error responses do not yet include `code`.

- [ ] **Step 3: Introduce one response helper and replace route branches**

```ts
function ttsError(
  c: Context,
  status: ContentfulStatusCode,
  code: TtsApiErrorCode,
  error: string,
) {
  return c.json({ error, code }, status);
}
```

Use this helper only for route-owned TTS failures. Do not intercept or reshape `zValidator` failures.

- [ ] **Step 4: Run backend tests**

```bash
bun test apps/vela-api/test/routes/tts.test.ts
bun run --cwd apps/vela-api typecheck
```

Expected: PASS; messages/statuses remain exactly compatible.

- [ ] **Step 5: Commit**

```bash
git add apps/vela-api/src/routes/tts.ts apps/vela-api/test/routes/tts.test.ts
git commit -m "feat(api): add stable TTS error codes"
```

---

### Task 3: Add Bounded Coordinator Transport Overrides and Replayable Authenticated POST Recovery

**Files:**
- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**
- Produces: `transportTimeoutMs?: number`, `MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS`, and `invalid_request_timeout`.
- Preserves: coordinator token ownership and one authenticated retry after successful 401 recovery.

- [ ] **Step 1: Write failing contract/timeout tests**

```ts
it.each([0, -1, 1.5, Number.NaN, 50_001])(
  'rejects invalid feature transport timeout %s',
  async (transportTimeoutMs) => {
    await expect(
      coordinator.requestAuthenticatedApi({ path: 'tts/generate', transportTimeoutMs }),
    ).rejects.toMatchObject({ code: 'invalid_request_timeout' });
  },
);
```

Add fake-timer tests proving omitted timeout aborts at 15 seconds and `45_000` does not abort before 45 seconds.

- [ ] **Step 2: Write the failing identical-POST replay test**

```ts
it('replays one JSON POST with the identical body after successful 401 recovery', async () => {
  const body = JSON.stringify({ vocabularyId: '水:ミズ', text: '水' });
  fetchMock
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(sessionVerificationResponseForRefreshedToken())
    .mockResolvedValueOnce(new Response(JSON.stringify({ audioUrl: HTTPS_URL, cached: true })));

  await coordinator.requestAuthenticatedApi({
    path: 'tts/generate',
    transportTimeoutMs: 45_000,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  });

  const featureCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('tts/generate'));
  expect(featureCalls).toHaveLength(2);
  expect(featureCalls[0]?.[1]?.body).toBe(body);
  expect(featureCalls[1]?.[1]?.body).toBe(body);
  expect(featureCalls[1]?.[1]?.method).toBe('POST');
});
```

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-auth.test.ts
```

Expected: FAIL because the contract lacks the override and error code.

- [ ] **Step 4: Implement validation and per-attempt timeout selection**

```ts
export const MOBILE_AUTH_NETWORK_TIMEOUT_MS = 15_000;
export const MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS = 50_000;

function featureTransportTimeout(request: MobileAuthenticatedApiRequest): number {
  const value = request.transportTimeoutMs;
  if (value === undefined) return MOBILE_AUTH_NETWORK_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0 || value > MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_timeout');
  }
  return value;
}
```

Compute the timeout before dispatch. Continue spreading the same `request.init` into each physical attempt so the string body is replayed unchanged.

- [ ] **Step 5: Run mobile auth tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-auth.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS with existing GET, 401, cancellation, sign-out, and generation-safety tests.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts
git commit -m "feat(mobile): support bounded feature transport timeouts"
```

---

### Task 4: Extend MobileApiClient with Replayable JSON POST, Deadlines, and Safe Structured Errors

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Modify: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Modify: `apps/vela-mobile/src/composables/useDueReviewCount.test.ts`

**Interfaces:**
- Produces: `postJson()`, `MobileApiRequestOptions.timeoutMs`, `MOBILE_API_MAX_ERROR_BODY_BYTES`, `MobileApiError.details`, and `client` classification.
- Consumes: coordinator `transportTimeoutMs` from Task 3.

- [ ] **Step 1: Write failing POST serialization tests**

```ts
it('serializes JSON once before coordinator dispatch', async () => {
  const body = { vocabularyId: '水:ミズ', text: '水' };
  coordinator.requestAuthenticatedApi.mockResolvedValue(jsonResponse({ audioUrl: HTTPS_URL, cached: false }));

  await client.postJson('tts/generate', body, { timeoutMs: 45_000 });

  expect(coordinator.requestAuthenticatedApi).toHaveBeenCalledWith({
    path: 'tts/generate',
    transportTimeoutMs: 45_000,
    init: expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(body),
      headers: expect.any(Headers),
    }),
  });
});

it('rejects circular JSON before coordinator dispatch', async () => {
  const body: Record<string, unknown> = {};
  body.self = body;
  await expect(client.postJson('tts/generate', body)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(coordinator.requestAuthenticatedApi).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing timeout, classification, and body-bound tests**

Cover:

```ts
expect((await captureError(client.getJson('bad'))).code).toBe('client'); // HTTP 400
expect((await captureError(client.getJson('bad'))).details.status).toBe(400);
expect(Object.keys(error)).not.toContain('details');
expect('cause' in new MobileApiError('network')).toBe(false);
```

Create a response body larger than 16 KiB for both JSON and text cases. Assert retained internal detail is bounded and safe logging uses only `{ code, status }`.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-api-client.test.ts
```

Expected: FAIL because `postJson`, `client`, timeout override, and details do not exist.

- [ ] **Step 4: Implement one private `requestJson()` path**

```ts
export const MOBILE_API_DEFAULT_TIMEOUT_MS = 8_000;
export const MOBILE_API_MAX_ERROR_BODY_BYTES = 16_384;

export type MobileApiRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

async function requestJson(
  method: 'GET' | 'POST',
  path: string,
  serializedBody: string | undefined,
  options: MobileApiRequestOptions,
): Promise<unknown> {
  const timeoutMs = validateOverallTimeout(options.timeoutMs ?? MOBILE_API_DEFAULT_TIMEOUT_MS);
  // Build one AbortController, apply the outer deadline, call coordinator,
  // consume the bounded body, and map response classes.
}
```

Pass `transportTimeoutMs: timeoutMs` to the coordinator. For POST, set `Content-Type` through `Headers`; do not allow caller-provided headers in the public API.

- [ ] **Step 5: Implement non-enumerable details and bounded body consumption**

```ts
export class MobileApiError extends Error {
  readonly details: MobileApiErrorDetails;

  constructor(code: MobileApiErrorCode, details: MobileApiErrorDetails = {}) {
    super(code, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'MobileApiError';
    Object.defineProperty(this, 'details', { value: details, enumerable: false });
  }
}
```

Use one reader that obtains at most 16 KiB before attempting `JSON.parse`. Never call `console.error(error)` from this layer.

- [ ] **Step 6: Pin due-count retry behavior**

```ts
expect(retryDueCountQuery(0, new MobileApiError('client', { status: 400 }))).toBe(false);
expect(retryDueCountQuery(0, new MobileApiError('server', { status: 500 }))).toBe(true);
expect(retryDueCountQuery(0, new MobileApiError('network'))).toBe(true);
```

- [ ] **Step 7: Run focused tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-api-client.test.ts \
  src/composables/useDueReviewCount.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/services/mobile-api-client.ts \
  apps/vela-mobile/src/services/mobile-api-client.test.ts \
  apps/vela-mobile/src/composables/useDueReviewCount.test.ts
git commit -m "feat(mobile): add replayable JSON requests and safe API errors"
```

---

### Task 5: Implement the Mobile TTS Service, Cache, Error Mapping, and Timings

**Files:**
- Create: `apps/vela-mobile/src/services/mobile-tts.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts.test.ts`

**Interfaces:**
- Consumes: shared TTS parsers and `MobileApiClient` from Tasks 1 and 4.
- Produces: `MobileTtsService`, `PreparedPronunciation`, `PreparationTimings`, `MobileTtsError`, `MOBILE_TTS_GENERATE_TIMEOUT_MS`, and targeted invalidation.

- [ ] **Step 1: Write failing settings/generate/error tests**

```ts
it('uses the default deadline for settings and 45 seconds for generation', async () => {
  await service.preparePronunciation(INPUT);
  expect(api.getJson).toHaveBeenCalledWith('tts/settings', { signal: expect.any(AbortSignal) });
  expect(api.postJson).toHaveBeenCalledWith(
    'tts/generate',
    { vocabularyId: '水:ミズ', text: '水' },
    { signal: expect.any(AbortSignal), timeoutMs: 45_000 },
  );
});

it('maps an uncoded validator 400 to invalid_input', async () => {
  api.postJson.mockRejectedValue(new MobileApiError('client', { status: 400, serverBody: { success: false } }));
  await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code: 'invalid_input' });
});
```

Add cases for every stable code, exact legacy 400 message, status-only 503/504, uncoded 500, client deadline/network, and structural success failure.

- [ ] **Step 2: Write failing cache and single-flight tests**

Cover:

```ts
it('shares generation after settings-derived full-key resolution', async () => { /* two callers, one POST */ });
it('creates a distinct key after voice/model changes', async () => { /* two POSTs */ });
it('expires memory URLs after 14 minutes', async () => { /* fake timers */ });
it('evicts the least-recently-used item above 300 entries', async () => { /* deterministic loop */ });
it('sweeps expired entries every five minutes', async () => { /* fake timers */ });
```

- [ ] **Step 3: Write failing invalidation-generation tests**

```ts
it('invalidates every settings partition for one user and vocabulary', () => {
  // Seed provider A and provider B entries, invalidate, then require both to re-fetch.
});

it('prevents stale pending completion from repopulating after invalidation', async () => {
  const pending = service.preparePronunciation(INPUT);
  service.invalidatePronunciation('user-1', '水:ミズ');
  resolveGenerate({ audioUrl: HTTPS_URL, cached: false });
  await pending;
  await service.preparePronunciation(INPUT);
  expect(api.postJson).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-tts.test.ts
```

Expected: FAIL because `mobile-tts.ts` does not exist.

- [ ] **Step 5: Implement public types and ordered error normalization**

```ts
export const MOBILE_TTS_GENERATE_TIMEOUT_MS = 45_000;

export type PreparedPronunciation = {
  audioUrl: string;
  source: 'memory-cache' | 'server-cache' | 'generated';
  expiresAt: number;
  timings: { settingsMs: number; generateMs: number };
};

function normalizeTtsError(error: unknown): never {
  // 1 stable code, 2 exact legacy 400 message, 3 auth/session/network,
  // 4 status mapping, 5 generation_failed fallback.
}
```

Do not expose `serverBody` or `serverMessage` through `MobileTtsError`.

- [ ] **Step 6: Implement preparation, cache, and full-key pending index**

Use encoded key components:

```ts
const key = [userId, vocabularyId, provider, voiceId ?? '', model ?? '']
  .map(encodeURIComponent)
  .join('|');
```

Fetch settings before checking the full-key cache or pending map. Record settings and generate timings separately. Set local expiry to `now + 14 * 60_000`.

- [ ] **Step 7: Implement invalidation generations**

Maintain:

```ts
const userGeneration = new Map<string, number>();
const vocabularyGeneration = new Map<string, number>();
```

Capture both before generation. Cache only when both still match. Targeted invalidation removes all matching cache/pending-index entries without aborting existing callers.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-tts.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/vela-mobile/src/services/mobile-tts.ts \
  apps/vela-mobile/src/services/mobile-tts.test.ts
git commit -m "feat(mobile): add authenticated TTS service"
```

---

### Task 6: Register TTS Services and Install Auth Isolation

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-services.ts`
- Modify: `apps/vela-mobile/src/services/mobile-services.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.test.ts`

**Interfaces:**
- Produces: `MOBILE_TTS_SERVICE_KEY` and an auth-isolation disposer.
- Consumes: coordinator state and `MobileTtsService.clearUser()`.

- [ ] **Step 1: Write failing service-registry tests**

```ts
expect(app.provide).toHaveBeenCalledWith(MOBILE_TTS_SERVICE_KEY, expect.any(Object));
```

Assert the same `MobileApiClient` instance is passed to both SRS and TTS services.

- [ ] **Step 2: Write failing auth-isolation tests**

Cover prior-user sign-out, identity replacement, null-to-user no-op, unusable recovery detach, and a successor authenticating while asynchronous prior cleanup is queued.

```ts
expect(tts.clearUser).toHaveBeenCalledWith('previous-user');
expect(tts.clearUser).not.toHaveBeenCalledWith('successor-user');
expect(stopPlayback).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-services.test.ts \
  src/services/mobile-tts-auth-isolation.test.ts \
  src/boot/mobile-auth.test.ts
```

Expected: FAIL because TTS registration/isolation do not exist.

- [ ] **Step 4: Implement registry wiring**

```ts
export const MOBILE_TTS_SERVICE_KEY: InjectionKey<MobileTtsService> = Symbol('mobile-tts-service');

const ttsService = createMobileTtsService(apiClient);
app.provide(MOBILE_TTS_SERVICE_KEY, ttsService);
```

Return the created services from an internal factory if tests need direct access; keep public app wiring unchanged.

- [ ] **Step 5: Implement prior-user-only isolation watcher**

Model it after `mobile-query-auth-isolation.ts`, but call only TTS cleanup and a supplied playback stop callback. Serialize cleanup and re-check user identity after awaited work; never clear a null or successor identity.

- [ ] **Step 6: Wire isolation in mobile boot**

Install after services and coordinator exist. Store the disposer if boot teardown has an established hook; otherwise expose it for tests and document app-lifetime ownership.

- [ ] **Step 7: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-services.test.ts \
  src/services/mobile-tts-auth-isolation.test.ts \
  src/boot/mobile-auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/services/mobile-services.ts \
  apps/vela-mobile/src/services/mobile-services.test.ts \
  apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts \
  apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts \
  apps/vela-mobile/src/boot/mobile-auth.ts apps/vela-mobile/src/boot/mobile-auth.test.ts
git commit -m "feat(mobile): register and isolate TTS services"
```

---

### Task 7: Implement the Browser-Free Audio Contract and HTML Adapter

**Files:**
- Create: `apps/vela-mobile/src/audio/mobile-audio-contract.ts`
- Create: `apps/vela-mobile/src/audio/html-audio-player.ts`
- Create: `apps/vela-mobile/src/audio/html-audio-player.test.ts`

**Interfaces:**
- Produces: `MobileAudioPlayer`, `MobileAudioPlaybackHandle`, `MobileAudioPlaybackOutcome`, and `MobileAudioError`.
- Consumers: pronunciation controller and future native adapter.

- [ ] **Step 1: Write failing adapter tests with an injected audio factory**

Create a deterministic fake element supporting `play`, `pause`, `currentTime`, `src`, event listeners, and synchronous `pause` dispatch.

Test:

```ts
it('settles restart before synchronous pause can become interruption', async () => {
  const first = player.play(URL_A);
  const second = player.play(URL_B);
  await expect(first.finished).resolves.toEqual({ kind: 'stopped', reason: 'restart' });
  expect(activeElements()).toHaveLength(1);
  fakeFor(URL_B).dispatch('ended');
  await expect(second.finished).resolves.toEqual({ kind: 'ended' });
});
```

Also cover `NotAllowedError`, media error, generic play rejection, external pause, explicit stop, dispose, listener removal, and exactly-once settlement.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/audio/html-audio-player.test.ts
```

Expected: FAIL because audio files do not exist.

- [ ] **Step 3: Define browser-free interfaces**

```ts
export type MobileAudioPlaybackOutcome =
  | { kind: 'ended' }
  | { kind: 'stopped'; reason: 'restart' | 'user' | 'dispose' }
  | { kind: 'interrupted'; reason: 'background' | 'external' };

export type MobileAudioPlayer = {
  play(url: string): MobileAudioPlaybackHandle;
  interruptActive(reason: 'background' | 'external'): void;
  dispose(): void;
};
```

No DOM types appear in this file.

- [ ] **Step 4: Implement `HtmlAudioPlayer` with strict cleanup ordering**

Before `pause()`, mark settled, detach listeners, and clear active ownership. Set `preload = 'auto'`. Do not set `crossOrigin`. Clear `src` only after listeners are detached.

- [ ] **Step 5: Run tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/audio/html-audio-player.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/audio/mobile-audio-contract.ts \
  apps/vela-mobile/src/audio/html-audio-player.ts \
  apps/vela-mobile/src/audio/html-audio-player.test.ts
git commit -m "feat(mobile): add replaceable HTML audio adapter"
```

---

### Task 8: Extend Shared Mobile Lifecycle State Without Adding a Native Listener

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-lifecycle.ts`
- Modify: `apps/vela-mobile/src/services/mobile-lifecycle.test.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Create or modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`

**Interfaces:**
- Produces: `mobileLifecycleState.isActive`, state timestamps, and `recordAppStateChange()`.
- Consumers: pronunciation controller.

- [ ] **Step 1: Write failing lifecycle-state tests**

```ts
it('records active and inactive transitions without incrementing resume count', () => {
  resetMobileLifecycleForTests();
  recordAppStateChange(false, 100);
  expect(mobileLifecycleState.isActive.value).toBe(false);
  expect(mobileLifecycleState.lastBecameInactiveAt.value).toBe(100);
  expect(mobileLifecycleState.resumeCount.value).toBe(0);

  recordAppStateChange(true, 200);
  expect(mobileLifecycleState.lastBecameActiveAt.value).toBe(200);
  expect(mobileLifecycleState.resumeCount.value).toBe(0);
});
```

- [ ] **Step 2: Write failing boot-listener tests**

Capture the existing `appStateChange` callback. Assert it calls `recordAppStateChange(isActive)` and `focusManager.setFocused(isActive)`. Assert only the existing listener is registered.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-lifecycle.test.ts \
  src/boot/capacitor-lifecycle.test.ts
```

Expected: FAIL because active state/timestamps do not exist.

- [ ] **Step 4: Implement state and canonical recorder**

```ts
const isActive = ref(true);
const lastStateChangeAt = ref<number | null>(null);
const lastBecameActiveAt = ref<number | null>(null);
const lastBecameInactiveAt = ref<number | null>(null);

export function recordAppStateChange(next: boolean, at = Date.now()): void {
  isActive.value = next;
  lastStateChangeAt.value = at;
  if (next) lastBecameActiveAt.value = at;
  else lastBecameInactiveAt.value = at;
}
```

Reset every field in `resetMobileLifecycleForTests()`.

- [ ] **Step 5: Feed state from the existing boot listener**

```ts
await adapter.addListener('appStateChange', (event) => {
  recordAppStateChange(event.isActive);
  focusManager.setFocused(event.isActive);
});
```

Do not touch the auth coordinator's private listener.

- [ ] **Step 6: Run tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-lifecycle.test.ts \
  src/boot/capacitor-lifecycle.test.ts

git add apps/vela-mobile/src/services/mobile-lifecycle.ts \
  apps/vela-mobile/src/services/mobile-lifecycle.test.ts \
  apps/vela-mobile/src/boot/capacitor-lifecycle.ts \
  apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts
git commit -m "feat(mobile): expose shared app activity state"
```

---

### Task 9: Implement the Pronunciation Controller State Machine

**Files:**
- Create: `apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts`
- Create: `apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts`

**Interfaces:**
- Consumes: `MobileTtsService`, `MobileAudioPlayer`, coordinator feature-session status, and shared lifecycle state.
- Produces: `PronunciationDiagnosticState`, `playOrRetry()`, `invalidateForTest()`, `simulateInvalidUrlForTest()`, counters, and `dispose()`.

- [ ] **Step 1: Write failing happy-path and gesture tests**

```ts
it('moves idle -> preparing -> playing -> ready', async () => { /* resolve service, end audio */ });
it('keeps a prepared URL when async first play requires a direct second tap', async () => {
  audio.play.mockReturnValueOnce(rejectedHandle(new MobileAudioError('gesture_required')));
  await controller.playOrRetry();
  expect(controller.state.value.kind).toBe('ready');
  expect(controller.state.value.notice).toBe('gesture_required');
});
```

Assert settings/generate timings and tap-to-play latency are recorded separately.

- [ ] **Step 2: Write failing concurrency and replay tests**

Cover disabled/ignored tap during preparation, deterministic restart during playing, no overlap, ready live replay with no service call, and one active playback.

- [ ] **Step 3: Write failing error/recovery tests**

Cover:

- manual-only network/provider/server/invalid-input failures;
- one same-user `session_changed`/`session_unavailable` retry;
- one recovery-pending continuation after same user becomes usable;
- second control failure visible;
- identity change cancels continuation;
- proactive expiry before audio creation;
- one media-unavailable refresh per tap;
- refresh failure visible without transport auto-retry;
- background interruption, no auto-resume, explicit replay;
- sign-out/dispose cancels or detaches stale completion.

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/composables/usePronunciationDiagnostic.test.ts
```

Expected: FAIL because controller does not exist.

- [ ] **Step 5: Implement state model and operation ownership**

```ts
export type PronunciationDiagnosticState =
  | { kind: 'idle' }
  | { kind: 'preparing'; attempt: number; recoveringSession: boolean }
  | { kind: 'ready'; pronunciation: PreparedPronunciation; notice: ReadyNotice | null }
  | { kind: 'playing'; pronunciation: PreparedPronunciation }
  | { kind: 'interrupted'; pronunciation: PreparedPronunciation; reason: 'background' | 'external' }
  | { kind: 'error'; error: PronunciationDiagnosticError; pronunciation: PreparedPronunciation | null };
```

Use an operation generation counter so old promises cannot overwrite successor state.

- [ ] **Step 6: Implement tap, auth continuation, expiry, and playback result handling**

Keep transport retries manual. Reuse live prepared URLs directly. Invalidate all settings partitions on expiry/media failure. Stop playback before restart. Observe shared `isActive` rather than registering a native listener.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/composables/usePronunciationDiagnostic.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts \
  apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts
git commit -m "feat(mobile): add pronunciation diagnostic controller"
```

---

### Task 10: Add the Authenticated Development Diagnostic Route and More Entry

**Files:**
- Create: `apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.test.ts`
- Create: `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.vue`
- Create: `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts`
- Modify: `apps/vela-mobile/src/pages/MorePage.vue`
- Modify: `apps/vela-mobile/src/pages/MorePage.test.ts`

**Interfaces:**
- Produces: `TTS_PRONUNCIATION_DIAGNOSTIC_PATH`, fixed word, labels, markers, and route registration.
- Consumes: existing mobile navigation helpers.

- [ ] **Step 1: Write failing route-partition tests**

```ts
expect(bypassDevelopmentDiagnosticRoutes.every((r) => r.meta?.bypassMobileAuth === true)).toBe(true);
expect(authenticatedDevelopmentDiagnosticRoutes).toHaveLength(1);
expect(authenticatedDevelopmentDiagnosticRoutes[0]?.path).toBe('diagnostics/tts-pronunciation');
expect(authenticatedDevelopmentDiagnosticRoutes[0]?.meta?.bypassMobileAuth).not.toBe(true);
```

Keep the combined `developmentDiagnosticRoutes` and production five-route assertions.

- [ ] **Step 2: Write failing entry/More tests**

Assert development builds render the lazy entry, clicking it calls `pushMobileRoute(router, TTS_PRONUNCIATION_DIAGNOSTIC_PATH)`, and production builds omit it.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/router/diagnostic-routes.test.ts \
  src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts \
  src/pages/MorePage.test.ts
```

Expected: FAIL because contract, route, and entry do not exist.

- [ ] **Step 4: Define diagnostic constants**

```ts
export const TTS_PRONUNCIATION_DIAGNOSTIC_PATH = '/diagnostics/tts-pronunciation';
export const TTS_PRONUNCIATION_DIAGNOSTIC_LABEL = 'Pronunciation diagnostics';
export const DIAGNOSTIC_WORD = {
  vocabularyId: '水:ミズ',
  text: '水',
  reading: 'みず',
  translation: 'water',
} as const;
```

Add unique marker/test ID strings for production scanning.

- [ ] **Step 5: Split route arrays and add authenticated route**

Keep existing iOS interaction routes in the bypass array. Add the TTS page only to the authenticated array with header fallback `/more` and no auth bypass.

- [ ] **Step 6: Add the More entry**

Follow the existing lazy diagnostic-entry pattern. Render it only when `import.meta.env.DEV` is true.

- [ ] **Step 7: Run tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/router/diagnostic-routes.test.ts \
  src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts \
  src/pages/MorePage.test.ts

git add apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/diagnostic-routes.test.ts \
  apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.vue \
  apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts \
  apps/vela-mobile/src/pages/MorePage.vue apps/vela-mobile/src/pages/MorePage.test.ts
git commit -m "feat(mobile): register authenticated TTS diagnostics"
```

---

### Task 11: Build the Diagnostic Page and Accessible State Presentation

**Files:**
- Create: `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts`

**Interfaces:**
- Consumes: `usePronunciationDiagnostic`, fixed word, audio adapter factory, mobile TTS service injection, and coordinator state.
- Produces: accessible diagnostic controls, counters, latency displays, safe error summaries, and development controls.

- [ ] **Step 1: Write failing page tests for visible states**

Cover idle, preparing, recovering session, playing, ready/completed, gesture-required, interrupted, invalid input, network/deadline, provider timeout, service unavailable, refreshed URL, and playback failure.

```ts
expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
  'Prepare and play pronunciation',
);
expect(wrapper.get('[role="status"]').text()).toContain('Preparing pronunciation');
```

- [ ] **Step 2: Write failing safety/accessibility tests**

Assert:

- word, reading, and translation render;
- `role=status`, `aria-live=polite`, and `role=alert` are used appropriately;
- source/settings/generate/tap timings are labeled diagnostic-only;
- complete signed URL never renders;
- `serverBody`/`serverMessage` never render;
- button is disabled during preparation and reflects retry/restart labels;
- diagnostic invalidation/simulated-invalid-URL controls call controller methods.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
```

Expected: FAIL because page does not exist.

- [ ] **Step 4: Implement the page**

Inject dependencies and instantiate the controller. Do not access Cognito tokens or call APIs directly. Render only safe stable error labels. Redact URL to hostname plus a non-query suffix only when diagnostic detail is enabled.

- [ ] **Step 5: Dispose on unmount and stop playback**

```ts
onUnmounted(() => controller.dispose());
```

Ensure auth loss makes the route inaccessible through the existing gate and clears controller state through isolation.

- [ ] **Step 6: Run page tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue \
  apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
git commit -m "feat(mobile): add authenticated pronunciation diagnostic page"
```

---

### Task 12: Prove Production Exclusion and Run the Automated Merge Gates

**Files:**
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs`
- Modify as needed: existing tests touched by Tasks 1–11

**Interfaces:**
- Consumes: forbidden tokens from the TTS diagnostic contract.
- Produces: production-bundle leak detection and a complete automated validation record for the PR.

- [ ] **Step 1: Write failing scanner tests**

Add each TTS diagnostic marker, route, label, and test ID to a synthetic bundle and assert verification fails. Assert a normal production bundle passes.

- [ ] **Step 2: Run scanner tests and confirm failure**

```bash
bun test apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs
```

Expected: FAIL because the scanner does not know TTS tokens.

- [ ] **Step 3: Extend forbidden-token scanning**

Import or duplicate only build-safe literal tokens according to the existing script structure. Do not import Vue/browser code into the Node verification script.

- [ ] **Step 4: Run all focused suites**

```bash
bun run --cwd packages/common test -- src/contracts/tts.test.ts
bun test apps/vela-api/test/routes/tts.test.ts
bun run --cwd apps/vela test:unit -- src/services/ttsService.test.ts
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-auth.test.ts \
  src/services/mobile-api-client.test.ts \
  src/services/mobile-tts.test.ts \
  src/services/mobile-services.test.ts \
  src/services/mobile-tts-auth-isolation.test.ts \
  src/audio/html-audio-player.test.ts \
  src/services/mobile-lifecycle.test.ts \
  src/boot/capacitor-lifecycle.test.ts \
  src/composables/usePronunciationDiagnostic.test.ts \
  src/router/diagnostic-routes.test.ts \
  src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts \
  src/pages/MorePage.test.ts \
  src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run package and repository gates**

```bash
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile verify:production-diagnostics
bun run --cwd apps/vela-api typecheck
bun run test
```

Expected: every command exits 0. Record exact test counts and coverage in the implementation PR; do not copy counts from earlier PRs.

- [ ] **Step 6: Build native assets and open Simulator**

```bash
bun run --cwd apps/vela-mobile build:ios:assets
bun run --cwd apps/vela-mobile build:ios:ide
```

Expected: production assets pass diagnostics and the Xcode project opens/builds without adding a native audio dependency.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/scripts/verify-production-diagnostics.mjs \
  apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs
git commit -m "test(mobile): verify TTS diagnostic exclusion"
```

---

### Task 13: Complete Simulator and Physical-iPhone Evidence and Record the Architecture Decision

**Files:**
- Create: `apps/vela-mobile/docs/tts-pronunciation-ios.md`
- Modify only if evidence requires: `packages/cdk/lib/storage-stack.ts`
- Modify only if CORS changes: `packages/cdk/test/storage-stack.test.ts`
- Create a follow-up Linear issue only if evidence selects native audio-session or native player work.

**Interfaces:**
- Produces: HPA-208 closure evidence consumed by HPA-210.

- [ ] **Step 1: Prepare the test account and capture non-secret configuration**

Confirm the account has TTS configured through web settings. Record provider, voice, and model identifiers only. Do not record the provider key, tokens, or complete signed URLs.

- [ ] **Step 2: Run the Simulator matrix**

Record exact pass/fail and timings for:

- restored authentication;
- configured settings;
- first server-cache request;
- genuinely uncached generation;
- async first-tap attempt;
- prepared direct-tap playback;
- ten replays;
- rapid preparation and playback taps;
- proactive expiry;
- disabled network and explicit retry;
- invalid URL refresh;
- background during preparation/playback;
- sign-out ready/playing;
- relaunch and replay.

Capture settings latency, generate/cache latency, and tap-to-play-attempt latency separately.

- [ ] **Step 3: Run the physical-iPhone matrix**

Repeat the applicable Simulator matrix and additionally verify by human hearing on the built-in speaker:

1. Ring/Silent off, media volume nonzero: `水` is audible and correct.
2. Ring/Silent on, media volume nonzero: prepared direct tap is audible or inaudible.
3. External/system audio interruption leaves playback replayable.
4. Ten prepared replays have no intermittent silent or stuck state.

Do not infer audibility from `play`, `playing`, or `ended` events.

- [ ] **Step 4: Diagnose valid-URL failures before changing infrastructure**

If valid presigned media fails, collect WebKit/native console evidence. Change S3 CORS only when evidence identifies origin rejection. Add exact `capacitor://localhost` GET/HEAD origin support, preserve web origins, and test arbitrary-origin rejection. Do not use `*`.

- [ ] **Step 5: Write the verification record with actual observations**

The document must contain:

```markdown
# iOS TTS Pronunciation Verification

- Tested commit: `<actual SHA>`
- Xcode: `<actual version>`
- iOS Simulator/device: `<actual versions/models>`
- Quasar/Capacitor/Bun: `<actual versions>`
- Provider/voice/model: `<non-secret identifiers>`
- Settings latency: `<actual measurements>`
- Generation/cache latency: `<actual measurements>`
- Tap-to-play-attempt latency: `<actual measurements>`
- Normal speaker audibility: pass/fail with observation
- Ring/Silent speaker audibility: pass/fail with observation
- Final decision: HTML-only accepted | native audio-session integration required | native player adapter required
```

Replace every angle-bracket value with measured evidence before committing; do not commit an incomplete record.

- [ ] **Step 6: Create the evidence-driven follow-up when required**

If silent-mode is the only failure and HTML decoding/lifecycle are reliable, create a Linear issue for minimal app-level `AVAudioSession` `.playback` configuration while retaining `HtmlAudioPlayer`.

If HTML playback remains unreliable after correct CORS/session configuration, create a Linear issue for a native implementation of `MobileAudioPlayer` and name the failed gate.

- [ ] **Step 7: Re-run automated gates after any evidence-driven code change**

```bash
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile verify:production-diagnostics
bun run test
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit evidence**

```bash
git add apps/vela-mobile/docs/tts-pronunciation-ios.md \
  packages/cdk/lib/storage-stack.ts packages/cdk/test/storage-stack.test.ts
git commit -m "docs(mobile): record iOS TTS pronunciation verification"
```

Stage the CDK files only when they actually changed.

- [ ] **Step 9: Update HPA-208 and HPA-210**

Add links to the implementation PR, tested commit, verification document, completed matrix, final architecture conclusion, and any follow-up issue. HPA-208 closes only after physical-iPhone evidence exists.

---

## Final Self-Review Checklist

Before implementation begins, confirm the plan covers every approved design requirement:

- [ ] Shared TTS contracts and web parser adoption.
- [ ] Additive backend codes and unchanged legacy messages/statuses.
- [ ] Uncoded validator 400 mapping.
- [ ] 8-second default, 45-second generate deadline, 15-second coordinator default, and 50-second maximum override.
- [ ] Replayable JSON POST across one 401 recovery.
- [ ] Bounded non-enumerable error details and safe logging.
- [ ] Due-count 4xx retry migration regression tests.
- [ ] Settings-derived cache key, 14-minute TTL, 300-entry bound, five-minute sweep.
- [ ] All-partition targeted invalidation and stale-completion guards.
- [ ] Fixed vocabulary ID/text precondition and backend collision warning.
- [ ] Manual-only transport/provider retries and one same-user auth continuation.
- [ ] One-active-element audio adapter and pause-ordering invariant.
- [ ] Shared lifecycle state fed by the existing boot listener.
- [ ] Authenticated `/diagnostics/tts-pronunciation` route with preserved bypass assertions.
- [ ] Accessible UI, diagnostic-only timing/source metadata, and redaction.
- [ ] Production diagnostic exclusion.
- [ ] Simulator and physical-iPhone matrix, including human speaker audibility and silent-switch evidence.
- [ ] Evidence-driven HTML-only/native-session/native-player conclusion.
