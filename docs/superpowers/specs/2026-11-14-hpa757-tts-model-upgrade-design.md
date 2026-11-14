# HPA-757 — TTS Model Upgrade (Design Spec)

**Status:** Proposed, documentation-only draft PR (implementation follows in this same PR)  
**Linear:** https://linear.app/cwchanap/issue/HPA-757/update-tts-models-and-move-openai-tts-to-the-realtime-api  
**Dependency:** HPA-755 is Done; its extracted `TtsSection` exists on `main`.  
**Baseline:** `main` inspected on 2026-11-14 (`b1baf1c`).

## Goal

Keep Japanese vocabulary and sentence pronunciation working after OpenAI's 2027-01-06 Speech API model shutdown. Default to ElevenLabs `eleven_v4`, Gemini `gemini-3.8-flash-tts`, and OpenAI `gpt-realtime-2.1-mini`; expose a provider-specific model picker in the existing Settings TTS section. Preserve the existing authenticated generation, S3 storage/presigned-URL playback, and short-lived client URL caching paths. **One PR** owns design, code and tests.

## What is already implemented (do not rebuild it)

- `apps/vela-api/src/routes/tts.ts` handles authenticated `GET/POST /tts/settings`, `POST /tts/generate`, and `GET /tts/audio/:vocabularyId`.
- The S3 cache key **already hashes `provider:voiceId:model`** (lines 83–99), and the web `ttsService.ts` cache key already includes the model (lines 89–106). Do not add another cache or a second key dimension.
- Generate and audio lookup responses already include `effectiveSettings`; the web client uses it to avoid caching a URL under stale settings.
- `apps/vela/src/pages/settings/components/TtsSection.vue` is the existing Quasar UI; its model field is free text for ElevenLabs and hidden for the other two providers. Saving currently requires a freshly entered API key even when a key is stored.
- `packages/cdk/lib/api-stack.ts` gives the Node 20 API Lambda 60 seconds. API Gateway REST integrations have a **29-second default**; increasing Lambda timeout alone does not solve a slow response.

## Scope and boundaries

In: a small typed TTS catalog in `@vela/common`, provider adapters, minimal server settings/normalization changes, the current TTS settings component/service, and focused tests. The existing one-user-one-active-TTS-provider DynamoDB row remains the persistence model.

Out: new audio queue/worker, streaming audio to browsers, a multi-provider TTS key vault, migration machinery, rebuilding the TTS screens, mobile-only Settings UI, general audio engine, new infrastructure by default, or LLM preferences. No extra art or sound assets are needed.

## Shared provider/model catalog

Add a single `TTS_MODELS`/provider metadata constant in `packages/common/src/contracts/tts.ts`, with model IDs, display labels, default IDs and allowed fixed voices. Reuse the same data in Settings and server validation/default resolution.

| Provider | Default | Other selectable model | Voice input |
| --- | --- | --- | --- |
| ElevenLabs | `eleven_v4` | `eleven_multilingual_v2` (already supported; allows a meaningful in-provider comparison) | Free-form voice ID, existing default |
| OpenAI | `gpt-realtime-2.1-mini` | None: no speculative Realtime models | The ticket's supported Realtime voice list: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar |
| Gemini | `gemini-3.8-flash-tts` | `gemini-3.8-flash-lite-tts` (same 3.8 request shape; cost-sensitive choice) | 30 official prebuilt studio voices; remove `Iocaste` |

The two optional selections above require no additional adapter architecture and make the model picker useful. Do not add the Eleven v4 Turbo WebSocket or unsupported/deprecated OpenAI Speech API models. Copy Gemini's official complete 30-voice list from the vendor documentation; do not maintain a second list in `TtsSection`.

Resolve the **effective model and voice** once from the registry for both generation and audio lookup. Null/unknown stored selections resolve to the new provider defaults, not to a deprecated API model. Publish those effective values in `GET /tts/settings`, `effectiveSettings`, and the S3 key. This avoids an implicit-model cache collision after changing adapter defaults. No one-time DynamoDB migration is necessary. On writes, reject model IDs outside the current provider catalog and unsupported preset voices; ElevenLabs accepts the existing custom voice ID path.

## Provider design

### ElevenLabs

Keep `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`, MP3 output, the existing fetch/timeout behavior, and the voice settings supported by v4. Select `eleven_v4` by default. Unit test request body and content type. The secondary multilingual v2 model uses this same endpoint.

### Gemini

The existing adapter uses the 2.5 `models/{id}:generateContent` request/response format; **do not only replace the model string**. For Gemini 3.8 on the AI Studio API-key path, use the documented `POST https://generativelanguage.googleapis.com/v1beta/interactions` JSON contract with `input`, `response_format: {type:'audio'}`, and `generation_config.speech_config`. Decode `output_audio.data`; the default unary output is a **complete 24 kHz mono WAV (RIFF)**, so store its original bytes as `audio/wav` without prepending a second WAV header. Fail clearly for missing/malformed audio, non-2xx responses and timeouts. Both 3.8 Flash and Flash-Lite use this contract. Keep 30 official voices in the common catalog.

### OpenAI

Replace `POST /v1/audio/speech` with a **server-to-server**, per-request WebSocket to `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini`, authenticated with the existing stored API key. The key never goes to the browser.

Use the small `ws` package and its types: the Lambda runs Node 20, and relying on Bun's global WebSocket in development would not establish production behavior. No WebRTC, persistent socket pool, or generic realtime abstraction.

1. On socket open, send `session.update` with `type:'realtime'`, selected voice, `audio.output.format={type:'audio/pcm',rate:24000}`, and instructions: "Read the user's text aloud exactly as written, in Japanese, without adding or changing anything."
2. After `session.updated`, send one user `conversation.item.create` containing `input_text`, then `response.create` with audio output.
3. Collect base64 `response.output_audio.delta` bytes in order. On `response.done`, succeed **only** for a completed response with nonempty audio. Fail for `error`, interrupted/failed response, socket close, or invalid payload.
4. Wrap the 16-bit mono 24 kHz PCM into a 44-byte RIFF/WAV header, return `audio/wav`, and always close/terminate the socket and clear the timer on success or failure.

Use a bounded generation deadline (target **22–24 seconds inclusive of WebSocket establishment**) with room for S3 and API Gateway's default integration limit. Map this to the existing `tts_generation_timeout` route error; do not increase the current 60-second Lambda timeout by default. If live latency repeatedly exceeds this budget, report it before proposing any API Gateway/CDK change.

**Early quality gate:** before committing to the remaining OpenAI work, run representative Japanese vocabulary, kana/kanji, numbers and short sentences through a real Realtime key. Check audio plays, that no content is added or omitted, and response time. Realtime does not guarantee literal instruction following and Japanese quality may vary. If it paraphrases or fails Japanese speech, stop and surface the finding as HPA-757 requests instead of quietly switching models or dropping OpenAI.

## Settings and API-key save behavior

- In `TtsSection.vue`, replace the free-form ElevenLabs model input with a `q-select` **for every provider**, wired to the common catalog. The voice picker follows the chosen provider's official options; ElevenLabs remains an optional free-text voice ID. Show current defaults and an unobtrusive AI-generated-audio label.
- On provider changes, select a valid default model/voice rather than carrying a model/voice from a different provider. On query reload, preserve the saved provider/model/voice and do not clobber in-progress user edits.
- `POST /tts/settings` keeps the current row and route; make `apiKey` optional **only when updating settings for the same provider with an existing key**. Preserve that stored key. A new user or a provider switch must provide a key. Never send a secret back in the settings GET.
- In the UI, leave the key blank to retain the current provider's stored key; entering a key replaces it. Enable Save for model/voice-only edits when a same-provider key is already configured. Keep the existing success/failure feedback and query invalidation.
- Keep the `TtsSettings`/generate-response data shapes; normalize the effective model and voice rather than adding new persisted preference objects.

## Cache semantics

Re-use the current `generateCacheKey(userId,vocabularyId,provider,voiceId,model)` on the server and equivalent client URL cache key. The change is to **pass resolved effective values**, not raw nulls or legacy model IDs; `GET /tts/settings` and generate/audio `effectiveSettings` must agree. Verify by tests:

1. Same user/vocabulary/provider/voice/model -> S3 cache hit.
2. Different selected model -> different S3 key and generation on the first request.
3. Default model changes while stored model is null -> newly resolved key, not old audio.
4. Changing provider/voice also separates audio; client cannot reuse the old presigned URL.
5. No secret or raw upstream response body leaks into logs.

## Failure and cost boundaries

Keep existing sanitized TTS route errors and S3 presigning contracts. Limit retained audio buffers to the short pronunciation use case, not arbitrary long sessions. OpenAI's published `gpt-realtime-2.1-mini` rates at planning time are **$0.60/1M text input tokens and $20/1M audio output tokens**; record actual sample cost/latency during the early gate. Avoid a new background job just to handle a small pronunciation clip.

## Verification and acceptance

**Automated**: Bun mock tests for all three providers, WAV header/chunk handling, Realtime completed/failed/timeout/close paths, route save/key retention, S3 model cache separation and effective settings, and Vitest tests for model/voice defaults and Settings mutations. Run affected lint/typecheck/build. Add or adjust the existing mocked Playwright Settings/TTS journey; do not introduce a separate test framework.

**End-to-end platform acceptance (no human sign-off):**

- **macOS browser:** signed-in Settings displays the correct provider-specific models and voices; changing ElevenLabs model and saving *without re-entering the same key* persists after reload; generating Japanese pronunciation yields playable audio and a new cache identity. Capture the Settings UI screenshot for visual inspection.
- **Windows browser:** the same Settings/model-change/playback journey succeeds with a WAV/MP3 response as appropriate; capture a screenshot and confirm no layout overflow at desktop width.
- **iOS (Capacitor/Simulator or iOS Safari as applicable):** authenticated Japanese pronunciation still plays through the existing mobile/web audio path after backend provider selection; the responsive web Settings model/voice controls remain usable in Safari. Capture the narrow-layout screenshot.
- **Visual check:** compare against a Linear UI mockup **if attached later**; none was attached to HPA-757 when planning. In its absence, inspect screenshots for correct labels, dropdown options, key-retention hint, narrow layout and non-overlapping controls.

Android/Linux are CI-only, not manual acceptance targets. Successful tests must not be used to claim live Japanese audio quality without the real-provider gate.

## References

- OpenAI TTS deprecation (2027-01-06): https://developers.openai.com/api/docs/deprecations
- OpenAI Realtime events: https://developers.openai.com/api/docs/guides/realtime-conversations
- OpenAI Realtime WebSocket: https://developers.openai.com/api/docs/guides/voice-websockets
- OpenAI model/pricing: https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- Gemini 3.8 AI Studio TTS: https://ai.google.dev/gemini-api/docs/speech-generation
- ElevenLabs TTS models: https://elevenlabs.io/docs/overview/models
- AWS API Gateway integration timeout quotas: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html
