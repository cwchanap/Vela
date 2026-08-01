# Authenticated iOS TTS Pronunciation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an authenticated iOS pronunciation diagnostic that exercises Vela's existing TTS and presigned-audio flow, then record whether the MVP can retain HTML playback, needs native audio-session configuration, or needs a native player adapter.

**Architecture:** Add strict platform-neutral TTS contracts in `@vela/common`; preserve backend ownership of provider credentials; extend the coordinator-owned mobile request path with replayable JSON POST bodies, bounded per-request deadlines, and structured redacted failures. Build a settings-partitioned mobile TTS service, a browser-free playback interface with an HTML implementation, a controller state machine, and an authenticated development-only diagnostic route. Validate the result on Simulator and a physical iPhone.

**Tech Stack:** TypeScript 5.6, Bun, Vitest, Vue 3, Quasar 2, TanStack Vue Query 5, Capacitor 7, Hono, Zod, AWS Lambda, DynamoDB, S3 presigned URLs, WebKit `HTMLAudioElement`, iOS/Xcode.

## Global Constraints

- Keep `GET tts/settings`, due-count, and ordinary mobile JSON calls on the existing 8-second overall deadline.
- Use a 45-second overall deadline for `POST tts/generate`.
- Keep the coordinator's 15-second default physical-fetch cap; permit validated per-request overrides no greater than 50 seconds.
- Serialize every JSON POST body exactly once to an immutable string before coordinator dispatch and reuse that string after one successful 401 recovery.
- Keep Cognito tokens and `Authorization` ownership inside `MobileAuthCoordinator`.
- Never render, log, or persist provider keys, Cognito tokens, complete presigned URLs, or raw server error bodies.
- Limit both JSON and text error bodies to 16 KiB before parsing or retention.
- Make network, provider, validator, 4xx, 5xx, and deadline failures manual-only retries.
- Permit one same-user continuation for auth-control races or completed session recovery.
- Keep URL/media refresh separate from transport retry; allow at most one automatic URL refresh per tap.
- Mirror backend cache identity: user ID, vocabulary ID, provider, voice, and model. Text is an unenforced fixed-pair client precondition.
- Use only `{ vocabularyId: '水:ミズ', text: '水' }`; add no free-form text entry.
- Register `/diagnostics/tts-pronunciation` only in development, inside the authenticated shell, without `bypassMobileAuth`.
- Preserve existing explicit bypass assertions for the iOS interaction diagnostic routes.
- Feed shared lifecycle state through the existing `boot/capacitor-lifecycle.ts` listener; add no third native listener.
- Keep background playback, microphone input, STT, AI buddy audio, offline storage, Now Playing controls, and Android out of scope.
- Do not install a native audio plugin before physical-device evidence selects a follow-up layer.

---

## File Map

### Shared and web

- Create `packages/common/src/contracts/tts.ts`.
- Create `packages/common/src/contracts/tts.test.ts`.
- Modify `packages/common/src/index.ts`.
- Modify `apps/vela/src/services/ttsService.ts`.
- Modify `apps/vela/src/services/ttsService.test.ts`.

### Backend

- Modify `apps/vela-api/src/routes/tts.ts`.
- Modify `apps/vela-api/test/routes/tts.test.ts`.

### Mobile transport and domain services

- Modify `apps/vela-mobile/src/auth/mobile-auth-contract.ts`.
- Modify `apps/vela-mobile/src/services/mobile-auth.ts`.
- Modify `apps/vela-mobile/src/services/mobile-auth.test.ts`.
- Modify `apps/vela-mobile/src/services/mobile-api-client.ts`.
- Modify `apps/vela-mobile/src/services/mobile-api-client.test.ts`.
- Modify `apps/vela-mobile/src/composables/useDueReviewCount.test.ts`.
- Create `apps/vela-mobile/src/services/mobile-tts.ts`.
- Create `apps/vela-mobile/src/services/mobile-tts.test.ts`.
- Modify `apps/vela-mobile/src/services/mobile-services.ts`.
- Modify `apps/vela-mobile/src/services/mobile-services.test.ts`.
- Create `apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts`.
- Create `apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts`.
- Modify `apps/vela-mobile/src/boot/mobile-auth.ts`.
- Modify `apps/vela-mobile/src/boot/mobile-auth.test.ts`.

### Audio, lifecycle, and controller

- Create `apps/vela-mobile/src/audio/mobile-audio-contract.ts`.
- Create `apps/vela-mobile/src/audio/html-audio-player.ts`.
- Create `apps/vela-mobile/src/audio/html-audio-player.test.ts`.
- Modify `apps/vela-mobile/src/services/mobile-lifecycle.ts`.
- Modify `apps/vela-mobile/src/services/mobile-lifecycle.test.ts`.
- Modify `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`.
- Create or modify `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`.
- Create `apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts`.
- Create `apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts`.

### Diagnostic UI and evidence

- Create `apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts`.
- Modify `apps/vela-mobile/src/router/diagnostic-routes.ts`.
- Modify `apps/vela-mobile/src/router/diagnostic-routes.test.ts`.
- Create `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.vue`.
- Create `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts`.
- Modify `apps/vela-mobile/src/pages/MorePage.vue`.
- Modify `apps/vela-mobile/src/pages/MorePage.test.ts`.
- Create `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue`.
- Create `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts`.
- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`.
- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs`.
- Create `apps/vela-mobile/docs/tts-pronunciation-ios.md` only after collecting actual evidence.
- Modify `packages/cdk/lib/storage-stack.ts` and create or modify `packages/cdk/test/storage-stack.test.ts` only if evidence proves a CORS correction is necessary.

---

### Task 1: Add Shared TTS Contracts and Web Success Validation

**Files:**
- Create: `packages/common/src/contracts/tts.ts`
- Create: `packages/common/src/contracts/tts.test.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `apps/vela/src/services/ttsService.ts`
- Modify: `apps/vela/src/services/ttsService.test.ts`

**Interfaces:**
- Produces: `TtsProvider`, `TtsSettings`, `GeneratePronunciationRequest`, `GeneratePronunciationResponse`, `TtsApiErrorCode`, `TtsApiErrorResponse`, `parseTtsSettings()`, `parseGeneratePronunciationRequest()`, `parseGeneratePronunciationResponse()`, `parseTtsApiErrorResponse()`.
- Consumers: backend tests and `MobileTtsService`.

- [ ] **Step 1: Write failing contract tests**

```ts
import {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsSettings,
} from './tts';

const HTTPS_AUDIO = 'https://audio.example.test/mizu.mp3';

it('parses valid settings and ignores unknown fields', () => {
  expect(
    parseTtsSettings({
      provider: 'openai',
      voiceId: 'alloy',
      model: 'tts-1',
      hasApiKey: true,
      ignored: 'value',
    }),
  ).toEqual({ provider: 'openai', voiceId: 'alloy', model: 'tts-1', hasApiKey: true });
});

it('parses a valid generate response', () => {
  expect(parseGeneratePronunciationResponse({ audioUrl: HTTPS_AUDIO, cached: false })).toEqual({
    audioUrl: HTTPS_AUDIO,
    cached: false,
  });
});

it('rejects non-HTTPS audio URLs', () => {
  expect(() =>
    parseGeneratePronunciationResponse({ audioUrl: 'http://audio.example.test/mizu.mp3', cached: false }),
  ).toThrow('invalid_tts_generate_response:audioUrl');
});

it('trims generation input', () => {
  expect(parseGeneratePronunciationRequest({ vocabularyId: ' 水:ミズ ', text: ' 水 ' })).toEqual({
    vocabularyId: '水:ミズ',
    text: '水',
  });
});

it('accepts an uncoded legacy error body', () => {
  expect(parseTtsApiErrorResponse({ error: 'Failed to generate TTS audio' })).toEqual({
    error: 'Failed to generate TTS audio',
  });
});
```

Add table-driven failures for unsupported provider, missing booleans, non-string nullable fields, blank request fields, malformed error bodies, and unknown coded errors.

- [ ] **Step 2: Run the focused tests and verify red**

```bash
bun run --cwd packages/common test -- src/contracts/tts.test.ts
```

Expected: FAIL because `contracts/tts.ts` does not exist.

- [ ] **Step 3: Implement strict shared parsers**

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
  const root = requireRecord(value, 'generate_response');
  const audioUrl = requireString(root.audioUrl, 'generate_response:audioUrl');
  const parsed = new URL(audioUrl);
  if (parsed.protocol !== 'https:') throw new TypeError('invalid_tts_generate_response:audioUrl');
  return { audioUrl, cached: requireBoolean(root.cached, 'generate_response:cached') };
}
```

Implement equivalent strict helpers for settings, request input, and optional coded error responses. Export them from `packages/common/src/index.ts`.

- [ ] **Step 4: Adopt parsers in web success paths**

```ts
const result = parseGeneratePronunciationResponse(await response.json());
setCachedAudioUrl(cacheKey, result.audioUrl);
return result;
```

```ts
return parseTtsSettings(await response.json());
```

Do not alter web request bodies, cache keys, non-2xx parsing, or audio playback.

- [ ] **Step 5: Add web regression tests**

```ts
it('keeps a valid generated response unchanged', async () => {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/tts/settings') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTTSSettings) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ audioUrl: HTTPS_AUDIO, cached: false }),
    });
  });

  await expect(generatePronunciation('水:ミズ', '水', 'user-1')).resolves.toEqual({
    audioUrl: HTTPS_AUDIO,
    cached: false,
  });
});

it('rejects a malformed successful generate response', async () => {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/tts/settings') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTTSSettings) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ cached: false }) });
  });

  await expect(generatePronunciation('水:ミズ', '水', 'user-1')).rejects.toThrow(
    'invalid_tts_generate_response:audioUrl',
  );
});
```

- [ ] **Step 6: Run green tests and commit**

```bash
bun run --cwd packages/common test -- src/contracts/tts.test.ts
bun run --cwd apps/vela test:unit -- src/services/ttsService.test.ts

git add packages/common/src/contracts/tts.ts packages/common/src/contracts/tts.test.ts \
  packages/common/src/index.ts apps/vela/src/services/ttsService.ts \
  apps/vela/src/services/ttsService.test.ts
git commit -m "feat: share validated TTS contracts"
```

---

### Task 2: Add Stable Backend Error Codes Without Changing Legacy Responses

**Files:**
- Modify: `apps/vela-api/src/routes/tts.ts`
- Modify: `apps/vela-api/test/routes/tts.test.ts`

**Interfaces:**
- Produces: route-owned errors with stable `code` plus unchanged `error` and HTTP status.
- Preserves: Hono/Zod validator-generated 400 shape.

- [ ] **Step 1: Write failing route tests**

```ts
it('returns a stable code when TTS is not configured', async () => {
  ttsSettingsGet.mockResolvedValue(null);
  const response = await app.request('/api/tts/generate', authenticatedPost({
    vocabularyId: '水:ミズ',
    text: '水',
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: 'TTS API key not configured. Please configure in Settings.',
    code: 'tts_not_configured',
  });
});

it('leaves request-validator failures uncoded', async () => {
  const response = await app.request('/api/tts/generate', authenticatedPost({
    vocabularyId: '',
    text: '',
  }));

  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).toMatchObject({ success: false });
  expect(body).not.toHaveProperty('code');
});
```

Add exact message/status/code assertions for invalid provider, S3 service unavailable, provider timeout, provider failure, upload failure, and signing failure.

- [ ] **Step 2: Run the route test and verify red**

```bash
bun test apps/vela-api/test/routes/tts.test.ts
```

Expected: route-owned error tests fail because `code` is absent.

- [ ] **Step 3: Add codes to route-owned branches**

Use exact literals from `TtsApiErrorCode`:

```ts
return c.json(
  {
    error: 'TTS API key not configured. Please configure in Settings.',
    code: 'tts_not_configured',
  },
  400,
);
```

Repeat for all approved mappings. Do not wrap `zValidator` or alter its failure body.

- [ ] **Step 4: Run green tests and commit**

```bash
bun test apps/vela-api/test/routes/tts.test.ts
bun run --cwd apps/vela-api typecheck

git add apps/vela-api/src/routes/tts.ts apps/vela-api/test/routes/tts.test.ts
git commit -m "feat(api): add stable TTS error codes"
```

---

### Task 3: Add Coordinator Transport Overrides and Identical POST Replay

**Files:**
- Modify: `apps/vela-mobile/src/auth/mobile-auth-contract.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/services/mobile-auth.test.ts`

**Interfaces:**
- Produces: `transportTimeoutMs?: number`, `MOBILE_AUTH_MAX_FEATURE_NETWORK_TIMEOUT_MS`, and `invalid_request_timeout`.
- Preserves: one authenticated replay after successful 401 recovery.

- [ ] **Step 1: Write failing timeout-validation tests**

```ts
it.each([0, -1, 1.5, Number.NaN, 50_001])(
  'rejects invalid transport timeout %s',
  async (transportTimeoutMs) => {
    await expect(
      coordinator.requestAuthenticatedApi({ path: 'tts/generate', transportTimeoutMs }),
    ).rejects.toMatchObject({ code: 'invalid_request_timeout' });
  },
);
```

Add fake-timer tests proving omitted timeout aborts a physical fetch after 15 seconds and `45_000` remains active at 15 seconds but aborts at 45 seconds.

- [ ] **Step 2: Write the failing replay test**

```ts
it('replays a JSON POST once with the identical body after refresh', async () => {
  const body = JSON.stringify({ vocabularyId: '水:ミズ', text: '水' });
  featureFetch
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ audioUrl: HTTPS_AUDIO, cached: true })));
  refreshSession.mockResolvedValue(refreshedSession());

  await coordinator.requestAuthenticatedApi({
    path: 'tts/generate',
    transportTimeoutMs: 45_000,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    },
  });

  const attempts = featureFetch.mock.calls.filter(([url]) => String(url).includes('tts/generate'));
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.[1]?.body).toBe(body);
  expect(attempts[1]?.[1]?.body).toBe(body);
  expect(attempts[1]?.[1]?.method).toBe('POST');
});
```

Adapt helper names to the existing test harness; retain the exact assertions.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-auth.test.ts
```

Expected: timeout contract tests fail.

- [ ] **Step 4: Implement validated per-attempt timeout selection**

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

Use the selected value for each physical fetch attempt. Continue spreading the same `request.init` into the post-refresh attempt.

- [ ] **Step 5: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-auth.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/auth/mobile-auth-contract.ts \
  apps/vela-mobile/src/services/mobile-auth.ts \
  apps/vela-mobile/src/services/mobile-auth.test.ts
git commit -m "feat(mobile): support bounded feature transport timeouts"
```

---

### Task 4: Extend MobileApiClient with Replayable JSON POST and Safe Structured Errors

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-api-client.ts`
- Modify: `apps/vela-mobile/src/services/mobile-api-client.test.ts`
- Modify: `apps/vela-mobile/src/composables/useDueReviewCount.test.ts`

**Interfaces:**
- Produces: `postJson()`, `MobileApiRequestOptions.timeoutMs`, `MOBILE_API_MAX_ERROR_BODY_BYTES`, `MobileApiError.details`, and `client` classification.
- Consumes: coordinator timeout override from Task 3.

- [ ] **Step 1: Write failing POST tests**

```ts
it('serializes JSON before coordinator dispatch', async () => {
  coordinator.requestAuthenticatedApi.mockResolvedValue(
    new Response(JSON.stringify({ audioUrl: HTTPS_AUDIO, cached: false })),
  );

  await client.postJson(
    'tts/generate',
    { vocabularyId: '水:ミズ', text: '水' },
    { timeoutMs: 45_000 },
  );

  const request = coordinator.requestAuthenticatedApi.mock.calls[0]?.[0];
  expect(request.path).toBe('tts/generate');
  expect(request.transportTimeoutMs).toBe(45_000);
  expect(request.init?.method).toBe('POST');
  expect(request.init?.body).toBe(JSON.stringify({ vocabularyId: '水:ミズ', text: '水' }));
  expect(new Headers(request.init?.headers).get('Content-Type')).toBe('application/json');
});

it('rejects circular JSON before coordinator dispatch', async () => {
  const body: Record<string, unknown> = {};
  body.self = body;
  await expect(client.postJson('tts/generate', body)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(coordinator.requestAuthenticatedApi).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing classification and redaction tests**

```ts
it('classifies 400 as a non-enumerable client error', async () => {
  coordinator.requestAuthenticatedApi.mockResolvedValue(
    new Response(JSON.stringify({ success: false, error: { issues: [] } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const error = await captureError(client.getJson('invalid'));
  expect(error).toMatchObject({ code: 'client' });
  expect(error.details.status).toBe(400);
  expect(Object.keys(error)).not.toContain('details');
});

it('preserves absence of cause when none is provided', () => {
  expect('cause' in new MobileApiError('network')).toBe(false);
});
```

Add JSON and text bodies larger than 16 KiB. Assert retained details do not exceed the cap and safe summaries contain only `code` and `status`.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-api-client.test.ts
```

Expected: `postJson`, `client`, and structured details are absent.

- [ ] **Step 4: Implement one private JSON request path**

```ts
export const MOBILE_API_DEFAULT_TIMEOUT_MS = 8_000;
export const MOBILE_API_MAX_ERROR_BODY_BYTES = 16_384;

export type MobileApiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};
```

Serialize POST data before dispatch. Use one outer deadline across auth recovery, physical fetch, and body consumption. Pass the selected timeout as `transportTimeoutMs`.

- [ ] **Step 5: Implement conditional cause and non-enumerable details**

```ts
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

Read no more than 16 KiB before parsing either JSON or text. Never log the entire error object from this layer.

- [ ] **Step 6: Pin due-count retry migration**

```ts
expect(retryDueCountQuery(0, new MobileApiError('client', { status: 400 }))).toBe(false);
expect(retryDueCountQuery(0, new MobileApiError('server', { status: 500 }))).toBe(true);
expect(retryDueCountQuery(0, new MobileApiError('network'))).toBe(true);
```

- [ ] **Step 7: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-api-client.test.ts \
  src/composables/useDueReviewCount.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/services/mobile-api-client.ts \
  apps/vela-mobile/src/services/mobile-api-client.test.ts \
  apps/vela-mobile/src/composables/useDueReviewCount.test.ts
git commit -m "feat(mobile): add replayable JSON requests and safe API errors"
```

---

### Task 5: Implement MobileTtsService, Cache, Error Mapping, and Timings

**Files:**
- Create: `apps/vela-mobile/src/services/mobile-tts.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts.test.ts`

**Interfaces:**
- Consumes: shared contracts and `MobileApiClient`.
- Produces: `MobileTtsService`, `PreparedPronunciation`, `PreparationTimings`, `MobileTtsError`, `MOBILE_TTS_GENERATE_TIMEOUT_MS`.

- [ ] **Step 1: Write failing request and mapping tests**

```ts
it('uses default settings timeout and 45-second generate timeout', async () => {
  api.getJson.mockResolvedValue(CONFIGURED_SETTINGS);
  api.postJson.mockResolvedValue({ audioUrl: HTTPS_AUDIO, cached: false });

  await service.preparePronunciation(INPUT);

  expect(api.getJson).toHaveBeenCalledWith('tts/settings', { signal: expect.any(AbortSignal) });
  expect(api.postJson).toHaveBeenCalledWith(
    'tts/generate',
    { vocabularyId: '水:ミズ', text: '水' },
    { signal: expect.any(AbortSignal), timeoutMs: 45_000 },
  );
});

it('maps an uncoded validator 400 to invalid_input', async () => {
  api.getJson.mockResolvedValue(CONFIGURED_SETTINGS);
  api.postJson.mockRejectedValue(
    new MobileApiError('client', { status: 400, serverBody: { success: false, error: { issues: [] } } }),
  );

  await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code: 'invalid_input' });
});
```

Add explicit cases for each stable code, both exact legacy 400 messages, status-only 503 and 504, uncoded 500, client deadline/network, and structurally invalid 2xx response.

- [ ] **Step 2: Write failing single-flight and cache tests**

```ts
it('shares generation after resolving the same settings-derived key', async () => {
  api.getJson.mockResolvedValue(CONFIGURED_SETTINGS);
  const generation = deferred<unknown>();
  api.postJson.mockReturnValue(generation.promise);

  const first = service.preparePronunciation(INPUT);
  const second = service.preparePronunciation(INPUT);
  generation.resolve({ audioUrl: HTTPS_AUDIO, cached: false });

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(api.postJson).toHaveBeenCalledTimes(1);
});

it('uses a distinct key after voice changes', async () => {
  api.getJson
    .mockResolvedValueOnce(CONFIGURED_SETTINGS)
    .mockResolvedValueOnce({ ...CONFIGURED_SETTINGS, voiceId: 'nova' });
  api.postJson
    .mockResolvedValueOnce({ audioUrl: HTTPS_AUDIO, cached: false })
    .mockResolvedValueOnce({ audioUrl: 'https://audio.example.test/mizu-nova.mp3', cached: false });

  await service.preparePronunciation(INPUT);
  await service.preparePronunciation(INPUT);
  expect(api.postJson).toHaveBeenCalledTimes(2);
});
```

Add fake-timer tests for 14-minute expiry, five-minute sweeps, LRU refresh, and 300-entry eviction.

- [ ] **Step 3: Write failing invalidation-generation tests**

```ts
it('removes every settings partition for one user and vocabulary', async () => {
  await seedPrepared(service, INPUT, CONFIGURED_SETTINGS, HTTPS_AUDIO);
  await seedPrepared(
    service,
    INPUT,
    { ...CONFIGURED_SETTINGS, voiceId: 'nova' },
    'https://audio.example.test/mizu-nova.mp3',
  );

  service.invalidatePronunciation('user-1', '水:ミズ');
  expect(service.inspectForTests().matchingCacheEntries('user-1', '水:ミズ')).toBe(0);
});

it('does not cache a stale completion after invalidation', async () => {
  api.getJson.mockResolvedValue(CONFIGURED_SETTINGS);
  const generation = deferred<unknown>();
  api.postJson.mockReturnValue(generation.promise);

  const first = service.preparePronunciation(INPUT);
  service.invalidatePronunciation('user-1', '水:ミズ');
  generation.resolve({ audioUrl: HTTPS_AUDIO, cached: false });
  await first;

  api.postJson.mockResolvedValue({ audioUrl: HTTPS_AUDIO, cached: true });
  await service.preparePronunciation(INPUT);
  expect(api.postJson).toHaveBeenCalledTimes(2);
});
```

Expose deterministic test inspection only when the project already accepts test-only exports; otherwise assert through public request counts.

- [ ] **Step 4: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-tts.test.ts
```

Expected: module does not exist.

- [ ] **Step 5: Implement public types and ordered error mapping**

```ts
export const MOBILE_TTS_GENERATE_TIMEOUT_MS = 45_000;

export type PreparationTimings = { settingsMs: number; generateMs: number };

export type PreparedPronunciation = {
  audioUrl: string;
  source: 'memory-cache' | 'server-cache' | 'generated';
  expiresAt: number;
  timings: PreparationTimings;
};
```

Map in this order: recognized stable code, exact legacy 400 message, auth/session/network code, HTTP status, structural response failure.

- [ ] **Step 6: Implement preparation and cache semantics**

Fetch settings before deriving the key. Record settings and generation timings separately. Use encoded key components:

```ts
const cacheKey = [userId, vocabularyId, provider, voiceId ?? '', model ?? '']
  .map(encodeURIComponent)
  .join('|');
```

Use `now + 14 * 60_000` expiry, 300-entry LRU bound, and five-minute sweep interval. Do not include text in only the client key; document the fixed-pair precondition in code.

- [ ] **Step 7: Implement per-user and per-user/vocabulary invalidation generations**

Capture both generations before generation. Cache only when both still match. Remove matching pending records from the join index during invalidation, but do not abort work already awaited by existing callers.

- [ ] **Step 8: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/services/mobile-tts.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/services/mobile-tts.ts \
  apps/vela-mobile/src/services/mobile-tts.test.ts
git commit -m "feat(mobile): add authenticated TTS service"
```

---

### Task 6: Register MobileTtsService and Clear Prior-User Cache on Auth Transitions

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-services.ts`
- Modify: `apps/vela-mobile/src/services/mobile-services.test.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts`
- Create: `apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.ts`
- Modify: `apps/vela-mobile/src/boot/mobile-auth.test.ts`

**Interfaces:**
- Produces: `MOBILE_TTS_SERVICE_KEY` and `installMobileTtsAuthIsolation()`.
- Responsibility boundary: this watcher clears app-wide TTS cache/pending indexes only; the mounted controller owns active audio stop/dispose.

- [ ] **Step 1: Write failing registry tests**

```ts
it('provides SRS and TTS services from one API client', () => {
  provideMobileServices(app, coordinator);
  expect(app.provide).toHaveBeenCalledWith(MOBILE_API_CLIENT_KEY, expect.any(Object));
  expect(app.provide).toHaveBeenCalledWith(MOBILE_SRS_SERVICE_KEY, expect.any(Object));
  expect(app.provide).toHaveBeenCalledWith(MOBILE_TTS_SERVICE_KEY, expect.any(Object));
});
```

- [ ] **Step 2: Write failing isolation tests**

```ts
it('clears only the previous user on identity replacement', async () => {
  const state = reactive(authenticatedState('user-a'));
  const tts = { clearUser: vi.fn() };
  installMobileTtsAuthIsolation({ state, ttsService: tts as MobileTtsService });

  Object.assign(state, authenticatedState('user-b'));
  await nextTick();

  expect(tts.clearUser).toHaveBeenCalledWith('user-a');
  expect(tts.clearUser).not.toHaveBeenCalledWith('user-b');
});

it('does nothing for null to user transition', async () => {
  const state = reactive(signedOutState());
  const tts = { clearUser: vi.fn() };
  installMobileTtsAuthIsolation({ state, ttsService: tts as MobileTtsService });

  Object.assign(state, authenticatedState('user-a'));
  await nextTick();
  expect(tts.clearUser).not.toHaveBeenCalled();
});
```

Add sign-out, cleanup retry, unusable recovery, and successor-race cases modeled after `mobile-query-auth-isolation.test.ts`.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-services.test.ts \
  src/services/mobile-tts-auth-isolation.test.ts \
  src/boot/mobile-auth.test.ts
```

Expected: TTS key and isolation installer are absent.

- [ ] **Step 4: Register the service and install prior-user cleanup**

```ts
export const MOBILE_TTS_SERVICE_KEY: InjectionKey<MobileTtsService> = Symbol('mobile-tts-service');

const apiClient = createMobileApiClient(coordinator);
const srsService = createMobileSrsService(apiClient);
const ttsService = createMobileTtsService(apiClient);
```

Install a serialized watcher that captures the previous user ID and calls only `ttsService.clearUser(previousUserId)`. Do not use `queryClient.clear()` and do not clear successor state.

- [ ] **Step 5: Wire the watcher from existing mobile boot**

After providing services, install the watcher with the coordinator's readonly state. Expose a testable factory return value rather than duplicating construction in tests.

- [ ] **Step 6: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-services.test.ts \
  src/services/mobile-tts-auth-isolation.test.ts \
  src/boot/mobile-auth.test.ts

git add apps/vela-mobile/src/services/mobile-services.ts \
  apps/vela-mobile/src/services/mobile-services.test.ts \
  apps/vela-mobile/src/services/mobile-tts-auth-isolation.ts \
  apps/vela-mobile/src/services/mobile-tts-auth-isolation.test.ts \
  apps/vela-mobile/src/boot/mobile-auth.ts apps/vela-mobile/src/boot/mobile-auth.test.ts
git commit -m "feat(mobile): register and isolate TTS service"
```

---

### Task 7: Add Browser-Free Audio Contract and HTML Adapter

**Files:**
- Create: `apps/vela-mobile/src/audio/mobile-audio-contract.ts`
- Create: `apps/vela-mobile/src/audio/html-audio-player.ts`
- Create: `apps/vela-mobile/src/audio/html-audio-player.test.ts`

**Interfaces:**
- Produces: `MobileAudioPlayer`, `MobileAudioPlaybackHandle`, `MobileAudioPlaybackOutcome`, `MobileAudioError`.

- [ ] **Step 1: Write a deterministic fake audio element and failing tests**

```ts
it('settles restart before synchronous pause can become interruption', async () => {
  const first = player.play('https://audio.example.test/one.mp3');
  const second = player.play('https://audio.example.test/two.mp3');

  await expect(first.finished).resolves.toEqual({ kind: 'stopped', reason: 'restart' });
  expect(factory.activeElements()).toHaveLength(1);

  factory.elementFor('https://audio.example.test/two.mp3').dispatch('ended');
  await expect(second.finished).resolves.toEqual({ kind: 'ended' });
});

it('maps a rejected play caused by user activation to gesture_required', async () => {
  factory.nextPlayError = new DOMException('Not allowed', 'NotAllowedError');
  await expect(player.play('https://audio.example.test/mizu.mp3').finished).rejects.toMatchObject({
    code: 'gesture_required',
  });
});
```

Add explicit tests for media error, generic play rejection, external pause, explicit stop, background interruption, dispose, listener cleanup, and exactly-once settlement.

- [ ] **Step 2: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/audio/html-audio-player.test.ts
```

Expected: audio modules do not exist.

- [ ] **Step 3: Define the DOM-free contract**

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

- [ ] **Step 4: Implement strict cleanup ordering**

Before calling `pause()`, mark the handle settled, detach listeners, and clear active ownership. Set `preload = 'auto'`; do not set `crossOrigin`; clear `src` only after listener removal.

- [ ] **Step 5: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/audio/html-audio-player.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/audio/mobile-audio-contract.ts \
  apps/vela-mobile/src/audio/html-audio-player.ts \
  apps/vela-mobile/src/audio/html-audio-player.test.ts
git commit -m "feat(mobile): add replaceable HTML audio adapter"
```

---

### Task 8: Extend Shared Lifecycle State Through the Existing Listener

**Files:**
- Modify: `apps/vela-mobile/src/services/mobile-lifecycle.ts`
- Modify: `apps/vela-mobile/src/services/mobile-lifecycle.test.ts`
- Modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.ts`
- Create or modify: `apps/vela-mobile/src/boot/capacitor-lifecycle.test.ts`

**Interfaces:**
- Produces: `mobileLifecycleState.isActive`, transition timestamps, and `recordAppStateChange()`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('records app-state transitions without incrementing resume count', () => {
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

- [ ] **Step 2: Write failing boot ownership tests**

Capture the existing `appStateChange` callback and assert one invocation updates both shared lifecycle state and TanStack focus. Assert registration count remains one in this boot module.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/services/mobile-lifecycle.test.ts \
  src/boot/capacitor-lifecycle.test.ts
```

Expected: active state and recorder are absent.

- [ ] **Step 4: Implement state and recorder**

```ts
export function recordAppStateChange(next: boolean, at = Date.now()): void {
  isActive.value = next;
  lastStateChangeAt.value = at;
  if (next) lastBecameActiveAt.value = at;
  else lastBecameInactiveAt.value = at;
}
```

Reset all new refs in `resetMobileLifecycleForTests()`.

- [ ] **Step 5: Feed state from the existing boot callback**

```ts
await adapter.addListener('appStateChange', (event) => {
  recordAppStateChange(event.isActive);
  focusManager.setFocused(event.isActive);
});
```

Do not change the auth coordinator's private lifecycle listener.

- [ ] **Step 6: Run green tests and commit**

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

### Task 9: Implement Pronunciation Controller State Machine

**Files:**
- Create: `apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts`
- Create: `apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts`

**Interfaces:**
- Consumes: `MobileTtsService`, `MobileAudioPlayer`, feature-session selector, and shared lifecycle state.
- Produces: controller state, `playOrRetry()`, diagnostic invalidation actions, counters, and `dispose()`.

- [ ] **Step 1: Write failing happy-path and gesture tests**

```ts
it('moves idle to preparing to playing to ready', async () => {
  tts.preparePronunciation.mockResolvedValue(PREPARED);
  const handle = controllablePlaybackHandle();
  audio.play.mockReturnValue(handle.publicHandle);
  const controller = createController();

  const action = controller.playOrRetry();
  await flushPromises();
  expect(controller.state.value.kind).toBe('playing');

  handle.resolve({ kind: 'ended' });
  await action;
  expect(controller.state.value.kind).toBe('ready');
  expect(controller.counters.completedPlays.value).toBe(1);
});

it('retains prepared audio after gesture rejection', async () => {
  tts.preparePronunciation.mockResolvedValue(PREPARED);
  audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('gesture_required')));
  const controller = createController();

  await controller.playOrRetry();
  expect(controller.state.value).toMatchObject({ kind: 'ready', notice: 'gesture_required' });
});
```

- [ ] **Step 2: Write failing concurrency and live-replay tests**

Use deferred preparation and playback handles. Assert a second tap during preparation makes no second service call; a tap during playback settles the first handle as restart before starting the second; a live ready tap calls audio directly and makes no settings/generate request.

- [ ] **Step 3: Write failing recovery tests**

Create named cases that assert:

```ts
expect(tts.preparePronunciation).toHaveBeenCalledTimes(1); // network failure: no auto retry
expect(tts.preparePronunciation).toHaveBeenCalledTimes(2); // one same-user session_changed retry
expect(tts.invalidatePronunciation).toHaveBeenCalledWith('user-1', '水:ミズ'); // expiry/media
```

Add cases for recovery-pending continuation, second control failure, identity replacement, one media refresh per tap, refresh failure, background interruption, no auto-resume, and stale completion after dispose.

- [ ] **Step 4: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/composables/usePronunciationDiagnostic.test.ts
```

Expected: controller does not exist.

- [ ] **Step 5: Implement state and operation generations**

```ts
export type PronunciationDiagnosticState =
  | { kind: 'idle' }
  | { kind: 'preparing'; attempt: number; recoveringSession: boolean }
  | { kind: 'ready'; pronunciation: PreparedPronunciation; notice: ReadyNotice | null }
  | { kind: 'playing'; pronunciation: PreparedPronunciation }
  | { kind: 'interrupted'; pronunciation: PreparedPronunciation; reason: 'background' | 'external' }
  | { kind: 'error'; error: PronunciationDiagnosticError; pronunciation: PreparedPronunciation | null };
```

Use an operation generation counter to prevent old promises from writing successor state.

- [ ] **Step 6: Implement manual retry, auth continuation, expiry, and lifecycle behavior**

Retry transport failures only after a new explicit action. Permit one same-user control/recovery continuation. Invalidate every settings partition on local expiry or media failure. Stop active audio on identity loss, unmount, and inactive lifecycle state; never auto-resume.

- [ ] **Step 7: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/composables/usePronunciationDiagnostic.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/composables/usePronunciationDiagnostic.ts \
  apps/vela-mobile/src/composables/usePronunciationDiagnostic.test.ts
git commit -m "feat(mobile): add pronunciation diagnostic controller"
```

---

### Task 10: Add Authenticated Development Route and More Entry

**Files:**
- Create: `apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.test.ts`
- Create: `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.vue`
- Create: `apps/vela-mobile/src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts`
- Modify: `apps/vela-mobile/src/pages/MorePage.vue`
- Modify: `apps/vela-mobile/src/pages/MorePage.test.ts`

**Interfaces:**
- Produces: route path, fixed word, labels, markers, test IDs, and split route collections.

- [ ] **Step 1: Write failing route-partition tests**

```ts
expect(bypassDevelopmentDiagnosticRoutes.every((route) => route.meta?.bypassMobileAuth === true)).toBe(true);
expect(authenticatedDevelopmentDiagnosticRoutes).toHaveLength(1);
expect(authenticatedDevelopmentDiagnosticRoutes[0]?.path).toBe('diagnostics/tts-pronunciation');
expect(authenticatedDevelopmentDiagnosticRoutes[0]?.meta?.bypassMobileAuth).not.toBe(true);
expect(developmentDiagnosticRoutes).toEqual([
  ...bypassDevelopmentDiagnosticRoutes,
  ...authenticatedDevelopmentDiagnosticRoutes,
]);
```

Retain the production five-shell-route assertion.

- [ ] **Step 2: Write failing entry tests**

```ts
it('navigates to authenticated TTS diagnostics', async () => {
  const wrapper = mountEntry();
  await wrapper.get('[data-testid="tts-pronunciation-entry"]').trigger('click');
  expect(pushMobileRoute).toHaveBeenCalledWith(router, '/diagnostics/tts-pronunciation');
});
```

Add More-page tests proving development inclusion and production omission.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/router/diagnostic-routes.test.ts \
  src/components/mobile/TtsPronunciationDiagnosticsEntry.test.ts \
  src/pages/MorePage.test.ts
```

Expected: route contract and entry are absent.

- [ ] **Step 4: Define constants and split routes**

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

Keep current iOS interaction routes in `bypassDevelopmentDiagnosticRoutes`; add TTS only to `authenticatedDevelopmentDiagnosticRoutes` with fallback `/more` and no bypass metadata.

- [ ] **Step 5: Add development-only More entry**

Follow the existing lazy entry pattern and use `import.meta.env.DEV` as the only exposure switch.

- [ ] **Step 6: Run green tests and commit**

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

### Task 11: Build Accessible Diagnostic Page

**Files:**
- Create: `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue`
- Create: `apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts`

**Interfaces:**
- Consumes: controller, fixed word, injected TTS service/coordinator, and HTML audio player factory.
- Produces: accessible controls, safe counters, timings, and development actions.

- [ ] **Step 1: Write failing state-rendering tests**

```ts
it('renders idle and preparing states accessibly', async () => {
  const wrapper = mountPageWithController(idleController());
  expect(wrapper.get('[data-testid="tts-play-button"]').attributes('aria-label')).toBe(
    'Prepare and play pronunciation',
  );

  controller.state.value = { kind: 'preparing', attempt: 1, recoveringSession: false };
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toContain('Preparing pronunciation');
  expect(wrapper.get('[data-testid="tts-play-button"]').attributes('disabled')).toBeDefined();
});
```

Add explicit fixtures for recovering, playing, completed, gesture-required, interrupted, invalid-input, network/deadline, provider-timeout, service-unavailable, refreshed-URL, and playback-failure states.

- [ ] **Step 2: Write failing safety tests**

```ts
it('never renders internal server details or a signed query string', () => {
  const wrapper = mountFailurePage({
    safeCode: 'generation_failed',
    signedUrl: 'https://s3.example.test/mizu?X-Amz-Signature=secret',
    serverMessage: 'provider credential rejected',
  });

  expect(wrapper.text()).not.toContain('X-Amz-Signature');
  expect(wrapper.text()).not.toContain('provider credential rejected');
});
```

Assert role/live-region usage, word/reading/translation, timing labels, retry/restart labels, and diagnostic invalidation actions.

- [ ] **Step 3: Run focused tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
```

Expected: page does not exist.

- [ ] **Step 4: Implement page using only controller-safe state**

Do not call API or auth methods directly. Render stable user messages, diagnostic source/timings, redacted host/path only, and controller actions. Dispose controller on unmount.

- [ ] **Step 5: Run green tests and commit**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
bun run --cwd apps/vela-mobile typecheck

git add apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.vue \
  apps/vela-mobile/src/pages/diagnostics/TtsPronunciationDiagnosticsPage.test.ts
git commit -m "feat(mobile): add pronunciation diagnostic page"
```

---

### Task 12: Prove Production Exclusion and Run Automated Merge Gates

**Files:**
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs`

**Interfaces:**
- Produces: production-bundle leak detection for every TTS diagnostic token.

- [ ] **Step 1: Write failing scanner tests**

```js
it('rejects a production bundle containing TTS diagnostic tokens', async () => {
  await writeBundle('Pronunciation diagnostics /diagnostics/tts-pronunciation tts-pronunciation-entry');
  await expect(verifyProductionDiagnostics()).rejects.toThrow('tts-pronunciation');
});
```

Keep the existing success fixture and iOS interaction token cases.

- [ ] **Step 2: Run scanner test and verify red**

```bash
bun test apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs
```

Expected: TTS token fixture is not detected.

- [ ] **Step 3: Extend scanner with build-safe literal tokens**

Do not import Vue/browser modules into the Node verification script. Include route, label, marker, and test ID.

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

Expected: every focused suite exits 0.

- [ ] **Step 5: Run package and repository gates**

```bash
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile verify:production-diagnostics
bun run --cwd apps/vela-api typecheck
bun run test
```

Record fresh test counts and coverage in the implementation PR.

- [ ] **Step 6: Build iOS assets and project**

```bash
bun run --cwd apps/vela-mobile build:ios:assets
bun run --cwd apps/vela-mobile build:ios:ide
```

Expected: production diagnostics pass and the native project builds without a new audio dependency.

- [ ] **Step 7: Commit scanner changes**

```bash
git add apps/vela-mobile/scripts/verify-production-diagnostics.mjs \
  apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs
git commit -m "test(mobile): verify TTS diagnostic exclusion"
```

---

### Task 13: Collect Simulator and Physical-iPhone Evidence

**Files:**
- Create: `apps/vela-mobile/docs/tts-pronunciation-ios.md`
- Modify only after evidence: `packages/cdk/lib/storage-stack.ts`
- Create or modify only after evidence: `packages/cdk/test/storage-stack.test.ts`

**Interfaces:**
- Produces: HPA-208 closure record consumed by HPA-210.

- [ ] **Step 1: Capture exact software and commit versions**

Run and paste the actual outputs into the verification record:

```bash
git rev-parse HEAD
xcodebuild -version
bun --version
bun pm ls @capacitor/core quasar
```

Record Simulator model/iOS version from Xcode and physical-device model/iOS version from Settings or Xcode Devices and Simulators. Record only non-secret provider, voice, and model identifiers.

- [ ] **Step 2: Run Simulator matrix and write measured rows immediately**

Record pass/fail plus settings latency, generation/cache latency, and tap-to-play-attempt latency for:

- restored authentication;
- configured settings;
- first server-cache request;
- genuinely uncached generation;
- async first-tap attempt;
- prepared direct-tap playback;
- ten replays;
- rapid taps during preparation and playback;
- proactive expiry;
- disabled network and explicit retry;
- invalid URL refresh;
- background during preparation/playback;
- sign-out ready/playing;
- relaunch and replay.

- [ ] **Step 3: Run physical-iPhone matrix with human speaker evidence**

Verify and record:

1. Ring/Silent off and media volume nonzero: `水` is audible and correct through the built-in speaker.
2. Ring/Silent on and media volume nonzero: prepared direct tap is audible or inaudible through the built-in speaker.
3. External/system interruption leaves the controller replayable.
4. Ten prepared replays have no intermittent silent or stuck state.

Do not infer audibility from media events.

- [ ] **Step 4: Diagnose valid-URL failures before changing infrastructure**

If valid media fails, collect WebKit/native console evidence. Change S3 CORS only when evidence identifies origin rejection. Allow exact `capacitor://localhost` GET/HEAD access, preserve existing web origins, reject arbitrary origins, and never use `*`.

- [ ] **Step 5: Write the verification record using only actual observations**

Use these section headings:

```markdown
# iOS TTS Pronunciation Verification

## Tested Build and Environment
## Non-Secret TTS Configuration
## Timing Results
## Simulator Matrix
## Physical iPhone Matrix
## CORS Findings
## Known Limitations
## Architecture Decision
## Follow-up Issues
```

Populate each section from Steps 1–4 before committing. The architecture decision must be exactly one of:

- `HTML-only accepted`
- `native audio-session integration required`
- `native player adapter required`

- [ ] **Step 6: Create an evidence-driven Linear follow-up when required**

If silent mode is the only failed gate and HTML decoding/lifecycle are reliable, create a minimal app-level `AVAudioSession` `.playback` issue that retains `HtmlAudioPlayer`.

If HTML playback remains unreliable after correct CORS and audio-session configuration, create a native `MobileAudioPlayer` issue naming every failed criterion.

- [ ] **Step 7: Re-run automated gates after any CORS code change**

```bash
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile verify:production-diagnostics
bun run test
```

- [ ] **Step 8: Commit complete evidence**

```bash
git add apps/vela-mobile/docs/tts-pronunciation-ios.md
git add packages/cdk/lib/storage-stack.ts packages/cdk/test/storage-stack.test.ts 2>/dev/null || true
git commit -m "docs(mobile): record iOS TTS pronunciation verification"
```

Before committing, verify `git diff --cached` contains no incomplete evidence and no secrets.

- [ ] **Step 9: Update HPA-208 and HPA-210**

Link the implementation PR, tested commit, verification document, completed matrix, final architecture conclusion, and any follow-up issue. Close HPA-208 only after physical-iPhone evidence exists.

---

## Plan Self-Review Checklist

- [ ] Every design requirement maps to a task.
- [ ] No `TBD`, `TODO`, incomplete evidence template, or omitted example body remains.
- [ ] Shared parser names and mobile service types match across tasks.
- [ ] Timeout values remain 8 seconds, 45 seconds, 15 seconds, and 50 seconds in the correct layers.
- [ ] POST replay uses one serialized string and one post-refresh attempt.
- [ ] Uncoded validator 400 maps to `invalid_input`.
- [ ] Error details are bounded, non-enumerable, and excluded from UI/logging.
- [ ] Due-count 400/500/network retry behavior is pinned.
- [ ] Cache TTL, bound, sweep, key identity, and invalidation generations are covered.
- [ ] Service auth isolation clears prior-user cache; controller owns active audio stop/dispose.
- [ ] Audio cleanup ordering prevents self-generated pause interruptions.
- [ ] Existing boot lifecycle listener is the only shared-state listener.
- [ ] Existing bypass-route assertion remains meaningful after route splitting.
- [ ] Production scanner covers every TTS diagnostic token.
- [ ] Physical-device matrix requires human speaker evidence and an explicit architecture conclusion.
